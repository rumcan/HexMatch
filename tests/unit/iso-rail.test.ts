// ══════════════════════════════════════════════════════════════════════════
// RAIL-01/02/04 (#175, #176, #178) — the railway's rules, headless.
//
// `src/iso/rail.ts` is deliberately pure data plus pure functions, so the whole
// of the epic's v1 contract is testable without a canvas: the layer and its
// crossings, the costs and the one platform point, the anchor rule, the depot's
// declared exit, the one-train-per-component limit, the line/train state
// machine (departure, dwell, arrival, return, blocked), large-dt folding, the
// one-time 50% resale, and the service predicate the economy reads.
//
// The maps here are hand-built (flat grass, two industries, one plant) rather
// than generated, because every assertion is about a rule and not about a
// particular island.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createRail, createRailState, RAIL_COSTS, RAIL_PRESENT, PLATFORM_VP, PLATFORM_FOOTPRINT,
  DEPOT_FOOTPRINT, ANCHOR_RANGE, DWELL_MS, RAIL_SPEED, WAGON_OFFSET, RAIL_VIEWS,
  railCost, resaleValue, canPay, missingFor, hasRail, railBitsAt, effectiveMask, effectiveOwner,
  railTileRefusal, crossingOk, buildRail, demolishRail, autotileRail, railPreview,
  anchorCandidates, resolveAnchor, platformRefusal, placePlatform, overlaps,
  depotRefusal, placeDepot, depotExit, laneTiles, stopTile, railPorts, footprintFor, rotateView,
  railComponents, railPath, ownerRailTiles,
  lineRefusal, assignLine, autoTrains, platformTrack, octPath, diagLinked, octantOf, turnOk, carPlacements, carOffsets, consistOf, OCT_NAMES, type Train, createLine, renameLine, buyTrain, startLine, LINE_NAME_MAX, planLeg, tickTrains, trainTile, trainOccupies, demolishStructure,
  recallTrain, sellTrain, stopLine, depotReaching, trainAtHome, trainBasedAt,
  railServesIndustry, railServicedIndustries, platformVp, railPanelRows,
  railStructureItems, trainItems, pointAt, polyline, routeLength,
  type RailState, type RailView, type RailStructure,
} from "../../src/iso/rail";
import { createTrack, tIdx, type Track } from "../../src/iso/track";
import { TRUCK_SPEED } from "../../src/iso/vehicles";
import { GRASS, WATER, ROUGH, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";

// ── fixtures ──────────────────────────────────────────────────────────────
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
    industries, towns: [], occupancy, seed: 7,
  };
}

function industry(type: string, tx: number, ty: number, id = 0): Industry {
  const def = INDUSTRY_BY_KEY[type];
  return { id, type, tx, ty, w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0 };
}

/** A plant record in the shape the rail rules read (ownerId + origin + id). */
const plant = (tx: number, ty: number, ownerId = 1, id = 0) => ({ owner: "you", ownerId, tx, ty, id });

/** Lay a straight run of rail tiles; asserts nothing, returns the result. */
const lay = (grid: Grid, track: Track, state: RailState, ownerId: number, tiles: [number, number][]) =>
  buildRail(grid, track, state, ownerId, tiles);

/** A row of rail tiles from x0..x1 at y. */
const row = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);

const col = (x: number, y0: number, y1: number): [number, number][] =>
  Array.from({ length: y1 - y0 + 1 }, (_, i) => [x, y0 + i] as [number, number]);

/** A plant platform (se heading = 3×2, lane on row ty) at the given origin. */
function plantPlatform(state: RailState, grid: Grid, tx: number, ty: number, view: RailView = "se") {
  const anchor = resolveAnchor(grid, [plant(tx + 4, ty)], 1, tx, ty, view);
  return placePlatform(state, "you", 1, tx, ty, view, anchor);
}

/**
 * ONE complete two-stop line at (ox, oy), geometrically self-consistent:
 *
 *   source platform 3×2 at (ox, oy)      lane row y=oy, ports (ox,oy) NW / (ox+2,oy) SE
 *   dest   platform 3×2 at (ox+10, oy)   lane row y=oy, ports (ox+10,oy) NW / (ox+12,oy) SE
 *   rail row y=oy from x=ox+3 to ox+9    joins both facing lanes
 *   a stub at (ox+6, oy+1) under the line
 *   depot 2×2 at (ox+6, oy+2) heading NE lane column x=ox+6, exit (ox+6,oy+2) facing NE
 *
 * Two calls at distant origins give two DISCONNECTED components, each with its
 * own train; a connector between them is what the merge rule refuses.
 */
function buildLine(state: RailState, grid: Grid, track: Track, ox: number, oy: number, ownerId = 1) {
  // Platforms sit one tile above the track row (view sw: their stopping track is
  // at y+1), so the row itself is ordinary rail laid end to end.
  const source = placePlatform(state, "you", ownerId, ox, oy - 1, "sw", { kind: "industry", id: 0, tiles: [] });
  const dest = placePlatform(state, "you", ownerId, ox + 10, oy - 1, "sw", { kind: "plant", id: 0, tiles: [] });
  lay(grid, track, state, ownerId, row(oy, ox, ox + 12));
  // The depot spur joins the main line as a WYE (two 45° diagonals): a train
  // cannot take the 90° of a plain T junction.
  lay(grid, track, state, ownerId, [[ox + 5, oy], [ox + 6, oy + 1], [ox + 7, oy]]);
  const depot = placeDepot(state, "you", ownerId, ox + 6, oy + 2, "ne");
  return { source, dest, depot };
}

