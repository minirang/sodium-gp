const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WB = 2.65;

// 최소 곡률 레이싱 라인: 중심선 오프셋을 이웃 점의 중점으로 반복 이완시키되 노폭 안으로 제한한다.
// 아웃-인-아웃 라인이 자연스럽게 나온다. 코스마다 한 번만 계산해 캐시한다.
export function racingLine(S, half) {
    if (S.line) return S.line;
    const N = S.length, off = new Float64Array(N), X = new Float64Array(N), Z = new Float64Array(N);
    const pos = () => { for (let i = 0; i < N; i++) { X[i] = S[i].p.x + S[i].n.x * off[i]; Z[i] = S[i].p.z + S[i].n.z * off[i]; } };
    for (let it = 0; it < 700; it++) {
        pos();
        const h = it < 350 ? 4 : 2;
        for (let i = 0; i < N; i++) {
            const a = (i - h + N) % N, b = (i + h) % N, s = S[i];
            const mx = (X[a] + X[b]) / 2 - s.p.x, mz = (Z[a] + Z[b]) / 2 - s.p.z;
            off[i] += (clamp(mx * s.n.x + mz * s.n.z, -half, half) - off[i]) * 0.55;
        }
    }
    pos();
    const k = new Float64Array(N), ds = new Float64Array(N);
    for (let i = 0; i < N; i++) {
        const a = (i - 2 + N) % N, b = (i + 2) % N;
        const ax = X[i] - X[a], az = Z[i] - Z[a], bx = X[b] - X[i], bz = Z[b] - Z[i], cx = X[b] - X[a], cz = Z[b] - Z[a];
        k[i] = (2 * Math.abs(ax * bz - az * bx)) / Math.max(1e-6, Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz));
        ds[i] = Math.hypot(X[(i + 1) % N] - X[i], Z[(i + 1) % N] - Z[i]);
    }
    // 곡률 노이즈 평활화
    const ks = Float64Array.from(k, (_, i) => (k[(i - 1 + N) % N] + 2 * k[i] + k[(i + 1) % N]) / 4);
    return (S.line = { off, X, Z, k: ks, ds, half });
}

// 곡률 한계 속도 + 앞쪽 코너까지의 제동 거리를 반영한 목표 속도 테이블
function speedProfile(L, vtop, aLat, aBrk) {
    const N = L.k.length, v = new Float64Array(N);
    for (let i = 0; i < N; i++) v[i] = Math.min(vtop, Math.sqrt(aLat / Math.max(L.k[i], 1e-5)));
    for (let pass = 0; pass < 2; pass++) for (let i = N - 1; i >= 0; i--) { const j = (i + 1) % N; v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * aBrk * L.ds[i])); }
    return v;
}

// 드라이버 개성: pace 직선 속도, brake 브레이킹 강도, corner 코너 속도, aggro 추월 의지, noise 실수, react 출발 반응(초), late 후반 페이스
export const PERSONAS = [
    { name: '공격형', pace: 1.0, brake: 1.04, corner: 1.02, aggro: 1, noise: 0.5, react: [0.05, 0.22], late: 0 },
    { name: '안정형', pace: 0.99, brake: 0.96, corner: 0.98, aggro: 0.3, noise: 0.15, react: [0.18, 0.4], late: 0 },
    { name: '초반 돌진형', pace: 1.01, brake: 1.02, corner: 1.0, aggro: 0.85, noise: 0.35, react: [0.0, 0.1], late: -0.01 },
    { name: '실수 잦은 타입', pace: 1.0, brake: 1.03, corner: 1.02, aggro: 0.6, noise: 1.4, react: [0.1, 0.35], late: 0 },
    { name: '정밀 주행형', pace: 1.0, brake: 1.0, corner: 1.0, aggro: 0.5, noise: 0.05, react: [0.12, 0.28], late: 0 },
    { name: '브레이킹 장인', pace: 0.99, brake: 1.06, corner: 0.99, aggro: 0.7, noise: 0.25, react: [0.1, 0.3], late: 0 },
    { name: '코너링 장인', pace: 0.98, brake: 0.99, corner: 1.03, aggro: 0.6, noise: 0.25, react: [0.1, 0.3], late: 0 },
    { name: '후반 강한 타입', pace: 0.99, brake: 1.0, corner: 0.99, aggro: 0.5, noise: 0.2, react: [0.15, 0.35], late: 0.012 },
];

