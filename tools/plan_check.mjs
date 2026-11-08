// Dumps the generated village layout (roads + buildings) as JSON for a quick top-down plan check.
// Usage: node tools/plan_check.mjs > layout.json
import { buildVillageLayout } from '../src/village_layout.js';
import data from '../data4.js';

const G = data.grid, S = G.seg, cs = G.size / S, H = G.h;
function terrH(x, z) {
  const fx = (x - G.x0) / cs, fz = (z - G.z0) / cs;
  const ix = Math.max(0, Math.min(S - 1, Math.floor(fx))), iz = Math.max(0, Math.min(S - 1, Math.floor(fz))), u = Math.min(1, Math.max(0, fx - ix)), v = Math.min(1, Math.max(0, fz - iz)), W1 = S + 1;
  const ha = H[ix + W1 * iz], hb = H[ix + W1 * (iz + 1)], hc = H[ix + 1 + W1 * (iz + 1)], hd = H[ix + 1 + W1 * iz];
  return u + v <= 1 ? ha + (hd - ha) * u + (hb - ha) * v : hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
}
const L = buildVillageLayout(terrH, data.roads);
const out = { roads: L.roads.map(r => ({ id: r.id, kind: r.kind, w: r.w, line: r.line })), buildings: L.buildings, sites: L.sites, oldRoads: data.roads, oldBuildings: data.buildings };
process.stdout.write(JSON.stringify(out));
console.error('roads', L.roads.length, 'buildings', L.buildings.length);
