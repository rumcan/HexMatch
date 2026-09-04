#!/usr/bin/env node
/**
 * Validate an atlas manifest against tools/atlas-manifest.schema.json (E1).
 * Enforces the JSON Schema plus the geometric invariants a schema can't
 * express:
 *
 *   - animation frames tile horizontally and fit the rect (`w % frames == 0`,
 *     `frameMs` present when frames > 1)
 *   - `anchor` (south-corner pixel contract) lies inside the sprite rect
 *   - `slices` (E4 Tier-3 escape hatch) lie inside the sprite rect
 *   - non-1x1 footprints carry a positive `frames` count default of 1
 *
 * Usage:
 *   node tools/validate-manifest.mjs assets/iso-atlas/manifest.json
 *
 * Importable (used by tests/unit/iso-manifest.test.ts):
 *   import { validateManifest } from "./validate-manifest.mjs";
 */
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const schemaPath = new URL("./atlas-manifest.schema.json", import.meta.url);

export function validateManifest(manifest) {
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const check = ajv.compile(schema);
  if (!check(manifest)) {
    return (check.errors ?? []).map((e) => `schema: ${e.instancePath || "/"} ${e.message}`);
  }
  const errors = [];
  const HW = (manifest.tileW ?? 132) / 2;
  for (const [name, s] of Object.entries(manifest.sprites)) {
    const frames = s.frames ?? 1;
    const frameW = s.w / frames;
    if (frames > 1) {
      if (s.w % frames !== 0)
        errors.push(`sprite ${name}: ${frames} frames do not tile ${s.w}px width evenly`);
      if (s.frameMs === undefined)
        errors.push(`sprite ${name}: animated (${frames} frames) but no frameMs`);
    }
    if (s.anchor[0] < 0 || s.anchor[1] < 0 || s.anchor[0] > s.w || s.anchor[1] > s.h)
      errors.push(`sprite ${name}: anchor (${s.anchor}) outside rect ${s.w}x${s.h}`);
    for (const sl of s.slices ?? []) {
      if (sl.x + sl.w > s.w || sl.y + sl.h > s.h)
        errors.push(`sprite ${name}: slice (${sl.x},${sl.y},${sl.w}x${sl.h}) outside rect`);
    }
    if ((s.footprint[0] > 1 || s.footprint[1] > 1) && !Array.isArray(s.slices) && s.h > 200)
      errors.push(`sprite ${name}: multi-tile footprint with h=${s.h} — verify against the contact sheet`);
    // V1 partner invariant: Y6 bounds sprites that are too BIG for their
    // footprint; this bounds the mirror failure — a building sprite that is
    // dramatically SMALLER than the tiles it reserves ("the building is one
    // square but blocks nine"). The footprint's pixel span across the diamond
    // is (fw + fh) * HW; a sprite covering less than half of it is reserving
    // tiles the player sees as empty. Vehicles are exempt — a truck IS much
    // smaller than its tile and that is the correct art scale.
    const span = (s.footprint[0] + s.footprint[1]) * HW;
    if (s.kind !== "vehicle" && frameW < span / 2)
      errors.push(`sprite ${name}: frame width ${frameW}px covers < half of its ${s.footprint.join("x")} footprint (${span}px span) — shrink the footprint or use art that fills it`);
  }
  return errors;
}

const isCli = process.argv[1] && import.meta.url.split("/").pop() === process.argv[1].split("/").pop();
if (isCli) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node tools/validate-manifest.mjs <manifest.json>");
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const errors = validateManifest(manifest);
  if (errors.length) {
    console.error(`manifest ${file}: INVALID`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`manifest ${file}: valid`);
}
