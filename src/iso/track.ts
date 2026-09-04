// ══════════════════════════════════════════════════════════════════════════
// E5 — Road and rail: the tile model, autotiling, and drag-to-build.
//
// Two parallel Uint8Array(MAP_W*MAP_H) layers hold a 4-bit direction mask per
// tile (OpenTTD's RoadBits model). A tile with both layers non-zero is a level
// crossing and draws a third sprite.
//
// Autotiling is a 4-bit / 16-variant problem, so the sprite key is built from
// the mask rather than looked up in a table nobody maintains:
//   `road_${bits.toString(2).padStart(4,'0')}` → "road_0011"
//
// Masks are recomputed ONLY for the tile placed plus its four neighbours, and
// only the containing chunks are invalidated. The whole map is never rescanned.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { TRANSPORT, UPGRADE_COST, type Cargo } from "./config";
import { WATER, ROUGH, type Grid } from "./grid";
import { CHUNK, chunksX } from "./renderer";

// ── directions ────────────────────────────────────────────────────────────
export const NE = 1, SE = 2, SW = 4, NW = 8;
export const DIRS = [NE, SE, SW, NW] as const;
export type Dir = typeof DIRS[number];

export const DIR: Record<number, [number, number]> = {
  [NE]: [0, -1],
  [SE]: [1, 0],
  [SW]: [0, 1],
  [NW]: [-1, 0],
};

