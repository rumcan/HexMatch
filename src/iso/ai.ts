// ══════════════════════════════════════════════════════════════════════════
// E7 — Isometric AI: industry scoring + A* auto-routing.
// VP-01 — the rival plays the victory condition, not just the map.
//
// Replaces ai.ts's `findLegalSettlement` / `findLegalRoad`, which were vertex
// and edge based and do not survive the migration.
//
// Behaviour, one turn at a time:
//
//   1. PLANT first (`plants.ts` picks the town) — 1★ for the price of four
//      paves, and it widens the map the rival's depots can deliver to.
//   2. DEPOT next: score every reachable industry by the YIELD it switches on
//      — output, diluted by the depots already sharing it, weighted by what the
//      cargo BUYS, and boosted by how badly the purse lacks it — over the cost
//      of the track that reaches it. Then A* a path and place the Depot.
//   3. PAVE last, with whatever Ore is left: `planUpgrades` spends the rival's
//      gravel on the 0.25★-per-tile upgrade, one tile per live gravel link
//      first (that single tile flips the whole connection to ×1.6) and then the
//      rest of its network for the points.
//
// Why routes are laid in DIRT and paved afterwards, which is VP-01's whole
// strategic point: `dirt` (1 Wood + 1 Stone) then a pave (4 Ore) costs exactly
// what a fresh `road` tile costs (1 + 1 + 4) and, unlike it, pays 0.25★. The
// old paved-first preference was chasing 3 VP per connection that no longer
// exists, so `planCandidates` now routes on the cheap tier and the pave pass
// buys the premium. `preferPaved: true` still asks for the old order.
//
// W8: a plan is only ever offered when it can be CARRIED OUT — every tile of
// the path is legal ground for its transport kind, and the harvester it ends
// at is serviced once that track is laid (`planFeasibility`). The paved Road
// therefore falls through to Dirt when paving is impossible rather than
// deadlocking on it, a turn that would achieve nothing is reported as no turn
// at all, and the rival's factory is placed on ground it can build from
// (`chooseRivalFactorySpot`).
//
// A* is deliberate HERE and nowhere else. E5 keeps auto-routing out of the
// player's hands because it produces paths they did not intend and hides cost;
// for the AI's own network nobody is surprised by it.
//
// Cost function (from the spec):
//     1     per flat tile
//     3     per rough tile
//     0.3×  for tiles already carrying the AI's own network — so it reuses
//           trunk lines instead of building parallel spurs
//     impassable: water and industry footprints
//
// Everything is deterministic under an injected RNG so T1 can assert on it.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../game/config";
import {
  TRANSPORT, UPGRADE_COST, INDUSTRY_BY_KEY, FACTORY_FOOTPRINT, VICTORY, type Cargo,
} from "./config";
import { DEPOT_COST, FREE_SETUP_DEPOTS, priceDepot } from "./construction";
import { ROUGH, factoryTouchesTown, type Grid, type Industry } from "./grid";
import {
  DIRS, DIR, tIdx, inMapT, hasTrack, canBuildOn, canAfford, tileCost, addCost,
  buildTile, trackOpenTo, tileAlreadyCarries, freeAllowanceCovers, playerNetwork,
  PUBLIC_OWNER,
  type Track, type TrackKind, type Purse,
} from "./track";
import {
  catchmentRect, rectContains, isServiced, industriesInCatchment, claimantCounts,
  buildAllComponents, resolveConnection, sharedComponents,
  type EconomyState, type Harvester, type Factory,
} from "./economy";

// ── terrain cost ──────────────────────────────────────────────────────────
export const COST_FLAT = 1;
export const COST_ROUGH = 3;
export const COST_OWNED = 0.3;      // multiplier, not an absolute
export const IMPASSABLE = Infinity;

/**
 * Cost of routing `kind` across one tile. Water and industry footprints are
 * impassable; the premium paved Road additionally cannot cross rough ground.
 *
 * W2: the trunk-line discount applies only to track the AI itself built
 * (`owner`). Passing 0 keeps the legacy "any track is discounted" behaviour
 * the unit tests use with unowned maps; the live game passes the AI's real
 * id, so the AI can never cheat its routing across the player's road.
 *
 * AI-01: two refinements to that rule, both from watching the live rival walk
 * gravel straight past the map's paved inter-town highways:
 *
 *   - shared ground discounts like its own trunk. A plan CAN ride the public
 *     highways (`trackOpenTo` — the economy's floods, the depot's servicing
 *     rule and the drag's `playerNetwork` all already say so), `tileCost`
 *     charges nothing for a tile that already carries the plan, and
 *     `buildTile` refuses to re-stamp public tiles. So the highway is a
 *     discountable trunk line exactly like the rival's own road — without the
 *     discount the A* walked BESIDE it at full price, and the main roads
 *     were invisible to the one planner they were drawn for.
 *   - the OTHER player's track is impassable. The rival's network can never
 *     ride it (W2's owner-scoped floods), and building over it is a no-op at
 *     best (dirt over paved refuses) and tile theft at worst (a paved plan
 *     over the player's gravel would re-stamp its owner on a
 *     `tileCost`-charged tile). Before, a plan that "crossed" the player's
 *     road could price a harvester as serviced on track the depots could not
 *     reach back to the plant from. `owner === 0` keeps the legacy behaviour
 *     the unit tests pin.
 */
export function stepCost(
  grid: Grid, track: Track, kind: TrackKind, tx: number, ty: number, owner: number = 0,
): number {
  // Use the build rule itself: town tiles (TOWN_OCC = -2) block routes too.
  if (!canBuildOn(grid, kind, tx, ty)) return IMPASSABLE;
  const i = tIdx(tx, ty);
  // AI-01: never plan over the other player's line (see above).
  if (owner !== 0) {
    const held = track.owner[i];
    if (held !== 0 && held !== owner && held !== PUBLIC_OWNER) return IMPASSABLE;
  }
  const terrain = grid.terrain[i];
  let c = terrain === ROUGH ? COST_ROUGH : COST_FLAT;
  // reuse our own trunk lines rather than building parallel spurs
  const own = owner === 0 ? true : track.owner[i] === owner;
  // AI-01: …and the map's public roads ride as shared trunk lines.
  const shared = owner !== 0 && track.owner[i] === PUBLIC_OWNER;
  // VP-01: "already carries it" is the MERGED question, not the same-tier one.
  // A dirt plan over the rival's own tarmac needs no build there (and
  // `tileCost` charges 0 for it), so the discount has to apply — otherwise
  // every tile the pave pass upgrades makes the next route look more expensive
  // than it is, and the rival answers its own paved trunk with a parallel
  // gravel spur. The reverse still holds: a paved plan over gravel pays
  // `UPGRADE_COST`, so it earns no discount (that is `tileAlreadyCarries`).
  if ((own || shared) && tileAlreadyCarries(track, kind, tx, ty)) c *= COST_OWNED;
  return c;
}

// ── A* ────────────────────────────────────────────────────────────────────
/** Manhattan distance — admissible, because the cheapest step costs 0.3. */
const heuristic = (ax: number, ay: number, bx: number, by: number) =>
  (Math.abs(ax - bx) + Math.abs(ay - by)) * COST_OWNED;

export interface Path {
  tiles: [number, number][];
  cost: number;
}

/**
 * A* from (ax,ay) to (bx,by) over the 4 diamond directions. The goal tile is
 * allowed to be impassable-adjacent: pass `adjacentTo` to stop as soon as the
 * frontier touches a tile orthogonally next to the goal, which is what you
 * want when routing to an industry footprint you cannot build on.
 *
 * Deterministic: ties are broken by tile index, never by insertion order.
 */
