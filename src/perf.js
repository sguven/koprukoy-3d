// v1.0 performance helpers (Nov 2026).
//
// Terrain, rocks, forest, the old buildings and the rebuilt village were merged per material into map-wide meshes:
// few draw calls, but every mesh spans the whole map, so the renderer could never skip what is behind or far from
// the camera (1.8 M triangles drawn every frame even at street level, plus 1.1 M again into the shadow map). Now
// big batches are merged per material AND per square cell of the map (cellSizeFor / splitMeshByCell), so frustum
// culling works; small details are hidden by distance (DistanceCuller); the FPS meter adapts the resolution.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PERF = {
  cell: 350,            // metres: default merge cell (village trees)
  quality: 2,           // 0 lite, 1 phone, 2 desktop (set by index.html before the scene is built)
};

/** Cell id of a world position. */
export const cellOf = (x, z, size = PERF.cell) => `${Math.floor(x / size)}_${Math.floor(z / size)}`;

const _box = new THREE.Box3(), _c = new THREE.Vector3();
/** Cell id of a geometry (centre of its bounding box, world space). */
export function cellOfGeometry(g, size = PERF.cell) {
  if (!g.boundingBox) g.computeBoundingBox();
  _box.copy(g.boundingBox).getCenter(_c);
  return cellOf(_c.x, _c.z, size);
}

/**
 * Merge-cell size for a batch of `tris` triangles: big batches are cut finely (culling pays), small ones coarsely or
 * not at all (every piece is a draw call, and a few hundred triangles cost less to draw than to skip).
 */
export function cellSizeFor(tris) { return tris > 60000 ? 250 : tris > 15000 ? 500 : Infinity; }

/** Merge geometries per map cell: returns [cell, mergedGeometry][]. size = Infinity merges everything into one. */
export function mergeByCell(geos, size = PERF.cell) {
  const buckets = new Map();
  for (const g of geos) { const k = isFinite(size) ? cellOfGeometry(g, size) : 'all'; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(g); }
  const out = [];
  for (const [k, gs] of buckets) { const m = mergeGeometries(gs, false); if (m) { m.computeBoundingSphere(); out.push([k, m]); } }
  return out;
}

/**
 * Split one big mesh into per-cell meshes (each triangle goes to the cell of its world-space centroid), so the
 * renderer can skip the parts outside the view. The mesh is replaced in its parent by a Group of the same name
 * holding the pieces; material, shadow flags, render order and custom depth materials are kept. Returns the
 * Group, or the mesh itself when it fits in one cell (or cannot be split).
 */
export function splitMeshByCell(mesh, size = PERF.cell) {
  if (!mesh || !mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material) || !mesh.parent) return mesh;
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return mesh;
  mesh.updateMatrixWorld(true);
  const nTri = (idx ? idx.count : pos.count) / 3, vi = idx ? (k) => idx.getX(k) : (k) => k;
  const v = new THREE.Vector3(), buckets = new Map();
  for (let t = 0; t < nTri; t++) {
    let cx = 0, cz = 0;
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, vi(t * 3 + k)).applyMatrix4(mesh.matrixWorld); cx += v.x; cz += v.z; }
    const key = cellOf(cx / 3, cz / 3, size); let b = buckets.get(key); if (!b) buckets.set(key, b = []); b.push(t);
  }
  if (buckets.size <= 1) return mesh;
  const group = new THREE.Group(); group.name = mesh.name; group.userData = mesh.userData;
  group.position.copy(mesh.position); group.quaternion.copy(mesh.quaternion); group.scale.copy(mesh.scale); group.visible = mesh.visible;
  const remap = new Int32Array(pos.count).fill(-1), names = Object.keys(g.attributes);
  for (const tris of buckets.values()) {
    const used = [];
    const index = new Uint32Array(tris.length * 3);
    for (let i = 0; i < tris.length; i++) for (let k = 0; k < 3; k++) {
      const o = vi(tris[i] * 3 + k); if (remap[o] < 0) { remap[o] = used.length; used.push(o); } index[i * 3 + k] = remap[o];
    }
    const ng = new THREE.BufferGeometry();
    for (const n of names) {
      const a = g.attributes[n], is = a.itemSize, Arr = (a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor;
      const arr = new Arr(used.length * is), na = new THREE.BufferAttribute(arr, is, a.normalized);
      for (let j = 0; j < used.length; j++) for (let c = 0; c < is; c++) na.setComponent(j, c, a.getComponent(used[j], c));
      ng.setAttribute(n, na);
    }
    ng.setIndex(new THREE.BufferAttribute(used.length > 65535 ? index : Uint16Array.from(index), 1));
    for (const o of used) remap[o] = -1;
    ng.computeBoundingSphere(); ng.computeBoundingBox();
    const part = new THREE.Mesh(ng, mesh.material);
    part.name = mesh.name; part.castShadow = mesh.castShadow; part.receiveShadow = mesh.receiveShadow; part.renderOrder = mesh.renderOrder;
    part.customDepthMaterial = mesh.customDepthMaterial; part.customDistanceMaterial = mesh.customDistanceMaterial;
    group.add(part);
  }
  const parent = mesh.parent; parent.add(group); parent.remove(mesh); g.dispose();
  return group;
}

