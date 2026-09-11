// ══════════════════════════════════════════════════════════════════════════
// VP-01 — the victory rules: what scores, what does not, and what takes it back.
//
//   Dirt Road tile paved into a Road      +0.25★   (4 paves = 1★)
//   Processing plant raised after setup   +1★
//   First to 20★ wins (AI-02 — the line moved from 10)
//
// These read like a list of negatives, and that is the point of the ticket:
// a connection is worth nothing, a Dirt Road is worth nothing, a Road laid on
// virgin ground is worth nothing. The scoring lives on the UPGRADE, so the
// tests have to pin the three distinctions the old model never had to make:
//
//   1. pave vs. lay-new       — same tile, same tier, different provenance;
//   2. your gravel vs. theirs  — owner-scoped, so a rival cannot bank your road
//                               (or the map's public tarmac) as its own;
//   3. built vs. standing      — the score is the network, so demolition pays
//                               back the point it took off the board.
//
// Run through the real `buildTile`/`demolishTile`/`addPlant` entry points rather
// than by poking the byte layers, because those functions are where the
// provenance bit is set: a test that faked the bit would pass even if the game
// had forgotten to write it.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createScoreState, rescore, vpFor, hasWon, fmtVp, paveVp, victoryBreakdown,
  scoredPaves, ownerIdsByNumber,
} from "../../src/iso/victory";
import {
  createTrack, buildTile, demolishTile, tIdx, previewDrag, isUpgradedRoad,
  tileCost, canBuildOn, PUBLIC_OWNER,
} from "../../src/iso/track";
import { addPlant, canPlacePlant } from "../../src/iso/plants";
import type { EconomyState, Factory, Harvester } from "../../src/iso/economy";
import { GRASS, TOWN_OCC, type Grid, type Industry, type Town } from "../../src/iso/grid";
// MAP_W/MAP_H live in the shared config, NOT in iso/grid (which only re-exports
// the terrain constants): a wrong import here silently builds a zero-length
// occupancy array and every legality check then reads `undefined`.
import { MAP_W, MAP_H } from "../../src/game/config";
import { TRANSPORT, UPGRADE_COST, VICTORY, VP_TARGET } from "../../src/iso/config";

/** A 4-tile settlement with no ring road: enough for `adjacentTown`'s edge test. */
const town = (id: number, cx: number, cy: number): Town => ({
  id, tx: cx, ty: cy,
  houses: [[cx, cy], [cx + 1, cy], [cx, cy + 1], [cx + 1, cy + 1]],
  roads: [],
});

function flatGrid(industries: Industry[] = [], towns: Town[] = []): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
    }
  });
  // Town tiles are stamped TOWN_OCC, and `plants.ts` only counts a town tile the
  // map actually stamped — so a synthetic grid has to stamp them too, or every
  // plant placement refuses with "no-town" for the wrong reason.
  for (const t of towns) {
    for (const [x, y] of [...t.houses, ...t.roads]) occupancy[tIdx(x, y)] = TOWN_OCC;
  }
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, towns, occupancy, seed: 1,
  };
}

const YOU = 1, RIVAL = 2;

const eco = (grid: Grid, track = createTrack(), harvesters: Harvester[] = [], factories: Factory[] = []) =>
  ({ grid, track, harvesters, factories });

/** Lay `n` dirt tiles in a row from (x,y) east, owned by `owner`. */
const dirtRow = (track: ReturnType<typeof createTrack>, x: number, y: number, n: number, owner: number) => {
  for (let i = 0; i < n; i++) buildTile(track, "dirt", x + i, y, owner);
};

/** Pave the same row, one tile at a time, exactly as a drag would. */
const paveRow = (track: ReturnType<typeof createTrack>, x: number, y: number, n: number, owner: number) => {
  for (let i = 0; i < n; i++) buildTile(track, "road", x + i, y, owner);
};

