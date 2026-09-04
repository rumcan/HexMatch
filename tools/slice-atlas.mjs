#!/usr/bin/env node
/**
 * K1 atlas packer — Kenney edition. The OpenGFX pipeline (sheet slicing,
 * blue-key, PNML declarations, compose blocks, road/rail generators) is gone:
 * every cell in tools/iso-atlas.cells.json names ONE finished RGBA PNG under
 * src/iso/kenny and this tool only measures, (optionally) tints, packs and
 * re-scales it.
 *
 * Usage:
 *   node tools/make-derived-art.mjs   # once, after changing derived art
 *   node tools/slice-atlas.mjs
 *
 * Input : tools/iso-atlas.cells.json   (concept -> PNG path + kind)
 * Output: assets/iso-atlas/atlas@1x.png | @2x | @0.5x
 *         assets/iso-atlas/manifest.json
 *         assets/iso-atlas/contact-sheet.png
 *
 * Anchor contract (K0/K1 — computed, never hand-authored):
 *   tileToScreen(tx,ty) is the centre of the tile's diamond (the widest-row
 *   line). Every sprite carries `anchor` = the pixel that lands exactly on
 *   that centre point:
 *     kind ground/standing : [floor(w/2), widestRow]  — the widest opaque row
 *                            IS the base diamond's widest row, measured from
 *                            the pixels at pack time. A ground cell whose
 *                            widest row is not at y≈32 with near-full width
 *                            is a slope/ramp and FAILS the build (flat only).
 *     kind vehicle         : [floor(w/2), h]          — bottom-centre rests
 *                            on the tile surface.
 *   The renderer draws at (sx − anchor[0], sy − anchor[1]); buildings' base
 *   diamonds coincide with the tile diamond by construction, so nothing can
 *   float or sink (the K3 end of the compose/fragment saga).
 *
 * Kenney art is smooth 3D rendering, so the @0.5x/@2x variants are resampled
 * with lanczos3 (the old nearest-neighbour scaling was for pixel art). The
 * renderer still never scales inside drawImage — 1:1 blits only (E0).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CELLS = JSON.parse(readFileSync(join(ROOT, "tools/iso-atlas.cells.json"), "utf8"));
const OUT = join(ROOT, "assets/iso-atlas");
const ZOOMS = [1, 2, 0.5];
const TILE_W = CELLS.tileW, TILE_H = CELLS.tileH;      // 132 x 64
const HW = TILE_W / 2;                                  // 66
const PACK_W = 1600, GAP = 8;

/** Load one source PNG as raw RGBA at 1x. */
async function loadPng(rel) {
  const { data, info } = await sharp(join(ROOT, CELLS.source.root, rel))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: Buffer.from(data), w: info.width, h: info.height, rel };
}

/** Widest opaque row (alpha > 10): the base diamond's widest row. */
function widestRow(c) {
  let widest = -1, yAt = -1;
  for (let y = 0; y < c.h; y++) {
    let n = 0;
    for (let x = 0; x < c.w; x++) if (c.px[(y * c.w + x) * 4 + 3] > 10) n++;
    if (n > widest) { widest = n; yAt = y; }
  }
  return { width: widest, y: yAt };
}

/** Luminance-preserving player tint (V2): keeps the art's shading, swaps hue. */
function tintLumPx(px, tint, keep = 0.28) {
  const tr = tint[0] / 255, tg = tint[1] / 255, tb = tint[2] / 255;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const lum = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
    const v = Math.min(1.2, lum * 1.45 + 0.10);
    px[i] = Math.min(255, Math.round(255 * v * (keep + (1 - keep) * tr)));
    px[i + 1] = Math.min(255, Math.round(255 * v * (keep + (1 - keep) * tg)));
    px[i + 2] = Math.min(255, Math.round(255 * v * (keep + (1 - keep) * tb)));
  }
}

/**
 * K1/K2 flat-only filter: a `ground` cell must be a flat-topped block — its
 * widest opaque row sits at y≈TILE_H/2 and spans (nearly) the full tile width.
 * Slope/ramp tiles have their widest row well below y≈32 and fail here.
 */
function anchorFor(cell, c) {
  const cx = Math.floor(c.w / 2);
  if (cell.kind === "vehicle") return { anchor: [cx, c.h], widest: null };
  const m = widestRow(c);
  if (cell.kind === "ground") {
    if (Math.abs(m.y - TILE_H / 2) > 4)
      throw new Error(
        `${cell.name}: widest row at y=${m.y}, expected ≈${TILE_H / 2} — ` +
        `slope/ramp tiles are rejected (flat only, K2)`);
    if (m.width < TILE_W - 10)
      throw new Error(`${cell.name}: widest row ${m.width}px < ${TILE_W - 10} — not a ground block`);
  } else if (cell.kind !== "standing") {
    throw new Error(`${cell.name}: unknown kind ${cell.kind}`);
  }
  return { anchor: [cx, m.y], widest: m };
}

