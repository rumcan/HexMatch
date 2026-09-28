#!/usr/bin/env python3
"""CAST-1 — slice the manager sprite sheets into the poster-menu art.

Re-runnable: every output is rebuilt from the source sheets each time.

Each avatar sheet (RGBA, ~1448x1086) is a 2x2 sheet of ONE character:

    top-left  = hero    (full pose)          -> hero-<id>.webp
    top-right = ghost   (tinted head)        -> ghost-<id>.webp
    bottom-left = bust                       -> bust-<id>.webp + thumb-<id>.webp
    bottom-right = think (hand-on-chin pose) -> think-<id>.webp

The four figures are NOT on a clean 50% grid — the hero's cut edge runs past
the sheet's midline and often touches the bust's hair — so a naive quarter
split clips them. Instead the slicer:

  1. thresholds the alpha into a mask,
  2. erodes it until it falls apart into four large islands (the seeds),
  3. grows the seeds back over the ORIGINAL mask (geodesic dilation), so every
     opaque pixel belongs to exactly one figure,
  4. names each island by the quadrant its centroid sits in,
  5. trims each figure to its own alpha bbox (other figures' pixels cleared).

The two loading posters are re-encoded to webp at the same time.

Usage (from the repo root):

    python tools/cast/slice-avatars.py                      # default dirs
    python tools/cast/slice-avatars.py --src <dir> --poster-src <dir>

Source art is NOT committed (it lives untracked in the lead clone's
assets/avatars/ and assets/poster/). Outputs land in src/assets/poster/.
"""
from __future__ import annotations

import argparse
import collections
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# id -> (sheet file, thumb background). Thumbs are flat UIX colours (no
# gradients), like thumb-james (orange) / thumb-anne (aqua).
SHEETS: dict[str, tuple[str, tuple[int, int, int]]] = {
    # Thumb backgrounds are each manager's flat stage colour (src/story/managers.ts).
    "rafael": ("8993e41e-8f82-410b-a22a-466d6bd06f3f.png", (0xe8, 0xa3, 0x17)),   # mustard
    "dolores": ("3a6275e8-a48c-487d-9e07-a7710a179886.png", (0x7f, 0xb0, 0x7a)),  # sage
    # asian_man2.png is an opaque (no alpha) alternate — asian_man.png crops clean.
    "kenji": ("asian_man.png", (0x3d, 0x86, 0xc6)),                                 # blue
    "graves": ("Rival.png", (0x8a, 0x2a, 0x1e)),                                    # oxblood
}

# Hand-measured cuts (source-sheet rows) for sheets whose lower pose's hair is
# painted OVER the upper pose's straight bottom edge. The geodesic split gives
# that band to the upper pose, so the upper pose is cut just above the hair.
# The lower pose keeps a flat hair top there (the pixels are simply not in the
# art) — use it where the frame crops the top (thumbs, `cover` circles).
CUT_OVERRIDES: dict[str, dict[str, int]] = {
    "kenji": {"hero": 634},
}

POSTERS = {
    "loading-poster.webp": "newposter.png",
    "loading-poster-portrait.webp": "newposter_portrait.png",
}

# Output heights, matched to the existing hero-james (631x841) / hero-anne
# (725x807) cut-outs; the smaller poses are sized for cards and wire faces.
HERO_H = 840
POSE_H = 560
THUMB = 200
ALPHA_MIN = 16


def shift(a: np.ndarray, dy: int, dx: int) -> np.ndarray:
    out = np.zeros_like(a)
    h, w = a.shape
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = a[ys, xs]
    return out


def erode(m: np.ndarray) -> np.ndarray:
    return m & shift(m, 1, 0) & shift(m, -1, 0) & shift(m, 0, 1) & shift(m, 0, -1)


def label(m: np.ndarray) -> tuple[np.ndarray, dict[int, int]]:
    """4-connected components (BFS). Used on a downsampled mask only."""
    h, w = m.shape
    lab = np.zeros((h, w), np.int32)
    sizes: dict[int, int] = {}
    n = 0
    for y in range(h):
        row = m[y]
        for x in range(w):
            if not row[x] or lab[y, x]:
                continue
            n += 1
            lab[y, x] = n
            q = collections.deque([(y, x)])
            c = 0
            while q:
                cy, cx = q.popleft()
                c += 1
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n
                        q.append((ny, nx))
            sizes[n] = c
    return lab, sizes


def seeds_for(mask: np.ndarray, want: int = 4, step: int = 4) -> np.ndarray:
    """Erode until the mask splits into `want` big islands; return seed labels (full res)."""
    m = mask.copy()
    for _ in range(80):
        small = m[::step, ::step]
        lab, sizes = label(small)
        # "Big" is judged against what is LEFT after erosion, so a pose that
        # shrinks faster than its neighbours (a thin bust) still counts.
        left = max(1, sum(sizes.values()))
        big = [k for k, s in sizes.items() if s > left * 0.05]
        if len(big) >= want:
            big = sorted(big, key=lambda k: -sizes[k])[:want]
            full = np.zeros(mask.shape, np.int32)
            up = np.kron(lab, np.ones((step, step), np.int32))[: mask.shape[0], : mask.shape[1]]
            for i, k in enumerate(big, start=1):
                full[(up == k) & m] = i
            return full
        for _ in range(3):
            m = erode(m)
    raise SystemExit("could not separate the sheet into four figures")


