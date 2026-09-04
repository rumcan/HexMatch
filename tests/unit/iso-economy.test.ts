import { describe, it, expect } from "vitest";
import {
  CATCHMENT, catchmentRect, industriesInCatchment, isServiced,
  buildComponents, buildAllComponents, linkedBy, resolveConnection,
  claimantCounts, harvesterYield, playerResources,
  industryClaimValues, pickBlockadeTarget,
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

// W2: the numeric track-owner id follows the string identity the tests use
// (p1 → 1, p2 → 2); anything else is the neutral, unowned world.
const oid = (owner: string) => (owner === "p1" ? 1 : owner === "p2" ? 2 : 0);

const H = (id: number, owner: string, tx: number, ty: number): Harvester =>
  ({ id, owner, ownerId: oid(owner), tx, ty });

/** Lay a straight run of track along x at a fixed y, owned by `owner`. */
const run = (t: Track, kind: "road" | "rail", x0: number, x1: number, y: number, owner: number = 0) => {
  for (let x = x0; x <= x1; x++) buildTile(t, kind, x, y, owner);
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
    const farm = ind("farm", 11, 11);          // 1×1 at 11,11
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
    buildTile(t, "road", 11, 10, 1);
    expect(isServiced(t, h)).toBe(true);
  });

  it("accepts rail adjacency too, but not a diagonal", () => {
    const t = createTrack();
    buildTile(t, "rail", 11, 11);
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(false);
    buildTile(t, "rail", 10, 11, 1);
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(true);
  });

  // W2: a RIVAL's line beside your harvester does not service it.
  it("does not count another player's adjacent track as service", () => {
    const t = createTrack();
    buildTile(t, "road", 11, 10, 2);            // the rival's road
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(false);
    buildTile(t, "road", 11, 10, 1);            // own the tile: now serviced
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(true);
  });
});

describe("E6 connected components", () => {
  it("gives one id to a contiguous run and different ids to separate ones", () => {
    const t = createTrack();
    run(t, "road", 5, 9, 10);
    run(t, "road", 20, 24, 10);
    const comp = buildComponents(t, "road", 0);
    expect(comp[tIdx(5, 10)]).toBe(comp[tIdx(9, 10)]);
    expect(comp[tIdx(20, 10)]).not.toBe(comp[tIdx(5, 10)]);
    expect(comp[tIdx(15, 10)]).toBe(-1);
  });

  it("never merges across a one-sided bit", () => {
    const t = createTrack();
    run(t, "road", 5, 6, 10);
    t.road[tIdx(6, 10)] |= 2;                 // forge SE toward an empty tile
    const comp = buildComponents(t, "road", 0);
    expect(comp[tIdx(7, 10)]).toBe(-1);
  });

  it("keeps road and rail components independent at a level crossing", () => {
    const t = createTrack();
    run(t, "road", 5, 9, 10);
    for (let y = 8; y <= 12; y++) buildTile(t, "rail", 7, y);
    const c = buildAllComponents(t, 0);
    expect(c.road[tIdx(5, 10)]).toBeGreaterThanOrEqual(0);
    expect(c.rail[tIdx(7, 8)]).toBeGreaterThanOrEqual(0);
    expect(c.road[tIdx(7, 8)]).toBe(-1);
  });

  it("linkedBy joins two structures beside the same component", () => {
    const t = createTrack();
    run(t, "road", 5, 15, 10);
    const comp = buildComponents(t, "road", 0);
    // both sit just above the road run
    expect(linkedBy(comp, 6, 9, 14, 9)).toBe(true);
    expect(linkedBy(comp, 6, 9, 30, 30)).toBe(false);   // K0: 32×32 map
  });

  // W2 acceptance: two players' lines that TOUCH each other are still two
  // components — one per owner. The flood that scores connections can never
  // run across the border.
  it("never merges two players' touching lines (owner boundary)", () => {
    const t = createTrack();
    run(t, "road", 5, 9, 10, 1);              // p1's run
    run(t, "road", 10, 14, 10, 2);            // p2's run, adjacent at x=9/10
    const c1 = buildComponents(t, "road", 1);
    const c2 = buildComponents(t, "road", 2);
    // each player sees its own run, in its own component
    expect(c1[tIdx(9, 10)]).toBeGreaterThanOrEqual(0);
    expect(c2[tIdx(10, 10)]).toBeGreaterThanOrEqual(0);
    // neither player's flood crosses into the other's tiles
    expect(c1[tIdx(10, 10)]).toBe(-1);
    expect(c2[tIdx(9, 10)]).toBe(-1);
  });
});