/**
 * Split an InstancedMesh into per-cell InstancedMeshes (instances bucketed by position) with bounding spheres,
 * so frustum culling (main and shadow pass) works on them. Returns the new meshes.
 */
export function splitInstancedByCell(mesh, size) {
  const n = mesh.count, buckets = new Map(), m4 = new THREE.Matrix4(), p = new THREE.Vector3();
  for (let i = 0; i < n; i++) { mesh.getMatrixAt(i, m4); p.setFromMatrixPosition(m4); const k = cellOf(p.x, p.z, size); let b = buckets.get(k); if (!b) buckets.set(k, b = []); b.push(i); }
  const out = [], col = new THREE.Color();
  for (const ids of buckets.values()) {
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, ids.length);
    ids.forEach((src, j) => { mesh.getMatrixAt(src, m4); im.setMatrixAt(j, m4); if (mesh.instanceColor) { mesh.getColorAt(src, col); im.setColorAt(j, col); } });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();   // instance-aware sphere (InstancedMesh.computeBoundingSphere covers every instance)
    // the cards sway a few cm in the vertex shader: pad the sphere so nothing pops at the frustum edge
    im.boundingSphere.radius += 2;
    im.name = mesh.name; im.castShadow = mesh.castShadow; im.receiveShadow = mesh.receiveShadow; im.frustumCulled = true;
    out.push(im);
  }
  return out;
}

// --------------------------------------------------------------------------------------------- distance culling
// Small pieces (window trims, railings, steps, pipes, signs, garden furniture, cables ...) are a third of the
// village's triangles but a few pixels each beyond ~200 m. Material keys of the procedural village (village.js).
const DETAIL = /^(trim|metal|metalDark|railing|railBlue|step|garden|glass|chimney|lead|greenPaint|whitePlastic|redPlastic|woodRaw|wood|vine|grape|orange|bronze|door|pole|pvc|pilaster|coping|tableGrey|mudBase|flag|flagTR|yellowTank|canvas|voidDark|navy|sign\w*|plaque|kerb\w*|lines|plinth)$/;
/** Maximum view distance (m) for a village material key, or Infinity. */
export function viewDistance(key, quality = PERF.quality) {
  if (DETAIL.test(key)) return quality >= 2 ? 260 : 170;
  return Infinity;
}

/**
 * Hides registered meshes beyond their max distance (and keeps layer toggles: a mesh whose layer checkbox is off
 * carries userData.layerOff and stays hidden). Hidden meshes are skipped by the main pass and the shadow pass.
 */
