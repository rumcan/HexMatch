/**
 * FLEET-2c: passing loops apply when DIFFERENT lines of one owner share track
 * (owner playtest 2026-09-29: "passing loop isn't really used or enforced when
 * they share rail lines").
 */
import { describe, it, expect } from "vitest";
import {
  createRailState, buildRail, placePlatform, placeDepot, createLine, buyTrain, startLine, tickTrains,
  placeLoop, blockMapFor, trainBuyRefusal, BUSY_NETWORK_WHY, WAIT_TO_PASS,
  loopSideTiles, loopRun, diagLinked, demolishStructure, octantOf, turnOk,
} from "../../src/iso/rail";
import { createTrack, tIdx, type Track } from "../../src/iso/track";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

function flatGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], towns: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 7,
  };
}
const row = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);

const OX = 5, OY = 20;
/** One row y=OY; line A runs P1..P3, line B runs P2..P4 - they share P2..P3. */
function world(single = false) {
  const grid = flatGrid();
  const track: Track = createTrack();
  const state = createRailState();
  const mk = (x: number, id: number, kind: "industry" | "plant" = "industry") => placePlatform(state, "you", 1, x, OY - 1, "sw", { kind, id, tiles: [] });
  const p1 = mk(OX, 0), p2 = single ? p1 : mk(OX + 10, 1), p3 = mk(OX + 45, 2, "plant"), p4 = mk(OX + 51, 3, "plant");
  expect(buildRail(grid, track, state, 1, row(OY, OX, OX + 54)).ok).toBe(true);
  expect(buildRail(grid, track, state, 1, [[OX + 35, OY], [OX + 36, OY + 1]]).ok).toBe(true);
  expect(buildRail(grid, track, state, 1, [[OX + 36, OY + 1], [OX + 37, OY]]).ok).toBe(true);
  const depot = placeDepot(state, "you", 1, OX + 36, OY + 2, "ne");
  const a = createLine(state, 1, p1.id, p3.id).line!;
  const b = createLine(state, 1, p2.id, p4.id).line!;
  return { grid, track, state, depot, a, b };
}
type World = ReturnType<typeof world>;

function simulate(w: World, trips: number, maxMs = 8_000_000) {
  const { state, grid } = w;
  const bm = blockMapFor(state, 1);
  const trips_ = new Map<number, number>();
  const was = new Map<number, boolean>();
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
      if (d && !was.get(tr.id)) trips_.set(tr.id, (trips_.get(tr.id) ?? 0) + 1);
      was.set(tr.id, d);
    }
    if (state.trains.every((tr) => (trips_.get(tr.id) ?? 0) >= trips)) return { done: true, waited };
  }
  return { done: false, waited, trips: [...trips_] };
}

describe("FLEET-2c two lines sharing track", () => {
  it("(a) with a loop on the shared stretch: 20 round trips, one head per block, a wait happens", () => {
    const w = world();
    expect(placeLoop(w.state, "you", 1, OX + 20, OY, "sw").kind).toBe("loop");
    const r1 = buyTrain(w.state, 1, w.depot.id, w.a.id, w.grid);
    expect(r1.ok, r1.why).toBe(true);
    const r2 = buyTrain(w.state, 1, w.depot.id, w.b.id, w.grid);
    expect(r2.ok, r2.why).toBe(true);
    expect(startLine(w.state, 1, w.a.id, w.grid)).toBe(true);
    expect(startLine(w.state, 1, w.b.id, w.grid)).toBe(true);
    const res = simulate(w, 20);
    expect(res.done, JSON.stringify(res)).toBe(true);
    expect(res.waited).toBe(true);
  });

  it("(b) without a loop the 2nd line's train is refused with the loop text", () => {
    const w = world();
    expect(buyTrain(w.state, 1, w.depot.id, w.a.id, w.grid).ok).toBe(true);
    expect(trainBuyRefusal(w.state, 1, w.depot.id, w.b.id, w.grid)).toBe(BUSY_NETWORK_WHY);
    expect(buyTrain(w.state, 1, w.depot.id, w.b.id, w.grid).ok).toBe(false);
  });
});

