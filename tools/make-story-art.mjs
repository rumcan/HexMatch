#!/usr/bin/env node
/**
 * STORY-01 — derive the campaign art the game loads from the painted masters.
 *
 *   node tools/make-story-art.mjs            # derive everything in tools/story-art.json
 *
 * Masters live in `assets/story-src/` (painted plates, hand-swappable, the same
 * convention as `assets/ui-src/noir/`); everything the game imports lives in
 * `src/assets/story/` as webp:
 *
 *   bg-<key>.webp     a cinematic backdrop, resized to the manifest width
 *   face-<key>.webp   a 2×2 expression sheet, squared to the manifest size
 *                     (TL calm · TR smile · BL mad · BR shock — the quadrant
 *                     arithmetic `src/story/cast.ts` addresses with
 *                     `background-size: 200% 200%` + a two-component position)
 *
 * NO STRETCH, the theme's standing rule, holds here too: backdrops are only
 * ever `cover`ed by the CSS, and a face sheet is only ever shown as one of its
 * four quadrants at a uniform 2× scale — never squashed into a box.
 *
 * A missing master is NOT an error: the run synthesises a clearly-marked
 * placeholder (felt + brass initial for a face, a lamp-graded wash for a
 * backdrop) so the campaign code, the tests and a preview boot all work
 * between art batches, and the console says exactly which plates are still
 * stand-ins. Re-run after painting/replacing a master and the real plate
 * takes its place with no code change.
 */
import { readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const manifest = JSON.parse(await readFile(path.join(here, "story-art.json"), "utf8"));

const SRC = path.join(root, manifest.src);
const OUT = path.join(root, manifest.out);
await mkdir(OUT, { recursive: true });

/** A lamp-graded wash standing in for a backdrop that has not been painted. */
const backdropPlaceholder = (key) => Buffer.from(`<svg width="1600" height="1000">
  <defs>
    <radialGradient id="lamp" cx="50%" cy="18%" r="85%">
      <stop offset="0%" stop-color="#3a2a18"/>
      <stop offset="45%" stop-color="#241a11"/>
      <stop offset="100%" stop-color="#0a0705"/>
    </radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#191310" stop-opacity="0"/>
      <stop offset="100%" stop-color="#060403" stop-opacity=".9"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="1000" fill="url(#lamp)"/>
  <rect y="620" width="1600" height="380" fill="url(#floor)"/>
  <text x="800" y="520" fill="#6b5123" font-family="Georgia, serif" font-size="42"
    letter-spacing="14" text-anchor="middle">${key.toUpperCase()} — PLACEHOLDER</text>
</svg>`);

/** Felt, a brass ring and the character's initial: a face that is not painted. */
const facePlaceholder = (key) => {
  const initial = (key[0] ?? "?").toUpperCase();
  const cell = (x, y, mark) => `<g transform="translate(${x} ${y})">
    <rect width="320" height="320" fill="#17110c"/>
    <rect width="320" height="320" fill="none" stroke="#2c2015" stroke-width="6"/>
    <circle cx="160" cy="150" r="86" fill="#221a12" stroke="#6b5123" stroke-width="4"/>
    <text x="160" y="182" fill="#c9a24a" font-family="Georgia, serif" font-size="96"
      text-anchor="middle">${initial}</text>
    <text x="160" y="286" fill="#6f6047" font-family="Georgia, serif" font-size="26"
      letter-spacing="6" text-anchor="middle">${mark}</text>
  </g>`;
  return Buffer.from(`<svg width="640" height="640">
    <rect width="640" height="640" fill="#0d0906"/>
    ${cell(0, 0, "CALM")}${cell(320, 0, "SMILE")}
    ${cell(0, 320, "MAD")}${cell(320, 320, "SHOCK")}
  </svg>`);
};

const report = [];

for (const bg of manifest.backdrops) {
  const out = path.join(OUT, `bg-${bg.key}.webp`);
  const master = path.join(SRC, bg.master);
  if (existsSync(master)) {
    const info = await sharp(master)
      .resize({ width: bg.width, withoutEnlargement: true })
      .webp({ quality: 82, effort: 5 })
      .toFile(out);
    report.push([`bg-${bg.key}.webp`, `${info.width}×${info.height}`, `${(info.size / 1024) | 0} KB`, "master"]);
  } else {
    const info = await sharp(backdropPlaceholder(bg.key))
      .webp({ quality: 80 })
      .toFile(out);
    report.push([`bg-${bg.key}.webp`, `${info.width}×${info.height}`, `${(info.size / 1024) | 0} KB`, "PLACEHOLDER"]);
  }
}

for (const face of manifest.faces) {
  const out = path.join(OUT, `face-${face.key}.webp`);
  const master = path.join(SRC, face.master);
  if (existsSync(master)) {
    // Square-cover: a sheet that is not exactly square is cropped from the
    // centre, never squeezed — the quadrant arithmetic needs four equal cells.
    const info = await sharp(master)
      .resize({ width: face.size, height: face.size, fit: "cover", position: "centre" })
      .webp({ quality: 86, effort: 5 })
      .toFile(out);
    report.push([`face-${face.key}.webp`, `${info.width}×${info.height}`, `${(info.size / 1024) | 0} KB`, "master"]);
  } else {
    const info = await sharp(facePlaceholder(face.key))
      .webp({ quality: 84 })
      .toFile(out);
    report.push([`face-${face.key}.webp`, `${info.width}×${info.height}`, `${(info.size / 1024) | 0} KB`, "PLACEHOLDER"]);
  }
}

const wide = report.reduce((w, r) => Math.max(w, r[0].length), 0);
for (const [name, dims, size, src] of report) {
  console.log(`${name.padEnd(wide)}  ${dims.padEnd(9)} ${size.padStart(7)}  ${src}`);
}
const missing = report.filter((r) => r[3] === "PLACEHOLDER").length;
console.log(missing
  ? `\n${missing} plate(s) are stand-ins — paint them into ${manifest.src}/ and re-run.`
  : "\nEvery story plate is painted.");
