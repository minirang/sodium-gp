import * as THREE from 'three';
import { LAYERS, LAYER_IDS } from './facades.js';

// 건물 지오메트리 누산기: 청크(CH m 격자)별로 정점 배열에 바로 써 넣고 마지막에 메쉬 하나로 만든다.
// 정점마다 layer(외벽 종류)·tint(외벽 색조)·seed(창 불빛 무작위)를 가진다.
export class Buildings {
    constructor(CH = 180) { this.CH = CH; this.ch = new Map(); }

    acc(x, z) {
        const k = `${Math.floor(x / this.CH)},${Math.floor(z / this.CH)}`;
        if (!this.ch.has(k)) this.ch.set(k, { p: [], n: [], uv: [], t: [], l: [], s: [], i: [] });
        return this.ch.get(k);
    }

    // 사각형 한 장 (a,b,c,d 반시계, 바깥에서 볼 때)
    quad(A, a, b, c, d, uv, lay, tint, seed) {
        const o = A.p.length / 3, e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        for (const [v, t] of [[a, uv[0]], [b, uv[1]], [c, uv[2]], [d, uv[3]]]) { A.p.push(v[0], v[1], v[2]); A.n.push(nx, ny, nz); A.uv.push(t[0], t[1]); A.t.push(tint.r, tint.g, tint.b); A.l.push(lay); A.s.push(seed); }
        A.i.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }

    // 다각형 기둥(바닥 윤곽 pts[]를 y0~y1로 세움). 벽은 외벽 레이어, 윗면은 지붕 레이어
    prism(pts, y0, y1, o) {
        const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        const A = this.acc(cx, cz), L = LAYERS[o.layer], lay = LAYER_IDS[o.layer], seed = o.seed ?? Math.random();
        let u = o.u0 || 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
            const u1 = u + len / L.u, v0 = y0 / L.v + (o.v0 || 0), v1 = y1 / L.v + (o.v0 || 0);
            this.quad(A, [p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], [[u, v0], [u1, v0], [u1, v1], [u, v1]], lay, o.tint, seed);
            u = o.wrapU ? u1 : u + Math.ceil(len / L.u * L.cols) / L.cols;
        }
        if (o.roof !== false) {
            const R = LAYERS[o.roofLayer || 'roof'], rl = LAYER_IDS[o.roofLayer || 'roof'], rt = o.roofTint || o.tint, o2 = A.p.length / 3;
            const ny = 1;
            for (const p of pts) { A.p.push(p[0], y1, p[1]); A.n.push(0, ny, 0); A.uv.push(p[0] / R.u, p[1] / R.v); A.t.push(rt.r, rt.g, rt.b); A.l.push(rl); A.s.push(0); }
            for (let i = 1; i < pts.length - 1; i++) A.i.push(o2, o2 + i, o2 + i + 1);
        }
    }

    // 회전된 직사각형 바닥 윤곽
    static rect(x, z, w, d, yaw) {
        const c = Math.cos(yaw), s = Math.sin(yaw), hw = w / 2, hd = d / 2;
        return [[-hw, -hd], [-hw, hd], [hw, hd], [hw, -hd]].map(([a, b]) => [x + a * c + b * s, z - a * s + b * c]);
    }
    static circle(x, z, r, n = 18) { const p = []; for (let i = 0; i < n; i++) { const a = -(i / n) * Math.PI * 2; p.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); } return p; }

    box(x, z, w, d, yaw, y0, y1, o) { this.prism(Buildings.rect(x, z, w, d, yaw), y0, y1, o); }

    // 박공지붕(기와 레이어)
    gable(x, z, w, d, yaw, y0, h, o) {
        const A = this.acc(x, z), lay = LAYER_IDS[o.layer || 'tiles'], L = LAYERS[o.layer || 'tiles'], c = Math.cos(yaw), s = Math.sin(yaw), seed = 0;
        const P = (a, y, b) => [x + a * c + b * s, y, z - a * s + b * c], hw = w / 2, hd = d / 2, sl = Math.hypot(hd, h) / L.v, ul = w / L.u;
        this.quad(A, P(-hw, y0, hd), P(hw, y0, hd), P(hw, y0 + h, 0), P(-hw, y0 + h, 0), [[0, 0], [ul, 0], [ul, sl], [0, sl]], lay, o.tint, seed);
        this.quad(A, P(hw, y0, -hd), P(-hw, y0, -hd), P(-hw, y0 + h, 0), P(hw, y0 + h, 0), [[0, 0], [ul, 0], [ul, sl], [0, sl]], lay, o.tint, seed);
        // 박공 벽(삼각형)은 외벽색
        const wl = LAYER_IDS[o.wall || 'stucco'], wt = o.wallTint || o.tint;
        for (const sx of [-1, 1]) {
            const o2 = A.p.length / 3, pts = [P(sx * hw, y0, sx * hd), P(sx * hw, y0, -sx * hd), P(sx * hw, y0 + h, 0)];
            for (const v of pts) { A.p.push(...v); A.n.push(sx * c, 0, -sx * s); A.uv.push(0.01, 0.01); A.t.push(wt.r, wt.g, wt.b); A.l.push(wl); A.s.push(0); }
            A.i.push(o2, o2 + 1, o2 + 2);
        }
    }

    build(mat, group, shadow = true) {
        const meshes = [];
        for (const A of this.ch.values()) {
            if (!A.i.length) continue;
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
            g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
            g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
            g.setAttribute('tint', new THREE.Float32BufferAttribute(A.t, 3));
            g.setAttribute('layer', new THREE.Float32BufferAttribute(A.l, 1));
            g.setAttribute('seed', new THREE.Float32BufferAttribute(A.s, 1));
            g.setIndex(A.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(A.i, 1) : new THREE.Uint16BufferAttribute(A.i, 1));
            g.computeBoundingSphere();
            const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; group.add(m); meshes.push(m);
        }
        this.ch.clear();
        return meshes;
    }
}

