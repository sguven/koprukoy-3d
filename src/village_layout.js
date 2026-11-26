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

import { ROAD_SHIFT } from './road_frame.js';
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
// v1.11 (Street View drive from the çarşı down the main road, panoramas of Apr 2026; docs/REALISM.md): between the
// junction south of the market and the junction by the blue house the traced road ran 8–12 m north of the real one,
// through the yard of the long white house. The panorama positions are the carriageway itself, so the main road is
// re-laid through them. Applied at the very end of buildVillageLayout: houses keep the positions, fronts and random
// draws they had, and village.js reads the old line (`orig`) wherever a road decides how many draws are made.
// `gone` = a traced piece that doubled the main road (kept in the list so that no other road changes its index).
const ROAD_MOVE = {
  local_320: { pts: [[271.2, 194.9], [273.9, 205.5], [282.5, 213.8]], kind: 'asphalt', w: 6.5, kerb: true },
  secondary_324: { pts: [[282.5, 213.8], [294.6, 223.1]], w: 6.5 },
  secondary_332: { pts: [[294.6, 223.1], [304.2, 226.8], [314.9, 230.6]], w: 6.5 },
  main_339: { pts: [[314.9, 230.6], [336.3, 236.1], [352.2, 238.6], [362.9, 240.4], [371.5, 243.0]] },
  main_354: { pts: [[371.5, 243.0], [377.3, 249.6], [383.5, 262.5], [388.7, 274.0], [391.9, 283.9]] },
  secondary_340: { pts: [[378.5, 223.5], [380.2, 225.8], [377.5, 237.9], [375.5, 240.8], [371.5, 243.0]] },
  local_319: { pts: [[277.4, 206.4], [277.9, 206.9]], gone: true },
  secondary_325: { pts: [[277.4, 206.4], [277.9, 206.9]], gone: true },
  local_327: { pts: [[277.4, 206.4], [277.9, 206.9]], gone: true },
  local_326: { pts: [[326.2, 222.6], [326.6, 223.0]], gone: true },                      // a stub into the long house's yard: the garage's gravel forecourt is open ground
  local_312: { pts: [[222.8, 179.1], [240.0, 188.5], [252.0, 196.0], [263.0, 197.4], [271.2, 194.9]] },   // the lane west passes south of the shop
  // v1.17 (Google satellite, Nov 2026): no lane runs west from the north lane through the block of houses north of the
  // D.260 bridge; the houses stand eave to eave there. The traced piece had pushed three of them out of the model.
  secondary_106: { pts: [[357.0, -138.0], [357.4, -138.4]], gone: true },
};

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
  // v1.15 (owner's screenshots 0685/0686 and their satellite view): Güvendioğlu Market is the cream southern half of a
  // two-storey pair on the east side of the square (roof 257.5–268.7 east, 114–127 south); the salmon-red northern
  // half with the second shop is in SV_SITES.extra. It was a single 10 × 8 m block 6 m further north-east.
  market: { x: 263.2, z: 123.7, yaw: 0, w: 11.0, d: 6.5, floorAtFront: true, fixed: true, faceFix: Math.PI },   // shop floor at street level, dug into the slope behind
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
    marketTree: { x: 259.5, z: 131.8 },                      // v1.15: the big tree stands on the grass south of the market (0685), not in front of it                      // the old tree on the pavement in front of the market (SV01, satellite crown)
    // v0.9.8 (owner's photos, Nov 2026): the plot south of the lane is the paved forecourt of the ÇEŞNİGİR-DER
    // association building on its west side — grey interlocking pavers, low wall with blue-white kerb stones on the
    // lane and road sides, the big wooden çardak just in front of the building's north half, the notice board by
    // the road, folding tables and white plastic chairs, big trees north of the çardak and by the walkway.
    plot: { x0: 230.4, x1: 250.0, z0: 139.8, z1: 153.4, h: 0.35, paved: true, open: 'w' },
    cardak: { x: 237.8, z: 145.6, size: 5.6 },
    board: { x: 248.6, z: 141.8 },                          // notice board at the corner by the lane, facing the square
    plotTrees: [{ x: 240.6, z: 141.0, species: 'mulberry', size: 1.55 }, { x: 246.6, z: 152.4, species: 'mulberry', size: 0.95 }],
    der: DER_SITE,
  };
}
// ÇEŞNİGİR-DER (Köprüköy Çeşnigir Kültür Sosyal Yardımlaşma ve Dayanışma Derneği), owner's photos of the opening:
// seen from the main road the forecourt with the çardak is on the right, a paved walkway with blue-white kerbs runs
// in to the building between them, the flag pole and a twin street lamp stand at its mouth, and on the left a raised
// garden terrace behind a blue-white railing (tables, chairs, spruces). The building itself is in OWNER_FIX.
const DER_SITE = {
  walk: { x0: 230.4, x1: 253.0, z0: 153.4, z1: 156.6 },                     // pale red pavers, blue-white kerbs
  terrace: { x0: 233.6, x1: 251.0, z0: 156.6, z1: 170.6, h: 0.6 },          // raised lawn, rubble wall, kerb stones, railing
  flag: { x: 249.4, z: 153.0 },                                              // tall pole with the Turkish flag, right of the walkway
  lamp: { x: 246.4, z: 157.2 },                                              // twin-headed street lamp, left of the walkway
  tables: [ // forecourt (on the plot) and terrace: grey folding tables with white plastic chairs
    { x: 243.6, z: 143.6, yaw: 0.0 }, { x: 244.2, z: 148.0, yaw: 0.0 }, { x: 247.2, z: 145.6, yaw: Math.PI / 2 }, { x: 233.6, z: 146.4, yaw: Math.PI / 2 },
    { x: 241.0, z: 160.0, yaw: 0.0 }, { x: 245.4, z: 160.4, yaw: 0.0 }, { x: 243.0, z: 165.6, yaw: 0.0 },
  ],
  terraceTrees: [{ x: 236.0, z: 159.4, species: 'fir', size: 0.85 }, { x: 235.6, z: 166.0, species: 'fir', size: 0.8 }, { x: 239.0, z: 169.0, species: 'mulberry', size: 1.25 }],
};
/** Is (x, z) on the çarşı square (or in the raised plot)? */
export function inCarsi(sites, x, z, margin = 0) {
  const q = sites.square; if (!q) return false;
  const c = Math.cos(q.yaw), s = Math.sin(q.yaw), dx = x - q.x, dz = z - q.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
  if (Math.abs(lx) < q.w / 2 + margin && Math.abs(lz) < q.d / 2 + margin) return true;
  const inR = (p) => !!p && x > p.x0 - margin && x < p.x1 + margin && z > p.z0 - margin && z < p.z1 + margin;
  return inR(sites.plot) || (!!sites.der && (inR(sites.der.walk) || inR(sites.der.terrace)));
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
  // v0.9.8: the green south of the çarşı plot is the ÇEŞNİGİR-DER garden terrace (built from DER_SITE)
  // v1.11: the green with the playground lay across the main road. It is the kerbed lawn east of the road (Street
  // View from the road, satellite): the playground and a wooden çardak stand at its south end.
  gardens: (DATA_SITES.gardens || []).map(g => (Math.hypot(g.x - 239.9, g.z - 161.4) < 1 ? { ...g, der: true }
    : Math.hypot(g.x - 255.9, g.z - 47.4) < 1 ? { ...g, x: 245.0, z: 69.0, w: 14, d: 13 }   // v1.13: the pine park is west of the road, opposite the old shops (0652)
    : g.play ? { ...g, x: 432.5, z: 338.0, w: 21, d: 44, playAt: [433.5, 357.0, -0.25], cardak: { x: 425.6, z: 351.0, w: 3.6, d: 3.6, yaw: -0.25 } } : g)),
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
  for (const [x, z, yaw, w, d, storeys, roof, extra] of DATA_BUILDINGS) { const e = { ...(extra || {}) }; if (e.wall) { e.wallKey = e.wall; delete e.wall; } buildings.push({ x, z, yaw, w, d, storeys, roof, ...e, traced: true, sat: true, data: [x, z] }); }
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
  const setGround = (b) => {
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
  };
  for (const b of buildings) setGround(b);

  // v0.9.7: the owner's corrections. Applied last, so the seeded draws above stay as they were; `orig` keeps the
  // house as generated so village.js can replay its random draws and leave every other house untouched.
  for (const f of OWNER_FIX) {
    let b = null, best = 4;
    for (const c of buildings) { const dd = Math.hypot(c.x - f.xz[0], c.z - f.xz[1]); if (dd < best) { best = dd; b = c; } }
    if (!b) { console.warn('[layout] owner fix: no building at', f.xz, f.note); continue; }
    b.orig = { ...b }; Object.assign(b, f.set); b.ownerFix = true;
    if (f.set.faceFix !== undefined) b.face = f.set.faceFix;
    if (f.set.x !== undefined || f.set.z !== undefined) setGround(b);   // moved onto its true spot: new floor level
    if (b.lowerFloor) {   // a full storey under the floor on the downhill side: the lowest ground sits one storey below
      const hMin = Math.min(...rectCorners(b).map(([x, z]) => terrH(x, z)), terrH(b.x, b.z));
      b.yTop = Math.max(b.yTop, hMin + 2.55); b.yLow = hMin - 0.4;
    }
  }
  // v1.5.1 (owner's rule, 16 Nov 2026): a house is single storey unless it is clearly two storeys. The two-storey
  // houses that no panorama confirmed (v0.9.5 picked about half of the compact tile-roofed ones by a hash) become
  // single storey; like the owner's corrections they keep `orig`, so their colours and every other house stay.
  for (const b of buildings) {
    if (!b.sat || b.orig || b.kind || b.storeys !== 2) continue;
    if (TWO_STOREY_SEEN.some(([x, z]) => Math.hypot(b.x - x, b.z - z) < 3)) continue;
    b.orig = { ...b }; b.storeys = 1;
  }
  const stoneWalls = STONE_WALLS.map(sw => stoneWallLine(roads, sw)).filter(Boolean);
  for (const w of SV_SITES.walls) stoneWalls.push({ gaps: [], ...w });
  // v1.5: buildings added from Street View are kept out of `buildings` (its length and order feed the random stream)
  const extra = SV_SITES.extra.map(e => { const b = { ...e }; setGround(b); return b; });
  // v1.11: roads moved onto the line the Street View car drove (see ROAD_MOVE)
  for (const r of roads) {
    const mv = ROAD_MOVE[r.id]; if (!mv) continue;
    r.orig = { line: r.line, pts: r.pts, w: r.w, kind: r.kind, kerb: r.kerb };
    Object.assign(r, mv); r.line = mv.gone ? mv.pts.map(q => q.slice()) : smoothPolyline(mv.pts, 3);
  }
  shiftRoadsToHouseFrame(roads);   // v1.13
  // v1.13: the houses had been pushed off the lanes where the lanes were drawn (up to 8 m). With the lanes in the
  // houses' frame a house goes back to its traced footprint when that is clear of every road.
  // v1.14 (owner, 23 Nov 2026: nothing may stand on a road — move the houses, parks and trees, keep the roads): a
  // house whose footprint still touches a road is moved to the nearest spot within 16 m that is clear of every road
  // (0.5 m to spare) and of the other houses; the parks, the small green and the football pitch likewise.
  const live = roads.filter(r => !r.gone && r.line.length > 1);
  for (const r of live) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of r.line) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } r.bb = [x0, x1, z0, z1]; }
  const roadIn = (x, z, m) => { let worst = 0; for (const r of live) { const h = r.w / 2 + m; if (x < r.bb[0] - h || x > r.bb[1] + h || z < r.bb[2] - h || z > r.bb[3] + h) continue; worst = Math.max(worst, h - distToPolyline(x, z, r.line).d); } return worst; };
  const rectPts = (b) => { const cs = rectCorners(b), pts = [[b.x, b.z]]; for (let i = 0; i < 4; i++) { const a = cs[i], c = cs[(i + 1) % 4], n = Math.max(2, Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / 2.5)); for (let k = 0; k < n; k++) pts.push([a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n]); } return pts; };
  // a 0.5 m raster of the road surfaces grown by 0.5 m: the search below asks it some hundred thousand times
  const MX0 = REGION.x0 - 20, MZ0 = REGION.z0 - 20, MW = Math.ceil((REGION.x1 - REGION.x0 + 40) * 2), MH = Math.ceil((REGION.z1 - REGION.z0 + 40) * 2), mask = new Uint8Array(MW * MH);
  for (const r of live) {
    const R = (r.w / 2 + 0.5) * 2, Ri = Math.ceil(R);
    for (let i = 0; i + 1 < r.line.length; i++) {
      const [ax, az] = r.line[i], [bx, bz] = r.line[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) * 2));
      for (let k = 0; k <= n; k++) {
        const cx = (ax + (bx - ax) * k / n - MX0) * 2, cz = (az + (bz - az) * k / n - MZ0) * 2, ix = Math.round(cx), iz = Math.round(cz);
        for (let dz = -Ri; dz <= Ri; dz++) { const zz = iz + dz; if (zz < 0 || zz >= MH) continue; for (let dx = -Ri; dx <= Ri; dx++) { const xx = ix + dx; if (xx < 0 || xx >= MW) continue; if ((xx - cx) ** 2 + (zz - cz) ** 2 <= R * R) mask[zz * MW + xx] = 1; } }
      }
    }
  }
  const onMask = (x, z) => { const ix = Math.round((x - MX0) * 2), iz = Math.round((z - MZ0) * 2); return ix >= 0 && iz >= 0 && ix < MW && iz < MH && mask[iz * MW + ix] === 1; };
  const intr = (b) => { for (const p of rectPts(b)) if (onMask(p[0], p[1])) return 1; return 0; };
  const nearRoad = (x, z) => { let bestR = null, best = { d: Infinity }; for (const r of live) { const h = distToPolyline(x, z, r.line); if (h.d < best.d) { best = h; bestR = r; } } return { r: bestR, ...best }; };
  /** nearest position of rectangle b (from x0, z0) that is clear of roads and of `others`; null when there is none within 16 m */
  const clearSpot = (b, x0, z0, others, m = 0.5) => {
    for (let R = 0; R <= 16; R += 1) for (let k = 0; k < (R ? 16 : 1); k++) {
      const a = k * Math.PI / 8, t = { ...b, x: x0 + Math.cos(a) * R, z: z0 + Math.sin(a) * R };
      if (intr(t) > 0) continue;
      if (others.some(o => o !== b && !o.gone && Math.abs(o.x - t.x) < 45 && Math.abs(o.z - t.z) < 45 && rectsOverlap(t, o, 0.4))) continue;
      return [t.x, t.z];
    }
    return null;
  };
  {
    let back = 0, moved = 0, stuck = 0;
    const solid = buildings.concat(extra);
    for (const b of solid) {
      if (b.gone || b.kind === 'minaret' || b.kind === 'mosque' || b.fixed) continue;
      const here = intr(b);
      const start = b.sat && !b.kind && !b.ownerFix && b.data ? b.data : [b.x, b.z];
      if (here <= 0 && Math.hypot(start[0] - b.x, start[1] - b.z) < 0.25) continue;
      if (here <= 0 && (b.ownerFix || !b.sat || b.kind)) continue;
      const spot = clearSpot(b, start[0], start[1], solid);
      if (!spot) { if (here > 0) { stuck++; if (!b.orig && buildings.includes(b)) b.orig = { ...b }; b.gone = true; } continue; }   // no room beside the road: the house is left out
      if (Math.hypot(spot[0] - b.x, spot[1] - b.z) < 0.25) continue;
      if (!b.orig && buildings.includes(b)) b.orig = { ...b };
      b.x = Math.round(spot[0] * 10) / 10; b.z = Math.round(spot[1] * 10) / 10;
      if (!b.ownerFix && !b.kind && buildings.includes(b)) { const h = nearRoad(b.x, b.z), p = h.r.line[h.i]; b.face = Math.atan2(p[1] - b.z, p[0] - b.x); b.front = h.d; }
      setGround(b); if (b.data && Math.hypot(b.x - b.data[0], b.z - b.data[1]) < 0.3) back++; else moved++;
    }
    if (typeof console !== 'undefined') console.log('[layout] v1.14 houses back on their footprints', back, 'moved clear of a road', moved, 'no clear spot', stuck);
  }
  // parks, the small green and the pitch: the whole rectangle moves off the roads, with what stands on it
  const offRoadRect = (g, m = 0.3) => { const t = { yaw: 0, ...g }; if (intr(t) <= 0) return [0, 0]; const sp = clearSpot(t, t.x, t.z, [], m); return sp ? [sp[0] - t.x, sp[1] - t.z] : [0, 0]; };
  const gardens = SITES.gardens.map(g => { if (g.der) return g; const [dx, dz] = offRoadRect(g); if (!dx && !dz) return g;
    return { ...g, x: g.x + dx, z: g.z + dz, ...(g.playAt ? { playAt: [g.playAt[0] + dx, g.playAt[1] + dz, g.playAt[2]] } : {}), ...(g.cardak ? { cardak: { ...g.cardak, x: g.cardak.x + dx, z: g.cardak.z + dz } } : {}) }; });
  const g1 = offRoadRect({ x: SITES.green1.x, z: SITES.green1.z, w: 9, d: 8 }), green1 = { x: SITES.green1.x + g1[0], z: SITES.green1.z + g1[1] };
  const pt = SITES.pitch ? offRoadRect(SITES.pitch) : [0, 0], pitch = SITES.pitch ? { ...SITES.pitch, x: SITES.pitch.x + pt[0], z: SITES.pitch.z + pt[1] } : SITES.pitch;
  // v1.13: the big cemetery's west side is the retaining wall in SV_SITES, not a low wall 15 m inside it
  const cemeteries = (SITES.cemeteries || []).map(c => ({ ...c, open: SV_OPEN, ...(c.label === 'grave strip' ? { wallEdges: [] } : c.label === 'big cemetery' ? { wallEdges: [0] } : {}) }));
  const sites = { ...SITES, gardens, green1, pitch, cemeteries, stoneWalls, roseYard: ROSE_YARD, ownerPlot: OWNER_PLOT, sv: SV_SITES };
  // v1.16: settle the walls placed from photographs against each other (no two side by side)
  registerPhotoWalls(wallBook((x, z, m = 0.3) => live.some(r => distToPolyline(x, z, r.line).d < r.w / 2 + m)), sites, true);
  return { roads, buildings, extra, sites, rnd };
}

