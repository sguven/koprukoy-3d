"""v0.9.5 — make the village read like the real Köprüköy (owner's request, Nov 2026).

The owner's complaints, checked against the 86 Street View panoramas in docs/reference/streetview/ and the
Google Maps building layer (docs/survey/gmap_layer_classes.png):
  * too many big houses — 2–3 storeys with many windows "are rare in the village". The roof detector fused
    neighbouring roofs / yards into 25–50 m rectangles, and the v0.9 rule made a third of all houses two storeys;
  * tangled roads — zigzag centrelines from the 0.6 m/px trace;
  * buildings that do not match reality — 143 footprints ran into the road ribbons.

What it does (run once on the v0.9.4 data; it refuses to run twice):
  1. big footprints: where the Google building layer shows two or more buildings inside one model rectangle the
     rectangle is replaced by those footprints; where Google shows one much smaller building the rectangle shrinks
     to it; remaining rectangles longer than 24 m are split into a house and a lower barn / annex with a gap;
  2. storeys: houses without a Street View override are single storey unless compact (85–210 m², aspect < 1.8,
     tile roof) and chosen by a stable hash (about half of those) — roughly one house in six is two storeys, as in
     the panoramas; long single-storey halls get a sheet roof sometimes (barns, workshops);
  3. footprints are moved off the road ribbons (shifted away from the road; shrunk when the shift would be > 3.5 m);
  4. roads: Douglas–Peucker simplification (1.0 m) and spike removal (turns > 60° between segments < 7 m),
     dead-end stubs shorter than 12 m removed.
Street View overrides (buildings with wall / fence / kind data) are left exactly as they were.
Usage: python3 tools/v095_fix.py   (from the repo root)
"""
import json, math, re, sys
import numpy as np
import cv2
from PIL import Image

SRC = 'src/village_data.js'
src = open(SRC).read()
if 'v0.9.5' in src:
    sys.exit('already applied')

# ------------------------------------------------------------------ georeference (same as gmap_fix.py)
LAT0, LON0, BX, BZ, MLAT, MLON = 39.5809021, 33.4292022, -376.89, -277.44, 110574, 85797.1812415668
BRIDGE, SHIFT = (-376.89, -277.44), (43.9, -54.6)
def warp(x, z):
    d = math.hypot(x - BRIDGE[0], z - BRIDGE[1]); w = max(0.0, min(1.0, (d - 150) / 350))
    return x + SHIFT[0] * w, z + SHIFT[1] * w
TX0, TY0, NW = 155414 * 256, 99633 * 256, 256 * 2 ** 18
def px2model(u, v):
    X = u * 2 + TX0; Y = v * 2 + TY0
    lon = X / NW * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * Y / NW))))
    return warp((lon - LON0) * MLON + BX, (LAT0 - lat) * MLAT + BZ)
G = np.array(Image.open('docs/survey/gmap_layer_classes.png').convert('RGB'))
BLD = ((G[..., 1] > 128) & (G[..., 0] < 128)).astype(np.uint8)
x0, z0 = px2model(0, 0); x1, z1 = px2model(1, 0); MPP = math.hypot(x1 - x0, z1 - z0)
n, lab, stats, _ = cv2.connectedComponentsWithStats(BLD, 8)
GF = []   # Google footprints as rectangles in the model frame
for i in range(1, n):
    if stats[i, cv2.CC_STAT_AREA] < 12: continue
    ys, xs = np.where(lab == i)
    (cx, cy), (rw, rh), ang = cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))
    mx, mz = px2model(cx, cy)
    GF.append(dict(x=mx, z=mz, w=(rw + 1) * MPP, d=(rh + 1) * MPP, yaw=-math.radians(ang), area=stats[i, cv2.CC_STAT_AREA] * MPP * MPP))
GC = np.array([[g['x'], g['z']] for g in GF])

