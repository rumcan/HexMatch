// ══════════════════════════════════════════════════════════════════════════
// R3 (#270) — DAMS: a hydro dam across a straight river section.
//
// A dam is a two-tile STRUCTURE the player builds over one tile of a NARROW
// (1-tile-wide) straight river run: the river tile itself (its SITE) plus one
// bank tile the footprint leans onto. It is the ticket's design option 1 —
// no reservoir, no moving water: the map is not reshaped, and the crossing
// under the dam stays exactly the water it was (bridges, #266, are the
// crossing rule; a dam is not one and carries no track).
//
// THE VALUE, in one place: the dam's owner gets an output bonus
// (`DAM_BONUS`) to every Depot within `DAM_RANGE` tiles of the site — a
// platform-Depot included, it is a Depot record like any other — and the same
// bonus is added to the city term of the income factor when the seat's city
// sits within range. Both halves are multipliers on the clock-income factor
// (`economyTick` / `tickFactor`), never a second income source.
//
// THE STATE: one owner per site. The map is the seed's business (a site is
// RIVER water, `grid.rivers` — nothing dam-able exists with the rivers
// option off, exactly as bridges never grow there), so the only mutable part
// of a dam is WHO owns the site and which bank its footprint leans onto.
// That is all that saves and snapshots carry (`damsToWire` / `damsFromWire`),
// the way rail structures carry their heading and nothing of the track they
// stand beside.
//
// This module is a LEAF: it imports `grid.ts`, `config.ts` and `bridges.ts`
// (the river-water rule it builds on) and nothing that imports it back, so
// the rules stay importable from plain Node exactly like the bridge rules.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { BUILD_COSTS, type Cargo } from "./config";
import { FIELD_OCC, TOWN_OCC, WATER, type Grid } from "./grid";
import { bridgeWaterAt } from "./bridges";
import { footprintFlatTiles } from "./slopes";

export type Purse = Partial<Record<Cargo, number>>;

// ── the constants ─────────────────────────────────────────────────────────
/**
 * The output bonus a standing dam grants its owner: ×1.25 to every Depot it
 * reaches, and the same fraction added to the city term of the income factor.
 * Mid-tier on purpose — a full city upgrade row is worth up to +50%/+100%/
 * +150% (L17's `TOWN_UPGRADES`), and a dam is a one-off structure, not a
 * ladder rung, so it sits below a single upgrade row.
 */
export const DAM_BONUS = 0.25;

/**
 * "Nearby", in tiles: Manhattan distance from the dam's SITE (its river tile)
 * to a Depot lot tile / a town centre. 4 is the CATCHMENT radius the economy
// already reads for a Depot's 4×4 box, so "as near as a catchment" is the
 * distance a player can picture.
 */
export const DAM_RANGE = 4;

/**
 * Owner call (2026-09-26): Dams are OFF for now. No Build-menu button, no
 * hotkey, no guest intent, no rival dams. The code stays so they can come
 * back by flipping this flag (the test hooks still place dams directly).
 */
export const DAMS_ENABLED = false;

/** The dam's price — in `BUILD_COSTS` with every other price. */
export const DAM_COST: Purse = { ...BUILD_COSTS.dam };

// ── the record ────────────────────────────────────────────────────────────
/** The axis the river runs along at the site: "x" = a run of water along x
 *  (the banks are north/south of it), "y" = a run along y (banks east/west). */
export type DamAxis = "x" | "y";
/** The bank the footprint leans onto. */
export type DamSide = "n" | "s" | "e" | "w";

export interface Dam {
  id: number;
  owner: string;
  /** The numeric track-owner id (player index + 1) — the economy's identity. */
  ownerId: number;
  /** The river water tile the dam spans — its SITE, the bonus's centre. */
  wx: number;
  wy: number;
  /** The axis the river runs along at the site. */
  axis: DamAxis;
  /** The bank the second footprint tile stands on. */
  side: DamSide;
}

/** The side a footprint of `axis` may lean onto (across the river, never with it). */
export const SIDES: Record<DamAxis, [DamSide, DamSide]> = { x: ["n", "s"], y: ["e", "w"] };

/** The cycle the Dam tool's R key walks (the game's `damSide` state). */
export const DAM_SIDES: readonly DamSide[] = ["n", "s", "e", "w"];