// ---------------------------------------------------------------- v1.13: the lanes into the houses' frame
// See road_frame.js. A road keeps its place (weight 0) when it was laid by hand in the true frame (ROAD_MOVE, ROAD_FIX,
// the D.260) or is in ROAD_SHIFT.keep; every other road moves by the full shift (weight 1). At a junction all the
// roads take the same weight — 0 if a hand-laid road is there, else 1 if any road there moves — and each road blends
// from its end weights to its own over `blend` metres, so the network stays joined. The old line is kept as `orig`
// for whatever decides how many random draws are made (pole spacing, garden walls), as in v1.11.
function shiftRoadsToHouseFrame(roads) {
  const RS = ROAD_SHIFT, keep = new Set(RS.keep);
  const hard = (r) => !!r.orig || !!ROAD_FIX[r.id] || /^d260/.test(r.id);
  const own = (r) => (hard(r) || keep.has(r.id) ? 0 : 1);
  const live = roads.filter(r => !r.gone && r.pts.length > 1);
  const touch = (p, q) => distToPolyline(p[0], p[1], q.line).d < 2.5 || (q.orig && q.orig.line.length > 1 && distToPolyline(p[0], p[1], q.orig.line).d < 2.5);
  const endW = (r, p) => {
    let anyHard = hard(r), anyMove = own(r) === 1;
    for (const q of live) { if (q === r || !touch(p, q)) continue; if (hard(q)) anyHard = true; else if (own(q) === 1) anyMove = true; }
    return anyHard ? 0 : anyMove ? 1 : 0;
  };
  const plan = [];
  for (const r of live) {
    if (hard(r)) continue;
    const W = own(r), w0 = endW(r, r.pts[0]), w1 = endW(r, r.pts[r.pts.length - 1]);
    if (!W && !w0 && !w1) continue;
    const cum = [0]; for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
    const L = cum[cum.length - 1], B = Math.min(RS.blend, L / 2 || 1), sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
    const pts = r.pts.map((p, i) => { const a = sm(cum[i] / B), b = sm((L - cum[i]) / B), w = cum[i] < L / 2 ? w0 + (W - w0) * a : w1 + (W - w1) * b; return [p[0] + RS.dx * w, p[1] + RS.dz * w]; });
    plan.push([r, pts]);
  }
  for (const [r, pts] of plan) { r.orig = { line: r.line, pts: r.pts, w: r.w, kind: r.kind, kerb: r.kerb }; r.pts = pts; r.line = smoothPolyline(pts, 3); r.shifted = true; }
}

