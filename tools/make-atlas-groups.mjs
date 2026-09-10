#!/usr/bin/env node
/**
 * Grouped atlas editing sheets — splits the single large iso atlas into
 * smaller labelled PNGs that fit an image-generating UI.
 *
 * Usage:
 *   node tools/make-atlas-groups.mjs [--zoom 2] [--out assets/iso-atlas/groups]
 *
 * Input : assets/iso-atlas/manifest.json + assets/iso-atlas/atlas@<z>x.png
 * Output: <out>/<group>[@-pN]@<z>x.png  (every sheet <= 1920x1080)
 *         <out>/groups@<z>x.json         (index + per-sprite art rects)
 *
 * Each sprite is cropped verbatim from the packed atlas (the exact pixels
 * the game draws) and placed on a white card over a transparency checker,
 * with its manifest sprite name — the variable/key the game uses — rendered
 * as text underneath it. Groups are logical (terrain, industries, town,
 * roads, …) and paginate automatically when a group overflows 1920x1080.
 *
 * The sheets are EDITING MASTERS / visual reference, not game art: the game
 * keeps loading atlas@1x/@2x/@0.5x.png + manifest.json unchanged. Run with
 * `npm run slice-atlas` (chained) or standalone via `npm run atlas:groups`.
 * tests/unit/iso-atlas-groups.test.ts pins the size + coverage invariants.
 *
 * groups@<z>x.json records each sprite's art rect (sheet pixels of the
 * sprite itself, card/label excluded) so a future tool can slice sprites
 * back out of an edited sheet.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS_DIR = join(ROOT, "assets/iso-atlas");

// ── CLI ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.findIndex((a) => a === name || a.startsWith(name + "="));
  if (i === -1) return def;
  const a = args[i];
  if (a.includes("=")) return a.slice(name.length + 1);
  return args[i + 1] ?? def;
}
const ZOOM = Number(flag("--zoom", "2"));
const OUT = join(ROOT, flag("--out", "assets/iso-atlas/groups"));
const MAX_W = 1920;
const MAX_H = 1080;
if (![0.5, 1, 2].includes(ZOOM)) throw new Error(`--zoom must be 0.5, 1 or 2 (got ${ZOOM})`);

// ── Layout constants (sheet pixels) ──────────────────────────────────────
const MARGIN = 24;        // left / right / bottom page margin
const TOP_H = 88;         // header bar height
const CONTENT_TOP = TOP_H + 16;
const GAP = 14;           // gap between cards
const PAD = 12;           // card padding around the sprite
const SPR_LABEL_GAP = 8;  // sprite bottom -> label box top
const LABEL_H = 26;       // label line box height
const LABEL_FONT = 17;    // px, DejaVu Sans Mono
const LABEL_CHAR_W = 10.5;// advance estimate at LABEL_FONT (mono 0.602em + slack)
const TITLE_FONT = 22;
const SUB_FONT = 14;

// ── Logical groups (first match wins; every sprite must match exactly one) ─
const GROUPS = [
  { id: "01-terrain-ui", title: "Terrain + placement markers",
    match: (n) => n.startsWith("terrain_") || n.startsWith("highlight") || n === "node_mark" },
  { id: "02-farm-forest-ore-oil", title: "Industries: farm, forest, ore mine, oil rig",
    match: (n) => /^(farm|forest|ore_mine|oil_rig)(_|$)/.test(n) },
  { id: "03-gold-quarry", title: "Industries: gold mine, quarry",
    match: (n) => /^(gold_mine|quarry)(_|$)/.test(n) },
  { id: "04-factories-depots", title: "Factories + depots",
    match: (n) => /^(factory|depot)(_|$)/.test(n) },
  { id: "05-town", title: "Town buildings",
    match: (n) => n.startsWith("town_") },
  { id: "06-roads-dirt", title: "Roads + dirt tracks",
    match: (n) => n.startsWith("road_") || (n.startsWith("dirt_") && !n.startsWith("dirt_road_")) },
  { id: "07-dirt-road-blends", title: "Dirt/road transition blends",
    match: (n) => n.startsWith("dirt_road_") },
  { id: "08-spare-trucks", title: "Spare art + road vehicles",
    match: (n) => n.startsWith("spare_") || n.startsWith("truck_") },
];

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Label text under a sprite: the manifest key, plus frame count when animated. */
function labelOf(name, def) {
  return def.frames && def.frames > 1 ? `${name}  [x${def.frames}]` : name;
}

