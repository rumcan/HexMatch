import { afterEach, describe, expect, it } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, WATER, ROUGH, type Grid } from "../../src/iso/grid";
import {
  createTrack, buildTile, buildRoadDiagonal, setRoadTier, ROAD_TIER, OVERPASS_X, OVERPASS_Y, OVERPASS_COST,
  planInterchange, buildInterchange, roadTierAt, roadRailDeckAxis, roadConnectionMask,
  previewDrag, commitDrag, demolishTile, overpassJump, NE, SE, SW, NW, tIdx, dirtyTiles,
  addCost, tileCost, tierTileCost, type Track, type RoadTierKey,
} from "../../src/iso/track";
import {
  createRailState, buildRail, railPreview, railPath, railComponents, railDrawLayer,
  RAIL_OVERPASS, platformRefusal, platformTrackAt, RAIL_COSTS, railToWire, applyRailWire, demolishRail,
} from "../../src/iso/rail";
import { roadPath } from "../../src/iso/road-routing";
import { buildComponents } from "../../src/iso/economy";
import { roadWidth, ROAD_WIDTH, highwayDividerFigures } from "../../src/iso/road-geometry";
import { roadTilesIn } from "../../src/iso/road-renderer";
import { railTilesIn, railBridgeDecksIn } from "../../src/iso/rail-renderer";
import { buildSnapshot, applySnapshot } from "../../src/iso/snapshot";
import { trackSave, trackRestored } from "../../src/iso/savegame-runtime";
import { readTiles, applyTrackDelta } from "../../src/net/delta";
import { routeTileLength } from "../../src/iso/slopes";
import { toolIconSvg } from "../../src/ui/icons";

type Tile = [number, number];
const rich = { wood: 99999, stone: 99999, ore: 99999, oil: 99999, grain: 99999 };
const flat = (): Grid => ({ w: MAP_W, h: MAP_H, seed: 420,
  terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS), occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [] });
const run = (axis: "x" | "y", half = 3): Tile[] => Array.from({ length: half * 2 + 1 }, (_, n) => axis === "x" ? [20 + n - half, 20] : [20, 20 + n - half]);
const road = (t: Track, tiles: Tile[], tier = 0) => {
  for (const [x, y] of tiles) buildTile(t, "road", x, y, 1);
  for (const [x, y] of tiles) setRoadTier(t, x, y, tier as 0 | 1 | 2 | 3);
};
const route = (t: Track, a: Tile, b: Tile) => roadPath(t, 1, [a], new Set([tIdx(...b)]));
afterEach(() => dirtyTiles.clear());

