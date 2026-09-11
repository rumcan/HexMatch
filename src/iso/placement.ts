// ══════════════════════════════════════════════════════════════════════════
// PP-03 — building footprint vs reach, one geometry shared by the placement
// preview and the placement rules.
//
// The overlay shown while a Factory or a Depot is being placed must paint
// EXACTLY the tiles gameplay cares about, or the preview and the final
// placement disagree at the moment it matters most. Everything here is
// therefore derived from the same constants and functions the click handlers
// run (`FACTORY_FOOTPRINT`, `buildRefusal`/`canBuildOn`, `catchmentRect`,
// `industriesInCatchment`) — never re-derived on the UI side:
//
//   Factory  footprint  the tiles it occupies (FACTORY_FOOTPRINT, derived
//                        `PlanFootprintTile` per tile so a blocking tile can
//                        be shown red while the rest stays valid.
//            reach      the tiles EDGE-adjacent to that footprint — the
//                        town-adjacency band where a qualifying town tile
//                        must touch. Diagonal-only contact does not qualify
//                        (PP-02), so diagonals are deliberately excluded.
//                        Industry tiles are never part of this band: a
//                        Factory does not harvest the map around it.
//            nodes      the town tiles inside that band — the towns that
//                        would qualify the site.
//   Depot    footprint  the single tile it occupies (1×1).
//            reach      its 4×4 resource catchment (`catchmentRect`), the
//                        exact area `industriesInCatchment` scores.
//            nodes      every tile of a served industry's footprint that the
//                        catchment covers — the resource nodes visibly in
//                        reach.
//
// `requireTown` is the PP-02 seam: the day Factory placement must sit next to
// a town, pass it here and the plan's validity (and its readable reason) will
// follow the shared geometry instead of growing a second copy elsewhere.
// ══════════════════════════════════════════════════════════════════════════
import { FACTORY_FOOTPRINT } from "./config";
import {
  GRASS, ROUGH, TOWN_OCC, type Grid, type Industry, type Town,
} from "./grid";
import { buildRefusal, tIdx } from "./track";
import {
  catchmentRect, industriesInCatchment, rectContains, type Harvester,
} from "./economy";

/** Orthogonal (edge-sharing) neighbour offsets — diagonals never qualify. */
const DIR4 = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/** A Factory occupies FACTORY_FOOTPRINT; a Depot a 1×1 tile. */
export const DEPOT_FOOTPRINT: [number, number] = [1, 1];

export interface PlanFootprintTile {
  tx: number;
  ty: number;
  /** Whether THIS footprint tile may be built on (drawn yellow vs red). */
  ok: boolean;
  /** Readable reason for the tile alone, or null when ok. */
  why: string | null;
}

export interface PlacementPlan {
  kind: "factory" | "depot";
  /** The building's own tiles — the STRONG overlay (ok → "highlight",
   *  failing → "highlight_bad"). Only in-map tiles (what can be painted). */
  footprint: PlanFootprintTile[];
  /** The building's reach — the LIGHT overlay ("highlight_soft"). */
  reach: [number, number][];
  /** Tiles that qualify / are caught — the "node_mark" outline. */
  nodes: [number, number][];
  /** Whole-placement legality — exactly what the click handler accepts. */
  valid: boolean;
  /** Readable fragment for the first failure ("it is on water"), or null. */
  why: string | null;
  /** Machine tag ("water" | "occupied" | "depot-taken" | …), or null. */
  code: string | null;
  /** Depot: the industries its catchment actually serves. */
  served: Industry[];
  /** Factory: towns whose tile shares an edge with the footprint. */
  towns: Town[];
}

const REASON_TEXT: Record<string, string> = {
  "out-of-bounds": "it runs off the map",
  water: "it is on water",
  rough: "it is on rough ground",
  occupied: "it overlaps an industry, a town or another building",
  "not-adjacent": "it is not adjacent to your network",
  "depot-taken": "a Depot is already there",
  "no-industry-in-catchment": "no industry sits inside its 4×4 catchment",
  "not-near-town": "its footprint must share an edge with a town",
};

/** Map a refusal/tag to the sentence fragment the UI can print. */
export function placementReasonText(code: string | null): string | null {
  return code === null ? null : (REASON_TEXT[code] ?? "it is not buildable");
}

