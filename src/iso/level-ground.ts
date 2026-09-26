// ══════════════════════════════════════════════════════════════════════════
// #456 — LEVEL GROUND: terraform tiles so you can build on hills.
//
// The owner's problem: "I need an elevation tool to level ground so you can
// build there, else you can't build a lot of the time." A Depot lot, a plant
// or a Factory needs `footprintFlat` ground (E4, slopes.ts), and the seeded
// island is a dome of one-level steps — flat 2×2 and 3×3 sites are the scarce
// resource. This module is the RULE of the tool; `game.ts` wires the drag,
// the charge and the renderer, and every one of those paths runs THIS plan.
//
// THE MEASURE stays E1's: the per-tile LEVEL byte (`Grid.height`, 0–4). A
// level move is one byte on one tile — the unit the price, the legality rules
// and the mesh rebuild all count.
//
// THE RULE, in one pass over the selection:
//
//   1. TARGET — the height of the tile the gesture started on (`tiles[0]`,
//      or an explicit `target` for the Shift/Alt one-level nudge). Every
//      levelable tile of the patch goes to exactly that height.
//   2. REFUSED TILES — water (sea and river), anything standing on the tile
//      (buildings, depots, factories, rail, bridges — `Grid.builtAt` says),
//      and tiles whose road would go too steep on the new slope
//      (`roadStepRefusal`'s own threshold, checked against the PLANNED
//      heights). A refused tile keeps its height and is painted red; the
//      rest of the patch still levels (the road drag's own "blocked" rule).
//   3. EDGE RAMPS — the ring of tiles just outside the patch moves AT MOST
//      ONE level toward the target wherever the new edge would otherwise
//      step two ("adds one-level ramps around its edge"). A step of three
//      or more is a cliff the one-level ramp cannot bridge: the patch tile
//      beside it refuses with the reason (cliff / water / …). A ramp move
//      whose own neighbourhood cannot absorb it (its outside neighbours
//      would then step two) is dropped and its patch neighbours refuse —
//      the ramp is a courtesy at the edge, never a second levelling.
//   4. LEGALITY — after the plan, every neighbour step involving a changed
//      tile is at most ONE level, in all EIGHT directions. Eight, not four:
//      that is the generator's own invariant (makeElevation relaxes over
//      eight neighbours) and the one the corner lattice draws its no-fold
//      claim from (elevation.ts: "corner heights inside one tile differ by
//      at most one level"). Levelling never makes a map LESS regular than
//      the generator left it.
//
// MONEY — "charged in money ($), per tile per level moved": `levels` is the
// total tile-levels moved (patch tiles AND ramp tiles, each × |Δ|), and
// `money = levels × BUILD_COSTS_MONEY.levelGround`. The owner's requested
// seam for BUILD-1 (#460) is `levelCost(grid, tiles) → { money, levels } |
// refusal`, exported below — pure, no game state, one optional `track` so
// the road rule can see the road layer.
//
// EVERYTHING HERE IS PURE (no mutation except `applyLevelPlan`/`applyHeightEdits`
// writing `Grid.height` bytes — the same contract `track.ts`'s `buildTile`
// has on its layers). No renderer, no DOM, no RNG.
// ══════════════════════════════════════════════════════════════════════════
import { BUILD_COSTS_MONEY } from "./config";
import { MAX_LEVEL } from "./elevation";
import { WATER, heightAt, setHeightTiles, type Grid } from "./grid";
import { hasTrack, type Track } from "./track";

/** A tile pair, as everywhere in the iso rules. */
export type TilePair = readonly [number, number];

/**
 * Why one tile (or a whole selection) refuses, in one vocabulary. The words
 * are the ticket's own: water, structures, rail, bridges, roads whose slope
 * would go illegal, and the cliff face an edge ramp cannot bridge.
 */
export type LevelRefusal =
  | "water" | "structure" | "rail" | "bridge" | "road" | "cliff";

/** The one wording, so the toast, the hint and a test can never disagree. */
export const LEVEL_REFUSAL_TEXT: Record<LevelRefusal, string> = {
  water: "Can't level water.",
  structure: "A building stands there.",
  rail: "Rail runs there.",
  bridge: "That's a bridge.",
  road: "That road would go too steep.",
  cliff: "The edge can't ramp there — a cliff or a drop too steep.",
};

/** What one level on one tile costs, and the money table row derived from it. */
export const LEVEL_GROUND_PRICE: number = BUILD_COSTS_MONEY.levelGround;

/** One height write: `Grid.height[y * w + x] = to`. */
export type LevelChange = [number, number, number];

