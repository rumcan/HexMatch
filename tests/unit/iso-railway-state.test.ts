// ══════════════════════════════════════════════════════════════════════════
// RAIL-02 (#176) — the state layer and the geometry it stands on.
//
// The ticket's first requirement is that the railway gets its OWN bytes:
// "Create separate owner-scoped rail connectivity and occupancy layers; never
// repurpose road/dirt/upgraded bytes." So the tests here pin three things:
//
//   1. the rail layer is a THIRD surface — laying rail leaves every road byte
//      (including VP-01's pave provenance) exactly as it was;
//   2. ownership is strict and total: one owner per tile, no public rail, and
//      an opponent's rail is never joined to yours even where they touch;
//   3. occupancy is what makes structures non-overlapping, and ids are stable
//      (allocated once, never reused) so a scoreboard ledger keyed by id can
//      never be confused by a demolition and a rebuild.
//
// The geometry half is the other side of the same coin: a rotated platform is
// a 3-wide block, its lane is the row the ports sit on, and every rotation of
// every asset lands inside the bounding box `tx,ty` names. Those are the
// assertions the placement rules, the overlay and the renderer all lean on.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  ROTATIONS, createRailway, allocRailId, layRail, liftRail, railPresent, railBitsAt,
  railOwnedBy, railOwnerAt, occAt, reserveTiles, releaseTiles, cloneRailway,
  restoreRailway, trainTiles, trainTilesOf, OCC_FREE, OCC_RAIL, OCC_PLATFORM, OCC_DEPOT,
  type RailTrain, type Rotation,
} from "../../src/iso/railway/state";
import {
  rotateDir, rotateOffset, rotateTiles, platformTiles, platformLaneTiles,
  platformStripTiles, platformPorts, platformPortNeighbours, depotTiles, depotPortDir,
  depotPortTiles, depotPortNeighbours, minManhattan, manhattan, platformAnchorCandidates,
  anchorLabel, DEPOT_FOOTPRINT, PLATFORM_FOOTPRINT, PLATFORM_ANCHOR_RANGE,
} from "../../src/iso/railway/geometry";
import { buildRailComponents, railNetworkTiles, railConnected, componentTrains } from "../../src/iso/railway/connectivity";
import { NE, SE, SW, NW, PRESENT, tIdx, buildTile, hasTrack, isUpgradedRoad } from "../../src/iso/track";
import { BUILD_COSTS, VICTORY } from "../../src/iso/config";
import { railWorld, industry, YOU, RIVAL } from "./helpers/rail-world";

const key = (t: readonly [number, number]) => `${t[0]},${t[1]}`;
const sorted = (tiles: readonly (readonly [number, number])[]) =>
  tiles.map(key).sort();

