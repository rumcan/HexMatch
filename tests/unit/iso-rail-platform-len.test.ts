// ══════════════════════════════════════════════════════════════════════════
// Owner (2026-09-29): a platform is FOUR tiles long (it was three).
//
// A new platform is 1×4 / 4×1 and its lanes are four long. A station saved
// before the change keeps its three — its structure still says 1×3 / 3×1 —
// and every lane it grows is three long too, so an old save neither loses
// track nor grows a strip over ground it never claimed. The length rides the
// wire with each lane, and a lane record without one reads as its station's.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createRailState, placePlatform, stationLanes, laneSlabTiles, laneTrackTiles, laneStopTile,
  nextLaneAt, laneGhostItems, platformTrack, railToWire, applyRailWire, PLATFORM_FOOTPRINT,
  PLATFORM_LEN, type RailStructure,
} from "../../src/iso/rail";

describe("the four-long platform", () => {
  it("places a new platform four tiles long, one deep, on every heading", () => {
    expect(PLATFORM_LEN).toBe(4);
    expect(PLATFORM_FOOTPRINT).toEqual({ se: [1, 4], nw: [1, 4], sw: [4, 1], ne: [4, 1] });
    const state = createRailState();
    const s = placePlatform(state, "you", 1, 40, 20, "sw", null);
    expect([s.w, s.h]).toEqual([4, 1]);
    const [lane] = stationLanes(s);
    expect(lane.len).toBe(4);
    expect(laneSlabTiles(lane)).toEqual([[40, 20], [41, 20], [42, 20], [43, 20]]);
    // The stopping track runs the full length beside the strip, and is the
    // same row the platform lays at placement.
    expect(laneTrackTiles(lane)).toEqual([[40, 21], [41, 21], [42, 21], [43, 21]]);
    expect(laneTrackTiles(lane)).toEqual(platformTrack(s));
    expect(laneStopTile(lane)).toEqual([41, 21]);
  });

  it("grows a new station's lanes four long", () => {
    const state = createRailState();
    const s = placePlatform(state, "you", 1, 40, 20, "se", null);
    const next = nextLaneAt(s, 1);
    expect(next).toEqual({ view: "se", tx: 42, ty: 20, len: 4 });
    expect(laneSlabTiles(next)).toHaveLength(4);
    // The ghost ends in the cap on the lane's fourth tile.
    const ghost = laneGhostItems(next.tx, next.ty, next.view, next.len);
    expect(ghost[ghost.length - 1]).toMatchObject({ tx: 42, ty: 23 });
  });
});

describe("a station saved before the four-long platform", () => {
  /** A 3-long platform as an old save carries it: 3×1, and no lane length. */
  function oldSave(lanes?: { id: number; view: string; tx: number; ty: number; lineId: null }[]) {
    const state = createRailState();
    applyRailWire(state, {
      revision: 1, seq: 9,
      structures: [{
        id: 5, kind: "platform", ownerId: 1, owner: "you",
        tx: 40, ty: 20, w: 3, h: 1, view: "sw", anchor: null,
        ...(lanes ? { lanes } : {}),
      }],
      lines: [], trains: [],
    });
    return { state, s: state.structures[0] as RailStructure };
  }

  it("keeps its three tiles when it has no lanes array (pre-RAIL-6)", () => {
    const { s } = oldSave();
    const [lane] = stationLanes(s);
    expect(lane.len).toBe(3);
    expect(laneSlabTiles(lane)).toEqual([[40, 20], [41, 20], [42, 20]]);
    expect(laneTrackTiles(lane)).toEqual(platformTrack(s));
    expect(laneStopTile(lane)).toEqual([41, 21]);
  });

  it("keeps three tiles on every saved lane, and grows new lanes three long", () => {
    const { s } = oldSave([
      { id: 5, view: "sw", tx: 40, ty: 20, lineId: null },
      { id: 6, view: "sw", tx: 40, ty: 22, lineId: null },
    ]);
    expect(stationLanes(s).map((l) => l.len)).toEqual([3, 3]);
    expect(laneTrackTiles(stationLanes(s)[1])).toEqual([[40, 23], [41, 23], [42, 23]]);
    const next = nextLaneAt(s, 1);
    expect(next).toEqual({ view: "sw", tx: 40, ty: 24, len: 3 });
    expect(laneSlabTiles(next)).toHaveLength(3);
  });

  it("carries each lane's length through the wire, so a guest draws the same station", () => {
    const { state } = oldSave();
    const fresh = placePlatform(state, "you", 1, 60, 20, "se", null);
    stationLanes(fresh);
    const wire = railToWire(state)!;
    expect(wire.structures.map((w) => w.lanes?.map((l) => l.len))).toEqual([[3], [4]]);
    const guest = createRailState();
    applyRailWire(guest, wire);
    expect(guest.structures.map((g) => stationLanes(g).map((l) => laneSlabTiles(l).length)))
      .toEqual([[3], [4]]);
  });
});
