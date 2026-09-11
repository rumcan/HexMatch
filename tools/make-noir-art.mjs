#!/usr/bin/env node
/**
 * NOIR — build the "Foundry Syndicate" UI art (Warcraft plaque × 1930s
 * prohibition noir) out of the painted source plates.
 *
 *   node tools/make-noir-art.mjs                 # all of it
 *   node tools/make-noir-art.mjs --gems          # just the cargo tokens
 *   node tools/make-noir-art.mjs --contact /tmp/noir.png   # review sheet
 *
 * Sources (committed, hand-swappable): `assets/ui-src/noir/*.png`. They are
 * painted plates, one per family of element; every number below is derived
 * from the sheet geometry, not from the game's, so replacing a source with a
 * re-painted sheet of the same layout regenerates matching assets.
 *
 * Two invariants, because the HUD stretches and repeats its surfaces and the
 * theme must survive that:
 *   NO SEAM   — every texture CSS may repeat (felt, smoke, ledger) is run
 *               through `seamless()`, and the tool prints the measured seam of
 *               each output so a regression is a number, not a screenshot.
 *   NO STRETCH — nothing is emitted to be squashed by the box it lands in.
 *               Fields are seamless tiles painted at one fixed px size; the
 *               ornaments that sit in a corner are cut at exactly the px the
 *               CSS paints them at; icons and tokens keep a square aspect and
 *               are drawn with `auto 100%`/`cover`, i.e. scaled uniformly and
 *               cropped — never `100% 100%`, never per-axis.
 *
 * Output:
 *   src/assets/ui/noir/corner-<tl,tr,br,bl>.png
 *                                        the frame's filigree corners, at the
 *                                        size `.panel`/`.modal` paint them — the
 *                                        ornament a nine-slice would have
 *                                        distorted is instead drawn whole
 *   src/assets/ui/noir/felt.webp         seamless inset (panels, board, log)
 *   src/assets/ui/noir/backdrop.webp     the war-room behind the chrome
 *   src/assets/ui/noir/emblem.png        guild seal, black-knocked to alpha
 *   src/assets/ui/noir/sigil/<key>.png   one framed emblem per action button
 *   src/assets/gems/<cargo>.png          the six match-3 cargo tokens
 *
 * The button/banner art deliberately keeps its painted frame (it reads as an
 * inlaid card on the iron plate); the gems get a circular matte so they sit on
 * the felt like chips.
 */
import { mkdirSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets/ui-src/noir");
const OUT = join(ROOT, "src/assets/ui/noir");
const GEMS = join(ROOT, "src/assets/gems");
const SIGIL = join(OUT, "sigil");
mkdirSync(OUT, { recursive: true });
mkdirSync(SIGIL, { recursive: true });
mkdirSync(GEMS, { recursive: true });

const argv = process.argv.slice(2);
const contactPath = (() => {
  const i = argv.indexOf("--contact");
  return i >= 0 ? argv[i + 1] : null;
})();
/** flags = `--name` selectors; anything else (a path) is not a selector */
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const only = (name) => flags.has(`--${name}`);
// `--contact`/`--seam-check` take a path: they are options, not selectors, so
// asking for a review sheet still rebuilds everything.
const OPTIONS = new Set(["--contact", "--seam-check"]);
const selectors = [...flags].filter((f) => !OPTIONS.has(f));
const everything = selectors.length === 0;                        // no selector → all of it
const want = (name) => everything || only(name);

// ── sheet layouts ───────────────────────────────────────────────────────────
// Each painted sheet is a strict grid of equal cells; cell (col,row) is taken
// as an exact fraction of the sheet, so the art is never measured or nudged.
/** cell order is row-major, matching how the sheets were painted. */
const GRID = {
  // Cell 6 of the build sheet (the blueprints) and cell 6 of the sabotage sheet
  // (the second gas mask) are deliberately NOT sliced: nothing in the HUD has a
  // corner left for them. Add a key to slice them; the sheet stays as painted.
  build: { cols: 3, rows: 2, keys: ["dirt", "road", "harvester", "plant", "demolish"] },
  sab:   { cols: 4, rows: 2, keys: ["bandit", "protest", "block", "harden", "fog", "security", "repair"] },
  gems:  { cols: 3, rows: 2, keys: ["grain", "wood", "ore", "stone", "oil", "gold"] },
};

// frames are shaved off the outside of each cell so no neighbour bleeds in
const INSET = 0.028;

const src = (name) => {
  const p = join(SRC, name);
  if (!existsSync(p)) {
    console.error(`NOIR: missing source plate ${p} — restore assets/ui-src/noir/ and re-run.`);
    process.exit(1);
  }
  return p;
};

/** The `{left,top,width,height}` of cell `i` (row-major) of a cols×rows grid. */
const cellRect = (w, h, cols, rows, i, inset = INSET) => {
  const c = i % cols, r = (i / cols) | 0;
  const cw = w / cols, ch = h / rows;
  const ix = cw * inset, iy = ch * inset;
  return { left: Math.round(c * cw + ix), top: Math.round(r * ch + iy), width: Math.round(cw - 2 * ix), height: Math.round(ch - 2 * iy) };
};

/** Alpha for a "knock the flat black page out" plate, as a raw buffer. */
async function alphaFromLuminance(img, { lo = 10, hi = 34, floor = 0.35 } = {}) {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = Buffer.from(data);
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const t = Math.max(0, Math.min(1, (lum - lo) / (hi - lo)));
    px[i + 3] = Math.round(255 * Math.max(t, t > 0 ? floor : 0));
  }
  return { px, info: { ...info, channels: 4 } };
}

