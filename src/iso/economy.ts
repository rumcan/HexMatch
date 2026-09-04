// ══════════════════════════════════════════════════════════════════════════
// E6 — Stations, catchment and connection scoring.
//
// Replaces vertex adjacency (hexmap's `playerResources`). This is the mechanic
// that makes the map matter:
//
//   harvester → 4×4 catchment → overlapping industries → output
//               × the transport multiplier of the connection to the Factory
//
// A harvester must be adjacent to at least one road or rail tile. Connection
// is a flood fill over the direction masks where a tile connects only if BOTH
// neighbours set the facing bit (E5's invariant), so half-piece bugs are
// impossible by construction.
//
// Rail beats road: if a harvester reaches the Factory by both, take the rail
// multiplier AND the rail VP. If the rail path breaks, fall back to a
// surviving road path and REVOKE the rail VP — the caller gets an explicit
// event list so the UI can toast it and animate the counter down, because a
// silent VP drop is the single most confusing thing this system can do.
//
// Scoring runs on every build and demolish, never on a timer.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import { TRANSPORT, INDUSTRY_BY_KEY, type Cargo } from "./config";
import type { Grid, Industry } from "./grid";
import {
  DIRS, DIR, OPPOSITE, PRESENT, tIdx, inMapT, bitsAt, trackOwnedBy,
  type Track, type TrackKind,
} from "./track";

/** Catchment is a 4×4 rectangle centred on the harvester tile. */
export const CATCHMENT = 4;

/**
 * W2: structures carry the numeric track-owner id of their builder (the
 * game uses player index + 1). `owner` stays the display/VP identity;
 * `ownerId` is what binds a harvester to the track IT may ride.
 */
export interface Harvester {
  id: number;
  owner: string;
  ownerId: number;
  tx: number;
  ty: number;
}

export interface Factory {
  owner: string;
  ownerId: number;
  tx: number;
  ty: number;
}

export interface EconomyState {
  grid: Grid;
  track: Track;
  harvesters: Harvester[];
  factories: Factory[];
}

// ── catchment ─────────────────────────────────────────────────────────────
/**
 * The 4×4 catchment rect centred on (tx,ty). With an even size there is no
 * exact centre, so the rect is biased to start at floor(size/2) - 1 back from
 * the harvester: the harvester's own tile is always inside.
 */
export function catchmentRect(tx: number, ty: number, size = CATCHMENT) {
  const back = Math.floor(size / 2) - 1;
  const x0 = tx - back, y0 = ty - back;
  return { x0, y0, x1: x0 + size - 1, y1: y0 + size - 1 };
}

export const rectContains = (
  r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number,
) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Every industry whose footprint overlaps the harvester's catchment. */
export function industriesInCatchment(grid: Grid, h: Harvester): Industry[] {
  const r = catchmentRect(h.tx, h.ty);
  const out: Industry[] = [];
  for (const ind of grid.industries) {
    const ix1 = ind.tx + ind.w - 1, iy1 = ind.ty + ind.h - 1;
    if (ix1 < r.x0 || ind.tx > r.x1) continue;
    if (iy1 < r.y0 || ind.ty > r.y1) continue;
    out.push(ind);
  }
  return out;
}

/**
 * A harvester is only valid if it touches at least one road or rail tile
 * BUILT BY ITS OWN PLAYER (W2). The rival's road beside your harvester does
 * not service it — your depot needs your own line.
 */
export function isServiced(track: Track, h: Harvester): boolean {
  for (const d of DIRS) {
    const nx = h.tx + DIR[d][0], ny = h.ty + DIR[d][1];
    if (trackOwnedBy(track, h.ownerId, nx, ny)) return true;
  }
  return false;
}

// ── connected components ──────────────────────────────────────────────────
/**
 * Component id per tile for one transport layer, or -1. Built in one O(tiles)
 * pass and cached by the caller; a rebuild is cheap and happens only on build
 * or demolish. A tile joins its neighbour's component only when both face each
 * other, so a one-sided bit never merges two networks.
 *
 * W2: components are owner-scoped — the flood only crosses tiles owned by
 * `owner`, so a connected run of YOUR road and a connected run of the RIVAL's
 * road that touch each other are still two components, one per player. The
 * old "two players' networks are one shared graph" bug lives and dies here.
 */
