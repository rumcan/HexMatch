// ══════════════════════════════════════════════════════════════════════════
// RAIL-SLOPE (#429) — rail on hills must accept switchbacks, refuse only the
// offending tiles, and compose across drags.
//
// The acceptance block this file pins:
//   • a switchback drag up a 2-level hill is accepted in ONE drag — when the
//     geometric line breaks a slope rule, the bounded search finds a legal
//     zig-zag (or says no, and the refusal is the rule's own words);
//   • and in TWO drags — the ramp run is counted ACROSS the join with the
//     player's standing rail, so a half-built climb and its continuation
//     compose as one line (and a too-tight continuation is refused);
//   • a diagonal across a level change is still refused — the one rule the
//     ticket keeps;
//   • refusals mark only the bad tiles (the tile the drag may not ENTER),
//     never the whole gesture;
//   • trains still run the result: the 45° turn rule with its new exception —
//     a 90° corner on a ramp's top or bottom tile — is the rule railPath uses
//     too, and the uphill factor still halves a train on the step it climbs.
//
// Fixtures follow `iso-slopes.test.ts`: a full-size grid with small LEVEL
// patterns stamped at the top-left, everything else flat grass. A stair-stepped
// hill is deliberate: rows of one level each, where EVERY diagonal straddles a
// level change — the shape that made switchbacks impossible, and the one the
// ticket says a player must now be able to draw.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { SLOPES } from "../../src/iso/config";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import { buildRail, createRailState, railJoinRunAt, railPath, railPreview,
  RAIL_REFUSAL_TEXT, tickTrains, type RailState } from "../../src/iso/rail";
import { createTrack, octPath, tIdx } from "../../src/iso/track";
import { railDragSlopeRefusals, railDragSlopeVerdict } from "../../src/iso/slopes";
import { routeRailSlope } from "../../src/iso/rail-slope-route";

function map(rows: string[] = []): Grid {
  const w = MAP_W, h = MAP_H;
  const terrain = new Uint8Array(w * h).fill(GRASS);
  const height = new Uint8Array(w * h);
  const rivers = new Uint8Array(w * h);
  const occupancy = new Int16Array(w * h).fill(-1);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const i = y * MAP_W + x;
      if (row[x] === "~") { terrain[i] = WATER; rivers[i] = 1; continue; }
      height[i] = Number(row[x]);
    }
  });
  return { w, h, terrain, rivers, height, industries: [], towns: [], occupancy, seed: 1 } as unknown as Grid;
}

/** A stair-stepped hill: row 0 is level 0, row 1 level 1, row 2 level 2. */
const HILL = (): Grid => map(["0000000000", "1111111100", "2222222200"]);

/** A drag priced and committed the way `game.ts` does it. */
function draw(g: Grid, state: RailState, x0: number, y0: number, x1: number, y1: number) {
  const track = createTrack();
  const pv = railPreview(g, track, state, 1, { stone: 99 }, x0, y0, x1, y1);
  const built = pv.tiles.length ? buildRail(g, track, state, 1, pv.tiles) : null;
  return { track, pv, built };
}

/** The rule the path must satisfy, asserted as a property so a different
 * (equally legal) search result can never make these tests order-sensitive. */