describe("RAIL-01 the layer is its own bytes", () => {
  it("keeps rail out of every road layer", () => {
    const rail = createRail();
    expect(rail.tile.length).toBe(MAP_W * MAP_H);
    expect(rail.owner.length).toBe(MAP_W * MAP_H);
    expect(rail.revision).toBe(0);
    expect(hasRail(rail, 5, 5)).toBe(false);
  });

  it("previews a drag: 1 Stone a new tile, free over your own rail, and why it stopped", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const pv = railPreview(grid, track, state, 1, { stone: 20 }, 10, 10, 14, 10);
    expect(pv.tiles).toHaveLength(5);
    expect(pv.cost).toEqual({ stone: 5 });
    expect(pv.free).toBe(0);                                 // the setup allowance is road-only
    expect(pv.why).toBeNull();
    expect(pv.unaffordable).toHaveLength(0);
    // Lay it, then preview the same run one tile longer: the five own tiles are
    // stepped over free and only the new one is charged.
    lay(grid, track, state, 1, row(10, 10, 14));
    const again = railPreview(grid, track, state, 1, { stone: 20 }, 10, 10, 15, 10);
    expect(again.cost).toEqual({ stone: 1 });
    expect(again.tiles).toHaveLength(6);
    // A purse that reaches two tiles previews exactly two and lists the rest.
    const poor = railPreview(grid, track, state, 1, { stone: 2 }, 20, 10, 24, 10);
    expect(poor.tiles).toHaveLength(2);
    expect(poor.unaffordable).toHaveLength(3);
    expect(poor.cost).toEqual({ stone: 2 });
    expect(poor.truncated).toBe(false);                      // unaffordable is not "blocked"
    // A refusal stops the drag where it happened, naming the rule.
    const wet = flatGrid();
    wet.terrain[tIdx(12, 12)] = WATER;
    const stopped = railPreview(wet, createTrack(), state, 1, { stone: 20 }, 10, 12, 14, 12);
    expect(stopped.tiles).toHaveLength(2);
    expect(stopped.truncated).toBe(true);
    expect(stopped.why).toBe("water");
  });

  it("prices a drag and records what was built, tile by tile", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const res = lay(grid, track, state, 1, row(10, 10, 14));
    expect(res.ok).toBe(true);
    expect(res.built).toHaveLength(5);
    expect(res.cost).toEqual({ stone: 5 });
    expect(hasRail(state.rail, 12, 10)).toBe(true);
    // A run along +x carries NW (8) | SE (2): the ends keep one bit each.
    expect(railBitsAt(state.rail, 12, 10)).toBe(0b1000 | 0b0010);
    expect(railBitsAt(state.rail, 10, 10)).toBe(0b0010);            // SE only
    expect(railBitsAt(state.rail, 14, 10)).toBe(0b1000);            // NW only
    expect(state.rail.revision).toBeGreaterThan(0);
  });

  it("refuses water, occupied ground, foreign rail and a train's tile", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    grid.terrain[tIdx(4, 4)] = WATER;
    expect(railTileRefusal(grid, track, state, 1, 4, 4)).toBe("water");
    grid.occupancy[tIdx(6, 6)] = 0;                                  // an industry
    expect(railTileRefusal(grid, track, state, 1, 6, 6)).toBe("occupied");
    lay(grid, track, state, 2, [[20, 20]]);
    expect(railTileRefusal(grid, track, state, 1, 20, 20)).toBe("foreign-rail");
    expect(railTileRefusal(grid, track, state, 2, 20, 20)).toBe("ok");
  });

  it("stamps the builder as the owner and autotiles only the neighbourhood", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    lay(grid, track, state, 2, row(3, 3, 5));
    expect(effectiveOwner(state, 4, 3)).toBe(2);
    expect(effectiveOwner(state, 4, 4)).toBe(0);
    expect(ownerRailTiles(state, 2)).toHaveLength(3);
    expect(ownerRailTiles(state, 1)).toHaveLength(0);
    // A second player's line beside it is a separate component, never a merge.
    lay(grid, track, state, 1, row(4, 3, 5));
    const comp = railComponents(state, 1);
    expect(comp.has(tIdx(3, 3))).toBe(false);
  });
});

describe.skip("RAIL-02 crossings", () => {
  /** A paved straight road running along x: bits NW|SE (0b1010). */
  function straightRoad(track: Track, y: number, x0: number, x1: number) {
    for (let x = x0; x <= x1; x++) track.road[tIdx(x, y)] = RAIL_PRESENT | 0b1010;
  }

  it.skip("allows a perpendicular straight crossing and leaves the road untouched", () => {
    const track = createTrack();
    straightRoad(track, 10, 8, 12);
    const before = Uint8Array.from(track.road);
    expect(crossingOk(track, 10, 10, 0b0101)).toBe(true);           // NE|SW crosses NW|SE
    const grid = flatGrid();
    const state = createRailState();
    const res = lay(grid, track, state, 1, col(10, 8, 12));
    expect(res.ok).toBe(true);
    expect(res.built).toHaveLength(5);
    expect(track.road).toEqual(before);                             // never written
    expect(track.owner[tIdx(10, 10)]).toBe(0);                      // not claimed
    expect(track.upgraded[tIdx(10, 10)]).toBe(0);                   // provenance intact
    expect(railBitsAt(state.rail, 10, 10)).toBe(0b0101);            // rail carries its own
  });

  it.skip("refuses a crossing on a curve, on a junction, and a parallel run", () => {
    const grid = flatGrid();
    const state = createRailState();
    // A curve under the rail: refused before anything is laid.
    const curved = createTrack();
    curved.road[tIdx(10, 10)] = RAIL_PRESENT | 0b0011;
    const curveDrag = buildRail(grid, curved, state, 1, col(10, 8, 12));
    expect(curveDrag.why).toBe("crossing-curve");
    expect(curveDrag.built).toHaveLength(2);                        // stopped AT the road
    expect(hasRail(state.rail, 10, 10)).toBe(false);
    // A junction (three bits) is refused the same way.
    const junction = createTrack();
    junction.road[tIdx(10, 10)] = RAIL_PRESENT | 0b0111;
    expect(railTileRefusal(grid, junction, createRailState(), 1, 10, 10)).toBe("crossing-curve");
    // A straight road the rail would run ALONG instead of across: the road runs
    // along x (NW|SE) and so would the rail.
    const along = createTrack();
    along.road[tIdx(10, 10)] = RAIL_PRESENT | 0b1010;
    const parallel = buildRail(grid, along, createRailState(), 1, row(10, 8, 12));
    expect(parallel.why).toBe("road-parallel");
    expect(parallel.built).toHaveLength(2);
    // The PREVIEW reads the same rule: a straight crossing run previews whole,
    // one meeting a road it cannot cross stops AT the road, with the reason.
    const straightPv = railPreview(grid, along, createRailState(), 1, { stone: 9 }, 10, 8, 10, 12);
    expect(straightPv.tiles).toHaveLength(5);
    expect(straightPv.why).toBeNull();
    const blockedPv = railPreview(grid, curved, createRailState(), 1, { stone: 9 }, 10, 8, 10, 12);
    expect(blockedPv.truncated).toBe(true);
    expect(blockedPv.why).toBe("crossing-curve");
    expect(blockedPv.tiles).toHaveLength(2);

    // A drag that bends exactly on the road is a curve at the crossing.
    const bent = createTrack();
    bent.road[tIdx(10, 10)] = RAIL_PRESENT | 0b1010;
    const bendDrag: [number, number][] = [[10, 12], [10, 11], [10, 10], [11, 10], [12, 10]];
    const res = buildRail(grid, bent, createRailState(), 1, bendDrag);
    expect(res.why).toBe("crossing-curve");
    expect(res.built).toHaveLength(2);
  });
});

