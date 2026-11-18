import * as THREE from 'three';

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...o });
const box = (w, h, d, m, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = true; return mesh;
};

function makeWheel(r, look, right) {
  const g = new THREE.Group(), h = new THREE.Group();
  const lip = mat(look.rim, { metalness: 0.9, roughness: 0.2 });
  h.add(
    new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.26, 28).rotateX(Math.PI / 2), mat(0x0c0d10, { roughness: 0.9 })),
    new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.27, 24).rotateX(Math.PI / 2), mat(0x1a1c22, { metalness: 0.6 })),
  );
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.7, 0.025, 8, 28), lip); ring.position.z = 0.135; h.add(ring);
  for (let i = 0; i < look.spokes; i++) {
    const a = (i / look.spokes) * Math.PI * 2, s = new THREE.Mesh(new THREE.BoxGeometry(r * 0.62, r * 0.11, 0.04), lip);
    s.position.set(Math.cos(a) * r * 0.33, Math.sin(a) * r * 0.33, 0.14); s.rotation.z = a; h.add(s);
  }
  if (!right) h.rotation.y = Math.PI;
  g.add(h); g.traverse((o) => { o.castShadow = true; });
  return g;
}

// 차량은 +x 방향이 전방, +z 방향이 오른쪽
export function buildCar(look, headlights = false) {
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: look.color, metalness: 0.55, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 });
  const dark = mat(0x14161b, { roughness: 0.7 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0f18, metalness: 0.8, roughness: 0.08 });
  const tail = new THREE.MeshBasicMaterial({ color: 0x7a0f0f }), lamp = new THREE.MeshBasicMaterial({ color: 0xfff2c8 });

  g.add(box(4.3, 0.55, 1.86, paint, 0, -0.2, 0), box(2.6, 0.08, 1.95, dark, 0, -0.46, 0), box(0.35, 0.05, 1.95, dark, 2.15, -0.45, 0), box(4.32, 0.01, 0.28, mat(0xffffff), 0, 0.08, 0));
  const cabG = new THREE.BoxGeometry(2.1, 0.5, 1.6), p = cabG.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.62); p.setZ(i, p.getZ(i) * 0.84); }
  cabG.computeVertexNormals();
  const cab = new THREE.Mesh(cabG, glass); cab.position.set(-0.35, 0.33, 0); g.add(cab, box(1.3, 0.05, 1.34, paint, -0.35, 0.6, 0));
  g.add(box(0.5, 0.05, 1.7, paint, -2.05, 0.5, 0), box(0.06, 0.34, 0.08, dark, -1.95, 0.3, 0.6), box(0.06, 0.34, 0.08, dark, -1.95, 0.3, -0.6));
  for (const z of [-0.62, 0.62]) g.add(box(0.06, 0.1, 0.38, lamp, 2.16, -0.02, z));
  for (const z of [-0.6, 0.6]) g.add(box(0.06, 0.1, 0.5, tail, -2.16, 0, z));

  g.add(box(0.5, 0.18, 1.5, dark, 0.55, 0.2, 0));
  const steerWheel = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 20), dark);
  steerWheel.position.set(0.3, 0.34, -0.42); steerWheel.rotation.y = Math.PI / 2;
  steerWheel.add(box(0.3, 0.03, 0.02, dark)); g.add(steerWheel);

  if (headlights) for (const z of [-0.6, 0.6]) {
    const s = new THREE.SpotLight(0xfff0d0, 600, 90, 0.55, 0.6, 1.4);
    s.position.set(2.1, 0, z); s.target.position.set(30, -1, z); g.add(s, s.target);
  }
  const wheels = [true, false, true, false].map((_, i) => makeWheel(look.wheel, look, i % 2 === 0));
  return { group: g, wheels, tail, steerWheel };
}
