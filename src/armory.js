// v1.24 Game extras: hand grenades and smoke grenades, the first-aid post in front of the old municipality where
// health comes back, and the gun shop in Güvendioğlu Market across the square (money from kills buys guns, grenades,
// a steel vest and ammunition).
//
// Kept light for phones: every effect is a fixed pool of sprites made at start (nothing is created during a fight, no
// lights are added, so no shader is compiled mid-game); smoke uses 7 big soft sprites on a phone and 10 on a desktop.
import * as THREE from 'three';
import { grenadeModel } from './gunmodels.js';

// first-aid post and shop door (model metres; see the çarşı layout in src/village_layout.js)
export const HEAL = { x: 245.0, z: 127.5, r: 2.6, rate: 14 };
export const SHOP = { x: 255.2, z: 123.8, r: 3.6, doorX: 257.5, sign: { x: 257.62, z: 123.9 } };

export function createArmory(o) {
  const { group, camera, P, G, EYE, terrH, surfaceAt, inBuilding, sound, puff, feed, damageBot, hurtPlayer, alertBot, isTouch, WEAPONS, PRICES, equip } = o;
  const rnd = () => Math.random();
  const _v = new THREE.Vector3(), _g = { y: 0 };

  // ---------------------------------------------------------------- textures (made once)
  const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const softTex = canvasTex(128, 128, (x, w) => {   // smoke puff: soft lumpy disc
    for (let i = 0; i < 9; i++) {
      const cx = 64 + (Math.sin(i * 2.4) * 22), cy = 64 + (Math.cos(i * 1.7) * 18), r = 34 + (i % 3) * 8;
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(0.6, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, w);
    }
  });
  const fireTex = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 31); g.addColorStop(0, 'rgba(255,255,230,1)'); g.addColorStop(0.3, 'rgba(255,190,80,0.95)'); g.addColorStop(0.65, 'rgba(220,80,20,0.5)'); g.addColorStop(1, 'rgba(120,30,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });
  const scorchTex = canvasTex(64, 64, (x) => { const g = x.createRadialGradient(32, 32, 2, 32, 32, 31); g.addColorStop(0, 'rgba(15,12,10,0.8)'); g.addColorStop(0.6, 'rgba(25,20,15,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); });

  // ---------------------------------------------------------------- grenades in flight
  const NADES = 4, nades = [];
  const nadeGeo = { he: grenadeModel('he'), smoke: grenadeModel('smoke') };
  for (let i = 0; i < NADES; i++) {
    const m = { he: nadeGeo.he.clone(), smoke: nadeGeo.smoke.clone() };
    for (const k in m) { m[k].visible = false; m[k].scale.setScalar(1.6); group.add(m[k]); }   // a little bigger than life so it can be followed in the air
    nades.push({ on: false, kind: 'he', m, p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0, spin: 0, rest: 0 });
  }
  let nadeI = 0;
  const FUSE = { he: 1.8, smoke: 1.4 };
  function throwNade(kind) {
    if (G.dead > 0 || G.roundOver || G.shopOpen || (G.nades[kind] || 0) <= 0 || G.throwT > 0) return false;
    G.nades[kind]--; G.throwT = 0.55; G.throwKind = kind; G.reloading = 0;
    const n = nades[nadeI]; nadeI = (nadeI + 1) % NADES;
    if (n.on) explode(n);   // the oldest still in the air goes off now
    n.on = true; n.kind = kind; n.t = FUSE[kind]; n.rest = 0; n.spin = 0;
    const dir = camera.getWorldDirection(_v);
    n.p.copy(camera.position).addScaledVector(dir, 0.5); n.p.y -= 0.1;
    // throw about 15 m/s along the view, lifted a little, plus the player's own run
    n.v.copy(dir).multiplyScalar(15.5); n.v.y += 3.2;
    n.v.x += (P.x - (G.lastPX ?? P.x)) / Math.max(1e-3, G.lastDt || 0.016) * 0.6; n.v.z += (P.z - (G.lastPZ ?? P.z)) / Math.max(1e-3, G.lastDt || 0.016) * 0.6;
    for (const k in n.m) n.m[k].visible = k === kind;
    sound('throw');
    return true;
  }
  function stepNade(n, dt) {
    n.t -= dt;
    const sub = 3, h = dt / sub;
    for (let s = 0; s < sub; s++) {
      if (n.rest > 0.3) break;
      n.v.y -= 9.81 * h;
      const nx = n.p.x + n.v.x * h, ny = n.p.y + n.v.y * h, nz = n.p.z + n.v.z * h;
      // walls: bounce off the building boxes, one axis at a time
      if (inBuilding(nx, ny, nz)) {
        const sp = Math.hypot(n.v.x, n.v.z);
        if (inBuilding(nx, ny, n.p.z)) n.v.x *= -0.45; if (inBuilding(n.p.x, ny, nz)) n.v.z *= -0.45;
        if (!inBuilding(n.p.x, ny, n.p.z)) n.v.y *= 0.8;
        if (sp > 3) sound('bounce', len(n.p));
        continue;
      }
      const gy = surfaceAt(nx, nz, ny + 0.5).y + 0.05;
      if (ny <= gy) {
        if (n.v.y < -2.5) sound('bounce', len(n.p));
        n.p.set(nx, gy, nz); n.v.y = Math.abs(n.v.y) < 1.5 ? 0 : -n.v.y * 0.3; const f = n.v.y === 0 ? Math.max(0, 1 - h * 6) : 0.45; n.v.x *= f; n.v.z *= f;
        if (Math.hypot(n.v.x, n.v.z) < 0.4 && n.v.y === 0) n.rest += h;
      } else n.p.set(nx, ny, nz);
    }
    if (n.rest <= 0.3) n.spin += dt * 9;
    const m = n.m[n.kind]; m.position.copy(n.p); m.rotation.set(n.spin, n.spin * 0.6, 0);
    if (n.t <= 0) explode(n);
  }
  const len = (p) => Math.hypot(p.x - P.x, p.y - P.y, p.z - P.z);

  // ---------------------------------------------------------------- explosion: fireball, flash, dust, scorch, damage
  const BOOMS = 3, booms = [];
  for (let i = 0; i < BOOMS; i++) {
    const fire = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    const dust = []; for (let k = 0; k < 6; k++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0x6b5f52, transparent: true, depthWrite: false })); s.visible = false; group.add(s); dust.push(s); }
    const scorch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    fire.visible = false; scorch.visible = false; group.add(fire, scorch);
    booms.push({ fire, dust, scorch, t: 0, st: 0, p: new THREE.Vector3(), dv: dust.map(() => new THREE.Vector3()) });
  }
  let boomI = 0;
  const R_HE = 9.5;
  function explode(n) {
    n.on = false; for (const k in n.m) n.m[k].visible = false;
    if (n.kind === 'smoke') { startSmoke(n.p); return; }
    const p = n.p, d = len(p);
    const b = booms[boomI]; boomI = (boomI + 1) % BOOMS;
    b.p.copy(p); b.t = 1.6; b.st = 20;
    b.fire.position.set(p.x, p.y + 0.6, p.z); b.fire.visible = true;
    b.scorch.position.set(p.x, surfaceAt(p.x, p.z, p.y + 0.5).y + 0.03, p.z); b.scorch.scale.setScalar(3.4); b.scorch.visible = true; b.scorch.material.opacity = 1;
    b.dust.forEach((s, k) => { const a = k / 6 * Math.PI * 2; b.dv[k].set(Math.cos(a) * (2 + rnd() * 2), 2.5 + rnd() * 2.5, Math.sin(a) * (2 + rnd() * 2)); s.position.set(p.x, p.y + 0.4, p.z); s.scale.setScalar(1.2); s.material.opacity = 0.75; s.visible = true; });
    for (let k = 0; k < 4; k++) puff(p.x + (rnd() - 0.5) * 2, p.y + 0.3 + rnd(), p.z + (rnd() - 0.5) * 2, 0.9);
    sound('boom', d);
    G.shake = Math.max(G.shake, Math.max(0, 1 - d / 40));
    // damage: falls off with distance, walls and the ground shield (one sight line per target)
    const cx = p.x, cy = p.y + 0.4, cz = p.z;
    for (const bot of o.bots()) {
      if (bot.dead > 0) continue;
      const dx = bot.x - cx, dz = bot.z - cz, dy = bot.y + 1 - cy, dd = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dd < 40) alertBot(bot, P.x, P.z);
      if (dd > R_HE || o.trace(cx, cy, cz, bot.x, bot.y + 1, bot.z, 0.5)) continue;
      damageBot(bot, Math.round(115 * Math.pow(1 - dd / R_HE, 1.3)), false, 'El bombası');
    }
    const pd = Math.hypot(P.x - cx, P.y + 1 - cy, P.z - cz);
    if (pd < R_HE && !o.trace(cx, cy, cz, P.x, P.y + 1, P.z, 0.5)) hurtPlayer(Math.round(100 * Math.pow(1 - pd / R_HE, 1.3)), { what: 'Kendi bombanla öldün' });
  }
  function updateBooms(dt) {
    for (const b of booms) {
      if (b.st > 0) { b.st -= dt; b.scorch.material.opacity = Math.min(1, b.st / 4); if (b.st <= 0) b.scorch.visible = false; }
      if (b.t <= 0) continue;
      b.t -= dt; const age = 1.6 - b.t;
      if (b.fire.visible) { const k = age / 0.35; b.fire.scale.setScalar(1 + 5 * Math.min(1, k * 2)); b.fire.material.opacity = Math.max(0, 1 - k); if (k >= 1) b.fire.visible = false; }
      b.dust.forEach((s, k) => { const v = b.dv[k]; v.multiplyScalar(1 - dt * 2.2); v.y -= dt * 1.2; s.position.addScaledVector(v, dt); s.scale.setScalar(1.2 + age * 2.6); s.material.opacity = Math.max(0, 0.75 * (1 - age / 1.6)); if (b.t <= 0) s.visible = false; });
    }
  }

  // ---------------------------------------------------------------- smoke clouds
  const PER = isTouch ? 7 : 10, CLOUDS = 2, SMOKE_T = 17, clouds = [];
  for (let i = 0; i < CLOUDS; i++) {
    const s = [];
    for (let k = 0; k < PER; k++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, color: 0xc9cbc8, transparent: true, depthWrite: false })); sp.visible = false; sp.material.rotation = k * 1.3; group.add(sp); s.push(sp); }
    clouds.push({ s, t: 0, p: new THREE.Vector3(), off: s.map(() => new THREE.Vector3()), r: 0 });
  }
  let cloudI = 0;
  function startSmoke(p) {
    const c = clouds[cloudI]; cloudI = (cloudI + 1) % CLOUDS;
    c.t = SMOKE_T; c.p.copy(p); c.r = 0;
    c.s.forEach((sp, k) => { const a = k / PER * Math.PI * 2 + rnd(), r = k === 0 ? 0 : 1.6 + rnd() * 2.2; c.off[k].set(Math.cos(a) * r, 0.9 + (k % 3) * 0.9 + rnd() * 0.6, Math.sin(a) * r); sp.visible = true; sp.material.opacity = 0; });
    sound('pop', len(p));
  }
  function updateSmoke(dt) {
    for (const c of clouds) {
      if (c.t <= 0) continue;
      c.t -= dt; const age = SMOKE_T - c.t, grow = Math.min(1, age / 2.2);
      c.r = 4.6 * Math.sqrt(grow) * (c.t < 3 ? Math.max(0.2, c.t / 3) : 1);   // radius that blocks sight
      const fade = c.t < 3 ? c.t / 3 : 1;
      c.s.forEach((sp, k) => {
        const o2 = c.off[k], drift = age * 0.05;
        sp.position.set(c.p.x + o2.x * (0.3 + 0.7 * grow) + drift, c.p.y + o2.y * (0.4 + 0.6 * grow) + age * 0.02, c.p.z + o2.z * (0.3 + 0.7 * grow));
        sp.scale.setScalar(1 + 5.2 * grow + age * 0.06); sp.material.opacity = 0.92 * Math.min(1, age * 2) * fade;
        sp.material.rotation += dt * 0.04 * (k % 2 ? 1 : -1);
        if (c.t <= 0) sp.visible = false;
      });
    }
  }
  /** Does the segment a→b pass through a smoke cloud? (bots cannot see or aim through smoke) */
  function smokeBlocks(ax, ay, az, bx, by, bz) {
    for (const c of clouds) {
      if (c.t <= 0 || c.r < 1) continue;
      const cx = c.p.x, cy = c.p.y + 1.6, cz = c.p.z, dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / L2));
      const qx = ax + dx * t - cx, qy = (ay + dy * t - cy) * 1.6, qz = az + dz * t - cz;
      if (qx * qx + qy * qy + qz * qz < c.r * c.r) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- first-aid post (Kızılay) in front of the municipality
  const heal = new THREE.Group(); heal.name = 'Game_FirstAid'; group.add(heal);
  {
    const gy = terrH(HEAL.x, HEAL.z);
    const ring = new THREE.Mesh(new THREE.RingGeometry(HEAL.r - 0.25, HEAL.r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3fd36a, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    ring.position.set(HEAL.x, surfaceAt(HEAL.x, HEAL.z, gy + 1).y + 0.04, HEAL.z); heal.add(ring); heal.userData.ring = ring;
    const crossTex = canvasTex(128, 128, (x) => { x.fillStyle = '#f4f2ec'; x.fillRect(0, 0, 128, 128); x.fillStyle = '#d6211a'; x.beginPath(); x.arc(58, 64, 40, 0, Math.PI * 2); x.fill(); x.fillStyle = '#f4f2ec'; x.beginPath(); x.arc(72, 64, 34, 0, Math.PI * 2); x.fill(); });
    const signTex = canvasTex(256, 64, (x) => { x.fillStyle = '#d6211a'; x.fillRect(0, 0, 256, 64); x.fillStyle = '#fff'; x.font = 'bold 36px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('SAĞLIK', 128, 34); });
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 0.9), new THREE.MeshStandardMaterial({ color: 0xeeece6, roughness: 0.6 }));
    const cx = HEAL.x - HEAL.r - 0.4, cy = surfaceAt(cx, HEAL.z, gy + 1).y;
    cab.position.set(cx, cy + 0.75, HEAL.z); heal.add(cab);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ map: crossTex })); face.rotation.y = Math.PI / 2; face.position.set(cx + 0.26, cy + 0.85, HEAL.z); heal.add(face);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.23), new THREE.MeshBasicMaterial({ map: signTex })); sign.rotation.y = Math.PI / 2; sign.position.set(cx + 0.26, cy + 1.35, HEAL.z); heal.add(sign);
  }
  let healTick = 0;
  function updateHeal(dt) {
    const ring = heal.userData.ring; ring.material.opacity = 0.45 + 0.25 * Math.sin(G.time * 4);
    G.healing = false;
    if (G.dead > 0 || G.roundOver) return;
    if (Math.hypot(P.x - HEAL.x, P.z - HEAL.z) < HEAL.r && G.health < 100) {
      G.healing = true; G.healAcc = (G.healAcc || 0) + HEAL.rate * dt;
      const add = Math.floor(G.healAcc); if (add > 0) { G.healAcc -= add; G.health = Math.min(100, G.health + add); healTick += add; if (healTick >= 10) { healTick = 0; sound('heal'); } }
    }
  }

  // ---------------------------------------------------------------- the gun shop (Güvendioğlu Market)
  const shopSign = (() => {
    const t = canvasTex(512, 96, (x) => { x.fillStyle = '#1d1b19'; x.fillRect(0, 0, 512, 96); x.strokeStyle = '#d9a441'; x.lineWidth = 6; x.strokeRect(5, 5, 502, 86); x.fillStyle = '#f2c35b'; x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('SİLAHÇI', 256, 52); });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), new THREE.MeshBasicMaterial({ map: t }));
    const gy = surfaceAt(SHOP.doorX - 1, SHOP.z, terrH(SHOP.x, SHOP.z) + 1).y;
    m.position.set(SHOP.sign.x - 0.45, gy + 3.05, SHOP.sign.z); m.rotation.y = -Math.PI / 2; group.add(m); return m;
  })();
  const ITEMS = [
    { id: 'glock', group: 'Tabanca' }, { id: 'deagle', group: 'Tabanca' },
    { id: 'mp5', group: 'Tüfek' }, { id: 'm3', group: 'Tüfek' }, { id: 'ak47', group: 'Tüfek' }, { id: 'm4a1', group: 'Tüfek' }, { id: 'awp', group: 'Tüfek' }, { id: 'm249', group: 'Tüfek' },
    { id: 'he', group: 'Ekipman', name: 'El bombası', note: 'G / BOMBA, en fazla 3' }, { id: 'smoke', group: 'Ekipman', name: 'Sis bombası', note: 'F / SİS, en fazla 2' },
    { id: 'armor', group: 'Ekipman', name: 'Çelik yelek', note: 'hasarın yarısını alır' }, { id: 'ammo', group: 'Ekipman', name: 'Cephane', note: 'bütün şarjörler dolar' },
  ];
  const NOTE = { glock: 'hafif, hızlı', deagle: 'güçlü tabanca', mp5: 'çok hızlı, yakın', m3: 'pompalı, çok yakın', ak47: 'güçlü, sert teper', m4a1: 'isabetli', awp: 'dürbünlü, tek atış', m249: '100 mermi' };
  const MAX = { he: 3, smoke: 2 };
  const panel = document.createElement('div'); panel.id = 'ghShop'; panel.className = 'gh-shop';
  panel.innerHTML = `<div class="gs-box"><div class="gs-head"><b>SİLAHÇI</b><span id="gsMoney"></span><button id="gsClose" type="button">KAPAT</button></div><div class="gs-grid" id="gsGrid"></div><small>${isTouch ? 'Dokun: satın al' : 'Tıkla ya da 1–9: satın al · B / Esc: kapat'}</small></div>`;
  document.body.appendChild(panel);   // above the touch buttons and the top bar
  const gridEl = panel.querySelector('#gsGrid'), moneyEl = panel.querySelector('#gsMoney');
  const shopBtn = document.createElement('div'); shopBtn.className = 'tc pad'; shopBtn.id = 'tShop'; shopBtn.textContent = 'SİLAHÇI'; document.body.appendChild(shopBtn);
  const owned = (id) => id === G.primary || id === G.secondary;
  function itemState(it) {
    const price = PRICES[it.id];
    if (WEAPONS[it.id] && owned(it.id)) return { ok: false, why: 'elinde' };
    if (it.id === 'he' || it.id === 'smoke') { if (G.nades[it.id] >= MAX[it.id]) return { ok: false, why: 'dolu' }; }
    if (it.id === 'armor' && G.armor >= 100) return { ok: false, why: 'giyili' };
    if (G.money < price) return { ok: false, why: 'para yetmez' };
    return { ok: true };
  }
  function renderShop() {
    moneyEl.textContent = `${G.money} ₺`;
    let html = '', grp = '';
    ITEMS.forEach((it, i) => {
      if (it.group !== grp) { grp = it.group; html += `<div class="gs-group">${grp}</div>`; }
      const st = itemState(it), W = WEAPONS[it.id];
      const extra = it.id === 'he' || it.id === 'smoke' ? ` · ${G.nades[it.id]}/${MAX[it.id]}` : it.id === 'armor' && G.armor > 0 ? ` · %${G.armor}` : '';
      html += `<button type="button" class="gs-item${st.ok ? '' : ' no'}" data-i="${i}"><em>${isTouch ? '' : (i + 1 <= 9 ? i + 1 : '')}</em><b>${it.name || W.name}</b><span>${it.note || NOTE[it.id] || ''}${extra}</span><i>${st.ok ? PRICES[it.id] + ' ₺' : st.why}</i></button>`;
    });
    gridEl.innerHTML = html;
  }
  function buy(i) {
    const it = ITEMS[i]; if (!it) return;
    const st = itemState(it); if (!st.ok) return;
    G.money -= PRICES[it.id]; sound('buy');
    if (WEAPONS[it.id]) { equip(it.id); feed(`${WEAPONS[it.id].name} satın aldın`); }
    else if (it.id === 'he' || it.id === 'smoke') G.nades[it.id]++;
    else if (it.id === 'armor') G.armor = 100;
    else if (it.id === 'ammo') { for (const k in WEAPONS) { const A = G.ammo[k]; A.reserve = WEAPONS[k].reserve; if (!WEAPONS[k].melee) A.mag = WEAPONS[k].mag; } }
    renderShop();
  }
  gridEl.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) buy(+b.dataset.i); });   // a click, so a long list can still be scrolled on a phone held upright
  panel.addEventListener('pointerdown', e => e.stopPropagation());
  panel.querySelector('#gsClose').addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); closeShop(); });
  shopBtn.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); G.shopOpen ? closeShop() : openShop(); });
  const nearShop = () => G.dead <= 0 && !G.roundOver && Math.hypot(P.x - SHOP.x, P.z - SHOP.z) < SHOP.r;
  function openShop() {
    if (!nearShop() || G.shopOpen) return;
    G.shopOpen = true; G.firing = false; renderShop(); panel.style.display = 'grid';
    if (document.pointerLockElement) document.exitPointerLock();
    o.onShop && o.onShop(true);
  }
  function closeShop() { if (!G.shopOpen) return; G.shopOpen = false; panel.style.display = 'none'; o.onShop && o.onShop(false); }
  addEventListener('keydown', e => {
    if (!G.on) return;
    if (e.code === 'KeyB') { G.shopOpen ? closeShop() : openShop(); }
    else if (G.shopOpen && e.code === 'Escape') closeShop();
    else if (G.shopOpen && /^Digit[1-9]$/.test(e.code)) { buy(+e.code.slice(5) - 1); e.stopImmediatePropagation(); }
  }, true);
  let wasNear = false;
  function updateShop() {
    const near = nearShop();
    if (near !== wasNear) { wasNear = near; shopBtn.classList.toggle('show', near && isTouch); if (near && !isTouch) o.hint && o.hint('B: silah dükkanı'); if (!near) closeShop(); }
    if (G.shopOpen && G.dead > 0) closeShop();
  }

  // ---------------------------------------------------------------- lifecycle
  function update(dt) {
    for (const n of nades) if (n.on) stepNade(n, dt);
    updateBooms(dt); updateSmoke(dt); updateHeal(dt); updateShop();
  }
  function reset() {
    for (const n of nades) { n.on = false; for (const k in n.m) n.m[k].visible = false; }
    for (const b of booms) { b.t = 0; b.st = 0; b.fire.visible = false; b.scorch.visible = false; b.dust.forEach(s => s.visible = false); }
    for (const c of clouds) { c.t = 0; c.s.forEach(s => s.visible = false); }
    closeShop();
  }
  function stop() { reset(); shopBtn.classList.remove('show'); wasNear = false; }
  /** Loading: show one of everything so the first grenade compiles nothing. */
  function warm(on) {
    for (const n of nades) for (const k in n.m) n.m[k].visible = on;
    for (const b of booms) { b.fire.visible = on; b.scorch.visible = on; b.dust.forEach(s => s.visible = on); }
    for (const c of clouds) c.s.forEach(s => s.visible = on);
    if (on) for (const b of booms) b.fire.position.copy(camera.position);
  }
  function drawMinimap(mctx, toPx) {
    const h = toPx(HEAL.x, HEAL.z); mctx.fillStyle = '#fff'; mctx.fillRect(h[0] - 5, h[1] - 5, 10, 10); mctx.fillStyle = '#d6211a'; mctx.fillRect(h[0] - 4, h[1] - 1.5, 8, 3); mctx.fillRect(h[0] - 1.5, h[1] - 4, 3, 8);
    const s = toPx(SHOP.doorX + 2, SHOP.z); mctx.fillStyle = '#f2c35b'; mctx.beginPath(); mctx.arc(s[0], s[1], 4.5, 0, 6.283); mctx.fill(); mctx.fillStyle = '#1d1b19'; mctx.font = 'bold 7px sans-serif'; mctx.textAlign = 'center'; mctx.textBaseline = 'middle'; mctx.fillText('₺', s[0], s[1] + 0.5);
  }
  /** (tests and the benchmark) set off a grenade at a point */
  function blastAt(kind, x, y, z) { const n = nades[nadeI]; nadeI = (nadeI + 1) % NADES; n.kind = kind; n.p.set(x, y, z); explode(n); }
  return { blastAt, throwNade, update, smokeBlocks, openShop, closeShop, reset, stop, warm, drawMinimap, nearShop, shopBtn, shopSign };
}
