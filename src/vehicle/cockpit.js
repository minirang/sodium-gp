import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeStatic } from '../util/merge.js';

// 1인칭 전용 실내. 바깥 차체 모델과 상관없이 운전자 눈 위치(eye)를 기준으로 만든다.
// 좌표: +x 전방, +y 위, +z 차 오른쪽 (차량 좌표계와 같음). 이 그룹은 레이어 2에만 올려 1인칭일 때만 그린다.
export const COCKPIT_LAYER = 2, BODY_LAYER = 1;

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0, ...o });
const rbox = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const UP = new THREE.Vector3(0, 1, 0);

// a에서 b로 이어지는 각진 기둥 (A필러 등)
function beam(a, b, w, h, m) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const mesh = new THREE.Mesh(rbox(w, len, h, 0.012), m);
    mesh.position.copy(a).addScaledVector(d, 0.5); mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    return mesh;
}

// 계기판 화면: 회전수 바 + 속도 + 기어. 값이 바뀔 때만, 초당 약 20번만 다시 그린다
function cluster() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 160;
    const x = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    let last = '', t0 = 0;
    const draw = (rpm, kmh, gear, limit) => {
        const key = `${Math.round(rpm / 100)}|${Math.round(kmh)}|${gear}|${limit}`;
        if (key === last) return; last = key;
        x.fillStyle = '#05070a'; x.fillRect(0, 0, 512, 160);
        // 회전수 막대 (위쪽 호처럼 보이게 가운데가 높다)
        const n = 32, r = Math.min(1, Math.max(0, (rpm - 800) / 7000));
        for (let i = 0; i < n; i++) {
            const f = i / (n - 1), on = f <= r, hx = 26 + f * 460, hy = 22 + Math.pow(Math.abs(f - 0.5) * 2, 2) * 18;
            x.fillStyle = on ? (f > 0.88 ? (limit ? '#ffffff' : '#ff3b30') : f > 0.72 ? '#ffb454' : '#46d3ff') : '#1a2330';
            x.fillRect(hx, hy, 11, 16);
        }
        x.fillStyle = '#e9eef5'; x.font = 'bold 76px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(String(Math.round(kmh)), 256, 104);
        x.fillStyle = '#7d8a9c'; x.font = '600 20px system-ui, sans-serif'; x.fillText('km/h', 256, 146);
        x.fillStyle = '#ffb454'; x.font = 'bold 64px system-ui, sans-serif'; x.fillText(String(gear), 440, 100);
        x.fillStyle = '#7d8a9c'; x.font = '600 18px system-ui, sans-serif'; x.textAlign = 'left';
        x.fillText(`${(rpm / 1000).toFixed(1)}k rpm`, 34, 140);
        tex.needsUpdate = true;
    };
    draw(900, 0, 1, false);
    return { tex, update(rpm, kmh, gear, limit) { const now = performance.now(); if (now - t0 < 50) return; t0 = now; draw(rpm, kmh, gear, limit); } };
}

