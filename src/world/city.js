import * as THREE from 'three';
import * as C from 'cannon-es';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Buildings, tower, midrise, roofProps } from './buildings.js';
import { mergeStatic } from '../util/merge.js';
import { facadeArray, facadeMaterial } from './facades.js';
import { noise2, terrain, oceanMaterial, seaMesh, foam, palmGeo, umbrellaGeo, lighthouse, turbine } from './nature.js';

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
    coast: {
        ground: 'terrain', barrier: [0xeef0f2, 0xd23a32, 5], barrierH: 0.85, lamp: { every: 9, h: 8, color: 0xffe2b0, glow: 'rgba(255,214,150,.55)' },
        ads: [['SEA BREEZE', '#1d6f8e', '#ffffff'], ['SURF CLUB', '#f2b632', '#14161c'], ['SODIUM', '#10131f', '#ffb454'], ['BLUE COAST', '#13315c', '#ffffff']],
        gates: [['SODIUM GP', '#10131f', '#ffffff'], ['BLUE COAST', '#13315c', '#ffffff'], ['SURF CLUB', '#f2b632', '#14161c']],
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
        const buckets = new Map(), meshes = [], CI = CH * 2, cki = (x, z) => `${Math.floor(x / CI)},${Math.floor(z / CI)}`;
        for (let i = 0; i < n; i++) {
            D.position.set(0, 0, 0); D.rotation.set(0, 0, 0); D.scale.set(1, 1, 1);
            let col = null; fn(i, (c) => { col = c; }); D.updateMatrix();
            const k = cki(D.position.x, D.position.z); if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push([D.matrix.clone(), col]);
        }
        for (const list of buckets.values()) {
            const m = new THREE.InstancedMesh(geo, mat, list.length);
            list.forEach(([mx, c], i) => { m.setMatrixAt(i, mx); if (c) m.setColorAt(i, c); });
            m.computeBoundingSphere(); m.castShadow = shadow; m.receiveShadow = true; group.add(m); meshes.push(m);
        }
        return meshes;
    };
    // 아틀라스 텍스처의 k번째 줄을 쓰는 판(간판·광고) 여러 장을 청크별로 병합: 종류가 많아도 청크당 드로우콜 1번
    const atlas = (rows, w, h, draw) => tex(w, h * rows, (c) => { for (let k = 0; k < rows; k++) { c.save(); c.translate(0, k * h); c.beginPath(); c.rect(0, 0, w, h); c.clip(); draw(c, k, w, h); c.restore(); } }, false);
    const decals = (geo, mat, rows, items) => {
        const per = new Map();
        for (const [k, set] of items) {
            D.position.set(0, 0, 0); D.rotation.set(0, 0, 0); D.scale.set(1, 1, 1); set(); D.updateMatrix();
            const g = geo.clone().applyMatrix4(D.matrix), uv = g.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (k + 1) / rows + uv.getY(i) / rows);
            const key = ck(D.position.x, D.position.z); if (!per.has(key)) per.set(key, []); per.get(key).push(g);
        }
        for (const gs of per.values()) { const m = new THREE.Mesh(mergeGeometries(gs), mat); gs.forEach((g) => g.dispose()); group.add(m); }
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
    // 아스팔트: 골재 알갱이 + 바퀴가 지나가 매끈해진 자국 + 보수 자국. 거칠기 맵으로 바퀴 자국만 은은하게 반사된다
    const marks = [];
    for (let i = 0; i < 14; i++) marks.push([rand(), rand(), 0.02 + rand() * 0.08, 0.05 + rand() * 0.2]);
    const asphalt = tex(512, 512, (c, w, h) => {
        c.fillStyle = '#2b2e34'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 16000; i++) { const v = rand(); c.fillStyle = v < 0.45 ? `rgba(255,255,255,${0.03 + rand() * 0.05})` : `rgba(0,0,0,${0.06 + rand() * 0.1})`; c.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2); }
        for (const u of [0.2, 0.31, 0.69, 0.8]) { const g = c.createLinearGradient(u * w - 26, 0, u * w + 26, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, 'rgba(0,0,0,.16)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(u * w - 26, 0, 52, h); }
        for (const [x, y, a, b] of marks) { c.fillStyle = 'rgba(20,22,26,.35)'; c.fillRect(x * w, y * h, a * w, b * h); }
        c.strokeStyle = 'rgba(10,10,12,.5)'; c.lineWidth = 1.5; for (let i = 0; i < 5; i++) { c.beginPath(); let x = rand() * w, y = rand() * h; c.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rand() - 0.5) * 30; y += rand() * 25; c.lineTo(x, y); } c.stroke(); }
        c.fillStyle = '#e9ecf2'; c.fillRect(28, 0, 12, h); c.fillRect(w - 40, 0, 12, h);
        c.fillStyle = def.theme === 'harbor' || def.theme === 'coast' ? '#e9ecf2' : '#ffd15c'; c.fillRect(w / 2 - 5, 0, 10, h / 2);
    });
    const asphaltR = tex(256, 256, (c, w, h) => {
        c.fillStyle = '#c4c4c4'; c.fillRect(0, 0, w, h);
        for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${rand() < 0.5 ? '255,255,255' : '0,0,0'},.08)`; c.fillRect(rand() * w, rand() * h, 2, 2); }
        for (const u of [0.2, 0.31, 0.69, 0.8]) { const g = c.createLinearGradient(u * w - 13, 0, u * w + 13, 0); g.addColorStop(0, 'rgba(60,60,60,0)'); g.addColorStop(0.5, 'rgba(60,60,60,.55)'); g.addColorStop(1, 'rgba(60,60,60,0)'); c.fillStyle = g; c.fillRect(u * w - 13, 0, 26, h); }
        c.fillStyle = '#909090'; c.fillRect(14, 0, 6, h); c.fillRect(w - 20, 0, 6, h); c.fillRect(w / 2 - 3, 0, 6, h / 2);
    });
    asphaltR.colorSpace = THREE.NoColorSpace;
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
    const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, envMapIntensity: 0.4, ...o });
    const flat = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, envMapIntensity: 0.4, ...o });

    // ── 지면
    const groundTex = {
        grass: () => tex(256, 256, (c, w, h) => { c.fillStyle = '#2a3a2b'; c.fillRect(0, 0, w, h); for (let i = 0; i < 5000; i++) { c.fillStyle = `hsla(${85 + rand() * 40},35%,${14 + rand() * 18}%,.55)`; c.fillRect(rand() * w, rand() * h, 2, 3); } }),
        plaza: () => tex(256, 256, (c, w, h) => { c.fillStyle = '#4a4d55'; c.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.08)'; c.fillRect(rand() * w, rand() * h, 2, 2); } c.fillStyle = 'rgba(0,0,0,.25)'; for (let i = 0; i < 8; i++) { c.fillRect(i * 32, 0, 2, h); c.fillRect(0, i * 32, w, 2); } }),
        quay: () => tex(256, 256, (c, w, h) => { c.fillStyle = '#6f7277'; c.fillRect(0, 0, w, h); for (let i = 0; i < 3500; i++) { c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.09)'; c.fillRect(rand() * w, rand() * h, 2, 2); } c.fillStyle = 'rgba(0,0,0,.18)'; for (let i = 0; i < 4; i++) { c.fillRect(i * 64, 0, 2, h); c.fillRect(0, i * 64, w, 2); } c.fillStyle = 'rgba(240,200,60,.35)'; c.fillRect(0, 120, w, 3); }),
    }[T.ground === 'terrain' ? 'grass' : T.ground]();
    const gRep = T.ground === 'grass' ? 500 : T.ground === 'plaza' ? 250 : 220;
    groundTex.repeat.set(gRep, gRep);
    const groundMat = new THREE.MeshStandardMaterial({ map: groundTex, roughness: T.ground === 'grass' ? 1 : 0.92, envMapIntensity: 0.2, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 });
    const SPAN = 4000;
    let isLand = () => true, coast = null, H = () => -0.06;

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
        land.position.set(X0 + span / 2, -0.06, Z0 + span / 2); land.receiveShadow = true; group.add(land);
        groundTex.repeat.set(span / 18, span / 18);
        // 항구 바다: 물결 노멀맵이 흐르는 반사 수면
        const seaG = new THREE.PlaneGeometry(SPAN * 1.5, SPAN * 1.5, 1, 1).rotateX(-Math.PI / 2), sc = new THREE.Color(0x0e4a66);
        seaG.setAttribute('color', new THREE.Float32BufferAttribute([0, 1, 2, 3].flatMap(() => [sc.r, sc.g, sc.b]), 3)); scaleUV(seaG, SPAN / 30, SPAN / 30);
        const seaM = new THREE.Mesh(seaG, oceanMaterial(anims)); seaM.position.set(ctr.x, -0.9, ctr.z); group.add(seaM);
        // 안벽: 바다 쪽 가장자리를 따라 짙은 석축
        const quay = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3b3d42, roughness: 1, alphaMap: mask, alphaTest: 0.5 }));
        quay.position.set(X0 + span / 2, -0.45, Z0 + span / 2); quay.scale.setScalar(1.004); group.add(quay);
    } else if (T.ground === 'terrain') {
        // 해안: 해안선(coast) 바깥은 바다. 코스 주변은 평평하게, 해변은 바다 쪽으로 완만히 내려가고, 내륙은 언덕이 솟는다
        const cf = def.coast, sc = def.scale, hn = noise2(def.seed);
        coast = (x) => sc * (cf.z + 20 * Math.sin(x / (170 * sc) + 0.6) + 8 * Math.sin(x / (64 * sc))) + sc * cf.cape[1] * Math.exp(-(((x - sc * cf.cape[0]) / (sc * cf.cape[2])) ** 2));
        isLand = (x, z) => z < coast(x) - 2;
        H = (x, z) => {
            const dc = coast(x) - z;
            if (dc < 0) return Math.max(-9, dc * 0.12) - 0.42;
            const q = near(x, z, 160), d = q.i >= 0 ? q.d : 160;
            if (d < 21) return -0.06;
            const beach = -0.42 + 0.36 * Math.min(1, dc / 25);
            const hill = Math.max(0, hn(x / 260, z / 260) - 0.3) * 150 * Math.min(1, Math.max(0, (d - 26) / 140)) * Math.min(1, Math.max(0, (dc - 40) / 140));
            const verge = Math.min(1, (d - 21) / 8);
            return Math.max(beach, -0.06 + hill) * verge + -0.06 * (1 - verge);
        };
        const sand = new THREE.Color(0xdcccA4), wetSand = new THREE.Color(0xae9f7e), grass = new THREE.Color(0x5a7a42), grass2 = new THREE.Color(0x768a4a), dry = new THREE.Color(0x9a9460), rock = new THREE.Color(0x7a746a), tmp = new THREE.Color();
        const step = density >= 1 ? 8 : 12;
        terrain(group, {
            x0: bb.x0 - 650, x1: bb.x1 + 650, z0: bb.z0 - 650, z1: Math.max(...Array.from({ length: 60 }, (_, i) => coast(bb.x0 - 650 + i * (bb.x1 - bb.x0 + 1300) / 59))) + 90, step, height: H,
            color: (c, x, z, h, slope) => {
                const dc = coast(x) - z, n = hn(x / 9, z / 9, 2);
                if (dc < 34 && h < 0.6) { c.copy(dc < 3 ? wetSand : sand).multiplyScalar(0.92 + n * 0.16); return; }
                c.copy(grass).lerp(grass2, hn(x / 70, z / 70, 3)).lerp(dry, Math.min(1, Math.max(0, h / 80 + (hn(x / 140, z / 140, 2) - 0.5) * 0.9))).lerp(rock, Math.min(1, Math.max(0, (slope - 0.2) * 4)));
                c.multiplyScalar(0.85 + n * 0.3);
                if (h < 0.5) c.lerp(tmp.set(0x5b8040), 0.4);
            },
        });
        const om = oceanMaterial(anims), sea = seaMesh(coast, bb.x0 - 2600, bb.x1 + 2600, om); group.add(sea);
        foam(group, coast, bb.x0 - 650, bb.x1 + 650, anims);
    } else {
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(SPAN, SPAN).rotateX(-Math.PI / 2), groundMat);
        ground.position.set(ctr.x, -0.06, ctr.z); ground.receiveShadow = true; group.add(ground);
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
            const rv = new THREE.Mesh(ribbon(RIV, -RW, RW, -0.035, 30, false), wm); rv.receiveShadow = true; group.add(rv);
            anims.push((t) => { water.offset.y = -t * 0.04; });
            const bank = std({ color: 0x7a776d, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
            for (const sd of [-1, 1]) group.add(new THREE.Mesh(ribbon(RIV, sd * RW, sd * (RW + 3), -0.02, 10, false), bank));
        }
    }
    const wet = (x, z, m = 0) => !isLand(x, z) || riverD(x, z) < RW + m;

    // ── 도로·연석·인도
    const add = (a, b, y, mat, vs) => { const m = new THREE.Mesh(ribbon(S, a, b, y, vs), mat); m.receiveShadow = true; group.add(m); return m; };
    add(-W / 2, W / 2, 0.03, std({ map: asphalt, roughnessMap: asphaltR, roughness: 1, metalness: 0.05, envMapIntensity: 0.7 }), 12);
    const kerbM = std({ map: kerb, roughness: 0.7 }), walkM = std({ color: def.theme === 'city' ? 0x6a6d76 : 0x5a5d66, roughness: 0.95 });
    [1, -1].forEach((sd) => { add(sd * W / 2, sd * (W / 2 + 1), 0.045, kerbM, 3); add(sd * (W / 2 + 1), sd * (W / 2 + 7), 0.09, walkM, 10); });
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
    const tall = [], faceSigns = [], awnings = [], lampTops = [];

    // ── 해안 맵: 해변(파라솔·선베드·감시탑), 드문드문한 호텔·카페·언덕 위 빌라, 등대 곶, 요트, 풍력발전기
    function coastScene() {
        const dcOf = (x, z) => coast(x) - z, sc = def.scale;
        const inland = (s) => (dcOf(s.p.x + s.n.x * 30, s.p.z + s.n.z * 30) > dcOf(s.p.x - s.n.x * 30, s.p.z - s.n.z * 30) ? 1 : -1);
        const flatAt = (x, z, r) => { const hs = [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].map(([a, b]) => H(x + a, z + b)); return [Math.min(...hs), Math.max(...hs)]; };
        // 해변 도로변: 호텔과 카페
        let hotels = 0;
        for (let i = 6; i < N; i += 9) {
            if (startZone(i)) continue;
            const s = S[i], sd = inland(s), seaSide = dcOf(s.p.x, s.p.z) < 90;
            if (!seaSide) continue;
            if (hotels < 4 && rand() < 0.35) {
                const off = R(40, 52), x = s.p.x + s.n.x * sd * off, z = s.p.z + s.n.z * sd * off, w = R(26, 40), d = R(14, 18), h = 3 * Math.floor(R(5, 10)) + 4.5, [lo, hi] = flatAt(x, z, 16);
                if (hi - lo < 4 && free(x, z, 22) && near(x, z, 60).d > 34) { const y0 = lo - 0.5, tint = HSL(R(0.08, 0.14), R(0.05, 0.3), R(0.85, 0.98)), seed = rand(); BL.box(x, z, w + 0.6, d + 0.6, s.yaw, y0, y0 + 4.5, { layer: 'shop', tint, seed, roof: false }); BL.box(x, z, w, d, s.yaw, y0 + 4.5, y0 + h, { layer: 'hotel', tint, seed }); roofs.push({ x, z, y: y0 + h, w, d, yaw: s.yaw, kind: 'ac' }); B.push({ x, z, rad: 22 }); hotels++; continue; }
            }
            if (rand() < 0.45) {
                const off = R(22, 27), x = s.p.x + s.n.x * sd * off, z = s.p.z + s.n.z * sd * off, w = R(9, 14), d = R(7, 9), [lo] = flatAt(x, z, 6);
                if (!free(x, z, 7) || near(x, z, 40).d < 19) continue;
                const tint = HSL(rand(), R(0.2, 0.6), R(0.75, 0.95));
                BL.box(x, z, w, d, s.yaw, lo - 0.3, lo + 4, { layer: 'shop', tint, seed: rand(), roofLayer: 'stucco', roofTint: tint });
                awnings.push([x - s.n.x * sd * (d / 2 + 1), lo + 3, z - s.n.z * sd * (d / 2 + 1), s.yaw, w, HSL(rand(), 0.7, 0.5)]);
                B.push({ x, z, rad: 8 });
            }
        }
        // 언덕 위 빌라와 주택 (경사가 완만한 곳만)
        tryPlace(5000, def.buildings, 6, 11, 22, (x, z, rad, yaw) => {
            const dc = dcOf(x, z), [lo, hi] = flatAt(x, z, rad);
            if (dc < 70 || hi - lo > 5) return false;
            const y0 = lo - 1, tint = HSL(R(0.08, 0.14), R(0, 0.25), R(0.86, 0.98)), seed = rand(), w = rad * R(1.3, 1.7), d = rad * R(1.0, 1.3);
            if (rand() < 0.55) {
                // 모던 빌라: 흰 박스 두 개를 엇갈려 쌓고 큰 유리창
                BL.box(x, z, w, d, yaw, y0, lo + 3.4, { layer: 'ribbon', tint, seed });
                const c = Math.cos(yaw), s2 = Math.sin(yaw), o = R(-0.25, 0.25) * w;
                BL.box(x + c * o, z - s2 * o, w * 0.7, d * 0.85, yaw, lo + 3.4, lo + 6.6, { layer: 'ribbon', tint, seed });
            } else {
                const top = lo + 3.2 * (rand() < 0.5 ? 1 : 2);
                BL.box(x, z, w, d, yaw, y0, top, { layer: 'house', tint, seed, roof: false });
                BL.gable(x, z, w + 0.8, d + 0.9, yaw, top, R(2, 3), { tint: HSL(R(0.02, 0.06), R(0.5, 0.7), R(0.38, 0.5)), wallTint: tint, wall: 'stucco' });
            }
        });
        // 해변: 파라솔 무리 + 선베드, 감시탑
        const ub = [], lg = [], towers = [], pal = [0xe5483a, 0xf2b632, 0x2f7dd0, 0xffffff, 0x2fb36a, 0xff7a1a].map((c) => new THREE.Color(c)), hn = noise2(def.seed + 5);
        for (let x = bb.x0 - 400; x < bb.x1 + 400; x += 6.5) {
            if (hn(x / 90, 3) < 0.5) continue;
            for (const dc of [10, 15.5, 21]) {
                const z = coast(x) - dc + R(-1, 1), q = near(x, z, 60);
                if ((q.i >= 0 && q.d < 20) || H(x, z) > 0.3) continue;
                const col = pal[Math.floor(rand() * pal.length)];
                ub.push([x + R(-1, 1), H(x, z), z, col, rand() * 0.2 - 0.1]); lg.push([x + 1.4, H(x, z), z + 0.8, rand() * 0.6 - 0.3], [x - 1.2, H(x, z), z + 0.9, rand() * 0.6 - 0.3]);
            }
        }
        for (let k = 0, x = bb.x0; k < 4; k++, x += (bb.x1 - bb.x0) / 3) { const z = coast(x) - 15; if (near(x, z, 40).d > 20) towers.push([x, H(x, z), z]); }
        inst(umbrellaGeo(), std({ roughness: 0.8 }), ub.length, (i, col) => { const [x, y, z, c, tl] = ub[i]; D.position.set(x, y, z); D.rotation.set(tl, rand() * 6, 0); col(c); }, true);
        inst(new THREE.BoxGeometry(1.9, 0.3, 0.65).translate(0, 0.3, 0), std({ color: 0xf4f1ea, roughness: 0.8, side: THREE.FrontSide }), lg.length, (i) => { const [x, y, z, yaw] = lg[i]; D.position.set(x, y, z); D.rotation.y = yaw; });
        const lgt = new THREE.Group();
        for (const [x, y, z] of towers) {
            const g = new THREE.Group(), wood = std({ color: 0xc9a06a, roughness: 0.9, side: THREE.FrontSide }), red = std({ color: 0xd8312a, roughness: 0.7, side: THREE.FrontSide });
            for (const a of [-0.9, 0.9]) for (const b of [-0.9, 0.9]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3, 0.15), wood); leg.position.set(a, 1.5, b); g.add(leg); }
            const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), red); cab.position.y = 3.8; cab.castShadow = true;
            const rf = new THREE.Mesh(new THREE.ConeGeometry(1.9, 0.9, 4).rotateY(Math.PI / 4), wood); rf.position.y = 5;
            g.add(cab, rf); g.position.set(x, y, z); lgt.add(g);
        }
        group.add(lgt);
        // 카페 차양
        inst(new THREE.BoxGeometry(1, 0.12, 2.4).rotateX(-0.3), std({ roughness: 0.8 }), awnings.length, (i, col) => { const [x, y, z, yaw, w, c] = awnings[i]; D.position.set(x, y, z); D.rotation.y = yaw; D.scale.set(w, 1, 1); col(c); });
        // 피어: 해안선에서 바다 쪽으로 뻗은 나무 잔교와 가로등
        {
            const s = S[Math.floor(N * 0.3)], x = s.p.x, z0 = coast(x) - 6, L2 = 150, g = new THREE.Group(), wood = std({ color: 0x8a6a4a, roughness: 0.9, side: THREE.FrontSide });
            const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 0.4, L2).translate(0, 1.4, L2 / 2), wood); deck.castShadow = deck.receiveShadow = true; g.add(deck);
            const posts = []; for (let k = 0; k <= L2; k += 8) for (const a of [-2.2, 2.2]) posts.push([a, k]);
            const pg = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.18, 6, 6).translate(0, -1.8, 0), wood, posts.length);
            posts.forEach(([a, k], i) => { D.position.set(a, 0, k); D.rotation.set(0, 0, 0); D.scale.set(1, 1, 1); D.updateMatrix(); pg.setMatrixAt(i, D.matrix); }); g.add(pg);
            for (let k = 10; k < L2; k += 20) { const pl = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 4, 5).translate(0, 3.6, 0), propM.metal); pl.position.set(2.3, 0, k); g.add(pl); lampTops.push([x + 2.3, 5.6, z0 + k]); }
            g.position.set(x, 0, z0); group.add(g); info.pier = [x, z0];
        }
        // 등대 곶 + 갯바위
        const cx = sc * def.coast.cape[0], lz = coast(cx) - 22;
        lighthouse(group, cx, lz, H(cx, lz), nightOnly, neonMats, anims); info.lighthouse = [cx, lz]; B.push({ x: cx, z: lz, rad: 8 });
        const rocks = [];
        for (let k = 0; k < 90; k++) { const x = cx + R(-260, 260), z = coast(x) + R(-6, 4); rocks.push([x, z, R(1, 3.5)]); }
        inst(new THREE.DodecahedronGeometry(1, 0), std({ color: 0x6b6862, roughness: 0.95, flatShading: true, side: THREE.FrontSide }), rocks.length, (i) => { const [x, z, r] = rocks[i]; D.position.set(x, -0.6, z); D.scale.set(r, r * 0.7, r * 1.2); D.rotation.set(rand(), rand() * 6, rand()); }, true);
        // 요트: 천천히 떠다니며 출렁인다
        const sailM = std({ color: 0xf6f6f6, roughness: 0.6 });
        for (let k = 0; k < 12; k++) {
            const x = bb.x0 - 300 + rand() * (bb.x1 - bb.x0 + 600), off = R(70, 650), boat = new THREE.Group(), L3 = R(7, 13), hg = new THREE.BoxGeometry(L3, 1.1, L3 * 0.32), p = hg.attributes.position;
            for (let i = 0; i < p.count; i++) if (p.getX(i) > L3 * 0.2) p.setZ(i, p.getZ(i) * (1 - (p.getX(i) - L3 * 0.2) / (L3 * 0.32))); hg.computeVertexNormals();
            // 선체·돛·마스트를 한 지오메트리로 (요트 한 척 = 드로우콜 1번)
            const sg = new THREE.PlaneGeometry(L3 * 0.42, L3 * 1.1).translate(-L3 * 0.16, L3 * 0.6 + 0.6, 0), q = sg.attributes.position;
            for (let i = 0; i < q.count; i++) if (q.getY(i) > L3 * 0.6 + 0.6 && q.getX(i) < 0) q.setX(i, L3 * 0.05);
            const mg = new THREE.CylinderGeometry(0.06, 0.06, L3 * 1.2, 4).translate(L3 * 0.05, L3 * 0.6 + 0.4, 0);
            boat.add(new THREE.Mesh(mergeGeometries([hg, sg.translate(L3 * 0.05 + L3 * 0.21, 0, 0), mg]), sailM));
            boat.userData.anim = true; group.add(boat);
            const yaw = rand() * 6, v = R(0.3, 1), ph = rand() * 100;
            anims.push((t) => { const u = (t * v + ph) % 400 - 200; boat.position.set(x + Math.cos(yaw) * u, -0.25 + Math.sin(t * 1.3 + ph) * 0.12, coast(x) + off - Math.sin(yaw) * u * 0.3); boat.rotation.set(Math.sin(t * 0.9 + ph) * 0.05, yaw, Math.sin(t * 1.1 + ph) * 0.04); });
        }
        // 풍력 발전기: 내륙 언덕 꼭대기
        const peaks = [];
        for (let k = 0; k < 900; k++) { const x = bb.x0 - 600 + rand() * (bb.x1 - bb.x0 + 1200), z = bb.z0 - 600 + rand() * (bb.z1 - bb.z0 + 300), h = H(x, z); if (h > 25 && dcOf(x, z) > 220) peaks.push([x, z, h]); }
        peaks.sort((a, b) => b[2] - a[2]);
        const tb = []; for (const p of peaks) if (tb.length < 7 && tb.every((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) > 140)) tb.push(p);
        tb.forEach(([x, z, h], k) => turbine(group, x, h - 1, z, -0.6 + rand() * 0.2, anims, k * 1.7));
        // 먼 산맥 (내륙 쪽 지평선)
        const mts = [];
        for (let i = 0; i < 60; i++) { const a = rand() * Math.PI * 2, r = R0 + 760 + rand() * 300, x = ctr.x + Math.cos(a) * r, z = ctr.z + Math.sin(a) * r; if (z > coast(x) - 150) continue; const h = R(90, 260); mts.push(at(paint(new THREE.ConeGeometry(R(220, 380), h, 7, 1).translate(x, h / 2 - 8, z), HSL(R(0.3, 0.38), 0.18, R(0.22, 0.32))), 0, 0)); }
        if (mts.length) group.add(new THREE.Mesh(mergeGeometries(mts), flat({ flatShading: true, roughness: 1 })));
    }

    // 모든 건물이 공유하는 외벽 텍스처 배열 + 머티리얼 (청크당 드로우콜 1번)
    const FA = facadeArray(density >= 1 ? 512 : 256, rand), facMat = facadeMaterial(FA.tex), BL = new Buildings(CH), roofs = [];
    const propM = { metal: std({ color: 0x9aa0a8, roughness: 0.6, metalness: 0.5, side: THREE.FrontSide }), tank: std({ color: 0xb8bcc2, roughness: 0.5, metalness: 0.3, side: THREE.FrontSide }), heli: std({ color: 0x3a3d44, roughness: 0.9, side: THREE.FrontSide }) };
    if (def.theme === 'city') {
        tryPlace(5000, def.buildings, 8, 18, 9, (x, z, rad, yaw, q) => {
            const big = rand() < 0.55, h = big ? R(45, rand() < 0.3 ? 190 : 110) : R(16, 42);
            const b = big ? tower(BL, rand, x, z, rad, yaw, h, roofs) : midrise(BL, rand, x, z, rad, yaw, h, roofs);
            if (h > 70) tall.push([x, h + 1.5, z]);
            if (b.flat && q.d < 80 && h > 16) { const f = { x, z, w: b.w, d: b.d, h: Math.min(h, 40), yaw, q }; faceSigns.push(f); if (h > 40) faceSigns.push(f); }
        });
        // 네온사인: 코스를 향한 건물 벽면에 붙인다
        const neonWords = [['HOTEL', '#ff4fa3'], ['BAR', '#3ff0ff'], ['CAFE', '#ffd84a'], ['24H', '#7cff6b'], ['노래방', '#ff5ad1'], ['PC방', '#5aa8ff'], ['SODIUM', '#ffb454'], ['치킨', '#ff7a1a'], ['CLUB', '#b46bff'], ['약국', '#4dff9a']];
        const neonT = atlas(neonWords.length, 256, 96, (c, k, w, h) => {
            const [word, col] = neonWords[k];
            c.fillStyle = '#05060a'; c.fillRect(0, 0, w, h); c.strokeStyle = col; c.lineWidth = 6; c.strokeRect(6, 6, w - 12, h - 12);
            c.font = `900 56px ${KO}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = col; c.shadowBlur = 18; c.fillStyle = col; c.fillText(word, w / 2, h / 2 + 2); c.fillStyle = '#fff'; c.shadowBlur = 0; c.globalAlpha = 0.6; c.fillText(word, w / 2, h / 2 + 2);
        });
        const neonM = new THREE.MeshBasicMaterial({ map: neonT, toneMapped: false }); neonMats.push(neonM);
        decals(new THREE.PlaneGeometry(11, 4.1), neonM, neonWords.length, faceSigns.map((f, i) => [i % neonWords.length, () => {
            const s = S[f.q.i], side = Math.sign((s.p.x - f.x) * s.n.x + (s.p.z - f.z) * s.n.z) || 1;
            const cyaw = f.yaw, nx = Math.sin(cyaw) * side, nz = Math.cos(cyaw) * side; // 건물 로컬 z축 = 법선 방향
            D.position.set(f.x + nx * (f.d / 2 + 0.15) + Math.cos(cyaw) * R(-f.w / 4, f.w / 4), Math.min(f.h - 3, R(5, 22)), f.z + nz * (f.d / 2 + 0.15) - Math.sin(cyaw) * R(-f.w / 4, f.w / 4)); D.rotation.y = cyaw + (side > 0 ? 0 : Math.PI);
        }]));
        // 대형 전광판 (중층 빌딩 옥상)
        const words = ['SODIUM GP', 'NIGHT RACE', 'VOLT', 'NEON CITY'];
        const scrT = atlas(4, 512, 256, (c, k, W2, H2) => {
            const g = c.createLinearGradient(0, 0, W2, H2); g.addColorStop(0, ['#ff3d7f', '#2b6bff', '#ffb454', '#7a3dff'][k]); g.addColorStop(1, '#0b0e1a'); c.fillStyle = g; c.fillRect(0, 0, W2, H2);
            c.font = `italic 900 92px "Segoe UI",Arial,sans-serif`; c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(words[k], W2 / 2, H2 / 2);
        });
        const scrM = new THREE.MeshBasicMaterial({ map: scrT, toneMapped: false, side: THREE.DoubleSide }); neonMats.push(scrM);
        decals(new THREE.PlaneGeometry(18, 9), scrM, 4, faceSigns.filter((f, i) => i % 7 < 4 && f.h < 50).map((f, i) => [i % 4, () => { const s = S[f.q.i]; D.position.set(f.x, f.h + 4.6, f.z); D.rotation.y = s.yaw; }]));
        // 도심 스카이라인
        for (let i = 0; i < 150; i++) { const a = rand() * Math.PI * 2, r = R0 + 160 + rand() * 320, h = R(70, 300); tower(BL, rand, ctr.x + Math.cos(a) * r, ctr.z + Math.sin(a) * r, R(14, 26), rand() * 3, h, roofs); }
    } else if (def.theme === 'river') {
        // 주택가: 박공지붕 단독주택(1~2층) + 연립주택 + 아파트 단지
        const roofCols = [HSL(0.02, 0.5, 0.42), HSL(0.58, 0.25, 0.38), HSL(0.08, 0.35, 0.34), HSL(0, 0, 0.32), HSL(0.35, 0.2, 0.36), HSL(0.04, 0.6, 0.5)];
        tryPlace(6000, Math.round(def.buildings * 1.6), 5, 8, 10, (x, z, rad, yaw) => {
            const w = rad * R(1.3, 1.6), d = rad * R(1.1, 1.3), fl = rand() < 0.6 ? 1 : 2, h = fl * 3.2, tint = HSL(R(0, 0.15), R(0.1, 0.45), R(0.72, 0.95)), seed = rand();
            BL.box(x, z, w, d, yaw, 0, h, { layer: 'house', tint, seed, roof: false });
            if (rand() < 0.75) BL.gable(x, z, w + 0.8, d + 0.9, yaw, h, R(2.2, 3.4), { tint: pick(roofCols), wallTint: tint, wall: 'stucco' });
            else { BL.box(x, z, w + 0.3, d + 0.3, yaw, h, h + 0.5, { layer: 'stucco', tint, seed, roofLayer: 'roof' }); roofs.push({ x, z, y: h + 0.5, w: w * 0.6, d: d * 0.6, yaw, kind: 'ac' }); }
        });
        tryPlace(2500, Math.round(def.buildings * 0.25), 10, 15, 22, (x, z, rad, yaw) => midrise(BL, rand, x, z, rad, yaw, R(18, 46), roofs, ['apt', 'apt', 'brick', 'concrete']));
        // 대관람차
        if (RIV) {
            for (let tr = 0; tr < 200; tr++) {
                const r = RIV[Math.floor(R(0.2, 0.8) * RIV.length)], sd = rand() < 0.5 ? 1 : -1, c = r.p.clone().addScaledVector(r.n, sd * (RW + 22));
                const dq = near(c.x, c.z, 200).d; if (dq < 60 || dq > 150 || !free(c.x, c.z, 24)) continue;
                B.push({ x: c.x, z: c.z, rad: 24 });
                const g = new THREE.Group(), wheel = new THREE.Group(), RAD = 19, steel = new THREE.MeshStandardMaterial({ color: 0xeef1f5, metalness: 0.5, roughness: 0.4 });
                g.position.copy(c); g.rotation.y = Math.atan2(-r.t.z, r.t.x); wheel.position.y = RAD + 3;
                // 바퀴 골격(링 2개 + 살 18개)은 하나의 지오메트리, 곤돌라 18개는 인스턴스 1개 (매 프레임 수평 유지)
                const parts = [-1.3, 1.3].map((z) => new THREE.TorusGeometry(RAD, 0.35, 6, 64).translate(0, 0, z));
                for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2; parts.push(new THREE.CylinderGeometry(0.1, 0.1, RAD, 4).deleteAttribute('uv').rotateZ(a - Math.PI / 2).translate(Math.cos(a) * RAD / 2, Math.sin(a) * RAD / 2, 0)); }
                parts.forEach((p) => p.deleteAttribute('uv'));
                wheel.add(new THREE.Mesh(mergeGeometries(parts.map((p) => (p.index ? p : p))), steel));
                const neonRing = new THREE.MeshBasicMaterial({ color: 0xffb454, toneMapped: false }); neonMats.push(neonRing);
                wheel.add(new THREE.Mesh(new THREE.TorusGeometry(RAD + 0.4, 0.12, 4, 96), neonRing));
                const cabs = new THREE.InstancedMesh(new THREE.BoxGeometry(1.8, 2.2, 1.8).translate(0, -1.4, 0), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 18), cc = new THREE.Color(), CD = new THREE.Object3D();
                for (let k = 0; k < 18; k++) cabs.setColorAt(k, cc.setHSL(k / 18, 0.6, 0.55));
                cabs.position.copy(g.position).setY(RAD + 3); cabs.rotation.y = g.rotation.y; cabs.frustumCulled = false; group.add(cabs); cabs.userData.anim = true;
                const legs = [];
                for (const z of [-3, 3]) for (const x of [-1, 1]) legs.push(new THREE.CylinderGeometry(0.35, 0.5, RAD + 4.5, 6).rotateZ(-x * 0.25).translate(x * 5, (RAD + 3) / 2, z));
                const lm = new THREE.Mesh(mergeGeometries(legs), steel); lm.castShadow = true; g.add(lm);
                g.add(wheel); group.add(g); info.ferris = [c.x, c.z]; wheel.userData.anim = true;
                anims.push((t) => {
                    const r = t * 0.05; wheel.rotation.z = r;
                    for (let k = 0; k < 18; k++) { const a = (k / 18) * Math.PI * 2 + r; CD.position.set(Math.cos(a) * RAD, Math.sin(a) * RAD, 0); CD.updateMatrix(); cabs.setMatrixAt(k, CD.matrix); }
                    cabs.instanceMatrix.needsUpdate = true;
                });
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
        const ang = rand() * Math.PI * 2;
        for (let i = 0; i < 50; i++) { const a = ang + R(-0.6, 0.6), r = R0 + 200 + rand() * 160; (rand() < 0.5 ? tower : midrise)(BL, rand, ctr.x + Math.cos(a) * r, ctr.z + Math.sin(a) * r, R(12, 20), rand() * 3, R(50, 160), roofs); }
    } else if (def.theme === 'harbor') {
        // 항구: 창고, 컨테이너 야적장, 오일 탱크, 크레인, 선박, 등대
        const corr = tex(64, 64, (c, w, h) => { c.fillStyle = '#d6d9de'; c.fillRect(0, 0, w, h); for (let i = 0; i < w; i += 4) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(i, 0, 1.5, h); } });
        tryPlace(4000, Math.round(def.buildings * 0.45), 12, 24, 12, (x, z, rad, yaw) => {
            const tint = HSL(pick([0.55, 0.58, 0.48, 0.05, 0]), R(0.05, 0.35), R(0.6, 0.95)), h = R(9, 16), w = rad * 2.2, d = rad * 1.2;
            if (rand() < 0.75) {
                // 창고: 골강판 외벽 + 낮은 박공 지붕
                BL.box(x, z, w, d, yaw, 0, h, { layer: 'shed', tint, seed: rand(), roof: rand() < 0.5 });
                if (rand() < 0.6) BL.gable(x, z, w, d, yaw + Math.PI / 2 * 0, h, R(1.5, 2.5), { layer: 'roof', tint: HSL(0, 0, R(0.55, 0.75)), wall: 'shed', wallTint: tint });
            } else midrise(BL, rand, x, z, rad * 0.8, yaw, R(14, 30), roofs, ['ribbon', 'concrete', 'office']);
        });
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
        for (let i = 0, n = 0; i < 240 && n < 70; i++) { const a = rand() * Math.PI * 2, r = R0 + 160 + rand() * 300, x = ctr.x + Math.cos(a) * r, z = ctr.z + Math.sin(a) * r; if (isLand(x, z) && near(x, z, 100).d > 90) { n++; (rand() < 0.4 ? tower : midrise)(BL, rand, x, z, R(12, 22), rand() * 3, R(40, 140), roofs); } }
    } else {
        coastScene();
    }
    // 건물 메쉬 생성 + 옥상 설비
    BL.build(facMat, group);
    tall.push(...roofProps(roofs, rand, inst, D, propM));

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
    if (lampTops.length) { const lm = new THREE.MeshBasicMaterial({ color: L.color, toneMapped: false }); neonMats.push(lm); inst(new THREE.SphereGeometry(0.3, 8, 6), lm, lampTops.length, (i) => D.position.set(...lampTops[i])); }
    const pool = L.h * 2.4;
    const pools = inst(new THREE.PlaneGeometry(pool, pool).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glow, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }), lamps.length, (i) => { const l = lamps[i]; D.position.set(l.x - l.s.n.x * l.sd * 5, 0.1, l.z - l.s.n.z * l.sd * 5); });

    // ── 나무: 활엽수(둥근 수관 여러 덩이)·침엽수·야자수(해안). 해안 맵은 지형 높이에 맞춰 심는다
    const trees = [], coastal = def.theme === 'coast', spacing = Math.max(2, Math.round((def.theme === 'city' ? 5 : def.theme === 'harbor' ? 7 : coastal ? 4 : 3) / density));
    for (let i = 0; i < N; i += spacing) for (const sd of [-1, 1]) {
        if (startZone(i) || bridge[i]) continue;
        const s = S[i], o = sd * (W / 2 + (def.theme === 'city' ? 5.2 : 10 + rand() * 3)), x = s.p.x + s.n.x * o, z = s.p.z + s.n.z * o;
        if (wet(x, z, 3) || !free(x, z, 1, 0)) continue;
        trees.push([x, z, def.theme === 'city' ? 0.6 + rand() * 0.25 : 0.8 + rand() * 0.6, coastal ? 'palm' : def.theme === 'river' ? (rand() < 0.7 ? 'round' : 'cone') : 'round']);
    }
    const spread = coastal ? 520 : 150;
    for (let t = 0, want = Math.floor(def.trees * density); t < 6000 && want > 0; t++) {
        const x = bb.x0 - spread + rand() * (bb.x1 - bb.x0 + spread * 2), z = bb.z0 - spread + rand() * (bb.z1 - bb.z0 + spread * 2);
        if (near(x, z, 40).d < 30 || wet(x, z, 4) || !free(x, z, 2, 1)) continue;
        let type = def.theme === 'river' ? (rand() < 0.55 ? 'round' : 'cone') : def.theme === 'city' ? 'round' : 'cone';
        if (coastal) { const dc = coast(x) - z; if (dc < 24) continue; type = dc < 60 ? 'palm' : H(x, z) > 18 && rand() < 0.7 ? 'cone' : 'round'; }
        trees.push([x, z, 0.9 + rand() * 0.9, type]); want--;
    }
    trees.forEach((t) => { t[4] = H(t[0], t[1]); });
    const trunkM = new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.95 }), crownM = new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.3 });
    const place = (t, i) => { D.position.set(t[0], t[4], t[1]); D.rotation.y = i * 2.4; D.scale.setScalar(t[2]); };
    const round = trees.filter((t) => t[3] === 'round'), cone = trees.filter((t) => t[3] === 'cone'), palms = trees.filter((t) => t[3] === 'palm');
    inst(new THREE.CylinderGeometry(0.14, 0.22, 2.6, 6).translate(0, 1.3, 0), trunkM, round.length + cone.length, (i) => place(i < round.length ? round[i] : cone[i - round.length], i), true);
    // 둥근 수관: 크기가 다른 덩이 4개를 불규칙하게 겹치고 정점을 살짝 흔들어 자연스럽게
    const blob = (r, x, y, z) => { const g = new THREE.IcosahedronGeometry(r, 1), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const k = 1 + (Math.sin(p.getX(i) * 3.1 + p.getY(i) * 2.3) * 0.5 + Math.cos(p.getZ(i) * 2.7) * 0.5) * 0.12; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); } g.computeVertexNormals(); return g.translate(x, y, z); };
    const roundG = mergeGeometries([blob(2.1, 0, 4.2, 0), blob(1.6, 1.1, 5.3, 0.5), blob(1.5, -1, 5, -0.6), blob(1.2, 0.2, 6.2, -0.2)]);
    inst(roundG, crownM, round.length, (i, col) => { place(round[i], i); col(HSL(0.22 + rand() * 0.1, 0.42, 0.2 + rand() * 0.12)); }, true);
    const coneG = mergeGeometries([new THREE.ConeGeometry(1.8, 3.6, 8).translate(0, 3.2, 0), new THREE.ConeGeometry(1.4, 3.2, 8).translate(0, 5.1, 0), new THREE.ConeGeometry(1.0, 2.6, 8).translate(0, 6.8, 0), new THREE.ConeGeometry(0.6, 1.8, 8).translate(0, 8.2, 0)]);
    inst(coneG, crownM, cone.length, (i, col) => { place(cone[i], i); col(HSL(0.3 + rand() * 0.06, 0.4, 0.15 + rand() * 0.08)); }, true);
    if (palms.length) {
        const PG = palmGeo(), palmM = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.3 });
        inst(PG.trunk, new THREE.MeshStandardMaterial({ color: 0x7a6248, roughness: 0.95 }), palms.length, (i) => place(palms[i], i), true);
        inst(PG.crown, palmM, palms.length, (i, col) => { place(palms[i], i); col(HSL(0.24 + rand() * 0.06, 0.5, 0.24 + rand() * 0.1)); }, true);
    }
    if (def.theme === 'city') {
        const planters = trees.filter((t) => t[2] < 0.9);
        inst(new THREE.BoxGeometry(2, 0.6, 2).translate(0, 0.3, 0), new THREE.MeshStandardMaterial({ color: 0x8a8c92, roughness: 0.9 }), planters.length, (i) => D.position.set(planters[i][0], 0.08, planters[i][1]));
    }

    // ── 배리어 + 광고판
    const bars = [], [ca, cb, every] = T.barrier, colA = new THREE.Color(ca), colB = new THREE.Color(cb);
    for (let i = 0; i < N; i += 2) for (const sd of [-1, 1]) { const s = S[i], o = sd * (W / 2 + 1.5); bars.push({ x: s.p.x + s.n.x * o, z: s.p.z + s.n.z * o, yaw: s.yaw, i, sd }); }
    inst(new THREE.BoxGeometry(9, T.barrierH, 1), new THREE.MeshStandardMaterial({ roughness: 0.85 }), bars.length, (i, col) => {
        // 이웃 블록이 1m 겹치므로, 줄무늬 블록을 아주 조금 크게 해 겹친 면이 깜빡이지(z-fighting) 않게 한다
        const b = bars[i], hi = (i >> 1) % every === 0; D.position.set(b.x, T.barrierH / 2 + (hi ? 0.005 : 0), b.z); D.rotation.y = b.yaw; if (hi) D.scale.set(0.995, 1.01, 1.04); col(hi ? colB : colA);
    }, true);
    const adT = atlas(T.ads.length, 512, 64, (c, k, w, h) => {
        const [text, bg, fg] = T.ads[k];
        c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.fillRect(0, h - 8, w, 8);
        c.font = `italic 900 ${Math.round(h * 0.62)}px "Segoe UI",Arial,sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2 - 2);
    });
    adT.anisotropy = 8;
    decals(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshBasicMaterial({ map: adT, side: THREE.DoubleSide }), T.ads.length,
        bars.filter((b) => b.i % 10 === 0 && !startZone(b.i)).map((b) => [((b.i / 10 + (b.sd > 0 ? 1 : 0)) | 0) % T.ads.length, () => {
            const s = S[b.i], o = b.sd * (W / 2 + 2.3);
            D.position.set(s.p.x + s.n.x * o, T.barrierH + 0.75, s.p.z + s.n.z * o); D.rotation.y = b.yaw + (b.sd > 0 ? Math.PI : 0);
        }]));

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

    // 움직이지 않는 개별 메쉬(게이트·관중석·등대·잔교 등)를 청크별로 병합해 드로우콜을 줄인다
    mergeStatic(group, CH * 2, (o) => o.userData.anim);
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
            facMat.userData.u.winI.value = t.win * 0.85; facMat.userData.u.litFrac.value = t.stars ? 0.42 : t.lamp ? 0.3 : 0.2;
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
