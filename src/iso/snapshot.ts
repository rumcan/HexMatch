// ══════════════════════════════════════════════════════════════════════════
// E10 — Multiplayer snapshot (isometric shape).
//
// Terrain and industries are SEED-DERIVED and never sent: every client runs
// the same `generateMap(seed)` and gets byte-identical output (E3/R6). What
// actually travels is the mutable world — the two track layers, the harvester
// list, the factories, and per-player score.
//
// The track layers go over the wire as base64, not JSON arrays: 2304 bytes
// each becomes ~3KB of base64 versus roughly 10KB as `[0,0,17,0,...]`. At the
// host's snapshot rate that difference is the whole bandwidth budget.
//
// Every snapshot carries a `version`. A guest on a different version is
// rejected with a clear message rather than silently desyncing, which is what
// happens today.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { generateMap } from "./grid";
import type { Cargo } from "./config";
import { createTrack, type Track } from "./track";
import type { Harvester, Factory, ScoreState, ConnKind } from "./economy";

/**
 * Bump on ANY change to the snapshot shape or to seed-derived generation.
 * A guest whose version differs cannot be trusted to regenerate the same map.
 * v3 (W2): the track's per-tile owner layer travels with the two bit layers —
 * without it a rejoined guest would see both networks as one shared graph.
 * v4 (TK-005): the map is 64×64 (was 48×48) and generation now also places
 * towns — a v3 guest would rebuild a different, smaller, townless map.
 */
export const SNAPSHOT_VERSION = 4;

export const EXPECTED_TRACK_BYTES = MAP_W * MAP_H;

// ── base64 for typed arrays ───────────────────────────────────────────────
// Works in both the browser (btoa/atob) and Node (Buffer), because the unit
// suite runs under `environment: "node"`.
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  const CHUNK = 0x8000;   // avoid blowing the argument limit on 2304+ bytes
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── wire shape ────────────────────────────────────────────────────────────
export interface WireHarvester {
  id: number; owner: string; ownerId: number; tx: number; ty: number;
}

export interface WirePlayer {
  id: string;
  vp: number;
  res: Partial<Record<Cargo, number>>;
}

export interface Snapshot {
  version: number;
  /** The map seed. Terrain and industries are regenerated from it, not sent. */
  seed: number;
  t: number;
  setupPhase: boolean;
  won: boolean;
  /** base64 Uint8Array(MAP_W*MAP_H) — direction masks plus the PRESENT bit. */
  road: string;
  rail: string;
  /** base64 Uint8Array(MAP_W*MAP_H) — per-tile owner (W2). */
  owner: string;
  harvesters: WireHarvester[];
  factories: Factory[];
  players: WirePlayer[];
  /** Per-harvester connection kind, so guests render VP state consistently. */
  connections: [number, ConnKind][];
}

export interface SnapshotSource {
  seed: number;
  track: Track;
  harvesters: Harvester[];
  factories: Factory[];
  score: ScoreState;
  setupPhase: boolean;
  won: boolean;
  players: WirePlayer[];
  t?: number;
}

export function buildSnapshot(src: SnapshotSource): Snapshot {
  return {
    version: SNAPSHOT_VERSION,
    seed: src.seed >>> 0,
    t: src.t ?? 0,
    setupPhase: src.setupPhase,
    won: src.won,
    road: bytesToBase64(src.track.road),
    rail: bytesToBase64(src.track.rail),
    owner: bytesToBase64(src.track.owner),
    harvesters: src.harvesters.map((h) => ({ id: h.id, owner: h.owner, ownerId: h.ownerId, tx: h.tx, ty: h.ty })),
    factories: src.factories.map((f) => ({ ...f })),
    players: src.players.map((p) => ({ ...p, res: { ...p.res } })),
    connections: [...src.score.connections],
  };
}

