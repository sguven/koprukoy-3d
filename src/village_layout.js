// Köprüköy village layout (v0.8): a connected road network and building footprints.
//
// The village centre is traced from the Google satellite image in docs/reference/01 (Güvendioğlu Market
// junction, "Köprüköy Köyü Yolu", the mosque). Image pixels are mapped to model metres with the market
// junction as anchor (0.25 m / px, north up = -Z). Tile roofs were detected automatically in the image
// (tools/trace_roofs.py) and give the footprints, orientations and sizes of the ~30 central buildings.
// Outside the photographed block the streets are continued as a plausible rural network that joins the
// surviving v0.6 roads (D.260 access, the two roads leaving north, the three leaving south and the
// shore road), and houses are placed along those streets in plots with a seeded random generator, so
// the result is deterministic.
//
// This module has no three.js dependency: it only produces plain data (used for geometry, collision,
// the minimap and the headless plan check in tools/plan_check.mjs).

import { ROADS as DATA_ROADS, BUILDINGS as DATA_BUILDINGS, ANCHOR, MOSQUE_SITE, SITES as DATA_SITES } from './village_data.js';

// ---------------------------------------------------------------- image -> model mapping
// v0.9: the photo-01 frame is anchored on the true position of the market junction (Google Maps pin
// georeference, see tools/build_village_data.py); only the municipality, market and kahve are still taken
// from the photo — every other footprint comes from the satellite trace in village_data.js.
export const PX = 0.25;                // metres per satellite pixel
const JX = 338, JY = 225;              // market junction in image pixels
const JM = [ANCHOR.jx, ANCHOR.jz];     // ... and in model metres
export const img = (px, py) => [JM[0] + (px - JX) * PX, JM[1] + (py - JY) * PX];
export const IMG_RECT = { x0: img(0, 0)[0], z0: img(0, 0)[1], x1: img(813, 607)[0], z1: img(813, 607)[1] };

// Everything of the old draft inside this region (roads, houses, trees, the mosque) is removed and rebuilt.
export const REGION = { x0: -340, x1: 890, z0: -780, z1: 890 };
export const inRegion = (x, z) => x > REGION.x0 && x < REGION.x1 && z > REGION.z0 && z < REGION.z1;

// ---------------------------------------------------------------- roads
// kind: asphalt | concrete | dirt ; w = width in metres ; kerb = blue/white kerb + pavement strips
// v0.9.2 çarşı: the traced centre roads ran through the middle of the square. Re-drawn on photo 01: the main
// road from the north runs along the east side of the open square, past the market's kerb, into the junction;
// the lane west leaves the square along the south wall of the municipality (SV03).
const ROAD_FIX = {
  local_260: { pts: [[249, 93], [251.5, 100], [252.5, 110], [252.6, 122], [254, 131], [257, 138]], kind: 'asphalt', w: 6.5, kerb: true, kerbSide: -1 },
  main_284: null,
  local_283: { pts: [[253, 134.5], [246, 137.2], [236, 137.6], [226, 137.0], [217, 138], [214, 141]] },
};
export const ROADS = DATA_ROADS.filter(r => ROAD_FIX[r.id] !== null).map(r => ({ ...r, ...(ROAD_FIX[r.id] || {}), poles: /^main_/.test(r.id) }));

