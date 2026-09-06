#!/usr/bin/env node
/**
 * K0/K2/K3 acceptance renders — committed reference screenshots.
 *
 *   node tools/render-reference.mjs
 *
 * Composites sprites straight from the built atlas with the EXACT draw math
 * of src/iso/depth.ts / src/iso/renderer.ts (tileToScreen centre-line +
 * packer anchors, painter order by tx+ty), so what you see in these PNGs is
 * what the game draws:
 *
 *   docs/kenney-k0-flush.png      one grass block + one factory, flush (K0:
 *                                 the building stands on the tile — neither
 *                                 floating nor sunk; no hand anchors).
 *   docs/kenney-k2-roads.png      all 16 road masks in a 4×4 block, plus an
 *                                 L-bend of straights+curve in each diagonal
 *                                 (the 90°-bug eyeball) and rail+crossing.
 *   docs/kenney-k3-scene.png      a small scene: terrain trio, every industry,
 *                                 tinted factories/depots, roads. (same line kept)
 *   docs/kenney-k5-vehicles.png   the truck's 8 compass frames parked on a
 *                                 road + the 4 road-direction headings.
 *   docs/kenney-n1-skirt.png      the N1 acceptance render: an interior road
 *                                 and buildings with NO brown at their base,
 *                                 and the island coastline keeping its block
 *                                 side (brown only at the map edge).
 *
 * N1: every scene declares a terrain grid (grass/water) and sprites are
 * clipped to their above-ground region when the tiles in front cover their
 * skirt — exactly renderer.skirtCovered/aboveGroundPoly — so brown appears
 * only at the coast here, as in the game.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "assets/iso-atlas/manifest.json"), "utf8"));
const atlas = await sharp(join(ROOT, "assets/iso-atlas/atlas@1x.png")).ensureAlpha()
  .raw().toBuffer({ resolveWithObject: true });
const DOCS = join(ROOT, "docs");

const HW = 66, HH = 32;
const tileToScreen = (tx, ty) => [(tx - ty) * HW, (tx + ty) * HH];

function makeCanvas(w, h, bg = [11, 26, 38]) {
  return { px: Buffer.alloc(w * h * 4).map((_, i) => (i % 4 === 3 ? 0 : bg[i % 4])), w, h };
}
// even-odd point-in-polygon (the N1 clip region check)
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// renderer.aboveGroundPoly: the region an INTERIOR sprite may paint — its
// ground diamond (centre lx,ly) plus everything above it, nothing below.
function aboveGroundPoly(lx, ly) {
  return [[lx - HW, ly - 300], [lx - HW, ly], [lx, ly + HH], [lx + HW, ly], [lx + HW, ly - 300]];
}
// renderer.skirtCovered for a 1x1 sprite: false when a SE/SW neighbour is
// water or off-grid — that tile is the coastline and keeps its block side.
function makeGrid(w, h) {
  const t = Array.from({ length: h }, () => Array(w).fill("grass"));
  return {
    t, w, h,
    set(x, y, v) { if (x >= 0 && y >= 0 && x < w && y < h) this.t[y][x] = v; },
    at(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? this.t[y][x] : "water"; },
    covered(tx, ty) {
      return this.at(tx + 1, ty) !== "water" && this.at(tx, ty + 1) !== "water";
    },
  };
}
function blit(c, name, dx, dy, clipPoly = null) {
  const s = manifest.sprites[name];
  if (!s) throw new Error(`no sprite ${name}`);
  dx |= 0; dy |= 0;
  // MB1: a composite has no atlas rect of its own — draw its layers bottom→top
  // at their baked (dx, dy) offsets, exactly as IsoRenderer.blit does.
  if (s.parts) {
    for (const part of s.parts) blit(c, part.sprite, dx + part.dx, dy + part.dy);
    return;
  }
  for (let y = 0; y < s.h; y++) {
    const Y = dy + y;
    if (Y < 0 || Y >= c.h) continue;
    for (let x = 0; x < s.w; x++) {
      const X = dx + x;
      if (X < 0 || X >= c.w) continue;
      if (clipPoly && !inPoly(X + 0.5, Y + 0.5, clipPoly)) continue;
      const si = ((s.y + y) * atlas.info.width + (s.x + x)) * 4;
      const di = (Y * c.w + X) * 4;
      const a = atlas.data[si + 3] / 255;
      if (a === 0) continue;
      c.px[di] = c.px[di] * (1 - a) + atlas.data[si] * a;
      c.px[di + 1] = c.px[di + 1] * (1 - a) + atlas.data[si + 1] * a;
      c.px[di + 2] = c.px[di + 2] * (1 - a) + atlas.data[si + 2] * a;
      c.px[di + 3] = 255;
    }
  }
}
/** depth.drawOrigin (K4): anchor pixel on the tile's centre-line. */
const drawOrigin = (name, tx, ty) => {
  const s = manifest.sprites[name];
  const [cx, cy] = tileToScreen(tx, ty);
  return [cx - s.anchor[0], cy - s.anchor[1]];
};
const label = (c, x, y, text, size = 13) => {
  c.labels = [...(c.labels ?? []), { x, y, text, size }];
};
async function emit(c, name) {
  const layers = [];
  if (c.labels?.length) {
    const esc = c.labels.map((l) => ({ ...l, text: l.text.replace(/&/g, "&amp;").replace(/</g, "&lt;") }));
    const w = Math.max(...esc.map((l) => l.x + l.text.length * (l.size * 0.62)));
    const h = Math.max(...esc.map((l) => l.y + 20));
    const svg = `<svg width="${Math.max(w, c.w)}" height="${Math.max(h, c.h)}" xmlns="http://www.w3.org/2000/svg">` +
      esc.map((l) => `<text x="${l.x}" y="${l.y}" font-family="monospace" font-size="${l.size}" fill="#dfe9f0">${l.text}</text>`).join("") +
      "</svg>";
    layers.push({ input: Buffer.from(svg), top: 0, left: 0 });
  }
  const img = sharp(Buffer.from(c.px), { raw: { width: c.w, height: c.h, channels: 4 } });
  const out = layers.length ? await img.composite(layers).png().toBuffer() : await img.png().toBuffer();
  writeFileSync(join(DOCS, name), out);
  console.log("docs/" + name, c.w + "x" + c.h);
}

