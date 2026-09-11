// ══════════════════════════════════════════════════════════════════════════
// E2 — Cargo, industries, and the road/rail scoring split (isometric edition)
//
// Settled decisions (spec doc + owner):
//  1. SIX cargoes, not seven: Iron and Coal merged into a single Ore cargo —
//     the match-3 board hard-codes GEM_FRAMES = 6 / gems_spritesheet.png
//     (6 × 128px frames) and no 7th gem frame exists.
//  2. The match-3 board spawns cargo directly (it is NOT transport
//     capacity); board.ts survives the migration untouched.
//  3. Road→rail upgrade in place is allowed, paying the cost difference.
//  4. One Depot holds one industry: the FIRST Depot with a road at a resource
//     owns its output outright, and no second Depot may be built for it
//     (PP-16 — it replaces "overlapping catchments split output
//     proportionally among claimants", which made a district a spreadsheet
//     instead of a race).
//  5. `gold` stays the sabotage currency (SABOTAGE unchanged).
//     PP-08 tightens that to a hard rule: Gold is reserved for Black Market
//     sabotage and pays for NOTHING else. Security Forces (defensive, not
//     sabotage) were repriced to materials (game/config.ts SECURITY.cost),
//     and the market refuses gold in every exchange — bank and offers, both
//     directions (`trade.ts` blocked set, wired in iso/market.ts).
// ══════════════════════════════════════════════════════════════════════════
import { TILE_W, TILE_H, MAP_W, MAP_H, HW, HH } from "../game/config";
import manifestJson from "../../assets/iso-atlas/manifest.json";
import type { Manifest } from "./atlas";

export { TILE_W, TILE_H, MAP_W, MAP_H, HW, HH };
export { tileToScreen, screenToTile, tileIndex, inMap, mulberry32 } from "../game/config";

// ── Cargoes (also the six match-3 colours) ────────────────────────────────
export type Cargo = "grain" | "wood" | "ore" | "stone" | "oil" | "gold";

export const CARGOES: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];

export const CARGO: Record<Cargo, {
  name: string; icon: string; c1: string; c2: string; gem: string;
}> = {
  grain: { name: "Grain", icon: "🌾", c1: "#b89400", c2: "#ffe83a", gem: "#f5da28" },
  wood:  { name: "Wood",  icon: "🪵", c1: "#6b3410", c2: "#c47a2c", gem: "#c07b34" },
  ore:   { name: "Ore",   icon: "⛏️", c1: "#284a9c", c2: "#5aa8ff", gem: "#3f7fe0" },
  stone: { name: "Stone", icon: "🪨", c1: "#7c8794", c2: "#c7d0da", gem: "#9aa5b0" },
  oil:   { name: "Oil",   icon: "🛢️", c1: "#1c1e20", c2: "#4c4f52", gem: "#2b2d30" },
  gold:  { name: "Gold",  icon: "🪙", c1: "#9c5a02", c2: "#ffb01f", gem: "#f5921f" },
};

// ── Industries ─────────────────────────────────────────────────────────────
// footprint: [w, h] in tiles along the two diamond axes (w × h tiles).
// output: relative harvest rate (1.0 = baseline farm).
//
// PP-12: every industry is ONE verbatim Transport Tycoon Deluxe building
// sprite, packed by a `file` cell (tools/iso-atlas.cells.json) under the
// industry's own key (`farm`, `forest`, …) and drawn as a single draw item
// by the renderer. The MT-1/MT-2 per-tile layouts (`<key>_t<m>` cells,
// transcribed `_tile_table_*` data) are retired from the game — their cells
// stay packed in the atlas as legacy (golden fixtures still exercise them),
// but nothing in src/ references them anymore.
export interface IndustryDef {
  key: string;
  name: string;
  cargo: Cargo;
  footprint: [number, number];
  output: number;
}

/**
 * PP-12: tile footprint derived from packed art width — the EXACT mirror of
 * `footprintForFileArt` in tools/slice-atlas.mjs. A square [n, n] footprint's
 * diamond spans n*64 + 32 px before the overhang allowance, so
 * n = ceil((w − 32) / 64) is the smallest square whose span covers the art
 * (64→1, 96→1, 115→2, 224→3, 256→4). Height is deliberately ignored: TTD
 * building height includes vertical structure, not footprint depth.
 *
 * The game and the packer MUST agree here: the slicer stamps this derivation
 * into the manifest for every `footprint: "auto"` file cell, and the defs
 * below re-derive it from the same packed widths, so swapping the art
 * re-flows gameplay (placement, occupancy, catchment) with no code change.
 * tests/unit/iso-pp12-assets.test.ts pins the agreement.
 */
