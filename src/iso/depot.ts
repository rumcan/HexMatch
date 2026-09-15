// ══════════════════════════════════════════════════════════════════════════
// Truck depots — the 2×2 building's geometry.
//
// A Depot is a 2×2 lot placed directly beside a resource (an industry footprint
// sharing an EDGE with the lot). It has one open half: two images exist,
//
//   truck_depot_top_entrance     walled on its two BOTTOM edges, open at the TOP
//   truck_depot_bottom_entrance  loading dock on its two TOP edges, open at the BOTTOM
//
// and the lot always opens AWAY from the resource it serves, so the player can
// run a road to the open side. Roads connect only on the tiles just outside the
// open edges (the "entrance"), and lorries drive onto the lot to load.
//
// Grid directions follow track.ts (`DIR`): on screen, NW is up-left (−x),
// NE is up-right (−y), SE is down-right (+x), SW is down-left (+y). A Depot's
// (tx, ty) is its footprint origin — the top corner tile of the diamond.
//
// Pure geometry: no track, no economy, no rendering. The economy, placement,
// the rival and the lorries all ask these functions, so the rules live once.
// ══════════════════════════════════════════════════════════════════════════
import { inMapT } from "./track";
import type { Grid, Industry } from "./grid";

/** The Depot footprint, in tiles. */
export const DEPOT_SIZE: [number, number] = [2, 2];

/** Which half of the lot is open to roads. */
export type DepotFacing = "top" | "bottom";

/** The four edges of the lot, named by the screen direction they face. */
export type DepotSide = "nw" | "ne" | "se" | "sw";

/** The art for each facing (assets/buildings/). */
export const DEPOT_SPRITES: Readonly<Record<DepotFacing, string>> = {
  top: "truck_depot_top_entrance",
  bottom: "truck_depot_bottom_entrance",
};

/** The sides each facing leaves open. */
export const OPEN_SIDES: Readonly<Record<DepotFacing, readonly [DepotSide, DepotSide]>> = {
  top: ["nw", "ne"],
  bottom: ["se", "sw"],
};

const TOP_SIDES: ReadonlySet<DepotSide> = new Set(["nw", "ne"]);

/** The lot's own tiles, row-major. */
export function depotTiles(tx: number, ty: number): [number, number][] {
  const [w, h] = DEPOT_SIZE;
  const out: [number, number][] = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) out.push([tx + dx, ty + dy]);
  return out;
}

/** True when (x, y) is one of the lot's tiles. */
export function depotContains(tx: number, ty: number, x: number, y: number): boolean {
  return x >= tx && x < tx + DEPOT_SIZE[0] && y >= ty && y < ty + DEPOT_SIZE[1];
}

/** The tiles just OUTSIDE one edge of the lot (on-map only). */
export function depotEdgeTiles(tx: number, ty: number, side: DepotSide): [number, number][] {
  const [w, h] = DEPOT_SIZE;
  const out: [number, number][] = [];
  if (side === "nw") for (let dy = 0; dy < h; dy++) out.push([tx - 1, ty + dy]);
  if (side === "se") for (let dy = 0; dy < h; dy++) out.push([tx + w, ty + dy]);
  if (side === "ne") for (let dx = 0; dx < w; dx++) out.push([tx + dx, ty - 1]);
  if (side === "sw") for (let dx = 0; dx < w; dx++) out.push([tx + dx, ty + h]);
  return out.filter(([x, y]) => inMapT(x, y));
}

/** The entrance: the tiles outside the two open edges, where roads connect. */
export function depotEntranceTiles(tx: number, ty: number, facing: DepotFacing): [number, number][] {
  const [a, b] = OPEN_SIDES[facing];
  return [...depotEdgeTiles(tx, ty, a), ...depotEdgeTiles(tx, ty, b)];
}

const industryCovers = (ind: Industry, x: number, y: number): boolean =>
  x >= ind.tx && x < ind.tx + ind.w && y >= ind.ty && y < ind.ty + ind.h;

/** Every industry sharing an edge with the lot, with the sides it touches. */
export function industriesTouchingDepot(
  grid: Pick<Grid, "industries">, tx: number, ty: number,
): { industry: Industry; sides: Set<DepotSide> }[] {
  const out: { industry: Industry; sides: Set<DepotSide> }[] = [];
  for (const ind of grid.industries) {
    const sides = new Set<DepotSide>();
    for (const side of ["nw", "ne", "se", "sw"] as const) {
      if (depotEdgeTiles(tx, ty, side).some(([x, y]) => industryCovers(ind, x, y))) sides.add(side);
    }
    if (sides.size) out.push({ industry: ind, sides });
  }
  return out;
}

/** Why a lot at (tx, ty) has no facing, or null when it has one. */
export type DepotFacingProblem = "no-industry" | "both-sides";

/**
 * The facing a lot at (tx, ty) takes: it opens AWAY from the resources it
 * touches. Resources on its top edges (NW/NE) → open at the bottom; on its
 * bottom edges (SE/SW) → open at the top. Touching resources on both halves
 * leaves no side for a road, so that site has no facing.
 */
export function depotFacingAt(
  grid: Pick<Grid, "industries">, tx: number, ty: number,
): { facing: DepotFacing | null; problem: DepotFacingProblem | null } {
  const touching = industriesTouchingDepot(grid, tx, ty);
  if (!touching.length) return { facing: null, problem: "no-industry" };
  let top = false, bottom = false;
  for (const t of touching) for (const s of t.sides) {
    if (TOP_SIDES.has(s)) top = true; else bottom = true;
  }
  if (top && bottom) return { facing: null, problem: "both-sides" };
  return { facing: top ? "bottom" : "top", problem: null };
}

/** A stored Depot's facing, deriving it for records written before facings existed. */
export function depotFacingOf(
  grid: Pick<Grid, "industries">, h: { tx: number; ty: number; facing?: DepotFacing },
): DepotFacing {
  return h.facing ?? depotFacingAt(grid, h.tx, h.ty).facing ?? "top";
}
