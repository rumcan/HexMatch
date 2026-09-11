// PP-03 — the placement plans: one geometry shared by the preview overlay and
// the placement rules. These tests pin that the plan's footprint, reach and
// validity are EXACTLY the gameplay ones (`FACTORY_FOOTPRINT` + `canBuildOn`,
// `catchmentRect` + `industriesInCatchment`), so the preview can never paint
// a tile the click handler would refuse (or miss one it would accept).
import { describe, expect, it } from "vitest";
import { generateMap } from "../../src/iso/grid";
import { buildTile, canBuildOn, createTrack, hasTrack, PUBLIC_OWNER, tIdx } from "../../src/iso/track";
import { catchmentRect, industriesInCatchment, type Harvester } from "../../src/iso/economy";
import { TOWN_OCC, GRASS, ROUGH, type Grid } from "../../src/iso/grid";
import { FACTORY_FOOTPRINT, MAP_H, MAP_W } from "../../src/iso/config";
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
  // PP-12: the footprint follows the art (FACTORY_FOOTPRINT), so these pin
  // the geometry against the constant — never a hardcoded 2×2.
  const [FW, FH] = FACTORY_FOOTPRINT;

  it("footprint is exactly the tiles the building occupies", () => {
    const expected: [number, number][] = [];
    for (let dy = 0; dy < FH; dy++) {
      for (let dx = 0; dx < FW; dx++) expected.push([30 + dx, 40 + dy]);
    }
    expect(factoryFootprintTiles(30, 40)).toEqual(expected);
  });

  it("the reach band is EDGE-adjacent only — diagonals never qualify", () => {
    const g = grid();
    const ring = factoryAdjacencyRing(g, 60, 60);
    const foot: [number, number][] = [];
    for (let dy = 0; dy < FH; dy++) {
      for (let dx = 0; dx < FW; dx++) foot.push([60 + dx, 60 + dy]);
    }
    // every ring tile is an orthogonal neighbour of some footprint tile…
    for (const [x, y] of ring) {
      expect(
        foot.some(([fx, fy]) => Math.abs(x - fx) + Math.abs(y - fy) === 1),
        `${x},${y} is not edge-adjacent to the footprint`,
      ).toBe(true);
    }
    // …and the footprint's own tiles are never part of their own ring
    const keys = new Set(ring.map(([x, y]) => `${x},${y}`));
    expect(ring).toHaveLength(2 * (FW + FH));
    for (const [x, y] of foot) {
      expect(keys.has(`${x},${y}`)).toBe(false);
    }
    // the four diagonals are exactly the excluded tiles
    for (const [x, y] of [[59, 59], [60 + FW, 59], [59, 60 + FH], [60 + FW, 60 + FH]]) {
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
  it("factory plan validity == canBuildOn over the whole footprint", () => {
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
    // panning): the whole footprint is out of bounds — no paint target, clear reason
    const plan = planFactoryPlacement(g, g.w, 40);
    expect(plan.valid).toBe(false);
    expect(plan.code).toBe("out-of-bounds");
    expect(plan.why).toMatch(/map/);
    expect(plan.footprint).toHaveLength(0);
    expect(plan.reach).toHaveLength(0);
    expect(plan.nodes).toHaveLength(0);
  });
});

describe("PP-17 a Factory never stands on a road", () => {
  // A flat grid with one town tile at (10,10). The Factory footprint anchored
  // at (11,10) spans x 11..13, y 10..12 — edge-adjacent to the town, with no
  // industry, town or terrain blocker — so the ONLY thing that can refuse it
  // is a road stamped inside the footprint.
  const townGrid = (): Grid => {
    const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
    occ[10 * MAP_W + 10] = TOWN_OCC;
    return {
      w: MAP_W, h: MAP_H,
      terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
      industries: [],
      towns: [{ id: 0, tx: 10, ty: 10, houses: [[10, 10]], roads: [] }],
      occupancy: occ,
      seed: 0,
    };
  };

  it("refuses a footprint whose tile carries a road, naming that tile", () => {
    const g = townGrid();
    const track = createTrack();
    buildTile(track, "dirt", 12, 10, 1);      // player gravel inside the footprint
    const plan = planFactoryPlacement(g, 11, 10, { requireTown: true, track });
    expect(plan.valid).toBe(false);
    expect(plan.code).toBe("track");
    expect(plan.why).toBe(placementReasonText("track"));
    // exactly the road tile is painted bad; the rest of the footprint is clean
    const bad = plan.footprint.filter((f) => !f.ok).map((f) => `${f.tx},${f.ty}`);
    expect(bad).toEqual(["12,10"]);
  });

  it("a public paved highway blocks a Factory exactly like a player road", () => {
    const g = townGrid();
    const track = createTrack();
    // public highways are free land in `occupancy` (a player may build over
    // them), so this is the one case only the track layer can see.
    buildTile(track, "road", 12, 10, PUBLIC_OWNER);
    const plan = planFactoryPlacement(g, 11, 10, { requireTown: true, track });
    expect(plan.valid).toBe(false);
    expect(plan.code).toBe("track");
    expect(plan.why).toBe(placementReasonText("track"));
  });

  it("without the track layer the plan stays the pure ground question", () => {
    const g = townGrid();
    const track = createTrack();
    buildTile(track, "dirt", 12, 10, 1);
    // hand-built synthetic grids call the plan without track — the geometry
    // answer is unchanged (and the game now always passes the live track).
    expect(planFactoryPlacement(g, 11, 10, { requireTown: true }).valid).toBe(true);
  });

  it("every public highway on a generated map is refused when a footprint would overlap it", () => {
    for (const seed of [1337, 7, 42, 2026]) {
      const g = generateMap(seed);
      const track = createTrack();
      for (const [tx, ty] of g.publicRoads ?? []) buildTile(track, "road", tx, ty, PUBLIC_OWNER);
      let overlapsChecked = 0;
      for (const [tx, ty] of g.publicRoads ?? []) {
        const plan = planFactoryPlacement(g, tx, ty, { requireTown: true, track });
        const overlaps = plan.footprint.some((f) =>
          hasTrack(track, "road", f.tx, f.ty) || hasTrack(track, "dirt", f.tx, f.ty));
        if (overlaps) {
          overlapsChecked++;
          // a footprint may be refused for other reasons too (e.g. rough or
          // town ground), but it must NEVER be valid while sitting on a road.
          expect(plan.valid, `seed ${seed} footprint @ ${tx},${ty} sits on a road`).toBe(false);
        }
      }
      expect(overlapsChecked).toBeGreaterThan(0);   // the fixture really exercised the rule
    }
  });
});
