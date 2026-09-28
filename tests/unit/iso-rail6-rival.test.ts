// ══════════════════════════════════════════════════════════════════════════
// RAIL-6 (#575) — the rival's expandable station, scripted.
//
// The acceptance scenario: the rival runs a line into a plant, a SECOND
// resource of the same plant becomes claimable, and the rival — whose plant
// station has only the one lane its first line was assigned — upgrades the
// station instead of stalling. `planRailMove` must propose the lane through
// the same refusal rule the player's click gets, `executeRailMove` must build
// it through the same shared function, and the second line must then run on
// the SECOND lane of the SAME plant station.
//
// Same hand-built flat map as the RAIL-05 suite: a plant at (30,40), two
// industries far east of the road threshold, an unlimited purse — the test is
// about the plan, not the price.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { planRailMove, executeRailMove, type RailMove } from "../../src/iso/ai";
import {
  createRailState, tickTrains, autoTrains, RAIL_COSTS, MAX_LANES,
  structuresOf, stationLanes, laneTrackTiles, hasRail,
  type RailState, type RailStructure,
} from "../../src/iso/rail";
import { createTrack, tIdx, type Track } from "../../src/iso/track";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";
import type { EconomyState, Factory } from "../../src/iso/economy";

// ── fixtures ──────────────────────────────────────────────────────────────
function flatGrid(industries: Industry[] = []): Grid {
  const occupancy = new Int16Array(MAP_W * MAP_H).fill(-1);
  industries.forEach((ind, i) => {
    ind.id = i;
    for (let y = ind.ty; y < ind.ty + ind.h; y++)
      for (let x = ind.tx; x < ind.tx + ind.w; x++) occupancy[tIdx(x, y)] = i;
  });
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries, towns: [], occupancy, seed: 7,
  };
}

function industry(tx: number, ty: number): Industry {
  const type = Object.keys(INDUSTRY_BY_KEY)[0];
  const def = INDUSTRY_BY_KEY[type];
  return { id: 0, type, tx, ty, w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0 };
}

/** An unlimited purse: these tests are about the plan, not the price. */
const rich = { wood: 9999, stone: 9999, grain: 9999, ore: 9999, oil: 9999 };
const OWNER = 2;

interface World { grid: Grid; track: Track; rail: RailState; factory: Factory; eco: EconomyState }

/** A plant at (30,40) and TWO industries 30+ tiles east — both rail targets. */
function world(): World {
  const grid = flatGrid([industry(60, 40), industry(60, 48)]);
  const track = createTrack();
  const rail = createRailState();
  const factory: Factory = { owner: "ai", ownerId: OWNER, tx: 30, ty: 40, id: 0, townId: null };
  const eco: EconomyState = { grid, track, harvesters: [], factories: [factory], rail };
  return { grid, track, rail, factory, eco };
}

const plan = (w: World) =>
  planRailMove(w.eco, w.rail, w.factory, { purse: rich, ownerId: OWNER, useRail: true, now: 0 });

/**
 * Plan → execute until the planner has nothing to do, ticking and running the
 * automatic-trains pass each turn exactly like the game loop does. Returns the
 * kinds in order and the outcome of the one `lane` move (the upgrade).
 */
function drive(w: World, turns = 80): {
  kinds: RailMove["kind"][]; lane: ReturnType<typeof executeRailMove>; lanePlan: RailMove | null;
} {
  const kinds: RailMove["kind"][] = [];
  let lane: ReturnType<typeof executeRailMove> = null;
  let lanePlan: RailMove | null = null;
  for (let i = 0; i < turns; i++) {
    const move = plan(w);
    if (!move) break;
    const res = executeRailMove(w.eco, w.rail, move, "ai", OWNER);
    expect(res, `turn ${i}: the planned ${move.kind} was refused on execute`).not.toBeNull();
    if (move.kind === "lane") { lane = res; lanePlan = move; }
    kinds.push(move.kind);
    autoTrains(w.rail, OWNER);
    tickTrains(w.rail, 1_000);
  }
  return { kinds, lane, lanePlan };
}

const plantPlat = (w: World): RailStructure =>
  structuresOf(w.rail, OWNER, "platform").find((p) => p.anchor?.kind === "plant")!;

