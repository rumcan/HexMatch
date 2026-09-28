#!/usr/bin/env node
// PLAY-FIX-1: remove the low-coverage magenta-key matte from authored
// vehicle sources BEFORE resampling. PNG stores straight alpha; the browser
// premultiplies at decode. Leave real body/shadow coverage above the matte.
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
export function cleanVehicleAlpha(data) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 64) data.fill(0, i, i + 4);
  }
  return data;
}
import { isCli } from './is-cli.mjs';
if (isCli(import.meta.url)) {
  for (const dir of ['assets/vehicles-src', 'src/assets/sprites/png/vehicles/ttd', 'src/assets/sprites/png/vehicles/ttd/cars']) {
    for (const name of readdirSync(dir).filter(n => n.endsWith('.png'))) {
      const path = `${dir}/${name}`;
      const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const png = await sharp(cleanVehicleAlpha(data), { raw: info }).png().toBuffer();
      await sharp(png).toFile(path);
    }
  }
}
