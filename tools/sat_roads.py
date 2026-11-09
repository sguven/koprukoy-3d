"""Snap the traced road centrelines to the lanes that are actually visible in the satellite image (v0.9.5).

The Google Maps road layer that the v0.9 network was traced from is generalised: in the mahalles it runs 10–20 m
off the real lane, cuts across yards and the corner of the football pitch, and shows a few lanes that do not exist
(owner's report, Nov 2026). The 0.3 m satellite mosaic (`docs/survey/satellite_mosaic_0.3m_small.jpg`, kept at
1.5 m/px) shows the real lanes as pale, low-saturation strips between the houses.

Road evidence: pale (grey - 0.7 * saturation) above the 9 m neighbourhood, not green, not inside a building
footprint (model buildings, Google footprints, the pitch), averaged along the road direction over ±12 m so that
roofs and bright yards (compact blobs) do not count while a lane (a long strip) does.

For every road: sample the centreline every 3 m, evaluate the evidence at offsets up to ±16.5 m to each side, and
pick the offset path with the strongest evidence and the fewest bends (dynamic programming). The snapped line is
only accepted when it is clearly better than the traced one; roads with no evidence at all are removed, weak end
stretches trimmed. Junctions are kept: shared endpoints move together, and an endpoint that sat on another road is
projected back onto that road's new line.

Georeference of the mosaic (pin frame, fitted on the main roads): x = -380 + (u - DU) * S, z = -700 + (v - DV) * S.
"""
import math
import numpy as np
import cv2
from PIL import Image

S, DU, DV, X0, Z0 = 1.5, -0.5, 5.5, -380.0, -700.0
BRIDGE, SHIFT = (-376.89, -277.44), (43.9, -54.6)
def warp(x, z):
    d = math.hypot(x - BRIDGE[0], z - BRIDGE[1]); w = max(0.0, min(1.0, (d - 150) / 350))
    return x + SHIFT[0] * w, z + SHIFT[1] * w
def unwarp(X, Z):
    x, z = X, Z
    for _ in range(30): a, b = warp(x, z); x += X - a; z += Z - b
    return x, z
def m2px(X, Z):
    x, z = unwarp(X, Z); return (x - X0) / S + DU, (z - Z0) / S + DV
def m2px_arr(P):
    """vectorised model -> mosaic pixel for an (n, 2) array (the warp is smooth, 30 fixed-point steps)"""
    P = np.asarray(P, float); x, z = P[:, 0].copy(), P[:, 1].copy()
    for _ in range(30):
        d = np.hypot(x - BRIDGE[0], z - BRIDGE[1]); w = np.clip((d - 150) / 350, 0, 1)
        ax, az = x + SHIFT[0] * w, z + SHIFT[1] * w; x += P[:, 0] - ax; z += P[:, 1] - az
    return np.stack([(x - X0) / S + DU, (z - Z0) / S + DV], 1)

def rect_poly_px(x, z, yaw, w, d, grow=0.0):
    c, s = math.cos(yaw), math.sin(yaw); out = []
    for lx, lz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        lx, lz = lx * (w / 2 + grow), lz * (d / 2 + grow); out.append(m2px(x + lx * c + lz * s, z - lx * s + lz * c))
    return np.array(out, np.int32)

def evidence_map(rects, path='docs/survey/satellite_mosaic_0.3m_small.jpg'):
    img = np.array(Image.open(path).convert('RGB')).astype(np.float32)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    gray = img.mean(2); sat = img.max(2) - img.min(2)
    pale = gray - 0.7 * sat
    ev = pale - cv2.GaussianBlur(pale, (0, 0), 6.0)                 # brighter than the ~9 m neighbourhood
    ev = np.clip(ev, 0, 40)
    green = (g - (r + b) / 2) > 6                                    # grass, trees, the pitch
    ev[green] = -10
    nodata = cv2.erode((gray > 12).astype(np.uint8), np.ones((5, 5), np.uint8)) == 0
    mask = np.zeros(gray.shape, np.uint8)
    for (x, z, yaw, w, d) in rects: cv2.fillPoly(mask, [rect_poly_px(x, z, yaw, w, d, 1.0)], 1)
    ev[mask > 0] = -25                                               # never through a building
    return ev, nodata

