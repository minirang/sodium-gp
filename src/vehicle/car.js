import * as C from 'cannon-es';
import * as THREE from 'three';
import { buildCar } from './model.js';
import { makeBlob } from '../systems/fx.js';

const RATIO = [3.6, 2.6, 1.95, 1.55, 1.28, 1.05];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FWD = new C.Vec3(1, 0, 0), UP = new C.Vec3(0, 1, 0), RIGHT = new C.Vec3(0, 0, 1);
const E = new THREE.Euler();

export class Car {
    constructor(world, scene, spec, look, pose, opts = {}) {
        Object.assign(this, { world, scene, spec, look, gear: 1, shiftT: 0, rpm: 1000, kmh: 0, fs: 0, idx: 0, lap: 0, maxLap: 0, prog: 0, laps: [], lapT: 0, finished: false, hold: true, startAt: 0, hit: null, flipT: 0, reverse: false, braking: false, slide: 0, scrape: 0, draft: 0, steerIn: 0, onShift: null });
        this.fw = new C.Vec3(); this.rt = new C.Vec3(); this.upv = new C.Vec3(); this.aero = new C.Vec3();
        const m = this.model = buildCar(look, opts);
        this.mesh = m.group; this.wheels = m.wheels; this.lights = m.lights;
        this.blob = makeBlob(spec);
        scene.add(m.group, ...m.wheels, this.blob);

        // 렌더 보간용 이전/현재 상태 (물리는 고정 스텝, 화면은 프레임마다 보간)
        this.pp = new THREE.Vector3(); this.cp = new THREE.Vector3(); this.pq = new THREE.Quaternion(); this.cq = new THREE.Quaternion();
        this.wp = [0, 1, 2, 3].map(() => new THREE.Vector3()); this.wc = [0, 1, 2, 3].map(() => new THREE.Vector3()); this.wq = [0, 1, 2, 3].map(() => new THREE.Quaternion());

        const body = this.body = new C.Body({ mass: spec.mass, linearDamping: 0.02, angularDamping: 0.5 });
        body.addShape(new C.Box(new C.Vec3(spec.hx, 0.35, spec.hz)), new C.Vec3(spec.ox, 0, 0));
        body.addEventListener('collide', (e) => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v > 2.5) this.hit?.(v); });
        const v = this.vehicle = new C.RaycastVehicle({ chassisBody: body, indexRightAxis: 2, indexForwardAxis: 0, indexUpAxis: 1 });
        const r = look.wheel, o = { radius: r, directionLocal: new C.Vec3(0, -1, 0), axleLocal: new C.Vec3(0, 0, 1), suspensionStiffness: 42, suspensionRestLength: 0.15, maxSuspensionTravel: 0.25, maxSuspensionForce: 2e5, dampingRelaxation: 3.4, dampingCompression: 5.6, rollInfluence: 0.02, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true };
        this.gripF = spec.grip * 1.08; this.gripR = spec.grip * 0.96;
        m.wheelPts.forEach((p, i) => v.addWheel({ ...o, frictionSlip: i < 2 ? this.gripF : this.gripR, chassisConnectionPointLocal: new C.Vec3(p.x, r - 0.46, p.z) }));
        v.addToWorld(world);
        // 서브스텝마다 공기저항·다운포스를 주고, 충돌로 인한 과도한 회전을 제한한다
        this._aero = () => {
            const fw = body.vectorToWorldFrame(FWD, this.fw), s = body.velocity.dot(fw), f = -0.4 * s * Math.abs(s), w = body.angularVelocity;
            body.applyForce(this.aero.set(fw.x * f, -0.3 * s * s, fw.z * f));
            w.x = clamp(w.x, -2.5, 2.5); w.y = clamp(w.y, -3.2, 3.2); w.z = clamp(w.z, -2.5, 2.5);
        };
        world.addEventListener('preStep', this._aero);
        this.place(pose);
    }

    place({ pos, yaw }) {
        const b = this.body;
        b.position.set(pos.x, 0.9, pos.z); b.quaternion.setFromEuler(0, yaw, 0);
        b.velocity.setZero(); b.angularVelocity.setZero();
        this.fwd = { x: Math.cos(yaw), z: -Math.sin(yaw) }; this.gear = 1;
        this.capture(); this.snap(); this.render(1, false);
    }

    update(dt, inp) {
        const { body: b, spec: sp, vehicle: v } = this;
        const fw = b.vectorToWorldFrame(FWD, this.fw), fs = this.fs = b.velocity.dot(fw), a = Math.abs(fs), vlat = b.velocity.dot(b.vectorToWorldFrame(RIGHT, this.rt));
        this.fwd.x = fw.x; this.fwd.z = fw.z; this.kmh = a * 3.6; this.shiftT = Math.max(0, this.shiftT - dt);
        this.slide = this.kmh > 15 ? clamp(Math.abs(vlat) / 5 + (inp.hand ? 0.5 : 0), 0, 1) : 0;
        const vmax = (g) => sp.top * RATIO[5] / RATIO[g - 1], r = clamp(a / vmax(this.gear), 0, 1.05);
        this.rpm = 1000 + 6500 * clamp(Math.max(r, inp.thr * 0.2), 0, 1.05);

        let F = 0, brk = 0; this.reverse = false;
        if (this.hold) { brk = 1.5; this.rpm = 1000 + 5500 * clamp(inp.thr, 0, 1); }
        else if (inp.thr > 0.02) {
            if (fs < -1.5) brk = inp.thr;
            else if (!this.shiftT) F = sp.mass * 6.5 * sp.power * (RATIO[this.gear - 1] / RATIO[0]) * (r < 0.88 ? 0.8 + 0.2 * r / 0.88 : Math.max(0, (1 - r) / 0.12)) * inp.thr;
        } else if (inp.brk > 0.02) {
            if (fs > 1.5) brk = inp.brk;
            else { this.reverse = true; F = a < 14 ? -sp.mass * 3.2 * inp.brk : 0; }
        }
        if (F > 0) { F *= 1 + this.draft * 0.1; if (inp.assist > 1 && this.slide > 0.45) F *= 0.55; }

        const was = this.gear;
        if (inp.auto) {
            if (r > 0.93 && this.gear < 6 && !this.shiftT) { this.gear++; this.shiftT = 0.2; }
            else if (this.gear > 1 && a < vmax(this.gear - 1) * 0.7) this.gear--;
        } else {
            if (inp.up && this.gear < 6) { this.gear++; this.shiftT = 0.2; }
            if (inp.down && this.gear > 1) this.gear--;
        }
        if (this.gear !== was) this.onShift?.(this.gear > was, inp.thr);

        const bf = brk * sp.mass * 2.6;
        this.braking = brk > 0 || inp.hand > 0;
        for (const i of [0, 1]) { v.setBrake(bf * 1.1, i); v.applyEngineForce(0, i); }
        for (const i of [2, 3]) {
            v.setBrake(bf * 0.9 + (inp.hand ? sp.mass * 4 : 0), i); v.applyEngineForce(F / 2, i);
            v.wheelInfos[i].frictionSlip = this.gripR * (inp.hand ? 0.55 : 1);
        }

        // 속도가 오를수록 최대 조향각을 줄인다. 입력이 유지되는 동안 조향각도 유지된다.
        let delta = -inp.steer * Math.max(0.03, 0.42 / (1 + (a / 10) ** 2));
        if (inp.assist > 0 && a > 8) {
            // 차가 명령한 것보다 더 크게 회전(오버스티어)할 때만 카운터 스티어를 건다
            const over = b.angularVelocity.y - (fs * Math.tan(delta)) / 2.65;
            if (Math.abs(over) > 0.4 && over * b.angularVelocity.y > 0) delta -= clamp(over * 0.12, -0.12, 0.12);
        }
        v.setSteeringValue(delta, 0); v.setSteeringValue(delta, 1);
        this.steerIn = inp.rawSteer ?? inp.steer;
        this.flipT = b.vectorToWorldFrame(UP, this.upv).y < 0.25 ? this.flipT + dt : 0;
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
        if (cockpit) this.model.cockpit?.update(this.steerIn);
        for (let i = 0; i < 4; i++) { this.wheels[i].position.lerpVectors(this.wp[i], this.wc[i], alpha); this.wheels[i].quaternion.copy(this.wq[i]); }
        E.setFromQuaternion(m.quaternion, 'YXZ');
        const c = Math.cos(E.y), s = Math.sin(E.y), ox = this.spec.ox;
        this.blob.position.set(m.position.x + c * ox, 0.05, m.position.z - s * ox); this.blob.rotation.y = E.y;
    }

    dispose() {
        this.vehicle.removeFromWorld(this.world);
        this.world.removeEventListener('preStep', this._aero);
        this.scene.remove(this.mesh, ...this.wheels, this.blob);
        this.model.dispose();
    }
}
