// ══════════════════════════════════════════════════════════════════════════
// VP-01 — Victory Points: what the scoreboard actually pays for.
//
// The rule, in one line: **you score for what you UPGRADE, never for what you
// merely connect.**
//
//   Dirt Road tile paved into a Road (in place)   +0.25★   (4 paves = 1★)
//   Processing plant raised after setup           +1★
//   Rail platform                                  +1★  (Railways v1)
//   First to 10★ wins (the line visited 20★ under AI-02 and came back)
//
// What is deliberately worth nothing:
//
//   * a Dirt Road, or a connection over one. Gravel is plumbing. The old game
//     paid 1★ per dirt connection and 3★ per paved one, which made the
//     scoreboard a census of depots and rewarded whoever sprayed the cheapest
//     links around, instead of whoever improved their network;
//   * a paved Road laid on virgin ground. Laid new it costs 1 Wood + 1 Stone +
//     4 Ore and scores nothing; laid as a pave over your own gravel it costs
//     4 Ore and scores 0.25★. Same money, better road, actual points — the
//     upgrade is the only path, and `track.ts`'s `upgraded` provenance layer is
//     what tells the two apart.
//
// Two properties fall out of that, and both are the point:
//
//   1. **Ore is the score.** A pave is 4 Ore, and Ore only comes out of an ore
//      mine that is IN PRODUCTION — serviced by a depot, on a road, feeding a
//      plant. So the race to 10★ is a race to build a working economy, and the
//      connection mechanic (throughput ×1.0 dirt / ×1.6 paved) is what feeds
//      it, just without paying points twice.
//   2. **Points are revocable, so losing a road hurts.** Tear up a paved tile
//      and its 0.25★ goes with it; demolish a plant and its 1★ does. The
//      scoreboard is a live view of the network, not a history of everything
//      you ever built — which is why the DIFF, not a running total, is what
//      this module computes.
//
// `rescore` runs on every build and demolish (never on a timer) and returns the
// events the UI must surface: an unexplained VP drop is the single most
// confusing thing this system can do, so every event carries the tile it
// happened at and `game.ts` floats it on the map.
//
// Scoring is owner-scoped the way W2 made the whole economy: a tile scores for
// the player whose `owner` byte it carries, so the map's public highways and
// town rings (`PUBLIC_OWNER`) — and anything your rival paved — can never land
// on your total, or vice-versa.
//
// ── L13 (#228): the same module, a second table ───────────────────────────
//
// Everything above describes the SHIPPED loop, which still ships and still
// scores exactly as written. The redesigned loop (`newLoop`) pays for its own
// actions instead, because L2 made dirt free and L5 made the city the thing a
// seat upgrades — so paving is no longer a purchase worth a point, and an
// "extra Processing Plant" is no longer a thing the loop builds:
//
//   depot type running   +2★   per distinct cargo you have a connected,
//                              producing Depot for      (breadth, revocable)
//   depot-tree rung      +1★   per rung unlocked (L5)   (progress, monotone)
//   city upgrade tier    +2★   per tier confirmed (L5)  (depth, monotone)
//   First to 12★ wins
//
// The switch is the `loop` argument to `rescore`: with it, paves and plants
// are not collected (so any already on the ledger are revoked once and never
// awarded again) and the three sources above are. Without it, nothing in this
// module behaves differently than it did before the ticket — which is what
// keeps the VP-01 suite meaningful while the redesign is behind its flag.
//
// The two properties the shipped table was built around survive the move:
// **the pool is bigger than the line** (16★ of sources against 12★ to win), so
// no single source is mandatory and several plans reach the flag; and **the
// breadth source is revocable**, so the scoreboard stays a live view of the
// network rather than a history of everything ever built.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { PRESENT, PUBLIC_OWNER, type Track } from "./track";
import { VICTORY, DEPOT_LEVELS, type Cargo } from "./config";
import type { EconomyState, Harvester } from "./economy";

/**
 * The plant id of a player's opening Factory. It is placed during setup for
 * free, so it is NOT a victory point; every plant with a higher id was raised
 * by the player and pays `VICTORY.plant`. (`plants.ts` mints the ids.)
 */
