// v1.21: "a real place" — the air, the sky and the land beyond the map.
// The scene used to stop at the edge of the 2 km survey square (a slab in an empty grey void, a flat white sky above
// it, no haze), which is what made it look like a model on a table. Everything here is cheap enough for a phone:
//   clouds        a fair-weather cumulus layer drawn on a dome behind everything (one draw call, procedural noise)
//   cloud shadows the same clouds, projected along the sun, darken the sunlight on the ground and drift with the wind
//                 (a few lines added to the standard lighting shader chunk; no extra pass, no extra texture)
//   aerial haze   distance haze that is warm and bright towards the sun and cool and blue away from it, the way
//                 real air looks on a dry afternoon; distant hills fade into it
//   outer land    rolling steppe hills out to ~8 km around the survey square, continuing the edge of the map
//                 (its colours are taken from the map's own satellite texture), and the river beyond the edge
//   grade         AgX tone mapping with a little more contrast and colour, like a camera's standard picture profile
import * as THREE from 'three';

// value noise shared by the cloud dome and the cloud shadows on the ground, so the shadows match the clouds above
export const NOISE = /* glsl */`
  float kkH21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float kkVN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(kkH21(i), kkH21(i + vec2(1.0, 0.0)), f.x), mix(kkH21(i + vec2(0.0, 1.0)), kkH21(i + vec2(1.0, 1.0)), f.x), f.y); }
  // cloud density at a point of the cloud deck (metres), t in seconds; large shapes only (the shadows use this)
  float kkCloudBase(vec2 p, float t) {
    vec2 q = p * 0.00075 + vec2(t * 0.0056, t * 0.0021);
    return kkVN(q) * 0.55 + kkVN(q * 2.03 + vec2(1.7, 9.2)) * 0.28 + kkVN(q * 4.07 + vec2(8.3, 2.8)) * 0.17;
  }
`;
export const CLOUD = { height: 1900, cover: 0.5, soft: 0.19 };

// the visible sky: blue gradient, sun glow and disc, and the cloud layer, all in one shader on a dome that is drawn after
// the opaque scene (so only the pixels where the sky actually shows are shaded). three's Sky stays for the lighting
// (the environment map), its colours are just not the ones a camera sees on a dry Anatolian afternoon.
function cloudDome(lite) {
  const uniforms = {
    uT: { value: 0 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 0.95, 0.88) },
    uZenith: { value: new THREE.Color(0.075, 0.2, 0.62) }, uHorizon: { value: new THREE.Color(0.58, 0.68, 0.82) },
    uLit: { value: new THREE.Color(1.9, 1.86, 1.8) }, uShade: { value: new THREE.Color(0.62, 0.68, 0.8) },
    uAway: { value: new THREE.Color(0.86, 0.95, 1.08) }, uToSun: { value: new THREE.Color(1.18, 1.04, 0.86) },
    uCover: { value: CLOUD.cover }, uSoft: { value: CLOUD.soft }, uH: { value: CLOUD.height },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, depthWrite: false, side: THREE.BackSide, fog: false,
    defines: lite ? { KK_LITE: '' } : {},
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      uniform float uT, uCover, uSoft, uH; uniform vec3 uSun, uSunCol, uZenith, uHorizon, uLit, uShade, uAway, uToSun;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float mu = dot(d, uSun);
        float y = max(d.y, 0.0);
        // sky: deep blue overhead, pale and hazy at the horizon, brighter all round the sun
        vec3 hz = uHorizon * mix(uAway, uToSun, pow(max(mu * 0.5 + 0.5, 0.0), 3.0));   // = the fog colour (see fog_fragment)
        vec3 sky = mix(hz, uZenith, pow(y, 0.5));
        sky += uSunCol * (pow(max(mu, 0.0), 5.0) * 0.32 + pow(max(mu, 0.0), 48.0) * 0.6);
        sky += uSunCol * smoothstep(0.99985, 0.99993, mu) * 30.0;
        vec3 col = sky;
        if (d.y > 0.012) {
          float h = max(80.0, uH - cameraPosition.y);
          vec2 p = cameraPosition.xz + d.xz * (h / d.y);
          float base = kkCloudBase(p, uT);
          vec2 q = p * 0.0034 + vec2(uT * 0.03, 0.0);
          #ifdef KK_LITE
          float den = base + (kkVN(q) - 0.5) * 0.12;
          #else
          float den = base + (kkVN(q) - 0.5) * 0.11 + (kkVN(q * 2.3 + 4.1) - 0.5) * 0.05;   // ragged edges
          #endif
          float a = smoothstep(uCover, uCover + uSoft, den);
          if (a > 0.003) {
            // thicker towards the sun = darker; the cloud's core is grey, thin edges and the sunny side are bright
            vec2 toSun = normalize(uSun.xz + 1e-4) * 260.0;
            #ifdef KK_LITE
            float den2 = base - 0.04;                                          // phones: no second look towards the sun
            #else
            float den2 = kkCloudBase(p + toSun, uT);
            #endif
            float lit = clamp(0.7 + (den - den2) * 3.0 - (den - uCover) * 0.9, 0.0, 1.0);
            vec3 c = mix(uShade, uLit, lit);
            c += uSunCol * (pow(max(mu, 0.0), 8.0) * 0.8 + pow(max(mu, 0.0), 40.0) * 1.5) * (1.0 - a * 0.6);
            float far = smoothstep(0.3, 0.015, d.y);           // far clouds sink into the haze and get thin
            c = mix(c, hz * 1.1, far * 0.7);
            a *= smoothstep(0.012, 0.08, d.y) * 0.97;
            col = mix(sky, c, a);
          }
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1000, 40, 20), mat);
  m.frustumCulled = false; m.renderOrder = 1000; m.name = 'Gokyuzu';
  return m;
}

