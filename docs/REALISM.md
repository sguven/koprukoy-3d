# Köprüköy 3D — realism notes

Two passes so far: **v0.7 "materials"** (surfaces only, nothing moved) and **v0.8 "square and mosque"**
(the old municipality square and the mosque rebuilt from the Street View photographs in `docs/reference/`). Everything is applied at load time in the browser; `model4.js` / `data4.js` /
`model/koprukoy.glb` are still the v0.6 files. Terrain (SRTM 30 m), the reservoir at 724 m, the
Çeşnigir Bridge body, D.260 and the roads outside the village are unchanged.

## v0.9.5 — the village as Street View shows it (Nov 2026)

The owner asked for the model to look like the real place, Street View being the measure: the houses were too
big ("2–3 storeys with lots of windows are rare here"), the roads tangled, several structures not real. Checked
against all 86 panoramas in `docs/reference/streetview/` and the Google Maps building layer
(`docs/survey/gmap_layer_classes.png`); renders from the same points and headings were compared frame by frame
(`tools/shoot_pw.mjs`, a Playwright harness that serves the repo with a local three.js).

Causes: the v0.9 roof detector fused neighbouring roofs and yards into 25–50 m rectangles (104 footprints over
250 m²); the storey rule made a third of the village two storeys; `buildHouse` put a window every 3.1 m, so a 20 m
wall got six per floor and read as an apartment block; 143 footprints ran into the road ribbons; the v0.6 GLB
scatters granite boulders over the streets; all 316 lanes were drawn as 4 m concrete with hard edges.

The data corrections are `tools/v095_fix.py` (run once on the v0.9.4 data, like `gmap_fix.py`):

- **Footprints.** Where the Google building layer shows two or more buildings inside one model rectangle, the
  rectangle is replaced by those footprints (19 cases); where it shows one much smaller building the rectangle
  shrinks to it (5); the remaining rectangles longer than 24 m become a house of 10–14 m and a lower barn / annex
  with a gap between (35) — the barns and sheds next to houses in Street View 07, 52, 64. 679 → 734 buildings.
- **Storeys.** Without a Street View override a house is single storey unless compact (85–210 m², aspect < 1.8,
  tile roof) and picked by a stable position hash; and since every notable two-storey house seen in the panoramas
  already has an override, an unconfirmed two-storey house within 55 m of a panorama point becomes single storey
  (46 cases — the renders of SV02, 16, 17 and 34 showed two-storey blocks where the panorama has one-storey
  houses). 119 two-storey buildings of 734 (was 225 of 679), the proportion seen along the main road and the
  mahalle lanes. Long single-storey halls get a sheet roof at times. Street View overrides (110 buildings with
  wall / fence / kind data) are untouched.
- **Off the roads.** 134 footprints moved away from the road ribbon (≤ 3.5 m), 48 also shrunk on the road side.
- **Roads.** Centrelines simplified (Douglas–Peucker 1.0 m) and despiked (turns > 60° between segments < 7 m),
  dead-end stubs under 12 m removed. **Snapped to the satellite image** (`tools/sat_roads.py`): the owner noticed
  that the Google road layer the network was traced from is generalised — it runs 10–20 m off the real lane in the
  mahalles, cuts across yards and the corner of the football pitch, and shows a few lanes that are not there. The
  0.3 m mosaic (`docs/survey/satellite_mosaic_0.3m_small.jpg`, georeferenced on the main roads) gives a road
  evidence map (pale, low-saturation ground above its 9 m neighbourhood, not green, never inside a building
  footprint or the pitch, averaged along the road direction over ±12 m so roofs and bright yards do not count);
  each centreline is re-fitted within ±16.5 m by dynamic programming (strongest evidence, fewest bends, a prior to
  stay) and accepted only when clearly better than the traced line. 274 roads moved (4.3 m on average), 113 kept,
  82 outside the mosaic left as traced, 3 lanes with no visible track removed, 2 trimmed; shared endpoints move
  together and T-junctions are re-projected. `docs/survey/v0.9.5_roads_snapped_to_satellite.jpg`: blue = traced,
  yellow = snapped. Surfaces follow the panoramas: only the main road and the streets within
  ~150 m of the çarşı (and the brick-paved lanes by Yeni Cami) stay asphalt / paved; 342 mahalle lanes and the
  outer secondary roads are compacted earth / gravel with grass verges (Street View 07, 08, 29, 44, 54, 58, 62,
  66, 70, 96). Village asphalt is pale and dusty (02, 15, 17), not dark.

Rendering (`src/village.js`, `village_layout.js`, `village_materials.js`, `terrain.js`):

