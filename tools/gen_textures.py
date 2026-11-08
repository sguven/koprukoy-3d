#!/usr/bin/env python3
"""Procedural, seamlessly tileable PBR texture library for Köprüköy 3D.

Writes tex/<name>_c.jpg (albedo, sRGB), tex/<name>_n.jpg (tangent-space normal, OpenGL +Y)
and tex/<name>_r.jpg (roughness) for each material. Everything is generated from periodic
noise so that the maps wrap without seams. Real-world tile sizes (metres) are documented in
tex/manifest.json and used by the shaders so that stones, tiles and aggregate have a plausible scale.

Run:  python3 tools/gen_textures.py [--size 1024] [--out tex]
"""
import argparse, json, os
import numpy as np
from PIL import Image

rng = np.random.default_rng(71)  # 71 = Kırıkkale plate code


# ----------------------------------------------------------------------------- periodic noise
def _smooth(t):
    return t * t * t * (t * (t * 6 - 15) + 10)


def value_noise(N, freq, seed=None):
    """Periodic value noise on an N×N grid with `freq` lattice cells per tile."""
    r = np.random.default_rng(seed) if seed is not None else rng
    lat = r.random((freq, freq))
    ys, xs = np.mgrid[0:N, 0:N].astype(np.float64) * (freq / N)
    x0 = np.floor(xs).astype(int); y0 = np.floor(ys).astype(int)
    fx = _smooth(xs - x0); fy = _smooth(ys - y0)
    x1 = (x0 + 1) % freq; y1 = (y0 + 1) % freq
    x0 %= freq; y0 %= freq
    a = lat[y0, x0]; b = lat[y0, x1]; c = lat[y1, x0]; d = lat[y1, x1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(N, base=4, octaves=6, gain=0.5, lac=2.0, seed=None):
    out = np.zeros((N, N)); amp = 1.0; f = base; tot = 0
    for o in range(octaves):
        out += amp * value_noise(N, int(f), None if seed is None else seed + o)
        tot += amp; amp *= gain; f *= lac
    return out / tot


def ridged(N, base=4, octaves=5, seed=None):
    out = np.zeros((N, N)); amp = 1.0; f = base; tot = 0
    for o in range(octaves):
        n = value_noise(N, int(f), None if seed is None else seed + o)
        out += amp * (1 - abs(n * 2 - 1)) ** 2
        tot += amp; amp *= 0.5; f *= 2
    return out / tot


def voronoi(N, cells, jitter=1.0, seed=None, warp=0.0):
    """Periodic Voronoi. Returns (F1, F2, cell_id, dx, dy) with distances in cell units.
    `warp` (in cell units) domain-warps the lookup with low-frequency periodic noise for organic shapes."""
    r = np.random.default_rng(seed) if seed is not None else rng
    pts = (np.mgrid[0:cells, 0:cells].transpose(1, 2, 0) + 0.5 + (r.random((cells, cells, 2)) - 0.5) * jitter)
    ys, xs = np.mgrid[0:N, 0:N].astype(np.float64) * (cells / N)
    if warp:
        xs = xs + (fbm(N, 4, 4, seed=(seed or 0) + 901) - 0.5) * 2 * warp
        ys = ys + (fbm(N, 4, 4, seed=(seed or 0) + 902) - 0.5) * 2 * warp
        xs %= cells; ys %= cells
    cx = np.floor(xs).astype(int); cy = np.floor(ys).astype(int)
    f1 = np.full((N, N), 9.0); f2 = np.full((N, N), 9.0); cid = np.zeros((N, N), int)
    vx = np.zeros((N, N)); vy = np.zeros((N, N))
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            ix = (cx + ox) % cells; iy = (cy + oy) % cells
            px = pts[iy, ix, 1] + (cx + ox - ix); py = pts[iy, ix, 0] + (cy + oy - iy)
            d = np.hypot(px - xs, py - ys)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d)); f1 = np.where(closer, d, f1)
            cid = np.where(closer, iy * cells + ix, cid)
            vx = np.where(closer, xs - px, vx); vy = np.where(closer, ys - py, vy)
    return f1, f2, cid, vx, vy


def hash_cells(cid, seed=0):
    r = np.random.default_rng(seed); table = r.random(cid.max() + 1)
    return table[cid]


