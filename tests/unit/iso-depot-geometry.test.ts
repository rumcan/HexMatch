import { describe, expect, it } from "vitest";
import {
  DEPOT_SIZE, DEPOT_SPRITES, OPEN_SIDES,
  depotContains, depotEdgeTiles, depotEntranceTiles, depotFacingAt, depotFacingOf, depotTiles,
  industriesTouchingDepot,
} from "../../src/iso/depot";
import type { Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

// The 2×2 truck depot: it sits directly beside a resource and opens away from
// it. Grid directions as track.ts: NW −x, NE −y, SE +x, SW +y.

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

  it("opens at the bottom when the resource is on a top edge", () => {
    // quarry directly up-left (NW) of the lot
    const g = gridWith(ind(1, 7, 19));                // covers x 7..9, y 19..21 → touches x = 9
    expect(depotFacingAt(g, 10, 20)).toEqual({ facing: "bottom", problem: null });
    // …and directly up-right (NE): covers y 17..19 → touches y = 19
    expect(depotFacingAt(gridWith(ind(1, 10, 17)), 10, 20).facing).toBe("bottom");
  });

  it("opens at the top when the resource is on a bottom edge", () => {
    expect(depotFacingAt(gridWith(ind(1, 12, 20)), 10, 20).facing).toBe("top");   // SE
    expect(depotFacingAt(gridWith(ind(1, 10, 22)), 10, 20).facing).toBe("top");   // SW
  });

  it("refuses a site touching resources on both halves, or none at all", () => {
    expect(depotFacingAt(gridWith(ind(1, 7, 19), ind(2, 12, 20)), 10, 20))
      .toEqual({ facing: null, problem: "both-sides" });
    expect(depotFacingAt(gridWith(), 10, 20)).toEqual({ facing: null, problem: "no-industry" });
    // diagonal corner contact is not "beside"
    expect(depotFacingAt(gridWith(ind(1, 7, 17)), 10, 20).problem).toBe("no-industry");
  });

  it("connects roads only on the open side", () => {
    expect(OPEN_SIDES.top).toEqual(["nw", "ne"]);
    expect(depotEntranceTiles(10, 20, "top")).toEqual([[9, 20], [9, 21], [10, 19], [11, 19]]);
    expect(depotEntranceTiles(10, 20, "bottom")).toEqual([[12, 20], [12, 21], [10, 22], [11, 22]]);
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
    expect(depotFacingOf(g, { tx: 10, ty: 20, facing: "bottom" })).toBe("bottom");
    expect(depotFacingOf(g, { tx: 10, ty: 20 })).toBe("top");
    expect(depotFacingOf(gridWith(), { tx: 10, ty: 20 })).toBe("top");   // nothing to read: default
  });

  it("draws the art for its facing", () => {
    expect(DEPOT_SPRITES).toEqual({
      top: "truck_depot_top_entrance",
      bottom: "truck_depot_bottom_entrance",
    });
  });
});
