#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// SCENERY ART — cut from the supplied textures. Nothing here is drawn.
//
// An earlier pass generated trees as stacked SVG blobs and ground patches as
// noise fields. Both were rejected on sight, and rightly: the map is painted
// art, and procedural vector shapes sit on top of it like stickers no matter
// how they are tuned. This tool only ever CUTS, FITS and OPTIMISES artwork
// that already exists, and when a source is missing it ships NOTHING rather
// than inventing a stand-in.
//
//   TREES — tools/scenery-src/trees.png
//     A sheet of painted trees on a transparent ground. Each is found by
//     connected-component labelling, so the sheet's size and spacing are
//     free — only the READING ORDER matters, and the tool logs what it found.
//
//     Sizes come from the ART, not from a hand-set table: the tallest tree on
//     the sheet is mapped to TALLEST_2X and every other is scaled by that
//     same factor, so the proportions the artist drew (a bush against a pine)
//     survive into the game exactly.
//
//     Geometry: the same contract as tools/make-building-pngs.mjs. A 1×1
//     sprite is centre-anchored (`def.center`), so the anchor pixel is the
//     foot of the trunk and the engine lands it on the tile's centre. Sizes
//     are snapped so w@2x = 2·w@1x = 4·w@0.5x exactly — the blit's source
//     rect is round(w · zoom) and a mismatch crops an edge.
//
//   GROUND DECALS — tools/scenery-src/*.png
//     Large patches of bare earth and of grass that differs from the base
//     meadow, laid flat on the ground. Authored 2:1 SQUASHED, because a round
//     patch on the ground is an ellipse on screen.
//
// OPTIMISATION. Every output is resampled with lanczos3, tight-trimmed, and
// written as a quantised palette PNG at maximum zlib effort. The tool prints
// source and shipped byte totals; nothing ships at source resolution.
//
// Usage: node tools/make-scenery-art.mjs   (or: npm run scenery-art)
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { mkdirSync, writeFileSync, existsSync, statSync, readdirSync, rmSync } from "node:fs";
import { deriveDecalTiers } from "./make-detail-tiers.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "tools", "scenery-src");
const DECALS = join(root, "assets", "ground", "decals");
const SCENERY = join(root, "assets", "scenery");

mkdirSync(DECALS, { recursive: true });
mkdirSync(SCENERY, { recursive: true });

const KERNEL = "lanczos3";
const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
/** Smoothstep, for the shadow falloff. */
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Write a PNG as small as it will go: quantised palette, maximum zlib effort,
 * adaptive filtering. Palette PNG keeps a full 8-bit alpha per entry, so the
 * canopies' anti-aliased edges and the shadow's feather survive.
 *
 * The TREE sprites stay PNG on purpose. They are small already, and they are
 * mostly edge: a lossy codec spends its bits on the flat middle of an image
 * and fringes exactly the thin, high-contrast alpha boundary a tree is made
 * of. Returns the byte count.
 */
async function writeOptimised(pipeline, file, colours = 200) {
  await pipeline
    .png({ palette: true, colours, compressionLevel: 9, effort: 10, adaptiveFiltering: true })
    .toFile(file);
  return statSync(file).size;
}

/**
 * Write a lossy WebP, for the big soft images — the ground patches and the
 * forest blocks.
 *
 * These are large, low-frequency painted texture with a wide feathered rim,
 * which is the case lossy compression is good at and palette PNG is bad at:
 * the same patch is 184 kB as a quantised PNG and 73 kB here, with no
 * difference anyone can see on a ground texture that is about to be scaled
 * and alpha-blended anyway. `alphaQuality` is kept high because the feather
 * IS the effect — banding there would put a visible rim back on.
 */
async function writeLossy(pipeline, file, { quality = 78, alphaQuality = 88 } = {}) {
  await pipeline.webp({ quality, alphaQuality, effort: 6 }).toFile(file);
  return statSync(file).size;
}