// ---------------------------------------------------------------- owner's corrections (v0.9.7)
// The houses on the lane north-west of the big cemetery, above the D.260 lake road (owner's screenshot of 9 Nov 2026).
// xz = the house's position in village_data.js; set = what changes.
const OWNER_FIX = [
  { xz: [101.4, 359.6], set: { kind: 'tandir' }, note: 'the small building in front is the tandır house (bread oven), not a dwelling' },
  { xz: [88.6, 350.0], set: { lowerFloor: true, lowerDoorAt: 0, ownWall: 'Duvar_Gul', porch: { dir: [1, 0], span: [0.3, 1.0], depth: 2.8, vine: 3.2 },
      // v1.2 (owner, 11 Nov 2026): a roofed balcony along the south side over the lower storey; the entrance door
      // opens onto the east terrace, at its south end
      balc: { dir: [0, 1], span: [0.0, 0.8], depth: 1.6, balcony: true },
      doors: [{ dir: [1, 0], at: 0.37 }, { dir: [0, 1], at: 0.5, glass: true }] },
    note: 'two storeys on the west, downhill side because of the slope, one storey on the east side behind the trees; soft red-magenta plaster. ' +
          'On the east side the roof runs on over a sitting terrace with a table and chairs, a grapevine pergola in front of it, then the trees ' +
          '(span: the part of the side clear of the tandır, from its south end). ' +
          'v1.1.1 (owner, 11 Nov 2026): on the south face of the lower storey the door and the window swap places — the door on the left, the window on the right as seen from the south' },
  { xz: [60.0, 319.4], set: { storeys: 1 }, note: 'single storey, not two' },
  // v1.17 (Google satellite): the east house of the row north of the D.260 bridge stands right on the lane's edge; its
  // footprint is drawn 2 m in from the lane and 1.5 m shorter so that it is no longer left out
  { xz: [347.7, -121.9], set: { x: 345.5, z: -122.4, w: 13.5 }, note: 'east house of the row west of the north lane, eave to eave with its neighbours' },
  { xz: [117.6, 340.6], set: { wallGone: true }, note: 'no garden wall in front of this house (owner, 11 Nov 2026)' },
  { xz: [88.5, 322.8], set: { wall: 'none' }, note: 'its plot is closed by the stone wall along the lane (STONE_WALLS), not a wire fence' },
  // v0.9.8 (owner's photos of the opening): the white house among the trees west of the çardak plot is the
  // ÇEŞNİGİR-DER association building — single storey, pale grey render, a long glazed front facing the çardak and
  // the main road under a flat concrete canopy, the navy name board over the door, red tile hip roof with a yellow
  // solar water heater. Moved 4 m north so that, as in the photos, the çardak stands in front of its north half and
  // the walkway from the road reaches its south half.
  { xz: [225.3, 154.6], set: { kind: 'dernek', x: 226.2, z: 150.8, faceFix: 0, wall: 'none', tree: false },
    note: 'ÇEŞNİGİR-DER: Köprüköy Çeşnigir Kültür Sosyal Yardımlaşma ve Dayanışma Derneği' },
  // v1.4.1 (owner's screenshot of 13 Nov 2026): there are no houses on the viewpoint rock above the boat pier — only
  // the viewing terrace on top. The satellite tracer had read the terrace deck and the bare rock as two roofs. `gone`
  // houses are run dry in village.js (their random draws are still made, so nothing else in the village changes).
  { xz: [-294.9, -337.9], set: { gone: true }, note: 'not a house: the viewing terrace on the rock' },
  { xz: [-286.5, -349.2], set: { gone: true }, note: 'not a house: bare rock between the terrace and the pier' },
  // v1.5 (the three Street View panoramas the owner linked on 16 Nov 2026, images of Apr 2026; see SV_SITES below).
  // The lane junction west of the centre (panoramas at model 108.2, 277.4 and 97.2, 273.7):
  { xz: [108.4, 296.9], set: { storeys: 2, ownWall: 'Duvar_Visne', wall: 'none', tree: false, band: { dir: [-0.41, -0.91] } },
    note: 'two storeys, dusty-rose render (was one storey of bare stone); on the side facing the junction a white vertical band with a ' +
          'rose diamond, two windows on the ground floor only; no garden wall: an iron gate, a hedge and two junipers (SV_SITES)' },
  { xz: [126.1, 289.8], set: { wall: 'none' }, note: 'no grey wall with a green gate here: the garden is closed by the iron gate and fence on the lane' },
  { xz: [136.2, 268.4], set: { ownWall: 'Duvar_Okr' }, note: 'ochre render, not pink' },
  { xz: [97.4, 238.9], set: { storeys: 1 }, note: 'single storey as seen over the garden wall from the junction (v1.5.1)' },
  { xz: [74.4, 284.3], set: { gone: true }, note: 'not a separate barn: the north half of the long building below' },
  { xz: [81.2, 297.1], set: { x: 77.8, z: 290.7, w: 26.9, d: 9.1, kind: 'koyokulu', name: 'Köprüköy İlkokulu', storeys: 1, ownWall: 'Duvar_Krem', wall: 'none', tree: false, faceFix: -0.42,
      doors: [{ dir: [0.913, -0.408], at: 0.778 }] },
    note: 'Köprüköy İlkokulu (name from the owner): one long single-storey school building (the satellite tracer had split its roof in two houses): cream render, red tile roof, ' +
          'brown doors and a blue sign board, an Atatürk bust and a flag pole in front, pines round it, a dry-stone yard wall with a gate' },
  // v1.6 (two more panoramas from the owner, 16 Nov 2026; model 655.2, 644.5 looking north and 652.6, 554.7 looking west):
  { xz: [645.9, 608.6], set: { storeys: 1, ownWall: 'Duvar_Beyaz', wall: 'none', tree: false },
    note: 'single-storey white house at the back of a long garden plot (was pink behind a grey wall with a big tree); the plot is closed by a block wall, a gate with an outbuilding beside it, wire and green mesh fences (SV_SITES)' },
  { xz: [654.9, 569.5], set: { storeys: 2, ownWall: 'Duvar_Beyaz', wall: 'none', tree: false },
    note: 'clearly two storeys, white (the single-storey rule had lowered it); a stone wall with a gate on the road side' },
  { xz: [648.0, 536.0], set: { x: 648.0, z: 536.0, w: 3.6, d: 3.4, ownWall: 'redWall', wall: 'none', tree: false, barn: true, plain: true }, note: 'not a house: a small red pump hut on the open ground north of the crossroads' },
  // v1.11 (Street View drive down the main road from the çarşı, 35 panoramas of Apr 2026, model 262,166 → 431,453):
  { xz: [251.6, 178.6], set: { ownWall: 'Duvar_Krem', roof: 'g', wall: 'none', tree: false }, note: 'cream single-storey house with its gable end on the road (blue fascia, a sign on the gable wall)' },
  { xz: [256.8, 219.1], set: { x: 255.65, z: 221.5, w: 5.5, d: 13.0, yaw: -0.308, storeys: 2, ownWall: 'Duvar_Somon', wall: 'none', tree: false, stairFix: null, balconyFix: true, faceFix: 0.308 },
    note: 'v1.13 (owner, 23 Nov 2026: the house is L-shaped; screenshots 0676/0677, satellite roof): the salmon-pink house at the fork. This is its west wing, ' +
          'the taller one, garage doors below and the balcony above on the yard side; the lower north wing with the porch is in SV_SITES (was one ochre block turned 45°)' },
  { xz: [269.2, 237.4], set: { ownWall: 'Duvar_Krem', wall: 'none' }, note: 'cream, open ground in front' },
  { xz: [285.4, 237.4], set: { ownWall: 'Duvar_Beyaz', wall: 'none', porch: { dir: [0.71, -0.71], span: [0.1, 0.9], depth: 2.4 } }, note: 'white single-storey house with a columned porch, on the kerbed corner south of the road' },
  { xz: [311.1, 207.4], set: { ownWall: 'Duvar_Beyaz', wall: 'none', tree: false }, note: 'the long white house above the road: its yard is closed by the dry-stone wall along the road (SV_SITES)' },
  { xz: [339.4, 206.6], set: { gone: true }, note: 'no two-storey blue house here: a lawn with young trees; the blue house is the one east of the junction (387, 214)' },
  { xz: [360.2, 206.5], set: { storeys: 2, ownWall: 'Duvar_Krem', balconyFix: true }, note: 'two storeys, cream, a balcony on the upper floor (seen across the lawn from the road)' },
  { xz: [387.3, 214.3], set: { storeys: 2, ownWall: 'Duvar_Mavi', balconyFix: true, wall: 'none' }, note: 'the two-storey pale blue house with white trim at the junction' },
  { xz: [341.7, 253.5], set: { x: 337.6, z: 248.6, yaw: -0.145, w: 23.0, d: 8.0, storeys: 1, ownWall: 'rubble', wall: 'none', tree: false, plain: true, barn: true },
    note: 'old single-storey fieldstone house, long side on the road, low tile roof, one small window (was two storeys of white render, turned 45°); its south wing is in SV_SITES' },
  { xz: [328.5, 247.7], set: { gone: true }, note: 'not a separate house: the west end of the stone house' },
  { xz: [359.0, 289.4], set: { storeys: 2, ownWall: 'Duvar_Sari' }, note: 'two storeys, yellow-green render under a red roof, seen over the shed from the road' },
  { xz: [380.2, 280.5], set: { roof: 'm', barn: true, plain: true, ownWall: 'metalDark', wall: 'none', tree: false }, note: 'a dark sheet-clad shed on the road, not a white flat-roofed house' },
  { xz: [399.4, 351.3], set: { ownWall: 'Duvar_Beton', wall: 'none', tree: false, plain: true }, note: 'bare grey block walls under a tile roof, right on the road' },
  // v1.13 (the owner's 35 Street View screenshots of 23 Nov 2026, images of Apr 2026; docs/REALISM.md)
  { xz: [-12.4, 308.8], set: { x: -13.0, z: 308.0, w: 24.0, d: 12.0, yaw: -1.215, storeys: 2, roof: 'g', ownWall: 'woodRaw', wall: 'none', tree: false, kind: 'lokanta', faceFix: 2.785 },
    note: 'Köprü Et Balık: the big two-storey timber restaurant on the lake road, long side on the road (was a low house turned across the plot)' },
  { xz: [-0.9, 306.7], set: { gone: true }, note: 'part of the restaurant roof, not a house' },
  { xz: [-23.8, 298.3], set: { gone: true }, note: 'replaced by the blue shop north of the restaurant (SV_SITES)' },
  { xz: [-19.5, 305.4], set: { gone: true }, note: 'part of the restaurant roof, not a house' },
  { xz: [221.7, 84.4], set: { ownWall: 'Duvar_Sari', wall: 'none', tree: false }, note: 'the yellow two-storey house with a shop on the ground floor, north-west of the square (0655)' },
  { xz: [268.8, 69.6], set: { ownWall: 'Duvar_Krem', wall: 'none', tree: false, faceFix: Math.PI, plain: true, kind: 'dukkan' }, note: 'the old row of shops on the east side of the main road north of the çarşı (blue shutters), right on the road' },
  { xz: [273.5, 56.5], set: { ownWall: 'Duvar_Krem', wall: 'none', tree: false, faceFix: Math.PI, plain: true, kind: 'dukkan' }, note: 'north half of the same row' },
  { xz: [264.1, 97.9], set: { w: 9.5, d: 8.0, storeys: 2, ownWall: 'Duvar_Krem', wall: 'none', tree: false, faceFix: Math.PI }, note: 'two storeys with shop windows on the ground floor, east of the road at the north end of the square' },
  { xz: [475.5, 665.3], set: { yaw: 2.05, wall: 'none', tree: false, faceFix: 0.48 }, note: 'the long workshop building west of the school road: its long axis runs NW–SE (the tracer had it mirrored)' },
  { xz: [491.8, 698.7], set: { x: 490.5, z: 696.0, w: 22.0, d: 9.5, yaw: 2.05, wall: 'none', tree: false, faceFix: 0.48 }, note: 'the tyre shop (lastikçi) south of it: same axis, open bays on the road side' },
  { xz: [436.0, 362.8], set: { barn: true, plain: true, ownWall: 'Duvar_Okr', wall: 'none', tree: false }, note: 'the small tan hut in the park' },
];
// v1.5: what the three panoramas show besides the houses. Model metres (x east, z south). Nothing here takes a draw
// from the village's random stream, so every other house, tree and detail stays where it was.
//   walls   free-standing walls as polylines: dry stone (default), `key: 'brick'` bare red brick, `key: 'garden'` whitewash
//   extra   buildings the satellite tracer missed (dark old roof under trees)
export const SV_SITES = {
  walls: [
    { pts: [[95.5, 306.0], [93.9, 294.0], [92.7, 283.4]], h: 1.0, note: 'yard wall of the long building, south of its gate, on along the lane' },
    { pts: [[92.2, 280.6], [91.0, 274.5], [89.6, 267.0], [88.6, 262.6]], h: 1.0, note: 'the same wall north of the gate, up to the stone barn' },
    { pts: [[98.6, 258.0], [100.3, 268.5], [101.5, 271.8], [105.5, 272.6], [114.0, 266.5], [123.9, 256.6]], h: 0.9,
      note: 'garden wall on the north side of the junction, curving from the north lane into the east lane' },
    { pts: [[464.6, 548.6], [465.8, 553.4], [469.6, 565.2], [472.0, 568.6], [478.0, 567.6], [490.0, 566.4]], h: 1.8, t: 0.22, key: 'brick', cap: 'brick',
      note: 'bare red-brick garden wall round the corner plot, north-east of the junction by the pylon' },
    { pts: [[382.0, 512.0], [382.6, 560.0], [383.2, 642.0]], h: 1.0, t: 0.3, key: 'garden', cap: 'garden', note: 'low whitewashed cemetery wall beyond the open field' },
    // v1.6: the two plots south of the crossroads (east side of the village)
    { pts: [[612.0, 566.8], [624.0, 565.8], [636.1, 564.3], [649.8, 562.2]], h: 1.0, note: 'stone wall of the two-storey white house, west of its gate' },
    { pts: [[654.4, 561.6], [664.3, 560.2], [666.0, 566.5]], h: 1.0, note: 'the same wall east of the gate and round the corner' },
    { pts: [[666.0, 566.5], [669.3, 577.2], [676.0, 591.0], [685.4, 610.9], [684.5, 625.0]], h: 1.7, t: 0.05, key: 'greenMesh', cap: 'greenMesh', note: 'green mesh screen fence along the road, east side of the garden plot' },
    { pts: [[632.7, 645.7], [641.4, 641.8]], h: 1.5, t: 0.2, key: 'Duvar_Beton', cap: 'Duvar_Beton', note: 'bare block wall on the lane, west of the garden gate' },
    // v1.11: along the main road, from the çarşı down
    { pts: [[291.6, 207.6], [292.4, 212.6], [296.7, 217.5], [306.3, 221.2], [317.0, 225.0], [322.4, 226.8]], h: 1.3,
      note: 'dry-stone wall under the long white house, from the mosque path round the corner and along the road to the garage forecourt' },
    { pts: [[373.5, 254.4], [376.0, 259.8]], h: 1.2, note: 'rubble wall on the west side of the road below the junction' },
    { pts: [[376.0, 259.8], [378.5, 264.9], [381.2, 270.8]], h: 1.7, t: 0.05, key: 'rustSheet', cap: 'rustSheet', note: 'rusty corrugated-sheet fence in front of the yellow two-storey house' },
    { pts: [[403.6, 318.0], [404.6, 326.0]], h: 1.9, t: 0.06, key: 'bluePaint', cap: 'bluePaint', note: 'blue sheet-metal yard gate and fence west of the road' },
    { pts: [[404.6, 326.0], [405.6, 331.5]], h: 1.3, note: 'rubble wall south of the blue gate' },
    { pts: [[411.6, 361.0], [414.2, 370.0]], h: 1.6, t: 0.05, key: 'greenMesh', cap: 'greenMesh', note: 'green shade cloth on a garden fence, west of the road by the park' },
    { pts: [[414.2, 370.0], [417.6, 380.5], [421.4, 392.0]], h: 1.0, note: 'rubble wall along the road, west side, down to the lane' },
    { pts: [[423.6, 416.5], [424.2, 432.5], [424.6, 452.7], [425.5, 468.0]], h: 0.35, t: 0.3, key: 'Duvar_Beton', cap: 'Duvar_Beton', note: 'footing of the red and white iron fence along the west side of the road' },
    { pts: [[437.0, 418.0], [437.2, 428.0]], h: 1.8, t: 0.05, key: 'metalDark', cap: 'metalDark', note: 'black shade cloth on the fence east of the road' },
    { pts: [[437.2, 428.0], [437.4, 438.0]], h: 1.8, t: 0.05, key: 'greenMesh', cap: 'greenMesh', note: 'green shade cloth, the same fence further south' },
    { pts: [[437.4, 438.0], [437.8, 462.0]], h: 1.0, t: 0.22, key: 'Duvar_Beton', cap: 'Duvar_Beton', note: 'grey block garden wall with iron railings on top, east of the road' },
    // v1.13 (owner's screenshots 0666/0667): the tall rubble retaining wall round the west corner of the big cemetery, above the lane up from the D.260
    { pts: [[120.0, 485.0], [119.0, 476.0], [121.0, 468.5], [127.0, 461.0], [138.0, 451.0], [150.0, 441.0], [162.0, 432.0], [171.0, 426.5]], h: 2.7, t: 0.7, note: 'cemetery retaining wall' },
    { pts: [[427.6, 468.6], [428.3, 478.3]], h: 0.4, t: 0.3, key: 'whitewash', cap: 'kerbBlue', note: 'footing of the blue and white balustrade north of the cemetery gate (0672)' },
    { pts: [[428.9, 482.6], [430.0, 494.0], [432.5, 506.0], [435.5, 518.0]], h: 0.4, t: 0.3, key: 'whitewash', cap: 'kerbBlue', note: 'the same, south of the gate' },
    { pts: [[253.4, 61.5], [252.8, 66.6]], h: 0.45, t: 0.3, key: 'redWall', cap: 'redWall', note: 'low red wall of the pine park on the main road, north of its arch (0652)' },
    { pts: [[252.6, 69.4], [252.0, 76.5], [244.0, 77.0], [237.0, 76.0]], h: 0.45, t: 0.3, key: 'redWall', cap: 'redWall', note: 'the same, south of the arch and along the back' },
    { pts: [[150.0, 250.0], [142.0, 252.0], [133.5, 254.5], [126.0, 259.5]], h: 1.0, note: 'dry-stone garden wall on the north side of the lane east of the junction (0682–0684)' },
  ],
  extra: [
    { x: 644.2, z: 636.6, yaw: 0.42, w: 6.0, d: 3.8, storeys: 1, roof: 'g', barn: true, plain: true, wallKey: 'Duvar_Beton', note: 'block outbuilding with a tile roof beside the garden gate' },
    { x: 670.2, z: 602.8, yaw: -1.158, w: 8.0, d: 6.5, storeys: 1, roof: 'm', barn: true, plain: true, wallKey: 'Duvar_Beton', note: 'sheet-roofed shed on the east side of the garden plot' },
    { x: 86.0, z: 258.8, yaw: 0.735, w: 8.5, d: 4.4, storeys: 1, roof: 'g', barn: true, plain: true, wallKey: 'rubble', note: 'old rubble-stone barn with a low tile roof at the junction' },
    // v1.11: buildings on the main road the roof tracer missed (under trees, grey or flat roofs)
    { x: 271.6, z: 151.6, yaw: -0.08, w: 13.5, d: 10.0, storeys: 2, roof: 'h', wallKey: 'Duvar_Beyaz', face: Math.PI, stairFix: '+z', balconyFix: false,
      note: 'two-storey white house east of the road, north of the mosque garden: outside stair up to a balcony' },
    { x: 288.8, z: 152.4, yaw: -0.08, w: 14.5, d: 10.5, storeys: 2, roof: 'g', wallKey: 'Duvar_Mint', face: Math.PI, stairFix: null, note: 'two-storey mint-green building behind it' },
    { x: 256.9, z: 188.6, yaw: -0.117, w: 9.0, d: 8.0, storeys: 2, roof: 'h', wallKey: 'Duvar_Somon', kind: 'shop', face: 0, stairFix: '+z', balconyFix: false,
      note: 'the two-storey shop west of the road: shop front under a canopy on the road side, tan render above, outside stair on the south side' },
    { x: 332.5, z: 219.5, yaw: -0.253, w: 10.0, d: 7.0, storeys: 1, roof: 'f', plain: true, wallKey: 'Duvar_Okr', kind: 'garage', face: Math.PI / 2,
      note: 'flat-roofed tan garage with a blue double door behind a gravel forecourt; steel frame of an unfinished storey on the roof' },
    { x: 343.6, z: 258.0, yaw: -0.145, w: 11.0, d: 10.5, storeys: 1, roof: 'h', plain: true, wallKey: 'rubble', note: 'south wing of the old stone house' },
    // v1.13: the shops on the lake road either side of the restaurant, and the arcade of the cemetery yard
    { x: -9.5, z: 331.0, yaw: -1.215, w: 5.0, d: 4.5, storeys: 1, roof: 'g', plain: true, barn: true, wallKey: 'woodRaw', face: 2.785, kind: 'shop', note: 'Kasap Yunus: small timber butcher\'s kiosk with a glass front' },
    { x: -5.0, z: 340.5, yaw: -1.215, w: 9.5, d: 6.5, storeys: 1, roof: 'h', plain: true, wallKey: 'bluePaint', face: 2.785, kind: 'shop', note: 'Elçim Köylü Pazarı: blue mini-market under a tile roof' },
    { x: -26.5, z: 296.0, yaw: -1.215, w: 6.0, d: 5.5, storeys: 1, roof: 'h', plain: true, wallKey: 'bluePaint', face: 2.785, kind: 'shop', note: 'blue shop north of the restaurant' },
    { x: -29.5, z: 286.0, yaw: -1.215, w: 7.5, d: 6.0, storeys: 2, roof: 'g', plain: true, wallKey: 'woodRaw', face: 2.785, stairFix: null, balconyFix: false, note: 'timber fish shop on posts (open ground floor)' },
    { x: 423.0, z: 499.5, yaw: -1.41, w: 25.0, d: 4.5, storeys: 1, roof: 'm', barn: true, plain: true, wallKey: 'Duvar_Beton', note: 'east wing of the cemetery yard\'s shelter, along the road' },
    { x: 415.0, z: 516.0, yaw: -0.18, w: 22.0, d: 4.5, storeys: 1, roof: 'm', barn: true, plain: true, wallKey: 'Duvar_Beton', note: 'its south wing' },
    { x: 261.95, z: 219.85, yaw: -0.308, w: 5.5, d: 6.0, storeys: 1, roof: 'h', wallKey: 'Duvar_Somon', face: 1.263, porch: { dir: [0.953, 0.303], span: [0.0, 1.0], depth: 2.2 },
      note: 'north wing of the salmon-pink L-shaped house: single storey, doors onto the yard in the corner of the L, a columned porch on its east end towards the mosque' },
    // v1.15 (owner's screenshots 0685–0687)
    { x: 263.2, z: 117.2, yaw: 0, w: 11.0, d: 6.5, storeys: 2, roof: 'h', wallKey: 'Duvar_Visne', kind: 'shop', face: Math.PI, stairFix: null, balconyFix: false,
      note: 'the salmon-red old two-storey house joined to the north side of Güvendioğlu Market, a shop under a sheet canopy on its ground floor' },
    { x: 275.6, z: 49.6, yaw: -1.85, w: 10.5, d: 7.0, storeys: 2, roof: 'f', plain: true, wallKey: 'Duvar_Krem', kind: 'dukkan', tall: true, face: Math.PI,
      note: 'the taller flat-roofed block at the north end of the old row of shops: three bays with two rows of grilles' },
    { x: 398.5, z: 338.3, yaw: -1.451, w: 9.0, d: 6.0, storeys: 1, roof: 'm', barn: true, plain: true, wallKey: 'rubble', note: 'rubble barn with a rusty sheet roof on the road, north of the grey block house' },
  ],
  gates: [{ a: [108.7, 280.9], b: [112.9, 280.3], h: 1.75 },                     // two-leaf wrought-iron gate, meter box on its west pillar
    { a: [650.0, 562.2], b: [654.2, 561.6], h: 1.7 }, { a: [645.6, 639.9], b: [648.6, 638.5], h: 1.5 }],   // v1.6: the white house's gate; the garden gate
  fences: [{ pts: [[113.2, 280.2], [115.8, 276.6], [122.5, 270.5]], h: 1.5 },   // iron fence on along the east lane
    { pts: [[649.0, 638.3], [666.0, 630.9], [684.5, 625.0]], h: 1.3 },          // v1.6: wire fence of the garden along the lane
    // v1.11: white pickets between red posts on a low footing, west side of the road south of the lake lane
    { pts: [[423.6, 416.5], [424.2, 432.5], [424.6, 452.7], [425.5, 468.0]], h: 1.05, y: 0.35, key: 'trim', post: 'redPaint' },
    { pts: [[437.4, 438.0], [437.8, 462.0]], h: 0.9, y: 1.0 },                  // v1.11: iron railings on the block wall east of the road
    // v1.13: blue-white concrete balustrade along the cemetery yard; red-brown railings of the pine park
    { pts: [[427.6, 468.6], [428.3, 478.3]], h: 0.8, y: 0.4, key: 'trim', post: 'kerbBlue' },
    { pts: [[428.9, 482.6], [430.0, 494.0], [432.5, 506.0], [435.5, 518.0]], h: 0.8, y: 0.4, key: 'trim', post: 'kerbBlue' },
    { pts: [[253.4, 61.5], [252.8, 66.6]], h: 0.7, y: 0.45, key: 'redWall', post: 'redWall' },
    { pts: [[252.6, 69.4], [252.0, 76.5], [244.0, 77.0], [237.0, 76.0]], h: 0.7, y: 0.45, key: 'redWall', post: 'redWall' }],
  // v1.13: arched gateways (two pillars and an arch): the cemetery's blue gate, the park's red arch
  arches: [{ x: 428.6, z: 480.5, yaw: -1.47, w: 3.4, h: 3.6, key: 'kerbBlue' }, { x: 252.7, z: 68.0, yaw: -1.47, w: 2.0, h: 3.0, key: 'redWall' }],
  // v1.13: the gate of the Çeşnigir bridge and canyon park on the lake road (0663–0665): timber gable roof on two
  // orange piers across the road, the dark ticket kiosk in the middle
  parkGate: { x: -95.0, z: 183.0, yaw: 0.49 },
  // v1.13: interlocking paving in front of the shops on the lake road; `solids` = collision boxes (x, z, yaw, half w, half d)
  paved: [{ x: -19.5, z: 318.0, w: 13.0, d: 70.0, yaw: 0.356 }, { x: -92.0, z: 196.0, w: 12.0, d: 22.0, yaw: 0.49 }],
  pylons: [{ x: 268.6, z: 43.6 }],   // v1.15: the lattice pylon at the north end of the old shops (0687)
  solids: [[-95.0, 183.0, 0.49, 1.7, 1.4], [-88.4, 179.5, 0.49, 1.5, 1.2], [-101.6, 186.5, 0.49, 1.5, 1.2], [428.6, 480.5, -1.47, 0.3, 0.3]],
  // v1.11: the park's lawn follows the road from its north tip (the garden rectangle in SITES covers the middle)
  lawns: [{ x: 425.8, z: 343.7, w: 16, d: 64, yaw: 0.305 }],
  // v1.11: concrete posts with three wires round the lawn north of the road and the garden at the junction
  wireFences: [
    { pts: [[337.5, 229.6], [352.0, 232.6], [364.0, 234.6]], h: 1.4 },
    { pts: [[384.0, 246.5], [389.5, 258.0], [394.5, 269.0]], h: 1.4 },
    { pts: [[352.0, 244.8], [366.0, 247.0], [373.0, 252.5]], h: 1.4 }],
  tank: { x: 651.0, z: 545.2, yaw: 0.2 },                                        // v1.6: steel water tank on a stone pedestal at the crossroads
  hedges: [{ pts: [[107.3, 283.4], [102.8, 285.6], [101.3, 289.5], [101.4, 294.5]], h: 1.7, t: 1.3 }],
  bust: { x: 83.6, z: 280.4, face: [0.913, -0.408] }, flagPole: { x: 82.4, z: 282.6, face: [0.913, -0.408] },
  pylon: { x: 475.2, z: 571.6 },                                                  // rusty steel lattice pylon on the kerbed corner
  trees: [
    ['juniper', 115.5, 280.5, 1.1], ['juniper', 109.3, 283.5, 1.0],
    ['pine', 88.6, 288.0, 0.85], ['pine', 88.2, 293.6, 0.95], ['pine', 89.4, 299.4, 0.85], ['pine', 86.4, 277.4, 0.9],
    ['mulberry', 84.0, 268.2, 1.2],                                               // the big bare tree over the barn
    ['pine', 68.0, 285.0, 1.0], ['pine', 70.5, 295.5, 0.9], ['pine', 66.0, 276.0, 0.95],
    ['pine', 651.5, 634.6, 0.55], ['fruit', 655.0, 628.0, 0.7], ['fruit', 660.0, 622.0, 0.75], ['fruit', 652.0, 620.0, 0.7], ['fruit', 664.0, 615.0, 0.7],   // v1.6: the garden
    ['mulberry', 667.5, 538.0, 1.0], ['mulberry', 674.0, 536.5, 0.95],             // v1.6: the old trees north-east of the crossroads
    ['mulberry', 447.2, 568.5, 1.3],                                              // the big tree on the south-west corner
    ['mulberry', 447.0, 556.0, 1.0], ['poplar', 442.6, 541.0, 1.0], ['mulberry', 438.2, 527.0, 0.9], ['mulberry', 433.2, 512.0, 1.0],   // the row along the road's west side
    // v1.11: the trees that stand out along the main road (kept small: the model's crowns are fuller than the bare April trees)
    ['mulberry', 277.6, 186.0, 0.75],                                                      // on the lawn strip under the mosque garden wall
    ['mulberry', 289.6, 216.6, 0.8], ['mulberry', 302.0, 220.6, 0.75],                     // the two old mulberries in front of the stone wall
    ['fruit', 276.0, 231.5, 0.7],                                                          // by the porch house
    ['fruit', 341.0, 226.5, 0.7], ['fruit', 347.5, 224.0, 0.7], ['fruit', 356.5, 227.0, 0.75], ['fruit', 344.0, 218.0, 0.7],   // the lawn north of the road
    ['mulberry', 367.5, 232.0, 0.9],                                                       // the big tree at the junction
    ['fruit', 389.5, 250.0, 0.7], ['fruit', 394.0, 256.0, 0.7], ['fruit', 397.0, 263.0, 0.7],   // the fenced garden at the junction
    ['mulberry', 411.5, 300.0, 0.95],                                                      // the big bare tree at the north tip of the park
    ['mulberry', 437.0, 367.5, 0.9], ['mulberry', 441.5, 372.0, 0.9], ['mulberry', 431.5, 386.0, 0.9],   // the old trees at the south end of the park
    ['pine', 420.6, 441.0, 1.0], ['pine', 420.0, 447.0, 1.1], ['pine', 420.4, 453.5, 1.0],   // the spruces behind the red and white fence
    // v1.13 (owner's screenshots)
    ['mulberry', -3.0, 325.0, 1.3], ['mulberry', 2.5, 336.0, 1.2], ['mulberry', -20.0, 291.0, 1.0],                       // the willows behind the shops on the lake road
    ['mulberry', -56.0, 266.0, 0.8], ['mulberry', -61.0, 255.0, 0.8], ['mulberry', -66.0, 244.5, 0.8], ['mulberry', -71.0, 234.0, 0.8], ['mulberry', -76.0, 223.5, 0.8],   // the row west of the road to the gate
    ['mulberry', -86.0, 207.5, 1.0], ['mulberry', -84.5, 214.5, 0.9],                                                     // the trees on the island before the gate
    ['pine', 124.0, 476.0, 0.9], ['pine', 126.5, 468.0, 1.0], ['pine', 132.0, 462.5, 0.9], ['pine', 139.0, 456.0, 1.0], ['pine', 146.5, 449.5, 0.9], ['pine', 154.0, 443.0, 1.0], ['pine', 162.0, 437.0, 0.9],   // behind the cemetery's retaining wall
    ['mulberry', 110.0, 464.0, 1.0],                                                                                       // the willow on the lane below it
    ['mulberry', 418.0, 478.0, 1.5], ['pine', 405.0, 497.0, 0.9], ['pine', 404.5, 506.0, 0.9], ['pine', 428.0, 512.0, 0.85],   // the big tree and the pines of the cemetery yard
    ['pine', 240.0, 65.0, 1.2], ['pine', 246.5, 71.5, 1.3], ['pine', 248.5, 63.5, 1.1], ['pine', 241.0, 73.5, 1.1],       // the pine park on the main road
  ],
  grove: { x0: 484, x1: 522, z0: 582, z1: 624, step: 6.2, species: 'pine' },     // the pine wood between the junction and the school
};
// The field between the big cemetery and the main road is open grass (panorama at model 464.5, 574.6 looking west): no
// graves or cemetery trees east of the whitewashed wall. The cemeteries' draws are still made, the results dropped.
// Two-storey houses that a Street View panorama shows as two storeys (tools/sv_overrides.json, positions as in
// village_data.js). Every other house is single storey.
const TWO_STOREY_SEEN = [[130.8, 36.7], [133.0, -86.7], [122.3, 227.8], [239.6, -73.9], [461.8, 202.2], [507.1, 380.3], [286.5, -83.0], [552.4, 129.8],
  [626.3, 447.5], [344.1, -69.9], [519.1, 51.9], [130.8, -46.4], [341.7, 253.5], [525.6, 84.2], [670.1, 407.1], [402.9, 117.1], [606.4, 601.0], [420.5, 283.8],
  [221.9, 85.4], [49.6, 212.2], [637.4, 357.9], [339.4, 206.6], [233.9, -150.6], [66.8, 195.6], [435.3, 127.1], [536.3, 432.5]];
