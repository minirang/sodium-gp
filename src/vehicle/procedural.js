import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 코드로 만든 차량: 측면·평면 프로파일을 따라 단면(초타원)을 이어 붙이는 로프트 방식.
// 좌표계: 전방 +x, 오른쪽 +z, 위 +y. 지면은 y = G0.
const G0 = -0.61;

// 키포인트 사이를 부드럽게 잇는 1차원 Catmull-Rom 보간
function curve(pts) {
    const p = [...pts].sort((a, b) => a[0] - b[0]), n = p.length;
    return (x) => {
        if (x <= p[0][0]) return p[0][1];
        if (x >= p[n - 1][0]) return p[n - 1][1];
        let i = 0; while (x > p[i + 1][0]) i++;
        const [x0, y0] = p[i], [x1, y1] = p[i + 1], h = x1 - x0, t = (x - x0) / h;
        const m = (j) => (j <= 0 || j >= n - 1 ? 0 : (p[j + 1][1] - p[j - 1][1]) / (p[j + 1][0] - p[j - 1][0])) * h;
        const m0 = i === 0 ? (y1 - y0) : m(i), m1 = i + 1 === n - 1 ? (y1 - y0) : m(i + 1), t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * m1;
    };
}

// ── 디자인 정의 (지면 기준 높이, m)
export const DESIGNS = {
    // 바이에른 G8 쿠페: 롱 노즈 · 숏 데크 FR 쿠페, 각진 펜더, 세로형 트윈 그릴, L자 테일램프, 쿼드 머플러
    bav: {
        nose: 2.24, tail: -2.34, axles: [1.375, -1.375], track: 0.8, sh: 0.64, n: 4.6, nb: 9, tb: 0.16, crown: 0.035,
        top: [[2.24, 0.66], [2.16, 0.72], [1.95, 0.8], [1.6, 0.85], [1.375, 0.88], [0.9, 0.9], [0.6, 0.92], [0, 0.94], [-0.8, 0.96], [-1.375, 0.99], [-1.9, 1.01], [-2.2, 1.0], [-2.34, 0.96]],
        bot: [[2.24, 0.2], [2.1, 0.16], [1.2, 0.16], [-1.8, 0.18], [-2.2, 0.24], [-2.34, 0.3]],
        hw: [[2.24, 0.66], [2.2, 0.78], [2.12, 0.86], [1.95, 0.92], [1.375, 0.95], [0.85, 0.92], [0, 0.905], [-0.7, 0.91], [-1.375, 0.96], [-1.95, 0.94], [-2.2, 0.89], [-2.3, 0.8], [-2.34, 0.7]],
        gh: { x0: 0.62, f: 0.0, r: -0.9, x1: -1.6, y: 1.4, hw: 0.62, inset: 0.13, b: -0.42 },
        eye: [-0.5, 0.5, -0.37], wheelC: [-0.02, 0.27, -0.37],
        trim: 0x111216, doors: [0.55, -0.95],
    },
    // 잉골 V10 플러스: 미드십 V10, 앞으로 당긴 캐빈, 육각 싱글 프레임 그릴, 측면 블레이드, 가로형 슬림 테일램프
    ing: {
        nose: 2.2, tail: -2.24, axles: [1.325, -1.325], track: 0.82, sh: 0.6, n: 3.6, nb: 8, tb: 0.24, crown: 0.045,
        top: [[2.2, 0.58], [2.1, 0.64], [1.85, 0.74], [1.6, 0.82], [1.325, 0.88], [1.05, 0.84], [0.9, 0.82], [0.3, 0.84], [-0.4, 0.88], [-1.0, 0.97], [-1.325, 1.0], [-1.9, 0.99], [-2.15, 0.96], [-2.24, 0.92]],
        bot: [[2.2, 0.2], [2.05, 0.14], [1.0, 0.14], [-1.9, 0.16], [-2.24, 0.26]],
        hw: [[2.2, 0.62], [2.16, 0.76], [2.08, 0.86], [1.9, 0.93], [1.325, 0.965], [0.7, 0.93], [0, 0.915], [-0.45, 0.9], [-1.0, 0.95], [-1.325, 0.975], [-1.95, 0.96], [-2.18, 0.9], [-2.24, 0.8]],
        gh: { x0: 0.9, f: 0.2, r: -0.5, x1: -1.65, y: 1.24, hw: 0.6, inset: 0.16, b: -0.28 },
        eye: [-0.18, 0.36, -0.37], wheelC: [0.26, 0.16, -0.37],
        trim: 0x15161a, blade: 0x3a3d44, doors: [0.85, -0.3],
    },
};

