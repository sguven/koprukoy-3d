// v1.12 the Toros's shadow without redrawing the whole shadow map every frame (Nov 2026).
//
// Before: while driving, the sun's shadow map was redrawn every frame, because the car casts a shadow and moves.
// That is a second render of everything within ~140 m of the car (about 400 draw calls and 650 k triangles, at 4096²
// on a desktop, 2048² on a phone) on top of the normal frame: driving cost ~2.5× the main-thread time of walking and
// the frame rate dropped and stuttered.
//
// Now the shadow map is split in two:
//   - the still world (village, trees, terrain, bridge …) is drawn by three.js's own shadow pass, as before, but only
//     when the shadow area has to move (the loop decides when, like on foot); the car is left out of it;
//   - right after that pass, still inside the same render, this module copies the map into a cache and draws the car
//     on top. On the frames in between it puts back only the small square of the cache where the car was and draws the
//     car where it is now (scissored to those few hundred texels).
// The map the main pass reads is the same as before (the car and everything else, at the same resolution), so the
// shadows look the same: the car's shadow on the ground, the roof shading the cabin, trees shading the car.
//
// The work happens in onBeforeRender of a tiny hidden mesh that is drawn first in the scene (the Reflector pattern),
// because three.js draws the shadow map at the start of renderer.render() and the car has to be in it before anything
// that receives shadows is drawn.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// v1.17: the walking character (src/avatar.js) is carried the same way: addActor() puts his skinned meshes in the
// proxy scene as depth-only skinned copies that share his skeleton, and his square is redrawn with the car's.

const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

