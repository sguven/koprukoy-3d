// Procedural rebuild of the Köprüköy village centre (v0.8): connected roads with kerbs and pavements,
// houses with real window reveals, sills, eaves, gutters, balconies, stairs and roof clutter, the old
// municipality with the Atatürk statue on its square, the mosque with its courtyard, and street props.
// Layout comes from village_layout.js; materials from village_materials.js; props from props.js.
import * as THREE from 'three';
import { GeoBatch, box, boxY, cyl, facadeWithHoles, roofGeometry, gableEnds, ribbon, patch } from './geo.js';
import { inRegion, inCentreZone, rectCorners, distToPolyline } from './village_layout.js';
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
    bat.add('road_' + r.kind, ribbon(r.line, prof, yAt, 1 / hw));
    if (!r.kerb) continue;
    // kerb + 1.5 m pavement on both sides, interrupted around junctions with other roads
    for (const side of [-1, 1]) {
      let run = [];
      const flush = () => { if (run.length > 2) addKerb(run, side); run = []; };
      for (const p of r.line) {
        let near = false;
        for (const o of roads) { if (o === r) continue; if (distToPolyline(p[0], p[1], o.line).d < o.w / 2 + hw + 1.5) { near = true; break; } }
        // and keep clear of the mosque courtyard wall and the square
        if (near) flush(); else run.push(p);
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
      if (!onRoad(x, z, 0.6)) { props.push({ kind: 'pole', x, z, prev }); prev = { x, z }; } else prev = null;
      s += 32 + rnd() * 10;
    }
  }

  // ================================================================= the square and the lawns
  const S = layout.sites;
  bat.add('square', patch(S.square.x, S.square.z, S.square.w, S.square.d, 0, yAt, LIFT.square, 2.5));
  if (!centreOnly) {
    const green = S.green1; bat.add('lawn', patch(green.x, green.z, 7, 6, 0, yAt, 0.07, 1.5));
    props.push({ kind: 'bench', x: green.x - 1.5, z: green.z + 1.0, yaw: 0.2 }, { kind: 'bin', x: green.x + 2.2, z: green.z + 1.5 }, { kind: 'tree', species: 'mulberry', x: green.x + 1.0, z: green.z - 1.5, size: 1.1 });
  }
  props.push({ kind: 'bench', x: S.square.x + 7, z: S.square.z + 13, yaw: 0 }, { kind: 'bench', x: S.square.x + 7, z: S.square.z - 12, yaw: 0 }, { kind: 'bin', x: S.square.x + 9, z: S.square.z + 15 });
  for (const [dx, dz] of [[-2, 14], [8, -16], [9, 10]]) props.push({ kind: 'tree', species: 'mulberry', x: S.square.x + dx, z: S.square.z + dz, size: 1.3 });

  // ================================================================= buildings
  for (const b of layout.buildings) {
    if (b.kind === 'mosque') { buildMosque(b); continue; }
    if (b.kind === 'minaret') continue; // built with the mosque
    if (b.kind === 'municipality') { buildMunicipality(b); continue; }
    buildHouse(b);
  }
  buildStatue(S.statue); buildGazebo(S.gazebo);

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
    const wallKey = b.kind === 'market' || b.kind === 'kahve' || b.kind === 'school' ? 'Duvar_Beyaz' : WALLS[Math.floor(rnd() * WALLS.length)];
    const roofKey = b.roof === 'm' ? (rnd() < 0.7 ? 'Cati_Sac_Gri' : 'Cati_Sac_Mavi') : TILES[Math.floor(rnd() * TILES.length)];
    const add = (key, geo, m) => { if (m) geo.applyMatrix4(m); bat.add(key, geo, frame, bld); };
    const front = frontSide(b), isBarn = !!b.barn;
    // plinth
    add('plinth', boxY(w + 0.16, d + 0.16, b.yLow - b.yTop - 0.3, y0 + 0.02));
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
        const wallH = b.wall === 'wall' ? 1.25 + rnd() * 0.5 : 0, wb = b.yLow - b.yTop - 0.3;   // walls reach below the lowest plot corner
        const segs = [[-len / 2, gate - gw / 2], [gate + gw / 2, len / 2]];
        for (const [a0, a1] of segs) {
          if (b.wall === 'wall') add('garden', box(a1 - a0, wallH - wb, 0.3, (a0 + a1) / 2, (wallH + wb) / 2, zf), fm);
          else { for (let x = a0; x <= a1; x += 2.2) add('beton', box(0.1, 1.45 - wb, 0.1, x, (1.45 + wb) / 2, zf), fm); fenceWires(a0, a1, zf, fm); }
        }
        // returns on both sides, back to the house line
        for (const sx of [-len / 2, len / 2]) {
          if (b.wall === 'wall') add('garden', box(0.3, wallH - wb, zf + 0.3, sx, (wallH + wb) / 2, zf / 2), fm);
          else { for (let z = 0; z <= zf; z += 2.2) add('beton', box(0.1, 1.45 - wb, 0.1, sx, (1.45 + wb) / 2, z), fm); fenceWiresZ(sx, 0, zf, fm); }
        }
        for (const gx of [gate - gw / 2 - 0.2, gate + gw / 2 + 0.2]) add('garden', box(0.4, 1.9 - wb, 0.4, gx, (1.9 + wb) / 2, zf), fm);
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
  function buildMunicipality(b) {
    const id = bid++, frame = { x: b.x, y: b.yTop, z: b.z, yaw: b.yaw }, w = b.w, d = b.d;
    const FH = 3.2, n = 3, y0 = 0.5, y1 = y0 + n * FH + 0.3;
    const bld = { id, base: b.yTop, top: b.yTop + y1, yaw: b.yaw, cx: b.x, cz: b.z };
    const add = (key, geo, m) => { if (m) geo.applyMatrix4(m); bat.add(key, geo, frame, bld); };
    add('plinth', boxY(w + 0.2, d + 0.2, b.yLow - b.yTop - 0.3, y0 + 0.02));
    // the square lies east of the building; local -z faces east (yaw ~ -95°)
    const front = frontSide({ ...b, face: 0 });
    for (const side of ['+z', '-z', '+x', '-x']) {
      const L = side === '+z' || side === '-z' ? w : d, fm = faceMatrix(side, w, d), isFront = side === front;
      const bays = Math.max(1, Math.round(L / 2.6)), bw = L / bays, holes = [], panes = [];
      for (let k = 0; k < n; k++) {
        const fy = y0 + k * FH;
        for (let i = 0; i < bays; i++) {
          const x = -L / 2 + bw * (i + 0.5);
          if (k === 0 && isFront && i === Math.floor(bays / 2)) {
            holes.push({ x, y: fy + 1.3, w: 1.8, h: 2.6 }); panes.push({ x, y: fy + 1.3, w: 1.8, h: 2.6, door: true });
            add('beton', box(3.2, 0.18, 1.6, x, fy + 2.75, 0.8), fm);                        // entrance canopy
            for (const sx of [-1.3, 1.3]) add('pilaster', box(0.3, 2.65, 0.3, x + sx, fy + 1.32, 1.4), fm);
            for (let s = 0; s < 3; s++) add('step', box(3.6 - s * 0.3, 0.17, 1.4 - s * 0.4, x, fy - 0.1 - s * 0.17 + 0.17, 0.7 - s * 0.2), fm);
            add('trim', box(3.0, 0.7, 0.08, x, fy + 3.4, 0.16), fm);                        // sign board above the door
            continue;
          }
          const ww = bw - 0.75, wh = 1.6, wy = fy + 1.75;
          holes.push({ x, y: wy, w: ww, h: wh }); panes.push({ x, y: wy, w: ww, h: wh });
          add('trim', box(ww + 0.2, 0.08, 0.3, x, wy - wh / 2 - 0.04, 0.12), fm);
        }
      }
      add('whitewash', facadeWithHoles(L, y0, y1, 0, 1, holes), fm);
      for (const h of holes) { const dep = 0.22;
        add('whitewash', box(h.w, 0.02, dep, h.x, h.y + h.h / 2 - 0.01, -dep / 2), fm); add('whitewash', box(h.w, 0.02, dep, h.x, h.y - h.h / 2 + 0.01, -dep / 2), fm);
        add('whitewash', box(0.02, h.h, dep, h.x - h.w / 2 + 0.01, h.y, -dep / 2), fm); add('whitewash', box(0.02, h.h, dep, h.x + h.w / 2 - 0.01, h.y, -dep / 2), fm); }
      for (const p of panes) { const g = new THREE.PlaneGeometry(p.w, p.h); g.translate(p.x, p.y, -0.2); g.applyMatrix4(fm); bat.add(p.door ? 'door' : 'glass', g, frame, bld, p.door ? null : [p.w, p.h]); }
      // red-brown pilasters between the bays and a band under the eaves (docs/reference/02)
      for (let i = 0; i <= bays; i++) { const x = Math.max(-L / 2 + 0.2, Math.min(L / 2 - 0.2, -L / 2 + bw * i)); add('pilaster', box(0.42, y1 - y0, 0.14, x, (y0 + y1) / 2, 0.07), fm); }
      for (let k = 1; k < n; k++) add('pilaster', box(L, 0.25, 0.1, 0, y0 + k * FH - 0.1, 0.05), fm);
    }
    const e = 0.9, pitch = 0.3, ry = y1 - 0.05, roof = roofGeometry(w, d, e, pitch, ry, 'h'), rise = roof.userData.rise;
    add('Cati_Kiremit_Koyu', roof);
    const W = w / 2 + e, Dd = d / 2 + e;
    for (const [bw2, bd2, cx, cz] of [[2 * W + 0.06, 0.06, 0, Dd], [2 * W + 0.06, 0.06, 0, -Dd], [0.06, 2 * Dd, W, 0], [0.06, 2 * Dd, -W, 0]]) add('trim', box(bw2, 0.25, bd2, cx, ry - 0.1, cz));
    const sof = new THREE.PlaneGeometry(2 * W, 2 * Dd); sof.rotateX(Math.PI / 2); sof.translate(0, ry - 0.02, 0); add('trim', sof);
    add('Cati_Kiremit_Koyu', box(2 * W - 2 * Math.min(Dd, W - 0.5) + 0.1, 0.1, 0.3, 0, ry + rise + 0.02, 0));
    add('metal', box(2 * W, 0.1, 0.12, 0, ry - 0.22, Dd + 0.05)); add('metal', box(2 * W, 0.1, 0.12, 0, ry - 0.22, -Dd - 0.05));
    for (const sx of [W - 0.15, -W + 0.15]) add('metal', cyl(0.05, 0.05, ry - 0.3, sx, (ry - 0.3) / 2 + 0.05, Dd - 0.15));
    // flag pole in front of the entrance
    const fm = faceMatrix(front, w, d);
    add('metal', cyl(0.04, 0.05, 7.5, 2.5, 3.75, 3.0), fm);
    const flag = new THREE.PlaneGeometry(1.5, 1.0); flag.translate(2.5 + 0.75, 6.9, 3.0); add('flag', flag, fm);
    add('beton', box(0.6, 0.5, 0.6, 2.5, 0.25, 3.0), fm);
  }

  // ---------------------------------------------------------------- statue, gazebo -----------
  function buildStatue(s) {
    const y = terrH(s.x, s.z), frame = { x: s.x, y, z: s.z, yaw: Math.PI / 2 }; // facing east, onto the square
    const add = (key, geo) => bat.add(key, geo, frame);
    add('beton', box(3.0, 0.18, 3.0, 0, 0.09, 0)); add('beton', box(2.4, 0.18, 2.4, 0, 0.27, 0));
    add('granite', boxY(1.4, 1.4, 0.36, 2.9)); add('granite', box(1.65, 0.14, 1.65, 0, 2.97, 0)); add('granite', box(1.5, 0.1, 1.5, 0, 0.41, 0));
    // the figure: a standing bronze in a long coat
    const base = 3.04;
    add('bronze', box(0.75, 0.12, 0.75, 0, base + 0.06, 0));
    for (const sx of [-0.14, 0.14]) add('bronze', cyl(0.11, 0.12, 0.95, sx, base + 0.6, 0, 10));
    add('bronze', cyl(0.3, 0.36, 1.05, 0, base + 1.55, 0, 12));           // coat
    add('bronze', box(0.56, 0.4, 0.34, 0, base + 2.05, 0));                 // chest
    add('bronze', cyl(0.09, 0.1, 0.15, 0, base + 2.32, 0, 10));             // neck
    const head = new THREE.SphereGeometry(0.15, 14, 10); head.scale(1, 1.18, 1); head.translate(0, base + 2.55, 0); add('bronze', head);
    const armL = cyl(0.07, 0.08, 0.75, 0, 0, 0, 8); armL.rotateZ(0.25); armL.translate(-0.38, base + 1.85, 0.05); add('bronze', armL);
    const armR = cyl(0.07, 0.08, 0.75, 0, 0, 0, 8); armR.rotateX(-0.9); armR.translate(0.36, base + 2.05, 0.3); add('bronze', armR); // right arm raised forward
    add('bronze', box(0.8, 0.06, 0.4, 0, base + 2.3, -0.05));              // cape line at the shoulders
  }
  function buildGazebo(g) {
    const y = terrH(g.x, g.z), frame = { x: g.x, y, z: g.z, yaw: 0 }, add = (key, geo) => bat.add(key, geo, frame);
    add('beton', cyl(2.9, 3.0, 0.25, 0, 0.12, 0, 6));
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, x = Math.cos(a) * 2.3, z = Math.sin(a) * 2.3; add('woodRaw', box(0.14, 2.5, 0.14, x, 1.5, z)); add('woodRaw', box(0.3, 0.06, 0.3, x, 0.25 + 0.03, z)); }
    for (let i = 0; i < 6; i++) { const a0 = i / 6 * Math.PI * 2, a1 = (i + 1) / 6 * Math.PI * 2, mx = (Math.cos(a0) + Math.cos(a1)) / 2 * 2.3, mz = (Math.sin(a0) + Math.sin(a1)) / 2 * 2.3; if (i === 0) continue; const b = box(2.3, 0.05, 0.4, 0, 0.7, 0); b.rotateY(-((a0 + a1) / 2) + Math.PI / 2); b.translate(mx * 0.93, 0, mz * 0.93); add('woodRaw', b); }
    const roof = new THREE.ConeGeometry(3.2, 1.1, 6, 1, true); roof.translate(0, 2.75 + 0.55, 0); add('greenPaint', roof);
    const ring = new THREE.CylinderGeometry(3.2, 3.2, 0.12, 6, 1, true); ring.translate(0, 2.7, 0); add('woodRaw', ring);
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
    // minaret at the north-east corner: stone base, polygonal shaft, one şerefe, lead cap
    const mx = hw / 2 + 2.2, mz = pz - 0.5, mb = y0;
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
    // courtyard: red plastered wall with a concrete coping, gates on the north and east sides
    const cw = 25, cd = 33, cz0 = hz + 1.0, wallH = 1.75;
    const wb = b.yLow - yG - 1.0;
    const wallSeg = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(-(z1 - z0), x1 - x0); const g = box(L, wallH - wb, 0.35, 0, (wallH + wb) / 2, 0); g.rotateY(ang); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); add('redWall', g); const c = box(L + 0.05, 0.08, 0.5, 0, wallH + 0.04, 0); c.rotateY(ang); c.translate((x0 + x1) / 2, 0, (z0 + z1) / 2); add('coping', c); };
    const W2 = cw / 2, D2 = cd / 2;
    wallSeg(-W2, cz0 - D2, -W2 + W2 - 1.6, cz0 - D2); wallSeg(1.6, cz0 - D2, W2, cz0 - D2);        // north with a central gate
    wallSeg(-W2, cz0 + D2, W2, cz0 + D2);                                                       // south
    wallSeg(-W2, cz0 - D2, -W2, cz0 + D2);                                                       // west
    wallSeg(W2, cz0 - D2, W2, cz0 - 2.0); wallSeg(W2, cz0 + 1.0, W2, cz0 + D2);                  // east with a gate
    for (const [gx, gz] of [[-1.6, cz0 - D2], [1.6, cz0 - D2], [W2, cz0 - 2.0], [W2, cz0 + 1.0]]) add('limestone', box(0.5, 2.3, 0.5, gx, 1.0, gz));
    // iron gates: frame and bars
    for (let i = -9; i <= 9; i++) add('railing', box(0.03, 1.9, 0.03, i * 0.15, 0.95, cz0 - D2));
    for (const yy of [0.15, 1.0, 1.85]) add('railing', box(2.9, 0.04, 0.04, 0, yy, cz0 - D2));
    for (let i = -9; i <= 9; i++) add('railing', box(0.03, 1.9, 0.03, W2, 0.95, cz0 - 0.5 + i * 0.15));
    for (const yy of [0.15, 1.0, 1.85]) add('railing', box(0.04, 0.04, 2.9, W2, yy, cz0 - 0.5));
    // inside: paving to the door, a lawn, the ablution fountain
    add('paving', box(3.0, 0.12, D2 - hd / 2 - 2.2 + 2.0, 0, y0 - 0.2, (cz0 - D2 + pz - 2.2) / 2 + 0.5));
    add('limestone', cyl(1.2, 1.3, 1.0, -W2 + 4, 0.5, cz0 - D2 + 5, 8)); add('lead', new THREE.ConeGeometry(1.7, 0.9, 8).translate(-W2 + 4, 2.6, cz0 - D2 + 5)); for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; add('limestone', cyl(0.08, 0.08, 1.5, -W2 + 4 + Math.cos(a) * 1.5, 1.75, cz0 - D2 + 5 + Math.sin(a) * 1.5, 6)); }
    // trees inside the yard (pines behind the mosque, as in docs/reference/06) and the lawn / picnic table outside the east wall
    for (const [tx, tz] of [[-W2 + 3, cz0 + D2 - 4], [W2 - 3, cz0 + D2 - 3], [-W2 + 3, cz0 + 2], [W2 - 3, cz0 + 9]]) treeSpots.push({ x: b.x + tx, z: b.z + tz, species: 'pine', size: 1.0 + rnd() * 0.3, force: true });
    for (const [tx, tz] of [[-W2 + 5, cz0 - D2 + 11], [W2 - 5, cz0 - D2 + 6]]) treeSpots.push({ x: b.x + tx, z: b.z + tz, species: 'mulberry', size: 1.1, force: true });
    if (centreOnly) return;   // no new street outside the wall in centre-only mode: the v0.6 roads stay
    const rdE = roadDist(b.x + W2, b.z + cz0), lawnW = Math.max(2, Math.min(9, rdE.d - rdE.w / 2 - 2.2)), lawnX = b.x + W2 + 0.4 + lawnW / 2, lawnZ = b.z + cz0;
    bat.add('lawn', patch(lawnX, lawnZ, lawnW, cd, 0, yAt, 0.07, 1.5));
    props.push({ kind: 'picnic', x: lawnX - 0.3, z: lawnZ - 6, yaw: 0 }, { kind: 'bin', x: lawnX + 0.8, z: lawnZ + 4 });
    for (const [tx, tz] of [[-W2 - 3, cz0 - D2 - 4], [W2 - 8, cz0 - D2 - 5]]) treeSpots.push({ x: b.x + tx, z: b.z + tz, species: 'mulberry', size: 1.2 });
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
  const okSpot = (t) => t.force || (!onRoad(t.x, t.z, 1.2) && !inAnyBuilding(t.x, t.z, 1.0) && terrH(t.x, t.z) > 2);
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
