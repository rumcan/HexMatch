#!/usr/bin/env node
/**
 * E1 atlas slicer — packs OpenGFX cell crops into @1x/@2x/@0.5x atlases,
 * a shared manifest and a debug contact sheet.
 *
 * Usage:
 *   node tools/slice-atlas.mjs
 *
 * Input : tools/iso-atlas.cells.json
 * Output: assets/iso-atlas/atlas@1x.png | atlas@2x.png | atlas@0.5x.png
 *         assets/iso-atlas/manifest.json
 *         assets/iso-atlas/contact-sheet.png
 *
 * Cell semantics (see tools/iso-atlas.cells.json):
 *   sprite { name, source, box|[x,y] | boxes:[x,y][] (animation frames),
 *            frames, frameMs, footprint:[w,h] }
 * A box is the top-left corner of the sprite's 64px-wide blue tile box in
 * the source sheet. Crop = 64x31 (the tile) + one extra bottom row when the
 * sheet row below the box is content (OpenGFX's 1px overlap row), else the
 * tile's own bottom row is cloned — so stacked ground tiles never leave a
 * hole under the diamond tip.
 *
 * Anchor contract: `anchor` is the pixel inside the sprite that lands on the
 * south corner of the footprint. For these ground tiles it is measured as
 * the bottom-centre of the keyed content, snapped to the cell bottom, which
 * reproduces the artist's intended diamond placement without hand-tuning.
 *
 * The manifest stores 1x coordinates + anchors; renderers scale coordinates
 * by the active zoom and pick the matching atlas image from `images`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CELLS = JSON.parse(readFileSync(join(ROOT, "tools/iso-atlas.cells.json"), "utf8"));
const OUT = join(ROOT, "assets/iso-atlas");
const ZOOMS = [1, 2, 0.5];
const CELL_W = 64, CELL_H = 32;

/** Key #0000FF -> transparent; crop `box` 64x31 + overlap handling; returns RGBA buffer 64x32. */
async function cropSprite(sourcePath, boxX, boxY, extraRows) {
  const img = sharp(sourcePath, { limitInputPixels: false })
    .extract({ left: boxX, top: boxY, width: CELL_W, height: 31 + extraRows })
    .ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const h = info.height; // 31 or 32
  const px = Buffer.alloc(CELL_W * CELL_H * 4);
  const key = (i) =>
    data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const s = (y * CELL_W + x) * 4;
      const d = (y * CELL_W + x) * 4;
      if (key(s)) {
        px[d] = px[d + 1] = px[d + 2] = 0; px[d + 3] = 0;
      } else {
        px[d] = data[s]; px[d + 1] = data[s + 1]; px[d + 2] = data[s + 2]; px[d + 3] = 255;
      }
    }
  }
  if (h === 31) {
    // clone the bottom content row (diamond tip) into row 31
    px.copy(px, 31 * CELL_W * 4, 30 * CELL_W * 4, 31 * CELL_W * 4);
  }
  return { px, hasOverlap: h === 32 };
}

