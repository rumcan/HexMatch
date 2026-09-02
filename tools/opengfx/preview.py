#!/usr/bin/env python3
"""ASCII-preview extracted PNGs so sprite choice is verifiable headlessly.

Usage: preview.py <file.png> [max_w] [max_h]  (downscales, prints sizes + ASCII)
"""
import sys, os
import numpy as np
from PIL import Image

CHARS = " .:-=+*#%@"

def preview(path, max_w=110, max_h=42):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im).astype(np.float32)
    if a.ndim == 2:
        a = np.stack([a, a, a, np.full(a.shape, 255)], axis=2)
    if a.shape[2] == 3:
        a = np.dstack([a, np.full(a.shape[:2] + (1,), 255)])
    alpha = a[..., 3:4] / 255.0
    lum = (a[..., :3] * np.array([0.2126, 0.7152, 0.0722])).sum(axis=2, keepdims=True) / 255.0
    # background (transparent) shows as '.', content luminance maps to chars
    gray = np.where(alpha > 0.5, lum, 1.0)
    gray = (1.0 - gray)  # dark content -> dense chars
    h, w = gray.shape
    # fit into max_w x max_h maintaining aspect (iso sprites are 2:1, fine)
    scale = min(max_w / w, max_h / h)
    if scale < 1:
        nh, nw = max(1, int(h * scale)), max(1, int(w * scale))
        # simple box downscale
        g = gray.reshape(h // max(1, int(1 / scale)) * 0 + h, w)  # placeholder
        small = np.zeros((nh, nw))
        for y in range(nh):
            y0, y1 = int(y / nh * h), int((y + 1) / nh * h)
            for x in range(nw):
                x0, x1 = int(x / nw * w), int((x + 1) / nw * w)
                small[y, x] = gray[y0:y1, x0:x1].mean()
    else:
        small = gray
    print(f"  {os.path.basename(path)}  {w}x{h}")
    for row in small:
        print("  " + "".join(CHARS[min(9, int(v * 10))] for v in row))
    print()

if __name__ == "__main__":
    files = sys.argv[1:]
    for f in files:
        if os.path.isdir(f):
            for name in sorted(os.listdir(f)):
                if name.endswith(".png"):
                    preview(os.path.join(f, name))
        else:
            preview(f)
