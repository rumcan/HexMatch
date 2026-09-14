// ══════════════════════════════════════════════════════════════════════════
// RAIL-02 (#176) — the railway GEOMETRY: footprints, quarter turns and ports.
//
// One module owns the shape of every rail asset, so the placement rules, the
// hover preview, the occupancy reservation and the (later) renderer all walk
// the SAME tiles. A footprint derived twice is a footprint that disagrees at
// the one moment it matters — with the player's purse already debited.
//
//   Platform   2×3, rotatable by quarter turns. Three of the six tiles are the
//              LANE (the track, included in the price) and the other three
//              are the platform STRIP. The lane's two ends are the platform's
//              rail PORTS: the directions a train enters and leaves.
//   Depot      2×2, rotatable, with ONE declared exit (`port`), which is the
//              rotation's port direction — stored on the record and checked
//              against the rotation, never re-guessed by a caller.
//
// Rotation convention. A rotation maps a local offset r times by
// (x,y) → (−y, x) — a quarter turn in the grid's own axes, where NE is −y and
// SE is +x — and then the whole tile set is NORMALISED so its minimum x and y
// are 0. That normalisation is why a 2×3 block rotates into a 3×2 block whose
// north corner is still `tx,ty`: the record's origin is the block's bounding
// box corner at EVERY rotation, for every asset.
//
// Directions rotate with the offsets (`rotateDir`): NE → SE → SW → NW → NE.
// The two are the same rotation, which is what keeps a port on the END of the
// lane after three turns — the classic off-by-one-rotation bug that puts a
// depot's exit on the side the track never reaches.
// ══════════════════════════════════════════════════════════════════════════
import { NE, SE, SW, NW, DIR, type Dir } from "../track";
import type { Grid } from "../grid";
import type { Factory } from "../economy";
import { FACTORY_FOOTPRINT } from "../config";
import {
  sameAnchor, type AnchorKind, type RailAnchor, type Rotation, type Tile,
} from "./state";

/** The platform's footprint at rot 0: 2 tiles across, 3 along the lane. */
export const PLATFORM_FOOTPRINT: readonly [number, number] = [2, 3];
/** The lane the track runs on (included in the platform price). */
export const PLATFORM_LANE_TILES = 3;
/** The platform strip beside the lane. */
export const PLATFORM_STRIP_TILES = 3;
/** The depot's footprint (2×2) at every rotation. */
export const DEPOT_FOOTPRINT: readonly [number, number] = [2, 2];
/** Two rail ports: one per end of the platform's lane. */
export const PLATFORM_PORTS = 2;

/**
 * How far a platform may sit from what it anchors to — Manhattan distance from
 * ANY footprint cell to ANY cell of the anchor's own footprint (the epic:
 * "within Manhattan distance 3 from a footprint cell to an anchor footprint
 * cell"). Measured tile-to-tile, not origin-to-origin, so a long platform
 * beside a long plant is not punished for the corner it starts at.
 */
export const PLATFORM_ANCHOR_RANGE = 3;

/** The direction cycle a quarter turn walks: NE → SE → SW → NW → NE. */
const DIR_CYCLE: Dir[] = [NE, SE, SW, NW];

export const rotateDir = (dir: Dir, rot: Rotation): Dir =>
  DIR_CYCLE[(DIR_CYCLE.indexOf(dir) + rot) % 4];

/**
 * A local offset under `rot` quarter turns, before normalisation.
 *
 * `-0` is normalised to `0`: a turn produces it constantly (`-y` of a zero),
 * and a tile key built from a coordinate would otherwise spell the same tile
 * two ways. Cheap here, invisible everywhere else.
 */
export function rotateOffset(dx: number, dy: number, rot: Rotation): [number, number] {
  let x = dx, y = dy;
  for (let i = 0; i < rot; i++) {
    const nx = -y, ny = x;
    x = nx; y = ny;
  }
  return [x === 0 ? 0 : x, y === 0 ? 0 : y];
}

/**
 * The normalisation shift a rotation needs: the minimum x and y of the rotated
 * PLATFORM block. Every part of the platform — lane, strip and ports — is
 * measured against THIS box, not against its own. Getting that wrong is
 * subtle and fatal: the two ports are diagonal corners, so normalising them
 * alone puts them at x=0 while the block's own box starts at x=1, and the
 * platform's track leaves from a tile the platform does not own.
 */
