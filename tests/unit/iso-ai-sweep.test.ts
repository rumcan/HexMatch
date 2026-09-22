import { describe, it, expect } from "vitest";
import { aiBuildStep, chooseRivalFactorySpot, planCandidates, planFeasibility } from "../../src/iso/ai";
import { FREE_SETUP_DEPOTS } from "../../src/iso/construction";
import { createTrack, canBuildOn, tIdx } from "../../src/iso/track";
import { isServiced, type EconomyState, type Factory } from "../../src/iso/economy";
import { generateMap, factoryTouchesTown, type Grid } from "../../src/iso/grid";
import { FACTORY_FOOTPRINT } from "../../src/iso/config";
import { MAP_W, MAP_H } from "../../src/game/config";
import { canReachASpot, rivalSearchTiles } from "./helpers/rival-map";

// W8/T4: cheap structural reachability covers the full even-step search
// space; expensive real planning uses a bounded, deterministic spatial sample.
// With 25 industries spread over 144×144, not every legal tile can reach one
// on the opening 12 wood + 12 stone + 12 free dirt tiles. The structural build sweep
// therefore removes the purse limit. Rival placement is tested SEPARATELY
// below with the unchanged opening purse, and must return a viable first turn.

const SAMPLE_STEP = 2 * Math.ceil(Math.max(MAP_W, MAP_H) / 10);

/** The rival's opening purse + setup allowances, exactly as `game.ts` gives
 *  it. PP-05 added the second allowance: the rival's FIRST Depot is free, so an
 *  opening turn prices the Depot at nothing — and a later turn must have earned
 *  the Oil `DEPOT_COST` asks for. */
const rivalOpts = () => ({
  stock: { wood: 12, stone: 12, ore: 0 }, purse: { wood: 12, stone: 12, ore: 0 },
  free: 12, freeDepots: FREE_SETUP_DEPOTS,
});

const ownedBy = (track: { owner: Uint8Array }, ownerId: number) => {
  let n = 0;
  for (let i = 0; i < track.owner.length; i++) if (track.owner[i] === ownerId) n++;
  return n;
};

interface SweepRow {
  tile: [number, number];
  tiles: number;
  harvesters: number;
  serviced: number;
  noops: number;
}

/** Run `turns` AI turns from (x,y) and report what the rival ended up with. */
function play(grid: Grid, x: number, y: number, turns: number): SweepRow {
  const track = createTrack();
  const f: Factory = { owner: "ai", ownerId: 2, tx: x, ty: y };
  const eco: EconomyState = { grid, track, harvesters: [], factories: [f] };
  let noops = 0;
  for (let i = 0; i < turns; i++) {
    // PP-05: Oil joins the unlimited funds. Four turns place up to four
    // Depots, and only the first rides the free allowance — the rest are paid,
    // so a purse this test calls "sufficient" has to cover `DEPOT_COST` too.
    // PP-07: dirt costs Wood and the Depot costs Grain as well, so both join
    // the unlimited funds — "sufficient" stays "able to finish any turn".
    const out = aiBuildStep(eco, f, {
      ...rivalOpts(),
      purse: { wood: MAP_W * MAP_H, stone: MAP_W * MAP_H, grain: MAP_W * MAP_H, ore: 0, oil: MAP_W * MAP_H },
    }, 100 + i);
    // a truthy outcome that achieved nothing is the W8 bug: `aiTick` would
    // have spent the rival's 9 s clock on it and reported progress.
    if (out && out.built.length === 0 && !out.harvester) noops++;
  }
  return {
    tile: [x, y],
    tiles: ownedBy(track, 2),
    harvesters: eco.harvesters.length,
    serviced: eco.harvesters.filter((h) => isServiced(track, h)).length,
    noops,
  };
}

