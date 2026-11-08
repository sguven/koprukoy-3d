"""Build src/village_data.js from the Google Maps / satellite traces (v0.9).

Inputs (work dir, produced by the tracing scripts described in docs/REALISM.md):
  roads_clean.json      road centrelines traced from the Google Maps road layer (model metres, pin frame)
  buildings_traced.json roof rectangles detected in the 0.3 m/px satellite mosaic (pin frame)
  georef.json           pin georeference (Çeşnigir bridge pin == model bridge)

Pin frame -> model frame: the v0.6 GLB has the Çeşnigir bridge at its true position but the D.260 viaduct
~70 m north-east of its true alignment, so everything is warped with a smooth shift that is zero near the
bridge and reaches the full D.260 offset 500 m away (see WARP below).
"""
import json, math, sys, numpy as np
WORK = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/work'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'src/village_data.js'
roads = json.load(open(f'{WORK}/roads_clean.json'))
blds = json.load(open(f'{WORK}/buildings_traced.json'))
D = json.loads(open('data4.js').read()[len('export default '):].rstrip().rstrip(';'))

# ------------------------------------------------------------------ warp pin frame -> model frame
BRIDGE = (-376.89, -277.44)
SHIFT = (43.9, -54.6)                       # full D.260 correction (metres, +x east, +z south)
def warp(x, z):
    d = math.hypot(x - BRIDGE[0], z - BRIDGE[1]); w = max(0.0, min(1.0, (d - 150) / 350))
    return (round(x + SHIFT[0] * w, 1), round(z + SHIFT[1] * w, 1))

# ------------------------------------------------------------------ roads
p0 = np.array([-960, -330.]); p1 = np.array([160, 570.]); dv = (p1 - p0) / np.linalg.norm(p1 - p0); nv = np.array([-dv[1], dv[0]])
def near_d260(pts):
    P = np.array(pts); return np.abs((P - p0) @ nv).max() < 130
def along_d260(pts):
    # all points within 95 m of the D.260 line and the chord roughly parallel to it (the carriageways and ramps)
    P = np.array(pts)
    if np.abs((P - p0) @ nv).max() > 95: return False
    ch = P[-1] - P[0]; L = np.hypot(*ch)
    return L < 1 or abs(ch @ dv) / L > 0.85
