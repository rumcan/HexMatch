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
export const MAP_W = 48, MAP_H = 48;             // 2304 tiles
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
