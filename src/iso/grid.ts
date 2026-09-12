// ══════════════════════════════════════════════════════════════════════════
// E3 — Grid generation (isometric): typed-array terrain + industry placement
//
// Replaces the hex `hexmap.ts` geometry. Deterministic under a seed:
// multiplayer ships only the seed and every client regenerates byte-identical
// terrain + industries (net.ts must never send them — E10).
//
// Terrain is a flat Uint8Array (read every frame by the culler — no object
// arrays). Industries live in a separate list with an occupancy Int16Array
// mapping tile index → industry list index (or -1). Placement is Poisson-disc
// style rejection sampling: target separation 12 tiles, no overlap, not on
// water, quota per industry type so no cargo is absent from the map.
// ══════════════════════════════════════════════════════════════════════════
import {
  MAP_W, MAP_H, mulberry32, INDUSTRIES, INDUSTRY_QUOTA, INDUSTRY_BY_KEY, FACTORY_FOOTPRINT,
} from "./config";

export const GRASS = 0;
export const WATER = 1;
export const ROUGH = 2;
/**
 * W-series terrain overhaul: the golden beach ring hugging the coastline.
 * Purely cosmetic — every gameplay check treats SAND exactly like GRASS
 * (buildable, flat cost). Assigned deterministically after landmass
 * selection, so the seed → map contract is unchanged.
 */
export const SAND = 3;

export const idx = (tx: number, ty: number) => ty * MAP_W + tx;
export const inBounds = (tx: number, ty: number) =>
  tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;

export interface Industry {
  id: number;             // index into grid.industries
  type: string;           // INDUSTRY_BY_KEY key, e.g. "farm"
  tx: number;             // footprint origin tile (top corner of the diamond)
  ty: number;
  w: number;              // footprint [w, h]
  h: number;
  output: number;
  banditUntil: number;    // blockade expiry (0 = none) — legacy carry-over
}

/** TOWN-1: a town is a cluster of house tiles around a center. */
export interface Town {
  id: number;
  tx: number;             // center tile
  ty: number;
  houses: [number, number][];  // list of house tile positions
  /** PP-10: the town's simple ring road — the perimeter of the house
   *  bounding box expanded by one tile, kept on free land only. The tiles
   *  are stamped TOWN_OCC in `occupancy` (a town's roads belong to the
   *  town, exactly like its houses: nobody may build on them), and the game
   *  copies them onto the track layer at boot (`seedTownRoads` in track.ts).
   *  A pure function of the houses plus the terrain/occupancy at placement
   *  time, so the map stays deterministic under the seed. */
  roads: [number, number][];
}

export interface Grid {
  w: number;
  h: number;
  terrain: Uint8Array;        // MAP_W*MAP_H values GRASS | WATER | ROUGH | SAND
  industries: Industry[];
  towns: Town[];              // TOWN-1: four towns per map
  /**
   * PP-13: the map's PUBLIC ROADS — the seed-generated highway that links the
   * towns (see `publicRoadTiles`). Optional only so the hand-built synthetic
   * grids in the unit tests stay valid; `generateMap` always fills it.
   *
   * These tiles are deliberately NOT stamped in `occupancy`: a public road is
   * track, not town furniture, so a player may build over it (and, because a
   * tile that already carries road costs nothing, claim it into their own
   * network for free). The game stamps them onto the road layer at boot with
   * owner `PUBLIC_OWNER` (`seedPublicRoads` in track.ts), which is what makes
   * them usable by every player's network.
   */
  publicRoads?: [number, number][];
  occupancy: Int16Array;      // per tile: industry list index or -1 (towns use -2)
  seed: number;
}

function makeTerrain(rng: () => number): Uint8Array {
  const t = new Uint8Array(MAP_W * MAP_H).fill(GRASS);
  const set = (tx: number, ty: number, v: number) => {
    if (inBounds(tx, ty)) t[idx(tx, ty)] = v;
  };
  const distEdge = (tx: number, ty: number) =>
    Math.min(tx, ty, MAP_W - 1 - tx, MAP_H - 1 - ty);

  // ── water: ragged outer coastline only (G3 — no interior lakes) ──
  for (let tx = 0; tx < MAP_W; tx++) {
    for (let ty = 0; ty < MAP_H; ty++) {
      const d = distEdge(tx, ty);
      const jag = 2 + Math.floor(rng() * 3);      // 2..4 tile raggedness
      if (d < jag) set(tx, ty, WATER);
    }
  }

  // G3: ragged jag can isolate 1-tile islets in the ring. Keep only the
  // largest 4-connected landmass so every remaining land tile is reachable.
  {
    const n = MAP_W * MAP_H;
    const seen = new Uint8Array(n);
    let best: number[] = [];
    for (let i = 0; i < n; i++) {
      if (seen[i] || t[i] === WATER) continue;
      const comp: number[] = [];
      const stack = [i];
      seen[i] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        comp.push(cur);
        const x = cur % MAP_W, y = (cur / MAP_W) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = ny * MAP_W + nx;
          if (seen[ni] || t[ni] === WATER) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
      if (comp.length > best.length) best = comp;
    }
    const keep = new Set(best);
    for (let i = 0; i < n; i++) if (t[i] !== WATER && !keep.has(i)) t[i] = WATER;
  }

  // ── rough (rocky) terrain: blobs + mountain spine clumps ──
  const blobs = 14 + Math.floor(rng() * 8);
  for (let i = 0; i < blobs; i++) {
    const cx = 3 + rng() * (MAP_W - 6);
    const cy = 3 + rng() * (MAP_H - 6);
    const r = 1.5 + rng() * 2.6;
    for (let tx = Math.max(0, Math.floor(cx - r - 1)); tx <= Math.min(MAP_W - 1, Math.ceil(cx + r + 1)); tx++) {
      for (let ty = Math.max(0, Math.floor(cy - r - 1)); ty <= Math.min(MAP_H - 1, Math.ceil(cy + r + 1)); ty++) {
        if (Math.hypot(tx - cx, ty - cy) + (rng() - 0.5) * 1.6 < r) {
          if (t[idx(tx, ty)] === GRASS) set(tx, ty, ROUGH);
        }
      }
    }
  }

  // ── W-series: the beach ring ──
  // EVERY land tile that touches water (8-neighbourhood) becomes SAND, so
  // the island is lined with one continuous golden beach edge — grass or
  // rock, the shore is beach. Runs AFTER the rough blobs (a rock clump that
  // reaches the coast keeps only its inland tiles). Consumes no rng: the
  // seed stream below this point is unchanged.
  {
    const sand: number[] = [];
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        if (t[idx(tx, ty)] === WATER) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1 && !touches; dx++) {
            if (!dx && !dy) continue;
            const nx = tx + dx, ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
            if (t[idx(nx, ny)] === WATER) touches = true;
          }
        }
        if (touches) sand.push(idx(tx, ty));
      }
    }
    for (const i of sand) t[i] = SAND;
  }
  return t;
}