describe("E6 acceptance", () => {
  /** Farm + harvester + a road to the factory — all p1's, all owned by p1. */
  function scenario(kind: "road" | "rail" = "road") {
    const farm = ind("farm", 12, 11);
    const grid = flatGrid([farm]);
    const track = createTrack();
    run(track, kind, 6, 20, 10, 1);           // p1's trunk line
    const harv = H(1, "p1", 11, 11);          // below the trunk, beside it
    buildTile(track, kind, 11, 10, 1);        // already part of the run
    const factory: Factory = { owner: "p1", ownerId: 1, tx: 20, ty: 11 };
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
    const comp = buildAllComponents(state.track, 1);
    const conn = resolveConnection(state, comp, state.harvesters[0]);
    expect(conn.kind).toBe("rail");
    expect(conn.vp).toBe(3);
    expect(conn.multiplier).toBe(1.6);
    const res = playerResources(state, "p1", 0);
    expect(res.grain).toBeCloseTo(INDUSTRY_BY_KEY.farm.output * 1.6, 6);
  });

  it("a road path scores 1 VP at 1.0×", () => {
    const { state } = scenario("road");
    const comp = buildAllComponents(state.track, 1);
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
    const grid = flatGrid([ind("farm", 12, 11)]);
    const state: EconomyState = {
      grid, track: createTrack(),
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    expect(playerResources(state, "p1", 0)).toEqual({});
    const score = createScoreState();
    expect(rescore(state, score)).toEqual([]);
    expect(vpFor(score, "p1")).toBe(0);
  });

  // W2 acceptance: "a player's network reaches an industry only over that
  // player's own track; the rival must build its own road to connect."
  it("reaches an industry only over its own track, never the rival's", () => {
    const farm = ind("farm", 12, 11);
    const grid = flatGrid([farm]);
    const track = createTrack();
    // p1's full line: harvester → farm → its factory.
    run(track, "road", 6, 20, 10, 1);
    const p1Harv = H(1, "p1", 11, 11);
    const state: EconomyState = {
      grid, track,
      harvesters: [p1Harv],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    expect(playerResources(state, "p1", 0).grain).toBeGreaterThan(0);

    // p2 puts a harvester beside the SAME farm, right next to p1's line —
    // but p2 has built nothing. The rival's road must not count.
    state.harvesters.push(H(2, "p2", 13, 11));
    state.factories.push({ owner: "p2", ownerId: 2, tx: 28, ty: 11 });   // K0: ≤31
    expect(playerResources(state, "p2", 0)).toEqual({});
    const score = createScoreState();
    const events = rescore(state, score);
    // only p1's connection is scored; p2's unserviced harvester earns no VP
    expect(events.filter((e) => e.type === "awarded")).toHaveLength(1);
    expect(vpFor(score, "p1")).toBe(1);
    expect(vpFor(score, "p2")).toBe(0);

    // The moment p2 lays its OWN road home, it connects on its own.
    run(track, "road", 14, 28, 12, 2);
    run(track, "road", 14, 14, 11, 2);   // up from its line to beside the farm
    expect(playerResources(state, "p2", 0).grain).toBeGreaterThan(0);
  });

  // W2 acceptance: "demolishing your own road never disconnects the rival
  // (and vice-versa)". Two players share one farm from adjacent lines; each
  // tears down a tile of its OWN line and the other's connection survives.
  it("cutting one player's line leaves the other's connection intact", () => {
    const world = (): EconomyState => {
      const grid = flatGrid([ind("farm", 12, 11)]);
      const track = createTrack();
      run(track, "road", 6, 12, 10, 1);   // p1's line (they meet at x=12…)
      run(track, "road", 12, 20, 10, 2);  // …which p2 builds last and owns
      return {
        grid, track,
        harvesters: [H(1, "p1", 11, 11), H(2, "p2", 13, 11)],
        factories: [
          { owner: "p1", ownerId: 1, tx: 6, ty: 11 },
          { owner: "p2", ownerId: 2, tx: 20, ty: 11 },
        ],
      };
    };

    // both start connected, sharing the farm
    let state = world();
    expect(playerResources(state, "p1", 0).grain).toBeGreaterThan(0);
    expect(playerResources(state, "p2", 0).grain).toBeGreaterThan(0);

    // p1 demolishes its own tile — p1 goes dark, p2 is UNTOUCHED
    demolishTile(state.track, "road", 10, 10);
    expect(playerResources(state, "p1", 0)).toEqual({});
    expect(playerResources(state, "p2", 0).grain).toBeGreaterThan(0);

    // and vice-versa: p2's demolition cannot reach p1's connection
    state = world();
    demolishTile(state.track, "road", 14, 10);
    expect(playerResources(state, "p2", 0)).toEqual({});
    expect(playerResources(state, "p1", 0).grain).toBeGreaterThan(0);
  });
});

describe("E6 rail beats road", () => {
  it("takes the rail multiplier and VP when both paths exist", () => {
    const farm = ind("farm", 12, 11);
    const grid = flatGrid([farm]);
    const track = createTrack();
    run(track, "road", 6, 20, 10, 1);
    run(track, "rail", 6, 20, 12, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],       // between both lines
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const comp = buildAllComponents(track, 1);
    expect(resolveConnection(state, comp, state.harvesters[0]).kind).toBe("rail");
    expect(playerResources(state, "p1", 0).grain)
      .toBeCloseTo(INDUSTRY_BY_KEY.farm.output * TRANSPORT.rail.throughput, 6);
  });

  it("falls back to road and revokes the rail VP when the rail breaks", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10, 1);
    run(track, "rail", 6, 20, 12, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
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
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(1);
    run(track, "rail", 6, 20, 12, 1);
    const events = rescore(state, score);
    expect(events[0]).toMatchObject({ type: "upgraded", from: "road", to: "rail", delta: 2 });
    expect(vpFor(score, "p1")).toBe(3);
  });
});

