// PP-06 — additional processing plants at other towns.
import { describe, it, expect } from "vitest";
import {
  PLANT_COST, addPlant, adjacentTown, canAffordPlant, canPlacePlant,
  chooseAiPlantSpot, footprintTiles, nextPlantId, plantRefusal, plantsOf,
} from "../../src/iso/plants";
import {
  buildAllComponents, resolveConnection, claimantCounts, harvesterYield,
  playerResources,
  type EconomyState, type Harvester,
} from "../../src/iso/economy";
// VP-01: a plant is worth a point of its own now, so this file's scoring
// assertions moved from `economy` (connections) to `victory` (the scoreboard).
import { createScoreState, rescore, vpFor } from "../../src/iso/victory";
import { createTrack, buildTile, tIdx, type Track } from "../../src/iso/track";
import { GRASS, WATER, TOWN_OCC, type Grid, type Industry, type Town } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY, FACTORY_FOOTPRINT } from "../../src/iso/config";

const town = (id: number, tx: number, ty: number, n = 4, roads: [number, number][] = []): Town => {
  const houses: [number, number][] = [];
  for (let i = 0; i < n; i++) houses.push([tx + i, ty]);
  return { id, tx, ty, houses, roads };
};

function flatGrid(towns: Town[] = [], industries: Industry[] = [], stampRoads = true): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
  });
  // houses AND PP-10 roads are both town tiles (TOWN_OCC) on a real grid
  for (const t of towns) {
    for (const [hx, hy] of t.houses) occupancy[tIdx(hx, hy)] = TOWN_OCC;
    if (stampRoads) for (const [rx, ry] of t.roads ?? []) occupancy[tIdx(rx, ry)] = TOWN_OCC;
  }
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, towns, occupancy, seed: 1,
  };
}

const ind = (type: string, tx: number, ty: number): Industry => {
  const def = INDUSTRY_BY_KEY[type];
  return { id: 0, type, tx, ty, w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0 };
};

const state = (grid: Grid, track: Track): EconomyState =>
  ({ grid, track, harvesters: [], factories: [] });

const run = (t: Track, x0: number, x1: number, y: number, owner: number) => {
  // The plant-connection fixtures use the BASIC Dirt Road tier (throughput
  // ×1.0), so a plant reached by one such line yields exactly the industry's
  // base output — the magnitude the "no duplicate production" tests assert.
  for (let x = x0; x <= x1; x++) buildTile(t, "dirt", x, y, owner);
};

describe("PP-06 town adjacency", () => {
  it("accepts a footprint sharing an edge with a town tile", () => {
    const grid = flatGrid([town(0, 20, 20)]);
    const track = createTrack();
    // footprint (20,21)-(22,23): (20,21) shares an edge with house (20,20)
    expect(plantRefusal(grid, track, state(grid, track), 20, 21)).toBeNull();
    expect(adjacentTown(grid, 20, 21)?.id).toBe(0);
  });

  it("rejects diagonal-only contact", () => {
    const grid = flatGrid([town(0, 20, 20, 1)]);
    const track = createTrack();
    // footprint (21,21)-(23,23): only touches (20,20) diagonally
    expect(plantRefusal(grid, track, state(grid, track), 21, 21)).toBe("no-town");
  });

  it("PP-02/PP-10: a town's road is a town tile — touching the ring road qualifies", () => {
    // single house (20,20) with a PP-10-style road tile at (20,19) above it
    const grid = flatGrid([town(0, 20, 20, 1, [[20, 19]])]);
    const track = createTrack();
    // footprint (20,16)-(22,18): tile (20,18)'s down-neighbour is the road —
    // the same edge-contact rule as the starting Factory (factoryTouchesTown)
    expect(plantRefusal(grid, track, state(grid, track), 20, 16)).toBeNull();
    expect(adjacentTown(grid, 20, 16)?.id).toBe(0);
    // an unstamped road on the Town record never qualifies (synthetic honesty)
    const ghost = flatGrid([town(1, 60, 60, 1, [[60, 59]])], [], false); // road NOT stamped
    expect(plantRefusal(ghost, createTrack(), state(ghost, createTrack()), 60, 56))
      .toBe("no-town");
  });

  it("rejects a site far from any town", () => {
    const grid = flatGrid([town(0, 20, 20)]);
    const track = createTrack();
    expect(plantRefusal(grid, track, state(grid, track), 60, 60)).toBe("no-town");
  });

  it("rejects water, town/industry ground, other buildings and track", () => {
    const grid = flatGrid([town(0, 20, 20)], [ind("farm", 24, 21)]);
    const track = createTrack();
    const st = state(grid, track);

    grid.terrain[tIdx(20, 21)] = WATER;
    expect(plantRefusal(grid, track, st, 20, 21)).toBe("water");
    grid.terrain[tIdx(20, 21)] = GRASS;

    // straddling town tiles themselves
    expect(plantRefusal(grid, track, st, 20, 20)).toBe("occupied");

    st.factories.push({ owner: "p1", ownerId: 1, tx: 20, ty: 21, id: 0, townId: 0 });
    expect(plantRefusal(grid, track, st, 20, 21)).toBe("building");
    st.factories.length = 0;

    buildTile(track, "road", 21, 22, 1);
    expect(plantRefusal(grid, track, st, 20, 21)).toBe("track");
  });

  it("uses one shared footprint for the preview and the placement", () => {
    expect(footprintTiles(5, 7)).toHaveLength(FACTORY_FOOTPRINT[0] * FACTORY_FOOTPRINT[1]);
    const grid = flatGrid([town(0, 20, 20)]);
    const track = createTrack();
    const st = state(grid, track);
    for (let tx = 15; tx < 30; tx++) {
      for (let ty = 15; ty < 30; ty++) {
        // the boolean preview and the placement agree, always
        expect(canPlacePlant(grid, track, st, tx, ty))
          .toBe(addPlant(grid, track, { ...st, factories: [] }, "p1", 1, tx, ty) !== null);
      }
    }
  });
});

