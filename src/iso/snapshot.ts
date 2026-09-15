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
 * v10 (PP-14b): the snapshot gains `rivalSabotage` — the frost/girders/smog
 * the host's Black Market put on the guest-seat plant. A v9 guest would never
 * show that sabotage (it is new state), so mixed-version rooms must refuse.
 */
// v11: coastal water pockets become sand after placement. Older network
// clients must update because buildability on those repaired cells changed.
// v12 (MP-AUDIT): snapshot gains market, vehicle, protest, board and winner
// fields for full guest parity (market parity, vehicle presentation,
// cross-choice, host departure). All new fields are optional for solo saves
// but required for protocol v4 multiplayer rooms.
// v13 (RAIL-04 / #178): the snapshot gains `rail` — the owner-scoped railway
// layer, its platforms and depots, its lines and its trains. A v12 guest would
// draw a rival's railway as empty ground and never show a train, so
// mixed-version rooms must refuse.
export const SNAPSHOT_VERSION = 14;

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
  /** Which half of the 2×2 truck Depot opens to roads; absent on older hosts. */
  facing?: "top" | "bottom";
  /**
   * L4 (#218): the depot's YIELD LEVEL — what a tuning session set it to, and
   * the multiplier the L1b clock pays the depot's cargo by. Optional and
   * additive on purpose: a host running the old loop (or an older build) sends
   * no level at all, and every reader treats its absence as the baseline.
   */
  yield?: number;
}

export interface WirePlayer {
  id: string;
  vp: number;
  res: Partial<Record<Cargo, number>>;
  /**
   * #137: the two SETUP ALLOWANCES, as data on the seat — E8's rule that free
   * builds are DATA and never an inference from the phase, carried across the
   * wire. `wirePlayers()` in game.ts has always put them in the snapshot's
   * player records and `DeltaPlayer` (protocol.ts) has always declared them for
   * the delta; the snapshot's READ side simply never picked them up, so a guest
   * joining or resyncing a progressed match kept the allowances it booted with
   * and advertised a free Depot and 12 free dirt tiles the host had already
   * spent (pricing its previews from them) until a later delta corrected it.
   *
   * Optional in the TYPE because a solo save — or any producer that has nothing
   * to restore — sends no allowances at all. Absent means "leave the seat
   * alone"; `0` means EXHAUSTED, which is a value and the one that matters.
   *
   * Declaring them changes no bytes on the wire (they already travelled), so
   * this is not a `SNAPSHOT_VERSION` bump: an old guest reads the same snapshot
   * it always did, and a new guest reading an old one finds the fields absent
   * and keeps its boot allowances — the pre-#137 behaviour, no worse.
   */
  freeTrack?: number;
  freeDepots?: number;
}

/**
 * PP-14b — the sabotage on the guest-seat plant, as it travels the wire. The
 * guest's own board is a spectator view whose gem layout is never synced, but
 * frost/girders/smog bought against it must still appear, so the sabotage
 * overlay ships instead of the whole sim. Seats are NOT mirrored: sabotage in
 * multiplayer always targets seat 1 (the host's rival = the guest itself), so
 * the guest applies it to its OWN board as-is.
 */
export interface RivalSabotage {
  /** Gems frozen in ice: position + ice level (1 or 2). */
  frozen: { r: number; c: number; hard: number }[];
  /** Cells blocked by iron girders. */
  girders: { r: number; c: number }[];
  /** Smog still hanging over the plant, in remaining ms (0 = none). */
  smogIn: number;
}

export interface MarketWireOffer {
  id: number;
  from: number;
  give: string;
  giveN: number;
  want: string;
  wantN: number;
  born: number;
}
export interface MarketWire {
  offers: MarketWireOffer[];
  offerSeq: number;
}
export interface ProtestWire {
  x: number;
  y: number;
  until: number;
  owner: string;
}
export interface TruckWire {
  ownerId: number;
  depotId: number;
  factory: [number, number];
  route: [number, number][];
  segFast: boolean[];
  leg: number;
  t: number;
  reverse: boolean;
  deliveries: number;
}
export interface CarWire {
  name: string;
  carIndex?: number;
  originTownId?: number | null;
  destTownId?: number | null;
  origin?: [number, number] | null;
  dest?: [number, number] | null;
  route: [number, number][];
  segFast?: boolean[];
  leg: number;
  t: number;
  reverse?: boolean;
  state?: string;
  waitMs?: number;
  fadeMs?: number;
  fade?: number;
  arriveMs?: number;
  lastTripKey?: string | null;
}
export interface BoardWire {
  owner: string;
  data: unknown;
}

