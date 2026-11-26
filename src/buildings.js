// Building façades, roofs, plinths, glazing, doors and garden walls for a rural Central Anatolian
// settlement. Footprints, positions and volumes come from the GLB and are not touched; this module only
// (1) tags every vertex with its building id / base / top / orientation before meshes are merged, and
// (2) swaps the flat Blender colours for world-space PBR materials with per-building variation and weathering.
import * as THREE from 'three';
import { triplanarMaterial } from './pbr.js';

const _box = new THREE.Box3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

/** Add per-building attributes to every mesh under `group` (each direct child = one building / object). */
export function tagBuildings(group, startId = 1) {
  group.updateMatrixWorld(true);
  let id = startId;
  for (const child of group.children) {
    _box.setFromObject(child);
    child.getWorldPosition(_v); child.getWorldQuaternion(_q); _e.setFromQuaternion(_q, 'YXZ');
    const base = _box.min.y, top = _box.max.y, yaw = _e.y, cx = _v.x, cz = _v.z;
    child.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry, n = g.attributes.position.count;
      const fill = (name, vals) => { const a = new Float32Array(n * vals.length); for (let i = 0; i < n; i++) a.set(vals, i * vals.length); g.setAttribute(name, new THREE.BufferAttribute(a, vals.length)); };
      fill('aBld', [id, base, top, yaw]);
      fill('aCtr', [cx, cz]);
      if (/^(Cam|Glass)$/.test(o.name)) tagWindows(o);
    });
    id++;
  }
  return id;
}

/** Windows are independent quads (4 verts / 2 tris each). Give each a 0..1 UV and its size so the shader can draw frames and reveals. */
function tagWindows(mesh) {
  const g = mesh.geometry, pos = g.attributes.position, n = pos.count;
  const uv = new Float32Array(n * 2), size = new Float32Array(n * 2);
  const idx = g.index ? g.index.array : null;
  const tris = idx ? idx.length / 3 : n / 3;
  const seen = new Uint8Array(n);
  let found = 0;
  for (let t = 0; t + 1 < tris; t += 2) {
    const vs = new Set();
    for (let k = 0; k < 6; k++) vs.add(idx ? idx[t * 3 + k] : t * 3 + k);
    if (vs.size !== 4) continue;
    const arr = [...vs];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const i of arr) { const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const w = Math.hypot(maxX - minX, maxZ - minZ), h = maxY - minY;
    if (h < 0.05 || w < 0.05) continue;
    const alongX = (maxX - minX) >= (maxZ - minZ);
    for (const i of arr) {
      const u = alongX ? (pos.getX(i) - minX) / (maxX - minX) : (pos.getZ(i) - minZ) / (maxZ - minZ);
      uv[i * 2] = u; uv[i * 2 + 1] = (pos.getY(i) - minY) / h; size[i * 2] = w; size[i * 2 + 1] = h; seen[i] = 1;
    }
    found++;
  }
  g.setAttribute('aWuv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aWsz', new THREE.BufferAttribute(size, 2));
  mesh.userData.windows = found;
}

const BLD_VERT = /* glsl */`attribute vec4 aBld; attribute vec2 aCtr; varying vec4 vBld; varying vec2 vCtr;`;
const BLD_VERT_MAIN = /* glsl */`vBld = aBld; vCtr = aCtr;`;
const BLD_FRAG = /* glsl */`varying vec4 vBld; varying vec2 vCtr;
  // interpolation jitter on a 'constant' varying would scramble the hash: snap the id back to an integer
  #define kkBid floor(vBld.x + 0.5)
  // building-local horizontal coordinates (rotated by the building's yaw) so textures follow the walls
  vec2 kk_local(vec3 p) { float c = cos(vBld.w), s = sin(vBld.w); vec2 d = p.xz - vCtr; return vec2(c * d.x - s * d.y, s * d.x + c * d.y); }
  // v1.17 weathering helpers: smooth value noise and a 3-octave fbm on a 2D (wall or roof) coordinate
  float kk_vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(kk_hash2(i), kk_hash2(i + vec2(1.0, 0.0)), f.x), mix(kk_hash2(i + vec2(0.0, 1.0)), kk_hash2(i + vec2(1.0, 1.0)), f.x), f.y); }
  float kk_fbm(vec2 p) { return 0.5 * kk_vn(p) + 0.3 * kk_vn(p * 2.03 + 7.1) + 0.2 * kk_vn(p * 4.11 + 3.7); }
  // wall-plane coordinate: metres along the wall (building frame) and metres above the building's ground line
  vec2 kk_wall(vec3 p, vec3 n) { vec2 lp = kk_local(p); float c = cos(vBld.w), s = sin(vBld.w);
    vec2 ln = vec2(c * n.x - s * n.z, s * n.x + c * n.z); return vec2(abs(ln.x) > abs(ln.y) ? lp.y * sign(ln.x) : -lp.x * sign(ln.y), p.y - vBld.y); }
`;

