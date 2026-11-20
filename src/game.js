import * as THREE from 'three';
import * as C from 'cannon-es';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { CamRig, CAM_MODES } from './systems/camera.js';
import { store } from './store.js';
import { CARS, TRACKS, AI_LEVELS, QUALITY, LAPS, COLORS, RIM_COLORS, SPOKES, TIMES } from './config.js';
import { buildTrack } from './world/city.js';
import { makeSky } from './world/sky.js';
import { buildCar } from './vehicle/model.js';
import { Car } from './vehicle/car.js';
import { AI, PERSONAS } from './vehicle/ai.js';
import { resolveWalls } from './vehicle/walls.js';
import { Input } from './systems/input.js';
import { Sound } from './systems/audio.js';
import { Fx } from './systems/fx.js';
import { Hud, fmt } from './ui/hud.js';
import { show, showResult } from './ui/ui.js';

const STEP = 1 / 60;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const IDLE = { steer: 0, thr: 0, brk: 0, hand: 0, auto: true };
const LR = new THREE.Vector3(), LU = new THREE.Vector3(), V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), EU = new THREE.Euler();

// 마지막 색 보정: 시간대별 색감(약한 틴트) + 채도·대비 살짝 + 비네트
const GradeShader = {
    uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Vector3(1, 1, 1) }, vig: { value: 0.28 }, sat: { value: 1.08 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: `uniform sampler2D tDiffuse;uniform vec3 tint;uniform float vig,sat;varying vec2 vUv;
void main(){vec4 c=texture2D(tDiffuse,vUv);vec3 col=c.rgb*tint;float l=dot(col,vec3(.299,.587,.114));col=mix(vec3(l),col,sat);
col=(col-.5)*1.04+.5;vec2 d=vUv-.5;col*=1.-vig*smoothstep(.25,.85,dot(d,d)*2.2);gl_FragColor=vec4(clamp(col,0.,1.),c.a);}`,
};

export class Game {
    constructor() {
        // 블룸(후처리)을 쓰는 품질에서는 후처리 렌더 타깃이 MSAA를 하므로, 화면 버퍼의 MSAA는 낭비라 끈다
        this.r = new THREE.WebGLRenderer({ canvas: document.getElementById('gl'), antialias: !QUALITY[store.settings.quality]?.bloom, powerPreference: 'high-performance' });
        this.r.toneMapping = THREE.ACESFilmicToneMapping;
        this.r.shadowMap.type = THREE.PCFSoftShadowMap;
        this.scene = new THREE.Scene();
        this.scene.fog = new THREE.Fog(0x7a587a, 40, 500);
        this.cam = new THREE.PerspectiveCamera(48, 1, 0.1, 1800);
        this.sky = makeSky(store.settings.quality); this.scene.add(this.sky.mesh);
        this.rig = new CamRig(this.cam);
        this.hemi = new THREE.HemisphereLight(); this.scene.add(this.hemi);
        const sun = this.sun = new THREE.DirectionalLight(0xffffff, 1), sc = sun.shadow.camera;
        sc.left = sc.bottom = -95; sc.right = sc.top = 95; sc.near = 1; sc.far = 420;
        sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.06;
        sc.layers.enable(1); // 플레이어 차체(레이어 1)는 1인칭에서 안 보여도 그림자는 만든다
        this.cam.layers.enable(1);
        this.scene.add(sun, sun.target);
        this.pmrem = new THREE.PMREMGenerator(this.r);
        this.fx = new Fx(this.scene);
        // 메뉴에서도 레이스 때와 같은 수의 조명을 둔다 (플레이어 헤드라이트 2개). 조명 수가 바뀌면 모든 셰이더가 다시 컴파일돼 출발 순간 멈춘다
        this.stand = [0, 1].map(() => { const l = new THREE.SpotLight(0xffffff, 0); l.position.set(0, -50, 0); return l; });
        this.scene.add(...this.stand);

        Object.assign(this, { input: new Input(document.getElementById('wheel')), sound: new Sound(), hud: new Hud(), mode: 'menu', cars: [], paused: false, oa: 0, time: 0, acc: 0, timers: new Set(), runId: 0, upP: 0, downP: 0, pin: { auto: true, up: 0, down: 0, assist: 0 }, dyn: { t: 0, n: 0, k: 1, cool: 0, slow: 0, fast: 0, lock: 0, up: -99 }, debugCam: null });
        this.r.info.autoReset = false;
        this.camMode = store.settings.cam;
        this.applySettings();
        addEventListener('resize', () => this.resize());
        document.addEventListener('visibilitychange', () => { if (document.hidden) { this.input.reset(); if (this.mode === 'race' || this.mode === 'count') this.pause(true); } });
        this.setTrack(store.track);
        this.clock = new THREE.Clock();
        this.r.setAnimationLoop(() => this.frame());
    }

