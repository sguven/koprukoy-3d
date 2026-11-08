// Real geometry for the Çeşnigir Bridge details that v0.7 only painted: carved voussoir rings around
// every arch (both faces), a projecting string course under the parapet, hand-laid coping stones on
// the parapet, and pyramidal caps on the six cutwaters. The bridge body itself is untouched.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Bridge-local frame of the GLB group (metres; x along the bridge, +z upstream). Deck top is y = 17.5.
const POS = [-376.89, -9.3, -277.44], YAW = 0.3005;
// Intrados outlines (x offset from the arch centre, y) sampled from the model's side profile.
const MAIN = [[-8.8, 2.5], [-8, 5.8], [-7, 8.0], [-6, 10.1], [-5, 11.1], [-4, 12.0], [-3, 12.7], [-2, 13.4], [-1, 14.1], [0, 14.6]];
const A2 = [[-3.4, 1.9], [-3, 2.6], [-2, 5.2], [-1, 6.2], [0, 6.7]];
const A3 = [[-3.2, 2.2], [-2.5, 4.6], [-1.5, 6.2], [-0.5, 7.1], [0, 7.15]];
const A4 = [[-2.8, 2.8], [-2, 5.7], [-1, 7.2], [0, 7.9]];
const A5 = [[-2.7, 3.0], [-2, 5.0], [-1, 7.6], [0, 8.3]];
const R1 = [[-1.8, 9.6], [-1.5, 10.0], [-0.5, 12.3], [0, 12.35]];
const R2 = [[-1.2, 9.5], [-0.5, 10.9], [0, 10.95]];
const R3 = [[-1.2, 12.0], [0, 13.5]];
const R4 = [[-1.2, 10.6], [0, 12.1]];
const R5 = [[-2.5, 9.0], [-1.5, 10.0], [0, 10.6]];
const mirror = (half) => { const out = half.slice(); for (let i = half.length - 2; i >= 0; i--) out.push([-half[i][0], half[i][1]]); return out; };
const ARCHES = [[0, MAIN], [17, A2], [-17, A2], [27.5, A3], [-27.5, A3], [37, A4], [-37, A4], [46, A5], [-46, A5], [11.5, R1], [-11.5, R1], [22.5, R2], [-22.5, R2], [33, R3], [-33, R3], [42, R4], [-42, R4], [53, R5], [-53, R5]];
const CUTWATERS = [[-32.4, 6.6], [-22.4, 5.6], [-11.4, 4.6], [11.4, 4.0], [22.4, 4.6], [32.4, 5.6]];

function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

export function detailBridge(model, lib, pick) {
  const stone = pick('Kesme_Tas', new THREE.MeshStandardMaterial()), geos = [];
  const push = (g, x, y, z, rz = 0) => { if (rz) g.rotateZ(rz); g.translate(x, y, z); geos.push(g); };
  // voussoirs: blocks 0.45 m along the ring, 0.55 m deep, standing 0.12 m proud of each face
  for (const [cx, half] of ARCHES) {
    const pts = resample(mirror(half), 0.47), yc = half[0][1] - 0.5;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
      // normal pointing away from the opening
      let nx = -ty / L, ny = tx / L; if ((mx) * nx + (my - yc) * ny < 0) { nx = -nx; ny = -ny; }
      const ang = Math.atan2(ty, tx);
      for (const z of [3.0, -3.0]) push(new THREE.BoxGeometry(L - 0.03, 0.55, 0.14), cx + mx + nx * 0.27, my + ny * 0.27, z + Math.sign(z) * 0.07 - 0, ang);
    }
    // a keystone that stands a little higher
    const top = half[half.length - 1][1];
    for (const z of [3.0, -3.0]) push(new THREE.BoxGeometry(0.5, 0.75, 0.18), cx, top + 0.33, z + Math.sign(z) * 0.09);
  }
  // string course under the parapet along both faces
  for (const z of [3.0, -3.0]) push(new THREE.BoxGeometry(110, 0.22, 0.16), 0, 16.95, z + Math.sign(z) * 0.08);
  // coping stones on the parapet (hand-laid: slight jitter)
  let s = 0.5; for (let x = -54.5; x < 54.5; x += 0.97) { s = (s * 9301 + 49297) % 233280; const j = s / 233280; for (const z of [2.775, -2.775]) push(new THREE.BoxGeometry(0.9, 0.2, 0.56), x, 18.3 + 0.1 + (j - 0.5) * 0.03, z, (j - 0.5) * 0.02); }
  // pyramidal cutwater caps
  for (const [x, top] of CUTWATERS) { const c = new THREE.ConeGeometry(2.1, 2.2, 3); c.translate(x, top + 1.1 - 0.05, 4.75); geos.push(c); }
  const g = mergeGeometries(geos.map(q => { q.deleteAttribute('uv'); return q; }), false);
  if (!g) return null;
  const mesh = new THREE.Mesh(g, stone); mesh.name = 'Kopru_Detay'; mesh.castShadow = mesh.receiveShadow = true;
  const grp = new THREE.Group(); grp.name = 'Kopru_Detay_G'; grp.position.set(...POS); grp.rotation.y = YAW; grp.add(mesh);
  return grp;
}
