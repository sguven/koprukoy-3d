// Small geometry toolkit for the procedural village: a per-material geometry accumulator that carries
// the building attributes the façade shaders expect (aBld / aCtr, and aWuv / aWsz on window panes),
// plus box / ribbon / façade-with-holes builders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mergeByCell, cellSizeFor, viewDistance } from './perf.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();

export class GeoBatch {
  constructor() { this.buckets = new Map(); }
  /**
   * Add `geo` under material `key`. `frame` = { x, y, z, yaw } places a local-frame geometry in the world;
   * `bld` = { id, base, top, yaw, cx, cz } tags the vertices for the building shaders.
   */
  add(key, geo, frame = null, bld = null, win = null) {
    if (frame) { _p.set(frame.x, frame.y || 0, frame.z); _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), frame.yaw || 0); _m.compose(_p, _q, _s); geo.applyMatrix4(_m); }
    const n = geo.attributes.position.count;
    const b = bld || { id: 0, base: 0, top: 10, yaw: 0, cx: 0, cz: 0 };
    const a = new Float32Array(n * 4), c = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { a.set([b.id, b.base, b.top, b.yaw], i * 4); c.set([b.cx, b.cz], i * 2); }
    geo.setAttribute('aBld', new THREE.BufferAttribute(a, 4)); geo.setAttribute('aCtr', new THREE.BufferAttribute(c, 2));
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    // window panes: pane-local uv + pane size, so the glass shader can draw frames
    const wuv = new Float32Array(n * 2), wsz = new Float32Array(n * 2);
    if (win) { const uv = geo.attributes.uv; for (let i = 0; i < n; i++) { wuv[i * 2] = uv.getX(i); wuv[i * 2 + 1] = uv.getY(i); wsz[i * 2] = win[0]; wsz[i * 2 + 1] = win[1]; } }
    geo.setAttribute('aWuv', new THREE.BufferAttribute(wuv, 2)); geo.setAttribute('aWsz', new THREE.BufferAttribute(wsz, 2));
    if (!geo.index) geo.setIndex([...Array(n).keys()]);
    if (!this.buckets.has(key)) this.buckets.set(key, []);
    this.buckets.get(key).push(geo);
  }
  /**
   * Merge every bucket into meshes with the material from `materials[key]` (or materials.get(key)).
   * v1.0: a material with many triangles is merged per map cell (cellSizeFor), so its meshes can be frustum- and
   * distance-culled; a material with few triangles stays one mesh, so it costs a single draw call.
   */
  build(materials, group, { shadows = true, culler = null } = {}) {
    for (const [key, gs] of this.buckets) {
      const mat = typeof materials === 'function' ? materials(key) : materials[key];
      if (!mat) { console.warn('[village] no material for', key); continue; }
      let tris = 0; for (const g of gs) tris += g.index.count / 3;
      for (const [, g] of mergeByCell(gs, cellSizeFor(tris))) {
        const mesh = new THREE.Mesh(g, mat); mesh.name = 'V_' + key; mesh.castShadow = shadows && !/^(road|pave|kerb|square|lawn|lines)/.test(key); mesh.receiveShadow = true;
        mesh.userData.vkey = key;
        group.add(mesh);
        if (culler) culler.add(mesh, viewDistance(key));
      }
    }
    this.buckets.clear();
    return group;
  }
}

/** Axis-aligned box of size (w, h, d) with its centre at (cx, cy, cz) (local frame). */
export function box(w, h, d, cx = 0, cy = 0, cz = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(cx, cy, cz); return g; }
/** Box spanning y0..y1. */
export function boxY(w, d, y0, y1, cx = 0, cz = 0) { return box(w, y1 - y0, d, cx, (y0 + y1) / 2, cz); }
export function cyl(rTop, rBot, h, cx, cy, cz, seg = 12) { const g = new THREE.CylinderGeometry(rTop, rBot, h, seg); g.translate(cx, cy, cz); return g; }

/**
 * A vertical façade plane with rectangular holes. Local frame: the façade lies in the plane z = z0,
 * spanning x in [-L/2, L/2] and y in [y0, y1]; `holes` = [{x, y, w, h}] in that frame (x, y = centre).
 * `outward` = +1 if the normal points to +z, -1 for -z.
 */
