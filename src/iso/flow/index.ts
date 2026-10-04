// ══════════════════════════════════════════════════════════════════════════
// FLOW-1 (traffic) — the bridge between the pure core and the live game.
//
// This is the ONLY file in `src/iso/flow/` that knows the game's types. The
// patch (`hexmatch-traffic.patch`) adds five small hooks into existing
// modules and never touches `game.ts`:
//
//   ambience.ts      tickAmbience  → flowTick()          (clock + rebuild)
//                    lightAspect   → flowLightAspect()   (actuated lights for
//                                   cars, walkers, ghosts — one truth)
//                    paintAmbience → paintFlowOverlay()  (signal heads,
//                                   incidents, heat map — REAL art, drawn even
//                                   while the stand-ins stay off)
//   vehicles.ts      tickTrucks    → flowTruckHook()     (lorries stop at red
//                                   lights and slow in congestion — the
//                                   ECONOMIC pose, so deliveries feel it)
//   cars.ts          tickCars      → flowObserveCars(), flowCarFactor(),
//                                   flowSignals()        (cars feed the field,
//                                   obey the same lights, slow in jams)
//   road-renderer.ts paintRoadTiles→ paintFlowMarkings() (stop lines, zebra
//                                   crossings, street centre lines — baked
//                                   into the cached road raster)
//
// SAFETY. Every hook degrades to today's behaviour when the flow is not
// "live" (never ticked, ticked > 1.5 s ago, disabled, or no road network):
// the truck hook is null, the light hook returns null, factors are 1. The
// module is OFF under the unit-test runner unless a test turns it on, so the
// existing suites keep their exact numbers.
//
// Nothing here is saved and nothing goes on the wire. The host's trucks feel
// the host's traffic; a guest replicates truck poses exactly as before.
//
// URL flags: ?traffic=0 (off) · ?traffic=fixed (AMB-3 timing, no actuation)
//            ?traffic=heat (congestion overlay) · ?traffic-impact=0..1
// Console:   window.__traffic — stats(), config({...}), heat(on), incident(),
//            clear(), towns(), enable(on)
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../../game/config";
import { PRESENT, tIdx, AVENUE_X, AVENUE_Y, avenueJunction, type Track } from "../track";
import type { Grid } from "../grid";
import { ambientRoadGraph } from "../road-routing";
import { ROAD_WIDTH, paintFigures } from "../road-geometry";
import {
  DEFAULT_FLOW_CONFIG, addIncident, approachFor, clearIncidents, createFlowState,
  fixedAspect, flowAspect, flowStats, noteWaiting, observePose, rebuildFlow,
  segmentFactor, setSource, signalStop, stepFlow, tileFactor,
  type FlowAspect, type FlowAxis, type FlowConfig, type FlowObservation,
  type FlowState, type FlowStats,
} from "./flow-core";
import {
  paintCentreLine, paintHeatTile, paintIncident, paintJunctionMarkings,
  paintSignalHead, signalPoles, type FlowDrape, type GPt, type PolePlace,
} from "./flow-paint";

export type { FlowAspect, FlowAxis, FlowConfig, FlowStats } from "./flow-core";
export { DEFAULT_FLOW_CONFIG } from "./flow-core";

// ── structural views of the game's records (no import cycles) ───────────
interface SignalMapLike { seed: number; junctions: Map<number, number> }
type Route = readonly (readonly [number, number])[];
export interface FlowTruckLike {
  depotId: number;
  route: Route;
  leg: number;
  t: number;
  reverse: boolean;
  waitMs?: number;
}
export interface FlowCarLike {
  state: string;
  route: Route;
  leg: number;
  t: number;
}

// ── environment ─────────────────────────────────────────────────────────
function inTestRunner(): boolean {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  if (g.process?.env?.VITEST) return true;
  try {
    const env = (import.meta as unknown as { env?: { MODE?: string } }).env;
    if (env?.MODE === "test") return true;
  } catch { /* no import.meta.env */ }
  return false;
}

