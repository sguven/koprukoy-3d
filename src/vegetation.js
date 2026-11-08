// Trees, trunks and instanced steppe ground cover (dry grass tufts and low shrubs).
import * as THREE from 'three';
import { addWorldVaryings, triplanarMaterial } from './pbr.js';

// ------------------------------------------------------------------ tree canopies
// The canopies are smooth low-poly volumes with per-vertex colour. A world-space triplanar leaf-cluster
// texture with alpha cut-out makes them porous (light and sky show through) and gives leaf-scale detail;
// the shadow pass uses a depth material with the same cut-out so the shadows are dappled, not solid.
export function canopyMaterials(lib, { quality = 2 } = {}) {
  const fol = lib.tex('foliage.png', true);
  const SAMPLE = /* glsl */`
    vec3 fN = normalize(vWNormal);
    vec3 fW = kk_triW(fN, 3.0);
    vec4 leaf = kk_tri(tFol, vWPos * 0.85, fW);`;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tFol = { value: fol };
    addWorldVaryings(shader, '', '', 'uniform sampler2D tFol;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <map_fragment>', SAMPLE + /* glsl */`
        // leaf texture modulates the per-tree vertex colour; darker, bluer in the canopy's lower/inner parts
        diffuseColor.rgb *= leaf.rgb / 0.42;
        diffuseColor.rgb *= 0.55 + 0.45 * smoothstep(-0.6, 0.8, fN.y);
        diffuseColor.a = leaf.a;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        // soften the faceted canopy normals toward a rounded shading, and bend leaves outward a little
        normal = normalize(normal + kk_viewN(fN) * 0.5);`);
  };
  mat.customProgramCacheKey = () => 'kk_canopy';

  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaTest: 0.45, side: THREE.DoubleSide });
  const patchDepth = (m) => {
    m.onBeforeCompile = (shader) => {
      shader.uniforms.tFol = { value: fol };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNormal;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNormal = normalize(mat3(modelMatrix) * normal);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos; varying vec3 vWNormal; uniform sampler2D tFol;
          vec3 kk_triW(vec3 n, float k) { vec3 w = pow(abs(n), vec3(k)); return w / (w.x + w.y + w.z); }
          vec4 kk_tri(sampler2D t, vec3 p, vec3 w) { return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z; }`)
        .replace('#include <map_fragment>', SAMPLE + '\ndiffuseColor.a = leaf.a;');
    };
    m.customProgramCacheKey = () => 'kk_canopy_depth_' + m.type;
    return m;
  };
  patchDepth(depth);
  const distance = patchDepth(new THREE.MeshDistanceMaterial({ alphaTest: 0.45, side: THREE.DoubleSide }));
  return { material: mat, depth, distance };
}

export function trunkMaterial(lib) {
  const wood = lib.set('wood');
  return triplanarMaterial({ set: wood, scale: 0.6, normalScale: 1.2, antiTile: 0.3, sharp: 6, tint: new THREE.Color(0x6f5a44), roughBase: 1.0, cacheKey: 'trunk',
    extraFrag: `albedo = vec3(dot(albedo, vec3(0.33))) * vec3(0.52, 0.42, 0.33) * 1.3; albedo *= 0.8 + 0.4 * kk_tri(tRgh, vWPos * 0.9, kkW).r;` });
}

// ------------------------------------------------------------------ ground cover
function cardGeometry(w, h, cross = true) {
  const geos = [];
  const mk = (rotY) => { const g = new THREE.PlaneGeometry(w, h, 1, 2); g.translate(0, h / 2, 0); g.rotateY(rotY); return g; };
  geos.push(mk(0)); if (cross) geos.push(mk(Math.PI / 2));
  const g = mergeSimple(geos);
  // lit like the ground: all normals up, so the cards never show a dark back face
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}
function mergeSimple(geos) {
  let pos = [], uv = [], nrm = [], idx = [], off = 0;
  for (const g of geos) {
    pos.push(...g.attributes.position.array); uv.push(...g.attributes.uv.array); nrm.push(...g.attributes.normal.array);
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off); off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); out.setIndex(idx);
  return out;
}

function coverMaterial(tex, { fadeNear, fadeFar, sway }) {
  const m = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 1.0, metalness: 0, envMapIntensity: 0.5 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 }; shader.uniforms.uFade = { value: new THREE.Vector2(fadeNear, fadeFar) }; shader.uniforms.uSway = { value: sway };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uSway; uniform vec2 uFade;')
      .replace('#include <begin_vertex>', /* glsl */`
        #include <begin_vertex>
        {
          vec4 wc = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          vec3 wpos = (modelMatrix * wc).xyz;
          vec3 toCam = cameraPosition - wpos; float d = length(toCam);
          float k = 1.0 - smoothstep(uFade.x, uFade.y, d);   // shrink into the ground with distance
          // crossed cards read as X-marks from straight above: fade them out for steep (aerial) view angles
          float elev = toCam.y / max(1.0, d);
          k *= 1.0 - smoothstep(0.55, 0.85, elev);
          transformed *= k;
          float ph = wc.x * 0.7 + wc.z * 0.9;
          float w = sin(uTime * 1.3 + ph) * 0.5 + sin(uTime * 2.9 + ph * 1.7) * 0.25;
          transformed.x += w * uSway * uv.y * uv.y;
          transformed.z += w * uSway * 0.6 * uv.y * uv.y;
        }`);
    m.userData.shader = shader;
  };
  m.customProgramCacheKey = () => 'kk_cover';
  return m;
}

/**
 * Scatter ground cover using the terrain, the satellite-derived macro texture (greener = more scrub),
 * roads and building footprints from data4. Returns the InstancedMeshes and an update(now) function.
 */
export function groundCover(lib, { D, terrH, surfaceAt, macroImage, macroMap, quality = 2, seed = 7 }) {
  const grassTex = lib.tex('grass_card.png', true), shrubTex = lib.tex('shrub_card.png', true);
  grassTex.wrapS = grassTex.wrapT = THREE.ClampToEdgeWrapping; shrubTex.wrapS = shrubTex.wrapT = THREE.ClampToEdgeWrapping;
  const nGrass = quality >= 2 ? 48000 : quality === 1 ? 14000 : 0, nShrub = quality >= 2 ? 9000 : quality === 1 ? 2500 : 0;
  if (!nGrass) return null;

  // macro colour lookup (greenness / brightness of the satellite-derived texture)
  let macro = null, mw = 0, mh = 0;
  if (macroImage) {
    const c = document.createElement('canvas'); mw = c.width = 512; mh = c.height = 512;
    const ctx = c.getContext('2d'); try { ctx.drawImage(macroImage, 0, 0, mw, mh); macro = ctx.getImageData(0, 0, mw, mh).data; } catch (e) { macro = null; }
  }
  const { x0, z0, size } = D.grid;
  const flipV = macroMap ? macroMap.flipY : true;
  const sampleMacro = (x, z) => {
    if (!macro) return { g: 0, lum: 0.55 };
    let u = (x - x0) / size, v = (z - z0) / size; if (flipV) v = 1 - v;
    const px = Math.max(0, Math.min(mw - 1, Math.floor(u * mw))), py = Math.max(0, Math.min(mh - 1, Math.floor(v * mh)));
    const k = (py * mw + px) * 4, r = macro[k] / 255, g = macro[k + 1] / 255, b = macro[k + 2] / 255;
    return { g: g - Math.max(r, b) * 0.92, lum: 0.3 * r + 0.5 * g + 0.2 * b };
  };
  // building footprint hash (50 m cells) for a quick "inside a plot?" test
  const B = D.buildings, cell = 50, bh = new Map(), key = (i, j) => i * 100003 + j;
  for (let k = 0; k < B.length; k += 5) { const r = Math.hypot(B[k + 3], B[k + 4]) + 2; for (let i = Math.floor((B[k] - r) / cell); i <= Math.floor((B[k] + r) / cell); i++) for (let j = Math.floor((B[k + 1] - r) / cell); j <= Math.floor((B[k + 1] + r) / cell); j++) { const kk = key(i, j); if (!bh.has(kk)) bh.set(kk, []); bh.get(kk).push(k); } }
  const inBuilding = (x, z, margin) => {
    const L = bh.get(key(Math.floor(x / cell), Math.floor(z / cell))); if (!L) return false;
    for (const k of L) { const c = Math.cos(B[k + 2]), s = Math.sin(B[k + 2]), dx = x - B[k], dz = z - B[k + 1]; const lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < B[k + 3] + margin && Math.abs(lz) < B[k + 4] + margin) return true; }
    return false;
  };
  let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const slopeAt = (x, z) => { const e = 4, dx = terrH(x + e, z) - terrH(x - e, z), dz = terrH(x, z + e) - terrH(x, z - e); return Math.hypot(dx, dz) / (2 * e); };

  const place = (count, isShrub) => {
    const geo = isShrub ? cardGeometry(1.5, 1.1) : cardGeometry(1.0, 0.55);
    const mat = coverMaterial(isShrub ? shrubTex : grassTex, { fadeNear: isShrub ? 260 : 110, fadeFar: isShrub ? 420 : 190, sway: isShrub ? 0.015 : 0.04 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = isShrub; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = isShrub ? 'Calilar' : 'Otlar';
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    let placed = 0, tries = 0;
    // concentrate effort where people look: the village, the promenade and the bridge
    const foci = [[20, 60, 520], [-320, -230, 380], [-260, -60, 260], [-200, 420, 350]];
    while (placed < count && tries < count * 30) {
      tries++;
      const f = foci[Math.floor(rnd() * foci.length)], ang = rnd() * Math.PI * 2, rad = Math.sqrt(rnd()) * f[2];
      const x = f[0] + Math.cos(ang) * rad, z = f[1] + Math.sin(ang) * rad;
      if (x < x0 + 5 || z < z0 + 5 || x > x0 + size - 5 || z > z0 + size - 5) continue;
      const h = terrH(x, z); if (h < 0.7) continue;
      const slope = slopeAt(x, z); if (slope > (isShrub ? 0.55 : 0.7)) continue;
      const g = surfaceAt(x, z); if (g.road || g.y > h + 0.3) continue;
      if (inBuilding(x, z, isShrub ? 1.5 : 0.8)) continue;
      const mc = sampleMacro(x, z);
      // probability: scrub likes the greener patches; dry grass is everywhere but thins on bare, bright ground
      let pr = isShrub ? 0.12 + 2.2 * Math.max(0, mc.g) : 0.55 + 1.5 * Math.max(0, mc.g) - 1.2 * Math.max(0, mc.lum - 0.6);
      if (slope > 0.3) pr *= 0.5;
      if (rnd() > pr) continue;
      p.set(x, h - 0.03, z);
      q.setFromAxisAngle(up, rnd() * Math.PI);
      const k = isShrub ? 0.6 + 0.9 * rnd() : 0.6 + 0.8 * rnd();
      sc.set(k * (0.8 + 0.4 * rnd()), k, k * (0.8 + 0.4 * rnd()));
      m4.compose(p, q, sc); mesh.setMatrixAt(placed, m4);
      // colour: olive-grey to straw; greener where the macro map is green
      const gg = Math.max(0, Math.min(1, mc.g * 4));
      col.setHSL(0.14 + 0.07 * gg, 0.32 + 0.18 * gg, (isShrub ? 0.5 : 0.56) + 0.16 * rnd() - 0.08 * gg);
      mesh.setColorAt(placed, col);
      placed++;
    }
    mesh.count = placed; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  };
  const grass = place(nGrass, false), shrubs = place(nShrub, true);
  const mats = [grass.material, shrubs.material];
  return { meshes: [grass, shrubs], update(now) { for (const m of mats) if (m.userData.shader) m.userData.shader.uniforms.uTime.value = now * 0.001; } };
}
