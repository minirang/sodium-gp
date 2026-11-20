import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 값 노이즈 + fbm (지형용, 결정적)
export function noise2(seed = 1) {
    const hs = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
    const vn = (x, y) => {
        const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
        const a = hs(ix, iy), b = hs(ix + 1, iy), c = hs(ix, iy + 1), d = hs(ix + 1, iy + 1);
        return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
    };
    return (x, y, oct = 5) => { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vn(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
}

// 높이맵 지형: height(x,z)·color(x,z,h,slope)를 받아 타일로 나눈 메쉬(컬링용)를 만든다
export function terrain(group, { x0, z0, x1, z1, step, height, color, tiles = 4 }) {
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step), H = new Float32Array((nx + 1) * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) H[j * (nx + 1) + i] = height(x0 + i * step, z0 + j * step);
    const hAt = (i, j) => H[Math.min(nz, Math.max(0, j)) * (nx + 1) + Math.min(nx, Math.max(0, i))];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.25 });
    const tx = Math.ceil(nx / tiles), tz = Math.ceil(nz / tiles), col = new THREE.Color();
    for (let ty = 0; ty < tiles; ty++) for (let tw = 0; tw < tiles; tw++) {
        const i0 = tw * tx, i1 = Math.min(nx, i0 + tx), j0 = ty * tz, j1 = Math.min(nz, j0 + tz);
        if (i1 <= i0 || j1 <= j0) continue;
        const W = i1 - i0 + 1, pos = [], nor = [], cl = [], idx = [];
        let any = false;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
            const x = x0 + i * step, z = z0 + j * step, h = hAt(i, j);
            const dx = hAt(i + 1, j) - hAt(i - 1, j), dz = hAt(i, j + 1) - hAt(i, j - 1), n = new THREE.Vector3(-dx, 2 * step, -dz).normalize();
            pos.push(x, h, z); nor.push(n.x, n.y, n.z);
            color(col, x, z, h, 1 - n.y); cl.push(col.r, col.g, col.b);
            if (h > -2) any = true;
        }
        if (!any) continue;
        for (let j = 0; j < j1 - j0; j++) for (let i = 0; i < i1 - i0; i++) { const a = j * W + i, b = a + 1, c = a + W, d = c + 1; idx.push(a, c, b, b, c, d); }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
        g.setIndex(idx); g.computeBoundingSphere();
        const m = new THREE.Mesh(g, mat); m.receiveShadow = true; group.add(m);
    }
    return mat;
}

// 물결 노멀맵 (여러 방향의 사인파 합)
function waveNormals(size = 256) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'), img = x.createImageData(size, size), h = new Float32Array(size * size);
    const waves = [[1, 0.3, 2, 0], [0.4, 1, 3, 1.3], [-0.7, 0.6, 5, 2.1], [0.2, -0.9, 7, 0.7], [0.9, 0.8, 9, 4.2], [-0.3, 0.95, 13, 3.3], [0.75, -0.6, 17, 5.1], [-0.95, -0.2, 21, 0.4], [0.15, 0.7, 29, 2.9], [-0.55, -0.85, 37, 1.7]];
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        let s = 0; for (const [a, b, f, p] of waves) s += Math.sin(((i * a + j * b) / size) * Math.PI * 2 * f + p + Math.sin(((i * b - j * a) / size) * Math.PI * 2 * 2 + p) * 0.8) / Math.pow(f, 0.8);
        h[j * size + i] = s;
    }
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
        const dx = h[j * size + ((i + 1) % size)] - h[j * size + ((i - 1 + size) % size)], dz = h[((j + 1) % size) * size + i] - h[((j - 1 + size) % size) * size + i];
        const n = new THREE.Vector3(-dx * 6, 1, -dz * 6).normalize(), o = (j * size + i) * 4;
        img.data[o] = (n.x * 0.5 + 0.5) * 255; img.data[o + 1] = (n.z * 0.5 + 0.5) * 255; img.data[o + 2] = (n.y * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
}