describe("#420 one-click diamond", () => {
  it.each(["x", "y"] as const)("fits, prices, and connects four ramps on a %s Highway", (axis) => {
    const grid = flat(), t = createTrack(false), highway = run(axis);
    road(t, highway, ROAD_TIER.highway);
    const before = t.road.slice(), rev = t.revision;
    const plan = planInterchange(grid, t, 1, 20, 20, rich);
    expect(plan.why).toBeNull(); expect(plan.tiles).toHaveLength(19);
    expect(plan.tiles.filter((p) => p[2] === ROAD_TIER.ramp)).toHaveLength(4);
    expect(t.road).toEqual(before); expect(t.revision).toBe(rev);
    let expected = { ...OVERPASS_COST };
    for (const [x, y, tier] of plan.tiles) if (x !== 20 || y !== 20)
      expected = addCost(expected, tier === ROAD_TIER.ramp ? tierTileCost(t, "ramp", x, y) : tileCost(t, "road", x, y));
    expect(plan.cost).toEqual(expected);
    const committed = buildInterchange(grid, t, 1, 20, 20, rich);
    expect(committed).toEqual(plan); expect(roadTierAt(t, 20, 20)).toBe(axis === "x" ? OVERPASS_X : OVERPASS_Y);
    const crossing = run(axis === "x" ? "y" : "x");
    expect(route(t, crossing[0], crossing.at(-1)!)).not.toBeNull();
    expect(route(t, highway[0], crossing[0])).not.toBeNull();
    const direct = overpassJump(t, ...crossing[2], axis === "x" ? SW : SE);
    expect(direct).toEqual(crossing[4]);
    expect(planInterchange(grid, t, 1, 20, 20, rich).cost).toEqual({});
  });
  it.each(["water", "slope", "rough", "building", "foreign", "budget"])("refuses %s atomically with readable feedback", (obstacle) => {
    const grid = flat(), t = createTrack(false); road(t, run("x"), ROAD_TIER.highway);
    if (obstacle === "water") grid.terrain[tIdx(20, 18)] = WATER;
    if (obstacle === "rough") grid.terrain[tIdx(20, 18)] = ROUGH;
    if (obstacle === "slope") { grid.height = new Uint8Array(MAP_W * MAP_H); grid.height[tIdx(20, 18)] = 1; }
    if (obstacle === "building") grid.builtAt = (x, y) => x === 20 && y === 18 ? "dam" : null;
    if (obstacle === "foreign") buildTile(t, "road", 20, 18, 2);
    const bytes = t.road.slice(), tiers = t.tier!.slice(), rev = t.revision;
    const plan = buildInterchange(grid, t, 1, 20, 20, obstacle === "budget" ? {} : rich);
    expect(plan.why?.length).toBeGreaterThan(12);
    expect(t.road).toEqual(bytes); expect(t.tier).toEqual(tiers); expect(t.revision).toBe(rev);
  });
  it("has an original Space Age currentColor line icon, no raster asset", () => {
    expect(toolIconSvg("interchange")).toContain('stroke="currentColor"');
    expect(toolIconSvg("interchange")).toContain('<svg');
  });
});

