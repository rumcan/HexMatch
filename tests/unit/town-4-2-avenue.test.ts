// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.2 (#678) — the AVENUE road tier: two-tile boulevard, one-way
// carriageways, routing, rendering and the player tool.
//
// Acceptance covered here (the PR's HOW maps onto these blocks):
//   1. data: tier 6/7, partner + travel direction on both axes and all sides
//   2. refusals: 3-wide, diagonal/L drag, rail along an avenue, ramp on an
//      avenue, overpass decks (road rail-deck + rail RAIL_OVERPASS) on one
//   3. rail: a 90° level crossing across BOTH carriageways builds and keeps
//      road + rail connected
//   4. sim: N cars on a looped avenue never drive against the carriageway
//      and never cross the median between junctions (deterministic)
//   5. routing: a left turn picks the FAR carriageway; maps without avenues
//      route identically to a reference BFS over 3 seeds
//   6. flow: an avenue×street junction is signalled by default (unioned into
//      the flow rebuild + what flowSignals() serves the cars)
//   7. geometry: straight pair, junction, end cap, corner figures; median
//      strip/tree/lamp helpers
//   8. saves/MP: the tier byte round-trips through save + snapshot
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import {
  createTrack, previewDrag, commitDrag, buildTile, demolishTile, hasTrack,
  roadTierAt, setRoadTier, roadConnectionMask, avenuePartner, avenueTravelDir,
  avenueJunction, avenueEdgeOk, isAvenueTier, tIdx,
  AVENUE_X, AVENUE_Y, ROAD_TIER, NE, SE, SW, NW, PUBLIC_OWNER,
  seedTownRoads, seedPublicRoads, type Track,
} from "../../src/iso/track";
import { generateMap, type Grid } from "../../src/iso/grid";
import { AVENUE_COST, BUILD_COSTS, BUILD_COSTS_MONEY, ROAD_TIERS, TIER_THROUGHPUT, moneyValueOf } from "../../src/iso/config";
import { roadPath, ambientRoadGraph } from "../../src/iso/road-routing";
import { createRailState, buildRail, railPath, hasRail } from "../../src/iso/rail";
import {
  roadTile, avenueFigures, avenueSidewalkPaths, avenuePaintFigures,
  avenueMedianStrip, avenueMedianTreeSpot, avenueMedianLampSpot,
  avenueCentre, AVENUE_BIAS, MEDIAN_WIDTH, ROAD_WIDTH, JUNCTION_GAP,
} from "../../src/iso/road-geometry";
import { trackSave, trackRestored } from "../../src/iso/savegame-runtime";
import { diffTrack, readTiles, applyTrackDelta } from "../../src/net/delta";
import { CAR_COUNT, createCarState, planCars, tickCars, type Car } from "../../src/iso/cars";
import {
  configureTrafficFlow, flowSignals, flowTick, resetTrafficFlow,
} from "../../src/iso/flow";
import { createFlowState, rebuildFlow } from "../../src/iso/flow/flow-core";

const rich = { wood: 9999, stone: 9999, ore: 9999, grain: 9999, oil: 9999, gold: 9999 };

function flatLand(): Grid {
  // Same quiet inland stretch the tier tests pin (seed 42).
  const g = generateMap(42, {});
  for (let y = 60; y < 70; y++) {
    for (let x = 20; x < 60; x++) { g.terrain[y * 144 + x] = 0; g.occupancy[y * 144 + x] = -1; }
  }
  return g;
}

/** An Avenue drag through previewDrag — the player's exact path. */
function ave(g: Grid, t: Track, ax: number, ay: number, bx: number, by: number) {
  return previewDrag(g, t, "road", rich, ax, ay, bx, by, true, undefined, 0, undefined, true, {}, "avenue");
}
function commitAve(t: Track, pv: ReturnType<typeof ave>) {
  return commitDrag(t, "road", pv, 1, "avenue");
}
/** Lay one straight Avenue run; fails the test loudly if the preview refused. */
function lay(g: Grid, t: Track, ax: number, ay: number, bx: number, by: number) {
  const pv = ave(g, t, ax, ay, bx, by);
  expect(pv.why ?? null, `drag ${ax},${ay}→${bx},${by} refused: ${pv.why}`).toBeNull();
  expect(pv.tiles.length).toBeGreaterThan(0);
  const res = commitAve(t, pv);
  expect(res.built.length).toBe(pv.tiles.length);
  return pv;
}

