// ══════════════════════════════════════════════════════════════════════════
// BUILD-1 (#460) — placement assist: legal spots, reasons with fixes.
//
// Building used to leave the player hunting: a red outline with no reason,
// and no way to see where a build IS legal. This module is the assist's one
// rule book, and it never re-derives a rule — every answer comes from the
// SAME functions the placement clicks run:
//
//   legalDepotSpots     `planDepotPlacement` (placement.ts) — the exact plan
//                       `placeHarvester` gates on.
//   legalPlatformSpots  `platformRefusal` (rail.ts) — the exact refusal
//                       `placeRailPlatform` gates on.
//   legalPlantSpots     `plantRefusal` (plants.ts) folded with
//                       `planFactoryPlacement` (placement.ts) — the exact
//                       fold `factoryPlanForTool` in game.ts runs.
//
// The scans enumerate only CANDIDATE tiles (the ring around industries, the
// anchor range around industries and plants, the edge band around towns), so
// they are a superset of the legal spots by construction: a spot the scan
// never visits is a spot the placement rule refuses anyway. The acceptance
// test compares the sets against placement acceptance over seeds.
//
// The refusal assist turns a rule code into a short REASON plus the FIX —
// "Slope — find flat ground.", "Not enough money — $120 more." The copy is
// player-facing; the copy guard (tests/unit/ui-copy-guard.test.ts) keeps
// developer notes out of it.
// ══════════════════════════════════════════════════════════════════════════
import { DEPOT_SIZE, industriesTouchingDepot } from "./depot";
import type { EconomyState } from "./economy";
import { factoryFootprintOf, rotatedSpan, type Grid } from "./grid";
// #456 LEVEL GROUND — the terraform rule's pure plan. The slope fix is
// PRICED with it, never re-derived: `levelCost` is the same answer the Level
// tool's own preview and commit charge for.
import { levelCost, type PlanLevelOptions, type TilePair } from "./level-ground";
import {
  planDepotPlacement, planFactoryPlacement,
  type DepotPlanOptions, type PlacementPlan,
} from "./placement";
import { plantRefusal, type PlantRefusal } from "./plants";
import {
  ANCHOR_RANGE, PLATFORM_FOOTPRINT, platformRefusal,
  type RailRefusal, type RailState, type RailView,
} from "./rail";
import { tIdx, type Track } from "./track";

/** A reason + its fix, as the cursor card prints them. */
export interface AssistCopy {
  /** The short reason — "Slope", "Taken by the rival". */
  reason: string;
  /** What the player can do about it — "find flat ground." */
  fix: string;
}

/** One reason + fix line, rendered: "Slope — find flat ground." */
export const assistText = (copy: AssistCopy): string => `${copy.reason} — ${copy.fix}`;

/**
 * The money shortfall, in the game's one build currency: "$120 more".
 * Pure arithmetic — `moneyValueOf` already priced the bill upstream.
 */
export const moneyFix = (price: number, money: number): string =>
  `$${Math.max(0, Math.ceil(price - money)).toLocaleString("en-US")} more`;

/** The "not enough money" refusal, shared by every build card and cursor. */
export const MONEY_ASSIST = (price: number, money: number): AssistCopy => ({
  reason: "Not enough money",
  fix: moneyFix(price, money),
});

/**
 * The slope fix's flat-ground fallback — what the card says when Level Ground
 * cannot flatten the refused footprint at all (water, a building, rail, a road
 * whose new slope would break, a cliff edge). Every slope row in the tables
 * below reads this, and `slopeAssistFor` prices the ones that CAN be levelled.
 */
export const SLOPE_ASSIST: AssistCopy = {
  reason: "Slope",
  fix: "find flat ground",
};

/** The money voice of the Level Ground fix: "level it for $40". */
export const levelFix = (money: number): string =>
  `level it for $${Math.max(0, money).toLocaleString("en-US")}`;

/**
 * The slope refusal's fix, PRICED (#456 landed, so the seam is now closed):
 * "Slope — level it for $40" when Level Ground can flatten this whole
 * footprint, because `levelCost` is exactly what the Level tool charges —
 * the money is a promise, not an estimate. When the footprint has a tile that
 * cannot be levelled, `levelCost` refuses and the fix falls back to finding
 * flat ground, which is the only other way onto the tile.
 *
 * `tiles` is the refused FOOTPRINT, in the rule's own order: `levelCost`
 * derives its target height from `tiles[0]`, exactly as the level drag's start
 * tile carries it — so pass the same list the placement rule tested with
 * (`depotTiles`, `plantFootprintTiles`, the rail structure's `footprintTiles`).
 */
export function slopeAssistFor(
  grid: Grid, tiles: readonly TilePair[], opts: PlanLevelOptions = {},
): AssistCopy {
  const cost = levelCost(grid, tiles, opts);
  // Nothing to charge means nothing to fix — a zero-price "level it" would be
  // a promise the Level tool cannot keep.
  if ("refusal" in cost || cost.money <= 0) return SLOPE_ASSIST;
  return { reason: SLOPE_ASSIST.reason, fix: levelFix(cost.money) };
}

