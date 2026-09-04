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
 *   sprite { name, source?, sprite?, footprint:[w,h], frames?, frameMs? }
 *
 * Y4c/Y3/Y7/Y5 — every cell is now *declaration-driven*. There is no
 * generator left for road/rail and no `compose`/`box`/`crop`/`tiles` arrays:
 *
 *   layers:   [{ sprite, tint? }, …] plus optional `frames: [[{sprite,tint?}…], …]`
 *             Each layer is a declared OpenGFX sprite drawn at
 *             `dest = tileOrigin + (xrel, yrel)` — OpenTTD's own placement
 *             rule — onto one shared canvas (Y7). The first layer is
 *             conventionally the declared ground tile so the cell always
 *             spans its tile diamond; extra layers are the building(s).
 *             `tint` multiplies opaque pixels toward a colour (player
 *             colours, the grey quarry reskin).
 *   trackset: { mode: "flat" | "overlays", … }
 *             "flat"     — the 16 road masks are OpenGFX's *finished* flat
 *                          road tiles (1332–1350). The mask is converted to
 *                          OpenTTD RoadBits (see toOpenttdRoadBits in
 *                          src/iso/track.ts) and indexes OpenTTD's flat
 *                          selection table; the declared sprite is blitted
 *                          verbatim. Nothing is generated.
 *             "overlays" — OpenGFX's rail set is ground + per-piece overlays
 *                          rather than 16 finished tiles, so a rail mask
 *                          draws the declared grass ground plus every
 *                          declared overlay piece whose two directions are
 *                          both set in the mask.
 *   generator: "highlight" | "highlight_soft"
 *             The two placement-glow cells are the only procedural sprites
 *             left (they are UI, not OpenGFX art).
 *
 * Anchor contract (Y5): `anchor` is never hand-authored. It is DERIVED from
 * the declared offsets: the pixel of the cell that must land on the south
 * corner of the footprint is the cell-local position of the cell's tile
 * origin (the top vertex of the tile the declared ground sits on), which the
 * renderer's `drawOrigin` places at (sx + HW, sy + TILE_H). With the origin
 * at cell-local (-minX, -minY):
 *     anchor = (-minX + 1, -minY + 31)
 * For a lone 64x31 ground tile this yields (32, 31) — the value terrain has
 * always had — so the derivation is a generalisation, not a change, of the
 * existing contract. Declared sprites carry NOCROP to mean "trust the
 * declared rect"; this slicer never trims a declared rect nor re-measures a
 * content bbox to move the anchor, which is what honouring NOCROP means here.
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

// ── Y1: declared sprite geometry ─────────────────────────────────────────
// Every cell references an OpenGFX sprite id (`sprite`, `layers[].sprite`,
// `trackset.base/ground/pieces[].sprite`) and the crop rect is taken from the
// declarations emitted by parse-pnml.mjs, never hand-authored in the cells
// file. The JSON is a build artifact (it is gitignored); generate it first:
//     node tools/parse-pnml.mjs
const OPENG = (() => {
  const p = join(ROOT, "tools/opengfx-sprites.json");
  try { return JSON.parse(readFileSync(p, "utf8")); }
  catch { throw new Error(`missing ${p} — run \`node tools/parse-pnml.mjs\` first`); }
})();

/** Declared entry for a sprite id. */
function declaredOf(id) {
  const d = OPENG[String(id)];
  if (!d) throw new Error(`unknown declared sprite id ${id}`);
  return d;
}

