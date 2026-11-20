import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeStatic } from '../util/merge.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CARS } from '../config.js';
import { buildDesign } from './procedural.js';
import { makeCockpit, BODY_LAYER } from './cockpit.js';
import ferrariHero from '../../assets/ferrari-458.glb';
import ferrariLod from '../../assets/ferrari-458-lod.glb';
import conceptHero from '../../assets/concept.glb';
import conceptLod from '../../assets/concept-lod.glb';

const MODELS = {};
const bytes = (b64) => { const t = atob(b64), u = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) u[i] = t.charCodeAt(i); return u; };

// glb는 번들에 포함되어 있어 file:// 로 열어도 로드된다
export async function loadModels() {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const parse = (b64) => new Promise((ok, no) => loader.parse(bytes(b64).buffer, '', (g) => ok(g.scene), no));
    const [fh, fl, ch, cl] = await Promise.all([parse(ferrariHero), parse(ferrariLod), parse(conceptHero), parse(conceptLod)]);
    MODELS.ferrari = { hero: fh, lod: fl }; MODELS.concept = { hero: ch, lod: cl };
}

// 모델 좌표계를 차량 좌표계(전방 +x, 오른쪽 +z)로 맞추기 위한 정보
const GLTF_SPECS = {
    ferrari: {
        wheels: ['wheel_fr', 'wheel_fl', 'wheel_rr', 'wheel_rl'], rot: -Math.PI / 2, off: [0.195, -0.61, 0], wr: 0.358,
        isRim: (n) => n.name.startsWith('rim_'), isPaint: (m) => m.name === 'Body_Color', glass: 'Glass_Gray', head: 'Projector_Glass', tail: 'Taillight_Glass',
        eye: [0.03, 0.46, -0.346], wheelC: [0.581, 0.19, -0.346],
    },
    concept: {
        wheels: ['WheelFrontR', 'WheelFrontL', 'WheelRearR', 'WheelRearL'], rot: Math.PI / 2, off: [-0.09, -0.61, 0], wr: 0.385,
        isRim: (n) => /Rim$/.test(n.name), isPaint: (m) => m.name.startsWith('Paint 1'), glass: 'Glass', head: 'Headlight', tail: 'Brakelight',
        eye: [0.3, 0.36, 0], wheelC: [0.84, 0.04, 0],
    },
};

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...o });
const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z); mesh.castShadow = true; return mesh;
};

function buildGltf(key, look, o) {
    const sp = GLTF_SPECS[key], cache = new Map(), own = [];
    const mine = (m) => { own.push(m); return m; };
    const copy = (m) => {
        if (cache.has(m)) return cache.get(m);
        let c;
        if (sp.isPaint(m)) {
            c = m.clone(); c.color.set(look.color);
            if (c.isMeshPhysicalMaterial) { c.clearcoat = 1; c.clearcoatRoughness = 0.05; } else c = new THREE.MeshPhysicalMaterial({ color: look.color, metalness: 0.55, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05 });
            c.envMapIntensity = 1.3;
        } else { c = m.clone(); c.envMapIntensity = 0.9; }
        if (m.name === sp.glass) Object.assign(c, { color: new THREE.Color(0x0a0f18), transparent: true, opacity: 0.4, metalness: 0.9, roughness: 0.04, depthWrite: false });
        if (m.name === sp.head) Object.assign(c, { emissive: new THREE.Color(0xfff1d0), emissiveIntensity: 0.6 });
        cache.set(m, mine(c)); return c;
    };
    const root = (o.lod ? MODELS[key].lod : MODELS[key].hero).clone(true);
    root.traverse((n) => {
        if (!n.isMesh) return;
        n.material = sp.isRim(n) ? mine(new THREE.MeshStandardMaterial({ color: look.rim, metalness: 0.9, roughness: 0.22, envMapIntensity: 1.2 })) : copy(n.material);
        n.castShadow = true;
    });
    const align = new THREE.Group(); align.rotation.y = sp.rot; align.position.set(...sp.off); align.add(root); align.updateMatrixWorld(true);
    const pts = [], wheels = [];
    for (const nm of sp.wheels) {
        const w = root.getObjectByName(nm), c = new THREE.Vector3(); w.getWorldPosition(c);
        const h = new THREE.Group(); h.position.copy(c); h.updateMatrixWorld(true); h.attach(w); h.scale.setScalar(look.wheel / sp.wr);
        pts.push(c); wheels.push(h);
    }
    const g = new THREE.Group(); g.add(align);
    const tailM = [...cache.keys()].map((k) => cache.get(k)).find((m, i) => [...cache.keys()][i].name === sp.tail);
    return {
        group: g, wheels, wheelPts: pts, lights: [], dispose: () => own.forEach((m) => m.dispose()),
        brake: (on) => { if (tailM) { tailM.emissive.set(0xff1010); tailM.emissiveIntensity = on ? 2.2 : 0.3; } },
        eye: new THREE.Vector3(...sp.eye), wheelC: new THREE.Vector3(...sp.wheelC),
    };
}

export function buildCar(look, o = {}) {
    const spec = CARS.find((c) => c.id === look.car);
    // 3D 모델 차량은 glb, 나머지는 코드로 만든 차체. 모델 로드에 실패해도 코드 차체로 대신한다
    const m = spec?.model && MODELS[spec.model] ? buildGltf(spec.model, look, o) : buildDesign(spec?.design || 'ing', look, o);
    // 차체·바퀴의 고정 부품을 머티리얼별로 합쳐 차 한 대의 드로우콜을 크게 줄인다
    const made = [...mergeStatic(m.group), ...m.wheels.flatMap((w) => mergeStatic(w))];
    const d = m.dispose; m.dispose = () => { d(); made.forEach((g) => g.dispose()); };
    if (o.lights) for (const z of [-0.62, 0.62]) {
        const s = new THREE.SpotLight(0xfff0d0, 0, 100, 0.55, 0.6, 1.4);
        s.position.set(2.1, 0, z); s.target.position.set(30, -1, z); m.group.add(s, s.target); m.lights.push(s);
    }
    if (o.cockpit) {
        // 1인칭에서는 바깥 차체·바퀴를 숨기고(레이어 1) 전용 실내를 보여준다. 차체는 그림자 카메라에는 남아 실내에 그늘을 드리운다.
        // 유리는 그림자를 만들지 않아 앞 유리로 햇빛이 들어온다
        const hide = (x) => { if (!x.isMesh) return; x.layers.set(BODY_LAYER); if ([].concat(x.material).some((q) => q.transparent)) x.castShadow = false; };
        m.group.traverse(hide); m.wheels.forEach((w) => w.traverse(hide));
        const own = []; m.cockpit = makeCockpit(m.eye, look, own); m.group.add(m.cockpit.group);
        const d2 = m.dispose; m.dispose = () => { d2(); own.forEach((x) => x.dispose()); m.cockpit.group.traverse((x) => { if (x.isMesh) x.geometry.dispose(); }); };
    }
    return m;
}
