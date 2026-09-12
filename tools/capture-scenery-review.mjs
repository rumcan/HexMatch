#!/usr/bin/env node
/**
 * SCENERY visual review — the real IsoRenderer, atlas, ground textures and the
 * scenery (decals + clumped trees) in Chromium, captured at native zoom so the
 * art can be judged at the size a player sees.
 *
 * Start Vite first: npm run dev
 * Then: node tools/capture-scenery-review.mjs [output-dir]
 *
 * Writes <out>/scenery-{2x,1x,0.5x}.png plus a wide 0.5× map sweep.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const out = resolve(process.argv[2] ?? "test-results/scenery-review");
const url = process.env.ISO_REVIEW_URL ?? "http://localhost:5173/hexmatch/";
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.route("**/__scenery_review__.html", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><head><style>body{margin:0;background:#0b1a26}canvas{position:absolute;inset:0}</style></head><body></body></html>',
  }));
  await page.goto(new URL("__scenery_review__.html", url).href);

  await page.evaluate(async (base) => {
    const [{ IsoRenderer }, { Atlas, loadBuildingLayers }, camera, { generateMap }, config,
      { loadGroundTextures }, { scatterScenery }, sceneryArt] = await Promise.all([
      import(`${base}src/iso/renderer.ts`), import(`${base}src/iso/atlas.ts`),
      import(`${base}src/iso/camera.ts`), import(`${base}src/iso/grid.ts`),
      import(`${base}src/iso/config.ts`), import(`${base}src/iso/ground.ts`),
      import(`${base}src/iso/scenery.ts`), import(`${base}src/iso/scenery-art.ts`),
    ]);
    const manifest = await fetch(`${base}assets/iso-atlas/manifest.json`).then((r) => r.json());
    const images = new Map(await Promise.all(Object.entries(manifest.images).map(async ([zoom, file]) => {
      const img = new Image();
      img.src = `${base}assets/iso-atlas/${file}`;
      await img.decode();
      return [Number(zoom), img];
    })));
    const atlas = new Atlas(manifest, images);
    const layerImg = async (file) => {
      const img = new Image();
      img.src = `${base}assets/layers/${file}`;
      await img.decode();
      return img;
    };
    for (const layer of ["roads", "buildings"]) {
      atlas.layerImages.set(layer, new Map([
        [0.5, await layerImg(`${layer}@0.5x.png`)],
        [1, await layerImg(`${layer}@1x.png`)],
        [2, await layerImg(`${layer}@2x.png`)],
      ]));
    }
    await loadBuildingLayers(atlas, `${base}assets/buildings/`);
    const groundTex = await loadGroundTextures({
      grass: `${base}assets/ground/grass.png`,
      sand: `${base}assets/ground/sand.png`,
      water: `${base}assets/ground/water.png`,
    });
    const grid = generateMap(1337);
    const scenery = scatterScenery(grid);
    const trees = await sceneryArt.loadScenerySprites(atlas);
    const decalImages = await sceneryArt.loadDecalImages();

    const towns = grid.towns.flatMap((t) => t.houses.map(([tx, ty]) => ({
      tx, ty, sprite: tx === t.tx && ty === t.ty ? "town_center" : config.townHouseSprite(tx, ty),
    })));
    const canvases = Object.fromEntries(["terrain", "structures", "overlay"].map((name) => {
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      return [name, canvas];
    }));
    const world = { grid, extra: towns, trees: scenery.trees, forests: scenery.forests };
    const renderer = new IsoRenderer(canvases, atlas, camera.createCamera(), world);
    renderer.setGround(groundTex);
    renderer.setDecals(scenery);
    renderer.setDecalImages(decalImages);
    renderer.recomputePad();
    renderer.invalidateAll();

    // Frame a forest block when there is one — that is the whole point of the
    // 4x4 art — otherwise the densest 6x6 neighbourhood of single trees.
    let best = [grid.w / 2, grid.h / 2], bestN = -1;
    for (let ty = 6; ty < grid.h - 6; ty += 2) {
      for (let tx = 6; tx < grid.w - 6; tx += 2) {
        let n = 0;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++)
            if (scenery.trees[(ty + dy) * grid.w + tx + dx]) n++;
        if (n > bestN) { bestN = n; best = [tx, ty]; }
      }
    }
    if (scenery.forests.length) {
      const f = scenery.forests[0];
      best = [f.tx + 2, f.ty + 2];
    }
    window.reviewInfo = {
      trees, decalCounts: Object.fromEntries(Object.entries(decalImages).map(([k, v]) => [k, v.length])),
      decals: scenery.decals.length,
      forests: scenery.forests.length,
      plantedTrees: scenery.trees.reduce((a, v) => a + (v ? 1 : 0), 0),
      densest: best, densestCount: bestN,
    };
    // A road fixture: every one of the sixteen masks for both tiers, laid out
    // on a clear patch so each can be read on its own, plus a mixed-tier run.
    window.roadFixture = (originX, originY) => {
      const road = new Uint8Array(grid.w * grid.h);
      const dirt = new Uint8Array(grid.w * grid.h);
      const put = (arr, tx, ty, mask) => { arr[ty * grid.w + tx] = 0b10000 | mask; };
      for (let mask = 0; mask < 16; mask++) {
        const tx = originX + (mask % 4) * 3, ty = originY + ((mask / 4) | 0) * 3;
        put(road, tx, ty, mask);
        put(dirt, tx, ty + 12, mask);
      }
      // A long mixed run: dirt meeting paved, so the transitions are visible.
      for (let k = 0; k < 14; k++) {
        const tx = originX + k, ty = originY + 24;
        const mask = (k === 0 ? 0 : 8) | (k === 13 ? 0 : 2);
        put(k < 7 ? dirt : road, tx, ty, mask);
      }
      world.roadBits = road;
      world.dirtBits = dirt;
      renderer.setWorld(world);
      renderer.invalidateAll();
    };
    window.setRoadMode = (mode) => { renderer.setRoadMode(mode); renderer.invalidateAll(); };
    // Road materials, the same two swatches the game loads.
    {
      const rr = await import(`${base}src/iso/road-renderer.ts`);
      const tex = async (f) => { const i = new Image(); i.src = `${base}assets/roads/${f}`; await i.decode(); return i; };
      try {
        const [asphalt, dirt] = await Promise.all([tex("asphalt.webp"), tex("dirt.webp")]);
        renderer.setRoadStyle({
          ...rr.DEFAULT_ROAD_STYLE,
          paved: { ...rr.DEFAULT_ROAD_STYLE.paved, image: asphalt },
          dirt: { ...rr.DEFAULT_ROAD_STYLE.dirt, image: dirt },
        });
        window.roadTextures = true;
      } catch {
        window.roadTextures = false;
      }
    }
    window.review = (zoom, width, height, target) => {
      for (const c of Object.values(canvases)) { c.width = width; c.height = height; }
      renderer.setWorld(world);
      renderer.setCamera(camera.centerOnTile(
        { ...camera.createCamera(width, height), zoom }, ...(target ?? best),
      ));
      renderer.render(0);
      return renderer.renderDiagnostics();
    };
  }, url);

  const info = await page.evaluate(() => window.reviewInfo);
  console.log("scenery:", JSON.stringify(info));

  const shots = [
    ["scenery-2x", 2, 1200, 760],
    ["scenery-1x", 1, 1200, 760],
    ["scenery-0.5x", 0.5, 1200, 760],
    ["scenery-map", 0.5, 2400, 1200],
  ];
  const ROAD_ORIGIN = [40, 40];
  const diagnostics = [];
  for (const [name, zoom, width, height] of shots) {
    await page.setViewportSize({ width, height });
    diagnostics.push({ name, ...(await page.evaluate(
      ({ zoom, width, height }) => window.review(zoom, width, height),
      { zoom, width, height },
    )) });
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`rendered ${name}: ${width}×${height} @${zoom}×`);
  }
  // Road A/B: the same fixture in both renderers, at every zoom.
  await page.evaluate(([x, y]) => window.roadFixture(x, y), ROAD_ORIGIN);
  const roadDiag = [];
  for (const mode of ["sprites", "textured"]) {
    await page.evaluate((m) => window.setRoadMode(m), mode);
    for (const zoom of [2, 1, 0.5]) {
      const width = zoom === 0.5 ? 1400 : 1200, height = zoom === 0.5 ? 900 : 760;
      await page.setViewportSize({ width, height });
      roadDiag.push({
        mode, zoom,
        ...(await page.evaluate(
          ({ zoom, width, height, t }) => window.review(zoom, width, height, t),
          { zoom, width, height, t: [ROAD_ORIGIN[0] + 5, ROAD_ORIGIN[1] + 10] },
        )),
      });
      await page.screenshot({ path: `${out}/road-${mode}-${zoom}x.png` });
      console.log(`rendered road-${mode}-${zoom}x`);
    }
  }

  await writeFile(`${out}/diagnostics.json`, JSON.stringify({ info, diagnostics, roadDiag, errors }, null, 2));
  if (errors.length) console.warn("page errors:\n" + errors.join("\n"));
} finally {
  await browser.close();
}