export function findPath(
  grid: Grid, track: Track, kind: TrackKind,
  ax: number, ay: number, bx: number, by: number,
  adjacentTo = false, owner: number = 0,
): Path | null {
  if (!inMapT(ax, ay) || !inMapT(bx, by)) return null;
  const start = tIdx(ax, ay);
  const goal = tIdx(bx, by);

  const gScore = new Map<number, number>([[start, 0]]);
  const cameFrom = new Map<number, number>();
  // T4: on 48×48 a linearly scanned open array was fine, but A* is O(V²) with
  // it and the 144×144 map made every rival turn take ~15 s. A binary heap
  // ordered (lowest f, ties by lowest tile index) reproduces the exact pop
  // order of that scan, so paths are byte-identical, in O(V log V).
  const open = new OpenHeap();
  const fScore = new Map<number, number>([[start, heuristic(ax, ay, bx, by)]]);
  open.push(start, fScore.get(start)!);
  const closed = new Set<number>();

  const isGoal = (i: number) => {
    if (i === goal) return true;
    if (!adjacentTo) return false;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    return Math.abs(x - bx) + Math.abs(y - by) === 1;
  };

  while (open.size) {
    // deterministic pop: lowest f, ties by lowest tile index; skip entries
    // left behind when a node's f was later improved, or already closed.
    let cur = -1;
    for (;;) {
      if (!open.size) break;
      const e = open.pop();
      if (closed.has(e.i)) continue;
      if (e.f !== (fScore.get(e.i) ?? Infinity)) continue;   // stale
      cur = e.i;
      break;
    }
    if (cur === -1) break;
    if (isGoal(cur)) {
      const tiles: [number, number][] = [];
      let n: number | undefined = cur;
      while (n !== undefined) {
        tiles.push([n % MAP_W, (n / MAP_W) | 0]);
        n = cameFrom.get(n);
      }
      tiles.reverse();
      return { tiles, cost: gScore.get(cur) ?? 0 };
    }
    closed.add(cur);
    const cx = cur % MAP_W, cy = (cur / MAP_W) | 0;
    for (const d of DIRS) {
      const nx = cx + DIR[d][0], ny = cy + DIR[d][1];
      if (!inMapT(nx, ny)) continue;
      const ni = tIdx(nx, ny);
      if (closed.has(ni)) continue;
      // the goal itself may be unbuildable when we only need to reach beside it
      const c = stepCost(grid, track, kind, nx, ny, owner);
      if (!isFinite(c) && !(ni === goal && adjacentTo)) continue;
      const tentative = (gScore.get(cur) ?? Infinity) + (isFinite(c) ? c : 0);
      if (tentative >= (gScore.get(ni) ?? Infinity)) continue;
      cameFrom.set(ni, cur);
      gScore.set(ni, tentative);
      const nf = tentative + heuristic(nx, ny, bx, by);
      fScore.set(ni, nf);
      open.push(ni, nf);
    }
  }
  return null;
}

/**
 * Min-heap of tile indices ordered by (f, index) so `pop` yields the same node
 * the old linear "lowest f, ties lowest index" scan did. The caller discards
 * stale entries after an f-improvement. Only backs `findPath`.
 */
interface OpenEntry { i: number; f: number }
class OpenHeap {
  private a: OpenEntry[] = [];   // heap-ordered by (f, then tile index)
  get size(): number { return this.a.length; }
  private less(x: OpenEntry, y: OpenEntry): boolean {
    return x.f < y.f || (x.f === y.f && x.i < y.i);
  }
  push(i: number, f: number): void {
    const a = this.a;
    a.push({ i, f });
    let c = a.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.less(a[c], a[p])) { [a[c], a[p]] = [a[p], a[c]]; c = p; } else break;
    }
  }
  pop(): OpenEntry {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let p = 0;
      for (;;) {
        const l = 2 * p + 1, r = l + 1;
        let m = p;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === p) break;
        [a[p], a[m]] = [a[m], a[p]];
        p = m;
      }
    }
    return top;
  }
}

// ── candidate scoring ─────────────────────────────────────────────────────
/**
 * Scarcity of a cargo in the AI's stock. Rarer cargo scores higher, and a
 * cargo it holds none of is the most valuable thing on the board.
 */
export const scarcity = (stock: Purse, cargo: Cargo): number =>
  1 / (1 + (stock[cargo] ?? 0));

/**
 * VP-01: what one unit of a cargo is WORTH to the rival, now that points come
 * from paving rather than from connecting. This is the whole strategic
 * difference in one table:
 *
 *   ore   the pave currency — 4 Ore is one 0.25★ tile, and Ore buys nothing
 *         else any more (routes are laid in dirt), so an ore mine IS the
 *         victory point source
 *   oil   every Depot after the first (`DEPOT_COST`)
 *   gold  Black Market sabotage — keeps the rival able to hit back
 *   grain Depot + plant workforce
 *   wood/stone  the Dirt Road the whole economy is built on, and the baseline
 *         everything else is compared against
 *
 * It MULTIPLIES the scarcity term rather than replacing it, so "I have none of
 * this" still outranks "I have some of that" and a rival with an empty purse
 * still goes for the cargo it lacks most (the behaviour the E7 tests pin).
 */
export const CARGO_VALUE: Record<Cargo, number> = {
  ore: 1.7, oil: 1.4, gold: 1.3, grain: 1.15, stone: 1.0, wood: 1.0,
};

/**
 * What a Depot at (tx,ty) would switch on: every industry in its catchment,
 * at its output, diluted by the depots already sharing it, weighted by cargo
 * value and scarcity.
 *
 * The dilution is the new part and it is the rival's biggest single fix. The
 * old score read `industry.output`, so an industry already covered by one of
 * the AI's own depots looked exactly as attractive as an untouched one, and
 * the rival kept spending its last tiles on a second link to the same farm
 * (overlap splits the yield, so the second link earns half and costs full
 * track). `claimantCounts` is the same share arithmetic `harvesterYield` pays
 * by, so the plan is priced on the economy's own numbers, not a guess.
 */
/**
 * VP-01: `oreUrgency` scales how much an Ore Mine is worth, and nothing else.
 * Default 1 keeps the economy's own ranking; a rival that is behind on the
 * scoreboard raises it, because Ore is the only cargo that buys points. It is a
 * multiplier on `CARGO_VALUE.ore` rather than a second formula so there is one
 * place where "what is a depot worth" is decided.
 */
export function catchmentValue(
  state: EconomyState, counts: Map<number, number>, stock: Purse,
  tx: number, ty: number, now = 0, oreUrgency = 1,
): number {
  const probe = { id: -1, owner: "", ownerId: 0, tx, ty } as Harvester;
  let v = 0;
  for (const ind of industriesInCatchment(state.grid, probe)) {
    if (ind.banditUntil > now) continue;              // blockaded: it pays nothing
    const def = INDUSTRY_BY_KEY[ind.type];
    if (!def) continue;
    const claimants = (counts.get(ind.id) ?? 0) + 1;  // +1 for this new depot
    const weight = def.cargo === "ore"
      ? CARGO_VALUE.ore * oreUrgency
      : CARGO_VALUE[def.cargo];
    v += ((ind.output ?? def.output) / claimants)
      * weight * (1 + scarcity(stock, def.cargo));
  }
  return v;
}