function urlParam(name: string): string | null {
  try {
    return typeof location !== "undefined" ? new URLSearchParams(location.search).get(name) : null;
  } catch { return null; }
}

const wallNow = (): number =>
  typeof performance !== "undefined" ? performance.now() : Date.now();

const TRAFFIC_FLAG = urlParam("traffic");
const IMPACT_FLAG = urlParam("traffic-impact");

function initialConfig(): Partial<FlowConfig> {
  const cfg: Partial<FlowConfig> = {};
  if (TRAFFIC_FLAG === "fixed") cfg.signalMode = "fixed";
  if (IMPACT_FLAG !== null && Number.isFinite(Number(IMPACT_FLAG))) {
    cfg.truckImpact = Math.max(0, Math.min(1, Number(IMPACT_FLAG)));
  }
  return cfg;
}

/** Half the paved carriageway, for placing poles in the overlay. */
const HALF_ROAD = (ROAD_WIDTH.paved ?? 0.4) / 2;
/** How many signal heads one screen draws. */
const SCREEN_POLE_CAP = 96;
/** The flow is "live" only while something keeps ticking it. */
const LIVE_WINDOW_MS = 1500;

// ── the runtime singleton ───────────────────────────────────────────────
interface Hold { junction: number; ms: number }

const rt = {
  enabled: !inTestRunner() && TRAFFIC_FLAG !== "0" && TRAFFIC_FLAG !== "off",
  flow: createFlowState(initialConfig()) as FlowState,
  trackRef: null as Track | null,
  trackRev: -1,
  junctionRef: null as Map<number, number> | null,
  /** TOWN-4.2 (#678): `signals` as this module serves it to cars — the
   *  ambience junctions UNIONED with every player-built Avenue junction
   *  (townId −1 ⇒ one shared field controller). Rebuilt in `rebuild`. */
  signalsMerged: null as SignalMapLike | null,
  townSig: "",
  signals: null as SignalMapLike | null,
  ambTime: 0,
  lastTickWall: -Infinity,
  holds: new Map<number, Hold>(),
  heat: TRAFFIC_FLAG === "heat",
  lights: true,
  markings: true,
  markRev: 0,
  junctionKey: "",
  holdMsTotal: 0,
};

function live(): boolean {
  return rt.enabled && rt.flow.tiles.length > 0 && wallNow() - rt.lastTickWall < LIVE_WINDOW_MS;
}

// ── network build ───────────────────────────────────────────────────────
export function townWeight(t: { houses?: readonly unknown[]; roads?: readonly unknown[]; level?: number }): number {
  // ambience.townTrafficWeight, restated to keep this module cycle-free.
  const size = Math.max(1, t.houses?.length ?? 0, t.roads?.length ?? 0);
  const tierMul = t.level === undefined ? 1 : 0.7 + Math.max(0, t.level) * 0.35;
  return (1 + Math.sqrt(size) / 6) * tierMul;
}

/**
 * TOWN-4.5 (#681): the background-demand weight NOTHING may exceed — the
 * heaviest tier-3 grid town this formula ever produced, measured the way
 * #687's car cap was (max over seeds 1–60): 169 houses / 216 road tiles at
 * tier 3, ≈ 6.037. Computed FROM `townWeight`, so the pin is the grid
 * town's weight bit-for-bit, not a rounded copy of it. A planned town's
 * avenues hold far more road tiles than a grid town's streets, so without
 * this the background demand a planned capital radiates (1.25 × weight ×
 * e^(−d/r) per road tile) would jam its own streets and drag its
 * `tileFactor` below a legacy town's — which would read as LOWER traffic
 * income on the new default map. The radius still grows with the town (the
 * field covers the bigger footprint), but the peak never exceeds what the
 * old towns reached. RE-PIN only by re-sweeping the legacy generator and
 * taking the new max — never from a planned map.
 */
export const FLOW_TOWN_WEIGHT_CAP = townWeight({
  houses: new Array(169), roads: new Array(216), level: 3,
});

