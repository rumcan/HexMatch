#!/usr/bin/env node
/**
 * TEMP protest art — a placeholder crowd PNG layered over public roads.
 *
 * Usage:
 *   node tools/make-protest-png.mjs
 *
 * Input : this file (an inline SVG crowd — no source art to license).
 * Output: assets/protest.png (96×84, transparent background).
 *
 * The game draws this straight onto the overlay canvas (`paintProtests` in
 * src/iso/game.ts), feet-anchored on the tile diamond's bottom vertex with
 * the time left under it. It deliberately bypasses the atlas (no
 * cells.json surgery for placeholder art): to replace the crowd, drop a new
 * transparent PNG over assets/protest.png and keep the 96×84 box (or update
 * PROTEST_PNG_W/H next to the painter).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "assets/protest.png");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="84" viewBox="0 0 96 84">
  <!-- ground shadow: the crowd's feet sit on the road -->
  <ellipse cx="48" cy="76" rx="34" ry="7" fill="#000000" opacity="0.25"/>

  <!-- sign sticks (behind the placards, in front of the bodies) -->
  <line x1="17" y1="38" x2="16" y2="56" stroke="#7a5c3a" stroke-width="2"/>
  <line x1="48" y1="20" x2="48" y2="50" stroke="#7a5c3a" stroke-width="2"/>
  <line x1="79" y1="40" x2="80" y2="58" stroke="#7a5c3a" stroke-width="2"/>

  <!-- back row (smaller, higher) -->
  <rect x="27" y="46" width="10" height="16" rx="3" fill="#3d7bd9"/>
  <circle cx="32" cy="41" r="5" fill="#d9a066"/>
  <rect x="59" y="46" width="10" height="16" rx="3" fill="#3da655"/>
  <circle cx="64" cy="41" r="5" fill="#8c5a2b"/>

  <!-- front row -->
  <rect x="11" y="54" width="10" height="18" rx="3" fill="#d94f3d"/>
  <circle cx="16" cy="49" r="5.5" fill="#f2c89b"/>
  <rect x="43" y="54" width="10" height="18" rx="3" fill="#e0a32e"/>
  <circle cx="48" cy="49" r="5.5" fill="#e8b58a"/>
  <rect x="75" y="54" width="10" height="18" rx="3" fill="#8a4fd9"/>
  <circle cx="80" cy="49" r="5.5" fill="#c98d5f"/>

  <!-- placards -->
  <rect x="4" y="22" width="26" height="15" rx="1.5" fill="#f5f0e1" stroke="#333333" stroke-width="1.5"/>
  <text x="17" y="33.5" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="10" fill="#222222">NO!</text>
  <rect x="34" y="4" width="28" height="15" rx="1.5" fill="#f5f0e1" stroke="#333333" stroke-width="1.5"/>
  <text x="48" y="15.5" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="10" fill="#222222">STOP</text>
  <rect x="66" y="24" width="26" height="15" rx="1.5" fill="#f5f0e1" stroke="#333333" stroke-width="1.5"/>
  <text x="79" y="35.5" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="10" fill="#222222">NO!</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${png.length} bytes)`);
