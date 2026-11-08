// Google Maps–style navigation for the orbit view.
//
// Touch
//   1 finger drag ............ pan; the ground point under the finger stays under the finger
//   2 finger pinch ........... zoom towards the point between the fingers
//   2 finger twist ........... rotate around the point between the fingers
//   2 fingers up / down ...... tilt (fingers side by side, moving together vertically)
//   double tap ............... zoom in on that point
//   2 finger tap ............. zoom out
// Mouse
//   left drag ................ pan (anchored)
//   wheel .................... zoom towards the cursor
//   right drag / Ctrl·Shift + left drag ... rotate (horizontal) and tilt (vertical)
//   double click ............. zoom in on that point
//
// Drop-in for the subset of OrbitControls the page uses: .target, .enabled, .update(),
// 'start' / 'end' events.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

export class MapNav extends THREE.EventDispatcher {
  constructor(camera, dom) {
    super();
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3();
    this.enabled = true;
    this.minDistance = 8;           // camera ↔ ground point being zoomed into
    this.maxDistance = 2800;        // camera ↔ target
    this.minPolarAngle = 0.0005;    // straight down
    this.maxPolarAngle = Math.PI * 0.48;
    this.clearance = 2.5;           // metres the camera keeps above the ground
    this.heightAt = () => 0;        // (x, z, refY) → ground height; set by the page once data loads
    this.bounds = null;             // { x0, z0, x1, z1 } for the target

    this._ptrs = new Map();         // pointerId → { x, y, x0, y0, type }
    this._g = null;                 // current gesture
    this._vel = new THREE.Vector3();// pan inertia (m/s)
    this._samples = [];             // recent pan deltas for the release velocity
    this._last = performance.now();
    this._zoomAnim = null;
    this._tap = null;               // last single tap, for double-tap
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();

    this._down = this._down.bind(this); this._move = this._move.bind(this); this._up = this._up.bind(this);
    this._wheel = this._wheel.bind(this); this._dbl = this._dbl.bind(this);
    dom.addEventListener('pointerdown', this._down);
    dom.addEventListener('pointermove', this._move);
    dom.addEventListener('pointerup', this._up);
    dom.addEventListener('pointercancel', this._up);
    dom.addEventListener('lostpointercapture', this._up);
    dom.addEventListener('wheel', this._wheel, { passive: false });
    dom.addEventListener('dblclick', this._dbl);
    this._lastType = 'mouse';
    dom.addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
    dom.style.touchAction = 'none';
  }

  // ---------- geometry helpers ----------
  _sync() { this.camera.lookAt(this.target); this.camera.updateMatrixWorld(); }
  _rayAt(cx, cy) {
    const r = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this._ray.setFromCamera(ndc, this.camera);
    return this._ray.ray;
  }
  // first ground hit along a screen ray (terrain, roads and the bridge deck), or null for sky
  pick(cx, cy) {
    this._sync();
    const ray = this._rayAt(cx, cy), o = ray.origin, d = ray.direction;
    let t = 0, prev = 0; const MAX = 9000;
    const gap = s => { const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s; return y - this.heightAt(x, z, y); };
    let g = gap(0);
    if (g <= 0) return o.clone();
    while (t < MAX) {
      const drop = d.y < -1e-4 ? g / -d.y : Infinity;
      const step = Math.min(20, Math.max(0.4, drop * 0.5));
      prev = t; t += step;
      g = gap(t);
      if (g <= 0) {            // bisect the crossing
        let a = prev, b = t;
        for (let i = 0; i < 18; i++) { const m = (a + b) / 2; if (gap(m) > 0) a = m; else b = m; }
        return o.clone().addScaledVector(d, (a + b) / 2);
      }
    }
    return null;
  }
  // where a screen ray crosses the horizontal plane y = h (clamped so it never runs off to infinity)
  _onPlane(cx, cy, h, out) {
    this._sync();
    const ray = this._rayAt(cx, cy), o = ray.origin, d = ray.direction.clone();
    if (d.y > -0.02) { d.y = -0.02; d.normalize(); }
    let t = (h - o.y) / d.y;
    if (t < 0) t = 0;
    t = Math.min(t, 8000);
    return out.copy(o).addScaledVector(d, t);
  }
  // anchor for a gesture: ground under the finger, or a point on the target's level when pointing at the sky
  _anchor(cx, cy) {
    const p = this.pick(cx, cy);
    if (p && p.distanceTo(this.camera.position) < 8000) return p;
    return this._onPlane(cx, cy, this.target.y, new THREE.Vector3());
  }

