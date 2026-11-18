import * as C from 'cannon-es';
import { buildCar } from './model.js';

const RATIO = [3.6, 2.6, 1.95, 1.55, 1.28, 1.05];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const FWD = new C.Vec3(1, 0, 0), UP = new C.Vec3(0, 1, 0), RIGHT = new C.Vec3(0, 0, 1);

export class Car {
  constructor(world, scene, spec, look, pose, opts = {}) {
    Object.assign(this, { world, scene, spec, look, gear: 1, shiftT: 0, rpm: 1000, kmh: 0, fs: 0, idx: 0, lap: 0, prog: 0, laps: [], lapT: 0, finished: false, hold: true, hit: null, flipT: 0, reverse: false, braking: false, slide: 0, scrape: 0, draft: 0, steerIn: 0, onShift: null });
    const m = this.model = buildCar(look, opts);
    this.mesh = m.group; this.wheels = m.wheels; this.lights = m.lights;
    scene.add(m.group, ...m.wheels);

    const body = this.body = new C.Body({ mass: spec.mass, linearDamping: 0.02, angularDamping: 0.5 });
    body.addShape(new C.Box(new C.Vec3(spec.hx, 0.35, spec.hz)), new C.Vec3(spec.ox, 0, 0));
    body.addEventListener('collide', (e) => { const v = Math.abs(e.contact.getImpactVelocityAlongNormal()); if (v > 2.5) this.hit?.(v); });
    const v = this.vehicle = new C.RaycastVehicle({ chassisBody: body, indexRightAxis: 2, indexForwardAxis: 0, indexUpAxis: 1 });
    const r = look.wheel, o = { radius: r, directionLocal: new C.Vec3(0, -1, 0), axleLocal: new C.Vec3(0, 0, 1), suspensionStiffness: 42, suspensionRestLength: 0.15, maxSuspensionTravel: 0.25, maxSuspensionForce: 2e5, frictionSlip: spec.grip, dampingRelaxation: 2.6, dampingCompression: 4.6, rollInfluence: 0.02, customSlidingRotationalSpeed: -30, useCustomSlidingRotationalSpeed: true };
    m.wheelPts.forEach((p) => v.addWheel({ ...o, chassisConnectionPointLocal: new C.Vec3(p.x, r - 0.46, p.z) }));
    v.addToWorld(world);
    // 서브스텝마다 공기저항·다운포스를 주고, 충돌로 인한 과도한 회전을 제한한다
    this._aero = () => {
      const fw = body.vectorToWorldFrame(FWD), s = body.velocity.dot(fw), f = -0.4 * s * Math.abs(s), w = body.angularVelocity;
      body.applyForce(new C.Vec3(fw.x * f, -0.3 * s * s, fw.z * f));
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
  }

  update(dt, inp) {
    const { body: b, spec: sp, vehicle: v } = this;
    const fw = b.vectorToWorldFrame(FWD), fs = this.fs = b.velocity.dot(fw), a = Math.abs(fs), vlat = b.velocity.dot(b.vectorToWorldFrame(RIGHT));
    this.fwd = { x: fw.x, z: fw.z }; this.kmh = a * 3.6; this.shiftT = Math.max(0, this.shiftT - dt);
    this.slide = this.kmh > 15 ? clamp(Math.abs(vlat) / 5 + (inp.hand ? 0.5 : 0), 0, 1) : 0;
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
      v.wheelInfos[i].frictionSlip = sp.grip * (inp.hand ? 0.55 : 1);
    }
    // 속도가 오를수록 최대 조향각을 줄이고, 미끄러질 때는 카운터 스티어를 보조한다
    let delta = -inp.steer * Math.max(0.045, 0.5 / (1 + (a / 13) ** 2));
    if (inp.assist > 0 && a > 6) delta -= clamp(Math.atan2(vlat, Math.max(a, 3)) * Math.sign(fs || 1) * 0.9, -0.15, 0.15);
    v.setSteeringValue(delta, 0); v.setSteeringValue(delta, 1);
    this.steerIn = inp.rawSteer ?? inp.steer;
    this.flipT = b.vectorToWorldFrame(UP).y < 0.25 ? this.flipT + dt : 0;
  }

  sync(cockpit) {
    const b = this.body, m = this.mesh;
    m.position.copy(b.position); m.quaternion.copy(b.quaternion);
    this.model.brake(this.braking);
    if (cockpit) this.model.cockpit?.update(this.steerIn);
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