// ── the truck Depot's refusals (planDepotPlacement codes) ─────────────────
/**
 * Reason + fix per depot plan code. `industry-taken` has two voices — the
 * caller knows WHOSE network holds the industry (the rival's or the seat's
 * own) and passes the matching key.
 */
export const DEPOT_ASSIST: Readonly<Record<string, AssistCopy>> = {
  "out-of-bounds": { reason: "Off the map", fix: "keep the lot on the map" },
  water: { reason: "Water", fix: "build on land" },
  rough: { reason: "Rough ground", fix: "pick smoother ground" },
  "too-steep": { reason: "Slope", fix: SLOPE_ASSIST.fix },
  "not-flat": { reason: "Slope", fix: SLOPE_ASSIST.fix },
  occupied: { reason: "Occupied", fix: "it overlaps a building — move the lot" },
  field: { reason: "In the way", fix: "demolish the field or trees first" },
  track: { reason: "A road is there", fix: "demolish the road or build around it" },
  "depot-taken": { reason: "A depot is already there", fix: "pick another spot" },
  "no-industry-beside": { reason: "Outside the catchment", fix: "move the lot right beside a resource" },
  "entrance-blocked": { reason: "Boxed in", fix: "leave one side of the lot open for its entrance" },
  "industry-taken": { reason: "Already claimed", fix: "build beside a free resource" },
  "industry-taken-rival": { reason: "Taken by the rival", fix: "build beside a free resource" },
};

// ── the Processing Plant / Factory refusals (plantRefusal codes) ──────────
export const PLANT_ASSIST: Readonly<Record<PlantRefusal, AssistCopy>> = {
  "out-of-bounds": { reason: "Off the map", fix: "keep the footprint on the map" },
  water: { reason: "Water", fix: "build on land" },
  occupied: { reason: "Occupied", fix: "it overlaps an industry or town — move it" },
  building: { reason: "A building is there", fix: "pick another spot" },
  track: { reason: "Track in the way", fix: "demolish your road or rail there first" },
  "not-flat": { reason: "Slope", fix: SLOPE_ASSIST.fix },
  "no-town": { reason: "Outside the catchment", fix: "its footprint must share an edge with a town" },
};

// ── the railway structures' refusals (platformRefusal / depotRefusal) ─────
export const RAIL_ASSIST: Readonly<Record<RailRefusal, AssistCopy>> = {
  ok: { reason: "Ready", fix: "click to build" },
  "off-map": { reason: "Off the map", fix: "keep the footprint on the map" },
  water: { reason: "Water", fix: "build on land" },
  occupied: { reason: "Occupied", fix: "something already stands there" },
  "road-parallel": { reason: "Road in the way", fix: "cross a straight road, never run along it" },
  "crossing-curve": { reason: "Crossing", fix: "crossings need a straight road and straight rail" },
  "diagonal-crossing": { reason: "Crossing", fix: "diagonal tracks cannot cross in an X" },
  "axis-only": { reason: "Diagonal track", fix: "move the diagonal bends beyond its lanes" },
  "foreign-rail": { reason: "Not your rail", fix: "that track belongs to the other player" },
  "component-conflict": { reason: "Two networks", fix: "one train per connected network" },
  "no-anchor": { reason: "Outside the catchment", fix: "move within 3 tiles of a resource or your plant" },
  "anchor-taken": { reason: "You already have one here", fix: "one platform per resource" },
  "industry-taken": { reason: "Taken by the rival", fix: "build beside a free resource" },
  "no-network": { reason: "No rail to join", fix: "drag your rail to the exit tile first" },
  "exit-blocked": { reason: "Exit blocked", fix: "clear the tile the exit faces" },
  overlap: { reason: "Occupied", fix: "that footprint overlaps another structure" },
  "anchor-range": { reason: "Outside the catchment", fix: "move within 3 tiles of the resource" },
  "train-in-way": { reason: "A train is there", fix: "wait for it to move on" },
  "not-yours": { reason: "Not yours", fix: "that belongs to the other player" },
  missing: { reason: "Not there", fix: "it is already gone" },
  "track-blocked": { reason: "Track side blocked", fix: "turn it (R) or move it" },
  "bridge-junction": { reason: "Bridge", fix: "a bridge stays straight — nothing joins its side" },
  "overpass-stop": { reason: "Overpass", fix: "place it beyond the deck" },
  "too-steep": { reason: "Slope", fix: SLOPE_ASSIST.fix },
  "slope-diagonal": { reason: "Slope", fix: "no diagonal across a slope" },
  "not-flat": { reason: "Slope", fix: SLOPE_ASSIST.fix },
  "too-sharp": { reason: "Turn too sharp", fix: "turns must be 45° or less" },
};

