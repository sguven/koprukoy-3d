"""Trace the Google Maps road layer mosaic (mosaic_map.png) into polylines in model metres.
Output: roads_traced.json  [{pts:[[x,z],...], w: width_m, len: m, cls: 'd260'|'main'|'local'}]
Coordinates are in the *pin* georeference (bridge pin == model bridge); the model shift is applied later.
"""
import json, numpy as np
from PIL import Image
from scipy import ndimage
from skimage.morphology import skeletonize, remove_small_objects
import networkx as nx

X0, Z0, S = -400, -700, 0.6
mos = np.array(Image.open('mosaic_map.png').convert('RGB')).astype(int)
r, g, b = mos[..., 0], mos[..., 1], mos[..., 2]
water = (b - r > 45) & (b > 170)
water = ndimage.binary_closing(water, iterations=3)
np.save('water_mask.npy', water)
road = (b - r > 8) & (b - r < 45) & (b < 240) & (r < 225) & (r > 150)
road &= ~ndimage.binary_dilation(water, iterations=7)
road = ndimage.binary_closing(road, iterations=2)
road = remove_small_objects(road, max_size=250)
dist = ndimage.distance_transform_edt(road)
sk = skeletonize(road)
sk = remove_small_objects(sk, max_size=25, connectivity=2)
ys, xs = np.nonzero(sk)
idx = {(y, x): i for i, (y, x) in enumerate(zip(ys, xs))}
G = nx.Graph()
for (y, x), i in idx.items():
    G.add_node(i, p=(x, y))
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dy == 0 and dx == 0: continue
            j = idx.get((y + dy, x + dx))
            if j is not None and j > i: G.add_edge(i, j)
def walk_paths(G):
    deg = dict(G.degree())
    nodes_j = [n for n, d in deg.items() if d != 2]
    seen = set(); paths = []
    for n in nodes_j:
        for nb in G.neighbors(n):
            if (n, nb) in seen: continue
            path = [n, nb]; seen.add((n, nb)); seen.add((nb, n))
            prev, cur = n, nb
            while deg[cur] == 2:
                nxt = [k for k in G.neighbors(cur) if k != prev][0]
                seen.add((cur, nxt)); seen.add((nxt, cur))
                path.append(nxt); prev, cur = cur, nxt
                if cur == n: break
            paths.append(path)
    return paths
# iterative spur pruning: dead-end paths shorter than 14 m
for it in range(4):
    paths = walk_paths(G); deg = dict(G.degree()); removed = 0
    for path in paths:
        if not all(n in G for n in path): continue
        L = sum(np.hypot(G.nodes[path[i]]['p'][0] - G.nodes[path[i - 1]]['p'][0], G.nodes[path[i]]['p'][1] - G.nodes[path[i - 1]]['p'][1]) for i in range(1, len(path)))
        e0, e1 = deg[path[0]] == 1, deg[path[-1]] == 1
        if (e0 != e1) and L < 14 / S:
            rm = path[:-1] if e0 else path[1:]
            G.remove_nodes_from(rm); removed += 1
    for comp in list(nx.connected_components(G)):
        if len(comp) < 25 / S: G.remove_nodes_from(comp)
    if not removed: break
paths = walk_paths(G); deg = dict(G.degree())
def dp(pts, tol):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0], float), np.array(pts[-1], float); d = b - a; L = np.hypot(*d)
    q = np.array(pts, float) - a
    dists = np.hypot(q[:, 0], q[:, 1]) if L == 0 else np.abs(d[0] * q[:, 1] - d[1] * q[:, 0]) / L
    i = int(np.argmax(dists))
    if dists[i] > tol: return dp(pts[:i + 1], tol)[:-1] + dp(pts[i:], tol)
    return [pts[0], pts[-1]]
out = []
for path in paths:
    pix = [G.nodes[n]['p'] for n in path]
    L = sum(np.hypot(pix[i][0] - pix[i - 1][0], pix[i][1] - pix[i - 1][1]) for i in range(1, len(pix))) * S
    wpx = np.percentile([dist[y, x] for x, y in pix], 60) * 2
    w = float(wpx * S)
    cls = 'd260' if w > 11 else 'main' if w > 7.4 else 'local'
    simp = dp(pix, 1.5)
    pts = [[round(X0 + x * S, 1), round(Z0 + y * S, 1)] for x, y in simp]
    out.append({'pts': pts, 'w': round(w, 1), 'len': round(L, 1), 'cls': cls, 'n0': int(path[0]), 'n1': int(path[-1])})
json.dump(out, open('roads_traced.json', 'w'))
print(len(out), 'segments', round(sum(o['len'] for o in out)), 'm')
import collections
print(collections.Counter(o['cls'] for o in out))