function platformFrame(rot: Rotation): { minX: number; minY: number } {
  const rotated = LOCAL_PLATFORM.map(([x, y]) => rotateOffset(x, y, rot));
  return {
    minX: Math.min(...rotated.map(([x]) => x)),
    minY: Math.min(...rotated.map(([, y]) => y)),
  };
}

/** A platform-relative local set, rotated into world tiles at (tx,ty). */
function platformWorld(local: readonly Tile[], tx: number, ty: number, rot: Rotation): Tile[] {
  const { minX, minY } = platformFrame(rot);
  return local.map(([x, y]) => {
    const [rx, ry] = rotateOffset(x, y, rot);
    return [tx + rx - minX, ty + ry - minY] as Tile;
  });
}

/**
 * Rotate a local tile set and normalise it to its OWN origin. Used by the
 * square depot block, whose box is rotation-invariant; the platform's parts go
 * through `platformWorld` so they all share the block's frame.
 */
export function rotateTiles(tiles: readonly Tile[], rot: Rotation): Tile[] {
  const rotated = tiles.map(([x, y]) => rotateOffset(x, y, rot));
  const minX = Math.min(...rotated.map(([x]) => x));
  const minY = Math.min(...rotated.map(([, y]) => y));
  return rotated.map(([x, y]) => [x - minX, y - minY] as Tile);
}

/** Place a rotated local set at (tx,ty) — the only origin translation there is. */
export function placeTiles(local: readonly Tile[], tx: number, ty: number): Tile[] {
  return local.map(([x, y]) => [tx + x, ty + y] as Tile);
}

// ── the platform ──────────────────────────────────────────────────────────
// Local (rot 0) layout, x = across, y = along the lane:
//
//   ports say the lane runs toward NE (north) and SW (south)
//        x=0        x=1
//   y=0  LANE ◀port NE                                     ← the NE port
//   y=1  LANE   strip
//   y=2  LANE ◀port SW                                     ← the SW port
//
// The lane is the x=0 column; the strip is the x=1 column beside it. Under a
// quarter turn the lane becomes a row and the strip follows it — both are
// built from the same rotation, so they can never swap places.
const LOCAL_LANE: Tile[] = [[0, 0], [0, 1], [0, 2]];
const LOCAL_STRIP: Tile[] = [[1, 0], [1, 1], [1, 2]];
const LOCAL_PLATFORM: Tile[] = [...LOCAL_LANE, ...LOCAL_STRIP];
/** The two lane ends, with the direction the track leaves in. */
const LOCAL_PORTS: { tile: Tile; dir: Dir }[] = [
  { tile: [0, 0], dir: NE },
  { tile: [0, 2], dir: SW },
];

/** The whole 2×3 (or 3×2) block, as absolute tiles. */
export const platformTiles = (tx: number, ty: number, rot: Rotation): Tile[] =>
  platformWorld(LOCAL_PLATFORM, tx, ty, rot);

/** The three tiles that carry the platform's track. */
export const platformLaneTiles = (tx: number, ty: number, rot: Rotation): Tile[] =>
  platformWorld(LOCAL_LANE, tx, ty, rot);

/** The three tiles of the platform strip. */
export const platformStripTiles = (tx: number, ty: number, rot: Rotation): Tile[] =>
  platformWorld(LOCAL_STRIP, tx, ty, rot);

/**
 * The platform's two rail ports: the lane's end tiles plus the outward
 * direction the track must leave in to reach them. A train enters over one and
 * leaves over the other, which is what makes the platform a stop rather than a
 * siding.
 */
export function platformPorts(
  tx: number, ty: number, rot: Rotation,
): { tile: Tile; dir: Dir }[] {
  const tiles = platformWorld(LOCAL_PORTS.map((p) => p.tile), tx, ty, rot);
  return LOCAL_PORTS.map((p, i) => ({ tile: tiles[i], dir: rotateDir(p.dir, rot) }));
}

/**
 * The tiles just OUTSIDE a platform's ports — where track has to be for the
 * platform to be on the network. The most useful read for the placement
 * preview ("can this platform reach anything?") and for #178's route search,
 * so it lives here rather than in either of them.
 */
export function platformPortNeighbours(
  tx: number, ty: number, rot: Rotation,
): { tile: Tile; dir: Dir }[] {
  return platformPorts(tx, ty, rot).map(({ tile, dir }) => {
    const [dx, dy] = DIR[dir];
    return { tile: [tile[0] + dx, tile[1] + dy] as Tile, dir };
  });
}

// ── the depot ─────────────────────────────────────────────────────────────
const LOCAL_DEPOT: Tile[] = [[0, 0], [1, 0], [0, 1], [1, 1]];