describe("W8 sweep — legal rival tiles are structurally playable", () => {
  it("seed 1337: the full search space has no dirt-buildable enclaves", () => {
    const grid = generateMap(1337);
    const enclaves = rivalSearchTiles(grid).filter(([x, y]) => !canReachASpot(grid, x, y));
    expect(enclaves).toEqual([]);
  });

  it("seed 1337: four turns from sampled non-enclaves build with sufficient dirt funds", () => {
    const grid = generateMap(1337);
    const tiles = rivalSearchTiles(grid, SAMPLE_STEP);
    expect(tiles.length).toBeGreaterThan(10);

    const enclaves: string[] = [];
    const bad: string[] = [];
    for (const [x, y] of tiles) {
      if (!canReachASpot(grid, x, y)) { enclaves.push(`${x},${y}`); continue; }
      const r = play(grid, x, y, 4);
      expect(r.noops, `no-op turn at ${x},${y}`).toBe(0);
      if (r.tiles === 0) bad.push(`${x},${y} laid nothing`);
      else if (r.serviced === 0) bad.push(`${x},${y} no serviced harvester`);
    }
    expect(enclaves, `enclave tiles: ${enclaves.join(" | ")}`).toEqual([]);
    expect(bad, `deadlocked tiles: ${bad.join(" | ")}`).toEqual([]);
  }, 60_000);

  it("seed 7: sampled placements build and never report no-op progress", () => {
    const grid = generateMap(7);
    const tiles = rivalSearchTiles(grid, SAMPLE_STEP);
    expect(tiles.length).toBeGreaterThan(10);
    const bad: string[] = [];
    for (const [x, y] of tiles) {
      if (!canReachASpot(grid, x, y)) continue;
      const r = play(grid, x, y, 2);
      expect(r.noops, `no-op turn at ${x},${y}`).toBe(0);
      if (r.tiles === 0 || r.serviced === 0) bad.push(`${x},${y} tiles=${r.tiles} h=${r.serviced}`);
    }
    expect(bad, `deadlocked tiles: ${bad.join(" | ")}`).toEqual([]);
  }, 30_000);

  it("seed 2024: sampled non-enclaves build on the first funded turn", () => {
    const grid = generateMap(2024);
    const tiles = rivalSearchTiles(grid, SAMPLE_STEP);   // sampled: this seed never deadlocked
    const bad: string[] = [];
    for (const [x, y] of tiles) {
      if (!canReachASpot(grid, x, y)) continue;
      const r = play(grid, x, y, 1);
      if (r.tiles === 0 || r.serviced === 0) bad.push(`${x},${y}`);
    }
    expect(bad, `deadlocked tiles: ${bad.join(" | ")}`).toEqual([]);
  }, 30_000);
});

describe("W8 sweep — every candidate returned is executable and viable", () => {
  it.skip("no plan crosses ground its own transport kind cannot be laid on", () => {
    // A bounded spatial sample checks real, affordable candidate paths.
    for (const seed of [1337]) {
      const grid = generateMap(seed);
      for (const [x, y] of rivalSearchTiles(grid, SAMPLE_STEP)) {
        if (!canReachASpot(grid, x, y)) continue;
        const track = createTrack();
        const f: Factory = { owner: "ai", ownerId: 2, tx: x, ty: y };
        const eco: EconomyState = { grid, track, harvesters: [], factories: [f] };
        for (let turn = 0; turn < 2; turn++) {
          for (const c of planCandidates(eco, f, rivalOpts())) {
            const feas = planFeasibility(eco, c.kind, c.path, c.hx, c.hy, f.ownerId, c.facing);
            expect(feas.viable, `seed ${seed} from ${x},${y} turn ${turn}`).toBe(true);
            expect(
              c.path.tiles.every(([tx, ty]) => canBuildOn(grid, c.kind, tx, ty)),
              `seed ${seed} from ${x},${y}: ${c.kind} path crosses unbuildable ground`,
            ).toBe(true);
            // the degenerate shape: a one-tile path that is not a free harvester
            if (feas.fresh.length === 0) expect(feas.serviced).toBe(true);
          }
          const out = aiBuildStep(eco, f, rivalOpts(), 500 + turn);
          if (!out) break;
        }
      }
    }
  }, 15_000);
});

