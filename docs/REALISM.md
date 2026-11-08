# Köprüköy 3D — v0.7 "materials" pass

Goal of this pass: make the existing, surveyed model *look* like the place without moving anything.
Geometry, coordinates, road network, building footprints, bridge dimensions, the 724 m lake level,
collision, the Toros physics and all camera modes are unchanged. Everything below is applied at load
time to the scene graph in the browser; `model4.js` / `data4.js` / `model/koprukoy.glb` are untouched.

## What was done

| Area | Before | Now |
|---|---|---|
| Terrain | one baked 2048² satellite-style texture, flat colour | `src/terrain.js`: the satellite-derived map is kept as the *macro* layer (fields, bare patches, village clearing stay geographically correct) and modulates five detail layers blended by slope, elevation, shoreline distance and noise: dry soil, dry steppe grass, gravel, wet shoreline sediment, weathered rock on steep faces. Detail normals/roughness; detail fades to the macro map beyond ~1 km. |
| Buildings | flat Blender colours, no UVs | `src/buildings.js`: every vertex is tagged with its building id, ground line, roof line and yaw before meshes are merged. Façades are world-space triplanar lime plaster with per-house tint/fade jitter; ~14 % of houses get rubble stone walls, ~10 % bare concrete/brick; rain-splash band at the base, eaves streaks, grime. Roofs: clay tiles whose courses follow the roof slope of each house, moss/dust on older roofs; corrugated-metal variant for the sheet roofs. Plinths (concrete or rough stone), rubble/concrete garden walls, timber or painted doors, soot-stained chimneys. Windows: frames, mullions and reveals drawn in the shader, with dark/curtained/lit interiors varying per window. |
| Roads | uniform light grey | `src/surfaces.js`: worn asphalt with dust creeping in from the edges and repair patches; compacted-earth tracks with gravel showing through; concrete roads with 4 m slab joints; paving blocks; kerbs. Polygon offset removes distant z-fighting with the terrain. |
| Çeşnigir Bridge | flat beige | Seljuk-type dressed ashlar (0.6 × 0.35 m blocks, recessed joints), per-block tone variation, soot streaks, a dark damp band with algae just above the water line. Dimensions unchanged. |
| Granite outcrops | smooth grey domes | vertices roughened once on the CPU with 3-octave world-space noise (silhouettes and shadows follow), pale granite with mineral speckle, iron staining, lichen on upper faces, dust in hollows. |
| Water | opaque saturated cyan plane | depth-aware reservoir: reads the terrain height grid, so the shallows are turbid green-brown, deep water dark blue-green, shoreline fades softly; two scales of drifting ripples with calm/wind patches; Fresnel-weighted reflectivity; ripples flatten with distance. 724 m level kept. |
| Trees | smooth coloured blobs | world-space leaf-cluster cut-out makes canopies porous (sky and light show through), shadows are dappled via a matching depth material; bark texture on trunks. |
| Ground cover | none | `src/vegetation.js`: ~48 000 dry-grass tufts and ~9 000 low shrubs (instanced, crossed cards) scattered by rules: not in water, not on roads, not inside plots, thinner on steep ground and bright bare patches, denser where the satellite map is green. Fade with distance and with steep (aerial) view angles so the top-down view stays clean. Wind sway. |
| Textures | — | `tools/gen_textures.py`: 15 seamless PBR sets (albedo / normal / roughness, 1024²) generated procedurally with real-world tile sizes recorded in `tex/manifest.json`; plus foliage, grass/shrub cards, water normals and a noise map. 8 MB total. |
| Tone mapping | ACES at 0.5 exposure | AgX (filmic, keeps highlights from clipping to white). |

Quality tiers: `QUALITY` in `index.html` — 2 desktop, 1 touch devices (fewer terrain normal layers, ~¼ of the ground cover), 0 for `#lite` (no ground cover).

Debug switches in the URL hash (useful when something looks wrong): `#no-terrain`, `#no-bld`, `#no-road`, `#no-rock`, `#no-water`, `#no-trees`, `#no-cover`.

## Files

- `index.html` — imports the realism layer; `mergeByMaterial` now keeps all vertex attributes; tone mapping; UI text. Lighting code is unchanged apart from removing the sun disc from the environment map (otherwise the baked sun in the sky probe washed out every cast shadow).
- `src/pbr.js` texture library + triplanar PBR material factory · `src/terrain.js` · `src/buildings.js` · `src/surfaces.js` (roads, rocks, water) · `src/vegetation.js` · `src/realism.js` (orchestration)
- `tex/` generated textures · `tools/gen_textures.py` generator · `tools/screenshot.mjs` headless render harness (Chrome + SwiftShader; needs a local copy of three.js, see the file header)
- `docs/screenshots/` before / after contact sheets

## Not done / open

Ordered roughly by visual impact.

1. **Lighting & atmosphere** — intentionally left alone at the owner's request. Sun/sky/fog values are the v0.6 ones (plus the env-map sun-disc fix). Golden-hour and sunset were not re-tuned; no height fog, no ambient occlusion pass.
2. **Road edges** — roads are still ribbons laid on the terrain: no soft blend into the soil, no shoulders, no tyre ruts aligned with the road direction (would need per-road UVs derived from the `data4.js` centrelines — feasible, ~1 day).
3. **Building geometry** — walls are still plain boxes: no recessed windows, sills, gutters, balconies, external stairs, AC units, water tanks, satellite dishes. Only shader-level detail was added. Needs either a Blender pass or a procedural "decorate each house" step on load.
4. **Mosque / village centre** — only the generic whitewash and lead-dome materials were applied; no stone courses, minaret balconies, windows or courtyard detail. The real mosque was not identified from photographs.
5. **Bridge geometry** — the voussoir pattern around the arches, cutwater detail and parapet stones are still smooth surfaces with a stone texture; arch soffits are now rendered double-sided but have no baked occlusion.
6. **Vegetation realism** — trees remain low-poly volumes (now porous); no real tree models, no species variety beyond colour, no poplars/willows along the water, no utility poles, fences, stone piles or agricultural detail.
7. **Higher-resolution elevation** — the sandbox could not download data (network allow-list), so SRTM 30 m stays; there is no procedural erosion or drainage-channel displacement (collision uses the same grid, so any displacement must stay in the shader).
8. **Water reflections** — environment/sky only; no planar reflection of the bridge and cliffs.
9. **Compressed textures (KTX2/Basis)** — not generated; textures ship as JPEG/PNG.
10. **Performance validation on real hardware** — only software rendering in the sandbox was tested; Toros/Walk/Fly were smoke-tested (no errors), not play-tested. Expect the desktop tier to be heavier than v0.6 (triplanar terrain + 57 k instances); the touch tier is lighter but unmeasured.

## Assumptions that could not be verified

- Wall finish mix (plaster / rubble stone / bare concrete) and the colour palette are typical for rural Kırıkkale but were not checked against photographs of Köprüköy itself.
- Roof-tile type (Marseille) and the share of corrugated-metal roofs follow the material names already in the model.
- Bridge stone colour and block size (0.6 × 0.35 m) are generic Seljuk ashlar values, not measured from Çeşnigir photos.
- Reservoir water colour (turbid green shallows, dark blue-green depths) is a reasonable guess for Kapulukaya.
