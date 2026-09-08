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
//  4. Overlapping catchments split output proportionally among claimants.
//  5. `gold` stays the sabotage currency (SABOTAGE unchanged).
//     PP-08 tightens that to a hard rule: Gold is reserved for Black Market
//     sabotage and pays for NOTHING else. Security Forces (defensive, not
//     sabotage) were repriced to materials (game/config.ts SECURITY.cost),
//     and the market refuses gold in every exchange — bank and offers, both
//     directions (`trade.ts` blocked set, wired in iso/market.ts).
//  6. PP-07: construction prices come from ONE authoritative table
//     (`construction.ts BUILD_COSTS`) — Wood+Stone for basic infrastructure,
//     Grain for expansion, Ore for rail, Oil for paid Depots. This file keeps
//     the SCORING split (VP, throughput, terrain) only; `tileCost` in track.ts
//     reads the prices from that table at call time, so the two modules never
//     import each other at init.
// ══════════════════════════════════════════════════════════════════════════
import { TILE_W, TILE_H, MAP_W, MAP_H, HW, HH } from "../game/config";

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
// MT-2: footprints are the complete OpenTTD layouts below (3×3 through
// 4×5). Each constituent atlas cell is still one declared tile, so per-tile
// depth sorting matches the occupied multi-tile footprint.
/** Per-tile sprite data for multi-tile industries (MT-1/MT-2). */
export interface IndustryTileDef {
  dx: number;
  dy: number;
  /** OpenTTD industry-tile index `m` — the third argument of `MK(x, y, m)` in
   *  `_tile_table_*` (build_industry.h). It names the atlas cell (`<key>_t<m>`)
   *  and de-duplicates tiles that share one sprite (e.g. a field of trees). */
  m: number;
  ground: number;
  building?: number;
}

export interface IndustryDef {
  key: string;
  name: string;
  cargo: Cargo;
  footprint: [number, number];
  output: number;
  /** MT-1/MT-2: per-tile sprite layout transcribed from OpenTTD's
   *  `_tile_table_*` (variant `_0`) — each entry is one `MK(x, y, m)` with the
   *  ground sprite and optional building sprite declared for tile `m` in
   *  `industry_land.h` / `base-2011-industries.pnml`. Positions NOT listed in
   *  the table are left as open ground (the industry reserves them via
   *  `footprint`, but draws nothing there) — exactly like OpenTTD. */
  tiles?: IndustryTileDef[];
}

// ══════════════════════════════════════════════════════════════════════════
// MT-1/MT-2: every industry's tile layout is DATA, transcribed from OpenTTD's
// `src/table/build_industry.h` `_tile_table_*` (variant `_0`) and the sprite
// ids from `src/table/industry_land.h` `_industry_draw_tile_data` (the stage-3
// "complete" entry, `gfx*4+3`). Ground/buildings below are the declared
// OpenGFX ids; the atlas cells (tools/iso-atlas.cells.json) carry the same
// ids, and the slicer places each layer at its declared xrel/yrel.
// ══════════════════════════════════════════════════════════════════════════

/** `_tile_table_coal_mine_0` — 3×3 (6 tiles: headgear, conveyor, spoil mounds). */
const COAL_MINE_TILES: IndustryTileDef[] = [
  { dx: 0, dy: 0, m: 5,  ground: 2023 },                 // spoil mound
  { dx: 1, dy: 0, m: 6,  ground: 2024 },                 // spoil mound
  { dx: 2, dy: 0, m: 3,  ground: 2022, building: 2021 }, // conveyor
  { dx: 1, dy: 1, m: 0,  ground: 2022, building: 2013 }, // headgear
  { dx: 1, dy: 2, m: 2,  ground: 2022, building: 2018 }, // conveyor
  { dx: 2, dy: 2, m: 3,  ground: 2022, building: 2021 }, // conveyor
];

/** `_tile_table_farm_0` — 3×3 (9 tiles: barns, silo, pigsty, fields). */
const FARM_TILES: IndustryTileDef[] = [
  { dx: 0, dy: 0, m: 37, ground: 2114, building: 2115 }, // silo
  { dx: 1, dy: 0, m: 33, ground: 2106, building: 2108 }, // barn (first half)
  { dx: 2, dy: 0, m: 35, ground: 2110, building: 2111 }, // barn (shed)
  { dx: 0, dy: 1, m: 37, ground: 2114, building: 2115 }, // silo
  { dx: 1, dy: 1, m: 34, ground: 2107, building: 2109 }, // barn (second half)
  { dx: 2, dy: 1, m: 38, ground: 2116, building: 2117 }, // pigsty
  { dx: 0, dy: 2, m: 36, ground: 2112, building: 2113 }, // barn (garage)
  { dx: 1, dy: 2, m: 36, ground: 2112, building: 2113 }, // barn (garage)
  { dx: 2, dy: 2, m: 38, ground: 2116, building: 2117 }, // pigsty
];

