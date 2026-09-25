// ══════════════════════════════════════════════════════════════════════════
// #400 — a rail platform is a Depot for claiming, never a stronger one.
//
// Building a platform at an industry the other seat holds used to be legal
// (a second Depot there is refused) and, when the platform stood earlier in
// the harvester list, it took the industry: the other seat's Depot stopped
// paying, with no Challenge and no battle. Both directions. The rule now is
// the Depot's own: `lockedIndustryIdsFor` / `industry-taken`. The only way
// past it is a first battle win (`siteRights`), which shares the site and
// does not close the holder's Depot. A platform must not mint a held-alone
// ★ (`contestedHolds`) by switching the other seat off.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { createTrack, buildTile, tIdx, type Track } from "../../src/iso/track";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";
import {
  industryLocks, heldIndustries, lockedIndustryIdsFor, playerResources,
  type EconomyState, type Harvester, type Factory,
} from "../../src/iso/economy";
import {
  createRailState, platformRefusal, placePlatform, RAIL_REFUSAL_TEXT,
  type RailState, type RailView,
} from "../../src/iso/rail";
import { depotEntranceTiles, type DepotFacing } from "../../src/iso/depot";
import { planDepotPlacement } from "../../src/iso/placement";
import { grantIndustryWin } from "../../src/iso/battle-map";
import { contestedHolds } from "../../src/iso/victory";
import { planRailMove, executeRailMove, railTargets, planCandidates } from "../../src/iso/ai";

/** The Depot click's industry-taken toast (`placeHarvester`). One sentence. */
const DEPOT_TAKEN = "That industry is already claimed — only one Depot may hold it.";

function flatGrid(industries: Industry[]): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
  });
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, towns: [], occupancy, seed: 1,
  };
}

const ind = (type: string, tx: number, ty: number): Industry => {
  const def = INDUSTRY_BY_KEY[type];
  return { id: 0, type, tx, ty, w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0 };
};

/**
 * Farm 4×4 at (12, 11) covers 12..15 × 11..14. The truck Depot at (10, 11)
 * shares its east edge with the farm and opens NE onto the trunk on row 10
 * — the economy test's own connected fixture, so "running" is a real yield,
 * not a flag. The platform spot (18, 11) heading se is within anchor range
 * (3) and clear of that trunk.
 */
const FARM: [number, number] = [12, 11];
const DEPOT: [number, number] = [10, 11];
const FACING: DepotFacing = "ne";
const PLATFORM: [number, number] = [18, 11];
const VIEW: RailView = "se";

const gate = depotEntranceTiles(DEPOT[0], DEPOT[1], FACING)[0];

function trunk(track: Track, ownerId: number) {
  for (let x = 6; x <= 20; x++) buildTile(track, "dirt", x, 10, ownerId);
  buildTile(track, "dirt", gate[0], gate[1], ownerId);
}

interface Seat {
  id: string;
  ownerId: number;
}

const YOU: Seat = { id: "you", ownerId: 1 };
const RIVAL: Seat = { id: "rival", ownerId: 2 };

function world(holder: Seat, attacker: Seat): {
  eco: EconomyState;
  holderDepot: Harvester;
  rail: RailState;
  factory: Factory;
} {
  const grid = flatGrid([ind("farm", ...FARM)]);
  const track = createTrack();
  trunk(track, holder.ownerId);
  const holderDepot: Harvester = {
    id: 1, owner: holder.id, ownerId: holder.ownerId, tx: DEPOT[0], ty: DEPOT[1], facing: FACING,
  };
  const factory: Factory = { owner: holder.id, ownerId: holder.ownerId, tx: 20, ty: 11, id: 0 };
  const rail = createRailState();
  const eco: EconomyState = {
    grid, track, harvesters: [holderDepot], factories: [factory], rail, dams: [],
  };
  // The attacker is named so a later platform records the other seat. Unused
  // until a test pushes one — kept on the fixture so both directions share it.
  void attacker;
  return { eco, holderDepot, rail, factory };
}

