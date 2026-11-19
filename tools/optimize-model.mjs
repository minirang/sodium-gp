import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize, meshopt, prune, dedup, reorder, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.encoder': MeshoptEncoder });

// 위치가 같은 정점을 하나로 보고 단순화한다(법선/UV 분리된 정점 때문에 단순화가 막히는 문제 회피)
function simplify(doc, ratio, error) {
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
        const idx = p.getIndices(), pos = p.getAttribute('POSITION').getArray(), n = idx.getCount();
        if (n < 900) continue;
        const key = new Map(), canon = new Uint32Array(pos.length / 3);
        for (let v = 0; v < canon.length; v++) { const k = `${Math.round(pos[v * 3] * 2e3)},${Math.round(pos[v * 3 + 1] * 2e3)},${Math.round(pos[v * 3 + 2] * 2e3)}`; canon[v] = key.get(k) ?? (key.set(k, v), v); }
        const src = idx.getArray(), ri = new Uint32Array(n); for (let i = 0; i < n; i++) ri[i] = canon[src[i]];
        const [out] = MeshoptSimplifier.simplify(ri, new Float32Array(pos), 3, Math.max(600, Math.floor(n * ratio / 3) * 3), error, []);
        idx.setArray(out);
    }
}
const jobs0 = [
    { src: 'cc.glb', out: 'concept', drop: ['Engine', 'BodyWindshieldWipers', 'InteriorSteeringWheel01', 'InteriorSteeringWheel02', 'InteriorSteeringWheel03', 'InteriorSteeringWheel04', 'InteriorSteeringEmblem', 'InteriorSteeringHandleL', 'InteriorSteeringHandleR', 'License Plate'], ratio: 0.45, error: 0.01 },
    { src: 'cc.glb', out: 'concept-lod', drop: ['Engine', 'BodyWindshieldWipers', 'BodyWindshieldWipersBase', 'License Plate', 'InteriorCage', 'InteriorSeatsColor1', 'InteriorSeatsColor2', 'InteriorSeatsFrame1', 'InteriorSeatsFrame2', 'InteriorDashMid', 'InteriorDashSides', 'InteriorMid', 'InteriorFloormats', 'InteriorPillar', 'InteriorSteeringBase', 'InteriorSteeringCylinder', 'InteriorSteeringDash', 'InteriorSteeringDashColumn', 'InteriorSteeringWheel01', 'InteriorSteeringWheel02', 'InteriorSteeringWheel03', 'InteriorSteeringWheel04', 'InteriorSteeringEmblem', 'InteriorSteeringHandleL', 'InteriorSteeringHandleR'], ratio: 0.2, error: 0.03 },
    { src: 'ferrari.glb', out: 'ferrari-458-lod', drop: ['interior_light', 'brakes', 'steering_wheel', 'wipers', 'nuts', 'interior_dark', 'leather', 'carpet', 'carbon_fibre_trim', 'brake', 'leds', 'grills', 'chrome'], ratio: 0.2, error: 0.03 },
];
for (const j of jobs) {
    const doc = await io.read(j.src), root = doc.getRoot();
    for (const e of root.listExtensionsUsed()) if (['KHR_draco_mesh_compression', 'KHR_materials_transmission', 'KHR_materials_iridescence', 'KHR_materials_variants'].includes(e.extensionName)) e.dispose();
    for (const n of root.listNodes()) if (j.drop.includes(n.getName())) n.dispose();
    await doc.transform(prune());
    simplify(doc, j.ratio, j.error);
    await doc.transform(prune(), dedup(), textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 80 }), reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
    const t = root.listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getIndices().getCount() / 3, 0), 0);
    await io.write(j.out + '.glb', doc); console.log(j.out, 'tris', Math.round(t));
}
