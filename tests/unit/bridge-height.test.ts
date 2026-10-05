// BRIDGE-1 (owner 2026-10-05): "bridges are supposed to sit at the height they
// are started on, with pillars holding them up". A deck rides its higher bank's
// level; the deck-aware draper lifts every point on a deck tile to that level
// and leaves every other point on the terrain.
import { describe, expect, it } from "vitest";
import { bridgeDraper, FLAT_DRAPER, LIFT_GROUND_PER_LEVEL } from "../../src/iso/elevation";

describe("bridgeDraper", () => {
  it("is the base draper when there is no deck", () => {
    expect(bridgeDraper(FLAT_DRAPER, new Map(), 100)).toBe(FLAT_DRAPER);
  });

  it("lifts a point on a deck tile to the deck's level and leaves land alone", () => {
    const d = bridgeDraper(FLAT_DRAPER, new Map([[5 * 100 + 7, 2]]), 100);
    const k = 2 * LIFT_GROUND_PER_LEVEL;
    expect(d.point(7.5, 5.5)).toEqual([7.5 - k, 5.5 - k]);   // on the deck: up by two levels
    expect(d.point(8.5, 5.5)).toEqual([8.5, 5.5]);           // the bank beside it: on the terrain
  });

  it("is a pure function of the point, so a road leaving the bank meets the deck seamlessly", () => {
    const d = bridgeDraper(FLAT_DRAPER, new Map([[5 * 100 + 7, 1]]), 100);
    const a = d.path([[6.5, 5.5], [7, 5.5]]);
    const b = d.path([[7, 5.5], [7.5, 5.5]]);
    expect(a[a.length - 1]).toEqual(b[0]);
  });
});