/** Tight alpha bounding box (alpha > threshold) of a raw RGBA buffer. */
function alphaBBox(data, width, height, threshold = 8) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/**
 * Raw RGBA with a DEPENDABLE alpha channel.
 *
 * Source art arrives one of two ways: exported with real transparency, or
 * flattened onto white. Guessing wrong ruins the run, so this decides from
 * the pixels — if the file's own alpha already varies, trust it; otherwise
 * treat near-white as the background and build alpha from how far each pixel
 * is from white, which keeps a soft rim instead of cutting it to a hard edge.
 */
async function rgbaWithAlpha(file, { whiteCut = 246, softness = 26 } = {}) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) { transparent++; if (transparent > 64) break; }
  }
  if (transparent > 64) return { data, width: info.width, height: info.height, derived: false };
  for (let i = 0; i < data.length; i += 4) {
    const m = Math.min(data[i], data[i + 1], data[i + 2]);
    data[i + 3] = Math.round(255 * Math.max(0, Math.min(1, (whiteCut - m) / softness)));
  }
  return { data, width: info.width, height: info.height, derived: true };
}

// ══ TREES ══════════════════════════════════════════════════════════════════
const TREE_SHEET = join(SRC, "trees.png");

/**
 * The sheet's species in READING ORDER (left to right, top to bottom), and
 * how many SIZE VARIANTS of each to ship.
 *
 * The tool logs the box it found for each entry, so a re-ordered sheet is a
 * one-line edit here rather than a silent mislabelling.
 */
const SPECIES = [
  { name: "dead", variants: 3 },
  { name: "bush", variants: 4 },
  { name: "pine", variants: 4 },
  // The oak is drawn as a broad, low tree, and at the sheet's own proportions
  // it came out the biggest thing on the map — bigger than the buildings, and
  // it does not read as a tree that ought to be. Half size.
  { name: "oak", variants: 4, scale: 0.5 },
  { name: "maple", variants: 4 },
  { name: "birch", variants: 4 },
];

/**
 * Height in 2× pixels of the TALLEST tree on the sheet; everything else is
 * scaled by the same factor. A 1×1 tile is 64×32 world px, so 60 here puts
 * the biggest tree at 30px at 1×, just under one tile-height.
 *
 * Was 160, then 120. At 120 the bushes still came out the size of mansions
 * beside the buildings, so the whole set is halved again. The forest blocks
 * are sized from their own ground diamond (FOREST_ART_SCALE), not from this.
 */
const TALLEST_2X = 60;

/**
 * Variants are SIZE ONLY — a young tree and an old one of the same species.
 *
 * Per-variant mirroring is what is NOT allowed here. Every tree on the sheet
 * carries its key light on one side, so mirroring SOME of them scatters two
 * suns through the same wood. Every sprite is flipped, or none is; see
 * MIRROR_ALL.
 */
const VARIANT_SCALE = [1, 0.8, 1.16, 0.64];

/**
 * Flip every tree horizontally, together.
 *
 * The sheet is drawn lit from the upper RIGHT; the game wants the sun in the
 * upper LEFT, to match the buildings. Mirroring the whole set moves the light
 * consistently, so the wood still has one sun — it is only mirroring a subset
 * that breaks.
 */
const MIRROR_ALL = true;

/**
 * Cast shadow under a tree. Width as a fraction of the sprite's own width,
 * and 2:1 squashed because it lies flat on the isometric ground — the same
 * projection the decals use.
 */
const SHADOW_WIDTH = 0.72;
/** Opacity across the solid core of the ellipse. */
const SHADOW_ALPHA = 0.55;
/**
 * Fraction of the radius held at FULL strength before the falloff starts.
 *
 * This matters more than the peak alpha. The first version ramped from the
 * centre with a double smoothstep, which put the stated opacity on
 * essentially one pixel and faded everything else — over a grass texture as
 * busy and as dark as this one the result was invisible in game. A real
 * contact shadow is flat under the canopy and soft only at its rim.
 */
