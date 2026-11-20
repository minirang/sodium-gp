import * as THREE from 'three';
import * as C from 'cannon-es';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const W = 16, LIM = W / 2 + 1, CH = 180;
const rng = (s) => () => (s = (s * 16807) % 2147483647) / 2147483647;
const KO = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

// 코스마다 다른 도시 풍경
const THEMES = {
    city: {
        ground: 'plaza', barrier: [0xd8dbe0, 0x8d939e, 3], barrierH: 1.15, lamp: { every: 7, h: 9, color: 0xe4ecff, glow: 'rgba(200,220,255,.55)' },
        ads: [['SODIUM', '#10131f', '#ffb454'], ['VOLT RACING', '#c42c2c', '#ffffff'], ['NEON CITY', '#2a1250', '#ff5ad1'], ['CITY BREW', '#1d6f8e', '#ffffff']],
        gates: [['SODIUM GP', '#10131f', '#ffffff'], ['METRO BANK', '#13315c', '#ffffff'], ['VOLT RACING', '#c42c2c', '#ffffff'], ['NEON CITY', '#2a1250', '#ff5ad1']],
    },
    river: {
        ground: 'grass', barrier: [0xeef1f5, 0x2f6fd0, 4], barrierH: 0.95, lamp: { every: 8, h: 6.5, color: 0xffcf8a, glow: 'rgba(255,190,100,.6)' },
        ads: [['RIVER PARK', '#2f7d3a', '#ffffff'], ['NORTH TYRE', '#f2b632', '#14161c'], ['SODIUM', '#10131f', '#ffb454'], ['GREEN LINE', '#1d6f8e', '#ffffff']],
        gates: [['SODIUM GP', '#10131f', '#ffffff'], ['RIVERSIDE BANK', '#1d6f8e', '#ffffff'], ['RIVER PARK', '#2f7d3a', '#ffffff']],
    },
    harbor: {
        ground: 'quay', barrier: [0xf2c230, 0x1d1f26, 2], barrierH: 1.2, lamp: { every: 10, h: 13, color: 0xffe2b0, glow: 'rgba(255,210,150,.55)' },
        ads: [['OCEAN LINE', '#0d3b66', '#ffffff'], ['PORT 33', '#f2b632', '#14161c'], ['SODIUM', '#10131f', '#ffb454'], ['NORTH TYRE', '#c42c2c', '#ffffff']],
        gates: [['SODIUM GP', '#10131f', '#ffffff'], ['PORT 33', '#0d3b66', '#ffffff'], ['OCEAN LINE', '#c42c2c', '#ffffff']],
    },
};

function tex(w, h, draw, repeat = true) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
}

// 중심선 샘플을 따라 a~b 오프셋 사이를 잇는 띠 메쉬
function ribbon(P, a, b, y, vs, closed = true) {
    const n = P.length, m = closed ? n : n - 1, pos = [], uv = [], nor = [], idx = [];
    let L = 0;
    for (let i = 0; i <= m; i++) {
        const s = P[i % n];
        if (i) L += s.p.distanceTo(P[(i - 1) % n].p);
        [a, b].forEach((o, k) => { pos.push(s.p.x + s.n.x * o, y, s.p.z + s.n.z * o); uv.push(k, L / vs); nor.push(0, 1, 0); });
        if (i < m) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
}

const scaleUV = (g, su, sv) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv); return g; };
const paint = (g, col) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
const put = (g, x, y, z, yaw = 0) => g.rotateY(yaw).translate(x, y, z);

// 코스 중심선 최근접 탐색용 공간 해시
function trackIndex(S, cell = 24) {
    const map = new Map(), k = (i, j) => i * 73856093 ^ j * 19349663;
    S.forEach((s, i) => { const key = k(Math.floor(s.p.x / cell), Math.floor(s.p.z / cell)); if (!map.has(key)) map.set(key, []); map.get(key).push(i); });
    return (x, z, R = 60) => {
        const cx = Math.floor(x / cell), cz = Math.floor(z / cell), r = Math.ceil(R / cell);
        let d = Infinity, bi = -1;
        for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
            const l = map.get(k(cx + i, cz + j)); if (!l) continue;
            for (const q of l) { const e = (S[q].p.x - x) ** 2 + (S[q].p.z - z) ** 2; if (e < d) { d = e; bi = q; } }
        }
        return { d: Math.sqrt(d), i: bi };
    };
}

