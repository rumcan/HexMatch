// ─────────────────────────────────────────────────────────────────────────────
// #181 test helper (not a test file — vitest only collects `*.test.ts` files).
//
// "Find a two-stop railway on this map": one platform anchored to an INDUSTRY,
// one anchored to the seat's own PLANT, and one legal drag that connects their
// stopping tracks. That is exactly what `autoTrains` needs to give a seat a
// line and a train on its own, so the multiplayer suite can stand up a *working*
// railway without a hand-written fixture.
//
// Nothing here re-implements a rule: candidates are judged with the same
// `platformRefusal` / `resolveAnchor` / `railPreview` / `buildRail` / `railPath`
// the click, the guest intent and the rival's planner run — against a GHOST copy
// of the live rail state, so the search cannot mutate the world it searches.
// ─────────────────────────────────────────────────────────────────────────────
import {
  ANCHOR_RANGE, RAIL_VIEWS, buildRail, layPlatformTrack, octPath, placePlatform,
  platformRefusal, railPath, railPreview, resolveAnchor, stopTile,
  type RailState, type RailView,
} from "../../../src/iso/rail";
import { tIdx, type Purse, type Track } from "../../../src/iso/track";
import type { Factory } from "../../../src/iso/economy";
import type { Grid } from "../../../src/iso/grid";

export interface PlatformSite {
  tx: number;
  ty: number;
  view: RailView;
  anchorKind: "industry" | "plant";
  anchorId: number;
}

export interface RailLineFixture {
  /** Anchored to an industry — the line's source stop. */
  src: PlatformSite;
  /** Anchored to the owner's plant — the line's destination stop. */
  dst: PlatformSite;
  /** The connecting drag, as the rail tool takes it: ax, ay, bx, by. */
  drag: [number, number, number, number];
  /** The tiles that drag lays (`railPreview`'s own answer). */
  tiles: [number, number][];
}

/** A copy of the rail state the search can mutate without touching the world. */
function ghostRail(state: RailState): RailState {
  return {
    rail: {
      tile: new Uint8Array(state.rail.tile),
      owner: new Uint8Array(state.rail.owner),
      revision: state.rail.revision,
    },
    structures: state.structures.map((s) => ({
      ...s,
      anchor: s.anchor
        ? { kind: s.anchor.kind, id: s.anchor.id, tiles: s.anchor.tiles.map((t) => [...t] as [number, number]) }
        : null,
    })),
    lines: state.lines.map((l) => ({ ...l })),
    trains: [],
    seq: state.seq,
  };
}

/** Every legal (tx,ty,view) around one footprint, with its resolved anchor. */
function sitesAround(
  grid: Grid, state: RailState, plants: Factory[], ownerId: number,
  x0: number, y0: number, w: number, h: number, want: "industry" | "plant",
): PlatformSite[] {
  const out: PlatformSite[] = [];
  const pad = ANCHOR_RANGE + 2;
  for (let ty = y0 - pad; ty <= y0 + h + pad; ty++) {
    for (let tx = x0 - pad; tx <= x0 + w + pad; tx++) {
      for (const view of RAIL_VIEWS) {
        if (platformRefusal(grid, state.structures, plants, ownerId, tx, ty, view, undefined, undefined, state.rail) !== "ok") continue;
        const anchor = resolveAnchor(grid, plants, ownerId, tx, ty, view);
        if (!anchor || anchor.kind !== want) continue;
        out.push({ tx, ty, view, anchorKind: anchor.kind, anchorId: anchor.id });
      }
    }
  }
  return out;
}

/**
 * The first platform the rules accept for this seat — around an industry
 * (`want: "industry"`) or around one of its own plants (`want: "plant"`).
 */
