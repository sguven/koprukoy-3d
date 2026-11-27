// v1.24: the guns in the player's hands, built from side profiles of the real weapons (extruded, slightly bevelled)
// instead of boxes, held by two gloved hands. Real sizes in metres. Frame as before: barrel along -Z, grip down,
// x to the right. Every gun is merged into one mesh per material (3–5 draw calls); the parts that move on their own
// (pistol slides, the shotgun's pump, the AWP's bolt) stay separate and are returned in userData.moving.
// The bots keep the simpler guns of src/game.js (they are seen from far away and the arm IK is tuned to them).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mat = (c, r, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
export const GM = {
  steel: mat(0x34363a, 0.42, 0.35),       // parkerised / blued steel (no env map in the view-model scene: low metalness keeps it readable)
  dark: mat(0x1d1e21, 0.5, 0.3),
  poly: mat(0x222324, 0.78, 0),           // black polymer
  wood: mat(0x7b4524, 0.55, 0),           // AK furniture
  woodDark: mat(0x5a3019, 0.6, 0),
  olive: mat(0x56603f, 0.75, 0),          // AWP chassis, grenade body
  tan: mat(0x8c7a55, 0.8, 0),             // M249 ammo pouch
  silver: mat(0xb7babf, 0.3, 0.6),
  blade: mat(0xd8dbe0, 0.22, 0.7),
  glove: mat(0x2c2b27, 0.85, 0),
  sleeve: mat(0x58593f, 0.9, 0),          // olive field jacket
  lens: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.5, emissive: 0x0a1420 }),
  red: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
  white: mat(0xe6e3da, 0.7, 0),
};

// --- helpers. Profiles are written as [forward, up] pairs (forward = towards the muzzle), extruded across x.
function ext(pts, thick, m, x = 0, bevel = 0.003) {
  const s = new THREE.Shape(); s.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, thick - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 3 });
  g.translate(0, 0, -(thick - 2 * bevel) / 2);
  g.rotateY(Math.PI / 2);   // (forward, up, across) -> (across, up, -forward)
  g.translate(x, 0, 0);
  return { g, m };
}
// cylinder along the barrel: from forward a to forward b at height y
function tube(r1, r2, a, b, y, m, x = 0, seg = 12) {
  const g = new THREE.CylinderGeometry(r2, r1, Math.abs(b - a), seg); g.rotateX(-Math.PI / 2); g.translate(x, y, -(a + b) / 2);
  return { g, m };
}
function blk(w, h, d, fwd, y, m, x = 0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, -fwd); return { g, m }; }
function merge(parts) {
  const by = new Map();
  for (const p of parts) { let L = by.get(p.m); if (!L) by.set(p.m, L = []); const g = p.g.index ? p.g.toNonIndexed() : p.g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); L.push(g); }
  const grp = new THREE.Group();
  for (const [m, L] of by) { const mesh = new THREE.Mesh(mergeGeometries(L, false), m); grp.add(mesh); }
  return grp;
}

// --- hands: a gloved hand closed round a point, the forearm running back towards an elbow below the screen
function hand(at, elbow, side, flat) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.045), GM.glove);
  const fingers = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.05), GM.glove);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.011, 0.04, 2, 6), GM.glove);
  if (flat) {   // support hand under a handguard: palm up, fingers curled over the left side
    palm.scale.set(1, 0.45, 1.5); palm.position.set(0, -0.028, 0);
    fingers.scale.set(0.5, 1.3, 1.6); fingers.position.set(side * 0.036, -0.005, 0);
    thumb.rotation.x = Math.PI / 2; thumb.position.set(-side * 0.03, 0.0, -0.02);
  } else {       // gun hand round a grip
    palm.position.set(side * 0.026, 0, 0); fingers.position.set(-side * 0.012, -0.005, -0.045);
    thumb.rotation.z = 0.4 * side; thumb.position.set(-side * 0.028, 0.035, -0.005);
  }
  g.add(palm, fingers, thumb);
  g.position.copy(at);
  const arm = new THREE.Group(), dir = new THREE.Vector3().subVectors(elbow, at), L = dir.length();
  const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.05, L, 10), GM.sleeve); fore.position.y = L / 2;
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.05, 10), GM.glove); cuff.position.y = 0.04;
  arm.add(fore, cuff); arm.position.copy(at);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return [g, arm];
}
const V = (x, y, fwd) => new THREE.Vector3(x, y, -fwd);