/**
 * Make a bitmap wrap-continuous, so CSS can repeat it without a grout line.
 *
 * Two moves, both on raw pixels, neither of which touches the art's scale:
 *
 *  1. ROLL it by half its width and height. The sheet's own edges then meet in
 *     the middle and its middle becomes the repeat boundary — and two adjacent
 *     columns of the painting are continuous, so the tile now joins perfectly.
 *     The roll only MOVES the seam, which is why
 *  2. FOLD it closed: each axis in turn is cross-faded, inside a band
 *     `feather` of the tile, with its own mirror image about the seam line. A
 *     mirror agrees with itself across its fold, so the crease disappears into
 *     the texture. Outside the band every pixel is byte-for-byte what was
 *     painted, so nothing smears and nothing repeats.
 *
 * Mirroring costs a faint symmetry down the middle of the tile — the right
 * trade for noise-felt, cloud-smoke and paper-mottling, and the reason `seam`
 * below reports the fold as well as the edge. Returns a sharp instance.
 */
async function seamless(input, feather = 0.34) {
  // a sharp pipeline or any path/buffer sharp can open
  const img = typeof input?.clone === "function" ? input : sharp(input);
  const { data, info } = await img.ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, c = info.channels;
  const ox = w >> 1, oy = h >> 1;
  const px = (buf, x, y) => (y * w + x) * c;
  const roll = Buffer.alloc(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = (x + ox) % w, sy = (y + oy) % h;
      for (let k = 0; k < c; k++) roll[px(roll, x, y) + k] = data[px(data, sx, sy) + k];
    }
  }
  // Cosine band, peaking at HALF weight on the fold line: the fold is then the
  // average of the two pixels it joins, which is what closes the crease. Full
  // weight would swap the two sides and leave the very step it was meant to
  // remove — measured, not theorised: peak 1 left a 5-level crease in the smoke.
  const band = (d, half) => (d >= half ? 0 : 0.25 * (1 + Math.cos((Math.PI * d) / half)));
  const fold = (src, axis, mirror) => {
    const n = axis === "x" ? w : h;
    const half = Math.max(4, Math.round(n * feather * 0.5));
    const mid = (n - 1) / 2;
    const out = Buffer.from(src);
    for (let a = 0; a < n; a++) {
      const t = band(Math.abs(a - mid), half);
      if (t === 0) continue;
      for (let b = 0; b < (axis === "x" ? h : w); b++) {
        const x = axis === "x" ? a : b, y = axis === "x" ? b : a;
        const mx = axis === "x" ? mirror(x) : x, my = axis === "y" ? mirror(y) : y;
        for (let k = 0; k < c; k++) {
          const v0 = src[px(src, x, y) + k];
          const v1 = src[px(src, mx, my) + k];
          out[px(out, x, y) + k] = Math.round(v0 + (v1 - v0) * t);
        }
      }
    }
    return out;
  };
  const flop = fold(roll, "x", (x) => w - 1 - x);
  const out = fold(flop, "y", (y) => h - 1 - y);
  return sharp(out, { raw: { width: w, height: h, channels: c } });
}

