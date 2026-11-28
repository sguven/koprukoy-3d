// Köprüköy Arena — a Counter-Strike 1.5-style deathmatch against bots, played in the real village with the walk
// controls (v0.9.6 / v0.9.7). Low-poly on purpose: the point is the village as a map.
//
// Weapons (CS 1.5 numbers, roughly): AK-47, M4A1, MP5 Navy, AWP as the primary (chosen in Settings), Desert Eagle
// as the sidearm, knife. Keys 1 / 2 / 3, Q = last weapon, wheel cycles, R reloads, right mouse = AWP scope.
// Bots carry the same rifles, roam the real road network (village_layout roads → graph of lanes and junctions),
// react with a short delay when they spot the player, fire bursts, run-and-gun, strafe at mid range, fall back and
// reload when the magazine is empty, run for cover when hurt, turn towards shots that hit them and towards gunfire
// they hear. Line of sight and bullets are blocked by the terrain height field, the building boxes and (v1.23) the walls,
// fences, posts and tree trunks of the walk's collision grid (src/solids.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBotCrowd } from './botchar.js';
import { joinRoom, ROOMS } from './multi.js';

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
  // v1.1: no allocations in the per-frame code. Results that used to be new objects (surface samples, wall hits,
  // push-out points, vectors) are written into these scratch objects; whoever asks uses the result before asking again.
  const surfaceInto = ctx.surfaceInto || ((out, x, z, refY) => Object.assign(out, surfaceAt(x, z, refY)));
  const _g = { y: 0, road: false, water: false }, _q = { x: 0, z: 0 }, _hit = { t: 0, x: 0, y: 0, z: 0 };
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
  const len2 = (x, z) => Math.sqrt(x * x + z * z);   // Math.hypot boxes its result in unoptimised code
  const touchIn = ctx.touchIn || { jx: 0, jy: 0 };
  const look = ctx.look || { sens: 1, fov: 55 };   // v1.1: the player's look sensitivity and field of view (Settings › Controls)
  const joyLen = () => len2(touchIn.jx, touchIn.jy);
  const isMoving = () => kd('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight') || joyLen() > 0.2;
  const isRunning = () => kd('ShiftLeft', 'ShiftRight') || joyLen() > 0.92;
  const rnd = () => Math.random();   // looked up at each call: the benchmark swaps in a seeded generator
  const G = {
    on: false, bots: [], botCount: 8, difficulty: 1.0, primary: 'ak47',
    health: 100, weapon: 'ak47', lastWeapon: 'deagle', ammo: {}, reloading: 0, fireCd: 0, swapT: 0, heat: 0, scoped: false,
    kills: 0, deaths: 0, dead: 0, roundT: 300, roundOver: false, kick: 0, bob: 0, lastShot: -1, feed: [], hurt: 0, firing: false, fired: false, time: 0,
  };
  const resetAmmo = () => { for (const k in WEAPONS) G.ammo[k] = { mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve }; };
  resetAmmo();
  const group = new THREE.Group(); group.name = 'Arena'; group.visible = false; scene.add(group);

  // ------------------------------------------------------------------ materials
  const mat = (c, r = 0.8, m = 0.0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const M = {
    skin: mat(0xc9a27e), cloth: mat(0xd9281c), cloth2: mat(0x9a1c15), vest: mat(0x17181b), team: mat(0xffd21f), boot: mat(0x1c1a18),
    steel: mat(0x2b2d31, 0.45, 0.7), steelDark: mat(0x16171a, 0.5, 0.6), wood: mat(0x7a4a26, 0.6, 0.05), olive: mat(0x5c6a3f, 0.7), silver: mat(0xb9bcc2, 0.3, 0.9),
    rubber: mat(0x202020, 0.95), blade: mat(0xd5d8dc, 0.25, 0.95),
    flash: new THREE.SpriteMaterial({ color: 0xffe3a0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  // v1.19: the muzzle flash is a hot core with a few short spikes fading out, not a square
  M.flash.map = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,230,170,0.9)'); gr.addColorStop(0.6, 'rgba(255,150,40,0.25)'); gr.addColorStop(1, 'rgba(255,120,0,0)');
    x.fillStyle = gr; x.beginPath();
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, r = i % 2 ? 11 : 30; x.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.closePath(); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  // bots stand out against the village: bright red kit, black vest, yellow scarf, with a little glow so they do not vanish in shadow
  M.cloth.emissive.setHex(0x5a0d08); M.cloth2.emissive.setHex(0x3a0906); M.team.emissive.setHex(0x6b5200);
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
  const noiseBuf = (dur, decay) => {
    const nk = dur + '|' + decay; let buf = noiseBufs.get(nk);
    if (!buf) { const len = Math.floor(ac.sampleRate * dur); buf = ac.createBuffer(1, len, ac.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); noiseBufs.set(nk, buf); }
    return buf;
  };
  // v1.1: the audio context and every noise shape are made when the game starts (the click on "Game"), not at the
  // first shot heard in the middle of a fight (20+ ms)
  const warmAudio = () => {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      for (const [dur, decay] of [[0.5, 1.8], [0.25, 2.2], [0.12, 3], [0.08, 4], [0.18, 2.5], [0.1, 3]]) noiseBuf(dur, decay);
      getDeath();
    } catch (e) { /* no audio */ }
  };
  const sound = (kind, dist = 0, weapon = 'ak47') => {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      if (kind === 'death') { getDeath().then(playDeath); return; }
      getDeath();
      const t = ac.currentTime, att = 1 / (1 + dist / 30);
      const noise = (dur, cutoff, gain, decay = 2.5) => {
        const buf = noiseBuf(dur, decay);   // v1.0: one noise buffer per shape, made once
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
  // v1.23 (owner: "the bots shouldn't shoot me from behind walls"): sight lines and bullets also stop at the walls,
  // fences, kerbs, posts and tree trunks of the collision grid the walk builds from the scene (src/solids.js, v1.18).
  // Until v1.22 only the terrain and the building boxes stopped them, so a garden wall or a fence hid nobody.
  // The grid is asked only for the part of the segment before the terrain / building hit, cell by cell (~0.1 ms for
  // the 8 sight lines a frame). Before the grid is built (the first second or so) it is the old test alone.
  const solidsOf = ctx.solids || (() => null);
  const trace = (ax, ay, az, bx, by, bz, step = 1.5) => {
    const L = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az)), n = Math.max(1, Math.ceil(L / step));
    let tc = 1, hit = null;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t, h = terrH(x, z);
      if (y < h || inBuilding(x, y, z)) { tc = t; _hit.t = t * L; _hit.x = x; _hit.y = Math.max(y, h); _hit.z = z; hit = _hit; break; }   // shared result
    }
    const S = solidsOf();
    if (S && S.ready) {
      const f = S.segmentHit(ax, ay, az, ax + (bx - ax) * tc, ay + (by - ay) * tc, az + (bz - az) * tc);
      if (f >= 0) { const t = f * tc; _hit.t = t * L; _hit.x = ax + (bx - ax) * t; _hit.y = ay + (by - ay) * t; _hit.z = az + (bz - az) * t; return _hit; }
    }
    return hit;
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
    body.add(box(0.54, 0.16, 0.34, 0, 1.5, 0, M.team));                                    // yellow scarf: the other team
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
  // v1.19: the bots are people (src/botchar.js): skinned villagers holding these guns with both hands. The box figures
  // above stay as the stand-in while model/character/bots.glb loads (and if it cannot load).
  // Where the hands and the shoulder go on each gun, in the weapon frame (barrel along -Z, grip down):
  const HOLD = {
    ak47:   { scale: 0.62, grip: [0.06, -0.06, 0.12], fore: [0, -0.05, -0.4], butt: [0, -0.03, 0.5], mag: [0, -0.2, -0.2] },
    m4a1:   { scale: 0.65, grip: [0.06, -0.05, 0.13], fore: [0, -0.04, -0.38], butt: [0, -0.01, 0.43], mag: [0, -0.18, -0.12] },
    mp5:    { scale: 0.7, grip: [0.06, -0.05, 0.11], fore: [0, -0.035, -0.36], butt: [0, -0.02, 0.41], mag: [0, -0.18, -0.2] },
    deagle: { scale: 0.85, grip: [0, -0.07, 0.05], fore: [-0.035, -0.085, 0.06], butt: null, mag: [0, -0.15, 0.06] },
  };
  const v3 = (a) => a && new THREE.Vector3(a[0], a[1], a[2]);
  const crowdGuns = {}; for (const k of BOT_GUNS) crowdGuns[k] = { geo: IM[k].geometry, mat: vcMat, scale: HOLD[k].scale, muzzle: MUZZLE[k], grip: v3(HOLD[k].grip), fore: v3(HOLD[k].fore), butt: v3(HOLD[k].butt), mag: v3(HOLD[k].mag) };
  const crowd = createBotCrowd({ url: new URL('../model/character/bots.glb', import.meta.url).href, guns: crowdGuns, makeFlash: flashSprite, parent: group });
  const attachChar = (b) => { if (crowd.ready && !b.char) { b.char = crowd.make(b.id, b.weapon); if (b.dead > 0) b.char.die(); } };
  // a soft dark patch under each person (the bots stay out of the static shadow map)
  const blobs = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 31); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const im = new THREE.InstancedMesh(geo, m, MAX_BOTS); im.count = 0; im.frustumCulled = false; im.renderOrder = 1; im.name = 'Bot_blobs';
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); group.add(im); return im;
  })();
  const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _bp = new THREE.Vector3();
  const charIn = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, pitch: 0, aim: false, crouch: false, reloadK: -1 };
  // the people's animation, after the bots moved: only the ones in view, 15 times a second beyond 60 m
  // (v1.20, phones: 12 times a second beyond 30 m: skinning and the arm IK are most of a bot's cost on a phone's CPU)
  const ANIM_FAR = isTouch ? 30 : 60, ANIM_HZ = isTouch ? 12 : 15;
  function animateChars(dt) {
    let nb = 0;
    for (let k = 0; k < G.bots.length; k++) {
      const b = G.bots[k], ch = b.char; if (!ch) continue;
      ch.visible = b.vis; if (!b.vis) { b.cacc = 0.2; continue; }
      const dist = len2(b.x - P.x, b.z - P.z);
      _bs.set(b.dead > 0 ? 1.5 : 1.05, 1, b.dead > 0 ? 1.5 : 1.05); _bq.setFromAxisAngle(_v1.set(0, 1, 0), b.yaw);
      _bp.set(b.x, b.y + 0.03, b.z); if (b.dead > 0) _bp.addScaledVector(_v1.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw)), 0.7);
      blobs.setMatrixAt(nb++, _bm.compose(_bp, _bq, _bs));
      b.cacc = (b.cacc || 0) + dt;
      if (dist > ANIM_FAR && !(G.scoped) && b.cacc < 1 / ANIM_HZ) continue;
      const step = Math.min(b.cacc, 0.25); b.cacc = 0;
      const W = WEAPONS[b.weapon];
      charIn.x = b.x; charIn.y = b.y; charIn.z = b.z; charIn.yaw = b.yaw; charIn.vx = b.vx || 0; charIn.vz = b.vz || 0;
      charIn.pitch = b.remote ? b.pitch : Math.atan2(P.y + EYE - 0.3 - (b.y + 1.45), Math.max(1, dist));
      charIn.aim = b.hasLos || b.state === 'search' || b.state === 'chase' || b.state === 'hold' || b.state === 'close';
      charIn.crouch = !!b.crouch && b.state === 'hold';
      charIn.reloadK = b.reloadT > 0 ? 1 - b.reloadT / (W.reload + 0.4) : -1;
      ch.update(step, charIn);
      ch.flash.visible = b.flashT > 0; if (ch.flash.visible) ch.flash.scale.setScalar(0.35 + rnd() * 0.3);
    }
    blobs.count = nb; blobs.visible = nb > 0; if (nb) blobs.instanceMatrix.needsUpdate = true;
  }
  const IML = Object.values(IM);
  const slot = (im) => { const o = new THREE.Object3D(); o.userData.im = im; o.userData.imesh = IM[im]; return o; };
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
  // which bots are in view this frame (b.vis): asked once, before they move
  function markVisibleBots() {
    camera.updateMatrixWorld(); _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _frus.setFromProjectionMatrix(_pv);
    for (let k = 0; k < G.bots.length; k++) { const b = G.bots[k]; _sph.center.set(b.x, b.y + 1, b.z); _sph.radius = 2.2; b.vis = _frus.intersectsSphere(_sph); }
  }
  const LOS_PER_FRAME = 8; let losLeft = 0;
  function syncBotInstances() {
    for (let i = 0; i < IML.length; i++) IML[i].count = 0;
    for (let k = 0; k < G.bots.length; k++) {
      const b = G.bots[k];
      if (!b.vis || b.char) continue;   // off screen: not drawn at all; a person (v1.19) draws itself
      b.mesh.updateMatrixWorld(true);
      const parts = b.mesh.userData.parts; for (let i = 0; i < parts.length; i++) { const o = parts[i], im = o.userData.imesh; im.setMatrixAt(im.count++, o.matrixWorld); }
    }
    for (let i = 0; i < IML.length; i++) { const im = IML[i]; im.visible = im.count > 0; if (im.count) im.instanceMatrix.needsUpdate = true; }
  }
  function spawnBot(i) {
    const kinds = ['ak47', 'ak47', 'm4a1', 'mp5', 'mp5', 'ak47', 'deagle', 'm4a1'];
    const weapon = kinds[Math.floor(rnd() * kinds.length)], W = WEAPONS[weapon];
    const p = roadPoint(P, 70, 260);
    const b = { id: i, name: botName(i), weapon, x: p.x, z: p.z, y: surfaceAt(p.x, p.z).y, yaw: rnd() * 6.28, hp: 100,
      state: 'patrol', route: null, pauseT: 0, lookYaw: 0, speedK: 0.85 + rnd() * 0.3, lateral: (rnd() - 0.5) * 2.4,
      seen: 0, lastSeen: null, ls: { x: 0, z: 0 }, hasLos: false, losT: rnd() * 0.3, aimT: 0, reaction: 0.3 + rnd() * 0.4,
      mag: W.mag, burst: 0, cd: 1 + rnd(), reloadT: 0, walk: 0, stuck: 0, lastX: p.x, lastZ: p.z, dead: 0, flee: 0, side: 1, sideT: 0, crouch: 0,
      mesh: botMesh(weapon), flashT: 0, acc: rnd() * 0.2, vis: true, char: null, vx: 0, vz: 0, cacc: 0 };
    b.mesh.position.set(b.x, b.y, b.z); group.add(b.mesh);
    attachChar(b);
    return b;
  }
  function killBot(b, head, by) {   // by: another player in the "together against the bots" room (v1.24), else me
    b.dead = 6; b.state = 'dead'; b.hp = 0; if (b.char) b.char.die();
    const w = by && WEAPONS[by.w] ? by.w : G.weapon;
    if (!by) { G.kills++; feed(`${b.name} ${head ? 'kafadan vuruldu' : 'vuruldu'} — ${WEAPONS[w].name}`); sound(head ? 'headshot' : 'hit'); }
    else feed(`${esc(by.name)} → ${b.name} — ${WEAPONS[w].name}`);
    if (G.mp && G.isHost) G.mp.send({ t: 'bk', idx: b.id, by: by ? by.pid : G.mp.id, hd: head ? 1 : 0, w });
  }
  function respawnBot(b) {
    const p = roadPoint(P, 90, 280); b.x = p.x; b.z = p.z; b.y = surfaceAt(p.x, p.z).y; b.hp = 100; b.state = 'patrol'; b.route = null; b.dead = 0; b.flee = 0; b.crouch = 0; b.mag = WEAPONS[b.weapon].mag; b.reloadT = 0;
    b.mesh.rotation.set(0, b.yaw, 0); b.mesh.position.set(b.x, b.y, b.z); b.cd = 1.5; b.hasLos = false; b.seen = 0;
    b.vx = b.vz = 0; if (b.char) b.char.reset();
  }
  function alertBot(b, x, z) { if (b.dead > 0 || b.remote) return; b.ls.x = x; b.ls.z = z; b.lastSeen = b.ls; b.seen = Math.max(b.seen, 6); if (b.state === 'patrol') b.state = 'search'; }
  function moveBot(b, tx, tz, speed, dt) {
    const ddx = tx - b.x, ddz = tz - b.z, L = len2(ddx, ddz) || 1;
    if (L < 0.4) return true;
    const q = _q; q.x = b.x + ddx / L * speed * dt; q.z = b.z + ddz / L * speed * dt;
    pushOut(q, 0.4);
    const g = surfaceInto(_g, q.x, q.z, b.y + 0.5);
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
    const ex = P.x, ez = P.z, dx = ex - b.x, dz = ez - b.z, dist = len2(dx, dz);
    // v1.1: how often a bot thinks and moves depends on how far it is: every frame within 60 m (and whatever is in
    // view through the scope), ~20 times a second to 120 m, ~5 times a second beyond (was: 10 a second beyond 180 m)
    if (dist >= 60 && !(G.scoped && b.vis)) { const every = dist < 120 ? 0.05 : 0.2; b.acc += dt; if (b.acc < every) return; dt = b.acc; b.acc = 0; }
    const x0 = b.x, z0 = b.z;
    // ---- perception: line of sight a few times a second; at most LOS_PER_FRAME traces a frame, the rest wait a frame
    b.losT -= dt;
    const needTrace = dist < 120 && G.dead <= 0;
    if (b.losT <= 0 && (!needTrace || losLeft > 0)) {
      if (needTrace) losLeft--;
      b.losT = 0.22 + rnd() * 0.15;
      const saw = b.hasLos;
      b.hasLos = needTrace && !trace(b.x, b.y + 1.6, b.z, ex, P.y + EYE - 0.2, ez, 2.0);
      if (b.hasLos) { b.ls.x = ex; b.ls.z = ez; b.lastSeen = b.ls; b.seen = 6; if (!saw) b.aimT = 0; }
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
          const q = line[Math.max(0, Math.min(line.length - 1, r.i + r.dir))], tx = q[0] - p[0], tz = q[1] - p[1], L = len2(tx, tz) || 1;
          const gx = p[0] - tz / L * b.lateral, gz = p[1] + tx / L * b.lateral;
          const arrived = moveBot(b, gx, gz, 2.4 * b.speedK, dt) || len2(gx - b.x, gz - b.z) < 1.6;
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
      if (arrived || len2(b.lastSeen.x - b.x, b.lastSeen.z - b.z) < 2.5) { b.seen = Math.min(b.seen, 1.5); b.lookYaw = b.yaw + (rnd() - 0.5) * 4; turnTo(b, b.lookYaw, dt, 2); }
    } else if (b.state === 'flee' || b.state === 'reload') {
      // away from the player, towards the nearest spot without line of sight
      const away = Math.atan2(-dx, -dz) + Math.sin(G.time * 0.7 + b.id) * 0.8;
      moveBot(b, b.x + Math.sin(away) * 6, b.z + Math.cos(away) * 6, 4.0 * b.speedK, dt); moving = true; turnTo(b, away, dt, 5);
    }
    if (b.hasLos && b.state !== 'flee' && b.state !== 'reload') turnTo(b, Math.atan2(dx, dz), dt, 10);
    // stuck: no progress for a second → new route / side
    b.stuck += dt;
    if (b.stuck > 1) { if (moving && len2(b.x - b.lastX, b.z - b.lastZ) < 0.5) { b.route = null; b.side = -b.side; b.pauseT = 0; } b.lastX = b.x; b.lastZ = b.z; b.stuck = 0; }
    // ---- weapon
    b.cd -= dt; b.flashT -= dt;
    if (b.reloadT > 0) { b.reloadT -= dt; if (b.reloadT <= 0) b.mag = W.mag; }
    else if (b.mag <= 0) { b.reloadT = W.reload + 0.4; b.burst = 0; }
    else if (b.hasLos && b.aimT > b.reaction && G.dead <= 0 && !G.roundOver && b.state !== 'flee' && b.cd <= 0) {
      if (b.burst <= 0) b.burst = W.auto ? (b.state === 'chase' ? 2 + Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 4)) : 1;
      b.burst--; b.mag--; b.cd = b.burst > 0 ? 1 / W.rate : (W.auto ? 0.5 + rnd() * 0.9 : 0.4 + rnd() * 0.5);
      b.flashT = 0.05; sound('shot', dist, b.weapon);
      const playerMoving = kd('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');   // (keyboard only, as before)
      let p = W.botAcc * G.difficulty * Math.max(0.25, 1 - dist / 170);
      if (playerMoving) p *= 0.65; if (moving) p *= 0.7; if (b.crouch) p *= 1.2; if (b.aimT < b.reaction + 0.4) p *= 1.15;
      if (b.char) b.char.fired();
      const muzzle = (b.char && b.vis ? b.char.flash : u.flash).getWorldPosition(_v1);   // (a person out of view was not posed this frame)
      // v1.23: a hit is checked again from the muzzle at the moment of the shot. The sight line is a few tenths of a
      // second old and runs from the bot's head, so a player who has just stepped behind a wall (or ducked below it)
      // is no longer hit through it: the round hits the wall instead.
      const hx = ex + (rnd() - 0.5) * 0.3, hy = P.y + EYE - 0.3 + (rnd() - 0.5) * 0.4, hz = ez + (rnd() - 0.5) * 0.3;
      const wall = rnd() < Math.min(0.85, p) ? trace(muzzle.x, muzzle.y, muzzle.z, hx, hy, hz, 2.0) : false;
      if (wall === null) {
        const falloff = Math.max(0.6, 1 - dist / 400), dmg = Math.round(W.dmg * falloff * (0.85 + rnd() * 0.3));
        hurtPlayer(dmg, b); tracer(muzzle, _v2.set(hx, hy, hz));
      } else if (wall) {
        tracer(muzzle, _v2.set(wall.x, wall.y, wall.z)); puff(wall.x, wall.y, wall.z, 0.5);
      } else {
        // a miss: the round passes close by and hits the ground or a wall behind
        const dir = _v2.set(ex - muzzle.x + (rnd() - 0.5) * 3, P.y + EYE - 0.3 - muzzle.y + (rnd() - 0.5) * 2, ez - muzzle.z + (rnd() - 0.5) * 3).normalize();
        const end = _v3.copy(muzzle).addScaledVector(dir, 120), w = trace(muzzle.x, muzzle.y, muzzle.z, end.x, end.y, end.z, 2.0);
        if (w) end.set(w.x, w.y, w.z);
        tracer(muzzle, end); if (w) puff(end.x, end.y, end.z, 0.5); if (dist < 40) sound('whiz');
      }
    }
    // the speed really covered (the people's legs follow it), smoothed a little
    const kv = Math.min(1, dt * 10); b.vx += ((b.x - x0) / dt - b.vx) * kv; b.vz += ((b.z - z0) / dt - b.vz) * kv;
    // ---- pose (limbs only for bots in view: v1.1; a person is posed in animateChars)
    if (b.vis && !b.char) {
      const sw = Math.sin(b.walk * 2.4) * (moving ? 0.6 : 0);
      u.l1.rotation.x = sw; u.l2.rotation.x = -sw;
      const aim = b.hasLos || b.state === 'search' ? 1 : 0;
      const armX = -1.25 - aim * 0.25, armSpread = aim ? 0.0 : 0.15;
      u.a1.rotation.x += (armX - u.a1.rotation.x) * Math.min(1, dt * 8); u.a2.rotation.x += (armX - u.a2.rotation.x) * Math.min(1, dt * 8); u.a1.rotation.z = armSpread; u.a2.rotation.z = -armSpread;
      u.gun.rotation.x += ((aim ? 0 : 0.35) - u.gun.rotation.x) * Math.min(1, dt * 8); u.gun.position.y = 1.28 - (aim ? 0 : 0.06);
    }
    const crouchK = b.crouch && b.state === 'hold' ? 0.75 : 1; b.mesh.scale.y += (crouchK - b.mesh.scale.y) * Math.min(1, dt * 6);
    u.flash.visible = b.flashT > 0 && !b.char; if (u.flash.visible) u.flash.scale.setScalar(0.35 + rnd() * 0.3);
    b.mesh.position.set(b.x, b.y + (moving ? Math.abs(Math.sin(b.walk * 2.4)) * 0.03 : 0), b.z); b.mesh.rotation.set(0, b.yaw, 0);
  }

  // ------------------------------------------------------------------ player weapons
  // The view model (the gun in the player's hands) is drawn in its own small scene with its own camera, in a second
  // pass after the village: it no longer depends on the camera being part of the main scene, so nothing in the
  // village (culling, fog, shadow pass, instancing) and no browser quirk can hide it, and it never pokes into walls.
  const vm = new THREE.Group(); vm.visible = false;
  const vmScene = new THREE.Scene(), vmCam = new THREE.PerspectiveCamera(55, camera.aspect, 0.02, 10);
  vmScene.add(vmCam, vm);
  const vmSun = new THREE.DirectionalLight(0xfff1d6, 3.2); vmSun.position.set(0.4, 1, 0.6); vmScene.add(vmSun, new THREE.HemisphereLight(0xcfe3ff, 0x8a7a63, 2.6));
  const models = {}; for (const k in WEAPONS) { models[k] = weaponModel(k); models[k].visible = false; vm.add(models[k]); }
  const vmFlash = flashSprite(0.35); vm.add(vmFlash);
  const REST = { ak47: [0.26, -0.24, -0.5], m4a1: [0.26, -0.24, -0.5], mp5: [0.24, -0.22, -0.42], awp: [0.24, -0.25, -0.5], deagle: [0.2, -0.23, -0.56], knife: [0.22, -0.22, -0.4] };
  /** Second pass, called by the main loop right after the village is drawn: the gun on top, depth cleared. */
  function renderOverlay(renderer) {
    if (!G.on || !vm.visible) return;
    vmCam.aspect = camera.aspect; vmCam.fov = look.fov; vmCam.updateProjectionMatrix();
    const ac = renderer.autoClear; renderer.autoClear = false; renderer.clearDepth(); renderer.render(vmScene, vmCam); renderer.autoClear = ac;
  }
  function setWeapon(k) {
    if (k === G.weapon || G.dead > 0) return;
    G.lastWeapon = G.weapon; G.weapon = k; G.swapT = 0.45; G.reloading = 0; G.heat = 0; setScope(false); sound('swap');
    for (const m in models) models[m].visible = m === k;
  }
  function setScope(on) {
    if (on === G.scoped) return;
    G.scoped = on; camera.fov = on ? 14 : look.fov; camera.updateProjectionMatrix(); el('ghScope').style.display = on ? 'block' : 'none'; vm.visible = !on && G.on; scopeBtn.classList.toggle('on', on);
  }
  // v1.1: tracers and dust / blood puffs are fixed rings of objects that stay in the scene (hidden when idle), each
  // puff with its own material made once: a shot allocates nothing, adds nothing to the scene and compiles no shader.
  // When every one is in use the oldest is taken over.
  const TRACERS = 48, PUFFS = 32, tracers = [], puffs = []; let tracerI = 0, puffI = 0;
  for (let i = 0; i < TRACERS; i++) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const l = new THREE.Line(g, tracerMat); l.frustumCulled = false; l.visible = false; l.userData.t = 0; group.add(l); tracers.push(l);
  }
  for (let i = 0; i < PUFFS; i++) { const s = new THREE.Sprite(puffMat.clone()); s.visible = false; s.frustumCulled = false; s.userData.t = 0; group.add(s); puffs.push(s); }
  function tracer(a, b) {
    const l = tracers[tracerI]; tracerI = (tracerI + 1) % TRACERS;
    const p = l.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true;
    l.visible = true; l.userData.t = 0.05;
  }
  function puff(x, y, z, size = 0.6, m = puffMat) {
    const s = puffs[puffI]; puffI = (puffI + 1) % PUFFS;
    s.material.color.copy(m.color); s.material.opacity = m.opacity;
    s.position.set(x, y, z); s.scale.setScalar(size); s.visible = true; s.userData.t = 0.35;
  }
  function updateFx(dt) {
    for (let i = 0; i < TRACERS; i++) { const l = tracers[i]; if (l.visible && (l.userData.t -= dt) <= 0) l.visible = false; }
    for (let i = 0; i < PUFFS; i++) { const s = puffs[i]; if (!s.visible) continue; const t = s.userData.t -= dt; s.scale.multiplyScalar(1 + dt * 4); s.material.opacity = Math.max(0, t * 2); if (t <= 0) s.visible = false; }
  }
  function fire() {
    const W = WEAPONS[G.weapon], A = G.ammo[G.weapon];
    if (G.dead > 0 || G.roundOver || G.reloading > 0 || G.fireCd > 0 || G.swapT > 0) return;
    if (!W.auto && G.fired) return;   // semi-automatic: one shot per click
    if (!W.melee && A.mag <= 0) { reload(); return; }
    if (!W.melee) A.mag--;
    G.fired = true; G.fireQueue = 0; G.fireCd = 1 / W.rate; G.kick = 1; G.lastShot = G.time; sound('shot', 0, G.weapon);
    if (!W.melee) { vmFlash.visible = true; vmFlash.position.copy(models[G.weapon].userData.muzzle).add(models[G.weapon].position); vmFlash.scale.setScalar(0.25 + rnd() * 0.25); }
    // camera kick (recoil): up and a little sideways, the AK climbs
    P.pitch += W.kick * Math.PI / 180 * (0.7 + rnd() * 0.5); P.yaw += (rnd() - 0.5) * W.kick * Math.PI / 180 * 0.5;
    // direction with spread: standing / moving / scoped, plus heat from holding the trigger
    const dir = camera.getWorldDirection(_v1);
    const moving = isMoving();
    let spread = (moving ? W.moveSpread : W.spread) + G.heat; if (W.scope && !G.scoped) spread = 0.08;
    const right = _v2.crossVectors(dir, camera.up).normalize(), up = _v3.crossVectors(right, dir).normalize();
    const r = Math.sqrt(rnd()) * spread, a = rnd() * Math.PI * 2;
    dir.addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
    G.heat = Math.min(W.climb * 8, G.heat + W.climb);
    const o = _v4.copy(camera.position);
    // nearest bot whose body (0.4 m sphere at chest height) or head (0.22 m) the ray passes through
    let bestT = Infinity, bestB = null, bestHead = false;
    for (let i = 0; i < G.bots.length; i++) {
      const b = G.bots[i]; if (b.dead > 0) continue;
      for (let part = 0; part < 2; part++) {
        const cy = part ? 1.72 : 1.05, rad = part ? 0.22 : 0.4;
        const ox = b.x - o.x, oy = b.y + cy * b.mesh.scale.y - o.y, oz = b.z - o.z, t = ox * dir.x + oy * dir.y + oz * dir.z;
        if (t < 0 || t > W.range) continue;
        if (ox * ox + oy * oy + oz * oz - t * t < rad * rad && t < bestT) { bestT = t; bestB = b; bestHead = part === 1; }
      }
    }
    const end = _v5.copy(o).addScaledVector(dir, bestB ? bestT : W.range);
    const wall = trace(o.x, o.y, o.z, end.x, end.y, end.z, 1.0);
    if (wall) { end.set(wall.x, wall.y, wall.z); if (!W.melee) puff(end.x, end.y, end.z); }
    else if (bestB) {
      const falloff = W.melee ? 1 : Math.max(0.5, 1 - bestT / 500), dmg = Math.round(W.dmg * falloff * (bestHead ? W.head : 1) * (0.9 + rnd() * 0.2));
      puff(end.x, end.y, end.z, 0.45, bloodMat); sound(bestHead ? 'headshot' : 'hit');
      if (bestB.remote) { mpHit(bestB, dmg, bestHead); }   // v1.24: another player (they take the damage on their side) or a bot run by the room's host
      else if ((bestB.hp -= dmg) <= 0) killBot(bestB, bestHead); else { if (bestB.char) bestB.char.hit(); alertBot(bestB, P.x, P.z); bestB.hasLos = true; bestB.seen = 6; bestB.aimT = bestB.reaction; }
    }
    if (!W.melee) { const muzzle = _v2.copy(models[G.weapon].userData.muzzle).add(models[G.weapon].position).applyMatrix4(camera.matrixWorld); tracer(muzzle, end); }
    // bots within earshot turn towards the gunfire
    if (!W.melee) for (const b of G.bots) { if (b.dead <= 0 && !b.hasLos && len2(b.x - P.x, b.z - P.z) < (G.weapon === 'awp' ? 160 : 90) && rnd() < 0.7) alertBot(b, P.x + (rnd() - 0.5) * 8, P.z + (rnd() - 0.5) * 8); }
  }
  function reload() {
    const W = WEAPONS[G.weapon], A = G.ammo[G.weapon];
    if (W.melee || G.reloading > 0 || A.mag >= W.mag || A.reserve <= 0 || G.dead > 0) return;
    G.reloading = W.reload; setScope(false); sound('reload');
  }
  function hurtPlayer(dmg, from) {
    if (botTarget) { if (G.mp) G.mp.send({ t: 'h', to: botTarget.pid, dmg, w: from.weapon, bn: from.name }); return; }   // v1.24: my bot shot a team mate
    if (G.dead > 0) return;
    if (G.god) dmg = Math.min(dmg, G.health - 1);   // benchmark run (src/bench.js): hit, never killed
    G.health -= dmg; G.hurt = 1;
    if (G.health > 0) sound('hurt');
    else { G.health = 0; G.dead = 3.5; G.deaths++; setScope(false); sound('death'); feed(`${esc(from.name)} seni vurdu — ${WEAPONS[from.weapon].name}`); mpDied(from); }
  }
  function respawnPlayer() {
    let [sx, sz] = D.spawn.walk; if (G.mp) { const q = roadPoint({ x: sx, z: sz }, 0, 140); sx = q.x; sz = q.z; } P.x = sx; P.z = sz; P.y = surfaceAt(sx, sz).y; P.vy = 0; G.health = 100; resetAmmo(); G.reloading = 0; G.heat = 0;
    G.weapon = G.primary; G.lastWeapon = 'deagle'; for (const m in models) models[m].visible = m === G.weapon; G.swapT = 0.3;
  }
  function feed(msg) { G.feedSeq = (G.feedSeq || 0) + 1; G.feed.unshift({ msg, t: 5 }); if (G.feed.length > 5) G.feed.pop(); }

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
  // v1.20.1: a press is never lost. A new touch always takes the button over (a finger whose release the browser never
  // reported used to leave it dead until the mode was changed), the shot goes off on the touch itself rather than on
  // the next frame, and a tap during the last moments of the bolt / weapon swap is kept and fires as soon as it can.
  const fireUp = e => { if (e.pointerId !== fireId) return; fireId = null; G.firing = false; G.fired = false; fireBtn.classList.remove('down'); };
  fireBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); fireId = e.pointerId; fx0 = e.clientX; fy0 = e.clientY; try { fireBtn.setPointerCapture(e.pointerId); } catch (_) {} G.firing = true; G.fired = false; G.fireQueue = 0.35; fireBtn.classList.add('down'); if (G.on && G.dead <= 0) fire(); });
  addEventListener('pointerup', fireUp); addEventListener('pointercancel', fireUp);
  fireBtn.addEventListener('pointermove', e => { if (e.pointerId !== fireId) return; const dx = e.clientX - fx0, dy = e.clientY - fy0; fx0 = e.clientX; fy0 = e.clientY; if (look.touchTurn) { look.touchTurn(dx, dy, e); return; } const k = 0.005 * look.sens * camera.fov / look.fov; P.yaw -= dx * k; P.pitch = Math.max(-1.45, Math.min(1.45, P.pitch - dy * k)); });
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
  // v1.1: the strings are built only when the numbers behind them changed (they were built and compared every frame)
  const hudNum = {};
  const changed = (k, v) => { if (hudNum[k] === v) return false; hudNum[k] = v; return true; };
  function updateHud() {
    const W = WEAPONS[G.weapon], A = G.ammo[G.weapon];
    if (changed('score', G.kills * 100000 + G.deaths)) setText('ghScore', `${G.kills} : ${G.deaths}`);
    const t = G.mp ? -1 : Math.max(0, Math.ceil(G.roundT)); if (changed('time', t)) setText('ghTime', t < 0 ? '∞' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`);
    if (changed('hp', G.health)) { setStyle('ghHp', 'width', `${G.health}%`); setStyle('ghHp', 'background', G.health > 50 ? '#7cc26b' : G.health > 25 ? '#e0b24a' : '#d14b3a'); setText('ghHpTxt', String(G.health)); }
    if (changed('wpn', G.weapon)) setText('ghWpn', W.name);
    if (changed('mag', W.melee ? -1 : A.mag)) setText('ghMag', W.melee ? '—' : String(A.mag));
    if (changed('res', W.melee ? -1 : A.reserve)) setText('ghRes', W.melee ? '' : `/ ${A.reserve}`);
    setText('ghRel', G.reloading > 0 ? 'reloading' : (!W.melee && A.mag === 0 ? 'R: reload' : ''));
    if (changed('slots', G.primary + '|' + G.weapon)) {
      const sh = [G.primary, 'deagle', 'knife'].map((k, i) => `<span data-w="${k}" class="${k === G.weapon ? 'on' : ''}">${isTouch ? '' : (i + 1) + ' '}${WEAPONS[k].name}</span>`).join('');
      if (sh !== slotsHtml) { el('ghSlots').innerHTML = sh; slotsHtml = sh; }
    }
    // v1.20.1: FIRE greys out while it cannot shoot (dead, reloading, swapping, the AWP's bolt), so a press that does
    // nothing is no longer a mystery
    if (isTouch) { const wait = G.dead > 0 || G.roundOver || G.reloading > 0 || G.swapT > 0 || G.fireCd > 0.15; if (changed('fireWait', wait)) fireBtn.classList.toggle('wait', wait); }
    if (isTouch && hudCache.get('scope') !== !!W.scope) { hudCache.set('scope', !!W.scope); scopeBtn.classList.toggle('show', !!W.scope); }
    // crosshair: hidden behind the scope or while dead; the gap opens with the real spread (moving, holding the trigger)
    if (cross) {
      const off = G.scoped || G.dead > 0 || G.roundOver; if (changed('crossOff', off)) cross.classList.toggle('off', off);
      const sp = W.melee ? 0 : (W.scope && !G.scoped ? 0.08 : (isMoving() ? W.moveSpread : W.spread) + G.heat);
      const gap = Math.round((3 + Math.min(60, Math.tan(sp) / Math.tan(camera.fov * Math.PI / 360) * innerHeight / 2)) * 10);
      if (changed('gap', gap)) cross.style.setProperty('--gap', (gap / 10).toFixed(1) + 'px');
    }
    // kill feed: rebuilt when a line came or went, or a fading line lost another tenth of opacity
    let fk = (G.feedSeq || 0) * 7 + G.feed.length; for (let i = 0; i < G.feed.length; i++) fk = fk * 11 + Math.round(Math.min(1, G.feed[i].t / 1.5) * 10);
    if (changed('feed', fk)) el('ghFeed').innerHTML = G.feed.map(f => `<div style="opacity:${Math.min(1, f.t / 1.5).toFixed(1)}">${f.msg}</div>`).join('');
    const hurt = Math.round(G.hurt * 55); if (changed('hurt', hurt)) el('ghHurt').style.opacity = (hurt / 100).toFixed(2);
    if (changed('dead', G.dead > 0)) el('ghDead').style.display = G.dead > 0 ? 'grid' : 'none';
    if (G.dead > 0) { const d = Math.ceil(G.dead); if (changed('deadT', d)) setText('ghDeadTxt', `yeniden doğuyorsun… ${d}`); }
    if (changed('end', G.roundOver)) el('ghEnd').style.display = G.roundOver ? 'grid' : 'none';
  }

  // ------------------------------------------------------------------ v1.24 "Birlikte oyna": playing together
  // Everyone in the room is in the same village. The other players are drawn like the bots (they live in G.bots with
  // remote: true, so hit tests, the people's animation, instancing and the minimap work for them as they are) but move
  // where their own browser says. A bullet that hits another player is reported to them; they take the damage on their
  // side and tell everyone when it killed them, so there is nothing to keep in sync but positions. See src/multi.js.
  const esc = (t) => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cleanName = (t) => String(t || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Misafir';
  const MP_GUN = { ak47: 'ak47', m4a1: 'm4a1', mp5: 'mp5', deagle: 'deagle', awp: 'm4a1', knife: 'deagle' };   // what the figure holds
  const remotes = new Map();   // player id → entry in G.bots
  let mpSendT = 0, mpListT = 0, mpConnecting = false, myName = '';
  try { myName = localStorage.getItem('kk_mp_name') || ''; } catch (_) {}
  const hashId = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); };
  const labels = document.createElement('div'); labels.id = 'mpLabels'; document.body.appendChild(labels);
  function addRemote(m) {
    const w = MP_GUN[m.w] || 'ak47';
    const b = { id: 1000 + hashId(m.i) % 5000, remote: true, pid: m.i, name: cleanName(m.n), weapon: w, realW: WEAPONS[m.w] ? m.w : 'ak47',
      x: m.x, y: m.y, z: m.z, yaw: m.r, pitch: m.p || 0, tx: m.x, ty: m.y, tz: m.z, tyaw: m.r, tvx: 0, tvz: 0, rxT: G.time, seenAt: G.time,
      hp: 100, state: 'chase', dead: m.d ? 1 : 0, firing: !!m.f, fireAcc: 0, kills: m.k || 0, deaths: m.de || 0,
      vis: true, char: null, vx: 0, vz: 0, cacc: 0, flashT: 0, reloadT: 0, hasLos: false, crouch: 0, walk: 0, mesh: botMesh(w) };
    b.mesh.position.set(b.x, b.y, b.z); group.add(b.mesh);
    b.label = document.createElement('span'); b.label.textContent = b.name; labels.appendChild(b.label);
    attachChar(b); remotes.set(m.i, b); G.bots.push(b);
    if (G.bots.length > MAX_BOTS) setAi(G.bots.filter(o => !o.remote).length);
    feed(`${esc(b.name)} oyuna katıldı`); drawPlayers();
    return b;
  }
  function removeRemote(b, quiet) {
    remotes.delete(b.pid); G.bots = G.bots.filter(o => o !== b);
    group.remove(b.mesh); if (b.char) b.char.dispose(); b.label.remove();
    if (!quiet) feed(`${esc(b.name)} oyundan ayrıldı`);
    drawPlayers();
  }
  function onRemoteState(m) {
    let b = remotes.get(m.i); if (!b) { b = addRemote(m); }
    const dtm = Math.max(0.05, G.time - b.rxT); b.rxT = G.time; b.seenAt = G.time;
    b.tvx = (m.x - (b.lx ?? m.x)) / dtm; b.tvz = (m.z - (b.lz ?? m.z)) / dtm; b.lx = m.x; b.lz = m.z;
    if (Math.hypot(m.x - b.x, m.z - b.z) > 15) { b.x = m.x; b.z = m.z; b.y = m.y; b.tvx = b.tvz = 0; }   // respawned: no gliding across the map
    b.jt = Number.isFinite(m.jt) ? m.jt : Infinity;
    b.tx = m.x; b.ty = m.y; b.tz = m.z; b.tyaw = m.r; b.pitch = m.p || 0; b.firing = !!m.f; b.kills = m.k || 0; b.deaths = m.de || 0;
    const nm = cleanName(m.n); if (nm !== b.name) { b.name = nm; b.label.textContent = nm; }
    if (WEAPONS[m.w]) { b.realW = m.w; const w = MP_GUN[m.w]; if (w !== b.weapon) { group.remove(b.mesh); if (b.char) { b.char.dispose(); b.char = null; } b.weapon = w; b.mesh = botMesh(w); group.add(b.mesh); attachChar(b); } }
    if (m.d && !b.dead) { b.dead = 1; if (b.char) b.char.die(); }
    else if (!m.d && b.dead) { b.dead = 0; b.x = m.x; b.z = m.z; b.y = m.y; b.tvx = b.tvz = 0; if (b.char) b.char.reset(); b.mesh.rotation.set(0, b.yaw, 0); }
  }
  function remoteStep(b, dt) {
    const u = b.mesh.userData, x0 = b.x, z0 = b.z;
    if (b.dead <= 0 && G.time - b.rxT < 0.6) { b.tx += b.tvx * dt; b.tz += b.tvz * dt; }   // carry on a little between messages
    const k = Math.min(1, dt * 9); b.x += (b.tx - b.x) * k; b.z += (b.tz - b.z) * k; b.y += (b.ty - b.y) * k;
    turnTo(b, b.tyaw, dt, 12);
    const kv = Math.min(1, dt * 8); b.vx += ((b.x - x0) / Math.max(dt, 1e-3) - b.vx) * kv; b.vz += ((b.z - z0) / Math.max(dt, 1e-3) - b.vz) * kv;
    b.flashT -= dt;
    if (b.firing && b.dead <= 0 && !WEAPONS[b.realW].melee) {   // their gun goes off here at its own rate: no message per shot
      b.fireAcc -= dt;
      if (b.fireAcc <= 0) { b.fireAcc = 1 / WEAPONS[b.realW].rate; b.flashT = 0.05; sound('shot', len2(b.x - P.x, b.z - P.z), b.realW); if (b.char) b.char.fired(); }
    } else b.fireAcc = 0;
    if (b.dead > 0 && !b.char) { b.mesh.rotation.x = -Math.PI / 2; b.mesh.position.set(b.x, b.y + 0.15, b.z); }
    else { b.mesh.position.set(b.x, b.y, b.z); b.mesh.rotation.set(0, b.yaw, 0); }
    u.flash.visible = b.flashT > 0 && !b.char;
  }
  function mpHit(b, dmg, head) {
    if (!G.mp) return;
    if (b.shadow) G.mp.send({ t: 'bh', idx: b.id, dmg, hd: head ? 1 : 0, w: G.weapon });
    else if (G.mode === 'pvp') G.mp.send({ t: 'h', to: b.pid, dmg, hd: head ? 1 : 0, w: G.weapon });   // team mates cannot hurt each other
  }
  function mpDied(from) { if (G.mp) G.mp.send({ t: 'k', by: from && from.pid ? from.pid : '', bn: from ? from.name : '', w: from ? from.weapon : '', hd: from && from.head ? 1 : 0 }); sendState(); }
  function onMsg(m) {
    if (!G.mp || !m || typeof m.i !== 'string') return;
    if (m.t === 's') { if ([m.x, m.y, m.z, m.r].every(Number.isFinite)) onRemoteState(m); return; }
    const b = remotes.get(m.i);
    if (m.t === 'h' && m.to === G.mp.id && b && Number.isFinite(m.dmg)) {
      if (G.mode === 'takim' && !m.bn) return;
      const bot = m.bn ? cleanName(m.bn) : '';
      hurtPlayer(Math.max(0, Math.min(500, m.dmg)), { name: bot || b.name, weapon: WEAPONS[m.w] ? m.w : b.realW, pid: bot ? '' : b.pid, head: !!m.hd });
      if (G.dead <= 0) { const a = Math.atan2(b.x - P.x, b.z - P.z); G.hitFrom = a; }
    } else if (m.t === 'k' && b) {
      const wn = WEAPONS[m.w] ? WEAPONS[m.w].name : '';
      if (m.by === G.mp.id) { G.kills++; sound(m.hd ? 'headshot' : 'hit'); feed(`${esc(b.name)} ${m.hd ? 'kafadan vuruldu' : 'vuruldu'} — ${wn}`); }
      else { const k = remotes.get(m.by); feed(`${esc(k ? k.name : cleanName(m.bn))} → ${esc(b.name)}${wn ? ' — ' + wn : ''}`); }
    } else if (m.t === 'b' && G.mode === 'takim' && !G.isHost && b && b.pid === hostId()) onBots(m);
    else if (m.t === 'bh' && G.isHost && b && Number.isFinite(m.dmg)) {   // a team mate hit one of my bots
      const bot = G.bots.find(o => !o.remote && o.id === m.idx); if (!bot || bot.dead > 0) return;
      bot.hp -= Math.max(0, Math.min(500, m.dmg));
      if (bot.hp <= 0) killBot(bot, !!m.hd, { name: b.name, pid: b.pid, w: m.w }); else { if (bot.char) bot.char.hit(); alertBot(bot, b.x, b.z); }
    } else if (m.t === 'bk' && !G.isHost && b) {
      const sh = shadows[m.idx], nm = sh ? sh.name : botName(m.idx), wn = WEAPONS[m.w] ? WEAPONS[m.w].name : '';
      if (sh && !sh.dead) { sh.dead = 1; sh.firing = false; if (sh.char) sh.char.die(); }
      if (m.by === G.mp.id) { G.kills++; sound(m.hd ? 'headshot' : 'hit'); feed(`${nm} ${m.hd ? 'kafadan vuruldu' : 'vuruldu'} — ${wn}`); }
      else { const k = remotes.get(m.by); feed(`${esc(k ? k.name : '?')} → ${nm}${wn ? ' — ' + wn : ''}`); }
    } else if (m.t === 'bc' && G.isHost && Number.isFinite(m.n)) { const n = Math.max(0, Math.min(100, m.n | 0)); setBots(n); document.querySelectorAll('#botCount .pbtn').forEach(o => o.classList.toggle('on', +o.dataset.bots === n)); }
    else if (m.t === 'bye' && b) removeRemote(b);
    else if (m.t === 'hi' && G.mp) sendState();   // a newcomer: let them see us straight away
  }
  function sendState() {
    if (!G.mp) return;
    const r2 = (v) => Math.round(v * 100) / 100;
    G.mp.send({ t: 's', n: myName, x: r2(P.x), y: r2(P.y), z: r2(P.z), r: r2(P.yaw + Math.PI), p: r2(P.pitch), w: G.weapon, d: G.dead > 0 ? 1 : 0, f: G.firing && G.dead <= 0 ? 1 : 0, k: G.kills, de: G.deaths, jt: G.joinT });
  }
  const _lp = new THREE.Vector3();
  function mpUpdate(dt) {
    if (!G.mp) return;
    // fewer messages the more people there are (the free Supabase plan allows about 100 a second for everyone together)
    const n = remotes.size + 1, every = Math.max(1 / 6, n * (n - 1) / 70);
    mpSendT -= dt; if (mpSendT <= 0) { mpSendT = every; sendState(); }
    for (const b of [...remotes.values()]) if (G.time - b.seenAt > 8) removeRemote(b);   // closed the page without saying goodbye
    // names over their heads
    for (const b of remotes.values()) {
      const d = len2(b.x - P.x, b.z - P.z);
      _lp.set(b.x, b.y + 2.15, b.z).project(camera);
      const show = b.vis && d < 160 && _lp.z < 1;
      if (show !== b.lblOn) { b.lblOn = show; b.label.style.display = show ? 'block' : 'none'; }
      if (show) b.label.style.transform = `translate(${((_lp.x + 1) / 2 * innerWidth).toFixed(0)}px,${((1 - _lp.y) / 2 * innerHeight).toFixed(0)}px) translate(-50%,-100%)`;
      b.label.classList.toggle('dead', b.dead > 0);
    }
    teamTick(dt);
    mpListT -= dt; if (mpListT <= 0) { mpListT = 0.5; drawPlayers(); }
  }
  // ---- "Birlikte botlara karşı": one shared set of bots. The player who has been in the room longest (the host) runs
  // them as usual, each bot going for the nearest living player, and sends where they are a few times a second; the
  // others draw those bots (shadows, remote: true) and tell the host when they hit one.
  let botTarget = null;   // while a host's bot thinks about a team mate: that team mate
  const shadows = [];     // the host's bots as drawn here, by bot id
  G.isHost = false; G.mode = 'takim'; G.joinT = 0; G.joinG = 0;   // joinT: wall clock (compared between players)
  function hostId() {
    if (!G.mp) return '';
    let best = G.mp.id, bt = G.joinT;
    for (const r of remotes.values()) if (r.jt < bt || (r.jt === bt && r.pid < best)) { best = r.pid; bt = r.jt; }
    return best;
  }
  function botStepTeam(b, dt) {
    let best = null, bd = G.dead > 0 ? Infinity : len2(b.x - P.x, b.z - P.z);
    for (const r of remotes.values()) { if (r.dead > 0) continue; const d = len2(r.x - b.x, r.z - b.z); if (d < bd) { bd = d; best = r; } }
    if (!best) { botStep(b, dt); return; }
    // the bot code aims at P: for this bot, P stands where the team mate is
    const sx = P.x, sy = P.y, sz = P.z, sd = G.dead;
    P.x = best.x; P.y = best.y; P.z = best.z; G.dead = 0; botTarget = best;
    try { botStep(b, dt); } finally { P.x = sx; P.y = sy; P.z = sz; G.dead = sd; botTarget = null; }
  }
  function addShadow(i, w) {
    const s = { id: i, remote: true, shadow: true, pid: '', name: botName(i), weapon: w, realW: w, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, tx: 0, ty: 0, tz: 0, tyaw: 0, tvx: 0, tvz: 0, rxT: G.time,
      hp: 100, state: 'chase', dead: 0, firing: false, fireAcc: 0, vis: true, char: null, vx: 0, vz: 0, cacc: 0, flashT: 0, reloadT: 0, hasLos: false, crouch: 0, walk: 0, mesh: botMesh(w), fresh: true };
    group.add(s.mesh); attachChar(s); shadows[i] = s; G.bots.push(s); return s;
  }
  function clearShadows() {
    for (const s of shadows) if (s) { group.remove(s.mesh); if (s.char) s.char.dispose(); }
    G.bots = G.bots.filter(o => !o.shadow); shadows.length = 0;
  }
  function onBots(m) {
    const n = Math.min(MAX_BOTS - remotes.size, m.n | 0), a = m.a; if (!Array.isArray(a)) return;
    while (shadows.length > n) { const s = shadows.pop(); if (s) { group.remove(s.mesh); if (s.char) s.char.dispose(); G.bots = G.bots.filter(o => o !== s); } }
    for (let i = 0; i < n; i++) {
      const o = i * 7, x = a[o], y = a[o + 1], z = a[o + 2], r = a[o + 3], dead = a[o + 4], fi = a[o + 5], w = BOT_GUNS[a[o + 6]] || 'ak47';
      if (![x, y, z, r].every(Number.isFinite)) continue;
      let s = shadows[i]; if (!s) s = addShadow(i, w);
      if (w !== s.weapon) { group.remove(s.mesh); if (s.char) { s.char.dispose(); s.char = null; } s.weapon = s.realW = w; s.mesh = botMesh(w); group.add(s.mesh); attachChar(s); }
      const dtm = Math.max(0.05, G.time - s.rxT); s.rxT = G.time;
      if (s.fresh || Math.hypot(x - s.x, z - s.z) > 15) { s.x = x; s.y = y; s.z = z; s.yaw = r; s.tvx = s.tvz = 0; s.fresh = false; }
      else { s.tvx = (x - s.lx) / dtm; s.tvz = (z - s.lz) / dtm; }
      s.lx = x; s.lz = z;
      s.tx = x; s.ty = y; s.tz = z; s.tyaw = r; s.firing = !!fi;
      s.pitch = Math.atan2(P.y + EYE - 0.3 - (s.y + 1.45), Math.max(1, len2(s.x - P.x, s.z - P.z)));
      if (dead && !s.dead) { s.dead = 1; if (s.char) s.char.die(); }
      else if (!dead && s.dead) { s.dead = 0; s.x = x; s.y = y; s.z = z; s.tvx = s.tvz = 0; if (s.char) s.char.reset(); }
    }
  }
  let botSendT = 0;
  function sendBots(dt) {
    botSendT -= dt; if (botSendT > 0) return;
    const n = remotes.size + 1; botSendT = Math.max(1 / 6, (n - 1) / 30);
    const r2 = (v) => Math.round(v * 100) / 100, a = [];
    const ai = G.bots.filter(o => !o.remote).sort((p, q) => p.id - q.id);
    for (const b of ai) a.push(r2(b.x), r2(b.y), r2(b.z), r2(b.yaw), b.dead > 0 ? 1 : 0, b.flashT > -0.35 && b.dead <= 0 ? 1 : 0, Math.max(0, BOT_GUNS.indexOf(b.weapon)));
    G.mp.send({ t: 'b', n: ai.length, a });
  }
  // who runs the bots: decided again whenever someone comes or goes
  function teamTick(dt) {
    if (G.mode !== 'takim') return;
    const host = G.time - G.joinG > 1.5 && hostId() === G.mp.id;   // give the others a moment to say they are here
    if (host !== G.isHost) {
      G.isHost = host;
      if (host) {   // take the bots over where they stand
        const was = shadows.map(s => s && { x: s.x, y: s.y, z: s.z, yaw: s.yaw, dead: s.dead });
        clearShadows(); setAi(G.botCount);
        for (const b of G.bots) { const q = !b.remote && was[b.id]; if (q && !q.dead) { b.x = q.x; b.y = q.y; b.z = q.z; b.yaw = q.yaw; b.mesh.position.set(b.x, b.y, b.z); } }
      } else setAi(0);
    }
    if (G.isHost && remotes.size) sendBots(dt);
    else if (!G.isHost && shadows.length && G.time - Math.max(...shadows.filter(Boolean).map(s => s.rxT), 0) > 8) clearShadows();
  }

  // ---- the button, the name box and the list of players
  const mpBtn = document.createElement('button'); mpBtn.id = 'ghMp'; mpBtn.type = 'button'; mpBtn.textContent = '👥 Birlikte oyna'; hud.appendChild(mpBtn);
  const mpList = document.createElement('div'); mpList.id = 'ghPlayers'; hud.appendChild(mpList);
  const mpDlg = document.createElement('div'); mpDlg.id = 'ghMpDlg'; mpDlg.innerHTML = `<form>
      <b>Birlikte oyna</b>
      <p>Şu an oyunda olan herkesle aynı köyde oynarsınız. Birbirinizi adınızla görürsünüz.</p>
      <div class="modes2" id="ghMpMode">
        <button type="button" data-m="takim" class="on"><b>Birlikte botlara karşı</b><span>Aynı takımdasınız, botlarla savaşırsınız</span></button>
        <button type="button" data-m="pvp"><b>Herkes birbirine karşı</b><span>Oyuncular birbirini vurur, bot yok</span></button>
      </div>
      <label>Adınız<input id="ghMpName" maxlength="16" autocomplete="nickname" placeholder="Örn. Serhat" required></label>
      <div class="row"><button type="button" id="ghMpNo">Vazgeç</button><button type="submit" id="ghMpGo">Katıl</button></div>
      <small id="ghMpMsg"></small></form>`;
  hud.appendChild(mpDlg);
  const stopEv = (e) => e.stopPropagation();
  for (const ev of ['pointerdown', 'mousedown', 'click', 'touchstart']) { mpBtn.addEventListener(ev, stopEv); mpDlg.addEventListener(ev, stopEv); }
  mpBtn.addEventListener('click', () => {
    if (G.mp) { mpLeave(); return; }
    if (document.pointerLockElement) document.exitPointerLock();
    G.firing = false; el('ghMpName').value = myName; el('ghMpMsg').textContent = ''; mpDlg.style.display = 'grid';
    setTimeout(() => el('ghMpName').focus(), 50);
  });
  el('ghMpNo').addEventListener('click', () => { mpDlg.style.display = 'none'; });
  el('ghMpMode').addEventListener('click', (e) => { const t = e.target.closest('[data-m]'); if (!t) return; G.mode = t.dataset.m; for (const o of el('ghMpMode').children) o.classList.toggle('on', o === t); });
  mpDlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); mpJoin(el('ghMpName').value); });
  async function mpJoin(name) {
    if (G.mp || mpConnecting) return;
    myName = cleanName(name); try { localStorage.setItem('kk_mp_name', myName); } catch (_) {}
    mpConnecting = true; el('ghMpGo').disabled = true; el('ghMpMsg').textContent = 'Bağlanıyor…';
    try {
      const net = await joinRoom(ROOMS[G.mode], onMsg);
      if (!G.on) { net.close(); return; }
      G.mp = net; G.joinT = Date.now(); G.joinG = G.time; G.isHost = false; setAi(0); mpDlg.style.display = 'none'; mpSendT = 0;
      G.roundOver = false; respawnPlayer(); net.send({ t: 'hi' }); sendState();
      feed(G.mode === 'takim' ? 'Takıma katıldınız. Takım arkadaşlarınız haritada mavi görünür.' : 'Oyuna katıldınız. Diğer oyuncular haritada mavi görünür.'); drawPlayers();
    } catch (err) {
      console.warn('birlikte oyna', err); el('ghMpMsg').textContent = 'Bağlanamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
    } finally { mpConnecting = false; el('ghMpGo').disabled = false; }
  }
  function mpLeave() {
    if (!G.mp) { mpDlg.style.display = 'none'; return; }
    try { G.mp.send({ t: 'bye' }); } catch (_) {}
    const net = G.mp; G.mp = null; setTimeout(() => net.close(), 300);
    for (const b of [...remotes.values()]) removeRemote(b, true);
    clearShadows(); G.isHost = false; setAi(G.botCount);
    G.roundT = 300; drawPlayers();
  }
  addEventListener('pagehide', () => { if (G.mp) try { G.mp.send({ t: 'bye' }); } catch (_) {} });
  let listHtml = '';
  function drawPlayers() {
    const on = !!G.mp;
    const btn = on ? `👥 ${remotes.size + 1} kişi · Ayrıl` : '👥 Birlikte oyna';
    if (mpBtn.textContent !== btn) mpBtn.textContent = btn;
    mpBtn.classList.toggle('on', on);
    let h = '';
    if (on) {
      const rows = [{ name: myName + ' (siz)', k: G.kills, d: G.deaths, me: true }, ...[...remotes.values()].map(b => ({ name: b.name, k: b.kills, d: b.deaths }))].sort((a, b) => b.k - a.k || a.d - b.d);
      h = rows.map(r => `<div class="${r.me ? 'me' : ''}"><span>${esc(r.name)}</span><b>${r.k} : ${r.d}</b></div>`).join('');
      if (!remotes.size) h += '<div class="wait">Başka oyuncu bekleniyor…</div>';
      const nb = G.isHost ? G.bots.filter(o => !o.remote).length : shadows.length;
      h = `<div class="mode">${G.mode === 'takim' ? 'Takım · ' + nb + ' bot' : 'Herkes birbirine karşı'}</div>` + h;
    }
    if (h !== listHtml) { listHtml = h; mpList.innerHTML = h; mpList.style.display = h ? 'block' : 'none'; }
  }
  // a link with #birlikte opens the name box as soon as the Game starts
  const wantMp = /birlikte/.test(location.hash);

  // ------------------------------------------------------------------ lifecycle
  function start() {
    G.on = true; group.visible = true; hud.style.display = 'block';
    if (isTouch) for (const b of [fireBtn, reloadBtn, jumpBtn]) b.classList.add('show');
    vm.visible = true; warmAudio();
    if (!G.bots.length) for (let i = 0; i < G.botCount; i++) G.bots.push(spawnBot(i));
    crowd.load().then(() => { for (const b of G.bots) attachChar(b); }).catch(e => console.warn('bot characters', e));
    newRound();
    if (wantMp && !G.mp) { el('ghMpName').value = myName; mpDlg.style.display = 'grid'; }
  }
  function newRound() {
    G.kills = 0; G.deaths = 0; G.roundT = 300; G.roundOver = false; G.dead = 0; G.feed = []; respawnPlayer();
    for (const b of G.bots) if (!b.remote) respawnBot(b);
  }
  function stop() {
    mpLeave(); look.assist = 1; G.on = false; group.visible = false; hud.style.display = 'none'; for (const b of touchBtns) b.classList.remove('show'); setScope(false); vm.visible = false; for (const l of tracers) l.visible = false; for (const p of puffs) p.visible = false; G.firing = false; fireId = null; touchIn.jump = false; if (cross) { cross.classList.remove('off'); cross.style.removeProperty('--gap'); } hudCache.clear(); for (const k in hudNum) delete hudNum[k];
  }
  /** Loading: show (then hide again) one of everything the game draws, so a frame rendered in between prepares it all. */
  function warm(on) {
    group.visible = on; vm.visible = on; vmFlash.visible = on;
    for (const k in models) models[k].visible = on || (G.on && k === G.weapon);
    for (const l of tracers) l.visible = on; for (const p of puffs) p.visible = on;
    for (const k in IM) { IM[k].count = on ? 1 : 0; IM[k].visible = on; }
  }
  function setBots(n) {
    G.botCount = n;
    if (G.mp && G.mode === 'takim' && !G.isHost) { G.mp.send({ t: 'bc', n }); return; }   // the room's host runs the bots: ask them
    if (G.mp && G.mode === 'pvp') return;   // players against players: no bots
    setAi(n);
  }
  function setAi(n) {
    const ai = G.bots.filter(b => !b.remote), rem = G.bots.filter(b => b.remote);
    n = Math.min(n, MAX_BOTS - rem.length);
    while (ai.length > n) { const b = ai.pop(); group.remove(b.mesh); if (b.char) b.char.dispose(); }
    while (ai.length < n) ai.push(spawnBot(ai.length));
    G.bots = ai.concat(rem);
  }
  function setPrimary(k) { if (!WEAPONS[k] || WEAPONS[k].slot !== 1) return; G.primary = k; if (G.on) { G.ammo[k] = { mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve }; setWeapon(k); } }
  function setDifficulty(d) { G.difficulty = d; }
  function cycleWeapon(dir) { const order = [G.primary, 'deagle', 'knife'], i = order.indexOf(G.weapon); setWeapon(order[(i + dir + 3) % 3]); }
  function update(dt, now) {
    if (!G.on) return;
    G.time += dt;
    if (!G.roundOver && !G.mp) { G.roundT -= dt; if (G.roundT <= 0) { G.roundOver = true; el('ghEndTxt').textContent = `${G.kills} vuruş · ${G.deaths} ölüm`; setScope(false); } }
    if (G.dead > 0) { G.dead -= dt; if (G.dead <= 0) respawnPlayer(); }
    G.hurt = Math.max(0, G.hurt - dt * 1.6); G.fireCd = Math.max(0, G.fireCd - dt); G.swapT = Math.max(0, G.swapT - dt); G.heat = Math.max(0, G.heat - dt * 0.02);
    const W = WEAPONS[G.weapon], A = G.ammo[G.weapon];
    if (G.reloading > 0) { G.reloading -= dt; if (G.reloading <= 0) { const need = W.mag - A.mag, take = Math.min(need, A.reserve); A.mag += take; A.reserve -= take; G.reloading = 0; } }
    G.fireQueue = Math.max(0, (G.fireQueue || 0) - dt);
    if ((G.firing || G.fireQueue > 0) && G.dead <= 0) { const wasFired = G.fired; if (!G.firing) G.fired = false; fire(); if (!G.firing) G.fired = wasFired; }
    for (let i = 0; i < G.feed.length; i++) G.feed[i].t -= dt;
    while (G.feed.length && G.feed[G.feed.length - 1].t <= 0) G.feed.pop();   // newest first: the oldest lines expire at the end
    markVisibleBots(); losLeft = LOS_PER_FRAME;
    for (let i = 0; i < G.bots.length; i++) { const b = G.bots[i]; if (b.remote) remoteStep(b, dt); else if (G.isHost && remotes.size) botStepTeam(b, dt); else botStep(b, dt); }
    mpUpdate(dt);
    if (isTouch) aimAssist();
    animateChars(dt);
    // view model: bob while walking, kick on firing, lowered while reloading / swapping
    const moving = isMoving();
    G.bob += dt * (moving ? (isRunning() ? 11 : 7) : 2);
    G.kick = Math.max(0, G.kick - dt * 9);
    const rel = G.reloading > 0 ? Math.sin(Math.min(Math.PI, (W.reload - G.reloading) / W.reload * Math.PI)) : 0, swap = G.swapT / 0.45;
    const rest = REST[G.weapon], rx = rest[0], ry = rest[1], rz = rest[2];
    vm.position.set(rx + Math.sin(G.bob) * 0.007 * (moving ? 1 : 0.3), ry + Math.abs(Math.cos(G.bob)) * 0.009 * (moving ? 1 : 0.3) - rel * 0.14 - swap * 0.35, rz + G.kick * 0.07 * W.kick);
    vm.rotation.set(0.02 - G.kick * 0.1 * W.kick + rel * 0.55 + swap * 0.6, 0.06 + (G.weapon === 'knife' ? -0.5 : 0) + G.kick * (G.weapon === 'knife' ? -0.8 : 0), rel * 0.2);
    vmFlash.visible = G.time - G.lastShot < 0.035 && !W.melee;
    updateFx(dt);
    syncBotInstances();
    updateHud();
  }
  // v1.20, phones: aim friction. While the crosshair is within a few degrees of a bot in view that can see you (so not
  // through a wall), dragging turns the view up to 45 % slower, so a thumb can settle on him. It never moves the aim by
  // itself. Read by index.html's touch look through look.assist.
  function aimAssist() {
    let best = 1;
    if (G.dead <= 0 && !G.roundOver) {
      const cp = Math.cos(P.pitch), dx0 = -Math.sin(P.yaw) * cp, dy0 = Math.sin(P.pitch), dz0 = -Math.cos(P.yaw) * cp, ey = P.y + EYE;
      const near = (G.scoped ? 0.6 : 2.5) * Math.PI / 180, far = (G.scoped ? 1.5 : 6) * Math.PI / 180;
      for (let i = 0; i < G.bots.length; i++) {
        const b = G.bots[i]; if (b.dead > 0 || !b.vis || !b.hasLos) continue;
        const vx = b.x - P.x, vy = b.y + 1.3 - ey, vz = b.z - P.z, d = Math.sqrt(vx * vx + vy * vy + vz * vz); if (d < 1 || d > 120) continue;
        const c = (vx * dx0 + vy * dy0 + vz * dz0) / d; if (c <= 0) continue;
        const a = Math.acos(Math.min(1, c)), k = a <= near ? 0 : a >= far ? 1 : (a - near) / (far - near);
        best = Math.min(best, 0.55 + 0.45 * k);
      }
    }
    look.assist = best;
  }
  /** bots on the minimap: red dots, only within 60 m (no wallhack radar) */
  function drawMinimap(mctx, toPx) {
    for (let i = 0; i < G.bots.length; i++) { const b = G.bots[i]; if (b.dead > 0 || ((!b.remote || b.shadow) && len2(b.x - P.x, b.z - P.z) > 60)) continue; const pt = toPx(b.x, b.z), u = pt[0], v = pt[1]; mctx.fillStyle = b.remote && !b.shadow ? '#2f7fe0' : '#d13b2a'; mctx.beginPath(); mctx.arc(u, v, 3, 0, 6.283); mctx.fill(); }
  }
  // ------------------------------------------------------------------ input
  addEventListener('mousedown', e => { if (!G.on || !document.pointerLockElement) return; if (e.button === 0) { G.firing = true; G.fired = false; } if (e.button === 2 && WEAPONS[G.weapon].scope) setScope(!G.scoped); });
  addEventListener('mouseup', e => { if (e.button === 0) { G.firing = false; G.fired = false; } });
  addEventListener('contextmenu', e => { if (G.on && document.pointerLockElement) e.preventDefault(); });
  addEventListener('wheel', e => { if (G.on && document.pointerLockElement) cycleWeapon(e.deltaY > 0 ? 1 : -1); }, { passive: true });
  addEventListener('keydown', e => {
    if (!G.on || (e.target && e.target.tagName === 'INPUT')) return;
    if (e.code === 'KeyR') reload();
    if (e.code === 'Digit1') setWeapon(G.primary); if (e.code === 'Digit2') setWeapon('deagle'); if (e.code === 'Digit3') setWeapon('knife');
    if (e.code === 'KeyQ') setWeapon(G.lastWeapon);
    if (e.code === 'Enter' && G.roundOver) newRound();
  });

  return { start, stop, update, renderOverlay, drawMinimap, setBots, setPrimary, setDifficulty, fire, reload, setWeapon, setScope, warm, state: G, newRound, WEAPONS };
}
