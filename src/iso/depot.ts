// ══════════════════════════════════════════════════════════════════════════
// Truck depots — the 2×2 building's geometry.
//
// A Depot is a 2×2 lot placed directly beside a resource (an industry footprint
// sharing an EDGE with the lot). The building is authored in FOUR quarter-turn
// rotations, one per side of the lot, and the art's name says which side its
// yard opens onto:
//
//   truck_depot_bottom_entrance_ne   entrance on the NE edge (up-right)
//   truck_depot_bottom_entrance_se   entrance on the SE edge (down-right)
//   truck_depot_bottom_entrance_sw   entrance on the SW edge (down-left)
//   truck_depot_bottom_entrance_nw   entrance on the NW edge (up-left)
//
// The lot opens AWAY from the resource it serves — by default the side
// opposite it — and the player may turn it (R) onto any other free side. Roads
// connect only on the two tiles just outside that one open edge (the
// "entrance"), and lorries drive onto the lot to load.
//
// Grid directions follow track.ts (`DIR`): on screen, NW is up-left (−x),
// NE is up-right (−y), SE is down-right (+x), SW is down-left (+y). A Depot's
// (tx, ty) is its footprint origin — the top corner tile of the diamond.
//
// Pure geometry: no track, no economy, no rendering. The economy, placement,
// the rival and the lorries all ask these functions, so the rules live once.
// ══════════════════════════════════════════════════════════════════════════
import { canBuildOn, inMapT } from "./track";
import { buildingFootprint, DEPOT_SPRITE } from "./config";
import type { Grid, Industry } from "./grid";

/**
 * The Depot footprint, in tiles. F4 (#275): read from the per-building
 * manifest (`truck_depot`), the footprint authority — the value is still the
 * 2×2 lot it always was, but re-arting the depot re-flows the geometry.
 */
export const DEPOT_SIZE: [number, number] = buildingFootprint(DEPOT_SPRITE) ?? [2, 2];

/** The four edges of the lot, named by the screen direction they face. */
export type DepotSide = "nw" | "ne" | "se" | "sw";

/** Which edge the lot's entrance opens onto — one of the four rotations. */
export type DepotFacing = DepotSide;

/** The rotation order R steps through, a quarter turn at a time. */
export const DEPOT_FACINGS: readonly DepotFacing[] = ["ne", "se", "sw", "nw"];

/** The facing a record with none takes, before the map can be consulted. */
export const DEFAULT_FACING: DepotFacing = "sw";

/**
 * The art for each facing (assets/buildings/).
 *
 * The two NORTH files are crossed on purpose: the art labelled `_ne` is the
 * one whose yard opens up-LEFT, which is this grid's NW, and `_nw` opens
 * up-right. Mapping them straight across put the shed on the road side for
 * every lot built north of its resource — the building has to stand AGAINST
 * the resource, with the yard facing the open country the road comes from.
 */
export const DEPOT_SPRITES: Readonly<Record<DepotFacing, string>> = {
  ne: "truck_depot_bottom_entrance_nw",
  se: "truck_depot_bottom_entrance_se",
  sw: "truck_depot_bottom_entrance_sw",
  nw: "truck_depot_bottom_entrance_ne",
};

/** The edge across the lot from this one. */
export const OPPOSITE_SIDE: Readonly<Record<DepotSide, DepotSide>> = {
  ne: "sw", sw: "ne", se: "nw", nw: "se",
};

/** The next rotation, a quarter turn on. */
export const rotateFacing = (facing: DepotFacing): DepotFacing =>
  DEPOT_FACINGS[(DEPOT_FACINGS.indexOf(facing) + 1) % DEPOT_FACINGS.length];

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

/**
 * The lot tile orthogonally beside an entrance tile — where a lorry coming in
 * through that entrance stops to load — or null when (ex, ey) is not beside
 * the lot.
 */
export function lotTileBeside(tx: number, ty: number, [ex, ey]: [number, number]): [number, number] | null {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    if (depotContains(tx, ty, ex + dx, ey + dy)) return [ex + dx, ey + dy];
  }
  return null;
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

/** The entrance: the tiles outside the ONE open edge, where roads connect. */
export function depotEntranceTiles(tx: number, ty: number, facing: DepotFacing): [number, number][] {
  return depotEdgeTiles(tx, ty, facing);
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
    for (const side of DEPOT_FACINGS) {
      if (depotEdgeTiles(tx, ty, side).some(([x, y]) => industryCovers(ind, x, y))) sides.add(side);
    }
    if (sides.size) out.push({ industry: ind, sides });
  }
  return out;
}

/** Why a lot at (tx, ty) has no facing, or null when it has one. */
export type DepotFacingProblem = "no-industry" | "boxed-in";

