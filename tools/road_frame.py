"""v1.13: which traced roads are in the satellite mosaic's frame and which in the houses' frame.

The mosaic georeference used by sat_roads.py sits 8.25 m north and 0.75 m east of the frame of the house footprints.
For every road the lane evidence (as in sat_roads.py) is read along its line as drawn and along the line moved by
that offset; roads that only lie on a lane when moved are already in the houses' frame (src/road_frame.js, keep).
Usage: python3 tools/road_frame.py layout_roads.json   (run from the repo root)
"""
import cv2, numpy as np, json, math, sys
from PIL import Image
S, DU, DV, X0, Z0 = 1.5, -0.5, 5.5, -380.0, -700.0
BRIDGE, SHIFT = (-376.89, -277.44), (43.9, -54.6)
def m2px_arr(P):
    P = np.asarray(P, float); x, z = P[:, 0].copy(), P[:, 1].copy()
    for _ in range(30):
        d = np.hypot(x - BRIDGE[0], z - BRIDGE[1]); w = np.clip((d - 150) / 350, 0, 1)
        ax, az = x + SHIFT[0] * w, z + SHIFT[1] * w; x += P[:, 0] - ax; z += P[:, 1] - az
    return np.stack([(x - X0) / S + DU, (z - Z0) / S + DV], 1)
img = np.array(Image.open('docs/survey/satellite_mosaic_0.3m_small.jpg').convert('RGB')).astype(np.float32)
gray = img.mean(2); sat = img.max(2) - img.min(2); pale = gray - 0.7 * sat
ev = np.clip(pale - cv2.GaussianBlur(pale, (0, 0), 6.0), -15, 40)
g=img[...,1]; ev[(g-(img[...,0]+img[...,2])/2)>6]=-10
L=json.load(open(sys.argv[1]))   # roads of the layout before the shift: [{id, line, gone}], dumped from buildVillageLayout
def score(line,dx,dz):
    P=np.array(line)+[dx,dz]; q=m2px_arr(P); u=np.clip(q[:,0].round().astype(int),0,ev.shape[1]-1); v=np.clip(q[:,1].round().astype(int),0,ev.shape[0]-1)
    return float(ev[v,u].mean())
out={}
for r in L['roads']:
    if r['gone'] or len(r['line'])<3: continue
    a=score(r['line'],0,0); b=score(r['line'],0.75,-8.25); c=score(r['line'],0.4,-4)
    out[r['id']]=(round(a,1),round(b,1),round(c,1),len(r['line']), r['line'][len(r['line'])//2])
A=[k for k,v in out.items() if v[0]>v[1]+2]; B=[k for k,v in out.items() if v[1]>v[0]+2]; U=[k for k in out if k not in A and k not in B]
print(len(A),'mosaic-frame',len(B),'building-frame',len(U),'unclear')
print('B:',[(k,out[k][:3],[round(t) for t in out[k][4]]) for k in B])
print('U:',[(k,out[k][:3],[round(t) for t in out[k][4]]) for k in U][:80])
keep=sorted(k for k,v in out.items() if v[1]-v[0]>6 and v[3]>=6); print('ROAD_SHIFT.keep =', json.dumps(keep))