const matCache = new Map();
const shared = (key, make) => { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); };
const trimM = (c) => shared('trim' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.2 }));
const blackM = () => shared('black', () => new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.8, side: THREE.DoubleSide }));
const chromeM = () => shared('chrome', () => new THREE.MeshStandardMaterial({ color: 0xd8dce4, roughness: 0.15, metalness: 1 }));
const glassM = () => shared('glass', () => new THREE.MeshPhysicalMaterial({ color: 0x070a10, metalness: 0.3, roughness: 0.04, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 }));
const lampM = () => shared('lamp', () => new THREE.MeshStandardMaterial({ color: 0xc9d0da, roughness: 0.15, metalness: 0.1, emissive: 0xfff3dc, emissiveIntensity: 0.5, envMapIntensity: 1.2 }));
const drlM = () => shared('drl', () => new THREE.MeshBasicMaterial({ color: 0xf2f7ff, toneMapped: false }));

// 그릴 메시 텍스처 (벌집 무늬)
const meshTex = (() => {
    let t = null;
    return () => {
        if (t) return t;
        const c = document.createElement('canvas'); c.width = c.height = 64;
        const x = c.getContext('2d'); x.fillStyle = '#050608'; x.fillRect(0, 0, 64, 64); x.strokeStyle = '#2a2d33'; x.lineWidth = 2;
        for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) { const cx = i * 16 + (j & 1 ? 8 : 0), cy = j * 14; x.beginPath(); for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; x.lineTo(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7); } x.closePath(); x.stroke(); }
        t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
        return t;
    };
})();
const grilleM = () => shared('grille', () => new THREE.MeshStandardMaterial({ map: meshTex(), roughness: 0.6, metalness: 0.3 }));