const SV_OPEN = { x0: 383, x1: 440, z0: 505, z1: 730 };
// v1.3 (owner's screenshot of 11 Nov 2026): the yard on the south side of the dusty-rose house (88.6, 350.0). A low
// galvanised wire-mesh fence runs from the house's south-west corner round the open ground to the tandır by the
// fruit tree (the line the owner drew, cast onto the terrain from his view); inside it, where he put the two
// crosses, a garden table with four chairs and a two-seat swing, and between the swing and the fence a small
// saddled donkey for riding. Model metres (x east, z south); no random draws, so nothing else in the village moves.
const ROSE_YARD = {
  fence: { h: 1.0, pts: [[80.5, 356.9], [78.9, 358.3], [77.7, 360.1], [77.0, 362.6], [77.1, 364.8], [78.5, 367.8], [80.8, 371.6],
    [84.6, 373.4], [89.0, 374.0], [94.2, 373.4], [97.2, 372.2], [99.3, 370.3], [99.9, 368.3], [100.9, 365.2]] },
  table: { x: 83.3, z: 364.6, yaw: 3.07 },          // first cross: wooden garden table, four white plastic chairs
  swing: { x: 90.7, z: 367.4, yaw: 3.07 },          // second cross: blue A-frame swing, beam along the house
  donkey: { x: 94.6, z: 369.3, head: [0.34, 0.94] }, // beside it, head towards the fence's south side
};
// Dry-stone walls along a lane: `road` = road id, the wall runs on the `toward` side of it, `off` metres from the
// centreline, between the points of the lane nearest to `from` and `to`; `gaps` = openings (x, z, width).
const STONE_WALLS = [
  { road: 'local_367', from: [78, 334], to: [99, 286], toward: [88.5, 322.8], off: 3.0, h: 1.15, gaps: [[92.0, 333.5, 10.0]],
    note: 'stone wall along the lane on the north / west side, in front of the cream house and up the hill (owner); ' +
          'v1.2: open from the cream house\'s gate to the bend, opposite the dusty-rose house\'s gate (owner, 11 Nov 2026)' },
];
// v1.4 (owner's drawing on the Orbit screenshot of 11 Nov 2026): the open field west and south of the dusty-rose
// house. Black line = a chain-link fence round the field, from the tandır's south-east corner, south along the
// lake-road side, west and back up to the house's north-west corner; green = trees to plant; red = a kamelya
// (wooden garden gazebo) in front of the house's two-storey west side. Points were read off the screenshot by
// casting each drawn pixel onto the terrain from the matched camera (cam -28, 50, 445 → target 93.7, 33.7, 352.6)
// and kept ≥ 1.6 m off the road edges.
export const OWNER_PLOT = {
  fence: [[103.4, 365.9], [107.1, 368.5], [109.0, 371.6], [108.8, 373.8], [104.2, 379.4], [91.1, 391.9], [70.4, 402.1],
    [52.2, 409.1], [41.5, 410.3], [20.4, 409.7], [15.9, 399.0], [16.3, 392.9], [20.3, 385.2], [33.3, 369.5], [40.3, 362.8],
    [45.7, 359.4], [70.4, 346.3], [81.0, 342.6]],
  trees: [[80.6, 376.4], [85.0, 385.5], [48.8, 375.9], [36.6, 378.7], [60.5, 401.4], [53.5, 395.1], [28.9, 377.9],
    [44.0, 390.3], [33.3, 392.3], [23.0, 390.8], [34.5, 406.8], [22.8, 401.1]],
  kamelya: { x: 68.8, z: 353.8, w: 3.6, d: 3.6, yaw: -0.07 },   // squared to the house (yaw 3.07 − π)
};
/** The owner's fence as straight pieces [x0, z0, x1, z1]. */
export const fencePieces = (pts) => pts.slice(1).map((p, i) => [pts[i][0], pts[i][1], p[0], p[1]]);
function stoneWallLine(roads, sw) {
  const r = roads.find(q => q.id === sw.road); if (!r) return null;
  const L = r.line, i0 = distToPolyline(sw.from[0], sw.from[1], L).i, i1 = distToPolyline(sw.to[0], sw.to[1], L).i;
  const a = Math.min(i0, i1), z = Math.max(i0, i1) + 1, pts = [];
  for (let i = a; i <= z && i < L.length; i++) {
    const p = L[Math.max(0, i - 1)], q = L[Math.min(L.length - 1, i + 1)], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1;
    let nx = -dz / len, nz = dx / len;
    if ((sw.toward[0] - L[i][0]) * nx + (sw.toward[1] - L[i][1]) * nz < 0) { nx = -nx; nz = -nz; }
    pts.push([L[i][0] + nx * sw.off, L[i][1] + nz * sw.off]);
  }
  return { pts, h: sw.h, gaps: sw.gaps || [], fromRoad: true };
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
  for (const w of sites.stoneWalls || []) for (const [x0, z0, x1, z1] of wallRuns(w)) out.push((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0), Math.hypot(x1 - x0, z1 - z0) / 2, 0.3);
  const sv = sites.sv;          // v1.5: Street View additions — the barn, the gate and iron fence, the bust, the pylon
  if (sv) {
    for (const e of sv.extra) out.push(e.x, e.z, e.yaw, e.w / 2, e.d / 2);
    for (const [x0, z0, x1, z1] of [...sv.gates.map(g => [...g.a, ...g.b]), ...sv.fences.flatMap(f => fencePieces(f.pts))]) out.push((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0), Math.hypot(x1 - x0, z1 - z0) / 2, 0.08);
    for (const q of sv.solids || []) out.push(...q);
    out.push(sv.bust.x, sv.bust.z, 0, 0.6, 0.6, sv.pylon.x, sv.pylon.z, 0, 0.8, 0.8, sv.tank.x, sv.tank.z, sv.tank.yaw, 1.0, 0.7);
  }
  const op = sites.ownerPlot;   // v1.4: the owner's kamelya and chain-link fence
  if (op) {
    const k = op.kamelya; out.push(k.x, k.z, k.yaw, k.w / 2 + 0.15, k.d / 2 + 0.15);
    for (const [x0, z0, x1, z1] of fencePieces(op.fence)) out.push((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0), Math.hypot(x1 - x0, z1 - z0) / 2, 0.08);
  }
  return out;
}
// ---------------------------------------------------------------- no two walls side by side (v1.16, owner) ----
// Two walls count as running side by side when they are nearly parallel, overlap along their length and lie less
// than WALL_GAP apart with no road between them (the 2.8 m of v1.14 left pairs 3–5 m apart standing). The wall book
// keeps every piece that stands; alongside() gives the distance to a piece of another owner beside this one, or -1.
export const WALL_GAP = 5;
export function wallBook(roadHit) {
  const segs = [], built = [];   // built: [ax, az, bx, bz, owner], read by tools/wall_audit.mjs
  const reg = (ax, az, bx, bz, own) => { const L = Math.hypot(bx - ax, bz - az) || 1; segs.push([ax, az, bx, bz, own, (bx - ax) / L, (bz - az) / L, L]); built.push([ax, az, bx, bz, own]); };
  const book = { segs, built, reg, roadHit, hit: null };
  book.alongside = (ax, az, bx, bz, own) => {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L; let best = -1;
    for (const w of segs) {
      if (w[4] === own || Math.abs(w[0] - mx) > 60 || Math.abs(w[1] - mz) > 60) continue;
      if (Math.abs(ux * w[5] + uz * w[6]) < 0.75) continue;
      const s = (mx - w[0]) * w[5] + (mz - w[1]) * w[6], s2 = ((w[0] + w[2]) / 2 - ax) * ux + ((w[1] + w[3]) / 2 - az) * uz;
      if ((s < -0.6 || s > w[7] + 0.6) && (s2 < -0.6 || s2 > L + 0.6)) continue;   // neither middle lies opposite the other piece
      const d = Math.abs((mx - w[0]) * w[6] - (mz - w[1]) * w[5]); if (d >= WALL_GAP || (best >= 0 && d >= best)) continue;
      if (d > 2.8 && roadHit((mx + w[0] + s * w[5]) / 2, (mz + w[1] + s * w[6]) / 2, 0)) continue;   // the two sides of a lane
      best = d; book.hit = w;
    }
    return best;
  };
  return book;
}
/** Enters the fences, gates, hedges and walls placed from photographs in a wall book. With `settle` (the layout) it
 *  first decides, wall by wall, which pieces stand: fences, gates and hedges stay as they are, then the walls
 *  measured in a panorama, then the walls laid along a road line. A piece that would run beside something already
 *  there (0.45–5 m to its side; closer is one structure, like railings on their footing) is left out (w.drop), and
 *  where a wall stops for that reason a short piece joins it to the other wall (w.joins): no open end, no step. */
