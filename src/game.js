// Köprüköy Arena — a small Counter-Strike-like deathmatch against bots, played in the village with the walk
// controls (v0.9.6). The player carries a rifle; bots patrol the lanes, spot the player, chase and shoot back.
// Everything here is low-poly on purpose: the point is the real village as a map, not the graphics.
//
// Line of sight and bullets use the collision data the walk mode already has: the terrain height field and the
// building boxes (D.buildings: x, z, yaw, half-width, half-depth), taken as 5.5 m high walls.
import * as THREE from 'three';

const BOT_NAMES = ['Keskinli', 'Kırıkkaleli', 'Çeşnigir', 'Kapulukaya', 'Hırka', 'Köprübaşı', 'Kızılırmak', 'Bozkır', 'Karakeçili', 'Ceritler', 'Yeşilyurt', 'Göçeri'];
const COLORS = { skin: 0xc9a27e, cloth: 0x2e2f33, vest: 0x4a4f3a, team: 0xa8322a, gun: 0x1a1a1c };

export function createGame(ctx) {
  const { scene, camera, P, D, terrH, surfaceAt, pushOut, kd, isTouch, EYE } = ctx;
  const G = {
    on: false, bots: [], botCount: 8, health: 100, mag: 30, reserve: 90, reloading: 0, fireCd: 0, kills: 0, deaths: 0,
    dead: 0, roundT: 300, roundOver: false, kick: 0, bob: 0, lastShot: 0, feed: [], hurt: 0, firing: false, time: 0,
  };
  const group = new THREE.Group(); group.name = 'Arena'; group.visible = false; scene.add(group);
  const rnd = Math.random;

  // ------------------------------------------------------------------ materials / shared geometry
  const mat = (c, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.0, ...extra });
  const M = { skin: mat(COLORS.skin), cloth: mat(COLORS.cloth), vest: mat(COLORS.vest), team: mat(COLORS.team), gun: mat(COLORS.gun, { roughness: 0.5, metalness: 0.5 }), flash: new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }) };
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff3c0, transparent: true, opacity: 0.8 });
  const puffMat = new THREE.SpriteMaterial({ color: 0xd8cbb0, transparent: true, opacity: 0.8, depthWrite: false });

  // ------------------------------------------------------------------ sound (synthesised, no files)
  let ac = null;
  const sound = (kind, dist = 0) => {
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime, att = 1 / (1 + dist / 25);
      if (kind === 'shot' || kind === 'botshot') {
        const n = ac.createBufferSource(), len = Math.floor(ac.sampleRate * 0.18), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
        n.buffer = buf; const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = kind === 'shot' ? 2600 : 1400; const g = ac.createGain(); g.gain.value = (kind === 'shot' ? 0.5 : 0.35) * att;
        n.connect(f); f.connect(g); g.connect(ac.destination); n.start(t);
        const o = ac.createOscillator(), og = ac.createGain(); o.type = 'square'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); og.gain.setValueAtTime(0.25 * att, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.connect(og); og.connect(ac.destination); o.start(t); o.stop(t + 0.15);
      } else if (kind === 'hit') { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = 1400; g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.09); }
      else if (kind === 'hurt') { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.2); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + 0.26); }
      else if (kind === 'reload') { for (let i = 0; i < 2; i++) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'square'; o.frequency.value = 900 + i * 300; g.gain.setValueAtTime(0.08, t + i * 0.5); g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.5 + 0.06); o.connect(g); g.connect(ac.destination); o.start(t + i * 0.5); o.stop(t + i * 0.5 + 0.07); } }
    } catch (e) { /* no audio */ }
  };

  // ------------------------------------------------------------------ world queries
  const B = D.buildings, WALL_H = 5.5;
  const inBuilding = (x, y, z) => {
    for (let k = 0; k < B.length; k += 5) {
      const dx = x - B[k], dz = z - B[k + 1]; if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
      const c = Math.cos(B[k + 2]), s = Math.sin(B[k + 2]), lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < B[k + 3] && Math.abs(lz) < B[k + 4] && y < terrH(x, z) + WALL_H) return true;
    }
    return false;
  };
  /** first obstacle along a segment: { t, x, y, z } or null (t in metres from a) */
  const trace = (ax, ay, az, bx, by, bz, step = 1.5) => {
    const L = Math.hypot(bx - ax, by - ay, bz - az), n = Math.max(1, Math.ceil(L / step));
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      if (y < terrH(x, z) || inBuilding(x, y, z)) return { t: t * L, x, y: Math.max(y, terrH(x, z)), z };
    }
    return null;
  };
  const roadPoint = (near, minD, maxD) => {   // a random road sample at a distance from `near`
    const R = D.roads;
    for (let tries = 0; tries < 200; tries++) {
      const k = Math.floor(rnd() * (R.length / 4)) * 4, x = R[k], z = R[k + 1], d = Math.hypot(x - near.x, z - near.z);
      if (d < minD || d > maxD) continue;
      if (x < -60 || x > 760 || z < -300 || z > 780) continue;   // the village
      const g = surfaceAt(x, z); if (g.water) continue;
      return { x, z };
    }
    return { x: near.x + 50, z: near.z + 50 };
  };

  // ------------------------------------------------------------------ bots
  function botMesh() {
    const g = new THREE.Group();
    const leg = () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.85, 0.24), M.cloth); m.position.y = 0.425; return m; };
    const l1 = leg(), l2 = leg(); l1.position.x = -0.13; l2.position.x = 0.13; g.add(l1, l2);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), M.vest); torso.position.y = 1.17; g.add(torso);
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.2, 0.34), M.team); shirt.position.y = 1.5; g.add(shirt);   // red scarf: the other team
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), M.skin); head.position.y = 1.72; g.add(head);
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), M.cloth); mask.position.y = 1.73; g.add(mask);
    const arm = () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.16), M.cloth); return m; };
    const a1 = arm(), a2 = arm(); a1.position.set(-0.34, 1.2, 0); a2.position.set(0.34, 1.2, 0); g.add(a1, a2);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.75), M.gun); gun.position.set(0.18, 1.25, -0.4); g.add(gun);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), M.flash); flash.position.set(0.18, 1.25, -0.82); flash.visible = false; g.add(flash);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    g.userData = { l1, l2, a1, a2, flash };
    return g;
  }
  function spawnBot(i) {
    const p = roadPoint(P, 70, 260);
    const b = { id: i, name: BOT_NAMES[i % BOT_NAMES.length], x: p.x, z: p.z, y: surfaceAt(p.x, p.z).y, yaw: rnd() * 6.28, hp: 100, state: 'patrol', target: null, seen: 0, lastSeen: null, burst: 0, cd: 1 + rnd(), walk: 0, stuck: 0, lastX: p.x, lastZ: p.z, dead: 0, mesh: botMesh(), losT: rnd() * 0.3, hasLos: false };
    b.mesh.position.set(b.x, b.y, b.z); group.add(b.mesh);
    return b;
  }
  function killBot(b) {
    b.dead = 6; b.state = 'dead'; b.hp = 0; G.kills++; feed(`${b.name} vuruldu`); sound('hit');
  }
  function respawnBot(b) {
    const p = roadPoint(P, 90, 260); b.x = p.x; b.z = p.z; b.y = surfaceAt(p.x, p.z).y; b.hp = 100; b.state = 'patrol'; b.target = null; b.dead = 0; b.mesh.rotation.set(0, b.yaw, 0); b.mesh.position.set(b.x, b.y, b.z); b.cd = 1.5;
  }
  function botStep(b, dt) {
    const u = b.mesh.userData;
    if (b.dead > 0) {   // falls over, lies for a while, respawns
      b.dead -= dt; const k = Math.min(1, (6 - b.dead) / 0.45);
      b.mesh.rotation.x = -Math.PI / 2 * k; b.mesh.position.y = b.y + 0.15 * k;
      if (b.dead <= 0) respawnBot(b);
      return;
    }
    const ex = P.x, ez = P.z, dx = ex - b.x, dz = ez - b.z, dist = Math.hypot(dx, dz);
    // line of sight to the player, checked a few times a second
    b.losT -= dt;
    if (b.losT <= 0) {
      b.losT = 0.25 + rnd() * 0.15;
      b.hasLos = dist < 110 && G.dead <= 0 && !trace(b.x, b.y + 1.6, b.z, ex, P.y + EYE - 0.2, ez, 2.0);
      if (b.hasLos) { b.lastSeen = { x: ex, z: ez }; b.seen = 5; }
    }
    b.seen -= dt;
    if (b.hasLos) b.state = dist < 30 ? 'hold' : 'chase';
    else if (b.seen > 0 && b.lastSeen) b.state = 'search';
    else if (b.state !== 'patrol') { b.state = 'patrol'; b.target = null; }
    // movement target
    let tx = null, tz = null, speed = 3.4;
    if (b.state === 'patrol') {
      if (!b.target || Math.hypot(b.target.x - b.x, b.target.z - b.z) < 3) b.target = roadPoint(b, 25, 140);
      tx = b.target.x; tz = b.target.z; speed = 2.6;
    } else if (b.state === 'chase') { tx = ex; tz = ez; speed = 4.2; }
    else if (b.state === 'search') { tx = b.lastSeen.x; tz = b.lastSeen.z; speed = 3.6; if (Math.hypot(tx - b.x, tz - b.z) < 3) { b.seen = 0; } }
    else if (b.state === 'hold') { // strafe a little, keep distance
      const side = Math.sin(G.time * 1.3 + b.id) ; tx = b.x + (-dz / dist) * side * 3; tz = b.z + (dx / dist) * side * 3; speed = 1.6;
    }
    if (tx !== null) {
      const ddx = tx - b.x, ddz = tz - b.z, L = Math.hypot(ddx, ddz) || 1;
      if (L > 0.5) {
        const nx = b.x + ddx / L * speed * dt, nz = b.z + ddz / L * speed * dt, q = { x: nx, z: nz };
        pushOut(q, 0.4);
        const g = surfaceAt(q.x, q.z, b.y + 0.5);
        if (!g.water && g.y - b.y < 1.2) { b.x = q.x; b.z = q.z; b.y += (g.y - b.y) * Math.min(1, dt * 10); }
        b.walk += speed * dt;
      }
      const want = Math.atan2(ddx, ddz); let dy = want - b.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; b.yaw += dy * Math.min(1, dt * 6);
    }
    if (b.hasLos) { b.yaw = Math.atan2(dx, dz); }
    // stuck check (new patrol target every second without progress)
    b.stuck += dt;
    if (b.stuck > 1) { if (Math.hypot(b.x - b.lastX, b.z - b.lastZ) < 0.4 && b.state === 'patrol') b.target = null; b.lastX = b.x; b.lastZ = b.z; b.stuck = 0; }
    // shooting: bursts of three when the player is in sight
    b.cd -= dt;
    u.flash.visible = false;
    if (b.hasLos && G.dead <= 0 && !G.roundOver) {
      if (b.cd <= 0) {
        if (b.burst <= 0) { b.burst = 3; }
        b.burst--; b.cd = b.burst > 0 ? 0.11 : 0.9 + rnd() * 0.9;
        u.flash.visible = true; sound('botshot', dist);
        const moving = kd('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');
        const p = Math.max(0.06, 0.42 - dist / 160) * (moving ? 0.65 : 1.0);
        if (rnd() < p) hurtPlayer(12 + Math.floor(rnd() * 7), b);
      }
    }
    // pose
    const sw = Math.sin(b.walk * 2.6) * (tx !== null ? 0.55 : 0);
    u.l1.rotation.x = sw; u.l2.rotation.x = -sw; u.a1.rotation.x = -sw * 0.6; u.a2.rotation.x = sw * 0.6;
    b.mesh.position.set(b.x, b.y, b.z); b.mesh.rotation.set(0, b.yaw, 0);
  }

  // ------------------------------------------------------------------ player
  const vm = new THREE.Group();   // rifle view model, child of the camera
  {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.7), M.gun); body.position.set(0, 0, -0.2);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.38, 8), M.gun); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.02, -0.72);
    const magz = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.08), M.gun); magz.position.set(0, -0.14, -0.22); magz.rotation.x = 0.25;
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.3), mat(0x5a3b23)); stock.position.set(0, -0.03, 0.3);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, 0.06), mat(0x5a3b23)); grip.position.set(0, -0.11, 0.02); grip.rotation.x = 0.35;
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.03), M.gun); sight.position.set(0, 0.075, -0.1);
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), M.flash); flash.position.set(0, 0.02, -0.95); flash.visible = false;
    vm.add(body, barrel, magz, stock, grip, sight, flash); vm.userData.flash = flash;
    vm.position.set(0.24, -0.22, -0.45); vm.rotation.set(0.02, 0.06, 0);
    vm.traverse(o => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; } });
  }
  const fx = [];   // short-lived tracers / puffs: { obj, t }
  function tracer(a, b) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(g, tracerMat.clone()); group.add(l); fx.push({ obj: l, t: 0.06 });
  }
  function puff(x, y, z, size = 0.6) {
    const s = new THREE.Sprite(puffMat.clone()); s.position.set(x, y, z); s.scale.setScalar(size); group.add(s); fx.push({ obj: s, t: 0.35, grow: true });
  }
  function fire() {
    if (G.dead > 0 || G.roundOver || G.reloading > 0 || G.fireCd > 0) return;
    if (G.mag <= 0) { reload(); return; }
    G.mag--; G.fireCd = 0.1; G.kick = 1; G.lastShot = G.time; sound('shot');
    vm.userData.flash.visible = true;
    // direction with a little spread (more while moving / running)
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    const moving = kd('KeyW', 'KeyA', 'KeyS', 'KeyD'), spread = (moving ? 0.022 : 0.008) + Math.min(0.03, G.recoil * 0.004);
    dir.x += (rnd() - 0.5) * spread; dir.y += (rnd() - 0.5) * spread; dir.z += (rnd() - 0.5) * spread; dir.normalize();
    G.recoil = Math.min(10, (G.recoil || 0) + 1);
    const o = camera.position.clone(), RANGE = 220;
    // nearest bot hit (body / head spheres), then check nothing is in the way
    let best = null;
    for (const b of G.bots) {
      if (b.dead > 0) continue;
      for (const [cy, r] of [[1.05, 0.42], [1.72, 0.24]]) {
        const c = new THREE.Vector3(b.x, b.y + cy, b.z), oc = c.clone().sub(o), t = oc.dot(dir);
        if (t < 0 || t > RANGE) continue;
        const d2 = oc.lengthSq() - t * t;
        if (d2 < r * r && (!best || t < best.t)) best = { t, b, head: cy > 1.5 };
      }
    }
    let end = o.clone().addScaledVector(dir, best ? best.t : RANGE);
    const wall = trace(o.x, o.y, o.z, end.x, end.y, end.z, 1.0);
    if (wall) { end.set(wall.x, wall.y, wall.z); puff(wall.x, wall.y, wall.z); best = null; }
    else if (best) {
      const dmg = best.head ? 100 : 28 + Math.floor(rnd() * 8); best.b.hp -= dmg; puff(end.x, end.y, end.z, 0.4); sound('hit');
      if (best.b.hp <= 0) killBot(best.b); else { best.b.hasLos = true; best.b.seen = 5; best.b.lastSeen = { x: P.x, z: P.z }; }
    }
    const muzzle = new THREE.Vector3(0.24, -0.2, -1.0).applyMatrix4(camera.matrixWorld);
    tracer(muzzle, end);
  }
  function reload() {
    if (G.reloading > 0 || G.mag >= 30 || G.reserve <= 0) return;
    G.reloading = 2.0; sound('reload');
  }
  function hurtPlayer(dmg, from) {
    if (G.dead > 0) return;
    G.health -= dmg; G.hurt = 1; sound('hurt');
    if (G.health <= 0) { G.health = 0; G.dead = 3.5; G.deaths++; feed(`${from.name} seni vurdu`); }
  }
  function respawnPlayer() {
    const [sx, sz] = D.spawn.walk; P.x = sx; P.z = sz; P.y = surfaceAt(sx, sz).y; P.vy = 0; G.health = 100; G.mag = 30; G.reserve = 90; G.reloading = 0;
  }
  function feed(msg) { G.feed.unshift({ msg, t: 5 }); if (G.feed.length > 5) G.feed.pop(); }

  // ------------------------------------------------------------------ HUD
  const hud = document.createElement('div'); hud.id = 'gameHud'; hud.innerHTML = `
    <div class="gh-top"><span id="ghScore">0 : 0</span><span id="ghTime">5:00</span></div>
    <div class="gh-feed" id="ghFeed"></div>
    <div class="gh-health"><div class="gh-bar"><i id="ghHp"></i></div><b id="ghHpTxt">100</b></div>
    <div class="gh-ammo"><b id="ghMag">30</b><span id="ghRes">/ 90</span><em id="ghRel"></em></div>
    <div class="gh-hurt" id="ghHurt"></div>
    <div class="gh-dead" id="ghDead"><div><b>VURULDUN</b><span id="ghDeadTxt">yeniden doğuyorsun…</span></div></div>
    <div class="gh-end" id="ghEnd"><div><b>TUR BİTTİ</b><span id="ghEndTxt"></span><small>Enter: yeni tur</small></div></div>`;
  document.body.appendChild(hud);
  const el = (id) => document.getElementById(id);
  const fireBtn = document.createElement('div'); fireBtn.className = 'tc pad'; fireBtn.id = 'tFire'; fireBtn.textContent = 'FIRE'; document.body.appendChild(fireBtn);
  const reloadBtn = document.createElement('div'); reloadBtn.className = 'tc pad'; reloadBtn.id = 'tReload'; reloadBtn.textContent = 'R'; document.body.appendChild(reloadBtn);
  fireBtn.addEventListener('pointerdown', e => { G.firing = true; e.stopPropagation(); e.preventDefault(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) fireBtn.addEventListener(ev, () => { G.firing = false; });
  reloadBtn.addEventListener('pointerdown', e => { reload(); e.stopPropagation(); });
  function updateHud() {
    el('ghScore').textContent = `${G.kills} : ${G.deaths}`;
    const t = Math.max(0, Math.ceil(G.roundT)); el('ghTime').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    el('ghHp').style.width = `${G.health}%`; el('ghHp').style.background = G.health > 50 ? '#7cc26b' : G.health > 25 ? '#e0b24a' : '#d14b3a'; el('ghHpTxt').textContent = G.health;
    el('ghMag').textContent = G.mag; el('ghRes').textContent = `/ ${G.reserve}`; el('ghRel').textContent = G.reloading > 0 ? 'reloading' : (G.mag === 0 ? 'R: reload' : '');
    el('ghFeed').innerHTML = G.feed.map(f => `<div style="opacity:${Math.min(1, f.t / 1.5).toFixed(2)}">${f.msg}</div>`).join('');
    el('ghHurt').style.opacity = (G.hurt * 0.55).toFixed(2);
    el('ghDead').style.display = G.dead > 0 ? 'grid' : 'none'; if (G.dead > 0) el('ghDeadTxt').textContent = `yeniden doğuyorsun… ${Math.ceil(G.dead)}`;
    el('ghEnd').style.display = G.roundOver ? 'grid' : 'none';
  }

  // ------------------------------------------------------------------ lifecycle
  function start() {
    G.on = true; group.visible = true; hud.style.display = 'block';
    if (isTouch) { fireBtn.classList.add('show'); reloadBtn.classList.add('show'); }
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
    G.on = false; group.visible = false; hud.style.display = 'none'; fireBtn.classList.remove('show'); reloadBtn.classList.remove('show'); camera.remove(vm); G.firing = false;
  }
  function setBots(n) {
    G.botCount = n;
    while (G.bots.length > n) { const b = G.bots.pop(); group.remove(b.mesh); }
    while (G.bots.length < n) G.bots.push(spawnBot(G.bots.length));
  }
  function update(dt, now) {
    if (!G.on) return;
    G.time += dt;
    if (!G.roundOver) { G.roundT -= dt; if (G.roundT <= 0) { G.roundOver = true; el('ghEndTxt').textContent = `${G.kills} vuruş · ${G.deaths} ölüm`; } }
    if (G.dead > 0) { G.dead -= dt; if (G.dead <= 0) respawnPlayer(); }
    G.hurt = Math.max(0, G.hurt - dt * 1.6); G.fireCd = Math.max(0, G.fireCd - dt); G.recoil = Math.max(0, (G.recoil || 0) - dt * 6);
    if (G.reloading > 0) { G.reloading -= dt; if (G.reloading <= 0) { const need = 30 - G.mag, take = Math.min(need, G.reserve); G.mag += take; G.reserve -= take; G.reloading = 0; } }
    if (G.firing && G.dead <= 0) fire();
    for (const f of G.feed) f.t -= dt; G.feed = G.feed.filter(f => f.t > 0);
    for (const b of G.bots) botStep(b, dt);
    // view model: bob while walking, kick on firing, lowered while reloading
    const moving = kd('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');
    G.bob += dt * (moving ? (kd('ShiftLeft', 'ShiftRight') ? 11 : 7) : 2);
    G.kick = Math.max(0, G.kick - dt * 9);
    const rel = G.reloading > 0 ? Math.sin(Math.min(Math.PI, (2.0 - G.reloading) / 2.0 * Math.PI)) : 0;
    vm.position.set(0.24 + Math.sin(G.bob) * 0.006 * (moving ? 1 : 0.3), -0.22 + Math.abs(Math.cos(G.bob)) * 0.008 * (moving ? 1 : 0.3) - rel * 0.12, -0.45 + G.kick * 0.06);
    vm.rotation.set(0.02 - G.kick * 0.08 + rel * 0.5, 0.06, 0);
    vm.userData.flash.visible = G.time - G.lastShot < 0.04;
    for (let i = fx.length - 1; i >= 0; i--) { const f = fx[i]; f.t -= dt; if (f.grow) { f.obj.scale.multiplyScalar(1 + dt * 4); f.obj.material.opacity = Math.max(0, f.t * 2); } if (f.t <= 0) { group.remove(f.obj); f.obj.geometry && f.obj.geometry.dispose(); f.obj.material.dispose(); fx.splice(i, 1); } }
    updateHud();
  }
  /** bots on the minimap: red dots in the player's frame (ctx is already translated / rotated / scaled) */
  function drawMinimap(mctx, toPx) {
    for (const b of G.bots) { if (b.dead > 0) continue; const [u, v] = toPx(b.x, b.z); mctx.fillStyle = '#d13b2a'; mctx.beginPath(); mctx.arc(u, v, 3, 0, 6.283); mctx.fill(); }
  }
  // ------------------------------------------------------------------ input
  addEventListener('mousedown', e => { if (G.on && e.button === 0 && document.pointerLockElement) { G.firing = true; } });
  addEventListener('mouseup', e => { if (e.button === 0) G.firing = false; });
  addEventListener('keydown', e => { if (!G.on) return; if (e.code === 'KeyR') reload(); if (e.code === 'Enter' && G.roundOver) newRound(); });

  return { start, stop, update, drawMinimap, setBots, fire, reload, state: G, newRound };
}
