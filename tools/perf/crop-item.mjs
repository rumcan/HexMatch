// node tools/perf/crop-item.mjs <sprite> [zoom] [suffix] [index]: 2d | 3d | empty crops around one building -> tools/perf/montage.png
import fs from "node:fs";
import sharp from "sharp";
const [sprite, z = "2", suf = "", idx = "0"] = process.argv.slice(2);
const mf = JSON.parse(fs.readFileSync("assets/buildings/manifest.json", "utf8")).sprites;
const { cam, items } = JSON.parse(fs.readFileSync(`tools/perf/three-spike-items-z${z}${suf}.json`, "utf8"));
const list = items.filter((i) => i.sprite === sprite);
const it = list[+idx]; const [w, h] = mf[sprite]?.footprint ?? [2, 2];
const X = it.tx + w / 2, Z = it.ty + h / 2;
const cx = Math.round((X - Z) * 32 * cam.zoom + cam.x), cy = Math.round((X + Z) * 16 * cam.zoom + cam.y);
const rw = Math.round((w + h) * 40 * cam.zoom), rh = Math.round((w + h) * 40 * cam.zoom);
const box = { left: Math.max(0, cx - rw), top: Math.max(0, cy - rh), width: rw * 2, height: rh * 2 };
const crops = await Promise.all(["2d", "three-models", "empty"].map((v) => sharp(`tools/perf/three-spike-${v}-z${z}${suf}.png`).extract(box).png().toBuffer()));
await sharp({ create: { width: box.width * 3 + 8, height: box.height, channels: 3, background: "#f0f" } })
  .composite(crops.map((input, i) => ({ input, left: i * (box.width + 4), top: 0 }))).png().toFile("tools/perf/montage.png");
console.log(sprite, w + "x" + h, "centre", cx, cy, "of", list.length);