// --- the guns. Bore axis at y = 0.03 unless said otherwise; the trigger is near forward = 0.
const BUILD = {
  ak47() {
    const p = [
      ext([[-0.13, -0.03], [0.17, -0.03], [0.17, 0.04], [0.14, 0.056], [-0.1, 0.056], [-0.13, 0.045]], 0.05, GM.steel),           // receiver + dust cover
      ext([[-0.13, 0.042], [-0.13, -0.025], [-0.2, -0.045], [-0.5, -0.105], [-0.53, -0.1], [-0.53, 0.025], [-0.5, 0.035]], 0.042, GM.wood),   // stock
      ext([[-0.53, -0.1], [-0.545, -0.1], [-0.545, 0.025], [-0.53, 0.025]], 0.044, GM.dark),                                        // butt plate
      ext([[-0.035, -0.028], [0.0, -0.028], [-0.04, -0.13], [-0.078, -0.128]], 0.032, GM.woodDark),                                  // pistol grip
      ext([[0.0, -0.03], [0.07, -0.03], [0.07, -0.036], [0.01, -0.07], [-0.005, -0.07], [-0.005, -0.06], [0.004, -0.06], [0.058, -0.036], [0, -0.036]], 0.012, GM.dark),   // trigger guard
      ext([[0.17, -0.028], [0.4, -0.022], [0.4, 0.024], [0.17, 0.026]], 0.054, GM.wood),                                             // lower handguard
      ext([[0.18, 0.034], [0.37, 0.036], [0.37, 0.06], [0.2, 0.062]], 0.036, GM.wood),                                              // gas tube cover
      ext([[0.08, -0.03], [0.145, -0.03], [0.175, -0.12], [0.18, -0.2], [0.16, -0.275], [0.1, -0.265], [0.115, -0.19], [0.11, -0.11]], 0.03, GM.dark),   // curved magazine
      blk(0.03, 0.05, 0.03, 0.415, 0.035, GM.steel), tube(0.011, 0.011, 0.4, 0.6, 0.03, GM.dark), tube(0.006, 0.006, 0.4, 0.56, 0.0, GM.dark),
      blk(0.02, 0.045, 0.025, 0.57, 0.055, GM.dark), tube(0.015, 0.014, 0.6, 0.645, 0.03, GM.dark),
      blk(0.032, 0.02, 0.04, 0.16, 0.066, GM.dark), blk(0.012, 0.012, 0.05, 0.1, 0.03, GM.dark, 0.03),                              // rear sight, charging handle
    ];
    return { parts: p, muzzle: V(0, 0.03, 0.65), grip: V(0, -0.07, -0.05), fore: V(0, -0.02, 0.3), elbowR: V(0.05, -0.24, -0.33), elbowL: V(-0.2, -0.28, 0.02), sight: 0.066 };
  },
  m4a1() {
    const p = [
      ext([[-0.08, -0.03], [0.12, -0.03], [0.12, 0.022], [-0.08, 0.022]], 0.05, GM.dark),                                          // lower
      ext([[-0.1, 0.022], [0.14, 0.022], [0.14, 0.064], [-0.1, 0.064]], 0.052, GM.dark),                                           // upper
      ext([[0.14, -0.012], [0.4, -0.012], [0.4, 0.07], [0.14, 0.07]], 0.062, GM.poly),                                             // rail handguard
      ext([[-0.02, -0.028], [0.012, -0.028], [-0.025, -0.13], [-0.062, -0.13]], 0.03, GM.poly),                                   // grip
      ext([[0.03, -0.03], [0.1, -0.03], [0.112, -0.2], [0.048, -0.21]], 0.028, GM.dark),                                           // magazine
      ext([[-0.18, 0.055], [-0.34, 0.055], [-0.35, -0.075], [-0.31, -0.075], [-0.18, 0.005]], 0.045, GM.poly),                     // stock
      tube(0.016, 0.016, -0.08, -0.3, 0.032, GM.dark), tube(0.009, 0.009, 0.4, 0.6, 0.03, GM.dark), tube(0.012, 0.012, 0.6, 0.65, 0.03, GM.dark),
      ext([[0.37, 0.07], [0.4, 0.07], [0.395, 0.12], [0.385, 0.12]], 0.014, GM.dark),                                              // front sight post
      blk(0.024, 0.008, 0.5, 0.15, 0.074, GM.dark), blk(0.008, 0.024, 0.24, 0.27, 0.03, GM.dark, 0.034), blk(0.008, 0.024, 0.24, 0.27, 0.03, GM.dark, -0.034),   // rails
      // red-dot sight
      blk(0.03, 0.02, 0.05, 0.02, 0.086, GM.dark), tube(0.022, 0.022, -0.02, 0.07, 0.112, GM.dark), tube(0.019, 0.019, 0.068, 0.072, 0.112, GM.lens),
      ext([[0.0, -0.03], [0.06, -0.03], [0.06, -0.036], [0.008, -0.068], [-0.004, -0.068], [-0.004, -0.06], [0.004, -0.06], [0.05, -0.036], [0, -0.036]], 0.012, GM.dark),
    ];
    return { parts: p, muzzle: V(0, 0.03, 0.66), grip: V(0, -0.07, -0.04), fore: V(0, -0.01, 0.3), elbowR: V(0.05, -0.24, -0.33), elbowL: V(-0.2, -0.28, 0.04), sight: 0.112, dot: true };
  },
  mp5() {
    const p = [
      ext([[-0.12, -0.022], [0.18, -0.022], [0.18, 0.052], [-0.12, 0.052]], 0.046, GM.dark),
      ext([[0.18, -0.04], [0.33, -0.034], [0.33, 0.036], [0.18, 0.042]], 0.052, GM.poly),
      ext([[-0.06, -0.022], [0.065, -0.022], [0.055, -0.05], [0.0, -0.05], [-0.03, -0.13], [-0.066, -0.13], [-0.05, -0.05], [-0.06, -0.05]], 0.032, GM.poly),
      ext([[0.09, -0.022], [0.13, -0.022], [0.15, -0.11], [0.165, -0.21], [0.125, -0.212], [0.11, -0.11]], 0.025, GM.dark),
      ext([[-0.12, 0.046], [-0.38, 0.032], [-0.4, -0.085], [-0.36, -0.092], [-0.12, -0.02]], 0.04, GM.poly),
      tube(0.009, 0.009, 0.33, 0.4, 0.025, GM.dark), tube(0.013, 0.013, 0.12, 0.34, 0.07, GM.dark),
      tube(0.018, 0.018, 0.33, 0.345, 0.07, GM.dark), tube(0.016, 0.016, -0.1, -0.075, 0.07, GM.dark, 0, 8),
    ];
    return { parts: p, muzzle: V(0, 0.025, 0.41), grip: V(0, -0.07, -0.035), fore: V(0, -0.015, 0.26), elbowR: V(0.05, -0.24, -0.33), elbowL: V(-0.2, -0.27, 0.0), sight: 0.09 };
  },
  awp() {
    const p = [
      ext([[-0.52, -0.105], [-0.5, 0.05], [-0.25, 0.042], [-0.12, 0.02], [0.46, 0.02], [0.46, -0.03], [0.06, -0.04], [0.02, -0.05], [-0.02, -0.05], [-0.055, -0.15], [-0.1, -0.15], [-0.1, -0.06], [-0.2, -0.05], [-0.48, -0.115]], 0.056, GM.olive),
      ext([[-0.53, -0.115], [-0.52, -0.105], [-0.5, 0.05], [-0.515, 0.05]], 0.058, GM.poly),
      tube(0.019, 0.019, -0.09, 0.15, 0.04, GM.steel), tube(0.014, 0.01, 0.15, 0.74, 0.04, GM.dark), tube(0.017, 0.017, 0.72, 0.79, 0.04, GM.dark),
      tube(0.02, 0.02, -0.08, 0.22, 0.12, GM.dark), tube(0.03, 0.022, 0.2, 0.28, 0.12, GM.dark), tube(0.022, 0.027, -0.13, -0.08, 0.12, GM.dark),
      tube(0.027, 0.027, 0.279, 0.281, 0.12, GM.lens), blk(0.022, 0.03, 0.02, -0.02, 0.075, GM.dark), blk(0.022, 0.03, 0.02, 0.14, 0.075, GM.dark),
      blk(0.032, 0.03, 0.03, 0.06, 0.15, GM.dark), blk(0.04, 0.09, 0.07, 0.08, -0.06, GM.dark),
    ];
    const bolt = merge([tube(0.005, 0.005, 0, 0.001, 0, GM.dark), (() => { const g = new THREE.CylinderGeometry(0.005, 0.005, 0.06); g.rotateZ(Math.PI / 2); g.translate(0.035, 0, 0); return { g, m: GM.dark }; })(), (() => { const g = new THREE.SphereGeometry(0.011, 8, 6); g.translate(0.066, 0, 0); return { g, m: GM.dark }; })()]);
    bolt.position.set(0, 0.04, 0.06);
    return { parts: p, muzzle: V(0, 0.04, 0.8), grip: V(0, -0.08, -0.07), fore: V(0, -0.025, 0.3), elbowR: V(0.05, -0.25, -0.35), elbowL: V(-0.2, -0.28, 0.03), sight: 0.12, moving: { bolt } };
  },
  m3() {
    const p = [
      ext([[-0.1, -0.02], [0.12, -0.02], [0.12, 0.055], [-0.1, 0.055]], 0.048, GM.poly),
      ext([[-0.1, 0.045], [-0.42, 0.022], [-0.44, -0.1], [-0.38, -0.105], [-0.14, -0.03], [-0.1, -0.02]], 0.042, GM.poly),
      ext([[-0.03, -0.02], [0.0, -0.02], [-0.035, -0.125], [-0.07, -0.122]], 0.03, GM.poly),
      tube(0.012, 0.012, 0.12, 0.62, 0.035, GM.dark), tube(0.012, 0.012, 0.12, 0.52, 0.0, GM.dark), blk(0.024, 0.04, 0.02, 0.52, 0.018, GM.dark),
      blk(0.008, 0.012, 0.01, 0.6, 0.05, GM.silver), blk(0.03, 0.014, 0.06, -0.02, 0.064, GM.dark),
      ext([[0.0, -0.022], [0.055, -0.022], [0.05, -0.03], [0.008, -0.062], [-0.004, -0.06], [0.004, -0.052], [0.04, -0.03], [0, -0.03]], 0.012, GM.dark),
    ];
    const pump = merge([tube(0.024, 0.024, 0.2, 0.37, 0.002, GM.poly, 0, 14)]);
    return { parts: p, muzzle: V(0, 0.035, 0.63), grip: V(0, -0.065, -0.035), fore: V(0, -0.015, 0.29), elbowR: V(0.05, -0.24, -0.33), elbowL: V(-0.2, -0.28, 0.02), sight: 0.06, moving: { pump }, foreOnPump: true };
  },
  m249() {
    const p = [
      ext([[-0.12, -0.035], [0.24, -0.035], [0.24, 0.07], [-0.12, 0.07]], 0.07, GM.dark),
      ext([[-0.11, 0.07], [0.15, 0.07], [0.15, 0.09], [-0.09, 0.09]], 0.06, GM.dark),                                               // feed cover
      ext([[0.24, -0.02], [0.42, -0.015], [0.42, 0.06], [0.24, 0.06]], 0.064, GM.poly),                                             // handguard
      ext([[-0.12, 0.06], [-0.42, 0.045], [-0.43, -0.095], [-0.38, -0.1], [-0.15, -0.035]], 0.048, GM.poly),
      ext([[-0.02, -0.035], [0.012, -0.035], [-0.025, -0.14], [-0.062, -0.138]], 0.032, GM.poly),
      blk(0.08, 0.13, 0.14, 0.08, -0.1, GM.tan, -0.02), blk(0.03, 0.03, 0.07, 0.08, -0.02, GM.dark, -0.05),                         // ammo pouch, belt feed
      tube(0.013, 0.013, 0.42, 0.68, 0.03, GM.dark), tube(0.016, 0.016, 0.66, 0.71, 0.03, GM.dark), tube(0.019, 0.019, 0.24, 0.42, 0.03, GM.steel, 0, 10),
      blk(0.012, 0.012, 0.22, 0.52, -0.01, GM.dark, 0.012), blk(0.012, 0.012, 0.22, 0.52, -0.01, GM.dark, -0.012),                  // folded bipod
      blk(0.02, 0.06, 0.02, 0.6, 0.06, GM.dark), blk(0.03, 0.03, 0.12, 0.3, 0.11, GM.dark),                                          // front sight, carry handle
    ];
    return { parts: p, muzzle: V(0, 0.03, 0.72), grip: V(0, -0.075, -0.04), fore: V(0, -0.02, 0.33), elbowR: V(0.06, -0.25, -0.33), elbowL: V(-0.21, -0.3, 0.06), sight: 0.09 };
  },
  deagle() {
    const p = [
      ext([[-0.05, -0.016], [0.15, -0.016], [0.15, 0.012], [-0.05, 0.012]], 0.03, GM.dark),
      ext([[-0.05, -0.016], [0.0, -0.016], [-0.03, -0.13], [-0.08, -0.13], [-0.068, -0.04]], 0.036, GM.poly),
      ext([[0.0, -0.016], [0.05, -0.016], [0.04, -0.045], [0.004, -0.045]], 0.012, GM.dark),
    ];
    const slide = merge([ext([[-0.065, 0.012], [0.17, 0.012], [0.17, 0.058], [-0.06, 0.06]], 0.036, GM.silver), blk(0.006, 0.014, 0.012, 0.16, 0.066, GM.dark), blk(0.03, 0.012, 0.012, -0.05, 0.066, GM.dark)]);
    return { parts: p, muzzle: V(0, 0.04, 0.175), grip: V(0, -0.07, -0.04), fore: null, elbowR: V(0.06, -0.26, -0.3), elbowL: V(-0.12, -0.28, -0.25), sight: 0.07, moving: { slide }, pistol: true };
  },
  glock() {
    const p = [
      ext([[-0.045, -0.014], [0.13, -0.014], [0.13, 0.01], [-0.045, 0.01]], 0.028, GM.poly),
      ext([[-0.045, -0.014], [0.0, -0.014], [-0.03, -0.12], [-0.075, -0.118], [-0.06, -0.035]], 0.03, GM.poly),
      ext([[0.0, -0.014], [0.045, -0.014], [0.035, -0.04], [0.004, -0.04]], 0.01, GM.poly),
    ];
    const slide = merge([ext([[-0.05, 0.01], [0.15, 0.01], [0.15, 0.045], [-0.05, 0.045]], 0.027, GM.dark), blk(0.005, 0.01, 0.01, 0.14, 0.05, GM.white), blk(0.024, 0.01, 0.01, -0.04, 0.05, GM.dark)]);
    return { parts: p, muzzle: V(0, 0.03, 0.155), grip: V(0, -0.065, -0.035), fore: null, elbowR: V(0.06, -0.26, -0.3), elbowL: V(-0.12, -0.28, -0.25), sight: 0.055, moving: { slide }, pistol: true };
  },
  knife() {
    const p = [
      ext([[0.0, -0.012], [0.12, -0.012], [0.2, 0.01], [0.13, 0.016], [0.0, 0.016]], 0.005, GM.blade, 0, 0.001),
      ext([[-0.005, -0.03], [0.0, -0.03], [0.0, 0.032], [-0.005, 0.032]], 0.022, GM.dark, 0, 0.002),
      ext([[-0.12, -0.016], [-0.005, -0.016], [-0.005, 0.02], [-0.12, 0.02], [-0.125, 0.0]], 0.024, GM.poly),
    ];
    return { parts: p, muzzle: V(0, 0, 0.2), grip: V(0, 0, -0.065), fore: null, elbowR: V(0.08, -0.25, -0.33), sight: 0 };
  },
};

