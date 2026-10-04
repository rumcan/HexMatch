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
import { fillCoastalHoles } from "./coastline";
import { deriveTownNames } from "./town-names";
import {
  PLANNED_INDUSTRY_SEP, planTown, planVillage, plannedTownSep,
  type IndustryRect, type PlanSize, type TownPlan,
} from "./town-plan";
// TOWN-2 (#653): the town street-plan option's NAME. Type-only: match-settings
// is the protocol's import-free leaf, so this pulls nothing game-side in.
import type { TownLayout, MapSizeName } from "../net/match-settings";
// TOWN-4.1 (#677): the runtime map size — its table, the allocation lock and
// the hook that keeps size-derived module values (the archipelago bases) live.
import { MAP_SIZES, lockMapSize, onMapSize } from "../game/config";
import {
  MAP_W, MAP_H, mulberry32, INDUSTRIES, INDUSTRY_QUOTA, INDUSTRY_BY_KEY, FACTORY_FOOTPRINT,
  factoryFootprintFor,
  buildingFootprint, TOWN_HOUSE_VARIANTS, TOWN_VILLAGE_VARIANTS, TOWN_SHAPE_VARIANTS, TOWN_PARK_VARIANTS, TOWN_VILLAGE_BLOCKS, TOWN_LAWN, TOWN_TREE_VARIANTS,
  TOWN_HOME_VARIANTS, TOWN_HOME_BLOCK_IN, TOWN_GREEN_LOT_IN,
  TOWN_TIER_LEGACY, TOWN_VISUAL_MAX,
  townCentreSprite, pickTownVariant, hashPick,
  CIVIC_BUILDINGS, CIVIC_MAX_SHARE, civicArt, civicCount,
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
  banditOwner?: string;   // #256: attacker seat who bought the blockade
}

/** TOWN-1: a town is a cluster of house tiles around a center. */
export interface Town {
  id: number;
  tx: number;             // center tile
  ty: number;
  houses: [number, number][];  // list of house tile positions
  /**
   * PP-10: the town's simple ring road — the perimeter of the house
   * bounding box expanded by one tile, kept on free land only. The tiles
   * are stamped TOWN_OCC in `occupancy` (a town's roads belong to the
   * town, exactly like its houses: nobody may build on them), and the game
   * copies them onto the track layer at boot (`seedTownRoads` in track.ts).
   * A pure function of the houses plus the terrain/occupancy at placement
   * time, so the map stays deterministic under the seed. */
  roads: [number, number][];
  /**
   * TOWN-4.3 (#679): the master plan of a `layout: "planned"` town — the
   * avenue, the square, every street and every lot of the full city, decided
   * at generation. Its `houses`/`roads` above are the district-0 slices of
   * it that the town OWNS from tier 0 (plus the avenue, its spine); the
   * further districts are reserved but stay free land until TOWN-4.4's
   * reveal draws them, exactly as L17's grown ring does.
   *
   * Absent on a grid or organic town — and on every save written before this
   * ticket — so every reader that does not know about plans is unaffected,
   * and the map stays a pure function of its seed (the plan is regenerated,
   * never stored on the wire).
   */
  plan?: TownPlan;
  /**
   * L17 (#245): the town's VISUAL tier — how far it has grown on the map.
   *
   * 0 is a village, 1 a town (the centre becomes the bank), 2+ grows the
   * footprint (`TOWN_VISUAL_MAX` caps the look). It is DISPLAY state only:
   * nothing in placement, catchments, routing or the economy reads it (that
   * is the ticket's "no gameplay rule changes with town tier", pinned by the
   * L17 unit test), so the grown art must never claim tiles.
   *
   * Absent means LEGACY (`TOWN_TIER_LEGACY`): draw exactly what towns always
   * drew. `generateMap` never sets it — the map stays a pure function of the
   * seed, byte-identical for every client — and the game assigns it where
   * track bytes are stamped at boot (`seedTownRoads`' pattern): 0 under the
   * new loop, the seat's `townLevel` as upgrades confirm, the save's `towns`
   * on a restore. The shipped loop, the rooms and the story never touch it,
   * so their towns keep today's look unchanged.
   */
  level?: number;
  /**
   * TOWN-3 (#561): a generated 1940s–50s town name ("Millbrook",
   * "Hartwell"...), seeded from the map's seed alone (`deriveTownNames` in
   * `town-names.ts`) — deterministic per map and never repeated within one
   * map. `generateMap` always fills it (from its own private RNG stream, so
   * drawing it never perturbs the terrain/industry/town PLACEMENT stream —
   * every seed keeps its byte-identical geometry); optional only so the
   * hand-built synthetic grids in unit tests, which build a `Town` literal
   * directly, stay valid without naming anything. Every UI surface that used
   * to print "Town N" reads this first and falls back to that only when it
   * is absent.
   */
  name?: string;
  /**
   * TOWN-2 (#653): house tiles standing on an ORGANIC avenue's frontage, as
   * tile indices (`idx(x, y)`). An organic town paints these as 1×1 wedge
   * lots — the slim lots a diagonal street leaves on a rectangular lattice —
   * so no block or long building is ever drawn over the avenue's edge
   * (`townBuildings`, organic path). Absent on grid-plan towns (and on towns
   * without an avenue); regenerated from the seed with the rest of the map,
   * so nothing here travels on a save or the MP wire.
   */
  organicWedges?: number[];
  /**
   * TOWN-2 (#653): the organic town's 45° AVENUE links, one per pair of
   * diagonal-neighbour avenue tiles, as `(ax, ay, bx, by)`. The town's road
   * TILES ride `roads` as always; this is the extra diagonal connectivity
   * between them, stamped onto the track at boot by `seedTownDiagonals`
   * (track.ts) right after `seedTownRoads` has paved the endpoints — the same
   * boot-stamp pattern, for the same reason: the map stores the INTENT, the
   * game applies it, and no player-built rule (`roadDiagonalRefusal`, which
   * refuses diagonals onto town tiles) stands between them. Absent on
   * grid-plan towns; deterministic from the seed.
   */
  organicDiag?: [number, number, number, number][];
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
  /**
   * Playtest (2026-09) / #298: what the RUNNING GAME has built on a tile that
   * the map itself does not stamp in `occupancy` — the railway, the truck
   * Depots, and processing plants / town buildings.
   * Set by the game; absent in tests and tools, where nothing is built.
   *   "rail-x"/"rail-y": a straight rail tile along x / along y (a road may
   *   cross it at a right angle); "rail": any other rail tile; "platform": a
   *   rail structure; "depot": a truck Depot's 2×2 lot; "plant": a processing
   *   plant / Factory footprint tile, or a town building, in whatever rotation
   *   that footprint was laid (`rotatedSpan`). A plant blocks the other seat's
   *   roads, everyone's rail, and depot placement. The owner's own road drag
   *   still steps over their plant (`structures` in `previewDrag`, PP-15) —
   *   those tiles are not paved. Town STREETS are not plants: rail may still
   *   cross them. The L17 grown ring is visual only and is not reported here.
   */
  builtAt?: (tx: number, ty: number) => GridBuilt | null;
  /** Seed-derived elevation levels. Option-off maps contain all zeroes. */
  height?: Uint8Array;
  /**
   * F4 (#275): the Factory footprint THIS MAP plays with — the long
   * `factory_2x4` span under the `shapes` option, absent on every legacy /
   * option-OFF map (all rules then fall back to `FACTORY_FOOTPRINT`). Lives
   * on the grid because the map is what carries the option: every factory
   * rule that holds a grid reads it here, so the placement preview, the click
   * handler, the rival's search and `builtAt` can never disagree about the
   * footprint. Multiplayer regenerates from the seed alone (shapes are solo),
   * so both seats always see the same value.
   */
  factoryFootprint?: [number, number];
  /**
   * R1 (#260): the river layer. One byte per tile, non-zero where a generated
   * river flows. River tiles are ALSO `WATER` in `terrain` (so every gameplay
   * check — build refusal, rail terrain, placement — treats them as water);
   * this mask only exists so the renderer can give rivers their own texture
   * and banks instead of the open-ocean look. Absent when the map was
   * generated without the `rivers` option (the default), so option-OFF maps
   * stay byte-identical to today's.
   */
  rivers?: Uint8Array;
}

/** R1 (#260): the map-generation options. All default to the historical behaviour. */
export interface MapGenOptions {
  /** Generate 1–3 seeded rivers. OFF (default) keeps every seed byte-identical. */
  rivers?: boolean;
  /** Generate the seed-derived height map. OFF (default) keeps old maps flat. */
  elevation?: boolean;
  /**
   * PROG-1 (#475): how rugged the seed-derived height map is. `strong`
   * (the Highlands scenario) raises the interior sooner and rolls more
   * jitter into it, so climbs are longer and flat footprints are scarce.
   * Absent reads as `normal`: the historical field, byte for byte.
   */
  elevationStrength?: "normal" | "strong";
  /**
   * PROG-1 (#475): the River Valley scenario's waterfront rule — every
   * industry spawns within WATERFRONT_REACH tiles of water (sea or a carved
   * river). OFF (default) keeps every seed byte-identical.
   */
  waterfrontIndustries?: boolean;
  /**
   * PROG-1 (#475): how many towns the map seats. Absent reads as the
   * historical 4 (the Twin Towns scenario seats 2).
   */
  townCount?: number;
  /**
   * PROG-1 (#475): the Archipelago scenario's sea channels — two
   * edge-to-edge water cuts that split the island into pieces, so roads and
   * rail must bridge between them. OFF (default) keeps every seed
   * byte-identical.
   */
  archipelago?: boolean;
  /**
   * F4 (#275): use the new non-square shapes. Towns merge pairs of blocks
   * along a street so 1×3/3×1 and 2×4/4×2 buildings fit (#273's art), and the
   * Factory stands on its long `factory_2x4` footprint. OFF (default) keeps
   * every seed byte-identical to today's generator — no RNG draw changes, no
   * tile moves.
   */
  shapes?: boolean;
  /**
   * #296: a one-tile RING ROAD around every town, joined to its streets, so a
   * Factory has a clean edge to stand against. OFF (default) keeps every seed
   * byte-identical; MAP-1 turns it on for new games.
   */
  rings?: boolean;
  /**
   * TOWN-2 (#653): the town street plan. `"grid"` (the default, and what every
   * map generated before TOWN-2 used) lays each town as a full rectangle of
   * 2×2 blocks on the 3-tile lattice. `"organic"` keeps the lattice for the
   * town's core, then drops outer blocks by a seeded noisy radius (an
   * irregular outline), carves one or two 45° avenues through the town centre
   * and merges more block pairs into 2×4 / 4×2 / 4×4 plots. Absent reads as
   * `"grid"`, so every existing seed stays byte-identical.
   */
  layout?: TownLayout;
  /**
   * FTUE-1 (#464): a map PRESET — the scenario's shape on top of the seed
   * (Starter Island). Absent (every default map) changes nothing: the preset
   * stages below only draw when one is passed, so the ordinary generator is
   * byte-identical with or without the field existing.
   */
  preset?: MapPreset;
  /**
   * TOWN-4.1 (#677): the size the caller expects. The size itself is the
   * BOOT's to set — `setMapSize`, once, before any map-sized allocation — so
   * this generates nothing; it is checked against the live size, and a
   * mismatch throws rather than build a map the save and the wire would
   * disagree with. Absent (every caller before TOWN-4.1): no check.
   */
  size?: MapSizeName;
}

/**
 * FTUE-1 (#464) — the shape of a scenario map, beyond its seed.
 *
 * PROG-1 grows this into a shelf of scenarios (River Valley, Highlands, …);
 * the Starter Island is the first one. It is DATA, not a fork: the generator
 * reads these numbers through the same stages every map runs — only the
 * counts, the neighbourhood and the apron change.
 */
export interface MapPreset {
  /** Stable id (debug, saves, PROG-1's scenario list). */
  key: string;
  /** Exactly one industry of each listed type — the map's whole industry set. */
  industries: readonly string[];
  /** Towns to place (the ordinary map places TOWN_COUNT). */
  towns: number;
  /**
   * The industries ring the town: each footprint's CENTRE lands at this
   * Chebyshev distance from the cluster centre (the town's own), so "close
   * by" is a guarantee of the generator and not a hope about the seed.
   */
  industryRing: readonly [number, number];
  /**
   * Gentle terrain: a flat apron of this many tiles around every industry
   * (its own level, rough ground cleared). #436 landed the apron on every
   * map at `INDUSTRY_APRON`; a preset overrides the RING WIDTH (the Starter
   * Island asks for 4) and its own rough-ground clearing, so the scenario
   * plays the same before and after that landed.
   */
  industryApron: number;
}

/** FTUE-1 (#464): the Starter Island — one town, four industries close by. */
export const STARTER_ISLAND: MapPreset = {
  key: "starter-island",
  // farm, forest, ore, quarry — the four the guide's chain teaches with.
  industries: ["farm", "forest", "ore_mine", "quarry"],
  towns: 1,
  industryRing: [22, 28],
  industryApron: 4,
};

/**
 * FTUE-1 (#464): the Starter Island's fixed seed. The scenario is a PLACE —
 * every first launch (and every replay) sees the same island — so the seed is
 * a constant, not a draw. `starterIslandGrid()` is the one door.
 */
export const STARTER_ISLAND_SEED = 20260926;

/**
 * What the game says stands on a tile (`Grid.builtAt`), for the rules that must
 * not build through a building or over rail.
 *
 * R2 (#266): `"bridge"` is a deck — track of either layer standing on WATER.
 * It is derived, not stored: nothing else in the game can put track on water,
 * so "water + track" IS a bridge (see `bridges.ts`), and one entry in this
 * union is all the other builders need to keep off it.
 *
 * R3 (#270): `"dam"` is a hydro dam's FOOTPRINT — its river tile and the bank
 * tile it leans onto (`dams.ts`). A dam is a standing structure the way a
 * Depot or a platform is one, so roads and rail refuse its tiles the same
 * way they refuse theirs, and the bank — dry land the map would otherwise
 * pave over — is protected by this tag.
 */
export type GridBuilt =
  | "rail" | "rail-x" | "rail-y" | "platform" | "depot" | "plant" | "bridge" | "dam";

/**
 * #298: a footprint after `quarterTurns` clockwise quarter-turns. The anchor
 * stays the origin and the span grows toward +x/+y — the same convention as a
 * rail platform (`se` is [1,3], `sw` is [3,1]). An odd turn swaps the axes.
 * Square art is unchanged in every rotation.
 */
export function rotatedSpan(w: number, h: number, quarterTurns = 0): [number, number] {
  const q = ((quarterTurns % 4) + 4) % 4;
  return q % 2 === 0 ? [w, h] : [h, w];
}

/** Every tile of a footprint anchored at (tx, ty), after `quarterTurns`. */
export function footprintTilesAt(
  tx: number, ty: number, w: number, h: number, quarterTurns = 0,
): [number, number][] {
  const [fw, fh] = rotatedSpan(w, h, quarterTurns);
  const out: [number, number][] = [];
  for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) out.push([tx + x, ty + y]);
  return out;
}

/** True when (x, y) lies on that rotated footprint. */
export function tileInFootprint(
  x: number, y: number,
  tx: number, ty: number, w: number, h: number, quarterTurns = 0,
): boolean {
  const [fw, fh] = rotatedSpan(w, h, quarterTurns);
  return x >= tx && x < tx + fw && y >= ty && y < ty + fh;
}

/**
 * A town HOUSE tile (the centre counts), not a street. Streets are also
 * `TOWN_OCC`, but they are roads — rail may cross them. A house with no
 * occupancy stamp does not count: synthetic towns that were never stamped
 * are not obstacles.
 */
export function townHouseAt(grid: Grid, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty) || grid.occupancy[idx(tx, ty)] !== TOWN_OCC) return false;
  for (const t of grid.towns) {
    if (t.tx === tx && t.ty === ty) return true;
    if (t.houses.some(([hx, hy]) => hx === tx && hy === ty)) return true;
  }
  return false;
}

/**
 * #298: tiles a town's BUILDINGS claim — every house, plus each drawn
 * building's footprint in its rotation. A building whose origin `skipOrigin`
 * accepts (the L17 grown ring) is visual only and claims nothing. Streets are
 * not included, so a highway can still meet the town and rail can still cross
 * a straight street.
 */
export function townObstacleTiles(
  town: Town,
  buildings: readonly { tx: number; ty: number; w: number; h: number; rot?: number }[],
  skipOrigin?: (tx: number, ty: number) => boolean,
): [number, number][] {
  const seen = new Set<number>();
  const out: [number, number][] = [];
  const add = (x: number, y: number) => {
    if (!inBounds(x, y)) return;
    const i = idx(x, y);
    if (seen.has(i)) return;
    seen.add(i);
    out.push([x, y]);
  };
  add(town.tx, town.ty);
  for (const [hx, hy] of town.houses) add(hx, hy);
  for (const b of buildings) {
    if (skipOrigin?.(b.tx, b.ty)) continue;
    for (const [x, y] of footprintTilesAt(b.tx, b.ty, b.w, b.h, b.rot ?? 0)) add(x, y);
  }
  return out;
}

/**
 * PROG-1 (#475): the Archipelago's sea channels — two 3-wide meandering cuts
 * across the whole map, sea to sea, so the island ends up in four pieces.
 * The bases are shared constants: the town placer reads them to seat one
 * town per quadrant.
 */
export let ARCHIPELAGO_VX = Math.floor(MAP_W * 0.38);
export let ARCHIPELAGO_HY = Math.floor(MAP_H * 0.62);
// TOWN-4.1 (#677): already RELATIVE to the map, so they follow its size — live
// bindings re-derived on every `setMapSize` (computed once at import, they
// froze at 144 and would cut a 216 map off-centre).
onMapSize(() => {
  ARCHIPELAGO_VX = Math.floor(MAP_W * 0.38);
  ARCHIPELAGO_HY = Math.floor(MAP_H * 0.62);
});
/** How far a channel may meander from its base (plus its 1-tile half-width). */
const CHANNEL_WANDER = 11;

function carveChannel(
  t: Uint8Array, mask: Uint8Array | null, rng: () => number,
  dir: "vertical" | "horizontal", base: number,
): void {
  // A random walk, one tile per row at most: consecutive rows always overlap
  // (the cut is 3 wide), so the channel is one 4-connected strip, sea to sea.
  // Independent jitter per row would outrun the width and leave land gaps —
  // and `fillCoastalHoles` fills a disconnected segment with sand.
  const len = dir === "vertical" ? MAP_H : MAP_W;
  let off = 0;
  for (let i = 0; i < len; i++) {
    off = Math.max(-10, Math.min(10, off + Math.floor(rng() * 3) - 1));
    for (let w = -1; w <= 1; w++) {
      const x = dir === "vertical" ? base + off + w : i;
      const y = dir === "vertical" ? i : base + off + w;
      if (!inBounds(x, y)) continue;
      t[idx(x, y)] = WATER;
      if (mask) mask[idx(x, y)] = 1;
    }
  }
}

/**
 * PROG-1 (#475): the Archipelago's four town quadrants — the rectangles
 * between the channels, inset past the furthest a channel can wander, so a
 * town seeded in one can never touch the water. Town `i` samples its centre
 * in quadrant `i % 4`.
 */
export function archipelagoRegions(): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const m = CHANNEL_WANDER + 2;
  return [
    { x0: 4, y0: 4, x1: ARCHIPELAGO_VX - m, y1: ARCHIPELAGO_HY - m },
    { x0: ARCHIPELAGO_VX + m, y0: 4, x1: MAP_W - 5, y1: ARCHIPELAGO_HY - m },
    { x0: 4, y0: ARCHIPELAGO_HY + m, x1: ARCHIPELAGO_VX - m, y1: MAP_H - 5 },
    { x0: ARCHIPELAGO_VX + m, y0: ARCHIPELAGO_HY + m, x1: MAP_W - 5, y1: MAP_H - 5 },
  ];
}

function makeTerrain(
  rng: () => number, archipelago = false,
): { terrain: Uint8Array; channels: Uint8Array | null } {
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

  // PROG-1 (#475): the Archipelago's sea channels go in while the map is
  // still one island — the rough blobs below avoid the water and the beach
  // ring lines the new banks like any other coast. Fully skipped when off:
  // no draws, no tile moves, option-OFF seeds byte-identical.
  const channels = archipelago ? new Uint8Array(MAP_W * MAP_H) : null;
  if (archipelago && channels) {
    carveChannel(t, channels, rng, "vertical", ARCHIPELAGO_VX);
    carveChannel(t, channels, rng, "horizontal", ARCHIPELAGO_HY);
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
  return { terrain: t, channels };
}

// ── R1 (#260): rivers ──────────────────────────────────────────────────────
//
// Rivers are carved into the terrain AFTER `makeTerrain` and BEFORE
// `placeIndustries`/`placeTowns`, so industries, towns and the public
// highways all treat them as WATER and route around them by construction.
//
// Each river is a single open random walk from an inland source down to the
// sea: it only ever steps towards (or across) the sea's distance field, never
// onto its own water, so it cannot loop back and enclose land. A river whose
// carve would nonetheless split the island into two landmasses is discarded
// (the terrain is restored) and another source is tried — the generator's
// reachability invariant ("every town and industry on ONE landmass") therefore
// holds with rivers exactly as it does without them.
//
// Determinism: the whole pass runs off the caller's seeded stream and draws
// nothing when the `rivers` option is off, so option-OFF seeds generate
// byte-identical maps to the pre-river generator.

/**
 * 4-connected component count of the land (non-WATER) tiles. Exported for
 * the Archipelago scenario's invariant (its channels split the island).
 */
export function landComponentCount(terrain: Uint8Array): number {
  const seen = new Uint8Array(terrain.length);
  let comps = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (seen[i] || terrain[i] === WATER) continue;
    comps++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const ni = ny * MAP_W + nx;
        if (seen[ni] || terrain[ni] === WATER) continue;
        seen[ni] = 1;
        stack.push(ni);
      }
    }
  }
  return comps;
}

