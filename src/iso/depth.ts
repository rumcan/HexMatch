// ══════════════════════════════════════════════════════════════════════════
// E4 — Depth sorting and picking.
//
// Three tiers, exactly as specified:
//
//   Tier 1  sort by the footprint's MAXIMUM corner, (tx+w-1)+(ty+h-1),
//           tie-broken by (tx-ty) then by sprite height. `tx+ty` alone is
//           wrong for multi-tile footprints.
//   Tier 2  build an "is behind" DAG over ONLY the sprites whose screen
//           bounding boxes actually intersect and topologically sort that
//           subset. n stays in the low tens because the input is already
//           culled.
//   Tier 3  cyclic overlap is unfixable by ordering; fall back to the Tier-1
//           key for the members of the cycle and report it so the offending
//           sprite can be cut into `slices` at slice time.
//
// Picking is two-stage: the flat screenToTile pick belongs to the caller;
// here we do the front-to-back sprite pass with alpha masks, which overrides
// the flat pick whenever it hits.
// ══════════════════════════════════════════════════════════════════════════
import { tileToScreen } from "../game/config";
import type { Atlas, SpriteDef } from "./atlas";

/** One thing to draw: a sprite placed at a footprint origin. */
export interface DrawItem {
  sprite: string;
  tx: number;             // footprint origin
  ty: number;
  frame?: number;
  /** Opaque payload the picker returns (industry, station, …). */
  ref?: unknown;
}

/** A DrawItem resolved against the atlas: world rect + depth key. */
export interface Placed extends DrawItem {
  def: SpriteDef;
  /** World-space (1×, camera-free) draw position of the sprite's top-left. */
  wx: number;
  wy: number;
  w: number;              // frame width
  h: number;
  key: number;            // Tier-1 depth key
}

/**
 * World-space draw origin for a placement (K0/K4). The anchor pixel lands on
 * the CENTRE of the footprint's ground diamond — for a 1×1 footprint that is
 * tileToScreen(tx,ty), the row through the diamond's left/right corners.
 * The atlas packs anchors so that a sprite's base-diamond widest row (or, for
 * vehicles, its bottom-centre) lands exactly there, which is what makes every
 * building stand flush on its tile by construction.
 */
export function drawOrigin(def: SpriteDef, tx: number, ty: number): [number, number] {
  const [fw, fh] = def.footprint;
  const [cx, cy] = tileToScreen(tx + (fw - 1) / 2, ty + (fh - 1) / 2);
  return [cx - def.anchor[0], cy - def.anchor[1]];
}

export function place(atlas: Atlas, item: DrawItem): Placed | null {
  const def = atlas.get(item.sprite);
  if (!def) return null;
  const [fw, fh] = def.footprint;
  const [wx, wy] = drawOrigin(def, item.tx, item.ty);
  const w = def.w / (def.frames ?? 1);
  return {
    ...item, def, wx, wy, w, h: def.h,
    key: (item.tx + fw - 1) + (item.ty + fh - 1),
  };
}

// ── Tier 1 ────────────────────────────────────────────────────────────────
export function tier1Compare(a: Placed, b: Placed): number {
  if (a.key !== b.key) return a.key - b.key;
  const ax = a.tx - a.ty, bx = b.tx - b.ty;
  if (ax !== bx) return ax - bx;
  return a.h - b.h;
}

export const boxesIntersect = (a: Placed, b: Placed): boolean =>
  a.wx < b.wx + b.w && b.wx < a.wx + a.w &&
  a.wy < b.wy + b.h && b.wy < a.wy + a.h;

/**
 * "a is behind b" — a must be drawn first. True when a's footprint is
 * strictly further back on both diamond axes-overlap test: a is behind b if
 * its footprint ranges are not in front on either axis and it is behind on at
 * least one. Undefined (returns false both ways) for disjoint footprints.
 */
export function isBehind(a: Placed, b: Placed): boolean {
  const [aw, ah] = a.def.footprint;
  const [bw, bh] = b.def.footprint;
  const ax0 = a.tx, ax1 = a.tx + aw - 1, ay0 = a.ty, ay1 = a.ty + ah - 1;
  const bx0 = b.tx, bx1 = b.tx + bw - 1, by0 = b.ty, by1 = b.ty + bh - 1;
  // Overlap on the ty span → compare on tx; overlap on tx → compare on ty.
  const yOverlap = ay0 <= by1 && by0 <= ay1;
  const xOverlap = ax0 <= bx1 && bx0 <= ax1;
  if (yOverlap && ax1 < bx0) return true;
  if (xOverlap && ay1 < by0) return true;
  return false;
}

export interface SortResult {
  order: Placed[];
  /** Tier-3 report: sprite names caught in an unresolvable occlusion cycle. */
  cycles: string[][];
}

/**
 * Tier 1 + Tier 2 depth sort. Runs the topological pass only over connected
 * groups of screen-overlapping sprites of size ≥ 2.
 */
export function depthSort(items: Placed[]): SortResult {
  const base = [...items].sort(tier1Compare);
  const n = base.length;
  const cycles: string[][] = [];
  if (n < 2) return { order: base, cycles };

  // Adjacency over screen-overlapping pairs only (Tier 2's cost control).
  const edges: number[][] = Array.from({ length: n }, () => []);
  const indeg = new Int32Array(n);
  let anyEdge = false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!boxesIntersect(base[i], base[j])) continue;
      let a = -1, b = -1;
      if (isBehind(base[i], base[j])) { a = i; b = j; }
      else if (isBehind(base[j], base[i])) { a = j; b = i; }
      else continue;
      edges[a].push(b); indeg[b]++; anyEdge = true;
    }
  }
  if (!anyEdge) return { order: base, cycles };

  // Kahn's algorithm, seeded in Tier-1 order so the result is stable and
  // degrades gracefully to Tier 1 where the DAG is silent.
  const out: Placed[] = [];
  const ready: number[] = [];
  const done = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (indeg[i] === 0) ready.push(i);
  while (ready.length) {
    // pick the Tier-1-smallest ready node (indices are already Tier-1 sorted)
    ready.sort((p, q) => p - q);
    const i = ready.shift()!;
    done[i] = 1;
    out.push(base[i]);
    for (const j of edges[i]) if (--indeg[j] === 0) ready.push(j);
  }

  if (out.length < n) {
    // Tier 3: a cycle. Emit the survivors in Tier-1 order and report them.
    const stuck: Placed[] = [];
    for (let i = 0; i < n; i++) if (!done[i]) stuck.push(base[i]);
    cycles.push(stuck.map((p) => p.sprite));
    out.push(...stuck);
  }
  return { order: out, cycles };
}

// ── Picking (stage 2) ─────────────────────────────────────────────────────
/**
 * Front-to-back sprite pick with an alpha test. `wx`/`wy` are WORLD (1×,
 * camera-removed) coordinates of the cursor. Returns the first opaque hit.
 */
export function pickSprite(
  atlas: Atlas, order: Placed[], wx: number, wy: number,
): Placed | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const p = order[i];
    const lx = wx - p.wx, ly = wy - p.wy;
    if (lx < 0 || ly < 0 || lx >= p.w || ly >= p.h) continue;
    if (atlas.opaqueAt(p.sprite, Math.floor(lx), Math.floor(ly))) return p;
  }
  return null;
}