// ---------------------------------------------------------------- buildings traced from the photo
// [cx_px, cy_px, w_px, d_px, angle_rad (long axis, image frame), storeys, roof, kind]
// roof: h = hip, g = gable, f = flat, m = metal sheet
const T = [
  [216.6, 39.1, 60.3, 36.0, 2.981, 1, 'h'],
  [106.1, 44.6, 41.7, 27.7, 0.861, 1, 'g'],
  [735.5, 59.4, 67.5, 30.2, -2.892, 1, 'h'],
  [519.5, 60.7, 19.6, 11.2, 2.261, 1, 'g'],
  [564.9, 81.9, 47.6, 30.3, 1.437, 1, 'h'],
  [802.4, 121.9, 84.2, 20.0, 1.723, 1, 'g'],
  [378.9, 76.8, 28.0, 12.2, 3.126, 1, 'h'],
  [51.1, 100.1, 42.7, 29.7, -2.917, 1, 'g'],
  [707.2, 117.3, 92.9, 52.3, -3.09, 2, 'h'],
  [443.0, 121.0, 52.8, 29.4, -2.838, 1, 'h'],
  [236.4, 129.2, 32.9, 16.7, 1.366, 1, 'f', 'kahve'],
  [372.0, 162.5, 45.1, 37.5, -2.472, 2, 'h', 'market'],
  [591.7, 192.4, 74.8, 38.8, 1.579, 2, 'h'],
  [240.5, 195.5, 75.8, 33.0, 1.658, 3, 'h', 'municipality'],
  [733.2, 206.7, 38.3, 31.7, 2.996, 1, 'h'],
  [112.4, 234.6, 54.1, 47.0, 1.574, 2, 'h'],
  [796.4, 242.9, 63.0, 29.1, 1.564, 1, 'h'],
  [408.1, 293.3, 55.7, 28.7, 3.022, 1, 'h'],
  [216.1, 309.6, 57.7, 35.8, 1.452, 1, 'h', 'school'],
  [477.2, 296.8, 63.0, 34.0, 3.137, 2, 'h'],
  [32.0, 303.8, 48.0, 37.8, 2.436, 1, 'g'],
  [789.8, 321.4, 32.0, 20.1, 1.564, 1, 'g'],
  [150.9, 345.5, 40.7, 30.9, 1.198, 1, 'h'],
  [94.1, 403.4, 62.0, 50.0, 0.862, 2, 'h'],
  [172.6, 383.9, 49.0, 32.5, 2.572, 1, 'h'],
  [326.0, 410.1, 60.1, 37.9, -3.038, 2, 'h'],
  [586.9, 530.3, 103.8, 42.3, 2.874, 1, 'h'],
  [772.5, 524.6, 49.5, 46.9, 2.77, 1, 'h'],
  [268.3, 551.3, 34.1, 30.3, 2.603, 1, 'h'],
  [307.4, 547.1, 22.3, 15.1, 2.631, 1, 'g'],
  [358.1, 582.9, 49.0, 28.5, 2.312, 1, 'g'],
  // flat / light roofs not picked up by the tile-roof detector
  [574, 33, 40, 27, 0, 1, 'f'], [666, 37, 56, 33, 0, 1, 'f'], [150, 328, 46, 37, 0, 1, 'm'],
];
// ---------------------------------------------------------------- the çarşı (market square), v0.9.2
// Re-measured on photo 01 (0.25 m/px) and the Street View photos 02 / 05 / SV01-03: the three çarşı
// buildings keep these footprints exactly (no road nudging, no yaw snapping), and everything on the square
// is placed in the municipality's façade frame: s = metres along the east façade from its south end,
// out = metres in front of it (east).
//  - municipality: tile roof 19 x 9 m incl. eaves (photo 01) -> walls 17.6 x 7.6 m, five bays on the long side
//  - Güvendioğlu Market: roof 11 x 7.5 m, square to the north (photo 01); shop front on the west, to the square
//  - kahve: single-storey, tile roof, long axis north-south, just north of the municipality (photo 02 right)
const CARSI_FIX = {
  municipality: { x: 233.75, z: 125.4, w: 17.6, d: 7.6, fixed: true },
  market: { x: 266.6, z: 115.8, yaw: 0, w: 10.4, d: 7.8, floorAtFront: true, fixed: true },   // shop floor at street level, dug into the slope behind
  kahve: { x: 233.4, z: 108.2, yaw: 0, w: 6.0, d: 10.6, roof: 'h', wallKey: 'Duvar_Krem', faceFix: 0, fixed: true },
};
export const TRACED = T.filter(t => t[7] === 'municipality' || t[7] === 'market' || t[7] === 'kahve').map(([cx, cy, w, d, ang, st, roof, kind]) => {
  const [x, z] = img(cx, cy);
  // image frame: long axis (cos a, sin a) with y down == model (X, Z); model yaw maps local x to (cos yaw, -sin yaw)
  return { x, z, yaw: -ang, w: w * PX, d: d * PX, storeys: st, roof, kind, traced: true, ...(CARSI_FIX[kind] || {}) };
});
/** Façade frame of the municipality: (s, out) -> model [x, z]. */
export function facadeFrame(muni) {
  const c = Math.cos(muni.yaw), sn = Math.sin(muni.yaw);
  const at = (s, out) => { const lx = muni.w / 2 - s, lz = -(muni.d / 2 + out); return [muni.x + lx * c + lz * sn, muni.z - lx * sn + lz * c]; };
  return { at, yaw: muni.yaw, L: muni.w };
}
export function carsiSites(muni) {
  const F = facadeFrame(muni), P = (s, out, extra = {}) => { const [x, z] = F.at(s, out); return { x, z, yaw: F.yaw, s, out, ...extra }; };
  const sq = { s0: -7, s1: 31, o0: -2.5, o1: 24 };        // reaches the market's pavement and the junction (photo 01)
  const sqc = F.at((sq.s0 + sq.s1) / 2, (sq.o0 + sq.o1) / 2);
  return {
    // stabilised earth / gravel square between the façade and the market (photos 02, 05)
    square: { x: sqc[0], z: sqc[1], w: sq.s1 - sq.s0, d: sq.o1 - sq.o0, yaw: F.yaw },
    // Atatürk statue: bronze standing figure on a grey granite pedestal, in front of the second bay (photo 02)
    statue: P(9.0, 3.3),
    bed: { ...P(8.4, 2.7), w: 8.0, d: 4.6 },                 // grass bed with a low kerb around the statue
    flags: [P(7.4, 1.4, { flag: true }), P(10.6, 1.4)],      // two thin poles behind the statue, the flag on the southern one
    kiosk: { ...P(17.4, 2.6), w: 5.0, d: 3.6 },              // the kahve's green-roofed kiosk at the north end of the façade
    trees: [
      P(-1.2, 2.2, { species: 'juniper', size: 1.25 }),       // big juniper at the south-east corner, by the lane (photo 02, SV03)
      P(5.0, 1.4, { species: 'redshrub', size: 1.0 }),       // red-leaved shrub in the bed
      P(6.7, 2.4, { species: 'fruit', size: 0.75 }),         // small young tree left of the statue
      P(11.4, 2.2, { species: 'juniper', size: 0.75 }),      // small conifer right of the statue
      P(13.5, 3.2, { species: 'fir', size: 1.0 }),           // tall spruce reaching the eaves
      P(23.5, 5.0, { species: 'mulberry', size: 1.35 }),     // big trees in front of the kahve (photo 02 right, photo 05)
      P(27.5, 3.5, { species: 'mulberry', size: 1.2 }),
    ],
    marketTree: { x: 258.2, z: 123.6 },                      // the old tree on the pavement in front of the market (SV01, satellite crown)
    // raised park plot south of the lane: rubble wall with blue-white kerb stones, big wooden çardak, notice board, two big trees (photo 02 left)
    plot: { x0: 235.5, x1: 250.0, z0: 139.8, z1: 153.0, h: 0.7 },
    cardak: { x: 245.0, z: 145.4, size: 5.6 },
    board: { x: 248.6, z: 148.6 },
    plotTrees: [{ x: 240.3, z: 141.8, species: 'mulberry', size: 1.55 }, { x: 237.8, z: 147.8, species: 'mulberry', size: 1.4 }],
  };
}
/** Is (x, z) on the çarşı square (or in the raised plot)? */
export function inCarsi(sites, x, z, margin = 0) {
  const q = sites.square; if (!q) return false;
  const c = Math.cos(q.yaw), s = Math.sin(q.yaw), dx = x - q.x, dz = z - q.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (Math.abs(lx) < q.w / 2 + margin && Math.abs(lz) < q.d / 2 + margin) return true;
  const p = sites.plot; return !!p && x > p.x0 - margin && x < p.x1 + margin && z > p.z0 - margin && z < p.z1 + margin;
}

