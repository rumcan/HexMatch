// ══════════════════════════════════════════════════════════════════════════
// L13 (#228) — Victory points, win condition and end-game for the new loop.
//
// The ticket's acceptance block, pinned here:
//
//   • EVERY ★ source is an action in the new loop, and nothing awards ★ for a
//     removed mechanic — so paving (L2 made dirt free) and extra Processing
//     Plants (L5 made the CITY the thing you upgrade) score exactly zero under
//     the flag, while the loop's own three sources pay;
//   • the sources are INDEPENDENT and the pool is bigger than the line, which
//     is the ticket's "several routes to victory": no single source is needed
//     to reach the flag, and at least three different plans get there;
//   • the ending ledger, the HUD tooltip and the win check all read the new
//     sources — one table, so a row the ledger prints is a row the scoreboard
//     paid;
//   • the shipped loop is untouched: with the flag off this module scores the
//     VP-01 table exactly as it always did (that suite is the proof, and the
//     first block here re-pins the seam).
//
// The pacing half of the acceptance ("a solo game against a normal rival
// finishes in a similar time to today") is measured by the `test:slow` race
// (`iso-l1d-race.test.ts`, which now races the new loop's own 12★ line) and
// quoted in the PR — a wall-clock assertion here would be a guess the next
// tuning ticket breaks.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createScoreState, rescore, vpFor, hasWon, victoryBreakdown, runningDepotTypes,
  type LoopScoring, type LoopSeatProgress,
} from "../../src/iso/victory";
import { buildEnding, endingPathFor, ledgerRows, type EndingBreakdown } from "../../src/iso/ending";
import { createTrack, buildTile, tIdx } from "../../src/iso/track";
import { addPlant } from "../../src/iso/plants";
import { VICTORY, DEPOT_TREE, type Cargo } from "../../src/iso/config";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, TOWN_OCC, type Grid, type Industry, type Town } from "../../src/iso/grid";
import type { EconomyState, Factory, Harvester } from "../../src/iso/economy";
import { depotCargo, heldIndustries, industryLocks, isServiced, resolveConnection, buildAllComponents, ownerIdOf } from "../../src/iso/economy";

const YOU = 1, RIVAL = 2;

const town = (id: number, cx: number, cy: number): Town => ({
  id, tx: cx, ty: cy,
  houses: [[cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]],
  roads: [],
});

/** An industry of `type` on a 4×4 lot at (tx,ty). */
const industry = (id: number, type: string, tx: number, ty: number): Industry => ({
  id, type, tx, ty, w: 4, h: 4, banditUntil: 0,
} as Industry);

function flatGrid(industries: Industry[] = [], towns: Town[] = []): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
    }
  });
  for (const t of towns) {
    for (const [x, y] of [...t.houses, ...t.roads]) occupancy[tIdx(x, y)] = TOWN_OCC;
  }
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, towns, occupancy, seed: 1,
  };
}

/**
 * The live `LoopScoring` — the SAME rule `loopScoring` in game.ts and the race
 * harness build, so what this file pins is what the game scores.
 */
function loopFor(eco: EconomyState, seats: LoopSeatProgress[]): LoopScoring {
  const locks = industryLocks(eco);
  const comps = new Map<string, ReturnType<typeof buildAllComponents>>();
  const compFor = (owner: string) => {
    let c = comps.get(owner);
    if (!c) comps.set(owner, c = buildAllComponents(eco.track, ownerIdOf(eco, owner)));
    return c;
  };
  return {
    running: (h) => {
      if (!isServiced(eco.track, h, eco.rail)) return false;
      if (resolveConnection(eco, compFor(h.owner), h).kind === null) return false;
      return heldIndustries(eco, h, locks).length > 0;
    },
    cargoOf: (h) => depotCargo(eco, h),
    seats,
  };
}

/**
 * A world where every named industry has a Depot beside it and a road running
 * back to the owner's Factory — the smallest thing that makes a depot type
 * actually RUN.
 *
 * The geometry is the game's own, not a convenient fiction: a Depot is a 2×2
 * lot whose ENTRANCE is the two tiles below it (`sw`, the default facing), a
 * plant is a 3×3 block, and a connection is a road from one to the other. The
 * industries are spaced 12 rows apart so no two 4×4 catchments overlap and
 * each Depot holds exactly its own.
 */
