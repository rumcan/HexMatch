// ══════════════════════════════════════════════════════════════════════════
// #429 — RAIL-SLOPE: switchbacks, slope-aware routing, clearer refusals.
//
// The acceptance block this file pins, in the order the ticket writes it:
//
//   • a switchback up a 2-level hill is drawn in ONE drag: when the geometric
//     line between the ends breaks a slope rule, the preview plans a legal
//     zig-zag (the bounded A* over the shared rail rules), and the commit
//     builds exactly the tiles the preview painted;
//   • two drags compose like one line: the ramp run is counted ACROSS the
//     join with the seat's standing rail, so a second drag that would leave
//     the composed line two climbs with no ramp in between is refused;
//   • the rules still bite: a diagonal link across a level change is refused
//     when no legal detour exists, and ONLY the offending tiles go red, with
//     the tooltip naming the rule and the fix;
//   • the router finds the legal zig-zag where the straight line is refused
//     (the straight line itself is still what the refusal names);
//   • roads: the same 2-level climb under the road's own rule — no ramp run
//     for roads, so the road's switchback is the straight line (report-only;
//     the road rule needed no #429 change);
//   • trains run the routed line: `railPath` crosses the 90° corner on a
//     ramp's top/bottom tile (the one 45° exception) only when a grid grades
//     it, and `tickTrains` drives the climb at the uphill pace.
//
// Fixtures are full-size grids (a MAP_W × MAP_H grid where `tIdx`/`idx`
// agree): `map(rows)` stamps small patterns of LEVELS at the top-left and
// leaves the rest flat grass — the level-0 "sea" the router may detour
// through, exactly like the playable map.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import { createTrack, octPath, previewDrag, tIdx } from "../../src/iso/track";
import { climbLevels, railDragSlopeRefusals } from "../../src/iso/slopes";
import {
  RAIL_REFUSAL_TEXT, buildRail, createRailState, railPath, railPreview,
  tickTrains,
} from "../../src/iso/rail";

// ── fixture ───────────────────────────────────────────────────────────────
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

/** Every step of `path` that is a diagonal climbs no level (the rule the
 *  straight line breaks — the routed line must not break it either). */
const noDiagonalClimb = (g: Grid, path: [number, number][]): void => {
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = path[i - 1];
    const [x1, y1] = path[i];
    if (Math.abs(x1 - x0) === 1 && Math.abs(y1 - y0) === 1) {
      expect(climbLevels(g, [x0, y0], [x1, y1])).toBe(0);
    }
  }
};

