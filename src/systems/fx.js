import * as THREE from 'three';

const soft = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
})();

// 차량 아래 접촉 그림자: 그림자 맵이 꺼진 낮은 품질에서도 항상 보인다
const blobTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(0.6, 'rgba(0,0,0,.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
})();
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -1 });
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
export function makeBlob(spec) {
    const m = new THREE.Mesh(blobGeo, blobMat);
    m.scale.set(spec.hx * 2.3, 1, spec.hz * 2.7); m.renderOrder = 1; m.frustumCulled = false;
    return m;
}

export class Fx {
    constructor(scene) {
        // 스키드 마크: 링 버퍼에 쿼드를 이어 붙인다
        this.M = 700; this.mi = 0;
        const pos = new Float32Array(this.M * 12), idx = [];
        for (let q = 0; q < this.M; q++) idx.push(q * 4, q * 4 + 1, q * 4 + 2, q * 4 + 2, q * 4 + 1, q * 4 + 3);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', this.pa = new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
        this.marks = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
        this.marks.frustumCulled = false; scene.add(this.marks);

        // 연기/스파크 입자
        const n = this.n = 240;
        this.inst = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: soft, transparent: true, depthWrite: false, opacity: 0.45 }), n);
        this.inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        this.inst.frustumCulled = false; scene.add(this.inst);
        this.p = Array.from({ length: n }, () => ({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, g: 0 }));
        this.pi = 0; this.d = new THREE.Object3D(); this.col = new THREE.Color();
        this.inst.count = n; this.p.forEach((_, i) => { this.d.scale.setScalar(0); this.d.updateMatrix(); this.inst.setMatrixAt(i, this.d.matrix); });
    }

    skid(car, i, on) {
        // 바퀴마다 [x, z, 유효] 를 재사용한다 (매 프레임 객체를 만들지 않음)
        car.skid ??= new Float32Array(12);
        const w = car.wheels[i].position, L = car.skid, j = i * 3;
        if (!on) { L[j + 2] = 0; return; }
        const lx = L[j], lz = L[j + 1], had = L[j + 2];
        L[j] = w.x; L[j + 1] = w.z; L[j + 2] = 1;
        if (!had) return;
        const dx = w.x - lx, dz = w.z - lz, l = Math.hypot(dx, dz);
        if (l < 0.08 || l > 4) return;
        const px = (-dz / l) * 0.11, pz = (dx / l) * 0.11, a = this.pa.array, o = this.mi * 12, y = 0.06;
        a[o] = lx - px; a[o + 1] = y; a[o + 2] = lz - pz; a[o + 3] = lx + px; a[o + 4] = y; a[o + 5] = lz + pz;
        a[o + 6] = w.x - px; a[o + 7] = y; a[o + 8] = w.z - pz; a[o + 9] = w.x + px; a[o + 10] = y; a[o + 11] = w.z + pz;
        this.mi = (this.mi + 1) % this.M; this.pa.needsUpdate = true;
    }

    emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, grav = 0) {
        const i = this.pi; this.pi = (i + 1) % this.n;
        Object.assign(this.p[i], { life, max: life, x, y, z, vx, vy, vz, s0, s1, g: grav });
        this.inst.setColorAt(i, this.col.setRGB(r, g, b)); this.inst.instanceColor.needsUpdate = true;
    }

    smoke(x, z, vx, vz) { this.emit(x, 0.2, z, vx * 0.3 + (Math.random() - 0.5), 0.8, vz * 0.3 + (Math.random() - 0.5), 1.1, 0.6, 3.2, 0.7, 0.7, 0.72); }
    spark(x, z, vx, vz) { this.emit(x, 0.35 + Math.random() * 0.4, z, vx * 0.2 + (Math.random() - 0.5) * 5, 1 + Math.random() * 3, vz * 0.2 + (Math.random() - 0.5) * 5, 0.35 + Math.random() * 0.25, 0.22, 0.08, 4, 2.2, 0.6, 9); }

    update(dt, camQ) {
        this.p.forEach((p, i) => {
            const d = this.d;
            if (p.life <= 0) { if (p.z0) return; p.z0 = 1; d.scale.setScalar(0); d.updateMatrix(); this.inst.setMatrixAt(i, d.matrix); return; }
            p.z0 = 0;
            p.life -= dt; p.vy -= p.g * dt; p.x += p.vx * dt; p.y = Math.max(0.05, p.y + p.vy * dt); p.z += p.vz * dt;
            const t = 1 - Math.max(p.life, 0) / p.max, s = (p.s0 + (p.s1 - p.s0) * t) * (p.life > 0 ? 1 - Math.max(0, (t - 0.7) / 0.3) : 0);
            d.position.set(p.x, p.y, p.z); d.quaternion.copy(camQ); d.scale.setScalar(s); d.updateMatrix(); this.inst.setMatrixAt(i, d.matrix);
        });
        this.inst.instanceMatrix.needsUpdate = true;
    }

    clear() { this.pa.array.fill(0); this.pa.needsUpdate = true; this.p.forEach((p) => { p.life = 0; }); this.update(0, this.d.quaternion); }
}
