// ══════════════════════════════════════════════════════════════════════════
// K0 — Projection, grid and sprite constants (Kenney isometric cutover)
//
// 2:1 dimetric projection over Kenney's isometric blocks
// (docs/HexMatch-isometric-spec.md — every value below is ✓measured from the
// shipped assets):
//
//   Canvas per ground tile: 132 × 83 px — a 132×64 diamond top surface
//   (apex at top-centre, widest row at y≈32) plus a 50px base-block skirt
//   below the widest row.  TILE_W = 132, TILE_H = 64, BLOCK_H = 50.
//
//   tileToScreen(tx, ty) is the CENTRE of tile (tx,ty)'s diamond — the row
//   through the left/right corners, where the sprite's widest row lands
//   (K0 anchor: drawX = screenX − HW, drawY = screenY − widestRowY). It is
//   also the top vertex of the tile's PICK cell: screenToTile's floor cells
//   are the diamonds whose top vertex sits on the tileToScreen lattice, so
//   a drawn diamond sits HH above its pick cell and the flat pick samples
//   HH below the cursor to compensate (K4 — renderer.flatPick).
// screenToTile uses Math.floor, never Math.round: flooring is the algebraic
// inverse cell decomposition (the tile whose diamond contains the point);
// rounding produces an off-by-one band along every diamond edge (E0).
//
// Kenney tiles are ~2× the old OpenGFX pixels, so the map is 32×32 (was
// 48×48) — a similar world size on screen at half the draw count (K0).
// ══════════════════════════════════════════════════════════════════════════
export const TILE_W = 132, TILE_H = 64;
export const HW = TILE_W / 2, HH = TILE_H / 2;   // 66, 32
/** Base-block skirt: px of cube side below a ground tile's widest row (K0). */
export const BLOCK_H = 50;
export const MAP_W = 32, MAP_H = 32;             // 1024 tiles
export const ZOOM_STEPS = [0.5, 1, 2] as const;
export type Zoom = (typeof ZOOM_STEPS)[number];

export const tileToScreen = (tx: number, ty: number): [number, number] =>
  [(tx - ty) * HW, (tx + ty) * HH];

// Flat pick: screen → grid. The tile whose diamond contains the point. Exact
// integer math at every tileToScreen lattice point; floor is deliberate (E0).
export const screenToTile = (sx: number, sy: number): [number, number] => {
  const a = sx / HW, b = sy / HH;
  return [Math.floor((a + b) / 2), Math.floor((b - a) / 2)];
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

export const BOARD_W = 9, BOARD_H = 9;
export const CELL = 54;
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
