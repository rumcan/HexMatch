import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const bands = Number(process.argv[3] ?? 16); const pts = [];
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) { const a = p.getAttribute("POSITION"), v = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); pts.push([...v]); } }
const ys = pts.map((p) => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
console.log("y", y0.toFixed(2), y1.toFixed(2));
for (let b = 0; b < bands; b++) { const lo = y0 + (y1 - y0) * b / bands, hi = y0 + (y1 - y0) * (b + 1) / bands; const q = pts.filter((p) => p[1] >= lo && p[1] < hi + (b === bands - 1 ? 1 : 0)); if (!q.length) { console.log(b, "EMPTY"); continue; } const xs = q.map((p) => p[0]), zs = q.map((p) => p[2]); console.log(b, q.length, "x", Math.min(...xs).toFixed(2), Math.max(...xs).toFixed(2), "z", Math.min(...zs).toFixed(2), Math.max(...zs).toFixed(2)); }