const SHADOW_CORE = 0.42;
/** How far the ellipse's centre sits ABOVE the art's bottom row, in pixels. */
const SHADOW_LIFT = 1;
/**
 * Offset of the shadow's centre from the trunk foot, as a fraction of the
 * radius: positive x is right, negative y is up the screen.
 *
 * The shadow is cast to the UPPER RIGHT. Note that this is an art direction,
 * not a physical one — with the sun moved to the upper left the cast would
 * fall to the lower right — but on an isometric ground plane a shadow thrown
 * up-screen reads as lying BEHIND the tree, which separates the trunk from
 * its canopy and seats the tree better than one pooling in front of it.
 */
const SHADOW_DX = 0.2;
const SHADOW_DY = -0.5;

/**
 * A soft elliptical shadow as a raw RGBA buffer, plus its radii and the
 * offset its centre sits at relative to the trunk foot.
 */
function shadowEllipse(spriteW) {
  const rx = Math.max(4, Math.round((spriteW * SHADOW_WIDTH) / 2));
  const ry = Math.max(2, Math.round(rx / 2));
  const w = rx * 2 + 1, h = ry * 2 + 1;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (x - rx) / rx, ny = (y - ry) / ry;
      const d = Math.hypot(nx, ny);
      if (d >= 1) continue;
      const t = d <= SHADOW_CORE ? 1 : smooth(1 - (d - SHADOW_CORE) / (1 - SHADOW_CORE));
      const i = (y * w + x) * 4;
      // A cool near-black rather than pure black: pure black over a warm
      // painted meadow reads as a hole punched in it.
      buf[i] = 14; buf[i + 1] = 20; buf[i + 2] = 10;
      buf[i + 3] = Math.round(255 * SHADOW_ALPHA * t);
    }
  }
  return {
    rx, ry, png: buf, raw: { width: w, height: h, channels: 4 },
    dx: Math.round(rx * SHADOW_DX),
    dy: Math.round(ry * SHADOW_DY),
  };
}

/**
 * Connected components of non-transparent pixels, 8-connected, returned in
 * reading order (row band, then x). Components under `minPx` are dropped —
 * that is a stray-speck filter, not a tuning knob.
 */
function components(data, width, height, minPx = 2000) {
  const seen = new Uint8Array(width * height);
  const opaque = (i) => data[i * 4 + 3] > 24;
  const out = [];
  const stack = new Int32Array(width * height);
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || !opaque(start)) continue;
    let sp = 0, n = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    while (sp) {
      const i = stack[--sp];
      n++;
      const x = i % width, y = (i / width) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const j = ny * width + nx;
          if (seen[j] || !opaque(j)) continue;
          seen[j] = 1;
          stack[sp++] = j;
        }
      }
    }
    if (n >= minPx) out.push({ minX, minY, maxX, maxY, pixels: n });
  }
  // Reading order: band by vertical position, then left to right in a band.
  const tallest = Math.max(1, ...out.map((c) => c.maxY - c.minY));
  out.sort((a, b) => {
    const band = Math.floor(a.minY / (tallest * 0.6)) - Math.floor(b.minY / (tallest * 0.6));
    return band || a.minX - b.minX;
  });
  return out;
}

