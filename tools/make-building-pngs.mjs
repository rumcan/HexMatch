#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// Building layers — ONE standalone PNG per building, placed free on its
// footprint (the roads stay exact-grid; buildings don't have to).
//
// AUTHORING CONVENTION (author at 2× — the most zoomed-in version):
//
//   • canvas: a square of  S = (w + h) × 64 px,  where [w, h] is the sprite's
//     FOOTPRINT (in tiles). Non-square footprints (1×2, 2×1, 1×3, 3×1, 4×2,
//     2×4) use the same rule — the footprint diamond is a parallelogram S px
//     wide, and the anchor stays the footprint CENTRE (S/2, cy + (w+h)×16).
//   • ground zone: the bottom (w + h) × 32 px. The footprint diamond spans
//     the full canvas width with its top vertex at canvas centre; square
//     footprints form a perfect iso diamond.
//   • anchor: pixel  ((w + h) × 32, (w + h) × 48)  from the top-left — the
//     footprint CENTRE. The renderer places that pixel exactly on the
//     footprint's centre (def.center in src/iso/depth.ts), so art drawn on
//     the template sits concentric with its tiles even if it never "snaps".
//   • the building may rise at most (w + h) × 48 px above the anchor.
//
//   • OVERHANG EXTENSION (ART-1950S): the original TTD art overhangs its
//     footprint — 20 of the 43 town sprites and 4 of the 6 depots are wider
//     or taller at 2× than the base canvas (e.g. town_flats_arctic_2x1_2 is
//     192×226 on a 128² canvas). The silhouette-fidelity contract wins over
//     the base size table, so a source MAY use a larger canvas: the ground
//     diamond stays pinned to the canvas BOTTOM (bottom vertex at
//     (W/2, H), anchor at (W/2, H − (w+h)×16), all at 2×) and the extra room
//     goes to headroom ABOVE and width symmetrically either side. W and H
//     must each be ≥ S (= (w+h)×64); the base canvas is the special case
//     W = H = S and reduces to the table below. The engine is agnostic — it
//     places whatever w/h/anchor the manifest carries — and every reference
//     sprite is horizontally centred on its anchor, so symmetric width is
//     faithful.
//
//   | footprint | canvas @2× | anchor (x, y) | ground zone | max rise |
//   |-----------|------------|---------------|-------------|----------|
//   | 1×1       | 128 × 128  | (64, 96)      | 64 px       | 96 px    |
//   | 1×2       | 192 × 192  | (96, 144)     | 96 px       | 144 px   |
//   | 2×1       | 192 × 192  | (96, 144)     | 96 px       | 144 px   |
//   | 2×2       | 256 × 256  | (128, 192)    | 128 px      | 192 px   |
//   | 1×3       | 256 × 256  | (128, 192)    | 128 px      | 192 px   |
//   | 3×1       | 256 × 256  | (128, 192)    | 128 px      | 192 px   |
//   | 3×3       | 384 × 384  | (192, 288)    | 192 px      | 288 px   |
//   | 4×2       | 384 × 384  | (192, 288)    | 192 px      | 288 px   |
//   | 2×4       | 384 × 384  | (192, 288)    | 192 px      | 288 px   |
//   | 4×4       | 512 × 512  | (256, 384)    | 256 px      | 384 px   |
//
//   A 1×3 and a 2×2 share the 256² canvas, a 4×2 and a 3×3 share 384² —
//   canvas size CANNOT identify the footprint. The footprint is DECLARED,
//   never guessed: assets/buildings-src/footprints.json maps a sprite name
//   to its footprint ({"<name>": {"footprint": [w, h]}} — a bare [w, h]
//   array means footRoom 0). Canvas-size inference only applies when a name
//   is absent from every authority (footprints.json, the compiled manifest,
//   the sheet manifest) AND the canvas is one of the four legacy squares;
//   anything else fails with "declare `<name>` in footprints.json".
//
//   HEIGHT IS THE ART'S: to make a building taller, grow the canvas UPWARD
//   ONLY (image editor: anchor bottom-centre) and keep the ground diamond on
//   the bottom edge. The compiled image is trimmed to the art, so the game
//   takes exactly the height the picture has. Existing buildings keep their
//   footprint however the canvas grows. Under `npm run dev` saving a master
//   recompiles it automatically (vite.config.ts, watchBuildingSources).
//   NEVER edit assets/buildings/* by hand — it is overwritten on compile.
//
//   FOOT ROOM (F1 Addition A): details in FRONT of the building (steps, lawn
//   or fence edge) live BELOW the footprint's south vertex. Declare them per
//   building in footprints.json ({"<name>": {"footprint": [w, h],
//   "footRoom": 24}} — 2× px of canvas below the south vertex, default 0):
//   the anchor becomes (W/2, H − footRoom − (w+h)×16). Only use footRoom for
//   details in front of the building — never to make a building taller.
//   `node tools/fit-building-art.mjs <name> <raw> --foot N` grows the canvas
//   downward by N for this. The templates draw the foot-room band below the
//   diamond so authors can see it.
//
//   SCALE FIGURE (F1 Addition B): every template draws a person silhouette
//   (12 px), a door guide (8×16 px) and dashed storey lines (every 28 px),
//   standing at the footprint's south corner. Calibrated from the shipped
//   1950s art: door slabs measured 12–24 px tall (median 16 × 8) across
//   town_center, town_house_* and town_flats_*; person/storey are the
//   redo-guide midpoints (docs/ai-codex-blizzard-redo-guide.md §2.1:
//   human 10–14 px, storey 24–32 px). Templates are never shipped, so the
//   magenta guides can't leak into the game.
//
// COMPILED OUTPUT (TICKET-B2 + B-3.1, ART-1950S):
//
//   The shipped PNGs are TRIMMED to the art's tight alpha bounding box
//   (threshold 8, the same cut the sheet packer uses) and the manifest's
//   `anchor` is re-expressed relative to the trimmed origin — the renderer
//   then blits the same pixels at the same place, minus the transparent
//   margin. The box is snapped to a multiple of 4 at 2× so that
//   w@2x = 2 × w@1x = 4 × w@0.5x exactly: the blit computes its source rect
//   as round(manifest.w × zoom), which must equal the real pixel width of
//   each zoom file or the right/bottom edge crops.
//
//   1×/0.5× are resampled with a QUALITY kernel (lanczos3), not nearest:
//   these are painted, anti-aliased images, and nearest at 4:1 discards 15
//   of every 16 pixels — thin structures (derrick lattice, railings, window
//   frames) broke into sparkling noise at 0.5×. sharp/libvips premultiplies
//   alpha during resize, so transparent edges do not pick up dark halos.
//   The engine still never scales inside drawImage — only the offline
//   resampling filter changed; the output sizes stay exact halves/quarters.
//
// Usage:
//   node tools/make-building-pngs.mjs                # process every <name>@2x.png
//   node tools/make-building-pngs.mjs farm quarry    # specific names
//   node tools/make-building-pngs.mjs --templates    # (re)generate the templates
//   node tools/make-building-pngs.mjs --templates 1x3 3x1
//                                                    # (re)generate listed templates
//
// Input  : assets/buildings-src/<name>@2x.png   (transparent, spec size)
// Output : assets/buildings/<name>@{0.5x,1x,2x}.png   (tight-trimmed)
//          assets/buildings/manifest.json
//          assets/buildings-src/templates/<w>x<h>@2x.png  (--templates)
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "buildings-src");
const OUT = join(root, "assets", "buildings");
const TEMPLATES = join(SRC, "templates");
const DECLARATIONS = join(SRC, "footprints.json");

