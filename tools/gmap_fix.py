"""v0.9.4 — check src/village_data.js against the Google Maps map layer and fix what does not match.

Input: docs/survey/gmap_layer_classes.png — the Google Maps road layer (lyrs=m) at z18, 13 x 19 tiles from tile
(155414, 99633), halved to 0.92 m/px and reduced to three classes: red = road, green = building footprint, black = rest.
Satellite thumbnails (z19) were used by eye for every building that has no Google footprint (see docs/REALISM.md).

What it does (run once on the v0.9.2 data; it refuses to run twice):
  1. removes 124 roof detections that are not buildings (bare ground, graves, tarps, pools, the D.260 asphalt ...)
     and adds the 71 Google footprints that have no building in the model;
  2. the two long workshops of Ekinoğulları Demir Doğrama on their Google footprints, single storey;
  3. removes dead-end stubs / junction curls that are not on the map and the tangle of 9 m fragments at the D.260 / cemetery junction;
  4. the D.260 dual carriageway continued from the end of the GLB viaduct along the Google band to the terrain edge;
  5. village roads that were mislabelled as "D.260 extension" (9 m) get their real class (school road, junction roads);
  6. the big cemetery between the frontage road, the school road and the curved road as one polygon (sparse graves,
     trees, rubble wall on the north and west) plus the dense grave strip on its east side.
Usage: python3 tools/gmap_fix.py   (from the repo root)
"""
import json, math, re, sys
import numpy as np
from PIL import Image

SRC = 'src/village_data.js'
src = open(SRC).read()
if 'gmap_fix v0.9.4' in src:
    sys.exit('already applied')

# ------------------------------------------------------------------ georeference (same as build_village_data.py)
LAT0, LON0, BX, BZ, MLAT, MLON = 39.5809021, 33.4292022, -376.89, -277.44, 110574, 85797.1812415668
BRIDGE, SHIFT = (-376.89, -277.44), (43.9, -54.6)
def warp(x, z):
    d = math.hypot(x - BRIDGE[0], z - BRIDGE[1]); w = max(0.0, min(1.0, (d - 150) / 350))
    return x + SHIFT[0] * w, z + SHIFT[1] * w
def unwarp(X, Z):
    x, z = X, Z
    for _ in range(30):
        a, b = warp(x, z); x += X - a; z += Z - b
    return x, z
