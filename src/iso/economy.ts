// ══════════════════════════════════════════════════════════════════════════
// E6 — Stations, catchment and connection (throughput) scoring.
//
// Replaces vertex adjacency (hexmap's `playerResources`). This is the mechanic
// that makes the map matter:
//
//   harvester → 4×4 catchment → the industries IT HOLDS → output
//               × the transport multiplier of the connection to the Factory
//
// PP-16: "holds" is the exclusive claim — the first Depot with a road at an
// industry owns its output, and no second Depot may be built for it.
//
// A harvester must be adjacent to at least one road tile. Connection is a
// flood fill over the direction masks where a tile connects only if BOTH
// neighbours set the facing bit (E5's invariant), so half-piece bugs are
// impossible by construction.
//
// The two road tiers (gravel `dirt` and paved `road`) are ONE road surface:
// components are flooded over the merged masks, so a Dirt Road that reaches a
// paved tile — a built Road or a map highway/town road — is the same network.
// The paved tier beats dirt: any depot→factory connection whose component
// touches a paved tile the owner may drive takes the road multiplier; a
// pure-gravel connection stays on the basic one. If a paved connection breaks,
// the depot falls back to the surviving dirt link and loses the multiplier with
// it — one tile of tarmac anywhere on the component is enough to lift every
// depot that rides it, which is why paving (VP-01's scored action) is worth
// more than laying a new line of the same length.
//
// VP-01 took Victory Points out of this module: a connection is throughput
// only. The scoreboard reads the tiles (`victory.ts`).
// ══════════════════════════════════════════════════════════════════════════
import { roadPath, depotShoulders, plantShoulders } from "./road-routing";
import { DEFAULT_FACING, depotEntranceTiles, industriesTouchingDepot, type DepotFacing } from "./depot";
import { MAP_W, MAP_H } from "../game/config";
import { TRANSPORT, INDUSTRY_BY_KEY, type Cargo } from "./config";
import type { Grid, Industry } from "./grid";
import {
  DIRS, DIR, OPPOSITE, PRESENT, tIdx, inMapT, trackOpenTo, PUBLIC_OWNER,
  plantFootprintTiles, type Track, type TrackKind,
} from "./track";
// RAIL-04 (#178): the railway is a SOURCE of throughput, not a second economy.
// `railOpenTo` / `railServicedIndustries` are the rail module's own rules; this
// module only asks them the same question it asks the road tar.
import { railOpenTo, railServicedIndustries, type RailState } from "./rail";

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
  /** Footprint origin of the 2×2 lot (its top corner tile). */
  tx: number;
  ty: number;
  /** L4 yield level; absent on legacy saves/snapshots means baseline. */
  yield?: number;
  /**
   * Which EDGE of the 2×2 lot its entrance opens onto — the rotation it was
   * built in (`depot.ts`). Set when the Depot is placed; records written
   * before facings existed derive one from the map (`depotFacingOf`).
   */
  facing?: DepotFacing;
  /**
   * L6 (#220): the transport tier this Depot stood on when its last tuning
   * session settled (`loop.ts`'s `TRANSPORT_TIERS`). It is what makes Normal's
   * "one match per depot, one more per upgrade" a comparison instead of a
   * counter: a Depot whose link has moved ABOVE this tier owes a re-match, and
   * settling a session re-bases it.
   *
   * Optional because absent means "never tuned" — a legacy save, an old
   * snapshot, or a Depot built before this field existed — and no difficulty
   * grants a re-match to a Depot that has not had its first session. The tier ITSELF is never stored: it is derived from the track, so a save cannot invent
   * an upgrade the player never built.
   */
  tuneTier?: number;
}

/**
 * A processing site (the "Factory"/Processing Plant building).
 *
 * PP-06: a player may own MORE THAN ONE. Nothing in this module assumed a
 * single site — `resolveConnection` already walks every factory the owner has
 * and returns the ONE best connection for a depot, so a depot linked to two
 * plants still yields once. `id` and `townId`
 * are optional so the starting Factory (and old snapshots) stay valid.
 */
export interface Factory {
  owner: string;
  ownerId: number;
  tx: number;
  ty: number;
  /** PP-06: stable per-player plant id. 0 = the starting Factory. */
  id?: number;
  /** PP-06: the town this plant was raised beside (null = unknown/legacy). */
  townId?: number | null;
}

