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
 * Extended fields supported by this build (R1):
 *   crop: [x,y,w,h]                 direct crop from the source image.
 *   crops: [[x,y,w,h], ...]         per-frame direct crops (animated).
 *   anchor: [x,y]                   override the auto-measured anchor.
 *   compose: {...}                  build a multi-tile sprite from ground
 *                                   tile cells plus optional overlays.
 *   generator: "road" | "rail" | "highlight"
 *                                   emit 16 road/rail bitmask variants or one
 *                                   legal-placement highlight sprite.
 *   tint: [r,g,b]                   multiply opaque pixels toward a tint
 *                                   (used for the grey quarry reskin).
 *
 * Anchor contract: `anchor` is the pixel inside the sprite that lands on the
 * south corner of the footprint (the bottom vertex of the diamond of the tile
 * at (originX + w - 1, originY + h - 1)). The renderer draws with:
 *   drawX = floor(sx + HW - anchor[0] + camX)
 *   drawY = floor(sy + TILE_H - anchor[1] + camY)
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
const HW = CELL_W / 2, HH = CELL_H / 2;

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

/** True for the id-label blue/dark pixels (labelled text in OpenGFX sheets). */
function isLabelPixel(r, g, b, a) {
  if (a === 0) return false;
  // The sheet id labels are rendered as far more blue than the game art:
  // pure blue backing is keyed separately; label glyphs are ~(20,52,124).
  // White page pixels are handled by removeBorderWhite.
  return b > 90 && b > r + 30 && b > g + 30;
}

/** Remove white pixels connected to a crop border (page background, id labels), leaving interior white content intact. */
function removeBorderWhite(px, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (seen[i]) return;
    const pi = i * 4;
    if (px[pi] === 255 && px[pi + 1] === 255 && px[pi + 2] === 255 && px[pi + 3] === 255) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    px[i * 4 + 3] = 0;
    if (x > 0) push(x - 1, y);
    if (x + 1 < w) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < h) push(x, y + 1);
  }
}

/** Direct crop of an arbitrary source rect: key the blue backing, remove page white and id-label glyphs. */
async function cropDirect(sourcePath, rect) {
  const img = sharp(sourcePath, { limitInputPixels: false })
    .extract(rect)
    .ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 255 || isLabelPixel(data[i], data[i + 1], data[i + 2], data[i + 3])) {
      px[i] = px[i + 1] = px[i + 2] = 0; px[i + 3] = 0;
    } else {
      px[i] = data[i]; px[i + 1] = data[i + 1]; px[i + 2] = data[i + 2]; px[i + 3] = 255;
    }
  }
  removeBorderWhite(px, info.width, info.height);
  return { px, w: info.width, h: info.height };
}

function contentBottomCentre(px, w = CELL_W, h = CELL_H) {
  let minX = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = px[(y * w + x) * 4 + 3];
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

/** Layer an RGBA buffer onto a larger RGBA canvas. */
function blit(dst, src, dx, dy) {
  for (let y = 0; y < src.h; y++) {
    const sy = y + dy;
    if (sy < 0 || sy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const sx = x + dx;
      if (sx < 0 || sx >= dst.w) continue;
      const si = (y * src.w + x) * 4;
      const di = (sy * dst.w + sx) * 4;
      const a = src.px[si + 3] / 255;
      dst.px[di] = Math.round(dst.px[di] * (1 - a) + src.px[si] * a);
      dst.px[di + 1] = Math.round(dst.px[di + 1] * (1 - a) + src.px[si + 1] * a);
      dst.px[di + 2] = Math.round(dst.px[di + 2] * (1 - a) + src.px[si + 2] * a);
      dst.px[di + 3] = Math.max(dst.px[di + 3], src.px[si + 3]);
    }
  }
}

/** Multiply opaque pixels toward a tint (RGB 0..255). */
function tintPx(px, tint) {
  const tr = tint[0] / 255, tg = tint[1] / 255, tb = tint[2] / 255;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    px[i] = Math.round(px[i] * tr);
    px[i + 1] = Math.round(px[i + 1] * tg);
    px[i + 2] = Math.round(px[i + 2] * tb);
  }
}