describe("PP-06 plant records", () => {
  it("gives each plant ownership, a town association and a stable id", () => {
    const grid = flatGrid([town(0, 20, 20), town(1, 60, 60)]);
    const track = createTrack();
    const st = state(grid, track);
    const a = addPlant(grid, track, st, "p1", 1, 20, 21)!;
    const b = addPlant(grid, track, st, "p1", 1, 60, 61)!;
    expect(a.owner).toBe("p1");
    expect(a.ownerId).toBe(1);
    expect(a.id).toBe(0);
    expect(a.townId).toBe(0);
    expect(b.id).toBe(1);
    expect(b.townId).toBe(1);
    expect(nextPlantId(st, "p1")).toBe(2);
    expect(plantsOf(st, "p1")).toHaveLength(2);
    expect(plantsOf(st, "p2")).toHaveLength(0);
  });

  it("prices a plant from one authoritative constant", () => {
    expect(canAffordPlant({ wood: 2, stone: 2, grain: 2, ore: 3 })).toBe(true);
    expect(canAffordPlant({ wood: 2, stone: 2, grain: 2, ore: 2 })).toBe(false);
    expect(canAffordPlant({})).toBe(false);
    expect(Object.values(PLANT_COST).every((v) => v > 0)).toBe(true);
  });
});

describe("PP-06 routing, scoring and yield with several plants", () => {
  /**
   * Depot at (24,24) with a farm in catchment, roads reaching BOTH of the
   * player's plants. It must yield once and score once.
   */
  const twoPlantWorld = () => {
    const grid = flatGrid([town(0, 10, 24), town(1, 40, 24)], [ind("farm", 25, 25)]);
    const track = createTrack();
    const st = state(grid, track);
    addPlant(grid, track, st, "p1", 1, 10, 25);
    addPlant(grid, track, st, "p1", 1, 40, 25);
    const h: Harvester = { id: 1, owner: "p1", ownerId: 1, tx: 24, ty: 26 };
    st.harvesters.push(h);
    run(track, 10, 41, 26, 1);     // one road passing both plants and the depot
    return { grid, track, st, h };
  };

  it("connects a depot to a plant and picks exactly one", () => {
    const { st, track, h } = twoPlantWorld();
    const conn = resolveConnection(st, buildAllComponents(track, 1), h);
    expect(conn.kind).toBe("dirt");   // the fixture line is a basic Dirt Road
    expect(conn.factory).not.toBeNull();
    expect(plantsOf(st, "p1")).toHaveLength(2);
  });

  it("does not duplicate production when a depot reaches several plants", () => {
    const { st, track, h } = twoPlantWorld();
    const counts = claimantCounts(st);
    const y = harvesterYield(st, buildAllComponents(track, 1), counts, h, 0);
    const def = INDUSTRY_BY_KEY["farm"];
    expect(y.yields[def.cargo]).toBeCloseTo(def.output, 6);
    const total = playerResources(st, "p1", 0);
    expect(total[def.cargo]).toBeCloseTo(def.output, 6);
  });

  it("scores one point per plant raised, and none for the line that joins them", () => {
    // PP-06's rule was "a depot reaching two plants still yields ONE connection
    // VP". VP-01 keeps the shape of that — the connection is not counted at all
    // — and makes the plants themselves the thing that scores, so two plants
    // are worth two points and the shared road is worth nothing.
    const { st, grid, track } = twoPlantWorld();
    const score = createScoreState();
    const events = rescore(st, score);
    // `twoPlantWorld` raised two plants, but the first is plant #0 — the free
    // setup Factory — so exactly one of them pays.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: "plant", type: "awarded", owner: "p1", delta: 1 });
    expect(vpFor(score, "p1")).toBe(1);
    // idempotent: the same board, the same (empty) diff
    expect(rescore(st, score)).toEqual([]);

    // …and the dirt line passing both plants and the depot moves no number
    expect(resolveConnection(st, buildAllComponents(track, 1), st.harvesters[0]).kind).toBe("dirt");

    // a THIRD plant beside the same town pays its own point, once
    expect(addPlant(grid, track, st, "p1", 1, 43, 25)).toBeTruthy();
    expect(rescore(st, score)).toEqual([
      { source: "plant", type: "awarded", owner: "p1", delta: 1, tx: 43, ty: 25, townId: 1, plantNo: 3 },
    ]);
    expect(vpFor(score, "p1")).toBe(2);
    expect(rescore(st, score)).toEqual([]);
  });
});