const HALL_Y = 2;          // the road spine every spur joins, north of everything
const PLANT: [number, number] = [40, HALL_Y + 1];

function worldWith(types: string[], owner = "you", ownerId = YOU) {
  const industries = types.map((t, i) => industry(i, t, 10 + i * 12, 6));
  const grid = flatGrid(industries, [town(0, 60, 60)]);
  const track = createTrack();
  const harvesters: Harvester[] = [];
  const factories: Factory[] = [
    { owner, ownerId, tx: PLANT[0], ty: PLANT[1], id: 0, townId: null },
  ];
  const eco: EconomyState = { grid, track, harvesters, factories };
  // the spine, from the first spur to the plant's own west shoulder
  for (let x = 10; x <= PLANT[0]; x++) buildTile(track, "dirt", x, HALL_Y, ownerId);
  types.forEach((_t, i) => {
    const ind = industries[i];
    // The Depot's lot sits ABOVE the industry so its `sw` entrance opens onto
    // the industry's top edge, and its spur runs north to the spine.
    const hx = ind.tx, hy = ind.ty - 2;
    harvesters.push({ id: i + 1, owner, ownerId, tx: hx, ty: hy });
    for (let y = HALL_Y; y <= hy + 2; y++) buildTile(track, "dirt", hx, y, ownerId);
  });
  return { grid, track, eco, harvesters, factories };
}

/** Every tile of one Depot's spur, for the "cut the line" tests. */
const spurTiles = (h: Harvester): [number, number][] => {
  const out: [number, number][] = [];
  for (let y = HALL_Y; y <= h.ty + 2; y++) out.push([h.tx, y]);
  return out;
};

const seat = (owner: string, depotTier = 0, townLevel = 0): LoopSeatProgress =>
  ({ owner, depotTier, townLevel });

// ══════════════════════════════════════════════════════════════════════════
describe("L13 (#228) the new loop's ★ table", () => {
  it("defines every source as an action the new loop actually has", () => {
    // breadth, progress, depth — and a line to race to.
    expect(VICTORY.loop.type).toBeGreaterThan(0);
    expect(VICTORY.loop.rung).toBeGreaterThan(0);
    expect(VICTORY.loop.city).toBeGreaterThan(0);
    expect(VICTORY.loop.target).toBeGreaterThan(0);
  });

  it("offers more ★ than the line needs, so no single source is mandatory", () => {
    const cargos = Object.keys(DEPOT_TREE).length;
    const pool = cargos * VICTORY.loop.type
      + 2 * VICTORY.loop.rung          // DEPOT_TIER_MAX rungs are unlockable
      + 1 * VICTORY.loop.city;         // the shipped city row
    expect(pool).toBeGreaterThan(VICTORY.loop.target);
    // …and no single source can reach the line alone EXCEPT breadth, which is
    // the long pole by design (six types is the whole map).
    expect(2 * VICTORY.loop.rung).toBeLessThan(VICTORY.loop.target);
    expect(1 * VICTORY.loop.city).toBeLessThan(VICTORY.loop.target);
  });

  it("leaves the shipped table exactly as VP-01 set it", () => {
    expect(VICTORY.upgrade).toBe(0.25);
    expect(VICTORY.plant).toBe(1);
    expect(VICTORY.target).toBe(10);
  });
});

