#!/usr/bin/env node
/**
 * T1–T4 visual review, using the REAL IsoRenderer, atlas, map and depth sort
 * in Chromium (no canvas mocks). Start Vite first: npm run dev -- --port 5173
 * Then: node tools/capture-iso-review.mjs [output-dir]
 *
 * ISO_REVIEW_URL overrides the Vite URL. CHROMIUM_EXECUTABLE can point at a
 * locally installed browser when Playwright's bundled browser is unavailable.
 * Output defaults to the gitignored test-results directory; copy only reviewed
 * evidence into docs/playtest-reports. The full map is captured at native 0.5×,
 * not downscaled to fit a normal viewport.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const out = resolve(process.argv[2] ?? "test-results/iso-review");
const url = process.env.ISO_REVIEW_URL ?? "http://localhost:5173/hexmatch/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  // Only the empty review shell is synthetic. All modules and art below are
  // fetched from Vite, and every draw goes through the shipped renderer.
  await page.route("**/__iso_review__.html", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><head><style>body{margin:0;background:#0b1a26}canvas{position:absolute;inset:0}</style></head><body></body></html>',
  }));
  await page.goto(new URL("__iso_review__.html", url).href);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(async (base) => {
    const [{ IsoRenderer }, { Atlas }, camera, { generateMap }, config] = await Promise.all([
      import(`${base}src/iso/renderer.ts`), import(`${base}src/iso/atlas.ts`),
      import(`${base}src/iso/camera.ts`), import(`${base}src/iso/grid.ts`), import(`${base}src/iso/config.ts`),
    ]);
    const manifest = await fetch(`${base}assets/iso-atlas/manifest.json`).then((r) => r.json());
    const images = new Map(await Promise.all(Object.entries(manifest.images).map(async ([zoom, file]) => {
      const img = new Image();
      img.src = `${base}assets/iso-atlas/${file}`;
      await img.decode();
      return [Number(zoom), img];
    })));
    const atlas = new Atlas(manifest, images);
    const grid = generateMap(1337);
    const towns = grid.towns.flatMap((t) => t.houses.map(([tx, ty]) => ({
      tx, ty, sprite: tx === t.tx && ty === t.ty ? "town_center" : config.townHouseSprite(tx, ty),
    })));
    const canvases = Object.fromEntries(["terrain", "structures", "overlay"].map((name) => {
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      return [name, canvas];
    }));
    const world = { grid, extra: towns };
    const renderer = new IsoRenderer(canvases, atlas, camera.createCamera(), world);
    // Expose only to this throwaway review page, never to the game.
    window.review = (scene, width, height) => {
      for (const c of Object.values(canvases)) { c.width = width; c.height = height; }
      let target = [grid.w / 2, grid.h / 2];
      let zoom = 2;
      world.extra = towns;
      if (scene === "map") zoom = 0.5;
      else if (scene === "town") target = [grid.towns[0].tx, grid.towns[0].ty];
      else if (scene === "factories") {
        target = [72, 72];
        world.extra = ["blue", "red"].flatMap((colour, i) =>
          config.FACTORY_TILES.map(({ dx, dy }) => ({
            sprite: `factory_mt_${colour}_${dy * 2 + dx}`,
            tx: 70 + 4 * i + dx, ty: 74 - 4 * i + dy,
          })));
        for (const item of world.extra) if (!atlas.has(item.sprite)) throw new Error(`Missing ${item.sprite}`);
      } else {
        const ind = grid.industries.find((i) => i.type === scene);
        if (!ind) throw new Error(`No industry ${scene}`);
        target = [ind.tx + ind.w / 2, ind.ty + ind.h / 2];
      }
      renderer.setWorld(world);
      const cam = camera.centerOnTile({ ...camera.createCamera(width, height), zoom }, ...target);
      renderer.setCamera(cam);
      renderer.render(0); // fixed animation phase for reproducible evidence
      return { scene, camera: cam, ...renderer.renderDiagnostics() };
    };
    window.reviewMap = { width: grid.w, height: grid.h, industries: grid.industries, towns: grid.towns };
  }, url);

  const diagnostics = [];
  for (const scene of ["farm", "ore_mine", "gold_mine", "quarry", "town", "factories", "map"]) {
    const width = scene === "map" ? 4704 : scene === "factories" ? 1024 : 640;
    const height = scene === "map" ? 2400 : 480;
    await page.setViewportSize({ width, height });
    diagnostics.push(await page.evaluate(({ scene, width, height }) => window.review(scene, width, height), { scene, width, height }));
    await page.screenshot({ path: `${out}/${scene}.png` });
    console.log(`rendered ${scene}: ${width}×${height}`);
  }
  await writeFile(`${out}/diagnostics.json`, JSON.stringify({
    map: await page.evaluate(() => window.reviewMap), diagnostics, errors,
  }, null, 2));
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