export class DistanceCuller {
  constructor() { this.items = []; this.last = new THREE.Vector3(1e9, 0, 0); this.scale = 1; }
  add(obj, maxDist) {
    if (!isFinite(maxDist)) return;
    obj.updateMatrixWorld(true);
    // an InstancedMesh's own bounding sphere covers its instances; the geometry's is one card at the origin
    const bs = obj.isInstancedMesh ? (obj.boundingSphere || (obj.computeBoundingSphere(), obj.boundingSphere)) : (obj.geometry.boundingSphere || (obj.geometry.computeBoundingSphere(), obj.geometry.boundingSphere));
    const c = bs.center.clone().applyMatrix4(obj.matrixWorld);
    this.items.push({ obj, c, r: bs.radius, d: maxDist });
  }
  /** Returns true when visibility changed (the shadow map then needs a refresh). */
  update(camPos, force = false) {
    if (!force && camPos.distanceToSquared(this.last) < 16) return false;   // re-check after 4 m of movement
    this.last.copy(camPos); let changed = false;
    for (const it of this.items) {
      const v = !it.obj.userData.layerOff && camPos.distanceTo(it.c) - it.r < it.d * this.scale;
      if (it.obj.visible !== v) { it.obj.visible = v; changed = true; }
    }
    return changed;
  }
}

// --------------------------------------------------------------------------------------------- FPS meter + auto resolution
/**
 * Frame-time meter shown in the corner (FPS, frame time, draw calls, triangles) and an automatic resolution: when
 * frames take too long for a couple of seconds the render resolution steps down (to 55 % of the base at most) if that
 * helps; when there is headroom it steps back up. `base()` returns the wanted pixel ratio for the current mode.
 * v1.1: the meter also shows the 95th-percentile frame time of the last second (one frame in twenty was slower:
 * the stutter an average hides) and how many times the shadow map was redrawn in that second (shadowRedrawn()).
 */
export function createPerfMeter(renderer, el, base) {
  let frames = 0, acc = 0, t0 = performance.now(), slow = 0, fast = 0, scale = 1, shown = true, auto = true, lastPR = 0, probe = null, hold = 0, shadows = 0;
  const times = new Float32Array(512);
  const apply = () => { const pr = Math.max(0.5, base() * scale); if (Math.abs(pr - lastPR) > 0.01) { lastPR = pr; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); } };
  apply();
  return {
    get scale() { return scale; },
    set visible(v) { shown = v; el.style.display = v ? '' : 'none'; },
    get visible() { return shown; },
    set auto(v) { auto = v; if (!v) { scale = 1; slow = fast = 0; probe = null; apply(); } },
    get auto() { return auto; },
    /** Back to full resolution (after a mode change or a resize). */
    reset() { scale = 1; slow = fast = 0; probe = null; hold = 0; lastPR = 0; apply(); },
    /** Call when the frame about to be drawn redraws the shadow map. */
    shadowRedrawn() { shadows++; },
    frame(now, dt) {
      if (frames < times.length) times[frames] = dt;
      frames++; acc += dt;
      if (now - t0 < 1000) return;
      const fps = frames * 1000 / (now - t0), ms = acc / frames * 1000, nT = Math.min(frames, times.length), sh = shadows;
      const p95 = shown ? times.subarray(0, nT).sort()[Math.min(nT - 1, Math.floor(nT * 0.95))] * 1000 : 0;
      frames = 0; acc = 0; t0 = now; shadows = 0;
      // auto resolution: 2 s under ~40 fps → step down; 4 s over ~57 fps → step back up. If a step down did not
      // raise the frame rate, the limit is not the pixel count (e.g. a browser capped at 30 fps in power-saving
      // mode): undo it and leave the resolution alone for 30 s.
      if (auto && now >= hold) {
        if (probe && now - probe.t > 2500) { if (fps < probe.fps + 3) { scale = probe.scale; apply(); hold = now + 30000; } probe = null; slow = fast = 0; }
        else if (!probe) {
          if (fps < 40) { slow++; fast = 0; } else if (fps > 57) { fast++; slow = 0; } else { slow = fast = 0; }
          if (slow >= 2 && scale > 0.55) { probe = { t: now, fps, scale }; scale = Math.max(0.55, scale - 0.15); slow = 0; apply(); }
          if (fast >= 4 && scale < 1) { scale = Math.min(1, scale + 0.15); fast = 0; apply(); }
        }
      }
      if (shown) {
        const i = renderer.info.render;
        el.textContent = `${Math.round(fps)} FPS · ${ms.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · ${i.calls} draws · ${(i.triangles / 1e6).toFixed(2)} M tris · shadow ${sh}/s · res ${Math.round(scale * 100)}%`;
      }
    },
  };
}