describe("RAIL-02 the rail layer is its own surface", () => {
  it("lays, autotiles and lifts without touching a single road byte", () => {
    const w = railWorld({ roads: [{ tiles: [[4, 4], [5, 4], [6, 4]] }] });
    buildTile(w.track, "dirt", 9, 9, YOU);
    buildTile(w.track, "road", 9, 9, YOU);              // a scored pave
    const roadBefore = w.track.road.slice();
    const dirtBefore = w.track.dirt.slice();
    const ownerBefore = w.track.owner.slice();
    const upgradedBefore = w.track.upgraded.slice();

    for (const [x, y] of [[10, 10], [10, 9], [10, 8]] as [number, number][]) layRail(w.rw, YOU, x, y);

    expect(w.track.road).toEqual(roadBefore);
    expect(w.track.dirt).toEqual(dirtBefore);
    expect(w.track.owner).toEqual(ownerBefore);
    expect(w.track.upgraded).toEqual(upgradedBefore);
    // …and the road's own provenance is still readable where it was
    expect(isUpgradedRoad(w.track, 9, 9)).toBe(true);

    // The rail masks are mutual: the middle tile faces both neighbours.
    expect(railBitsAt(w.rw, 10, 9)).toBe(NE | SW);
    expect(railBitsAt(w.rw, 10, 10)).toBe(NE);
    expect(railBitsAt(w.rw, 10, 8)).toBe(SW);

    liftRail(w.rw, 10, 9);
    expect(railPresent(w.rw, 10, 9)).toBe(false);
    expect(railBitsAt(w.rw, 10, 10)).toBe(0);            // the stub healed
    expect(w.track.road).toEqual(roadBefore);
  });

  it("keeps the rail owner byte honest and never joins two owners' rails", () => {
    const w = railWorld();
    layRail(w.rw, YOU, 20, 20);
    layRail(w.rw, YOU, 21, 20);
    layRail(w.rw, RIVAL, 22, 20);                        // the rival's line, touching
    expect(railOwnerAt(w.rw, 21, 20)).toBe(YOU);
    expect(railOwnerAt(w.rw, 22, 20)).toBe(RIVAL);
    // The seam: two surfaces side by side, each facing its own network only.
    // The player's tile points west at its own trunk…
    expect(railBitsAt(w.rw, 21, 20)).toBe(NW);
    // …and the rival's tile points NOWHERE: its only neighbour in that
    // direction is somebody else's rail, which its own mask refuses to reach.
    // A bit here would draw a junction no train of either seat could use.
    expect(railBitsAt(w.rw, 22, 20)).toBe(0);
    expect(railConnected(w.rw, YOU, [20, 20], [21, 20])).toBe(true);
    expect(railConnected(w.rw, YOU, [20, 20], [22, 20])).toBe(false);
    expect(railConnected(w.rw, RIVAL, [22, 20], [21, 20])).toBe(false);

    const comps = buildRailComponents(w.rw, YOU);
    expect(comps.count).toBe(1);
    expect(comps.size[0]).toBe(2);
    expect(buildRailComponents(w.rw, RIVAL).size[0]).toBe(1);
  });

  it("never reuses an id, so a ledger keyed by id cannot confuse a rebuild", () => {
    const rw = createRailway();
    const a = allocRailId(rw), b = allocRailId(rw);
    expect(b).toBeGreaterThan(a);
    // a demolition does not rewind the allocator (no `free id` bookkeeping)
    expect(allocRailId(rw)).toBeGreaterThan(b);
  });

  it("reserves and releases occupancy all-or-nothing, per owner", () => {
    const rw = createRailway();
    expect(reserveTiles(rw, [[5, 5], [6, 5]], OCC_PLATFORM, YOU)).toBe(true);
    expect(occAt(rw, 5, 5)).toBe(OCC_PLATFORM);
    // A second structure may not take even one of those tiles…
    expect(reserveTiles(rw, [[6, 5], [7, 5]], OCC_DEPOT, RIVAL)).toBe(false);
    expect(occAt(rw, 7, 5)).toBe(OCC_FREE);              // …and touches nothing
    // …and a release is owner-guarded.
    releaseTiles(rw, [[5, 5]], OCC_PLATFORM, RIVAL);
    expect(occAt(rw, 5, 5)).toBe(OCC_PLATFORM);
    releaseTiles(rw, [[5, 5], [6, 5]], OCC_PLATFORM, YOU);
    expect(occAt(rw, 5, 5)).toBe(OCC_FREE);
  });

  it("clone/restore puts the world back in place, bytes and records alike", () => {
    const rw = createRailway();
    layRail(rw, YOU, 3, 3);
    const snap = cloneRailway(rw);
    layRail(rw, YOU, 4, 3);
    rw.platforms.push({ id: 9, owner: "you", ownerId: YOU, tx: 3, ty: 3, rot: 0, anchor: { kind: "industry", id: 0 } });
    rw.nextId = 40;
    restoreRailway(rw, snap);
    expect(railPresent(rw, 4, 3)).toBe(false);
    expect(railPresent(rw, 3, 3)).toBe(true);
    expect(rw.platforms).toHaveLength(0);
    expect(rw.nextId).toBe(snap.nextId);
  });

  it("counts train tiles for the edit guard, scoped or global", () => {
    const rw = createRailway();
    const train: RailTrain = {
      id: 1, owner: "you", ownerId: YOU, depotId: 1, lineId: null,
      state: "moving", tiles: [tIdx(8, 8), tIdx(8, 9)],
    };
    rw.trains.push(train, { ...train, id: 2, owner: "ai", ownerId: RIVAL, tiles: [tIdx(9, 9)] });
    expect(trainTiles(rw).size).toBe(3);
    expect([...trainTilesOf(rw, YOU)]).toEqual([tIdx(8, 8), tIdx(8, 9)]);
  });
});

