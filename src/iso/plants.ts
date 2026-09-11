// ══════════════════════════════════════════════════════════════════════════
// PP-06 — Additional processing plants at other towns.
//
// After setup a player may spend resources to raise MORE processing sites.
// They are additional instances of the SAME building the starting Factory is
// (`economy.Factory`), never a second building type with its own rules — the
// only extra state a plant carries is its `townId` (the town it was raised
// beside) and a stable `id`.
//
// Locked design decision (the ticket asks for this to be settled before
// implementation):
//
//   ALL of a player's plants SHARE ONE processing board.
//
//   Rationale: a per-plant board would mean the input allocation ("which
//   plant does this depot's cargo feed?") and sabotage targeting ("which
//   board does the Smog Cloud land on?") both need a selection UI, and
//   selecting a plant would then be able to reroll a board — exactly the
//   exploit the acceptance criteria forbid. With one shared board there is
//   nothing to select and nothing to reroll: every connected depot feeds the
//   same board, sabotage always lands on it, and a new plant adds delivery
//   REACH (more places a depot may connect to), not extra board throughput.
//
// Everything here is pure: it reads the grid/economy and answers questions.
// `game.ts` owns the purse, the toast and the render sync.
// ══════════════════════════════════════════════════════════════════════════
import { BUILD_COSTS, FACTORY_FOOTPRINT, type Cargo } from "./config";
import { catchmentRect, rectContains } from "./economy";
import { TOWN_OCC, WATER, idx, inBounds, type Grid, type Town } from "./grid";
import { hasTrack, type Purse, type Track } from "./track";
import type { EconomyState, Factory } from "./economy";
import type { Industry } from "./grid";

/**
 * PP-06 / PP-07: the cost of an ADDITIONAL processing plant — an alias into
 * the one authoritative table (BUILD_COSTS.plant), so the UI preview, the
 * charge and the AI all read the same number.
 */
export const PLANT_COST: Purse = BUILD_COSTS.plant;

/** Why a plant may not be raised here. `null` = the placement is legal. */
export type PlantRefusal =
  | "out-of-bounds"
  | "water"
  | "occupied"       // industry footprint or town tile
  | "building"       // another plant or a depot already stands there
  | "track"          // your own road/rail is in the way
  | "no-town";       // the footprint touches no town edge-on

export const PLANT_REFUSAL_TEXT: Record<PlantRefusal, string> = {
  "out-of-bounds": "That is off the map.",
  water: "A processing plant can't stand on water.",
  occupied: "That ground is taken by an industry or town.",
  building: "Another building already stands there.",
  track: "Clear your track off those tiles first.",
  "no-town": "A processing plant must be built next to a town.",
};

/** Every tile of the Factory footprint anchored at (tx,ty). */
export function footprintTiles(tx: number, ty: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = 0; dy < FACTORY_FOOTPRINT[1]; dy++) {
    for (let dx = 0; dx < FACTORY_FOOTPRINT[0]; dx++) out.push([tx + dx, ty + dy]);
  }
  return out;
}

/** Is (tx,ty) a tile of this town (a house, the centre, or a PP-10 town road)? */
const townHasTile = (t: Town, tx: number, ty: number) =>
  t.houses.some(([hx, hy]) => hx === tx && hy === ty)
  || (t.roads ?? []).some(([rx, ry]) => rx === tx && ry === ty)
  || (t.tx === tx && t.ty === ty);

/**
 * The town a footprint at (tx,ty) is "next to", or null.
 *
 * "Next to" is defined exactly once, here, and it is EDGE contact: at least
 * one footprint tile must share an edge with a town tile. Diagonal-only
 * contact does not qualify. A town's PP-10 roads are town tiles exactly like
 * its houses (both are stamped TOWN_OCC), so touching the ring road counts —
 * this is the SAME rule the starting Factory obeys (PP-02,
 * `factoryTouchesTown` in grid.ts). Ties (two towns touching one footprint)
 * resolve to the lowest town id so the answer is deterministic.
 */