describe("E6 overlapping catchments split output proportionally", () => {
  function twoClaimants() {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    // W2: each player runs its OWN line to its OWN factory. They meet at
    // (12,10); p2 builds it last and owns the shared tile, so p1's component
    // stops at x=11 and p2's starts at x=12 — both harvesters stay serviced
    // over their own track, which is exactly what the split presumes.
    run(track, "road", 6, 12, 10, 1);
    run(track, "road", 12, 20, 10, 2);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11), H(2, "p2", 13, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 6, ty: 11 }, { owner: "p2", ownerId: 2, tx: 20, ty: 11 }],
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
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    expect(rescore(state, score)).toHaveLength(1);
    expect(rescore(state, score)).toEqual([]);
    expect(rescore(state, score)).toEqual([]);
    expect(vpFor(score, "p1")).toBe(1);
  });

  it("debits VP when the harvester itself is removed", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
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
    const grid = flatGrid([ind("farm", 12, 11), ind("forest", 26, 11)]);
    const track = createTrack();
    // W2: two players on the same physical corridor, each over its OWN track.
    // (K0: coords kept inside the 32×32 map; p2's run re-owns the overlap
    // 22..26 exactly as the old 30..40 overlap did on the 48×48 map.)
    run(track, "road", 6, 26, 10, 1);
    run(track, "road", 22, 30, 10, 2);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11), H(2, "p2", 25, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }, { owner: "p2", ownerId: 2, tx: 30, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(1);
    expect(vpFor(score, "p2")).toBe(1);
  });

  it("does not connect a harvester to a rival's factory", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p2", ownerId: 2, tx: 20, ty: 11 }],   // rival's only
    };
    const comp = buildAllComponents(track, 1);
    expect(resolveConnection(state, comp, state.harvesters[0]).kind).toBeNull();
    expect(playerResources(state, "p1", 0)).toEqual({});
  });

  it("harvesterYield reports servicing and connection for the UI", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "road", 6, 20, 10, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const y = harvesterYield(
      state, buildAllComponents(track, 1), claimantCounts(state), state.harvesters[0], 0,
    );
    expect(y.serviced).toBe(true);
    expect(y.connection.kind).toBe("road");
    expect(y.yields.grain).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// TK-008 — Blockade auto-routing. The game has exactly ONE rival, so buying a
// Blockade must not wait for a map click: it lands on the industry that costs
// the rival the most, computed with the same share arithmetic the economy
// scores with. These tests pin the pick, not the UI wiring (the DOM test in
// iso-game.test.ts covers the no-crosshair purchase flow).
// ══════════════════════════════════════════════════════════════════════════
describe("TK-008 Blockade auto-targeting", () => {
  /** p2 owns two harvesters on one trunk line: a farm (output 1.0) and an ore
   *  mine (0.8), each in exactly one harvester's catchment — clean split. */
  function rivalState() {
    const farm = ind("farm", 12, 11);          // output 1.0
    const ore = ind("ore_mine", 15, 11);       // output 0.8
    const grid = flatGrid([farm, ore]);
    const track = createTrack();
    run(track, "road", 6, 20, 10, 2);          // p2's trunk line
    const harvesters = [H(1, "p2", 11, 11), H(2, "p2", 14, 11)];
    const factories: Factory[] = [{ owner: "p2", ownerId: 2, tx: 20, ty: 11 }];
    const state: EconomyState = { grid, track, harvesters, factories };
    return { state, grid, farm, ore };
  }

  it("industryClaimValues reports each industry's share of the rival's harvest", () => {
    const { state, grid, farm, ore } = rivalState();
    const values = industryClaimValues(state, "p2", 0);
    expect(values.get(farm.id)).toBeCloseTo(1.0, 6);
    expect(values.get(ore.id)).toBeCloseTo(0.8, 6);
    // the sum equals the rival's per-cargo yield
    const res = playerResources(state, "p2", 0);
    expect(res.grain).toBeCloseTo(1.0, 6);
    expect(res.ore).toBeCloseTo(0.8, 6);
    // and an unserviced owner gets nothing
    expect(industryClaimValues(state, "nobody", 0).size).toBe(0);
    void grid;
  });

  it("targets the rival's most valuable industry (farm beats ore mine)", () => {
    const { state, farm } = rivalState();
    expect(pickBlockadeTarget(state, "p2", 0)?.id).toBe(farm.id);
  });

  it("skips an already-blockaded industry and moves to the next", () => {
    const { state, grid, ore } = rivalState();
    grid.industries[0].banditUntil = 5_000;    // the farm is blockaded
    expect(pickBlockadeTarget(state, "p2", 1_000)?.id).toBe(ore.id);
  });

  it("falls back to the best industry the rival is about to serve when nothing yields", () => {
    const farm = ind("farm", 12, 11);
    const ore = ind("ore_mine", 15, 11);
    const grid = flatGrid([farm, ore]);
    const state: EconomyState = {
      grid, track: createTrack(),              // no track: nothing yields yet
      harvesters: [H(1, "p2", 11, 11), H(2, "p2", 14, 11)],
      factories: [],
    };
    expect(industryClaimValues(state, "p2", 0).size).toBe(0);
    // highest output inside a catchment the rival already owns a harvester for
    expect(pickBlockadeTarget(state, "p2", 0)?.id).toBe(farm.id);
  });

  it("falls back to the industry nearest the rival factory when it owns nothing", () => {
    const near = ind("farm", 12, 11);
    const far = ind("gold_mine", 28, 28);
    const grid = flatGrid([near, far]);
    const state: EconomyState = {
      grid, track: createTrack(),
      harvesters: [],
      factories: [{ owner: "p2", ownerId: 2, tx: 13, ty: 11 }],
    };
    expect(pickBlockadeTarget(state, "p2", 0)?.id).toBe(near.id);
  });

  it("returns null when there is nothing left to block", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const state: EconomyState = {
      grid, track: createTrack(), harvesters: [], factories: [],
    };
    expect(pickBlockadeTarget(state, "p2", 0)).toBeNull();
    // an owner with factories but every industry already blockaded → null too
    const allBlocked = flatGrid([ind("farm", 12, 11, 9_999)]);
    const s2: EconomyState = {
      grid: allBlocked, track: createTrack(), harvesters: [],
      factories: [{ owner: "p2", ownerId: 2, tx: 13, ty: 11 }],
    };
    expect(pickBlockadeTarget(s2, "p2", 1_000)).toBeNull();
  });
});
