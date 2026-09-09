// ══════════════════════════════════════════════════════════════════════════
// PP-13 — public roads: the seed-generated highways that connect the towns,
// and the rule that makes them worth having — every player may drive on them.
//
// Two halves, because they fail differently:
//   * GENERATION (`publicRoadTiles`): a minimum spanning tree over the town
//     centres, each edge paved with the shortest drivable route between the
//     two towns' own road networks. Deterministic, legal ground only, and it
//     leaves a town's own ring road alone (neutral ownership, not adopted).
//   * USE (`trackOpenTo` and everything that floods through it): a public tile
//     joins a real player's network, services a depot beside it, and links two
//     structures that never laid a tile between them. It never lets one player
//     cross the OTHER's track — asserted here so the feature cannot quietly
//     unwind W2. RV-03: a town's ring road is PUBLIC too (same PUBLIC_OWNER
//     id), so a depot beside a town is serviced exactly like one beside a
//     highway; the two differ only in `grid.occupancy` (a town road is
//     TOWN_OCC and can never be built on).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  generateMap, publicRoadTiles, idx, inBounds, WATER, type Grid,
} from "../../src/iso/grid";
import { MAP_W } from "../../src/iso/config";
import {
  createTrack, seedTownRoads, seedPublicRoads, buildTile, hasTrack, bitsAt,
  trackOwnedBy, trackOpenTo, isPublicRoad, ownerAt, playerNetwork, tIdx,
  previewDrag, commitDrag, PUBLIC_OWNER, DIRS, DIR, OPPOSITE,
} from "../../src/iso/track";
import { isServiced, buildAllComponents, linkedBy } from "../../src/iso/economy";

const SEEDS = [1337, 7, 42, 79, 100, 1, 123, 2026, 0, 2024];
const DIR4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** 4-connected flood over a tile set. */
function components(set: Set<number>): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const start of set) {
    if (seen.has(start)) continue;
    const comp = [start];
    seen.add(start);
    for (let head = 0; head < comp.length; head++) {
      const cur = comp[head];
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of DIR4) {
        const ni = idx(x + dx, y + dy);
        if (!set.has(ni) || seen.has(ni)) continue;
        seen.add(ni);
        comp.push(ni);
      }
    }
    out.push(comp);
  }
  return out;
}