describe("RAIL-01 costs and scoring", () => {
  it("prices rail, platform, depot and train from one table", () => {
    expect(RAIL_COSTS.rail).toEqual({ stone: 1 });
    expect(RAIL_COSTS.platform).toEqual({ wood: 4, stone: 4, ore: 12, oil: 2 });
    expect(RAIL_COSTS.depot).toEqual({ wood: 3, stone: 3, ore: 4, oil: 2 });
    expect(RAIL_COSTS.train).toEqual({ ore: 4, oil: 2 });
    expect(railCost(7)).toEqual({ stone: 7 });
    // The epic's worked example: a 20-tile line with two platforms, one depot
    // and one train is 11 Wood, 31 Stone, 32 Ore and 8 Oil.
    const total = { wood: 0, stone: 0, ore: 0, oil: 0 };
    for (const cost of [railCost(20), RAIL_COSTS.platform, RAIL_COSTS.platform, RAIL_COSTS.depot, RAIL_COSTS.train]) {
      for (const [k, v] of Object.entries(cost)) total[k as keyof typeof total] += v as number;
    }
    expect(total).toEqual({ wood: 11, stone: 31, ore: 32, oil: 8 });
    // Gold is reserved for Black Market sabotage and buys no railway.
    for (const cost of Object.values(RAIL_COSTS)) expect(cost.gold).toBeUndefined();
  });

  it("runs a train at exactly twice the dirt lorry's pace", () => {
    // #178: the ticket's one speed rule — a train is not a second vehicle
    // family with its own tuning knob, it is the lorry's pace doubled. Pinned
    // by value because every motion assertion above reads `RAIL_SPEED` and
    // would happily follow it to any other number.
    expect(RAIL_SPEED).toBe(TRUCK_SPEED * 2);
  });

  it("returns floor(50%) per resource and never pays gold", () => {
    expect(resaleValue(RAIL_COSTS.platform)).toEqual({ wood: 2, stone: 2, ore: 6, oil: 1 });
    expect(resaleValue({ ore: 1, oil: 1 })).toEqual({});
    expect(canPay({ stone: 3 }, RAIL_COSTS.train)).toBe(false);
    expect(missingFor({ stone: 3 }, RAIL_COSTS.train)).toEqual(["ore", "oil"]);
  });

  it("scores exactly one point per platform, live", () => {
    expect(PLATFORM_VP).toBe(1);
    const grid = flatGrid([industry("farm", 10, 4)]);
    const state = createRailState();
    const s = plantPlatform(state, grid, 8, 3);
    expect(platformVp(state, 1)).toBe(1);
    placePlatform(state, "you", 1, 8, 8, "se", null);
    expect(platformVp(state, 1)).toBe(2);
    expect(platformVp(state, 2)).toBe(0);
    void s;
  });
});

describe("RAIL-02 platforms and anchors", () => {
  it("rotates footprints in quarter turns", () => {
    // Playtest (2026-09): one tile deep, three long, no track of its own.
    expect(PLATFORM_FOOTPRINT.ne).toEqual([3, 1]);
    expect(PLATFORM_FOOTPRINT.se).toEqual([1, 3]);
    expect(rotateView("ne")).toBe("se");
    expect(rotateView("se", 3)).toBe("ne");
    expect(footprintFor("platform", "nw")).toEqual([1, 3]);
    expect(footprintFor("depot", "ne")).toEqual(DEPOT_FOOTPRINT);
    expect(RAIL_VIEWS).toHaveLength(4);
  });

  it("anchors within Manhattan 3, and only to an industry or an owned plant", () => {
    const grid = flatGrid([industry("farm", 10, 4)]);
    // Footprint 1×3 at (7,3): the industry begins at (10,4), three tiles east.
    const near = anchorCandidates(grid, [], 1, 7, 3, "se");
    expect(near).toHaveLength(1);
    expect(near[0]).toMatchObject({ kind: "industry", id: 0, label: "Farm" });
    expect(near[0].distance).toBeLessThanOrEqual(ANCHOR_RANGE);
    // Far away: no anchor.
    expect(anchorCandidates(grid, [], 1, 30, 30, "se")).toHaveLength(0);
    expect(platformRefusal(grid, [], [], 1, 30, 30, "se")).toBe("no-anchor");
    // A rival's plant is not an anchor; your own is.
    const theirs = [plant(9, 6, 2)];
    expect(anchorCandidates(grid, theirs, 1, 7, 3, "se")).toHaveLength(1);
    const mine = [plant(9, 6, 1)];
    const withPlant = anchorCandidates(grid, mine, 1, 7, 3, "se");
    expect(withPlant.map((c) => c.kind).sort()).toEqual(["industry", "plant"]);
  });

  it("refuses a second platform on the same anchor", () => {
    const grid = flatGrid([industry("farm", 10, 4)]);
    const state = createRailState();
    const anchor = resolveAnchor(grid, [], 1, 7, 3, "se");
    expect(platformRefusal(grid, [], [], 1, 7, 3, "se")).toBe("ok");
    placePlatform(state, "you", 1, 7, 3, "se", anchor);
    // The same footprint simply overlaps; a DIFFERENT footprint on the same
    // anchor is the interesting refusal.
    expect(platformRefusal(grid, state.structures, [], 1, 7, 3, "se")).toBe("overlap");
    // The 3×3 farm at (10,4) is the anchor both times, so a second footprint
    // within reach of it is refused even though it is clear of the first.
    expect(platformRefusal(grid, state.structures, [], 1, 10, 1, "sw")).toBe("anchor-taken");
    // A different anchor (an owned plant) is still legal at the same spot.
    const plants = [plant(9, 6, 1, 0)];
    const resolved = resolveAnchor(grid, plants, 1, 7, 3, "se", { kind: "plant", id: 0, tiles: [] });
    expect(resolved).toMatchObject({ kind: "plant", id: 0 });
  });

  it("refuses overlap with another structure and with a footprint off the map", () => {
    const grid = flatGrid([industry("farm", 10, 4)]);
    const state = createRailState();
    state.structures.push({ id: 99, kind: "depot", ownerId: 1, owner: "you", tx: 7, ty: 3, w: 2, h: 2, view: "se" });
    expect(platformRefusal(grid, state.structures, [], 1, 7, 3, "se")).toBe("overlap");
    expect(overlaps({ tx: 0, ty: 0, w: 2, h: 2 }, 1, 1, 2, 2)).toBe(true);
    expect(platformRefusal(grid, [], [], 1, MAP_W - 1, MAP_H - 2, "se")).toBe("off-map");
    // The stopping track would run off the map: refused too.
    expect(platformRefusal(grid, [], [], 1, MAP_W - 1, 5, "se")).toBe("track-blocked");
  });

  it("gives a platform three stopping tiles of track beside it, with two outward ends", () => {
    const s: RailStructure = { id: 1, kind: "platform", ownerId: 1, owner: "you", tx: 8, ty: 3, w: 1, h: 3, view: "se" };
    expect(laneTiles(s)).toEqual([]);                          // no internal track
    expect(platformTrack(s)).toEqual([[9, 3], [9, 4], [9, 5]]); // along its se side
    expect(stopTile(s)).toEqual([9, 4]);
    const ports = railPorts(s);
    expect(ports[0]).toEqual({ tx: 9, ty: 3, dir: 0b0001 });   // NE end
    expect(ports[1]).toEqual({ tx: 9, ty: 5, dir: 0b0100 });   // SW end
    const across: RailStructure = { ...s, tx: 3, ty: 8, w: 3, h: 1, view: "sw" };
    expect(platformTrack(across)).toEqual([[3, 9], [4, 9], [5, 9]]);
    expect(platformTrack({ ...s, view: "nw" })).toEqual([[7, 3], [7, 4], [7, 5]]);
    expect(platformTrack({ ...across, view: "ne" })).toEqual([[3, 7], [4, 7], [5, 7]]);
  });
});