def bilinear_arr(a, uv):
    H, W = a.shape; u = np.clip(uv[:, 0], 0, W - 1.001); v = np.clip(uv[:, 1], 0, H - 1.001)
    i = u.astype(int); j = v.astype(int); fu = u - i; fv = v - j
    return a[j, i] * (1 - fu) * (1 - fv) + a[j, i + 1] * fu * (1 - fv) + a[j + 1, i] * (1 - fu) * fv + a[j + 1, i + 1] * fu * fv

def resample(P, step):
    """points every `step` metres along the polyline (first and last vertex kept)"""
    P = np.asarray(P, float); L = np.r_[0, np.cumsum(np.hypot(*(P[1:] - P[:-1]).T))]
    if L[-1] < step: return P[[0, -1]]
    d = np.arange(0, L[-1], step)
    if L[-1] - d[-1] < step * 0.4: d = d[:-1]
    d = np.r_[d, L[-1]]
    return np.stack([np.interp(d, L, P[:, 0]), np.interp(d, L, P[:, 1])], 1)

def seg_proj(p, Q):
    best = (1e9, None)
    for k in range(len(Q) - 1):
        a, b = Q[k], Q[k + 1]; ab = b - a; t = max(0.0, min(1.0, float(np.dot(p - a, ab) / (ab @ ab or 1e-9)))); q = a + ab * t
        d = float(np.hypot(*(p - q)))
        if d < best[0]: best = (d, q)
    return best