describe("PP-06 AI expansion", () => {
  it("only ever proposes a town-adjacent, legal site", () => {
    const grid = flatGrid([town(0, 20, 20), town(1, 60, 60)]);
    const track = createTrack();
    const st = state(grid, track);
    addPlant(grid, track, st, "ai", 2, 20, 21);
    const spot = chooseAiPlantSpot(grid, track, st, "ai");
    expect(spot).not.toBeNull();
    expect(canPlacePlant(grid, track, st, spot![0], spot![1])).toBe(true);
    expect(adjacentTown(grid, spot![0], spot![1])!.id).toBe(1);   // a DIFFERENT town
  });

  it("has no fallback: no towns left means no spot", () => {
    const grid = flatGrid([town(0, 20, 20)]);
    const track = createTrack();
    const st = state(grid, track);
    addPlant(grid, track, st, "ai", 2, 20, 21);
    expect(chooseAiPlantSpot(grid, track, st, "ai")).toBeNull();
  });

  it("PP-02/PP-10: still proposes sites when a town is ring-road-enclosed", () => {
    // house at (40,20) fully ringed by town roads (like PP-10 towns): legal
    // footprints now stand OUTSIDE the ring, touching a road by an edge.
    const ring: [number, number][] = [];
    for (const [rx, ry] of [[39, 19], [40, 19], [41, 19], [39, 20], [41, 20],
      [39, 21], [40, 21], [41, 21]] as const) ring.push([rx, ry]);
    const grid = flatGrid([
      town(0, 40, 20, 1, ring),
      town(1, 60, 60),
    ]);
    const track = createTrack();
    const st = state(grid, track);
    addPlant(grid, track, st, "ai", 2, 60, 61);   // plant #0 beside town 1
    const spot = chooseAiPlantSpot(grid, track, st, "ai");
    expect(spot).not.toBeNull();
    expect(adjacentTown(grid, spot![0], spot![1])!.id).toBe(0);  // town 0's ring
    expect(canPlacePlant(grid, track, st, spot![0], spot![1])).toBe(true);
  });
});

describe("PP-06 save/load and multiplayer", () => {
  it("round-trips every plant with its id and town through a snapshot", async () => {
    const { buildSnapshot, applySnapshot } = await import("../../src/iso/snapshot");
    const grid = flatGrid([town(0, 20, 20), town(1, 60, 60)]);
    const track = createTrack();
    const st = state(grid, track);
    addPlant(grid, track, st, "p1", 1, 20, 21);
    addPlant(grid, track, st, "p1", 1, 60, 61);
    const snap = buildSnapshot({
      seed: 1, track, harvesters: [], factories: st.factories,
      setupPhase: false, won: false, players: [],
    });
    const back = applySnapshot(JSON.parse(JSON.stringify(snap)), 1);
    expect(back.factories).toHaveLength(2);
    expect(back.factories.map((f) => f.id)).toEqual([0, 1]);
    expect(back.factories.map((f) => f.townId)).toEqual([0, 1]);
  });
});