/** Realistic palette for rendered village houses: lime white, cream, ochre, pink, pale yellow, grey render. */
const WALL_TINTS = {
  Duvar_Beyaz: 0xe9e4d8, Duvar_Krem: 0xdcc9a3, Duvar_Okr: 0xc99a5b, Duvar_Pembe: 0xd9a995, Duvar_Sari: 0xd8c074, Duvar_Gri: 0xb8b3a8, Beyaz: 0xece8df,
};
const ROOF_TINTS = { Cati_Kiremit: 0xa65a40, Cati_Kiremit_Koyu: 0x7e4634, Cati_Kiremit_Turuncu: 0xb86a48, Cati_Kiremit_Acik: 0xc08a68 };

export function buildingMaterialFactory(lib, { quality = 2 } = {}) {
  const plaster = lib.set('plaster'), rubble = lib.set('rubble_wall'), concrete = lib.set('concrete'), roof = lib.set('roof_tile'), metal = lib.set('metal_corr'), wood = lib.set('wood'), stone = lib.set('stone_wall');
  const cache = new Map();

  function facade(name, tintHex) {
    const key = 'facade:' + name; if (cache.has(key)) return cache.get(key);
    const tint = new THREE.Color(tintHex);
    const m = triplanarMaterial({
      set: plaster, scale: plaster.size, normalScale: 0.9, antiTile: 0.4, sharp: 6,
      extraUniforms: { tRubC: { value: rubble.c }, tRubN: { value: rubble.n }, tConC: { value: concrete.c }, tConN: { value: concrete.n }, uTint: { value: tint } },
      extraVertex: BLD_VERT, vertexMain: BLD_VERT_MAIN,
      fragHead: BLD_FRAG + `uniform sampler2D tRubC, tRubN, tConC, tConN; uniform vec3 uTint;`,
      cacheKey: 'facade',
      extraFrag: /* glsl */`
        float bid = kkBid, base = vBld.y, top = vBld.z;
        float h1 = kk_hash(bid * 1.371), h2 = kk_hash(bid * 7.913 + 3.1), h3 = kk_hash(bid * 3.317 + 11.7), h4 = kk_hash(bid * 0.771 + 5.3);
        float hAbove = vWPos.y - base;              // metres above the building's ground line
        float fromTop = top - vWPos.y;              // metres below the roof line
        vec3 tint = uTint;
        // per-building tint jitter: faded paint, different batches of lime wash
        tint *= 0.86 + 0.28 * h2;
        tint = mix(tint, vec3(dot(tint, vec3(0.33))), 0.25 * h3);
        float wallKind = h1;                        // < 0.14 rubble stone, > 0.90 bare concrete/brick (unfinished), else render
        if (wallKind < 0.14) {
          vec3 pr = vWPos * (1.0 / 2.0) + h2 * 3.0;
          albedo = kk_tri2(tRubC, pr, kkW, kkK).rgb * (0.9 + 0.2 * h3);
          wN = kk_triNormal(tRubN, pr, kkW, kkN, 1.1);
          rough = 0.9;
        } else if (wallKind > 0.90) {
          vec3 pc = vWPos * (1.0 / 3.0) + h2 * 5.0;
          albedo = kk_tri2(tConC, pc, kkW, kkK).rgb * vec3(1.02, 0.98, 0.9) * (0.85 + 0.2 * h3);
          wN = kk_triNormal(tConN, pc, kkW, kkN, 0.8);
          rough = 0.92;
        } else {
          albedo *= tint / 0.78;                    // plaster texture is ~0.78 grey; tint carries the colour
        }
        // ---- weathering -------------------------------------------------
        // v1.17: every house has an age (0 = rendered last year, 1 = fifty years of sun, frost and rain); the old
        // ones lose plaster in patches down to the hollow brick or the rubble behind it, carry a rising-damp tide
        // mark with a pale salt line at its top, hairline cracks, sun-bleached south and west fronts, green-grey
        // algae on the north side and a blotchy, many-times-patched lime wash
        float age = sqrt(kk_hash(bid * 5.17 + 1.3));
        vec2 wp = kk_wall(vWPos, kkN) + vec2(mod(bid, 97.0) * 3.7, 0.0);
        float vert = 1.0 - smoothstep(0.35, 0.6, abs(kkN.y));      // 1 on walls, 0 on the parapet tops
        if (wallKind >= 0.14) {
          // blotchy tone: lime wash renewed in patches, older coats showing through
          float mott = kk_fbm(wp * vec2(0.45, 0.6));
          albedo *= 0.93 + 0.14 * mott;
          albedo = mix(albedo, vec3(dot(albedo, vec3(0.333))) * vec3(1.03, 1.0, 0.95), 0.25 * age * smoothstep(0.45, 0.75, mott));
          // sun-bleached south / west faces, algae on the north side (model +z = south, -x = west)
          float sunF = max(0.0, kkN.z) * 0.8 + max(0.0, -kkN.x) * 0.5;
          albedo = mix(albedo, vec3(dot(albedo, vec3(0.333))) * 1.1, 0.3 * sunF * age);
          float northF = max(0.0, -kkN.z);
          float algae = northF * age * smoothstep(0.45, 0.8, kk_fbm(wp * vec2(0.9, 0.35) + 11.0)) * (0.4 + 0.6 * (1.0 - smoothstep(0.5, 2.5, hAbove)));
          albedo = mix(albedo, albedo * vec3(0.66, 0.72, 0.6), 0.55 * algae * vert);
          // rising damp: dark wet band with a ragged top and a thin white salt bloom along it
          float tide = 0.35 + 0.75 * age + 0.3 * (kk_fbm(vec2(wp.x * 0.7, 0.0)) - 0.5);
          float damp = (1.0 - smoothstep(tide - 0.18, tide + 0.02, hAbove)) * smoothstep(0.15, 0.4, age);
          albedo = mix(albedo, albedo * vec3(0.64, 0.6, 0.54), damp * 0.85 * vert);
          float salt = exp(-pow((hAbove - tide - 0.03) / 0.045, 2.0)) * smoothstep(0.15, 0.4, age) * kk_vn(wp * vec2(3.0, 1.0));
          albedo = mix(albedo, vec3(0.86, 0.85, 0.81), salt * 0.45 * vert);
          rough = clamp(rough - 0.12 * damp, 0.0, 1.0);
          // hairline cracks: thin ridges of a noise field, only where the render has started to fail
          float rdg = 1.0 - abs(2.0 * kk_vn(wp * vec2(1.1, 0.8) + 4.0) - 1.0);
          float crack = smoothstep(0.955, 0.99, rdg) * smoothstep(0.35, 0.9, age) * smoothstep(0.45, 0.6, kk_vn(wp * 0.3 + 9.0));
          albedo *= 1.0 - 0.5 * crack * vert;
          // spalled render: the coat has fallen off in patches, most of all low down and on the old houses;
          // behind it hollow red brick (houses since the 1970s) or the old rubble and mud mortar
          float sp = kk_fbm(wp * vec2(0.85, 1.1) + 21.0) + 0.16 * (1.0 - smoothstep(0.2, 1.4, hAbove)) - 0.1 * smoothstep(1.4, 3.5, hAbove);
          float thr = mix(0.88, 0.6, age);
          float spall = smoothstep(thr, thr + 0.015, sp) * vert;
          float rim = (smoothstep(thr - 0.035, thr, sp) - spall) * vert;
          if (spall > 0.001) {
            vec3 under;
            if (h3 > 0.45) {   // hollow brick in courses of 19 cm, 29 cm long, grey mortar
              float row = wp.y / 0.2, odd = mod(floor(row), 2.0), col = wp.x / 0.3 + 0.5 * odd;
              float joint = max(smoothstep(0.84, 0.95, fract(row)), smoothstep(0.9, 0.97, fract(col)));
              float tone = kk_hash2(vec2(floor(row), floor(col)) + mod(bid, 53.0));
              under = mix(vec3(0.62, 0.33, 0.22) * (0.8 + 0.35 * tone), vec3(0.58, 0.56, 0.52), joint * 0.9);
            } else {
              vec3 pr = vWPos * 0.5 + h2 * 3.0;
              under = kk_tri(tRubC, pr, kkW).rgb * vec3(1.0, 0.95, 0.88) * 0.9;
              wN = normalize(mix(wN, kk_triNormal(tRubN, pr, kkW, kkN, 1.2), spall));
            }
            albedo = mix(albedo, under, spall);
            rough = mix(rough, 0.95, spall);
          }
          albedo *= 1.0 - 0.35 * rim;                 // the broken edge of the coat throws a thin shadow
        }
        // rain-splash and dust band at the base (0 .. 1.4 m), stronger on older houses
        float splash = (1.0 - smoothstep(0.0, 1.0 + 0.8 * h4, hAbove)) * (0.25 + 0.4 * h4);
        albedo = mix(albedo, albedo * vec3(0.62, 0.56, 0.48), splash);
        // streaks running down from the eaves / window sills
        float streakN = texture2D(tAlb, vec2(kk_local(vWPos).x * 0.9 + bid, vWPos.y * 0.015)).g;
        float streak = smoothstep(0.55, 0.9, streakN) * (1.0 - smoothstep(0.0, 1.2 + 3.0 * age, fromTop)) * (0.25 + 0.5 * h3);
        albedo *= 1.0 - (0.22 + 0.2 * age) * streak;
        // general grime / discolouration patches
        float grime = kk_tri(tRgh, vWPos * 0.11 + h1 * 7.0, kkW).r;
        albedo *= 0.9 + 0.2 * grime;
        rough = clamp(rough + 0.15 * splash, 0.0, 1.0);`,
    });
    cache.set(key, m); return m;
  }

  function roofTiles(name, tintHex) {
    const key = 'roof:' + name; if (cache.has(key)) return cache.get(key);
    const m = triplanarMaterial({
      set: roof, scale: roof.size, normalScale: 1.2, antiTile: 0.0, sharp: 8,
      extraUniforms: { tMetC: { value: metal.c }, tMetN: { value: metal.n }, uTint: { value: new THREE.Color(tintHex) } },
      extraVertex: BLD_VERT, vertexMain: BLD_VERT_MAIN, fragHead: BLD_FRAG + `uniform sampler2D tMetC, tMetN; uniform vec3 uTint;`,
      cacheKey: 'roof',
      extraFrag: /* glsl */`
        float bid = kkBid;
        float h1 = kk_hash(bid * 1.371), h2 = kk_hash(bid * 7.913 + 3.1), h3 = kk_hash(bid * 3.317 + 11.7);
        // orient the tile courses with the roof slope: rotate into the building frame, then choose the
        // axis the roof plane slopes along so that v (down the tile) follows the fall line
        vec2 lp = kk_local(vWPos);
        float c = cos(vBld.w), s = sin(vBld.w);
        vec2 ln = vec2(c * kkN.x - s * kkN.z, s * kkN.x + c * kkN.z);  // local horizontal normal
        float fore = 1.0 / max(0.3, kkN.y);          // horizontal distance -> distance along the slope
        vec2 uvr = abs(ln.x) > abs(ln.y) ? vec2(lp.y, lp.x * fore) : vec2(lp.x, lp.y * fore);
        uvr += h2 * 10.0;
        vec4 tc = texture2D(tAlb, uvr * uScale);
        vec3 tn = texture2D(tNor, uvr * uScale).xyz * 2.0 - 1.0;
        albedo = tc.rgb * mix(vec3(1.0), uTint / 0.38, 0.6) * (0.85 + 0.3 * h3);
        // perturb geometric normal with the tile relief (UDN, in the roof's local frame)
        vec3 tangent = normalize(abs(ln.x) > abs(ln.y) ? vec3(-s, 0.0, c) : vec3(c, 0.0, s));
        vec3 bitan = normalize(cross(kkN, tangent));
        wN = normalize(kkN + (tangent * tn.x + bitan * tn.y) * uNormalScale);
        rough = texture2D(tRgh, uvr * uScale).r;
        // moss / dust on the shaded side, lichen on old roofs
        float age = smoothstep(0.55, 1.0, h1);
        albedo = mix(albedo, albedo * vec3(0.75, 0.8, 0.65), age * 0.5 * smoothstep(0.4, 0.8, kk_tri(tRgh, vWPos * 0.2, kkW).r));
        albedo *= 0.88 + 0.24 * kk_tri(tRgh, vWPos * 0.07 + bid, kkW).r;
        // v1.17: years on the roof. Each tile its own firing (a shade lighter or darker), tiles replaced over the
        // years in a fresher orange or an odd grey-brown, a few cracked or slipped ones showing a dark gap, orange and
        // grey-green lichen rosettes, moss and dirt gathering towards the eaves, most of all on the north slopes,
        // and the colour of old roofs burnt out by the sun
        float rAge = sqrt(kk_hash(bid * 5.17 + 1.3));
        vec2 tcell = floor(vec2(uvr.x * uScale * 7.0, uvr.y * uScale * 4.0));
        float th = kk_hash2(tcell + mod(bid, 61.0) * 1.7);
        albedo *= 0.9 + 0.2 * th;
        if (th > 0.975 - 0.02 * h3) albedo = mix(albedo, vec3(0.62, 0.3, 0.17), 0.65);          // a newer tile
        else if (th < 0.012 + 0.02 * rAge) albedo = mix(albedo, vec3(0.38, 0.33, 0.29), 0.6);  // an odd grey one from another roof
        vec2 tf = fract(vec2(uvr.x * uScale * 7.0, uvr.y * uScale * 4.0));
        float slipped = step(0.996 - 0.008 * rAge, kk_hash2(tcell * 1.31 + 5.0 + mod(bid, 37.0)));
        albedo *= 1.0 - 0.75 * slipped * smoothstep(0.55, 0.7, tf.y);                            // a dark gap under a slipped tile
        float north = max(0.0, -kkN.z) * 0.7 + 0.3;
        vec2 rp = vWPos.xz;
        float lich = smoothstep(0.64, 0.72, kk_vn(rp * 5.0 + 13.0)) * smoothstep(0.35, 0.65, kk_fbm(rp * 0.35 + bid * 0.01));
        albedo = mix(albedo, vec3(0.74, 0.52, 0.2), 0.45 * lich * rAge * (1.0 - north * 0.6));     // orange Xanthoria
        float lich2 = smoothstep(0.72, 0.8, kk_vn(rp * 4.3 + 2.0)) * smoothstep(0.45, 0.7, kk_fbm(rp * 0.28 + 7.0));
        albedo = mix(albedo, albedo * vec3(0.85, 0.92, 0.85) + vec3(0.06), 0.35 * lich2 * rAge);                          // pale grey-green crust
        float moss = north * rAge * smoothstep(0.5, 0.78, kk_fbm(rp * 0.5 + 3.0)) * smoothstep(0.4, 0.75, tf.y);
        albedo = mix(albedo, vec3(0.24, 0.27, 0.15), 0.5 * moss);
        albedo = mix(albedo, vec3(dot(albedo, vec3(0.333))) * vec3(1.08, 0.98, 0.9), 0.3 * rAge);  // faded by the sun
        albedo *= 1.0 - 0.18 * rAge * smoothstep(0.5, 0.8, kk_fbm(rp * 0.18 + 1.0));                // dark weathering blotches
        rough = clamp(rough + 0.1 * rAge, 0.0, 1.0);`,
    });
    cache.set(key, m); return m;
  }

  function metalRoof(name, tintHex) {
    const key = 'metal:' + name; if (cache.has(key)) return cache.get(key);
    const m = triplanarMaterial({ set: metal, scale: metal.size, normalScale: 1.0, antiTile: 0.2, sharp: 8, tint: new THREE.Color(tintHex).multiplyScalar(1.4), metalness: 0.35, roughBase: 0.6, cacheKey: 'metal',
      extraVertex: BLD_VERT, vertexMain: BLD_VERT_MAIN, fragHead: BLD_FRAG,
      // v1.17: the paint chalks and peels, rust comes through at the laps and runs down the corrugations
      extraFrag: /* glsl */`
        float mAge = sqrt(kk_hash(kkBid * 5.17 + 1.3));
        vec2 mp = vWPos.xz;
        float rustP = smoothstep(0.75 - 0.25 * mAge, 0.85 - 0.25 * mAge, kk_fbm(mp * 0.7 + mod(kkBid, 41.0)));
        float runs = smoothstep(0.6, 0.9, kk_vn(vec2(dot(mp, vec2(0.7, 0.7)) * 9.0, 0.0) + vec2(0.0, mp.y * 0.2))) * mAge * 0.6;
        float rr = clamp(rustP + runs * 0.5, 0.0, 1.0);
        albedo = mix(albedo, vec3(0.42, 0.22, 0.12) * (0.8 + 0.4 * kk_vn(mp * 4.0)), rr * 0.85);
        albedo = mix(albedo, vec3(dot(albedo, vec3(0.333))) * 1.1, 0.35 * mAge * (1.0 - rr));   // chalky, sun-faded paint
        rough = mix(rough, 1.0, rr * 0.8);` });
    m.metalness = 0.3;
    cache.set(key, m); return m;
  }

  function plinth() {
    const key = 'plinth'; if (cache.has(key)) return cache.get(key);
    const m = triplanarMaterial({ set: concrete, scale: 2.5, normalScale: 0.9, antiTile: 0.4, sharp: 6, tint: new THREE.Color(0x9d9589), cacheKey: 'plinth',
      extraVertex: BLD_VERT, vertexMain: BLD_VERT_MAIN, fragHead: BLD_FRAG + 'uniform sampler2D tStoC, tStoN;', extraUniforms: { tStoC: { value: stone.c }, tStoN: { value: stone.n } },
      extraFrag: /* glsl */`
        float h1 = kk_hash(kkBid * 1.371);
        if (h1 < 0.3) { // many older houses sit on a rough stone plinth
          vec3 ps = vWPos * 0.5; albedo = kk_tri(tStoC, ps, kkW).rgb * 0.95; wN = kk_triNormal(tStoN, ps, kkW, kkN, 1.0); rough = 0.9;
        }
        float hAbove = vWPos.y - vBld.y;
        albedo *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.6, hAbove));
        // v1.17: damp patches and a crust of dried mud splashed up from the yard
        float pAge = sqrt(kk_hash(kkBid * 5.17 + 1.3));
        float pd = smoothstep(0.45, 0.75, kk_tri(tRgh, vWPos * 0.3 + 2.0, kkW).r) * pAge;
        albedo = mix(albedo, albedo * vec3(0.72, 0.7, 0.66), pd * 0.7);
        albedo = mix(albedo, vec3(0.45, 0.38, 0.3), (1.0 - smoothstep(0.0, 0.35, hAbove)) * 0.35 * pAge);`,
    });
    m.userData.plinthStone = { tStoC: stone.c, tStoN: stone.n };
    cache.set(key, m); return m;
  }

  function gardenWall() {
    const key = 'garden'; if (cache.has(key)) return cache.get(key);
    const m = triplanarMaterial({ set: rubble, scale: rubble.size, normalScale: 1.1, antiTile: 0.5, sharp: 6, tint: new THREE.Color(0xd8ccb8), cacheKey: 'garden',
      extraVertex: BLD_VERT, vertexMain: BLD_VERT_MAIN, fragHead: BLD_FRAG + 'uniform sampler2D tConC, tConN;', extraUniforms: { tConC: { value: concrete.c }, tConN: { value: concrete.n } },
      extraFrag: /* glsl */`
        float h1 = kk_hash(kkBid * 2.21 + 0.4);
        if (h1 > 0.55) { // rendered / concrete block garden walls
          vec3 pc = vWPos * 0.4; albedo = kk_tri(tConC, pc, kkW).rgb * vec3(1.0, 0.97, 0.9) * (0.85 + 0.3 * kk_hash(kkBid)); wN = kk_triNormal(tConN, pc, kkW, kkN, 0.7); rough = 0.9;
        }
        albedo *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.5, vWPos.y - vBld.y));`,
    });
    cache.set(key, m); return m;
  }

  function glass() {
    const key = 'glass'; if (cache.has(key)) return cache.get(key);
    const m = new THREE.MeshStandardMaterial({ color: 0x1a2229, roughness: 0.12, metalness: 0.0, envMapIntensity: 1.3 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.tNoise = { value: lib.tex('noise.jpg') };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nattribute vec2 aWuv; attribute vec2 aWsz; attribute vec4 aBld; varying vec2 vWuv; varying vec2 vWsz; varying vec4 vBld; varying vec3 vWPos;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvWuv = aWuv; vWsz = aWsz; vBld = aBld; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vWuv; varying vec2 vWsz; varying vec4 vBld; varying vec3 vWPos; uniform sampler2D tNoise;\n#define kkBid floor(vBld.x + 0.5)
          float kk_hash(float n) { return fract(sin(n) * 43758.5453123); }`)
        .replace('#include <map_fragment>', /* glsl */`
          // frame: 7 cm PVC/wood profile around the pane, a central mullion, and a 4 cm reveal shadow
          vec2 d = min(vWuv, 1.0 - vWuv) * vWsz;        // distance to the pane edge in metres
          float edge = min(d.x, d.y);
          float frame = 1.0 - smoothstep(0.055, 0.075, edge);
          float mullion = (vWsz.x > 0.9) ? (1.0 - smoothstep(0.02, 0.035, abs(vWuv.x - 0.5) * vWsz.x)) : 0.0;
          float transom = (vWsz.y > 1.35) ? (1.0 - smoothstep(0.02, 0.035, abs(vWuv.y - 0.62) * vWsz.y)) : 0.0;
          float fr = max(frame, max(mullion, transom));
          float wid = floor(vWPos.x * 1.7 + vWPos.z * 2.3 + vWPos.y * 0.7) + kkBid * 13.0;
          float hw = kk_hash(wid);
          // behind the glass: dark interior, drawn curtain, or lit room — varies per window
          vec3 interior = hw < 0.45 ? vec3(0.015, 0.02, 0.022) : hw < 0.8 ? vec3(0.42, 0.38, 0.3) * (0.7 + 0.5 * kk_hash(wid + 2.0)) : vec3(0.03, 0.035, 0.03);
          float curtainFold = 0.85 + 0.15 * sin(vWuv.x * 60.0 + hw * 10.0);
          interior *= hw >= 0.45 && hw < 0.8 ? curtainFold : 1.0;
          // reveal shading near the frame
          interior *= 0.6 + 0.4 * smoothstep(0.0, 0.08, edge - 0.07);
          float frameTone = 0.72 + 0.25 * kk_hash(kkBid * 0.91);
          vec3 frameCol = mix(vec3(frameTone), vec3(0.36, 0.25, 0.14), step(0.82, kk_hash(kkBid * 2.3))); // mostly white PVC, some dark wood
          // v1.17: frames yellow with the years; dust and dried rain spots gather on the lower half of the pane
          float gAge = sqrt(kk_hash(kkBid * 5.17 + 1.3));
          frameCol *= mix(vec3(1.0), vec3(0.97, 0.93, 0.82), gAge);
          diffuseColor.rgb = mix(interior, frameCol, fr);
          float kkDust = (1.0 - smoothstep(0.0, 0.7, vWuv.y)) * (0.12 + 0.3 * gAge) * (0.6 + 0.4 * texture2D(tNoise, vWuv * vWsz * 0.7 + kkBid * 0.37).r) * (1.0 - fr);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.39, 0.34), kkDust);
          float kkFrame = max(fr, kkDust * 1.5);`)
        .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(roughness, 0.6, kkFrame);`)
        .replace('#include <metalnessmap_fragment>', `float metalnessFactor = metalness;`);
    };
    m.customProgramCacheKey = () => 'kk_glass';
    cache.set(key, m); return m;
  }

  function door() {
    const key = 'door'; if (cache.has(key)) return cache.get(key);
    const m = triplanarMaterial({ set: wood, scale: 1.0, normalScale: 0.8, antiTile: 0.0, sharp: 8, tint: new THREE.Color(0x8a6a48), roughBase: 0.75, cacheKey: 'door',
      extraVertex: BLD_VERT, vertexMain: BLD_VERT_MAIN, fragHead: BLD_FRAG,
      extraFrag: /* glsl */`
        float h = kk_hash(kkBid * 4.1);
        // door colours seen in the region: varnished timber, dark green, grey or brown painted steel
        vec3 paint = h < 0.4 ? vec3(1.0) : h < 0.6 ? vec3(0.35, 0.55, 0.42) : h < 0.8 ? vec3(0.55, 0.57, 0.6) : vec3(0.5, 0.38, 0.3);
        albedo = h < 0.4 ? albedo : vec3(dot(albedo, vec3(0.33))) * paint * 1.3;
        rough = h < 0.4 ? rough : 0.45;
        // v1.17: sun-greyed varnish, chipped paint and rust along the bottom of an old door
        float dAge = sqrt(kk_hash(kkBid * 5.17 + 1.3));
        float low = 1.0 - smoothstep(0.0, 0.55, vWPos.y - vBld.y - 0.45);
        float chip = smoothstep(0.55, 0.62, kk_tri(tRgh, vWPos * 1.7 + 3.0, kkW).r) * dAge;
        albedo = mix(albedo, h < 0.4 ? vec3(0.42, 0.4, 0.37) : vec3(0.36, 0.22, 0.13), max(chip * 0.7, low * dAge * 0.6));
        albedo = mix(albedo, vec3(dot(albedo, vec3(0.333))) * 1.1, 0.3 * dAge);
        rough = mix(rough, 0.9, max(chip, low * dAge));`,
    });
    cache.set(key, m); return m;
  }

  function trim(tintHex = 0xe8e2d6) {
    const key = 'trim'; if (cache.has(key)) return cache.get(key);
    const m = triplanarMaterial({ set: plaster, scale: 2.0, normalScale: 0.5, antiTile: 0.3, sharp: 6, tint: new THREE.Color(tintHex), cacheKey: 'trim',
      extraVertex: BLD_VERT, vertexMain: BLD_VERT_MAIN, fragHead: BLD_FRAG,
      extraFrag: `albedo *= 0.9 + 0.2 * kk_hash(kkBid * 1.9); albedo *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 1.0, vWPos.y - vBld.y));
        float tAge = sqrt(kk_hash(kkBid * 5.17 + 1.3));
        albedo *= 1.0 - 0.3 * tAge * smoothstep(0.4, 0.75, kk_tri(tRgh, vWPos * 0.9 + 4.0, kkW).r);   // v1.17: grime on old sills and fascias
        albedo = mix(albedo, albedo * vec3(0.92, 0.88, 0.8), tAge);` });
    cache.set(key, m); return m;
  }

  function chimney() {
    const key = 'chimney'; if (cache.has(key)) return cache.get(key);
    const m = triplanarMaterial({ set: concrete, scale: 1.5, normalScale: 0.8, antiTile: 0.2, sharp: 8, tint: new THREE.Color(0x9c8a78), cacheKey: 'chimney',
      extraVertex: BLD_VERT, vertexMain: BLD_VERT_MAIN, fragHead: BLD_FRAG,
      extraFrag: `albedo *= 0.8 + 0.4 * kk_hash(kkBid * 2.7); albedo *= 1.0 - 0.45 * smoothstep(0.0, 0.6, vWPos.y - vBld.z + 0.9);` }); // soot at the crown
    cache.set(key, m); return m;
  }

  function ashlar(tint = 0xd9cdb6) {
    const key = 'ashlar' + tint; if (cache.has(key)) return cache.get(key);
    const m = triplanarMaterial({ set: stone, scale: stone.size, normalScale: 1.0, antiTile: 0.3, sharp: 8, tint: new THREE.Color(tint), cacheKey: 'ashlar',
      side: THREE.DoubleSide,
      extraFrag: /* glsl */`
        // centuries of weathering: uneven tone per block area, soot/dust streaks, and a dark damp band with
        // algae just above the reservoir level (water surface is y = 0), lighter mineral bloom higher up
        float blockVar = kk_tri(tRgh, vWPos * 0.21 + 2.0, kkW).r;
        albedo *= 0.82 + 0.36 * blockVar;
        float damp = 1.0 - smoothstep(0.2, 2.4, vWPos.y);
        albedo = mix(albedo, albedo * vec3(0.38, 0.42, 0.36), damp);
        float algae = (1.0 - smoothstep(0.6, 1.8, vWPos.y)) * smoothstep(0.3, 0.7, kk_tri(tRgh, vWPos * 0.9, kkW).r);
        albedo = mix(albedo, vec3(0.2, 0.27, 0.15), algae * 0.6);
        float streak = smoothstep(0.6, 0.9, texture2D(tRgh, vec2(vWPos.x * 0.35 + vWPos.z * 0.35, vWPos.y * 0.02)).r) * (1.0 - abs(kkN.y));
        albedo *= 1.0 - 0.22 * streak;
        rough = mix(rough, 0.35, damp * 0.7);` });
    cache.set(key, m); return m;
  }

  /** Map a Blender material name to its realistic replacement (or null to keep the original). */
  return function pick(name, original) {
    if (name in WALL_TINTS) return facade(name, WALL_TINTS[name]);
    if (name in ROOF_TINTS) return roofTiles(name, ROOF_TINTS[name]);
    if (name === 'Cati_Sac_Mavi') return metalRoof(name, 0x3a5a8a);
    if (name === 'Cati_Sac_Gri') return metalRoof(name, 0x8b9398);
    if (name === 'Subasman') return plinth();
    if (name === 'Bahce_Duvari') return gardenWall();
    if (name === 'Cam') return glass();
    if (name === 'Kapi') return door();
    if (name === 'Beyaz_Silme') return trim();
    if (name === 'Baca') return chimney();
    if (name === 'Kesme_Tas' || name === 'Kesme_Tas_Golge') return ashlar(name === 'Kesme_Tas' ? 0xd6c9b0 : 0xbfb29a);
    if (name === 'Metal_Korkuluk') { original.color.setHex(0x3a3d40); original.roughness = 0.55; original.metalness = 0.6; return original; }
    if (name === 'Gunes_Paneli') { original.color.setHex(0x0b1a2e); original.roughness = 0.2; original.metalness = 0.4; original.envMapIntensity = 1.0; return original; }
    if (name === 'Kursun_Kubbe') { original.color.setHex(0x6d7478); original.roughness = 0.5; original.metalness = 0.55; original.envMapIntensity = 0.8; return original; }
    if (name === 'Ahsap') return door();
    return null;
  };
}