/** The planned result — what the preview draws and the commit applies. */
export interface LevelPlan {
  /** The height every levelled tile takes. */
  target: number;
  /** Every height write, selection tiles first (start tile leading), ramps after. */
  changes: LevelChange[];
  /** Total tile-levels moved (Σ|Δ|, ramps included) — the price's unit count. */
  levels: number;
  /** `levels × LEVEL_GROUND_PRICE` — exactly what the commit charges. */
  money: number;
  /** Selection tiles that refuse (painted red, never written): [x, y, why]. */
  refused: [number, number, LevelRefusal][];
}

/** `levelCost`'s answer — the BUILD-1 seam (issue comment, 2026-09-26). */
export type LevelCostOk = { money: number; levels: number };
export type LevelCostResult = LevelCostOk | { refusal: LevelRefusal };

const inMap = (grid: Grid, tx: number, ty: number): boolean =>
  tx >= 0 && ty >= 0 && tx < grid.w && ty < grid.h;

const key = (x: number, y: number): number => y * 1000 + x;

/** Sea and river are both water for levelling (rivers pin their height at 0). */
export const isLevelWater = (grid: Grid, tx: number, ty: number): boolean =>
  !inMap(grid, tx, ty)
  || grid.terrain[ty * grid.w + tx] === WATER
  || (grid.rivers ? grid.rivers[ty * grid.w + tx] !== 0 : false);

/** Does the road layer carry track here (either tier)? */
const trackAt = (track: Track | undefined, x: number, y: number): boolean =>
  !!track && (hasTrack(track, "road", x, y) || hasTrack(track, "dirt", x, y));

/**
 * What stands on the tile, as a LEVEL refusal — built from `Grid.builtAt`
 * (the game's live answer: dam, bridge, platform, rail, depot, plant) when
 * the grid has one, and from the seed-derived layers (industry occupancy,
 * town houses and centres) when it does not, so a bare test grid refuses
 * the same tiles a live game does.
 */
function structureRefusal(grid: Grid, tx: number, ty: number): LevelRefusal | null {
  const built = grid.builtAt?.(tx, ty) ?? null;
  if (built) {
    if (built === "bridge") return "bridge";
    if (built === "rail" || built === "rail-x" || built === "rail-y" || built === "platform") return "rail";
    return "structure";   // dam | depot | plant
  }
  // No live `builtAt` (a test fixture, or the AI's temporary stub): fall back
  // to what the MAP itself records — an industry lot, a town house, a town
  // centre. Empty town lots stay land ("Towns keep empty lots as land").
  const i = ty * grid.w + tx;
  if (grid.occupancy && grid.occupancy[i] >= 0) return "structure";
  for (const t of grid.towns) {
    if (t.tx === tx && t.ty === ty) return "structure";
    if (t.houses.some(([hx, hy]) => hx === tx && hy === ty)) return "structure";
  }
  return null;
}

/**
 * The refusal for a tile being left ALONE (obstacle side of a step): the
 * reason a patch tile beside it cannot ramp.
 */
function obstacleRefusal(grid: Grid, track: Track | undefined, tx: number, ty: number): LevelRefusal {
  const built = structureRefusal(grid, tx, ty);
  if (built) return built;
  if (isLevelWater(grid, tx, ty)) return trackAt(track, tx, ty) ? "bridge" : "water";
  return "cliff";
}

/** Eight-neighbour steps — the generator's own neighbourhood. */
const N8: readonly (readonly [number, number])[] = [
  [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];

/**
 * The drag's tile list: the START tile first (it carries the target height),
 * then the rectangle row-major without it. `levelCost` derives its target
 * from `tiles[0]`, so the order is part of the contract.
 */
export function rectTiles(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by), y1 = Math.max(ay, by);
  const out: [number, number][] = [[ax, ay]];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (x === ax && y === ay) continue;
      out.push([x, y]);
    }
  }
  return out;
}

export interface PlanLevelOptions {
  /** The road layer, for the "road stays legal on its new slope" rule. */
  track?: Track;
}

/**
 * THE PLAN. Pure: reads `Grid.height`, writes nothing (see `applyLevelPlan`).
 *
 * `target` overrides the start tile's height — that is the Shift/Alt
 * raise/lower-one-level mode (`target = heightAt(tile) ± 1`), checked by the
 * caller against `[0, MAX_LEVEL]` and refused here when out of range.
 *
 * Per-tile refusals never stop the rest of the patch: a 5×5 drag with one
 * building in the middle levels the other 24 and paints the building red.
 */
