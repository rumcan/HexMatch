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
//
// TOWN-4.1 (#677): the size is a per-game RUNTIME option, not a constant.
//   • `MAP_SIZES` names the sides a game may play on. Standard (144) is every
//     existing save, story chapter, scenario, the Starter Island and the
//     unit-test default; large (216) is opt-in (`?size=large`) until TOWN-4.5
//     makes it the free-play default.
//   • `MAP_W`/`MAP_H` are `let` LIVE BINDINGS. ES modules export bindings, not
//     values, so every importer reads the CURRENT size at the moment its code
//     runs — the ~330 call-time reads across the game follow the size with no
//     change. What must never read them is MODULE-SCOPE code: a typed array or
//     a derived constant computed at import freezes at whatever size was
//     current then. Allocate lazily (`mapSizedBuffer`), or re-derive in an
//     `onMapSize` callback.
//   • `setMapSize` is called ONCE per boot, by `startIsoGame`, right where the
//     map options are resolved and BEFORE generateMap / createTrack / any
//     map-sized allocation. The allocators `lockMapSize()`; resizing a locked
//     map throws in dev builds (warns in production, where the new game's own
//     buffers are all that matter), and the game's dispose `releaseMapSize()`s.
//   • Counts stay fixed on a large map, exactly the T4 rule above: the extra
//     room goes to separation (see `mapSpread` in src/iso/grid.ts).
// The names are mirrored by `MAP_SIZE_NAMES` in src/net/match-settings.ts —
// the protocol leaf may not import this module (nor this one it: the e2e
// typecheck would pull the leaf's Vite-only `import.meta.env` reads in), so
// tests/unit/town-4-1-map-size.test.ts pins the two lists together.
export const MAP_SIZES: Readonly<Record<"standard" | "large", number>> = Object.freeze({ standard: 144, large: 216 });
export let MAP_W: number = MAP_SIZES.standard, MAP_H: number = MAP_SIZES.standard;
/**
 * The largest side `setMapSize` accepts. Not a design size — a correctness
 * ceiling: a few hash folds pack a tile as `tx * 256 + ty` (ai.ts plan
 * fingerprints), which stays collision-free only while both coordinates are
 * below 256.
 */
export const MAP_SIDE_MAX = 256;
/** …and the smallest: one renderer chunk (8 tiles) a side. */
export const MAP_SIDE_MIN = 8;

let mapSizeLocked = false;
const mapSizeListeners: (() => void)[] = [];

/** Vite dev server and the vitest runner — never a production bundle, and
 *  never the room server (no `import.meta.env` there at all). */
