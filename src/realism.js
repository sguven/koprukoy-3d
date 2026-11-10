// Orchestrates the realism upgrade of the loaded GLB scene: terrain, buildings, roads, bridge, rocks,
// water, vegetation and lighting. Everything here works on the loaded scene graph; the model data
// (model4.js / data4.js) is never modified, so the geographical layout stays exactly as surveyed.
import * as THREE from 'three';
import { TexLib } from './pbr.js';
import { terrainMaterial } from './terrain.js';
import { buildingMaterialFactory } from './buildings.js';
import { roadMaterialFactory, rockMaterial, roughenRocks, waterMaterial } from './surfaces.js';
import { canopyMaterials, trunkMaterial, groundCover } from './vegetation.js';
import { villageMaterials } from './village_materials.js';
import { buildVillage } from './village.js';
import { detailBridge } from './bridge.js';
import { splitMeshByCell, cellSizeFor } from './perf.js';

export async function setupRealism(ctx) {
  const { renderer, model, quality } = ctx;
  const off = new Set((location.hash.slice(1) || '').split(',').filter(Boolean)); // debug: #no-water,no-rock,no-road,no-bld,no-terrain
  const lib = new TexLib(renderer, new URL('../tex/', import.meta.url).href);
  await lib.init();
  ctx.lib = lib;
  const T0 = performance.now(); const log = (m) => console.log(`[realism] ${m} ${(performance.now() - T0).toFixed(0)} ms`);

  // ---- terrain -------------------------------------------------------------
  for (const name of ['Arazi', 'Arazi_Detay']) {
    const o = model.getObjectByName(name); if (!o || off.has('no-terrain')) continue;
    const old = o.material, macro = old.map;
    if (macro) { macro.colorSpace = THREE.SRGBColorSpace; macro.anisotropy = lib.aniso; macro.minFilter = THREE.LinearMipmapLinearFilter; macro.generateMipmaps = true; macro.needsUpdate = true; }
    if (name === 'Arazi') ctx.macroMap = macro;
    const m = terrainMaterial(lib, macro, { quality, waterLevel: 0 });
    if (name === 'Arazi_Detay') { m.polygonOffset = true; m.polygonOffsetFactor = -1; m.polygonOffsetUnits = -1; o.renderOrder = 1; }
    o.material = m; old.dispose && old.dispose();
  }

  log('terrain');
  // ---- buildings, bridge, public structures -------------------------------
  const pick = buildingMaterialFactory(lib, { quality });
  const swapped = new Map();
  for (const name of ['Konutlar', 'Kiyi_ve_Kamu', 'Cesnigir_Koprusu']) {
    const g = ctx.merged[name]; if (!g || off.has('no-bld')) continue;
    g.traverse(o => {
      if (!o.isMesh) return;
      const nm = o.material.name;
      const m = pick(nm, o.material);
      if (m) { o.material = m; swapped.set(nm, (swapped.get(nm) || 0) + 1); }
    });
  }

  log('buildings');
  // ---- roads & pavements ----------------------------------------------------
  const pickRoad = roadMaterialFactory(lib, { quality });
  for (const name of ['Yollar', 'Kiyi_ve_Kamu']) {
    const g = ctx.merged[name]; if (!g || off.has('no-road')) continue;
    g.traverse(o => { if (!o.isMesh) return; const m = pickRoad(o.material.name, o.material); if (m) { o.material = m; swapped.set(o.material.name, 1); } });
  }
  // roads sit a few cm above the terrain: polygon offset keeps them from z-fighting at distance
  ctx.merged.Yollar && ctx.merged.Yollar.traverse(o => { if (o.isMesh) { o.material.polygonOffset = true; o.material.polygonOffsetFactor = -2; o.material.polygonOffsetUnits = -2; } });

  log('roads');
  // ---- granite outcrops ----------------------------------------------------
  const rocks = model.getObjectByName('Granit_Kayalar');
  if (rocks && !off.has('no-rock')) { roughenRocks(rocks, 0.4); rocks.material = rockMaterial(lib); }

  log('rocks');
  // ---- reservoir -----------------------------------------------------------
  const water = model.getObjectByName('Su_Kizilirmak');
  let waterMat = null;
  if (water && !off.has('no-water')) { waterMat = waterMaterial(lib, ctx.D.grid, { quality }); water.material = waterMat; water.castShadow = false; water.receiveShadow = true; }

  log('water');

  // ---- vegetation ------------------------------------------------------------
  const canopy = model.getObjectByName('Agaclar_Yaprak'), trunks = model.getObjectByName('Agaclar_Govde');
  const canopyM = canopyMaterials(lib, { quality }), trunkM = trunkMaterial(lib);
  if (canopy && !off.has('no-trees')) { canopy.material = canopyM.material; canopy.customDepthMaterial = canopyM.depth; canopy.customDistanceMaterial = canopyM.distance; }
  if (trunks && !off.has('no-trees')) trunks.material = trunkM;
  ctx.canopy = canopyM; ctx.trunkMat = trunkM;
  let cover = null;
  if (!off.has('no-cover')) {
    cover = groundCover(lib, { D: ctx.D, terrH: ctx.terrH, surfaceAt: ctx.surfaceAt, macroImage: ctx.macroMap && ctx.macroMap.image, macroMap: ctx.macroMap, quality });
    if (cover) { for (const m of cover.meshes) { ctx.scene.add(m); ctx.layers.agac.push(m); if (ctx.culler) ctx.culler.add(m, m.userData.maxDist); } }
  }
  log('vegetation');

  // ---- the rebuilt village centre (v0.8) ----------------------------------------------------
  if (ctx.village && !off.has('no-village')) {
    const M = villageMaterials(lib, { quality });
    const v = buildVillage(ctx, ctx.village, M);
    ctx.scene.add(v.group);
    v.group.traverse(o => {
      if (!o.isMesh && !o.isLineSegments) return;
      if (/^V_(road|kerb|pave|square|lawn)/.test(o.name)) ctx.layers.yol.push(o);
      else if (/^Koy_Agac/.test(o.name)) ctx.layers.agac.push(o);
      else ctx.layers.bina.push(o);
    });
    log('village');
  }
  // ---- bridge detail: voussoirs, cutwater caps, parapet stones ------------------------------
  if (off.has('bridge-detail')) { const br = detailBridge(model, lib, pick); if (br) { ctx.scene.add(br); ctx.layers.bina.push(br); } log('bridge'); }   // opt-in: #bridge-detail

  // ---- v1.0: split the map-wide meshes into tiles ------------------------------------------------
  // Terrain, rocks, the old forest and the merged buildings / roads were each one mesh spanning the whole 2.4 km
  // map, so all of it was drawn (and drawn again into the shadow map) whatever the camera looked at. As tiles,
  // the renderer skips what is off screen or outside the shadow camera.
  const replace = (from, to) => { if (from === to) return; for (const k of Object.keys(ctx.layers)) ctx.layers[k] = ctx.layers[k].map(o => (o === from ? to : o)); };
  for (const [name, size] of [['Arazi', 600], ['Arazi_Detay', 600], ['Granit_Kayalar', 500], ['Agaclar_Yaprak', 500], ['Agaclar_Govde', 500]]) {
    const o = model.getObjectByName(name); if (o && o.isMesh) replace(o, splitMeshByCell(o, size));
  }
  for (const g of Object.values(ctx.merged)) {
    if (!g) continue; const parts = []; g.traverse(o => { if (o.isMesh) parts.push(o); });
    for (const o of parts) { const t = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; const size = cellSizeFor(t); if (isFinite(size)) splitMeshByCell(o, size); }
  }
  log('tiles');

  return { lib, swapped, update(now) {
    if (waterMat && waterMat.userData.shader) waterMat.userData.shader.uniforms.uTime.value = now * 0.001;
    if (cover) cover.update(now);
  } };
}