/**
 * How visible a seam is, in 8-bit levels: `edge` is the mean step across the
 * wrap boundary (the line a repeat would draw), `crease` the step across the
 * fold the roll put in the middle, `inside` the texture's own pixel-to-pixel
 * grain. A tile is safe to repeat when both steps are a couple of levels, or
 * when they stand no more than ~1.6× apart on a busy sheet. Measured on the
 * decoded file: what repeats is the encoding, not the intent.
 */
async function seamMetrics(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const at = (x, y) => data[y * w + x];
  const mean = (vals) => vals.reduce((a, b) => a + b, 0) / vals.length;
  const edge = []; const crease = []; const inside = [];
  const midX = (w - 1) >> 1, midY = (h - 1) >> 1;
  for (let y = 0; y < h; y++) {
    edge.push(Math.abs(at(0, y) - at(w - 1, y)));
    if (y + 1 < h) crease.push(Math.abs(at(midX, y) - at(midX + 1, y)), Math.abs(at(midX, y + 1) - at(midX + 1, y + 1)));
  }
  for (let x = 0; x < w; x++) {
    edge.push(Math.abs(at(x, 0) - at(x, h - 1)));
    if (x + 1 < w) crease.push(Math.abs(at(x, midY) - at(x, midY + 1)));
  }
  for (let y = 0; y < h; y += 2) for (let x = 0; x + 1 < w; x += 2) inside.push(Math.abs(at(x, y) - at(x + 1, y)));
  for (let y = 0; y + 1 < h; y += 2) for (let x = 0; x < w; x += 2) inside.push(Math.abs(at(x, y) - at(x, y + 1)));
  const e = mean(edge), i = mean(inside), cr = mean(crease);
  return {
    edge: e, crease: cr, inside: i, worst: Math.max(...edge),
    ratio: e / Math.max(0.6, i), creaseRatio: cr / Math.max(0.6, i),
  };
}

/** Circular matte at `r` of the short edge, feathered, centred. */
function circularAlpha(w, h, r = 0.495, feather = 0.03) {
  const px = Buffer.alloc(w * h * 4);
  const cx = w / 2, cy = h / 2, rad = Math.min(w, h) * r;
  const inner = rad * (1 - feather);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const t = d <= inner ? 1 : d >= rad ? 0 : (rad - d) / (rad - inner);
      const i = (y * w + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = 255;
      px[i + 3] = Math.round(255 * t * t * (3 - 2 * t)); // smoothstep
    }
  }
  return px;
}

const plateLog = [];
async function writeWebp(bufPath, out, { quality = 82, resize } = {}) {
  let img = sharp(bufPath);
  if (resize) img = img.resize(resize);
  const file = join(OUT, out);
  await img.webp({ quality, effort: 6 }).toFile(file);
  // metadata from the WRITTEN file: sharp's own metadata() reports the
  // pipeline's input, which is how a resized plate once logged 2064×512
  // while the file it wrote was 1024×260.
  const meta = await sharp(file).metadata();
  plateLog.push([out, `${meta.width}×${meta.height}`, statSync(file).size]);
}

// ── 1. frames and fills ─────────────────────────────────────────────────────
const seamLog = [];

/**
 * A texture CSS is allowed to REPEAT, made to survive it: centre-cropped to a
 * square (so the fixed tile size in CSS is a uniform scale, never a squash),
 * resized, then `seamless()`. Everything in `frames()` that can tile goes
 * through here, so "no seams, no stretching" is one code path, not a habit.
 */
async function writeTile(input, out, { quality = 80, side = 512, crop = 1, feather = 0.3, greyscale = false, linear, saturation } = {}) {
  let img = sharp(input);
  {
    const m = await sharp(input).metadata();
    const s0 = Math.round(Math.min(m.width, m.height) * crop);
    img = img.extract({ left: ((m.width - s0) / 2) | 0, top: ((m.height - s0) / 2) | 0, width: s0, height: s0 });
  }
  img = img.resize({ width: side, height: side });      // square → square
  if (greyscale) img = img.greyscale();
  if (linear) img = img.linear(linear[0], linear[1]);
  if (saturation != null) img = img.modulate({ saturation });
  const buf = await (await seamless(img, feather)).webp({ quality, effort: 6 }).toBuffer();
  await sharp(buf).toFile(join(OUT, out));
  const d = await seamMetrics(await sharp(join(OUT, out)).png().toBuffer());
  seamLog.push([out, `${side}×${side}`, d]);
  plateLog.push([out, `${side}×${side}`, statSync(join(OUT, out)).size]);
}