/** Map an OpenGFX file path (`sprites/png/…`) to its local mirror under src/assets/sprites/png. */
function declaredLocalPath(file) {
  return join(ROOT, "src/assets/sprites/png", file.replace(/^sprites\/png\//, ""));
}

// ── Y4c: OpenTTD's flat road selection table ──────────────────────────────
// Indexed by OpenTTD RoadBits (NW=1 SW=2 SE=4 NE=8 — see toOpenttdRoadBits in
// src/iso/track.ts), the value is the offset from the set's base sprite id
// (road 1332). OpenGFX ships the finished flat tiles; this table is OpenTTD's
// own GetRoadSpriteOffset-style selection order, so mask → declared sprite
// with nothing generated in between.
const OPENTTD_FLAT_TRACK_TABLE = [0, 18, 17, 7, 16, 0, 10, 5, 15, 8, 1, 4, 9, 3, 6, 2];

/** This project's direction bits (NE=1 SE=2 SW=4 NW=8) → OpenTTD RoadBits. */
function toOpenttdRoadBits(bits) {
  let out = 0;
  if (bits & 1) out |= 8;   // NE
  if (bits & 2) out |= 4;   // SE
  if (bits & 4) out |= 2;   // SW
  if (bits & 8) out |= 1;   // NW
  return out & 0b1111;
}

/** True for the id-label blue/dark pixels (labelled text in OpenGFX sheets). */
function isLabelPixel(r, g, b, a) {
  if (a === 0) return false;
  // The sheet id labels are rendered as far more blue than the page: pure blue
  // backing is keyed separately; label glyphs are ~(20,52,124). White page
  // pixels are handled by removeBorderWhite.
  return b > 90 && b > r + 30 && b > g + 30;
}

/**
 * V2: the navy heuristic above is a *hue* test, and game art owns the same
 * hues — the factory's roof ramp and trim are (12,36,104)…(56,120,188), so a
 * hue-only key ate the roof and left the chimneys floating (the "completely
 * broken factory" screenshot). What actually distinguishes an id label is
 * WHERE it sits: labels are navy text on the page margin, i.e. navy pixels
 * touching the border-connected white. Blue content sits on the blue backing
 * instead. So the key is hue AND margin-adjacency.
 */
function marginMask(data, w, h) {
  const isWhite = (i) =>
    data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255;
  const margin = new Uint8Array(w * h);
  const stack = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (!margin[i] && isWhite(i * 4)) { margin[i] = 1; stack.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x + 1 < w) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < h) push(x, y + 1);
  }
  return margin;
}

function touchesMargin(margin, w, h, i) {
  const x = i % w, y = (i / w) | 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (margin[ny * w + nx]) return true;
    }
  }
  return false;
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

/** Direct crop of a declared rect: key the blue backing, remove page white and id-label glyphs. */
async function cropDeclared(id) {
  const d = declaredOf(id);
  const img = sharp(declaredLocalPath(d.file), { limitInputPixels: false })
    .extract({ left: d.x, top: d.y, width: d.w, height: d.h })
    .ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const px = Buffer.alloc(n * 4);
  const margin = marginMask(data, info.width, info.height);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = data[o + 3];
    const blueKey = a !== 0 && data[o] === 0 && data[o + 1] === 0 && data[o + 2] === 255;
    // V2: navy hue alone is not a label — only navy touching the page margin
    // is. Blue roofs/trim/water sit on the blue backing and must survive.
    const label = a !== 0 && !blueKey &&
      isLabelPixel(data[o], data[o + 1], data[o + 2], a) &&
      touchesMargin(margin, info.width, info.height, i);
    if (a === 0 || blueKey || label) {
      px[o] = px[o + 1] = px[o + 2] = 0; px[o + 3] = 0;
    } else {
      px[o] = data[o]; px[o + 1] = data[o + 1]; px[o + 2] = data[o + 2]; px[o + 3] = 255;
    }
  }
  removeBorderWhite(px, info.width, info.height);
  return { px, w: info.width, h: info.height, d };
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
 * V2: luminance-preserving player tint. `tintPx` multiplies, which on a dark
 * brick building collapses every shade into near-black and leaves only the
 * bright trim reading as the player colour. Recolouring by luminance keeps the
 * art's shading and puts the player hue on all of it, so a tinted factory
 * still reads as a building at map zoom.
 */
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
 * Y5 derived anchor: the cell-local position of the tile origin, offset to
 * the renderer's south-corner convention (see file header).
 */
const derivedAnchor = (minX, minY) => [-minX + 1, -minY + 31];