describe("RAIL-6 the rival grows its station for a second line", () => {
  it("builds the first line, then BUYS A LANE, then runs the second line on it", () => {
    const w = world();
    const { kinds, lane, lanePlan } = drive(w);

    // The upgrade happened, exactly once, after both platforms and the first
    // track were standing — and it was charged from the shared lane price.
    expect(kinds.filter((k) => k === "lane")).toHaveLength(1);
    expect(kinds.indexOf("lane")).toBeGreaterThan(kinds.indexOf("track"));
    expect(lane).not.toBeNull();
    // The lane is charged from the shared table; the rival lays its own switch
    // to the lane's mouth in the same turn, so that track rides the same bill —
    // and the bill the PLAN priced is exactly the bill the COMMIT presents
    // (the affordability gate the rival's turn runs saw this number).
    expect(lane!.spent).toEqual(lanePlan!.cost);
    for (const [k, v] of Object.entries(RAIL_COSTS.lane) as [keyof typeof RAIL_COSTS.lane, number][]) {
      expect(lane!.spent[k] ?? 0, `spent.${k}`).toBeGreaterThanOrEqual(v);
    }
    expect(lane!.label).toMatch(/adds a lane/);

    // The station now holds two lanes, and the lane's own stopping track was
    // laid with it (inside the lane's price, as the rules promise).
    const P = plantPlat(w);
    const lanes = stationLanes(P);
    expect(lanes.length).toBeGreaterThanOrEqual(2);
    expect(lanes.length).toBeLessThanOrEqual(MAX_LANES);
    for (const l of lanes) {
      for (const [x, y] of laneTrackTiles(l)) expect(hasRail(w.rail.rail, x, y)).toBe(true);
    }
    // The upgrade's tiles rode the outcome, so the rival's build telegraph and
    // the charge cover the lane's footprint.
    expect(lane!.tiles.length).toBeGreaterThanOrEqual(3);

    // TWO lines into the SAME plant station — one per lane.
    expect(w.rail.lines).toHaveLength(2);
    expect(w.rail.lines.every((l) => l.dest === P.id)).toBe(true);
    expect(new Set(w.rail.lines.map((l) => l.source)).size).toBe(2);
    const destLanes = w.rail.lines.map((l) => l.destLane);
    expect(destLanes.every((id) => id != null)).toBe(true);
    expect(new Set(destLanes).size).toBe(2);
    // The second line stands on the lane the upgrade added — not on lane 0
    // (whose id is the station's own, materialised from the legacy footprint).
    expect(destLanes).toContain(P.id);
    expect(destLanes.some((id) => id !== P.id)).toBe(true);
    expect(lanes.filter((l) => l.lineId != null).length).toBeGreaterThanOrEqual(2);

    // Both trains run: no deadlock, no blocked train, and the planner is done.
    expect(w.rail.trains).toHaveLength(2);
    for (let i = 0; i < 120; i++) {
      autoTrains(w.rail, OWNER);
      tickTrains(w.rail, 1_000);
      for (const t of w.rail.trains) {
        expect(t.status, `train ${t.id}: ${t.blockedWhy}`).not.toBe("blocked");
      }
    }
    expect(w.rail.trains.every((t) => ["moving", "dwelling", "holding"].includes(t.status))).toBe(true);
    expect(plan(w)).toBeNull();
  });

  it("never proposes a lane while a lane is free", () => {
    // One industry only: the first line takes the station's one lane, and the
    // planner has nothing left to do — no speculative upgrades.
    const grid = flatGrid([industry(60, 40)]);
    const track = createTrack();
    const rail = createRailState();
    const factory: Factory = { owner: "ai", ownerId: OWNER, tx: 30, ty: 40, id: 0, townId: null };
    const eco: EconomyState = { grid, track, harvesters: [], factories: [factory], rail };
    const w: World = { grid, track, rail, factory, eco };
    const { kinds } = drive(w);
    expect(kinds).not.toContain("lane");
    expect(stationLanes(plantPlat(w))).toHaveLength(1);
    expect(rail.lines).toHaveLength(1);
  });
});
