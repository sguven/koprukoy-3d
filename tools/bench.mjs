// Game-mode benchmark runner (Playwright): opens the page with #bench=<bots>, waits for the run (src/bench.js)
// and prints / saves the result. Serves the repo like tools/shoot_pw.mjs (three.js from node_modules/three).
// Usage: node tools/bench.mjs [out.json]
// Env:
//   BOTS=50        20 / 50 / 100
//   MOBILE=1       phone emulation: 844×390 touch viewport (the page then uses its phone settings) and CPU_THROTTLE=4
//   CPU_THROTTLE=n main-thread slowdown factor (Chrome DevTools CPU throttling)
//   STEP=16.667    fixed simulation step in ms (default; STEP=0 runs in real time: only meaningful with a real GPU)
//   NODRAW=1       turn the WebGL draw calls into no-ops: the main-thread cost of a frame (game logic, scene
//                  traversal, state and uniform uploads) is measured without waiting for a software rasteriser.
//                  This is the default when no GPU is found (GPU=1 or NODRAW=0 to override).
//   SYNC=1         gl.finish() every frame: frame time includes the drawing (with a software GPU: seconds per frame)
//   TRACE=1        record a Chrome trace and name the functions that fill the 10 longest frames
//   PRESET=smooth  Game performance preset to run with (auto / smooth / quality)
//   ALLOC=1        sample the JS allocations during the run and name the functions that allocate most
//   HEADED=1, CHROME_ARGS="...", W, H, DPR, REPO, THREE_DIR
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const env = process.env, REPO = env.REPO || new URL('..', import.meta.url).pathname, THREE_DIR = env.THREE_DIR || path.join(REPO, 'node_modules/three');
const MOBILE = env.MOBILE === '1', BOTS = +(env.BOTS || 50), STEP = env.STEP === undefined ? 16.667 : +env.STEP, TRACE = env.TRACE === '1';
const W = +(env.W || (MOBILE ? 844 : 1366)), H = +(env.H || (MOBILE ? 390 : 768)), DPR = +(env.DPR || (MOBILE ? 3 : 1));
const THROTTLE = +(env.CPU_THROTTLE || (MOBILE ? 4 : 1));
const out = process.argv[2];

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json', '.wasm': 'application/wasm', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const file = p.startsWith('/three/') ? path.join(THREE_DIR, p.slice(7)) : path.join(REPO, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf ' + p); return; }
  let body = fs.readFileSync(file);
  if (file.endsWith('index.html')) body = Buffer.from(body.toString()
    .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js', '/three/build/three.module.js')
    .replace('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/', '/three/examples/jsm/'));
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
});
await new Promise(r => server.listen(0, r));