- windows: 2–3 on a 10–12 m street front, at most 4 on a long one, 1–2 on side walls, blank stretches on long
  walls (03, 36, 57, 60); floor-to-floor 2.8 m; barns / annexes 2.6 m high with small openings, no balcony, no
  garden wall;
- roads lie on the ground: the per-road stagger that separates overlapping ribbons at junctions was index × 3 mm and
  had grown to 1.4 m over 467 roads, so the lanes ran on raised causeways; it is now at most 3 cm on a 6–12 cm lift,
  and a lane is told from the ground by its paler surface alone (owner's request);
- houses on slopes are cut deeper into the ground, so plinths stay 1–2 m instead of 3 m;
- `pruneRocks`: the merged GLB rock mesh is split into boulders (connected components); the 144 boulders on a road
  ribbon, in a yard or within 18 m of a house are dropped (56/57: a plastered house and an ashlar garden wall where
  the model had a 6 m boulder; 62–69, 83, 96/97: boulders between the houses of the E and N mahalles). The granite
  ridge beyond the last houses stays (07, 08, 58);
- rendered garden walls are whitewashed / grey block (06, 09, 31, 44, 88) instead of the GLB's brown;
- the terrain inside the built area is weedy spring grass between the houses (every April panorama), while the
  baked macro texture stays a dry late-summer image outside it.

Screenshots: `docs/screenshots/v0.9.5_*` — overview, top-down, the salmon and lilac two-storey houses of the v0.9
screenshots in their new surroundings, an E lane without boulders, the main road, an E earth road, and three
model-vs-Street-View comparison sheets (SV38–40, 59–61, 86–88); `docs/survey/v0.9.5_plan_over_google_layer.png` is
the corrected plan over the Google building / road layer (red two-storey, yellow single, cyan barns, pink overrides).

Not resolved: the Google Maps link the owner sent (maps.app.goo.gl) could not be opened from this environment, so
its uploaded photos were not used; storey counts away from Street View coverage remain estimates.

## v0.9.4 — checked against the Google Maps map layer (Nov 2026)

The owner pointed at the area south of Keskin Köprü İlkokulu: in reality it is all cemetery, with only a small
workshop (two long buildings) at its lower end — the model had houses and roads all over it. Cause: the v0.9 roof
detector took grave clusters, bushes and bare red ground for roofs, and the road tracer turned the lane markings of
the D.260 on the map into a ladder of short 9 m "roads".

Method: the Google Maps map layer (lyrs=m, z18, 13 × 19 tiles) was fetched in the browser and reduced to three classes
(road / building footprint / rest), `docs/survey/gmap_layer_classes.png` (0.92 m/px, origin tile 155414/99633). It
lies on the satellite image to within a metre (`docs/screenshots/v0.9.4_google_layer_over_satellite.png`). Every road
centreline and every building of `src/village_data.js` was tested against it; the 188 buildings with no Google
footprint within 4 m were checked one by one on z19 satellite thumbnails (Google's footprint layer misses many real
houses, so it was not used blindly). The corrections live in `tools/gmap_fix.json` and are applied to the v0.9.2 data
by `tools/gmap_fix.py`.

- **Cemetery** (`SITES.cemeteries`, new polygon form in `buildCemeteryPoly`): one polygon between the top road, the
  frontage road along the D.260, the curved road and the school road — scattered headstones with slabs, loosely in
  rows and clusters, junipers / pines / mulberries, a low rubble wall on the north and west edges — plus the dense
  grave strip on its east side. The two rectangular walled cemeteries are gone.
- **Ekinoğulları Demir Doğrama**: the "big two-storey house" was the first of two long single-storey workshops; both
  are now on their Google footprints (32.5 × 12.8 m and 26.5 × 10.6 m).
- **Buildings**: 124 false roofs removed (bare ground, grave clusters, pools, tarps, garden plots, concrete pads and
  7 on the D.260 carriageway itself); buildings with Street View overrides were kept even without a footprint (the
  roofless concrete frame etc.). 71 Google footprints that had no building were added (single storey, two storeys
  when compact and 125–300 m², sheet roof above 300 m²); nothing added near the mosque, the çarşı or Yeni Cami.
- **D.260**: the GLB viaduct stopped at (166, 576) and a single 9 m ribbon ran down the frontage road into a tangle of
  ~40 short pieces at the junction. Now both carriageways (8 m each, 12 m apart) continue along the Google band to the
  terrain edge; the curved road crosses it once (`d260x_crossing`). Village roads that had been labelled "D.260
  extension" got their real class (school road 6.5 m, junction roads 7 m, the curved road 8 m).
- **Roads**: 9 dead-end stubs and junction curls not on the map removed, one missing lane (`local_gm1`, the loop north of the cemetery)
  added. After the fix every road is on the map layer and every map-layer road inside the model area has a road.

## v0.9.3 — the old stone building by Yeni Cami (Nov 2026)

The owner pointed out the abandoned historic stone building just north-west of Köprü Köyü Yeni Cami (his satellite
screenshot + a Street View frame); it was missing. Placed from his 0.2 m/px satellite crop relative to the model roads
(narrow lane on its east side, the wider road to the south-west): centre (175.5, -105.5) model, 12.6 × 10.4 m,
yaw -0.316. Built by `buildStoneRuin` (`src/village.js`): 0.6 m fieldstone walls extruded with round-arched openings
(3 windows on the long sides, 2 on the short ones, an arched doorway on the unseen north side), cut-limestone arch
surrounds with keystones and sills, alternating limestone quoins, a mud-plastered base band, a stone cornice, a low
hipped roof of rusted corrugated sheet on timber eaves with two slipped sheets; most windows half or fully blocked
with loose rubble, the rest show the dark empty hall. A pine N and a mulberry at the NE corner (satellite crowns).
A fused 21 × 10 m roof trace on the open lot to its west (not in the current satellite photo) was dropped —
`tools/sv_overrides.json` now supports `"remove": true`.

Note: Street View 20/21 (`NOTES.md`) had read this stone building as the Yeni Cami prayer hall; the real mosque is
the tile-roofed building under the Google pin, south-east of it.

## v0.9.2 — the çarşı (Nov 2026)

The owner reported that the Atatürk statue in front of the old municipality / Güvendioğlu Market had disappeared,
and asked for the çarşı to match the real place exactly. Cause: v0.9 moved the municipality to its true position
(photo-01 anchor at the market junction) but the statue, the square and the çardak kept their hard-coded v0.8
coordinates (~(40, 50)), about 200 m west; in addition the traced road network ran a 4 m lane straight across the
square and nudged the municipality and the market (6.7 m) off their footprints.

Sources: `docs/reference/01` (satellite, 0.25 m/px), `02` and `05` (Street View, Apr 2026), SV01–03 notes.

- **Measured footprints, no nudging** (`CARSI_FIX` in `src/village_layout.js`): municipality 17.6 × 7.6 m walls
  (19 × 9 m tile roof in photo 01, rotated ~5°); Güvendioğlu Market 10.4 × 7.8 m, shop floor at street level on
  the west, dug into the slope behind; the kahve single-storey, tile hip roof, long axis N–S, opening onto the square.
- **Everything on the square is placed in the municipality's façade frame** (`carsiSites`: s = metres from the
  south end along the east façade, out = metres in front), so it can never drift away from the building again:
  statue at s 9.0 / out 3.3 (in front of the second bay), grass bed with a concrete kerb, two flag poles behind it
  (Turkish flag on the southern one), red shrub and a young tree on the left, a small juniper and the tall spruce
  on the right, a big juniper at the south-east corner by the lane, the kahve's green-roofed kiosk with tables and
  red chairs at the north end, big trees in front of the kahve, the old tree on the market pavement.