export interface Candidate {
  industry: Industry;
  /** Tile the harvester would occupy — adjacent to the industry footprint. */
  hx: number;
  hy: number;
  path: Path;
  kind: TrackKind;
  cost: Purse;
  score: number;
  /** VP-01: the yield this Depot switches on, before the route cost divides
   *  it out (`catchmentValue`). Exposed so a test can read WHY a plan won. */
  value: number;
}

/** Tiles orthogonally adjacent to an industry's footprint, in a stable order. */
export function harvesterSpots(grid: Grid, ind: Industry): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<number>();
  for (let y = ind.ty - 1; y <= ind.ty + ind.h; y++) {
    for (let x = ind.tx - 1; x <= ind.tx + ind.w; x++) {
      if (!inMapT(x, y)) continue;
      const insideX = x >= ind.tx && x < ind.tx + ind.w;
      const insideY = y >= ind.ty && y < ind.ty + ind.h;
      if (insideX && insideY) continue;                 // on the footprint
      if (!insideX && !insideY) continue;               // diagonal corner
      const i = tIdx(x, y);
      if (seen.has(i)) continue;
      if (!canBuildOn(grid, "dirt", x, y)) continue;   // basic road: legal land incl. rough
      seen.add(i);
      out.push([x, y]);
    }
  }
  return out;
}

/**
 * Every tile of the AI's existing network, plus its factory, as path sources.
 * W2: only track the AI itself built counts as "its network" — the player's
 * road no longer makes the AI believe it is already connected (the W3
 * "rival never builds" deadlock), and the AI's routing starts from its own
 * trunk lines, never from yours.
 *
 * VP-01: `kind` no longer filters the layer. The two tiers are ONE road, and a
 * plan of either tier may start from a tile that already carries it (see
 * `tileAlreadyCarries`), so a rival that has paved its trunk still sees that
 * trunk as a source — before this, `hasTrack(track, "dirt", …)` went quiet
 * exactly in proportion to how well the rival had paved, and it started
 * planning from its factory again.
 *
 * AI-01: the network is bigger than what it PAID for. The drag grows the
 * player's road from `playerNetwork` — own track PLUS every public highway
 * tile reachable from its structures — and plans are nothing but the rival's
 * answer to the same question, so its sources have to be the same set: a
 * highway the rival can already drive from is where its next spur starts.
 * The reachability flood is seeded from the factory (the one structure every
 * plan has to end up connected to), so a public tile that cannot reach the
 * plant is never a source — the spur it would start is one of nothing.
 * `owner === 0` keeps the legacy "any track tile" answer the unit tests pin;
 * a neutral flood admits no public ground at all.
 */
export function networkTiles(track: Track, kind: TrackKind, factory: Factory): [number, number][] {
  void kind;
  const out: [number, number][] = [];
  const owner = factory.ownerId;
  const net = owner === 0 ? null : playerNetwork(track, owner, [factory], []);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!hasTrack(track, "dirt", x, y) && !hasTrack(track, "road", x, y)) continue;
      const i = tIdx(x, y);
      if (owner !== 0 && track.owner[i] !== owner) {
        // AI-01: shared ground counts when — and only when — the rival's
        // network reaches it; the other player's tiles never do.
        if (track.owner[i] !== PUBLIC_OWNER || !net!.has(i)) continue;
      }
      out.push([x, y]);
    }
  }
  if (!out.length) out.push([factory.tx, factory.ty]);
  return out;
}

/** The nearest network tile to a target, by Manhattan distance then index. */
export function nearestSource(
  sources: [number, number][], tx: number, ty: number,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (const [x, y] of sources) {
    const d = Math.abs(x - tx) + Math.abs(y - ty);
    if (d < bestD || (d === bestD && best && (tIdx(x, y) < tIdx(best[0], best[1])))) {
      best = [x, y]; bestD = d;
    }
  }
  return best;
}

// ── W8: is the plan executable, and does it achieve anything? ─────────────
/**
 * What a candidate's path would ACTUALLY do once `executeCandidate` runs it.
 *
 * `executeCandidate` skips tiles it cannot build, so a plan priced over a path
 * that crosses unbuildable ground is not the plan that gets built — and a plan
 * that lays nothing and services nothing is a silent no-op the caller cannot
 * tell from a real turn. That was the W8 deadlock: a rival whose factory stood
 * on rough ground was handed a one-tile "path" (its own factory tile) by the
 * paved-first pass, `path.cost` 0 divided by the 0.3 floor made it outrank
 * every real build, paving is illegal on rough so nothing was laid, and the
 * outcome object was still truthy — so `aiTick` spent the turn and re-picked
 * the same doomed candidate every 9 s for the rest of the match.
 *
 * Two properties make a candidate worth returning:
 *   executable — every tile of the path is legal ground for `kind`. The
 *                premium paved Road cannot cross rough
 *                (`TRANSPORT.road.onRough === false`), so a paved plan from a
 *                factory standing on rough is not a plan at all; rejecting it
 *                is what lets the caller fall through to dirt instead of
 *                stalling on paving.
 *   serviced   — once the path is laid, the harvester touches track owned by
 *                `ownerId`, either already standing or laid by this plan.
 *                `isServiced` only looks at the harvester's four NEIGHBOURS,
 *                so track laid on the harvester's own tile does not count: the
 *                degenerate "build one tile under the factory" plan yields no
 *                harvester either, and the tiles it lays lead nowhere.
 *
 * `viable` is the two together, and it is what `planCandidates` filters on. A
 * viable candidate always achieves something: either it lays ≥1 tile, or it
 * lays nothing because the trunk already runs beside an uncovered industry and
 * the turn simply places the harvester — a free turn worth taking, and never a
 * no-op. A plan that would lay tiles but land no harvester is rejected: the
 * path always ends AT the harvester spot, so the only shape that plan can have
 * is the one-tile build under the depot, which is pure waste.
 */
export interface PlanFeasibility {
  /** Path tiles that would be newly laid: legal ground, not already `kind`. */
  fresh: [number, number][];
  /** Every tile of the path is buildable for `kind`. */
  executable: boolean;
  /** The harvester at (hx,hy) is serviced once the path is laid. */
  serviced: boolean;
  /** `executable && serviced` — the turn is real, never a no-op. */
  viable: boolean;
}

export function planFeasibility(
  state: EconomyState, kind: TrackKind, path: Path, hx: number, hy: number, ownerId: number,
): PlanFeasibility {
  const { grid, track } = state;
  const fresh: [number, number][] = [];
  const freshIdx = new Set<number>();
  let executable = true;
  for (const [x, y] of path.tiles) {
    if (!canBuildOn(grid, kind, x, y)) { executable = false; continue; }
    if (hasTrack(track, kind, x, y)) continue;      // already ours: nothing to lay
    fresh.push([x, y]);
    freshIdx.add(tIdx(x, y));
  }
  let serviced = false;
  for (const d of DIRS) {
    const nx = hx + DIR[d][0], ny = hy + DIR[d][1];
    if (!inMapT(nx, ny)) continue;
    // Standing track of EITHER layer that is open to us services the depot
    // (W2 — ours, or a public highway, which is what `isServiced` checks too,
    // so this probe and the rule it predicts can never disagree)…
    if (trackOpenTo(track, ownerId, nx, ny)) { serviced = true; break; }
    // …and so does track this very plan lays beside it.
    if (freshIdx.has(tIdx(nx, ny))) { serviced = true; break; }
  }
  return { fresh, executable, serviced, viable: executable && serviced };
}

