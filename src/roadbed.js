// v1.23: the ground under the D.260 carriageways. The v0.6 GLB laid the dual carriageway as a concrete deck over
// a terrain that rises above it in places (up to 1.8 m on the stretch along the lake), so the ground cut through
// the asphalt in jagged dark-edged patches (owner's phone screenshot, 27 Nov 2026). The caps in roadbed_data.js
// (tools/roadbed.py) keep the ground at least 15 cm under the deck; they are applied to the height grid (so the
// walk / car / vegetation heights agree) and to the fine Arazi_Detay overlay mesh.
import * as THREE from 'three';
import { GRID_CAPS, DETAIL_CAPS } from './roadbed_data.js';

/** Lowers the grid nodes under the deck; records them in `changed` (the CS_EDIT map synced onto the Arazi mesh). */
export function editRoadbedTerrain(grid, changed) {
  let n = 0;
  for (const [k, y] of GRID_CAPS) if (grid.h[k] > y) { grid.h[k] = y; changed.set(k, y); n++; }
  return n;
}

/** Lowers the matching vertices of an Arazi_Detay mesh (world x, z within 3 cm). */
export function editRoadbedDetail(mesh) {
  mesh.updateWorldMatrix(true, false);
  const e = mesh.matrixWorld.elements, p = mesh.geometry.attributes.position;
  // the overlay is scaled uniformly with no rotation (GLB): world = s * local + t
  const s = e[5], tx = e[12], ty = e[13], tz = e[14];
  const caps = new Map(); for (const [x, z, y] of DETAIL_CAPS) caps.set(`${Math.round(x * 20)},${Math.round(z * 20)}`, y);
  const pos = new Float32Array(p.count * 3); let n = 0;
  for (let i = 0; i < p.count; i++) {
    pos[i * 3] = p.getX(i); pos[i * 3 + 1] = p.getY(i); pos[i * 3 + 2] = p.getZ(i);
    const x = e[0] * p.getX(i) + tx, z = e[10] * p.getZ(i) + tz;
    let y = null;
    for (let dx = -1; dx <= 1 && y === null; dx++) for (let dz = -1; dz <= 1 && y === null; dz++) { const c = caps.get(`${Math.round(x * 20) + dx},${Math.round(z * 20) + dz}`); if (c !== undefined) y = c; }
    if (y === null) continue;
    const ly = (y - ty) / s; if (pos[i * 3 + 1] > ly) { pos[i * 3 + 1] = ly; n++; }
  }
  if (n) { const g = mesh.geometry; g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.deleteAttribute('normal'); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); }
  return n;
}
