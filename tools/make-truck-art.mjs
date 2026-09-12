#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// TRUCK-BRAND — player-coloured 1950s delivery lorries.
//
// RV-01 drew every lorry with the same OpenGFX goods truck, so a connection was
// legible but YOUR supply line was not distinguishable from the rival's at a
// glance. This compiles the branded art that fixes that: eight sprites, four
// 2:1 dimetric headings × two owners (deep royal blue with a cream roof for the
// player, crimson with charcoal trim for the rival), each authored as a
// hand-painted Blizzard-style lorry on a flat PURE MAGENTA (#FF00FF) backing.
//
// WHY MAGENTA, AND HOW IT COMES OFF. Generated art arrives as an opaque picture
// on a solid colour; magenta is chosen because no truck hue can contain it
// (royal blue and ruby red both carry much more green than #FF00FF does). The
// key does not THRESHOLD the backing away, it SOLVES for coverage: an observed
// pixel is
//       o = a·c + (1−a)·M      with M = (255, 0, 255)
// and because M has no green at all,  a = 1 − (min(r,b) − g)/255  recovers the
// truck's coverage from the magenta excess alone. c = (o − (1−a)·M)/a then
// UN-MIXES the backing, which does two jobs at once: it removes the pink rim a
// naive key leaves on anti-aliased edges, and it turns the painted contact
// shadow (which IS a soft-alpha wash over the magenta) into a real shadow
// instead of a purple puddle. Coverage under KEY_CUT is dropped outright, and
// low-coverage colour is pulled toward a neutral umber so any residual fringe
// reads as shade, never as spill.
//
// SCALE. The contract is a MINIATURE vehicle: ~48–60 px long and 28–36 px tall
// at 2× — a third of a tile's width at 1×, like the lorry it replaces (a truck
// that filled its tile would hide the road it exists to prove). 2× is authored,
// 1× and 0.5× are derived with a quality kernel as in
// tools/make-building-pngs.mjs, and every size snaps to a multiple of 4 so
// `round(w·zoom)` is the REAL pixel width of each zoom file — the blit crops an
// edge when it is not. The anchor is snapped even for the same reason: the
// renderer offsets the zoomed image by `anchor·zoom`, which must stay integral
// at 2× to keep the wheels exactly on the tile centre.
//
// ANCHOR. `drawOriginMoving` lands a moving sprite's anchor on the CENTRE of
// the fractional tile it drives over — the ground contact point — so the anchor
// is measured from the BODY (coverage ≥ BODY_CUT), never from the bounding box:
// the middle of its lowest rows, on the last row the body itself touches. The
// painted shadow may then spill past it to the bottom-right, which is what the
// top-left key light asks for.
//
// Usage:
//   node tools/make-truck-art.mjs                  # compile the masters
//   node tools/make-truck-art.mjs truck_blue_se …   # a subset
//   node tools/make-truck-art.mjs --raw <dir>       # key magenta art in <dir>
//                                                   # into masters, then compile
// Reads  assets/vehicles-src/<name>@2x.png           (RGBA masters, committed)
// Writes assets/vehicles/<name>@{0.5x,1x,2x}.png + assets/vehicles/manifest.json
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "vehicles-src");
const OUT = join(root, "assets", "vehicles");

/** 2× master box: the ticket's miniature-vehicle scale, shadow included. */
const MASTER_BOX = { w: 58, h: 36 };
/** Transparent breathing room around the fitted art, 2× px. */
const PAD = 4;
/** Pure magenta backing + key tuning (see the header). */
export const MAGENTA = [255, 0, 255];
const KEY_CUT = 0.055;                    // coverage under this is background
const KEY_FULL = 0.94;                    // over this is solid paint
const SHADOW_NEUTRAL = [74, 54, 62];      // the low-coverage band reads as umber
/** Coverage that counts as the truck's own body (vs its shadow) when anchoring. */
const BODY_CUT = 150;
const SOFT_CUT = 8;                       // same threshold the sheet packer uses

