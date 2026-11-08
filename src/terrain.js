// Multi-layer terrain material: Central Anatolian steppe.
// Keeps the existing satellite-derived macro texture (so fields, bare patches and the village clearing stay
// geographically correct) and adds slope/elevation/shoreline-driven detail layers: dry soil, dry grass, gravel,
// shoreline sediment and weathered rock on steep slopes. Geometry is untouched, so collision stays exact.
import * as THREE from 'three';
import { addWorldVaryings } from './pbr.js';

export function terrainMaterial(lib, macroMap, { quality = 2, waterLevel = 0 } = {}) {
  const soil = lib.set('soil'), grass = lib.set('grass_dry'), gravel = lib.set('gravel'), rock = lib.set('rock'), shore = lib.set('shore');
  const noise = lib.tex('noise.jpg');
  const mat = new THREE.MeshStandardMaterial({ map: macroMap, roughness: 1.0, metalness: 0, color: 0xffffff });
  mat.envMapIntensity = 0.25;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      tSoilC: { value: soil.c }, tSoilN: { value: soil.n }, tSoilR: { value: soil.r },
      tGrassC: { value: grass.c }, tGrassN: { value: grass.n },
      tGravelC: { value: gravel.c }, tGravelN: { value: gravel.n },
      tRockC: { value: rock.c }, tRockN: { value: rock.n }, tRockR: { value: rock.r },
      tShoreC: { value: shore.c }, tShoreN: { value: shore.n },
      tNoise: { value: noise },
      uSoilS: { value: 1 / soil.size }, uGrassS: { value: 1 / grass.size }, uGravelS: { value: 1 / gravel.size }, uRockS: { value: 1 / rock.size }, uShoreS: { value: 1 / shore.size },
      uWater: { value: waterLevel },
    });
    shader.defines.KK_QUALITY = quality;
    addWorldVaryings(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform sampler2D tSoilC, tSoilN, tSoilR, tGrassC, tGrassN, tGravelC, tGravelN, tRockC, tRockN, tRockR, tShoreC, tShoreN, tNoise;
        uniform float uSoilS, uGrassS, uGravelS, uRockS, uShoreS, uWater;`)
      .replace('#include <map_fragment>', /* glsl */`
        vec3 gN = normalize(vWNormal);
        vec4 macroTex = texture2D(map, vMapUv);
        vec3 macro = macroTex.rgb;
        float lum = dot(macro, vec3(0.3, 0.5, 0.2));
        float greenness = macro.g - max(macro.r, macro.b) * 0.92;
        float camDist = length(vWPos - cameraPosition);
        float detail = 1.0 - smoothstep(220.0, 1100.0, camDist);
        vec2 pxz = vWPos.xz;
        vec3 nz = texture2D(tNoise, pxz * 0.0021).rgb;      // ~480 m macro noise
        vec3 nz2 = texture2D(tNoise, pxz * 0.013 + 0.37).rgb; // ~77 m
        float k = 0.5 + 0.5 * nz2.g;                           // anti-tiling blend

        // ---- layer weights
        float slope = 1.0 - gN.y;
        float hAbove = vWPos.y - uWater;
        float wRock = smoothstep(0.22, 0.45, slope + (nz2.r - 0.5) * 0.18);
        wRock = max(wRock, smoothstep(0.62, 0.78, nz.b) * smoothstep(0.1, 0.25, slope) * 0.6); // rocky patches on moderate slopes
        float wShore = (1.0 - smoothstep(0.6, 2.6, hAbove)) * (1.0 - wRock * 0.7);
        float wGrass = smoothstep(0.02, 0.14, greenness + (nz2.b - 0.5) * 0.08) * (1.0 - smoothstep(0.25, 0.45, slope));
        wGrass = max(wGrass, smoothstep(0.55, 0.75, nz.g) * 0.35 * (1.0 - smoothstep(0.2, 0.4, slope))); // thin steppe grass tufts
        float wGravel = smoothstep(0.52, 0.66, lum + (nz2.r - 0.5) * 0.1) * (1.0 - wGrass);
        wGravel = max(wGravel, smoothstep(0.1, 0.22, slope) * 0.35);
        // normalise: rock on top, then shore, then grass/gravel over soil
        float wSoil = 1.0;
        wGrass *= (1.0 - wRock) * (1.0 - wShore); wGravel *= (1.0 - wRock) * (1.0 - wShore) * (1.0 - wGrass);
        wShore *= (1.0 - wRock);
        wSoil = max(0.0, 1.0 - wRock - wShore - wGrass - wGravel);

        // ---- sample layers (ground layers planar from above, rock triplanar)
        vec3 albedo = vec3(0.0); vec3 tn = vec3(0.0); float rough = 0.0;
        vec3 wTri = kk_triW(gN, 4.0);
        if (wSoil > 0.004) {
          vec4 c = kk_planar2(tSoilC, pxz * uSoilS, k); albedo += c.rgb * wSoil;
          tn += (texture2D(tSoilN, pxz * uSoilS).xyz * 2.0 - 1.0) * wSoil;
          rough += kk_planar2(tSoilR, pxz * uSoilS, k).r * wSoil;
        }
        if (wGrass > 0.004) {
          vec4 c = kk_planar2(tGrassC, pxz * uGrassS, k); albedo += c.rgb * wGrass;
          #if KK_QUALITY > 1
          tn += (texture2D(tGrassN, pxz * uGrassS).xyz * 2.0 - 1.0) * wGrass;
          #else
          tn += vec3(0.0, 0.0, 1.0) * wGrass;
          #endif
          rough += 0.9 * wGrass;
        }
        if (wGravel > 0.004) {
          vec4 c = kk_planar2(tGravelC, pxz * uGravelS, k); albedo += c.rgb * wGravel;
          tn += (texture2D(tGravelN, pxz * uGravelS).xyz * 2.0 - 1.0) * wGravel;
          rough += 0.85 * wGravel;
        }
        if (wShore > 0.004) {
          vec4 c = kk_planar2(tShoreC, pxz * uShoreS, k); albedo += c.rgb * wShore;
          tn += (texture2D(tShoreN, pxz * uShoreS).xyz * 2.0 - 1.0) * wShore;
          rough += mix(0.35, 0.8, smoothstep(0.0, 1.2, hAbove)) * wShore; // damp band just above the water
        }
        // planar normals -> world (uv = world xz, so tangent = +x, bitangent = +z)
        vec3 wN = normalize(gN + vec3(tn.x, 0.0, tn.y) * 0.9 * detail * (1.0 - wRock));
        if (wRock > 0.004) {
          vec3 pr = vWPos * uRockS;
          vec4 c = kk_tri2(tRockC, pr, wTri, k); albedo += c.rgb * wRock;
          vec3 rn = kk_triNormal(tRockN, pr, wTri, gN, 1.0 * detail);
          wN = normalize(mix(wN, rn, wRock));
          rough += kk_tri(tRockR, pr, wTri).r * wRock;
        }

        // ---- macro colour: keep the satellite-derived pattern, use it to modulate the detail layers
        vec3 macroN = macro / max(0.25, lum);
        macroN = mix(vec3(1.0), macroN, 0.75);
        vec3 col = albedo * macroN;
        // elevation / exposure variation: higher, exposed ground is paler and drier
        col *= 0.92 + 0.16 * smoothstep(20.0, 110.0, vWPos.y) + (nz.r - 0.5) * 0.18;
        // damp darkening right at the waterline, light wetness below water
        col *= 1.0 - 0.35 * (1.0 - smoothstep(-0.5, 1.0, hAbove));
        // fade detail to the macro map in the distance
        col = mix(macro * vec3(1.02, 1.0, 0.96), col, detail);
        diffuseColor.rgb *= col;
        float roughnessK = mix(1.0, clamp(0.55 + 0.9 * rough, 0.3, 1.0), detail);`)
      .replace('#include <normal_fragment_maps>', `normal = kk_viewN(wN);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = roughness * roughnessK;`);
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'kk_terrain_' + quality;
  return mat;
}
