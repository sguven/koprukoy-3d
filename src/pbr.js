// PBR material toolkit for Köprüköy 3D.
// The GLB has no UVs (apart from the terrain), so every surface material here is textured in world
// space with triplanar projection. Materials stay MeshStandardMaterial (so lights, shadows, fog and the
// environment map keep working) and are extended through onBeforeCompile.
import * as THREE from 'three';

// ---------------------------------------------------------------- texture library
export class TexLib {
  constructor(renderer, base = './tex/') {
    this.base = base; this.loader = new THREE.TextureLoader(); this.cache = new Map();
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.manifest = null;
  }
  async init() {
    try { this.manifest = await (await fetch(this.base + 'manifest.json')).json(); } catch (e) { this.manifest = {}; }
  }
  tex(file, srgb = false) {
    if (this.cache.has(file)) return this.cache.get(file);
    const t = this.loader.load(this.base + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = this.aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(file, t); return t;
  }
  /** Albedo / normal / roughness set plus its real-world tile size in metres. */
  set(name) {
    return { c: this.tex(`${name}_c.jpg`, true), n: this.tex(`${name}_n.jpg`), r: this.tex(`${name}_r.jpg`), size: (this.manifest && this.manifest[name] && this.manifest[name].size_m) || 2 };
  }
}

// ---------------------------------------------------------------- shared GLSL
export const GLSL = {
  // hash / noise helpers
  common: /* glsl */`
    float kk_hash(float n) { return fract(sin(n) * 43758.5453123); }
    float kk_hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    vec3 kk_triW(vec3 n, float k) { vec3 w = pow(abs(n), vec3(k)); return w / (w.x + w.y + w.z); }
    vec4 kk_tri(sampler2D t, vec3 p, vec3 w) {
      vec4 c = vec4(0.0);
      if (w.x > 0.002) c += texture2D(t, p.zy) * w.x;
      if (w.y > 0.002) c += texture2D(t, p.xz) * w.y;
      if (w.z > 0.002) c += texture2D(t, p.xy) * w.z;
      return c;
    }
    // Whiteout-blend triplanar normal mapping (world space). Returns a world-space normal.
    vec3 kk_triNormal(sampler2D t, vec3 p, vec3 w, vec3 n, float str) {
      vec3 tx = texture2D(t, p.zy).xyz * 2.0 - 1.0;
      vec3 ty = texture2D(t, p.xz).xyz * 2.0 - 1.0;
      vec3 tz = texture2D(t, p.xy).xyz * 2.0 - 1.0;
      tx.xy *= str; ty.xy *= str; tz.xy *= str;
      tx.x *= sign(n.x); ty.x *= sign(n.y); tz.x *= sign(n.z);
      tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
      ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
      tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
      return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
    }
    // two-scale blend to hide tiling
    vec4 kk_tri2(sampler2D t, vec3 p, vec3 w, float k) {
      vec4 a = kk_tri(t, p, w); vec4 b = kk_tri(t, p * 0.3137 + 17.3, w);
      return mix(a, b, k);
    }
    vec4 kk_planar2(sampler2D t, vec2 p, float k) {
      return mix(texture2D(t, p), texture2D(t, p * 0.3137 + 17.3), k);
    }
    vec3 kk_viewN(vec3 wn) { return normalize((viewMatrix * vec4(wn, 0.0)).xyz); }
  `,
  vertexVaryings: /* glsl */`
    varying vec3 vWPos; varying vec3 vWNormal;
  `,
  vertexAssign: /* glsl */`
    vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
    vWNormal = normalize(mat3(modelMatrix) * objectNormal);
  `,
};

/** Inject world-position / world-normal varyings into a standard material's vertex shader. */
export function addWorldVaryings(shader, extraVertex = '', vertexMain = '', fragHead = '') {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${GLSL.vertexVaryings}\n${extraVertex}`)
    .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${GLSL.vertexAssign}\n${vertexMain}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${GLSL.vertexVaryings}\n${GLSL.common}\n${fragHead}`);
}

/**
 * Generic triplanar PBR surface. Options:
 *  set: TexLib.set(...)           scale: metres per tile (defaults to set.size)
 *  tint: THREE.Color multiplier   normalScale, roughBase, antiTile (0..1), sharp (triplanar power)
 *  extraFrag: GLSL inserted after the base sampling; may modify `albedo`, `wN`, `rough`.
 *  extraUniforms: {name: {value}}
 */
export function triplanarMaterial(opts) {
  const { set, scale = set.size, tint = new THREE.Color(1, 1, 1), normalScale = 1.0, roughBase = 1.0, antiTile = 0.5, sharp = 4.0, extraFrag = '', extraUniforms = {}, extraVertex = '', vertexMain = '', fragHead = '', defines = {}, cacheKey = '', ...rest } = opts;
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: roughBase, metalness: 0.0, envMapIntensity: 0.8, ...rest });
  mat.userData.kk = { scale, normalScale, antiTile, sharp };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tAlb: { value: set.c }, tNor: { value: set.n }, tRgh: { value: set.r },
      uScale: { value: 1 / scale }, uNormalScale: { value: normalScale }, uAntiTile: { value: antiTile }, uSharp: { value: sharp },
    }, extraUniforms);
    mat.userData.shader = shader;
    addWorldVaryings(shader, extraVertex, vertexMain, fragHead);
    for (const [k, v] of Object.entries(defines)) shader.defines[k] = v;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAlb, tNor, tRgh; uniform float uScale, uNormalScale, uAntiTile, uSharp;`)
      .replace('#include <map_fragment>', /* glsl */`
        vec3 kkN = normalize(vWNormal);
        vec3 kkW = kk_triW(kkN, uSharp);
        vec3 kkP = vWPos * uScale;
        float kkK = uAntiTile * (0.5 + 0.5 * sin(vWPos.x * 0.37 + vWPos.z * 0.23 + vWPos.y * 0.5));
        vec4 kkAlb = kk_tri2(tAlb, kkP, kkW, kkK);
        vec3 albedo = kkAlb.rgb;
        vec3 wN = kk_triNormal(tNor, kkP, kkW, kkN, uNormalScale);
        float rough = kk_tri(tRgh, kkP, kkW).r;
        ${extraFrag}
        diffuseColor.rgb *= albedo;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        normal = kk_viewN(wN);`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = clamp(roughness * (0.55 + 0.9 * rough), 0.04, 1.0);`);
  };
  mat.customProgramCacheKey = () => 'kk_tri_' + cacheKey + '_' + extraFrag.length + '_' + Object.entries(defines).join(',');
  return mat;
}

/** Depth/distance materials that run the same vertex displacement so shadows match displaced meshes. */
export function matchingDepthMaterials(vertexPatch) {
  const patch = (m) => {
    m.onBeforeCompile = (shader) => { shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexPatch}`); };
    m.customProgramCacheKey = () => 'kk_depth_' + vertexPatch.length;
    return m;
  };
  return {
    depth: patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })),
    distance: patch(new THREE.MeshDistanceMaterial()),
  };
}