/**
 * Every rotation a lot at (tx, ty) may be built in, best first: an edge is a
 * candidate when no resource stands against it and at least one of its
 * entrance tiles is on the map (a side that opens off the map has nowhere for
 * a road). The side OPPOSITE the resource leads — that is the one facing open
 * country — and the rest follow in quarter-turn order, so the list is
 * deterministic and R walks it the same way every time.
 */
export function depotFacings(
  grid: Pick<Grid, "industries">, tx: number, ty: number,
): DepotFacing[] {
  const blocked = new Set<DepotSide>();
  for (const t of industriesTouchingDepot(grid, tx, ty)) for (const s of t.sides) blocked.add(s);
  const free = DEPOT_FACINGS.filter((s) =>
    !blocked.has(s) && depotEdgeTiles(tx, ty, s).length > 0);
  if (!free.length) return [];
  // the far side from the resource first, then quarter turns from there
  const away = [...blocked].map((s) => OPPOSITE_SIDE[s]).find((s) => free.includes(s));
  if (!away) return free;
  const out: DepotFacing[] = [away];
  for (let s = rotateFacing(away); s !== away; s = rotateFacing(s)) {
    if (free.includes(s)) out.push(s);
  }
  return out;
}

/**
 * The facing a lot at (tx, ty) takes by default: it opens AWAY from the
 * resource it touches. A lot with resources against every edge has nowhere to
 * put its entrance, and a lot touching no resource at all is not a Depot site.
 */
export function depotFacingAt(
  grid: Pick<Grid, "industries">, tx: number, ty: number,
): { facing: DepotFacing | null; problem: DepotFacingProblem | null } {
  if (!industriesTouchingDepot(grid, tx, ty).length) {
    return { facing: null, problem: "no-industry" };
  }
  const facings = depotFacings(grid, tx, ty);
  if (!facings.length) return { facing: null, problem: "boxed-in" };
  return { facing: facings[0], problem: null };
}

/**
 * The rotation a site will actually be built in when the player has turned the
 * ghost to `want`: their choice when that side is free here, else this site's
 * own default. Placement, the preview sprite and the ghost all ask this, so
 * what the player sees is what gets built.
 */
export function depotFacingFor(
  grid: Pick<Grid, "industries">, tx: number, ty: number, want?: DepotFacing | null,
): DepotFacing | null {
  // Not a Depot site at all (no resource beside it) → no entrance to show.
  const { facing } = depotFacingAt(grid, tx, ty);
  if (!facing) return null;
  const facings = depotFacings(grid, tx, ty);
  return want && facings.includes(want) ? want : facing;
}

/**
 * Every 2×2 lot that could serve `ind`: sharing an edge with its footprint,
 * with a free side for its entrance, and on ground a Depot may stand on.
 * Row-major, so a search over it is deterministic. Other structures (depots,
 * factories) are the caller's to rule out.
 */
export function depotSites(
  grid: Grid, ind: Industry,
): { tx: number; ty: number; facing: DepotFacing }[] {
  const [w, h] = DEPOT_SIZE;
  const out: { tx: number; ty: number; facing: DepotFacing }[] = [];
  // PERF: the facing only depends on industries within a tile of the lot, so
  // look at the neighbours of THIS industry's surroundings once — the rival
  // calls this for every industry on every turn.
  const near = {
    industries: grid.industries.filter((o) =>
      o.tx <= ind.tx + ind.w + w && o.tx + o.w >= ind.tx - w - 1
      && o.ty <= ind.ty + ind.h + h && o.ty + o.h >= ind.ty - h - 1),
  };
  for (let y = ind.ty - h; y <= ind.ty + ind.h; y++) {
    for (let x = ind.tx - w; x <= ind.tx + ind.w; x++) {
      const tiles = depotTiles(x, y);
      if (tiles.some(([tx, ty]) => !inMapT(tx, ty) || near.industries.some((o) => industryCovers(o, tx, ty)))) continue;
      const touching = industriesTouchingDepot(near, x, y);
      if (!touching.some((t) => t.industry.id === ind.id)) continue;
      const { facing } = depotFacingAt(near, x, y);
      if (!facing) continue;
      if (tiles.some(([tx, ty]) => !canBuildOn(grid, "dirt", tx, ty))) continue;
      out.push({ tx: x, ty: y, facing });
    }
  }
  return out;
}

/** True when two 2×2 lots overlap. */
export const depotsOverlap = (ax: number, ay: number, bx: number, by: number): boolean =>
  Math.abs(ax - bx) < DEPOT_SIZE[0] && Math.abs(ay - by) < DEPOT_SIZE[1];

/** A stored Depot's facing, deriving it for records written without one. */
export function depotFacingOf(
  grid: Pick<Grid, "industries">, h: { tx: number; ty: number; facing?: DepotFacing },
): DepotFacing {
  return h.facing ?? depotFacingAt(grid, h.tx, h.ty).facing ?? DEFAULT_FACING;
}