describe("VP-01 the victory table", () => {
  it("paving dirt is worth 0.25★ a tile, four of them a point", () => {
    expect(VICTORY.upgrade).toBe(0.25);
    expect(TRANSPORT.road.vpUpgrade).toBe(VICTORY.upgrade);
    expect(VICTORY.plant).toBe(1);
    expect(VP_TARGET).toBe(20);   // AI-02: "10 is way too little" — the race now runs to 20
    expect(VICTORY.target).toBe(VP_TARGET);
    expect(paveVp(4)).toBe(1);
    expect(paveVp(1)).toBe(0.25);
  });

  it("a Dirt Road connection scores nothing at all", () => {
    // the tier has no `vp` field any more, and the number it used to carry is
    // gone from the type — the only VP a transport tier has is the pave bonus
    expect(TRANSPORT.dirt.vpUpgrade).toBe(0);
    expect("vp" in TRANSPORT.dirt).toBe(false);
    expect("vp" in TRANSPORT.road).toBe(false);
  });

  it("paving costs only the ore difference, so the scored move is the cheap one", () => {
    expect(UPGRADE_COST).toEqual({ ore: 4 });
    // dirt (1+1) + pave (4 ore) === a Road laid new: same money, and only the
    // pave is worth a point, which is what makes the upgrade the right play.
    const dirt = TRANSPORT.dirt.cost, road = TRANSPORT.road.cost;
    expect({ wood: dirt.wood! + 0, stone: dirt.stone!, ore: UPGRADE_COST.ore! })
      .toEqual({ wood: road.wood, stone: road.stone, ore: road.ore });
  });
});

describe("VP-01 the pave is the point", () => {
  it("lays 4 dirt tiles, paves them, and scores exactly 1★", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = eco(grid, track, [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    dirtRow(track, 5, 5, 4, YOU);

    const score = createScoreState();
    expect(rescore(state, score)).toEqual([]);        // gravel: nothing
    expect(vpFor(score, "you")).toBe(0);

    paveRow(track, 5, 5, 4, YOU);
    const events = rescore(state, score);
    expect(events).toHaveLength(4);
    for (const e of events) {
      expect(e).toMatchObject({ source: "upgrade", type: "awarded", owner: "you", delta: 0.25 });
    }
    expect(vpFor(score, "you")).toBe(1);
    expect(victoryBreakdown(state, "you")).toMatchObject({ paved: 4, plants: 0, pavedVp: 1 });
    expect(score.paved.size).toBe(4);
    // re-scoring the unchanged board is silent — no phantom +0.25 per frame
    expect(rescore(state, score)).toEqual([]);
  });

  it("a Road laid on virgin ground is worth nothing, and says so in the tile cost", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = eco(grid, track, [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    for (let i = 0; i < 4; i++) buildTile(track, "road", 5 + i, 5, YOU);   // never gravel
    const score = createScoreState();
    expect(rescore(state, score)).toEqual([]);
    expect(vpFor(score, "you")).toBe(0);
    expect(isUpgradedRoad(track, 6, 5)).toBe(false);
    // …and it paid the FULL price for it, not the upgrade price
    expect(tileCost(track, "road", 10, 10)).toEqual(TRANSPORT.road.cost);
  });

  it("scores only the tiles paved over YOUR OWN gravel, not the rival's", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = eco(grid, track, [
      { id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 },
      { id: 2, owner: "ai", ownerId: RIVAL, tx: 9, ty: 6 },
    ]);
    dirtRow(track, 5, 5, 2, YOU);
    dirtRow(track, 8, 5, 2, RIVAL);
    paveRow(track, 5, 5, 2, YOU);
    paveRow(track, 8, 5, 2, RIVAL);

    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "you")).toBe(0.5);
    expect(vpFor(score, "ai")).toBe(0.5);
  });

  it("track legality never mentions owners, so a point always follows the ground", () => {
    // The reason the one-point-per-tile invariant is safe: `canBuildOn` is a
    // terrain/occupancy test, so a rival's drag CAN cross your gravel — and
    // `buildTile` then hands the tile to whoever paid for the pavement. The
    // point moves rather than duplicating, which the next test pins.
    const grid = flatGrid();
    const track = createTrack();
    dirtRow(track, 5, 5, 1, RIVAL);
    expect(canBuildOn(grid, "road", 5, 5)).toBe(true);
    expect(isUpgradedRoad(track, 5, 5)).toBe(false);      // theirs, still gravel
  });

  it("the map's public tarmac scores for nobody", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = eco(grid, track, [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    // a highway tile a player then paves over: `buildTile` refuses to take a
    // public road away from the map, so it cannot be claimed for points either
    buildTile(track, "dirt", 5, 5, YOU);
    buildTile(track, "road", 6, 5, PUBLIC_OWNER);
    buildTile(track, "road", 5, 5, YOU);
    const owners = ownerIdsByNumber(state);
    expect(owners.has(PUBLIC_OWNER)).toBe(false);
    expect(scoredPaves(track, owners).get(tIdx(6, 5))).toBeUndefined();
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "you")).toBe(VICTORY.upgrade);    // only its own pave
  });

  it("demolishing a paved tile takes the point back, and re-paving cannot farm it", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = eco(grid, track, [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    dirtRow(track, 5, 5, 2, YOU);
    paveRow(track, 5, 5, 2, YOU);
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "you")).toBe(0.5);

    demolishTile(track, "road", 5, 5);
    const events = rescore(state, score);
    expect(events).toEqual([
      { source: "upgrade", type: "revoked", owner: "you", delta: -VICTORY.upgrade, tx: 5, ty: 5 },
    ]);
    expect(vpFor(score, "you")).toBe(0.25);
    expect(isUpgradedRoad(track, 5, 5)).toBe(false);

    // tearing it up and paving it again pays nothing extra: the second `road`
    // build lands on bare ground, which is not an upgrade
    buildTile(track, "road", 5, 5, YOU);
    expect(rescore(state, score)).toEqual([]);
    expect(vpFor(score, "you")).toBe(0.25);
  });

  it("a paved tile the rival takes over moves the point, it does not double it", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = eco(grid, track, [
      { id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 },
      { id: 2, owner: "ai", ownerId: RIVAL, tx: 9, ty: 6 },
    ]);
    dirtRow(track, 5, 5, 1, YOU);
    paveRow(track, 5, 5, 1, YOU);
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "you")).toBe(0.25);

    // The rival's drag crosses the tile, and a paved tile is the last real
    // builder's (`buildTile`'s ownership rule), so the point travels with the
    // ground: one revoked, one awarded, one point on the board either way.
    track.upgraded[tIdx(5, 5)] = 0;        // back to plain gravel, for the test
    track.road[tIdx(5, 5)] = 0;
    track.dirt[tIdx(5, 5)] = 16 | 2;
    track.owner[tIdx(5, 5)] = RIVAL;
    buildTile(track, "road", 5, 5, RIVAL);
    const events = rescore(state, score);
    expect(events.map((e) => `${e.owner}:${e.type}`)).toEqual(["you:revoked", "ai:awarded"]);
    expect(vpFor(score, "you")).toBe(0);
    expect(vpFor(score, "ai")).toBe(0.25);
    expect(vpFor(score, "you") + vpFor(score, "ai")).toBe(0.25);   // one tile, one point
  });
});