const COLORS = { blue: "player 1 (human)", red: "player 2 (rival)" };
const VIEWS = { ne: "away to the upper right", se: "toward the lower right",
  sw: "toward the lower left", nw: "away to the upper left" };
export const TRUCK_NAMES = [];
for (const color of Object.keys(COLORS)) for (const v of Object.keys(VIEWS)) TRUCK_NAMES.push(`truck_${color}_${v}`);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const snap4 = (v) => Math.max(4, Math.ceil(v / 4) * 4);
const snapEven = (v) => Math.max(0, Math.round(v / 2) * 2);

/**
 * Key a solid-magenta backing out of an opaque RGBA buffer (in place of alpha).
 * Exported so a test can pin the algebra without touching the disk.
 */
export function keyMagentaBacked(data, width, height, channels = 3) {
  const out = Buffer.alloc(width * height * 4);
  const inv = 1 / (1 - KEY_CUT);
  for (let i = 0, o = 0; i < width * height; i++, o += 4) {
    const s = i * channels;
    const r = data[s], g = data[s + 1], b = data[s + 2];
    const aRaw = clamp01(1 - (Math.min(r, b) - g) / 255);
    if (aRaw <= KEY_CUT) continue;                       // stays transparent
    const a = clamp01((aRaw - KEY_CUT) * inv);
    const gain = 1 / Math.max(aRaw, 1e-3);
    const w = a >= KEY_FULL ? 0 : (KEY_FULL - a) / KEY_FULL * 0.85;
    const mix = (ch) => {
      const c = (data[s + ch] - (1 - aRaw) * MAGENTA[ch]) * gain;
      return Math.max(0, Math.min(255, Math.round(c * (1 - w) + SHADOW_NEUTRAL[ch] * w)));
    };
    out[o] = mix(0); out[o + 1] = mix(1); out[o + 2] = mix(2);
    out[o + 3] = Math.round(a * 255);
  }
  return { buf: out, width, height, channels: 4 };
}

/**
 * Alpha bbox of a keyed RGBA buffer, plus the ground-contact anchor measured
 * from the BODY only (see the header). Rows 0..2 of the body's bottom edge are
 * averaged in X, so a truck whose shadow drags east still anchors on its
 * wheels rather than on its bbox centre.
 */
