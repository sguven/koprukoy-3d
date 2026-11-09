# Köprüköy 3D — realism notes

Two passes so far: **v0.7 "materials"** (surfaces only, nothing moved) and **v0.8 "square and mosque"**
(the old municipality square and the mosque rebuilt from the Street View photographs in `docs/reference/`). Everything is applied at load time in the browser; `model4.js` / `data4.js` /
`model/koprukoy.glb` are still the v0.6 files. Terrain (SRTM 30 m), the reservoir at 724 m, the
Çeşnigir Bridge body, D.260 and the roads outside the village are unchanged.

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