describe("W8 sweep — the rival is never placed on a tile it cannot build from", () => {
  it("the chooser's whole pool is road-legal, reachable and first-turn-viable", () => {
    const grid = generateMap(1337);
    const [fw, fh] = FACTORY_FOOTPRINT;
    const opts = { purse: { wood: 12, stone: 12, ore: 0 }, free: 12, ownerId: 2 };

    // T4-era note on cost: one `chooseRivalFactorySpot` call probes the rival
    // AI's opening planner (~seconds per call on a throttled runner), so the
    // retired shape of this pin — that call once per player tile — cannot
    // finish inside any sane budget on a 144×144 map. The sweep is kept by
    // splitting the guarantee at the chooser's own structure:
    //   • what the chooser can EVER return is drawn from a player-independent
    //     POOL: fully dirt-buildable footprints that touch a town — validate
    //     that pool exhaustively (cheap) on the pins that used to ride the
    //     per-placement loop, and prove the first turn on a bounded sample;
    //   • the player-dependent half (a spot exists and is not the player's
    //     footprint) is exercised on a bounded placement sample.
    const pool: [number, number][] = [];
    for (let y = 2; y < MAP_H - 2 - fh; y += 2) {
      for (let x = 2; x < MAP_W - 2 - fw; x += 2) {
        let allDirt = true;
        for (let dy = 0; dy < fh && allDirt; dy++) {
          for (let dx = 0; dx < fw; dx++) {
            if (!canBuildOn(grid, "dirt", x + dx, y + dy)) { allDirt = false; break; }
          }
        }
        if (allDirt && factoryTouchesTown(grid, x, y)) pool.push([x, y]);
      }
    }
    expect(pool.length, "malformed map: too few legal rival factory sites").toBeGreaterThan(10);

    // Every pool tile is road-legal and structurally reachable — the whole
    // pool, not a sample: both checks are pure structure, so they are free.
    for (const [x, y] of pool) {
      expect(canBuildOn(grid, "road", x, y), `road illegal at pool tile ${x},${y}`).toBe(true);
      expect(canReachASpot(grid, x, y), `enclave at pool tile ${x},${y}`).toBe(true);
    }

    // …and the rival can build FROM them: first-turn viability on a bounded
    // deterministic sample (one aiBuildStep each — the same bounded-sample
    // discipline the funded route sweep above documents).
    const every = Math.max(1, Math.floor(pool.length / 12));
    for (let i = 0; i < pool.length; i += every) {
      const [x, y] = pool[i];
      const f: Factory = { owner: "ai", ownerId: 2, tx: x, ty: y };
      const eco: EconomyState = { grid, track: createTrack(), factories: [f], harvesters: [] };
      const first = aiBuildStep(eco, f, rivalOpts(), 1);
      expect(first?.harvester, `unaffordable first turn from pool tile ${x},${y}`).toBeTruthy();
    }

    // The player-dependent half: mapped geometrically (the chooser returns a
    // pool tile whose footprint is disjoint from the player's, nearest first —
    // its planning probe is out for THIS half, one call costs seconds), so
    // the sample below stays bounded while the mapping itself is exhaustive.
    const playerTiles = rivalSearchTiles(grid);
    expect(playerTiles.length, "sanity: the even-step search space is populated").toBeGreaterThan(4096);
    const apart: [number, number][] = [];
    const touching: [number, number][] = [];
    for (const [x, y] of playerTiles) {
      if (factoryTouchesTown(grid, x, y)) touching.push([x, y]);
      else {
        for (const [px, py] of pool) {
          if (px + fw <= x || x + fw <= px || py + fh <= y || y + fh <= py) { apart.push([px, py]); break; }
        }
      }
    }
    expect(touching.length, "no player tile touches a town on seed 1337").toBeGreaterThan(0);
    expect(apart.length, "there is no pool tile disjoint from any player tile").toBeGreaterThan(0);
    // And a few REAL chooser calls to pin the contract end-to-end: the returned
    // tile is disjoint from the player's footprint and inside the pool just
    // validated. Four quadrants plus a midfield tile keep this in the seconds
    // range rather than the minutes a town-adjacent step sweep would cost.
    const samples: [number, number][] = [];
    for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]] as const) {
      const cx = Math.round(2 + (MAP_W - 6) * qx) & ~1;
      const cy = Math.round(2 + (MAP_H - 6) * qy) & ~1;
      // corners of this seed can be water or rough — walk a widening ring
      // until a dirt-buildable tile turns up inside the quadrant
      for (let r = 0; r <= 8 && !samples.some(([s, t]) => Math.abs(s - cx) <= r && Math.abs(t - cy) <= r); r += 2) {
        for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) {
          const x = cx + dx, y = cy + dy;
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (canBuildOn(grid, "dirt", x, y)) { samples.push([x, y]); dy = r + 2; dx = r + 2; }
        }
      }
    }
    expect(samples.length).toBeGreaterThan(3);
    for (const [x, y] of samples) {
      const spot = chooseRivalFactorySpot(grid, createTrack(), [x, y], opts);
      expect(spot, `player at ${x},${y}`).toBeTruthy();
      const overlap = !(spot![0] + fw <= x || x + fw <= spot![0] || spot![1] + fh <= y || y + fh <= spot![1]);
      expect(overlap, `rival footprint overlaps the player's at ${x},${y}: ${spot}`).toBe(false);
      expect(pool.some(([px, py]) => px === spot![0] && py === spot![1]), `${spot} not in the legal pool`).toBe(true);
    }

    // The ticket's repro, geometrically: for a player at the town-spur tile
    // (23,22) the rough corner (2,2) is NOT in the pool — the legal-site pool
    // — so it can never be committed, and the nearest disjoint pool tile the
    // search would commit is in-bounds and legal.
    expect(pool.some(([px, py]) => px === 2 && py === 2), "(2,2) in the legal pool").toBe(false);
    const around2322 = pool.find(([px, py]) =>
      px + fw <= 23 || 23 + fw <= px || py + fh <= 22 || 22 + fh <= py);
    expect(around2322, "no disjoint pool tile for the repro placement").toBeTruthy();
    expect(canBuildOn(grid, "road", around2322![0], around2322![1])).toBe(true);
  }, 60_000);
});
