// v1.10 Çeşnigir park (Nov 2026): the east end of the Çeşnigir Bridge as the owner's photograph from the wooden
// stairs on the hill shows it, laid out on the Google satellite image (Airbus / Maxar, Nov 2026).
//
//   - the granite tor at the bridge's east end, built of stacked, weathered blocks, with the wooden viewing deck on
//     top and a smaller steel-and-timber platform hanging over the water on its north end
//   - the stone pillar standing on its own beside the tor, and the cut-stone building on the point by the roundabout
//   - the park east of the tor: it was open water in the v0.6 terrain, the satellite shows dry land (lawn, a paved
//     promenade along the foot of the tor, the access road, the round plaza with its lawn circle), held by a stone
//     quay wall with a green railing; lamp posts, benches and trees (pines, poplars, autumn-yellow trees)
//   - the pier and the floating boat-café at the north end of the plaza
//   - the wooden stairs (new honey-coloured pine) that come down the hill east of the park, where the photo is taken
//   - the canyon walls north of the bridge clad in blocky dark-grey granite instead of smooth tan slopes
// The canyon water north of the bridge is green in the photograph (algae); see waterMaterial in surfaces.js.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeoBatch, box, cyl, ribbon } from './geo.js';
import { triplanarMaterial } from './pbr.js';
import { buildProps } from './props.js';
import { mulberry32 } from './village_layout.js';

// ------------------------------------------------------------------------------------------------ layout (metres)
// Model frame: x east, z south, y up, the reservoir at y = 0. Georeferenced on the bridge (docs/survey/georef.json).
export const BRIDGE = { w: [-432, -268], e: [-322, -296] };
// the tor (rock outcrop) north of the bridge's east end
export const ROCK = [[-327, -303], [-312, -301], [-299, -303], [-293, -309], [-290, -320], [-288, -333], [-287.5, -344], [-291, -354], [-297, -360.5], [-306, -358], [-315, -352], [-322, -344], [-326.5, -330], [-328.5, -314]];
const PEAKS = [ // x, z, top, radius
  [-296, -336, 17.0, 10], [-307, -341, 14.5, 8], [-303, -322, 12.5, 9], [-314, -309, 9.5, 8], [-297, -350, 11.5, 7], [-320, -328, 10.0, 7], [-292, -313, 8.0, 6],
];
// the park east of the tor: the v0.6 terrain had a water inlet here
export const PARK = [[-290, -309], [-289, -322], [-287.8, -334], [-287.6, -345], [-289.5, -352], [-288, -358], [-284, -366], [-283, -371], [-272.5, -375.5], [-262, -381.5], [-252, -384], [-246, -381.5], [-246.5, -350], [-245.5, -330], [-246.5, -312], [-262, -305.5], [-280, -304.5]];
export const parkLevel = (x) => 3.6 + 0.9 * Math.min(1, Math.max(0, (x + 285) / 38));
const PLAZA = [[-322, -303], [-322, -290.5], [-304, -286.5], [-289, -287.5], [-285.5, -296], [-289.5, -304.5], [-306, -304]];   // bridge-end plaza (paving grid on the satellite)
const ROUND = [[-280, -356], [-275, -350], [-262, -347.5], [-249.5, -348.5], [-248, -366], [-248.5, -379.5], [-253, -382.5], [-262, -380], [-271.5, -374.5], [-281, -369.5]];   // the round plaza
const ROUND_LAWN = { x: -255.5, z: -359.3, r: 4.6 };
const PROMENADE = [[-292, -300], [-288.5, -312], [-285.6, -324], [-283.3, -336], [-280.4, -347], [-274, -352.5]];   // along the foot of the tor
const ACCESS = [[-272, -290], [-264, -302], [-258.5, -316], [-255.5, -332], [-254.5, -348.5]];                      // from the village road up to the round plaza
const QUAY = [[-287.6, -345], [-289.5, -352], [-288, -358], [-284, -366], [-283.2, -371], [-272.5, -375.8], [-262, -381.8], [-252, -384.2], [-245, -381.5]];
const DECK = { x: -295.6, z: -337.2, y: 17.7, w: 7.2, d: 10.4, yaw: 0.08 };            // viewing deck on the tor
const LOWER = { x: -287.4, z: -350.0, y: 7.6, w: 7.4, d: 7.0, yaw: 0.12 };            // the lower terrace on the quay, green railing (satellite: square roof)
const PILLAR = { x: -279.6, z: -365.2, top: 13.2 };                                    // the rock pillar on the point
const HOUSE = { x: -264.6, z: -373.4, w: 7.6, d: 6.4, yaw: -0.82, h: 3.4 };             // cut-stone gatehouse on the quay by the pier
const PIER = { a: [-254.8, -382.5], b: [-260.6, -391.4] };                            // walkway to the floating café
// wooden stairs down the hill east of the park (the photo is taken on them)
export const STAIRS = [[-212.0, -352.0], [-221.0, -345.0], [-229.0, -347.5], [-236.0, -342.0], [-244.4, -337.0]];
export const PHOTO_VIEW = { p: [-212.0, 35.0, -352.0], t: [-307.0, 3.8, -353.3] };   // standing on the top landing

// ------------------------------------------------------------------------------------------------ helpers
export function inPoly(x, z, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; }
  return c;
}
function polyEdgeDist(x, z, P) {
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ax = P[j][0], az = P[j][1], dx = P[i][0] - ax, dz = P[i][1] - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
const segDist = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
const lineDist = (x, z, L) => { let d = Infinity; for (let i = 0; i + 1 < L.length; i++) d = Math.min(d, segDist(x, z, L[i], L[i + 1])); return d; };

/** Triangulated polygon, subdivided to `step` metres and draped on the ground. */
function drape(poly, yAt, lift, step = 2.0) {
  const pts = poly.map(([x, z]) => new THREE.Vector2(x, z));
  const faces = THREE.ShapeUtils.triangulateShape(pts, []);
  const out = [];
  const split = (a, b, c, depth) => {
    const ab = a.distanceTo(b), bc = b.distanceTo(c), ca = c.distanceTo(a), m = Math.max(ab, bc, ca);
    if (m <= step || depth > 9) { out.push(a, b, c); return; }
    if (m === ab) { const p = a.clone().lerp(b, 0.5); split(a, p, c, depth + 1); split(p, b, c, depth + 1); }
    else if (m === bc) { const p = b.clone().lerp(c, 0.5); split(a, b, p, depth + 1); split(a, p, c, depth + 1); }
    else { const p = c.clone().lerp(a, 0.5); split(a, b, p, depth + 1); split(p, b, c, depth + 1); }
  };
  for (const f of faces) split(pts[f[0]], pts[f[1]], pts[f[2]], 0);
  const pos = new Float32Array(out.length * 3);
  out.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = yAt(p.x, p.y) + lift; pos[i * 3 + 2] = p.y; });
  let g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // make the winding face up
  for (let i = 0; i < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i], uz = pos[i + 5] - pos[i + 2], vx = pos[i + 6] - pos[i], vz = pos[i + 8] - pos[i + 2];
    if (ux * vz - uz * vx > 0) for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
  }
  g = mergeVertices(g, 0.01); g.computeVertexNormals();
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);
/** A box from point a to point b (world), cross-section w (horizontal) x h. */
function beam(a, b, w, h) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
  const xA = d.clone().divideScalar(L || 1); let zA = new THREE.Vector3().crossVectors(xA, _up); if (zA.lengthSq() < 1e-6) zA.set(0, 0, 1); zA.normalize();
  const yA = new THREE.Vector3().crossVectors(zA, xA);
  const g = new THREE.BoxGeometry(L, h, w); g.applyMatrix4(new THREE.Matrix4().makeBasis(xA, yA, zA)); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return g;
}
/** Vertical post from y0 to y1. */
const post = (x, z, y0, y1, s = 0.1) => box(s, y1 - y0, s, x, (y0 + y1) / 2, z);
/** World-placed copy of a local geometry: rotate by yaw, move to (x, y, z). */
function place(g, x, y, z, yaw = 0) { g.rotateY(yaw); g.translate(x, y, z); return g; }