/** Downscale kernel for the derived 1×/0.5× tiers (TICKET-B2). */
const KERNEL = "lanczos3";

// ── scale guides (F1 Addition B), all in 2× px. See the header + the 1950s
// art doc §2.4 for how they were calibrated; do not retune by eye. ──
/** Person silhouette height. Redo-guide midpoint (10–14 px). */
export const PERSON_H = 12;
/** Door guide width. Measured median across town_center / town_house_* / town_flats_*. */
export const DOOR_W = 8;
/** Door guide height. Measured median (slabs ran 12–24 px). */
export const DOOR_H = 16;
/** Storey-line spacing. Redo-guide midpoint (24–32 px). */
export const STOREY_H = 28;

// ── template illustration margins (2× px). The template canvas is S wide
// (the diamond spans the full base-canvas width) and S + TOP_GUARD +
// FOOT_BAND tall: a headroom strip above the base canvas so the max-rise
// line is not glued to the edge, and the foot-room band below the diamond.
// Artist canvases are unchanged — these margins are guide furniture only. ──
const TOP_GUARD = 32;
const FOOT_BAND = 32;

/** Spec for a footprint, all in 2× pixels (the authoring resolution). */
export function specFor([w, h]) {
  const n = w + h;
  return {
    S: n * 64,                 // canvas side
    ax: n * 32,                // anchor x (footprint centre)
    ay: n * 48,                // anchor y (footprint centre)
    groundH: n * 32,           // ground zone height (bottom of canvas)
    maxRise: n * 48,           // max building height above the anchor
  };
}