/** The bank tile of the footprint. */
export function damBank(d: Pick<Dam, "wx" | "wy" | "side">): [number, number] {
  switch (d.side) {
    case "n": return [d.wx, d.wy - 1];
    case "s": return [d.wx, d.wy + 1];
    case "w": return [d.wx - 1, d.wy];
    case "e": return [d.wx + 1, d.wy];
  }
}

/** The footprint's origin (top corner) — the DrawItem's `tx, ty`. */
export function damOrigin(d: Pick<Dam, "wx" | "wy" | "axis" | "side">): [number, number] {
  const [bx, by] = damBank(d);
  return [Math.min(d.wx, bx), Math.min(d.wy, by)];
}

/** Both tiles the structure stands on: the river tile and its bank. */
export function damFootprint(d: Pick<Dam, "wx" | "wy" | "side">): [number, number][] {
  return [[d.wx, d.wy], damBank(d)];
}

/**
 * The DrawItem's `tx, ty` — the def-footprint box's TOP corner — so the
 * renderer's south-vertex anchor (`depth.drawOrigin` places the manifest's
 * `anchor` pixel on the footprint's LAST tile, `(tx+fw-1, ty+fh-1)`) lands on
 * the SOUTH VERTEX OF THE RIVER (SITE) TILE. The site is the one fixed point
 * of a dam (the bank tile moves with `side`), so anchoring on it keeps the
 * two-tile sprite standing on the water for a north-leaning and a
 * south-leaning dam alike. With `[fw, fh] = damSpan(axis)` the answer is
 * simply the site pulled back by the footprint's extent:
 *
 *   axis "x" (sprite `dam_y`, 1×2): [wx,     wy-1]
 *   axis "y" (sprite `dam_x`, 2×1): [wx-1,   wy]
 */
export function damDrawOrigin(d: Pick<Dam, "wx" | "wy" | "axis">): [number, number] {
  const [fw, fh] = damSpan(d);
  return [d.wx - (fw - 1), d.wy - (fh - 1)];
}

/** True when (x,y) is one of `d`'s two tiles. */
export function damContains(d: Pick<Dam, "wx" | "wy" | "side">, x: number, y: number): boolean {
  if (x === d.wx && y === d.wy) return true;
  const [bx, by] = damBank(d);
  return bx === x && by === y;
}

/** The footprint's w×h (1×2 across a river along x, 2×1 across one along y). */
export function damSpan(d: Pick<Dam, "axis">): [number, number] {
  return d.axis === "x" ? [1, 2] : [2, 1];
}

// ── the site rule ─────────────────────────────────────────────────────────
/**
 * Why a dam may not stand at (x,y) leaning `side` — the one place that knows.
 * "ok" is a refusal of nothing.
 *
 *   not-river   no tile, or not RIVER water (sea and lakes are water without
 *               the `grid.rivers` mask, and with the rivers option OFF there
 *               is no mask at all — an option-off map has no sites, ever).
 *   no-section  river water with no straight section to span: the run is a
 *               one-tile pond (no river water along the run) — there is no
 *               "across" for the footprint to mean.
 *   bend        river water on BOTH axes: the river bends here, and a bend
 *               has no banks to speak of.
 *   wide        the banks across the river are not both dry land — a 2-tile
 *               run reads as a wide channel, and the sea never qualifies.
 *   site-taken  one owner per site: ANY dam at this river tile (either
 *               seat's) closes the site.
 *   bad-side    the side is not across this axis of river.
 *   bank-blocked the bank tile is out of bounds, water, an industry / town /
 *               field tile, or carries a built thing (`builtAt` — a depot,
 *               plant, platform, bridge or the other seat's dam).
 */
export type DamRefusal =
  | "not-river" | "no-section" | "bend" | "wide"
  | "site-taken" | "crossed" | "bad-side" | "bank-blocked"
  /** E4 (#268): the footprint's LAND tiles straddle a level change (a dam's
   *  river tile is water and is exempt — see slopes.ts). */
  | "not-flat";

export const DAM_REFUSAL_TEXT: Record<DamRefusal, string> = {
  "not-river": "A dam spans a river — that is open water.",
  "no-section": "That is a pond, not a river section.",
  "bend": "A dam needs a straight section of river.",
  "wide": "The river is too wide to dam here.",
  "site-taken": "A dam already stands here.",
  "crossed": "A bridge already crosses the water there.",
  "bad-side": "The dam has to lean onto the bank across the river.",
  "bank-blocked": "The bank is not clear for the dam's footing.",
  "not-flat": "The dam's bank needs flat ground.",
};

