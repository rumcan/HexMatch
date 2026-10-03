// node tools/perf/align.mjs [zoom] [suffix]: how far is the 3D building silhouette from the 2D one?
// Needs the 2d, three-models and empty screenshots of the same camera (tools/perf/three-spike.mjs).
import sharp from "sharp";
const z = process.argv[2] ?? "2", suf = process.argv[3] ?? "";
const load = async (v) => { const r = await sharp(`tools/perf/three-spike-${v}-z${z}${suf}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return r; };
const [a, b, e] = await Promise.all([load("2d"), load("three-models"), load("empty")]);
const { width: W, height: H } = a.info;
const mask = (m) => { const out = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) { const d = Math.abs(m.data[3 * i] - e.data[3 * i]) + Math.abs(m.data[3 * i + 1] - e.data[3 * i + 1]) + Math.abs(m.data[3 * i + 2] - e.data[3 * i + 2]); out[i] = d > 60 ? 1 : 0; } return out; };
const A = mask(a), B = mask(b);
// ignore the UI chrome
const x0 = 120, x1 = W - 360, y0 = 120, y1 = H - 200;
let best = { iou: 0, dx: 0, dy: 0 }, ca = 0, cb = 0;
for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { ca += A[y * W + x]; cb += B[y * W + x]; }
console.log("mask px 2d", ca, "3d", cb);
for (let dy = -30; dy <= 30; dy += 1) for (let dx = -30; dx <= 30; dx += 1) {
  let inter = 0, uni = 0;
  for (let y = y0 + 40; y < y1 - 40; y += 2) for (let x = x0 + 40; x < x1 - 40; x += 2) {
    const p = A[y * W + x], q = B[(y + dy) * W + x + dx]; inter += p & q; uni += p | q;
  }
  const iou = inter / uni; if (iou > best.iou) best = { iou, dx, dy };
}
console.log("best shift of 3D that matches 2D (px):", best);

// per-building shifts (needs tools/perf/three-spike-items-z<zoom>.json from the "empty" run)
import fs from "node:fs";
const mf = JSON.parse(fs.readFileSync("assets/buildings/manifest.json", "utf8")).sprites;
const { cam, items } = JSON.parse(fs.readFileSync(`tools/perf/three-spike-items-z${z}${suf}.json`, "utf8"));
const HW = 32, HH = 16, byClass = {};
for (const it of items) {
  const fp = mf[it.sprite]?.footprint; if (!fp) continue;
  const [w, h] = fp, X = it.tx + w / 2, Z = it.ty + h / 2;
  const cx = Math.round((X - Z) * HW * cam.zoom + cam.x), cy = Math.round((X + Z) * HH * cam.zoom + cam.y);
  const rx = Math.round((w + h) * HW * cam.zoom * 0.45), ry = Math.round((w + h) * HH * cam.zoom * 0.9);
  if (cx - rx - 40 < 80 || cx + rx + 40 > W - 340 || cy - ry - 40 < 70 || cy + ry + 40 > H - 80) continue;
  let bs = { iou: -1, dx: 0, dy: 0 };
  for (let dy = -30; dy <= 30; dy++) for (let dx = -30; dx <= 30; dx++) {
    let inter = 0, uni = 0;
    for (let y = cy - ry; y < cy + ry; y += 2) for (let x = cx - rx; x < cx + rx; x += 2) { const p = A[y * W + x], q = B[(y + dy) * W + x + dx]; inter += p & q; uni += p | q; }
    const iou = uni ? inter / uni : 0; if (iou > bs.iou) bs = { iou, dx, dy };
  }
  const k = `${it.sprite}  ${w}x${h}`; (byClass[k] ??= []).push(`${bs.dx},${bs.dy}`);
}
for (const [k, v] of Object.entries(byClass)) console.log(k.padEnd(40), v.slice(0, 6).join(" | "));

// ground-contact check: bottom / left / right extents of each building's silhouette, 3D minus 2D (px).
// Robust to height differences (the IoU shift above is not): the footprint's south vertex must coincide.
const ext = (M, cx, cy, rx, ryTop, ryBot) => {
  let bottom = -1, left = 1e9, right = -1, top = 1e9;
  for (let y = cy - ryTop; y < cy + ryBot; y++) for (let x = cx - rx; x < cx + rx; x++) if (M[y * W + x]) { if (y > bottom) bottom = y; if (y < top) top = y; if (x < left) left = x; if (x > right) right = x; }
  return { bottom, left, right, top };
};
const rep = {};
for (const it of items) {
  const fp = mf[it.sprite]?.footprint ?? (it.sprite.startsWith("truck_depot") ? [2, 2] : null); if (!fp) continue;
  const [w, h] = fp, X = it.tx + w / 2, Z = it.ty + h / 2;
  const cx = Math.round((X - Z) * HW * cam.zoom + cam.x), cy = Math.round((X + Z) * HH * cam.zoom + cam.y);
  const rx = Math.round((w + h) * HW * cam.zoom * 0.5), ryT = Math.round((w + h) * HH * cam.zoom * 0.5), ryB = Math.round((w + h) * HH * cam.zoom * 0.62);
  if (cx - rx < 90 || cx + rx > W - 350 || cy - ryT < 80 || cy + ryB > H - 90) continue;
  const e2 = ext(A, cx, cy, rx, ryT, ryB), e3 = ext(B, cx, cy, rx, ryT, ryB);
  (rep[`${it.sprite} ${w}x${h}`] ??= []).push(`t${e3.top - e2.top} b${e3.bottom - e2.bottom} l${e3.left - e2.left} r${e3.right - e2.right}`);
}
console.log("-- extents 3D minus 2D --");
for (const [k, v] of Object.entries(rep)) console.log(k.padEnd(38), v.slice(0, 4).join(" | "));
