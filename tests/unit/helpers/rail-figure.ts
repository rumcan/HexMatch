// ─────────────────────────────────────────────────────────────────────────────
// RAIL-02 (#176) evidence figure — "screenshots where visual", without a
// browser.
//
// The rail modules are headless, so there is nothing in the running game to
// photograph yet (art is #177, the construction UI is #179). What IS visual
// today is the placement GEOMETRY: which tiles a rotated platform claims, which
// two of them are the lane and where its ports point, which edge a depot leaves
// from, where a crossing may sit — and a reviewer should be able to check those
// against a picture instead of reverse-engineering them from a test.
//
// So this file draws the module's OWN footprint functions (never a copy of
// them) onto an isometric raster, and `iso-railway-figure.test.ts` rasterises it
// with sharp — the same software-preview trick `iso-ground.test.ts` uses, which
// is what makes the figure work in a sandbox with no Chromium:
//
//   PREVIEW_RAIL=1 npx vitest run tests/unit/iso-railway-figure.test.ts
//
// and the output lands in `docs/railway-02/preview.png`.
// ─────────────────────────────────────────────────────────────────────────────
import sharp from "sharp";
import { HW, HH, TILE_H } from "../../../src/game/config";
import { GRASS, type Industry } from "../../../src/iso/grid";
import { buildTile, createTrack, DIR, tIdx, type Dir } from "../../../src/iso/track";
import { createRailway, ROTATIONS } from "../../../src/iso/railway/state";
import {
  depotPortDir, depotPortTiles, depotTiles, platformLaneTiles, platformPorts,
  platformStripTiles, platformTiles,
} from "../../../src/iso/railway/geometry";
import {
  commitRailDrag, previewRailDrag, railReasonText, type RailWorld,
} from "../../../src/iso/railway/placement";

// ── palette (the noir HUD's, so the figure reads like the game) ─────────────
const BG = "#0e1116";
const PANEL = "#161a21";
const INK = "#e8edf5";
const DIM = "#8b95a7";
const GRASS_TILE = "#26301f";
const GRASS_EDGE = "#33402a";
const ROAD = "#6b6257";
const ROAD_CORE = "#a89c8a";
const RAIL = "#f0c05a";
const RAIL_DARK = "#6b4f16";
const LANE = "#ffd07a";
const STRIP = "#3f6ea8";
const DEPOT = "#7a4f8f";
const OK = "#5fd38a";
const BAD = "#ef6b6b";
const CROSS = "#ff9f43";

const FONT = "DejaVu Sans, Verdana, sans-serif";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Pt { x: number; y: number }

/** One panel: a block of tiles, centred in its box on the final canvas. */
class Panel {
  originX = 0;
  originY = 0;
  private minX = Infinity;
  private minY = Infinity;

  constructor(public tx0: number, public ty0: number, public tx1: number, public ty1: number) {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const c = this.raw(tx, ty);
        this.minX = Math.min(this.minX, c.x - HW);
        this.minY = Math.min(this.minY, c.y - HH);
      }
    }
  }

  private raw(tx: number, ty: number): Pt {
    return { x: (tx - ty) * HW, y: (tx + ty) * HH + HH };
  }

  /** Tile centre, in canvas pixels. */
  at(tx: number, ty: number): Pt {
    const r = this.raw(tx, ty);
    return { x: this.originX + r.x - this.minX, y: this.originY + r.y - this.minY };
  }

  get width(): number {
    return (this.tx1 - this.tx0 + this.ty1 - this.ty0) * HW + HW * 2;
  }
  get height(): number {
    return (this.tx1 - this.tx0 + this.ty1 - this.ty0) * HH + TILE_H * 2;
  }
}

// ── primitives ─────────────────────────────────────────────────────────────
const diamond = (p: Pt, fill: string, stroke = "none", extra = "", inset = 0): string => {
  const w = HW - inset, h = HH - inset / 2;
  return `<polygon points="${p.x},${p.y - h} ${p.x + w},${p.y} ${p.x},${p.y + h} ${p.x - w},${p.y}"`
    + ` fill="${fill}" stroke="${stroke}" ${extra}/>`;
};

const seg = (a: Pt, b: Pt, stroke: string, w: number, extra = ""): string =>
  `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"`
  + ` stroke="${stroke}" stroke-width="${w}" ${extra}/>`;

const label = (
  p: Pt, text: string, size = 13, fill = INK, anchor = "start",
): string => `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-family="${FONT}" font-size="${size}"`
  + ` fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`;