    later(fn, ms) { const run = this.runId, id = setTimeout(() => { this.timers.delete(id); if (run === this.runId) fn(); }, ms); this.timers.add(id); }

    applySettings() {
        const s = store.settings, q = this.q = QUALITY[s.quality], had = this.r.shadowMap.enabled;
        this.prMax = Math.min(devicePixelRatio, q.pr); this.pr = this.prMax * this.dyn.k;
        this.r.setPixelRatio(this.pr);
        this.r.shadowMap.enabled = this.sun.castShadow = q.shadow > 0;
        const st = q.shadow >= 4096 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap, stCh = this.r.shadowMap.type !== st; this.r.shadowMap.type = st;
        if (q.shadow) { this.sun.shadow.mapSize.set(q.shadow, q.shadow); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
        if (had !== q.shadow > 0 || stCh) this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
        this.updateFar();
        this.sound.volume(s.master, s.engine);
        this.input.mouseSteer = !!s.mouse;
        document.body.classList.toggle('touch', s.touch === 'on' || (s.touch === 'auto' && matchMedia('(pointer:coarse)').matches));
        if (this.qId !== s.quality) {
            this.qId = s.quality;
            if (this.comp) { this.comp.renderTarget1.dispose(); this.comp.renderTarget2.dispose(); }
            if (q.bloom) {
                const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: q.msaa });
                this.comp = new EffectComposer(this.r, rt);
                this.comp.addPass(new RenderPass(this.scene, this.cam));
                this.comp.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.55, 0.95));
                this.comp.addPass(new OutputPass());
                this.grade = new ShaderPass(GradeShader); this.comp.addPass(this.grade); this.applyGrade();
            } else this.comp = null;
        }
        if (this.timeId !== s.time) this.applyTime(s.time);
        if (this.mode === 'menu' && this.track && this.density !== q.trees) this.setTrack(store.track);
        this.resize();
        if (this.track) this.needWarm = true;
    }

    // 안개가 다 덮는 거리 너머는 아예 그리지 않는다 (카메라 far = 안개 끝). 하늘 구도 그 안에 들어오게 크기를 맞춘다
    updateFar() {
        const f = this.q.fog * (this.track?.def.theme === 'coast' ? 1.35 : 1);
        this.scene.fog.far = f; this.cam.far = f * 1.08 + 40; this.cam.updateProjectionMatrix();
        this.sky.mesh.scale.setScalar(Math.min(1, (this.cam.far * 0.92) / 1000));
    }

    applyGrade() { const t = this.tm; if (this.grade && t) { this.grade.uniforms.tint.value.set(...t.grade); this.grade.uniforms.vig.value = t.stars ? 0.36 : 0.26; } }

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
        this.applyGrade();
        this.needWarm = true;
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
        this.updateFar();
        this.track.setTime(this.tm);
        this.scene.add(this.track.group);
        this.hud.setMap(this.track.S);
        if (this.mode === 'menu') this.showPreview();
        this.needWarm = true;
    }

    // 예열: 화면 밖 물체까지 한 번 전부 그려서 셰이더 컴파일과 GPU 업로드를 미리 끝낸다.
    // 이걸 안 하면 주행 중 처음 보이는 건물·소품이 그 순간 업로드/컴파일되며 화면이 순간 멈춘다
    warm() {
        if (!this.track) return;
        const off = [], mask = this.cam.layers.mask; this.cam.layers.enableAll();
        this.scene.traverse((o) => { if (o.frustumCulled && (o.isMesh || o.isPoints || o.isLine)) { o.frustumCulled = false; off.push(o); } });
        try { if (this.comp) this.comp.render(); else this.r.render(this.scene, this.cam); }
        finally { off.forEach((o) => { o.frustumCulled = true; }); this.cam.layers.mask = mask; }
        this.dyn.t = 0; this.dyn.n = 0; this.clock?.getDelta();
    }

    showPreview() {
        if (this.prev) { this.scene.remove(this.prev.group); this.prev.dispose(); }
        const m = this.prev = buildCar(store.look), s = this.track.S[0];
        m.wheels.forEach((w, i) => { w.position.copy(m.wheelPts[i]); m.group.add(w); });
        m.brake(false);
        m.group.position.set(s.p.x, 0.61, s.p.z); m.group.rotation.y = s.yaw;
        this.scene.add(m.group);
    }

    clearPreview() { if (this.prev) { this.scene.remove(this.prev.group); this.prev.dispose(); this.prev = null; } }

    begin() {
        this.clearTimers(); this.runId++;
        this.sound.init(); this.sound.volume(store.settings.master, store.settings.engine);
        show('#menu', false); show('#gfxTip', false); this.hud.show(true);
        this.clearPreview();
        const w = this.world = new C.World({ gravity: new C.Vec3(0, -9.82, 0) });
        w.defaultContactMaterial.friction = 0.08; w.defaultContactMaterial.restitution = 0.12; // 차끼리 비벼도 서로 들어 올리지 않게 낮은 마찰
        this.track.addPhysics(w);

        const L = store.look, ps = CARS.find((c) => c.id === L.car), lv = this.level = AI_LEVELS[store.ai], rnd = Math.random;
        const personas = [...PERSONAS].sort(() => rnd() - 0.5), colors = COLORS.filter((c) => c !== L.color);
        let a = 0, ferrari = 0;
        this.cars = [0, 1, 2, 3, 4, 5].map((k) => {
            const pose = this.track.grid(k);
            let car, persona;
            if (k === 3) { car = new Car(w, this.scene, ps, L, pose, { cockpit: true, lights: true }); car.name = '나'; car.snd = ps.snd; this.player = car; persona = PERSONAS[4]; }
            else {
                // AI 차량은 매번 무작위로 고른다 (무거운 Ferrari 모델은 최대 1대)
                let pick; do { pick = CARS[Math.floor(rnd() * CARS.length)]; } while (pick.id === 'f458' && ferrari >= 1);
                if (pick.id === 'f458') ferrari++;
                persona = personas[a];
                const look = { car: pick.id, color: colors[Math.floor(rnd() * colors.length)], rim: RIM_COLORS[Math.floor(rnd() * RIM_COLORS.length)], wheel: 0.36, spokes: SPOKES[Math.floor(rnd() * 3)] };
                const spec = { ...ps, hx: pick.hx, hz: pick.hz, ox: pick.ox, power: ps.power * (0.97 + rnd() * 0.06) };
                car = new Car(w, this.scene, spec, look, pose, { lod: true }); car.name = `AI ${a + 1}`; car.tag = persona.name; car.snd = pick.snd; a++;
                if (this.q.shadow < 2048) { car.mesh.traverse((o) => { o.castShadow = false; }); car.wheels.forEach((x) => x.traverse((o) => { o.castShadow = false; })); }
            }
            this.initIdx(car);
            car.ai = new AI(car, this.track.S, k === 3 ? AI_LEVELS[1] : lv, persona, rnd() * 6, this.track.limit);
            car.startAt = k === 3 ? 0 : car.ai.react;
            car.hit = (v) => { if (car === this.player) { this.sound.hit(v); this.rig.shake = Math.min(1, v / 18); } };
            return car;
        });
        this.player.onShift = (up, thr) => this.sound.shift(up, thr);
        this.sound.setProfile(ps.snd);
        this.player.lights.forEach((l) => { l.intensity = this.tm.head; });
        this.scene.remove(...this.stand);
        this.needWarm = true;
        // 5개 신호등이 1초 간격으로 켜진 뒤, 무작위 시간(0.4~1.4초) 후 꺼지면 출발
        Object.assign(this, { stuckT: 0, mode: 'count', cdT: 0, goAt: 5 + 0.4 + rnd(), time: 0, lit: -1, paused: false, acc: 0, camMode: store.settings.cam, order: this.cars });
        this.cam.fov = store.settings.fov; this.cam.near = this.rig.near(this.camMode); this.cam.updateProjectionMatrix();
        this.rig.reset(); this.rig.fov = store.settings.fov; this.input.reset(); this.hud.clear();
    }

    go() {
        this.mode = 'race'; this.time = 0; this.player.hold = false;
        this.hud.setLights(0); this.sound.beep(880, 0.5); this.hud.e.count.textContent = 'GO';
        this.later(() => { this.hud.e.count.textContent = ''; }, 900);
    }

    initIdx(c) {
        const S = this.track.S, p = c.body.position; let bd = 1e18;
        S.forEach((s, i) => { const d = (s.p.x - p.x) ** 2 + (s.p.z - p.z) ** 2; if (d < bd) { bd = d; c.idx = i; } });
    }

    clearTimers() { this.timers.forEach(clearTimeout); this.timers.clear(); }

    cleanup() {
        this.clearTimers(); this.runId++;
        this.cars.forEach((c) => c.dispose()); this.cars = []; this.scene.add(...this.stand); this.world = null; this.player = null;
        this.sound.stop(); this.fx.clear(); this.hud.show(false); this.hud.clear(); this.input.reset(); this.mode = 'menu';
    }

    toMenu() {
        this.cleanup(); this.paused = false; show('#menu');
        this.cam.fov = 48; this.cam.near = 0.1; this.cam.updateProjectionMatrix(); this.cam.up.set(0, 1, 0);
        this.showPreview();
    }
    restart() { this.cleanup(); this.begin(); }

    pause(v) {
        if (this.mode === 'menu' || this.mode === 'done' || this.paused === v) return;
        this.paused = v; show('#pause', v); this.input.reset();
        if (v) { this.sound.stop(); this.sound.c?.suspend(); } else this.sound.c?.resume();
    }

    // 복귀: 다른 차와 겹치지 않는 자리(좌우)를 골라 내려놓고, 잠시 다른 차와 충돌하지 않게 한다
    respawn(c) {
        const S = this.track.S, s = S[c.idx];
        let best = 0, bd = -1;
        for (const o of [0, -4.5, 4.5, -2.5, 2.5, -6, 6]) {
            const x = s.p.x + s.n.x * o, z = s.p.z + s.n.z * o;
            let d = 1e9; for (const q of this.cars) if (q !== c) d = Math.min(d, Math.hypot(q.body.position.x - x, q.body.position.z - z));
            if (d > bd + 0.5) { bd = d; best = o; }
            if (d > 9) break;
        }
        c.place({ pos: s.p.clone().addScaledVector(s.n, best), yaw: s.yaw }); c.ghost = 2.5;
        if (c.ai) { c.ai.stuck = 0; c.ai.rec = null; c.ai.slow = 0; }
        if (c === this.player) { this.rig.init = false; this.stuckT = 0; }
    }

    trackProgress(c) {
        const S = this.track.S, N = S.length, p = c.body.position;
        let b = c.idx, bd = 1e18;
        for (let k = -6; k <= 14; k++) {
            const j = (c.idx + k + N) % N, d = (S[j].p.x - p.x) ** 2 + (S[j].p.z - p.z) ** 2;
            if (d < bd) { bd = d; b = j; }
        }
        // 랩은 새로운 최대 진행도를 넘을 때만 인정한다 (역주행 후 재통과로 중복 집계되지 않음)
        if (c.idx > N * 0.75 && b < N * 0.25) { c.lap++; if (c.lap > c.maxLap) { c.maxLap = c.lap; this.lapDone(c); } }
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
            if (c === this.player) { this.mode = 'done'; this.later(() => this.results(), 2500); }
        }
    }

    results() {
        if (this.mode !== 'done') return;
        showResult(this.order.map((c) => ({ name: c.name, tag: c.tag, me: c === this.player, time: c.finished ? c.finishT : null, best: c.laps.length ? Math.min(...c.laps) : null, lap: Math.min(Math.max(c.lap, 1), LAPS) })), this.level.name);
    }

    frame() {
        if (this.needWarm) { this.needWarm = false; this.warm(); }
        const raw = this.clock.getDelta(), dt = Math.min(raw, 0.05);
        this.r.info.reset();
        this.track.update(this.clock.elapsedTime); this.sky.update(this.clock.elapsedTime);
        this.dynRes(raw);
        if (this.debugCam) { const [x, y, z, lx, ly, lz] = this.debugCam; this.cam.position.set(x, y, z); this.cam.lookAt(lx, ly, lz); this.lightAt(this.cam.position); }
        else if (this.mode === 'menu') this.orbit(dt);
        else {
            if (this.input.take('pause')) this.pause(!this.paused);
            if (!this.paused) this.simulate(dt);
        }
        this.sky.mesh.position.copy(this.cam.position);
        // 1인칭(뒤 보기 제외): 바깥 차체(레이어 1) 대신 실내(레이어 2)를 그린다
        const inside = this.mode !== 'menu' && !this.debugCam && this.camMode === 'cockpit' && !this.input.back;
        this.cam.layers.mask = 1 | (inside ? 4 : 2);
        document.body.classList.toggle('cockpit', inside);
        if (this.comp) this.comp.render(); else this.r.render(this.scene, this.cam);
    }

    // 동적 해상도: 프레임이 '계속' 느릴 때만 렌더 해상도를 낮추고, 오래 여유가 있을 때만 올린다.
    // 해상도를 바꾸면 렌더 타깃을 다시 만들어 한 프레임 멈추므로, 자주 오르내리지 않게 여유를 크게 둔다
    dynRes(raw) {
        const d = this.dyn; d.t += Math.min(raw, 0.05); d.n++; d.cool = Math.max(0, d.cool - raw); d.lock = Math.max(0, d.lock - raw);
        if (d.t < 2) return;
        const ms = (d.t / d.n) * 1000; d.t = 0; d.n = 0;
        if (document.hidden || this.paused || this.mode === 'menu') { d.slow = d.fast = 0; return; }
        d.slow = ms > 22 ? d.slow + 1 : 0; d.fast = ms < 13 ? d.fast + 1 : 0;
        if (d.cool > 0) return;
        let k = d.k;
        if (d.slow >= 2) { k = Math.max(0.6, k - 0.15); if (this.time - d.up < 10) d.lock = 60; } // 올리자마자 느려졌다면 한동안 다시 올리지 않는다
        else if (d.fast >= 4 && k < 1 && !d.lock) { k = Math.min(1, k + 0.1); d.up = this.time; }
        if (k !== d.k) { d.k = k; d.cool = 4; d.slow = d.fast = 0; this.pr = this.prMax * k; this.r.setPixelRatio(this.pr); this.resize(); }
    }

    orbit(dt) {
        const s = this.track.S[0]; this.oa += dt * 0.22;
        this.cam.position.set(s.p.x + Math.cos(this.oa) * 6.5, 1.5 + Math.sin(this.oa * 0.7) * 0.4, s.p.z + Math.sin(this.oa) * 6.5);
        this.cam.lookAt(s.p.x, 0.7, s.p.z);
        this.lightAt(s.p);
    }

    // 그림자 카메라를 그림자 맵 텍셀 단위로 맞춰 이동시킨다. 차가 움직여도 그림자 가장자리가 지글거리거나 선이 깜빡이지 않는다
    lightAt(p) {
        const d = this.dir, size = this.sun.shadow.mapSize.x || 2048, tx = 190 / size;
        LR.set(d.z, 0, -d.x).normalize(); LU.crossVectors(d, LR).normalize();
        const a = Math.round((p.x * LR.x + p.z * LR.z) / tx) * tx, b = Math.round((p.x * LU.x + p.z * LU.z) / tx) * tx, c = p.x * d.x + p.z * d.z;
        V.copy(LR).multiplyScalar(a).addScaledVector(LU, b).addScaledVector(d, c);
        this.sun.target.position.copy(V); this.sun.position.copy(V).addScaledVector(d, 150);
    }

    // 완주한 플레이어: 코스를 따라 직진하며 서서히 정지
    coast(c) {
        const a = c.ai.drive(STEP, this.cars);
        return { steer: a.steer, thr: 0, brk: c.kmh > 6 ? 0.55 : 1, hand: 0, auto: true };
    }

    step(pi, st) {
        const pl = this.player, S = this.track.S;
        if (this.mode === 'count') { this.cdT += STEP; if (this.cdT >= this.goAt) this.go(); } else this.time += STEP;

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

        // 뒤처진 AI는 난이도에 따라 살짝 힘을 내고(쉬움은 너무 앞선 경우 조금 늦춤), 프로는 보정 없음
        const rb = this.level.rb;
        for (const c of this.cars) if (c !== pl) {
            const gap = (pl.prog - c.prog) * S.step;
            c.ai.boost = 1 + rb * (Math.min(0.04, Math.max(0, gap - 60) / 900) - Math.min(0.035, Math.max(0, -gap - 150) / 900));
        }
        if (this.mode === 'race' && !pl.finished) {
            this.stuckT = pl.kmh < 4 && (pi.thr > 0.4 || pi.brk > 0.4) && !pl.righting ? this.stuckT + STEP : 0;
            if (this.stuckT > 3) { this.stuckT = -6; this.hud.flash('막혔다면 R 키(모바일: 복귀)로 코스에 복귀하세요', false); }
        }

        for (const c of this.cars) {
            let i = IDLE;
            if (c === pl) {
                if (pl.finished) i = this.coast(pl);
                else { Object.assign(this.pin, pi, { auto: st.shift === 'auto', up: this.upP, down: this.downP, assist: st.assist }); this.upP = this.downP = 0; i = this.pin; }
            } else if (this.mode !== 'count' && !c.hold) i = c.ai.drive(STEP, this.cars);
            if (this.mode !== 'count' && c.hold && this.time >= c.startAt) c.hold = false;
            const wasR = c.righting;
            c.update(STEP, i);
            if (c === pl && !wasR && c.righting) this.hud.flash('차량을 바로 세우는 중…', false);
            if (c !== pl && c.ai.stuck > 4.5) this.respawn(c);
        }
        for (const c of this.cars) c.snap();
        this.world.step(STEP);
        for (const c of this.cars) {
            c.capture(); this.trackProgress(c);
            const w = resolveWalls(c, this.track);
            if (w > 2.5) c.hit?.(w);
            if (c.scrape > 0.12 && c.kmh > 25 && c.contact && Math.random() < 0.6) this.fx.spark(c.contact[0], c.contact[1], c.body.velocity.x, c.body.velocity.z);
        }
    }

    simulate(dt) {
        const inp = this.input, st = store.settings, pl = this.player, pi = inp.read(dt, st.steer, pl.kmh), S = this.track.S;
        if (inp.take('cam')) { this.camMode = CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length]; this.cam.near = this.rig.near(this.camMode); this.cam.updateProjectionMatrix(); this.rig.init = false; this.hud.flash(`시점: ${{ chase: '3인칭', far: '3인칭 (멀리)', hood: '보닛', cockpit: '1인칭' }[this.camMode]}`, false); }
        if (inp.take('reset') && this.mode === 'race') this.respawn(pl);
        this.upP ||= inp.take('up') || 0; this.downP ||= inp.take('down') || 0;

        // 고정 스텝 물리 + 렌더 보간: 프레임레이트와 무관하게 같은 속도로 움직이고 떨림이 없다
        this.acc += dt;
        for (let n = 0; this.acc >= STEP && n < 4; n++, this.acc -= STEP) this.step(pi, st);
        if (this.acc > STEP) this.acc = 0;
        const alpha = this.acc / STEP, cockpit = this.camMode === 'cockpit';

        for (const c of this.cars) {
            c.render(alpha, c === pl && cockpit);
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
        if (this.mode === 'count') {
            const lit = clamp(Math.floor(this.cdT), 0, 5);
            if (lit !== this.lit) { this.lit = lit; this.hud.setLights(lit); if (lit > 0) this.sound.beep(380 + lit * 40, 0.14); }
        }
        this.hud.update({ pos: pos + 1, total: this.cars.length, lap: pl.lap, time: this.mode === 'count' ? 0 : this.time, best: pl.laps.length ? Math.min(...pl.laps) : 0, kmh: pl.kmh, gear: pl.gear, reverse: pl.reverse, manual: st.shift === 'manual', rpm: pl.rpm, cars: this.cars, player: pl, gap, wrong: this.mode === 'race' && pl.kmh > 12 && v.x * t.x + v.z * t.z < -pl.kmh / 7, draft: pl.draft > 0.15 });
        // 가까운 AI 차량 엔진음: 거리 감쇠 + 좌우 패닝 + 도플러
        const cam = this.cam, cr = V.set(1, 0, 0).applyQuaternion(cam.quaternion), near = [];
        for (const c of this.cars) {
            if (c === pl) continue;
            const dx = c.body.position.x - cam.position.x, dz = c.body.position.z - cam.position.z, d = Math.hypot(dx, dz);
            if (d > 90) continue;
            const ux = dx / (d || 1), uz = dz / (d || 1), vrel = -((c.body.velocity.x - pl.body.velocity.x) * ux + (c.body.velocity.z - pl.body.velocity.z) * uz);
            near.push({ rpm: c.rpm, thr: c.lastThr || 0, dist: d, pan: ux * cr.x + uz * cr.z, snd: c.snd, vrel });
        }
        near.sort((a, b) => a.dist - b.dist);
        this.sound.drive({ rpm: pl.rpm, thr: pi.thr, kmh: pl.kmh, slide: pl.slide, scrape: pl.scrape, inside: this.camMode === 'hood' || this.camMode === 'cockpit', ground: pl.contacts > 2 }, near);
        this.updateCamera(dt);
        this.fx.update(dt, this.cam.quaternion);
    }

    updateCamera(dt) {
        const c = this.player;
        this.rig.update(dt, c, this.camMode, this.input.back, store.settings.fov);
        this.lightAt(this.rig.focus);
    }
}
