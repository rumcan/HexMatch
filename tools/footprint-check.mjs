#!/usr/bin/env node
/**
 * Y7 acceptance helper — footprint debug overlay.
 *
 * Renders every building cell over the yellow footprint diamond grid the Y7
 * bug was found with, once per map quadrant (a projection/anchor error often
 * only shows at offset), using the exact draw math of src/iso/depth.ts
 * (K4 `drawOrigin`: the anchor pixel lands on the footprint diamond's CENTRE)
 * against the built atlas.
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

const HW = 66, HH = 32;               // K0 — measured Kenney geometry
const tileToScreen = (tx, ty) => [(tx - ty) * HW, (tx + ty) * HH];

/** The buildings Y7 covers. Player tints share one geometry, so one tint per
 *  family stands in for the rest (the invariant test covers all of them). */
const NAMES = Object.keys(manifest.sprites).filter((n) =>
  /^(farm|forest|ore_mine|quarry|oil_rig|gold_mine|factory_blue|depot_blue)$/.test(n));

// Quadrant offsets: the footprint origin placed in each map quadrant.
const QUADRANTS = [[2, 2], [16, 3], [3, 16], [16, 16]];   // inside the 32×32 map

const CELL_W = 420, CELL_H = 330;
const cols = QUADRANTS.length, rows = NAMES.length;
const W = cols * CELL_W, H = rows * CELL_H;
const dst = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { dst[i * 4] = 0xf2; dst[i * 4 + 1] = 0xf0; dst[i * 4 + 2] = 0xe8; dst[i * 4 + 3] = 255; }

/** Blit sprite frame 0 with its top-left at (dx, dy). */
function blitAt(name, dx, dy, frame = 0) {
  const s = manifest.sprites[name];
  const fwPx = s.w / (s.frames ?? 1);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < fwPx; x++) {
      const X = Math.floor(dx) + x, Y = Math.floor(dy) + y;
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const si = ((s.y + y) * atlas.info.width + (s.x + frame * fwPx + x)) * 4;
      const di = (Y * W + X) * 4;
      const a = atlas.data[si + 3] / 255;
      if (a === 0) continue;
      dst[di] = dst[di] * (1 - a) + atlas.data[si] * a;
      dst[di + 1] = dst[di + 1] * (1 - a) + atlas.data[si + 1] * a;
      dst[di + 2] = dst[di + 2] * (1 - a) + atlas.data[si + 2] * a;
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
  const [fw, fh] = manifest.sprites[name].footprint;
  QUADRANTS.forEach(([qx, qy], c) => {
    // Screen position of the footprint origin tile inside this sheet cell.
    // `drawnTop` is where the renderer's anchor contract puts a tile diamond's
    // top vertex (the same lattice terrain, track and structures share), so
    // the yellow grid is drawn in the lattice the game actually draws in.
    const ox = c * CELL_W + CELL_W / 2;
    const oy = r * CELL_H + 46;
    const [bx, by] = tileToScreen(qx, qy);
    const drawnCentre = (tx, ty) => {
      const [sx, sy] = tileToScreen(tx, ty);
      return [ox + (sx - bx), oy + (sy - by)];
    };
    // terrain underlay for each footprint tile (terrain anchor contract)
    for (let ty = 0; ty < fh; ty++) {
      for (let tx = 0; tx < fw; tx++) {
        const t = manifest.sprites.terrain_grass;
        const [sx, sy] = tileToScreen(qx + tx, qy + ty);
        blitAt("terrain_grass", ox + (sx - bx) - t.anchor[0], oy + (sy - by) - t.anchor[1]);
      }
    }
    // the building, via drawOrigin (K4): anchor on the footprint's centre
    const s = manifest.sprites[name];
    const cx = qx + (fw - 1) / 2, cy = qy + (fh - 1) / 2;
    const [sx, sy] = tileToScreen(cx, cy);
    blitAt(name, ox + (sx - bx) - s.anchor[0], oy + (sy - by) - s.anchor[1]);
    // footprint grid drawn on the tile-centre lattice (top vertex = centre - HH)
    const [ccx, ccy] = drawnCentre(qx, qy);
    const gx = ccx, gy = ccy - HH;
    svgParts.push(`<g>${footprintSvg(fw, fh, gx, gy)}</g>`);
    svgParts.push(`<text x="${c * CELL_W + 6}" y="${r * CELL_H + 16}" font-family="monospace" font-size="11" fill="#333">${name} @(${qx},${qy})</text>`);
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
