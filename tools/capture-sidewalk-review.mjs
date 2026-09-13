#!/usr/bin/env node
/**
 * #159 visual review — town-street sidewalks and corner street lamps, drawn by
 * the REAL renderer in Chromium: the shipped IsoRenderer, atlas, ground
 * textures, the generated map and the roads the game actually seeds onto the
 * track layer (`seedTownRoads` + `seedPublicRoads`, not a hand-built stub).
 *
 * Start Vite first: npm run dev
 * Then: node tools/capture-sidewalk-review.mjs [output-dir]
 *
 * Writes, into the output directory (default: the gitignored test-results):
 *   town-1x.png        the first town's street grid at 1x
 *   town-2x.png        the same streets at 2x, where the joints read
 *   crossing-2x.png    one crossroads close up: four kerbs, two lamps
 *   dead-end-2x.png    a street's end: the cap, and the lamp over it
 *   country-1x.png     an inter-town highway, outside the limits: no sidewalks
 *   diagnostics.json   sidewalk tiles per scene, cache stats, page errors
 *
 * ISO_REVIEW_URL overrides the Vite URL. CHROMIUM_EXECUTABLE can point at a
 * locally installed browser when Playwright's bundled browser is unavailable.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const out = resolve(process.argv[2] ?? "test-results/sidewalk-review");
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
  // Only the empty review shell is synthetic; every module and every pixel
  // below comes from the dev server and the shipped code.
  await page.route("**/__sidewalk_review__.html", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><head><style>body{margin:0;background:#0b1a26}canvas{position:absolute;inset:0}</style></head><body></body></html>',
  }));
  await page.goto(new URL("__sidewalk_review__.html", url).href);

  await page.evaluate(async (base) => {
    const [{ IsoRenderer }, { Atlas, loadBuildingLayers }, camera, grid, config,
      { createTrack, seedTownRoads, seedPublicRoads }, { loadGroundTextures },
      { streetLampSpots }] = await Promise.all([
      import(`${base}src/iso/renderer.ts`), import(`${base}src/iso/atlas.ts`),
      import(`${base}src/iso/camera.ts`), import(`${base}src/iso/grid.ts`),
      import(`${base}src/iso/config.ts`), import(`${base}src/iso/track.ts`),
      import(`${base}src/iso/ground.ts`), import(`${base}src/iso/road-geometry.ts`),
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
    atlas.layerImages.set("roads", new Map([
      [0.5, await layerImg("roads@0.5x.png")], [1, await layerImg("roads@1x.png")], [2, await layerImg("roads@2x.png")],
    ]));
    atlas.layerImages.set("buildings", new Map([
      [0.5, await layerImg("buildings@0.5x.png")], [1, await layerImg("buildings@1x.png")], [2, await layerImg("buildings@2x.png")],
    ]));
    await loadBuildingLayers(atlas, `${base}assets/buildings/`);
    const groundTex = await loadGroundTextures({
      grass: `${base}assets/ground/grass.png`,
      sand: `${base}assets/ground/sand.png`,
      water: `${base}assets/ground/water.png`,
    });
    const map = grid.generateMap(1337);
    // The real thing: the town streets and the public highways exactly as the
    // game stamps them onto a fresh track at boot.
    const track = createTrack();
    seedTownRoads(track, map);
    seedPublicRoads(track, map);
    const houses = map.towns.flatMap((t) => t.houses.map(([tx, ty]) => ({
      tx, ty, sprite: tx === t.tx && ty === t.ty ? "town_center" : config.townHouseSprite(tx, ty),
    })));
    const canvases = Object.fromEntries(["terrain", "structures", "overlay"].map((name) => {
      const canvas = document.createElement("canvas");
      document.body.append(canvas);
      return [name, canvas];
    }));
    const world = { grid: map, roadBits: track.road, dirtBits: track.dirt, extra: houses };
    const renderer = new IsoRenderer(canvases, atlas, camera.createCamera(), world);
    renderer.setGround(groundTex);

    const maskAt = (tx, ty) => track.road[ty * map.w + tx] & 0b1111;
    const townTiles = new Set(map.towns.flatMap((t) => t.roads.map(([tx, ty]) => ty * map.w + tx)));
    // A crossroads and a dead end in the first town, found the way the renderer
    // finds them: by the road byte's connection mask.
    let crossing = null, deadEnd = null, bend = null;
    for (const [tx, ty] of map.towns[0].roads) {
      const m = maskAt(tx, ty);
      if (m === 0b1111 && !crossing) crossing = [tx, ty];
      if (m !== 0 && (m & (m - 1)) === 0 && !deadEnd) deadEnd = [tx, ty];
      if (m === (1 | 2) || m === (2 | 4) || m === (4 | 8) || m === (8 | 1)) bend ??= [tx, ty];
    }
    // A highway tile OUTSIDE every town's limits: the town roads are stamped
    // TOWN_OCC in occupancy, a public highway is not.
    let country = null;
    for (const [tx, ty] of map.publicRoads ?? []) {
      if (townTiles.has(ty * map.w + tx)) continue;
      let near = false;
      for (let dy = -3; dy <= 3 && !near; dy++) {
        for (let dx = -3; dx <= 3 && !near; dx++) {
          if (townTiles.has((ty + dy) * map.w + tx + dx)) near = true;
        }
      }
      if (!near && maskAt(tx, ty) === (1 | 4)) { country = [tx, ty]; break; }
    }

    window.review = (scene, width, height) => {
      for (const c of Object.values(canvases)) { c.width = width; c.height = height; }
      const targets = {
        town: [map.towns[0].tx, map.towns[0].ty, 1],
        "town-2x": [map.towns[0].tx, map.towns[0].ty, 2],
        crossing: [...(crossing ?? [map.towns[0].tx, map.towns[0].ty]), 2],
        deadend: [...(deadEnd ?? [map.towns[0].tx, map.towns[0].ty]), 2],
        bend: [...(bend ?? [map.towns[0].tx, map.towns[0].ty]), 2],
        country: [...(country ?? [map.towns[0].tx, map.towns[0].ty]), 1],
      };
      const [tx, ty, zoom] = targets[scene] ?? targets.town;
      renderer.setWorld(world);
      const cam = camera.centerOnTile({ ...camera.createCamera(width, height), zoom }, tx + 0.5, ty + 0.5);
      renderer.setCamera(cam);
      renderer.render(0); // fixed animation phase for reproducible evidence
      // Counted through the shipped geometry, not a second implementation:
      // every town street tile carries a sidewalk, and the lamps are the ones
      // `streetLampSpots` puts on its corners.
      let sidewalkTiles = 0, lamps = 0;
      for (const [sx, sy] of map.towns.flatMap((t) => t.roads)) {
        const cell = track.road[sy * map.w + sx];
        if (!cell) continue;
        sidewalkTiles++;
        lamps += streetLampSpots(sx, sy, cell & 0b1111).length;
      }
      const counted = { sidewalkTiles, lamps };
      return {
        scene, tile: [tx, ty], zoom, camera: cam, ...counted,
        spots: { crossing, deadEnd, bend, country }, ...renderer.renderDiagnostics(),
      };
    };
    window.reviewMap = { map: [map.w, map.h], towns: map.towns.map((t) => ({ centre: [t.tx, t.ty], streets: t.roads.length })) };
  }, url);

  const diagnostics = [];
  const scenes = { town: [640, 480], "town-2x": [640, 480], crossing: [480, 360], deadend: [480, 360], bend: [480, 360], country: [640, 480] };
  for (const [scene, [width, height]] of Object.entries(scenes)) {
    await page.setViewportSize({ width, height });
    diagnostics.push(await page.evaluate(({ scene, width, height }) => window.review(scene, width, height), { scene, width, height }));
    await page.screenshot({ path: `${out}/${scene}.png` });
    console.log(`rendered ${scene}: ${width}×${height}`);
  }
  await writeFile(`${out}/diagnostics.json`, JSON.stringify({
    map: await page.evaluate(() => window.reviewMap), diagnostics, errors,
  }, null, 2));
  console.log(`diagnostics: ${out}/diagnostics.json${errors.length ? ` (${errors.length} page errors)` : ""}`);
  if (errors.length) throw new Error(errors.join("\n"));
} finally {
  await browser.close();
}
