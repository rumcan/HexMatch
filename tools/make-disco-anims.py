"""Owner (2026-09-28): the disco ball (match 5) and the board-wipe explosion.

  python tools/make-disco-anims.py

Reads assets/gems-src/v3/anim/discoball.png (4 spin frames side by side) and
explosion.png (8 burst frames). Frames are found by the gaps between their
solid pixels (the explosion's glows touch, so it splits on opaque cores); every frame of a strip shares one square crop size and one
scale (centred), so the strip never jumps. Writes 256x256 PNGs to
src/assets/gems/anim/disco_{0..3}.png and burst_{0..7}.png.
"""
import os
import numpy as np
from PIL import Image

SRC = "assets/gems-src/v3/anim"
OUT = "src/assets/gems/anim"
SIZE = 256

def frames(path, n, solid=16):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)[:, :, 3]
    cols = np.where(a.max(0) > solid)[0]
    segs, s, p = [], cols[0], cols[0]
    for c in cols[1:]:
        if c - p > 2:
            segs.append((s, p)); s = c
        p = c
    segs.append((s, p))
    segs = sorted(segs, key=lambda x: x[1] - x[0], reverse=True)[:n]
    segs.sort()
    assert len(segs) == n, f"{path}: found {len(segs)} frames, wanted {n}"
    rows = np.where(a.max(1) > 16)[0]
    side = int(max(max(e - s + 1 for s, e in segs), rows[-1] - rows[0] + 1) * 1.04)
    cy = (rows[0] + rows[-1]) // 2
    out = []
    centres = [(s + e) // 2 for s, e in segs]
    for k, (s, e) in enumerate(segs):
        cx = centres[k]
        # never past the midpoint to a neighbour: its glow is not this frame's
        lo = (centres[k - 1] + cx) // 2 if k else 0
        hi = (centres[k + 1] + cx) // 2 if k + 1 < len(segs) else im.width
        x0 = cx - side // 2
        own = Image.new("RGBA", im.size)
        own.paste(im.crop((lo, 0, hi, im.height)), (lo, 0))
        # feather the cut so a clipped glow fades instead of ending in a wall
        arr = np.array(own).astype(np.float32)
        ramp = 24
        for x in range(lo, min(hi, lo + ramp)):
            if k: arr[:, x, 3] *= (x - lo) / ramp
        for x in range(max(lo, hi - ramp), hi):
            if k + 1 < len(segs): arr[:, x, 3] *= (hi - 1 - x) / ramp
        own = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
        sq = own.crop((x0, cy - side // 2, x0 + side, cy - side // 2 + side))
        out.append(sq.resize((SIZE, SIZE), Image.LANCZOS))
    return out

os.makedirs(OUT, exist_ok=True)
for i, f in enumerate(frames(os.path.join(SRC, "discoball.png"), 4)):
    f.save(os.path.join(OUT, f"disco_{i}.png"))
for i, f in enumerate(frames(os.path.join(SRC, "explosion.png"), 8, solid=200)):
    f.save(os.path.join(OUT, f"burst_{i}.png"))
print("disco 4, burst 8")