function placeIndustries(terrain: Uint8Array, rng: () => number): { list: Industry[]; occ: Int16Array } {
  const occ = new Int16Array(MAP_W * MAP_H).fill(-1);
  const list: Industry[] = [];
  const idAt = (tx: number, ty: number) =>
    inBounds(tx, ty) ? occ[idx(tx, ty)] : -1;

  // true when the whole footprint is placeable at (tx,ty): in bounds, no
  // water, no overlap with an existing industry.
  const footprintFree = (tx: number, ty: number, w: number, h: number) => {
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const gx = tx + x, gy = ty + y;
        if (!inBounds(gx, gy)) return false;
        const ti = idx(gx, gy);
        if (terrain[ti] === WATER) return false;
        if (occ[ti] !== -1) return false;
      }
    }
    return true;
  };

  // Poisson-disc separation: no tile of the new footprint may come within
  // `sep` tiles (Chebyshev) of an occupied tile. sep <= 1 degenerates to the
  // no-overlap check above.
  const separated = (tx: number, ty: number, w: number, h: number, sep: number) => {
    if (sep <= 1) return true;
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const gx = tx + x, gy = ty + y;
        for (let dx = -(sep - 1); dx <= sep - 1; dx++) {
          for (let dy = -(sep - 1); dy <= sep - 1; dy++) {
            if (idAt(gx + dx, gy + dy) !== -1) return false;
          }
        }
      }
    }
    return true;
  };

  const defs = INDUSTRIES.map((d) => ({ d, n: INDUSTRY_QUOTA[d.key] ?? 0 }));
  // try to guarantee the quota: relax separation 12 → … → 1 (overlap-only).
  // T4: on the 144×144 map the same INDUSTRY_QUOTA has 9× the room, so start
  // from a much wider target sep (was 6) and let the fallback converge; this
  // spreads industries instead of letting them clump as the old sep would.
  for (const sep of [12, 8, 6, 4, 2, 1]) {
    let placedAny = true;
    while (placedAny) {
      placedAny = false;
      for (const { d, n } of defs) {
        const have = list.filter((i) => i.type === d.key).length;
        for (let k = have; k < n; k++) {
          const w = d.footprint[0], h = d.footprint[1];
          let done = false;
          for (let attempt = 0; attempt < 90 && !done; attempt++) {
            const tx = Math.floor(rng() * (MAP_W - w + 1));
            const ty = Math.floor(rng() * (MAP_H - h + 1));
            if (footprintFree(tx, ty, w, h) && separated(tx, ty, w, h, sep)) {
              list.push({
                id: list.length, type: d.key, tx, ty, w, h,
                output: d.output, banditUntil: 0,
              });
              for (let x = 0; x < w; x++) {
                for (let y = 0; y < h; y++) {
                  occ[idx(tx + x, ty + y)] = list.length - 1;
                }
              }
              done = true;
              placedAny = true;
            }
          }
          if (!done && sep === 1) {
            // Land still exists on this map; keep the quota best-effort but
            // do not loop forever. Log-free: caller may assert quotas.
            break;
          }
        }
      }
    }
  }
  // final pass: renumber ids to indices and order by id (stable)
  list.forEach((ind, i) => { ind.id = i; });
  return { list, occ };
}

/**
 * PP-14: how far (Chebyshev) an industry footprint must sit from every tile
 * the map seeds as a PUBLIC ROAD — the PP-13 inter-town highways AND each
 * town's own streets/ring road (RV-03 made those public ground too).
 *
 * This is a *spawning* rule, not a building rule: it says nothing about where
 * a player may put a Depot, only about where a resource node may appear. The
 * reason is the opening. Public roads service a Depot on their own
 * (`isServiced` accepts a `PUBLIC_OWNER` tile), so an industry that spawns in
 * the highway's verge is a free connection — park a Depot on the tarmac, skip
 * the road entirely, and the tile the map handed you is worth more than the
 * line you were supposed to lay. 10 tiles is deliberately just over the 8-tile
 * town ring (TOWN_INDUSTRY_SEP), so an industry near a settlement is now
 * outside its streets as well as beside them, and the buffer is measured with
 * the same Chebyshev metric every other separation in this file uses.
 */
export const INDUSTRY_ROAD_SEP = 10;

/**
 * Every tile the map seeds as a PUBLIC ROAD: the highways (`grid.publicRoads`)
 * plus the towns' own ring roads and streets (`town.roads`). These are the
 * tiles `track.ts` stamps `PUBLIC_OWNER` at boot, i.e. the roads every player
 * may drive on and may therefore service a Depot — which is exactly what
 * `INDUSTRY_ROAD_SEP` keeps industries out of.
 */
export function publicRoadTilesOf(grid: Grid): [number, number][] {
  const out: [number, number][] = [...(grid.publicRoads ?? [])];
  for (const t of grid.towns) out.push(...t.roads);
  return out;
}

/**
 * A Chebyshev distance field: for every tile, the distance to the nearest tile
 * in `sources` (8-connected BFS, so `max(|dx|,|dy|)`). Uncrossable for
 * nothing — this is straight-line tile distance, matching `separated` and
 * `TOWN_INDUSTRY_SEP`, which is what a "10 squares" buffer means on a grid.
 */
export function chebyshevField(sources: Iterable<number>): Uint16Array {
  const field = new Uint16Array(MAP_W * MAP_H).fill(0xffff);
  const queue: number[] = [];
  for (const i of sources) {
    if (field[i] === 0xffff) { field[i] = 0; queue.push(i); }
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const x = cur % MAP_W, y = (cur / MAP_W) | 0;
    const d = field[cur] + 1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        if (field[ni] <= d) continue;
        field[ni] = d;
        queue.push(ni);
      }
    }
  }
  return field;
}

/**
 * PP-14: the industries standing inside `min` tiles of the tiles `field` was
 * built from — `applyRoadSpawnBuffer` uses it to find what it must move, and a
 * test uses it to assert the answer is empty once the map is finished.
 */
export function industriesInRoadBuffer(
  industries: readonly Industry[], field: Uint16Array, min = INDUSTRY_ROAD_SEP,
): Industry[] {
  const out: Industry[] = [];
  for (const ind of industries) {
    let near = Infinity;
    for (let x = ind.tx; x < ind.tx + ind.w && near >= min; x++) {
      for (let y = ind.ty; y < ind.ty + ind.h; y++) {
        near = Math.min(near, field[idx(x, y)]);
        if (near < min) break;
      }
    }
    if (near < min) out.push(ind);
  }
  return out;
}

