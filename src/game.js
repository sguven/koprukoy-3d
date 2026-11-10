// Köprüköy Arena — a Counter-Strike 1.5-style deathmatch against bots, played in the real village with the walk
// controls (v0.9.6 / v0.9.7). Low-poly on purpose: the point is the village as a map.
//
// Weapons (CS 1.5 numbers, roughly): AK-47, M4A1, MP5 Navy, AWP as the primary (chosen in Settings), Desert Eagle
// as the sidearm, knife. Keys 1 / 2 / 3, Q = last weapon, wheel cycles, R reloads, right mouse = AWP scope.
// Bots carry the same rifles, roam the real road network (village_layout roads → graph of lanes and junctions),
// react with a short delay when they spot the player, fire bursts, run-and-gun, strafe at mid range, fall back and
// reload when the magazine is empty, run for cover when hurt, turn towards shots that hit them and towards gunfire
// they hear. Line of sight and bullets are blocked by the terrain height field and the building boxes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BOT_NAMES = ['Keskinli', 'Kırıkkaleli', 'Çeşnigir', 'Kapulukaya', 'Hırka', 'Köprübaşı', 'Kızılırmak', 'Bozkır', 'Karakeçili', 'Ceritler', 'Yeşilyurt', 'Göçeri'];
const botName = (i) => BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? ' ' + (Math.floor(i / BOT_NAMES.length) + 1) : '');
// dmg = body damage at close range, head = multiplier, rate = shots per second, spread in radians (standing),
// kick = camera kick per shot (degrees), climb = how fast the spread grows while holding the trigger
export const WEAPONS = {
  ak47:  { name: 'AK-47',        slot: 1, dmg: 36, head: 4.0, rate: 10.0, mag: 30, reserve: 90,  reload: 2.5, spread: 0.0045, moveSpread: 0.022, kick: 1.3, climb: 0.0028, auto: true,  range: 260, botAcc: 0.30 },
  m4a1:  { name: 'M4A1',         slot: 1, dmg: 33, head: 4.0, rate: 11.0, mag: 30, reserve: 90,  reload: 3.1, spread: 0.0035, moveSpread: 0.018, kick: 1.0, climb: 0.0020, auto: true,  range: 260, botAcc: 0.33 },
  mp5:   { name: 'MP5 Navy',     slot: 1, dmg: 26, head: 4.0, rate: 13.3, mag: 30, reserve: 120, reload: 2.6, spread: 0.0060, moveSpread: 0.014, kick: 0.6, climb: 0.0012, auto: true,  range: 180, botAcc: 0.27 },
  awp:   { name: 'AWP',          slot: 1, dmg: 115, head: 4.0, rate: 0.68, mag: 10, reserve: 30,  reload: 3.6, spread: 0.0012, moveSpread: 0.06,  kick: 2.6, climb: 0,      auto: false, range: 400, botAcc: 0.55, scope: true },
  deagle:{ name: 'Desert Eagle', slot: 2, dmg: 54, head: 4.0, rate: 3.3,  mag: 7,  reserve: 35,  reload: 2.2, spread: 0.0070, moveSpread: 0.024, kick: 2.2, climb: 0.004,  auto: false, range: 200, botAcc: 0.32 },
  knife: { name: 'Knife',        slot: 3, dmg: 40, head: 2.0, rate: 1.4,  mag: Infinity, reserve: 0, reload: 0, spread: 0, moveSpread: 0, kick: 0.3, climb: 0, auto: true, range: 2.3, melee: true },
};