export function footprintForArt(spriteW: number): [number, number] {
  const n = Math.max(1, Math.ceil((spriteW - 32) / TILE_W));
  return [n, n];
}

/** Packed 1x width of a manifest sprite. Fails fast on a stale manifest. */
function spriteWidth(name: string): number {
  const s = (manifestJson as unknown as Manifest).sprites[name];
  if (!s) throw new Error(`PP-12: manifest has no sprite "${name}" — rebuild the atlas (npm run slice-atlas)`);
  return s.w;
}

function industryDef(key: string, name: string, cargo: Cargo, output: number): IndustryDef {
  return { key, name, cargo, footprint: footprintForArt(spriteWidth(key)), output };
}

export const INDUSTRIES: IndustryDef[] = [
  industryDef("farm",      "Farm",      "grain", 1.0),
  industryDef("forest",    "Forest",    "wood",  1.0),
  industryDef("ore_mine",  "Ore Mine",  "ore",   0.8),
  industryDef("quarry",    "Quarry",    "stone", 0.7),
  industryDef("oil_rig",   "Oil Rig",   "oil",   0.4),
  industryDef("gold_mine", "Gold Mine", "gold",  0.3),
];

export const INDUSTRY_BY_KEY: Record<string, IndustryDef> = Object.fromEntries(
  INDUSTRIES.map((d) => [d.key, d]),
);

// Placement quota per industry type (E3): every cargo must be present.
export const INDUSTRY_QUOTA: Record<string, number> = {
  farm: 5, forest: 6, ore_mine: 5, quarry: 4, oil_rig: 3, gold_mine: 2,
};

// ── Road vs rail (the core scoring split) ─────────────────────────────────
/**
 * VP-01: a transport tier earns Victory Points per TILE, and only when it is
 * reached by upgrading the tier underneath it. There is deliberately no VP
 * for a connection any more (neither dirt nor paved), and none for a paved
 * Road laid on virgin ground:
 *
 *   dirt              0 — a Dirt Road is plumbing, not points
 *   road (paved)      VP_UPGRADE per Dirt Road tile paved over in place
 *
 * `vpUpgrade` is the one number the scorer, the HUD labels and the drag
 * preview all read, so "what the button says" and "what the scoreboard pays"
 * cannot drift apart.
 */
export interface TransportDef {
  key: "dirt" | "road";
  name: string;
  cost: Partial<Record<Cargo, number>>;
  /** VP per tile when this tier is reached by upgrading the tier below it. */
  vpUpgrade: number;
  throughput: number;         // multiplier applied to connected harvesters
  onRough: boolean;           // buildable on rough terrain
  label: string;
}

/**
 * The game is de-railwayed into two tiers of ROAD:
 *
 *   dirt  (gravel)  — the cheap basic road. 1 Wood + 1 Stone, no VP, ×1.0,
 *                     buildable on rough ground. Player-built "Dirt Roads"
 *                     render as gravel.
 *   road  (paved)   — the premium road. 1 Wood + 1 Stone + 4 Ore, ×1.6, flat
 *                     ground only. Player-built "Roads" AND the map's
 *                     paved public/town roads live on this tier and render as
 *                     tar. (This was the old "rail" tier, re-skinned as a
 *                     paved road so no literal railway tracks remain.)
 *
 * Paving a Dirt Road into a Road pays only the difference (UPGRADE_COST) and,
 * since VP-01, is the ONLY thing roads are worth points for: 0.25 VP per tile
 * you pave, 0 per connection. A Dirt Road scores nothing at all.
 *
 * PP-07 — THE authoritative construction-cost table (Catan-style roles).
 *
 * Every buildable in the game is priced here, and ONLY here:
 *
 *   dirt    1 Wood + 1 Stone                       basic gravel road
 *   road    1 Wood + 1 Stone + 4 Ore               paved road, better transport
 *   upgrade 4 Ore                                  dirt -> road in place (the difference only)
 *   depot   1 Wood + 1 Stone + 1 Grain + 1 Oil     workforce (grain) + depot expansion (oil)
 *   plant   2 Wood + 2 Stone + 2 Grain + 3 Ore     the second processing plant
 *
 * Gold is deliberately absent: it is reserved for Black Market sabotage
 * (PP-08) and pays for nothing here.
 *
 * The table lives in this module — the lowest import layer — so every surface
 * can read it without an import cycle: TRANSPORT / UPGRADE_COST below alias
 * into it, construction.ts re-exports it for the Depot price (DEPOT_COST),
 * and plants.ts reads the plant entry (PLANT_COST). The UI labels, the
 * placement charges, the AI plans and the multiplayer host authority all
 * resolve through these aliases, so "what you see" and "what you are
 * charged" are one number.
 */