const grain = (eco: EconomyState, owner: string) => playerResources(eco, owner, 0).grain ?? 0;

/** What the click, the preview and the host ask: may this seat place here? */
function refusal(eco: EconomyState, seat: Seat, tx = PLATFORM[0], ty = PLATFORM[1], view: RailView = VIEW) {
  return platformRefusal(
    eco.grid, eco.rail!.structures, eco.factories, seat.ownerId, tx, ty, view, undefined,
    lockedIndustryIdsFor(eco, seat.id),
  );
}

describe("#400 a platform never takes a held industry", () => {
  it("refuses in the Depot's own words", () => {
    const { eco } = world(RIVAL, YOU);
    expect(refusal(eco, YOU)).toBe("industry-taken");
    expect(RAIL_REFUSAL_TEXT["industry-taken"]).toBe(DEPOT_TAKEN);
    // The second-Depot spot on the farm's east side is the same refusal.
    const depotPlan = planDepotPlacement(eco.grid, eco.harvesters, 16, 11, {
      locked: lockedIndustryIdsFor(eco, YOU.id),
    });
    expect(depotPlan.code).toBe("industry-taken");
  });

  it("player platform vs rival Depot: no takeover, and the Depot keeps running", () => {
    const { eco, holderDepot } = world(RIVAL, YOU);
    const before = grain(eco, RIVAL.id);
    expect(before).toBeGreaterThan(0);
    expect(refusal(eco, YOU)).toBe("industry-taken");
    // The click stops here. Nothing was built, nothing was closed.
    expect(eco.rail!.structures).toHaveLength(0);
    expect(holderDepot.closed).toBeFalsy();
    expect(industryLocks(eco).get(0)?.owner).toBe(RIVAL.id);
    expect(grain(eco, RIVAL.id)).toBe(before);
    expect(contestedHolds(eco)).toEqual([]);

    // The old bug, forced: a platform record earlier in the list used to
    // become the lock and zero the Depot. A platform is not stronger.
    const stolen: Harvester = {
      id: 9, owner: YOU.id, ownerId: YOU.ownerId, tx: PLATFORM[0], ty: PLATFORM[1],
      platformId: 1, railIndustryId: 0,
    };
    eco.harvesters.unshift(stolen);
    expect(industryLocks(eco).get(0)?.id).toBe(holderDepot.id);
    expect(heldIndustries(eco, holderDepot, industryLocks(eco)).map((i) => i.id)).toEqual([0]);
    expect(heldIndustries(eco, stolen, industryLocks(eco))).toEqual([]);
    expect(holderDepot.closed).toBeFalsy();
    expect(grain(eco, RIVAL.id)).toBe(before);
    expect(grain(eco, YOU.id)).toBe(0);
    expect(contestedHolds(eco)).toEqual([]);
    expect(eco.siteRights).toBeUndefined();
  });

  it("rival platform vs player Depot: no takeover, and the Depot keeps running", () => {
    const { eco, holderDepot } = world(YOU, RIVAL);
    const before = grain(eco, YOU.id);
    expect(before).toBeGreaterThan(0);
    expect(refusal(eco, RIVAL)).toBe("industry-taken");
    expect(holderDepot.closed).toBeFalsy();
    expect(industryLocks(eco).get(0)?.owner).toBe(YOU.id);
    expect(grain(eco, YOU.id)).toBe(before);
    expect(contestedHolds(eco)).toEqual([]);

    const stolen: Harvester = {
      id: 9, owner: RIVAL.id, ownerId: RIVAL.ownerId, tx: PLATFORM[0], ty: PLATFORM[1],
      platformId: 1, railIndustryId: 0,
    };
    eco.harvesters.unshift(stolen);
    expect(industryLocks(eco).get(0)?.id).toBe(holderDepot.id);
    expect(heldIndustries(eco, stolen, industryLocks(eco))).toEqual([]);
    expect(holderDepot.closed).toBeFalsy();
    expect(grain(eco, YOU.id)).toBe(before);
    expect(grain(eco, RIVAL.id)).toBe(0);
    expect(contestedHolds(eco)).toEqual([]);
  });

  it("platform vs platform: the holder's platform keeps the industry", () => {
    const { eco, rail } = world(RIVAL, YOU);
    // The rival holds with a platform, not a truck Depot.
    eco.harvesters = [{
      id: 3, owner: RIVAL.id, ownerId: RIVAL.ownerId, tx: 16, ty: 12,
      platformId: 1, railIndustryId: 0,
    }];
    const holder = eco.harvesters[0];
    placePlatform(rail, RIVAL.id, RIVAL.ownerId, 16, 12, "se", {
      kind: "industry", id: 0, tiles: [[12, 11]],
    });
    expect(industryLocks(eco).get(0)?.id).toBe(holder.id);

    expect(refusal(eco, YOU)).toBe("industry-taken");
    expect(RAIL_REFUSAL_TEXT["industry-taken"]).toBe(DEPOT_TAKEN);

    const attack: Harvester = {
      id: 9, owner: YOU.id, ownerId: YOU.ownerId, tx: PLATFORM[0], ty: PLATFORM[1],
      platformId: 2, railIndustryId: 0,
    };
    // Placed after the holder, the way a click would push it. Equal structures
    // break ties by build order; the later one must not take the industry.
    eco.harvesters.push(attack);
    expect(industryLocks(eco).get(0)?.id).toBe(holder.id);
    expect(heldIndustries(eco, holder, industryLocks(eco)).map((i) => i.id)).toEqual([0]);
    expect(heldIndustries(eco, attack, industryLocks(eco))).toEqual([]);
    expect(holder.closed).toBeFalsy();
    expect(contestedHolds(eco)).toEqual([]);
    expect(eco.siteRights).toBeUndefined();
  });

  it("a first battle win shares the site: the platform may be built, and the Depot keeps running", () => {
    const { eco, holderDepot, rail } = world(RIVAL, YOU);
    const before = grain(eco, RIVAL.id);
    expect(before).toBeGreaterThan(0);
    // The player wins the industry once. Rights, not a close — the How to
    // Play card's first win. No held-alone star is minted by a platform;
    // the one contested hold is the battle's own.
    expect(grantIndustryWin(eco, 0, YOU.id, RIVAL.id)).toBe("rights");
    expect(holderDepot.closed).toBeFalsy();
    expect(eco.siteRights?.get(0)?.rights.sort()).toEqual([RIVAL.id, YOU.id].sort());
    const holdsBefore = contestedHolds(eco).map((h) => h.owner);

    expect(lockedIndustryIdsFor(eco, YOU.id).has(0)).toBe(false);
    expect(refusal(eco, YOU)).toBe("ok");
    const built = placePlatform(rail, YOU.id, YOU.ownerId, PLATFORM[0], PLATFORM[1], VIEW, {
      kind: "industry", id: 0, tiles: [[12, 11]],
    });
    eco.harvesters.push({
      id: 9, owner: YOU.id, ownerId: YOU.ownerId, tx: built.tx, ty: built.ty,
      platformId: built.id, railIndustryId: 0,
    });

    expect(holderDepot.closed).toBeFalsy();
    const locks = industryLocks(eco);
    expect(locks.get(0)?.id).toBe(holderDepot.id);
    expect(heldIndustries(eco, holderDepot, locks).map((i) => i.id)).toEqual([0]);
    const platform = eco.harvesters.find((h) => h.platformId === built.id)!;
    expect(heldIndustries(eco, platform, locks).map((i) => i.id)).toEqual([0]);
    expect(grain(eco, RIVAL.id)).toBe(before);
    // The battle's hold is unchanged — the platform did not close the Depot
    // and did not create a second "held alone" star.
    expect(contestedHolds(eco).map((h) => h.owner)).toEqual(holdsBefore);
    expect(eco.siteRights?.get(0)?.rights).toContain(RIVAL.id);
  });

  it("a second win closes a platform the way it closes a Depot", () => {
    const { eco } = world(YOU, RIVAL);
    eco.harvesters = [{
      id: 4, owner: YOU.id, ownerId: YOU.ownerId, tx: PLATFORM[0], ty: PLATFORM[1],
      platformId: 1, railIndustryId: 0,
    }];
    const platform = eco.harvesters[0];
    expect(grantIndustryWin(eco, 0, RIVAL.id, YOU.id)).toBe("rights");
    expect(platform.closed).toBeFalsy();
    expect(grantIndustryWin(eco, 0, RIVAL.id, YOU.id)).toBe("closed");
    expect(platform.closed).toBe(true);
    expect(industryLocks(eco).has(0)).toBe(false);
  });
});

