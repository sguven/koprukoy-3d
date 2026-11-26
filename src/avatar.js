// v1.17 Walk in third person (Nov 2026): a villager you steer through the village, seen from behind and above.
//
// The character is model/character/villager.glb, built by tools/build_character.mjs from Quaternius's CC0 kits
// (Universal Base Characters: the regular male head, parted hair and moustache; Modular Character Outfits: the
// peasant shirt, trousers and boots; Universal Animation Library: idle, walk, jog, sprint and jump, motion-captured
// style clips on the same 65-bone skeleton). See model/character/LICENSE.md.
//
// Controls (GTA-style): the mouse (or a drag on a phone) turns the camera around the character, W/A/S/D (or the
// joystick) move him relative to the camera and he turns to face where he walks. Shift runs, Ctrl+Shift sprints,
// Space jumps, the wheel brings the camera closer or further out; V switches to the old first-person view and back.
//
// Ground and collisions are the ones the first-person walk uses (index.html): surfaceInto() for the ground (terrain,
// roads, the bridge deck, the çarşı square; no walking into the lake) and pushOut() against every building footprint.
// The camera is kept out of the buildings and above the ground too, so it never looks through a wall.
//
// Locomotion is blended by speed: idle ↔ walk ↔ jog ↔ sprint share one stride phase and the phase advances with the
// distance actually covered (stride lengths measured on the clips), so the feet do not slide at any speed.
import * as THREE from 'three';

// stride per full cycle (two steps), measured on the clips: foot travel during stance / duty factor (walk 1.05 m/s
// over 1.333 s, jog ~4.0 m/s over 0.933 s, sprint ~7.0 m/s over 0.667 s)
const GAIT = [
  { clip: 'Walk_Loop', v: 1.05, stride: 1.40 },
  { clip: 'Jog_Fwd_Loop', v: 4.0, stride: 3.73 },
  { clip: 'Sprint_Loop', v: 7.0, stride: 4.67 },
];
export const SPEED = { walk: 1.55, run: 4.6, sprint: 7.0 };
const CAM = { minD: 1.6, maxD: 16, d: 5.2, minPitch: -1.25, maxPitch: 0.32, pitch: -0.32, height: 1.55 };
const R_BODY = 0.32;   // collision radius of the body (m)