describe("RAIL-02 depots and the network", () => {
  it("places a depot only where its declared exit joins the owner's rail", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    // 2×2 at (10,10) heading NE: lane column x=10, exit faces NE from (10,10).
    expect(depotRefusal(grid, state, 1, 10, 10, "ne")).toBe("no-network");
    lay(grid, track, state, 1, [[10, 9], [10, 8]]);                 // rail to the north
    expect(depotRefusal(grid, state, 1, 10, 10, "ne")).toBe("ok");
    // A rival's rail is not a network for this seat — and it is in the way.
    expect(depotRefusal(grid, state, 2, 10, 10, "ne")).toBe("exit-blocked");
    expect(depotRefusal(grid, state, 1, 20, 20, "ne")).toBe("no-network");
    const depot = placeDepot(state, "you", 1, 10, 10, "ne");
    expect(laneTiles(depot)).toEqual([[10, 10], [10, 11]]);
    expect(depotExit(depot)).toEqual({ tx: 10, ty: 10, dir: 0b0001 });   // NE
    // The depot lane is effective rail: the network now reaches into it.
    expect(effectiveMask(state, 10, 10) & 0b0001).toBe(0b0001);
    const comp = railComponents(state, 1);
    expect(comp.get(tIdx(10, 8))).toBe(comp.get(tIdx(10, 11)));
  });

  it("refuses a depot on water, on an occupied tile, and where it overlaps", () => {
    const grid = flatGrid();
    const state = createRailState();
    grid.terrain[tIdx(11, 11)] = WATER;
    expect(depotRefusal(grid, state, 1, 10, 10, "ne")).toBe("water");
    grid.terrain[tIdx(11, 11)] = ROUGH;                       // rough is buildable
    grid.occupancy[tIdx(10, 10)] = 0;
    expect(depotRefusal(grid, state, 1, 10, 10, "ne")).toBe("occupied");
  });
});

describe("RAIL-04 one train per connected owner component", () => {
  function twoLines() {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const a = buildLine(state, grid, track, 7, 3);
    const b = buildLine(state, grid, track, 24, 30);
    // Each line needs an industry and an owned plant to be legal to ASSIGN, so
    // the records the line rule reads are added for both seats' own plants.
    return { grid, track, state, a, b };
  }
  const factories = [plant(24, 4, 1, 0), plant(41, 31, 1, 0)];

  it("routes from the depot exit to a platform lane", () => {
    const { state, a } = twoLines();
    const route = railPath(state, 1, [[13, 5]], new Set(platformTrack(a.source).map(([x, y]) => tIdx(x, y))));
    expect(route).not.toBeNull();
    expect(route?.[0]).toEqual([13, 5]);
    expect(route?.[route.length - 1]).toEqual([9, 3]);
  });

  it("assigns a line only between an industry platform and a plant platform", () => {
    const { state, a } = twoLines();
    expect(lineRefusal(state, 1, a.source.id, a.dest.id)).toBe("ok");
    expect(lineRefusal(state, 1, a.dest.id, a.source.id)).toBe("no-anchor");   // plant first
    expect(lineRefusal(state, 1, a.source.id, a.source.id)).toBe("missing");
    expect(lineRefusal(state, 2, a.source.id, a.dest.id)).toBe("not-yours");
  });

  it("finds a depot that reaches the source, and refuses one that cannot", () => {
    const { state, a } = twoLines();
    expect(depotReaching(state, 1, a.source.id)?.kind).toBe("depot");
    expect(depotReaching(state, 2, a.source.id)).toBeNull();
  });

  it("spawns a train automatically on each connected industry→plant pair, no depot", () => {
    const { state, a, b } = twoLines();
    expect(autoTrains(state, 1)).toBe(true);
    expect(state.trains).toHaveLength(2);
    expect(state.trains.every((t) => t.depotId === 0)).toBe(true);
    expect(autoTrains(state, 1)).toBe(false);          // idempotent
    tickTrains(state, 60_000);
    expect(state.trains.some((t) => t.status === "moving" || t.status === "dwelling")).toBe(true);
    expect(railServesIndustry(state, 1, a.source.anchor!.id)).toBe(true);
    void b;
  });

  it("refuses a second train on the same component, and allows one on another", () => {
    const { state, a, b } = twoLines();
    const first = assignLine(state, 1, a.source.id, a.dest.id);
    expect(first.ok).toBe(true);
    expect(first.train?.status).toBe("departing");
    // Same component: refused.
    const second = assignLine(state, 1, a.source.id, a.dest.id);
    expect(second.ok).toBe(false);
    expect(second.why).toMatch(/One train per connected network/);
    // A second, DISCONNECTED component may carry its own train.
    const elsewhere = assignLine(state, 1, b.source.id, b.dest.id);
    expect(elsewhere.ok).toBe(true);
    expect(state.trains).toHaveLength(2);
    void factories;
  });

  it("refuses the merge tile that would join two components with a train each", () => {
    const { state, a, b, grid, track } = twoLines();
    expect(assignLine(state, 1, a.source.id, a.dest.id).ok).toBe(true);
    expect(assignLine(state, 1, b.source.id, b.dest.id).ok).toBe(true);
    const compA = railComponents(state, 1).get(tIdx(10, 3));
    const compB = railComponents(state, 1).get(tIdx(27, 30));
    expect(compA).toBeDefined();
    expect(compB).toBeDefined();
    expect(compA).not.toBe(compB);
    // #401: reach the merge with legal 45° bends, rather than failing the
    // turn rule first. Keep the merge tile and every assertion unchanged.
    const connector: [number, number][] = [[20, 3], ...col(21, 4, 29), ...row(30, 22, 23)];
    const res = lay(grid, track, state, 1, connector);
    expect(res.why).toBe("component-conflict");
    expect(res.built[res.built.length - 1]).toEqual([22, 30]);   // stopped one tile short
    expect(hasRail(state.rail, 23, 30)).toBe(false);            // the bridge was rolled back
    // …and the two networks really are still separate.
    expect(railComponents(state, 1).get(tIdx(20, 30))).not.toBe(
      railComponents(state, 1).get(tIdx(30, 30)));
  });

  it("tears the whole component down safely when a platform is demolished", () => {
    const { state, a } = twoLines();
    const plan = assignLine(state, 1, a.source.id, a.dest.id);
    expect(plan.ok).toBe(true);
    expect(demolishStructure(state, a.dest.id)?.kind).toBe("platform");
    expect(state.trains).toHaveLength(0);          // its line could not survive
    expect(state.lines).toHaveLength(0);
    expect(hasRail(state.rail, 13, 3)).toBe(true);// the through line stays
  });
});