def grow(seeds: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Geodesic dilation: every opaque pixel joins the nearest seed island."""
    lab = seeds.copy()
    for _ in range(400):
        free = (lab == 0) & mask
        if not free.any():
            break
        changed = False
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nb = shift(lab, dy, dx)
            take = free & (nb > 0)
            if take.any():
                lab[take] = nb[take]
                free &= ~take
                changed = True
        if not changed:
            break
    return lab


def quadrant_names(lab: np.ndarray, n: int) -> dict[str, int]:
    h, w = lab.shape
    names: dict[str, int] = {}
    for k in range(1, n + 1):
        ys, xs = np.nonzero(lab == k)
        cy, cx = ys.mean(), xs.mean()
        top = cy < h / 2
        left = cx < w / 2
        key = {(True, True): "hero", (True, False): "ghost", (False, True): "bust", (False, False): "think"}[(top, left)]
        if key in names:
            raise SystemExit(f"two figures landed in the {key} quadrant")
        names[key] = k
    return names


def bbox(lab: np.ndarray, k: int, alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero((lab == k) & (alpha > ALPHA_MIN))
    return int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1


def figure(rgba: np.ndarray, lab: np.ndarray, k: int, max_y: int | None = None) -> Image.Image:
    keep = lab == k
    if max_y is not None:
        # The upper pose ends in a straight cut; where the lower pose's hair is
        # painted OVER that cut (kenji), the band belongs to neither cleanly —
        # the upper pose is cut at the lower one's top so no hair rides along.
        keep[max_y:, :] = False
    out = rgba.copy()
    out[~keep] = 0
    ys, xs = np.nonzero(keep & (rgba[:, :, 3] > ALPHA_MIN))
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return Image.fromarray(out[y0:y1, x0:x1], "RGBA")


def fit_h(im: Image.Image, h: int) -> Image.Image:
    if im.height <= h:
        return im
    w = round(im.width * h / im.height)
    return im.resize((w, h), Image.LANCZOS)


def thumb(bust: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    """A square face crop over a flat colour — the head centred, the top kept."""
    a = np.array(bust)[:, :, 3] > ALPHA_MIN
    top = a[: max(1, int(bust.height * 0.45))]
    cols = np.nonzero(top.any(axis=0))[0]
    cx = int((cols.min() + cols.max()) / 2) if len(cols) else bust.width // 2
    side = int(min(bust.width, bust.height) * 0.86)
    x0 = max(0, min(bust.width - side, cx - side // 2))
    crop = bust.crop((x0, 0, x0 + side, side))
    card = Image.new("RGBA", crop.size, bg + (255,))
    card.alpha_composite(crop)
    return card.convert("RGB").resize((THUMB, THUMB), Image.LANCZOS)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default=os.path.join(ROOT, "assets", "avatars"))
    ap.add_argument("--poster-src", default=os.path.join(ROOT, "assets", "poster"))
    ap.add_argument("--out", default=os.path.join(ROOT, "src", "assets", "poster"))
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    for cid, (fname, bg) in SHEETS.items():
        path = os.path.join(args.src, fname)
        if not os.path.exists(path):
            print(f"skip {cid}: {path} missing", file=sys.stderr)
            continue
        rgba = np.array(Image.open(path).convert("RGBA"))
        mask = rgba[:, :, 3] > ALPHA_MIN
        lab = grow(seeds_for(mask), mask)
        names = quadrant_names(lab, 4)
        alpha = rgba[:, :, 3]
        cut = {
            "hero": bbox(lab, names["bust"], alpha)[0],
            "ghost": bbox(lab, names["think"], alpha)[0],
        }
        cut.update(CUT_OVERRIDES.get(cid, {}))
        figs = {k: figure(rgba, lab, v, cut.get(k)) for k, v in names.items()}
        outs = {
            f"hero-{cid}.webp": fit_h(figs["hero"], HERO_H),
            f"ghost-{cid}.webp": fit_h(figs["ghost"], POSE_H),
            f"bust-{cid}.webp": fit_h(figs["bust"], POSE_H),
            f"think-{cid}.webp": fit_h(figs["think"], POSE_H),
        }
        for name, im in outs.items():
            im.save(os.path.join(args.out, name), "WEBP", quality=88, method=6)
        thumb(figs["bust"], bg).save(os.path.join(args.out, f"thumb-{cid}.webp"), "WEBP", quality=88, method=6)
        print(cid, {k: v.size for k, v in outs.items()})

    for out_name, src_name in POSTERS.items():
        path = os.path.join(args.poster_src, src_name)
        if not os.path.exists(path):
            print(f"skip {out_name}: {path} missing", file=sys.stderr)
            continue
        im = Image.open(path).convert("RGB")
        im.save(os.path.join(args.out, out_name), "WEBP", quality=85, method=6)
        print(out_name, im.size, os.path.getsize(os.path.join(args.out, out_name)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
