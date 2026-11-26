// v1.18: builds model/character/villager.glb, the character of the third-person walk (src/avatar.js).
//
// Sources (all CC0 1.0, by Quaternius — https://quaternius.com):
//   Universal Base Characters      Regular_Male_OnlyHead, Hair_SimpleParted, Hair_Moustache (+ their textures)
//   Modular Character Outfits – Fantasy   Male_Peasant_Arms / _Body / _Legs / _Feet (+ T_Peasant_*, T_Regular_Male_*)
//   Universal Animation Library    UAL1_Standard.glb (only the clips listed in ANIMS are kept)
// All share one 65-bone skeleton. The parts are merged onto the head's skeleton, the animation channels are moved
// onto it by bone name (rotations only, plus the pelvis's and root's translation), the textures are scaled to
// 1024² WebP and the meshes meshopt-compressed (the page already loads the meshopt decoder for the village).
//
// Usage:  npm i @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 sharp meshoptimizer
//         ANIMSRC=<dir>/UAL1_Standard.glb node tools/build_character.mjs model/character/villager.glb \
//           <ubc>/Regular_Male_OnlyHead.gltf <ubc>/Hair_SimpleParted.gltf <ubc>/Hair_Moustache.gltf \
//           <outfits>/Male_Peasant_Arms.gltf <outfits>/Male_Peasant_Body.gltf <outfits>/Male_Peasant_Legs.gltf <outfits>/Male_Peasant_Feet.gltf
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, prune, dedup, textureCompress, unpartition, weld, reorder, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
const [out, ...parts] = process.argv.slice(2);
const KEEP = (process.env.ANIMS || 'Idle_Loop,Walk_Loop,Jog_Fwd_Loop,Sprint_Loop,Jump_Loop').split(',');
await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(parts[0]);
const root = doc.getRoot();
const byName = new Map(); for (const n of root.listNodes()) byName.set(n.getName(), n);
const baseArm = byName.get('Armature');
for (const p of parts.slice(1)) {
  const src = await io.read(p);
  const before = new Set(root.listNodes());
  mergeDocuments(doc, src);
  const newNodes = root.listNodes().filter(n => !before.has(n));
  const newSkins = root.listSkins().filter(s => s.listJoints().some(j => newNodes.includes(j)));
  for (const s of newSkins) {
    const joints = s.listJoints().map(j => byName.get(j.getName()) || (() => { throw new Error('no joint ' + j.getName()); })());
    for (const j of s.listJoints()) s.removeJoint(j);
    for (const j of joints) s.addJoint(j);
    s.setSkeleton(byName.get('root'));
  }
  // move the new mesh nodes under the base Armature, then delete the duplicate skeleton
  for (const n of newNodes) if (n.getMesh()) { for (const par of n.listParents()) if (par.propertyType === 'Node') par.removeChild(n); baseArm.addChild(n); }
  for (const n of newNodes) if (!n.getMesh()) n.dispose();
}
// one scene
const scenes = root.listScenes(); for (const s of scenes.slice(1)) s.dispose();
const scene = scenes[0]; for (const c of scene.listChildren()) if (c !== baseArm) scene.removeChild(c);
// animations from UAL1
if (process.env.ANIMSRC) {
  const src = await io.read(process.env.ANIMSRC);
  for (const a of src.getRoot().listAnimations()) if (!KEEP.includes(a.getName())) a.dispose();
  const before = new Set(root.listNodes());
  mergeDocuments(doc, src);
  const newNodes = root.listNodes().filter(n => !before.has(n));
  for (const a of root.listAnimations()) for (const ch of a.listChannels()) {
    const t = ch.getTargetNode(); if (!newNodes.includes(t)) continue;
    const nm = t.getName(), path = ch.getTargetPath();
    const keepT = nm === 'pelvis' || nm === 'root';
    if (!byName.has(nm) || path === 'scale' || (path === 'translation' && !keepT)) { const s = ch.getSampler(); ch.dispose(); s.dispose(); continue; }
    ch.setTargetNode(byName.get(nm));
  }
  for (const n of newNodes) n.dispose();
  for (const m of root.listMeshes()) if (m.getName() === 'Mannequin') m.dispose();
  for (const s of root.listSkins()) if (!s.listJoints().length || s.listJoints().some(j => newNodes.includes(j))) s.dispose();
  for (const s of root.listScenes().slice(1)) s.dispose();
}
for (const m of root.listMeshes()) if (!m.listParents().some(p => p.propertyType === 'Node')) m.dispose();
await doc.transform(
  prune(), dedup(), unpartition(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [+(process.env.TEX || 1024), +(process.env.TEX || 1024)], quality: 82 }),
  prune(), weld(), reorder({ encoder: MeshoptEncoder }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
await io.write(out, doc);
console.log('wrote', out, root.listMeshes().map(m => m.getName()), root.listAnimations().map(a => a.getName()), root.listTextures().map(t => t.getName() + ':' + t.getSize()));