export function buildTrack(def, density = 1) {
    const T = THEMES[def.theme] || THEMES.city, rand = rng(def.seed), group = new THREE.Group(), V = (x, y, z) => new THREE.Vector3(x, y, z), D = new THREE.Object3D();
    const R = (a, b) => a + rand() * (b - a), pick = (l) => l[Math.floor(rand() * l.length)];
    const curve = new THREE.CatmullRomCurve3(def.pts.map(([x, z]) => V(x * def.scale, 0, z * def.scale)), true, 'centripetal');
    const len = curve.getLength(), N = Math.round(len / 4), P = curve.getSpacedPoints(N).slice(0, N);
    const S = P.map((p, i) => {
        const t = P[(i + 1) % N].clone().sub(P[(i + N - 1) % N]).normalize();
        return { p, t, n: V(-t.z, 0, t.x), yaw: Math.atan2(-t.z, t.x) };
    });
    S.step = len / N;
    const ctr = P.reduce((a, p) => a.add(p), V(0, 0, 0)).divideScalar(N);
    const R0 = Math.max(...P.map((p) => p.distanceTo(ctr)));
    const bb = P.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 });
    const near = trackIndex(S), startZone = (i) => i < 26 || i > N - 26;
    const lit = [], neonMats = [], nightOnly = [], anims = [], info = { bridges: [] };

    // 청크 단위로 나눈 인스턴스/병합 메쉬: 화면·그림자 컬링이 동작해 먼 곳의 물체를 그리지 않는다
    const ck = (x, z) => `${Math.floor(x / CH)},${Math.floor(z / CH)}`;
    const inst = (geo, mat, n, fn, shadow = false) => {
        const buckets = new Map(), meshes = [];
        for (let i = 0; i < n; i++) {
            D.position.set(0, 0, 0); D.rotation.set(0, 0, 0); D.scale.set(1, 1, 1);
            let col = null; fn(i, (c) => { col = c; }); D.updateMatrix();
            const k = ck(D.position.x, D.position.z); if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push([D.matrix.clone(), col]);
        }
        for (const list of buckets.values()) {
            const m = new THREE.InstancedMesh(geo, mat, list.length);
            list.forEach(([mx, c], i) => { m.setMatrixAt(i, mx); if (c) m.setColorAt(i, c); });
            m.computeBoundingSphere(); m.castShadow = shadow; m.receiveShadow = true; group.add(m); meshes.push(m);
        }
        return meshes;
    };
    const lists = new Map();
    const geoTo = (key, g) => { const k = key + '|' + ck(g.userData.x ?? 0, g.userData.z ?? 0); if (!lists.has(k)) lists.set(k, []); lists.get(k).push(g); return g; };
    const at = (g, x, z) => { g.userData.x = x; g.userData.z = z; return g; };
    const flush = (key, mat, shadow = true) => {
        for (const [k, geos] of lists) if (k.split('|')[0] === key && geos.length) {
            const m = new THREE.Mesh(mergeGeometries(geos), mat); geos.forEach((g) => g.dispose());
            m.castShadow = shadow; m.receiveShadow = true; group.add(m);
        }
    };

    // ── 텍스처
    const asphalt = tex(256, 256, (c, w, h) => {
        c.fillStyle = '#2d3037'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) { c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.045)' : 'rgba(0,0,0,.1)'; c.fillRect(rand() * w, rand() * h, 2, 2); }
        c.fillStyle = '#e9ecf2'; c.fillRect(14, 0, 6, h); c.fillRect(w - 20, 0, 6, h);
        c.fillStyle = def.theme === 'harbor' ? '#e9ecf2' : '#ffd15c'; c.fillRect(w / 2 - 3, 0, 6, h / 2);
    });
    const kerb = tex(8, 64, (c) => { c.fillStyle = def.theme === 'river' ? '#2f6fd0' : '#d83a30'; c.fillRect(0, 0, 8, 32); c.fillStyle = '#f2f2f2'; c.fillRect(0, 32, 8, 32); });
    const checker = tex(128, 32, (c) => { for (let i = 0; i < 8; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#fff'; c.fillRect(i * 16, j * 16, 16, 16); } });
    const glow = tex(128, 128, (c) => { const g = c.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, T.lamp.glow); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
    const banner = (text, bg, fg, w = 512, h = 64) => tex(w, h, (c) => {
        c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.fillRect(0, h - 8, w, 8);
        c.font = `italic 900 ${Math.round(h * 0.62)}px "Segoe UI",Arial,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2 - 2);
    }, false);
    const water = tex(128, 256, (c, w, h) => {
        c.fillStyle = def.theme === 'harbor' ? '#14506e' : '#1a6486'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(190,230,255,${0.05 + rand() * 0.12})`; c.fillRect(rand() * w, rand() * h, 10 + rand() * 26, 2); }
    });
    // 창문 텍스처: map(벽·유리)과 emissiveMap(켜진 창)을 따로 만들어 낮/밤 표현을 분리한다
    const facade = (w, h, cols, rows, base, frame, pane, pad, litP) => {
        const marks = [];
        for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) marks.push([i, j, rand() < litP, rand() < 0.7]);
        const cw = w / cols, rh = h / rows;
        const map = tex(w, h, (c) => {
            c.fillStyle = base; c.fillRect(0, 0, w, h);
            marks.forEach(([i, j]) => { c.fillStyle = frame; c.fillRect(i * cw + pad - 1, j * rh + pad - 1, cw - 2 * pad + 2, rh - 2 * pad + 2); c.fillStyle = pane; c.fillRect(i * cw + pad, j * rh + pad, cw - 2 * pad, rh - 2 * pad); });
        });
        const em = tex(w, h, (c) => {
            c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
            marks.forEach(([i, j, on, warm]) => { if (!on) return; c.fillStyle = warm ? '#ffd58a' : '#bfe4ff'; c.fillRect(i * cw + pad, j * rh + pad, cw - 2 * pad, rh - 2 * pad); });
        });
        return { map, em };
    };
    const winMat = (f, { k = 1, ...o } = {}) => { const m = new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.em, emissive: 0xffffff, vertexColors: true, roughness: 0.75, envMapIntensity: 0.5, ...o }); lit.push([m, k]); return m; };
    const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMapIntensity: 0.4, ...o });
    const flat = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.4, ...o });

    // ── 지면
    const groundTex = {
        grass: () => tex(256, 256, (c, w, h) => { c.fillStyle = '#2a3a2b'; c.fillRect(0, 0, w, h); for (let i = 0; i < 5000; i++) { c.fillStyle = `hsla(${85 + rand() * 40},35%,${14 + rand() * 18}%,.55)`; c.fillRect(rand() * w, rand() * h, 2, 3); } }),
        plaza: () => tex(256, 256, (c, w, h) => { c.fillStyle = '#4a4d55'; c.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.08)'; c.fillRect(rand() * w, rand() * h, 2, 2); } c.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 8; i++) { c.fillRect(i * 32, 0, 2, h); c.fillRect(0, i * 32, w, 2); } }),
        quay: () => tex(256, 256, (c, w, h) => { c.fillStyle = '#6f7277'; c.fillRect(0, 0, w, h); for (let i = 0; i < 3500; i++) { c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.09)'; c.fillRect(rand() * w, rand() * h, 2, 2); } c.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 4; i++) { c.fillRect(i * 64, 0, 2, h); c.fillRect(0, i * 64, w, 2); } c.fillStyle = 'rgba(240,200,60,.35)'; c.fillRect(0, 120, w, 3); }),
    }[T.ground]();
    const gRep = T.ground === 'grass' ? 500 : T.ground === 'plaza' ? 250 : 220;
    groundTex.repeat.set(gRep, gRep);
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: T.ground === 'grass' ? 1 : 0.92, envMapIntensity: 0.2, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    const SPAN = 4000;
    let isLand = () => true;

    if (T.ground === 'quay') {
        // 항구: 바다 위에 육지(코스 주변 + 안쪽 + 서쪽 본토)를 마스크로 잘라 올린다
        const span = Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0) + 1400, X0 = (bb.x0 + bb.x1) / 2 - span / 2, Z0 = (bb.z0 + bb.z1) / 2 - span / 2, PX = 2048, k = PX / span;
        const cv = document.createElement('canvas'); cv.width = cv.height = PX;
        const c = cv.getContext('2d'), tp = (p) => [(p.x - X0) * k, (p.z - Z0) * k];
        c.fillStyle = '#000'; c.fillRect(0, 0, PX, PX); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineJoin = c.lineCap = 'round';
        c.fillRect(0, 0, (bb.x0 - 95 - X0) * k, PX);
        c.beginPath(); S.forEach((s, i) => (i ? c.lineTo(...tp(s.p)) : c.moveTo(...tp(s.p)))); c.closePath(); c.fill();
        c.lineWidth = 92 * k; c.stroke();
        const px = c.getImageData(0, 0, PX, PX).data;
        isLand = (x, z) => { const u = Math.floor((x - X0) * k), v = Math.floor((z - Z0) * k); return u >= 0 && v >= 0 && u < PX && v < PX && px[(v * PX + u) * 4 + 1] > 127; };
        const mask = new THREE.CanvasTexture(cv); mask.anisotropy = 4;
        groundMat.alphaMap = mask; groundMat.alphaTest = 0.5;
        const land = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2), groundMat);
        land.position.set(X0 + span / 2, 0, Z0 + span / 2); land.receiveShadow = true; group.add(land);
        groundTex.repeat.set(span / 18, span / 18);
        const sea = water.clone(); sea.needsUpdate = true; sea.repeat.set(120, 60);
        const seaMat = new THREE.MeshStandardMaterial({ map: sea, roughness: 0.12, metalness: 0.35, emissive: 0x06202e, envMapIntensity: 1.1 });
        const seaM = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 1.5, SPAN * 1.5).rotateX(-Math.PI / 2), seaMat); seaM.position.set(ctr.x, -0.9, ctr.z); group.add(seaM);
        anims.push((t) => { sea.offset.set(t * 0.004, t * 0.01); });
        // 안벽: 바다 쪽 가장자리를 따라 짙은 석축
        const quay = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 1, alphaMap: mask, alphaTest: 0.5 }));
        quay.position.set(X0 + span / 2, -0.45, Z0 + span / 2); quay.scale.setScalar(1.004); group.add(quay);
    } else {
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(SPAN, SPAN).rotateX(-Math.PI / 2), groundMat);
        ground.position.set(ctr.x, 0, ctr.z); ground.receiveShadow = true; group.add(ground);
    }

    // ── 강 (리버사이드): 코스를 가로질러 흐르는 강. 코스와 겹치는 길이가 가장 짧은(가장 수직으로 건너는) 물길을 고른다
    let riverD = () => Infinity, RIV = null;
    const RW = 22;
    if (def.theme === 'river') {
        const make = (dz, ph, a) => {
            const pts = [];
            for (let u = -1100; u <= 1100; u += 8) pts.push(V(ctr.x + u, 0, ctr.z + dz + a * Math.sin(u / 240 + ph) + a * 0.35 * Math.sin(u / 91 + ph * 2)));
            return pts.map((p, i) => { const q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)], t = q.clone().sub(o).normalize(); return { p, t, n: V(-t.z, 0, t.x) }; });
        };
        let best = null, bs = Infinity;
        for (let k = 0; k < 24; k++) {
            const cand = make(R(-0.3, 0.3) * R0, R(0, 6.28), R(25, 60));
            let over = 0, bad = false;
            for (const r of cand) { const q = near(r.p.x, r.p.z, RW + 40); if (q.d < RW + W / 2 + 6) { over++; if (startZone(q.i) || (q.i > 8 && q.i < 22)) bad = true; } }
            if (!bad && over > 0 && over < bs) { bs = over; best = cand; }
        }
        RIV = best;
        if (RIV) {
            riverD = (x, z) => { let d = Infinity; for (let i = 0; i < RIV.length; i += 2) d = Math.min(d, (RIV[i].p.x - x) ** 2 + (RIV[i].p.z - z) ** 2); return Math.sqrt(d); };
            const wm = new THREE.MeshStandardMaterial({ map: water, roughness: 0.08, metalness: 0.3, emissive: 0x0a2a3a, envMapIntensity: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
            const rv = new THREE.Mesh(ribbon(RIV, -RW, RW, 0.012, 30, false), wm); rv.receiveShadow = true; group.add(rv);
            anims.push((t) => { water.offset.y = -t * 0.04; });
            const bank = std({ color: 0x7a776d, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
            for (const sd of [-1, 1]) group.add(new THREE.Mesh(ribbon(RIV, sd * RW, sd * (RW + 3), 0.02, 10, false), bank));
        }
    }
    const wet = (x, z, m = 0) => !isLand(x, z) || riverD(x, z) < RW + m;

    // ── 도로·연석·인도
    const add = (a, b, y, mat, vs) => { const m = new THREE.Mesh(ribbon(S, a, b, y, vs), mat); m.receiveShadow = true; group.add(m); return m; };
    add(-W / 2, W / 2, 0.03, std({ map: asphalt, roughness: 0.6, metalness: 0.1 }), 12);
    const kerbM = std({ map: kerb, roughness: 0.7 }), walkM = std({ color: def.theme === 'city' ? 0x6a6d76 : 0x5a5d66, roughness: 0.95 });
    [1, -1].forEach((sd) => { add(sd * W / 2, sd * (W / 2 + 1), 0.04, kerbM, 3); add(sd * (W / 2 + 1), sd * (W / 2 + 7), 0.08, walkM, 10); });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(W, 2.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: checker }));
    line.position.set(S[0].p.x, 0.07, S[0].p.z); line.rotation.y = S[0].yaw + Math.PI / 2; group.add(line);

    // ── 다리 (강을 건너는 구간): 아치 트러스 + 행어 + 데크 측면
    const bridge = S.map((s) => riverD(s.p.x, s.p.z) < RW + 6);
    if (RIV) {
        const steel = new THREE.MeshStandardMaterial({ color: 0xd9dde4, metalness: 0.6, roughness: 0.35 }), parts = [];
        for (let i = 0; i < N; i++) {
            if (!bridge[i] || bridge[(i - 1 + N) % N]) continue;
            let j = i; while (bridge[(j + 1) % N] && j - i < N) j++;
            const a = i - 4, b = j + 4, n = b - a; info.bridges.push(i);
            for (const sd of [-1, 1]) {
                const pts = [];
                for (let k = 0; k <= n; k++) { const s = S[(a + k + N) % N], h = 1 + Math.sin((Math.PI * k) / n) * 11; pts.push(s.p.clone().addScaledVector(s.n, sd * (W / 2 + 2.6)).setY(h)); }
                parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 3, 0.45, 6));
                for (let k = 2; k < n - 1; k += 2) { const p = pts[k]; parts.push(new THREE.CylinderGeometry(0.08, 0.08, p.y, 4).translate(p.x, p.y / 2, p.z)); }
                const deck = []; for (let k = 0; k <= n; k++) { const s = S[(a + k + N) % N]; deck.push({ p: s.p.clone().addScaledVector(s.n, sd * (W / 2 + 7)), n: s.n, t: s.t }); }
                const g = new THREE.BufferGeometry(), pos = [], idx = [];
                deck.forEach((d, k) => { pos.push(d.p.x, -2.5, d.p.z, d.p.x, 0.25, d.p.z); if (k < n) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2); });
                g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
                group.add(new THREE.Mesh(g, std({ color: 0x55585f, roughness: 0.9 })));
            }
            for (const k of [a, b]) { const s = S[(k + N) % N]; for (const sd of [-1, 1]) parts.push(new THREE.BoxGeometry(2, 2.2, 2).translate(s.p.x + s.n.x * sd * (W / 2 + 2.6), 1.1, s.p.z + s.n.z * sd * (W / 2 + 2.6))); }
            i = j;
        }
        if (parts.length) { const m = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { g.deleteAttribute('uv'); return g; })), steel); m.castShadow = true; group.add(m); }
    }

    // ── 건물 배치 (테마별)
    const B = [];
    const free = (x, z, rad, gap = 4) => !B.some((o) => Math.hypot(o.x - x, o.z - z) < o.rad + rad + gap);
    const okLand = (x, z, rad) => !wet(x, z, rad + 6) && [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([a, b]) => isLand(x + a * rad, z + b * rad));
    const tryPlace = (tries, want, minR, maxR, margin, gen) => {
        for (let t = 0, got = 0; t < tries && got < want; t++) {
            const x = bb.x0 - 200 + rand() * (bb.x1 - bb.x0 + 400), z = bb.z0 - 200 + rand() * (bb.z1 - bb.z0 + 400);
            const rad = R(minR, maxR), q = near(x, z, rad + margin + W);
            if ((q.i >= 0 && (startZone(q.i) ? q.d < rad + 40 : q.d < rad + W / 2 + margin)) || !free(x, z, rad) || !okLand(x, z, rad)) continue;
            const yaw = q.i >= 0 ? S[q.i].yaw : near(x, z, 400).i >= 0 ? S[near(x, z, 400).i].yaw : rand() * 3;
            if (gen(x, z, rad, yaw, q) !== false) { B.push({ x, z, rad }); got++; }
        }
    };
    const box = (w, h, d, x, z, yaw, col, tu, tv, y = 0) => {
        const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) {
            const f = i >> 2;
            if (f < 2) uv.setXY(i, (uv.getX(i) * d) / tu, (uv.getY(i) * h) / tv);
            else if (f > 3) uv.setXY(i, (uv.getX(i) * w) / tu, (uv.getY(i) * h) / tv);
            else uv.setXY(i, 0.001, 0.001);
        }
        return at(paint(put(g.translate(0, h / 2 + y, 0), x, 0, z, yaw), col), x, z);
    };
    // 박공지붕: 면마다 정점을 따로 둬서 각진 음영이 나오게 한다
    const prism = (w, h, d, x, y, z, yaw, col) => {
        const a = w / 2, b = d / 2, F = [[[-a, 0, b], [a, 0, b], [a, h, 0], [-a, h, 0]], [[a, 0, -b], [-a, 0, -b], [-a, h, 0], [a, h, 0]], [[a, 0, b], [a, 0, -b], [a, h, 0]], [[-a, 0, -b], [-a, 0, b], [-a, h, 0]]];
        const pos = [], idx = [];
        for (const f of F) { const o = pos.length / 3; f.forEach((v) => pos.push(...v)); idx.push(o, o + 1, o + 2); if (f.length === 4) idx.push(o, o + 2, o + 3); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2)); g.setIndex(idx); g.computeVertexNormals();
        return at(paint(put(g, x, y, z, yaw), col), x, z);
    };
    const HSL = (h, s, l) => new THREE.Color().setHSL(h, s, l);
    const tall = [];
    const faceSigns = [];

    if (def.theme === 'city') {
        const fT = facade(256, 256, 10, 10, '#1a2232', '#2b3447', '#0d1626', 5, 0.28), fG = facade(256, 256, 6, 10, '#26405e', '#9fb2c8', '#1b3352', 3, 0.25), fC = facade(256, 256, 8, 7, '#a39c90', '#7c766c', '#1b2230', 7, 0.3);
        const mats = [winMat(fT, { roughness: 0.55, metalness: 0.4, envMapIntensity: 0.9 }), winMat(fG, { roughness: 0.2, metalness: 0.7, envMapIntensity: 1.3 }), winMat(fC, { roughness: 0.85 })];
        tryPlace(5000, def.buildings, 8, 18, 9, (x, z, rad, yaw, q) => {
            const w = rad * R(1.1, 1.5), d = rad * R(1.1, 1.5), kind = Math.floor(rand() * 3);
            const h = kind === 2 ? R(14, 40) : R(30, rand() < 0.3 ? 170 : 90);
            const col = kind === 2 ? HSL(R(0.05, 0.12), R(0.1, 0.3), R(0.55, 0.8)) : HSL(R(0.55, 0.65), R(0.05, 0.25), R(0.6, 0.9));
            geoTo('b' + kind, box(w, h, d, x, z, yaw, col, kind === 2 ? 18 : 24, kind === 2 ? 18 : 28));
            if (h > 60 && rand() < 0.55) geoTo('b' + kind, box(w * 0.6, h * 0.25, d * 0.6, x, z, yaw, col, 24, 28, h));
            const top = h > 60 ? h * (rand() < 0.5 ? 1.25 : 1) : h;
            if (h > 70) tall.push([x, top + 1.5, z]);
            if (q.d < 80 && h > 16) { faceSigns.push({ x, z, w, d, h, yaw, q }); if (h > 40) faceSigns.push({ x, z, w, d, h, yaw, q }); }
        });
        mats.forEach((m, k) => flush('b' + k, m));
        // 네온사인: 코스를 향한 건물 벽면에 붙인다
        const neonWords = [['HOTEL', '#ff4fa3'], ['BAR', '#3ff0ff'], ['CAFE', '#ffd84a'], ['24H', '#7cff6b'], ['노래방', '#ff5ad1'], ['PC방', '#5aa8ff'], ['SODIUM', '#ffb454'], ['치킨', '#ff7a1a'], ['CLUB', '#b46bff'], ['약국', '#4dff9a']];
        neonWords.forEach(([word, col], k) => {
            const t = tex(256, 96, (c, w, h) => {
                c.fillStyle = '#05060a'; c.fillRect(0, 0, w, h); c.strokeStyle = col; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
                c.font = `900 56px ${KO}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = col; c.shadowBlur = 18; c.fillStyle = col; c.fillText(word, w / 2, h / 2 + 2); c.fillStyle = '#fff'; c.shadowBlur = 0; c.globalAlpha = 0.6; c.fillText(word, w / 2, h / 2 + 2);
            }, false);
            const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false }); neonMats.push(m);
            const mine = faceSigns.filter((_, i) => i % neonWords.length === k);
            inst(new THREE.PlaneGeometry(11, 4.1), m, mine.length, (i) => {
                const f = mine[i], s = S[f.q.i], side = Math.sign((s.p.x - f.x) * s.n.x + (s.p.z - f.z) * s.n.z) || 1;
                const cyaw = f.yaw, nx = Math.sin(cyaw) * side, nz = Math.cos(cyaw) * side; // 건물 로컬 z축 = 법선 방향
                D.position.set(f.x + nx * (f.d / 2 + 0.15) + Math.cos(cyaw) * R(-f.w / 4, f.w / 4), Math.min(f.h - 3, R(5, 22)), f.z + nz * (f.d / 2 + 0.15) - Math.sin(cyaw) * R(-f.w / 4, f.w / 4)); D.rotation.y = cyaw + (side > 0 ? 0 : Math.PI);
            });
        });
        // 대형 전광판 (중층 빌딩 옥상)
        const scr = ['SODIUM GP', 'NIGHT RACE', 'VOLT', 'NEON CITY'].map((w, k) => tex(512, 256, (c, W2, H2) => {
            const g = c.createLinearGradient(0, 0, W2, H2); g.addColorStop(0, ['#ff3d7f', '#2b6bff', '#ffb454', '#7a3dff'][k]); g.addColorStop(1, '#0b0e1a'); c.fillStyle = g; c.fillRect(0, 0, W2, H2);
            c.font = `italic 900 92px "Segoe UI",Arial,sans-serif`; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(w, W2 / 2, H2 / 2);
        }, false));
        scr.forEach((t, k) => {
            const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false, side: THREE.DoubleSide }); neonMats.push(m);
            const mine = faceSigns.filter((f, i) => i % 7 === k && f.h < 50);
            inst(new THREE.PlaneGeometry(18, 9), m, mine.length, (i) => { const f = mine[i], s = S[f.q.i]; D.position.set(f.x, f.h + 4.6, f.z); D.rotation.y = s.yaw; });
        });
        // 도심 스카이라인
        const far = [];
        for (let i = 0; i < 160; i++) { const a = rand() * Math.PI * 2, r = R0 + 160 + rand() * 300; far.push(box(R(24, 50), R(90, 300), R(24, 50), ctr.x + Math.cos(a) * r, ctr.z + Math.sin(a) * r, rand() * 3, HSL(R(0.55, 0.65), 0.15, R(0.5, 0.8)), 24, 28)); }
        group.add(new THREE.Mesh(mergeGeometries(far), mats[0]));
    } else if (def.theme === 'river') {
        // 주택가: 박공지붕 단독주택 + 저층 아파트
        const fH = facade(128, 64, 2, 1, '#e8e4dc', '#6b5a48', '#2a3442', 12, 0.45), fA = facade(256, 256, 6, 8, '#d8d2c6', '#8a8274', '#2a3442', 6, 0.4);
        const houseM = winMat(fH, { roughness: 0.9, k: 0.8 }), aptM = winMat(fA, { roughness: 0.85 }), roofM = flat({ roughness: 0.7 });
        const roofs = [HSL(0.02, 0.5, 0.35), HSL(0.58, 0.25, 0.3), HSL(0.08, 0.35, 0.28), HSL(0, 0, 0.25), HSL(0.35, 0.2, 0.3)];
        tryPlace(6000, Math.round(def.buildings * 1.6), 5, 8, 10, (x, z, rad, yaw) => {
            const w = rad * R(1.3, 1.6), d = rad * R(1.1, 1.3), fl = rand() < 0.6 ? 1 : 2, h = fl * 3.2 + 0.4, col = HSL(R(0, 0.15), R(0.15, 0.45), R(0.62, 0.86));
            geoTo('h', box(w, h, d, x, z, yaw, col, 8, 3.2 * (h / (fl * 3.2 + 0.4))));
            geoTo('r', prism(w + 0.8, R(2.2, 3.4), d + 0.9, x, h, z, yaw, pick(roofs)));
        });
        tryPlace(2500, Math.round(def.buildings * 0.25), 10, 15, 22, (x, z, rad, yaw) => {
            const h = R(18, 42); geoTo('a', box(rad * 1.6, h, rad * 1.1, x, z, yaw, HSL(R(0.05, 0.6), 0.12, R(0.65, 0.85)), 18, 12));
        });
        flush('h', houseM); flush('r', roofM); flush('a', aptM);
        // 대관람차
        if (RIV) {
            for (let tr = 0; tr < 200; tr++) {
                const r = RIV[Math.floor(R(0.2, 0.8) * RIV.length)], sd = rand() < 0.5 ? 1 : -1, c = r.p.clone().addScaledVector(r.n, sd * (RW + 22));
                const dq = near(c.x, c.z, 200).d; if (dq < 60 || dq > 150 || !free(c.x, c.z, 24)) continue;
                B.push({ x: c.x, z: c.z, rad: 24 });
                const g = new THREE.Group(), wheel = new THREE.Group(), RAD = 19, steel = new THREE.MeshStandardMaterial({ color: 0xeef1f5, metalness: 0.5, roughness: 0.4 });
                g.position.copy(c); g.rotation.y = Math.atan2(-r.t.z, r.t.x); wheel.position.y = RAD + 3;
                for (const z of [-1.3, 1.3]) { const t = new THREE.Mesh(new THREE.TorusGeometry(RAD, 0.35, 6, 64), steel); t.position.z = z; wheel.add(t); }
                const neonRing = new THREE.MeshBasicMaterial({ color: 0xffb454, toneMapped: false }); neonMats.push(neonRing);
                const ring = new THREE.Mesh(new THREE.TorusGeometry(RAD + 0.4, 0.12, 4, 96), neonRing); wheel.add(ring);
                const cabs = [];
                for (let k = 0; k < 18; k++) {
                    const a = (k / 18) * Math.PI * 2, sp = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, RAD, 4), steel);
                    sp.position.set(Math.cos(a) * RAD / 2, Math.sin(a) * RAD / 2, 0); sp.rotation.z = a - Math.PI / 2; wheel.add(sp);
                    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 1.8).translate(0, -1.4, 0), new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(k / 18, 0.6, 0.55), roughness: 0.5 }));
                    cab.position.set(Math.cos(a) * RAD, Math.sin(a) * RAD, 0); wheel.add(cab); cabs.push(cab);
                }
                for (const z of [-3, 3]) for (const x of [-1, 1]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, RAD + 4.5, 6), steel); leg.position.set(x * 5, (RAD + 3) / 2, z); leg.rotation.z = -x * 0.25; leg.castShadow = true; g.add(leg); }
                g.add(wheel); group.add(g); info.ferris = [c.x, c.z]; wheel.userData.anim = true; cabs.forEach((cb) => { cb.userData.anim = true; });
                anims.push((t) => { wheel.rotation.z = t * 0.05; cabs.forEach((cb) => { cb.rotation.z = -wheel.rotation.z; }); });
                break;
            }
            // 보트: 다리 밑을 통과하지 않도록 코스와 먼 구간 안에서만 왕복
            const freeSeg = [], blocked = RIV.map((r) => near(r.p.x, r.p.z, RW + 40).d < RW + W);
            for (let i = 0, s0 = -1; i <= RIV.length; i++) { const ok = i < RIV.length && !blocked[i]; if (ok && s0 < 0) s0 = i; if (!ok && s0 >= 0) { if (i - s0 > 25) freeSeg.push([s0 + 3, i - 3]); s0 = -1; } }
            const hullM = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }), cabM = new THREE.MeshStandardMaterial({ color: 0x23324a, roughness: 0.3, metalness: 0.4 });
            for (let k = 0; k < 7 && freeSeg.length; k++) {
                const [a, b] = freeSeg[k % freeSeg.length], boat = new THREE.Group(), hg = new THREE.BoxGeometry(9, 1.2, 3.2), p = hg.attributes.position;
                for (let i = 0; i < p.count; i++) if (p.getX(i) > 2) p.setZ(i, p.getZ(i) * (1 - (p.getX(i) - 2) / 5));
                hg.computeVertexNormals();
                const hull = new THREE.Mesh(hg, hullM); hull.position.y = 0.4; const cab = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.3, 2.4), cabM); cab.position.set(-1, 1.5, 0);
                boat.add(hull, cab); hull.castShadow = true; group.add(boat); boat.userData.anim = true;
                const lat = R(-RW + 6, RW - 6), v = R(0.6, 1.2), ph = rand() * 1000;
                anims.push((t) => {
                    const span = b - a, u = ((t * v * 0.25 + ph) % (2 * span)), fw = u < span, f = a + (fw ? u : 2 * span - u), i0 = Math.floor(f), r = RIV[i0], r1 = RIV[Math.min(i0 + 1, RIV.length - 1)], fr = f - i0;
                    boat.position.set(r.p.x + (r1.p.x - r.p.x) * fr + r.n.x * lat, 0.02, r.p.z + (r1.p.z - r.p.z) * fr + r.n.z * lat);
                    boat.rotation.y = Math.atan2(-r.t.z, r.t.x) + (fw ? 0 : Math.PI);
                });
            }
        }
        // 먼 언덕과 강 건너 도심
        const hills = [];
        for (let i = 0; i < 46; i++) { const a = rand() * Math.PI * 2, r = R0 + 380 + rand() * 300, h = R(40, 130); hills.push(at(paint(new THREE.ConeGeometry(R(90, 180), h, 7, 1).translate(ctr.x + Math.cos(a) * r, h / 2 - 4, ctr.z + Math.sin(a) * r), HSL(R(0.25, 0.36), 0.3, R(0.16, 0.26))), 0, 0)); }
        group.add(new THREE.Mesh(mergeGeometries(hills), flat({ flatShading: true, roughness: 1 })));
        const far = [], ang = rand() * Math.PI * 2;
        for (let i = 0; i < 50; i++) { const a = ang + R(-0.6, 0.6), r = R0 + 200 + rand() * 160; far.push(box(R(22, 40), R(50, 160), R(22, 40), ctr.x + Math.cos(a) * r, ctr.z + Math.sin(a) * r, rand() * 3, HSL(0.6, 0.1, R(0.6, 0.85)), 18, 12)); }
        group.add(new THREE.Mesh(mergeGeometries(far), aptM));
    } else {
        // 항구: 창고, 컨테이너 야적장, 오일 탱크, 크레인, 선박, 등대
        const fW = facade(256, 128, 6, 2, '#b8bcc2', '#8e939b', '#2a3138', 18, 0.15);
        const corr = tex(64, 64, (c, w, h) => { c.fillStyle = '#d6d9de'; c.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 4) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(i, 0, 1.5, h); } });
        const wareM = winMat(fW, { roughness: 0.6, metalness: 0.4, k: 0.6 });
        tryPlace(4000, Math.round(def.buildings * 0.45), 12, 24, 12, (x, z, rad, yaw) => {
            geoTo('w', box(rad * 2.2, R(9, 16), rad * 1.2, x, z, yaw, HSL(pick([0.55, 0.58, 0.48, 0.05, 0]), R(0.05, 0.35), R(0.55, 0.85)), 30, 12));
        });
        flush('w', wareM);
        // 컨테이너 야적장
        const cont = [], palette = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf39c12, 0x8e44ad, 0xe8e8e8, 0x16a085, 0xd35400, 0x34495e].map((c) => new THREE.Color(c));
        tryPlace(3000, 22, 18, 30, 14, (x, z, rad, yaw) => {
            const cols = Math.floor(rad / 3.2), rows = Math.floor(rad / 7.5), c = Math.cos(yaw), s = Math.sin(yaw);
            for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
                const lx = (i - cols / 2) * 3.1, lz = (j - rows / 2) * 13.5, h = 1 + Math.floor(rand() * 4);
                if (rand() < 0.12) continue;
                const px = x + lz * c + lx * s, pz = z - lz * s + lx * c;
                for (let k = 0; k < h; k++) cont.push([px, k * 2.6, pz, yaw, pick(palette)]);
            }
        });
        inst(new THREE.BoxGeometry(12.2, 2.6, 2.45).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ map: corr, roughness: 0.7, metalness: 0.3 }), cont.length, (i, col) => { const [x, y, z, yaw, c] = cont[i]; D.position.set(x, y, z); D.rotation.y = yaw; col(c); }, true);
        // 오일 탱크
        const tanks = [];
        tryPlace(1500, 5, 14, 20, 20, (x, z, rad) => { for (let k = 0; k < 3; k++) { const a = k * 2.1, r = R(6, 9); tanks.push([x + Math.cos(a) * rad * 0.5, z + Math.sin(a) * rad * 0.5, r, R(10, 16)]); } });
        inst(new THREE.CylinderGeometry(1, 1, 1, 20).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.45, metalness: 0.3 }), tanks.length, (i) => { const [x, z, r, h] = tanks[i]; D.position.set(x, 0, z); D.scale.set(r, h, r); }, true);
        // 해안선 찾기: 육지 위, 한쪽 방향 18m 앞이 바다인 지점
        const shore = [];
        for (let t = 0; t < 6000 && shore.length < 60; t++) {
            const x = bb.x0 - 300 + rand() * (bb.x1 - bb.x0 + 600), z = bb.z0 - 300 + rand() * (bb.z1 - bb.z0 + 600);
            if (!isLand(x, z) || isLand(x + 2, z) !== isLand(x, z)) continue;
            let sx = 0, sz = 0, n = 0;
            for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; if (!isLand(x + Math.cos(a) * 18, z + Math.sin(a) * 18)) { sx += Math.cos(a); sz += Math.sin(a); n++; } }
            if (n < 3 || n > 9 || !isLand(x - (sx / n) * 6, z - (sz / n) * 6)) continue;
            const q = near(x, z, 80); if (q.d < 36) continue;
            shore.push({ x, z, a: Math.atan2(sz, sx) });
        }
        // 갠트리 크레인 (붐이 바다 쪽을 향함)
        const craneG = [], cranes = [], ships = [];
        for (const s of shore) {
            if (cranes.length >= 6 || cranes.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 45) || !free(s.x, s.z, 10, 2)) continue;
            cranes.push(s); B.push({ x: s.x, z: s.z, rad: 12 });
            const col = cranes.length % 2 ? HSL(0.0, 0.7, 0.45) : HSL(0.58, 0.6, 0.45), wh = HSL(0, 0, 0.9), yaw = -s.a, parts = [];
            const P2 = (g, x, y, z, c) => parts.push(paint(g.translate(x, y, z), c));
            for (const lx of [-7, 7]) for (const lz of [-6, 6]) P2(new THREE.BoxGeometry(1.2, 32, 1.2), lx, 16, lz, col);
            for (const lz of [-6, 6]) P2(new THREE.BoxGeometry(16, 1.4, 1.4), 0, 31, lz, col);
            for (const lx of [-7, 7]) P2(new THREE.BoxGeometry(1.4, 1.4, 13), lx, 14, 0, col);
            P2(new THREE.BoxGeometry(72, 2.2, 3), 22, 34, 0, wh); P2(new THREE.BoxGeometry(8, 5, 8), -10, 36, 0, col); P2(new THREE.BoxGeometry(3, 3, 3.4), 30, 31.5, 0, HSL(0, 0, 0.3));
            P2(new THREE.BoxGeometry(1, 16, 1), -2, 42, 0, col);
            const g = mergeGeometries(parts); g.rotateY(yaw).translate(s.x, 0, s.z); at(g, s.x, s.z); craneG.push(g);
            tall.push([s.x + Math.cos(s.a) * 58, 35.6, s.z + Math.sin(s.a) * 58]);
            ships.push({ x: s.x + Math.cos(s.a) * 34, z: s.z + Math.sin(s.a) * 34, yaw: yaw + Math.PI / 2 });
        }
        info.cranes = cranes.map((c) => [c.x, c.z]);
        if (craneG.length) { const m = new THREE.Mesh(mergeGeometries(craneG), flat({ roughness: 0.5, metalness: 0.4 })); m.castShadow = true; group.add(m); }
        // 컨테이너선: 크레인 앞에 정박 + 먼 바다
        for (let t = 0; t < 400 && ships.length < 14; t++) {
            const a = rand() * Math.PI * 2, r = R0 + R(150, 600), x = ctr.x + Math.cos(a) * r, z = ctr.z + Math.sin(a) * r;
            if (!isLand(x, z) && !isLand(x + 80, z) && !isLand(x - 80, z) && !isLand(x, z + 80) && !isLand(x, z - 80)) ships.push({ x, z, yaw: rand() * 3 });
        }
        const shipG = [], shipC = [];
        ships.forEach((s, k) => {
            const L = k < cranes.length ? 120 : R(70, 160), parts = [], hull = HSL(pick([0.0, 0.6, 0.35]), 0.5, 0.25);
            parts.push(paint(new THREE.BoxGeometry(L, 9, 20).translate(0, 0.5, 0), hull), paint(new THREE.BoxGeometry(L * 0.98, 1, 19).translate(0, 5.2, 0), HSL(0, 0, 0.75)), paint(new THREE.BoxGeometry(12, 14, 18).translate(-L / 2 + 10, 12, 0), HSL(0, 0, 0.92)));
            const g = mergeGeometries(parts); g.rotateY(s.yaw).translate(s.x, -0.9, s.z); at(g, s.x, s.z); shipG.push(g);
            for (let i = 0; i < Math.floor((L - 30) / 12.5); i++) for (let j = -3; j <= 3; j++) { const h = 1 + Math.floor(rand() * 3); for (let y = 0; y < h; y++) shipC.push([s, -L / 2 + 22 + i * 12.5, j * 2.5, 3.9 + y * 2.6]); }
        });
        if (shipG.length) group.add(new THREE.Mesh(mergeGeometries(shipG), flat({ roughness: 0.6 })));
        inst(new THREE.BoxGeometry(12.2, 2.6, 2.45).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ map: corr, roughness: 0.7, metalness: 0.3 }), shipC.length, (i, col) => {
            const [s, lx, lz, y] = shipC[i], c = Math.cos(s.yaw), sn = Math.sin(s.yaw); D.position.set(s.x + lx * c + lz * sn, y, s.z - lx * sn + lz * c); D.rotation.y = s.yaw; col(palette[(i * 7 + (i >> 3)) % palette.length]);
        });
        // 등대: 코스에서 가장 먼 해안 지점, 밤에 회전하는 빛줄기
        const lh = shore.filter((s) => free(s.x, s.z, 6, 1)).sort((a, b) => near(b.x, b.z, 400).d - near(a.x, a.z, 400).d)[0];
        if (lh) {
            const g = new THREE.Group(); g.position.set(lh.x, 0, lh.z);
            for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - (k + 1) * 0.22, 2.6 - k * 0.22, 4, 16), new THREE.MeshStandardMaterial({ color: k % 2 ? 0xd8312a : 0xf4f4f4, roughness: 0.6 })); m.position.y = 2 + k * 4; m.castShadow = true; g.add(m); }
            const lampM = new THREE.MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false }); neonMats.push(lampM);
            const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 12), lampM); lamp.position.y = 25.1; g.add(lamp);
            const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2, 12), new THREE.MeshStandardMaterial({ color: 0x23262e })); cap.position.y = 27.2; g.add(cap);
            const beam = new THREE.Group(); beam.position.y = 25.1;
            const fade = tex(4, 128, (c) => { const g = c.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#fff'); g.addColorStop(0.35, '#555'); g.addColorStop(1, '#000'); c.fillStyle = g; c.fillRect(0, 0, 4, 128); }, false);
            const bm = new THREE.MeshBasicMaterial({ color: 0xfff0c0, alphaMap: fade, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
            for (const sd of [1, -1]) { const c = new THREE.Mesh(new THREE.ConeGeometry(7, 110, 16, 1, true).translate(0, -55, 0).rotateZ(sd * Math.PI / 2), bm); beam.add(c); }
            g.add(beam); group.add(g); info.lighthouse = [lh.x, lh.z]; beam.userData.anim = true; nightOnly.push(beam);
            anims.push((t) => { beam.rotation.y = t * 0.9; });
        }
        // 본토 쪽 먼 스카이라인
        const far = [];
        for (let i = 0; i < 240 && far.length < 70; i++) { const a = rand() * Math.PI * 2, r = R0 + 160 + rand() * 300, x = ctr.x + Math.cos(a) * r, z = ctr.z + Math.sin(a) * r; if (isLand(x, z) && near(x, z, 100).d > 90) far.push(box(R(24, 44), R(40, 140), R(24, 44), x, z, rand() * 3, HSL(0.58, 0.12, R(0.5, 0.8)), 30, 12)); }
        if (far.length) group.add(new THREE.Mesh(mergeGeometries(far), wareM));
    }

    // 고층 건물·크레인 꼭대기 항공 장애 표시등
    inst(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }), tall.length, (i) => D.position.set(...tall[i]));

    // ── 가로등
    const lamps = [], L = T.lamp;
    for (let i = 0; i < N; i += L.every) for (const sd of [-1, 1]) {
        const s = S[i], o = sd * (W / 2 + 3.6);
        if (wet(s.p.x + s.n.x * o * 3, s.p.z + s.n.z * o * 3) && !bridge[i]) continue;
        lamps.push({ x: s.p.x + s.n.x * o, z: s.p.z + s.n.z * o, sd, s });
    }
    inst(new THREE.CylinderGeometry(0.09, 0.14, L.h, 6).translate(0, L.h / 2, 0), new THREE.MeshStandardMaterial({ color: def.theme === 'river' ? 0x1f3a2c : 0x2a2d35, metalness: 0.4 }), lamps.length, (i) => D.position.set(lamps[i].x, 0, lamps[i].z), true);
    const headG = def.theme === 'harbor' ? new THREE.BoxGeometry(2.4, 0.5, 1.2) : def.theme === 'river' ? new THREE.SphereGeometry(0.4, 10, 8) : new THREE.BoxGeometry(1.8, 0.12, 0.45);
    const heads = inst(headG, new THREE.MeshBasicMaterial({ color: L.color, toneMapped: false }), lamps.length, (i) => { const l = lamps[i], k = def.theme === 'river' ? 0 : 0.8; D.position.set(l.x - l.s.n.x * l.sd * k, L.h, l.z - l.s.n.z * l.sd * k); D.rotation.y = l.s.yaw; });
    const pool = L.h * 2.4;
    const pools = inst(new THREE.PlaneGeometry(pool, pool).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }), lamps.length, (i) => { const l = lamps[i]; D.position.set(l.x - l.s.n.x * l.sd * 5, 0.1, l.z - l.s.n.z * l.sd * 5); });

    // ── 나무
    const trees = [], spacing = Math.max(2, Math.round((def.theme === 'city' ? 5 : def.theme === 'harbor' ? 7 : 3) / density));
    for (let i = 0; i < N; i += spacing) for (const sd of [-1, 1]) {
        if (startZone(i) || bridge[i]) continue;
        const s = S[i], o = sd * (W / 2 + (def.theme === 'city' ? 5.2 : 10 + rand() * 3)), x = s.p.x + s.n.x * o, z = s.p.z + s.n.z * o;
        if (wet(x, z, 3) || !free(x, z, 1, 0)) continue;
        trees.push([x, z, def.theme === 'city' ? 0.6 + rand() * 0.25 : 0.8 + rand() * 0.6, def.theme === 'river' ? rand() < 0.7 : true]);
    }
    for (let t = 0, want = Math.floor(def.trees * density); t < 3000 && want > 0; t++) {
        const x = bb.x0 - 150 + rand() * (bb.x1 - bb.x0 + 300), z = bb.z0 - 150 + rand() * (bb.z1 - bb.z0 + 300);
        if (near(x, z, 40).d < 30 || wet(x, z, 4) || !free(x, z, 2, 1)) continue;
        trees.push([x, z, 0.9 + rand() * 0.9, def.theme === 'river' ? rand() < 0.55 : def.theme === 'city']); want--;
    }
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x4a3626 }), crownM = new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.3 });
    const place = (t, i) => { D.position.set(t[0], 0, t[1]); D.rotation.y = i; D.scale.setScalar(t[2]); };
    inst(new THREE.CylinderGeometry(0.14, 0.2, 2.4, 6).translate(0, 1.2, 0), trunkM, trees.length, (i) => place(trees[i], i), true);
    const round = trees.filter((t) => t[3]), cone = trees.filter((t) => !t[3]);
    const roundG = mergeGeometries([new THREE.IcosahedronGeometry(2.2, 1).translate(0, 4.2, 0), new THREE.IcosahedronGeometry(1.6, 1).translate(0.9, 5.4, 0.4)]);
    inst(roundG, crownM, round.length, (i, col) => { place(round[i], i); col(HSL(0.22 + rand() * 0.12, 0.45, 0.2 + rand() * 0.14)); }, true);
    const coneG = mergeGeometries([new THREE.ConeGeometry(1.7, 3.6, 7).translate(0, 3.4, 0), new THREE.ConeGeometry(1.3, 3, 7).translate(0, 5.2, 0), new THREE.ConeGeometry(0.9, 2.4, 7).translate(0, 6.8, 0)]);
    inst(coneG, crownM, cone.length, (i, col) => { place(cone[i], i); col(HSL(0.28 + rand() * 0.08, 0.45, 0.16 + rand() * 0.1)); }, true);
    if (def.theme === 'city') {
        const planters = trees.filter((t) => t[2] < 0.9);
        inst(new THREE.BoxGeometry(2, 0.6, 2).translate(0, 0.3, 0), new THREE.MeshStandardMaterial({ color: 0x8a8c92, roughness: 0.9 }), planters.length, (i) => D.position.set(planters[i][0], 0.08, planters[i][1]));
    }

    // ── 배리어 + 광고판
    const bars = [], [ca, cb, every] = T.barrier, colA = new THREE.Color(ca), colB = new THREE.Color(cb);
    for (let i = 0; i < N; i += 2) for (const sd of [-1, 1]) { const s = S[i], o = sd * (W / 2 + 1.5); bars.push({ x: s.p.x + s.n.x * o, z: s.p.z + s.n.z * o, yaw: s.yaw, i, sd }); }
    inst(new THREE.BoxGeometry(9, T.barrierH, 1), new THREE.MeshStandardMaterial({ roughness: 0.85 }), bars.length, (i, col) => {
        const b = bars[i]; D.position.set(b.x, T.barrierH / 2, b.z); D.rotation.y = b.yaw; col((i >> 1) % every === 0 ? colB : colA);
    }, true);
    T.ads.forEach(([text, bg, fg], k) => {
        const list = bars.filter((b) => b.i % 10 === 0 && ((b.i / 10 + (b.sd > 0 ? 1 : 0)) | 0) % T.ads.length === k && !startZone(b.i));
        inst(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshBasicMaterial({ map: banner(text, bg, fg), side: THREE.DoubleSide }), list.length, (i) => {
            const b = list[i], s = S[b.i], o = b.sd * (W / 2 + 2.3);
            D.position.set(s.p.x + s.n.x * o, T.barrierH + 0.75, s.p.z + s.n.z * o); D.rotation.y = b.yaw + (b.sd > 0 ? Math.PI : 0);
        });
    });

    // ── 스타트 게이트, 육교, 관중석
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.6 });
    const gantry = (i, label, bridgeType) => {
        const g = new THREE.Group(), s = S[i], h = bridgeType ? 6.4 : 7.2;
        g.position.copy(s.p); g.rotation.y = s.yaw;
        for (const z of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), dark); p.position.set(0, h / 2, z * (W / 2 + 3.2)); p.castShadow = true; g.add(p); }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(bridgeType === 2 ? 3.2 : 1.4, 1.5, W + 7.6), bridgeType === 2 ? new THREE.MeshStandardMaterial({ color: 0x7fa7c9, metalness: 0.8, roughness: 0.1, transparent: true, opacity: 0.75 }) : dark);
        beam.position.y = h; beam.castShadow = true; g.add(beam);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, W + 4), new THREE.MeshBasicMaterial({ color: 0xffb454, toneMapped: false })); strip.position.set(-0.75 - (bridgeType === 2 ? 0.9 : 0), h - 0.8, 0); g.add(strip);
        if (label) for (const k of [-1, 1]) { const b = new THREE.Mesh(new THREE.PlaneGeometry(W + 3, 1.2), new THREE.MeshBasicMaterial({ map: label })); b.position.set(k * (bridgeType === 2 ? 1.62 : 0.72), h, 0); b.rotation.y = k * -Math.PI / 2; g.add(b); }
        group.add(g);
    };
    const G = T.gates.map(([a, b, c]) => banner(a, b, c));
    gantry(0, G[0], 0);
    for (let k = 1; k < G.length; k++) {
        let i = Math.floor((N * k) / G.length);
        while (bridge[i] && i < N - 1) i++;
        gantry(i, G[k], def.theme === 'city' ? 2 : 1);
    }

    const crowd = tex(256, 64, (c, w, h) => { c.fillStyle = '#1b1d24'; c.fillRect(0, 0, w, h); for (let i = 0; i < 1400; i++) { c.fillStyle = `hsl(${rand() * 360},55%,${40 + rand() * 25}%)`; c.fillRect(rand() * w, rand() * h, 3, 4); } });
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

    // 코스는 움직이지 않으므로 행렬 자동 갱신을 끈다 (애니메이션 물체만 예외)
    group.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = !!o.userData.anim; });

    return {
        group, S, N, len, def, W, limit: LIM, info,
        grid(k) {
            const s = S[0], row = k >> 1, col = k & 1;
            // 엇갈린 그리드: 한 줄 간격을 넓히고 왼쪽 열을 앞으로 내보내 나란히 출발하는 충돌을 줄인다
            return { pos: s.p.clone().addScaledVector(s.t, -(8 + row * 12 + (col ? 6 : 0))).addScaledVector(s.n, col ? 3.2 : -3.2), yaw: s.yaw };
        },
        setTime(t) {
            lit.forEach(([m, k]) => { m.emissiveIntensity = t.win * k; });
            const nk = t.lamp ? 1.6 : 0.7; neonMats.forEach((m) => { m.color.setScalar(nk); });
            pools.forEach((m) => { m.visible = !!t.lamp; }); heads.forEach((m) => { m.visible = true; m.material.color.set(L.color).multiplyScalar(t.lamp ? 1.4 : 0.55); });
            nightOnly.forEach((o) => { o.visible = !!t.lamp; });
        },
        update(time) { for (const a of anims) a(time); },
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
            const seen = new Set();
            group.traverse((o) => {
                o.geometry?.dispose(); o.dispose?.();
                for (const m of [].concat(o.material || [])) { if (seen.has(m)) continue; seen.add(m); m.map?.dispose(); m.emissiveMap?.dispose(); m.alphaMap?.dispose(); m.dispose(); }
            });
        },
    };
}
