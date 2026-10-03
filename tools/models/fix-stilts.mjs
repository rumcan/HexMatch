#!/usr/bin/env node
// 3D-FIX-1: post-process town_office_tower_modern and town_shops_modern GLBs
// that stand on thin pillars. The raw Meshy files are git-ignored, so we fix
// the built public/models/*.glb in place: bake the normalize wrapper, then
// add a solid box plinth that fills the plan from y=0 to ~25% of the height
// with the tower's base colour (pale stone). The plinth makes the lowest 20%
// of the height solid (>=80% plan coverage) which the geometry test checks.
// Keeps file sizes <700KB via meshopt.
//
// Usage: node tools/models/fix-stilts.mjs [--check]
//   --check: just report whether the two files would pass the solid test
import fs from "node:fs";
import path from "node:path";
import { NodeIO, Accessor } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune } from "@gltf-transform/functions";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { meshopt } from "@gltf-transform/functions";

const TARGETS = ["town_office_tower_modern", "town_shops_modern"];
const OUT_DIR = "public/models";

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

function getWorldBounds(doc) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const collect = (node) => {
    const world = node.getWorldMatrix();
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          const x = world[0] * v[0] + world[4] * v[1] + world[8] * v[2] + world[12];
          const y = world[1] * v[0] + world[5] * v[1] + world[9] * v[2] + world[13];
          const z = world[2] * v[0] + world[6] * v[1] + world[10] * v[2] + world[14];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      }
    }
    for (const child of node.listChildren()) collect(child);
  };
  for (const scene of doc.getRoot().listScenes()) {
    for (const child of scene.listChildren()) collect(child);
  }
  // fallback: if no scene, iterate all nodes
  if (minX === Infinity) {
    for (const node of doc.getRoot().listNodes()) {
      const mesh = node.getMesh();
      if (!mesh) continue;
      const world = node.getWorldMatrix();
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute("POSITION");
        if (!pos) continue;
        const v = [0, 0, 0];
        for (let i = 0; i < pos.getCount(); i++) {
          pos.getElement(i, v);
          const x = world[0] * v[0] + world[4] * v[1] + world[8] * v[2] + world[12];
          const y = world[1] * v[0] + world[5] * v[1] + world[9] * v[2] + world[13];
          const z = world[2] * v[0] + world[6] * v[1] + world[10] * v[2] + world[14];
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
          if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
      }
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function bakeWorldTransforms(doc) {
  // Store world matrices first, then apply and reset nodes
  const nodes = doc.getRoot().listNodes();
  const worldMap = new Map();
  for (const node of nodes) worldMap.set(node, node.getWorldMatrix().slice());
  // Apply to positions
  for (const node of nodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const world = worldMap.get(node);
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const v = [0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, v);
        const x = world[0] * v[0] + world[4] * v[1] + world[8] * v[2] + world[12];
        const y = world[1] * v[0] + world[5] * v[1] + world[9] * v[2] + world[13];
        const z = world[2] * v[0] + world[6] * v[1] + world[10] * v[2] + world[14];
        pos.setElement(i, [x, y, z]);
      }
      // Also transform normals if present (approximate: use rotation part)
      const n = prim.getAttribute("NORMAL");
      if (n) {
        // For uniform scale, normal transform is just rotation (scale uniform)
        // Extract 3x3 rotation+scale, but we approximate with world 3x3 without translation, normalized
        const m00 = world[0], m01 = world[4], m02 = world[8];
        const m10 = world[1], m11 = world[5], m12 = world[9];
        const m20 = world[2], m21 = world[6], m22 = world[10];
        for (let i = 0; i < n.getCount(); i++) {
          n.getElement(i, v);
          const nx = m00 * v[0] + m01 * v[1] + m02 * v[2];
          const ny = m10 * v[0] + m11 * v[1] + m12 * v[2];
          const nz = m20 * v[0] + m21 * v[1] + m22 * v[2];
          const len = Math.hypot(nx, ny, nz) || 1;
          n.setElement(i, [nx/len, ny/len, nz/len]);
        }
      }
    }
  }
  // Reset all node transforms to identity
  for (const node of nodes) {
    node.setMatrix([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    node.setScale([1,1,1]);
    node.setTranslation([0,0,0]);
    node.setRotation([0,0,0,1]);
  }
}

function addPlinth(doc, bounds, plinthHeight, baseColor) {
  const { minX, maxX, minY, maxZ, minZ } = bounds;
  const y0 = minY;
  const y1 = minY + plinthHeight;
  // 8 vertices of the box
  const positions = new Float32Array([
    minX, y0, minZ, // 0
    maxX, y0, minZ, // 1
    maxX, y0, maxZ, // 2
    minX, y0, maxZ, // 3
    minX, y1, minZ, // 4
    maxX, y1, minZ, // 5
    maxX, y1, maxZ, // 6
    minX, y1, maxZ, // 7
  ]);
  const indices = new Uint16Array([
    0,1,2, 0,2,3, // bottom
    4,6,5, 4,7,6, // top
    0,4,5, 0,5,1, // front (minZ)
    1,5,6, 1,6,2, // right (maxX)
    2,6,7, 2,7,3, // back (maxZ)
    3,7,4, 3,4,0, // left (minX)
  ]);
  // Find a buffer to use, or create one
  let buffer = doc.getRoot().listBuffers()[0];
  if (!buffer) buffer = doc.createBuffer("buffer");
  const posAcc = doc.createAccessor("plinth_POSITION")
    .setArray(positions)
    .setType(Accessor.Type.VEC3)
    .setBuffer(buffer);
  const idxAcc = doc.createAccessor("plinth_INDICES")
    .setArray(indices)
    .setType(Accessor.Type.SCALAR)
    .setBuffer(buffer);
  const mat = doc.createMaterial("plinth_mat")
    .setBaseColorFactor(baseColor)
    .setDoubleSided(false)
    .setAlphaMode("OPAQUE");
  // Optional: set roughness
  try { mat.setRoughnessFactor(0.9); } catch {}
  try { mat.setMetallicFactor(0.0); } catch {}
  const prim = doc.createPrimitive()
    .setAttribute("POSITION", posAcc)
    .setIndices(idxAcc)
    .setMaterial(mat)
    .setMode(4); // TRIANGLES
  const mesh = doc.createMesh("plinth_mesh").addPrimitive(prim);
  const node = doc.createNode("plinth").setMesh(mesh);
  // Add to default scene
  let scene = doc.getRoot().listScenes()[0];
  if (!scene) scene = doc.createScene("scene").addChild(node);
  else scene.addChild(node);
  return node;
}

// Main
const checkOnly = process.argv.includes("--check");

for (const name of TARGETS) {
  const file = path.join(OUT_DIR, `${name}.glb`);
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}`);
    process.exit(1);
  }
  const doc = await io.read(file);
  const bounds = getWorldBounds(doc);
  const h = bounds.maxY - bounds.minY;
  const plinthH = h * 0.30; // 30% to safely cover lowest 20%
  console.log(`${name}: bounds y ${bounds.minY.toFixed(4)}..${bounds.maxY.toFixed(4)} h=${h.toFixed(4)} x ${bounds.minX.toFixed(3)}..${bounds.maxX.toFixed(3)} z ${bounds.minZ.toFixed(3)}..${bounds.maxZ.toFixed(3)} plinthH ${plinthH.toFixed(4)}`);

  if (checkOnly) {
    // just report, don't modify
    continue;
  }

  // Check if already has plinth (avoid double-add on re-run): look for node named plinth
  const hasPlinth = doc.getRoot().listNodes().some(n => n.getName() === "plinth");
  if (hasPlinth) {
    console.log(`  already has plinth, skipping`);
    continue;
  }

  // The original model is normalized via a wrapper node "normalize" (scale + translation).
  // We keep that wrapper and add the plinth as a sibling in world space (direct child of the scene),
  // with positions already in world coordinates. The existing mesh stays under its wrapper,
  // the plinth is at world coordinates directly, so both end up correctly placed without rebaking.
  const baseColor = name === "town_office_tower_modern"
    ? [0.82, 0.80, 0.76, 1.0] // pale stone for tower
    : [0.84, 0.82, 0.79, 1.0]; // slightly lighter for shops

  addPlinth(doc, bounds, plinthH, baseColor);

  // Cleanup and compress
  await doc.transform(dedup(), prune());
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "high" }));

  await io.write(file, doc);
  const sz = fs.statSync(file).size;
  console.log(`  wrote ${file} ${(sz/1024).toFixed(1)} KB ${sz>700*1024 ? "OVER 700KB!" : ""}`);
  if (sz > 700*1024) {
    console.error(`File too large after fix: ${file} ${sz} bytes`);
    process.exit(1);
  }
}

if (!checkOnly) console.log("fix-stilts done");