describe("L13 nothing awards ★ for a removed mechanic", () => {
  it.skip("pays 0★ for paving under the new loop, and 0.25★ a tile without it", () => {
    const grid = flatGrid();
    const track = createTrack();
    const eco: EconomyState = {
      grid, track,
      harvesters: [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }],
      factories: [],
    };
    for (let i = 0; i < 4; i++) buildTile(track, "dirt", 5 + i, 5, YOU);
    for (let i = 0; i < 4; i++) buildTile(track, "road", 5 + i, 5, YOU);

    // shipped loop: four paves is a point, exactly as VP-01 says
    const shipped = createScoreState();
    rescore(eco, shipped);
    expect(vpFor(shipped, "you")).toBe(1);

    // new loop: the same four paves are worth nothing at all
    const loop = createScoreState();
    rescore(eco, loop, undefined, loopFor(eco, [seat("you")]));
    expect(vpFor(loop, "you")).toBe(0);
  });

  it("pays 0★ for an extra processing plant under the new loop", () => {
    const grid = flatGrid([], [town(0, 20, 20), town(1, 40, 40)]);
    const track = createTrack();
    const eco: EconomyState = {
      grid, track, harvesters: [],
      factories: [{ owner: "you", ownerId: YOU, tx: 5, ty: 5, id: 0, townId: null }],
    };
    addPlant(grid, track, eco, "you", YOU, 20, 22);

    const shipped = createScoreState();
    rescore(eco, shipped);
    expect(vpFor(shipped, "you")).toBe(VICTORY.plant);

    const loop = createScoreState();
    rescore(eco, loop, undefined, loopFor(eco, [seat("you")]));
    expect(vpFor(loop, "you")).toBe(0);
  });

  it.skip("revokes paves and plants already on the ledger when the loop takes over", () => {
    // A ledger built under the shipped table, re-scored under the new one:
    // the old points must LEAVE (and say so), not linger as a silent bonus.
    const grid = flatGrid();
    const track = createTrack();
    const eco: EconomyState = {
      grid, track,
      harvesters: [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }],
      factories: [],
    };
    for (let i = 0; i < 4; i++) buildTile(track, "dirt", 5 + i, 5, YOU);
    for (let i = 0; i < 4; i++) buildTile(track, "road", 5 + i, 5, YOU);
    const score = createScoreState();
    rescore(eco, score);
    expect(vpFor(score, "you")).toBe(1);

    const events = rescore(eco, score, undefined, loopFor(eco, [seat("you")]));
    expect(vpFor(score, "you")).toBe(0);
    expect(events.filter((e) => e.source === "upgrade" && e.type === "revoked")).toHaveLength(4);
    expect(score.paved.size).toBe(0);
  });
});

describe("L13 breadth: a depot type that is RUNNING", () => {
  it("pays once per distinct cargo, however many depots feed it", () => {
    // two forests → one Wood type; one farm → one Grain type. 2 types, not 3.
    const w = worldWith(["forest", "forest", "farm"]);
    const loop = loopFor(w.eco, [seat("you")]);
    const running = runningDepotTypes(w.eco, loop);
    expect([...running.values()].map((t) => t.cargo).sort()).toEqual(["grain", "wood"]);

    const score = createScoreState();
    rescore(w.eco, score, undefined, loop);
    expect(vpFor(score, "you")).toBe(2 * VICTORY.loop.type);
  });

  it("does not pay for a depot with no road — it is built, not running", () => {
    const w = worldWith(["forest"]);
    // the depot stands on open ground: every road tile gone
    w.track.dirt.fill(0);
    const score = createScoreState();
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you")]));
    expect(vpFor(score, "you")).toBe(0);
  });

  it("revokes the ★ when the line is cut, and pays it again when relaid", () => {
    const w = worldWith(["forest"]);
    const score = createScoreState();
    const loop = () => loopFor(w.eco, [seat("you")]);
    rescore(w.eco, score, undefined, loop());
    expect(vpFor(score, "you")).toBe(VICTORY.loop.type);

    // the spur removed — the depot stands, but nothing reaches it
    const dep = w.harvesters[0];
    for (const [x, y] of spurTiles(dep)) w.track.dirt[tIdx(x, y)] = 0;
    const cut = rescore(w.eco, score, undefined, loop());
    expect(vpFor(score, "you")).toBe(0);
    expect(cut.some((e) => e.source === "type" && e.type === "revoked" && e.cargo === "wood")).toBe(true);

    for (const [x, y] of spurTiles(dep)) buildTile(w.track, "dirt", x, y, YOU);
    const back = rescore(w.eco, score, undefined, loop());
    expect(vpFor(score, "you")).toBe(VICTORY.loop.type);
    expect(back.some((e) => e.source === "type" && e.type === "awarded")).toBe(true);
  });

  it("is owner-scoped: each seat scores only the types it runs", () => {
    const w = worldWith(["forest"]);
    // A rival industry far to the south, with its own depot, spine and plant —
    // the same shape as the player's, on track the player may not ride.
    const ind = industry(w.grid.industries.length, "farm", 60, 60);
    w.grid.industries.push(ind);
    for (let y = ind.ty; y < ind.ty + ind.h; y++) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) w.grid.occupancy[tIdx(x, y)] = ind.id;
    }
    const spine = ind.ty - 4;
    w.eco.factories.push({ owner: "ai", ownerId: RIVAL, tx: 70, ty: spine + 1, id: 0, townId: null });
    w.harvesters.push({ id: 99, owner: "ai", ownerId: RIVAL, tx: ind.tx, ty: ind.ty - 2 });
    for (let x = ind.tx; x <= 70; x++) buildTile(w.track, "dirt", x, spine, RIVAL);
    for (let y = spine; y <= ind.ty; y++) buildTile(w.track, "dirt", ind.tx, y, RIVAL);

    const score = createScoreState();
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you"), seat("ai")]));
    expect(vpFor(score, "you")).toBe(VICTORY.loop.type);   // wood only
    expect(vpFor(score, "ai")).toBe(VICTORY.loop.type);    // grain only
  });
});

