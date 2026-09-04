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
//  5. `gold` stays the sabotage currency (SABOTAGE/SECURITY unchanged).
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
// V1: the footprint is WHAT THE PLAYER SEES. Every industry is a single
// declared OpenGFX sprite whose ground tile is exactly one diamond, so every
// footprint is [1,1] — the old 2×2/3×3 reservations blocked tiles that looked
// empty (backlog V1, option a). The atlas cells carry the same numbers
// (tools/iso-atlas.cells.json) and `validate-manifest.mjs` fails a building
// whose sprite is dramatically smaller than its footprint, so the art and the
// reservation cannot drift apart again.
export interface IndustryDef {
  key: string;
  name: string;
  cargo: Cargo;
  footprint: [number, number];
  output: number;
}

export const INDUSTRIES: IndustryDef[] = [
  { key: "farm",      name: "Farm",      cargo: "grain", footprint: [1, 1], output: 1.0 },
  { key: "forest",    name: "Forest",    cargo: "wood",  footprint: [1, 1], output: 1.0 },
  { key: "ore_mine",  name: "Ore Mine",  cargo: "ore",   footprint: [1, 1], output: 0.8 },
  { key: "quarry",    name: "Quarry",    cargo: "stone", footprint: [1, 1], output: 0.7 },
  { key: "oil_rig",   name: "Oil Rig",   cargo: "oil",   footprint: [1, 1], output: 0.4 },
  { key: "gold_mine", name: "Gold Mine", cargo: "gold",  footprint: [1, 1], output: 0.3 },
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
  cost: Partial<Record<Cargo, number>>;
  vp: number;                 // VP per completed connection, awarded once
  throughput: number;         // multiplier applied to connected harvesters
  onRough: boolean;           // buildable on rough terrain
  label: string;
}

export const TRANSPORT: Record<"road" | "rail", TransportDef> = {
  road: {
    key: "road", name: "Road",
    cost: { stone: 1 },
    vp: 1, throughput: 1.0, onRough: true, label: "Road",
  },
  rail: {
    key: "rail", name: "Rail",
    cost: { ore: 4, stone: 1 },
    vp: 3, throughput: 1.6, onRough: false, label: "Rail",
  },
};

// Road→rail upgrade pays only the difference (settled: yes, upgrade in place).
export const UPGRADE_COST: Partial<Record<Cargo, number>> = { ore: 4 };

export const VP_TARGET = 12;

// ── Player buildings ───────────────────────────────────────────────────────
// V1/V2: the Factory is one declared sprite (OpenGFX 2169, a complete works
// with two chimneys) whose base covers a single diamond, so its placement
// footprint — the highlight the player sees while placing, and the tiles the
// building visibly occupies — is 1×1. The atlas cells for `factory_*` carry
// the same footprint; U2's 3×3 preview was the old multi-tile factory's.
export const FACTORY_FOOTPRINT: [number, number] = [1, 1];