/**
 * BFS distance from every tile to the nearest OCEAN tile — water that is
 * 4-connected to the map border. Inland lakes (which `fillCoastalHoles` later
 * turns to sand) stay at 0xffff, so a river is never drawn towards a lake it
 * could not actually drain into.
 */
function distanceToSea(terrain: Uint8Array): { dist: Uint16Array; sea: Uint8Array } {
  // First: which water is the open ocean (4-connected to the map border)?
  const sea = new Uint8Array(terrain.length);
  const wq: number[] = [];
  const seedSea = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return;
    const i = idx(x, y);
    if (terrain[i] === WATER && !sea[i]) { sea[i] = 1; wq.push(i); }
  };
  for (let x = 0; x < MAP_W; x++) { seedSea(x, 0); seedSea(x, MAP_H - 1); }
  for (let y = 0; y < MAP_H; y++) { seedSea(0, y); seedSea(MAP_W - 1, y); }
  for (let head = 0; head < wq.length; head++) {
    const cur = wq[head], x = cur % MAP_W, y = (cur / MAP_W) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (terrain[ni] === WATER && !sea[ni]) { sea[ni] = 1; wq.push(ni); }
    }
  }
  // Then: distance from the ocean over every tile (sea tiles are 0).
  const dist = new Uint16Array(terrain.length).fill(0xffff);
  const queue: number[] = [];
  for (let i = 0; i < terrain.length; i++) if (sea[i]) { dist[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head], x = cur % MAP_W, y = (cur / MAP_W) | 0;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
      const ni = ny * MAP_W + nx;
      if (dist[ni] !== 0xffff) continue;
      dist[ni] = dist[cur] + 1;
      queue.push(ni);
    }
  }
  return { dist, sea };
}

const RIVER_DIRS: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/**
 * Carve 1–3 meandering rivers into `terrain` (they become WATER) and return
 * the river mask. Every river runs from an inland source to the sea, is 1–2
 * tiles wide, and is discarded if it would split the island's landmass.
 * Draws from `rng` only — pure under the seed.
 */
export function carveRivers(terrain: Uint8Array, rng: () => number): Uint8Array {
  const mask = new Uint8Array(terrain.length);
  const baseComps = landComponentCount(terrain);
  const count = 1 + Math.floor(rng() * 3);                  // 1..3 rivers
  for (let r = 0; r < count; r++) {
    // A river slot gets a few attempts: a carve that would split the island
    // is reverted and retried from another source before giving up.
    for (let tries = 0; tries < 3; tries++) {
      const { dist: distSea, sea } = distanceToSea(terrain);
      // An inland source: land comfortably away from the sea so the river has
      // some length. A few draws, else this attempt has no source.
      let sx = -1, sy = -1;
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = 6 + Math.floor(rng() * (MAP_W - 12));
        const y = 6 + Math.floor(rng() * (MAP_H - 12));
        const i = idx(x, y);
        if (terrain[i] !== WATER && distSea[i] >= 18 && distSea[i] < 0xfff0) { sx = x; sy = y; break; }
      }
      if (sx < 0) continue;

      const snapshot = terrain.slice();
      // Phase 1 — a 1-wide meandering SPINE from the source down to the sea.
      // No widening here, so the head always has the downhill tile available
      // and therefore reaches the coast.
      const spine: number[] = [];
      let cx = sx, cy = sy;
      let steps = 0;
      let reached = false;
      while (terrain[idx(cx, cy)] !== WATER && steps < 600) {
        steps++;
        const here = idx(cx, cy);
        terrain[here] = WATER; spine.push(here);
        let best: [number, number] | null = null;
        let bestScore = Infinity;
        for (const [dx, dy] of RIVER_DIRS) {
          const nx = cx + dx, ny = cy + dy;
          if (!inBounds(nx, ny)) continue;
          const ni = idx(nx, ny);
          if (terrain[ni] === WATER) {
            // Ocean (or an earlier river the sea-flood already includes)
            // terminates the walk; inland lakes are skipped — they can't drain.
            if (sea[ni] && bestScore > -1) { bestScore = -1; best = [nx, ny]; }
            continue;
          }
          if (mask[ni]) continue;
          const climb = distSea[ni] - distSea[here];
          if (climb > 1) continue;                            // never climb away from the sea
          const score = distSea[ni] + (rng() * 2 - 1) * 2.2;  // meander jitter
          if (score < bestScore) { bestScore = score; best = [nx, ny]; }
        }
        if (!best) break;                                     // boxed in: river ends here
        if (terrain[idx(best[0], best[1])] === WATER) reached = true;
        [cx, cy] = best;
      }
      if (spine.length < 8 || !reached || landComponentCount(terrain) !== baseComps) {
        terrain.set(snapshot);
        continue;                                             // retry this river slot
      }
      // Phase 2 — widen to 2 tiles where a lateral tile doesn't split the
      // island. Widening is cosmetic; if the widened river is unsafe the
      // laterals revert and the 1-wide spine is kept.
      const laterals: [number, number][] = [];               // [tile, original terrain]
      for (const si of spine) {
        if (rng() >= 0.5) continue;
        const [dx, dy] = RIVER_DIRS[Math.floor(rng() * 4)];
        const x = (si % MAP_W) + dx, y = ((si / MAP_W) | 0) + dy;
        if (!inBounds(x, y)) continue;
        const li = idx(x, y);
        if (terrain[li] === WATER) continue;                 // only onto dry land
        if (mask[li]) continue;
        laterals.push([li, terrain[li]]);
        terrain[li] = WATER;
      }
      if (laterals.length && landComponentCount(terrain) !== baseComps) {
        for (const [li, orig] of laterals) terrain[li] = orig;
        laterals.length = 0;
      }
      for (const i of spine) mask[i] = 1;
      for (const [li] of laterals) mask[li] = 1;
      break;                                                  // this river is committed
    }
  }
  return mask;
}

/**
 * PROG-1 (#475): how close to water a River Valley industry spawns — the
 * footprint's edge within this many tiles (Chebyshev) of sea or river water.
 */
export const WATERFRONT_REACH = 6;

/** True when a `w`×`h` footprint at (tx,ty) sits within `reach` of water. */
export function footprintNearWater(
  terrain: Uint8Array, tx: number, ty: number, w: number, h: number,
  reach = WATERFRONT_REACH,
): boolean {
  for (let x = tx - reach; x < tx + w + reach; x++) {
    for (let y = ty - reach; y < ty + h + reach; y++) {
      if (!inBounds(x, y)) continue;
      if (terrain[idx(x, y)] === WATER) return true;
    }
  }
  return false;
}

// ── TOWN-4.1 (#677): spacing on a larger map ──────────────────────────────
//
// T4's rule for a bigger map, applied again: COUNTS stay fixed (INDUSTRY_QUOTA,
// TOWN_COUNT — a large map does not get more towns or industries) and the
// extra room goes to SEPARATION. Every absolute tile distance below was tuned
// on the standard 144 map, and on a larger one it scales by the side ratio
// (216 / 144 = 1.5):
//
//   constant / site                        standard → large (216)
//   industry spacing ladder (placeIndustries)  12 8 6 4 2 1 → 18 12 9 6 3 1
//                                          (the last rung, 1 = overlap-only, stays)
//   industry re-site ladder (applyRoadSpawnBuffer) 12 8 6 4 2 → 18 12 9 6 3
//   INDUSTRY_ROAD_SEP  (highway verge)      10 → 15
//   TOWN_INDUSTRY_SEP  (the town's industry ring) 8 → 12
//   REPAIR_REACH       (re-site search radius) 24 → 36
//   TOWN_TOWN_SEP      (town centres)       28 → 42
//                                          (the ladder's fallback rungs 6 4 2 stay:
//                                          they only exist so every town places)
//   ARCHIPELAGO_VX/HY  — already relative (0.38 / 0.62 of a side), live.
//
// Deliberately NOT scaled: counts (above); town spans (TOWN-4.3 grows towns);
// the map-edge margins; terrain shape — the elevation ramp (1 level per 10
// tiles from the edge), river sources (≥18 tiles from the sea) and the rough
// blobs; and the knobs only standard-size places use — the Starter Island
// preset's ring and jitter, the archipelago channel wander, WATERFRONT_REACH.
//
// On a standard map `spread` returns its argument untouched — no multiply, no
// rounding — so every standard seed stays byte-identical (pinned in
// tests/unit/town-4-1-map-size.test.ts).

/** The side ratio a larger map spreads its features by: exactly 1 on standard. */
export function mapSpread(): number {
  const side = Math.min(MAP_W, MAP_H);
  return side === MAP_SIZES.standard ? 1 : side / MAP_SIZES.standard;
}

/** A spacing distance tuned on the standard map, at the current map's spread. */
export function spread(tiles: number): number {
  const k = mapSpread();
  return k === 1 ? tiles : Math.max(1, Math.round(tiles * k));
}

/** A separation ladder at the current spread; an overlap-only rung (≤1) stays. */
const spreadLadder = (ladder: readonly number[]): number[] =>
  ladder.map((sep) => (sep > 1 ? spread(sep) : sep));