# ----------------------------------------------------------------------------- map helpers
def normal_from_height(h, strength=1.0):
    """Sobel normal map (OpenGL convention: +Y up in texture space) from a periodic height field."""
    k = h.shape[0] / 256.0  # make `strength` independent of texture resolution
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * k
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * k
    nx = -gx * strength; ny = gy * strength; nz = np.ones_like(h)  # +Y up: image rows go down, so flip
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / l, ny / l, nz / l], -1)
    return ((n * 0.5 + 0.5) * 255).clip(0, 255).astype(np.uint8)


def ao_from_height(h, radius=6):
    """Cheap cavity term: how far the pixel sits below its blurred neighbourhood."""
    b = h.copy()
    for _ in range(radius):
        b = (b + np.roll(b, 1, 0) + np.roll(b, -1, 0) + np.roll(b, 1, 1) + np.roll(b, -1, 1)) / 5
    return np.clip(1 - (b - h) * 3, 0, 1)


def lerp(a, b, t):
    t = np.asarray(t)[..., None] if np.ndim(t) == 2 else t
    return np.asarray(a) * (1 - t) + np.asarray(b) * t


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def save(out, name, albedo_lin, height, rough, normal_strength=2.0, ao_mix=0.5, meta=None, manifest=None):
    """albedo_lin: HxWx3 linear 0..1, height 0..1 (periodic), rough 0..1"""
    ao = ao_from_height(height)
    alb = albedo_lin * (1 - ao_mix + ao_mix * ao[..., None])
    Image.fromarray((srgb(alb) * 255).astype(np.uint8)).save(f'{out}/{name}_c.jpg', quality=88, subsampling=0)
    Image.fromarray(normal_from_height(height, normal_strength)).save(f'{out}/{name}_n.jpg', quality=92, subsampling=0)
    Image.fromarray((np.clip(rough, 0, 1) * 255).astype(np.uint8), 'L').save(f'{out}/{name}_r.jpg', quality=85)
    if manifest is not None:
        manifest[name] = meta or {}
    print(' ', name)


def col(hexstr):
    """sRGB hex -> linear rgb"""
    c = np.array([int(hexstr[i:i + 2], 16) for i in (0, 2, 4)]) / 255
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ----------------------------------------------------------------------------- materials
def tex_soil(N, out, man):
    """Dry, compacted Central Anatolian soil with pebbles and faint desiccation cracks (tile = 3 m)."""
    base = fbm(N, 3, 7, 0.55, seed=1)
    fine = fbm(N, 32, 4, 0.5, seed=2)
    f1, f2, cid, _, _ = voronoi(N, 90, seed=3, warp=0.2)
    pebble = np.clip(1 - f1 / 0.32, 0, 1) ** 1.5 * (hash_cells(cid, 4) > 0.72)
    crack = np.clip((f2 - f1) * 6, 0, 1); crack = 1 - (1 - crack) ** 3 * 0.5 * (fbm(N, 2, 3, seed=5) > 0.55)
    h = 0.45 + 0.25 * base + 0.12 * fine + 0.25 * pebble - 0.12 * (1 - crack)
    light = col('cfc3aa'); dark = col('9c8b70'); red = col('a9825f'); stone = col('bdb5a6')
    a = lerp(dark, light, base)
    a = lerp(a, red, np.clip(fbm(N, 4, 4, seed=6) - 0.5, 0, 1) * 1.2)
    a = a * (0.85 + 0.3 * fine[..., None])
    a = lerp(a, stone * (0.8 + 0.4 * hash_cells(cid, 7))[..., None], pebble)
    a = a * (0.75 + 0.25 * crack)[..., None]
    rough = 0.9 - 0.15 * pebble + 0.05 * fine
    save(out, 'soil', a, h, rough, 2.2, 0.55, {'size_m': 3.0}, man)