async function frames() {
  const panel = src("frame-panel.png");
  const bg = src("bg-warroom.png");
  const emblem = src("emblem-logo.png");

  // The frame plate is never painted whole — that is what a nine-slice would
  // distort. Its four corner ornaments are cut at the size the HUD paints them,
  // so the scrollwork lands undistorted; the straight runs between the corners
  // are drawn by CSS rules instead, which have no aspect to get wrong.
  {
    const m = await sharp(panel).metadata();
    const side = Math.round(Math.min(m.width, m.height) * 0.21);
    // Each crop is turned toward its own corner: `rowEdge`/`colEdge` say which
    // edges of the source the crop was cut from, which is all the mirroring is.
    const corners = [
      ["tl", "top", "left"], ["tr", "top", "right"],
      ["bl", "bottom", "left"], ["br", "bottom", "right"],
    ];
    for (const [key, rowEdge, colEdge] of corners) {
      const left = colEdge === "left" ? 0 : m.width - side;
      const top = rowEdge === "top" ? 0 : m.height - side;
      // In the crop, "inward" is +x for the left corners and −x for the right
      // ones (same for the rows), which is all any of this mirroring is.
      const inward = (a) => (colEdge === "left" ? a : 1 - a);
      const inwardY = (a) => (rowEdge === "top" ? a : 1 - a);
      const cut = async (u0, u1, v0, v1, out, px, alpha) => {
        const l = Math.round(side * Math.min(inward(u0), inward(u1)));
        const t = Math.round(side * Math.min(inwardY(v0), inwardY(v1)));
        const w = Math.round(side * Math.abs(inward(u1) - inward(u0)));
        const h = Math.round(side * Math.abs(inwardY(v1) - inwardY(v0)));
        let img = sharp(panel).extract({ left: left + l, top: top + t, width: w, height: h })
          .resize({ width: px, height: px });          // square → square: uniform
        if (alpha) {
          const raw = await img.ensureAlpha().raw().toBuffer();
          const buf = Buffer.from(raw);
          const size = px;
          for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
              const dx = colEdge === "left" ? x : size - 1 - x;
              const dy = rowEdge === "top" ? y : size - 1 - y;
              const d = Math.min(Math.min(dx, dy), (dx + dy) / 2.2);
              const k = Math.min(1, Math.max(0, (d - alpha * 0.45) / (alpha * 0.55)));
              const i = (y * size + x) * 4 + 3;
              buf[i] = Math.round(buf[i] * (1 - k * k * (3 - 2 * k)));
            }
          }
          img = sharp(buf, { raw: { width: size, height: size, channels: 4 } });
        }
        const buf = await img.linear(1.14, 2).sharpen({ sigma: 0.4 })
          .webp({ quality: 86, effort: 6 }).toBuffer();
        await sharp(buf).toFile(join(OUT, out));
        plateLog.push([out, `${px}×${px}${alpha ? " α" : ""}`, buf.length]);
      };
      // 1. the chamfer: the iron bevel and the rail ends, masked to the L along
      //    the two edges it hugs, so a tight plate gets the frame's corner
      //    without the ornament ever covering its contents.
      await cut(0, 1, 0, 1, `corner-${key}.webp`, 108, 15);
      // 2. the medallion: the brass block itself — dome, scroll, amber stone —
      //    cut out of the iron border, for the corners of a dialog where there
      //    is a gutter wide enough to hold it.
      await cut(0.16, 0.86, 0.14, 0.84, `boss-${key}.webp`, 88, 0);
    }
  }

  // There is no button bitmap to emit: the iron of a button is DRAWN (see the
  // `--plate-*` layers in styles.css), because a 28px tab and a 340px dialog
  // cannot share one squashed picture of a plate. `frame-plate.png` stays here
  // as the reference that recipe was tuned against, and as the sheet to paint
  // the felt from if the panel material ever needs a new home.

  // the felt of the panels and the board: the frame's own centre field, so a
  // panel and the table under the quarry are the same material. Cut from the
  // middle — the frame's vignette is a low-frequency gradient, and a gradient
  // is exactly what shows up as a line once the tile repeats, so the crop stays
  // inside it and the feather runs wide.
  await writeTile(panel, "felt.webp", { quality: 80, crop: 0.28, feather: 0.55, linear: [1.05, -4] });
  // the haze in the beam (repeats over the whole map), and the manila the
  // ledgers are printed on — the paper's crop skips the sheet's torn edge,
  // which tiled was a white grout line through every feed row
  await writeTile(src("tex-smoke.png"), "smoke.webp", { quality: 78, greyscale: true, feather: 0.45 });
  await writeTile(src("tex-ledger.png"), "ledger.webp", { quality: 78, crop: 0.62, linear: [1, -6], saturation: 0.62 });

  // the war-room, cropped to a square so CSS can `cover` any viewport from one
  // file at one uniform scale; dimmed and edge-darkened in CSS, not here
  await writeWebp(bg, "backdrop.webp", {
    quality: 76,
    resize: { width: 1024, height: 1024, fit: "cover", position: "center" },
  });

  // guild seal: knock the flat black page out to alpha, keep the glow
  {
    const img = sharp(emblem).resize({ width: 256, height: 256, fit: "cover" });
    const { px, info } = await alphaFromLuminance(img.clone());
    const out = await sharp(px, { raw: info }).png().toBuffer();
    await sharp(out).toFile(join(OUT, "emblem.png"));
    plateLog.push(["emblem.png", "256×256", out.length]);
    await sharp(out).resize({ width: 96, height: 96, fit: "inside" }).png().toFile(join(OUT, "emblem-sm.png"));
  }
}