/**
 * Template geometry for a footprint (2× px). Single source of truth for
 * templateSvg and tools/overlay-building-template.mjs.
 *
 * The diamond's top vertex (tile (0,0)) sits at cx = h×64 (F1 fix — it was
 * S/2, which pushed every w≠h outline off the canvas); the outline then
 * spans exactly x 0…S. The anchor is the centroid of the tile centres. The
 * south vertex sits at x = w×64 — centred only for squares, which is
 * correct iso: a 1×3 strip leans along its axis (cf. the 1×3/3×1 platform
 * anchors in tools/railway/cut_platform.py).
 */
export function templateGeometry([w, h]) {
  const n = w + h;
  const S = n * 64;
  const cx = h * 64;
  const cy = TOP_GUARD + S / 2;
  const ax = S / 2;
  const ay = cy + n * 16;
  const vx = w * 64;
  const vy = TOP_GUARD + S;
  const maxRiseY = ay - n * 48;      // == TOP_GUARD: the base canvas top
  const storeys = [];
  for (let y = vy - STOREY_H; y > maxRiseY + 2; y -= STOREY_H) storeys.push(y);
  return {
    w, h, n, S,
    W: S, H: S + TOP_GUARD + FOOT_BAND,
    cx, cy, ax, ay, vx, vy,
    topGuard: TOP_GUARD, footBand: FOOT_BAND, maxRiseY, storeys,
    // scale figures (scaleFigureShapes) stand at the south corner (vx, vy):
    // the person just left of the vertex, the door guide just right of it.
  };
}

/** Footprints from the monolith manifest — one of the geometry authorities. */
function footprints() {
  const m = JSON.parse(readFileSync(join(root, "assets", "iso-atlas", "manifest.json"), "utf8"));
  const out = {};
  for (const [name, s] of Object.entries(m.sprites)) out[name] = s.footprint;
  return out;
}

/**
 * Declared footprints (assets/buildings-src/footprints.json), normalised to
 * {<name>: {footprint: [w, h], footRoom: N}}. Values may be a bare [w, h]
 * (footRoom 0) or {footprint, footRoom}. Keys starting with "_" are notes.
 * A missing file means no declarations. Throws on malformed entries.
 */
export function loadDeclaredFootprints(path = DECLARATIONS) {
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const out = {};
  for (const [name, v] of Object.entries(raw)) {
    if (name.startsWith("_")) continue;
    const obj = Array.isArray(v) ? { footprint: v } : v;
    const fp = obj?.footprint;
    if (!Array.isArray(fp) || fp.length !== 2 || fp.some((x) => !Number.isInteger(x) || x < 1 || x > 8)) {
      throw new Error(`footprints.json: "${name}" needs a footprint [w, h] of integers 1–8 (got ${JSON.stringify(v)})`);
    }
    const footRoom = obj.footRoom ?? 0;
    if (!Number.isInteger(footRoom) || footRoom < 0 || footRoom > 512) {
      throw new Error(`footprints.json: "${name}" needs footRoom as an integer 0–512 (got ${JSON.stringify(v)})`);
    }
    out[name] = { footprint: [fp[0], fp[1]], footRoom };
  }
  return out;
}

