// Owner playtest 2026-10-05: "the plant is connected and there is no truck".
// A lorry drives its route out and back, so it cannot honour a one-way Avenue
// both ways; when the only way from depot to plant runs AGAINST a carriageway,
// the route must still be found (the one-way route stays preferred).
import { describe, expect, it } from "vitest";
import { roadPath } from "../../src/iso/road-routing";
import {
  AVENUE_X, avenueEdgeOk, avenueTravelDir, buildTile, createTrack, setRoadTier, tIdx,
} from "../../src/iso/track";

describe("a lorry route against an avenue's carriageway", () => {
  it("is found when it is the only way (and the one-way rule still says no)", () => {
    const t = createTrack(false);
    // An avenue pair along x: rows y=10 and y=11, x = 10..20.
    for (const y of [10, 11]) for (let x = 10; x <= 20; x++) buildTile(t, "road", x, y, 3);
    for (const y of [10, 11]) for (let x = 10; x <= 20; x++) setRoadTier(t, x, y, AVENUE_X);
    // Which way does row 10 run? Put the start at its DOWNSTREAM end and the
    // goal at its UPSTREAM end, each reached by a stub that touches only row 10.
    const dir = avenueTravelDir(t, 15, 10)!;
    expect(dir).toBeTruthy();
    const east = avenueEdgeOk(t, 15, 10, 16, 10);
    const [startX, goalX] = east ? [21, 9] : [9, 21];   // drive against the flow
    buildTile(t, "road", startX, 10, 3);
    buildTile(t, "road", goalX, 10, 3);
    expect(avenueEdgeOk(t, east ? 16 : 14, 10, 15, 10)).toBe(false);   // against the carriageway

    const path = roadPath(t, 1, [[startX, 10]], new Set([tIdx(goalX, 10)]));
    expect(path, "no route: the depot would get no truck").not.toBeNull();
    expect(path![0]).toEqual([startX, 10]);
    expect(path![path!.length - 1]).toEqual([goalX, 10]);
  });

  it("still takes the one-way route when there is one", () => {
    const t = createTrack(false);
    for (const y of [10, 11]) for (let x = 10; x <= 20; x++) buildTile(t, "road", x, y, 3);
    for (const y of [10, 11]) for (let x = 10; x <= 20; x++) setRoadTier(t, x, y, AVENUE_X);
    const east = avenueEdgeOk(t, 15, 10, 16, 10);
    const [startX, goalX] = east ? [9, 21] : [21, 9];   // WITH the flow
    buildTile(t, "road", startX, 10, 3);
    buildTile(t, "road", goalX, 10, 3);
    const path = roadPath(t, 1, [[startX, 10]], new Set([tIdx(goalX, 10)]))!;
    for (let i = 1; i < path.length; i++) {
      expect(avenueEdgeOk(t, path[i - 1][0], path[i - 1][1], path[i][0], path[i][1])).toBe(true);
    }
  });
});
