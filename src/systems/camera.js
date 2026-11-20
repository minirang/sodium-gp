import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const Y90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
const V = new THREE.Vector3(), V2 = new THREE.Vector3(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), Q3 = new THREE.Quaternion(), E = new THREE.Euler(), Z = new THREE.Vector3(0, 0, 1);

export const CAM_MODES = ['chase', 'far', 'hood', 'cockpit'];
export const CAM_NAMES = { chase: '3인칭', far: '3인칭 (멀리)', hood: '보닛', cockpit: '1인칭' };

// 실제 운전/레이싱 게임 같은 카메라: 스프링으로 따라가며 가속·제동·코너링의 관성(G)이 느껴지게 한다
export class CamRig {
    constructor(cam) { this.cam = cam; this.reset(); }

    reset() {
        Object.assign(this, { init: false, yaw: 0, yawV: 0, aLong: 0, aLat: 0, pv: new THREE.Vector3(), pos: new THREE.Vector3(), focus: new THREE.Vector3(), head: new THREE.Vector3(), headV: new THREE.Vector3(), look: 0, shake: 0, t: 0, lastBack: false, fov: 70, roll: 0 });
    }

    near(mode) { return mode === 'hood' || mode === 'cockpit' ? 0.08 : 0.25; }

    update(dt, c, mode, back, fovBase) {
        const cam = this.cam, p = c.mesh.position, v = c.body.velocity, f = this.focus;
        this.t += dt;
        const speed = Math.hypot(v.x, v.z), far = clamp(c.kmh / 260, 0, 1);
        // 차체 기준 가속도 (앞뒤·좌우), 부드럽게 걸러서 사용
        if (!this.init) { this.pv.set(v.x, v.y, v.z); f.copy(p); }
        const ax = (v.x - this.pv.x) / Math.max(dt, 1e-3), az = (v.z - this.pv.z) / Math.max(dt, 1e-3), fx = c.fwd.x, fz = c.fwd.z;
        this.pv.set(v.x, v.y, v.z);
        const k = 1 - Math.exp(-dt * 5);
        this.aLong += (clamp(ax * fx + az * fz, -30, 30) - this.aLong) * k;
        this.aLat += (clamp(-ax * fz + az * fx, -30, 30) - this.aLat) * k;

        // 화면의 차 위치를 기준으로, 상하 흔들림만 부드럽게
        if (this.init) { f.x = p.x; f.z = p.z; f.y += (p.y - f.y) * (1 - Math.exp(-dt * 6)); }

        // 시야각: 속도가 붙을수록 조금 넓어지고, 급가속/급제동 때 살짝 움직인다
        const inside = mode === 'hood' || mode === 'cockpit';
        const tf = fovBase + far * (inside ? 6 : 8) + clamp(this.aLong * 0.22, -1.5, 2.5);
        this.fov += (tf - this.fov) * (1 - Math.exp(-dt * 3));
        if (Math.abs(cam.fov - this.fov) > 0.02) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

        if (inside) this.inside(dt, c, mode, back);
        else this.chase(dt, c, mode, back, speed, far);

        // 충돌 흔들림(감쇠 사인파) + 고속 노면 진동
        this.shake = Math.max(0, this.shake - dt * 2.2);
        const vib = c.contacts > 2 ? far * far * (inside ? 0.004 : 0.006) : 0, s = this.shake * 0.12 + vib, t = this.t * 55;
        if (s > 0) { cam.position.x += Math.sin(t) * s; cam.position.y += Math.sin(t * 1.37 + 1) * s; cam.position.z += Math.sin(t * 0.91 + 2) * s; }
        this.lastBack = back; this.init = true;
    }