def tex_rock(N, out, man):
    """Weathered limestone/granite: blocky fracture cells, lichen flecks, iron staining (tile = 4 m)."""
    f1, f2, cid, _, _ = voronoi(N, 6, 0.9, seed=11, warp=0.35)
    cellh = hash_cells(cid, 12)
    edge = np.clip((f2 - f1) * 2.5 + 0.35, 0, 1)
    macro = fbm(N, 3, 6, 0.5, seed=13)
    rid = ridged(N, 6, 5, seed=14)
    grain = fbm(N, 48, 3, 0.5, seed=15)
    h = 0.35 + 0.25 * cellh * edge + 0.25 * macro + 0.2 * rid + 0.08 * grain
    grey = col('9a948a'); warm = col('b3a48c'); dark = col('5e5a52'); lichen = col('8a8f5c'); rust = col('9a6b45')
    a = lerp(dark, lerp(grey, warm, cellh), 0.55 + 0.45 * edge)
    a = lerp(a, rust, np.clip(fbm(N, 5, 4, seed=16) - 0.55, 0, 1) * 2.5)
    a = lerp(a, lichen, np.clip(fbm(N, 20, 3, seed=17) - 0.62, 0, 1) * 2.2 * (macro > 0.5))
    a = a * (0.8 + 0.4 * grain[..., None]) * (0.6 + 0.4 * rid[..., None])
    rough = 0.82 + 0.1 * grain - 0.1 * rid
    save(out, 'rock', a, h, rough, 3.0, 0.6, {'size_m': 4.0}, man)


def tex_grass_dry(N, out, man):
    """Dry steppe grass: directional straw strands over bare earth (tile = 2 m)."""
    ys, xs = np.mgrid[0:N, 0:N] / N
    strands = 0
    for i, (f, s) in enumerate([(70, 0.6), (140, 0.3), (280, 0.1)]):
        n = value_noise(N, f, seed=21 + i)
        strands = strands + s * n
    tuft = fbm(N, 6, 5, 0.5, seed=24)
    cover = np.clip((tuft - 0.35) * 2.2, 0, 1)
    h = 0.3 + 0.5 * strands * cover + 0.15 * tuft
    straw = col('b8a35e'); olive = col('7c7a3c'); earth = col('9b8562'); bright = col('d2c38a')
    g = lerp(olive, straw, strands)
    g = lerp(g, bright, np.clip(value_noise(N, 200, seed=25) - 0.6, 0, 1) * 2)
    a = lerp(earth * (0.8 + 0.4 * fbm(N, 20, 3, seed=26))[..., None], g, cover)
    rough = 0.92 - 0.08 * strands
    save(out, 'grass_dry', a, h, rough, 1.6, 0.4, {'size_m': 2.0}, man)


def tex_gravel(N, out, man):
    """Loose gravel and small stones over compacted earth (tile = 2 m)."""
    f1, f2, cid, vx, vy = voronoi(N, 48, seed=31)
    hc = hash_cells(cid, 32)
    stone = np.clip(1 - (f1 / (0.28 + 0.2 * hc)), 0, 1)
    stone = np.sqrt(stone) * (hc > 0.3)
    fine = fbm(N, 40, 3, 0.5, seed=33)
    h = 0.3 + 0.45 * stone + 0.1 * fine + 0.15 * fbm(N, 4, 4, seed=34)
    cols = np.stack([col('a89f8e'), col('8d8070'), col('c0b7a5'), col('7a6d5c'), col('b5a07f')])
    idx = (hc * 5).astype(int) % 5
    sc = cols[idx]
    earth = col('9c8a6c') * (0.7 + 0.5 * fine)[..., None]
    a = lerp(earth, sc * (0.8 + 0.4 * hash_cells(cid, 35))[..., None], stone)
    rough = 0.88 - 0.25 * stone * (hash_cells(cid, 36) > 0.6)
    save(out, 'gravel', a, h, rough, 2.5, 0.6, {'size_m': 2.0}, man)


def tex_asphalt(N, out, man):
    """Worn village asphalt: exposed aggregate, patch repairs, hairline cracks (tile = 4 m)."""
    f1, f2, cid, _, _ = voronoi(N, 160, seed=41)
    agg = np.clip(1 - f1 / 0.4, 0, 1) ** 1.3
    macro = fbm(N, 3, 5, 0.5, seed=42)
    wear = np.clip((macro - 0.4) * 2.5, 0, 1)                 # worn, lighter areas
    patch = np.clip((fbm(N, 3, 4, seed=43) - 0.58) * 12, 0, 1)   # darker repair patches
    crackv = voronoi(N, 5, 1.0, seed=44, warp=0.3)
    crack = np.clip(1 - abs(crackv[1] - crackv[0]) * 45, 0, 1) * np.clip((fbm(N, 3, 3, seed=45) - 0.45) * 4, 0, 1)
    h = 0.5 + 0.12 * agg - 0.25 * crack + 0.05 * macro
    dark = col('3a3a39'); mid = col('5e5c58'); light = col('7d7a73'); fresh = col('2d2c2b')
    a = lerp(dark, mid, agg)
    a = lerp(a, light, wear * agg)
    a = lerp(a, fresh, patch * 0.8)
    a = a * (1 - 0.6 * crack)[..., None]
    rough = 0.78 + 0.12 * agg - 0.1 * patch
    save(out, 'asphalt', a, h, rough, 1.8, 0.4, {'size_m': 4.0}, man)


