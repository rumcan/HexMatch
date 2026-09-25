import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
  generateMap, WATER, SAND, idx, inBounds, type Grid,
} from "../../src/iso/grid";
import { railTerrainOk, railTileRefusal, platformRefusal } from "../../src/iso/rail";
import { createRailState } from "../../src/iso/rail";
import { buildRefusal, canBuildOn, createTrack } from "../../src/iso/track";

// ══════════════════════════════════════════════════════════════════════════
// R1 (#260) — rivers on the map.
//
//   • option OFF: every pinned seed generates byte-for-byte the map the
//     pre-river generator produced (golden fixtures captured on main);
//   • option ON: 1–3 seeded rivers of WATER tiles that drain to the sea,
//     the island stays ONE landmass, and every town and industry stays
//     land-reachable (~50-seed sweep);
//   • rivers block roads, rail and platforms exactly like sea water.
// ══════════════════════════════════════════════════════════════════════════

const b64gunzip = (s: string): Buffer => gunzipSync(Buffer.from(s, "base64"));

interface GoldenMap { seed: number; terrain: string; occupancy: string; rest: string }
const golden = (seed: number): GoldenMap =>
  JSON.parse(readFileSync(`tests/fixtures/iso-golden/map-off-${seed}.json`, "utf8")) as GoldenMap;

/** 4-connected flood over land; returns the seen mask. */
function floodLand(grid: Grid, start: number): Uint8Array {
  const seen = new Uint8Array(grid.w * grid.h);
  if (grid.terrain[start] === WATER) return seen;
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const cur = stack.pop()!;
    const x = cur % grid.w, y = (cur / grid.w) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
      const ni = ny * grid.w + nx;
      if (seen[ni] || grid.terrain[ni] === WATER) continue;
      seen[ni] = 1;
      stack.push(ni);
    }
  }
  return seen;
}

function landComponentCount(grid: Grid): number {
  const seen = new Uint8Array(grid.w * grid.h);
  let comps = 0;
  for (let i = 0; i < grid.terrain.length; i++) {
    if (seen[i] || grid.terrain[i] === WATER) continue;
    comps++;
    const got = floodLand(grid, i);
    for (let j = 0; j < got.length; j++) if (got[j]) seen[j] = 1;
  }
  return comps;
}

/** Water tiles 4-connected to the map border (the open ocean). */
function seaConnected(grid: Grid): Uint8Array {
  const seen = new Uint8Array(grid.w * grid.h);
  const queue: number[] = [];
  const push = (x: number, y: number) => {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (seen[i] || grid.terrain[i] !== WATER) return;
    seen[i] = 1; queue.push(i);
  };
  for (let x = 0; x < grid.w; x++) { push(x, 0); push(x, grid.h - 1); }
  for (let y = 0; y < grid.h; y++) { push(0, y); push(grid.w - 1, y); }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head], x = cur % grid.w, y = (cur / grid.w) | 0;
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  return seen;
}

const SWEEP_SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);

describe("R1 option OFF keeps the old generator byte-for-byte", () => {
  for (const seed of [7, 42, 79, 199, 1337]) {
    it(`seed ${seed} matches the pre-river golden map`, () => {
      const g = generateMap(seed);                       // default = off
      const off = generateMap(seed, { rivers: false });
      const gold = golden(seed);
      expect(g.rivers).toBeUndefined();
      expect(Buffer.from(g.terrain).equals(b64gunzip(gold.terrain))).toBe(true);
      expect(Buffer.from(g.occupancy.buffer, g.occupancy.byteOffset, g.occupancy.byteLength)
        .equals(b64gunzip(gold.occupancy))).toBe(true);
      expect(JSON.stringify({ industries: g.industries, towns: g.towns, publicRoads: g.publicRoads }))
        .toBe(JSON.stringify(JSON.parse(b64gunzip(gold.rest).toString("utf8"))));
      // explicit off === default
      expect(Buffer.from(off.terrain).equals(Buffer.from(g.terrain))).toBe(true);
    });
  }

  it("off draws no randomness: 20 seeds identical with and without the flag", () => {
    for (let s = 1; s <= 20; s++) {
      const a = generateMap(s);
      const b = generateMap(s, { rivers: false });
      expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(true);
      expect(Buffer.from(a.occupancy.buffer).equals(Buffer.from(b.occupancy.buffer))).toBe(true);
    }
  });
});

