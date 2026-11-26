// v1.19 Game-mode bots as people (Nov 2026): skinned, animated villagers with rifles instead of the box figures.
//
// The model is model/character/bots.glb, built with tools/build_character.mjs from the same Quaternius CC0 kits as
// the walking villager (src/avatar.js, model/character/LICENSE.md): the regular man's head with every hairstyle and
// beard of the kit, three outfits (Peasant, Ranger with or without the hood, Noble) and ten clips of the Universal
// Animation Library. All parts sit on one 65-bone skeleton; every bot is a clone that shows one hairstyle, at most
// one beard and one outfit, tinted and colour-wayed on its own, so no two bots in a round look the same.
//
// Animation, per bot:
//   legs     idle / walk / jog / sprint (and crouch) blended by the speed the bot really covers, the stride phase
//            advancing with the ground covered (no sliding feet); walking backwards plays the cycle in reverse;
//            moving sideways turns the hips towards the step and the chest back towards the target (the spine
//            takes the twist), so a strafing bot sidesteps instead of moonwalking.
//   chest    the pistol-aim stance from the kit (shoulders square, head up) when fighting, a relaxed one on patrol,
//            bent forward or back by the pitch to the target.
//   arms     two-bone IK to the gun: the rifle's butt sits in the right shoulder, the right hand on the grip, the left
//            on the handguard (a Desert Eagle is held out in both hands); on patrol the muzzle points at the ground
//            in front ("low ready"); kick on every shot, the gun dips and the left hand goes to the magazine on reload.
//   death    the kit's fall (Death01) with the gun still in the hand; a flinch (Hit_Chest) when hit.
// Bots out of view are not animated at all; beyond 60 m their skeleton is updated 15 times a second.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// stride per cycle (two steps) of the clips, from src/avatar.js (walk 1.05 m/s, jog 4.0, sprint 7.0)
const GAIT = [
  { clip: 'Walk_Loop', v: 1.05, stride: 1.40 },
  { clip: 'Jog_Fwd_Loop', v: 4.0, stride: 3.73 },
  { clip: 'Sprint_Loop', v: 7.0, stride: 4.67 },
];
const CROUCH_STRIDE = 1.1, LOCO = ['walk', 'jog', 'sprint', 'crouchWalk'];
// the bones the leg clips drive; everything above the waist belongs to the chest/arm layer
const LOWER = /^(root|pelvis|spine_01|thigh_|calf_|foot_|ball_)/;

// looks: every bot picks one of each (seeded by its number, so a bot keeps its face over respawns)
const OUTFITS = [
  { key: 'Peasant', parts: ['Male_Peasant_Arms', 'Male_Peasant_Body', 'Male_Peasant_Legs', 'Male_Peasant_Feet'],
    tints: [0xffffff, 0xd8cdb8, 0xb9c4cf, 0xc9c0a2, 0xe0c8b0, 0xa9b39a] },
  { key: 'Ranger', parts: ['Male_Ranger_Arms', 'Male_Ranger_Body', 'Male_Ranger_Body_Belt_1', 'Male_Ranger_Legs', 'Male_Ranger_Feet_Boots'],
    tints: [0xffffff, 0xc8b9a4, 0xaeb4b8, 0xd2c2a0], hood: 0.35 },
  { key: 'Noble', parts: ['Male_Noble_Arms', 'Male_Noble_Body', 'Male_Noble_Body_Belt', 'Male_Noble_Legs', 'Male_Noble_Feet'],
    tints: [0xffffff, 0xd9d2c8], ways: ['', 'T_Noble_2_BaseColor.webp', 'T_Noble_3_BaseColor.webp'] },
];
const HAIR = ['Hair_Buzzed', 'Hair_SimpleParted', 'Hair_SlickBack', 'Hair_Balding', 'Hair_Buzzed', 'Hair_SimpleParted'];
const BEARD = ['Hair_Moustache', 'Hair_Moustache', 'Hair_Beard', '', 'Hair_MuttonChops', 'Hair_Moustache', ''];
const HAIR_COL = [0x2a211c, 0x3b2c22, 0x1b1714, 0x4a3a30, 0x6d665f, 0x8f8a84, 0x2a211c];
const SKIN = [0xffffff, 0xf4e6dc, 0xe8d2c0, 0xfff2e8, 0xdcc0a8];
const ALL_PARTS = ['Male_Ranger_Head_Hood', 'Male_Ranger_Body_Belt_2', ...new Set([...HAIR, ...BEARD.filter(Boolean), ...OUTFITS.flatMap(o => o.parts)])];