export interface PlanOptions {
  /** Cargo the AI already holds — drives scarcity. */
  stock: Purse;
  /** What it can spend. */
  purse: Purse;
  /**
   * W3: free-track allowance (the AI's `freeTrack`), applied with the SAME
   * cost model as the human's drag preview (`previewDrag`): the first
   * `free` new tiles ride free, `cost` counts only the rest. Without this
   * the AI "sees" a 12-tile build it can't pay for and stands still even
   * though its setup allowance would cover it.
   *
   * W9: the allowance buys DIRT (basic) only, here exactly as in `previewDrag` —
   * the rival is gated behind an ore mine before it can pave premium Road
   * just like the player is (E8).
   */
  free?: number;
  /**
   * PP-05: the AI's remaining free-DEPOT allowance (`freeDepots` in game.ts) —
   * the building twin of `free`. While it lasts the Depot the plan ends at is
   * free; once it is gone the plan must afford `DEPOT_COST` (Oil included) on
   * top of its track, exactly as the human's click must. Omitted means 0, i.e.
   * a paid Depot: the allowance is data the caller owns, never a guess here.
   */
  freeDepots?: number;
  /**
   * VP-01: ask for the OLD paved-first ordering (a Road plan whenever it can be
   * afforded, dirt only as a fallback). Default OFF, and that default is the
   * strategy change: routing a fresh line in `road` pays the same 4 Ore the
   * dirt-then-pave route pays, but only the second one scores (the pave is what
   * `victory.ts` counts), so the rival lays gravel now and paves with
   * `planUpgrades` in the same turn.
   */
  preferPaved?: boolean;
  /**
   * VP-01: multiplier on the value of Ore-bearing industries (see
   * `catchmentValue`). Raised by `rivalPace` when the rival is losing the
   * race to 10★ — the point of "reacts to the player's lead" is that the
   * rival's DEPOT choice changes, not only its spending.
   */
  oreUrgency?: number;
  /**
   * Wall time used to skip blockaded industries when valuing a catchment.
   * Omitted = 0, i.e. nothing is blockaded, which is what the pure planning
   * tests want; `game.ts` passes the live clock so the rival stops planning
   * around an industry a Blockade has just shut.
   */
  now?: number;
}

/** Optimistic new-tile allowance; exact mixed upgrade prices are checked after A*. */
function affordableNewTiles(kind: TrackKind, purse: Purse, free: number): number {
  let n = Infinity;
  for (const [cargo, amount] of Object.entries(TRANSPORT[kind].cost)) {
    // An in-place pave (paved Road over dirt) may omit a resource (stone) the
    // plan would otherwise demand; never overestimate that cost for the paved tier.
    const unit = kind === "road" ? Math.min(amount, UPGRADE_COST[cargo as Cargo] ?? 0) : amount;
    if (unit > 0) n = Math.min(n, Math.floor((purse[cargo as Cargo] ?? 0) / unit));
  }
  return n + (freeAllowanceCovers(kind) ? Math.ceil(Math.max(0, free)) : 0);
}

/**
 * Score every reachable industry and return the candidates best first.
 * Deterministic: equal scores break by industry id.
 *
 * VP-01 ranking: `catchmentValue ÷ path cost` — the yield a Depot switches on
 * (diluted by the depots already sharing each industry, weighted by what the
 * cargo buys in a pave-for-points economy) over the track it has to lay to get
 * there. The old formula scored `scarcity × industry output`, which could not
 * tell a second link to a covered farm from a first link to an untouched one.
 *
 * W8: a candidate is only returned when its plan is VIABLE — every path tile
 * is legal ground for the transport kind, and the harvester the path ends at
 * is serviced once that track is laid (see `planFeasibility`). Because
 * unbuildable paved plans are rejected here rather than ranked, the tier
 * preference genuinely falls through to the other tier when it cannot be built
 * — not only when it produces nothing at all — and a turn is never spent on a
 * plan that builds nothing.
 */
export function planCandidates(
  state: EconomyState, factory: Factory, opts: PlanOptions,
): Candidate[] {
  const { grid, track } = state;
  const out: Candidate[] = [];
  const claimed = new Set(state.harvesters.map((h) => tIdx(h.tx, h.ty)));
  const free = Math.max(0, opts.free ?? 0);
  // VP-01: one claimant map for the whole ranking pass — the same arithmetic
  // `harvesterYield` pays by, read once rather than re-derived per candidate.
  const counts = claimantCounts(state);
  const now = opts.now ?? 0;
  // PP-05: every candidate ends at a NEW Depot, so the Depot's own price is
  // part of what the plan must afford. Priced by the same `priceDepot` the
  // human click and the HUD use — one table, one rule, no rival-only discount.
  const depotCost = priceDepot(opts.purse, opts.freeDepots ?? 0).cost;

  // VP-01: dirt first. A paved route on virgin ground costs the same ore as
  // gravel now and gravel-then-pave later, and only the pave scores, so the
  // cheap tier is also the right tier; `preferPaved` opts into the old order.
  const kinds: TrackKind[] = opts.preferPaved === true ? ["road", "dirt"] : ["dirt", "road"];
  for (const kindPref of kinds) {
    const sources = networkTiles(track, kindPref, factory);
    // T4: reject provably unaffordable destinations BEFORE running A*. On
    // the larger map, searching hundreds of long paved routes with zero ore
    // blocked the UI for seconds. This is only a lower bound; the real path
    // and tileCost check below still decide which candidates are affordable.
    // A path's final segment starts at its last existing track tile (of ANY
    // owner, since tileCost charges neither), or at the factory with no track.
    // Its Manhattan length is a lower bound on the number of new tiles.
    const existing = networkTiles(track, kindPref, { ...factory, ownerId: 0 });
    const maxFresh = affordableNewTiles(kindPref, opts.purse, free);
    for (const ind of grid.industries) {
      const def = INDUSTRY_BY_KEY[ind.type];
      if (!def) continue;
      // skip industries already covered by one of our own harvesters
      const covered = state.harvesters.some((h) =>
        h.owner === factory.owner
        && rectContains(catchmentRect(h.tx, h.ty), ind.tx, ind.ty));
      if (covered) continue;

      for (const [hx, hy] of harvesterSpots(grid, ind)) {
        if (claimed.has(tIdx(hx, hy))) continue;
        const src = nearestSource(sources, hx, hy);
        if (!src || !canBuildOn(grid, kindPref, src[0], src[1]) || !canBuildOn(grid, kindPref, hx, hy)) continue;
        const last = nearestSource(existing, hx, hy)!;
        const minFresh = Math.min(
          Math.abs(factory.tx - hx) + Math.abs(factory.ty - hy) + 1,
          Math.abs(last[0] - hx) + Math.abs(last[1] - hy) + (hasTrack(track, kindPref, last[0], last[1]) ? 0 : 1),
        );
        if (minFresh > maxFresh) continue;
        // W2: route with the AI's own trunk discount, not the player's road.
        const path = findPath(grid, track, kindPref, src[0], src[1], hx, hy, false, factory.ownerId);
        if (!path) continue;
        // W8: refuse plans `executeCandidate` could not carry out as priced —
        // paving over rough, or a one-tile "path" that lays track under the
        // depot and leaves it unserviced. The next spot / the next kind is
        // tried, so a paved plan that cannot be built falls through to dirt.
        if (!planFeasibility(state, kindPref, path, hx, hy, factory.ownerId).viable) continue;

        // W3: same cost model as the human preview — the allowance covers the
        // first new tiles, the purse pays the rest. W9: …and only for dirt; a
        // paved plan prices every tile, so the rival needs real ore to pave.
        let cost: Purse = {};
        let freeLeft = freeAllowanceCovers(kindPref) ? free : 0;
        for (const [x, y] of path.tiles) {
          const c = tileCost(track, kindPref, x, y);
          if (Object.keys(c).length === 0) continue;
          if (freeLeft > 0) { freeLeft--; continue; }
          cost = addCost(cost, c);
        }
        // PP-05: track + Depot, or the plan is not a plan — a candidate the
        // purse cannot finish would place a Depot its caller cannot pay for.
        if (!canAfford(opts.purse, addCost(cost, depotCost))) continue;

        // VP-01: value the DEPOT, not the industry — the tile's 4×4 catchment
        // is what harvests, and on a multi-tile footprint that is usually more
        // than the one industry A* happened to route to.
        const value = catchmentValue(state, counts, opts.stock, hx, hy, now, opts.oreUrgency ?? 1);
        const score = value / Math.max(0.3, path.cost);
        out.push({ industry: ind, hx, hy, path, kind: kindPref, cost, score, value });
        break;   // one spot per industry is enough — the cheapest we found
      }
    }
    // W8: `out` only ever holds viable candidates, so a
    // non-empty list means this transport kind really can build — breaking
    // here is safe, and an empty list (e.g. every rail plan crossed rough)
    // falls through to road rather than ending the turn with nothing.
    if (out.length) break;
  }

  out.sort((a, b) =>
    b.score - a.score
    || a.industry.id - b.industry.id
    || tIdx(a.hx, a.hy) - tIdx(b.hx, b.hy));
  return out;
}

