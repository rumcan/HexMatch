"""Cut the owner's 4-up platform sheet into the railway's platform sprites.

Quadrant -> view (long axis + track side, matched against the old art):
  TL -> sw (2x3), BR -> ne (2x3), TR -> nw (3x2), BL -> se (3x2)
Each sprite: alpha-bbox crop, scaled so the base spans the footprint diamond
((fx+fy) * 64 px wide at 2x), padded to multiples of 4, anchored on the
footprint's SOUTH vertex (fx * 64 px from the left edge, the bottom row).
"""
import json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "railway")
src = Image.open(os.path.join(ROOT, "source/platforms-source.webp")).convert("RGBA")
W, H = src.size
half = (W // 2, H // 2)
quads = {
    "sw": (0, 0, half[0], half[1]),
    "nw": (half[0], 0, W, half[1]),
    "se": (0, half[1], half[0], H),
    "ne": (half[0], half[1], W, H),
}
FOOT = {"ne": (2, 3), "sw": (2, 3), "se": (3, 2), "nw": (3, 2)}
TW2 = 128  # tile width at 2x

man_path = os.path.join(ROOT, "manifest.json")
man = json.load(open(man_path))

def pad4(n): return (n + 3) // 4 * 4

for view, box in quads.items():
    q = src.crop(box)
    # bbox on SOLID pixels only: faint shadow haze under the art would push
    # the south vertex (and so the anchor) below the building's real base.
    solid = q.split()[3].point(lambda v: 255 if v > 96 else 0)
    bb = solid.getbbox()
    q = q.crop(bb)
    # drop the haze outside the solid box edges too
    qa = q.split()[3].point(lambda v: 0 if v < 24 else v)
    q.putalpha(qa)
    # the SOUTH vertex: the lowest solid pixel's x (the art's own base corner)
    sa = q.split()[3]
    south_x = None
    for y in range(q.height - 1, -1, -1):
        xs = [x for x in range(q.width) if sa.getpixel((x, y)) > 96]
        if xs:
            south_x = (min(xs) + max(xs)) / 2
            break
    fx, fy = FOOT[view]
    base_w = (fx + fy) * TW2 // 2
    k = base_w / q.width
    art = q.resize((round(q.width * k), round(q.height * k)), Image.LANCZOS)
    w2, h2 = pad4(art.width), pad4(art.height)
    canvas = Image.new("RGBA", (w2, h2), (0, 0, 0, 0))
    ox = (w2 - art.width) // 2
    canvas.alpha_composite(art, (ox, h2 - art.height))
    # anchor at 2x: the art's OWN south corner (lowest solid pixel), bottom row
    ax2 = ox + round(south_x * k)
    ax2 -= ax2 % 2                      # even 2x pixel so 1x/0.5x scale exactly
    ay2 = h2
    name = f"platform_{view}"
    for z in (2, 1, 0.5):
        im = canvas if z == 2 else canvas.resize((round(w2 * z / 2), round(h2 * z / 2)), Image.LANCZOS)
        tag = "2x" if z == 2 else ("1x" if z == 1 else "0.5x")
        im.save(os.path.join(ROOT, f"{name}@{tag}.png"))
    d = man["sprites"][name]
    d["w"], d["h"] = w2 // 2, h2 // 2
    d["anchor"] = [ax2 // 2, ay2 // 2]
    d["box2x"] = [w2, h2]
    d["footprint"] = [fx, fy]
    d["note"] = f"platform {view}; owner-supplied art (assets/railway/source/platforms-source.webp), cut by tools."
    a = canvas.split()[3]
    d["alpha"] = {"coverage": round(sum(1 for p in a.getdata() if p > 16) / (w2 * h2), 4), "corners": [0, 0, 0, 0]}
    print(name, (w2, h2), "anchor@1x", d["anchor"])

json.dump(man, open(man_path, "w"), indent=2)
