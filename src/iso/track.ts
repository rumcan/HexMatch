// ══════════════════════════════════════════════════════════════════════════
// E5 — Road tiers (dirt & paved): the tile model, autotiling, drag-to-build.
//
// Two parallel Uint8Array(MAP_W*MAP_H) layers hold a 4-bit direction mask per
// tile (OpenTTD's RoadBits model). The two tiers are `dirt` (basic gravel) and
// `road` (premium paved, which also carries the map's paved public/town
// roads). Paving a Road over a Dirt Road replaces it — a tile carries at most
// ONE layer, so there is no level-crossing overlay any more.
//
// The mask is the PHYSICAL road surface: a tile sets a bit toward a neighbour
// whenever that neighbour carries track of EITHER tier, so gravel and tar are
// one continuous surface — a Dirt Road that reaches a paved tile connects to
// it (that is the dirt↔paved seam feature: `dirt_road_*` transition sprites
// draw the join, and the economy floods the merged surface). The bit still
// lives in the tile's own tier layer, and a tile only ever carries one tier.
//
// Autotiling is a 4-bit / 16-variant problem, so the sprite key is built from
// the mask rather than looked up in a table nobody maintains:
//   `${kind}_${bits.toString(2).padStart(4,'0')}` → "dirt_0011" / "road_0011"
//
// Masks are recomputed ONLY for the tile placed plus its four neighbours, and
// only the containing chunks are invalidated. The whole map is never rescanned.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { TRANSPORT, UPGRADE_COST, type Cargo } from "./config";
import { WATER, ROUGH, TOWN_OCC, type Grid } from "./grid";
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

export type TrackKind = "dirt" | "road";

/**
 * Two tiers of ROAD (the game is de-railwayed — no literal tracks remain):
 *   `dirt` = the cheap basic gravel road (player-built "Dirt Road");
 *   `road` = the premium paved road (player-built "Road", and the map's
 *            paved public/town roads — both render as tar).
 *
 * W2 — per-tile track ownership. 0 = no owner; otherwise the builder's id
 * (the game uses the player's index + 1, so the two players are 1 and 2).
 * v1 rule: a tile is owned SOLELY by its builder — there is no implicit
 * sharing, so one player's flood can never run over the other's road. A tile
 * rebuilt by a second player (e.g. paving a Road over a Dirt Road tile)
 * changes hands: the last real builder owns it.
 */
/**
 * VP-01 — `upgraded`: the per-tile UPGRADE PROVENANCE layer, sitting beside the
 * two bit layers. A tile carries `PRESENT` here when the paved Road standing on
 * it REPLACED a Dirt Road, which is the only way a road tile is worth Victory
 * Points (0.25★ each, `victory.ts`).
 *
 * The two bit layers alone cannot answer that question: paving clears the dirt
 * (`buildTile` keeps a tile single-tier), so afterwards "was this tile once
 * gravel?" is unrecorded. It has to be recorded, because a paved Road laid on
 * virgin ground is NOT worth a point — the victory rule is "improve what you
 * already built". Making it a fourth layer of the tile model rather than a
 * ledger some caller maintains is what makes it survive every build path: the
 * human drag, the rival's `executeCandidate`, the demo and a rejoined guest's
 * snapshot all go through `buildTile`/`demolishTile`, so no caller can forget
 * to update it.
 *
 * Public ground never scores: `seedTownRoads`/`seedPublicRoads` pave tiles that
 * carry no dirt, so they never gain the bit — and the scoreboard filters on the
 * tile's owner as well, so a public tile could not be claimed even if it did.
 */
export interface Track {
  /** Basic gravel roads (player-built). */
  dirt: Uint8Array;
  /** Premium paved roads — player Roads AND the map's public/town roads. */
  road: Uint8Array;
  /** 0 = unowned, else the builder's id (see above). */
  owner: Uint8Array;
  /** VP-01: `PRESENT` where the paved Road here replaced a Dirt Road. */
  upgraded: Uint8Array;
}

export const createTrack = (): Track => ({
  dirt: new Uint8Array(MAP_W * MAP_H),
  road: new Uint8Array(MAP_W * MAP_H),
  owner: new Uint8Array(MAP_W * MAP_H),
  upgraded: new Uint8Array(MAP_W * MAP_H),
});

