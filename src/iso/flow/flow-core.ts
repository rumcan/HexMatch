// ══════════════════════════════════════════════════════════════════════════
// FLOW-1 — the traffic simulation core. PURE: no DOM, no game imports.
//
// A deliberately small macro/micro hybrid. It is cheap enough to run every
// frame on a 144×144 map and strong enough that the player can FEEL it:
//
//   1. SIGNALS. One controller per town (the same granularity `ambience.ts`
//      already uses, so every existing caller of `lightAspect` keeps its
//      meaning). Two modes:
//        • "fixed"    — a bit-exact replica of AMB-3's seeded 9 s cycle.
//        • "actuated" — demand-responsive: min/max green, gap-out, a switch
//                       when the cross street's queue outweighs ours, amber and
//                       an all-red clearance. Waiting lorries weigh extra
//                       (freight priority), so a well-placed depot is not
//                       starved by town cars.
//   2. DENSITY FIELD. One Float32 per tile, only road tiles are ever touched.
//      target = background demand × rush-hour wave + observed vehicles (PCU),
//      smoothed with an exponential filter. Every visible car stands for a
//      few unseen ones (`carPcu`), so twelve sprites can fill a high street.
//   3. SPEED. The BPR volume-delay function
//          f = 1 / (1 + α·(k / capacity)^β)
//      per tile, clamped at `minSpeedFactor`. Capacity follows the road tier
//      (dirt < street < road < highway), so paving and highways are ALSO a
//      congestion remedy, not only a speed bump.
//   4. INCIDENTS. Seeded, rare, placed where the traffic is. They cut a tile's
//      capacity for a while — a reason to have a second route.
//
// Everything is O(road tiles) per step at 10 Hz and O(1) per query. There is
// no pathfinding in here and no per-vehicle allocation.
// ══════════════════════════════════════════════════════════════════════════

export type FlowAspect = "green" | "amber" | "red";
export type FlowAxis = 0 | 1;
export type SignalMode = "actuated" | "fixed";

export interface FlowConfig {
  signalMode: SignalMode;
  // ── fixed cycle (mirrors ambience.ts LIGHT_* exactly) ──
  cycleMs: number;
  fixedGreenMs: number;
  fixedAmberMs: number;
  // ── actuated ──
  minGreenMs: number;
  maxGreenMs: number;
  amberMs: number;
  allRedMs: number;
  /** Force a change after this long even with no demand (pedestrians cross on red). */
  restCycleMs: number;
  /** PCU below which an approach counts as empty (gap-out). */
  gapPcu: number;
  /** The cross street wins once its demand exceeds ours by this ratio. */
  switchRatio: number;
  /** Weight of a waiting lorry against a waiting car. */
  truckPriority: number;
  // ── density ──
  carPcu: number;
  truckPcu: number;
  backgroundScale: number;
  rushPeriodMs: number;
  rushAmplitude: number;
  densityTauMs: number;
  // ── speed (BPR) ──
  bprAlpha: number;
  bprBeta: number;
  minSpeedFactor: number;
  /** 0 = traffic never slows lorries, 1 = full effect. */
  truckImpact: number;
  // ── stop lines ──
  holdTiles: number;
  amberCommitTiles: number;
  /** Safety valve: nothing waits at one light longer than this. */
  maxHoldMs: number;
  // ── incidents ──
  incidents: boolean;
  incidentEveryMs: number;
  incidentMinMs: number;
  incidentMaxMs: number;
  incidentCapacity: number;
  maxIncidents: number;
}

export const DEFAULT_FLOW_CONFIG: Readonly<FlowConfig> = {
  signalMode: "actuated",
  cycleMs: 9000,
  fixedGreenMs: 3600,
  fixedAmberMs: 900,
  minGreenMs: 2800,
  // Longest red = maxGreen + amber + all-red ≈ 10.4 s, safely under cars.ts's
  // 12 s JAM_TIMEOUT_MS, so a car queued at a light is never despawned as jammed.
  maxGreenMs: 9000,
  amberMs: 900,
  allRedMs: 450,
  restCycleMs: 14000,
  gapPcu: 0.45,
  switchRatio: 1.6,
  truckPriority: 2.5,
  carPcu: 3,
  truckPcu: 2.5,
  backgroundScale: 1,
  rushPeriodMs: 240000,
  rushAmplitude: 0.6,
  densityTauMs: 1500,
  bprAlpha: 0.15,
  bprBeta: 4,
  minSpeedFactor: 0.4,
  truckImpact: 1,
  holdTiles: 0.6,          // stop line (~0.48) + half a lorry: the nose stops at the line
  amberCommitTiles: 0.16,
  maxHoldMs: 20000,
  incidents: true,
  incidentEveryMs: 45000,
  incidentMinMs: 20000,
  incidentMaxMs: 40000,
  incidentCapacity: 0.35,
  maxIncidents: 3,
};