function placeIndustries(
  terrain: Uint8Array, rng: () => number,
  preset?: MapPreset, centre?: [number, number] | null, waterfront = false,
  /** Industries-after-terrain: the flatness gate over the natural field.
   *  Absent (elevation OFF) → no gate and the historical draw sequence. */
  gate?: SiteGate,
): { list: Industry[]; occ: Int16Array } {
  // Tier wanted on attempt `a` of `n`: flat first, then nearly flat.
  const want = (a: number, n: number): 0 | 1 | 2 => (!gate ? 0 : a < n / 2 ? 2 : 1);
  const flatOk = (tx: number, ty: number, w: number, h: number, tier: 0 | 1 | 2) =>
    !gate || tier === 0 || gate(tx, ty, w, h, tier);
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

  // PROG-1 (#475): the waterfront test. Rivers are terrain WATER by now
  // (carved before this stage), so a riverbank counts exactly like a shore.
  const nearWater = (tx: number, ty: number, w: number, h: number): boolean =>
    footprintNearWater(terrain, tx, ty, w, h);

  const defs = INDUSTRIES.map((d) => ({ d, n: INDUSTRY_QUOTA[d.key] ?? 0 }));

  // FTUE-1 (#464): a PRESET map places exactly the listed types, one of each,
  // in one neighbourhood — each footprint's centre inside the preset's ring
  // around the cluster centre the caller drew. No quota ladder, no scatter:
  // "four industries close by" is a construction, not a seed to hunt for.
  if (preset && centre) {
    const wanted = preset.industries
      .map((key) => INDUSTRY_BY_KEY[key])
      .filter((d): d is NonNullable<typeof d> => !!d);
    for (const d of wanted) {
      const w = d.footprint[0], h = d.footprint[1];
      let done = false;
      for (const sep of [6, 4, 3, 2, 1]) {
        for (let attempt = 0; attempt < 120 && !done; attempt++) {
          const ang = rng() * Math.PI * 2;
          const r = preset.industryRing[0]
            + rng() * (preset.industryRing[1] - preset.industryRing[0]);
          const tx = Math.round(centre[0] + Math.cos(ang) * r - w / 2);
          const ty = Math.round(centre[1] + Math.sin(ang) * r - h / 2);
          if (footprintFree(tx, ty, w, h) && separated(tx, ty, w, h, sep)
            && flatOk(tx, ty, w, h, sep === 1 && attempt >= 60 ? 0 : want(attempt, 80))) {
            list.push({
              id: list.length, type: d.key, tx, ty, w, h,
              output: d.output, banditUntil: 0,
            });
            for (let x = 0; x < w; x++) {
              for (let y = 0; y < h; y++) occ[idx(tx + x, ty + y)] = list.length - 1;
            }
            done = true;
          }
        }
        if (done) break;
      }
    }
    list.forEach((ind, i) => { ind.id = i; });
    return { list, occ };
  }
  // try to guarantee the quota: relax separation 12 → … → 1 (overlap-only).
  // T4: on the 144×144 map the same INDUSTRY_QUOTA has 9× the room, so start
  // from a much wider target sep (was 6) and let the fallback converge; this
  // spreads industries instead of letting them clump as the old sep would.
  // PROG-1 (#475): the waterfront rule narrows the eligible ground, so it gets
  // more attempts per industry; the rule itself never relaxes (a River Valley
  // industry off the water is not a River Valley industry).
  const tries = (waterfront ? 250 : 90) * (gate ? 2 : 1);
  // TOWN-4.1: the ladder spreads with a larger map (see `mapSpread`).
  for (const sep of spreadLadder([12, 8, 6, 4, 2, 1])) {
    let placedAny = true;
    while (placedAny) {
      placedAny = false;
      for (const { d, n } of defs) {
        const have = list.filter((i) => i.type === d.key).length;
        for (let k = have; k < n; k++) {
          const w = d.footprint[0], h = d.footprint[1];
          let done = false;
          // At the last separation a gated map gets one more round with no
          // flatness wish: the quota outranks the ground (the small levelled
          // patch in `makeElevation` still gives the Depot its catchment).
          const rounds = gate && sep === 1 ? tries * 2 : tries;
          for (let attempt = 0; attempt < rounds && !done; attempt++) {
            const tx = Math.floor(rng() * (MAP_W - w + 1));
            const ty = Math.floor(rng() * (MAP_H - h + 1));
            if (footprintFree(tx, ty, w, h) && separated(tx, ty, w, h, sep)
              && (!waterfront || nearWater(tx, ty, w, h))
              && flatOk(tx, ty, w, h, attempt >= tries ? 0 : want(attempt, tries))) {
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
export const INDUSTRY_ROAD_SEP = 10;   // standard-map value; `spread()` scales it (TOWN-4.1)

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
  publicRoads: [number, number][],
  opts: { waterfront?: boolean; connected?: boolean } = {},
  /** Industries-after-terrain: a re-sited node keeps to flat ground too. */
  gate?: SiteGate,
): void {
  const waterfront = opts.waterfront === true;
  const connected = opts.connected !== false;
  // TOWN-4.1 (#677): the three distances this repair measures, at the map's
  // spread (identical to the constants on a standard map).
  const roadSep = spread(INDUSTRY_ROAD_SEP);
  const townSep = spread(TOWN_INDUSTRY_SEP);
  const reach = spread(REPAIR_REACH);
  // The buffer is measured from the HIGHWAY tiles only.
  //
  // The rule is that a resource node must not spawn in a verge a Depot can
  // park on for free, and it used to measure from the town streets as well.
  // That was right when a town's road was a ring of perhaps twenty tiles. The
  // grid towns carry well over a hundred street tiles spread across 13-19
  // tiles of ground, so a 10-tile Chebyshev buffer from every one of them
  // excluded a box roughly forty tiles across per town — most of the island,
  // four times over. Industries ended up flung to the coast, and the opening
  // corridor from an industry to a town-adjacent Factory site stopped
  // existing (E14's picker could find no legal 4-12 tile run on any seed).
  //
  // Nothing is lost by dropping the streets from this field: `townField`
  // below already holds every town tile — houses AND streets — at
  // TOWN_INDUSTRY_SEP, so a node beside a street is still refused. The two
  // buffers were double-counting the same tiles.
  const roadSet = new Set<number>();
  for (const [x, y] of publicRoads) roadSet.add(idx(x, y));
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
  // PROG-1 (#475): on a disconnected map (the Archipelago) every industry
  // seeds its own island's flood, so a node on another island can still be
  // re-sited. Connected maps flood from the first tile exactly as before.
  const open = new Uint8Array(MAP_W * MAP_H);
  {
    const seeds = connected
      ? (list[0] ? [idx(list[0].tx, list[0].ty)] : [])
      : list.map((ind) => idx(ind.tx, ind.ty));
    const stack: number[] = [];
    for (const start of seeds) {
      if (start < 0 || open[start]) continue;
      stack.push(start);
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
    wantWater = false, tier: 0 | 1 | 2 = 0,
  ): [number, number] | null => {
    for (let d = 1; d <= reach; d++) {
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
                && roadField[i] >= roadSep
                && townField[i] >= townSep
                && (sep <= 1 || sepField[i] >= sep);
            }
          }
          // PROG-1 (#475): on a waterfront map the repair keeps the rule —
          // the re-sited industry stays on the water. Off maps never pass
          // wantWater, so their search order is untouched.
          if (ok && wantWater && !footprintNearWater(terrain, tx, ty, w, h)) ok = false;
          if (ok && tier && gate && !gate(tx, ty, w, h, tier)) ok = false;
          if (ok) return [tx, ty];
        }
      }
    }
    return null;
  };

  // Anything inside a public road's verge moves — or inside a town ring an
  // earlier move tightened.
  const near = industriesInRoadBuffer(list, roadField, roadSep)
    .concat(industriesInRoadBuffer(list, townField, townSep))
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
    // PROG-1 (#475): on a waterfront map the ladder runs twice — first for a
    // site that keeps the industry on the water, then (a hostile seed may
    // have none within reach) for any legal site. The map stays valid either
    // way; the quota is never dropped for the rule.
    const ladders = waterfront ? [true, false] : [false];
    // Industries-after-terrain: flat ground first, then nearly flat, then any.
    const tiers: (0 | 1 | 2)[] = gate ? [2, 1, 0] : [0];
    for (const wantWater of ladders) {
      for (const tier of tiers) {
        for (const sep of spreadLadder([12, 8, 6, 4, 2])) {
          found = nearestFit(ind.tx, ind.ty, ind.w, ind.h, sep, sepField, wantWater, tier);
          if (found) break;
        }
        if (found) break;
      }
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

/** How far (Chebyshev) a buffered industry may be stepped to find legal ground.
 *  Standard-map value; `spread()` scales it on a larger map (TOWN-4.1). */
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
 * T4 widens the former 3-tile ring to 8 on the roomier map. Standard-map
 * value; `spread()` scales it on a larger map (TOWN-4.1). */
const TOWN_INDUSTRY_SEP = 8;
/** TOWN-1: minimum Chebyshev distance between two town centres. Standard-map
 *  value; `spread()` scales it on a larger map (TOWN-4.1). */
const TOWN_TOWN_SEP = 28;
/** TOWN-1: occupancy sentinel for town tiles (distinct from industry indices ≥ 0). */
export const TOWN_OCC = -2;
/**
 * RES-FIELDS: occupancy sentinel for a standing wheat field or tree block
 * beside a resource. It blocks building like any other occupant until the
 * player demolishes it, which puts the tiles back to -1.
 */
export const FIELD_OCC = -3;

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
  /**
   * TOWN-2 (#653): lay each lane over the FULL built extent, not just the
   * seeded box. The box edge can cut a block column in half — `span` 9 puts
   * the westmost origin column exactly on `cx - span`, whose street lane at
   * `cx - span - 1` then fell OUTSIDE this loop and never got laid, leaving
   * the edge block's lots without frontage. The grid plan keeps the old
   * bounds (every existing seed stays byte-identical); organic towns pass
   * this flag, because their notch bites sit the outline's blocks right on
   * that edge far more often.
   */
  fullLaneExtent = false,
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
  const layLane = (line: [number, number][], overhang: boolean) => {
    let first = -1, last = -1;
    for (let i = 0; i < line.length; i++) {
      if (!nearHouse(line[i][0], line[i][1])) continue;
      if (first === -1) first = i;
      last = i;
    }
    if (first === -1) return;
    // Only the EXIT lanes run past the last house.
    //
    // Every lane used to, and that littered the ring of land just outside the
    // town with street tiles at three-tile intervals. Those tiles are
    // TOWN_OCC, a Factory footprint may not overlap them, and a Factory has to
    // be able to stand against a town — so the opening corridor from an
    // industry to a town-adjacent Factory site had almost nowhere to land
    // (E14's picker reported `factory-not-near-town` on every seed). One exit
    // per axis is all the inter-town highway needs to find its way in.
    if (overhang) {
      first = Math.max(0, first - 1);
      last = Math.min(line.length - 1, last + 1);
    }
    for (let i = first; i <= last; i++) addRoad(line[i][0], line[i][1]);
  };

  /** The lane nearest the centre on each axis: the town's two through-roads. */
  const nearestLane = (from: number, to: number, centre: number): number => {
    let best = centre, bestD = Infinity;
    for (let v = from; v <= to; v++) {
      if (!onLane(v, centre)) continue;
      const d = Math.abs(v - centre);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best;
  };
  const exitCol = nearestLane(cx - span, cx + span, cx);
  const exitRow = nearestLane(cy - span, cy + span, cy);

  const colLo = fullLaneExtent ? Math.min(cx - span, hx0 - 1) : cx - span;
  const colHi = fullLaneExtent ? Math.max(cx + span, hx1 + 1) : cx + span;
  const rowLo = fullLaneExtent ? Math.min(cy - span, hy0 - 1) : cy - span;
  const rowHi = fullLaneExtent ? Math.max(cy + span, hy1 + 1) : cy + span;
  for (let lx = colLo; lx <= colHi; lx++) {
    if (!onLane(lx, cx) || lx < hx0 - 1 || lx > hx1 + 1) continue;
    const line: [number, number][] = [];
    for (let ty = hy0 - 1; ty <= hy1 + 1; ty++) line.push([lx, ty]);
    layLane(line, lx === exitCol);
  }
  for (let ly = rowLo; ly <= rowHi; ly++) {
    if (!onLane(ly, cy) || ly < hy0 - 1 || ly > hy1 + 1) continue;
    const line: [number, number][] = [];
    for (let tx = hx0 - 1; tx <= hx1 + 1; tx++) line.push([tx, ly]);
    layLane(line, ly === exitRow);
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

/**
 * #296: a one-tile road loop around the town, one tile outside its houses.
 *
 * The street grid's lanes already run to that line (the exit lanes overhang
 * the last house by one), so the ring joins the streets wherever a lane meets
 * it. Only free land becomes ring (water / an industry / another town leaves
 * a gap). A closed loop could seal free pockets inside it (the reason
 * TOWN-GRID dropped the old ring), so every free tile inside the house box
 * that is neither house nor street is paved as a small square: nothing is
 * left enclosed. Deterministic, no RNG.
 */
export function addTownRing(
  houses: [number, number][], roads: [number, number][],
  terrain: Uint8Array, occ: Int16Array,
): [number, number][] {
  if (!houses.length) return roads;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of houses) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const houseSet = new Set(houses.map(([x, y]) => idx(x, y)));
  const seen = new Set(roads.map(([x, y]) => idx(x, y)));
  const out = roads.slice();
  const free = (x: number, y: number) =>
    inBounds(x, y) && terrain[idx(x, y)] !== WATER && occ[idx(x, y)] === -1;
  const add = (x: number, y: number) => {
    const i = idx(x, y);
    if (!free(x, y) || houseSet.has(i) || seen.has(i)) return;
    seen.add(i);
    out.push([x, y]);
  };
  // the loop, one tile outside the house box
  for (let x = x0 - 1; x <= x1 + 1; x++) { add(x, y0 - 1); add(x, y1 + 1); }
  for (let y = y0; y <= y1; y++) { add(x0 - 1, y); add(x1 + 1, y); }

  // Owner (2026-09-26): empty tiles INSIDE the ring stay land (grass /
  // garden lots). Paving every enclosed free tile turned a sparsely built
  // quarter of a town into a solid block of road - the "parallel roads in
  // towns". An enclosed lot is still reachable: the player lays a road from
  // the ring or a street into it.
  return out;
}

/**
 * F4 (#275): the MERGED BLOCKS that let a town hold the long shapes.
 *
 * A town block is `TOWN_BLOCK - 1` = 2 tiles square, so nothing wider than
 * 2×2 fits one. Under the `shapes` option the generator merges pairs of
 * blocks that sit either side of one street segment: the segment's two tiles
 * stop being street and become house ground, and the two blocks plus the
 * ground between them are one 5×2 (or 2×5) superblock the art places a
 * 1×3/3×1 or 2×4/4×2 building on (`townBuildings`, shapes path).
 *
 * Streets stay intact. A segment between two blocks always runs between two
 * street intersections (the perpendicular lanes one block-period away on
 * either side), so removing it leaves the street network connected — nothing
 * is walled off, no fragment is sealed. The merge is therefore invisible to
 * every rule that walks the streets: the inter-town highway still routes
 * through the town, and the lanes still reach the map edge.
 *
 * Deterministic per town: candidate pairs are visited in row-major block
 * order, each feasible pair draws ONCE from the seeded stream, and a block
 * already in a merge is never offered again. OFF by default — `placeTowns`
 * only calls this with the option on, so option-OFF seeds draw nothing here
 * and stay byte-identical.
 */
export function mergeTownBlocks(
  cx: number, cy: number,
  houses: [number, number][], roads: [number, number][],
  rng: () => number,
  chance = 0.25,
): { houses: [number, number][]; roads: [number, number][] } {
  const BLOCK = TOWN_BLOCK - 1;
  const houseSet = new Set(houses.map(([x, y]) => idx(x, y)));
  const roadSet = new Set(roads.map(([x, y]) => idx(x, y)));
  const isHouse = (x: number, y: number) => inBounds(x, y) && houseSet.has(idx(x, y));
  const isRoad = (x: number, y: number) => inBounds(x, y) && roadSet.has(idx(x, y));

  // Block origins share the centre's phase (townLayout's grid is anchored on
  // it). Collected from the houses so only built blocks are candidates.
  const blockOrigin = (v: number, centre: number) =>
    centre + Math.floor((v - centre) / TOWN_BLOCK) * TOWN_BLOCK;
  const origins: [number, number][] = [];
  {
    const seen = new Set<number>();
    for (const [hx, hy] of houses) {
      const ox = blockOrigin(hx, cx), oy = blockOrigin(hy, cy);
      const i = idx(ox, oy);
      if (seen.has(i)) continue;
      seen.add(i);
      origins.push([ox, oy]);
    }
    origins.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  }

  /** Every tile of the block at (ox, oy) is a house of this town. */
  const fullBlock = (ox: number, oy: number): boolean => {
    for (let dy = 0; dy < BLOCK; dy++) {
      for (let dx = 0; dx < BLOCK; dx++) if (!isHouse(ox + dx, oy + dy)) return false;
    }
    return true;
  };

  const consumed = new Set<number>();
  const toHouse: [number, number][] = [];
  for (const [ox, oy] of origins) {
    if (consumed.has(idx(ox, oy))) continue;
    // Horizontal pair: the block across the lane at x = ox + BLOCK.
    const rx = ox + TOWN_BLOCK;
    if (fullBlock(ox, oy) && fullBlock(rx, oy)
      && isRoad(ox + BLOCK, oy) && isRoad(ox + BLOCK, oy + 1)) {
      if (rng() < chance) {
        consumed.add(idx(ox, oy)); consumed.add(idx(rx, oy));
        toHouse.push([ox + BLOCK, oy], [ox + BLOCK, oy + 1]);
        continue;
      }
    }
    // Vertical pair: the block across the lane at y = oy + BLOCK.
    const by = oy + TOWN_BLOCK;
    if (fullBlock(ox, oy) && fullBlock(ox, by)
      && isRoad(ox, oy + BLOCK) && isRoad(ox + 1, oy + BLOCK)) {
      if (rng() < chance) {
        consumed.add(idx(ox, oy)); consumed.add(idx(ox, by));
        toHouse.push([ox, oy + BLOCK], [ox + 1, oy + BLOCK]);
      }
    }
  }
  if (!toHouse.length) return { houses, roads };

  const moved = new Set(toHouse.map(([x, y]) => idx(x, y)));
  return {
    houses: [...houses, ...toHouse],
    roads: roads.filter(([x, y]) => !moved.has(idx(x, y))),
  };
}

// ── TOWN-2 (#653): ORGANIC TOWNS ────────────────────────────────────────────
//
// Owner playtest (2026-10-03): "There should be bigger plots and diagonal
// roads. More interesting towns and cities. Not perfect squares." A new map
// option, `layout: "organic"`, keeps the 3-tile lattice for a town's CORE and
// then does three seeded things to it:
//
//   1. IRREGULAR OUTLINE — the town's block extent is not a rectangle. The
//      blocks outside the core are dropped by a noisy radius drawn per octant
//      (`organicBlockMask`): cut corners, a missing quarter, a lobe. The
//      centre block and its four cross-lane blocks are never dropped, so a
//      town always has its heart, and a reachability repair keeps the rest in
//      one piece.
//   2. DIAGONAL AVENUE(S) — one (sometimes two) 45° streets carved across the
//      town through its centre (`organicTownLayout`). The line runs through
//      the lane tiles BESIDE the centre block — the centre stays a 2×2 block
//      at the town origin (`townCentreSprite`) — replacing the lattice tiles
//      on that line with one continuous street. Consecutive avenue tiles are
//      diagonal neighbours, so the avenue also carries DIAGONAL ROAD LINKS
//      (`Town.organicDiag`, stamped at boot by `seedTownDiagonals`), the
//      existing #440 support. Lots flanking the avenue are the existing 1×1
//      wedge fill (`Town.organicWedges`).
//   3. BIGGER PLOTS — the generator merges more block pairs than the `shapes`
//      option does, and sometimes a whole 4×4 of blocks, into one plot: the
//      former street segments between them become house ground (exactly
//      `mergeTownBlocks`'s mechanic, taken further). The art places a 2×4 /
//      4×2 long building per 2-block super and a whole big building per 4×4
//      (`townBuildings`' shapes path, which the organic option shares).
//
// Everything stays buildable and routable: every house lot touches a street
// (the lattice's lanes trim to the built frontage, as they always have), the
// streets stay one connected grid (lanes span the built extent and all cross),
// and the ring of public roads to neighbouring towns attaches to the lanes
// exactly as before (`publicRoadTilesOf` reads `town.roads`, avenue included).
//
// Deterministic: a pure function of the centre, span, terrain, occupancy and
// the seeded stream — no trigonometry anywhere (an octant is an integer
// dot-product max), so every engine computes the same town from the same
// seed. OFF by default: `placeTowns` draws nothing here unless the option is
// on, so option-OFF seeds stay byte-identical.

/** TOWN-2: the four corners an organic outline's bites are drawn at, as
 * sign vectors into block space (no `atan2`, whose last-ulp results may
 * differ between JS engines and would split a room's maps). */
const ORGANIC_CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/** TOWN-2: the seeded share of eligible block pairs an organic town merges
 * into one 2×4 / 4×2 plot — well above `mergeTownBlocks`'s 0.25: the owner
 * asked for BIGGER plots. Adjacent merges stack into whole superblocks (the
 * lane between two stacked plots stays street, so every lot keeps its
 * frontage), which the art fills with a long building per plot. */
export const ORGANIC_PAIR_CHANCE = 0.5;

/**
 * TOWN-2: which BLOCKS of a town's lattice an organic outline keeps.
 *
 * Block space is anchored on the town centre: block (0, 0) is the centre's
 * own 2×2 (its top-left tile IS the town origin, where `townCentreSprite`
 * stands), and block (bx, by) spans tiles `[cx + 3bx, cx + 3bx + 2]`. The
 * full block grid is kept, then two seeded things bite it:
 *
 *   • each CORNER may lose a 1×1 or 2×2 bite (cut corners, a missing
 *     quarter);
 *   • one or two NOTCHES are cut into the middle of random edges — a run of
 *     1–2 blocks wide, 1–2 blocks deep, always inset from the corners so a
 *     notch leaves the block columns either side of it standing. A notch is
 *     what "not a perfect square" MEANS for the acceptance measure: it is a
 *     hole inside the town's final bounding box, which a pure corner cut is
 *     not (a corner cut only shrinks the box).
 *
 * A reachability pass then drops anything a bite cut off (the kept set must
 * be one 4-connected piece around the centre, whose five blocks — the centre
 * and its four cross-lane neighbours — are never dropped, so every organic
 * town keeps its heart and `TOWN_HOUSES_MIN` is reachable on free ground).
 *
 * The bites open onto the unbuilt fringe of the town box (a notch or corner
 * bite has air on one side by construction), so what they leave behind is
 * open ground inside the fence — which `openOrganicCourts` keeps open (or
 * fills) once the lanes and the ring road have had their say about what is
 * actually fenced in.
 *
 * Deterministic: integer arithmetic and a handful of draws in a fixed order.
 * Draws: 4 corner depths + 2×4 per notch.
 */
export function organicBlockMask(
  span: number, rng: () => number,
): (bx: number, by: number) => boolean {
  const minB = Math.floor(-span / TOWN_BLOCK);
  const maxB = Math.floor(span / TOWN_BLOCK);
  const key = (bx: number, by: number) => (bx + 16) * 64 + (by + 16);
  const kept = new Set<number>();
  for (let bx = minB; bx <= maxB; bx++) {
    for (let by = minB; by <= maxB; by++) kept.add(key(bx, by));
  }
  const core = (bx: number, by: number): boolean =>
    (bx === 0 && by === 0) || Math.abs(bx) + Math.abs(by) === 1;
  // Corner bites.
  for (const [sx, sy] of ORGANIC_CORNERS) {
    const r = rng();
    const depth = r < 0.35 ? 0 : r < 0.7 ? 1 : 2;
    const cx = sx === -1 ? minB : maxB;
    const cy = sy === -1 ? minB : maxB;
    for (let i = 0; i < depth; i++) {
      for (let j = 0; j < depth; j++) {
        if (!core(cx + sx * i, cy + sy * j)) kept.delete(key(cx + sx * i, cy + sy * j));
      }
    }
  }
  // Edge notches: three 2-wide bites into the middle of distinct edges, 2–3
  // blocks deep. `span` gives 4–7 blocks per side, so the anchor is drawn
  // inside [minB + 1, maxB − w] to keep the notch off the corners (the
  // corner bites own those) and off the box edge, which is what makes a
  // notch a HOLE in the town's final bounding box rather than a smaller box.
  const notches = 3;
  let edge = Math.floor(rng() * 4);                     // N E S W
  for (let n = 0; n < notches; n++) {
    edge = (edge + 1 + Math.floor(rng() * 3)) % 4;      // a DIFFERENT edge each time
    const width = 2;                                    // 2 blocks
    const depth = rng() < 0.5 ? 2 : 3;                  // 2–3 blocks
    const lo = minB + 1;
    const hi = maxB - width;
    if (hi < lo) continue;
    const a = lo + Math.floor(rng() * (hi - lo + 1));   // anchor along the edge
    for (let d = 0; d < depth; d++) {
      for (let w = 0; w < width; w++) {
        let bx: number, by: number;
        if (edge === 0) { bx = a + w; by = minB + d; }
        else if (edge === 1) { bx = maxB - d; by = a + w; }
        else if (edge === 2) { bx = a + w; by = maxB - d; }
        else { bx = minB + d; by = a + w; }
        if (!core(bx, by)) kept.delete(key(bx, by));
      }
    }
  }
  /** The connected piece around the centre, with anything cut off removed. */
  const repair = () => {
    const seen = new Set<number>([key(0, 0)]);
    const stack = [key(0, 0)];
    while (stack.length) {
      const k = stack.pop()!;
      const bx = Math.floor(k / 64) - 16, by = (k % 64) - 16;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nk = key(bx + dx, by + dy);
        if (kept.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    for (const k of [...kept]) if (!seen.has(k)) kept.delete(k);
  };
  repair();
  return (bx, by) => kept.has(key(bx, by));
}

/** TOWN-2: what `organicTownLayout` returns — the carved layout of one
 * organic town, plus the two derived lists its art and its boot stamp read. */
export interface OrganicTownPlan {
  houses: [number, number][];
  roads: [number, number][];
  /** House-tile indices fronting an avenue (1×1 wedge lots at paint time). */
  wedges: number[];
  /** The avenue's diagonal links, `(ax, ay, bx, by)` per consecutive pair. */
  diagLinks: [number, number, number, number][];
}

/**
 * TOWN-2: carve the AVENUES and the BIGGER PLOTS into a laid street grid.
 *
 * Runs after `townLayout` (whose house lots already respect the organic
 * outline) and before the occupancy stamp, so every downstream check — house
 * minimum, reachability, enclaves, the stamp itself — sees the final layout,
 * exactly as the `shapes` option's merges do.
 *
 * The avenue: a 45° line through the town's middle, on the lane tiles BESIDE
 * the centre block (offsets ±2 blocks on the "\" axis, ∓1/+3 on the "/" —
 * the closest a lattice line gets without crossing the centre 2×2, which
 * `townCentreSprite` must keep). Every tile on the line — house, lane or
 * free land dropped by the outline — becomes street, so the avenue reads as
 * one continuous cut; a gap the ground leaves (water, an industry) splits it
 * and only the longest piece is kept. Consecutive tiles are diagonal
 * neighbours: one diagonal road link each (#440's storage), collected in
 * `diagLinks` for the boot stamp. A second avenue, drawn half the time,
 * crosses the first around the plaza from the other axis.
 *
 * Wedge lots: every remaining house orthogonally adjacent to an avenue tile
 * is reported in `wedges` — the art keeps those to 1×1 lots, the way a
 * diagonal street slices the rectangular blocks beside it.
 *
 * The plots: eligible block pairs merge at `ORGANIC_PAIR_CHANCE` (the same
 * mechanic as `mergeTownBlocks` — the street segment between two full blocks
 * becomes house ground), and a pair that can extend both ways may take one
 * more draw and merge a whole 4×4 of blocks at `ORGANIC_QUAD_CHANCE`. Blocks
 * the avenue fronts and the centre block's own group never merge, so the
 * plaza and the avenue's wedge lots stay lot-sized.
 *
 * Draws: one per avenue (slope, offset, second?) and one per eligible merge
 * origin — all from the caller's seeded stream, in a fixed order.
 */
export function organicTownLayout(
  cx: number, cy: number, span: number,
  houses: [number, number][], roads: [number, number][],
  rng: () => number,
  terrain: Uint8Array, occ: Int16Array,
): OrganicTownPlan {
  const free = (tx: number, ty: number): boolean =>
    inBounds(tx, ty) && terrain[idx(tx, ty)] !== WATER && occ[idx(tx, ty)] === -1;

  // ── the diagonal avenue(s) ────────────────────────────────────────────
  const houseSet = new Set(houses.map(([x, y]) => idx(x, y)));
  const roadSet = new Set(roads.map(([x, y]) => idx(x, y)));
  const avenue = new Set<number>();
  const diagLinks: [number, number, number, number][] = [];

  /** The best continuous run of pappable tiles on a candidate avenue line,
   * or null when the lattice puts nothing there. Pure: commits nothing. */
  const planAvenue = (slope: 1 | -1, offset: number): [number, number][] | null => {
    // The line, x ascending. slope 1: x − y = (cx − cy) + offset.
    // slope −1: x + y = (cx + cy) + offset.
    const line: [number, number][] = [];
    for (let x = cx - span - 1; x <= cx + span + 1; x++) {
      const y = slope === 1 ? x - (cx - cy + offset) : (cx + cy + offset) - x;
      line.push([x, y]);
    }
    // The lattice tiles on the line set the run's extent — the avenue spans
    // the town it cuts, and not past it.
    let first = -1, last = -1;
    for (let i = 0; i < line.length; i++) {
      const [x, y] = line[i];
      if (houseSet.has(idx(x, y)) || roadSet.has(idx(x, y))) {
        if (first === -1) first = i;
        last = i;
      }
    }
    if (first === -1) return null;
    // One continuous piece: walk the extent, split at tiles the ground
    // refuses (water, an industry), keep the longest piece.
    const okAt = (i: number): boolean => {
      const [x, y] = line[i];
      return houseSet.has(idx(x, y)) || roadSet.has(idx(x, y)) || free(x, y);
    };
    let bestS = -1, bestE = -1, s = first;
    for (let i = first; i <= last + 1; i++) {
      if (i <= last && okAt(i)) continue;
      if (bestS === -1 || i - s > bestE - bestS + 1) { bestS = s; bestE = i - 1; }
      s = i + 1;
    }
    if (bestS === -1 || bestE - bestS + 1 < 2) return null;
    const run: [number, number][] = [];
    for (let i = bestS; i <= bestE; i++) run.push(line[i]);
    return run;
  };
  /** Pave a planned piece: lots yield to the street, lanes and free land
   * join it, and consecutive tiles gain their diagonal road links. */
  const commitAvenue = (run: [number, number][]): void => {
    for (const [x, y] of run) {
      const k = idx(x, y);
      houseSet.delete(k);
      roadSet.add(k);
      avenue.add(k);
    }
    for (let i = 1; i < run.length; i++) {
      diagLinks.push([run[i - 1][0], run[i - 1][1], run[i][0], run[i][1]]);
    }
  };

  const slope1: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const offset1 = slope1 === 1 ? (rng() < 0.5 ? -2 : 2) : (rng() < 0.5 ? -1 : 3);
  // Both sides of the centre block are planned; the longer avenue wins, the
  // drawn side wins a tie — one continuous cut, however the coast bites.
  const offsetAlt = slope1 === 1 ? (offset1 === -2 ? 2 : -2) : (offset1 === -1 ? 3 : -1);
  const run1 = planAvenue(slope1, offset1);
  const runAlt = planAvenue(slope1, offsetAlt);
  const altLonger = runAlt !== null && (run1 === null || runAlt.length > run1.length);
  const firstRun = altLonger ? runAlt : run1;
  if (firstRun) commitAvenue(firstRun);
  // The second avenue (half the time) crosses the first around the plaza:
  // the other axis, offset to the side the first avenue was drawn on.
  if (rng() < 0.5) {
    const slope2: 1 | -1 = slope1 === 1 ? -1 : 1;
    const offset2 = altLonger
      ? (slope1 === 1 ? (offsetAlt === -2 ? -1 : 3) : (offsetAlt === -1 ? -2 : 2))
      : (slope1 === 1 ? (offset1 === -2 ? -1 : 3) : (offset1 === -1 ? -2 : 2));
    const run2 = planAvenue(slope2, offset2);
    if (run2) commitAvenue(run2);
  }

  // ── the wedge lots: houses fronting an avenue ─────────────────────────
  // The centre block is exempt: `townCentreSprite` draws its whole 2×2, so
  // its frontage tiles are the building's, not wedge lots.
  const inCentreBlock = (x: number, y: number): boolean =>
    x >= cx && x <= cx + TOWN_BLOCK - 2 && y >= cy && y <= cy + TOWN_BLOCK - 2;
  const wedges: number[] = [];
  for (const [hx, hy] of houses) {
    const k = idx(hx, hy);
    if (!houseSet.has(k)) continue;                  // yielded to the avenue
    if (inCentreBlock(hx, hy)) continue;             // the centre draws whole
    if (([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) => avenue.has(idx(hx + dx, hy + dy)))) {
      wedges.push(k);
    }
  }
  const wedgeSet = new Set(wedges);
  /** Does (x, y) touch an avenue tile? (Merged seams must not.) */
  const frontsAvenue = (x: number, y: number): boolean =>
    ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(([dx, dy]) => avenue.has(idx(x + dx, y + dy)));

  // ── the bigger plots ──────────────────────────────────────────────────
  const BLOCK = TOWN_BLOCK - 1;
  const blockOrigin = (v: number, centre: number) =>
    centre + Math.floor((v - centre) / TOWN_BLOCK) * TOWN_BLOCK;
  const origins: [number, number][] = [];
  {
    const seen = new Set<number>();
    for (const [hx, hy] of houses) {
      const k = idx(hx, hy);
      if (!houseSet.has(k)) continue;
      const ox = blockOrigin(hx, cx), oy = blockOrigin(hy, cy);
      const ok = idx(ox, oy);
      if (seen.has(ok)) continue;
      seen.add(ok);
      origins.push([ox, oy]);
    }
    origins.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  }
  /** Every tile of the block at (ox, oy) is house ground of this town. */
  const fullBlock = (ox: number, oy: number): boolean => {
    for (let dy = 0; dy < BLOCK; dy++) {
      for (let dx = 0; dx < BLOCK; dx++) if (!houseSet.has(idx(ox + dx, oy + dy))) return false;
    }
    return true;
  };
  const blockHasWedge = (ox: number, oy: number): boolean => {
    for (let dy = 0; dy < BLOCK; dy++) {
      for (let dx = 0; dx < BLOCK; dx++) if (wedgeSet.has(idx(ox + dx, oy + dy))) return true;
    }
    return false;
  };
  const seamOk = (tiles: readonly [number, number][]): boolean =>
    tiles.every(([x, y]) => roadSet.has(idx(x, y)) && !frontsAvenue(x, y));

  const consumed = new Set<number>();
  const seams: [number, number][] = [];
  /** One feasible merge at (ox, oy), for the loop and the fallback alike. */
  const feasible = (ox: number, oy: number): { seam: [number, number][]; dir: "h" | "v" } | null => {
    const ex = ox + TOWN_BLOCK, sy = oy + TOWN_BLOCK;
    const seamV: [number, number][] = [[ox + BLOCK, oy], [ox + BLOCK, oy + 1]];
    const seamH: [number, number][] = [[ox, oy + BLOCK], [ox + 1, oy + BLOCK]];
    if (fullBlock(ex, oy) && !blockHasWedge(ex, oy) && seamOk(seamV)) return { seam: seamV, dir: "h" };
    if (fullBlock(ox, sy) && !blockHasWedge(ox, sy) && seamOk(seamH)) return { seam: seamH, dir: "v" };
    return null;
  };
  for (const [ox, oy] of origins) {
    if (consumed.has(idx(ox, oy))) continue;
    if (!fullBlock(ox, oy) || blockHasWedge(ox, oy)) continue;
    // The centre block keeps its plaza: a merge spans the anchor block and
    // its east/south neighbour, so those anchored on (0,0)'s row/column
    // would take the centre into a plot.
    const b0 = Math.floor((ox - cx) / TOWN_BLOCK), c0 = Math.floor((oy - cy) / TOWN_BLOCK);
    if (b0 >= -1 && b0 <= 0 && c0 >= -1 && c0 <= 0) continue;
    const ex = ox + TOWN_BLOCK, sy = oy + TOWN_BLOCK;
    const canE = fullBlock(ex, oy) && !blockHasWedge(ex, oy)
      && seamOk([[ox + BLOCK, oy], [ox + BLOCK, oy + 1]]);
    const canS = fullBlock(ox, sy) && !blockHasWedge(ox, sy)
      && seamOk([[ox, oy + BLOCK], [ox + 1, oy + BLOCK]]);
    if (!canE && !canS) continue;
    const roll = rng();
    // Pair merges only, at ORGANIC_PAIR_CHANCE. A 2×2-of-blocks "quad" was
    // tried and deliberately dropped: a full 5×5 house mass leaves interior
    // lots that touch no street, and keeping a lane through the middle is
    // exactly what two stacked pair merges already give — the art path then
    // draws a long building on each floor of the stack, which is the
    // "bigger plot, one large building" the ticket asks for, twice over.
    // The partner block is consumed-checked too: without that, an E-merge
    // and an S-merge can each take a corner block and weave a 2×2-of-blocks
    // mass after all, with its middle lots fronting nothing.
    if (canE && !consumed.has(idx(ex, oy)) && roll < ORGANIC_PAIR_CHANCE) {
      consumed.add(idx(ox, oy)); consumed.add(idx(ex, oy));
      seams.push(...[[ox + BLOCK, oy], [ox + BLOCK, oy + 1]] as [number, number][]);
      continue;
    }
    if (canS && !consumed.has(idx(ox, sy)) && roll < ORGANIC_PAIR_CHANCE) {
      consumed.add(idx(ox, oy)); consumed.add(idx(ox, sy));
      seams.push(...[[ox, oy + BLOCK], [ox + 1, oy + BLOCK]] as [number, number][]);
    }
  }
  // The one-plot floor: a tiny or much-carved town can leave every seeded
  // roll under the chance — the owner asked for bigger plots, so the first
  // eligible pair still merges (no draw: the fallback is deterministic).
  if (!seams.length) {
    for (const [ox, oy] of origins) {
      if (consumed.has(idx(ox, oy))) continue;
      if (!fullBlock(ox, oy) || blockHasWedge(ox, oy)) continue;
      const b0 = Math.floor((ox - cx) / TOWN_BLOCK), c0 = Math.floor((oy - cy) / TOWN_BLOCK);
      if (b0 >= -1 && b0 <= 0 && c0 >= -1 && c0 <= 0) continue;
      const f = feasible(ox, oy);
      if (!f) continue;
      const ex = ox + TOWN_BLOCK, sy = oy + TOWN_BLOCK;
      consumed.add(idx(ox, oy));
      consumed.add(f.dir === "h" ? idx(ex, oy) : idx(ox, sy));
      seams.push(...f.seam);
      break;
    }
  }

  // ── assemble: the sets are final, emit them in a fixed order ──────────
  if ((globalThis as any).__t2log) {
    for (const [sx, sy] of seams) {
      if ((globalThis as any).__t2watch?.has(idx(sx, sy))) (globalThis as any).__t2log(`SEAM (${sx},${sy})`);
    }
  }
  const moved = new Set(seams.map(([x, y]) => idx(x, y)));
  const outHouses: [number, number][] = [];
  for (const [x, y] of houses) if (houseSet.has(idx(x, y))) outHouses.push([x, y]);
  for (const [x, y] of seams) outHouses.push([x, y]);
  const outRoads: [number, number][] = [];
  {
    const emitted = new Set<number>();
    for (const [x, y] of roads) {
      const k = idx(x, y);
      if (roadSet.has(k) && !moved.has(k)) { outRoads.push([x, y]); emitted.add(k); }
    }
    for (const k of avenue) {
      if (moved.has(k) || emitted.has(k)) continue;
      outRoads.push([k % MAP_W, (k / MAP_W) | 0]);
    }
  }
  return { houses: outHouses, roads: outRoads, wedges, diagLinks };
}

/**
 * TOWN-2: open the garden courts an organic outline can leave fenced in.
 *
 * A dropped block is a 3×3 hole in the street fence. When the hole opens
 * onto the country around the town — every bite the mask takes does — its
 * tiles stay free land. But a hole can end up fenced anyway: a lane the
 * neighbouring block's frontage kept laid, or (with the `rings` option) the
 * ring road running across its open side. A hole the fence encloses is a
 * pocket of free land nothing can reach — precisely the enclave the
 * generator's reachability checks refuse, so the whole town would be
 * rejected and organic maps would place nothing.
 *
 * The resolution is a GATE: remove one fence ROAD tile beside the pocket
 * whose removal opens the pocket to the outside free land, doesn't cut its
 * own street piece in two, strands no house, and isn't part of the organic
 * avenue. The pocket stays a garden; the fence has a gap in it, like a lane
 * that never got paved.
 *
 * Two-phase on purpose: every pocket is resolved on paper FIRST, and the
 * changes apply only if ALL of them found a gate. A pocket no gate can open
 * (one fenced in by houses on every side) reports `false` and the caller
 * throws the candidate away — a sealed free tile is exactly what the
 * generator's enclave checks refuse, and the town is re-drawn from another
 * centre. (`generateMap` runs this a second time after the ring's late
 * re-run, which would otherwise re-pave the first pass's gates; the same
 * fence then yields the same first-fit gates, so pass two always succeeds
 * where pass one did.)
 *
 * Deterministic: pockets in index order, gate candidates in index order,
 * first fit. `keep` lists road tiles a gate may never take — the organic
 * avenue's, so the diagonal street survives every gate whole.
 */
export function openOrganicCourts(
  houses: [number, number][], roads: [number, number][],
  terrain: Uint8Array, occ: Int16Array,
  keep?: Set<number>,
): { houses: [number, number][]; roads: [number, number][]; opened: boolean } {
  const noChange = { houses, roads, opened: true };
  if (!houses.length) return noChange;
  const houseSet = new Set(houses.map(([x, y]) => idx(x, y)));
  const roadSet = new Set(roads.map(([x, y]) => idx(x, y)));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of houses) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const isFree = (x: number, y: number): boolean =>
    inBounds(x, y) && terrain[idx(x, y)] !== WATER && occ[idx(x, y)] === -1
    && !houseSet.has(idx(x, y)) && !roadSet.has(idx(x, y));
  const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

  /** The free country around the town, flooded from a band outside the box. */
  const outside = new Set<number>();
  {
    const stack: number[] = [];
    const seedOutside = (x: number, y: number) => {
      const i = idx(x, y);
      if (isFree(x, y) && !outside.has(i)) { outside.add(i); stack.push(i); }
    };
    for (let x = x0 - 2; x <= x1 + 2; x++) { seedOutside(x, y0 - 2); seedOutside(x, y1 + 2); }
    for (let y = y0 - 2; y <= y1 + 2; y++) { seedOutside(x0 - 2, y); seedOutside(x1 + 2, y); }
    while (stack.length) {
      const cur = stack.pop()!;
      const x = cur % MAP_W, y = (cur / MAP_W) | 0;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx, ny = y + dy;
        if (nx < x0 - 2 || nx > x1 + 2 || ny < y0 - 2 || ny > y1 + 2) continue;
        const ni = idx(nx, ny);
        if (outside.has(ni) || !isFree(nx, ny)) continue;
        outside.add(ni);
        stack.push(ni);
      }
    }
  }
  // Sealed pockets: free tiles inside the box the outside flood never reached.
  const pockets: number[][] = [];
  {
    const seen = new Set<number>();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        if (seen.has(i) || outside.has(i) || !isFree(x, y)) continue;
        const comp: number[] = [];
        const stack = [i];
        seen.add(i);
        while (stack.length) {
          const cur = stack.pop()!;
          comp.push(cur);
          const px = cur % MAP_W, py = (cur / MAP_W) | 0;
          for (const [dx, dy] of DIR4) {
            const ni = idx(px + dx, py + dy);
            if (seen.has(ni) || outside.has(ni) || !isFree(px + dx, py + dy)) continue;
            seen.add(ni);
            stack.push(ni);
          }
        }
        pockets.push(comp.sort((a, b) => a - b));
      }
    }
  }
  pockets.sort((a, b) => a[0] - b[0]);
  if (!pockets.length) return noChange;

  // Phase one: pick every pocket's gate on paper (a local copy of the road
  // set, so one pocket's gate doesn't hide another pocket's candidates).
  const paperRoads = new Set<number>(roadSet);
  const gates: number[] = [];
  for (const pocket of pockets) {
    const pocketSet = new Set(pocket);
    let gated = false;
    for (const g of [...paperRoads].sort((a, b) => a - b)) {
      if (keep?.has(g)) continue;              // the avenue keeps its tiles
      const gx = g % MAP_W, gy = (g / MAP_W) | 0;
      if (!DIR4.some(([dx, dy]) => pocketSet.has(idx(gx + dx, gy + dy)))) continue;
      // (a) the pocket flood, across the gate, reaches the outside
      let opens = false;
      {
        const seen = new Set<number>(pocket);
        const stack = [...pocket, g];
        while (stack.length && !opens) {
          const cur = stack.pop()!;
          const x = cur % MAP_W, y = (cur / MAP_W) | 0;
          for (const [dx, dy] of DIR4) {
            const ni = idx(x + dx, y + dy);
            if (seen.has(ni)) continue;
            if (outside.has(ni)) { opens = true; break; }
            if (ni === g || pocketSet.has(ni)
              || (isFree(x + dx, y + dy) && !houseSet.has(ni) && !paperRoads.has(ni))) {
              seen.add(ni);
              stack.push(ni);
            }
          }
        }
      }
      if (!opens) continue;
      // (b) the gate is no cut of its own street piece
      {
        const comp = new Set<number>([g]);
        const compStack = [g];
        while (compStack.length) {
          const cur = compStack.pop()!;
          const x = cur % MAP_W, y = (cur / MAP_W) | 0;
          for (const [dx, dy] of DIR4) {
            const ni = idx(x + dx, y + dy);
            if (ni !== g && paperRoads.has(ni) && !comp.has(ni)) { comp.add(ni); compStack.push(ni); }
          }
        }
        let start = -1;
        for (const [dx, dy] of DIR4) {
          const ni = idx(gx + dx, gy + dy);
          if (ni !== g && comp.has(ni)) { start = ni; break; }
        }
        if (start !== -1) {
          const seen = new Set<number>([start]);
          const stack = [start];
          while (stack.length) {
            const cur = stack.pop()!;
            const x = cur % MAP_W, y = (cur / MAP_W) | 0;
            for (const [dx, dy] of DIR4) {
              const ni = idx(x + dx, y + dy);
              if (ni === g || !comp.has(ni) || seen.has(ni)) continue;
              seen.add(ni);
              stack.push(ni);
            }
          }
          if (seen.size !== comp.size - 1) continue;
        }
      }
      // (c) the gate strands no house: a lot beside it must still touch
      // another street tile
      const housesOk = DIR4.every(([dx, dy]) => {
        const hx = gx + dx, hy = gy + dy;
        if (!houseSet.has(idx(hx, hy))) return true;
        return DIR4.some(([dx2, dy2]) => {
          const ni = idx(hx + dx2, hy + dy2);
          return paperRoads.has(ni) && ni !== g;
        });
      });
      if (!housesOk) continue;
      gates.push(g);
      paperRoads.delete(g);
      gated = true;
      break;
    }
    if (!gated) return { houses, roads, opened: false };   // unresolvable
  }
  // Phase two: apply.
  return {
    houses,
    roads: roads.filter(([x, y]) => !gates.includes(idx(x, y))),
    opened: true,
  };
}


/** TOWN-GRID: one piece of town art and the tile its footprint starts on. */
export interface TownBuilding { sprite: string; tx: number; ty: number }

// ── L17 (#245): town tiers ───────────────────────────────────────────────────
/** Bumped every time a town's tier changes, so derived caches can version. */
let townTierRev = 1;

/** The revision `townVillageBytes`' cache is keyed on. */
export const townTierRevision = (): number => townTierRev;

/** The town's visual tier; absent = `TOWN_TIER_LEGACY` (today's look). */
export const townTier = (t: Town): number => t.level ?? TOWN_TIER_LEGACY;

/**
 * L17 (#245): set a town's visual tier (clamped to 0…`TOWN_VISUAL_MAX`).
 * Returns false (and changes nothing) when the tier is unchanged — the caller
 * then skips the whole growth dance (world sync, cache invalidation, FX).
 */
export function setTownLevel(t: Town, level: number): boolean {
  const v = Math.max(0, Math.min(TOWN_VISUAL_MAX, Math.floor(level)));
  if (!Number.isFinite(v) || townTier(t) === v) return false;
  t.level = v;
  townTierRev++;
  return true;
}

/**
 * L17 (#245): every town starts at `level` (the new loop seeds 0 — villages).
 * The `seedTownRoads` pattern: the map stays seed-derived and legacy; the game
 * stamps the boot-time visual state where it stamps the boot-time track.
 */
export function seedTownLevels(grid: Grid, level = 0): void {
  for (const t of grid.towns) setTownLevel(t, level);
}

/**
 * L17 (#245): one byte per tile — 1 where the tile belongs to a VILLAGE
 * (tier 0). This is an art-tier marker for village building decisions. Road
 * rendering deliberately does NOT use it: every town tier keeps paved streets,
 * sidewalks, lamps and block ground so roads stay continuous at game start.
 *
 * Cached per grid against `townTierRevision`, exactly like `townGroundBytes`:
 * a tier change is a rare, explicit event (`setTownLevel` bumps the revision),
 * so the cache rebuilds only then and never per frame.
 */
const townVillageCache = new WeakMap<Grid, { rev: number; bytes: Uint8Array | null }>();

export function townVillageBytes(grid: Grid): Uint8Array | null {
  const hit = townVillageCache.get(grid);
  if (hit && hit.rev === townTierRev) return hit.bytes;
  let bytes: Uint8Array | null = null;
  if (grid.towns.length) {
    bytes = new Uint8Array(grid.w * grid.h);
    for (const town of grid.towns) {
      if (townTier(town) !== 0) continue;
      for (const [tx, ty] of town.houses) {
        if (tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h) bytes[ty * grid.w + tx] = 1;
      }
      if (town.tx >= 0 && town.ty >= 0 && town.tx < grid.w && town.ty < grid.h) {
        bytes[town.ty * grid.w + town.tx] = 1;
      }
      for (const [tx, ty] of town.roads ?? []) {
        if (tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h) bytes[ty * grid.w + tx] = 1;
      }
    }
  }
  townVillageCache.set(grid, { rev: townTierRev, bytes });
  return bytes;
}

/** L17 (#245): how many block-rings a tier's footprint grows, from tier 2 up. */
export const townGrownRings = (tier: number): number =>
  Math.max(0, Math.min(TOWN_VISUAL_MAX, tier) - 1);

/**
 * L17 (#245): the GROWN RING — the house tiles a town's bigger footprint adds,
 * `rings` block-rings (TOWN_BLOCK each) beyond its built extent.
 *
 * DELIBERATELY VISUAL ONLY. The tiles are NOT stamped `TOWN_OCC`, are NOT
 * added to `houses` and never reach placement, catchments, routing or the
 * economy — that is the ticket's "no gameplay rule changes with town tier".
 * They are also not stored: the ring is derived on demand from the town plus
 * the live occupancy, so a tile the player has already built on (or that
 * carries road, or sank into the sea) is simply skipped, and a later
 * demolition shows the grown street healing over it. Deterministic for a
 * given map state, which is all the art needs.
 *
 * `blocked` is the caller's "a building stands here" test (the track bytes and
 * the harvester/factory/rail footprints live outside the grid); the grid's own
 * answers — bounds, water, occupancy, the town's own tiles, the inter-town
 * highway — are checked here.
 */
export function grownTownHouses(
  t: Town, grid: Grid, rings: number,
  blocked?: (tx: number, ty: number) => boolean,
): [number, number][] {
  // TOWN-4.3 (#679): L17's grown ring is not a planned town's growth — that
  // arrives with TOWN-4.4's district-by-district reveal of `t.plan`. Drawing
  // the ring here would scatter houses over ground the plan has not zoned.
  if (rings <= 0 || !grid.towns.includes(t) || t.plan) return [];
  const own = new Set<number>();
  let extent = 0;
  const note = (tx: number, ty: number) => {
    own.add(idx(tx, ty));
    extent = Math.max(extent, Math.abs(tx - t.tx), Math.abs(ty - t.ty));
  };
  note(t.tx, t.ty);
  for (const [hx, hy] of t.houses) note(hx, hy);
  for (const [rx, ry] of t.roads ?? []) note(rx, ry);

  // The inter-town highway is free land the town must not build over.
  const highway = new Set<number>();
  for (const [px, py] of grid.publicRoads ?? []) highway.add(idx(px, py));

  const maxR = extent + rings * TOWN_BLOCK;
  const out: [number, number][] = [];
  for (let ty = t.ty - maxR; ty <= t.ty + maxR; ty++) {
    for (let tx = t.tx - maxR; tx <= t.tx + maxR; tx++) {
      if (!inBounds(tx, ty)) continue;
      const i = idx(tx, ty);
      if (own.has(i) || highway.has(i)) continue;
      if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) continue;
      if (blocked?.(tx, ty)) continue;
      out.push([tx, ty]);
    }
  }
  return out;
}

/**
 * TOWN-GRID: the town's DRAW ITEMS — art placed on whole house BLOCKS, never
 * one item per tile.
 *
 * Why this exists. `townLayout` keeps houses and streets strictly apart: a
 * street lane is every `TOWN_BLOCK`-th column and row, and a house only ever
 * occupies a cell between them. The art did not respect that. Every house
 * tile emitted its own draw item, but a third of the town cells are authored
 * on a 2×2 footprint (the office towers, the tall flats, the bank, the cinema
 * — `assets/buildings/manifest.json` is the authority), and a 2×2 sprite
 * anchored on a single tile spans that tile AND its east/south neighbour.
 * Those neighbours are the streets, so the towers were drawn standing in the
 * road — and four tiles of one block each drew their own building on top of
 * each other. The town centre had it twice over: the church is 2×2 and the
 * other three tiles of its block drew houses through it.
 *
 * The blocks are exactly the right unit. `TOWN_BLOCK` of 3 makes each block
 * `TOWN_BLOCK - 1` = 2 tiles square, so a 2×2 building placed on the block's
 * origin fills the block and stops at the kerb. Per block:
 *
 *   • the variant hash (keyed on the block origin) picks from the full list;
 *   • a multi-tile pick is placed ONCE on the block origin, provided its
 *     footprint fits the block and every tile it covers is a house of this
 *     town — otherwise the block falls back to single tiles, so a block
 *     clipped by a coast or an industry is never used to smuggle art onto a
 *     neighbouring street;
 *   • a 1×1 pick fills the block one house per tile, each tile drawing its
 *     own variant from the 1×1 cells only.
 *
 * `footprintOf` is the runtime atlas, not a table here: a town cell's
 * footprint comes from its authored canvas size (tools/make-building-pngs.mjs)
 * and the per-building layers override the sheet defs at load, so asking the
 * atlas is what keeps this correct when the art is re-authored. Before those
 * layers load every town cell is 1×1 in the monolith manifest and this
 * degrades to the per-tile layout the sheet art expects.
 *
 * L17 (#245): `opts.tier` grows the town.
 *
 *   • LEGACY (absent, `TOWN_TIER_LEGACY`) — today's look, byte for byte: the
 *     church in the middle, the full variant list, every call shape this
 *     function ever had keeps its output. Every test and reader that does not
 *     know about tiers gets exactly what it always got.
 *   • VILLAGE (0) — the same block algorithm, but the pick runs inside
 *     `TOWN_VILLAGE_VARIANTS` (small 1×1 homes only) and no multi-tile block
 *     art is placed except the centre itself: the church stays.
 *   • TOWN and up (1+) — the full list again, and the centre is the bank
 *     (`townCentreSprite`), the building the city upgrade is bought from.
 *   • CITY and up (2+) — `grownTownHouses` adds the ring beyond the town's
 *     built extent; the ring tiles draw as single houses from the full 1×1
 *     list. VISUAL ONLY — the ring never claims tiles.
 *
 * Deterministic: a pure function of the town, the options and the atlas, so
 * the same settlement always draws the same buildings.
 */
export interface TownBuildingsOptions {
  /** The visual tier; absent = `TOWN_TIER_LEGACY` (today's look). */
  tier?: number;
  /** The map, for the grown ring's occupancy and terrain reads (tier 2+). */
  grid?: Grid;
  /** The grown ring skips these tiles too (player-built ground). */
  blocked?: (tx: number, ty: number) => boolean;
  /**
   * F4 (#275): the map was generated with the `shapes` option — place the
   * long #273 buildings on the blocks `mergeTownBlocks` joined (tier 1+ and
   * LEGACY; a village still draws only its small homes). Absent/OFF keeps
   * exactly today's layout.
   */
  shapes?: boolean;
  /**
   * TOWN-2 (#653): the town is an ORGANIC one. Its merged plots (2×4 / 4×2 /
   * 4×4) draw from the same long-building path the `shapes` option uses —
   * so a town can hold both options' art — and its avenue-frontage wedge
   * lots (`Town.organicWedges`) are kept to 1×1 fill: no block or long
   * building is ever drawn over the diagonal street's edge. Absent keeps
   * exactly today's layout.
   */
  organic?: boolean;
  /**
   * MAP-2 (#559): can the renderer actually DRAW this sprite? The game passes
   * the atlas (`atlas.has`), because the scenery TREE defs land in a load of
   * their own, after the first sync — until then a lot must fall back to a
   * park or a lawn rather than to a sprite that draws nothing. Absent (the
   * pure callers, tests) means every named sprite is assumed drawable.
   */
  spriteKnown?: (sprite: string) => boolean;
}

/**
 * Owner (2026-09-26): parks only on a SINGLE open tile, and not many - at most
 * one per block. A park tile touching another park tile (a whole empty block,
 * a strip) is dropped and stays open land.
 */
export function townBuildings(
  t: Town,
  footprintOf: (sprite: string) => [number, number],
  opts: TownBuildingsOptions = {},
): TownBuilding[] {
  const out = townBuildingsLaid(t, footprintOf, opts);
  const parks = new Set<string>(TOWN_PARK_VARIANTS);
  const at = new Set(out.filter((b) => parks.has(b.sprite)).map((b) => idx(b.tx, b.ty)));
  const blockOf = (v: number, c: number) => Math.floor((v - c) / TOWN_BLOCK);
  const usedBlock = new Set<string>();
  // A lawn lot where a park would repeat: the tile keeps a (quiet) draw item.
  const lawn = buildingFootprint(TOWN_LAWN) !== null ? TOWN_LAWN : null;
  const res: TownBuilding[] = [];
  for (const b of out) {
    if (!parks.has(b.sprite)) { res.push(b); continue; }
    const lonely = [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => !at.has(idx(b.tx + dx, b.ty + dy)));
    const key = `${blockOf(b.tx, t.tx)},${blockOf(b.ty, t.ty)}`;
    if (lonely && !usedBlock.has(key)) { usedBlock.add(key); res.push(b); continue; }
    if (lawn) res.push({ ...b, sprite: lawn });
  }
  return res;
}

/**
 * CIVIC-1 (#654): the CIVIC BUILDINGS of a town — the hospital, the school,
 * the stadium and the rest of `CIVIC_BUILDINGS` (src/iso/config.ts).
 *
 * Runs after the centre and before the ordinary blocks, so a civic lot claims
 * its plot first (a 2×2 block pick simply falls back to single lots when part
 * of it is taken) and every tile it leaves over is still filled by
 * `fillSingles` — the "every house tile is built on" guarantee is untouched.
 *
 * How a lot is chosen. Every house tile is a candidate origin, walked
 * row-major; a candidate stands when its WHOLE footprint is this town's house
 * ground and nothing else has claimed any of it. That single rule carries all
 * the invariants a town's art is pinned on: a footprint never reaches a street
 * (a street tile is not a house), never leaves the town (a tile outside the
 * house list is not one either), and never overlaps another building (the
 * claimed set). It is also what lets one building take a plot another cannot:
 * the 2×4 stadium only ever lands on the 5×2 superblocks `mergeTownBlocks`
 * joined (the `shapes` option, ON for every new game), because a plain 2×2
 * block lattice has no 2×4 run of houses.
 *
 * The town centre is respected by construction: it is placed before this pass
 * and its tiles are claimed, so no civic building can be laid over it.
 *
 * Deterministic: the candidate list is built from the town's own house tiles
 * in a fixed order and the walk starts at a hash of the town centre salted per
 * civic kind (`hashPick`), so two kinds never reach for the same corner and a
 * re-render, another client and a restored save all lay the same town.
 */
function layCivicBuildings(
  t: Town,
  tier: number,
  footprintOf: (sprite: string) => [number, number],
  spriteKnown: ((sprite: string) => boolean) | undefined,
  houses: Set<number>,
  used: Set<number>,
  place: (sprite: string, ox: number, oy: number) => void,
  /** TOWN-2 (#653): an organic town's avenue-frontage wedge lots — a civic
   * building never covers one, exactly like no other block art. Absent (the
   * grid plan) changes nothing. */
  wedges?: ReadonlySet<number>,
): void {
  // A LEGACY town (no tier — an MP seat, a story chapter, every caller that
  // does not opt in) keeps today's look byte for byte: the civic table rides
  // the tier system, which is the new loop's (L17 #245). A tier above the top
  // draws the metropolis.
  if (tier < 0 || !houses.size) return;

  // Row-major over the town's own house tiles — the fixed order every other
  // town pass walks.
  const tiles = [...houses].sort((a, b) => a - b);
  const fits = (ox: number, oy: number, w: number, h: number): boolean => {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        const x = ox + dx, y = oy + dy;
        if (!inBounds(x, y)) return false;
        const i = idx(x, y);
        if (!houses.has(i) || used.has(i)) return false;
        if (wedges?.has(i)) return false;   // TOWN-2: the avenue's wedge lots
      }
    }
    return true;
  };
  // A town stays mostly homes: the ceiling on the ground civic buildings may
  // take (CIVIC_MAX_SHARE), spent in the table's own priority order.
  let spent = 0;
  const budget = Math.floor(houses.size * CIVIC_MAX_SHARE);

  for (let slot = 0; slot < CIVIC_BUILDINGS.length; slot++) {
    const def = CIVIC_BUILDINGS[slot];
    if (tier < def.minTier) continue;
    const own = civicArt(def, footprintOf, spriteKnown, false);
    // `rotate`: the same drawing turned onto the other axis (2×4 ↔ 4×2), so a
    // stadium takes whichever of the two plots this town's merges produced.
    const turned = def.rotate ? civicArt(def, footprintOf, spriteKnown, true) : null;
    if (!own && !turned) continue;             // nothing to draw yet — skip it

    // Every plot this building could stand on, in row-major order, the plain
    // orientation first and the turned one only where that is what fits.
    const plots: { x: number; y: number; sprite: string; w: number; h: number }[] = [];
    for (const i of tiles) {
      if (used.has(i)) continue;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      if (own && fits(x, y, own.footprint[0], own.footprint[1])) {
        plots.push({ x, y, sprite: own.sprite, w: own.footprint[0], h: own.footprint[1] });
      } else if (turned && fits(x, y, turned.footprint[0], turned.footprint[1])) {
        plots.push({ x, y, sprite: turned.sprite, w: turned.footprint[0], h: turned.footprint[1] });
      }
    }
    if (!plots.length) continue;

    // Walked cyclically from a hashed start: deterministic, and it spreads a
    // town's civic buildings instead of stacking them in the first row. A plot
    // a taller neighbour has since taken fails `fits` and is skipped.
    const want = civicCount(def, houses.size);
    const start = hashPick(t.tx + slot * 31, t.ty + slot * 17, plots.length);
    let placed = 0;
    for (let k = 0; k < plots.length && placed < want; k++) {
      const p = plots[(start + k) % plots.length];
      if (!fits(p.x, p.y, p.w, p.h)) continue;
      const area = p.w * p.h;
      // This building would take the town past its civic ground: stop here —
      // every other plot of it is the same size — and let the next kind try.
      if (spent + area > budget) break;
      place(p.sprite, p.x, p.y);
      spent += area;
      placed++;
    }
  }
}

function townBuildingsLaid(
  t: Town,
  footprintOf: (sprite: string) => [number, number],
  opts: TownBuildingsOptions = {},
): TownBuilding[] {
  const tier = opts.tier ?? TOWN_TIER_LEGACY;
  const village = tier === 0;
  // F4: the shapes path — long buildings on merged blocks. TOWN-2: an
  // organic town takes the same path (its bigger plots hold the same long
  // buildings). Villages keep the small-homes look, and a town with neither
  // option keeps today's layout.
  if ((opts.shapes === true || opts.organic === true) && !village) return townBuildingsShapes(t, footprintOf, opts);
  const BLOCK = TOWN_BLOCK - 1;                 // tiles per block, per axis
  void villageBlockPool;
  // A VILLAGE keeps its own small 1×1 homes.
  //
  // Owner (2026-09-26) had every tier above it draw NO 1×1 building at all:
  // a single house tile was an open lot — a tree, a park or a lawn
  // (`lotArtAt`, the MAP-2 #559 direction). CITY-1 (#652, owner playtest
  // 2026-10-03) takes that back for the upgraded tiers: an ordinary house
  // belongs on a town lot, and the greenery is now the sprinkle between them
  // (`townLotFiller`). LEGACY towns are untouched.
  const villageHomes: readonly string[] = TOWN_VILLAGE_VARIANTS.filter((v) => {
    const [fw, fh] = footprintOf(v);
    return fw === 1 && fh === 1 && buildingFootprint(v) !== null;
  });
  const homeArt = village && villageHomes.length ? villageHomes : null;
  const fill = townLotFiller(tier, footprintOf, opts.spriteKnown);
  /** The sprite a single lot draws: a village home, else a house or a lot. */
  const singleArt = (x: number, y: number): string =>
    homeArt ? pickTownVariant(x, y, homeArt) : fill.art(x, y);
  // Whole blocks: 2×2-or-larger art only (a village places no block art).
  const blockArt: readonly string[] = village
    ? []
    : TOWN_HOUSE_VARIANTS.filter((v) => {
      const [fw, fh] = footprintOf(v);
      return (fw > 1 || fh > 1) && fw <= BLOCK && fh <= BLOCK;
    });

  const houses = new Set<number>();
  for (const [hx, hy] of t.houses) houses.add(idx(hx, hy));
  const used = new Set<number>();
  const out: TownBuilding[] = [];

  /** Tiles a footprint covers from an origin. */
  const span = (ox: number, oy: number, fw: number, fh: number): [number, number][] => {
    const tiles: [number, number][] = [];
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) tiles.push([ox + dx, oy + dy]);
    return tiles;
  };
  const place = (sprite: string, ox: number, oy: number) => {
    const [fw, fh] = footprintOf(sprite);
    out.push({ sprite, tx: ox, ty: oy });
    for (const [x, y] of span(ox, oy, fw, fh)) used.add(idx(x, y));
  };

  // The centre building — the village church, then the bank (L17). The grid
  // phase is anchored on the centre (`townLayout`), so (tx, ty) is always a
  // block ORIGIN and the 2×2 centre lands on the block, not across the
  // crossroads next to it.
  place(townCentreSprite(tier), t.tx, t.ty);

  // The blocks the houses fall in. Block origins share the centre's phase, so
  // flooring the offset by TOWN_BLOCK gives the origin for negative offsets
  // too (a house at −2 belongs to the block starting at −3).
  const blockOrigin = (v: number, centre: number) =>
    centre + Math.floor((v - centre) / TOWN_BLOCK) * TOWN_BLOCK;
  const blocks = new Map<number, [number, number]>();
  // Every house tile of each block, not a fixed 2×2 square: `mergeTownBlocks`
  // (F4 #275) turns the lane between two blocks into house tiles, so a block
  // can be 2×3 — and the seam tiles are still this block's to draw on.
  const blockTiles = new Map<number, [number, number][]>();
  for (const [hx, hy] of t.houses) {
    const ox = blockOrigin(hx, t.tx), oy = blockOrigin(hy, t.ty);
    const key = idx(ox, oy);
    blocks.set(key, [ox, oy]);
    const list = blockTiles.get(key);
    if (list) list.push([hx, hy]); else blockTiles.set(key, [[hx, hy]]);
  }
  // CIVIC-1 (#654): the hospital, the school, the stadium — laid before the
  // ordinary blocks so a civic lot claims its plot first. A block whose part
  // is taken simply falls back to single lots, so nothing is left bare.
  layCivicBuildings(t, tier, footprintOf, opts.spriteKnown, houses, used, place);
  // Row-major over the block origins: a fixed order, so the output is stable.
  const origins = [...blocks.values()].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));

  /** An open lot on every free house tile of the list, one per tile. */
  const fillSingles = (tiles: readonly [number, number][]) => {
    for (const [x, y] of tiles) {
      const i = idx(x, y);
      if (!houses.has(i) || used.has(i)) continue;
      place(singleArt(x, y), x, y);
    }
  };

  for (const [ox, oy] of origins) {
    // The BLOCK pick runs on the FULL list at every non-village tier — that is
    // where the 2×2 towers, banks and cinemas come from — while the village
    // picks inside its small-homes list (and never places block art at all).
    const pick = blockArt.length ? pickTownVariant(ox, oy, blockArt) : singleArt(ox, oy);
    const [fw, fh] = footprintOf(pick);
    const wholeBlock = blockArt.length > 0
      && (fw > 1 || fh > 1)
      && fw <= BLOCK && fh <= BLOCK
      && span(ox, oy, fw, fh).every(([x, y]) => houses.has(idx(x, y)) && !used.has(idx(x, y)));
    // CITY-1 (#652): …except on a HOUSING block, which gives its tall pick up
    // so its four tiles can each draw an ordinary house. That is what puts
    // normal houses back among the towers of an upgraded town; the tiles are
    // filled by `fillSingles` below exactly like any other free lot.
    const homesHere = fill.homes.length > 0 && townHomesBlockAt(ox, oy);
    // Open lots, one per free tile of the block: a small home in a village,
    // an ordinary house in an upgraded town, else a tree / park / lawn
    // (`singleArt`). Runs after a whole-block pick too, so a merged block's
    // seam tiles are drawn instead of left bare.
    if (wholeBlock && !homesHere) place(pick, ox, oy);
    fillSingles(blockTiles.get(idx(ox, oy)) ?? []);
  }

  // The grown ring (tier 2+): the new districts beyond the old street plan.
  layGrownRing(t, opts, footprintOf, used, place);
  return out;
}

