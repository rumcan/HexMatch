import { describe, it, expect } from "vitest";
import {
  CATCHMENT, catchmentRect, industriesInCatchment, isServiced,
  buildComponents, buildAllComponents, linkedBy, resolveConnection,
  claimantCounts, harvesterYield, playerResources,
  createScoreState, rescore, vpFor,
  type EconomyState, type Harvester, type Factory,
} from "../../src/iso/economy";
import { createTrack, buildTile, demolishTile, tIdx, type Track } from "../../src/iso/track";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { TRANSPORT, INDUSTRY_BY_KEY } from "../../src/iso/config";

function flatGrid(industries: Industry[] = []): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
  });
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, occupancy, seed: 1,
  };
}

const ind = (type: string, tx: number, ty: number, banditUntil = 0): Industry => {
  const def = INDUSTRY_BY_KEY[type];
  return {
    id: 0, type, tx, ty,
    w: def.footprint[0], h: def.footprint[1],
    output: def.output, banditUntil,
  };
};

const H = (id: number, owner: string, tx: number, ty: number): Harvester =>
  ({ id, owner, tx, ty });

/** Lay a straight run of track along x at a fixed y. */
const run = (t: Track, kind: "road" | "rail", x0: number, x1: number, y: number) => {
  for (let x = x0; x <= x1; x++) buildTile(t, kind, x, y);
};

describe("E6 catchment", () => {
  it("is a 4×4 rect that contains the harvester tile", () => {
    expect(CATCHMENT).toBe(4);
    const r = catchmentRect(10, 10);
    expect(r.x1 - r.x0 + 1).toBe(4);
    expect(r.y1 - r.y0 + 1).toBe(4);
    expect(r.x0).toBeLessThanOrEqual(10);
    expect(r.x1).toBeGreaterThanOrEqual(10);
  });

  it("catches an industry whose footprint merely overlaps", () => {
    const farm = ind("farm", 11, 11);          // 2×2 at 11,11
    const grid = flatGrid([farm]);
    // catchment of (10,10) is 9..12 — overlaps the farm's top corner
    expect(industriesInCatchment(grid, H(0, "p1", 10, 10))).toHaveLength(1);
    // far away catches nothing
    expect(industriesInCatchment(grid, H(0, "p1", 30, 30))).toHaveLength(0);
  });

  it("catches several industries at once", () => {
    const grid = flatGrid([ind("farm", 9, 9), ind("forest", 11, 11)]);
    expect(industriesInCatchment(grid, H(0, "p1", 10, 10))).toHaveLength(2);
  });
});

describe("E6 servicing", () => {
  it("requires adjacency to at least one road or rail tile", () => {
    const t = createTrack();
    const h = H(0, "p1", 10, 10);
    expect(isServiced(t, h)).toBe(false);
    buildTile(t, "road", 11, 10);
    expect(isServiced(t, h)).toBe(true);
  });

  it("accepts rail adjacency too, but not a diagonal", () => {
    const t = createTrack();
    buildTile(t, "rail", 11, 11);
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(false);
    buildTile(t, "rail", 10, 11);
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(true);
  });
});

describe("E6 connected components", () => {
  it("gives one id to a contiguous run and different ids to separate ones", () => {
    const t = createTrack();
    run(t, "road", 5, 9, 10);
    run(t, "road", 20, 24, 10);
    const comp = buildComponents(t, "road");
    expect(comp[tIdx(5, 10)]).toBe(comp[tIdx(9, 10)]);
    expect(comp[tIdx(20, 10)]).not.toBe(comp[tIdx(5, 10)]);
    expect(comp[tIdx(15, 10)]).toBe(-1);
  });

  it("never merges across a one-sided bit", () => {
    const t = createTrack();
    run(t, "road", 5, 6, 10);
    t.road[tIdx(6, 10)] |= 2;                 // forge SE toward an empty tile
    const comp = buildComponents(t, "road");
    expect(comp[tIdx(7, 10)]).toBe(-1);
  });

  it("keeps road and rail components independent at a level crossing", () => {
    const t = createTrack();
    run(t, "road", 5, 9, 10);
    for (let y = 8; y <= 12; y++) buildTile(t, "rail", 7, y);
    const c = buildAllComponents(t);
    expect(c.road[tIdx(5, 10)]).toBeGreaterThanOrEqual(0);
    expect(c.rail[tIdx(7, 8)]).toBeGreaterThanOrEqual(0);
    expect(c.road[tIdx(7, 8)]).toBe(-1);
  });

  it("linkedBy joins two structures beside the same component", () => {
    const t = createTrack();
    run(t, "road", 5, 15, 10);
    const comp = buildComponents(t, "road");
    // both sit just above the road run
    expect(linkedBy(comp, 6, 9, 14, 9)).toBe(true);
    expect(linkedBy(comp, 6, 9, 40, 40)).toBe(false);
  });
});

