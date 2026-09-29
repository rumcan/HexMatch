/**
 * FLEET-2 (#596): the Passing Loop - two trains share one line.
 *
 * Rail-level: place, refuse and demolish a loop; blocks keep trains apart and
 * never deadlock; the one-train refusal lifts only where trains can pass; a
 * station lane passes too; the wire round-trips.
 */
import { describe, it, expect } from "vitest";
import {
  createRailState, buildRail, placePlatform, placeDepot, createLine, buyTrain, startLine, tickTrains,
  loopRefusal, placeLoop, loopRun, demolishStructure, blockMapFor, addStationLane, railToWire, applyRailWire,
  planRivalLoop, BUSY_NETWORK_WHY, MAX_TRAINS_PER_LINE, WAIT_TO_PASS, RAIL_REFUSAL_TEXT, RAIL_COSTS, LOOP_INFO,
  type RailState, type RailView,
} from "../../src/iso/rail";
import { createTrack, tIdx, type Track } from "../../src/iso/track";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { BUILD_COSTS_MONEY } from "../../src/iso/config";

// ── fixtures ──────────────────────────────────────────────────────────────
function flatGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], towns: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 7,
  };
}
const row = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);

/**
 * One long line along y = OY: source platform at the west end, dest platform
 * far east, a depot spur (a wye) at x = 6..8 and a straight quiet stretch
 * between x = 10 and x = 28 for loops.
 */
const OX = 5, OY = 20;
function world() {
  const grid = flatGrid();
  const track: Track = createTrack();
  const state = createRailState();
  const source = placePlatform(state, "you", 1, OX, OY - 1, "sw", { kind: "industry", id: 0, tiles: [] });
  const dest = placePlatform(state, "you", 1, OX + 32, OY - 1, "sw", { kind: "plant", id: 0, tiles: [] });
  expect(buildRail(grid, track, state, 1, row(OY, OX, OX + 35)).ok).toBe(true);
  expect(buildRail(grid, track, state, 1, [[OX + 5, OY], [OX + 6, OY + 1], [OX + 7, OY]]).ok).toBe(true);
  const depot = placeDepot(state, "you", 1, OX + 6, OY + 2, "ne");
  const line = createLine(state, 1, source.id, dest.id).line!;
  return { grid, track, state, source, dest, depot, line };
}
type World = ReturnType<typeof world>;

/** A loop whose run is tiles x0..x0+3 on the line row, the side track on the north side. */
const loopAt = (w: World, x0: number, view: RailView = "ne" as RailView) => {
  // view "sw" puts the strip on the north (y-1) side; "ne" on the south.
  void view;
  return placeLoop(w.state, "you", 1, x0, OY, "sw");
};

/** Run the sim, checking that no two trains ever have a head in one plain block. */
function simulate(w: World, trips: number, maxMs = 6_000_000) {
  const { state, grid } = w;
  const bm = blockMapFor(state, 1);
  const trips_ = new Map<number, number>();
  const wasDwelling = new Map<number, boolean>();
  let waited = false;
  for (let t = 0; t < maxMs; t += 100) {
    tickTrains(state, 100, grid);
    const inBlock = new Map<string, number>();
    for (const tr of state.trains) {
      if (tr.blockedWhy === WAIT_TO_PASS) waited = true;
      if (!tr.route.length) continue;
      const i = Math.min(tr.route.length - 1, Math.round(tr.dist));
      const seg = bm.segOf.get(tIdx(tr.route[i][0], tr.route[i][1]));
      if (seg && !bm.places.has(seg)) {
        const other = inBlock.get(seg);
        if (other !== undefined && other !== tr.id) throw new Error(`trains ${other} and ${tr.id} share block ${seg} at ${t}ms`);
        inBlock.set(seg, tr.id);
      }
      const d = tr.status === "dwelling" && tr.target === "dest";
      if (d && !wasDwelling.get(tr.id)) trips_.set(tr.id, (trips_.get(tr.id) ?? 0) + 1);
      wasDwelling.set(tr.id, d);
    }
    if (state.trains.every((tr) => (trips_.get(tr.id) ?? 0) >= trips)) return { done: true, waited, trips: trips_ };
  }
  return { done: false, waited, trips: trips_ };
}

function fleet(w: World, n: number) {
  for (let i = 0; i < n; i++) {
    const r = buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid);
    expect(r.ok, r.why).toBe(true);
  }
  expect(startLine(w.state, 1, w.line.id, w.grid)).toBe(true);
}