const inGrid = (g: Grid, x: number, y: number) =>
  x >= 0 && y >= 0 && x < g.w && y < g.h;

/** Every tile of the Factory footprint (including any off-map tail). */
export function factoryFootprintTiles(tx: number, ty: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dy = 0; dy < FACTORY_FOOTPRINT[1]; dy++) {
    for (let dx = 0; dx < FACTORY_FOOTPRINT[0]; dx++) out.push([tx + dx, ty + dy]);
  }
  return out;
}

/**
 * The tiles OUTSIDE the Factory's footprint that share an EDGE with it —
 * the town-adjacency area. A tile is included when it is an orthogonal
 * neighbour of any footprint tile, so diagonal-only contact stays out by
 * construction and the footprint's own tiles are never part of their own ring.
 */
export function factoryAdjacencyRing(grid: Grid, tx: number, ty: number): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<number>();
  for (const [x, y] of factoryFootprintTiles(tx, ty)) seen.add(tIdx(x, y));  // never the footprint
  for (const [x, y] of factoryFootprintTiles(tx, ty)) {
    for (const [dx, dy] of DIR4) {
      const nx = x + dx, ny = y + dy;
      if (!inGrid(grid, nx, ny)) continue;
      const i = tIdx(nx, ny);
      if (seen.has(i)) continue;
      seen.add(i);
      out.push([nx, ny]);
    }
  }
  return out;
}

/**
 * A town's tiles (the centre is also a house tile in grid generation).
 *
 * PP-02: a town's PP-10 ring road / interior streets belong to the town
 * exactly like its houses — they are stamped `TOWN_OCC` in the occupancy and
 * are town tiles for the adjacency rule, so a factory footprint touching the
 * ring road counts as "next to the town". Both houses and roads are returned
 * (deduplicated), matching the occupancy-based `factoryTouchesTown` in
 * `grid.ts` tile-for-tile.
 */