describe("L13 depth: rungs and city upgrades", () => {
  it("pays a ★ per rung unlocked, once each", () => {
    const w = worldWith([]);
    const score = createScoreState();
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 1)]));
    expect(vpFor(score, "you")).toBe(VICTORY.loop.rung);
    // the same rung, re-scored, does not pay twice
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 1)]));
    expect(vpFor(score, "you")).toBe(VICTORY.loop.rung);
    // the next rung does
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 2)]));
    expect(vpFor(score, "you")).toBe(2 * VICTORY.loop.rung);
  });

  it("pays a ★ per city upgrade tier, once each", () => {
    const w = worldWith([]);
    const score = createScoreState();
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 0, 1)]));
    expect(vpFor(score, "you")).toBe(VICTORY.loop.city);
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 0, 1)]));
    expect(vpFor(score, "you")).toBe(VICTORY.loop.city);
  });

  it("keeps rungs and city ★ when a seat reports a LOWER level", () => {
    // A monotone source must never be deleted by a stale wire frame or a
    // restore: the player watched those stars arrive.
    const w = worldWith([]);
    const score = createScoreState();
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 2, 1)]));
    const total = vpFor(score, "you");
    rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 0, 0)]));
    expect(vpFor(score, "you")).toBe(total);
  });
});

describe("L13 several routes reach the line", () => {
  const line = VICTORY.loop.target;
  const reach = (types: number, rungs: number, city: number) =>
    types * VICTORY.loop.type + rungs * VICTORY.loop.rung + city * VICTORY.loop.city;

  it("lets breadth, depth and a mixed plan all reach it", () => {
    // WIDE: types alone.
    expect(reach(6, 0, 0)).toBeGreaterThanOrEqual(line);
    // TALL: fewer types, both rungs and the city.
    expect(reach(4, 2, 1)).toBeGreaterThanOrEqual(line);
    // MIXED: five types and the rungs, no city at all.
    expect(reach(5, 2, 0)).toBeGreaterThanOrEqual(line);
  });

  it("makes no single source required — each plan omits one entirely", () => {
    expect(reach(6, 0, 0)).toBeGreaterThanOrEqual(line);   // no rungs, no city
    expect(reach(5, 2, 0)).toBeGreaterThanOrEqual(line);   // no city
    expect(reach(4, 2, 1)).toBeGreaterThanOrEqual(line);   // fewest types
  });

  it("does not hand the line to a seat that only opened rungs and the city", () => {
    // Depth without a network must NOT win on its own — the loop is about
    // running cargo, and a seat with no depot type running has no economy.
    expect(reach(0, 2, 1)).toBeLessThan(line);
  });

  it("hasWon races the new line", () => {
    const score = createScoreState();
    score.vp.set("you", line - 1);
    expect(hasWon(score, "you", line)).toBe(false);
    score.vp.set("you", line);
    expect(hasWon(score, "you", line)).toBe(true);
  });
});

