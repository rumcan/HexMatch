#!/usr/bin/env python3
"""Terrain-GL textures: raw generations -> seamless runtime PNGs.

    python tools/terrain/make_seamless.py tools/art-src/terrain src/assets/terrain

For each <name>-raw.png it writes <name>_512.png (detail -> detail_256.png):
  1. centre-crop to a square, resize to 1024;
  2. make it tile: blend the image with a half-offset copy of itself through a
     feathered cross mask, so every edge pixel comes from the interior of the
     copy that is continuous across the wrap;
  3. optional colour anchoring (grass / sand means from docs/ART_PIPELINE.md);
  4. detail: desaturate and re-centre the mean on 128 grey (it is applied as
     an overlay, so any tint would shift the whole ground).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ANCHORS = {"grass": (0x35, 0x43, 0x12), "sand": (0xCD, 0xBB, 0x95)}


def square(im: Image.Image, size: int) -> np.ndarray:
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))
    return np.asarray(im.convert("RGB").resize((size, size), Image.LANCZOS), dtype=np.float32)


def make_tileable(a: np.ndarray, feather: float = 0.22) -> np.ndarray:
    n = a.shape[0]
    shifted = np.roll(np.roll(a, n // 2, axis=0), n // 2, axis=1)
    t = np.linspace(0.0, 1.0, n)
    d = np.minimum(t, 1.0 - t)                        # 0 at the edge, 0.5 in the middle
    ramp = np.clip(d / feather, 0.0, 1.0)             # 0 at the edge -> 1 inside
    ramp = ramp * ramp * (3 - 2 * ramp)               # smoothstep
    mask = np.minimum.outer(ramp, ramp)[..., None]    # 1 = original, 0 = shifted copy
    return a * mask + shifted * (1.0 - mask)


def anchor(a: np.ndarray, target) -> np.ndarray:
    mean = a.reshape(-1, 3).mean(axis=0)
    return np.clip(a + (np.array(target, dtype=np.float32) - mean) * 0.8, 0, 255)


def main(src_dir: str, out_dir: str) -> None:
    src, out = Path(src_dir), Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    for raw in sorted(src.glob("*-raw.png")):
        name = raw.name[: -len("-raw.png")]
        a = make_tileable(square(Image.open(raw), 1024))
        if name in ANCHORS:
            a = anchor(a, ANCHORS[name])
        if name == "detail":
            g = a.mean(axis=2)
            g = np.clip(g - g.mean() + 128.0, 0, 255)
            img = Image.fromarray(g.astype(np.uint8), "L").convert("RGB").resize((256, 256), Image.LANCZOS)
            img.save(out / "detail_256.png", optimize=True)
            print("detail_256.png")
            continue
        Image.fromarray(a.astype(np.uint8), "RGB").resize((512, 512), Image.LANCZOS).save(out / f"{name}_512.png", optimize=True)
        print(f"{name}_512.png")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