/** Simulation sub-step. Queries between steps read the last field. */
export const FLOW_STEP_MS = 100;
/** Salt for the incident RNG, so it never shares a stream with cars or walkers. */
const FLOW_SALT = 0x7a11f10e;

export interface FlowJunction {
  i: number;
  x: number;
  y: number;
  townId: number;
  /** Unit-ish neighbour offsets (sign vectors) of every connected arm. */
  arms: [number, number][];
}

export interface FlowTownInput {
  id: number;
  tx: number;
  ty: number;
  /** Relative busyness (ambience.townTrafficWeight). */
  weight: number;
  /** Background falloff radius in tiles. */
  radius?: number;
}

export interface FlowNetworkInput {
  mapW: number;
  mapH: number;
  seed: number;
  /** Tile index → connected tile indices (the ambient road graph). */
  graph: ReadonlyMap<number, readonly number[]>;
  /** Signalised tile index → town id. */
  junctions: ReadonlyMap<number, number>;
  towns: readonly FlowTownInput[];
  /** Jam capacity of a tile in PCU. */
  capacityOf: (i: number) => number;
  /** Optional through-traffic background (PCU) for a tile, e.g. highways. */
  corridorOf?: (i: number) => number;
}

export interface TownSignal {
  townId: number;
  green: FlowAxis;
  stage: "green" | "amber" | "allred";
  t: number;
  demand: [number, number];
  offset: number;
  switches: number;
}

export interface FlowIncident {
  i: number;
  x: number;
  y: number;
  startMs: number;
  untilMs: number;
  capacity: number;
}

export interface FlowObservation {
  i: number;
  pcu: number;
}

export interface FlowStats {
  time: number;
  rush: number;
  tiles: number;
  junctions: number;
  towns: number;
  meanDensity: number;
  maxDensity: number;
  congested: number;
  incidents: number;
  stepCostMs: number;
  switches: number;
}

export interface FlowState {
  cfg: FlowConfig;
  seed: number;
  mapW: number;
  mapH: number;
  time: number;
  accum: number;
  tiles: Int32Array;
  bgBase: Float32Array;
  cap: Float32Array;
  live: Float32Array;
  dens: Float32Array;
  liveTouched: number[];
  junctions: Map<number, FlowJunction>;
  townJunctions: Map<number, FlowJunction[]>;
  signals: Map<number, TownSignal>;
  incidents: FlowIncident[];
  incidentAt: Map<number, FlowIncident>;
  nextIncidentMs: number;
  rng: () => number;
  sources: Map<string, readonly FlowObservation[]>;
  /** key townId*2+axis → vehicle id → weighted PCU, cleared every step. */
  waiting: Map<number, Map<number | string, number>>;
  rev: number;
  stats: FlowStats;
}

// ── helpers ─────────────────────────────────────────────────────────────
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** 0 = tile-x, 1 = tile-y. Identical to ambience.axisOf. */
export function axisOf(dx: number, dy: number): FlowAxis {
  return Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
}

const emptyStats = (): FlowStats => ({
  time: 0, rush: 1, tiles: 0, junctions: 0, towns: 0, meanDensity: 0,
  maxDensity: 0, congested: 0, incidents: 0, stepCostMs: 0, switches: 0,
});

const now = (): number =>
  (typeof performance !== "undefined" && typeof performance.now === "function")
    ? performance.now() : Date.now();