export const OPPOSITE: Record<number, number> = {
  [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE,
};

export type TrackKind = "road" | "rail";

/**
 * W2 — per-tile track ownership. 0 = no owner; otherwise the builder's id
 * (the game uses the player's index + 1, so the two players are 1 and 2).
 * v1 rule: a tile is owned SOLELY by its builder — there is no implicit
 * sharing, so one player's flood can never run over the other's road. A tile
 * rebuilt by a second player (e.g. laying rail across a road tile) changes
 * hands: the last real builder owns it.
 */
export interface Track {
  road: Uint8Array;
  rail: Uint8Array;
  /** 0 = unowned, else the builder's id (see above). */
  owner: Uint8Array;
}

export const createTrack = (): Track => ({
  road: new Uint8Array(MAP_W * MAP_H),
  rail: new Uint8Array(MAP_W * MAP_H),
  owner: new Uint8Array(MAP_W * MAP_H),
});

export const tIdx = (tx: number, ty: number) => ty * MAP_W + tx;
export const inMapT = (tx: number, ty: number) =>
  tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;

export const layerOf = (t: Track, kind: TrackKind) => (kind === "road" ? t.road : t.rail);

/** Sprite key for a mask. `road_0000` is a lone stub with no connections. */
export const spriteKey = (kind: TrackKind, bits: number) =>
  `${kind}_${(bits & 0b1111).toString(2).padStart(4, "0")}`;

// ── OpenTTD RoadBits interop (Y4 guard) ──────────────────────────────────
// This project numbers directions NE=1, SE=2, SW=4, NW=8. OpenTTD's RoadBits
// order is the reverse: NW=1, SW=2, SE=4, NE=8. The declared OpenGFX road
// piece set and OpenTTD's `GetRoadSpriteOffset` selection table are keyed by
// OpenTTD RoadBits — index them with this project's mask directly and every
// curve/corner points 90° off (the original G1-style bug resurfacing).
//
// Today the 16 road/rail masks are generated from the declared straight
// half-piece (road 1332 / rail 1012) and mirrored by *this* project's own bit
// order, so they are already self-consistent. These two helpers make the
// conversion explicit and are exhaustively unit-tested across all 16 values so
// an OpenTTD-indexed piece set can never be wired up identity-mapped by
// mistake. OTTD bit value of each direction, in OpenTTD's numbering:
//   NE = 8, SE = 4, SW = 2, NW = 1.
export const OTTD_ROADBIT: Record<number, number> = {
  [NE]: 8,  // our NE (bit 1) → OpenTTD NE = 8
  [SE]: 4,  // our SE (bit 2) → OpenTTD SE = 4
  [SW]: 2,  // our SW (bit 4) → OpenTTD SW = 2
  [NW]: 1,  // our NW (bit 8) → OpenTTD NW = 1
};
export const OTTD_BIT_TO_DIR: Record<number, number> = {
  8: NE, 4: SE, 2: SW, 1: NW,
};

/** Map this project's RoadBits mask (0..15) to OpenTTD RoadBits (NW=1 SW=2 SE=4 NE=8). */
export const toOpenttdRoadBits = (bits: number): number => {
  let out = 0;
  for (const d of DIRS) if (bits & d) out |= OTTD_ROADBIT[d];
  return out & 0b1111;
};

/** Map an OpenTTD RoadBits mask back to this project's numbering (NE=1 SE=2 SW=4 NW=8). */
export const fromOpenttdRoadBits = (ottdBits: number): number => {
  let out = 0;
  let m = ottdBits & 0b1111;
  while (m) {
    const bit = m & -m;
    out |= OTTD_BIT_TO_DIR[bit];
    m ^= bit;
  }
  return out;
};

/** A tile carrying both layers is a level crossing. */
export const isCrossing = (t: Track, tx: number, ty: number) => {
  const i = tIdx(tx, ty);
  return t.road[i] !== 0 && t.rail[i] !== 0;
};

// ── presence + legality ───────────────────────────────────────────────────
// Presence is tracked in a separate bit so a lone tile (mask 0) still counts
// as built. Bit 4 (0b10000) = "this tile has track of this kind".
export const PRESENT = 16;

export const hasTrack = (t: Track, kind: TrackKind, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && (layerOf(t, kind)[tIdx(tx, ty)] & PRESENT) !== 0;

/** Direction bits only (what the renderer draws with). */
export const bitsAt = (t: Track, kind: TrackKind, tx: number, ty: number): number =>
  inMapT(tx, ty) ? layerOf(t, kind)[tIdx(tx, ty)] & 0b1111 : 0;

/**
 * Can `kind` be built on this tile? Water never; rail additionally needs flat
 * ground (TRANSPORT.rail.onRough === false); industry footprints block both.
 */
export function canBuildOn(
  grid: Grid, kind: TrackKind, tx: number, ty: number, network?: Set<number>,
): boolean {
  if (!inMapT(tx, ty)) return false;
  const i = tIdx(tx, ty);
  const terrain = grid.terrain[i];
  if (terrain === WATER) return false;
  if (terrain === ROUGH && !TRANSPORT[kind].onRough) return false;
  if (grid.occupancy[i] >= 0) return false;
  if (network) {
    if (network.has(i)) return true;
    let adj = false;
    for (const d of DIRS) {
      const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
      if (inMapT(nx, ny) && network.has(tIdx(nx, ny))) { adj = true; break; }
    }
    if (!adj) return false;
  }
  return true;
}

/** Who owns the track at (tx,ty)? 0 = no track owner. */
export const ownerAt = (t: Track, tx: number, ty: number): number =>
  inMapT(tx, ty) ? t.owner[tIdx(tx, ty)] : 0;

/**
 * W2: the owner-scoped presence test. A tile belongs to `owner`'s network
 * only when it carries track AND its owner layer says `owner`. 0 is the
 * "no owner" identity, so an owner-0 flood only crosses owner-0 tiles —
 * two real players (1 and 2) can never see each other's road.
 */
export const trackOwnedBy = (t: Track, owner: number, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && t.owner[tIdx(tx, ty)] === owner
  && (hasTrack(t, "road", tx, ty) || hasTrack(t, "rail", tx, ty));

export function playerNetwork(
  track: Track,
  owner: number,
  factories: { ownerId: number; tx: number; ty: number }[],
  harvesters: { ownerId: number; tx: number; ty: number }[],
): Set<number> {
  const seen = new Set<number>();
  const stack: number[] = [];
  const seed = (tx: number, ty: number) => {
    if (!inMapT(tx, ty)) return;
    const i = tIdx(tx, ty);
    if (seen.has(i)) return;
    seen.add(i);
    stack.push(i);
  };
  for (const f of factories) if (f.ownerId === owner) seed(f.tx, f.ty);
  for (const h of harvesters) if (h.ownerId === owner) seed(h.tx, h.ty);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    for (const d of DIRS) {
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      const ni = tIdx(nx, ny);
      if (seen.has(ni)) continue;
      // W2: flood only over track THIS owner built — never the rival's.
      if (trackOwnedBy(track, owner, nx, ny)) {
        seen.add(ni);
        stack.push(ni);
      }
    }
  }
  return seen;
}

// ── autotiling ────────────────────────────────────────────────────────────
/**
 * Recompute one tile's direction mask from its four neighbours. A bit is set
 * only when the neighbour also carries track of the same kind — the mask is
 * always mutually consistent, which is what E6's flood fill relies on.
 */
export function recomputeMask(t: Track, kind: TrackKind, tx: number, ty: number): number {
  const layer = layerOf(t, kind);
  const i = tIdx(tx, ty);
  if ((layer[i] & PRESENT) === 0) { layer[i] = 0; return 0; }
  let bits = 0;
  for (const d of DIRS) {
    const [dx, dy] = DIR[d];
    if (hasTrack(t, kind, tx + dx, ty + dy)) bits |= d;
  }
  layer[i] = PRESENT | bits;
  return bits;
}

export interface AutotileResult {
  /** Tile indices whose mask was recomputed: the tile plus its 4 neighbours. */
  tiles: number[];
  /** Chunk indices to invalidate (1–4 for a single placement). */
  chunks: number[];
}

/**
 * Incremental autotile after a change at (tx,ty): recompute that tile and its
 * four neighbours only, and report the chunks to invalidate.
 */
export function autotileAround(t: Track, kind: TrackKind, tx: number, ty: number): AutotileResult {
  const tiles: number[] = [];
  const chunks = new Set<number>();
  const touch = (x: number, y: number) => {
    if (!inMapT(x, y)) return;
    recomputeMask(t, kind, x, y);
    tiles.push(tIdx(x, y));
    chunks.add(((y / CHUNK) | 0) * chunksX + ((x / CHUNK) | 0));
  };
  touch(tx, ty);
  for (const d of DIRS) touch(tx + DIR[d][0], ty + DIR[d][1]);
  return { tiles, chunks: [...chunks] };
}

// ── build / demolish ──────────────────────────────────────────────────────
/**
 * W2: `owner` is stamped on the tile so the network flood knows whose road
 * this is. Passing 0 (the default) is a neutral placement — it does NOT
 * strip ownership, so a second build on an owned tile keeps the existing
 * owner unless the new builder is also a real owner (last real builder wins).
 */
export function buildTile(
  t: Track, kind: TrackKind, tx: number, ty: number, owner: number = 0,
): AutotileResult | null {
  if (!inMapT(tx, ty)) return null;
  const i = tIdx(tx, ty);
  layerOf(t, kind)[i] |= PRESENT;
  if (owner !== 0) t.owner[i] = owner;
  return autotileAround(t, kind, tx, ty);
}

/**
 * W2: demolition never touches ownership while any track remains on the tile
 * (the other layer — possibly the rival's — is still standing). When the last
 * layer goes down the tile is unowned again.
 */
export function demolishTile(t: Track, kind: TrackKind, tx: number, ty: number): AutotileResult | null {
  if (!inMapT(tx, ty)) return null;
  const i = tIdx(tx, ty);
  layerOf(t, kind)[i] = 0;
  if (!hasTrack(t, "road", tx, ty) && !hasTrack(t, "rail", tx, ty)) t.owner[i] = 0;
  return autotileAround(t, kind, tx, ty);
}

// ── costs ─────────────────────────────────────────────────────────────────
export type Purse = Partial<Record<Cargo, number>>;

export const addCost = (a: Purse, b: Purse, times = 1): Purse => {
  const out: Purse = { ...a };
  for (const [k, v] of Object.entries(b) as [Cargo, number][]) {
    out[k] = (out[k] ?? 0) + v * times;
  }
  return out;
};

export const canAfford = (purse: Purse, cost: Purse): boolean =>
  (Object.entries(cost) as [Cargo, number][]).every(([k, v]) => (purse[k] ?? 0) >= v);

/**
 * Cost of applying `kind` to a single tile:
 *   - already the same kind → free (dragging over your own road never
 *     double-charges)
 *   - road → rail upgrade in place → the difference only (UPGRADE_COST)
 *   - otherwise the full transport cost
 */
export function tileCost(t: Track, kind: TrackKind, tx: number, ty: number): Purse {
  if (hasTrack(t, kind, tx, ty)) return {};
  if (kind === "rail" && hasTrack(t, "road", tx, ty)) return { ...UPGRADE_COST };
  return { ...TRANSPORT[kind].cost };
}

// ── drag-to-build ─────────────────────────────────────────────────────────
/**
 * L-shaped Manhattan path from a to b: all of one axis, then all of the other.
 * `xFirst` flips which axis leads (the modifier-key / two-finger-tap toggle).
 * No A* — that is reserved for the AI (E7), where nobody is surprised by it.
 */
export function lPath(
  ax: number, ay: number, bx: number, by: number, xFirst = true,
): [number, number][] {
  const out: [number, number][] = [];
  const stepTo = (from: number, to: number) => (to > from ? 1 : -1);
  let x = ax, y = ay;
  out.push([x, y]);
  if (xFirst) {
    while (x !== bx) { x += stepTo(x, bx); out.push([x, y]); }
    while (y !== by) { y += stepTo(y, by); out.push([x, y]); }
  } else {
    while (y !== by) { y += stepTo(y, by); out.push([x, y]); }
    while (x !== bx) { x += stepTo(x, bx); out.push([x, y]); }
  }
  return out;
}

export interface DragPreview {
  /** Tiles that will actually be built, in order. */
  tiles: [number, number][];
  /**
   * W1: what the purse will be charged — the sum of per-tile costs for the
   * tiles NOT covered by the free allowance. This is the ONLY number the
   * commit spends, so what you see is what you're charged.
   */
  cost: Purse;
  /** W1: how many of `tiles` the free allowance covers (commit debits this). */
  free: number;
  /** Tiles previewed but unaffordable — drawn red, not built. */
  unaffordable: [number, number][];
  /** True when an obstacle cut the path short. */
  truncated: boolean;
}

/**
 * Compute the drag preview. Obstacles (water, rough for rail, industry
 * footprints) truncate at the last legal tile rather than failing the drag,
 * and the preview stops charging once the purse runs out — the affordable
 * prefix is what gets built.
 *
 * W1: `freeTiles` is the caller's free-track allowance, applied INSIDE the
 * preview: the first `freeTiles` new tiles (tiles that actually cost
 * something) ride free, and `cost` counts only the rest. The commit spends
 * exactly `cost`, so preview and charge can no longer disagree — the class of
 * bug where a drag that "looked fine" charged the purse into the negative.
 */
export function previewDrag(
  grid: Grid, t: Track, kind: TrackKind, purse: Purse,
  ax: number, ay: number, bx: number, by: number, xFirst = true,
  network?: Set<number>, freeTiles = 0,
): DragPreview {
  const path = lPath(ax, ay, bx, by, xFirst);
  const tiles: [number, number][] = [];
  const unaffordable: [number, number][] = [];
  let cost: Purse = {};
  let truncated = false;
  let freeLeft = Math.max(0, freeTiles);
  const growing = network ? new Set(network) : undefined;

  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    if (!canBuildOn(grid, kind, x, y, growing)) { truncated = true; break; }
    const c = tileCost(t, kind, x, y);
    // Free tiles are charged nothing; the allowance covers them first.
    // A tile that costs nothing (dragging over your own track) consumes no
    // allowance — free setup tiles are never wasted.
    if (Object.keys(c).length === 0) {
      tiles.push([x, y]);
      growing?.add(tIdx(x, y));
      continue;
    }
    if (freeLeft > 0) {
      freeLeft--;
      tiles.push([x, y]);
      growing?.add(tIdx(x, y));
      continue;
    }
    const next = addCost(cost, c);
    if (!canAfford(purse, next)) {
      for (let j = i; j < path.length; j++) {
        const [ux, uy] = path[j];
        if (!canBuildOn(grid, kind, ux, uy, growing)) { truncated = true; break; }
        unaffordable.push([ux, uy]);
      }
      break;
    }
    cost = next;
    tiles.push([x, y]);
    growing?.add(tIdx(x, y));
  }
  return { tiles, cost, free: freeTiles > 0 ? Math.max(0, freeTiles - freeLeft) : 0, unaffordable, truncated };
}

export interface CommitResult {
  built: [number, number][];
  cost: Purse;
  chunks: number[];
}

/**
 * Commit a previewed drag, charging only for the tiles actually placed.
 * W1: the cost is the preview's cost (per-tile `tileCost` model, free
 * allowance already subtracted) — never a recomputation. Committing builds
 * exactly `preview.tiles` and nothing more.
 */
export function commitDrag(t: Track, kind: TrackKind, preview: DragPreview, owner = 0): CommitResult {
  const chunks = new Set<number>();
  for (const [x, y] of preview.tiles) {
    // W2: the builder's track-owner id is stamped on every tile laid — a
    // drag built by player 1 is player 1's network, full stop.
    const r = buildTile(t, kind, x, y, owner);
    if (r) for (const c of r.chunks) chunks.add(c);
  }
  return { built: preview.tiles, cost: preview.cost, chunks: [...chunks] };
}

// ── connectivity (the base E6 will build connection scoring on) ───────────
/**
 * Flood fill over direction masks. A tile connects to a neighbour only when
 * BOTH tiles set the facing bit — a one-sided bit is never a connection.
 */
export function connectedTiles(
  t: Track, kind: TrackKind, tx: number, ty: number,
): Set<number> {
  const seen = new Set<number>();
  if (!hasTrack(t, kind, tx, ty)) return seen;
  const stack: [number, number][] = [[tx, ty]];
  seen.add(tIdx(tx, ty));
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const bits = bitsAt(t, kind, x, y);
    for (const d of DIRS) {
      if (!(bits & d)) continue;
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      // mutual: the neighbour must face back
      if (!(bitsAt(t, kind, nx, ny) & OPPOSITE[d])) continue;
      const ni = tIdx(nx, ny);
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

export const areConnected = (
  t: Track, kind: TrackKind, ax: number, ay: number, bx: number, by: number,
): boolean => connectedTiles(t, kind, ax, ay).has(tIdx(bx, by));

/**
 * The layer as the renderer consumes it. The PRESENT bit is deliberately kept:
 * `buildDrawList` treats any non-zero cell as "track here" and masks the low
 * nibble for the sprite name, so a lone stub (directions 0000) still draws.
 */
export const drawBits = (t: Track, kind: TrackKind): Uint8Array => layerOf(t, kind);