/**
 * TOWN-4.5 (#681): the weight a town RADIATES — the raw `townWeight`, capped
 * at `FLOW_TOWN_WEIGHT_CAP`. The flow's `townCarWeight`: every caller that
 * turns a town into background demand reads this, so planned-scale towns
 * radiate the heaviest grid town's peak and never more.
 */
export function flowTownWeight(t: { houses?: readonly unknown[]; roads?: readonly unknown[]; level?: number }): number {
  return Math.min(FLOW_TOWN_WEIGHT_CAP, townWeight(t));
}

function townSignature(grid: Grid): string {
  let s = "";
  for (const t of grid.towns ?? []) s += `${t.id}:${t.level ?? "x"}:${t.roads?.length ?? 0};`;
  return s;
}

function tierAt(track: Track, i: number): number {
  return (track.tier?.[i] ?? 0) & 7;
}

/** Jam capacity in PCU: dirt < street < road < avenue < highway. */
function capacityOf(track: Track, i: number): number {
  const paved = track.road[i] !== 0;
  if (!paved) return (track.dirt[i] & PRESENT) ? 2.5 : 3;
  const tier = tierAt(track, i);
  if (tier === 1) return 4;
  if (tier === 2 || tier === 4 || tier === 5) return 12;
  // TOWN-4.2 (#678): a two-lane one-way carriageway sits between Road and
  // Highway — four lanes of throughput in the art, priced between the two.
  if (tier === 6 || tier === 7) return 10;
  return 6;
}

/** Through traffic on the inter-town network even far from any town. */
function corridorOf(track: Track, i: number): number {
  if (track.road[i] === 0) return 0.05;
  const tier = tierAt(track, i);
  if (tier === 2 || tier === 4 || tier === 5) return 0.9;
  return 0.25;
}

function rebuild(track: Track, grid: Grid, signals: SignalMapLike): void {
  const graph = ambientRoadGraph(track);
  const towns = (grid.towns ?? []).map((t) => ({
    id: t.id,
    tx: t.tx,
    ty: t.ty,
    // TOWN-4.5 (#681): capped — planned-scale towns radiate the same peak
    // background demand as the heaviest legacy town, never more.
    weight: flowTownWeight(t),
    radius: 4 + Math.sqrt(t.roads?.length ?? 1) * 0.9,
  }));
  // TOWN-4.2 (#678): ambience's buildSignals only covers town boxes and
  // parity-deletes half the junctions — player-built Avenue junctions must be
  // signalled BY DEFAULT, so they are UNIONED into the rebuild's input here
  // (and into what flowSignals() serves to the cars). Real town junctions
  // keep their own townId; Avenue-only junctions take townId −1, which seeds
  // one shared "field" controller from the map seed like any other town.
  const junctions = new Map(signals.junctions);
  if (track.tier) {
    for (let i = 0; i < track.tier.length; i++) {
      const v = track.tier[i] & 7;
      if (v !== AVENUE_X && v !== AVENUE_Y) continue;
      if (junctions.has(i)) continue;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      if (avenueJunction(track, x, y)) junctions.set(i, -1);
    }
  }
  rebuildFlow(rt.flow, {
    mapW: MAP_W,
    mapH: MAP_H,
    seed: signals.seed,
    graph,
    junctions,
    towns,
    capacityOf: (i) => capacityOf(track, i),
    corridorOf: (i) => corridorOf(track, i),
  });
  rt.signalsMerged = junctions.size === signals.junctions.size ? signals : { seed: signals.seed, junctions };
  rt.trackRef = track;
  rt.trackRev = track.revision;
  rt.junctionRef = signals.junctions;
  rt.townSig = townSignature(grid);
  const key = [...rt.flow.junctions.keys()].sort((a, b) => a - b).join(",");
  if (key !== rt.junctionKey) { rt.junctionKey = key; rt.markRev++; }
  rt.holds.clear();
}