// ── construction ────────────────────────────────────────────────────────
export function createFlowState(cfg?: Partial<FlowConfig>, seed = 0x5eed): FlowState {
  return {
    cfg: { ...DEFAULT_FLOW_CONFIG, ...(cfg ?? {}) },
    seed,
    mapW: 0,
    mapH: 0,
    time: 0,
    accum: 0,
    tiles: new Int32Array(0),
    bgBase: new Float32Array(0),
    cap: new Float32Array(0),
    live: new Float32Array(0),
    dens: new Float32Array(0),
    liveTouched: [],
    junctions: new Map(),
    townJunctions: new Map(),
    signals: new Map(),
    incidents: [],
    incidentAt: new Map(),
    nextIncidentMs: 0,
    rng: mulberry32((seed ^ FLOW_SALT) >>> 0),
    sources: new Map(),
    waiting: new Map(),
    rev: 0,
    stats: emptyStats(),
  };
}

/**
 * (Re)build the network. Keeps the density of tiles that survive and the
 * phase of every town controller that survives, so a road edit never makes
 * the lights jump or the congestion blink.
 */
export function rebuildFlow(s: FlowState, input: FlowNetworkInput): void {
  const { mapW, mapH } = input;
  const size = mapW * mapH;
  const resized = size !== s.dens.length;
  const oldDens = s.dens;
  s.mapW = mapW;
  s.mapH = mapH;
  if (s.seed !== input.seed) {
    s.seed = input.seed;
    s.rng = mulberry32((input.seed ^ FLOW_SALT) >>> 0);
  }
  if (resized) {
    s.bgBase = new Float32Array(size);
    s.cap = new Float32Array(size);
    s.live = new Float32Array(size);
    s.dens = new Float32Array(size);
    s.liveTouched = [];
  } else {
    s.bgBase.fill(0);
    s.cap.fill(0);
  }

  const tiles: number[] = [];
  for (const i of input.graph.keys()) {
    if (i < 0 || i >= size) continue;
    tiles.push(i);
  }
  tiles.sort((a, b) => a - b);
  s.tiles = Int32Array.from(tiles);

  const inNet = new Uint8Array(size);
  for (const i of tiles) inNet[i] = 1;
  if (!resized) {
    // Forget density on tiles that are no longer road.
    for (let i = 0; i < size; i++) if (!inNet[i] && oldDens[i] !== 0) oldDens[i] = 0;
  }

  // Background demand: every town radiates trips, falling off with distance.
  for (const i of tiles) {
    const x = i % mapW, y = (i / mapW) | 0;
    let bg = input.corridorOf ? input.corridorOf(i) : 0;
    for (const t of input.towns) {
      const r = t.radius ?? 6;
      const d = Math.hypot(x - t.tx, y - t.ty);
      if (d > r * 3.5) continue;
      bg += 1.25 * t.weight * Math.exp(-d / r);
    }
    s.bgBase[i] = bg;
    s.cap[i] = Math.max(0.5, input.capacityOf(i));
  }

  // Junctions with their arms.
  s.junctions.clear();
  s.townJunctions.clear();
  for (const [i, townId] of input.junctions) {
    if (i < 0 || i >= size) continue;
    const x = i % mapW, y = (i / mapW) | 0;
    const arms: [number, number][] = [];
    for (const nb of input.graph.get(i) ?? []) {
      const nx = nb % mapW, ny = (nb / mapW) | 0;
      arms.push([Math.sign(nx - x), Math.sign(ny - y)]);
    }
    if (arms.length < 3) continue;
    const j: FlowJunction = { i, x, y, townId, arms };
    s.junctions.set(i, j);
    let list = s.townJunctions.get(townId);
    if (!list) { list = []; s.townJunctions.set(townId, list); }
    list.push(j);
  }

  // Controllers: keep survivors, seed newcomers from the map seed.
  const next = new Map<number, TownSignal>();
  for (const townId of s.townJunctions.keys()) {
    const prev = s.signals.get(townId);
    if (prev) { next.set(townId, prev); continue; }
    const h = (s.seed ^ Math.imul(townId + 1, 0x9e3779b1)) >>> 0;
    next.set(townId, {
      townId,
      green: (h & 1) as FlowAxis,
      stage: "green",
      t: h % Math.max(1, s.cfg.minGreenMs),
      demand: [0, 0],
      offset: h % s.cfg.cycleMs,
      switches: 0,
    });
  }
  s.signals = next;

  // Incidents on tiles that vanished go with them.
  s.incidents = s.incidents.filter((inc) => inNet[inc.i] === 1);
  s.incidentAt = new Map(s.incidents.map((inc) => [inc.i, inc]));
  if (s.nextIncidentMs === 0) s.nextIncidentMs = s.time + s.cfg.incidentEveryMs;

  s.rev++;
  s.stats.tiles = tiles.length;
  s.stats.junctions = s.junctions.size;
  s.stats.towns = s.signals.size;
}