/**
 * Footprint resolution, first match wins: --footprint, footprints.json, the
 * compiled manifest (re-authored art keeps its footprint), the sheet
 * manifest, then legacy square-canvas inference (128²→1×1, 256²→2×2,
 * 384²→3×3, 512²→4×4) — and only then. Canvas size is ambiguous (a 1×3 and
 * a 2×2 share 256²), so anything undeclared and not a legacy square fails
 * with the footprints.json message instead of guessing wrong silently.
 */
export function resolveFootprint(name, W, H, { forced = null, declared = null, compiled = null, sheet = null } = {}) {
  const check = (fp, where) => {
    if (!Array.isArray(fp) || fp.length !== 2 || fp.some((x) => !Number.isInteger(x) || x < 1)) {
      throw new Error(`${name}: bad ${where} footprint ${JSON.stringify(fp)} — want [w, h] of positive integers`);
    }
    return { fp: [fp[0], fp[1]], source: where };
  };
  if (forced) return check(forced, "--footprint");
  if (declared) return check(declared, "footprints.json");
  if (compiled) return check(compiled, "manifest");
  if (sheet) return check(sheet, "iso-atlas");
  if (W === H) {
    const legacy = { 128: [1, 1], 256: [2, 2], 384: [3, 3], 512: [4, 4] };
    if (legacy[W]) return { fp: legacy[W], source: "canvas-size" };
  }
  throw new Error(
    `${name}: cannot infer a footprint from canvas ${W}×${H} — ` +
    `declare "${name}" in assets/buildings-src/footprints.json ` +
    `(e.g. { "${name}": { "footprint": [1, 3] } })`,
  );
}

/**
 * Authoring anchor at 2×: the footprint centre. On the base canvas this is
 * the spec table's (S/2, 3S/4); on an extended canvas the ground diamond is
 * pinned to the bottom, so the anchor sits (w+h)×16 px above the south
 * vertex — which itself sits `footRoom` px above the canvas bottom.
 */
export function anchorFor(W, H, [w, h], footRoom = 0) {
  return [W / 2, H - footRoom - (w + h) * 16];
}

/**
 * Tight alpha bounding box of an RGBA image (alpha > threshold), matching the
 * sheet packer's trim rule. Returns null for a fully transparent image.
 * Also reports the opaque span width on the canvas bottom row (F1: a WIDE
 * span means the ground was cut flat by the canvas edge — that art wants
 * footRoom and a downward-grown canvas. A mere touch is normal: the south
 * vertex sits on the bottom edge by design, and vertex blobs on the shipped
 * masters measure up to 25 px wide there.)
 */
async function alphaBBox(img, threshold = 8) {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  let spanL = -1, spanR = -1;
  if (maxY === height - 1) {
    for (let x = 0; x < width; x++) {
      if (data[((height - 1) * width + x) * channels + 3] > threshold) {
        if (spanL < 0) spanL = x;
        spanR = x;
      }
    }
  }
  return {
    left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1,
    bottomSpan: spanR >= 0 ? spanR - spanL + 1 : 0,
  };
}

/**
 * How the art's GROUND diamond compares to the declared footprint's guide:
 * widest opaque row in the bottom 60% = the parcel's left/right vertex row;
 * distance from there to the lowest opaque pixel = half the diamond height.
 * (Same read as tools/overlay-building-template.mjs; a 2:1 diamond has
 * (bottom − widest) / (rowWidth / 2) ≈ 0.5. Rows below the vertex
 * (H − footRoom) are front details, not ground, and are excluded from the
 * scan so declared foot room never skews the ratio.)
 */