/**
 * F4 (#275): the DRAW ITEMS of a shapes-option town — the same guarantees as
 * `townBuildings` (every house tile built on, nothing over a street, no
 * overlaps, deterministic) plus the long #273 buildings:
 *
 *   • the superblocks `mergeTownBlocks` joined are detected from the house
 *     tiles — the former street segment between the two blocks is house
 *     ground now, and that is the only way a street-lane tile can be a house
 *     — and each takes ONE long building (2×4/4×2, 1×3/3×1 or a terrace),
 *     anchored deterministically somewhere inside it;
 *   • ordinary blocks draw today's mix plus the 1×2/2×1 terraces, which fit
 *     a single block and leave its other tiles to single houses;
 *   • whatever a long building does not cover fills with single houses, so a
 *     merged street segment can never show as an unbuilt gap either.
 *
 * The grown ring (tier 2+) appends exactly as in the legacy path.
 */
function townBuildingsShapes(
  t: Town,
  footprintOf: (sprite: string) => [number, number],
  opts: TownBuildingsOptions,
): TownBuilding[] {
  const tier = opts.tier ?? TOWN_TIER_LEGACY;
  const BLOCK = TOWN_BLOCK - 1;
  // A leftover single tile is a LOT. MAP-2 (#559) plants it with a tree, a
  // park or a lawn (`lotArtAt`) so the new districts' strips do not read as
  // bare grass; CITY-1 (#652) gives it an ordinary house instead on every
  // upgraded tier, keeping one lot in `TOWN_GREEN_LOT_IN` green.
  const fill = townLotFiller(tier, footprintOf, opts.spriteKnown);

  const houses = new Set<number>();
  for (const [hx, hy] of t.houses) houses.add(idx(hx, hy));
  const used = new Set<number>();
  const out: TownBuilding[] = [];
  // TOWN-2 (#653): an organic town's avenue-frontage lots stay 1×1 wedges —
  // neither a block pick nor a long building may cover one, so the diagonal
  // street keeps its sliced-lot edge. Absent (every shapes-option town)
  // reads as an empty set: nothing changes there.
  const wedges = new Set<number>(t.organicWedges ?? []);
  const touchesWedge = (tiles: readonly [number, number][]): boolean =>
    tiles.some(([x, y]) => wedges.has(idx(x, y)));

  const span = (ox: number, oy: number, fw: number, fh: number): [number, number][] => {
    const tiles: [number, number][] = [];
    for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) tiles.push([ox + dx, oy + dy]);
    return tiles;
  };
  const place = (sprite: string, ox: number, oy: number) => {
    const [fw, fh] = footprintOf(sprite);
    out.push({ sprite, tx: ox, ty: oy });
    for (const [x, y] of span(ox, oy, fw, fh)) used.add(idx(x, y));
  };
  /** A house or an open lot on every free house tile of the list. */
  const fillSingles = (tiles: [number, number][]) => {
    for (const [x, y] of tiles) {
      const i = idx(x, y);
      if (!houses.has(i) || used.has(i)) continue;
      place(fill.art(x, y), x, y);
    }
  };

  // The centre first, exactly like the legacy path.
  place(townCentreSprite(tier), t.tx, t.ty);

  const blockOrigin = (v: number, centre: number) =>
    centre + Math.floor((v - centre) / TOWN_BLOCK) * TOWN_BLOCK;
  const blocks = new Map<number, [number, number]>();
  // As in the legacy path: a merged block's own house tiles, seams included.
  const blockTiles = new Map<number, [number, number][]>();
  for (const [hx, hy] of t.houses) {
    const ox = blockOrigin(hx, t.tx), oy = blockOrigin(hy, t.ty);
    const key = idx(ox, oy);
    blocks.set(key, [ox, oy]);
    const list = blockTiles.get(key);
    if (list) list.push([hx, hy]); else blockTiles.set(key, [[hx, hy]]);
  }
  // CIVIC-1 (#654): the civic lots, before the superblocks claim theirs — the
  // 2×4 stadium takes one merged plot, the long town buildings the rest.
  layCivicBuildings(t, tier, footprintOf, opts.spriteKnown, houses, used, place, wedges);
  const origins = [...blocks.values()].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
  const fullBlock = (ox: number, oy: number): boolean =>
    span(ox, oy, BLOCK, BLOCK).every(([x, y]) => houses.has(idx(x, y)));

  // ── the merged superblocks (the segment tile turned house is the marker) ──
  interface Super { ox: number; oy: number; w: number; h: number; dir: "h" | "v" }
  const supers: Super[] = [];
  const superOrigin = new Set<number>();
  for (const [ox, oy] of origins) {
    if (superOrigin.has(idx(ox, oy))) continue;
    const rx = ox + TOWN_BLOCK;
    if (fullBlock(ox, oy) && fullBlock(rx, oy)
      && houses.has(idx(ox + BLOCK, oy)) && houses.has(idx(ox + BLOCK, oy + 1))
      // TOWN-2: an avenue-frontage lot takes the whole candidate out — the
      // wedge stays a wedge, the plot stays lot-sized.
      && !touchesWedge(span(ox, oy, 2 * BLOCK + 1, BLOCK))) {
      supers.push({ ox, oy, w: 2 * BLOCK + 1, h: BLOCK, dir: "h" });
      superOrigin.add(idx(ox, oy)); superOrigin.add(idx(rx, oy));
      continue;
    }
    const by = oy + TOWN_BLOCK;
    if (fullBlock(ox, oy) && fullBlock(ox, by)
      && houses.has(idx(ox, oy + BLOCK)) && houses.has(idx(ox + 1, oy + BLOCK))
      && !touchesWedge(span(ox, oy, BLOCK, 2 * BLOCK + 1))) {
      supers.push({ ox, oy, w: BLOCK, h: 2 * BLOCK + 1, dir: "v" });
      superOrigin.add(idx(ox, oy)); superOrigin.add(idx(ox, by));
    }
  }

  for (const s of supers) {
    // The long shapes whose footprint fits this superblock, long side along
    // the merge. The pick and the anchor are hash-keyed on the origin, so a
    // town always draws the same layout.
    const pool = TOWN_SHAPE_VARIANTS.filter((v) => {
      const [fw, fh] = footprintOf(v);
      return fw <= s.w && fh <= s.h && (s.dir === "h" ? fw > fh : fh > fw);
    });
    if (pool.length) {
      const pick = pool[hashPick(s.ox, s.oy, pool.length)];
      const [fw, fh] = footprintOf(pick);
      const offs: [number, number][] = [];
      for (let dy = 0; dy <= s.h - fh; dy++) {
        for (let dx = 0; dx <= s.w - fw; dx++) offs.push([dx, dy]);
      }
      // Salted so the anchor does not correlate with the sprite pick; walked
      // cyclically from the pick until a footprint lands on free house tiles
      // (the centre building may hold part of a merged block).
      const first = hashPick(s.ox + 7, s.oy + 11, offs.length);
      for (let k = 0; k < offs.length; k++) {
        const [dx, dy] = offs[(first + k) % offs.length];
        const tiles = span(s.ox + dx, s.oy + dy, fw, fh);
        if (tiles.every(([x, y]) => houses.has(idx(x, y)) && !used.has(idx(x, y)))
          && !touchesWedge(tiles)) {
          place(pick, s.ox + dx, s.oy + dy);
          break;
        }
      }
    }
    fillSingles(span(s.ox, s.oy, s.w, s.h));
  }

  // ── ordinary blocks: today's mix plus the block-sized terraces ──
  const blockPool: readonly string[] = [
    ...TOWN_HOUSE_VARIANTS.filter((v) => {
      const [fw, fh] = footprintOf(v);
      return (fw > 1 || fh > 1) && fw <= BLOCK && fh <= BLOCK;
    }),
    ...TOWN_SHAPE_VARIANTS.filter((v) => {
      const [fw, fh] = footprintOf(v);
      return (fw > 1 || fh > 1) && fw <= BLOCK && fh <= BLOCK;
    }),
  ];
  for (const [ox, oy] of origins) {
    if (superOrigin.has(idx(ox, oy))) continue;
    const pick = pickTownVariant(ox, oy, blockPool);
    const [fw, fh] = footprintOf(pick);
    const fits = (fw > 1 || fh > 1) && fw <= BLOCK && fh <= BLOCK
      && span(ox, oy, fw, fh).every(([x, y]) => houses.has(idx(x, y)) && !used.has(idx(x, y)))
      && !touchesWedge(span(ox, oy, fw, fh));
    // CITY-1 (#652): a housing block passes on its tall/terrace pick and
    // draws ordinary houses tile by tile instead. The MERGED superblocks
    // above keep their long #273 buildings either way — those are the whole
    // point of the shapes option.
    if (fits && !(fill.homes.length > 0 && townHomesBlockAt(ox, oy))) place(pick, ox, oy);
    fillSingles(blockTiles.get(idx(ox, oy)) ?? []);
  }

  // The grown ring, exactly as the legacy path lays it.
  layGrownRing(t, opts, footprintOf, used, place);
  return out;
}

