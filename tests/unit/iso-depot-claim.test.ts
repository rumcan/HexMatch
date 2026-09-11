// ══════════════════════════════════════════════════════════════════════════
// PP-16 — one Depot holds one industry, and the first road at the resource
// takes it.
//
// The ask: "only allow 1 player to build a depot next to an industry and only
// 1 — as soon as the depot is built no other ones can be built there." The
// economy used to answer a crowd of depots on one farm by cutting the output
// into slices, which left every player earning a fraction of everything and
// nothing decided by who got there first. Now an industry has ONE holder, so a
// second Depot beside it would be a building that harvests nothing — the game
// refuses it, with a reason.
//
// Two edges of the rule matter as much as the rule:
//   • a lock is a ROAD. A Depot plonked on open ground with no track beside it
//     produces nothing, so it claims nothing: nobody can wall off a district by
//     parking buildings on it. The claim arrives with the connection, which is
//     also why the rival's planning (`planCandidates`) only chases free ground;
//   • nothing is stored. `industryLocks` is derived from the world on every
//     read, so demolishing the road that serviced a Depot releases everything
//     it held, and a save file needs no new field.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { createTrack, buildTile, demolishTile, tIdx, type Track } from "../../src/iso/track";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";
import {
  industryLocks, heldIndustries, lockedIndustryIds, isServiced,
  type EconomyState, type Harvester,
} from "../../src/iso/economy";
import { planDepotPlacement, placementReasonText } from "../../src/iso/placement";

const REASON_TEXT = { "industry-taken": placementReasonText("industry-taken") };

function flatGrid(industries: Industry[]): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
    }
  });
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, occupancy, seed: 1,
  };
}

const ind = (type: string, tx: number, ty: number): Industry => {
  const def = INDUSTRY_BY_KEY[type];
  return { id: 0, type, tx, ty, w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0 };
};

const H = (id: number, owner: string, tx: number, ty: number): Harvester =>
  ({ id, owner, ownerId: owner === "p1" ? 1 : 2, tx, ty });

/**
 * A Farm is 4×4 (PP-12: the footprint is the art's), so the block at (12,11)
 * covers 12..15 × 11..14. A Depot must stand on free ground whose 4×4
 * catchment OVERLAPS that block: SITE_A touches it from the west, SITE_B from
 * the east, and neither reaches anything else — which is the whole point of the
 * fixture. The Ore Mine (3×3) far away at (50,50) is the free industry a later
 * Depot may still go and claim.
 */
const FARM: [number, number] = [12, 11];
const SITE_A: [number, number] = [11, 11];
const SITE_B: [number, number] = [16, 11];
const ORE: [number, number] = [50, 50];
const SITE_ORE: [number, number] = [49, 50];

const world = (harvesters: Harvester[], track: Track): EconomyState => ({
  grid: flatGrid([ind("farm", ...FARM), ind("ore_mine", ...ORE)]),
  track, harvesters, factories: [],
});

const roadBeside = (t: Track, owner: number, tx: number, ty: number) => {
  buildTile(t, "dirt", tx, ty - 1, owner);
  return t;
};

describe("PP-16 the claim is the road", () => {
  it("a serviced Depot locks every industry in its catchment", () => {
    const track = roadBeside(createTrack(), 1, SITE_A[0], SITE_A[1]);
    const state = world([H(1, "p1", ...SITE_A)], track);
    expect(isServiced(track, state.harvesters[0])).toBe(true);
    expect([...industryLocks(state).keys()]).toEqual([0]);
    expect(lockedIndustryIds(state)).toEqual(new Set([0]));
  });

  it("a Depot with no road at it locks nothing", () => {
    const state = world([H(1, "p1", ...SITE_A)], createTrack());
    expect(industryLocks(state).size).toBe(0);
    expect(lockedIndustryIds(state).size).toBe(0);
  });

  it("the first Depot in the list holds it; a later one holds nothing", () => {
    const track = createTrack();
    roadBeside(track, 1, SITE_A[0], SITE_A[1]);
    roadBeside(track, 2, SITE_B[0], SITE_B[1]);
    const state = world([H(1, "p1", ...SITE_A), H(2, "p2", ...SITE_B)], track);
    const locks = industryLocks(state);
    expect(locks.get(0)?.owner).toBe("p1");
    expect(heldIndustries(state, state.harvesters[0], locks).map((i) => i.id)).toEqual([0]);
    expect(heldIndustries(state, state.harvesters[1], locks)).toEqual([]);
  });

  it("tearing up the road releases the industry", () => {
    const track = roadBeside(createTrack(), 1, SITE_A[0], SITE_A[1]);
    const state = world([H(1, "p1", ...SITE_A)], track);
    expect(lockedIndustryIds(state)).toEqual(new Set([0]));
    demolishTile(track, "dirt", SITE_A[0], SITE_A[1] - 1);
    expect(lockedIndustryIds(state).size).toBe(0);
  });
});

describe("PP-16 the placement follows the claim", () => {
  it("refuses a Depot whose whole catchment is held, and says why", () => {
    const track = roadBeside(createTrack(), 1, SITE_A[0], SITE_A[1]);
    const state = world([H(1, "p1", ...SITE_A)], track);
    const grid = state.grid;
    // the same ground is legal while nobody holds it
    expect(planDepotPlacement(grid, [], ...SITE_B).valid).toBe(true);
    const plan = planDepotPlacement(grid, state.harvesters, ...SITE_B,
      { locked: lockedIndustryIds(state) });
    expect(plan.valid).toBe(false);
    expect(plan.code).toBe("industry-taken");
    expect(plan.why).toBe(REASON_TEXT["industry-taken"]);
    expect(plan.why).toMatch(/already holds/);
    // the refusal is per site, and the footprint tile carries the same sentence
    expect(plan.footprint).toHaveLength(1);
    expect(plan.footprint[0].ok).toBe(false);
    expect(plan.footprint[0].why).toBe(REASON_TEXT["industry-taken"]);
  });

  it("allows a Depot that claims at least one free industry", () => {
    const track = roadBeside(createTrack(), 1, SITE_A[0], SITE_A[1]);
    const state = world([H(1, "p1", ...SITE_A)], track);
    // beside the ore mine — far from the farm, and nobody holds it
    const plan = planDepotPlacement(state.grid, state.harvesters, ...SITE_ORE,
      { locked: lockedIndustryIds(state) });
    expect(plan.code).toBeNull();
    expect(plan.valid).toBe(true);
    expect(plan.served.map((i) => i.id)).toEqual([1]);
  });

  it("a roadless Depot cannot wall a district off", () => {
    const state = world([H(1, "p1", ...SITE_A)], createTrack());
    const plan = planDepotPlacement(state.grid, state.harvesters, ...SITE_B,
      { locked: lockedIndustryIds(state) });
    expect(plan.valid).toBe(true);
  });

  it("an empty catchment is still the emptier refusal", () => {
    const track = roadBeside(createTrack(), 1, SITE_A[0], SITE_A[1]);
    const state = world([H(1, "p1", ...SITE_A)], track);
    const plan = planDepotPlacement(state.grid, [], 60, 60,
      { locked: lockedIndustryIds(state) });
    expect(plan.code).toBe("no-industry-in-catchment");
  });
});