// ── 1. data ────────────────────────────────────────────────────────────────
describe("TOWN-4.2 data — pairs, direction, ranks, cost", () => {
  it("lays tier 6 on both x-sides: partner + travelDir SE/NW, one pair per step", () => {
    const g = flatLand(), t = createTrack();
    const pv = lay(g, t, 22, 64, 26, 64);           // drag east along row 64
    expect(pv.avenueAxis).toBe("x");
    expect(pv.tiles.length).toBe(10);                // 5 pairs — the parallel rides the drag's RIGHT (row 65)
    for (let x = 22; x <= 26; x++) {
      expect(roadTierAt(t, x, 64)).toBe(AVENUE_X);
      expect(roadTierAt(t, x, 65)).toBe(AVENUE_X);
      expect(avenuePartner(t, x, 64)).toEqual([x, 65]);
      expect(avenuePartner(t, x, 65)).toEqual([x, 64]);
      // partner south ⇒ this tile is the north carriageway ⇒ travel NW (−x)
      expect(avenueTravelDir(t, x, 64)).toBe(NW);
      // partner north ⇒ travel SE (+x)
      expect(avenueTravelDir(t, x, 65)).toBe(SE);
      expect(isAvenueTier(roadTierAt(t, x, 64))).toBe(true);
      expect(avenueJunction(t, x, 64)).toBe(false);  // plain run: no cross-arm neighbour
    }
    // Straight non-junction cells: along-axis arms only — no partner arm, no cross arm.
    expect(roadConnectionMask(t, 24, 64)).toBe(SE | NW);
    expect(roadConnectionMask(t, 24, 65)).toBe(SE | NW);
  });

  it("lays tier 7 on both y-sides: partner + travelDir NE/SW", () => {
    const g = flatLand(), t = createTrack();
    const pv = lay(g, t, 40, 60, 40, 64);            // drag south along col 40 (right = col 39)
    expect(pv.avenueAxis).toBe("y");
    expect(pv.tiles.length).toBe(10);
    for (let y = 60; y <= 64; y++) {
      expect(roadTierAt(t, 40, y)).toBe(AVENUE_Y);
      expect(roadTierAt(t, 39, y)).toBe(AVENUE_Y);
      expect(avenuePartner(t, 40, y)).toEqual([39, y]);
      expect(avenuePartner(t, 39, y)).toEqual([40, y]);
      expect(avenueTravelDir(t, 40, y)).toBe(NE);    // partner west ⇒ north
      expect(avenueTravelDir(t, 39, y)).toBe(SW);    // partner east ⇒ south
    }
    expect(roadConnectionMask(t, 40, 62)).toBe(NE | SW);
  });

  it("drag direction flips which side carries which stream (right-hand rule)", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 26, 67, 22, 67);                       // drag WEST along row 67 → parallel on row 66
    for (let x = 22; x <= 26; x++) {
      expect(roadTierAt(t, x, 66)).toBe(AVENUE_X);
      expect(roadTierAt(t, x, 67)).toBe(AVENUE_X);
      expect(avenueTravelDir(t, x, 66)).toBe(NW);    // partner south ⇒ westbound
      expect(avenueTravelDir(t, x, 67)).toBe(SE);    // partner north ⇒ eastbound
    }
  });

  it("cost = 2× Road per pair +25% (one AVENUE_COST per tile); ranks and tables", () => {
    const g = flatLand(), t = createTrack();
    const pv = ave(g, t, 22, 64, 26, 64);
    const road = BUILD_COSTS.road;
    expect(AVENUE_COST.ore).toBe((road.ore ?? 0) * 1.25);
    expect(AVENUE_COST.wood).toBe((road.wood ?? 0) * 1.25);
    expect(AVENUE_COST.stone).toBe((road.stone ?? 0) * 1.25);
    // one PAIR = 2 tiles = 2× road + 25%
    expect((pv.cost.ore ?? 0) / 5).toBe((road.ore ?? 0) * 2 * 1.25);  // 5 pairs = 10 tiles
    expect(pv.cost.ore).toBe((road.ore ?? 0) * 1.25 * 10);
    expect(pv.free).toBe(0);                          // the free allowance covers dirt only
    expect(ROAD_TIERS.avenue.cost).toEqual(AVENUE_COST);
    expect(BUILD_COSTS_MONEY.avenue).toBe(moneyValueOf(AVENUE_COST));
    expect(TIER_THROUGHPUT[AVENUE_X]).toBe(ROAD_TIERS.avenue.throughput);
    expect(TIER_THROUGHPUT[AVENUE_X]).toBeGreaterThan(TIER_THROUGHPUT[0]);
    expect(TIER_THROUGHPUT[AVENUE_X]).toBeLessThan(TIER_THROUGHPUT[2]);
  });

  it("an orphaned half (partner missing) is impassable", () => {
    const t = createTrack();
    buildTile(t, "road", 33, 33, 1);
    setRoadTier(t, 33, 33, AVENUE_X);                // no partner anywhere
    expect(avenuePartner(t, 33, 33)).toBeNull();
    expect(avenueTravelDir(t, 33, 33)).toBeNull();
    expect(avenueEdgeOk(t, 33, 33, 34, 33)).toBe(false);
    expect(avenueEdgeOk(t, 33, 33, 33, 34)).toBe(false);
    expect(roadPath(t, 1, [[33, 33]], new Set([tIdx(34, 33)]))).toBeNull();
  });

  it("demolishing one carriageway removes the PAIR", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 64, 26, 64);
    demolishTile(t, "road", 24, 65);
    expect(hasTrack(t, "road", 24, 65)).toBe(false);
    expect(hasTrack(t, "road", 24, 64)).toBe(false); // the partner came down with it
    // …and the run beside it is untouched
    expect(hasTrack(t, "road", 23, 64)).toBe(true);
    demolishTile(t, "road", 23, 64);
    expect(hasTrack(t, "road", 23, 65)).toBe(false);
  });

  it("street/highway drags pass over an Avenue free and never retier it", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 64, 26, 64);
    const hw = previewDrag(g, t, "road", rich, 22, 64, 26, 64, true, undefined, 0, undefined, true, {}, "highway");
    expect(Object.keys(hw.cost).length).toBe(0);
    commitDrag(t, "road", hw, 1, "highway");
    expect(roadTierAt(t, 24, 64)).toBe(AVENUE_X);
    expect(roadTierAt(t, 24, 65)).toBe(AVENUE_X);
  });
});