export class AI {
    // level: { corner, brake, pace, err } (config.AI_LEVELS)
    constructor(car, S, level, persona, seed, limit = 9) {
        Object.assign(this, { car, S, lv: level, p: persona, seed, t: 0, stuck: 0, mist: 0, mistT: 4 + Math.random() * 8, shift: 0, boost: 1 });
        this.react = persona.react[0] + Math.random() * (persona.react[1] - persona.react[0]);
        const L = this.L = racingLine(S, limit - 2.8), sp = car.spec;
        const aLat = sp.grip * 5.35 * level.corner * persona.corner, aBrk = 12.4 * level.brake * persona.brake;
        this.vt = speedProfile(L, sp.top * 0.995, aLat, aBrk);
        const s = S[car.idx];
        this.start = (car.body.position.x - s.p.x) * s.n.x + (car.body.position.z - s.p.z) * s.n.z;
        this.shift = this.start - L.off[car.idx];
    }

    offOf(o) { const s = this.S[o.idx], q = o.body.position; return (q.x - s.p.x) * s.n.x + (q.z - s.p.z) * s.n.z; }

    drive(dt, cars) {
        const { car: c, S, p, L, lv } = this, N = S.length, i = c.idx, b = c.body, sp = Math.max(0, c.fs), f = c.fwd;
        this.t += dt;
        const err = lv.err * p.noise;
        // 실수: 브레이킹 포인트 놓침/코너 진입 과속, 잠깐의 라인 이탈
        this.mistT -= dt;
        if (this.mistT <= 0) { this.mist = 0.6 + Math.random() * 0.8; this.mistT = (10 + Math.random() * 16) / Math.max(0.05, err); this.mistK = Math.random() < 0.5 ? -1 : 1; }
        this.mist = Math.max(0, this.mist - dt);

        // 주변 차량: 앞차가 느리면 공간이 넓은 쪽으로 추월 라인을 잡고, 공간이 없으면 뒤에서 따라간다
        const myOff = this.offOf(c), lim = L.half + 1.2;
        let cap = 1e9, want = 0, side = 0;
        for (const o of cars) {
            if (o === c || o.ghost > 0) continue;
            const dx = o.body.position.x - b.position.x, dz = o.body.position.z - b.position.z, ahead = dx * f.x + dz * f.z, lat = -dx * f.z + dz * f.x;
            if (ahead > 1 && ahead < 40 && Math.abs(lat) < 3) {
                const close = sp - o.fs;
                if (close > -1.5 || ahead < 10) {
                    const oo = this.offOf(o), left = lim - oo, right = oo + lim; // 오프셋 +방향이 n
                    const dir = Math.abs(want) > 0 ? Math.sign(want) : left > right ? 1 : -1, room = dir > 0 ? left : right;
                    if (room > 3.6) want = clamp(oo + dir * 3.4, -lim, lim) - L.off[i];
                    else cap = Math.min(cap, o.fs + Math.max(0, ahead - 9) * (0.35 + p.aggro * 0.25));
                }
            } else if (Math.abs(ahead) <= 1.5 + c.spec.hx && Math.abs(lat) < 3.2) side += lat > 0 ? -1 : 1; // 나란히 달릴 때 간격 유지
        }
        // 출발 직후에는 자기 열을 유지하다 서서히 레이싱 라인으로 합류
        const keep = clamp(1 - (this.t - 2.5) / 3, 0, 1);
        const target = (want || keep * (this.start - L.off[i])) + side * 1.6 + (this.mist > 0 ? this.mistK * 1.5 * err : 0);
        this.shift += clamp(target - this.shift, -dt * 3.2, dt * 3.2);
        this.shift = clamp(this.shift, -lim - L.off[i], lim - L.off[i]);

        // 순수 추종(pure pursuit) 조향: 속도에 비례한 전방 주시 거리
        const Ld = clamp(7 + sp * 0.42, 8, 32), j = (i + Math.max(2, Math.round(Ld / S.step))) % N, s = S[j], o2 = L.off[j] + this.shift;
        const tx = s.p.x + s.n.x * o2 - b.position.x, tz = s.p.z + s.n.z * o2 - b.position.z;
        const ang = Math.atan2(tx * f.z - tz * f.x, tx * f.x + tz * f.z), dist = Math.max(4, Math.hypot(tx, tz));
        // 목표점이 옆이나 뒤에 있으면(스핀 직후 등) 사인 값이 작아져 역주행할 수 있으므로 최대로 꺾어 유턴한다
        const back = Math.abs(ang) > Math.PI / 2, kap = back ? Math.sign(ang) * 0.5 : (2 * Math.sin(ang)) / dist, wob = Math.sin(this.t * 0.8 + this.seed) * 0.012 * err;
        let delta = Math.atan(WB * kap) + wob;
        delta += (sp * kap - b.angularVelocity.y) * 0.04; // 요 레이트 피드백으로 흔들림 억제
        let steer = clamp(-delta / c.maxSteer(Math.abs(c.fs)), -1, 1);

        // 목표 속도
        let vt = this.vt[i];
        for (let k = 1; k <= 3; k++) vt = Math.min(vt, this.vt[(i + k) % N]);
        vt *= lv.pace * p.pace * this.boost * (1 + p.late * Math.max(0, c.lap - 1));
        vt *= 1 - Math.min(1, this.mist) * 0.06 * err;
        if (this.t < 6) vt *= 0.9 + 0.1 * (this.t / 6); // 출발 직후 첫 코너 혼잡 완화
        if (Math.abs(this.shift) > 2.5) vt *= 0.985; // 추월 라인은 조금 손해
        vt = Math.max(8, Math.min(vt, cap));
        if (back) vt = 6;

        this.stuck = Math.abs(c.fs) < 1.5 && !c.righting ? this.stuck + dt : 0;

        // 회복(3점 회전): 스핀으로 코스를 거꾸로 보거나 막혀 멈추면 반대로 꺾어 후진 → 코스 쪽으로 꺾어 전진
        const yawErr = Math.atan2(Math.sin(c.yaw - S[i].yaw), Math.cos(c.yaw - S[i].yaw)), R = this.rec;
        if (R) {
            R.t += dt;
            if (R.ph === 0) {
                if (R.t > 1.5 || (R.t > 0.6 && Math.abs(yawErr) < 0.35)) Object.assign(R, { ph: 1, t: 0 });
                else return { steer: -Math.sign(yawErr), thr: 0, brk: 1, hand: 0, auto: true, assist: 1 };
            }
            if (R.t > 1.8 || Math.abs(yawErr) < 0.3) { this.rec = null; this.slow = -1; }
            else return { steer: Math.sign(yawErr), thr: 0.7, brk: 0, hand: 0, auto: true, assist: 1 };
        }
        this.slow = sp < 2.5 && !c.righting ? (this.slow || 0) + dt : Math.max(0, this.slow || 0);
        if ((this.slow > 0.7 && Math.abs(yawErr) > 0.7) || this.slow > 1.6) { this.rec = { ph: Math.abs(yawErr) > 0.7 || this.slow > 1.6 ? 0 : 1, t: 0 }; this.slow = 0; this.stuck = 0; }
        let thr = clamp((vt - sp) * 0.6 + 0.45, 0, 1), brk = sp > vt + 0.8 ? clamp((sp - vt) * 0.32, 0.12, 1) : 0;
        if (brk) thr = 0;
        if (c.slide > 0.55) thr *= 0.5;
        return { steer, thr, brk, hand: 0, auto: true, assist: 1 };
    }
}