// weathered granite blocks: rounded boxes ("woolsack" weathering) with a little noise, a few variants
function hashf(a, b, c) { const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return s - Math.floor(s); }
function blockVariants(n, seg, r0 = 0.24) {
  const out = [];
  for (let v = 0; v < n; v++) {
    let g = new THREE.BoxGeometry(1, 1, 1, seg, seg, seg); g.deleteAttribute('uv'); g.deleteAttribute('normal');
    const p = g.attributes.position, r = r0 + 0.08 * (v % 3) / 2;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const qx = Math.max(-0.5 + r, Math.min(0.5 - r, x)), qy = Math.max(-0.5 + r, Math.min(0.5 - r, y)), qz = Math.max(-0.5 + r, Math.min(0.5 - r, z));
      let dx = x - qx, dy = y - qy, dz = z - qz; const L = Math.hypot(dx, dy, dz);
      let nx = x, ny = y, nz = z; if (L > 1e-6) { nx = qx + dx / L * r; ny = qy + dy / L * r; nz = qz + dz / L * r; }
      const k = 1 + (hashf(Math.round(x * 8) + v * 7, Math.round(y * 8), Math.round(z * 8)) - 0.5) * 0.14;
      p.setXYZ(i, nx * k, ny * k * (y < -0.45 ? 1 : 1), nz * k);
    }
    g = mergeVertices(g, 1e-4); g.computeVertexNormals();
    out.push(g);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ terrain
// The v0.6 canyon runs due north from the bridge; on the satellite it turns north-east at the pier (the river label
// runs at ~45°), so it passes north of the hill with the stairs — the photo looks over that hill's shoulder across the
// green water to the cliffs of the far bank. The ground (and the old boulders and trees on it) north of the park is
// slid east by `canyonShift`, ramping in from the quay, fading out at the band's edges.
const sstep = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
export function canyonShift(x, z) {
  const zA = -376 + 24 * sstep(-285, -248, x);   // starts at the quay west of the park, closer to the stairs east of it
  const off = 38 * sstep(zA, zA - 62, z) * (1 - sstep(-640, -860, z));
  return off * sstep(-490, -420, x) * (1 - sstep(-212, -150, x));
}
/** Slides the vertices of a mesh (boulders, trees) with the canyon. */
export function shearMesh(mesh) {
  if (!mesh || !mesh.isMesh) return 0;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld, inv = m.clone().invert(), g = mesh.geometry, src = g.attributes.position, v = new THREE.Vector3();
  const pos = new Float32Array(src.count * 3); let n = 0;
  for (let i = 0; i < src.count; i++) {
    v.fromBufferAttribute(src, i).applyMatrix4(m); const s = canyonShift(v.x, v.z);
    if (s !== 0) { v.x += s; n++; }
    v.applyMatrix4(inv); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  if (!n) return 0;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeBoundingBox(); g.computeBoundingSphere();
  return n;
}
/**
 * Fills the water inlet east of the tor (the park) and the water under the tor's footprint in the terrain grid.
 * Call on D.grid before the height array is copied; returns node index -> new height, for syncTerrainMesh.
 */
export function editCesnigirTerrain(grid) {
  const { x0, z0, size, seg } = grid, cs = size / seg, W1 = seg + 1, changed = new Map();
  // 1) the park and the ground under the tor
  for (let j = 0; j <= seg; j++) {
    const z = z0 + j * cs; if (z < -400 || z > -280) continue;
    for (let i = 0; i <= seg; i++) {
      const x = x0 + i * cs; if (x < -345 || x > -239) continue;
      const k = i + W1 * j, h = grid.h[k];
      let t = null;
      if (inPoly(x, z, PARK) || (x > -246 && z < -312 && z > -382 && inPoly(x - 4, z, PARK))) t = parkLevel(x);   // incl. the node row just east of the edge, so no hill pokes through the lawn
      else if (inPoly(x, z, ROCK) && h < 2.5) t = 2.5;
      else if (polyEdgeDist(x, z, PARK) < 3.5 && h < 0 && !inPoly(x, z, ROCK)) t = Math.min(h, -1.5);   // a clean, deep edge in front of the quay
      if (t !== null && Math.abs(t - h) > 0.01) { grid.h[k] = t; changed.set(k, t); }
    }
  }
  // 2) the canyon bend: resample the (filled) heights from where the ground came from; the park and the tor stay
  const old = Float32Array.from(grid.h);
  const oldAt = (x, z) => { const fx = Math.min(seg - 1e-3, Math.max(0, (x - x0) / cs)), fz = Math.min(seg - 1e-3, Math.max(0, (z - z0) / cs)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return (old[i + W1 * j] * (1 - u) + old[i + 1 + W1 * j] * u) * (1 - v) + (old[i + W1 * (j + 1)] * (1 - u) + old[i + 1 + W1 * (j + 1)] * u) * v; };
  for (let j = 0; j <= seg; j++) {
    const z = z0 + j * cs; if (z > -340 || z < -870) continue;
    for (let i = 0; i <= seg; i++) {
      const x = x0 + i * cs, s = canyonShift(x, z); if (s === 0 || inPoly(x, z, PARK) || inPoly(x, z, ROCK)) continue;
      const k = i + W1 * j, t = oldAt(x - s, z);
      if (Math.abs(t - grid.h[k]) > 0.01) { grid.h[k] = t; changed.set(k, t); }
    }
  }
  return changed;
}
/** Applies the edited grid heights to the GLB terrain mesh (its vertices sit on the same 8 m grid). */
export function syncTerrainMesh(mesh, grid, changed) {
  if (!mesh || !changed.size) return 0;
  const { x0, z0, size, seg } = grid, cs = size / seg, W1 = seg + 1;
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld, inv = m.clone().invert(), g = mesh.geometry, src = g.attributes.position, v = new THREE.Vector3();
  const pos = new Float32Array(src.count * 3); let n = 0;
  const uvA = g.attributes.uv, uv = uvA ? new Float32Array(uvA.count * 2) : null;
  for (let i = 0; i < src.count; i++) {
    v.fromBufferAttribute(src, i);
    const w = v.clone().applyMatrix4(m);
    // the macro (satellite-style) texture slides with the ground: u is linear in x over the grid
    if (uv) { uv[i * 2] = uvA.getX(i) - canyonShift(w.x, w.z) / size; uv[i * 2 + 1] = uvA.getY(i); }
    const fi = (w.x - x0) / cs, fj = (w.z - z0) / cs, ii = Math.round(fi), jj = Math.round(fj);
    if (Math.abs(fi - ii) < 0.03 && Math.abs(fj - jj) < 0.03) { const k = ii + W1 * jj; if (changed.has(k)) { w.y = changed.get(k); v.copy(w.applyMatrix4(inv)); n++; } }
    else if (canyonShift(w.x, w.z) !== 0 || (w.x > -345 && w.x < -239 && w.z > -400 && w.z < -280)) {   // a vertex between grid nodes (decimated mesh)
      const i0 = Math.floor(fi), j0 = Math.floor(fj), u = fi - i0, t = fj - j0, H = grid.h;
      w.y = (H[i0 + W1 * j0] * (1 - u) + H[i0 + 1 + W1 * j0] * u) * (1 - t) + (H[i0 + W1 * (j0 + 1)] * (1 - u) + H[i0 + 1 + W1 * (j0 + 1)] * u) * t;
      v.copy(w.applyMatrix4(inv)); n++;
    }
    pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.deleteAttribute('normal'); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return n;
}
/** The old v0.6 deck on the rock and the pier with its tour boat in the wrong place: rebuilt here. */
export function pruneCesnigir(model) {
  let n = 0;
  for (const name of ['Seyir_Kayasi_Terasi', 'Iskele']) { const o = model.getObjectByName(name); if (o) { o.removeFromParent(); n++; } }
  model.updateMatrixWorld(true);
  for (const name of ['Granit_Kayalar', 'Agaclar_Yaprak', 'Agaclar_Govde']) shearMesh(model.getObjectByName(name));
  n += clearBoulders(model.getObjectByName('Granit_Kayalar'));
  return n;
}
/** Drops the old boulders (connected pieces of the merged rock mesh) that sit on the stairs, in the park or on the tor. */
function clearBoulders(m) {
  if (!m || !m.isMesh) return 0;
  m.updateWorldMatrix(true, false);
  const g = m.geometry, pos = g.attributes.position, idx = g.index ? g.index.array : null, nTri = idx ? idx.length / 3 : pos.count / 3, nV = pos.count;
  const par = new Int32Array(nV); for (let i = 0; i < nV; i++) par[i] = i;
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const seen = new Map();
  const w = new THREE.Vector3();
  for (let i = 0; i < nV; i++) { w.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); const k = `${Math.round(w.x * 50)},${Math.round(w.y * 50)},${Math.round(w.z * 50)}`; const j = seen.get(k); if (j === undefined) seen.set(k, i); else par[find(i)] = find(j); }
  const vi = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  for (let t = 0; t < nTri; t++) { const a = find(vi(t, 0)); par[find(vi(t, 1))] = a; par[find(vi(t, 2))] = a; }
  const comp = new Map(), v = new THREE.Vector3();
  for (let i = 0; i < nV; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); const r = find(i); let c = comp.get(r); if (!c) comp.set(r, c = { x: 0, z: 0, n: 0, x0: 1e9, x1: -1e9 }); c.x += v.x; c.z += v.z; c.n++; c.x0 = Math.min(c.x0, v.x); c.x1 = Math.max(c.x1, v.x); }
  const drop = new Set();
  for (const [r, c] of comp) { const x = c.x / c.n, z = c.z / c.n, rad = (c.x1 - c.x0) / 2; if (x < -360 || x > -180 || z < -400 || z > -280) continue;
    if (lineDist(x, z, STAIRS) < rad + 1.4 || inPoly(x, z, PARK) || inPoly(x, z, ROCK) || inPoly(x, z, PLAZA)) drop.add(r); }
  if (!drop.size) return 0;
  const keep = []; for (let t = 0; t < nTri; t++) if (!drop.has(find(vi(t, 0)))) keep.push(vi(t, 0), vi(t, 1), vi(t, 2));
  g.setIndex(keep); g.computeBoundingSphere(); g.computeBoundingBox();
  return drop.size;
}
/** Walkable / no-grass samples ([x, z, y, hw, ...], data4 road format) for the park, plazas and the pier. */
export function cesnigirSamples(terrH) {
  const out = [];
  for (let z = -386; z <= -284; z += 2) for (let x = -324; x <= -244; x += 2) if (inPoly(x, z, PARK) || inPoly(x, z, PLAZA)) out.push(x, z, terrH(x, z) + 0.08, 1.45);
  const [a, b] = [PIER.a, PIER.b];
  for (let t = 0; t <= 1.0001; t += 0.1) out.push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 4.6 + (1.55 - 4.6) * t, 1.2);
  return out;
}
/** Collision boxes ([x, z, yaw, hw, hd, ...]) for the pillar and the stone building. */
export function cesnigirBoxes() {
  return [PILLAR.x, PILLAR.z, 0, 2.2, 2.0, HOUSE.x, HOUSE.z, HOUSE.yaw, HOUSE.w / 2, HOUSE.d / 2, LOWER.x, LOWER.z, LOWER.yaw, LOWER.w / 2, LOWER.d / 2];
}

// ------------------------------------------------------------------------------------------------ materials
function cesnigirMaterials(lib, M) {
  const rock = lib.set('rock'), stone = lib.set('stone_wall'), wood = lib.set('wood');
  const std = (o) => new THREE.MeshStandardMaterial(o);
  // dark-grey weathered granite: the canyon walls and the tor are grey with black lichen and pale crusts (photo)
  const granite = triplanarMaterial({ set: rock, scale: rock.size * 0.55, normalScale: 1.15, antiTile: 0.5, sharp: 4, tint: new THREE.Color(0xcac6be), roughBase: 0.95, cacheKey: 'cs_granite',
    extraFrag: /* glsl */`
      float gl = dot(albedo, vec3(0.33)); albedo = mix(albedo, vec3(gl), 0.6) * 0.98;
      float speck = kk_tri(tRgh, vWPos * 2.1, kkW).r; albedo *= 1.0 - 0.32 * smoothstep(0.6, 0.82, speck);
      float lich = smoothstep(0.6, 0.78, kk_tri(tRgh, vWPos * 0.38 + 7.0, kkW).r); albedo = mix(albedo, vec3(0.11, 0.11, 0.1), lich * 0.6);
      float crust = smoothstep(0.58, 0.82, kk_tri(tRgh, vWPos * 0.17 + 2.0, kkW).r) * smoothstep(0.0, 0.7, kkN.y); albedo = mix(albedo, vec3(0.74, 0.72, 0.66), crust * 0.4);
      float wet = 1.0 - smoothstep(-0.2, 0.9, vWPos.y); albedo *= 1.0 - 0.35 * wet;
      albedo *= 0.78 + 0.26 * smoothstep(-0.3, 0.9, kkN.y);` });
  const cutStone = triplanarMaterial({ set: stone, scale: stone.size, normalScale: 0.9, antiTile: 0.3, sharp: 8, tint: new THREE.Color(0xc8c4ba), roughBase: 0.95, cacheKey: 'cs_cutstone',
    extraFrag: 'albedo = mix(albedo, vec3(dot(albedo, vec3(0.33))), 0.5) * 1.15; albedo *= 0.88 + 0.24 * kk_tri(tRgh, vWPos * 0.21 + 2.0, kkW).r; albedo *= 1.0 - 0.35 * (1.0 - smoothstep(-0.3, 0.8, vWPos.y));' });
  // new pine (the stairs in the photo are honey yellow), weathered brown boards on the old deck
  const pine = triplanarMaterial({ set: wood, scale: 1.0, normalScale: 0.6, antiTile: 0.0, sharp: 8, tint: new THREE.Color(0xffffff), roughBase: 0.8, cacheKey: 'cs_pine',
    extraFrag: 'albedo = vec3(dot(albedo, vec3(0.33))) * vec3(1.75, 1.28, 0.7);' });
  const deckWood = triplanarMaterial({ set: wood, scale: 1.0, normalScale: 0.8, antiTile: 0.0, sharp: 8, tint: new THREE.Color(0x8a6a4c), roughBase: 0.9, cacheKey: 'cs_deckwood' });
  const greenRail = std({ color: 0x2f6a3c, roughness: 0.5, metalness: 0.35 });
  const lampBlack = std({ color: 0x1e2022, roughness: 0.45, metalness: 0.6 });
  const lampGlass = std({ color: 0xf4ead2, emissive: 0xffe2a8, emissiveIntensity: 0.25, roughness: 0.2 });
  const hull = std({ color: 0xe9e7e1, roughness: 0.45 });
  const canopy = std({ color: 0x2f5f9e, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide });
  const pv = lib.set('paving'), pavers = triplanarMaterial({ set: pv, scale: pv.size, normalScale: 0.8, antiTile: 0.3, sharp: 8, tint: new THREE.Color(0xe4e0d6), roughBase: 0.9, cacheKey: 'cs_pavers', extraFrag: 'albedo = mix(albedo, vec3(dot(albedo, vec3(0.33))), 0.6) * 1.15;' });
  // watered park lawn, brighter than the village greens (no polygon offset: the paving lies on top of it)
  const grass = lib.set('grass_dry');
  const lawn = triplanarMaterial({ set: grass, scale: 1.1, normalScale: 0.5, antiTile: 0.5, sharp: 8, tint: new THREE.Color(0x86b048), roughBase: 1.0, cacheKey: 'cs_lawn',
    extraFrag: 'albedo = mix(albedo, vec3(dot(albedo, vec3(0.33))), 0.5) * vec3(0.85, 1.25, 0.55); albedo *= 0.85 + 0.25 * kk_tri(tRgh, vWPos * 0.21, kkW).r;' });
  return { ...M, csGranite: granite, csStone: cutStone, csPine: pine, csDeck: deckWood, csRail: greenRail, csLampBlack: lampBlack, csLampGlass: lampGlass, csHull: hull, csCanopy: canopy, csPavers: pavers, csLawn: lawn };
}

// ------------------------------------------------------------------------------------------------ build
export function buildCesnigir(ctx, M0) {
  const { terrH } = ctx, quality = ctx.quality ?? 2;
  const M = cesnigirMaterials(ctx.lib, M0);
  const group = new THREE.Group(); group.name = 'Cesnigir_Park';
  const bat = new GeoBatch(), rnd = mulberry32(1903);
  const yAt = (x, z) => terrH(x, z);
  const BLK = blockVariants(6, 4, 0.2), BLK_LO = blockVariants(6, 3, 0.1);
  const addBlock = (variants, x, y0, y1, z, sx, sz, yaw, tilt = 0) => {
    const g = variants[Math.floor(rnd() * variants.length)].clone();
    g.scale(sx, y1 - y0, sz); if (tilt) g.rotateX(tilt); g.rotateY(yaw); g.translate(x, (y0 + y1) / 2, z);
    bat.add('csGranite', g);
  };
  const inDeck = (x, z, P, m) => { const c = Math.cos(P.yaw), s = Math.sin(P.yaw), dx = x - P.x, dz = z - P.z, lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < P.w / 2 + m && Math.abs(lz) < P.d / 2 + m; };

  // ---- the tor: stacked blocks over the footprint, tops after the peaks, cleared under the two platforms --------
  const topAt = (x, z) => { let t = 3.5; for (const [px, pz, h, r] of PEAKS) { const d = Math.hypot(x - px, z - pz) / r; if (d < 1.45) t = Math.max(t, h * (1 - 0.42 * d * d)); } return t; };
  let nTor = 0;
  for (let z = -362; z <= -299; z += 3.0) for (let x = -330; x <= -282; x += 3.0) {
    const jx = x + (rnd() - 0.5) * 2.2, jz = z + (rnd() - 0.5) * 2.2;
    // inside the footprint, or the foot of the old mound's steep face where it runs out into the park
    if (!inPoly(jx, jz, ROCK) && !(polyEdgeDist(jx, jz, ROCK) < 4.5 && terrH(jx, jz) > parkLevel(jx) + 1.0)) continue;
    const g0 = terrH(jx, jz), edge = polyEdgeDist(jx, jz, ROCK);
    let gMax = g0; for (const [ox, oz] of [[2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2], [1.6, 1.6], [-1.6, 1.6], [1.6, -1.6], [-1.6, -1.6]]) gMax = Math.max(gMax, terrH(jx + ox, jz + oz));
    let top = Math.max(topAt(jx, jz) * (0.55 + 0.45 * Math.min(1, edge / 5)), gMax + 0.9) + (rnd() - 0.2) * 1.2;   // the smooth v0.6 mound stays covered
    if (inDeck(jx, jz, DECK, 2.6)) top = Math.min(top, DECK.y - 0.35);
    if (inDeck(jx, jz, LOWER, 2.4)) top = Math.min(top, LOWER.y - 0.4);
    const base = Math.min(g0, 0) - 1.2;
    const yaw = 0.35 + (rnd() - 0.5) * 0.5;
    // horizontal sheeting joints: tall columns are 2–3 blocks, each a little smaller and shifted
    const tiers = top - base > 11 ? 3 : top - base > 5.5 ? 2 : 1; let y = base;
    for (let k = 0; k < tiers; k++) {
      const y1 = k === tiers - 1 ? top : y + (top - base) / tiers + (rnd() - 0.5) * 1.0;
      const s = 1 - k * 0.12; addBlock(BLK, jx + (rnd() - 0.5) * 0.8 * k, y - 0.25, y1, jz + (rnd() - 0.5) * 0.8 * k, (4.2 + rnd() * 2.2) * s, (3.8 + rnd() * 2.2) * s, yaw + (rnd() - 0.5) * 0.2, (rnd() - 0.5) * 0.06);
      y = y1; nTor++;
    }
    // a rounded capstone on some of the high points (the woolsack boulders on top of the tor in the photo)
    if (top > 9 && rnd() < 0.3 && !inDeck(jx, jz, DECK, 3.2) && !inDeck(jx, jz, LOWER, 3)) { const r = 1.2 + rnd() * 1.4; addBlock(BLK, jx + (rnd() - 0.5), top - 0.5, top + r * 1.3, jz + (rnd() - 0.5), r * 1.9, r * 1.6, rnd() * 3); nTor++; }
  }
  // the pillar: a free-standing stack of three blocks by the quay
  { const P = PILLAR; let y = -1.6; const hs = [5.6, 4.6, P.top - 10.2 + 1.6];
    hs.forEach((h, k) => { addBlock(BLK, P.x + (k === 1 ? 0.35 : k === 2 ? -0.2 : 0), y - 0.15, y + h, P.z + (k === 2 ? 0.25 : 0), 4.4 - k * 0.45, 4.0 - k * 0.35, 0.3 + k * 0.12); y += h; });
    addBlock(BLK, P.x - 0.4, P.top - 0.3, P.top + 1.3, P.z + 0.3, 2.4, 2.0, 1.1); }

  // ---- canyon walls north of the bridge: blocky granite on the steep slopes (both banks) ------------------------
  const keep = (x, z) => inPoly(x, z, PARK) || polyEdgeDist(x, z, PARK) < 4 || inPoly(x, z, ROCK) || polyEdgeDist(x, z, ROCK) < 3 || segDist(x, z, BRIDGE.w, BRIDGE.e) < 14 || Math.hypot(x + 264, z + 396) < 14 || lineDist(x, z, STAIRS) < 9;
  const slopeAt = (x, z) => { const e = 2, dx = terrH(x + e, z) - terrH(x - e, z), dz = terrH(x, z + e) - terrH(x, z - e); return [Math.hypot(dx, dz) / (2 * e), dx, dz]; };
  const B = ctx.D.buildings, nearBld = (x, z) => { for (let k = 0; k < B.length; k += 5) if (Math.abs(B[k] - x) < B[k + 3] + 8 && Math.abs(B[k + 1] - z) < B[k + 4] + 8) return true; return false; };
  const step = quality >= 2 ? 4.2 : 5.6; let nCliff = 0;
  for (let z = -780; z < -292; z += step) for (let x = -470; x < -228; x += step) {
    const jx = x + (rnd() - 0.5) * step * 0.7, jz = z + (rnd() - 0.5) * step * 0.7;
    if (-28 * (jx + 432) - 110 * (jz + 268) < 0) continue;       // south of the bridge line: the open lake shore and the village side
    const h = terrH(jx, jz); if (h < -2.5 || h > 50) continue;
    const [s, gx, gz] = slopeAt(jx, jz); if (s < 0.5) continue;
    if (keep(jx, jz) || nearBld(jx, jz)) continue;
    if (jz > -374 && jx > -262) continue;                       // the hill round the stairs: tan slope and loose boulders (photo foreground)
    const steep = Math.min(1, (s - 0.5) / 0.7);
    const contour = Math.atan2(gz, gx) + Math.PI / 2;           // long side along the contour, like the jointed walls
    const big = rnd() < 0.25 ? 1.6 : 1.0, sx = (3.0 + rnd() * 4.5 + steep * 3.0) * big, sz = (2.6 + rnd() * 3.0) * big, hh = (2.5 + rnd() * 3.5 + steep * 6.5) * (rnd() < 0.3 ? 1.5 : 1.0);
    const y0 = h - hh * (0.45 + 0.15 * rnd());
    addBlock(BLK_LO, jx, y0, y0 + hh, jz, sx, sz, -contour + (rnd() - 0.5) * 0.9, (rnd() - 0.5) * 0.35); nCliff++;
    if (steep > 0.5 && rnd() < 0.35) { const up = Math.hypot(gx, gz) || 1, ux = -gx / up, uz = -gz / up, h2 = 1.6 + rnd() * 2.4; addBlock(BLK_LO, jx + ux * 1.5, y0 + hh - 0.4, y0 + hh + h2, jz + uz * 1.5, sx * 0.7, sz * 0.8, -contour + (rnd() - 0.5) * 0.5); nCliff++; }
  }

  // ---- ground: lawn over the park, paving on the plazas and paths ------------------------------------------------
  bat.add('csLawn', drape(PARK, yAt, 0.07, 2.0));
  bat.add('csPavers', drape(PLAZA, yAt, 0.12, 2.0));
  bat.add('csPavers', drape(ROUND, yAt, 0.13, 2.0));
  const circ = []; for (let i = 0; i < 28; i++) { const a = i / 28 * Math.PI * 2; circ.push([ROUND_LAWN.x + Math.cos(a) * ROUND_LAWN.r, ROUND_LAWN.z + Math.sin(a) * ROUND_LAWN.r]); }
  bat.add('csLawn', drape(circ, yAt, 0.24, 1.2));
  for (let i = 0; i < 28; i++) { const a = circ[i], b = circ[(i + 1) % 28]; bat.add('coping', beam([a[0], yAt(...a) + 0.17, a[1]], [b[0], yAt(...b) + 0.17, b[1]], 0.25, 0.22)); }
  const path = (line, w, lift) => {
    const hw = w / 2, prof = [{ u: -hw - 0.2, dy: lift - 0.04 }, { u: -hw, dy: lift + 0.03 }, { u: hw, dy: lift + 0.03 }, { u: hw + 0.2, dy: lift - 0.04 }];
    const pts = []; for (let i = 0; i + 1 < line.length; i++) { const a = line[i], b = line[i + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2); for (let k = 0; k < n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    pts.push(line[line.length - 1]);
    bat.add('csPavers', ribbon(pts, prof, (x, z) => yAt(x, z)));
    // white kerb stones along both edges
    for (const side of [-1, 1]) { const kp = [{ u: side * (hw + 0.02), dy: lift + 0.13 }, { u: side * (hw + 0.2), dy: lift + 0.13 }]; bat.add('coping', ribbon(pts, side > 0 ? kp : kp.reverse(), yAt)); }
    return pts;
  };
  const promPts = path(PROMENADE, 5.6, 0.12);
  path(ACCESS, 5.0, 0.12);

  // ---- quay wall with a green railing, the stone building on the point --------------------------------------------
  const runs = []; let cur = []; for (const p of QUAY) { if (!p) { runs.push(cur); cur = []; } else cur.push(p); } runs.push(cur);
  for (const run of runs) for (let i = 0; i + 1 < run.length; i++) {
    const a = run[i], b = run[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), nx = dz / L, nz = -dx / L;   // outward (towards the water)
    const top = (x) => parkLevel(x) + 0.35;
    const g = beam([a[0] + nx * 0.4, 0, a[1] + nz * 0.4], [b[0] + nx * 0.4, 0, b[1] + nz * 0.4], 0.9, 1); // unit height, scaled below
    g.computeBoundingBox(); const yTop = Math.max(top(a[0]), top(b[0])), yBot = -2.0;
    g.translate(0, -0.5, 0); g.scale(1, 1, 1);
    const p = g.attributes.position; for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) > -0.5 ? yTop : yBot);
    g.computeVertexNormals(); bat.add('csStone', g);
    // coping and the railing
    bat.add('coping', beam([a[0] + nx * 0.4, yTop + 0.06, a[1] + nz * 0.4], [b[0] + nx * 0.4, yTop + 0.06, b[1] + nz * 0.4], 1.0, 0.12));
    const n = Math.max(1, Math.round(L / 2.2));
    for (let k = 0; k <= n; k++) { const x = a[0] + dx * k / n + nx * 0.55, z = a[1] + dz * k / n + nz * 0.55; bat.add('csRail', post(x, z, yTop + 0.1, yTop + 1.15, 0.06)); }
    for (const hy of [1.1, 0.62]) bat.add('csRail', beam([a[0] + nx * 0.55, yTop + hy, a[1] + nz * 0.55], [b[0] + nx * 0.55, yTop + hy, b[1] + nz * 0.55], 0.05, 0.05));
  }
  { // the cut-stone building on the point: rock-faced walls, an arched door to the plaza, a crenellated parapet
    const H = HOUSE, y0 = -1.8, yb = parkLevel(H.x), yt = yb + H.h, fr = (g) => place(g, H.x, 0, H.z, H.yaw), W = H.w / 2, D = H.d / 2, t = 0.6;
    bat.add('csStone', fr(box(H.w, yt - y0, t, 0, (y0 + yt) / 2, -D + t / 2))); bat.add('csStone', fr(box(H.w, yt - y0, t, 0, (y0 + yt) / 2, D - t / 2)));
    bat.add('csStone', fr(box(t, yt - y0, H.d - 2 * t, -W + t / 2, (y0 + yt) / 2, 0)));
    // east wall facing the plaza, with an arched doorway (dark opening, voussoir ring)
    bat.add('csStone', fr(box(t, yt - y0, H.d - 2 * t, W - t / 2, (y0 + yt) / 2, 0)));
    const dw = 1.8, dh = 2.3;
    bat.add('voidDark', fr(box(0.06, dh, dw, W + 0.02, yb + dh / 2, 0)));
    const arch = new THREE.CircleGeometry(dw / 2, 14, 0, Math.PI); arch.rotateY(Math.PI / 2); arch.translate(W + 0.03, yb + dh, 0);
    bat.add('voidDark', fr(arch));
    for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI, r = dw / 2 + 0.2; bat.add('csStone', fr(box(0.2, 0.4, 0.27).rotateX(Math.PI / 2 - a).translate(W + 0.07, yb + dh + Math.sin(a) * r, Math.cos(a) * r))); }
    for (const s of [-1, 1]) bat.add('csStone', fr(box(0.2, dh, 0.3, W + 0.07, yb + dh / 2, s * (dw / 2 + 0.17))));
    bat.add('beton', fr(box(H.w - 0.4, 0.25, H.d - 0.4, 0, yt - 0.3, 0)));
    for (let i = 0; i < 7; i++) for (const [sx, sz, ln] of [[1, 0, H.d], [-1, 0, H.d], [0, 1, H.w], [0, -1, H.w]]) {
      const u = -ln / 2 + 0.45 + i * (ln - 0.9) / 6; if (sx) bat.add('csStone', fr(box(0.6, 0.7, 0.75, sx * (W - 0.3), yt + 0.35, u))); else bat.add('csStone', fr(box(0.75, 0.7, 0.6, u, yt + 0.35, sz * (D - 0.3))));
    }
    // two small windows on the water side
    for (const u of [-2.2, 2.2]) bat.add('voidDark', fr(box(0.9, 1.0, 0.1, u, yb + 1.9, -D - 0.01)));
  }

  // ---- the viewing deck on the tor and the platform over the water -------------------------------------------------
  const platform = (P, rails, woodKey, railKey, postKey) => {
    const fr = (g) => place(g, P.x, 0, P.z, P.yaw), W = P.w / 2, D = P.d / 2;
    for (let u = -W + 0.07; u < W; u += 0.16) bat.add(woodKey, fr(box(0.14, 0.06, P.d, u, P.y - 0.03, 0)));      // boards
    for (const z of [-D + 0.1, 0, D - 0.1]) bat.add(postKey, fr(box(P.w, 0.22, 0.12, 0, P.y - 0.2, z)));         // joists
    for (const x of [-W + 0.1, W - 0.1]) bat.add(postKey, fr(box(0.12, 0.25, P.d, x, P.y - 0.2, 0)));
    const corners = []; for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * (W - 0.1), sz * (D - 0.1)]);
    // legs down to the rock (or the water), with knee braces
    for (const [lx, lz] of [...corners, [-(W - 0.1), 0], [W - 0.1, 0]]) {
      const c = Math.cos(P.yaw), s = Math.sin(P.yaw), wx = P.x + lx * c + lz * s, wz = P.z - lx * s + lz * c;
      const gy = Math.max(-1.0, terrH(wx, wz) - 0.5); if (P.y - gy < 0.4) continue;
      bat.add(postKey, post(wx, wz, gy, P.y - 0.3, 0.16));
    }
    // railing: posts and rails on the given sides ('n', 's', 'e', 'w' in the platform frame)
    const side = { w: [[-W, -D], [-W, D]], e: [[W, -D], [W, D]], n: [[-W, -D], [W, -D]], s: [[-W, D], [W, D]] };
    for (const r of rails) {
      const [a, b] = side[r], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 1.6));
      for (let k = 0; k <= n; k++) { const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n; bat.add(railKey, fr(post(x, z, P.y, P.y + 1.1, 0.09))); }
      for (const hy of [1.08, 0.6, 0.15]) bat.add(railKey, fr(beam([a[0], P.y + hy, a[1]], [b[0], P.y + hy, b[1]], 0.07, hy > 1 ? 0.1 : 0.05)));
      // diagonal infill (the cross-braced railing of the deck in the photo)
      for (let k = 0; k < n; k++) { const x0 = a[0] + (b[0] - a[0]) * k / n, z0 = a[1] + (b[1] - a[1]) * k / n, x1 = a[0] + (b[0] - a[0]) * (k + 1) / n, z1 = a[1] + (b[1] - a[1]) * (k + 1) / n; bat.add(railKey, fr(beam([x0, P.y + 0.15, z0], [x1, P.y + 1.05, z1], 0.04, 0.05))); }
    }
  };
  platform(DECK, ['n', 's', 'e', 'w'], 'csDeck', 'csDeck', 'csDeck');
  platform(LOWER, ['n', 's', 'w', 'e'], 'csDeck', 'csRail', 'csRail');
  // ---- pier and the floating café ------------------------------------------------------------------------------------
  { const [a, b] = [PIER.a, PIER.b], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux, yA = parkLevel(a[0]) + 0.1, yB = 1.55;
    bat.add('beton', beam([a[0], yA - 0.15, a[1]], [b[0], yB - 0.15, b[1]], 2.6, 0.3));
    for (const t of [0.3, 0.7]) for (const s of [-1.1, 1.1]) { const x = a[0] + dx * t + nx * s, z = a[1] + dz * t + nz * s; bat.add('beton', post(x, z, -3, yA + (yB - yA) * t - 0.3, 0.35)); }
    for (const s of [-1.25, 1.25]) { bat.add('csRail', beam([a[0] + nx * s, yA + 1.0, a[1] + nz * s], [b[0] + nx * s, yB + 1.0, b[1] + nz * s], 0.05, 0.05));
      for (let k = 0; k <= 5; k++) { const t = k / 5; bat.add('csRail', post(a[0] + dx * t + nx * s, a[1] + dz * t + nz * s, yA + (yB - yA) * t, yA + (yB - yA) * t + 1.0, 0.05)); } }
    // the pontoon: white hull, timber deck, a blue canopy on posts, tables and chairs
    const P = { x: b[0] + ux * 6.2, z: b[1] + uz * 6.2, yaw: Math.atan2(ux, uz) }, fr = (g) => place(g, P.x, 0, P.z, P.yaw), W = 5.0, D = 6.0;
    bat.add('csHull', fr(box(2 * W, 1.3, 2 * D, 0, 0.25, 0)));
    for (let u = -W + 0.1; u < W; u += 0.2) bat.add('csDeck', fr(box(0.18, 0.05, 2 * D - 0.2, u, 0.93, 0)));
    for (const sx of [-1, 1]) for (const sz of [-1, 0, 1]) bat.add('metalDark', fr(post(sx * (W - 0.4), sz * (D - 0.4), 0.95, 3.4, 0.12)));
    const roof = box(2 * W + 0.6, 0.12, 2 * D + 0.6, 0, 3.45, 0); bat.add('csCanopy', fr(roof));
    for (const sx of [-1, 1]) bat.add('whitePlastic', fr(box(0.06, 0.06, 2 * D, sx * (W - 0.05), 1.95, 0)));
    for (const sz of [-1, 1]) bat.add('whitePlastic', fr(box(2 * W, 0.06, 0.06, 0, 1.95, sz * (D - 0.05))));
    for (let i = 0; i < 6; i++) { const lx = -2.6 + (i % 2) * 5.2 * 0.5 + (i % 2 ? 1.3 : 0), lz = -3.8 + Math.floor(i / 2) * 3.8;
      bat.add('whitePlastic', fr(box(0.8, 0.04, 0.8, lx, 1.68, lz))); bat.add('whitePlastic', fr(post(lx, lz, 0.95, 1.66, 0.06)));
      for (const [cx, cz] of [[0.75, 0], [-0.75, 0]]) { bat.add('whitePlastic', fr(box(0.42, 0.04, 0.42, lx + cx, 1.4, lz + cz))); bat.add('whitePlastic', fr(box(0.04, 0.42, 0.42, lx + cx * 1.25, 1.62, lz + cz))); } }
  }

  // ---- lamp posts, benches, bins --------------------------------------------------------------------------------------
  const props = [], trees = [];
  const lamp = (x, z) => { const y = yAt(x, z) + 0.1; bat.add('csLampBlack', cyl(0.07, 0.09, 4.0, x, y + 2.0, z, 8)); bat.add('csLampBlack', box(0.42, 0.06, 0.42, x, y + 4.02, z)); bat.add('csLampGlass', box(0.32, 0.45, 0.32, x, y + 4.28, z)); bat.add('csLampBlack', cyl(0.02, 0.28, 0.2, x, y + 4.6, z, 4)); };
  for (let i = 2; i < promPts.length - 1; i += 6) { const p = promPts[i], q = promPts[i + 1], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1; lamp(p[0] + dz / L * 3.4, p[1] - dx / L * 3.4);
    if (i % 12 === 2) props.push({ kind: 'bench', x: p[0] - dz / L * 3.3, z: p[1] + dx / L * 3.3, yaw: Math.atan2(-dz, dx) + Math.PI }); }
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + 0.3; lamp(ROUND_LAWN.x + Math.cos(a) * 9.5, ROUND_LAWN.z + Math.sin(a) * 9.5); i++; }
  for (const [x, z, yaw] of [[-258, -366, 0.6], [-271, -367, 0.7], [-252.5, -371, -0.3], [-276, -356, 1.3]]) props.push({ kind: 'bench', x, z, yaw });
  props.push({ kind: 'bin', x: -279.5, z: -340 }, { kind: 'bin', x: -259, z: -350 }, { kind: 'bin', x: -290, z: -295 });

  // ---- trees: pines and firs round the tor, yellow poplars and autumn trees on the lawns ----------------------------
  const T = (species, x, z, size) => trees.push({ species, x, z, size, force: true });
  T('fir', -290.2, -305.5, 1.05); T('pine', -287.5, -309.5, 1.1); T('fir', -285.8, -314.5, 0.95); T('pine', -282, -306, 1.0);
  T('mulberry', -279.5, -316.5, 1.15); T('autumn', -276.5, -326, 1.05); T('poplarY', -279.5, -333.5, 1.0); T('poplarY', -277.8, -341, 0.95);
  T('fir', -266.5, -322, 0.95); T('autumn', -264.5, -333, 1.1); T('pine', -268.5, -340.5, 1.0); T('autumn', -262.5, -312, 1.0); T('mulberry', -270.5, -309, 1.0);
  T('pine', -272.5, -347.5, 0.95); T('fir', -251, -351.5, 1.0); T('autumn', -249.5, -362, 1.05); T('pine', -250, -374.5, 0.9); T('mulberry', ROUND_LAWN.x, ROUND_LAWN.z, 1.15);
  T('autumn', -274.5, -360.5, 0.75); T('poplarY', -259.5, -378.5, 0.9); T('juniper', -284.5, -322, 0.9); T('juniper', -283, -329, 0.85);
  T('autumn', -301, -296.5, 1.0); T('pine', -310, -295.5, 1.05); T('autumn', -317, -295.5, 0.9);
  // the hill by the stairs: scrubby autumn trees and wild pear
  for (const [x, z, s] of [[-238, -312, 0.9], [-231, -309.5, 0.8], [-219.5, -311, 0.75], [-209, -315, 0.7], [-229, -324, 0.7], [-213, -329, 0.6], [-243.5, -306.5, 0.85], [-248, -327.5, 0.8], [-201, -323.5, 0.6]]) T('autumn', x, z, s);
  T('pine', -241.5, -333.5, 0.8); T('pine', -239.5, -342, 0.75);

  // ---- the wooden stairs ------------------------------------------------------------------------------------------------
  { const SW = 1.5, nodes = [];
    for (let i = 0; i + 1 < STAIRS.length; i++) { const a = STAIRS[i], b = STAIRS[i + 1], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3.0)); for (let k = 0; k < n; k++) nodes.push({ x: a[0] + (b[0] - a[0]) * k / n, z: a[1] + (b[1] - a[1]) * k / n, landing: k === 0 }); }
    nodes.push({ x: STAIRS[STAIRS.length - 1][0], z: STAIRS[STAIRS.length - 1][1], landing: true });
    // deck height: the ground plus a little, never climbing on the way down
    let prev = Infinity; for (const n of nodes) { n.y = Math.min(prev, Math.max(terrH(n.x, n.z) + 0.3, -1)); prev = n.y; }
    const railPts = { l: [], r: [] };
    for (let i = 0; i + 1 < nodes.length; i++) {
      const A = nodes[i], Bn = nodes[i + 1], dx = Bn.x - A.x, dz = Bn.z - A.z, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux, yaw = Math.atan2(dx, dz);
      const y0 = A.y, y1 = Bn.y, dh = y1 - y0, nSteps = Math.max(1, Math.round(Math.abs(dh) / 0.18)), run = L / nSteps;
      const startS = A.landing ? 0.9 : 0, endS = L;
      if (A.landing) bat.add('csPine', place(box(2.0, 0.07, 2.0), A.x, y0 - 0.035, A.z, yaw));
      if (run > 0.8 || nSteps < 2) { bat.add('csPine', beam([A.x + ux * startS, y0 - 0.04, A.z + uz * startS], [Bn.x, y1 - 0.04, Bn.z], SW, 0.07)); }
      else for (let k = 0; k < nSteps; k++) {
        const s = startS + (endS - startS) * (k + 0.5) / nSteps, yy = y0 + dh * (k + 1) / nSteps;
        bat.add('csPine', place(box(SW, 0.06, (endS - startS) / nSteps + 0.04), A.x + ux * s, yy - 0.03, A.z + uz * s, yaw));
      }
      for (const sd of [-1, 1]) {
        const ox = nx * sd * (SW / 2 + 0.04), oz = nz * sd * (SW / 2 + 0.04);
        bat.add('csPine', beam([A.x + ox, y0 - 0.22, A.z + oz], [Bn.x + ox, y1 - 0.22, Bn.z + oz], 0.07, 0.32));     // stringer
        const k0 = sd < 0 ? 'l' : 'r'; railPts[k0].push([A.x + ox * 1.15, y0, A.z + oz * 1.15]);
      }
    }
    const last = nodes[nodes.length - 1];
    for (const sd of [-1, 1]) { const A = nodes[nodes.length - 2], dx = last.x - A.x, dz = last.z - A.z, L = Math.hypot(dx, dz); railPts[sd < 0 ? 'l' : 'r'].push([last.x - dz / L * sd * (SW / 2 + 0.08), last.y, last.z + dx / L * sd * (SW / 2 + 0.08)]); }
    for (const k of ['l', 'r']) {
      const P = railPts[k];
      for (let i = 0; i < P.length; i++) {
        const [x, y, z] = P[i], g = terrH(x, z);
        bat.add('csPine', post(x, z, Math.min(g, y) - 0.3, y + 1.05, 0.11));
        bat.add('csPine', place(new THREE.ConeGeometry(0.1, 0.12, 4).rotateY(Math.PI / 4), x, y + 1.11, z));   // pyramid cap
        if (i + 1 < P.length) { const [x2, y2, z2] = P[i + 1];
          bat.add('csPine', beam([x, y + 1.0, z], [x2, y2 + 1.0, z2], 0.08, 0.06));
          bat.add('csPine', beam([x, y + 0.5, z], [x2, y2 + 0.5, z2], 0.06, 0.06));
          // cross bracing under the high top flights (as on the photo's upper section)
          const g2 = terrH(x2, z2); if (y - g > 1.4 && y2 - g2 > 1.4) bat.add('csPine', beam([x, g + 0.1, z], [x2, y2 - 0.3, z2], 0.05, 0.1));
        }
      }
    }
  }

  // ---- build --------------------------------------------------------------------------------------------------------------
  const out = buildProps(ctx, M, { props, trees, wires: [] }, bat);
  bat.build(M, group, { culler: ctx.culler });
  for (const m of out.meshes) group.add(m);
  group.traverse(o => { if (o.isMesh && /^V_(csLawn|csPavers|coping)$/.test(o.name)) { o.castShadow = false; o.receiveShadow = true; } });
  console.log('[cesnigir] tor blocks', nTor, 'cliff blocks', nCliff, 'trees', trees.length);
  return { group, meshes: out.meshes };
}