// ── 2. refusals ────────────────────────────────────────────────────────────
describe("TOWN-4.2 refusals — illegal shapes never preview", () => {
  it("refuses a third carriageway beside an existing pair (3-wide)", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 64, 26, 64);                       // rows 64+65
    const wide = ave(g, t, 22, 66, 26, 66);          // rows 66+67 — cell (22,66) has avenue at (22,65)
    expect(wide.tiles.length).toBe(0);
    expect(wide.why).toBe("avenue-wide");
  });

  it("refuses diagonal and L-shaped drags", () => {
    const g = flatLand(), t = createTrack();
    const diag = ave(g, t, 22, 64, 28, 68);
    expect(diag.tiles.length).toBe(0);
    expect(diag.why).toBe("avenue-axis");
    const bent = ave(g, t, 22, 64, 26, 68);          // L: both axes differ
    expect(bent.tiles.length).toBe(0);
    expect(bent.why).toBe("avenue-axis");
  });

  it("refuses a Ramp dropped on an Avenue (and overpass conversions never trigger)", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 64, 26, 64);
    const ramp = previewDrag(g, t, "road", rich, 22, 64, 26, 64, true, undefined, 0, undefined, true, {}, "ramp");
    expect(ramp.tiles.length).toBe(0);
    expect(ramp.why).toBe("avenue");
    expect(roadTierAt(t, 24, 64)).toBe(AVENUE_X);
    // a plain Road drag across the Avenue neither converts it nor charges
    const pass = previewDrag(g, t, "road", rich, 24, 60, 24, 68, true, undefined, 0, undefined, true, {}, "road");
    expect(pass.why ?? null).toBeNull();
    expect(pass.railOverpasses ?? []).toEqual([]);
    commitDrag(t, "road", pass, 1, "road");
    expect(roadTierAt(t, 24, 64)).toBe(AVENUE_X);
  });

  it("refuses a road rail-DECK over an Avenue (crosses at grade instead)", () => {
    const g = flatLand(), t = createTrack();
    // A standing rail crossing the future Avenue tiles (builtAt says rail-y).
    g.builtAt = (x: number, y: number) => (y === 64 || y === 65) && x === 24 ? "rail-y" : null;
    lay(g, t, 22, 64, 26, 64);
    // Road running east-west across the rail at (24,64): without the guard
    // this would plan a deck at that cell.
    const pv = previewDrag(g, t, "road", rich, 22, 64, 26, 64, true, undefined, 0, undefined, true,
      { gradeSeparated: true, railDeckAt: () => false }, "road");
    expect(pv.railOverpasses ?? []).toEqual([]);      // no deck on the Avenue tiles
    expect(pv.tiles.length).toBe(5);                  // the drag still passes over
    expect(Object.keys(pv.cost).length).toBe(0);      // free over existing Avenue
    expect(pv.why ?? null).toBeNull();

    // Control: the same drag over plain road tiles DOES plan the deck.
    const ctrl = createTrack();
    for (let x = 22; x <= 26; x++) buildTile(ctrl, "road", x, 64, 1);
    const ok = previewDrag(g, ctrl, "road", rich, 22, 64, 26, 64, true, undefined, 0, undefined, true,
      { gradeSeparated: true, railDeckAt: () => false }, "road");
    expect(ok.railOverpasses ?? []).toEqual([[24, 64, "x"]]);
    delete g.builtAt;
  });

  it("refuses rail laid ALONG an Avenue", () => {
    const g = flatLand(), t = createTrack(), rail = createRailState();
    lay(g, t, 22, 64, 26, 64);
    const along = buildRail(g, t, rail, 1, [[23, 64], [24, 64], [25, 64]]);
    expect(along.why).toMatch(/road-parallel|crossing-curve/);
    expect(hasRail(rail.rail, 24, 64)).toBe(false);
  });

  it("refuses a grade-separated rail drag that would deck an Avenue", () => {
    const g = flatLand(), t = createTrack(), rail = createRailState();
    lay(g, t, 22, 64, 26, 64);
    const over = buildRail(g, t, rail, 1, [[24, 63], [24, 64], [24, 65], [24, 66]], true);
    expect(over.why).toBe("avenue-deck");
    expect(hasRail(rail.rail, 24, 64)).toBe(false);
  });
});

