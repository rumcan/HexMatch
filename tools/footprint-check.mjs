#!/usr/bin/env node
/**
 * Y7 acceptance helper — footprint debug overlay.
 *
 * Renders every building cell over the yellow footprint diamond grid the Y7
 * bug was found with, once per map quadrant (a projection/anchor error often
 * only shows at offset), using the exact draw math of src/iso/depth.ts
 * (`drawOrigin`: anchor lands on the south corner of the footprint) against
 * the built atlas.
 *
 * Usage:
 *   node tools/footprint-check.mjs [out.png]
 *
 * Output (default assets/iso-atlas/footprint-check.png): one column per
 * quadrant offset, one row per building. Acceptance: the building's base sits
 * inside its yellow footprint — no overhang past the top-left edge, no bare
 * bottom-right corner.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] ?? join(ROOT, "assets/iso-atlas/footprint-check.png");
const manifest = JSON.parse(readFileSync(join(ROOT, "assets/iso-atlas/manifest.json"), "utf8"));
const atlas = await sharp(join(ROOT, "assets/iso-atlas/atlas@1x.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

/** Building-layer PNGs (assets/buildings/<name>@1x.png), loaded lazily. */
const LAYERS = new Map();
async function layerOf(name) {
  if (!LAYERS.has(name)) {
    LAYERS.set(name, await sharp(join(ROOT, "assets", "buildings", `${name}@1x.png`))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  return LAYERS.get(name);
}

const HW = 32, HH = 16, TILE_H = 32;
const tileToScreen = (tx, ty) => [(tx - ty) * HW, (tx + ty) * HH];

/** Two sets share one sheet now:
 *
 *  • Y7 — the six single-sprite PP-12 industry nodes, the single-sprite PP-12
 *    factory and one PP-12 depot per cargo (each cargo has its own geometry,
 *    so all six are covered — unlike the old player tints, which shared one
 *    geometry each). Legacy per-tile cells are not covered.
 *  • F5 (#273) — the first non-square buildings, drawn from their own layers
 *    in assets/buildings/ (the sheet has no cell for them). BOTH orientations
 *    of each pair are listed, so a footprint declared the wrong way round
 *    shows as one of the two leaning off its diamond. */
const Y7 = (n) =>
  /^(farm|forest|ore_mine|quarry|oil_rig|gold_mine|factory|depot_(grain|wood|ore|stone|oil|gold))$/.test(n);
const BUILT = JSON.parse(readFileSync(join(ROOT, "assets", "buildings", "manifest.json"), "utf8"));
const F5 = Object.keys(BUILT.sprites).filter((n) => /^(terrace|shops|store|factory|depot)_\dx\d(_r)?$/.test(n));
const NAMES = [...Object.keys(manifest.sprites).filter(Y7), ...F5];
for (const name of F5) await layerOf(name);

/** The def of a name: the sheet cell for a Y7 sprite, its layer for F5 art. */
const defOf = (name) => manifest.sprites[name] ?? BUILT.sprites[name];

// Quadrant offsets: the footprint origin placed in each map quadrant.
const QUADRANTS = [[2, 2], [20, 3], [3, 22], [21, 21]];

const CELL_W = 260, CELL_H = 210;
const cols = QUADRANTS.length, rows = NAMES.length;
const W = cols * CELL_W, H = rows * CELL_H;
const dst = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { dst[i * 4] = 0xf2; dst[i * 4 + 1] = 0xf0; dst[i * 4 + 2] = 0xe8; dst[i * 4 + 3] = 255; }

/** Blit sprite frame 0 with its top-left at (dx, dy) — from the shared sheet
 *  or from the sprite's own layer PNG, whichever the name resolves to. */
function blitAt(name, dx, dy, frame = 0) {
  const fromSheet = Boolean(manifest.sprites[name]);
  const s = defOf(name);
  const src = fromSheet ? atlas : LAYERS.get(name);
  if (!src) return;
  const fwPx = s.w / (s.frames ?? 1);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < fwPx; x++) {
      const X = Math.floor(dx) + x, Y = Math.floor(dy) + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const si = fromSheet
        ? ((s.y + y) * atlas.info.width + (s.x + frame * fwPx + x)) * 4
        : (y * src.info.width + x) * 4;
      const di = (Y * W + X) * 4;
      const a = src.data[si + 3] / 255;
      if (a === 0) continue;
      dst[di] = dst[di] * (1 - a) + src.data[si] * a;
      dst[di + 1] = dst[di + 1] * (1 - a) + src.data[si + 1] * a;
      dst[di + 2] = dst[di + 2] * (1 - a) + src.data[si + 2] * a;
      dst[di + 3] = 255;
    }
  }
}

