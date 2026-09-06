// ══════════════════════════════════════════════════════════════════════════
// K0 — Projection, grid and sprite constants (Kenney isometric cutover)
//
// 2:1 dimetric projection over Kenney's isometric blocks
// (docs/HexMatch-isometric-spec.md — every value below is ✓measured from the
// shipped assets):
//
//   Ground tile: a 132×64 diamond top surface (apex at top-centre, corner
//   row at y≈32) over a base-block skirt.  TILE_W = 132, TILE_H = 64.
//
//   K-FIX-1: sprite CANVASES are NOT one size. Kenney's iso tiles are designed
//   to be different heights, anchored at their shared ground line and grown
//   upward into their transparent margin (kenney.nl 3D-import docs; the PIXI
//   /Kenney tutorial names drawing-from-the-top as the cause of the classic
//   floating-tile bug). The packer therefore keeps every source PNG at native
//   size and never normalises a skirt. BLOCK_H below is the DEEPEST skirt in
//   the set — a budget for culling and chunk-surface sizing, not a promise
//   that every tile has it.
//
//   tileToScreen(tx, ty) is the CENTRE of tile (tx,ty)'s diamond — the row
//   through the left/right corners, where the sprite's widest row lands
//   (K0 anchor: drawX = screenX − HW, drawY = screenY − widestRowY).
//
//   I2/N4: ONE tile→screen convention. Drawing centres the diamond on
//   tileToScreen and screenToTile is the exact inverse used by renderer input,
//   highlights and camera culling. The old second convention (a pick cell
//   whose TOP VERTEX sat on tileToScreen, papered over by sampling HH below
//   the cursor) is gone. Math.floor gives deterministic ownership to shared
//   edges; there is no additive cursor compensation anywhere.
//
// Kenney tiles are ~2× the old OpenGFX pixels, so the map is 32×32 (was
// 48×48) — a similar world size on screen at half the draw count (K0).
// ══════════════════════════════════════════════════════════════════════════
export const TILE_W = 132, TILE_H = 64;
export const HW = TILE_W / 2, HH = TILE_H / 2;   // 66, 32
/**
 * Deepest base-block skirt in the set: px of cube side below a ground tile's
 * ground row (measured: Kenney's landscape blocks bottom out 66px below their
 * corner row). Individual tiles are SHALLOWER — water is 50 — and that is
 * fine: they share the ground line, so only the silhouette below it differs
 * (K-FIX-1). Used to size chunk cache surfaces and cull padding.
 */
export const BLOCK_H = 66;
export const MAP_W = 32, MAP_H = 32;             // 1024 tiles
export const ZOOM_STEPS = [0.5, 1, 2] as const;
export type Zoom = (typeof ZOOM_STEPS)[number];

export const tileToScreen = (tx: number, ty: number): [number, number] =>
  [(tx - ty) * HW, (tx + ty) * HH];

/**
 * Exact inverse cell decomposition for diamonds CENTRED on tileToScreen.
 * The +1 is part of assigning the centred diamond's shared boundaries before
 * flooring; it is not a screen-pixel offset or pick fudge.
 */
export const screenToTile = (sx: number, sy: number): [number, number] => {
  const a = sx / HW, b = sy / HH;
  return [Math.floor((a + b + 1) / 2), Math.floor((b - a + 1) / 2)];
};

export const tileIndex = (tx: number, ty: number) => ty * MAP_W + tx;
export const inMap = (tx: number, ty: number) =>
  tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;

// ── RNG helpers ──
// All game randomness goes through this injectable RNG so a seeded run is
// fully reproducible (deterministic map, AI timing, board fill — ticket #3).
let _rng: () => number = Math.random;
export function setRng(fn: () => number) { _rng = fn; }
export const rand = (n = 1) => _rng() * n;
export const randInt = (n: number) => Math.floor(_rng() * n);
export const choice = <T,>(arr: T[]): T => arr[randInt(arr.length)];
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ══════════════════════════════════════════════════════════════════════════
// X1 recovery — classic match-3 board and trading constants. The E11 cutover
// deleted the board-era code wholesale; the map-agnostic `board.ts` and
// `trade.ts` (plus their tests) were restored, and J1 wired them into the iso
// game: `src/iso/quarry.ts` maps the six gem colours onto the six cargoes and
// gates the harvest on the road/rail network, `src/iso/market.ts` drives the
// trading rules over the player purses.
//
// Live surface: ResKey/RES_KEYS/RES (colours + panel copy), BOARD_W/BOARD_H
// (the quarry grid), UPGRADE_EVERY (token clock), OFFER_LIFE (market expiry)
// and the RNG helpers above.
//
// NOT live, deliberately kept: the hex-era rule tables below (TileKey/TILES/
// TILE_BAG, COSTS, SABOTAGE/SECURITY, VP, REPAIR_COST, the hex geometry
// constants, the sabotage timers). Nothing references them since J2 deleted
// `hexmap.ts`/`actions.ts`/`state.ts`. They stay because sabotage is still a
// settled design decision (`src/iso/config.ts`, decision 5) and re-tabling it
// from scratch would be worse than carrying the numbers. Prune with a ticket,
// not in passing.
// ══════════════════════════════════════════════════════════════════════════
export type ResKey = "wood" | "brick" | "sheep" | "wheat" | "ore" | "gold";
export const RES_KEYS: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore", "gold"];

