// ══════════════════════════════════════════════════════════════════════════
// AMB-3 (#392) — busier towns: density, pedestrians, traffic lights.
//
// Cosmetic only. Nothing here is saved and nothing goes on the wire: every
// client rebuilds the same lights and walkers from the map seed. Cargo trucks
// are NOT stepped by this module. A truck may be DRAWN held at a red light
// (`stepGhost`) while its economic pose — the one `tickTrucks` integrates and
// the one that increments `deliveries` — keeps the old clock.
//
// Level of detail: pedestrians only at the closest zoom, cars and lights from
// the medium zoom, and the whole layer off in performance mode.
//
// ART. Placeholder vector drawings until the lead's rundot sprites land.
// `AMBIENT_ART_NEEDED` is the list; `AMBIENT_ART_NOTES` is the cut. When the
// atlas has `car_sedan_se` the game depth-sorts those sprites and this painter
// stops drawing cars.
// ══════════════════════════════════════════════════════════════════════════
import { HH, MAP_W, mulberry32, tileToScreen, type Zoom } from "../game/config";
import type { Grid, Town } from "./grid";
import { liftAt } from "./elevation";
import { worldToScreen, type Camera } from "./camera";
import {
  PRESENT, ROAD_TIER, inMapT, tIdx, type Track,
} from "./track";
import { ambientRoadGraph } from "./road-routing";
import { TRUCK_SPEED, TRUCK_ROAD_MULT } from "./vehicles";
import { uphillSpeed } from "./slopes";
// FLOW-1: the traffic module owns the live lights, their art and the clock.
import { flowLightAspect, flowTick, paintFlowOverlay } from "./flow";
import { truckKey } from "./fleet";

// ── art the lead ships ────────────────────────────────────────────────────
/** 1950s–60s models. Two finned-sedan liveries, a pickup, a bus, a van. */
export const CAR_MODELS = ["sedan", "sedan2", "pickup", "bus", "van"] as const;
export type CarModel = (typeof CAR_MODELS)[number];
export const CAR_VIEWS = ["ne", "se", "sw", "nw"] as const;
export type CarView = (typeof CAR_VIEWS)[number];

/** Sprite name the atlas should carry for one model and one heading. */
export const modelSpriteName = (model: CarModel, view: string): string =>
  `car_${model}_${view}`;

/**
 * Every sprite #392 wants. Nothing here is required: until these land the
 * painter draws vector stand-ins, and cars keep the shipped `car1_*` cells
 * as a depth-sorted fallback when the game asks for them.
 */
export const AMBIENT_ART_NEEDED: readonly string[] = [
  ...CAR_MODELS.flatMap((m) => CAR_VIEWS.map((v) => modelSpriteName(m, v))),
  ...CAR_VIEWS.flatMap((v) => [0, 1].map((f) => `ped_walk_${v}_${f}`)),
  "traffic_light_green",
  "traffic_light_amber",
  "traffic_light_red",
];

/** Cut notes for the lead. Sizes are the 1× sprite, anchor at the feet. */
export const AMBIENT_ART_NOTES: readonly string[] = [
  "car_<model>_<ne|se|sw|nw> — 1950s–60s vehicle, transparent PNG, anchor bottom-centre. sedan / sedan2 are finned sedans (~22×14, teal #1f6f78 and cherry #c23b3b). pickup ~24×14 olive #3d6b3a. bus ~32×16 school-bus yellow #d4a017. van is a delivery van ~22×14 charcoal #2c3a4a. Four diagonal headings, the same ne/se/sw/nw the lorries use.",
  "ped_walk_<ne|se|sw|nw>_<0|1> — tiny walker, about 8×14, two-frame walk (legs apart / legs together), anchor at the feet. Coat #3a342c, hat #f2e6c9.",
  "traffic_light_<green|amber|red> — a kerb pole about 8×18 with one lit aspect. Drawn at the sidewalk corner of a town junction; the three files are the three aspects of one prop.",
];

/** Placeholder palette — what the vector stand-in draws, and what the sprites should match. */
export const CAR_ART: Record<CarModel, { body: string; trim: string; length: number; width: number }> = {
  sedan: { body: "#1f6f78", trim: "#f2e6c9", length: 22, width: 10 },
  sedan2: { body: "#c23b3b", trim: "#f4e7c5", length: 22, width: 10 },
  pickup: { body: "#3d6b3a", trim: "#d9d2c5", length: 24, width: 11 },
  bus: { body: "#d4a017", trim: "#f7f1e1", length: 32, width: 12 },
  van: { body: "#2c3a4a", trim: "#e8e0d0", length: 22, width: 11 },
};

/** Deterministic model for car N. Same index and seed → same model on every client. */
export function carModelOf(index: number, seed = 0): CarModel {
  const n = (Math.imul(index, 0x9e3779b1) ^ seed) >>> 0;
  return CAR_MODELS[n % CAR_MODELS.length];
}

// ── caps and level of detail ──────────────────────────────────────────────
/** Hard cap on cars the automatic budget will plan. The perf dial may still ask for more. */
// Owner (2026-09-29): "why so little cars" / "upgraded to city and there are no cars".
export const CAR_HARD_CAP = 96;
/** Hard cap on pedestrians simulated at once. */
export const PED_HARD_CAP = 28;
/** Cars + pedestrians. Lights are not actors — they are a phase function. */
export const AMBIENT_ACTOR_CAP = CAR_HARD_CAP + PED_HARD_CAP;
/** How many cars a screen will draw. The rest keep simulating off-screen, under the hard cap. */
export const SCREEN_CAR_CAP = 40;
/** How many pedestrians a screen will draw. */
export const SCREEN_PED_CAP = 16;
/** How many light poles a screen will draw. */
export const SCREEN_LIGHT_CAP = 24;

/** Medium zoom and closer (`ZOOM_STEPS` is 0.5 / 1 / 2). */
export const CAR_MIN_ZOOM: Zoom = 1;
/** Closest zoom only. */
export const PED_MIN_ZOOM: Zoom = 2;

export type AmbienceKind = "cars" | "peds" | "lights";

/** What the current zoom and performance mode should show. Pure. */
export function ambienceVisible(kind: AmbienceKind, zoom: number, performance: boolean): boolean {
  if (performance) return false;
  if (kind === "peds") return zoom >= PED_MIN_ZOOM;
  return zoom >= CAR_MIN_ZOOM;
}