/** The depot's 2×2 block. A square footprint is rotation-invariant. */
export const depotTiles = (tx: number, ty: number, rot: Rotation): Tile[] =>
  placeTiles(rotateTiles(LOCAL_DEPOT, rot), tx, ty);

/**
 * A depot's declared exit direction: NE at rot 0, turning with the block. The
 * record STORES this (`RailDepot.port`) and validation compares the two, so a
 * snapshot that carries a port on the wrong side of its depot is caught rather
 * than silently giving a train nowhere to leave.
 */
export const depotPortDir = (rot: Rotation): Dir => rotateDir(NE, rot);

/** The block tiles on the port edge — the depot's own track stub. */
export const depotPortTiles = (tx: number, ty: number, rot: Rotation): Tile[] => {
  const dir = depotPortDir(rot);
  const [dx, dy] = DIR[dir];
  // The edge that faces `dir` is the two tiles whose outward neighbour in that
  // direction leaves the block.
  const all = depotTiles(tx, ty, rot);
  const inside = new Set(all.map(([x, y]) => `${x},${y}`));
  return all.filter(([x, y]) => !inside.has(`${x + dx},${y + dy}`));
};

/** The tiles just outside the depot's port — where its trains join the network. */
export function depotPortNeighbours(tx: number, ty: number, rot: Rotation): Tile[] {
  const dir = depotPortDir(rot);
  const [dx, dy] = DIR[dir];
  return depotPortTiles(tx, ty, rot).map(([x, y]) => [x + dx, y + dy] as Tile);
}

// ── distance + anchors ────────────────────────────────────────────────────
export const manhattan = (a: Tile, b: Tile): number =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Smallest Manhattan distance between any cell of two tile sets. */
export function minManhattan(a: readonly Tile[], b: readonly Tile[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, manhattan(p, q));
  return best;
}

/** Every tile an industry stands on. */
export const industryTiles = (ind: { tx: number; ty: number; w: number; h: number }): Tile[] => {
  const out: Tile[] = [];
  for (let y = 0; y < ind.h; y++) for (let x = 0; x < ind.w; x++) out.push([ind.tx + x, ind.ty + y]);
  return out;
};

/** Every tile a processing plant stands on. */
export const plantTiles = (f: { tx: number; ty: number }): Tile[] => {
  const [w, h] = FACTORY_FOOTPRINT;
  const out: Tile[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([f.tx + x, f.ty + y]);
  return out;
};

/**
 * Every anchor a platform footprint could legally choose: a map industry, or
 * a plant THIS owner built, within `PLATFORM_ANCHOR_RANGE` of the footprint.
 *
 * The list is sorted (industries by id, then the owner's plants by id) so the
 * "if more than one qualifies, the player chooses" rule has a deterministic
 * order for the UI to present and for a test to assert — an anchor list that
 * reordered itself per frame would make the choice arbitrary.
 */
export function platformAnchorCandidates(
  grid: Pick<Grid, "industries">,
  factories: readonly Factory[],
  ownerId: number,
  tiles: readonly Tile[],
  range: number = PLATFORM_ANCHOR_RANGE,
): RailAnchor[] {
  const out: RailAnchor[] = [];
  for (const ind of grid.industries) {
    if (minManhattan(tiles, industryTiles(ind)) <= range) {
      out.push({ kind: "industry", id: ind.id });
    }
  }
  for (const f of factories) {
    // Anchoring to a processing plant is ownership-scoped: a rival's plant is
    // not a harbour for your platforms.
    if (f.ownerId !== ownerId) continue;
    if (minManhattan(tiles, plantTiles(f)) <= range) {
      out.push({ kind: "plant", id: f.id ?? 0 });
    }
  }
  return out.sort((a, b) =>
    a.kind === b.kind ? a.id - b.id : (a.kind === "industry" ? -1 : 1));
}

/** Readable name for an anchor, for a toast or the (later) railway panel. */
export function anchorLabel(anchor: RailAnchor, industryName?: string): string {
  if (anchor.kind === "industry") return industryName ?? `industry #${anchor.id}`;
  return anchor.id === 0 ? "your Factory" : `your plant #${anchor.id}`;
}

/** Is `anchor` one of `candidates`? */
export const anchorIn = (anchor: RailAnchor, candidates: readonly RailAnchor[]): boolean =>
  candidates.some((c) => sameAnchor(c, anchor));

/** The kinds an anchor can be, for the UI's two icon slots. */
export const ANCHOR_KINDS: AnchorKind[] = ["industry", "plant"];