// ---------------------------------------------------------------- global shader chunks (patched once, before anything compiles)
let chunksDone = false;
function patchChunks(sunDir, fogSun, fogAway, perVertex = false) {
  const S = THREE.ShaderChunk;
  const v3 = v => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${(v.z !== undefined ? v.z : v.b).toFixed(4)})`;
  const c3 = c => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
  if (!chunksDone) {
    S._kkFogPV = S.fog_pars_vertex; S._kkFogV = S.fog_vertex; S._kkFogPF = S.fog_pars_fragment; S._kkFogF = S.fog_fragment;
    S._kkWorld = S.worldpos_vertex; S._kkLights = S.lights_fragment_begin; S._kkLightsPars = S.lights_pars_begin; S._kkCommon = S.common; S._kkTone = S.tonemapping_pars_fragment;
  }
  chunksDone = true;
  // aerial haze: the fog's colour depends on where you look (towards / away from the sun)
  S.fog_pars_vertex = S._kkFogPV + '\n#ifdef USE_FOG\nvarying vec3 vKkFogDir;\n#endif\n';
  S.fog_vertex = S._kkFogV + '\n#ifdef USE_FOG\nvKkFogDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;\n#endif\n';
  S.fog_pars_fragment = S._kkFogPF + '\n#ifdef USE_FOG\nvarying vec3 vKkFogDir;\n#endif\n';
  S.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  vec3 kkFd = normalize( vKkFogDir );
  float kkMu = dot( kkFd, ${v3(sunDir)} );
  vec3 kkFogC = fogColor * mix( ${c3(fogAway)}, ${c3(fogSun)}, pow( max( kkMu * 0.5 + 0.5, 0.0 ), 3.0 ) );
  // looking up through less air: a little less haze on what is above the eye
  fogFactor *= 1.0 - 0.45 * smoothstep( 0.0, 0.35, kkFd.y );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, kkFogC, fogFactor );
#endif`;
  // cloud shadows: materials that opt in (define KK_CLOUDSHADOW, uniform kkCloudT) get their sunlight dimmed under a cloud
  const cloudFn = `
uniform float kkCloudT;
${NOISE}
float kkCloudShadow( vec3 w ) {
  vec3 sd = ${v3(sunDir)};
  vec2 p = w.xz + sd.xz * ( ( ${CLOUD.height.toFixed(1)} - w.y ) / max( sd.y, 0.15 ) );
  float a = smoothstep( ${CLOUD.cover.toFixed(3)} - 0.03, ${(CLOUD.cover + CLOUD.soft).toFixed(3)} + 0.02, kkCloudBase( p, kkCloudT ) );
  return 1.0 - 0.62 * a;
}
`;
  if (perVertex) {
    // v1.24, phones: the cloud shadow is worked out once per vertex (every few metres on the ground; the clouds' shapes
    // are hundreds of metres across, so it looks the same) instead of once per pixel of every lit surface
    S.common = S._kkCommon + '\n#ifdef KK_CLOUDSHADOW\nvarying float vKkCloud;\n#endif\n#if defined( KK_CLOUDSHADOW ) && defined( USE_SHADOWMAP )\n' + cloudFn + '#endif\n';
    S.worldpos_vertex = S._kkWorld + '\n#if defined( KK_CLOUDSHADOW ) && defined( USE_SHADOWMAP )\nvKkCloud = kkCloudShadow( worldPosition.xyz );\n#endif\n';
    S.lights_fragment_begin = S._kkLights.replace('getDirectionalLightInfo( directionalLight, directLight );', `getDirectionalLightInfo( directionalLight, directLight );
		#if defined( KK_CLOUDSHADOW ) && defined( USE_SHADOWMAP )
		if ( UNROLLED_LOOP_INDEX == 0 ) directLight.color *= vKkCloud;
		#endif`);
    S.lights_pars_begin = S._kkLightsPars;
  } else {
    S.common = S._kkCommon + '\n#ifdef KK_CLOUDSHADOW\nvarying vec3 vKkCloudW;\n#endif\n';
    S.worldpos_vertex = S._kkWorld + '\n#if defined( KK_CLOUDSHADOW ) && defined( USE_SHADOWMAP )\nvKkCloudW = worldPosition.xyz;\n#endif\n';
    S.lights_fragment_begin = S._kkLights.replace('getDirectionalLightInfo( directionalLight, directLight );', `getDirectionalLightInfo( directionalLight, directLight );
		#if defined( KK_CLOUDSHADOW ) && defined( USE_SHADOWMAP )
		if ( UNROLLED_LOOP_INDEX == 0 ) directLight.color *= kkCloudShadow( vKkCloudW );
		#endif`);
    S.lights_pars_begin = S._kkLightsPars + '\n#if defined( KK_CLOUDSHADOW ) && defined( USE_SHADOWMAP )\n' + cloudFn + '#endif\n';
  }
  // grade: AgX, then a touch of contrast and saturation (AgX on its own is flat and greyish)
  S.tonemapping_pars_fragment = S._kkTone.replace('vec3 CustomToneMapping( vec3 color ) { return color; }', /* glsl */`
vec3 CustomToneMapping( vec3 color ) {
  vec3 c = AgXToneMapping( color );
  c = max( c, 0.0 );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( vec3( l ), c, 1.16 );                                   // saturation
  c = pow( max( c, 0.0 ), vec3( 1.06 ) ) * 1.03;                   // contrast, mid-tones kept
  c *= vec3( 1.012, 1.0, 0.985 );                                  // a little warmth
  return clamp( c, 0.0, 1.0 );
}`);
  if (!/AgXToneMapping\( color \);/.test(S.tonemapping_pars_fragment)) console.warn('[atmo] grade not applied');
  if (!/kkCloudShadow\( vKkCloudW \)|\*= vKkCloud;/.test(S.lights_fragment_begin)) console.warn('[atmo] cloud shadows not applied');
}