export const bestCandidate = (
  state: EconomyState, factory: Factory, opts: PlanOptions,
): Candidate | null => planCandidates(state, factory, opts)[0] ?? null;

// ── AI-01: deep-purse planning, memoized ──────────────────────────────────
/**
 * `planCandidates` under a hypothetical bottomless purse, with the answer
 * cached against the world it was computed from.
 *
 * The bank's stall turn and the market offer both ask the same question —
 * "what would the rival build next if money were no object" — and it is an
 * expensive one: with affordability lifted, NOTHING prunes the search, so
 * every industry × every depot spot costs a real A* (~0.2 s on the 144×144
 * map). The stall turn asks it again on every idle retry (~2.5 s), which is
 * wasted work twice over: the live game hitches mid-stall, and the AI-vs-AI
 * race harness spends most of its wall clock re-planning an unchanged world.
 *
 * The observation that makes it cacheable: with the purse fixed at DEEP, the
 * candidate SET — routes, tile costs, viability — is a pure function of the
 * world (`track` + `harvesters` + the factory's seat) and of the free
 * allowances. The inputs that still vary call to call — `stock` (scarcity),
 * `oreUrgency`, `now` (blockades) — only feed `catchmentValue`, i.e. they
 * re-ORDER the list, and the two callers (`rivalSkintTarget` in game.ts and
 * its twin in the race harness) rank by shortfall themselves with the score
 * only as a tiebreak. A one-build-old tiebreak is an honest price for making
 * the stall turn free. Callers that need the true ranking call
 * `planCandidates` directly.
 */
const DEEP_PLAN_PURSE: Purse = {
  wood: MAP_W * MAP_H, stone: MAP_W * MAP_H, grain: MAP_W * MAP_H,
  oil: MAP_W * MAP_H, ore: MAP_W * MAP_H, gold: MAP_W * MAP_H,
};

export interface DeepPlanOptions {
  /** Cargo actually held — scarcity weighting of the score, order-only. */
  stock?: Purse;
  free?: number;
  freeDepots?: number;
  oreUrgency?: number;
  now?: number;
}

interface DeepSlot {
  fp: number;
  free: number;
  freeDepots: number;
  cands: Candidate[];
}

const deepPlanCache = new WeakMap<EconomyState, Map<string, DeepSlot>>();

/**
 * Everything a deep-purse plan reads from the world, folded to one number:
 * the three track layers (a build, a pave, or a blockade tile anywhere)
 * and every harvester (claimed spots, industry coverage, catchment counts).
 * Factories are not folded: the callers keep ONE factory per seat, whose
 * identity is in the slot key.
 */
function deepPlanFingerprint(state: EconomyState): number {
  const { track, harvesters } = state;
  let h = 0;
  const fold = (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) h = (Math.imul(h, 31) + arr[i]) | 0;
  };
  fold(track.dirt);
  fold(track.road);
  fold(track.owner);
  for (const hv of harvesters) {
    h = (Math.imul(h, 31) + hv.tx * 256 + hv.ty) | 0;
    h = (Math.imul(h, 31) + hv.ownerId) | 0;
  }
  return h;
}

/**
 * The bank/market twin of `planCandidates`: same default tier order, the
 * same cost model, bottomless affordability, and the result shared by every
 * seat of one economy until the world moves. Returns the CACHED array —
 * callers must treat it (and its Candidate objects) as read-only; clone
 * before sorting.
 */
export function deepPlanCandidates(
  state: EconomyState, factory: Factory, opts: DeepPlanOptions = {},
): Candidate[] {
  const free = Math.max(0, opts.free ?? 0);
  const freeDepots = Math.max(0, opts.freeDepots ?? 0);
  const fp = deepPlanFingerprint(state);
  const key = `${factory.ownerId}@${factory.tx},${factory.ty}`;
  let slots = deepPlanCache.get(state);
  if (!slots) deepPlanCache.set(state, (slots = new Map()));
  const hit = slots.get(key);
  if (hit && hit.fp === fp && hit.free === free && hit.freeDepots === freeDepots) {
    return hit.cands;
  }
  const cands = planCandidates(state, factory, {
    stock: opts.stock ?? {}, purse: DEEP_PLAN_PURSE,
    free, freeDepots, oreUrgency: opts.oreUrgency, now: opts.now,
  });
  slots.set(key, { fp, free, freeDepots, cands });
  return cands;
}

// ── W8: where the rival's factory goes ────────────────────────────────────
export interface RivalSpotOptions {
  /** What the rival can spend on its first build — prices the probe plan. */
  purse: Purse;
  /** Its free setup allowance, priced the same way `planCandidates` does. */
  free?: number;
  /**
   * PP-05: its free-DEPOT allowance. The probe below prices the rival's
   * OPENING plan — a state with no harvesters at all — so this defaults to
   * `FREE_SETUP_DEPOTS`: without it every probe would demand Oil the opening
   * purse cannot have (Oil needs a Depot), no spot would qualify, and the
   * rival would fall back to an unranked tile it cannot build from.
   */
  freeDepots?: number;
  /** The rival's numeric track-owner id (the game uses player index + 1). */
  ownerId: number;
  /** Display identity of the rival. Default `"ai"`. */
  owner?: string;
  /** Optional diagnostic cap on real plan probes; default searches all candidates. */
  probes?: number;
}

/**
 * AI-01: the cargos a mid-game lane is judged by — everything construction
 * spends besides Wood (which every forest prints) and Gold (which buys
 * nothing built of track). A lane is richer the more of these it can
 * eventually harvest without the 4:1 bank.
 */
const LANE_CARGOS: ReadonlySet<Cargo> = new Set(["stone", "grain", "oil", "ore"]);

/**
 * How far around a candidate factory tile `laneRichness` looks, in
 * Manhattan tiles — about two town-to-town highway spans, the distance a
 * mid-game network riding the public roads comfortably covers.
 */
const LANE_RADIUS = 32;