/** Keep the nearest `cap` items. Stable for ties (lower original index wins). */
export function selectOnScreen<T>(items: readonly T[], cap: number, rank: (item: T, index: number) => number): T[] {
  if (items.length <= cap) return items.slice();
  return items
    .map((item, index) => ({ item, index, rank: rank(item, index) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, cap)
    .map((row) => row.item);
}

// ── density ───────────────────────────────────────────────────────────────
/** The three things every density reader here asks a town for. */
export interface TownTrafficShape {
  houses?: readonly unknown[];
  roads?: readonly unknown[];
  level?: number;
}

/**
 * How busy one town should feel. Size (houses or streets, whichever is
 * larger) and the city-upgrade tier both raise it. An absent tier is the
 * legacy look and weighs 1, so an old map does not suddenly empty.
 */
export function townTrafficWeight(town: TownTrafficShape): number {
  const size = Math.max(1, town.houses?.length ?? 0, town.roads?.length ?? 0);
  // Owner (2026-09-29): a city must look busy. ~3× the old volume, and each
  // tier counts for more (a level-1 city: ×1.4, level 2: ×1.9).
  const tierMul = town.level === undefined ? 1 : 0.9 + Math.max(0, town.level) * 0.5;
  return (2 + Math.sqrt(size) / 1.6) * tierMul;
}

/**
 * TOWN-4.5 (#681): the most ambient traffic ONE town may ask for, in car
 * units — the ceiling on `townTrafficWeight` wherever CARS are concerned.
 *
 * Why. A town's weight rises with its size, and the ambient car budget is the
 * sum of the weights, so a bigger town used to mean more cars on the map —
 * and more cars is more PCU in the traffic field, which is exactly what
 * `traffic-income.ts` folds into a depot's income (`trafficFactorOf`). The
 * planned towns of the TOWN-4 epic are several times the size of a grid town
 * (epic target: ~30–40 tiles along the avenue × 20–28 across at tier 3), so
 * "bigger towns must not slow lorries" needs a ceiling.
 *
 * The number is MEASURED, not tuned. On the standard 144 grid map, with every
 * town at tier 3 (`level` 3, the top `TOWN_VISUAL_MAX` tier), over seeds
 * 1…60 the heaviest town weighed 26.8454076850486 — seed 1's 169-house /
 * 216-road capital, i.e. `(2 + √216 / 1.6) × (0.9 + 3 × 0.5)` in
 * `townTrafficWeight`'s own terms (spelled out here so the pin is exact, not
 * a rounded copy of itself). The other tier-3 towns came in at 19.50–26.85,
 * villages at 6.7–10.1. Pinning the ceiling at that measured maximum means NO
 * grid town is ever capped, so every boot that exists today (grid maps, story
 * chapters, scenarios, the Starter Island, an old save) budgets exactly the
 * cars it always did — while a planned town (or any future town bigger than
 * today's biggest) can ask for no more than today's biggest grid town.
 *
 * The ceiling covers the CAR budget and the cars' trip weighting
 * (`townCarWeight` below, and `townWeights` in cars.ts). Pedestrians keep the
 * raw weight: walkers are cosmetic, never touch the traffic field, and a big
 * planned city should still look busy on the pavement.
 */
export const TOWN_AMBIENT_CAR_CAP = (2 + Math.sqrt(216) / 1.6) * 2.4;

/**
 * TOWN-4.5: the town's traffic weight as far as AMBIENT CARS are concerned —
 * `townTrafficWeight` clamped to `TOWN_AMBIENT_CAR_CAP`.
 *
 * This is the number to use anywhere a town's size decides how many cars it
 * gets (the map budget, the trip weighting). `townTrafficWeight` stays the
 * raw "how busy should this town feel" for the walkers and for flow's own
 * background demand (which restates the raw formula on purpose — see
 * `townWeight` in flow/index.ts).
 */
export function townCarWeight(town: TownTrafficShape): number {
  return Math.min(TOWN_AMBIENT_CAR_CAP, townTrafficWeight(town));
}

/**
 * Cars the map wants, before the game's floor of `CAR_COUNT`. Capped.
 * The coefficient is low on purpose: a standard four-town island budgets
 * under that floor, so a fresh game still boots at the TRAFFIC-01 volume.
 * A city upgrade (or a genuinely larger town) pushes it over the floor.
 *
 * TOWN-4.5: each town contributes its `townCarWeight` — its weight, capped at
 * `TOWN_AMBIENT_CAR_CAP` — so a planned (much larger) town cannot inflate the
 * map's budget past what the heaviest tier-3 grid town asks for.
 */
export function ambientCarBudget(towns: readonly TownTrafficShape[] | null | undefined): number {
  if (!towns?.length) return 0;
  let n = 0;
  for (const t of towns) n += townCarWeight(t);
  return Math.min(CAR_HARD_CAP, Math.max(1, Math.round(n)));
}

/** Pedestrians the map wants. Scales with the same weight, no floor. */
export function ambientPedBudget(towns: readonly TownTrafficShape[] | null | undefined): number {
  if (!towns?.length) return 0;
  // Low enough that a standard island is not already at the cap, so a city
  // upgrade still puts more people on the pavement.
  let n = 0;
  for (const t of towns) n += 0.5 + townTrafficWeight(t) * 1.15;
  return Math.min(PED_HARD_CAP, Math.max(0, Math.round(n)));
}

/** Cars take their budget first; pedestrians fill what the actor cap leaves. */
export function clampBudgets(cars: number, peds: number): { cars: number; peds: number } {
  const c = Math.max(0, Math.min(CAR_HARD_CAP, Math.floor(cars)));
  const p = Math.max(0, Math.min(PED_HARD_CAP, Math.floor(peds), AMBIENT_ACTOR_CAP - c));
  return { cars: c, peds: p };
}

// ── traffic lights ────────────────────────────────────────────────────────
export const LIGHT_CYCLE_MS = 9000;
export const LIGHT_GREEN_MS = 3600;
export const LIGHT_AMBER_MS = 900;
/** Approach distance at which a vehicle holds, in tiles. */
// Owner (2026-09-29): "they drive too deep into intersections". The FLOW-1
// stop line sits ~0.48 from the junction centre; the pose is the car's centre,
// so hold half a car further back and the nose stops AT the line.
export const LIGHT_HOLD_TILES = 0.6;

export type LightAspect = "green" | "amber" | "red";
export type RoadAxis = 0 | 1;

/** 0 = tile-x (SE/NW), 1 = tile-y (NE/SW). A zero step is axis 0. */
export function axisOf(dx: number, dy: number): RoadAxis {
  return Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
}

/**
 * Aspect for one axis of one town. Axis 1 is half a cycle behind axis 0, so
 * the two are never green together: green, amber, then an all-red beat, then
 * the other axis. The town's offset comes from the seed, so two clients of
 * the same map agree without a message.
 */
export function lightAspect(seed: number, townId: number, axis: RoadAxis, timeMs: number): LightAspect {
  // FLOW-1: demand-actuated lights while the traffic module is live. Null in
  // "fixed" mode (or before the first tick) keeps the seeded cycle below.
  const flow = flowLightAspect(townId, axis);
  if (flow) return flow;
  const offset = ((seed ^ Math.imul(townId + 1, 0x9e3779b1)) >>> 0) % LIGHT_CYCLE_MS;
  let t = (((timeMs + offset) % LIGHT_CYCLE_MS) + LIGHT_CYCLE_MS) % LIGHT_CYCLE_MS;
  if (axis === 1) t = (t + LIGHT_CYCLE_MS / 2) % LIGHT_CYCLE_MS;
  if (t < LIGHT_GREEN_MS) return "green";
  if (t < LIGHT_GREEN_MS + LIGHT_AMBER_MS) return "amber";
  return "red";
}

/** Both axes at one instant. Tests pin "never both green" on this. */
export function lightPair(seed: number, townId: number, timeMs: number): [LightAspect, LightAspect] {
  return [lightAspect(seed, townId, 0, timeMs), lightAspect(seed, townId, 1, timeMs)];
}

export interface SignalMap {
  seed: number;
  /** Tile index → town id. Only town junctions with 3+ connections. */
  junctions: Map<number, number>;
}

interface TownBox {
  id: number;
  x0: number; y0: number; x1: number; y1: number;
  roads: Set<number>;
}

function townBoxes(grid: Grid): TownBox[] {
  const boxes: TownBox[] = [];
  for (const t of grid.towns ?? []) {
    let x0 = t.tx, y0 = t.ty, x1 = t.tx, y1 = t.ty;
    const roads = new Set<number>();
    for (const [x, y] of t.roads ?? []) {
      if (!inMapT(x, y)) continue;
      roads.add(tIdx(x, y));
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    for (const [x, y] of t.houses ?? []) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    boxes.push({ id: t.id, x0, y0, x1, y1, roads });
  }
  return boxes;
}

function townOfRoad(boxes: TownBox[], x: number, y: number): number | null {
  if (!inMapT(x, y)) return null;
  const i = tIdx(x, y);
  for (const b of boxes) {
    if (b.roads.has(i)) return b.id;
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
    // A junction one tile off the ring (a player street meeting the town)
    // still counts, but a highway that merely clips the bounding box does not.
    for (const ri of b.roads) {
      const rx = ri % MAP_W, ry = (ri / MAP_W) | 0;
      if (Math.max(Math.abs(rx - x), Math.abs(ry - y)) <= 1) return b.id;
    }
  }
  return null;
}

/**
 * Town junctions with 3 or more road connections. Highways outside a town
 * get none. Rebuilt when the track revision or the town signature changes.
 */
export function buildSignals(track: Track, grid: Grid, seed: number): SignalMap {
  const junctions = new Map<number, number>();
  const boxes = townBoxes(grid);
  if (boxes.length === 0) return { seed, junctions };
  const graph = ambientRoadGraph(track);
  for (const [i, nbs] of graph) {
    if (nbs.length < 3) continue;
    const x = i % MAP_W, y = (i / MAP_W) | 0;
    const townId = townOfRoad(boxes, x, y);
    if (townId === null) continue;
    junctions.set(i, townId);
  }
  // Owner (2026-09-29): lights on every OTHER junction, not all of them —
  // row-major per town, keep the 1st, 3rd, 5th… The rest stay plain
  // give-way junctions (cars' own yield rule), so nothing waits at a light
  // that is not drawn.
  const seen = new Map<number, number>();
  for (const i of [...junctions.keys()].sort((a, b) => a - b)) {
    const t = junctions.get(i)!;
    const n = seen.get(t) ?? 0;
    seen.set(t, n + 1);
    if (n % 2 === 1) junctions.delete(i);
  }
  return { seed, junctions };
}

export interface Approach {
  /** Tile the vehicle is about to enter. */
  tile: readonly [number, number];
  remaining: number;
  axis: RoadAxis;
  segLen: number;
  /** `t` on the current leg at which the vehicle should hold. */
  holdT: number;
  reverse: boolean;
}

/** Where a pose is relative to the tile it is about to enter. Null on a stub route. */
export function approachOf(
  route: readonly (readonly [number, number])[],
  pose: { leg: number; t: number; reverse?: boolean },
): Approach | null {
  const n = route.length;
  if (n < 2) return null;
  const k = Math.min(Math.max(pose.leg, 0), n - 2);
  const a = route[k], b = route[k + 1];
  const segLen = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const hold = Math.min(LIGHT_HOLD_TILES, segLen * 0.7);
  if (!pose.reverse) {
    return {
      tile: b,
      remaining: (1 - pose.t) * segLen,
      axis: axisOf(b[0] - a[0], b[1] - a[1]),
      segLen,
      holdT: 1 - hold / segLen,
      reverse: false,
    };
  }
  return {
    tile: a,
    remaining: pose.t * segLen,
    axis: axisOf(a[0] - b[0], a[1] - b[1]),
    segLen,
    holdT: hold / segLen,
    reverse: true,
  };
}

function aspectBinds(aspect: LightAspect, remaining: number): boolean {
  if (aspect === "green") return false;
  // Amber: a vehicle already inside the last sixth of a tile finishes the crossing.
  if (aspect === "amber" && remaining < 0.16) return false;
  return true;
}

/**
 * Stop-line `t` on this leg when the light ahead is red or amber, or null
 * when the vehicle may enter. Independent of where the vehicle is — a long
 * tick must not be able to jump the line just because it started far away.
 */
export function stopFraction(
  route: readonly (readonly [number, number])[],
  leg: number,
  reverse: boolean,
  signals: SignalMap | null | undefined,
  timeMs: number,
): number | null {
  if (!signals || signals.junctions.size === 0) return null;
  const ap = approachOf(route, { leg, t: reverse ? 0.15 : 0.85, reverse });
  if (!ap) return null;
  const townId = signals.junctions.get(tIdx(ap.tile[0], ap.tile[1]));
  if (townId === undefined) return null;
  const aspect = lightAspect(signals.seed, townId, ap.axis, timeMs);
  if (aspect === "green") return null;
  return ap.holdT;
}

/**
 * `t` a FORWARD car must not pass on this leg, or null if the light (or the
 * lack of one) lets it through. Null once the car is already past the line:
 * it entered on green and is not yanked back. Cars are one-way.
 */
export function holdTForLight(
  route: readonly (readonly [number, number])[],
  leg: number,
  t: number,
  signals: SignalMap | null | undefined,
  timeMs: number,
): number | null {
  const stop = stopFraction(route, leg, false, signals, timeMs);
  if (stop == null || t > stop + 1e-4) return null;
  const ap = approachOf(route, { leg, t, reverse: false });
  if (!ap || ap.remaining < 0.04) return null;
  return stop;
}

// ── truck ghosts (visual only) ────────────────────────────────────────────
export interface GhostPose {
  leg: number;
  t: number;
  reverse: boolean;
  /** Presentation-only route identity, to discard a hold after rerouting. */
  route?: GhostTruck["route"];
}

export interface GhostTruck {
  depotId: number;
  /** FLEET-1 (#595): which of the Depot's lorries (absent = 0). */
  slot?: number;
  route: readonly (readonly [number, number])[];
  leg: number;
  t: number;
  reverse: boolean;
  segMult?: number[];
  segFast?: boolean[];
  segClimb?: number[];
  rateMult?: number;
}

function shouldHold(
  ap: Approach | null,
  signals: SignalMap | null | undefined,
  timeMs: number,
): boolean {
  if (!ap || !signals) return false;
  // Already in the junction tile: committed. Far away still binds — a
  // catch-up step must not sail through the window in one tick.
  if (ap.remaining < 0.04) return false;
  const townId = signals.junctions.get(tIdx(ap.tile[0], ap.tile[1]));
  if (townId === undefined) return false;
  return aspectBinds(lightAspect(signals.seed, townId, ap.axis, timeMs), ap.remaining);
}

/** Pull a pose back to the stop line when the light binds. No-op otherwise. */
export function clampToLight(
  pose: GhostPose,
  route: readonly (readonly [number, number])[],
  signals: SignalMap | null | undefined,
  timeMs: number,
): GhostPose {
  const ap = approachOf(route, pose);
  if (!shouldHold(ap, signals, timeMs) || !ap) return pose;
  if (!pose.reverse && pose.t > ap.holdT) return { ...pose, t: ap.holdT };
  if (pose.reverse && pose.t < ap.holdT) return { ...pose, t: ap.holdT };
  return pose;
}

/** Distance in segment fractions around the OUTBOUND + RETURN loop. */
function phaseOf(p: GhostPose, max: number): number {
  const s = p.leg + p.t;
  return p.reverse ? 2 * max - s : s;
}

function poseAtPhase(phase: number, max: number): GhostPose {
  const p = phase % (2 * max);
  const reverse = p >= max;
  const s = reverse ? 2 * max - p : p;
  const leg = reverse ? Math.max(0, Math.ceil(s) - 1) : Math.min(max - 1, Math.floor(s));
  return { leg, t: s - leg, reverse };
}

/**
 * Follow the economic pose FORWARDS around the round-trip loop, never across
 * it. A light can hold the drawing while the economy turns (even laps it):
 * the ghost must still visit the endpoint before it can reverse. Catch-up
 * is bounded to 3× the current segment's physical pace, including length,
 * road tier and slope. Neither deliveries nor economic positions are changed.
 */
export function stepGhost(
  prev: GhostPose | null,
  truck: GhostTruck,
  signals: SignalMap | null | undefined,
  timeMs: number,
  dtMs: number,
): GhostPose {
  const econ: GhostPose = { leg: truck.leg, t: truck.t, reverse: !!truck.reverse, route: truck.route };
  const max = truck.route.length - 1;
  if (max < 1) return econ;
  const sameRoute = !prev?.route || prev.route === truck.route
    || (prev.route.length === truck.route.length && prev.route.every((p, i) =>
      p[0] === truck.route[i][0] && p[1] === truck.route[i][1]));
  if (!prev || !sameRoute || prev.leg < 0 || prev.leg >= max) return econ;

  let phase = phaseOf(prev, max);
  let distance = phaseOf(econ, max) - phase;
  // Ignore floating point noise at a caught-up pose, not an entire new lap.
  if (Math.abs(distance) < 1e-9) return { ...prev, route: truck.route };
  if (distance < 0) distance += 2 * max;
  let ms = Math.max(0, dtMs);
  let ghost = poseAtPhase(phase, max);
  const r = truck.rateMult;
  const rate = typeof r === "number" && Number.isFinite(r) && r > 0 ? r : 1;
  while (ms > 1e-9 && distance > 1e-9) {
    const { leg, t, reverse } = ghost;
    const a = truck.route[leg], b = truck.route[leg + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const pace = truck.segMult?.[leg] ?? (truck.segFast?.[leg] ? TRUCK_ROAD_MULT : 1);
    const climb = truck.segClimb?.[leg] ?? 0;
    const speed = 3 * TRUCK_SPEED * rate * pace * uphillSpeed(reverse ? -climb : climb) / length;
    if (!(speed > 0)) break;
    let available = reverse ? t : 1 - t;
    const stop = stopFraction(truck.route, leg, reverse, signals, timeMs);
    // A light that turns red AFTER we crossed its line must not pull us back.
    // Test every segment, so a long/catch-up frame cannot skip a later light.
    const toLine = stop == null ? -1 : (reverse ? t - stop : stop - t);
    const binds = toLine >= -1e-9;
    if (binds) available = Math.min(available, Math.max(0, toLine));
    const step = Math.min(distance, available, ms * speed);
    phase += step;
    distance -= step;
    ms -= step / speed;
    ghost = poseAtPhase(phase, max);
    if (binds && step >= available - 1e-9) break;
  }
  return { ...ghost, route: truck.route };
}

// ── pedestrians ───────────────────────────────────────────────────────────
/** Sidewalk offset in tile units — inside the kerb ribbon, off the lane. */
export const PED_OFFSET = 0.34;
/** Tiles per millisecond. A slow walk, about half a tile a second. */
export const PED_SPEED = 0.00048;
export const PED_FRAME_MS = 280;
const PED_SALT = 0xA3B3_5EED;

export interface Waypoint {
  x: number;
  y: number;
  townId: number;
  /**
   * Set on the kerb waypoint that STARTS a crossing. The walker does not
   * leave it until that axis is red for cars (the walk signal).
   */
  waitAxis?: RoadAxis;
}

export interface Ped {
  id: number;
  townId: number;
  path: Waypoint[];
  leg: number;
  t: number;
  frame: 0 | 1;
  phase: number;
  plaza: boolean;
}

export function pedPosition(ped: Ped): [number, number] {
  if (ped.path.length === 0) return [0, 0];
  if (ped.path.length === 1) return [ped.path[0].x, ped.path[0].y];
  const leg = Math.min(Math.max(ped.leg, 0), ped.path.length - 2);
  const a = ped.path[leg], b = ped.path[leg + 1];
  return [a.x + (b.x - a.x) * ped.t, a.y + (b.y - a.y) * ped.t];
}

function xyOf(i: number): [number, number] {
  return [i % MAP_W, (i / MAP_W) | 0];
}

function streetLoop(track: Track, tiles: number[]): number[] {
  if (tiles.length === 0) return [];
  const graph = ambientRoadGraph(track);
  const set = new Set(tiles);
  const start = [...tiles].sort((a, b) => a - b)[0];
  const path = [start];
  const seen = new Set([start]);
  let prev = -1;
  let cur = start;
  for (let guard = 0; guard < tiles.length * 2 && path.length < 80; guard++) {
    const nbs = (graph.get(cur) ?? []).filter((n) => set.has(n) && n !== prev);
    if (nbs.length === 0) break;
    nbs.sort((a, b) => (seen.has(a) ? 1 : 0) - (seen.has(b) ? 1 : 0) || a - b);
    const next = nbs[0];
    if (seen.has(next)) {
      if (next === start && path.length > 2) path.push(next);
      break;
    }
    path.push(next);
    seen.add(next);
    prev = cur;
    cur = next;
  }
  return path;
}

function sidewalkPath(track: Track, tiles: number[], townId: number, signals: SignalMap): Waypoint[] {
  const loop = streetLoop(track, tiles);
  if (loop.length < 2) return [];
  const graph = ambientRoadGraph(track);
  const pts: Waypoint[] = [];
  const steps = loop.length - 1;
  for (let i = 0; i < steps; i++) {
    const a = xyOf(loop[i]), b = xyOf(loop[i + 1]);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const ox = (-dy / len) * PED_OFFSET, oy = (dx / len) * PED_OFFSET;
    const kerb: Waypoint = {
      x: a[0] + dx * 0.7 + ox,
      y: a[1] + dy * 0.7 + oy,
      townId,
    };
    const bi = tIdx(b[0], b[1]);
    if ((graph.get(bi)?.length ?? 0) >= 3 && signals.junctions.has(bi)) {
      // Crossing the road this edge runs along: cars on that axis must be red.
      kerb.waitAxis = axisOf(dx, dy);
      pts.push(kerb);
      pts.push({ x: b[0] - ox, y: b[1] - oy, townId });
    } else {
      pts.push(kerb);
    }
  }
  if (pts.length < 2) return pts;
  const closed = loop[0] === loop[loop.length - 1];
  if (!closed) {
    const back = pts.slice(0, -1).reverse().map((p) => ({ x: p.x, y: p.y, townId }));
    pts.push(...back);
  }
  pts.push({ x: pts[0].x, y: pts[0].y, townId });
  return pts;
}

function plazaPath(town: Town): Waypoint[] {
  const r = 0.55;
  const ring: Waypoint[] = [
    { x: town.tx + r, y: town.ty, townId: town.id },
    { x: town.tx, y: town.ty + r, townId: town.id },
    { x: town.tx - r, y: town.ty, townId: town.id },
    { x: town.tx, y: town.ty - r, townId: town.id },
  ];
  return [...ring, { ...ring[0] }];
}

function isStreet(track: Track, x: number, y: number): boolean {
  if (!inMapT(x, y)) return false;
  const i = tIdx(x, y);
  if ((track.road[i] & PRESENT) === 0 && (track.dirt[i] & PRESENT) === 0) return false;
  return ((track.tier?.[i] ?? 0) & 7) === ROAD_TIER.street;
}

function allocate(weights: number[], budget: number): number[] {
  if (budget <= 0 || weights.length === 0) return weights.map(() => 0);
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const raw = weights.map((w) => (budget * w) / sum);
  const out = raw.map((n) => Math.floor(n));
  let left = budget - out.reduce((s, n) => s + n, 0);
  const order = raw.map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

/**
 * Seeded walkers. Street tiles (tier 1) get a sidewalk circuit with crossings
 * at signalised junctions; every town also gets plaza walkers around its centre.
 * The count follows `ambientPedBudget` and never exceeds the actor cap.
 */
export function spawnPedestrians(track: Track, grid: Grid, seed: number, budget?: number): Ped[] {
  const towns = grid.towns ?? [];
  if (towns.length === 0) return [];
  const want = clampBudgets(0, budget ?? ambientPedBudget(towns)).peds;
  if (want <= 0) return [];
  const signals = buildSignals(track, grid, seed);
  const weights = towns.map((t) => townTrafficWeight(t));
  const counts = allocate(weights, want);
  const rng = mulberry32((seed ^ PED_SALT) >>> 0);
  const out: Ped[] = [];
  let id = 1;
  for (let ti = 0; ti < towns.length; ti++) {
    const town = towns[ti];
    const n = counts[ti] ?? 0;
    if (n <= 0) continue;
    const streets: number[] = [];
    for (const [x, y] of town.roads ?? []) {
      if (isStreet(track, x, y)) streets.push(tIdx(x, y));
    }
    const side = sidewalkPath(track, streets, town.id, signals);
    const plaza = plazaPath(town);
    const plazaN = side.length >= 2 ? Math.min(n, Math.max(1, Math.round(n * 0.35))) : n;
    const streetN = side.length >= 2 ? n - plazaN : 0;
    const place = (path: Waypoint[], count: number, plazaFlag: boolean) => {
      if (path.length < 2 || count <= 0) return;
      for (let k = 0; k < count && out.length < want; k++) {
        const span = Math.max(1, path.length - 1);
        const leg = Math.min(span - 1, Math.floor(rng() * span));
        // Don't seat a walker ON a kerb wait with t = 0, or the first frame
        // is a queue at the light. A mid-segment start reads as already walking.
        const start = path[leg];
        const t = start.waitAxis !== undefined ? 0.35 + rng() * 0.5 : rng() * 0.85;
        out.push({
          id: id++,
          townId: town.id,
          path,
          leg,
          t,
          frame: 0,
          phase: Math.floor(rng() * PED_FRAME_MS),
          plaza: plazaFlag,
        });
      }
    };
    place(side, streetN, false);
    place(plaza, plazaN, true);
  }
  return out;
}

function blockedByPed(i: number, peds: Ped[], pos: [number, number][]): boolean {
  const ped = peds[i];
  const [x, y] = pos[i];
  const leg = Math.min(ped.leg, Math.max(0, ped.path.length - 2));
  const a = ped.path[leg], b = ped.path[Math.min(leg + 1, ped.path.length - 1)];
  if (!b) return false;
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  for (let j = 0; j < peds.length; j++) {
    if (j === i || peds[j].townId !== ped.townId || peds[j].plaza !== ped.plaza) continue;
    const [ox, oy] = pos[j];
    const rx = ox - x, ry = oy - y;
    const along = rx * ux + ry * uy;
    if (along > 0.04 && along < 0.3 && Math.hypot(rx, ry) < 0.38) return true;
  }
  return false;
}

/**
 * Advance walkers. A crossing kerb (`waitAxis`) holds until that axis is red
 * for cars. Walkers on the same pavement queue instead of overlapping.
 */
export function stepPedestrians(peds: Ped[], dtMs: number, signals: SignalMap, timeMs: number): void {
  if (dtMs <= 0) return;
  const pos = peds.map(pedPosition);
  for (let i = 0; i < peds.length; i++) {
    const ped = peds[i];
    ped.phase += dtMs;
    ped.frame = (Math.floor(ped.phase / PED_FRAME_MS) % 2) as 0 | 1;
    if (ped.path.length < 2) continue;
    let left = dtMs;
    let guard = 0;
    while (left > 1e-6 && guard++ < 8) {
      if (ped.leg >= ped.path.length - 1) { ped.leg = 0; ped.t = 0; }
      const leg = Math.min(ped.leg, ped.path.length - 2);
      const a = ped.path[leg], b = ped.path[leg + 1];
      if (a.waitAxis !== undefined && ped.t < 0.12) {
        const aspect = lightAspect(signals.seed, a.townId, a.waitAxis, timeMs);
        if (aspect !== "red") break;
      }
      if (blockedByPed(i, peds, pos)) break;
      const seg = Math.hypot(b.x - a.x, b.y - a.y) || 0.01;
      const speed = PED_SPEED / seg;
      const need = (1 - ped.t) / speed;
      if (left < need) {
        ped.t += left * speed;
        left = 0;
      } else {
        left -= need;
        ped.leg = leg + 1;
        ped.t = 0;
        if (ped.leg >= ped.path.length - 1) { ped.leg = 0; ped.t = 0; }
      }
    }
    pos[i] = pedPosition(ped);
  }
}

/** True when a pedestrian may leave a crossing kerb. Red for cars = walk. */
export function crossingAllowed(seed: number, townId: number, axis: RoadAxis, timeMs: number): boolean {
  return lightAspect(seed, townId, axis, timeMs) === "red";
}

// ── the controller the game drives ────────────────────────────────────────
export interface AmbienceState {
  time: number;
  seed: number;
  peds: Ped[];
  signals: SignalMap;
  signalRev: number;
  townSig: string;
  ghosts: Map<number, GhostPose>;
  pedsActive: boolean;
}

export function createAmbience(seed: number): AmbienceState {
  return {
    time: 0,
    seed,
    peds: [],
    signals: { seed, junctions: new Map() },
    signalRev: -1,
    townSig: "",
    ghosts: new Map(),
    pedsActive: false,
  };
}

export function townSignature(grid: Grid): string {
  let s = "";
  for (const t of grid.towns ?? []) {
    s += `${t.id}:${t.level ?? "x"}:${t.roads?.length ?? 0};`;
  }
  return s;
}

/** Rebuild lights when the roads or the town tiers moved. Drops stale paths. */
export function syncSignals(state: AmbienceState, track: Track, grid: Grid): void {
  const sig = townSignature(grid);
  if (state.signalRev === track.revision && state.townSig === sig) return;
  state.signals = buildSignals(track, grid, state.seed);
  state.signalRev = track.revision;
  state.townSig = sig;
  state.peds = [];
}

export interface AmbienceTick {
  track: Track;
  grid: Grid;
  zoom: number;
  performance: boolean;
}

/**
 * Advance the shared clock, and the walkers when the close zoom is up.
 * Parked (wrong zoom, or performance mode) the clock still runs, so a light
 * a car meets after zooming back in is the light the seed says it is — not
 * a light that froze off-screen.
 */
export function tickAmbience(state: AmbienceState, dtMs: number, ctx: AmbienceTick): void {
  if (dtMs <= 0) return;
  state.time += dtMs;
  syncSignals(state, ctx.track, ctx.grid);
  // FLOW-1: the traffic clock rides the ambience clock (every client ticks it).
  flowTick(dtMs, ctx.track, ctx.grid, state.signals, state.time);
  const show = ambienceVisible("peds", ctx.zoom, ctx.performance);
  state.pedsActive = show;
  if (!show) return;
  if (state.peds.length === 0) {
    state.peds = spawnPedestrians(ctx.track, ctx.grid, state.seed);
  }
  stepPedestrians(state.peds, dtMs, state.signals, state.time);
}

/** Visual truck poses. Does not read or write `deliveries`. */
export function tickTruckGhosts(state: AmbienceState, trucks: readonly GhostTruck[], dtMs: number): void {
  const seen = new Set<number>();
  for (const tr of trucks) {
    const key = truckKey(tr);
    seen.add(key);
    const prev = state.ghosts.get(key) ?? null;
    state.ghosts.set(key, stepGhost(prev, tr, state.signals, state.time, dtMs));
  }
  for (const id of [...state.ghosts.keys()]) {
    if (!seen.has(id)) state.ghosts.delete(id);
  }
}

// ── placeholder drawing ───────────────────────────────────────────────────
export interface PaintCar {
  name: string;
  model?: CarModel;
  carIndex: number;
  state: string;
  fade: number;
  route: readonly (readonly [number, number])[];
  leg: number;
  t: number;
}

export interface PaintView { x0: number; y0: number; x1: number; y1: number }

/** A canvas-ish context. A stub that cannot draw (jsdom) is a no-op. */
export interface PaintCtx {
  beginPath?: () => void;
  moveTo?: (x: number, y: number) => void;
  lineTo?: (x: number, y: number) => void;
  closePath?: () => void;
  stroke?: () => void;
  fill?: () => void;
  arc?: (x: number, y: number, r: number, a0: number, a1: number) => void;
  fillRect?: (x: number, y: number, w: number, h: number) => void;
  save?: () => void;
  restore?: () => void;
  strokeStyle?: string | unknown;
  fillStyle?: string | unknown;
  lineWidth?: number;
  globalAlpha?: number | unknown;
}

export function tilePointScreen(cam: Camera, grid: Grid | null, fx: number, fy: number): [number, number] {
  const [wx, wy] = tileToScreen(fx, fy);
  const lift = grid ? liftAt(grid, fx, fy) : 0;
  return worldToScreen(cam, wx, wy + HH - lift);
}

function carPose(car: PaintCar): { x: number; y: number; dx: number; dy: number } | null {
  const n = car.route.length;
  if (n < 2 || car.state === "waiting") return null;
  const k = Math.min(Math.max(car.leg, 0), n - 2);
  const a = car.route[k], b = car.route[Math.min(k + 1, n - 1)];
  const t = car.leg >= n - 1 ? 1 : car.t;
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    dx: b[0] - a[0],
    dy: b[1] - a[1],
  };
}

function inView(x: number, y: number, view: PaintView | undefined): boolean {
  if (!view) return true;
  return x >= view.x0 - 2 && x <= view.x1 + 2 && y >= view.y0 - 2 && y <= view.y1 + 2;
}

function viewCentre(view: PaintView | undefined): [number, number] {
  if (!view) return [0, 0];
  return [(view.x0 + view.x1) / 2, (view.y0 + view.y1) / 2];
}

/**
 * Lead (2026-09-28): no placeholder art reaches players. Until the sprites in
 * `AMBIENT_ART_NEEDED` ship, the vector stand-ins stay OFF (the simulation —
 * density, lights, walkers, trucks held at red — still runs underneath, and
 * cars keep drawing from their shipped sprites). Tests and a local art
 * session can turn them on.
 */
let DRAW_STAND_INS = false;
export function setAmbientStandIns(on: boolean): void { DRAW_STAND_INS = on; }

/**
 * Draw the stand-ins. Returns how many marks were painted. Skips cars when
 * the atlas already has the model sprites (those ride the depth sort).
 * A context without `beginPath` paints nothing — unit tests and jsdom.
 */
export function paintAmbience(
  ctx: PaintCtx | null | undefined,
  cam: Camera,
  grid: Grid | null,
  state: AmbienceState,
  cars: readonly PaintCar[],
  opts: { performance: boolean; view?: PaintView; atlasHasModels?: boolean },
): number {
  if (!ctx || typeof ctx.beginPath !== "function") return 0;
  // FLOW-1: signal heads, incidents and the heat map are shipped art, drawn
  // whether or not the placeholder stand-ins are on.
  const flowDrawn = paintFlowOverlay(
    ctx, (fx, fy) => tilePointScreen(cam, grid, fx, fy), cam.zoom, opts.view, opts.performance,
  );
  if (!DRAW_STAND_INS) return flowDrawn;
  const zoom = cam.zoom;
  if (opts.performance) return flowDrawn;
  const showCars = ambienceVisible("cars", zoom, false) && !opts.atlasHasModels;
  const showPeds = state.pedsActive && ambienceVisible("peds", zoom, false);
  // The flow overlay already drew real signal heads: no stand-in poles on top.
  const showLights = ambienceVisible("lights", zoom, false) && state.signals.junctions.size > 0
    && flowDrawn === 0;
  if (!showCars && !showPeds && !showLights) return flowDrawn;
  const [cx, cy] = viewCentre(opts.view);
  let drawn = flowDrawn;
  const rank = (x: number, y: number) => (x - cx) * (x - cx) + (y - cy) * (y - cy);

  if (showLights && grid) {
    const poles: { x: number; y: number; townId: number }[] = [];
    for (const [i, townId] of state.signals.junctions) {
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      if (!inView(x, y, opts.view)) continue;
      poles.push({ x, y, townId });
    }
    const shown = selectOnScreen(poles, SCREEN_LIGHT_CAP, (p) => rank(p.x, p.y));
    for (const p of shown) drawn += drawLight(ctx, cam, grid, p.x, p.y, state.seed, p.townId, state.time) ? 1 : 0;
  }
  if (showCars) {
    const live = cars.filter((c) => c.state !== "waiting" && c.fade > 0.02 && c.route.length >= 2);
    const placed = live.flatMap((c) => {
      const pose = carPose(c);
      if (!pose || !inView(pose.x, pose.y, opts.view)) return [];
      return [{ car: c, ...pose }];
    });
    const shown = selectOnScreen(placed, SCREEN_CAR_CAP, (p) => rank(p.x, p.y));
    for (const p of shown) {
      if (drawCar(ctx, cam, grid, p.car, p.x, p.y, p.dx, p.dy, state.seed)) drawn++;
    }
  }
  if (showPeds && grid) {
    const placed = state.peds.flatMap((ped) => {
      const [x, y] = pedPosition(ped);
      if (!inView(x, y, opts.view)) return [];
      return [{ ped, x, y }];
    });
    const shown = selectOnScreen(placed, SCREEN_PED_CAP, (p) => rank(p.x, p.y));
    for (const p of shown) {
      if (drawPed(ctx, cam, grid, p.ped, p.x, p.y)) drawn++;
    }
  }
  return drawn;
}

function drawLight(
  ctx: PaintCtx, cam: Camera, grid: Grid,
  tx: number, ty: number, seed: number, townId: number, timeMs: number,
): boolean {
  const [sx, sy] = tilePointScreen(cam, grid, tx + 0.32, ty + 0.32);
  const z = cam.zoom;
  const h = 14 * z;
  if (typeof ctx.moveTo !== "function" || typeof ctx.lineTo !== "function") return false;
  ctx.beginPath?.();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, sy - h);
  ctx.strokeStyle = "#2a2622";
  ctx.lineWidth = Math.max(1, z);
  ctx.stroke?.();
  const aspects = lightPair(seed, townId, timeMs);
  const color = (a: LightAspect) => a === "green" ? "#3d9a4a" : a === "amber" ? "#e0a020" : "#c4453c";
  if (typeof ctx.arc === "function") {
    ctx.beginPath?.();
    ctx.fillStyle = color(aspects[0]);
    ctx.arc(sx, sy - h, 2.2 * z, 0, Math.PI * 2);
    ctx.fill?.();
    ctx.beginPath?.();
    ctx.fillStyle = color(aspects[1]);
    ctx.arc(sx, sy - h + 5 * z, 2.2 * z, 0, Math.PI * 2);
    ctx.fill?.();
  }
  return true;
}

function drawCar(
  ctx: PaintCtx, cam: Camera, grid: Grid | null,
  car: PaintCar, x: number, y: number, dx: number, dy: number, seed: number,
): boolean {
  const [sx, sy] = tilePointScreen(cam, grid, x, y);
  const z = cam.zoom;
  const model = car.model ?? carModelOf(car.carIndex, seed);
  const art = CAR_ART[model];
  const [hx, hy] = headingScreen(dx, dy);
  const hlen = Math.hypot(hx, hy) || 1;
  const ux = hx / hlen, uy = hy / hlen;
  const px = -uy, py = ux;
  const len = art.length * z * 0.45;
  const wid = art.width * z * 0.45;
  if (typeof ctx.moveTo !== "function" || typeof ctx.lineTo !== "function") return false;
  const alpha = Math.max(0, Math.min(1, car.fade));
  if (typeof ctx.globalAlpha === "number" || ctx.globalAlpha === undefined) ctx.globalAlpha = alpha;
  // Body along the heading, a fin or a bed at the back so the four models read apart.
  const nose = 1;
  const tail = model === "bus" ? 0.95 : model === "pickup" ? 1.15 : 0.85;
  ctx.beginPath?.();
  ctx.moveTo(sx + ux * len * nose + px * wid * 0.35, sy + uy * len * nose + py * wid * 0.35);
  ctx.lineTo(sx + ux * len * 0.2 + px * wid, sy + uy * len * 0.2 + py * wid);
  ctx.lineTo(sx - ux * len * tail + px * wid * 0.8, sy - uy * len * tail + py * wid * 0.8);
  ctx.lineTo(sx - ux * len * tail - px * wid * 0.8, sy - uy * len * tail - py * wid * 0.8);
  ctx.lineTo(sx + ux * len * 0.2 - px * wid, sy + uy * len * 0.2 - py * wid);
  ctx.lineTo(sx + ux * len * nose - px * wid * 0.35, sy + uy * len * nose - py * wid * 0.35);
  ctx.closePath?.();
  ctx.fillStyle = art.body;
  ctx.fill?.();
  ctx.strokeStyle = art.trim;
  ctx.lineWidth = Math.max(1, z * 0.6);
  ctx.stroke?.();
  if (model === "sedan" || model === "sedan2") {
    // Tail fins — the thing that makes it a 1950s sedan at this size.
    ctx.beginPath?.();
    ctx.moveTo(sx - ux * len * 0.7 + px * wid * 0.7, sy - uy * len * 0.7 + py * wid * 0.7);
    ctx.lineTo(sx - ux * len * 1.15 + px * wid * 1.05, sy - uy * len * 1.15 + py * wid * 1.05);
    ctx.moveTo(sx - ux * len * 0.7 - px * wid * 0.7, sy - uy * len * 0.7 - py * wid * 0.7);
    ctx.lineTo(sx - ux * len * 1.15 - px * wid * 1.05, sy - uy * len * 1.15 - py * wid * 1.05);
    ctx.stroke?.();
  }
  if (typeof ctx.globalAlpha === "number") ctx.globalAlpha = 1;
  return true;
}

function drawPed(ctx: PaintCtx, cam: Camera, grid: Grid, ped: Ped, x: number, y: number): boolean {
  const [sx, sy] = tilePointScreen(cam, grid, x, y);
  const z = cam.zoom;
  const h = 8 * z;
  if (typeof ctx.moveTo !== "function" || typeof ctx.lineTo !== "function") return false;
  const leg = ped.frame === 0 ? 1.6 * z : 0.4 * z;
  ctx.strokeStyle = "#3a342c";
  ctx.lineWidth = Math.max(1, z * 0.7);
  ctx.beginPath?.();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, sy - h);
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx - leg, sy + 2 * z);
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + leg, sy + 2 * z);
  ctx.stroke?.();
  if (typeof ctx.arc === "function") {
    ctx.beginPath?.();
    ctx.fillStyle = "#f2e6c9";
    ctx.arc(sx, sy - h - 1.5 * z, 1.6 * z, 0, Math.PI * 2);
    ctx.fill?.();
  }
  return true;
}

function headingScreen(dx: number, dy: number): [number, number] {
  const [x0, y0] = tileToScreen(0, 0);
  const [x1, y1] = tileToScreen(dx || 0.001, dy);
  return [x1 - x0, y1 - y0];
}
