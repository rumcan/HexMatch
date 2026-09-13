#!/usr/bin/env node
/**
 * RANK-01 — derive the multiplayer rank badges from ONE painted master.
 *
 *   node tools/make-rank-badges.mjs              # all tiers → src/assets/ui/rank
 *   node tools/make-rank-badges.mjs --contact /tmp/rank.png   # review sheet
 *
 * Master: `assets/ui-src/rank/medallion-master.png` — a painted iron-and-brass
 * campaign medallion with a BLANK centre disc, on a dark painted ground. It is
 * the hand-swappable source: replace it with a re-painted plate of the same
 * shape and every badge below is regenerated to match.
 *
 * Why one master and not seven paintings: six separate paintings of the same
 * medal drift (different rims, different lighting, different crop), and the
 * ladder is exactly the place where the tiers must read as ONE family at a
 * glance. So the family is derived from a single plate:
 *
 *   knock  — the painted background becomes alpha (`blackKnock`), so a badge
 *            is a cut-out and drops onto any panel of the theme;
 *   tint   — each tier is the SAME luminance re-metalised (bronze, silver,
 *            brass, platinum, steel, crimson iron). Metal IS luminance in this
 *            theme, so one tint per tier is the whole difference;
 *   pip    — the tier's mark is drawn as geometry in the blank disc (1–6
 *            riveted stars), vector, at exactly the px the CSS paints it, so
 *            no badge ever carries a stretched or resampled glyph.
 *
 * `unranked` is the master's own iron with no pips: the badge for a player who
 * has not finished a ranked match yet. It is a state, not a tier — see
 * `src/net/rating.ts`.
 *
 * Output (committed): `src/assets/ui/rank/<key>.png`, 96×96, transparent.
 */
import { mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "assets/ui-src/rank");
const MASTER = join(SRC, "medallion-master.png");
const OUT = join(ROOT, "src/assets/ui/rank");
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));

/** Painted at 96px so the CSS never scales a raster UP (see tools/README-art.md). */
const SIZE = 96;

/**
 * The medal's crop inside the 1024² master, measured once from the plate: the
 * octagon without its ribbon hanger (the hanger is a different silhouette and
 * would push the badge off-centre in a square frame). Numbers are fractions so
 * a re-painted master at another resolution still crops the same.
 */
const CROP = { left: 0.176, top: 0.246, width: 0.636, height: 0.636 };

/**
 * The tier table, in ladder order. `tint` is the metal; `pips` the mark count;
 * `pip` the mark's own metal (the contrast that keeps a dark tint legible).
 * Kept in step with `RANK_TIERS` in `src/net/rating.ts` by
 * `tests/unit/net-rank.test.ts`.
 */
const TIERS = [
  { key: "unranked", label: "Unranked", tint: [92, 86, 78], pips: 0, pip: "#8d8578", dim: true },
  { key: "bronze", label: "Bronze", tint: [176, 116, 62], pips: 1, pip: "#ffdcae" },
  { key: "silver", label: "Silver", tint: [178, 190, 200], pips: 2, pip: "#f4f8fb" },
  { key: "gold", label: "Gold", tint: [212, 168, 78], pips: 3, pip: "#fff3c9" },
  { key: "platinum", label: "Platinum", tint: [206, 224, 226], pips: 4, pip: "#ffffff" },
  { key: "diamond", label: "Diamond", tint: [138, 196, 236], pips: 5, pip: "#eaf7ff" },
  { key: "master", label: "Master", tint: [188, 78, 62], pips: 6, pip: "#ffd98a" },
];

// ── shared image helpers (mirrors tools/make-noir-art.mjs) ────────────────

/**
 * The painted ground is near-black; a badge must be a cut-out. Alpha ramps
 * between two luminance stops so the medal's own shadowed rim stays solid
 * while the plate around it goes fully transparent. Pixels keep their colour
 * and only gain alpha, which is what makes the result a drop-in for any panel.
 */
function blackKnock(rgba, w, h, { lo = 26, hi = 74 } = {}) {
  const px = Buffer.from(rgba);
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    const t = lum <= lo ? 0 : lum >= hi ? 1 : (lum - lo) / (hi - lo);
    px[i + 3] = Math.round(255 * t * t * (3 - 2 * t)); // smoothstep
  }
  return px;
}

/** One mark: a five-pointed riveted star, drawn as SVG at the badge's scale. */
function starSvg(px, fill, stroke) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? px / 2 : px / 4.6;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(px / 2 + r * Math.cos(a)).toFixed(2)},${(px / 2 + r * Math.sin(a)).toFixed(2)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}" stroke="${stroke}" stroke-width="${(px / 12).toFixed(2)}" stroke-linejoin="round" />`;
}

/**
 * The marks live in the medal's blank disc. The disc is a fixed fraction of the
 * cropped square (measured from the plate), so the layout is expressed in
 * fractions of the badge and survives a re-paint of the same composition.
 */
