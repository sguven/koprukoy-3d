# Köprüköy 3D — realism notes

Two passes so far: **v0.7 "materials"** (surfaces only, nothing moved) and **v0.8 "square and mosque"**
(the old municipality square and the mosque rebuilt from the Street View photographs in `docs/reference/`). Everything is applied at load time in the browser; `model4.js` / `data4.js` /
`model/koprukoy.glb` are still the v0.6 files. Terrain (SRTM 30 m), the reservoir at 724 m, the
Çeşnigir Bridge body, D.260 and the roads outside the village are unchanged.

## v0.9 — the whole village from Google Maps (Nov 2026)

Measure of realism, as the owner asked: Google Maps. Three sources, all captured from the browser and
georeferenced on the Çeşnigir Bridge place pin (39.5809021 N, 33.4292022 E == model `(-376.89, -277.44)`,
1 unit = 1 m, +x east, +z south):

| Source | Capture | Used for |
|---|---|---|
| Map layer (roads) | 12 tiles at z17 (0.60 m/px), stitched to `docs/survey/map_layer_mosaic_small.jpg` | the road network: colour mask → skeleton → graph → junction clustering → 521 centrelines |
| Satellite | 24 tiles at z18 (0.30 m/px), `docs/survey/satellite_mosaic_0.3m_small.jpg` | 722 roof rectangles (tile / dark-red / blue sheet / white / grey), the mosque compound, cemeteries, the football pitch |
| Street View (Apr 2026) | 17 panoramas, `docs/reference/streetview/` with `NOTES.md` | storeys, roofs, wall types, kerbs, trees, the two minarets, the market, the school |

Scripts: `tools/trace_roads.py` → `tools/clean_roads.py` (map mosaic → `roads_clean.json`), `tools/trace_buildings.py`
(satellite mosaic → `buildings_traced.json`), `tools/build_village_data.py` (both → `src/village_data.js`).

**Georeference and the warp.** The v0.6 GLB has the Çeşnigir Bridge at its true position, but its D.260 viaduct
lies ~70 m north-east of the real alignment. Rather than move the viaduct, every traced coordinate is shifted by a
smooth vector (0 within 150 m of the bridge, the full `(+43.9, -54.6)` m beyond 500 m), so the shore road meets the
old bridge and the village roads meet the viaduct. The D.260 carriageways themselves stay as the GLB; the traced
road continues south-east of the viaduct's end as a 9 m asphalt ribbon.

**What changed**

- The hand-drawn v0.8 street network and the generated houses are gone. All roads are Google's: 26 "main" (the
  thick village road, 6.5 m asphalt with blue-white kerbs and utility poles), 119 secondary (5 m asphalt, kerbs),
  344 local concrete lanes (4 m), 11 dirt tracks outside the built area. Free ends within 32 m of the viaduct are
  snapped onto it.
- 722 buildings on their satellite footprints and orientations; storeys 2 when the roof is tile and >125 m² and
  compact; roof from the roof colour (tile/dark red → hip, blue → sheet metal, white/grey → flat). Garden walls:
  32 % rendered, 30 % dry-stone granite rubble (new material), 26 % wire fence.
- The photo-01 anchor (market junction) moved from `(55, 50)` to its true position `(258.1, 132.3)`, so the old
  municipality, the square with the Atatürk statue and the çardak are now where they really are; the Güvendioğlu
  Market is 2 storeys with a hip roof and the old tree in front (Street View 01).
- Mosque: **two** minarets at the north corners (satellite + Street View 05/12 — photo 06 cropped the second),
  compound enlarged to ~50 × 56 m with the grove in its western half and the lawn / picnic table / brick pavement
  between the west wall and the main road (Street View 04).
- Keskin Köprü İlkokulu as a 2-storey red-brown building; two walled cemeteries with headstones and pines; the
  football pitch; the real village extends ~150 m east of the terrain edge (x > 870) and is cut there.
- `#centre-only` restores the v0.8 behaviour (old roads and houses, only the square and the mosque rebuilt).

