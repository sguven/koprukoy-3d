"""Detect roofs in the hi-res satellite mosaic (mosaic_hi.jpg, 0.3 m/px, X0=-380 Z0=-700).
Output buildings_traced.json: [{x,z,yaw,w,d,roof,area}]  (pin georeference, metres)"""
import json, math, numpy as np
from PIL import Image
from scipy import ndimage
X0, Z0, S = -380, -700, 0.3
a = np.array(Image.open('mosaic_hi.jpg').convert('RGB')).astype(np.int16)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx = a.max(2); mn = a.min(2); chroma = mx - mn
valid = mx > 0
water = (b - r > 25) & (b > 60) & (g < 140) & (b < 170)   # dark blue-ish water
water = ndimage.binary_opening(water, iterations=4)
water = ndimage.binary_dilation(water, iterations=15)
tile = (r > 100) & (r - g > 16) & (r - b > 24) & ((g - b) < 0.5 * (r - g) + 4)
brown = (r > 70) & (r < 140) & (r - g > 10) & (r - b > 14) & ((g - b) < 0.6 * (r - g) + 3) & ~tile   # dark / shaded red roofs
blue = (b - r > 30) & (b > 120) & (b - g > 6) & ~water
white = (mn > 190) & (chroma < 24)
grey = (mx > 95) & (mx < 165) & (chroma < 14)   # grey roofs (concrete / weathered) — also ground; strict shape filter later
out = []
def blobs(mask, kind, min_px, max_px, min_fill, open_it=1, close_it=2, max_aspect=4.0):
    m = mask & valid
    m = ndimage.binary_opening(m, iterations=open_it)
    m = ndimage.binary_closing(m, iterations=close_it)
    m = ndimage.binary_fill_holes(m)
    lab, n = ndimage.label(m)
    objs = ndimage.find_objects(lab)
    for i, sl in enumerate(objs, 1):
        sub = lab[sl] == i
        npx = int(sub.sum())
        if npx < min_px or npx > max_px: continue
        ys, xs = np.nonzero(sub); ys = ys + sl[0].start; xs = xs + sl[1].start
        cx, cy = xs.mean(), ys.mean()
        cov = np.cov(np.vstack([xs, ys])); w_, v = np.linalg.eigh(cov); ax = v[:, 1]; ang = math.atan2(ax[1], ax[0])
        c, s = math.cos(ang), math.sin(ang)
        u = (xs - cx) * c + (ys - cy) * s; vv = -(xs - cx) * s + (ys - cy) * c
        L = np.percentile(u, 98) - np.percentile(u, 2) + 2; D = np.percentile(vv, 98) - np.percentile(vv, 2) + 2
        fill = npx / (L * D)
        if fill < min_fill or L / D > max_aspect: continue
        out.append({'x': round(X0 + cx * S, 1), 'z': round(Z0 + cy * S, 1), 'yaw': round(-ang, 3), 'w': round(L * S, 1), 'd': round(D * S, 1), 'roof': kind, 'area': round(npx * S * S), 'fill': round(fill, 2)})
# min 20 m² (220 px), max 1500 m²
blobs(tile, 'tile', 200, 17000, 0.55)
blobs(brown, 'brown', 260, 12000, 0.55, open_it=2)
blobs(blue, 'blue', 160, 12000, 0.55)
blobs(white, 'white', 260, 9000, 0.68, open_it=2)
blobs(grey, 'grey', 300, 6000, 0.72, open_it=3, max_aspect=2.6)
def overlap(p, q):
    return math.hypot(p['x'] - q['x'], p['z'] - q['z']) < (min(p['w'], p['d']) + min(q['w'], q['d'])) / 2
prio = {'tile': 0, 'blue': 1, 'brown': 2, 'white': 3, 'grey': 4}
out.sort(key=lambda o: (prio[o['roof']], -o['area']))
clean = []
for o in out:
    if any(overlap(o, c) for c in clean): continue
    clean.append(o)
json.dump(clean, open('buildings_traced.json', 'w'))
import collections
print(len(clean), collections.Counter(o['roof'] for o in clean))