function contentBottomCentre(px) {
  let minX = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const a = px[(y * CELL_W + x) * 4 + 3];
      if (a > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return [Math.floor((minX + maxX) / 2), maxY];
}

async function run() {
  // resolve all sprite frames' raw cells at 1x
  const slots = [];   // { name, px(64x32 RGBA), anchor, footprint, frames, frameMs }
  for (const s of CELLS.sprites) {
    const path = join(ROOT, CELLS.sources[s.source]);
    const boxes = s.boxes ?? [s.box];
    const frames = boxes.length;
    const cells = [];
    for (const [bx, by] of boxes) {
      // extra bottom row exists when the source has content there: probe sheet row
      const probe = sharp(path, { limitInputPixels: false })
        .extract({ left: bx, top: by + 31, width: CELL_W, height: 1 })
        .ensureAlpha().raw();
      const probeBuf = await probe.toBuffer();
      let extra = 0;
      for (let x = 0; x < CELL_W; x++) {
        const i = x * 4;
        if (!(probeBuf[i] === 0 && probeBuf[i + 1] === 0 && probeBuf[i + 2] === 255)) { extra = 1; break; }
      }
      cells.push(await cropSprite(path, bx, by, extra));
    }
    // Anchor: the pixel that lands on the footprint's south corner.
    // 1x1 ground tiles use the exact cell bottom-centre: with the crop at the
    // sheet box, drawing anchor (32,32) at the corner puts the diamond top at
    // the tile top-vertex and the (cloned) tip at the corner — seam-free
    // tessellation. Multi-tile sprites measure bottom-centre of content.
    const anchor = s.footprint[0] === 1 && s.footprint[1] === 1
      ? [CELL_W / 2, CELL_H - 1]
      : (contentBottomCentre(cells[0].px) ?? [CELL_W / 2, CELL_H - 1]);
    slots.push({
      name: s.name, cells: cells.map((c) => c.px),
      anchor, footprint: s.footprint, frames, frameMs: s.frameMs ?? 200,
    });
  }

  // atlas layout: pack slot rects row-major; each slot is frames*cellW wide
  const cellW = CELL_W, cellH = CELL_H;
  const gap = 4;
  const packW = 1024;
  let atlasW = gap, atlasH = gap + cellH;
  const placements = [];
  {
    let x = gap, y = gap, maxY = gap + cellH, rowMaxX = gap;
    for (const s of slots) {
      const w = cellW * s.frames;
      if (x + w + gap > packW) { x = gap; y = maxY + gap; maxY = y + cellH; rowMaxX = gap; }
      placements.push({ ...s, x, y });
      x += w + gap;
      if (x > rowMaxX) rowMaxX = x;
      atlasW = Math.max(atlasW, rowMaxX + gap);
      atlasH = Math.max(atlasH, maxY + gap);
    }
  }

  const manifest = {
    image: "atlas@1x.png",
    images: { "0.5": "atlas@0.5x.png", "1": "atlas@1x.png", "2": "atlas@2x.png" },
    tileW: CELLS.tileW, tileH: CELLS.tileH,
    meta: {
      source: "OpenGFX (https://github.com/OpenTTD/OpenGFX), GPLv2",
      generatedBy: "tools/slice-atlas.mjs",
      note: "coordinates and anchors are at 1x; multiply by zoom for @2x/@0.5x",
    },
    sprites: {},
  };
  for (const p of placements) {
    const f = p.frames > 1 ? { w: cellW * p.frames, frames: p.frames, frameMs: p.frameMs } : { w: cellW };
    manifest.sprites[p.name] = {
      x: p.x, y: p.y, h: cellH, footprint: p.footprint, anchor: p.anchor, ...f,
    };
  }

  // build each scale
  for (const z of ZOOMS) {
    const w = Math.round(atlasW * z), h = Math.round(atlasH * z);
    const canvas = sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    const layers = [];
    for (const p of placements) {
      for (let fi = 0; fi < p.cells.length; fi++) {
        const buf = Buffer.from(p.cells[fi]);
        let img = sharp(buf, { raw: { width: CELL_W, height: CELL_H, channels: 4 } }).ensureAlpha();
        if (z !== 1) img = img.resize(Math.round(CELL_W * z), Math.round(CELL_H * z), { kernel: "nearest" });
        const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        const frameOff = fi * Math.round(CELL_W * z);
        layers.push({
          input: Buffer.from(data),
          raw: { width: info.width, height: info.height, channels: 4 },
          left: Math.round(p.x * z) + frameOff,
          top: Math.round(p.y * z),
        });
      }
    }
    const comp = layers.length
      ? canvas.composite(layers)
      : canvas;
    await comp.png().toFile(join(OUT, `atlas@${z}x.png`));
    console.log(`atlas@${z}x.png ${w}x${h}`);
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  // ── contact sheet: tile-grid background, sprite flush on footprint, magenta anchor ──
  const bg = 0xf2f0e8;
  const gridW = 800, gridH = 560;
  const bgLayers = [];
  {
    const svg = `<svg width="${gridW}" height="${gridH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#${bg.toString(16)}"/>
    </svg>`;
    bgLayers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }
  const sheetLayers = [];
  const cellPx = 64;
  const areaW = gridW, margin = 40;
  const perCol = Math.floor((areaW - margin) / (cellPx + 14));
  const N = placements.length;
  const nCols = Math.min(perCol, N);
  const nRows = Math.ceil(N / nCols);
  const rowH = 64 + 34;
  const totalH = Math.max(gridH, nRows * rowH + 40);
  let labelIdx = 0;
  for (const p of placements) {
    const col = labelIdx % nCols, row = Math.floor(labelIdx / nCols);
    const ox = margin + col * (cellPx + 14) + cellPx / 2;   // tile top-vertex x
    const oy = 30 + row * rowH;                              // tile top-vertex y
    // diamond outline + anchor + name
    const t = `<svg width="${gridW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">`;
    const path = `M${ox} ${oy} L${ox + 32} ${oy + 16} L${ox} ${oy + 32} L${ox - 32} ${oy + 16} Z`;
    const svg = `${t}<path d="${path}" fill="none" stroke="#a0a0a0" stroke-width="1"/>
      <rect x="${ox - 2}" y="${oy + 30}" width="4" height="4" fill="magenta"/>
      <text x="${ox}" y="${oy + 48}" font-family="monospace" font-size="10" text-anchor="middle" fill="#333">${p.name}</text></svg>`;
    sheetLayers.push({ input: Buffer.from(svg), top: 0, left: 0 });
    sheetLayers.push({ input: Buffer.from(p.cells[0]), raw: { width: cellPx, height: CELL_H, channels: 4 }, left: ox - 32, top: oy });
    labelIdx++;
  }
  const base = sharp({ create: { width: gridW, height: totalH, channels: 4, background: { r: 0xf2, g: 0xf0, b: 0xe8, alpha: 255 } } });
  await base.composite([...bgLayers, ...sheetLayers]).png().toFile(join(OUT, "contact-sheet.png"));
  console.log("contact-sheet.png", gridW, "x", totalH);
  console.log("manifest.json", Object.keys(manifest.sprites).length, "sprites");
}

run().catch((e) => { console.error(e); process.exit(1); });
