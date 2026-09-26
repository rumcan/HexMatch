// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, WATER, TOWN_OCC, type Grid } from "../../src/iso/grid";
import {
  buildTile, createTrack, demolishTile, buildRoadDiagonal, roadDiagLinked, roadDiagNeighbours,
  roadDiagonalRefusal, canBuildOn, buildRefusal, connectedTiles, mergedConnectedTiles,
  playerNetwork, setRoadTier, tierTileCost, tileCost, trackOpenTo, dirtyTiles, tIdx,
  ROAD_DE, ROAD_DS, ROAD_DIAG, ROAD_TIER, OVERPASS_X, OVERPASS_Y, PUBLIC_OWNER,
  PRESENT, DIR, DIRS, OPPOSITE, resolveDiagonalRoads, previewDrag, commitDrag,
  type Track, type RoadTier,
} from "../../src/iso/track";
import { ROAD_DIRS, PORT_OFFSET } from "../../src/iso/road-geometry";
import { CHUNK, chunksX } from "../../src/iso/renderer";
import { buildComponents, depotPathLength, type EconomyState } from "../../src/iso/economy";
import { roadPath } from "../../src/iso/road-routing";
import { routeDistance, routeTileLength } from "../../src/iso/slopes";
import { distanceFactorForPath } from "../../src/iso/loop";
import { buildSnapshot, applySnapshot, SNAPSHOT_VERSION, bytesToBase64 } from "../../src/iso/snapshot";
import { readSave, trackRestored, trackSave, SAVE_KEY, SAVEGAME_VERSION } from "../../src/iso/savegame-runtime";
import { applyTrackDelta, readTiles } from "../../src/net/delta";

const flat = (): Grid => ({
  w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
  occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [], seed: 1,
});
const pair = (t: Track, b: [number, number] = [11, 11]) => {
  buildTile(t, "dirt", 10, 10, 1);
  buildTile(t, "dirt", ...b, 1);
};
const route = (t: Track, a: [number, number], b: [number, number], owner = 1) =>
  roadPath(t, owner, [a], new Set([tIdx(...b)]));
const snapshot = (track: Track) => buildSnapshot({
  seed: 1, track, harvesters: [], factories: [], players: [], setupPhase: false, won: false,
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); dirtyTiles.clear(); localStorage.clear(); });