export function createAvatar({ scene, camera, P, surfaceInto, pushOut, terrH, kd, touchIn, loader, url }) {
  const root = new THREE.Group(); root.name = 'avatar'; root.visible = false; scene.add(root);
  let model = null, mixer = null, loco = [], idle = null, air = null, ready = false, loading = null;
  const S = { x: 0, y: 0, z: 0, vy: 0, yaw: 0, speed: 0, vx: 0, vz: 0, phase: 0, airW: 0, yDraw: null, ground: true };
  const cam = { d: CAM.d, dNow: CAM.d, tx: 0, ty: 0, tz: 0, init: false };
  const g = { y: 0, road: false, water: false }, q = { x: 0, z: 0 };

  function load() {
    if (loading) return loading;
    loading = loader.loadAsync(url).then(gl => {
      model = gl.scene;
      model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
        const m = o.material; if (!m) return;
        m.envMapIntensity = 0.5;
        // the kit's hair texture is light grey; tinted, it is a dark brown with grey in it, moustache included
        if (/Hair/i.test(m.name)) m.color.setHex(0x4a3a30);
      });
      root.add(model);
      mixer = new THREE.AnimationMixer(model);
      const clip = n => gl.animations.find(a => a.name === n);
      idle = mixer.clipAction(clip('Idle_Loop')); idle.play();
      loco = GAIT.map(gt => { const a = mixer.clipAction(clip(gt.clip)); a.play(); a.timeScale = 0; a.setEffectiveWeight(0); return { ...gt, a, T: a.getClip().duration }; });
      air = mixer.clipAction(clip('Jump_Loop')); air.play(); air.setEffectiveWeight(0);
      ready = true; place(); return root;
    });
    return loading;
  }

  /** Put the character at P (feet), facing along P.yaw, and the camera behind him. */
  function spawn() {
    S.x = P.x; S.z = P.z; S.y = P.y; S.vy = 0; S.speed = 0; S.vx = S.vz = 0; S.yaw = P.yaw + Math.PI; S.yDraw = null;
    P.pitch = CAM.pitch; cam.init = false; place();
  }

  // ---- movement (one physics sub-step) ----
  function step(dt) {
    const sprint = kd('ControlLeft', 'ControlRight') && kd('ShiftLeft', 'ShiftRight');
    const run = kd('ShiftLeft', 'ShiftRight') || touchIn.jx * touchIn.jx + touchIn.jy * touchIn.jy > 0.92 * 0.92;
    let f = (kd('KeyW', 'ArrowUp') ? 1 : 0) - (kd('KeyS', 'ArrowDown') ? 1 : 0) - touchIn.jy;
    let r = (kd('KeyD', 'ArrowRight') ? 1 : 0) - (kd('KeyA', 'ArrowLeft') ? 1 : 0) + touchIn.jx;
    let l = Math.sqrt(f * f + r * r); if (l > 1) { f /= l; r /= l; l = 1; }
    // move relative to the camera (P.yaw is the camera's heading)
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    const dx = fx * f + rx * r, dz = fz * f + rz * r;
    // a light push on the joystick walks slowly, the rim runs; keys walk, Shift runs, Ctrl+Shift sprints
    const touch = touchIn.jx !== 0 || touchIn.jy !== 0;
    const want = l < 0.05 ? 0 : sprint ? SPEED.sprint : run ? SPEED.run : touch ? SPEED.walk * Math.min(1, l / 0.7) : SPEED.walk;
    const grounded = S.ground;
    // speed eases in and out (quicker to stop than to start); in the air it barely changes
    const acc = !grounded ? 0.6 : want > S.speed ? 5.5 : 9;
    S.speed += Math.sign(want - S.speed) * Math.min(Math.abs(want - S.speed), acc * dt * Math.max(1, S.speed * 0.6));
    if (l > 0.05 && grounded) {
      // turn towards the direction of travel: fast at a walk, a wider arc at a run
      const tgt = Math.atan2(dx, dz); let d = tgt - S.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      const rate = S.speed > 3 ? 7 : 10; S.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
    }
    // he walks where he faces (that is what keeps the feet planted while turning)
    const hx = Math.sin(S.yaw), hz = Math.cos(S.yaw);
    let nx = S.x + hx * S.speed * dt, nz = S.z + hz * S.speed * dt;
    surfaceInto(g, nx, nz, S.y + 0.5);
    if (!g.water && g.y - S.y < 0.75) { q.x = nx; q.z = nz; pushOut(q, R_BODY); nx = q.x; nz = q.z; }
    else { nx = S.x; nz = S.z; S.speed *= 0.3; }   // the lake shore or a step too high: stop there
    const moved = Math.hypot(nx - S.x, nz - S.z);
    S.x = nx; S.z = nz;
    surfaceInto(g, S.x, S.z, S.y + 0.5);
    if ((kd('Space') || touchIn.jump) && S.ground) { S.vy = 4.0; S.ground = false; }
    S.vy -= 9.81 * dt; S.y += S.vy * dt;
    if (S.y <= g.y) { S.y = g.y; S.vy = 0; S.ground = true; }
    else if (S.y - g.y > 0.25) S.ground = false;   // off a kerb: a short fall, stays on the ground animation below 25 cm
    else if (S.vy <= 0) { S.y = g.y; S.vy = 0; S.ground = true; }   // walking down a slope: follow it
    // the stride phase advances with the ground covered, at the stride length of the current gait blend
    const real = moved / Math.max(dt, 1e-4);
    S.phase = (S.phase + moved / strideAt(Math.min(S.speed, real + 0.2))) % 1;
    S.real = real;
    P.x = S.x; P.z = S.z; P.y = S.y;
  }
  function strideAt(v) {
    if (v <= GAIT[0].v) return GAIT[0].stride;
    for (let i = 0; i < GAIT.length - 1; i++) { const a = GAIT[i], b = GAIT[i + 1]; if (v <= b.v) return a.stride + (b.stride - a.stride) * (v - a.v) / (b.v - a.v); }
    return GAIT[GAIT.length - 1].stride * v / GAIT[GAIT.length - 1].v;
  }

  // ---- animation weights: idle / walk / jog / sprint by speed, a jump pose in the air ----
  function animate(dt) {
    if (!ready) return;
    const v = S.ground ? Math.min(S.speed, (S.real || 0) + 0.3) : S.speed;
    const ws = [0, 0, 0];
    let wIdle = 0;
    if (v < 0.15) wIdle = 1;
    else if (v < GAIT[0].v) { const k = (v - 0.15) / (GAIT[0].v - 0.15); wIdle = 1 - k; ws[0] = k; }
    else if (v < GAIT[1].v) { const k = (v - GAIT[0].v) / (GAIT[1].v - GAIT[0].v); ws[0] = 1 - k; ws[1] = k; }
    else if (v < GAIT[2].v) { const k = (v - GAIT[1].v) / (GAIT[2].v - GAIT[1].v); ws[1] = 1 - k; ws[2] = k; }
    else ws[2] = 1;
    S.airW += ((S.ground ? 0 : 1) - S.airW) * (1 - Math.exp(-dt * (S.ground ? 14 : 8)));
    const ground = 1 - S.airW;
    idle.setEffectiveWeight(wIdle * ground);
    loco.forEach((L, i) => { L.a.setEffectiveWeight(ws[i] * ground); L.a.time = S.phase * L.T; });
    air.setEffectiveWeight(S.airW);
    mixer.update(dt);
  }

  // ---- the model follows the simulated body (height smoothed over kerbs) ----
  function place(dt = 0) {
    if (S.yDraw === null || !S.ground || Math.abs(S.y - S.yDraw) > 1) S.yDraw = S.y;
    else S.yDraw += (S.y - S.yDraw) * (1 - Math.exp(-dt * 18));
    root.position.set(S.x, S.yDraw, S.z); root.rotation.set(0, S.yaw, 0);
  }

  // ---- camera: behind and above, orbiting with the mouse, kept out of walls and the ground ----
  const _t = new THREE.Vector3();
  function blocked(x, y, z) {
    if (y < terrH(x, z) + 0.35) return true;
    q.x = x; q.z = z; return pushOut(q, 0.25) && y < terrH(x, z) + 8;   // inside a house (eaves height ~8 m above the ground)
  }
  function updateCamera(dt) {
    P.pitch = Math.max(CAM.minPitch, Math.min(CAM.maxPitch, P.pitch));
    const tx = S.x, ty = S.yDraw + CAM.height, tz = S.z;
    if (!cam.init) { cam.tx = tx; cam.ty = ty; cam.tz = tz; cam.dNow = cam.d; }
    const k = cam.init ? 1 - Math.exp(-dt * 12) : 1;
    cam.tx += (tx - cam.tx) * k; cam.ty += (ty - cam.ty) * (cam.init ? 1 - Math.exp(-dt * 8) : 1); cam.tz += (tz - cam.tz) * k;
    const cp = Math.cos(P.pitch), bx = Math.sin(P.yaw) * cp, by = -Math.sin(P.pitch), bz = Math.cos(P.yaw) * cp;   // from the target back to the camera
    // the furthest free distance along that line (sampled every 25 cm, a little short of the obstacle)
    let free = cam.d;
    for (let d = 0.5; d <= cam.d; d += 0.25) if (blocked(cam.tx + bx * d, cam.ty + by * d, cam.tz + bz * d)) { free = Math.max(0.5, d - 0.3); break; }
    cam.dNow = free < cam.dNow || !cam.init ? free : cam.dNow + (free - cam.dNow) * (1 - Math.exp(-dt * 3));
    cam.init = true;
    camera.position.set(cam.tx + bx * cam.dNow, cam.ty + by * cam.dNow, cam.tz + bz * cam.dNow);
    const minY = terrH(camera.position.x, camera.position.z) + 0.3; if (camera.position.y < minY) camera.position.y = minY;
    camera.lookAt(_t.set(cam.tx, cam.ty, cam.tz));
    // very close in, the head would fill the screen: fade the character out
    const near = cam.dNow < 0.9; if (model && model.visible === near) model.visible = !near;
  }

  return {
    root, load, spawn, step, animate, place, updateCamera,
    get ready() { return ready; },
    get state() { return S; },
    set visible(v) { root.visible = v; },
    zoom(f) { cam.d = Math.max(CAM.minD, Math.min(CAM.maxD, cam.d * f)); },
  };
}