// ── hooks: ambience.ts ──────────────────────────────────────────────────
/** Advance the traffic clock. Called by `tickAmbience` on every client. */
export function flowTick(
  dtMs: number, track: Track | null | undefined, grid: Grid | null | undefined,
  signals: SignalMapLike, timeMs: number,
): void {
  if (!rt.enabled || !track || !grid || !(dtMs > 0)) return;
  rt.signals = signals;
  rt.ambTime = timeMs;
  if (track !== rt.trackRef || track.revision !== rt.trackRev
    || signals.junctions !== rt.junctionRef || townSignature(grid) !== rt.townSig) {
    rebuild(track, grid, signals);
  }
  stepFlow(rt.flow, dtMs);
  rt.lastTickWall = wallNow();
}

/**
 * The actuated aspect for `lightAspect`, or null to keep AMB-3's seeded
 * formula (fixed mode, or flow not live). One source of truth for cars,
 * walkers, truck ghosts and the lorries' real stop lines.
 */
export function flowLightAspect(townId: number, axis: 0 | 1): FlowAspect | null {
  if (!live() || rt.flow.cfg.signalMode === "fixed") return null;
  if (!rt.flow.signals.has(townId)) return null;
  return flowAspect(rt.flow, townId, axis as FlowAxis);
}

function aspectFor(townId: number, axis: FlowAxis): FlowAspect {
  if (rt.flow.cfg.signalMode === "fixed" || !rt.flow.signals.has(townId)) {
    return fixedAspect(rt.flow.cfg, rt.signals?.seed ?? rt.flow.seed, townId, axis, rt.ambTime);
  }
  return flowAspect(rt.flow, townId, axis);
}

/** Screen-space overlay: heat map, incidents, signal heads. Returns marks drawn. */
export function paintFlowOverlay(
  ctx: unknown,
  project: (fx: number, fy: number) => [number, number],
  zoom: number,
  view?: { x0: number; y0: number; x1: number; y1: number },
  performance = false,
): number {
  if (!ctx || performance || !live()) return 0;
  const c = ctx as CanvasRenderingContext2D;
  if (typeof c.arc !== "function" || typeof c.fillRect !== "function" || typeof c.save !== "function") return 0;
  const f = rt.flow;
  const inView = (x: number, y: number): boolean =>
    !view || (x >= view.x0 - 2 && x <= view.x1 + 2 && y >= view.y0 - 2 && y <= view.y1 + 2);
  let drawn = 0;
  if (rt.heat) {
    for (let n = 0; n < f.tiles.length; n++) {
      const i = f.tiles[n];
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      if (inView(x, y) && paintHeatTile(c, project, x, y, tileFactor(f, i))) drawn++;
    }
  }
  for (const inc of f.incidents) {
    if (!inView(inc.x, inc.y)) continue;
    const [sx, sy] = project(inc.x, inc.y);
    paintIncident(c, sx, sy, zoom, f.time, inc);
    drawn++;
  }
  if (rt.lights && zoom >= 0.75) {
    let poles: PolePlace[] = [];
    for (const j of f.junctions.values()) {
      if (inView(j.x, j.y)) poles.push(...signalPoles(j, HALF_ROAD, 0));
    }
    if (poles.length > SCREEN_POLE_CAP && view) {
      const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
      poles.sort((a, b) => Math.hypot(a.fx - cx, a.fy - cy) - Math.hypot(b.fx - cx, b.fy - cy));
      poles = poles.slice(0, SCREEN_POLE_CAP);
    }
    poles.sort((a, b) => (a.fx + a.fy) - (b.fx + b.fy));   // back to front
    for (const p of poles) {
      const [sx, sy] = project(p.fx, p.fy);
      paintSignalHead(c, sx, sy, zoom, aspectFor(p.townId, p.axis));
      drawn++;
    }
  }
  return drawn;
}

// ── hooks: vehicles.ts ──────────────────────────────────────────────────
export interface TruckFlowHook {
  /** Multiplier on the leg's speed (≤ 1): congestion and incidents. */
  speed(truck: FlowTruckLike, k: number): number;
  /** Stop-line `t` on leg k while the light ahead binds, else null. */
  stopT(truck: FlowTruckLike, k: number): number | null;
  /** The lorry spent `ms` standing at a light. */
  hold(truck: FlowTruckLike, ms: number): void;
}

