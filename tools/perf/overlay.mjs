// node tools/perf/overlay.mjs <variant-a> <variant-b> [zoom] [x y w h]  -> tools/perf/overlay.png
// 50/50 blend of two perf-script screenshots of the same camera (e.g. 2d vs three-models), optionally cropped.
import sharp from "sharp";
const [a, b, z = "2", ...box] = process.argv.slice(2);
const A = `tools/perf/three-spike-${a}-z${z}.png`, B = `tools/perf/three-spike-${b}-z${z}.png`;
const half = await sharp(B).removeAlpha().ensureAlpha(0.5).png().toBuffer();
let img = sharp(A).composite([{ input: half }]);
let buf = await img.png().toBuffer();
if (box.length === 4) { const [x, y, w, h] = box.map(Number); buf = await sharp(buf).extract({ left: x, top: y, width: w, height: h }).resize({ width: w * 2, kernel: "nearest" }).png().toBuffer(); }
await sharp(buf).toFile("tools/perf/overlay.png");
