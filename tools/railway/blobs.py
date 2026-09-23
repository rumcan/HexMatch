import numpy as np
from PIL import Image
from collections import deque
def blobs(path, k=4, thr=40, minpx=200):
    im = Image.open(path).convert("RGBA")
    a = np.array(im)[:, :, 3] > thr
    H, W = a.shape; h, w = H // k, W // k
    s = a[:h*k, :w*k].reshape(h, k, w, k).any(axis=(1, 3))
    lab = np.zeros((h, w), int); n = 0; boxes = []
    for y in range(h):
        for x in range(w):
            if s[y, x] and not lab[y, x]:
                n += 1; q = deque([(y, x)]); lab[y, x] = n; cnt = 0
                x0 = x1 = x; y0 = y1 = y
                while q:
                    cy, cx = q.popleft(); cnt += 1
                    x0 = min(x0, cx); x1 = max(x1, cx); y0 = min(y0, cy); y1 = max(y1, cy)
                    for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
                        ny, nx = cy+dy, cx+dx
                        if 0 <= ny < h and 0 <= nx < w and s[ny, nx] and not lab[ny, nx]:
                            lab[ny, nx] = n; q.append((ny, nx))
                if cnt >= minpx // (k*k) + 1:
                    boxes.append((cnt, n, (x0*k, y0*k, (x1+1)*k, (y1+1)*k)))
    return im, lab, k, boxes
if __name__ == "__main__":
    import sys
    im, lab, k, b = blobs(sys.argv[1])
    for x in sorted(b, reverse=True)[:10]: print(x)
