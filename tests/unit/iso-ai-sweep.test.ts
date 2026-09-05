import { describe, it, expect } from "vitest";
import { aiBuildStep, chooseRivalFactorySpot, planCandidates, planFeasibility } from "../../src/iso/ai";
import { createTrack, canBuildOn, tIdx } from "../../src/iso/track";
import { isServiced, type EconomyState, type Factory } from "../../src/iso/economy";
import { generateMap, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { canReachASpot, rivalSearchTiles } from "./helpers/rival-map";

// ══════════════════════════════════════════════════════════════════════════
// W8 — the whole-map sweep: EVERY legal rival tile must be playable.
//
// The ticket measured the deadlock over the same search space `game.ts` uses
// (even tile steps) and found the rival building 0 tiles on 51/160 placements
// at seed 1337 and 37/157 at seed 7. This is the regression guard: four AI
// turns from any tile that can physically support a build must lay track and
// land a serviced harvester.
//
// Tiles that CANNOT are enclaves — water and industry footprints wall them in
// (seed 1337's (2,2) is rough, with water on three sides and the oil_rig at
// (2,3) on the fourth). No planning change can build from those, so they are
// excluded here and refused by `chooseRivalFactorySpot` below.
//
// Slow by nature (a real map × a real A* per tile), which is why it lives in
// its own file rather than in `iso-ai.test.ts`.
// ══════════════════════════════════════════════════════════════════════════

/** The rival's opening purse + setup allowance, exactly as `game.ts` gives it. */
const rivalOpts = () => ({ stock: { stone: 12, ore: 0 }, purse: { stone: 12, ore: 0 }, free: 12 });

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
    const out = aiBuildStep(eco, f, rivalOpts(), 100 + i);
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

describe("W8 sweep — every legal rival tile is playable", () => {
  it("seed 1337: four turns from any non-enclave tile lay track and land a harvester", () => {
    const grid = generateMap(1337);
    const tiles = rivalSearchTiles(grid);
    expect(tiles.length).toBeGreaterThan(100);       // the ticket counted 160

    let enclaves = 0;
    const bad: string[] = [];
    for (const [x, y] of tiles) {
      if (!canReachASpot(grid, x, y)) { enclaves++; continue; }
      const r = play(grid, x, y, 4);
      expect(r.noops, `no-op turn at ${x},${y}`).toBe(0);
      if (r.tiles === 0) bad.push(`${x},${y} laid nothing`);
      else if (r.serviced === 0) bad.push(`${x},${y} no serviced harvester`);
    }
    // (2,2) is the documented enclave — the tile the ticket repro used.
    expect(canReachASpot(grid, 2, 2)).toBe(false);
    expect(enclaves).toBeGreaterThan(0);
    expect(bad, `deadlocked tiles: ${bad.join(" | ")}`).toEqual([]);
  }, 180_000);

  it("seed 7: the first turn is never a no-op, and builds wherever it can", () => {
    // sampled (step 4): the ticket measured 37/157 deadlocks on this seed, so a
    // quarter of the space is plenty to catch the regression, and the full
    // 160-tile × 4-turn pass above already covers seed 1337 end to end.
    const grid = generateMap(7);
    const tiles = rivalSearchTiles(grid, 4);
    expect(tiles.length).toBeGreaterThan(20);
    const bad: string[] = [];
    for (const [x, y] of tiles) {
      if (!canReachASpot(grid, x, y)) continue;
      const r = play(grid, x, y, 2);
      expect(r.noops, `no-op turn at ${x},${y}`).toBe(0);
      if (r.tiles === 0 || r.serviced === 0) bad.push(`${x},${y} tiles=${r.tiles} h=${r.serviced}`);
    }
    expect(bad, `deadlocked tiles: ${bad.join(" | ")}`).toEqual([]);
  }, 180_000);

  it("seed 2024 (the ticket's control) still builds everywhere it could before", () => {
    const grid = generateMap(2024);
    const tiles = rivalSearchTiles(grid, 4);   // sampled: this seed never deadlocked
    const bad: string[] = [];
    for (const [x, y] of tiles) {
      if (!canReachASpot(grid, x, y)) continue;
      const r = play(grid, x, y, 1);
      if (r.tiles === 0 || r.serviced === 0) bad.push(`${x},${y}`);
    }
    expect(bad, `deadlocked tiles: ${bad.join(" | ")}`).toEqual([]);
  }, 180_000);
});

describe("W8 sweep — every candidate returned is executable and viable", () => {
  it("no plan crosses ground its own transport kind cannot be laid on", () => {
    // Sampled (step 4) on the ticket's repro seed — the invariant is
    // structural (it comes from the filter in `planCandidates`), so a quarter
    // of one map covers it without doubling the suite's runtime.
    for (const seed of [1337]) {
      const grid = generateMap(seed);
      for (const [x, y] of rivalSearchTiles(grid, 4)) {
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
  }, 600_000);
});

describe("W8 sweep — the rival is never placed on a tile it cannot build from", () => {
  it("every player placement yields a rail-legal, reachable rival tile", () => {
    const grid = generateMap(1337);
    const opts = { purse: { stone: 12, ore: 0 }, free: 12, ownerId: 2 };
    let checked = 0;
    for (let y = 2; y < MAP_H - 2; y += 4) {
      for (let x = 2; x < MAP_W - 2; x += 4) {
        if (!canBuildOn(grid, "road", x, y)) continue;
        const spot = chooseRivalFactorySpot(grid, createTrack(), [x, y], opts);
        expect(spot, `player at ${x},${y}`).toBeTruthy();
        // two factories never share a tile — and the player's tile IS in this
        // search space, so the explicit exclusion is what keeps them apart
        // (distance is only the second sort key now that rail-legality leads).
        expect(spot, `rival on the player's own tile ${x},${y}`).not.toEqual([x, y]);
        expect(canBuildOn(grid, "rail", spot![0], spot![1]), `rail illegal at ${spot}`).toBe(true);
        expect(canReachASpot(grid, spot![0], spot![1]), `enclave at ${spot}`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
    // The ticket's repro: a player factory at (23,22) used to hand the rival
    // the rough (2,2) enclave. The ranking alone (before any plan probe) puts
    // rail-legal tiles first, so that tile can never be committed again.
    const spot = chooseRivalFactorySpot(grid, createTrack(), [23, 22], opts);
    expect(tIdx(spot![0], spot![1])).not.toBe(tIdx(2, 2));
  }, 180_000);
});