/**
 * The number of DISTINCT construction cargos with a harvestable industry
 * within `LANE_RADIUS` of (x, y). A neighbourhood scan only — deliberately
 * no routing: it ranks lanes, it does not promise reachability (the A* plan
 * probe in `chooseRivalFactorySpot` remains the gate), which keeps it all
 * but free to ask of every probed spot.
 */
export function laneRichness(grid: Grid, x: number, y: number): number {
  const cargos = new Set<Cargo>();
  for (const ind of grid.industries) {
    const def = INDUSTRY_BY_KEY[ind.type];
    if (!def || !LANE_CARGOS.has(def.cargo)) continue;
    for (const [hx, hy] of harvesterSpots(grid, ind)) {
      if (Math.abs(hx - x) + Math.abs(hy - y) <= LANE_RADIUS) {
        cargos.add(def.cargo);
        break;
      }
    }
  }
  return cargos.size;
}

/**
 * Pick the rival's factory tile: legal ground, as far from the player as
 * possible, AND a tile it can actually build from.
 *
 * The old search in `game.ts` took the farthest tile that was legal for ROAD
 * only. Rail needs flat ground (`TRANSPORT.rail.onRough === false`), so on
 * roughly a third of the legal tiles the rival was handed a rough spot where
 * its rail-first plan could never lay a tile — one of the three faults that
 * compounded into the W8 deadlock. Ranking rail-legal tiles first removes the
 * fault at the source, and probing the top of the ranking with a real
 * `bestCandidate` means a tile is only committed when a buildable plan exists
 * for it (water-walled corners, however rare, are skipped rather than trusted).
 *
 * Deterministic: ties break by distance then tile index.
 */
export function chooseRivalFactorySpot(
  grid: Grid, track: Track, awayFrom: [number, number], opts: RivalSpotOptions,
): [number, number] | null {
  const [fw, fh] = FACTORY_FOOTPRINT;
  const spots: { x: number; y: number; paved: boolean; town: boolean; d: number }[] = [];
  for (let y = 2; y < MAP_H - 2 - fh; y += 2) {
    for (let x = 2; x < MAP_W - 2 - fw; x += 2) {
      // check all tiles of the Factory footprint (FACTORY_FOOTPRINT)
      let allDirt = true, allPaved = true;
      for (let dy = 0; dy < fh; dy++) {
        for (let dx = 0; dx < fw; dx++) {
          if (!canBuildOn(grid, "dirt", x + dx, y + dy)) allDirt = false;
          if (!canBuildOn(grid, "road", x + dx, y + dy)) allPaved = false;
        }
      }
      if (!allDirt) continue;
      // PP-02: only footprints that touch a town (by an edge) are legal
      // Factory sites. The pool is restricted to these so the rival can never
      // be handed a tile far from a town — even through the fallback below.
      const town = factoryTouchesTown(grid, x, y);
      spots.push({
        x, y,
        paved: allPaved,
        town,
        d: Math.abs(x - awayFrom[0]) + Math.abs(y - awayFrom[1]),
      });
    }
  }
  if (!spots.length) return null;
  // PP-02: legal Factory sites are town-adjacent, full stop. The generator
  // guarantees the map offers enough of these for every player, so if none
  // exist the map itself is malformed; in that degenerate case refuse rather
  // than strand the rival on a tile away from any town.
  const townSpots = spots.filter((s) => s.town);
  if (!townSpots.length) return null;
  // Reserve the player's whole Factory footprint, not just its origin tile.
  const apart = townSpots.filter((s) =>
    s.x + fw <= awayFrom[0] || awayFrom[0] + fw <= s.x
    || s.y + fh <= awayFrom[1] || awayFrom[1] + fh <= s.y);
  const ranked = apart.length ? apart : townSpots;
  ranked.sort((a, b) =>
    Number(b.paved) - Number(a.paved) || b.d - a.d || tIdx(a.x, a.y) - tIdx(b.x, b.y));

  const state: EconomyState = { grid, track, harvesters: [], factories: [] };
  const probe: Factory = { owner: opts.owner ?? "ai", ownerId: opts.ownerId, tx: 0, ty: 0 };
  // T4: eight far-corner probes are no longer enough on a sparse 144×144
  // map. Skip geometrically unaffordable starts, then keep searching until a
  // real opening plan exists. Do not silently strand the rival on probe #1.
  const emptyTrack = !track.dirt.some((v) => v !== 0) && !track.road.some((v) => v !== 0);
  const maxOpening = Math.max(
    affordableNewTiles("dirt", opts.purse, opts.free ?? 0),
    affordableNewTiles("road", opts.purse, opts.free ?? 0),
  );
  const targets = grid.industries.flatMap((ind) => harvesterSpots(grid, ind));
  // AI-01: "an opening plan exists" is not enough — the AI-01 race harness
  // showed what happens when it is all that is asked: a far corner whose only
  // nearby cargo is WOOD opens fine — two free forest Depots, a real plan —
  // and then starves: Depots past the free one need Stone/Grain/Oil, every
  // Ore for paving has to come through the 4:1 bank, and the seat is still
  // passing 0★ at twenty minutes. Distance-ranked alone, the search handed
  // the rival the FARTHEST such corner by construction. The probe below
  // therefore asks a second question of every spot and lets the answer do
  // the picking: how many DISTINCT construction cargos does the lane around
  // here hold? `laneRichness` answers with a plain neighbourhood scan — no
  // routing, so it is free — and the search commits to the RICHEST probed
  // lane (distance breaks ties, like before). A wood-only corner keeps an
  // honest answer of 0 and loses to any lane a mid-game can actually be
  // built out of: the bank can bridge one missing cargo, it cannot bridge
  // them all. Bounded probes keep a pathological map from stalling the
  // boot; the ranked fallback below preserves today's behaviour there.
  const tries = Math.max(1, opts.probes ?? 24);
  let probed = 0;
  let best: { s: (typeof ranked)[number]; rich: number } | null = null;
  for (const s of ranked) {
    if (emptyTrack && !targets.some(([x, y]) => Math.abs(x - s.x) + Math.abs(y - s.y) + 1 <= maxOpening)) continue;
    if (probed++ >= tries) break;
    probe.tx = s.x; probe.ty = s.y;
    // PP-05: the probe models the rival's OPENING turn — no harvesters yet —
    // so the Depot it would place rides on the free allowance, exactly as the
    // human's setup Depot does.
    const plan = bestCandidate(state, probe, {
      stock: opts.purse, purse: opts.purse, free: opts.free ?? 0,
      freeDepots: opts.freeDepots ?? FREE_SETUP_DEPOTS,
    });
    if (!plan) continue;
    const rich = laneRichness(grid, s.x, s.y);
    if (!best || rich > best.rich) best = { s, rich };
    // the richest lane the scale knows — take it and stop probing
    if (best && best.rich >= LANE_CARGOS.size) return [best.s.x, best.s.y];
  }
  if (best) return [best.s.x, best.s.y];
  // No probe found a plan (nothing affordable from anywhere): fall back to the
  // best-ranked tile so the rival still exists on the board.
  return [ranked[0].x, ranked[0].y];
}

// ── execution ─────────────────────────────────────────────────────────────
export interface BuildOutcome {
  built: [number, number][];
  harvester: Harvester | null;
  kind: TrackKind;
  /** What the caller debits from the purse — free tiles already subtracted. */
  spent: Purse;
  /**
   * W3: how many tiles the free allowance covered (caller debits freeTrack).
   * W9: always 0 for a rail build — the allowance buys road only.
   */
  free: number;
  /**
   * PP-05: 1 when this turn's Depot rode on the free-Depot allowance, else 0
   * (the caller debits `freeDepots`). The Depot's cost — when it is not free —
   * is already inside `spent`.
   */
  freeDepots: number;
}

