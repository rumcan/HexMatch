// ══════════════════════════════════════════════════════════════════════════
// RV-01 — road vehicles: the little TTD goods lorry that proves a network.
//
// When a Depot reaches a Factory by ROAD the game now sends a truck down the
// exact tile route the connection flood found — and drives it up and down,
// depot → factory → depot, for as long as the connection stands. The truck is
// pure presentation: it changes no economy outcome, it SHOWS the route the
// economy already scores (which is why it must find the same route the flood
// does, public highways included).
//
// Pinned here:
//   * `roadPath` walks the same graph `economy.buildComponents` floods —
//     trackOpenTo tiles (own + public, never the rival's), mutual direction
//     bits only — but returns the actual tile route;
//   * `planTrucks` turns a serviced depot's road connection into one truck
//     per player, and refuses rail-only connections and unserviced depots;
//   * `tickTrucks` drives the route and reflects at both ends (ping-pong);
//   * the draw item carries a FRACTIONAL tile position and the right
//     directional TTD sprite, depth-sorts by the rounded tile, and is never
//     pickable (a truck is not a clickable thing);
//   * the atlas ships the four OpenGFX lorry views (2nd-gen goods truck,
//     spr3132 in base-3092-road-vehicles.pnml).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateMap, idx, inBounds, WATER, type Grid,
} from "../../src/iso/grid";
import {
  createTrack, seedTownRoads, seedPublicRoads, buildTile, bitsAt, hasTrack,
  trackOpenTo, isPublicRoad, PUBLIC_OWNER, NE, SE, SW, NW, OPPOSITE, tIdx,
  PRESENT, DIRS, DIR, type Track,
} from "../../src/iso/track";
import { MAP_H, MAP_W } from "../../src/iso/config";
import type { EconomyState, Factory, Harvester } from "../../src/iso/economy";
import {
  place, pickSprite,
} from "../../src/iso/depth";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { HW, HH, TILE_H, tileToScreen } from "../../src/game/config";
import {
  TRUCK_SPEED, createTruckState, roadPath, planTrucks, tickTrucks, truckItems,
  type Truck,
} from "../../src/iso/vehicles";

const manifest: Manifest = JSON.parse(
  readFileSync("assets/iso-atlas/manifest.json", "utf8"),
);
const atlas = new Atlas(manifest);
const DIR4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** A 1-tile-every-600ms lorry: easy numbers to tick against. */
const TICK = 1 / TRUCK_SPEED; // ms per tile (600)

/** Lay a run of road tiles, each stamped `owner`, autotiled. */
function pave(t: Track, owner: number, tiles: [number, number][]) {
  for (const [x, y] of tiles) buildTile(t, "road", x, y, owner);
}

// ── the atlas ships the truck ─────────────────────────────────────────────
describe("RV-01 atlas: the TTD goods lorry", () => {
  it("packs all four OpenGFX lorry views at 1×1 footprint", () => {
    for (const view of ["ne", "se", "sw", "nw"] as const) {
      const name = `truck_goods_${view}`;
      const def = atlas.get(name);
      expect(def, `${name} missing from the manifest`).toBeTruthy();
      expect(def!.footprint).toEqual([1, 1]);
      // the pnml template cell is 20px wide for every diagonal view (a row
      // may trim transparent); the art must stay a small vehicle, and it is
      // flagged `moving` so the manifest validator exempts the small-art rule
      expect(def!.w).toBeGreaterThanOrEqual(16);
      expect(def!.w).toBeLessThanOrEqual(20);
      expect(def!.h).toBeGreaterThanOrEqual(12);
      expect(def!.frames ?? 1).toBe(1);
      expect((def as unknown as { moving?: boolean }).moving).toBe(true);
    }
  });

  it("anchors each view at its ground contact (bottom-centre of the art)", () => {
    for (const view of ["ne", "se", "sw", "nw"] as const) {
      const def = atlas.get(`truck_goods_${view}`)!;
      expect(def.anchor[0]).toBe(Math.floor(def.w / 2));
      expect(def.anchor[1]).toBe(def.h - 1);
    }
  });
});

