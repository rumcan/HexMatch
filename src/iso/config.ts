// ─────────────────────────────────────────────────────────────────────────
// Isometric (E-series) configuration: projection, grid, cargo and scoring.
// 2:1 dimetric projection — a tile is exactly twice as wide as it is tall,
// which gives clean stair-stepping pixel art and cheap transform maths (E0).
// ─────────────────────────────────────────────────────────────────────────

// ── Seeded RNG (T1): every game randomness funnel goes through this so a
// seeded map/AI/board run is reproducible. Kept here so the iso module does
// not depend on the legacy hex game tree. ──
let _rng: () => number = Math.random;
export function setRng(fn: () => number) { _rng = fn; }
export const rand = (n = 1) => _rng() * n;
export const randInt = (n: number) => Math.floor(_rng() * n);
export const choice = <T,>(arr: T[]): T => arr[randInt(arr.length)];
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Map cargo onto the existing six gem frames by ResKey name (the quarry board
// is reused unchanged during the iso cutover; see E11).
type ResKey = "wood" | "brick" | "sheep" | "wheat" | "ore" | "gold";

// ── Projection / grid constants (E0) ──
export const TILE_W = 64, TILE_H = 32;
export const HW = TILE_W / 2;   // 32
export const HH = TILE_H / 2;   // 16

export const MAP_W = 48, MAP_H = 48;

export const TERRAIN = { GRASS: 0, WATER: 1, ROUGH: 2 } as const;
export type Terrain = typeof TERRAIN[keyof typeof TERRAIN];

// Discrete zoom levels (E0): integer steps only so every blit is a 1:1 copy
// from a pre-rendered atlas size — never per-frame drawImage scaling.
export const ZOOM_LEVELS = [0.5, 1, 2] as const;
export type Zoom = typeof ZOOM_LEVELS[number];

/** Grid tile → screen position of the tile's north corner (diamond origin). */
export const tileToScreen = (tx: number, ty: number): [number, number] =>
  [(tx - ty) * HW, (tx + ty) * HH];

/**
 * Screen pixel → grid tile. The algebraic inverse of tileToScreen.
 * NOTE the `Math.floor`, not round: rounding snaps to the nearest tile centre
 * and produces an off-by-one band along every diamond edge; flooring returns
 * the tile whose diamond actually contains the point (E0).
 */
export const screenToTile = (sx: number, sy: number): [number, number] => {
  const a = sx / HW, b = sy / HH;
  return [Math.floor((a + b) / 2), Math.floor((b - a) / 2)];
};

export const tileIndex = (tx: number, ty: number) => ty * MAP_W + tx;
export const inBounds = (tx: number, ty: number) =>
  tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H;

// ── Cargo types (E2) ──
// Decision recorded here: the match-3 board hard-codes SIX gem frames, so the
// seven nominal industries are mapped onto six cargoes by MERGING Iron and
// Coal into one "Ore" cargo (E2 blocking constraint). Iron and Coal mines are
// separate industries on the map but both produce Ore.
export type Cargo =
  | "grain" | "wood" | "ore" | "stone" | "oil" | "gold";
export const CARGO_KEYS: Cargo[] = ["grain", "wood", "ore", "stone", "oil", "gold"];

// Map each cargo onto an existing board gem frame (gems_spritesheet, 6 frames).
// Frame order: cow=0(sheep), tree=1(wood), brick=2, wheat=3, stone=4, coin=5.
export const CARGO_TO_RES: Record<Cargo, ResKey> = {
  grain: "wheat",
  wood: "wood",
  ore: "brick",
  stone: "ore",
  oil: "sheep",
  gold: "gold",
};

export interface CargoInfo {
  name: string;
  gemFrame: number;
}
export const CARGO: Record<Cargo, CargoInfo> = {
  grain: { name: "Grain", gemFrame: 3 },
  wood:  { name: "Wood",  gemFrame: 1 },
  ore:   { name: "Ore",   gemFrame: 2 },
  stone: { name: "Stone", gemFrame: 4 },
  oil:   { name: "Oil",   gemFrame: 0 },
  gold:  { name: "Gold",  gemFrame: 5 },
};

// ── Industries (E2) ──
export type IndustryType =
  | "farm" | "forest" | "coal_mine" | "iron_mine" | "quarry" | "oil_rig" | "gold_mine";

export interface IndustryDef {
  type: IndustryType;
  cargo: Cargo;
  w: number; h: number;       // footprint in tiles
  output: number;            // relative output (E2 table)
  rough?: boolean;           // drawn on rough terrain (mines)
}
export const INDUSTRIES: Record<IndustryType, IndustryDef> = {
  farm:      { type: "farm",      cargo: "grain", w: 2, h: 2, output: 1.0 },
  forest:    { type: "forest",    cargo: "wood",  w: 2, h: 2, output: 1.0 },
  coal_mine: { type: "coal_mine", cargo: "ore",   w: 3, h: 3, output: 0.8, rough: true },
  iron_mine: { type: "iron_mine", cargo: "ore",   w: 3, h: 3, output: 0.8, rough: true },
  quarry:    { type: "quarry",    cargo: "stone", w: 3, h: 3, output: 0.7, rough: true },
  oil_rig:   { type: "oil_rig",   cargo: "oil",   w: 2, h: 2, output: 0.4 },
  gold_mine: { type: "gold_mine", cargo: "gold",  w: 2, h: 2, output: 0.3 },
};
export const INDUSTRY_TYPES = Object.keys(INDUSTRIES) as IndustryType[];

// ── Transport: road vs rail (E2) ──
export type Transport = "road" | "rail";

export interface TransportDef {
  name: string;
  cost: Partial<Record<Cargo, number>>;   // cost per tile
  vp: number;                             // VP per completed connection
  throughput: number;                     // multiplier
  rough: boolean;                         // buildable on rough terrain
}
export const TRANSPORT: Record<Transport, TransportDef> = {
  road: { name: "Road", cost: { stone: 1 },                 vp: 1, throughput: 1.0, rough: true },
  rail: { name: "Rail", cost: { ore: 2, stone: 1 },         vp: 3, throughput: 1.6, rough: false },
};

// Starting free road budget for the guided setup (E8).
export const START_ROAD_BUDGET = 12;

// ── Quarry (match-3 board, E-loop) ──
// The quarry is the harvest mini-game: gems fall from the network's connected
// industries, and matching them mints cargo. Gems are keyed directly by Cargo
// (six colours, gold wild); the board never imports the legacy hex tree.
export const BOARD_W = 9, BOARD_H = 9;
export const CELL = 46;

// Inverse of CARGO_TO_RES: cargoes biject onto the six gem frames.
export const RES_TO_CARGO: Record<ResKey, Cargo> = (() => {
  const out = {} as Record<ResKey, Cargo>;
  (Object.keys(CARGO_TO_RES) as Cargo[]).forEach((c) => { out[CARGO_TO_RES[c]] = c; });
  return out;
})();

// Token spawn cadence: every SPROUT_EVERY ms, the connected network feeds the
// quarry (connected industries mint tiered gems; see world.accessTiers).
export const SPROUT_EVERY = 20000;

// Direction bits for the per-tile 4-bit autotile mask (E5).
export const NE = 1, SE = 2, SW = 4, NW = 8;
export const DIR: Record<number, [number, number]> = {
  [NE]: [0, -1],
  [SE]: [1, 0],
  [SW]: [0, 1],
  [NW]: [-1, 0],
};
export const OPPOSITE: Record<number, number> = { [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE };
// Bit facing tile (tx,ty) from its neighbour, keyed by the neighbour's delta.
export const BIT_TO_DELTA: Record<string, number> = {
  "0,-1": NE, "1,0": SE, "0,1": SW, "-1,0": NW,
};