export function registerPhotoWalls(book, sites, settle = false) {
  const sv = sites.sv, line = (pts, own) => pts.slice(1).forEach((p, i) => book.reg(pts[i][0], pts[i][1], p[0], p[1], own));
  if (sv) [...(sv.fences || []), ...(sv.wireFences || []), ...(sv.hedges || []), ...sv.gates.map(g => ({ pts: [g.a, g.b] }))].forEach((f, fi) => line(f.pts, 'pf' + fi));
  if (sites.roseYard) line(sites.roseYard.fence.pts, 'rose');
  if (sites.ownerPlot) line(sites.ownerPlot.fence, 'plot');
  (sites.stoneWalls || []).map((w, wi) => [w, wi]).sort((a, b) => (a[0].fromRoad ? 1 : 0) - (b[0].fromRoad ? 1 : 0)).forEach(([w, wi]) => {
    const own = 'sw' + wi;
    if (settle) {
      w.drop = new Set(); w.joins = [];
      const beside = (q) => book.alongside(...q, own) > 0.45;
      const join = (x, z) => { const h = book.hit, t = Math.max(0, Math.min(1, ((x - h[0]) * h[5] + (z - h[1]) * h[6]) / h[7])), fx = h[0] + t * (h[2] - h[0]), fz = h[1] + t * (h[3] - h[1]), d = Math.hypot(fx - x, fz - z);
        if (d > 0.3 && d < WALL_GAP + 1 && !book.roadHit((x + fx) / 2, (z + fz) / 2, 0.3)) w.joins.push([x, z, fx, fz]); };
      let prev = null, end = null, nb = 0;   // prev: the piece before was kept (true) / left out (false) / this is a start (null)
      wallPieces(w).forEach(([ax, az, bx, bz], pi) => {
        const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2.5)); if (end && Math.hypot(end[0] - ax, end[1] - az) > 0.6) prev = null;   // a gap (gate)
        for (let i = 0; i < k; i++) {
          const q = [ax + (bx - ax) * i / k, az + (bz - az) * i / k, ax + (bx - ax) * (i + 1) / k, az + (bz - az) * (i + 1) / k];
          if (book.roadHit((q[0] + q[2]) / 2, (q[1] + q[3]) / 2, 0.3)) { w.drop.add(pi + ':' + i); prev = null; continue; }   // v1.14: no wall across a road
          if (beside(q)) { w.drop.add(pi + ':' + i); nb++; if (prev === true) join(q[0], q[1]); prev = false; }
          else { if (prev === false) join(q[0], q[1]); prev = true; }
        }
        end = [bx, bz];
      });
      if (nb) console.log('[layout] v1.16 wall', wi, '(' + (w.note || 'along a road') + '):', nb, 'pieces left out,', w.joins.length, 'joined to the wall beside');
    }
    for (const q of wallRuns(w)) book.reg(...q, own);
  });
}
/** A stone wall as the pieces that stand ([x0, z0, x1, z1], at most 2.5 m each once it has been settled), joins included. */
export function wallRuns(w) {
  if (!w.drop || !w.drop.size) return [...wallPieces(w), ...(w.joins || [])];
  const out = [];
  wallPieces(w).forEach(([ax, az, bx, bz], pi) => {
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2.5));
    for (let i = 0; i < k; i++) if (!w.drop.has(pi + ':' + i)) out.push([ax + (bx - ax) * i / k, az + (bz - az) * i / k, ax + (bx - ax) * (i + 1) / k, az + (bz - az) * (i + 1) / k]);
  });
  return [...out, ...w.joins];
}
/** A stone wall as straight pieces [x0, z0, x1, z1], with its gaps left open. */
export function wallPieces(w) {
  const out = [], open = (x, z) => w.gaps.some(([gx, gz, gw]) => Math.hypot(x - gx, z - gz) < gw / 2);
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const [ax, az] = w.pts[i], [bx, bz] = w.pts[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 0.5));
    let s0 = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, o = open(x, z);
      if (!o && s0 === null) s0 = t;
      if ((o || k === n) && s0 !== null) { const t1 = o ? (k - 1) / n : t; if (t1 > s0) out.push([ax + (bx - ax) * s0, az + (bz - az) * s0, ax + (bx - ax) * t1, az + (bz - az) * t1]); s0 = null; }
    }
  }
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
  for (const b of buildings) if (!b.gone) out.push(b.x, b.z, b.yaw, b.w / 2, b.d / 2);
  return out;
}
