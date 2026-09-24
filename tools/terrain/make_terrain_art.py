"""Procedural terrain art for HexMatch: ocean, beach, river textures and the dam.

Painted in code, so nothing depends on an outside image service, the result is
reproducible from a seed, and every texture is SEAMLESS BY CONSTRUCTION: all
noise is band-limited periodic noise made in the frequency domain (an FFT of a
filtered random field wraps exactly), and every stripe has an integer number
of periods across the tile. No cross-fade, no mirror echo.

  python tools/terrain/make_terrain_art.py            # everything
  python tools/terrain/make_terrain_art.py water sand # just those

Writes
  assets/ground/{water,sand,river}.png          512x512 RGBA, seamless
  assets/ground/{medium,low}/...                half / quarter copies (GFX-01)
  assets/rivers/dam_{y,x}@{2x,1x,0.5x}.png      the dam, two headings
  assets/rivers/manifest.json                   sprite geometry (footprint, anchor)
  tools/terrain/preview.png                     a contact sheet of the lot

The palette is sampled from the shipped grass (mean ~(53,67,18)) so the water
and sand sit with it instead of shouting over it. See docs/ART_PIPELINE.md.
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GROUND = os.path.join(ROOT, "assets", "ground")
RIVERS = os.path.join(ROOT, "assets", "rivers")
N = 512
SEED = 20260924


# ── periodic noise ─────────────────────────────────────────────────────────
def periodic_noise(n, lo, hi, rng, aniso=(1.0, 1.0), beta=1.0):
    """Band-limited noise that tiles exactly: frequencies between `lo` and `hi`
    cycles per tile, 1/f^beta falloff, optionally stretched (aniso = how much
    to squash frequency along x / y — >1 makes features LONGER on that axis)."""
    white = rng.standard_normal((n, n))
    F = np.fft.fft2(white)
    fy = np.fft.fftfreq(n)[:, None] * n
    fx = np.fft.fftfreq(n)[None, :] * n
    r = np.sqrt((fx * aniso[0]) ** 2 + (fy * aniso[1]) ** 2)
    band = (r >= lo) & (r <= hi)
    amp = np.where(band, 1.0 / np.maximum(r, 1e-6) ** beta, 0.0)
    out = np.real(np.fft.ifft2(F * amp))
    out -= out.mean()
    return out / (np.abs(out).max() + 1e-9)


def lerp(a, b, t):
    return a + (b - a) * t[..., None]


def rgb(hexs):
    h = hexs.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], float)


def save_tex(name, arr):
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    img.save(os.path.join(GROUND, f"{name}.png"))
    for sub, s in (("medium", 2), ("low", 4)):
        os.makedirs(os.path.join(GROUND, sub), exist_ok=True)
        img.resize((N // s, N // s), Image.LANCZOS).save(os.path.join(GROUND, sub, f"{name}.png"))
    return img


# ── ocean ──────────────────────────────────────────────────────────────────
def make_water(rng):
    """Deep, calm sea: a slow swell of tone, broken wave caps that catch the
    light (ridged noise, stretched so they read as crests, never a grid of
    equal stripes), and a faint glint on the brightest."""
    deep, mid, crest, glint = rgb("#103f55"), rgb("#1b5f72"), rgb("#3f8c94"), rgb("#a9d6d2")
    swell = periodic_noise(N, 1, 4, rng, beta=1.2)
    base = lerp(deep, mid, (swell * 0.5 + 0.5) ** 1.2)
    ridges = np.zeros((N, N))
    for lo, hi, w, stretch in ((6, 12, 0.55, (0.55, 1.0)), (12, 24, 0.35, (0.6, 1.0)), (24, 48, 0.2, (0.7, 1.0))):
        n = periodic_noise(N, lo, hi, rng, aniso=stretch)
        ridges += w * (1 - np.abs(n)) ** 6
    ridges /= ridges.max()
    breakup = periodic_noise(N, 3, 10, rng) * 0.5 + 0.5          # caps come and go
    caps = np.clip(ridges * (0.35 + 0.9 * breakup) - 0.18, 0, 1)
    out = lerp(base, crest, np.clip(caps * 1.4, 0, 1) * 0.75)
    glints = np.clip((caps - 0.55) * 3.0, 0, 1) ** 2
    out = lerp(out, glint, glints * 0.55)
    return save_tex("water", out)


# ── beach ──────────────────────────────────────────────────────────────────
def make_sand(rng):
    """A pale, muted beach — warm beige, not orange — with wind ripples (an
    integer number of waves across the tile, warped by noise so they meander),
    damp darker patches, fine grain and a few shell and pebble specks."""
    light, dry, damp = rgb("#c9b48b"), rgb("#b7a078"), rgb("#9a8660")
    patches = periodic_noise(N, 1, 5, rng, beta=1.3) * 0.5 + 0.5
    base = lerp(light, dry, patches)
    y, x = np.mgrid[0:N, 0:N] / N
    warp = periodic_noise(N, 2, 6, rng) * 0.35
    ripple = np.sin(2 * np.pi * (14 * (x * 0.8 + y * 0.6) + warp * 3)) * 0.5 + 0.5
    ripple_mask = np.clip(periodic_noise(N, 2, 6, rng) * 0.9 + 0.35, 0, 1)
    base = lerp(base, damp, (ripple ** 3) * 0.28 * ripple_mask)
    wet = np.clip(periodic_noise(N, 2, 7, rng, beta=1.4) - 0.35, 0, 1) * 1.6
    base = lerp(base, damp, np.clip(wet, 0, 1) * 0.35)
    grain = periodic_noise(N, 80, 250, rng, beta=0.2)
    base += grain[..., None] * 9
    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    for _ in range(90):                       # specks, wrapped so they tile
        cx, cy = rng.uniform(0, N, 2)
        r = rng.uniform(0.8, 2.2)
        tone = tuple(int(v) for v in rng.choice([rgb("#ece3cf"), rgb("#8d7c5e"), rgb("#b8a78a")]))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d.ellipse([cx + ox - r, cy + oy - r * 0.7, cx + ox + r, cy + oy + r * 0.7], fill=tone)
    return save_tex("sand", np.array(img, float))


# ── river ──────────────────────────────────────────────────────────────────
def make_river(rng):
    """Fresh water, greener and lighter than the sea, flowing along x: long
    streaks (noise stretched hard across the flow) and small bright eddies."""
    bed, body, streak = rgb("#1d5a5e"), rgb("#2c7471"), rgb("#6fa9a0")
    tone = periodic_noise(N, 1, 4, rng) * 0.5 + 0.5
    base = lerp(bed, body, tone)
    flow = np.zeros((N, N))
    for lo, hi, w in ((4, 14, 0.6), (14, 40, 0.4)):
        n = periodic_noise(N, lo, hi, rng, aniso=(0.12, 1.0))   # long along x
        flow += w * (1 - np.abs(n)) ** 8
    flow /= flow.max()
    out = lerp(base, streak, np.clip(flow - 0.25, 0, 1) * 0.9)
    eddy = np.clip(periodic_noise(N, 30, 70, rng) - 0.55, 0, 1) * 2.5
    out = lerp(out, rgb("#b9dccf"), np.clip(eddy, 0, 1) * 0.35)
    return save_tex("river", out)


# ── the dam ────────────────────────────────────────────────────────────────
HW, HH = 64, 32          # half a tile at 2x
FOOT = (1, 2)            # dam_y: one tile deep along x, two long along y


def iso(u, v, z=0.0):
    return ((u - v) * HW, (u + v) * HH - z)


def make_dam(rng):
    """A 1920s concrete gravity dam across a river that flows along x: a
    buttressed wall two tiles long, a lowered spillway in the middle pouring a
    white sheet down the downstream (+x) face into a foam pool, a small gate
    house, and a railing. Drawn as shaded isometric polygons at 2x."""
    fx, fy = FOOT
    u0, u1 = 0.32, 0.68            # wall thickness within the tile
    H, SPILL = 58.0, 14.0          # wall height, spillway drop (px at 2x)
    pts = [iso(u, v, z) for u in (0, fx) for v in (0, fy) for z in (0, H + 40)]
    minx = min(p[0] for p in pts) - 8; maxx = max(p[0] for p in pts) + 8
    miny = min(p[1] for p in pts) - 8; maxy = max(p[1] for p in pts) + 8
    W, Hh = int(maxx - minx + 3) // 4 * 4 + 4, int(maxy - miny + 3) // 4 * 4 + 4
    img = Image.new("RGBA", (W, Hh), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    P = lambda u, v, z=0.0: (iso(u, v, z)[0] - minx, iso(u, v, z)[1] - miny)

    top_c, se_c, sw_c = (190, 184, 170, 255), (148, 142, 130, 255), (112, 107, 98, 255)
    line = (72, 68, 62, 255)
    s0, s1 = 0.62, 1.38            # spillway span along v
    # abutments on the banks (low earth/stone shoulders at each end)
    for va, vb in ((0.0, 0.18), (fy - 0.18, fy)):
        d.polygon([P(0.1, va, 8), P(0.9, va, 8), P(0.9, vb, 8), P(0.1, vb, 8)], fill=(120, 108, 84, 255))
        d.polygon([P(0.9, va, 0), P(0.9, vb, 0), P(0.9, vb, 8), P(0.9, va, 8)], fill=(96, 86, 66, 255))
    # the wall, in three blocks: bank / spillway (lower) / bank
    for va, vb, h in ((0.0, s0, H), (s0, s1, H - SPILL), (s1, fy, H)):
        d.polygon([P(u1, va), P(u1, vb), P(u1, vb, h), P(u1, va, h)], fill=se_c)          # downstream face
        d.polygon([P(u0, vb), P(u1, vb), P(u1, vb, h), P(u0, vb, h)], fill=sw_c)          # end face
        d.polygon([P(u0, va, h), P(u1, va, h), P(u1, vb, h), P(u0, vb, h)], fill=top_c)   # crest
    # buttress piers on the downstream face
    for v in (0.3, s0, 1.0, s1, 1.7):
        h = H - (SPILL if s0 < v < s1 else 0)
        d.polygon([P(u1, v - 0.035), P(u1 + 0.07, v - 0.035), P(u1 + 0.07, v - 0.035, h - 6), P(u1, v - 0.035, h - 6)],
                  fill=(128, 122, 112, 255))
        d.line([P(u1 + 0.07, v - 0.035), P(u1 + 0.07, v - 0.035, h - 6)], fill=line, width=2)
    # the spill: a white sheet down the face into a foam pool
    for i in range(9):
        t = i / 8
        vv = s0 + 0.04 + (s1 - s0 - 0.08) * t
        d.line([P(u1 + 0.01, vv, H - SPILL - 2), P(u1 + 0.05, vv, 4)],
               fill=(225, 238, 240, 235 - int(40 * abs(t - 0.5))), width=5)
    pool = [P(u1 + 0.02, s0 - 0.05), P(0.98, s0 + 0.05), P(0.98, s1 - 0.05), P(u1 + 0.02, s1 + 0.05)]
    d.polygon(pool, fill=(214, 232, 232, 220))
    for _ in range(40):
        u = rng.uniform(u1 + 0.03, 0.96); v = rng.uniform(s0, s1)
        x, y = P(u, v, 1)
        d.ellipse([x - 2, y - 1, x + 2, y + 1], fill=(250, 252, 252, 255))
    # railing along the crest, and the gate house
    for va, vb, h in ((0.0, s0, H), (s1, fy, H)):
        d.line([P(u1, va, h + 5), P(u1, vb, h + 5)], fill=line, width=2)
    g0, g1, gh = 0.22, 0.46, 22.0
    d.polygon([P(u1 - 0.02, g0, H), P(u1 - 0.02, g1, H), P(u1 - 0.02, g1, H + gh), P(u1 - 0.02, g0, H + gh)], fill=(160, 120, 92, 255))
    d.polygon([P(u0 + 0.02, g1, H), P(u1 - 0.02, g1, H), P(u1 - 0.02, g1, H + gh), P(u0 + 0.02, g1, H + gh)], fill=(126, 92, 70, 255))
    d.polygon([P(u0 - 0.02, g0 - 0.04, H + gh), P(u1 + 0.02, g0 - 0.04, H + gh),
               P(u1 + 0.02, g1 + 0.04, H + gh), P(u0 - 0.02, g1 + 0.04, H + gh)], fill=(64, 70, 74, 255))
    wx, wy = P(u1 - 0.02, (g0 + g1) / 2, H + gh * 0.55)
    d.rectangle([wx - 3, wy - 4, wx + 3, wy + 3], fill=(255, 214, 120, 255))       # a lit window
    img = img.filter(ImageFilter.SMOOTH)
    ax, ay = P(fx, fy)                                                                  # the SOUTH vertex
    os.makedirs(RIVERS, exist_ok=True)
    man = {"tileW": 64, "tileH": 32, "sprites": {}}
    for name, im, anchor, foot in (
        ("dam_y", img, (ax, ay), [fx, fy]),
        ("dam_x", img.transpose(Image.FLIP_LEFT_RIGHT), (W - ax, ay), [fy, fx]),
    ):
        im.save(os.path.join(RIVERS, f"{name}@2x.png"))
        im.resize((W // 2, Hh // 2), Image.LANCZOS).save(os.path.join(RIVERS, f"{name}@1x.png"))
        im.resize((W // 4, Hh // 4), Image.LANCZOS).save(os.path.join(RIVERS, f"{name}@0.5x.png"))
        man["sprites"][name] = {
            "name": name, "w": W // 2, "h": Hh // 2,
            "anchor": [round(anchor[0] / 2), round(anchor[1] / 2)],
            "footprint": foot,
            "note": "procedural (tools/terrain/make_terrain_art.py); river flows along "
                    + ("x" if name == "dam_y" else "y") + ", wall across it.",
        }
    json.dump(man, open(os.path.join(RIVERS, "manifest.json"), "w"), indent=2)
    return img


def contact_sheet(textures, dam):
    """Each texture 2x2-tiled (so a seam would show), plus the dam on a patch of river."""
    cell = 384
    sheet = Image.new("RGBA", (cell * len(textures) + dam.width + 40, max(cell, dam.height + 40)), (30, 30, 30, 255))
    for i, t in enumerate(textures):
        small = t.resize((cell // 2, cell // 2), Image.LANCZOS)
        for ox in (0, 1):
            for oy in (0, 1):
                sheet.alpha_composite(small, (i * cell + ox * cell // 2, oy * cell // 2))
    sheet.alpha_composite(dam, (cell * len(textures) + 20, 20))
    sheet.save(os.path.join(os.path.dirname(__file__), "preview.png"))


if __name__ == "__main__":
    want = set(sys.argv[1:]) or {"water", "sand", "river", "dam"}
    rng = np.random.default_rng(SEED)
    made = {}
    for name, fn in (("water", make_water), ("sand", make_sand), ("river", make_river), ("dam", make_dam)):
        sub = np.random.default_rng([SEED, sum(map(ord, name))])
        if name in want:
            made[name] = fn(sub)
            print("made", name)
    if len(made) == 4:
        contact_sheet([made["water"], made["sand"], made["river"]], made["dam"])
        print("preview: tools/terrain/preview.png")