export function measureKeyed(buf, w, h) {
  let minX = w, maxX = -1, minY = h, maxY = -1;
  let bMinX = w, bMaxX = -1, bMinY = h, bMaxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = buf[(y * w + x) * 4 + 3];
      if (a > SOFT_CUT) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (a >= BODY_CUT) {
        if (x < bMinX) bMinX = x; if (x > bMaxX) bMaxX = x;
        if (y < bMinY) bMinY = y;
        if (y > bMaxY) bMaxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error("fully transparent after keying");
  if (bMaxX < bMinX) { bMinX = minX; bMaxX = maxX; bMinY = minY; bMaxY = maxY; }
  const top = Math.max(minY, bMaxY - 2);
  let sx = 0, n = 0;
  for (let x = bMinX; x <= bMaxX; x++)
    for (let y = top; y <= bMaxY; y++)
      if (buf[(y * w + x) * 4 + 3] >= BODY_CUT) { sx += x; n++; }
  return {
    left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1,
    // the truck's OWN box — the paint, not its cast shadow
    bodyLeft: bMinX, bodyTop: bMinY,
    bodyWidth: bMaxX - bMinX + 1, bodyHeight: bMaxY - bMinY + 1,
    bodyBottom: bMaxY,
    anchorX: n ? sx / n : (bMinX + bMaxX) / 2,
    anchorY: bMaxY < 0 ? maxY : bMaxY,
  };
}

async function rawRGBA(path) {
  const { data, info } = await sharp(path, { limitInputPixels: false })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { buf: Buffer.from(data), width: info.width, height: info.height };
}

/**
 * One raw magenta picture → a compliant @2× master.
 *
 * The BODY drives the scale, never the soft bounding box: eight separately
 * generated lorries each painted their own contact shadow, so fitting the
 * shadow-inclusive box would make the truck with the widest puddle the smallest
 * vehicle on the map. `compile` below only trims and snaps, so this is the one
 * place the miniature scale is decided.
 */
async function keyToMaster(rawPath, masterPath) {
  const raw = await sharp(rawPath, { limitInputPixels: false })
    .removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const keyed = keyMagentaBacked(Buffer.from(raw.data), raw.info.width, raw.info.height, raw.info.channels);
  const m = measureKeyed(keyed.buf, keyed.width, keyed.height);
  const s = Math.min(MASTER_BOX.w / m.bodyWidth, MASTER_BOX.h / m.bodyHeight);
  const AW = Math.max(8, Math.round(m.width * s)), AH = Math.max(8, Math.round(m.height * s));
  // snap4 the CANVAS (not the art) so 1×/0.5× stay exact halves, and let
  // `compile` measure the anchor from the pixels it finds.
  const W = snap4(AW + PAD * 2), H = snap4(AH + PAD * 2);
  const offX = Math.round((W - AW) / 2), offY = Math.round((H - AH) / 2);
  const art = await sharp(keyed.buf, { raw: { width: keyed.width, height: keyed.height, channels: 4 } })
    .extract({ left: m.left, top: m.top, width: m.width, height: m.height })
    .resize(AW, AH, { fit: "fill", kernel: "lanczos3" })
    .png().toBuffer();
  const canvas = sharp({
    create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: art, left: offX, top: offY }]);
  mkdirSync(dirname(masterPath), { recursive: true });
  await canvas.png({ compressionLevel: 9, effort: 10 }).toFile(masterPath);
  return { w: W, h: H, scale: s, fit: [AW, AH] };
}

/**
 * Master → the three shipped tiers + the manifest entry. The 2× box is snapped
 * to a multiple of 4 and the resize chain is `contain`-style with explicit
 * offsets, so every derived size and the anchor stay exact integers.
 */
async function compile(name) {
  const master = join(SRC, `${name}@2x.png`);
  if (!existsSync(master)) throw new Error(`missing master ${master} — author it, or run --raw`);
  const { buf, width, height } = await rawRGBA(master);
  const m = measureKeyed(buf, width, height);
  const w2 = snap4(m.width), h2 = snap4(m.height);
  // uniform scale into the snapped box, then pad: no anamorphic stretch
  const s = Math.min(w2 / m.width, h2 / m.height);
  const sw = Math.max(1, Math.round(m.width * s)), sh = Math.max(1, Math.round(m.height * s));
  const offX = Math.round((w2 - sw) / 2), offY = Math.round((h2 - sh) / 2);
  const scaled = await sharp(buf, { raw: { width, height, channels: 4 } })
    .extract({ left: m.left, top: m.top, width: m.width, height: m.height })
    .resize(sw, sh, { fit: "fill", kernel: "lanczos3" })
    .png().toBuffer();
  const box = sharp({
    create: { width: w2, height: h2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: scaled, left: offX, top: offY }]);
  const anchor2 = [
    Math.min(w2 - 2, Math.max(2, snapEven(offX + (m.anchorX - m.left) * s))),
    Math.min(h2 - 2, Math.max(2, snapEven(offY + (m.anchorY - m.top) * s))),
  ];
  // sharp runs `composite` before a later `resize`, so the boxed 2× art is
  // rendered to a buffer first and every smaller tier resamples THAT.
  const boxed = await box.png().toBuffer();
  const [w1, h1] = [w2 / 2, h2 / 2], [w05, h05] = [w2 / 4, h2 / 4];
  for (const [suffix, tw, th, pal] of [["2x", w2, h2, false], ["1x", w1, h1, true], ["0.5x", w05, h05, true]]) {
    if (!Number.isInteger(tw) || !Number.isInteger(th))
      throw new Error(`${name}: tier ${suffix} is not integral (${tw}×${th})`);
    await sharp(boxed)
      .resize(tw, th, { fit: "fill", kernel: suffix === "2x" ? "nearest" : "lanczos3" })
      .png({ compressionLevel: 9, effort: 10, ...(pal ? { palette: true, colours: 128 } : {}) })
      .toFile(join(OUT, `${name}@${suffix}.png`));
  }
  return {
    // manifest geometry is 1×; `zoomFrameRect` multiplies it by the zoom
    w: w1, h: h1, anchor: [anchor2[0] / 2, anchor2[1] / 2],
    footprint: [1, 1], moving: true, box2x: [w2, h2],
    bodyTop1x: Math.round((m.bodyTop - m.top) * s / 2),
  };
}