export function makeBody(D, look, lod) {
    const top = curve(D.top), bot0 = curve(D.bot), hw = curve(D.hw), r = look.wheel, archR = r + 0.05;
    // 휠 아치: 바퀴 중심(지면+r)을 기준으로 반원 모양으로 차체 하단을 들어 올린다
    const bot = (x) => {
        let y = bot0(x);
        for (const ax of D.axles) { const d = Math.abs(x - ax); if (d < archR) y = Math.max(y, r + Math.sqrt(archR * archR - d * d)); }
        return y;
    };
    const M = lod ? 7 : 11, step = lod ? 0.09 : 0.045;
    // 한쪽 단면의 점: u=0 바닥 중앙 → u=1 지붕 중앙
    const ring = (x, u) => {
        // 어깨선(가장 넓은 지점)을 높이의 sh 비율에 두고, 위는 둥글게·아래는 수직에 가깝게 떨어지는 비대칭 단면
        const yt = top(x), yb = bot(x), ym = yb + (yt - yb) * D.sh, W = hw(x);
        const th = -Math.PI / 2 + u * Math.PI, c = Math.max(0, Math.cos(th)), s = Math.sin(th);
        const n = s > 0 ? D.n : D.nb;
        let z = W * Math.pow(c, 2 / n);
        const y = (s > 0 ? ym + (yt - ym) * Math.pow(s, 2 / n) : ym - (ym - yb) * Math.pow(-s, 2 / n)) - (s > 0 ? D.crown * (z / W) ** 2 : 0);
        z *= 1 - D.tb * Math.pow(Math.max(0, s), 1.5);
        return [z, y];
    };
    // 상면에서 폭 z 위치의 높이 (캐빈 밑변을 차체 곡면에 붙이기 위해)
    const surfY = (x, z) => {
        let pz = 0, py = top(x);
        for (let k = M; k >= M / 2; k--) {
            const [rz, ry] = ring(x, k / M);
            if (rz >= z) { const t = (z - pz) / Math.max(1e-4, rz - pz); return py + (ry - py) * t; }
            pz = rz; py = ry;
        }
        return py;
    };

    const xs = []; for (let x = D.nose; x > D.tail; x -= step) xs.push(x); xs.push(D.tail);
    const RN = 2 * M, pos = [], idx = { paint: [], dark: [] };
    for (const x of xs) {
        for (let j = 0; j < RN; j++) {
            const u = j <= M ? j / M : (RN - j) / M, [z, y] = ring(x, u);
            pos.push(x, y + G0, j <= M ? z : -z);
        }
    }
    const kb = Math.max(1, Math.round(M * 0.18));
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < RN; j++) {
        const a = i * RN + j, b = i * RN + ((j + 1) % RN), c = a + RN, d = b + RN;
        const g = j < kb || j >= RN - kb ? idx.dark : idx.paint;
        g.push(a, c, b, b, c, d);
    }
    // 앞뒤 끝면: 정점을 따로 둬서 모서리가 각지게(법선이 섞이지 않게) 한다
    const L = (xs.length - 1) * RN;
    for (const [base, x, front] of [[0, xs[0], true], [L, D.tail, false]]) {
        const o = pos.length / 3;
        for (let j = 0; j < RN; j++) pos.push(pos[(base + j) * 3], pos[(base + j) * 3 + 1], pos[(base + j) * 3 + 2]);
        const c = pos.length / 3; pos.push(x, (top(x) + bot(x)) / 2 + G0, 0);
        // 감김 방향은 실제 법선을 계산해 바깥(앞: +x, 뒤: -x)을 향하게 맞춘다
        const P3 = (k) => new THREE.Vector3(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
        const nrm = new THREE.Vector3().crossVectors(P3(o + 1).sub(P3(c)), P3(o + Math.floor(RN / 2)).sub(P3(c)));
        const flip = (nrm.x > 0) !== front;
        for (let j = 0; j < RN; j++) { const a = o + j, b = o + ((j + 1) % RN); if (flip) idx.paint.push(c, b, a); else idx.paint.push(c, a, b); }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex([...idx.paint, ...idx.dark]);
    geo.addGroup(0, idx.paint.length, 0); geo.addGroup(idx.paint.length, idx.dark.length, 1);
    geo.computeVertexNormals();

    // 패치: 차체 표면의 (x, u) 영역을 살짝 띄워 덮는다 (램프·블레이드 등이 곡면에 딱 붙는다)
    const patch = (x0, x1, u0, u1, side, off = 0.006, nx = 6, nu = 4) => {
        if (x1 < x0) [x0, x1] = [x1, x0];
        const p = [], id = [];
        for (let i = 0; i <= nx; i++) for (let j = 0; j <= nu; j++) {
            const x = x0 + ((x1 - x0) * i) / nx, u = u0 + ((u1 - u0) * j) / nu, [z, y] = ring(x, u), yc = bot(x) + (top(x) - bot(x)) * D.sh;
            const nz = z, ny = (y - yc) * 0.6, l = Math.hypot(nz, ny) || 1;
            p.push(x, y + G0 + (ny / l) * off, side * (z + (nz / l) * off));
        }
        for (let i = 0; i < nx; i++) for (let j = 0; j < nu; j++) {
            const a = i * (nu + 1) + j, b = a + 1, c = a + nu + 1, d = c + 1;
            if (side > 0) id.push(a, c, b, b, c, d); else id.push(a, b, c, b, d, c);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(id); g.computeVertexNormals();
        return g;
    };

    // ── 캐빈(그린하우스): 벨트라인 위로 유리 + 지붕(도장) + 필러
    const gh = D.gh, roof = curve([[gh.x0, 0], [gh.x0 - (gh.x0 - gh.f) * 0.55, 0.78], [gh.f, 0.985], [(gh.f + gh.r) / 2, 1], [gh.r, 0.975], [gh.r - (gh.r - gh.x1) * 0.45, 0.62], [gh.x1, 0]]);
    const gx = []; for (let x = gh.x0; x > gh.x1; x -= step * 0.8) gx.push(x); gx.push(gh.x1);
    const GN = 4, gpos = [], gi = { glass: [], roof: [], pillar: [] };
    for (const x of gx) {
        const zb = hw(x) - gh.inset, yb = surfY(x, zb) - 0.012, k = roof(x), yr = yb + (gh.y - yb) * k, zr = zb + (gh.hw - zb) * Math.min(1, k * 1.1);
        // 오른쪽 벨트 → 오른쪽 위 → 지붕 모서리 → 중앙 → (왼쪽 대칭)
        const pr = [[zb, yb], [zb + (zr - zb) * 0.82, yb + (yr - yb) * 0.8], [zr * 0.96, yr], [zr * 0.55, yr + 0.035 * k], [0, yr + 0.045 * k]];
        for (let j = 0; j < GN; j++) gpos.push(x, pr[j][1] + G0, pr[j][0]);
        gpos.push(x, pr[4][1] + G0, 0);
        for (let j = GN - 1; j >= 0; j--) gpos.push(x, pr[j][1] + G0, -pr[j][0]);
    }
    const GR = 2 * GN + 1, roofOn = (x) => x < gh.f + 0.03 && x > gh.r - 0.03;
    for (let i = 0; i < gx.length - 1; i++) {
        const xm = (gx[i] + gx[i + 1]) / 2;
        for (let j = 0; j < GR - 1; j++) {
            const a = i * GR + j, b = a + 1, c = a + GR, d = c + 1, side = j === 0 || j === GR - 2;
            const rail = j === 1 || j === GR - 3, crown = j >= 2 && j <= GR - 4;
            let g = gi.glass;
            if (crown && roofOn(xm)) g = gi.roof;
            else if (rail) g = gi.roof; // 지붕 레일·A/C필러
            else if (side && Math.abs(xm - gh.b) < 0.05) g = gi.pillar; // B필러
            g.push(a, b, c, b, d, c);
        }
    }
    const ggeo = new THREE.BufferGeometry();
    ggeo.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
    ggeo.setIndex([...gi.glass, ...gi.roof, ...gi.pillar]);
    ggeo.addGroup(0, gi.glass.length, 0); ggeo.addGroup(gi.glass.length, gi.roof.length, 1); ggeo.addGroup(gi.glass.length + gi.roof.length, gi.pillar.length, 2);
    ggeo.computeVertexNormals();

    return { geo, ggeo, patch, top, bot, hw, ring, surfY, archR };
}

// 공통 휠: 둥근 타이어(선반 회전체) + 림 배럴 + 테이퍼 스포크 + 브레이크 디스크·캘리퍼
const wheelGeo = new Map();
function wheelParts(r, spokes, style) {
    const key = `${r}|${spokes}|${style}`;
    if (wheelGeo.has(key)) return wheelGeo.get(key);
    const w = 0.26, ri = r * 0.74, prof = [];
    for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * Math.PI; prof.push(new THREE.Vector2(ri + (r - ri) * (0.55 + 0.45 * Math.cos(a)) + (Math.abs(Math.sin(a)) > 0.9 ? 0 : 0.01), (w / 2) * Math.sin(a))); }
    prof.unshift(new THREE.Vector2(ri, -w / 2)); prof.push(new THREE.Vector2(ri, w / 2));
    const tire = new THREE.LatheGeometry(prof, 32).rotateX(Math.PI / 2);
    const barrel = new THREE.CylinderGeometry(ri, ri, w * 0.92, 28, 1, true).rotateX(Math.PI / 2);
    const face = new THREE.RingGeometry(ri * 0.86, ri, 28).translate(0, 0, w * 0.44);
    const disc = new THREE.CylinderGeometry(ri * 0.78, ri * 0.78, 0.03, 24).rotateX(Math.PI / 2).translate(0, 0, w * 0.18);
    const hub = new THREE.CylinderGeometry(ri * 0.2, ri * 0.24, 0.06, 12).rotateX(Math.PI / 2).translate(0, 0, w * 0.43);
    const sp = [];
    for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2, twin = style === 'twin' ? [-0.11, 0.11] : style === 'y' ? [0] : [0];
        for (const o of twin) {
            const g = new THREE.BoxGeometry(ri * 0.68, ri * (style === 'twin' ? 0.07 : 0.13), 0.035), p = g.attributes.position;
            for (let k = 0; k < p.count; k++) { const x = p.getX(k), t = (x / (ri * 0.68) + 0.5); p.setY(k, p.getY(k) * (1.25 - t * 0.5)); p.setZ(k, p.getZ(k) - t * 0.03); }
            g.translate(ri * 0.52, 0, w * 0.44).rotateZ(a + o);
            sp.push(g);
            if (style === 'y') { const f = new THREE.BoxGeometry(ri * 0.3, ri * 0.08, 0.03); for (const s of [-1, 1]) sp.push(f.clone().translate(ri * 0.15, 0, 0).rotateZ(s * 0.5).translate(ri * 0.55, 0, w * 0.43).rotateZ(a)); }
        }
    }
    const parts = { tire, barrel, face, disc, hub, spokes: sp.length ? mergeSimple(sp) : null };
    wheelGeo.set(key, parts);
    return parts;
}
function mergeSimple(list) {
    const pos = [], nor = [], id = []; let o = 0;
    for (const g of list) { const gi = g.index ? g : g; const p = gi.attributes.position, n = gi.attributes.normal; for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); } for (const v of gi.index.array) id.push(v + o); o += p.count; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(id);
    return g;
}