describe("RAIL-02 geometry: quarter turns, lanes and ports", () => {
  it("rotates a 2×3 block into a 3×2 block, always six tiles inside the box", () => {
    for (const rot of ROTATIONS) {
      const tiles = platformTiles(10, 10, rot);
      expect(tiles).toHaveLength(6);
      const xs = tiles.map(([x]) => x), ys = tiles.map(([, y]) => y);
      const w = Math.max(...xs) - Math.min(...xs) + 1;
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      // the record's origin is the block's north corner at EVERY rotation
      expect(Math.min(...xs)).toBe(10);
      expect(Math.min(...ys)).toBe(10);
      if (rot % 2 === 0) {
        expect([w, h]).toEqual([...PLATFORM_FOOTPRINT]);
      } else {
        expect([w, h]).toEqual([PLATFORM_FOOTPRINT[1], PLATFORM_FOOTPRINT[0]]);
      }
      // lane + strip partition the block, three tiles each
      expect(sorted(platformLaneTiles(10, 10, rot))).toHaveLength(3);
      expect(sorted(platformStripTiles(10, 10, rot))).toHaveLength(3);
      expect(new Set([...sorted(platformLaneTiles(10, 10, rot)), ...sorted(platformStripTiles(10, 10, rot))]).size).toBe(6);
    }
  });

  it("rotates the lane round the block: W column → N row → E column → S row", () => {
    expect(sorted(platformLaneTiles(0, 0, 0))).toEqual(["0,0", "0,1", "0,2"]);
    expect(sorted(platformLaneTiles(0, 0, 1))).toEqual(["0,0", "1,0", "2,0"]);
    expect(sorted(platformLaneTiles(0, 0, 2))).toEqual(["1,0", "1,1", "1,2"]);
    expect(sorted(platformLaneTiles(0, 0, 3))).toEqual(["0,1", "1,1", "2,1"]);
  });

  it("keeps both ports on the lane's ENDS at every rotation, pointing outward", () => {
    for (const rot of ROTATIONS) {
      const ports = platformPorts(8, 12, rot);
      expect(ports).toHaveLength(2);
      const lane = sorted(platformLaneTiles(8, 12, rot));
      const block = new Set(sorted(platformTiles(8, 12, rot)));
      for (const { tile, dir } of ports) {
        // a port is a lane tile…
        expect(lane).toContain(key(tile));
        // …whose outward neighbour is OUTSIDE the block (the track must be
        // able to leave; this is the assertion that catches a rotation that
        // puts the port on the wrong side and seals the platform in)
        const [dx, dy] = { [NE]: [0, -1], [SE]: [1, 0], [SW]: [0, 1], [NW]: [-1, 0] }[dir]!;
        expect(block.has(`${tile[0] + dx},${tile[1] + dy}`)).toBe(false);
      }
      // the two ports face opposite ways
      expect(ports[0].dir).not.toBe(ports[1].dir);
      expect(ports[0].dir + ports[1].dir === NE + SW || ports[0].dir + ports[1].dir === SE + NW).toBe(true);
      // and each has a neighbour tile the track can actually reach
      expect(platformPortNeighbours(8, 12, rot)).toHaveLength(2);
    }
  });

  it("turns the depot's declared exit with the block, and keeps it on the edge", () => {
    for (const rot of ROTATIONS) {
      const tiles = depotTiles(20, 20, rot);
      expect(tiles).toHaveLength(DEPOT_FOOTPRINT[0] * DEPOT_FOOTPRINT[1]);
      const dir = depotPortDir(rot);
      const inside = new Set(sorted(tiles));
      const stubs = depotPortTiles(20, 20, rot);
      expect(stubs).toHaveLength(2);                    // one edge of a 2×2
      for (const [x, y] of stubs) {
        expect(inside.has(key([x, y]))).toBe(true);
        const [dx, dy] = { [NE]: [0, -1], [SE]: [1, 0], [SW]: [0, 1], [NW]: [-1, 0] }[dir]!;
        // the OUTSIDE neighbour leaves the block: that is where track joins
        expect(inside.has(`${x + dx},${y + dy}`)).toBe(false);
        expect(inside.has(key(depotPortNeighbours(20, 20, rot)[0]))).toBe(false);
      }
      // A quarter turn is a rotation, and four of them are the identity.
      expect(rotateTiles([[0, 0], [1, 0]], 4 as unknown as Rotation)).toEqual([[0, 0], [1, 0]]);
    }
  });

  it("rotates directions and offsets as ONE rotation (no 90° drift)", () => {
    expect(rotateDir(NE, 1)).toBe(SE);
    expect(rotateDir(NE, 2)).toBe(SW);
    expect(rotateDir(NE, 3)).toBe(NW);
    expect(rotateDir(NE, 0)).toBe(NE);
    // the offset rotation and the direction rotation agree: rotating the NE
    // step and rotating NE give the same vector
    for (const rot of ROTATIONS) {
      const [dx, dy] = rotateOffset(0, -1, rot);
      const dirVec = { [NE]: [0, -1], [SE]: [1, 0], [SW]: [0, 1], [NW]: [-1, 0] }[rotateDir(NE, rot)]!;
      expect([dx, dy]).toEqual(dirVec);
    }
  });
});