def tex_dirt_road(N, out, man):
    """Compacted earth track with two wheel ruts along V (tile = 4 m, ruts 1.4 m apart)."""
    ys, xs = np.mgrid[0:N, 0:N] / N
    soil = fbm(N, 6, 6, 0.55, seed=51); fine = fbm(N, 40, 3, seed=52)
    f1, f2, cid, _, _ = voronoi(N, 70, seed=53)
    pebble = np.clip(1 - f1 / 0.3, 0, 1) ** 1.5 * (hash_cells(cid, 54) > 0.75)
    wobble = (fbm(N, 2, 3, seed=55) - 0.5) * 0.06
    rut = 0
    for c in (0.325, 0.675):
        d = np.abs(((xs - c - wobble + 0.5) % 1) - 0.5)
        rut = rut + np.exp(-(d / 0.055) ** 2)
    rut = np.clip(rut, 0, 1)
    tyre = (value_noise(N, 90, seed=56) > 0.5).astype(float) * rut  # tread marks in the ruts
    h = 0.5 + 0.2 * soil + 0.08 * fine - 0.22 * rut + 0.2 * pebble * (1 - rut) - 0.05 * tyre
    light = col('c1ad88'); dark = col('8a7152'); rutc = col('7e6a4e'); stone = col('b3aa9a')
    a = lerp(dark, light, soil) * (0.85 + 0.3 * fine)[..., None]
    a = lerp(a, rutc, rut * 0.7)
    a = lerp(a, stone * (0.8 + 0.4 * hash_cells(cid, 57))[..., None], pebble * (1 - rut))
    rough = 0.92 - 0.1 * pebble + 0.03 * tyre
    save(out, 'dirt_road', a, h, rough, 2.0, 0.5, {'size_m': 4.0}, man)


def tex_plaster(N, out, man):
    """Aged lime plaster: trowel texture, hairline cracks, flaking, dust (tile = 3 m)."""
    trowel = fbm(N, 8, 5, 0.5, seed=61); fine = fbm(N, 60, 3, seed=62)
    cv = voronoi(N, 6, 1.0, seed=63)
    crack = np.clip(1 - abs(cv[1] - cv[0]) * 55, 0, 1) * (fbm(N, 3, 3, seed=64) > 0.55)
    flake = (fbm(N, 9, 5, 0.6, seed=65) > 0.73).astype(float) * (fbm(N, 2, 2, seed=67) > 0.5)
    flake = np.clip(flake - crack, 0, 1)
    h = 0.55 + 0.1 * trowel + 0.05 * fine - 0.2 * crack - 0.12 * flake
    a = np.ones((N, N, 3)) * col('e6dfd2')
    a = a * (0.9 + 0.2 * trowel + 0.08 * fine)[..., None]
    a = lerp(a, col('cfc5b2'), flake * 0.8)       # exposed render coat
    a = a * (1 - 0.45 * crack)[..., None]
    stain = np.clip(fbm(N, 3, 4, seed=66) - 0.55, 0, 1) * 1.5
    a = lerp(a, col('b9ad98'), stain * 0.5)
    rough = 0.86 + 0.08 * flake - 0.05 * fine
    save(out, 'plaster', a, h, rough, 1.4, 0.35, {'size_m': 3.0}, man)


