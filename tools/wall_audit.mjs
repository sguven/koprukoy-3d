// Lists the places where two walls, fences or hedges of different owners run side by side (0.45–3 m apart, MAXD to widen, nearly
// parallel, overlapping along their length). Loads the model headless like shoot_pw.mjs and reads the pieces the
// village builder recorded in group.userData.walls.  Usage: CHROME_PATH=... node tools/wall_audit.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const REPO = process.env.REPO || new URL('..', import.meta.url).pathname, THREE_DIR = process.env.THREE_DIR || path.join(REPO, 'node_modules/three');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = p.startsWith('/three/') ? path.join(THREE_DIR, p.slice(7)) : path.join(REPO, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) body = Buffer.from(body.toString().replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js', '/three/build/three.module.js')
    .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/', '/three/examples/jsm/').replace('</script>\n</body>', 'window.__kk = { scene };\n</script>\n</body>'));
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(body);
});
await new Promise(r => server.listen(0, r));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('loading') || /could not/.test(document.getElementById('loading').textContent), null, { timeout: 300000 });
const walls = await page.evaluate(() => { let w = null; window.__kk.scene.traverse(o => { if (o.userData && o.userData.walls) w = o.userData.walls; }); return w; });
await browser.close(); server.close();
if (!walls) { console.log('no wall record found'); process.exit(1); }
const hits = [], MAXD = +(process.env.MAXD || 3);   // MAXD: how far apart still counts as side by side (m)
for (let i = 0; i < walls.length; i++) {
  const [ax, az, bx, bz, own] = walls[i], mx = (ax + bx) / 2, mz = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
  for (let j = 0; j < walls.length; j++) {
    const w = walls[j]; if (w[4] === own || Math.abs(w[0] - mx) > 60 || Math.abs(w[1] - mz) > 60) continue;
    const Lw = Math.hypot(w[2] - w[0], w[3] - w[1]) || 1, vx = (w[2] - w[0]) / Lw, vz = (w[3] - w[1]) / Lw;
    if (Math.abs(ux * vx + uz * vz) < 0.75) continue;
    const s = (mx - w[0]) * vx + (mz - w[1]) * vz; if (s < 0 || s > Lw) continue;
    const d = Math.abs((mx - w[0]) * vz - (mz - w[1]) * vx);
    if (d > 0.45 && d < MAXD) { hits.push({ x: +mx.toFixed(1), z: +mz.toFixed(1), d: +d.toFixed(2), a: own, b: w[4] }); break; }
  }
}
// group the hits into places (within 12 m of each other, same pair of owners)
const places = [];
for (const h of hits) { const key = [h.a, h.b].sort().join(' | '); let p = places.find(q => q.key === key && Math.hypot(q.x - h.x, q.z - h.z) < 12); if (!p) places.push(p = { key, x: h.x, z: h.z, n: 0, dmin: h.d }); p.n++; p.dmin = Math.min(p.dmin, h.d); }
console.log(walls.length, 'pieces;', hits.length, 'pieces beside another wall, in', places.length, 'places');
for (const p of places) console.log(`  ${p.key.padEnd(22)} at ${p.x}, ${p.z}   ${p.n} pieces, closest ${p.dmin} m`);
