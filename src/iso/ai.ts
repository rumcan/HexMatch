// ══════════════════════════════════════════════════════════════════════════
// E7 — Isometric AI: industry scoring + A* auto-routing.
//
// Replaces ai.ts's `findLegalSettlement` / `findLegalRoad`, which were vertex
// and edge based and do not survive the migration.
//
// Behaviour: score candidate industries by
//     (cargo scarcity in the AI's stock × output) ÷ path cost
// A* a path from the nearest owned network tile, then place a harvester. The
// rival prefers the premium paved `road` tier and falls back to a basic
// `dirt` road when paving is impossible or unaffordable.
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
import { TRANSPORT, UPGRADE_COST, INDUSTRY_BY_KEY, FACTORY_FOOTPRINT, type Cargo } from "./config";
import { DEPOT_COST, FREE_SETUP_DEPOTS, priceDepot } from "./construction";
import { ROUGH, factoryTouchesTown, type Grid, type Industry } from "./grid";
import {
  DIRS, DIR, tIdx, inMapT, hasTrack, canBuildOn, tileCost, addCost, canAfford,
  buildTile, trackOpenTo, freeAllowanceCovers, type Track, type TrackKind, type Purse,
} from "./track";
import {
  catchmentRect, rectContains, isServiced,
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
 */
export function stepCost(
  grid: Grid, track: Track, kind: TrackKind, tx: number, ty: number, owner: number = 0,
): number {
  // Use the build rule itself: town tiles (TOWN_OCC = -2) block routes too.
  if (!canBuildOn(grid, kind, tx, ty)) return IMPASSABLE;
  const i = tIdx(tx, ty);
  const terrain = grid.terrain[i];
  let c = terrain === ROUGH ? COST_ROUGH : COST_FLAT;
  // reuse our own trunk lines rather than building parallel spurs
  const own = owner === 0 ? true : track.owner[i] === owner;
  if (hasTrack(track, kind, tx, ty) && own) c *= COST_OWNED;
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

export interface Candidate {
  industry: Industry;
  /** Tile the harvester would occupy — adjacent to the industry footprint. */
  hx: number;
  hy: number;
  path: Path;
  kind: TrackKind;
  cost: Purse;
  score: number;
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
 */
export function networkTiles(track: Track, kind: TrackKind, factory: Factory): [number, number][] {
  const out: [number, number][] = [];
  const owner = factory.ownerId;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (!hasTrack(track, kind, x, y)) continue;
      if (owner !== 0 && track.owner[tIdx(x, y)] !== owner) continue;
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
  /** Prefer the premium paved Road tier when affordable (spec: fall back to Dirt). */
  preferPaved?: boolean;
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
 * W8: a candidate is only returned when its plan is VIABLE — every path tile
 * is legal ground for the transport kind, and the harvester the path ends at
 * is serviced once that track is laid (see `planFeasibility`). Because
 * unbuildable paved plans are rejected here rather than ranked, the paved-first
 * preference now genuinely falls through to dirt when paving is impossible —
 * not only when it produces nothing at all — and a turn is never spent on a
 * plan that builds nothing.
 */
export function planCandidates(
  state: EconomyState, factory: Factory, opts: PlanOptions,
): Candidate[] {
  const { grid, track } = state;
  const out: Candidate[] = [];
  const claimed = new Set(state.harvesters.map((h) => tIdx(h.tx, h.ty)));
  const free = Math.max(0, opts.free ?? 0);
  // PP-05: every candidate ends at a NEW Depot, so the Depot's own price is
  // part of what the plan must afford. Priced by the same `priceDepot` the
  // human click and the HUD use — one table, one rule, no rival-only discount.
  const depotCost = priceDepot(opts.purse, opts.freeDepots ?? 0).cost;

  const kinds: TrackKind[] = opts.preferPaved === false ? ["dirt"] : ["road", "dirt"];
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

        const score = scarcity(opts.stock, def.cargo) * (ind.output ?? def.output)
          / Math.max(0.3, path.cost);
        out.push({ industry: ind, hx, hy, path, kind: kindPref, cost, score });
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
  const tries = Math.max(1, opts.probes ?? ranked.length);
  let probed = 0;
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
    if (plan) return [s.x, s.y];
  }
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