async function run() {
  const args = process.argv.slice(2);
  const rawAt = args.indexOf("--raw");
  const only = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1] === "--raw")
    && args[i - 1] !== "--raw");
  const names = (only.length ? only : TRUCK_NAMES).filter((n) => TRUCK_NAMES.includes(n));
  if (!names.length) throw new Error(`no truck names (expected one of ${TRUCK_NAMES.join(", ")})`);
  mkdirSync(OUT, { recursive: true });

  if (rawAt >= 0) {
    const dir = resolve(args[rawAt + 1] ?? "");
    if (!dir || !existsSync(dir)) throw new Error(`--raw needs a directory of <name>.png`);
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".png"))) {
      const name = f.replace(/\.png$/, "");
      if (!TRUCK_NAMES.includes(name))
        throw new Error(`raw art ${f} is not a truck sprite name (${TRUCK_NAMES.join(", ")})`);
      const r = await keyToMaster(join(dir, f), join(SRC, `${name}@2x.png`));
      console.log(`keyed ${name} → ${r.w}×${r.h}@2x (fit ${r.fit.join("×")}, scale ${r.scale.toFixed(3)})`);
    }
  }

  // The manifest is cumulative: compile a subset without dropping the others.
  const manifestPath = join(OUT, "manifest.json");
  const prev = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8")).sprites ?? {} : {};
  const sprites = { ...prev };
  for (const name of names) {
    const def = await compile(name);
    const [, color, view] = name.split("_");
    sprites[name] = {
      ...def,
      owner: color === "blue" ? 1 : 2,
      view,
      note: `TRUCK-BRAND: 1950s delivery lorry, ${COLORS[color]}, ${VIEWS[view]}. `
        + `Keyed off pure magenta by tools/make-truck-art.mjs; ${def.box2x.join("×")} at 2×.`,
    };
    console.log(`${name}: ${def.box2x.join("×")}@2x → ${def.w}×${def.h}@1x anchor (${def.anchor})`);
  }
  const order = Object.keys(sprites).sort((a, b) => TRUCK_NAMES.indexOf(a) - TRUCK_NAMES.indexOf(b));
  writeFileSync(manifestPath, JSON.stringify({
    tileW: 64, tileH: 32,
    meta: {
      generatedBy: "tools/make-truck-art.mjs",
      source: "assets/vehicles-src/<name>@2x.png (authored, keyed off #FF00FF)",
      note: "Per-vehicle PNG layers. The DEFS here are complete geometry (rect 0,0,w,h at 1×, "
        + "ground-contact anchor, footprint 1×1, moving) so `loadVehicleLayers` can install the "
        + "sprite straight into the table the renderer reads — the branded lorries need no cell in "
        + "assets/iso-atlas, and the legacy truck_goods_* sheet art stays as the boot fallback.",
    },
    sprites: Object.fromEntries(order.map((k) => [k, sprites[k]])),
  }, null, 2) + "\n");
  console.log(`wrote ${manifestPath} (${order.length} sprites)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