const inMapD = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/** (x,y) is dry, in-bounds land with nothing stamped on it (industry, town, field, built). */
export function bankTileUsable(grid: Grid, x: number, y: number): boolean {
  if (!inMapD(x, y)) return false;
  const i = y * MAP_W + x;
  if (grid.terrain[i] === WATER) return false;
  // An industry (>= 0), a town tile, or a standing wheat field / tree block:
  // the same three occupancy stamps every other build rule refuses (#298),
  // and the ones this function's own contract in `DamRefusal` names.
  if (grid.occupancy[i] >= 0 || grid.occupancy[i] === TOWN_OCC
    || grid.occupancy[i] === FIELD_OCC) return false;
  // `builtAt` is the game's own "something stands here" report — the same
  // one track.ts' refusal reads, so a bank under a depot or a platform can
  // never double as a dam's footing.
  if (grid.builtAt?.(x, y)) return false;
  return true;
}

/**
 * The river section (x,y) sits in, or the reason it is not a dam site at
 * all. The answer the site rule returns before ownership and the bank — the
 * "is there a river here to span" half of `damRefusal`.
 */
export function damRiverAt(grid: Grid, x: number, y: number):
  | { axis: DamAxis }
  | { why: Extract<DamRefusal, "not-river" | "no-section" | "bend" | "wide"> } {
  if (!bridgeWaterAt(grid, x, y)) return { why: "not-river" };
  const alongX = (inMapD(x - 1, y) && bridgeWaterAt(grid, x - 1, y))
    || (inMapD(x + 1, y) && bridgeWaterAt(grid, x + 1, y));
  const alongY = (inMapD(x, y - 1) && bridgeWaterAt(grid, x, y - 1))
    || (inMapD(x, y + 1) && bridgeWaterAt(grid, x, y + 1));
  if (alongX && alongY) return { why: "bend" };
  if (!alongX && !alongY) return { why: "no-section" };
  const axis: DamAxis = alongX ? "x" : "y";
  // Both banks across the river must be dry land — the "land on both banks"
  // clause. A 2-wide run has water across, and reads "wide".
  if (axis === "x") {
    if (!inMapD(x, y - 1) || !inMapD(x, y + 1)) return { why: "wide" };
    if (grid.terrain[(y - 1) * MAP_W + x] === WATER || grid.terrain[(y + 1) * MAP_W + x] === WATER) {
      return { why: "wide" };
    }
  } else {
    if (!inMapD(x - 1, y) || !inMapD(x + 1, y)) return { why: "wide" }
;
    if (grid.terrain[y * MAP_W + (x - 1)] === WATER || grid.terrain[y * MAP_W + (x + 1)] === WATER) {
      return { why: "wide" };
    }
  }
  return { axis };
}

/**
 * The full site rule: may a dam stand at river tile (x,y) leaning `side`,
 * with `dams` the dams already standing?
 */
export function damRefusal(
  grid: Grid, dams: readonly Dam[], _ownerId: number,
  x: number, y: number, side: DamSide,
): DamRefusal | "ok" {
  const river = damRiverAt(grid, x, y);
  if ("why" in river) return river.why;
  if (!SIDES[river.axis].includes(side)) return "bad-side";
  if (dams.some((d) => d.wx === x && d.wy === y)) return "site-taken";
  // One structure per site: a BRIDGE deck standing on the water is a
  // crossing already, and the dam and the bridge keep off each other's
  // ground (the bridge's own rule answers "shared" the other way round).
  if (grid.builtAt?.(x, y) === "bridge") return "crossed";
  const [bx, by] = damBank({ wx: x, wy: y, side });
  if (!bankTileUsable(grid, bx, by)) return "bank-blocked";
  // E4 (#268): the footprint that stands is the river tile plus the bank — and
  // only the LAND half is graded (the river tile is water), so a dam over a
  // river whose bank sits a level above the water is still legal.
  if (footprintFlatTiles(grid, damFootprint({ wx: x, wy: y, side }))) return "not-flat";
  return "ok";
}

/**
 * Every legal dam site on the map, with the bank sides each may lean onto —
 * the enumeration the rival's planner values (ai.ts) and the "how many spots
 * does this river offer" answer. Deterministic: row-major, `n` before `s`,
 * `e` before `w`.
 */
