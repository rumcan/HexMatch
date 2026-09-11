// ══════════════════════════════════════════════════════════════════════════
// PP-15 — a road joins a plant at ANY edge of its graphic, and the ground the
// building itself stands on is free.
//
// The report was blunt: "fix where road connect to processing plants. it
// should be on the edge of the graphic. right now you have to build the road
// into some weird spot inside." Both halves are the same mistake. A Factory is
// ONE sprite over `FACTORY_FOOTPRINT` (3×3 tiles, anchored so the art covers
// the whole block), but every rule that asked "does this road touch the plant?"
// asked it about the footprint's ORIGIN tile only. The origin is the block's
// north-west corner — under the graphic, at the BACK of the building from the
// player's point of view — so the only legal place to plug in was a tile nobody
// could see, and a road that visibly touched the factory's south wall was
// "unconnected".
//
// So the footprint is now the unit of everything:
//   * `playerNetwork` seeds all nine tiles (a drag may start on the building
//     and reach any side of it);
//   * `economy.resolveConnection` and `plantShoulders` ask about all nine
//     tiles' edges, so the economy and the lorry agree with the picture;
//   * `previewDrag` steps over the builder's own building tiles without paying
//     for them — a road may run out from under a plant, but nobody paves (or
//     pays for) their own factory's floor, and the free setup allowance is
//     measured in tiles of ROAD.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { MAP_W, MAP_H } from "../../src/iso/config";
import { GRASS, type Grid } from "../../src/iso/grid";
import {
  createTrack, buildTile, hasTrack, tIdx, previewDrag, commitDrag,
  playerNetwork, plantFootprintTiles, structureTiles, canBuildOn,
} from "../../src/iso/track";
import { plantShoulders } from "../../src/iso/road-routing";

/** The setup budget the drag is priced against (`FREE_SETUP_TRACK` in game.ts,
 *  read here as a constant so the arithmetic under test is visible). */
const FREE_SETUP_TRACK = 12;
import {
  buildAllComponents, resolveConnection, sharedComponents,
  type EconomyState, type Factory, type Harvester,
} from "../../src/iso/economy";
import { roadRouteForHarvester } from "../../src/iso/vehicles";

function flatGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 1,
  };
}

const pave = (t: ReturnType<typeof createTrack>, owner: number, pts: [number, number][]) => {
  for (const [x, y] of pts) buildTile(t, "dirt", x, y, owner);
};

const plant = (tx: number, ty: number, ownerId = 1, owner = "you"): Factory =>
  ({ owner, ownerId, tx, ty });
const depot = (tx: number, ty: number, ownerId = 1, owner = "you"): Harvester =>
  ({ id: 1, owner, ownerId, tx, ty });

const PLANT: [number, number] = [10, 10];
const FOOT = plantFootprintTiles(PLANT[0], PLANT[1]);