def tex_stone_wall(N, out, man):
    """Dressed ashlar masonry, Seljuk bridge type: 0.6 x 0.35 m blocks, recessed mortar (tile = 2.4 m)."""
    rows, cols_ = 7, 4
    ys, xs = np.mgrid[0:N, 0:N] / N
    ry = ys * rows; row = np.floor(ry).astype(int)
    offset = (row % 2) * 0.5
    rx = xs * cols_ + offset
    colI = np.floor(rx).astype(int)
    fy = ry - row; fx = rx - colI
    cell_id = (row * 131 + (colI % cols_) * 17) % 997
    r = np.random.default_rng(71); table = r.random(1000); hc = table[cell_id]
    # mortar joints ~2.5 cm of 35 cm -> 0.07 of row height
    jy = 0.045; jx = 0.03
    inside_y = np.clip(np.minimum(fy, 1 - fy) / jy, 0, 1)
    inside_x = np.clip(np.minimum(fx, 1 - fx) / jx, 0, 1)
    inside = np.minimum(inside_y, inside_x)
    inside = inside ** 0.6
    face = fbm(N, 24, 4, 0.55, seed=71) * 0.6 + ridged(N, 10, 4, seed=72) * 0.4
    chip = np.clip(1 - np.minimum(fy, 1 - fy) / 0.18, 0, 1) * (fbm(N, 12, 3, seed=73) > 0.6)
    h = 0.25 + 0.6 * inside * (0.85 + 0.3 * hc) + 0.12 * face - 0.1 * chip * inside
    warm = col('b9a584'); grey = col('a39c8d'); dark = col('7d7264'); mortar = col('8e877a'); moss = col('6d6b48')
    stonec = lerp(lerp(dark, warm, hc), grey, (hc * 7.3) % 1)
    stonec = stonec * (0.85 + 0.3 * face)[..., None]
    a = lerp(mortar * (0.8 + 0.3 * fbm(N, 30, 3, seed=74))[..., None], stonec, inside)
    weath = np.clip(fbm(N, 4, 4, seed=75) - 0.5, 0, 1) * 2
    a = lerp(a, moss, weath * 0.35)
    rough = 0.8 + 0.1 * (1 - inside) + 0.05 * face
    save(out, 'stone_wall', a, h, rough, 2.6, 0.6, {'size_m': 2.4, 'block': [0.6, 0.35]}, man)


def tex_rubble_wall(N, out, man):
    """Rural rubble (moloz) stone wall: irregular field stones of two sizes in wide lime mortar (tile = 2 m)."""
    f1, f2, cid, _, _ = voronoi(N, 7, 1.0, seed=81, warp=0.25)
    g1, g2, cid2, _, _ = voronoi(N, 13, 1.0, seed=85, warp=0.2)
    hc = hash_cells(cid, 82); hc2 = hash_cells(cid2, 86)
    big = np.clip((f2 - f1) * 3.2 - 0.25, 0, 1) ** 0.8 * (hc > 0.3)
    small = np.clip((g2 - g1) * 4.0 - 0.3, 0, 1) ** 0.8 * (hc2 > 0.45) * (1 - big)
    inside = np.clip(big + small, 0, 1)
    face = fbm(N, 20, 4, 0.5, seed=83); rough_n = fbm(N, 60, 3, seed=87)
    h = 0.3 + 0.4 * big * (0.75 + 0.5 * hc) + 0.3 * small * (0.7 + 0.5 * hc2) + 0.1 * face + 0.04 * rough_n
    warm = col('b8a283'); grey = col('9d978b'); dark = col('7a6d5d'); mortar = col('b3a893')
    sc = lerp(lerp(dark, warm, hc), grey, (hc * 5.7) % 1); sc2 = lerp(lerp(dark, grey, hc2), warm, (hc2 * 3.3) % 1)
    stonec = lerp(sc2, sc, big / np.maximum(inside, 1e-3)) * (0.85 + 0.3 * face)[..., None]
    a = lerp(mortar * (0.85 + 0.3 * fbm(N, 25, 3, seed=84))[..., None], stonec, inside)
    rough = 0.82 + 0.1 * (1 - inside) + 0.05 * rough_n
    save(out, 'rubble_wall', a, h, rough, 2.2, 0.55, {'size_m': 2.0}, man)