// ══════════════════════════════════════════════════════════════════════════
describe("#429 the one-drag switchback (slope-aware routing)", () => {
  // A 2-level hill: a level-1 shoulder, a level-2 top. The geometric line
  // (0,2)→(3,2) climbs 0→1→2 with no flat tile between the two climbs —
  // a step, not a ramp — and the level-2 top is two tiles wide, so the
  // only way over is the zig-zag that leaves one flat tile of run per climb.
  const hill = () => map([
    "00000",
    "01110",
    "01220",
  ]);

  it("routes the drag the straight line cannot, and the commit builds what the preview painted", () => {
    const g = hill();
    const straight = octPath(0, 2, 3, 2, true);
    // The shared rule refuses the geometric line (two climbs one step apart)…
    expect(railDragSlopeRefusals(g, straight).size).toBeGreaterThan(0);
    // …but a legal zig-zag exists between the same ends, so the preview plans
    // it: no refusal, both ends reached, every step the rule allows.
    const pv = railPreview(g, createTrack(), createRailState(), 1, { stone: 99 }, 0, 2, 3, 2);
    expect(pv.why).toBeNull();
    expect(pv.truncated).toBe(false);
    expect(pv.blocked).toEqual([]);
    expect(pv.tiles).not.toEqual(straight);
    expect(pv.tiles[0]).toEqual([0, 2]);
    expect(pv.tiles[pv.tiles.length - 1]).toEqual([3, 2]);
    expect(railDragSlopeRefusals(g, pv.tiles).size).toBe(0);
    noDiagonalClimb(g, pv.tiles);
    // The commit's re-run (same world, same ends, same deterministic route)
    // builds the tiles the preview painted, for the preview's cost.
    const res = buildRail(g, createTrack(), createRailState(), 1, pv.tiles);
    expect(res.why).toBe("ok");
    expect(res.built).toEqual(pv.tiles);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("#429 two drags compose like one line (the run across the join)", () => {
  it("refuses the second drag when the composed line has no ramp", () => {
    // 0 0 1 2 : the first drag climbs onto ONE tile of level 1; the second
    // drag's step 1→2 is a well-run climb on its own — but the line it makes
    // with the standing rail has its two climbs one step apart.
    const g = map(["0012", "0000"]);
    const track = createTrack();
    const rail = createRailState();
    const first = buildRail(g, track, rail, 1, [[0, 0], [1, 0], [2, 0]]);
    expect(first.why).toBe("ok");
    // The drag's own shape is legal…
    expect(railDragSlopeRefusals(g, [[2, 0], [3, 0]]).size).toBe(0);
    // …as is its straight line with no context — the refusal comes from the
    // run counted across the join with the standing rail.
    const pv = railPreview(g, track, rail, 1, { stone: 99 }, 2, 0, 3, 0);
    expect(pv.why).toBe("too-steep");
    expect(pv.tiles).toEqual([]);
    expect(pv.blocked).toEqual([[2, 0], [3, 0]]);
    // The composed line, judged as one drag, is the wall the rule names.
    expect(railDragSlopeRefusals(g, [[0, 0], [1, 0], [2, 0], [3, 0]]).size).toBeGreaterThan(0);
    // …and the tooltip says the rule AND the fix.
    expect(RAIL_REFUSAL_TEXT["too-steep"]).toMatch(/2 flat tiles/i);
  });

  it("lets the two-drag switchback through when the shelf leaves the run", () => {
    // 0 1 1 2 : the first drag climbs onto TWO tiles of level 1 — one line
    // with the second drag's climb, and the run the rule asks for.
    const g = map(["0112", "0000"]);
    const track = createTrack();
    const rail = createRailState();
    expect(buildRail(g, track, rail, 1, [[0, 0], [1, 0], [2, 0]]).why).toBe("ok");
    const pv = railPreview(g, track, rail, 1, { stone: 99 }, 2, 0, 3, 0);
    expect(pv.why).toBeNull();
    expect(pv.tiles).toEqual([[2, 0], [3, 0]]);
    // The two drags are one line for the rule: its two climbs leave
    // `railRampRun` of run.
    expect(railDragSlopeRefusals(g, [[0, 0], [1, 0], [2, 0], [3, 0]]).size).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("#429 the rules still bite (refusals with red only on the offending tiles)", () => {
  it("refuses a diagonal across a level when no legal detour exists, red on the two ends of the bad step", () => {
    // A level-1 tile ringed by 2-level cliffs, open only to the level-0 sea:
    // every legal step into it is a diagonal climb — the router has the whole
    // map and still has no route, so the straight line is judged and the
    // diagonal link is what stops it.
    const g = map([
      "020",
      "212",
      "020",
    ]);
    const straight = octPath(0, 0, 1, 1, true);
    expect(railDragSlopeRefusals(g, straight).get(1)).toBe("slope-diagonal");
    const pv = railPreview(g, createTrack(), createRailState(), 1, { stone: 99 }, 0, 0, 1, 1);
    expect(pv.why).toBe("slope-diagonal");
    expect(pv.tiles).toEqual([]);
    // Only the two tiles of the offending diagonal go red.
    expect(pv.blocked).toEqual(straight);
    // …and the tooltip names the rule and the fix.
    expect(RAIL_REFUSAL_TEXT["slope-diagonal"]).toMatch(/level/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("#429 roads on the same hill (report: the road rule needed no change)", () => {
  it("climbs the 2-level switchback on the straight line — roads have no ramp run", () => {
    // 0 1 1 2 : the road's rule is one level per step (plus the flat-flank
    // join) — no run rule — so the same climb the rail had to zig-zag is the
    // road's straight line.
    const g = map(["0112", "0000"]);
    const pv = previewDrag(g, createTrack(), "dirt", {}, 0, 0, 3, 0);
    expect(pv.tiles).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(pv.truncated).toBe(false);
    // …and a 2-level step is still the road's wall, exactly as before.
    const cliff = previewDrag(map(["0020", "0000"]), createTrack(), "dirt", {}, 0, 0, 2, 0);
    expect(cliff.tiles).toEqual([[0, 0], [1, 0]]);
    expect(cliff.blocked).toEqual([[2, 0]]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("#429 trains run the routed line (the 90° ramp corner, uphill pace)", () => {
  // 0 0 0 0 0
  // 0 1 1 1 0 : a level-1 shoulder,
  // 0 1 2 2 0 : a level-2 top. (0,2)→(2,2) straight climbs 0→1→2 with no
  // run, and the diagonal into the top is a climbing link — so the ONLY
  // legal route is the zig-zag (0,2) (1,2) (1,1) (2,1) (2,2), whose two
  // 90° turns sit on the top and bottom tiles of the ramps: corners the 45°
  // rule allows only because a grid grades them.
  const hill = () => map([
    "00000",
    "01110",
    "01220",
  ]);

  it("plans the switchback, builds it, and a train rides it at the uphill pace", () => {
    const g = hill();
    const track = createTrack();
    const rail = createRailState();
    const pv = railPreview(g, track, rail, 1, { stone: 99 }, 0, 2, 2, 2);
    expect(pv.why).toBeNull();
    // The switchback — a flat run, a 90° turn on the bottom tile of each
    // ramp (the switchback's turn), and one flat tile of run per climb.
    expect(pv.tiles).toEqual([[0, 2], [0, 1], [1, 1], [2, 1], [2, 2]]);
    const built = buildRail(g, track, rail, 1, pv.tiles);
    expect(built.why).toBe("ok");
    expect(built.built).toEqual(pv.tiles);

    // The 90° ramp corner is a way through only when a grid grades it.
    const goals = new Set([tIdx(2, 2)]);
    expect(railPath(rail, 1, [[0, 2]], goals, -1)).toBeNull();
    const path = railPath(rail, 1, [[0, 2]], goals, -1, g);
    expect(path).toEqual([[0, 2], [0, 1], [1, 1], [2, 1], [2, 2]]);

    // A train on the line runs its flat segment at the full pace and climbs
    // its first climb at the uphill pace — one level up = half speed, the
    // factor the E4 slope test pins.
    rail.trains.push({
      id: 1, ownerId: 1, lineId: 1, depotId: 1, status: "moving", target: "dest",
      route: path!, dist: 0, planRevision: rail.rail.revision,
      dwellMs: 0, dirBit: 2, resold: false,
    });
    tickTrains(rail, 150, g);
    expect(rail.trains[0].dist).toBeCloseTo(0.5, 6);
    // Midway along the line's first climb: half pace (uphillFactor).
    rail.trains[0].dist = 1.5;
    tickTrains(rail, 150, g);
    expect(rail.trains[0].dist).toBeCloseTo(1.75, 6);
  });
});