def snap_roads(roads, rects, nodes_tol=2.5, max_off=16.5, lam=5.0, mu=0.35, t_ok=5.0, gain=3.0, keep_frac=0.3, trim_len=30.0, verbose=print):
    """roads: dicts with 'id', 'kind', 'w', 'pts' (model metres); rects: (x, z, yaw, w, d) footprints to avoid.
    Modifies roads in place (pts, removals); returns a report dict."""
    ev, nodata = evidence_map(rects)
    K = int(round(max_off / S)); offs = np.arange(-K, K + 1) * S
    report = dict(snapped=0, kept=0, removed=[], trimmed=[], skipped=0, shifts=[])
    # ---- endpoint topology before moving anything
    ends = [(i, e, np.array(r['pts'][e], float)) for i, r in enumerate(roads) for e in (0, -1)]
    tjoin = {}
    for i, e, p in ends:
        for j, o in enumerate(roads):
            if j == i: continue
            Q = np.array(o['pts'], float)
            if np.min(np.hypot(Q[:, 0] - p[0], Q[:, 1] - p[1])) > 60: continue
            if np.linalg.norm(Q[0] - p) < nodes_tol or np.linalg.norm(Q[-1] - p) < nodes_tol: continue
            d, q = seg_proj(p, Q)
            if d < nodes_tol: tjoin[(i, e)] = j; break
    removed = set()
    for i, r in enumerate(roads):
        if r['id'].startswith('d260'): report['kept'] += 1; continue
        P = resample(r['pts'], 3.0); n = len(P)
        if n < 3: report['kept'] += 1; continue
        uv = m2px_arr(P)
        ui = np.clip(uv[:, 0].astype(int), 0, nodata.shape[1] - 1); vi = np.clip(uv[:, 1].astype(int), 0, nodata.shape[0] - 1)
        if nodata[vi, ui].any(): report['skipped'] += 1; continue          # outside the mosaic: leave as traced
        # tangents / normals
        T = np.gradient(P, axis=0); T /= (np.linalg.norm(T, axis=1, keepdims=True) + 1e-9); N = np.stack([-T[:, 1], T[:, 0]], 1)
        # raw evidence at every (sample, offset)
        C0 = np.zeros((n, len(offs)))
        for k, o in enumerate(offs): C0[:, k] = bilinear_arr(ev, m2px_arr(P + N * o))
        # average along the road over ±4 samples (±12 m): a lane is long, a roof is not
        C = np.zeros_like(C0); win = 4
        for a in range(n):
            lo, hi = max(0, a - win), min(n, a + win + 1); C[a] = C0[lo:hi].mean(0)
        prior = -mu * np.abs(offs)                                        # prefer to stay on the traced line
        # dynamic programming over offsets
        D = C[0] + prior; back = np.zeros((n, len(offs)), int); idx = np.arange(len(offs))
        for a in range(1, n):
            best = np.empty(len(offs)); arg = np.empty(len(offs), int)
            for k in range(len(offs)):
                cand = D - lam * np.abs(idx - k); arg[k] = int(np.argmax(cand)); best[k] = cand[arg[k]]
            D = best + C[a] + prior; back[a] = arg
        path = np.zeros(n, int); path[-1] = int(np.argmax(D))
        for a in range(n - 1, 0, -1): path[a - 1] = back[a, path[a]]
        sc = C[np.arange(n), path]; sc0 = C[:, K]
        if (sc > t_ok).mean() < keep_frac and (sc0 > t_ok).mean() < keep_frac and len(P) * 3 > 20 and not r['id'].startswith('main'):
            removed.add(r['id']); report['removed'].append(r['id']); continue
        # accept the snapped line only when it is clearly better than the traced one
        if sc.mean() < sc0.mean() + gain:
            path[:] = K; sc = sc0; report['kept'] += 1
        else: report['snapped'] += 1; report['shifts'].append(float(np.abs(offs[path]).mean()))
        # trim weak ends (a contiguous weak run of >= trim_len at either end)
        ok = sc > t_ok; a0, a1 = 0, n
        run = 0
        for a in range(n):
            if ok[a]: break
            run += 1
        if run * 3.0 >= trim_len: a0 = run
        run = 0
        for a in range(n - 1, -1, -1):
            if ok[a]: break
            run += 1
        if run * 3.0 >= trim_len: a1 = n - run
        if a1 - a0 < 4: removed.add(r['id']); report['removed'].append(r['id']); continue
        if a0 > 0 or a1 < n: report['trimmed'].append(r['id'])
        Q = P[a0:a1] + N[a0:a1] * offs[path[a0:a1]][:, None]
        for _ in range(2):
            if len(Q) > 2: Q[1:-1] = (Q[:-2] + 2 * Q[1:-1] + Q[2:]) / 4
        if a0 == 0: Q[0] = P[0] + N[0] * offs[path[0]]
        roads[i]['pts'] = [[round(float(x), 1), round(float(z), 1)] for x, z in Q]
    # ---- junctions: shared endpoints move together (clustered on their original positions)
    alive = {i for i, r in enumerate(roads) if r['id'] not in removed}
    orig = {(i, e): p for i, e, p in ends if i in alive}
    keys = list(orig); used = set()
    for a, ka in enumerate(keys):
        if ka in used: continue
        grp = [ka] + [kb for kb in keys[a + 1:] if kb not in used and np.linalg.norm(orig[ka] - orig[kb]) < nodes_tol]
        if len(grp) > 1:
            m = np.mean([np.array(roads[k[0]]['pts'][k[1]], float) for k in grp], 0)
            for k in grp: roads[k[0]]['pts'][k[1]] = [round(float(m[0]), 1), round(float(m[1]), 1)]; used.add(k)
    # ---- T-junctions: project onto the other road's new line
    for (i, e), j in tjoin.items():
        if i not in alive or j not in alive: continue
        p = np.array(roads[i]['pts'][e], float); d, q = seg_proj(p, np.array(roads[j]['pts'], float))
        if d < 25: roads[i]['pts'][e] = [round(float(q[0]), 1), round(float(q[1]), 1)]
    roads[:] = [r for r in roads if r['id'] not in removed]
    verbose('satellite snap: snapped', report['snapped'], 'kept as traced', report['kept'], 'outside mosaic', report['skipped'],
            'removed (no visible lane)', len(report['removed']), 'trimmed', len(report['trimmed']),
            'mean shift of snapped roads %.1f m' % (np.mean(report['shifts']) if report['shifts'] else 0))
    return report