export const RES: Record<ResKey, {
  name: string; icon: string; c1: string; c2: string; ring: string; gem: string;
}> = {
  wood:  { name: "Wood",  icon: "🪵", c1: "#6b3410", c2: "#c47a2c", ring: "#e6ad63", gem: "#c07b34" },
  brick: { name: "Brick", icon: "🧱", c1: "#a01808", c2: "#ff5636", ring: "#f59468", gem: "#e8442a" },
  sheep: { name: "Sheep", icon: "🐑", c1: "#1f7a1c", c2: "#6fe04a", ring: "#b4ec8f", gem: "#4ecb3e" },
  wheat: { name: "Wheat", icon: "🌾", c1: "#b89400", c2: "#ffe83a", ring: "#ffec93", gem: "#f5da28" },
  ore:   { name: "Ore",   icon: "⛏️", c1: "#284a9c", c2: "#5aa8ff", ring: "#c1cfe2", gem: "#3f7fe0" },
  gold:  { name: "Gold",  icon: "🪙", c1: "#9c5a02", c2: "#ffb01f", ring: "#ffcf6e", gem: "#f5921f" },
};

export type TileKey =
  | "forest" | "hills" | "pasture" | "field" | "mountain" | "goldmine" | "desert";

export const TILES: Record<TileKey, { name: string; res: ResKey | null }> = {
  forest:   { name: "Forest",    res: "wood" },
  hills:    { name: "Hills",     res: "brick" },
  pasture:  { name: "Pasture",   res: "sheep" },
  field:    { name: "Field",     res: "wheat" },
  mountain: { name: "Mountain",  res: "ore" },
  goldmine: { name: "Gold Mine", res: "gold" },
  desert:   { name: "Desert",    res: null },
};

export const TILE_BAG: TileKey[] = [
  ...Array(6).fill("forest"),
  ...Array(5).fill("hills"),
  ...Array(6).fill("pasture"),
  ...Array(6).fill("field"),
  ...Array(4).fill("mountain"),
  ...Array(2).fill("goldmine"),
  ...Array(1).fill("desert"),
] as TileKey[];

export const COSTS: Record<string, { cost: Partial<Record<ResKey, number>>; vp: number; label: string }> = {
  road:       { cost: { wood: 1, brick: 1 }, vp: 0, label: "Rail" },
  settlement: { cost: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, vp: 1, label: "Factory" },
  city:       { cost: { wheat: 2, ore: 3 }, vp: 2, label: "Foundry" },
};

export const VP = { target: 10 };
export const REPAIR_COST: Partial<Record<ResKey, number>> = { wood: 1, brick: 1, wheat: 1, ore: 1 };

export const SABOTAGE: Record<string, {
  name: string; gold: number; target: "tile" | "player"; desc: string;
}> = {
  bandit: { name: "Blockade",     gold: 5, target: "tile",   desc: "Auto-blockades the rival's busiest industry for 45s — no one may harvest it." },
  harden: { name: "Frost Tiles",  gold: 5, target: "player", desc: "Freeze 7 gems in ice (2 matches to shatter)." },
  block:  { name: "Iron Girders", gold: 9, target: "player", desc: "Drop 2 immovable girders for 2 minutes." },
  fog:    { name: "Smog Cloud",   gold: 7, target: "player", desc: "Choke a rival's board with smog for 30s (no swaps)." },
};

export const SECURITY = { gold: 6, ms: 90000, name: "Security Forces", desc: "Hire guards for 90s — immune to Blockade & Smog Cloud." };
export const TAX_EVERY_ROUNDS = 6;

export const BOARD_W = 7, BOARD_H = 8;
export const CELL = 80;
export const UPGRADE_EVERY = 20000;
export const OFFER_LIFE = 40000;
export const HEX_SIZE = 100;
export const PLOT = 220;
export const MAP_COLS = 6;
export const MAP_ROWS = 5;
export const BANDIT_MS = 45000;
export const RAID_EVERY = 120000;
export const FOG_MS = 30000;
export const BLOCK_MS = 120000;