const tireM = () => shared('tire', () => new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.92 }));
const discM = () => shared('disc', () => new THREE.MeshStandardMaterial({ color: 0x6d7077, roughness: 0.4, metalness: 0.9 }));
const caliperM = (c) => shared('cal' + c, () => new THREE.MeshStandardMaterial({ color: c, roughness: 0.4, metalness: 0.2 }));

// 바퀴 한 개 = 타이어 메쉬 + 금속 메쉬(림·스포크·허브·디스크를 정점 색으로 칠해 하나로) → 드로우콜 2번
const metalGeo = new Map();
function metalParts(r, look, style) {
    const key = `${r}|${look.spokes}|${style}|${look.rim}`;
    if (metalGeo.has(key)) return metalGeo.get(key);
    const P = wheelParts(r, look.spokes, style), rim = new THREE.Color(look.rim), disc = new THREE.Color(0x6d7077), list = [];
    const prep = (g, col) => { const x = (g.index ? g.toNonIndexed() : g.clone()); for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k); const n = x.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; } x.setAttribute('color', new THREE.BufferAttribute(c, 3)); list.push(x); };
    prep(P.barrel, rim); prep(P.face, rim); prep(P.hub, rim); prep(P.disc, disc); if (P.spokes) prep(P.spokes, rim);
    const g = mergeGeometries(list); list.forEach((x) => x.dispose());
    metalGeo.set(key, g); return g;
}