/**
 * Build a multi-tile footprint sprite from ground cells + overlays.
 *
 * `compose` may be:
 *   { base:{source,box:[x,y]}, tiles:[{dx,dy,source?,box?}],
 *     overlays:[{source,crop:[x,y,w,h],dx,dy,anchor?,tint?}], frames:[...] }
 * Each frame gets the same base/tiles plus the frame's own `overlays`.
 * Overlay crops use the source-sheet content bounding box, so they never pull
 * in the blue backing or the id label.
 */
async function makeComposite(s) {
  const [fw, fh] = s.footprint;
  const topPad = 96;
  const W = (fw + fh) * HW;
  const H = (fw + fh) * HH + topPad;
  const originX = fh * HW, originY = topPad;
  const compose = s.compose ?? {};

  const frames = compose.frames?.length ? compose.frames : [compose];
  const cells = [];
  for (const frame of frames) {
    const dst = { px: Buffer.alloc(W * H * 4), w: W, h: H };
    const tiles = frame.tiles ?? compose.tiles ?? [];
    const base = frame.base ?? compose.base;

    if (base) {
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw; dx++) {
          const add = tiles.find((t) => t.dx === dx && t.dy === dy);
          const src = add?.source ?? base.source;
          const box = add?.box ?? base.box;
          if (!box) continue;
          const path = join(ROOT, CELLS.sources[src]);
          // Crop the 64-wide blue box plus enough vertical margin so the
          // content bbox is captured; cropDirect then clips the page white and
          // the blue backing. Aligning by the diamond's bottom-centre anchor
          // handles cells whose content is offset inside the blue box.
          const rect = add?.crop ?? [box[0], box[1], CELL_W, CELL_H + 8];
          const cell = await cropDirect(path, { left: rect[0], top: rect[1], width: rect[2], height: rect[3] });
          const anchor = contentBottomCentre(cell.px, cell.w, cell.h) ?? [Math.floor(cell.w / 2), cell.h - 1];
          const topX = originX + (dx - dy) * HW;
          const topY = originY + (dx + dy) * HH;
          const southX = topX, southY = topY + CELL_H;
          blit(dst, cell, Math.round(southX - anchor[0]), Math.round(southY - anchor[1]));
        }
      }
    } else {
      for (const tile of tiles) {
        if (!tile.box) continue;
        const path = join(ROOT, CELLS.sources[tile.source]);
        const cell = await cropDirect(path, { left: tile.box[0], top: tile.box[1], width: tile.box[2], height: tile.box[3] });
        const topX = originX + (tile.dx - tile.dy) * HW;
        const topY = originY + (tile.dx + tile.dy) * HH;
        blit(dst, cell, Math.round(topX - cell.w / 2), Math.round(topY + HH - cell.h));
      }
    }

    const overlays = [...(compose.overlays ?? []), ...(frame.overlays ?? [])];
    for (const ov of overlays) {
      const path = join(ROOT, CELLS.sources[ov.source]);
      const rect = ov.crop ?? ov.box;
      const cell = await cropDirect(path, { left: rect[0], top: rect[1], width: rect[2], height: rect[3] });
      if (ov.tint) tintPx(cell.px, ov.tint);
      const southX = originX + (ov.dx - ov.dy) * HW;
      const southY = originY + (ov.dx + ov.dy + 1) * HH;
      const ax = ov.anchor?.[0] ?? Math.floor(cell.w / 2);
      const ay = ov.anchor?.[1] ?? cell.h - 1;
      blit(dst, cell, Math.round(southX - ax), Math.round(southY - ay));
    }

    cells.push({ px: dst.px, w: W, h: H });
  }

  const anchor = s.anchor ?? [fw * HW, topPad + (fw + fh - 1) * HH];
  return { cells, cellW: W, cellH: H, anchor, footprint: s.footprint, frames: cells.length, frameMs: s.frameMs ?? 200 };
}