async function run() {
  const slots = [];
  for (const cell of CELLS.sprites) {
    if (typeof cell.png !== "string")
      throw new Error(`cell ${cell.name}: no png (K1 — every cell names one Kenney PNG)`);
    const c = await loadPng(cell.png);
    if (cell.tintLum) tintLumPx(c.px, cell.tintLum);
    const { anchor } = anchorFor(cell, c);
    slots.push({ name: cell.name, cell, px: c.px, w: c.w, h: c.h, anchor });
    console.log(`${cell.name.padEnd(16)} ${String(c.w).padStart(3)}x${String(c.h).padEnd(4)} anchor=${anchor}  <- ${cell.png}`);
  }

  // ── shelf pack at 1x ────────────────────────────────────────────────────
  let x = GAP, y = GAP, rowH = 0;
  const placements = [];
  for (const s of slots) {
    if (x + s.w + GAP > PACK_W) { x = GAP; y += rowH + GAP; rowH = 0; }
    placements.push({ ...s, x, y });
    x += s.w + GAP;
    rowH = Math.max(rowH, s.h);
  }
  const atlasW = Math.max(...placements.map((p) => p.x + p.w)) + GAP;
  const atlasH = y + rowH + GAP;

  const manifest = {
    images: { "0.5": "atlas@0.5x.png", "1": "atlas@1x.png", "2": "atlas@2x.png" },
    tileW: CELLS.tileW,
    tileH: CELLS.tileH,
    meta: {
      source: `${CELLS.source.author} isometric assets (${CELLS.source.root})`,
      license: CELLS.source.license,
      generatedBy: "tools/slice-atlas.mjs (K1 packer)",
      note: "coordinates and anchors are at 1x; multiply by zoom for @2x/@0.5x. " +
        "anchor = the sprite pixel that lands on the tile's diamond centre " +
        "(measured widest base-diamond row; bottom-centre for vehicles).",
    },
    sprites: {},
  };
  for (const p of placements) {
    manifest.sprites[p.name] = {
      x: p.x, y: p.y, w: p.w, h: p.h,
      footprint: p.cell.footprint, anchor: p.anchor,
      // ground | standing | vehicle — vehicles are deliberately smaller than
      // their tile (a truck is ~35px on a 132px tile), so footprint-span
      // invariants only apply to ground/standing art.
      kind: p.cell.kind,
    };
  }

  // ── one atlas per zoom: cells resampled individually (smooth art → lanczos3)
  for (const z of ZOOMS) {
    const W = Math.round(atlasW * z), H = Math.round(atlasH * z);
    const layers = [];
    for (const p of placements) {
      let img = sharp(Buffer.from(p.px), { raw: { width: p.w, height: p.h, channels: 4 } }).ensureAlpha();
      if (z !== 1) img = img.resize(Math.round(p.w * z), Math.round(p.h * z), { kernel: "lanczos3" });
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
      layers.push({
        input: Buffer.from(data),
        raw: { width: info.width, height: info.height, channels: 4 },
        left: Math.round(p.x * z), top: Math.round(p.y * z),
      });
    }
    const base = sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    await base.composite(layers).png().toFile(join(OUT, `atlas@${z}x.png`));
    console.log(`atlas@${z}x.png ${W}x${H}`);
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  // ── contact sheet: every sprite flush on its footprint diamond ──────────
  // Grid of 1x1 footprint diamonds (TILE_W x TILE_H) drawn at their screen
  // positions; the sprite is composited with its anchor pixel exactly on the
  // diamond centre — the same math as renderer.drawOrigin — and a magenta dot
  // marks the anchor. A mis-anchored sprite visibly floats or sinks.
  const COLS = 6;
  const colStep = TILE_W + 70;
  const rowStep = TILE_H + 140;
  const rows = Math.ceil(placements.length / COLS);
  const sheetW = COLS * colStep + 40;
  const sheetH = rows * rowStep + 60;
  const layers = [];
  {
    const paths = [];
    for (let i = 0; i < placements.length; i++) {
      const col = i % COLS, row = Math.floor(i / COLS);
      const cx = 40 + col * colStep + TILE_W / 2;   // diamond centre
      const cy = 40 + row * rowStep + TILE_H / 2;
      const [fw, fh] = placements[i].cell.footprint;
      // outline every tile diamond of the footprint (all cells are 1x1 today)
      for (let ty = 0; ty < fh; ty++) for (let tx = 0; tx < fw; tx++) {
        const ox = cx + (tx - ty) * HW, oy = cy - TILE_H / 2 + (tx + ty) * (TILE_H / 2);
        paths.push(
          `M${ox} ${oy} L${ox + HW} ${oy + TILE_H / 2} L${ox} ${oy + TILE_H} L${ox - HW} ${oy + TILE_H / 2} Z`);
      }
      const label = placements[i].name.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      paths.push(
        `<rect x="${cx - 2}" y="${cy - 2}" width="4" height="4" fill="magenta"/>` +
        `<text x="${cx}" y="${cy + TILE_H / 2 + 26}" font-family="monospace" font-size="12" ` +
        `text-anchor="middle" fill="#333">${label}</text>`);
    }
    const svg = `<svg width="${sheetW}" height="${sheetH}" xmlns="http://www.w3.org/2000/svg">` +
      `<rect width="100%" height="100%" fill="#f2f0e8"/>` +
      `<g fill="none" stroke="#d8c020" stroke-width="1.5">${paths.filter((p) => p.startsWith("M")).map((d) => `<path d="${d}"/>`).join("")}</g>` +
      paths.filter((p) => !p.startsWith("M")).join("") + `</svg>`;
    layers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const col = i % COLS, row = Math.floor(i / COLS);
    const cx = 40 + col * colStep + TILE_W / 2;
    const cy = 40 + row * rowStep + TILE_H / 2;
    layers.push({
      input: Buffer.from(p.px), raw: { width: p.w, height: p.h, channels: 4 },
      left: Math.max(0, Math.round(cx - p.anchor[0])),
      top: Math.max(0, Math.round(cy - p.anchor[1])),
    });
  }
  await sharp({ create: { width: sheetW, height: sheetH, channels: 4, background: { r: 0xf2, g: 0xf0, b: 0xe8, alpha: 255 } } })
    .composite(layers).png().toFile(join(OUT, "contact-sheet.png"));
  console.log("contact-sheet.png", sheetW, "x", sheetH);
  console.log("manifest.json", Object.keys(manifest.sprites).length, "sprites");
}

run().catch((e) => { console.error(e); process.exit(1); });