// ── generation ────────────────────────────────────────────────────────────
describe("PP-13 public road generation", () => {
  it("paves highways on every standard seed, and never on a town's own road", () => {
    for (const seed of SEEDS) {
      const g = generateMap(seed);
      const roads = g.publicRoads ?? [];
      expect(roads.length, `seed ${seed} paved no highway`).toBeGreaterThan(0);

      const paved = new Set<number>();
      for (const t of g.towns) for (const [x, y] of t.roads) paved.add(idx(x, y));
      const houses = new Set<number>();
      for (const t of g.towns) for (const [x, y] of t.houses) houses.add(idx(x, y));

      const seen = new Set<number>();
      for (const [tx, ty] of roads) {
        expect(inBounds(tx, ty), `seed ${seed} off-map`).toBe(true);
        const i = idx(tx, ty);
        expect(g.terrain[i], `seed ${seed} highway on water`).not.toBe(WATER);
        expect(g.occupancy[i], `seed ${seed} highway through an industry`).toBeLessThan(0);
        expect(houses.has(i), `seed ${seed} highway through a house`).toBe(false);
        expect(paved.has(i), `seed ${seed} highway adopts a town road`).toBe(false);
        expect(seen.has(i), `seed ${seed} duplicate tile`).toBe(false);
        seen.add(i);
      }
    }
  });

  it("leaves every town on ONE highway network (town roads + highways)", () => {
    for (const seed of SEEDS) {
      const g = generateMap(seed);
      const all = new Set<number>();
      for (const t of g.towns) for (const [x, y] of t.roads) all.add(idx(x, y));
      for (const [x, y] of g.publicRoads ?? []) all.add(idx(x, y));

      const comps = components(all);
      const idOf = new Map<number, number>();
      comps.forEach((c, n) => c.forEach((i) => idOf.set(i, n)));

      // every town's ring road sits in the same component as every other's
      const townComp = g.towns.map((t) => idOf.get(idx(t.roads[0][0], t.roads[0][1])));
      expect(
        new Set(townComp).size,
        `seed ${seed}: towns split across ${new Set(townComp).size} highway components`,
      ).toBe(1);
      // …and each town actually touches the highway, not just its own ring
      for (const t of g.towns) {
        const ring = new Set(t.roads.map(([x, y]) => idx(x, y)));
        const pub = new Set((g.publicRoads ?? []).map(([x, y]) => idx(x, y)));
        let touches = 0;
        for (const r of ring) {
          const x = r % MAP_W, y = (r / MAP_W) | 0;
          for (const [dx, dy] of DIR4) if (pub.has(idx(x + dx, y + dy))) touches++;
        }
        expect(touches, `seed ${seed} town ${t.id} never meets the highway`)
          .toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic: the same seed paves the same highway", () => {
    const a = generateMap(1337);
    const b = generateMap(1337);
    expect(a.publicRoads).toEqual(b.publicRoads);
    expect(a.towns).toEqual(b.towns);
  });

  it("is a pure function of the towns, terrain and occupancy", () => {
    const g = generateMap(79);
    const again = publicRoadTiles(g.towns, g.terrain, g.occupancy);
    expect(again).toEqual(g.publicRoads);
  });

  it("paves nothing when there is only one town to connect", () => {
    const g = generateMap(79);
    expect(publicRoadTiles(g.towns.slice(0, 1), g.terrain, g.occupancy)).toEqual([]);
    expect(publicRoadTiles([], g.terrain, g.occupancy)).toEqual([]);
  });

  it("lays a contiguous 4-adjacent route (no teleporting highway)", () => {
    const g = generateMap(79);
    const set = new Set((g.publicRoads ?? []).map(([x, y]) => idx(x, y)));
    // every highway tile touches the highway-or-town network, so the paved
    // set has no isolated specks
    const ring = new Set<number>();
    for (const t of g.towns) for (const [x, y] of t.roads) ring.add(idx(x, y));
    for (const i of set) {
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      const touching = DIR4.some(([dx, dy]) => {
        const n = idx(x + dx, y + dy);
        return set.has(n) || ring.has(n);
      });
      expect(touching, `highway tile ${x},${y} is stranded`).toBe(true);
    }
  });
});

// ── track wiring ──────────────────────────────────────────────────────────
describe("PP-13 seedPublicRoads", () => {
  const g = generateMap(1337);

  it("stamps every highway tile PUBLIC_OWNER and town roads public too", () => {
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);

    for (const [tx, ty] of g.publicRoads ?? []) {
      expect(hasTrack(track, "road", tx, ty), `(${tx},${ty}) not paved`).toBe(true);
      expect(ownerAt(track, tx, ty), `(${tx},${ty}) not public`).toBe(PUBLIC_OWNER);
      expect(isPublicRoad(track, tx, ty)).toBe(true);
    }
    // RV-03: the town rings are public too, so both kinds of map road are
    // every player's to drive; only the occupation sentinel differs.
    for (const t of g.towns) {
      for (const [tx, ty] of t.roads) {
        expect(ownerAt(track, tx, ty), `town road (${tx},${ty}) not public`).toBe(PUBLIC_OWNER);
        expect(isPublicRoad(track, tx, ty)).toBe(true);
        // a town road is still never OWNED by a player (or the player could
        // claim/demolish the settlement's ring)
        expect(trackOwnedBy(track, 1, tx, ty)).toBe(false);
      }
    }
  });

  it("paves exactly the town roads plus the highways, and nothing else", () => {
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    const want = g.towns.reduce((n, t) => n + t.roads.length, 0)
      + (g.publicRoads?.length ?? 0);
    let onLayer = 0;
    for (let i = 0; i < track.road.length; i++) if (track.road[i] !== 0) onLayer++;
    expect(onLayer).toBe(want);
  });

  it("autotiles the highway into the town ring it meets", () => {
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    for (const [tx, ty] of g.publicRoads ?? []) {
      const bits = bitsAt(track, "road", tx, ty);
      for (const d of DIRS) {
        const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
        if (!hasTrack(track, "road", nx, ny)) continue;
        if ((bits & d) === 0) continue;
        expect(
          bitsAt(track, "road", nx, ny) & OPPOSITE[d],
          `(${tx},${ty}) bit ${d} not mirrored by its neighbour`,
        ).not.toBe(0);
      }
    }
  });
});

// ── the rule that makes them usable ───────────────────────────────────────
describe("PP-13 public roads are every player's to drive on", () => {
  /**
   * A highway tile with a genuinely free, buildable neighbour — one a depot
   * could actually stand on. "Free" means no track of either layer, which
   * matters: a highway's next-door neighbour is very often another highway
   * tile, and paving that one would not create the rival's-tile case the W2
   * test below is after.
   */
  function spotBesideHighway(
    g: Grid, track: ReturnType<typeof createTrack>,
  ): [number, number, number, number] {
    for (const [tx, ty] of g.publicRoads ?? []) {
      for (const [dx, dy] of DIR4) {
        const hx = tx + dx, hy = ty + dy;
        if (!inBounds(hx, hy)) continue;
        const i = idx(hx, hy);
        if (g.terrain[i] === WATER || g.occupancy[i] !== -1) continue;
        if (hasTrack(track, "road", hx, hy) || hasTrack(track, "rail", hx, hy)) continue;
        return [tx, ty, hx, hy];
      }
    }
    throw new Error("no highway tile has a free neighbour");
  }

  it("joins a real player's network — and only a real player's", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    const [rx, ry, hx, hy] = spotBesideHighway(g, track);

    // a depot parked beside the highway, with NO track of its own laid
    const net = playerNetwork(track, 1, [], [{ ownerId: 1, tx: hx, ty: hy }]);
    expect(net.has(tIdx(rx, ry)), "the highway must join the player's network").toBe(true);
    expect(net.size).toBeGreaterThan(10);

    // the neutral owner 0 gets no network out of it (town furniture stays
    // furniture, and a highway is never adopted by "nobody")
    const neutral = playerNetwork(track, 0, [], [{ ownerId: 0, tx: hx, ty: hy }]);
    expect(neutral.has(tIdx(rx, ry))).toBe(false);

    // …and a public tile is still not OWNED by the player
    expect(trackOwnedBy(track, 1, rx, ry)).toBe(false);
    expect(trackOpenTo(track, 1, rx, ry)).toBe(true);
  });

  it("services a depot beside it, with no track of the player's own", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    const [, , hx, hy] = spotBesideHighway(g, track);
    expect(isServiced(track, { id: 1, owner: "you", ownerId: 1, tx: hx, ty: hy })).toBe(true);
    // the same is true for the rival — the highway belongs to neither
    expect(isServiced(track, { id: 2, owner: "ai", ownerId: 2, tx: hx, ty: hy })).toBe(true);
  });

  it("links two structures that never laid a tile between them", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    // two free tiles at opposite ends of the highway
    const roads = g.publicRoads ?? [];
    const free = (tx: number, ty: number) =>
      inBounds(tx, ty) && g.terrain[idx(tx, ty)] !== WATER && g.occupancy[idx(tx, ty)] === -1;
    let a: [number, number] | null = null, b: [number, number] | null = null;
    for (const [tx, ty] of roads) {
      for (const [dx, dy] of DIR4) {
        const nx = tx + dx, ny = ty + dy;
        if (!free(nx, ny)) continue;
        if (!a) { a = [nx, ny]; break; }
        if (Math.abs(nx - a[0]) + Math.abs(ny - a[1]) > 20) { b = [nx, ny]; break; }
      }
      if (b) break;
    }
    expect(a && b, "the highway needs two usable ends").toBeTruthy();

    const comp = buildAllComponents(track, 1);
    expect(linkedBy(comp.road, a![0], a![1], b![0], b![1]),
      "a player must be able to route over the public highway").toBe(true);
    // and the rival can do exactly the same on the same tiles
    const rival = buildAllComponents(track, 2);
    expect(linkedBy(rival.road, a![0], a![1], b![0], b![1])).toBe(true);
  });

  it("cannot be claimed: paving over a highway connects it but leaves it public", () => {
    // Both players may drag a road straight over a highway — it is already
    // paved, so nothing is charged and the route connects. What must NOT
    // happen is the drag silently re-stamping those tiles into the builder's
    // private network for free, which would take the shared road away from
    // the rival and from the map.
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);

    const roads = g.publicRoads ?? [];
    const at = new Set(roads.map(([x, y]) => tIdx(x, y)));
    let run: [number, number][] = [];
    for (const [x, y] of roads) {
      const n = DIR4.find(([dx, dy]) => at.has(tIdx(x + dx, y + dy)));
      if (n) { run = [[x, y], [x + n[0], y + n[1]]]; break; }
    }
    expect(run.length, "the highway has no two adjacent tiles").toBe(2);

    // no `network` argument: this is about ownership, not adjacency, and a
    // purse of nothing proves the crossing is free rather than affordable.
    const purse: Record<string, number> = { wood: 0, stone: 0 };
    const preview = previewDrag(g, track, "road", purse,
      run[0][0], run[0][1], run[1][0], run[1][1]);
    expect(preview.cost, "re-paving a highway must be free").toEqual({});
    commitDrag(track, "road", preview, 1);

    for (const [x, y] of run) {
      expect(ownerAt(track, x, y), `(${x},${y}) was taken`).toBe(PUBLIC_OWNER);
      expect(trackOwnedBy(track, 1, x, y)).toBe(false);
      expect(isPublicRoad(track, x, y), `(${x},${y}) stopped being public`).toBe(true);
    }
    // …and the rival can still drive on it
    expect(trackOpenTo(track, 2, run[0][0], run[0][1])).toBe(true);
  });

  it("never lets a player cross the OTHER player's track (W2 stands)", () => {
    const g = generateMap(1337);
    const track = createTrack();
    seedTownRoads(track, g);
    seedPublicRoads(track, g);
    const [rx, ry, hx, hy] = spotBesideHighway(g, track);
    buildTile(track, "road", hx, hy, 2);           // the rival paves beside you

    const mine = playerNetwork(track, 1, [], [{ ownerId: 1, tx: rx, ty: ry }]);
    expect(mine.has(tIdx(hx, hy)), "the rival's tile must stay out of my network").toBe(false);
    expect(trackOpenTo(track, 1, hx, hy)).toBe(false);
    expect(trackOpenTo(track, 2, hx, hy)).toBe(true);

    // a town ring road IS public now (RV-03): a player may drive on it, but it
    // stays Town furniture — it is never OWNED by the player.
    const [tx2, ty2] = g.towns[0].roads[0];
    expect(trackOpenTo(track, 1, tx2, ty2)).toBe(true);
    expect(trackOpenTo(track, 2, tx2, ty2)).toBe(true);
    expect(trackOwnedBy(track, 1, tx2, ty2)).toBe(false);
  });
});
