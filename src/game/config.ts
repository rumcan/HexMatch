// ══════════════════════════════════════════════════════════════════════════
// E0 — Projection, grid and sprite constants (isometric cutover)
//
// 2:1 dimetric projection. Grid → screen:
//   screen.x = (tx - ty) * TILE_W_HALF;  screen.y = (tx + ty) * TILE_H_HALF
// tileToScreen(tx, ty) is the TOP VERTEX of tile (tx,ty)'s diamond — the
// canonical iso tiling in which every tile's diamond corners sit at the top
// vertices of its diagonal neighbours:
//   top    corner = tileToScreen(tx,   ty)   (picks this tile)
//   right  corner = tileToScreen(tx+1, ty)   (SE tile's top vertex)
//   bottom corner = tileToScreen(tx+1, ty+1) (tile straight below)
//   left   corner = tileToScreen(tx,   ty+1) (SW tile's top vertex)
// screenToTile uses Math.floor, never Math.round: flooring is the algebraic
// inverse cell decomposition (the tile whose diamond contains the point);
// rounding produces an off-by-one band along every diamond edge (E0).
//
// E11: hex/three.js constants and the bundled .jpg terrain textures lived
// here and leaked into the iso bundle. They are gone.
// ══════════════════════════════════════════════════════════════════════════
export const TILE_W = 64, TILE_H = 32;
export const HW = TILE_W / 2, HH = TILE_H / 2;   // 32, 16
// T4: tripled per dimension (48 → 144) = 9× the tiles for breathing room
// between industries and towns. Counts (INDUSTRY_QUOTA, TOWN_COUNT) stay
// fixed; the extra space goes to separation, not density.
export const MAP_W = 144, MAP_H = 144;
// Fixed zoom levels only — the atlas is pre-rendered at each of these once,
// so every frame is a 1:1 blit (E0: no per-frame drawImage scaling).
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

/**
 * AUDIT 2026-09-11 — sheep/brick were showing as 🐑/🧱 in chain/combo
 * popups while the iso economy has no Sheep or Brick — its six Cargoes
 * are grain/wood/ore/stone/oil/gold (src/iso/config.ts). The board's six
 * gem colours are kept for save compatibility but their DISPLAY is now
 * aligned to the live Cargo palette via GEM_TO_CARGO (quarry.ts):
 *   wheat → grain (🌾), wood → wood (🪵), ore → ore (⛏️), gold → gold (🪙),
 *   brick → stone (🪨), sheep → oil (🛢️).
 * Chain and combo rewards (board.ts grantRandom + the 4-match ×2) are
 * therefore always Cargo the purse can spend. Any new ResKey must map
 * through GEM_TO_CARGO to an existing Cargo or the audit fails.
 */
export const RES: Record<ResKey, {
  name: string; icon: string; c1: string; c2: string; ring: string; gem: string;
}> = {
  wood:  { name: "Wood",  icon: "🪵", c1: "#6b3410", c2: "#c47a2c", ring: "#e6ad63", gem: "#c07b34" },
  brick: { name: "Stone", icon: "🪨", c1: "#7c8794", c2: "#c7d0da", ring: "#d7dde2", gem: "#9aa5b0" },
  sheep: { name: "Oil",   icon: "🛢️", c1: "#1c1e20", c2: "#4c4f52", ring: "#6e7275", gem: "#2b2d30" },
  wheat: { name: "Grain", icon: "🌾", c1: "#b89400", c2: "#ffe83a", ring: "#ffec93", gem: "#f5da28" },
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

/**
 * RETIRED by VP-01 (kept, not pruned — see the note above the ResKey table).
 * This was the HUD's win target; `src/game/ui.ts` now reads `VICTORY` from
 * `src/iso/config.ts`, which is where the engine's own `VP_TARGET` comes from
 * too. The two `target` numbers had already drifted (this said 10, the game
 * won at 12), which is exactly why one of them is now the only one. AI-02
 * keeps the value honest anyway (20) in case anything else ever reads it.
 */
export const VP = { target: 20 };
export const REPAIR_COST: Partial<Record<ResKey, number>> = { wood: 1, brick: 1, wheat: 1, ore: 1 };

/**
 * A1: `target` names WHO the action lands on, and the three board actions now
 * mean it — they used to fire into the buyer's own board. Everything here is
 * aimed at the rival; Repair Crew and Security Forces (below) are the two
 * actions you buy for yourself.
 */
export const SABOTAGE: Record<string, {
  name: string; gold: number; target: "tile" | "player"; desc: string;
}> = {
  bandit: { name: "Blockade",     gold: 5, target: "tile",   desc: "Auto-blockades the rival's busiest industry for 45s — no one may harvest it." },
  harden: { name: "Frost Tiles",  gold: 5, target: "player", desc: "Freeze 7 gems in the RIVAL's plant — its yield drops until the ice melts (45s)." },
  block:  { name: "Iron Girders", gold: 9, target: "player", desc: "Drop 4 immovable girders into the RIVAL's plant for 60s." },
  fog:    { name: "Smog Cloud",   gold: 7, target: "player", desc: "Smog the RIVAL's plant for 30s — no swaps, and half yield while it hangs." },
};

/**
 * SECURITY — PP-08: Security Forces are a DEFENSIVE action, not sabotage, so
 * they are repriced from Gold to ordinary materials (Grain = workforce,
 * Stone = basic infrastructure). Declared in the legacy ResKey table like
 * REPAIR_COST (`wheat` maps to the grain cargo, `brick` to stone); Gold is
 * reserved for Black Market sabotage and pays for nothing else.
 */
export const SECURITY = {
  cost: { wheat: 2, brick: 1 } as Partial<Record<ResKey, number>>,
  ms: 90000, name: "Security Forces", desc: "Hire guards for 90s — immune to Blockade & Smog Cloud.",
};
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