// ── (a) place, refuse, demolish ───────────────────────────────────────────
describe("FLEET-2 a Passing Loop is placed, refused with reasons, and demolished", () => {
  it("places on a straight run, adds a side track, and prices like two platforms", () => {
    const w = world();
    expect(loopRefusal(w.grid, w.state, 1, 15, OY, "sw")).toBe("ok");
    const rev = w.state.rail.revision;
    const s = loopAt(w, 15);
    expect(s.kind).toBe("loop");
    expect(w.state.rail.revision).toBeGreaterThan(rev);
    expect(loopRun(s)).toEqual(row(OY, 15, 19));   // FLEET-2c: 5 tiles now
    expect(BUILD_COSTS_MONEY.loop).toBeGreaterThanOrEqual(1.8 * BUILD_COSTS_MONEY.platform);
    expect(BUILD_COSTS_MONEY.loop).toBeLessThanOrEqual(2.2 * BUILD_COSTS_MONEY.platform);
    expect(RAIL_COSTS.loop).toBeTruthy();
    expect(LOOP_INFO).toBe("Passing Loop — a short second track beside the line. Two trains on the same line wait here to pass each other. Needs a straight run of 5 rail tiles.");
    // a loop on the same run twice is refused
    expect(loopRefusal(w.grid, w.state, 1, 15, OY, "sw")).toBe("overlap");
  });

  it("refuses each reason", () => {
    const w = world();
    const { grid, state } = w;
    expect(loopRefusal(grid, state, 1, 15, OY + 8, "sw")).toBe("loop-no-rail");
    expect(loopRefusal(grid, state, 2, 15, OY, "sw")).toBe("foreign-rail");
    expect(loopRefusal(grid, state, 1, 0, 0, "sw")).toBe("off-map");
    expect(loopRefusal(grid, state, 1, MAP_W - 2, OY, "sw")).toBe("off-map");
    // next to a platform (the dest platform's track starts at x = 37)
    expect(loopRefusal(grid, state, 1, 33, OY, "sw")).toBe("loop-platform");
    // a diagonal spur (the depot wye at x = 10..12) is a curve for the run
    expect(loopRefusal(grid, state, 1, 10, OY, "sw")).toBe("loop-curve");
    // a junction: a side arm on the run's inner tile
    const jw = world();
    jw.state.rail.tile[tIdx(27, OY)] |= 4;   // SW: an arm off the line
    expect(loopRefusal(jw.grid, jw.state, 1, 25, OY, "sw")).toBe("loop-junction");
    // a curve: a rail that turns at the run's end
    const track = w.track;
    expect(buildRail(grid, track, state, 1, [[20, OY], [21, OY + 1], [22, OY + 2], [22, OY + 3], [22, OY + 4], [22, OY + 5], [22, OY + 6]]).ok).toBe(true);
    expect(loopRefusal(grid, state, 1, 22, OY + 2, "se")).toBe("loop-curve");
    // a slope: the side track's ground sits a level higher
    const height = new Uint8Array(MAP_W * MAP_H);
    height[tIdx(26, OY - 1)] = 1;
    const sloped = { ...flatGrid(), height } as unknown as Grid;
    expect(loopRefusal(sloped, state, 1, 24, OY, "sw")).toBe("loop-slope");
    // a bridge: rail over water
    const wet = flatGrid();
    for (let x = 24; x <= 27; x++) wet.terrain[tIdx(x, OY)] = WATER;
    expect(loopRefusal(wet, state, 1, 24, OY, "sw")).toBe("loop-bridge");
    // the side track's own ground
    const busy = flatGrid();
    busy.terrain[tIdx(25, OY - 1)] = WATER;
    expect(loopRefusal(busy, state, 1, 24, OY, "sw")).toBe("water");
    // every refusal has a sentence
    for (const why of ["loop-no-rail", "loop-curve", "loop-slope", "loop-bridge", "loop-junction", "loop-platform"] as const) {
      expect(RAIL_REFUSAL_TEXT[why].length).toBeGreaterThan(10);
    }
  });

  it("demolishes, and refuses while a train holds it or while trains still need it", () => {
    const w = world();
    const s = loopAt(w, 15);
    expect(demolishStructure(w.state, s.id)?.kind).toBe("loop");
    expect(w.state.structures.some((o) => o.kind === "loop")).toBe(false);
    // with two trains on the line the loop cannot come down
    const s2 = loopAt(w, 15);
    fleet(w, 2);
    expect(demolishStructure(w.state, s2.id)).toBeNull();
    expect(w.state.structures.some((o) => o.kind === "loop")).toBe(true);
  });
});

// ── (d) the refusal without a loop ────────────────────────────────────────
describe("FLEET-2 sharing a line needs somewhere to pass", () => {
  it("refuses the 2nd train with the text when there is no loop", () => {
    const w = world();
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).ok).toBe(true);
    const second = buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid);
    expect(second.ok).toBe(false);
    expect(second.why).toBe(BUSY_NETWORK_WHY);
    expect(second.why).toMatch(/Passing Loop/);
  });

  it("allows a 2nd train with a loop, and caps a line at 3", () => {
    const w = world();
    loopAt(w, 15);
    loopAt(w, 22);
    for (let i = 0; i < 3; i++) expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).ok).toBe(true);
    const fourth = buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid);
    expect(fourth.ok).toBe(false);
    expect(fourth.why).toMatch(new RegExp(`${MAX_TRAINS_PER_LINE} trains`));
  });

  it("needs a loop per extra train: 3 trains on 1 loop is refused", () => {
    const w = world();
    loopAt(w, 15);
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).ok).toBe(true);
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).ok).toBe(true);
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).why).toBe(BUSY_NETWORK_WHY);
  });
});