export interface DamSite {
  wx: number;
  wy: number;
  axis: DamAxis;
  sides: DamSide[];
}

export function damSitesFor(grid: Grid): DamSite[] {
  const out: DamSite[] = [];
  if (!grid.rivers) return out;             // option off: no sites, ever
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const river = damRiverAt(grid, x, y);
      if ("why" in river) continue;
      out.push({ wx: x, wy: y, axis: river.axis, sides: [...SIDES[river.axis]] });
    }
  }
  return out;
}

// ── the bonus ─────────────────────────────────────────────────────────────
/**
 * The bonus `ownerId`'s dams grant a set of tiles — 0, or `DAM_BONUS`.
 *
 * MAX, never SUM: two of the owner's dams within range of the same Depot
 * (a river loop close to town) still grant one `DAM_BONUS`, so the number a
 * readout prints is the number the clock pays, whatever the map does.
 * Owner-scoped: the rival's dam is a threat to see, not a bonus to spend.
 */
export function damBonusAtTiles(
  dams: readonly Dam[] | null | undefined, ownerId: number,
  tiles: readonly [number, number][],
): number {
  if (!dams?.length || ownerId === 0 || !tiles.length) return 0;
  for (const d of dams) {
    if (d.ownerId !== ownerId) continue;
    for (const [tx, ty] of tiles) {
      if (Math.abs(d.wx - tx) + Math.abs(d.wy - ty) <= DAM_RANGE) return DAM_BONUS;
    }
  }
  return 0;
}

/** The single-tile form. */
export const damBonusAt = (
  dams: readonly Dam[] | null | undefined, ownerId: number, x: number, y: number,
): number => damBonusAtTiles(dams, ownerId, [[x, y]]);

/**
 * The city half: `DAM_BONUS` when the seat's city (its town centre) stands
 * within range of one of its dams — the fraction `economyTick` adds to the
 * city term of the factor — else 0.
 */
export function damCityBonusAt(
  dams: readonly Dam[] | null | undefined, ownerId: number,
  town: { tx: number; ty: number } | null | undefined,
): number {
  if (!town) return 0;
  return damBonusAt(dams, ownerId, town.tx, town.ty);
}

// ── the wire ──────────────────────────────────────────────────────────────
/** One dam, as saves and the snapshot carry it. The map regenerates the rest. */
export interface DamWire {
  id: number;
  owner: string;
  ownerId: number;
  wx: number;
  wy: number;
  /** Plain string: the wire is the tolerant reader, the game re-narrows. */
  axis: string;
  side: string;
}

export function damsToWire(dams: readonly Dam[]): DamWire[] | undefined {
  if (!dams.length) return undefined;
  return dams.map((d) => ({
    id: d.id, owner: d.owner, ownerId: d.ownerId,
    wx: d.wx, wy: d.wy, axis: d.axis, side: d.side,
  }));
}

/**
 * Parse wire rows into Dam records. Rows are validated ONE AT A TIME and the
 * good ones are kept even if a foreign row is malformed (a hostile or stale
 * peer must not be able to drop the owner's standing dams) — an all-bad list
 * reads as an empty one, which is the map it was taken from.
 */
export function damsFromWire(rows: readonly DamWire[] | null | undefined): Dam[] {
  if (!Array.isArray(rows)) return [];
  const out: Dam[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (!Number.isInteger(r.wx) || !Number.isInteger(r.wy)
      || r.wx < 0 || r.wy < 0 || r.wx >= MAP_W || r.wy >= MAP_H) continue;
    if (!Number.isInteger(r.ownerId) || r.ownerId < 1) continue;
    if (r.axis !== "x" && r.axis !== "y") continue;
    if (!(SIDES[r.axis as DamAxis] as readonly DamSide[]).includes(r.side as DamSide)) continue;
    if (typeof r.owner !== "string") continue;
    // one owner per site, on the wire too: a duplicate row is a lie.
    const key = `${r.wx},${r.wy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: Number.isInteger(r.id) && r.id > 0 ? r.id : 0,
      owner: r.owner, ownerId: r.ownerId,
      wx: r.wx, wy: r.wy, axis: r.axis as DamAxis, side: r.side as DamSide,
    });
  }
  return out;
}