export function facadeWithHoles(L, y0, y1, z0, outward, holes) {
  const shape = new THREE.Shape();
  shape.moveTo(-L / 2, y0); shape.lineTo(L / 2, y0); shape.lineTo(L / 2, y1); shape.lineTo(-L / 2, y1); shape.closePath();
  for (const h of holes) {
    const p = new THREE.Path(); const x0 = h.x - h.w / 2, x1 = h.x + h.w / 2, ya = h.y - h.h / 2, yb = h.y + h.h / 2;
    p.moveTo(x0, ya); p.lineTo(x1, ya); p.lineTo(x1, yb); p.lineTo(x0, yb); p.closePath(); shape.holes.push(p);
  }
  const g = new THREE.ShapeGeometry(shape);
  if (outward < 0) g.rotateY(Math.PI);           // shape normal is +z; flip for the -z face
  g.translate(0, 0, z0);
  return g;
}

/** Hip or gable roof solid (top faces only) over a footprint w x d with eaves `e`, pitch angle `pitch` (rad); ridge along x. */
export function roofGeometry(w, d, e, pitch, y0, kind = 'h') {
  const W = w / 2 + e, D = d / 2 + e, rise = D * Math.tan(pitch);
  const v = [], push = (...pts) => { for (const p of pts) v.push(...p); };
  const A = [-W, y0, D], B = [W, y0, D], C = [W, y0, -D], Dd = [-W, y0, -D];
  if (kind === 'g') {
    const R1 = [-W, y0 + rise, 0], R2 = [W, y0 + rise, 0];
    push(A, B, R2, A, R2, R1);          // south slope (+z)
    push(C, Dd, R1, C, R1, R2);         // north slope (-z)
  } else {
    const hipIn = Math.min(D, W - 0.5);
    const R1 = [-W + hipIn, y0 + rise, 0], R2 = [W - hipIn, y0 + rise, 0];
    push(A, B, R2, A, R2, R1);
    push(C, Dd, R1, C, R1, R2);
    push(B, C, R2);                     // east hip
    push(Dd, A, R1);                    // west hip
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals();
  g.userData.rise = rise;
  return g;
}

/** Gable-end triangles (the wall part under a gable roof). */
export function gableEnds(w, d, pitch, y0) {
  const D = d / 2, rise = (D) * Math.tan(pitch), W = w / 2, v = [];
  v.push(W, y0, D, W, y0, -D, W, y0 + rise, 0);      // east end (normal +x)
  v.push(-W, y0, -D, -W, y0, D, -W, y0 + rise, 0);   // west end (normal -x)
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
}

/**
 * Terrain-conforming ribbon along a centreline (array of [x, z]). `profile` is a list of
 * { u, dy } cross-section stations (u in metres from the centre, dy = height above the ground);
 * `yAt(x, z)` gives the ground height. UV: x = u / halfWidth (signed), y = distance along in metres.
 */
export function ribbon(line, profile, yAt, uScale = 1, wScale = null) {
  const n = line.length, m = profile.length, pos = [], uv = [], idx = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const p = line[i], q = line[Math.min(n - 1, i + 1)], o = line[Math.max(0, i - 1)];
    let tx = q[0] - o[0], tz = q[1] - o[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    const nx = -tz, nz = tx;
    if (i > 0) s += Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]);
    for (let j = 0; j < m; j++) {
      const st = profile[j], ws = wScale ? wScale[i] : 1, x = p[0] + nx * st.u * ws, z = p[1] + nz * st.u * ws;
      pos.push(x, yAt(x, z, st) + st.dy, z); uv.push(st.u * uScale, s);
    }
    if (i > 0) for (let j = 0; j + 1 < m; j++) {
      const a = (i - 1) * m + j, b = a + 1, c = i * m + j, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Terrain-conforming rectangular patch (grid), centred at (cx, cz), rotated by yaw. */
export function patch(cx, cz, w, d, yaw, yAt, lift, step = 3) {
  const nx = Math.max(1, Math.ceil(w / step)), nz = Math.max(1, Math.ceil(d / step)), pos = [], uv = [], idx = [];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const lx = -w / 2 + w * i / nx, lz = -d / 2 + d * j / nz, x = cx + lx * c + lz * s, z = cz - lx * s + lz * c;
    pos.push(x, yAt(x, z) + lift, z); uv.push(lx, lz);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c2 = a + nx + 1, d2 = c2 + 1; idx.push(a, c2, b, b, c2, d2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