/** A grid direction as an arrow on screen: NE is up-right, SE is down-right … */
const arrow = (p: Pt, dir: Dir, len = 26, fill = OK): string => {
  const [dx, dy] = DIR[dir];
  const vx = (dx - dy) * (HW / 2), vy = (dx + dy) * (HH / 2);
  const m = Math.hypot(vx, vy) || 1;
  const ux = (vx / m) * len, uy = (vy / m) * len;
  const px = (-uy / len) * 7, py = (ux / len) * 7;
  const tip = { x: p.x + ux, y: p.y + uy };
  const tail = { x: p.x + ux * 0.25, y: p.y + uy * 0.25 };
  return seg(p, tail, fill, 3)
    + `<polygon points="${tip.x},${tip.y} ${tail.x - px},${tail.y - py} ${tail.x + px},${tail.y + py}" fill="${fill}"/>`;
};

/** The one place rail is drawn: dark sleepers under a bright pair. */
const railRun = (a: Pt, b: Pt, color = RAIL, width = 5): string => {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.y - a.y) / len, uy = -(b.x - a.x) / len;      // the tie direction
  let out = seg(a, b, RAIL_DARK, width + 4);
  const n = Math.max(2, Math.round(len / 13));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
    out += seg({ x: x - ux * 6, y: y - uy * 6 }, { x: x + ux * 6, y: y + uy * 6 }, RAIL_DARK, 3);
  }
  return out + seg(a, b, color, width * 0.42);
};

const roadRun = (a: Pt, b: Pt, color = ROAD): string =>
  seg(a, b, color, 20, 'stroke-linecap="butt"') + seg(a, b, ROAD_CORE, 2.5, 'stroke-dasharray="7 9" opacity="0.7"');

const cross = (p: Pt, size = 9): string =>
  seg({ x: p.x - size, y: p.y - size }, { x: p.x + size, y: p.y + size }, BAD, 3)
  + seg({ x: p.x + size, y: p.y - size }, { x: p.x - size, y: p.y + size }, BAD, 3);

/** The screen point under a tile set's southernmost tile, for a caption. */
const southOf = (panel: Panel, tiles: readonly (readonly [number, number])[]): Pt => {
  let best = tiles[0];
  for (const t of tiles) if (t[0] + t[1] > best[0] + best[1]) best = t;
  const p = panel.at(best[0], best[1]);
  return { x: p.x - 46, y: p.y + 26 };
};

/** A panel's ground: every tile of its rectangle, flat grass. */
const ground = (panel: Panel): string => {
  let out = "";
  for (let ty = panel.ty0; ty <= panel.ty1; ty++) {
    for (let tx = panel.tx0; tx <= panel.tx1; tx++) {
      out += diamond(panel.at(tx, ty), GRASS_TILE, GRASS_EDGE, 'stroke-width="1"');
    }
  }
  return out;
};

// ── A: the drag and the level crossing ─────────────────────────────────────
function panelCrossing(w: RailWorld): string {
  const panel = new Panel(0, 0, 11, 11);
  const at = (tx: number, ty: number) => panel.at(tx, ty);
  let svg = ground(panel);
  // the industry the figure's platform will anchor to, for continuity
  for (const [x, y] of [[3, 3], [4, 3], [3, 4], [4, 4]] as [number, number][]) {
    svg += diamond(at(x, y), "#3a2430", BAD, 'stroke-width="1.5"');
  }
  svg += label({ x: at(3, 3).x, y: at(3, 3).y - 22 }, "industry", 11, BAD, "middle");
  // a straight road running east–west across the panel…
  for (let tx = 1; tx <= 8; tx++) svg += roadRun(at(tx, 6), at(tx + 1, 6));
  // …and a curved one, which is not crossable at all
  svg += roadRun(at(8, 9), at(9, 9)) + roadRun(at(9, 9), at(9, 10));

  // the accepted drag: a railhead stub, straight through the road and on south
  svg += railRun(at(6, 2), at(6, 3));
  const preview = previewRailDrag(w, 1, { stone: 99 }, 6, 3, 6, 9);
  const tiles = preview.tiles;
  for (let i = 1; i < tiles.length; i++) svg += railRun(at(...tiles[i - 1]), at(...tiles[i]));
  for (const [x, y] of preview.crossings) {
    const c = at(x, y);
    svg += diamond(c, "none", CROSS, 'stroke-width="3"');
    svg += seg({ x: c.x + 16, y: c.y - 4 }, { x: c.x + 52, y: c.y - 30 }, CROSS, 1.5);
    svg += label({ x: c.x + 56, y: c.y - 30 }, "the only crossing allowed:", 11, CROSS);
    svg += label({ x: c.x + 56, y: c.y - 18 }, "straight through, perpendicular,", 10, DIM);
    svg += label({ x: c.x + 56, y: c.y - 7 }, "road bytes untouched", 10, DIM);
  }
  const notes = { x: at(1, 11).x + 10, y: at(1, 11).y + 14 };
  svg += label(notes, "rail drag: the four ground", 12, INK);
  svg += label({ x: notes.x, y: notes.y + 14 }, "neighbours, 1 Stone a tile,", 11, DIM);
  svg += label({ x: notes.x, y: notes.y + 27 }, "preview priced before the click", 11, DIM);

  // the refused shapes, each on the road tile it would have to touch
  const skew = at(2, 6), curve = at(9, 9);
  svg += cross(skew);
  svg += label({ x: skew.x - 96, y: skew.y + 46 }, "running ALONG the road?", 10, BAD);
  svg += cross(curve);
  svg += label({ x: curve.x + 6, y: curve.y + 34 }, railReasonText("road-curve") ?? "", 10, BAD, "middle");
  return svg;
}