/** Generate 16 road/rail bitmask cells, or one highlight cell. */
function makeGenerated(s, gen) {
  const name = s.name;
  const n = gen === "highlight" ? 1 : 16;
  const out = [];
  const color = gen === "rail" ? [122, 82, 36] : gen === "road" ? [86, 86, 86] : [255, 220, 40];
  // Use the four face midpoints of the diamond for the four directions.
  const dirs = {
    1: { a: [32, 16], b: [0, 0] },    // NE: top edge midpoint -> top vertex
    2: { a: [32, 16], b: [64, 32] },  // SE: right edge midpoint -> right vertex
    4: { a: [32, 16], b: [64, 64] },  // SW: bottom-right edge midpoint -> bottom vertex
    8: { a: [32, 16], b: [0, 32] },   // NW: left edge midpoint -> left vertex
  };
  for (let v = 0; v < n; v++) {
    const bits = gen === "highlight" ? 0 : v;
    const px = Buffer.alloc(CELL_W * CELL_H * 4);
    const cx = CELL_W / 2, cy = CELL_H / 2;
    for (const [bit, d] of Object.entries(dirs)) {
      if (!((bits & Number(bit)) !== 0)) continue;
      // Draw a thick line from center to the edge midpoint along the edge.
      const [ax, ay] = d.a, [bx, by] = d.b;
      // We draw the "half piece" for the centre-to-edge length.
      const ex = cx + (bx - ax) * 0.5;
      const ey = cy + (by - ay) * 0.5;
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          const dist = pointSegDist(x + 0.5, y + 0.5, cx, cy, ex, ey);
          if (dist < (gen === "highlight" ? 2 : 3.2)) {
            const i = (y * CELL_W + x) * 4;
            px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = gen === "highlight" ? 170 : 255;
          }
        }
      }
    }
    if (gen === "highlight") {
      // Add a translucent diamond wash + magenta outline.
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          const dx = Math.abs(x + 0.5 - cx), dy = Math.abs(y + 0.5 - cy);
          const edgeDist = Math.max(dx / 32 + dy / 16);
          if (Math.abs(edgeDist - 1) < 0.05) {
            const i = (y * CELL_W + x) * 4;
            px[i] = 255; px[i + 1] = 0; px[i + 2] = 200; px[i + 3] = 255;
          } else if (edgeDist < 1) {
            const i = (y * CELL_W + x) * 4;
            if (px[i + 3] === 0) { px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = 80; }
          }
        }
      }
    }
    out.push({ px, w: CELL_W, h: CELL_H });
  }
  return {
    cells: out,
    cellW: CELL_W, cellH: CELL_H,
    anchor: [CELL_W / 2, CELL_H - 1],
    footprint: [1, 1],
    frames: 1, frameMs: s.frameMs,
    name,
  };
}

function pointSegDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
  return Math.sqrt(dx * dx + dy * dy);
}

