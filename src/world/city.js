import * as THREE from 'three';
import * as C from 'cannon-es';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const W = 16, LIM = W / 2 + 1;
const rng = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;

function tex(w, h, draw, repeat = true) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

// 중심선 샘플을 따라 a~b 오프셋 사이를 잇는 띠 메쉬 (도로, 연석, 인도, 강)
function ribbon(S, a, b, y, vs) {
    const n = S.length, pos = [], uv = [], nor = [], idx = [];
    for (let i = 0; i <= n; i++) {
        const s = S[i % n];
        [a, b].forEach((o, k) => { pos.push(s.p.x + s.n.x * o, y, s.p.z + s.n.z * o); uv.push(k, (i * S.step) / vs); nor.push(0, 1, 0); });
        if (i < n) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
}

const scaleUV = (g, su, sv) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; };

export function buildTrack(def, density = 1) {
    const rand = rng(def.seed), group = new THREE.Group(), V = (x, y, z) => new THREE.Vector3(x, y, z), D = new THREE.Object3D();
    const curve = new THREE.CatmullRomCurve3(def.pts.map(([x, z]) => V(x * def.scale, 0, z * def.scale)), true, 'centripetal');
    const len = curve.getLength(), N = Math.round(len / 4), P = curve.getSpacedPoints(N).slice(0, N);
    const S = P.map((p, i) => {
        const t = P[(i + 1) % N].clone().sub(P[(i + N - 1) % N]).normalize();
        return { p, t, n: V(-t.z, 0, t.x), yaw: Math.atan2(-t.z, t.x) };
    });
    S.step = len / N;
    const ctr = P.reduce((a, p) => a.add(p), V(0, 0, 0)).divideScalar(N);
    const out = Math.sign(S.reduce((a, s) => a + s.p.clone().sub(ctr).dot(s.n), 0)) || 1;
    const R0 = Math.max(...P.map((p) => p.distanceTo(ctr)));

    // 텍스처
    const asphalt = tex(256, 256, (c, w, h) => {
        c.fillStyle = '#2d3037'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) { c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.1)'; c.fillRect(rand() * w, rand() * h, 2, 2); }
        c.fillStyle = '#e9ecf2'; c.fillRect(14, 0, 6, h); c.fillRect(w - 20, 0, 6, h);
        c.fillStyle = '#ffd15c'; c.fillRect(w / 2 - 3, 0, 6, h / 2);
    });
    const kerb = tex(8, 64, (c) => { c.fillStyle = '#d83a30'; c.fillRect(0, 0, 8, 32); c.fillStyle = '#f2f2f2'; c.fillRect(0, 32, 8, 32); });
    const checker = tex(128, 32, (c) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#fff'; c.fillRect(i * 16, j * 16, 16, 16); } });
    const win = tex(256, 256, (c, w, h) => {
        c.fillStyle = '#12151f'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { c.fillStyle = rand() < 0.4 ? (rand() < 0.7 ? '#ffd58a' : '#bfe4ff') : '#1d2233'; c.fillRect(i * 32 + 6, j * 32 + 6, 20, 20); }
    });
    const glow = tex(128, 128, (c) => { const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,190,100,.6)'); g.addColorStop(1, 'rgba(255,190,100,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
    const grass = tex(256, 256, (c, w, h) => {
        c.fillStyle = '#2a3a2b'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 5000; i++) { c.fillStyle = `hsla(${85 + rand() * 40},35%,${14 + rand() * 18}%,.55)`; c.fillRect(rand() * w, rand() * h, 2, 3); }
    });
    grass.repeat.set(500, 500);
    const crowd = tex(256, 64, (c, w, h) => {
        c.fillStyle = '#1b1d24'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 1400; i++) { c.fillStyle = `hsl(${rand() * 360},55%,${40 + rand() * 25}%)`; c.fillRect(rand() * w, rand() * h, 3, 4); }
    });
    const water = tex(128, 256, (c, w, h) => {
        c.fillStyle = '#1a6486'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(190,230,255,${0.05 + rand() * 0.12})`; c.fillRect(rand() * w, rand() * h, 10 + rand() * 26, 2); }
    });
    const banner = (text, bg, fg) => tex(512, 64, (c, w, h) => {
        c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.fillRect(0, h - 8, w, 8);
        c.font = 'italic 900 40px "Segoe UI",Arial,sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2 - 2);
    }, false);

    const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMapIntensity: 0.4, ...o });
    const add = (a, b, y, mat, vs) => { const m = new THREE.Mesh(ribbon(S, a, b, y, vs), mat); m.receiveShadow = true; group.add(m); };
    add(-W / 2, W / 2, 0.03, std({ map: asphalt, roughness: 0.6, metalness: 0.1 }), 12);
    const kerbM = std({ map: kerb, roughness: 0.7 }), walkM = std({ color: 0x5a5d66, roughness: 0.95 }), stone = std({ color: 0x70737c, roughness: 0.9 });
    [1, -1].forEach((sd) => { add(sd * W / 2, sd * (W / 2 + 1), 0.04, kerbM, 3); add(sd * (W / 2 + 1), sd * (W / 2 + 7), 0.08, walkM, 10); });
    const waterM = std({ map: water, roughness: 0.08, metalness: 0.3, emissive: 0x0a2a3a, envMapIntensity: 1 });
    add(out * 48, out * 72, 0.05, waterM, 24);
    add(out * 44, out * 48, 0.2, stone, 10); add(out * 72, out * 76, 0.2, stone, 10);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: grass, roughness: 1, envMapIntensity: 0.2 }));
    ground.receiveShadow = true; group.add(ground);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checker }));
    line.position.set(S[0].p.x, 0.07, S[0].p.z); line.rotation.y = S[0].yaw + Math.PI / 2; group.add(line);

    // 건물
    const gb = (w, h, d, x, z, yaw) => {
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
        return g;
    };
    const bb = P.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
    const B = [], geos = [], tall = [];
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
        if (k < 26 || k > N - 26 || Math.sqrt(dr) < rad + W / 2 + 14 || Math.sqrt(dv) < rad + 28 || B.some((o) => Math.hypot(o.x - x, o.z - z) < o.rad + rad + 4)) continue;
        B.push({ x, z, rad });
        const h = 16 + rand() * (rand() < 0.22 ? 110 : 46);
        geos.push(gb(w, h, d, x, z, S[k].yaw));
        if (h > 70) tall.push([x, h + 1, z]);
    }
    const cityMat = new THREE.MeshStandardMaterial({ map: win, emissiveMap: win, emissive: 0xffffff, emissiveIntensity: 0.9, vertexColors: true, roughness: 0.8, envMapIntensity: 0.5 });
    const city = new THREE.Mesh(mergeGeometries(geos), cityMat);
    city.castShadow = city.receiveShadow = true; group.add(city);

    // 먼 스카이라인
    const far = [];
    for (let i = 0; i < 110; i++) {
        const a = rand() * Math.PI * 2, r = R0 + 180 + rand() * 280;
        far.push(gb(28 + rand() * 40, 70 + rand() * 230, 28 + rand() * 40, ctr.x + Math.cos(a) * r, ctr.z + Math.sin(a) * r, rand() * 3));
    }
    group.add(new THREE.Mesh(mergeGeometries(far), cityMat));

    const inst = (geo, mat, n, fn) => {
        const m = new THREE.InstancedMesh(geo, mat, n);
        for (let i = 0; i < n; i++) { D.position.set(0, 0, 0); D.rotation.set(0, 0, 0); D.scale.set(1, 1, 1); fn(i, m); D.updateMatrix(); m.setMatrixAt(i, D.matrix); }
        m.frustumCulled = false; group.add(m); return m;
    };
    inst(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a }), tall.length, (i) => D.position.set(...tall[i]));

    // 가로등
    const lamps = [];
    for (let i = 0; i < N; i += 9) for (const sd of [-1, 1]) { const s = S[i], o = sd * (W / 2 + 3.6); lamps.push({ x: s.p.x + s.n.x * o, z: s.p.z + s.n.z * o, sd, s }); }
    const poles = inst(new THREE.CylinderGeometry(0.09, 0.13, 7.5, 6).translate(0, 3.75, 0), new THREE.MeshStandardMaterial({ color: 0x2a2d35 }), lamps.length, (i) => D.position.set(lamps[i].x, 0, lamps[i].z));
    poles.castShadow = true;
    const heads = inst(new THREE.BoxGeometry(1.5, 0.14, 0.5), new THREE.MeshBasicMaterial({ color: 0xf0c27c }), lamps.length, (i) => { const l = lamps[i]; D.position.set(l.x - l.s.n.x * l.sd * 0.8, 7.5, l.z - l.s.n.z * l.sd * 0.8); D.rotation.y = l.s.yaw; });
    const pools = inst(new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }), lamps.length, (i) => { const l = lamps[i]; D.position.set(l.x - l.s.n.x * l.sd * 5, 0.1, l.z - l.s.n.z * l.sd * 5); });

    // 가로수와 공원 나무
    const trees = [], startZone = (i) => i < 26 || i > N - 26;
    for (let i = 0; i < N; i += Math.max(2, Math.round(3 / density))) for (const sd of [-1, 1]) {
        if (startZone(i)) continue;
        const s = S[i], o = sd * (W / 2 + 10 + rand() * 3);
        trees.push([s.p.x + s.n.x * o, s.p.z + s.n.z * o, 0.8 + rand() * 0.6]);
    }
    for (let t = 0, want = Math.floor(def.trees * density); t < 1500 && want > 0; t++) {
        const x = bb.x0 - 120 + rand() * (bb.x1 - bb.x0 + 240), z = bb.z0 - 120 + rand() * (bb.z1 - bb.z0 + 240);
        let dr = 1e18, dv = 1e18;
        for (let i = 0; i < N; i++) { const s = S[i], a = s.p.x - x, b = s.p.z - z; dr = Math.min(dr, a * a + b * b); dv = Math.min(dv, (a + s.n.x * out * 60) ** 2 + (b + s.n.z * out * 60) ** 2); }
        if (Math.sqrt(dr) < 30 || Math.sqrt(dv) < 18 || B.some((o) => Math.hypot(o.x - x, o.z - z) < o.rad + 3)) continue;
        trees.push([x, z, 0.9 + rand() * 0.9]); want--;
    }
    const crownG = mergeGeometries([new THREE.ConeGeometry(1.7, 3.6, 7).translate(0, 3.4, 0), new THREE.ConeGeometry(1.3, 3, 7).translate(0, 5.2, 0), new THREE.ConeGeometry(0.9, 2.4, 7).translate(0, 6.8, 0)]);
    const place = (i) => { const [x, z, s] = trees[i]; D.position.set(x, 0, z); D.rotation.y = i; D.scale.setScalar(s); };
    inst(new THREE.CylinderGeometry(0.14, 0.2, 2.4, 6).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x4a3626 }), trees.length, place).castShadow = true;
    const crowns = inst(crownG, new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.3 }), trees.length, (i, m) => { place(i); m.setColorAt(i, new THREE.Color().setHSL(0.24 + rand() * 0.1, 0.45, 0.2 + rand() * 0.12)); });
    crowns.castShadow = true;

    // 배리어(시각용) + 광고판
    const bars = [];
    for (let i = 0; i < N; i += 2) for (const sd of [-1, 1]) { const s = S[i], o = sd * (W / 2 + 1.5); bars.push({ x: s.p.x + s.n.x * o, z: s.p.z + s.n.z * o, yaw: s.yaw, i, sd }); }
    inst(new THREE.BoxGeometry(9, 1.2, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), bars.length, (i, m) => {
        const b = bars[i]; D.position.set(b.x, 0.6, b.z); D.rotation.y = b.yaw;
        m.setColorAt(i, new THREE.Color((i >> 1) % 4 === 0 ? 0xc42c2c : 0xb4b8c0));
    }).castShadow = true;
    const ads = [banner('SODIUM', '#10131f', '#ffb454'), banner('VOLT RACING', '#c42c2c', '#ffffff'), banner('NORTH TYRE', '#f2b632', '#14161c'), banner('CITY BREW', '#1d6f8e', '#ffffff')];
    ads.forEach((tx, k) => {
        const list = bars.filter((b) => b.i % 10 === 0 && ((b.i / 10 + (b.sd > 0 ? 1 : 0)) | 0) % 4 === k && !startZone(b.i));
        inst(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshBasicMaterial({ map: tx, side: THREE.DoubleSide }), list.length, (i) => {
            const b = list[i], s = S[b.i], o = b.sd * (W / 2 + 2.3);
            D.position.set(s.p.x + s.n.x * o, 1.9, s.p.z + s.n.z * o); D.rotation.y = b.yaw + (b.sd > 0 ? Math.PI : 0);
        });
    });

    // 스타트 게이트, 육교, 관중석
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.6 });
    const gantry = (i, label, bridge) => {
        const g = new THREE.Group(), s = S[i], h = bridge ? 6.4 : 7.2;
        g.position.copy(s.p); g.rotation.y = s.yaw;
        for (const z of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), dark); p.position.set(0, h / 2, z * (W / 2 + 3.2)); p.castShadow = true; g.add(p); }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, W + 7.6), dark); beam.position.y = h; beam.castShadow = true; g.add(beam);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, W + 4), new THREE.MeshBasicMaterial({ color: 0xffb454 })); strip.position.set(-0.75, h - 0.8, 0); g.add(strip);
        if (label) for (const k of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(W + 3, 1.2), new THREE.MeshBasicMaterial({ map: label })); b.position.set(k * 0.72, h, 0); b.rotation.y = k * -Math.PI / 2; g.add(b); }
        group.add(g);
    };
    gantry(0, banner('SODIUM GP', '#10131f', '#ffffff'), false);
    gantry(Math.floor(N / 3), banner('RIVERSIDE BANK', '#1d6f8e', '#ffffff'), true);
    gantry(Math.floor((N * 2) / 3), banner('VOLT RACING', '#c42c2c', '#ffffff'), true);

    const crowdM = new THREE.MeshStandardMaterial({ map: crowd, roughness: 0.9 });
    for (const sd of [-1, 1]) {
        const g = new THREE.Group(), s = S[14];
        g.position.copy(s.p); g.rotation.y = s.yaw;
        for (let k = 0; k < 6; k++) {
            const h = 0.7 + k * 0.6, m = new THREE.Mesh(scaleUV(new THREE.BoxGeometry(64, h, 2.2), 10, 1), crowdM);
            m.position.set(0, h / 2, sd * (W / 2 + 16 + k * 2.2)); m.castShadow = m.receiveShadow = true; g.add(m);
        }
        const roof = new THREE.Mesh(new THREE.BoxGeometry(68, 0.35, 15), dark); roof.position.set(0, 9, sd * (W / 2 + 22)); roof.castShadow = true; g.add(roof);
        for (const x of [-30, 30]) for (const z of [-1, 1]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 9, 6), dark); p.position.set(x, 4.5, sd * (W / 2 + 22) + z * 6.5); g.add(p); }
        group.add(g);
    }

    // 코스는 움직이지 않으므로 행렬 자동 갱신을 끈다
    group.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });

    return {
        group, S, N, len, def, W, limit: LIM,
        grid(k) {
            const s = S[0], row = k >> 1, col = k & 1;
            // 엇갈린 그리드: 한 줄 간격을 넓히고 왼쪽 열을 앞으로 내보내 나란히 출발하는 충돌을 줄인다
            return { pos: s.p.clone().addScaledVector(s.t, -(8 + row * 12 + (col ? 6 : 0))).addScaledVector(s.n, col ? 3.2 : -3.2), yaw: s.yaw };
        },
        setTime(t) { cityMat.emissiveIntensity = t.win; pools.visible = heads.visible = !!t.lamp; },
        update(time) { water.offset.y = -time * 0.04; },
        // 충돌은 코스 경계(resolveWalls)로 처리하고, 바퀴 레이는 지면만 검사한다
        addPhysics(world) {
            const ground = new C.Body({ mass: 0, shape: new C.Box(new C.Vec3(3000, 1, 3000)) });
            ground.position.set(0, -1, 0); world.addBody(ground);
            world.rayTest = (from, to, res) => {
                if (from.y < 0 || to.y > 0 || from.y === to.y) return;
                const t = from.y / (from.y - to.y);
                res.hasHit = true; res.body = ground;
                res.distance = t * Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
                res.hitNormalWorld.set(0, 1, 0);
                res.hitPointWorld.set(from.x + (to.x - from.x) * t, 0, from.z + (to.z - from.z) * t);
            };
        },
        dispose() {
            group.traverse((o) => {
                o.geometry?.dispose(); o.dispose?.();
                for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); }
            });
        },
    };
}