export function buildComponents(track: Track, kind: TrackKind, owner: number): Int32Array {
  const comp = new Int32Array(MAP_W * MAP_H).fill(-1);
  const layer = kind === "road" ? track.road : track.rail;
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < comp.length; start++) {
    if ((layer[start] & PRESENT) === 0 || comp[start] !== -1) continue;
    if (track.owner[start] !== owner) continue;
    const id = next++;
    comp[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      const bits = bitsAt(track, kind, x, y);
      for (const d of DIRS) {
        if (!(bits & d)) continue;
        const nx = x + DIR[d][0], ny = y + DIR[d][1];
        if (!inMapT(nx, ny)) continue;
        if (!(bitsAt(track, kind, nx, ny) & OPPOSITE[d])) continue;  // mutual only
        const ni = tIdx(nx, ny);
        if (comp[ni] !== -1) continue;
        if (track.owner[ni] !== owner) continue;   // W2: never cross the rival's line
        comp[ni] = id;
        stack.push(ni);
      }
    }
  }
  return comp;
}

export interface Components {
  road: Int32Array;
  rail: Int32Array;
}

/** Both layers, scoped to one owner's track. */
export const buildAllComponents = (track: Track, owner: number): Components => ({
  road: buildComponents(track, "road", owner),
  rail: buildComponents(track, "rail", owner),
});

/**
 * W2: resolve a player's numeric track-owner id from the string identity the
 * economy scores by. Every structure a player builds carries the same id, so
 * the first one found is enough; a player with no structures has none (and
 * therefore no harvesters to score).
 */
export const ownerIdOf = (state: EconomyState, owner: string): number =>
  state.harvesters.find((h) => h.owner === owner)?.ownerId
  ?? state.factories.find((f) => f.owner === owner)?.ownerId
  ?? 0;

/** Component ids of the layer touching a tile from any of its 4 neighbours. */
function adjacentComponents(comp: Int32Array, tx: number, ty: number): Set<number> {
  const out = new Set<number>();
  for (const d of DIRS) {
    const nx = tx + DIR[d][0], ny = ty + DIR[d][1];
    if (!inMapT(nx, ny)) continue;
    const c = comp[tIdx(nx, ny)];
    if (c >= 0) out.add(c);
  }
  return out;
}

/**
 * Is `a` linked to `b` on this layer? Both must sit beside the SAME connected
 * component. Structures are not themselves track, so we compare the components
 * adjacent to each.
 */
export function linkedBy(
  comp: Int32Array, ax: number, ay: number, bx: number, by: number,
): boolean {
  const A = adjacentComponents(comp, ax, ay);
  if (!A.size) return false;
  for (const c of adjacentComponents(comp, bx, by)) if (A.has(c)) return true;
  return false;
}

// ── connection resolution ─────────────────────────────────────────────────
export type ConnKind = TrackKind | null;

export interface Connection {
  kind: ConnKind;        // null = not connected to any factory
  multiplier: number;    // 1.0 road / 1.6 rail / 0 unconnected
  vp: number;            // VP this connection is worth
  factory: Factory | null;
}

export const NO_CONNECTION: Connection = {
  kind: null, multiplier: 0, vp: 0, factory: null,
};

/**
 * Resolve a harvester's connection to its owner's Factory. Rail wins outright
 * when both exist — its multiplier and its VP.
 *
 * W2: `comp` must be the components for `h.ownerId` (build it with
 * `buildAllComponents(track, h.ownerId)`) — a harvester may only ride its own
 * player's track, and may only connect to its own player's Factory.
 */
export function resolveConnection(
  state: EconomyState, comp: Components, h: Harvester,
): Connection {
  const mine = state.factories.filter((f) => f.owner === h.owner);
  let best: Connection = NO_CONNECTION;
  for (const f of mine) {
    if (linkedBy(comp.rail, h.tx, h.ty, f.tx, f.ty)) {
      // rail is the ceiling — nothing beats it, stop looking
      return {
        kind: "rail", multiplier: TRANSPORT.rail.throughput, vp: TRANSPORT.rail.vp, factory: f,
      };
    }
    if (best.kind === null && linkedBy(comp.road, h.tx, h.ty, f.tx, f.ty)) {
      best = {
        kind: "road", multiplier: TRANSPORT.road.throughput, vp: TRANSPORT.road.vp, factory: f,
      };
    }
  }
  return best;
}

// ── output ────────────────────────────────────────────────────────────────
/**
 * How many harvesters claim each industry. Overlapping catchments split the
 * industry's output proportionally among claimants (settled decision), which
 * avoids a first-mover lockout without needing a rating system.
 *
 * Only serviced harvesters count as claimants — an unserviced one must not
 * dilute someone else's yield.
 */
