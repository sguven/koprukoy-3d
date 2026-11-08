// Roads, pavements, granite outcrops and the reservoir surface.
import * as THREE from 'three';
import { triplanarMaterial, addWorldVaryings } from './pbr.js';

// ------------------------------------------------------------------ roads
export function roadMaterialFactory(lib, { quality = 2 } = {}) {
  const asphalt = lib.set('asphalt'), dirt = lib.set('dirt_road'), gravel = lib.set('gravel'), concrete = lib.set('concrete'), paving = lib.set('paving'), soil = lib.set('soil');
  const cache = new Map();
  const planar = (key, opts) => { if (cache.has(key)) return cache.get(key); const m = triplanarMaterial({ sharp: 12, antiTile: 0.55, ...opts, cacheKey: key }); cache.set(key, m); return m; };
  // common edge treatment: dust / soil creeping onto the surface, patchy wear
  const WEAR = /* glsl */`
    float wearN = kk_tri(tSoilR, vWPos * 0.09, kkW).r;
    float wear = smoothstep(0.45, 0.8, wearN);`;
  return function pick(name, original) {
    switch (name) {
      case 'Asfalt': return planar('asphalt', { set: asphalt, scale: asphalt.size, normalScale: 0.7, tint: new THREE.Color(0xb0afa9), roughBase: 0.95,
        extraUniforms: { tSoilC: { value: soil.c }, tSoilR: { value: soil.r } }, fragHead: 'uniform sampler2D tSoilC, tSoilR;',
        extraFrag: WEAR + `
          // dust and dried mud dragged onto old village asphalt
          vec3 dust = kk_tri(tSoilC, vWPos * 0.4, kkW).rgb;
          albedo = mix(albedo, dust * 0.9, wear * 0.55);
          // faded, patchy surface
          albedo *= 0.85 + 0.3 * kk_tri(tSoilR, vWPos * 0.02 + 3.0, kkW).r;
          rough = mix(rough, 0.95, wear);` });
      case 'Toprak_Yol': return planar('dirt', { set: gravel, scale: gravel.size, normalScale: 0.8, tint: new THREE.Color(0xd9c5a2), roughBase: 1.0,
        extraUniforms: { tDirtC: { value: dirt.c }, tDirtN: { value: dirt.n }, tSoilR: { value: soil.r } }, fragHead: 'uniform sampler2D tDirtC, tDirtN, tSoilR;',
        extraFrag: WEAR + `
          // compacted earth with gravel showing through in patches
          vec3 pd = vWPos * 0.25;
          vec3 earth = kk_tri2(tDirtC, pd, kkW, kkK).rgb;
          float gravelK = smoothstep(0.35, 0.7, kk_tri(tSoilR, vWPos * 0.05, kkW).r);
          albedo = mix(earth * 1.05, albedo, gravelK * 0.7);
          wN = normalize(mix(kk_triNormal(tDirtN, pd, kkW, kkN, 0.9), wN, gravelK * 0.7));
          albedo *= 0.88 + 0.24 * wear;` });
      case 'Beton_Yol': return planar('concroad', { set: concrete, scale: concrete.size, normalScale: 0.6, tint: new THREE.Color(0xb9b3a6), roughBase: 0.95,
        extraUniforms: { tSoilC: { value: soil.c }, tSoilR: { value: soil.r } }, fragHead: 'uniform sampler2D tSoilC, tSoilR;',
        extraFrag: WEAR + `
          // concrete slab joints every 4 m, dust at the edges
          vec2 jp = abs(fract(vWPos.xz / 4.0) - 0.5);
          float joint = 1.0 - smoothstep(0.004, 0.012, min(jp.x, jp.y));
          albedo *= 1.0 - 0.45 * joint;
          albedo = mix(albedo, kk_tri(tSoilC, vWPos * 0.4, kkW).rgb, wear * 0.45);` });
      case 'Parke_Tasi': return planar('paving', { set: paving, scale: paving.size, normalScale: 0.9, tint: new THREE.Color(0xc4bcae), roughBase: 0.9,
        extraUniforms: { tSoilR: { value: soil.r } }, fragHead: 'uniform sampler2D tSoilR;',
        extraFrag: WEAR + `albedo *= 0.8 + 0.3 * wear;` });
      case 'Kaldirim': return planar('kerb', { set: concrete, scale: 2.0, normalScale: 0.5, tint: new THREE.Color(0xc8c2b6), roughBase: 0.92, extraFrag: `albedo *= 0.9 + 0.2 * kk_tri(tRgh, vWPos * 0.3, kkW).r;` });
      case 'Kilit_Tasi': return planar('kilit', { set: paving, scale: paving.size, normalScale: 0.9, tint: new THREE.Color(0xcfc5b4), roughBase: 0.9, extraFrag: `albedo *= 0.9 + 0.2 * kk_tri(tRgh, vWPos * 0.15, kkW).r;` });
      case 'Beton': return planar('beton', { set: concrete, scale: concrete.size, normalScale: 0.7, tint: new THREE.Color(0xa9a49a), roughBase: 0.9,
        extraFrag: `// water staining down vertical faces
          albedo *= 1.0 - 0.3 * smoothstep(0.3, 0.9, kk_tri(tRgh, vWPos * vec3(0.3, 0.05, 0.3), kkW).r) * (1.0 - abs(kkN.y));` });
      case 'Bariyer': return planar('bariyer', { set: concrete, scale: 1.5, normalScale: 0.4, tint: new THREE.Color(0xc9c4b9), roughBase: 0.85 });
      case 'Yol_Cizgisi': original.color.setHex(0xd9d4c2); original.roughness = 0.8; return original;
      case 'Cim': return planar('cim', { set: lib.set('grass_dry'), scale: 2.0, normalScale: 0.6, tint: new THREE.Color(0x9aa660), roughBase: 1.0, extraFrag: `albedo = mix(albedo, albedo * vec3(0.7, 0.95, 0.55), 0.5);` });
      case 'Metal_Korkuluk': original.color.setHex(0x3a3d40); original.roughness = 0.55; original.metalness = 0.6; return original;
      case 'Lamba': return original;
      default: return null;
    }
  };
}

