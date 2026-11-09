// Headless screenshot harness (Playwright edition). Serves the repo over HTTP, redirects the jsDelivr
// importmap to a local copy of three.js (npm i three@0.170.0, not committed) and captures views.
// Usage: node tools/shoot_pw.mjs <outdir> "<view>;<view>;..."
//   view = named viewpoint (genel, kopru, ...), cam:px,py,pz,tx,ty,tz, walk:x,z,headingDeg[,pitch][,label]
//   (heading in compass degrees, 0 = north, 90 = east; model frame x east, z south)
// Env: W, H (viewport), HASH (e.g. '#lite'), REPO, THREE_DIR
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO = process.env.REPO || new URL('..', import.meta.url).pathname;
const THREE_DIR = process.env.THREE_DIR || path.join(REPO, 'node_modules/three');
const out = process.argv[2] || '/tmp/shots';
const views = (process.argv[3] || 'genel').split(';').filter(Boolean);
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
fs.mkdirSync(out, { recursive: true });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let file = p.startsWith('/three/') ? path.join(THREE_DIR, p.slice(7)) : path.join(REPO, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf ' + p); return; }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) {
    let s = body.toString();
    s = s.replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js', '/three/build/three.module.js')
         .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/', '/three/examples/jsm/');
    if (!s.includes('window.__kk')) s = s.replace('</script>\n</body>', 'window.__kk = { go, setSun, setMode, camera, controls, renderer, scene, P, CS, surfaceAt, sun, hemi, terrH, D: () => D, V: () => VILLAGE };\n</script>\n</body>');
    body = Buffer.from(s);
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', m => { const t = m.text(); if (!/favicon|fonts\.g|THREE\.WebGLRenderer/.test(t)) console.log('[page]', t.slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
const t0 = Date.now();
await page.goto(`http://localhost:${port}/` + (process.env.HASH || ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('loading') || /could not/.test(document.getElementById('loading').textContent), null, { timeout: 900000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.evaluate(() => { document.querySelectorAll('.panel,.topbar,.hint,#labels,#minimap,#gearBtn,#modes,#views,#cross,#toast').forEach(e => e.style.display = 'none'); });
const settle = async (frames) => { await page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), frames); };
for (const v of views) {
  const t1 = Date.now();
  let name = v.replace(/[:,]/g, '_');
  if (v.startsWith('cam:')) { const [px, py, pz, tx, ty, tz] = v.slice(4).split(',').map(Number); await page.evaluate(([px, py, pz, tx, ty, tz]) => { const k = window.__kk; k.setMode('orbit'); k.camera.position.set(px, py, pz); k.controls.target.set(tx, ty, tz); k.controls.update(); }, [px, py, pz, tx, ty, tz]); }
  else if (v.startsWith('walk:')) { // walk:x,z,headingDeg[,pitch][,label]
    const parts = v.slice(5).split(','); const [x, z, hd] = parts.slice(0, 3).map(Number); const pitch = parts[3] !== undefined && parts[3] !== '' ? +parts[3] : 0.0; if (parts[4]) name = parts[4];
    await page.evaluate(([x, z, hd, pitch]) => { const k = window.__kk; k.setMode('walk'); k.P.x = x; k.P.z = z; k.P.yaw = -hd * Math.PI / 180; k.P.pitch = pitch; k.P.y = k.surfaceAt(x, z).y + 0.8; k.P.vy = 0; }, [x, z, hd, pitch]);
  } else await page.evaluate(v => window.__kk.go(v, true), v);
  await settle(4);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 85, timeout: 600000, animations: 'disabled' });
  console.log('shot', name, ((Date.now() - t1) / 1000).toFixed(1), 's');
}
const stats = await page.evaluate(() => { const r = window.__kk.renderer; return { calls: r.info.render.calls, tris: r.info.render.triangles }; });
console.log('renderer', JSON.stringify(stats));
await browser.close(); server.close();