function devBuild(): boolean {
  // Typed through a cast: this module is also compiled by the e2e config,
  // which has no Vite client types (`import.meta.env` would not type-check).
  try { return (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true; } catch { return false; }
}

const validSide = (n: number): boolean =>
  Number.isInteger(n) && n >= MAP_SIDE_MIN && n <= MAP_SIDE_MAX;

function applyMapSize(w: number, h: number): void {
  MAP_W = w; MAP_H = h;
  for (const fn of mapSizeListeners) fn();
}

/**
 * TOWN-4.1: set the map's size for the game about to boot. Same size: a
 * no-op. A different size after this size's buffers were allocated (generateMap,
 * createTrack, createRail — `lockMapSize`) is a boot-order bug: those buffers
 * would silently disagree with every index computed from now on, so it throws
 * in dev builds and warns in production.
 */
export function setMapSize(w: number, h: number = w): void {
  if (!validSide(w) || !validSide(h)) {
    throw new RangeError(`setMapSize(${w}, ${h}): a side must be an integer in ${MAP_SIDE_MIN}..${MAP_SIDE_MAX}`);
  }
  if (w === MAP_W && h === MAP_H) return;
  if (mapSizeLocked) {
    const msg = `setMapSize(${w}, ${h}) after the ${MAP_W}×${MAP_H} map was allocated — `
      + "call it once per boot, before generateMap/createTrack (TOWN-4.1)";
    if (devBuild()) throw new Error(msg);
    console.warn(msg);
  }
  applyMapSize(w, h);
}

/** TOWN-4.1: map-sized buffers now exist at the current size — called by the
 *  allocators (generateMap, createTrack, createRail). */
export function lockMapSize(): void { mapSizeLocked = true; }

let mapSizeClaim = 0;

/**
 * TOWN-4.1: a booting game takes the size (right after `setMapSize`) and hands
 * the claim back to `releaseMapSize` from its dispose. Only the LATEST claim
 * releases — two games can share one page (a test's host and guest seats), and
 * the first one's dispose must not resize the map under the one still running.
 */
export function claimMapSize(): number { return ++mapSizeClaim; }

/**
 * TOWN-4.1: the game that owned the map is gone (`startIsoGame`'s dispose):
 * unlock, and go back to the standard size every between-games reader (the
 * menus) assumes. The next boot sets its own size either way. A stale claim
 * (a newer boot has claimed since) changes nothing.
 */
export function releaseMapSize(claim?: number): void {
  if (claim !== undefined && claim !== mapSizeClaim) return;
  mapSizeLocked = false;
  if (MAP_W !== MAP_SIZES.standard || MAP_H !== MAP_SIZES.standard) {
    applyMapSize(MAP_SIZES.standard, MAP_SIZES.standard);
  }
}

/** Debug/tests: are map-sized buffers alive at the current size? */
export const isMapSizeLocked = (): boolean => mapSizeLocked;

/**
 * TOWN-4.1: re-derive a module-scope value that depends on the size (a chunk
 * grid's width, a channel's base column) whenever the size changes. Runs on
 * every change, never at registration — initialise the value from MAP_W/MAP_H
 * at its declaration as usual. Keep callbacks to plain arithmetic: they run
 * inside `setMapSize`.
 */
export function onMapSize(fn: () => void): void { mapSizeListeners.push(fn); }

/**
 * TOWN-4.1: run `fn` with the map at w×h, then put the previous size AND lock
 * state back. ONLY for synchronous, throwaway work that never outlives the
 * call — the menu scoring a save it is not playing (`save-summary.ts`). It
 * bypasses the lock on purpose: nothing a live game holds can run in between
 * (the call is synchronous), lazy caches re-derive on their next use, and the
 * scratch buffers `fn` allocates must not leave the size locked for the next
 * boot.
 */
export function withMapSize<T>(w: number, h: number, fn: () => T): T {
  if (!validSide(w) || !validSide(h)) {
    throw new RangeError(`withMapSize(${w}, ${h}): a side must be an integer in ${MAP_SIDE_MIN}..${MAP_SIDE_MAX}`);
  }
  const pw = MAP_W, ph = MAP_H, locked = mapSizeLocked;
  if (w !== pw || h !== ph) applyMapSize(w, h);
  try {
    return fn();
  } finally {
    if (MAP_W !== pw || MAP_H !== ph) applyMapSize(pw, ph);
    mapSizeLocked = locked;
  }
}

/**
 * TOWN-4.1: a module-scope scratch buffer of one cell per tile, allocated on
 * first use and re-allocated only when the map size changes — the lazy form
 * of `const X = new Uint8Array(MAP_W * MAP_H)`, which would freeze at the
 * import-time size. The getter costs one length compare per call.
 */
export function mapSizedBuffer<T extends { length: number }>(make: (cells: number) => T): () => T {
  let buf: T | null = null;
  return () => {
    const n = MAP_W * MAP_H;
    if (buf === null || buf.length !== n) buf = make(n);
    return buf;
  };
}
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
/** B1 (#246) — read the installed RNG, so a caller that swaps its own stream
 *  in (the battle engine) can put the previous one back afterwards. */
export function getRng(): () => number { return _rng; }
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
// deleted the board-era code wholesale; the map-agnostic `board.ts` (plus its
// tests) was restored, and J1 wired it into the iso game: `src/iso/quarry.ts`
// maps the six gem colours onto the six cargoes and gates the harvest on the
// road/rail network. The trading half of that recovery (`trade.ts`, then the
// `iso/market.ts` offer board over it) was retired by L11 (#226): the bank —
// `src/iso/bank.ts`, gated to the rungs a seat has unlocked — is the only
// exchange left.
//
// Live surface: ResKey/RES_KEYS/RES (colours + panel copy), BOARD_W/BOARD_H
// (the quarry grid), UPGRADE_EVERY (token clock)
// and the RNG helpers above.
//
// NOT live, deliberately kept: the hex-era rule tables below (TileKey/TILES/
// TILE_BAG, COSTS, VP, REPAIR_COST, the hex geometry constants). SABOTAGE,
// SECURITY, BANDIT_MS, PROTEST_MS and RAID_EVERY, by contrast, ARE live: the
// iso Black Market reads them directly (L9 / #224). Nothing references them since J2 deleted
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
 * won at 12), which is exactly why one of them is now the only one. It
 * keeps the value honest anyway (10) in case anything else ever reads it.
 */