async function buildSlot(s) {
  if (s.generator === "road" || s.generator === "rail") {
    const generated = makeGenerated(s, s.generator);
    const templates = [];
    for (const maskName of [...Array(16).keys()].map((v) => v.toString(2).padStart(4, "0"))) {
      const idx2 = parseInt(maskName, 2);
      const cell = generated.cells[idx2];
      templates.push({
        name: `${s.namePrefix ?? s.name}_${maskName}`,
        cells: [cell],
        cellW: generated.cellW, cellH: generated.cellH,
        anchor: generated.anchor, footprint: [1, 1], frames: 1, frameMs: s.frameMs,
      });
    }
    return templates;
  }
  if (s.generator === "highlight") {
    const generated = makeGenerated(s, "highlight");
    return [{ name: s.name, cells: generated.cells, cellW: generated.cellW, cellH: generated.cellH, anchor: generated.anchor, footprint: [1, 1], frames: 1, frameMs: s.frameMs }];
  }
  if (s.compose) {
    const comp = await makeComposite(s);
    return [{ name: s.name, ...comp }];
  }
  if (s.crops || s.crop) {
    const rects = s.crops ?? [s.crop];
    const srcPath = join(ROOT, CELLS.sources[s.source]);
    const cells = [];
    for (const r of rects) {
      const c = await cropDirect(srcPath, { left: r[0], top: r[1], width: r[2], height: r[3] });
      if (s.tint) tintPx(c.px, s.tint);
      cells.push(c);
    }
    const w = rects[0][2], h = rects[0][3];
    const anchor = s.anchor ?? [Math.floor(w / 2), h - 1];
    return [{ name: s.name, cells, cellW: w, cellH: h, anchor, footprint: s.footprint, frames: cells.length, frameMs: s.frameMs ?? 200 }];
  }
  // Classic 64x32 blue-box ground cells.
  const path = join(ROOT, CELLS.sources[s.source]);
  const boxes = s.boxes ?? [s.box];
  const frames = boxes.length;
  const cells = [];
  for (const [bx, by] of boxes) {
    const probe = sharp(path, { limitInputPixels: false })
      .extract({ left: bx, top: by + 31, width: CELL_W, height: 1 })
      .ensureAlpha().raw();
    const probeBuf = await probe.toBuffer();
    let extra = 0;
    for (let x = 0; x < CELL_W; x++) {
      const i = x * 4;
      if (!(probeBuf[i] === 0 && probeBuf[i + 1] === 0 && probeBuf[i + 2] === 255)) { extra = 1; break; }
    }
    const cell = await cropSprite(path, bx, by, extra);
    cells.push({ px: cell.px, w: CELL_W, h: CELL_H });
  }
  const anchor = s.anchor ?? (s.footprint[0] === 1 && s.footprint[1] === 1
    ? [CELL_W / 2, CELL_H - 1]
    : (contentBottomCentre(cells[0].px) ?? [CELL_W / 2, CELL_H - 1]));
  return [{ name: s.name, cells, cellW: CELL_W, cellH: CELL_H, anchor, footprint: s.footprint, frames, frameMs: s.frameMs ?? 200 }];
}