- **Statue**: bronze (dark olive patina) standing figure in a long greatcoat, arms down, ~3 m, on a light grey
  granite pedestal (2.16 m incl. two concrete steps) with a dark plaque on the front.
- **Municipality façade** after 02/05: five wide bays per long side with ribbon windows of three panes, red-brown
  pilasters, tall whitewashed spandrel bands between the floors, white iron grilles on the ground floor, the door
  and a small window in the southern bay under the "T.C. KÖPRÜ BELEDİYESİ" board (canvas texture), three chimneys.
- **Square and roads**: the open area is one pale, dusty gravel surface (`square` material lightened); the traced
  lane `local_260` is re-drawn along the east side of the square (6.5 m, kerb + pavement only on the market side,
  no asphalt drawn on the square itself), `main_284` removed, the lane west (`local_283`) runs along the
  municipality's south wall (SV03). The square is added to the collision / road samples (walkable, no grass on it).
- **Raised park south of the lane** (photo 02 left): rubble wall topped with blue and white painted kerb stones,
  lawn ~0.7 m above the square, big square wooden çardak (eight posts, railing, benches, two-tier green roof with
  a lantern), notice board, two big trees.
- Collision boxes for the statue, the kiosk and the çardak; `#centre-only` uses the same çarşı. The
  "Village centre" viewpoint now looks at the square.

Not modelled (transient in the photos): parked cars and vans, the greengrocer's crates.

## v0.9 — the whole village from Google Maps (Nov 2026)

Measure of realism, as the owner asked: Google Maps. Three sources, all captured from the browser and
georeferenced on the Çeşnigir Bridge place pin (39.5809021 N, 33.4292022 E == model `(-376.89, -277.44)`,
1 unit = 1 m, +x east, +z south):

