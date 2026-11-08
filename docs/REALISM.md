# Köprüköy 3D — realism notes

Two passes so far: **v0.7 "materials"** (surfaces only, nothing moved) and **v0.8 "village rebuilt"**
(the village centre re-drawn from the satellite image and the Street View photographs in
`docs/reference/`). Everything is applied at load time in the browser; `model4.js` / `data4.js` /
`model/koprukoy.glb` are still the v0.6 files. Terrain (SRTM 30 m), the reservoir at 724 m, the
Çeşnigir Bridge body, D.260 and the roads outside the village are unchanged.

## v0.8 — village rebuilt (Nov 2026)

The measure of realism for this pass is the set of photographs in `docs/reference/` (01 satellite view of
the centre, 02/05 the old municipality and the Atatürk statue, 03/04 typical houses, kerbs and a green,
06 the mosque). Köprüköy itself: a former *belde* (town council until 2013) east of the Kapulukaya
reservoir, ~630 inhabitants, one- and two-storey rendered houses with hipped clay-tile roofs.

| Area | Before (v0.7) | Now |
|---|---|---|
| Road network | 62 village streets that did not connect to each other (random spaghetti) | `src/village_layout.js`: the centre is traced from the satellite image — "Köprüköy Köyü Yolu" as the east–west axis through the Güvendioğlu Market junction, the north–south road, the mosque street, the south-west concrete lane. Outside the photographed block the streets are continued as a connected rural network that joins the surviving v0.6 roads: the D.260 access in the south-west, the two roads leaving north, the three leaving south and the shore road. 26 streets, every one of them connected. |
| Houses | 514 boxes scattered without relation to the roads | 31 central buildings detected automatically from their tile roofs in the satellite image (`tools/trace_roofs.py`: position, size and orientation), 3 flat roofs added by hand; ~230 further houses and barns generated along the streets in plots, facing the road, denser near the centre. All old houses inside the village were deleted. |
| Building geometry | plain boxes, detail only in the shader | `src/village.js`: walls built as façades with real window and door openings (recessed 16 cm with reveals), sills, plinths that follow the ground, hipped / gabled / sheet-metal / flat roofs with eaves, fascia boards, soffits, ridge, gutters and a downpipe, chimneys, balconies with railings, external stairs on some two-storey houses, AC units, roof water tanks, satellite dishes, solar water heaters, rebar stubs on flat roofs. Garden walls (rubble or block, with gate posts and a painted gate) or wire fences on the street side. |
| Old municipality | not modelled | "T.C. Köprü Belediyesi" opposite the market: 3 storeys, dirty whitewash with red-brown pilasters between wide window bays, horizontal bands, entrance canopy and steps, sign board, low-pitch tile roof with wide eaves, flag pole. In front of it a stabilised-earth square and the Atatürk statue (bronze figure on a granite pedestal), benches, mulberry trees and the green-roofed çardak. |
| Mosque | generic whitewash box with two minarets | Rebuilt after `06`: pale turquoise lime wash, two rows of recessed windows, drum with windows and a lead main dome, four lead corner domes, a three-domed son cemaat yeri on limestone columns, one slender limestone minaret with a single şerefe and a lead külah; red-plastered courtyard wall with concrete coping and iron gates, ablution fountain, pines inside the yard; lawn, pavement and a picnic table along the street outside. |
| Road surfaces | ribbons with world-space texture only | New road meshes with per-road UVs: wheel tracks (slightly wavy), dust creeping in from the edges, repair patches, soft soil shoulders; concrete lane with slab joints; dirt tracks with darker ruts and a grassy crown. Kerbs with alternating blue / white painted blocks (worn) and 1.5 m paved pavements on the asphalt streets of the centre, interrupted at junctions. |
| Çeşnigir Bridge | smooth faces with a stone texture | `src/bridge.js`: carved voussoir rings on both faces of all 19 arch openings with a raised keystone, a projecting string course under the parapet, hand-laid coping stones along the parapet, pyramidal caps on the six cutwaters. Dimensions unchanged. |
| Vegetation & props | coloured blobs everywhere, no street furniture | Old trees inside the village removed; poplars along the main streets, mulberries on the square and in gardens, small fruit trees in plots, pines at the mosque (simple models, porous canopy shader). Concrete utility poles with three sagging cables, wire fences, benches, orange litter bins, picnic table, stone piles near barns. |
| Labels | "Village mosque", "Small mosque (mescit)", "Village centre" | Removed (the mescit was a guess; the centre and the mosque are now recognisable). In walk / car modes labels are hidden beyond 320 m. Viewpoints "Village centre" and "Mosque" added. |