describe("E6 acceptance", () => {
  /** Farm + harvester + a road to the factory. */
  function scenario(kind: "road" | "rail" = "road") {
    const farm = ind("farm", 11, 9);
    const grid = flatGrid([farm]);
    const track = createTrack();
    run(track, kind, 6, 20, 10);              // the trunk line
    const harv = H(1, "p1", 11, 11);          // below the trunk, beside it
    buildTile(track, kind, 11, 10);           // already part of the run
    const factory: Factory = { owner: "p1", tx: 20, ty: 11 };
    const state: EconomyState = {
      grid, track, harvesters: [harv], factories: [factory],
    };
    return { state, track, grid, harv, factory, farm };
  }

  it("placing a harvester next to a farm starts grain", () => {
    const { state } = scenario();
    const res = playerResources(state, "p1", 0);
    expect(res.grain).toBeGreaterThan(0);
  });

  it("a rail path scores 3 VP and applies the 1.6× multiplier", () => {
    const { state } = scenario("rail");
    const comp = buildAllComponents(state.track);
    const conn = resolveConnection(state, comp, state.harvesters[0]);
    expect(conn.kind).toBe("rail");
    expect(conn.vp).toBe(3);
    expect(conn.multiplier).toBe(1.6);
    const res = playerResources(state, "p1", 0);
    expect(res.grain).toBeCloseTo(INDUSTRY_BY_KEY.farm.output * 1.6, 6);
  });

  it("a road path scores 1 VP at 1.0×", () => {
    const { state } = scenario("road");
    const comp = buildAllComponents(state.track);
    const conn = resolveConnection(state, comp, state.harvesters[0]);
    expect(conn.kind).toBe("road");
    expect(conn.vp).toBe(1);
    expect(conn.multiplier).toBe(1);
    expect(playerResources(state, "p1", 0).grain)
      .toBeCloseTo(INDUSTRY_BY_KEY.farm.output, 6);
  });

  it("demolishing one road tile mid-path stops output and revokes VP", () => {
    const { state, track } = scenario();
    const score = createScoreState();
    let events = rescore(state, score);
    expect(events).toEqual([
      { harvester: 1, type: "awarded", from: null, to: "road", delta: 1 },
    ]);
    expect(vpFor(score, "p1")).toBe(1);
    expect(playerResources(state, "p1", 0).grain).toBeGreaterThan(0);

    demolishTile(track, "road", 15, 10);      // cut the trunk mid-path
    events = rescore(state, score);
    expect(events).toEqual([
      { harvester: 1, type: "revoked", from: "road", to: null, delta: -1 },
    ]);
    expect(vpFor(score, "p1")).toBe(0);
    expect(playerResources(state, "p1", 0).grain).toBeUndefined();
  });

  it("a blockaded industry produces nothing", () => {
    const { state, grid } = scenario();
    grid.industries[0].banditUntil = 5_000;
    expect(playerResources(state, "p1", 1_000).grain).toBeUndefined();
    // ...and resumes once the blockade expires
    expect(playerResources(state, "p1", 6_000).grain).toBeGreaterThan(0);
  });

  it("an unserviced harvester yields nothing and holds no VP", () => {
    const grid = flatGrid([ind("farm", 11, 9)]);
    const state: EconomyState = {
      grid, track: createTrack(),
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", tx: 20, ty: 11 }],
    };
    expect(playerResources(state, "p1", 0)).toEqual({});
    const score = createScoreState();
    expect(rescore(state, score)).toEqual([]);
    expect(vpFor(score, "p1")).toBe(0);
  });
});