// ── observation ─────────────────────────────────────────────────────────
/**
 * Publish the latest snapshot of one vehicle population ("cars", "trucks",
 * …). Each source replaces its previous snapshot, so the density does not
 * depend on how many frames ran between two flow steps.
 */
export function setSource(s: FlowState, name: string, obs: readonly FlowObservation[]): void {
  s.sources.set(name, obs);
}

/** Split one vehicle between the two tiles of its current leg. */
export function observePose(
  out: FlowObservation[], mapW: number,
  route: readonly (readonly [number, number])[], leg: number, t: number, pcu: number,
): void {
  const n = route.length;
  if (n === 0) return;
  if (n === 1) { out.push({ i: route[0][1] * mapW + route[0][0], pcu }); return; }
  const k = Math.min(Math.max(leg, 0), n - 2);
  const a = route[k], b = route[k + 1];
  const tt = Math.min(1, Math.max(0, t));
  out.push({ i: a[1] * mapW + a[0], pcu: pcu * (1 - tt) });
  out.push({ i: b[1] * mapW + b[0], pcu: pcu * tt });
}

/** A vehicle is standing at a red light. Weighted into the town's demand. */
export function noteWaiting(
  s: FlowState, townId: number, axis: FlowAxis, id: number | string, pcu: number,
): void {
  const key = townId * 2 + axis;
  let m = s.waiting.get(key);
  if (!m) { m = new Map(); s.waiting.set(key, m); }
  m.set(id, pcu);
}

// ── the step ────────────────────────────────────────────────────────────
export function rushFactor(s: FlowState, time = s.time): number {
  const { rushPeriodMs, rushAmplitude } = s.cfg;
  if (!(rushPeriodMs > 0)) return 1;
  const w = Math.sin((2 * Math.PI * time) / rushPeriodMs);
  return 1 - rushAmplitude + rushAmplitude * w * w;
}

/** Advance the clock. Returns true when a sub-step actually ran. */
export function stepFlow(s: FlowState, dtMs: number): boolean {
  if (!(dtMs > 0)) return false;
  // A background tab can hand us minutes; the field only needs the last few seconds.
  const dt = Math.min(dtMs, 5000);
  s.time += dt;
  s.accum += dt;
  if (s.accum < FLOW_STEP_MS) return false;
  const h = s.accum;
  s.accum = 0;
  const t0 = now();

  // 1. Observed vehicles → live field.
  for (const i of s.liveTouched) s.live[i] = 0;
  s.liveTouched.length = 0;
  const size = s.live.length;
  for (const obs of s.sources.values()) {
    for (const o of obs) {
      if (o.i < 0 || o.i >= size || !(o.pcu > 0)) continue;
      if (s.live[o.i] === 0) s.liveTouched.push(o.i);
      s.live[o.i] += o.pcu;
    }
  }

  // 2. Smooth the density towards background × rush + live.
  const alpha = 1 - Math.exp(-h / Math.max(1, s.cfg.densityTauMs));
  const rush = rushFactor(s);
  const bgMul = rush * s.cfg.backgroundScale;
  let sum = 0, max = 0, congested = 0;
  const tiles = s.tiles;
  for (let n = 0; n < tiles.length; n++) {
    const i = tiles[n];
    const target = s.bgBase[i] * bgMul + s.live[i];
    const d = s.dens[i] + (target - s.dens[i]) * alpha;
    s.dens[i] = d;
    sum += d;
    if (d > max) max = d;
    if (tileFactor(s, i) < 0.7) congested++;
  }

  // 3. Signals.
  stepSignals(s, h);

  // 4. Incidents.
  stepIncidents(s);

  s.stats.time = s.time;
  s.stats.rush = rush;
  s.stats.meanDensity = tiles.length ? sum / tiles.length : 0;
  s.stats.maxDensity = max;
  s.stats.congested = congested;
  s.stats.incidents = s.incidents.length;
  s.stats.stepCostMs = now() - t0;
  return true;
}