export const BUILD_COSTS: Readonly<Record<
  "dirt" | "road" | "upgrade" | "depot" | "plant",
  Partial<Record<Cargo, number>>
>> = {
  dirt: { wood: 1, stone: 1 },
  road: { wood: 1, stone: 1, ore: 4 },
  upgrade: { ore: 4 },
  depot: { wood: 1, stone: 1, grain: 1, oil: 1 },
  plant: { wood: 2, stone: 2, grain: 2, ore: 3 },
};

// ── VP-01: the victory table ──────────────────────────────────────────────
/**
 * Victory Points come from exactly TWO sources, and both of them are things a
 * player *upgrades* rather than merely connects:
 *
 *   upgrade  0.25★ per Dirt Road tile paved into a Road, in place
 *   plant    1★    per processing plant raised after the setup Factory
 *   target   20★   first player there wins
 *
 * Dirt Road scores nothing (that is the ticket), and neither does a connection
 * — dirt or paved. A connection sets the throughput multiplier and that is its
 * whole job. The paved tile VP is deliberately gated on the UPGRADE
 * (`track.ts`'s `upgraded` provenance layer), so a Road laid on virgin ground
 * at full price earns no point: the score pays for improving what you already
 * built, four paves to the point. At 4 Ore a tile, 20★ of pure road is 80
 * paved tiles (320 Ore) — the scoreboard is a measurement of how much ore a
 * network can turn in, which is what keeps a game from ending on the first
 * two spurs. `victory.ts` is the only reader of these three numbers.
 *
 * AI-02 raised the line from 10★ to 20★ on the player's first long session:
 * a healthy normal-seat race to 10★ was finishing around minute 11–14, before
 * its economy (or the rival's raids) had visibly mattered. The per-point
 * numbers did not move — only the finish line did.
 */
export const VICTORY = {
  /** VP per Dirt Road tile paved into a Road (`TRANSPORT.road.vpUpgrade`). */
  upgrade: 0.25,
  /** VP per processing plant raised after setup. */
  plant: 1,
  /** VP needed to win. AI-02: 10★ ended inside ten minutes against even a
   *  careful player ("10 is way too little") — the race now runs to 20. */
  target: 20,
} as const;

export const TRANSPORT: Record<"dirt" | "road", TransportDef> = {
  dirt: {
    key: "dirt", name: "Dirt Road",
    cost: BUILD_COSTS.dirt,
    // VP-01: gravel scores nothing, and there is no tier under it to pave.
    vpUpgrade: 0, throughput: 1.0, onRough: true, label: "Dirt Road",
  },
  road: {
    key: "road", name: "Road",
    cost: BUILD_COSTS.road,
    // VP-01: the tile VP is paid per DIRT TILE PAVED, never per connection and
    // never for a Road laid on virgin ground.
    vpUpgrade: VICTORY.upgrade, throughput: 1.6, onRough: false, label: "Road",
  },
};

