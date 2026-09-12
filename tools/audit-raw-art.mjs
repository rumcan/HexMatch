#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ART-1950S — raw-art audit before fitting.
//
// Measures, per raw generation (magenta backing, no alpha):
//   • background keying by corner colour (distance band 90, index only —
//     the raw file is NOT modified)
//   • alpha bbox
//   • parcel diamond slopes: the left and right silhouette edges from the
//     widest row down to the bottom, least-squares dy/dx. A true 2:1 dimetric
//     parcel edge has |slope| = 0.5. Values in 0.42–0.58 are the 2:1 family;
//     >=0.65 means a squished/"true isometric" (30°) diamond; <=0.35 too flat.
//   • light proxy: mean luma of the left vs right 25% strips (heuristic only;
//     intrinsic material colours confound it — always confirm visually).
//
// Usage:
//   node tools/audit-raw-art.mjs /tmp/raw-art/town_flats_v2.png [...]
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!files.length) {
  console.error("usage: node tools/audit-raw-art.mjs <raw.png...>");
  process.exit(1);
}
const DIST = 90;

/** least-squares dy/dx over points (x, y) */
function slope(pts) {
  const n = pts.length;
  if (n < 4) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  return (n * sxy - sx * sy) / den;      // dy/dx
}

for (const file of files) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const px = (x, y) => {
    const i = (y * W + x) * C;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const bg = px(2, 2);
  const isArt = (x, y) => {
    const [r, g, b] = px(x, y);
    return Math.hypot(r - bg[0], g - bg[1], b - bg[2]) > DIST;
  };

  let minX = W, minY = H, maxX = -1, maxY = -1;
  const rowL = new Int32Array(H).fill(-1), rowR = new Int32Array(H).fill(-1);
  let lumaL = 0, lumaR = 0, nL = 0, nR = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!isArt(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (rowL[y] < 0) rowL[y] = x;
      rowR[y] = x;
    }
  }
  if (maxX < 0) { console.log(JSON.stringify({ file, error: "empty after keying" })); continue; }
  const bw = maxX - minX + 1;
  // strips: left 25% / right 25% of the bbox
  const lEnd = minX + Math.floor(bw * 0.25), rStart = maxX - Math.floor(bw * 0.25);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x < lEnd; x++) {
      if (!isArt(x, y)) continue;
      const [r, g, b] = px(x, y); lumaL += 0.299 * r + 0.587 * g + 0.114 * b; nL++;
    }
    for (let x = rStart; x <= maxX; x++) {
      if (!isArt(x, y)) continue;
      const [r, g, b] = px(x, y); lumaR += 0.299 * r + 0.587 * g + 0.114 * b; nR++;
    }
  }
  // parcel edges: from the widest row in the bottom 40% down to the bbox bottom
  const yTop = minY + Math.floor((maxY - minY) * 0.6);
  let widest = -1, widestY = yTop;
  for (let y = yTop; y <= maxY; y++) {
    if (rowL[y] < 0) continue;
    const w = rowR[y] - rowL[y];
    if (w > widest) { widest = w; widestY = y; }
  }
  const leftPts = [], rightPts = [];
  for (let y = widestY; y <= maxY; y++) {
    if (rowL[y] < 0) continue;
    leftPts.push([rowL[y], y]);
    rightPts.push([rowR[y], y]);
  }
  const slopeL = slope(leftPts), slopeR = slope(rightPts);
  const ok = (s) => (s === null ? null : Math.abs(s) >= 0.42 && Math.abs(s) <= 0.58);
  console.log(JSON.stringify({
    file,
    bbox: [minX, minY, bw, maxY - minY + 1],
    slopeL: slopeL === null ? null : +slopeL.toFixed(3),
    slopeR: slopeR === null ? null : +slopeR.toFixed(3),
    diamondOK: ok(slopeL) && ok(slopeR),
    lumaL: nL ? +(lumaL / nL).toFixed(1) : null,
    lumaR: nR ? +(lumaR / nR).toFixed(1) : null,
    lightProxy: nL && nR ? (lumaL / nL > lumaR / nR ? "left-brighter (expected)" : "RIGHT-brighter (check shadows!)") : null,
  }, null, 0));
}