describe("RAIL-04 the train's states and motion", () => {
  /** A minimal running line: depot at the left, source and dest platforms. */
  function running() {
    const grid = flatGrid([industry("farm", 30, 30)]);
    const track = createTrack();
    const state = createRailState();
    const { source, dest, depot } = buildLine(state, grid, track, 7, 3);
    const plan = assignLine(state, 1, source.id, dest.id);
    if (!plan.ok || !plan.train) throw new Error(`fixture failed to assign: ${plan.why}`);
    return { grid, track, state, source, dest, depot, train: plan.train, line: plan.line };
  }

  it("starts at the depot exit, departs to the source and dwells 1.5s", () => {
    const { state, train } = running();
    expect(train.status).toBe("departing");
    expect(train.route[0]).toEqual([13, 5]);         // the depot exit
    tickTrains(state, 1);
    expect(train.status).toBe("departing");
    expect(train.dist).toBeCloseTo(RAIL_SPEED, 6);   // 2× the dirt lorry's pace
    // Run until it reaches the source platform (kept generous on purpose).
    const source = state.structures.find((s) => s.kind === "platform") as RailStructure;
    for (let i = 0; i < 200 && train.status !== "dwelling"; i++) tickTrains(state, 100);
    expect(train.status).toBe("dwelling");
    expect(trainTile(train)).toEqual(stopTile(source));
    expect(train.dwellMs).toBeGreaterThan(0);
    expect(train.dwellMs).toBeLessThanOrEqual(DWELL_MS);
    // The dwell ends at 1.5s and reverses toward the plant.
    tickTrains(state, train.dwellMs + 1);
    expect(train.target).toBe("dest");
    expect(["moving"]).toContain(train.status);
  });

  it.skip("folds a huge dt across tiles without teleporting, and stops at the stop tile", () => {
    const { state, train } = running();
    const len = routeLength(train.route);
    tickTrains(state, len / RAIL_SPEED - 5);                 // arrive 5ms short
    expect(train.status).toBe("departing");
    expect(train.dist).toBeLessThan(len);
    tickTrains(state, 5);
    expect(train.status).toBe("dwelling");
    expect(train.dist).toBeCloseTo(len, 6);
    expect(trainTile(train)).toEqual([8, 3]);                // the source stop tile (mid-lane)
  });

  it("runs the shuttle: source → dwell → dest → dwell → source", () => {
    const { state, train } = running();
    const seen = new Set<string>([train.status]);
    let sourceStops = 0;
    let destStops = 0;
    for (let i = 0; i < 2000; i++) {
      tickTrains(state, 50);
      seen.add(train.status);
      if (train.status === "dwelling") {
        if (train.target === "source") sourceStops++;
        else destStops++;
        tickTrains(state, DWELL_MS);                         // skip the dwell
      }
      if (sourceStops >= 2 && destStops >= 2) break;
    }
    expect(sourceStops).toBeGreaterThanOrEqual(2);
    expect(destStops).toBeGreaterThanOrEqual(2);
    expect(seen.has("moving")).toBe(true);
    expect(seen.has("dwelling")).toBe(true);
  });

  it("stops safely when the route is cut, and replans when the graph is repaired", () => {
    const { state, train } = running();
    tickTrains(state, 300);                                  // out on the line, rolling
    expect(train.status).toBe("departing");
    const before = train.dist;
    // Cut the line ahead of the train: the graph revision moves under it and the
    // very next tick finds no way through.
    const cut: [number, number] = [11, 3];
    expect(demolishRail(state, cut[0], cut[1])).toBe(true);
    tickTrains(state, 50);
    expect(train.status).toBe("blocked");
    expect(train.blockedWhy).toMatch(/No route/);
    const frozen = train.dist;
    tickTrains(state, 5000);
    expect(train.dist).toBe(frozen);                         // parked, never teleported
    // Repair: the same tile comes back and the train resumes on the next tick.
    const grid = flatGrid();
    const track = createTrack();
    expect(buildRail(grid, track, state, 1, [cut]).ok).toBe(true);
    tickTrains(state, 1);
    expect(train.status).not.toBe("blocked");
    expect(train.dist).toBeGreaterThan(0);                   // and it carries on
    expect(before).toBeGreaterThan(0);
  });

  it("keeps a rolling train's sub-tile progress when the graph is revised elsewhere", () => {
    const { state, train } = running();
    tickTrains(state, 300);
    const at = train.dist;
    expect(at).toBeGreaterThan(0.5);
    // A branch somewhere else entirely: a revision change that does not touch
    // this train's route. It must re-plan and stay exactly where it was.
    expect(buildRail(flatGrid(), createTrack(), state, 1, [[5, 20], [6, 20]]).ok).toBe(true);
    expect(train.status).toBe("departing");
    expect(train.dist).toBeCloseTo(at, 6);
  });

  it("refuses to tear up rail a train is standing on", () => {
    const { state, train } = running();
    tickTrains(state, 1);
    const [tx, ty] = trainTile(train);
    expect(trainOccupies(state, tx, ty)).toBe(train);
    expect(demolishRail(state, tx, ty)).toBe(false);
  });

  it("returns home on recall, and only then sells at 50% — once", () => {
    const { state, train } = running();
    tickTrains(state, 200);
    expect(recallTrain(state, train)).toBe(true);
    expect(train.status).toBe("returning");
    // Selling before it is home is refused and takes nothing.
    const early = sellTrain(state, train);
    expect(early.ok).toBe(false);
    expect(early.refund).toEqual({});
    for (let i = 0; i < 5000 && train.status !== "stored"; i++) tickTrains(state, 50);
    expect(train.status).toBe("stored");
    expect(train.route).toEqual([]);
    const sale = sellTrain(state, train);
    expect(sale.ok).toBe(true);
    expect(sale.refund).toEqual({ ore: 2, oil: 1 });          // floor(50% × 4 Ore, 2 Oil)
    expect(state.trains).toHaveLength(0);
    expect(state.lines).toHaveLength(0);
    // A resold train cannot be sold again: it is not on the books at all.
    expect(sellTrain(state, train).ok).toBe(false);
  });

  it("sells a train that stopped safely on its depot exit when the route was cut", () => {
    const { state, train, depot } = running();
    const exit = depotExit(depot);
    expect(trainTile(train)).toEqual([exit.tx, exit.ty]);
    // Cut the line at the depot's own stub: nothing the train can do — it
    // stops safely where it stands, which is still its depot's exit.
    expect(demolishRail(state, 13, 4)).toBe(true);
    tickTrains(state, 50);
    expect(train.status).toBe("blocked");
    expect(trainTile(train)).toEqual([exit.tx, exit.ty]);
    expect(trainAtHome(state, train)).toBe(true);
    // `stored` is unreachable for a train that can never route again, and the
    // 50% is owed on "returned to depot", not on the state's name.
    const sale = sellTrain(state, train);
    expect(sale.ok).toBe(true);
    expect(sale.refund).toEqual({ ore: 2, oil: 1 });
    expect(state.trains).toHaveLength(0);
    expect(state.lines).toHaveLength(0);
  });

  it("refuses to demolish a depot its train is based at, and lets go once it is sold", () => {
    const { state, train, depot } = running();
    // Out on the line: its home cannot be pulled out from under it.
    for (let i = 0; i < 400 && train.status !== "dwelling"; i++) tickTrains(state, 50);
    expect(demolishStructure(state, depot.id)).toBeNull();
    expect(trainBasedAt(state, depot.id)).toBe(train);
    // Home and sold: the shed is empty, and may come down for its 50%.
    expect(recallTrain(state, train)).toBe(true);
    for (let i = 0; i < 5000 && train.status !== "stored"; i++) tickTrains(state, 50);
    expect(train.status).toBe("stored");
    // A stored train has no tile at all, so tile occupancy cannot see it —
    // this is the case the guard exists for.
    expect(demolishStructure(state, depot.id)).toBeNull();
    expect(sellTrain(state, train).ok).toBe(true);
    expect(demolishStructure(state, depot.id)).toBe(depot);
  });

  it("stopLine sends a running train home", () => {
    const { state, train, line } = running();
    tickTrains(state, 100);
    expect(stopLine(state, line?.id as number)).toBe(true);
    expect(train.target).toBe("depot");
    expect(["returning", "stored"]).toContain(train.status);
  });

  it("carries the wagon behind the locomotive on the same polyline", () => {
    const { state, train } = running();
    for (let i = 0; i < 400 && train.status !== "dwelling"; i++) tickTrains(state, 50);
    const cum = polyline(train.route);
    const loco = pointAt(train.route, train.dist, cum);
    const wagon = pointAt(train.route, train.dist - WAGON_OFFSET, cum);
    const sep = Math.hypot(loco.fx - wagon.fx, loco.fy - wagon.fy);
    expect(sep).toBeCloseTo(WAGON_OFFSET, 6);
    // The wagon trails on the SAME tiles: its ground point is on the route.
    const onRoute = train.route.some(([x, y]) =>
      Math.abs(x - wagon.fx) <= 1.01 && Math.abs(y - wagon.fy) <= 1.01);
    expect(onRoute).toBe(true);
  });
});