/** The depot refusal code's copy, choosing the rival's voice when told. */
export function depotAssistFor(code: string, rivalHolds: boolean): AssistCopy {
  if (code === "industry-taken" && rivalHolds) return DEPOT_ASSIST["industry-taken-rival"];
  return DEPOT_ASSIST[code] ?? { reason: "Can't build there", fix: "try another spot" };
}

// ── legal-spot scans ───────────────────────────────────────────────────────
/**
 * Every legal 2×2 truck-Depot anchor on the map — the spots whose plan is
 * valid under the SAME rule `placeHarvester` runs (`planDepotPlacement`).
 * Candidates are the lots edge-adjacent to an industry (a depot with no
 * industry beside it is refused as `no-industry-beside`), so the scan never
 * misses a legal spot and never walks the whole map.
 */
export function legalDepotSpots(
  grid: Grid,
  harvesters: readonly { tx: number; ty: number }[],
  opts: DepotPlanOptions = {},
): [number, number][] {
  const [w, h] = DEPOT_SIZE;
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (const ind of grid.industries) {
    for (let ty = ind.ty - h; ty <= ind.ty + ind.h; ty++) {
      for (let tx = ind.tx - w; tx <= ind.tx + ind.w; tx++) {
        const i = tIdx(tx, ty);
        if (seen.has(i)) continue;
        seen.add(i);
        // The superset includes lots that merely NEAR an industry; the plan
        // below is the only vote that counts.
        if (industriesTouchingDepot(grid, tx, ty).length === 0) continue;
        if (planDepotPlacement(grid, harvesters, tx, ty, opts).valid) out.push([tx, ty]);
      }
    }
  }
  return out;
}

/**
 * Every legal Processing Plant anchor — the fold `factoryPlanForTool` runs:
 * `planFactoryPlacement` (requireTown) AND `plantRefusal` both say yes.
 * Candidates are the footprints edge-adjacent to a town tile (`no-town` is
 * the refusal everywhere else), enumerated the way `resolvePlantTarget`
 * already walks a town's boundary.
 */
export function legalPlantSpots(
  grid: Grid,
  track: Track,
  state: EconomyState,
  rot = 0,
): [number, number][] {
  const fp = factoryFootprintOf(grid);
  const [fw, fh] = rotatedSpan(fp[0], fp[1], rot);
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (const t of grid.towns) {
    for (const [hx, hy] of [[t.tx, t.ty], ...t.houses, ...(t.roads ?? [])] as [number, number][]) {
      for (let dy = -fh; dy <= 1; dy++) {
        for (let dx = -fw; dx <= 1; dx++) {
          const x = hx + dx, y = hy + dy;
          if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
          const i = tIdx(x, y);
          if (seen.has(i)) continue;
          seen.add(i);
          if (plantRefusal(grid, track, state, x, y, rot) !== null) continue;
          const plan = planFactoryPlacement(grid, x, y, { requireTown: true, track, rot });
          if (!plan.valid) continue;
          out.push([x, y]);
        }
      }
    }
  }
  return out;
}

/**
 * Every legal Platform anchor in the held heading — the spots
 * `platformRefusal` answers "ok" for. Candidates are the footprints within
 * the anchor range of an industry or the seat's own plant (`no-anchor` is
 * the refusal beyond it), padded by the footprint's own span.
 */
export function legalPlatformSpots(
  grid: Grid,
  rail: RailState,
  factories: { ownerId: number; tx: number; ty: number; id?: number; rot?: number }[],
  ownerId: number,
  view: RailView,
  locked?: ReadonlySet<number>,
): [number, number][] {
  const [w, h] = PLATFORM_FOOTPRINT[view];
  const fp = factoryFootprintOf(grid);
  const anchors: [number, number][] = [];
  for (const ind of grid.industries) {
    for (let y = 0; y < ind.h; y++) for (let x = 0; x < ind.w; x++) anchors.push([ind.tx + x, ind.ty + y]);
  }
  for (const f of factories) {
    if (f.ownerId !== ownerId) continue;
    const [pfw, pfh] = rotatedSpan(fp[0], fp[1], f.rot ?? 0);
    for (let y = 0; y < pfh; y++) for (let x = 0; x < pfw; x++) anchors.push([f.tx + x, f.ty + y]);
  }
  const seen = new Set<number>();
  const out: [number, number][] = [];
  for (const [ax, ay] of anchors) {
    for (let ty = ay - ANCHOR_RANGE - (h - 1); ty <= ay + ANCHOR_RANGE; ty++) {
      for (let tx = ax - ANCHOR_RANGE - (w - 1); tx <= ax + ANCHOR_RANGE; tx++) {
        if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) continue;
        const i = tIdx(tx, ty);
        if (seen.has(i)) continue;
        seen.add(i);
        if (platformRefusal(grid, rail.structures, factories, ownerId, tx, ty, view, undefined, locked, rail.rail) === "ok") {
          out.push([tx, ty]);
        }
      }
    }
  }
  return out;
}

/** The placement plan a Depot hover runs — re-exported for the assist's callers. */
export type { PlacementPlan };