| Source | Capture | Used for |
|---|---|---|
| Map layer (roads) | 12 tiles at z17 (0.60 m/px), stitched to `docs/survey/map_layer_mosaic_small.jpg` | the road network: colour mask → skeleton → graph → junction clustering → 521 centrelines |
| Satellite | 24 tiles at z18 (0.30 m/px), `docs/survey/satellite_mosaic_0.3m_small.jpg` | 722 roof rectangles (tile / dark-red / blue sheet / white / grey), the mosque compound, cemeteries, the football pitch |
| Street View (Apr 2026) | 28 panoramas (main road swept every ~30 m, both sides), `docs/reference/streetview/` with `NOTES.md` | storeys, roofs, wall types, kerbs, trees, the two minarets, the market, the school |

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

**Per-building Street View overrides** live in `tools/sv_overrides.json` (pin-frame position → storeys, wall colour, roof, fence type) and are matched to the nearest footprint by `build_village_data.py`; the cedar avenue east of the market is `SITES.treeRows`; `SITES.gardens` (tea garden S-W of the market, fenced green N), `SITES.minarets` (Köprü Köyü Yeni Cami: cut-stone hall + one minaret with a turquoise cap). Overrides can also *add* a footprint the roof detector missed (`add`), e.g. the unfinished block house at the north end.

**Still open**: storey counts away from Street View coverage are guesses; the lake shoreline (SRTM) still differs
from the satellite by tens of metres south of D.260; Fatih Camii (N-E) is still a plain house in the data; no sun / lighting work (owner's request).

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

### v0.9.1 — SW mahalle Street View eşlemesi
- 6 yeni panorama (SV34–39, `docs/reference/streetview/`): (4.8,217), (139,221), (52,204) pin-çerçeve noktaları, yola dik iki yön.
- Bina bazlı düzeltmeler (`tools/sv_overrides.json`): pergolalı beyaz ev + moloz istinat duvarı, kırmızı tuğla 2 kat + sac çit, çatısız betonarme karkas (uydudan tespit edilemediği için `add` ile eklendi, yeni `Duvar_Beton` malzemesi), krem/okr sıva 1 kat evler, açık yeşil sıva ev + kaldırım ağaçları.
- (149.6,264.2) ve (15.2,268.4) noktalarında Street View yok; bu iki sokak uydu + harita katmanından kalıyor.
- Batı ana yol + merkez-batı sokaklar (SV40–49): krem/beyaz 1 kat evler + blok duvar ve mavi kapı, beyaz 2 kat balkonlu + güneş ısıtıcılı evler, eski gri sıvalı 2 kat (89,90), bordo boyalı 1 kat (120,-4), hardal rengi 2 kat (180,142). SV15'teki "harabe dükkân sırası" override'ı yanlış binaya yapışıyordu → (203,135)'e `add` olarak taşındı. (193,-3)'te Street View yok.
- Doğu yakası (SV50–75, Köprüköy Köyü Yolu + güney/güneydoğu sokaklar): 26 panorama, 30 bina düzeltmesi — tuğla 2 katlar, somon/açık mavi 2 katlar, kerpiç ahırlar, moloz harabe, konteyner, sac sundurma; ağaç altında kalıp uydudan tespit edilemeyen 3 bina `add` ile eklendi. Not: Street View URL API'si hızlı ardışık isteklerde boş ("0a") dönüyor — nokta başına ≥20 s ara gerekiyor.
- Güney ana yol (SV76/77): köy parkı — çim, oyun alanı (kaydırak + salıncak, `buildPlayground`), banklar — `gardens[].play` ile eklendi (375,383 pin).
- Güney / okul bölgesi (SV78–93): 16 panorama, 21 düzeltme — sarı/leylak/beyaz 2 katlar, kerpiç kırmızı ev, pompa kulübesi, beyaz çadır hangar, uzun bej salon; `Duvar_Lila` malzemesi eklendi; uydudan kaçan 4 bina `add` ile eklendi.
- Kuzey (SV94–99): Yeni Cami yanı moloz ahır, gri sundurma, kuzey sırtı tuğla/briket evler, plastik örtülü saman tünelleri. (396,-34), (300,-94), (426,-112), (-17,-30) noktalarında Street View yok (kuzeydoğu/Fatih Camii çevresi ve batı uç kapsama dışı).
- Yamaç evleri: taban kotu artık en yüksek köşe yerine düşüşün ortasına oturuyor (kazı-dolgu), 1.9 m'yi aşan kaideler moloz istinat duvarı malzemesiyle çiziliyor — SV78/86/99'daki görünüm.