export async function parcelMetrics(src, [w, h], footRoom = 0) {
  const { data: raw, info: ri } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rx = (x, y, c) => raw[(y * ri.width + x) * ri.channels + c];
  const yMax = ri.height - 1 - footRoom;
  let pMinY = ri.height, pMaxY = -1;
  for (let y = 0; y <= yMax; y++)
    for (let x = 0; x < ri.width; x++)
      if (rx(x, y, 3) > 8) {
        if (y < pMinY) pMinY = y;
        if (y > pMaxY) pMaxY = y;
      }
  const yFrom = pMinY + Math.floor((pMaxY - pMinY) * 0.4);
  let rowW = 0, widestY = yFrom, widestX = 0;
  for (let y = yFrom; y <= pMaxY; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < ri.width; x++) {
      if (rx(x, y, 3) > 8) { if (l < 0) l = x; r = x; }
    }
    if (r - l + 1 > rowW) { rowW = r - l + 1; widestY = y; widestX = (l + r) / 2; }
  }
  let lowL = -1, lowR = -1;
  for (let x = 0; x < ri.width; x++) if (rx(x, pMaxY, 3) > 8) { if (lowL < 0) lowL = x; lowR = x; }
  const guideW = (w + h) * 64;
  // A w≠h diamond leans: its south vertex sits (w−h)×32 px off the canvas
  // centre line (templateGeometry). Measure lopsidedness against the LEANING
  // vertex, not the centre — lean is 0 for squares, so square readings are
  // unchanged.
  const lean = (w - h) * 32;
  const lowC = (lowL + lowR) / 2;
  return {
    parcelW: rowW, guideW,
    parcelPct: rowW > 0 ? +((rowW / guideW) * 100).toFixed(1) : 0,
    diamondRatio: rowW > 0 ? +((pMaxY - widestY) / (rowW / 2)).toFixed(3) : null,
    vertexOffset: +((lowC - widestX - lean).toFixed(1)),
    groundSkew: +((lowC - (ri.width / 2 + lean)).toFixed(1)),
  };
}

/**
 * One transparent building canvas → the 3 zoom variants. The canvas may be
 * the base spec square (S×S) or an EXTENDED canvas (≥ S in both dims, ground
 * diamond pinned to the canvas bottom — see the header). Outputs are trimmed
 * to the art's alpha box (TICKET-B-3.1) and resampled with a quality kernel
 * (TICKET-B2).
 *
 * Hermetic: srcDir/outDir are injectable so tests compile throwaway fixtures
 * without touching the repo. The manifest merge lives in main(), not here.
 */
