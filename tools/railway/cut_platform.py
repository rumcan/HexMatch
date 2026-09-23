"""Cut the owner's single platform drawing (source/train-src/platform.png) into
the four platform sprites.

The drawing lies along the grid's y axis (screen up-right) with its brick face
toward +x, so it serves the "se" view (track at x+1) and, unchanged, "nw"
(track at x-1, behind it). Mirrored it lies along x: "sw" (track at y+1) and
"ne" (track at y-1). Footprint 1x3 / 3x1, anchored on the footprint's SOUTH
vertex (the art's own lowest solid point), width = the footprint diamond.
"""
import json, os
from PIL import Image, ImageOps

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "railway")
SRC = os.path.join(ROOT, "source", "train-src", "platform.png")
FOOT = {"se": (1, 3), "nw": (1, 3), "sw": (3, 1), "ne": (3, 1)}
MIRROR = {"se": False, "nw": False, "sw": True, "ne": True}
HW2 = 64  # half a tile width at 2x


def pad4(n): return (n + 3) // 4 * 4


src = Image.open(SRC).convert("RGBA")
solid = src.split()[3].point(lambda v: 255 if v > 96 else 0)
art0 = src.crop(solid.getbbox())
man_path = os.path.join(ROOT, "manifest.json")
man = json.load(open(man_path))

for view, (fx, fy) in FOOT.items():
    art = ImageOps.mirror(art0) if MIRROR[view] else art0
    a = art.split()[3]
    south_x = None
    for y in range(art.height - 1, -1, -1):
        xs = [x for x in range(art.width) if a.getpixel((x, y)) > 96]
        if xs:
            south_x = (min(xs) + max(xs)) / 2
            break
    base_w = (fx + fy) * HW2
    k = base_w / art.width
    img = art.resize((round(art.width * k), round(art.height * k)), Image.LANCZOS)
    w2, h2 = pad4(img.width), pad4(img.height)
    canvas = Image.new("RGBA", (w2, h2), (0, 0, 0, 0))
    ox = (w2 - img.width) // 2
    canvas.alpha_composite(img, (ox, h2 - img.height))
    ax2 = ox + round(south_x * k)
    ax2 -= ax2 % 2
    name = f"platform_{view}"
    canvas.save(os.path.join(ROOT, f"{name}@2x.png"))
    canvas.resize((w2 // 2, h2 // 2), Image.LANCZOS).save(os.path.join(ROOT, f"{name}@1x.png"))
    canvas.resize((w2 // 4, h2 // 4), Image.LANCZOS).save(os.path.join(ROOT, f"{name}@0.5x.png"))
    d = man["sprites"][name]
    d["w"], d["h"] = w2 // 2, h2 // 2
    d["anchor"] = [ax2 // 2, h2 // 2]
    d["box2x"] = [w2, h2]
    d["footprint"] = [fx, fy]
    d["note"] = f"platform {view}; owner-supplied art (source/train-src/platform.png{', mirrored' if MIRROR[view] else ''}), cut by tools/railway/cut_platform.py."
    al = canvas.split()[3]
    d["alpha"] = {"coverage": round(sum(1 for p in al.getdata() if p > 16) / (w2 * h2), 4), "corners": [0, 0, 0, 0]}
    print(name, (w2, h2), "anchor@1x", d["anchor"])

json.dump(man, open(man_path, "w"), indent=2)