function expectLegalLine(g: Grid, tiles: readonly (readonly [number, number])[]): void {
  expect(railDragSlopeVerdict(g, tiles).flags.size, `flags on ${JSON.stringify(tiles)}`).toBe(0);
  expect(railDragSlopeVerdict(g, tiles).blocks.size, `blocks on ${JSON.stringify(tiles)}`).toBe(0);
  for (let i = 1; i < tiles.length; i++) {
    const [ax, ay] = tiles[i - 1], [bx, by] = tiles[i];
    expect(Math.max(Math.abs(bx - ax), Math.abs(by - ay)),
      "every step is one of rail's eight moves").toBe(1);
    // And no diagonal leaves its level — the kept rule, checked step by step.
    if (Math.abs(bx - ax) === 1 && Math.abs(by - ay) === 1) {
      expect(g.height![by * MAP_W + bx], "diagonal must be level").toBe(g.height![ay * MAP_W + ax]);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
describe("#429 the slope-aware router", () => {
  it("finds a legal zig-zag where the straight line is refused", () => {
    const g = HILL();
    // The drawn line: straight up the hill, (1,0) → (1,2). Two level changes
    // one tile apart — exactly the refusal that used to kill the drag.
    const straight = octPath(1, 0, 1, 2);
    expect(straight).toEqual([[1, 0], [1, 1], [1, 2]]);
    expect(railDragSlopeVerdict(g, straight).blocks.size).toBeGreaterThan(0);
    // The router answers the better question — "is there any legal line?" —
    // and finds one.
    const routed = routeRailSlope(g, 1, 0, 1, 2);
    expect(routed).not.toBeNull();
    expect(routed![0]).toEqual([1, 0]);
    expect(routed![routed!.length - 1]).toEqual([1, 2]);
    expect(routed!.length).toBeGreaterThan(3);                 // a zig-zag, not the straight-up line
    expectLegalLine(g, routed!);
  });

  it("the 90° ramp corner is what railPath accepts with the grid — and only the grid", () => {
    // A line whose sole way into the goal is a 90° corner at a ramp's foot:
    // (2,1)→(3,1) flat along the level, (3,1)→(3,2) up the hill. Trains with
    // the elevation round it; without, the 45° rule stands and there is no route.
    const g = HILL();
    const state = createRailState();
    const line: [number, number][] = [[2, 1], [3, 1], [3, 2]];
    expect(buildRail(g, createTrack(), state, 1, line).ok).toBe(true);
    const goals = new Set([tIdx(3, 2)]);
    expect(railPath(state, 1, [[2, 1]], goals, -1, g)).not.toBeNull();
    expect(railPath(state, 1, [[2, 1]], goals)).toBeNull();
  });

  it("says null when nothing legal fits in the bound (a lone cliff)", () => {
    // (2,0) stands two levels above everything that can touch it.
    const g = map(["002", "000"]);
    expect(routeRailSlope(g, 0, 0, 2, 0)).toBeNull();
  });
});

describe("#429 a switchback climbs a 2-level hill in one drag", () => {
  it("the preview routes it, and the commit lays it", () => {
    const g = HILL();
    const state = createRailState();
    const { pv, built } = draw(g, state, 1, 0, 1, 2);
    expect(pv.why).toBeNull();
    expect(pv.truncated).toBe(false);
    expect(pv.blocked).toEqual([]);
    expect(pv.tiles[0]).toEqual([1, 0]);
    expect(pv.tiles[pv.tiles.length - 1]).toEqual([1, 2]);
    expect(pv.tiles.length).toBeGreaterThan(3);                // it had to zig-zag
    expectLegalLine(g, pv.tiles);
    expect(built!.ok).toBe(true);
    expect(built!.built.length).toBe(pv.tiles.length);
  });

  it("trains run the result — the ramp corner is a way through, WITH the grid", () => {
    const g = HILL();
    const state = createRailState();
    const { pv } = draw(g, state, 1, 0, 1, 2);
    const goals = new Set([tIdx(1, 2)]);
    // railPath with the elevation knows the switchback's corners.
    expect(railPath(state, 1, [[1, 0]], goals, -1, g)).not.toBeNull();
  });

  it("trains are slowed by the climb (uphillFactor intact)", () => {
    const g = HILL();
    const st = createRailState();
    const line: [number, number][] = [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [2, 2], [1, 2]];
    expect(railDragSlopeVerdict(g, line).flags.size).toBe(0);  // a legal switchback
    expect(buildRail(g, createTrack(), st, 1, line).ok).toBe(true);
    // E4's pace rule, on the switchback's own geometry: a train inside a flat
    // step covers `dt × RAIL_SPEED` tiles, a train inside the climb step half
    // of it. The climb is step (2,0)→(2,1), so dist 1.9 rides it and 0.4 does not.
    const mk = (id: number, dist: number) => st.trains.push({
      id, ownerId: 1, lineId: 1, depotId: 0, status: "moving", target: "dest",
      route: line, dist, planRevision: st.rail.revision, dwellMs: 0, dirBit: 2, resold: false,
    } as never);
    mk(1, 0.4); mk(2, 1.9);
    tickTrains(st, 150, g);
    expect(st.trains[0].dist).toBeCloseTo(0.9, 6);
    expect(st.trains[1].dist).toBeCloseTo(2.15, 6);
  });
});

describe("#429 two drags compose as one line", () => {
  it("a climb finished by the next drag is accepted", () => {
    const g = HILL();
    const state = createRailState();
    // Drag one: the line's lower leg (1,0) → (2,1) — the drawn diagonal
    // straddles a level, so the preview routes it through (2,0).
    const a = draw(g, state, 1, 0, 2, 1);
    expect(a.pv.why).toBeNull();
    expectLegalLine(g, a.pv.tiles);
    expect(a.built!.ok).toBe(true);
    // Drag two: (2,1) → (1,2), starting ON the standing line and joining the
    // climb it left. The router must keep the run the standing line gives it —
    // here a line around (3,1)/(3,2), which is exactly what one big drag draws.
    const b = draw(g, state, 2, 1, 1, 2);
    expect(b.pv.why).toBeNull();
    expectLegalLine(g, b.pv.tiles);
    expect(b.pv.tiles[0]).toEqual([2, 1]);
    expect(b.pv.tiles[b.pv.tiles.length - 1]).toEqual([1, 2]);
    expect(b.built!.ok).toBe(true);
    // And the whole composed line runs trains end to end.
    expect(railPath(state, 1, [[1, 0]], new Set([tIdx(1, 2)]), -1, g)).not.toBeNull();
  });

  it("a too-tight continuation with nowhere to detour is refused, with the rule's words", () => {
    // A one-tile-wide ledge between waters: the line climbs onto it, and the
    // only place to go next is straight up — one tile after the last change.
    const g = map(["~0~", "~1~", "~2~"]);
    const state = createRailState();
    const a = draw(g, state, 1, 0, 1, 1);
    expect(a.built!.ok).toBe(true);                             // a single change stands alone
    // The standing line changed level AT the join: `railJoinRunAt` sees it…
    expect(railJoinRunAt(g, state, 1, 1, 1, new Set([tIdx(1, 1), tIdx(1, 2)])))
      .toBeLessThan(SLOPES.railRampRun);
    // …and the second drag is refused at its end tile, marked there alone.
    const b = draw(g, state, 1, 1, 1, 2);
    expect(b.pv.why).toBe("too-steep");
    expect(b.pv.blocked).toEqual([[1, 2]]);
    // The tooltip names the fix, not just the verdict.
    expect(RAIL_REFUSAL_TEXT["too-steep"]).toMatch(/2 flat tiles/i);
  });

  it("the run is counted across the join in both directions", () => {
    const g = HILL();
    // Head: a first change with no standing run behind the drag's start.
    expect(railDragSlopeVerdict(g, [[2, 1], [2, 2]], undefined, { before: 0 }).blocks.get(1))
      .toBe("too-steep");
    // One level tile behind it — the composite is a ramp again.
    expect(railDragSlopeVerdict(g, [[2, 1], [2, 2]], undefined, { before: 1 }).blocks.size).toBe(0);
    // Tail: the standing line beyond the END tile climbs on its very first step.
    const tail = railDragSlopeVerdict(g, [[3, 1], [3, 2]], undefined, { after: 0 });
    expect(tail.blocks.get(1)).toBe("too-steep");
    expect(railDragSlopeVerdict(g, [[3, 1], [3, 2]], undefined, { after: 1 }).blocks.size).toBe(0);
  });
});

describe("#429 the rules that stay", () => {
  it("a diagonal across a level change is still refused — rule and preview", () => {
    const g = map(["01", "11"]);
    const why = railDragSlopeRefusals(g, [[0, 0], [1, 1]]);
    expect(why.get(1)).toBe("slope-diagonal");
    expect(why.get(0)).toBe("slope-diagonal");                  // both ends: it is the STEP that is wrong
    // A target whose ONLY neighbour is across a level cannot be routed to:
    // the refusal stands, and the tooltip says how to fix it.
    const state = createRailState();
    const track = createTrack();
    const pv = railPreview(map(["1~", "~0"]), track, state, 1, { stone: 99 }, 1, 1, 0, 0);
    expect(pv.why).toBe("slope-diagonal");
    expect(RAIL_REFUSAL_TEXT["slope-diagonal"]).toMatch(/flat ground/i);
  });

  it("refusals mark only the offending tile, never the whole drag", () => {
    const g = map(["0002222222"]);
    const state = createRailState();
    const track = createTrack();
    const pv = railPreview(g, track, state, 1, { stone: 99 }, 0, 0, 8, 0);
    expect(pv.why).toBe("too-steep");
    // The line stops where the bad step's tail makes the tile below it unlayable
    // (it would autolink INTO the cliff), and red covers exactly the bad step —
    // both its tiles, never the rest of the drag.
    expect(pv.tiles).toEqual([[0, 0], [1, 0]]);
    expect(pv.blocked).toEqual([[2, 0], [3, 0]]);
  });

  it("a flat map never pays for any of this (and draws exactly the old line)", () => {
    const g = map();
    const state = createRailState();
    const track = createTrack();
    const pv = railPreview(g, track, state, 1, { stone: 99 }, 0, 0, 8, 0);
    expect(pv.tiles).toEqual(octPath(0, 0, 8, 0, true));
    expect(pv.why).toBeNull();
    expect(pv.truncated).toBe(false);
  });
});