export async function processBuilding(name, opts = {}) {
  const { fps = {}, known = {}, forced = null, declared = {}, srcDir = SRC, outDir = OUT } = opts;
  const src = join(srcDir, `${name}@2x.png`);
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  const meta = await sharp(src).metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;

  const { fp, source } = resolveFootprint(name, W, H, {
    forced,
    declared: declared[name]?.footprint ?? null,
    compiled: known[name]?.footprint ?? null,
    sheet: fps[name] ?? null,
  });
  const footRoom = declared[name]?.footRoom ?? 0;

  // The canvas must hold the footprint's lot: its width is the collar-inset
  // lot, (w + h − 0.32) × 64 px, and its height at least the ground zone.
  // Height above that is free — the picture decides how tall it stands.
  const n = fp[0] + fp[1];
  const minW = Math.round((n - 0.32) * 64);
  if (W < minW || H < n * 32) {
    throw new Error(`${name}: canvas must be at least ${minW} wide and ${n * 32} tall at 2× for a ${fp[0]}×${fp[1]} footprint (got ${W}×${H}) — use assets/buildings-src/templates/${fp[0]}x${fp[1]}@2x.png as the base (ground diamond pinned to the canvas bottom)`);
  }
  if (W > 2048 || H > 2048) {
    throw new Error(`${name}: canvas ${W}×${H} exceeds the 2048px overhang cap — the art is expected to sit near its footprint`);
  }
  const [ax2, ay2] = anchorFor(W, H, fp, footRoom);

  // ── B-3.1: tight alpha box, snapped to a 4px lattice at 2× so the three
  // tiers are exact 4:2:1 relatives of each other (see header). Snap by
  // EXPANDING (never cutting art): floor the origin, ceil the far edge.
  const base = sharp(src);
  const box = await alphaBBox(base);
  if (!box) throw new Error(`${name}: the source is fully transparent — nothing to compile`);
  const left = Math.max(0, Math.floor(box.left / 4) * 4);
  const top = Math.max(0, Math.floor(box.top / 4) * 4);
  const right = Math.min(W, Math.ceil((box.left + box.width) / 4) * 4);
  const bottom = Math.min(H, Math.ceil((box.top + box.height) / 4) * 4);
  const w2 = right - left, h2 = bottom - top;          // multiples of 4

  // ── write the trimmed 2× master, then the resampled 1×/0.5× from it ──
  mkdirSync(outDir, { recursive: true });
  const trimmed = base.extract({ left, top, width: w2, height: h2 });
  await trimmed.clone().png({ compressionLevel: 9 }).toFile(join(outDir, `${name}@2x.png`));
  for (const [z, div] of [["1x", 2], ["0.5x", 4]]) {
    await trimmed.clone()
      .resize(Math.round(w2 / div), Math.round(h2 / div), { kernel: KERNEL })
      .png({ compressionLevel: 9 })
      .toFile(join(outDir, `${name}@${z}.png`));
  }

  // ── F1 validation: warnings on stderr, never fatal. The ground check
  // compares the art's parcel against the DECLARED diamond (overlay check):
  // bands are tuned so the shipped 1950s masters compile quietly — a warning
  // means the ground genuinely doesn't meet the diamond it was declared on.
  const warnings = [];
  if (box.bottomSpan > 32) {
    warnings.push(`${name}: opaque art spans ${box.bottomSpan}px along the canvas bottom edge — the ground ` +
      `looks cut flat there; give "${name}" footRoom in assets/buildings-src/footprints.json and grow the ` +
      `canvas downward (vertex at H − footRoom), not up`);
  }
  const parcel = await parcelMetrics(src, fp, footRoom);
  if (parcel.parcelPct > 130) {
    warnings.push(`${name}: the art's ground is ${parcel.parcelPct}% of the ${fp[0]}×${fp[1]} diamond width — ` +
      `it would spill past its lot (check with tools/overlay-building-template.mjs)`);
  }
  if (parcel.parcelPct > 0 && parcel.parcelPct < 25) {
    warnings.push(`${name}: the art's ground is only ${parcel.parcelPct}% of the ${fp[0]}×${fp[1]} diamond width — ` +
      `it may be declared on too large a footprint`);
  }
  if (Math.abs(parcel.groundSkew) > Math.max(32, parcel.guideW * 0.15)) {
    warnings.push(`${name}: the art's lowest ground point sits ${parcel.groundSkew}px off the footprint's ` +
      `south vertex — the building would stand lopsided on its tiles`);
  }
  for (const msg of warnings) console.warn(`warning: ${msg}`);

  // ── manifest entry, all at 1×: rect is the WHOLE (trimmed) image, the
  // anchor is the authoring anchor shifted by the trim origin. Fractional
  // anchors are fine — drawOrigin places floats, the blit floors them.
  return {
    name, footprint: fp, footRoom, source,
    anchor: [(ax2 - left) / 2, (ay2 - top) / 2],
    w: w2 / 2, h: h2 / 2,
    canvas: [W, H],                   // log/diagnostics only
    trim: { left, top, w2, h2 },      // log/diagnostics only
    warnings, parcel,                 // log/diagnostics only
  };
}

/**
 * Scale-figure markup (person silhouette + door guide + tags) with feet on
 * (fx, feetY). Shared by templateSvg and the overlay tool so reviewers see
 * the SAME figure beside the art that the template carries.
 */
export function scaleFigureShapes(fx, feetY) {
  const px = fx - 14, dx = fx + 6;    // person left of the corner, door right of it
  const headY = feetY - PERSON_H + 2;
  return `<g data-guide="person">
    <circle cx="${px}" cy="${headY}" r="2" fill="#ff4fd8" fill-opacity="0.3" stroke="#ff4fd8" stroke-width="1.2"/>
    <path d="M ${px - 2.5} ${feetY - PERSON_H + 4} L ${px + 2.5} ${feetY - PERSON_H + 4} L ${px + 1.4} ${feetY} L ${px + 0.4} ${feetY} L ${px} ${feetY - 3.5} L ${px - 0.4} ${feetY} L ${px - 1.4} ${feetY} Z"
      fill="#ff4fd8" fill-opacity="0.3" stroke="#ff4fd8" stroke-width="1.2" stroke-linejoin="round"/>
    <text x="${px + 5}" y="${feetY - PERSON_H + 3}" font-family="monospace" font-size="9" fill="#ff9fe6">${PERSON_H}px</text>
  </g>
  <g data-guide="door">
    <rect x="${dx}" y="${feetY - DOOR_H}" width="${DOOR_W}" height="${DOOR_H}"
      fill="none" stroke="#ff4fd8" stroke-width="1.4"/>
    <line x1="${dx - 2}" y1="${feetY}" x2="${dx + DOOR_W + 2}" y2="${feetY}" stroke="#ff4fd8" stroke-width="1.4"/>
    <text x="${dx + DOOR_W / 2}" y="${feetY + 12}" font-family="monospace" font-size="9" fill="#ff9fe6" text-anchor="middle">${DOOR_W}×${DOOR_H}</text>
  </g>`;
}

