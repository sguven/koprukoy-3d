// v1.23 "Birlikte oyna" test: two headless pages in one browser, joined through ?mp=local (BroadcastChannel), play the
// team room (shared bots, no friendly fire, a bot killed by the guest, the host leaving) and the players-against-players
// room. Needs `npm i --no-save three@0.170.0` and playwright resolvable from the repo. Usage: node tools/mp_test.mjs
// (screenshots in /tmp/mp_shots; set OUT to change)
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const REPO = '/home/user/koprukoy-3d', THREE_DIR = path.join(REPO, 'node_modules/three'), out = process.env.OUT || '/tmp/mp_shots'; fs.mkdirSync(out, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let file = p.startsWith('/three/') ? path.join(THREE_DIR, p.slice(7)) : path.join(REPO, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) { let s = body.toString();
    s = s.replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js', '/three/build/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/', '/three/examples/jsm/');
    s = s.replace('</script>\n</body>', 'window.__kk = { setMode, camera, P, surfaceAt, game: () => game };\n</script>\n</body>'); body = Buffer.from(s); }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(body);
});
await new Promise(r => server.listen(0, r)); const port = server.address().port;
const browser = await chromium.launch({ args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 500 } });
await ctx.addInitScript(() => { try { localStorage.setItem('kk_tp', '0'); localStorage.setItem('kk_quality', 'smooth'); } catch (_) {} });
const mk = async (tag) => { const pg = await ctx.newPage(); pg.on('pageerror', e => console.log(tag, '[pageerror]', e.message)); pg.on('console', m => { const t = m.text(); if (/error|warn|birlikte|covered/i.test(t) && !/WebGL|GPU|fonts/.test(t)) console.log(tag, '[c]', t.slice(0, 200)); });
  await pg.goto(`http://localhost:${port}/?mp=local`, { waitUntil: 'domcontentloaded', timeout: 300000 }); await pg.waitForFunction(() => !document.getElementById('loading'), null, { timeout: 900000 }); return pg; };
const t0 = Date.now(); const [A, B] = await Promise.all([mk('A'), mk('B')]); console.log('both loaded in', ((Date.now() - t0) / 1000).toFixed(0), 's');
const clk = (pg, sel) => pg.evaluate((sel) => { const e = document.querySelector(sel), r = e.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); if (top !== e && !e.contains(top)) console.log('covered ' + sel + ' by ' + (top && (top.id || top.className))); e.click(); }, sel);
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const place = (pg, x, z, yawDeg) => pg.evaluate(([x, z, h]) => { const k = window.__kk; k.P.x = x; k.P.z = z; k.P.yaw = h * Math.PI / 180; k.P.pitch = -0.02; k.P.y = k.surfaceAt(x, z).y; k.P.vy = 0; }, [x, z, yawDeg]);
const join = async (pg, name, mode) => { await clk(pg, '#ghMp'); await clk(pg, `#ghMpMode [data-m="${mode}"]`); await pg.evaluate((n) => { document.getElementById('ghMpName').value = n; }, name); await clk(pg, '#ghMpGo'); };
const st = (pg) => pg.evaluate(() => { const g = window.__kk.game().state; return { mp: !!g.mp, host: g.isHost, mode: g.mode, hp: g.health, kills: g.kills, deaths: g.deaths, ai: g.bots.filter(b => !b.remote).length, shadows: g.bots.filter(b => b.shadow).length, players: g.bots.filter(b => b.remote && !b.shadow).map(b => b.name + '@' + b.x.toFixed(0) + ',' + b.z.toFixed(0)), list: document.getElementById('ghPlayers').innerText.replace(/\n/g, ' | '), btn: document.getElementById('ghMp').textContent }; });
for (const pg of [A, B]) await pg.evaluate(() => window.__kk.setMode('game'));
await wait(1500);
const sp = await A.evaluate(() => { const g = window.__kk.game(); return [window.__kk.P.x, window.__kk.P.z]; });
await A.screenshot({ path: out + '/0-oyun-dugme.jpg', type: 'jpeg', quality: 80, timeout: 600000 });
await clk(A, '#ghMp'); await wait(300); await A.screenshot({ path: out + '/1-pencere.jpg', type: 'jpeg', quality: 80, timeout: 600000 }); await clk(A, '#ghMpNo');
// ---- co-op
await join(A, 'Ali', 'takim'); await wait(2500); await join(B, 'Veli', 'takim'); await wait(4000);
console.log('A', await st(A)); console.log('B', await st(B));
// Put B looking at A from 12 m
const [ax, az] = sp; await place(A, ax, az, 0); await place(B, ax + 0, az + 12, 0);   // yaw 0 looks to -z
await wait(2500);
await B.screenshot({ path: out + '/2-takim-B.jpg', type: 'jpeg', quality: 80, timeout: 600000 });
const hpBefore = (await st(A)).hp; await B.evaluate(() => { const g = window.__kk.game(); g.state.swapT = 0; g.state.fireCd = 0; g.fire(); }); await wait(800);
console.log('co-op friendly fire: A hp', hpBefore, '->', (await st(A)).hp);
// B shoots a shadow bot: move one in front of B (host A moves its bot)
await A.evaluate(([x, z]) => { const g = window.__kk.game().state; const b = g.bots.find(o => !o.remote && o.dead <= 0); b.x = x + 3; b.z = z - 8; b.y = window.__kk.surfaceAt(b.x, b.z).y; b.pauseT = 99; b.state = 'patrol'; b.route = null; window.__tb = b.id; }, [ax, az + 12]);
await wait(1500);
const r = await B.evaluate(() => { const g = window.__kk.game(), P = window.__kk.P; const s = g.state.bots.filter(b => b.shadow && b.dead <= 0).sort((p, q) => Math.hypot(p.x - P.x, p.z - P.z) - Math.hypot(q.x - P.x, q.z - P.z))[0];
  const dx = s.x - P.x, dz = s.z - P.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(s.y + 1.1 - (P.y + 1.6), Math.hypot(dx, dz)); return s.id + ' at ' + Math.hypot(dx, dz).toFixed(1); });
