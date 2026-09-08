// PP-03 — the placement plans: one geometry shared by the preview overlay and
// the placement rules. These tests pin that the plan's footprint, reach and
// validity are EXACTLY the gameplay ones (`FACTORY_FOOTPRINT` + `canBuildOn`,
// `catchmentRect` + `industriesInCatchment`), so the preview can never paint
// a tile the click handler would refuse (or miss one it would accept).
import { describe, expect, it } from "vitest";
import { generateMap } from "../../src/iso/grid";
import { canBuildOn, tIdx } from "../../src/iso/track";
import { catchmentRect, industriesInCatchment, type Harvester } from "../../src/iso/economy";
import { TOWN_OCC, GRASS, ROUGH, type Grid } from "../../src/iso/grid";
import {
  DEPOT_FOOTPRINT,
  depotCatchmentNodeTiles,
  depotCatchmentTiles,
  factoryAdjacencyRing,
  factoryFootprintTiles,
  factoryQualifyingTownTiles,
  factoryReachBand,
  planDepotPlacement,
  planFactoryPlacement,
  placementReasonText,
} from "../../src/iso/placement";

const grid = (seed = 1337): Grid => generateMap(seed);

describe("PP-03 factory footprint vs town-adjacency band", () => {
  it("footprint is exactly the 2×2 tiles the building occupies", () => {
    expect(factoryFootprintTiles(30, 40)).toEqual([
      [30, 40], [31, 40], [30, 41], [31, 41],
    ]);
  });

  it("the reach band is EDGE-adjacent only — diagonals never qualify", () => {
    const g = grid();
    const ring = factoryAdjacencyRing(g, 60, 60);
    // every ring tile is an orthogonal neighbour of some footprint tile…
    for (const [x, y] of ring) {
      const d = (dx: number, dy: number) => Math.abs(x - (60 + dx)) + Math.abs(y - (60 + dy));
      expect(
        [0, 1, 2, 3].some((i) => d(i % 2, Math.floor(i / 2)) === 1),
        `${x},${y} is not edge-adjacent to the 2×2 footprint`,
      ).toBe(true);
    }
    // …and the footprint's own tiles are never part of their own ring
    const keys = new Set(ring.map(([x, y]) => `${x},${y}`));
    expect(ring).toHaveLength(8);
    for (const [x, y] of [[60, 60], [61, 60], [60, 61], [61, 61]]) {
      expect(keys.has(`${x},${y}`)).toBe(false);
    }
    // the four diagonals are exactly the excluded tiles
    for (const [x, y] of [[59, 59], [62, 59], [59, 62], [62, 62]]) {
      expect(keys.has(`${x},${y}`)).toBe(false);
    }
  });

  it("the reach band never tints an industry or town tile (a Factory does not harvest around it)", () => {
    const g = grid();
    for (const [tx, ty] of [[20, 20], [50, 50], [80, 80], [110, 110]]) {
      const band = factoryReachBand(g, tx, ty);
      for (const [x, y] of band) {
        const occ = g.occupancy[tIdx(x, y)];
        expect(occ).toBeLessThan(0);                 // not an industry
        expect(occ).not.toBe(TOWN_OCC);              // not a town tile
        expect([GRASS, ROUGH]).toContain(g.terrain[tIdx(x, y)]);
      }
      // a town tile in the ring is reported as a node mark, never as band
      const ring = factoryAdjacencyRing(g, tx, ty);
      const townRing = ring.filter(([x, y]) => g.occupancy[tIdx(x, y)] === TOWN_OCC);
      expect(factoryQualifyingTownTiles(g, tx, ty)).toEqual(townRing);
    }
  });
});