describe("RAIL-02 anchors: within 3 tiles, one per owner per anchor", () => {
  it("measures footprint-to-footprint Manhattan distance, not origin to origin", () => {
    expect(manhattan([0, 0], [2, 3])).toBe(5);
    expect(minManhattan([[0, 0], [1, 0]], [[1, 3]])).toBe(3);
    expect(PLATFORM_ANCHOR_RANGE).toBe(3);
  });

  it("lists industries first, then the owner's own plants, and nobody else's", () => {
    const w = railWorld({ industries: [industry(10, 10), industry(20, 20)] });
    const factories = [
      { owner: "you", ownerId: YOU, tx: 14, ty: 12, id: 0 },
      { owner: "ai", ownerId: RIVAL, tx: 12, ty: 12, id: 1 },
    ];
    const tiles = platformTiles(12, 10, 0);
    const anchors = platformAnchorCandidates(w.grid, factories, YOU, tiles);
    // the far industry is out of range; the rival's plant is not an anchor
    expect(anchors).toEqual([{ kind: "industry", id: 0 }, { kind: "plant", id: 0 }]);
    expect(anchorLabel({ kind: "plant", id: 0 })).toBe("your Factory");
    expect(platformAnchorCandidates(w.grid, factories, RIVAL, tiles))
      .toEqual([{ kind: "industry", id: 0 }, { kind: "plant", id: 1 }]);
    // nothing in range at all
    expect(platformAnchorCandidates(w.grid, factories, YOU, platformTiles(60, 60, 0))).toEqual([]);
  });
});