// a tiny seeded generator (mulberry32)
const seeded = (s) => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0), FLIP = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);

/** Rotate `bone` (in world terms) by the world rotation `rot`, keeping its parent where it is. */
function rotateBoneWorld(bone, rot) {
  bone.parent.getWorldQuaternion(_q3);
  bone.getWorldQuaternion(_q4);
  _q4.premultiply(rot);                               // new world rotation
  bone.quaternion.copy(_q3.invert().multiply(_q4));   // back into the parent's frame
  bone.updateMatrixWorld(true);
}
/** Two-bone IK: turn upper and lower so that `end` reaches `target`, the middle joint bending towards `pole`. */
function solveArm(upper, lower, end, target, pole) {
  const S = upper.getWorldPosition(_v1), E = lower.getWorldPosition(_v2), W = end.getWorldPosition(_v3);
  const a = E.distanceTo(S), b = W.distanceTo(E);
  const toT = _v4.subVectors(target, S); let d = toT.length(); if (d < 1e-4) return;
  const n = toT.divideScalar(d); d = Math.min(d, (a + b) * 0.999);
  const m = _v5.subVectors(pole, S); m.addScaledVector(n, -m.dot(n)); if (m.lengthSq() < 1e-8) return; m.normalize();
  const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))), sinA = Math.sqrt(1 - cosA * cosA);
  const elbow = _v6.copy(S).addScaledVector(n, a * cosA).addScaledVector(m, a * sinA);
  // upper arm: from where the elbow is to where it should be
  _q1.setFromUnitVectors(E.sub(S).normalize(), elbow.sub(S).normalize()); rotateBoneWorld(upper, _q1);
  // forearm: from where the hand is now to the target
  lower.getWorldPosition(_v2); end.getWorldPosition(_v3);
  _q1.setFromUnitVectors(_v3.sub(_v2).normalize(), _v4.subVectors(target, _v2).normalize()); rotateBoneWorld(lower, _q1);
}

/**
 * guns: { [weapon]: { geo, mat, scale, muzzle: Vector3, grip, fore, butt (Vector3 or null), mag } } in the game's weapon
 * frame (barrel along -Z; `scale` brings the view-model sized guns to their real size in a man's hands). makeFlash(size) gives the muzzle flash sprite.
 */
