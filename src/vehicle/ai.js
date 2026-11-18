const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 샘플별 국소 곡률(rad/m): 5개 구간의 진행 방향 변화량 평균. 연속 S자 코너도 반영된다
const curvature = (S) => S.curv ??= S.map((_, i) => {
    const N = S.length; let a = 0;
    for (let k = -2; k <= 2; k++) { const A = S[(i + k + N) % N].t, B = S[(i + k + 1 + N) % N].t; a += Math.acos(clamp(A.x * B.x + A.z * B.z, -1, 1)); }
    return a / (5 * S.step);
});

export class AI {
    constructor(car, S, skill, offset, seed) { Object.assign(this, { car, S, skill, offset, seed, stuck: 0, t: 0 }); }

    drive(dt) {
        const { car: c, S } = this, N = S.length, i = c.idx, sp = c.kmh / 3.6;
        this.t += dt;
        const T = S[(i + Math.floor(3 + sp * 0.22)) % N], p = c.body.position;
        const dx = T.p.x + T.n.x * this.offset - p.x, dz = T.p.z + T.n.z * this.offset - p.z;
        const ang = Math.atan2(dx * c.fwd.z - dz * c.fwd.x, dx * c.fwd.x + dz * c.fwd.z); // 양수: 목표가 왼쪽
        const steer = clamp(-ang * 1.7 + Math.sin(this.t * 0.7 + this.seed) * (1 - this.skill) * 0.25, -1, 1);

        // 앞쪽 곡률로 코너 한계 속도를 구하고, 그 지점까지 감속 가능한 속도로 현재 목표 속도를 제한한다
        const K = curvature(S), aLat = 3.8 + 4.6 * this.skill;
        let vt = c.spec.top * this.skill;
        for (let j = 0; j <= 30; j += 2) vt = Math.min(vt, Math.sqrt(aLat / Math.max(K[(i + j) % N], 1e-4) + (10 + 4 * this.skill) * j * S.step));
        vt = Math.max(vt, 14);
        this.stuck = sp < 1.5 ? this.stuck + dt : 0;
        const brk = sp > vt * 1.05 ? clamp((sp - vt) / 6, 0.3, 1) : 0;
        return { steer, thr: brk || sp > vt ? 0 : 1, brk, hand: 0, auto: true };
    }
}