/**
 * Compose one frame from declared layers. Each layer is drawn at
 * `tileOrigin + (xrel, yrel)`; the canvas is the union of the declared rects
 * (NOCROP: rects are trusted verbatim, never trimmed to content).
 */
async function composeLayers(layers) {
  const crops = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const layer of layers) {
    const c = await cropDeclared(layer.sprite);
    if (layer.tint) tintPx(c.px, layer.tint);
    else if (layer.tintLum) tintLumPx(c.px, layer.tintLum);
    const d = c.d;
    // OpenTTD placement: sprite top-left = tile origin + (xrel, yrel).
    const ox = d.xrel, oy = d.yrel;
    crops.push({ ...c, ox, oy });
    minX = Math.min(minX, ox); maxX = Math.max(maxX, ox + d.w - 1);
    minY = Math.min(minY, oy); maxY = Math.max(maxY, oy + d.h - 1);
  }
  let W = maxX - minX + 1, H = maxY - minY + 1;
  // A declared 64x31 ground tile ends at origin row 30, but the renderer's
  // tile diamond is 32 rows (row 31 repeats the bottom vertex row, exactly as
  // the terrain cells have always done). Grow + clone so the anchor lands
  // inside the rect and stacked tiles never leave a 1px hole.
  const hasGround = layers.some((l) => {
    const d = declaredOf(l.sprite);
    return d.w === CELL_W && d.h === 31 && d.yrel === 0;
  });
  const needH = -minY + CELL_H;
  const grow = hasGround && H < needH ? needH - H : 0;
  const dst = { px: Buffer.alloc(W * (H + grow) * 4), w: W, h: H + grow };
  for (const c of crops) blit(dst, c, c.ox - minX, c.oy - minY);
  if (grow) dst.px.copy(dst.px, H * W * 4, (H - 1) * W * 4, H * W * 4);
  return { px: dst.px, w: W, h: H + grow, minX, minY };
}

/** `layers` cell: one declared building on its declared ground tile (Y3/Y7). */
async function makeLayers(s) {
  const base = s.layers ?? [];
  const frames = s.frames?.length ? s.frames : [base];
  const cells = [];
  let geom = null;
  for (const extra of frames) {
    const composed = await composeLayers([...base, ...extra]);
    geom = composed;
    cells.push({ px: composed.px, w: composed.w, h: composed.h });
  }
  const [minX, minY] = [geom.minX, geom.minY];
  return {
    cells, cellW: cells[0].w, cellH: cells[0].h,
    anchor: derivedAnchor(minX, minY),
    footprint: s.footprint, frames: cells.length, frameMs: s.frameMs ?? 200,
  };
}

/**
 * Y4c trackset cell: 16 bitmask variants built purely from declared sprites.
 *   mode "flat"     — base + OpenTTD's flat table (road 1332–1350).
 *   mode "overlays" — declared ground + declared overlay pieces per mask.
 *
 * TK-002 stub rule: OpenGFX's rail set ships no single-end piece, so a tile
 * with exactly ONE connected direction used to compose from the bare ground
 * and rendered as plain grass — both ends of every freshly placed rail
 * segment were invisible until a neighbour arrived ("wrong sprite
 * orientation upon placement"). A one-direction mask now ALSO draws the
 * straight overlay of that direction's axis, so a stub reads as "rail ends
 * here" instead of vanishing. Piece `dirs` are in THIS PROJECT's bit order
 * (NE=1 SE=2 SW=4 NW=8) — verified against the sheet pixels; see
 * tools/iso-atlas.cells.json.
 */
