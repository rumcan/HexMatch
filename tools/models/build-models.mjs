// LIVE-3D: Meshy GLBs (tools/art-src/meshy) -> small runtime GLBs in public/models + manifest.json.
// node tools/models/build-models.mjs [--src dir] [--tris N] [--tex 512] [--force] [name ...]
//
// Per model: square it to the grid with the SAME min-area yaw tools/meshy/render.mjs used (render.html
// `squareToGrid`, copied verbatim so the 3D model faces exactly like its sprite), weld, meshopt-simplify
// (size-based target: 2.5k tris, up to 6k for the big lots), 512 px WebP textures, prune, centre on X/Z,
// base on y=0, largest horizontal extent = 1, meshopt-compress. manifest.json records, per model, the
// sprite's front `turn` (quarter turns, from the render_t<N> file it was drawn with), the squared plan
// extents (ex, ez) and the height h, all in the normalised units.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { weld, textureCompress, prune, dedup, meshopt, compactPrimitive } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from "meshoptimizer";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SRC = opt("--src", "C:/Work Admin/PERSONAL/Repos/HexMatch/tools/art-src/meshy");
const TRIS_ARG = opt("--tris", null);
const TEX_ARG = opt("--tex", null);
const FORCE = args.includes("--force");
const only = args.filter((a, i) => !a.startsWith("--") && !["--src", "--tris", "--tex"].includes(args[i - 1]));
const OUT = path.resolve("public/models");
fs.mkdirSync(OUT, { recursive: true });
const MANIFEST = path.join(OUT, "manifest.json");
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const sprites = JSON.parse(fs.readFileSync("assets/buildings/manifest.json", "utf8"));
const spriteMap = sprites.sprites ?? sprites;

// Models with two plain renders (the pilots): the one the shipped sprite matches (pixel-compared).
const TURN_OVERRIDE = { factory: 0, town_flats: 0, town_small_house_1x1_1: 1 };
const turnOf = (name) => {
  if (name in TURN_OVERRIDE) return TURN_OVERRIDE[name];
  const t = fs.readdirSync(path.join(SRC, name)).map((f) => /^render_t(\d)@2x\.png$/.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  return t.length ? t[0] : 0;
};
// Size-based triangle target from the sprite's footprint area.
const footprintArea = (name) => {
  const fp = spriteMap[name]?.footprint ?? spriteMap[`${name}_r`]?.footprint;
  return fp ? fp[0] * fp[1] : 1;
};
// Asked-for count; the seam-respecting simplifier usually stops higher (see simplifyPrim), which we accept.
const targetTris = (name) => (TRIS_ARG ? Number(TRIS_ARG) : footprintArea(name) >= 4 ? 10000 : 6000);

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready, MeshoptDecoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });

const triCount = (doc) => {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : (p.getAttribute("POSITION")?.getCount() ?? 0)) / 3;
  }
  return Math.round(n);
};
/** Visit every vertex, in world space (node matrices applied); `step` subsamples per primitive like render.html. */
const eachVertex = (doc, fn, subsample) => {
  const v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION"); if (!pos) continue;
      const step = subsample ? Math.max(1, Math.floor(pos.getCount() / 4000)) : 1;
      for (let i = 0; i < pos.getCount(); i += step) {
        pos.getElement(i, v);
        fn(m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]);
      }
    }
  }
};
/** render.html squareToGrid, verbatim: min-area yaw over (x, z). */
const squareToGrid = (doc) => {
  const pts = [];
  eachVertex(doc, (x, _y, z) => pts.push([x, z]), true);
  let best = { area: Infinity, a: 0 };
  for (let deg = 0; deg < 90; deg += 0.5) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) {
      const rx = x * c - z * s, rz = x * s + z * c;
      if (rx < x0) x0 = rx; if (rx > x1) x1 = rx; if (rz < z0) z0 = rz; if (rz > z1) z1 = rz;
    }
    const area = (x1 - x0) * (z1 - z0);
    if (area < best.area) best = { area, a };
  }
  return best.a;
};

