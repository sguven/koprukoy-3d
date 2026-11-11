// v1.1 game-mode benchmark (Nov 2026): `#bench` or `#bench=50` (20 / 50 / 100 bots, any number 1–100).
//
// Starts the Game mode by itself and runs the player along a fixed route through the village at running speed
// (çarşı → mosque → school → cemetery, ~840 m by the lanes, ~105 s at 8 m/s) while the camera sweeps left and
// right, spins round twice, fires bursts, switches weapons and looks through the AWP scope. The player really
// walks (the same walkStep / pushOut / surfaceAt as with the keyboard), cannot die, and Math.random is seeded, so
// two runs do the same work. The result is written to the console as `BENCH_RESULT {json}` and shown on screen.
//
// Extra switches for automated runs (tools/bench.mjs), separated by `&`:
//   step=16.667  fixed simulation step in ms: every frame advances the game by that much whatever the real frame
//                rate is (a machine without a GPU still walks the same route in the same number of frames);
//                frame-pacing numbers are then meaningless, the main-thread times and the counters are not
//   sync         wait for the GPU at the end of every frame (gl.finish), so the frame time includes the drawing
//   marks        performance.mark() every frame, to line frames up with a Chrome trace

export function parseBench(hash) {
  const m = /[#&]bench(?:=(\d+))?(?=&|$)/.exec(hash); if (!m) return null;
  const num = (k, d) => { const r = new RegExp('&' + k + '=([\\d.]+)').exec(hash); return r ? +r[1] : d; };
  return { bots: Math.max(1, Math.min(100, +(m[1] || 50))), step: num('step', 0) / 1000, sync: /&sync\b/.test(hash), marks: /&marks\b/.test(hash) };
}

// The route: lane centre lines of the village layout (model metres, x east, z south).
export const ROUTE = [
  [254.3, 131.4], [256.6, 137.0], [254.1, 141.5], [270.5, 192.9], [278.4, 200.3], [284.4, 209.9], [310.7, 222.9], [317.3, 223.5],   // çarşı → mosque
  [346.2, 228.5], [367.1, 240.3], [371.3, 250.2], [386.1, 268.9], [395.1, 289.0], [399.5, 293.0], [405.2, 291.2], [411.0, 292.3],
  [439.1, 314.8], [444.2, 318.0], [450.8, 318.1], [453.3, 323.0], [447.1, 358.4], [458.6, 362.7], [467.4, 370.6], [468.0, 388.5],
  [474.0, 398.6], [485.2, 402.0], [502.9, 399.5], [520.5, 402.6], [525.7, 405.4], [528.1, 409.2], [538.3, 415.5], [547.2, 423.6],
  [559.9, 443.8], [566.9, 460.4], [567.8, 466.6], [567.5, 496.5], [571.0, 505.9], [575.4, 547.7],                                   // … → school
  [571.0, 505.9], [567.5, 496.5], [549.9, 501.3], [529.0, 513.0], [517.4, 515.9], [513.6, 513.8], [511.5, 525.1], [511.9, 537.1],   // → cemetery
  [514.5, 561.0], [517.1, 566.4], [500.7, 572.5], [476.9, 575.3], [470.9, 578.9], [466.2, 575.9],
];
// Scripted actions (seconds of game time): weapon switches and the scope. Bursts are fired every 5 s.
const SCRIPT = [
  [14, 'deagle'], [22, 'knife'], [28, 'primary'], [40, 'awp'], [44, 'scope'], [50, 'unscope'], [54, 'ak47'], [70, 'deagle'], [76, 'primary'],
];

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0;
const r2 = (v) => Math.round(v * 100) / 100;
function stats(arr, n) {
  const a = Float64Array.from(arr.subarray(0, n)).sort(); let sum = 0, o33 = 0, o50 = 0;
  for (const v of a) { sum += v; if (v > 33.4) o33++; if (v > 50) o50++; }
  return { mean: r2(sum / (n || 1)), p50: r2(pct(a, 0.5)), p95: r2(pct(a, 0.95)), p99: r2(pct(a, 0.99)), max: r2(a[n - 1] || 0), over33: o33, over50: o50 };
}

/**
 * ctx: { cfg, renderer, camera, P, touchIn, surfaceAt, setMode, getGame, perf }
 * The render loop calls pre(dt) before the player moves and post(...) after the frame was drawn.
 */
export function createBench(ctx) {
  const { cfg, renderer, camera, P, touchIn, surfaceAt, setMode, getGame, perf } = ctx;
  const MAXF = 40000, gl = renderer.getContext(), mem = !!performance.memory, heapNow = () => performance.memory.usedJSHeapSize, px = new Uint8Array(4);
  const real = new Float32Array(MAXF), js = new Float32Array(MAXF), simMs = new Float32Array(MAXF), renMs = new Float32Array(MAXF), tAt = new Float32Array(MAXF);
  const flags = new Uint8Array(MAXF), progAt = new Uint8Array(MAXF), posAt = new Float32Array(MAXF * 2);
  const tagAt = new Map();   // frame → tags (only frames where something scripted happened)
  let active = false, done = false, n = 0, t = 0, wp = 1, heading = 0, stuck = 0, bestD = 1e9, bestT = 0, scriptI = 0, fireOn = false, shots = 0;
  let calls = 0, tris = 0, shadowN = 0, shadowCalls = 0, shadowTris = 0, heap0 = 0, heapPrev = 0, alloc = 0, gcDrops = 0, prog0 = 0, progPrev = 0, minRes = 1, resSum = 0, enterMs = 0, autoWas = true, wall0 = 0;
  let pendingTags = null, overlay = null, rndWas = null;
  const firsts = {};   // tag → frame index of its first occurrence
  const mark = (tag) => { (pendingTags || (pendingTags = [])).push(tag); if (!(tag in firsts)) firsts[tag] = n; };

  function begin() {
    // same bots, same routes, same spread every run
    let s = 0x2f6e2b1; rndWas = Math.random;
    Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let x = Math.imul(s ^ s >>> 15, 1 | s); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
    autoWas = perf.auto; if (cfg.step) perf.auto = false;   // a stepped run has no real frame rate to adapt to
    const t0 = performance.now();
    setMode('game');
    const g = getGame(); g.setBots(cfg.bots); g.state.god = true; g.newRound();
    enterMs = performance.now() - t0;
    P.x = ROUTE[0][0]; P.z = ROUTE[0][1]; P.y = surfaceAt(P.x, P.z).y; P.vy = 0; P.pitch = 0;
    heading = Math.atan2(-(ROUTE[1][0] - P.x), -(ROUTE[1][1] - P.z)); P.yaw = heading;
    prog0 = progPrev = renderer.info.programs.length; heap0 = heapPrev = mem ? heapNow() : 0;
    active = true; wall0 = performance.now(); mark('enter'); if (cfg.marks) performance.mark('kkf-1');
    console.log(`[bench] start: ${cfg.bots} bots${cfg.step ? `, fixed step ${(cfg.step * 1000).toFixed(2)} ms` : ''}${cfg.sync ? ', gpu sync' : ''}`);
  }

  /** Steer the player: called once per frame before walkStep. */
  function pre(dt) {
    if (!active) return;
    const g = getGame(), G = g.state; t += dt; G.health = 100;
    // next waypoint
    let w = ROUTE[wp], dx = w[0] - P.x, dz = w[1] - P.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d < 2.2) { wp++; bestD = 1e9; bestT = t; if (wp >= ROUTE.length) { finish(); return; } w = ROUTE[wp]; dx = w[0] - P.x; dz = w[1] - P.z; d = Math.sqrt(dx * dx + dz * dz); }
    if (d < bestD - 0.5) { bestD = d; bestT = t; }
    else if (t - bestT > 2.5) { stuck++; P.x = w[0]; P.z = w[1]; P.y = surfaceAt(P.x, P.z).y; bestD = 1e9; bestT = t; return; }   // caught on something: step on
    // the body turns towards the lane at most 3.5 rad/s; the eyes sweep ±50° and spin right round twice on the way
    let want = Math.atan2(-dx, -dz), dy = want - heading; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    heading += Math.max(-3.5 * dt, Math.min(3.5 * dt, dy));
    const spin = (a, len) => { const k = Math.max(0, Math.min(1, (t - a) / len)); return k * k * (3 - 2 * k) * Math.PI * 2; };
    const yaw = heading + 0.87 * Math.sin(t * 0.7) + spin(18, 3) + spin(62, 2.2);
    P.yaw = yaw; P.pitch = -0.03 + 0.1 * Math.sin(t * 0.45);
    // run towards the waypoint whatever the eyes look at (joystick at the rim = run)
    const ux = dx / (d || 1), uz = dz / (d || 1), f = ux * -Math.sin(yaw) + uz * -Math.cos(yaw), r = ux * Math.cos(yaw) + uz * -Math.sin(yaw);
    touchIn.jx = r; touchIn.jy = -f;
    // a 0.8 s burst every 5 s
    const burst = t > 4 && (t - 4) % 5 < 0.8;
    if (burst !== fireOn) { fireOn = burst; G.firing = burst; G.fired = false; if (burst) mark(shots++ ? 'burst' : 'firstShot'); }
    while (scriptI < SCRIPT.length && t >= SCRIPT[scriptI][0]) {
      const a = SCRIPT[scriptI++][1];
      if (a === 'scope' || a === 'unscope') { if (g.setScope) g.setScope(a === 'scope'); mark(a); }
      else if (a === 'awp' || a === 'ak47') { g.setPrimary(a); mark('switch:' + a); }
      else { g.setWeapon(a === 'primary' ? G.primary : a); mark(scriptI === 1 ? 'firstSwitch' : 'switch:' + a); }
    }
  }

  /** One frame done. frameMs = time since the previous frame started; t0 / tRender / tEnd = performance.now() marks. */
  function post(frameMs, t0, tRender, shadowRedrawn, cullChanged) {
    if (!active || n >= MAXF) return;
    let tEnd = performance.now();
    if (cfg.sync) { gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); tEnd = performance.now(); }
    const info = renderer.info.render, progs = renderer.info.programs.length;
    real[n] = frameMs; js[n] = tEnd - t0; simMs[n] = tRender - t0; renMs[n] = tEnd - tRender; tAt[n] = t; posAt[n * 2] = P.x; posAt[n * 2 + 1] = P.z;
    calls += info.calls; tris += info.triangles;
    if (shadowRedrawn) { shadowN++; shadowCalls += info.calls; shadowTris += info.triangles; }
    let fl = (shadowRedrawn ? 1 : 0) | (cullChanged ? 2 : 0);
    progAt[n] = Math.min(255, Math.max(0, progs - progPrev)); progPrev = progs;
    if (mem) { const h = heapNow(), dh = h - heapPrev; if (dh > 0) alloc += dh; else if (dh < -262144) { gcDrops++; fl |= 4; } heapPrev = h; }
    flags[n] = fl; if (pendingTags) { tagAt.set(n, pendingTags); pendingTags = null; }
    minRes = Math.min(minRes, perf.scale); resSum += perf.scale;
    if (cfg.marks) performance.mark('kkf' + n);
    n++;
  }

  function finish() {
    if (!active) return; active = false; done = true;
    const G = getGame().state; G.firing = false; G.god = false; touchIn.jx = 0; touchIn.jy = 0;
    if (rndWas) Math.random = rndWas; perf.auto = autoWas;
    const stepped = !!cfg.step, main = stepped || cfg.sync ? js : real, plain = Math.max(1, n - shadowN);
    const tagsOf = (i) => { const a = []; if (flags[i] & 1) a.push('shadow'); if (flags[i] & 2) a.push('cull'); if (flags[i] & 4) a.push('gc'); if (progAt[i]) a.push('shaders+' + progAt[i]); if (tagAt.has(i)) a.push(...tagAt.get(i)); return a; };
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => main[b] - main[a]).slice(0, 10);
    // what a scripted event cost: the slowest of its frame and the three after it (a shader compiled for it lands there)
    const events = {}; for (const k in firsts) { let m = 0; for (let i = firsts[k]; i < Math.min(n, firsts[k] + 4); i++) m = Math.max(m, main[i]); events[k] = r2(m); }
    const dev = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
    const res = {
      version: 1, bots: cfg.bots, mode: stepped ? `fixed step ${(cfg.step * 1000).toFixed(2)} ms` : 'real time', gpuSync: cfg.sync,
      frames: n, gameSeconds: r2(t), wallSeconds: r2((performance.now() - wall0) / 1000), stuck,
      // frame = time from one frame to the next (what the player feels); js = main-thread time spent inside the frame
      frame: stepped ? null : stats(real, n), js: stats(js, n), sim: stats(simMs, n), render: stats(renMs, n),
      drawCalls: Math.round(calls / (n || 1)), triangles: Math.round(tris / (n || 1)),
      shadow: { redraws: shadowN, perSecond: r2(shadowN / (t || 1)), frameMs: shadowN ? r2(mean(main, i => flags[i] & 1)) : 0, otherFrameMs: r2(mean(main, i => !(flags[i] & 1))),
        drawCalls: shadowN ? Math.round(shadowCalls / shadowN) : 0, triangles: shadowN ? Math.round(shadowTris / shadowN) : 0,
        drawCallsOther: Math.round((calls - shadowCalls) / plain), trianglesOther: Math.round((tris - shadowTris) / plain) },
      shadersCompiled: renderer.info.programs.length - prog0,
      heap: mem ? { startMB: r2(heap0 / 1048576), endMB: r2(heapPrev / 1048576), growthMB: r2((heapPrev - heap0) / 1048576), allocatedMB: r2(alloc / 1048576), allocMBperSec: r2(alloc / 1048576 / (t || 1)), gcDrops } : null,
      enterMs: r2(enterMs), events,
      resolution: { min: r2(minRes), mean: r2(resSum / (n || 1)), pixelRatio: r2(renderer.getPixelRatio()), size: [innerWidth, innerHeight] },
      shadowMap: renderer.shadowMap.enabled ? ctx.shadowMapSize() : 0,
      longest: order.map(i => ({ frame: i, t: r2(tAt[i]), ms: r2(main[i]), js: r2(js[i]), sim: r2(simMs[i]), render: r2(renMs[i]), at: [Math.round(posAt[i * 2]), Math.round(posAt[i * 2 + 1])], tags: tagsOf(i) })),
      gpu: dev ? gl.getParameter(dev.UNMASKED_RENDERER_WEBGL) : 'unknown', ua: navigator.userAgent,
    };
    function mean(arr, keep) { let s = 0, c = 0; for (let i = 0; i < n; i++) if (keep(i)) { s += arr[i]; c++; } return c ? s / c : 0; }
    window.__benchResult = res;
    console.log('BENCH_RESULT ' + JSON.stringify(res));
    show(res);
  }

  function show(res) {
    if (!overlay) {
      overlay = document.createElement('pre'); overlay.id = 'benchOut';
      overlay.style.cssText = 'position:fixed;z-index:90;left:50%;top:50%;transform:translate(-50%,-50%);max-width:94vw;max-height:88vh;overflow:auto;margin:0;padding:14px 18px;background:rgba(20,18,16,0.92);color:#f3efe6;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;border-radius:10px;white-space:pre;user-select:text;-webkit-user-select:text';
      document.body.appendChild(overlay);
    }
    const f = res.frame || res.js, row = (k, s) => `${k.padEnd(13)} p50 ${String(s.p50).padStart(6)}   p95 ${String(s.p95).padStart(6)}   p99 ${String(s.p99).padStart(6)}   max ${String(s.max).padStart(7)} ms`;
    overlay.textContent = [
      `Köprüköy game benchmark · ${res.bots} bots · ${res.mode} · ${res.frames} frames in ${res.gameSeconds} s`,
      '',
      res.frame ? row('frame', res.frame) : 'frame         (stepped run: no real frame pacing)',
      row('main thread', res.js), row('  game+walk', res.sim), row('  render', res.render),
      `frames over 33 ms: ${f.over33}   over 50 ms: ${f.over50}`,
      `draw calls ${res.drawCalls}   triangles ${(res.triangles / 1e6).toFixed(2)} M   (frames that redraw the shadow map: ${res.shadow.drawCalls} / ${(res.shadow.triangles / 1e6).toFixed(2)} M)`,
      `shadow map ${res.shadowMap}²: ${res.shadow.redraws} redraws (${res.shadow.perSecond}/s), those frames ${res.shadow.frameMs} ms vs ${res.shadow.otherFrameMs} ms`,
      `shaders compiled during the run: ${res.shadersCompiled}   entering the game: ${res.enterMs} ms`,
      res.heap ? `JS heap ${res.heap.startMB} → ${res.heap.endMB} MB, allocated ${res.heap.allocatedMB} MB (${res.heap.allocMBperSec} MB/s), ${res.heap.gcDrops} GC drops` : 'JS heap: not available in this browser',
      `first shot ${res.events.firstShot ?? '–'} ms   first weapon switch ${res.events.firstSwitch ?? '–'} ms   resolution ${Math.round(res.resolution.mean * 100)} % (min ${Math.round(res.resolution.min * 100)} %)`,
      res.stuck ? `route: stepped past an obstacle ${res.stuck}×` : null,
      '',
      'longest frames:', ...res.longest.map(l => `  t=${String(l.t).padStart(6)} s  ${String(l.ms).padStart(7)} ms  (game ${l.sim}, render ${l.render})  ${l.tags.join(' ')}`),
      '',
      'Full JSON: console (BENCH_RESULT) · click to close',
    ].filter(l => l !== null).join('\n');
    overlay.onclick = () => { overlay.remove(); overlay = null; };
  }

  return { begin, pre, post, get active() { return active; }, get done() { return done; }, get step() { return active ? cfg.step : 0; } };
}
