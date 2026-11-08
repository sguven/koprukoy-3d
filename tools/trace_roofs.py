"""Detect tile roofs in the satellite screenshot docs/reference/01 and print them as the TRACED table
used by src/village_layout.js (image pixels: centre, size, long-axis angle).

    python3 tools/trace_roofs.py docs/reference/01-harita-merkez-guvendioglu-market.png

Red/brown roof pixels are thresholded, cleaned with morphological opening/closing, labelled, and each blob
is fitted with a PCA-oriented rectangle (2nd..98th percentile extents). Flat white roofs are not detected
and were added by hand.
"""
import sys, math, json
import numpy as np
from PIL import Image
from scipy import ndimage

path = sys.argv[1] if len(sys.argv) > 1 else 'docs/reference/01-harita-merkez-guvendioglu-market.png'
im = Image.open(path).convert('RGB')
a = np.asarray(im).astype(float); r, g, b = a[..., 0], a[..., 1], a[..., 2]
roof = (r > 95) & (r - g > 16) & (r - b > 16) & ((r - g) + (r - b) > 40)
roof = ndimage.binary_opening(roof, iterations=1)
roof = ndimage.binary_closing(roof, iterations=2)
roof = ndimage.binary_fill_holes(roof)
lab, n = ndimage.label(roof)
rows = []
for i in range(1, n + 1):
    ys, xs = np.nonzero(lab == i)
    if len(xs) < 140: continue
    cx, cy = xs.mean(), ys.mean()
    cov = np.cov(np.vstack([xs, ys])); w_, v = np.linalg.eigh(cov); ax = v[:, 1]; ang = math.atan2(ax[1], ax[0])
    c, s = math.cos(ang), math.sin(ang)
    u = (xs - cx) * c + (ys - cy) * s; vv = -(xs - cx) * s + (ys - cy) * c
    L = np.percentile(u, 98.5) - np.percentile(u, 1.5); D = np.percentile(vv, 98.5) - np.percentile(vv, 1.5)
    rows.append((round(float(cx), 1), round(float(cy), 1), round(float(L), 1), round(float(D), 1), round(ang, 3), int(len(xs)), round(len(xs) / (L * D + 1), 2)))
rows.sort(key=lambda t: t[1])
for row in rows: print(f"  [{row[0]}, {row[1]}, {row[2]}, {row[3]}, {row[4]}, 1, 'h'],  // area {row[5]} fill {row[6]}")
print(f"// {len(rows)} roofs", file=sys.stderr)