const gpuArgs = env.GPU === '1' ? ['--enable-gpu', '--use-angle=default'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ headless: env.HEADED !== '1', args: ['--no-sandbox', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--enable-precise-memory-info', '--autoplay-policy=no-user-gesture-required', ...gpuArgs, ...(env.CHROME_ARGS ? env.CHROME_ARGS.split(' ') : [])] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: MOBILE, isMobile: MOBILE });
const page = await context.newPage();
const software = env.GPU !== '1';
const NODRAW = env.NODRAW === undefined ? (software && env.SYNC !== '1') : env.NODRAW === '1';
if (NODRAW) await page.addInitScript(() => {
  for (const C of [self.WebGL2RenderingContext, self.WebGLRenderingContext]) { if (!C) continue; for (const f of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements', 'clear']) if (C.prototype[f]) C.prototype[f] = function () {}; }
});
page.on('console', m => { const t = m.text(); if (/^\[bench\]|could not/.test(t)) console.log('[page]', t.slice(0, 200)); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
const cdp = await context.newCDPSession(page);
if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

const hash = `#bench=${BOTS}` + (STEP ? `&step=${STEP}` : '') + (env.SYNC === '1' ? '&sync' : '') + (TRACE ? '&marks' : '') + (env.PRESET ? `&preset=${env.PRESET}` : '');
const traceEvents = [];
if (TRACE) {
  cdp.on('Tracing.dataCollected', e => { for (const ev of e.value) traceEvents.push(ev); });
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['blink.user_timing', 'devtools.timeline', 'v8', 'disabled-by-default-v8.cpu_profiler', 'disabled-by-default-devtools.timeline'], excludedCategories: ['*'] } });
}
if (env.ALLOC === '1') { await cdp.send('HeapProfiler.enable'); page.on('console', m => { if (/^\[bench\] start/.test(m.text())) cdp.send('HeapProfiler.startSampling', { samplingInterval: 2048, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }); }); }
const t0 = Date.now();
await page.goto(`http://localhost:${server.address().port}/${hash}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__benchResult, null, { timeout: +(env.TIMEOUT || 3600) * 1000, polling: 1000 });
const res = await page.evaluate(() => window.__benchResult);
res.runner = { mobile: MOBILE, cpuThrottle: THROTTLE, noDraw: NODRAW, viewport: [W, H, DPR], totalSeconds: (Date.now() - t0) / 1000 };

if (env.ALLOC === '1') {
  const { profile } = await cdp.send('HeapProfiler.stopSampling');
  const tot = new Map(); const walk = (n) => { const c = n.callFrame, k = (c.functionName || '(anonymous)') + ' · ' + (c.url || '').split('/').pop() + ':' + (c.lineNumber + 1); tot.set(k, (tot.get(k) || 0) + n.selfSize); for (const ch of n.children || []) walk(ch); };
  walk(profile.head);
  res.alloc = [...tot].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, v]) => [k, +(v / 1048576).toFixed(2)]);
}
if (TRACE) {
  const end = new Promise(r => cdp.once('Tracing.tracingComplete', r)); await cdp.send('Tracing.end'); await end;
  res.trace = analyseTrace(traceEvents, res);
}
await browser.close(); server.close();

const f = res.frame || res.js;
console.log(`\n${BOTS} bots · ${MOBILE ? 'phone emulation' : 'desktop'} · CPU ×${THROTTLE} · ${res.mode}${NODRAW ? ' · draw calls stubbed' : ''}${res.gpuSync ? ' · gpu sync' : ''} · ${res.gpu}`);
console.log(`frames ${res.frames} (${res.gameSeconds} s of game)   ${res.frame ? 'frame' : 'main thread'} p50 ${f.p50}  p95 ${f.p95}  p99 ${f.p99}  max ${f.max} ms   >33 ms: ${f.over33}   >50 ms: ${f.over50}`);
console.log(`game+walk p50 ${res.sim.p50} p95 ${res.sim.p95} · render p50 ${res.render.p50} p95 ${res.render.p95} ms`);
console.log(`draw calls ${res.drawCalls} · triangles ${(res.triangles / 1e6).toFixed(2)} M · shadow ${res.shadowMap}² redrawn ${res.shadow.redraws}× (${res.shadow.perSecond}/s; those frames ${res.shadow.frameMs} ms vs ${res.shadow.otherFrameMs} ms, ${(res.shadow.triangles / 1e6).toFixed(2)} M tris vs ${(res.shadow.trianglesOther / 1e6).toFixed(2)} M)`);
console.log(`shaders compiled in the run ${res.shadersCompiled} · enter ${res.enterMs} ms · first shot ${res.events.firstShot} ms · first switch ${res.events.firstSwitch} ms`);
if (res.heap) console.log(`heap ${res.heap.startMB} → ${res.heap.endMB} MB · allocated ${res.heap.allocatedMB} MB (${res.heap.allocMBperSec} MB/s) · GC drops ${res.heap.gcDrops}`);
if (res.eye) console.log(`eye height: ${res.eye.joltsOver5cm} jolts over 5 cm between frames (largest ${res.eye.maxStepCm} cm)`);
if (res.stuck) console.log(`route: stepped past an obstacle ${res.stuck}×`);
console.log('longest frames:'); for (const l of res.longest) console.log(`  t=${l.t}s ${l.ms} ms (game ${l.sim}, render ${l.render}) [${l.tags.join(' ')}]` + (l.why ? '  ← ' + l.why : ''));
if (res.trace) { console.log('main-thread self time over the whole run:'); for (const [n, ms, pc] of res.trace.top) console.log(`  ${String(ms).padStart(8)} ms ${String(pc).padStart(5)} %  ${n}`); console.log(`GC inside frames: ${res.trace.gcMs} ms in ${res.trace.gcCount} collections`); console.log('page work (ms, count):', JSON.stringify(res.trace.dom), 'placeLabels', res.trace.placeLabelsMs, 'updateHud', res.trace.updateHudMs, 'botStep', res.trace.botStepMs); }
if (res.alloc) { console.log('allocations by function during the run (MB):'); for (const [k, v] of res.alloc) console.log(`  ${String(v).padStart(8)}  ${k}`); }
if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(res, null, 1)); console.log('saved', out); }

// ---- trace: which functions fill the longest frames (CPU-profile samples between the per-frame marks)
function analyseTrace(evs, res) {
  const marks = new Map(); let pid = 0, tid = 0;
  for (const e of evs) if (e.name && e.name.startsWith('kkf') && e.cat && e.cat.includes('blink.user_timing')) { marks.set(+e.name.slice(3), e.ts); pid = e.pid; tid = e.tid; }
  // CPU profile of the page's main thread
  const nodes = new Map(), samples = []; let profId = null;
  for (const e of evs) if (e.name === 'Profile' && e.pid === pid && e.tid === tid) profId = e.id;
  const chunks = evs.filter(e => e.name === 'ProfileChunk' && e.pid === pid && (profId === null || e.id === profId)).sort((a, b) => a.ts - b.ts);
  let ts = 0; for (const e of evs) if (e.name === 'Profile' && e.id === profId) ts = e.args.data.startTime;
  for (const c of chunks) {
    const d = c.args.data, cp = d.cpuProfile || {};
    for (const n of cp.nodes || []) nodes.set(n.id, n);
    (cp.samples || []).forEach((id, i) => { ts += d.timeDeltas[i]; samples.push([ts, id]); });
  }
  const label = (id) => { const n = nodes.get(id); if (!n) return '?'; const c = n.callFrame, file = (c.url || '').split('/').pop().split('?')[0]; return (c.functionName || '(anonymous)') + (file ? ` · ${file}${c.lineNumber >= 0 ? ':' + (c.lineNumber + 1) : ''}` : ''); };
  // first named JS caller of a native / anonymous leaf, so "getProgramParameter" reads "… ← getProgramInfoLog"
  const owner = (id) => { let n = nodes.get(id), hops = 0; while (n && hops++ < 40) { const c = n.callFrame; if (c.url && !/three\.module/.test(c.url)) return (c.functionName || '(anonymous)') + ' · ' + c.url.split('/').pop().split('?')[0]; n = nodes.get(n.parent); } return ''; };
  for (const n of nodes.values()) for (const ch of n.children || []) { const c = nodes.get(ch); if (c) c.parent = n.id; }
  const gcs = evs.filter(e => e.ph === 'X' && /^(MinorGC|MajorGC|V8\.GC_)/.test(e.name) && e.pid === pid && e.tid === tid);
  const span = (a, b) => {
    const self = new Map(), by = new Map(); let total = 0, prev = null;
    for (const [t, id] of samples) { if (t >= a && t < b && prev !== null) { const dt = (t - prev) / 1000; total += dt; const k = label(id); self.set(k, (self.get(k) || 0) + dt); const o = owner(id) || 'three.js / browser'; by.set(o, (by.get(o) || 0) + dt); } prev = t; }
    const gc = gcs.filter(g => g.ts >= a && g.ts < b).reduce((s, g) => s + g.dur / 1000, 0);
    return { total, self: [...self].sort((x, y) => y[1] - x[1]), by: [...by].sort((x, y) => y[1] - x[1]), gc };
  };
  for (const l of res.longest) {
    const a = marks.get(l.frame - 1), b = marks.get(l.frame); if (a === undefined || b === undefined) continue;
    const s = span(a, b);
    l.why = s.self.filter(x => !/^\((idle|program)\)/.test(x[0])).slice(0, +(env.WHY || 3)).map(x => `${x[0]} ${x[1].toFixed(1)} ms`).join(', ') + (s.gc > 0.5 ? `, GC ${s.gc.toFixed(1)} ms` : '');
  }
  const first = marks.get(0), last = marks.get(res.frames - 1), all = span(first, last), busy = all.self.filter(x => !/^\((idle|program)\)/.test(x[0])), sum = busy.reduce((s, x) => s + x[1], 0);
  const inRun = gcs.filter(g => g.ts >= first && g.ts < last);
  // the browser's own page work caused by DOM / style writes (HUD, labels, FPS meter)
  const dom = {}; for (const e of evs) if (e.ph === 'X' && e.pid === pid && e.tid === tid && e.ts >= first && e.ts < last && /^(UpdateLayoutTree|Layout|PrePaint|Paint|Layerize|Commit|ParseHTML|ScheduleStyleRecalculation)$/.test(e.name)) { const d = dom[e.name] || (dom[e.name] = [0, 0]); d[0] += e.dur / 1000; d[1]++; }
  const fn = (re) => +busy.filter(x => re.test(x[0])).reduce((s2, x) => s2 + x[1], 0).toFixed(1);
  return { top: busy.slice(0, 25).map(x => [x[0], +x[1].toFixed(1), +(x[1] / sum * 100).toFixed(1)]), byOwner: all.by.slice(0, 15).map(x => [x[0], +x[1].toFixed(1)]), gcMs: +inRun.reduce((s, g) => s + g.dur / 1000, 0).toFixed(1), gcCount: inRun.length,
    dom: Object.fromEntries(Object.entries(dom).map(([k, v]) => [k, [+v[0].toFixed(1), v[1]]])), placeLabelsMs: fn(/^placeLabels/), updateHudMs: fn(/^updateHud/), botStepMs: fn(/^botStep/) };
}
