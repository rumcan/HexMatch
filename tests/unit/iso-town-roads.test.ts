// @vitest-environment jsdom
//
// PP-10 — towns get a simple road network at map generation:
//   * the RING: perimeter of the house bounding box expanded by one tile;
//   * the INTERIOR streets: the free tiles inside the box (the gaps the
//     BFS-grown cluster leaves between houses).
// The tiles are TOWN_OCC in `grid.occupancy` (town furniture: nobody may
// build on them) and are stamped PUBLIC_OWNER onto the road layer by
// `seedTownRoads` at game boot, so they ride the snapshot bytes to guests.
// RV-03: a town's ring road is a PUBLIC road — every player may drive on it,
// which is what makes a Depot beside a town serviceable and a route that runs
// over the town legal. A player still cannot BUILD on (or demolish) the town:
// the occupancy sentinel is what keeps the settlement a settlement.
//
// Invariants guarded here (measured over 436 generated towns before pinning):
//   * every town has >= 10 road tiles (observed minimum: 14);
//   * the network always touches the town (observed minimum: 7 road tiles
//     4-adjacent to a house);
//   * one dominant component (observed minimum: 70.6% of the town's tiles);
//   * the closed loop never encloses a buildable tile — the W8 "no
//     road-buildable enclaves" invariant the rival's factory search relies
//     on is preserved (the interior streets exist precisely to keep it).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  generateMap, GRASS, WATER, TOWN_OCC, townRoadTiles, idx, type Grid, type Town,
} from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/iso/config";
import {
  createTrack, seedTownRoads, hasTrack, bitsAt, buildRefusal, DIRS, DIR,
  OPPOSITE, PUBLIC_OWNER, playerNetwork, trackOwnedBy, tIdx, type Track,
} from "../../src/iso/track";
import { isServiced } from "../../src/iso/economy";
import { rivalSearchTiles, canReachASpot } from "./helpers/rival-map";

const SEEDS = [1337, 7, 42, 100, 1, 123, 2026, 0];

/** Axis-aligned box of a town's houses. */
function boxOf(t: Town) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [hx, hy] of t.houses) {
    x0 = Math.min(x0, hx); x1 = Math.max(x1, hx);
    y0 = Math.min(y0, hy); y1 = Math.max(y1, hy);
  }
  return { x0, x1, y0, y1 };
}

const DIR4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

