#!/usr/bin/env python3
"""
Extract individual sprites from OpenGFX source sheets into transparent PNGs.

OpenGFX sheets lay sprites out as blue-backed (#0000FF) boxes on a white page,
with a sprite id label above each. This finds each box, keys out the blue,
crops to content, and writes a PNG with alpha.

Usage: python3 extract.py <sheet.png> <outdir> [--prefix name]
"""
import sys, os
import numpy as np
from PIL import Image

BLUE = (0, 0, 255)
WHITE = (255, 255, 255)


def runs(idx, gap=1):
    """Group a sorted index array into (start, end) runs.

    `gap` is how far apart two indices may be and still count as one run.
    Sprite content that touches the edge of its blue box splits the blue into
    several pieces, so a gap tolerance is needed to stitch one box back
    together -- while still keeping separately stacked boxes apart.
    """
    out, s, p = [], idx[0], idx[0]
    for v in idx[1:]:
        if v > p + gap:
            out.append((s, p))
            s = v
        p = v
    out.append((s, p))
    return out


def extract(sheet_path, outdir, prefix=None):
    im = Image.open(sheet_path).convert("RGB")
    a = np.array(im)
    # Sprite boxes are blue-backed rectangles. Define boxes by the blue itself,
    # NOT by "not white" -- the id labels above each box are also not-white and
    # would otherwise be merged into the sprite's bounding box. Note a sprite
    # may legitimately contain white pixels (white factory walls), so white is
    # only page background *outside* a box, never inside one.
    box = (a[:, :, 0] == 0) & (a[:, :, 1] == 0) & (a[:, :, 2] == 255)

    cols = np.where(box.any(axis=0))[0]
    if len(cols) == 0:
        print(f"  no sprites found in {sheet_path}")
        return 0

    os.makedirs(outdir, exist_ok=True)
    base = prefix or os.path.splitext(os.path.basename(sheet_path))[0]
    n = 0

    for (x0, x1) in runs(cols, gap=8):
        strip = box[:, x0:x1 + 1]
        # Require a row to be meaningfully blue to count as part of a box. The
        # sprite id label printed just above each box has almost no blue in it,
        # so a coverage threshold keeps the label out of the crop -- a plain
        # .any() would pull it in via the gap tolerance below.
        rws = np.where(strip.mean(axis=1) > 0.15)[0]
        if len(rws) == 0:
            continue
        # a column strip can hold several stacked sprite boxes
        for (y0, y1) in runs(rws, gap=8):
            w, h = x1 - x0 + 1, y1 - y0 + 1
            if w < 8 or h < 8:
                continue  # id labels and stray text

            sub = a[y0:y1 + 1, x0:x1 + 1]
            is_blue = (sub[:, :, 0] == 0) & (sub[:, :, 1] == 0) & (sub[:, :, 2] == 255)

            rgba = np.dstack([sub, np.where(is_blue, 0, 255).astype(np.uint8)])
            out = Image.fromarray(rgba, "RGBA")
            bbox = out.getbbox()  # crop to the non-transparent content
            if bbox is None:
                continue
            out = out.crop(bbox)

            n += 1
            out.save(os.path.join(outdir, f"{base}_{n:03d}.png"))

    print(f"  {os.path.basename(sheet_path)}: {n} sprites")
    return n


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    prefix = None
    if "--prefix" in sys.argv:
        i = sys.argv.index("--prefix")
        prefix = sys.argv[i + 1]
    extract(sys.argv[1], sys.argv[2], prefix)
