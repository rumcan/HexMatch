#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// B-4 — instrumented dead-art audit (PRESENTS candidates; never deletes).
//
// The method (docs/BUILDING-PNG-MIGRATION.md §B-4): a literal string grep
// reports ~149 of 239 sprites as "unused" — badly wrong, because road
// bitmasks, depot names and town-house names are CONSTRUCTED at runtime.
// The deletion-candidate list is the complement of the union of:
//
//   (a) every sprite name written literally anywhere in src/ (and the
//       top-level HTML entry points);
//   (b) every name a template literal COULD produce, enumerated by
//       CONSTRUCTION, not observation:
//         • road_<4 bits> and dirt_<4 bits>  → 16 each (all masks occur;
//           a lone dirt stub is mask 0000 with the PRESENT bit);
//         • dirt_road_<state>                → 81 (each of the 4 edge chars
//           0/1/2, char 0 only when the direction bit is unset:
//           Σ C(4,k)·2^k = 81);
//         • depot_<cargo>                    → CARGOES (parsed from config);
//   (c) every name in TOWN_HOUSE_VARIANTS (the hash pool, parsed from
//       config) + the truck sprites (SPRITE_OF, parsed from vehicles.ts);
//   (d) the RUNTIME-observed set from `__iso.spriteUse(true)` + a full
//       exercise session (`--observed file.json` — a JSON array of names).
//
// Usage:
//   node tools/b4-dead-art-audit.mjs [--observed observed.json] [--out report.md]
//
// Exit 0 always; the report is for HUMAN SIGN-OFF before any deletion.
// ══════════════════════════════════════════════════════════════════════════
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const observedPath = args.includes("--observed") ? args[args.indexOf("--observed") + 1] : null;
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;

// ── (0) the universe: every sprite the atlas ships ────────────────────────
const manifest = JSON.parse(readFileSync(join(root, "assets", "iso-atlas", "manifest.json"), "utf8"));
const allSprites = new Set(Object.keys(manifest.sprites));

// ── (a) literal names in source ───────────────────────────────────────────
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|mjs|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const srcFiles = walk(join(root, "src")).concat(
  ["index.html", "art-lab.html", "iso-demo.html"].map((f) => join(root, f)),
);
const literal = new Set();
const STRING_RE = /(["'`])((?:\\.|(?!\1).)*)\1/g;
for (const f of srcFiles) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(STRING_RE)) {
    if (allSprites.has(m[2])) literal.add(m[2]);
  }
}

// ── (b) names constructible by the runtime template literals ─────────────
const byConstruction = new Set();
// road_<mask> / dirt_<mask>: all 16 nibbles are reachable (lone stub = 0000
// with the PRESENT bit, see renderer.ts bitName/dirtSpriteName).
for (let mask = 0; mask < 16; mask++) {
  const bits = mask.toString(2).padStart(4, "0");
  byConstruction.add(`road_${bits}`);
  byConstruction.add(`dirt_${bits}`);
}
// dirt_road_<eNE><eSE><eSW><eNW>: char is '0' only when the direction bit is
// unset in the tile mask, else '1'/'2' → Σ C(4,k)·2^k = 81 names.
for (let mask = 0; mask < 16; mask++) {
  const digits = [1, 2, 4, 8].map((bit) => (mask & bit ? ["1", "2"] : ["0"]));
  for (const d0 of digits[0]) for (const d1 of digits[1])
    for (const d2 of digits[2]) for (const d3 of digits[3])
      byConstruction.add(`dirt_road_${d0}${d1}${d2}${d3}`);
}
// depot_<cargo>: CARGOES is the authority (src/iso/config.ts).
const configTs = readFileSync(join(root, "src", "iso", "config.ts"), "utf8");
const CARGO_RE = /export const CARGOES: Cargo\[\] = \[([^\]]+)\]/;
const cargoMatch = configTs.match(CARGO_RE);
if (cargoMatch) {
  for (const c of cargoMatch[1].matchAll(/["']([a-z_]+)["']/g)) byConstruction.add(`depot_${c[1]}`);
} else {
  throw new Error("could not parse CARGOES from src/iso/config.ts");
}
// town pool: TOWN_HOUSE_VARIANTS (the hash index target list).
const POOL_RE = /export const TOWN_HOUSE_VARIANTS = \[([^\]]+)\]/;
const poolMatch = configTs.match(POOL_RE);
const pool = poolMatch ? [...poolMatch[1].matchAll(/["']([a-z_0-9]+)["']/g)].map((m) => m[1]) : [];
if (!pool.length) throw new Error("could not parse TOWN_HOUSE_VARIANTS from src/iso/config.ts");
for (const name of pool) byConstruction.add(name);
// trucks: SPRITE_OF table (src/iso/vehicles.ts).
const vehiclesTs = readFileSync(join(root, "src", "iso", "vehicles.ts"), "utf8");
const SPRITE_OF_RE = /const SPRITE_OF: Record<number, string> = \{([^}]+)\}/;
const spriteOfMatch = vehiclesTs.match(SPRITE_OF_RE);
if (spriteOfMatch) {
  for (const m of spriteOfMatch[1].matchAll(/["']([a-z_0-9]+)["']/g)) byConstruction.add(m[1]);
}

// ── (d) runtime-observed set (optional) ───────────────────────────────────
let observed = new Set();
if (observedPath) {
  const names = JSON.parse(readFileSync(resolve(observedPath), "utf8"));
  if (!Array.isArray(names)) throw new Error(`${observedPath} must be a JSON array of sprite names`);
  for (const n of names) {
    if (!allSprites.has(n)) console.warn(`warn: observed name "${n}" is not an atlas sprite (vehicle? overlay?)`);
    observed.add(n);
  }
}

// ── union + complement ────────────────────────────────────────────────────
const referenced = new Set([...literal, ...byConstruction]);
if (observedPath) for (const n of observed) referenced.add(n);
const candidates = [...allSprites].filter((n) => !referenced.has(n)).sort();
const provenDead = observedPath ? candidates.filter((n) => !observed.has(n)) : null;

// ── report ────────────────────────────────────────────────────────────────
const line = (s = "") => s;
const report = [
  "# B-4 dead-art audit — DELETION CANDIDATES (needs sign-off, nothing is deleted)",
  "",
  `Universe: ${allSprites.size} atlas sprites (assets/iso-atlas/manifest.json)`,
  `Referenced by literals: ${[...literal].filter((n) => allSprites.has(n)).length}`,
  `Referenced by construction (road/dirt/dirt_road/depot/town-pool/trucks): ${[...byConstruction].filter((n) => allSprites.has(n)).length}`,
  observedPath ? `Observed at runtime (__iso.spriteUse): ${observed.size}` : "No runtime observation passed (--observed) — candidates are static-only",
  `Total referenced: ${[...referenced].filter((n) => allSprites.has(n)).length}`,
  `DELETION CANDIDATES: ${candidates.length}`,
  "",
  ...candidates.map((n) => line(`- ${n}`)),
  "",
  observedPath
    ? (provenDead ? `Proven dead (referenced nowhere AND never drawn in the observed session): ${provenDead.length}` : "All statically-dead names were drawn at runtime — none provably dead.")
    : "NOTE: run a full exercise session (pan/zoom the whole map, roads in every shape, every depot cargo, a grown town) with __iso.spriteUse(true), then re-run with --observed for the provably-dead list.",
  "",
  "Sign-off required before any manifest edit / npm run slice-atlas repack (see BUILDING-PNG-MIGRATION.md B-4).",
].join("\n");

console.log(report);
if (outPath) writeFileSync(resolve(outPath), report + "\n");