for (const diagonalRoads of [false, true]) for (const axis of ["x", "y"] as const) {
  describe(`#420 crossing ${axis}, DEV roads ${diagonalRoads}`, () => {
    const other = axis === "x" ? "y" : "x";
    it.each(["road", "street", "highway"] as RoadTierKey[])("%s drag over existing rail preserves tier and routes straight", (tier) => {
      const grid = flat(), t = createTrack(diagonalRoads), state = createRailState();
      const railRun = run(other), roadRun = run(axis);
      expect(buildRail(grid, t, state, 1, railRun).ok).toBe(true);
      grid.builtAt = (x, y) => state.rail.tile[tIdx(x, y)] & 16 ? other === "x" ? "rail-x" : "rail-y" : null;
      const options = { gradeSeparated: true };
      const pv = previewDrag(grid, t, "road", rich, ...roadRun[0], ...roadRun.at(-1)!, true, undefined, 0, undefined, false, options, tier);
      expect(pv.tiles).toEqual(roadRun); expect(pv.railOverpasses).toEqual([[20, 20, axis]]);
      const ground = previewDrag(grid, t, "road", rich, ...roadRun[0], ...roadRun.at(-1)!, true, undefined, 0, undefined, false, {}, tier);
      expect(pv.cost).toEqual(addCost(ground.cost, OVERPASS_COST));
      commitDrag(t, "road", pv, 1, tier);
      expect(roadRailDeckAxis(t.tier![tIdx(20, 20)])).toBe(axis);
      expect(roadTierAt(t, 20, 20)).toBe(ROAD_TIER[tier]);
      expect(overpassJump(t, ...roadRun[2], axis === "x" ? SE : SW)).toEqual(roadRun[4]);
      expect(route(t, roadRun[0], roadRun.at(-1)!)).not.toBeNull();
      const comp = buildComponents(t, 1).comp;
      expect(comp[tIdx(...roadRun[0])]).toBe(comp[tIdx(...roadRun.at(-1)!)]);
      expect(railPath(state, 1, [railRun[0]], new Set([tIdx(...railRun.at(-1)!)]))).toEqual(railRun);
      const world = { grid, roadBits: t.road, dirtBits: t.dirt, roadTiers: t.tier, rail: railDrawLayer(state), diagonalRoads };
      const drawn = roadTilesIn(world, 20, 20, 20, 20)[0];
      expect(drawn).toMatchObject({ deck: true, railDeck: true });
      expect(roadWidth(drawn)).toBeCloseTo(ROAD_WIDTH.paved * (tier === "highway" ? 1.6 : tier === "street" ? 0.8 : 1));
      expect(highwayDividerFigures([drawn]).length > 0).toBe(tier === "highway");
      expect(railTilesIn(world, 20, 20, 20, 20)[0].crossing).toBeFalsy();
      const again = previewDrag(grid, t, "road", rich, ...roadRun[0], ...roadRun.at(-1)!, true, undefined, 0, undefined, false, options, tier);
      expect(again.cost).toEqual({});
      setRoadTier(t, 20, 20, ROAD_TIER.street);
      expect(roadRailDeckAxis(t.tier![tIdx(20, 20)])).toBe(axis);
      demolishTile(t, "road", 20, 20); expect(t.tier![tIdx(20, 20)]).toBe(0);
    });
    it("rail drag builds and prices a deck over a road; trains jump straight", () => {
      const grid = flat(), t = createTrack(diagonalRoads), state = createRailState();
      const roadRun = run(axis), railRun = run(other); road(t, roadRun);
      const level = railPreview(grid, t, state, 1, rich, ...railRun[0], ...railRun.at(-1)!);
      const pv = railPreview(grid, t, state, 1, rich, ...railRun[0], ...railRun.at(-1)!, true, true);
      expect(pv.tiles).toEqual(railRun); expect(pv.cost).toEqual(addCost(level.cost, OVERPASS_COST));
      const committed = buildRail(grid, t, state, 1, pv.tiles, true);
      expect(committed.cost).toEqual(pv.cost); expect(state.rail.tile[tIdx(20, 20)] & RAIL_OVERPASS).toBe(RAIL_OVERPASS);
      const expected = railRun.filter(([x, y]) => x !== 20 || y !== 20);
      expect(railPath(state, 1, [railRun[0]], new Set([tIdx(...railRun.at(-1)!)]))).toEqual(expected);
      const comp = railComponents(state, 1);
      expect(comp.get(tIdx(20, 20))).toBe(comp.get(tIdx(...railRun[0])));
      expect(route(t, roadRun[0], roadRun.at(-1)!)).toEqual(roadRun);
      const world = { grid, roadBits: t.road, roadTiers: t.tier, rail: railDrawLayer(state) };
      expect(railBridgeDecksIn(world, 20, 20, 20, 20)).toEqual([{ tx: 20, ty: 20, axis: other }]);
      expect(railTilesIn(world, 20, 20, 20, 20)[0].crossing).toBeFalsy();
      expect(buildRail(grid, t, state, 1, railRun, true).cost).toEqual({});
      expect(state.rail.tile[tIdx(20, 20)] & RAIL_OVERPASS).toBe(RAIL_OVERPASS);
      const copy = createRailState(); applyRailWire(copy, JSON.parse(JSON.stringify(railToWire(state))));
      expect(copy.rail.tile).toEqual(state.rail.tile);
      expect(demolishRail(copy, 20, 20)).toBe(true); expect(copy.rail.tile[tIdx(20, 20)]).toBe(0);
    });
  });
}