/** A gun with its hands, for the view model. userData: muzzle, moving parts, sight height. */
export function viewGun(kind) {
  const d = BUILD[kind]();
  const g = merge(d.parts);
  g.userData.muzzle = d.muzzle.clone(); g.userData.moving = {}; g.userData.sight = d.sight;
  for (const k in d.moving || {}) { g.add(d.moving[k]); g.userData.moving[k] = d.moving[k]; }
  if (d.dot) { const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 6, 4), GM.red); dot.position.set(0, 0.112, 0.05); g.add(dot); }
  // right hand on the grip, left hand under the handguard (or wrapped round the right hand on a pistol)
  for (const o of hand(d.grip, d.elbowR, 1, false)) g.add(o);
  if (d.fore) { const [h, a] = hand(d.fore, d.elbowL, -1, true); if (d.foreOnPump) { d.moving.pump.add(h); d.moving.pump.add(a); h.position.sub(d.moving.pump.position); a.position.sub(d.moving.pump.position); } else g.add(h, a); }
  else if (d.pistol) { const at = d.grip.clone().add(new THREE.Vector3(-0.03, -0.01, 0.02)); for (const o of hand(at, d.elbowL, -1, false)) g.add(o); }
  g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  return g;
}

/** A hand grenade (HE) or a smoke grenade, ~11 cm, standing on its base. */
export function grenadeModel(kind) {
  const parts = [];
  if (kind === 'he') {
    const b = new THREE.SphereGeometry(0.032, 12, 9); b.scale(1, 1.2, 1); parts.push({ g: b, m: GM.olive });
    const top = new THREE.CylinderGeometry(0.012, 0.014, 0.022, 8); top.translate(0, 0.045, 0); parts.push({ g: top, m: GM.steel });
  } else {
    const b = new THREE.CylinderGeometry(0.03, 0.03, 0.1, 12); parts.push({ g: b, m: GM.dark });
    const band = new THREE.CylinderGeometry(0.0305, 0.0305, 0.018, 12); band.translate(0, 0.01, 0); parts.push({ g: band, m: GM.white });
    const top = new THREE.CylinderGeometry(0.014, 0.016, 0.018, 8); top.translate(0, 0.058, 0); parts.push({ g: top, m: GM.steel });
  }
  const spoon = new THREE.BoxGeometry(0.008, 0.07, 0.014); spoon.translate(0.03, 0.025, 0); parts.push({ g: spoon, m: GM.steel });
  const ring = new THREE.TorusGeometry(0.012, 0.0025, 4, 10); ring.translate(-0.012, 0.06, 0); parts.push({ g: ring, m: GM.silver });
  const g = merge(parts); g.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
  return g;
}

/** A grenade held up in the right hand, ready to throw (view model). */
export function viewGrenade(kind) {
  const g = new THREE.Group(), n = grenadeModel(kind); n.position.set(0, 0.02, 0); g.add(n);
  for (const o of hand(new THREE.Vector3(0.01, -0.02, 0.01), new THREE.Vector3(0.08, -0.28, 0.3), 1, false)) g.add(o);
  g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.05); g.userData.moving = {}; g.userData.sight = 0;
  g.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
  return g;
}