async function makeTrackset(s) {
  const ts = s.trackset;
  const popcount = (n) => ((n & 1) + ((n >> 1) & 1) + ((n >> 2) & 1) + ((n >> 3) & 1));
  const out = [];
  for (let mask = 0; mask < 16; mask++) {
    const key = `${s.namePrefix ?? s.name}_${mask.toString(2).padStart(4, "0")}`;
    if (ts.mode === "flat") {
      const id = ts.base + OPENTTD_FLAT_TRACK_TABLE[toOpenttdRoadBits(mask)];
      const composed = await composeLayers([{ sprite: id }]);
      out.push({
        name: key,
        cells: [{ px: composed.px, w: composed.w, h: composed.h }],
        cellW: composed.w, cellH: composed.h,
        anchor: derivedAnchor(composed.minX, composed.minY),
        footprint: s.footprint, frames: 1, frameMs: s.frameMs,
      });
      continue;
    }
    // overlays: grass ground plus every declared piece fully contained in
    // the mask. A lone stub (mask 0) is just the ground tile; a ONE-direction
    // mask borrows the axis straight (TK-002 stub rule above).
    const layers = [{ sprite: ts.ground }];
    for (const piece of ts.pieces) {
      const bits = piece.dirs.reduce((a, b) => a | b, 0);
      if (bits !== 0 && (mask & bits) === bits) layers.push({ sprite: piece.sprite });
    }
    if (popcount(mask) === 1) {
      const stub = ts.pieces.find((p) => {
        const bits = p.dirs.reduce((a, b) => a | b, 0);
        return popcount(bits) === 2 && (mask & bits) !== 0;
      });
      if (stub && !layers.some((l) => l.sprite === stub.sprite)) {
        layers.push({ sprite: stub.sprite });
      }
    }
    const composed = await composeLayers(layers);
    out.push({
      name: key,
      cells: [{ px: composed.px, w: composed.w, h: composed.h }],
      cellW: composed.w, cellH: composed.h,
      anchor: derivedAnchor(composed.minX, composed.minY),
      footprint: s.footprint, frames: 1, frameMs: s.frameMs,
    });
  }
  return out;
}

/** G1 arm endpoints — centre → diamond-edge midpoint (highlight glow only). */
const ARM_ENDS = {
  1: [48, 8],   // NE — midpoint of top-right edge    (32,0)-(64,16)
  2: [48, 24],  // SE — midpoint of bottom-right edge (64,16)-(32,32)
  4: [16, 24],  // SW — midpoint of bottom-left edge  (32,32)-(0,16)
  8: [16, 8],   // NW — midpoint of top-left edge     (0,16)-(32,0)
};

function pointSegDist(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)));
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
  return Math.sqrt(dx * dx + dy * dy);
}

/** The two placement-glow cells (UI, not OpenGFX art).
 *  `highlight_soft` is U2's fainter catchment tint (informational); the plain
 *  `highlight` stays the solid "this is the tile you are about to place" glow. */
function makeHighlight(s, soft) {
  const color = [255, 220, 40];
  const px = Buffer.alloc(CELL_W * CELL_H * 4);
  const cx = CELL_W / 2, cy = CELL_H / 2;
  // Solid line vs soft fill alpha: the soft tile keeps the diamond edge and
  // a translucent middle so the network reads as "area" not "building".
  const lineAlpha = soft ? 70 : 170;
  const fillAlpha = soft ? 32 : 80;
  for (const end of Object.values(ARM_ENDS)) {
    const [ex, ey] = end;
    for (let y = 0; y < CELL_H; y++) {
      for (let x = 0; x < CELL_W; x++) {
        const dist = pointSegDist(x + 0.5, y + 0.5, cx, cy, ex, ey);
        if (dist < 2) {
          const i = (y * CELL_W + x) * 4;
          px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = lineAlpha;
        }
      }
    }
  }
  for (let y = 0; y < CELL_H; y++) {
    for (let x = 0; x < CELL_W; x++) {
      const dx = Math.abs(x + 0.5 - cx), dy = Math.abs(y + 0.5 - cy);
      const edgeDist = Math.max(dx / 32 + dy / 16);
      if (Math.abs(edgeDist - 1) < 0.05) {
        const i = (y * CELL_W + x) * 4;
        px[i] = soft ? 120 : 255; px[i + 1] = soft ? 180 : 0; px[i + 2] = soft ? 220 : 200; px[i + 3] = soft ? 110 : 255;
      } else if (edgeDist < 1) {
        const i = (y * CELL_W + x) * 4;
        if (px[i + 3] === 0) { px[i] = color[0]; px[i + 1] = color[1]; px[i + 2] = color[2]; px[i + 3] = fillAlpha; }
      }
    }
  }
  return {
    cells: [{ px, w: CELL_W, h: CELL_H }], cellW: CELL_W, cellH: CELL_H,
    anchor: derivedAnchor(-(HW - 1), 0), footprint: [1, 1],
    frames: 1, frameMs: s.frameMs, name: s.name,
  };
}