/**
 * PP-14 — hold the 10-tile public-road buffer WITHOUT re-ordering the
 * generator.
 *
 * The buffer cannot be a constraint inside `placeIndustries`: the roads it
 * measures against do not exist yet at that point. Highways are the product of
 * the towns (`publicRoadTiles` routes between the settlements), the towns are
 * placed with the industries already on the map (they keep their 8-tile ring
 * and never wall an industry in), and re-running any of that would move every
 * map on every seed. So this is a repair pass over the finished layout instead:
 * anything the earlier stages parked in a road verge is lifted and re-sited on
 * ground that satisfies the whole rule set at once —
 *
 *   • ≥ INDUSTRY_ROAD_SEP (10) from every public road tile — the highways AND
 *     the towns' ring roads and streets (RV-03 makes those public ground too),
 *     which is what the rule is about; the town's HOUSE tiles keep their 8-tile
 *     ring (TOWN_INDUSTRY_SEP), and since the streets are only ever 1 tile
 *     outside that box, 10 from the streets is ≥9 from the houses;
 *   • the same Poisson-disc separation from the other industries that
 *     `placeIndustries` aims for (12, relaxing down to the 2-tile floor that
 *     keeps footprints from touching), so a repair never re-clusters the map;
 *   • dry land, free of any occupancy (industry or town), and inside the same
 *     4-connected landmass the reachability check in `placeTowns` guaranteed —
 *     so a moved industry can never be walled off behind a town's ring road.
 *
 * The search is ring-by-ring from the tile the node already holds and reads no
 * randomness at all, which keeps determinism trivially (the map stays a pure
 * function of `seed`) and keeps each moved industry where the generator meant
 * it to be. If a hostile seed has no legal site within `REPAIR_REACH` the
 * industry stays where it is — best-effort, exactly like the quota loop above,
 * because an absent resource type is a worse bug than one node too close to
 * the highway.
 */
function applyRoadSpawnBuffer(
  terrain: Uint8Array, occ: Int16Array, list: Industry[],
  towns: Town[], publicRoads: [number, number][],
): void {
  // The buffer is measured from the ROAD tiles — the highways and each town's
  // ring road/streets, i.e. exactly the tiles `track.ts` stamps PUBLIC_OWNER —
  // because that is what the rule is about: a resource node must not sit in a
  // verge a Depot can park on for free.
  const roadSet = new Set<number>();
  for (const [x, y] of publicRoads) roadSet.add(idx(x, y));
  for (const t of towns) for (const [x, y] of t.roads) roadSet.add(idx(x, y));
  const roadField = chebyshevField(roadSet);

  // A town's own ground (houses, centre, streets — everything stamped TOWN_OCC)
  // keeps the generator's 8-tile ring: `placeTowns` measured it against the
  // industries of the time, and a repair pass must not hand that work back. The
  // ring road can have gaps (water, an earlier town), so the distance to the
  // STREET tiles alone does not imply it.
  const townSet = new Set<number>();
  for (let i = 0; i < occ.length; i++) if (occ[i] === TOWN_OCC) townSet.add(i);
  const townField = chebyshevField(townSet);

  // The land an industry may stand on: dry, 4-connected, and not sealed off
  // inside a town. Flooded once from the first industry tile (which is on it by
  // construction) so a re-sited node is never stranded — the same guarantee
  // `placeTowns`' reachability check exists for.
  const open = new Uint8Array(MAP_W * MAP_H);
  {
    const first = list[0];
    const start = first ? idx(first.tx, first.ty) : -1;
    if (start >= 0) {
      const stack = [start];
      open[start] = 1;
      while (stack.length) {
        const cur = stack.pop()!;
        const x = cur % MAP_W, y = (cur / MAP_W) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = ny * MAP_W + nx;
          if (open[ni] || terrain[ni] === WATER || occ[ni] === TOWN_OCC) continue;
          open[ni] = 1;
          stack.push(ni);
        }
      }
    }
  }

  /** Chebyshev distance from every tile to the nearest occupied tile. */
  const occupancyField = () => {
    const src: number[] = [];
    for (let i = 0; i < occ.length; i++) if (occ[i] !== -1) src.push(i);
    return chebyshevField(src);
  };

  /**
   * The nearest legal site for a `w`×`h` footprint, searched in expanding
   * rings around the tile it currently occupies. LOCAL on purpose: the node
   * should step out of the verge, not be re-rolled somewhere else — a
   * far-flung fallback would move the boot camera's focus (`industries[0]`) to
   * a coast, clamp the framing against the map edge, and take the whole
   * opening corridor off screen (which is exactly how the e2e corridor picker
   * first died on a buffered map).
   */
  const nearestFit = (
    ox: number, oy: number, w: number, h: number, sep: number, sepField: Uint16Array,
  ): [number, number] | null => {
    for (let d = 1; d <= REPAIR_REACH; d++) {
      for (let dy = -d; dy <= d; dy++) {
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;   // ring only
          const tx = ox + dx, ty = oy + dy;
          if (!inBounds(tx, ty) || !inBounds(tx + w - 1, ty + h - 1)) continue;
          let ok = true;
          for (let x = 0; x < w && ok; x++) {
            for (let y = 0; y < h && ok; y++) {
              const i = idx(tx + x, ty + y);
              ok = terrain[i] !== WATER && occ[i] === -1 && open[i] === 1
                && roadField[i] >= INDUSTRY_ROAD_SEP
                && townField[i] >= TOWN_INDUSTRY_SEP
                && (sep <= 1 || sepField[i] >= sep);
            }
          }
          if (ok) return [tx, ty];
        }
      }
    }
    return null;
  };

  // Anything inside a public road's verge moves — or inside a town ring an
  // earlier move tightened.
  const near = industriesInRoadBuffer(list, roadField, INDUSTRY_ROAD_SEP)
    .concat(industriesInRoadBuffer(list, townField, TOWN_INDUSTRY_SEP))
    .filter((ind, i, arr) => arr.indexOf(ind) === i);
  if (!near.length) return;

  for (const ind of near) {
    // Wipe the old footprint first: the search must be free to step onto ground
    // that was merely "next to its previous spot".
    for (let x = 0; x < ind.w; x++) {
      for (let y = 0; y < ind.h; y++) occ[idx(ind.tx + x, ind.ty + y)] = -1;
    }
    const sepField = occupancyField();
    let found: [number, number] | null = null;
    // The placer's own relaxation ladder, floored at 2 so two footprints never
    // touch (the ≥1-gap rule the grid tests pin).
    for (const sep of [12, 8, 6, 4, 2]) {
      found = nearestFit(ind.tx, ind.ty, ind.w, ind.h, sep, sepField);
      if (found) break;
    }
    if (!found) {
      // Nothing within REPAIR_REACH: put it back rather than drop a whole
      // resource type off the map.
      for (let x = 0; x < ind.w; x++) {
        for (let y = 0; y < ind.h; y++) {
          occ[idx(ind.tx + x, ind.ty + y)] = ind.id;
        }
      }
      continue;
    }
    ind.tx = found[0]; ind.ty = found[1];
    for (let x = 0; x < ind.w; x++) {
      for (let y = 0; y < ind.h; y++) occ[idx(ind.tx + x, ind.ty + y)] = ind.id;
    }
  }
}