describe("D1 explicit road diagonals", () => {
  it.each([[11, 9, ROAD_DE], [11, 11, ROAD_DS]])("stores the lower-x link once, readable from either end (%i,%i)", (x, y, bit) => {
    const t = createTrack(true), g = flat();
    pair(t, [x, y]);
    expect(roadDiagLinked(t, 10, 10, x, y)).toBe(false); // never auto-connect corners
    expect(buildRoadDiagonal(g, t, x, y, 10, 10, 1)).not.toBeNull();
    expect(t.dirt[tIdx(10, 10)]).toBe(PRESENT | bit);
    expect(t.dirt[tIdx(x, y)]).toBe(PRESENT);
    expect(roadDiagLinked(t, 10, 10, x, y)).toBe(true);
    expect(roadDiagLinked(t, x, y, 10, 10)).toBe(true);
    expect(roadDiagNeighbours(t, x, y)).toContainEqual([10, 10]);
    expect(buildRoadDiagonal(g, t, 10, 10, x, y, 1)).toBeNull(); // idempotent
    expect(t.dirt.BYTES_PER_ELEMENT).toBe(1);
  });

  it("shares the axis direction definitions with geometry, without an import cycle", () => {
    expect(ROAD_DIRS).toBe(DIRS);
    for (const d of DIRS) expect(PORT_OFFSET[d]).toEqual([0.5 + DIR[d][0] / 2, 0.5 + DIR[d][1] / 2]);
  });

  it("retains explicit links when autotiling and paving either end; single-tier floods stay pure", () => {
    const t = createTrack(true), g = flat();
    pair(t);
    buildRoadDiagonal(g, t, 10, 10, 11, 11, 1);
    buildTile(t, "dirt", 10, 9, 1);
    buildTile(t, "road", 10, 10, 1);
    expect(t.dirt[tIdx(10, 10)]).toBe(0);
    expect(t.road[tIdx(10, 10)] & ROAD_DS).toBe(ROAD_DS);
    expect(mergedConnectedTiles(t, 10, 10).has(tIdx(11, 11))).toBe(true);
    expect(connectedTiles(t, "road", 10, 10).has(tIdx(11, 11))).toBe(false);
    expect(roadPath(t, 1, [[10, 10]], new Set([tIdx(11, 11)]), "road")).toBeNull();
    buildTile(t, "road", 11, 11, 1);
    expect(connectedTiles(t, "road", 10, 10).has(tIdx(11, 11))).toBe(true);
  });

  it.each([true, false])("demolition clears incoming/outgoing links and journals remote storage (lower=%s)", (lower) => {
    const t = createTrack(true), g = flat();
    buildTile(t, "road", 7, 7, 1);
    buildTile(t, "dirt", 8, 8, 1);
    buildRoadDiagonal(g, t, 7, 7, 8, 8, 1);
    dirtyTiles.clear();
    const r = lower ? demolishTile(t, "road", 7, 7)! : demolishTile(t, "dirt", 8, 8)!;
    expect(t.road[tIdx(7, 7)] & ROAD_DIAG).toBe(0);
    expect(dirtyTiles.has(tIdx(7, 7))).toBe(true);
    expect(dirtyTiles.has(tIdx(8, 8))).toBe(true);
    expect(r.chunks).toContain(chunksX + 1);
    expect(r.chunks).toContain(Math.floor(7 / CHUNK) * chunksX + Math.floor(7 / CHUNK));
    buildTile(t, lower ? "road" : "dirt", lower ? 7 : 8, lower ? 7 : 8, 1);
    expect(roadDiagLinked(t, 7, 7, 8, 8)).toBe(false); // no ghost link on rebuild
  });

  it("journals both link endpoints across chunk seams", () => {
    const t = createTrack(true), g = flat();
    buildTile(t, "road", 7, 7, 1); buildTile(t, "road", 8, 8, 1);
    dirtyTiles.clear();
    const revision = t.revision;
    const r = buildRoadDiagonal(g, t, 7, 7, 8, 8, 1)!;
    expect(r.chunks).toEqual([0, chunksX + 1]);
    expect(dirtyTiles.drain()).toEqual([tIdx(7, 7), tIdx(8, 8)]);
    expect(t.revision).toBe(revision + 1);
  });

  it.each(["water", "industry", "town", "plant", "rail", "rail-x", "rail-y"])("refuses two blocked %s flanks, but permits a single blocked flank", (blocker) => {
    const g = flat(), t = createTrack(true);
    pair(t);
    const block = (x: number, y: number) => {
      if (blocker === "water") g.terrain[tIdx(x, y)] = WATER;
      else if (blocker === "industry") g.occupancy[tIdx(x, y)] = 0;
      else if (blocker === "town") g.occupancy[tIdx(x, y)] = TOWN_OCC;
    };
    let both = false;
    if (["plant", "rail", "rail-x", "rail-y"].includes(blocker)) {
      g.builtAt = (x, y) => ((x === 11 && y === 10) || (both && x === 10 && y === 11))
        ? blocker as "plant" | "rail" | "rail-x" | "rail-y" : null;
    }
    block(11, 10);
    expect(roadDiagonalRefusal(g, t, 10, 10, 11, 11)).toBeNull();
    both = true; block(10, 11);
    expect(roadDiagonalRefusal(g, t, 10, 10, 11, 11)).toBe("corner-cut");
    expect(canBuildOn(g, "dirt", 11, 11, undefined, undefined, t, [10, 10])).toBe(false);
    expect(buildRoadDiagonal(g, t, 10, 10, 11, 11, 1)).toBeNull();
  });

  it("refuses X crossings across layers and owners (both orientations)", () => {
    for (const reverse of [false, true]) {
      const g = flat(), t = createTrack(true);
      pair(t);
      buildTile(t, "road", 10, 11, 2); buildTile(t, "road", 11, 10, 2);
      const first = () => buildRoadDiagonal(g, t, 10, 10, 11, 11, 1);
      const second = () => buildRoadDiagonal(g, t, 11, 10, 10, 11, 2);
      expect((reverse ? second : first)()).not.toBeNull();
      expect((reverse ? first : second)()).toBeNull();
      expect(roadDiagonalRefusal(g, t, ...(reverse ? [10, 10, 11, 11] : [10, 11, 11, 10]) as [number, number, number, number])).toBe("diagonal-crossing");
    }
  });

  it("requires diagonal adjacency to the build network and obeys the same step refusal", () => {
    const g = flat(), t = createTrack(true), net = new Set([tIdx(10, 10)]);
    buildTile(t, "dirt", 10, 10, 1);
    expect(canBuildOn(g, "dirt", 11, 11, net, undefined, t, [10, 10])).toBe(true);
    expect(canBuildOn(g, "dirt", 12, 12, net, undefined, t)).toBe(false);
    g.terrain[tIdx(10, 11)] = WATER; g.terrain[tIdx(11, 10)] = WATER;
    expect(buildRefusal(g, "dirt", 11, 11, net, undefined, t, [10, 10])).toBe("corner-cut");
    expect(canBuildOn(g, "dirt", 11, 11, net, undefined, t)).toBe(false);
  });

  it("refuses links on water/bridges, off-map, non-diagonal steps and excessive slopes", () => {
    const g = flat(), t = createTrack(true); pair(t);
    expect(buildRoadDiagonal(g, t, -1, -1, 0, 0, 1)).toBeNull();
    expect(roadDiagonalRefusal(g, t, 10, 10, 10, 11)).toBe("not-diagonal");
    g.terrain[tIdx(11, 11)] = WATER;
    expect(buildRoadDiagonal(g, t, 10, 10, 11, 11, 1)).toBeNull();
    g.terrain[tIdx(11, 11)] = GRASS;
    g.height = new Uint8Array(MAP_W * MAP_H);
    g.height[tIdx(11, 11)] = 3;
    expect(roadDiagonalRefusal(g, t, 10, 10, 11, 11)).toBe("too-steep");
  });
});

