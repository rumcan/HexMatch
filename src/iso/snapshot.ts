// ══════════════════════════════════════════════════════════════════════════
// E10 — Multiplayer snapshot (isometric shape).
//
// Terrain and industries are SEED-DERIVED and never sent: every client runs
// the same `generateMap(seed)` and gets byte-identical output (E3/R6). What
// actually travels is the mutable world — the track layers, the harvester list
// and the factories.
//
// VP-01 dropped `connections` from the wire: Victory Points are now scored from
// the tiles a player has paved and the plants they have raised, both of which
// are already on the wire (the `upgraded` provenance layer and `factories`), so
// a guest recomputes the score rather than being told it. A scoreboard number
// the host could lie about is not a number worth sending.
//
// The four track layers go over the wire as base64, not JSON arrays:
// 20,736 bytes each on the 144×144 map become 27,648 base64 characters.
// Terrain, towns and industries remain seed-derived rather than transmitted.
//
// Every snapshot carries a `version`. A guest on a different version is
// rejected with a clear message rather than silently desyncing, which is what
// happens today.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { generateMap } from "./grid";
import type { Cargo } from "./config";
import { createTrack, type Track } from "./track";
import type { Harvester, Factory } from "./economy";

/**
 * Bump on ANY change to the snapshot shape or to seed-derived generation.
 * A guest whose version differs cannot be trusted to regenerate the same map.
 * v3 (W2): the track's per-tile owner layer travels with the two bit layers —
 * without it a rejoined guest would see both networks as one shared graph.
 * v4 (T4): 144×144 map and wider seed-derived industry/town separation.
 * v5 (PP-10): towns generate a seed-derived ring road that is stamped onto
 * the host's road layer; it travels inside the existing track bytes. The
 * wire shape is unchanged — bump so mixed-version rooms refuse instead of
 * showing a half-consistent map.
 * v6 (PP-13): seed-derived generation changed twice over — towns are three
 * times bigger (18–36 houses) and the map grows public highways between the
 * towns, stamped owner `PUBLIC_OWNER` (3) onto the road layer. The wire shape
 * is still unchanged, but a v5 guest would regenerate a DIFFERENT map from
 * the same seed, so mixed-version rooms must refuse.
 * v7 (RV-03): the seed-derived TOWN roads are no longer neutral owner 0 — they
 * are stamped `PUBLIC_OWNER` (3) like the highways, so a depot beside a town's
 * ring road is serviced and the route may run over it. The wire shape is
 * still unchanged (the owner byte travels as-is), but a v6 guest would seed a
 * different owner layer from the same seed, so mixed-version rooms must refuse.
 * v8 (de-railway): the game is two tiers of ROAD — the basic `dirt` layer
 * (was the old "road") and the premium paved `road` layer (was "rail", which
 * is gone). The map's public/town roads now live on the paved `road` layer.
 * The two wire layers are renamed `dirt`/`road` to match, so a v7 guest would
 * read the bytes into the wrong layers and must refuse.
 * v9 (VP-01): a fourth layer, `upgraded`, carries the per-tile PROVENANCE that
 * the victory rule reads (a paved Road that replaced a Dirt Road scores 0.25★,
 * one laid on virgin ground does not), and `connections` leaves the wire — it
 * is derived state now. A v8 guest has no provenance layer, so it would score
 * every rival pave as zero: refuse instead.
 */
export const SNAPSHOT_VERSION = 9;

export const EXPECTED_TRACK_BYTES = MAP_W * MAP_H;

// ── base64 for typed arrays ───────────────────────────────────────────────
// Works in both the browser (btoa/atob) and Node (Buffer), because the unit
// suite runs under `environment: "node"`.
export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let s = "";
  const CHUNK = 0x8000;   // bound the argument count independently of map size
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
  /** base64 Uint8Array(MAP_W*MAP_H) — direction masks plus the PRESENT bit.
   *  `dirt` = the basic gravel layer, `road` = the premium paved layer. */
  dirt: string;
  road: string;
  /** base64 Uint8Array(MAP_W*MAP_H) — per-tile owner (W2). */
  owner: string;
  /** VP-01: base64 Uint8Array(MAP_W*MAP_H) — per-tile pave provenance. */
  upgraded: string;
  harvesters: WireHarvester[];
  factories: Factory[];
  players: WirePlayer[];
}

export interface SnapshotSource {
  seed: number;
  track: Track;
  harvesters: Harvester[];
  factories: Factory[];
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
    dirt: bytesToBase64(src.track.dirt),
    road: bytesToBase64(src.track.road),
    owner: bytesToBase64(src.track.owner),
    upgraded: bytesToBase64(src.track.upgraded),
    harvesters: src.harvesters.map((h) => ({ id: h.id, owner: h.owner, ownerId: h.ownerId, tx: h.tx, ty: h.ty })),
    factories: src.factories.map((f) => ({ ...f })),
    players: src.players.map((p) => ({ ...p, res: { ...p.res } })),
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
  if (typeof o.dirt !== "string" || typeof o.road !== "string"
    || typeof o.owner !== "string" || typeof o.upgraded !== "string") {
    return new SnapshotError("malformed", "Snapshot is missing its track layers.");
  }
  if (!Array.isArray(o.harvesters) || !Array.isArray(o.factories)) {
    return new SnapshotError("malformed", "Snapshot is missing its structure lists.");
  }
  for (const [name, b64] of [["dirt", o.dirt], ["road", o.road], ["owner", o.owner],
    ["upgraded", o.upgraded]] as const) {
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
  track.dirt.set(base64ToBytes(o.dirt));
  track.road.set(base64ToBytes(o.road));
  track.owner.set(base64ToBytes(o.owner));
  // VP-01: the pave provenance rides with it, or a guest would render the
  // rival's tarmac as gravel and score their own paves as zero.
  track.upgraded.set(base64ToBytes(o.upgraded));
  return {
    seed: o.seed >>> 0,
    track,
    harvesters: o.harvesters.map((h) => ({ ...h })),
    factories: o.factories.map((f) => ({ ...f })),
    players: (o.players ?? []).map((p) => ({ ...p, res: { ...p.res } })),
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