// origin helper: pick an on-canvas origin for tile (0,0)
const withOrigin = (ox, oy) => ({
  ox, oy,
  tile: (name, tx, ty) => {
    const [dx, dy] = drawOrigin(name, tx, ty);
    return [ox + dx, oy + dy];
  },
});

// N1 rule-aware put: an INTERIOR sprite (SE/SW neighbours are land) is
// clipped to its above-ground region — its skirt is not drawn, exactly as
// renderer.ts draws it; a coast/edge sprite keeps the full block.
const n1put = (c, grid, o, name, tx, ty) => {
  const [dx, dy] = o.tile(name, tx, ty);
  const [cx, cy] = tileToScreen(tx, ty);
  const poly = grid.covered(tx, ty) ? aboveGroundPoly(o.ox + cx, o.oy + cy) : null;
  blit(c, name, dx, dy, poly);
};

// ── K0: one grass tile + one factory, flush ────────────────────────────────
{
  const c = makeCanvas(560, 420);
  const o = withOrigin(300, 130);
  // a 3×3 grass apron so the flush relationship is visible, factory at (1,1)
  const grid = makeGrid(3, 3);
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) n1put(c, grid, o, "terrain_grass", tx, ty);
  n1put(c, grid, o, "factory_blue", 1, 1);
  label(c, 16, 28, "K0 — 132x64 diamond + 50px block skirt");
  label(c, 16, 46, "factory_blue on tile (1,1): bottom-centre");
  label(c, 16, 62, "anchor, base diamond = tile diamond (flush)");
  await emit(c, "kenney-k0-flush.png");
}

// ── K2: the 16 road masks + L-bends in both diagonals + rail/crossing ─────
{
  const c = makeCanvas(1180, 1240);
  // 4×4 block of all 16 masks, grass under
  const o = withOrigin(340, 220);
  const grid = makeGrid(4, 4);
  let i = 0;
  for (let ty = 0; ty < 4; ty++) {
    for (let tx = 0; tx < 4; tx++) {
      n1put(c, grid, o, "terrain_grass", tx, ty);
      const mask = (i++).toString(2).padStart(4, "0");
      n1put(c, grid, o, `road_${mask}`, tx, ty);
      const [sx, sy] = o.tile("terrain_grass", tx, ty);
      label(c, sx + 30, sy + 118, mask, 12);
    }
  }
  label(c, 20, 30, "K2 — all 16 road masks (NE=1 SE=2 SW=4 NW=8 bits)");
  label(c, 20, 48, "rows L→R, top→bottom: 0000…1111");

  // L-bend: NE–SW straight turning to SE–NW (and the mirror), on grass
  const p = withOrigin(300, 760);
  const bendGrid = makeGrid(3, 3);
  const road = (tx, ty, name) => { n1put(c, bendGrid, p, "terrain_grass", tx, ty); n1put(c, bendGrid, p, name, tx, ty); };
  road(0, 0, "road_0101"); road(0, 1, "road_0101"); road(0, 2, "road_0110");
  road(1, 2, "road_1010"); road(2, 2, "road_1010");
  label(c, 20, 700, "L-bend: NE|SW straight -> SE|SW curve -> SE|NW straight");
  label(c, 20, 718, "(asphalt must run the way the mask says — the 90° eyeball)");

  const q = withOrigin(820, 760);
  const railGrid = makeGrid(3, 3);
  const r2 = (tx, ty, name) => { n1put(c, railGrid, q, "terrain_grass", tx, ty); n1put(c, railGrid, q, name, tx, ty); };
  r2(0, 0, "rail_0101"); r2(0, 1, "rail_0101"); r2(0, 2, "crossing");
  r2(1, 2, "road_1010"); r2(2, 2, "road_1010");
  label(c, 640, 700, "rail straight + crossing over a road straight");
  await emit(c, "kenney-k2-roads.png");
}

