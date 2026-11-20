import * as C from 'cannon-es';
import * as THREE from 'three';
import { buildCar } from './model.js';
import { makeBlob } from '../systems/fx.js';

const RATIO = [3.6, 2.6, 1.95, 1.55, 1.28, 1.05];
const WB = 2.65; // 휠베이스(m)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const FWD = new C.Vec3(1, 0, 0), UP = new C.Vec3(0, 1, 0), RIGHT = new C.Vec3(0, 0, 1);
const E = new THREE.Euler(), TQ = new C.Vec3(), QA = new THREE.Quaternion(), QB = new THREE.Quaternion();
export const G_WORLD = 1, G_CAR = 2;

// 토크 곡선: 저회전에서 약하고 피크(0.85) 이후 레드라인까지 떨어진다
const torque = (r) => (r < 0.85 ? 0.68 + 0.32 * (r / 0.85) : r < 1 ? 1 - ((r - 0.85) / 0.15) * 0.35 : 0);

export class Car {
    constructor(world, scene, spec, look, pose, opts = {}) {
        Object.assign(this, { world, scene, spec, look, gear: 1, shiftT: 0, rpm: 1000, kmh: 0, fs: 0, idx: 0, lap: 0, maxLap: 0, prog: 0, laps: [], lapT: 0, finished: false, hold: true, startAt: 0, hit: null, flipT: 0, reverse: false, braking: false, slide: 0, scrape: 0, draft: 0, steerIn: 0, onShift: null, delta: 0, ghost: 0, righting: null, contacts: 4, yaw: pose.yaw, hb: 0, wallT: 0 });
        this.fw = new C.Vec3(); this.rt = new C.Vec3(); this.upv = new C.Vec3(); this.upv2 = new C.Vec3(); this.aero = new C.Vec3(); this.fwd = { x: 1, z: 0 };
        const m = this.model = buildCar(look, opts);
        this.mesh = m.group; this.wheels = m.wheels; this.lights = m.lights;
        this.blob = makeBlob(spec);
        scene.add(m.group, ...m.wheels, this.blob);

        // 엔진·공력: 출력(W)과 최고속도에서 공기저항 계수를 역산해 차량 사양대로 달린다
        this.P = spec.mass * 172 * spec.power;
        this.drag = this.P / spec.top ** 3;
        this.down = spec.mass * 0.0011;
        this.tcap = spec.mass * spec.grip * 3.4; // 출발 시 구동력 한계
        this.I = spec.mass * 0.55;

        // 렌더 보간용 이전/현재 상태
        this.pp = new THREE.Vector3(); this.cp = new THREE.Vector3(); this.pq = new THREE.Quaternion(); this.cq = new THREE.Quaternion();
        this.wp = [0, 1, 2, 3].map(() => new THREE.Vector3()); this.wc = [0, 1, 2, 3].map(() => new THREE.Vector3()); this.wq = [0, 1, 2, 3].map(() => new THREE.Quaternion());

        const body = this.body = new C.Body({ mass: spec.mass, linearDamping: 0.004, angularDamping: 0.3, collisionFilterGroup: G_CAR, collisionFilterMask: G_CAR | G_WORLD });
        // 충돌 박스를 조금 위로 올려 무게중심이 상대적으로 낮아지게 한다
        body.addShape(new C.Box(new C.Vec3(spec.hx, 0.33, spec.hz)), new C.Vec3(spec.ox, 0.12, 0));
        body.addEventListener('collide', (e) => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v > 2.5) this.hit?.(v); });
        const v = this.vehicle = new C.RaycastVehicle({ chassisBody: body, indexRightAxis: 2, indexForwardAxis: 0, indexUpAxis: 1 });
        const r = look.wheel, o = { radius: r, directionLocal: new C.Vec3(0, -1, 0), axleLocal: new C.Vec3(0, 0, 1), suspensionStiffness: 40, suspensionRestLength: 0.15, maxSuspensionTravel: 0.22, maxSuspensionForce: 2e5, dampingRelaxation: 3.2, dampingCompression: 4.8, rollInfluence: 0.03, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true };
        this.gripF = spec.grip * 0.57; this.gripR = spec.grip * 0.55;
        m.wheelPts.forEach((p, i) => v.addWheel({ ...o, frictionSlip: i < 2 ? this.gripF : this.gripR, chassisConnectionPointLocal: new C.Vec3(p.x, r - 0.46, p.z) }));
        v.addToWorld(world);

        // 물리 스텝마다: 공기저항·다운포스, 자세 안정화(롤/피치 복원), 비정상적인 튕김 제한
        this._pre = () => {
            const b = body, fw = b.vectorToWorldFrame(FWD, this.fw), s = b.velocity.dot(fw), w = b.angularVelocity;
            const fd = -this.drag * s * Math.abs(s);
            b.applyForce(this.aero.set(fw.x * fd, -this.down * s * s, fw.z * fd));
            let n = 0; for (const wi of v.wheelInfos) if (wi.isInContact) n++;
            this.contacts = n;
            if (this.righting) return;
            const up = b.vectorToWorldFrame(UP, this.upv2), air = n < 2;
            let ax = -up.z, az = up.x, sn = Math.hypot(ax, az);
            if (sn < 1e-3) { ax = fw.x; az = fw.z; sn = Math.hypot(ax, az) || 1; }
            ax /= sn; az /= sn;
            const ang = Math.acos(clamp(up.y, -1, 1)), om = air ? 5 : 3.2, ex = Math.max(0, ang - (air ? 0.02 : 0.12)), k = this.I * om * om;
            const mag = Math.min(k * ex, k * (air ? 1.2 : 0.5)), zeta = air ? 0.9 : ex > 0 ? 0.6 : 0.12, dmp = this.I * 2 * zeta * om;
            b.torque.x += ax * mag - w.x * dmp; b.torque.z += az * mag - w.z * dmp;
            w.x = clamp(w.x, -2, 2); w.y = clamp(w.y, -3, 3); w.z = clamp(w.z, -2, 2);
            if (b.velocity.y > 3.5) b.velocity.y = 3.5;
        };
        world.addEventListener('preStep', this._pre);
        this.place(pose);
    }

    vmax(g) { return (this.spec.top * RATIO[5]) / RATIO[g - 1]; }
    // 속도에 따른 최대 조향각: 고속에서 과도한 조향을 막되 한계 주행은 가능하게
    maxSteer(a) { return Math.min(0.5, (WB * 13) / Math.max(a * a, 1) + 0.03); }

    place({ pos, yaw }) {
        const b = this.body;
        b.position.set(pos.x, 0.9, pos.z); b.quaternion.setFromEuler(0, yaw, 0);
        b.velocity.setZero(); b.angularVelocity.setZero();
        this.fwd.x = Math.cos(yaw); this.fwd.z = -Math.sin(yaw); this.yaw = yaw;
        Object.assign(this, { gear: 1, delta: 0, righting: null, flipT: 0, shiftT: 0, hb: 0, wallT: 0 });
        for (let i = 0; i < 4; i++) this.vehicle.setSteeringValue(0, i);
        this.capture(); this.snap(); this.render(1, false);
    }

    // 뒤집히거나 옆으로 누운 채 멈추면 순간이동 대신 부드럽게 들어 올려 바로 세운다
    startRight() {
        const b = this.body;
        QA.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        QB.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
        this.righting = { t: 0, q0: QA.clone(), q1: QB.clone(), y0: b.position.y };
        this.ghost = Math.max(this.ghost, 1.6);
    }

    stepRight(dt) {
        const r = this.righting, b = this.body, D = 0.85;
        r.t += dt; const k = smooth(clamp(r.t / D, 0, 1));
        QA.copy(r.q0).slerp(r.q1, k);
        b.quaternion.set(QA.x, QA.y, QA.z, QA.w);
        b.position.y = r.y0 + (0.85 - r.y0) * k + Math.sin(Math.PI * k) * 0.6;
        b.velocity.x *= 0.9; b.velocity.z *= 0.9; b.velocity.y = 0; b.angularVelocity.setZero();
        if (r.t >= D) { this.righting = null; this.flipT = 0; }
    }

    update(dt, inp) {
        const { body: b, spec: sp, vehicle: v } = this;
        this.ghost = Math.max(0, this.ghost - dt);
        const mask = this.ghost > 0 ? G_WORLD : G_WORLD | G_CAR;
        if (b.collisionFilterMask !== mask) b.collisionFilterMask = mask;

        const fw = b.vectorToWorldFrame(FWD, this.fw), fs = this.fs = b.velocity.dot(fw), a = Math.abs(fs), vlat = b.velocity.dot(b.vectorToWorldFrame(RIGHT, this.rt));
        const hl = Math.hypot(fw.x, fw.z);
        if (hl > 0.25) { this.fwd.x = fw.x / hl; this.fwd.z = fw.z / hl; this.yaw = Math.atan2(-this.fwd.z, this.fwd.x); }
        const speed = Math.hypot(b.velocity.x, b.velocity.z);
        this.kmh = speed * 3.6; this.shiftT = Math.max(0, this.shiftT - dt);
        // 핸드브레이크: 당기면 빠르게 걸리고, 놓으면 뒷바퀴 그립이 0.25초 정도에 걸쳐 자연스럽게 돌아온다
        this.hb += clamp((inp.hand ? 1 : 0) - this.hb, -dt * 4, dt * 12);
        this.wallT = Math.max(0, this.wallT - dt);
        this.slide = this.kmh > 15 ? clamp(Math.abs(vlat) / 4 + this.hb * 0.45, 0, 1) : 0;

        const up = b.vectorToWorldFrame(UP, this.upv);
        if (this.righting) this.stepRight(dt);
        else {
            this.flipT = up.y < 0.45 && speed < 6 ? this.flipT + dt : 0;
            if (this.flipT > 0.8) this.startRight();
        }

        const r = clamp(a / this.vmax(this.gear), 0, 1.05), rearSlip = v.wheelInfos[2].sliding || v.wheelInfos[3].sliding;
        this.rpm = 1000 + 6500 * clamp(Math.max(r, inp.thr * 0.18) + (rearSlip && inp.thr > 0.5 ? 0.12 : 0), 0, 1.03);

        this.lastThr = inp.thr || 0;
        let F = 0, brk = 0; this.reverse = false;
        const coast = !(inp.thr > 0.02) && !(inp.brk > 0.02);
        if (this.hold) { brk = 1; this.rpm = 1000 + 5500 * clamp(inp.thr, 0, 1); }
        else if (inp.thr > 0.02) {
            if (fs < -1.5) brk = inp.thr;
            else if (!this.shiftT) F = Math.min(this.tcap, (this.P / (this.vmax(this.gear) * 0.85)) * torque(r)) * inp.thr * (1 - 0.65 * this.hb);
        } else if (inp.brk > 0.02) {
            if (fs > 1.5) brk = inp.brk;
            else { this.reverse = true; F = fs > -11 ? -sp.mass * 3.4 * inp.brk : 0; }
        }
        if (F > 0) {
            F *= 1 + this.draft * 0.12;
            if (inp.assist > 1 && (rearSlip || this.slide > 0.5)) F *= 0.6; // 구동력 제어
        }

        const was = this.gear;
        if (inp.auto) {
            if (r > 0.95 && this.gear < 6 && !this.shiftT) { this.gear++; this.shiftT = 0.15; }
            else if (this.gear > 1 && a < this.vmax(this.gear - 1) * 0.72) this.gear--;
        } else {
            if (inp.up && this.gear < 6) { this.gear++; this.shiftT = 0.15; }
            if (inp.down && this.gear > 1 && a < this.vmax(this.gear - 1) * 0.98) this.gear--;
        }
        if (this.gear !== was) this.onShift?.(this.gear > was, inp.thr);

        // 브레이크는 '감속도'로 준다: 바퀴가 잠기지 않아 제동 중에도 조향이 살아 있다 (ABS 느낌)
        const hb = this.hb, bi = brk * sp.mass * 13.5 * dt, eb = coast && !this.hold ? sp.mass * (0.7 + a * 0.015) * dt * 0.5 : 0;
        // 핸드브레이크 제동: 고속에서는 뒷바퀴를 반쯤 잠가 미끄러지게, 저속에서는 차를 확실히 붙잡는다
        const hbB = hb * sp.mass * (a < 3 ? 14 : 3.6) * dt;
        this.braking = brk > 0.05 || hb > 0.3;
        for (const i of [0, 1]) { v.setBrake(bi * 0.31, i); v.applyEngineForce(0, i); }
        for (const i of [2, 3]) {
            v.setBrake((F ? 0 : bi * 0.19 + eb) + hbB, i); v.applyEngineForce(F / 2, i);
            v.wheelInfos[i].frictionSlip = this.gripR * (1 - 0.45 * hb);
        }

        const drv = -inp.steer * this.maxSteer(a);
        let target = drv;
        const w = b.angularVelocity;
        // 핸들을 꺾은 채 핸드브레이크를 당기면 뒤가 흐르기 시작하도록 회전을 살짝 거든다
        if (hb > 0.05 && a > 7 && Math.abs(inp.steer) > 0.1) b.torque.y += -inp.steer * hb * sp.mass * 1.1 * clamp((a - 7) / 15, 0, 1) * clamp(1 - Math.abs(vlat) / (a * 0.45), 0, 1); // 이미 충분히 돌았으면 더 거들지 않음
        // 드리프트 중(핸드브레이크)이나 벽에 부딪힌 직후에는 개입하지 않는다
        if (inp.assist > 0 && a > 8 && hb < 0.2 && !this.wallT) {
            // 운전자가 의도한 회전(핸들 입력 기준)보다 차가 크게 돌 때만 카운터 스티어 + 요 안정화.
            // 보조 장치가 만든 조향을 기준으로 삼으면 스스로를 계속 증폭시키므로 반드시 입력 조향을 기준으로 한다
            const cmd = (fs * Math.tan(drv)) / WB, over = w.y - cmd;
            if (Math.abs(over) > 0.35 && over * w.y > 0) {
                target -= clamp(over * 0.12, -0.12, 0.12);
                b.torque.y -= (over - Math.sign(over) * 0.35) * sp.mass * 1.8 * (inp.assist > 1 ? 4 : 2.5);
            }
        }
        this.delta += clamp(target - this.delta, -3.2 * dt, 3.2 * dt);
        v.setSteeringValue(this.delta, 0); v.setSteeringValue(this.delta, 1);
        this.steerIn = inp.rawSteer ?? inp.steer;
    }

    snap() {
        this.pp.copy(this.cp); this.pq.copy(this.cq);
        for (let i = 0; i < 4; i++) this.wp[i].copy(this.wc[i]);
    }

    capture() {
        const b = this.body, vh = this.vehicle;
        this.cp.set(b.position.x, b.position.y, b.position.z); this.cq.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        for (let i = 0; i < 4; i++) {
            vh.updateWheelTransform(i);
            const t = vh.wheelInfos[i].worldTransform;
            this.wc[i].set(t.position.x, t.position.y, t.position.z); this.wq[i].set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
        }
    }

    // 마지막 두 물리 상태 사이를 보간해 그린다
    render(alpha, cockpit) {
        const m = this.mesh;
        m.position.lerpVectors(this.pp, this.cp, alpha); m.quaternion.copy(this.pq).slerp(this.cq, alpha);
        this.model.brake(this.braking);
        if (cockpit) this.model.cockpit?.update(this.steerIn, this);
        for (let i = 0; i < 4; i++) { this.wheels[i].position.lerpVectors(this.wp[i], this.wc[i], alpha); this.wheels[i].quaternion.copy(this.wq[i]); }
        E.setFromQuaternion(m.quaternion, 'YXZ');
        const c = Math.cos(E.y), s = Math.sin(E.y), ox = this.spec.ox;
        this.blob.position.set(m.position.x + c * ox, 0.05, m.position.z - s * ox); this.blob.rotation.y = E.y;
    }

    dispose() {
        this.vehicle.removeFromWorld(this.world);
        this.world.removeEventListener('preStep', this._pre);
        this.scene.remove(this.mesh, ...this.wheels, this.blob);
        this.model.dispose();
    }
}