// ── 2. per-action sigils ────────────────────────────────────────────────────
async function sigils() {
  for (const [sheet, spec] of [["icons-build.png", GRID.build], ["icons-sab.png", GRID.sab]]) {
    const p = src(sheet);
    const m = await sharp(p).metadata();
    for (let i = 0; i < spec.keys.length; i++) {
      const rect = cellRect(m.width, m.height, spec.cols, spec.rows, i);
      const buf = await sharp(p).extract(rect)
        .resize({ width: 136, height: 136, fit: "cover" })
        .linear(1.06, -6)      // a touch more punch at 68px
        .sharpen({ sigma: 0.5 })
        .png()
        .toBuffer();
      await sharp(buf).toFile(join(SIGIL, `${spec.keys[i]}.png`));
      plateLog.push([`sigil/${spec.keys[i]}.png`, "136×136", buf.length]);
    }
  }
}

// ── 3. the cargo tokens ─────────────────────────────────────────────────────
async function gems() {
  const p = src("icons-gems.png");
  const m = await sharp(p).metadata();
  const SIZE = 144;
  for (let i = 0; i < GRID.gems.keys.length; i++) {
    const rect = cellRect(m.width, m.height, GRID.gems.cols, GRID.gems.rows, i, 0.02);
    const base = await sharp(p).extract(rect)
      .resize({ width: SIZE, height: SIZE, fit: "cover" })
      .ensureAlpha()
      .raw()
      .toBuffer();
    const alpha = circularAlpha(SIZE, SIZE, 0.492, 0.035);
    const px = Buffer.from(base);
    for (let k = 0; k < px.length; k += 4) px[k + 3] = Math.min(px[k + 3], alpha[k + 3]);
    const out = await sharp(px, { raw: { width: SIZE, height: SIZE, channels: 4 } })
      .linear(1.07, -6).sharpen({ sigma: 0.6 })
      .png().toBuffer();
    await sharp(out).toFile(join(GEMS, `${GRID.gems.keys[i]}.png`));
    plateLog.push([`gems/${GRID.gems.keys[i]}.png`, `${SIZE}×${SIZE}`, out.length]);
  }
}

// ── 3b. seam check (never committed) ────────────────────────────────────────
/** Tile each repeating texture 2×2 at native size and rule the join in red, so
 *  a "seamless" claim is one glance to audit instead of one to trust. */
