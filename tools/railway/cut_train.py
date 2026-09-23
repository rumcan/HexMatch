"""Slice the owner's train sheets (assets/railway/source/train-src) into one
sprite per car kind per heading, mirroring for the headings not drawn.

Headings are SCREEN compass: e/w (side view), n/s (top view), ne/se/sw/nw
(three-quarter view, = the grid's NE/SE/SW/NW directions).
"""
import json, os, sys
import numpy as np
from PIL import Image, ImageOps
sys.path.insert(0, os.path.dirname(__file__))
from blobs import blobs

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = REPO + "/assets/railway/source/train-src"
OUT = REPO + "/assets/railway"
MAN = OUT + "/manifest.json"

# per sheet: heading, mirror heading, and the car kinds in reading order
SHEETS = {
    "train_e-w.png":   ("e", "w", ["box", "tank", "flat", "box2", "tender", "loco"]),
    "train_N-S.png":   ("s", None, ["loco", "tender", "box", "flat", "tank", "box2"]),
    "train_S-N.png":   ("n", None, ["loco", "tender", "box", "flat", "tank", "box2"]),
    "train_ne-sw.png": ("sw", "se", ["loco", "tender", "box", "flat", "tank", "box2"]),
    "train_sw-ne.png": ("nw", "ne", ["loco", "tender", "box", "tank", "flat", "box2"]),
}
SIZE = 0.75            # owner call (2026-09): trains 25% smaller than first cut
BOX_LEN = 0.8 * SIZE   # a boxcar's length in railway tiles (the pitch unit)
WIDTH_T = 0.42 * SIZE  # car width, tiles
ROOF_PX = 11 * SIZE    # roof height above the footprint at 1x
HW, HH = 32, 16

def reading_order(boxes):
    rows = []
    for b in sorted(boxes, key=lambda b: b[2][1]):
        for r in rows:
            if abs(r[0][2][1] - b[2][1]) < 150 and abs(r[0][2][3] - b[2][3]) < 250: r.append(b); break
        else: rows.append([b])
    if len(rows) > 2:            # the diagonal chain: one row, left to right
        return sorted(boxes, key=lambda b: b[2][0])
    return [b for r in rows for b in sorted(r, key=lambda b: b[2][0])]

def cut(sheet):
    im, lab, k, boxes = blobs(os.path.join(SRC, sheet))
    boxes = sorted(boxes, reverse=True)[:6]
    arr = np.array(im)
    cars = {}
    for kind, (cnt, n, (x0, y0, x1, y1)) in zip(SHEETS[sheet][2], reading_order(boxes)):
        m = (lab == n).repeat(k, 0).repeat(k, 1)
        full = np.zeros(arr.shape[:2], bool); full[:m.shape[0], :m.shape[1]] = m
        # grow the blob mask a little so anti-aliased edges survive
        g = full.copy()
        for dy in (-k, 0, k):
            for dx in (-k, 0, k): g |= np.roll(np.roll(full, dy, 0), dx, 1)
        a = arr.copy(); a[~g, 3] = 0
        piece = Image.fromarray(a)
        bb = Image.fromarray((a[:, :, 3] > 40).astype(np.uint8) * 255).getbbox()
        cars[kind] = piece.crop(bb)
    return cars

def pad4(n): return (n + 3) // 4 * 4

man = json.load(open(MAN))
# retire the procedural locomotive/wagon pair
for name in list(man["sprites"]):
    if man["sprites"][name].get("kind") in ("locomotive", "wagon"):
        del man["sprites"][name]
        for z in ("2x", "1x", "0.5x"):
            p = f"{OUT}/{name}@{z}.png"
            if os.path.exists(p): os.remove(p)

# car lengths (tiles) from the side view, boxcar = BOX_LEN
side = cut("train_e-w.png")
lens = {kd: round(BOX_LEN * side[kd].width / side["box"].width, 3) for kd in ("loco", "tender", "box", "tank", "flat")}
print("lengths", lens)

def targets(h, boxart):
    """(sx, sy, anchor-y fraction) at 1x for a sheet whose boxcar crop is `boxart`."""
    if h in ("e", "w"):
        s = BOX_LEN * 2 * HW / 2 ** 0.5 / boxart.width
        return s, s, 0.80
    if h in ("n", "s"):
        return WIDTH_T * 2 * HW / 2 ** 0.5 / boxart.width, (BOX_LEN * 2 * HH / 2 ** 0.5 + ROOF_PX) / boxart.height, 0.68
    s = (BOX_LEN + WIDTH_T) * HW / boxart.width
    return s, s, 0.66

made = 0
for sheet, (h, mh, _) in SHEETS.items():
    cars = cut(sheet)
    sx, sy, ay = targets(h, cars["box"])
    for heading, flip in ((h, False), (mh, True)):
        if heading is None: continue
        for kind in ("loco", "tender", "box", "tank", "flat"):
            art = cars[kind]
            if flip: art = ImageOps.mirror(art)
            w2, h2 = max(2, round(art.width * sx * 2)), max(2, round(art.height * sy * 2))
            img = art.resize((w2, h2), Image.LANCZOS)
            W2, H2 = pad4(w2 + 4), pad4(h2 + 4)
            canvas = Image.new("RGBA", (W2, H2), (0, 0, 0, 0))
            ox, oy = (W2 - w2) // 2, (H2 - h2) // 2
            canvas.alpha_composite(img, (ox, oy))
            name = f"car-{kind}_{heading}"
            for z, tag in ((2, "2x"), (1, "1x"), (0.5, "0.5x")):
                out = canvas if z == 2 else canvas.resize((W2 * z // 2 if z == 1 else W2 // 4, H2 // 2 if z == 1 else H2 // 4), Image.LANCZOS)
                out.save(f"{OUT}/{name}@{tag}.png")
            man["sprites"][name] = {
                "name": name, "kind": "car", "car": kind, "view": heading,
                "w": W2 // 2, "h": H2 // 2,
                "anchor": [W2 // 4, round((oy + h2 * ay) / 2)],
                "footprint": [1, 1], "moving": True, "box2x": [W2, H2],
                "lenTiles": lens[kind], "widthTiles": WIDTH_T,
                "note": f"{kind} heading {heading}; owner-supplied art ({sheet}{', mirrored' if flip else ''}), cut by tools.",
            }
            made += 1
json.dump(man, open(MAN, "w"), indent=2)
print("sprites", made)