// ── 건물 종류별 생성기. B: Buildings, rand: 난수, x/z/yaw: 위치, rad: 대략적인 반지름
const HSL = (h, s, l) => new THREE.Color().setHSL(h, s, l);
export const WHITE = new THREE.Color(1, 1, 1);

export function tower(B, rand, x, z, rad, yaw, h, roofs) {
    const R = (a, b) => a + rand() * (b - a), kind = rand(), seed = rand();
    const glassy = ['office', 'curtain', 'fins', 'dark', 'mirror'][Math.floor(rand() * 5)];
    const tint = HSL(R(0.55, 0.62), R(0, 0.12), R(0.75, 0.95)), w = rad * R(1.1, 1.5), d = rad * R(1.0, 1.4);
    const base = { tint, seed, layer: 'shop', roof: false };
    B.box(x, z, w + 1.2, d + 1.2, yaw, 0, 5.4, base);
    if (kind < 0.25) {
        // 원통형 타워
        B.prism(Buildings.circle(x, z, Math.min(w, d) / 2, 20), 5.4, h, { tint, seed, layer: glassy, wrapU: true });
        roofs.push({ x, z, y: h, w: Math.min(w, d) * 0.7, d: Math.min(w, d) * 0.7, yaw, kind: 'heli' });
    } else if (kind < 0.55) {
        // 셋백 타워: 위로 갈수록 좁아지는 2~3단
        const tiers = 2 + Math.floor(rand() * 2); let y = 5.4, cw = w, cd = d;
        for (let t = 0; t < tiers; t++) {
            const top = t === tiers - 1 ? h : y + (h - y) * R(0.45, 0.6);
            B.box(x, z, cw, cd, yaw, y, top, { tint, seed, layer: glassy });
            if (t < tiers - 1) roofs.push({ x, z, y: top, w: cw, d: cd, yaw, kind: 'ac' });
            y = top; cw *= R(0.68, 0.82); cd *= R(0.68, 0.82);
        }
        roofs.push({ x, z, y, w: cw, d: cd, yaw, kind: rand() < 0.5 ? 'mast' : 'ac' });
    } else if (kind < 0.75) {
        // 포디움(저층부) + 타워
        const ph = R(14, 22), pl = rand() < 0.5 ? 'concrete' : 'ribbon';
        B.box(x, z, w + 1, d + 1, yaw, 5.4, ph, { tint: HSL(R(0.06, 0.12), R(0.05, 0.2), R(0.65, 0.85)), seed, layer: pl });
        roofs.push({ x, z, y: ph, w: w + 1, d: d + 1, yaw, kind: 'ac' });
        const ox = (rand() - 0.5) * w * 0.25;
        B.box(x + Math.cos(yaw) * ox, z - Math.sin(yaw) * ox, w * 0.62, d * 0.62, yaw, ph, h, { tint, seed, layer: glassy });
        roofs.push({ x: x + Math.cos(yaw) * ox, z: z - Math.sin(yaw) * ox, y: h, w: w * 0.62, d: d * 0.62, yaw, kind: rand() < 0.4 ? 'heli' : 'mast' });
    } else {
        // 단순 박스 타워 + 옥상 설비
        B.box(x, z, w, d, yaw, 5.4, h, { tint, seed, layer: glassy });
        roofs.push({ x, z, y: h, w, d, yaw, kind: 'ac' });
    }
    return { w: w + 1.2, d: d + 1.2, flat: kind >= 0.25 };
}