async function seamCheck() {
  if (!flags.has("--seam-check")) return;
  const out = argv[argv.indexOf("--seam-check") + 1];
  const names = ["felt.webp", "smoke.webp", "ledger.webp"];
  const T = 256;
  const rowH = T + 12;
  const W = T * 2 + 40;
  const H = rowH * names.length;
  const mk = [];
  for (const [i, n] of names.entries()) {
    const f = join(OUT, n);
    if (!existsSync(f)) continue;
    const cell = await sharp(f).resize({ width: T, height: T }).png().toBuffer();
    for (const [x, y] of [[0, 0], [T, 0], [0, T], [T, T]]) {
      mk.push({ input: cell, left: 20 + x, top: i * rowH + y });
    }
    mk.push({
      input: await sharp({ create: { width: 2, height: T * 2, channels: 3, background: "#ff2020" } }).png().toBuffer(),
      left: 20 + T - 1, top: i * rowH,
    });
    mk.push({
      input: await sharp({ create: { width: T * 2, height: 2, channels: 3, background: "#ff2020" } }).png().toBuffer(),
      left: 20, top: i * rowH + T - 1,
    });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#242018" } })
    .composite(mk).png().toFile(out);
  console.log(`NOIR: 2×2 seam check (the red cross is the repeat join) → ${out}`);
}

// ── 4. review sheet (never committed) ───────────────────────────────────────
async function contact() {
  if (!contactPath) return;
  const rows = [];
  const tile = async (file, size = 136) =>
    file && (await sharp(file).resize({ width: size, height: size, fit: "inside", background: "#0a0a0a" }).flatten({ background: "#0a0a0a" }).png().toBuffer());
  const wide = async (file, w = 512, h = 136) =>
    file && (await sharp(file).resize({ width: w, height: h, fit: "inside", background: "#0a0a0a" }).flatten({ background: "#0a0a0a" }).png().toBuffer());

  const groups = [
    ["build", GRID.build, join(OUT, "sigil")],
    ["sab", GRID.sab, join(OUT, "sigil")],
    ["gems", GRID.gems, GEMS],
  ];
  for (const [, spec, dir] of groups) {
    const cells = [];
    for (const k of spec.keys) {
      const f = join(dir, `${k}.png`);
      if (existsSync(f)) cells.push(await tile(f));
    }
    rows.push(cells.filter(Boolean));
  }
  const plates = [];
  for (const f of ["corner-tl.webp", "corner-br.webp", "felt.webp", "backdrop.webp", "smoke.webp", "ledger.webp"]) {
    const p = join(OUT, f);
    if (existsSync(p)) plates.push(await wide(p));
  }
  const lineH = 150;
  const W = 8 * 146 + 20;
  const H = (rows.length + 1) * lineH;
  const mk = [];
  for (const [y, cells] of rows.entries()) {
    for (const [x, buf] of cells.entries()) mk.push({ input: buf, left: 10 + x * 146, top: 10 + y * lineH });
  }
  for (const [x, buf] of plates.entries()) {
    mk.push({ input: buf, left: Math.round(10 + (x * (W - 20)) / plates.length), top: 10 + rows.length * lineH });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: "#141414" } })
    .composite(mk).png().toFile(contactPath);
  console.log(`NOIR: review sheet → ${contactPath}`);
}

const t0 = Date.now();
if (want("frames")) await frames();
if (want("sigils")) await sigils();
if (want("gems")) await gems();
await contact();
await seamCheck();
for (const [name, size, bytes] of plateLog) console.log(`  ${name.padEnd(28)} ${size.padEnd(12)} ${(bytes / 1024).toFixed(1)} KiB`);
if (seamLog.length) {
  // Two views of the same thing. `edgeΔ` is the mean 8-bit step across a repeat
  // boundary — the absolute size of the line a tiling would draw, where ≤3
  // levels is invisible on any material. `edgeΔ/insideΔ` says how much that
  // step stands out from the texture's own grain, which is what the eye
  // actually judges on a busy sheet; a smooth sheet (smoke) can pass the ratio
  // only by being flat everywhere, so both are reported and either passes.
  console.log("NOIR: repeat seams, in 8-bit levels — edge = across a tile boundary, crease = across the fold, inside = the sheet's own grain");
  // The gate is the EDGE — that is the line a repeat draws. The crease is the
  // fold the roll leaves in the middle of the sheet: worth printing because a
  // big one says the texture is structured enough that CSS should `cover` it
  // instead of repeating it (`ledger.webp`), but it never meets a neighbour.
  const bad = [];
  for (const [name, size, d] of seamLog) {
    const ok = d.edge <= 3 || d.ratio <= 1.6;
    if (!ok) bad.push(name);
    console.log(`  ${name.padEnd(22)} ${size.padEnd(10)} edge ${d.edge.toFixed(2).padStart(5)} (×${d.ratio.toFixed(1).padStart(3)})  crease ${d.crease.toFixed(2).padStart(5)} (×${d.creaseRatio.toFixed(1).padStart(3)})  inside ${d.inside.toFixed(2).padStart(5)}${ok ? "" : "   ⚠ VISIBLE SEAM"}`);
  }
  if (bad.length) { console.error(`NOIR: ${bad.join(", ")} would show a line when tiled — raise the feather or shrink the crop`); process.exitCode = 1; }
}
console.log(`NOIR: ${plateLog.length} files in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
