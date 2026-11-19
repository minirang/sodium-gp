import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { CARS } from '../config.js';
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

function makeWheel(r, look, right) {
    const g = new THREE.Group(), h = new THREE.Group();
    const lip = mat(look.rim, { metalness: 0.9, roughness: 0.2 });
    h.add(
        new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.26, 28).rotateX(Math.PI / 2), mat(0x0c0d10, { roughness: 0.9 })),
        new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.27, 24).rotateX(Math.PI / 2), mat(0x1a1c22, { metalness: 0.6 })),
    );
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, 0.025, 8, 28), lip); ring.position.z = 0.135; h.add(ring);
    for (let i = 0; i < look.spokes; i++) {
        const a = (i / look.spokes) * Math.PI * 2, s = new THREE.Mesh(new THREE.BoxGeometry(r * 0.62, r * 0.11, 0.04), lip);
        s.position.set(Math.cos(a) * r * 0.33, Math.sin(a) * r * 0.33, 0.14); s.rotation.z = a; h.add(s);
    }
    if (!right) h.rotation.y = Math.PI;
    g.add(h); g.traverse((o) => { o.castShadow = true; });
    return g;
}

// 1인칭용 운전석: 핸들 + 장갑 낀 양손 + 팔. 핸들이 돌면 손도 같이 돈다.
function makeCockpit(c) {
    const g = new THREE.Group(), t = 0.42, R = 0.18;
    const X = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(Math.sin(t), Math.cos(t), 0), Z = new THREE.Vector3(-Math.cos(t), Math.sin(t), 0);
    const piv = new THREE.Group(), spin = new THREE.Group();
    piv.position.copy(c); piv.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); piv.add(spin); g.add(piv);
    const leather = mat(0x15161a, { roughness: 0.65 }), glove = mat(0x0e0f12, { roughness: 0.8 }), sleeve = mat(0x24262d, { roughness: 0.9 });
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.02, 10, 36), leather), box(0.34, 0.03, 0.02, leather), box(0.03, 0.17, 0.02, leather, 0, -0.085, 0), box(0.07, 0.07, 0.03, mat(0xffb454), 0, 0, 0.01));
    const hands = [Math.PI * 1.02, -0.02].map((a) => {
        const h = new THREE.Group();
        h.add(new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8).scale(1, 0.85, 1.25), glove), new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.085, 4, 8).rotateZ(Math.PI / 2), glove));
        h.children[1].position.z = -0.02;
        h.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); h.rotation.z = a + Math.PI / 2; spin.add(h);
        return { a };
    });
    const arms = [-0.2, 0.2].map((dz) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.05, 1, 10), sleeve);
        g.add(m); return { m, s: new THREE.Vector3(c.x - 0.62, c.y + 0.1, c.z + dz) };
    });
    const up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion();
    return {
        group: g,
        update(steer) {
            const th = -steer * Math.PI * 0.85; spin.rotation.z = th;
            hands.forEach((h, i) => {
                const a = h.a + th, px = Math.cos(a) * R, py = Math.sin(a) * R;
                v.set(X.x * px + Y.x * py, X.y * px + Y.y * py, X.z * px + Y.z * py).add(c);
                const { m, s } = arms[i], len = d.copy(v).sub(s).length();
                m.position.copy(s).addScaledVector(d, 0.5); m.scale.set(1, len, 1); m.quaternion.copy(q.setFromUnitVectors(up, d.normalize()));
            });
        },
    };
}

// 모델 없이 코드로 만든 차량 (VX, GT)
function buildProcedural(look) {
    const g = new THREE.Group();
    const paint = new THREE.MeshPhysicalMaterial({ color: look.color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2 });
    const dark = mat(0x14161b, { roughness: 0.7 });
    const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0f18, metalness: 0.8, roughness: 0.08 });
    const tail = new THREE.MeshBasicMaterial({ color: 0x7a0f0f }), lamp = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });
    g.add(box(4.3, 0.55, 1.86, paint, 0, -0.2, 0), box(2.6, 0.08, 1.95, dark, 0, -0.46, 0), box(0.35, 0.05, 1.95, dark, 2.15, -0.45, 0), box(4.32, 0.01, 0.28, mat(0xffffff), 0, 0.08, 0));
    const cabG = new THREE.BoxGeometry(2.1, 0.5, 1.6), p = cabG.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.62); p.setZ(i, p.getZ(i) * 0.84); }
    cabG.computeVertexNormals();
    const cab = new THREE.Mesh(cabG, glass); cab.position.set(-0.35, 0.33, 0); g.add(cab, box(1.3, 0.05, 1.34, paint, -0.35, 0.6, 0));
    g.add(box(0.5, 0.05, 1.7, paint, -2.05, 0.5, 0), box(0.06, 0.34, 0.08, dark, -1.95, 0.3, 0.6), box(0.06, 0.34, 0.08, dark, -1.95, 0.3, -0.6), box(0.5, 0.18, 1.5, dark, 0.55, 0.2, 0));
    for (const z of [-0.62, 0.62]) g.add(box(0.06, 0.1, 0.38, lamp, 2.16, -0.02, z));
    for (const z of [-0.6, 0.6]) g.add(box(0.06, 0.1, 0.5, tail, -2.16, 0, z));
    const r = look.wheel, pts = [[1.35, 0.88], [1.35, -0.88], [-1.3, 0.88], [-1.3, -0.88]].map(([x, z]) => new THREE.Vector3(x, r - 0.61, z));
    const wheels = pts.map((_, i) => makeWheel(r, look, i % 2 === 0));
    const dispose = () => [g, ...wheels].forEach((root) => root.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }));
    return { group: g, wheels, wheelPts: pts, brake: (on) => tail.color.setHex(on ? 0xff2a2a : 0x7a0f0f), eye: new THREE.Vector3(-0.1, 0.42, -0.42), wheelC: new THREE.Vector3(0.28, 0.3, -0.42), lights: [], dispose };
}

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
    const spec = CARS.find((c) => c.id === look.car), m = spec?.model && MODELS[spec.model] ? buildGltf(spec.model, look, o) : buildProcedural(look);
    if (o.lights) for (const z of [-0.62, 0.62]) {
        const s = new THREE.SpotLight(0xfff0d0, 0, 100, 0.55, 0.6, 1.4);
        s.position.set(2.1, 0, z); s.target.position.set(30, -1, z); m.group.add(s, s.target); m.lights.push(s);
    }
    if (o.cockpit) { m.cockpit = makeCockpit(m.wheelC); m.group.add(m.cockpit.group); }
    return m;
}