export const OPENING_PLANT_ID = 0;

export type VpSource = "upgrade" | "plant" | "platform" | "type" | "rung" | "city" | "route" | "level";
export type VpChange = "awarded" | "revoked";

/**
 * One scored change. `tx`/`ty` locate it on the map (a plant's tile is its
 * footprint origin) so the float lands on the thing the player just paved
 * rather than somewhere on the scoreboard.
 */
export interface VpEvent {
  source: VpSource;
  type: VpChange;
  owner: string;
  delta: number;
  tx: number;
  ty: number;
  /** `plant` events: the town the plant was raised beside, when known. */
  townId?: number | null;
  /** `plant` events: 1-based plant number, for the toast. */
  plantNo?: number;
  /** L13 (#228) `type` events: which cargo's depot type started (or stopped)
   *  running, so the toast can name it ("Ore depots running · +2★"). */
  cargo?: Cargo;
  /** L13 (#228) `rung`/`city` events: the level that was reached. */
  level?: number;
}

/** Where a scored thing is and who it paid. Kept so a removal can be debited
 *  from the right player after the structure itself is gone. */
export interface PavedLedger {
  owner: string;
}
export interface PlantLedger {
  owner: string;
  tx: number;
  ty: number;
  townId: number | null;
  no: number;
}
/**
 * RAIL-02 (#176): a railway platform, as the scoreboard sees it. The railway
 * owns the structures; this module only needs to know one stands somewhere and
 * who it belongs to, so the shape stays a plain record rather than a RailState
 * (and `rescore` keeps working with no railway in the game at all).
 */
export interface PlatformLedger {
  owner: string;
  tx: number;
  ty: number;
  /** The platform's rail id — what the scoreboard keys its ledger by. */
  id: number;
}

/**
 * L13 (#228): a depot TYPE that is running for an owner — the breadth ★. The
 * tile is the Depot that proves it, so the float lands on the map where the
 * type actually started paying.
 */
export interface TypeLedger {
  owner: string;
  cargo: Cargo;
  tx: number;
  ty: number;
}

export interface ScoreState {
  /** tile index → who it scored for. */
  paved: Map<number, PavedLedger>;
  /** `${owner}#${plantId}` → what it scored. */
  plants: Map<string, PlantLedger>;
  /** `${owner}#${platformId}` → the railway platform that scored `platform`★. */
  platforms: Map<string, PlatformLedger>;
  /**
   * L13 (#228): `${owner}#${cargo}` → the depot type that is RUNNING for that
   * owner. Revocable like a pave: the key leaves the map when the last
   * connected, producing Depot of that cargo is cut off or demolished.
   */
  types: Map<string, TypeLedger>;
  /** L13: per-owner rungs already scored, so a rung pays exactly once. */
  rungs: Map<string, number>;
  /** 2026-09: `${owner}#${depotId}` → a Depot whose route is fully paved. */
  routes: Map<string, TypeLedger>;
  /** 2026-09: `${owner}#${depotId}` → a Depot at the top level. */
  levels: Map<string, TypeLedger>;
  /** L13: per-owner city tiers already scored. */
  city: Map<string, number>;
  /** Per-owner VP total. */
  vp: Map<string, number>;
}

export const createScoreState = (): ScoreState => ({
  paved: new Map(), plants: new Map(), platforms: new Map(),
  types: new Map(), rungs: new Map(), routes: new Map(), levels: new Map(), city: new Map(), vp: new Map(),
});

/** VP as the HUD prints it: whole when it is whole, 2dp at most otherwise. */
export const fmtVp = (v: number): string => {
  const r = Math.round(v * 100) / 100;
  return r.toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
};

/** `n` paved tiles, in VP. One function so the modebar, the toast and the
 *  scoreboard all convert the tile count the same way. */
export const paveVp = (n: number): number => n * VICTORY.upgrade;

/** The signed VP text for a float/toast: "+0.25★" / "−0.25★". */
export const vpDeltaText = (delta: number): string =>
  `${delta >= 0 ? "+" : "−"}${fmtVp(Math.abs(delta))}★`;