/** `_tile_table_forest_0` — 4×5 clump of 18 tree tiles (all tile 16). */
const FOREST_TILES: IndustryTileDef[] = [];
for (let dy = 0; dy <= 3; dy++) {
  for (let dx = 0; dx <= 3; dx++) {
    FOREST_TILES.push({ dx, dy, m: 16, ground: 2077, building: 2075 });
  }
}
FOREST_TILES.push({ dx: 1, dy: 4, m: 16, ground: 2077, building: 2075 });
FOREST_TILES.push({ dx: 2, dy: 4, m: 16, ground: 2077, building: 2075 });

/** `_tile_table_oil_well_0` — 3×3 with 5 derricks (all tile 29, animated). */
const OIL_WELL_TILES: IndustryTileDef[] = [
  { dx: 0, dy: 0, m: 29, ground: 2173, building: 2174 },
  { dx: 1, dy: 0, m: 29, ground: 2173, building: 2174 },
  { dx: 2, dy: 0, m: 29, ground: 2173, building: 2174 },
  { dx: 0, dy: 1, m: 29, ground: 2173, building: 2174 },
  { dx: 0, dy: 2, m: 29, ground: 2173, building: 2174 },
];

/** `_tile_table_gold_mine_0` — 4×4 (16 tiles). Quarry is the grey-tinted twin.
 *
 *  Y8: sprites 2247–2262 are the FINISHED GOLD-MINE GROUND TILES themselves —
 *  the headframe, pit, works and hut are baked into the ground-tile art (each
 *  is a full 64×31 tile; the raised ones are taller: 2247 is 64×52 yrel −21,
 *  2250 is 64×43 yrel −12, both declared xrel −31 like every other ground
 *  tile). Only 2263/2264/2265 are a separate building piece (the animated
 *  shaft tower, 45×54 xrel −23 yrel −27). Treating 2247/2249/2250 as
 *  buildings over the generic coal-dirt ground 2022 stacked a second full
 *  ground tile on the first and read lopsided.
 *  Ground ids 2256/2257/2260 carry ANIM palette shimmer in OpenGFX. They
 *  remain static here until palette cycling is supported; only the shaft
 *  tower uses separate animation frames. */
const GOLD_MINE_TILES: IndustryTileDef[] = [
  { dx: 0, dy: 0, m: 72, ground: 2247 },                 // headframe (64×52, yrel −21)
  { dx: 0, dy: 1, m: 73, ground: 2248 },                 // pit
  { dx: 0, dy: 2, m: 74, ground: 2249 },                 // works
  { dx: 0, dy: 3, m: 75, ground: 2250 },                 // hut (64×43, yrel −12)
  { dx: 1, dy: 0, m: 76, ground: 2251 },
  { dx: 1, dy: 1, m: 77, ground: 2252 },
  { dx: 1, dy: 2, m: 78, ground: 2253 },
  { dx: 1, dy: 3, m: 79, ground: 2254, building: 2263 }, // shaft tower (animated)
  { dx: 2, dy: 0, m: 80, ground: 2255 },
  { dx: 2, dy: 1, m: 81, ground: 2256 },
  { dx: 2, dy: 2, m: 82, ground: 2257 },
  { dx: 2, dy: 3, m: 83, ground: 2258 },
  { dx: 3, dy: 0, m: 84, ground: 2259 },
  { dx: 3, dy: 1, m: 85, ground: 2260 },
  { dx: 3, dy: 2, m: 86, ground: 2261 },
  { dx: 3, dy: 3, m: 87, ground: 2262 },
];

export const INDUSTRIES: IndustryDef[] = [
  { key: "farm",      name: "Farm",      cargo: "grain", footprint: [3, 3], output: 1.0, tiles: FARM_TILES },
  { key: "forest",    name: "Forest",    cargo: "wood",  footprint: [4, 5], output: 1.0, tiles: FOREST_TILES },
  { key: "ore_mine",  name: "Ore Mine",  cargo: "ore",   footprint: [3, 3], output: 0.8, tiles: COAL_MINE_TILES },
  { key: "quarry",    name: "Quarry",    cargo: "stone", footprint: [4, 4], output: 0.7, tiles: GOLD_MINE_TILES },
  { key: "oil_rig",   name: "Oil Rig",   cargo: "oil",   footprint: [3, 3], output: 0.4, tiles: OIL_WELL_TILES },
  { key: "gold_mine", name: "Gold Mine", cargo: "gold",  footprint: [4, 4], output: 0.3, tiles: GOLD_MINE_TILES },
];

export const INDUSTRY_BY_KEY: Record<string, IndustryDef> = Object.fromEntries(
  INDUSTRIES.map((d) => [d.key, d]),
);