def tex_roof_tile(N, out, man):
    """Marseille-type clay roof tiles; U across the slope, V down it (tile = 1.6 x 1.6 m, tiles ~0.23 x 0.40 m)."""
    cols_, rows = 7, 4
    ys, xs = np.mgrid[0:N, 0:N] / N
    u = xs * cols_; v = ys * rows
    cu = np.floor(u).astype(int); cv = np.floor(v).astype(int)
    fu = u - cu; fv = v - cv
    prof = 0.5 + 0.5 * np.cos(fu * 2 * np.pi)                 # curved pan: high at the sides, low in the middle
    groove = 1 - np.clip(np.minimum(fu, 1 - fu) / 0.035, 0, 1)  # interlock seam between neighbouring tiles
    lip = np.clip(1 - fv / 0.08, 0, 1)                         # head lap: lower course tucks under the upper one
    lipshadow = np.clip(1 - fv / 0.16, 0, 1)
    tile_id = (cv * 31 + cu * 7) % 199
    r = np.random.default_rng(93); hc = r.random(200)[tile_id]
    grime = fbm(N, 6, 4, seed=91); fine = fbm(N, 40, 3, seed=92)
    h = 0.3 + 0.35 * prof - 0.2 * groove + 0.3 * lip + 0.05 * fine + 0.03 * hc
    terra = col('a0583f'); dark = col('6f3d2c'); faded = col('b98168'); moss = col('6f6a4a'); dust = col('a48d77')
    a = lerp(dark, terra, 0.45 + 0.55 * prof)
    a = lerp(a, faded, hc * 0.7)
    a = a * (0.85 + 0.3 * fine)[..., None]
    a = lerp(a, dust, np.clip(grime - 0.45, 0, 1) * 1.1)
    a = lerp(a, moss, np.clip(fbm(N, 10, 3, seed=94) - 0.68, 0, 1) * 2.5)
    a = a * (1 - 0.55 * lipshadow)[..., None] * (1 - 0.5 * groove)[..., None]
    rough = 0.7 + 0.12 * grime + 0.1 * groove
    save(out, 'roof_tile', a, h, rough, 2.4, 0.45, {'size_m': 1.6}, man)


def tex_metal_corr(N, out, man):
    """Corrugated galvanised sheet with rust streaks (tile = 2 m, corrugation pitch 7.6 cm)."""
    ys, xs = np.mgrid[0:N, 0:N] / N
    corr = 0.5 + 0.5 * np.cos(xs * 2 * np.pi * 26)
    rust = np.clip(fbm(N, 6, 5, 0.6, seed=101) - 0.5, 0, 1) * 2
    streak = np.clip(value_noise(N, 60, seed=102) - 0.55, 0, 1) * 2 * np.clip(fbm(N, 3, 3, seed=103) - 0.4, 0, 1)
    h = 0.35 + 0.5 * corr + 0.03 * fbm(N, 30, 3, seed=104)
    zinc = col('9fa3a4'); dullz = col('7d8183'); rustc = col('7e4a2b'); rust2 = col('5a3a26')
    a = lerp(dullz, zinc, corr)
    a = lerp(a, lerp(rust2, rustc, corr), np.clip(rust + streak, 0, 1))
    rough = 0.45 + 0.4 * np.clip(rust + streak, 0, 1)
    save(out, 'metal_corr', a, h, rough, 2.4, 0.3, {'size_m': 2.0}, man)


def tex_concrete(N, out, man):
    """Weathered cast concrete: pores, formwork streaks, water staining (tile = 3 m)."""
    fine = fbm(N, 50, 3, seed=111); mid = fbm(N, 8, 5, seed=112)
    f1, f2, cid, _, _ = voronoi(N, 120, seed=113)
    pore = np.clip(1 - f1 / 0.22, 0, 1) * (hash_cells(cid, 114) > 0.8)
    h = 0.55 + 0.06 * mid + 0.04 * fine - 0.2 * pore
    a = np.ones((N, N, 3)) * col('9f9a90') * (0.88 + 0.2 * mid + 0.08 * fine)[..., None]
    stain = np.clip(fbm(N, 4, 4, seed=115) - 0.5, 0, 1) * 2
    a = lerp(a, col('6f6c64'), stain * 0.5)
    a = a * (1 - 0.5 * pore)[..., None]
    rough = 0.85 + 0.05 * fine
    save(out, 'concrete', a, h, rough, 1.6, 0.4, {'size_m': 3.0}, man)


def tex_paving(N, out, man):
    """Interlocking concrete paving blocks (kilit parke), 20 x 10 cm, running bond (tile = 1.6 m)."""
    cols_, rows = 8, 16
    ys, xs = np.mgrid[0:N, 0:N] / N
    v = ys * rows; row = np.floor(v).astype(int); fv = v - row
    u = xs * cols_ + (row % 2) * 0.5; cu = np.floor(u).astype(int); fu = u - cu
    inside = np.minimum(np.clip(np.minimum(fu, 1 - fu) / 0.06, 0, 1), np.clip(np.minimum(fv, 1 - fv) / 0.1, 0, 1)) ** 0.7
    bid = (row * 53 + (cu % cols_) * 11) % 499
    hc = np.random.default_rng(121).random(500)[bid]
    fine = fbm(N, 40, 3, seed=122)
    h = 0.3 + 0.6 * inside * (0.9 + 0.2 * hc) + 0.05 * fine
    grey = col('9b968b'); dark = col('7e7a70'); sand = col('b3a78f')
    bc = lerp(dark, grey, hc) * (0.9 + 0.2 * fine)[..., None]
    a = lerp(sand * 0.8, bc, inside)
    dirt = np.clip(fbm(N, 4, 4, seed=123) - 0.5, 0, 1) * 1.5
    a = a * (1 - 0.3 * dirt)[..., None]
    rough = 0.82 + 0.1 * (1 - inside)
    save(out, 'paving', a, h, rough, 2.0, 0.5, {'size_m': 1.6}, man)