TX0, TY0, NW = 155414 * 256, 99633 * 256, 256 * 2 ** 18
def model2px(X, Z):
    x, z = unwarp(X, Z); lon = LON0 + (x - BX) / MLON; lat = LAT0 - (z - BZ) / MLAT
    s = math.sin(math.radians(lat))
    return ((lon + 180) / 360 * NW - TX0) / 2, ((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * NW - TY0) / 2
def screen2model(u, v, clat=39.5722, clon=33.4372, mpp=0.737, cx=400, cy=312.5):
    """pixel in the 800x625 satellite capture centred on (clat, clon) -> model metres"""
    px0 = (clon - LON0) * MLON + BX; pz0 = (LAT0 - clat) * MLAT + BZ
    return warp(px0 + (u - cx) * mpp, pz0 + (v - cy) * mpp)
G = np.array(Image.open('docs/survey/gmap_layer_classes.png').convert('RGB'))
ROAD = (G[..., 0] > 128) & (G[..., 1] < 128)
def on_road(x, z):
    u, v = model2px(x, z); u, v = int(u), int(v)
    return 0 <= v < ROAD.shape[0] and 0 <= u < ROAD.shape[1] and ROAD[v, u]

# ------------------------------------------------------------------ parse
roads_txt = re.search(r"export const ROADS = \[\n(.*?)\n\];", src, re.S).group(1).split('\n')
bld_txt = re.search(r"export const BUILDINGS = \[\n(.*?)\n\];", src, re.S).group(1).split('\n')
sites = json.loads(re.search(r"export const SITES = (\{.*\});", src).group(1))
rid = lambda l: re.search(r"id: '([^']+)'", l).group(1)
R = {rid(l): l for l in roads_txt}

# ------------------------------------------------------------------ 1. buildings that are not there
fix = json.load(open('tools/gmap_fix.json'))
drop = {tuple(p) for p in fix['remove_buildings']}
keep = []
for l in bld_txt:
    v = l.strip().rstrip(',')[1:-1].split(',')
    if (float(v[0]), float(v[1])) in drop: continue
    keep.append(l)
print('buildings', len(bld_txt), '->', len(keep))
# ------------------------------------------------------------------ 2. Ekinoğulları Demir Doğrama
for old, new in fix['replace_buildings']:
    i = next(k for k, l in enumerate(keep) if l.strip().startswith('[%s,%s,' % tuple(old)))
    keep[i] = '  ' + json.dumps(new).replace('"', "'").replace("'{", '{') + ','
    keep[i] = keep[i].replace("{'wall': 'Duvar_Krem', 'fence': 'none'}", '{"wall": "Duvar_Krem", "fence": "none"}')
# ------------------------------------------------------------------ 1b. Google footprints the roof detector missed
# (outside the 0.3 m satellite mosaic, under trees, grey roofs); not near the mosque / çarşı / Yeni Cami, < 600 m²
for b in fix.get('add_buildings', []):
    keep.append('  [%s,%s,%s,%s,%s,%d,\'%s\'],' % tuple(b))

# ------------------------------------------------------------------ 3. roads that are not on the map
for r in fix['remove_roads']: R.pop(r)
# ------------------------------------------------------------------ 5. mislabelled "D.260 extension" roads
for r, (kind, w, kerb) in fix['reclass_roads'].items():
    R[r] = re.sub(r"kind: '\w+', w: [\d.]+, kerb: \w+", f"kind: '{kind}', w: {w}, kerb: {'true' if kerb else 'false'}", R[r])

# ------------------------------------------------------------------ 4. D.260 continued along the Google band
# GLB viaduct ends with its two carriageway rows at (166.2, 570.9) and (156.1, 580.7); march south-east along
# the band, re-centring on the road pixels of the map layer every 15 m.
d = np.array([252., 328.]); d /= np.linalg.norm(d); n = np.array([-d[1], d[0]])
c = np.array([161.2, 575.8]); line = [c.copy()]
for step in range(60):
    c = c + d * 15
    offs = [o for o in np.arange(-22, 22.5, 0.5) if on_road(*(c + n * o))]
    if offs:
        runs, cur = [], [offs[0]]
        for o in offs[1:]:
            if o - cur[-1] > 1.0: runs.append(cur); cur = [o]
            else: cur.append(o)
        runs.append(cur)
        # the dual carriageway = the group of runs nearest the current centre spanning >= 10 m
        best = min(runs, key=lambda r: abs((r[0] + r[-1]) / 2))
        grp = [r for r in runs if abs((r[0] + r[-1]) / 2 - (best[0] + best[-1]) / 2) < 14]
        lo, hi = min(r[0] for r in grp), max(r[-1] for r in grp)
        if hi - lo >= 8: c = c + n * ((lo + hi) / 2) * (0.5 if step < 3 else 1.0)
    line.append(c.copy())
    if c[1] > 905 or c[0] > 905: break
L = np.array(line)
for _ in range(3): L[1:-1] = (L[:-2] + L[1:-1] * 2 + L[2:]) / 4          # smooth
ZMAX = 897.0                                                              # terrain ends at z = 900
k = int(np.argmax(L[:, 1] > ZMAX)) if (L[:, 1] > ZMAX).any() else len(L)
if k < len(L):
    a, b = L[k - 1], L[k]; L = np.vstack([L[:k], a + (b - a) * (ZMAX - a[1]) / (b[1] - a[1])])
def offset(P, o):
    out = []
    for i in range(len(P)):
        a, b = P[max(0, i - 1)], P[min(len(P) - 1, i + 1)]; t = (b - a) / np.linalg.norm(b - a)
        out.append([round(float(P[i][0] - t[1] * o), 1), round(float(P[i][1] + t[0] * o), 1)])
    return out
left, right = offset(L, -6.0), offset(L, 6.0)
left[0], right[0] = [166.2, 570.9], [156.1, 580.7]                          # weld onto the GLB rows
new_roads = [
    f"  {{ id: 'd260_cw_east', kind: 'asphalt', w: 8.0, kerb: false, pts: {json.dumps(left).replace(' ', '')} }},",
    f"  {{ id: 'd260_cw_west', kind: 'asphalt', w: 8.0, kerb: false, pts: {json.dumps(right).replace(' ', '')} }},",
]
for r in fix['add_roads']:
    new_roads.append(f"  {{ id: '{r['id']}', kind: '{r['kind']}', w: {r['w']}, kerb: false, pts: {json.dumps(r['pts']).replace(' ', '')} }},")
print('D.260 continuation', len(L), 'points, ends at', np.round(L[-1], 1))

# ------------------------------------------------------------------ 6. the cemetery
cem = fix['cemetery']
def poly_model(pts): return [[round(c, 1) for c in screen2model(u, v)] for u, v in pts]
sites['cemeteries'] = [
    {'poly': poly_model(cem['outer']), 'graves': 90, 'trees': 260, 'wallEdges': cem['outer_walls'], 'label': 'big cemetery'},
    {'poly': poly_model(cem['strip']), 'graves': 7, 'trees': 400, 'wallEdges': [1], 'label': 'grave strip'},
] + [c for c in sites['cemeteries'] if not (300 < c['x'] < 420 and 500 < c['z'] < 640) and not (190 < c['x'] < 260 and 440 < c['z'] < 520)]

# ------------------------------------------------------------------ write
roads_out = [R[k] for k in R] + new_roads
roads_out[-1] = roads_out[-1]  # keep trailing commas as in the generated file
out = src
out = re.sub(r"export const ROADS = \[\n.*?\n\];", lambda m: "export const ROADS = [\n" + '\n'.join(roads_out) + "\n];", out, flags=re.S)
out = re.sub(r"export const BUILDINGS = \[\n.*?\n\];", lambda m: "export const BUILDINGS = [\n" + '\n'.join(keep) + "\n];", out, flags=re.S)
out = re.sub(r"export const SITES = \{.*\};", lambda m: "export const SITES = " + json.dumps(sites) + ";", out)
out = out.replace('// footprints (Google satellite, 0.3 m/px), in model metres.',
                  '// footprints (Google satellite, 0.3 m/px), in model metres. Post-processed by tools/gmap_fix.py (gmap_fix v0.9.4).', 1)
open(SRC, 'w').write(out)
print('roads', len(roads_txt), '->', len(roads_out))