/** How far (Chebyshev) a buffered industry may be stepped to find legal ground. */
const REPAIR_REACH = 24;
/** TOWN-1: number of towns per map. */
const TOWN_COUNT = 4;
/**
 * TOWN-1: houses per town (min..max inclusive).
 *
 * PP-13: TRIPLED (was 6..12). A settlement of 6–12 houses read as a hamlet
 * next to the 144×144 map T4 shipped, and its PP-10 ring road was barely a
 * loop. Three times the houses triples the built area, which also triples the
 * ring road and the interior streets `townRoadTiles` paves inside the house
 * box — the town footprint grows with it, since the box is derived from the
 * houses. The 8-tile industry ring (TOWN_INDUSTRY_SEP) and the 28-tile
 * town-to-town centre separation are unchanged: they are separations, not
 * sizes, and the map has the room (all four towns still place on every
 * standard seed — pinned in tests/unit/iso-grid.test.ts).
 */
/**
 * TOWN-GRID: the viability gate. A candidate centre whose grid yields fewer
 * houses than this is rejected and another centre is tried — that is how a
 * town avoids being laid half in the sea.
 *
 * There is no maximum any more. Under the old BFS growth the house COUNT was
 * the size knob (the footprint was the bounding box of however many houses
 * had been grown), so it needed both ends pinned. The grid is the other way
 * round: `TOWN_SPAN_*` sets the footprint and the house count falls out of it,
 * so a cap here would only clip a town for no reason.
 */
export const TOWN_HOUSES_MIN = 18;

/**
 * TOWN-GRID: the street period, in tiles. Each block is
 * `TOWN_BLOCK - 1` houses across and the next lane is a street, so 3 means
 * 2×2 blocks of houses separated by one-tile streets — the smallest grid
 * that still reads as blocks rather than as a chequerboard.
 */
export const TOWN_BLOCK = 3;

/**
 * TOWN-GRID: half-width of a town's box, in tiles, so the town spans
 * `2·span + 1`. Drawn per town from the seed.
 *
 * Deliberately much larger than the footprint the BFS blob produced (18–36
 * houses came out roughly 6 tiles across). A span of 6–9 is a 13–19 tile
 * town, which at the grid's 4-in-9 house density is around 70–160 houses —
 * a settlement with a street plan you can read, rather than a hamlet.
 */
export const TOWN_SPAN_MIN = 6;
export const TOWN_SPAN_MAX = 9;
/** Minimum Chebyshev distance from EVERY town tile to any industry tile.
 * T4 widens the former 3-tile ring to 8 on the roomier map. */
const TOWN_INDUSTRY_SEP = 8;
/** TOWN-1: minimum Chebyshev distance between two town centres. */
const TOWN_TOWN_SEP = 28;
/** TOWN-1: occupancy sentinel for town tiles (distinct from industry indices ≥ 0). */
export const TOWN_OCC = -2;

/**
 * PP-02: how far (Chebyshev) around each town tile we flatten rocky terrain so
 * the generator can always offer a buildable, town-adjacent Factory footprint
 * per town (and, with it, flat ground for the opening Depot line — rail needs
 * flat land, W8). A factory footprint that touches a town by an EDGE extends
 * at most max(fw, fh) tiles from the touched town tile (see
 * `factoryTouchesTown`), so a ring of this radius guarantees at least one
 * legal, town-adjacent site per town — and PP-12 derives it from the same
 * FACTORY_FOOTPRINT the rules use, so re-arting the factory keeps the
 * guarantee. Industries are ≥8 tiles from any town tile (TOWN_INDUSTRY_SEP),
 * so this never touches an industry footprint.
 * Only FREE tiles are converted — town houses and PP-10 town roads (stamped
 * TOWN_OCC) keep their ground — and the map stays a pure function of `seed`.
 */
export const TOWN_FACTORY_RING = Math.max(...FACTORY_FOOTPRINT);

/**
 * TOWN-GRID: a settlement is a STREET GRID with houses in the blocks between
 * the streets.
 *
 * This replaces PP-10's ring-and-fill layout, which grew a solid BFS blob of
 * houses, paved the gaps it happened to leave, and then drew a closed ring
 * road one tile outside the whole thing. That produced a town with a road
 * wrapped around the outside and almost none inside it — the streets were
 * whatever the blob failed to cover, so their shape was an accident of the
 * growth order rather than a layout.
 *
 * The grid is the obvious thing instead: every `TOWN_BLOCK`-th column and row
 * is a street, and the cells in between are houses. Streets therefore run
 * BETWEEN the buildings, they cross each other, and they reach the edge of
 * the town on all four sides, which is where the inter-town highway meets
 * them.
 *
 * There is no ring, and it is not needed. The old comment worried about
 * ENCLAVES — free tiles sealed inside the closed ring would become
 * road-buildable pockets the rival's factory search must never commit to.
 * A grid has no closed loop: every street runs out of the town, so nothing
 * is sealed. The only tiles inside the box that are neither house nor street
 * are ones that failed the free test (water, an industry, an earlier town),
 * and none of those is a free pocket.
 *
 * The grid PHASE is anchored on the town centre, so (cx,cy) is always a house
 * cell — the centre carries the church sprite, and a church in the middle of
 * a crossroads would be an odd thing to look at.
 *
 * Only free land is used: in-bounds, not water, occupancy -1. Rough is legal
 * (roads and houses both build on rough). A water tile or an earlier town's
 * tile simply drops out, leaving a gap the autotile masks render naturally.
 * Deterministic: same centre, span, terrain and occupancy → same layout.
 */