export interface EconomyState {
  grid: Grid;
  track: Track;
  harvesters: Harvester[];
  factories: Factory[];
  /**
   * RAIL-04 (#178): the railway, when the game has one. Optional on purpose —
   * the headless economy tests, the rival's sweep and any save written before
   * the railway existed build an `EconomyState` with no rails, and every rail
   * rule below reads as "no railway" rather than throwing.
   */
  rail?: RailState;
  /**
   * B5 (#250): the map's ONLY stored ownership — the industries a battle
   * CONQUERED (`industryId → holder harvester id`). First-come stays derived
   * everywhere else; a conquest stands until the next successful challenge.
   * Serialized with the economy (saves + the MP wire — the host owns it).
   */
  battleLocks?: Map<number, number>;
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

/**
 * Every industry a Depot serves: those whose footprint shares an EDGE with its
 * 2×2 lot, on any side (`depot.ts`). A truck depot is placed right beside the
 * resource — there is no catchment box any more.
 */
export function industriesInCatchment(grid: Grid, h: Harvester): Industry[] {
  return industriesTouchingDepot(grid, h.tx, h.ty).map((t) => t.industry);
}

/**
 * A harvester is only valid if it touches at least one road or rail tile
 * BUILT BY ITS OWN PLAYER (W2). The rival's road beside your harvester does
 * not service it — your depot needs your own line.
 *
 * PP-13: one exception — a PUBLIC highway tile counts, because those roads
 * are every player's to use. Parking a Depot beside the inter-town highway is
 * a legitimate opening, exactly as it would be beside your own road.
 */
export function isServiced(track: Track, h: Harvester, rail?: RailState | null): boolean {
  // The truck depot's gate: only its ENTRANCE tiles (outside the open edges)
  // connect it — a road against the closed side does not.
  for (const [nx, ny] of depotEntranceTiles(h.tx, h.ty, h.facing ?? DEFAULT_FACING)) {
    if (trackOpenTo(track, h.ownerId, nx, ny)) return true;
    // RAIL-04 (#178): the epic's clause — a running line gives a source THE
    // SAME reachability a basic road connection does. So a rail tile at the
    // Depot services it exactly as a Dirt Road tile would, and the Depot's
    // industries become claimable and deliverable over the railway.
    if (rail && railOpenTo(rail.rail, h.ownerId, nx, ny)) return true;
  }
  return false;
}

// ── connected components ──────────────────────────────────────────────────
/**
 * Component id per tile over the MERGED road surface, or -1, plus a per-id
 * "touches pavement" marker. Built in one O(tiles) pass and cached by the
 * caller; a rebuild is cheap and happens only on build or demolish. A tile
 * joins its neighbour's component only when both face each other, so a
 * one-sided bit never merges two networks.
 *
 * Gravel and tar are one road (`track.ts` autotiles the union mask): the
 * flood crosses whichever tier a tile carries, so a Dirt Road that reaches a
 * paved tile is the same component as the pavement — a Depot hooked to a
 * gravel feeder onto a highway is one network with the highway. `roadComp`
 * marks the components that contain at least one PAVED tile, which is what
 * the best-tier-on-path scoring reads (`resolveConnection`).
 *
 * W2: components are owner-scoped — the flood only crosses tiles owned by
 * `owner`, so a connected run of YOUR road and a connected run of the RIVAL's
 * road that touch each other are still two components, one per player. The
 * old "two players' networks are one shared graph" bug lives and dies here.
 *
 * PP-13/RV-03: the map's PUBLIC roads (highways AND the towns' ring roads) are
 * the one shared ground — either carries `PUBLIC_OWNER`, so it joins every
 * real player's components and a route may run over it. Owner 0 matches only
 * owner-0 tiles, which is nobody's network.
 */
export interface Components {
  /** Component id per tile over the merged road surface, -1 = no component. */
  comp: Int32Array;
  /**
   * Per component id: 1 when that component contains at least one PAVED tile
   * `owner` may drive (a built Road, or a map highway/town road). A pure
   * gravel component stays 0.
   */
  roadComp: Uint8Array;
}

export function buildComponents(track: Track, owner: number): Components {
  const comp = new Int32Array(MAP_W * MAP_H).fill(-1);
  const byte = (i: number) => track.dirt[i] | track.road[i];
  // The same rule `trackOpenTo` applies, inlined over the raw owner layer
  // because this flood works on flat indices, not tile coords.
  const usable = (i: number): boolean => (owner === 0
    ? track.owner[i] === 0
    : track.owner[i] === owner || track.owner[i] === PUBLIC_OWNER);
  let next = 0;
  const stack: number[] = [];
  for (let start = 0; start < comp.length; start++) {
    if ((byte(start) & PRESENT) === 0 || comp[start] !== -1) continue;
    if (!usable(start)) continue;
    const id = next++;
    comp[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      const bits = byte(i) & 0b1111;
      for (const d of DIRS) {
        if (!(bits & d)) continue;
        const nx = x + DIR[d][0], ny = y + DIR[d][1];
        if (!inMapT(nx, ny)) continue;
        if (!((byte(tIdx(nx, ny)) & OPPOSITE[d]) !== 0)) continue;  // mutual only
        const ni = tIdx(nx, ny);
        if (comp[ni] !== -1) continue;
        // W2: never cross the rival's line. PP-13: a public highway is fine.
        if (!usable(ni)) continue;
        comp[ni] = id;
        stack.push(ni);
      }
    }
  }
  const roadComp = new Uint8Array(next);
  for (let i = 0; i < comp.length; i++) {
    const c = comp[i];
    if (c >= 0 && (track.road[i] & PRESENT) !== 0) roadComp[c] = 1;
  }
  return { comp, roadComp };
}

/** The merged owner-scoped components (`buildComponents`). */
export const buildAllComponents = (track: Track, owner: number): Components =>
  buildComponents(track, owner);

/**
 * W2: resolve a player's numeric track-owner id from the string identity the
 * economy binds track to. Every structure a player builds carries the same id, so
 * the first one found is enough; a player with no structures has none (and
 * therefore no harvesters to connect).
 */
export const ownerIdOf = (state: EconomyState, owner: string): number =>
  state.harvesters.find((h) => h.owner === owner)?.ownerId
  ?? state.factories.find((f) => f.owner === owner)?.ownerId
  ?? 0;

/**
 * The components a set of tiles touches from any of their 4 neighbours. The
 * multi-tile form of `adjacentComponents`, and the reason it exists is
 * PP-15: a plant is a `FACTORY_FOOTPRINT` block under one sprite, so "beside
 * the Factory" means beside ANY tile of that block. Every question of the shape
 * "is this Depot joined to that plant" asks it through here or through
 * `plantShoulders`, so a road that touches the graphic's edge and a road that
 * touches the origin tile can never be scored differently.
 */
export function componentsTouchingTiles(
  comp: Int32Array, tiles: [number, number][],
): Set<number> {
  const out = new Set<number>();
  for (const [tx, ty] of tiles) {
    for (const c of adjacentComponents(comp, tx, ty)) out.add(c);
  }
  return out;
}

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
 * The components a Depot's ENTRANCE tiles carry — the networks its gate opens
 * onto. (The entrance tiles are track themselves, unlike the lot.)
 */
export function depotComponents(comp: Int32Array, h: Harvester): Set<number> {
  const out = new Set<number>();
  for (const [x, y] of depotEntranceTiles(h.tx, h.ty, h.facing ?? DEFAULT_FACING)) {
    const c = comp[tIdx(x, y)];
    if (c >= 0) out.add(c);
  }
  return out;
}

/**
 * The component ids both structures sit beside. Structures are not themselves
 * track, so we compare the components adjacent to each of the two tiles.
 *
 * VP-01 exports it: the rival's pave pass needs exactly this answer — which
 * components a Depot and a Plant BOTH sit on is what decides whether paving a
 * tile on that component lifts a live connection (×1.6) or only banks 0.25★.
 */
export function sharedComponents(
  comp: Int32Array, ax: number, ay: number, bx: number, by: number,
): Set<number> {
  return sharedComponentsWithTiles(comp, ax, ay, [[bx, by]]);
}

/**
 * `sharedComponents` with the B side widened to a list of tiles — the plant's
 * whole footprint. PP-15.
 */
export function sharedComponentsWithTiles(
  comp: Int32Array, ax: number, ay: number, bTiles: [number, number][],
): Set<number> {
  const A = adjacentComponents(comp, ax, ay);
  const out = new Set<number>();
  for (const c of componentsTouchingTiles(comp, bTiles)) if (A.has(c)) out.add(c);
  return out;
}

/**
 * Is `a` linked to `b` on the merged surface? Both must sit beside the SAME
 * connected component.
 */
export function linkedBy(
  comp: Int32Array, ax: number, ay: number, bx: number, by: number,
): boolean {
  return sharedComponents(comp, ax, ay, bx, by).size > 0;
}

// ── connection resolution ─────────────────────────────────────────────────
export type ConnKind = TrackKind | null;

/**
 * A depot's link to one of its owner's plants. VP-01 took the Victory Points
 * out of this and put them on the tiles (`victory.ts`): a connection is worth
 * THROUGHPUT, nothing else. `kind` still decides the tier the whole economy
 * turns on — `roadComp` in `buildComponents` is what makes one paved tile
 * anywhere on a component lift every depot using it to ×1.6.
 */
export interface Connection {
  kind: ConnKind;        // null = not connected to any factory
  multiplier: number;    // 1.0 dirt / 1.6 paved road / 0 unconnected
  factory: Factory | null;
}

export const NO_CONNECTION: Connection = {
  kind: null, multiplier: 0, factory: null,
};

/**
 * Resolve a harvester's connection to its owner's Factory over the MERGED
 * surface. Best tier on path wins: when a depot and a Factory both sit beside
 * the same component and that component touches ANY paved tile `owner` may
 * drive (a built Road, or the map's public/town roads), the connection takes
 * the paved tier's multiplier. That is the Dirt-Road-feeder rule:
 * hooking gravel onto a highway deliberately becomes a premium connection.
 * Only when no shared component contains pavement does a pure-gravel link
 * keep the basic multiplier.
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
  let shortest = Infinity;
  for (const f of mine) {
    // PP-15: the plant's whole footprint, not its origin tile — the block's
    // edge is where its road frontage is.
    // The Depot side is its gate (the entrance tiles' own components).
    const gate = depotComponents(comp.comp, h);
    const shared = new Set<number>();
    for (const c of componentsTouchingTiles(comp.comp, plantFootprintTiles(f.tx, f.ty))) {
      if (gate.has(c)) shared.add(c);
    }
    if (shared.size === 0) continue;
    for (const c of shared) {
      if (comp.roadComp[c]) {
        // a paved component is the ceiling — nothing beats it, stop looking
        return {
          kind: "road", multiplier: TRANSPORT.road.throughput, factory: f,
        };
      }
    }
    // pure-gravel component: keep the old dirt tier's shortest-factory tie-break
    const route = roadPath(state.track, h.ownerId,
      depotShoulders(state.track, h.ownerId, h),
      new Set(plantShoulders(state.track, h.ownerId, f.tx, f.ty).map(([x, y]) => tIdx(x, y))));
    if (!route || route.length >= shortest) continue;
    shortest = route.length;
    best = {
      kind: "dirt", multiplier: TRANSPORT.dirt.throughput, factory: f,
    };
  }
  return best;
}

// ── L3 (#217): road distance ──────────────────────────────────────────────
/**
 * The Depot's road distance — the SHORTEST run of road tiles from the Depot's
 * shoulder to the nearest owned plant's, over the owner's own + public track
 * (`trackOpenTo`) and crossing only mutual bits.
 *
 * This is the same graph the components flood and the lorry drives
 * (`roadDeliveryForHarvester` in vehicles.ts plans over exactly these
 * shoulders with the same `roadPath`), so the number the inspector prints,
 * the band the clock pays and the route the truck drives agree — except in
 * the multi-plant edge case, where the lorry serves `resolveConnection`'s
 * tier-preferred plant and this measures the NEAREST one (the spec's rule:
 * "path length in tiles from depot to the nearest owned factory/plant").
 * One BFS with every owned plant's shoulders as goals, so "nearest" is one
 * flood, not one per plant.
 *
 * Null when the Depot has no road route to any owned plant — unserviced, or
 * connected to nothing. The clock's `harvesterYield` gate already pays such a
 * Depot nothing, so the factor built on this is never a second gate.
 */
export function depotPathLength(state: EconomyState, h: Harvester): number | null {
  // the Depot's ENTRANCE is where its road meets the network (depot.ts)
  const from = depotShoulders(state.track, h.ownerId, h);
  if (from.length === 0) return null;
  const goals = new Set<number>();
  for (const f of state.factories) {
    if (f.owner !== h.owner) continue;
    for (const [x, y] of plantShoulders(state.track, h.ownerId, f.tx, f.ty)) {
      goals.add(tIdx(x, y));
    }
  }
  if (goals.size === 0) return null;
  const route = roadPath(state.track, h.ownerId, from, goals);
  return route ? route.length : null;
}

// ── claims: one Depot, one industry ───────────────────────────────────────
/**
 * PP-16: which Depot holds which industry.
 *
 * The rule this replaces was arithmetic: overlapping catchments SPLIT an
 * industry's output between every Depot that reached it, so a busy district
 * paid everyone a slice and nothing about a resource was ever decided by who
 * got there first. The map read as a spreadsheet instead of a race. It is now
 * exclusivity:
 *
 *   • a Depot HOLDS the industries in its catchment that no other Depot holds
 *     already — the FIRST one to have a road at the resource takes it, and no
 *     further Depot may be built for it (see `planDepotPlacement`'s
 *     "industry-taken" refusal, which is the same set read from the other side);
 *   • "a road at the resource" is `isServiced` — a Depot dropped on open ground
 *     claims nothing, because a Depot with no network behind it produces
 *     nothing and must not be able to sterilise a district for its owner's
 *     convenience. Its locks arrive with its road;
 *   • the map is DERIVED, never stored: demolish the road that serviced a Depot
 *     and every industry it held is free again, and a snapshot needs no new
 *     field. Harvester array order breaks ties, which is build order in the
 *     live game and list order in a save — deterministic either way.
 *
 * Blockades are deliberately NOT part of this: a blockaded industry still
 * belongs to whoever holds it (the blockade costs its HOLDER throughput, and
 * a rival's sabotage must not hand the district over).
 */
export function industryLocks(state: EconomyState): Map<number, Harvester> {
  const locks = new Map<number, Harvester>();
  for (const h of state.harvesters) {
    if (!isServiced(state.track, h, state.rail)) continue;
    for (const ind of industriesInCatchment(state.grid, h)) {
      if (!locks.has(ind.id)) locks.set(ind.id, h);
    }
  }
  // B5 (#250): a battle CONQUEST beats first-come — the winner's depot draws
  // the industry and the loser's stops, until the next successful challenge
  // flips it again. If the conqueror's depot is gone (demolished), the
  // conquest lapses and the derived map stands.
  if (state.battleLocks?.size) {
    for (const [indId, harvesterId] of state.battleLocks) {
      const h = state.harvesters.find((x) => x.id === harvesterId);
      if (h) locks.set(indId, h);
    }
  }
  return locks;
}

/** The industries `h` holds — its catchment minus what another Depot reached
 *  first. What `h` is PAID for, and the only reason a new Depot may be built. */
export function heldIndustries(
  state: EconomyState, h: Harvester, locks: Map<number, Harvester>,
): Industry[] {
  const out: Industry[] = [];
  for (const ind of industriesInCatchment(state.grid, h)) {
    const holder = locks.get(ind.id);
    if (holder === undefined || holder.id === h.id) out.push(ind);
  }
  return out;
}

/** Every industry a Depot already holds, as ids — the placement refusal's
 *  input (`planDepotPlacement`'s `locked` option). */
export function lockedIndustryIds(state: EconomyState): Set<number> {
  const out = new Set<number>();
  for (const id of industryLocks(state).keys()) out.add(id);
  return out;
}

/**
 * L5 (#219): the cargo a Depot harvests — its TYPE in the depot tree, and so
 * which row of `DEPOT_TREE` prices and gates it.
 *
 * The biggest producer the Depot HOLDS (catchment minus what another network
 * reached first — the same `heldIndustries` the clock pays by), with the tie
 * going to the first in id order. A Depot with no road yet holds nothing, and
 * then its catchment's industries answer for it: the resource it was built
 * beside is the resource it is FOR, whether or not the player has connected it
 * yet. `h` need not be in `state.harvesters` — a caller pricing a placement
 * passes the candidate and gets the type the click would buy.
 */
export function depotCargo(state: EconomyState, h: Harvester): Cargo | null {
  const held = heldIndustries(state, h, industryLocks(state));
  const list = held.length ? held : industriesInCatchment(state.grid, h);
  let best: Cargo | null = null;
  let bestOut = -1;
  for (const ind of list) {
    const def = INDUSTRY_BY_KEY[ind.type];
    if (!def) continue;
    const out = ind.output ?? def.output;
    if (out > bestOut) { bestOut = out; best = def.cargo; }
  }
  return best;
}

export type Yield = Partial<Record<Cargo, number>>;

export interface HarvesterYield {
  harvester: Harvester;
  connection: Connection;
  serviced: boolean;
  yields: Yield;
}

/**
 * Per-harvester output: everything the Depot HOLDS, at the multiplier of its
 * connection. A blockaded industry (`banditUntil > now`) produces nothing —
 * that rule carries over cleanly from the hex version. `comp` must be scoped
 * to `h.ownerId` (W2) and `locks` is `industryLocks(state)`.
 *
 * PP-16 removed the ÷claimants in here: an industry pays its holder in full,
 * because it now has exactly one.
 */
export function harvesterYield(
  state: EconomyState, comp: Components, locks: Map<number, Harvester>,
  h: Harvester, now: number,
): HarvesterYield {
  const serviced = isServiced(state.track, h, state.rail);
  const connection = serviced ? resolveConnection(state, comp, h) : NO_CONNECTION;
  const yields: Yield = {};
  if (!serviced || connection.kind === null) {
    return { harvester: h, connection, serviced, yields };
  }
  for (const ind of heldIndustries(state, h, locks)) {
    if (ind.banditUntil > now) continue;                 // blockaded
    const def = INDUSTRY_BY_KEY[ind.type];
    if (!def) continue;
    const amount = (ind.output ?? def.output) * connection.multiplier;
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
  const locks = industryLocks(state);
  const out: Yield = {};
  // All of one player's harvesters share a track-owner id, so one flood pair
  // serves the whole loop.
  const c = comp ?? buildAllComponents(state.track, ownerIdOf(state, owner));
  // RAIL-04: the industry ids a road Depot is ALREADY delivering, so the rail
  // pass below can skip them — the epic's "dedupe ids across road and rail".
  const byRoad = new Set<number>();
  for (const h of state.harvesters) {
    if (h.owner !== owner) continue;
    const y = harvesterYield(state, c, locks, h, now);
    if (y.serviced && y.connection.kind !== null) {
      for (const ind of heldIndustries(state, h, locks)) byRoad.add(ind.id);
    }
    for (const [cargo, v] of Object.entries(y.yields) as [Cargo, number][]) {
      out[cargo] = (out[cargo] ?? 0) + v;
    }
  }
  const railYields = railYield(state, owner, now, byRoad);
  for (const [cargo, v] of Object.entries(railYields) as [Cargo, number][]) {
    out[cargo] = (out[cargo] ?? 0) + v;
  }
  return out;
}

/**
 * RAIL-04 (#178): what one owner's RUNNING railway lines deliver, per cargo.
 *
 * The epic is precise about the value of a line: it grants the SAME source
 * reachability a basic road connection does, and no more — so every industry
 * whose platform is on a live line pays its output at the Dirt Road tier (v1
 * has no rail tiers to upgrade it to), and nothing is paid for a train that is
 * stored, blocked or still on its first departure (`railServicedIndustries`
 * enforces exactly that).
 *
 * `already` carries the industry ids a road Depot is delivering, so an industry
 * reached BOTH ways is paid once. Blockaded industries still produce nothing —
 * the same `banditUntil` rule the road path applies.
 */
export function railYield(
  state: EconomyState, owner: string, now: number, already?: ReadonlySet<number>,
): Yield {
  const rail = state.rail;
  if (!rail) return {};
  const ownerId = ownerIdOf(state, owner);
  if (ownerId === 0) return {};
  const out: Yield = {};
  for (const id of railServicedIndustries(rail, ownerId)) {
    if (already?.has(id)) continue;
    const ind = state.grid.industries.find((i) => i.id === id);
    if (!ind || ind.banditUntil > now) continue;    // blockaded: no output
    const def = INDUSTRY_BY_KEY[ind.type];
    if (!def) continue;
    const amount = (ind.output ?? def.output) * TRANSPORT.dirt.throughput;
    out[def.cargo] = (out[def.cargo] ?? 0) + amount;
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
  const locks = industryLocks(state);
  const comp = buildAllComponents(state.track, ownerId);
  for (const h of state.harvesters) {
    if (h.owner !== owner) continue;
    const y = harvesterYield(state, comp, locks, h, now);
    if (!y.serviced || y.connection.kind === null) continue;   // not paying yet
    for (const ind of heldIndustries(state, h, locks)) {
      if (ind.banditUntil > now) continue;    // already blockaded
      const def = INDUSTRY_BY_KEY[ind.type];
      if (!def) continue;
      const v = (ind.output ?? def.output) * y.connection.multiplier;
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

// ── victory points ────────────────────────────────────────────────────────
// VP-01 moved the scoreboard out of this module: a CONNECTION no longer earns
// anything, so nothing here needs a `ScoreState`. What the tiles and the plants
// are worth is `victory.ts`'s business, and `game.ts` calls `rescore` there on
// exactly the same build/demolish beats it calls `syncWorld` on.