console.log('B aims at shadow', r);
for (let i = 0; i < 10; i++) { await B.evaluate((id) => { const g = window.__kk.game(), P = window.__kk.P; const s = g.state.bots.find(b => b.shadow && b.id === id); if (!s || s.dead > 0) return; const dx = s.x - P.x, dz = s.z - P.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(s.y + 1.1 - (P.y + 1.6), Math.hypot(dx, dz)); window.__kk.camera.position.set(P.x, P.y + 1.6, P.z); window.__kk.camera.rotation.set(P.pitch, P.yaw, 0, 'YXZ'); window.__kk.camera.updateMatrixWorld(); g.state.swapT = 0; g.state.fireCd = 0; g.state.heat = 0; g.fire(); }, +r.split(' ')[0]); await wait(400); }
await wait(800);
console.log('after B shooting: A', await st(A)); console.log('B', await st(B));
await B.screenshot({ path: out + '/3-takim-vurus-B.jpg', type: 'jpeg', quality: 80, timeout: 600000 });
await A.screenshot({ path: out + '/4-takim-A.jpg', type: 'jpeg', quality: 80, timeout: 600000 });
// host leaves -> B takes over
const tb0 = await B.evaluate(() => window.__kk.game().state.time); await clk(A, '#ghMp'); await wait(12000); console.log('B game time', tb0, '->', await B.evaluate(() => window.__kk.game().state.time), 'feed', await B.evaluate(() => document.getElementById('ghFeed').innerText)); console.log('after A leaves: B', await st(B)); console.log('A', await st(A));
await clk(B, '#ghMp'); await wait(500);
// ---- pvp
await join(A, 'Ali', 'pvp'); await wait(1000); await join(B, 'Veli', 'pvp'); await wait(2500);
await place(A, ax, az, 0); await place(B, ax, az + 12, 0); await wait(2000);
console.log('pvp A', await st(A)); console.log('pvp B', await st(B));
await B.evaluate(() => { const g = window.__kk.game(), P = window.__kk.P; const s = g.state.bots.find(b => b.remote && !b.shadow); const dx = s.x - P.x, dz = s.z - P.z; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(s.y + 1.1 - (P.y + 1.6), Math.hypot(dx, dz)); });
for (let i = 0; i < 8; i++) { await B.evaluate(() => { const g = window.__kk.game(); g.state.swapT = 0; g.state.fireCd = 0; g.state.heat = 0; g.fire(); }); await wait(250); }
await wait(800);
console.log('pvp after: A', await st(A)); console.log('B', await st(B));
await A.screenshot({ path: out + '/5-pvp-A.jpg', type: 'jpeg', quality: 80, timeout: 600000 }); await B.screenshot({ path: out + '/6-pvp-B.jpg', type: 'jpeg', quality: 80, timeout: 600000 });
await browser.close(); server.close();
