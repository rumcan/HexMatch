#!/usr/bin/env node
// MATCH-2 (#566): render the board's special pieces into src/assets/board/.
//
//   PW_CHROMIUM=<chrome-headless-shell> node tools/board-art/render-board-art.mjs
//
// bomb@2x.webp   24 frames × 192 px — a full turn of the iron charge (it spins on the board)
// ice1@2x.webp   192 px — the frost cube, cracked through (one hit left)
// ice2@2x.webp   192 px — the frost cube, thick rime (two hits left)
// Modelled in three.js (tools/board-art/board-art.html), rendered at 3× and
// downsampled. The cargo icons themselves are the owner's painted art.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import sharp from "sharp";
import { chromium } from "playwright";

const ROOT = process.cwd();
const OUT = "src/assets/board";
const SIZE = 192;
const SS = 3;
const PIECES = { bomb: 24, ice1: 1, ice2: 1 };

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };
function serve() {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] ?? "application/octet-stream" });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function run() {
  const server = await serve();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error("page:", e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/tools/board-art/board-art.html`);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 });
  fs.mkdirSync(OUT, { recursive: true });
  for (const [kind, frames] of Object.entries(PIECES)) {
    const urls = await page.evaluate((q) => window.renderPiece(q), { kind, frames, size: SIZE * SS, tilt: 0.12, outline: 2.2 * SS });
    const pics = [];
    for (const u of urls) {
      pics.push(await sharp(Buffer.from(u.split(",")[1], "base64")).resize(SIZE, SIZE, { kernel: "lanczos3" }).png().toBuffer());
    }
    await sharp({ create: { width: SIZE * pics.length, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(pics.map((input, i) => ({ input, left: i * SIZE, top: 0 })))
      .webp({ quality: 92, alphaQuality: 100, effort: 6 })
      .toFile(path.join(OUT, `${kind}@2x.webp`));
    console.log(`${kind}: ${frames} frame(s)`);
  }
  await browser.close();
  server.close();
}

run().catch((e) => { console.error(e.stack ?? e.message); process.exit(1); });
