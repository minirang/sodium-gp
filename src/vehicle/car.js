import * as C from 'cannon-es';
import { buildCar } from './model.js';

const RATIO = [3.6, 2.6, 1.95, 1.55, 1.28, 1.05];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FWD = new C.Vec3(1, 0, 0), UP = new C.Vec3(0, 1, 0);

export class Car {
  constructor(world, scene, spec, look, pose, headlights = false) {
    Object.assign(this, { world, scene, spec, look, gear: 1, shiftT: 0, rpm: 1000, kmh: 0, fs: 0, idx: 0, lap: 0, prog: 0, laps: [], lapT: 0, finished: false, hold: true, hit: null, flipT: 0, reverse: false, braking: false });
    const m = buildCar(look, headlights);
    Object.assign(this, { mesh: m.group, wheels: m.wheels, tail: m.tail, steerWheel: m.steerWheel });
    scene.add(m.group, ...m.wheels);

    const body = this.body = new C.Body({ mass: spec.mass, shape: new C.Box(new C.Vec3(2.1, 0.35, 0.93)), linearDamping: 0.02, angularDamping: 0.4 });
    body.addEventListener('collide', (e) => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v > 2.5) this.hit?.(v); });
    const v = this.vehicle = new C.RaycastVehicle({ chassisBody: body, indexRightAxis: 2, indexForwardAxis: 0, indexUpAxis: 1 });
    const r = look.wheel;
    const o = { radius: r, directionLocal: new C.Vec3(0, -1, 0), axleLocal: new C.Vec3(0, 0, 1), suspensionStiffness: 42, suspensionRestLength: 0.15, maxSuspensionTravel: 0.25, maxSuspensionForce: 2e5, frictionSlip: spec.grip, dampingRelaxation: 2.6, dampingCompression: 4.6, rollInfluence: 0.02, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true };
    [[1.35, 0.88], [1.35, -0.88], [-1.3, 0.88], [-1.3, -0.88]].forEach(([x, z]) => v.addWheel({ ...o, chassisConnectionPointLocal: new C.Vec3(x, r - 0.46, z) }));
    v.addToWorld(world);
    // 물리 서브스텝마다 공기저항과 다운포스 적용
    this._aero = () => {
      const fw = body.vectorToWorldFrame(FWD), s = body.velocity.dot(fw), f = -0.4 * s * Math.abs(s);
      body.applyForce(new C.Vec3(fw.x * f, -0.3 * s * s, fw.z * f));
    };
    world.addEventListener('preStep', this._aero);
    this.place(pose);
  }

  place({ pos, yaw }) {
    const b = this.body;
    b.position.set(pos.x, 0.9, pos.z); b.quaternion.setFromEuler(0, yaw, 0);
    b.velocity.setZero(); b.angularVelocity.setZero();
    this.fwd = { x: Math.cos(yaw), z: -Math.sin(yaw) }; this.gear = 1;
  }

  update(dt, inp) {
    const { body: b, spec: sp, vehicle: v } = this;
    const fw = b.vectorToWorldFrame(FWD), fs = this.fs = b.velocity.dot(fw), a = Math.abs(fs);
    this.fwd = { x: fw.x, z: fw.z }; this.kmh = a * 3.6; this.shiftT = Math.max(0, this.shiftT - dt);
    const vmax = (g) => sp.top * RATIO[5] / RATIO[g - 1], r = clamp(a / vmax(this.gear), 0, 1.05);
    this.rpm = 1000 + 6500 * clamp(Math.max(r, inp.thr * 0.2), 0, 1.05);

    let F = 0, brk = 0; this.reverse = false;
    if (this.hold) brk = 1.5;
    else if (inp.thr > 0.02) {
      if (fs < -1.5) brk = inp.thr;
      else if (!this.shiftT) F = sp.mass * 6.5 * sp.power * (RATIO[this.gear - 1] / RATIO[0]) * (r < 0.88 ? 0.8 + 0.2 * r / 0.88 : Math.max(0, (1 - r) / 0.12)) * inp.thr;
    } else if (inp.brk > 0.02) {
      if (fs > 1.5) brk = inp.brk;
      else { this.reverse = true; F = a < 14 ? -sp.mass * 3.2 * inp.brk : 0; }
    }
    if (inp.auto) {
      if (r > 0.93 && this.gear < 6 && !this.shiftT) { this.gear++; this.shiftT = 0.2; }
      else if (this.gear > 1 && a < vmax(this.gear - 1) * 0.7) this.gear--;
    } else {
      if (inp.up && this.gear < 6) { this.gear++; this.shiftT = 0.2; }
      if (inp.down && this.gear > 1) this.gear--;
    }

    const bf = brk * sp.mass * 2.6;
    this.braking = brk > 0 || (inp.hand > 0);
    for (const i of [0, 1]) { v.setBrake(bf * 1.1, i); v.applyEngineForce(0, i); }
    for (const i of [2, 3]) {
      v.setBrake(bf * 0.9 + (inp.hand ? sp.mass * 4 : 0), i); v.applyEngineForce(F / 2, i);
      v.wheelInfos[i].frictionSlip = sp.grip * (inp.hand ? 0.55 : 1);
    }
    const s = -inp.steer * 0.55 / (1 + this.kmh / 70);
    v.setSteeringValue(s, 0); v.setSteeringValue(s, 1);
    this.steerIn = inp.steer;
    this.flipT = b.vectorToWorldFrame(UP).y < 0.25 ? this.flipT + dt : 0;
    const right = b.vectorToWorldFrame(new C.Vec3(0, 0, 1));
    this.slide = this.kmh > 15 ? clamp(Math.abs(b.velocity.dot(right)) / 6 + (inp.hand ? 0.5 : 0), 0, 1) : 0;
  }

  sync() {
    const b = this.body, m = this.mesh;
    m.position.copy(b.position); m.quaternion.copy(b.quaternion);
    this.tail.color.setHex(this.braking ? 0xff2a2a : 0x7a0f0f);
    this.steerWheel.rotation.x = -this.steerIn * 2.2;
    this.vehicle.wheelInfos.forEach((w, i) => {
      this.vehicle.updateWheelTransform(i);
      this.wheels[i].position.copy(w.worldTransform.position);
      this.wheels[i].quaternion.copy(w.worldTransform.quaternion);
    });
  }

  dispose() {
    this.vehicle.removeFromWorld(this.world);
    this.world.removeEventListener('preStep', this._aero);
    this.scene.remove(this.mesh, ...this.wheels);
  }
}
