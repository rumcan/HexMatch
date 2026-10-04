import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const f = process.argv[2];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(f);
for (const node of doc.getRoot().listNodes()) { if (node.getMesh()) console.log("node", node.getName(), node.getWorldScale?.(), node.getWorldTranslation?.()); }
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const pos = prim.getAttribute("POSITION"), idx = prim.getIndices(), n = pos.getCount();
  const par = Array.from({ length: n }, (_, i) => i); const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const ia = idx.getArray();
  for (let t = 0; t < ia.length; t += 3) { par[find(ia[t])] = find(ia[t + 1]); par[find(ia[t + 1])] = find(ia[t + 2]); }
  const comp = new Map(); const v = [0, 0, 0];
  for (let t = 0; t < ia.length; t += 3) { const r = find(ia[t]); let c = comp.get(r); if (!c) comp.set(r, c = { tris: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }); c.tris++;
    for (let k = 0; k < 3; k++) { pos.getElement(ia[t + k], v); for (let a = 0; a < 3; a++) { c.min[a] = Math.min(c.min[a], v[a]); c.max[a] = Math.max(c.max[a], v[a]); } } }
  console.log("prim verts", n, "tris", ia.length / 3, "components", comp.size);
  [...comp.values()].sort((a, b) => b.tris - a.tris).slice(0, 400).filter((c) => c.tris > 150 || (c.max[1] - c.min[1] > 0.3)).forEach((c) => console.log(c.tris, c.min.map((x) => x.toFixed(3)).join(","), "->", c.max.map((x) => x.toFixed(3)).join(",")));
}