/** Marked authoring template for a footprint (2×). */
export function templateSvg([w, h]) {
  const g = templateGeometry([w, h]);
  const { S, cx, cy, ax, ay, vx, vy, maxRiseY, storeys } = g;
  const H = g.H;
  const tile = (i, j) => {
    const x = cx + (i - j) * 64, y = cy + (i + j) * 32;
    return `M ${x} ${y} l 64 32 l -64 32 l -64 -32 Z`;
  };
  let tiles = "";
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) tiles += `<path data-guide="tile" d="${tile(i, j)}" fill="none" stroke="#2f8f6f" stroke-width="1.5"/>`;
  // footprint outline (union of the tiles — a parallelogram S px wide)
  const outline = `M ${cx} ${cy} L ${cx + w * 64} ${cy + w * 32} L ${vx} ${vy} L ${cx - h * 64} ${cy + h * 32} Z`;
  const cross = 10;
  const sx1 = Math.max(4, vx - 56), sx2 = Math.min(S - 4, vx + 56);
  const storeyLines = storeys.map((y, k) =>
    `<line data-guide="storey" x1="${sx1}" y1="${y}" x2="${sx2}" y2="${y}" stroke="#ff4fd8" stroke-width="1" stroke-dasharray="6 5" opacity="0.55"/>` +
    (k === 0 ? `<text x="${sx2 - 3}" y="${y - 4}" font-family="monospace" font-size="9" fill="#ff9fe6" text-anchor="end">storey ${STOREY_H}px</text>` : ""),
  ).join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${H}">
  <rect width="${S}" height="${H}" fill="#10222e"/>
  <rect data-guide="foot-band" x="0" y="${vy}" width="${S}" height="${g.footBand}" fill="#16324a"/>
  <line x1="0" y1="${vy}" x2="${S}" y2="${vy}" stroke="#3d6a8f" stroke-width="1" stroke-dasharray="4 4"/>
  <text x="${S - 5}" y="${vy + g.footBand - 6}" font-family="monospace" font-size="10" fill="#9fe8ff" text-anchor="end">foot room</text>
  <path data-guide="outline" d="${outline}" fill="#1d4436" stroke="#39d98a" stroke-width="3"/>
  ${tiles}
  <line data-guide="max-rise" x1="0" y1="${maxRiseY}" x2="${S}" y2="${maxRiseY}" stroke="#ff9f43" stroke-width="1.5" stroke-dasharray="12 10"/>
  <text x="5" y="${maxRiseY - 5}" font-family="monospace" font-size="10" fill="#ff9f43">max rise</text>
  ${storeyLines}
  <g data-guide="anchor">
  <circle cx="${ax}" cy="${ay}" r="7" fill="none" stroke="#ff4fd8" stroke-width="3"/>
  <line x1="${ax - cross}" y1="${ay}" x2="${ax + cross}" y2="${ay}" stroke="#ff4fd8" stroke-width="3"/>
  <line x1="${ax}" y1="${ay - cross}" x2="${ax}" y2="${ay + cross}" stroke="#ff4fd8" stroke-width="3"/>
  </g>
  ${scaleFigureShapes(vx, vy)}
