#!/usr/bin/env node
/**
 * MATCH-2 (#566): compile the painted cargo icons into the board's gem sprites.
 *
 *   node tools/make-gem-sprites.mjs
 *
 * Reads the square masters in assets/gems-src/v3/<cargo>@2x.png (sliced from
 * the owner's sheet, assets/gems-src/v3/sheet.png, transparent background)
 * and writes, per cargo:
 *   src/assets/gems/<cargo>.png     128×128 — the HUD, the battle screen, the tour
 *   src/assets/gems/<cargo>@2x.png  256×256 — the board canvas on a dense screen
 * The icon keeps its own shape (no clip): its longest side fills 90% of the
 * canvas, centred, so every cargo carries one visual weight.
 */
import sharp from "sharp";
import { existsSync } from "node:fs";

const CARGOS = ["grain", "wood", "ore", "stone", "oil", "gold"];
for (const cargo of CARGOS) {
  const src = `assets/gems-src/v3/${cargo}@2x.png`;
  if (!existsSync(src)) throw new Error(`missing master ${src}`);
  const trimmed = await sharp(src).trim({ threshold: 1 }).toBuffer();
  for (const [size, file] of [[128, `src/assets/gems/${cargo}.png`], [256, `src/assets/gems/${cargo}@2x.png`]]) {
    const inner = Math.round(size * 0.9);
    const icon = await sharp(trimmed).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "lanczos3" }).toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: icon, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toFile(file);
  }
  console.log(`${cargo}: 128 + 256`);
}
