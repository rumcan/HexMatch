// QC montage: composite placed masters (assets/buildings-src/<name>@2x.png) into a
// 5-column grid on #1E2A36 for quick visual review.
// usage: node tools/qc-montage.mjs <out.png> <name1> [name2 ...]
import sharp from 'sharp';
import { existsSync } from 'node:fs';
const [out, ...names] = process.argv.slice(2);
if (!out || names.length === 0) { console.error('usage: qc-montage <out.png> <name>...'); process.exit(1); }
const CELL = 256, COLS = 5, BG = { r: 30, g: 42, b: 54 };
const comps = [];
for (let i = 0; i < names.length; i++) {
  const n = names[i];
  const master = `assets/buildings-src/${n}@2x.png`;
  if (!existsSync(master)) { console.error(`missing master: ${master}`); process.exitCode = 1; continue; }
  const buf = await sharp(master).resize(CELL, CELL, { fit: 'contain', background: BG }).png().toBuffer();
  comps.push({ input: buf, left: (i % COLS) * CELL, top: Math.floor(i / COLS) * CELL });
}
const rows = Math.max(1, Math.ceil(names.length / COLS));
await sharp({ create: { width: COLS * CELL, height: rows * CELL, channels: 3, background: BG } })
  .composite(comps).png().toFile(out);
console.log(`montage ${out}: ${names.length} cells (${names.join(', ')})`);
