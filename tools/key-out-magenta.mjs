#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Key out a solid magenta (#FF00FF) background → transparent PNG.
//
// The image model renders building art on a UNIFORM pure magenta backdrop
// (prompt contract: "Solid uniform pure magenta background #FF00FF, no cast
// shadows on the background") because it cuts far cleaner edges than asking
// it for alpha directly. This chroma-keys it:
//
//   • the backdrop colour is ESTIMATED from the four image corners (the
//     model sometimes drifts a few % off pure magenta or adds a soft
//     vignette — keying the measured colour keeps those backgrounds clean);
//   • alpha = smoothstep of the pixel's normalised distance from that colour
//     (0 at the backdrop → 1 by ~45% of the full scale); warm vintage
//     building palettes sit ≥70% away, so only the backdrop and its blend
//     rim key out;
//   • edge pixels are decontaminated (un-blended against the backdrop) so no
//     pink fringing survives into the transparent rim.
//
// Usage: node tools/key-out-magenta.mjs <in.png> <out.png>
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { dirname, resolve } from "node:path";

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("usage: node tools/key-out-magenta.mjs <in.png> <out.png>");
  process.exit(2);
}

// normalised distance from the backdrop (0..1); alpha ramps between these
const INNER = 0.12, OUTER = 0.45;
const smooth = (t) => t * t * (3 - 2 * t);

const { data, info } = await sharp(inPath, { animated: false })
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

// estimate the backdrop from the four corner patches (8×8 each) — median RGB
const patch = (x0, y0) => {
  const px = [];
  for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) {
    const i = (y * info.width + x) * 4;
    px.push([data[i], data[i + 1], data[i + 2]]);
  }
  return px;
};
const cornerPx = [
  ...patch(0, 0), ...patch(info.width - 8, 0),
  ...patch(0, info.height - 8), ...patch(info.width - 8, info.height - 8),
];
const median = (ch) =>
  [...cornerPx.map((p) => p[ch])].sort((a, b) => a - b)[cornerPx.length >> 1];
const BG = [median(0), median(1), median(2)];
const scale = Math.sqrt(BG[0] * BG[0] + BG[1] * BG[1] + BG[2] * BG[2]) || 361;
const normDist = (r, g, b) => {
  const dr = r - BG[0], dg = g - BG[1], db = b - BG[2];
  return Math.sqrt(dr * dr + dg * dg + db * db) / scale;
};
const out = Buffer.from(data);
let keyed = 0, blended = 0, kept = 0;
for (let i = 0; i < data.length; i += 4) {
  const d = normDist(data[i], data[i + 1], data[i + 2]);
  if (d <= INNER) {
    out[i + 3] = 0;
    keyed++;
  } else if (d >= OUTER) {
    kept++;
  } else {
    const a = smooth((d - INNER) / (OUTER - INNER));
    // un-blend the magenta contribution: fg = (px - (1-a)·bg) / a
    for (let c = 0; c < 3; c++) {
      const fg = (data[i + c] - (1 - a) * BG[c]) / Math.max(a, 1e-3);
      out[i + c] = Math.max(0, Math.min(255, Math.round(fg)));
    }
    out[i + 3] = Math.round(a * 255);
    blended++;
  }
}

await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png({ compressionLevel: 9 })
  .toFile(resolve(outPath));
console.log(
  `${dirname(resolve(inPath))}/${inPath.split("/").pop()}: keyed ${keyed} bg px, feathered ${blended} edge px, kept ${kept} art px → ${outPath}`,
);