// ── (b) (c) blocks: no two trains in a block, no deadlock ────────────────
describe("FLEET-2 blocks keep trains apart", () => {
  it("2 trains, 1 loop: 20 round trips each, never two in a block, no deadlock", () => {
    const w = world();
    loopAt(w, 18);
    fleet(w, 2);
    const r = simulate(w, 20);
    expect(r.done).toBe(true);
    expect(r.waited).toBe(true);           // they really did wait for each other
  });

  it("3 trains, 2 loops: 20 round trips each, never two in a block, no deadlock", () => {
    const w = world();
    loopAt(w, 14);
    loopAt(w, 24);
    fleet(w, 3);
    const r = simulate(w, 20);
    expect(r.done).toBe(true);
  });
});

// ── (e) a station lane is a passing place ─────────────────────────────────
describe("FLEET-2 a station lane passes trains too", () => {
  it("a 2-lane station in the middle of the line takes the place of a loop", () => {
    const w = world();
    // a third station on the line, mid-way, with a second lane
    const mid = placePlatform(w.state, "you", 1, 20, OY - 1, "sw", { kind: "plant", id: 1, tiles: [] });
    const lane = addStationLane(w.grid, w.track, w.state, 1, mid.id, -1);
    expect(lane.ok, String(lane.why)).toBe(true);
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).ok).toBe(true);
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).ok).toBe(true);
  });

  it("a 1-lane station in the middle does not", () => {
    const w = world();
    placePlatform(w.state, "you", 1, 20, OY - 1, "sw", { kind: "plant", id: 1, tiles: [] });
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).ok).toBe(true);
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).why).toBe(BUSY_NETWORK_WHY);
  });
});

// ── (g) the rival ─────────────────────────────────────────────────────────
describe("FLEET-2 the rival builds a loop for its second train", () => {
  it("plans nothing for one train, a loop for two, and nothing once the loop stands", () => {
    const w = world();
    expect(planRivalLoop(w.grid, w.state, 1)).toBeNull();
    expect(buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid).ok).toBe(true);
    expect(planRivalLoop(w.grid, w.state, 1)).toBeNull();
    // the rival's own second-train purchase is not this ticket: script it in
    const first = w.state.trains[0];
    w.state.trains.push({ ...first, id: w.state.seq++, route: [], status: "stored", target: "depot", resv: undefined });
    const pick = planRivalLoop(w.grid, w.state, 1);
    expect(pick).not.toBeNull();
    expect(loopRefusal(w.grid, w.state, 1, pick!.tx, pick!.ty, pick!.view)).toBe("ok");
    placeLoop(w.state, "ai", 1, pick!.tx, pick!.ty, pick!.view);
    expect(w.state.structures.filter((s) => s.kind === "loop")).toHaveLength(1);
    expect(planRivalLoop(w.grid, w.state, 1)).toBeNull();
    // ...and the two trains now run without meeting
    startLine(w.state, 1, w.line.id, w.grid);
    const r = simulate(w, 6);
    expect(r.done).toBe(true);
  });
});

// ── (f) the wire ──────────────────────────────────────────────────────────
describe("FLEET-2 saves and the wire carry loops and reservations", () => {
  it("round-trips a loop and a train's reservations", () => {
    const w = world();
    const s = loopAt(w, 18);
    fleet(w, 2);
    for (let i = 0; i < 400; i++) tickTrains(w.state, 100, w.grid);
    const wire = JSON.parse(JSON.stringify(railToWire(w.state)));
    expect(wire.structures.some((o: { kind: string }) => o.kind === "loop")).toBe(true);
    const copy = createRailState();
    expect(applyRailWire(copy, wire)).toBe(true);
    const loop = copy.structures.find((o) => o.kind === "loop")!;
    expect(loop).toMatchObject({ id: s.id, tx: s.tx, ty: s.ty, w: s.w, h: s.h, view: s.view });
    expect(copy.trains.map((t) => t.resv)).toEqual(w.state.trains.map((t) => t.resv));
    expect(w.state.trains.some((t) => t.resv?.length)).toBe(true);
  });

  it("an old wire (no loops, no reservations) loads unchanged", () => {
    const w = world();
    buyTrain(w.state, 1, w.depot.id, w.line.id, w.grid);
    startLine(w.state, 1, w.line.id, w.grid);
    const wire = JSON.parse(JSON.stringify(railToWire(w.state)));
    for (const t of wire.trains) delete t.resv;
    const copy = createRailState();
    expect(applyRailWire(copy, wire)).toBe(true);
    expect(copy.structures.some((o) => o.kind === "loop")).toBe(false);
    expect(copy.trains).toHaveLength(1);
    expect(copy.trains[0].resv).toBeUndefined();
    tickTrains(copy, 5000, w.grid);          // and it still runs
  });
});
