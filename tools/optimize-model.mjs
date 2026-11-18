import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, quantize, meshopt, prune, dedup, reorder } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.encoder': MeshoptEncoder });
const jobs = [
  ['ferrari-458', ['interior_light', 'brakes', 'steering_wheel', 'wipers', 'nuts', 'carbon_fibre_trim'], 0.4, 0.01],
  ['ferrari-458-lod', ['interior_light', 'brakes', 'steering_wheel', 'wipers', 'nuts', 'interior_dark', 'leather', 'carpet', 'carbon_fibre_trim', 'brake', 'leds', 'grills', 'chrome'], 0.1, 0.03],
];
for (const [name, drop, ratio, error] of jobs) {
  const doc = await io.read('ferrari.glb');
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'KHR_draco_mesh_compression') e.dispose();
  for (const n of doc.getRoot().listNodes()) if (drop.includes(n.getName()) || (n.getName() === 'carbon fibre' && drop.includes('carbon_fibre_trim'))) n.dispose();
  await doc.transform(prune(), weld({ tolerance: 0.0002, toleranceNormal: 0.8 }));
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices(), pos = p.getAttribute('POSITION'), n = idx.getCount();
    if (n < 600) continue;
    const [out] = MeshoptSimplifier.simplify(Uint32Array.from(idx.getArray()), new Float32Array(pos.getArray()), 3, Math.max(300, Math.floor(n * ratio / 3) * 3), error, ['LockBorder']);
    idx.setArray(out);
  }
  await doc.transform(prune(), dedup(), reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const t = doc.getRoot().listMeshes().reduce((a, m) => a + m.listPrimitives().reduce((b, p) => b + p.getIndices().getCount() / 3, 0), 0);
  await io.write(name + '.glb', doc); console.log(name, 'tris', t);
}
