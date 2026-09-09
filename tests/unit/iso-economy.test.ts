import { describe, it, expect } from "vitest";
import {
  CATCHMENT, catchmentRect, industriesInCatchment, isServiced,
  buildComponents, buildAllComponents, linkedBy, resolveConnection,
  claimantCounts, harvesterYield, playerResources,
  industryClaimValues, pickBlockadeTarget,
  createScoreState, rescore, vpFor,
  type EconomyState, type Harvester, type Factory,
} from "../../src/iso/economy";
import {
  createTrack, buildTile, demolishTile, tIdx, PUBLIC_OWNER, type Track,
} from "../../src/iso/track";
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
const run = (t: Track, kind: "dirt" | "road", x0: number, x1: number, y: number, owner: number = 0) => {
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

  it("catches an industry whose footprint merely overlaps — credited once, not per tile", () => {
    const farm = ind("farm", 11, 11);          // 3×3 (MT-2: footprint = the OpenTTD layout)
    const grid = flatGrid([farm]);
    // catchment of (10,10) is 9..12 — overlaps the farm's top-left corner only,
    // yet the 3×3 farm is credited a single time (not once per overlapped tile).
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
  it("requires adjacency to at least one dirt or road tile", () => {
    const t = createTrack();
    const h = H(0, "p1", 10, 10);
    expect(isServiced(t, h)).toBe(false);
    buildTile(t, "dirt", 11, 10, 1);
    expect(isServiced(t, h)).toBe(true);
  });

  it("accepts road adjacency too, but not a diagonal", () => {
    const t = createTrack();
    buildTile(t, "road", 11, 11);
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(false);
    buildTile(t, "road", 10, 11, 1);
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(true);
  });

  // W2: a RIVAL's line beside your harvester does not service it.
  it("does not count another player's adjacent track as service", () => {
    const t = createTrack();
    buildTile(t, "dirt", 11, 10, 2);            // the rival's dirt
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(false);
    buildTile(t, "dirt", 11, 10, 1);            // own the tile: now serviced
    expect(isServiced(t, H(0, "p1", 10, 10))).toBe(true);
  });
});

describe("E6 connected components (merged surface)", () => {
  it("gives one id to a contiguous run and different ids to separate ones", () => {
    const t = createTrack();
    run(t, "dirt", 5, 9, 10);
    run(t, "dirt", 20, 24, 10);
    const { comp } = buildComponents(t, 0);
    expect(comp[tIdx(5, 10)]).toBe(comp[tIdx(9, 10)]);
    expect(comp[tIdx(20, 10)]).not.toBe(comp[tIdx(5, 10)]);
    expect(comp[tIdx(15, 10)]).toBe(-1);
  });

  it("never merges across a one-sided bit", () => {
    const t = createTrack();
    run(t, "dirt", 5, 6, 10);
    t.dirt[tIdx(6, 10)] |= 2;                 // forge SE toward an empty tile
    const { comp } = buildComponents(t, 0);
    expect(comp[tIdx(7, 10)]).toBe(-1);
  });

  it("marks only components that contain pavement, and floods across the seam", () => {
    // Gravel and tar are ONE surface: a gravel run and a separate paved run
    // are two components, and only the paved one carries the road marker.
    const t = createTrack();
    run(t, "dirt", 5, 9, 10);                 // pure gravel run
    run(t, "road", 20, 24, 10);               // separate paved run
    const c = buildAllComponents(t, 0);
    const dirtId = c.comp[tIdx(5, 10)];
    expect(dirtId).toBeGreaterThanOrEqual(0);
    expect(c.comp[tIdx(9, 10)]).toBe(dirtId);
    expect(c.roadComp[dirtId]).toBe(0);       // pure gravel: no paved marker
    const roadId = c.comp[tIdx(20, 10)];
    expect(roadId).not.toBe(dirtId);
    expect(c.roadComp[roadId]).toBe(1);       // paved run IS marked
  });

  it("paving over the middle of a gravel run keeps it ONE merged component", () => {
    // A tile holds ONE tier (paving replaces the gravel), yet the surface is
    // continuous: the two gravel stubs both face the paved centre, so the
    // whole dirt—road—dirt line is one component — now a PAVED one.
    const t = createTrack();
    run(t, "dirt", 5, 9, 10);
    buildTile(t, "road", 7, 10);              // pave over the junction
    const c = buildAllComponents(t, 0);
    const id = c.comp[tIdx(5, 10)];
    expect(c.comp[tIdx(9, 10)]).toBe(id);
    expect(c.comp[tIdx(7, 10)]).toBe(id);
    expect(c.roadComp[id]).toBe(1);
  });

  it("linkedBy joins two structures beside the same component", () => {
    const t = createTrack();
    run(t, "dirt", 5, 15, 10);
    const { comp } = buildComponents(t, 0);
    // both sit just above the dirt run
    expect(linkedBy(comp, 6, 9, 14, 9)).toBe(true);
    expect(linkedBy(comp, 6, 9, 30, 30)).toBe(false);   // K0: 32×32 map
  });

  // W2 acceptance: two players' lines that TOUCH each other are still two
  // components — one per owner. The flood that scores connections can never
  // run across the border.
  it("never merges two players' touching lines (owner boundary)", () => {
    const t = createTrack();
    run(t, "dirt", 5, 9, 10, 1);              // p1's run
    run(t, "dirt", 10, 14, 10, 2);            // p2's run, adjacent at x=9/10
    const c1 = buildComponents(t, 1);
    const c2 = buildComponents(t, 2);
    // each player sees its own run, in its own component
    expect(c1.comp[tIdx(9, 10)]).toBeGreaterThanOrEqual(0);
    expect(c2.comp[tIdx(10, 10)]).toBeGreaterThanOrEqual(0);
    // neither player's flood crosses into the other's tiles
    expect(c1.comp[tIdx(10, 10)]).toBe(-1);
    expect(c2.comp[tIdx(9, 10)]).toBe(-1);
  });

  it("W2: a rival's PAVED tile beside your dirt is not part of your component", () => {
    // The masks face across the tier boundary, but the merged flood is still
    // owner-scoped: p1's dirt never joins p2's adjacent pavement, so p1's
    // connection can never ride the rival's paving (or score its VP).
    const t = createTrack();
    run(t, "dirt", 5, 9, 10, 1);              // p1's gravel run
    run(t, "road", 10, 14, 10, 2);            // p2's paved run, touching at x=9/10
    const mine = buildComponents(t, 1);
    expect(mine.comp[tIdx(9, 10)]).toBeGreaterThanOrEqual(0);
    expect(mine.comp[tIdx(10, 10)]).toBe(-1); // rival paving excluded
    // and the rival, on its own flood, sees only its own paving
    const theirs = buildComponents(t, 2);
    expect(theirs.comp[tIdx(10, 10)]).toBeGreaterThanOrEqual(0);
    expect(theirs.comp[tIdx(9, 10)]).toBe(-1);
  });
});

describe("E6 acceptance", () => {
  /** Farm + harvester + a dirt to the factory — all p1's, all owned by p1. */
  function scenario(kind: "dirt" | "road" = "dirt") {
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

  it("a road path scores 3 VP and applies the 1.6× multiplier", () => {
    const { state } = scenario("road");
    const comp = buildAllComponents(state.track, 1);
    const conn = resolveConnection(state, comp, state.harvesters[0]);
    expect(conn.kind).toBe("road");
    expect(conn.vp).toBe(3);
    expect(conn.multiplier).toBe(1.6);
    const res = playerResources(state, "p1", 0);
    expect(res.grain).toBeCloseTo(INDUSTRY_BY_KEY.farm.output * 1.6, 6);
  });

  it("a dirt path scores 1 VP at 1.0×", () => {
    const { state } = scenario("dirt");
    const comp = buildAllComponents(state.track, 1);
    const conn = resolveConnection(state, comp, state.harvesters[0]);
    expect(conn.kind).toBe("dirt");
    expect(conn.vp).toBe(1);
    expect(conn.multiplier).toBe(1);
    expect(playerResources(state, "p1", 0).grain)
      .toBeCloseTo(INDUSTRY_BY_KEY.farm.output, 6);
  });

  it("demolishing one dirt tile mid-path stops output and revokes VP", () => {
    const { state, track } = scenario();
    const score = createScoreState();
    let events = rescore(state, score);
    expect(events).toEqual([
      { harvester: 1, type: "awarded", from: null, to: "dirt", delta: 1 },
    ]);
    expect(vpFor(score, "p1")).toBe(1);
    expect(playerResources(state, "p1", 0).grain).toBeGreaterThan(0);

    demolishTile(track, "dirt", 15, 10);      // cut the trunk mid-path
    events = rescore(state, score);
    expect(events).toEqual([
      { harvester: 1, type: "revoked", from: "dirt", to: null, delta: -1 },
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
  // player's own track; the rival must build its own dirt to connect."
  it("reaches an industry only over its own track, never the rival's", () => {
    const farm = ind("farm", 12, 11);
    const grid = flatGrid([farm]);
    const track = createTrack();
    // p1's full line: harvester → farm → its factory.
    run(track, "dirt", 6, 20, 10, 1);
    const p1Harv = H(1, "p1", 11, 11);
    const state: EconomyState = {
      grid, track,
      harvesters: [p1Harv],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    expect(playerResources(state, "p1", 0).grain).toBeGreaterThan(0);

    // p2 puts a harvester beside the SAME farm, right next to p1's line —
    // but p2 has built nothing. The rival's dirt must not count.
    state.harvesters.push(H(2, "p2", 13, 11));
    state.factories.push({ owner: "p2", ownerId: 2, tx: 28, ty: 11 });   // K0: ≤31
    expect(playerResources(state, "p2", 0)).toEqual({});
    const score = createScoreState();
    const events = rescore(state, score);
    // only p1's connection is scored; p2's unserviced harvester earns no VP
    expect(events.filter((e) => e.type === "awarded")).toHaveLength(1);
    expect(vpFor(score, "p1")).toBe(1);
    expect(vpFor(score, "p2")).toBe(0);

    // The moment p2 lays its OWN dirt home, it connects on its own.
    run(track, "dirt", 14, 28, 12, 2);
    run(track, "dirt", 14, 14, 11, 2);   // up from its line to beside the farm
    expect(playerResources(state, "p2", 0).grain).toBeGreaterThan(0);
  });

  // W2 acceptance: "demolishing your own dirt never disconnects the rival
  // (and vice-versa)". Two players share one farm from adjacent lines; each
  // tears down a tile of its OWN line and the other's connection survives.
  it("cutting one player's line leaves the other's connection intact", () => {
    const world = (): EconomyState => {
      const grid = flatGrid([ind("farm", 12, 11)]);
      const track = createTrack();
      run(track, "dirt", 6, 12, 10, 1);   // p1's line (they meet at x=12…)
      run(track, "dirt", 12, 20, 10, 2);  // …which p2 builds last and owns
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
    demolishTile(state.track, "dirt", 10, 10);
    expect(playerResources(state, "p1", 0)).toEqual({});
    expect(playerResources(state, "p2", 0).grain).toBeGreaterThan(0);

    // and vice-versa: p2's demolition cannot reach p1's connection
    state = world();
    demolishTile(state.track, "dirt", 14, 10);
    expect(playerResources(state, "p2", 0)).toEqual({});
    expect(playerResources(state, "p1", 0).grain).toBeGreaterThan(0);
  });
});

describe("E6 road beats dirt", () => {
  it("takes the road multiplier and VP when both paths exist", () => {
    const farm = ind("farm", 12, 11);
    const grid = flatGrid([farm]);
    const track = createTrack();
    run(track, "dirt", 6, 20, 10, 1);
    run(track, "road", 6, 20, 12, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],       // between both lines
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const comp = buildAllComponents(track, 1);
    expect(resolveConnection(state, comp, state.harvesters[0]).kind).toBe("road");
    expect(playerResources(state, "p1", 0).grain)
      .toBeCloseTo(INDUSTRY_BY_KEY.farm.output * TRANSPORT.road.throughput, 6);
  });

  it("falls back to dirt and revokes the road VP when the road breaks", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "dirt", 6, 20, 10, 1);
    run(track, "road", 6, 20, 12, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(3);

    demolishTile(track, "road", 15, 12);
    const events = rescore(state, score);
    expect(events).toEqual([
      { harvester: 1, type: "downgraded", from: "road", to: "dirt", delta: -2 },
    ]);
    expect(vpFor(score, "p1")).toBe(1);       // 3 revoked, 1 dirt awarded
  });

  it("upgrading dirt to road raises the VP", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "dirt", 6, 20, 10, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(1);
    run(track, "road", 6, 20, 12, 1);
    const events = rescore(state, score);
    expect(events[0]).toMatchObject({ type: "upgraded", from: "dirt", to: "road", delta: 2 });
    expect(vpFor(score, "p1")).toBe(3);
  });
});

describe("E6 best tier on path across the dirt↔paved seam", () => {
  it("a dirt feeder onto a public highway scores the road tier (intended reward)", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "road", 14, 20, 10, PUBLIC_OWNER);  // the shared highway
    run(track, "dirt", 6, 13, 10, 1);              // p1's gravel feeder to it
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],  // beside the highway
    };
    const comp = buildAllComponents(track, 1);
    const conn = resolveConnection(state, comp, state.harvesters[0]);
    expect(conn.kind).toBe("road");                // gravel + pavement on the path
    expect(conn.vp).toBe(TRANSPORT.road.vp);
    expect(conn.multiplier).toBe(TRANSPORT.road.throughput);
    expect(playerResources(state, "p1", 0).grain)
      .toBeCloseTo(INDUSTRY_BY_KEY.farm.output * TRANSPORT.road.throughput, 6);
    const score = createScoreState();
    expect(rescore(state, score)).toEqual([
      { harvester: 1, type: "awarded", from: null, to: "road", delta: 3 },
    ]);
  });

  it("a dirt feeder onto your OWN pavement is premium too", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "dirt", 6, 13, 10, 1);
    run(track, "road", 14, 20, 10, 1);             // p1 paves the far end itself
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const comp = buildAllComponents(track, 1);
    expect(resolveConnection(state, comp, state.harvesters[0]).kind).toBe("road");
    expect(playerResources(state, "p1", 0).grain)
      .toBeCloseTo(INDUSTRY_BY_KEY.farm.output * TRANSPORT.road.throughput, 6);
  });

  it("paved track elsewhere on the map does not upgrade a pure-dirt route", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "dirt", 6, 20, 10, 1);              // p1's pure gravel line
    run(track, "road", 14, 20, 14, 1);             // paved — but off the route
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const comp = buildAllComponents(track, 1);
    expect(resolveConnection(state, comp, state.harvesters[0]).kind).toBe("dirt");
    const score = createScoreState();
    expect(rescore(state, score)).toEqual([
      { harvester: 1, type: "awarded", from: null, to: "dirt", delta: 1 },
    ]);
  });

  it("cutting the feeder off the highway revokes the road VP", () => {
    const grid = flatGrid([ind("farm", 12, 11)]);
    const track = createTrack();
    run(track, "road", 14, 20, 10, PUBLIC_OWNER);
    run(track, "dirt", 6, 13, 10, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "p1")).toBe(3);

    demolishTile(track, "dirt", 13, 10);           // the tile that touches tar
    const events = rescore(state, score);
    expect(events).toEqual([
      { harvester: 1, type: "revoked", from: "road", to: null, delta: -3 },
    ]);
    expect(vpFor(score, "p1")).toBe(0);
    expect(playerResources(state, "p1", 0).grain).toBeUndefined();
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
    run(track, "dirt", 6, 12, 10, 1);
    run(track, "dirt", 12, 20, 10, 2);
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
    run(track, "dirt", 6, 20, 10, 1);
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
    run(track, "dirt", 6, 20, 10, 1);
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
      { harvester: 1, type: "revoked", from: "dirt", to: null, delta: -1 },
    ]);
    expect(vpFor(score, "p1")).toBe(0);
  });

  it("keeps players' VP separate", () => {
    const grid = flatGrid([ind("farm", 12, 11), ind("forest", 26, 11)]);
    const track = createTrack();
    // W2: two players on the same physical corridor, each over its OWN track.
    // (K0: coords kept inside the 32×32 map; p2's run re-owns the overlap
    // 22..26 exactly as the old 30..40 overlap did on the 48×48 map.)
    run(track, "dirt", 6, 26, 10, 1);
    run(track, "dirt", 22, 30, 10, 2);
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
    run(track, "dirt", 6, 20, 10, 1);
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
    run(track, "dirt", 6, 20, 10, 1);
    const state: EconomyState = {
      grid, track,
      harvesters: [H(1, "p1", 11, 11)],
      factories: [{ owner: "p1", ownerId: 1, tx: 20, ty: 11 }],
    };
    const y = harvesterYield(
      state, buildAllComponents(track, 1), claimantCounts(state), state.harvesters[0], 0,
    );
    expect(y.serviced).toBe(true);
    expect(y.connection.kind).toBe("dirt");
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
    run(track, "dirt", 6, 20, 10, 2);          // p2's trunk line
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