// ---------------------------------------------------------------- land beyond the survey square
// JS value noise (same idea as the GLSL one) for the hills and the colours
function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1); return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy; }
function fbm(x, y, o = 5) { let s = 0, a = 0.5, f = 1, n = 0; for (let i = 0; i < o; i++) { s += vnoise(x * f + i * 17.1, y * f - i * 9.3) * a; n += a; a *= 0.5; f *= 2.03; } return s / n; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildOuterLand({ D, terrH, macroImage, R = 8800 }) {
  const g = D.grid, x0 = g.x0, z0 = g.z0, x1 = g.x0 + g.size, z1 = g.z0 + g.size;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // grid lines: 50 m along the survey square, growing outwards to ~700 m at the horizon
  const lines = (a, b) => {
    const xs = []; for (let v = a; v <= b + 1e-6; v += 50) xs.push(v);
    let s = 50, v = a; const lo = []; while (v > (a + b) / 2 - R) { s = Math.min(700, s * 1.13); v -= s; lo.unshift(v); }
    s = 50; v = b; const hi = []; while (v < (a + b) / 2 + R) { s = Math.min(700, s * 1.13); v += s; hi.push(v); }
    return lo.concat(xs, hi);
  };
  const XS = lines(x0, x1), ZS = lines(z0, z1), nx = XS.length, nz = ZS.length;
  const edgeH = (x, z) => terrH(Math.min(x1 - 0.5, Math.max(x0 + 0.5, x)), Math.min(z1 - 0.5, Math.max(z0 + 0.5, z)));
  const hills = (x, z, d) => {
    const n1 = fbm(x / 2600, z / 2600, 4), n2 = fbm(x / 900 + 5, z / 900 - 3, 3);
    const ridge = 1 - Math.abs(fbm(x / 5200 - 7, z / 5200 + 2, 3) * 2 - 1);
    return 42 + (n1 - 0.45) * 150 * sstep(300, 2500, d) + (n2 - 0.5) * 40 * sstep(200, 1500, d) + ridge * 170 * sstep(2500, 7000, d);
  };
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), inside = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = XS[i], z = ZS[j], k = j * nx + i;
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1), d = Math.hypot(dx, dz);
    let y;
    if (d === 0) { inside[k] = (x > x0 && x < x1 && z > z0 && z < z1) ? 1 : 0; y = edgeH(x, z) - 0.6; }
    else {
      const e = edgeH(x, z), low = sstep(12, 2, e);              // the river leaves the map: keep its valley going outwards
      const t = sstep(0, 1300, d) * (1 - low * (1 - sstep(2600, 6000, d)));
      y = e - 0.6 + (hills(x, z, d) - e) * t;
      if (low > 0) y = Math.min(y, e + (-7 - e) * sstep(0, 400, d) * low + (hills(x, z, d) + 7) * sstep(2600, 6000, d));
    }
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    uv[k * 2] = (x - (cx - R)) / (2 * R); uv[k * 2 + 1] = (z - (cz - R)) / (2 * R);
  }
  const idx = [];
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const xm = (XS[i] + XS[i + 1]) / 2, zm = (ZS[j] + ZS[j + 1]) / 2;
    if (xm > x0 && xm < x1 && zm > z0 && zm < z1) continue;           // the survey square has its own terrain
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();

  // colour texture: generic steppe (tan grass, darker patches, a few fields in the valleys), blended at the edge
  // into the colours of the map's own macro texture so the seam disappears
  const N = 512, cv = document.createElement('canvas'); cv.width = cv.height = N; const c2 = cv.getContext('2d');
  const img = c2.createImageData(N, N);
  let mac = null; const MN = 24;
  try { if (macroImage) { const mc = document.createElement('canvas'); mc.width = mc.height = MN; const m2 = mc.getContext('2d'); m2.drawImage(macroImage, 0, 0, MN, MN); mac = m2.getImageData(0, 0, MN, MN).data; } } catch (e) { mac = null; }
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const x = cx - R + (px + 0.5) / N * 2 * R, z = cz - R + (py + 0.5) / N * 2 * R;
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1), d = Math.hypot(dx, dz);
    const n = fbm(x / 1400, z / 1400, 4), m = fbm(x / 380 + 3, z / 380 - 8, 3);
    // dry steppe: straw / ochre, with greyer eroded slopes and olive patches
    let r = 196 + (n - 0.5) * 50 + (m - 0.5) * 26, gg = 178 + (n - 0.5) * 44 + (m - 0.5) * 22, b = 140 + (n - 0.5) * 30 + (m - 0.5) * 16;
    const olive = sstep(0.6, 0.72, m) * 0.5; r -= olive * 40; gg -= olive * 18; b -= olive * 34;
    const field = sstep(0.55, 0.62, vnoise(Math.floor(x / 260) * 0.37, Math.floor(z / 190) * 0.41)) * sstep(0.45, 0.3, n);   // ploughed / stubble fields on the low ground
    r -= field * 34; gg -= field * 34; b -= field * 26;
    if (mac && d < 900) {
      // bilinear in a 24 × 24 thumbnail of the macro map (~80 m a pixel), so the edge colours carry on softly, not as streaks
      const fu = (Math.min(x1, Math.max(x0, x)) - x0) / (x1 - x0) * (MN - 1), fv = (Math.min(z1, Math.max(z0, z)) - z0) / (z1 - z0) * (MN - 1);
      const u0 = Math.min(MN - 2, Math.floor(fu)), v0 = Math.min(MN - 2, Math.floor(fv)), au = fu - u0, av = fv - v0, w = 1 - sstep(0, 700, d);
      const at = (c) => { const q = (u, v) => mac[(v * MN + u) * 4 + c]; return (q(u0, v0) * (1 - au) + q(u0 + 1, v0) * au) * (1 - av) + (q(u0, v0 + 1) * (1 - au) + q(u0 + 1, v0 + 1) * au) * av; };
      r += (at(0) - r) * w; gg += (at(1) - gg) * w; b += (at(2) - b) * w;
    }
    const k = (py * N + px) * 4; img.data[k] = r; img.data[k + 1] = gg; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  c2.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  // the terrain shader's own base tint (0xeadbc2 on the macro map) so both read the same under the same light
  // Lambert, not PBR: this is far-away ground, and it covers much of the screen in the map view (cheaper on a phone)
  const mat = new THREE.MeshLambertMaterial({ map: tex, color: 0xeadbc2 });
  const land = new THREE.Mesh(geo, mat); land.name = 'Uzak_Arazi'; land.receiveShadow = true; land.castShadow = false;

  // the river / reservoir beyond the edge: a plane just below the map's water, seen only where the land dips under it
  const wg = new THREE.PlaneGeometry(2 * R, 2 * R, 1, 1); wg.rotateX(-Math.PI / 2); wg.translate(cx, -0.5, cz);
  const water = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x2a6a70, roughness: 0.1, metalness: 0, envMapIntensity: 1.0 }));
  water.name = 'Uzak_Su'; water.receiveShadow = false;
  const group = new THREE.Group(); group.name = 'Uzak'; group.add(land, water);
  return { group, uvCheck: { XS: nx, ZS: nz, tris: idx.length / 3 } };
}