**Per-building Street View overrides** live in `tools/sv_overrides.json` (pin-frame position → storeys, wall colour, roof, fence type) and are matched to the nearest footprint by `build_village_data.py`; the cedar avenue east of the market is `SITES.treeRows`.

**Still open**: storey counts away from Street View coverage are guesses; the lake shoreline (SRTM) still differs
from the satellite by tens of metres south of D.260; the second mosque pair (Köprü Köyü Yeni Cami N-W, Fatih Camii
N-E) are plain houses in the data; no sun / lighting work (owner's request).

## v0.8 — square and mosque (Nov 2026)

Scope, as decided by the owner: only the **old municipality square** and the **mosque** are rebuilt from the
photographs in `docs/reference/`. Roads, houses, trees and the bridge stay as in v0.7. The full
re-layout of the centre that was also built (connected street network traced from the satellite image,
~260 houses, kerbs, poles, bridge voussoirs) is kept in the code behind opt-in URL flags —
`#village` (whole centre) and `#bridge-detail` — but is not shown by default.

| Area | Now |
|---|---|
| Old municipality | "T.C. Köprü Belediyesi" opposite the market (footprint detected from its roof in the satellite image): 3 storeys, dirty whitewash with red-brown pilasters between wide window bays, horizontal bands, entrance canopy and steps, sign board, low-pitch tile roof with wide eaves, flag pole. Walls are façades with real window openings (reveals, sills). |
| Square | Stabilised-earth square east of the building; the Atatürk statue (bronze figure on a granite pedestal), two benches, a litter bin, mulberry trees and the green-roofed çardak. The two old houses on the site were removed. |
| Mosque | Rebuilt after `06` inside the old courtyard footprint: pale turquoise lime wash, two rows of recessed windows, drum with windows and a lead main dome, four lead corner domes, a three-domed son cemaat yeri on limestone columns, one slender limestone minaret with a single şerefe and a lead külah; red-plastered courtyard wall with concrete coping and iron gates, ablution fountain, pines and mulberries in the yard. The old two-minaret mosque is removed. |
| Labels | "Village mosque", "Small mosque (mescit)" and "Village centre" removed; in walk / car modes labels are hidden beyond 320 m. Viewpoints "Village centre" and "Mosque" added. |

Collision and the minimap follow (the two footprints replace the old ones in `data4` in memory).

Debug / opt-in switches in the URL hash: `#village` (full centre re-layout), `#bridge-detail`,
`#no-village`, plus the v0.7 ones (`#no-terrain`, `#no-bld`, `#no-road`, `#no-rock`, `#no-water`,
`#no-trees`, `#no-cover`). `#lite` = low quality.

### Files

- `src/village_layout.js` — footprints and sites (centre-only layout by default; the full satellite-traced layout and street generator are here too). No three.js.
- `src/village.js` — geometry: municipality, statue, çardak, square, mosque (and, with `#village`, roads, kerbs, houses).
- `src/props.js` — trees, benches, bins, poles. `src/geo.js` — geometry toolkit (façades with holes, roofs, ribbons, patches, per-material batching).
- `src/village_materials.js` — turquoise / red / whitewash plaster, lead, limestone, kerb paint, road shaders.
- `src/bridge.js` — voussoirs, string course, coping, cutwater caps (opt-in).
- `tools/trace_roofs.py` — roof detection in the satellite image; `tools/plan_check.mjs` — layout dump; `tools/screenshot.mjs` — headless render harness.
- `docs/screenshots/v0.8_*` — square with the municipality, mosque, and (from the full re-layout) overview, street, top-down, plan overlay.

### Still open

1. Roads still do not connect to each other and houses are not placed from imagery — the full re-layout
   exists (`#village`) but needs wider satellite captures and more Street View frames in
   `docs/reference/` before it reflects the real village outside the photographed block.
2. Building geometry elsewhere is still boxes; road edges, bridge voussoirs and tree variety are available
   only behind the flags above.
3. Lighting / atmosphere intentionally untouched (owner's request).

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