export function claimantCounts(state: EconomyState): Map<number, number> {
  const counts = new Map<number, number>();
  for (const h of state.harvesters) {
    if (!isServiced(state.track, h)) continue;
    for (const ind of industriesInCatchment(state.grid, h)) {
      counts.set(ind.id, (counts.get(ind.id) ?? 0) + 1);
    }
  }
  return counts;
}

export type Yield = Partial<Record<Cargo, number>>;

export interface HarvesterYield {
  harvester: Harvester;
  connection: Connection;
  serviced: boolean;
  yields: Yield;
}

/**
 * Per-harvester output. A blockaded industry (`banditUntil > now`) produces
 * nothing — that rule carries over cleanly from the hex version. `comp` must
 * be scoped to `h.ownerId` (W2).
 */
export function harvesterYield(
  state: EconomyState, comp: Components, counts: Map<number, number>,
  h: Harvester, now: number,
): HarvesterYield {
  const serviced = isServiced(state.track, h);
  const connection = serviced ? resolveConnection(state, comp, h) : NO_CONNECTION;
  const yields: Yield = {};
  if (!serviced || connection.kind === null) {
    return { harvester: h, connection, serviced, yields };
  }
  for (const ind of industriesInCatchment(state.grid, h)) {
    if (ind.banditUntil > now) continue;                 // blockaded
    const def = INDUSTRY_BY_KEY[ind.type];
    if (!def) continue;
    const share = counts.get(ind.id) ?? 1;
    const amount = (ind.output ?? def.output) * connection.multiplier / share;
    yields[def.cargo] = (yields[def.cargo] ?? 0) + amount;
  }
  return { harvester: h, connection, serviced, yields };
}

/**
 * E6's replacement for `playerResources(map, player, now)`: walk every
 * harvester the player owns and sum the cargo it delivers.
 *
 * W2: the components default to THIS player's network (`ownerIdOf`), so the
 * rival's road can no longer carry the rival's cargo across your board — or
 * yours across theirs.
 */
export function playerResources(
  state: EconomyState, owner: string, now: number, comp?: Components,
): Yield {
  const counts = claimantCounts(state);
  const out: Yield = {};
  // All of one player's harvesters share a track-owner id, so one flood pair
  // serves the whole loop.
  const c = comp ?? buildAllComponents(state.track, ownerIdOf(state, owner));
  for (const h of state.harvesters) {
    if (h.owner !== owner) continue;
    const y = harvesterYield(state, c, counts, h, now);
    for (const [cargo, v] of Object.entries(y.yields) as [Cargo, number][]) {
      out[cargo] = (out[cargo] ?? 0) + v;
    }
  }
  return out;
}

// ── TK-008: auto-routed sabotage (no targeting step for a single rival) ───
/**
 * How much of `owner`'s CURRENT harvest each industry is responsible for
 * (same share-based arithmetic `harvesterYield` uses, summed over the owner's
 * serviced AND connected harvesters). A Blockade bought against this owner
 * should land on the industry at the top of this map — that is the district
 * whose loss hurts the rival most.
 */
export function industryClaimValues(
  state: EconomyState, owner: string, now: number,
): Map<number, number> {
  const out = new Map<number, number>();
  const ownerId = ownerIdOf(state, owner);
  if (ownerId === 0) return out;              // nothing owned → nothing to lose
  const counts = claimantCounts(state);
  const comp = buildAllComponents(state.track, ownerId);
  for (const h of state.harvesters) {
    if (h.owner !== owner) continue;
    const y = harvesterYield(state, comp, counts, h, now);
    if (!y.serviced || y.connection.kind === null) continue;   // not paying yet
    for (const ind of industriesInCatchment(state.grid, h)) {
      if (ind.banditUntil > now) continue;    // already blockaded
      const def = INDUSTRY_BY_KEY[ind.type];
      if (!def) continue;
      const share = counts.get(ind.id) ?? 1;
      const v = (ind.output ?? def.output) * y.connection.multiplier / share;
      out.set(ind.id, (out.get(ind.id) ?? 0) + v);
    }
  }
  return out;
}

/**
 * Where a Blockade bought against `owner` lands. Picks, in order:
 *   1. the industry currently delivering the most yield to `owner` (the
 *      block that hurts right now), ties broken by lowest industry id;
 *   2. otherwise the highest-output industry inside one of `owner`'s
 *      harvesters' catchments (the rival is about to connect it);
 *   3. otherwise the unblockaded industry nearest `owner`'s factory.
 * Returns null only when the map has no industry left to block.
 */
