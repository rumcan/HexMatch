// LIVE-3D stage 2: raw Hunyuan GLBs -> small runtime GLBs in public/models.
// node tools/models/build-models.mjs [--src <dir>] [--tris 2500] [--tex 512] [--force] [name ...]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, simplify, textureCompress, prune, dedup, getBounds, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier } from "meshoptimizer";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SRC = opt("--src", "C:/Work Admin/PERSONAL/Repos/HexMatch/tools/art-src/hunyuan");
const TRIS = Number(opt("--tris", 2500));
const TEX = Number(opt("--tex", 512));
const FORCE = args.includes("--force");
const only = args.filter((a, i) => !a.startsWith("--") && !["--src", "--tris", "--tex"].includes(args[i - 1]));
const OUT = path.resolve("public/models");
fs.mkdirSync(OUT, { recursive: true });

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": (await import("meshoptimizer")).MeshoptDecoder });

const triCount = (doc) => {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : (p.getAttribute("POSITION")?.getCount() ?? 0)) / 3;
  }
  return Math.round(n);
};

const rows = [];
for (const name of fs.readdirSync(SRC).sort()) {
  if (only.length && !only.includes(name)) continue;
  const src = path.join(SRC, name, "model.glb");
  if (!fs.existsSync(src)) continue;
  const out = path.join(OUT, `${name}.glb`);
  if (!FORCE && fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) {
    rows.push([name, "up to date", "", Math.round(fs.statSync(out).size / 1024)]);
    continue;
  }
  const doc = await io.read(src);
  const before = triCount(doc);
  await doc.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, TRIS / Math.max(1, before)), error: 0.05, lockBorder: false }),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEX, TEX], quality: 80 }),
    prune(),
  );
  // normalize: centre X/Z, base at y=0, largest horizontal extent = 1 (one wrapper node over the scene roots)
  const scene = doc.getRoot().listScenes()[0];
  const { min, max } = getBounds(scene);
  const ext = Math.max(max[0] - min[0], max[2] - min[2]) || 1;
  const s = 1 / ext;
  const wrap = doc.createNode("normalize")
    .setScale([s, s, s])
    .setTranslation([-((min[0] + max[0]) / 2) * s, -min[1] * s, -((min[2] + max[2]) / 2) * s]);
  for (const child of scene.listChildren()) { scene.removeChild(child); wrap.addChild(child); }
  scene.addChild(wrap);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await io.write(out, doc);
  rows.push([name, `${before} -> ${triCount(doc)}`, `h/w ${((max[1] - min[1]) * s).toFixed(2)}`, Math.round(fs.statSync(out).size / 1024)]);
}
console.log("name | tris before -> after | note | KB");
for (const r of rows) console.log(r.join(" | "));
