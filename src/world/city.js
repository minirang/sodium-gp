import * as THREE from 'three';
import * as C from 'cannon-es';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const W = 16;
const rng = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

function tex(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
}

// 샘플 중심선을 따라 a~b 오프셋 사이를 잇는 띠 메쉬 (도로, 연석, 인도, 강)
function ribbon(S, a, b, y, vs) {
    const n = S.length, pos = [], uv = [], nor = [], idx = [];
    for (let i = 0; i <= n; i++) {
        const s = S[i % n];
        [a, b].forEach((o, k) => {
            pos.push(s.p.x + s.n.x * o, y, s.p.z + s.n.z * o);
            uv.push(k, (i * S.step) / vs);
            nor.push(0, 1, 0);
        });
        if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
}

export function buildTrack(def) {
    const rand = rng(def.seed), group = new THREE.Group(), V = (x, y, z) => new THREE.Vector3(x, y, z);
    const curve = new THREE.CatmullRomCurve3(def.pts.map(([x, z]) => V(x * def.scale, 0, z * def.scale)), true, 'centripetal');
    const len = curve.getLength(), N = Math.round(len / 4);
    const P = curve.getSpacedPoints(N).slice(0, N);
    const S = P.map((p, i) => {
        const t = P[(i + 1) % N].clone().sub(P[(i + N - 1) % N]).normalize();
        return { p, t, n: V(-t.z, 0, t.x), yaw: Math.atan2(-t.z, t.x) };
    });
    S.step = len / N;

    const ctr = P.reduce((a, p) => a.add(p), V(0, 0, 0)).divideScalar(N);
    const out = Math.sign(S.reduce((a, s) => a + s.p.clone().sub(ctr).dot(s.n), 0)) || 1;

    const asphalt = tex(256, 256, (c, w, h) => {
        c.fillStyle = '#2d3037'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 2400; i++) { c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.09)'; c.fillRect(rand() * w, rand() * h, 2, 2); }
        c.fillStyle = '#e9ecf2'; c.fillRect(14, 0, 6, h); c.fillRect(w - 20, 0, 6, h);
        c.fillStyle = '#ffd15c'; c.fillRect(w / 2 - 3, 0, 6, h / 2);
    });
    const kerb = tex(8, 64, (c) => { c.fillStyle = '#d83a30'; c.fillRect(0, 0, 8, 32); c.fillStyle = '#f2f2f2'; c.fillRect(0, 32, 8, 32); });
    const checker = tex(128, 32, (c) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#fff'; c.fillRect(i * 16, j * 16, 16, 16); } });
    const win = tex(256, 256, (c, w, h) => {
        c.fillStyle = '#12151f'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
            if (rand() < 0.4) { c.fillStyle = rand() < 0.7 ? '#ffd58a' : '#bfe4ff'; c.fillRect(i * 32 + 6, j * 32 + 6, 20, 20); }
            else { c.fillStyle = '#1d2233'; c.fillRect(i * 32 + 6, j * 32 + 6, 20, 20); }
        }
    });
    const glow = tex(128, 128, (c) => {
        const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,190,100,.6)'); g.addColorStop(1, 'rgba(255,190,100,0)');
        c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    });

    const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o });
    const add = (a, b, y, mat, vs) => { const m = new THREE.Mesh(ribbon(S, a, b, y, vs), mat); m.receiveShadow = true; group.add(m); };
    add(-W / 2, W / 2, 0.03, std({ map: asphalt, roughness: 0.85 }), 12);
    const kerbM = std({ map: kerb, roughness: 0.7 }), walkM = std({ color: 0x5a5d66, roughness: 0.95 });
    [1, -1].forEach((sd) => { add(sd * W / 2, sd * (W / 2 + 1), 0.04, kerbM, 3); add(sd * (W / 2 + 1), sd * (W / 2 + 7), 0.08, walkM, 10); });
    add(out * 48, out * 72, 0.05, std({ color: 0x1d6f8e, roughness: 0.1, metalness: 0.25, emissive: 0x0a2a3a }), 20);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x20252b, roughness: 1 }));
    ground.receiveShadow = true; group.add(ground);

    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checker }));
    line.position.set(S[0].p.x, 0.07, S[0].p.z); line.rotation.y = S[0].yaw + Math.PI / 2; group.add(line);

    const boxes = [];
    const bb = P.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
    const B = [], geos = [];
    for (let t = 0; t < 3000 && B.length < def.buildings; t++) {
        const x = bb.x0 - 160 + rand() * (bb.x1 - bb.x0 + 320), z = bb.z0 - 160 + rand() * (bb.z1 - bb.z0 + 320);
        const w = 14 + rand() * 24, d = 14 + rand() * 24, rad = Math.hypot(w, d) / 2;
        let dr = 1e18, dv = 1e18, k = 0;
        for (let i = 0; i < N; i++) {
            const s = S[i], a = s.p.x - x, b = s.p.z - z, e = a * a + b * b;
            if (e < dr) { dr = e; k = i; }
            const f = (a + s.n.x * out * 60) ** 2 + (b + s.n.z * out * 60) ** 2;
            if (f < dv) dv = f;
        }
        if (Math.sqrt(dr) < rad + W / 2 + 12 || Math.sqrt(dv) < rad + 26 || B.some((o) => Math.hypot(o.x - x, o.z - z) < o.rad + rad + 4)) continue;
        B.push({ x, z, rad });
        const h = 16 + rand() * (rand() < 0.22 ? 110 : 46), yaw = S[k].yaw;
        const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            const f = i >> 2;
            if (f < 2) uv.setXY(i, (uv.getX(i) * d) / 28, (uv.getY(i) * h) / 16);
            else if (f > 3) uv.setXY(i, (uv.getX(i) * w) / 28, (uv.getY(i) * h) / 16);
            else uv.setXY(i, 0, 0);
        }
        g.translate(0, h / 2, 0); g.rotateY(yaw); g.translate(x, 0, z);
        const col = new THREE.Color().setHSL(0.58 + rand() * 0.15, 0.15 + rand() * 0.2, 0.5 + rand() * 0.25), cs = [];
        for (let i = 0; i < uv.count; i++) cs.push(col.r, col.g, col.b);
        g.setAttribute('color', new THREE.Float32BufferAttribute(cs, 3));
        geos.push(g);
        boxes.push({ pos: [x, h / 2, z], half: [w / 2, h / 2, d / 2], yaw });
    }
    const city = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ map: win, emissiveMap: win, emissive: 0xffffff, emissiveIntensity: 0.9, vertexColors: true, roughness: 0.85 }));
    city.castShadow = city.receiveShadow = true; group.add(city);
    geos.forEach((g) => g.dispose());

    const D = new THREE.Object3D(), lamps = [];
    for (let i = 0; i < N; i += 9) for (const sd of [-1, 1]) { const s = S[i], o = sd * (W / 2 + 3.6); lamps.push({ x: s.p.x + s.n.x * o, z: s.p.z + s.n.z * o, sd, s }); }
    const inst = (geo, mat, n, fn) => {
        const m = new THREE.InstancedMesh(geo, mat, n);
        for (let i = 0; i < n; i++) { D.position.set(0, 0, 0); D.rotation.set(0, 0, 0); fn(i); D.updateMatrix(); m.setMatrixAt(i, D.matrix); }
        m.frustumCulled = false; group.add(m); return m;
    };
    inst(new THREE.CylinderGeometry(0.09, 0.13, 7.5, 6).translate(0, 3.75, 0), new THREE.MeshStandardMaterial({ color: 0x2a2d35 }), lamps.length, (i) => D.position.set(lamps[i].x, 0, lamps[i].z)).castShadow = true;
    inst(new THREE.BoxGeometry(1.5, 0.14, 0.5), new THREE.MeshBasicMaterial({ color: 0xffc36b }), lamps.length, (i) => { const l = lamps[i]; D.position.set(l.x - l.s.n.x * l.sd * 0.8, 7.5, l.z - l.s.n.z * l.sd * 0.8); D.rotation.y = l.s.yaw; });
    inst(new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), lamps.length, (i) => { const l = lamps[i]; D.position.set(l.x - l.s.n.x * l.sd * 5, 0.1, l.z - l.s.n.z * l.sd * 5); });

    const bars = [];
    for (let i = 0; i < N; i += 2) for (const sd of [-1, 1]) { const s = S[i], o = sd * (W / 2 + 1.5); bars.push({ x: s.p.x + s.n.x * o, z: s.p.z + s.n.z * o, yaw: s.yaw }); }
    inst(new THREE.BoxGeometry(9, 1.2, 1), new THREE.MeshStandardMaterial({ color: 0x8e939c, roughness: 0.9 }), bars.length, (i) => {
        const b = bars[i]; D.position.set(b.x, 0.6, b.z); D.rotation.y = b.yaw;
        boxes.push({ pos: [b.x, 1.2, b.z], half: [4.5, 1.2, 0.5], yaw: b.yaw }); // 충돌체는 시각 모델보다 높게 잡아 차량이 넘어가지 못하게 한다
    }).castShadow = true;

    return {
        group, S, N, len, def, W,
        grid(k) {
            const s = S[0], row = k >> 1, col = k & 1;
            return { pos: s.p.clone().addScaledVector(s.t, -(8 + row * 9)).addScaledVector(s.n, col ? 3.4 : -3.4), yaw: s.yaw };
        },
        addPhysics(world) {
            const ground = new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(3000, 1, 3000)) });
            ground.position.set(0, -1, 0); world.addBody(ground);
            // 바퀴 서스펜션 레이는 평탄한 지면(y=0)과만 계산해 연산량을 줄이고 배리어·차체에 올라타는 현상을 막는다
            world.rayTest = (from, to, res) => {
                if (from.y < 0 || to.y > 0 || from.y === to.y) return;
                const t = from.y / (from.y - to.y);
                res.hasHit = true; res.body = ground;
                res.distance = t * Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
                res.hitNormalWorld.set(0, 1, 0);
                res.hitPointWorld.set(from.x + (to.x - from.x) * t, 0, from.z + (to.z - from.z) * t);
            };
            boxes.forEach((b) => {
                const body = new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(...b.half)) });
                body.position.set(...b.pos); body.quaternion.setFromEuler(0, b.yaw, 0); world.addBody(body);
            });
        },
        dispose() {
            group.traverse((o) => { o.geometry?.dispose(); const m = o.material; if (m) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); } });
        },
    };
}