export function planLevel(
  grid: Grid,
  tiles: readonly TilePair[],
  opts: PlanLevelOptions = {},
  target?: number,
): LevelPlan {
  const track = opts.track;
  const empty = (t: number): LevelPlan => ({ target: t, changes: [], levels: 0, money: 0, refused: [] });
  if (!tiles.length) return empty(target ?? 0);
  const [sx, sy] = tiles[0];
  const H = target ?? heightAt(grid, sx, sy);
  if (!Number.isInteger(H) || H < 0 || H > MAX_LEVEL) {
    // A raise above the top level (or a fall below the sea) — refuse the
    // selection with the cliff reason; the tool's hint pre-checks and says
    // "already at the top/bottom level" before the plan runs.
    return { ...empty(H), refused: tiles.map(([x, y]) => [x, y, "cliff" as const]) };
  }
  if (!grid.height) {
    // Option-off map: every height reads 0 and there is no byte to write.
    // A no-op is honest; a real change is impossible — refuse the selection.
    return H === 0 && tiles.every(([x, y]) => heightAt(grid, x, y) === 0)
      ? empty(0)
      : { ...empty(0), refused: tiles.map(([x, y]) => [x, y, "cliff" as const]) };
  }

  // ── 1. the selection: unique, in order, start tile first ────────────────
  const seen = new Set<number>();
  const patch: [number, number][] = [];
  for (const [x, y] of tiles) {
    if (!inMap(grid, x, y)) continue;
    const k = key(x, y);
    if (seen.has(k)) continue;
    seen.add(k);
    patch.push([x, y]);
  }

  // ── 2. hard refusals — never levelled, treated as fixed ground after ────
  const refused: [number, number, LevelRefusal][] = [];
  const refuseSet = new Set<number>();
  for (const [x, y] of patch) {
    const why: LevelRefusal | null = structureRefusal(grid, x, y)
      ?? (isLevelWater(grid, x, y) ? (trackAt(track, x, y) ? "bridge" : "water") : null);
    if (why) {
      refuseSet.add(key(x, y));
      refused.push([x, y, why]);
    }
  }
  const accepted = patch.filter(([x, y]) => !refuseSet.has(key(x, y)));

  // The planned heights: the patch at H, plus one-level edge ramps.
  const planned = new Map<number, number>();
  for (const [x, y] of accepted) planned.set(key(x, y), H);
  const hNow = (x: number, y: number): number =>
    planned.get(key(x, y)) ?? heightAt(grid, x, y);

  // ── 3. edge ramps — one ring of one-level moves, never more ─────────────
  const refuseAdjacent = (x: number, y: number, why: LevelRefusal) => {
    const k = key(x, y);
    if (refuseSet.has(k)) return;
    refuseSet.add(k);
    refused.push([x, y, why]);
    planned.delete(k);
  };
  // A patch tile whose edge cannot be brought within one level refuses with
  // the pair's own reason: a road–road pair says "road" ("That road would go
  // too steep"), anything else takes the obstacle's word (water / structure /
  // rail / bridge / cliff).
  const pairRefusal = (x: number, y: number, nx: number, ny: number): LevelRefusal =>
    trackAt(track, x, y) && trackAt(track, nx, ny) ? "road" : obstacleRefusal(grid, track, nx, ny);
  const ramps = new Map<number, number>();   // key → wanted height
  for (const [x, y] of accepted) {
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(grid, nx, ny)) continue;
      const nk = key(nx, ny);
      if (planned.has(nk) || refuseSet.has(nk)) continue;   // patch or refused: fixed at H / untouched
      const hn = heightAt(grid, nx, ny);
      const d = H - hn;
      if (Math.abs(d) <= 1) continue;
      const obs = obstacleRefusal(grid, track, nx, ny);
      if (Math.abs(d) === 2 && obs === "cliff") {
        // Free ground two out: pull it in one level — the one-level ramp.
        ramps.set(nk, hn + Math.sign(d));
        continue;
      }
      // Fixed ground (water/structure/rail/bridge) two out, or a cliff of
      // three or more: the one-level ramp cannot bridge it.
      refuseAdjacent(x, y, pairRefusal(x, y, nx, ny));
      break;
    }
  }
  // A ramp move is kept only when its OWN neighbourhood absorbs it (every
  // neighbour stays within one level of the moved tile). Drop-and-recheck
  // until stable: dropping one can free (or doom) another.
  for (const [nk, want] of ramps) planned.set(nk, want);
  for (let pass = 0; pass < ramps.size + 2 && ramps.size; pass++) {
    let dropped = false;
    for (const [nk, want] of [...ramps]) {
      const nx = nk % 1000, ny = Math.floor(nk / 1000);
      let ok = true;
      for (const [dx, dy] of N8) {
        const mx = nx + dx, my = ny + dy;
        if (!inMap(grid, mx, my)) continue;
        if (Math.abs(want - hNow(mx, my)) >= 2) { ok = false; break; }
      }
      if (ok) continue;
      planned.delete(nk);
      ramps.delete(nk);
      dropped = true;
    }
    if (!dropped) break;
  }

  // ── 4. final legality — every step involving a changed tile ≤ 1 ─────────
  // Any pair still broken (a refused obstacle beside the patch, a dropped
  // ramp) refuses the patch tiles beside it. The ROAD rule reads the same
  // pairs with `roadStepRefusal`'s threshold: a tile under road whose road
  // step would go illegal refuses with "road".
  for (const [x, y] of accepted) {
    if (refuseSet.has(key(x, y))) continue;
    for (const [dx, dy] of N8) {
      const nx = x + dx, ny = y + dy;
      if (!inMap(grid, nx, ny)) continue;
      if (Math.abs(hNow(x, y) - hNow(nx, ny)) <= 1) continue;
      refuseAdjacent(x, y, pairRefusal(x, y, nx, ny));
      break;
    }
  }

  // ── the changes and the bill ────────────────────────────────────────────
  const changes: LevelChange[] = [];
  let levels = 0;
  for (const [x, y] of patch) {
    const k = key(x, y);
    if (refuseSet.has(k)) continue;
    const to = hNow(x, y);
    const from = heightAt(grid, x, y);
    if (to === from) continue;
    changes.push([x, y, to]);
    levels += Math.abs(to - from);
  }
  for (const [nk, want] of [...ramps].sort((a, b) => a[0] - b[0])) {
    const x = nk % 1000, y = Math.floor(nk / 1000);
    const from = heightAt(grid, x, y);
    if (want === from) continue;
    changes.push([x, y, want]);
    levels += Math.abs(want - from);
  }
  return { target: H, changes, levels, money: levels * LEVEL_GROUND_PRICE, refused };
}