    chase(dt, c, mode, back, speed, far) {
        const cam = this.cam, f = this.focus, v = c.body.velocity, FAR = mode === 'far';
        // 목표 방향: 차체 방향과 진행 방향의 중간 (드리프트하면 차 옆모습이 보인다)
        let ty = c.yaw;
        if (speed > 5) ty += wrap(Math.atan2(-v.z, v.x) - c.yaw) * 0.5;
        if (back) ty += Math.PI;
        if (!this.init || back !== this.lastBack) { this.yaw = ty; this.yawV = 0; }
        // 임계 감쇠 스프링으로 회전을 따라감 (뒤집히거나 공중이면 느슨하게)
        const w = c.righting || c.contacts < 2 ? 2 : 6.5;
        this.yawV += (wrap(ty - this.yaw) * w * w - 2 * w * this.yawV) * dt;
        this.yaw += this.yawV * dt;
        const dir = V.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        // 가속하면 카메라가 뒤로 밀리고, 제동하면 차에 다가간다
        const surge = back ? 0 : clamp(-this.aLong * 0.045, -0.55, 0.8);
        const dist = (FAR ? 8.2 : 5.7) + far * (FAR ? 1.6 : 1.2) + surge, hgt = (FAR ? 2.6 : 1.6) + far * 0.25, fy = Math.min(f.y, 1.4);
        V2.copy(f).addScaledVector(dir, -dist); V2.y = fy + hgt;
        if (!this.init || back !== this.lastBack) this.pos.copy(V2);
        const kp = 1 - Math.exp(-dt * 16), ky = 1 - Math.exp(-dt * 7);
        this.pos.x += (V2.x - this.pos.x) * kp; this.pos.z += (V2.z - this.pos.z) * kp; this.pos.y += (V2.y - this.pos.y) * ky;
        this.pos.y = Math.max(this.pos.y, 0.7);
        cam.position.copy(this.pos);
        cam.lookAt(V2.copy(f).addScaledVector(dir, (FAR ? 5 : 4) + far * 4).setY(fy + (FAR ? 0.9 : 0.75)));
        // 코너에서 원심력 방향으로 아주 살짝 기울인다
        this.roll += (clamp(this.aLat * 0.0035, -0.035, 0.035) * (back ? -1 : 1) - this.roll) * (1 - Math.exp(-dt * 4));
        cam.rotateOnAxis(Z, this.roll);
    }

    inside(dt, c, mode, back) {
        const cam = this.cam, f = this.focus, m = c.model, hood = mode === 'hood';
        // 머리 움직임: 가속 시 뒤로, 제동 시 앞으로, 코너에서 바깥쪽으로 쏠림 (스프링-댐퍼)
        const tx = clamp(-this.aLong * 0.0035, -0.06, 0.05), tz = clamp(-this.aLat * 0.004, -0.06, 0.06), h = this.head, hv = this.headV, w = 9, z = 0.75;
        const kk = hood ? 0.25 : 1;
        hv.x += ((tx * kk - h.x) * w * w - 2 * z * w * hv.x) * dt; hv.z += ((tz * kk - h.z) * w * w - 2 * z * w * hv.z) * dt;
        h.x += hv.x * dt; h.z += hv.z * dt;
        h.y = c.contacts > 2 ? Math.sin(this.t * 19) * 0.0012 * clamp(c.kmh / 150, 0, 1) : 0;
        // 피치/롤은 일부만 반영해 수평선이 덜 흔들리게
        Q.setFromEuler(E.set(0, c.yaw, 0)); Q2.copy(Q).slerp(c.mesh.quaternion, c.righting ? 0 : hood ? 0.65 : 0.5);
        V.copy(m.eye);
        if (hood) { V.x += 1.15; V.y += 0.1; V.z = 0; }
        V.add(h);
        // 위치는 차체에 단단히 고정한다 (초점처럼 부드럽게 따라가면 실내가 카메라와 따로 출렁인다). 머리 움직임만 더한다
        cam.position.copy(V.applyQuaternion(c.mesh.quaternion)).add(c.mesh.position);
        // 코너 안쪽을 바라보는 시선 (핸들 입력 + 회전 속도)
        const lookT = hood ? 0 : clamp(-c.steerIn * 0.05 + c.body.angularVelocity.y * 0.07, -0.18, 0.18);
        this.look += (lookT - this.look) * (1 - Math.exp(-dt * 5));
        cam.quaternion.copy(Q2).multiply(Y90).multiply(Q3.setFromEuler(E.set(hood ? -0.02 : -0.1, this.look + (back ? Math.PI : 0), 0)));
    }
}
