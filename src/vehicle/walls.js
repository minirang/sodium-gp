const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 배리어는 코스 중심선 기준 한계선으로 해석한다. 박스 충돌과 달리 스치기만 해도 튕기거나 뚫리지 않는다.
export function resolveWalls(car, T) {
    const { S, N, limit } = T, b = car.body, f = car.fwd, r = { x: -f.z, z: f.x };
    const { hx, hz, ox, mass: m } = car.spec, I = m * 1.9;
    let worst = 0, pen = 0, nx = 0, nz = 0, scrape = 0;
    car.contact = null;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const rx = f.x * (ox + hx * sx) + r.x * hz * sz, rz = f.z * (ox + hx * sx) + r.z * hz * sz;
        const cx = b.position.x + rx, cz = b.position.z + rz;
        let j = car.idx, bd = 1e18;
        for (let k = -4; k <= 4; k++) { const q = (car.idx + k + N) % N, d = (S[q].p.x - cx) ** 2 + (S[q].p.z - cz) ** 2; if (d < bd) { bd = d; j = q; } }
        const s = S[j], d = (cx - s.p.x) * s.n.x + (cz - s.p.z) * s.n.z, over = Math.abs(d) - limit;
        if (over <= 0) continue;
        const side = Math.sign(d), wx = -side * s.n.x, wz = -side * s.n.z, w = b.angularVelocity;
        const vx = b.velocity.x + w.y * rz, vz = b.velocity.z - w.y * rx, vn = vx * wx + vz * wz;
        if (vn < 0) {
            const rc = rx * wz - rz * wx, me = 1 / (1 / m + (rc * rc) / I), J = -1.12 * vn * me;
            b.velocity.x += (wx * J) / m; b.velocity.z += (wz * J) / m; w.y -= ((rc * J) / I) * 0.3;
            const vt = vx * -wz + vz * wx, Jf = clamp(-vt * me * 0.5, -0.25 * J, 0.25 * J);
            b.velocity.x += (-wz * Jf) / m; b.velocity.z += (wx * Jf) / m;
            worst = Math.max(worst, -vn); scrape = Math.max(scrape, Math.abs(vt));
        }
        if (over > pen) { pen = over; nx = wx; nz = wz; car.contact = [cx, cz]; }
    }
    if (pen > 0) { b.position.x += nx * pen; b.position.z += nz * pen; }
    if (pen > 0) car.wallT = 0.3; // 벽과 닿은 직후 잠깐 주행 보조(카운터 스티어)를 쉬게 한다
    car.scrape = pen > 0 ? clamp(scrape / 25, 0, 1) : 0;
    return worst;
}