/**
 * BUILD-1 (#460)'s pure seam: `levelCost(grid, tiles) → { money, levels } |
 * refusal`. The whole selection must be levelable (a building footprint that
 * cannot be fully levelled is not a footprint worth pricing), so any refused
 * tile returns its reason instead of a price. `track` is optional — pass it
 * so the road rule can see the road layer.
 */
export function levelCost(
  grid: Grid,
  tiles: readonly TilePair[],
  opts: PlanLevelOptions = {},
): LevelCostResult {
  const plan = planLevel(grid, tiles, opts);
  if (plan.refused.length) return { refusal: plan.refused[0][2] };
  return { money: plan.money, levels: plan.levels };
}

/**
 * Apply a plan to the height bytes (`grid.ts`'s `setHeightTiles` seam).
 * Returns the tiles whose byte moved, in plan order — the exact list every
 * cache (terrain-GL mesh, road/rail geometry, decals) must be invalidated
 * for. Idempotent for an empty plan.
 */
export function applyLevelPlan(grid: Grid, plan: LevelPlan): [number, number][] {
  return setHeightTiles(grid, plan.changes);
}

// ── save / snapshot: the changed heights, and only those ──────────────────
/**
 * The edited heights as the wire wants them: flat `[x, y, level]` triples,
 * one per tile that differs from `baseline` (the seed-derived map, copied at
 * boot). Sparse by construction — a save or a publish pays for the levelling
 * the player actually did, not for the 20,736 bytes under it.
 */
export function heightDiffWire(height: Uint8Array, baseline: Uint8Array, w: number, h: number): number[] {
  const out: number[] = [];
  const n = Math.min(height.length, baseline.length, w * h);
  for (let i = 0; i < n; i++) {
    if (height[i] === baseline[i]) continue;
    out.push(i % w, Math.floor(i / w), height[i]);
  }
  return out;
}

/**
 * Write a wire diff back onto the grid (which must already hold the
 * seed-derived bytes — the loader applies this onto a fresh `generateMap`).
 * Returns the tiles written. Tolerant: a malformed triple is skipped by
 * `setHeightTiles`, and a level outside `0..MAX_LEVEL` is skipped here —
 * a wire payload can never grow a half-legal height.
 */
export function applyHeightEdits(grid: Grid, edits: readonly number[]): [number, number][] {
  const changes: LevelChange[] = [];
  for (let i = 0; i + 2 < edits.length; i += 3) {
    const lv = edits[i + 2];
    if (!Number.isInteger(lv) || lv < 0 || lv > MAX_LEVEL) continue;
    changes.push([edits[i], edits[i + 1], lv]);
  }
  return setHeightTiles(grid, changes);
}