// ── K3: a small scene with every mapped concept ────────────────────────────
{
  const c = makeCanvas(1180, 1120);
  const o = withOrigin(560, 320);
  const R = 4;
  const grid = makeGrid(R, R);
  grid.set(2, 0, "water");
  const put = (name, tx, ty) => n1put(c, grid, o, name, tx, ty);
  for (let ty = 0; ty < R; ty++) for (let tx = 0; tx < R; tx++) put(`terrain_${grid.at(tx, ty)}`, tx, ty);
  put("terrain_rough", 3, 0);
  // industries along the front row
  put("farm", 0, 2); put("forest", 1, 2); put("ore_mine", 2, 2);
  put("quarry", 3, 2); put("oil_rig", 0, 3); put("gold_mine", 1, 3);
  // player buildings + tints
  put("factory_blue", 2, 1); put("factory_red", 3, 1);
  put("depot_blue", 2, 3); put("depot_red", 3, 3);
  // a road + rail L through the middle
  const road = (tx, ty, name) => n1put(c, grid, o, name, tx, ty);
  road(0, 0, "road_0101"); road(0, 1, "road_0111"); road(1, 1, "road_1110");
  road(2, 1, "road_1010"); road(3, 1, "road_1010");
  label(c, 20, 30, "K3 — every industry/depot/factory mapping (tints: blue/red),");
  label(c, 20, 48, "water + rough terrain, road T-junction and straights");
  await emit(c, "kenney-k3-scene.png");
}

// ── K5: the truck — 8 compass frames + the 4 road directions ───────────────
{
  const c = makeCanvas(1180, 760);
  const o = withOrigin(560, 300);
  const grid = makeGrid(5, 4);
  const put = (name, tx, ty) => n1put(c, grid, o, name, tx, ty);
  // a garage apron of road straights/crossings to sit the frames on
  const apron = [["road_0101", 0, 0], ["road_0101", 0, 1], ["crossing", 0, 2],
                 ["road_1010", 1, 2], ["road_1010", 2, 2], ["road_1111", 1, 1]];
  for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 4; tx++)
    if (!apron.some(([, ax, ay]) => ax === tx && ay === ty)) put("terrain_grass", tx, ty);
  for (const [n, tx, ty] of apron) put(n, tx, ty);
  // the eight frames fanned around the apron on grass diamonds
  const spots = [["n", 3, 1], ["ne", 3, 0], ["e", 4, 0], ["se", 4, 1],
                 ["s", 4, 2], ["sw", 3, 2], ["w", 2, 3], ["nw", 3, 3]];
  for (const [h, tx, ty] of spots) {
    put("terrain_grass", tx, ty);
    blit(c, `vehicle_truck_${h}`, ...o.tile(`vehicle_truck_${h}`, tx, ty));  // vehicles: no skirt
    const [sx, sy] = o.tile("terrain_grass", tx, ty);
    label(c, sx + 40, sy + 56, h, 12);
  }
  label(c, 20, 30, "K5 — garbage truck, Kenney's 8 compass frames (bottom-centre");
  label(c, 20, 48, "anchors); road directions are ne/se/sw/nw — matches the mask bits");
  await emit(c, "kenney-k5-vehicles.png");
}

// ── N1: brown only at the coastline ─────────────────────────────────────────
// The backlog's screenshot test: a road crossing the INTERIOR shows no brown
// at its edges and neither do the buildings; the island's coastline shows the
// brown block side. Interior = clipped to the diamond (skirtCovered), coast =
// full block.
{
  const W = 7, H = 7;
  const grid = makeGrid(W, H);
  for (let ty = 0; ty < H; ty++) grid.set(6, ty, "water");   // the sea, SE face
  grid.set(5, 6, "water");
  const c = makeCanvas(1120, 760);
  const o = withOrigin(540, 190);
  for (let ty = 0; ty < H; ty++) {
    for (let tx = 0; tx < W; tx++) {
      n1put(c, grid, o, `terrain_${grid.at(tx, ty)}`, tx, ty);
    }
  }
  // an interior road line + buildings — no brown at any of their bases
  n1put(c, grid, o, "factory_blue", 2, 1);
  n1put(c, grid, o, "road_0101", 1, 2);
  n1put(c, grid, o, "road_0101", 2, 2);
  n1put(c, grid, o, "crossing", 3, 2);
  n1put(c, grid, o, "road_1010", 3, 3);
  n1put(c, grid, o, "farm", 4, 2);
  n1put(c, grid, o, "depot_blue", 2, 4);
  label(c, 20, 30, "N1 — brown only at the coastline: interior road and");
  label(c, 20, 48, "buildings sit flush on the flat ground plane (no skirt,");
  label(c, 20, 66, "no brown at the base); the SE coast keeps its block side.");
  await emit(c, "kenney-n1-skirt.png");
}