export function townLayout(
  cx: number, cy: number, span: number,
  terrain: Uint8Array, occ: Int16Array,
  houseAllowed: (tx: number, ty: number) => boolean = () => true,
): { houses: [number, number][]; roads: [number, number][] } {
  const free = (tx: number, ty: number): boolean => {
    if (!inBounds(tx, ty)) return false;
    const i = idx(tx, ty);
    return terrain[i] !== WATER && occ[i] === -1;
  };
  // Positive modulo: the box spans negative offsets from the centre too.
  const phase = (v: number) => ((v % TOWN_BLOCK) + TOWN_BLOCK) % TOWN_BLOCK;
  /** A street lane is the last column/row of each block period. */
  const onLane = (v: number, centre: number) => phase(v - centre) === TOWN_BLOCK - 1;

  const houses: [number, number][] = [];
  // Scan order is fixed, so the output is stable for a given input.
  for (let ty = cy - span; ty <= cy + span; ty++) {
    for (let tx = cx - span; tx <= cx + span; tx++) {
      if (!free(tx, ty)) continue;
      if (onLane(tx, cx) || onLane(ty, cy)) continue;
      if (houseAllowed(tx, ty)) houses.push([tx, ty]);
    }
  }

  // Trim the lanes back to the built area.
  //
  // The grid is laid over the whole box, but houses only appear where the
  // ground allows one — a coast, an industry buffer or an earlier town can
  // leave a whole corner of the box unbuilt. Without this, the streets there
  // survive as lanes running out into empty grass: roads to nowhere, which is
  // a different species of the same complaint the ring layout earned.
  //
  // Keeping the lanes that touch a house is enough to stay connected: a lane
  // tile between two blocks always has a house beside it, so the interior
  // grid is untouched and only the dangling ends go.
  // The streets: one contiguous line along each lane that has blocks built
  // beside it, running from one tile before the first of those blocks to one
  // tile after the last.
  //
  // Built this way rather than by laying lanes over the whole box and then
  // trimming them back, because trimming produces two faults. Lanes over
  // unbuilt ground survive as roads running out into empty grass, and
  // trimming to "touches a house" breaks a lane into disconnected pieces and
  // can SEAL THE TOWN IN: the grid's outer row is a house block as often as
  // it is a lane, so a trimmed network can end up enclosed by a solid wall of
  // houses, and houses are impassable to the inter-town highway. The map then
  // comes out with its settlements on separate road networks.
  //
  // The one-tile overhang at each end is what a street does at the edge of a
  // town, and it is what the highway meets. It cannot bring back the ring
  // layout's enclave problem: these are open-ended lines, not a loop.
  const houseSet = new Set(houses.map(([hx, hy]) => idx(hx, hy)));
  const seen = new Set<number>();
  const roads: [number, number][] = [];
  const addRoad = (tx: number, ty: number) => {
    if (!free(tx, ty) || houseSet.has(idx(tx, ty)) || seen.has(idx(tx, ty))) return;
    seen.add(idx(tx, ty));
    roads.push([tx, ty]);
  };
  // The town's built extent. Every lane spans it, so each lane column meets
  // each lane row and the street network is ONE connected grid. Running a
  // lane only as far as its own two blocks left neighbouring lanes that never
  // crossed, and a town whose streets come out in three disconnected pieces
  // is one the inter-town highway can only attach to a third of.
  let hx0 = Infinity, hx1 = -Infinity, hy0 = Infinity, hy1 = -Infinity;
  for (const [hx, hy] of houses) {
    hx0 = Math.min(hx0, hx); hx1 = Math.max(hx1, hx);
    hy0 = Math.min(hy0, hy); hy1 = Math.max(hy1, hy);
  }

  /** Is there a house within two tiles? The reach of a street's frontage. */
  const nearHouse = (tx: number, ty: number): boolean => {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (inBounds(tx + dx, ty + dy) && houseSet.has(idx(tx + dx, ty + dy))) return true;
      }
    }
    return false;
  };

  /**
   * Lay one lane, trimming its ENDS back to the outermost house it serves.
   *
   * Ends only, deliberately. A town can be L-shaped — its bounding box takes
   * in ground that no house could be built on — and a lane crossing that gap
   * is the street joining the two built parts, so cutting the middle out
   * would sever the grid. Trimming only the ends removes the part that sticks
   * out past the last building, which is the bit that reads as a road to
   * nowhere.
   */
  const layLane = (line: [number, number][]) => {
    let first = -1, last = -1;
    for (let i = 0; i < line.length; i++) {
      if (!nearHouse(line[i][0], line[i][1])) continue;
      if (first === -1) first = i;
      last = i;
    }
    if (first === -1) return;
    for (let i = first; i <= last; i++) addRoad(line[i][0], line[i][1]);
  };

  for (let lx = cx - span; lx <= cx + span; lx++) {
    if (!onLane(lx, cx) || lx < hx0 - 1 || lx > hx1 + 1) continue;
    const line: [number, number][] = [];
    for (let ty = hy0 - 1; ty <= hy1 + 1; ty++) line.push([lx, ty]);
    layLane(line);
  }
  for (let ly = cy - span; ly <= cy + span; ly++) {
    if (!onLane(ly, cy) || ly < hy0 - 1 || ly > hy1 + 1) continue;
    const line: [number, number][] = [];
    for (let tx = hx0 - 1; tx <= hx1 + 1; tx++) line.push([tx, ly]);
    layLane(line);
  }

  // Drop any street fragment nothing can drive to.
  //
  // A lane cut by water at both ends can leave a short piece walled in by its
  // own two house blocks. The inter-town highway routes over free land and
  // town streets but never through a house, so such a piece is a street with
  // no way in — and leaving it in the town's road list is what makes the
  // "every town on one highway network" invariant fail: the highway cannot
  // reach it, however the legs are chosen.
  //
  // A fragment is kept when it touches the outside world: land that is free
  // and is neither this town's house nor its street.
  const roadSet = new Set(roads.map(([rx, ry]) => idx(rx, ry)));
  const openOutside = (tx: number, ty: number): boolean =>
    free(tx, ty) && !houseSet.has(idx(tx, ty)) && !roadSet.has(idx(tx, ty));
  const keep = new Set<number>();
  const visited = new Set<number>();
  for (const [rx, ry] of roads) {
    if (visited.has(idx(rx, ry))) continue;
    const comp: number[] = [];
    const stack = [idx(rx, ry)];
    visited.add(stack[0]);
    let reachable = false;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (openOutside(nx, ny)) reachable = true;
        const ni = idx(nx, ny);
        if (!inBounds(nx, ny) || !roadSet.has(ni) || visited.has(ni)) continue;
        visited.add(ni);
        stack.push(ni);
      }
    }
    if (reachable) for (const i of comp) keep.add(i);
  }

  return { houses, roads: roads.filter(([rx, ry]) => keep.has(idx(rx, ry))) };
}