export function createBotCrowd({ url, guns, makeFlash, parent }) {
  let gl = null, ready = false, loading = null, clips = null, wayTex = {};
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);

  function load() {
    if (loading) return loading;
    const base = new URL('.', url).href, tl = new THREE.TextureLoader();
    const ways = OUTFITS.flatMap(o => (o.ways || []).filter(Boolean));
    loading = Promise.all([loader.loadAsync(url), ...ways.map(w => tl.loadAsync(base + w).then(t => { t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; wayTex[w] = t; }))]).then(([g]) => {
      gl = g;
      // split the full-body clips into a legs layer and a chest/arms layer
      const pick = (name, lower) => {
        const c = gl.animations.find(a => a.name === name); if (!c) return null;
        const tracks = c.tracks.filter(t => { const bone = t.name.split('.')[0]; return lower === null ? true : LOWER.test(bone) === lower; });
        return new THREE.AnimationClip(name + (lower === null ? '' : lower ? '_L' : '_U'), c.duration, tracks);
      };
      clips = {
        idle: pick('Idle_Loop', true), walk: pick('Walk_Loop', true), jog: pick('Jog_Fwd_Loop', true), sprint: pick('Sprint_Loop', true),
        crouch: pick('Crouch_Idle_Loop', true), crouchWalk: pick('Crouch_Fwd_Loop', true),
        aim: pick('Pistol_Aim_Neutral', false), rest: pick('Pistol_Idle_Loop', false), crouchUp: pick('Crouch_Idle_Loop', false),
        hit: pick('Hit_Chest', false), death: pick('Death01', null),
      };
      gl.scene.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; } });
      ready = true;
    });
    return loading;
  }

  /** One bot's body. `id` picks the looks, `weapon` the gun in the hands. */
  function make(id, weapon) {
    const rnd = seeded(id * 7919 + 17);
    const root = new THREE.Group(); root.name = 'BotChar_' + id;
    const model = cloneSkinned(gl.scene); root.add(model);
    // ---- looks
    const outfit = OUTFITS[Math.floor(rnd() * OUTFITS.length)];
    const show = new Set(outfit.parts);
    const hood = outfit.hood && rnd() < outfit.hood; if (hood) show.add('Male_Ranger_Head_Hood');
    const hair = HAIR[Math.floor(rnd() * HAIR.length)], beard = BEARD[Math.floor(rnd() * BEARD.length)];
    if (!hood) show.add(hair);
    if (beard) show.add(beard);
    const tint = new THREE.Color(outfit.tints[Math.floor(rnd() * outfit.tints.length)]);
    const way = outfit.ways ? outfit.ways[Math.floor(rnd() * outfit.ways.length)] : '';
    const hairCol = new THREE.Color(HAIR_COL[Math.floor(rnd() * HAIR_COL.length)]), skin = new THREE.Color(SKIN[Math.floor(rnd() * SKIN.length)]);
    const mats = new Map();   // one copy of each kit material per bot
    const own = (m) => {
      let c = mats.get(m); if (c) return c;
      c = m.clone(); mats.set(m, c);
      c.envMapIntensity = 0.5;
      if (/Hair/.test(m.name)) c.color.copy(hairCol);
      else if (/Regular_Male/.test(m.name)) c.color.copy(skin);
      else if (/Eyes/.test(m.name)) { /* as is */ }
      else { c.color.copy(tint); if (way && wayTex[way]) c.map = wayTex[way]; }
      return c;
    };
    model.traverse(o => {
      if (!o.isMesh) return;
      const name = o.name.replace(/_\d+$/, '');
      const kitPart = ALL_PARTS.some(p => name === p || o.parent && o.parent.name === p);
      if (kitPart && !show.has(name) && !(o.parent && show.has(o.parent.name))) { o.visible = false; return; }
      o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    });
    const bone = {}; model.traverse(o => { if (o.isBone) bone[o.name] = o; });
    // ---- animation
    const mixer = new THREE.AnimationMixer(model);
    const act = {}; for (const k in clips) if (clips[k]) { const a = act[k] = mixer.clipAction(clips[k]); a.play(); a.setEffectiveWeight(0); }
    act.idle.setEffectiveWeight(1); act.rest.setEffectiveWeight(1);
    for (const k of ['walk', 'jog', 'sprint', 'crouchWalk']) act[k].timeScale = 0;
    act.hit.setLoop(THREE.LoopOnce, 1); act.hit.clampWhenFinished = false;
    act.death.setLoop(THREE.LoopOnce, 1); act.death.clampWhenFinished = true;
    for (const k of ['idle', 'crouch', 'rest', 'aim', 'crouchUp']) act[k].time = rnd() * act[k].getClip().duration;
    // ---- gun
    let G = null, gun = null, flash = null;
    function setWeapon(w) {
      if (gun) { parent.remove(gun); }
      G = guns[w]; gun = new THREE.Mesh(G.geo, G.mat); gun.scale.setScalar(G.scale || 1); gun.name = 'BotGun'; gun.frustumCulled = false; gun.castShadow = false; gun.receiveShadow = true;
      flash = makeFlash(0.5); flash.position.copy(G.muzzle); gun.add(flash); parent.add(gun);
    }
    setWeapon(weapon);
    parent.add(root);

    const S = { phase: rnd(), legYaw: 0, aimW: 0, crouchW: 0, kick: 0, reload: 0, dead: false, deadT: 0, acc: 0, w: [1, 0, 0, 0], back: false, rel: null };
    const gunPos = new THREE.Vector3(), gunQ = new THREE.Quaternion(), tmpP = new THREE.Vector3();
    const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qAcross = new THREE.Quaternion(), qGun = new THREE.Quaternion();

    // ---- one animation step. s: { x, y, z, yaw, vx, vz (m/s, world), pitch, aim (bool), crouch (bool), reloadK (0..1 or -1) }
    function update(dt, s) {
      root.position.set(s.x, s.y, s.z); root.rotation.set(0, s.yaw, 0);
      if (S.dead) {
        S.deadT += dt; mixer.update(dt); root.updateMatrixWorld(true);
        // the gun stays in the right hand as he falls
        if (S.rel) { _m1.multiplyMatrices(bone.hand_r.matrixWorld, S.rel); _m1.decompose(gun.position, gun.quaternion, gun.scale); gun.updateMatrixWorld(true); }
        return;
      }
      // ---- legs: speed along / across the facing
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
      const along = s.vx * fx + s.vz * fz, across = s.vx * fz - s.vz * fx, v = Math.hypot(along, across);
      let legTarget = 0, back = false;
      if (v > 0.3) {
        let a = Math.atan2(across, along);             // the direction of the step, relative to the facing (+ = to the left)
        if (Math.abs(a) > Math.PI * 0.6) { back = true; a = Math.atan2(Math.sin(a + Math.PI), Math.cos(a + Math.PI)); }
        legTarget = Math.max(-1.1, Math.min(1.1, a));
      }
      S.legYaw += (legTarget - S.legYaw) * (1 - Math.exp(-dt * 8));
      S.crouchW += ((s.crouch ? 1 : 0) - S.crouchW) * (1 - Math.exp(-dt * 7));
      const stride = S.crouchW > 0.5 ? CROUCH_STRIDE : strideAt(v);
      S.phase = (S.phase + (back ? -1 : 1) * v * dt / stride + 1) % 1;
      const w = S.w; w[0] = w[1] = w[2] = w[3] = 0;
      if (v < 0.15) w[0] = 1;
      else if (v < GAIT[0].v) { const k = (v - 0.15) / (GAIT[0].v - 0.15); w[0] = 1 - k; w[1] = k; }
      else if (v < GAIT[1].v) { const k = (v - GAIT[0].v) / (GAIT[1].v - GAIT[0].v); w[1] = 1 - k; w[2] = k; }
      else if (v < GAIT[2].v) { const k = (v - GAIT[1].v) / (GAIT[2].v - GAIT[1].v); w[2] = 1 - k; w[3] = k; }
      else w[3] = 1;
      const up = 1 - S.crouchW, moveK = 1 - w[0];
      act.idle.setEffectiveWeight(w[0] * up); act.walk.setEffectiveWeight(w[1] * up); act.jog.setEffectiveWeight(w[2] * up); act.sprint.setEffectiveWeight(w[3] * up);
      act.crouch.setEffectiveWeight(S.crouchW * (1 - moveK)); act.crouchWalk.setEffectiveWeight(S.crouchW * moveK);
      for (const k of LOCO) { const a = act[k]; a.time = S.phase * a.getClip().duration; }
      // ---- chest: aim stance or relaxed, a flinch when hit
      S.aimW += ((s.aim ? 1 : 0) - S.aimW) * (1 - Math.exp(-dt * 6));
      act.aim.setEffectiveWeight(S.aimW * (1 - S.crouchW * 0.4)); act.rest.setEffectiveWeight((1 - S.aimW) * (1 - S.crouchW * 0.4)); act.crouchUp.setEffectiveWeight(S.crouchW * 0.4);
      mixer.update(dt);
      // ---- hips towards the step, chest back towards the target; pitch bends the upper spine
      model.rotation.y = S.legYaw;
      root.updateMatrixWorld(true);
      _q2.setFromAxisAngle(UP, -S.legYaw / 3);
      rotateBoneWorld(bone.spine_01, _q2); rotateBoneWorld(bone.spine_02, _q2); rotateBoneWorld(bone.spine_03, _q2);
      const pitch = s.aim ? Math.max(-0.7, Math.min(0.7, s.pitch)) : 0;
      _q2.setFromAxisAngle(_v1.set(-fz, 0, fx), pitch * 0.35);   // about the bot's right: a positive angle lifts the chest
      rotateBoneWorld(bone.spine_02, _q2); rotateBoneWorld(bone.spine_03, _q2);
      // ---- gun: butt in the right shoulder, aimed (or pointing at the ground in front on patrol)
      S.kick = Math.max(0, S.kick - dt * 9);
      const rel = s.reloadK >= 0 ? Math.sin(Math.min(1, s.reloadK) * Math.PI) : 0;
      const ready = S.aimW;   // 0 = low ready, 1 = aimed
      const dip = (1 - ready) * 0.5 + rel * 0.45 - S.kick * 0.08;
      qYaw.setFromAxisAngle(UP, s.yaw);
      qPitch.setFromAxisAngle(_v1.set(1, 0, 0), -pitch * ready + dip);
      qAcross.setFromAxisAngle(UP, (1 - ready) * 0.38 + rel * 0.25);
      qGun.copy(qYaw).multiply(qAcross).multiply(qPitch).multiply(FLIP);   // FLIP: the weapon models point along -Z
      const shR = bone.upperarm_r.getWorldPosition(_v2), chest = bone.spine_03.getWorldPosition(_v3), neck = bone.neck_01.getWorldPosition(_v4);
      if (G.butt) {
        // the shoulder pocket: a little inside the shoulder joint and in front of it, a little lower on patrol
        tmpP.copy(shR).lerp(neck, 0.3).addScaledVector(_v5.set(fx, 0, fz), -0.06 - S.kick * 0.04);
        tmpP.y -= 0.02 + (1 - ready) * 0.08;
        gunPos.copy(G.butt).multiplyScalar(G.scale || 1).applyQuaternion(qGun); gunPos.subVectors(tmpP, gunPos);
      } else {
        // a pistol: held out in both hands at chest height
        tmpP.copy(chest).lerp(neck, 0.6).addScaledVector(_v5.set(fx, 0, fz), 0.42 - S.kick * 0.05 - (1 - ready) * 0.12);
        tmpP.addScaledVector(_v5.set(-fz, 0, fx), -0.03); tmpP.y -= (1 - ready) * 0.18;
        gunPos.copy(G.grip).multiplyScalar(G.scale || 1).applyQuaternion(qGun); gunPos.subVectors(tmpP, gunPos);
      }
      gun.position.copy(gunPos); gun.quaternion.copy(qGun); gun.updateMatrixWorld(true);
      // ---- arms reach the gun: right hand on the grip, left on the handguard (or on the magazine while reloading)
      // (solveArm works in _v1.._v6: the targets live in tmpP, the poles are made before the call)
      const tR = tmpP.copy(G.grip).applyMatrix4(gun.matrixWorld);
      const poleR = _v6.copy(shR).add(_v1.set(-fz * 0.35 - fx * 0.25, -1, fx * 0.35 - fz * 0.25));
      solveArm(bone.upperarm_r, bone.lowerarm_r, bone.hand_r, tR, poleR);
      const tL = tmpP.copy(rel > 0.05 ? G.mag || G.fore : G.fore).applyMatrix4(gun.matrixWorld);
      if (rel > 0.05) tL.y -= rel * 0.12;
      const shL = bone.upperarm_l.getWorldPosition(_v2);
      const poleL = _v6.copy(shL).add(_v1.set(fz * 0.45 - fx * 0.1, -1, -fx * 0.45 - fz * 0.1));
      solveArm(bone.upperarm_l, bone.lowerarm_l, bone.hand_l, tL, poleL);
      // the left hand keeps the stance's grip (it cradles the handguard); the right one is turned so that its fingers
      // wrap the pistol grip, across to the left and a little forward
      const hr = bone.hand_r, fr = bone.middle_01_r || bone.index_01_r;
      if (fr) {
        hr.getWorldPosition(_v1); fr.getWorldPosition(_v2); _v2.sub(_v1).normalize();
        _v3.set(-1, -0.35, -0.25).normalize().applyQuaternion(qGun);
        _q1.setFromUnitVectors(_v2, _v3); rotateBoneWorld(hr, _q1);
      }
      S.posed = true;
    }
    return {
      root, model, mixer, get gun() { return gun; }, get flash() { return flash; }, state: S,
      update,
      /** The bot fired a shot: the gun kicks. */
      fired() { S.kick = 1; },
      /** Hit but alive: a short flinch. */
      hit() { if (S.dead) return; act.hit.reset(); act.hit.setEffectiveWeight(0.6); act.hit.play(); },
      /** Killed: the fall, the gun kept in the hand. */
      die() {
        if (S.dead) return; S.dead = true; S.deadT = 0;
        // the gun stays in the right hand as he falls (if he was never posed, out of view, it is left out)
        if (S.posed) { root.updateMatrixWorld(true); gun.updateMatrixWorld(true); S.rel = (S.rel || new THREE.Matrix4()).copy(bone.hand_r.matrixWorld).invert().multiply(gun.matrixWorld); }
        else S.rel = null;
        for (const k in act) act[k].setEffectiveWeight(0);
        model.rotation.y = 0;
        act.death.reset(); act.death.setEffectiveWeight(1); act.death.play();
      },
      /** Back on his feet (respawn). */
      reset() {
        S.dead = false; S.posed = false; S.legYaw = 0; S.kick = 0; S.aimW = 0; S.crouchW = 0;
        act.death.stop(); act.death.setEffectiveWeight(0); act.hit.stop();
        act.death.play(); act.death.setEffectiveWeight(0);
        act.idle.setEffectiveWeight(1); act.rest.setEffectiveWeight(1);
      },
      setWeapon,
      set visible(v) { root.visible = v; if (gun) gun.visible = v && (!S.dead || !!S.rel); },
      dispose() { parent.remove(root); parent.remove(gun); mixer.stopAllAction(); for (const m of mats.values()) m.dispose(); },
    };
  }
  function strideAt(v) {
    if (v <= GAIT[0].v) return GAIT[0].stride;
    for (let i = 0; i < GAIT.length - 1; i++) { const a = GAIT[i], b = GAIT[i + 1]; if (v <= b.v) return a.stride + (b.stride - a.stride) * (v - a.v) / (b.v - a.v); }
    return GAIT[GAIT.length - 1].stride * v / GAIT[GAIT.length - 1].v;
  }

  return { load, make, get ready() { return ready; } };
}