/**
 * PP-10: stamp the towns' seed-generated ring roads into a fresh track.
 *
 * RV-03: town roads are PUBLIC RULES — they are every player's to drive on,
 * exactly like the inter-town highways (PP-13), so a Depot parked beside a
 * town's ring road is serviced and may route over the settlement's streets.
 * They are stamped with `PUBLIC_OWNER` (the same id PP-13 gives the highways),
 * so every owner-scoped flood — `playerNetwork`, `buildComponents`,
 * `isServiced`, `trackOwnedBy`, `trackOpenTo` — already treats them as shared
 * network ground without any new rule. The two kinds of map road differ only
 * in `grid.occupancy`: a town road is stamped `TOWN_OCC` (a player can never
 * build on, or pave over, the town), while a highway is free land a player may
 * extend across. Driving is shared; building on the settlement is not.
 *
 * They ride the snapshot's track bytes like any other track, so a rejoined
 * guest renders them without regenerating anything (E10).
 */
export function seedTownRoads(t: Track, grid: Grid): void {
  for (const town of grid.towns) {
    for (const [tx, ty] of town.roads) {
      buildTile(t, "road", tx, ty, PUBLIC_OWNER);
    }
  }
}

/**
 * PP-13/RV-03: the owner id the map's PUBLIC ROADS carry.
 *
 * Players are 1 and 2 (player index + 1) and a town's own furniture used to be
 * 0, so 3 is free and unambiguous. Public roads are the seed-generated
 * highways between the towns (`grid.publicRoads`) AND — since RV-03 — the seed
 * towns' own ring roads: unlike town furniture they are NOT neutral —
 * `trackOpenTo` lets every player's network run over them, which is what
 * "roads players can use" means here. (`seedTownRoads` stamps the town rings
 * with this same id; the only remaining difference is `grid.occupancy`, where
 * a town road is TOWN_OCC and a highway is not.)
 */
export const PUBLIC_OWNER = 3;

/**
 * PP-13: stamp the inter-town highways onto a fresh track.
 *
 * Call this AFTER `seedTownRoads`: a highway tile a town already paves is
 * skipped, so the settlement keeps its own ring road and the highway simply
 * meets it. Everything is built with owner `PUBLIC_OWNER` (the same id RV-03
 * gives a town's ring road), so the owner-scoped floods treat both as shared
 * network ground — and a player's own line is still distinguishable, which is
 * what keeps a public road demolish-proof (`game.ts` only tears down track
 * whose owner is the player clicking).
 *
 * Like the town roads, these ride the snapshot's track bytes to a rejoined
 * guest, so no client has to regenerate them (E10).
 */
export function seedPublicRoads(t: Track, grid: Grid): void {
  for (const [tx, ty] of grid.publicRoads ?? []) {
    if (hasTrack(t, "road", tx, ty)) continue;      // a town road already paves it
    buildTile(t, "road", tx, ty, PUBLIC_OWNER);
  }
}

export const tIdx = (tx: number, ty: number) => ty * MAP_W + tx;
export const inMapT = (tx: number, ty: number) =>
  tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;

export const layerOf = (t: Track, kind: TrackKind) => (kind === "road" ? t.road : t.dirt);

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
 * Does (tx,ty) carry track of EITHER tier? A tile carries at most one tier
 * (paving replaces gravel), but the merged test is what the union mask and
 * the merged floods need: gravel and tar are one continuous road surface, so
 * presence on either layer is presence on the road.
 */
export const mergedPresent = (t: Track, tx: number, ty: number): boolean =>
  inMapT(tx, ty)
  && ((layerOf(t, "dirt")[tIdx(tx, ty)] | layerOf(t, "road")[tIdx(tx, ty)]) & PRESENT) !== 0;

/**
 * VP-01: is the paved Road at (tx,ty) one that REPLACED a Dirt Road? That and
 * only that is worth 0.25★ to whoever owns the tile (`victory.ts`). Reads the
 * provenance layer `buildTile` stamps and `demolishTile` clears.
 */
export const isUpgradedRoad = (t: Track, tx: number, ty: number): boolean =>
  inMapT(tx, ty)
  && (t.road[tIdx(tx, ty)] & PRESENT) !== 0
  && (t.upgraded[tIdx(tx, ty)] & PRESENT) !== 0;

/**
 * Does a plan of `kind` need to build anything at (tx,ty)? A dirt plan can ride
 * a paved tile (tar carries traffic at least as well as gravel, and a dirt
 * drag over pavement is a documented no-op), so BOTH count as already there.
 * A paved plan over gravel does NOT: that tile still has to be paid for — it
 * is the in-place upgrade, `UPGRADE_COST` and the 0.25★.
 *
 * `stepCost` discounts these tiles for the rival (its own trunk is already
 * carrying what the plan wants), and `tileCost` already charges 0 for them, so
 * the AI's route cost, its purse and its money all agree on the same set.
 */
