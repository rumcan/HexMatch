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
import { weld, textureCompress, prune, dedup, meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder, MeshoptSimplifier, MeshoptDecoder } from "meshoptimizer";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SRC = opt("--src", "C:/Work Admin/PERSONAL/Repos/HexMatch/tools/art-src/meshy");
const TRIS_ARG = opt("--tris", null);
const TEX = Number(opt("--tex", 512));
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
const targetTris = (name) => {
  if (TRIS_ARG) return Number(TRIS_ARG);
  const fp = spriteMap[name]?.footprint ?? spriteMap[`${name}_r`]?.footprint;
  const area = fp ? fp[0] * fp[1] : 1;
  return area >= 8 ? 6000 : area >= 6 ? 5000 : area >= 4 ? 4000 : area >= 2 ? 3000 : 2500;
};

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

/**
 * Meshy atlases are cut into tiny UV islands, so the vertex buffer is ~3x the real vertex count and
 * meshopt (which treats every UV seam as a border) stalls near 65% of the triangles. Instead: merge
 * vertices by POSITION, simplify that clean mesh, then give every surviving corner the UV of an original
 * triangle that sits next to it (preferring one that shares a neighbour with the output triangle).
 */
function decimate(doc, prim, targetTris) {
  const posA = prim.getAttribute("POSITION"), uvA = prim.getAttribute("TEXCOORD_0"), idxA = prim.getIndices();
  if (!posA || !uvA || !idxA || idxA.getCount() / 3 <= targetTris) return;
  const pos = posA.getArray(), uv = uvA.getArray(), idx = idxA.getArray();
  const n = posA.getCount(), tc = idx.length / 3;
  const key = new Map(), cid = new Uint32Array(n), rep = [];
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(pos[3 * i] * 1e5)},${Math.round(pos[3 * i + 1] * 1e5)},${Math.round(pos[3 * i + 2] * 1e5)}`;
    let c = key.get(k);
    if (c === undefined) { c = rep.length; key.set(k, c); rep.push(i); }
    cid[i] = c;
  }
  const idx2 = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) idx2[i] = rep[cid[idx[i]]];
  const [out, serr] = MeshoptSimplifier.simplify(idx2, pos, 3, targetTris * 3, 1, ["Permissive"]);   // Permissive: the Meshy meshes have non-manifold edges that otherwise freeze the simplifier
  if (process.env.DBG) console.log("decimate", rep.length, "canon verts;", tc, "->", out.length / 3, "target", targetTris, "err", serr);
  // canonical vertex -> incident original triangles
  const inc = Array.from({ length: rep.length }, () => []);
  for (let t = 0; t < tc; t++) for (let j = 0; j < 3; j++) inc[cid[idx[3 * t + j]]].push(t);
  const m = out.length;
  const np = new Float32Array(m * 3), nu = new Float32Array(m * 2);
  for (let t = 0; t < m / 3; t++) {
    const cs = [cid[out[3 * t]], cid[out[3 * t + 1]], cid[out[3 * t + 2]]];
    for (let j = 0; j < 3; j++) {
      const c = cs[j], o1 = cs[(j + 1) % 3], o2 = cs[(j + 2) % 3];
      let pick = -1, fallback = -1;
      for (const ot of inc[c]) {
        let wedge = -1, hit = 0;
        for (let q = 0; q < 3; q++) {
          const v = idx[3 * ot + q], cc = cid[v];
          if (cc === c) wedge = v; else if (cc === o1 || cc === o2) hit++;
        }
        if (fallback < 0) fallback = wedge;
        if (hit > 0) { pick = wedge; break; }
      }
      const w = pick >= 0 ? pick : fallback;
      const o = 3 * t + j;
      np[3 * o] = pos[3 * w]; np[3 * o + 1] = pos[3 * w + 1]; np[3 * o + 2] = pos[3 * w + 2];
      nu[2 * o] = uv[2 * w]; nu[2 * o + 1] = uv[2 * w + 1];
    }
  }
  const buf = posA.getBuffer();
  prim.setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(np).setBuffer(buf));
  prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(nu).setBuffer(buf));
  prim.setIndices(null);
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
  // Meshy meshes carry per-face normals, so nothing welds and the simplifier finds no collapsible edge.
  // Drop them (and tangents): the runtime recomputes smooth normals.
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    p.setAttribute("NORMAL", null); p.setAttribute("TANGENT", null);
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) decimate(doc, p, Math.round(target * (p.getIndices().getCount() / 3 / before)));
  await doc.transform(
    weld(),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [TEX, TEX], quality: 80 }),
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
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await io.write(out, doc);
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  manifest[name] = { turn: turnOf(name), ex: r4((x1 - x0) * k), ez: r4((z1 - z0) * k), h: r4((y1 - y0) * k) };
  const kb = Math.round(fs.statSync(out).size / 1024);
  rows.push([name, `${before} -> ${triCount(doc)}`, `t${manifest[name].turn} ${manifest[name].ex}x${manifest[name].ez}x${manifest[name].h}`, kb + (kb > 300 ? "  OVER 300 KB" : "")]);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("name | tris before -> after | turn ex x ez x h | KB");
for (const r of rows) console.log(r.join(" | "));