export function makeWheel(r, look, right, style = 'std', caliper = 0x23252b, own = []) {
    const g = new THREE.Group(), h = new THREE.Group(), P = wheelParts(r, look.spokes, style);
    const metal = shared('wmetal', () => new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.85, roughness: 0.26, envMapIntensity: 1.2 }));
    h.add(new THREE.Mesh(P.tire, tireM()), new THREE.Mesh(metalParts(r, look, style), metal));
    if (!right) h.rotation.y = Math.PI;
    g.add(h);
    // 캘리퍼는 바퀴와 같이 돌지 않도록 차체 쪽에 붙인다
    const cal = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.16, 0.06), caliperM(caliper)); cal.position.set(-r * 0.5, r * 0.25, (right ? 1 : -1) * 0.04);
    g.traverse((o) => { o.castShadow = true; });
    return { wheel: g, caliper: cal };
}

// ── 차종별 디테일과 완성
export function buildDesign(key, look, o = {}) {
    const D = DESIGNS[key], lod = !!o.lod, B = makeBody(D, look, lod), g = new THREE.Group(), own = [];
    const paint = new THREE.MeshPhysicalMaterial({ color: look.color, metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.25, side: THREE.DoubleSide }); own.push(paint);
    const trim = trimM(D.trim), dark = blackM();
    const body = new THREE.Mesh(B.geo, [paint, dark]); body.castShadow = true; g.add(body);
    const cabin = new THREE.Mesh(B.ggeo, [glassM(), paint, trim]); cabin.renderOrder = 2; g.add(cabin);
    const tailM = new THREE.MeshStandardMaterial({ color: 0x5a0a0c, roughness: 0.2, metalness: 0.3, emissive: 0xff1010, emissiveIntensity: 0.3 }); own.push(tailM);
    const add = (geo, m, shadow = false) => { const x = new THREE.Mesh(geo, m); x.castShadow = shadow; g.add(x); return x; };
    const n = D.nose, t = D.tail, yAt = (x, f) => G0 + B.bot(x) + (B.top(x) - B.bot(x)) * f, wAt = (x) => B.hw(x);

    // 언더바디 터브: 휠 아치 안쪽과 차체 바닥을 막는다
    const tub = new THREE.BoxGeometry(n - t - 0.5, 0.5, 2 * (D.track - 0.16)).translate((n + t) / 2, G0 + 0.42, 0);
    add(tub, dark);

    // 앞뒤 끝면에 붙이는 평면 부품 (둥근 사각형 / 임의 다각형). y는 지면 기준, z는 가로 위치
    const face = (front, pts, m, d = 0.004) => {
        const sh = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
        const geo = new THREE.ShapeGeometry(sh, 3), uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 7, uv.getY(i) * 7);
        geo.rotateY(front ? Math.PI / 2 : -Math.PI / 2);
        const x = add(geo, m); x.position.set(front ? n + d : t - d, G0, 0); return x;
    };
    const rect = (z0, z1, y0, y1, rr = 0.02) => {
        const p = [], seg = 3, q = (cz, cy, a0) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; p.push([cz + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } };
        q(z1 - rr, y0 + rr, -Math.PI / 2); q(z1 - rr, y1 - rr, 0); q(z0 + rr, y1 - rr, Math.PI / 2); q(z0 + rr, y0 + rr, Math.PI); return p;
    };
    const both = (fn) => { fn(1); fn(-1); };
    const sideTrim = (fx0, fx1, u0, u1, m, off = 0.006) => both((s) => add(B.patch(fx0, fx1, u0, u1, s, off, 8, 1), m));

    if (key === 'bav') {
        // 세로형 트윈 그릴 (크롬 테두리)
        both((s) => { face(true, rect(s * 0.03, s * 0.31, 0.3, 0.6, 0.05).map(([z, y]) => [z, y]), chromeM(), 0.003); face(true, rect(s * 0.045, s * 0.295, 0.315, 0.585, 0.04), grilleM(), 0.006); });
        face(true, rect(-0.52, 0.52, 0.22, 0.31, 0.03), grilleM());
        both((s) => face(true, rect(s * 0.5, s * 0.64, 0.24, 0.44, 0.03), grilleM()));
        // 헤드램프: 앞면 + 코너를 감싸는 부분, 위쪽 DRL
        both((s) => { face(true, [[s * 0.34, 0.5], [s * 0.64, 0.53], [s * 0.64, 0.62], [s * 0.36, 0.6]], lampM()); face(true, [[s * 0.38, 0.585], [s * 0.62, 0.6], [s * 0.62, 0.61], [s * 0.38, 0.596]], drlM(), 0.007); add(B.patch(n - 0.12, n, 0.6, 0.72, s, 0.004, 3, 2), lampM()); });
        // 리어: L자 테일램프, 번호판, 디퓨저, 쿼드 머플러
        both((s) => { face(false, [[s * 0.36, 0.8], [s * 0.7, 0.8], [s * 0.7, 0.9], [s * 0.36, 0.88]], tailM); face(false, rect(s * 0.6, s * 0.7, 0.66, 0.8, 0.01), tailM); add(B.patch(t + 0.16, t, 0.66, 0.8, s, 0.004, 3, 2), tailM); });
        face(false, rect(-0.26, 0.26, 0.5, 0.62, 0.01), dark);
        face(false, rect(-0.66, 0.66, 0.3, 0.42, 0.04), dark);
        const pipe = new THREE.CylinderGeometry(0.045, 0.045, 0.12, 14, 1, true).rotateZ(Math.PI / 2);
        both((s) => { for (const k of [0.42, 0.54]) add(pipe, chromeM()).position.set(t - 0.03, G0 + 0.36, s * k); });
        // 트렁크 립 스포일러
        add(new THREE.BoxGeometry(0.1, 0.02, 1.2), trim).position.set(t + 0.07, G0 + B.top(t + 0.07) - 0.002, 0);
    } else {
        // 육각 싱글 프레임 그릴
        const hex = [[-0.4, 0.5], [0.4, 0.5], [0.32, 0.3], [0.2, 0.22], [-0.2, 0.22], [-0.32, 0.3]];
        face(true, hex.map(([z, y]) => [z * 1.06, y + (y - 0.36) * 0.06]), chromeM(), 0.003); face(true, hex, grilleM(), 0.006);
        both((s) => face(true, rect(s * 0.42, s * 0.6, 0.22, 0.34, 0.03), grilleM()));
        // 슬림 헤드램프 + LED 라인
        both((s) => { face(true, [[s * 0.3, 0.43], [s * 0.55, 0.45], [s * 0.55, 0.5], [s * 0.38, 0.5]], lampM()); face(true, [[s * 0.36, 0.435], [s * 0.55, 0.452], [s * 0.55, 0.462], [s * 0.36, 0.446]], drlM(), 0.007); add(B.patch(n - 0.14, n, 0.62, 0.72, s, 0.004, 3, 2), lampM()); });
        // 측면 블레이드 (도어 뒤 대비색 패널 + 흡기구)
        const bladeM = shared('blade', () => new THREE.MeshStandardMaterial({ color: D.blade, roughness: 0.35, metalness: 0.7 }));
        both((s) => { add(B.patch(-0.3, -0.84, 0.36, 0.63, s, 0.008), bladeM); add(B.patch(-0.6, -0.8, 0.41, 0.56, s, 0.012, 3, 2), grilleM()); });
        // 리어: 슬림 테일램프, 풀폭 메시, 디퓨저, 타원 머플러
        both((s) => { face(false, [[s * 0.3, 0.8], [s * 0.72, 0.8], [s * 0.72, 0.855], [s * 0.3, 0.845]], tailM); add(B.patch(t + 0.12, t, 0.68, 0.76, s, 0.004, 3, 2), tailM); });
        face(false, rect(-0.66, 0.66, 0.46, 0.74, 0.03), grilleM());
        face(false, rect(-0.6, 0.6, 0.27, 0.4, 0.04), dark);
        const pipe = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 16, 1, true).rotateZ(Math.PI / 2).scale(1, 0.65, 1);
        both((s) => add(pipe, chromeM()).position.set(t - 0.03, G0 + 0.36, s * 0.5));
        // 엔진 커버 유리 아래로 보이는 V10 커버
        add(new THREE.BoxGeometry(0.7, 0.05, 0.6), dark).position.set(-1.1, G0 + 0.93, 0);
    }
    // 문틈과 사이드 스커트
    for (const x of D.doors) sideTrim(x + 0.006, x - 0.006, 0.3, 0.8, dark, 0.004);
    sideTrim(D.axles[0] - 0.45, D.axles[1] + 0.45, 0.14, 0.24, trim, 0.01);
    // 사이드 미러
    for (const s of [-1, 1]) {
        const x = D.gh.x0 - 0.12, z = s * (wAt(x) - D.gh.inset + 0.08), y = G0 + B.surfY(x, Math.abs(z) - 0.08) + 0.12;
        add(new THREE.BoxGeometry(0.14, 0.09, 0.17).translate(0, 0, s * 0.06), paint).position.set(x, y, z);
        add(new THREE.BoxGeometry(0.05, 0.03, 0.1), dark).position.set(x + 0.02, y - 0.05, z);
    }
    // 실내: 대시보드와 계기판 불빛 (1인칭에서 보인다)
    if (!lod) {
        const dx = D.gh.x0 - 0.18, dy = G0 + B.top(D.gh.x0) - 0.06;
        add(new THREE.BoxGeometry(0.34, 0.1, 2 * (wAt(dx) - D.gh.inset - 0.05)), dark).position.set(dx, dy, 0);
        const glow = shared('gauge', () => new THREE.MeshBasicMaterial({ color: 0x1f6f8c }));
        add(new THREE.PlaneGeometry(0.14, 0.045).rotateY(-Math.PI / 2).rotateZ(0.4), glow).position.set(D.wheelC[0] + 0.3, D.wheelC[1] + 0.1, D.wheelC[2]);
        const seat = shared('seat', () => new THREE.MeshStandardMaterial({ color: 0x1a1b20, roughness: 0.9 }));
        for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.12, 0.62, 0.48).rotateZ(-0.25), seat).position.set(D.eye[0] - 0.3, G0 + 0.65, s * 0.37);
    }

    // 바퀴
    const r = look.wheel, pts = [[D.axles[0], D.track], [D.axles[0], -D.track], [D.axles[1], D.track], [D.axles[1], -D.track]].map(([x, z]) => new THREE.Vector3(x, r + G0, z));
    const style = key === 'ing' ? 'twin' : look.spokes === 5 ? 'y' : 'std', calCol = key === 'ing' ? 0xc4161c : 0x2d4fa8;
    const wheels = pts.map((p, i) => { const w = makeWheel(r, look, i % 2 === 0, style, calCol, own); w.caliper.position.add(p); g.add(w.caliper); return w.wheel; });

    g.traverse((x) => { if (x.isMesh && x.material === paint) x.castShadow = true; });
    let lit = false;
    return {
        group: g, wheels, wheelPts: pts, lights: [], eye: new THREE.Vector3(...D.eye), wheelC: new THREE.Vector3(...D.wheelC),
        brake: (on) => { if (lit !== on) { lit = on; tailM.emissiveIntensity = on ? 2.4 : 0.35; } },
        dispose: () => {
            own.forEach((m) => m.dispose());
            g.traverse((x) => { if (x.isMesh && x.geometry !== tub) x.geometry.dispose(); });
            [B.geo, B.ggeo, tub].forEach((x) => x.dispose());
        },
    };
}