export const tileAlreadyCarries = (t: Track, kind: TrackKind, tx: number, ty: number): boolean =>
  hasTrack(t, kind, tx, ty) || (kind === "dirt" && hasTrack(t, "road", tx, ty));

/**
 * Direction bits of whatever tier (tx,ty) carries. Since a tile never holds
 * both tiers, this is the single mask of the surface there — the graph the
 * merged floods and the transition sprite selection walk on.
 */
export const mergedBitsAt = (t: Track, tx: number, ty: number): number =>
  inMapT(tx, ty)
  ? (layerOf(t, "dirt")[tIdx(tx, ty)] | layerOf(t, "road")[tIdx(tx, ty)]) & 0b1111
  : 0;

/**
 * E14: the ONE place that knows why a build is refused. `canBuildOn` is this
 * function's boolean projection, so a test hook, a debug dump and a refusal
 * toast can never disagree with the rule that actually gates the build — the
 * corridor picker in `tests/e2e/corridor-picker.ts` filters tiles through it
 * instead of re-deriving water/occupancy constants from the outside.
 *
 * Returns null when `kind` may be laid at (tx,ty) (within `network`, when one
 * is given), else the reason tag: "out-of-bounds" | "water" | "occupied" |
 * "rough" | "not-adjacent".
 */
export function buildRefusal(
  grid: Grid, kind: TrackKind, tx: number, ty: number, network?: Set<number>,
): string | null {
  if (!inMapT(tx, ty)) return "out-of-bounds";
  const i = tIdx(tx, ty);
  const terrain = grid.terrain[i];
  if (terrain === WATER) return "water";
  // Industry footprints and town tiles (TOWN_OCC) block building outright —
  // checked before the terrain kind, so a town road on rough ground reports
  // "occupied" (the permanent blocker) rather than "rough".
  if (grid.occupancy[i] >= 0 || grid.occupancy[i] === TOWN_OCC) return "occupied";
  // The premium paved Road additionally needs flat ground (TRANSPORT.onRough);
  // the basic Dirt Road builds on rough.
  if (terrain === ROUGH && !TRANSPORT[kind].onRough) return "rough";
  if (network) {
    if (network.has(i)) return null;
    let adj = false;
    for (const d of DIRS) {
      const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
      if (inMapT(nx, ny) && network.has(tIdx(nx, ny))) { adj = true; break; }
    }
    if (!adj) return "not-adjacent";
  }
  return null;
}

/**
 * Can `kind` be built on this tile? See `buildRefusal` for the rule.
 */
export function canBuildOn(
  grid: Grid, kind: TrackKind, tx: number, ty: number, network?: Set<number>,
): boolean {
  return buildRefusal(grid, kind, tx, ty, network) === null;
}

/** Who owns the track at (tx,ty)? 0 = no track owner. */
export const ownerAt = (t: Track, tx: number, ty: number): number =>
  inMapT(tx, ty) ? t.owner[tIdx(tx, ty)] : 0;

/**
 * W2: the owner-scoped presence test. A tile belongs to `owner`'s network
 * only when it carries track AND its owner layer says `owner`. 0 is the
 * "no owner" identity, so an owner-0 flood only crosses owner-0 tiles —
 * two real players (1 and 2) can never see each other's road.
 *
 * PP-13: this is the STRICT test ("whose road is this?"). For "may this
 * player's network run over the tile?" use `trackOpenTo`, which also admits
 * the map's public highways.
 */