describe("D1 graph and tiers", () => {
  it("floods/paths cross mixed-layer diagonals, but never the rival's track", () => {
    const g = flat(), t = createTrack(true); pair(t);
    buildTile(t, "road", 12, 12, PUBLIC_OWNER);
    buildRoadDiagonal(g, t, 10, 10, 11, 11, 1);
    buildRoadDiagonal(g, t, 11, 11, 12, 12, 1);
    const c = buildComponents(t, 1);
    expect(c.comp[tIdx(10, 10)]).toBe(c.comp[tIdx(12, 12)]);
    expect(c.roadComp[c.comp[tIdx(10, 10)]]).toBe(1);
    expect(route(t, [10, 10], [12, 12])).toEqual([[10, 10], [11, 11], [12, 12]]);
    const net = () => playerNetwork(t, 1, [{ ownerId: 1, tx: 9, ty: 10 }], [], [1, 1]);
    expect(net().has(tIdx(12, 12))).toBe(true);
    buildTile(t, "dirt", 11, 11, 2);
    expect(trackOpenTo(t, 1, 11, 11)).toBe(false);
    expect(route(t, [10, 10], [12, 12])).toBeNull();
    expect(route(t, [11, 11], [11, 11])).toBeNull(); // even the source must be usable
    expect(net().has(tIdx(12, 12))).toBe(false);
    expect(buildComponents(t, 1).comp[tIdx(11, 11)]).toBe(-1);
    expect(buildRoadDiagonal(g, t, 10, 10, 11, 11, 1)).toBeNull();
  });

  it.each([0, 1, 2, 3, 4, 5] as RoadTier[])("applies highway access diagonally to tier %i; overpasses stay axis-only", (tier) => {
    const g = flat(), t = createTrack(true);
    buildTile(t, "road", 10, 10, 1); buildTile(t, "road", 11, 11, 1);
    setRoadTier(t, 10, 10, ROAD_TIER.highway); setRoadTier(t, 11, 11, tier);
    const allowed = tier === ROAD_TIER.highway || tier === ROAD_TIER.ramp;
    expect(buildRoadDiagonal(g, t, 10, 10, 11, 11, 1) !== null).toBe(allowed);
    expect(route(t, [11, 11], [10, 10]) !== null).toBe(allowed);
  });

  it("rechecks standing diagonal tiers on every graph read after an upgrade", () => {
    const g = flat(), t = createTrack(true);
    pair(t); buildRoadDiagonal(g, t, 10, 10, 11, 11, 1);
    buildTile(t, "road", 11, 11, 1); setRoadTier(t, 11, 11, ROAD_TIER.highway);
    expect(route(t, [10, 10], [11, 11])).toBeNull();
    expect(buildComponents(t, 1).comp[tIdx(10, 10)]).not.toBe(buildComponents(t, 1).comp[tIdx(11, 11)]);
    buildTile(t, "road", 10, 10, 1); setRoadTier(t, 10, 10, ROAD_TIER.ramp);
    expect(route(t, [10, 10], [11, 11])).not.toBeNull();
    for (const tier of [OVERPASS_X, OVERPASS_Y] as const) {
      setRoadTier(t, 11, 11, tier);
      expect(roadDiagLinked(t, 10, 10, 11, 11)).toBe(false);
    }
  });

  it("keeps overpass jumps straight and separate from the highway with diagonals ON", () => {
    const g = flat(), t = createTrack(true);
    for (let x = 10; x <= 20; x++) {
      buildTile(t, "road", x, 20, 1); setRoadTier(t, x, 20, ROAD_TIER.highway);
    }
    for (const y of [18, 19, 21, 22]) buildTile(t, "road", 15, y, 1);
    setRoadTier(t, 15, 20, OVERPASS_X);
    expect(route(t, [15, 18], [15, 22])).toEqual([[15, 18], [15, 19], [15, 21], [15, 22]]);
    expect(routeTileLength(route(t, [15, 18], [15, 22])!, true)).toBe(5);
    expect(route(t, [15, 18], [14, 20])).toBeNull();
    const c = buildComponents(t, 1);
    expect(c.comp[tIdx(15, 18)]).toBe(c.comp[tIdx(15, 22)]);
    expect(c.comp[tIdx(15, 18)]).not.toBe(c.comp[tIdx(14, 20)]);
    const net = playerNetwork(t, 1, [{ ownerId: 1, tx: 15, ty: 17 }], [], [1, 1]);
    expect(net.has(tIdx(15, 22))).toBe(true);
    expect(net.has(tIdx(14, 20))).toBe(false);
    buildTile(t, "road", 14, 19, 1); setRoadTier(t, 14, 19, ROAD_TIER.ramp);
    expect(buildRoadDiagonal(g, t, 14, 19, 15, 20, 1)).toBeNull();
  });

  it("keeps highways flat on diagonal steps too", () => {
    const g = flat(), t = createTrack(true);
    for (const [x, y] of [[10, 10], [11, 11]]) {
      buildTile(t, "road", x, y, 1); setRoadTier(t, x, y, ROAD_TIER.highway);
    }
    g.height = new Uint8Array(MAP_W * MAP_H);
    g.height[tIdx(11, 11)] = 1;
    expect(roadDiagonalRefusal(g, t, 10, 10, 11, 11)).toBe("too-steep");
    expect(buildRoadDiagonal(g, t, 10, 10, 11, 11, 1)).toBeNull();
  });

  it.each(["road", "street", "highway", "ramp"] as const)("prices a diagonal tile exactly like an axis tile for %s", (tier) => {
    const t = createTrack(true);
    expect(tierTileCost(t, tier, 11, 11)).toEqual(tierTileCost(t, tier, 11, 10));
    buildTile(t, "dirt", 11, 11, 1); buildTile(t, "dirt", 11, 10, 1);
    expect(tierTileCost(t, tier, 11, 11)).toEqual(tierTileCost(t, tier, 11, 10));
    expect(tileCost(t, "dirt", 12, 12, true)).toEqual(tileCost(t, "dirt", 12, 10, true));
  });

  it("uses sqrt(2) for shortest paths, not the fewest hops", () => {
    const t = createTrack(true), g = flat();
    const diagonal: [number, number][] = [[20, 20], [21, 19], [22, 18], [23, 19], [24, 20], [23, 21]];
    const axis: [number, number][] = [[20, 20], [20, 21], [20, 22], [21, 22], [22, 22], [23, 22], [23, 21]];
    for (const [x, y] of [...diagonal, ...axis]) buildTile(t, "road", x, y, 1);
    // Explicit graph fixture: retain only the two candidate paths, avoiding
    // incidental autotile shortcuts between their physically adjacent tiles.
    for (const [x, y] of [...diagonal, ...axis]) t.road[tIdx(x, y)] = PRESENT;
    for (let i = 1; i < diagonal.length; i++) expect(buildRoadDiagonal(g, t, ...diagonal[i - 1], ...diagonal[i], 1)).not.toBeNull();
    for (let i = 1; i < axis.length; i++) {
      const a = axis[i - 1], b = axis[i];
      const d = DIRS.find((d) => DIR[d][0] === b[0] - a[0] && DIR[d][1] === b[1] - a[1])!;
      t.road[tIdx(...a)] |= d; t.road[tIdx(...b)] |= OPPOSITE[d];
    }
    expect(route(t, axis[0], axis.at(-1)!)).toEqual(axis); // 6 < 5*sqrt(2)
    expect(route(t, axis.at(-1)!, axis[0])).toEqual([...axis].reverse());
    expect(routeTileLength(diagonal, true)).toBeCloseTo(1 + 5 * Math.SQRT2);
  });

  it("L3 distances and bands include diagonal length, retaining the origin tile allowance", () => {
    const g = flat(), t = createTrack(true);
    for (let n = 0; n <= 6; n++) {
      buildTile(t, "dirt", 10 + n, 10 + n, 1);
      if (n) buildRoadDiagonal(g, t, 9 + n, 9 + n, 10 + n, 10 + n, 1);
    }
    const h = { id: 1, owner: "you", ownerId: 1, tx: 10, ty: 8, facing: "sw" as const };
    const state = { grid: g, track: t, harvesters: [h], factories: [
      { id: 0, owner: "you", ownerId: 1, tx: 16, ty: 17, townId: null },
    ] } as EconomyState;
    const length = depotPathLength(state, h);
    expect(length).toBeCloseTo(1 + 6 * Math.SQRT2);
    expect(distanceFactorForPath(length)).toBe(0.7); // 7 hops alone would be near
    expect(routeDistance(g, [[10, 10], [11, 11]], true)).toBeCloseTo(1 + Math.SQRT2);
    expect(routeDistance(g, [[10, 10], [11, 11]])).toBe(2); // unchanged rail/default
  });
});