// ── B: the platform, all four rotations ────────────────────────────────────
function panelPlatforms(): string {
  const panel = new Panel(0, 0, 12, 10);
  const at = (tx: number, ty: number) => panel.at(tx, ty);
  let svg = ground(panel);
  const origins: [number, number][] = [[0, 0], [7, 0], [0, 6], [7, 6]];
  ROTATIONS.forEach((rot, i) => {
    const [ox, oy] = origins[i];
    const lane = platformLaneTiles(ox, oy, rot);
    const strip = platformStripTiles(ox, oy, rot);
    for (const [x, y] of strip) svg += diamond(at(x, y), "#1d3350", STRIP, 'stroke-width="1.5"');
    for (const [x, y] of lane) svg += diamond(at(x, y), "#3a2c10", LANE, 'stroke-width="1.5"');
    for (let j = 1; j < lane.length; j++) svg += railRun(at(...lane[j - 1]), at(...lane[j]), LANE, 7);
    for (const { tile, dir } of platformPorts(ox, oy, rot)) svg += arrow(at(...tile), dir, 30);
    const cap = southOf(panel, platformTiles(ox, oy, rot));
    svg += label(cap, `rot ${rot}`, 13, INK);
    svg += label({ x: cap.x, y: cap.y + 13 }, "6 tiles · 3-tile lane · 2 ports", 10, DIM);
  });
  return svg;
}

// ── C: the depot, all four rotations ──────────────────────────────────────
function panelDepots(): string {
  const panel = new Panel(0, 0, 10, 9);
  const at = (tx: number, ty: number) => panel.at(tx, ty);
  let svg = ground(panel);
  const origins: [number, number][] = [[0, 0], [6, 0], [0, 5], [6, 5]];
  ROTATIONS.forEach((rot, i) => {
    const [ox, oy] = origins[i];
    for (const [x, y] of depotTiles(ox, oy, rot)) svg += diamond(at(x, y), "#2c1e38", DEPOT, 'stroke-width="1.5"');
    for (const [x, y] of depotPortTiles(ox, oy, rot)) svg += diamond(at(x, y), "#4a2f5c", LANE, 'stroke-width="1.5"');
    const port = depotPortTiles(ox, oy, rot)[0];
    svg += arrow(at(...port), depotPortDir(rot), 28);
    const cap = southOf(panel, depotTiles(ox, oy, rot));
    svg += label(cap, `rot ${rot}`, 13, INK);
    svg += label({ x: cap.x, y: cap.y + 13 }, "2×2 · one declared exit", 10, DIM);
  });
  return svg;
}

// ── D: the anchor rule ─────────────────────────────────────────────────────
function panelAnchors(industry: Industry): string {
  const panel = new Panel(0, 0, 15, 9);
  const at = (tx: number, ty: number) => panel.at(tx, ty);
  let svg = ground(panel);

  // the ring of tiles exactly 3 away from the industry's own footprint
  for (let ty = 0; ty <= 9; ty++) {
    for (let tx = 0; tx <= 15; tx++) {
      let best = Infinity;
      for (let y = industry.ty; y < industry.ty + industry.h; y++) {
        for (let x = industry.tx; x < industry.tx + industry.w; x++) {
          best = Math.min(best, Math.abs(x - tx) + Math.abs(y - ty));
        }
      }
      if (best === 3) svg += diamond(at(tx, ty), "none", DIM, 'stroke-dasharray="5 5" stroke-width="1.5" opacity="0.7"');
      if (best === 0) svg += diamond(at(tx, ty), "#3a2430", BAD, 'stroke-width="1.5"');
    }
  }
  svg += label({ x: at(industry.tx + 1, industry.ty).x, y: at(industry.tx, industry.ty).y - 32 },
    "industry", 12, BAD, "middle");

  // one platform inside the ring: the figure's legal anchor
  const ox = industry.tx + 4, oy = industry.ty, rot = 0 as const;
  const lane = platformLaneTiles(ox, oy, rot);
  const strip = platformStripTiles(ox, oy, rot);
  for (const [x, y] of strip) svg += diamond(at(x, y), "#1d3350", STRIP, 'stroke-width="1.5"');
  for (const [x, y] of lane) svg += diamond(at(x, y), "#3a2c10", LANE, 'stroke-width="1.5"');
  for (let j = 1; j < lane.length; j++) svg += railRun(at(...lane[j - 1]), at(...lane[j]), LANE, 6);
  for (const { tile, dir } of platformPorts(ox, oy, rot)) svg += arrow(at(...tile), dir, 24, OK);
  const c = at(ox, oy);
  svg += label({ x: c.x + 26, y: c.y + 2 }, "anchored: within 3 tiles, +1★", 12, OK);
  svg += label({ x: c.x + 26, y: c.y + 16 }, "one platform per owner per anchor", 10, DIM);

  // …and one outside it, which the rules refuse
  const fx = 11, fy = 1;
  for (const [x, y] of platformTiles(fx, fy, 0)) {
    svg += diamond(at(x, y), "none", BAD, 'stroke-dasharray="4 4" stroke-width="1.5"');
  }
  const f = at(fx, fy);
  svg += cross({ x: f.x + HW, y: f.y + HH * 2 });
  svg += label({ x: f.x, y: f.y + 2 * HH + 34 }, "no-anchor:", 12, BAD, "middle");
  svg += label({ x: f.x, y: f.y + 2 * HH + 47 }, "5 tiles from any industry or plant", 10, DIM, "middle");
  return svg;
}