// ── 3. level crossing ──────────────────────────────────────────────────────
describe("TOWN-4.2 rail — a 90° level crossing across BOTH carriageways", () => {
  it("builds and keeps road + rail connected", () => {
    const g = flatLand(), t = createTrack(), rail = createRailState();
    lay(g, t, 22, 64, 26, 64);
    const roadBefore = t.road.slice(), tierBefore = t.tier!.slice();
    const col: [number, number][] = [[24, 62], [24, 63], [24, 64], [24, 65], [24, 66], [24, 67]];
    const res = buildRail(g, t, rail, 1, col);
    expect(res.why).toBe("ok");
    // both avenue tiles carry rail…
    expect(hasRail(rail.rail, 24, 64)).toBe(true);
    expect(hasRail(rail.rail, 24, 65)).toBe(true);
    // …the rail network runs straight through the crossing …
    expect(railPath(rail, 1, [[24, 62]], new Set([tIdx(24, 67)]))).toEqual(col);
    // …and neither the road masks nor the tier bytes moved.
    expect(t.road).toEqual(roadBefore);
    expect(t.tier).toEqual(tierBefore);
    expect(roadConnectionMask(t, 24, 64)).toBe(SE | NW);
    expect(roadConnectionMask(t, 24, 65)).toBe(SE | NW);
    // the road keeps its through-route west→east (row 64 is the westbound side)
    const route = roadPath(t, 1, [[26, 64]], new Set([tIdx(22, 64)]));
    expect(route).not.toBeNull();
    expect(route!.length).toBe(5);
    expect(route![1]).toEqual([25, 64]);
    expect(route![3]).toEqual([23, 64]);
  });
});

// ── 4. sim: looped avenue, N cars, deterministic ───────────────────────────
describe("TOWN-4.2 sim — cars on a looped Avenue", () => {
  /**
   * The ring, four straight drags (bends are two drags meeting end-to-side):
   *   N rows 62,63 x22…27   E cols 28,29 y62…66
   *   S rows 65,66 x22…27   W cols 20,21 y62…66
   * Interface cells butt up beside each arm's end — no cell belongs to two
   * pairs, and both circulation directions are legal at all four corners.
   */
  function ring(): { g: Grid; t: Track } {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 62, 27, 62);   // north arm (parallel row 63)
    lay(g, t, 29, 62, 29, 66);   // east arm  (parallel col 28)
    lay(g, t, 22, 65, 27, 65);   // south arm (parallel row 66)
    lay(g, t, 20, 66, 20, 62);   // west arm  (parallel col 21)
    return { g, t };
  }

  /** Car shells from a normally seeded town track (the ring itself has no
   *  town nodes, so planCars would find no trips on it). */
  function shells(g: Grid, n: number, seed: number): Car[] {
    const seeded = createTrack();
    seedTownRoads(seeded, g);
    seedPublicRoads(seeded, g);
    return planCars(seeded, g, [], n, seed);
  }

  /** The acceptance invariant, evaluated per route leg. */
  function assertOneWayLegs(t: Track, car: Car): void {
    const r = car.route;
    for (let k = 0; k < r.length - 1; k++) {
      const [x, y] = r[k], [nx, ny] = r[k + 1];
      const eitherAvenue = isAvenueTier(hasTrackAt(t, x, y) ? roadTierAt(t, x, y) : -1)
        || isAvenueTier(hasTrackAt(t, nx, ny) ? roadTierAt(t, nx, ny) : -1);
      if (!eitherAvenue) continue;
      expect(
        avenueEdgeOk(t, x, y, nx, ny),
        `${car.name}: illegal avenue step ${k} (${x},${y})→(${nx},${ny})`,
      ).toBe(true);
      // Direction: an along-carriageway step equals the tile's travel dir.
      const td = avenueTravelDir(t, x, y);
      if (td && isAvenueTier(roadTierAt(t, x, y))) {
        const dx = nx - x, dy = ny - y;
        const along = (td === SE || td === NW) ? dx !== 0 : dy !== 0;
        if (along) {
          const [ex, ey] = td === NE ? [0, -1] : td === SE ? [1, 0] : td === SW ? [0, 1] : [-1, 0];
          expect([dx, dy], `${car.name}: against flow at ${x},${y}`).toEqual([ex, ey]);
        } else {
          // Crossing the median: legal only at a junction cell.
          expect(
            avenueJunction(t, x, y) || avenueJunction(t, nx, ny),
            `${car.name}: median crossing off-junction at ${x},${y}→${nx},${ny}`,
          ).toBe(true);
        }
      }
    }
  }
  function hasTrackAt(t: Track, x: number, y: number): boolean {
    return (t.road[y * 144 + x] & 16) !== 0;
  }

  it("N cars circulate the ring without driving against a carriageway or crossing the median", () => {
    const { g, t } = ring();
    // Both circulation directions exist as through-routes around the whole
    // ring: row 63 runs east, row 62 west — each one-way lane forces the
    // long way to the opposite end of the arm it starts on.
    const cw = roadPath(t, 1, [[27, 63]], new Set([tIdx(23, 63)]));      // east → south → west → north…
    const ccw = roadPath(t, 1, [[25, 62]], new Set([tIdx(27, 66)]));      // west → south → east…
    expect(cw, "clockwise route around the ring").not.toBeNull();
    expect(ccw, "counter-clockwise route around the ring").not.toBeNull();
    expect(cw!.length).toBeGreaterThanOrEqual(12);        // forced the long way round
    expect(ccw!.length).toBeGreaterThanOrEqual(12);

    // N cars on the loop: plan shells, then pin them to the two ring routes
    // (the ring is deliberately isolated from the town network).
    const state = createCarState();
    const cars = shells(g, CAR_COUNT, 0x42be);
    expect(cars.length).toBe(CAR_COUNT);
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.route = (i % 2 === 0 ? cw! : ccw!).map(([x, y]) => [x, y] as [number, number]);
      c.origin = c.route[0];
      c.dest = c.route[c.route.length - 1];
      c.state = "driving";
      c.leg = 0;
      c.t = 0;
      c.waitMs = 0;
      assertOneWayLegs(t, c);
    }
    state.cars = cars;
    // 100 deterministic ticks: invariants hold on every current route, and
    // the cars actually drive (legs advance).
    let advanced = 0, avenueLegsSeen = 0;
    for (let i = 0; i < 100; i++) {
      tickCars(state, 300, t, g, i);
      for (const c of state.cars) {
        if (c.state === "waiting" || c.route.length < 2) continue;
        assertOneWayLegs(t, c);
        advanced = Math.max(advanced, c.leg);
        for (let k = 0; k < c.route.length - 1; k++) {
          if (isAvenueTier(roadTierAt(t, c.route[k][0], c.route[k][1]))) avenueLegsSeen++;
        }
      }
    }
    expect(advanced).toBeGreaterThan(0);              // they moved
    expect(avenueLegsSeen).toBeGreaterThan(0);        // …on the ring

    // The graph itself is directed on the ring: no reversed edges anywhere.
    const graph = ambientRoadGraph(t);
    for (const [i, list] of graph) {
      const x = i % 144, y = (i / 144) | 0;
      if (!hasTrackAt(t, x, y) || !isAvenueTier(roadTierAt(t, x, y))) continue;
      for (const nb of list) {
        const nx = nb % 144, ny = (nb / 144) | 0;
        expect(avenueEdgeOk(t, x, y, nx, ny)).toBe(true);
      }
      // the westbound north arm never points east… (mid-run only: x=22 exits
      // west onto the W arm, x=27 exits east into the E arm at their junctions)
      if (y === 62 && x >= 23 && x <= 26) {
        expect(list).not.toContain(tIdx(x + 1, y));
        expect(list).toContain(tIdx(x - 1, y));
      }
    }
  });

  it("is deterministic: the same seed plans the same routes twice", () => {
    const { g } = ring();
    const a = shells(g, 8, 5);
    const b = shells(g, 8, 5);
    expect(a.length).toBe(8);
    expect(a.map((c) => [c.name, c.route])).toEqual(b.map((c) => [c.name, c.route]));
  });
});

