// Materials for the procedural village: reuses the v0.7 building / road shaders where a Blender material
// name exists for them, and adds the few that the rebuilt centre needs (roads with per-road UVs for
// wheel tracks and shoulders, blue-white kerbs, the mosque's turquoise and red plaster, the municipality).
import * as THREE from 'three';
import { triplanarMaterial } from './pbr.js';
import { buildingMaterialFactory } from './buildings.js';
import { roadMaterialFactory, rockMaterial } from './surfaces.js';

export function villageMaterials(lib, { quality = 2 } = {}) {
  const pick = buildingMaterialFactory(lib, { quality }), pickRoad = roadMaterialFactory(lib, { quality });
  const plaster = lib.set('plaster'), asphalt = lib.set('asphalt'), dirt = lib.set('dirt_road'), gravel = lib.set('gravel'), soil = lib.set('soil'), concrete = lib.set('concrete'), grass = lib.set('grass_dry'), stone = lib.set('stone_wall');
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {};

  // ---- buildings (shared shaders, per-building variation through aBld) ----
  for (const n of ['Duvar_Beyaz', 'Duvar_Krem', 'Duvar_Okr', 'Duvar_Pembe', 'Duvar_Sari', 'Duvar_Gri']) M[n] = pick(n);
  for (const n of ['Cati_Kiremit', 'Cati_Kiremit_Koyu', 'Cati_Kiremit_Turuncu', 'Cati_Kiremit_Acik']) M[n] = pick(n);
  M.Cati_Sac_Gri = pick('Cati_Sac_Gri'); M.Cati_Sac_Mavi = pick('Cati_Sac_Mavi');
  M.plinth = pick('Subasman'); M.garden = pick('Bahce_Duvari'); M.glass = pick('Cam'); M.door = pick('Kapi'); M.trim = pick('Beyaz_Silme'); M.chimney = pick('Baca');
  M.ashlar = pick('Kesme_Tas');
  M.beton = pickRoad('Beton'); M.paving = pickRoad('Parke_Tasi'); M.pave = M.paving;
  // mown lawn in front of the mosque and on the small greens: fine dry-grass texture, greener and even
  M.lawn = triplanarMaterial({ set: grass, scale: 1.1, normalScale: 0.5, antiTile: 0.5, sharp: 8, tint: new THREE.Color(0x8aa050), roughBase: 1.0, cacheKey: 'lawn', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    extraFrag: 'albedo = mix(albedo, albedo * vec3(0.8, 1.05, 0.6), 0.5); albedo *= 0.9 + 0.2 * kk_tri(tRgh, vWPos * 0.25, kkW).r;' });
  // pale limestone of the minaret, mosque base and gate posts
  M.limestone = triplanarMaterial({ set: stone, scale: stone.size, normalScale: 0.9, antiTile: 0.3, sharp: 8, tint: new THREE.Color(0xe6dac2), roughBase: 0.95, cacheKey: 'limestone',
    extraFrag: 'albedo *= 1.25; albedo *= 0.88 + 0.24 * kk_tri(tRgh, vWPos * 0.21 + 2.0, kkW).r; albedo *= 1.0 - 0.2 * smoothstep(0.6, 0.9, texture2D(tRgh, vec2(vWPos.x * 0.35 + vWPos.z * 0.35, vWPos.y * 0.02)).r) * (1.0 - abs(kkN.y));' });
  M.lead = std({ color: 0xa3a8ab, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.6 });   // weathered lead sheet: light grey, slightly bluish
  M.railing = pick('Metal_Korkuluk', std({ color: 0x3a3d40, roughness: 0.55, metalness: 0.6 }));
  M.metal = std({ color: 0x9a9da0, roughness: 0.45, metalness: 0.75, envMapIntensity: 0.9 });        // galvanised tanks, AC units, dishes
  M.metalDark = std({ color: 0x3b3f44, roughness: 0.6, metalness: 0.6 });                            // brackets, gutters, bins frame
  M.greenPaint = std({ color: 0x2f6b3a, roughness: 0.55, metalness: 0.2 });                          // gazebo roof, gates, benches
  M.orange = std({ color: 0xd85a1e, roughness: 0.6, metalness: 0.1 });                               // municipal litter bins
  M.bronze = std({ color: 0x4b3b2a, roughness: 0.45, metalness: 0.7, envMapIntensity: 0.7 });
  M.granite = triplanarMaterial({ set: stone, scale: 1.2, normalScale: 0.5, antiTile: 0.3, sharp: 8, tint: new THREE.Color(0x5e5c5a), roughBase: 0.6, cacheKey: 'granite', extraFrag: 'albedo = vec3(dot(albedo, vec3(0.33))) * 0.55;' });
  M.wood = pick('Ahsap'); M.rock = rockMaterial(lib);
  // dry-stone / rubble garden walls of granite boulders (Street View 07, 08, 12)
  M.rubble = triplanarMaterial({ set: lib.set('rubble_wall'), scale: lib.set('rubble_wall').size, normalScale: 1.0, antiTile: 0.3, sharp: 8, tint: new THREE.Color(0xb9a98f), roughBase: 0.95, cacheKey: 'rubblewall',
    extraFrag: 'albedo *= 0.9 + 0.25 * kk_tri(tRgh, vWPos * 0.3 + 1.0, kkW).r;' });
  M.woodRaw = triplanarMaterial({ set: lib.set('wood'), scale: 1.0, normalScale: 0.8, antiTile: 0.0, sharp: 8, tint: new THREE.Color(0xa08866), roughBase: 0.85, cacheKey: 'woodraw' });
  M.flag = std({ color: 0xc8102e, roughness: 0.8, side: THREE.DoubleSide });
  M.pole = triplanarMaterial({ set: concrete, scale: 1.0, normalScale: 0.6, antiTile: 0.2, sharp: 8, tint: new THREE.Color(0xa9a59c), roughBase: 0.9, cacheKey: 'pole', extraFrag: 'albedo *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.8, vWPos.y - 20.0)) * 0.0;' });
  M.wire = new THREE.LineBasicMaterial({ color: 0x1c1c1c });
  M.canvas = std({ color: 0x2e5d3a, roughness: 0.9, side: THREE.DoubleSide });

  // ---- special plaster finishes ----
  const plasterTint = (key, hex, extra = '') => triplanarMaterial({ set: plaster, scale: plaster.size, normalScale: 0.8, antiTile: 0.4, sharp: 6, tint: new THREE.Color(hex), roughBase: 1.0, cacheKey: key,
    extraFrag: /* glsl */`
      albedo *= 1.0 / 0.78;
      float grime = kk_tri(tRgh, vWPos * 0.13 + 3.0, kkW).r;
      albedo *= 0.9 + 0.2 * grime;
      ${extra}` });
  // mosque: pale green / turquoise lime wash (docs/reference/06)
  // village render colours seen in Street View (mint green, pale blue, salmon)
  M.Duvar_Mint = plasterTint('mint', 0xb6c9a3); M.Duvar_Mavi = plasterTint('mavi', 0xa9c4d6); M.Duvar_Somon = plasterTint('somon', 0xd99a7a); M.Duvar_Beton = plasterTint('cbeton', 0x9a9890); M.Duvar_Lila = plasterTint('lila', 0xb4aec6);
  M.turquoise = plasterTint('turq', 0x8fc9b8, 'albedo *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 1.2, vWPos.y - 27.0));');
  // courtyard wall: red ochre plaster, faded and dusty at the base
  M.redWall = plasterTint('redwall', 0xb0624a, `
      float streak = smoothstep(0.5, 0.9, texture2D(tAlb, vec2(vWPos.x * 0.7 + vWPos.z * 0.7, vWPos.y * 0.05)).g);
      albedo = mix(albedo, albedo * 1.25, streak * 0.4);`);
  // municipality: dirty whitewash with long rain streaks below the windows
  M.whitewash = plasterTint('white', 0xe4dfd6, `
      float streak = smoothstep(0.55, 0.9, texture2D(tAlb, vec2(vWPos.x * 0.9 + vWPos.z * 0.9, vWPos.y * 0.02)).g);
      albedo *= 1.0 - 0.22 * streak;
      albedo *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 1.0, vWPos.y - 25.0)) * 0.0;`);
  M.pilaster = triplanarMaterial({ set: concrete, scale: 2.0, normalScale: 0.6, antiTile: 0.3, sharp: 8, tint: new THREE.Color(0x9a5a48), roughBase: 0.9, cacheKey: 'pilaster', extraFrag: 'albedo = vec3(dot(albedo, vec3(0.33))) * vec3(1.3, 0.95, 0.85) * 1.25; albedo *= 0.85 + 0.3 * kk_tri(tRgh, vWPos * 0.4, kkW).r;' });
  M.coping = triplanarMaterial({ set: concrete, scale: 1.5, normalScale: 0.5, antiTile: 0.3, sharp: 8, tint: new THREE.Color(0xc9c3b6), roughBase: 0.9, cacheKey: 'coping' });
  M.step = M.beton;

  // ---- roads with per-road UVs ----------------------------------------------------------------
  // uv.x = signed distance from the centreline / half width (|1| at the edge), uv.y = metres along.
  const ROADV = 'varying vec2 vRuv;';
  const roadMat = (key, base, frag, extraUniforms = {}, fragHead = '') => triplanarMaterial({ set: base.set, scale: base.set.size, normalScale: base.ns, antiTile: 0.55, sharp: 12, tint: new THREE.Color(base.tint), roughBase: base.rough, cacheKey: key,
    extraVertex: ROADV, vertexMain: 'vRuv = uv;', fragHead: ROADV + ' uniform sampler2D tSoilC, tSoilR, tGrassC, tDirtC, tDirtN;' + fragHead,
    extraUniforms: { tSoilC: { value: soil.c }, tSoilR: { value: soil.r }, tGrassC: { value: grass.c }, tDirtC: { value: dirt.c }, tDirtN: { value: dirt.n }, ...extraUniforms },
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    extraFrag: /* glsl */`
      float au = abs(vRuv.x);
      float wearN = kk_tri(tSoilR, vWPos * 0.09, kkW).r;
      float wear = smoothstep(0.45, 0.8, wearN);
      vec3 dustC = kk_tri(tSoilC, vWPos * 0.4, kkW).rgb;
      // wheel tracks: two bands at |u| ~ 0.5 (1.5 m from the centre on a 6 m road), slightly wavy along the road
      float trackPos = 0.5 + 0.08 * sin(vRuv.y * 0.11) + 0.05 * sin(vRuv.y * 0.037 + 2.0);
      float track = exp(-pow((au - trackPos) / 0.11, 2.0));
      // soft shoulder: the surface fades into soil beyond the edge (|u| > 1)
      float shoulder = smoothstep(0.92, 1.25, au);
      ${frag}
      albedo = mix(albedo, dustC * 1.3, shoulder);
      rough = mix(rough, 0.95, shoulder);` });
  M.road_asphalt = roadMat('rd_asphalt', { set: asphalt, ns: 0.7, tint: 0xb0afa9, rough: 0.95 }, /* glsl */`
      // old village asphalt: dust creeping in from the edges, tyre-polished tracks, faded patches
      albedo *= 1.35;
      float edgeDust = smoothstep(0.55, 0.98, au) * (0.5 + 0.5 * wear);
      albedo = mix(albedo, dustC * 1.05, edgeDust * 0.6 + wear * 0.25);
      albedo *= 1.0 - 0.14 * track;
      albedo *= 0.86 + 0.28 * kk_tri(tSoilR, vWPos * 0.02 + 3.0, kkW).r;
      // repair patches
      float patchN = kk_tri(tSoilR, vWPos * 0.05 + 7.0, kkW).r;
      albedo *= 1.0 - 0.18 * smoothstep(0.7, 0.75, patchN);
      rough = mix(rough, 0.6, track * 0.5);`);
  M.road_concrete = roadMat('rd_conc', { set: concrete, ns: 0.6, tint: 0xb9b3a6, rough: 0.95 }, /* glsl */`
      // concrete slabs with 4 m joints, dust at the edges and in the tracks
      float joint = 1.0 - smoothstep(0.004, 0.012, abs(fract(vRuv.y / 4.0) - 0.5) * 4.0 * 0.5);
      joint = max(joint, 1.0 - smoothstep(0.02, 0.05, abs(au - 0.0)) * 0.0);
      albedo *= 1.0 - 0.4 * joint;
      albedo = mix(albedo, dustC, smoothstep(0.6, 1.0, au) * 0.4 + track * 0.25);`);
  M.road_dirt = roadMat('rd_dirt', { set: gravel, ns: 0.8, tint: 0xd9c5a2, rough: 1.0 }, /* glsl */`
      // compacted earth track: two darker, smoother wheel ruts, a grassy crown in the middle, gravel in patches
      vec3 pd = vWPos * 0.25;
      vec3 earth = kk_tri2(tDirtC, pd, kkW, kkK).rgb;
      float gravelK = smoothstep(0.35, 0.7, kk_tri(tSoilR, vWPos * 0.05, kkW).r);
      albedo = mix(earth * 1.05, albedo, gravelK * 0.6);
      wN = normalize(mix(kk_triNormal(tDirtN, pd, kkW, kkN, 0.9), wN, gravelK * 0.6));
      albedo *= 1.0 - 0.22 * track;
      float crown = (1.0 - smoothstep(0.0, 0.22, au)) * smoothstep(0.35, 0.7, kk_tri(tSoilR, vWPos * 0.3 + 1.0, kkW).r);
      vec3 grassC = kk_tri(tGrassC, vWPos * 0.5, kkW).rgb * vec3(0.95, 1.0, 0.75);
      albedo = mix(albedo, grassC, crown * 0.7);
      albedo *= 0.88 + 0.24 * wear;
      rough = mix(rough, 0.7, track * 0.4);`);
  // stabilised earth square: no ruts, lots of tyre scuffing
  M.square = roadMat('rd_square', { set: gravel, ns: 0.7, tint: 0xd6c6a8, rough: 1.0 }, /* glsl */`
      vec3 pd = vWPos * 0.25;
      vec3 earth = kk_tri2(tDirtC, pd, kkW, kkK).rgb;
      albedo = mix(earth * 1.08, albedo, 0.45);
      albedo *= 0.9 + 0.2 * kk_tri(tSoilR, vWPos * 0.07 + 2.0, kkW).r;
      shoulder = 0.0;`);
  for (const k of ['road_asphalt', 'road_concrete', 'road_dirt', 'square']) M[k].userData.isRoad = true;

  // ---- kerb: alternating blue / white painted blocks (docs/reference/03, 06) ----
  M.kerb = std({ color: 0xffffff, roughness: 0.85 });
  M.kerb.onBeforeCompile = (shader) => {
    shader.uniforms.tNoise = { value: lib.tex('noise.jpg') };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vKuv; varying vec3 vKpos;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvKuv = uv; vKpos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vKuv; varying vec3 vKpos; uniform sampler2D tNoise;')
      .replace('#include <map_fragment>', /* glsl */`
        float blk = floor(vKuv.y / 0.7);
        float blue = mod(blk, 2.0);
        vec3 paint = mix(vec3(0.88, 0.86, 0.8), vec3(0.16, 0.34, 0.7), blue);
        float worn = texture2D(tNoise, vKpos.xz * 0.35).r;
        vec3 conc = vec3(0.6, 0.58, 0.54);
        paint = mix(paint, conc, smoothstep(0.55, 0.85, worn) * 0.8);         // paint flaked off to the concrete
        float gap = 1.0 - smoothstep(0.0, 0.03, abs(fract(vKuv.y / 0.7) - 0.5) * 0.7 - 0.33);
        paint *= 1.0 - 0.35 * gap;
        paint *= 0.92 + 0.16 * texture2D(tNoise, vKpos.xz * 1.7).g;
        diffuseColor.rgb *= paint;`);
  };
  M.kerb.customProgramCacheKey = () => 'kk_kerb';

  M.pick = pick; M.pickRoad = pickRoad;
  return M;
}