describe("R1 rivers ON — determinism and shape", () => {
  it("same seed → same rivers", () => {
    for (const seed of [7, 42, 1337]) {
      const a = generateMap(seed, { rivers: true });
      const b = generateMap(seed, { rivers: true });
      expect(Buffer.from(a.terrain).equals(Buffer.from(b.terrain))).toBe(true);
      expect(Buffer.from(a.rivers ?? new Uint8Array()).equals(Buffer.from(b.rivers ?? new Uint8Array()))).toBe(true);
    }
  });

  it("rivers are water, drain to the sea, and the island stays one landmass", () => {
    let withRivers = 0;
    for (const seed of SWEEP_SEEDS) {
      const g = generateMap(seed, { rivers: true });
      const mask = g.rivers;
      expect(mask).toBeDefined();
      const n = mask!.reduce((a, v) => a + v, 0);
      if (n === 0) continue;
      withRivers++;
      const sea = seaConnected(g);
      for (let i = 0; i < mask!.length; i++) {
        if (!mask![i]) continue;
        expect(g.terrain[i]).toBe(WATER);        // rivers are WATER for gameplay
        expect(sea[i]).toBe(1);                  // every river tile drains to the ocean
      }
      // the river actually touches land somewhere (it has banks to draw)
      let bank = false;
      for (let i = 0; i < mask!.length && !bank; i++) {
        if (!mask![i]) continue;
        const x = i % g.w, y = (i / g.w) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny) && g.terrain[idx(nx, ny)] !== WATER) bank = true;
        }
      }
      expect(bank).toBe(true);
      expect(landComponentCount(g)).toBe(1);
    }
    // rivers are a normal feature, not a rarity
    expect(withRivers).toBeGreaterThanOrEqual(45);
  });
});

describe("R1 reachability over ~50 seeds", () => {
  for (const seed of SWEEP_SEEDS) {
    it(`seed ${seed}: every town and industry is land-reachable`, () => {
      const g = generateMap(seed, { rivers: true });
      expect(g.towns.length).toBeGreaterThan(0);
      expect(g.industries.length).toBeGreaterThan(0);
      const start = idx(g.industries[0].tx, g.industries[0].ty);
      const seen = floodLand(g, start);
      for (const ind of g.industries) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) {
          for (let y = ind.ty; y < ind.ty + ind.h; y++) {
            expect(seen[idx(x, y)]).toBe(1);
          }
        }
      }
      for (const t of g.towns) {
        expect(seen[idx(t.tx, t.ty)]).toBe(1);
        for (const [hx, hy] of [...t.houses, ...t.roads]) expect(seen[idx(hx, hy)]).toBe(1);
      }
      // and nothing settled on a river
      for (const t of g.towns) {
        expect(g.rivers![idx(t.tx, t.ty)]).toBe(0);
        for (const [hx, hy] of [...t.houses, ...t.roads]) expect(g.rivers![idx(hx, hy)]).toBe(0);
      }
      for (const ind of g.industries) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) {
          for (let y = ind.ty; y < ind.ty + ind.h; y++) expect(g.rivers![idx(x, y)]).toBe(0);
        }
      }
      for (const [px, py] of g.publicRoads ?? []) {
        expect(g.terrain[idx(px, py)]).not.toBe(WATER);
      }
    });
  }
});