describe("D1 flags and persistence", () => {
  it("#440: ON by default, ?diag=0 off, axis-only under the unit-test runner", () => {
    // the reader's two arguments are the query and "is this the test runner"
    expect(resolveDiagonalRoads("", false)).toBe(true);            // a new game
    expect(resolveDiagonalRoads("?diag=1", false)).toBe(true);
    expect(resolveDiagonalRoads("?diag=0", false)).toBe(false);    // the off switch
    expect(resolveDiagonalRoads("?diag=true", false)).toBe(true);  // only 0/1 are read
    expect(resolveDiagonalRoads("", true)).toBe(false);            // vitest stays axis-only
    expect(resolveDiagonalRoads("?diag=1", true)).toBe(true);      // explicit still wins
    vi.stubGlobal("location", { search: "" });
    vi.stubEnv("MODE", "production");
    expect(createTrack().diagonalRoads).toBe(true);                // production is not DEV-gated
    vi.stubGlobal("location", { search: "?diag=0" });
    expect(createTrack().diagonalRoads).toBe(false);
    vi.unstubAllEnvs();
    expect(createTrack().diagonalRoads).toBe(false);               // …and the runner stays off
    expect(createTrack(true).diagonalRoads).toBe(true);            // a game's resolved flag
    expect(createTrack(false).diagonalRoads).toBe(false);
  });

  it("flag OFF preserves legacy bytes, preview, route and costs", () => {
    const t = createTrack(false), g = flat();
    const pv = previewDrag(g, t, "dirt", {}, 10, 10, 12, 12, true, undefined, 0, undefined, true);
    expect(pv.tiles).toEqual([[10, 10], [11, 10], [12, 10], [12, 11], [12, 12]]);
    expect(pv.cost).toEqual({}); commitDrag(t, "dirt", pv, 1);
    const before = snapshot(t);
    expect(buildRoadDiagonal(g, t, 11, 10, 12, 11, 1)).toBeNull();
    expect(snapshot(t)).toEqual(before);
    const expected = new Uint8Array(MAP_W * MAP_H);
    for (const [x, y, bits] of [[10, 10, 2], [11, 10, 10], [12, 10, 12], [12, 11, 5], [12, 12, 1]]) expected[tIdx(x, y)] = PRESENT | bits;
    expect(t.dirt).toEqual(expected);
    expect(route(t, [10, 10], [12, 12])).toEqual(pv.tiles);
    expect(t.road.every((b) => b === 0)).toBe(true);
  });

  it("loads a pre-D1 4-axis save and snapshot without migration or a version bump", () => {
    const dirt = new Uint8Array(MAP_W * MAP_H), owner = new Uint8Array(dirt.length), zero = bytesToBase64(new Uint8Array(dirt.length));
    dirt[tIdx(5, 5)] = 18; dirt[tIdx(6, 5)] = 24; owner[tIdx(5, 5)] = owner[tIdx(6, 5)] = 1;
    const oldTrack = { dirt: bytesToBase64(dirt), road: zero, owner: bytesToBase64(owner), upgraded: zero };
    localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 3, snapV: 17, seed: 1, track: oldTrack }));
    const saved = readSave()!;
    expect(saved).not.toBeNull();
    const t = createTrack(true); trackRestored(t, saved.track);
    expect(t.dirt).toEqual(dirt); expect(t.owner).toEqual(owner);
    expect(t.tier!.every((b) => b === 0)).toBe(true);
    expect(route(t, [5, 5], [6, 5])).toEqual([[5, 5], [6, 5]]);
    const oldSnapshot = { ...snapshot(createTrack(false)), version: 17, ...oldTrack };
    delete oldSnapshot.tier;
    const restored = applySnapshot(oldSnapshot).track;
    expect(restored.dirt).toEqual(dirt);
    expect(route(restored, [5, 5], [6, 5])).toEqual([[5, 5], [6, 5]]);
  });

  it("round-trips diagonal bits through existing saves, snapshots and dirty deltas", () => {
    const g = flat(), t = createTrack(true); pair(t);
    buildRoadDiagonal(g, t, 10, 10, 11, 11, 1);
    const saved = createTrack(true); trackRestored(saved, trackSave(t));
    vi.stubGlobal("location", { search: "?diag=1" });
    const snap = snapshot(t), restored = applySnapshot(snap).track;
    const guest = createTrack(true); applyTrackDelta(guest, readTiles(t, dirtyTiles.drain()));
    for (const copy of [saved, restored, guest]) {
      expect(copy.dirt).toEqual(t.dirt);
      expect(roadDiagLinked(copy, 10, 10, 11, 11)).toBe(true);
    }
    expect(SAVEGAME_VERSION).toBe(3);
    expect(SNAPSHOT_VERSION).toBe(17);
    expect(snap.version).toBe(SNAPSHOT_VERSION);
    expect(snap.dirt.length).toBe(snapshot(createTrack(false)).dirt.length);
    expect(snap).not.toHaveProperty("diagonalRoads");
    restored.diagonalRoads = false;
    expect(route(restored, [10, 10], [11, 11])).toBeNull();
    expect(restored.dirt).toEqual(t.dirt); // OFF ignores, not a destructive migration
  });
});