// 바다: 정점 색(얕은 곳 청록 → 깊은 곳 남색) + 두 겹으로 흐르는 물결 노멀맵 + 하늘 반사
export function oceanMaterial(anims) {
    const nm = waveNormals(), u = { time: { value: 0 } };
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.1, normalMap: nm, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.25 });
    m.onBeforeCompile = (sh) => {
        sh.uniforms.time = u.time;
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float time;')
            .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', `vec2 wu = vNormalMapUv;
vec3 mapN = texture2D( normalMap, wu * .37 + vec2( time * .004, time * .0023 ) ).xyz * 2.0 - 1.0 + texture2D( normalMap, wu * 1.13 - vec2( time * .011, -time * .007 ) ).xyz * 2.0 - 1.0 + texture2D( normalMap, wu * 2.9 + vec2( -time * .019, time * .013 ) ).xyz - .5;
mapN.xy *= mix( 1.0, 0.1, smoothstep( 15.0, 260.0, length( vViewPosition ) ) );
mapN = normalize( mapN );`);
    };
    m.customProgramCacheKey = () => 'ocean';
    anims.push((t) => { u.time.value = t; });
    return m;
}

// 해안선을 기준으로 한 바다 메쉬: coast(x) 바깥(+z)으로 갈수록 성기게
export function seaMesh(coast, x0, x1, mat, y = -0.4) {
    const rows = [-30, -8, 0, 8, 20, 40, 70, 110, 170, 260, 400, 650, 1000, 1600, 2600], pos = [], col = [], uv = [], idx = [];
    const shallow = new THREE.Color(0x2fb3b0), mid = new THREE.Color(0x14708e), deep = new THREE.Color(0x0a3a5c), c = new THREE.Color();
    const xs = []; for (let x = x0; x <= x1; x += 25) xs.push(x);
    for (const s of rows) for (const x of xs) {
        const z = coast(x) + s; pos.push(x, y, z); uv.push(x / 40, z / 40);
        const k = Math.max(0, s);
        c.copy(shallow).lerp(mid, Math.min(1, k / 60)).lerp(deep, Math.min(1, Math.max(0, (k - 60) / 300)));
        col.push(c.r, c.g, c.b);
    }
    const W = xs.length;
    for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i, b = a + 1, cc = a + W, d = cc + 1; idx.push(a, cc, b, b, cc, d); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx); g.computeBoundingSphere();
    return new THREE.Mesh(g, mat);
}

// 파도 거품: 해안선을 따라 밀려왔다 빠지는 흰 띠
export function foam(group, coast, x0, x1, anims) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 128;
    const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,.9)'); g.addColorStop(0.55, 'rgba(255,255,255,.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 16, 128);
    const t = new THREE.CanvasTexture(c);
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaMap: t, transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -1 });
    const pos = [], uv = [], idx = [];
    let n = 0;
    for (let xx = x0; xx <= x1; xx += 6, n++) {
        const z = coast(xx), dz = (coast(xx + 1) - coast(xx - 1)) / 2, l = Math.hypot(1, dz), nx = -dz / l, nz = 1 / l;
        for (const o of [-7, 5]) { pos.push(xx + nx * o, -0.36, z + nz * o); uv.push(xx / 30, o < 0 ? 0 : 1); }
    }
    for (let i = 0; i < n - 1; i++) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const mesh = new THREE.Mesh(geo, m); mesh.renderOrder = 1; group.add(mesh);
    t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(1, 1.6);
    anims.push((tt) => { t.offset.y = -0.3 + Math.sin(tt * 0.6) * 0.22; m.opacity = 0.55 + 0.25 * Math.sin(tt * 0.6 + 1.2); });
}

// 야자수: 휜 줄기 + 늘어진 잎 7장 (하나의 지오메트리)
export function palmGeo() {
    const trunk = new THREE.CylinderGeometry(0.16, 0.26, 7, 7, 8, true).translate(0, 3.5, 0), p = trunk.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + (y / 7) ** 2 * 1.1); }
    trunk.computeVertexNormals();
    const leaves = [];
    for (let k = 0; k < 7; k++) {
        const l = new THREE.PlaneGeometry(0.9, 3.4, 1, 6).translate(0, 1.7, 0), q = l.attributes.position;
        for (let i = 0; i < q.count; i++) { const y = q.getY(i); q.setZ(i, -((y / 3.4) ** 2) * 1.6); q.setX(i, q.getX(i) * (1 - (y / 3.4) * 0.7)); }
        l.rotateX(-1.1).rotateY((k / 7) * Math.PI * 2).translate(1.1, 7, 0);
        l.computeVertexNormals(); leaves.push(l);
    }
    return { trunk, crown: mergeGeometries(leaves) };
}

// 파라솔(기둥 + 원뿔 천)
export const umbrellaGeo = () => mergeGeometries([new THREE.CylinderGeometry(0.04, 0.04, 2.4, 5).translate(0, 1.2, 0), new THREE.ConeGeometry(1.4, 0.55, 10, 1, true).translate(0, 2.45, 0)]);

// 등대: 빨강/흰 줄무늬 탑 + 등롱 + 밤에 회전하는 빛줄기
export function lighthouse(group, x, z, y0, nightOnly, neonMats, anims) {
    const g = new THREE.Group(); g.position.set(x, y0, z);
    const lhM = [new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0xd8312a, roughness: 0.6 })];
    for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.6 - (k + 1) * 0.22, 2.6 - k * 0.22, 4, 16), lhM[k % 2]); m.position.y = 2 + k * 4; m.castShadow = true; g.add(m); }
    const lampM = new THREE.MeshBasicMaterial({ color: 0xfff2c0, toneMapped: false }); neonMats.push(lampM);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 12), lampM); lamp.position.y = 25.1; g.add(lamp);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2, 12), new THREE.MeshStandardMaterial({ color: 0x23262e })); cap.position.y = 27.2; g.add(cap);
    const beam = new THREE.Group(); beam.position.y = 25.1;
    const c = document.createElement('canvas'); c.width = 4; c.height = 128;
    const x2 = c.getContext('2d'), gr = x2.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#fff'); gr.addColorStop(0.35, '#555'); gr.addColorStop(1, '#000'); x2.fillStyle = gr; x2.fillRect(0, 0, 4, 128);
    const bm = new THREE.MeshBasicMaterial({ color: 0xfff0c0, alphaMap: new THREE.CanvasTexture(c), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    for (const sd of [1, -1]) beam.add(new THREE.Mesh(new THREE.ConeGeometry(7, 110, 16, 1, true).translate(0, -55, 0).rotateZ(sd * Math.PI / 2), bm));
    g.add(beam); group.add(g); beam.userData.anim = true; nightOnly.push(beam);
    anims.push((t) => { beam.rotation.y = t * 0.9; });
    return g;
}

// 풍력 발전기: 흰 타워 + 천천히 도는 3엽 로터
export function turbine(group, x, y, z, yaw, anims, ph) {
    const g = new THREE.Group(), white = turbine.m ??= new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5 });
    g.position.set(x, y, z); g.rotation.y = yaw;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.6, 52, 10).translate(0, 26, 0), white); tower.castShadow = true;
    const nac = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 2.4).translate(-1, 52.5, 0), white);
    const rot = new THREE.Group(); rot.position.set(1.8, 52.5, 0);
    const blades = [0, 1, 2].map((k) => new THREE.BoxGeometry(0.4, 22, 1.4).translate(0, 11, 0).rotateX((k / 3) * Math.PI * 2));
    rot.add(new THREE.Mesh(mergeGeometries([...blades, new THREE.BoxGeometry(2.2, 2.2, 2.2)]), white));
    g.add(tower, nac, rot); group.add(g); rot.userData.anim = true;
    anims.push((t) => { rot.rotation.x = t * 0.9 + ph; });
}
