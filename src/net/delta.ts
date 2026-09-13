// ══════════════════════════════════════════════════════════════════════════
// MP-04 — per-action track deltas.
//
// §1.3 rules out shipping the four track layers on a timer (108 KiB vs the
// 16 KiB frame cap), but a game only changes a handful of tiles per action —
// a road segment, a depot, a plant. So steady state is deltas: the host reads
// current values at the journalled indices (`dirtyTiles`, drained here) and
// the guest applies them onto its local `Track` in place.
//
//   - `harvesters` / `factories` / `players` are small lists: sent whole in
//     every delta. Only the four track layers need diffing.
//   - beyond `MAX_DELTA_TILES` the publish decision flips to a full snapshot
//     — cheaper than a huge delta and simpler than chunking.
//   - the serialized delta is guarded against `FRAME_CAP_BYTES`, always.
//
// This module takes the journal as a PARAMETER (`DirtyTiles`) rather than
// importing the singleton: production passes the process-wide `dirtyTiles`,
// tests pass fresh instances. No global-state coupling here.
//
// NOTE for MP-05 — the snapshot gap: a full `SnapshotMsg` is ~110 KiB of
// base64, which EXCEEDS the guaranteed 16 KiB frame (§1.3's table buries
// this: "join and resync only" still has to cross the wire). The ≤16 KiB
// bound is what the gateway guarantees; anything larger may or may not pass
// depending on gateway config, so guest join/resync MUST chunk the snapshot
// (or otherwise fragment it) rather than sending it whole. `net-delta.test.ts`
// pins the size fact; the chunk protocol is MP-05's job alongside guest mode.
// ══════════════════════════════════════════════════════════════════════════
import type { DirtyTiles, Track } from "../iso/track";
import type { Snapshot } from "../iso/snapshot";
import { FRAME_CAP_BYTES, type DeltaMsg, type DeltaPlayer } from "./protocol";

/**
 * A delta carrying more tiles than this flips the publish decision to a full
 * snapshot (§5). 200 tiles × ~50 chars still serializes far under the frame
 * cap — the cap is about burst cheaper-as-snapshot, not about fitting.
 */
export const MAX_DELTA_TILES = 200;

/** One changed tile: its index plus the current value of all four layers. */
export interface TileChange {
  i: number;
  dirt: number;
  road: number;
  owner: number;
  upgraded: number;
}

/**
 * Full-scan diff — the CORRECTNESS ORACLE, not the hot loop. Compares every
 * tile of all four layers; a tile is included when ANY layer differs. Tests
 * prove the journal path against this; production never calls it per tick.
 */
export function diffTrack(prev: Track, next: Track): TileChange[] {
  const out: TileChange[] = [];
  const n = prev.dirt.length;
  for (let i = 0; i < n; i++) {
    if (
      prev.dirt[i] !== next.dirt[i] ||
      prev.road[i] !== next.road[i] ||
      prev.owner[i] !== next.owner[i] ||
      prev.upgraded[i] !== next.upgraded[i]
    ) {
      out.push({
        i,
        dirt: next.dirt[i],
        road: next.road[i],
        owner: next.owner[i],
        upgraded: next.upgraded[i],
      });
    }
  }
  return out;
}

/**
 * Read current values at `indices` — the hot path over a drained dirty set.
 * Out-of-range indices are skipped: the wire must never carry what the guest
 * cannot apply. (Internal producers only journal valid `tIdx` values, proven
 * by the oracle test — this is defense in depth, not a live branch.)
 */
export function readTiles(track: Track, indices: Iterable<number>): TileChange[] {
  const out: TileChange[] = [];
  const n = track.dirt.length;
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= n) continue;
    out.push({
      i,
      dirt: track.dirt[i],
      road: track.road[i],
      owner: track.owner[i],
      upgraded: track.upgraded[i],
    });
  }
  return out;
}

/**
 * Apply changed tiles onto a local `Track` in place (guest side). Values are
 * authoritative-complete — masks included — so no autotile recompute runs,
 * and the writes bypass `buildTile`, so the guest's journal stays empty.
 *
 * Tolerant reader: a missing/invalid tile list is a no-op, malformed entries
 * and out-of-range indices are skipped, and invalid byte values keep the
 * current value. A corrupt delta must never throw mid-apply and half-applying
 * is worse than skipping — the seq-gap resync (MP-05) heals true divergence.
 */