/** meshopt simplifyWithAttributes on the welded mesh: UV (and normal) are part of the error, seams stay seams. */
function simplifyPrim(prim, targetTris) {
  const posA = prim.getAttribute("POSITION"), uvA = prim.getAttribute("TEXCOORD_0"), nA = prim.getAttribute("NORMAL"), idxA = prim.getIndices();
  if (!posA || !uvA || !idxA || idxA.getCount() / 3 <= targetTris) return;
  const n = posA.getCount(), v = [0, 0, 0];
  const stride = nA ? 5 : 2, attr = new Float32Array(n * stride);
  for (let i = 0; i < n; i++) {
    uvA.getElement(i, v); attr[i * stride] = v[0]; attr[i * stride + 1] = v[1];
    if (nA) { nA.getElement(i, v); attr[i * stride + 2] = v[0]; attr[i * stride + 3] = v[1]; attr[i * stride + 4] = v[2]; }
  }
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { posA.getElement(i, v); pos.set(v, i * 3); }
  const [out] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(idxA.getArray()), pos, 3, attr, stride, nA ? [1, 1, 0.5, 0.5, 0.5] : [1, 1], null, targetTris * 3, 1, []);
  prim.setIndices(idxA.clone().setArray(new Uint32Array(out)));
  compactPrimitive(prim);
}

const rows = [];
const names = fs.readdirSync(SRC).filter((n) => fs.existsSync(path.join(SRC, n, "model.glb"))).sort();
// vehicles / rail pieces are out of scope for now
const SKIP = /^(car_|rail_|vehicle_)/;
for (const name of names) {
  if (SKIP.test(name) || (only.length && !only.includes(name))) continue;
  const src = path.join(SRC, name, "model.glb");
  const out = path.join(OUT, `${name}.glb`);
  if (!FORCE && manifest[name] && fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) {
    rows.push([name, "up to date", "", Math.round(fs.statSync(out).size / 1024)]);
    continue;
  }
  const doc = await io.read(src);
  const before = triCount(doc);
  const yaw = squareToGrid(doc);
  const target = targetTris(name);
  // Keep the UV seams: weld only vertices whose position, UV and normal all match, then simplify with
  // the attribute-aware path (no Permissive flag). Meshy atlases are cut into tiny UV islands, so the
  // simplifier stops at ~65-75% of the triangles; we ACCEPT that count instead of smearing the texture.
  await doc.transform(weld());
  let fallback = "";
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    try { simplifyPrim(p, Math.round(target * (p.getIndices().getCount() / 3 / before))); } catch (e) { fallback = " (simplify failed: unsimplified)"; }
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { p.setAttribute("NORMAL", null); p.setAttribute("TANGENT", null); }   // recomputed at runtime (smaller files)
  const area = footprintArea(name);
  const tex = TEX_ARG ? Number(TEX_ARG) : area >= 4 ? 1024 : 512;
  await doc.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [tex, tex], quality: 78 }),
    prune(),
  );
  // exact extents of the squared (yawed) model; three's rotation.y = a: x' = x cos a + z sin a, z' = -x sin a + z cos a
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  eachVertex(doc, (x, y, z) => {
    const rx = x * c + z * s, rz = -x * s + z * c;
    if (rx < x0) x0 = rx; if (rx > x1) x1 = rx; if (rz < z0) z0 = rz; if (rz > z1) z1 = rz;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }, false);
  const k = 1 / (Math.max(x1 - x0, z1 - z0) || 1);
  const scene = doc.getRoot().listScenes()[0];
  const wrap = doc.createNode("normalize")
    .setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)])
    .setScale([k, k, k])
    .setTranslation([-((x0 + x1) / 2) * k, -y0 * k, -((z0 + z1) / 2) * k]);
  for (const child of scene.listChildren()) { scene.removeChild(child); wrap.addChild(child); }
  scene.addChild(wrap);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  await io.write(out, doc);
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  manifest[name] = { turn: turnOf(name), ex: r4((x1 - x0) * k), ez: r4((z1 - z0) * k), h: r4((y1 - y0) * k) };
  const kb = Math.round(fs.statSync(out).size / 1024);
  rows.push([name, `${before} -> ${triCount(doc)}`, `t${manifest[name].turn} ${manifest[name].ex}x${manifest[name].ez}x${manifest[name].h}`, kb + (kb > 600 ? "  OVER 600 KB" : "") + fallback]);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("name | tris before -> after | turn ex x ez x h | KB");
for (const r of rows) console.log(r.join(" | "));
