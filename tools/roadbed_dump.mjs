// v1.23: dumps the GLB road deck and the terrain meshes for tools/roadbed.py.
// Usage: node tools/roadbed_dump.mjs /tmp/roadbed_dump.json && python3 tools/roadbed.py /tmp/roadbed_dump.json
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const REPO = process.env.REPO || new URL('..', import.meta.url).pathname;
const THREE_DIR = process.env.THREE_DIR || path.join(REPO, 'node_modules/three');
const OUT = process.argv[2] || "/tmp/roadbed_dump.json";
// the D.260 deck ('Beton' in Yollar) and every terrain mesh, in world coordinates
const EXPR = "const k = window.__kk; const out = { meshes: [] };\nk.scene.traverse(o => {\n  if (!o.isMesh) return;\n  const pn = o.parent && o.parent.name;\n  const isDeck = pn === 'Yollar' && /^Beton$/.test(o.name);\n  const isT = /^Arazi/.test(o.name);\n  if (!isDeck && !isT) return;\n  o.updateMatrixWorld(true); const e = o.matrixWorld.elements, p = o.geometry.attributes.position, n = p.count;\n  const pos = new Array(n * 3);\n  for (let i = 0; i < n; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i);\n    pos[i * 3] = +(e[0] * x + e[4] * y + e[8] * z + e[12]).toFixed(3); pos[i * 3 + 1] = +(e[1] * x + e[5] * y + e[9] * z + e[13]).toFixed(3); pos[i * 3 + 2] = +(e[2] * x + e[6] * y + e[10] * z + e[14]).toFixed(3); }\n  const idx = o.geometry.index ? Array.from(o.geometry.index.array) : null;\n  out.meshes.push({ name: o.name, parent: pn, uuid: o.uuid, pos, idx });\n});\nout.grid = { x0: k.D().grid.x0, z0: k.D().grid.z0, size: k.D().grid.size, seg: k.D().grid.seg, h: Array.from(k.D().grid.h) };\nreturn out;\n";

const W = +(process.env.W || 1280), H = +(process.env.H || 800);

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
    if (!s.includes('window.__kk')) s = s.replace('</script>\n</body>', 'window.__kk = { go, setSun, setMode, camera, controls, renderer, scene, P, CS, surfaceAt, sun, hemi, terrH, D: () => D, V: () => VILLAGE, game: () => game, setGamePreset: typeof setGamePreset === "function" ? setGamePreset : null };\n</script>\n</body>');
    body = Buffer.from(s);
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', m => { const t = m.text(); if (!/favicon|fonts\.g|THREE\.WebGLRenderer/.test(t)) console.log('[page]', t.slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
// v1.18: Walk opens in third person (the character); these shots are first-person views unless TP=1
const t0 = Date.now();
await page.goto(`http://localhost:${port}/` + (process.env.HASH || ''), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !document.getElementById('loading') || /could not/.test(document.getElementById('loading').textContent), null, { timeout: 900000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
const res = await page.evaluate(new Function(EXPR));
fs.writeFileSync(OUT, JSON.stringify(res));
await browser.close(); server.close();
