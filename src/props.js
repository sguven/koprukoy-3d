// Street furniture and vegetation for the rebuilt village: simple but recognisable tree models
// (poplar, mulberry, fruit trees, pines), concrete utility poles with sagging cables, wire fences,
// benches, litter bins, a picnic table and stone piles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, cyl } from './geo.js';

function hash(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

/** Canopy volume: a sphere scaled to (rx, ry, rz) with noisy vertices and a per-vertex tint. */
function canopy(rx, ry, rz, cx, cy, cz, color, seed) {
  const g = new THREE.SphereGeometry(1, 12, 9), p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), c = new THREE.Color(color);
  for (let i = 0; i < n; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.82 + 0.36 * hash(x * 3.1 + seed, y * 2.7 + z * 1.9 + seed);
    p.setXYZ(i, cx + x * rx * k, cy + y * ry * (0.9 + 0.2 * k), cz + z * rz * k);
    const t = 0.8 + 0.4 * hash(i + seed, seed), shade = 0.75 + 0.35 * (y + 1) / 2;   // lighter on top
    col[i * 3] = c.r * t * shade; col[i * 3 + 1] = c.g * t * shade; col[i * 3 + 2] = c.b * t * shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}
function cone(r, h, cx, cy, cz, color, seed) {
  const g = new THREE.ConeGeometry(r, h, 10, 2); g.translate(cx, cy, cz);
  const p = g.attributes.position, n = p.count, col = new Float32Array(n * 3), c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { const t = 0.8 + 0.4 * hash(i + seed, seed * 2); col[i * 3] = c.r * t; col[i * 3 + 1] = c.g * t; col[i * 3 + 2] = c.b * t; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); return g;
}

/**
 * props: [{kind, x, z, yaw, prev, species, size, ...}], trees: [{x, z, species, size}], wires: flat xyz pairs.
 * Street furniture is added to the shared GeoBatch `bat`; trees and wires become their own meshes.
 */
export function buildProps(ctx, M, { props, trees, wires }, bat) {
  const { terrH } = ctx;
  const canopies = [], trunks = [];
  const meshes = [];
  for (const p of props) if (p.kind === 'tree') trees.push({ ...p, force: true });
  props = props.filter(p => p.kind !== 'tree');

  // ---- trees ----
  for (const t of trees) {
    const y = terrH(t.x, t.z), s = t.size || 1, seed = Math.floor(hash(t.x, t.z) * 1000);
    switch (t.species) {
      case 'poplar': {
        const h = 11 * s; trunks.push(cyl(0.14 * s, 0.26 * s, h * 0.55, t.x, y + h * 0.275, t.z, 7));
        canopies.push(canopy(1.5 * s, h * 0.42, 1.5 * s, t.x, y + 2.2 * s + h * 0.42, t.z, 0x7d9b3a, seed));
        break;
      }
      case 'mulberry': {
        trunks.push(cyl(0.22 * s, 0.34 * s, 2.6 * s, t.x, y + 1.3 * s, t.z, 7));
        canopies.push(canopy(3.6 * s, 2.5 * s, 3.4 * s, t.x, y + 2.4 * s + 2.2 * s, t.z, 0x4e7a2b, seed));
        break;
      }
      case 'pine': {
        trunks.push(cyl(0.16 * s, 0.3 * s, 4.0 * s, t.x, y + 2.0 * s, t.z, 7));
        canopies.push(cone(2.4 * s, 5.5 * s, t.x, y + 3.6 * s + 2.75 * s, t.z, 0x2d5a2a, seed));
        canopies.push(cone(1.7 * s, 4.5 * s, t.x, y + 6.8 * s + 2.25 * s, t.z, 0x2f5f2c, seed + 1));
        break;
      }
      default: { // small fruit tree (apricot, plum)
        trunks.push(cyl(0.1 * s, 0.17 * s, 1.9 * s, t.x, y + 0.95 * s, t.z, 6));
        canopies.push(canopy(2.2 * s, 1.9 * s, 2.1 * s, t.x, y + 1.8 * s + 1.6 * s, t.z, 0x6a8f3a, seed));
      }
    }
  }
  if (canopies.length) {
    const g = mergeGeometries(canopies, false); const m = new THREE.Mesh(g, ctx.canopy.material); m.customDepthMaterial = ctx.canopy.depth; m.customDistanceMaterial = ctx.canopy.distance;
    m.castShadow = m.receiveShadow = true; m.name = 'Koy_Agac_Yaprak'; meshes.push(m);
    const tg = mergeGeometries(trunks, false); const tm = new THREE.Mesh(tg, ctx.trunkMat); tm.castShadow = tm.receiveShadow = true; tm.name = 'Koy_Agac_Govde'; meshes.push(tm);
  }

  // ---- street furniture into the shared batch ----
  const W = wires;
  const sag = (p, q, k) => { // catenary-ish cable between two points in world space, k segments
    for (let i = 0; i < k; i++) { const t0 = i / k, t1 = (i + 1) / k; const f = (t) => 4 * t * (1 - t); W.push(p.x + (q.x - p.x) * t0, p.y + (q.y - p.y) * t0 - 0.55 * f(t0), p.z + (q.z - p.z) * t0, p.x + (q.x - p.x) * t1, p.y + (q.y - p.y) * t1 - 0.55 * f(t1), p.z + (q.z - p.z) * t1); }
  };
  for (const p of props) {
    const y = terrH(p.x, p.z), fr = { x: p.x, y, z: p.z, yaw: p.yaw || 0 };
    switch (p.kind) {
      case 'pole': {
        bat.add('pole', cyl(0.1, 0.17, 9.0, 0, 4.5 - 0.4, 0, 8), fr);
        bat.add('metalDark', box(1.3, 0.08, 0.08, 0, 8.3, 0), fr);
        for (const sx of [-0.6, 0, 0.6]) bat.add('metal', cyl(0.05, 0.05, 0.18, sx, 8.42, 0, 6), fr);
        if (p.prev) {
          const yp = terrH(p.prev.x, p.prev.z);
          const dx = p.x - p.prev.x, dz = p.z - p.prev.z, L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
          for (const sx of [-0.6, 0, 0.6]) sag(new THREE.Vector3(p.prev.x + nx * sx, yp + 8.5, p.prev.z + nz * sx), new THREE.Vector3(p.x + nx * sx, y + 8.5, p.z + nz * sx), 8);
        }
        break;
      }
      case 'bench': {
        for (const sx of [-0.8, 0.8]) { bat.add('beton', box(0.08, 0.42, 0.45, sx, 0.21, 0), fr); bat.add('beton', box(0.08, 0.5, 0.1, sx, 0.65, -0.2), fr); }
        for (const z of [-0.15, 0.0, 0.15]) bat.add('woodRaw', box(1.8, 0.04, 0.12, 0, 0.44, z), fr);
        for (const yy of [0.62, 0.78]) bat.add('woodRaw', box(1.8, 0.1, 0.04, 0, yy, -0.22), fr);
        break;
      }
      case 'bin': {
        bat.add('metalDark', cyl(0.03, 0.03, 0.9, 0, 0.45, 0, 6), fr);
        bat.add('orange', cyl(0.24, 0.2, 0.55, 0, 0.9, 0.22, 10), fr);
        break;
      }
      case 'picnic': {
        bat.add('woodRaw', box(1.8, 0.05, 0.75, 0, 0.74, 0), fr);
        for (const z of [-0.75, 0.75]) bat.add('woodRaw', box(1.8, 0.05, 0.3, 0, 0.45, z), fr);
        for (const sx of [-0.7, 0.7]) { const leg = box(0.06, 0.74, 1.9, sx, 0.37, 0); bat.add('woodRaw', leg, fr); bat.add('woodRaw', box(0.06, 0.05, 0.7, sx, 0.71, 0), fr); }
        break;
      }
      case 'stones': {
        for (let i = 0; i < 7; i++) { const r = 0.25 + 0.3 * hash(i, p.x), g = new THREE.IcosahedronGeometry(r, 1); g.scale(1, 0.7, 1); g.translate((hash(i * 3, p.z) - 0.5) * 1.6, r * 0.5, (hash(i * 7, p.x) - 0.5) * 1.6); bat.add('rock', g, fr); }
        break;
      }
    }
  }
  let wireMesh = null;
  if (W.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(W, 3));
    wireMesh = new THREE.LineSegments(g, M.wire); wireMesh.name = 'Koy_Teller'; wireMesh.frustumCulled = false;
  }
  return { meshes, wireMesh };
}