def tex_wood(N, out, man):
    """Weathered painted/varnished timber planks, vertical grain (tile = 1 m)."""
    ys, xs = np.mgrid[0:N, 0:N] / N
    planks = 5
    pu = xs * planks; pid = np.floor(pu).astype(int); fu = pu - pid
    gap = np.clip(np.minimum(fu, 1 - fu) / 0.03, 0, 1)
    grain = value_noise(N, 6, seed=131) * 0.6 + value_noise(N, 160, seed=132) * 0.4
    streak = np.abs(np.sin((ys * 40 + grain * 3 + pid * 1.7) * np.pi)) ** 8
    h = 0.4 + 0.4 * gap + 0.1 * grain - 0.08 * streak
    hc = np.random.default_rng(133).random(planks)[pid % planks]
    base = lerp(col('6b4a2e'), col('8d6a45'), grain)
    a = base * (0.8 + 0.4 * hc)[..., None] * (1 - 0.3 * streak)[..., None]
    a = lerp(a * 0.5, a, gap)
    rough = 0.7 + 0.15 * streak
    save(out, 'wood', a, h, rough, 1.6, 0.4, {'size_m': 1.0}, man)


def tex_shore(N, out, man):
    """Wet shoreline sediment: dark silt, rounded cobbles, debris line (tile = 3 m)."""
    f1, f2, cid, _, _ = voronoi(N, 40, seed=141)
    hc = hash_cells(cid, 142)
    cobble = np.clip(1 - f1 / (0.3 + 0.2 * hc), 0, 1) ** 0.8 * (hc > 0.45)
    silt = fbm(N, 5, 6, 0.55, seed=143); fine = fbm(N, 50, 3, seed=144)
    h = 0.3 + 0.5 * cobble + 0.15 * silt + 0.05 * fine
    siltc = col('6f6655'); drysilt = col('9a8f78'); stone = col('8d877c'); light = col('aaa497')
    a = lerp(siltc, drysilt, silt) * (0.85 + 0.3 * fine)[..., None]
    a = lerp(a, lerp(stone, light, hash_cells(cid, 145)), cobble)
    rough = 0.75 - 0.2 * cobble + 0.1 * silt
    save(out, 'shore', a, h, rough, 2.4, 0.55, {'size_m': 3.0}, man)


def tex_grass_card(N, out):
    """Alpha-cut dry grass/shrub card used for instanced ground cover (RGBA PNG)."""
    N2 = N // 2
    img = np.zeros((N2, N2, 4))
    r = np.random.default_rng(151)
    ys, xs = np.mgrid[0:N2, 0:N2] / N2
    for i in range(140):
        x0 = r.random(); bend = (r.random() - 0.5) * 0.5; hgt = 0.45 + 0.55 * r.random(); w = 0.006 + 0.008 * r.random()
        t = np.clip((1 - ys) / hgt, 0, 1)
        cx = x0 + bend * t * t
        d = np.abs(xs - cx) / (w * (1.2 - t) + 1e-4)
        blade = np.clip(1 - d, 0, 1) * (ys > 1 - hgt)
        c = lerp(col('8f7a3a'), col('cdbb79'), r.random()) * (0.6 + 0.6 * t)[..., None]
        a = blade[..., None]
        img[..., :3] = img[..., :3] * (1 - a) + c * a
        img[..., 3] = np.maximum(img[..., 3], blade)
    rgba = np.concatenate([srgb(img[..., :3]), img[..., 3:4]], -1)
    Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA').save(f'{out}/grass_card.png', optimize=True)
    # shrub card: dense small leaves
    img = np.zeros((N2, N2, 4))
    for i in range(900):
        cx = 0.5 + (r.random() - 0.5) * 0.9; cy = 0.55 + (r.random() - 0.5) * 0.8
        if (cx - 0.5) ** 2 / 0.2 + (cy - 0.5) ** 2 / 0.16 > 1: continue
        rad = 0.012 + 0.02 * r.random()
        d = np.hypot(xs - cx, ys - cy) / rad
        leaf = np.clip(1 - d, 0, 1) ** 0.5
        c = lerp(col('4e5a2e'), col('8a9452'), r.random()) * (0.5 + 0.7 * (1 - cy))
        a = leaf[..., None]
        img[..., :3] = img[..., :3] * (1 - a) + c * a
        img[..., 3] = np.maximum(img[..., 3], leaf)
    rgba = np.concatenate([srgb(img[..., :3]), img[..., 3:4]], -1)
    Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA').save(f'{out}/shrub_card.png', optimize=True)
    print('  grass_card, shrub_card')