/** 4-neighbourhood, in a fixed order (keeps every BFS below deterministic). */
const DIR4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * PP-13: the PUBLIC ROADS — highways that connect the towns.
 *
 * What it builds:
 *   1. a MINIMUM SPANNING TREE over the town centres, so all four settlements
 *      end up on one highway network without paving a redundant loop
 *      (Prim, seeded from town 0, ties by lowest index — no RNG);
 *   2. for each tree edge, the SHORTEST drivable route between the two towns'
 *      own road networks (a multi-source BFS, so the highway meets each
 *      settlement's ring road wherever that is cheapest).
 *
 * "Drivable" means: in bounds, not water, not an industry footprint, not a
 * house. A town's own ROAD tiles are passable — that is precisely how the
 * highway joins a settlement — and rough ground is fine, because roads build
 * on rough (`TRANSPORT.road.onRough`).
 *
 * Tiles a town already paves are left out of the result: they are on the road
 * layer already, and they keep the town's neutral ownership rather than being
 * adopted into the public highway.
 *
 * Deterministic and pure — a function of the towns, the terrain and the
 * occupancy at generation time, with no RNG draws of its own, so it cannot
 * perturb the seeded stream the rest of the map depends on.
 */
export function publicRoadTiles(
  towns: Town[], terrain: Uint8Array, occ: Int16Array,
): [number, number][] {
  if (towns.length < 2) return [];

  const houses = new Set<number>();
  for (const t of towns) for (const [hx, hy] of t.houses) houses.add(idx(hx, hy));
  const paved = new Set<number>();
  for (const t of towns) for (const [rx, ry] of t.roads) paved.add(idx(rx, ry));

  const passable = (tx: number, ty: number): boolean => {
    if (!inBounds(tx, ty)) return false;
    const i = idx(tx, ty);
    // occ < 0 keeps both free land (-1) and town tiles (-2); the house set is
    // what takes the houses back out, so a highway may cross a ring road but
    // never runs through somebody's living room.
    return terrain[i] !== WATER && occ[i] < 0 && !houses.has(i);
  };

  /** Shortest drivable route between two road-network components. */
  const link = (aTiles: number[], bTiles: number[]): [number, number][] => {
    const targets = new Set<number>(bTiles);
    const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
    const seen = new Uint8Array(MAP_W * MAP_H);
    const queue: number[] = [];
    for (const si of aTiles) {
      if (seen[si]) continue;
      seen[si] = 1;
      prev[si] = si;                 // a source is its own parent: "walk back stops"
      queue.push(si);
    }
    let found = -1;
    for (let head = 0; head < queue.length && found === -1; head++) {
      const cur = queue[head];
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (!passable(nx, ny)) continue;
        const ni = idx(nx, ny);
        if (seen[ni]) continue;
        seen[ni] = 1;
        prev[ni] = cur;
        if (targets.has(ni)) { found = ni; break; }
        queue.push(ni);
      }
    }
    if (found === -1) return [];     // walled off — this leg simply does not exist
    const path: [number, number][] = [];
    for (let cur = found; ; cur = prev[cur]) {
      path.push([cur % MAP_W, (cur / MAP_W) | 0]);
      if (prev[cur] === cur) break;
    }
    return path.reverse();
  };

  // ── the spanning tree ──
  //
  // Over the road-network COMPONENTS, not over the towns.
  //
  // With the grid layout a town's streets are not always one piece: a lane
  // can be cut by water or by an industry, leaving the settlement with two or
  // three separate street networks. An MST over towns links one fragment of
  // each and leaves the rest stranded — the map then has settlements whose
  // road networks never meet, which is exactly what the "every town on ONE
  // highway network" invariant is there to catch. Spanning the components
  // instead makes the invariant hold by construction, and costs nothing on a
  // map where each town happens to be a single piece.
  const townTiles: number[] = [];
  for (const t of towns) for (const [rx, ry] of t.roads) townTiles.push(idx(rx, ry));
  if (!townTiles.length) return [];
  // Index order, so component discovery is deterministic.
  const tileSet = new Set(townTiles);
  const ordered = [...tileSet].sort((a, b) => a - b);
  const compOf = new Map<number, number>();
  const comps: number[][] = [];
  for (const start of ordered) {
    if (compOf.has(start)) continue;
    const comp: number[] = [];
    const stack = [start];
    compOf.set(start, comps.length);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of DIR4) {
        const ni = idx(x + dx, y + dy);
        if (!inBounds(x + dx, y + dy) || !tileSet.has(ni) || compOf.has(ni)) continue;
        compOf.set(ni, comps.length);
        stack.push(ni);
      }
    }
    comps.push(comp);
  }

  /** A component's centroid tile, for the cheap MST distance. */
  const centreOf = (comp: number[]): [number, number] => {
    let sx = 0, sy = 0;
    for (const i of comp) { sx += i % MAP_W; sy += (i / MAP_W) | 0; }
    return [Math.round(sx / comp.length), Math.round(sy / comp.length)];
  };
  const centres = comps.map(centreOf);
  const cheb = (a: number, b: number) => Math.max(
    Math.abs(centres[a][0] - centres[b][0]), Math.abs(centres[a][1] - centres[b][1]));

  const inTree = [0];
  const rest = comps.map((_, i) => i).slice(1);
  const legs: [number, number][] = [];
  while (rest.length) {
    let bestI = 0, bestFrom = inTree[0], bestD = Infinity;
    for (let i = 0; i < rest.length; i++) {
      for (const c of inTree) {
        const d = cheb(rest[i], c);
        if (d < bestD) { bestD = d; bestI = i; bestFrom = c; }
      }
    }
    legs.push([bestFrom, rest[bestI]]);
    inTree.push(rest[bestI]);
    rest.splice(bestI, 1);
  }

  const out: [number, number][] = [];
  const added = new Set<number>();
  for (const [a, b] of legs) {
    for (const [tx, ty] of link(comps[a], comps[b])) {
      const i = idx(tx, ty);
      if (paved.has(i) || added.has(i)) continue;
      added.add(i);
      out.push([tx, ty]);
    }
  }
  return out;
}