M = np.array(D['roads']).reshape(-1, 4)
d260pts = M[(np.abs((M[:, :2] - p0) @ nv) < 60) & (M[:, 3] > 3.3)][:, :2]      # GLB D.260 samples (model frame)
bld_xy = np.array([[b['x'], b['z']] for b in blds])
def near_building(x, z, r=60): return (np.hypot(bld_xy[:, 0] - x, bld_xy[:, 1] - z) < r).any()
out_roads = []
for i, s in enumerate(roads):
    is_d260 = bool(s.get('d260')) or (s['cls'] == 'd260' and near_d260(s['pts'])) or (s['w'] > 6.5 and along_d260(s['pts']))
    pts = [list(warp(x, z)) for x, z in s['pts']]
    pts = [p for p in pts if -1050 < p[0] < 880 and -1050 < p[1] < 880]            # stay on the terrain
    if is_d260:
        # the D.260 carriageways stay as the GLB viaduct where it exists; beyond its south-east end the traced
        # road continues as a plain wide asphalt ribbon
        pts = [p for p in pts if np.hypot(d260pts[:, 0] - p[0], d260pts[:, 1] - p[1]).min() > 120]
    if len(pts) < 2: continue
    if is_d260: kind, w, kerb, cls = 'asphalt', 9.0, False, 'd260ext'
    elif s['w'] > 12.5: kind, w, kerb, cls = 'asphalt', 6.5, True, 'main'
    elif s['w'] > 7.2: kind, w, kerb, cls = 'asphalt', 5.0, True, 'secondary'
    else:
        built = sum(near_building(x, z) for x, z in pts[::max(1, len(pts) // 4)]) > 0
        kind, w, kerb, cls = ('concrete', 4.0, False, 'local') if built else ('dirt', 3.6, False, 'track')
    # snap free ends near the GLB D.260 onto it so the junctions meet the viaduct
    for end in (0, -1):
        x, z = pts[end]; dd = np.hypot(d260pts[:, 0] - x, d260pts[:, 1] - z); k = int(dd.argmin())
        if dd[k] < (170 if is_d260 else 32):
            tgt = [round(float(d260pts[k, 0]), 1), round(float(d260pts[k, 1]), 1)]
            if end == 0: pts.insert(0, tgt)
            else: pts.append(tgt)
    L = sum(math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) for k in range(1, len(pts)))
    if L < 8: continue
    bb = np.array(pts); diag = math.hypot(*(bb.max(0) - bb.min(0)))
    if not is_d260 and (s.get('a') == s.get('b') or (diag < 18 and L > 2.2 * diag)): continue   # tiny loops / curls at junctions
    out_roads.append({'id': f'{cls}_{i}', 'kind': kind, 'w': w, 'kerb': kerb, 'cls': cls, 'pts': pts})

# ------------------------------------------------------------------ special sites (photo 01 frame, anchored on the market junction)
J_PIN = (214.2, 186.9)                      # Güvendioğlu Market junction, pin frame (hi-res satellite tile)
J = warp(*J_PIN)
MOSQUE_PIN = (269.0, 234.5)                 # dome of the turquoise mosque (satellite)
MOSQUE = warp(*MOSQUE_PIN)
def road_dist(x, z):
    best = 1e9
    for r in out_roads:
        P = np.array(r['pts'])
        for k in range(len(P) - 1):
            a, b = P[k], P[k + 1]; ab = b - a; t = max(0, min(1, float(np.dot([x, z] - a, ab) / (ab @ ab or 1e-9))))
            best = min(best, float(np.hypot(*([x, z] - (a + ab * t)))), )
        if best < 0: break
    return best

# ------------------------------------------------------------------ buildings
roof_map = {'tile': 'h', 'brown': 'h', 'blue': 'm', 'white': 'f', 'grey': 'f'}
out_b = []
excl = [(J[0] - 24.4, J[1] - 7.4, 24), (J[0] - 10, J[1] - 3, 22)]   # municipality+square, square
MOSQUE_RECT = (MOSQUE[0] - 33, MOSQUE[0] + 19, MOSQUE[1] - 33, MOSQUE[1] + 25)   # walled compound (satellite)
for b in blds:
    x, z = warp(b['x'], b['z'])
    if not (-1040 < x < 870 and -1040 < z < 870): continue
    if any(math.hypot(x - ex, z - ez) < r for ex, ez, r in excl): continue
    if MOSQUE_RECT[0] < x < MOSQUE_RECT[1] and MOSQUE_RECT[2] < z < MOSQUE_RECT[3]: continue
    if any(r[0] < b['x'] < r[1] and r[2] < b['z'] < r[3] for r in [(150, 210, 493, 568), (290, 365, 568, 685), (532, 560, 735, 780)]): continue   # cemeteries, pitch (pin frame)
    if b['roof'] in ('grey', 'white') and b['area'] < 45: continue                 # pins, cars, yard slabs
    if b['roof'] in ('grey', 'white') and road_dist(x, z) < 4.5: continue           # grey patches on roads
    w, d = max(3.5, b['w']), max(3.0, b['d'])
    if w * d > 900: continue                                                        # fused blocks / parking lots
    storeys = 2 if (b['roof'] in ('tile', 'brown') and b['area'] > 125 and w / d < 2.2) else 1
    out_b.append({'x': x, 'z': z, 'yaw': b['yaw'], 'w': round(w, 1), 'd': round(d, 1), 'storeys': storeys, 'roof': roof_map[b['roof']], 'src': b['roof']})

# Street View overrides (tools/sv_overrides.json): [{"xz":[x,z] (pin frame), "storeys":2, "wall":"Duvar_Pembe", "roof":"h", "fence":"stone", "note":"..."}]
import os
if os.path.exists('tools/sv_overrides.json'):
    for o in json.load(open('tools/sv_overrides.json')):
        ox, oz = warp(*o['xz'])
        if 'add' in o:   # a building the roof detector missed (unfinished, roofless, under trees)
            a = o['add']; out_b.append({'x': ox, 'z': oz, 'yaw': a.get('yaw', 0), 'w': a['w'], 'd': a['d'], 'storeys': o.get('storeys', 1), 'roof': o.get('roof', 'h'), 'src': 'sv'})
            k = len(out_b) - 1
        else:
            k = min(range(len(out_b)), key=lambda i: math.hypot(out_b[i]['x'] - ox, out_b[i]['z'] - oz))
            if math.hypot(out_b[k]['x'] - ox, out_b[k]['z'] - oz) > o.get('tol', 22): continue
        for key in ('storeys', 'wall', 'roof', 'fence', 'kind'):
            if key in o: out_b[k][key] = o[key]
# school: the building nearest the Keskin Köprü İlkokulu pin (2 storeys, red-brown render, Street View 08)
SCHOOL = warp(493, 632)
k = min(range(len(out_b)), key=lambda i: math.hypot(out_b[i]['x'] - SCHOOL[0], out_b[i]['z'] - SCHOOL[1]))
out_b[k]['kind'] = 'school'; out_b[k]['storeys'] = 2; out_b[k]['roof'] = 'h'
# sites traced in the satellite: two cemeteries (walled, headstones), the football pitch
def rect(x0, x1, z0, z1):
    a = warp(x0, z0); b = warp(x1, z1); return {'x': round((a[0] + b[0]) / 2, 1), 'z': round((a[1] + b[1]) / 2, 1), 'w': round(b[0] - a[0], 1), 'd': round(b[1] - a[1], 1)}
TREE_ROWS = [{'pts': [list(warp(257, 196)), list(warp(320, 198))], 'species': 'pine', 'step': 6.5, 'offset': 5.0}]   # cedar avenue E of the market (Street View 17)
GARDENS = [dict(zip(('x', 'z'), warp(196, 216)), w=16, d=22), dict(zip(('x', 'z'), warp(212, 102)), w=18, d=16)]   # tea garden S-W of the market, fenced green plot N (Street View 26/28)
MINARETS = [dict(zip(('x', 'z'), warp(158, -26)))]   # Köprü Köyü Yeni Cami, single minaret at the SE corner (Street View 20/21)
SITES = {'treeRows': TREE_ROWS, 'gardens': GARDENS, 'minarets': MINARETS, 'cemeteries': [rect(150, 210, 493, 568), rect(290, 365, 568, 685)], 'pitch': rect(532, 560, 735, 780), 'school': {'x': out_b[k]['x'], 'z': out_b[k]['z']}}
with open(OUT, 'w') as f:
    f.write('// Generated by tools/build_village_data.py — Köprüköy roads (Google Maps road layer) and building\n')
    f.write('// footprints (Google satellite, 0.3 m/px), in model metres. Do not edit by hand; see docs/REALISM.md.\n')
    f.write(f'export const ANCHOR = {{ jx: {J[0]}, jz: {J[1]} }};   // Güvendioğlu Market junction (photo-01 anchor)\n')
    f.write(f'export const MOSQUE_SITE = {{ x: {MOSQUE[0]}, z: {MOSQUE[1]} }};\n')
    f.write('export const SITES = ' + json.dumps(SITES) + ';\n')
    f.write('export const ROADS = [\n')
    for r in out_roads:
        pts = ','.join(f'[{x},{z}]' for x, z in r['pts'])
        f.write(f"  {{ id: '{r['id']}', kind: '{r['kind']}', w: {r['w']}, kerb: {'true' if r['kerb'] else 'false'}, pts: [{pts}] }},\n")
    f.write('];\n')
    f.write('export const BUILDINGS = [\n')
    for b in out_b:
        extra = {k: b[k] for k in ('kind', 'wall', 'fence') if b.get(k)}
        f.write(f"  [{b['x']},{b['z']},{b['yaw']},{b['w']},{b['d']},{b['storeys']},'{b['roof']}'" + (',' + json.dumps(extra) if extra else '') + "],\n")
    f.write('];\n')
import collections
print('roads', len(out_roads), collections.Counter(r['cls'] for r in out_roads), 'buildings', len(out_b), collections.Counter(b['src'] for b in out_b), 'J', J, 'mosque', MOSQUE)