// Dirt→road upgrade pays only the difference (settled: yes, pave in place).
//
// W9: neither this nor TRANSPORT.road.cost can ever be paid with the free
// setup allowance. That allowance (FREE_SETUP_TRACK — it lives in `game.ts`
// with the rest of the E8 tuning surface, not here) buys DIRT ONLY; the single
// implementation of the rule is `freeAllowanceCovers` in `track.ts`, which
// `previewDrag` (the human drag) and `planCandidates`/`executeCandidate` (the
// rival) all consult. The paved Road therefore stays gated behind an ore mine
// exactly as E8/PP-07 settled it — "wood and stone for roads, no ore — the
// paved road is gated behind an ore mine" — instead of arriving free with the
// opening 12 tiles, at road throughput (×1.6) and — since VP-01 — at road VP.
export const UPGRADE_COST: Partial<Record<Cargo, number>> = BUILD_COSTS.upgrade;

/**
 * VP-01: the winning total. Dropped from 12 to 10 alongside the new point
 * economy, because the only sources left are paves (0.25★) and plants (1★).
 */
export const VP_TARGET = VICTORY.target;

// ── Player buildings ───────────────────────────────────────────────────────
/**
 * PP-12: the Factory / Processing Plant is ONE verbatim TTD factory complex
 * (`factory` file cell), drawn as a single draw item — not four per-tile
 * pieces. The MT-1/MT-2 `factory_mt_*` cells stay packed as legacy but the
 * game no longer emits them.
 */
export const FACTORY_SPRITE = "factory";

/**
 * PP-12: the Factory footprint is DERIVED from its sprite's packed width via
 * `footprintForArt` — the image dictates the tiles it occupies (currently
 * 3×3 for the 224px TTD factory). Every consumer (placement, plants, grid,
 * AI, game) reads this constant, so re-arting the factory re-flows the rules
 * with no code change. tests/unit/iso-pp12-assets.test.ts pins that this
 * equals the manifest's own footprint for the sprite.
 */
export const FACTORY_FOOTPRINT: [number, number] = footprintForArt(spriteWidth(FACTORY_SPRITE));

/**
 * PP-12: resource-specific Depot art. Each cargo has its own half-scale TTD
 * outpost (`depot_<cargo>` file cell): food plant for grain, lumber mill for
 * wood (the PP-11 example), copper mine for ore, diamond mine for stone, rig
 * for oil, iron mine for gold. The game picks by the Depot's served cargo.
 */
export function depotSpriteForCargo(cargo: Cargo): string {
  return `depot_${cargo}`;
}

/**
 * PP-12: one town variant per packed TTD house file (43). The church is the
 * town centre (`town_center` cell); the bungalows pair and the two stadiums
 * are packed as `spare_*` cells instead — far too wide for a 1x1 tile.
 */
export const TOWN_HOUSE_VARIANTS = [
  "town_offices_1423", "town_office_1460", "town_flats_trop_1x1_4", "town_flats_trop_1x1_7",
  "town_cottage_arctic_1x1_1", "town_flats_arctic_1x1_1", "town_flats_arctic_1x1_2",
  "town_fountain_1x1", "town_house_arctic_1x1_5", "town_shops_arctic_1x1_2",
  "town_small_flat_1x1_1", "town_small_flat_1x1_2", "town_small_house_1x1_1",
  "town_small_house_arctic_1x1_2", "town_townhouse_garden_2", "town_townhouse_gardens_2",
  "town_flats_trop_2x1_6", "town_flats_arctic_2x1_1", "town_flats_arctic_2x1_2",
  "town_townhouse_3", "town_townhouse_garden_3", "town_bank", "town_cinema", "town_flats",
  "town_flats_2", "town_flats_4", "town_flats_grey", "town_hotel", "town_house_pool",
  "town_shops_modern", "town_house_modern", "town_house_modern_2", "town_office_tower_modern",
  "town_shops_offices", "town_shops_offices_2", "town_cottage_old_small_a",
  "town_cottage_old_small", "town_cottage_old_small_2", "town_shop_small", "town_house_swiss",
  "town_cottage_tall", "town_offices_tall", "town_flats_townhouse_tall",
] as const;

/** The atlas cell a town tile draws.
 *  A spatial hash rather than `(x + y) % n`, which bands a settlement into
 *  diagonal stripes; deterministic, so a re-render always puts the same
 *  building on the same tile. With 43 variants a uniform pick already mixes
 *  homes, shops and the occasional tall block — no weighting needed. */
export function townHouseSprite(tx: number, ty: number): string {
  let h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return TOWN_HOUSE_VARIANTS[h % TOWN_HOUSE_VARIANTS.length];
}