// ── RAIL-04 (#178): the railway on the wire ───────────────────────────────
/**
 * One platform or depot, as the wire carries it. `view` and `kind` travel as
 * plain strings rather than string-literal unions: this module is the tolerant
 * reader, and `rail.ts` re-narrows them on apply. Unknown headings or kinds are
 * never a thrown parse.
 */
export interface RailAnchorWire {
  kind: "industry" | "plant";
  id: number;
  tiles: [number, number][];
}
export interface RailStructureWire {
  id: number;
  kind: "platform" | "depot";
  ownerId: number;
  owner: string;
  tx: number;
  ty: number;
  w: number;
  h: number;
  view: string;
  anchor?: RailAnchorWire | null;
}
export interface RailLineWire {
  id: number;
  ownerId: number;
  name: string;
  source: number;
  dest: number;
}
export interface TrainWire {
  id: number;
  ownerId: number;
  lineId: number;
  depotId: number;
  status: string;
  target: "source" | "dest" | "depot";
  /**
   * Tiles of the leg being driven, from where it was to where it is going.
   *
   * ABSENT means "unchanged since the last wire" (`rail.ts` sends a train's
   * route only when it is replanned — #142's "routes by revision, train
   * progress via compact updates") and the guest keeps the route it already
   * has for that id. A join, a resync and a save always carry it.
   */
  route?: [number, number][];
  dist: number;
  planRevision: number;
  dwellMs: number;
  dirBit: number;
  resold: boolean;
  blockedWhy?: string;
}
/**
 * The whole railway. Structures, lines and trains are a handful of records and
 * ride on EVERY publish (a guest's panel and its trains need them); the two
 * base64 layers are ~2 KB each, so a delta whose rail revision has not moved
 * omits them and the guest keeps its own bytes. A world with no railway sends
 * no `rail` field at all — a rail-free match pays nothing for this.
 */
export interface RailTileWire {
  /** Tile index (`tIdx`). */
  i: number;
  tile: number;
  owner: number;
}
export interface RailWire {
  /** base64 Uint8Array(MAP_W*MAP_W) — direction masks plus the PRESENT bit.
   *  Sent on a join/resync; a steady-state delta sends `tiles` instead. */
  tile?: string;
  /** base64 Uint8Array(MAP_W*MAP_W) — per-tile owner (player index + 1). */
  owner?: string;
  /** The sparse half: only the tiles that moved since the last publish. */
  tiles?: RailTileWire[];
  revision: number;
  seq: number;
  structures: RailStructureWire[];
  lines: RailLineWire[];
  trains: TrainWire[];
}
export interface CrossPromptWire {
  boardOwner: string;
  kind: "holy" | "broken";
  picks: number;
  seq: number;
}
export interface WinnerWire {
  id: string | null;
  source: string | null;
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
  /** PP-14b: the Black-Market sabotage on the guest-seat plant. */
  rivalSabotage: RivalSabotage;
  /** MP-AUDIT: market parity — live offers */
  market?: MarketWire;
  /** MP-AUDIT: protest roadblocks */
  protests?: ProtestWire[];
  /** MP-AUDIT: vehicle presentation */
  trucks?: TruckWire[];
  cars?: CarWire[];
  /** RAIL-04 (#178): the railway — layer, platforms, depots, lines, trains. */
  rail?: RailWire;
  /** MP-AUDIT: authoritative boards (compact gem tuples) */
  boards?: BoardWire[];
  /** MP-AUDIT: cross-bonus choice prompt */
  crossPrompt?: CrossPromptWire | null;
  /** MP-AUDIT: winner identity */
  winner?: WinnerWire | null;
  /**
   * RES-FIELDS: ids of the wheat fields / tree blocks demolished so far. The
   * fields themselves regenerate from the seed; only their clearing travels.
   */
  clearedFields?: number[];
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
  rivalSabotage?: RivalSabotage;
  market?: MarketWire;
  protests?: ProtestWire[];
  trucks?: TruckWire[];
  cars?: CarWire[];
  rail?: RailWire;
  boards?: BoardWire[];
  crossPrompt?: CrossPromptWire | null;
  winner?: WinnerWire | null;
  clearedFields?: number[];
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
    // L4 (#218): the yield level rides with the depot it belongs to. A level of
    // `undefined` (the old loop) is left OFF the record rather than sent as a
    // value, so an old-loop snapshot is byte-for-byte what it was.
    harvesters: src.harvesters.map((h) => ({
      id: h.id, owner: h.owner, ownerId: h.ownerId, tx: h.tx, ty: h.ty,
      ...(typeof h.yield === "number" ? { yield: h.yield } : {}),
      ...(h.facing ? { facing: h.facing } : {}),
    })),
    factories: src.factories.map((f) => ({ ...f })),
    players: src.players.map((p) => ({ ...p, res: { ...p.res } })),
    rivalSabotage: src.rivalSabotage
      ? {
          frozen: src.rivalSabotage.frozen.map((f) => ({ ...f })),
          girders: src.rivalSabotage.girders.map((g) => ({ ...g })),
          smogIn: src.rivalSabotage.smogIn,
        }
      : { frozen: [], girders: [], smogIn: 0 },
    market: src.market ? { offers: src.market.offers.map((o) => ({ ...o })), offerSeq: src.market.offerSeq } : undefined,
    protests: src.protests ? src.protests.map((p) => ({ ...p })) : undefined,
    trucks: src.trucks ? src.trucks.map((t) => ({ ...t, factory: [...t.factory] as [number, number], route: t.route.map((r) => [...r] as [number, number]), segFast: [...t.segFast] })) : undefined,
    cars: src.cars ? src.cars.map((c) => ({ ...c, route: c.route.map((r) => [...r] as [number, number]), segFast: c.segFast ? [...c.segFast] : undefined })) : undefined,
    rail: copyRailWire(src.rail),
    boards: src.boards ? src.boards.map((b) => ({ owner: b.owner, data: b.data })) : undefined,
    crossPrompt: src.crossPrompt ?? null,
    winner: src.winner ?? null,
    ...(src.clearedFields?.length ? { clearedFields: [...src.clearedFields] } : {}),
  };
}