/**
 * MAP-2 (#559): what an OPEN LOT of a town draws — a tree, a park or a tended
 * lawn, mixed by the tile hash.
 *
 * Before this, every leftover single tile drew the lawn (`TOWN_LAWN`) and
 * nothing else, so a town's clipped blocks and a grown district's 1-wide
 * strips read as flat grass fields in the middle of the buildings. The owner
 * asked for trees on exactly those lots. The pick is per tile and pure, so a
 * re-sync, another client and a restored save all draw the same thing.
 */
function lotArtAt(
  x: number, y: number,
  footprintOf: (sprite: string) => [number, number],
  known?: (sprite: string) => boolean,
): string {
  const trees = townTreePool(footprintOf, known);
  const parks = parkPool(footprintOf);
  const roll = hashPick(x + 0x5b, y + 0x27, 100);
  if (trees.length && roll < 55) return trees[hashPick(x, y, trees.length)];
  if (roll < 70) return parks[hashPick(x + 7, y + 13, parks.length)];
  return buildingFootprint(TOWN_LAWN) !== null ? TOWN_LAWN : parks[0];
}

/**
 * CITY-1 (#652): the ORDINARY HOMES this atlas can stand on a single lot.
 *
 * Filtered like every other pool here — the art must be in the building
 * manifest AND, when the caller passes the atlas question, be something the
 * renderer can actually blit yet. An unshipped or not-yet-loaded name simply
 * drops out, so the worst case is the lot the town drew before this ticket
 * (a tree, a park or a lawn) rather than a hole in the map.
 */