  // ---------- primitive moves (all keep the anchor at the same screen position) ----------
  _translate(dx, dz) {
    this.camera.position.x += dx; this.camera.position.z += dz;
    this.target.x += dx; this.target.z += dz;
  }
  _zoomAbout(A, s) {
    const cam = this.camera.position;
    const dA = cam.distanceTo(A), dT = cam.distanceTo(this.target);
    if (s < 1) s = Math.max(s, this.minDistance / Math.max(dA, 1e-3));
    else s = Math.min(s, this.maxDistance / Math.max(dT, 1e-3));
    if (!isFinite(s) || s <= 0) return;
    cam.sub(A).multiplyScalar(s).add(A);
    this.target.sub(A).multiplyScalar(s).add(A);
  }
  _rotateAbout(A, ang) {
    for (const p of [this.camera.position, this.target]) {
      p.sub(A).applyAxisAngle(UP, ang).add(A);
    }
  }
  _tilt(dPhi) {
    const off = this._v.subVectors(this.camera.position, this.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.phi = THREE.MathUtils.clamp(sph.phi + dPhi, this.minPolarAngle, this.maxPolarAngle);
    off.setFromSpherical(sph);
    this.camera.position.copy(this.target).add(off);
  }
  _orbitYaw(ang) { this._rotateAbout(this.target, ang); }

  // put the rotation/tilt pivot back on the ground at the centre of the screen
  repin() {
    const r = this.dom.getBoundingClientRect();
    const p = this.pick(r.left + r.width / 2, r.top + r.height / 2);
    if (!p) return;
    const d = p.distanceTo(this.camera.position);
    if (d > 1 && d < this.maxDistance) this.target.copy(p);
  }

  // ---------- pointer handling ----------
  _down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button > 2) return;
    this._lastType = e.pointerType;
    try { this.dom.setPointerCapture(e.pointerId); } catch (_) {}
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now(), type: e.pointerType });
    this._vel.set(0, 0, 0); this._zoomAnim = null;
    if (this._ptrs.size === 1) this.dispatchEvent({ type: 'start' });
    if (e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey || e.metaKey)) this._g = { kind: 'orbit' };
    else this._begin();
  }
  _begin() {
    const P = [...this._ptrs.values()];
    this._samples.length = 0;
    if (P.length === 1) {
      const A = this._anchor(P[0].x, P[0].y);
      this._g = { kind: 'pan', A, moved: 0 };
    } else if (P.length >= 2) {
      const [a, b] = P;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this._g = {
        kind: 'two', mode: null, A: this._anchor(mx, my),
        dist: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x), my,
        start: P.slice(0, 2).map(p => ({ x: p.x, y: p.y })), rotOn: false, rotAcc: 0, t0: performance.now(), moved: 0,
      };
    }
  }
  _move(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p || !this.enabled) return;
    const px = p.x, py = p.y;
    p.x = e.clientX; p.y = e.clientY;
    const g = this._g; if (!g) return;
    const H = this.dom.clientHeight || innerHeight, W = this.dom.clientWidth || innerWidth;

    if (g.kind === 'orbit') {
      const dx = p.x - px, dy = p.y - py;
      this._orbitYaw(-dx / W * Math.PI * 1.4);
      this._tilt(-dy / H * Math.PI * 0.9);
      this._sync(); return;
    }
    if (g.kind === 'pan') {
      g.moved += Math.hypot(p.x - px, p.y - py);
      const hit = this._onPlane(p.x, p.y, g.A.y, this._w);
      const dx = g.A.x - hit.x, dz = g.A.z - hit.z;
      this._translate(dx, dz); this._sync();
      this._samples.push({ t: performance.now(), dx, dz });
      if (this._samples.length > 12) this._samples.shift();
      return;
    }
    if (g.kind === 'two') {
      const P = [...this._ptrs.values()]; if (P.length < 2) return;
      const [a, b] = P;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const dist = Math.hypot(b.x - a.x, b.y - a.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
      g.moved = Math.max(g.moved, Math.hypot(a.x - g.start[0].x, a.y - g.start[0].y), Math.hypot(b.x - g.start[1].x, b.y - g.start[1].y));

      if (!g.mode) {            // decide once: tilt, or pinch/rotate/pan
        const va = { x: a.x - g.start[0].x, y: a.y - g.start[0].y }, vb = { x: b.x - g.start[1].x, y: b.y - g.start[1].y };
        const la = Math.hypot(va.x, va.y), lb = Math.hypot(vb.x, vb.y);
        if (Math.max(la, lb) < 14) { g.dist = dist; g.ang = ang; g.my = my; return; }
        const sideBySide = Math.abs(Math.sin(ang)) < 0.6;                 // fingers roughly horizontal
        const vertical = Math.abs(va.y) > 1.6 * Math.abs(va.x) && Math.abs(vb.y) > 1.6 * Math.abs(vb.x);
        const together = va.y * vb.y > 0 && Math.min(Math.abs(va.y), Math.abs(vb.y)) > 0.3 * Math.max(Math.abs(va.y), Math.abs(vb.y));
        g.mode = sideBySide && vertical && together ? 'tilt' : 'pinch';
        g.A = this._anchor(mx, my);   // re-anchor where the fingers are now
        g.dist = dist; g.ang = ang; g.my = my;
        return;
      }
      if (g.mode === 'tilt') {
        this._tilt(-(my - g.my) / H * Math.PI * 0.9);
        g.my = my; this._sync(); return;
      }
      // pinch: pan so the anchor follows the midpoint, then rotate and zoom about it
      const hit = this._onPlane(mx, my, g.A.y, this._w);
      this._translate(g.A.x - hit.x, g.A.z - hit.z);
      let dAng = ang - g.ang; if (dAng > Math.PI) dAng -= 2 * Math.PI; if (dAng < -Math.PI) dAng += 2 * Math.PI;
      // ~11° of twist before rotation engages (so a plain pinch doesn't spin the map), then catch up smoothly
      if (!g.rotOn) { g.rotAcc += dAng; if (Math.abs(g.rotAcc) > 0.2) { g.rotOn = true; g.debt = g.rotAcc - dAng; } }
      if (g.rotOn) { const c = g.debt * 0.25; g.debt -= c; this._rotateAbout(g.A, dAng + c); }
      if (g.dist > 0 && dist > 0) this._zoomAbout(g.A, g.dist / dist);
      g.dist = dist; g.ang = ang; g.my = my;
      this._sync();
    }
  }
  _up(e) {
    const p = this._ptrs.get(e.pointerId);
    if (!p) return;
    const g = this._g, now = performance.now();
    // taps
    if (g && g.kind === 'two' && g.moved < 10 && now - g.t0 < 300 && this._ptrs.size === 2) {
      this._zoomTo(g.A, 2, 300); g.done = true;           // two-finger tap → zoom out
    }
    if (g && g.kind === 'pan' && g.moved < 8 && now - p.t0 < 300 && p.type !== 'mouse') {
      if (this._tap && now - this._tap.t < 320 && Math.hypot(p.x - this._tap.x, p.y - this._tap.y) < 30) {
        this._zoomTo(g.A, 0.5, 300); this._tap = null;    // double tap → zoom in
      } else this._tap = { t: now, x: p.x, y: p.y };
    }
    // fling
    if (g && g.kind === 'pan' && this._ptrs.size === 1) {
      const S = this._samples.filter(s => now - s.t < 90);
      if (S.length >= 2 && now - S[S.length - 1].t < 40) {
        const span = Math.max(16, now - S[0].t) / 1000;
        let dx = 0, dz = 0; for (const s of S) { dx += s.dx; dz += s.dz; }
        this._vel.set(dx / span, 0, dz / span);
        const lim = this.camera.position.distanceTo(this.target) * 1.5;   // cap by zoom level
        if (this._vel.length() > lim) this._vel.setLength(lim);
      }
    }
    this._ptrs.delete(e.pointerId);
    try { this.dom.releasePointerCapture(e.pointerId); } catch (_) {}
    if (this._ptrs.size === 0) {
      this._g = null;
      if (this._vel.lengthSq() < 1) this.repin();
      this.dispatchEvent({ type: 'end' });
    } else if (!(g && g.done)) this._begin();                 // 2 → 1 finger: keep panning from the remaining finger
    else this._g = null;
  }
  _wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    this._vel.set(0, 0, 0); this._zoomAnim = null;
    const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    if (e.ctrlKey) { this._zoomAbout(this._anchor(e.clientX, e.clientY), Math.exp(dy * 0.01)); }   // trackpad pinch
    else this._zoomAbout(this._anchor(e.clientX, e.clientY), Math.exp(THREE.MathUtils.clamp(dy, -200, 200) * 0.0018));
    this._sync();
    this.dispatchEvent({ type: 'start' }); clearTimeout(this._wt);
    this._wt = setTimeout(() => { this.repin(); this.dispatchEvent({ type: 'end' }); }, 200);
  }
  _dbl(e) {
    if (!this.enabled || this._lastType !== 'mouse') return;   // touch double-tap is handled in _up
    this._zoomTo(this._anchor(e.clientX, e.clientY), e.shiftKey ? 2 : 0.5, 300);
  }
  _zoomTo(A, s, ms) { this._zoomAnim = { A: A.clone(), s, t0: performance.now(), ms, k: 0 }; this.dispatchEvent({ type: 'start' }); }

  // ---------- per frame ----------
  update() {
    const now = performance.now(), dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    if (this.enabled && !this._g) {
      if (this._vel.lengthSq() > 0.25) {
        this._translate(this._vel.x * dt, this._vel.z * dt);
        this._vel.multiplyScalar(Math.exp(-dt / 0.25));
        if (this._vel.lengthSq() <= 0.25) { this._vel.set(0, 0, 0); this.repin(); }
      }
      const z = this._zoomAnim;
      if (z) {
        const k = Math.min(1, (now - z.t0) / z.ms), e = 1 - Math.pow(1 - k, 3);
        // apply the increment of a geometric zoom so the total is exactly s
        const step = Math.pow(z.s, e - z.k); z.k = e;
        this._zoomAbout(z.A, step);
        if (k >= 1) { this._zoomAnim = null; this.repin(); this.dispatchEvent({ type: 'end' }); }
      }
    }
    // limits
    const b = this.bounds;
    if (b) {
      const cx = THREE.MathUtils.clamp(this.target.x, b.x0, b.x1) - this.target.x, cz = THREE.MathUtils.clamp(this.target.z, b.z0, b.z1) - this.target.z;
      if (cx || cz) { this._translate(cx, cz); this._vel.set(0, 0, 0); }
    }
    const off = this._v.subVectors(this.camera.position, this.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    const phi = THREE.MathUtils.clamp(sph.phi, this.minPolarAngle, this.maxPolarAngle);
    const r = Math.min(sph.radius, this.maxDistance);
    if (phi !== sph.phi || r !== sph.radius) { sph.phi = phi; sph.radius = r; off.setFromSpherical(sph); this.camera.position.copy(this.target).add(off); }
    const cam = this.camera.position, floor = this.heightAt(cam.x, cam.z, cam.y) + this.clearance;
    if (cam.y < floor) cam.y = floor;
    this._sync();
  }

  dispose() {
    const d = this.dom;
    d.removeEventListener('pointerdown', this._down); d.removeEventListener('pointermove', this._move);
    d.removeEventListener('pointerup', this._up); d.removeEventListener('pointercancel', this._up);
    d.removeEventListener('lostpointercapture', this._up); d.removeEventListener('wheel', this._wheel); d.removeEventListener('dblclick', this._dbl);
  }
}