export function pickBlockadeTarget(
  state: EconomyState, owner: string, now: number,
): Industry | null {
  const byYield = industryClaimValues(state, owner, now);
  let target: Industry | null = null, bestV = -1;
  for (const ind of state.grid.industries) {
    if (ind.banditUntil > now) continue;
    const v = byYield.get(ind.id);
    if (v === undefined) continue;
    if (v > bestV || (v === bestV && (target === null || ind.id < target.id))) {
      bestV = v; target = ind;
    }
  }
  if (target) return target;

  const inReach = new Set<number>();
  for (const h of state.harvesters) {
    if (h.owner !== owner) continue;
    for (const ind of industriesInCatchment(state.grid, h)) {
      if (ind.banditUntil <= now) inReach.add(ind.id);
    }
  }
  if (inReach.size) {
    let best: Industry | null = null;
    for (const ind of state.grid.industries) {
      if (ind.banditUntil > now || !inReach.has(ind.id)) continue;
      const def = INDUSTRY_BY_KEY[ind.type];
      const out = ind.output ?? def?.output ?? 0;
      if (!best || out > best.output || (out === best.output && ind.id < best.id)) best = ind;
    }
    if (best) return best;
  }

  const f = state.factories.find((x) => x.owner === owner);
  if (!f) return null;
  let near: Industry | null = null, bestD = Infinity;
  for (const ind of state.grid.industries) {
    if (ind.banditUntil > now) continue;
    const d = Math.abs(ind.tx - f.tx) + Math.abs(ind.ty - f.ty);
    if (d < bestD || (d === bestD && (near === null || ind.id < near.id))) {
      bestD = d; near = ind;
    }
  }
  return near;
}

// ── VP: award on completion, revoke on break ──────────────────────────────
export interface VpEvent {
  harvester: number;
  type: "awarded" | "revoked" | "upgraded" | "downgraded";
  from: ConnKind;
  to: ConnKind;
  delta: number;
}

export interface ScoreState {
  /** Per-harvester connection kind + owner at the last scoring. The owner is
   *  kept so a DEMOLISHED harvester can still be debited from the right
   *  player — by then it is gone from `state.harvesters`. */
  connections: Map<number, ConnKind>;
  owners: Map<number, string>;
  /** Per-owner VP total. */
  vp: Map<string, number>;
}

export const createScoreState = (): ScoreState => ({
  connections: new Map(), owners: new Map(), vp: new Map(),
});

const vpOf = (kind: ConnKind) => (kind === null ? 0 : TRANSPORT[kind].vp);

/**
 * Rescore every harvester and diff against the previous state. Call on every
 * build and demolish — not on a timer — so a break is reflected within one
 * frame. Returns the events the UI must surface: a revoked VP has to be
 * visible or players will not understand what happened.
 */
export function rescore(
  state: EconomyState, score: ScoreState,
): VpEvent[] {
  const events: VpEvent[] = [];
  const seen = new Set<number>();
  // W2: components are per-owner, and rescore walks every player's harvesters
  // in one pass — cache a component pair per track-owner id that shows up.
  const compByOwner = new Map<number, Components>();
  const compFor = (ownerId: number): Components => {
    let c = compByOwner.get(ownerId);
    if (!c) {
      c = buildAllComponents(state.track, ownerId);
      compByOwner.set(ownerId, c);
    }
    return c;
  };

  for (const h of state.harvesters) {
    seen.add(h.id);
    score.owners.set(h.id, h.owner);
    const from = score.connections.get(h.id) ?? null;
    const to = isServiced(state.track, h)
      ? resolveConnection(state, compFor(h.ownerId), h).kind
      : null;
    if (from === to) continue;
    const delta = vpOf(to) - vpOf(from);
    let type: VpEvent["type"];
    if (from === null) type = "awarded";
    else if (to === null) type = "revoked";
    else type = delta > 0 ? "upgraded" : "downgraded";
    events.push({ harvester: h.id, type, from, to, delta });
    score.connections.set(h.id, to);
    score.owners.set(h.id, h.owner);
    score.vp.set(h.owner, (score.vp.get(h.owner) ?? 0) + delta);
  }

  // A demolished harvester surrenders its VP too.
  for (const [id, kind] of [...score.connections]) {
    if (seen.has(id)) continue;
    if (kind !== null) {
      const owner = score.owners.get(id);
      events.push({ harvester: id, type: "revoked", from: kind, to: null, delta: -vpOf(kind) });
      if (owner !== undefined) score.vp.set(owner, (score.vp.get(owner) ?? 0) - vpOf(kind));
    }
    score.connections.delete(id);
    score.owners.delete(id);
  }
  return events;
}

export const vpFor = (score: ScoreState, owner: string) => score.vp.get(owner) ?? 0;