// eye: 차량 좌표계의 눈 위치, look: 색상, own: 정리할 리소스 목록
export function makeCockpit(eye, look, own) {
    const g = new THREE.Group(); g.position.copy(eye);
    const stat = new THREE.Group(); g.add(stat);
    const M = (m) => { own.push(m); return m; };
    const dash = M(std(0x26282d, { roughness: 0.8 })), soft = M(std(0x121316, { roughness: 1 })), trim = M(std(0x8f949c, { metalness: 0.9, roughness: 0.32 }));
    const carbon = M(std(0x23252a, { metalness: 0.35, roughness: 0.38 })), accent = M(std(0xffb454, { roughness: 0.5, emissive: 0xffb454, emissiveIntensity: 0.15 }));
    const paint = M(new THREE.MeshPhysicalMaterial({ color: look.color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }));
    const mirror = M(std(0xb8c2cc, { metalness: 1, roughness: 0.06 })), glove = M(std(0x0e0f12, { roughness: 0.85 })), sleeve = M(std(0x23262e, { roughness: 0.95 }));
    const add = (geo, m, x, y, z, parent = stat) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };

    // 차폭 기준 위치 (눈은 차 중심에서 eye.z 만큼 옆에 있다)
    const HW = 0.9, zl = -HW - eye.z, zr = HW - eye.z, cz = -eye.z, W = zr - zl, mid = (zl + zr) / 2;

    // 대시보드: 위판(부드러운 소재) + 앞쪽 경사 + 가운데 장식 띠
    add(rbox(0.5, 0.14, W, 0.04), dash, 0.88, -0.43, mid).rotation.z = -0.12;
    add(rbox(0.36, 0.012, W - 0.06, 0.004), soft, 0.82, -0.355, mid).rotation.z = -0.12;
    add(rbox(0.02, 0.018, W - 0.2, 0.006), trim, 0.64, -0.40, mid);
    add(rbox(0.012, 0.006, W - 0.24, 0.002), accent, 0.632, -0.388, mid);
    // 계기판 덮개(비너클)와 화면
    const bin = new THREE.CylinderGeometry(0.17, 0.17, 0.16, 24, 1, true, 0, Math.PI); // 위쪽 반원 = 화면 위를 덮는 차양
    bin.rotateZ(Math.PI / 2); bin.scale(1, 0.42, 1);
    add(bin, M(std(0x1c1d21, { roughness: 0.85, side: THREE.DoubleSide })), 0.78, -0.355, 0);
    const cl = cluster(); own.push(cl.tex);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.29, 0.09), M(new THREE.MeshBasicMaterial({ map: cl.tex, toneMapped: false })));
    screen.position.set(0.765, -0.33, 0); screen.rotation.set(0, -Math.PI / 2, 0); screen.rotateX(-0.28); g.add(screen);
    // 변속 표시등: 계기판 위 LED 5개
    const leds = [0, 1, 2, 3, 4].map((i) => {
        const m = M(new THREE.MeshBasicMaterial({ color: i < 3 ? 0x2fd36b : i < 4 ? 0xffb454 : 0xff3b30, toneMapped: false }));
        const o = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.012), m); o.position.set(0.71, -0.286, (i - 2) * 0.024); g.add(o); return { m, base: m.color.clone() };
    });
    // 센터 스택과 콘솔 (운전석이 옆으로 치우친 차에만)
    if (Math.abs(eye.z) > 0.2) {
        add(rbox(0.24, 0.26, 0.24, 0.03), dash, 0.66, -0.56, cz);
        add(new THREE.PlaneGeometry(0.17, 0.1), M(std(0x06080b, { roughness: 0.15, metalness: 0.4, emissive: 0x0d2233, emissiveIntensity: 0.6 })), 0.535, -0.49, cz).rotation.set(0, -Math.PI / 2, 0);
        add(rbox(0.7, 0.14, 0.22, 0.03), dash, 0.15, -0.63, cz);
        add(rbox(0.5, 0.012, 0.2, 0.005), carbon, 0.15, -0.555, cz);
    }
    // 문 안쪽 패널 + 창틀 (벨트라인)
    for (const z of [zl, zr]) {
        const s = Math.sign(z - mid);
        add(rbox(1.4, 0.32, 0.08, 0.03), dash, 0.15, -0.46, z - s * 0.04);
        add(rbox(1.4, 0.02, 0.05, 0.008), trim, 0.15, -0.295, z - s * 0.03);
        add(rbox(0.5, 0.05, 0.08, 0.02), soft, 0.05, -0.37, z - s * 0.1);
    }
    // A필러 + 앞 지붕 테두리 + 천장
    const top = 0.13, hx = 0.3, pil = M(std(0x16171a, { roughness: 0.95 }));
    for (const z of [zl + 0.04, zr - 0.04]) stat.add(beam(new THREE.Vector3(1.0, -0.37, z), new THREE.Vector3(hx, top, z + Math.sign(mid - z) * 0.06), 0.06, 0.045, pil));
    add(rbox(0.1, 0.045, W - 0.05, 0.015), pil, hx, top, mid);
    add(rbox(1.0, 0.02, W - 0.05, 0.01), soft, hx - 0.52, top + 0.02, mid);
    // 룸미러
    const mz = Math.abs(eye.z) > 0.2 ? cz : 0.1, my = top - 0.07;
    stat.add(beam(new THREE.Vector3(hx + 0.08, top - 0.005, mz), new THREE.Vector3(hx + 0.13, my + 0.02, mz), 0.012, 0.012, pil));
    add(rbox(0.028, 0.055, 0.2, 0.02), pil, hx + 0.14, my, mz);
    add(new THREE.PlaneGeometry(0.185, 0.042), mirror, hx + 0.125, my, mz).rotation.set(0, -Math.PI / 2, 0);
    
    // 사이드미러 (차체색 하우징)
    for (const z of [zl - 0.16, zr + 0.16]) {
        const s = Math.sign(z - mid);
        add(rbox(0.1, 0.09, 0.17, 0.035), paint, 0.86, -0.26, z);
        add(new THREE.PlaneGeometry(0.075, 0.15), mirror, 0.808, -0.26, z).rotation.set(0, -Math.PI / 2, Math.PI / 2);
        stat.add(beam(new THREE.Vector3(0.88, -0.31, z - s * 0.08), new THREE.Vector3(0.9, -0.33, z - s * 0.17), 0.03, 0.04, paint));
    }
    // 보닛: 앞 유리 아래에서 앞으로 갈수록 낮아지는 곡면 (가장자리 펜더가 살짝 솟음)
    const hood = new THREE.PlaneGeometry(1.2, W + 0.1, 12, 10).rotateX(-Math.PI / 2), hp = hood.attributes.position;
    for (let i = 0; i < hp.count; i++) {
        const u = (hp.getX(i) + 0.6) / 1.2, v = hp.getZ(i) / ((W + 0.1) / 2);
        hp.setXYZ(i, 1.02 + u * 1.2, -0.42 - u * 0.21 - u * u * 0.06 + (v * v) * 0.05 - (1 - v * v) * 0.0 + Math.pow(Math.abs(v), 6) * 0.04, mid + hp.getZ(i));
    }
    hood.computeVertexNormals();
    add(hood, paint, 0, 0, 0);

    // 스티어링 휠: 기울어진 축 위에서 회전. 림·3스포크·허브·12시 표시·패들
    const t = 0.36, R = 0.17, C = new THREE.Vector3(0.47, -0.43, 0);
    const X = new THREE.Vector3(0, 0, 1), Y = new THREE.Vector3(Math.sin(t), Math.cos(t), 0), Z = new THREE.Vector3(-Math.cos(t), Math.sin(t), 0);
    const piv = new THREE.Group(), spin = new THREE.Group();
    piv.position.copy(C); piv.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z)); piv.add(spin); g.add(piv);
    const rim = new THREE.TorusGeometry(R, 0.019, 12, 48); rim.scale(1, 0.94, 1.15);
    spin.add(new THREE.Mesh(rim, soft));
    const mark = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0195, 8, 6, 0.16), accent); mark.rotation.z = Math.PI / 2 - 0.08; mark.scale.set(1, 0.94, 1.18); spin.add(mark);
    const hub = new THREE.Mesh(rbox(0.11, 0.085, 0.045, 0.02), dash); hub.position.z = 0.012; spin.add(hub);
    const badge = new THREE.Mesh(rbox(0.026, 0.026, 0.006, 0.006), accent); badge.position.set(0, 0.005, 0.037); spin.add(badge);
    for (const [x, y, w, h] of [[-0.11, 0, 0.12, 0.03], [0.11, 0, 0.12, 0.03], [0, -0.1, 0.03, 0.12]]) {
        const s = new THREE.Mesh(rbox(w, h, 0.016, 0.006), carbon); s.position.set(x, y, 0.01); spin.add(s);
    }
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(rbox(0.035, 0.075, 0.006, 0.003), carbon); p.position.set(sx * 0.115, 0.035, -0.045); p.rotation.z = sx * 0.2; piv.add(p); }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 14), dash); col.rotation.x = -Math.PI / 2; col.position.z = -0.17; piv.add(col);

    // 장갑 낀 양손(9시·3시)과 어깨에서 이어지는 팔
    const hands = [Math.PI, 0].map((a) => {
        const h = new THREE.Group();
        h.add(new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 8).scale(1, 0.85, 1.25), glove), new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.07, 4, 8).rotateZ(Math.PI / 2), glove));
        h.children[1].position.z = -0.022;
        h.position.set(Math.cos(a) * R, Math.sin(a) * R, 0.008); h.rotation.z = a + Math.PI / 2; spin.add(h);
        return { a };
    });
    const arms = [-0.2, 0.2].map((dz) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.052, 1, 10), sleeve); g.add(m);
        return { m, s: new THREE.Vector3(-0.16, -0.36, dz) };
    });

    // 정적인 부품은 머티리얼별로 합쳐 드로우콜을 줄인다
    own.push(...mergeStatic(stat));
    g.traverse((o) => { if (o.isMesh) { o.layers.set(COCKPIT_LAYER); o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });

    const v = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion();
    return {
        group: g,
        update(steer, car) {
            const th = -steer * Math.PI * 0.75; spin.rotation.z = th;
            hands.forEach((h, i) => {
                const a = h.a + th, px = Math.cos(a) * R, py = Math.sin(a) * R;
                v.set(X.x * px + Y.x * py, X.y * px + Y.y * py, X.z * px + Y.z * py).add(C);
                const { m, s } = arms[i], len = d.copy(v).sub(s).length();
                m.position.copy(s).addScaledVector(d, 0.5); m.scale.set(1, len, 1); m.quaternion.copy(q.setFromUnitVectors(UP, d.normalize()));
            });
            if (!car) return;
            const r = Math.min(1, Math.max(0, (car.rpm - 4500) / 3000)), limit = car.rpm > 7400;
            leds.forEach((l, i) => { const on = r > i / 5 && (!limit || Math.floor(performance.now() / 70) % 2); l.m.color.copy(l.base).multiplyScalar(on ? 1.6 : 0.12); });
            cl.update(car.rpm, car.kmh, car.reverse ? 'R' : car.gear, limit);
        },
    };
}