/**
 * The owner string a track-owner id belongs to, built from the structures that
 * carry both identities (the track layer only knows numbers). Public ground is
 * removed outright: a highway is every player's to drive and nobody's to score.
 */
export function ownerIdsByNumber(state: EconomyState): Map<number, string> {
  const out = new Map<number, string>();
  for (const f of state.factories) out.set(f.ownerId, f.owner);
  for (const h of state.harvesters) if (!out.has(h.ownerId)) out.set(h.ownerId, h.owner);
  out.delete(PUBLIC_OWNER);
  return out;
}

/** Every scored paved upgrade on the map: tile index → who owns it. */
export function scoredPaves(track: Track, owners: Map<number, string>): Map<number, string> {
  const out = new Map<number, string>();
  for (let y = 0; y < MAP_H; y++) {
    const row = y * MAP_W;
    for (let x = 0; x < MAP_W; x++) {
      const i = row + x;
      // BOTH bits, always: provenance without pavement (torn up and re-laid as
      // gravel) is worth nothing, and pavement without provenance is a Road
      // laid on virgin ground — the case this whole module exists to exclude.
      if ((track.upgraded[i] & PRESENT) === 0) continue;
      if ((track.road[i] & PRESENT) === 0) continue;
      const owner = owners.get(track.owner[i]);
      if (owner === undefined) continue;
      out.set(i, owner);
    }
  }
  return out;
}

/**
 * Every scored railway platform: `${owner}#${id}` → where it stands.
 *
 * RAIL-04 (#178) hands the scoreboard the platforms their owner built
 * (`railPlatformsOf` in game.ts reads them off the rail state); a game with no
 * railway passes nothing and scores nothing here.
 */