// ── roadPath: the route finder ────────────────────────────────────────────
describe("RV-01 roadPath", () => {
  /** depot—A—P1—P2—B—factory along one row; P tiles are the public highway. */
  function highwayFixture(aOwner: number, pOwner: number, bOwner: number) {
    const t = createTrack();
    pave(t, aOwner, [[2, 10]]);
    pave(t, pOwner, [[3, 10], [4, 10]]);
    pave(t, bOwner, [[5, 10]]);
    return t;
  }

  it("routes a player over a public highway between its own two tiles", () => {
    const t = highwayFixture(1, PUBLIC_OWNER, 1);
    expect(roadPath(t, 1, [[2, 10]], new Set([idx(5, 10)]))).toEqual([
      [2, 10], [3, 10], [4, 10], [5, 10],
    ]);
  });

  it("never routes across the rival's track", () => {
    const t = highwayFixture(1, 2, 1); // the middle stretch is the rival's
    expect(roadPath(t, 1, [[2, 10]], new Set([idx(5, 10)]))).toBeNull();
    // the rival, though, drives its own stretch fine
    expect(roadPath(t, 2, [[3, 10]], new Set([idx(4, 10)]))).toEqual([
      [3, 10], [4, 10],
    ]);
  });

  it("respects mutual direction bits (a half-connected tile is not a road)", () => {
    const t = highwayFixture(1, PUBLIC_OWNER, 1);
    // cut P1's facing bit: present, but it no longer agrees with A
    t.road[tIdx(3, 10)] = PRESENT;
    expect(roadPath(t, 1, [[2, 10]], new Set([idx(5, 10)]))).toBeNull();
  });

  it("starts and ends on the given tiles (a start tile may be the goal)", () => {
    const t = highwayFixture(1, PUBLIC_OWNER, 1);
    expect(roadPath(t, 1, [[5, 10]], new Set([idx(5, 10)]))).toEqual([[5, 10]]);
    expect(roadPath(t, 1, [], new Set([idx(5, 10)]))).toBeNull();
  });
});

