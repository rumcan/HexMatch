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
// DEPOT-FACING: the shipped _se sprite is render_t0, whose yard opens SW (a duplicate of _sw); the yard opens SE at turn 1, so the model uses 1 (re-render the sprite at --turn 1 too).
const TURN_OVERRIDE = { truck_depot_bottom_entrance_se: 1, factory: 0, town_flats: 0, town_small_house_1x1_1: 1, terrace_2x1_plain: 1, terrace_2x1_yard: 1 };   // the terraces: Hunyuan models come long on Z, the 2x1 sprite is long on X
const turnOf = (name) => {
  if (name in TURN_OVERRIDE) return TURN_OVERRIDE[name];
  const t = fs.readdirSync(path.join(SRC, name)).map((f) => /^render_t(\d)@2x\.png$/.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  return t.length ? t[0] : 0;
};
// Size-based triangle target from the sprite's footprint area.
// LIVE-3D: the railway art lives in assets/railway/manifest.json (platform_<view>, train-depot_<view>)
const RAIL_FOOTPRINT = { platform: [4, 1], "train-depot": [2, 2] };
const footprintArea = (name) => {
  const fp = spriteMap[name]?.footprint ?? spriteMap[`${name}_r`]?.footprint ?? RAIL_FOOTPRINT[name];
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
function simplifyPrim(prim, targetTris, permissive = false) {
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
  const [out] = MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(idxA.getArray()), pos, 3, attr, stride, nA ? [1, 1, 0.5, 0.5, 0.5] : [1, 1], null, targetTris * 3, 1, permissive ? ["Permissive"] : []);
  prim.setIndices(idxA.clone().setArray(new Uint32Array(out)));
  compactPrimitive(prim);
}

// LIVE-3D (owner 2026-10-03): the terrace models come with a flat BACK pane that stands inboard of the end walls and
// roofs, so geometry hangs out behind it (no defined backside). Everything above the base whose triangle lies wholly
// behind the pane's outer face (source axis X, which these Hunyuan models come squared to) is dropped, and the
// vertices of triangles that straddle the face are pinned onto it: the back becomes one flush wall. Value = the x of
// the pane's outer face in SOURCE units (read off the pane's own component).
const BACK_TRIM = { terrace_2x1_plain: -0.199, terrace_2x1_yard: -0.567 };
function trimBack(doc, cutX) {
  let minY = Infinity;
  for (const node of doc.getRoot().listNodes()) { const m = node.getMesh(); if (!m) continue; for (const pr of m.listPrimitives()) { const pa = pr.getAttribute("POSITION"), v = [0, 0, 0]; for (let i = 0; i < pa.getCount(); i++) { pa.getElement(i, v); minY = Math.min(minY, v[1]); } } }
  const eps = 0.004; let dropped = 0, pinned = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const pr of mesh.listPrimitives()) {
    const pa = pr.getAttribute("POSITION"), ia = pr.getIndices(), arr = ia.getArray(), keep = [], v = [0, 0, 0];
    const x = (i) => { pa.getElement(i, v); return v[0]; }, y = (i) => { pa.getElement(i, v); return v[1]; };
    for (let t = 0; t < arr.length; t += 3) {
      const a = arr[t], b = arr[t + 1], c = arr[t + 2], cy = (y(a) + y(b) + y(c)) / 3;
      const behind = [a, b, c].filter((i) => x(i) < cutX - eps).length;
      if (cy <= minY + 0.07) { keep.push(a, b, c); continue; }          // the base / yard layer is untouched
      if (behind === 3) { dropped++; continue; }
      keep.push(a, b, c);
    }
    for (let i = 0; i < pa.getCount(); i++) { pa.getElement(i, v); if (v[0] < cutX && v[1] > minY + 0.07) { v[0] = cutX; pa.setElement(i, v); pinned++; } }
    pr.setIndices(ia.clone().setArray(new Uint32Array(keep)));
    compactPrimitive(pr);
  }
  return `trimmed ${dropped} tris, pinned ${pinned} verts`;
}
// LIVE-3D (owner 2026-10-03): the two tallest city blocks drew nearly three tiles high, far out of scale with the
// rest of the town: their HEIGHT is halved (plan untouched, so the footprint still matches the tile footprint).
const HEIGHT_SCALE = { town_offices_tall: 0.5, town_flats_grey: 0.5 };
const rows = [];
const names = fs.readdirSync(SRC).filter((n) => fs.existsSync(path.join(SRC, n, "model.glb"))).sort();
// Vehicles and rail cars ("moving" art): squared to the grid with the LONG axis on +X (render.html renderVehicle),
// normalised to length 1; the runtime scales by lengthM / 12 (one tile = 12 m) and turns by the heading.
const MOVING = /^(car_|rail_|vehicle_)/;
// metres, from the sprite manifests' notes (truck 7 m, loco 10.3 m ...); the three sedans have no sprite yet
const LENGTH_M = { vehicle_truck: 7, rail_loco: 10.3, rail_tender: 4.7, rail_box: 7.2, rail_tank: 6.7, rail_flat: 6.2, car_sedan_1: 4.8, car_sedan_2: 4.8, car_sedan_3: 4.8 };
// models whose front came out at the back (render.mjs --flip): set after checking against the 2D sprites
const FLIP = { vehicle_truck: true, rail_loco: true };   // LIVE-3D owner round 2: these two came out cab/boiler the wrong way round (drove in reverse)
// one model, two paints: vehicle_truck_blue is the red lorry's red paint turned to hue 215 (render.mjs --livery)
const LIVERIES = [{ name: "vehicle_truck", outName: "vehicle_truck_blue", hue: 215 }];
const rgbToHsv = (r, g, b) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx / 255]; };
const hsvToRgb = (h, s, v) => { const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [(r + m) * 255, (g + m) * 255, (b + m) * 255]; };
async function repaintTextures(doc, hue) {
  for (const t of doc.getRoot().listTextures()) {
    const { data, info } = await sharp(Buffer.from(t.getImage())).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) {
      if (!data[i + 3]) continue;
      const [h, sat, v] = rgbToHsv(data[i], data[i + 1], data[i + 2]);
      if (Math.min(h, 360 - h) > 18 || sat < 0.38 || v < 0.12) continue;
      const [r, g, b] = hsvToRgb(hue, Math.min(1, sat * 0.9), Math.min(1, v * 1.05));
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
    }
    t.setImage(new Uint8Array(await sharp(data, { raw: info }).webp({ quality: 78 }).toBuffer())).setMimeType("image/webp");
  }
}
const jobs = [];
for (const name of names) {
  if (only.length && !only.includes(name)) continue;
  jobs.push({ name, outName: name, hue: null });
  for (const l of LIVERIES) if (l.name === name) jobs.push(l);
}
for (const { name, outName, hue } of jobs) {
  const src = path.join(SRC, name, "model.glb");
  const out = path.join(OUT, `${outName}.glb`);
  const moving = MOVING.test(name);
  if (!FORCE && manifest[outName] && fs.existsSync(out) && fs.statSync(out).mtimeMs > fs.statSync(src).mtimeMs) {
    rows.push([outName, "up to date", "", Math.round(fs.statSync(out).size / 1024)]);
    continue;
  }
  const doc = await io.read(src);
  let trimNote = "";
  if (BACK_TRIM[name] != null) trimNote = " " + trimBack(doc, BACK_TRIM[name]);
  const before = triCount(doc);
  let yaw = squareToGrid(doc);
  const target = moving ? 4000 : targetTris(name);
  // Keep the UV seams: weld only vertices whose position, UV and normal all match, then simplify with
  // the attribute-aware path (no Permissive flag). Meshy atlases are cut into tiny UV islands, so the
  // simplifier stops at ~65-75% of the triangles; we ACCEPT that count instead of smearing the texture.
  await doc.transform(weld());
  let fallback = "";
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    try { simplifyPrim(p, Math.round(target * (p.getIndices().getCount() / 3 / before)), moving); } catch (e) { fallback = " (simplify failed: unsimplified)"; }
  }
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { p.setAttribute("NORMAL", null); p.setAttribute("TANGENT", null); }   // recomputed at runtime (smaller files)
  const area = footprintArea(name);
  const tex = TEX_ARG ? Number(TEX_ARG) : !moving && area >= 4 ? 1024 : 512;
  await doc.transform(
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: "webp", resize: [tex, tex], quality: 78 }),
    prune(),
  );
  if (hue != null) await repaintTextures(doc, hue);
  // exact extents of the squared (yawed) model; three's rotation.y = a: x' = x cos a + z sin a, z' = -x sin a + z cos a
  let x0, x1, y0, y1, z0, z1;
  const measure = () => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    x0 = y0 = z0 = Infinity; x1 = y1 = z1 = -Infinity;
    eachVertex(doc, (x, y, z) => {
      const rx = x * c + z * s, rz = -x * s + z * c;
      if (rx < x0) x0 = rx; if (rx > x1) x1 = rx; if (rz < z0) z0 = rz; if (rz > z1) z1 = rz;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }, false);
  };
  measure();
  if (moving) {   // long axis onto +X, then the optional front flip (render.html renderVehicle)
    if (z1 - z0 > x1 - x0) { yaw += Math.PI / 2; }
    if (FLIP[name]) yaw += Math.PI;
    measure();
  }
  const k = 1 / (moving ? (x1 - x0) : (Math.max(x1 - x0, z1 - z0) || 1));
  const hs = HEIGHT_SCALE[name] ?? 1;
  const scene = doc.getRoot().listScenes()[0];
  const wrap = doc.createNode("normalize")
    .setRotation([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)])
    .setScale([k, k * hs, k])
    .setTranslation([-((x0 + x1) / 2) * k, -y0 * k * hs, -((z0 + z1) / 2) * k]);
  for (const child of scene.listChildren()) { scene.removeChild(child); wrap.addChild(child); }
  scene.addChild(wrap);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));
  await io.write(out, doc);
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  manifest[outName] = { turn: moving ? 0 : turnOf(name), ex: r4((x1 - x0) * k), ez: r4((z1 - z0) * k), h: r4((y1 - y0) * k * hs), ...(moving ? { moving: true, lengthM: LENGTH_M[name] ?? 5 } : {}) };
  const kb = Math.round(fs.statSync(out).size / 1024);
  rows.push([outName, `${before} -> ${triCount(doc)}`, `t${manifest[outName].turn} ${manifest[outName].ex}x${manifest[outName].ez}x${manifest[outName].h}`, kb + (kb > 600 ? "  OVER 600 KB" : "") + fallback + trimNote]);
}
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
console.log("name | tris before -> after | turn ex x ez x h | KB");
for (const r of rows) console.log(r.join(" | "));
