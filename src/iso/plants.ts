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
import { FACTORY_FOOTPRINT, type Cargo } from "./config";
import { BUILD_COSTS } from "./construction";
import { TOWN_OCC, WATER, idx, inBounds, type Grid, type Town } from "./grid";
import { hasTrack, type Purse, type Track } from "./track";
import type { EconomyState, Factory } from "./economy";

/**
 * PP-06 / PP-07: the cost of an ADDITIONAL processing plant. PP-07 landed:
 * the number now comes from the one authoritative cost table
 * (`construction.ts BUILD_COSTS.plant` — 2 Wood + 2 Stone + 2 Grain + 3 Ore), so
 * the UI preview, the charge and the AI all read the same constant.
 */
export const PLANT_COST: Purse = { ...BUILD_COSTS.plant };

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

/** Every tile of the 2×2 footprint anchored at (tx,ty). */
export function footprintTiles(tx: number, ty: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = 0; dy < FACTORY_FOOTPRINT[1]; dy++) {
    for (let dx = 0; dx < FACTORY_FOOTPRINT[0]; dx++) out.push([tx + dx, ty + dy]);
  }
  return out;
}

/** Is (tx,ty) a tile of this town? Houses AND the town's own roads (PP-10):
 *  grid.ts stamps them TOWN_OCC precisely because "a town's roads belong to
 *  the town, exactly like its houses". Counting them here keeps the plant
 *  adjacency rule working on real maps — the ring road surrounds the houses,
 *  so without it every footprint next to a house overlaps the ring
 *  ("occupied") and every footprint next to the ring alone was "no-town":
 *  no plant could ever be raised beside a town. */
const townHasTile = (t: Town, tx: number, ty: number) =>
  t.houses.some(([hx, hy]) => hx === tx && hy === ty)
  || (t.roads ?? []).some(([rx, ry]) => rx === tx && ry === ty)
  || (t.tx === tx && t.ty === ty);

/**
 * The town a footprint at (tx,ty) is "next to", or null.
 *
 * "Next to" is defined exactly once, here, and it is EDGE contact: at least
 * one footprint tile must share an edge with a town tile. Diagonal-only
 * contact does not qualify. Ties (two towns touching one footprint) resolve
 * to the lowest town id so the answer is deterministic.
 */
export function adjacentTown(grid: Grid, tx: number, ty: number): Town | null {
  const EDGES: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  let best: Town | null = null;
  for (const [fx, fy] of footprintTiles(tx, ty)) {
    for (const [dx, dy] of EDGES) {
      const nx = fx + dx, ny = fy + dy;
      if (!inBounds(nx, ny)) continue;
      for (const t of grid.towns) {
        if (!townHasTile(t, nx, ny)) continue;
        if (!best || t.id < best.id) best = t;
      }
    }
  }
  return best;
}

/** Does any existing plant/depot of ANY player stand on this tile? */
function buildingAt(state: EconomyState, tx: number, ty: number): boolean {
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
    if (hasTrack(track, "road", x, y) || hasTrack(track, "rail", x, y)) return "track";
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
 * Where the AI would raise its next plant: a legal 2×2 beside a town it does
 * not already have a plant at, nearest to its existing network. Same rule
 * function as the human path, so the AI has no adjacency-free fallback.
 * Returns null when there is nowhere legal (the AI then simply doesn't build).
 */
export function chooseAiPlantSpot(
  grid: Grid, track: Track, state: EconomyState, owner: string,
): [number, number] | null {
  const mine = plantsOf(state, owner);
  if (!mine.length) return null;
  const used = new Set(mine.map((f) => f.townId).filter((t) => t != null));
  const anchor = mine[0];
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const town of grid.towns) {
    if (used.has(town.id)) continue;
    for (const [hx, hy] of town.houses) {
      // PP-10's ring road sits one tile outside the house box, so a legal
      // footprint can start two tiles past an edge house — scan -3..+2 on
      // both axes (tiles up to hx+3), not just footprint-adjacent offsets.
      for (let dy = -(FACTORY_FOOTPRINT[1] + 1); dy <= 2; dy++) {
        for (let dx = -(FACTORY_FOOTPRINT[0] + 1); dx <= 2; dx++) {
          const tx = hx + dx, ty = hy + dy;
          if (!canPlacePlant(grid, track, state, tx, ty)) continue;
          const d = Math.abs(tx - anchor.tx) + Math.abs(ty - anchor.ty);
          if (d < bestD) { bestD = d; best = [tx, ty]; }
        }
      }
    }
  }
  return best;
}