// Placement quota per industry type (E3): every cargo must be present.
export const INDUSTRY_QUOTA: Record<string, number> = {
  farm: 5, forest: 6, ore_mine: 5, quarry: 4, oil_rig: 3, gold_mine: 2,
};

// ── Road vs rail (the core scoring split) ─────────────────────────────────
export interface TransportDef {
  key: "road" | "rail";
  name: string;
  vp: number;                 // VP per completed connection, awarded once
  throughput: number;         // multiplier applied to connected harvesters
  onRough: boolean;           // buildable on rough terrain
  label: string;
}

// PP-07: the PRICES live in the one authoritative table (`construction.ts`) — the
// Catan-style resource-role rebalance. Road is now Wood + Stone (basic
// infrastructure), rail adds 4 Ore (industrial investment). VP, throughput
// and terrain rules stay here: they are the scoring split, not the price.
export const TRANSPORT: Record<"road" | "rail", TransportDef> = {
  road: {
    key: "road", name: "Road",
    vp: 1, throughput: 1.0, onRough: true, label: "Road",
  },
  rail: {
    key: "rail", name: "Rail",
    vp: 3, throughput: 1.6, onRough: false, label: "Rail",
  },
};


export const VP_TARGET = 12;

// ── Player buildings ───────────────────────────────────────────────────────
// MT-1/MT-2: the Factory is a 2×2 multi-tile building composed of four
// OpenGFX factory tiles (2146–2152). Each footprint tile draws its own
// ground sprite plus (on three of the four) a building piece at the
// declared xrel/yrel, and each tile sorts individually in the depth pass
// so roads pass in front of the front tiles and behind the back tiles.
export const FACTORY_FOOTPRINT: [number, number] = [2, 2];

/**
 * MT-2: per-tile sprite layout for the 2×2 factory, transcribed from
 * OpenTTD's `_tile_table_factory_0` (build_industry.h) and the declared
 * sprite rects in base-2011-industries.pnml.
 *
 * F3: the factory is the 2×2 sub-unit (tile indices 39–42) of the 12-tile
 * OpenTTD layout, repeated to form the full building. `_industry_draw_tile_data`
 * (industry_land.h, stage-3 "complete" entry `gfx*4+3`) assigns:
 *
 *     MK(0,0,39)  ground 2146 + building 2150   ← chimney corner
 *     MK(0,1,40)  ground 2147 + building 2151
 *     MK(1,0,41)  ground 2148 + building 2152
 *     MK(1,1,42)  ground 2149, no building      ← the empty yard
 *
 * The old mapping had building 2151 on (0,0), 2150 on (1,0), left (0,1) bare
 * and put 2152 on (1,1) — a scrambled piece-to-tile assignment that read
 * lopsided. It now matches the table exactly (only the empty yard (1,1) has
 * no building piece).
 */
export const FACTORY_TILES = [
  { dx: 0, dy: 0, m: 39, ground: 2146, building: 2150 },
  { dx: 0, dy: 1, m: 40, ground: 2147, building: 2151 },
  { dx: 1, dy: 0, m: 41, ground: 2148, building: 2152 },
  { dx: 1, dy: 1, m: 42, ground: 2149 },
] as const;

/**
 * TOWN-3/Y8: the town's house art. Every pair is a complete-stage
 * (`gfx*4+3`) row of OpenTTD's `_town_draw_tile_data` (src/table/town_land.h),
 * transcribed — ground + building, no measured pixels:
 *
 *     town_house_a  ground 1447 + building 1446   M(0x5a7, 0x5a6)
 *     town_house_b  ground 1420 + building 1460   M(SPR_CONCRETE_GROUND, 0x5b4)
 *     town_house_c  ground 1424 + building 1423   M(0x590, 0x58f)
 *     town_center   ground 1420 + building 1450   M(SPR_CONCRETE_GROUND, 0x5aa)
 *
 * (SPR_CONCRETE_GROUND = 1420, src/table/sprites.h.) The cells live in
 * `tools/iso-atlas.cells.json`; before this the town stamped sprite 2019 — a
 * coal-mine conveyor shed — on every house tile and 2180, an industries_misc
 * building, on the centre, which is why settlements read as industrial junk.
 */
export const TOWN_HOUSE_VARIANTS = ["town_house_a", "town_house_b", "town_house_c"] as const;

/** The atlas cell a town tile draws.
 *  A spatial hash rather than `(x + y) % n`, which bands a settlement into
 *  diagonal stripes; deterministic, so a re-render always puts the same
 *  building on the same tile. */
export function townHouseSprite(tx: number, ty: number): string {
  let h = ((tx * 73856093) ^ (ty * 19349663)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  // Mostly small homes; an even split let tall offices hide the houses and
  // the hotel behind them. Offices now accent a settlement, not fill it.
  const bucket = h % 8;
  return TOWN_HOUSE_VARIANTS[bucket < 5 ? 0 : bucket < 7 ? 1 : 2];
}
