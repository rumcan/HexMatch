// open (boundary) edge length per model, positions welded at 1e-4: a big number = single-sided planes / holes
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import fs from "node:fs";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const names = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync("public/models").filter((f) => f.endsWith(".glb")).map((f) => f.slice(0, -4));
for (const n of names) {
  const doc = await io.read(`public/models/${n}.glb`);
  let open = 0, total = 0, tris = 0; const v = [0, 0, 0], w = [0, 0, 0];
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute("POSITION"), ia = prim.getIndices().getArray(); tris += ia.length / 3;
    const key = (i) => { pos.getElement(i, v); return v.map((x) => Math.round(x * 1e4)).join(","); };
    const ids = new Map(), id = (i) => { const k = key(i); let r = ids.get(k); if (r === undefined) ids.set(k, r = ids.size); return r; };
    const lenOf = (a, b) => { pos.getElement(a, v); pos.getElement(b, w); return Math.hypot(v[0] - w[0], v[1] - w[1], v[2] - w[2]); };
    const edges = new Map();
    for (let t = 0; t < ia.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = ia[t + k], b = ia[t + (k + 1) % 3], A = id(a), B = id(b), e = A < B ? `${A}_${B}` : `${B}_${A}`;
      const o = edges.get(e); if (o) o.n++; else edges.set(e, { n: 1, l: lenOf(a, b) });
    }
    for (const e of edges.values()) { total += e.l; if (e.n === 1) open += e.l; }
  }
  console.log(n.padEnd(34), String(tris).padStart(6), "open", open.toFixed(2), "of", total.toFixed(1), (100 * open / total).toFixed(1) + "%");
}