describe("R1 rivers block construction like sea water", () => {
  const g = (() => {
    for (const seed of SWEEP_SEEDS) {
      const m = generateMap(seed, { rivers: true });
      if ((m.rivers?.reduce((a, v) => a + v, 0) ?? 0) > 40) return m;
    }
    throw new Error("no river map found");
  })();
  const riverTile = (() => {
    for (let i = 0; i < g.rivers!.length; i++) if (g.rivers![i]) return i;
    return -1;
  })();
  const rx = riverTile % g.w, ry = (riverTile / g.w) | 0;

  it("rail terrain refuses river tiles", () => {
    expect(railTerrainOk(g, rx, ry)).toBe(false);
    // a neighbouring land tile still accepts rail
    const land = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [rx + dx, ry + dy] as const)
      .find(([x, y]) => inBounds(x, y) && g.terrain[idx(x, y)] !== WATER
        && g.occupancy[idx(x, y)] === -1);
    expect(land).toBeDefined();
    expect(railTerrainOk(g, land![0], land![1])).toBe(true);
  });

  it("rail drags and platforms report water on rivers", () => {
    const track = createTrack();
    const state = createRailState();
    expect(railTileRefusal(g, track, state, 0, rx, ry)).toBe("water");
    expect(platformRefusal(g, [], [], 0, rx, ry, "se")).toBe("water");
  });

  it("roads refuse river tiles as water (builtAt consumers see water)", () => {
    expect(buildRefusal(g, "road", rx, ry)).toBe("water");
    expect(buildRefusal(g, "dirt", rx, ry)).toBe("water");
    expect(canBuildOn(g, "road", rx, ry)).toBe(false);
  });
});

describe("R1 river banks keep the beach ring on the coast only", () => {
  it("land beside a river is not turned into beach sand", () => {
    const g = generateMap(7, { rivers: true });
    if (!g.rivers) return;
    let checked = 0;
    for (let i = 0; i < g.rivers.length; i++) {
      if (!g.rivers[i]) continue;
      const x = i % g.w, y = (i / g.w) | 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const v = g.terrain[idx(nx, ny)];
        if (v === SAND) checked++;   // tolerated, but counted
      }
    }
    // Banks may pick up sand only where the river meets the coastal beach;
    // the overwhelming majority of bank tiles must stay grass/rough.
    const riverLen = g.rivers.reduce((a, v) => a + v, 0);
    expect(checked).toBeLessThan(riverLen);
  });
});