/** Classic 64x32 blue-box ground cell (terrain): crop the declared tile and
 *  clone its bottom row so stacked tiles never leave a hole under the tip. */
async function makeGround(s) {
  const d = declaredOf(s.sprite);
  const c = await cropDeclared(s.sprite);
  const px = Buffer.alloc(CELL_W * CELL_H * 4);
  c.px.copy(px, 0, 0, Math.min(c.px.length, px.length));
  if (d.h === 31) px.copy(px, 31 * CELL_W * 4, 30 * CELL_W * 4, 32 * CELL_W * 4);
  return {
    cells: [{ px, w: CELL_W, h: CELL_H }], cellW: CELL_W, cellH: CELL_H,
    anchor: derivedAnchor(d.xrel, d.yrel),
    footprint: s.footprint, frames: 1, frameMs: s.frameMs ?? 200,
  };
}

async function buildSlot(s) {
  if (s.trackset) return makeTrackset(s);
  if (s.layers) return [{ name: s.name, ...(await makeLayers(s)) }];
  if (s.generator === "highlight" || s.generator === "highlight_soft") {
    return [makeHighlight(s, s.generator === "highlight_soft")];
  }
  if (typeof s.sprite === "number") return [{ name: s.name, ...(await makeGround(s)) }];
  throw new Error(`cell ${s.name ?? JSON.stringify(s)}: no declared source (Y3/Y6: compose/crop/generator cells are gone)`);
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

  // ── contact sheet: footprint diamond grid, sprite flush on its footprint,
  //    magenta anchor — the Y7 debug overlay (footprint outline under each
  //    placed building), one cell per atlas sprite. ──
  const gridW = 900, minH = 620;
  const bgLayers = [];
  {
    const svg = `<svg width="${gridW}" height="${minH}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#f2f0e8"/>
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
    // per-tile footprint grid (Y7): every tile diamond of the footprint plus
    // the outer outline, so an overhanging or mis-anchored base is visible.
    let paths = "";
    const top = [ox, oy];
    const right = [ox + fw * HW, oy + fw * HH];
    const bottom = [ox + (fw - fh) * HW, oy + (fw + fh) * HH];
    const left = [ox - fh * HW, oy + fh * HH];
    paths += `<path d="M${top[0]} ${top[1]} L${right[0]} ${right[1]} L${bottom[0]} ${bottom[1]} L${left[0]} ${left[1]} Z" fill="none" stroke="#d8c020" stroke-width="1.5"/>`;
    for (let ty = 0; ty < fh; ty++) {
      for (let tx = 0; tx < fw; tx++) {
        const tx0 = ox + (tx - ty) * HW, ty0 = oy + (tx + ty) * HH;
        paths += `<path d="M${tx0} ${ty0} L${tx0 + HW} ${ty0 + HH} L${tx0} ${ty0 + 2 * HH} L${tx0 - HW} ${ty0 + HH} Z" fill="none" stroke="#d8c020" stroke-width="0.75"/>`;
      }
    }
    // anchor should land at the south corner of the footprint's bottom tile.
    const anchorScreen = [ox + (fw - fh) * HW, oy + (fw + fh - 1) * HH];
    const drawX = Math.round(anchorScreen[0] - p.anchor[0]);
    const drawY = Math.round(anchorScreen[1] - p.anchor[1]);
    const svg = `<svg width="${gridW}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">
      ${paths}
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