// ── validation ────────────────────────────────────────────────────────────
export class SnapshotError extends Error {
  readonly code: "version" | "malformed" | "seed";
  constructor(code: "version" | "malformed" | "seed", message: string) {
    super(message);
    this.code = code;
    this.name = "SnapshotError";
  }
}

/**
 * Reject a snapshot we cannot safely apply. A version mismatch is the common
 * case in the wild — a guest left on an old tab after a deploy — so it gets a
 * message a player can act on rather than a silent desync.
 */
export function validateSnapshot(s: unknown, localSeed?: number): SnapshotError | null {
  if (!s || typeof s !== "object") return new SnapshotError("malformed", "Snapshot is not an object.");
  const o = s as Partial<Snapshot>;
  if (typeof o.version !== "number") {
    return new SnapshotError("malformed", "Snapshot has no version field.");
  }
  if (o.version !== SNAPSHOT_VERSION) {
    return new SnapshotError(
      "version",
      `This game is running an incompatible version (host v${o.version}, you v${SNAPSHOT_VERSION}). Reload the page to update.`,
    );
  }
  if (typeof o.seed !== "number" || !Number.isFinite(o.seed)) {
    return new SnapshotError("malformed", "Snapshot has no map seed.");
  }
  if (typeof o.road !== "string" || typeof o.rail !== "string" || typeof o.owner !== "string") {
    return new SnapshotError("malformed", "Snapshot is missing its track layers.");
  }
  if (!Array.isArray(o.harvesters) || !Array.isArray(o.factories)) {
    return new SnapshotError("malformed", "Snapshot is missing its structure lists.");
  }
  for (const [name, b64] of [["road", o.road], ["rail", o.rail], ["owner", o.owner]] as const) {
    if (base64ToBytes(b64).length !== EXPECTED_TRACK_BYTES) {
      return new SnapshotError(
        "malformed",
        `Snapshot ${name} layer is the wrong size (expected ${EXPECTED_TRACK_BYTES} bytes).`,
      );
    }
  }
  if (localSeed !== undefined && (o.seed >>> 0) !== (localSeed >>> 0)) {
    return new SnapshotError(
      "seed",
      `Map seed mismatch (host ${o.seed >>> 0}, you ${localSeed >>> 0}). Rejoin the room.`,
    );
  }
  return null;
}

export interface AppliedSnapshot {
  seed: number;
  track: Track;
  harvesters: Harvester[];
  factories: Factory[];
  players: WirePlayer[];
  connections: Map<number, ConnKind>;
  setupPhase: boolean;
  won: boolean;
  t: number;
}

/**
 * Decode a validated snapshot. Throws `SnapshotError` rather than half-applying
 * — a partially applied snapshot is worse than a rejected one.
 */
export function applySnapshot(s: unknown, localSeed?: number): AppliedSnapshot {
  const err = validateSnapshot(s, localSeed);
  if (err) throw err;
  const o = s as Snapshot;
  const track = createTrack();
  track.road.set(base64ToBytes(o.road));
  track.rail.set(base64ToBytes(o.rail));
  track.owner.set(base64ToBytes(o.owner));
  return {
    seed: o.seed >>> 0,
    track,
    harvesters: o.harvesters.map((h) => ({ ...h })),
    factories: o.factories.map((f) => ({ ...f })),
    players: (o.players ?? []).map((p) => ({ ...p, res: { ...p.res } })),
    connections: new Map(o.connections ?? []),
    setupPhase: !!o.setupPhase,
    won: !!o.won,
    t: o.t ?? 0,
  };
}

/** Rough wire size in bytes, for the bandwidth assertion in the tests. */
export const snapshotBytes = (s: Snapshot): number => JSON.stringify(s).length;

/** Guest join: apply snapshot then regenerate the host map from its seed (R6). */
export function joinFromSnapshot(raw: unknown) {
  const applied = applySnapshot(raw);
  const grid = generateMap(applied.seed);
  return { applied, grid };
}