def tex_water_normals(N, out):
    """Two tileable wave normal maps at different scales for the reservoir surface."""
    for k, (base, octs, strength) in enumerate([(6, 5, 1.2), (14, 4, 0.8)]):
        h = np.zeros((N, N)); amp = 1; f = base
        for o in range(octs):
            n = value_noise(N, f, seed=161 + 10 * k + o)
            h += amp * (1 - abs(n * 2 - 1)) ** 1.5 * 0.5 + amp * n * 0.5
            amp *= 0.55; f *= 2
        h /= h.max()
        Image.fromarray(normal_from_height(h, strength)).save(f'{out}/water{k + 1}_n.jpg', quality=92, subsampling=0)
    print('  water1_n, water2_n')


def tex_noise(N, out):
    """Grey fBm used by the shaders for macro variation / anti-tiling (tile = any)."""
    n = fbm(N // 2, 4, 6, 0.55, seed=171)
    n2 = fbm(N // 2, 11, 4, 0.5, seed=172)
    n3 = voronoi(N // 2, 12, seed=173)[0]
    img = np.stack([n, n2, np.clip(n3, 0, 1)], -1)
    Image.fromarray((img * 255).astype(np.uint8)).save(f'{out}/noise.jpg', quality=90, subsampling=0)
    print('  noise')


def tex_foliage(N, out):
    """Tileable RGBA leaf-cluster texture: triplanar alpha cut-out turns smooth canopy blobs into porous foliage."""
    N2 = N // 2
    r = np.random.default_rng(181)
    img = np.zeros((N2, N2, 4))
    ys, xs = np.mgrid[0:N2, 0:N2] / N2
    for i in range(520):
        cx, cy = r.random(), r.random(); ang = r.random() * np.pi; rad = 0.025 + 0.03 * r.random()
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                dx = xs - cx - ox; dy = ys - cy - oy
                lx = dx * np.cos(ang) + dy * np.sin(ang); ly = -dx * np.sin(ang) + dy * np.cos(ang)
                d = (lx / rad) ** 2 + (ly / (rad * 0.55)) ** 2
                leaf = np.clip(1.2 - d, 0, 1) ** 0.5 * (d < 1.2)
                shade = 0.6 + 0.6 * (0.5 - ly / rad * 0.5)  # lit top edge
                c = lerp(col('4a6a2a'), col('93a24a'), r.random()) * shade[..., None] * (0.8 + 0.4 * r.random())
                a = leaf[..., None]
                img[..., :3] = img[..., :3] * (1 - a) + c * a
                img[..., 3] = np.maximum(img[..., 3], leaf)
    rgba = np.concatenate([srgb(img[..., :3]), img[..., 3:4]], -1)
    Image.fromarray((rgba * 255).astype(np.uint8), 'RGBA').save(f'{out}/foliage.png', optimize=True)
    print('  foliage (coverage %.2f)' % (img[..., 3] > 0.5).mean())


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--size', type=int, default=1024); ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'tex'))
    args = ap.parse_args(); N = args.size; out = os.path.abspath(args.out); os.makedirs(out, exist_ok=True)
    man = {}
    print('Generating textures into', out)
    for fn in (tex_soil, tex_rock, tex_grass_dry, tex_gravel, tex_asphalt, tex_dirt_road, tex_plaster, tex_stone_wall,
               tex_rubble_wall, tex_roof_tile, tex_metal_corr, tex_concrete, tex_paving, tex_wood, tex_shore):
        fn(N, out, man)
    tex_grass_card(N, out); tex_water_normals(N // 2, out); tex_noise(N, out); tex_foliage(N, out)
    json.dump(man, open(f'{out}/manifest.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
