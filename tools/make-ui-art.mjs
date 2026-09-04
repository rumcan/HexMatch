#!/usr/bin/env node
/**
 * V5 — regenerate the match-3 gem sprites and the button banner art.
 *
 *   node tools/make-ui-art.mjs
 *
 * Output (committed to the repo, swapped freely by hand-authored art of the
 * same names):
 *   src/assets/gems/<cargo>.png   48×48 pixel-art gem, one per cargo
 *                                 (grain wood ore stone oil gold) — ui.ts maps
 *                                 the six gem colours onto these through
 *                                 GEM_TO_CARGO, the bijection quarry.ts uses.
 *   src/assets/ui/<button>.png    320×72 banner plates for the BUILD / BLACK
 *                                 MARKET / tab buttons (styles.css).
 *
 * The gems are drawn as a 16×16 pixel matrix (brilliant-cut facets, top-left
 * key light, specular blob, dark outline) and scaled ×3 with nearest
 * neighbour, so they stay crisp pixel art at the board's 48px cells. Colours
 * come from CARGO in src/iso/config.ts so a gem always matches its chip.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GEMS = join(ROOT, "src/assets/gems");
const UI = join(ROOT, "src/assets/ui");
mkdirSync(GEMS, { recursive: true });
mkdirSync(UI, { recursive: true });

// cargo palette (mirrors CARGO in src/iso/config.ts — keep in sync)
const CARGO = {
  grain: { c1: "#b89400", c2: "#ffe83a" },
  wood:  { c1: "#6b3410", c2: "#c47a2c" },
  ore:   { c1: "#284a9c", c2: "#5aa8ff" },
  stone: { c1: "#7c8794", c2: "#c7d0da" },
  oil:   { c1: "#1c1e20", c2: "#6d747c" },
  gold:  { c1: "#9c5a02", c2: "#ffb01f" },
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** 16×16 brilliant-cut gem, returned as an RGBA buffer at 48×48 (×3 nearest). */
function gemPixels(c1h, c2h) {
  const c1 = hex(c1h), c2 = hex(c2h);
  const dark = mix(c1, [0, 0, 0], 0.55);
  const white = [255, 255, 255];
  const N = 16;
  const inside = (x, y) => {
    const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
    return dx <= 6.5 && dy <= 6.5 && dx + dy <= 9.5;
  };
  const px = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      if (!inside(x, y)) continue;
      const outline = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      let col;
      if (outline) {
        col = dark;
      } else {
        // key light top-left, facet cuts on both diagonals
        const t = (x + y) / 30;
        let v = clamp(1.02 - t * 0.85);
        if (((x - y + 16) % 5) === 0) v = clamp(v + 0.10);
        if (((x + y) % 6) === 0) v = clamp(v - 0.09);
        col = mix(c1, c2, clamp(Math.pow(v, 0.9)));
        // rim light just inside the top-left edge
        if (inside(x - 1, y - 1) === false || (!inside(x - 1, y) || !inside(x, y - 1))) col = mix(col, white, 0.35);
        // specular blob
        if (x + y < 11 && x >= 3 && y >= 2) col = mix(col, white, 0.75);
      }
      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = 255;
    }
  }
  return px;
}

async function writeGem(cargo) {
  const { c1, c2 } = CARGO[cargo];
  const px = gemPixels(c1, c2);
  await sharp(Buffer.from(px), { raw: { width: 16, height: 16, channels: 4 } })
    .resize(48, 48, { kernel: "nearest" })
    .png()
    .toFile(join(GEMS, `${cargo}.png`));
}

/** 320×72 industrial banner plate with an accent-coloured hazard band. */
function bannerSvg(accent) {
  return `<svg width="320" height="72" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#202a35"/>
      <stop offset="0.5" stop-color="#141c25"/>
      <stop offset="1" stop-color="#0a1016"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#000" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#000" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.15"/>
    </linearGradient>
    <pattern id="hazard" width="14" height="14" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
      <rect width="14" height="14" fill="none"/>
      <rect width="7" height="14" fill="${accent}" opacity="0.34"/>
    </pattern>
    <radialGradient id="glow" cx="0.78" cy="0.5" r="0.6">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="320" height="72" fill="url(#plate)"/>
  <rect x="150" width="170" height="72" fill="url(#hazard)"/>
  <rect width="320" height="72" fill="url(#glow)"/>
  <rect width="320" height="72" fill="url(#fade)"/>
  <rect width="320" height="1" y="0" fill="#ffffff" opacity="0.10"/>
  <rect width="320" height="1" y="71" fill="#000000" opacity="0.55"/>
  <rect x="0.5" y="0.5" width="319" height="71" fill="none" stroke="${accent}" stroke-opacity="0.35"/>
  <g fill="#2b3641" stroke="#080d12">
    <circle cx="9" cy="9" r="2.5"/><circle cx="311" cy="9" r="2.5"/>
    <circle cx="9" cy="63" r="2.5"/><circle cx="311" cy="63" r="2.5"/>
  </g>
</svg>`;
}

const BUTTONS = {
  "build-road": "#9aa5b0",
  "build-rail": "#3f7fe0",
  "build-harvester": "#4ecb3e",
  "build-demolish": "#e0483a",
  "build-quarry": "#f5da28",
  "build-market": "#f5921f",
  "sab-bandit": "#e0483a",
  "sab-harden": "#78c8eb",
  "sab-block": "#9aa5b0",
  "sab-fog": "#93a68f",
  "sab-security": "#4aa8e0",
  "sab-repair": "#3ecf8e",
  "tab": "#33404d",
};

async function main() {
  for (const cargo of Object.keys(CARGO)) await writeGem(cargo);
  for (const [name, accent] of Object.entries(BUTTONS)) {
    await sharp(Buffer.from(bannerSvg(accent))).png().toFile(join(UI, `${name}.png`));
  }
  console.log(`wrote ${Object.keys(CARGO).length} gems → src/assets/gems, ${Object.keys(BUTTONS).length} banners → src/assets/ui`);
}

main().catch((e) => { console.error(e); process.exit(1); });