// ── 5. routing ─────────────────────────────────────────────────────────────
describe("TOWN-4.2 routing — turns, and no-avenue maps unchanged", () => {
  it("a left turn from a cross street picks the FAR carriageway at the junction", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 62, 26, 62);                       // avenue rows 62+63
    for (const y of [60, 61, 64, 65]) buildTile(t, "road", 24, y, 1);  // street col 24
    // Junction cells see the street AND the partner.
    expect(avenueJunction(t, 24, 62)).toBe(true);
    expect(avenueJunction(t, 24, 63)).toBe(true);
    expect(roadConnectionMask(t, 24, 62)).toBe(NE | SE | SW | NW);
    // Plain mid-run cell: along arms only (no partner arm, no cross arm).
    expect(avenueJunction(t, 25, 62)).toBe(false);
    expect(roadConnectionMask(t, 25, 62)).toBe(SE | NW);

    // From the street (south) to a WEST-bound target: enter the near side,
    // cross the median ON the junction, leave on the far (westbound) side.
    const path = roadPath(t, 1, [[24, 65]], new Set([tIdx(23, 62)]));
    expect(path).not.toBeNull();
    expect(path!).toEqual([[24, 65], [24, 64], [24, 63], [24, 62], [23, 62]]);

    // The right turn stays on the carriageway it entered (row 63, eastbound).
    const right = roadPath(t, 1, [[24, 65]], new Set([tIdx(25, 63)]));
    expect(right).not.toBeNull();
    expect(right!).toEqual([[24, 65], [24, 64], [24, 63], [25, 63]]);
  });

  it("U-turns happen only at a junction", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 62, 26, 62);
    for (const y of [60, 61, 64, 65]) buildTile(t, "road", 24, y, 1);
    // Mid-run partner hop (off-junction) is illegal both ways…
    expect(avenueEdgeOk(t, 25, 62, 25, 63)).toBe(false);
    expect(avenueEdgeOk(t, 25, 63, 25, 62)).toBe(false);
    // …while the junction cell allows it (that is the U-turn).
    expect(avenueEdgeOk(t, 24, 62, 24, 63)).toBe(true);
    expect(avenueEdgeOk(t, 24, 63, 24, 62)).toBe(true);
  });

  it("maps without avenues route exactly like a reference mutual-bits BFS (3 seeds)", () => {
    const reference = (
      track: Track, owner: number, from: [number, number][], goals: Set<number>,
    ): [number, number][] | null => {
      // The pre-avenue roadPath in miniature: mutual axis bits, owner-open.
      const open = (x: number, y: number) => {
        const i = y * 144 + x;
        if (i < 0 || i >= 144 * 144) return false;
        const own = track.owner[i];
        return own === 0 || own === owner || own === PUBLIC_OWNER;
      };
      const bits = (x: number, y: number) => {
        const i = y * 144 + x;
        return (track.road[i] & 15) || (track.dirt[i] & 15);
      };
      const parent = new Map<number, number>();
      const queue: number[] = [];
      for (const [x, y] of from) {
        const i = y * 144 + x;
        if (i < 0 || i >= 144 * 144 || parent.has(i)) continue;
        parent.set(i, -1); queue.push(i);
      }
      const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      for (let h = 0; h < queue.length; h++) {
        const cur = queue[h];
        if (goals.has(cur)) {
          const out: number[] = [];
          for (let i = cur; i !== -1; i = parent.get(i)!) out.push(i);
          return out.reverse().map((i) => [i % 144, (i / 144) | 0] as [number, number]);
        }
        const x = cur % 144, y = (cur / 144) | 0;
        const m = bits(x, y);
        if (!m) continue;
        for (let d = 0; d < 4; d++) {
          const bit = [1, 2, 4, 8][d];
          if (!(m & bit)) continue;
          const nx = x + dirs[d][0], ny = y + dirs[d][1];
          if (nx < 0 || ny < 0 || nx >= 144 || ny >= 144) continue;
          const n = bits(nx, ny);
          const back = [4, 8, 1, 2][d];
          if (!(n & back) || !open(nx, ny)) continue;
          const ni = ny * 144 + nx;
          if (parent.has(ni)) continue;
          parent.set(ni, cur); queue.push(ni);
        }
      }
      return null;
    };

    for (const seed of [42, 79, 123]) {
      const g = generateMap(seed, {});
      const t = createTrack();
      seedTownRoads(t, g);
      seedPublicRoads(t, g);
      // Pick two road tiles deterministically (first and last on the layer).
      const idxs: number[] = [];
      for (let i = 0; i < t.road.length && idxs.length < 2; i++) {
        if (t.road[i] & 16) idxs.push(i);
      }
      let last = -1;
      for (let i = t.road.length - 1; i >= 0; i--) if (t.road[i] & 16) { last = i; break; }
      expect(idxs.length).toBe(2);
      const from: [number, number] = [idxs[0] % 144, (idxs[0] / 144) | 0];
      const goals = new Set([last]);
      const mine = roadPath(t, 1, [from], goals);
      const theirs = reference(t, 1, [from], goals);
      expect(mine, `seed ${seed} route shape`).toEqual(theirs);
    }
  });
});

