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
import { DEPOT_FACINGS, type DepotFacing } from "./depot";
// R3 (#270): the dam's wire shape (the record type travels, `dams.ts`
// validates it — this module stays the tolerant reader).
import type { DamWire } from "./dams";
// B6 (#251): the live MP duel's wire shape (seed + move log + full save).
import type { DuelWire } from "../game/battle-mp";
import type { OfferWire } from "./offers";

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
 * v10 (PP-14b): the snapshot gained `rivalSabotage` — the frost/girders/smog
 * the host's Black Market put on the guest-seat plant. L10 (#225) RETIRED it:
 * board obstacles belong to a tuning session now, so there is no sabotage left
 * to ship and the field leaves the wire. (The version is not re-numbered — it
 * only ever has to keep a mixed-version room from desyncing, and a room with
 * one client that still has the field and one that does not is the same pair
 * this note exists to refuse.)
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
// v14 (L9 / #224): the snapshot gains `blockades` — the per-industry Blockade
// expiries. The Black Market is map sabotage only now, so a Blockade IS half
// the shop, and a card whose whole effect is "these depots stop ticking" has
// to be visible on the seat it was played against: a v13 guest would watch its
// income stop with nothing on the map to explain it (industries are
// seed-derived and never sent, so the expiry cannot be inferred). Mixed
// versions must refuse.
// v15 (2×2 depots, 4×4 resources, fields): the seeded map itself moved —
// every resource is a 4×4 lot now, with wheat/tree blocks beside the farms and
// forests — and a Depot carries the ROTATION its entrance opens onto plus the
// `clearedFields` the players have demolished. A v14 guest would regenerate a
// different island from the same seed, so mixed versions must refuse.
// v16 (L15 / #230): the redesign is now the only loop. `boards` (token boards),
// `crossPrompt` (blessings), `bank` intent and old paving/plant VP are gone
// from the wire. A v15 guest would try to trade and bless on a host that no
// longer has those systems, so mixed versions must refuse.
// v17 (L15 sweep): boards and crossPrompt fully removed from types and wire.
export const SNAPSHOT_VERSION = 17;

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
  /** Playtest (2026-09): set on the Depot record a rail platform stands for. */
  platformId?: number;
  railIndustryId?: number;
  /** Which EDGE of the 2×2 truck Depot its entrance opens onto (its rotation). */
  facing?: DepotFacing;
  /**
   * L4 (#218): the depot's YIELD LEVEL — what a tuning session set it to, and
   * the multiplier the L1b clock pays the depot's cargo by. Optional and
   * additive on purpose: a host running the old loop (or an older build) sends
   * no level at all, and every reader treats its absence as the baseline.
   *
   * This is also the number L6's DECAY moves: `economyTick` cools the host's
   * depots and the cooled level is what rides here, so a guest watching a Hard
   * game sees the same shrinking multiplier the host is being paid for.
   */
  yield?: number;
  /**
   * L6 (#220): the transport tier the depot's last tuning session settled on
   * (`loop.ts`'s `TRANSPORT_TIERS`) — the spent half of Normal's "one match per
   * depot, one more per upgrade". Per-depot host state, so it travels or a
   * guest would compute a re-match credit the host never gave. Absent = never
   * tuned; like `yield`, an old-loop host sends nothing.
   */
  tuneTier?: number;
  /** #322: a closed Depot is shaded and pays nothing. Optional — absent = open. */
  closed?: boolean;
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
  /**
   * L5 (#219): the seat's place in the depot TREE — `depotTier` is the rung it
   * has unlocked (0 at boot, +1 per tuning session really played) and the two
   * town fields are its city upgrade (`townLevel` bought, `townBonus` the
   * base-rate multiplier the city session set, applied to every connected
   * depot). Same additive-optional contract as the allowances above: absent
   * means "leave the seat alone", `0` is a VALUE (a fresh seat, an un-upgraded
   * city), and no `SNAPSHOT_VERSION` bump is needed because these ride the
   * player records that already travel — a reader that does not know them
   * simply ignores them.
   */
  depotTier?: number;
  townLevel?: number;
  townBonus?: number;
}

