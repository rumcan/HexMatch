#!/usr/bin/env node
/**
 * K2/K1 — derived iso art: the pieces the Kenney landscape set does not ship.
 *
 *   node tools/make-derived-art.mjs              # rewrite the committed PNGs
 *   node tools/make-derived-art.mjs --check      # exit 1 if they are stale
 *   node tools/make-derived-art.mjs --out DIR    # write somewhere else
 *
 * `--check` regenerates into a temp directory and compares byte-for-byte with
 * what is committed, so drift between this generator and the PNGs in the repo
 * fails loudly instead of surfacing later as a red pixel test (ticket G9:
 * `rail_0101.png`/`rail_1010.png` were committed from an older revision of
 * this script and the atlas test caught it by accident, not by design).
 *
 * Output (committed to the repo under src/iso/kenny/derived/, referenced by
 * tools/iso-atlas.cells.json exactly like Kenney's own PNGs):
 *
 *   rail_0000.png … rail_1111.png   the 16 rail autotile masks — a gravel
 *                                   ballast block in the measured Kenney
 *                                   ground geometry (132×64 diamond + 50px
 *                                   skirt) with rails + sleepers along each
 *                                   set arm. Kenney ships roads only; the
 *                                   spec's fill-the-gap rule is "a tile you
 *                                   draw", so these are drawn once against
 *                                   the measured geometry, not generated in
 *                                   the slicer (K1: no generator cells).
 *   crossing.png                    rail straight (NE–SW) drawn OVER the
 *                                   Kenney crossroads road tile, for tiles
 *                                   that carry both layers (G6).
 *   highlight.png / highlight_soft.png
 *                                   the two placement glows (solid 1×1 build
 *                                   tile; fainter catchment area) as 132×64
 *                                   diamond PNGs.
 *
 * Everything is rasterised on the canonical 132×83 grid whose diamond centre
 * sits at (66, 32) — the same geometry the packer measures anchors from, so
 * these sprites anchor like any ground tile.
 */
import {
  mkdirSync, readFileSync, readdirSync, existsSync, rmSync, mkdtempSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
/** Where the committed derived art lives — the source of truth for --check. */
const COMMITTED = join(ROOT, "src/iso/kenny/derived");

const argv = process.argv.slice(2);
const CHECK = argv.includes("--check");
const outAt = argv.indexOf("--out");
if (CHECK && outAt >= 0) {
  console.error("--check and --out are mutually exclusive");
  process.exit(2);
}
const OUT = CHECK
  ? mkdtempSync(join(tmpdir(), "hexmatch-derived-"))
  : outAt >= 0 ? resolve(argv[outAt + 1] ?? "") : COMMITTED;
if (!OUT) {
  console.error("--out needs a directory");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// ── measured geometry (K0 — keep in sync with src/game/config.ts) ─────────
const W = 132, H = 83;
const CX = 66, CY = 32;            // diamond centre = tile centre-line
// Arm directions: game bits NE=1 SE=2 SW=4 NW=8 → edge midpoints of the
// diamond (NE exits through the upper-right edge, etc.).
const ARMS = {
  1: [CX + 33, CY - 16],           // NE
  2: [CX + 33, CY + 16],           // SE
  4: [CX - 33, CY + 16],           // SW
  8: [CX - 33, CY - 16],           // NW
};

// ── palette, median-sampled from the real Kenney tiles so the derived art
//    blends with the set (grass_010 / sand_073 / road_082) ─────────────────
const PAL = {
  grassEdge: [137, 163, 65],       // grass lip hanging over the block side
  earth: [139, 125, 68],           // block side, deeper earth
  earthDark: [104, 88, 48],
  ballast: [148, 140, 124],        // gravel deck
  ballastDark: [122, 115, 100],
  ballastLight: [170, 163, 146],
  sleeper: [92, 66, 42],
  rail: [64, 64, 70],
  railTop: [158, 158, 166],
};

const canvas = () => ({ px: Buffer.alloc(W * H * 4), w: W, h: H });
const put = (c, x, y, r, g, b, a = 255) => {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= c.w || y >= c.h) return;
  const i = (y * c.w + x) * 4;
  const sa = a / 255;
  c.px[i] = Math.round(c.px[i] * (1 - sa) + r * sa);
  c.px[i + 1] = Math.round(c.px[i + 1] * (1 - sa) + g * sa);
  c.px[i + 2] = Math.round(c.px[i + 2] * (1 - sa) + b * sa);
  c.px[i + 3] = Math.max(c.px[i + 3], Math.round(a));
};
const fillRect = (c, x0, y0, x1, y1, [r, g, b], a = 255) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(c, x, y, r, g, b, a);
};
/** Thick line by stamping squares along the segment. */
function line(c, x0, y0, x1, y1, [r, g, b], thick, a = 255) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const r0 = (thick - 1) >> 1;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
    fillRect(c, Math.round(x - r0), Math.round(y - r0),
      Math.round(x - r0) + thick - 1, Math.round(y - r0) + thick - 1, [r, g, b], a);
  }
}