function placeTowns(
  terrain: Uint8Array, occ: Int16Array, industries: Industry[], rng: () => number,
): Town[] {
  const towns: Town[] = [];

  const tileFree = (tx: number, ty: number) => {
    if (!inBounds(tx, ty)) return false;
    if (terrain[idx(tx, ty)] === WATER) return false;
    if (occ[idx(tx, ty)] !== -1) return false;   // occupied by an industry or another town house
    return true;
  };

  /** Chebyshev distance from (tx,ty) to the nearest tile of any industry. */
  const industrySep = (tx: number, ty: number) => {
    let best = Infinity;
    for (const ind of industries) {
      // distance from point to rect [ind.tx, ind.tx+w) × [ind.ty, ind.ty+h)
      const dx = Math.max(ind.tx - tx, 0, tx - (ind.tx + ind.w - 1));
      const dy = Math.max(ind.ty - ty, 0, ty - (ind.ty + ind.h - 1));
      best = Math.min(best, Math.max(dx, dy));
    }
    return best;
  };

  const townSep = (tx: number, ty: number) => {
    let best = Infinity;
    for (const t of towns) best = Math.min(best, Math.max(Math.abs(t.tx - tx), Math.abs(t.ty - ty)));
    return best;
  };

  /**
   * TOWN-1: reachability check. With the proposed town tiles marked as
   * impassable, every industry must still be land-reachable from every other.
   * Cheap 4-connected flood from the first non-water, non-blocked tile.
   */
  const allIndustriesReachable = (blocked: Set<number>) => {
    let start = -1;
    for (const ind of industries) {
      if (start === -1) start = idx(ind.tx, ind.ty);
    }
    if (start === -1) return true;
    if (blocked.has(start)) return false;
    const seen = new Uint8Array(MAP_W * MAP_H);
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        if (seen[ni]) continue;
        if (terrain[ni] === WATER) continue;
        if (blocked.has(ni)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    for (const ind of industries) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) {
        for (let y = ind.ty; y < ind.ty + ind.h; y++) {
          if (!seen[idx(x, y)]) return false;
        }
      }
    }
    return true;
  };

  /**
   * TOWN-GRID: would this town SEAL A POCKET of buildable land?
   *
   * Every free tile must still be able to reach an industry over ground a
   * road could be built on. A pocket that cannot is an ENCLAVE: land the
   * rival's search will consider, commit to, and then find has no harvester
   * spot reachable from it — the W8 invariant `canReachASpot` exists to
   * guarantee away.
   *
   * This did not need guarding when a town was a 6-tile blob. The grid towns
   * are 13–19 tiles across, and one laid along a coast can close the gap
   * between itself and the sea. The check is the same shape as
   * `allIndustriesReachable` above: propose, flood, reject.
   */
  const noEnclaves = (blocked: Set<number>): boolean => {
    const seen = new Uint8Array(MAP_W * MAP_H);
    const stack: number[] = [];
    // Flood from the industries — they are what a pocket has to be able to
    // reach — over anything that is not water, not a town and not proposed.
    const open = (i: number) =>
      terrain[i] !== WATER && occ[i] !== TOWN_OCC && !blocked.has(i);
    for (const ind of industries) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) {
        for (let y = ind.ty; y < ind.ty + ind.h; y++) {
          const i = idx(x, y);
          if (seen[i] || !open(i)) continue;
          seen[i] = 1;
          stack.push(i);
        }
      }
    }
    if (!stack.length) return true;
    while (stack.length) {
      const cur = stack.pop()!;
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = idx(nx, ny);
        if (seen[ni] || !open(ni)) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
    // Every tile a road could be built on must have been reached.
    for (let i = 0; i < seen.length; i++) {
      if (seen[i] || blocked.has(i)) continue;
      if (terrain[i] === WATER || occ[i] !== -1) continue;
      return false;
    }
    return true;
  };

  for (let t = 0; t < TOWN_COUNT; t++) {
    let placed = false;
    // try candidate centres at relaxing separation
    for (const sep of [TOWN_TOWN_SEP, 6, 4, 2]) {
      for (let attempt = 0; attempt < 120 && !placed; attempt++) {
        const cx = 4 + Math.floor(rng() * (MAP_W - 8));
        const cy = 4 + Math.floor(rng() * (MAP_H - 8));
        if (!tileFree(cx, cy)) continue;
        if (industrySep(cx, cy) < TOWN_INDUSTRY_SEP) continue;
        if (sep > 0 && townSep(cx, cy) < sep) continue;

        // TOWN-GRID: lay the street grid and its house blocks around the
        // centre. Computed against the CURRENT occupancy, so neither houses
        // nor streets can overlap an industry or an earlier town (both are
        // already stamped in `occ`).
        const span = TOWN_SPAN_MIN + Math.floor(rng() * (TOWN_SPAN_MAX - TOWN_SPAN_MIN + 1));
        const { houses, roads } = townLayout(
          cx, cy, span, terrain, occ,
          // Houses keep the industry buffer; streets do not, exactly as the
          // ring-and-fill layout behaved — a street may run up to an
          // industry's edge, a house may not.
          (hx, hy) => industrySep(hx, hy) >= TOWN_INDUSTRY_SEP,
        );
        if (houses.length < TOWN_HOUSES_MIN) continue;

        // Reachability check: the PROPOSED TOWN tiles must not strand any
        // industry. F1 fix: `blocked` holds only the town's house tiles.
        // Adding every occupied industry tile to `blocked` made
        // `allIndustriesReachable` start its flood from an industry tile
        // (`blocked.has(start)` → false), so every candidate failed and no
        // town was ever placed. Industries must stay passable for the flood
        // — the question is "do these houses wall off an industry?", and the
        // flood starts from an industry tile and walks land that excludes
        // only the town footprint (water is already excluded inside).
        // PP-10: the ring road is part of the proposed town, so it is
        // blocked for the flood too (a closed loop could in principle enclose
        // an industry; the 8-tile industry ring makes it impossible in
        // practice, but the check must not rely on that).
        const blocked = new Set<number>();
        for (const [hx, hy] of houses) blocked.add(idx(hx, hy));
        for (const [rx, ry] of roads) blocked.add(idx(rx, ry));
        if (!allIndustriesReachable(blocked)) continue;
        if (!noEnclaves(blocked)) continue;

        // Commit: mark tiles with TOWN_OCC so later towns/industries avoid them.
        // PP-10: the road tiles are stamped too — a later town's houses AND
        // ring road both treat them as occupied, so towns never overlap.
        for (const [hx, hy] of houses) occ[idx(hx, hy)] = TOWN_OCC;
        for (const [rx, ry] of roads) occ[idx(rx, ry)] = TOWN_OCC;
        towns.push({ id: towns.length, tx: cx, ty: cy, houses, roads });
        placed = true;
      }
      if (placed) break;
    }
  }
  return towns;
}

/**
 * Generate a deterministic 144×144 iso grid. Same seed → byte-identical
 * `terrain`, `occupancy` and `industries` across contexts (T1 determinism).
 *
 * R6: `seed` is required. Multiplayer (E10) must resolve and distribute a
 * concrete seed before generating the map, so every client runs through this
 * same typed path and no client can silently fall back to `Math.random()`.
 * Callers that want a random game map should draw the seed themselves with the
 * game RNG and pass it in (see `randomSeed`).
 */