# ------------------------------------------------------------------ parse
head, rest = src.split('export const ROADS = [\n', 1)
roads_txt, rest = rest.split('\n];\n', 1)
bld_txt = re.search(r"export const BUILDINGS = \[\n(.*?)\n\];", rest, re.S).group(1)
roads = []
for l in roads_txt.split('\n'):
    m = re.match(r"\s*\{ id: '([^']+)', kind: '(\w+)', w: ([\d.]+), kerb: (\w+), pts: (\[.*\]) \},?", l)
    roads.append(dict(id=m.group(1), kind=m.group(2), w=float(m.group(3)), kerb=m.group(4) == 'true', pts=json.loads(m.group(5))))
B = []
for l in bld_txt.split('\n'):
    v = json.loads(l.strip().rstrip(',').replace("'", '"'))
    B.append(dict(x=v[0], z=v[1], yaw=v[2], w=v[3], d=v[4], storeys=v[5], roof=v[6], extra=(v[7] if len(v) > 7 else {})))
print('in: roads', len(roads), 'buildings', len(B))

# ------------------------------------------------------------------ helpers
def h01(x, z):
    """stable pseudo-random in [0,1) from a position"""
    return (math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1.0
def local2world(b, lx, lz):
    c, s = math.cos(b['yaw']), math.sin(b['yaw'])
    return b['x'] + lx * c + lz * s, b['z'] - lx * s + lz * c
def world2local(b, x, z):
    c, s = math.cos(b['yaw']), math.sin(b['yaw']); dx, dz = x - b['x'], z - b['z']
    return dx * c - dz * s, dx * s + dz * c
def corners(b):
    return [local2world(b, sx * b['w'] / 2, sz * b['d'] / 2) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
def seg_d(p, a, b):
    ab = b - a; t = max(0.0, min(1.0, float(np.dot(p - a, ab) / (ab @ ab or 1e-9)))); q = a + ab * t
    return float(np.hypot(*(p - q))), q
protected = lambda b: bool(b['extra'])

# ------------------------------------------------------------------ 4. roads: simplify, despike, drop stubs
def rdp(P, eps):
    if len(P) < 3: return P
    a, b = np.array(P[0]), np.array(P[-1]); dmax, idx = 0, 0
    for i in range(1, len(P) - 1):
        d, _ = seg_d(np.array(P[i]), a, b)
        if d > dmax: dmax, idx = d, i
    if dmax > eps: return rdp(P[:idx + 1], eps)[:-1] + rdp(P[idx:], eps)
    return [P[0], P[-1]]
def despike(P):
    changed = True
    while changed and len(P) > 2:
        changed = False
        for i in range(1, len(P) - 1):
            v1 = np.subtract(P[i], P[i - 1]); v2 = np.subtract(P[i + 1], P[i]); l1, l2 = np.linalg.norm(v1), np.linalg.norm(v2)
            if l1 < 1e-6 or l2 < 1e-6: P.pop(i); changed = True; break
            ang = math.degrees(math.acos(max(-1, min(1, float(np.dot(v1, v2)) / (l1 * l2)))))
            if ang > 60 and min(l1, l2) < 7: P.pop(i); changed = True; break
    return P
for r in roads:
    if r['id'].startswith('d260'): continue   # the v0.9.4 D.260 band is already smooth
    P = [list(p) for p in r['pts']]
    P = despike(rdp(P, 1.0))
    r['pts'] = [[round(p[0], 1), round(p[1], 1)] for p in P]
def plen(P): return sum(math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) for i in range(1, len(P)))
def free_end(ri, p):
    p = np.array(p)
    for j, o in enumerate(roads):
        if j == ri: continue
        Q = np.array(o['pts'])
        if np.min(np.hypot(Q[:, 0] - p[0], Q[:, 1] - p[1])) > 40: continue
        for k in range(len(Q) - 1):
            if seg_d(p, Q[k], Q[k + 1])[0] < 2.0: return False
    return True
drop = [i for i, r in enumerate(roads) if plen(r['pts']) < 12 and (free_end(i, r['pts'][0]) or free_end(i, r['pts'][-1]))]
# 5. surfaces: in the panoramas only the main road and the streets around the çarşı are asphalt / paved; the lanes of
#    the mahalles are earth or gravel with grass verges (Street View 07, 08, 29, 44, 54, 58, 62, 66, 70, 96), the lanes
#    around Yeni Cami are brick-paved (94, 98). Secondary roads far from the centre are wide earth roads (62, 70).
CARSI, YENI_CAMI = (258.1, 132.3), (201.9, -80.6)
def near(P, c, r):
    return any(math.hypot(x - c[0], z - c[1]) < r for x, z in P)
n_dirt = 0
for r in roads:
    if r['id'].startswith(('d260', 'main', 'track')): continue
    if r['kind'] == 'concrete' and not (near(r['pts'], CARSI, 150) or near(r['pts'], YENI_CAMI, 110)):
        r['kind'] = 'dirt'; r['kerb'] = False; n_dirt += 1
    elif r['kind'] == 'asphalt' and r['id'].startswith('secondary') and not near(r['pts'], CARSI, 230):
        r['kind'] = 'dirt'; r['kerb'] = False; n_dirt += 1
print('roads: lanes reclassified as earth / gravel', n_dirt)
print('roads: stubs removed', [roads[i]['id'] for i in drop])
roads = [r for i, r in enumerate(roads) if i not in drop]
RP = [np.array(r['pts']) for r in roads]

# ------------------------------------------------------------------ 1. footprints: Google layer, splitting
def google_inside(b, margin=1.0):
    out = []
    for g, c in zip(GF, GC):
        if abs(c[0] - b['x']) > 45 or abs(c[1] - b['z']) > 45: continue
        lx, lz = world2local(b, c[0], c[1])
        if abs(lx) < b['w'] / 2 + margin and abs(lz) < b['d'] / 2 + margin: out.append(g)
    return out
def mk(x, z, yaw, w, d, roof, barn=False, extra=None):
    e = dict(extra or {})
    if barn: e['barn'] = True
    return dict(x=round(x, 1), z=round(z, 1), yaw=round(yaw, 3), w=round(max(4.0, w), 1), d=round(max(3.5, d), 1), storeys=1, roof=roof, extra=e)
out = []
n_replaced = n_shrunk = n_split = 0
for b in B:
    if protected(b) or b['storeys'] > 2: out.append(b); continue
    area, long_, short = b['w'] * b['d'], max(b['w'], b['d']), min(b['w'], b['d'])
    gs = google_inside(b)
    if len(gs) >= 2 and sum(g['area'] for g in gs) > 0.3 * area and all(g['area'] > 30 for g in gs):
        # the Google layer separates what the roof detector fused: use its footprints
        for g in gs:
            yaw = g['yaw']
            d = (yaw - b['yaw']) % (math.pi / 2); d = min(d, math.pi / 2 - d)
            if d < math.radians(15): yaw = b['yaw']   # the detector's axis is better than a 1 m/px rectangle's
            w, dd = min(g['w'], 22.0), min(g['d'], 22.0)
            out.append(mk(g['x'], g['z'], yaw, w, dd, b['roof']))
        n_replaced += 1; continue
    if len(gs) == 1 and gs[0]['area'] > 50 and area > 1.6 * gs[0]['w'] * gs[0]['d']:
        g = gs[0]; yaw = g['yaw']
        d = (yaw - b['yaw']) % (math.pi / 2); d = min(d, math.pi / 2 - d)
        if d < math.radians(20): yaw = b['yaw']
        out.append(mk(g['x'], g['z'], yaw, min(g['w'], 22.0), min(g['d'], 22.0), b['roof'])); n_shrunk += 1; continue
    if long_ > 24:
        # a house at one end, a lower barn / annex at the other, a gap between (Street View 07/52/64: barns and sheds next to houses)
        along_x = b['w'] >= b['d']
        Lh = max(10.0, min(14.0, long_ * 0.45)); gap = 1.5 + 1.5 * h01(b['x'] + 3, b['z']); La = long_ - Lh - gap
        side = 1 if h01(b['x'], b['z'] + 7) < 0.5 else -1
        hc = side * (long_ / 2 - Lh / 2); ac = -side * (long_ / 2 - La / 2)
        hs = min(short, 13.0); as_ = max(5.0, min(short * 0.8, 9.0))
        if along_x:
            x, z = local2world(b, hc, 0); out.append(mk(x, z, b['yaw'], Lh, hs, b['roof']))
            x, z = local2world(b, ac, (short - as_) / 2 * (1 if h01(b['z'], b['x']) < 0.5 else -1)); out.append(mk(x, z, b['yaw'], La, as_, 'm' if h01(b['x'] + 1, b['z'] + 1) < 0.5 else b['roof'], barn=True))
        else:
            x, z = local2world(b, 0, hc); out.append(mk(x, z, b['yaw'], hs, Lh, b['roof']))
            x, z = local2world(b, (short - as_) / 2 * (1 if h01(b['z'], b['x']) < 0.5 else -1), ac); out.append(mk(x, z, b['yaw'], as_, La, 'm' if h01(b['x'] + 1, b['z'] + 1) < 0.5 else b['roof'], barn=True))
        n_split += 1; continue
    out.append(b)
print('footprints: replaced by Google layer', n_replaced, 'shrunk', n_shrunk, 'split', n_split)
B = out

# ------------------------------------------------------------------ 2. storeys, sheet roofs on long halls
n2 = 0
for b in B:
    if protected(b) and 'barn' not in b['extra']: continue
    area, long_, short = b['w'] * b['d'], max(b['w'], b['d']), min(b['w'], b['d'])
    if b['extra'].get('barn'): b['storeys'] = 1; continue
    if area > 210 or long_ > 19: b['storeys'] = 1
    elif b['roof'] == 'h' and 85 < area < 210 and long_ / short < 1.8 and h01(b['x'], b['z']) < 0.5: b['storeys'] = 2
    else: b['storeys'] = 1
    if b['storeys'] == 1 and area > 260 and long_ / short > 2.0 and b['roof'] == 'h' and h01(b['z'], b['x']) < 0.5: b['roof'] = 'm'
    if b['storeys'] == 1 and area > 300 and b['roof'] in ('h', 'm'): b['extra']['barn'] = True   # long halls read as sheds / workshops
    n2 += b['storeys'] == 2
print('storeys: two-storey', n2, 'of', len(B))

# ------------------------------------------------------------------ 2b. Street View coverage
# Every notable two-storey house seen in the 86 panoramas already has an override in tools/sv_overrides.json;
# an unconfirmed two-storey house within sight of a panorama point is therefore a detector guess that the
# panorama does not support (checked on the renders of SV02, 16, 17, 34: all single storey in reality).
SV_PIN = [(214, 187), (214, 200), (195, 182), (243, 236), (205, 60), (150, -10), (360, 90), (468, 628), (368, 540), (560, 860), (202, -103), (212, 120), (227, 249),
          (257, 200), (320, 198), (150, -40), (220, -63), (210, -9), (222, -78), (205, 24), (202, 66), (214, 99), (207, 132), (219, 217), (55, 335), (49, 310), (98, 275), (63, 241),
          (4.8, 217), (139, 221), (52, 204), (139, 55), (70, 67), (107, 118), (189, 155), (109, -14), (263, -8), (434, 54), (303, 142), (469, 136), (539, 106), (389, 148), (529, 162),
          (429, 213), (325, 236), (502, 245), (257, 281), (397, 299), (533, 324), (404, 400), (351, 469), (517, 625), (600, 512), (537, 622), (471, 469), (561, 389), (344, 348),
          (449, 323), (165, -84), (233, -201), (301, -151)]
SV_PTS = [warp(x, z) for x, z in SV_PIN]
n_sv1 = 0
for b in B:
    if protected(b) or b['storeys'] != 2: continue
    if any(math.hypot(b['x'] - x, b['z'] - z) < 55 for x, z in SV_PTS): b['storeys'] = 1; n_sv1 += 1
print('storeys: unconfirmed two-storey houses within 55 m of a panorama -> single storey', n_sv1, '; two-storey now', sum(b['storeys'] == 2 for b in B))

# ------------------------------------------------------------------ 3. off the road ribbons
def intrusion(b):
    cs = corners(b); pts = []
    for i in range(4):
        a, c = np.array(cs[i]), np.array(cs[(i + 1) % 4])
        for t in np.linspace(0, 1, 7): pts.append(a + (c - a) * t)
    pts.append(np.array([b['x'], b['z']]))
    worst, nrm = 0.0, None
    for r, Q in zip(roads, RP):
        if np.min(np.hypot(Q[:, 0] - b['x'], Q[:, 1] - b['z'])) > 60: continue
        for p in pts:
            for k in range(len(Q) - 1):
                d, q = seg_d(p, Q[k], Q[k + 1]); dep = r['w'] / 2 + 0.3 - d
                if dep > worst:
                    t = Q[k + 1] - Q[k]; t = t / (np.linalg.norm(t) or 1); nn = np.array([-t[1], t[0]])
                    if np.dot(np.array([b['x'], b['z']]) - q, nn) < 0: nn = -nn
                    worst, nrm = dep, nn
    return worst, nrm
n_moved = n_shrunk2 = 0
for b in B:
    if protected(b) and 'barn' not in b['extra']: continue
    moved = 0.0
    for it in range(8):
        dep, nn = intrusion(b)
        if dep <= 0.2: break
        step = min(1.2, dep + 0.2)
        if moved + step <= 3.5:
            b['x'] = round(b['x'] + nn[0] * step, 1); b['z'] = round(b['z'] + nn[1] * step, 1); moved += step
        else:
            # shrink the side that faces the road
            lx, lz = world2local(dict(b, x=0, z=0), nn[0], nn[1])
            key = 'w' if abs(lx) > abs(lz) else 'd'
            if b[key] <= 5.0: break
            b[key] = round(max(5.0, b[key] - 2 * step), 1)
            b['x'] = round(b['x'] + nn[0] * step, 1); b['z'] = round(b['z'] + nn[1] * step, 1)
            n_shrunk2 += 1
    if moved > 0: n_moved += 1
print('road clearance: moved', n_moved, 'shrunk', n_shrunk2)
left = sum(1 for b in B if intrusion(b)[0] > 0.5)
print('still intruding > 0.5 m:', left)

# ------------------------------------------------------------------ write
head = head.replace('Post-processed by tools/gmap_fix.py (gmap_fix v0.9.4).', 'Post-processed by tools/gmap_fix.py (gmap_fix v0.9.4) and tools/v095_fix.py (v0.9.5: footprints, storeys, roads).')
if 'v0.9.5' not in head: head = head.replace('// footprints', '// v0.9.5 realism fix applied (tools/v095_fix.py).\n// footprints', 1)
with open(SRC, 'w') as f:
    f.write(head)
    f.write('export const ROADS = [\n')
    for r in roads:
        pts = ','.join(f'[{x},{z}]' for x, z in r['pts'])
        f.write(f"  {{ id: '{r['id']}', kind: '{r['kind']}', w: {r['w']}, kerb: {'true' if r['kerb'] else 'false'}, pts: [{pts}] }},\n")
    f.write('];\n')
    f.write('export const BUILDINGS = [\n')
    for b in B:
        f.write(f"  [{b['x']},{b['z']},{b['yaw']},{b['w']},{b['d']},{b['storeys']},'{b['roof']}'" + (',' + json.dumps(b['extra']) if b['extra'] else '') + "],\n")
    f.write('];\n')
print('out: roads', len(roads), 'buildings', len(B))