// ------------------------------------------------------------------ granite outcrops
// The outcrops in the GLB are smooth low-poly domes. Their vertices are roughened once on the CPU with a
// world-space noise displacement (silhouettes, shadows and collision-free since rocks are decorative), then a
// triplanar weathered-granite material with speckle, iron staining and lichen replaces the flat grey.
function vnoise(x, y, z) {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s);
}
function smoothNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(vnoise(xi, yi, zi), vnoise(xi + 1, yi, zi), u), l(vnoise(xi, yi + 1, zi), vnoise(xi + 1, yi + 1, zi), u), v),
           l(l(vnoise(xi, yi, zi + 1), vnoise(xi + 1, yi, zi + 1), u), l(vnoise(xi, yi + 1, zi + 1), vnoise(xi + 1, yi + 1, zi + 1), u), v), w);
}
export function roughenRocks(mesh, amount = 0.35) {
  const g = mesh.geometry;
  if (g.userData.roughened) return;
  // work in float32 world-ish space: the mesh is quantized, so expand to float first
  const src = g.attributes.position, nrm = g.attributes.normal, n = src.count;
  const pos = new Float32Array(n * 3);
  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld, sc = new THREE.Vector3().setFromMatrixScale(m).x;
  const p = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    p.set(src.getX(i), src.getY(i), src.getZ(i)); nn.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    const wp = p.clone().applyMatrix4(m);
    // skip flat undersides so rocks stay seated in the ground
    if (nn.y > -0.9) {
      const d = (smoothNoise3(wp.x * 0.9, wp.y * 0.9, wp.z * 0.9) - 0.5) * 1.0 + (smoothNoise3(wp.x * 2.7, wp.y * 2.7, wp.z * 2.7) - 0.5) * 0.5 + (smoothNoise3(wp.x * 6.1, wp.y * 6.1, wp.z * 6.1) - 0.5) * 0.25;
      p.addScaledVector(nn, d * amount / sc);
    }
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.deleteAttribute('normal'); g.computeVertexNormals(); g.computeBoundingSphere(); g.computeBoundingBox();
  g.userData.roughened = true;
}