describe("#400 the rival follows the same rule", () => {
  /** Industry the road can only reach expensively, so it is a rail target
   *  unless the claim rule takes it off the list. */
  function far(): { eco: EconomyState; rail: RailState; factory: Factory } {
    const grid = flatGrid([ind("farm", 60, 40)]);
    const track = createTrack();
    const rail = createRailState();
    const factory: Factory = { owner: "ai", ownerId: 2, tx: 30, ty: 40, id: 0 };
    // The player's Depot, serviced, holds the far industry.
    buildTile(track, "dirt", 58, 40, 1);
    const depot: Harvester = {
      id: 1, owner: "you", ownerId: 1, tx: 58, ty: 41, facing: "ne",
    };
    // Entrance of a lot at (58, 41) facing ne is row 40 — the tile just laid.
    const eco: EconomyState = {
      grid, track, harvesters: [depot], factories: [factory], rail, dams: [],
    };
    return { eco, rail, factory };
  }

  it("never plans a platform at a site the other seat holds", () => {
    const { eco, rail, factory } = far();
    expect(industryLocks(eco).get(0)?.owner).toBe("you");
    expect(railTargets(eco, rail, factory, { ore: 99, stone: 99, wood: 99, oil: 99 }, 2)).toEqual([]);
    expect(planRailMove(eco, rail, factory, {
      purse: { ore: 99, stone: 99, wood: 99, oil: 99 }, ownerId: 2, useRail: true,
    })).toBeNull();
    // A hand-built move — the plan from before the industry was taken — is
    // refused on execute, the same belt `executeCandidate` keeps for Depots.
    const spot = { tx: 64, ty: 40, view: "se" as const };
    expect(platformRefusal(
      eco.grid, rail.structures, eco.factories, 2, spot.tx, spot.ty, spot.view, undefined,
      lockedIndustryIdsFor(eco, "ai"),
    )).toBe("industry-taken");
    expect(executeRailMove(eco, rail, {
      kind: "platform", tx: spot.tx, ty: spot.ty, view: spot.view,
      anchor: { kind: "industry", id: 0, tiles: [] }, cost: {},
    }, "ai", 2)).toBeNull();
    expect(rail.structures).toHaveLength(0);

    // The road planner is the same rule: no route is searched for it.
    const cands = planCandidates(eco, factory, {
      stock: {}, purse: { ore: 99, stone: 99, wood: 99, oil: 99, grain: 99 },
    });
    expect(cands.every((c) => c.industry.id !== 0)).toBe(true);
  });

  it("after a first win the held site is a target again — the same exception a Depot gets", () => {
    const { eco, rail, factory } = far();
    grantIndustryWin(eco, 0, "ai", "you");
    expect(lockedIndustryIdsFor(eco, "ai").has(0)).toBe(false);
    const targets = railTargets(eco, rail, factory, { ore: 99, stone: 99, wood: 99, oil: 99 }, 2);
    expect(targets.map((i) => i.id)).toContain(0);
  });
});