export function createCarShadow({ renderer, scene, light, car }) {
  // ---- the car's shadow casters, taken out of three.js's own shadow pass and mirrored by depth-only proxies ----
  const proxyScene = new THREE.Scene(); proxyScene.matrixWorldAutoUpdate = false;
  const depthMats = new Map();
  const depthMat = (m) => {
    const side = m.shadowSide !== null && m.shadowSide !== undefined ? m.shadowSide : SHADOW_SIDE[m.side];
    const cut = m.map && m.alphaTest > 0, k = side + (cut ? '|' + m.uuid : '');
    let d = depthMats.get(k);
    if (!d) { d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side }); if (cut) { d.map = m.map; d.alphaTest = m.alphaTest; } depthMats.set(k, d); }
    return d;
  };
  // The casters are merged per rigid part and depth material, so the whole car is about a dozen draw calls in this
  // pass: a rigid part is a direct child of the car (a wheel's steering pivot, the roof rack, the nose …), or the car
  // itself for meshes that hang straight off it. A wheel's spin is left out (a round tyre's shadow does not change).
  const casters = [];   // [frame, proxy]
  car.updateMatrixWorld(true);
  const buckets = new Map(), _m = new THREE.Matrix4();
  car.traverse(o => {
    if (!o.isMesh || !o.castShadow) return;
    o.castShadow = false;
    let frame = o; while (frame.parent && frame.parent !== car) frame = frame.parent;
    if (frame === o || !frame.parent) frame = car;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material, dm = depthMat(mat);
    const k = frame.uuid + '|' + dm.uuid; let b = buckets.get(k); if (!b) buckets.set(k, b = { frame, dm, geos: [] });
    _m.copy(frame.matrixWorld).invert().multiply(o.matrixWorld);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', o.geometry.attributes.position.clone());
    if (dm.map) g.setAttribute('uv', o.geometry.attributes.uv.clone());
    if (o.geometry.index) g.setIndex(o.geometry.index.clone()); else g.setIndex([...Array(g.attributes.position.count).keys()]);
    g.applyMatrix4(_m);
    if (_m.determinant() < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } }
    b.geos.push(g);
  });
  for (const { frame, dm, geos } of buckets.values()) {
    const g = mergeGeometries(geos, false); geos.forEach(x => x.dispose()); if (!g) continue;
    g.computeBoundingSphere();
    const p = new THREE.Mesh(g, dm); p.matrixAutoUpdate = false; p.matrixWorldAutoUpdate = false; proxyScene.add(p);
    casters.push([frame, p]);
  }
  // the car's size for the scissor square (its bounding sphere, in the car's frame)
  const box = new THREE.Box3().setFromObject(car, true), sphere = new THREE.Sphere(); box.getBoundingSphere(sphere);
  const carInv = new THREE.Matrix4().copy(car.matrixWorld).invert(); const centreLocal = sphere.center.clone().applyMatrix4(carInv), radius = sphere.radius + 0.3;
  // everything that moves on top of the still world: the car, and the character once loaded ({ obj, centre, radius })
  // (only the active ones, the one being driven or walked, are redrawn between full passes: a parked car stays put)
  const movers = [{ obj: car, centre: centreLocal, radius, active: true }];

  // ---- full-screen copies: cache ← map (colour only) and map ← cache (colour and depth, so the car is depth-tested) ----
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const copyMat = (depth) => new THREE.ShaderMaterial({
    uniforms: { tMap: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `#include <packing>
      uniform sampler2D tMap; varying vec2 vUv;
      void main() { vec4 t = texture2D(tMap, vUv); gl_FragColor = t;${depth ? ' gl_FragDepth = unpackRGBAToDepth(t);' : ''} }`,
    depthTest: depth, depthWrite: depth, depthFunc: THREE.AlwaysDepth, blending: THREE.NoBlending, toneMapped: false,
  });
  const blitMat = copyMat(false), restoreMat = copyMat(true);
  const quad = new THREE.Mesh(tri, blitMat); quad.frustumCulled = false;
  const quadScene = new THREE.Scene(); quadScene.add(quad); quadScene.matrixWorldAutoUpdate = false;
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let cache = null;

  // ---- state ----
  let pending = null;     // what the next main render must do: 'full' (three.js just redrew the map) or 'move'
  let prev = null;        // the scissor square the car was drawn in last time (texels), or null
  let cacheOk = false;    // the cache holds the still world as the map has it now
  let keepCache = false;  // keep a cache at all (only while driving: elsewhere the car does not move)
  const rect = new THREE.Vector4(), uni = new THREE.Vector4(), _c = new THREE.Vector3(), _v = new THREE.Vector3();

  function syncProxies() {
    for (const [f, p] of casters) {
      let vis = f.visible; for (let a = f.parent; vis && a; a = a.parent) vis = a.visible;
      p.visible = vis; if (vis) { p.matrixWorld.copy(f.matrixWorld); if (p.isSkinnedMesh) p.bindMatrixInverse.copy(f.bindMatrixInverse); }   // (an attached skin's inverse follows its world matrix)
    }
  }
  /** The movers' square in the shadow map (texels, y up), from their bounding spheres seen by the light. */
  function carRect(map, cam) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const m of movers) {
      if (!m.active) continue;
      _c.copy(m.centre).applyMatrix4(m.obj.matrixWorld);
      _v.copy(_c).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
      const W = map.width, H = map.height, rx = m.radius / (cam.right - cam.left) * W, ry = m.radius / (cam.top - cam.bottom) * H;
      const x = (_v.x * 0.5 + 0.5) * W, y = (_v.y * 0.5 + 0.5) * H;
      x0 = Math.min(x0, Math.floor(x - rx) - 2); y0 = Math.min(y0, Math.floor(y - ry) - 2); x1 = Math.max(x1, Math.ceil(x + rx) + 2); y1 = Math.max(y1, Math.ceil(y + ry) + 2);
    }
    if (x0 === Infinity) return rect.set(0, 0, 0, 0);
    return rect.set(x0, y0, x1 - x0, y1 - y0);
  }
  function drawCar(map, cam, scissor) {
    syncProxies();
    if (scissor) { map.scissor.copy(scissor); map.scissorTest = true; }
    renderer.setRenderTarget(map); renderer.render(proxyScene, cam);
    map.scissorTest = false;
  }
  function blit(src, dst, mat, scissor) {
    mat.uniforms.tMap.value = src.texture; quad.material = mat;
    if (scissor) { dst.scissor.copy(scissor); dst.scissorTest = true; }
    renderer.setRenderTarget(dst); renderer.render(quadScene, quadCam);
    dst.scissorTest = false;
  }

  // ---- the hook: drawn first (renderOrder), invisible (no colour or depth writes, a zero-area triangle) ----
  const hookGeo = new THREE.BufferGeometry(); hookGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const hook = new THREE.Mesh(hookGeo, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
  hook.frustumCulled = false; hook.renderOrder = -1e9; hook.castShadow = false; hook.receiveShadow = false; hook.name = 'carShadowHook';
  hook.onBeforeRender = () => {
    const job = pending; pending = null;
    const map = light.shadow.map; if (!job || !map) return;
    const cam = light.shadow.camera, target = renderer.getRenderTarget(), ac = renderer.autoClear;
    renderer.autoClear = false;
    try {
      if (job === 'full') {
        // three.js has just drawn the still world: keep a copy of it, then add the car anywhere in the map
        if (keepCache) {
          if (!cache || cache.width !== map.width || cache.height !== map.height) {
            if (cache) cache.dispose();
            cache = new THREE.WebGLRenderTarget(map.width, map.height, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
          }
          blit(map, cache, blitMat, null); cacheOk = true;
        } else cacheOk = false;
        drawCar(map, cam, null);
        prev = carRect(map, cam).clone();
      } else if (job === 'move' && cacheOk) {
        // put back the still world where the car was and where it is now, then draw the car again
        const r = carRect(map, cam);
        if (prev) { const x0 = Math.min(prev.x, r.x), y0 = Math.min(prev.y, r.y); uni.set(x0, y0, Math.max(prev.x + prev.z, r.x + r.z) - x0, Math.max(prev.y + prev.w, r.y + r.w) - y0); }
        else uni.copy(r);
        // a jump (respawn after the water) can make the union huge: then it is simply a bigger copy
        uni.x = Math.max(0, uni.x); uni.y = Math.max(0, uni.y); uni.z = Math.min(map.width - uni.x, uni.z); uni.w = Math.min(map.height - uni.y, uni.w);
        if (uni.z > 0 && uni.w > 0) { blit(cache, map, restoreMat, uni); drawCar(map, cam, uni); }
        prev = r.clone();
      }
    } finally {
      renderer.autoClear = ac; renderer.setRenderTarget(target);
    }
  };
  scene.add(hook);

  return {
    /**
     * Call right before renderer.render(scene, camera), after the loop has decided whether the shadow map is redrawn
     * (light.shadow.needsUpdate). `driving`: the car moves, so it is redrawn on top of the cached map every frame.
     * `walking` (v1.17): the same for the character added with addActor().
     * Returns true when the frame redraws the still world (it may ask for that itself, when the cache is missing).
     */
    plan(driving, walking = false) {
      movers[0].active = driving; for (let i = 1; i < movers.length; i++) movers[i].active = walking;
      driving = driving || walking;
      keepCache = driving;
      if (driving && !cacheOk) light.shadow.needsUpdate = true;
      pending = light.shadow.needsUpdate ? 'full' : driving ? 'move' : null;
      return pending === 'full';
    },
    /** Compile the proxies' and copies' shaders now (called while "Loading…" is up). */
    warm() {
      // compiled for a render target, as they are used (a program for the screen would be a different one)
      const tmp = light.shadow.map ? null : new THREE.WebGLRenderTarget(4, 4), was = renderer.getRenderTarget();
      renderer.setRenderTarget(light.shadow.map || tmp);
      renderer.compile(proxyScene, light.shadow.camera);
      for (const m of [blitMat, restoreMat]) { quad.material = m; renderer.compile(quadScene, quadCam); }
      renderer.setRenderTarget(was); if (tmp) tmp.dispose();
    },
    get casters() { return casters.length; },
    /**
     * v1.17: an animated character that moves on top of the still world like the car. His skinned meshes leave
     * three.js's own shadow pass and are drawn here by depth-only copies that share his skeleton (the skeleton is
     * updated by the main render before this pass runs). `centre` / `radius`: his bounding sphere in his own frame.
     */
    addActor(obj, centre, r) {
      obj.updateMatrixWorld(true);
      obj.traverse(o => {
        if (!o.isSkinnedMesh || !o.castShadow) return;
        o.castShadow = false;
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        const p = new THREE.SkinnedMesh(o.geometry, depthMat(mat)); p.bindMode = o.bindMode; p.bind(o.skeleton, o.bindMatrix);
        p.matrixAutoUpdate = false; p.matrixWorldAutoUpdate = false; p.frustumCulled = false; proxyScene.add(p);
        casters.push([o, p]);
      });
      movers.push({ obj, centre: centre.clone(), radius: r, active: false });
      prev = null; cacheOk = false;
    },
  };
}