export function midrise(B, rand, x, z, rad, yaw, h, roofs, layers = ['concrete', 'brick', 'ribbon', 'apt']) {
    const R = (a, b) => a + rand() * (b - a), seed = rand(), layer = layers[Math.floor(rand() * layers.length)];
    const tint = layer === 'brick' ? HSL(R(0.02, 0.06), R(0.2, 0.5), R(0.75, 1)) : HSL(R(0.05, 0.6), R(0, 0.25), R(0.72, 0.98));
    const w = rad * R(1.2, 1.6), d = rad * R(1.0, 1.3), shop = rand() < 0.7;
    if (shop) B.box(x, z, w + 0.6, d + 0.6, yaw, 0, 4.8, { tint, seed, layer: 'shop', roof: false });
    let flat = true;
    if (rand() < 0.3) {
        // ㄱ자 건물
        flat = false;
        const c = Math.cos(yaw), s = Math.sin(yaw);
        B.box(x - c * w * 0.2, z + s * w * 0.2, w * 0.6, d, yaw, shop ? 4.8 : 0, h, { tint, seed, layer });
        B.box(x + c * w * 0.25 + s * d * 0.2, z - s * w * 0.25 + c * d * 0.2, w * 0.5, d * 0.6, yaw, shop ? 4.8 : 0, h * R(0.6, 0.9), { tint, seed, layer });
    } else B.box(x, z, w, d, yaw, shop ? 4.8 : 0, h, { tint, seed, layer });
    roofs.push({ x, z, y: h, w: w * 0.8, d: d * 0.8, yaw, kind: rand() < 0.4 ? 'tank' : 'ac' });
    return { w: w + 0.6, d: d + 0.6, flat };
}

// 옥상 설비(실외기·물탱크·안테나·헬리패드)를 인스턴스로 만든다
export function roofProps(roofs, rand, inst, D, mats) {
    const ac = [], tank = [], mast = [], heli = [];
    for (const r of roofs) {
        const c = Math.cos(r.yaw), s = Math.sin(r.yaw), at = (a, b) => [r.x + a * c + b * s, r.z - a * s + b * c];
        if (r.kind === 'ac') for (let i = 0, n = 2 + Math.floor(rand() * 5); i < n; i++) ac.push([...at((rand() - 0.5) * r.w * 0.7, (rand() - 0.5) * r.d * 0.7), r.y, r.yaw, 1 + rand() * 1.5]);
        if (r.kind === 'tank') tank.push([...at((rand() - 0.5) * r.w * 0.4, (rand() - 0.5) * r.d * 0.4), r.y]);
        if (r.kind === 'mast') { mast.push([r.x, r.z, r.y, 8 + rand() * 18]); ac.push([...at(r.w * 0.2, 0), r.y, r.yaw, 2]); }
        if (r.kind === 'heli') heli.push([r.x, r.z, r.y, Math.min(r.w, r.d) * 0.45]);
    }
    inst(new THREE.BoxGeometry(1.6, 1.1, 1.2).translate(0, 0.55, 0), mats.metal, ac.length, (i) => { const [x, z, y, yaw, k] = ac[i]; D.position.set(x, y, z); D.rotation.y = yaw; D.scale.set(k, 1, k); });
    inst(new THREE.CylinderGeometry(1.4, 1.4, 3, 10).translate(0, 3.2, 0), mats.tank, tank.length, (i) => { const [x, z, y] = tank[i]; D.position.set(x, y, z); });
    inst(new THREE.CylinderGeometry(0.15, 0.3, 1, 5).translate(0, 0.5, 0), mats.metal, mast.length, (i) => { const [x, z, y, h] = mast[i]; D.position.set(x, y, z); D.scale.set(1, h, 1); });
    inst(new THREE.CylinderGeometry(1, 1, 0.3, 20).translate(0, 0.15, 0), mats.heli, heli.length, (i) => { const [x, z, y, r] = heli[i]; D.position.set(x, y, z); D.scale.set(r, 1, r); });
    return mast.map(([x, z, y, h]) => [x, y + h + 0.5, z]);
}
