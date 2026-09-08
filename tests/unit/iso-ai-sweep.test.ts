import { describe, it, expect } from "vitest";
import { aiBuildStep, chooseRivalFactorySpot, planCandidates, planFeasibility } from "../../src/iso/ai";
import { FREE_SETUP_DEPOTS } from "../../src/iso/construction";
import { createTrack, canBuildOn, tIdx } from "../../src/iso/track";
import { isServiced, type EconomyState, type Factory } from "../../src/iso/economy";
import { generateMap, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { canReachASpot, rivalSearchTiles } from "./helpers/rival-map";

// W8/T4: cheap structural reachability covers the full even-step search
// space; expensive real planning uses a bounded, deterministic spatial sample.
// With 25 industries spread over 144×144, not every legal tile can reach one
// on the opening 12 wood + 12 stone + 12 free road tiles. The structural build sweep
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
    // PP-07: road costs Wood and the Depot costs Grain as well, so both join
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
  it("seed 1337: the full search space has no road-buildable enclaves", () => {
    const grid = generateMap(1337);
    const enclaves = rivalSearchTiles(grid).filter(([x, y]) => !canReachASpot(grid, x, y));
    expect(enclaves).toEqual([]);
  });

  it("seed 1337: four turns from sampled non-enclaves build with sufficient road funds", () => {
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
  it("no plan crosses ground its own transport kind cannot be laid on", () => {
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
            const feas = planFeasibility(eco, c.kind, c.path, c.hx, c.hy, f.ownerId);
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
  it("every player placement yields a rail-legal, reachable rival tile", () => {
    const grid = generateMap(1337);
    const opts = { purse: { wood: 12, stone: 12, ore: 0 }, free: 12, ownerId: 2 };
    let checked = 0;
    // Placement uses the real opening purse, unlike the funded route sweep.
    for (let y = 2; y < MAP_H - 2; y += SAMPLE_STEP) {
      for (let x = 2; x < MAP_W - 2; x += SAMPLE_STEP) {
        if (!canBuildOn(grid, "road", x, y)) continue;
        const spot = chooseRivalFactorySpot(grid, createTrack(), [x, y], opts);
        expect(spot, `player at ${x},${y}`).toBeTruthy();
        // two factories never share a tile — and the player's tile IS in this
        // search space, so the explicit exclusion is what keeps them apart
        // (distance is only the second sort key now that rail-legality leads).
        expect(spot, `rival on the player's own tile ${x},${y}`).not.toEqual([x, y]);
        expect(canBuildOn(grid, "rail", spot![0], spot![1]), `rail illegal at ${spot}`).toBe(true);
        expect(canReachASpot(grid, spot![0], spot![1]), `enclave at ${spot}`).toBe(true);
        const f: Factory = { owner: "ai", ownerId: 2, tx: spot![0], ty: spot![1] };
        const eco: EconomyState = { grid, track: createTrack(), factories: [f], harvesters: [] };
        const first = aiBuildStep(eco, f, rivalOpts(), 1);
        expect(first?.harvester, `unaffordable first turn for player ${x},${y}`).toBeTruthy();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
    // The ticket's repro: a player factory at (23,22) used to hand the rival
    // the rough (2,2) enclave. On this map (2,2) is water and can
    // never be committed anyway; keep the guard so a future ranking change
    // cannot regress onto that tile.
    const spot = chooseRivalFactorySpot(grid, createTrack(), [23, 22], opts);
    expect(tIdx(spot![0], spot![1])).not.toBe(tIdx(2, 2));
  }, 15_000);
});