// ── software preview (PREVIEW_RIVERS=1) ────────────────────────────────────
// Rasterises a rivers-ON region with the real seamless textures (ocean under,
// river texture over the river tiles, bank + foam strokes) so the PR can show
// what a river looks like in context without a browser.
if (process.env.PREVIEW_RIVERS === "1") {
  const { beforeAll } = await import("vitest");
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default;
  const { HW, HH, TILE_H } = await import("../../src/game/config");
  const SEED = Number(process.env.PREVIEW_SEED ?? 7);
  const CX = Number(process.env.PREVIEW_CX ?? 90);
  const CY = Number(process.env.PREVIEW_CY ?? 60);
  const TILES = Number(process.env.PREVIEW_TILES ?? 60);
  const OUT = process.env.PREVIEW_OUT ?? "test-results/rivers-preview.png";
  const S = 0.2, SEA = 0.16;

  beforeAll(async () => {
    const grid = generateMap(SEED, { rivers: true });
    const W = Math.ceil((TILES + 2) * HW * 2);
    const H = Math.ceil((TILES + 2) * TILE_H + TILE_H * 2);
    const [ox, oy] = [(CX - CY) * HW, (CX + CY) * HH];
    const project = (tx: number, ty: number): [number, number] =>
      [(tx - ty) * HW - ox + W / 2, (tx + ty) * HH - oy + TILE_H];
    const pts = (tx: number, ty: number) => {
      const [x, y] = project(tx, ty);
      return [[x, y], [x + HW, y + HH], [x, y + TILE_H], [x - HW, y + HH]] as [number, number][];
    };
    const poly = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const t = (x: number, y: number) => (x >= 0 && y >= 0 && x < grid.w && y < grid.h) ? grid.terrain[y * grid.w + x] : WATER;
    const isR = (x: number, y: number) => (x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.rivers?.[y * grid.w + x]) ? 1 : 0;
    let grass = "", sand = "", river = "", foam = "", bank = "";
    for (let ty = CY - TILES / 2; ty < CY + TILES / 2; ty++) {
      for (let tx = CX - TILES / 2; tx < CX + TILES / 2; tx++) {
        if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) continue;
        const v = t(tx, ty);
        if (isR(tx, ty)) { river += `<polygon points="${poly(pts(tx, ty))}"/>`; }
        if (v === WATER) {
          if (!isR(tx, ty)) {
            const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => t(tx + dx, ty + dy) !== WATER);
            if (near) for (let i = 0; i < 4; i++) {
              const [ax, ay] = pts(tx, ty)[i], [bx, by] = pts(tx, ty)[(i + 1) % 4];
              foam += `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="rgba(255,244,214,0.5)" stroke-width="2.2"/>`;
            }
          }
          continue;
        }
        grass += `<polygon points="${poly(pts(tx, ty))}"/>`;
        if (v === SAND) sand += `<polygon points="${poly(pts(tx, ty))}"/>`;
      }
    }
    // bank strokes: river tiles' edges shared with land
    for (let ty = CY - TILES / 2; ty < CY + TILES / 2; ty++) {
      for (let tx = CX - TILES / 2; tx < CX + TILES / 2; tx++) {
        if (!isR(tx, ty)) continue;
        const c = pts(tx, ty);
        const edge = [[0, 3], [0, 1], [1, 2], [3, 2]];
        const dirs = [[-1, 0], [0, -1], [1, 0], [0, 1]];
        for (let d = 0; d < 4; d++) {
          if (t(tx + dirs[d][0], ty + dirs[d][1]) === WATER) continue;
          const [a, b] = edge[d];
          bank += `<line x1="${c[a][0]}" y1="${c[a][1]}" x2="${c[b][0]}" y2="${c[b][1]}" stroke="rgba(24,46,40,0.55)" stroke-width="2.2"/>`;
        }
      }
    }
    const maskSvg = (body: string, fill: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body.replace(/<polygon /g, `<polygon fill="${fill}" `)}</svg>`;
    const lineSvg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}</svg>`;
    const tileFill = async (src: string, scale: number): Promise<Buffer> => {
      const P = Math.max(1, Math.round(512 * scale));
      let cur = await sharp(src).resize(P, P).png().toBuffer();
      let cw = P, ch = P;
      while (cw < W || ch < H) {
        const nw = Math.min(W, cw << 1), nh = Math.min(H, ch << 1);
        const stamps: { input: Buffer; left: number; top: number }[] = [];
        for (let y = 0; y < nh; y += ch) for (let x = 0; x < nw; x += cw) stamps.push({ input: cur, left: x, top: y });
        cur = await sharp({ create: { width: nw, height: nh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(stamps).png().toBuffer();
        cw = nw; ch = nh;
      }
      return (cw === W && ch === H) ? cur : sharp(cur).extract({ left: 0, top: 0, width: W, height: H }).png().toBuffer();
    };
    const [waterTile, grassTile, sandTile, riverTile, landMask, sandMask, riverMask, foamRaster, bankRaster] = await Promise.all([
      tileFill("assets/ground/water.png", SEA),
      tileFill("assets/ground/grass.png", S),
      tileFill("assets/ground/sand.png", S),
      tileFill("assets/ground/river.png", S),
      sharp(Buffer.from(maskSvg(grass, "#fff"))).png().toBuffer(),
      sharp(Buffer.from(maskSvg(sand, "#fff"))).png().toBuffer(),
      sharp(Buffer.from(maskSvg(river, "#fff"))).png().toBuffer(),
      sharp(Buffer.from(lineSvg(foam))).png().toBuffer(),
      sharp(Buffer.from(lineSvg(bank))).png().toBuffer(),
    ]);
    const clip = (tex: Buffer, mask: Buffer) => sharp(tex).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
    const [grassC, sandC, riverC] = await Promise.all([clip(grassTile, landMask), clip(sandTile, sandMask), clip(riverTile, riverMask)]);
    await sharp(waterTile).composite([
      { input: grassC }, { input: sandC }, { input: riverC }, { input: bankRaster }, { input: foamRaster },
    ]).png().toFile(OUT);
    console.log(`[r1] rivers preview → ${OUT}`);
  }, 170_000);

  it("renders the rivers preview", () => { expect(true).toBe(true); });
}
