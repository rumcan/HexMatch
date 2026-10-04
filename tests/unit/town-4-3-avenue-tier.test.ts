// TOWN-4.3 x TOWN-4.2: a planned town's avenue is stamped with the AVENUE tier
// (not plain road) and every carriageway finds its partner and a travel direction.
import { describe, expect, it } from "vitest";
import { generateMap } from "../../src/iso/grid";
import {
  AVENUE_X, AVENUE_Y, avenuePartner, avenueTravelDir, createTrack, roadTierAt,
  seedTownAvenues, seedTownRoads,
} from "../../src/iso/track";

describe("planned towns stamp a real AVENUE tier", () => {
  for (const seed of [1, 42]) {
    it(`seed ${seed}: every avenue tile carries AVENUE_X/Y with a partner and a direction`, () => {
      const grid = generateMap(seed, { layout: "planned" });
      const t = createTrack(false);
      seedTownRoads(t, grid);
      seedTownAvenues(t, grid);
      let checked = 0;
      for (const town of grid.towns) {
        const plan = town.plan;
        if (!plan) continue;
        const want = plan.axis === "x" ? AVENUE_X : AVENUE_Y;
        for (const [x, y] of plan.avenueTiles) {
          expect(roadTierAt(t, x, y), `tier at ${x},${y}`).toBe(want);
          expect(avenuePartner(t, x, y), `partner at ${x},${y}`).not.toBeNull();
          expect(avenueTravelDir(t, x, y), `dir at ${x},${y}`).not.toBeNull();
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });
  }
});