describe("E6 rail beats road", () => {
  it("takes the rail multiplier and VP when both paths exist", () => {
    const farm = ind("farm", 11, 9);
    const grid = flatGrid([farm]);
    const track = createTrack();
    run(track, "road", 6, 20, 10);
    run(track, "rail", 6, 20, 12);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],       // between both lines
      factories: [{ owner: "p1", tx: 20, ty: 11 }],
    };
    const comp = buildAllComponents(track);
    expect(resolveConnection(state, comp, state.harvesters[0]).kind).toBe("rail");
    expect(playerResources(state, "p1", 0).grain)
      .toBeCloseTo(INDUSTRY_BY_KEY.farm.output * TRANSPORT.rail.throughput, 6);
  });

  it("falls back to road and revokes the rail VP when the rail breaks", () => {
    const grid = flatGrid([ind("farm", 11, 9)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10);
    run(track, "rail", 6, 20, 12);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(3);

    demolishTile(track, "rail", 15, 12);
    const events = rescore(state, score);
    expect(events).toEqual([
      { harvester: 1, type: "downgraded", from: "rail", to: "road", delta: -2 },
    ]);
    expect(vpFor(score, "p1")).toBe(1);       // 3 revoked, 1 road awarded
  });

  it("upgrading road to rail raises the VP", () => {
    const grid = flatGrid([ind("farm", 11, 9)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(1);
    run(track, "rail", 6, 20, 12);
    const events = rescore(state, score);
    expect(events[0]).toMatchObject({ type: "upgraded", from: "road", to: "rail", delta: 2 });
    expect(vpFor(score, "p1")).toBe(3);
  });
});

describe("E6 overlapping catchments split output proportionally", () => {
  function twoClaimants() {
    const grid = flatGrid([ind("farm", 11, 9)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11), H(2, "p2", 12, 11)],
      factories: [{ owner: "p1", tx: 20, ty: 11 }, { owner: "p2", tx: 19, ty: 11 }],
    };
    return state;
  }

  it("halves the farm between two claimants", () => {
    const state = twoClaimants();
    const counts = claimantCounts(state);
    expect(counts.get(0)).toBe(2);
    const full = INDUSTRY_BY_KEY.farm.output;
    expect(playerResources(state, "p1", 0).grain).toBeCloseTo(full / 2, 6);
    expect(playerResources(state, "p2", 0).grain).toBeCloseTo(full / 2, 6);
  });

  it("conserves total output regardless of the split", () => {
    const state = twoClaimants();
    const total = (playerResources(state, "p1", 0).grain ?? 0)
      + (playerResources(state, "p2", 0).grain ?? 0);
    expect(total).toBeCloseTo(INDUSTRY_BY_KEY.farm.output, 6);
  });

  it("does not let an unserviced rival dilute the yield", () => {
    const state = twoClaimants();
    state.harvesters[1] = H(2, "p2", 12, 30);   // move p2 far from any track
    expect(claimantCounts(state).get(0)).toBe(1);
    expect(playerResources(state, "p1", 0).grain)
      .toBeCloseTo(INDUSTRY_BY_KEY.farm.output, 6);
  });
});

describe("E6 scoring hygiene", () => {
  it("is idempotent — rescoring an unchanged world emits nothing", () => {
    const grid = flatGrid([ind("farm", 11, 9)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    expect(rescore(state, score)).toHaveLength(1);
    expect(rescore(state, score)).toEqual([]);
    expect(rescore(state, score)).toEqual([]);
    expect(vpFor(score, "p1")).toBe(1);
  });

  it("debits VP when the harvester itself is removed", () => {
    const grid = flatGrid([ind("farm", 11, 9)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(1);
    state.harvesters = [];
    const events = rescore(state, score);
    expect(events).toEqual([
      { harvester: 1, type: "revoked", from: "road", to: null, delta: -1 },
    ]);
    expect(vpFor(score, "p1")).toBe(0);
  });

  it("keeps players' VP separate", () => {
    const grid = flatGrid([ind("farm", 11, 9), ind("forest", 30, 9)]);
    const track = createTrack();
    run(track, "road", 6, 40, 10);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11), H(2, "p2", 31, 11)],
      factories: [{ owner: "p1", tx: 20, ty: 11 }, { owner: "p2", tx: 35, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(1);
    expect(vpFor(score, "p2")).toBe(1);
  });

  it("does not connect a harvester to a rival's factory", () => {
    const grid = flatGrid([ind("farm", 11, 9)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p2", tx: 20, ty: 11 }],   // rival's only
    };
    const comp = buildAllComponents(track);
    expect(resolveConnection(state, comp, state.harvesters[0]).kind).toBeNull();
    expect(playerResources(state, "p1", 0)).toEqual({});
  });

  it("harvesterYield reports servicing and connection for the UI", () => {
    const grid = flatGrid([ind("farm", 11, 9)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", tx: 20, ty: 11 }],
    };
    const y = harvesterYield(
      state, buildAllComponents(track), claimantCounts(state), state.harvesters[0], 0,
    );
    expect(y.serviced).toBe(true);
    expect(y.connection.kind).toBe("road");
    expect(y.yields.grain).toBeGreaterThan(0);
  });
});