async function buildTrees() {
  if (!existsSync(TREE_SHEET)) {
    console.error("missing tools/scenery-src/trees.png — nothing to cut.");
    process.exit(1);
  }
  const { data, info } = await sharp(TREE_SHEET).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const found = components(data, width, height);
  console.log(`  trees.png: ${width}x${height}, ${found.length} shapes`);
  if (found.length !== SPECIES.length) {
    console.error(`expected ${SPECIES.length} trees, found ${found.length}.`);
    console.error("The trees must not touch each other on the sheet.");
    process.exit(1);
  }

  // Relative scale is the ARTIST'S, not the tool's: map the tallest tree on
  // the sheet to TALLEST_2X and scale everything by that one factor.
  const tallest = Math.max(...found.map((b) => b.maxY - b.minY + 1));
  const factor = TALLEST_2X / tallest;

  // Clear first: a renamed or removed species would otherwise leave a stale
  // PNG behind that the bundler still globs in.
  for (const f of readdirSync(SCENERY)) rmSync(join(SCENERY, f));
  const sheet = sharp(Buffer.from(data), { raw: { width, height, channels: 4 } });
  const sprites = {};
  const names = [];
  let bytes = 0;

  for (let s = 0; s < SPECIES.length; s++) {
    const spec = SPECIES[s];
    const box = found[s];
    const bw = box.maxX - box.minX + 1, bh = box.maxY - box.minY + 1;

    for (let v = 0; v < spec.variants; v++) {
      const scale = VARIANT_SCALE[v] * (spec.scale ?? 1);
      const name = `tree_${spec.name}_${"abcd"[v]}`;
      const targetH = Math.max(8, Math.round(bh * factor * scale));

      let pipe = sheet.clone()
        .extract({ left: box.minX, top: box.minY, width: bw, height: bh })
        .resize({ height: targetH, kernel: KERNEL });
      if (MIRROR_ALL) pipe = pipe.flop();
      const scaled = await pipe.png().toBuffer();

      // Re-trim: the resize can leave a row of near-transparent pixels, and
      // the manifest's box must be the real one or the anchor drifts.
      const { data: rd, info: ri } = await sharp(scaled).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      const tb = alphaBBox(rd, ri.width, ri.height);
      if (!tb) throw new Error(`${name}: nothing left after the resize`);
      const tw = tb.maxX - tb.minX + 1, th = tb.maxY - tb.minY + 1;

      // Trunk x: centroid of the bottom rows of the art, which is trunk and
      // root flare, never canopy. A painted tree leans, so a bounding-box
      // centre would visibly drift the wood off the grid.
      let sum = 0, n = 0;
      for (let y = Math.max(tb.minY, tb.maxY - Math.max(2, th >> 4)); y <= tb.maxY; y++) {
        for (let x = tb.minX; x <= tb.maxX; x++) {
          if (rd[(y * ri.width + x) * 4 + 3] > 8) { sum += x - tb.minX; n++; }
        }
      }
      const footX = n ? Math.round(sum / n) : Math.round(tw / 2);

      // Bed the tree on the ground with a soft cast shadow. Without it a tree
      // hovers: the art has no contact point of its own, and on a flat
      // painted meadow there is nothing else to seat it.
      const shadow = shadowEllipse(tw);
      // The ellipse is centred on the foot, so it can reach outside the art's
      // own box on the left, the right and below; grow the canvas to fit.
      const sx = footX + shadow.dx;
      // Centre of the ellipse, measured down from the art's top edge.
      const sy = th - 1 - SHADOW_LIFT + shadow.dy;
      const padL = Math.max(0, shadow.rx - sx);
      const padR = Math.max(0, sx + shadow.rx - (tw - 1));
      const padB = Math.max(0, sy + shadow.ry - (th - 1));
      const cw = tw + padL + padR, ch = th + padB;

      const composed = await sharp({
        create: { width: cw, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite([
        {
          input: shadow.png, raw: shadow.raw,
          left: sx + padL - shadow.rx,
          top: sy - shadow.ry,
        },
        {
          input: await sharp(scaled)
            .extract({ left: tb.minX, top: tb.minY, width: tw, height: th })
            .png().toBuffer(),
          left: padL, top: 0,
        },
      ]).png().toBuffer();

      // Pad right/bottom only, to a multiple of 4 at 2×, so every zoom tier
      // divides exactly. Those two edges leave the top-left origin — and
      // therefore the anchor — untouched.
      const w2 = Math.ceil(cw / 4) * 4, h2 = Math.ceil(ch / 4) * 4;
      const base = sharp(
        await sharp(composed)
          .extend({ right: w2 - cw, bottom: h2 - ch, background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png().toBuffer(),
      );

      bytes += await writeOptimised(base.clone(), join(SCENERY, `${name}@2x.png`));
      for (const [z, suffix] of [[1, "1x"], [0.5, "0.5x"]]) {
        bytes += await writeOptimised(
          base.clone().resize(Math.round((w2 * z) / 2), Math.round((h2 * z) / 2), { kernel: KERNEL }),
          join(SCENERY, `${name}@${suffix}.png`));
      }

      sprites[name] = {
        footprint: [1, 1],
        // 1× values: the manifest is the 1× authority, the engine scales by zoom.
        w: w2 / 2, h: h2 / 2,
        // Foot of the trunk — now offset by the shadow's left padding, and
        // measured from the ART's bottom row rather than the canvas's, since
        // the shadow hangs below it.
        anchor: [Math.round((footX + padL) / 2), Math.round((th - 1) / 2)],
      };
      names.push(name);
    }
    const a = sprites[`tree_${spec.name}_a`];
    console.log(`  ${spec.name}: source ${bw}x${bh} -> ${a.w}x${a.h} @1x, `
      + `anchor ${a.anchor.join(",")}, ${spec.variants} variants`);
  }

  return { names, bytes, sprites };
}

// ══ FOREST BLOCKS ══════════════════════════════════════════════════════════
/**
 * The multi-tile forest art. Each covers a 4×4 footprint, so unlike the 1×1
 * trees its GROUND DIAMOND has to line up with a specific number of tiles —
 * and taking the scale from the artwork's bounding box would be wrong,
 * because the canopies overhang the ground by a different amount in each
 * drawing.
 *
 * So the scale comes from the diamond itself: the widest opaque row of the
 * picture IS the diamond's waist (its left and right vertices), and that is
 * mapped to the exact width a 4×4 footprint spans. The anchor then follows
 * from the geometry — horizontally the waist's midpoint, vertically half a
 * diamond above the bottom vertex, which is the footprint's centre and what
 * `def.center` placement expects.
 */
const FOREST = [
  { name: "forest_conifer", file: "forest-conifer.png" },
  { name: "forest_mixed", file: "forest-mixed.png" },
];

/** Footprint in tiles. Must match FOREST_FOOTPRINT in src/iso/scenery.ts. */
const FOREST_TILES = 4;

/**
 * How much of the nominal footprint width the forest art is drawn at.
 *
 * 0.75 rather than 1: at full size the block's own trees stood taller than
 * the buildings beside it, the same scale problem the 1×1 trees had. The
 * FOOTPRINT stays 4×4 — the block still occupies four tiles by four, it is
 * just drawn as a smaller wood standing on them.
 */
const FOREST_ART_SCALE = 0.75;

async function buildForests(sprites) {
  // (w + h) · HW, doubled for the 2× authoring tier: 8 · 32 · 2.
  const targetWaist = Math.round(FOREST_TILES * 2 * 32 * 2 * FOREST_ART_SCALE);
  let bytes = 0;
  const names = [];

  for (const { name, file } of FOREST) {
    const path = join(SRC, file);
    if (!existsSync(path)) {
      console.log(`  ${name}: no ${file} — skipped`);
      continue;
    }
    // Mirrored left-to-right, like the 1×1 trees (MIRROR_ALL): the source art
    // is lit from the upper right and the game's sun is upper left. Flipped
    // BEFORE the waist and anchor are measured, so they describe the art as
    // it ships.
    const { data, info } = await sharp(path).flop().ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    // The widest opaque row is the ground diamond's waist; the lowest opaque
    // row is its bottom vertex.
    let waistW = 0, waistCx = width / 2, bottomY = 0;
    for (let y = 0; y < height; y++) {
      let a = width, b = -1;
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) { if (x < a) a = x; if (x > b) b = x; }
      }
      if (b < 0) continue;
      bottomY = y;
      if (b - a + 1 > waistW) { waistW = b - a + 1; waistCx = (a + b) / 2; }
    }
    const scale = targetWaist / waistW;

    const resized = await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
      .resize(Math.round(width * scale), Math.round(height * scale), { kernel: KERNEL })
      .png().toBuffer();

    const { data: rd, info: ri } = await sharp(resized).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const tb = alphaBBox(rd, ri.width, ri.height);
    if (!tb) throw new Error(`${file} is fully transparent`);
    const tw = tb.maxX - tb.minX + 1, th = tb.maxY - tb.minY + 1;

    // Footprint centre, in the trimmed sprite's own pixels.
    const ax = Math.round(waistCx * scale) - tb.minX;
    const ay = Math.round(bottomY * scale) - tb.minY - targetWaist / 4;

    // Pad right/bottom only, to a multiple of 4 at 2×; the top-left origin —
    // and therefore the anchor — is untouched.
    const w2 = Math.ceil(tw / 4) * 4, h2 = Math.ceil(th / 4) * 4;
    const base = sharp(
      await sharp(resized)
        .extract({ left: tb.minX, top: tb.minY, width: tw, height: th })
        .extend({ right: w2 - tw, bottom: h2 - th, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer(),
    );

    // Lossy for the forest blocks: each is a big painted image, and at three
    // zooms the six files were 290 kB as PNG against about a third of that
    // here. Quality is held higher than the ground patches because a forest
    // block is looked AT, not looked over.
    bytes += await writeLossy(base.clone(), join(SCENERY, `${name}@2x.webp`), { quality: 86 });
    for (const [z, suffix] of [[1, "1x"], [0.5, "0.5x"]]) {
      bytes += await writeLossy(
        base.clone().resize(Math.round((w2 * z) / 2), Math.round((h2 * z) / 2), { kernel: KERNEL }),
        join(SCENERY, `${name}@${suffix}.webp`), { quality: 86 });
    }

    sprites[name] = {
      footprint: [FOREST_TILES, FOREST_TILES],
      w: w2 / 2, h: h2 / 2,
      anchor: [Math.round(ax / 2), Math.round(ay / 2)],
    };
    names.push(name);
    console.log(`  ${name}: waist ${waistW}px -> ${w2}x${h2} @2x, `
      + `${FOREST_TILES}x${FOREST_TILES} tiles, anchor ${sprites[name].anchor.join(",")}`);
  }
  return { names, bytes };
}

// ══ GROUND DECALS ══════════════════════════════════════════════════════════
/**
 * Decal canvas: 2:1, because a patch lies flat on the iso ground.
 *
 * 768 wide rather than 1024: the largest patch the scatter places is ~640
 * world px, so even at the 2× camera this upsamples by about 1.6 — invisible
 * on soft organic ground texture, and it takes a third off every file.
 */
const DECAL_W = 768, DECAL_H = 384;

/**
 * Families the engine knows, and the source file each is cut from. A family
 * with no source simply ships nothing — the decal pass then finds no art for
 * it and paints none, which is the correct behaviour for missing art and the
 * reason there is no invented fallback here.
 */
const DECAL_SOURCES = {
  bare: "bare-patch.png",
  dry: "grass-dry.png",
  rocky: "grass-rocky.png",
  lush: "grass-lush.png",
};

/**
 * How many rotated variants to cut from each source. Three is enough because
 * the engine also mirrors a patch at draw time, so twelve files give
 * twenty-four apparent shapes — and each one of these is a quarter of a
 * megabyte of source art, so the count is worth being mean about.
 */
const VARIANTS = 3;

async function buildDecals() {
  // `recursive`: the GFX-01 medium/ and low/ tier folders live in here too.
  for (const f of readdirSync(DECALS)) rmSync(join(DECALS, f), { recursive: true, force: true });
  const counts = {};
  let bytes = 0;

  for (const [family, fileName] of Object.entries(DECAL_SOURCES)) {
    const file = join(SRC, fileName);
    if (!existsSync(file)) {
      console.log(`  ${family}: no ${fileName} — shipping none`);
      continue;
    }
    const src = await rgbaWithAlpha(file);
    console.log(`  ${family}: ${fileName} ${src.width}x${src.height}, `
      + `alpha ${src.derived ? "derived from white" : "from file"}`);
    for (let v = 0; v < VARIANTS; v++) {
      // A ground texture has no up, so a rotation is a free, fully organic
      // variant — better than cropping, which would cut the soft rim off.
      const { data, info } = await sharp(Buffer.from(src.data), {
        raw: { width: src.width, height: src.height, channels: 4 },
      })
        .rotate(v * 47 + 13, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .raw().toBuffer({ resolveWithObject: true });
      const box = alphaBBox(data, info.width, info.height, 2);
      if (!box) throw new Error(`${fileName} is fully transparent`);
      const img = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .extract({
          left: box.minX, top: box.minY,
          width: box.maxX - box.minX + 1, height: box.maxY - box.minY + 1,
        })
        // `fill` on purpose: the 2:1 target IS the ground projection, not a
        // distortion — a round patch on the ground is an ellipse on screen.
        .resize(DECAL_W, DECAL_H, { kernel: KERNEL, fit: "fill" });
      bytes += await writeLossy(img, join(DECALS, `${family}_${v + 1}.webp`));
      counts[family] = (counts[family] ?? 0) + 1;
    }
  }
  return { counts, bytes };
}

// ── run ─────────────────────────────────────────────────────────────────────
const srcBytes = readdirSync(SRC)
  .filter((f) => f.endsWith(".png"))
  .reduce((a, f) => a + statSync(join(SRC, f)).size, 0);

console.log("trees (tools/scenery-src/trees.png):");
const trees = await buildTrees();
console.log(`-> ${trees.names.length} sprites, ${kb(trees.bytes)}\n`);

console.log(`forest blocks (${FOREST_TILES}x${FOREST_TILES} tiles):`);
const forests = await buildForests(trees.sprites);
console.log(`-> ${forests.names.length} sprites, ${kb(forests.bytes)}\n`);

// One manifest for every scenery sprite, written after both passes so the
// forest blocks and the trees cannot disagree about what shipped.
writeFileSync(join(SCENERY, "manifest.json"), JSON.stringify({
  note: "Scenery, cut from tools/scenery-src/ by tools/make-scenery-art.mjs. Same geometry contract as assets/buildings/manifest.json: w/h/anchor are 1x, footprint in tiles, art is centre-anchored on the footprint. For a tree the anchor is the foot of the trunk; for a forest block it is the centre of its ground diamond.",
  sprites: trees.sprites,
}, null, 2) + "\n");

console.log("ground decals (tools/scenery-src):");
const decals = await buildDecals();
const total = Object.values(decals.counts).reduce((a, b) => a + b, 0);
console.log(total
  ? `-> ${Object.entries(decals.counts).map(([k, v]) => `${k}:${v}`).join(" ")}, ${kb(decals.bytes)}`
  : "-> none: no source textures, so the ground stays a plain meadow");

// GFX-01: the medium/low presets load half/quarter-size decal copies.
console.log("\ndecal detail tiers:");
await deriveDecalTiers();

console.log(`\nsources ${kb(srcBytes)} -> shipped ${kb(trees.bytes + decals.bytes)}`);
console.log(`\nTREE_SPRITES for src/iso/scenery.ts:\n  ${trees.names.map((n) => `"${n}"`).join(", ")}`);
console.log(`FOREST_SPRITES:\n  ${forests.names.map((n) => `"${n}"`).join(", ")}`);