/**
 * Commit a candidate: lay the path (stamping `ownerId`, W2), then place the
 * harvester. Tiles that turn out to be unbuildable are skipped rather than
 * aborting the whole plan — W8's `planFeasibility` filter means
 * `planCandidates` never hands one over that would need to, so the skip is now
 * a guard, not the behaviour the plan was priced around. `free` is the same
 * allowance `planCandidates` priced with, so `spent` is exactly what the plan
 * said the purse would pay.
 */
export function executeCandidate(
  state: EconomyState, c: Candidate, owner: string, ownerId: number,
  nextHarvesterId: number, free: number = 0, freeDepots: number = 0,
): BuildOutcome {
  const built: [number, number][] = [];
  let spent: Purse = {};
  // W9: a rail build consumes no setup allowance, so `free` in the outcome is
  // 0 and the caller leaves `freeTrack` alone — the rival keeps its road budget.
  const allowance = freeAllowanceCovers(c.kind) ? Math.max(0, free) : 0;
  let freeLeft = allowance;
  for (const [x, y] of c.path.tiles) {
    if (!canBuildOn(state.grid, c.kind, x, y)) continue;
    if (hasTrack(state.track, c.kind, x, y)) continue;
    const cCost = tileCost(state.track, c.kind, x, y);
    if (Object.keys(cCost).length === 0) {
      // already this kind — rebuild is free and consumes no allowance
    } else if (freeLeft > 0) {
      freeLeft--;
    } else {
      spent = addCost(spent, cCost);
    }
    buildTile(state.track, c.kind, x, y, ownerId);
    built.push([x, y]);
  }
  let harvester: Harvester | null = null;
  const h: Harvester = { id: nextHarvesterId, owner, ownerId, tx: c.hx, ty: c.hy };
  // PP-05: the Depot itself is charged here, once, and only when the Depot
  // actually lands (`isServiced`). A plan that lays track but places nothing
  // charges no Depot — the same "a refused build consumes nothing" rule the
  // human click follows.
  let depotsUsed = 0;
  if (isServiced(state.track, h)) {
    state.harvesters.push(h);
    harvester = h;
    if (freeDepots > 0) depotsUsed = 1;
    else spent = addCost(spent, DEPOT_COST);
  }
  return {
    built, harvester, kind: c.kind, spent,
    free: allowance - freeLeft, freeDepots: depotsUsed,
  };
}

/**
 * One AI turn: pick the best candidate it can afford and build it. Returns
 * null when nothing is affordable or reachable, so the caller can keep the
 * existing skill/timing scaffolding (`nextBuild`, `nextIncome`, `slowedUntil`)
 * in charge of pacing.
 *
 * W2: the build is stamped with `factory.ownerId` — the rival's network is
 * its own from the first tile. W3: `opts.free` prices the build the same way
 * the player's drag preview does, so the AI can use its setup allowance
 * instead of deadlocking on a purse it hasn't earned yet.
 *
 * W8: the ranked list is WALKED, not just read at [0]. A turn that lays no
 * tile and places no harvester is not a turn: it comes back as `null` so
 * `aiTick` leaves the rival's clock alone instead of reporting progress that
 * never happened (and the next tick can try the following candidate, or the
 * other transport kind). `planCandidates` filters those plans out up front —
 * this is the belt-and-braces half, covering a spot that became unusable
 * between planning and building.
 */
export function aiBuildStep(
  state: EconomyState, factory: Factory, opts: PlanOptions, nextHarvesterId: number,
): BuildOutcome | null {
  const freeDepots = Math.max(0, opts.freeDepots ?? 0);
  // PP-05: `planCandidates` already refused plans whose track + Depot the purse
  // cannot cover; this is the belt-and-braces half (same shape as W8's), because
  // `executeCandidate` mutates the map as it goes and a Depot it places for a
  // purse that cannot pay would be a free Depot. `c.cost` is the plan's priced
  // track total, an upper bound on what `executeCandidate` charges.
  const depotCost = priceDepot(opts.purse, freeDepots).cost;
  for (const c of planCandidates(state, factory, opts)) {
    if (!canAfford(opts.purse, addCost(c.cost, depotCost))) continue;
    const out = executeCandidate(
      state, c, factory.owner, factory.ownerId, nextHarvesterId, opts.free, freeDepots,
    );
    if (out.built.length > 0 || out.harvester) return out;
  }
  return null;
}

// ══════════════════════════════════════════════════════════════════════════
// VP-01 — the pave pass: the rival's second action, and the one that scores.
//
// `planCandidates` can only ever ADD to the network. That was fine while a new
// connection was the only way to score; under VP-01 the highest-value move on
// the board is usually to take a tile the rival has ALREADY built and improve
// it, because one paved tile is 0.25★ and, if that tile sits on a component a
// Depot is using, the same 4 Ore lifts every depot on it from ×1.0 to ×1.6
// (`resolveConnection` reads `roadComp` of the whole component, not the tile
// the lorry happens to cross). A rival that never paves simply cannot win any
// more, so the turn now has a second half.
//
// The order the list is built in is the strategy, spelled out:
//
//   1. one tile on each live gravel component — the cheapest possible purchase
//      of a ×1.6 income boost, one tile per link, so a purse of 8 Ore upgrades
//      two connections instead of paving two tiles of one;
//   2. the rest of those components' tiles — already premium ground, and each
//      tile is still 0.25★;
//   3. everything else it owns, nearest its factory first, so the trunk is
//      paved before the spurs and the next A* runs over discountable tiles.
//
// Nothing here is free: every tile is charged `tileCost` (the in-place
// `UPGRADE_COST`), the same number the human's drag pays, and the budget stops
// short of the Ore a plant would still need (`keepOre`), so paving never
// strands the rival's own 1★ purchase.
// ══════════════════════════════════════════════════════════════════════════

export interface PaveOptions {
  /** Display identity of the builder. */
  owner: string;
  /** Its numeric track-owner id — the tile ownership the pave has to match. */
  ownerId: number;
  /** What it can spend. Only Ore is ever charged for an in-place pave. */
  purse: Purse;
  /** Tiles per turn (default 8): the pace the HUD reads as a rival paving a
   *  stretch of road rather than teleporting tarmac onto its whole network. */
  maxTiles?: number;
  /**
   * Ore held back for the next plant (`PLANT_COST.ore` while the plant is
   * still unaffordable). The pave pass is the one AI action with no deadline,
   * so it is the one that has to fund everything else.
   */
  keepOre?: number;
}

export interface PavePlan {
  /** Tiles to pave, in the order they should be built. */
  tiles: [number, number][];
  /** Exactly what `executePaves` will charge, summed from `tileCost`. */
  cost: Purse;
  /** How many live gravel links this flips to the paved multiplier. */
  links: number;
  /** VP the pave buys — `tiles.length × VICTORY.upgrade`. */
  vp: number;
}

interface PaveTile {
  i: number;
  x: number;
  y: number;
  /** The owner's merged component this tile belongs to (-1 = none). */
  comp: number;
  /** True when a depot↔plant link is live on that component, gravel-only. */
  live: boolean;
  /** Manhattan distance from the plant the rival builds out from. */
  d: number;
}

/**
 * The rival's paveable tiles, ranked. Exported for the tests and the debug
 * console: the ranking IS the strategy, so it should be readable without
 * running a whole turn.
 */
