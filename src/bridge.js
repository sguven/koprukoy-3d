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

// ---------------------------------------------------------------------------------------------------------------
// v1.22 Walking and driving over the bridge (Nov 2026, owner: "let us cross the bridge").
//
// The deck used to be walkable only through the old road samples of the bridge (data4.js). Since the village
// layout (v0.8) replaces the small roads of its region, the eastern ~18 m of the deck lost theirs: the car fell
// into the river there and the walker stopped at a 5 m drop. The old samples also floated up to 40 cm over the
// deck the model shows. So the deck is now described here, from the model itself: its surface as a function of
// the distance from the crown (ray-cast from the glb, bridge-local y, every 3 m), 2.55 m to each parapet, the
// parapets 0.8 m high and 0.5 m thick.
const DECK_HALF = 2.55, DECK_END = 57;
const PROFILE = [17.497, 17.3, 17.029, 16.715, 16.378, 16.023, 15.641, 15.247, 14.837, 14.416, 13.982, 13.538, 13.083, 12.619, 12.145, 11.663, 11.173, 10.672, 10.167, 10.0];
const BC = Math.cos(YAW), BS = Math.sin(YAW);
const toLocal = (x, z) => { const dx = x - POS[0], dz = z - POS[2]; return [dx * BC - dz * BS, dx * BS + dz * BC]; };
const toWorld = (lx, lz) => [POS[0] + lx * BC + lz * BS, POS[2] - lx * BS + lz * BC];
// (index.html's surfaceInto asks bridgeDeckY() directly: exact, where road discs would round the hump into steps)
/** World height of the deck surface at bridge-local x. */
function deckAt(lx) {
  const f = Math.min(Math.abs(lx), DECK_END) / 3, i = Math.min(PROFILE.length - 2, Math.floor(f));
  return POS[1] + PROFILE[i] + (PROFILE[i + 1] - PROFILE[i]) * (f - i);
}
/** The deck height at (x, z), or -Infinity off the deck (between the parapets, `margin` m wider). */
export function bridgeDeckY(x, z, margin = 0) {
  const [lx, lz] = toLocal(x, z);
  return Math.abs(lx) <= DECK_END && Math.abs(lz) <= DECK_HALF + margin ? deckAt(lx) : -Infinity;
}
/** Is (x, z) within the bridge's footprint (deck and parapets)? Old road samples there are dropped. */
export function onBridge(x, z) { const [lx, lz] = toLocal(x, z); return Math.abs(lx) <= DECK_END && Math.abs(lz) <= DECK_HALF + 0.9; }
/**
 * Road samples ([x, z, y, hw, ...], as D.roads) for a short ramp at the western end: the dirt road there ends 0.75 m
 * over the bank (a step the walking character does not take), 6 m before the bank meets the deck.
 */
export function bridgeRampSamples() {
  const out = [];
  for (let lx = -56; lx <= -50 + 1e-6; lx += 0.5) for (const lz of [-1.5, 0, 1.5]) { const [x, z] = toWorld(lx, lz); out.push(x, z, 3.42 + (2.18 - 3.42) * (lx + 56) / 6, 1.0); }
  return out;
}
/**
 * Collision boxes ([x, z, yaw, hw, hd, ...], as D.buildings) for the two parapets, where they stand above the
 * ground (towards the ends the deck sinks into the banks). The car, the first-person walker and the Game's bots
 * collide with D.buildings only; without these the Toros drove off the side into the river.
 */
export function bridgeParapetBoxes() {
  const out = [];
  for (const lz of [-(DECK_HALF + 0.25), DECK_HALF + 0.25]) { const [x, z] = toWorld(0, lz); out.push(x, z, YAW, 51, 0.25); }
  return out;
}