</svg>`;
}

// ── main ───────────────────────────────────────────────────────────────────
const isCli = process.argv[1] && import.meta.url.split("/").pop() === process.argv[1].split(/[\\/]/).pop();

async function main() {
  mkdirSync(OUT, { recursive: true });
  const fps = footprints();
  const args = process.argv.slice(2);

  if (args.includes("--templates")) {
    const specs = args.filter((a) => a !== "--templates" && !a.startsWith("--"));
    let list;
    if (specs.length) {
      list = [];
      for (const chunk of specs) {
        for (const piece of chunk.split(",")) {
          const m = /^\s*(\d+)\s*x\s*(\d+)\s*$/.exec(piece);
          if (!m || +m[1] < 1 || +m[1] > 8 || +m[2] < 1 || +m[2] > 8) {
            console.error(`--templates: bad footprint "${piece}" (want WxH with W,H 1–8, e.g. 1x3)`);
            process.exit(1);
          }
          list.push([+m[1], +m[2]]);
        }
      }
    } else {
      const seen = new Set();
      list = [];
      for (const [w, h] of Object.values(fps)) {
        const key = `${w}x${h}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push([w, h]);
      }
    }
    mkdirSync(TEMPLATES, { recursive: true });
    for (const [w, h] of list) {
      const file = join(TEMPLATES, `${w}x${h}@2x.png`);
      const geo = templateGeometry([w, h]);
      await sharp(Buffer.from(templateSvg([w, h]))).png({ compressionLevel: 9 }).toFile(file);
      console.log(`template ${w}x${h} → ${file} (canvas ${geo.W}×${geo.H}, anchor ${geo.ax},${geo.ay})`);
    }
    process.exit(0);
  }

  // `--footprint WxH` applies to every name on this run.
  const fpAt = args.indexOf("--footprint");
  const forcedFp = fpAt >= 0 ? (args[fpAt + 1] ?? "").split("x").map(Number) : null;
  if (forcedFp && (forcedFp.length !== 2 || forcedFp.some((v) => !Number.isInteger(v) || v < 1))) {
    console.error("--footprint expects WxH, e.g. --footprint 4x4");
    process.exit(1);
  }
  const declared = loadDeclaredFootprints();
  const nameArgs = args.filter((a, i) => !a.startsWith("--") && !(fpAt >= 0 && i === fpAt + 1));
  const names = nameArgs.length
    ? nameArgs
    : readdirSync(SRC).filter((f) => /@2x\.png$/.test(f)).map((f) => f.replace(/@2x\.png$/, ""));
  if (!names.length) { console.log("nothing to do — drop <name>@2x.png files into assets/buildings-src/"); process.exit(0); }

  const manifest = { sprites: {} };
  const manifestPath = join(OUT, "manifest.json");
  if (existsSync(manifestPath)) {                     // merge — partial runs keep the rest
    const prev = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.sprites = prev.sprites ?? {};
  }
  const known = { ...manifest.sprites };               // footprints before this run
  for (const name of names) {
    const entry = await processBuilding(name, { fps, known, forced: forcedFp, declared });
    manifest.sprites[name] = {
      footprint: entry.footprint, anchor: entry.anchor, w: entry.w, h: entry.h, canvas: entry.canvas,
      ...(entry.footRoom ? { footRoom: entry.footRoom } : {}),
    };
    const t = entry.trim;
    console.log(`${name}: ${entry.footprint[0]}×${entry.footprint[1]} (via ${entry.source}) → ${entry.w}×${entry.h} @1× (anchor ${entry.anchor.join(",")}, trimmed ${t.w2}×${t.h2} from canvas ${entry.canvas[0]}×${entry.canvas[1]} at +${t.left},+${t.top}${entry.footRoom ? `, footRoom ${entry.footRoom}` : ""})`);
  }
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify({
    note: "Per-building PNG layers: assets/buildings/<name>@{0.5x,1x,2x}.png — tight-trimmed to the art's alpha box; w/h/anchor are at 1× relative to the TRIMMED image (rect is the whole image, x=y=0), anchor is the footprint-centre placement point (see tools/make-building-pngs.mjs).",
    sprites: manifest.sprites,
  }, null, 2) + "\n");
  console.log(`wrote ${join(OUT, "manifest.json")} (${Object.keys(manifest.sprites).length} building${Object.keys(manifest.sprites).length === 1 ? "" : "s"})`);
}

if (isCli) await main();