export function findPlatformSite(o: {
  grid: Grid; state: RailState; plants: Factory[]; ownerId: number;
  want?: "industry" | "plant";
}): PlatformSite | null {
  const { grid, state, plants, ownerId, want } = o;
  if (want !== "plant") {
    for (const ind of grid.industries) {
      const hit = sitesAround(grid, state, plants, ownerId, ind.tx, ind.ty, ind.w, ind.h, "industry")
        .find((s) => s.anchorId === ind.id);
      if (hit) return hit;
    }
  }
  if (want !== "industry") {
    for (const f of plants.filter((p) => p.ownerId === ownerId)) {
      const hit = sitesAround(grid, state, plants, ownerId, f.tx, f.ty, 3, 3, "plant")
        .find((s) => s.anchorId === f.id);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * The first complete two-stop railway this map offers the seat, or null when it
 * has none (callers assert on null with their own message).
 *
 * NEAREST FIRST, and bounded: the pair list is sorted by the two stops' distance
 * and only the closest 64 pairs are tried, because a working railway is a drag
 * a player would draw — and one the purse can pay for. A map-spanning drag is
 * neither, and `railPreview` would truncate it on cost alone.
 *
 * `purse` is the dragging seat's — the drag is priced by `railPreview` with it,
 * and a drag the purse cannot finish is not the drag a player would send.
 */
export function findRailLine(o: {
  grid: Grid; track: Track; state: RailState; plants: Factory[];
  ownerId: number; purse: Purse;
}): RailLineFixture | null {
  const { grid, track, state, plants, ownerId, purse } = o;

  const srcSites: PlatformSite[] = [];
  for (const ind of grid.industries) {
    srcSites.push(...sitesAround(grid, state, plants, ownerId, ind.tx, ind.ty, ind.w, ind.h, "industry")
      .filter((s) => s.anchorId === ind.id));
  }
  const dstSites: PlatformSite[] = [];
  for (const f of plants.filter((p) => p.ownerId === ownerId)) {
    dstSites.push(...sitesAround(grid, state, plants, ownerId, f.tx, f.ty, 3, 3, "plant")
      .filter((s) => s.anchorId === f.id));
  }
  if (srcSites.length === 0 || dstSites.length === 0) return null;

  // NEAREST FIRST: a line is a drag a player would draw and pay for, so the
  // search never starts with the far corner of the map. The sort is total
  // (distance, then coordinates) so the fixture is the same on every run.
  const pairs: { src: PlatformSite; dst: PlatformSite; d: number }[] = [];
  for (const dst of dstSites) {
    for (const src of srcSites) {
      pairs.push({ src, dst, d: Math.abs(src.tx - dst.tx) + Math.abs(src.ty - dst.ty) });
    }
  }
  pairs.sort((a, b) => a.d - b.d || a.src.tx - b.src.tx || a.src.ty - b.src.ty);

  for (const { src, dst } of pairs.slice(0, 64)) {
    const fixture = tryLine(grid, track, state, plants, ownerId, purse, src, dst);
    if (fixture) return fixture;
  }
  return null;
}

/** One candidate pair, judged exactly as the click, the intent and `autoTrains` will. */
function tryLine(
  grid: Grid, track: Track, state: RailState, plants: Factory[], ownerId: number,
  purse: Purse, srcSites: PlatformSite, dstSites: PlatformSite,
): RailLineFixture | null {
  // The source platform is part of the world every candidate is judged in.
  const withSrc = ghostRail(state);
  const srcStruct = placePlatform(withSrc, "you", ownerId, srcSites.tx, srcSites.ty, srcSites.view,
    { kind: "industry", id: srcSites.anchorId, tiles: [] });
  layPlatformTrack(grid, track, withSrc, srcStruct);
  const srcStop = stopTile(srcStruct);

  // Sites were collected against the original world. The first platform can
  // occupy the second one's footprint/track or take its anchor; the host will
  // refuse that second intent. Validate it again in the sequential build world.
  if (platformRefusal(grid, withSrc.structures, plants, ownerId,
    dstSites.tx, dstSites.ty, dstSites.view, undefined, undefined, withSrc.rail) !== "ok") return null;

  const ghost = ghostRail(withSrc);
  const dstStruct = placePlatform(ghost, "you", ownerId, dstSites.tx, dstSites.ty, dstSites.view,
    { kind: "plant", id: dstSites.anchorId, tiles: [] });
  layPlatformTrack(grid, track, ghost, dstStruct);
  const dstStop = stopTile(dstStruct);

  const drag: [number, number, number, number] = [srcStop[0], srcStop[1], dstStop[0], dstStop[1]];
  const path = octPath(drag[0], drag[1], drag[2], drag[3], true);
  const pv = railPreview(grid, track, ghost, ownerId, purse, drag[0], drag[1], drag[2], drag[3], true);
  // The whole path, to the destination stop — a truncated drag (a refusal, a
  // crossing curve, or a purse that runs out) is a different railway from the
  // one this fixture promises.
  if (pv.tiles.length !== path.length) return null;
  const last = pv.tiles[pv.tiles.length - 1];
  if (last[0] !== dstStop[0] || last[1] !== dstStop[1]) return null;
  if (!buildRail(grid, track, ghost, ownerId, pv.tiles).ok) return null;
  // …and a train must be able to DRIVE it: that is `autoTrains`' own test.
  const route = railPath(ghost, ownerId, [srcStop], new Set([tIdx(dstStop[0], dstStop[1])]));
  if (!route || route.length < 2) return null;

  return {
    src: srcSites, dst: dstSites, drag,
    tiles: pv.tiles.map((t) => [...t] as [number, number]),
  };
}