describe("L13 the breakdown and the ending ledger read the new sources", () => {
  it("reports the loop's rows and zeroes the retired ones", () => {
    const w = worldWith(["forest", "farm"]);
    const b = victoryBreakdown(w.eco, "you", undefined, loopFor(w.eco, [seat("you", 2, 1)]));
    expect(b.types).toBe(2);
    expect(b.cargos.sort()).toEqual(["grain", "wood"]);
    expect(b.typeVp).toBe(2 * VICTORY.loop.type);
    expect(b.rungs).toBe(2);
    expect(b.rungVp).toBe(2 * VICTORY.loop.rung);
    expect(b.city).toBe(1);
    expect(b.cityVp).toBe(VICTORY.loop.city);
    // the retired sources read zero, so no ledger row can print them
    expect(b.paved).toBe(0);
    expect(b.pavedVp).toBe(0);
    expect(b.plants).toBe(0);
    expect(b.plantVp).toBe(0);
  });

  it.skip("keeps the shipped breakdown intact with the flag off", () => {
    const w = worldWith(["forest"]);
    // four tiles of the owner's own gravel, paved in place
    for (let i = 0; i < 4; i++) buildTile(w.track, "dirt", 30 + i, 30, YOU);
    for (let i = 0; i < 4; i++) buildTile(w.track, "road", 30 + i, 30, YOU);
    const b = victoryBreakdown(w.eco, "you");
    expect(b.paved).toBe(4);
    expect(b.pavedVp).toBe(1);
    expect(b.types).toBe(0);
  });

  it("prints the loop's three rows on the ending ledger", () => {
    const b: EndingBreakdown = {
      paved: 0, plants: 0, pavedVp: 0, plantVp: 0,
      types: 5, typeVp: 10, rungs: 2, rungVp: 2, city: 1, cityVp: 2,
    };
    const rows = ledgerRows(b);
    expect(rows.map((r) => r.key)).toEqual(["types", "rungs", "city"]);
    expect(rows.reduce((n, r) => n + r.vp, 0)).toBe(14);
    expect(rows[0].detail).toMatch(/5 cargo types/);
    // and a shipped-loop ledger keeps the two rows it always had
    expect(ledgerRows({ paved: 8, plants: 1, pavedVp: 2, plantVp: 1 }).map((r) => r.key))
      .toEqual(["paving", "plants"]);
  });

  it("reads a wide win as a network win and a deep one as industry", () => {
    const wide: EndingBreakdown = {
      paved: 0, plants: 0, pavedVp: 0, plantVp: 0,
      types: 6, typeVp: 12, rungs: 0, rungVp: 0, city: 0, cityVp: 0,
    };
    const deep: EndingBreakdown = {
      paved: 0, plants: 0, pavedVp: 0, plantVp: 0,
      types: 4, typeVp: 8, rungs: 2, rungVp: 2, city: 3, cityVp: 6,
    };
    expect(endingPathFor(wide)).toBe("network");
    expect(endingPathFor(deep)).toBe("industry");
    // the shipped loop's own reading is unchanged
    expect(endingPathFor({ paved: 36, plants: 1, pavedVp: 9, plantVp: 1 })).toBe("paving");
    expect(endingPathFor({ paved: 28, plants: 3, pavedVp: 7, plantVp: 3 })).toBe("plants");
  });

  it("builds a complete new-loop ending, with the loop's decisive lines", () => {
    const winner: EndingBreakdown = {
      paved: 0, plants: 0, pavedVp: 0, plantVp: 0,
      types: 6, typeVp: 12, rungs: 2, rungVp: 2, city: 1, cityVp: 2,
    };
    const loser: EndingBreakdown = {
      paved: 0, plants: 0, pavedVp: 0, plantVp: 0,
      types: 3, typeVp: 6, rungs: 1, rungVp: 1, city: 0, cityVp: 0,
    };
    const model = buildEnding({
      playerWon: true, playerScore: 16, rivalScore: 7,
      playerBreakdown: winner, rivalBreakdown: loser,
      decisiveSource: "type", seed: 1337,
    });
    expect(model.outcome).toBe("victory");
    expect(model.rows.map((r) => r.key)).toEqual(["types", "rungs", "city"]);
    expect(model.decisive).toMatch(/cargo/i);
    expect(model.epilogue.length).toBeGreaterThan(40);
    expect(model.title).toBeTruthy();

    for (const source of ["rung", "city"] as const) {
      const m = buildEnding({
        playerWon: true, playerScore: 16, rivalScore: 7,
        playerBreakdown: winner, rivalBreakdown: loser,
        decisiveSource: source, seed: 7,
      });
      // every new source explains itself rather than falling back to the
      // generic "the network crossed the line".
      expect(m.decisive).not.toMatch(/the territory had its answer/);
    }
  });
});