export function scoredPlatforms(
  platforms: readonly { id: number; ownerId: number; owner?: string }[] | undefined,
  owners: Map<number, string>,
): Map<string, PlatformLedger> {
  const out = new Map<string, PlatformLedger>();
  for (const p of platforms ?? []) {
    // The platform carries its own owner name; the id→name map is the fallback.
    // Deriving the name ONLY from the map would drop a platform the moment its
    // owner has no harvester, factory or paved tile on the map — a scored thing
    // must not depend on the scoreboard's ability to guess who built it.
    const owner = p.owner ?? owners.get(p.ownerId);
    if (owner === undefined) continue;
    out.set(`${owner}#${p.id}`, { owner, id: p.id, tx: (p as { tx?: number }).tx ?? 0, ty: (p as { ty?: number }).ty ?? 0 });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
// L13 (#228) — the new loop's three ★ sources.
//
// Read here, and only here, so "what the scoreboard pays" has one answer per
// loop. The shipped sources (paves, plants) are not deleted — the old loop
// still ships and still scores them — they are simply not COLLECTED when
// `rescore` is given a `loop` input, which is the flag's whole footprint on
// this module.
// ══════════════════════════════════════════════════════════════════════════

/**
 * What a seat's own progression contributes, handed in by the caller because
 * it lives on the player record rather than on the map (`game.ts`'s
 * `depotTier` / `townLevel`, the harness's `Seat`).
 */
export interface LoopSeatProgress {
  owner: string;
  /** L5 rungs unlocked (`depotTier`). */
  depotTier: number;
  /** L5 city upgrade tiers bought and confirmed (`townLevel`). */
  townLevel: number;
}

/**
 * The new loop's scoring input. Passing it is what switches `rescore` onto the
 * L13 table: paves and plants stop being collected, and the three loop sources
 * start.
 */
export interface LoopScoring {
  /** Is a Depot connected AND producing? The caller supplies the live rule
   *  (`harvesterYield`'s gate in game.ts / the harness), so this module never
   *  reimplements connectivity. */
  running: (h: Harvester) => boolean;
  /** The cargo a Depot harvests — `depotCargo` (economy.ts). */
  cargoOf: (h: Harvester) => Cargo | null;
  /** Per-seat rung/city progress. Seats absent from the list score neither. */
  seats: readonly LoopSeatProgress[];
  /**
   * 2026-09: is this running Depot's route to its plant FULLY PAVED Road?
   * Supplied by the caller (`depotRoutePaved` in economy.ts). Absent = no
   * route ★ (a caller that predates the rule).
   */
  routePaved?: (h: Harvester) => boolean;
}

/**
 * L13: every depot TYPE that is running, keyed `${owner}#${cargo}`.
 *
 * "Running" is the clock's own gate, not "built": a Depot with no road, a
 * Depot whose industry another network claimed first, and a Depot standing on
 * a cut line all fail it, so the breadth ★ is a live view of what the seat is
 * actually producing. The FIRST depot of a cargo (in id order) carries the
 * ledger's tile, so the float is stable while the type keeps running.
 */
export function runningDepotTypes(
  state: EconomyState, loop: LoopScoring,
): Map<string, TypeLedger> {
  const out = new Map<string, TypeLedger>();
  for (const h of [...state.harvesters].sort((a, b) => a.id - b.id)) {
    if (!loop.running(h)) continue;
    const cargo = loop.cargoOf(h);
    if (cargo === null) continue;
    // 2026-09: one ★ per running DEPOT (was one per distinct cargo).
    const key = `${h.owner}#${h.id}`;
    out.set(key, { owner: h.owner, cargo, tx: h.tx, ty: h.ty });
  }
  return out;
}

/** 2026-09: every running Depot whose route to its plant is fully paved. */
export function pavedRoutes(
  state: EconomyState, loop: LoopScoring,
): Map<string, TypeLedger> {
  const out = new Map<string, TypeLedger>();
  if (!loop.routePaved) return out;
  for (const h of [...state.harvesters].sort((a, b) => a.id - b.id)) {
    if (!loop.running(h) || !loop.routePaved(h)) continue;
    const cargo = loop.cargoOf(h);
    if (cargo === null) continue;
    out.set(`${h.owner}#${h.id}`, { owner: h.owner, cargo, tx: h.tx, ty: h.ty });
  }
  return out;
}

/** Every scored plant: `${owner}#${id}` → where it stands. */
export function scoredPlants(state: EconomyState): Map<string, PlantLedger> {
  const out = new Map<string, PlantLedger>();
  for (const f of state.factories) {
    const id = f.id ?? OPENING_PLANT_ID;
    if (id <= OPENING_PLANT_ID) continue;              // the setup Factory is free
    out.set(`${f.owner}#${id}`, {
      owner: f.owner, tx: f.tx, ty: f.ty, townId: f.townId ?? null, no: id,
    });
  }
  return out;
}

/**
 * Diff the board against the last scoring and return what changed. Called from
 * every build and demolish path (`rescoreNow` in game.ts), which is what keeps
 * a pave and the point it buys one atomic moment.
 */
export function rescore(
  state: EconomyState, score: ScoreState,
  platforms?: readonly { id: number; ownerId: number; owner?: string; tx: number; ty: number }[],
  loop?: LoopScoring,
): VpEvent[] {
  const events: VpEvent[] = [];
  const owners = ownerIdsByNumber(state);
  // L13 (#228): under the new loop the two shipped sources are not collected
  // at all, so every pave and plant already in the ledger is revoked on the
  // first rescore and nothing is ever awarded for one again. Empty maps rather
  // than a branch around the diff loops below: the "it disappeared" half of
  // the diff is exactly the behaviour a retired source needs.
  const paves = loop ? new Map<number, string>() : scoredPaves(state.track, owners);
  const plants = loop ? new Map<string, PlantLedger>() : scoredPlants(state);
  // RAIL-02: the platforms are the THIRD scored thing — awarded the moment one
  // stands, revoked the moment it is demolished, exactly like a plant. The
  // ledger is keyed by rail id, so rebuilding on the same industry is a NEW
  // point rather than a re-award the old ledger would swallow.
  // 2026-09: railways are out of the game — the new loop scores no platforms.
  const platformLedger = loop ? new Map<string, PlatformLedger>() : scoredPlatforms(platforms, owners);
  const add = (owner: string, delta: number) =>
    score.vp.set(owner, (score.vp.get(owner) ?? 0) + delta);

  // ── paved upgrades: awarded, revoked, or moved to a new owner ────────────
  for (const [i, owner] of paves) {
    const from = score.paved.get(i)?.owner;
    if (from === owner) continue;
    if (from !== undefined) {
      // The tile still counts — just for somebody else: the rival paved a
      // stretch of your gravel and took the ground with it. Emit both halves so
      // each player's counter animates.
      events.push({
        source: "upgrade", type: "revoked", owner: from, delta: -VICTORY.upgrade,
        tx: i % MAP_W, ty: (i / MAP_W) | 0,
      });
      add(from, -VICTORY.upgrade);
    }
    score.paved.set(i, { owner });
    add(owner, VICTORY.upgrade);
    events.push({
      source: "upgrade", type: "awarded", owner, delta: VICTORY.upgrade,
      tx: i % MAP_W, ty: (i / MAP_W) | 0,
    });
  }
  for (const [i, ledger] of [...score.paved]) {
    if (paves.has(i)) continue;
    score.paved.delete(i);
    add(ledger.owner, -VICTORY.upgrade);
    events.push({
      source: "upgrade", type: "revoked", owner: ledger.owner, delta: -VICTORY.upgrade,
      tx: i % MAP_W, ty: (i / MAP_W) | 0,
    });
  }

  // ── plants ───────────────────────────────────────────────────────────────
  for (const [key, p] of plants) {
    if (score.plants.has(key)) continue;
    score.plants.set(key, p);
    add(p.owner, VICTORY.plant);
    events.push({
      source: "plant", type: "awarded", owner: p.owner, delta: VICTORY.plant,
      tx: p.tx, ty: p.ty, townId: p.townId, plantNo: p.no + 1,
    });
  }
  for (const [key, p] of [...score.plants]) {
    if (plants.has(key)) continue;
    score.plants.delete(key);
    add(p.owner, -VICTORY.plant);
    events.push({
      source: "plant", type: "revoked", owner: p.owner, delta: -VICTORY.plant,
      tx: p.tx, ty: p.ty, townId: p.townId, plantNo: p.no + 1,
    });
  }
  // ── railway platforms ────────────────────────────────────────────────────
  for (const [key, p] of platformLedger) {
    if (score.platforms.has(key)) continue;
    score.platforms.set(key, p);
    add(p.owner, VICTORY.platform);
    events.push({
      source: "platform", type: "awarded", owner: p.owner, delta: VICTORY.platform,
      tx: p.tx, ty: p.ty,
    });
  }
  for (const [key, p] of [...score.platforms]) {
    if (platformLedger.has(key)) continue;
    score.platforms.delete(key);
    add(p.owner, -VICTORY.platform);
    events.push({
      source: "platform", type: "revoked", owner: p.owner, delta: -VICTORY.platform,
      tx: p.tx, ty: p.ty,
    });
  }

  // ── L13 (#228): the new loop's three sources ─────────────────────────────
  if (loop) {
    // BREADTH — a depot type that is running. Awarded and revoked like a pave,
    // because it is the one loop source the map can take back.
    const types = runningDepotTypes(state, loop);
    for (const [key, t] of types) {
      if (score.types.has(key)) continue;
      score.types.set(key, t);
      add(t.owner, VICTORY.loop.type);
      events.push({
        source: "type", type: "awarded", owner: t.owner, delta: VICTORY.loop.type,
        tx: t.tx, ty: t.ty, cargo: t.cargo,
      });
    }
    for (const [key, t] of [...score.types]) {
      if (types.has(key)) continue;
      score.types.delete(key);
      add(t.owner, -VICTORY.loop.type);
      events.push({
        source: "type", type: "revoked", owner: t.owner, delta: -VICTORY.loop.type,
        tx: t.tx, ty: t.ty, cargo: t.cargo,
      });
    }
    // ROUTES (2026-09) — a Depot whose road to the plant is fully paved.
    // Revocable like a running Depot: break the pavement and it stops paying.
    if (VICTORY.loop.route > 0) {
      const routes = pavedRoutes(state, loop);
      for (const [key, t] of routes) {
        if (score.routes.has(key)) continue;
        score.routes.set(key, t);
        add(t.owner, VICTORY.loop.route);
        events.push({
          source: "route", type: "awarded", owner: t.owner, delta: VICTORY.loop.route,
          tx: t.tx, ty: t.ty, cargo: t.cargo,
        });
      }
      for (const [key, t] of [...score.routes]) {
        if (routes.has(key)) continue;
        score.routes.delete(key);
        add(t.owner, -VICTORY.loop.route);
        events.push({
          source: "route", type: "revoked", owner: t.owner, delta: -VICTORY.loop.route,
          tx: t.tx, ty: t.ty, cargo: t.cargo,
        });
      }
    }
    // TOP-LEVEL DEPOTS (2026-09) — 1★ per Depot upgraded to the max level.
    // Revoked if the Depot is demolished.
    if (VICTORY.loop.maxDepot > 0) {
      const top = new Map<string, TypeLedger>();
      for (const h of state.harvesters) {
        if ((h.level ?? 1) < DEPOT_LEVELS.max) continue;
        top.set(`${h.owner}#${h.id}`, { owner: h.owner, cargo: loop.cargoOf(h) ?? "grain", tx: h.tx, ty: h.ty });
      }
      for (const [key, t] of top) {
        if (score.levels.has(key)) continue;
        score.levels.set(key, t);
        add(t.owner, VICTORY.loop.maxDepot);
        events.push({ source: "level", type: "awarded", owner: t.owner, delta: VICTORY.loop.maxDepot, tx: t.tx, ty: t.ty, level: DEPOT_LEVELS.max });
      }
      for (const [key, t] of [...score.levels]) {
        if (top.has(key)) continue;
        score.levels.delete(key);
        add(t.owner, -VICTORY.loop.maxDepot);
        events.push({ source: "level", type: "revoked", owner: t.owner, delta: -VICTORY.loop.maxDepot, tx: t.tx, ty: t.ty });
      }
    }
    // DEPTH — rungs and city tiers. Both are monotone by construction (a rung
    // cannot be un-unlocked, a bought upgrade is not refunded once confirmed),
    // so they are scored as a HIGH-WATER MARK rather than diffed: a seat that
    // somehow reports a lower level keeps the stars it was already paid, which
    // is what stops a wire hiccup or a restored save from silently deleting
    // points the player watched arrive.
    for (const seat of loop.seats) {
      const paidRungs = score.rungs.get(seat.owner) ?? 0;
      const rungs = Math.max(paidRungs, Math.max(0, Math.floor(seat.depotTier)));
      if (rungs > paidRungs && VICTORY.loop.rung > 0) {
        score.rungs.set(seat.owner, rungs);
        for (let level = paidRungs + 1; level <= rungs; level++) {
          add(seat.owner, VICTORY.loop.rung);
          events.push({
            source: "rung", type: "awarded", owner: seat.owner, delta: VICTORY.loop.rung,
            tx: 0, ty: 0, level,
          });
        }
      }
      const paidCity = score.city.get(seat.owner) ?? 0;
      const city = Math.max(paidCity, Math.max(0, Math.floor(seat.townLevel)));
      if (city > paidCity) {
        score.city.set(seat.owner, city);
        for (let level = paidCity + 1; level <= city; level++) {
          add(seat.owner, VICTORY.loop.city);
          events.push({
            source: "city", type: "awarded", owner: seat.owner, delta: VICTORY.loop.city,
            tx: 0, ty: 0, level,
          });
        }
      }
    }
  }
  return events;
}

export const vpFor = (score: ScoreState, owner: string) => score.vp.get(owner) ?? 0;

/**
 * The two numbers behind a player's total — tiles paved and plants raised —
 * for the HUD, the inspector and the tests. Recomputed from the board rather
 * than accumulated, so it can never drift from the network it describes.
 */
export function victoryBreakdown(
  state: EconomyState, owner: string,
  platforms?: readonly { id: number; ownerId: number; owner?: string; tx: number; ty: number }[],
  loop?: LoopScoring,
) {
  const owners = ownerIdsByNumber(state);
  // L13 (#228): the retired sources read as zero under the new loop, exactly
  // as `rescore` scores them — one rule, so the ledger can never print a row
  // the scoreboard did not pay.
  let paved = 0;
  if (!loop) for (const o of scoredPaves(state.track, owners).values()) if (o === owner) paved++;
  let plants = 0;
  if (!loop) for (const p of scoredPlants(state).values()) if (p.owner === owner) plants++;
  let rail = 0;
  if (!loop) for (const p of scoredPlatforms(platforms, owners).values()) if (p.owner === owner) rail++;
  // L13: the new loop's three. `types` is counted off the live network (the
  // same scan `rescore` awards from); rungs and city come off the seat record.
  const cargos: Cargo[] = [];
  if (loop) {
    for (const t of runningDepotTypes(state, loop).values()) {
      if (t.owner === owner) cargos.push(t.cargo);
    }
  }
  let routes = 0;
  if (loop) for (const r of pavedRoutes(state, loop).values()) if (r.owner === owner) routes++;
  const seat = loop?.seats.find((s) => s.owner === owner);
  const rungs = Math.max(0, Math.floor(seat?.depotTier ?? 0));
  const city = Math.max(0, Math.floor(seat?.townLevel ?? 0));
  return {
    /**
     * L13 (#228): WHICH ★ table paid this breakdown. The readers (the ending
     * ledger, the path reading) must not have to infer it from the numbers —
     * a new-loop seat that has scored nothing yet has the same all-zero rows
     * as a shipped-loop seat, and guessing printed the wrong ledger.
     */
    loop: loop !== undefined,
    paved,
    plants,
    platforms: rail,
    pavedVp: paveVp(paved),
    plantVp: plants * VICTORY.plant,
    platformVp: rail * VICTORY.platform,
    /** L13: the distinct cargos this seat has a running depot type for. */
    cargos,
    types: cargos.length,
    typeVp: cargos.length * VICTORY.loop.type,
    rungs,
    rungVp: rungs * VICTORY.loop.rung,
    /** 2026-09: Depots whose route to the plant is fully paved. */
    routes,
    routeVp: routes * VICTORY.loop.route,
    city,
    cityVp: city * VICTORY.loop.city,
  };
}

/**
 * Has this player reached the winning total? One predicate for the win check,
 * the HUD's "ready to win" glow and the AI's race assessment, so nobody
 * re-derives `>= VP_TARGET` and rounds it differently.
 *
 * AI-04: `target` is injectable because the line now belongs to the difficulty
 * (`RivalSkill.winTarget`) — easy races to 5★. The default stays the shipped
 * `VICTORY.target`, so every caller that has no difficulty in scope (a hosted
 * multiplayer game, the race harness, the snapshot parity test) keeps racing
 * the same 10★ it always did.
 */
export const hasWon = (score: ScoreState, owner: string, target: number = VICTORY.target): boolean =>
  vpFor(score, owner) >= target;

/**
 * #322: city ★ is otherwise a high-water mark. A lost town fight must
 * explicitly debit the stars the closed plant / lost city was paying.
 */
export function revokeCityStars(score: ScoreState, owner: string, nextLevel: number): VpEvent[] {
  const paid = score.city.get(owner) ?? 0;
  const next = Math.max(0, Math.floor(nextLevel));
  if (next >= paid || VICTORY.loop.city <= 0) {
    if (next < paid) score.city.set(owner, next);
    return [];
  }
  const events: VpEvent[] = [];
  for (let level = paid; level > next; level--) {
    score.vp.set(owner, (score.vp.get(owner) ?? 0) - VICTORY.loop.city);
    events.push({
      source: "city", type: "revoked", owner, delta: -VICTORY.loop.city,
      tx: 0, ty: 0, level,
    });
  }
  score.city.set(owner, next);
  return events;
}