function stepSignals(s: FlowState, h: number): void {
  const cfg = s.cfg;
  const W = s.mapW;
  for (const [townId, sig] of s.signals) {
    // Demand = density on every approach tile, per axis, plus the queue.
    let d0 = 0, d1 = 0;
    for (const j of s.townJunctions.get(townId) ?? []) {
      for (const [ax, ay] of j.arms) {
        const ni = (j.y + ay) * W + (j.x + ax);
        const v = ni >= 0 && ni < s.dens.length ? s.dens[ni] : 0;
        if (axisOf(ax, ay) === 0) d0 += v; else d1 += v;
      }
    }
    const w0 = s.waiting.get(townId * 2);
    const w1 = s.waiting.get(townId * 2 + 1);
    if (w0) for (const v of w0.values()) d0 += v;
    if (w1) for (const v of w1.values()) d1 += v;
    sig.demand[0] = d0;
    sig.demand[1] = d1;

    if (cfg.signalMode === "fixed") continue;
    sig.t += h;
    if (sig.stage === "green") {
      if (sig.t < cfg.minGreenMs) continue;
      const cur = sig.demand[sig.green];
      const oth = sig.demand[1 - sig.green];
      const crossWaiting = oth > cfg.gapPcu;
      const gapOut = cur < cfg.gapPcu && crossWaiting;
      const outweighed = crossWaiting && oth > cur * cfg.switchRatio;
      const maxedOut = sig.t >= cfg.maxGreenMs && crossWaiting;
      const rest = sig.t >= cfg.restCycleMs;
      if (gapOut || outweighed || maxedOut || rest) { sig.stage = "amber"; sig.t = 0; }
    } else if (sig.stage === "amber") {
      if (sig.t >= cfg.amberMs) { sig.stage = "allred"; sig.t = 0; }
    } else if (sig.t >= cfg.allRedMs) {
      sig.green = (1 - sig.green) as FlowAxis;
      sig.stage = "green";
      sig.t = 0;
      sig.switches++;
      s.stats.switches++;
    }
  }
  s.waiting.clear();
}

function stepIncidents(s: FlowState): void {
  if (s.incidents.length) {
    const keep = s.incidents.filter((inc) => inc.untilMs > s.time);
    if (keep.length !== s.incidents.length) {
      s.incidents = keep;
      s.incidentAt = new Map(keep.map((inc) => [inc.i, inc]));
    }
  }
  const cfg = s.cfg;
  if (!cfg.incidents || s.tiles.length < 8) return;
  if (s.time < s.nextIncidentMs) return;
  s.nextIncidentMs = s.time + cfg.incidentEveryMs * (0.6 + 0.8 * s.rng());
  if (s.incidents.length >= cfg.maxIncidents) return;
  // Accidents happen where the traffic is: best of a dozen random samples.
  let best = -1, bestD = -1;
  for (let k = 0; k < 12; k++) {
    const i = s.tiles[Math.floor(s.rng() * s.tiles.length)];
    if (s.junctions.has(i) || s.incidentAt.has(i)) continue;
    const d = s.dens[i] + s.rng() * 0.05;
    if (d > bestD) { bestD = d; best = i; }
  }
  if (best >= 0) addIncident(s, best);
}

/** Start an incident on tile i (debug console / demo button use it too). */
export function addIncident(s: FlowState, i?: number, durationMs?: number): FlowIncident | null {
  if (!s.tiles.length) return null;
  const tile = i ?? s.tiles[Math.floor(s.rng() * s.tiles.length)];
  if (s.incidentAt.has(tile)) return s.incidentAt.get(tile)!;
  const cfg = s.cfg;
  const dur = durationMs ?? (cfg.incidentMinMs + s.rng() * (cfg.incidentMaxMs - cfg.incidentMinMs));
  const inc: FlowIncident = {
    i: tile,
    x: tile % s.mapW,
    y: (tile / s.mapW) | 0,
    startMs: s.time,
    untilMs: s.time + dur,
    capacity: cfg.incidentCapacity,
  };
  s.incidents.push(inc);
  s.incidentAt.set(tile, inc);
  s.stats.incidents = s.incidents.length;
  return inc;
}

export function clearIncidents(s: FlowState): void {
  s.incidents = [];
  s.incidentAt.clear();
  s.stats.incidents = 0;
}