/** Yellow footprint diamond grid (the Y7 debug overlay). */
function footprintSvg(fw, fh, ox, oy) {
  const top = [ox, oy];
  const right = [ox + fw * HW, oy + fw * HH];
  const bottom = [ox + (fw - fh) * HW, oy + (fw + fh) * HH];
  const left = [ox - fh * HW, oy + fh * HH];
  let paths = `<path d="M${top[0]} ${top[1]} L${right[0]} ${right[1]} L${bottom[0]} ${bottom[1]} L${left[0]} ${left[1]} Z" fill="none" stroke="#e0c000" stroke-width="2"/>`;
  for (let ty = 0; ty < fh; ty++) {
    for (let tx = 0; tx < fw; tx++) {
      const x0 = ox + (tx - ty) * HW, y0 = oy + (tx + ty) * HH;
      paths += `<path d="M${x0} ${y0} L${x0 + HW} ${y0 + HH} L${x0} ${y0 + 2 * HH} L${x0 - HW} ${y0 + HH} Z" fill="none" stroke="#e0c000" stroke-width="1"/>`;
    }
  }
  return paths;
}

const svgParts = [];
NAMES.forEach((name, r) => {
  const [fw, fh] = defOf(name).footprint;
  QUADRANTS.forEach(([qx, qy], c) => {
    // Screen position of the footprint origin tile inside this sheet cell.
    // `drawnTop` is where the renderer's anchor contract puts a tile diamond's
    // top vertex (the same lattice terrain, track and structures share), so
    // the yellow grid is drawn in the lattice the game actually draws in.
    const ox = c * CELL_W + CELL_W / 2;
    const oy = r * CELL_H + 46;
    const [bx, by] = tileToScreen(qx, qy);
    const drawnTop = (tx, ty) => {
      const [sx, sy] = tileToScreen(tx, ty);
      return [ox + (sx - bx) + HW, oy + (sy - by) + 1];
    };
    // terrain underlay for each footprint tile (terrain anchor contract)
    for (let ty = 0; ty < fh; ty++) {
      for (let tx = 0; tx < fw; tx++) {
        const t = manifest.sprites.terrain_grass;
        const [sx, sy] = tileToScreen(qx + tx, qy + ty);
        blitAt("terrain_grass", ox + (sx - bx) + HW - t.anchor[0], oy + (sy - by) + TILE_H - t.anchor[1]);
      }
    }
    // the building, via the renderer's drawOrigin: building-layer art
    // (`center: true`) lands its anchor on the footprint CENTRE, sheet cells
    // on the south corner of tile (fw−1, fh−1).
    const [sx, sy] = tileToScreen(qx + fw - 1, qy + fh - 1);
    const s = defOf(name);
    const [ax, ay] = s.center
      ? [sx - (fw - fh) * (HW / 2), sy + TILE_H - (fw + fh) * (HH / 2)]
      : [sx, sy + TILE_H];
    blitAt(name, ox + (ax - bx) + HW - s.anchor[0], oy + (ay - by) - s.anchor[1]);
    const [gx, gy] = drawnTop(qx, qy);
    svgParts.push(`<g>${footprintSvg(fw, fh, gx, gy)}</g>`);
    svgParts.push(`<text x="${c * CELL_W + 6}" y="${r * CELL_H + 16}" font-family="monospace" font-size="11" fill="#333">${name} ${fw}×${fh} @(${qx},${qy})</text>`);
  });
});

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${svgParts.join("")}</svg>`;
await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0xf2, g: 0xf0, b: 0xe8, alpha: 255 } } })
  .composite([
    { input: Buffer.from(dst), raw: { width: W, height: H, channels: 4 }, top: 0, left: 0 },
    { input: Buffer.from(svg), top: 0, left: 0 },
  ])
  .png().toFile(OUT);
console.log("wrote", OUT, W, "x", H, `(${NAMES.length} buildings x ${QUADRANTS.length} quadrants)`);