describe("#420 refusal, legacy and persistence contracts", () => {
  it("keeps old/default level crossings level and does not charge an overpass", () => {
    const grid = flat(), t = createTrack(false), state = createRailState(); road(t, run("x"));
    expect(buildRail(grid, t, state, 1, run("y")).ok).toBe(true);
    expect(state.rail.tile[tIdx(20, 20)] & RAIL_OVERPASS).toBe(0);
    expect(buildRail(grid, t, state, 1, run("y"), true).cost).toEqual({});
    expect(state.rail.tile[tIdx(20, 20)] & RAIL_OVERPASS).toBe(0);
  });
  it.each([false, true])("refuses sloping road approaches with DEV %s", (diag) => {
    const grid = flat(), t = createTrack(diag); grid.height = new Uint8Array(MAP_W * MAP_H);
    grid.height[tIdx(21, 20)] = 1; grid.builtAt = (x, y) => x === 20 && y === 20 ? "rail-y" : null;
    const pv = previewDrag(grid, t, "road", rich, 18, 20, 22, 20, true, undefined, 0, undefined, false, { gradeSeparated: true });
    expect(pv.why).toBe("overpass-ground"); expect(pv.tiles).not.toContainEqual([20, 20]);
  });
  it("refuses rail decks on slopes, rather than silently laying a level crossing", () => {
    const grid = flat(), t = createTrack(false), state = createRailState(); road(t, run("x"));
    grid.height = new Uint8Array(MAP_W * MAP_H); grid.height[tIdx(20, 21)] = 1;
    const pv = railPreview(grid, t, state, 1, rich, 20, 18, 20, 22, true, true);
    expect(pv.tiles).not.toContainEqual([20, 20]); expect(pv.why).not.toBeNull();
  });
  it("saves, snapshots and dirty deltas preserve packed deck axis plus Street tier", () => {
    const grid = flat(), t = createTrack(false);
    grid.builtAt = (x, y) => x === 20 && y === 20 ? "rail-y" : null;
    const pv = previewDrag(grid, t, "road", rich, 18, 20, 22, 20, true, undefined, 0, undefined, false, { gradeSeparated: true }, "street");
    commitDrag(t, "road", pv, 1, "street");
    const saved = createTrack(false); trackRestored(saved, trackSave(t));
    const snapshot = buildSnapshot({ seed: 420, track: t, players: [], harvesters: [], factories: [], setupPhase: false, won: false });
    const restored = applySnapshot(JSON.parse(JSON.stringify(snapshot))).track;
    const guest = createTrack(false); applyTrackDelta(guest, readTiles(t, dirtyTiles.drain()));
    for (const copy of [saved, restored, guest]) {
      expect(copy.tier).toEqual(t.tier); expect(roadTierAt(copy, 20, 20)).toBe(ROAD_TIER.street);
      expect(roadRailDeckAxis(copy.tier![tIdx(20, 20)])).toBe("x");
      expect(roadConnectionMask(copy, 20, 20)).toBe(SE | NW);
      expect(route(copy, [18, 20], [22, 20])).not.toBeNull();
    }
  });
  it.each([false, true])("does not strand/charge an orphaned road deck before an obstacle (DEV %s)", (diag) => {
    const grid = flat(), t = createTrack(diag);
    grid.builtAt = (x, y) => y === 20 && x === 20 ? "rail-y" : y === 20 && x === 21 ? "plant" : null;
    const pv = previewDrag(grid, t, "road", rich, 18, 20, 22, 20, true, undefined, 0, undefined, false, { gradeSeparated: true });
    expect(pv.tiles).toEqual([[18, 20], [19, 20]]); expect(pv.railOverpasses).toEqual([]);
    expect(pv.cost).toEqual(addCost(tileCost(t, "road", 18, 20), tileCost(t, "road", 19, 20)));
    commitDrag(t, "road", pv, 1); expect(t.road[tIdx(20, 20)]).toBe(0);
  });
  it.each([false, true])("does not jump a foreign-owned road deck (DEV %s)", (diag) => {
    const grid = flat(), t = createTrack(diag);
    grid.builtAt = (x, y) => x === 20 && y === 20 ? "rail-y" : null;
    commitDrag(t, "road", previewDrag(grid, t, "road", rich, 18, 20, 22, 20, true, undefined, 0, undefined, false, { gradeSeparated: true }), 1);
    t.owner[tIdx(20, 20)] = 2; t.revision++;
    expect(route(t, [18, 20], [22, 20])).toBeNull();
    const comp = buildComponents(t, 1).comp;
    expect(comp[tIdx(18, 20)]).not.toBe(comp[tIdx(22, 20)]);
  });
  it.each([false, true])("will not spend on a road deck without an affordable exit (DEV %s)", (diag) => {
    const grid = flat(), t = createTrack(diag);
    grid.builtAt = (x, y) => x === 20 && y === 20 ? "rail-y" : null;
    let purse = { ...OVERPASS_COST };
    for (const x of [18, 19, 20]) purse = addCost(purse, tileCost(t, "road", x, 20));
    const pv = previewDrag(grid, t, "road", purse, 18, 20, 22, 20, true, undefined, 0, undefined, false, { gradeSeparated: true });
    expect(pv.tiles).toEqual([[18, 20], [19, 20]]); expect(pv.railOverpasses).toEqual([]);
    expect(pv.cost).toEqual(addCost(tileCost(t, "road", 18, 20), tileCost(t, "road", 19, 20)));
  });
  it("does not price a rail deck whose exit the purse cannot reach", () => {
    const grid = flat(), t = createTrack(false), state = createRailState(); road(t, run("x"));
    let purse = { ...OVERPASS_COST }; for (let n = 0; n < 3; n++) purse = addCost(purse, RAIL_COSTS.rail);
    const pv = railPreview(grid, t, state, 1, purse, 20, 18, 20, 22, true, true);
    expect(pv.tiles).toEqual([[20, 18], [20, 19]]);
    expect(buildRail(grid, t, state, 1, pv.tiles, true).cost).toEqual(pv.cost);
    expect(state.rail.tile[tIdx(20, 20)]).toBe(0);
  });
  it("retains D4's mixed diagonal level crossings with roads enabled or disabled", () => {
    const grid = flat(), t = createTrack(true), state = createRailState();
    const diagonal: Tile[] = [[18, 18], [19, 19], [20, 20], [21, 21], [22, 22]];
    road(t, diagonal); for (let n = 1; n < diagonal.length; n++) buildRoadDiagonal(grid, t, ...diagonal[n - 1], ...diagonal[n], 1);
    expect(buildRail(grid, t, state, 1, run("x"), true).ok).toBe(true);
    expect(state.rail.tile[tIdx(20, 20)] & RAIL_OVERPASS).toBe(0);
    const axisRoad = createTrack(false), rails = createRailState(); road(axisRoad, run("x"));
    expect(buildRail(grid, axisRoad, rails, 1, diagonal, true).ok).toBe(true);
    expect(rails.rail.tile[tIdx(20, 20)] & RAIL_OVERPASS).toBe(0);
  });
  it("rejects a platform stop on a rail deck instead of creating an unreachable stop", () => {
    const grid = flat(), state = createRailState();
    const row = platformTrackAt(20, 20, "ne"), [x, y] = row[1];
    state.rail.tile[tIdx(x, y)] = 16 | SE | NW | RAIL_OVERPASS; state.rail.owner[tIdx(x, y)] = 1;
    expect(platformRefusal(grid, [], [], 1, 20, 20, "ne", undefined, undefined, state.rail)).toBe("overpass-stop");
  });
  it("counts the full two-tile overpass span in L3 even without the road DEV flag", () => {
    expect(routeTileLength([[18, 20], [19, 20], [21, 20], [22, 20]], false)).toBe(5);
    expect(routeTileLength([[18, 20], [19, 21]], false)).toBe(2); // legacy rail/flag-OFF diagonal contract
  });
  it("does not grow a side road arm on a deck after removing the railway", () => {
    const grid = flat(), t = createTrack(false); grid.builtAt = (x, y) => x === 20 && y === 20 ? "rail-y" : null;
    commitDrag(t, "road", previewDrag(grid, t, "road", rich, 18, 20, 22, 20, true, undefined, 0, undefined, false, { gradeSeparated: true }), 1);
    grid.builtAt = undefined; buildTile(t, "road", 20, 21, 1);
    expect(roadConnectionMask(t, 20, 20)).toBe(SE | NW);
    expect(roadConnectionMask(t, 20, 21) & NE).toBe(0);
  });
});