export function adjacentTown(grid: Grid, tx: number, ty: number): Town | null {
  const EDGES: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let best: Town | null = null;
  for (const [fx, fy] of footprintTiles(tx, ty)) {
    for (const [dx, dy] of EDGES) {
      const nx = fx + dx, ny = fy + dy;
      // A "town tile" is one the map actually stamped TOWN_OCC — a house, the
      // centre or a PP-10 road. Unstamped tiles never qualify, even if a Town
      // record lists them (keeps synthetic grids honest).
      if (!inBounds(nx, ny)) continue;
      if (grid.occupancy[idx(nx, ny)] !== TOWN_OCC) continue;
      for (const t of grid.towns) {
        if (!townHasTile(t, nx, ny)) continue;
        if (!best || t.id < best.id) best = t;
      }
    }
  }
  return best;
}

/** Does any existing plant/depot of ANY player stand on this tile? */
export function buildingAt(state: EconomyState, tx: number, ty: number): boolean {
  for (const f of state.factories) {
    if (tx >= f.tx && tx < f.tx + FACTORY_FOOTPRINT[0]
      && ty >= f.ty && ty < f.ty + FACTORY_FOOTPRINT[1]) return true;
  }
  return state.harvesters.some((h) => h.tx === tx && h.ty === ty);
}

/**
 * The single legality rule for raising a processing plant. The preview overlay
 * and the actual placement both call this, so they can never disagree — and
 * so can the AI, which therefore cannot bypass town adjacency.
 */
export function plantRefusal(
  grid: Grid, track: Track, state: EconomyState, tx: number, ty: number,
): PlantRefusal | null {
  for (const [x, y] of footprintTiles(tx, ty)) {
    if (!inBounds(x, y)) return "out-of-bounds";
    const i = idx(x, y);
    if (grid.terrain[i] === WATER) return "water";
    if (grid.occupancy[i] >= 0 || grid.occupancy[i] === TOWN_OCC) return "occupied";
    if (buildingAt(state, x, y)) return "building";
    if (hasTrack(track, "road", x, y) || hasTrack(track, "dirt", x, y)) return "track";
  }
  return adjacentTown(grid, tx, ty) ? null : "no-town";
}

export const canPlacePlant = (
  grid: Grid, track: Track, state: EconomyState, tx: number, ty: number,
): boolean => plantRefusal(grid, track, state, tx, ty) === null;

/** Every plant a player owns (the starting Factory is plant #0). */
export const plantsOf = (state: EconomyState, owner: string): Factory[] =>
  state.factories.filter((f) => f.owner === owner);

/** The next stable plant id for this player (starting Factory included). */
export const nextPlantId = (state: EconomyState, owner: string): number =>
  plantsOf(state, owner).reduce((n, f) => Math.max(n, (f.id ?? 0) + 1), 0);

/**
 * Raise a plant. Callers MUST have charged `PLANT_COST` already (exactly
 * once) — this only mutates the economy so save/load and the renderer see the
 * new site. Returns the plant, or null when the placement is illegal, so the
 * "charge then fail" path cannot exist: check first, charge, then call.
 */
export function addPlant(
  grid: Grid, track: Track, state: EconomyState,
  owner: string, ownerId: number, tx: number, ty: number,
): Factory | null {
  if (!canPlacePlant(grid, track, state, tx, ty)) return null;
  const town = adjacentTown(grid, tx, ty);
  const plant: Factory = {
    owner, ownerId, tx, ty,
    id: nextPlantId(state, owner),
    townId: town ? town.id : null,
  };
  state.factories.push(plant);
  return plant;
}

/** Can this purse pay for another plant? */
export const canAffordPlant = (purse: Partial<Record<Cargo, number>>): boolean =>
  (Object.entries(PLANT_COST) as [Cargo, number][])
    .every(([k, v]) => (purse[k] ?? 0) >= v);

/**
 * How far a new plant is worth reaching for: a depot has to be laid out to
 * this footprint, so industries further out than this are not what the plant
 * is buying. `CATCHMENT` (4) is the depot's reach and a short spur sits inside
 * 6 tiles; 8 is the generous end of "a plant you can actually feed".
 */
export const PLANT_REACH = 8;