// ── 6. flow: signalled by default ──────────────────────────────────────────
describe("TOWN-4.2 flow — avenue×street junctions are signalled by default", () => {
  it("unions Avenue junction tiles into the rebuild input and into flowSignals()", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 62, 26, 62);
    for (const y of [60, 61, 64, 65]) buildTile(t, "road", 24, y, 1);
    configureTrafficFlow({ enabled: true });
    try {
      const signals = { seed: 42, junctions: new Map<number, number>() };  // ambience found none (town-box scan)
      flowTick(100, t, g, signals, 1000);
      const served = flowSignals();
      expect(served).not.toBeNull();
      // Both junction cells of the crossing are served to the cars…
      expect(served!.junctions.get(tIdx(24, 62))).toBe(-1);   // townId −1: shared field controller
      expect(served!.junctions.get(tIdx(24, 63))).toBe(-1);
      // …and a plain mid-run Avenue cell is NOT a junction anywhere.
      expect(served!.junctions.has(tIdx(25, 62))).toBe(false);
      // A second tick with the same inputs stays live and stable.
      flowTick(100, t, g, signals, 1100);
      expect(flowSignals()!.junctions.get(tIdx(24, 62))).toBe(-1);
    } finally {
      resetTrafficFlow();
      configureTrafficFlow({ enabled: false });
    }
  });

  it("counts physical approaches: an arm arriving only as an in-edge still registers", () => {
    // A T: the junction's out-list has 2 edges; the third approach arrives
    // from a neighbour whose out-list points AT the junction (one-way avenue).
    const W = 8;
    const graph = new Map<number, number[]>();
    const set = (a: number, b: number) => {
      graph.set(a, [...(graph.get(a) ?? []), b]);      // directed a→b only
    };
    const J = 3 * W + 3;
    set(J, 3 * W + 2); set(J, 2 * W + 3);              // two OUT arms
    set(3 * W + 4, J);                                  // third arm: in-edge only
    set(4 * W + 3, J);
    const s = createFlowState({ incidents: false }, 7);
    rebuildFlow(s, {
      mapW: W, mapH: W, seed: 7, graph,
      junctions: new Map([[J, 7]]),
      towns: [],
      capacityOf: () => 6,
    });
    expect(s.junctions.has(J)).toBe(true);
    // Four physical approaches, each with its own direction: two leave on the
    // junction's out-list, two only ARRIVE as in-edges (the one-way pattern).
    // The pre-fix out-list-only counting saw just the first two.
    expect(s.junctions.get(J)!.arms.length).toBe(4);
  });
});