// Deterministic speckle so the committed PNGs never churn between runs.
let speckState = 1234567;
const speck = () => (speckState = (speckState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/** The measured Kenney flat-block silhouette: diamond + plateau + wedge skirt. */
const inBlock = (x, y) => {
  if (y <= CY) { const hw = 66 * (y + 1) / 34; return Math.abs(x - CX) <= hw; }
  if (y <= CY + 17) return Math.abs(x - CX) <= 66;
  const hw = 66 - (y - (CY + 17)) * 2;
  return hw > 0 && Math.abs(x - CX) <= hw;
};
const inDiamond = (x, y) =>
  y >= 0 && y <= 64 && Math.abs(x - CX) / 66 + Math.abs(y - CY) / 32 <= 1;

/** Gravel-ballast ground block in the Kenney silhouette. */
function ballastBlock() {
  const c = canvas();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inBlock(x, y)) continue;
      let col;
      if (y <= CY) {
        // deck: speckled gravel, darker toward the diamond edge
        const s = speck();
        col = s > 0.82 ? PAL.ballastLight : s < 0.25 ? PAL.ballastDark : PAL.ballast;
        if (!inDiamond(x, y - 1) && !inDiamond(x, y + 1)) col = PAL.ballastDark;
      } else if (y <= CY + 6) {
        col = PAL.grassEdge;               // grass lip overhanging the side
      } else if (y > H - 10) {
        col = PAL.earthDark;
      } else {
        const s = speck();
        col = s > 0.85 ? PAL.ballastDark : PAL.earth;
      }
      put(c, x, y, ...col);
    }
  }
  return c;
}

/** One rail pair + sleepers from the diamond centre toward an edge midpoint. */
function railArm(c, bit, opts = {}) {
  const [ex, ey] = ARMS[bit];
  const dx = ex - CX, dy = ey - CY;                    // axis direction
  const len = Math.hypot(dx, dy);
  const px = -dy / len, py = dx / len;                 // unit perpendicular
  const { railGap = 6, withSleepers = true } = opts;
  for (const side of [-1, 1]) {
    const off = side * railGap;
    // rail: 2px steel with a light 1px head
    line(c, CX + px * off, CY + py * off, ex + px * off, ey + py * off, PAL.rail, 2);
    line(c, CX + px * off, CY + py * off, ex + px * off, ey + py * off, PAL.railTop, 1, 120);
  }
  if (!withSleepers) return;
  for (let t = 6; t < len; t += 8) {                   // sleepers every ~8px
    const ax = CX + dx * t / len, ay = CY + dy * t / len;
    line(c, ax - px * 11, ay - py * 11, ax + px * 11, ay + py * 11, PAL.sleeper, 2);
  }
}

const maskBits = (mask) => [1, 2, 4, 8].filter((b) => mask & b);

/** Every PNG this script produced, in order — `--check` compares this list. */
const emitted = [];

async function emit(name, c) {
  await sharp(Buffer.from(c.px), { raw: { width: c.w, height: c.h, channels: 4 } })
    .png().toFile(join(OUT, name));
  emitted.push(name);
  if (!CHECK) console.log("derived", name);
}

// ── the 16 rail autotiles ──────────────────────────────────────────────────
for (let mask = 0; mask < 16; mask++) {
  const c = ballastBlock();
  // sleepers first, rails on top; a centre pad ties every arm together.
  for (const bit of maskBits(mask)) railArm(c, bit);
  line(c, CX - 10, CY - 4, CX + 10, CY + 4, PAL.sleeper, 2);
  const key = mask.toString(2).padStart(4, "0");
  await emit(`rail_${key}.png`, c);
}

// ── crossing: rails over the real Kenney crossroads road tile ──────────────
{
  const src = join(ROOT, "src/iso/kenny/landscape/PNG/landscapeTiles_102.png");
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const c = { px: Buffer.from(data), w: info.width, h: info.height };
  // rail straight NE–SW over the asphalt (road keeps the other diagonal)
  for (const bit of [1, 4]) railArm(c, bit, { withSleepers: true });
  await emit("crossing.png", c);
}

// ── the two placement glows (132×64 diamonds, UI not world art) ────────────
{
  const glow = (lineAlpha, fillAlpha, edge) => {
    const c = canvas();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.abs(x - CX) / 66 + Math.abs(y - CY) / 32;
        if (d > 1) continue;
        if (d > 1 - edge) put(c, x, y, 255, 214, 40, lineAlpha);
        else put(c, x, y, 255, 214, 40, fillAlpha);
      }
    }
    return c;
  };
  await emit("highlight.png", glow(200, 90, 0.10));       // solid build tile
  await emit("highlight_soft.png", glow(90, 36, 0.06));   // faint catchment
}

// sanity: nothing generated outside the canonical geometry
if (PAL.ballast.length !== 3) throw new Error("palette shape");

if (!CHECK) {
  console.log(`derived art written to ${OUT} (rail ×16, crossing, highlight ×2)`);
  process.exit(0);
}

// ── --check: the committed PNGs must be exactly what this script produces ──
const drift = [];
for (const name of emitted) {
  const committedPath = join(COMMITTED, name);
  if (!existsSync(committedPath)) {
    drift.push(`${name}: generated but NOT committed`);
    continue;
  }
  const a = readFileSync(join(OUT, name));
  const b = readFileSync(committedPath);
  if (!a.equals(b)) {
    drift.push(`${name}: committed ${b.length} B ≠ regenerated ${a.length} B`);
  }
}
if (existsSync(COMMITTED)) {
  for (const f of readdirSync(COMMITTED)) {
    if (!f.endsWith(".png")) continue;
    if (!emitted.includes(f)) drift.push(`${f}: committed but no longer generated`);
  }
}
rmSync(OUT, { recursive: true, force: true });

if (drift.length) {
  console.error(`derived art is STALE (${drift.length} file(s)) — run \`node tools/make-derived-art.mjs\` and commit:`);
  for (const d of drift) console.error(`  ${d}`);
  process.exit(1);
}
console.log(`derived art in sync with its generator (${emitted.length} PNGs)`);
