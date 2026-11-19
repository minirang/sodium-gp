const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 샘플별 국소 곡률(rad/m): 5개 구간의 진행 방향 변화량 평균. 연속 S자 코너도 반영된다
const curvature = (S) => S.curv ??= S.map((_, i) => {
    const N = S.length; let a = 0;
    for (let k = -2; k <= 2; k++) { const A = S[(i + k + N) % N].t, B = S[(i + k + 1 + N) % N].t; a += Math.acos(clamp(A.x * B.x + A.z * B.z, -1, 1)); }
    return a / (5 * S.step);
});

// 드라이버 개성: pace 속도, brake 브레이킹 늦기(>1 늦게), corner 코너 한계, aggro 추월 의지, noise 실수 빈도, react 출발 반응(초), lane 선호 라인, late 후반 가속
export const PERSONAS = [
    { name: '공격형', pace: 1.0, brake: 1.18, corner: 1.07, aggro: 1, noise: 0.07, react: [0.05, 0.25], lane: 0, late: 0 },
    { name: '안정형', pace: 0.97, brake: 0.88, corner: 0.95, aggro: 0.25, noise: 0.015, react: [0.2, 0.5], lane: 0, late: 0 },
    { name: '초반 돌진형', pace: 1.01, brake: 1.05, corner: 1.0, aggro: 0.8, noise: 0.05, react: [0.0, 0.12], lane: 1, late: -0.015 },
    { name: '실수 잦은 타입', pace: 1.02, brake: 1.1, corner: 1.05, aggro: 0.6, noise: 0.2, react: [0.1, 0.4], lane: -1, late: 0 },
    { name: '정밀 주행형', pace: 0.99, brake: 1.0, corner: 1.0, aggro: 0.5, noise: 0.01, react: [0.15, 0.3], lane: 0, late: 0 },
    { name: '인코스 선호', pace: 0.98, brake: 1.0, corner: 1.0, aggro: 0.6, noise: 0.03, react: [0.1, 0.35], lane: -3, late: 0 },
    { name: '아웃코스 선호', pace: 0.99, brake: 1.08, corner: 1.02, aggro: 0.7, noise: 0.03, react: [0.1, 0.35], lane: 3, late: 0 },
    { name: '후반 강한 타입', pace: 0.95, brake: 1.0, corner: 1.0, aggro: 0.5, noise: 0.03, react: [0.15, 0.4], lane: 0, late: 0.03 },
];

export class AI {
    constructor(car, S, level, persona, seed) {
        Object.assign(this, { car, S, lv: level, p: persona, seed, t: 0, stuck: 0, mist: 0, mistT: 3 + Math.random() * 6 });
        this.lane = persona.lane + (Math.random() - 0.5) * 1.2;
        this.react = persona.react[0] + Math.random() * (persona.react[1] - persona.react[0]);
        const s = S[car.idx];
        this.start = this.off = (car.body.position.x - s.p.x) * s.n.x + (car.body.position.z - s.p.z) * s.n.z;
    }

    drive(dt, cars) {
        const { car: c, S, p } = this, N = S.length, i = c.idx, sp = c.kmh / 3.6, f = c.fwd;
        this.t += dt;
        // 개성: 간헐적인 실수(속도 저하 + 흔들림)
        this.mistT -= dt;
        if (this.mistT <= 0) { this.mist = 0.4 + p.noise * 3; this.mistT = (7 + Math.random() * 10) / (1 + p.noise * 8); }
        this.mist = Math.max(0, this.mist - dt);

        // 주변 차량 인식: 앞차 따라가기/추월 회피
        let cap = 1e9, dodge = 0;
        for (const o of cars) {
            if (o === c) continue;
            const dx = o.body.position.x - c.body.position.x, dz = o.body.position.z - c.body.position.z, ahead = dx * f.x + dz * f.z, lat = -dx * f.z + dz * f.x;
            if (ahead > -2 && ahead < 30 && Math.abs(lat) < 2.7) {
                cap = Math.min(cap, o.kmh / 3.6 + Math.max(ahead - 8.5 + p.aggro * 2, 0) * (0.8 - p.aggro * 0.25));
                dodge += (lat > 0 ? -1 : 1) * (1.4 + p.aggro * 2.2) * (1 - ahead / 30);
            } else if (Math.abs(ahead) < 4 && Math.abs(lat) < 2.9) dodge += (lat > 0 ? -1 : 1) * 1.6;
        }
        // 출발 직후에는 자기 열을 유지하고, 드라이버마다 시점을 달리해 천천히 개인 라인으로 이동한다
        const want = clamp((this.t < 3 + (this.seed % 3) ? this.start : this.lane) + clamp(dodge, -4, 4), -5.8, 5.8);
        this.off += clamp(want - this.off, -dt * 1.5, dt * 1.5);

        const T = S[(i + Math.floor(3 + sp * 0.22)) % N], pos = c.body.position;
        const dx = T.p.x + T.n.x * this.off - pos.x, dz = T.p.z + T.n.z * this.off - pos.z;
        const ang = Math.atan2(dx * f.z - dz * f.x, dx * f.x + dz * f.z); // 양수: 목표가 왼쪽
        const steer = clamp(-ang * 1.7 + Math.sin(this.t * 0.9 + this.seed) * p.noise + (this.mist > 0 ? Math.sin(this.t * 7 + this.seed) * 0.2 * Math.min(1, this.mist) : 0), -1, 1);

        // 앞쪽 곡률로 코너 한계 속도를 구하고, 그 지점까지 감속 가능한 속도로 제한
        const K = curvature(S), aLat = (3.8 + 4.6 * this.lv) * p.corner, decel = (10 + 4 * this.lv) * p.brake;
        let vt = c.spec.top * this.lv * p.pace * (1 + p.late * Math.max(0, c.lap - 1));
        for (let j = 0; j <= 30; j += 2) vt = Math.min(vt, Math.sqrt(aLat / Math.max(K[(i + j) % N], 1e-4) + decel * j * S.step));
        vt = Math.max(vt, 14) * (1 - Math.min(1, this.mist) * 0.15) * (0.86 + 0.14 * clamp(this.t / 14, 0, 1)); // 출발 직후 첫 코너 혼잡 완화
        vt = Math.min(vt, cap);
        this.stuck = sp < 1.5 ? this.stuck + dt : 0;
        const brk = sp > vt * 1.05 ? clamp((sp - vt) / 6, 0.3, 1) : 0;
        return { steer, thr: brk || sp > vt ? 0 : 1, brk, hand: 0, auto: true };
    }
}
