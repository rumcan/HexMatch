#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// ENDING ART — the win/lose backdrops.
//
// Two full-screen photographs behind the final ledger. They are the largest
// single images in the game, and they are shown exactly twice per match, so
// they are worth being strict about: WebP, and no larger than any display
// will actually use them at.
//
// Kept as their own step rather than folded into make-ui-art.mjs because that
// tool generates the noir chrome, and these are supplied artwork.
//
// Usage: node tools/make-ending-art.mjs   (or: npm run ending-art)
//   Reads  assets/ui-src/game_{won,lost}.png
//   Writes src/assets/ui/ending/{won,lost}.webp
// ══════════════════════════════════════════════════════════════════════════
import sharp from "sharp";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(root, "assets", "ui-src");
const OUT = join(root, "src", "assets", "ui", "ending");

/**
 * Widest the backdrop is ever sampled at. It sits behind a 760px card under
 * gradients and a saturation filter, so detail past this is spent on nothing.
 */
const MAX_W = 1600;

const FILES = [["game_won", "won"], ["game_lost", "lost"]];

mkdirSync(OUT, { recursive: true });

let failed = false;
for (const [from, to] of FILES) {
  const src = join(SRC, `${from}.png`);
  if (!existsSync(src)) {
    console.error(`missing assets/ui-src/${from}.png`);
    failed = true;
    continue;
  }
  const meta = await sharp(src).metadata();
  const file = join(OUT, `${to}.webp`);
  await sharp(src)
    .resize({ width: Math.min(MAX_W, meta.width ?? MAX_W), withoutEnlargement: true })
    .webp({ quality: 78, effort: 6 })
    .toFile(file);
  console.log(`${from}.png ${meta.width}x${meta.height}`
    + ` (${(statSync(src).size / 1024).toFixed(0)} kB)`
    + ` -> ending/${to}.webp ${(statSync(file).size / 1024).toFixed(0)} kB`);
}
if (failed) process.exit(1);
