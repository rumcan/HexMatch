"""MATCH-2 (#566): slice the owner's gem animation + ice sheets into board sprites.

  python tools/make-gem-anims.py

Reads assets/gems-src/v3/anim/:
  "<cargo> animation.png"            4 frames side by side — the wiggle (hover, and the beat before a match)
  "<cargo> animation - explode.png"  4 frames — the burst as the gem is matched away
  semi-iced.png / full-iced.png       3x2 grid, same layout as the icon sheet
Writes src/assets/gems/anim/<cargo>_{wiggle,boom}_{0..3}.png and <cargo>_ice{1,2}.png, 256x256.
Every frame of one strip shares one crop and one scale, so the strip never jumps.
"""
import glob, os
from collections import deque
import numpy as np
from PIL import Image

SRC = "assets/gems-src/v3/anim"
OUT = "src/assets/gems/anim"
SIZE = 256
os.makedirs(OUT, exist_ok=True)
FILE_CARGO = {"wheat": "grain", "wood": "wood", "ore": "ore", "stone": "stone", "oil": "oil", "gold": "gold"}

def fit(img, box, pad=1.06):
    x0, y0, x1, y1 = box
    crop = img.crop((x0, y0, x1, y1))
    side = int(max(crop.size) * pad)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2), crop)
    return sq.resize((SIZE, SIZE), Image.LANCZOS)

for path in sorted(glob.glob(f"{SRC}/*animation*.png")):
    name = os.path.basename(path).lower()
    cargo = FILE_CARGO[name.split(" ")[0]]
    kind = "boom" if "explode" in name else "wiggle"
    im = Image.open(path).convert("RGBA")
    W, H = im.size
    cw = W // 4
    cells = [im.crop((i * cw, 0, (i + 1) * cw, H)) for i in range(4)]
    # one crop for the whole strip: the union of every frame's opaque box
    boxes = [c.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox() for c in cells]
    boxes = [b for b in boxes if b]
    u = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    for i, c in enumerate(cells):
        fit(c, u).save(f"{OUT}/{cargo}_{kind}_{i}.png", optimize=True)
    print(cargo, kind, "union", u)

def components(a):
    H, W = a.shape
    lab = np.zeros((H, W), np.int32); out = []; n = 0
    for y0 in range(H):
        for x0 in np.nonzero(a[y0] & (lab[y0] == 0))[0]:
            if lab[y0, x0]: continue
            n += 1; q = deque([(y0, x0)]); lab[y0, x0] = n; sx = sy = k = 0
            while q:
                y, x = q.popleft(); sx += x; sy += y; k += 1
                for dy, dx in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < H and 0 <= xx < W and a[yy, xx] and not lab[yy, xx]:
                        lab[yy, xx] = n; q.append((yy, xx))
            out.append((n, sx / k, sy / k, k))
    return lab, out

GRID = [["grain", "oil", "stone"], ["wood", "ore", "gold"]]
for fname, level in (("semi-iced.png", 1), ("full-iced.png", 2)):
    im = Image.open(f"{SRC}/{fname}").convert("RGBA")
    A = np.array(im); W, H = im.size
    lab, comps = components(A[:, :, 3] > 24)
    for r in range(2):
        for c in range(3):
            ids = [i for i, cx, cy, k in comps if c * W / 3 <= cx < (c + 1) * W / 3 and r * H / 2 <= cy < (r + 1) * H / 2 and k >= 12]
            keep = np.isin(lab, ids)
            soft = (A[:, :, 3] > 0) & (A[:, :, 3] <= 24)
            grow = keep.copy()
            grow[1:] |= keep[:-1]; grow[:-1] |= keep[1:]; grow[:, 1:] |= keep[:, :-1]; grow[:, :-1] |= keep[:, 1:]
            mask = keep | (soft & grow)
            B = A.copy(); B[~mask] = 0
            ys, xs = np.nonzero(keep)
            fit(Image.fromarray(B), (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), pad=1.0 / 0.9).save(f"{OUT}/{GRID[r][c]}_ice{level}.png", optimize=True)
    print(fname, "sliced")
