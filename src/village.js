// Procedural rebuild of the Köprüköy village centre (v0.8): connected roads with kerbs and pavements,
// houses with real window reveals, sills, eaves, gutters, balconies, stairs and roof clutter, the old
// municipality with the Atatürk statue on its square, the mosque with its courtyard, and street props.
// Layout comes from village_layout.js; materials from village_materials.js; props from props.js.
import * as THREE from 'three';
import { GeoBatch, box, boxY, cyl, facadeWithHoles, roofGeometry, gableEnds, ribbon, patch } from './geo.js';
import { inRegion, inCentreZone, rectCorners, distToPolyline, inCarsi } from './village_layout.js';
import { buildProps } from './props.js';

const WALLS = ['Duvar_Beyaz', 'Duvar_Beyaz', 'Duvar_Beyaz', 'Duvar_Krem', 'Duvar_Krem', 'Duvar_Okr', 'Duvar_Pembe', 'Duvar_Sari', 'Duvar_Gri'];
const TILES = ['Cati_Kiremit', 'Cati_Kiremit', 'Cati_Kiremit_Koyu', 'Cati_Kiremit_Turuncu', 'Cati_Kiremit_Acik'];
export const LIFT = { asphalt: 0.12, concrete: 0.1, dirt: 0.08, square: 0.06 };
const FLOOR = 2.9, PLINTH = 0.45;

// ---------------------------------------------------------------------------------------------------
/** Remove the old draft inside the rebuilt region: houses, village roads, the mosque, and the trees. */
export function pruneOldVillage(model, full = false) {
  const inZone = full ? inRegion : inCentreZone;
  const v = new THREE.Vector3(), removed = { houses: 0, roads: 0, trees: 0 };
  const dropChildren = (groupName, test) => {
    const g = model.getObjectByName(groupName); if (!g) return 0; let n = 0;
    for (const c of g.children.slice()) { c.getWorldPosition(v); if (test(c, v)) { c.removeFromParent(); n++; } }
    return n;
  };
  removed.houses = dropChildren('Konutlar', (c, p) => inZone(p.x, p.z));
  if (full) removed.roads = dropChildren('Yollar', (c, p) => inRegion(p.x, p.z) && !/^D260/.test(c.name));
  dropChildren('Kiyi_ve_Kamu', (c) => /^Cami/.test(c.name));
  // trees are two merged meshes: drop the triangles whose centroid lies in the region
  for (const name of ['Agaclar_Yaprak', 'Agaclar_Govde']) {
    const m = model.getObjectByName(name); if (!m || !m.isMesh) continue;
    m.updateMatrixWorld(true);
    const g = m.geometry, pos = g.attributes.position, idx = g.index ? g.index.array : null, tri = idx ? idx.length / 3 : pos.count / 3, keep = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < tri; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(pos, i1).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(pos, i2).applyMatrix4(m.matrixWorld);
      if (!inZone((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)) keep.push(i0, i1, i2); else removed.trees++;
    }
    g.setIndex(keep); g.computeBoundingSphere(); g.computeBoundingBox();
  }
  console.log('[village] removed old draft:', removed);
  return removed;
}