/** Industries NOT inside any of `owner`'s depot catchments. */
function uncoveredIndustries(grid: Grid, state: EconomyState, owner: string): Industry[] {
  const covered = new Set<number>();
  for (const h of state.harvesters) {
    if (h.owner !== owner) continue;
    const r = catchmentRect(h.tx, h.ty);
    for (const ind of grid.industries) {
      if (rectContains(r, ind.tx, ind.ty) || rectContains(r, ind.tx + ind.w - 1, ind.ty + ind.h - 1)
        || rectContains(r, ind.tx, ind.ty + ind.h - 1) || rectContains(r, ind.tx + ind.w - 1, ind.ty)) {
        covered.add(ind.id);
      }
    }
  }
  return grid.industries.filter((ind) => !covered.has(ind.id));
}

const nearFootprint = (ind: Industry, tx: number, ty: number, reach: number): boolean => {
  const x1 = tx + FACTORY_FOOTPRINT[0] - 1, y1 = ty + FACTORY_FOOTPRINT[1] - 1;
  // distance from the industry's footprint box to the plant's footprint box
  const dx = Math.max(ind.tx - x1, tx - (ind.tx + ind.w - 1), 0);
  const dy = Math.max(ind.ty - y1, ty - (ind.ty + ind.h - 1), 0);
  return dx + dy <= reach;
};

/**
 * Where the AI would raise its next plant. Same rule function as the human
 * path (`canPlacePlant`), so the AI has no adjacency-free fallback, and null
 * when there is nowhere legal — the rival then simply does not build.
 *
 * VP-01: the old answer was "the legal footprint nearest my first plant",
 * which is a way of building a plant that does nothing: it bought the closest
 * town whether or not that town had anything to harvest, and the plant's value
 * is the DEPOT REACH it opens. So the rival now scores each site:
 *
 *   + the number of industries still uncovered that sit within `PLANT_REACH`
 *     of the footprint — ground a new depot could be parked on tomorrow;
 *   − the distance from the owner's existing network, because a plant the
 *     depots cannot road to is 1★ of dead weight (and it is still 1★, which is
 *     why a rival with no good site still buys one rather than stalling).
 *
 * Ties break by (score desc, distance asc, tile index) so the choice is
 * deterministic on a seed, as everywhere else in this engine.
 */
export function chooseAiPlantSpot(
  grid: Grid, track: Track, state: EconomyState, owner: string,
): [number, number] | null {
  const mine = plantsOf(state, owner);
  if (!mine.length) return null;
  const used = new Set(mine.map((f) => f.townId).filter((t) => t != null));
  const wanted = uncoveredIndustries(grid, state, owner);
  const network: [number, number][] = [
    ...mine.map((f) => [f.tx, f.ty] as [number, number]),
    ...state.harvesters.filter((h) => h.owner === owner).map((h) => [h.tx, h.ty] as [number, number]),
  ];
  const manhattan = (tx: number, ty: number) => {
    let d = Infinity;
    for (const [nx, ny] of network) d = Math.min(d, Math.abs(tx - nx) + Math.abs(ty - ny));
    return d;
  };

  let best: [number, number] | null = null;
  let bestScore = -Infinity, bestD = Infinity;
  const seen = new Set<number>();
  for (const town of grid.towns) {
    if (used.has(town.id)) continue;
    for (const [hx, hy] of town.houses) {
      // PP-10/PP-02: a town's ring road surrounds its houses one tile out, so
      // the legal footprints that touch the town stand just OUTSIDE that road
      // (their origin up to 3 tiles from a box-edge house). Scan wide enough
      // to see them; `canPlacePlant` is the one rule that decides.
      for (let dy = -3; dy <= 2; dy++) {
        for (let dx = -3; dx <= 2; dx++) {
          const tx = hx + dx, ty = hy + dy;
          const key = ty * grid.w + tx;
          if (seen.has(key)) continue;
          seen.add(key);
          if (!canPlacePlant(grid, track, state, tx, ty)) continue;
          let reach = 0;
          for (const ind of wanted) if (nearFootprint(ind, tx, ty, PLANT_REACH)) reach++;
          const d = manhattan(tx, ty);
          // 10 per industry in reach, 1 per tile of detour: reach dominates,
          // distance only breaks ties between equally productive sites.
          const score = reach * 10 - d;
          if (score > bestScore || (score === bestScore && (d < bestD
            || (d === bestD && key < (best ? best[1] * grid.w + best[0] : Infinity))))) {
            bestScore = score; bestD = d; best = [tx, ty];
          }
        }
      }
    }
  }
  return best;
}