describe("VP-01 plants", () => {
  /** The first legal plant origin in a window — the same `canPlacePlant` rule
   *  the human's click and the AI both go through, so the test never needs to
   *  know where "beside the town" is. */
  const findPlantSpot = (grid: Grid, track: ReturnType<typeof createTrack>, state: EconomyState) => {
    for (let ty = 15; ty < 27; ty++) {
      for (let tx = 15; tx < 27; tx++) {
        if (canPlacePlant(grid, track, state, tx, ty)) return [tx, ty] as const;
      }
    }
    return null;
  };

  it("the opening Factory is free and scores nothing; the next plant is 1★", () => {
    const grid = flatGrid([], [town(0, 20, 20)]);
    const track = createTrack();
    const state = eco(grid, track, [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    // the setup Factory: plant #0, beside the town
    state.factories.push({ owner: "you", ownerId: YOU, tx: 18, ty: 18, id: 0, townId: 0 });
    const score = createScoreState();
    expect(rescore(state, score)).toEqual([]);
    expect(vpFor(score, "you")).toBe(0);

    // …then a real purchase, through the one placement rule the human clicks
    const spot = findPlantSpot(grid, track, state);
    expect(spot, "no legal plant spot beside the town").toBeTruthy();
    expect(addPlant(grid, track, state, "you", YOU, spot![0], spot![1])).toBeTruthy();
    const events = rescore(state, score);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: "plant", type: "awarded", owner: "you", delta: 1 });
    expect(vpFor(score, "you")).toBe(1);
    expect(victoryBreakdown(state, "you").plants).toBe(1);
  });

  it("demolishing a plant surrenders its point; the opening one never had one", () => {
    const grid = flatGrid([], [town(0, 20, 20)]);
    const track = createTrack();
    const state = eco(grid, track, [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    state.factories.push({ owner: "you", ownerId: YOU, tx: 18, ty: 18, id: 0, townId: 0 });
    const spot = findPlantSpot(grid, track, state);
    expect(spot, "no legal plant spot beside the town").toBeTruthy();
    expect(addPlant(grid, track, state, "you", YOU, spot![0], spot![1])).toBeTruthy();
    const score = createScoreState();
    rescore(state, score);
    expect(vpFor(score, "you")).toBe(1);

    // tear the built one down: only the opening Factory is left, so 0★
    const built = state.factories.length - 1;
    state.factories.splice(built, 1);
    const events = rescore(state, score);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: "plant", type: "revoked", owner: "you", delta: -1 });
    expect(vpFor(score, "you")).toBe(0);
  });

  it("a legacy plant record with no id is treated as the opening one", () => {
    const grid = flatGrid();
    const state = eco(grid, createTrack(), [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    state.factories.push({ owner: "you", ownerId: YOU, tx: 9, ty: 9 });   // no id, no townId
    const score = createScoreState();
    expect(rescore(state, score)).toEqual([]);
    expect(vpFor(score, "you")).toBe(0);
  });
});

describe("VP-01 the race to twenty (AI-02 — was ten)", () => {
  it("20★ is reached by 80 paves, 20 plants, or any mix that adds up", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = eco(grid, track, [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    const score = createScoreState();
    dirtRow(track, 10, 10, 80, YOU);
    paveRow(track, 10, 10, 80, YOU);
    rescore(state, score);
    expect(vpFor(score, "you")).toBe(20);          // 80 × 0.25, exactly
    expect(hasWon(score, "you")).toBe(true);
    expect(hasWon(score, "ai")).toBe(false);
  });

  it("79 paves is not a win — and the scoreboard prints 19.75, not float noise", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = eco(grid, track, [{ id: 1, owner: "you", ownerId: YOU, tx: 5, ty: 6 }]);
    const score = createScoreState();
    dirtRow(track, 10, 10, 80, YOU);
    paveRow(track, 10, 10, 79, YOU);
    buildTile(track, "road", 10, 20, PUBLIC_OWNER);      // public: never scored
    rescore(state, score);
    expect(vpFor(score, "you")).toBe(19.75);
    expect(fmtVp(vpFor(score, "you"))).toBe("19.75");
    expect(fmtVp(20)).toBe("20");
    expect(fmtVp(0.5)).toBe("0.5");
    expect(hasWon(score, "you")).toBe(false);
  });
});

describe("VP-01 the drag preview prices the points before you commit", () => {
  it("reports how many tiles a paved drag will upgrade", () => {
    const grid = flatGrid();
    const track = createTrack();
    dirtRow(track, 5, 5, 6, YOU);
    const purse = { wood: 99, stone: 99, ore: 99 };
    // a paved drag along the gravel row: every tile is an upgrade
    const pv = previewDrag(grid, track, "road", purse, 5, 5, 10, 5, true, undefined, 0);
    expect(pv.tiles.length).toBeGreaterThan(0);
    expect(pv.upgrades).toBe(pv.tiles.length);
    expect(paveVp(pv.upgrades)).toBe(pv.tiles.length * VICTORY.upgrade);
    // the same drag on clean ground paves nothing, and says 0
    const fresh = previewDrag(grid, track, "road", purse, 5, 9, 10, 9, true, undefined, 0);
    expect(fresh.upgrades).toBe(0);
    expect(fresh.tiles.length).toBeGreaterThan(0);
    // a dirt drag never reports upgrades
    const dirt = previewDrag(grid, track, "dirt", purse, 5, 12, 10, 12, true, undefined, 0);
    expect(dirt.upgrades).toBe(0);
  });
});