// ---------------------------------------------------------------- special sites (model metres)
const muni = TRACED.find(b => b.kind === 'municipality');
export const SITES = {
  municipality: muni,
  ...carsiSites(muni),
  market: TRACED.find(b => b.kind === 'market'),
  mosque: { x: MOSQUE_SITE.x, z: MOSQUE_SITE.z, yaw: 0 },     // prayer hall centre (dome in the satellite image); qibla side to the south
  green1: { x: img(403, 541)[0], z: img(403, 541)[1] },  // small green with a bench and a bin (docs/reference/04)
  ...DATA_SITES,                                          // cemeteries, football pitch, school (satellite / Street View, v0.9)
};

// ---------------------------------------------------------------- geometry helpers
export function polyLength(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
/** Round the corners of a polyline with short arcs (radius r) and resample every `step` metres. */
export function smoothPolyline(pts, step = 3, r = 14) {
  if (pts.length < 3) return resample(pts, step);
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1], c = pts[i], n = pts[i + 1];
    const d0 = Math.hypot(c[0] - p[0], c[1] - p[1]), d1 = Math.hypot(n[0] - c[0], n[1] - c[1]);
    const rr = Math.min(r, d0 * 0.45, d1 * 0.45);
    const a = [c[0] + (p[0] - c[0]) / d0 * rr, c[1] + (p[1] - c[1]) / d0 * rr], b = [c[0] + (n[0] - c[0]) / d1 * rr, c[1] + (n[1] - c[1]) / d1 * rr];
    // quadratic bezier a -> c -> b
    for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]); }
  }
  out.push(pts[pts.length - 1]);
  return resample(out, step);
}
function resample(pts, step) {
  const out = [pts[0]]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    let s = step - carry;
    while (s < L) { out.push([a[0] + (b[0] - a[0]) * s / L, a[1] + (b[1] - a[1]) * s / L]); s += step; }
    carry = L - (s - step);
  }
  const last = pts[pts.length - 1], pl = out[out.length - 1]; if (Math.hypot(last[0] - pl[0], last[1] - pl[1]) > step * 0.3) out.push(last); else out[out.length - 1] = last;
  return out;
}
export function distToPolyline(x, z, pts) {
  let best = Infinity, bt = 0, bi = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
    let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
    if (d < best) { best = d; bt = t; bi = i; }
  }
  return { d: best, i: bi, t: bt };
}
export function rectCorners(b) {
  const c = Math.cos(b.yaw), s = Math.sin(b.yaw), hw = b.w / 2, hd = b.d / 2, out = [];
  for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) out.push([b.x + lx * c + lz * s, b.z - lx * s + lz * c]);
  return out;
}
export function rectsOverlap(a, b, margin = 0) {
  const A = rectCorners({ ...a, w: a.w + 2 * margin, d: a.d + 2 * margin }), B = rectCorners(b);
  const axes = [];
  for (const R of [A, B]) for (let i = 0; i < 2; i++) { const dx = R[i + 1][0] - R[i][0], dz = R[i + 1][1] - R[i][1], L = Math.hypot(dx, dz) || 1; axes.push([dx / L, dz / L]); }
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of A) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of B) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- the layout
/**
 * Builds the village: smooth road centrelines, all buildings (traced + generated) and the plot props.
 * `terrH(x, z)` gives the terrain height; `existingRoads` are the surviving old road samples [x,z,y,hw,...].
 */