// ── the figure ─────────────────────────────────────────────────────────────
export async function renderRailFigure(out: string): Promise<void> {
  const industry: Industry = { id: 0, type: "farm", tx: 3, ty: 3, w: 2, h: 2, output: 1, banditUntil: 0 };

  // A world the real rules accept: flat grass, one industry, one straight road.
  const terrain = new Uint8Array(144 * 144).fill(GRASS);
  const occupancy = new Int16Array(144 * 144).fill(-1);
  for (let y = industry.ty; y < industry.ty + industry.h; y++) {
    for (let x = industry.tx; x < industry.tx + industry.w; x++) occupancy[tIdx(x, y)] = 0;
  }
  const grid = { w: 144, h: 144, terrain, industries: [industry], towns: [], occupancy, seed: 1 };
  const track = createTrack();
  for (let tx = 1; tx <= 8; tx++) buildTile(track, "road", tx, 6, 1);
  const world: RailWorld = { rw: createRailway(), grid, track };

  // …with one real commit through the same functions the game will call, so the
  // picture cannot show a crossing the rules would have refused.
  const preview = previewRailDrag(world, 1, { stone: 99 }, 6, 3, 6, 9);
  const commit = commitRailDrag(world, 1, preview);
  if (!commit.ok) throw new Error(`figure world refuses its own drag: ${commit.code}`);

  const panels = [panelCrossing(world), panelPlatforms(), panelDepots(), panelAnchors(industry)];
  const W = 1660, H = 1030, PAD = 26, TITLE = 62;
  const boxW = (W - PAD * 3) / 2, boxH = (H - TITLE - PAD * 3) / 2;
  const titles = [
    "A · the four-neighbour drag, and the only crossing the rules allow",
    "B · Rail Platform, all four rotations (lane, strip, two ports)",
    "C · Train Depot, all four rotations (one declared exit)",
    "D · the anchor rule: an industry or your own plant, ≤ 3 tiles, one each",
  ];
  let body = "";
  panels.forEach((svg, i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x = PAD + col * (boxW + PAD), y = TITLE + row * (boxH + PAD);
    body += `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="10" fill="${PANEL}" stroke="#232a34"/>`;
    body += label({ x: x + 14, y: y + 22 }, titles[i], 13, INK);
    body += `<g transform="translate(${x + 14}, ${y + 34})">${svg}</g>`;
  });

  const legend: [string, string][] = [
    ["rail tile (1 Stone)", RAIL],
    ["platform lane (track included)", LANE],
    ["platform strip", STRIP],
    ["depot / its exit edge", DEPOT],
    ["road, untouched by the crossing", ROAD_CORE],
    ["port: the way a train leaves", OK],
    ["refused", BAD],
  ];
  let lx = PAD + 4;
  for (const [text, color] of legend) {
    body += `<rect x="${lx}" y="${H - 26}" width="14" height="14" rx="3" fill="${color}"/>`;
    body += label({ x: lx + 20, y: H - 14 }, text, 12, DIM);
    lx += 34 + text.length * 6.5;
  }
  body += label({ x: PAD, y: 34 }, "RAIL-02 (#176) — rail placement: the geometry the rules run on", 21, INK);
  body += label({ x: PAD, y: 51 }, "drawn from the module's own footprint functions (src/iso/railway) and rasterised with sharp — no browser",
    12, DIM);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + `<rect width="${W}" height="${H}" fill="${BG}"/>${body}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(out);
}