export function townTilesOf(t: Town): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [hx, hy] of [...t.houses, ...(t.roads ?? [])]) {
    const k = `${hx},${hy}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([hx, hy]);
  }
  return out;
}

/** Towns with at least one tile in the footprint's edge-adjacency ring. */
export function factoryQualifyingTowns(grid: Grid, tx: number, ty: number): Town[] {
  const ring = new Set(factoryAdjacencyRing(grid, tx, ty).map(([x, y]) => tIdx(x, y)));
  return grid.towns.filter((t) =>
    townTilesOf(t).some(([x, y]) => ring.has(tIdx(x, y))));
}

/** The ring tiles that belong to a qualifying town (drawn as node marks). */
export function factoryQualifyingTownTiles(grid: Grid, tx: number, ty: number): [number, number][] {
  const ring = new Set(factoryAdjacencyRing(grid, tx, ty).map(([x, y]) => tIdx(x, y)));
  const out: [number, number][] = [];
  for (const t of factoryQualifyingTowns(grid, tx, ty)) {
    for (const [hx, hy] of townTilesOf(t)) {
      if (ring.has(tIdx(hx, hy))) out.push([hx, hy]);
    }
  }
  return out;
}

/**
 * The LIGHT reach band around a valid Factory footprint: the edge-adjacency
 * ring over free land only. Occupied tiles carry their own meaning — industry
 * tiles are deliberately NOT tinted (a Factory does not harvest the map
 * around it, PP-03) and town tiles are shown with node marks instead.
 */
export function factoryReachBand(grid: Grid, tx: number, ty: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [x, y] of factoryAdjacencyRing(grid, tx, ty)) {
    const i = tIdx(x, y);
    const v = grid.terrain[i];
    if (v !== GRASS && v !== ROUGH && v !== SAND) continue;  // no water band (SAND is buildable beach)
    if (grid.occupancy[i] >= 0 || grid.occupancy[i] === TOWN_OCC) continue;
    out.push([x, y]);
  }
  return out;
}

/** The Depot's 4×4 catchment tiles (its own tile excluded — that is the
 *  footprint and is painted solidly). */
export function depotCatchmentTiles(grid: Grid, tx: number, ty: number): [number, number][] {
  const r = catchmentRect(tx, ty);
  const out: [number, number][] = [];
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      if (x === tx && y === ty) continue;
      if (!inGrid(grid, x, y)) continue;
      out.push([x, y]);
    }
  }
  return out;
}

/** The industries the depot's catchment serves — `industriesInCatchment`,
 *  the same rule `placeHarvester` gates on. */
export function depotServedIndustries(grid: Grid, tx: number, ty: number): Industry[] {
  return industriesInCatchment(grid, { id: -1, owner: "", ownerId: 0, tx, ty } as Harvester);
}

/** Every tile of a served industry's footprint that the catchment covers —
 *  the resource nodes that are visibly in reach. */
export function depotCatchmentNodeTiles(grid: Grid, tx: number, ty: number): [number, number][] {
  const r = catchmentRect(tx, ty);
  const out: [number, number][] = [];
  for (const ind of depotServedIndustries(grid, tx, ty)) {
    for (let y = ind.ty; y < ind.ty + ind.h; y++) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) {
        if (rectContains(r, x, y)) out.push([x, y]);
      }
    }
  }
  return out;
}

export interface FactoryPlanOptions {
  /** PP-02 seam: once Factory placement must sit next to a town, pass true —
   *  the overlay then rejects non-adjacent sites with a readable reason. */
  requireTown?: boolean;
}

/** The full PP-03 placement plan for a Factory hover at (tx,ty). Validity is
 *  per footprint tile and matches `placeFactory`'s own checks exactly. */
export function planFactoryPlacement(
  grid: Grid, tx: number, ty: number, opts: FactoryPlanOptions = {},
): PlacementPlan {
  const footprint: PlanFootprintTile[] = [];
  let valid = true, why: string | null = null, code: string | null = null;
  for (const [x, y] of factoryFootprintTiles(tx, ty)) {
    const refusal = inGrid(grid, x, y) ? buildRefusal(grid, "road", x, y) : "out-of-bounds";
    if (refusal !== null && valid) {
      valid = false; code = refusal; why = placementReasonText(refusal);
    }
    if (inGrid(grid, x, y)) {
      footprint.push({
        tx: x, ty: y,
        ok: refusal === null,
        why: refusal === null ? null : placementReasonText(refusal),
      });
    }
  }
  const towns = factoryQualifyingTowns(grid, tx, ty);
  if (opts.requireTown && valid && towns.length === 0) {
    valid = false; code = "not-near-town"; why = placementReasonText(code);
  }
  return {
    kind: "factory",
    footprint,
    reach: valid ? factoryReachBand(grid, tx, ty) : [],
    nodes: factoryQualifyingTownTiles(grid, tx, ty),
    valid,
    why,
    code,
    served: [],
    towns,
  };
}

/** The full PP-03 placement plan for a Depot hover at (tx,ty). Validity is
 *  exactly `placeHarvester`'s: buildable ground, no existing Depot, and at
 *  least one industry in the 4×4 catchment. */
export function planDepotPlacement(
  grid: Grid,
  harvesters: readonly { tx: number; ty: number }[],
  tx: number, ty: number,
): PlacementPlan {
  let code: string | null = null;
  if (!inGrid(grid, tx, ty)) code = "out-of-bounds";
  else {
    const refusal = buildRefusal(grid, "road", tx, ty);
    if (refusal !== null) code = refusal;
    else if (harvesters.some((h) => h.tx === tx && h.ty === ty)) code = "depot-taken";
  }
  const served = inGrid(grid, tx, ty) ? depotServedIndustries(grid, tx, ty) : [];
  if (code === null && served.length === 0) code = "no-industry-in-catchment";
  const ok = code === null;
  return {
    kind: "depot",
    footprint: inGrid(grid, tx, ty)
      ? [{ tx, ty, ok, why: ok ? null : placementReasonText(code) }]
      : [],
    reach: inGrid(grid, tx, ty) ? depotCatchmentTiles(grid, tx, ty) : [],
    nodes: inGrid(grid, tx, ty) ? depotCatchmentNodeTiles(grid, tx, ty) : [],
    valid: ok,
    why: ok ? null : placementReasonText(code),
    code,
    served,
    towns: [],
  };
}