export const VP = { target: 10 };
/**
 * RETIRED by L9 (#224): the Repair Crew's price. The crew existed to undo the
 * three board cards; with nothing able to dirty a plant board there is nothing
 * to repair. Kept (not pruned) on the same terms as the rest of this table —
 * see the header note — because a "clear your own obstacles" action is a
 * plausible tuning-session upgrade (#225) and the numbers were play-tested.
 */
export const REPAIR_COST: Partial<Record<ResKey, number>> = { wood: 1, brick: 1, wheat: 1, ore: 1 };

/**
 * Black Market inventory. BM-2 (#560) adds timed session sabotage to the
 * existing map cards. Security blocks new targeted attacks; it does not undo
 * obstacles already dealt. Session timing/cooldowns live in iso/black-market.
 */
export const SABOTAGE: Record<string, {
  name: string; gold: number; target: "tile" | "player"; desc: string;
}> = {
  frost: { name: "Frost / Iron Girders", gold: 24, target: "player", desc: "For 2:00, new Depot and city tuning boards start with 4 frozen gems and 2 breakable iron girders. Shared 3:00 cooldown with Red Tape." },
  redTape: { name: "Red Tape", gold: 18, target: "player", desc: "Bribe the permit office: for 1:00, new rival Depot and city tuning sessions lose 2 moves. Shared 3:00 cooldown with Frost / Iron Girders." },
  // Map cards: ×3 (owner balancing pass, 2026-09).
  bandit: { name: "Blockade",     gold: 15, target: "tile",   desc: "Auto-blockades the rival's busiest industry for 45s — every depot holding it stops ticking." },
  protest: { name: "Protest",     gold: 18, target: "tile",   desc: "Stage a protest on any public road for 2:00 — every depot whose route crosses it stops ticking, yours included." },
};

/**
 * SECURITY — PP-08: Security Forces are a DEFENSIVE action, not sabotage, so
 * they are repriced from Gold to ordinary materials (Grain = workforce,
 * Stone = basic infrastructure). Declared in the legacy ResKey table like
 * REPAIR_COST (`wheat` maps to the grain cargo, `brick` to stone); Gold is
 * reserved for Black Market sabotage and pays for nothing else.
 *
 * The guard turns Blockade and BM-2 session attacks away at purchase, and
 * protests never stop a guarded player's depots ticking.
 */
export const SECURITY = {
  cost: { wheat: 6, brick: 3 } as Partial<Record<ResKey, number>>,   // ×3 (2026-09)
  ms: 90000, name: "Security Forces", desc: "Hire guards for 90s — blocks new sabotage and ignores Protests.",
};
export const TAX_EVERY_ROUNDS = 6;

export const BOARD_W = 7, BOARD_H = 8;
export const CELL = 80;
export const UPGRADE_EVERY = 20000;
export const HEX_SIZE = 100;
export const PLOT = 220;
export const MAP_COLS = 6;
export const MAP_ROWS = 5;
export const BANDIT_MS = 45000;
/** How long a Black Market protest holds its public road: 2 minutes. */
export const PROTEST_MS = 120000;
export const RAID_EVERY = 120000;
// L9 (#224) / L10 (#225): `FOG_MS` and `BLOCK_MS` retired with the cards they
// timed (Smog Cloud and Iron Girders). The board obstacles that replaced them
// have no duration at all — `Board.seedObstacles` lays them down when a tuning
// session opens and the session's close takes them off again.