function townHomePool(
  footprintOf: (sprite: string) => [number, number],
  known?: (sprite: string) => boolean,
): string[] {
  return TOWN_HOME_VARIANTS.filter((v) => {
    if (buildingFootprint(v) === null) return false;
    if (known && !known(v)) return false;
    try { const [fw, fh] = footprintOf(v); return fw === 1 && fh === 1; } catch { return false; }
  });
}

/**
 * CITY-1 (#652): one block in `TOWN_HOME_BLOCK_IN` is a HOUSING block — its
 * tiles draw ordinary homes instead of the one tall building that fits.
 *
 * Keyed on the block (or, in the grown ring, the quad) origin with the same
 * spatial hash every other town pick uses, salted so it does not correlate
 * with the sprite pick itself. Pure: a town's housing blocks are the same on
 * every client, every re-sync and every reload of a save.
 */
const townHomesBlockAt = (ox: number, oy: number): boolean =>
  TOWN_HOME_BLOCK_IN > 0 && hashPick(ox + 0x6b, oy + 0x29, TOWN_HOME_BLOCK_IN) === 0;

/**
 * CITY-1 (#652): what a FREE SINGLE LOT draws, per tier.
 *
 * Up to this ticket the answer was always `lotArtAt` — a tree, a park or a
 * lawn — for every tier above the village, which is how an upgraded city
 * ended up as towers in a field of grass. Now an upgraded town (tier 1+)
 * fills its lots with the ordinary house pool, and keeps one lot in
 * `TOWN_GREEN_LOT_IN` green so the mix still has gardens in it.
 *
 * Tiers that must not move keep the old answer exactly:
 *   • LEGACY (`TOWN_TIER_LEGACY`) — every map, room and test that asks for no
 *     tier at all gets byte-for-byte what it got before;
 *   • VILLAGE (0) — its own small-homes list is applied by the caller.
 *
 * Returns the pool as well as the painter: an empty pool (no home art in
 * this atlas yet) is the caller's signal to leave the tall-building layout
 * alone, so a half-loaded atlas never produces a town of empty blocks.
 */
function townLotFiller(
  tier: number,
  footprintOf: (sprite: string) => [number, number],
  known?: (sprite: string) => boolean,
): { homes: readonly string[]; art: (x: number, y: number) => string } {
  const homes = tier >= 1 ? townHomePool(footprintOf, known) : [];
  return {
    homes,
    art: (x: number, y: number): string => {
      if (!homes.length) return lotArtAt(x, y, footprintOf, known);
      // The green sprinkle (MAP-2 #559 still holds: a town has trees in it).
      if (TOWN_GREEN_LOT_IN > 0 && hashPick(x + 0x3d, y + 0x11, TOWN_GREEN_LOT_IN) === 0) {
        return lotArtAt(x, y, footprintOf, known);
      }
      return pickTownVariant(x, y, homes);
    },
  };
}

/** The town trees the atlas can draw as a 1×1 lot (MAP-2, #559). */
function townTreePool(
  footprintOf: (sprite: string) => [number, number],
  known?: (sprite: string) => boolean,
): string[] {
  return TOWN_TREE_VARIANTS.filter((v) => {
    if (known && !known(v)) return false;
    try { const [fw, fh] = footprintOf(v); return fw === 1 && fh === 1; } catch { return false; }
  });
}

/**
 * The GROWN RING (tier 2+): the districts beyond the old street plan. Laid
 * last, so a ring tile can never steal art from the original blocks, and
 * always inside the ring — a footprint is only ever placed on tiles
 * `grownTownHouses` returned, which keeps the "no art on a tile that is not
 * this town's" guarantee.
 *
 * Packing: the biggest block building that fits a 2×2 quad first (that is
 * what makes a district read as a city), then a 1×2/2×1 terrace for the
 * 1-wide strips the quads leave over (MAP-2 #559 — the strips used to be
 * lawn), then a single lot.
 *
 * CITY-1 (#652) changed what that last step means, and added a step before
 * it. A single lot is now an ordinary HOUSE (one in `TOWN_GREEN_LOT_IN`
 * stays green), and one quad in `TOWN_HOME_BLOCK_IN` skips both the tower
 * and the terrace so its tiles come out as houses — the owner's "the
 * upgraded city needs normal houses still". A district is therefore a mix of
 * towers, terraces and streets of houses with gardens between them, instead
 * of towers in a lawn.
 */
function layGrownRing(
  t: Town,
  opts: TownBuildingsOptions,
  footprintOf: (sprite: string) => [number, number],
  used: Set<number>,
  place: (sprite: string, ox: number, oy: number) => void,
): void {
  const tier = opts.tier ?? TOWN_TIER_LEGACY;
  if (tier < 2 || !opts.grid) return;
  const ring = grownTownHouses(t, opts.grid, townGrownRings(tier), opts.blocked);
  const ringSet = new Set(ring.map(([x, y]) => idx(x, y)));
  const free = (x: number, y: number): boolean => ringSet.has(idx(x, y)) && !used.has(idx(x, y));
  const ring2 = TOWN_HOUSE_VARIANTS.filter((v) => {
    const [fw, fh] = footprintOf(v);
    return fw === 2 && fh === 2;
  });
  // The terrace pair: the two orientations of the 1×2 art (#273), each of
  // which covers exactly one strip tile and its neighbour along the strip.
  const strips = TOWN_SHAPE_VARIANTS.filter((v) => {
    const [fw, fh] = footprintOf(v);
    return (fw === 2 && fh === 1) || (fw === 1 && fh === 2);
  });
  const fill = townLotFiller(tier, footprintOf, opts.spriteKnown);
  // Row-major, so the greedy packing is deterministic.
  for (const [x, y] of [...ring].sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))) {
    const i = idx(x, y);
    if (used.has(i)) continue;
    // CITY-1 (#652): a housing quad takes neither the tower nor the terrace;
    // its tiles fall through to the ordinary houses below. The tiles it
    // leaves are picked up by this very loop (row-major), so nothing is
    // skipped and the quads that follow simply re-pack around it.
    const homesHere = fill.homes.length > 0 && townHomesBlockAt(x, y);
    const quad = [idx(x, y), idx(x + 1, y), idx(x, y + 1), idx(x + 1, y + 1)];
    const quadFree = quad.every((q) => ringSet.has(q) && !used.has(q));
    // A housing quad draws all FOUR of its tiles at once rather than letting
    // the next quad re-pack a tower around the one house it dropped: a
    // district wants streets of houses, not a house marooned between towers.
    if (quadFree && homesHere) {
      for (const [hx, hy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]] as const) {
        place(fill.art(hx, hy), hx, hy);
      }
      continue;
    }
    if (ring2.length && !homesHere && quadFree) {
      place(pickTownVariant(x, y, ring2), x, y);
      continue;
    }
    if (strips.length && !homesHere) {
      const pick = strips[hashPick(x + 3, y + 5, strips.length)];
      const [fw, fh] = footprintOf(pick);
      const tiles: [number, number][] = [];
      for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) tiles.push([x + dx, y + dy]);
      if (tiles.every(([tx, ty]) => free(tx, ty))) {
        place(pick, x, y);
        continue;
      }
    }
    place(fill.art(x, y), x, y);
  }
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
  /** #444: link from an entire NETWORK (all tiles already in the tree plus
   *  built highways) to a target component, avoiding parallel adjacency.
   *  Deterministic: DIR4 order, FIFO, sorted sources. */
  const linkFromNetwork = (
    sourceSet: Set<number>, targetTiles: number[],
    highwaySet: Set<number>, pavedSet: Set<number>,
  ): [number, number][] => {
    const targets = new Set<number>(targetTiles);
    const prev = new Int32Array(MAP_W * MAP_H).fill(-1);
    const seen = new Uint8Array(MAP_W * MAP_H);
    const queue: number[] = [];
    const orderedSources = [...sourceSet].sort((a, b) => a - b);
    for (const si of orderedSources) {
      if (seen[si]) continue;
      seen[si] = 1;
      prev[si] = si;
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
        if (!targets.has(ni)) {
          let forbidden = false;
          for (const [adx, ady] of DIR4) {
            const ax = nx + adx, ay = ny + ady;
            if (!inBounds(ax, ay)) continue;
            const ai = idx(ax, ay);
            if (ai === cur) continue;
            if (targets.has(ai)) continue;
            if (sourceSet.has(ai) || highwaySet.has(ai)) { forbidden = true; break; }
            if (pavedSet.has(ai) && !sourceSet.has(ai)) { forbidden = true; break; }
          }
          if (forbidden) continue;
        }
        seen[ni] = 1;
        prev[ni] = cur;
        if (targets.has(ni)) { found = ni; break; }
        queue.push(ni);
      }
    }
    if (found === -1) return [];
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

  // #444: incremental Prim that grows the highway network, reusing existing
  // trunk instead of laying parallel roads. At each step the shortest path
  // from the ENTIRE current network (all in-tree town tiles + built highways)
  // to each outside component is measured, and the closest component is linked.
  // The BFS inside linkFromNetwork also forbids intermediate tiles that are
  // 4-adjacent to existing network (other than predecessor / target), which is
  // what creates the double-width strip when two highways leave the same side
  // of a town from adjacent ring tiles.
  const out: [number, number][] = [];
  const added = new Set<number>();
  const highwaySet = new Set<number>();
  // TOWN-4.3 (#679): a planned town's avenue ends are its front doors (BUILD
  // item 3) — "route the inter-town highways to the two avenue termini (pick
  // the terminus nearer each neighbour)". A component that holds a plan's
  // termini is linked TO a terminus rather than to whichever of its tiles the
  // flood reaches first, so the highway enters the town at an avenue end. A
  // map with no planned towns has no doors and keeps the historical targets,
  // so every existing seed's highways stay byte-identical.
  const doors = new Set<number>();
  for (const t of towns) {
    if (!t.plan) continue;
    for (const [dx, dy] of t.plan.termini) doors.add(idx(dx, dy));
  }
  const grow = (root: number): void => {
    const inTree = [root];
    const rest = comps.map((_, i) => i).filter((i) => i !== root);
    const networkSet = new Set<number>(comps[root]);
    while (rest.length) {
      let bestI = -1;
      let bestPath: [number, number][] = [];
      let bestLen = Infinity;
      for (let i = 0; i < rest.length; i++) {
        const compIdx = rest[i];
        let targets = comps[compIdx];
        if (doors.size) {
          const own = targets.filter((id) => doors.has(id));
          if (own.length) targets = own;
        }
        const path = linkFromNetwork(networkSet, targets, highwaySet, paved);
        if (!path.length) continue;
        // path length is number of tiles; shorter is better, tie-break by comp index
        const len = path.length;
        if (len < bestLen || (len === bestLen && compIdx < (rest[bestI] ?? Infinity))) {
          bestLen = len;
          bestI = i;
          bestPath = path;
        }
      }
      if (bestI === -1) {
        // No reachable outside component (walled off) — stop, same as before
        break;
      }
      const compIdx = rest[bestI];
      for (const [tx, ty] of bestPath) {
        const id = idx(tx, ty);
        if (paved.has(id) || added.has(id)) continue;
        added.add(id);
        highwaySet.add(id);
        networkSet.add(id);
        out.push([tx, ty]);
      }
      // The newly connected component's own tiles become part of the network
      for (const id of comps[compIdx]) networkSet.add(id);
      inTree.push(compIdx);
      rest.splice(bestI, 1);
    }
  };
  // TOWN-2 (#653): grow from component 0, exactly as always — but if that
  // links NOTHING (component 0 can be a stranded one-tile lane fragment on a
  // promontory, which an organic outline's coastal variance produces far
  // more of), regrow from the largest component before giving up. Only a
  // map that would otherwise pave NO highway takes the retry, so every
  // existing seed's public roads stay byte-identical.
  grow(0);
  if (!out.length && comps.length > 1) {
    let biggest = 1;
    for (let i = 1; i < comps.length; i++) {
      if (comps[i].length > comps[biggest].length) biggest = i;
    }
    added.clear();
    highwaySet.clear();
    out.length = 0;
    grow(biggest);
  }
  return out;
}

/**
 * PROG-1 (#475): the scenario half of town placement — how many towns the
 * map seats, and whether they must all share one landmass. `connected: false`
 * (the Archipelago) skips the reachability/enclave checks: its towns sit on
 * different islands by design, and bridges are the gameplay.
 */
export interface TownGenOptions {
  townCount?: number;
  connected?: boolean;
  /**
   * Seat town `i` in `regions[i % regions.length]` (the Archipelago's
   * quadrants). Absent, centres sample the whole map as always.
   */
  regions?: Array<{ x0: number; y0: number; x1: number; y1: number }>;
  /**
   * TOWN-2 (#653): the town street plan. Absent reads as `"grid"` — every
   * map generated before the option existed, byte for byte.
   */
  layout?: TownLayout;
}