function pipLayer(n, pip) {
  if (n <= 0) return null;
  const disc = { cx: SIZE * 0.5, cy: SIZE * 0.545, r: SIZE * 0.2 };
  // The marks shrink as they multiply: six full-size stars would ride over the
  // rim, and the disc is the one part of the badge that must stay readable at
  // the 28px the lobby prints it.
  const star = SIZE * (n <= 3 ? 0.19 : n <= 4 ? 0.18 : 0.158);
  const gap = star * (n <= 3 ? 1.06 : 1.14);
  const cols = n <= 3 ? n : Math.ceil(n / 2);
  const rows = n <= 3 ? 1 : 2;
  const per = Math.ceil(n / rows);
  const items = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / per);
    const col = i % per;
    const inRow = Math.min(per, n - row * per);
    const x = disc.cx + (col - (inRow - 1) / 2) * gap;
    const y = disc.cy + (row - (rows - 1) / 2) * gap;
    items.push(
      `<g transform="translate(${(x - star / 2).toFixed(2)} ${(y - star / 2).toFixed(2)})">${starSvg(star, pip, "rgba(20,14,8,.55)")}</g>`,
    );
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">${items.join("")}</svg>`,
  );
}

const log = [];

async function badges() {
  if (!existsSync(MASTER)) {
    console.error(`missing painted master: ${MASTER}`);
    process.exit(1);
  }
  const meta = await sharp(MASTER).metadata();
  const crop = {
    left: Math.round(CROP.left * meta.width),
    top: Math.round(CROP.top * meta.height),
    width: Math.round(CROP.width * meta.width),
    height: Math.round(CROP.height * meta.height),
  };
  // One decode of the medal: knocked out, then trimmed to the metal so every
  // tier shares the exact same silhouette and the exact same framing.
  const cut = await sharp(MASTER)
    .extract(crop)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const knocked = blackKnock(cut.data, cut.info.width, cut.info.height);
  const trimmed = await sharp(knocked, {
    raw: { width: cut.info.width, height: cut.info.height, channels: 4 },
  })
    .trim({ threshold: 1 })
    .resize({ width: SIZE - 4, height: SIZE - 4, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  for (const tier of TIERS) {
    let img = sharp(trimmed);
    if (tier.tint) {
      // `tint` colourises by luminance — the medal's own highlights survive,
      // which is what keeps six metals reading as one painted family.
      img = img.tint({ r: tier.tint[0], g: tier.tint[1], b: tier.tint[2] });
    }
    if (tier.dim) img = img.modulate({ brightness: 0.82, saturation: 0.5 });
    const pips = pipLayer(tier.pips, tier.pip);
    // The plate has a 2px transparent margin on every side: layout the badge on
    // a canvas larger than the art so a hover glow or ring never clips.
    const file = join(OUT, `${tier.key}.png`);
    let out = sharp({
      create: {
        width: SIZE,
        height: SIZE,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{ input: await img.toBuffer(), left: 2, top: 2, blend: "over" }]);
    if (pips) out = sharp(await out.png().toBuffer()).composite([{ input: pips, left: 0, top: 0 }]);
    await out.png({ compressionLevel: 9 }).toFile(file);
    const written = await sharp(file).metadata();
    log.push([`${tier.key}.png`, `${written.width}×${written.height}`, statSync(file).size]);
  }
}

/**
 * Review sheet (never committed): every badge at 1× and at the size the lobby
 * prints it, on the panel colour the theme actually uses — a tint that reads
 * only on white is a bug this catches before a screenshot does.
 */
async function contact(path) {
  const cell = 120;
  const w = cell * TIERS.length;
  const mk = [
    {
      input: {
        create: { width: w, height: cell * 2, channels: 4, background: { r: 25, g: 22, b: 19, alpha: 1 } },
      },
      left: 0,
      top: 0,
    },
  ];
  for (const [i, tier] of TIERS.entries()) {
    const file = join(OUT, `${tier.key}.png`);
    if (!existsSync(file)) continue;
    mk.push({ input: await sharp(file).resize(SIZE).png().toBuffer(), left: i * cell + 12, top: 12 });
    mk.push({ input: await sharp(file).resize(48).png().toBuffer(), left: i * cell + 36, top: 140 });
  }
  await sharp({
    create: { width: w, height: cell * 2, channels: 4, background: { r: 25, g: 22, b: 19, alpha: 1 } },
  })
    .composite(mk)
    .png()
    .toFile(path);
  console.log(`contact sheet → ${path}`);
}

if (flags.has("--contact")) {
  await badges();
  await contact(argv[argv.indexOf("--contact") + 1]);
} else {
  await badges();
  console.log("rank badges → src/assets/ui/rank");
  for (const [name, dims, bytes] of log) {
    console.log(`  ${name.padEnd(16)} ${dims.padEnd(9)} ${(bytes / 1024).toFixed(1)} KiB`);
  }
}