const TRUCK_HOOK: TruckFlowHook = {
  speed(truck, k) {
    const f = rt.flow;
    const a = truck.route[k], b = truck.route[k + 1];
    if (!a || !b) return 1;
    const raw = segmentFactor(f, tIdx(a[0], a[1]), tIdx(b[0], b[1]), f.cfg.truckPcu);
    return 1 - (1 - raw) * Math.max(0, Math.min(1, f.cfg.truckImpact));
  },
  stopT(truck, k) {
    const f = rt.flow;
    const stop = signalStop(f, truck.route, k, truck.t, truck.reverse, f.time);
    const held = rt.holds.get(truck.depotId);
    if (stop === null) {
      if (held) rt.holds.delete(truck.depotId);
      return null;
    }
    const ap = approachFor(f, truck.route, k, truck.t, truck.reverse);
    if (held && ap && held.junction === ap.junction.i && held.ms >= f.cfg.maxHoldMs) return null;
    return stop;
  },
  hold(truck, ms) {
    const f = rt.flow;
    const k = Math.min(truck.leg, truck.route.length - 2);
    const ap = approachFor(f, truck.route, k, truck.t, truck.reverse);
    if (!ap) return;
    const prev = rt.holds.get(truck.depotId);
    const same = prev && prev.junction === ap.junction.i;
    rt.holds.set(truck.depotId, { junction: ap.junction.i, ms: (same ? prev!.ms : 0) + ms });
    rt.holdMsTotal += ms;
    noteWaiting(f, ap.junction.townId, ap.axis, `truck:${truck.depotId}`, f.cfg.truckPcu * f.cfg.truckPriority);
  },
};

/**
 * Called once at the top of `tickTrucks`. Publishes the lorries into the
 * density field and hands back the hook, or null (→ today's behaviour).
 */
export function flowTruckHook(trucks: readonly FlowTruckLike[]): TruckFlowHook | null {
  if (!live()) return null;
  const out: FlowObservation[] = [];
  const pcu = rt.flow.cfg.truckPcu;
  for (const t of trucks) {
    if (t.route.length < 2 || (t.waitMs ?? 0) > 0) continue;
    observePose(out, MAP_W, t.route, t.leg, t.t, pcu);
  }
  setSource(rt.flow, "trucks", out);
  return TRUCK_HOOK;
}

// ── hooks: cars.ts ──────────────────────────────────────────────────────
/** Publish the ambient cars into the density field. */
export function flowObserveCars(cars: readonly FlowCarLike[]): void {
  if (!live()) return;
  const out: FlowObservation[] = [];
  const pcu = rt.flow.cfg.carPcu;
  for (const c of cars) {
    if (c.state !== "driving" && c.state !== "arriving") continue;
    observePose(out, MAP_W, c.route, c.leg, c.t, pcu);
  }
  setSource(rt.flow, "cars", out);
}

/** Congestion multiplier for a car's leg (1 when not live). */
export function flowCarFactor(a: readonly number[], b: readonly number[]): number {
  if (!live()) return 1;
  return segmentFactor(rt.flow, tIdx(a[0], a[1]), tIdx(b[0], b[1]), rt.flow.cfg.carPcu);
}

/** The signal map cars should obey when the game did not pass one.
 *  TOWN-4.2 (#678): the merged map — Avenue junctions are signalled by
 *  default even where ambience's town-box scan never looked. */
export function flowSignals(): SignalMapLike | null {
  return live() ? (rt.signalsMerged ?? rt.signals) : null;
}

/** The ambience clock those signals are read against. */
export function flowTime(): number {
  return rt.ambTime;
}

// ── hooks: road-renderer.ts ─────────────────────────────────────────────
type FigMask = Parameters<typeof paintFigures>[2];
type FigDiag = Parameters<typeof paintFigures>[3];
export interface FlowMarkTile {
  tx: number;
  ty: number;
  material: string;
  tier?: number;
  deck?: unknown;
  mask: FigMask;
  diagonal?: unknown;
}

