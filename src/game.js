import * as THREE from 'three';
import * as C from 'cannon-es';
import { store } from './store.js';
import { CARS, TRACKS, AI_LEVELS, QUALITY, LAPS, COLORS, SPOKES } from './config.js';
import { buildTrack } from './world/city.js';
import { buildCar } from './vehicle/model.js';
import { Car } from './vehicle/car.js';
import { AI } from './vehicle/ai.js';
import { Input } from './systems/input.js';
import { Sound } from './systems/audio.js';
import { Hud } from './ui/hud.js';
import { show, showResult } from './ui/ui.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const IDLE = { steer: 0, thr: 0, brk: 0, hand: 0, auto: true };
const Y90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);

export class Game {
    constructor() {
        this.r = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: true, powerPreference: 'high-performance' });
        this.r.toneMapping = THREE.ACESFilmicToneMapping;
        this.r.shadowMap.type = THREE.PCFSoftShadowMap;
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x3a3358);
        this.scene.fog = new THREE.Fog(0x3a3358, 40, 500);
        this.cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);

        this.scene.add(new THREE.HemisphereLight(0x9a9cd8, 0x2c2430, 1.1));
        const sun = this.sun = new THREE.DirectionalLight(0xffb067, 2.6), sc = sun.shadow.camera;
        sc.left = sc.bottom = -80; sc.right = sc.top = 80; sc.near = 1; sc.far = 400;
        sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
        this.scene.add(sun, sun.target);

        Object.assign(this, { input: new Input(document.getElementById('wheel')), sound: new Sound(), hud: new Hud(), mode: 'menu', cars: [], paused: false, shake: 0, oa: 0 });
        this.camMode = store.settings.cam;
        this.applySettings();
        addEventListener('resize', () => this.resize());
        this.setTrack(store.track);
        this.clock = new THREE.Clock();
        this.r.setAnimationLoop(() => this.frame());
    }

    applySettings() {
        const s = store.settings, q = QUALITY[s.quality], hadShadow = this.r.shadowMap.enabled;
        this.r.setPixelRatio(Math.min(devicePixelRatio, q.pr));
        this.r.shadowMap.enabled = this.sun.castShadow = q.shadow > 0;
        if (q.shadow) { this.sun.shadow.mapSize.set(q.shadow, q.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
        if (hadShadow !== q.shadow > 0) this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
        this.scene.fog.far = q.fog;
        this.sound.volume(s.master, s.engine);
        this.input.mouseSteer = !!s.mouse;
        document.body.classList.toggle('touch', s.touch === 'on' || (s.touch === 'auto' && matchMedia('(pointer:coarse)').matches));
        this.resize();
    }

    resize() {
        this.r.setSize(innerWidth, innerHeight, false);
        this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix();
    }

    setTrack(id) {
        store.track = id;
        if (this.track) { this.scene.remove(this.track.group); this.track.dispose(); }
        this.track = buildTrack(TRACKS.find((t) => t.id === id));
        this.scene.add(this.track.group);
        this.hud.setMap(this.track.S);
        if (this.mode === 'menu') this.showPreview();
    }

    showPreview() {
        if (this.prev) this.scene.remove(this.prev);
        const look = store.look, m = buildCar(look), r = look.wheel, s = this.track.S[0];
        [[1.35, 0.88], [1.35, -0.88], [-1.3, 0.88], [-1.3, -0.88]].forEach(([x, z], i) => { m.wheels[i].position.set(x, r - 0.61, z); m.group.add(m.wheels[i]); });
        m.group.position.set(s.p.x, 0.61, s.p.z); m.group.rotation.y = s.yaw;
        this.prev = m.group; this.scene.add(m.group);
    }

    begin() {
        this.sound.init(); this.sound.volume(store.settings.master, store.settings.engine);
        show('#menu', false); show('#gfxTip', false); this.hud.show(true);
        if (this.prev) { this.scene.remove(this.prev); this.prev = null; }
        const w = this.world = new C.World({ gravity: new C.Vec3(0, -9.82, 0) });
        w.broadphase = new C.SAPBroadphase(w);
        w.defaultContactMaterial.friction = 0.15; w.defaultContactMaterial.restitution = 0.1;
        this.track.addPhysics(w);

        const L = store.look, lv = AI_LEVELS[store.ai], rnd = () => Math.random();
        let a = 0;
        this.cars = [0, 1, 2, 3, 4, 5].map((k) => {
            const pose = this.track.grid(k);
            let car;
            if (k === 3) { car = new Car(w, this.scene, CARS.find((c) => c.id === L.car), L, pose, true); car.name = '나'; this.player = car; }
            else {
                const sp = CARS[(a + k) % 3], look = { car: sp.id, color: COLORS[(a + 2) % COLORS.length], rim: '#d9dde6', wheel: 0.36, spokes: SPOKES[a % 3] };
                car = new Car(w, this.scene, sp, look, pose); car.name = `AI ${a + 1}`; a++;
            }
            car.ai = new AI(car, this.track.S, k === 3 ? 0.7 : lv.skill * (0.96 + rnd() * 0.08), k === 3 ? 0 : [-3.5, 3.5, -1.5, 1.5, 0][a - 1], rnd() * 6);
            car.hit = (v) => { if (car === this.player) { this.sound.hit(v); this.shake = Math.min(1, v / 18); } };
            this.initIdx(car);
            return car;
        });
        Object.assign(this, { mode: 'count', cd: 3.4, time: 0, tick: 4, paused: false, camMode: store.settings.cam, order: this.cars, safeT: 0 });
        this.input.pulse = {};
    }

    initIdx(c) {
        const S = this.track.S, p = c.body.position; let bd = 1e18;
        S.forEach((s, i) => { const d = (s.p.x - p.x) ** 2 + (s.p.z - p.z) ** 2; if (d < bd) { bd = d; c.idx = i; } });
    }

    cleanup() {
        this.cars.forEach((c) => c.dispose()); this.cars = []; this.world = null; this.player = null;
        this.sound.stop(); this.hud.show(false); this.hud.e.count.textContent = ''; this.mode = 'menu';
    }

    toMenu() { this.cleanup(); this.paused = false; show('#menu'); this.showPreview(); }
    restart() { this.cleanup(); this.begin(); }

    pause(v) {
        if (this.mode === 'menu' || this.mode === 'done') return;
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
        if (c.lap > 1 && c.lap <= LAPS + 1) c.laps.push(this.time - c.lapT);
        c.lapT = this.time;
        if (c.lap > LAPS && !c.finished) {
            c.finished = true; c.finishT = this.time;
            if (c === this.player) { this.mode = 'done'; setTimeout(() => this.results(), 2500); }
        }
    }

    results() {
        if (this.mode !== 'done') return;
        showResult(this.order.map((c) => ({ name: c.name, me: c === this.player, time: c.finished ? c.finishT : null })));
    }

    frame() {
        const dt = Math.min(this.clock.getDelta(), 0.05);
        if (this.mode === 'menu') this.orbit(dt);
        else {
            if (this.input.take('pause')) this.pause(!this.paused);
            if (!this.paused) this.simulate(dt);
        }
        this.r.render(this.scene, this.cam);
    }

    orbit(dt) {
        const s = this.track.S[0]; this.oa += dt * 0.22;
        this.cam.fov = 48; this.cam.updateProjectionMatrix();
        this.cam.position.set(s.p.x + Math.cos(this.oa) * 6.5, 1.5 + Math.sin(this.oa * 0.7) * 0.4, s.p.z + Math.sin(this.oa) * 6.5);
        this.cam.lookAt(s.p.x, 0.7, s.p.z);
        this.lightAt(s.p);
    }

    lightAt(p) { this.sun.target.position.copy(p); this.sun.position.set(p.x - 90, p.y + 55, p.z - 100); }

    simulate(dt) {
        const inp = this.input, st = store.settings, pl = this.player, pi = inp.read(dt, st.steer);
        if (inp.take('cam')) this.camMode = this.camMode === 'chase' ? 'cockpit' : 'chase';
        if (inp.take('reset') && this.mode === 'race') this.respawn(pl);
        const up = inp.take('up'), down = inp.take('down');

        if (this.mode === 'count') {
            this.cd -= dt;
            const n = Math.ceil(this.cd);
            if (n !== this.tick && n > 0) { this.tick = n; this.sound.beep(440); this.hud.e.count.textContent = n; }
            if (this.cd <= 0) {
                this.mode = 'race'; this.cars.forEach((c) => { c.hold = false; }); this.sound.beep(880, 0.5);
                this.hud.e.count.textContent = 'GO'; setTimeout(() => { this.hud.e.count.textContent = ''; }, 900);
            }
        } else this.time += dt;

        for (const c of this.cars) {
            let i = IDLE;
            if (this.mode !== 'count') {
                if (c === pl && !c.finished) i = { ...pi, auto: st.shift === 'auto', up, down };
                else i = c.ai.drive(dt);
            }
            c.update(dt, i);
            if (c !== pl && c.ai.stuck > 3) { this.respawn(c); c.ai.stuck = 0; }
            if (c.flipT > 2) { this.respawn(c); c.flipT = 0; }
        }
        this.world.step(1 / 60, dt, 3);
        for (const c of this.cars) { c.sync(); this.trackProgress(c); }

        this.order = [...this.cars].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishT - b.finishT : b.prog - a.prog));
        this.hud.update({ pos: this.order.indexOf(pl) + 1, total: this.cars.length, lap: pl.lap, time: this.time, best: pl.laps.length ? Math.min(...pl.laps) : 0, kmh: pl.kmh, gear: pl.gear, reverse: pl.reverse, manual: st.shift === 'manual', rpm: pl.rpm, cars: this.cars, player: pl });
        this.sound.engine(pl.rpm, pi.thr); this.sound.skid(pl.slide);
        this.updateCamera(dt);
    }

    updateCamera(dt) {
        const c = this.player, b = c.body, cam = this.cam, q = new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        const fwd = new THREE.Vector3(c.fwd.x, 0, c.fwd.z).normalize(), p = new THREE.Vector3(b.position.x, b.position.y, b.position.z);
        const fov = store.settings.fov + clamp(c.kmh - 80, 0, 140) * 0.1;
        if (Math.abs(cam.fov - fov) > 0.05) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
        if (this.camMode === 'cockpit') {
            cam.position.copy(p.add(new THREE.Vector3(-0.05, 0.4, -0.42).applyQuaternion(q)));
            cam.quaternion.copy(q.multiply(Y90));
        } else {
            const target = p.clone().addScaledVector(fwd, -7.2).add(new THREE.Vector3(0, 2.7, 0));
            cam.position.lerp(target, 1 - Math.exp(-dt * 6)); cam.position.y = Math.max(cam.position.y, 0.8);
            cam.lookAt(p.addScaledVector(fwd, 5).add(new THREE.Vector3(0, 1, 0)));
        }
        this.shake = Math.max(0, this.shake - dt * 2.5);
        if (this.shake) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake * 0.5, (Math.random() - 0.5) * this.shake * 0.5, (Math.random() - 0.5) * this.shake * 0.5));
        this.lightAt(b.position);
    }
}