export function rockMaterial(lib) {
  const rock = lib.set('rock'), soil = lib.set('soil');
  const mat = triplanarMaterial({ set: rock, scale: rock.size * 0.6, normalScale: 1.2, antiTile: 0.5, sharp: 4, tint: new THREE.Color(0xe4dccd), roughBase: 0.95, vertexColors: false,
    extraUniforms: { tSoilC: { value: soil.c } }, fragHead: 'uniform sampler2D tSoilC;', cacheKey: 'rock',
    extraFrag: /* glsl */`
      // granite: pale feldspar/quartz with darker mineral speckle, iron staining, lichen on the upper faces
      float speck = kk_tri(tRgh, vWPos * 2.3, kkW).r;
      albedo = mix(albedo, albedo * 0.6, smoothstep(0.62, 0.8, speck) * 0.45);
      albedo *= 1.15;
      float lichen = smoothstep(0.45, 0.75, kk_tri(tRgh, vWPos * 0.6 + 4.0, kkW).r) * smoothstep(0.2, 0.8, kkN.y);
      albedo = mix(albedo, vec3(0.42, 0.45, 0.3), lichen * 0.35);
      // soil and dust collecting on gentle upper surfaces
      float dusty = smoothstep(0.6, 0.95, kkN.y) * smoothstep(0.4, 0.7, kk_tri(tRgh, vWPos * 0.3, kkW).r);
      albedo = mix(albedo, kk_tri(tSoilC, vWPos * 0.4, kkW).rgb * 0.9, dusty * 0.6);` });
  return mat;
}

// ------------------------------------------------------------------ reservoir
/** Builds a height texture of the terrain grid so the water shader knows the depth under each pixel. */
export function makeHeightTexture(grid) {
  const n = grid.seg + 1, data = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) data[i] = grid.h[i];
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

export function waterMaterial(lib, grid, { quality = 2 } = {}) {
  const n1 = lib.tex('water1_n.jpg'), n2 = lib.tex('water2_n.jpg');
  const heightTex = makeHeightTexture(grid);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1d3a3c, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.94, envMapIntensity: 9.0, depthWrite: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tN1: { value: n1 }, tN2: { value: n2 }, tHeight: { value: heightTex }, uTime: { value: 0 },
      uGrid: { value: new THREE.Vector4(grid.x0, grid.z0, grid.size, 0) },
      uShallow: { value: new THREE.Color(0x4e6e5a) }, uDeep: { value: new THREE.Color(0x12302f) },
    });
    addWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D tN1, tN2, tHeight; uniform float uTime; uniform vec4 uGrid; uniform vec3 uShallow, uDeep;`)
      .replace('#include <map_fragment>', /* glsl */`
        vec2 guv = (vWPos.xz - uGrid.xy) / uGrid.z;
        float ground = texture2D(tHeight, guv).r;
        float depth = max(0.0, vWPos.y - ground);
        vec3 toCam = cameraPosition - vWPos; float camD = length(toCam); vec3 V = toCam / camD;
        // two scales of wind ripples, drifting in slightly different directions
        vec2 p1 = vWPos.xz * 0.045 + uTime * vec2(0.013, 0.009);
        vec2 p2 = vWPos.xz * 0.19 + uTime * vec2(-0.021, 0.017);
        vec3 w1 = texture2D(tN1, p1).xyz * 2.0 - 1.0;
        vec3 w2 = texture2D(tN2, p2).xyz * 2.0 - 1.0;
        float calm = 0.55 + 0.45 * texture2D(tN1, vWPos.xz * 0.0015 + uTime * 0.002).b; // wind patches
        float distFade = 1.0 / (1.0 + camD * 0.0025);
        vec2 ripple = (w1.xy * 0.55 + w2.xy * 0.45) * 0.42 * calm * distFade;
        vec3 wN = normalize(vec3(ripple.x, 1.0, ripple.y));
        // colour: turbid green-brown shallows, dark blue-green deep water (an inland reservoir, not the sea)
        float dk = 1.0 - exp(-depth * 0.35);
        vec3 wcol = mix(uShallow, uDeep, dk);
        // ground tint showing through in the shallows
        vec3 sediment = vec3(0.36, 0.31, 0.22);
        wcol = mix(sediment, wcol, smoothstep(0.0, 1.6, depth));
        diffuseColor.rgb = wcol;
        // fresnel: more reflection at grazing angles, softer shoreline
        float fres = pow(1.0 - max(0.0, dot(V, wN)), 5.0);
        diffuseColor.a = mix(0.86, 0.98, fres) * smoothstep(0.0, 0.9, depth);
        float kkFres = fres;`)
      .replace('#include <normal_fragment_maps>', `normal = kk_viewN(wN);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness + 0.08 * (1.0 - calm) + 0.1 * (1.0 - distFade);`);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'kk_water';
  return mat;
}