// ── 7. geometry ────────────────────────────────────────────────────────────
describe("TOWN-4.2 geometry — figures for the boulevard", () => {
  const paved = () => false;

  it("straight pair: offset centreline figures on both halves", () => {
    // tile (10,10), partner to the south (outer = −1 → strip drawn here)
    const north = roadTile(10, 10, 0b10000 | SE | NW, "paved", paved, false, 0,
      { axis: "x", outer: -1, junction: false });
    expect(north.avenue?.axis).toBe("x");
    expect(north.sidewalk).toBe(true);                // avenue ⇒ outer sidewalk
    expect(north.figures.length).toBe(1);
    const pts = north.figures[0].points;
    expect(pts.length).toBe(3);                        // port → centre → port
    expect(pts[0][0]).toBeCloseTo(11, 9);              // SE port (first arm figure)
    expect(pts[2][0]).toBeCloseTo(10, 9);              // …NW port across the cell
    for (const [, v] of pts) expect(v).toBeCloseTo(10.5 + AVENUE_BIAS, 9);  // 0.02 toward the partner

    const south = roadTile(10, 11, 0b10000 | SE | NW, "paved", paved, false, 0,
      { axis: "x", outer: 1, junction: false });
    for (const [, v] of south.figures[0].points) expect(v).toBeCloseTo(11.5 - AVENUE_BIAS, 9);
    // The two centrelines are one carriageway's width apart… i.e. offset by
    // 1 − 2×BIAS across the pair — and each hugs its own median side.
    expect(1 - 2 * AVENUE_BIAS).toBeCloseTo(0.96, 9);
  });

  it("junction: a cross stub runs from the street port to the centreline", () => {
    const mask = 0b10000 | SE | NW | NE;              // through-run + street to the north
    const f = avenueFigures(10, 10, mask, { axis: "x", outer: 1, junction: true });
    expect(f.length).toBe(2);                          // run + stub
    const stub = f[1].points;
    expect(stub[0]).toEqual([10.5, 10]);               // NE port (edge midpoint)
    expect(stub[stub.length - 1][1]).toBeCloseTo(10.5 - AVENUE_BIAS, 9);
    // Dashes stop short of the junction on both arms.
    const dashes = avenuePaintFigures(10, 10, mask, { axis: "x", outer: 1, junction: true });
    expect(dashes.length).toBe(2);
    for (const d of dashes) expect(d.points.length).toBe(2);
    const runLen = Math.hypot(1, 0) - JUNCTION_GAP;    // each arm trimmed by the gap
    expect(runLen).toBeLessThan(1);
    // …and a single-connection stub carries no dash at all.
    expect(avenuePaintFigures(10, 10, 0b10000 | SE, { axis: "x", outer: 1, junction: false })).toEqual([]);
  });

  it("end cap: a dead end grows a transverse sidewalk across the whole face; a through-port does not", () => {
    // Dead end at the west: only the SE arm.
    const dead = avenueSidewalkPaths(10, 10, 0b10000 | SE, { axis: "x", outer: -1, junction: false });
    const caps = dead.filter((f) => f.points[0][0] === f.points[f.points.length - 1][0]);
    expect(caps.length).toBe(1);
    expect(caps[0].points[0][0]).toBe(10);             // at the open tile edge
    const [lo, hi] = [caps[0].points[0][1], caps[0].points[1][1]].sort((a, b) => a - b);
    expect(lo).toBeCloseTo(10 + MEDIAN_WIDTH / 2 - MEDIAN_WIDTH / 2 + 0.095, 9);  // pair face start
    expect(hi).toBeCloseTo(10 + 1.905, 9);             // …to the far side's flank
    // Through-port: both arms present → no cap, just the outer flank.
    const through = avenueSidewalkPaths(10, 10, 0b10000 | SE | NW, { axis: "x", outer: -1, junction: false });
    expect(through.filter((f) => f.points[0][0] === f.points[f.points.length - 1][0]).length).toBe(0);
    expect(through[0].points).toEqual([[10, 10.095], [11, 10.095]]);
  });

  it("corner: two offset straights overlap across the seam (the wide bend)", () => {
    // The corner cell of an x-run whose east interface neighbour is a y-run
    // cell: a plain offset straight (through-arms only; the interface exits
    // east, the partner arm does not appear off-junction).
    const xCell = avenueFigures(10, 10, 0b10000 | SE | NW, { axis: "x", outer: 1, junction: false });
    expect(xCell.length).toBe(1);
    expect(xCell[0].points[0][0]).toBeCloseTo(11, 9);  // reaches its east (SE) port
    const yCell = avenueFigures(11, 10, 0b10000 | NE | SW, { axis: "y", outer: -1, junction: false });
    expect(yCell.length).toBe(1);
    expect(yCell[0].points[0][0]).toBeCloseTo(11.5 + AVENUE_BIAS, 9);
    // Round caps (half paved width) make the two runs overlap, no gap:
    // x-run cap reaches 11 + 0.39, y-run carriage starts at 11.52 − 0.39.
    expect(11 + ROAD_WIDTH.paved / 2).toBeGreaterThan(11.5 + AVENUE_BIAS - ROAD_WIDTH.paved / 2);
  });

  it("median: one strip per pair-tile, none at a junction; tree every tile, lamp every second", () => {
    const here = { axis: "x", outer: -1, junction: false } as const;
    const strip = avenueMedianStrip(10, 10, here);
    expect(strip).not.toBeNull();
    const vs = strip!.map(([, v]) => v);
    expect(Math.min(...vs)).toBeCloseTo(10 + 1 - MEDIAN_WIDTH / 2, 9);  // straddles the shared edge
    expect(Math.max(...vs)).toBeCloseTo(10 + 1 + MEDIAN_WIDTH / 2, 9);
    // The partner's half never draws a second strip.
    expect(avenueMedianStrip(10, 11, { axis: "x", outer: 1, junction: false })).toBeNull();
    // Junction opens the median.
    expect(avenueMedianStrip(10, 10, { ...here, junction: true })).toBeNull();
    expect(avenueMedianTreeSpot(10, 10, here)).toEqual([10.5, 11]);
    expect(avenueMedianTreeSpot(11, 10, here)).toEqual([11.5, 11]);
    // lamps every second tile along x, offset from the tree
    expect(avenueMedianLampSpot(10, 10, here)).toEqual([10.25, 11]);
    expect(avenueMedianLampSpot(11, 10, here)).toBeNull();
    expect(avenueMedianLampSpot(12, 10, here)).toEqual([12.25, 11]);
  });

  it("the carriageway cross-section sums to exactly one tile", () => {
    // frontage + sidewalk + carriageway + half median = 1 (from the outer edge)
    const frontage = 1 - MEDIAN_WIDTH / 2 - 0.07 - ROAD_WIDTH.paved;
    expect(frontage + 0.07 + ROAD_WIDTH.paved + MEDIAN_WIDTH / 2).toBeCloseTo(1, 9);
    // …and the centreline sits frontage + sidewalk + half carriageway in.
    expect(AVENUE_BIAS).toBeCloseTo(frontage + 0.07 + ROAD_WIDTH.paved / 2 - 0.5, 9);
    const c = avenueCentre(0, 0, { axis: "x", outer: 1, junction: false });
    expect(c[1]).toBeCloseTo(0.5 - AVENUE_BIAS, 9);
  });
});

