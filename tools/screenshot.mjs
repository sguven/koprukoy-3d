// Headless screenshot harness for Köprüköy 3D.
// Serves the repo over HTTP, redirects the jsDelivr importmap to a local copy of three.js,
// and captures the named viewpoints. Usage: node shoot.mjs <outdir> [view,view,...] [hour]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const REPO = process.env.REPO || new URL('..', import.meta.url).pathname;
const THREE_DIR = process.env.THREE_DIR || new URL('../node_modules/three', import.meta.url).pathname; // npm i three@0.170.0 puppeteer-core
const out = process.argv[2] || '/home/claude/work/shots';
const views = (process.argv[3] || 'genel;kopru;gezi;kanyon;detay;tepe').split(';');
const hour = process.argv[4] ? +process.argv[4] : null;
const W = +(process.env.W || 1600), H = +(process.env.H || 900);
fs.mkdirSync(out, { recursive: true });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let file;
  if (p.startsWith('/three/')) file = path.join(THREE_DIR, p.slice(7));
  else file = path.join(REPO, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf ' + p); return; }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) {
    let s = body.toString();
    s = s.replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js', '/three/build/three.module.js')
         .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/', '/three/examples/jsm/');
    if (!s.includes('window.__kk')) s = s.replace('</script>\n</body>', 'window.__kk = { go, setSun, setMode, camera, controls, renderer, scene, P, CS, surfaceAt, sun, hemi, terrH };\n</script>\n</body>');
    body = Buffer.from(s);
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise(r => server.listen(8765, r));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 600000,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`, '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
page.on('console', m => { const t = m.text(); if (!/favicon|fonts\.g/.test(t)) console.log('[page]', t.slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
const t0 = Date.now();
await page.goto('http://localhost:8765/' + (process.env.HASH || ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('loading') || /could not/.test(document.getElementById('loading').textContent), { timeout: 600000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.evaluate(() => { document.querySelectorAll('.panel,.topbar,.hint,#labels').forEach(e => e.style.display = 'none'); });
if (hour !== null) await page.evaluate(h => window.__kk.setSun(h), hour);
const settle = async (frames) => { await page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), frames); };
for (const v of views) {
  const t1 = Date.now();
  if (v.startsWith('cam:')) { const [px, py, pz, tx, ty, tz] = v.slice(4).split(',').map(Number); await page.evaluate((px, py, pz, tx, ty, tz) => { const k = window.__kk; k.setMode('orbit'); k.camera.position.set(px, py, pz); k.controls.target.set(tx, ty, tz); k.controls.update(); }, px, py, pz, tx, ty, tz); }
  else if (v.startsWith('mode:')) { await page.evaluate(m => window.__kk.setMode(m), v.slice(5)); }
  else if (v.startsWith('walk:')) { // walk:x,z,yaw
    const [x, z, yaw] = v.slice(5).split(',').map(Number);
    await page.evaluate((x, z, yaw) => { const k = window.__kk; k.setMode('walk'); k.P.x = x; k.P.z = z; k.P.yaw = yaw; k.P.pitch = 0.02; k.P.y = k.surfaceAt(x, z).y; k.P.vy = 0; }, x, z, yaw);
  } else await page.evaluate(v => window.__kk.go(v, true), v);
  await settle(4);
  await page.screenshot({ path: path.join(out, `${v.replace(/[:,]/g, '_')}.jpg`), type: 'jpeg', quality: 88 });
  console.log('shot', v, ((Date.now() - t1) / 1000).toFixed(1), 's');
}
const stats = await page.evaluate(() => { const r = window.__kk.renderer; return { calls: r.info.render.calls, tris: r.info.render.triangles, geoms: r.info.memory.geometries, tex: r.info.memory.textures, programs: r.info.programs.length }; });
console.log('renderer', JSON.stringify(stats));
await browser.close(); server.close();