describe("PP-03 depot footprint vs catchment reach", () => {
  it("the reach is the same 4×4 rect the economy scores with, minus the 1×1 footprint tile", () => {
    const g = grid();
    const tx = 70, ty = 55;
    const plan = planDepotPlacement(g, [], tx, ty);
    const rect = catchmentRect(tx, ty);
    const expected: [number, number][] = [];
    for (let y = rect.y0; y <= rect.y1; y++) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        if (x === tx && y === ty) continue;
        if (x >= 0 && y >= 0 && x < g.w && y < g.h) expected.push([x, y]);
      }
    }
    expect(plan.reach).toEqual(expected);
    expect(depotCatchmentTiles(g, tx, ty)).toEqual(expected);
    // whatever the validity verdict at this tile, the footprint is that one
    // 1×1 tile with a consistent per-tile reason
    expect(plan.footprint).toHaveLength(1);
    expect(plan.footprint[0].tx).toBe(tx);
    expect(plan.footprint[0].ty).toBe(ty);
    expect(plan.footprint[0].ok).toBe(plan.valid);
    expect(plan.footprint[0].why).toBe(plan.valid ? null : plan.why);
    expect(plan.kind).toBe("depot");
    expect(DEPOT_FOOTPRINT).toEqual([1, 1]);
  });

  it("node marks are exactly the served industry's footprint tiles inside the catchment", () => {
    const g = grid();
    for (const ind of g.industries.slice(0, 8)) {
      const tx = ind.tx, ty = Math.max(0, ind.ty - 1); // directly above the node
      const plan = planDepotPlacement(g, [], tx, ty);
      const served = industriesInCatchment(g, { tx, ty } as Harvester);
      expect(plan.served.map((s) => s.id)).toEqual(served.map((s) => s.id));
      // every node tile is a tile of a served industry AND inside the rect
      const rect = catchmentRect(tx, ty);
      for (const [x, y] of plan.nodes) {
        expect(rect.x0 <= x && x <= rect.x1 && rect.y0 <= y && y <= rect.y1).toBe(true);
        expect(served.some((s) => x >= s.tx && x < s.tx + s.w && y >= s.ty && y < s.ty + s.h)).toBe(true);
      }
      // and no served industry tile inside the rect is missed
      const nodeKeys = new Set(plan.nodes.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of depotCatchmentNodeTiles(g, tx, ty)) {
        expect(nodeKeys.has(`${x},${y}`)).toBe(true);
      }
    }
  });
});

describe("PP-03 plan validity is the placement rule, not a copy", () => {
  it("factory plan validity == canBuildOn over the whole 2×2 footprint", () => {
    const g = grid();
    let compared = 0;
    for (let ty = 4; ty < g.h - 4; ty += 7) {
      for (let tx = 4; tx < g.w - 4; tx += 7) {
        const plan = planFactoryPlacement(g, tx, ty);
        const expected = factoryFootprintTiles(tx, ty)
          .every(([x, y]) => canBuildOn(g, "road", x, y));
        expect(plan.valid, `factory @ (${tx},${ty})`).toBe(expected);
        // every in-map footprint tile carries the per-tile verdict, with a
        // readable reason exactly when that tile is refused
        for (const t of plan.footprint) {
          expect(t.ok).toBe(canBuildOn(g, "road", t.tx, t.ty));
          if (t.ok) expect(t.why).toBeNull();
          else expect(t.why).toBeTruthy();
        }
        if (!plan.valid) {
          expect(plan.code).toBeTruthy();
          expect(plan.why).toBeTruthy();
          expect(placementReasonText(plan.code)).toBe(plan.why);
        }
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("depot plan validity == buildable ground + free tile + industry in catchment", () => {
    const g = grid();
    let compared = 0;
    for (let ty = 6; ty < g.h - 6; ty += 5) {
      for (let tx = 6; tx < g.w - 6; tx += 5) {
        const taken = tx % 2 === 0
          ? [{ tx: tx + 1, ty }, { tx: tx - 1, ty }]
          : [];
        const plan = planDepotPlacement(g, taken, tx, ty);
        const fake: Harvester = { id: -1, owner: "", ownerId: 0, tx, ty };
        const expected = canBuildOn(g, "road", tx, ty)
          && !taken.some((h) => h.tx === tx && h.ty === ty)
          && industriesInCatchment(g, fake).length > 0;
        expect(plan.valid, `depot @ (${tx},${ty})`).toBe(expected);
        if (!plan.valid) {
          expect(plan.code, `depot @ (${tx},${ty})`).toBeTruthy();
          expect(plan.why).toBe(placementReasonText(plan.code));
        }
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
  });

  it("out-of-map factory footprints are refused with a readable out-of-bounds reason", () => {
    const g = grid();
    // a footprint origin fully off the eastern edge (e.g. an edge hover after
    // panning): the whole 2×2 is out of bounds — no paint target, clear reason
    const plan = planFactoryPlacement(g, g.w, 40);
    expect(plan.valid).toBe(false);
    expect(plan.code).toBe("out-of-bounds");
    expect(plan.why).toMatch(/map/);
    expect(plan.footprint).toHaveLength(0);
    expect(plan.reach).toHaveLength(0);
    expect(plan.nodes).toHaveLength(0);
  });
});
