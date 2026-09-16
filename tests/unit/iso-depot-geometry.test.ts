import { describe, expect, it } from "vitest";
import {
  DEPOT_FACINGS, DEPOT_SIZE, DEPOT_SPRITES, OPPOSITE_SIDE,
  depotContains, depotEdgeTiles, depotEntranceTiles, depotFacingAt, depotFacingFor,
  depotFacingOf, depotFacings, depotTiles, industriesTouchingDepot, rotateFacing,
} from "../../src/iso/depot";
import type { Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

// The 2×2 truck depot: it sits directly beside a resource and opens away from
// it, in one of FOUR quarter-turn rotations — the facing IS the edge its
// entrance opens onto. Grid directions as track.ts: NW −x, NE −y, SE +x, SW +y.

const ind = (id: number, tx: number, ty: number, w = 3, h = 3): Industry =>
  ({ id, type: "quarry", tx, ty, w, h, output: 1, banditUntil: 0 });
const gridWith = (...industries: Industry[]) => ({ industries });

describe("truck depot geometry", () => {
  it("is a 2×2 lot, origin at its top corner", () => {
    expect(DEPOT_SIZE).toEqual([2, 2]);
    expect(depotTiles(10, 20)).toEqual([[10, 20], [11, 20], [10, 21], [11, 21]]);
    expect(depotContains(10, 20, 11, 21)).toBe(true);
    expect(depotContains(10, 20, 12, 20)).toBe(false);
  });

  it("names the tiles outside each edge", () => {
    expect(depotEdgeTiles(10, 20, "nw")).toEqual([[9, 20], [9, 21]]);
    expect(depotEdgeTiles(10, 20, "se")).toEqual([[12, 20], [12, 21]]);
    expect(depotEdgeTiles(10, 20, "ne")).toEqual([[10, 19], [11, 19]]);
    expect(depotEdgeTiles(10, 20, "sw")).toEqual([[10, 22], [11, 22]]);
  });

  it("drops edge tiles that fall off the map", () => {
    expect(depotEdgeTiles(0, 0, "nw")).toEqual([]);
    expect(depotEdgeTiles(0, 0, "ne")).toEqual([]);
    expect(depotEdgeTiles(MAP_W - 2, MAP_H - 2, "se")).toEqual([]);
    expect(depotEdgeTiles(MAP_W - 2, MAP_H - 2, "sw")).toEqual([]);
  });

  it("turns a quarter at a time, four rotations round to where it started", () => {
    expect(DEPOT_FACINGS).toEqual(["ne", "se", "sw", "nw"]);
    let f = DEPOT_FACINGS[0];
    for (let i = 0; i < 4; i++) f = rotateFacing(f);
    expect(f).toBe(DEPOT_FACINGS[0]);
    expect(rotateFacing("ne")).toBe("se");
    for (const s of DEPOT_FACINGS) expect(OPPOSITE_SIDE[OPPOSITE_SIDE[s]]).toBe(s);
  });

  it("opens on the side AWAY from the resource it stands beside", () => {
    // quarry directly up-left (NW) of the lot → the entrance opens SE
    const g = gridWith(ind(1, 7, 19));                // covers x 7..9, y 19..21 → touches x = 9
    expect(depotFacingAt(g, 10, 20)).toEqual({ facing: "se", problem: null });
    // …and directly up-right (NE): covers y 17..19 → touches y = 19 → opens SW
    expect(depotFacingAt(gridWith(ind(1, 10, 17)), 10, 20).facing).toBe("sw");
    expect(depotFacingAt(gridWith(ind(1, 12, 20)), 10, 20).facing).toBe("nw");   // resource SE
    expect(depotFacingAt(gridWith(ind(1, 10, 22)), 10, 20).facing).toBe("ne");   // resource SW
  });

  it("offers every free side as a rotation, the far one first", () => {
    const g = gridWith(ind(1, 7, 19));                // resource on the NW edge
    expect(depotFacings(g, 10, 20)).toEqual(["se", "sw", "ne"]);
    // the player's turn is honoured when that side is free, ignored when it is not
    expect(depotFacingFor(g, 10, 20, "ne")).toBe("ne");
    expect(depotFacingFor(g, 10, 20, "nw")).toBe("se");   // the resource's own side
    expect(depotFacingFor(g, 10, 20, null)).toBe("se");
    // a lot against the map edge cannot open off the map
    expect(depotFacings(gridWith(ind(1, 2, 0)), 0, 0)).not.toContain("nw");
  });

  it("refuses a site boxed in by resources, or beside none at all", () => {
    const boxedIn = gridWith(ind(1, 7, 19), ind(2, 12, 20), ind(3, 10, 17), ind(4, 10, 22));
    expect(depotFacingAt(boxedIn, 10, 20)).toEqual({ facing: null, problem: "boxed-in" });
    expect(depotFacingAt(gridWith(), 10, 20)).toEqual({ facing: null, problem: "no-industry" });
    // diagonal corner contact is not "beside"
    expect(depotFacingAt(gridWith(ind(1, 7, 17)), 10, 20).problem).toBe("no-industry");
  });

  it("connects roads only on the one open side", () => {
    expect(depotEntranceTiles(10, 20, "nw")).toEqual([[9, 20], [9, 21]]);
    expect(depotEntranceTiles(10, 20, "se")).toEqual([[12, 20], [12, 21]]);
    expect(depotEntranceTiles(10, 20, "ne")).toEqual([[10, 19], [11, 19]]);
    expect(depotEntranceTiles(10, 20, "sw")).toEqual([[10, 22], [11, 22]]);
    // the entrance never touches the resource the lot faces away from
    const g = gridWith(ind(1, 12, 20));
    const facing = depotFacingAt(g, 10, 20).facing!;
    for (const [x, y] of depotEntranceTiles(10, 20, facing)) {
      expect(x >= 12 && x < 15 && y >= 20 && y < 23, `${x},${y}`).toBe(false);
    }
  });

  it("reports the sides each touching industry covers", () => {
    const touching = industriesTouchingDepot(gridWith(ind(1, 12, 19, 3, 4)), 10, 20);
    expect(touching).toHaveLength(1);
    expect([...touching[0].sides]).toEqual(["se"]);
  });

  it("uses the stored facing, and derives one for legacy records", () => {
    const g = gridWith(ind(1, 12, 20));
    expect(depotFacingOf(g, { tx: 10, ty: 20, facing: "sw" })).toBe("sw");
    expect(depotFacingOf(g, { tx: 10, ty: 20 })).toBe("nw");
    expect(depotFacingOf(gridWith(), { tx: 10, ty: 20 })).toBe("sw");   // nothing to read: default
  });

  it("draws one authored rotation per facing", () => {
    // The art's own labels run mirrored across the two NORTH edges (the file
    // named `_ne` is the one whose yard opens up-LEFT), so those two are
    // crossed here — deliberately, and pinned so a re-export cannot drift.
    expect(DEPOT_SPRITES).toEqual({
      ne: "truck_depot_bottom_entrance_nw",
      se: "truck_depot_bottom_entrance_se",
      sw: "truck_depot_bottom_entrance_sw",
      nw: "truck_depot_bottom_entrance_ne",
    });
    expect(new Set(Object.values(DEPOT_SPRITES)).size).toBe(4);
  });
});