async function run() {
  const manifest = JSON.parse(readFileSync(join(ATLAS_DIR, "manifest.json"), "utf8"));
  const atlasFile = manifest.images[String(ZOOM)];
  if (!atlasFile) throw new Error(`manifest has no image for zoom ${ZOOM}`);
  const atlasPath = join(ATLAS_DIR, atlasFile);
  const atlasMeta = await sharp(atlasPath).metadata();
  const sprites = manifest.sprites;
  const names = Object.keys(sprites).sort();

  // ── Assign every sprite to exactly one group ──
  const buckets = GROUPS.map((g) => ({ ...g, names: [] }));
  const unmatched = [];
  for (const n of names) {
    const hits = buckets.filter((g) => g.match(n));
    if (hits.length === 0) unmatched.push(n);
    else {
      if (hits.length > 1) throw new Error(`sprite ${n} matches groups ${hits.map((h) => h.id).join(", ")}`);
      hits[0].names.push(n);
    }
  }
  if (unmatched.length) throw new Error(`sprites match no group: ${unmatched.join(", ")}`);

  mkdirSync(OUT, { recursive: true });
  // Drop stale outputs of previous runs (page counts shift as sprites change).
  for (const f of readdirSync(OUT)) {
    if (/^(\d\d-.*|groups@.*)\.(png|json)$/.test(f)) rmSync(join(OUT, f));
  }

  // ── Crop each sprite verbatim from the packed atlas ──
  // Rects use the game's own zoom rule (Atlas.zoomRect): round after scaling.
  const crops = new Map(); // name -> { buf, w, h }
  for (const n of names) {
    const s = sprites[n];
    const left = Math.round(s.x * ZOOM), top = Math.round(s.y * ZOOM);
    const w = Math.round(s.w * ZOOM), h = Math.round(s.h * ZOOM);
    if (left < 0 || top < 0 || left + w > atlasMeta.width || top + h > atlasMeta.height) {
      throw new Error(`sprite ${n} rect ${w}x${h}@${left},${top} exceeds ${atlasFile} ${atlasMeta.width}x${atlasMeta.height}`);
    }
    const buf = await sharp(atlasPath).extract({ left, top, width: w, height: h }).png().toBuffer();
    crops.set(n, { buf, w, h });
  }

  // ── Lay out + render each group (auto-paginate at 1920x1080) ──
  const outGroups = [];
  const totalGroups = buckets.filter((b) => b.names.length).length;
  let groupNo = 0;
  for (const b of buckets) {
    if (!b.names.length) continue;
    groupNo++;

    // Card geometry per sprite.
    const cards = b.names.map((n) => {
      const c = crops.get(n);
      const label = labelOf(n, sprites[n]);
      const contentW = Math.max(c.w, Math.ceil(label.length * LABEL_CHAR_W) + 8);
      return {
        name: n, label, w: c.w, h: c.h,
        contentW,
        cardW: contentW + PAD * 2,
        cardH: c.h + SPR_LABEL_GAP + LABEL_H + PAD * 2,
      };
    });
    for (const c of cards) {
      if (c.cardW > MAX_W - MARGIN * 2 || c.cardH > MAX_H - CONTENT_TOP - MARGIN) {
        throw new Error(
          `sprite ${c.name} card ${c.cardW}x${c.cardH} cannot fit ${MAX_W}x${MAX_H} at zoom ${ZOOM} — regenerate with a smaller --zoom`,
        );
      }
    }

    // Row-pack into pages.
    const pages = [];
    let items = [], x = MARGIN, y = CONTENT_TOP, rowH = 0, rowRight = MARGIN, maxRight = MARGIN;
    const newRow = () => { x = MARGIN; y += rowH + GAP; rowH = 0; };
    const newPage = () => {
      pages.push({ items, bottom: y + rowH, maxRight });
      items = []; x = MARGIN; y = CONTENT_TOP; rowH = 0; maxRight = MARGIN;
    };
    for (const c of cards) {
      if (x + c.cardW > MAX_W - MARGIN && x > MARGIN) newRow();
      if (y + c.cardH > MAX_H - MARGIN && items.length) { newPage(); }
      if (x + c.cardW > MAX_W - MARGIN && x > MARGIN) newRow(); // after page break
      items.push({ ...c, cardX: x, cardY: y });
      x += c.cardW + GAP;
      rowH = Math.max(rowH, c.cardH);
      rowRight = x - GAP;
      maxRight = Math.max(maxRight, rowRight);
    }
    pages.push({ items, bottom: y + rowH, maxRight });

    // Render pages.
    const files = [];
    for (let pi = 0; pi < pages.length; pi++) {
      const page = pages[pi];
      const pageW = page.maxRight + MARGIN;
      const pageH = page.bottom + MARGIN;
      if (pageW > MAX_W || pageH > MAX_H) {
        throw new Error(`group ${b.id} page ${pi + 1} laid out at ${pageW}x${pageH}, exceeds ${MAX_W}x${MAX_H}`);
      }
      const file = pages.length === 1 ? `${b.id}@${ZOOM}x.png` : `${b.id}-p${pi + 1}@${ZOOM}x.png`;
      const title = pages.length === 1
        ? `Atlas group ${String(groupNo).padStart(2, "0")}/${String(totalGroups).padStart(2, "0")}: ${b.title}`
        : `Atlas group ${String(groupNo).padStart(2, "0")}/${String(totalGroups).padStart(2, "0")}: ${b.title} (page ${pi + 1} of ${pages.length})`;
      const sub = `${b.names.length} sprites in group - art at @${ZOOM}x scale - label under each sprite = manifest sprite name`;

      let svg = `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`
        + `<rect x="0" y="0" width="${pageW}" height="${TOP_H}" fill="#1c242e"/>`
        + `<text x="${MARGIN}" y="40" font-family="'DejaVu Sans', sans-serif" font-weight="bold" font-size="${TITLE_FONT}" fill="#eef2f7">${esc(title)}</text>`
        + `<text x="${MARGIN}" y="65" font-family="'DejaVu Sans', sans-serif" font-size="${SUB_FONT}" fill="#9fb0c2">${esc(sub)}</text>`
        + `<text x="${pageW - MARGIN}" y="44" font-family="'DejaVu Sans Mono', monospace" font-weight="bold" font-size="20" text-anchor="end" fill="#5b6b7d">@${ZOOM}x</text>`
        + `</svg>`;
      const layers = [{ input: Buffer.from(svg), top: 0, left: 0 }];
      // Cards + labels accumulate into a second SVG pass so text sits above card fills.
      let cardsSvg = `<svg width="${pageW}" height="${pageH}" xmlns="http://www.w3.org/2000/svg">`
        + `<defs><pattern id="chk" width="12" height="12" patternUnits="userSpaceOnUse">`
        + `<rect width="12" height="12" fill="#ffffff"/>`
        + `<rect width="6" height="6" fill="#e4e2db"/><rect x="6" y="6" width="6" height="6" fill="#e4e2db"/>`
        + `</pattern></defs>`;
      const placements = [];
      for (const it of page.items) {
        const checkerX = it.cardX + PAD;
        const checkerY = it.cardY + PAD;
        const artX = Math.round(checkerX + (it.contentW - it.w) / 2);
        const artY = checkerY;
        const labelCX = checkerX + it.contentW / 2;
        const labelY = checkerY + it.h + SPR_LABEL_GAP + 19;
        cardsSvg += `<rect x="${it.cardX}" y="${it.cardY}" width="${it.cardW}" height="${it.cardH}" rx="8" fill="#ffffff" stroke="#c9c5b8" stroke-width="1"/>`
          + `<rect x="${checkerX}" y="${checkerY}" width="${it.contentW}" height="${it.h}" fill="url(#chk)"/>`
          + `<text x="${labelCX}" y="${labelY}" font-family="'DejaVu Sans Mono', monospace" font-size="${LABEL_FONT}" text-anchor="middle" fill="#222222">${esc(it.label)}</text>`;
        layers.push({ input: crops.get(it.name).buf, top: artY, left: artX });
        placements.push({ name: it.name, x: artX, y: artY, w: it.w, h: it.h });
      }
      cardsSvg += `</svg>`;
      layers.splice(1, 0, { input: Buffer.from(cardsSvg), top: 0, left: 0 });

      const base = sharp({
        create: { width: pageW, height: pageH, channels: 4, background: { r: 0xe9, g: 0xe7, b: 0xe0, alpha: 255 } },
      });
      await base.composite(layers).png().toFile(join(OUT, file));
      files.push({ file, width: pageW, height: pageH, sprites: placements });
      console.log(`${file} ${pageW}x${pageH} (${page.items.length} sprites)`);
    }
    outGroups.push({ id: b.id, title: b.title, pages: files });
  }

  const index = {
    generatedBy: "tools/make-atlas-groups.mjs",
    zoom: ZOOM,
    maxSize: [MAX_W, MAX_H],
    source: { manifest: "../manifest.json", atlas: `../${atlasFile}` },
    note: "Label under each sprite is its manifest sprite name (the variable/key the game uses). Sprite x/y/w/h are sheet pixels of the art itself (card/label excluded) for re-extraction.",
    groups: outGroups,
  };
  const indexFile = `groups@${ZOOM}x.json`;
  writeFileSync(join(OUT, indexFile), JSON.stringify(index, null, 2) + "\n");
  const nFiles = outGroups.reduce((a, g) => a + g.pages.length, 0);
  console.log(`${indexFile}: ${names.length} sprites in ${outGroups.length} groups, ${nFiles} sheets (all <= ${MAX_W}x${MAX_H})`);
}

run().catch((e) => { console.error(e); process.exit(1); });
