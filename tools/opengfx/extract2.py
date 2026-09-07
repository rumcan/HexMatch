#!/usr/bin/env python3
"""Cell extractor for OpenGFX source sheets (robust variant).

Finds blue-backed (#0000FF) sprite cells by column/row run detection with a
gap tolerance (sprite content touching a box edge splits the blue), then crops
each cell's content to its bounding box with a small transparent margin.

Output per sheet: <outdir>/<prefix>_NNN.png + a <prefix>_cells.txt listing
cell index, box, content bbox, and an ASCII thumbnail of the content so a
headless operator can pick sprites.

Usage: extract2.py <sheet.png> <outdir> --prefix name [--gap N] [--maxw 160]
"""
import sys, os
import numpy as np
from PIL import Image

def runs(idx, gap=1):
    out, s, p = [], idx[0], idx[0]
    for v in idx[1:]:
        if v > p + gap:
            out.append((s, p)); s = v
        p = v
    out.append((s, p))
    return out

def main():
    args = [a for a in sys.argv[1:]]
    gap = 8
    if "--gap" in args:
        i = args.index("--gap"); gap = int(args[i+1]); del args[i:i+2]
    if len(args) < 2:
        print(__doc__); sys.exit(1)
    sheet, outdir = args[0], args[1]
    prefix = "spr"
    if "--prefix" in args:
        i = args.index("--prefix"); prefix = args[i+1]
    im = Image.open(sheet).convert("RGB")
    a = np.asarray(im).astype(np.int16)
    blue = ((a[:, :, 0] == 0) & (a[:, :, 1] == 0) & (a[:, :, 2] == 255))
    os.makedirs(outdir, exist_ok=True)
    cols = np.where(blue.any(axis=0))[0]
    if not len(cols):
        print(f"no blue cells in {sheet}"); sys.exit(0)
    n = 0
    log = open(os.path.join(outdir, f"{prefix}_cells.txt"), "w")
    for (x0, x1) in runs(cols, gap=gap):
        strip = blue[:, x0:x1+1]
        # rows whose blue coverage is significant (excludes id-label text)
        cov = strip.mean(axis=1)
        rws = np.where(cov > 0.12)[0]
        if not len(rws):
            continue
        for (y0, y1) in runs(rws, gap=gap):
            w, h = x1 - x0 + 1, y1 - y0 + 1
            if w < 12 or h < 8:
                continue
            sub = a[y0:y1+1, x0:x1+1]
            is_blue = (sub[:, :, 0] == 0) & (sub[:, :, 1] == 0) & (sub[:, :, 2] == 255)
            # content = everything inside the box that is not blue
            content = ~is_blue
            # knock out stray non-blue specks smaller than 3px (anti-alias noise)
            from scipy import ndimage
            lab, k = ndimage.label(content, structure=np.ones((3, 3)))
            if k == 0:
                continue
            sizes = ndimage.sum(content, lab, range(1, k + 1))
            keep = np.isin(lab, np.where(sizes >= 3)[0] + 1)
            ys, xs = np.where(keep)
            c0, c1 = xs.min(), xs.max(); r0, r1 = ys.min(), ys.max()
            # margin of 1px around content
            m = 1
            r0, r1 = max(0, y0+r0-m), min(im.size[1]-1, y0+r1+m)
            c0, c1 = max(0, x0+c0-m), min(im.size[0]-1, x0+c1+m)
            n += 1
            cell = a[r0:r1+1, c0:c1+1]
            alpha = np.where((cell[:, :, 0] == 0) & (cell[:, :, 1] == 0) & (cell[:, :, 2] == 255), 0, 255).astype(np.uint8)
            rgba = np.dstack([cell.astype(np.uint8), alpha])
            out = Image.fromarray(rgba, "RGBA")
            out.save(os.path.join(outdir, f"{prefix}_{n:03d}.png"))
            box = (x0, y0, x1, y1)
            log.write(f"{n:3d} box=({x0},{y0})-({x1},{y1}) {w}x{h}  content={c1-c0+1}x{r1-r0+1} at ({c0},{r0})\n")
    log.close()
    print(f"{os.path.basename(sheet)}: {n} cells -> {outdir}/{prefix}_*.png")

if __name__ == "__main__":
    main()