export function generateMap(seed: number): Grid {
  const s = seed >>> 0;
  const rng = mulberry32(s);
  const terrain = makeTerrain(rng);
  const { list, occ } = placeIndustries(terrain, rng);
  // TOWN-1: towns are placed AFTER industries (sequencing), using the same
  // seeded RNG so the map stays deterministic. Town tiles are stamped with
  // TOWN_OCC in the occupancy array so roads/other structures route around.
  const towns = placeTowns(terrain, occ, list, rng);
  // PP-13: highways between the towns, derived from the towns that were
  // actually placed. No RNG draws, so the seeded stream the rest of the map
  // depends on is untouched — and the highway is a pure function of the seed.
  const publicRoads = publicRoadTiles(towns, terrain, occ);
  // PP-14: industries keep out of the roads' verges. The buffer cannot be a
  // `placeIndustries` constraint — the roads it measures against are derived
  // from the towns, which are derived from the industries — so it is repaired
  // here, once the highways and the town streets are known. Uses the seeded
  // stream (every earlier stage is done drawing from it), so the map is still a
  // pure function of `seed`.
  applyRoadSpawnBuffer(terrain, occ, list, towns, publicRoads);
  // PP-02: guarantee every town can host a Factory. The only thing that could
  // wall a town off from a legal Factory site is ROUGH terrain around it,
  // so flatten the rough in a small ring around every town tile. A town tile
  // here means a house OR a PP-10 town road (both stamped TOWN_OCC), so the
  // ring covers the land just outside the town's ring road where a footprint
  // may actually stand. Occupied tiles are skipped: a factory footprint may
  // never overlap the town, so houses and roads keep their own ground.
  // Industries sit ≥8 tiles from any town tile (TOWN_INDUSTRY_SEP), so this
  // never touches an industry footprint, and determinism is preserved (the
  // map is still a pure function of `seed`).
  for (const t of towns) {
    for (const [hx, hy] of [...t.houses, ...t.roads]) {
      for (let dy = -TOWN_FACTORY_RING; dy <= TOWN_FACTORY_RING; dy++) {
        for (let dx = -TOWN_FACTORY_RING; dx <= TOWN_FACTORY_RING; dx++) {
          const x = hx + dx, y = hy + dy;
          if (!inBounds(x, y)) continue;
          const i = idx(x, y);
          if (occ[i] === -1 && terrain[i] === ROUGH) terrain[i] = GRASS;
        }
      }
    }
  }
  return {
    w: MAP_W, h: MAP_H, terrain, industries: list, towns, publicRoads, occupancy: occ, seed: s,
  };
}



/**
 * Generate a non-deterministic seed for a random game.
 *
 * Kept separate from `generateMap` so the fallback is explicit and testable
 * (R6: two no-arg map generations must be different), while the map generator
 * itself remains deterministic-by-value.
 */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** R6: parse `?seed=` or draw a random seed. Never call generateMap without this. */
export function resolveMapSeed(search = typeof location !== "undefined" ? location.search : ""): number {
  const rawSearch = search.startsWith("?") ? search.slice(1) : search;
  const q = new URLSearchParams(rawSearch);
  const raw = q.get("seed");
  if (raw != null && raw !== "") {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Invalid map seed "${raw}".`);
    return n >>> 0;
  }
  return randomSeed();
}

// ── helpers ──
export const terrainAt = (g: Grid, tx: number, ty: number): number =>
  inBounds(tx, ty) ? g.terrain[idx(tx, ty)] : WATER;

export const industryAt = (g: Grid, tx: number, ty: number): Industry | null => {
  if (!inBounds(tx, ty)) return null;
  const id = g.occupancy[idx(tx, ty)];
  return id >= 0 ? g.industries[id] : null;
};

export const industryHasTile = (ind: Industry, tx: number, ty: number) =>
  tx >= ind.tx && tx < ind.tx + ind.w && ty >= ind.ty && ty < ind.ty + ind.h;

export const industryKey = (ind: Industry) => INDUSTRY_BY_KEY[ind.type];

// ── PP-02: Factory placement must be next to a town ────────────────────────
/**
 * True when (tx,ty) is a town tile — any tile stamped `TOWN_OCC`: a town
 * house, its centre, or a PP-10 town road (a town's roads belong to the town
 * exactly like its houses, and are stamped the same way in `occupancy`).
 */
export const isTownTile = (g: Grid, tx: number, ty: number): boolean =>
  inBounds(tx, ty) && g.occupancy[idx(tx, ty)] === TOWN_OCC;

/**
 * PP-02 — does a Factory footprint whose top-left tile is (tx,ty) touch a
 * town tile by an EDGE (share a side)? At least one footprint tile must be
 * orthogonally adjacent to a town tile. Diagonal-only contact does NOT qualify
 * (a footprint sitting kitty-corner to a town tile, touching it only at the
 * corner, is not "next to" the town). Town roads count exactly like town
 * houses — both are TOWN_OCC town tiles — which is what keeps every generated
 * town able to host a Factory after PP-10 ring roads surround its houses.
 */
export function factoryTouchesTown(grid: Grid, tx: number, ty: number): boolean {
  const [fw, fh] = FACTORY_FOOTPRINT;
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const x = tx + dx, y = ty + dy;
      if (isTownTile(grid, x, y - 1) || isTownTile(grid, x, y + 1)
        || isTownTile(grid, x - 1, y) || isTownTile(grid, x + 1, y)) {
        return true;
      }
    }
  }
  return false;
}

export interface FactoryPlacement {
  /** True when a Factory may legally occupy the footprint from (tx,ty). */
  ok: boolean;
  /**
   * The human-readable reason placement is refused (the message the UI shows),
   * or null when `ok` is true. The whole footprint must be legal ground — in
   * bounds, no water, not overlapping a town or another building — AND at least
   * one footprint tile must share an edge with a town tile.
   */
  reason: string | null;
}

/**
 * PP-02 — the single source of truth for whether a Factory may be placed at
 * the Factory footprint whose top-left tile is (tx,ty). Both the human placement
 * (`placeFactory` in `game.ts`) and the AI's factory search use this, so the
 * AI cannot bypass town adjacency through a fallback placement.
 */
export function canPlaceFactory(grid: Grid, tx: number, ty: number): FactoryPlacement {
  const [fw, fh] = FACTORY_FOOTPRINT;
  for (let dy = 0; dy < fh; dy++) {
    for (let dx = 0; dx < fw; dx++) {
      const x = tx + dx, y = ty + dy;
      if (!inBounds(x, y)) return { ok: false, reason: "Out of bounds." };
      const terr = grid.terrain[idx(x, y)];
      if (terr === WATER) return { ok: false, reason: "Can't build on water." };
      if (grid.occupancy[idx(x, y)] !== -1) {
        return {
          ok: false,
          reason: isTownTile(grid, x, y) ? "Can't build on the town." : "Tile is occupied.",
        };
      }
    }
  }
  if (!factoryTouchesTown(grid, tx, ty)) {
    return {
      ok: false,
      reason: "The Factory must be next to a town — at least one of its tiles must share an edge with a town tile.",
    };
  }
  return { ok: true, reason: null };
}