Collision, the Toros, the minimap and the ground-cover scatter all use the new roads and footprints
(`data4` arrays are rewritten in memory at load). Car spawn is on the main road west of the junction;
walk spawn is on the square.

Debug switches in the URL hash: `#no-village`, `#no-bridge` (plus the v0.7 ones: `#no-terrain`,
`#no-bld`, `#no-road`, `#no-rock`, `#no-water`, `#no-trees`, `#no-cover`). `#lite` = low quality.

### How the centre was georeferenced

The satellite screenshot has no scale bar; 0.25 m/px was chosen from the road width (~6 m) and typical
house sizes (10–14 m), and the market junction was pinned at model (55, 50) so that the mosque lands
where the v0.6 draft had it. Absolute position relative to the bridge is therefore approximate
(±30 m); the layout *within* the centre follows the photo. `docs/screenshots/v0.8_plan_vs_satellite.png`
overlays the generated plan on the satellite image.

### Files

- `src/village_layout.js` — roads (control points in image px / model m), traced buildings, generation of the periphery, data4 helpers. No three.js.
- `src/village.js` — geometry: roads, kerbs, pavements, square, houses, municipality, statue, çardak, mosque.
- `src/props.js` — trees, poles and cables, benches, bins, picnic table, stone piles. `src/geo.js` — geometry toolkit (façades with holes, roofs, ribbons, patches, per-material batching with the building attributes).
- `src/village_materials.js` — road shaders with UV ruts, kerb paint, turquoise / red / whitewash plaster, lead, limestone, lawn.
- `src/bridge.js` — voussoirs, string course, coping, cutwater caps.
- `tools/trace_roofs.py` — roof detection in the satellite image; `tools/plan_check.mjs` — dumps the layout for a top-down check; `tools/screenshot.mjs` — headless render harness.
- `docs/screenshots/v0.8_*` — overview, square with the municipality, mosque, street, bridge, top-down, plan overlay.

### Still open after v0.8

1. The periphery (outside the ~190 × 150 m photographed block) is plausible, not surveyed — a wider
   satellite capture would let `tools/trace_roofs.py` replace the generated houses there too.
2. Ground-level clutter: no parked cars, tractors, hay bales, satellite-image-based garden layouts.
3. Terrain resolution is still SRTM 30 m, so the square and the mosque yard sit on a gently tilted plane
   (the plinths and walls follow it).
4. Trees are simple volumes (no bark detail, no branches); willows along the water were not added.
5. Lighting / atmosphere intentionally untouched (owner's request).

## v0.7 — materials pass

Goal of this pass: make the existing, surveyed model *look* like the place without moving anything.

| Area | Before | Now |
|---|---|---|
| Terrain | one baked 2048² satellite-style texture, flat colour | `src/terrain.js`: the satellite-derived map is kept as the *macro* layer and modulates five detail layers blended by slope, elevation, shoreline distance and noise: dry soil, dry steppe grass, gravel, wet shoreline sediment, weathered rock on steep faces. |
| Buildings | flat Blender colours, no UVs | `src/buildings.js`: world-space triplanar lime plaster with per-house tint/fade jitter; ~14 % rubble stone, ~10 % bare concrete; rain-splash band, eaves streaks, grime. Clay-tile roofs whose courses follow the slope; corrugated metal variant. Windows: frames, mullions and reveals in the shader, dark / curtained / lit interiors. |
| Roads | uniform light grey | `src/surfaces.js`: worn asphalt, compacted earth, concrete with slab joints, paving, kerbs. |
| Çeşnigir Bridge | flat beige | Seljuk-type dressed ashlar, per-block tone variation, soot streaks, damp band with algae above the water line. |
| Granite outcrops | smooth grey domes | roughened on the CPU with world-space noise; pale granite with speckle, iron staining, lichen. |
| Water | opaque saturated cyan | depth-aware reservoir (turbid shallows, dark deep water), two ripple scales, Fresnel. |
| Trees | smooth blobs | world-space leaf-cluster cut-out (porous canopies, dappled shadows), bark on trunks. |
| Ground cover | none | `src/vegetation.js`: ~48 000 grass tufts and ~9 000 shrubs, instanced, rule-based scatter. |
| Textures | — | `tools/gen_textures.py`: 15 seamless PBR sets, 8 MB total (`tex/`). |
| Tone mapping | ACES | AgX. |

Quality tiers: `QUALITY` in `index.html` — 2 desktop, 1 touch devices, 0 for `#lite`.