describe("RAIL-02 the cost table is the epic's, and nothing scores but a platform", () => {
  it("prices rail, platform, depot and train exactly as the spec proposes", () => {
    expect(BUILD_COSTS.rail).toEqual({ stone: 1 });
    expect(BUILD_COSTS.platform).toEqual({ wood: 4, stone: 4, ore: 12, oil: 2 });
    expect(BUILD_COSTS.railDepot).toEqual({ wood: 3, stone: 3, ore: 4, oil: 2 });
    expect(BUILD_COSTS.train).toEqual({ ore: 4, oil: 2 });
    expect(VICTORY.platform).toBe(1);
  });

  it("keeps the rail layer out of the road tier's numbering", () => {
    // A rail tile is NOT a road tile: the two live in different arrays and
    // nothing about one is derivable from the other.
    const w = railWorld();
    layRail(w.rw, YOU, 30, 30);
    expect(railPresent(w.rw, 30, 30)).toBe(true);
    expect(hasTrack(w.track, "road", 30, 30)).toBe(false);
    expect(hasTrack(w.track, "dirt", 30, 30)).toBe(false);
    expect(railNetworkTiles(w.rw, YOU).size).toBe(1);
    expect(railNetworkTiles(w.rw, RIVAL).size).toBe(0);
    expect(occAt(w.rw, 30, 30)).toBe(OCC_RAIL);
  });

  it("counts the trains per component — the one-active-train rule's input", () => {
    const w = railWorld();
    for (const [x, y] of [[40, 40], [41, 40], [42, 40]] as [number, number][]) layRail(w.rw, YOU, x, y);
    for (const [x, y] of [[50, 50], [51, 50]] as [number, number][]) layRail(w.rw, YOU, x, y);
    layRail(w.rw, RIVAL, 41, 41);
    w.rw.trains.push(
      { id: 1, owner: "you", ownerId: YOU, depotId: 0, lineId: null, state: "stored", tiles: [tIdx(41, 40)] },
      { id: 2, owner: "you", ownerId: YOU, depotId: 0, lineId: null, state: "moving", tiles: [tIdx(50, 50)] },
      { id: 3, owner: "ai", ownerId: RIVAL, depotId: 0, lineId: null, state: "moving", tiles: [tIdx(41, 41)] },
    );
    const byComp = componentTrains(w.rw, YOU);
    expect([...byComp.values()].map((t) => t.map((x) => x.id))).toEqual([[1], [2]]);
    expect(byComp.size).toBe(2);
    // the rival's train never appears in the player's bookkeeping
    expect([...componentTrains(w.rw, RIVAL).values()].flat().map((t) => t.id)).toEqual([3]);
  });

  it("allocates one component per disconnected stretch, in index order", () => {
    const w = railWorld();
    for (const [x, y] of [[60, 60], [61, 60]] as [number, number][]) layRail(w.rw, YOU, x, y);
    for (const [x, y] of [[10, 10]] as [number, number][]) layRail(w.rw, YOU, x, y);
    const comps = buildRailComponents(w.rw, YOU);
    expect(comps.count).toBe(2);
    expect(comps.comp[tIdx(10, 10)]).toBe(0);            // lower index = lower id
    expect(comps.comp[tIdx(60, 60)]).toBe(1);
    expect(comps.comp[tIdx(60, 60)]).toBe(comps.comp[tIdx(61, 60)]);
  });

  it("mirrors what a raise does to the layers (PRESENT flag is not a direction)", () => {
    const w = railWorld();
    layRail(w.rw, YOU, 70, 70);
    expect(w.rw.rail[tIdx(70, 70)]).toBe(PRESENT);       // a lone stub: no bits
    expect(railOwnerAt(w.rw, 70, 70)).toBe(YOU);
    expect(railOwnedBy(w.rw, YOU, 70, 70)).toBe(true);
    expect(railOwnedBy(w.rw, RIVAL, 70, 70)).toBe(false);
  });

  it("does not let a structure's occupancy be confused with rail", () => {
    const rw = createRailway();
    reserveTiles(rw, [[1, 1], [2, 1]], OCC_DEPOT, YOU);
    expect(occAt(rw, 1, 1)).toBe(OCC_DEPOT);
    expect(railPresent(rw, 1, 1)).toBe(false);
    expect(railOwnedBy(rw, YOU, 1, 1)).toBe(false);
  });
});
