import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]); const ax = Number(process.argv[3] ?? 2); const B = 40;
const pts = [];
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { const a = p.getAttribute("POSITION"), v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); pts.push([...v]); } }
const lo = Math.min(...pts.map((p) => p[ax])), hi = Math.max(...pts.map((p) => p[ax]));
for (let b = 0; b < B; b++) { const l = lo + (hi - lo) * b / B, h = lo + (hi - lo) * (b + 1) / B; const q = pts.filter((p) => p[ax] >= l && p[ax] <= h); console.log(l.toFixed(2), q.length, "maxY", q.length ? Math.max(...q.map((p) => p[1])).toFixed(2) : "-"); }