describe("PP-10 town road network (map generation)", () => {
  it("gives every town a basic road network (>= 10 tiles) on the standard seeds", () => {
    for (const seed of SEEDS) {
      const g = generateMap(seed);
      expect(g.towns.length, `seed ${seed}`).toBe(4);
      for (const t of g.towns) {
        expect(t.roads.length, `seed ${seed} town ${t.id}`).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it("paves only free land and stamps every road tile with TOWN_OCC", () => {
    for (const seed of SEEDS) {
      const g = generateMap(seed);
      for (const t of g.towns) {
        for (const [rx, ry] of t.roads) {
          expect(rx, "in bounds x").toBeGreaterThanOrEqual(0);
          expect(ry, "in bounds y").toBeGreaterThanOrEqual(0);
          expect(rx, "in bounds x").toBeLessThan(MAP_W);
          expect(ry, "in bounds y").toBeLessThan(MAP_H);
          const i = idx(rx, ry);
          expect(g.terrain[i], `seed ${seed} road on water`).not.toBe(WATER);
          expect(g.occupancy[i], `seed ${seed} road tile not stamped`).toBe(TOWN_OCC);
        }
      }
    }
  });

  it("keeps every road tile in the town's own area (box interior or box+1 perimeter)", () => {
    for (const seed of SEEDS) {
      const g = generateMap(seed);
      for (const t of g.towns) {
        const { x0, x1, y0, y1 } = boxOf(t);
        for (const [rx, ry] of t.roads) {
          const inBox = rx >= x0 && rx <= x1 && ry >= y0 && ry <= y1;
          const onRing = (rx === x0 - 1 || rx === x1 + 1 || ry === y0 - 1 || ry === y1 + 1)
            && rx >= x0 - 1 && rx <= x1 + 1 && ry >= y0 - 1 && ry <= y1 + 1;
          expect(inBox || onRing, `seed ${seed} road (${rx},${ry}) outside the town area`).toBe(true);
        }
      }
    }
  });

  it("never overlaps: no road tile is a house, and no two towns share a tile", () => {
    for (const seed of SEEDS) {
      const g = generateMap(seed);
      const all = new Set<number>();
      for (const t of g.towns) {
        const houses = new Set(t.houses.map(([x, y]) => tIdx(x, y)));
        for (const [rx, ry] of t.roads) {
          const i = tIdx(rx, ry);
          expect(houses.has(i), "road on a house tile").toBe(false);
          expect(all.has(i), "tile shared by two towns").toBe(false);
          all.add(i);
          for (const [hx, hy] of t.houses) all.add(tIdx(hx, hy));
        }
      }
    }
  });

  it("connects to the town: >= 4 road tiles are 4-adjacent to a house", () => {
    for (const seed of SEEDS) {
      const g = generateMap(seed);
      for (const t of g.towns) {
        const houses = new Set(t.houses.map(([x, y]) => tIdx(x, y)));
        let touching = 0;
        for (const [rx, ry] of t.roads) {
          for (const [dx, dy] of DIR4) {
            if (houses.has(tIdx(rx + dx, ry + dy))) { touching++; break; }
          }
        }
        expect(touching, `seed ${seed} town ${t.id}`).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it("is one dominant component: the largest road run covers >= 50% of the tiles", () => {
    for (const seed of SEEDS) {
      const g = generateMap(seed);
      for (const t of g.towns) {
        const roadSet = new Set(t.roads.map(([x, y]) => tIdx(x, y)));
        const seen = new Set<number>();
        let largest = 0;
        for (const start of roadSet) {
          if (seen.has(start)) continue;
          const comp: number[] = [start];
          seen.add(start);
          for (let head = 0; head < comp.length; head++) {
            const cur = comp[head];
            const cx = cur % MAP_W, cy = Math.floor(cur / MAP_W);
            for (const [dx, dy] of DIR4) {
              const ni = tIdx(cx + dx, cy + dy);
              if (seen.has(ni) || !roadSet.has(ni)) continue;
              seen.add(ni); comp.push(ni);
            }
          }
          largest = Math.max(largest, comp.length);
        }
        expect(largest / t.roads.length, `seed ${seed} town ${t.id}`).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it("creates no buildable enclaves — the W8 invariant the rival search relies on", () => {
    // A town's ring is a closed loop of TOWN_OCC; if it enclosed any free
    // land, that pocket would be a road-buildable enclave with no harvester
    // spot. `canReachASpot` (the sweep's own probe) must stay true for the
    // whole rival search space.
    for (const seed of [1337, 7, 2024]) {
      const g = generateMap(seed);
      const enclaves = rivalSearchTiles(g).filter(([x, y]) => !canReachASpot(g, x, y));
      expect(enclaves, `seed ${seed} enclaves: ${enclaves.join(" | ")}`).toEqual([]);
    }
  });

  it("is deterministic: same seed → identical roads", () => {
    const a = generateMap(1337);
    const b = generateMap(1337);
    expect(a.towns).toEqual(b.towns);
    expect(a.occupancy).toEqual(b.occupancy);
  });
});

describe("PP-10 townRoadTiles (pure shape)", () => {
  /** A full grass map with a single 3×3 house box at (10..12, 10..12). */
  const solidBox = (): { terrain: Uint8Array; occ: Int16Array; houses: [number, number][] } => {
    const terrain = new Uint8Array(MAP_W * MAP_H).fill(GRASS);
    const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
    const houses: [number, number][] = [];
    for (let y = 10; y <= 12; y++) for (let x = 10; x <= 12; x++) houses.push([x, y]);
    return { terrain, occ, houses };
  };

  it("paves the box+1 perimeter (16 tiles) of a solid 3×3 cluster, never the houses", () => {
    const { terrain, occ, houses } = solidBox();
    const roads = townRoadTiles(houses, terrain, occ);
    // 5×5 perimeter = 2·3 + 2·3 + 4; the solid box leaves no interior gap.
    expect(roads).toHaveLength(16);
    for (const [x, y] of roads) {
      const onRing = x === 9 || x === 13 || y === 9 || y === 13;
      expect(onRing, `(${x},${y}) is not on the ring`).toBe(true);
      const isHouse = x >= 10 && x <= 12 && y >= 10 && y <= 12;
      expect(isHouse, `(${x},${y}) is a house tile`).toBe(false);
    }
  });

  it("paves the free gaps inside the box (the interior streets)", () => {
    const { terrain, occ, houses } = solidBox();
    const gap: [number, number] = [10, 11];
    houses.splice(houses.findIndex(([x, y]) => x === 10 && y === 11), 1);
    const roads = townRoadTiles(houses, terrain, occ);
    expect(roads).toContainEqual(gap);
  });

  it("skips water and occupied tiles on the ring", () => {
    const { terrain, occ, houses } = solidBox();
    terrain[idx(11, 9)] = WATER;      // water on the ring
    occ[idx(13, 11)] = 0;             // an industry tile on the ring
    const roads = townRoadTiles(houses, terrain, occ);
    // 16-ring minus the water and the occupied tile; interior is solid.
    expect(roads).toHaveLength(14);
    expect(roads.some(([x, y]) => x === 11 && y === 9)).toBe(false);
    expect(roads.some(([x, y]) => x === 13 && y === 11)).toBe(false);
  });
});

describe("PP-10 seedTownRoads (track wiring)", () => {
  const g = generateMap(1337);

  it("paves exactly the towns' road tiles, public (PUBLIC_OWNER)", () => {
    const track = createTrack();
    seedTownRoads(track, g);
    let count = 0;
    for (let i = 0; i < track.road.length; i++) {
      if (track.road[i] !== 0) {
        count++;
        // RV-03: town roads ride the public owner id, so a player's network
        // can drive them (and a depot beside one is serviced).
        expect(track.owner[i], `tile ${i} not public`).toBe(PUBLIC_OWNER);
      }
    }
    const expected = g.towns.reduce((n, t) => n + t.roads.length, 0);
    expect(count).toBe(expected);
    for (const t of g.towns) {
      for (const [rx, ry] of t.roads) expect(hasTrack(track, "road", rx, ry)).toBe(true);
    }
  });

  it("leaves mutually consistent autotile masks between adjacent town roads", () => {
    const track = createTrack();
    seedTownRoads(track, g);
    for (const t of g.towns) {
      for (const [rx, ry] of t.roads) {
        const bits = bitsAt(track, "road", rx, ry);
        for (const d of DIRS) {
          const nx = rx + DIR[d][0], ny = ry + DIR[d][1];
          const neighbourHas = hasTrack(track, "road", nx, ny);
          const neighbourFaces = neighbourHas && (bitsAt(track, "road", nx, ny) & OPPOSITE[d]) !== 0;
          if (neighbourHas && (bits & d) !== 0) {
            // our bit is set only when the neighbour has track — and masks
            // are recomputed mutually, so the neighbour must face back.
            expect(neighbourFaces, `(${rx},${ry}) bit ${d} not mirrored`).toBe(true);
          }
        }
      }
    }
  });

  it("town roads refuse player builds — 'occupied', like the town itself", () => {
    for (const t of g.towns) {
      for (const [rx, ry] of t.roads) {
        expect(buildRefusal(g, "road", rx, ry)).toBe("occupied");
        expect(buildRefusal(g, "dirt", rx, ry)).toBe("occupied");
      }
    }
  });

  it("services a depot beside it and joins a player's network (public roads)", () => {
    const track = createTrack();
    seedTownRoads(track, g);
    // RV-03: a town's ring road is PUBLIC — a depot parked beside it is
    // serviced, and the town road joins the player's network so the depot can
    // route to a factory over the settlement. Walk the ring until a buildable
    // neighbour turns up and assert the public behaviour for every such depot.
    let probed = 0;
    for (const t of g.towns) {
      for (const [tx, ty] of t.roads) {
        for (const [dx, dy] of DIR4) {
          const hx = tx + dx, hy = ty + dy;
          if (buildRefusal(g, "road", hx, hy) !== null) continue;
          expect(
            isServiced(track, { id: 99, owner: "you", ownerId: 1, tx: hx, ty: hy }),
            `a public town road must service a depot at (${hx},${hy})`,
          ).toBe(true);
          const net = playerNetwork(track, 1, [{ ownerId: 1, tx: hx, ty: hy }], []);
          expect(
            net.has(tIdx(tx, ty)),
            `a public town road must join the player network at (${tx},${ty})`,
          ).toBe(true);
          probed++;
        }
      }
    }
    expect(probed, "no town road had a buildable neighbour to probe").toBeGreaterThan(0);

    // …but the town road is still NOT owned by the player, so it can never be
    // demolished or claimed (only driven on).
    const [tx0, ty0] = g.towns[0].roads[0];
    expect(track.owner[tIdx(tx0, ty0)]).toBe(PUBLIC_OWNER);
    expect(trackOwnedBy(track, 1, tx0, ty0)).toBe(false);
  });
});

// ── boot integration: the live game stamps the town roads at start ────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

describe("PP-10 game boot stamps the town roads", () => {
  let root: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    const ctx = new Proxy({}, {
      get: (_t, prop) => {
        if (prop === "canvas") return null;
        if (prop === "imageSmoothingEnabled") return false;
        if (prop === "getImageData") {
          return (_x: number, _y: number, w: number, h: number) =>
            ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
        }
        return () => undefined;
      },
      set: () => true,
    });
    HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
    class FakeImage {
      width = 1024; height = 1024;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    (globalThis as Record<string, unknown>).Image = FakeImage;
    window.history.replaceState(null, "", "/?seed=1337");
  // AI-02: a remembered difficulty keeps the start-of-game picker out of
  // the DOM — these tests boot the game, not its onboarding (the picker
  // itself is covered in iso-skill-picker.test.ts).
  localStorage.setItem("hexmatch:rival-skill", "normal");
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    };
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    dispose?.();
    root?.remove();
    document.body.innerHTML = "";
  });

  it("stamps every town's ring road onto the live track, public", async () => {
    const { startIsoGame } = await import("../../src/iso/game");
    const { setRng, mulberry32 } = await import("../../src/game/config");
    setRng(mulberry32(1337));
    dispose = startIsoGame(root);
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
    const h = (window as unknown as {
      __iso: { grid: Grid; track: Track };
    }).__iso;
    let count = 0;
    for (const t of h.grid.towns) {
      for (const [rx, ry] of t.roads) {
        expect(hasTrack(h.track, "road", rx, ry), `boot miss (${rx},${ry})`).toBe(true);
        expect(h.track.owner[tIdx(rx, ry)], `town road (${rx},${ry}) not public`)
          .toBe(PUBLIC_OWNER);
        count++;
      }
    }
    // PP-13/RV-03: the inter-town highways stand at boot too — stamped the same
    // PUBLIC_OWNER the town rings now carry, so both kinds of map road are
    // every player's to drive on (they differ only in grid.occupancy).
    let pub = 0;
    for (const [rx, ry] of h.grid.publicRoads ?? []) {
      expect(hasTrack(h.track, "road", rx, ry), `boot miss highway (${rx},${ry})`).toBe(true);
      expect(h.track.owner[tIdx(rx, ry)], `highway (${rx},${ry}) not public`).toBe(PUBLIC_OWNER);
      pub++;
    }
    // nothing besides the town roads and the public highways may be on the
    // road layer at boot
    let onLayer = 0;
    for (let i = 0; i < h.track.road.length; i++) if (h.track.road[i] !== 0) onLayer++;
    expect(onLayer).toBe(count + pub);
    expect(count).toBeGreaterThan(0);
    expect(pub).toBeGreaterThan(0);
  }, 20000);
});