export function applyTrackDelta(track: Track, tiles: DeltaMsg["tiles"]): void {
  if (!Array.isArray(tiles)) return;
  const n = track.dirt.length;
  for (const entry of tiles) {
    if (!entry || typeof entry !== "object") continue;
    const c = entry as Partial<TileChange>;
    if (typeof c.i !== "number" || !Number.isInteger(c.i) || c.i < 0 || c.i >= n) continue;
    const i: number = c.i;
    setByte(track.dirt, i, c.dirt);
    setByte(track.road, i, c.road);
    setByte(track.owner, i, c.owner);
    setByte(track.upgraded, i, c.upgraded);
  }
}

function setByte(layer: Uint8Array, i: number, v: unknown): void {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255) layer[i] = v;
}

/** Rough wire size in bytes — the `snapshotBytes` precedent: JSON length. */
export function deltaBytes(msg: DeltaMsg): number {
  return JSON.stringify(msg).length;
}

/** Everything a delta carries besides the changed tiles. */
export interface PublishFields {
  t: number;
  seq: number;
  harvesters: Snapshot["harvesters"];
  factories: Snapshot["factories"];
  players: DeltaPlayer[];
  setupPhase: boolean;
  won: boolean;
  /**
   * PP-14b: the Black-Market sabotage on the guest-seat plant. Always sent (it
   * is a handful of positions), so an expiry reads as "now empty" rather than
   * an extra event.
   */
  rivalSabotage: Snapshot["rivalSabotage"];
  /** MP-AUDIT: market parity, protests, vehicle presentation, boards, crossPrompt, winner */
  market?: Snapshot["market"];
  protests?: Snapshot["protests"];
  trucks?: Snapshot["trucks"];
  cars?: Snapshot["cars"];
  boards?: Snapshot["boards"];
  crossPrompt?: Snapshot["crossPrompt"];
  winner?: Snapshot["winner"];
  /**
   * MP-05: a one-shot line for the guest (a refused intent, usually). Carried
   * by the next delta rather than by a message of its own — the relay already
   * forwards deltas, and §4 has no host→guest side channel.
   */
  notice?: string;
}

/**
 * A delta as `buildPublish` emits it: every field present. The wire type keeps
 * them optional (tolerant reader), but OUR builder never omits — callers get
 * the guarantee in the type instead of a non-null assertion at every use.
 */
export type BuiltDeltaMsg = DeltaMsg &
  Required<Pick<DeltaMsg, "tiles" | "harvesters" | "factories" | "players" | "setupPhase" | "won" | "rivalSabotage">>;

export type PublishDecision =
  /** Steady state: send `msg` (it fits — the size guard already passed). */
  | { kind: "delta"; msg: BuiltDeltaMsg }
  /** Burst: the caller MUST publish a full snapshot instead. The journal was
   *  already drained — correct, because the snapshot supersedes it. */
  | { kind: "snapshot"; reason: string };

/**
 * Assemble one publish tick: drain the journal, read current values, cap at
 * `MAX_DELTA_TILES` (else snapshot fallback), then guard the serialized size
 * against `FRAME_CAP_BYTES` (else snapshot fallback).
 *
 * Contract: when the decision is `snapshot`, the caller publishes a FULL
 * snapshot — the drained changes are only safe to forget because the snapshot
 * carries them. Dropping the decision on the floor desyncs the guest.
 */
export function buildPublish(track: Track, dirty: DirtyTiles, f: PublishFields): PublishDecision {
  const tiles = readTiles(track, dirty.drain());
  if (tiles.length > MAX_DELTA_TILES) {
    return {
      kind: "snapshot",
      reason: `delta too large: ${tiles.length} tiles (cap ${MAX_DELTA_TILES})`,
    };
  }
  const msg: BuiltDeltaMsg = {
    type: "delta",
    t: f.t,
    seq: f.seq,
    tiles,
    harvesters: f.harvesters,
    factories: f.factories,
    players: f.players,
    setupPhase: f.setupPhase,
    won: f.won,
    rivalSabotage: f.rivalSabotage,
    ...(f.market !== undefined ? { market: f.market } : {}),
    ...(f.protests !== undefined ? { protests: f.protests } : {}),
    ...(f.trucks !== undefined ? { trucks: f.trucks } : {}),
    ...(f.cars !== undefined ? { cars: f.cars } : {}),
    ...(f.boards !== undefined ? { boards: f.boards } : {}),
    ...(f.crossPrompt !== undefined ? { crossPrompt: f.crossPrompt } : {}),
    ...(f.winner !== undefined ? { winner: f.winner } : {}),
    ...(f.notice ? { notice: f.notice } : {}),
  };
  const bytes = deltaBytes(msg);
  if (bytes > FRAME_CAP_BYTES) {
    return {
      kind: "snapshot",
      reason: `delta serializes to ${bytes} bytes (cap ${FRAME_CAP_BYTES})`,
    };
  }
  return { kind: "delta", msg };
}