async function run() {
  // resolve all sprite frames' raw cells at 1x
  const slots = [];
  for (const s of CELLS.sprites) {
    const built = await buildSlot(s);
    slots.push(...built);
  }

  // atlas layout: pack slot rects row-major
  const gap = 4;
  const packW = 1024;
  let atlasW = gap, atlasH = gap + 256;
  const placements = [];
  {
    let x = gap, y = gap, maxY = gap + 256, rowMaxX = gap;
    for (const s of slots) {
      const w = s.cellW * s.frames;
      const h = s.cellH;
      if (x + w + gap > packW) { x = gap; y = maxY + gap; maxY = y + h; rowMaxX = gap; }
      placements.push({ ...s, x, y });
      x += w + gap;
      if (x > rowMaxX) rowMaxX = x;
      atlasW = Math.max(atlasW, rowMaxX + gap);
      atlasH = Math.max(atlasH, maxY + gap);
      maxY = Math.max(maxY, y + h);
    }
  }

  const manifest = {
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
    const f = p.frames > 1 ? { w: p.cellW * p.frames, frames: p.frames, frameMs: p.frameMs } : { w: p.cellW };
    manifest.sprites[p.name] = {
      x: p.x, y: p.y, h: p.cellH, footprint: p.footprint, anchor: p.anchor, ...f,
    };
  }

  // build each scale
  for (const z of ZOOMS) {
    const w = Math.round(atlasW * z), h = Math.round(atlasH * z);
    const canvas = sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    const layers = [];
    for (const p of placements) {
      for (let fi = 0; fi < p.cells.length; fi++) {
        const c = p.cells[fi];
        let img = sharp(Buffer.from(c.px), { raw: { width: c.w, height: c.h, channels: 4 } }).ensureAlpha();
        if (z !== 1) img = img.resize(Math.round(c.w * z), Math.round(c.h * z), { kernel: "nearest" });
        const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
        const frameOff = fi * Math.round(p.cellW * z);
        layers.push({
          input: Buffer.from(data),
          raw: { width: info.width, height: info.height, channels: 4 },
          left: Math.round(p.x * z) + frameOff,
          top: Math.round(p.y * z),
        });
      }
    }
    const comp = layers.length ? canvas.composite(layers) : canvas;
    await comp.png().toFile(join(OUT, `atlas@${z}x.png`));
    console.log(`atlas@${z}x.png ${w}x${h}`);
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));

  // ── contact sheet: tile-grid background, sprite flush on footprint, magenta anchor ──
  const bg = 0xf2f0e8;
  const gridW = 900, minH = 620;
  const bgLayers = [];
  {
    const svg = `<svg width="${gridW}" height="${minH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#${bg.toString(16)}"/>
    </svg>`;
    bgLayers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }
  const sheetLayers = [];
  const cellPx = 64; // nominal screen cell for spacing; sprites may be wider
  const margin = 48;
  const perCol = Math.floor((gridW - margin) / (cellPx + 14));
  const N = placements.length;
  const nCols = Math.min(perCol, N);
  const nRows = Math.ceil(N / nCols);
  const rowH = 180 + 34;
  const totalH = Math.max(minH, nRows * rowH + 48);
  let labelIdx = 0;
  for (const p of placements) {
    const col = labelIdx % nCols, row = Math.floor(labelIdx / nCols);
    const ox = margin + col * (cellPx + 14) + cellPx / 2;   // footprint top-vertex x
    const oy = 30 + row * rowH;                              // footprint top-vertex y
    const [fw, fh] = p.footprint;
    // full footprint diamond corners (top/right/bottom/left) around origin at (ox,oy)
    const top = [ox, oy];
    const right = [ox + fw * HW, oy + fw * HH];
    const bottom = [ox + (fw - fh) * HW, oy + (fw + fh) * HH];
    const left = [ox - fh * HW, oy + fh * HH];
    const path = `M${top[0]} ${top[1]} L${right[0]} ${right[1]} L${bottom[0]} ${bottom[1]} L${left[0]} ${left[1]} Z`;
    // anchor should land at the south corner of the footprint's bottom tile.
    const anchorScreen = [ox + (fw - fh) * HW, oy + (fw + fh - 1) * HH];
    const drawX = Math.round(anchorScreen[0] - p.anchor[0]);
    const drawY = Math.round(anchorScreen[1] - p.anchor[1]);
    const svg = `<svg width="${gridW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
      <path d="${path}" fill="none" stroke="#a0a0a0" stroke-width="1"/>
      <rect x="${Math.round(anchorScreen[0] - 2)}" y="${Math.round(anchorScreen[1] - 2)}" width="4" height="4" fill="magenta"/>
      <text x="${ox}" y="${oy + (fw + fh) * HH + 24}" font-family="monospace" font-size="10" text-anchor="middle" fill="#333">${p.name}</text>
    </svg>`;
    sheetLayers.push({ input: Buffer.from(svg), top: 0, left: 0 });
    const c0 = p.cells[0];
    sheetLayers.push({
      input: Buffer.from(c0.px), raw: { width: c0.w, height: c0.h, channels: 4 },
      left: Math.max(0, drawX), top: Math.max(0, drawY),
    });
    labelIdx++;
  }
  const base = sharp({ create: { width: gridW, height: totalH, channels: 4, background: { r: 0xf2, g: 0xf0, b: 0xe8, alpha: 255 } } });
  await base.composite([...bgLayers, ...sheetLayers]).png().toFile(join(OUT, "contact-sheet.png"));
  console.log("contact-sheet.png", gridW, "x", totalH);
  console.log("manifest.json", Object.keys(manifest.sprites).length, "sprites");
}

run().catch((e) => { console.error(e); process.exit(1); });