export function buildVillageLayout(terrH, existingRoads = []) {
  const roads = ROADS.map(r => ({ ...r, line: smoothPolyline(r.pts, 3) }));
  const rnd = mulberry32(20261108);
  const slopeAt = (x, z) => { const e = 3, dx = terrH(x + e, z) - terrH(x - e, z), dz = terrH(x, z + e) - terrH(x, z - e); return Math.hypot(dx, dz) / (2 * e); };
  const nearestRoad = (x, z) => { let bestR = null, best = { d: Infinity }; for (const r of roads) { const h = distToPolyline(x, z, r.line); if (h.d < best.d) { best = h; bestR = r; } } return { r: bestR, ...best }; };
  const roadClear = (b, margin) => {
    for (const c of rectCorners({ ...b, w: b.w + 2 * margin, d: b.d + 2 * margin })) {
      for (const r of roads) if (distToPolyline(c[0], c[1], r.line).d < r.w / 2 + 0.4) return false;
    }
    for (let k = 0; k < existingRoads.length; k += 4) { const dx = existingRoads[k] - b.x, dz = existingRoads[k + 1] - b.z; if (dx * dx + dz * dz < (existingRoads[k + 3] + Math.hypot(b.w, b.d) / 2 + margin) ** 2) return false; }
    return true;
  };

  const buildings = TRACED.map(b => ({ ...b }));
  for (const [x, z, yaw, w, d, storeys, roof, extra] of DATA_BUILDINGS) { const e = { ...(extra || {}) }; if (e.wall) { e.wallKey = e.wall; delete e.wall; } buildings.push({ x, z, yaw, w, d, storeys, roof, ...e, traced: true, sat: true }); }
  const S = SITES;
  buildings.push({ x: S.mosque.x, z: S.mosque.z, yaw: 0, w: 13, d: 19, kind: 'mosque' });
  buildings.push({ x: S.mosque.x + 8.7, z: S.mosque.z - 6.7, yaw: 0, w: 2.6, d: 2.6, kind: 'minaret' });
  buildings.push({ x: S.mosque.x - 8.7, z: S.mosque.z - 6.7, yaw: 0, w: 2.6, d: 2.6, kind: 'minaret' });
  // traced houses that landed on a re-drawn road are nudged away from it, perpendicular to the road
  // how far the footprint (plus a margin) reaches into the nearest road ribbon; 0 when clear
  const intrusion = (b, margin) => {
    let worst = 0;
    for (const c of rectCorners({ ...b, w: b.w + 2 * margin, d: b.d + 2 * margin })) for (const r of roads) worst = Math.max(worst, r.w / 2 + 0.4 - distToPolyline(c[0], c[1], r.line).d);
    return worst;
  };
  for (const b of buildings) {
    if (!b.traced) continue;
    // v0.9.5: a step is kept only if it reduces the intrusion — a house between two lanes used to be pushed off one
    // lane straight onto the other (the long house S of the mosque sat across the asphalt)
    let cur = b.fixed ? 0 : intrusion(b, 0.6);
    for (let it = 0; it < 8 && cur > 0; it++) {
      const h = nearestRoad(b.x, b.z), p = h.r.line[h.i], q = h.r.line[Math.min(h.r.line.length - 1, h.i + 1)], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
      const nx = -dz / L, nz = dx / L, side = Math.sign((b.x - p[0]) * nx + (b.z - p[1]) * nz) || 1;
      const ox = b.x, oz = b.z; b.x += nx * side; b.z += nz * side;
      const nxt = intrusion(b, 0.6);
      if (nxt >= cur - 0.05) { b.x = ox; b.z = oz; break; }
      cur = nxt;
    }
    const h = nearestRoad(b.x, b.z), p = h.r.line[h.i], q = h.r.line[Math.min(h.r.line.length - 1, h.i + 1)];
    b.face = Math.atan2(p[1] - b.z, p[0] - b.x); b.front = h.d;
    if (b.faceFix !== undefined) b.face = b.faceFix;   // çarşı: the kahve opens onto the square
    // the detector's axis is unreliable for near-square roofs: snap those to the road or to north
    if (b.fixed) { /* çarşı footprints are measured: keep them */ }
    else if (Math.max(b.w, b.d) / Math.min(b.w, b.d) < (b.sat ? 1.12 : 1.55) && !b.kind) {
      const roadYaw = Math.atan2(-(q[1] - p[1]), q[0] - p[0]);
      const m90 = (a) => ((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      const dRoad = Math.min(Math.abs(m90(b.yaw) - m90(roadYaw)), Math.PI / 2 - Math.abs(m90(b.yaw) - m90(roadYaw)));
      const dAxis = Math.min(m90(b.yaw), Math.PI / 2 - m90(b.yaw));
      b.yaw = dRoad < dAxis ? roadYaw : 0;
    } else if (b.kind === 'market' || b.kind === 'kahve') b.yaw = 0;
  }

  for (const b of buildings) if (b.traced && !b.kind) { const u = rnd(); b.wall = b.fence || (u < 0.32 ? 'wall' : u < 0.62 ? 'stone' : u < 0.88 ? 'fence' : 'none'); b.tree = rnd() < 0.75; }

  // per-building ground: floor level at the highest corner, plinth reaching the lowest
  for (const b of buildings) {
    const hs = rectCorners(b).map(([x, z]) => terrH(x, z)); hs.push(terrH(b.x, b.z));
    const hMax = Math.max(...hs), hMin = Math.min(...hs);
    // v0.9.6: the floor is level with the ground on the street side (the door opens onto the lane), the plinth takes
    // the drop on the downhill side; only when that plinth would pass 2.6 m is the house cut into the slope. The old
    // mid-slope floor left houses on the uphill side of a lane looking buried in the road (owner's report).
    const r = Math.min(b.w, b.d) / 2 + 1;
    const hFront = b.face !== undefined ? terrH(b.x + Math.cos(b.face) * r, b.z + Math.sin(b.face) * r) : hMax;
    let yTop = Math.max(hFront, hMin + 0.2) + 0.08;
    const plinth = yTop - (hMin - 0.4); if (plinth > 2.6) yTop -= (plinth - 2.6) * 0.6;
    b.yTop = yTop; b.yLow = hMin - 0.4;
    if (b.floorAtFront && b.face !== undefined) { const fx = b.x + Math.cos(b.face) * (b.w / 2 + 1), fz = b.z + Math.sin(b.face) * (b.w / 2 + 1); b.yTop = terrH(fx, fz) + 0.15; }
  }
  return { roads, buildings, sites: SITES, rnd };
}

// ---------------------------------------------------------------- centre-only mode (default)
// Only the square (old municipality, statue, çardak) and the mosque are rebuilt; the v0.6 roads, houses
// and trees stay. Old houses / trees inside these zones are removed.
export const CENTRE_MOSQUE = { x: 107.2, z: 102.6 };   // inside the old courtyard footprint (89.7..128.7, 83.2..125.1)
export const CENTRE_ZONES = [
  { x0: 222, x1: 262, z0: 100, z1: 156 },               // municipality, square, kiosk, çardak plot
  { x0: 93, x1: 121, z0: 88, z1: 124 },                 // mosque courtyard
];
export const inCentreZone = (x, z) => CENTRE_ZONES.some(r => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
export function buildCentreLayout(terrH) {
  const muniB = { ...TRACED.find(b => b.kind === 'municipality') };
  const buildings = [muniB,
    { x: CENTRE_MOSQUE.x, z: CENTRE_MOSQUE.z, yaw: 0, w: 13, d: 19, kind: 'mosque' },
    { x: CENTRE_MOSQUE.x + 8.7, z: CENTRE_MOSQUE.z - 6.7, yaw: 0, w: 2.6, d: 2.6, kind: 'minaret' }];
  for (const b of buildings) {
    const hs = rectCorners(b).map(([x, z]) => terrH(x, z)); hs.push(terrH(b.x, b.z));
    const hMax = Math.max(...hs), hMin = Math.min(...hs), range = hMax - hMin;
    // cut-and-fill on slopes (Street View 99): floor sits part-way down the drop so the plinth never grows past ~3 m
    b.yTop = (range > 1.5 ? hMax - 0.5 * (range - 1.5) : hMax) + 0.05; b.yLow = hMin - 0.4;
  }
  const sites = { ...SITES, municipality: muniB, mosque: { ...CENTRE_MOSQUE, yaw: 0 } };
  return { roads: [], buildings, sites, rnd: mulberry32(20261108), centreOnly: true };
}

/** Road samples in the data4 format ([x, z, y, halfWidth, ...]) for collision, the car and the minimap. */
export function roadSamples(roads, terrH, lift) {
  const out = [];
  for (const r of roads) for (const [x, z] of smoothPolyline(r.pts, 1.5)) out.push(x, z, terrH(x, z) + lift(r.kind), r.w / 2);
  return out;
}
/** Collision boxes ([x, z, yaw, hw, hd, ...]) for the statue, the kiosk and the çardak. */
export function carsiBoxes(sites) {
  const out = [];
  if (sites.statue) out.push(sites.statue.x, sites.statue.z, sites.statue.yaw, 1.3, 1.3);
  if (sites.kiosk) out.push(sites.kiosk.x, sites.kiosk.z, sites.kiosk.yaw, sites.kiosk.w / 2, sites.kiosk.d / 2);
  if (sites.cardak) out.push(sites.cardak.x, sites.cardak.z, 0, sites.cardak.size / 2, sites.cardak.size / 2);
  return out;
}
/** The çarşı square as road samples (so walking / driving use it and no grass grows on it). */
export function squareSamples(sites, terrH, lift = 0.06) {
  const q = sites.square, out = []; if (!q) return out;
  const c = Math.cos(q.yaw), s = Math.sin(q.yaw);
  for (let lz = -q.d / 2 + 1; lz <= q.d / 2 - 1; lz += 2) for (let lx = -q.w / 2 + 1; lx <= q.w / 2 - 1; lx += 2) {
    const x = q.x + lx * c + lz * s, z = q.z - lx * s + lz * c; out.push(x, z, terrH(x, z) + lift, 1.5);
  }
  return out;
}
/** Building boxes in the data4 format ([x, z, yaw, hw, hd, ...]) for collision and the minimap. */
export function buildingBoxes(buildings) {
  const out = [];
  for (const b of buildings) out.push(b.x, b.z, b.yaw, b.w / 2, b.d / 2);
  return out;
}