// ── planTrucks: connection → truck ────────────────────────────────────────
describe("RV-01 planTrucks", () => {
  /**
   * seed 1337: two far-apart highway shoulders on the SAME player-drivable
   * component. The highway chains meet only through town ring roads, which
   * are furniture (owner 0) a player cannot drive — so the fixture floods
   * the drivable graph exactly like the economy does and picks one chain.
   */
  function highwayEnds(g: Grid, track: Track): {
    depot: [number, number]; factory: [number, number];
    roadA: [number, number]; roadB: [number, number];
  } {
    const roads = g.publicRoads ?? [];
    const free = (tx: number, ty: number) =>
      inBounds(tx, ty) && g.terrain[idx(tx, ty)] !== WATER
      && g.occupancy[idx(tx, ty)] === -1
      && !hasTrack(track, "road", tx, ty) && !hasTrack(track, "rail", tx, ty);
    // flood one drivable public component (mutual bits, owner 1's eyes)
    const seen = new Set<number>();
    const start = tIdx(roads[0][0], roads[0][1]);
    seen.add(start);
    for (const queue = [start]; queue.length;) {
      const i = queue.pop()!;
      const x = i % 144, y = (i / 144) | 0;
      for (const d of DIRS) {
        if (!(bitsAt(track, "road", x, y) & d)) continue;
        const nx = x + DIR[d][0], ny = y + DIR[d][1];
        if (!(bitsAt(track, "road", nx, ny) & OPPOSITE[d])) continue;
        const ni = tIdx(nx, ny);
        if (seen.has(ni) || !trackOpenTo(track, 1, nx, ny)) continue;
        seen.add(ni);
        queue.push(ni);
      }
    }
    const chain = [...seen].map((i) => [i % MAP_W, (i / MAP_W) | 0] as [number, number]);
    const spots: [number, number, number, number][] = [];
    for (const [rx, ry] of chain) {
      for (const [dx, dy] of DIR4) {
        if (free(rx + dx, ry + dy)) spots.push([rx, ry, rx + dx, ry + dy]);
      }
    }
    expect(spots.length, "the highway needs usable shoulders").toBeGreaterThan(1);
    // one end, then the shoulder farthest from it — a long run of highway
    const a = spots[0];
    let b = spots[spots.length - 1];
    for (const s of spots) {
      if (Math.abs(s[0] - a[0]) + Math.abs(s[1] - a[1])
        > Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])) b = s;
    }
    return {
      roadA: [a[0], a[1]], depot: [a[2], a[3]],
      roadB: [b[0], b[1]], factory: [b[2], b[3]],
    };
  }

  function eco(
    g: Grid, track: Track, harvesters: Harvester[], factories: Factory[],
  ): EconomyState {
    return { grid: g, track, harvesters, factories };
  }

  it("drives depot → factory with NO player road at all — the highway is the route", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    const { depot, factory } = highwayEnds(g, track);

    const trucks = planTrucks(eco(g, track,
      [{ id: 1, owner: "you", ownerId: 1, tx: depot[0], ty: depot[1] }],
      [{ owner: "you", ownerId: 1, tx: factory[0], ty: factory[1] }],
    ));
    expect(trucks.length).toBe(1);
    const route = trucks[0].route;
    expect(route.length, "the route uses the highway, not teleporting")
      .toBeGreaterThan(2);

    // the ends: depot-side first, factory-side last
    const manh = (a: [number, number], b: [number, number]) =>
      Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    expect(manh(route[0], depot)).toBe(1);
    expect(manh(route[route.length - 1], factory)).toBe(1);

    // every tile is drivable by owner 1, mutually connected, and at least one
    // tile is a PUBLIC highway — the shared road is doing the joining
    let publicTiles = 0;
    for (let k = 0; k < route.length; k++) {
      const [x, y] = route[k];
      expect(trackOpenTo(track, 1, x, y), `route tile ${k} not open to owner 1`).toBe(true);
      if (isPublicRoad(track, x, y)) publicTiles++;
      if (k > 0) {
        const [px, py] = route[k - 1];
        const d = Math.abs(px - x) + Math.abs(py - y);
        expect(d, `route break before tile ${k}`).toBe(1);
        const bit = d === 1
          ? (px < x ? SE : px > x ? NW : py < y ? SW : NE)
          : 0;
        expect(bitsAt(track, "road", px, py) & bit, `no facing bit out of ${k - 1}`).not.toBe(0);
        expect(bitsAt(track, "road", x, y) & OPPOSITE[bit], `no facing bit into ${k}`).not.toBe(0);
      }
    }
    expect(publicTiles, "the route never touches the public highway").toBeGreaterThan(0);
  });

  it("shares the highway: both players get their own truck over the same tiles", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    const { depot, factory } = highwayEnds(g, track);

    const trucks = planTrucks(eco(g, track, [
      { id: 1, owner: "you", ownerId: 1, tx: depot[0], ty: depot[1] },
      { id: 2, owner: "ai", ownerId: 2, tx: depot[0], ty: depot[1] },
    ], [
      { owner: "you", ownerId: 1, tx: factory[0], ty: factory[1] },
      { owner: "ai", ownerId: 2, tx: factory[0], ty: factory[1] },
    ]));
    expect(trucks.length).toBe(2);
    expect(trucks[0].ownerId).toBe(1);
    expect(trucks[1].ownerId).toBe(2);
    // both drive the same shared highway
    const mine = new Set(trucks[0].route.map(([x, y]) => tIdx(x, y)));
    expect(trucks[1].route.some(([x, y]) => mine.has(tIdx(x, y)))).toBe(true);
  });

  it("drives the player's OWN road when that is the connection", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    pave(track, 1, [[10, 10], [10, 11], [10, 12]]);

    const trucks = planTrucks(eco(g, track,
      [{ id: 1, owner: "you", ownerId: 1, tx: 10, ty: 9 }],
      [{ owner: "you", ownerId: 1, tx: 10, ty: 13 }],
    ));
    expect(trucks.length).toBe(1);
    expect(trucks[0].route).toEqual([[10, 10], [10, 11], [10, 12]]);
  });

  it("sends no truck to an unserviced depot or a rail-only connection", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);

    // a land tile none of whose neighbours carry drivable road for owner 1
    const roadless = (): [number, number] => {
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (g.terrain[idx(x, y)] === WATER || g.occupancy[idx(x, y)] !== -1) continue;
          if (DIR4.every(([dx, dy]) => !trackOpenTo(track, 1, x + dx, y + dy))) {
            return [x, y];
          }
        }
      }
      throw new Error("no roadless tile");
    };
    const [dx0, dy0] = roadless();
    const [fx0, fy0] = roadless();
    expect(planTrucks(eco(g, track,
      [{ id: 1, owner: "you", ownerId: 1, tx: dx0, ty: dy0 }],
      [{ owner: "you", ownerId: 1, tx: fx0, ty: fy0 }],
    ))).toEqual([]);

    // rail-connected: trains are not this ticket. Same corridor, both layers,
    // so `resolveConnection` answers "rail" and the lorry stays in the depot.
    pave(track, 1, [[10, 10], [10, 11], [10, 12]]);
    for (const [x, y] of [[10, 10], [10, 11], [10, 12]] as [number, number][]) {
      buildTile(track, "rail", x, y, 1);
    }
    expect(planTrucks(eco(g, track,
      [{ id: 1, owner: "you", ownerId: 1, tx: 10, ty: 9 }],
      [{ owner: "you", ownerId: 1, tx: 10, ty: 13 }],
    ))).toEqual([]);
  });

  it("is stable: the first connected depot in network order wins", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    pave(track, 1, [[10, 10], [10, 11], [10, 12]]);
    pave(track, 1, [[20, 10], [20, 11], [20, 12]]);

    const trucks = planTrucks(eco(g, track, [
      { id: 7, owner: "you", ownerId: 1, tx: 20, ty: 9 },
      { id: 3, owner: "you", ownerId: 1, tx: 10, ty: 9 },
    ], [{ owner: "you", ownerId: 1, tx: 10, ty: 13 }]));
    expect(trucks.length).toBe(1);
    expect(trucks[0].route[0]).toEqual([10, 10]); // harvester id 3 sorts first
  });
});