function placeTowns(
  terrain: Uint8Array, occ: Int16Array, industries: Industry[], rng: () => number,
  shapes = false, rings = false,
  /** FTUE-1 (#464): a preset's town count and neighbourhood (the ordinary map
   *  passes nothing and gets TOWN_COUNT scattered over the island). */
  preset?: { towns?: number; centre?: [number, number] | null; jitter?: number },
  gen: TownGenOptions = {},
): Town[] {
  const towns: Town[] = [];
  const want = gen.townCount === undefined ? TOWN_COUNT
    : Math.max(1, Math.min(6, Math.floor(gen.townCount)));
  const connected = gen.connected !== false;
  // TOWN-4.1 (#677): the town's industry ring and the centre-to-centre gap, at
  // the map's spread (the constants themselves on a standard map).
  const townIndustrySep = spread(TOWN_INDUSTRY_SEP);
  const townTownSep = spread(TOWN_TOWN_SEP);

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

  const wantTowns = preset?.towns ?? want;
  // TOWN-4.3 (#679): `layout: "planned"` replaces the street lattice with a
  // master plan. Everything below reads `planned` once and leaves the grid and
  // organic paths untouched — their maps stay byte-identical.
  const planned = gen.layout === "planned";
  // TOWN-4.3 (#679) + TOWN-4.1 (#677): the plan is sized by the map it is
  // drawn on — the standard 144 map draws the 22–28 tile avenue and the 4×4
  // square, the large 216 one the 32–40 tile avenue and the 4×6 square
  // (`plannedTownSep` follows the same knob).
  const planSize: PlanSize = MAP_SIZES.large === MAP_W ? "large" : "standard";
  // The industry halo is measured against the WHOLE plan (BUILD item 2), so
  // `planTown` needs the footprints in its own shape — and TOWN-4.1's spread
  // of the same TOWN_INDUSTRY_SEP a grid town keeps around its houses.
  const industryRects: IndustryRect[] = planned
    ? industries.map((i) => ({ tx: i.tx, ty: i.ty, w: i.w, h: i.h }))
    : [];
  const plannedIndustrySep = spread(PLANNED_INDUSTRY_SEP);
  // Every tile an earlier plan already reserved (plus its avenue). The
  // reserved bands are NOT stamped in `occ` — TOWN-4.4 reveals them — so a
  // second plan's free-ground test cannot see them, and two plans could
  // interleave; the sep ladder is the target, this set is the hard floor.
  const planTaken = new Set<number>();
  // TOWN-2 (#653): the organic extras of the town that finally places —
  // reset per town, so a rejected candidate's carving never leaks into the
  // next one's `Town` record.
  let organicWedges: number[] | null = null;
  let organicDiag: [number, number, number, number][] | null = null;
  // FTUE-1 (#464): a preset's towns sit at the cluster centre (± jitter) —
  // "1 town, 4 industries close by" means the town is the neighbourhood's
  // heart, not a settlement the seed happened to park near the ring.
  const townCentre = preset?.centre ?? null;
  const townJitter = preset?.jitter ?? 0;
  for (let t = 0; t < wantTowns; t++) {
    let placed = false;
    // try candidate centres at relaxing separation
    // PROG-1 (#475): on a region map (the Archipelago) town `t` samples its
    // centre inside its own quadrant, so the towns spread over the islands
    // instead of clustering on one. Off maps sample the whole map, as ever.
    const region = gen.regions?.length ? gen.regions[t % gen.regions.length] : null;
    // TOWN-4.3 (#679): a planned town keeps `plannedTownSep` (44 standard, 64
    // large — the epic's own numbers, not TOWN-4.1's spread of the grid's 28:
    // a plan is up to 40 tiles long, so 28 would let two plans overlap). The
    // fallback rung is 0 because the hard floor is the plan's own free-ground
    // test plus `planTaken` (no two plans share a tile): a large map that
    // cannot place four plans at the 64 target inside the attempt budget
    // still places four towns that interlock instead of dropping one (seen on
    // seeds 1 and 42). On the standard seeds the target rung places all four
    // towns outright.
    for (const sep of planned ? [plannedTownSep(planSize), 0] : [townTownSep, 6, 4, 2]) {
      for (let attempt = 0; attempt < 120 && !placed; attempt++) {
        const cx = townCentre
          ? Math.round(townCentre[0] + (rng() * 2 - 1) * townJitter)
          : region
            ? region.x0 + Math.floor(rng() * (region.x1 - region.x0 + 1))
            : 4 + Math.floor(rng() * (MAP_W - 8));
        const cy = townCentre
          ? Math.round(townCentre[1] + (rng() * 2 - 1) * townJitter)
          : region
            ? region.y0 + Math.floor(rng() * (region.y1 - region.y0 + 1))
          : 4 + Math.floor(rng() * (MAP_H - 8));
        if (!tileFree(cx, cy)) continue;
        if (industrySep(cx, cy) < townIndustrySep) continue;
        if (sep > 0 && townSep(cx, cy) < sep) continue;

        if (planned) {
          // TOWN-4.3 (#679): draw the master plan on this centre — or reject
          // it and let the next candidate try. `planTown` reads the CURRENT
          // occupancy, so a plan never overlaps an industry or an earlier
          // town, and it returns null when the ground cannot hold a plan
          // worth having (no avenue run, a cut square, < 6 blocks, > 40% of
          // the ideal blocks lost).
          const plan = planTown(cx, cy, terrain, occ, rng, planSize, industryRects, plannedIndustrySep);
          if (!plan) continue;
          let clash = false;
          for (const [x, y] of plan.reserved) if (planTaken.has(idx(x, y))) { clash = true; break; }
          if (!clash) for (const [x, y] of plan.avenueTiles) if (planTaken.has(idx(x, y))) { clash = true; break; }
          if (clash) continue;
          // BUILD item 2: the town OWNS district 0 plus the avenue; the rest
          // of the plan is reserved (TOWN-4.4 reveals it) and stays free land.
          const village = planVillage(plan);
          if (village.houses.length < TOWN_HOUSES_MIN) continue;
          const blocked = new Set<number>();
          for (const [hx, hy] of village.houses) blocked.add(idx(hx, hy));
          for (const [rx, ry] of village.roads) blocked.add(idx(rx, ry));
          // The square is town ground too (the commit stamps it TOWN_OCC):
          // leaving it out of `blocked` made the plaza a "free" pocket walled
          // in by its own blocks, and every plan was rejected as an enclave.
          for (const [sx, sy] of village.square) blocked.add(idx(sx, sy));
          if (connected) {
            if (!allIndustriesReachable(blocked)) continue;
            if (!noEnclaves(blocked)) continue;
          }
          // Commit: houses, streets and the square are the town's ground (a
          // player may not build on them); the reserved districts are not.
          for (const [hx, hy] of village.houses) occ[idx(hx, hy)] = TOWN_OCC;
          for (const [rx, ry] of village.roads) occ[idx(rx, ry)] = TOWN_OCC;
          for (const [sx, sy] of village.square) occ[idx(sx, sy)] = TOWN_OCC;
          for (const [rx, ry] of plan.reserved) planTaken.add(idx(rx, ry));
          for (const [ax, ay] of plan.avenueTiles) planTaken.add(idx(ax, ay));
          towns.push({
            id: towns.length, tx: cx, ty: cy,
            houses: village.houses, roads: village.roads, plan,
          });
          placed = true;
          break;
        }

        // TOWN-GRID: lay the street grid and its house blocks around the
        // centre. Computed against the CURRENT occupancy, so neither houses
        // nor streets can overlap an industry or an earlier town (both are
        // already stamped in `occ`).
        const span = TOWN_SPAN_MIN + Math.floor(rng() * (TOWN_SPAN_MAX - TOWN_SPAN_MIN + 1));
        // TOWN-2 (#653): the organic outline first — 8 octant radius draws —
        // so its blocks can gate the house lots `townLayout` lays. An
        // option-OFF town draws nothing here and stays byte-identical.
        const organic = gen.layout === "organic";
        const outline = organic ? organicBlockMask(span, rng) : null;
        let { houses, roads } = townLayout(
          cx, cy, span, terrain, occ,
          // Houses keep the industry buffer; streets do not, exactly as the
          // ring-and-fill layout behaved — a street may run up to an
          // industry's edge, a house may not. An organic town's houses also
          // keep only the blocks its noisy outline kept.
          (hx, hy) => {
            if (industrySep(hx, hy) < townIndustrySep) return false;
            return !outline
              || outline(Math.floor((hx - cx) / TOWN_BLOCK), Math.floor((hy - cy) / TOWN_BLOCK));
          },
          organic,
        );
        // TOWN-2 (#653): carve the avenues and merge the bigger plots. Runs
        // before every downstream check (house minimum, reachability,
        // enclaves, the occupancy stamp), so they all see the final layout —
        // the same contract the shapes option's merges keep. An organic town
        // does NOT also run `mergeTownBlocks`: the organic pass merges the
        // same pairs (and 4×4s) itself, and two merge passes would fight over
        // the same streets. The `shapes` FACTORY footprint is independent of
        // this and still applies.
        if (organic) {
          const plan = organicTownLayout(cx, cy, span, houses, roads, rng, terrain, occ);
          houses = plan.houses;
          roads = plan.roads;
          organicWedges = plan.wedges;
          organicDiag = plan.diagLinks;
        } else if (shapes) ({ houses, roads } = mergeTownBlocks(cx, cy, houses, roads, rng));
        // F4 (#275): the shapes option merges some block pairs along a street
        // so the long town buildings have ground to stand on. Runs only with
        // the option on — an option-OFF town draws nothing from the stream
        // here and stays byte-identical. The merged tiles are house ground,
        // so every later check (house minimum, reachability, enclaves, the
        // occupancy stamp) sees the final layout.
        // #296: the ring road (no RNG draw, so it never shifts later towns).
        if (rings) roads = addTownRing(houses, roads, terrain, occ);
        // TOWN-2 (#653): open the courts the organic outline can leave
        // fenced in — a sealed pocket of free land is the enclave the checks
        // below refuse, and the ring road fences every bite that is not on
        // the new box edge. The avenue's tiles are protected: a gate through
        // the diagonal street would break it mid-run. A pocket no gate can
        // open throws the whole candidate away; the next centre tries again.
        if (organic) {
          const avenueTiles = new Set<number>();
          for (const [ax, ay, bx, by] of organicDiag ?? []) {
            avenueTiles.add(idx(ax, ay));
            avenueTiles.add(idx(bx, by));
          }
          const opened = openOrganicCourts(houses, roads, terrain, occ, avenueTiles);
          if (!opened.opened) continue;
          houses = opened.houses;
          roads = opened.roads;
        }
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
        // PROG-1 (#475): skipped on a disconnected map (the Archipelago) —
        // its industries are MEANT to be water apart.
        if (connected) {
          if (!allIndustriesReachable(blocked)) continue;
          if (!noEnclaves(blocked)) continue;
        }

        // Commit: mark tiles with TOWN_OCC so later towns/industries avoid them.
        // PP-10: the road tiles are stamped too — a later town's houses AND
        // ring road both treat them as occupied, so towns never overlap.
        for (const [hx, hy] of houses) occ[idx(hx, hy)] = TOWN_OCC;
        for (const [rx, ry] of roads) occ[idx(rx, ry)] = TOWN_OCC;
        towns.push({
          id: towns.length, tx: cx, ty: cy, houses, roads,
          // TOWN-2 (#653): only an organic town carries the avenue's wedge
          // lots and diagonal links; absent fields keep grid towns (and the
          // JSON of every seed-pinned snapshot) exactly as they were.
          ...(organicWedges ? { organicWedges, organicDiag: organicDiag! } : {}),
        });
        organicWedges = null;
        organicDiag = null;
        placed = true;
      }
      if (placed) break;
    }
  }
  return towns;
}

/**
 * #436 — the flat APRON every industry gets on every map: a ring this many
 * tiles wide around its footprint, levelled to the industry's own level
 * (water, rivers and other footprints keep theirs), blended back into the
 * open country by the one-level relaxation in `makeElevation` — the same
 * treatment the town apron gets.
 *
 * Two tiles is the floor the Depot rule needs: a 2×2 lot that edge-touches
 * the footprint (the only way a Depot claims an industry) has every tile
 * within 2 tiles of the footprint. Industries-after-terrain shrank it from 3:
 * the industry is now SITED on ground that is already (nearly) flat at its
 * natural level (`industrySiteFlatness`), so the patch only trims ±1 bumps
 * instead of carving a pit/plateau out of the hillside. FTUE-1 (#464) first shipped
 * this for the Starter Island preset (`MapPreset.industryApron`); #436
 * gives it to every generated map.
 */
export const INDUSTRY_APRON = 2;

/**
 * Industries-after-terrain: the NATURAL height field — the map's elevation
 * with nothing placed on it (no industry, no town). `generateMap` builds it
 * right after land/water/rivers, and the industry placer reads it to pick
 * ground that is already flat. `makeElevation`'s jitter draws from its own
 * seed-derived stream, so this costs the main RNG stream nothing.
 */
function naturalHeight(
  seed: number, terrain: Uint8Array, rivers: Uint8Array | undefined,
  strength: "normal" | "strong",
): Uint8Array {
  return makeElevation(seed, terrain, rivers, [], [], 0, strength);
}

/** Tiles of the box `pad` tiles around a footprint (the footprint included). */
function forBox(
  tx: number, ty: number, w: number, h: number, pad: number,
  fn: (x: number, y: number) => boolean | void,
): boolean {
  for (let y = ty - pad; y < ty + h + pad; y++) {
    for (let x = tx - pad; x < tx + w + pad; x++) {
      if (!inBounds(x, y)) continue;
      if (fn(x, y) === false) return false;
    }
  }
  return true;
}

/**
 * The level an industry takes on the natural field `h0`: the footprint's most
 * common level (ties → lower), pressed to 0 beside water — the same rule the
 * old flatten applied at a river's edge, so a waterfront site keeps a legal
 * bank.
 */
export function industrySiteLevel(
  h0: Uint8Array, terrain: Uint8Array, tx: number, ty: number, w: number, h: number,
): number {
  const count = [0, 0, 0, 0, 0];
  let wet = false;
  forBox(tx, ty, w, h, 0, (x, y) => { count[h0[idx(x, y)]]++; });
  forBox(tx, ty, w, h, 1, (x, y) => { if (terrain[idx(x, y)] === WATER) wet = true; });
  if (wet) return 0;
  let best = 0;
  for (let l = 1; l < count.length; l++) if (count[l] > count[best]) best = l;
  return best;
}

/**
 * How well a footprint sits on the natural field:
 *   2 — the footprint and its whole Depot catchment (`INDUSTRY_APRON` ring)
 *       are already one level, and the country beyond is within ±1;
 *   1 — nearly flat: footprint + catchment within ±1 of the site level (the
 *       generator levels just that small patch, blending ≤ 1 level) and the
 *       country beyond within ±1 too — no pit, no plateau;
 *   0 — anything else.
 */
export function industrySiteFlatness(
  h0: Uint8Array, terrain: Uint8Array, tx: number, ty: number, w: number, h: number,
): 0 | 1 | 2 {
  const lv = industrySiteLevel(h0, terrain, tx, ty, w, h);
  let exact = true;
  const near = forBox(tx, ty, w, h, INDUSTRY_APRON, (x, y) => {
    const i = idx(x, y);
    if (terrain[i] === WATER) return;
    const d = Math.abs(h0[i] - lv);
    if (d > 1) return false;
    if (d) exact = false;
  });
  if (!near) return 0;
  const outer = forBox(tx, ty, w, h, INDUSTRY_APRON + 3, (x, y) => {
    const i = idx(x, y);
    if (terrain[i] !== WATER && Math.abs(h0[i] - lv) > 1) return false;
  });
  if (!outer) return 0;
  return exact ? 2 : 1;
}

/** A placement stage's flatness gate: accept a footprint at `tier` or better. */
type SiteGate = (tx: number, ty: number, w: number, h: number, tier: 0 | 1 | 2) => boolean;

/**
 * Build a small, deliberately conservative height field. This is kept separate
 * from terrain generation so enabling it cannot consume (or perturb) the
 * historical RNG stream. Fixed tiles are flattened first, then the remaining
 * field is relaxed until every 4-neighbour slope is drawable.
 *
 * Rivers are assigned level zero. That is the lowest level on every river
 * course, and consequently makes the downhill/no-uphill contract independent
 * of which meander the river generator selected.
 */
function makeElevation(
  seed: number,
  terrain: Uint8Array,
  rivers: Uint8Array | undefined,
  industries: readonly Industry[],
  towns: readonly Town[],
  /** #436: flat apron tiles around EVERY industry — `INDUSTRY_APRON` on an
   *  ordinary map, a preset's tuned width on a scenario (0 = none). */
  industryApron = INDUSTRY_APRON,
  strength: "normal" | "strong" = "normal",
  /** Each industry's level (index-aligned with `industries`), read off the
   *  natural field it was sited on. */
  industryLevels?: readonly number[],
): Uint8Array {
  const n = MAP_W * MAP_H;
  const height = new Uint8Array(n);
  const fixed = new Uint8Array(n);
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  // Distance from an edge gives the broad coast-to-hills shape. The seeded
  // jitter supplies variation without making adjacent tiles discontinuous.
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const i = idx(x, y);
    if (terrain[i] === WATER || rivers?.[i]) {
      fixed[i] = 1;
      height[i] = 0;
      continue;
    }
    const edge = Math.min(x, y, MAP_W - 1 - x, MAP_H - 1 - y);
    // PROG-1 (#475): `strong` (the Highlands) raises the interior sooner and
    // rolls more jitter into it. The normal line is untouched — historical
    // seeds keep their heights byte for byte.
    height[i] = strength === "strong"
      ? Math.min(4, Math.max(1, Math.floor(edge / 5) + (rng() < 0.5 ? 1 : 0) + (rng() < 0.3 ? 1 : 0)))
      : Math.min(4, Math.max(1, Math.floor(edge / 10) + (rng() < 0.28 ? 1 : 0)));
  }

  const flatten = (tiles: readonly [number, number][]) => {
    const valid = tiles.filter(([x, y]) => inBounds(x, y));
    if (!valid.length) return;
    let level = Math.min(...valid.map(([x, y]) => height[idx(x, y)]));
    // A footprint beside sea/river water cannot be higher than the one-step
    // slope band above it. This also handles a town whose broad footprint
    // reaches the ragged coastline.
    // Settlements and industries are deliberately on the low shelf. Besides
    // being a useful building convention, this leaves a one-level buffer for
    // the surrounding coast and for later bridge work.
    level = Math.min(level, 1);
    for (const [x, y] of valid) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (inBounds(nx, ny) && fixed[idx(nx, ny)] && height[idx(nx, ny)] === 0) level = 0;
        if (inBounds(nx, ny) && terrain[idx(nx, ny)] === WATER) level = Math.min(level, 1);
      }
    }
    for (const [x, y] of valid) {
      const i = idx(x, y);
      fixed[i] = 1;
      height[i] = level;
    }
  };
  // Industries-after-terrain: an industry was sited on ground that is already
  // (nearly) flat in the NATURAL field, so it keeps its natural level
  // (`industryLevels`, from `industrySiteLevel`) instead of being pressed down
  // onto the low shelf — no pit, no plateau. Without levels (legacy callers)
  // the old low-shelf flatten runs.
  industries.forEach((ind, k) => {
    const tiles: [number, number][] = [];
    for (let y = ind.ty; y < ind.ty + ind.h; y++) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) tiles.push([x, y]);
    }
    const lv = industryLevels?.[k];
    if (lv === undefined) { flatten(tiles); return; }
    for (const [x, y] of tiles) {
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      fixed[i] = 1;
      height[i] = lv;
    }
  });
  for (const town of towns) flatten([...town.houses, ...town.roads, [town.tx, town.ty]]);

  // #436: a flat APRON around every industry — its own level, the ring
  // blended back by the relaxation below exactly as the town apron is. This
  // is what makes the land around an industry buildable: the per-tile jitter
  // above made every Depot footprint beside an industry straddle a level
  // change ("not flat"), and the fix is the town apron's, applied to
  // industries. It runs BEFORE the town apron so the industry's own ring —
  // the guarantee the Depot rule reads — wins the few tiles a town's apron
  // could otherwise claim (a big town's apron and an industry apron can meet
  // at TOWN_INDUSTRY_SEP). Water, rivers and other footprints keep theirs
  // (already fixed); rivers are never cut off, and the apron writes height
  // bytes only — no terrain tile changes course.
  const besideWater = (x: number, y: number): boolean => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (inBounds(nx, ny) && (terrain[idx(nx, ny)] === WATER || rivers?.[idx(nx, ny)])) return true;
    }
    return false;
  };
  if (industryApron > 0) {
    for (const ind of industries) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let y = ind.ty; y < ind.ty + ind.h; y++) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) {
          x0 = Math.min(x0, x); y0 = Math.min(y0, y);
          x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        }
      }
      const level = height[idx(ind.tx, ind.ty)];
      for (let y = y0 - industryApron; y <= y1 + industryApron; y++) {
        for (let x = x0 - industryApron; x <= x1 + industryApron; x++) {
          if (!inBounds(x, y)) continue;
          const i = idx(x, y);
          if (fixed[i]) continue;                       // water, rivers, footprints
          // A raised patch never presses a cliff against the water: leave a
          // shore tile to the relaxation (only reachable on a lenient site).
          if (level > 1 && besideWater(x, y)) continue;
          height[i] = level;
          fixed[i] = 1;
        }
      }
    }
  }

  // MAP-1 (#412): a flat APRON around every town. The per-tile jitter above
  // makes open land bumpy everywhere, and a Factory (up to 2×4 with shapes)
  // needs a level footprint that shares an edge with the town — without an
  // apron the opening move (first-run coach: "place your Factory beside a
  // town") often had no legal site. The apron takes the town's own level;
  // water, rivers, industry footprints and industry aprons keep theirs
  // (already fixed).
  const APRON = 6;
  for (const town of towns) {
    const pts = [...town.houses, ...town.roads, [town.tx, town.ty] as [number, number]];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const level = height[idx(town.tx, town.ty)];
    // Industries-after-terrain: an industry now keeps its natural level, which
    // may sit well above the town's low shelf. The town apron gives way near
    // it — enough open ground between the two flats for the one-level-per-
    // tile blend to climb without dragging the country beside the industry
    // more than a level off (no terrace cut in next to its catchment).
    const clear = industryLevels
      ? industries.map((ind, k) => ({ ind, d: industryApron + 3 + Math.abs((industryLevels[k] ?? level) - level) }))
      : [];
    const nearIndustry = (x: number, y: number) => clear.some(({ ind, d }) =>
      Math.max(ind.tx - x, x - (ind.tx + ind.w - 1), ind.ty - y, y - (ind.ty + ind.h - 1)) < d);
    for (let y = y0 - APRON; y <= y1 + APRON; y++) {
      for (let x = x0 - APRON; x <= x1 + APRON; x++) {
        if (!inBounds(x, y)) continue;
        const i = idx(x, y);
        if (fixed[i]) continue;                       // water, rivers, industries, the town itself
        if (clear.length && nearIndustry(x, y)) continue;
        height[i] = level;
        fixed[i] = 1;
      }
    }
  }

  // Repeatedly project each unfixed tile into the intersection of the
  // one-level bands around its neighbours. Fixed footprints and water are
  // never changed. More passes than the map diameter makes the result stable
  // even on a coast with a large height discontinuity.
  for (let pass = 0; pass < MAP_W + MAP_H + 8; pass++) {
    const next = height.slice();
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      const i = idx(x, y);
      if (fixed[i]) continue;
      let low = 0, high = 4;
      for (const [dx, dy] of [
        [-1, 0], [1, 0], [0, -1], [0, 1],
        [-1, -1], [1, -1], [-1, 1], [1, 1],
      ] as const) {
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny)) continue;
        const neighbour = height[idx(nx, ny)];
        low = Math.max(low, neighbour - 1);
        high = Math.min(high, neighbour + 1);
      }
      // If noisy neighbours disagree, prefer the upper bound: water/sea is a
      // hard zero and lowering the intervening tile lets the next pass lower
      // its inland neighbour too.
      next[i] = low > high ? high : Math.max(low, Math.min(high, height[i]));
    }
    // A pass that changes nothing is a fixed point: every later pass would
    // be a no-op, so stopping here returns the identical field, faster.
    let same = true;
    for (let i = 0; i < n; i++) if (next[i] !== height[i]) { same = false; break; }
    if (same) break;
    height.set(next);
  }
  return height;
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
export function generateMap(seed: number, opts: MapGenOptions = {}): Grid {
  // TOWN-4.1 (#677): the map is built at the live size, which the boot set
  // just before this call. A caller that names a size is held to it.
  if (opts.size !== undefined && (MAP_SIZES[opts.size] !== MAP_W || MAP_SIZES[opts.size] !== MAP_H)) {
    throw new Error(`generateMap: a ${opts.size} map was asked for, but the map is ${MAP_W}×${MAP_H} — call setMapSize before generating`);
  }
  lockMapSize();
  const s = seed >>> 0;
  const rng = mulberry32(s);
  // PROG-1 (#475): the scenario knobs thread through here. Every one defaults
  // to the historical behaviour, so a default generateMap draws the same
  // stream and stamps the same tiles as before.
  const { terrain, channels } = makeTerrain(rng, opts.archipelago === true);
  // R1 (#260): rivers go in BEFORE industries/towns so every placement stage
  // routes around them as water. Off by default: no RNG is drawn and no tile
  // changes, so option-OFF seeds stay byte-identical to the old generator.
  const riverMask = opts.rivers ? carveRivers(terrain, rng) : undefined;
  // FTUE-1 (#464): a preset draws its cluster centre from the seed — near the
  // middle of the island so the neighbourhood stays inland — and every stage
  // below places against it. A default map draws NOTHING here: the seeded
  // stream every later stage reads is untouched, byte for byte.
  const preset = opts.preset ?? null;
  const cluster: [number, number] | null = preset
    ? [Math.round(MAP_W / 2 + (rng() * 2 - 1) * 6), Math.round(MAP_H / 2 + (rng() * 2 - 1) * 6)]
    : null;
  // Industries-after-terrain: the land, water, rivers AND the natural
  // elevation exist before a single industry is placed. The placer reads the
  // natural field through `gate` and picks footprints whose Depot catchment
  // is already flat (or nearly — then only a small patch is levelled, ≤ 1
  // level of blend), so industries no longer sit in pits/plateaus ringed by
  // artificial slopes. Elevation OFF: no field, no gate — the historical
  // placement, byte for byte. Elevation ON: the gate rejects candidates, so
  // the main RNG stream is consumed differently from here on (accepted: the
  // map is still a pure function of the seed + options).
  const strength = opts.elevationStrength === "strong" ? "strong" : "normal";
  const h0 = opts.elevation ? naturalHeight(s, terrain, riverMask, strength) : null;
  const terrain0 = h0 ? terrain.slice() : terrain;   // the ground h0 was read over
  const gate: SiteGate | undefined = h0
    ? (tx, ty, w, h, tier) => industrySiteFlatness(h0, terrain0, tx, ty, w, h) >= tier
    : undefined;
  const { list, occ } = placeIndustries(terrain, rng, preset ?? undefined, cluster,
    opts.waterfrontIndustries === true, gate);
  // TOWN-1: towns are placed AFTER industries (sequencing), using the same
  // seeded RNG so the map stays deterministic. Town tiles are stamped with
  // TOWN_OCC in the occupancy array so roads/other structures route around.
  const towns = placeTowns(terrain, occ, list, rng, opts.shapes === true, opts.rings === true,
    preset ? { towns: preset.towns, centre: cluster, jitter: 2 } : undefined, {
      townCount: opts.townCount,
      connected: opts.archipelago === true ? false : undefined,
      regions: opts.archipelago === true ? archipelagoRegions() : undefined,
      // TOWN-2 (#653) / TOWN-4.3 (#679): the street plan rides the map
      // options. Absent ("grid") regenerates every pre-TOWN-2 seed byte for
      // byte, and an undefined/unknown name reads as "grid" — so a "planned"
      // map is the only one whose stream moves.
      layout: opts.layout === "planned" ? "planned" : opts.layout === "organic" ? "organic" : "grid",
    });
  // TOWN-3 (#561): name the towns from the seed alone, on a private RNG
  // stream (see `town-names.ts`) — drawn AFTER placement so the number and
  // order of towns is already final, and never from `rng` itself, so no
  // seed's terrain/industry/town geometry changes. Deterministic and
  // repeat-free per map; every client rebuilds the same names from the same
  // seed, so nothing here needs to travel on a save or the MP wire.
  {
    const names = deriveTownNames(s, towns.length);
    for (let i = 0; i < towns.length; i++) towns[i].name = names[i];
  }
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
  // FTUE-1 (#464): a PRESET owns its layout — the ring IS the design, and the
  // repair's local nudge would quietly break "close by" — so it runs only for
  // the ordinary generator.
  if (!preset) {
    applyRoadSpawnBuffer(terrain, occ, list, publicRoads, {
      waterfront: opts.waterfrontIndustries === true,
      connected: opts.archipelago === true ? false : undefined,
    }, gate);
  }
  // FTUE-1 (#464): gentle terrain — no rough ground in a preset's industry
  // aprons. Buildable, flat-cost land all around the four industries, so the
  // Starter Island's first Depot sites are kind ground.
  if (preset) {
    for (const ind of list) {
      for (let y = ind.ty - preset.industryApron; y < ind.ty + ind.h + preset.industryApron; y++) {
        for (let x = ind.tx - preset.industryApron; x < ind.tx + ind.w + preset.industryApron; x++) {
          if (!inBounds(x, y)) continue;
          if (terrain[idx(x, y)] === ROUGH) terrain[idx(x, y)] = GRASS;
        }
      }
    }
  }
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
  // F4 (#275): the ring follows the Factory the map actually plays with —
  // the long shapes footprint is one tile longer than the legacy complex,
  // so its town-adjacent sites keep the flat-ground guarantee too. An
  // option-OFF map runs with the legacy constant, byte for byte.
  const factoryRing = Math.max(...factoryFootprintFor(opts.shapes === true));
  for (const t of towns) {
    for (const [hx, hy] of [...t.houses, ...t.roads]) {
      for (let dy = -factoryRing; dy <= factoryRing; dy++) {
        for (let dx = -factoryRing; dx <= factoryRing; dx++) {
          const x = hx + dx, y = hy + dy;
          if (!inBounds(x, y)) continue;
          const i = idx(x, y);
          if (occ[i] === -1 && terrain[i] === ROUGH) terrain[i] = GRASS;
        }
      }
    }
  }
  // Coastal repair runs AFTER all seed-derived placement. Only WATER becomes
  // SAND: existing land, industries, towns and public roads remain identical
  // to v10, making old solo saves safe to resume on the improved coastline.
  // R1 (#260): river water is exempt — a 1-tile river bend has three land
  // neighbours and would otherwise be "repaired" into a sand plug. The same
  // exemption covers the sea tile a river mouth pours into, so the mouth
  // stays open.
  const riverNear = (x: number, y: number): boolean => {
    if (!riverMask) return false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H && riverMask[idx(nx, ny)]) return true;
    }
    return false;
  };
  for (let pass = 0; pass < 2; pass++) {
    const prev = terrain.slice();
    for (let y = 1; y < MAP_H - 1; y++) for (let x = 1; x < MAP_W - 1; x++) {
      if (prev[idx(x, y)] !== WATER) continue;
      if (riverNear(x, y)) continue;
      // PROG-1 (#475): channel water is exempt like river water — a sharp
      // meander would otherwise be \"repaired\" into a sand plug and the two
      // islands it separates would rejoin.
      if (channels && channels[idx(x, y)]) continue;
      const neighbours = [prev[idx(x - 1, y)], prev[idx(x + 1, y)],
        prev[idx(x, y - 1)], prev[idx(x, y + 1)]];
      if (neighbours.filter(v => v !== WATER).length >= 3) terrain[idx(x, y)] = SAND;
    }
  }
  fillCoastalHoles(terrain, MAP_W, MAP_H, WATER, SAND);
  // #296: the towns' rings once more, now that every industry has settled —
  // an industry relocated after the towns were laid (PP-14) can leave free
  // ground inside a ring or on its line. No RNG.
  if (opts.rings) {
    for (const town of towns) {
      const before = new Set(town.roads.map(([x, y]) => idx(x, y)));
      town.roads = addTownRing(town.houses, town.roads, terrain, occ);
      for (const [x, y] of town.roads) if (!before.has(idx(x, y))) occ[idx(x, y)] = TOWN_OCC;
    }
  }
  // TOWN-2 (#653): re-open the organic courts — the ring's late re-run would
  // otherwise re-pave the gates the first pass cut, and an industry the PP-14
  // repair moved can fence a new pocket in. Court houses stamp TOWN_OCC like
  // any other house; a re-cut gate's tile goes back to free land.
  if (opts.layout === "organic") {
    for (const town of towns) {
      const beforeRoads = new Set(town.roads.map(([x, y]) => idx(x, y)));
      const avenueTiles = new Set<number>();
      for (const [ax, ay, bx, by] of town.organicDiag ?? []) {
        avenueTiles.add(idx(ax, ay));
        avenueTiles.add(idx(bx, by));
      }
      const fixed = openOrganicCourts(town.houses, town.roads, terrain, occ, avenueTiles);
      town.houses = fixed.houses;
      town.roads = fixed.roads;
      const nowRoads = new Set(town.roads.map(([x, y]) => idx(x, y)));
      for (const [gx, gy] of town.roads) {
        if (!beforeRoads.has(idx(gx, gy))) occ[idx(gx, gy)] = TOWN_OCC;
      }
      for (const k of beforeRoads) {
        if (!nowRoads.has(k)) occ[k] = -1;
      }
    }
  }
  // Elevation is intentionally computed after all map placement. Thus every
  // generated industry and town footprint can be flat without changing the
  // placement RNG stream. Option-off still returns a flat compatibility map.
  // Industries keep the level of the natural ground they were sited on.
  const height = h0
    ? makeElevation(s, terrain, riverMask, list, towns, preset?.industryApron ?? INDUSTRY_APRON,
      strength, list.map((ind) => industrySiteLevel(h0, terrain0, ind.tx, ind.ty, ind.w, ind.h)))
    : new Uint8Array(MAP_W * MAP_H);
  // fillCoastalHoles only fills sea-disconnected WATER; rivers reach the sea so
  // they survive — but re-assert the mask as water regardless, so the layer
  // the renderer reads can never disagree with the terrain.
  if (riverMask) for (let i = 0; i < riverMask.length; i++) if (riverMask[i]) terrain[i] = WATER;

  return {
    w: MAP_W, h: MAP_H, terrain, height, industries: list, towns, publicRoads, occupancy: occ, seed: s,
    rivers: riverMask,
    // F4 (#275): shapes maps play with the long Factory footprint. OFF maps
    // carry nothing, so every consumer keeps the legacy constant.
    factoryFootprint: opts.shapes ? factoryFootprintFor(true) : undefined,
  };
}