/**
 * L9 (#224): one industry's live Blockade. `id` indexes the seed-derived
 * industry list both clients already generated, and `until` is host wall time
 * mapped through the same clock the protests use, so the guest's own overlay
 * and its income readout agree with the host's.
 */
export interface BlockadeWire {
  id: number;
  until: number;
  owner?: string;
}
export interface ProtestWire {
  x: number;
  y: number;
  until: number;
  owner: string;
}
/**
 * B5 (#250): the map's battle layer — the industries a conquest took
 * (`industryId → holder harvester id`) and the cooldown clocks (absolute on
 * the shared publish clock, the `protests` rule). The host owns it; a guest
 * that has not seen the field reads an un-fought map.
 */
export interface BattleWire {
  locks: [number, number][];
  readyAt: [string, number][];
  playerReadyAt: [string, number][];
  rivalReadyAt: number;
  battles: number;
  /**
   * B6 (#251): the live MP duel — seed + move list (the deterministic sync)
   * plus the full `Battle.save()` (rejoin restores the exact battle). The
   * host owns it; absent = no duel is running.
   */
  engine?: DuelWire;
  /**
   * B6 (#251): an open MP challenge waiting on the other seat's answer —
   * `challenger` is a HOST-frame seat id ("you" = host, "ai" = guest).
   */
  offer?: {
    industryId?: number;
    townId?: number;
    kind?: "industry" | "town";
    challenger: string;
    until: number;
  };
  /** #322: shared industry rights after a first territorial win. */
  siteRights?: [number, { rights: string[]; streak: { playerId: string; wins: number } | null }][];
  /** #322: town fights — holder, consecutive wins, upgrade lock. */
  townHolds?: [number, { holder: string; wins: number; locked: boolean }][];
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
  /** ROADS-2 (#393): base64 road tiers; absent = all Road. */
  tier?: string;
  harvesters: WireHarvester[];
  factories: Factory[];
  players: WirePlayer[];
  /** MP-AUDIT: protest roadblocks */
  protests?: ProtestWire[];
  /** B5 (#250): the map's battle layer — conquests + cooldown clocks. */
  battle?: BattleWire;
  /** TRADE (v14): the live offer book, host frame, ms left per offer. */
  offers?: OfferWire[];
  /** L9 (#224): live industry Blockades — the other half of the map shop. */
  blockades?: BlockadeWire[];
  /** MP-AUDIT: vehicle presentation */
  trucks?: TruckWire[];
  cars?: CarWire[];
  /** RAIL-04 (#178): the railway — layer, platforms, depots, lines, trains. */
  rail?: RailWire;
  /** MP-AUDIT: winner identity */
  winner?: WinnerWire | null;
  /**
   * RES-FIELDS: ids of the wheat fields / tree blocks demolished so far. The
   * fields themselves regenerate from the seed; only their clearing travels.
   */
  clearedFields?: number[];
  /**
   * R3 (#270): the standing hydro dams. The SITES are seed-derived (river
   * water on the regenerated map); only the ownership and the bank the
   * footprint leans onto are mutable, and that is all this field is. Same
   * additive-optional contract as `clearedFields` and the setup allowances
   * above: absent means "no dam stands", an old guest ignores the field, and
   * a new guest reading a pre-dam snapshot finds it absent — no
   * `SNAPSHOT_VERSION` bump.
   */
  dams?: DamWire[];
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
  protests?: ProtestWire[];
  battle?: BattleWire;
  /** TRADE (v14): the live offer book, host frame, ms left per offer. */
  offers?: OfferWire[];
  blockades?: BlockadeWire[];
  trucks?: TruckWire[];
  cars?: CarWire[];
  rail?: RailWire;
  winner?: WinnerWire | null;
  clearedFields?: number[];
  /** R3 (#270): the standing dams (the wire shape — the host's own form). */
  dams?: DamWire[];
}