describe("FLEET-2c a train drives INTO the loop and waits there", () => {
  it("the yielding train stands on side-track tiles past the first switch; the other passes on the main line", () => {
    const w = world(true);
    const loop = placeLoop(w.state, "you", 1, OX + 20, OY, "sw");
    const side = new Set(loopSideTiles(loop).map(([x, y]) => tIdx(x, y)));
    const run = loopRun(loop);
    const inner = new Set(run.slice(1, run.length - 1).map(([x, y]) => tIdx(x, y)));
    // the reserved place is the side track (and the run's inside), never the main line before the loop
    const bm = blockMapFor(w.state, 1);
    const place = bm.places.get(`L${loop.id}`)!;
    for (const t of side) expect(place.tiles).toContain(t);
    expect(place.tiles).not.toContain(tIdx(run[0][0], run[0][1]));
    for (let n = 0; n < 2; n++) expect(buyTrain(w.state, 1, w.depot.id, w.a.id, w.grid).ok).toBe(true);   // two trains meet head-on at the loop
    startLine(w.state, 1, w.a.id, w.grid);
    let yieldedOnSide = false, passedWhileYielding = false;
    const trips = new Map<number, number>();
    const was = new Map<number, boolean>();
    for (let t = 0; t < 8_000_000; t += 100) {
      tickTrains(w.state, 100, w.grid);
      const at = (tr: (typeof w.state.trains)[number]) => {
        const p = tr.route[Math.min(tr.route.length - 1, Math.round(tr.dist))];
        return p ? tIdx(p[0], p[1]) : -1;
      };
      for (const tr of w.state.trains) {
        if (tr.route.length && tr.blockedWhy === WAIT_TO_PASS && side.has(at(tr))) {
          yieldedOnSide = true;
          if (w.state.trains.some((o) => o !== tr && o.route.length && inner.has(at(o)) && o.status !== "dwelling")) passedWhileYielding = true;
        }
        const d = tr.status === "dwelling" && tr.target === "dest";
        if (d && !was.get(tr.id)) trips.set(tr.id, (trips.get(tr.id) ?? 0) + 1);
        was.set(tr.id, d);
        // never wait ON the main line inside the loop's run
        if (tr.route.length && tr.blockedWhy === WAIT_TO_PASS) expect(inner.has(at(tr)), `t=${t} ` + w.state.trains.map((q) => `${q.id}:${q.status}/${q.target} ${q.route.length ? at(q) % 144 + "," + Math.floor(at(q) / 144) : "-"} d${q.dist.toFixed(2)} ${q.blockedWhy ? "W" : ""} [${(q.resv ?? []).join("|")}] route=${q.route.slice(Math.max(0, Math.floor(q.dist) - 1), Math.floor(q.dist) + 4).join(";")}`).join("  ")).toBe(false);
      }
      if (w.state.trains.every((tr) => (trips.get(tr.id) ?? 0) >= 20)) break;
    }
    expect(w.state.trains.every((tr) => (trips.get(tr.id) ?? 0) >= 20), JSON.stringify([...trips])).toBe(true);
    expect(yieldedOnSide).toBe(true);
    expect(passedWhileYielding).toBe(true);
  });
});

describe("FLEET-2c the loop has no 90 degree corner", () => {
  it("its switches are 45 degree diagonals and every turn along the side track is 45 degrees or less", () => {
    const w = world();
    const loop = placeLoop(w.state, "you", 1, OX + 20, OY, "sw");
    const run = loopRun(loop), side = loopSideTiles(loop);
    // real layer track: both switches are linked diagonals
    expect(diagLinked(w.state.rail, run[0][0], run[0][1], side[0][0], side[0][1])).toBe(true);
    const lastRun = run[run.length - 1], lastSide = side[side.length - 1];
    expect(diagLinked(w.state.rail, lastRun[0], lastRun[1], lastSide[0], lastSide[1])).toBe(true);
    const path = [run[0], ...side, lastRun];
    for (let i = 2; i < path.length; i++) {
      const a = octantOf(path[i - 1][0] - path[i - 2][0], path[i - 1][1] - path[i - 2][1]);
      const b = octantOf(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      expect(turnOk(a, b), `turn ${i}`).toBe(true);
    }
    // and no tile of the loop links to a neighbour at a right angle: the first step is diagonal
    expect(Math.abs(side[0][0] - run[0][0]) + Math.abs(side[0][1] - run[0][1])).toBe(2);
  });

  it("demolishing the loop takes its side track out again", () => {
    const w = world();
    const loop = placeLoop(w.state, "you", 1, OX + 20, OY, "sw");
    const side = loopSideTiles(loop);
    const run = loopRun(loop);
    expect(w.state.rail.tile[tIdx(side[0][0], side[0][1])]).not.toBe(0);
    expect(demolishStructure(w.state, loop.id)).not.toBeNull();
    expect(w.state.rail.tile[tIdx(side[0][0], side[0][1])]).toBe(0);
    expect(diagLinked(w.state.rail, run[0][0], run[0][1], side[0][0], side[0][1])).toBe(false);
  });
});