// ---------------------------------------------------------------- wood smoke from the chimneys and stove pipes
// Late-autumn afternoon: about half of the stoves are lit. Every puff is a point sprite whose whole life (rise, drift
// with the wind, growth, fade) is worked out in the vertex shader from its source and a seed, so the CPU does nothing
// per frame. Thin blue-grey smoke, gone beyond ~450 m.
export function chimneySmoke(sources, { isTouch = false } = {}) {
  const hash = (x, z, k) => { const t = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return t - Math.floor(t); };
  const lit = sources.filter(s => hash(s[0], s[2], 7) < (s[3] ? 0.5 : 0.16));
  const P = isTouch ? 6 : 14, n = lit.length * P;   // v1.24: phones 6 puffs a chimney (was 9)
  const src = new Float32Array(n * 3), seed = new Float32Array(n * 2);
  let k = 0;
  for (const s of lit) {
    const strength = s[3] ? 0.65 + 0.35 * hash(s[0], s[2], 3) : 0.8 + 0.5 * hash(s[0], s[2], 3);   // a stove pipe smokes thinner
    for (let i = 0; i < P; i++, k++) { src[k * 3] = s[0]; src[k * 3 + 1] = s[1]; src[k * 3 + 2] = s[2]; seed[k * 2] = (i + hash(s[0], s[2], i) * 0.6) / P; seed[k * 2 + 1] = strength; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(src, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 2));
  g.computeBoundingSphere(); g.boundingSphere.radius += 40;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false,
    uniforms: { uT: { value: 0 }, uScale: { value: 600 }, uMax: { value: isTouch ? 120 : 220 }, uWind: { value: new THREE.Vector2(0.936, 0.35) }, uCol: { value: new THREE.Color(0.78, 0.8, 0.84) } },
    vertexShader: /* glsl */`
      uniform float uT, uScale, uMax; uniform vec2 uWind;
      attribute vec2 aSeed;
      varying float vA; varying float vAge; varying float vRnd;
      void main() {
        float life = 9.0;
        float age = fract(uT / life + aSeed.x);
        float r = fract(aSeed.x * 91.7);
        vec3 p = position;
        p.y += age * 7.0 + sqrt(age) * 2.0;                                       // buoyant rise, slowing
        p.xz += uWind * (pow(age, 1.3) * 16.0);                                    // bent over by the breeze
        p.x += sin(uT * 0.7 + r * 6.3 + age * 5.0) * age * 1.6;                    // curling
        p.z += cos(uT * 0.5 + r * 4.1 + age * 4.0) * age * 1.4;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        float size = (0.5 + age * 3.6) * aSeed.y;                                  // metres across
        gl_PointSize = clamp(size * uScale / max(dist, 1.0), 0.0, uMax);   // v1.24: phones at most 120 px (overdraw)
        vA = smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.45, 1.0, age)) * 0.33 * aSeed.y * (1.0 - smoothstep(250.0, 450.0, dist));
        vAge = age; vRnd = r;
        gl_Position = projectionMatrix * mv;
        if (vA < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);                     // nothing to draw: off screen
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol;
      varying float vA; varying float vAge; varying float vRnd;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        float blob = 1.0 - smoothstep(0.35, 1.0, d);
        blob *= 0.75 + 0.25 * sin((c.x + vRnd) * 9.0) * sin((c.y - vRnd) * 7.0);   // not a perfect disc
        float a = blob * vA;
        if (a < 0.003) discard;
        vec3 col = uCol * (1.05 - 0.3 * c.y) * mix(0.82, 1.0, vAge);               // lit from above, young smoke darker
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.name = 'Baca_Dumani'; pts.frustumCulled = true; pts.renderOrder = 2;
  return { points: pts, count: lit.length, update(t, renderer, camera) { mat.uniforms.uT.value = t; mat.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360)); } };
}

// ---------------------------------------------------------------- birds
// A few loose flocks wheeling over the village (pigeons / jackdaws) and over the water (gulls). Each bird flies its own
// wandering circle, flaps in bursts and glides in between; all of it in the vertex shader (one draw call per flock).
export function birdFlocks(flocks) {
  const group = new THREE.Group(); group.name = 'Kuslar';
  // a bird 0.8 m across: body + two wings (wing tips are the vertices with |x| > 0.1)
  const pos = new Float32Array([
    0, 0, 0.32, 0.07, 0, 0, 0, 0.02, -0.25, -0.07, 0, 0, 0, 0.02, -0.25, 0.07, 0, 0,   // body (two triangles)
    0.06, 0, 0.1, 0.42, 0.04, -0.02, 0.06, 0, -0.1,  -0.06, 0, 0.1, -0.06, 0, -0.1, -0.42, 0.04, -0.02,  // wings
    0, 0.02, -0.2, 0.08, 0.01, -0.36, -0.08, 0.01, -0.36,                               // tail
  ]);
  const geo0 = new THREE.BufferGeometry(); geo0.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const unifs = [];
  for (const f of flocks) {
    const g = new THREE.InstancedBufferGeometry(); g.index = null; g.setAttribute('position', geo0.attributes.position);
    const a = new Float32Array(f.n * 4);
    for (let i = 0; i < f.n; i++) { const r = (k) => { const t = Math.sin((i + 1) * 12.9898 + f.x * 0.731 + k * 78.233) * 43758.5453; return t - Math.floor(t); }; a[i * 4] = r(1); a[i * 4 + 1] = f.r * (0.55 + 0.6 * r(2)); a[i * 4 + 2] = f.h + (r(3) - 0.5) * f.h * 0.5; a[i * 4 + 3] = (r(4) < 0.85 ? 1 : -1) * (f.v || 9) * (0.85 + 0.3 * r(5)); }
    g.setAttribute('aB', new THREE.InstancedBufferAttribute(a, 4)); g.instanceCount = f.n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(f.x, f.y + f.h, f.z), f.r * 1.6 + f.h);
    const u = { uT: { value: 0 }, uC: { value: new THREE.Vector3(f.x, f.y, f.z) }, uCol: { value: new THREE.Color(f.col) }, uS: { value: f.size || 1 } };
    unifs.push(u);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, side: THREE.DoubleSide, fog: false,
      vertexShader: /* glsl */`
        uniform float uT, uS; uniform vec3 uC; attribute vec4 aB; varying float vShade;
        void main() {
          float ph = aB.x * 6.2832, r = aB.y, sp = aB.w;
          float ang = ph + uT * sp / r;
          vec3 c = uC + vec3(cos(ang) * r + sin(ang * 0.37 + ph) * r * 0.35, aB.z + sin(uT * 0.31 + ph * 3.0) * 6.0, sin(ang) * r + cos(ang * 0.29 + ph) * r * 0.35);
          vec3 fwd = normalize(vec3(-sin(ang), 0.0, cos(ang)) * sign(sp));
          vec3 right = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
          float burst = smoothstep(0.1, 0.4, sin(uT * 0.6 + ph * 7.0));                 // flapping bursts, gliding between
          float flap = sin(uT * 11.0 + ph * 23.0) * burst;
          vec3 p = position * uS;
          float tip = smoothstep(0.08, 0.42, abs(position.x));
          p.y += (flap * 0.32 + (1.0 - burst) * 0.05) * tip * uS;
          vec3 w = c + right * p.x - fwd * 0.0 + vec3(0.0, p.y, 0.0) + fwd * p.z;
          w.y += right.y * 0.0;
          vShade = 0.75 + 0.25 * flap;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol; varying float vShade;
        void main() { gl_FragColor = vec4(uCol * vShade, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    m.name = 'Kuslar_' + f.name; m.frustumCulled = true; group.add(m);
  }
  return { group, update(t) { for (const u of unifs) u.uT.value = t; } };
}

// ---------------------------------------------------------------- the whole thing
export function createAtmosphere({ scene, renderer, isTouch, sky }) {
  const dome = cloudDome(isTouch); if (sky) sky.visible = false; scene.add(dome);
  const cloudT = { value: 0 };
  renderer.toneMapping = THREE.CustomToneMapping;
  const patched = new WeakSet();
  return {
    dome, cloudT,
    /** sun direction and colours; must run before the scene's shaders compile (the sun is fixed at 15:00) */
    setSun(sunDir, sunColor, fogColor) {
      const u = dome.material.uniforms; u.uSun.value.copy(sunDir); u.uSunCol.value.copy(sunColor);
      fogColor.copy(u.uHorizon.value);   // the haze is the colour of the sky at the horizon
      patchChunks(sunDir, u.uToSun.value, u.uAway.value, isTouch);   // v1.24: phones: cloud shadows per vertex
    },
    /** opt every lit material in the tree into the cloud shadows (call once, before compiling) */
    patch(root) {
      let n = 0;
      root.traverse(o => {
        if (!o.isMesh || !o.receiveShadow) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || patched.has(m) || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) continue;
          patched.add(m); n++;
          const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
          m.onBeforeCompile = function (s, r) { prev.call(this, s, r); s.uniforms.kkCloudT = cloudT; };
          m.customProgramCacheKey = () => key + '|kkcs';
          m.defines = Object.assign({}, m.defines, { KK_CLOUDSHADOW: '' });
          m.needsUpdate = true;
        }
      });
      return n;
    },
    addSmoke(sources) {
      if (!sources || !sources.length) return 0;
      this.smoke = chimneySmoke(sources, { isTouch }); scene.add(this.smoke.points); return this.smoke.count;
    },
    smoke: null, birds: null,
    addBirds(terrH) {
      const y = (x, z) => terrH(x, z);
      this.birds = birdFlocks([
        { name: 'koy', x: 225, z: 132, y: y(225, 132), h: 38, r: 70, n: 14, col: 0x2a2a2e, v: 10 },            // pigeons / jackdaws over the çarşı
        { name: 'koy2', x: 420, z: 300, y: y(420, 300), h: 55, r: 110, n: 9, col: 0x232326, v: 11 },
        { name: 'su', x: -300, z: -180, y: 0, h: 26, r: 120, n: 7, col: 0xd8d8d4, v: 8, size: 1.3 },           // gulls over the reservoir
      ]);
      scene.add(this.birds.group);
    },
    update(now, camera) {
      const t = now * 0.001; cloudT.value = t; dome.material.uniforms.uT.value = t;
      dome.position.copy(camera.position);
      if (this.smoke) this.smoke.update(t, renderer, camera);
      if (this.birds) this.birds.update(t);
    },
  };
}