// ---------------------------------------------------------------------------------------------------
/** Build the whole village. Returns { group, update } ; adds nothing to the scene itself. */
export function buildVillage(ctx, layout, M) {
  const { terrH, D } = ctx;
  const rnd = layout.rnd;
  const group = new THREE.Group(); group.name = 'Koy';
  const bat = new GeoBatch();
  const wires = [];                       // line segments for fence wires and overhead cables
  const treeSpots = [], props = [];       // handed to props.js
  const roads = layout.roads, centreOnly = !!layout.centreOnly;
  const yAt = (x, z) => terrH(x, z);
  const roadDist = (x, z) => { let best = Infinity, bw = 0; for (const r of roads) { const h = distToPolyline(x, z, r.line); if (h.d < best) { best = h.d; bw = r.w; } } return { d: best, w: bw }; };
  const onRoad = (x, z, margin = 0) => { const h = roadDist(x, z); return h.d < h.w / 2 + margin; };
  let bid = 5000;

  // ================================================================= roads
  const lift = (r) => LIFT[r.kind] + roads.indexOf(r) * 0.003;
  for (const r of roads) {
    if (centreOnly) break;
    const hw = r.w / 2, L = lift(r);
    const prof = [{ u: -hw - 1.0, dy: L * 0.25 }, { u: -hw, dy: L }, { u: -hw * 0.5, dy: L }, { u: 0, dy: L + 0.04 }, { u: hw * 0.5, dy: L }, { u: hw, dy: L }, { u: hw + 1.0, dy: L * 0.25 }];
    // on the çarşı the open square is the carriageway: no asphalt ribbon there, the square's gravel shows (photos 02, 05)
    let seg = [];
    const flushRoad = () => { if (seg.length > 1) bat.add('road_' + r.kind, ribbon(seg, prof, yAt, 1 / hw)); seg = []; };
    for (const p of r.line) { if (inCarsi(layout.sites, p[0], p[1], -1.0)) flushRoad(); else seg.push(p); }
    flushRoad();
    if (!r.kerb) continue;
    // kerb + 1.5 m pavement on both sides, interrupted around junctions with other roads
    for (const side of (r.kerbSide ? [r.kerbSide] : [-1, 1])) {
      let run = [];
      const flush = () => { if (run.length > 2) addKerb(run, side); run = []; };
      for (let pi = 0; pi < r.line.length; pi++) {
        const p = r.line[pi], q = r.line[Math.min(r.line.length - 1, pi + 1)], o = r.line[Math.max(0, pi - 1)];
        const tl = Math.hypot(q[0] - o[0], q[1] - o[1]) || 1, kx = p[0] - (q[1] - o[1]) / tl * (hw + 0.9) * side, kz = p[1] + (q[0] - o[0]) / tl * (hw + 0.9) * side;   // where this kerb runs
        let near = false;
        for (const o of roads) { if (o === r) continue; if (distToPolyline(p[0], p[1], o.line).d < o.w / 2 + hw + 1.5) { near = true; break; } }
        // and keep clear of the mosque courtyard wall and the square
        if (near || (!r.kerbSide && inCarsi(layout.sites, kx, kz))) flush(); else run.push(p);
      }
      flush();
    }
    function addKerb(line, side) {
      const k0 = (hw + 0.02) * side, k1 = (hw + 0.17) * side, p1 = (hw + 1.7) * side;
      const kerbProf = [{ u: k0, dy: L + 0.0 }, { u: k0, dy: L + 0.14 }, { u: k1, dy: L + 0.14 }, { u: k1, dy: L + 0.13 }];
      bat.add('kerb', ribbon(line, side < 0 ? kerbProf.slice().reverse() : kerbProf, yAt, 1));
      const pav = [{ u: k1, dy: L + 0.13 }, { u: p1, dy: L + 0.12 }, { u: p1 + 0.25 * side, dy: L * 0.3 }];
      bat.add('pave', ribbon(line, side < 0 ? pav.slice().reverse() : pav, yAt, 1));
    }
  }
  // utility poles along the main streets, with three sagging cables between them
  for (const r of roads) {
    if (!r.poles || centreOnly) continue;
    const side = roads.indexOf(r) % 2 ? 1 : -1, off = r.w / 2 + (r.kerb ? 2.2 : 1.4);
    let s = 12 + rnd() * 10, prev = null, acc = 0, i = 0;
    const total = r.line.reduce((a, p, k) => k ? a + Math.hypot(p[0] - r.line[k - 1][0], p[1] - r.line[k - 1][1]) : 0, 0);
    while (s < total - 5) {
      while (i + 1 < r.line.length && acc + Math.hypot(r.line[i + 1][0] - r.line[i][0], r.line[i + 1][1] - r.line[i][1]) < s) { acc += Math.hypot(r.line[i + 1][0] - r.line[i][0], r.line[i + 1][1] - r.line[i][1]); i++; }
      const p = r.line[i], q = r.line[Math.min(r.line.length - 1, i + 1)], dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz) || 1, t = (s - acc) / len;
      const x = p[0] + dx * t + (-dz / len) * off * side, z = p[1] + dz * t + (dx / len) * off * side;
      if (!onRoad(x, z, 0.6) && !inCarsi(layout.sites, x, z, 2)) { props.push({ kind: 'pole', x, z, prev }); prev = { x, z }; } else prev = null;
      s += 32 + rnd() * 10;
    }
  }

  // ================================================================= the square and the lawns
  const S = layout.sites;
  bat.add('square', patch(S.square.x, S.square.z, S.square.w, S.square.d, S.square.yaw || 0, yAt, LIFT.square, 2.0));
  if (!centreOnly) {
    const green = S.green1; bat.add('lawn', patch(green.x, green.z, 7, 6, 0, yAt, 0.07, 1.5));
    props.push({ kind: 'bench', x: green.x - 1.5, z: green.z + 1.0, yaw: 0.2 }, { kind: 'bin', x: green.x + 2.2, z: green.z + 1.5 }, { kind: 'tree', species: 'mulberry', x: green.x + 1.0, z: green.z - 1.5, size: 1.1 });
  }
  // the big old tree on the pavement in front of Güvendioğlu Market (Street View 01, satellite crown)
  if (S.marketTree) props.push({ kind: 'tree', species: 'mulberry', x: S.marketTree.x, z: S.marketTree.z, size: 1.6 });

  // ================================================================= buildings
  for (const b of layout.buildings) {
    if (b.kind === 'mosque') { buildMosque(b); continue; }
    if (b.kind === 'minaret') continue; // built with the mosque
    if (b.kind === 'municipality') { buildMunicipality(b); continue; }
    buildHouse(b);
  }
  buildCarsi(S);
  if (!centreOnly) {
    for (const c of S.cemeteries || []) buildCemetery(c);
    for (const mn of S.minarets || []) buildMinaretAt(mn.x, mn.z);
    for (const gd of S.gardens || []) {   // small fenced greens with pines and benches
      bat.add('lawn', patch(gd.x, gd.z, gd.w, gd.d, 0, yAt, 0.07, 1.5));
      for (let i = 0; i < 3; i++) treeSpots.push({ x: gd.x + (rnd() - 0.5) * (gd.w - 5), z: gd.z + (rnd() - 0.5) * (gd.d - 5), species: i < 2 ? 'pine' : 'mulberry', size: 1.1 + rnd() * 0.4, force: true });
      props.push({ kind: 'bench', x: gd.x + gd.w / 2 - 2, z: gd.z - 3, yaw: Math.PI / 2 }, { kind: 'bench', x: gd.x + gd.w / 2 - 2, z: gd.z + 4, yaw: Math.PI / 2 }, { kind: 'bin', x: gd.x + gd.w / 2 - 1.5, z: gd.z + 7 });
      if (gd.play) buildPlayground(gd.x - gd.w / 4, gd.z);
    }
    for (const row of S.treeRows || []) {
      const [a, b] = row.pts, L = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
      for (let s = 3; s < L; s += row.step) for (const side of [-1, 1]) treeSpots.push({ x: a[0] + tx * s - tz * row.offset * side, z: a[1] + tz * s + tx * row.offset * side, species: row.species, size: 1.1 + rnd() * 0.4, force: true });
    }
    if (S.pitch) { bat.add('lawn', patch(S.pitch.x, S.pitch.z, S.pitch.w, S.pitch.d, 0, yAt, 0.07, 1.0)); for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) props.push({ kind: 'pole', x: S.pitch.x + sx * S.pitch.w / 2, z: S.pitch.z + sz * S.pitch.d / 2, prev: null }); }
  }
  /** Children's playground (Street View 77, S park): orange/yellow slide with ladder, a two-seat swing frame, a sandpit kerb. */
  function buildPlayground(x, z) {
    const id = bid++, yG = yAt(x, z), frame = { x, y: yG, z, yaw: 0 }, bld = { id, base: yG - 1, top: yG + 3, yaw: 0, cx: x, cz: z };
    const add = (key, geo) => bat.add(key, geo, frame, bld);
    // slide: platform on 4 legs, ladder, sloping chute
    for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) add('metalDark', box(0.08, 2.0, 0.08, sx, 1.0, sz));
    add('orange', box(1.4, 0.08, 1.4, 0, 2.0, 0));
    add('orange', box(1.4, 0.9, 0.06, 0, 2.5, -0.7)); add('orange', box(0.06, 0.9, 1.4, -0.7, 2.5, 0));
    for (let i = 0; i < 5; i++) add('metalDark', box(1.0, 0.05, 0.05, 0, 0.4 + i * 0.4, 0.75 + i * 0.1));
    const chute = box(0.7, 0.06, 3.4, 0, 0, 0); chute.rotateX(-Math.PI / 2 + Math.atan2(3.0, 1.9)); chute.translate(1.8, 1.05, 0); add('flag', chute);
    // swings
    const sw = { x: 6, z: 0 };
    for (const side of [-1.6, 1.6]) { for (const dz of [-0.6, 0.6]) { const leg = box(0.07, 2.4, 0.07, 0, 1.2, 0); leg.rotateX(dz > 0 ? 0.26 : -0.26); leg.translate(sw.x + side, 0, sw.z + dz); add('metalDark', leg); } }
    add('metalDark', box(3.4, 0.07, 0.07, sw.x, 2.35, sw.z));
    for (const dx of [-0.7, 0.7]) { for (const dr of [-0.2, 0.2]) add('metal', box(0.02, 1.8, 0.02, sw.x + dx + dr, 1.45, sw.z)); add('orange', box(0.5, 0.05, 0.22, sw.x + dx, 0.55, sw.z)); }
    // low concrete kerb around a sand/rubber pad
    for (const [w, d, ox, oz] of [[11, 0.25, 3, -3.2], [11, 0.25, 3, 3.2], [0.25, 6.6, -2.5, 0], [0.25, 6.6, 8.5, 0]]) add('kerb', box(w, 0.25, d, ox, 0.12, oz));
  }
  /** A free-standing stone minaret (Köprü Köyü Yeni Cami: one slender shaft, single şerefe, turquoise-blue cap). */
  function buildMinaretAt(x, z) {
    const id = bid++, yG = yAt(x, z), frame = { x, y: yG, z, yaw: 0 }, bld = { id, base: yG, top: yG + 28, yaw: 0, cx: x, cz: z };
    const add = (key, geo) => bat.add(key, geo, frame, bld);
    const mx = 0, mz = 0, mb = 0.3;
    add('limestone', boxY(2.6, 2.6, -1.5, mb + 3.6, mx, mz));
    add('limestone', cyl(0.9, 1.75, 1.3, mx, mb + 3.6 + 0.65, mz, 8));
    add('limestone', cyl(0.78, 0.9, 13.5, mx, mb + 4.9 + 6.75, mz, 12));
    add('limestone', cyl(1.45, 0.78, 1.0, mx, mb + 18.4 + 0.5, mz, 12));
    add('limestone', cyl(1.5, 1.5, 0.35, mx, mb + 19.4 + 0.17, mz, 12));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; add('limestone', box(0.12, 0.9, 0.12, mx + Math.cos(a) * 1.38, mb + 19.75 + 0.45, mz + Math.sin(a) * 1.38)); }
    add('limestone', cyl(1.45, 1.45, 0.12, mx, mb + 20.65, mz, 12));
    add('limestone', cyl(0.62, 0.68, 4.8, mx, mb + 19.75 + 2.4, mz, 12));
    const cap = new THREE.ConeGeometry(0.85, 4.0, 12); cap.translate(mx, mb + 24.55 + 2.0, mz); add('turquoise', cap);
    add('metal', cyl(0.05, 0.05, 1.4, mx, mb + 26.55 + 0.7, mz, 8));
  }
  /** Village cemetery (satellite + Street View): low rubble wall, scattered upright headstones, a few pines. */
  function buildCemetery(c) {
    const id = bid++, yG = yAt(c.x, c.z), frame = { x: c.x, y: yG, z: c.z, yaw: 0 }, bld = { id, base: yG - 2, top: yG + 2, yaw: 0, cx: c.x, cz: c.z };
    const add = (key, geo) => bat.add(key, geo, frame, bld);
    const W2 = c.w / 2, D2 = c.d / 2, wh = 1.0;
    const seg = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), g = box(L, wh + 3, 0.5, 0, (wh - 3) / 2, 0); g.rotateY(Math.atan2(-(z1 - z0), x1 - x0)); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); add('rubble', g); };
    seg(-W2, -D2, W2, -D2); seg(-W2, D2, W2, D2); seg(-W2, -D2, -W2, D2); seg(W2, -D2, W2, D2);
    const n = Math.floor(c.w * c.d / 22);
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * (c.w - 4), z = (rnd() - 0.5) * (c.d - 4), dy = yAt(c.x + x, c.z + z) - yG, h = 0.5 + rnd() * 0.5;
      const g = box(0.38, h + 0.3, 0.1, x, dy + h / 2 - 0.15, z); g.rotateY((rnd() - 0.5) * 0.3); add('limestone', g);
      if (rnd() < 0.7) add('limestone', box(0.45, 0.25, 1.4, x, dy + 0.1, z + 0.8));      // low grave slab / kerb
    }
    for (let i = 0; i < Math.max(3, n / 12); i++) treeSpots.push({ x: c.x + (rnd() - 0.5) * (c.w - 6), z: c.z + (rnd() - 0.5) * (c.d - 6), species: rnd() < 0.7 ? 'pine' : 'mulberry', size: 0.9 + rnd() * 0.5, force: true });
  }

  // ---------------------------------------------------------------- generic house -------------
  function faceMatrix(side, w, d) {
    const m = new THREE.Matrix4(), r = new THREE.Matrix4();
    if (side === '+z') { m.makeTranslation(0, 0, d / 2); }
    else if (side === '-z') { r.makeRotationY(Math.PI); m.makeTranslation(0, 0, -d / 2).multiply(r); }
    else if (side === '+x') { r.makeRotationY(Math.PI / 2); m.makeTranslation(w / 2, 0, 0).multiply(r); }
    else { r.makeRotationY(-Math.PI / 2); m.makeTranslation(-w / 2, 0, 0).multiply(r); }
    return m;
  }
  function frontSide(b) {
    if (b.face === undefined) return '+z';
    const c = Math.cos(b.yaw), s = Math.sin(b.yaw), X = Math.cos(b.face), Z = Math.sin(b.face);
    const lx = X * c - Z * s, lz = X * s + Z * c;
    return Math.abs(lz) > Math.abs(lx) ? (lz > 0 ? '+z' : '-z') : (lx > 0 ? '+x' : '-x');
  }
  function buildHouse(b) {
    const id = bid++;
    const frame = { x: b.x, y: b.yTop, z: b.z, yaw: b.yaw };
    const n = b.storeys || 1, w = b.w, d = b.d;
    const y0 = PLINTH, y1 = PLINTH + n * FLOOR + 0.2;
    const bld = { id, base: b.yTop, top: b.yTop + y1, yaw: b.yaw, cx: b.x, cz: b.z };
    const wallKey = b.wallKey || (b.kind === 'school' ? 'redWall' : b.kind === 'market' || b.kind === 'kahve' ? 'Duvar_Beyaz' : WALLS[Math.floor(rnd() * WALLS.length)]);
    const roofKey = b.roof === 'm' ? (rnd() < 0.7 ? 'Cati_Sac_Gri' : 'Cati_Sac_Mavi') : TILES[Math.floor(rnd() * TILES.length)];
    const add = (key, geo, m) => { if (m) geo.applyMatrix4(m); bat.add(key, geo, frame, bld); };
    const front = frontSide(b), isBarn = !!b.barn;
    // plinth
    add(b.yTop - b.yLow > 1.9 ? 'rubble' : 'plinth', boxY(w + 0.16, d + 0.16, b.yLow - b.yTop - 0.3, y0 + 0.02));   // tall drops read as rubble retaining walls (Street View 78/86)
    // façades with window / door holes
    const balcony = n === 2 && !isBarn && rnd() < 0.5, stair = n === 2 && !isBarn && rnd() < 0.3;
    const stairSide = stair ? (front === '+z' || front === '-z' ? (rnd() < 0.5 ? '+x' : '-x') : (rnd() < 0.5 ? '+z' : '-z')) : null;
    const acPlaced = { n: 0 };
    for (const side of ['+z', '-z', '+x', '-x']) {
      const L = side === '+z' || side === '-z' ? w : d, fm = faceMatrix(side, w, d), isFront = side === front;
      const holes = [], panes = [];
      let nw = isBarn ? (L > 5 ? 1 : 0) : Math.max(L > 2.6 ? 1 : 0, Math.round((L - 0.8) / 3.1));
      if (b.kind === 'market' || b.kind === 'kahve') nw = isFront ? Math.max(2, Math.round(L / 2.2)) : Math.round(L / 3.5);
      if (b.kind === 'school') nw = Math.round(L / 2.0);
      const doorIdx = isFront && nw > 0 ? Math.floor(nw / 2) : -1;
      const balIdx = balcony && isFront && nw > 0 ? (nw > 1 ? (doorIdx + 1) % nw : 0) : -1;
      for (let k = 0; k < n; k++) {
        const fy = y0 + k * FLOOR;
        for (let i = 0; i < nw; i++) {
          const x = -L / 2 + L * (i + 0.5) / nw;
          if (k === 0 && i === doorIdx) {
            const dw = b.kind === 'market' ? 1.6 : 1.0; holes.push({ x, y: fy + 1.05, w: dw, h: 2.1 }); panes.push({ x, y: fy + 1.05, w: dw, h: 2.1, door: true });
            // two concrete steps and a small threshold slab
            add('step', box(dw + 0.8, 0.16, 0.5, x, 0.08, 0.25).applyMatrix4(fm)); add('step', box(dw + 0.5, 0.16, 0.3, x, 0.24, 0.15).applyMatrix4(fm));
            if (b.kind === 'market') { // shop: awning over the door and the windows
              const aw = box(L - 0.6, 0.06, 1.6, 0, fy + 2.5, 0.8); aw.rotateX(0.18); add('canvas', aw.translate(0, 0.2, 0), fm);
              for (const px of [-L / 2 + 0.5, L / 2 - 0.5]) add('metalDark', cyl(0.03, 0.03, 2.5, px, fy + 1.25, 1.55), fm);
            }
            continue;
          }
          if (k === 1 && i === balIdx) { // balcony door
            holes.push({ x, y: fy + 1.05, w: 0.9, h: 2.1 }); panes.push({ x, y: fy + 1.05, w: 0.9, h: 2.1, door: true, glassDoor: true });
            add('beton', box(2.8, 0.15, 1.25, x, fy - 0.08, 0.6), fm);
            // railing: top rail, two end posts, vertical bars
            add('railing', box(2.8, 0.04, 0.04, x, fy + 0.98, 1.2), fm);
            for (const sx of [-1.38, 1.38]) { add('railing', box(0.04, 1.0, 0.04, x + sx, fy + 0.5, 1.2), fm); add('railing', box(0.04, 0.04, 1.2, x + sx, fy + 0.98, 0.6), fm); }
            for (let j = -9; j <= 9; j++) add('railing', box(0.02, 0.95, 0.02, x + j * 0.14, fy + 0.5, 1.2), fm);
            continue;
          }
          const ww = (nw === 1 && L > 4.5) || b.kind === 'kahve' ? 1.6 : (isBarn ? 0.8 : 1.2), wh = isBarn ? 0.7 : (b.kind === 'school' ? 1.7 : 1.4);
          const wy = fy + (isBarn ? 1.9 : 1.55);
          holes.push({ x, y: wy, w: ww, h: wh }); panes.push({ x, y: wy, w: ww, h: wh });
          // sill
          add('trim', box(ww + 0.2, 0.06, 0.26, x, wy - wh / 2 - 0.03, 0.1), fm);
          // air-conditioner under some upper / side windows
          if (!isBarn && acPlaced.n < 1 && rnd() < 0.12) { acPlaced.n++; add('metal', box(0.8, 0.55, 0.3, x + ww / 2 + 0.55, wy - 0.1, 0.17), fm); add('metalDark', box(0.9, 0.03, 0.35, x + ww / 2 + 0.55, wy - 0.4, 0.17), fm); }
        }
      }
      // external stair on a side wall of some two-storey houses
      if (side === stairSide) {
        const steps = 16, rise = (y0 + FLOOR) / steps, go = Math.min(0.28, (L - 1.6) / steps);
        const xs = -L / 2 + 0.3;
        for (let i = 0; i < steps; i++) add('beton', box(go, (i + 1) * rise, 1.0, xs + go * (i + 0.5), (i + 1) * rise / 2, 0.5), fm);
        add('beton', box(1.3, 0.2, 1.0, xs + go * steps + 0.65, y0 + FLOOR - 0.1, 0.5), fm);
        holes.push({ x: xs + go * steps + 0.65, y: y0 + FLOOR + 1.05, w: 0.9, h: 2.1 }); panes.push({ x: xs + go * steps + 0.65, y: y0 + FLOOR + 1.05, w: 0.9, h: 2.1, door: true });
        const rl = Math.hypot(go * steps, steps * rise), rail = box(rl, 0.04, 0.04, 0, 0, 0); rail.rotateZ(Math.atan2(steps * rise, go * steps)); rail.translate(xs + go * steps / 2, steps * rise / 2 + 0.95, 1.0);
        add('railing', rail, fm);
        for (let i = 0; i <= steps; i += 4) add('railing', box(0.04, 0.95, 0.04, xs + go * i + 0.05, i * rise + 0.48, 1.0), fm);
      }
      // the wall itself, with holes, and the reveals + panes
      add(wallKey, facadeWithHoles(L, y0, y1, 0, 1, holes), fm);
      for (const h of holes) {
        const dep = 0.16;
        add(wallKey, box(h.w, 0.02, dep, h.x, h.y + h.h / 2 - 0.01, -dep / 2), fm);
        add(wallKey, box(h.w, 0.02, dep, h.x, h.y - h.h / 2 + 0.01, -dep / 2), fm);
        add(wallKey, box(0.02, h.h, dep, h.x - h.w / 2 + 0.01, h.y, -dep / 2), fm);
        add(wallKey, box(0.02, h.h, dep, h.x + h.w / 2 - 0.01, h.y, -dep / 2), fm);
      }
      for (const p of panes) {
        const g = new THREE.PlaneGeometry(p.w, p.h); g.translate(p.x, p.y, -0.15); g.applyMatrix4(fm);
        bat.add(p.door && !p.glassDoor ? 'door' : 'glass', g, frame, bld, p.door && !p.glassDoor ? null : [p.w, p.h]);
      }
    }
    // roof
    const e = isBarn ? 0.35 : 0.55;
    if (b.roof === 'f') {
      add('beton', box(w + 0.3, 0.25, d + 0.3, 0, y1 + 0.02, 0));
      for (const [bw, bd, cx, cz] of [[w + 0.3, 0.2, 0, d / 2 + 0.05], [w + 0.3, 0.2, 0, -d / 2 - 0.05], [0.2, d + 0.3, w / 2 + 0.05, 0], [0.2, d + 0.3, -w / 2 - 0.05, 0]]) add(wallKey, box(bw, 0.45, bd, cx, y1 + 0.35, cz));
      addTank(w / 2 - 1.0, y1 + 0.15, -d / 2 + 1.0);
      if (rnd() < 0.5) for (let i = 0; i < 4; i++) add('metalDark', cyl(0.015, 0.015, 0.8, -w / 2 + 0.6 + i * (w - 1.2) / 3, y1 + 0.55, d / 2 - 0.4), null); // rebar stubs left for a future storey
    } else {
      const metal = b.roof === 'm', pitch = metal ? 0.25 : 0.42, ry = y1 - 0.08, kind = b.roof === 'g' || metal ? 'g' : 'h';
      const roof = roofGeometry(w, d, e, pitch, ry, kind); const rise = roof.userData.rise;
      add(roofKey, roof);
      if (kind === 'g') add(wallKey, gableEnds(w, d, pitch, ry));
      if (!metal) {
        // fascia boards, soffit, ridge, gutters and one downpipe
        const W = w / 2 + e, Dd = d / 2 + e;
        add('trim', box(2 * W + 0.06, 0.2, 0.06, 0, ry - 0.08, Dd)); add('trim', box(2 * W + 0.06, 0.2, 0.06, 0, ry - 0.08, -Dd));
        if (kind === 'h') { add('trim', box(0.06, 0.2, 2 * Dd, W, ry - 0.08, 0)); add('trim', box(0.06, 0.2, 2 * Dd, -W, ry - 0.08, 0)); }
        const sof = new THREE.PlaneGeometry(2 * W, 2 * Dd); sof.rotateX(Math.PI / 2); sof.translate(0, ry - 0.02, 0); add('trim', sof);
        const ridgeL = kind === 'h' ? Math.max(0.5, 2 * W - 2 * Math.min(Dd, W - 0.5)) : 2 * W; add(roofKey, box(ridgeL + 0.1, 0.1, 0.28, 0, ry + rise + 0.02, 0));
        add('metal', box(2 * W, 0.09, 0.11, 0, ry - 0.2, Dd + 0.04)); add('metal', box(2 * W, 0.09, 0.11, 0, ry - 0.2, -Dd - 0.04));
        add('metal', cyl(0.045, 0.045, ry - 0.25, W - 0.1, (ry - 0.25) / 2 + 0.05, Dd - 0.12));
        // chimney
        const cx = (rnd() - 0.5) * (w - 1.5), cz = (rnd() < 0.5 ? -1 : 1) * d * 0.2, roofY = ry + (Dd - Math.abs(cz)) * Math.tan(pitch);
        add('chimney', boxY(0.5, 0.5, roofY - 0.3, roofY + 0.75, cx, cz)); add('beton', box(0.7, 0.07, 0.7, cx, roofY + 0.78, cz));
        if (rnd() < 0.3) add('metalDark', cyl(0.12, 0.12, 0.5, cx, roofY + 1.0, cz, 10));
        // satellite dish at an eaves corner
        if (rnd() < 0.45) { const dish = new THREE.CircleGeometry(0.4, 18); dish.rotateX(-0.9); dish.translate(W - 0.5, ry + 0.25, Dd - 0.3); add('metal', dish); add('metalDark', cyl(0.025, 0.025, 1.1, W - 0.5, ry - 0.25, Dd - 0.2)); }
        if (rnd() < 0.18) addTank(-W + 1.2, ry + rise * 0.3 + 0.2, 0);
        // solar water heater on some roofs (very common in the region)
        if (rnd() < 0.3) { const sp = box(1.9, 0.08, 1.1, 0, 0, 0); sp.rotateX(-pitch); sp.translate(W * 0.3, ry + (Dd * 0.55) * Math.tan(pitch) + 0.15, Dd * 0.45); add('metalDark', sp); const tk = new THREE.CylinderGeometry(0.3, 0.3, 1.5, 12); tk.rotateZ(Math.PI / 2); tk.translate(W * 0.3, ry + rise - 0.05, 0.3); add('metal', tk); }
      } else {
        // sheet roof: thin edge, a few purlin ends and a bit of overhang shadow
        add('metalDark', box(w + 2 * e, 0.06, 0.06, 0, ry - 0.03, d / 2 + e));
        add('metalDark', box(w + 2 * e, 0.06, 0.06, 0, ry - 0.03, -d / 2 - e));
      }
    }
    function addTank(x, y, z) { add('metal', cyl(0.55, 0.55, 1.15, x, y + 0.9, z, 16)); add('metalDark', box(1.3, 0.3, 1.3, x, y + 0.2, z)); }

    // garden: wall or wire fence on the street side with a gate, and the plot trees
    if (!isBarn && b.wall && b.wall !== 'none' && b.front) {
      const L = front === '+z' || front === '-z' ? w : d, depth = front === '+z' || front === '-z' ? d : w;
      const hwRoad = roadDist(b.x, b.z).w / 2;
      const off = Math.min(b.front - hwRoad - 1.6, depth / 2 + 9);
      if (off > depth / 2 + 1.8) {
        const fm = faceMatrix(front, w, d), zf = off - depth / 2;   // distance from the façade plane
        const len = L + 6, gate = (rnd() - 0.5) * (len - 4), gw = 1.4;
        const stone = b.wall === 'stone', wallH = b.wall === 'wall' ? 1.25 + rnd() * 0.5 : stone ? 0.9 + rnd() * 0.4 : 0, wb = b.yLow - b.yTop - 0.3, wk = stone ? 'rubble' : 'garden', wt = stone ? 0.55 : 0.3;   // walls reach below the lowest plot corner
        const segs = [[-len / 2, gate - gw / 2], [gate + gw / 2, len / 2]];
        for (const [a0, a1] of segs) {
          if (b.wall === 'wall' || stone) add(wk, box(a1 - a0, wallH - wb, wt, (a0 + a1) / 2, (wallH + wb) / 2, zf), fm);
          else { for (let x = a0; x <= a1; x += 2.2) add('beton', box(0.1, 1.45 - wb, 0.1, x, (1.45 + wb) / 2, zf), fm); fenceWires(a0, a1, zf, fm); }
        }
        // returns on both sides, back to the house line
        for (const sx of [-len / 2, len / 2]) {
          if (b.wall === 'wall' || stone) add(wk, box(wt, wallH - wb, zf + wt, sx, (wallH + wb) / 2, zf / 2), fm);
          else { for (let z = 0; z <= zf; z += 2.2) add('beton', box(0.1, 1.45 - wb, 0.1, sx, (1.45 + wb) / 2, z), fm); fenceWiresZ(sx, 0, zf, fm); }
        }
        for (const gx of [gate - gw / 2 - 0.2, gate + gw / 2 + 0.2]) add(stone ? 'rubble' : 'garden', box(0.45, (stone ? wallH + 0.3 : 1.9) - wb, 0.45, gx, ((stone ? wallH + 0.3 : 1.9) + wb) / 2, zf), fm);
        if (rnd() < 0.7) add('greenPaint', box(gw, 1.6, 0.04, gate, 0.85, zf), fm);
      }
    }
    if (b.tree && !isBarn) {
      const nTrees = 1 + (rnd() < 0.4 ? 1 : 0);
      for (let i = 0; i < nTrees; i++) {
        const sx = (rnd() < 0.5 ? -1 : 1) * (w / 2 + 2.2 + rnd() * 2), sz = (rnd() - 0.5) * (d + 3);
        const c = Math.cos(b.yaw), s = Math.sin(b.yaw), x = b.x + sx * c + sz * s, z = b.z - sx * s + sz * c;
        treeSpots.push({ x, z, species: rnd() < 0.5 ? 'mulberry' : rnd() < 0.6 ? 'fruit' : 'poplar', size: 0.8 + rnd() * 0.5 });
      }
    }
    function fenceWires(a0, a1, zf, fm) { for (const h of [0.45, 0.85, 1.25]) { const p = new THREE.Vector3(a0, h, zf).applyMatrix4(fm), q = new THREE.Vector3(a1, h, zf).applyMatrix4(fm); pushWire(p, q); } }
    function fenceWiresZ(x, z0, z1, fm) { for (const h of [0.45, 0.85, 1.25]) { const p = new THREE.Vector3(x, h, z0).applyMatrix4(fm), q = new THREE.Vector3(x, h, z1).applyMatrix4(fm); pushWire(p, q); } }
    function pushWire(p, q) { const m = new THREE.Matrix4().compose(new THREE.Vector3(frame.x, frame.y, frame.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), frame.yaw), new THREE.Vector3(1, 1, 1)); p.applyMatrix4(m); q.applyMatrix4(m); wires.push(p.x, p.y, p.z, q.x, q.y, q.z); }
  }

  // ---------------------------------------------------------------- old municipality ---------
  // "T.C. Köprü Belediyesi" (docs/reference/02, 05): three storeys, five wide bays on the long sides with ribbon
  // windows of three panes, red-brown pilasters between the bays, tall whitewashed spandrel bands between the
  // floors, iron grilles on the ground floor, the entrance and the white sign board in the southern bay,
  // low-pitch tile hip roof with wide eaves and three small chimneys.
  function buildMunicipality(b) {
    const id = bid++, frame = { x: b.x, y: b.yTop, z: b.z, yaw: b.yaw }, w = b.w, d = b.d;
    const FH = 3.1, n = 3, y0 = 0.5, y1 = y0 + n * FH + 0.15;
    const bld = { id, base: b.yTop, top: b.yTop + y1, yaw: b.yaw, cx: b.x, cz: b.z };
    const add = (key, geo, m) => { if (m) geo.applyMatrix4(m); bat.add(key, geo, frame, bld); };
    add(b.yTop - b.yLow > 1.9 ? 'rubble' : 'plinth', boxY(w + 0.2, d + 0.2, b.yLow - b.yTop - 0.3, y0 + 0.02));
    // local -z faces east, onto the square; in that face's frame x = s - L/2 (s from the south end)
    const front = '-z';
    for (const side of ['+z', '-z', '+x', '-x']) {
      const L = side === '+z' || side === '-z' ? w : d, fm = faceMatrix(side, w, d), isFront = side === front;
      const bays = side === '+z' || side === '-z' ? 5 : 2, bw = L / bays, holes = [], panes = [];
      for (let k = 0; k < n; k++) {
        const fy = y0 + k * FH;
        for (let i = 0; i < bays; i++) {
          const x = -L / 2 + bw * (i + 0.5);
          if (k === 0 && isFront && i === 0) {
            // entrance bay: a small barred window, the door, and the sign board over both
            const dx = x + 0.55;
            holes.push({ x: dx, y: fy + 1.2, w: 1.35, h: 2.4 }); panes.push({ x: dx, y: fy + 1.2, w: 1.35, h: 2.4, door: true });
            holes.push({ x: x - 1.0, y: fy + 1.55, w: 0.7, h: 1.2 }); panes.push({ x: x - 1.0, y: fy + 1.55, w: 0.7, h: 1.2 });
            grille(x - 1.0, fy + 1.55, 0.7, 1.2, fm);
            for (let st = 0; st < 3; st++) add('step', box(2.2 - st * 0.2, 0.17, 1.2 - st * 0.35, dx, 0.085 + st * 0.17, 0.6 - st * 0.175), fm);
            const sg = new THREE.PlaneGeometry(3.3, 0.78); sg.translate(x + 0.15, fy + 2.95, 0.2); sg.applyMatrix4(fm); bat.add('signMuni', sg, frame, bld);
            add('metalDark', box(3.4, 0.86, 0.06, x + 0.15, fy + 2.95, 0.16), fm);
            continue;
          }
          const ww = bw - 0.7, wh = k === 0 ? 1.55 : 1.7, wy = fy + (k === 0 ? 1.55 : 1.6);
          holes.push({ x, y: wy, w: ww, h: wh });
          const np = Math.max(2, Math.round(ww / 1.0));
          for (let j = 0; j < np; j++) panes.push({ x: x - ww / 2 + ww * (j + 0.5) / np, y: wy, w: ww / np, h: wh });
          add('trim', box(ww + 0.12, 0.07, 0.24, x, wy - wh / 2 - 0.035, 0.1), fm);
          if (k === 0) grille(x, wy, ww, wh, fm);
        }
      }
      add('whitewash', facadeWithHoles(L, y0, y1, 0, 1, holes), fm);
      for (const h of holes) { const dep = 0.22;
        add('whitewash', box(h.w, 0.02, dep, h.x, h.y + h.h / 2 - 0.01, -dep / 2), fm); add('whitewash', box(h.w, 0.02, dep, h.x, h.y - h.h / 2 + 0.01, -dep / 2), fm);
        add('whitewash', box(0.02, h.h, dep, h.x - h.w / 2 + 0.01, h.y, -dep / 2), fm); add('whitewash', box(0.02, h.h, dep, h.x + h.w / 2 - 0.01, h.y, -dep / 2), fm); }
      for (const p of panes) { const g = new THREE.PlaneGeometry(p.w, p.h); g.translate(p.x, p.y, -0.2); g.applyMatrix4(fm); bat.add(p.door ? 'door' : 'glass', g, frame, bld, p.door ? null : [p.w, p.h]); }
      // red-brown pilasters between the bays (wider at the corners), tall white spandrel bands over them
      for (let i = 0; i <= bays; i++) { const corner = i === 0 || i === bays, pw = corner ? 0.5 : 0.42, x = Math.max(-L / 2 + pw / 2, Math.min(L / 2 - pw / 2, -L / 2 + bw * i)); add('pilaster', box(pw, y1 - y0, 0.12, x, (y0 + y1) / 2, 0.06), fm); }
      for (let k = 1; k < n; k++) { const yb0 = y0 + k * FH - 0.62, yb1 = y0 + k * FH + 0.66; add('whitewash', box(L + 0.06, yb1 - yb0, 0.2, 0, (yb0 + yb1) / 2, 0.1), fm); add('trim', box(L + 0.1, 0.06, 0.26, 0, yb1 + 0.03, 0.12), fm); }
    }
    function grille(x, y, gw, gh, fm) {   // white-painted iron bars on the ground-floor windows
      const nb = Math.max(3, Math.round(gw / 0.13));
      for (let j = 1; j < nb; j++) add('railing', box(0.025, gh - 0.04, 0.025, x - gw / 2 + gw * j / nb, y, 0.06), fm);
      for (const yy of [y - gh / 2 + 0.1, y, y + gh / 2 - 0.1]) add('railing', box(gw - 0.02, 0.03, 0.03, x, yy, 0.06), fm);
    }
    const e = 0.75, pitch = 0.32, ry = y1 - 0.05, roof = roofGeometry(w, d, e, pitch, ry, 'h'), rise = roof.userData.rise;
    add('Cati_Kiremit_Koyu', roof);
    const W = w / 2 + e, Dd = d / 2 + e;
    for (const [bw2, bd2, cx, cz] of [[2 * W + 0.06, 0.06, 0, Dd], [2 * W + 0.06, 0.06, 0, -Dd], [0.06, 2 * Dd, W, 0], [0.06, 2 * Dd, -W, 0]]) add('trim', box(bw2, 0.28, bd2, cx, ry - 0.1, cz));
    const sof = new THREE.PlaneGeometry(2 * W, 2 * Dd); sof.rotateX(Math.PI / 2); sof.translate(0, ry - 0.02, 0); add('trim', sof);
    add('Cati_Kiremit_Koyu', box(2 * W - 2 * Math.min(Dd, W - 0.5) + 0.1, 0.1, 0.3, 0, ry + rise + 0.02, 0));
    add('metal', box(2 * W, 0.1, 0.12, 0, ry - 0.22, Dd + 0.05)); add('metal', box(2 * W, 0.1, 0.12, 0, ry - 0.22, -Dd - 0.05));
    for (const sx of [W - 0.15, -W + 0.15]) add('metal', cyl(0.05, 0.05, ry - 0.3, sx, (ry - 0.3) / 2 + 0.05, Dd - 0.15));
    for (const cx of [-5.6, 0.4, 5.2]) { const cz = -0.6, roofY = ry + (Dd - Math.abs(cz)) * Math.tan(pitch); add('chimney', boxY(0.45, 0.45, roofY - 0.4, roofY + 0.55, cx, cz)); add('beton', box(0.6, 0.06, 0.6, cx, roofY + 0.58, cz)); }
  }

  // ---------------------------------------------------------------- the çarşı square -----------
  // Everything in front of the old municipality, from the Street View photographs 02 / 05 and SV01-03.
  function buildCarsi(S) {
    if (S.statue) buildStatue(S.statue);
    const at = (p, y = 0) => ({ x: p.x, y: yAt(p.x, p.z) + y, z: p.z, yaw: p.yaw || 0 });
    // grass bed with a low concrete kerb around the statue
    if (S.bed) {
      const B = S.bed, fr = at(B);
      bat.add('lawn', patch(B.x, B.z, B.w, B.d, B.yaw, yAt, 0.13, 1.0));
      for (const [bw, bd, cx, cz] of [[B.w, 0.14, 0, B.d / 2], [B.w, 0.14, 0, -B.d / 2], [0.14, B.d, B.w / 2, 0], [0.14, B.d, -B.w / 2, 0]]) bat.add('beton', boxY(bw, bd, -0.5, 0.2, cx, cz), fr);
    }
    // two thin flag poles behind the statue; the Turkish flag on the southern one (photo 02)
    for (const f of S.flags || []) {
      const fr = at(f); bat.add('metal', cyl(0.035, 0.05, 7.6, 0, 3.8 - 0.2, 0, 8), fr); bat.add('metal', new THREE.SphereGeometry(0.07, 8, 6).translate(0, 7.45, 0), fr);
      if (f.flag) { const g = new THREE.PlaneGeometry(1.35, 0.9, 6, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, 0.08 * Math.sin((p.getX(i) + 0.675) * 3.2)); g.computeVertexNormals(); g.translate(0.72, 6.85, 0); g.rotateY(Math.PI); bat.add('flagTR', g, fr); }
    }
    if (S.kiosk) buildKiosk(S.kiosk);
    for (const t of S.trees || []) treeSpots.push({ ...t, force: true });
    if (S.plot) buildPlot(S);
  }
  /** Atatürk statue: standing bronze figure in a long coat, arms down, on a grey granite pedestal with a plaque. */
  function buildStatue(s) {
    const y = yAt(s.x, s.z), frame = { x: s.x, y, z: s.z, yaw: s.yaw }, add = (key, geo) => bat.add(key, geo, frame);   // local -z faces the square
    add('beton', boxY(2.6, 2.6, -0.8, 0.16)); add('beton', boxY(2.1, 2.1, 0.16, 0.32));
    add('granite', boxY(1.55, 1.55, 0.32, 0.5)); add('granite', boxY(1.3, 1.3, 0.5, 2.0)); add('granite', boxY(1.5, 1.5, 2.0, 2.16));
    const pl = new THREE.PlaneGeometry(0.75, 0.48); pl.rotateY(Math.PI); pl.translate(0, 1.35, -0.656); add('plaque', pl);
    const B = 2.16;                                                           // top of the pedestal
    const F = 1.2;                                                            // the figure is ~1.2x life size (about 3 m, photo 02)
    const addF = (key, geo) => { geo.translate(0, -B, 0); geo.scale(F, F, F); geo.translate(0, B, 0); add(key, geo); };
    addF('bronze', boxY(0.72, 0.62, B, B + 0.1));                            // bronze plinth
    for (const sx of [-0.12, 0.12]) { addF('bronze', cyl(0.085, 0.1, 0.62, sx, B + 0.41, 0, 10)); addF('bronze', box(0.16, 0.1, 0.3, sx, B + 0.15, -0.06)); }
    // long greatcoat: a flared lathe from the shins to the chest, slightly flattened front-to-back
    const coat = new THREE.LatheGeometry([[0.0, 0], [0.36, 0], [0.33, 0.35], [0.29, 0.75], [0.27, 1.05], [0.3, 1.32], [0.27, 1.5], [0.0, 1.52]].map(([r, h]) => new THREE.Vector2(r, h)), 16);
    coat.scale(1, 1, 0.72); coat.translate(0, B + 0.55, 0); addF('bronze', coat);
    { const sh = new THREE.CapsuleGeometry(0.13, 0.3, 4, 10); sh.rotateZ(Math.PI / 2); sh.scale(1, 1, 1.25); sh.translate(0, B + 1.93, 0); addF('bronze', sh); }   // rounded shoulders
    addF('bronze', box(0.5, 0.07, 0.3, 0, B + 1.25, -0.02));               // belt
    for (const sx of [-1, 1]) {                                             // coat lapels: thin raised strips converging to the belt
      const lp = box(0.07, 0.55, 0.025, 0, 0, 0); lp.rotateZ(sx * 0.22); lp.translate(sx * 0.07, B + 1.62, -0.2); addF('bronze', lp);
    }
    for (const sx of [-1, 1]) {                                             // arms hanging close to the body, hands slightly forward
      const ua = cyl(0.068, 0.078, 0.6, 0, 0, 0, 10); ua.rotateZ(sx * 0.07); ua.translate(sx * 0.31, B + 1.62, 0.0); addF('bronze', ua);
      const fa = cyl(0.056, 0.066, 0.52, 0, 0, 0, 10); fa.rotateX(0.22); fa.translate(sx * 0.33, B + 1.09, -0.05); addF('bronze', fa);
      addF('bronze', new THREE.SphereGeometry(0.06, 8, 6).scale(0.85, 1.3, 0.8).translate(sx * 0.335, B + 0.78, -0.11));
    }
    addF('bronze', cyl(0.075, 0.09, 0.16, 0, B + 2.1, 0, 10));             // neck and collar
    addF('bronze', cyl(0.16, 0.2, 0.12, 0, B + 2.02, 0, 12));
    addF('bronze', new THREE.SphereGeometry(0.145, 16, 12).scale(1, 1.2, 1.08).translate(0, B + 2.34, -0.01));
    addF('bronze', new THREE.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1.08).translate(0, B + 2.41, 0.015));   // swept-back hair
  }
  /** The kahve's kiosk at the north end of the façade: wooden posts, low railing, green sheet hip roof with a lantern, tables and red chairs. */
  function buildKiosk(k) {
    const id = bid++, yG = yAt(k.x, k.z), frame = { x: k.x, y: yG, z: k.z, yaw: k.yaw }, bld = { id, base: yG, top: yG + 4, yaw: k.yaw, cx: k.x, cz: k.z };
    const add = (key, geo) => bat.add(key, geo, frame, bld), W = k.w, D = k.d;   // local x along the façade (south +), z outward is -z
    add('beton', boxY(W + 0.3, D + 0.3, -0.6, 0.12));
    const posts = [[-W / 2, -D / 2], [0, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [0, D / 2], [W / 2, D / 2]];
    for (const [px, pz] of posts) add('woodRaw', box(0.14, 2.55, 0.14, px, 0.12 + 1.27, pz));
    for (const [x0, z0, x1, z1] of [[-W / 2, -D / 2, -W / 2, D / 2], [W / 2, -D / 2, W / 2, D / 2], [-W / 2, -D / 2, -0.6, -D / 2]]) {   // railing on three sides, open to the square
      const L = Math.hypot(x1 - x0, z1 - z0), g = box(L, 0.07, 0.06, 0, 0, 0); g.rotateY(Math.atan2(-(z1 - z0), x1 - x0)); g.translate((x0 + x1) / 2, 0.95, (z0 + z1) / 2); add('woodRaw', g);
      const g2 = box(L, 0.05, 0.05, 0, 0, 0); g2.rotateY(Math.atan2(-(z1 - z0), x1 - x0)); g2.translate((x0 + x1) / 2, 0.5, (z0 + z1) / 2); add('woodRaw', g2);
    }
    add('woodRaw', box(W + 0.2, 0.18, 0.12, 0, 2.62, -D / 2)); add('woodRaw', box(W + 0.2, 0.18, 0.12, 0, 2.62, D / 2));
    add('woodRaw', box(0.12, 0.18, D + 0.2, -W / 2, 2.62, 0)); add('woodRaw', box(0.12, 0.18, D + 0.2, W / 2, 2.62, 0));
    const roof = roofGeometry(W, D, 0.45, 0.42, 2.7, 'h'); add('greenRoof', roof);
    const rt = 2.7 + roof.userData.rise;
    add('woodRaw', boxY(0.9, 0.9, rt - 0.3, rt + 0.3)); const lr = roofGeometry(0.9, 0.9, 0.15, 0.6, rt + 0.3, 'h'); add('greenRoof', lr);
    for (const tx of [-1.2, 1.2]) {
      add('whitePlastic', cyl(0.42, 0.42, 0.04, tx, 0.86, 0, 14)); add('whitePlastic', cyl(0.03, 0.03, 0.74, tx, 0.49, 0, 6));
      for (let c = 0; c < 3; c++) { const a = c / 3 * Math.PI * 2 + 0.4, cx = tx + Math.cos(a) * 0.72, cz = Math.sin(a) * 0.72; add('redPlastic', box(0.42, 0.04, 0.42, cx, 0.56, cz)); const bk = box(0.42, 0.42, 0.04, 0, 0, 0); bk.rotateY(-a + Math.PI / 2); bk.translate(cx + Math.cos(a) * 0.2, 0.78, cz + Math.sin(a) * 0.2); add('redPlastic', bk); for (const [lx, lz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) add('redPlastic', box(0.03, 0.44, 0.03, cx + lx, 0.34, cz + lz)); }
    }
  }
  /** Raised park plot south of the lane: rubble wall topped with blue-white kerb stones, lawn, the big wooden çardak, a notice board and two big trees. */
  function buildPlot(S) {
    const P = S.plot, cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2, W = P.x1 - P.x0, Dp = P.z1 - P.z0;
    const yTopAt = (x, z) => yAt(x, z) + P.h;
    bat.add('lawn', patch(cx, cz, W - 0.5, Dp - 0.5, 0, yAt, P.h, 1.5));
    const seg = (x0, z0, x1, z1) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 2));
      for (let i = 0; i < n; i++) {   // stepped with the ground, 2 m at a time
        const t0 = i / n, t1 = (i + 1) / n, ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1, mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const yG = yAt(mx, mz), fr = { x: mx, y: yG, z: mz, yaw: Math.atan2(-(bz - az), bx - ax) }, l = L / n + 0.02;
        bat.add('rubble', boxY(l, 0.5, -0.6, P.h + 0.02), fr);
        const nb = Math.max(1, Math.round(l / 0.7));
        for (let j = 0; j < nb; j++) bat.add(((Math.round(ax * 1.43 + az * 1.43) + i * 3 + j) & 1) ? 'kerbBlue' : 'kerbWhite', box(l / nb - 0.03, 0.18, 0.56, -l / 2 + l * (j + 0.5) / nb, P.h + 0.11, 0), { ...fr });
      }
    };
    seg(P.x1, P.z0, P.x1, P.z1); seg(P.x0, P.z0, P.x1, P.z0); seg(P.x0, P.z1, P.x1, P.z1); seg(P.x0, P.z0, P.x0, P.z1);
    // the big wooden çardak: square, eight posts, railing with benches, two-tier green roof with a lantern
    const C = S.cardak, s = C.size, yC = yTopAt(C.x, C.z), id = bid++, frame = { x: C.x, y: yC, z: C.z, yaw: 0 }, bld = { id, base: yC, top: yC + 5, yaw: 0, cx: C.x, cz: C.z };
    const add = (key, geo) => bat.add(key, geo, frame, bld), h = s / 2;
    add('woodRaw', boxY(s + 0.3, s + 0.3, -0.9, 0.2));
    for (const [px, pz] of [[-h, -h], [0, -h], [h, -h], [-h, 0], [h, 0], [-h, h], [0, h], [h, h]]) add('woodRaw', box(0.18, 2.6, 0.18, px, 0.2 + 1.3, pz));
    for (const [x0, z0, x1, z1] of [[-h, -h, h, -h], [-h, h, h, h], [-h, -h, -h, h], [h, -h, h, -0.7], [h, 0.7, h, h]]) {   // opening on the east side
      const L = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      for (const [yy, hh] of [[0.95, 0.08], [0.45, 0.06]]) { const g = box(L, hh, 0.07, 0, 0, 0); g.rotateY(ang); g.translate(mx, 0.2 + yy, mz); add('woodRaw', g); }
      for (let t = 0.12; t < 1; t += 0.12) { const g = box(0.05, 0.5, 0.05, x0 + (x1 - x0) * t, 0.2 + 0.7, z0 + (z1 - z0) * t); add('woodRaw', g); }
      const bench = box(L - 0.4, 0.06, 0.4, 0, 0, 0); bench.rotateY(ang); const nx = -Math.sign(mx) * (Math.abs(mx) > 0.1 ? 0.3 : 0), nz = -Math.sign(mz) * (Math.abs(mz) > 0.1 ? 0.3 : 0); bench.translate(mx + nx, 0.2 + 0.45, mz + nz); add('woodRaw', bench);
    }
    add('woodRaw', box(s + 0.3, 0.22, 0.14, 0, 2.8, -h)); add('woodRaw', box(s + 0.3, 0.22, 0.14, 0, 2.8, h)); add('woodRaw', box(0.14, 0.22, s + 0.3, -h, 2.8, 0)); add('woodRaw', box(0.14, 0.22, s + 0.3, h, 2.8, 0));
    const r1 = roofGeometry(s, s, 0.6, 0.4, 2.9, 'h'); add('greenRoof', r1);
    const t1 = 2.9 + r1.userData.rise * 0.72, lw = 1.7;
    add('woodRaw', boxY(lw, lw, t1 - 0.4, t1 + 0.45)); const r2 = roofGeometry(lw, lw, 0.35, 0.5, t1 + 0.45, 'h'); add('greenRoof', r2);
    // notice board on two posts, facing the square
    const Bd = S.board, yB = yTopAt(Bd.x, Bd.z), fb = { x: Bd.x, y: yB, z: Bd.z, yaw: Math.PI / 2 };
    for (const sx of [-0.85, 0.85]) bat.add('metalDark', box(0.08, 1.9, 0.08, sx, 0.95, 0), fb);
    bat.add('trim', box(1.8, 1.2, 0.08, 0, 1.25, 0), fb);
    for (const t of S.plotTrees || []) treeSpots.push({ ...t, force: true });
  }
  // ---------------------------------------------------------------- the mosque ---------------
  function buildMosque(b) {
    const id = bid++, yG = b.yTop, frame = { x: b.x, y: yG, z: b.z, yaw: 0 };
    const bld = { id, base: yG, top: yG + 7.5, yaw: 0, cx: b.x, cz: b.z };
    const add = (key, geo, m) => { if (m) geo.applyMatrix4(m); bat.add(key, geo, frame, bld); };
    const hw = 13, hd = 13, hz = 2.5;                      // prayer hall centre (local), qibla to +z (south)
    const H = 7.0, y0 = 0.3;
    // platform and plinth
    add('paving', boxY(hw + 4, hd + 12, b.yLow - yG - 0.3, y0, 0, 1.5));
    add('limestone', boxY(hw + 0.3, hd + 0.3, y0 - 0.02, y0 + 0.8, 0, hz));
    // walls with two rows of windows
    for (const side of ['+z', '-z', '+x', '-x']) {
      const L = side === '+z' || side === '-z' ? hw : hd, fm = faceMatrix(side, hw, hd); fm.premultiply(new THREE.Matrix4().makeTranslation(0, 0, hz));
      const holes = [], panes = [];
      const nLow = side === '-z' ? 0 : 2, nUp = 3;
      for (let i = 0; i < nLow; i++) { const x = -L / 2 + L * (i + 0.5) / nLow; holes.push({ x, y: y0 + 2.4, w: 1.1, h: 2.0 }); panes.push({ x, y: y0 + 2.4, w: 1.1, h: 2.0 }); add('limestone', box(1.35, 0.1, 0.3, x, y0 + 1.36, 0.12), fm); }
      for (let i = 0; i < nUp; i++) { const x = -L / 2 + L * (i + 0.5) / nUp; holes.push({ x, y: y0 + 5.3, w: 0.8, h: 1.3 }); panes.push({ x, y: y0 + 5.3, w: 0.8, h: 1.3 }); }
      if (side === '-z') { holes.push({ x: 0, y: y0 + 1.4, w: 1.8, h: 2.8 }); panes.push({ x: 0, y: y0 + 1.4, w: 1.8, h: 2.8, door: true }); }
      add('turquoise', facadeWithHoles(L, y0, y0 + H, 0, 1, holes), fm);
      for (const h of holes) { const dep = 0.35;
        add('turquoise', box(h.w, 0.02, dep, h.x, h.y + h.h / 2 - 0.01, -dep / 2), fm); add('turquoise', box(h.w, 0.02, dep, h.x, h.y - h.h / 2 + 0.01, -dep / 2), fm);
        add('turquoise', box(0.02, h.h, dep, h.x - h.w / 2 + 0.01, h.y, -dep / 2), fm); add('turquoise', box(0.02, h.h, dep, h.x + h.w / 2 - 0.01, h.y, -dep / 2), fm); }
      for (const p of panes) { const g = new THREE.PlaneGeometry(p.w, p.h); g.translate(p.x, p.y, -0.3); g.applyMatrix4(fm); bat.add(p.door ? 'door' : 'glass', g, frame, bld, p.door ? null : [p.w, p.h]); }
    }
    // flat roof, parapet, drum, lead dome, corner domes
    add('trim', box(hw + 0.6, 0.3, hd + 0.6, 0, y0 + H + 0.1, hz));
    for (const [bw, bd, cx, cz] of [[hw + 0.6, 0.25, 0, hd / 2 + 0.17], [hw + 0.6, 0.25, 0, -hd / 2 - 0.17], [0.25, hd + 0.6, hw / 2 + 0.17, 0], [0.25, hd + 0.6, -hw / 2 - 0.17, 0]]) add('turquoise', box(bw, 0.6, bd, cx, y0 + H + 0.5, cz + hz));
    const drumY = y0 + H + 0.25, drumH = 2.0, R = 4.9;
    add('turquoise', cyl(R, R, drumH, 0, drumY + drumH / 2, hz, 16));
    for (let i = 0; i < 16; i += 2) { const a = (i + 0.5) / 16 * Math.PI * 2; const g = new THREE.PlaneGeometry(0.6, 1.1); g.translate(0, 0, R + 0.01); g.rotateY(a); g.translate(0, drumY + drumH / 2, hz); bat.add('glass', g, frame, bld, [0.6, 1.1]); }
    const dome = new THREE.SphereGeometry(R + 0.15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2); dome.scale(1, 0.78, 1); dome.translate(0, drumY + drumH, hz); add('lead', dome);
    add('lead', cyl(R + 0.3, R + 0.3, 0.25, 0, drumY + drumH + 0.05, hz, 32));
    add('metal', cyl(0.06, 0.06, 1.6, 0, drumY + drumH + (R + 0.15) * 0.78 + 0.7, hz, 8)); const alem = new THREE.SphereGeometry(0.22, 10, 8); alem.translate(0, drumY + drumH + (R + 0.15) * 0.78 + 1.5, hz); add('metal', alem);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = sx * (hw / 2 - 1.7), cz = hz + sz * (hd / 2 - 1.7);
      add('turquoise', cyl(1.5, 1.5, 0.7, cx, y0 + H + 0.6, cz, 12));
      const sd = new THREE.SphereGeometry(1.6, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); sd.scale(1, 0.8, 1); sd.translate(cx, y0 + H + 0.95, cz); add('lead', sd);
    }
    // son cemaat yeri: a porch on the north with three small domes on four stone columns
    const pz = hz - hd / 2 - 2.2;
    add('limestone', boxY(hw + 0.3, 4.4, y0 - 0.02, y0 + 0.35, 0, pz));
    for (let i = 0; i < 4; i++) add('limestone', cyl(0.28, 0.32, 4.0, -hw / 2 + 0.5 + i * (hw - 1.0) / 3, y0 + 2.35, pz - 1.7, 12));
    add('turquoise', box(hw + 0.4, 0.5, 4.6, 0, y0 + 4.6, pz));
    for (let i = 0; i < 3; i++) { const cx = -hw / 3 + i * hw / 3; const sd = new THREE.SphereGeometry(1.9, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2); sd.scale(1, 0.7, 1); sd.translate(cx, y0 + 4.85, pz); add('lead', sd); add('turquoise', cyl(1.95, 1.95, 0.3, cx, y0 + 4.95, pz, 14)); }
    // two minarets at the north corners (satellite + Street View, Nov 2026): stone base, polygonal shaft, one şerefe, lead cap
    for (const mx of [hw / 2 + 2.2, -(hw / 2 + 2.2)]) {
    const mz = pz - 0.5, mb = y0;
    add('limestone', boxY(2.6, 2.6, b.yLow - yG - 0.3, mb + 3.6, mx, mz));
    add('limestone', cyl(0.9, 1.75, 1.3, mx, mb + 3.6 + 0.65, mz, 8));
    add('limestone', cyl(0.78, 0.9, 13.5, mx, mb + 4.9 + 6.75, mz, 12));
    add('limestone', cyl(1.45, 0.78, 1.0, mx, mb + 18.4 + 0.5, mz, 12));          // corbelled underside of the balcony
    add('limestone', cyl(1.5, 1.5, 0.35, mx, mb + 19.4 + 0.17, mz, 12));
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; add('limestone', box(0.12, 0.9, 0.12, mx + Math.cos(a) * 1.38, mb + 19.75 + 0.45, mz + Math.sin(a) * 1.38)); }
    add('limestone', cyl(1.45, 1.45, 0.12, mx, mb + 20.65, mz, 12));
    add('limestone', cyl(0.62, 0.68, 4.8, mx, mb + 19.75 + 2.4, mz, 12));
    const cap = new THREE.ConeGeometry(0.85, 4.0, 12); cap.translate(mx, mb + 24.55 + 2.0, mz); add('lead', cap);
    add('metal', cyl(0.05, 0.05, 1.4, mx, mb + 26.55 + 0.7, mz, 8)); const al2 = new THREE.SphereGeometry(0.16, 8, 6); al2.translate(mx, mb + 27.9, mz); add('metal', al2);
    }
    // courtyard: red plastered wall with a concrete coping, gates on the north and east sides
    const cw = 50, cd = 56, cz0 = hz - 4.0, cx0 = -6.0, wallH = 1.75;
    const wb = b.yLow - yG - 1.0;
    const wallSeg = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0); const g = box(L, wallH - wb, 0.35, 0, (wallH + wb) / 2, 0); g.rotateY(ang); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); add('redWall', g); const c = box(L + 0.05, 0.08, 0.5, 0, wallH + 0.04, 0); c.rotateY(ang); c.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); add('coping', c); };
    const W2 = cw / 2, D2 = cd / 2;
    const xL = cx0 - W2, xR = cx0 + W2;
    wallSeg(xL, cz0 - D2, -1.6, cz0 - D2); wallSeg(1.6, cz0 - D2, xR, cz0 - D2);                 // north with a gate in front of the porch
    wallSeg(xL, cz0 + D2, xR, cz0 + D2);                                                        // south
    wallSeg(xL, cz0 - D2, xL, cz0 + D2);                                                        // west
    wallSeg(xR, cz0 - D2, xR, cz0 - 2.0); wallSeg(xR, cz0 + 1.0, xR, cz0 + D2);                  // east with a gate
    for (const [gx, gz] of [[-1.6, cz0 - D2], [1.6, cz0 - D2], [xR, cz0 - 2.0], [xR, cz0 + 1.0]]) add('limestone', box(0.5, 2.3, 0.5, gx, 1.0, gz));
    // iron gates: frame and bars
    for (let i = -9; i <= 9; i++) add('railing', box(0.03, 1.9, 0.03, i * 0.15, 0.95, cz0 - D2));
    for (const yy of [0.15, 1.0, 1.85]) add('railing', box(2.9, 0.04, 0.04, 0, yy, cz0 - D2));
    for (let i = -9; i <= 9; i++) add('railing', box(0.03, 1.9, 0.03, xR, 0.95, cz0 - 0.5 + i * 0.15));
    for (const yy of [0.15, 1.0, 1.85]) add('railing', box(0.04, 0.04, 2.9, xR, yy, cz0 - 0.5));
    // inside: paving to the door, a lawn, the ablution fountain
    add('paving', box(3.0, 0.12, D2 - hd / 2 - 2.2 + 2.0, 0, y0 - 0.2, (cz0 - D2 + pz - 2.2) / 2 + 0.5));
    add('limestone', cyl(1.2, 1.3, 1.0, -hw / 2 - 5, 0.5, cz0 - D2 + 8, 8)); add('lead', new THREE.ConeGeometry(1.7, 0.9, 8).translate(-hw / 2 - 5, 2.6, cz0 - D2 + 8)); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; add('limestone', cyl(0.08, 0.08, 1.5, -hw / 2 - 5 + Math.cos(a) * 1.5, 1.75, cz0 - D2 + 8 + Math.sin(a) * 1.5, 6)); }
    // trees inside the yard: a dense grove of pines and mulberries in the western half (satellite), a few pines by the hall
    for (let i = 0; i < 14; i++) { const tx = xL + 3 + rnd() * (Math.max(4, -hw / 2 - 4 - xL) - 3), tz = cz0 - D2 + 4 + rnd() * (cd - 8); treeSpots.push({ x: b.x + tx, z: b.z + tz, species: rnd() < 0.55 ? 'pine' : 'mulberry', size: 0.9 + rnd() * 0.5, force: true }); }
    for (const [tx, tz] of [[hw / 2 + 3, cz0 + D2 - 4], [-hw / 2 - 3, cz0 + D2 - 3], [hw / 2 + 4, hz + 2]]) treeSpots.push({ x: b.x + tx, z: b.z + tz, species: 'pine', size: 1.0 + rnd() * 0.3, force: true });
    if (centreOnly) return;   // no new street outside the wall in centre-only mode: the v0.6 roads stay
    // outside the WEST wall, towards the main road (Street View 04): lawn, brick pavement, picnic table, bare mulberry
    const rdW = roadDist(b.x + xL, b.z + cz0), lawnW = Math.max(2, Math.min(9, rdW.d - rdW.w / 2 - 2.2)), lawnX = b.x + xL - 0.4 - lawnW / 2, lawnZ = b.z + cz0;
    bat.add('lawn', patch(lawnX, lawnZ, lawnW, cd, 0, yAt, 0.07, 1.5));
    props.push({ kind: 'picnic', x: lawnX + 0.3, z: lawnZ - 6, yaw: 0 }, { kind: 'bin', x: lawnX - 0.8, z: lawnZ + 4 });
    for (const [tx, tz] of [[xL - 2.5, cz0 - 10], [xL - 2.5, cz0 + 12]]) treeSpots.push({ x: b.x + tx, z: b.z + tz, species: 'mulberry', size: 1.2 });
  }

  // ================================================================= props, wires, trees
  // street poplars along the main road and the mosque street
  for (const id of ['B_core', 'C_core', 'A_core']) {
    const r = roads.find(q => q.id === id); if (!r || centreOnly) continue;
    for (const side of [-1, 1]) {
      const total = r.line.length;
      for (let i = 4; i < total - 4; i += 5 + Math.floor(rnd() * 5)) {
        if (rnd() < 0.45) continue;
        const p = r.line[i], q = r.line[i + 1], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1, off = r.w / 2 + 2.6 + rnd() * 1.5;
        treeSpots.push({ x: p[0] - dz / L * off * side, z: p[1] + dx / L * off * side, species: rnd() < 0.6 ? 'poplar' : 'mulberry', size: 0.9 + rnd() * 0.5 });
      }
    }
  }
  const blds = layout.buildings;
  const inAnyBuilding = (x, z, m) => { for (const b of blds) { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.x, dz = z - b.z, lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < b.w / 2 + m && Math.abs(lz) < b.d / 2 + m) return true; } return false; };
  const okSpot = (t) => t.force || (!onRoad(t.x, t.z, 1.2) && !inAnyBuilding(t.x, t.z, 1.0) && !inCarsi(S, t.x, t.z, 1.5) && terrH(t.x, t.z) > 2);
  const trees = treeSpots.filter(okSpot);
  // stone piles and a few fences out in the plots
  if (!centreOnly) {
    for (let i = 0; i < 14; i++) { const b = blds[Math.floor(rnd() * blds.length)]; if (!b.barn) continue; props.push({ kind: 'stones', x: b.x + (rnd() - 0.5) * 12, z: b.z + (rnd() - 0.5) * 12 }); }
    props.push({ kind: 'bench', x: S.market.x + 7.5, z: S.market.z + 2, yaw: Math.PI / 2 }, { kind: 'bin', x: S.market.x + 7.5, z: S.market.z - 1.5 });
  }

  const propsOut = buildProps(ctx, M, { props: props.filter(p => p.kind === 'tree' || p.force || !onRoad(p.x, p.z, 0.4)), trees, wires }, bat);
  bat.build(M, group);
  if (propsOut.wireMesh) group.add(propsOut.wireMesh);
  for (const m of propsOut.meshes) group.add(m);
  group.traverse(o => { if (o.isMesh && o.material && o.material.userData && o.material.userData.isRoad) { o.castShadow = false; o.renderOrder = 1; } });
  return { group, trees: propsOut.meshes };
}