/**
 * FTUE-1 (#464): the Starter Island — the one door to the first game's map.
 *
 * Fixed seed, preset overrides, and the map features the scenario is tuned
 * for (rivers OFF: the guide's chain teaches roads, not bridges; elevation ON
 * so the aprons mean something; shapes and rings ON — the modern island).
 * The game boots this instead of `generateMap` whenever the scenario runs,
 * so the browser and the unit tests can never see two different islands.
 */
export function starterIslandGrid(): Grid {
  return generateMap(STARTER_ISLAND_SEED, {
    preset: STARTER_ISLAND,
    rivers: false,
    elevation: true,
    shapes: true,
    rings: true,
  });
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

/** Read a tile's generated elevation; synthetic/legacy grids are flat. */
export const heightAt = (g: Grid, tx: number, ty: number): number =>
  inBounds(tx, ty) ? (g.height?.[idx(tx, ty)] ?? 0) : 0;

/**
 * #456 Level Ground — the map's one height MUTATION seam. Writes tile levels
 * ([x, y, level] triples) into `Grid.height` and returns the tiles whose byte
 * actually moved, in order — the exact list every height cache (the
 * elevation lattice, the terrain-GL mesh, road/rail geometry, decals) must
 * be invalidated for. Inert on a map with no height bytes (option off), and
 * silent on out-of-map triples, so a wire payload can never grow a NaN.
 */
export function setHeightTiles(
  g: Grid,
  changes: readonly (readonly [number, number, number])[],
): [number, number][] {
  const out: [number, number][] = [];
  if (!g.height) return out;
  for (const [x, y, level] of changes) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(level)) continue;
    if (!inBounds(x, y) || level < 0 || level > 255) continue;
    const i = idx(x, y);
    if (g.height[i] === level) continue;
    g.height[i] = level;
    out.push([x, y]);
  }
  return out;
}

export const industryAt = (g: Grid, tx: number, ty: number): Industry | null => {
  if (!inBounds(tx, ty)) return null;
  const id = g.occupancy[idx(tx, ty)];
  return id >= 0 ? g.industries[id] : null;
};

/**
 * #159: one byte per tile — non-zero where a town's BLOCK ground is, i.e. the
 * tiles a town's houses stand on (its streets are the road bits, and its
 * houses are `TOWN_OCC` in the occupancy rather than houses in a list).
 *
 * Derived rather than tracked, and cached per grid like the ground contours:
 * the towns are a pure function of the seed and never change during a game, so
 * this costs one pass over the houses the first time anything asks and nothing
 * thereafter. Returns null when the map has no towns at all, which is what
 * lets every caller treat "no towns" and "no town ground" identically.
 */
const townGroundCache = new WeakMap<Grid, Uint8Array | null>();

export function townGroundBytes(grid: Grid): Uint8Array | null {
  const cached = townGroundCache.get(grid);
  if (cached !== undefined) return cached;
  let bytes: Uint8Array | null = null;
  if (grid.towns.length) {
    bytes = new Uint8Array(grid.w * grid.h);
    for (const town of grid.towns) {
      for (const [tx, ty] of town.houses) {
        if (tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h) bytes[ty * grid.w + tx] = 1;
      }
    }
  }
  townGroundCache.set(grid, bytes);
  return bytes;
}

/**
 * #437 — SETTLED GROUND: every tile whose ground people keep.
 *
 * That is a town's own tiles (houses, centre and streets — everything stamped
 * `TOWN_OCC`) plus every industry footprint. The terrain renderer takes this
 * as the seed of a short distance falloff (`LAWN_FEATHER` in
 * `terrain-gl/mesh.ts`), so the mask is BOTH the town blocks and the apron of
 * worked ground around a site — which is exactly the ground the owner reported
 * rendering as flat brown mud.
 *
 * Standing wheat fields and tree blocks (`FIELD_OCC`) are deliberately NOT
 * settled: a field is a crop, not a lawn, and it carries its own art.
 *
 * Cached per grid exactly like `townGroundBytes`: occupancy is written by the
 * generator and never moves during a game, so this costs one pass over the map
 * the first time anything asks and nothing thereafter. Returns null when the
 * map has no towns and no industries, which lets the caller skip the upload.
 */
const settledGroundCache = new WeakMap<Grid, Uint8Array | null>();

export function settledGroundBytes(grid: Grid): Uint8Array | null {
  const cached = settledGroundCache.get(grid);
  if (cached !== undefined) return cached;
  let bytes: Uint8Array | null = null;
  const occ = grid.occupancy;
  for (let i = 0; i < occ.length; i++) {
    // >= 0 an industry, TOWN_OCC a town tile. -1 is open ground and FIELD_OCC
    // is a standing crop; neither is tended.
    if (occ[i] < 0 && occ[i] !== TOWN_OCC) continue;
    if (!bytes) bytes = new Uint8Array(grid.w * grid.h);
    bytes[i] = 1;
  }
  settledGroundCache.set(grid, bytes);
  return bytes;
}

export const industryHasTile = (ind: Industry, tx: number, ty: number) =>
  tx >= ind.tx && tx < ind.tx + ind.w && ty >= ind.ty && ty < ind.ty + ind.h;

/**
 * F4 (#275): the Factory footprint a map plays with. Legacy / option-OFF maps
 * carry no `factoryFootprint` and fall back to the constant, so every rule
 * that reads this behaves exactly as before until the shapes option sets one.
 */
export const factoryFootprintOf = (grid: Pick<Grid, "factoryFootprint">): [number, number] =>
  grid.factoryFootprint ?? FACTORY_FOOTPRINT;

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
export function factoryTouchesTown(
  grid: Grid, tx: number, ty: number, rot = 0,
  footprint?: readonly [number, number],
): boolean {
  const fp = footprint ?? factoryFootprintOf(grid);
  const [fw, fh] = rotatedSpan(fp[0], fp[1], rot);
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
export function canPlaceFactory(
  grid: Grid, tx: number, ty: number, rot = 0,
  footprint?: readonly [number, number],
): FactoryPlacement {
  const fp = footprint ?? factoryFootprintOf(grid);
  const [fw, fh] = rotatedSpan(fp[0], fp[1], rot);
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
  if (!factoryTouchesTown(grid, tx, ty, rot, footprint)) {
    return {
      ok: false,
      reason: "The Factory must be next to a town — at least one of its tiles must share an edge with a town tile.",
    };
  }
  return { ok: true, reason: null };
}

/**
 * MP-AUDIT — deterministic distinct starting-town reservations.
 * Two distant towns, each with a legal factory footprint and a nearby depot site.
 * Deterministic pure function of the grid (seed-derived), so both clients agree
 * without wire traffic. Camera, Recenter and opening placement use the local
 * seat's reservation.
 */
export function startingTownReservations(
  grid: Grid,
  footprint: readonly [number, number] = factoryFootprintOf(grid),
): [Town, Town] | null {
  // Collect eligible towns: at least one factory site touching the town
  // that is buildable, and a depot site within 12 tiles of that factory
  // that is dirt-buildable and has an industry in catchment.
  const eligible: Town[] = [];
  for (const town of grid.towns) {
    let hasFactory = false;
    let hasDepot = false;
    // Search factory sites in expanded bounding box around town
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [hx, hy] of [...town.houses, ...town.roads]) {
      minX = Math.min(minX, hx); maxX = Math.max(maxX, hx);
      minY = Math.min(minY, hy); maxY = Math.max(maxY, hy);
    }
    if (!isFinite(minX)) continue;
    // Expand by factory footprint + adjacency
    const pad = Math.max(...footprint) + 2;
    outer: for (let y = minY - pad; y <= maxY + pad; y++) {
      for (let x = minX - pad; x <= maxX + pad; x++) {
        let okFactory = false;
        let touchesThis = false;
        for (const rot of [0, 1]) {
          const fac = canPlaceFactory(grid, x, y, rot, footprint);
          if (!fac.ok) continue;
          if (!factoryTouchesTown(grid, x, y, rot, footprint)) continue;
          okFactory = true;
          // Must be touching THIS town, not just any town
          // Check if any footprint tile touches this town's tiles
          const [fw, fh] = rotatedSpan(footprint[0], footprint[1], rot);
          for (let dy = 0; dy < fh && !touchesThis; dy++) {
            for (let dx = 0; dx < fw && !touchesThis; dx++) {
              const fx = x+dx, fy = y+dy;
              if (isTownTile(grid, fx, fy-1) || isTownTile(grid, fx, fy+1) || isTownTile(grid, fx-1, fy) || isTownTile(grid, fx+1, fy)) {
                // Check if that neighbor belongs to this town
                const nbs = [[fx, fy-1],[fx, fy+1],[fx-1, fy],[fx+1, fy]];
                for (const [nx,ny] of nbs) {
                  if (town.houses.some(([hx,hy])=>hx===nx&&hy===ny) || town.roads.some(([rx,ry])=>rx===nx&&ry===ny)) touchesThis = true;
                }
              }
            }
          }
          if (touchesThis) break;
        }
        if (!okFactory) continue;
        if (!touchesThis) continue;
        hasFactory = true;
        // Look for depot nearby
        for (let dy2 = -12; dy2 <= 12 && !hasDepot; dy2++) {
          for (let dx2 = -12; dx2 <= 12 && !hasDepot; dx2++) {
            const dx = x+dx2, dy = y+dy2;
            if (!inBounds(dx, dy)) continue;
            const i = idx(dx, dy);
            if (grid.terrain[i] === WATER) continue;
            if (grid.occupancy[i] !== -1) continue;
            // Rough is allowed for depot (dirt), so only water/occupancy blocks
            // Check catchment has an industry
            let hasInd = false;
            for (const ind of grid.industries) {
              if (dx >= ind.tx-4 && dx < ind.tx+ind.w+4 && dy >= ind.ty-4 && dy < ind.ty+ind.h+4) {
                // Simple 4x4 catchment check approximated
                const cx0 = dx-4, cy0 = dy-4, cx1 = dx+4, cy1 = dy+4;
                if (ind.tx <= cx1 && ind.tx+ind.w-1 >= cx0 && ind.ty <= cy1 && ind.ty+ind.h-1 >= cy0) { hasInd = true; break; }
              }
            }
            if (hasInd) hasDepot = true;
          }
        }
        if (hasFactory && hasDepot) break outer;
      }
    }
    if (hasFactory && hasDepot) eligible.push(town);
  }
  if (eligible.length < 2) {
    // Fallback: any two towns with max distance
    if (grid.towns.length < 2) return null;
    let best: [Town,Town] | null = null;
    let bestD = -1;
    for (let i=0;i<grid.towns.length;i++) for(let j=i+1;j<grid.towns.length;j++) {
      const a=grid.towns[i], b=grid.towns[j];
      const d = Math.max(Math.abs(a.tx-b.tx), Math.abs(a.ty-b.ty));
      if (d>bestD) {bestD=d; best=[a,b];}
    }
    return best;
  }
  // Choose pair with max distance among eligible
  let bestPair: [Town,Town] | null = null;
  let bestDist = -1;
  for (let i=0;i<eligible.length;i++) {
    for(let j=i+1;j<eligible.length;j++) {
      const a=eligible[i], b=eligible[j];
      const d = Math.hypot(a.tx-b.tx, a.ty-b.ty);
      if (d>bestDist) {bestDist=d; bestPair=[a,b];}
    }
  }
  return bestPair;
}

/** Seat → reserved town (0=host,1=guest) */
export function townForSeat(
  grid: Grid, seat: 0 | 1,
  footprint: readonly [number, number] = factoryFootprintOf(grid),
): Town | null {
  const pair = startingTownReservations(grid, footprint);
  if (!pair) return grid.towns[seat] ?? grid.towns[0] ?? null;
  return pair[seat] ?? null;
}

/** Owner (2026-09-26): the 1×1 park/garden art that exists (by footprint). */
function parkPool(footprintOf: (sprite: string) => [number, number]): string[] {
  const ok = TOWN_PARK_VARIANTS.filter((v) => {
    // the art must exist (the game's footprintOf answers [1,1] for an unknown name)
    if (buildingFootprint(v) === null) return false;
    try { const [fw, fh] = footprintOf(v); return fw === 1 && fh === 1; } catch { return false; }
  });
  return ok.length ? ok : ["town_fountain_1x1"];
}

/** A village's whole-block homes that exist as 2×2-or-smaller-than-a-block art. */
function villageBlockPool(footprintOf: (sprite: string) => [number, number], block: number): string[] {
  return TOWN_VILLAGE_BLOCKS.filter((v) => {
    try { const [fw, fh] = footprintOf(v); return (fw > 1 || fh > 1) && fw <= block && fh <= block; } catch { return false; }
  });
}
