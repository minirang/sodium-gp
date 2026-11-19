import * as THREE from 'three';
import * as C from 'cannon-es';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { store } from './store.js';
import { CARS, TRACKS, AI_LEVELS, QUALITY, LAPS, COLORS } from './config.js';
import { buildTrack } from './world/city.js';
import { makeSky } from './world/sky.js';
import { buildCar } from './vehicle/model.js';
import { Car } from './vehicle/car.js';
import { AI } from './vehicle/ai.js';
import { resolveWalls } from './vehicle/walls.js';
import { Input } from './systems/input.js';
import { Sound } from './systems/audio.js';
import { Fx } from './systems/fx.js';
import { Hud, fmt } from './ui/hud.js';
import { show, showResult } from './ui/ui.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const IDLE = { steer: 0, thr: 0, brk: 0, hand: 0, auto: true };
const Y90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

export class Game {
    constructor() {
        this.r = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true, powerPreference: 'high-performance' });
        this.r.toneMapping = THREE.ACESFilmicToneMapping;
        this.r.shadowMap.type = THREE.PCFSoftShadowMap;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x7a587a, 40, 500);
        this.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1800);
        this.sky = makeSky(); this.scene.add(this.sky.mesh);
        this.hemi = new THREE.HemisphereLight(); this.scene.add(this.hemi);
        const sun = this.sun = new THREE.DirectionalLight(0xffffff, 1), sc = sun.shadow.camera;
        sc.left = sc.bottom = -80; sc.right = sc.top = 80; sc.near = 1; sc.far = 400;
        sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
        this.scene.add(sun, sun.target);
        this.pmrem = new THREE.PMREMGenerator(this.r);
        this.fx = new Fx(this.scene);

        Object.assign(this, { input: new Input(document.getElementById('wheel')), sound: new Sound(), hud: new Hud(), mode: 'menu', cars: [], paused: false, shake: 0, oa: 0, time: 0, chase: { yaw: 0, init: false } });
        this.camMode = store.settings.cam;
        this.applySettings();
        addEventListener('resize', () => this.resize());
        document.addEventListener('visibilitychange', () => { if (document.hidden && (this.mode === 'race' || this.mode === 'count')) this.pause(true); });
        this.setTrack(store.track);
        this.clock = new THREE.Clock();
        this.r.setAnimationLoop(() => this.frame());
    }

    applySettings() {
        const s = store.settings, q = this.q = QUALITY[s.quality], had = this.r.shadowMap.enabled;
        this.pr = Math.min(devicePixelRatio, q.pr);
        this.r.setPixelRatio(this.pr);
        this.r.shadowMap.enabled = this.sun.castShadow = q.shadow > 0;
        if (q.shadow) { this.sun.shadow.mapSize.set(q.shadow, q.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
        if (had !== q.shadow > 0) this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
        this.scene.fog.far = q.fog;
        this.sound.volume(s.master, s.engine);
        this.input.mouseSteer = !!s.mouse;
        document.body.classList.toggle('touch', s.touch === 'on' || (s.touch === 'auto' && matchMedia('(pointer:coarse)').matches));
        if (this.qId !== s.quality) {
            this.qId = s.quality; this.comp?.dispose?.();
            if (q.bloom) {
                const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: q.msaa });
                this.comp = new EffectComposer(this.r, rt);
                this.comp.addPass(new RenderPass(this.scene, this.cam));
                this.comp.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.5, 0.55, 0.9));
                this.comp.addPass(new OutputPass());
            } else this.comp = null;
        }
        if (this.timeId !== s.time) this.applyTime(s.time);
        if (this.mode === 'menu' && this.track && this.density !== q.trees) this.setTrack(store.track);
        this.resize();
    }

    applyTime(id) {
        this.timeId = id;
        const t = this.tm = this.sky.set(id);
        this.scene.fog.color.set(t.fog);
        this.hemi.color.set(t.sky[0]); this.hemi.groundColor.set(t.sky[1]); this.hemi.intensity = t.sky[2];
        this.sun.color.set(t.sun); this.sun.intensity = t.sunI; this.dir = new THREE.Vector3(...t.dir).normalize();
        this.r.toneMappingExposure = t.exp;
        const es = new THREE.Scene(); es.add(this.sky.clone());
        this.envRT?.dispose(); this.envRT = this.pmrem.fromScene(es, 0, 1, 2000); this.scene.environment = this.envRT.texture;
        this.track?.setTime(t); this.player?.lights.forEach((l) => { l.intensity = t.head; });
    }

    resize() {
        this.r.setSize(innerWidth, innerHeight, false);
        this.comp?.setPixelRatio(this.pr); this.comp?.setSize(innerWidth, innerHeight);
        this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix();
    }

    setTrack(id) {
        store.track = id;
        if (this.track) { this.scene.remove(this.track.group); this.track.dispose(); }
        this.density = this.q.trees;
        this.track = buildTrack(TRACKS.find((t) => t.id === id), this.density);
        this.track.setTime(this.tm);
        this.scene.add(this.track.group);
        this.hud.setMap(this.track.S);
        if (this.mode === 'menu') this.showPreview();
    }

    showPreview() {
        if (this.prev) this.scene.remove(this.prev);
        const m = buildCar(store.look), s = this.track.S[0];
        m.wheels.forEach((w, i) => { w.position.copy(m.wheelPts[i]); m.group.add(w); });
        m.brake(false);
        m.group.position.set(s.p.x, 0.61, s.p.z); m.group.rotation.y = s.yaw;
        this.prev = m.group; this.scene.add(m.group);
    }

    begin() {
        this.sound.init(); this.sound.volume(store.settings.master, store.settings.engine);
        show('#menu', false); show('#gfxTip', false); this.hud.show(true);
        if (this.prev) { this.scene.remove(this.prev); this.prev = null; }
        const w = this.world = new C.World({ gravity: new C.Vec3(0, -9.82, 0) });
        w.defaultContactMaterial.friction = 0.15; w.defaultContactMaterial.restitution = 0.1;
        this.track.addPhysics(w);

        const L = store.look, ps = CARS.find((c) => c.id === L.car), lv = AI_LEVELS[store.ai], rnd = Math.random, pool = COLORS.filter((c) => c !== L.color);
        let a = 0;
        this.cars = [0, 1, 2, 3, 4, 5].map((k) => {
            const pose = this.track.grid(k);
            let car;
            if (k === 3) { car = new Car(w, this.scene, ps, L, pose, { cockpit: true, lights: true }); car.name = '나'; this.player = car; }
            else {
                const look = { car: 'f458', color: pool[(a * 3 + 1) % pool.length], rim: '#d9dde6', wheel: 0.36, spokes: 5 };
                const spec = { ...ps, hx: 2.26, hz: 0.97, ox: 0.2, power: ps.power * (0.97 + rnd() * 0.06) };
                car = new Car(w, this.scene, spec, look, pose, { lod: true }); car.name = `AI ${a + 1}`; a++;
                if (this.q.shadow < 2048) { car.mesh.traverse((o) => { o.castShadow = false; }); car.wheels.forEach((x) => x.traverse((o) => { o.castShadow = false; })); }
            }
            car.ai = new AI(car, this.track.S, k === 3 ? 0.7 : lv.skill * (0.96 + rnd() * 0.08), k === 3 ? 0 : [-3.5, 3.5, -1.5, 1.5, 0][a - 1], rnd() * 6);
            car.hit = (v) => { if (car === this.player) { this.sound.hit(v); this.shake = Math.min(1, v / 18); } };
            this.initIdx(car);
            return car;
        });
        this.player.onShift = (up, thr) => this.sound.shift(up, thr);
        this.player.lights.forEach((l) => { l.intensity = this.tm.head; });
        Object.assign(this, { mode: 'count', cd: 6, time: 0, lit: -1, paused: false, camMode: store.settings.cam, order: this.cars });
        this.chase.init = false; this.input.pulse = {}; this.hud.setLights(0);
    }

    initIdx(c) {
        const S = this.track.S, p = c.body.position; let bd = 1e18;
        S.forEach((s, i) => { const d = (s.p.x - p.x) ** 2 + (s.p.z - p.z) ** 2; if (d < bd) { bd = d; c.idx = i; } });
    }

    cleanup() {
        this.cars.forEach((c) => c.dispose()); this.cars = []; this.world = null; this.player = null;
        this.sound.stop(); this.fx.clear(); this.hud.show(false); this.hud.setLights(0); this.hud.e.count.textContent = ''; this.hud.e.flash.textContent = ''; this.mode = 'menu';
    }

    toMenu() { this.cleanup(); this.paused = false; show('#menu'); this.showPreview(); }
    restart() { this.cleanup(); this.begin(); }

    pause(v) {
        if (this.mode === 'menu' || this.mode === 'done' || this.paused === v) return;
        this.paused = v; show('#pause', v);
        if (v) { this.sound.stop(); this.sound.c?.suspend(); } else this.sound.c?.resume();
    }

    respawn(c) { const s = this.track.S[c.idx]; c.place({ pos: s.p, yaw: s.yaw }); }

    trackProgress(c) {
        const S = this.track.S, N = S.length, p = c.body.position;
        let b = c.idx, bd = 1e18;
        for (let k = -6; k <= 14; k++) {
            const j = (c.idx + k + N) % N, d = (S[j].p.x - p.x) ** 2 + (S[j].p.z - p.z) ** 2;
            if (d < bd) { bd = d; b = j; }
        }
        if (c.idx > N * 0.75 && b < N * 0.25) { c.lap++; this.lapDone(c); }
        else if (c.idx < N * 0.25 && b > N * 0.75) c.lap--;
        c.idx = b; c.prog = c.lap * N + b;
    }

    lapDone(c) {
        if (c.lap > 1 && c.lap <= LAPS + 1) {
            const t = this.time - c.lapT, best = c.laps.length ? Math.min(...c.laps) : null;
            c.laps.push(t);
            if (c === this.player) { this.sound.chime(); this.hud.flash(`LAP ${c.lap - 1}  ${fmt(t)}${best != null ? `  (${t < best ? '-' : '+'}${Math.abs(t - best).toFixed(2)})` : ''}`, best == null || t < best); }
        }
        c.lapT = this.time;
        if (c.lap > LAPS && !c.finished) {
            c.finished = true; c.finishT = this.time;
            if (c === this.player) { this.mode = 'done'; setTimeout(() => this.results(), 2500); }
        }
    }

    results() {
        if (this.mode !== 'done') return;
        showResult(this.order.map((c) => ({ name: c.name, me: c === this.player, time: c.finished ? c.finishT : null, best: c.laps.length ? Math.min(...c.laps) : null })));
    }

    frame() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        this.track.update(this.clock.elapsedTime);
        if (this.mode === 'menu') this.orbit(dt);
        else {
            if (this.input.take('pause')) this.pause(!this.paused);
            if (!this.paused) this.simulate(dt);
        }
        this.sky.mesh.position.copy(this.cam.position);
        if (this.comp) this.comp.render(); else this.r.render(this.scene, this.cam);
    }

    orbit(dt) {
        const s = this.track.S[0]; this.oa += dt * 0.22;
        this.cam.fov = 48; this.cam.updateProjectionMatrix();
        this.cam.position.set(s.p.x + Math.cos(this.oa) * 6.5, 1.5 + Math.sin(this.oa * 0.7) * 0.4, s.p.z + Math.sin(this.oa) * 6.5);
        this.cam.lookAt(s.p.x, 0.7, s.p.z);
        this.lightAt(s.p);
    }

    lightAt(p) { this.sun.target.position.copy(p); this.sun.position.copy(p).addScaledVector(this.dir, 150); }

    simulate(dt) {
        const inp = this.input, st = store.settings, pl = this.player, pi = inp.read(dt, st.steer, pl.kmh), S = this.track.S;
        if (inp.take('cam')) this.camMode = this.camMode === 'chase' ? 'cockpit' : 'chase';
        if (inp.take('reset') && this.mode === 'race') this.respawn(pl);
        const up = inp.take('up'), down = inp.take('down');

        if (this.mode === 'count') {
            this.cd -= dt;
            const lit = clamp(Math.floor(6 - this.cd), 0, 5);
            if (lit !== this.lit) { this.lit = lit; this.hud.setLights(lit); if (lit > 0) this.sound.beep(380 + lit * 40, 0.14); }
            if (this.cd <= 0) {
                this.mode = 'race'; this.cars.forEach((c) => { c.hold = false; }); this.hud.setLights(0); this.sound.beep(880, 0.5);
                this.hud.e.count.textContent = 'GO'; setTimeout(() => { this.hud.e.count.textContent = ''; }, 900);
            }
        } else this.time += dt;

        // 슬립스트림: 앞차 바로 뒤에서 구동력 보너스
        for (const c of this.cars) {
            c.draft = 0;
            if (c.kmh < 25) continue;
            for (const o of this.cars) {
                if (o === c) continue;
                const dx = o.body.position.x - c.body.position.x, dz = o.body.position.z - c.body.position.z;
                const ahead = dx * c.fwd.x + dz * c.fwd.z, lat = Math.abs(-dx * c.fwd.z + dz * c.fwd.x);
                if (ahead > 3 && ahead < 35 && lat < 2.4) c.draft = Math.max(c.draft, 1 - ahead / 35);
            }
        }

        for (const c of this.cars) {
            let i = IDLE;
            if (this.mode !== 'count') i = c === pl && !c.finished ? { ...pi, auto: st.shift === 'auto', up, down, assist: st.assist } : c.ai.drive(dt);
            c.update(dt, i);
            if (c !== pl && c.ai.stuck > 3) { this.respawn(c); c.ai.stuck = 0; }
            if (c.flipT > 2) { this.respawn(c); c.flipT = 0; }
        }
        this.world.step(1 / 60, dt, 3);

        const cockpit = this.camMode === 'cockpit';
        for (const c of this.cars) {
            this.trackProgress(c);
            const w = resolveWalls(c, this.track);
            if (w > 2.5) c.hit?.(w);
            if (c.scrape > 0.12 && c.kmh > 25 && c.contact && Math.random() < 0.6) this.fx.spark(c.contact[0], c.contact[1], c.body.velocity.x, c.body.velocity.z);
            c.sync(c === pl && cockpit);
            const sk = c.slide > 0.35 && c.kmh > 20, brk = c.braking && c.kmh > 90;
            for (let i = 0; i < 4; i++) {
                const on = (sk && i >= 2) || (brk && c.slide > 0.15) || (sk && i < 2 && c.slide > 0.7);
                this.fx.skid(c, i, on);
                if (on && i >= 2 && Math.random() < 0.35) this.fx.smoke(c.wheels[i].position.x, c.wheels[i].position.z, c.body.velocity.x, c.body.velocity.z);
            }
        }

        const order = this.order = [...this.cars].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishT - b.finishT : b.prog - a.prog));
        const pos = order.indexOf(pl), sp = Math.max(pl.kmh / 3.6, 20), g = (o) => (Math.abs(o.prog - pl.prog) * S.step / sp).toFixed(1);
        const gap = `${order[pos - 1] ? `▲ ${g(order[pos - 1])}s` : ''}${order[pos - 1] && order[pos + 1] ? '   ' : ''}${order[pos + 1] ? `▼ ${g(order[pos + 1])}s` : ''}`;
        const t = S[pl.idx].t, v = pl.body.velocity;
        this.hud.update({ pos: pos + 1, total: this.cars.length, lap: pl.lap, time: this.time, best: pl.laps.length ? Math.min(...pl.laps) : 0, kmh: pl.kmh, gear: pl.gear, reverse: pl.reverse, manual: st.shift === 'manual', rpm: pl.rpm, cars: this.cars, player: pl, gap, wrong: pl.kmh > 12 && v.x * t.x + v.z * t.z < -pl.kmh / 7, draft: pl.draft > 0.15 });
        this.sound.drive({ rpm: pl.rpm, thr: pi.thr, kmh: pl.kmh, slide: pl.slide, scrape: pl.scrape });
        this.updateCamera(dt);
        this.fx.update(dt, this.cam.quaternion);
    }

    updateCamera(dt) {
        const c = this.player, b = c.body, cam = this.cam, back = this.input.back;
        const q = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w), p = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
        const fov = store.settings.fov + clamp(c.kmh - 80, 0, 140) * 0.1;
        if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
        if (this.camMode === 'cockpit') {
            cam.position.copy(p).add(c.model.eye.clone().applyQuaternion(q));
            cam.quaternion.copy(q).multiply(Y90).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -c.steerIn * 0.12 + (back ? Math.PI : 0), 0)));
        } else {
            // 차체 방향과 진행 방향을 섞어 부드럽게 따라가는 추적 카메라
            const ch = this.chase, carYaw = Math.atan2(-c.fwd.z, c.fwd.x), v = b.velocity;
            let ty = carYaw;
            if (Math.hypot(v.x, v.z) > 6) ty += wrap(Math.atan2(-v.z, v.x) - carYaw) * 0.45;
            if (back) ty += Math.PI;
            if (!ch.init) { ch.yaw = ty; ch.init = true; cam.position.copy(p).add(new THREE.Vector3(-Math.cos(ty) * 7, 2.5, Math.sin(ty) * 7)); }
            ch.yaw += wrap(ty - ch.yaw) * (1 - Math.exp(-dt * (back ? 18 : 5)));
            const f = new THREE.Vector3(Math.cos(ch.yaw), 0, -Math.sin(ch.yaw)), target = p.clone().addScaledVector(f, -(6.6 + c.kmh * 0.008));
            target.y += 2.1 + c.kmh * 0.003;
            cam.position.lerp(target, 1 - Math.exp(-dt * 14)); cam.position.y = Math.max(cam.position.y, 0.8);
            cam.lookAt(p.clone().addScaledVector(f, 6).add(new THREE.Vector3(0, 1, 0)));
        }
        this.shake = Math.max(0, this.shake - dt * 2.5);
        const sh = this.shake * 0.5 + (c.kmh > 200 ? (c.kmh - 200) * 0.0008 : 0);
        if (sh) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
        this.lightAt(b.position);
    }
}