export const trackOwnedBy = (t: Track, owner: number, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && t.owner[tIdx(tx, ty)] === owner
  && (hasTrack(t, "road", tx, ty) || hasTrack(t, "dirt", tx, ty));

/** Is (tx,ty) one of the map's public highway tiles? */
export const isPublicRoad = (t: Track, tx: number, ty: number): boolean =>
  inMapT(tx, ty) && t.owner[tIdx(tx, ty)] === PUBLIC_OWNER
  && (hasTrack(t, "road", tx, ty) || hasTrack(t, "dirt", tx, ty));

/**
 * PP-13/RV-03: may `owner`'s network run over this tile?
 *
 * A tile carries `owner`'s traffic when it holds track and either
 *   (a) `owner` built it — the W2 rule, unchanged — or
 *   (b) it is one of the map's PUBLIC roads: the seed-generated highways
 *       between the towns AND the towns' own ring roads, which belong to
 *       nobody and are everybody's to drive on. That is the whole feature:
 *       hook a Depot or a Factory onto a highway (or a town's ring road) and
 *       the rest of the shared network is yours to route over, including the
 *       stretches the rival is also using.
 *
 * Two things this deliberately does NOT do:
 *   - it never lets one player cross the OTHER player's track (W2 stands);
 *   - it never changes the owner-0 answer. 0 is the neutral identity nobody
 *     builds with (players are ≥1, public roads are PUBLIC_OWNER), so
 *     `trackOpenTo(t, 0, …)` stays exactly `trackOwnedBy(t, 0, …)`. Only a
 *     REAL owner (a player, id ≥ 1) may drive on the public roads.
 */
export const trackOpenTo = (t: Track, owner: number, tx: number, ty: number): boolean =>
  trackOwnedBy(t, owner, tx, ty) || (owner !== 0 && isPublicRoad(t, tx, ty));

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
      // PP-13: …or over the map's public highways, which are everybody's.
      if (trackOpenTo(track, owner, nx, ny)) {
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
 * when the neighbour carries ANY tier of track — the mask is the physical
 * road surface and stays mutually consistent across both tiers, which is what
 * the merged floods rely on. The bit is stored in this tile's own tier layer
 * only; a tile carrying the other tier is not PRESENT here and recomputes to
 * zero.
 */
export function recomputeMask(t: Track, kind: TrackKind, tx: number, ty: number): number {
  const layer = layerOf(t, kind);
  const i = tIdx(tx, ty);
  if ((layer[i] & PRESENT) === 0) { layer[i] = 0; return 0; }
  let bits = 0;
  for (const d of DIRS) {
    const [dx, dy] = DIR[d];
    if (mergedPresent(t, tx + dx, ty + dy)) bits |= d;
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
 * Masks are the MERGED road surface (see `recomputeMask`): laying or removing
 * a tile can change the direction bits of same-tier neighbours AND of
 * neighbours carrying the other tier (a gravel tile beside a paved tile faces
 * it). So after a change the tile is re-autotiled on both layers — but only
 * when the other tier is actually present in the 4-neighbourhood, so a build
 * on virgin ground still touches exactly 5 tiles.
 */
function autotileAroundBoth(
  t: Track, kind: TrackKind, tx: number, ty: number,
): AutotileResult {
  const r1 = autotileAround(t, kind, tx, ty);
  const other: TrackKind = kind === "road" ? "dirt" : "road";
  const otherNearby = DIRS.some((d) => hasTrack(t, other, tx + DIR[d][0], ty + DIR[d][1]));
  if (!otherNearby) return r1;
  const r2 = autotileAround(t, other, tx, ty);
  return {
    tiles: [...new Set([...r1.tiles, ...r2.tiles])],
    chunks: [...new Set([...r1.chunks, ...r2.chunks])],
  };
}
/**
 * W2: `owner` is stamped on the tile so the network flood knows whose road
 * this is. Passing 0 (the default) is a neutral placement — it does NOT
 * strip ownership, so a second build on an owned tile keeps the existing
 * owner unless the new builder is also a real owner (last real builder wins).
 *
 * PP-13, the one exception to "last real builder wins": a PUBLIC highway tile
 * keeps owner `PUBLIC_OWNER` no matter who builds on it. Both players may drag
 * a road straight over a highway — it is already paved, so `tileCost` charges
 * nothing and the route connects — and without this the drag would silently
 * re-stamp every tile it crossed into that player's private network, for free,
 * taking the shared road away from the rival and from the map. Enforcing it
 * here rather than at each call site is deliberate: `commitDrag`, the AI's
 * builder and the demo all reach a public tile, and the invariant should not
 * depend on any of them remembering. The build itself is still applied (the
 * track bit is idempotent, and the autotile result is returned as usual), so
 * a route through a highway still connects and still renders.
 *
 * The two tiers never stack on one tile: paving a `road` over a `dirt` tile
 * REPLACES the dirt (the upgraded tile is a plain paved Road — no overlay),
 * and a `dirt` drag over an already-`road` tile is a no-op (a paved road is
 * strictly better; you never downgrade it by dragging gravel across it).
 * Keeping a tile single-layer is what lets the renderer drop the old
 * road+rail "crossing" sprite entirely.
 */
export function buildTile(
  t: Track, kind: TrackKind, tx: number, ty: number, owner: number = 0,
): AutotileResult | null {
  if (!inMapT(tx, ty)) return null;
  const i = tIdx(tx, ty);
  const dirt = t.dirt, road = t.road;
  if (kind === "road" && (dirt[i] & PRESENT) !== 0) {
    // Paving over a Dirt Road: clear the gravel so the tile becomes road only.
    dirt[i] = 0;
    layerOf(t, kind)[i] |= PRESENT;
    if (owner !== 0 && t.owner[i] !== PUBLIC_OWNER) t.owner[i] = owner;
    // VP-01: this is THE upgrade event the scoreboard pays for. The gravel is
    // gone from the bit layers, so `upgraded` is what keeps "this paved tile
    // used to be a Dirt Road" true after the fact — and `victory.ts` reads
    // nothing else. Public ground never reaches here with dirt under it.
    if (t.owner[i] !== PUBLIC_OWNER) t.upgraded[i] = PRESENT;
    // Recompute around the tile (dirt lost this tile, road gained) on both
    // layers: the surrounding gravel now faces a paved tile instead.
    return autotileAroundBoth(t, "road", tx, ty);
  }
  if (kind === "dirt" && (road[i] & PRESENT) !== 0) {
    // Already a paved road here — laying dirt changes nothing (no downgrade).
    return null;
  }
  layerOf(t, kind)[i] |= PRESENT;
  if (owner !== 0 && t.owner[i] !== PUBLIC_OWNER) t.owner[i] = owner;
  return autotileAroundBoth(t, kind, tx, ty);
}

/**
 * W2: demolition never touches ownership while any track remains on the tile
 * (the other tier — possibly the rival's — is still standing). When the last
 * layer goes down the tile is unowned again.
 */
export function demolishTile(t: Track, kind: TrackKind, tx: number, ty: number): AutotileResult | null {
  if (!inMapT(tx, ty)) return null;
  const i = tIdx(tx, ty);
  layerOf(t, kind)[i] = 0;
  // VP-01: provenance dies with the pavement. Tearing up a paved tile takes
  // its 0.25★ back with it (the scoreboard diffs against this layer), so a
  // point can never be farmed by paving and re-paving the same ground.
  if (kind === "road") t.upgraded[i] = 0;
  if (!hasTrack(t, "road", tx, ty) && !hasTrack(t, "dirt", tx, ty)) t.owner[i] = 0;
  // Also re-tile the OTHER layer around the gap: a paved neighbour that was
  // facing this tile (any-tier masks) must stop now that nothing is here.
  return autotileAroundBoth(t, kind, tx, ty);
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
 * W9: what the free setup allowance (`FREE_SETUP_TRACK` in `game.ts`) may buy.
 *
 * Option (a) from the ticket — ROAD ONLY. Rail, laid new or upgraded in place
 * over a road, always pays `TRANSPORT.rail.cost` / `UPGRADE_COST`. E8's design
 * note is "wood and stone for roads, no ore — rail is gated behind an ore
 * mine", and before this the allowance ignored the gate: `previewDrag` spent it
 * on ANY tile with a non-empty cost, so the first 12 tiles of a rail drag were
 * free and the connection jumped straight to rail VP (3/tile) and rail
 * throughput (×1.6) with 0 ore in the purse.
 *
 * One rule, one place: `previewDrag` (the human drag), `planCandidates` and
 * `executeCandidate` (the AI, W3's "same cost model as the player") all ask
 * this function, so the two can never disagree about what "free" means.
 */
export const freeAllowanceCovers = (kind: TrackKind): boolean => kind === "dirt";

/**
 * Cost of applying `kind` to a single tile:
 *   - already the same kind → free (dragging over your own road never
 *     double-charges)
 *   - a `road` (paved) over an existing `dirt` tile → the upgrade difference
 *     only (UPGRADE_COST); the dirt is replaced, not kept underneath
 *   - a `dirt` over an existing `road` tile → free (a paved road is already
 *     there and is never downgraded)
 *   - otherwise the full transport cost
 */
export function tileCost(t: Track, kind: TrackKind, tx: number, ty: number): Purse {
  if (hasTrack(t, kind, tx, ty)) return {};
  if (kind === "dirt" && hasTrack(t, "road", tx, ty)) return {};  // already paved
  if (kind === "road" && hasTrack(t, "dirt", tx, ty)) return { ...UPGRADE_COST };
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
   * VP-01: how many of `tiles` are in-place DIRT-TO-PAVED upgrades — the
   * tiles that will earn 0.25★ each. The modebar previews the score the drag
   * is about to buy (`previewVp` in `victory.ts`), so the number the player
   * reads is the number the scoreboard pays.
   */
  upgrades: number;
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
 *
 * W9: the allowance only covers ROAD (`freeAllowanceCovers`). A rail drag
 * prices every tile from tile one, so with no ore in the purse it previews
 * nothing, spends no allowance, and leaves the setup budget intact for the
 * road the player still has to build.
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
  // VP-01: count of tiles this drag would PAVE over gravel (all of them are
  // `kind === "road"` tiles standing on dirt — `tileCost` returns
  // UPGRADE_COST for exactly that case, so one test drives both numbers).
  let upgrades = 0;
  // W9: rail never rides the setup allowance, so for rail there is no
  // allowance to spend and `free` in the result stays 0.
  const allowance = freeAllowanceCovers(kind) ? Math.max(0, freeTiles) : 0;
  let freeLeft = allowance;
  const growing = network ? new Set(network) : undefined;

  for (let i = 0; i < path.length; i++) {
    const [x, y] = path[i];
    if (!canBuildOn(grid, kind, x, y, growing)) { truncated = true; break; }
    const c = tileCost(t, kind, x, y);
    const paves = kind === "road" && hasTrack(t, "dirt", x, y);
    // VP-01: Free tiles are charged nothing; the allowance covers them first.
    // A tile that costs nothing (dragging over your own track) consumes no
    // allowance — free setup tiles are never wasted.
    // W9: for a paved drag `freeLeft` starts at 0, so the allowance branch is
    // dirt-only and a paved tile always reaches the affordability test below.
    if (Object.keys(c).length === 0) {
      tiles.push([x, y]);
      growing?.add(tIdx(x, y));
      continue;
    }
    if (freeLeft > 0) {
      freeLeft--;
      tiles.push([x, y]);
      // VP-01: never an upgrade — the setup allowance buys dirt only
      // (`freeAllowanceCovers`), and only a paved tile over gravel scores.
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
    if (paves) upgrades++;
    growing?.add(tIdx(x, y));
  }
  return { tiles, cost, upgrades, free: allowance - freeLeft, unaffordable, truncated };
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
 * Flood fill over direction masks, RESTRICTED to one tier: a tile moves to a
 * neighbour only when the neighbour also carries track of `kind` (it is
 * PRESENT on that layer) and BOTH set the facing bit. Because the masks now
 * cross tiers, a tile's mask can point at the other tier — the flood does
 * not follow it. This is the single-tier view (used for tier-purist tests);
 * the merged surface is what `mergedConnectedTiles` and the economy walk.
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
      // mutual: the neighbour must face back (on this tier)
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
 * Flood fill over the MERGED surface: gravel and tar are one continuous
 * road, so the flood crosses whichever tier a tile carries, exactly as the
 * economy's owner-scoped flood and the truck route do. Tiles connect only
 * when both set the facing bit.
 */
export function mergedConnectedTiles(
  t: Track, tx: number, ty: number,
): Set<number> {
  const seen = new Set<number>();
  if (!mergedPresent(t, tx, ty)) return seen;
  const stack: [number, number][] = [[tx, ty]];
  seen.add(tIdx(tx, ty));
  while (stack.length) {
    const [x, y] = stack.pop()!;
    const bits = mergedBitsAt(t, x, y);
    for (const d of DIRS) {
      if (!(bits & d)) continue;
      const nx = x + DIR[d][0], ny = y + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      if (!(mergedBitsAt(t, nx, ny) & OPPOSITE[d])) continue;   // mutual
      const ni = tIdx(nx, ny);
      if (seen.has(ni)) continue;
      seen.add(ni);
      stack.push([nx, ny]);
    }
  }
  return seen;
}

export const mergedAreConnected = (
  t: Track, ax: number, ay: number, bx: number, by: number,
): boolean => mergedConnectedTiles(t, ax, ay).has(tIdx(bx, by));

/**
 * The layer as the renderer consumes it. The PRESENT bit is deliberately kept:
 * `buildDrawList` treats any non-zero cell as "track here" and masks the low
 * nibble for the sprite name, so a lone stub (directions 0000) still draws.
 */
export const drawBits = (t: Track, kind: TrackKind): Uint8Array => layerOf(t, kind);
