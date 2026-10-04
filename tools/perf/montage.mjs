// node tools/perf/montage.mjs <zoom-suffix> x y w h v1 v2 v3 ... -> tools/perf/montage.png (crops side by side)
import sharp from "sharp";
const [z, x, y, w, h, ...vs] = process.argv.slice(2);
const crops = await Promise.all(vs.map((v) => sharp(`tools/perf/three-spike-${v}-z${z}.png`).extract({ left: +x, top: +y, width: +w, height: +h }).png().toBuffer()));
await sharp({ create: { width: +w * vs.length + 4 * (vs.length - 1), height: +h, channels: 3, background: "#f0f" } })
  .composite(crops.map((input, i) => ({ input, left: i * (+w + 4), top: 0 }))).png().toFile("tools/perf/montage.png");