/**
 * Deep copy for the wire: `route` and anchor `tiles` are arrays of tuples, so a
 * shared reference would let the host and the guest mutate one another's state.
 */
function copyRailWire(w: RailWire | undefined | null): RailWire | undefined {
  if (!w) return undefined;
  const out: RailWire = {
    revision: w.revision,
    seq: w.seq,
    structures: (w.structures ?? []).map((s) => ({
      ...s,
      anchor: s.anchor
        ? { kind: s.anchor.kind, id: s.anchor.id, tiles: s.anchor.tiles.map((t) => [...t] as [number, number]) }
        : s.anchor ?? null,
    })),
    lines: (w.lines ?? []).map((l) => ({ ...l })),
    trains: (w.trains ?? []).map((t) => ({ ...t, route: (t.route ?? []).map((r) => [...r] as [number, number]) })),
  };
  if (w.tile !== undefined) out.tile = w.tile;
  if (w.owner !== undefined) out.owner = w.owner;
  if (w.tiles !== undefined) out.tiles = w.tiles.map((t) => ({ ...t }));
  return out;
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
  // L4 (#218): a depot's yield level is optional, but a present one has to be
  // a real number — a guest that quietly read `undefined` as 1 while the host
  // clocked ×2.4 is the kind of divergence the wire refuses loudly.
  for (const h of o.harvesters as (Partial<WireHarvester> | null)[]) {
    if (h && h.yield !== undefined && (typeof h.yield !== "number" || !Number.isFinite(h.yield))) {
      return new SnapshotError("malformed", "Snapshot carries a malformed depot yield.");
    }
    if (h && h.facing !== undefined && h.facing !== "top" && h.facing !== "bottom") {
      return new SnapshotError("malformed", "Snapshot carries a malformed depot facing.");
    }
  }
  // #137: the seat list itself is optional (an empty world has nobody in it),
  // but when it travels it must be a list of readable records, and a setup
  // allowance that IS present must be a real number. A guest that quietly
  // ignored a malformed allowance would keep the one it booted with — the exact
  // silent divergence every other check here refuses loudly.
  if (o.players !== undefined && o.players !== null) {
    if (!Array.isArray(o.players)) {
      return new SnapshotError("malformed", "Snapshot players is malformed.");
    }
    for (const p of o.players as (Partial<WirePlayer> | null)[]) {
      if (!p || typeof p !== "object") {
        return new SnapshotError("malformed", "Snapshot carries a malformed player record.");
      }
      for (const allowance of [p.freeTrack, p.freeDepots]) {
        if (allowance !== undefined && (typeof allowance !== "number" || !Number.isFinite(allowance))) {
          return new SnapshotError("malformed", "Snapshot carries a malformed setup allowance.");
        }
      }
    }
  }
  // MP-AUDIT: new optional fields are validated only when present
  if (o.market !== undefined && o.market !== null) {
    const m = o.market as Partial<MarketWire>;
    if (!m || typeof m !== "object" || !Array.isArray((m as MarketWire).offers) || typeof (m as MarketWire).offerSeq !== "number") {
      return new SnapshotError("malformed", "Snapshot market is malformed.");
    }
  }
  if (o.protests !== undefined && o.protests !== null && !Array.isArray(o.protests)) {
    return new SnapshotError("malformed", "Snapshot protests is malformed.");
  }
  if (o.trucks !== undefined && o.trucks !== null && !Array.isArray(o.trucks)) {
    return new SnapshotError("malformed", "Snapshot trucks is malformed.");
  }
  if (o.cars !== undefined && o.cars !== null && !Array.isArray(o.cars)) {
    return new SnapshotError("malformed", "Snapshot cars is malformed.");
  }
  // RAIL-04: the railway is optional (a world with no track sends none), but a
  // present one must be readable: lists where lists belong, numbers where
  // numbers belong, and layer bytes of the map's size when they travel.
  if (o.rail !== undefined && o.rail !== null) {
    const r = o.rail as Partial<RailWire>;
    if (typeof r !== "object" || typeof r.revision !== "number" || typeof r.seq !== "number"
      || !Array.isArray(r.structures) || !Array.isArray(r.lines) || !Array.isArray(r.trains)
      || (r.tiles !== undefined && !Array.isArray(r.tiles))) {
      return new SnapshotError("malformed", "Snapshot rail is malformed.");
    }
    for (const [name, b64] of [["rail.tile", r.tile], ["rail.owner", r.owner]] as const) {
      if (b64 !== undefined && base64ToBytes(b64).length !== EXPECTED_TRACK_BYTES) {
        return new SnapshotError(
          "malformed",
          `Snapshot ${name} layer is the wrong size (expected ${EXPECTED_TRACK_BYTES} bytes).`,
        );
      }
    }
  }
  if (o.boards !== undefined && o.boards !== null && !Array.isArray(o.boards)) {
    return new SnapshotError("malformed", "Snapshot boards is malformed.");
  }
  if (o.clearedFields !== undefined && (!Array.isArray(o.clearedFields)
    || o.clearedFields.some((id) => !Number.isInteger(id) || id < 0))) {
    return new SnapshotError("malformed", "Snapshot cleared fields are malformed.");
  }
  // PP-14b: sabotage is optional for tolerance (an old producer might omit it
  // and still be readable), but if present it must be shaped correctly.
  if (o.rivalSabotage !== undefined) {
    const sab = o.rivalSabotage as Partial<RivalSabotage> | null;
    if (
      !sab || typeof sab !== "object" ||
      !Array.isArray(sab.frozen) || !Array.isArray(sab.girders) ||
      (sab.smogIn !== undefined && !Number.isFinite(sab.smogIn))
    ) {
      return new SnapshotError("malformed", "Snapshot's rival sabotage is malformed.");
    }
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
  rivalSabotage?: RivalSabotage;
  market?: MarketWire;
  protests?: ProtestWire[];
  trucks?: TruckWire[];
  cars?: CarWire[];
  rail?: RailWire;
  boards?: BoardWire[];
  crossPrompt?: CrossPromptWire | null;
  winner?: WinnerWire | null;
  clearedFields: number[];
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
  track.revision++;
  return {
    seed: o.seed >>> 0,
    track,
    harvesters: o.harvesters.map((h) => ({ ...h })),
    factories: o.factories.map((f) => ({ ...f })),
    players: (o.players ?? []).map((p) => ({ ...p, res: { ...p.res } })),
    setupPhase: !!o.setupPhase,
    won: !!o.won,
    t: o.t ?? 0,
    rivalSabotage: o.rivalSabotage
      ? {
          frozen: o.rivalSabotage.frozen.map((f) => ({ ...f })),
          girders: o.rivalSabotage.girders.map((g) => ({ ...g })),
          smogIn: o.rivalSabotage.smogIn,
        }
      : undefined,
    market: (o as Snapshot).market ? { offers: (o as Snapshot).market!.offers.map((x) => ({ ...x })), offerSeq: (o as Snapshot).market!.offerSeq } : undefined,
    protests: (o as Snapshot).protests ? (o as Snapshot).protests!.map((x) => ({ ...x })) : undefined,
    trucks: (o as Snapshot).trucks ? (o as Snapshot).trucks!.map((x) => ({ ...x, factory: [...x.factory] as [number, number], route: x.route.map((r) => [...r] as [number, number]), segFast: [...x.segFast] })) : undefined,
    cars: (o as Snapshot).cars ? (o as Snapshot).cars!.map((x) => ({ ...x, route: x.route.map((r) => [...r] as [number, number]), segFast: x.segFast ? [...x.segFast] : undefined })) : undefined,
    rail: copyRailWire((o as Snapshot).rail),
    boards: (o as Snapshot).boards ? (o as Snapshot).boards!.map((x) => ({ ...x })) : undefined,
    crossPrompt: (o as Snapshot).crossPrompt ?? null,
    winner: (o as Snapshot).winner ?? null,
    clearedFields: [...(o.clearedFields ?? [])],
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
