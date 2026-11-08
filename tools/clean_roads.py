"""Clean the traced road segments: cluster junctions, drop junction slivers, merge chains, classify.
Input roads_traced.json -> roads_clean.json [{pts, w, cls, len}]"""
import json, numpy as np, collections
segs = json.load(open('roads_traced.json'))
# node positions
pos = {}
for s in segs:
    pos[s['n0']] = s['pts'][0]; pos[s['n1']] = s['pts'][-1]
deg = collections.Counter()
for s in segs: deg[s['n0']] += 1; deg[s['n1']] += 1
# cluster nodes within R metres (single linkage, greedy)
R = 7.0
ids = list(pos.keys()); P = np.array([pos[i] for i in ids])
cluster = {}
cid = 0
order = sorted(range(len(ids)), key=lambda k: -deg[ids[k]])
assigned = np.full(len(ids), -1)
for k in order:
    if assigned[k] >= 0: continue
    d = np.hypot(*(P - P[k]).T)
    members = np.nonzero((d < R) & (assigned < 0))[0]
    assigned[members] = cid; cid += 1
cent = {}
for c in range(cid):
    m = np.nonzero(assigned == c)[0]; cent[c] = P[m].mean(0).round(1).tolist()
node_c = {ids[k]: int(assigned[k]) for k in range(len(ids))}
# rebuild segments with clustered endpoints
out = []
for s in segs:
    a, b = node_c[s['n0']], node_c[s['n1']]
    if a == b: continue
    pts = [cent[a]] + s['pts'][1:-1] + [cent[b]]
    # drop interior points too close to the ends
    def far(p, q, m=3.0): return np.hypot(p[0] - q[0], p[1] - q[1]) > m
    pts = [pts[0]] + [p for p in pts[1:-1] if far(p, pts[0]) and far(p, pts[-1])] + [pts[-1]]
    out.append({'a': a, 'b': b, 'pts': pts, 'w': s['w'], 'len': s['len']})
# remove duplicate edges (same a,b) keeping the longer
best = {}
for s in out:
    key = tuple(sorted((s['a'], s['b'])))
    if key not in best or s['len'] > best[key]['len']: best[key] = s
out = list(best.values())
# merge chains through degree-2 cluster nodes
cdeg = collections.Counter()
for s in out: cdeg[s['a']] += 1; cdeg[s['b']] += 1
by_node = collections.defaultdict(list)
for i, s in enumerate(out): by_node[s['a']].append(i); by_node[s['b']].append(i)
used = [False] * len(out); merged = []
for i, s in enumerate(out):
    if used[i]: continue
    used[i] = True
    pts = list(s['pts']); a, b = s['a'], s['b']; ws = [(s['w'], s['len'])]
    # extend forward from b
    for direction in (1, -1):
        while True:
            end = b if direction == 1 else a
            if cdeg[end] != 2: break
            nxt = [j for j in by_node[end] if not used[j]]
            if not nxt: break
            j = nxt[0]; t = out[j]; used[j] = True; ws.append((t['w'], t['len']))
            tp = t['pts'] if t['a'] == end else t['pts'][::-1]
            if direction == 1: pts = pts + tp[1:]; b = t['b'] if t['a'] == end else t['a']
            else: pts = tp[::-1][:-1] + pts; a = t['b'] if t['a'] == end else t['a']
            if a == b: break
    L = sum(np.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) for i in range(1, len(pts)))
    w = sum(w * l for w, l in ws) / max(1e-6, sum(l for _, l in ws))
    merged.append({'pts': [[round(x, 1), round(z, 1)] for x, z in pts], 'w': round(w, 1), 'len': round(L, 1), 'a': a, 'b': b})
# classify by Google's drawn width
for s in merged:
    s['cls'] = 'd260' if s['w'] > 12.5 else 'main' if s['w'] > 7.2 else 'local'
# drop short dangling locals (< 12 m) that end free
cdeg = collections.Counter()
for s in merged: cdeg[s['a']] += 1; cdeg[s['b']] += 1
merged = [s for s in merged if not (s['len'] < 12 and (cdeg[s['a']] == 1 or cdeg[s['b']] == 1))]
json.dump(merged, open('roads_clean.json', 'w'))
print(len(merged), 'roads', round(sum(s['len'] for s in merged)), 'm', collections.Counter(s['cls'] for s in merged))
print('d260 total', round(sum(s['len'] for s in merged if s['cls'] == 'd260')), 'main', round(sum(s['len'] for s in merged if s['cls'] == 'main')))