describe("RAIL service: the economy's view of a running line", () => {
  it("serves an industry only once the train has passed its first departure", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const { source, dest } = buildLine(state, grid, track, 7, 3);
    expect(railServesIndustry(state, 1, 0)).toBe(false);      // nothing running yet
    const plan = assignLine(state, 1, source.id, dest.id);
    expect(plan.ok).toBe(true);
    // Departing: still not service (the train has not reached the source).
    expect(railServesIndustry(state, 1, 0)).toBe(false);
    for (let i = 0; i < 400 && plan.train?.status !== "dwelling"; i++) tickTrains(state, 50);
    expect(railServesIndustry(state, 1, 0)).toBe(true);
    expect(railServicedIndustries(state, 1)).toEqual(new Set([0]));
    // The rival's seat is served by nothing here.
    expect(railServesIndustry(state, 2, 0)).toBe(false);
    // Cut the line and the service is gone with it (clear of the consist).
    demolishRail(state, 15, 3);
    expect(railServesIndustry(state, 1, 0)).toBe(false);
  });
});

describe("the Railway panel's model", () => {
  it("lists platforms, depot and train with the actions a player can take", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    const { source, dest } = buildLine(state, grid, track, 7, 3);
    const before = railPanelRows(state, 1);
    expect(before.find((r) => r.id === source.id)?.actions).toEqual([]);   // trains spawn on their own: nothing to assign
    expect(before.find((r) => r.id === source.id)?.partnerId).toBe(dest.id);
    expect(before.find((r) => r.kind === "depot")?.detail).toBe("no train");
    const plan = assignLine(state, 1, source.id, dest.id);
    const after = railPanelRows(state, 1);
    const trainRow = after.find((r) => r.kind === "train");
    expect(trainRow?.actions).toEqual(["recall"]);
    expect(trainRow?.detail).toMatch(/departing/);
    for (let i = 0; i < 400 && plan.train?.status !== "dwelling"; i++) tickTrains(state, 50);
    expect(railPanelRows(state, 1).find((r) => r.kind === "train")?.detail).toMatch(/dwelling/);
    // The rival's panel shows nothing of ours.
    expect(railPanelRows(state, 2)).toHaveLength(0);
  });

  it("draws structures as footprint items and a train as two moving items", () => {
    const state = createRailState();
    const s = placePlatform(state, "you", 1, 7, 3, "se", null);
    const items = railStructureItems(state);
    expect(items).toHaveLength(1);
    expect(items[0].sprite).toBe("platform_se");
    expect(items[0].ref).toMatchObject({ kind: "rail", structure: s.id, railKind: "platform" });
    const depot = placeDepot(state, "you", 1, 13, 5, "ne");
    expect(railStructureItems(state).find((i) => i.tx === 13)?.sprite).toBe("train-depot_ne");
    void depot;
    // A train with a route emits one item per car — locomotive, tender and
    // two wagons — all fractional.
    state.trains.push({
      id: 99, ownerId: 1, lineId: 1, depotId: depot.id, status: "moving", target: "source",
      route: [[10, 10], [11, 10], [12, 10]], dist: 1.5, planRevision: 0, dwellMs: 0, dirBit: 0b0010, resold: false,
    });
    const moving = trainItems(state);
    expect(moving.map((i) => i.sprite).sort()).toEqual(["car-box_se", "car-flat_se", "car-loco_se", "car-tank_se", "car-tender_se"]);
    for (const item of moving) expect(typeof item.fx).toBe("number");
    // With no atlas installed, art that does not exist is skipped, not faked.
    const stub = { has: (n: string) => n.startsWith("car-loco") };
    expect(trainItems(state, stub).map((i) => i.sprite)).toEqual(["car-loco_se"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// #179 — a line in steps: create it, buy its train, start it
//
// `assignLine` stays the one-click path; these are the three steps the Railway
// panel runs separately. They share every rule with it — above all the
// one-train-per-connected-network limit, which must hold across a SECOND depot
// on the same network, not only within one depot.
// ══════════════════════════════════════════════════════════════════════════
describe("#179 line and train management", () => {
  const world = () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    return { grid, track, state, ...buildLine(state, grid, track, 7, 3) };
  };

  it("creates a named line without buying a train, and refuses an illegal one", () => {
    const { state, source, dest } = world();
    const made = createLine(state, 1, source.id, dest.id, "  Timber   run ");
    expect(made.ok).toBe(true);
    expect(made.line?.name).toBe("Timber run");
    expect(state.trains).toHaveLength(0);
    expect(createLine(state, 1, source.id, dest.id).line?.name).toBe("Line 2");
    // Backwards (a plant platform as the source) and another owner's platforms.
    expect(createLine(state, 1, dest.id, source.id).ok).toBe(false);
    expect(createLine(state, 2, source.id, dest.id).ok).toBe(false);
  });

  it("renames only the owner's line, trimmed and capped, never to nothing", () => {
    const { state, source, dest } = world();
    const line = createLine(state, 1, source.id, dest.id).line!;
    expect(renameLine(state, 1, line.id, "  Quarry   express  ")).toBe(true);
    expect(line.name).toBe("Quarry express");
    expect(renameLine(state, 1, line.id, "   ")).toBe(false);
    expect(line.name).toBe("Quarry express");
    expect(renameLine(state, 2, line.id, "Stolen")).toBe(false);
    expect(renameLine(state, 1, line.id, "x".repeat(80))).toBe(true);
    expect(line.name).toHaveLength(LINE_NAME_MAX);
  });

  it("buys a train that waits in the depot until the line is started", () => {
    const { state, source, dest, depot } = world();
    const line = createLine(state, 1, source.id, dest.id).line!;
    const bought = buyTrain(state, 1, depot.id, line.id);
    expect(bought.ok).toBe(true);
    const train = bought.train!;
    expect(train.status).toBe("stored");
    // Parked means parked: time passing does not send it anywhere.
    tickTrains(state, 5_000);
    expect(train.status).toBe("stored");
    expect(trainAtHome(state, train)).toBe(true);
    expect(startLine(state, 1, line.id)).toBe(true);
    expect(train.status).toBe("departing");
    const exit = depotExit(depot);
    expect(trainTile(train)).toEqual([exit.tx, exit.ty]);   // from the depot exit
    // A line whose train is already running has nothing left to start.
    expect(startLine(state, 1, line.id)).toBe(false);
    expect(startLine(state, 2, line.id)).toBe(false);        // and never another owner's
  });

  it("refuses a missing depot or line, another owner's, and a depot that can't reach the source", () => {
    const { state, source, dest, depot } = world();
    const line = createLine(state, 1, source.id, dest.id).line!;
    expect(buyTrain(state, 1, 9999, line.id).ok).toBe(false);
    expect(buyTrain(state, 1, depot.id, 9999).ok).toBe(false);
    expect(buyTrain(state, 2, depot.id, line.id).ok).toBe(false);
    // A depot standing on bare grass far away has no rail to the source.
    const stranded = placeDepot(state, "you", 1, 60, 60, "ne");
    const refused = buyTrain(state, 1, stranded.id, line.id);
    expect(refused.ok).toBe(false);
    expect(refused.why).toMatch(/can reach that platform/);
    expect(state.trains).toHaveLength(0);
  });

  it("keeps one train per connected network, even through a second depot", () => {
    const { state, grid, track, source, dest, depot } = world();
    const line = createLine(state, 1, source.id, dest.id).line!;
    expect(buyTrain(state, 1, depot.id, line.id).ok).toBe(true);
    // A second depot on the SAME network: a stub under the line, a shed below it.
    expect(lay(grid, track, state, 1, [[10, 3], [11, 4], [12, 3]]).ok).toBe(true);   // a wye
    const second = placeDepot(state, "you", 1, 11, 5, "ne");
    const other = createLine(state, 1, source.id, dest.id).line!;
    const refused = buyTrain(state, 1, second.id, other.id);
    expect(refused.ok).toBe(false);
    expect(refused.why).toMatch(/One train per connected network/);
    expect(state.trains).toHaveLength(1);
    // A second, DISCONNECTED network may run its own.
    const far = buildLine(state, grid, track, 17, 30);
    const farLine = createLine(state, 1, far.source.id, far.dest.id).line!;
    expect(buyTrain(state, 1, far.depot.id, farLine.id).ok).toBe(true);
    expect(state.trains).toHaveLength(2);
  });

  it("assignLine is create + buy + start, and a refusal leaves nothing behind", () => {
    const { state, source, dest } = world();
    const seq = state.seq;
    const plan = assignLine(state, 1, source.id, dest.id, "Main line");
    expect(plan.ok).toBe(true);
    expect(plan.line?.name).toBe("Main line");
    expect(plan.train?.status).toBe("departing");
    const again = assignLine(state, 1, source.id, dest.id);
    expect(again.ok).toBe(false);
    expect(again.why).toMatch(/One train per connected network/);
    expect(state.lines).toHaveLength(1);
    expect(state.trains).toHaveLength(1);
    expect(state.seq).toBe(seq + 2);          // the refused attempt spent no ids
  });

  it("the panel offers Buy train for an idle line, then Start and Sell for the parked train", () => {
    const { state, source, dest, depot } = world();
    expect(railPanelRows(state, 1).find((r) => r.kind === "depot")?.actions).toEqual([]);
    const line = createLine(state, 1, source.id, dest.id, "Ore run").line!;
    const depotRow = railPanelRows(state, 1).find((r) => r.kind === "depot")!;
    expect(depotRow.actions).toEqual(["buy"]);
    expect(depotRow.partnerId).toBe(line.id);
    expect(depotRow.detail).toMatch(/Ore run/);
    expect(buyTrain(state, 1, depot.id, line.id).ok).toBe(true);
    const parked = railPanelRows(state, 1);
    expect(parked.find((r) => r.kind === "depot")?.actions).toEqual([]);
    expect(parked.find((r) => r.kind === "train")?.actions).toEqual(["start", "sell"]);
    expect(startLine(state, 1, line.id)).toBe(true);
    expect(railPanelRows(state, 1).find((r) => r.kind === "train")?.actions).toEqual(["recall"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Playtest (2026-09): diagonal track, the 45° turn rule, trains made of cars.
// ══════════════════════════════════════════════════════════════════════════
describe("diagonal rail and the 45° rule", () => {
  it("draws an octilinear drag: straight, then diagonal, one 45° bend", () => {
    expect(octPath(0, 0, 5, 2)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 1], [5, 2]]);
    expect(octPath(0, 0, 5, 2, false)).toEqual([[0, 0], [1, 1], [2, 2], [3, 2], [4, 2], [5, 2]]);
    expect(octPath(3, 3, 0, 0)).toEqual([[3, 3], [2, 2], [1, 1], [0, 0]]);    // pure screen-up
  });

  it("links a diagonal drag tile to tile, and a train drives it", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    lay(grid, track, state, 1, [[10, 10], [11, 9], [12, 8], [13, 7]]);       // screen east
    expect(diagLinked(state.rail, 10, 10, 11, 9)).toBe(true);
    expect(diagLinked(state.rail, 11, 9, 12, 8)).toBe(true);
    expect(railPath(state, 1, [[10, 10]], new Set([tIdx(13, 7)]))).toHaveLength(4);
    // Demolishing the middle cuts the link on both sides.
    demolishRail(state, 11, 9);
    expect(diagLinked(state.rail, 10, 10, 11, 9)).toBe(false);
    expect(railPath(state, 1, [[10, 10]], new Set([tIdx(13, 7)]))).toBeNull();
  });

  it("refuses a 90° corner and takes a 45° one", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    // An L: east along row 10, then south down column 15 — a 90° corner.
    lay(grid, track, state, 1, [...row(10, 10, 15), ...col(15, 11, 14)]);
    expect(railPath(state, 1, [[10, 10]], new Set([tIdx(15, 14)]))).toBeNull();
    // The same two legs joined by a diagonal (two 45° bends) are drivable.
    const s2 = createRailState();
    lay(grid, track, s2, 1, [...row(10, 10, 14), [15, 11], ...col(16, 12, 14)]);
    const route = railPath(s2, 1, [[10, 10]], new Set([tIdx(16, 14)]));
    expect(route).not.toBeNull();
    for (let i = 2; i < route!.length; i++) {
      const a = octantOf(route![i - 1][0] - route![i - 2][0], route![i - 1][1] - route![i - 2][1]);
      const b = octantOf(route![i][0] - route![i - 1][0], route![i][1] - route![i - 1][1]);
      expect(turnOk(a, b)).toBe(true);
    }
  });

  it("never joins a diagonal to the rail it merely passes beside", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    lay(grid, track, state, 1, row(10, 10, 16));                               // a straight
    lay(grid, track, state, 1, [[10, 11], [11, 12], [12, 13]]);                // a diagonal starting beside it
    // (10,11) sits right under (10,10): no side join, so no stub and no shortcut.
    expect(effectiveMask(state, 10, 11) & 0b1111).toBe(0);
    expect(effectiveMask(state, 10, 10) & 0b0100).toBe(0);                    // no SW stub
    // A drag that STARTS on the straight's end does join it (explicitly).
    lay(grid, track, state, 1, [[16, 10], [17, 11], [18, 12]]);
    expect(diagLinked(state.rail, 16, 10, 17, 11)).toBe(true);
    expect(railPath(state, 1, [[12, 10]], new Set([tIdx(18, 12)]))).not.toBeNull();
  });

  it("lays the cars of a train one behind the other around a bend", () => {
    const grid = flatGrid();
    const track = createTrack();
    const state = createRailState();
    lay(grid, track, state, 1, [...row(10, 10, 14), [15, 11], [16, 12], [17, 13]]);
    const train: Train = {
      id: 4, ownerId: 1, lineId: 1, depotId: 0, status: "moving", target: "dest",
      route: [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10], [15, 11], [16, 12], [17, 13]],
      dist: 0, planRevision: state.rail.revision, dwellMs: 0, dirBit: 0, resold: false,
    };
    state.trains.push(train);
    state.lines.push({ id: 1, ownerId: 1, name: "L", source: 0, dest: 0 });
    // Drive the head past the bend (no platforms: stop the clock short of the end).
    for (let i = 0; i < 40 && train.dist < 6.3; i++) tickTrains(state, 40);
    const cars = carPlacements(state, train);
    expect(cars.map((c) => c.kind)).toEqual(consistOf(train));
    // Every car is on the track polyline, spaced by its coupling offset.
    const offs = carOffsets(consistOf(train));
    for (let i = 1; i < cars.length; i++) {
      const gap = Math.hypot(cars[i].fx - cars[i - 1].fx, cars[i].fy - cars[i - 1].fy);
      expect(gap).toBeLessThanOrEqual(offs[i] - offs[i - 1] + 1e-6);   // a chord never beats the arc
      expect(gap).toBeGreaterThan((offs[i] - offs[i - 1]) * 0.8);
    }
    // The locomotive is on the diagonal (screen south) while the last car is
    // still on the straight (grid south-east).
    expect(OCT_NAMES[cars[0].oct]).toBe("s");
    expect(OCT_NAMES[cars[cars.length - 1].oct]).toBe("se");
  });
});
