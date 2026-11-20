import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 합치기 전에 정점 속성을 정리: 인터리브/양자화된 속성을 Float32로 풀고, 머티리얼이 쓰지 않는 속성(uv 등)은 버린다
function clean(g, mat) {
    const need = ['position', 'normal'];
    if (mat.map || mat.alphaMap || mat.normalMap || mat.roughnessMap || mat.metalnessMap || mat.emissiveMap || mat.aoMap || mat.lightMap || mat.bumpMap || mat.clearcoatMap || mat.specularIntensityMap) { need.push('uv'); for (const k of ['uv1', 'uv2', 'uv3']) if (g.attributes[k]) need.push(k); if (mat.normalMap && g.attributes.tangent) need.push('tangent'); }
    if (mat.vertexColors) need.push('color');
    const out = new THREE.BufferGeometry();
    for (const k of need) {
        const a = g.attributes[k]; if (!a) return null;
        const n = a.count, s = a.itemSize, arr = new Float32Array(n * s);
        for (let i = 0; i < n; i++) { arr[i * s] = a.getX(i); if (s > 1) arr[i * s + 1] = a.getY(i); if (s > 2) arr[i * s + 2] = a.getZ(i); if (s > 3) arr[i * s + 3] = a.getW(i); }
        out.setAttribute(k, new THREE.BufferAttribute(arr, s));
    }
    if (g.index) out.setIndex(Array.from(g.index.array));
    else { const idx = []; for (let i = 0; i < g.attributes.position.count; i++) idx.push(i); out.setIndex(idx); }
    return out;
}
const SIG = (g) => Object.keys(g.attributes).sort().map((k) => `${k}:${g.attributes[k].itemSize}:${g.attributes[k].array.constructor.name}:${g.attributes[k].normalized}`).join('|') + (g.index ? '|i' : '');
const M = new THREE.Matrix4(), C = new THREE.Vector3();

// 움직이지 않는 메쉬를 (머티리얼 × 속성 구성 × 그림자 설정 × 위치 묶음)별로 하나로 합쳐 드로우콜을 줄인다.
// chunk: 위치 묶음 크기(m). 0이면 위치와 상관없이 합친다. skip(o)가 true인 물체와 그 자식은 건드리지 않는다.
export function mergeStatic(root, chunk = 0, skip = () => false) {
    const groups = new Map(), made = [];
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const walk = (o) => {
        if (skip(o)) return;
        // 셰이더를 고쳐 쓰는 머티리얼(건물 외벽·바다 등)은 전용 정점 속성이 있으므로 건드리지 않는다
        if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && !Object.prototype.hasOwnProperty.call(o.material, 'onBeforeCompile') && o.geometry.groups.length <= 1 && !o.morphTargetInfluences && o.visible) {
            if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
            C.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
            const ck = chunk ? `${Math.floor(C.x / chunk)},${Math.floor(C.z / chunk)}` : '';
            const cg = clean(o.geometry, o.material);
            if (cg) o.userData.cg = cg;
            const key = `${o.material.uuid}#${cg ? SIG(cg) : 'x' + o.uuid}#${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}#${o.renderOrder}#${o.frustumCulled ? 1 : 0}#${ck}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(o);
        }
        for (const c of [...o.children]) walk(c);
    };
    walk(root);
    for (const list of groups.values()) {
        if (list.length < 2 || !list[0].userData.cg) { list.forEach((o) => { o.userData.cg?.dispose(); delete o.userData.cg; }); continue; }
        try {
            const geos = list.map((o) => o.userData.cg.applyMatrix4(M.multiplyMatrices(inv, o.matrixWorld)));
            const g = mergeGeometries(geos); geos.forEach((x) => x.dispose());
            if (!g) continue;
            const f = list[0], mesh = new THREE.Mesh(g, f.material);
            Object.assign(mesh, { castShadow: f.castShadow, receiveShadow: f.receiveShadow, renderOrder: f.renderOrder, frustumCulled: f.frustumCulled });
            list.forEach((o) => { o.parent.remove(o); });
            root.add(mesh); made.push(g);
        } catch { /* 속성이 맞지 않으면 원래 메쉬를 그대로 둔다 */ }
    }
    return made;
}