// ── queries ─────────────────────────────────────────────────────────────
/** BPR speed factor on one tile. 1 on anything that is not in the network. */
export function tileFactor(s: FlowState, i: number, selfPcu = 0): number {
  const cap0 = s.cap[i];
  if (!(cap0 > 0)) return 1;
  const inc = s.incidentAt.size ? s.incidentAt.get(i) : undefined;
  const cap = inc ? cap0 * inc.capacity : cap0;
  const k = Math.max(0, s.dens[i] - selfPcu);
  const ratio = k / cap;
  const f = 1 / (1 + s.cfg.bprAlpha * Math.pow(ratio, s.cfg.bprBeta));
  return Math.max(s.cfg.minSpeedFactor, Math.min(1, f));
}

/** Mean factor over the two tiles of a leg. */
export function segmentFactor(s: FlowState, ai: number, bi: number, selfPcu = 0): number {
  if (!s.tiles.length) return 1;
  return (tileFactor(s, ai, selfPcu * 0.5) + tileFactor(s, bi, selfPcu * 0.5)) / 2;
}

/** AMB-3's seeded fixed cycle, bit for bit. */
export function fixedAspect(
  cfg: Pick<FlowConfig, "cycleMs" | "fixedGreenMs" | "fixedAmberMs">,
  seed: number, townId: number, axis: FlowAxis, timeMs: number,
): FlowAspect {
  const C = cfg.cycleMs;
  const offset = ((seed ^ Math.imul(townId + 1, 0x9e3779b1)) >>> 0) % C;
  let t = (((timeMs + offset) % C) + C) % C;
  if (axis === 1) t = (t + C / 2) % C;
  if (t < cfg.fixedGreenMs) return "green";
  if (t < cfg.fixedGreenMs + cfg.fixedAmberMs) return "amber";
  return "red";
}

export function flowAspect(s: FlowState, townId: number, axis: FlowAxis, timeMs = s.time): FlowAspect {
  const sig = s.signals.get(townId);
  if (s.cfg.signalMode === "fixed" || !sig) return fixedAspect(s.cfg, s.seed, townId, axis, timeMs);
  if (sig.green !== axis) return "red";
  if (sig.stage === "green") return "green";
  if (sig.stage === "amber") return "amber";
  return "red";
}

export interface SignalApproach {
  junction: FlowJunction;
  axis: FlowAxis;
  /** Leg fraction the vehicle must not pass. */
  stopT: number;
  /** Distance in tiles to the junction tile's centre. */
  remaining: number;
}

/** The signalised junction a pose is driving towards on its current leg, if any. */
export function approachFor(
  s: FlowState,
  route: readonly (readonly [number, number])[], leg: number, t: number, reverse: boolean,
): SignalApproach | null {
  const n = route.length;
  if (n < 2 || s.junctions.size === 0) return null;
  const k = Math.min(Math.max(leg, 0), n - 2);
  const a = route[k], b = route[k + 1];
  const tile = reverse ? a : b;
  const from = reverse ? b : a;
  const j = s.junctions.get(tile[1] * s.mapW + tile[0]);
  if (!j) return null;
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const hold = Math.min(s.cfg.holdTiles, segLen * 0.7);
  return {
    junction: j,
    axis: axisOf(tile[0] - from[0], tile[1] - from[1]),
    stopT: reverse ? hold / segLen : 1 - hold / segLen,
    remaining: (reverse ? t : 1 - t) * segLen,
  };
}

/**
 * The stop-line `t` this pose must respect right now, or null when it may
 * go: green, no signal, already past the line (committed), or on amber too
 * close to stop comfortably.
 */
export function signalStop(
  s: FlowState,
  route: readonly (readonly [number, number])[], leg: number, t: number, reverse: boolean,
  timeMs = s.time,
): number | null {
  const ap = approachFor(s, route, leg, t, reverse);
  if (!ap) return null;
  const segLen = (() => {
    const k = Math.min(Math.max(leg, 0), route.length - 2);
    const a = route[k], b = route[k + 1];
    return Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  })();
  const hold = (reverse ? ap.stopT : 1 - ap.stopT) * segLen;
  if (ap.remaining < hold - 1e-6) return null;          // past the line
  const aspect = flowAspect(s, ap.junction.townId, ap.axis, timeMs);
  if (aspect === "green") return null;
  if (aspect === "amber" && ap.remaining < hold + s.cfg.amberCommitTiles) return null;
  return ap.stopT;
}

export function flowStats(s: FlowState): FlowStats {
  return { ...s.stats };
}