/** Copy the duel for the wire (`saved` is a fresh `Battle.save()` each call). */
function copyDuelWire(w: DuelWire): DuelWire {
  return {
    seed: w.seed,
    rules: { ...w.rules },
    moves: w.moves.map((m) => ({ ...m })),
    saved: w.saved,
    turnDeadline: w.turnDeadline,
    timeouts: [w.timeouts[0], w.timeouts[1]],
    seatGone: [w.seatGone[0], w.seatGone[1]],
    over: w.over,
    winner: w.winner,
    stake: w.stake,
  };
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
    ...(src.track.tier && src.track.tier.some((v) => v !== 0) ? { tier: bytesToBase64(src.track.tier) } : {}),
    // L4 (#218): the yield level rides with the depot it belongs to. A level of
    // `undefined` (the old loop) is left OFF the record rather than sent as a
    // value, so an old-loop snapshot is byte-for-byte what it was.
    // L6 (#220): `tuneTier` joins it the same way — optional, and left off the
    // record when absent, so the old loop's bytes do not change.
    harvesters: src.harvesters.map((h) => ({
      id: h.id, owner: h.owner, ownerId: h.ownerId, tx: h.tx, ty: h.ty,
      ...(typeof h.yield === "number" ? { yield: h.yield } : {}),
      ...(h.facing ? { facing: h.facing } : {}),
      ...(typeof h.tuneTier === "number" ? { tuneTier: h.tuneTier } : {}),
      ...(h.closed ? { closed: true } : {}),
      // Playtest (2026-09): a platform's Depot record says which platform and
      // industry it stands for (absent on every road Depot).
      ...(typeof h.platformId === "number" ? { platformId: h.platformId, railIndustryId: h.railIndustryId } : {}),
    })),
    factories: src.factories.map((f) => ({ ...f })),
    players: src.players.map((p) => ({ ...p, res: { ...p.res } })),
    protests: src.protests ? src.protests.map((p) => ({ ...p })) : undefined,
    battle: src.battle
      ? {
        locks: src.battle.locks.map((l) => [...l] as [number, number]),
        readyAt: src.battle.readyAt.map((r) => [...r] as [string, number]),
        playerReadyAt: src.battle.playerReadyAt.map((r) => [...r] as [string, number]),
        rivalReadyAt: src.battle.rivalReadyAt,
        battles: src.battle.battles,
        engine: src.battle.engine ? copyDuelWire(src.battle.engine) : undefined,
        offer: src.battle.offer ? { ...src.battle.offer } : undefined,
        siteRights: src.battle.siteRights?.map((r) => [r[0], { rights: [...r[1].rights], streak: r[1].streak ? { ...r[1].streak } : null }] as [number, { rights: string[]; streak: { playerId: string; wins: number } | null }]),
        townHolds: src.battle.townHolds?.map((r) => [r[0], { ...r[1] }] as [number, { holder: string; wins: number; locked: boolean }]),
      }
      : undefined,
    blockades: src.blockades ? src.blockades.map((b) => ({ ...b })) : undefined,
    trucks: src.trucks ? src.trucks.map((t) => ({ ...t, factory: [...t.factory] as [number, number], route: t.route.map((r) => [...r] as [number, number]), segFast: [...t.segFast] })) : undefined,
    cars: src.cars ? src.cars.map((c) => ({ ...c, route: c.route.map((r) => [...r] as [number, number]), segFast: c.segFast ? [...c.segFast] : undefined })) : undefined,
    rail: copyRailWire(src.rail),
    winner: src.winner ?? null,
    ...(src.clearedFields?.length ? { clearedFields: [...src.clearedFields] } : {}),
    ...(src.offers ? { offers: src.offers.map((o) => ({ ...o })) } : {}),
    // R3 (#270): a world with no dam pays nothing for the field, like the
    // railway and the offer book.
    ...(src.dams?.length ? { dams: src.dams.map((d) => ({ ...d })) } : {}),
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
  // L6 (#220): the same rule for the re-match tier, because a guest that
  // defaulted a missing `tuneTier` to 0 would offer itself a re-tune the host
  // has already spent.
  for (const h of o.harvesters as (Partial<WireHarvester> | null)[]) {
    if (h && h.yield !== undefined && (typeof h.yield !== "number" || !Number.isFinite(h.yield))) {
      return new SnapshotError("malformed", "Snapshot carries a malformed depot yield.");
    }
    if (h && h.facing !== undefined && !DEPOT_FACINGS.includes(h.facing as DepotFacing)) {
      return new SnapshotError("malformed", "Snapshot carries a malformed depot facing.");
    }
    if (h && h.tuneTier !== undefined
      && (typeof h.tuneTier !== "number" || !Number.isInteger(h.tuneTier) || h.tuneTier < 0)) {
      return new SnapshotError("malformed", "Snapshot carries a malformed depot tune tier.");
    }
  }
  // F3 (#274): factory rot is optional (legacy absent=0), but when present must be 0..3
  for (const f of o.factories as (Partial<Factory> | null)[]) {
    if (f && f.rot !== undefined && (typeof f.rot !== "number" || !Number.isInteger(f.rot) || f.rot < 0 || f.rot > 3)) {
      return new SnapshotError("malformed", "Snapshot carries a malformed factory rotation.");
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
  // L11 (#226): a `market` field from an older host is IGNORED, not refused.
  // The offers it carries have nowhere to land any more (the trade UI, the
  // escrow and the rival's answering policy are gone), and a guest that had
  // to reload mid-match over a field this build cannot use would be a worse
  // failure than dropping it — the same treatment the retired `rivalSabotage`
  // field gets.
  //
  // MP-AUDIT: new optional fields are validated only when present
  if (o.protests !== undefined && o.protests !== null && !Array.isArray(o.protests)) {
    return new SnapshotError("malformed", "Snapshot protests is malformed.");
  }
  // B5 (#250): the battle layer — optional like the rest of the map cards.
  if (o.battle !== undefined && o.battle !== null) {
    const b = o.battle as Partial<BattleWire>;
    if (!Array.isArray(b.locks) || !Array.isArray(b.readyAt) || !Array.isArray(b.playerReadyAt)) {
      return new SnapshotError("malformed", "Snapshot battle is malformed.");
    }
    const e = b.engine as Partial<DuelWire> | undefined;
    if (e !== undefined && e !== null && (typeof e.seed !== "number" || !Array.isArray(e.moves)
      || !e.rules || typeof e.rules !== "object" || !Array.isArray(e.timeouts) || !Array.isArray(e.seatGone))) {
      return new SnapshotError("malformed", "Snapshot battle engine is malformed.");
    }
  }
  if (o.blockades !== undefined && o.blockades !== null && !Array.isArray(o.blockades)) {
    return new SnapshotError("malformed", "Snapshot blockades is malformed.");
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
  if (o.offers !== undefined && o.offers !== null && !Array.isArray(o.offers)) {
    return new SnapshotError("malformed", "Snapshot offers is malformed.");
  }
  if (o.clearedFields !== undefined && (!Array.isArray(o.clearedFields)
    || o.clearedFields.some((id) => !Number.isInteger(id) || id < 0))) {
    return new SnapshotError("malformed", "Snapshot cleared fields are malformed.");
  }
  // R3 (#270): the dams are optional (a dam-free world sends none), but a
  // present one must be a list of readable rows — a tile within the map, an
  // owner id, a legal axis and a bank across it. `damsFromWire` drops the
  // bad rows on apply; the loud refusal here is for the list that is not a
  // list at all, which no amount of row-dropping can make safe.
  if (o.dams !== undefined && o.dams !== null && !Array.isArray(o.dams)) {
    return new SnapshotError("malformed", "Snapshot dams is malformed.");
  }
  if (Array.isArray(o.dams)) {
    for (const d of o.dams) {
      if (!d || typeof d !== "object") return new SnapshotError("malformed", "Snapshot dams is malformed.");
      if (!Number.isInteger(d.wx) || !Number.isInteger(d.wy)
        || d.wx < 0 || d.wy < 0 || d.wx >= MAP_W || d.wy >= MAP_H
        || !Number.isInteger(d.ownerId) || d.ownerId < 1) {
        return new SnapshotError("malformed", "Snapshot carries a malformed dam site.");
      }
      if (d.axis !== "x" && d.axis !== "y") {
        return new SnapshotError("malformed", "Snapshot carries a malformed dam axis.");
      }
      if (d.axis === "x" ? d.side !== "n" && d.side !== "s"
        : d.side !== "e" && d.side !== "w") {
        return new SnapshotError("malformed", "Snapshot carries a malformed dam side.");
      }
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
  protests?: ProtestWire[];
  battle?: BattleWire;
  /** TRADE (v14): the live offer book, host frame, ms left per offer. */
  offers?: OfferWire[];
  blockades?: BlockadeWire[];
  trucks?: TruckWire[];
  cars?: CarWire[];
  rail?: RailWire;
  winner?: WinnerWire | null;
  clearedFields: number[];
  /** R3 (#270): the standing dams, validated row by row. */
  dams: DamWire[];
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
  if (typeof o.tier === "string") track.tier!.set(base64ToBytes(o.tier));
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
    protests: (o as Snapshot).protests ? (o as Snapshot).protests!.map((x) => ({ ...x })) : undefined,
    battle: (o as Snapshot).battle
      ? {
        locks: (o as Snapshot).battle!.locks.map((l) => [...l] as [number, number]),
        readyAt: (o as Snapshot).battle!.readyAt.map((r) => [...r] as [string, number]),
        playerReadyAt: (o as Snapshot).battle!.playerReadyAt.map((r) => [...r] as [string, number]),
        rivalReadyAt: (o as Snapshot).battle!.rivalReadyAt,
        battles: (o as Snapshot).battle!.battles,
        // B6 (#251): the live duel + open offer survive validation (rejoin).
        engine: (o as Snapshot).battle!.engine ? copyDuelWire((o as Snapshot).battle!.engine!) : undefined,
        offer: (o as Snapshot).battle!.offer ? { ...(o as Snapshot).battle!.offer! } : undefined,
        siteRights: (o as Snapshot).battle!.siteRights?.map((r) => [r[0], { rights: [...r[1].rights], streak: r[1].streak ? { ...r[1].streak } : null }] as [number, { rights: string[]; streak: { playerId: string; wins: number } | null }]),
        townHolds: (o as Snapshot).battle!.townHolds?.map((r) => [r[0], { ...r[1] }] as [number, { holder: string; wins: number; locked: boolean }]),
      }
      : undefined,
    blockades: (o as Snapshot).blockades ? (o as Snapshot).blockades!.map((x) => ({ ...x })) : undefined,
    trucks: (o as Snapshot).trucks ? (o as Snapshot).trucks!.map((x) => ({ ...x, factory: [...x.factory] as [number, number], route: x.route.map((r) => [...r] as [number, number]), segFast: [...x.segFast] })) : undefined,
    cars: (o as Snapshot).cars ? (o as Snapshot).cars!.map((x) => ({ ...x, route: x.route.map((r) => [...r] as [number, number]), segFast: x.segFast ? [...x.segFast] : undefined })) : undefined,
    rail: copyRailWire((o as Snapshot).rail),
    winner: (o as Snapshot).winner ?? null,
    clearedFields: [...(o.clearedFields ?? [])],
    offers: Array.isArray((o as Snapshot).offers) ? (o as Snapshot).offers!.map((x) => ({ ...x })) : undefined,
    // R3 (#270): the dam rows, copied (a shared reference would let a late
    // mutation on the wire object rewrite the applied world).
    dams: ((o as Snapshot).dams ?? []).map((x) => ({ ...x })),
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