describe("PP-15 the footprint is the unit of the network", () => {
  it("every tile of the block is network ground, and one tile beyond is not", () => {
    const t = createTrack();
    const net = playerNetwork(t, 1, [plant(...PLANT)], []);
    for (const [x, y] of FOOT) expect(net.has(tIdx(x, y)), `${x},${y}`).toBe(true);
    // the block is 3×3: its east frontage is (13,10)…(13,12), one past it is out
    expect(net.has(tIdx(13, 10))).toBe(false);
    // a rival's building never seeds your network
    expect(playerNetwork(t, 2, [plant(...PLANT)], []).has(tIdx(11, 11))).toBe(false);
  });

  it("any side of the building is legal ground to extend onto", () => {
    const grid = flatGrid();
    const net = playerNetwork(createTrack(), 1, [plant(...PLANT)], []);
    // north, east, south and west frontage — all of them accept a new tile
    for (const [x, y] of [[11, 9], [13, 11], [11, 13], [9, 11]]) {
      expect(canBuildOn(grid, "dirt", x, y, net), `${x},${y}`).toBe(true);
    }
    // and two tiles out, with no road to stand on, is not
    expect(canBuildOn(grid, "dirt", 14, 11, net)).toBe(false);
  });

  it("plantShoulders is the block's whole perimeter, deduplicated", () => {
    const t = createTrack();
    // a road on every side, so each side must appear exactly once
    const ring = [
      [11, 9], [12, 9], [13, 9],        // north (also a corner neighbour of 13,10)
      [13, 10], [13, 11], [13, 12],     // east
      [11, 13], [12, 13],               // south
      [9, 11], [10, 12],                // west (10,12 is a footprint tile → never)
    ] as [number, number][];
    pave(t, 1, ring.filter(([x, y]) => !FOOT.some(([fx, fy]) => fx === x && fy === y)));
    const got = plantShoulders(t, 1, PLANT[0], PLANT[1]);
    const keys = got.map(([x, y]) => `${x},${y}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["11,9", "13,10", "13,12", "11,13", "9,11"]) {
      expect(keys, `${k} is frontage`).toContain(k);
    }
    // the block's own tiles are never their own shoulders
    for (const [x, y] of FOOT) expect(keys).not.toContain(`${x},${y}`);
  });
});

describe("PP-15 the economy reads the edge, not the corner", () => {
  const world = (h: Harvester, factories: Factory[]) => {
    const grid = flatGrid();
    const track = createTrack();
    // a spur running EAST into the block's side: nothing here touches the
    // origin tile (10,10) except the block itself
    pave(track, 1, [[13, 11], [14, 11], [15, 11], [16, 11], [17, 11], [18, 11], [19, 11]]);
    return { grid, track, eco: { grid, track, harvesters: [h], factories } as EconomyState };
  };

  it("a depot joined to the far side of the plant is connected", () => {
    const h = depot(20, 11);
    const { track, eco } = world(h, [plant(...PLANT)]);
    const comp = buildAllComponents(track, 1);
    const conn = resolveConnection(eco, comp, h);
    expect(conn.kind).toBe("dirt");
    expect(conn.factory).toEqual(plant(...PLANT));
    // …and this is precisely the case the origin-tile rule refused: the depot's
    // component touches no neighbour of (10,10), so the OLD test said "not
    // shared". Pinned so nobody re-narrows the rule by accident.
    expect(sharedComponents(comp.comp, h.tx, h.ty, PLANT[0], PLANT[1]).size).toBe(0);
  });

  it("the lorry pulls up at the side of the building the road joins", () => {
    const h = depot(20, 11);
    const { track, eco } = world(h, [plant(...PLANT)]);
    const route = roadRouteForHarvester(eco, h);
    expect(route).not.toBeNull();
    const last = route![route!.length - 1];
    // the near end of the block, not the far corner: (12,11) is the footprint
    // tile the route stops beside…
    expect(last).toEqual([13, 11]);
    expect(plantShoulders(track, 1, PLANT[0], PLANT[1]).some(([x, y]) => x === last[0] && y === last[1]))
      .toBe(true);
    // …and the drive never has to reach (10,10) at all
    expect(route!.some(([x, y]) => x === 10 && y === 10)).toBe(false);
  });
});

describe("PP-15 your own building's ground costs nothing", () => {
  // the builder's own ground: the block plus the Depot the drag ends on
  const MINE = structureTiles([plant(...PLANT, 1)], [depot(14, 12, 1)], 1);
  const drag = (mode: "mine" | "old" = "mine") => {
    const grid = flatGrid();
    const track = createTrack();
    const net = playerNetwork(track, 1, [plant(...PLANT)], [depot(14, 12)]);
    const pv = previewDrag(grid, track, "dirt", { stone: 99 },
      10, 10, 14, 12, true, net, FREE_SETUP_TRACK, mode === "mine" ? MINE : undefined);
    return { track, pv };
  };

  it("the path runs under the plant, and lays nothing there", () => {
    const { pv } = drag();
    // east across the block then south out of it: (10,10)…(12,10) are the
    // building's own floor and (14,12) is the Depot's, so only the three tiles
    // between them are road
    expect(pv.tiles.map(([x, y]) => `${x},${y}`))
      .toEqual(["13,10", "14,10", "14,11"]);
    expect(pv.truncated).toBe(false);
    expect(pv.cost).toEqual({});
    // the allowance is spent on ROAD: three tiles, not the seven of the path
    expect(pv.free).toBe(3);
  });

  it("what is previewed is what is built", () => {
    const { track, pv } = drag();
    commitDrag(track, "dirt", pv, 1);
    for (const [x, y] of [[13, 10], [14, 10], [14, 11]]) {
      expect(hasTrack(track, "dirt", x, y), `${x},${y}`).toBe(true);
    }
    // under the building — and under the Depot the drag ended on: previewed
    // over, never built. A depot is serviced by the road BESIDE it, so paving
    // its own tile would have been a tile of the allowance spent on nothing.
    for (const [x, y] of [[10, 10], [11, 10], [12, 10], [14, 12]]) {
      expect(hasTrack(track, "dirt", x, y), `${x},${y}`).toBe(false);
    }
  });

  it("without the structure set those tiles are paid for (the old cost)", () => {
    const { pv } = drag("old");
    expect(pv.tiles).toHaveLength(7);
    expect(pv.free).toBe(7);
  });

  it("structureTiles is per owner — a rival's floor is not free ground", () => {
    const mine = structureTiles([plant(...PLANT, 1)], [depot(20, 20, 1)], 1);
    expect(mine.size).toBe(FOOT.length + 1);           // block + the depot tile
    expect(mine.has(tIdx(20, 20))).toBe(true);
    expect(structureTiles([plant(...PLANT, 2)], [], 1).size).toBe(0);
  });
});
