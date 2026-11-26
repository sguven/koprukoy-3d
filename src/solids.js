// v1.17 Solid walls, kerbs and fences for the walking character (Nov 2026, owner: "we walk through the pavements and
// walls: make them solid, and let us jump over them").
//
// The collision data of the first-person walk only knows the building footprints (D.buildings) and the ground
// (terrain, roads, bridge). Everything else the village builds — stone and brick walls, kerbs and pavements, fences,
// railings, steps, benches, lamp posts, tree trunks, rocks — had no collision. Instead of giving each of those builders
// its own collision shapes, this module reads the finished scene once: every triangle of the solid meshes is sampled
// every ~20 cm and the samples are binned into a 25 cm grid over the ground. Each cell keeps
//   top   the highest point of anything standing there, up to LOW m above the terrain (a wall's crown, a kerb's top);
//   tall  whether something there also goes on above that (a house wall, a lamp post, a tree trunk, a big rock).
// So a cell is either free ground, something low to step onto (a kerb, a pavement, a step: up to STEP above the feet),
// something to jump onto or over (a wall, a fence: its top), or a tall solid that nothing gets over. Overhangs that start
// above LOW (eaves, canopies, lamp heads, balconies) are ignored, so you can walk under them.
//
// Built in time slices after the page has loaded (a few hundred ms in all, ~8 ms a frame), so it never stalls a frame.
import * as THREE from 'three';

export const CELL = 0.25;          // grid cell (m)
const CH = 64;                      // cells per chunk side (16 m)
const LOW = 2.6;                    // above this height over the terrain a sample only marks the cell "tall"
const TALL_TO = 4.5;                // ... up to this height (higher: upper storeys, roofs, minarets: ignored)
const SAMPLE = 0.2;                 // sample spacing on a triangle (m)
// meshes that are not obstacles: ground and road surfaces, foliage and grass, glass, water, the car and the character
const SKIP = /^(Arazi|Su_|Yol|Toprak_Yol|Otlar|Calilar|Gezi_Alani|Pencereler|Cim|Toros|V_road|V_lawn|V_csLawn|V_glass|Cam$|V_vine|V_grape|V_flagTR|V_canvas|V_csLampGlass|.*Yaprak)/;

export function createSolids({ scene, terrH, exclude = [] }) {
  const chunks = new Map();
  const ckey = (ci, cj) => ci * 100003 + cj;
  function chunkAt(ci, cj, make) {
    const k = ckey(ci, cj); let c = chunks.get(k);
    if (!c && make) { c = { top: new Float32Array(CH * CH).fill(-1e9), tall: new Uint8Array(CH * CH) }; chunks.set(k, c); }
    return c;
  }
  function put(x, y, z) {
    const g = terrH(x, z), h = y - g;
    if (h < -0.3 || h > TALL_TO) return;
    const i = Math.floor(x / CELL), j = Math.floor(z / CELL), ci = Math.floor(i / CH), cj = Math.floor(j / CH);
    const c = chunkAt(ci, cj, true), n = (i - ci * CH) + (j - cj * CH) * CH;
    if (h > LOW) c.tall[n] = 1; else if (y > c.top[n]) c.top[n] = y;
  }

  // ---- the job list: one entry per mesh (or per instance of an instanced mesh) ----
  const jobs = [];
  const skipSet = new Set(exclude);
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || !o.name || SKIP.test(o.name)) return;
    for (let a = o; a; a = a.parent) if (skipSet.has(a) || a.name === 'Arena') return;   // (the Game's bots and weapons)
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (m && m.transparent && m.opacity < 0.9) return;
    const pos = o.geometry.attributes.position; if (!pos) return;
    const n = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < n; k++) {
      const mat = new THREE.Matrix4();
      if (o.isInstancedMesh) { o.getMatrixAt(k, mat); mat.premultiply(o.matrixWorld); } else mat.copy(o.matrixWorld);
      jobs.push({ o, mat, tri: 0 });
    }
  });

  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  /** Sample triangles of the current job until the deadline. Returns true when everything is done. */
  function work(deadline) {
    while (jobs.length) {
      const J = jobs[jobs.length - 1], g = J.o.geometry, pos = g.attributes.position, idx = g.index;
      const nTri = (idx ? idx.count : pos.count) / 3;
      for (; J.tri < nTri; J.tri++) {
        if ((J.tri & 63) === 0 && performance.now() > deadline) return false;
        const t = J.tri * 3, ia = idx ? idx.getX(t) : t, ib = idx ? idx.getX(t + 1) : t + 1, ic = idx ? idx.getX(t + 2) : t + 2;
        a.fromBufferAttribute(pos, ia).applyMatrix4(J.mat); b.fromBufferAttribute(pos, ib).applyMatrix4(J.mat); c.fromBufferAttribute(pos, ic).applyMatrix4(J.mat);
        // skip triangles wholly above TALL_TO or below the ground (cheap test at the centroid)
        const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3, gy = terrH(cx, cz);
        if (Math.min(a.y, b.y, c.y) > gy + TALL_TO || Math.max(a.y, b.y, c.y) < gy - 0.3) continue;
        e1.subVectors(b, a); e2.subVectors(c, a);
        const n1 = Math.max(1, Math.ceil(e1.length() / SAMPLE)), n2 = Math.max(1, Math.ceil(e2.length() / SAMPLE));
        if (n1 * n2 > 40000) continue;   // a huge triangle (a ground plate): not an obstacle
        for (let u = 0; u <= n1; u++) for (let v = 0; v <= n2 - u * n2 / n1 + 1e-6; v++) {
          const s = u / n1, r = v / n2; if (s + r > 1.0001) break;
          put(a.x + e1.x * s + e2.x * r, a.y + e1.y * s + e2.y * r, a.z + e1.z * s + e2.z * r);
        }
      }
      jobs.pop();
    }
    return true;
  }

  const S = {
    ready: false,
    /** Build in slices of `ms` per animation frame; resolves when done. */
    build(ms = 8) {
      const t0 = performance.now();
      return new Promise(res => { const f = () => { if (work(performance.now() + ms)) { S.ready = true; S.ms = performance.now() - t0; res(S); } else requestAnimationFrame(f); }; f(); });
    },
    /**
     * The highest solid in a disk of radius r around (x, z) that rises above `above`; Infinity for a tall solid
     * (one that goes on above LOW over the terrain, e.g. a house wall or a post), -1e9 when there is none.
     */
    topIn(x, z, r, above = -1e9) {
      let best = -1e9;
      const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL), r2 = (r + CELL * 0.71) ** 2;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * CELL - x, dz = (j + 0.5) * CELL - z; if (dx * dx + dz * dz > r2) continue;
        const ci = Math.floor(i / CH), cj = Math.floor(j / CH), ch = chunks.get(ckey(ci, cj)); if (!ch) continue;
        const n = (i - ci * CH) + (j - cj * CH) * CH;
        if (ch.tall[n]) { if (ch.top[n] > terrH((i + 0.5) * CELL, (j + 0.5) * CELL) + LOW - 0.5) return Infinity; }
        const t = ch.top[n]; if (t > above && t > best) best = t;
      }
      return best;
    },
    get chunks() { return chunks.size; },
  };
  return S;
}