// ── tickTrucks: drive up … and back down ──────────────────────────────────
describe("RV-01 tickTrucks ping-pong", () => {
  const truck = (): Truck => ({
    ownerId: 1, route: [[0, 0], [1, 0], [2, 0]], leg: 0, t: 0, reverse: false,
  });

  it("advances half a tile per half-tile tick", () => {
    const state = createTruckState();
    state.trucks.push(truck());
    tickTrucks(state, TICK / 2);
    expect(state.trucks[0].leg).toBe(0);
    expect(state.trucks[0].t).toBeCloseTo(0.5);
    expect(state.trucks[0].reverse).toBe(false);
  });

  it("reflects at the factory end and drives back", () => {
    const state = createTruckState();
    state.trucks.push(truck());
    tickTrucks(state, TICK * 1.5);            // halfway down leg 1
    expect(state.trucks[0].leg).toBe(1);
    expect(state.trucks[0].reverse).toBe(false);
    tickTrucks(state, TICK);                  // hit the end, come back one
    expect(state.trucks[0].reverse).toBe(true);
    expect(state.trucks[0].leg).toBe(1);
    expect(state.trucks[0].t).toBeCloseTo(0.5);
  });

  it("reflects at the depot end too, forever", () => {
    const state = createTruckState();
    state.trucks.push(truck());
    tickTrucks(state, TICK * 2.5);            // to the far end and half back
    expect(state.trucks[0].reverse).toBe(true);
    tickTrucks(state, TICK * 3);              // back past the depot, out again
    expect(state.trucks[0].reverse).toBe(false);
    expect(state.trucks[0].leg + state.trucks[0].t).toBeGreaterThan(0);
    expect(state.trucks[0].leg).toBeLessThan(2);
  });

  it("holds still on a one-tile route and ignores non-positive ticks", () => {
    const state = createTruckState();
    state.trucks.push({ ownerId: 1, route: [[4, 4]], leg: 0, t: 0, reverse: false });
    tickTrucks(state, TICK * 10);
    expect(state.trucks[0]).toMatchObject({ leg: 0, t: 0, reverse: false });
    tickTrucks(state, 0);
    tickTrucks(state, -5);
    expect(state.trucks[0]).toMatchObject({ leg: 0, t: 0, reverse: false });
  });
});