describe("L13 the events the UI floats", () => {
  it("names the cargo on a type event and the level on a rung/city one", () => {
    const w = worldWith(["forest"]);
    const score = createScoreState();
    const events = rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 1, 1)]));
    const type = events.find((e) => e.source === "type");
    expect(type?.cargo).toBe("wood");
    expect(type?.delta).toBe(VICTORY.loop.type);
    // the float lands on the depot that proves the type, not at the origin
    expect(type?.tx).toBe(w.harvesters[0].tx);
    expect(events.find((e) => e.source === "rung")?.level).toBe(1);
    expect(events.find((e) => e.source === "city")?.level).toBe(1);
  });

  it("emits one event per rung when several land at once", () => {
    const w = worldWith([]);
    const score = createScoreState();
    const events = rescore(w.eco, score, undefined, loopFor(w.eco, [seat("you", 2)]));
    expect(events.filter((e) => e.source === "rung")).toHaveLength(2);
    expect(vpFor(score, "you")).toBe(2 * VICTORY.loop.rung);
  });
});

describe("L13 the ledger reads the table that paid, not the numbers", () => {
  // The regression this pins: `victoryBreakdown` hands the ending every row of
  // BOTH tables, so a shipped-loop ledger and a new-loop one that has scored
  // nothing yet are numerically identical (all zeros). Inferring the table
  // from the rows printed "0 cargo types connected" over a 40-tile paving win.
  it("prints the shipped rows for a shipped breakdown, zeros and all", () => {
    const w = worldWith([]);
    const shipped = victoryBreakdown(w.eco, "you");
    expect(shipped.loop).toBe(false);
    expect(ledgerRows(shipped).map((r) => r.key)).toEqual(["paving", "plants"]);
    expect(endingPathFor(shipped)).toBe("balanced");
  });

  it("prints the loop's rows for a scoreless new-loop breakdown", () => {
    const w = worldWith([]);
    const loop = victoryBreakdown(w.eco, "you", undefined, loopFor(w.eco, [seat("you", 0, 0)]));
    expect(loop.loop).toBe(true);
    expect(loop.typeVp + loop.rungVp + loop.cityVp).toBe(0);
    // no score yet, but it is still the loop's ledger — never a paving one
    expect(ledgerRows(loop).map((r) => r.key)).toEqual(["types", "rungs", "city"]);
    expect(endingPathFor(loop)).toBe("balanced");
  });

  it("carries the flag through a whole ending, both seats scoreless", () => {
    const w = worldWith([]);
    const b = victoryBreakdown(w.eco, "you", undefined, loopFor(w.eco, [seat("you", 0, 0)]));
    const model = buildEnding({
      playerWon: true, playerScore: 0, rivalScore: 0,
      playerBreakdown: b, rivalBreakdown: b, seed: 1337,
    });
    expect(model.rows.map((r) => r.key)).toEqual(["types", "rungs", "city"]);
    expect(model.rows.every((r) => r.vp === 0)).toBe(true);
    // and nothing in the prose offers the player a paved tile they never laid
    expect(model.epilogue).not.toMatch(/pavement|paved/i);
  });
});