/** Part of the road cache key: bumps when the signalised junction set changes. */
export function flowMarkingsRev(): number {
  return rt.enabled && rt.markings ? rt.markRev : 0;
}

/**
 * Stop lines + zebra crossings on signalised junctions, a dashed centre line
 * on town streets. Runs inside the road raster (ground transform), so it is
 * cached with the roads and costs nothing per frame.
 */
export function paintFlowMarkings<T extends FlowMarkTile>(
  ctx: CanvasRenderingContext2D, tiles: readonly T[], elev: FlowDrape, widthOf: (t: T) => number,
): void {
  if (!rt.enabled || !rt.markings) return;
  const f = rt.flow;
  for (const t of tiles) {
    if (t.material !== "paved" || t.deck) continue;
    const j = f.junctions.get(t.ty * MAP_W + t.tx);
    if (j) {
      paintJunctionMarkings(ctx, j, widthOf(t) / 2, { centre: 0.5, drape: elev });
      continue;
    }
    if ((t.tier ?? 0) !== 1) continue;
    for (const fig of paintFigures(t.tx, t.ty, t.mask, t.diagonal as FigDiag)) {
      const pts = (fig as { points: readonly (readonly number[])[] }).points;
      paintCentreLine(ctx, pts.map((p) => [p[0], p[1]] as GPt), elev);
    }
  }
}

// ── configuration & debug ───────────────────────────────────────────────
export interface TrafficFlowOptions extends Partial<FlowConfig> {
  enabled?: boolean;
  heat?: boolean;
  lights?: boolean;
  markings?: boolean;
}

export function configureTrafficFlow(opts: TrafficFlowOptions): void {
  const { enabled, heat, lights, markings, ...cfg } = opts;
  if (enabled !== undefined) rt.enabled = enabled;
  if (heat !== undefined) rt.heat = heat;
  if (lights !== undefined) rt.lights = lights;
  if (markings !== undefined && markings !== rt.markings) { rt.markings = markings; rt.markRev++; }
  Object.assign(rt.flow.cfg, cfg);
}

/** Forget everything (a new match). The next tick rebuilds. */
export function resetTrafficFlow(): void {
  rt.flow = createFlowState({ ...rt.flow.cfg });
  rt.trackRef = null;
  rt.trackRev = -1;
  rt.junctionRef = null;
  rt.signalsMerged = null;
  rt.townSig = "";
  rt.holds.clear();
  rt.lastTickWall = -Infinity;
  rt.holdMsTotal = 0;
}

export function trafficFlowStats(): FlowStats & { live: boolean; holdMsTotal: number; mode: string } {
  return { ...flowStats(rt.flow), live: live(), holdMsTotal: rt.holdMsTotal, mode: rt.flow.cfg.signalMode };
}

/** Test/probe access to the core state. */
export function trafficFlowState(): FlowState {
  return rt.flow;
}

if (typeof window !== "undefined") {
  (window as unknown as { __traffic?: unknown }).__traffic = {
    stats: trafficFlowStats,
    config: (patch?: TrafficFlowOptions) => {
      if (patch) configureTrafficFlow(patch);
      return { ...rt.flow.cfg, enabled: rt.enabled, heat: rt.heat, lights: rt.lights, markings: rt.markings };
    },
    heat: (on = !rt.heat) => { rt.heat = on; return on; },
    enable: (on = true) => { rt.enabled = on; return on; },
    incident: (tx?: number, ty?: number, ms?: number) =>
      addIncident(rt.flow, tx !== undefined && ty !== undefined ? ty * MAP_W + tx : undefined, ms),
    clear: () => clearIncidents(rt.flow),
    towns: () => [...rt.flow.signals.values()].map((s) => ({ ...s, demand: [...s.demand] })),
    factorAt: (tx: number, ty: number) => tileFactor(rt.flow, ty * MAP_W + tx),
    defaults: () => ({ ...DEFAULT_FLOW_CONFIG }),
  };
}