export function createGame(ctx) {
  const { scene, camera, P, D, terrH, surfaceAt, pushOut, kd, isTouch, EYE, village } = ctx;
  const touchIn = ctx.touchIn || { jx: 0, jy: 0 };
  const joyLen = () => Math.hypot(touchIn.jx, touchIn.jy);
  const isMoving = () => kd('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') || joyLen() > 0.2;
  const isRunning = () => kd('ShiftLeft', 'ShiftRight') || joyLen() > 0.92;
  const rnd = Math.random;
  const G = {
    on: false, bots: [], botCount: 50, difficulty: 1.0, primary: 'ak47',
    health: 100, weapon: 'ak47', lastWeapon: 'deagle', ammo: {}, reloading: 0, fireCd: 0, swapT: 0, heat: 0, scoped: false,
    kills: 0, deaths: 0, dead: 0, roundT: 300, roundOver: false, kick: 0, bob: 0, lastShot: -1, feed: [], hurt: 0, firing: false, fired: false, time: 0,
  };
  const resetAmmo = () => { for (const k in WEAPONS) G.ammo[k] = { mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve }; };
  resetAmmo();
  const group = new THREE.Group(); group.name = 'Arena'; group.visible = false; scene.add(group);

  // ------------------------------------------------------------------ materials
  const mat = (c, r = 0.8, m = 0.0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const M = {
    skin: mat(0xc9a27e), cloth: mat(0x2e2f33), cloth2: mat(0x3b3a30), vest: mat(0x4a4f3a), team: mat(0xa8322a), boot: mat(0x1c1a18),
    steel: mat(0x2b2d31, 0.45, 0.7), steelDark: mat(0x16171a, 0.5, 0.6), wood: mat(0x7a4a26, 0.6, 0.05), olive: mat(0x5c6a3f, 0.7), silver: mat(0xb9bcc2, 0.3, 0.9),
    rubber: mat(0x202020, 0.95), blade: mat(0xd5d8dc, 0.25, 0.95),
    flash: new THREE.SpriteMaterial({ color: 0xffe3a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.75 });
  const puffMat = new THREE.SpriteMaterial({ color: 0xd8cbb0, transparent: true, opacity: 0.8, depthWrite: false });
  const bloodMat = new THREE.SpriteMaterial({ color: 0x8a1b14, transparent: true, opacity: 0.85, depthWrite: false });

  // ------------------------------------------------------------------ weapon models (barrel along -Z, grip down)
  const box = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };
  const cylZ = (r1, r2, len, x, y, z, m, seg = 10) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, len, seg), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); return o; };
  function weaponModel(kind) {
    const g = new THREE.Group(); g.userData.muzzle = new THREE.Vector3(0, 0.03, -0.9);
    if (kind === 'ak47') {
      g.add(box(0.07, 0.11, 0.42, 0, 0, -0.1, M.steel));                                 // receiver
      g.add(box(0.075, 0.03, 0.42, 0, 0.07, -0.1, M.steel));                              // dust cover top
      g.add(box(0.07, 0.085, 0.3, 0, 0.01, -0.46, M.wood));                               // wooden handguard
      g.add(cylZ(0.012, 0.012, 0.5, 0, 0.035, -0.85, M.steelDark));                       // barrel
      g.add(cylZ(0.006, 0.006, 0.44, 0, -0.01, -0.82, M.steelDark));                      // gas tube / cleaning rod
      g.add(box(0.03, 0.08, 0.03, 0, 0.09, -1.02, M.steelDark));                          // front sight
      const magz = box(0.055, 0.26, 0.09, 0, -0.17, -0.16, M.steelDark); magz.rotation.x = 0.42; g.add(magz);   // curved magazine
      const grip = box(0.05, 0.14, 0.07, 0, -0.12, 0.08, M.wood); grip.rotation.x = 0.4; g.add(grip);
      g.add(box(0.06, 0.1, 0.34, 0, -0.03, 0.34, M.wood));                                // stock
      g.add(box(0.02, 0.02, 0.1, 0.04, 0.045, -0.02, M.steelDark));                       // charging handle
      g.userData.muzzle.set(0, 0.035, -1.1);
    } else if (kind === 'm4a1') {
      g.add(box(0.07, 0.11, 0.36, 0, 0, -0.08, M.steelDark));
      g.add(box(0.03, 0.07, 0.2, 0, 0.09, -0.02, M.steelDark));                            // carry handle
      g.add(cylZ(0.035, 0.035, 0.32, 0, 0.005, -0.42, M.steelDark, 8));                   // RIS handguard
      g.add(cylZ(0.011, 0.011, 0.42, 0, 0.03, -0.8, M.steelDark));                        // barrel
      g.add(cylZ(0.02, 0.02, 0.12, 0, 0.03, -1.0, M.steelDark));                          // silencer stub
      g.add(box(0.03, 0.07, 0.03, 0, 0.085, -0.6, M.steelDark));                          // front sight post
      const magz = box(0.055, 0.22, 0.07, 0, -0.15, -0.1, M.steelDark); magz.rotation.x = 0.15; g.add(magz);
      const grip = box(0.045, 0.13, 0.06, 0, -0.11, 0.1, M.rubber); grip.rotation.x = 0.35; g.add(grip);
      g.add(cylZ(0.022, 0.022, 0.22, 0, 0.01, 0.3, M.steelDark, 8));                      // buffer tube
      g.add(box(0.06, 0.1, 0.12, 0, -0.01, 0.38, M.steelDark));                           // telescoping stock
      g.userData.muzzle.set(0, 0.03, -1.07);
    } else if (kind === 'mp5') {
      g.add(box(0.065, 0.09, 0.34, 0, 0, -0.1, M.steelDark));
      g.add(cylZ(0.03, 0.03, 0.22, 0, 0.0, -0.4, M.rubber, 8));                           // handguard
      g.add(cylZ(0.009, 0.009, 0.2, 0, 0.025, -0.58, M.steelDark));
      g.add(cylZ(0.02, 0.02, 0.04, 0, 0.06, -0.58, M.steelDark));                         // front sight ring
      const magz = box(0.045, 0.24, 0.06, 0, -0.15, -0.18, M.steelDark); magz.rotation.x = 0.3; g.add(magz);
      const grip = box(0.045, 0.12, 0.06, 0, -0.1, 0.08, M.rubber); grip.rotation.x = 0.3; g.add(grip);
      g.add(box(0.05, 0.02, 0.26, 0, 0.0, 0.3, M.steelDark)); g.add(box(0.05, 0.1, 0.03, 0, -0.03, 0.42, M.rubber));   // collapsing stock
      g.userData.muzzle.set(0, 0.025, -0.7);
    } else if (kind === 'awp') {
      g.add(box(0.065, 0.1, 0.5, 0, 0, -0.1, M.olive));                                   // body
      g.add(box(0.06, 0.08, 0.3, 0, -0.01, -0.45, M.olive));                              // fore-end
      g.add(cylZ(0.013, 0.013, 0.62, 0, 0.03, -0.9, M.steelDark));                        // long barrel
      g.add(cylZ(0.022, 0.022, 0.08, 0, 0.03, -1.22, M.steelDark));                       // muzzle brake
      g.add(cylZ(0.03, 0.03, 0.3, 0, 0.1, -0.1, M.steelDark));                            // scope tube
      g.add(cylZ(0.04, 0.03, 0.07, 0, 0.1, -0.27, M.steelDark)); g.add(cylZ(0.03, 0.035, 0.07, 0, 0.1, 0.07, M.steelDark));
      g.add(box(0.02, 0.05, 0.03, 0, 0.065, -0.05, M.steelDark));                         // scope mount
      g.add(box(0.04, 0.14, 0.05, 0, -0.1, -0.12, M.steelDark));                          // magazine
      g.add(box(0.015, 0.015, 0.08, 0.05, 0.02, 0.0, M.steelDark));                       // bolt handle
      const grip = box(0.05, 0.12, 0.07, 0, -0.1, 0.12, M.olive); grip.rotation.x = 0.4; g.add(grip);
      g.add(box(0.06, 0.1, 0.32, 0, -0.02, 0.34, M.olive)); g.add(box(0.06, 0.04, 0.06, 0, -0.08, 0.5, M.rubber));   // stock + pad
      g.userData.muzzle.set(0, 0.03, -1.27);
    } else if (kind === 'deagle') {
      g.add(box(0.045, 0.06, 0.28, 0, 0.03, -0.08, M.silver));                            // slide
      g.add(box(0.04, 0.04, 0.26, 0, -0.01, -0.07, M.steelDark));                         // frame
      g.add(cylZ(0.009, 0.009, 0.06, 0, 0.035, -0.24, M.steelDark));
      g.add(box(0.015, 0.02, 0.02, 0, 0.07, -0.19, M.steelDark)); g.add(box(0.03, 0.02, 0.02, 0, 0.07, 0.04, M.steelDark));   // sights
      const grip = box(0.04, 0.13, 0.06, 0, -0.09, 0.05, M.rubber); grip.rotation.x = 0.32; g.add(grip);
      g.add(box(0.03, 0.03, 0.04, 0, -0.04, -0.04, M.steelDark));                         // trigger guard
      g.userData.muzzle.set(0, 0.035, -0.28);
    } else { // knife
      const blade = box(0.006, 0.035, 0.2, 0, 0.0, -0.17, M.blade); g.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.017, 0.07, 4), M.blade); tip.rotation.x = -Math.PI / 2; tip.position.set(0, 0, -0.3); g.add(tip);
      g.add(box(0.02, 0.05, 0.015, 0, 0, -0.065, M.steelDark));                           // guard
      g.add(box(0.025, 0.03, 0.12, 0, 0, 0.0, M.rubber));                                 // handle
      g.userData.muzzle.set(0, 0, -0.3);
    }
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
    return g;
  }
  const flashSprite = (size) => { const s = new THREE.Sprite(M.flash); s.scale.setScalar(size); s.visible = false; return s; };
  // bots are many (up to 100): every rigid part becomes ONE mesh with vertex colours, so a bot costs 7 draw calls
  const vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.15 });
  function bakeGeo(root) {
    root.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const gs = [];
    root.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      const c = o.material.color, n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); if (g.index) gs.push(g.toNonIndexed()); else gs.push(g);
    });
    return mergeGeometries(gs, false);
  }

  // ------------------------------------------------------------------ sound (synthesised)
  let ac = null;
  // death voice clip ("başaramadın abi") — fetched up front, decoded once the AudioContext exists
  const deathFetch = fetch(new URL('../audio/basaramadin.mp3', import.meta.url)).then(r => r.ok ? r.arrayBuffer() : null).catch(() => null);
  let deathDec = null;
  const getDeath = () => deathDec || (deathDec = deathFetch.then(a => a ? new Promise(res => ac.decodeAudioData(a, res, () => res(null))) : null));
  const playDeath = (buf) => { if (!buf || G.dead <= 0) return; const s = ac.createBufferSource(), g = ac.createGain(); s.buffer = buf; g.gain.value = 1; s.connect(g); g.connect(ac.destination); s.start(); };
  const noiseBufs = new Map();
  const sound = (kind, dist = 0, weapon = 'ak47') => {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      if (kind === 'death') { getDeath().then(playDeath); return; }
      getDeath();
      const t = ac.currentTime, att = 1 / (1 + dist / 30);
      const noise = (dur, cutoff, gain, decay = 2.5) => {
        // v1.0: one noise buffer per shape, made once (a 50-bot fight made a new buffer for every shot heard)
        const nk = dur + '|' + decay; let buf = noiseBufs.get(nk);
        if (!buf) { const len = Math.floor(ac.sampleRate * dur); buf = ac.createBuffer(1, len, ac.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); noiseBufs.set(nk, buf); }
        const n = ac.createBufferSource();
        n.buffer = buf; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; const g = ac.createGain(); g.gain.value = gain;
        n.connect(f); f.connect(g); g.connect(ac.destination); n.start(t);
      };
      const thump = (f0, f1, dur, gain) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.02); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + dur + 0.03); };
      if (kind === 'shot') {
        const w = weapon;
        if (w === 'awp') { noise(0.5, 1800, 0.7 * att, 1.8); thump(120, 30, 0.3, 0.4 * att); }
        else if (w === 'deagle') { noise(0.25, 2200, 0.6 * att, 2.2); thump(160, 40, 0.16, 0.35 * att); }
        else if (w === 'mp5') { noise(0.12, 3200, 0.35 * att, 3); thump(240, 70, 0.07, 0.15 * att); }
        else if (w === 'knife') { noise(0.08, 4000, 0.12, 4); }
        else { noise(0.18, 2600, 0.5 * att, 2.5); thump(190, 45, 0.11, 0.25 * att); }
      } else if (kind === 'hit') { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = 1500; g.gain.setValueAtTime(0.14, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.08); }
      else if (kind === 'headshot') { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(900, t); o.frequency.exponentialRampToValueAtTime(1800, t + 0.08); g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.16); }
      else if (kind === 'hurt') { thump(140, 60, 0.22, 0.3); noise(0.1, 900, 0.2, 3); }
      else if (kind === 'reload') { for (let i = 0; i < 2; i++) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = 800 + i * 400; g.gain.setValueAtTime(0.07, t + i * 0.55); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.55 + 0.05); o.connect(g); g.connect(ac.destination); o.start(t + i * 0.55); o.stop(t + i * 0.55 + 0.06); } }
      else if (kind === 'swap') { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = 600; g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.06); }
      else if (kind === 'whiz') { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(2200, t); o.frequency.exponentialRampToValueAtTime(600, t + 0.12); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.13); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.14); }
    } catch (e) { /* no audio */ }
  };

  // ------------------------------------------------------------------ world queries
  const B = D.buildings, WALL_H = 5.5;
  // v1.0: building boxes in a 20 m grid (a bullet trace tested every one of the 773 boxes at every step)
  const GC = 20, grid = new Map(), gkey = (i, j) => i * 65536 + j;
  for (let k = 0; k < B.length; k += 5) {
    const r = Math.hypot(B[k + 3], B[k + 4]);
    for (let i = Math.floor((B[k] - r) / GC); i <= Math.floor((B[k] + r) / GC); i++) for (let j = Math.floor((B[k + 1] - r) / GC); j <= Math.floor((B[k + 1] + r) / GC); j++) {
      const kk = gkey(i, j); let L = grid.get(kk); if (!L) grid.set(kk, L = []); L.push(k);
    }
  }
  const inBuilding = (x, y, z) => {
    const L = grid.get(gkey(Math.floor(x / GC), Math.floor(z / GC))); if (!L) return false;
    for (const k of L) {
      const dx = x - B[k], dz = z - B[k + 1];
      const c = Math.cos(B[k + 2]), s = Math.sin(B[k + 2]), lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < B[k + 3] && Math.abs(lz) < B[k + 4] && y < terrH(x, z) + WALL_H) return true;
    }
    return false;
  };
  const trace = (ax, ay, az, bx, by, bz, step = 1.5) => {
    const L = Math.hypot(bx - ax, by - ay, bz - az), n = Math.max(1, Math.ceil(L / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      if (y < terrH(x, z) || inBuilding(x, y, z)) return { t: t * L, x, y: Math.max(y, terrH(x, z)), z };
    }
    return null;
  };

  // ---- road graph for roaming: lanes of the layout, junctions = endpoints within 4 m of each other
  const lanes = (village && village.roads ? village.roads : []).filter(r => r.line && r.line.length > 1 && !/^d260/.test(r.id)).map(r => ({ id: r.id, line: r.line, w: r.w }));
  const nodes = [];   // { x, z, adj: [{ lane, end }] }
  const nodeAt = (x, z) => { for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < 4) return n; const n = { x, z, adj: [] }; nodes.push(n); return n; };
  for (const l of lanes) { l.n0 = nodeAt(l.line[0][0], l.line[0][1]); l.n1 = nodeAt(l.line[l.line.length - 1][0], l.line[l.line.length - 1][1]); l.n0.adj.push({ lane: l, end: 0 }); l.n1.adj.push({ lane: l, end: 1 }); }
  const villageLane = (l) => { const p = l.line[Math.floor(l.line.length / 2)]; return p[0] > -60 && p[0] < 760 && p[1] > -300 && p[1] < 780; };
  const roamLanes = lanes.filter(villageLane);
  const randomRoute = (near, minD, maxD) => {
    for (let tries = 0; tries < 300; tries++) {
      const l = roamLanes[Math.floor(rnd() * roamLanes.length)]; if (!l) break;
      const i = Math.floor(rnd() * l.line.length), p = l.line[i], d = Math.hypot(p[0] - near.x, p[1] - near.z);
      if (d < minD || d > maxD || surfaceAt(p[0], p[1]).water) continue;
      return { lane: l, i, dir: rnd() < 0.5 ? 1 : -1 };
    }
    return null;
  };
  // the player can hide; bots can also be made to roam a fallback: random road samples
  const roadPoint = (near, minD, maxD) => {
    const R = D.roads;
    for (let tries = 0; tries < 200; tries++) {
      const k = Math.floor(rnd() * (R.length / 4)) * 4, x = R[k], z = R[k + 1], d = Math.hypot(x - near.x, z - near.z);
      if (d < minD || d > maxD || x < -60 || x > 760 || z < -300 || z > 780 || surfaceAt(x, z).water) continue;
      return { x, z };
    }
    return { x: near.x + 50, z: near.z + 50 };
  };

  // ------------------------------------------------------------------ bots
  // v1.0: every bot part is an instance of one shared mesh (body, legs, arms, one gun model per weapon), so the
  // whole crowd costs ~7 draw calls instead of 6 per bot (50 bots: 300 → 7). Each bot keeps a light Object3D
  // skeleton that the pose code moves as before; after the update its world matrices are copied into the instances.
  const MAX_BOTS = 100, BOT_GUNS = ['ak47', 'm4a1', 'mp5', 'deagle'];
  const IM = (() => {
    const body = new THREE.Group();
    body.add(box(0.22, 0.1, 0.3, -0.13, 0.05, 0.02, M.boot), box(0.22, 0.1, 0.3, 0.13, 0.05, 0.02, M.boot));
    body.add(box(0.5, 0.6, 0.28, 0, 1.16, 0, M.cloth));                                   // torso
    body.add(box(0.44, 0.34, 0.32, 0, 1.22, 0, M.vest));                                   // vest
    body.add(box(0.54, 0.16, 0.34, 0, 1.5, 0, M.team));                                    // red scarf: the other team
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), M.skin); head.position.y = 1.72; body.add(head);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), M.cloth); mask.position.y = 1.735; body.add(mask);
    const leg = new THREE.Group(); const lm = box(0.2, 0.84, 0.24, 0, -0.42, 0, M.cloth2); leg.add(lm);   // pivot at the hip
    const arm = new THREE.Group(); arm.add(box(0.13, 0.56, 0.15, 0, -0.28, 0, M.cloth), box(0.11, 0.11, 0.11, 0, -0.58, 0, M.skin));
    const out = {};
    const mk = (name, geo, perBot) => {
      const im = new THREE.InstancedMesh(geo, vcMat, MAX_BOTS * perBot); im.count = 0; im.name = 'Bot_' + name;
      im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;   // bots don't cast: the shadow map is static (v1.0)
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(im); out[name] = im;
    };
    mk('body', bakeGeo(body), 1); mk('leg', bakeGeo(leg), 2); mk('arm', bakeGeo(arm), 2);
    for (const k of BOT_GUNS) mk(k, bakeGeo(weaponModel(k)), 1);
    return out;
  })();
  const MUZZLE = {}; for (const k of BOT_GUNS) MUZZLE[k] = weaponModel(k).userData.muzzle;
  const slot = (im) => { const o = new THREE.Object3D(); o.userData.im = im; return o; };
  function botMesh(weapon) {
    const g = new THREE.Group();
    const body = slot('body'); g.add(body);
    const l1 = slot('leg'), l2 = slot('leg'); l1.position.set(-0.13, 0.84, 0); l2.position.set(0.13, 0.84, 0); g.add(l1, l2);
    // arms pivot at the shoulder, hold the rifle in front
    const arm = (x) => { const a = new THREE.Group(); a.position.set(x, 1.42, 0); a.add(slot('arm')); return a; };
    const a1 = arm(-0.32), a2 = arm(0.32); g.add(a1, a2);
    const gun = new THREE.Group(); gun.add(slot(weapon)); gun.rotation.y = Math.PI; gun.scale.setScalar(0.95); gun.position.set(0.1, 1.28, 0.3); g.add(gun);
    const flash = flashSprite(0.5); gun.add(flash); flash.position.copy(MUZZLE[weapon]); g.userData.flash = flash;
    const parts = []; g.traverse(o => { if (o.userData.im) parts.push(o); });
    Object.assign(g.userData, { l1, l2, a1, a2, gun, parts });
    return g;
  }
  // copy the bots' part matrices into the instanced meshes (after the bots moved, before the frame is drawn)
  const _sph = new THREE.Sphere(), _frus = new THREE.Frustum(), _pv = new THREE.Matrix4();
  function syncBotInstances() {
    for (const k in IM) IM[k].count = 0;
    camera.updateMatrixWorld(); _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frus.setFromProjectionMatrix(_pv);
    for (const b of G.bots) {
      _sph.center.set(b.x, b.y + 1, b.z); _sph.radius = 1.6;
      if (!_frus.intersectsSphere(_sph)) continue;   // off screen: not drawn at all
      b.mesh.updateMatrixWorld(true);
      for (const o of b.mesh.userData.parts) { const im = IM[o.userData.im]; im.setMatrixAt(im.count++, o.matrixWorld); }
    }
    for (const k in IM) { const im = IM[k]; im.visible = im.count > 0; if (im.count) im.instanceMatrix.needsUpdate = true; }
  }
  function spawnBot(i) {
    const kinds = ['ak47', 'ak47', 'm4a1', 'mp5', 'mp5', 'ak47', 'deagle', 'm4a1'];
    const weapon = kinds[Math.floor(rnd() * kinds.length)], W = WEAPONS[weapon];
    const p = roadPoint(P, 70, 260);
    const b = { id: i, name: botName(i), weapon, x: p.x, z: p.z, y: surfaceAt(p.x, p.z).y, yaw: rnd() * 6.28, hp: 100,
      state: 'patrol', route: null, pauseT: 0, lookYaw: 0, speedK: 0.85 + rnd() * 0.3, lateral: (rnd() - 0.5) * 2.4,
      seen: 0, lastSeen: null, hasLos: false, losT: rnd() * 0.3, aimT: 0, reaction: 0.3 + rnd() * 0.4,
      mag: W.mag, burst: 0, cd: 1 + rnd(), reloadT: 0, walk: 0, stuck: 0, lastX: p.x, lastZ: p.z, dead: 0, flee: 0, side: 1, sideT: 0, crouch: 0,
      mesh: botMesh(weapon), flashT: 0 };
    b.mesh.position.set(b.x, b.y, b.z); group.add(b.mesh);
    return b;
  }
  function killBot(b, head) {
    b.dead = 6; b.state = 'dead'; b.hp = 0; G.kills++; feed(`${b.name} ${head ? 'kafadan vuruldu' : 'vuruldu'} — ${WEAPONS[G.weapon].name}`); sound(head ? 'headshot' : 'hit');
  }
  function respawnBot(b) {
    const p = roadPoint(P, 90, 280); b.x = p.x; b.z = p.z; b.y = surfaceAt(p.x, p.z).y; b.hp = 100; b.state = 'patrol'; b.route = null; b.dead = 0; b.flee = 0; b.crouch = 0; b.mag = WEAPONS[b.weapon].mag; b.reloadT = 0;
    b.mesh.rotation.set(0, b.yaw, 0); b.mesh.position.set(b.x, b.y, b.z); b.cd = 1.5; b.hasLos = false; b.seen = 0;
  }
  function alertBot(b, x, z) { if (b.dead > 0) return; b.lastSeen = { x, z }; b.seen = Math.max(b.seen, 6); if (b.state === 'patrol') b.state = 'search'; }
  function moveBot(b, tx, tz, speed, dt) {
    const ddx = tx - b.x, ddz = tz - b.z, L = Math.hypot(ddx, ddz) || 1;
    if (L < 0.4) return true;
    const nx = b.x + ddx / L * speed * dt, nz = b.z + ddz / L * speed * dt, q = { x: nx, z: nz };
    pushOut(q, 0.4);
    const g = surfaceAt(q.x, q.z, b.y + 0.5);
    if (!g.water && g.y - b.y < 1.2) { b.x = q.x; b.z = q.z; b.y += (g.y - b.y) * Math.min(1, dt * 10); }
    b.walk += speed * dt;
    return L < speed * dt * 1.5;
  }
  const turnTo = (b, want, dt, k = 6) => { let dy = want - b.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; b.yaw += dy * Math.min(1, dt * k); };
  function botStep(b, dt) {
    const u = b.mesh.userData, W = WEAPONS[b.weapon];
    if (b.dead > 0) {   // falls over, lies for a while, respawns
      b.dead -= dt; const k = Math.min(1, (6 - b.dead) / 0.45);
      b.mesh.rotation.x = -Math.PI / 2 * k; b.mesh.position.y = b.y + 0.15 * k; b.mesh.rotation.z = 0;
      if (b.dead <= 0) respawnBot(b);
      return;
    }
    const ex = P.x, ez = P.z, dx = ex - b.x, dz = ez - b.z, dist = Math.hypot(dx, dz);
    // far bots think ~10 times a second instead of every frame (100 bots)
    if (dist > 180) { b.acc = (b.acc || 0) + dt; if (b.acc < 0.1) return; dt = b.acc; b.acc = 0; }
    // ---- perception: line of sight a few times a second
    b.losT -= dt;
    if (b.losT <= 0) {
      b.losT = 0.22 + rnd() * 0.15;
      const saw = b.hasLos;
      b.hasLos = dist < 120 && G.dead <= 0 && !trace(b.x, b.y + 1.6, b.z, ex, P.y + EYE - 0.2, ez, 2.0);
      if (b.hasLos) { b.lastSeen = { x: ex, z: ez }; b.seen = 6; if (!saw) b.aimT = 0; }
    }
    b.seen -= dt; if (b.hasLos) b.aimT += dt;
    // ---- state
    if (b.flee > 0) { b.flee -= dt; b.state = 'flee'; }
    else if (b.reloadT > 0) b.state = 'reload';
    else if (b.hasLos) b.state = dist < 12 ? 'close' : dist < 32 ? 'hold' : 'chase';
    else if (b.seen > 0 && b.lastSeen) b.state = 'search';
    else if (b.state !== 'patrol') { b.state = 'patrol'; b.route = null; }
    if (b.hp < 40 && b.hasLos && b.flee <= 0 && rnd() < dt * 0.8) { b.flee = 3 + rnd() * 2; b.state = 'flee'; }
    // ---- movement
    let moving = false, speed = 3.4 * b.speedK;
    if (b.state === 'patrol') {
      if (b.pauseT > 0) { b.pauseT -= dt; turnTo(b, b.lookYaw, dt, 1.5); }   // stops now and then and looks around
      else {
        if (!b.route) b.route = randomRoute(b, 0, 60) || randomRoute(b, 0, 400);
        if (b.route) {
          const r = b.route, line = r.lane.line, p = line[Math.max(0, Math.min(line.length - 1, r.i))];
          // walk a little off the centreline, each bot on its own side
          const q = line[Math.max(0, Math.min(line.length - 1, r.i + r.dir))], tx = q[0] - p[0], tz = q[1] - p[1], L = Math.hypot(tx, tz) || 1;
          const gx = p[0] - tz / L * b.lateral, gz = p[1] + tx / L * b.lateral;
          const arrived = moveBot(b, gx, gz, 2.4 * b.speedK, dt) || Math.hypot(gx - b.x, gz - b.z) < 1.6;
          moving = true; turnTo(b, Math.atan2(gx - b.x, gz - b.z), dt, 4);
          if (arrived) {
            r.i += r.dir;
            if (r.i < 0 || r.i >= line.length) {   // at a junction: pick another lane, a dead end turns round
              const node = r.dir > 0 ? r.lane.n1 : r.lane.n0, options = node.adj.filter(a => a.lane !== r.lane && villageLane(a.lane));
              if (options.length && rnd() < 0.9) { const a = options[Math.floor(rnd() * options.length)]; b.route = { lane: a.lane, i: a.end === 0 ? 0 : a.lane.line.length - 1, dir: a.end === 0 ? 1 : -1 }; }
              else { r.dir = -r.dir; r.i += r.dir; }
              if (rnd() < 0.3) { b.pauseT = 1 + rnd() * 2.5; b.lookYaw = b.yaw + (rnd() - 0.5) * 2.5; }
            }
          }
        } else { const t = roadPoint(b, 20, 120); moveBot(b, t.x, t.z, 2.4, dt); moving = true; }
        if (rnd() < dt * 0.04) { b.pauseT = 1 + rnd() * 2; b.lookYaw = b.yaw + (rnd() - 0.5) * 3; }
      }
    } else if (b.state === 'chase') {
      // run-and-gun towards the player, short sprints then a stop to aim
      b.sideT -= dt; if (b.sideT <= 0) { b.sideT = 1.2 + rnd() * 1.5; b.side = rnd() < 0.5 ? -1 : 1; b.pauseT = rnd() < 0.35 ? 0.6 + rnd() * 0.6 : 0; }
      if (b.pauseT > 0) b.pauseT -= dt; else { moveBot(b, ex + (-dz / dist) * b.side * 4, ez + (dx / dist) * b.side * 4, 4.3 * b.speedK, dt); moving = true; }
    } else if (b.state === 'hold') {
      // strafe at mid range, change direction every couple of seconds
      b.sideT -= dt; if (b.sideT <= 0) { b.sideT = 0.8 + rnd() * 1.4; b.side = rnd() < 0.5 ? -1 : 1; b.crouch = rnd() < 0.3 ? 1 : 0; }
      if (!b.crouch) { moveBot(b, b.x + (-dz / dist) * b.side * 3 + dx / dist * 0.3, b.z + (dx / dist) * b.side * 3 + dz / dist * 0.3, 2.6 * b.speedK, dt); moving = true; }
    } else if (b.state === 'close') {
      // too close: back off while firing
      moveBot(b, b.x - dx / dist * 3 + (-dz / dist) * b.side * 2, b.z - dz / dist * 3 + (dx / dist) * b.side * 2, 3.0, dt); moving = true;
    } else if (b.state === 'search') {
      const arrived = moveBot(b, b.lastSeen.x, b.lastSeen.z, 3.8 * b.speedK, dt); moving = true; turnTo(b, Math.atan2(b.lastSeen.x - b.x, b.lastSeen.z - b.z), dt, 5);
      if (arrived || Math.hypot(b.lastSeen.x - b.x, b.lastSeen.z - b.z) < 2.5) { b.seen = Math.min(b.seen, 1.5); b.lookYaw = b.yaw + (rnd() - 0.5) * 4; turnTo(b, b.lookYaw, dt, 2); }
    } else if (b.state === 'flee' || b.state === 'reload') {
      // away from the player, towards the nearest spot without line of sight
      const away = Math.atan2(-dx, -dz) + Math.sin(G.time * 0.7 + b.id) * 0.8;
      moveBot(b, b.x + Math.sin(away) * 6, b.z + Math.cos(away) * 6, 4.0 * b.speedK, dt); moving = true; turnTo(b, away, dt, 5);
    }
    if (b.hasLos && b.state !== 'flee' && b.state !== 'reload') turnTo(b, Math.atan2(dx, dz), dt, 10);
    // stuck: no progress for a second → new route / side
    b.stuck += dt;
    if (b.stuck > 1) { if (moving && Math.hypot(b.x - b.lastX, b.z - b.lastZ) < 0.5) { b.route = null; b.side = -b.side; b.pauseT = 0; } b.lastX = b.x; b.lastZ = b.z; b.stuck = 0; }
    // ---- weapon
    b.cd -= dt; b.flashT -= dt;
    if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) b.mag = W.mag; }
    else if (b.mag <= 0) { b.reloadT = W.reload + 0.4; b.burst = 0; }
    else if (b.hasLos && b.aimT > b.reaction && G.dead <= 0 && !G.roundOver && b.state !== 'flee' && b.cd <= 0) {
      if (b.burst <= 0) b.burst = W.auto ? (b.state === 'chase' ? 2 + Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 4)) : 1;
      b.burst--; b.mag--; b.cd = b.burst > 0 ? 1 / W.rate : (W.auto ? 0.5 + rnd() * 0.9 : 0.4 + rnd() * 0.5);
      b.flashT = 0.05; sound('shot', dist, b.weapon);
      const playerMoving = kd('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');
      let p = W.botAcc * G.difficulty * Math.max(0.25, 1 - dist / 170);
      if (playerMoving) p *= 0.65; if (moving) p *= 0.7; if (b.crouch) p *= 1.2; if (b.aimT < b.reaction + 0.4) p *= 1.15;
      const muzzle = new THREE.Vector3(); u.flash.getWorldPosition(muzzle);
      if (rnd() < Math.min(0.85, p)) {
        const falloff = Math.max(0.6, 1 - dist / 400), dmg = Math.round(W.dmg * falloff * (0.85 + rnd() * 0.3));
        hurtPlayer(dmg, b); tracer(muzzle, new THREE.Vector3(ex + (rnd() - 0.5) * 0.3, P.y + EYE - 0.3 + (rnd() - 0.5) * 0.4, ez + (rnd() - 0.5) * 0.3));
      } else {
        // a miss: the round passes close by and hits the ground or a wall behind
        const dir = new THREE.Vector3(ex - muzzle.x + (rnd() - 0.5) * 3, P.y + EYE - 0.3 - muzzle.y + (rnd() - 0.5) * 2, ez - muzzle.z + (rnd() - 0.5) * 3).normalize();
        const far = muzzle.clone().addScaledVector(dir, 120), w = trace(muzzle.x, muzzle.y, muzzle.z, far.x, far.y, far.z, 2.0), end = w ? new THREE.Vector3(w.x, w.y, w.z) : far;
        tracer(muzzle, end); if (w) puff(w.x, w.y, w.z, 0.5); if (dist < 40) sound('whiz');
      }
    }
    // ---- pose
    const sw = Math.sin(b.walk * 2.4) * (moving ? 0.6 : 0);
    u.l1.rotation.x = sw; u.l2.rotation.x = -sw;
    const aim = b.hasLos || b.state === 'search' ? 1 : 0;
    const armX = -1.25 - aim * 0.25, armSpread = aim ? 0.0 : 0.15;
    u.a1.rotation.x += (armX - u.a1.rotation.x) * Math.min(1, dt * 8); u.a2.rotation.x += (armX - u.a2.rotation.x) * Math.min(1, dt * 8); u.a1.rotation.z = armSpread; u.a2.rotation.z = -armSpread;
    u.gun.rotation.x += ((aim ? 0 : 0.35) - u.gun.rotation.x) * Math.min(1, dt * 8); u.gun.position.y = 1.28 - (aim ? 0 : 0.06);
    const crouchK = b.crouch && b.state === 'hold' ? 0.75 : 1; b.mesh.scale.y += (crouchK - b.mesh.scale.y) * Math.min(1, dt * 6);
    u.flash.visible = b.flashT > 0; if (u.flash.visible) u.flash.scale.setScalar(0.35 + rnd() * 0.3);
    b.mesh.position.set(b.x, b.y + (moving ? Math.abs(Math.sin(b.walk * 2.4)) * 0.03 : 0), b.z); b.mesh.rotation.set(0, b.yaw, 0);
  }

  // ------------------------------------------------------------------ player weapons
  const vm = new THREE.Group();   // view model holder, child of the camera
  const models = {}; for (const k in WEAPONS) { models[k] = weaponModel(k); models[k].visible = false; vm.add(models[k]); }
  const vmFlash = flashSprite(0.35); vm.add(vmFlash);
  const REST = { ak47: [0.26, -0.24, -0.5], m4a1: [0.26, -0.24, -0.5], mp5: [0.24, -0.22, -0.42], awp: [0.24, -0.25, -0.5], deagle: [0.2, -0.23, -0.56], knife: [0.22, -0.22, -0.4] };
  function setWeapon(k) {
    if (k === G.weapon || G.dead > 0) return;
    G.lastWeapon = G.weapon; G.weapon = k; G.swapT = 0.45; G.reloading = 0; G.heat = 0; setScope(false); sound('swap');
    for (const m in models) models[m].visible = m === k;
  }
  function setScope(on) {
    if (on === G.scoped) return;
    G.scoped = on; camera.fov = on ? 14 : 55; camera.updateProjectionMatrix(); el('ghScope').style.display = on ? 'block' : 'none'; vm.visible = !on; scopeBtn.classList.toggle('on', on);
  }
  const fx = [];
  // v1.0: tracers and puffs come from small pools (they used to allocate a geometry and clone a material per shot)
  const tracerPool = [], puffPool = [];
  function tracer(a, b) {
    let l = tracerPool.pop();
    if (!l) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3)); l = new THREE.Line(g, tracerMat); l.frustumCulled = false; l.userData.pool = tracerPool; }
    const p = l.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
    group.add(l); fx.push({ obj: l, t: 0.05 });
  }
  function puff(x, y, z, size = 0.6, m = puffMat) {
    let s = puffPool.pop(); if (!s) { s = new THREE.Sprite(m.clone()); s.userData.pool = puffPool; }
    s.material.color.copy(m.color); s.material.opacity = m.opacity;
    s.position.set(x, y, z); s.scale.setScalar(size); group.add(s); fx.push({ obj: s, t: 0.35, grow: true });
  }
  function fire() {
    const W = WEAPONS[G.weapon], A = G.ammo[G.weapon];
    if (G.dead > 0 || G.roundOver || G.reloading > 0 || G.fireCd > 0 || G.swapT > 0) return;
    if (!W.auto && G.fired) return;   // semi-automatic: one shot per click
    if (!W.melee && A.mag <= 0) { reload(); return; }
    if (!W.melee) A.mag--;
    G.fired = true; G.fireCd = 1 / W.rate; G.kick = 1; G.lastShot = G.time; sound('shot', 0, G.weapon);
    if (!W.melee) { vmFlash.visible = true; vmFlash.position.copy(models[G.weapon].userData.muzzle).add(models[G.weapon].position); vmFlash.scale.setScalar(0.25 + rnd() * 0.25); }
    // camera kick (recoil): up and a little sideways, the AK climbs
    P.pitch += W.kick * Math.PI / 180 * (0.7 + rnd() * 0.5); P.yaw += (rnd() - 0.5) * W.kick * Math.PI / 180 * 0.5;
    // direction with spread: standing / moving / scoped, plus heat from holding the trigger
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const moving = isMoving();
    let spread = (moving ? W.moveSpread : W.spread) + G.heat; if (W.scope && !G.scoped) spread = 0.08;
    const right = new THREE.Vector3().crossVectors(dir, camera.up).normalize(), up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const r = Math.sqrt(rnd()) * spread, a = rnd() * Math.PI * 2;
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    G.heat = Math.min(W.climb * 8, G.heat + W.climb);
    const o = camera.position.clone();
    let best = null;
    for (const b of G.bots) {
      if (b.dead > 0) continue;
      for (const [cy, rad, head] of [[1.05, 0.4, false], [1.72, 0.22, true]]) {
        const c = new THREE.Vector3(b.x, b.y + cy * b.mesh.scale.y, b.z), oc = c.clone().sub(o), t = oc.dot(dir);
        if (t < 0 || t > W.range) continue;
        if (oc.lengthSq() - t * t < rad * rad && (!best || t < best.t)) best = { t, b, head };
      }
    }
    const end = o.clone().addScaledVector(dir, best ? best.t : W.range);
    const wall = trace(o.x, o.y, o.z, end.x, end.y, end.z, 1.0);
    if (wall) { end.set(wall.x, wall.y, wall.z); if (!W.melee) puff(wall.x, wall.y, wall.z); best = null; }
    else if (best) {
      const falloff = W.melee ? 1 : Math.max(0.5, 1 - best.t / 500), dmg = Math.round(W.dmg * falloff * (best.head ? W.head : 1) * (0.9 + rnd() * 0.2));
      best.b.hp -= dmg; puff(end.x, end.y, end.z, 0.45, bloodMat); sound(best.head ? 'headshot' : 'hit');
      if (best.b.hp <= 0) killBot(best.b, best.head); else { alertBot(best.b, P.x, P.z); best.b.hasLos = true; best.b.seen = 6; best.b.aimT = best.b.reaction; }
    }
    if (!W.melee) { const muzzle = new THREE.Vector3().copy(models[G.weapon].userData.muzzle).add(models[G.weapon].position).applyMatrix4(camera.matrixWorld); tracer(muzzle, end); }
    // bots within earshot turn towards the gunfire
    if (!W.melee) for (const b of G.bots) { if (b.dead <= 0 && !b.hasLos && Math.hypot(b.x - P.x, b.z - P.z) < (G.weapon === 'awp' ? 160 : 90) && rnd() < 0.7) alertBot(b, P.x + (rnd() - 0.5) * 8, P.z + (rnd() - 0.5) * 8); }
  }
  function reload() {
    const W = WEAPONS[G.weapon], A = G.ammo[G.weapon];
    if (W.melee || G.reloading > 0 || A.mag >= W.mag || A.reserve <= 0 || G.dead > 0) return;
    G.reloading = W.reload; setScope(false); sound('reload');
  }
  function hurtPlayer(dmg, from) {
    if (G.dead > 0) return;
    G.health -= dmg; G.hurt = 1;
    if (G.health > 0) sound('hurt');
    else { G.health = 0; G.dead = 3.5; G.deaths++; setScope(false); sound('death'); feed(`${from.name} seni vurdu — ${WEAPONS[from.weapon].name}`); }
  }
  function respawnPlayer() {
    const [sx, sz] = D.spawn.walk; P.x = sx; P.z = sz; P.y = surfaceAt(sx, sz).y; P.vy = 0; G.health = 100; resetAmmo(); G.reloading = 0; G.heat = 0;
    G.weapon = G.primary; G.lastWeapon = 'deagle'; for (const m in models) models[m].visible = m === G.weapon; G.swapT = 0.3;
  }
  function feed(msg) { G.feed.unshift({ msg, t: 5 }); if (G.feed.length > 5) G.feed.pop(); }

  // ------------------------------------------------------------------ HUD
  const hud = document.createElement('div'); hud.id = 'gameHud'; hud.innerHTML = `
    <div class="gh-top"><span id="ghScore">0 : 0</span><span id="ghTime">5:00</span></div>
    <div class="gh-feed" id="ghFeed"></div>
    <div class="gh-health"><div class="gh-bar"><i id="ghHp"></i></div><b id="ghHpTxt">100</b></div>
    <div class="gh-ammo"><small id="ghWpn">AK-47</small><div><b id="ghMag">30</b><span id="ghRes">/ 90</span></div><em id="ghRel"></em></div>
    <div class="gh-slots" id="ghSlots"></div>
    <div class="gh-scope" id="ghScope"><i></i></div>
    <div class="gh-hurt" id="ghHurt"></div>
    <div class="gh-dead" id="ghDead"><div><b>BAŞARAMADIN ABİ</b><span id="ghDeadTxt">yeniden doğuyorsun…</span></div></div>
    <div class="gh-end" id="ghEnd"><div><b>TUR BİTTİ</b><span id="ghEndTxt"></span><small>${isTouch ? 'Dokun: yeni tur' : 'Enter: yeni tur'}</small></div></div>`;
  document.body.appendChild(hud);
  const el = (id) => document.getElementById(id);
  const mkBtn = (id, label, cls) => { const d = document.createElement('div'); d.className = 'tc pad ' + cls; d.id = id; d.textContent = label; document.body.appendChild(d); return d; };
  const fireBtn = mkBtn('tFire', 'FIRE', ''), reloadBtn = mkBtn('tReload', 'RELOAD', 'gbtn'), jumpBtn = mkBtn('tJump', 'JUMP', 'gbtn'), scopeBtn = mkBtn('tScope', 'SCOPE', 'gbtn');
  const touchBtns = [fireBtn, reloadBtn, jumpBtn, scopeBtn];
  // FIRE: hold to shoot, and drag the thumb on it to aim at the same time (like mobile shooters)
  let fireId = null, fx0 = 0, fy0 = 0;
  const fireUp = e => { if (e.pointerId !== fireId) return; fireId = null; G.firing = false; G.fired = false; fireBtn.classList.remove('down'); };
  fireBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (fireId !== null) return; fireId = e.pointerId; fx0 = e.clientX; fy0 = e.clientY; try { fireBtn.setPointerCapture(e.pointerId); } catch (_) {} G.firing = true; G.fired = false; fireBtn.classList.add('down'); });
  fireBtn.addEventListener('pointermove', e => { if (e.pointerId !== fireId) return; const dx = e.clientX - fx0, dy = e.clientY - fy0; fx0 = e.clientX; fy0 = e.clientY; const k = 0.005 * camera.fov / 55; P.yaw -= dx * k; P.pitch = Math.max(-1.45, Math.min(1.45, P.pitch - dy * k)); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) fireBtn.addEventListener(ev, fireUp);
  const tap = (b, fn) => b.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fn(); b.classList.add('down'); setTimeout(() => b.classList.remove('down'), 140); });
  tap(reloadBtn, () => reload());
  tap(scopeBtn, () => { if (WEAPONS[G.weapon].scope && G.reloading <= 0 && G.dead <= 0) setScope(!G.scoped); });
  jumpBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); touchIn.jump = true; jumpBtn.classList.add('down'); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jumpBtn.addEventListener(ev, () => { touchIn.jump = false; jumpBtn.classList.remove('down'); });
  // tap a weapon in the slot list to switch to it; tap the round-over screen for a new round
  el('ghSlots').addEventListener('pointerdown', e => { const t = e.target.closest('[data-w]'); if (!t || !G.on) return; e.stopPropagation(); e.preventDefault(); setWeapon(t.dataset.w); });
  el('ghEnd').addEventListener('click', () => { if (G.on && G.roundOver) newRound(); });
  const cross = document.getElementById('cross');
  let slotsHtml = '';
  // v1.0: the HUD is written only where a value changed (it rewrote ~15 DOM properties and the kill feed every frame)
  const hudCache = new Map();
  const setText = (id, v) => { const k = id + ':t'; if (hudCache.get(k) !== v) { hudCache.set(k, v); el(id).textContent = v; } };
  const setStyle = (id, prop, v) => { const k = id + ':' + prop; if (hudCache.get(k) !== v) { hudCache.set(k, v); el(id).style[prop] = v; } };
  function updateHud() {
    const W = WEAPONS[G.weapon], A = G.ammo[G.weapon];
    setText('ghScore', `${G.kills} : ${G.deaths}`);
    const t = Math.max(0, Math.ceil(G.roundT)); setText('ghTime', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    setStyle('ghHp', 'width', `${G.health}%`); setStyle('ghHp', 'background', G.health > 50 ? '#7cc26b' : G.health > 25 ? '#e0b24a' : '#d14b3a'); setText('ghHpTxt', String(G.health));
    setText('ghWpn', W.name); setText('ghMag', W.melee ? '—' : String(A.mag)); setText('ghRes', W.melee ? '' : `/ ${A.reserve}`);
    setText('ghRel', G.reloading > 0 ? 'reloading' : (!W.melee && A.mag === 0 ? 'R: reload' : ''));
    const sh = [G.primary, 'deagle', 'knife'].map((k, i) => `<span data-w="${k}" class="${k === G.weapon ? 'on' : ''}">${isTouch ? '' : (i + 1) + ' '}${WEAPONS[k].name}</span>`).join('');
    if (sh !== slotsHtml) { el('ghSlots').innerHTML = sh; slotsHtml = sh; }
    if (isTouch && hudCache.get('scope') !== !!W.scope) { hudCache.set('scope', !!W.scope); scopeBtn.classList.toggle('show', !!W.scope); }
    // crosshair: hidden behind the scope or while dead; the gap opens with the real spread (moving, holding the trigger)
    if (cross) {
      const off = G.scoped || G.dead > 0 || G.roundOver; if (hudCache.get('crossOff') !== off) { hudCache.set('crossOff', off); cross.classList.toggle('off', off); }
      const sp = W.melee ? 0 : (W.scope && !G.scoped ? 0.08 : (isMoving() ? W.moveSpread : W.spread) + G.heat);
      const gap = 3 + Math.min(60, Math.tan(sp) / Math.tan(camera.fov * Math.PI / 360) * innerHeight / 2);
      const gs = gap.toFixed(1) + 'px'; if (hudCache.get('gap') !== gs) { hudCache.set('gap', gs); cross.style.setProperty('--gap', gs); }
    }
    const fh = G.feed.map(f => `<div style="opacity:${Math.min(1, f.t / 1.5).toFixed(1)}">${f.msg}</div>`).join('');
    if (hudCache.get('feed') !== fh) { hudCache.set('feed', fh); el('ghFeed').innerHTML = fh; }
    setStyle('ghHurt', 'opacity', (G.hurt * 0.55).toFixed(2));
    setStyle('ghDead', 'display', G.dead > 0 ? 'grid' : 'none'); if (G.dead > 0) setText('ghDeadTxt', `yeniden doğuyorsun… ${Math.ceil(G.dead)}`);
    setStyle('ghEnd', 'display', G.roundOver ? 'grid' : 'none');
  }

  // ------------------------------------------------------------------ lifecycle
  function start() {
    G.on = true; group.visible = true; hud.style.display = 'block';
    if (isTouch) for (const b of [fireBtn, reloadBtn, jumpBtn]) b.classList.add('show');
    if (!camera.parent) scene.add(camera);
    camera.add(vm);
    if (!G.bots.length) for (let i = 0; i < G.botCount; i++) G.bots.push(spawnBot(i));
    newRound();
  }
  function newRound() {
    G.kills = 0; G.deaths = 0; G.roundT = 300; G.roundOver = false; G.dead = 0; G.feed = []; respawnPlayer();
    for (const b of G.bots) respawnBot(b);
  }
  function stop() {
    G.on = false; group.visible = false; hud.style.display = 'none'; for (const b of touchBtns) b.classList.remove('show'); setScope(false); camera.remove(vm); G.firing = false; fireId = null; touchIn.jump = false; if (cross) { cross.classList.remove('off'); cross.style.removeProperty('--gap'); } hudCache.clear();
  }
  function setBots(n) { G.botCount = n; while (G.bots.length > n) { const b = G.bots.pop(); group.remove(b.mesh); } while (G.bots.length < n) G.bots.push(spawnBot(G.bots.length)); }
  function setPrimary(k) { if (!WEAPONS[k] || WEAPONS[k].slot !== 1) return; G.primary = k; if (G.on) { G.ammo[k] = { mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve }; setWeapon(k); } }
  function setDifficulty(d) { G.difficulty = d; }
  function cycleWeapon(dir) { const order = [G.primary, 'deagle', 'knife'], i = order.indexOf(G.weapon); setWeapon(order[(i + dir + 3) % 3]); }
  function update(dt, now) {
    if (!G.on) return;
    G.time += dt;
    if (!G.roundOver) { G.roundT -= dt; if (G.roundT <= 0) { G.roundOver = true; el('ghEndTxt').textContent = `${G.kills} vuruş · ${G.deaths} ölüm`; setScope(false); } }
    if (G.dead > 0) { G.dead -= dt; if (G.dead <= 0) respawnPlayer(); }
    G.hurt = Math.max(0, G.hurt - dt * 1.6); G.fireCd = Math.max(0, G.fireCd - dt); G.swapT = Math.max(0, G.swapT - dt); G.heat = Math.max(0, G.heat - dt * 0.02);
    const W = WEAPONS[G.weapon], A = G.ammo[G.weapon];
    if (G.reloading > 0) { G.reloading -= dt; if (G.reloading <= 0) { const need = W.mag - A.mag, take = Math.min(need, A.reserve); A.mag += take; A.reserve -= take; G.reloading = 0; } }
    if (G.firing && G.dead <= 0) fire();
    for (const f of G.feed) f.t -= dt; G.feed = G.feed.filter(f => f.t > 0);
    for (const b of G.bots) botStep(b, dt);
    // view model: bob while walking, kick on firing, lowered while reloading / swapping
    const moving = isMoving();
    G.bob += dt * (moving ? (isRunning() ? 11 : 7) : 2);
    G.kick = Math.max(0, G.kick - dt * 9);
    const rel = G.reloading > 0 ? Math.sin(Math.min(Math.PI, (W.reload - G.reloading) / W.reload * Math.PI)) : 0, swap = G.swapT / 0.45;
    const [rx, ry, rz] = REST[G.weapon];
    vm.position.set(rx + Math.sin(G.bob) * 0.007 * (moving ? 1 : 0.3), ry + Math.abs(Math.cos(G.bob)) * 0.009 * (moving ? 1 : 0.3) - rel * 0.14 - swap * 0.35, rz + G.kick * 0.07 * W.kick);
    vm.rotation.set(0.02 - G.kick * 0.1 * W.kick + rel * 0.55 + swap * 0.6, 0.06 + (G.weapon === 'knife' ? -0.5 : 0) + G.kick * (G.weapon === 'knife' ? -0.8 : 0), rel * 0.2);
    vmFlash.visible = G.time - G.lastShot < 0.035 && !W.melee;
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t -= dt; if (f.grow) { f.obj.scale.multiplyScalar(1 + dt * 4); f.obj.material.opacity = Math.max(0, f.t * 2); } if (f.t <= 0) { group.remove(f.obj); f.obj.userData.pool.push(f.obj); fx.splice(i, 1); } }
    syncBotInstances();
    updateHud();
  }
  /** bots on the minimap: red dots, only within 60 m (no wallhack radar) */
  function drawMinimap(mctx, toPx) {
    for (const b of G.bots) { if (b.dead > 0 || Math.hypot(b.x - P.x, b.z - P.z) > 60) continue; const [u, v] = toPx(b.x, b.z); mctx.fillStyle = '#d13b2a'; mctx.beginPath(); mctx.arc(u, v, 3, 0, 6.283); mctx.fill(); }
  }
  // ------------------------------------------------------------------ input
  addEventListener('mousedown', e => { if (!G.on || !document.pointerLockElement) return; if (e.button === 0) { G.firing = true; G.fired = false; } if (e.button === 2 && WEAPONS[G.weapon].scope) setScope(!G.scoped); });
  addEventListener('mouseup', e => { if (e.button === 0) { G.firing = false; G.fired = false; } });
  addEventListener('contextmenu', e => { if (G.on && document.pointerLockElement) e.preventDefault(); });
  addEventListener('wheel', e => { if (G.on && document.pointerLockElement) cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
  addEventListener('keydown', e => {
    if (!G.on) return;
    if (e.code === 'KeyR') reload();
    if (e.code === 'Digit1') setWeapon(G.primary); if (e.code === 'Digit2') setWeapon('deagle'); if (e.code === 'Digit3') setWeapon('knife');
    if (e.code === 'KeyQ') setWeapon(G.lastWeapon);
    if (e.code === 'Enter' && G.roundOver) newRound();
  });

  return { start, stop, update, drawMinimap, setBots, setPrimary, setDifficulty, fire, reload, setWeapon, state: G, newRound, WEAPONS };
}