export function paveCandidates(
  state: EconomyState, opts: PaveOptions,
): PaveTile[] {
  const { grid, track } = state;
  const comp = buildAllComponents(track, opts.ownerId);
  const factory = state.factories.find((f) => f.owner === opts.owner);

  // Which of this rival's connections are still on gravel? Those are the
  // components where ONE paved tile changes the income of every depot on them.
  const gravel = new Set<number>();
  for (const h of state.harvesters) {
    if (h.owner !== opts.owner) continue;
    if (!isServiced(track, h)) continue;
    if (resolveConnection(state, comp, h).kind !== "dirt") continue;
    for (const f of state.factories) {
      if (f.owner !== opts.owner) continue;
      for (const c of sharedComponents(comp.comp, h.tx, h.ty, f.tx, f.ty)) {
        if (comp.roadComp[c] === 0) gravel.add(c);
      }
    }
  }

  const all: PaveTile[] = [];
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const i = y * MAP_W + x;
      // Only its OWN gravel: a rival may not pave the player's road for the
      // point (W2 ownership again), and a tile it does not own is not here.
      if (!hasTrack(track, "dirt", x, y) || track.owner[i] !== opts.ownerId) continue;
      // Paving needs flat ground — a gravel tile on rough stays gravel
      // (`TRANSPORT.road.onRough === false`), exactly as the human's drag
      // refuses it with "A paved Road can't cross rough ground".
      if (!canBuildOn(grid, "road", x, y)) continue;
      const c = comp.comp[i];
      all.push({
        i, x, y, comp: c,
        live: c >= 0 && gravel.has(c),
        d: factory ? Math.abs(x - factory.tx) + Math.abs(y - factory.ty) : i,
      });
    }
  }

  // (1) one tile per live component, (2) the rest of those, (3) the rest.
  const byIndex = (a: PaveTile, b: PaveTile) => a.i - b.i;
  const heads: PaveTile[] = [];
  const restLive: PaveTile[] = [];
  const rest: PaveTile[] = [];
  const taken = new Set<number>();
  for (const c of [...gravel].sort((a, b) => a - b)) {
    const inComp = all.filter((t) => t.comp === c).sort((a, b) => a.d - b.d || byIndex(a, b));
    if (!inComp.length) continue;
    heads.push(inComp[0]);
    taken.add(inComp[0].i);
    restLive.push(...inComp.slice(1));
  }
  for (const t of all) if (!taken.has(t.i) && !t.live) rest.push(t);
  restLive.sort((a, b) => a.d - b.d || byIndex(a, b));
  rest.sort((a, b) => a.d - b.d || byIndex(a, b));
  return [...heads, ...restLive.sort((a, b) => Number(b.live) - Number(a.live) || a.d - b.d || byIndex(a, b)), ...rest];
}

/**
 * Rank the rival's paveable tiles, then cut the list at what it can actually
 * afford (and can afford to spend). Returns null when there is nothing worth
 * paving or no Ore to pave with — the caller then simply skips the action, so
 * a rival with no ore never "paves" into a negative purse.
 */
export function planUpgrades(state: EconomyState, opts: PaveOptions): PavePlan | null {
  const ranked = paveCandidates(state, opts);
  if (!ranked.length) return null;
  const orePrice = UPGRADE_COST.ore ?? 4;
  const spare = Math.max(0, (opts.purse.ore ?? 0) - Math.max(0, opts.keepOre ?? 0));
  const cap = Math.max(0, Math.min(opts.maxTiles ?? 8, Math.floor(spare / orePrice)));
  if (cap < 1) return null;

  let cost: Purse = {};
  const tiles: [number, number][] = [];
  const links = new Set<number>();
  for (const t of ranked) {
    if (tiles.length >= cap) break;
    const c = tileCost(state.track, "road", t.x, t.y);
    const next = addCost(cost, c);
    if (!canAfford(opts.purse, next)) break;
    cost = next;
    tiles.push([t.x, t.y]);
    if (t.live) links.add(t.comp);
  }
  if (!tiles.length) return null;
  return { tiles, cost, links: links.size, vp: tiles.length * VICTORY.upgrade };
}

export interface PaveOutcome {
  built: [number, number][];
  spent: Purse;
}

/**
 * Commit a pave plan. `buildTile` is the one place the dirt→paved transition
 * happens, which is also where the 0.25★ provenance bit is stamped
 * (`track.ts`), so scoring this rival's turn needs nothing but a `rescore`.
 * A tile that has become unbuildable since the plan was made (the player tore
 * up the gravel under it) is skipped, and skipped tiles charge nothing.
 */
export function executePaves(state: EconomyState, plan: PavePlan, ownerId: number): PaveOutcome {
  const built: [number, number][] = [];
  let spent: Purse = {};
  for (const [x, y] of plan.tiles) {
    if (!hasTrack(state.track, "dirt", x, y)) continue;         // no longer gravel
    if (!canBuildOn(state.grid, "road", x, y)) continue;        // no longer legal
    spent = addCost(spent, tileCost(state.track, "road", x, y));
    buildTile(state.track, "road", x, y, ownerId);
    built.push([x, y]);
  }
  return { built, spent };
}

// ── reading the scoreboard ─────────────────────────────────────────────────
export interface RivalPace {
  /** Behind by a whole plant's worth of points: stop investing in income. */
  sprint: boolean;
  /**
   * Exchanges the 4:1 bank may make in one turn (2 is the player's rhythm, and
   * the rival's cruise rate). Doubling THIS is what sprinting means: the same
   * milestone, reached in half the turns.
   *
   * The milestone itself is deliberately NOT enlarged. An earlier version aimed
   * a sprinting rival at eight tiles (32 Ore) instead of four (16), on the theory
   * that a losing seat should swing bigger; on seed 99 of the 5-seed race that
   * produced the worst possible result — 0★ for the whole game, because a poor
   * seat cannot assemble 32 Ore, so it sold four stacks a turn toward a target it
   * could never reach and stopped affording the economy it needed to reach it.
   * A plan has to be short enough to finish. `planUpgrades` still paves all eight
   * tiles at once when the Ore happens to be there.
   */
  bankPerTurn: number;
  /**
   * Multiplier on the value of Ore-bearing industries this turn (1 = the
   * economy's own ranking) — how the lead reaches the DEPOT choice.
   */
  oreUrgency: number;
  /**
   * The PLAYER is within one plant of winning, so Gold is worth more spent on a
   * Blockade of its Ore than banked: `game.ts` drops the rival's reserve to nil
   * for a turn. Denial is the one action that scores by NOT being about your
   * own board, and it is only rational when somebody is about to win — which,
   * from the rival's side, means it reads the opponent's total, not the leader's
   * (a rival that is itself about to win should be spending on paves).
   */
  deny: boolean;
}

/**
 * The rival's read of the scoreboard, and the four numbers that follow from it.
 *
 * Pure, and deliberately so: it takes two totals and the target, never the
 * board, so it can be argued about in a test table instead of inferred from a
 * 40-minute race. `you - ai` is the whole of its information — which is what
 * "reacts to the player's lead" should mean in a game where the opponent's road
 * network is visible but their intentions are not.
 *
 * Both thresholds are one plant (1★), the cheapest unit of score: a gap the
 * rival cannot close inside a turn or two of paving is not an emergency, and
 * an emergency it cannot act on is noise.
 */
export function rivalPace(you: number, ai: number, target: number): RivalPace {
  const behind = you - ai;
  const sprint = behind >= VICTORY.plant;
  const deny = you > target - VICTORY.plant;
  return { sprint, bankPerTurn: sprint ? 4 : 2, oreUrgency: sprint ? 1.5 : 1, deny };
}
