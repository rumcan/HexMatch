"""Cut the owner's single platform drawing (source/train-src/platform.png) into
the four platform sprites.

The drawing is not quite the game's 2:1 isometric: its long edge climbs at
~0.37 instead of 0.5 and its short edge at ~0.54. A vertical shear plus a small
vertical stretch (x' = x, y' = C*x + D*y) puts both base edges on the game's
angles and keeps every post and lamp vertical. It is then scaled so the long
edge spans three tiles.

The platform is ~7:1, so it fills only part of its 1-deep footprint. It is
pushed against whichever long side carries the track, so the train stops right
at its edge:

  se  lies along y, track at x+1 — the drawing as is (brick face to the track)
  nw  lies along y, track at x-1 — the same drawing, its back to the track
  sw  lies along x, track at y+1 — mirrored (brick face to the track)
  ne  lies along x, track at y-1 — mirrored, its back to the track
"""
import json, os
from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "railway")
SRC = os.path.join(ROOT, "source", "train-src", "platform.png")
HW, HH = 32, 16          # half a tile at 1x
Z = 2                    # master resolution

# Base (ground-level plinth) corners measured on the source drawing.
FRONT_NEAR = (250.0, 850.0)   # brick-face side, stairs end
BACK_NEAR = (55.0, 745.0)     # far side, stairs end
FRONT_FAR = (1700.0, 320.0)   # brick-face side, far end

# Solve y' = C*x + D*y so both base edges get the game's 0.5 slope.
lx, ly = FRONT_FAR[0] - FRONT_NEAR[0], FRONT_FAR[1] - FRONT_NEAR[1]   # long edge
dx, dy = BACK_NEAR[0] - FRONT_NEAR[0], BACK_NEAR[1] - FRONT_NEAR[1]   # depth edge
# C*lx + D*ly = -0.5*lx ; C*dx + D*dy = 0.5*dx
det = lx * dy - ly * dx
C = (-0.5 * lx * dy - ly * 0.5 * dx) / det
D = (lx * 0.5 * dx + 0.5 * lx * dx) / det
S = Z * 3 * HW / lx


def pad4(n): return (n + 3) // 4 * 4


src = Image.open(SRC).convert("RGBA")
W0, H0 = src.size
# Output of the linear map for the source corners, to size the canvas.
def lin(p): return (S * p[0], S * (C * p[0] + D * p[1]))
corners = [lin(p) for p in [(0, 0), (W0, 0), (0, H0), (W0, H0)]]
minx, miny = min(c[0] for c in corners), min(c[1] for c in corners)
maxx, maxy = max(c[0] for c in corners), max(c[1] for c in corners)
Wt, Ht = int(maxx - minx) + 2, int(maxy - miny) + 2
# PIL affine takes the INVERSE map: source = A * (dest + offset).
# dest x = S*x - minx ; dest y = S*(C x + D y) - miny
# => x = (X + minx)/S ; y = ((Y + miny)/S - C*x)/D
a = 1 / S
inv = (a, 0, minx * a,
       -C / (D * S), 1 / (D * S), (miny / S - C * minx / S) / D)
warped = src.transform((Wt, Ht), Image.AFFINE, inv, resample=Image.BICUBIC)
bbox = warped.split()[3].point(lambda v: 255 if v > 24 else 0).getbbox()
warped = warped.crop(bbox)
off = (minx + bbox[0], miny + bbox[1])


def at(p):
    q = lin(p)
    return (q[0] - off[0], q[1] - off[1])


fn, bn = at(FRONT_NEAR), at(BACK_NEAR)
man_path = os.path.join(ROOT, "manifest.json")
man = json.load(open(man_path))

for view in ("se", "nw", "sw", "ne"):
    mirror = view in ("sw", "ne")
    img = ImageOps.mirror(warped) if mirror else warped
    mx = (lambda x: img.width - x) if mirror else (lambda x: x)
    # The ground point that must land on the footprint's SOUTH vertex.
    if view == "se":        # front-near corner IS the south vertex (1,3)
        ax, ay = mx(fn[0]), fn[1]
    elif view == "nw":      # back-near corner sits on the west vertex (0,3) = south + (-HW,-HH)
        ax, ay = mx(bn[0]) + HW * Z, bn[1] + HH * Z
    elif view == "sw":      # mirrored front-near corner is the south vertex (3,1)
        ax, ay = mx(fn[0]), fn[1]
    else:                   # ne: mirrored back-near corner on the east vertex (3,0) = south + (HW,-HH)
        ax, ay = mx(bn[0]) - HW * Z, bn[1] + HH * Z
    # Canvas: the art, padded so the anchor lies inside and sizes are /4.
    left = max(0, -int(ax) + 2)
    top = 0
    w2 = pad4(max(img.width + left, int(ax) + left + 4))
    h2 = pad4(max(img.height, int(ay) + 4))
    canvas = Image.new("RGBA", (w2, h2), (0, 0, 0, 0))
    canvas.alpha_composite(img, (left, top))
    ax2, ay2 = round(ax) + left, round(ay)
    ax2 -= ax2 % 2
    ay2 -= ay2 % 2
    name = f"platform_{view}"
    canvas.save(os.path.join(ROOT, f"{name}@2x.png"))
    canvas.resize((w2 // 2, h2 // 2), Image.LANCZOS).save(os.path.join(ROOT, f"{name}@1x.png"))
    canvas.resize((w2 // 4, h2 // 4), Image.LANCZOS).save(os.path.join(ROOT, f"{name}@0.5x.png"))
    d = man["sprites"][name]
    d["w"], d["h"] = w2 // 2, h2 // 2
    d["anchor"] = [ax2 // 2, ay2 // 2]
    d["box2x"] = [w2, h2]
    d["footprint"] = [1, 3] if view in ("se", "nw") else [3, 1]
    d["note"] = (f"platform {view}; owner art (source/train-src/platform.png"
                 f"{', mirrored' if mirror else ''}), squared to 2:1 by tools/railway/cut_platform.py.")
    al = canvas.split()[3]
    d["alpha"] = {"coverage": round(sum(1 for p in (al.get_flattened_data() if hasattr(al, "get_flattened_data") else al.getdata()) if p > 16) / (w2 * h2), 4),
                  "corners": [0, 0, 0, 0]}
    print(name, (w2, h2), "anchor@1x", d["anchor"])

json.dump(man, open(man_path, "w"), indent=2)
print("shear C=%.4f stretch D=%.4f scale=%.4f" % (C, D, S))