// ── drawing: fractional tile, right sprite, never pickable ────────────────
describe("RV-01 truck draw items", () => {
  const items = (t: Truck) => truckItems({ trucks: [t] });

  it("interpolates between tile centres and names the travel direction", () => {
    const t: Truck = {
      ownerId: 1, route: [[3, 10], [4, 10]], leg: 0, t: 0.5, reverse: false,
    };
    const [item] = items(t);
    expect(item.sprite).toBe("truck_goods_se");           // (+1, 0) → SE view
    expect(item.fx).toBe(3.5);
    expect(item.fy).toBe(10);
    expect(item.tx).toBe(4);                              // rounded, for culling
    expect(item.ty).toBe(10);
    expect(item.ref).toBeUndefined();
  });

  it("flips the sprite when driving the other way", () => {
    const t: Truck = {
      ownerId: 1, route: [[3, 10], [4, 10]], leg: 0, t: 0.5, reverse: true,
    };
    expect(items(t)[0].sprite).toBe("truck_goods_nw");    // (-1, 0) → NW view
    const y: Truck = {
      ownerId: 1, route: [[3, 10], [3, 11]], leg: 0, t: 0, reverse: false,
    };
    expect(items(y)[0].sprite).toBe("truck_goods_sw");    // (0, +1) → SW view
    const up: Truck = {
      ownerId: 1, route: [[3, 11], [3, 10]], leg: 0, t: 0, reverse: false,
    };
    expect(items(up)[0].sprite).toBe("truck_goods_ne");   // (0, -1) → NE view
  });

  it("places a moving sprite by the FRACTIONAL tile's centre, not a south corner", () => {
    const p = place(atlas, {
      sprite: "truck_goods_se", tx: 3, ty: 10, fx: 3.5, fy: 10,
    });
    expect(p).toBeTruthy();
    const def = atlas.get("truck_goods_se")!;
    const [vx, vy] = tileToScreen(3.5, 10);               // diamond top vertex
    expect(p!.wx + def.anchor[0]).toBe(vx + HW);          // anchor → centre
    expect(p!.wy + def.anchor[1]).toBe(vy + HH);
    // static sprites still anchor the old way (south corner)
    const q = place(atlas, { sprite: "depot_blue", tx: 3, ty: 10 })!;
    const [sx, sy] = tileToScreen(3, 10);
    expect(q.wx + q.def.anchor[0]).toBe(sx + HW);
    expect(q.wy + q.def.anchor[1]).toBe(sy + TILE_H);
  });

  it("depth-keys a moving sprite by its rounded tile", () => {
    const before = place(atlas, {
      sprite: "truck_goods_se", tx: 3, ty: 10, fx: 3.4, fy: 10,
    })!;
    const after = place(atlas, {
      sprite: "truck_goods_se", tx: 3, ty: 10, fx: 3.6, fy: 10,
    })!;
    expect(before.key).toBe(3 + 10);
    expect(after.key).toBe(4 + 10);
  });

  it("is never pickable — clicks fall through a truck to the map", () => {
    const truck = place(atlas, {
      sprite: "truck_goods_se", tx: 3, ty: 10, fx: 3, fy: 10,
    })!;
    expect(pickSprite(atlas, [truck], truck.wx + 1, truck.wy + 1)).toBeNull();
    // …while a real structure at the same spot still picks
    const depot = place(atlas, { sprite: "depot_blue", tx: 3, ty: 10 })!;
    expect(pickSprite(atlas, [truck, depot], depot.wx + 1, depot.wy + 1))
      .toBe(depot);
  });
});