// ── 8. saves / MP ──────────────────────────────────────────────────────────
describe("TOWN-4.2 saves & MP — the tier byte round-trips", () => {
  it("an Avenue survives save → snapshot restore with masks intact", () => {
    const g = flatLand(), t = createTrack();
    lay(g, t, 22, 64, 26, 64);                       // rows 64+65
    lay(g, t, 40, 60, 40, 64);                       // cols 39+40
    const back = createTrack(false);
    trackRestored(back, trackSave(t));
    for (let x = 22; x <= 26; x++) {
      expect(back.tier![tIdx(x, 64)]).toBe(AVENUE_X);
      expect(back.tier![tIdx(x, 65)]).toBe(AVENUE_X);
      expect(avenuePartner(back, x, 64)).toEqual([x, 65]);
      expect(avenueTravelDir(back, x, 65)).toBe(SE);
      // ends only carry the inward arm; the middle of the run carries both
      expect(roadConnectionMask(back, x, 64)).toBe(x === 22 ? SE : x === 26 ? NW : SE | NW);
    }
    for (let y = 60; y <= 64; y++) {
      expect(back.tier![tIdx(40, y)]).toBe(AVENUE_Y);
      expect(avenueTravelDir(back, 39, y)).toBe(SW);
    }
    // Junction logic rides the restored bytes too: a street crossing the
    // pair from both sides (rows 61-63 north, 66-67 south of the avenue).
    for (const y of [61, 62, 63, 66, 67]) buildTile(t, "road", 24, y, 1);
    expect(avenueJunction(t, 24, 64)).toBe(true);
    expect(avenueJunction(t, 24, 65)).toBe(true);
    const back2 = createTrack(false);
    trackRestored(back2, trackSave(t));
    expect(avenueJunction(back2, 24, 64)).toBe(true);
    expect(avenueJunction(back2, 24, 65)).toBe(true);
    expect(roadConnectionMask(back2, 24, 64)).toBe(NE | SE | SW | NW);
    expect(avenueTravelDir(back2, 24, 64)).toBe(NW);  // direction unchanged by the street
  });

  it("rides the multiplayer delta like every other tier (no new wire field)", () => {
    const g = flatLand(), a = createTrack(), b = createTrack();
    // b gains an avenue, a mirrors the pre-state
    lay(g, b, 22, 64, 26, 64);
    const d = diffTrack(a, b);
    expect(d.some((c) => c.tier === AVENUE_X)).toBe(true);
    applyTrackDelta(a, readTiles(b, [tIdx(24, 64), tIdx(24, 65)]));
    expect(roadTierAt(a, 24, 64)).toBe(AVENUE_X);
    expect(avenuePartner(a, 24, 64)).toEqual([24, 65]);
    expect(avenueEdgeOk(a, 24, 64, 23, 64)).toBe(true);   // west follows travel NW
    expect(avenueEdgeOk(a, 24, 64, 25, 64)).toBe(false);  // …east does not
  });

  it("ROAD_TIER_KEYS carries avenue for the MP tier gate", async () => {
    const { ROAD_TIER_KEYS } = await import("../../src/iso/track");
    expect(ROAD_TIER_KEYS).toContain("avenue");
    expect(ROAD_TIER.avenue).toBe(AVENUE_X);
  });
});
