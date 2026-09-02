// ── Terrain textures (imported so vite-plugin-singlefile inlines them) ──
import forest from "../assets/images/tiles/forest.jpg";
import hills from "../assets/images/tiles/hills.jpg";
import pasture from "../assets/images/tiles/pasture.jpg";
import field from "../assets/images/tiles/field.jpg";
import mountain from "../assets/images/tiles/mountain.jpg";
import goldmine from "../assets/images/tiles/goldmine.jpg";
import desert from "../assets/images/tiles/desert.jpg";
import ocean from "../assets/images/tiles/ocean.jpg";

// ── Gem sprite sheet (6 frames, 128×128 each, laid out horizontally) ──
import gemSheet from "../assets/images/tiles/gems_spritesheet.png";

export const TEX: Record<string, string> = {
  forest, hills, pasture, field, mountain, goldmine, desert, ocean,
};

// ── Resources (also the six gem colours) ──
export type ResKey = "wood" | "brick" | "sheep" | "wheat" | "ore" | "gold";

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

export const GEM_SHEET = gemSheet;
export const GEM_FRAMES = 6;

// Which frame of gems_spritesheet.png each resource uses.
// Sheet order: cow(0) tree(1) brick(2) wheat(3) stone(4) coin(5)
export const GEM_FRAME: Record<ResKey, number> = {
  sheep: 0,   // cow
  wood:  1,   // tree
  brick: 2,   // brick
  wheat: 3,   // wheat
  ore:   4,   // stone
  gold:  5,   // coin
};

export const RES_KEYS: ResKey[] = ["wood", "brick", "sheep", "wheat", "ore", "gold"];

// ── Terrain tiles ──
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

// Bag: 6 forest, 5 hills, 6 pasture, 6 field, 4 mountain, 2 goldmine, 1 desert = 30
export const TILE_BAG: TileKey[] = [
  ...Array(6).fill("forest"),
  ...Array(5).fill("hills"),
  ...Array(6).fill("pasture"),
  ...Array(6).fill("field"),
  ...Array(4).fill("mountain"),
  ...Array(2).fill("goldmine"),
  ...Array(1).fill("desert"),
] as TileKey[];

// ── Build costs ──
export const COSTS: Record<string, { cost: Partial<Record<ResKey, number>>; vp: number; label: string }> = {
  road:       { cost: { wood: 1, brick: 1 }, vp: 0, label: "Rail" },
  settlement: { cost: { wood: 1, brick: 1, sheep: 1, wheat: 1 }, vp: 1, label: "Factory" },
  city:       { cost: { wheat: 2, ore: 3 }, vp: 2, label: "Foundry" },
};

export const VP = { target: 10 };

// Pay these to clear all obstacles on your board
export const REPAIR_COST: Partial<Record<ResKey, number>> = { wood: 1, brick: 1, wheat: 1, ore: 1 };

// ── Sabotage ── (Industrial-era operations)
export const SABOTAGE: Record<string, {
  name: string; gold: number; target: "tile" | "player"; desc: string;
}> = {
  bandit: { name: "Blockade",     gold: 5, target: "tile",   desc: "Picket a district for 45s — no one adjacent may harvest it." },
  harden: { name: "Frost Tiles",  gold: 5, target: "player", desc: "Freeze 7 gems in ice (2 matches to shatter)." },
  block:  { name: "Iron Girders", gold: 9, target: "player", desc: "Drop 2 immovable girders for 2 minutes." },
  fog:    { name: "Smog Cloud",   gold: 7, target: "player", desc: "Choke a rival's board with smog for 30s (no swaps)." },
};

// ── Security (defensive) ── blocks Blockade & Smog Cloud aimed at you
export const SECURITY = {
  gold: 6, ms: 90000, name: "Security Forces",
  desc: "Hire guards for 90s — immune to Blockade & Smog Cloud.",
};

// Taxman strikes the richest player every N resource rounds (token spawns)
export const TAX_EVERY_ROUNDS = 6;

// ── Constants ──
export const BOARD_W = 9, BOARD_H = 9;
export const CELL = 54;
export const UPGRADE_EVERY = 20000;
export const OFFER_LIFE = 40000;
export const HEX_SIZE = 100;
export const PLOT = 220;        // province-map plot size (world units)
export const MAP_COLS = 6;
export const MAP_ROWS = 5;      // 6×5 = 30 plots (matches TILE_BAG)
export const BANDIT_MS = 45000;
export const RAID_EVERY = 120000; // roaming bandit raid interval
export const FOG_MS = 30000;
export const BLOCK_MS = 120000;

// ── RNG helpers ──
// All game randomness funnels through one injectable RNG so a seeded run is
// fully reproducible (deterministic grid, AI, board fill — T1 / E3).
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