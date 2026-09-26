// ══════════════════════════════════════════════════════════════════════════
// #456 — LEVEL GROUND: terraform tiles so you can build on hills.
//
// The acceptance block this file pins, in the ticket's order:
//
//   • a drag levels its rectangle to the height of the tile it started on;
//     one-tile taps level that tile (Shift raises / Alt lowers one level);
//   • the edge ramps around the patch move at most ONE level each, and every
//     neighbour step involving a changed tile stays ≤ 1 in all EIGHT
//     directions — the generator's own invariant;
//   • water (sea and river), structures (buildings, depots, factories), rail
//     and bridges refuse with their own readable reason and never move;
//   • a tile under road refuses ("That road would go too steep") when the
//     road's new step would break `roadStepRefusal`'s one-level rule;
//   • a cliff (three or more) the one-level ramp cannot bridge refuses with
//     "cliff";
//   • money = tile-levels moved (patch AND ramp tiles) × the per-level price,
//     and `levelCost` — BUILD-1 (#460)'s pure seam — answers the same
//     { money, levels } | { refusal } the commit charges;
//   • the edited heights ride saves and the MP wire as the DIFF from the
//     seed map (`heightDiffWire` / `applyHeightEdits`), and round-trip;
//   • a levelled patch rebuilds ONLY its own terrain-GL chunk — the windowed
//     rewrite equals a full rebuild, and the window is bounded.
//
// Fixtures are FULL-SIZE grids in `iso-slopes`' style: `map(rows)` stamps
// LEVELS at the top-left (`~` is river water with `rivers` set), every other
// tile level-0 grass. Every fixture is PRE-LEGAL (all 8-neighbour steps ≤ 1
// before the plan runs), so any refusal the plan reports is the rule's own.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { MAP_H, MAP_W } from "../../src/game/config";
import { BUILD_COSTS_MONEY, LEVEL_GROUND_COST, moneyValueOf } from "../../src/iso/config";
import { GRASS, WATER, heightAt, setHeightTiles, type Grid } from "../../src/iso/grid";
import { cornerHeight, invalidateDraper, invalidateElevation } from "../../src/iso/elevation";
import {
  LEVEL_GROUND_PRICE, LEVEL_REFUSAL_TEXT, applyHeightEdits, applyLevelPlan, heightDiffWire,
  levelCost, planLevel, rectTiles,
} from "../../src/iso/level-ground";
import { buildTile, createTrack } from "../../src/iso/track";
import {
  buildTerrainMesh, buildVertexShade, meshRefreshWindow,
  writeIndexRows, writeShadeRows, writeVertexRows,
} from "../../src/iso/terrain-gl/mesh";

// ── fixtures ──────────────────────────────────────────────────────────────
/**
 * A full 144×144 map: each char of `rows` is the LEVEL of a tile at the
 * top-left (`~` = river water at level 0 with `rivers` set). Every other tile
 * is level-0 grass.
 */
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

/** Every 8-neighbour step involving a changed tile must be at most one. */
function assertInvariant(g: Grid, changed: readonly (readonly [number, number])[]): void {
  for (const [x, y] of changed) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        expect(Math.abs(heightAt(g, x, y) - heightAt(g, nx, ny)),
          `step (${x},${y})→(${nx},${ny})`).toBeLessThanOrEqual(1);
      }
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
describe("#456 Level Ground — the plan", () => {
  it("levels a 3×3 patch to the START tile's height and keeps every step ≤ 1", () => {
    // A legal 2-field in a 1-ring. The drag starts on the 1 at (0,0), so the
    // whole rectangle levels DOWN to 1 — the four 2s move one level each.
    const g = map([
      "11111",
      "12221",
      "12221",
      "12221",
      "11111",
    ]);
    const plan = planLevel(g, rectTiles(0, 0, 2, 2));
    expect(plan.target).toBe(1);
    expect(plan.refused).toEqual([]);
    const applied = applyLevelPlan(g, plan);
    expect(applied.length).toBe(4);        // (1,1) (2,1) (1,2) (2,2)
    for (const [x, y] of applied) expect(heightAt(g, x, y)).toBe(1);
    assertInvariant(g, applied);
    // The bill: 4 tile-levels × the per-level price, and nothing else.
    expect(plan.levels).toBe(4);
    expect(plan.money).toBe(4 * LEVEL_GROUND_PRICE);
    expect(plan.changes.length).toBe(4);
  });

  it("auto-adds ONE-level ramps around the patch edge and charges them", () => {
    // A legal 3-plateau in a 2-field. Lowering the 3×3 patch to 0 must pull
    // the whole 2-ring down one level (16 tiles) so no neighbour steps two.
    const g = map([
      "2222222",
      "2333222",
      "2333222",
      "2333222",
      "2222222",
    ]);
    const plan = planLevel(g, rectTiles(1, 1, 3, 3), {}, 0);
    expect(plan.target).toBe(0);
    expect(plan.refused).toEqual([]);
    const patchMoves = plan.changes.filter(([x, y]) => x >= 1 && x <= 3 && y >= 1 && y <= 3);
    const rampMoves = plan.changes.filter(([x, y]) => x < 1 || x > 3 || y < 1 || y > 3);
    expect(patchMoves.length).toBe(9);     // 9 tiles × 3 levels
    expect(rampMoves.length).toBe(16);     // the whole 5×5 border, one level each
    // Each ramp moved EXACTLY one level — "adds one-level ramps", never more.
    for (const [x, y, to] of rampMoves) expect(Math.abs(to - heightAt(map([
      "2222222",
      "2333222",
      "2333222",
      "2333222",
      "2222222",
    ]), x, y))).toBe(1);
    expect(plan.levels).toBe(9 * 3 + 16 * 1);
    expect(plan.money).toBe(plan.levels * BUILD_COSTS_MONEY.levelGround);
    const applied = applyLevelPlan(g, plan);
    expect(applied.length).toBe(25);
    assertInvariant(g, applied);
  });

  it("raises and lowers one tile one level (Shift / Alt), and clamps at the ends", () => {
    const g = map([
      "000",
      "010",
      "000",
    ]);
    // Alt on the middle tile: 1 → 0 (the `target` override the tap sends).
    const down = planLevel(g, rectTiles(1, 1, 1, 1), {}, 0);
    expect(down.target).toBe(0);
    expect(down.changes).toEqual([[1, 1, 0]]);
    expect(down.levels).toBe(1);
    expect(down.refused).toEqual([]);
    // Shift: 1 → 2, and the eight edge tiles climb one level to hold the line.
    const up = planLevel(g, rectTiles(1, 1, 1, 1), {}, 2);
    expect(up.target).toBe(2);
    expect(up.changes[0]).toEqual([1, 1, 2]);
    expect(up.refused).toEqual([]);
    expect(up.changes.length).toBe(9);     // the tile + its 8-tile ramp ring
    expect(up.levels).toBe(1 + 8);
    const applied = applyLevelPlan(g, up);
    assertInvariant(g, applied);
    // At the top and bottom levels the nudge refuses (cliff reason, nothing
    // moves) — the tool pre-checks and says "already at the top level".
    const top = map(["333", "343", "333"]);
    const atTop = planLevel(top, rectTiles(1, 1, 1, 1), {}, 5);
    expect(atTop.changes).toEqual([]);
    expect(atTop.refused.map(([, , r]) => r)).toEqual(["cliff"]);
    const atBottom = planLevel(map(), rectTiles(1, 1, 1, 1), {}, -1);
    expect(atBottom.changes).toEqual([]);
  });

  it("refuses the tiles beside a frozen structure rather than folding the map", () => {
    // A legal 2-pyramid; the apex is a processing plant (builtAt), so it is
    // frozen at 2 while the patch levels to 0 — every tile beside it steps
    // two against the frozen height and refuses with the structure's reason,
    // and nothing at all is written (the invariant is never broken).
    const g = map([
      "00000",
      "01110",
      "01210",
      "01110",
      "00000",
    ]);
    g.builtAt = (x, y) => (x === 2 && y === 2 ? "plant" : null);
    const plan = planLevel(g, rectTiles(0, 0, 4, 4));
    expect(plan.refused.length).toBe(9);   // the plant + the 8 tiles beside it
    expect(plan.refused.every(([, , r]) => r === "structure")).toBe(true);
    expect(plan.changes).toEqual([]);
    expect(plan.money).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("#456 Level Ground — the refusals", () => {
  it("refuses water (sea and river) with a reason and never moves it", () => {
    const g = map([
      "00~",
      "000",
      "000",
    ]);
    const plan = planLevel(g, rectTiles(0, 0, 2, 2));
    expect(plan.refused).toContainEqual([2, 0, "water"]);
    expect(heightAt(g, 2, 0)).toBe(0);     // the river tile is untouched
    expect(LEVEL_REFUSAL_TEXT.water).toMatch(/water/i);
  });

  it("refuses buildings, depots and factories with a reason", () => {
    // The game installs `builtAt`; a depot lot stands at (1,0).
    const g = map();
    g.builtAt = (x, y) => (x === 1 && y === 0 ? "depot" : null);
    const plan = planLevel(g, rectTiles(0, 0, 2, 2));
    expect(plan.refused).toEqual([[1, 0, "structure"]]);
    expect(LEVEL_REFUSAL_TEXT.structure).toMatch(/building/i);
    // Industry occupancy refuses the same way on a bare test grid (no builtAt).
    const g2 = map();
    g2.occupancy[0 * MAP_W + 1] = 0;
    expect(planLevel(g2, rectTiles(0, 0, 2, 2)).refused).toEqual([[1, 0, "structure"]]);
  });

  it("refuses rail and bridges with their own reasons", () => {
    const g = map();
    g.builtAt = (x, y) => (x === 1 && y === 0 ? "rail" : null);
    expect(planLevel(g, rectTiles(0, 0, 2, 2)).refused).toEqual([[1, 0, "rail"]]);
    // A deck: track on the river tile — "bridge", which covers "water".
    const g2 = map(["00~", "000", "000"]);
    const t2 = createTrack();
    buildTile(t2, "road", 2, 0, 1);
    expect(planLevel(g2, rectTiles(0, 0, 2, 2), { track: t2 }).refused).toEqual([[2, 0, "bridge"]]);
    expect(LEVEL_REFUSAL_TEXT.bridge).toMatch(/bridge/i);
  });

  it("refuses a tile under road whose road step would go illegal (\"road\"), and levels it when legal", () => {
    // A legal paved slope 3-2 down a row, with the paved 1 beside it. The
    // tile at (1,0) levels UP to 3; the paved neighbour at 1 would then step
    // two and its own ramp is dropped (a free 0-tile behind it cannot
    // follow) — the road rule refuses (1,0) with "road", exactly the
    // `roadStepRefusal` threshold.
    const g = map([
      "3210",
      "2210",
      "1100",
    ]);
    const t = createTrack();
    for (let x = 0; x <= 2; x++) buildTile(t, "road", x, 0, 1);
    const plan = planLevel(g, rectTiles(0, 0, 1, 0), { track: t });
    expect(plan.refused).toEqual([[1, 0, "road"]]);
    expect(plan.changes).toEqual([]);
    expect(LEVEL_REFUSAL_TEXT.road).toMatch(/steep/i);
    // The SAME drag levels fine when the road stays legal on its new slope:
    // a paved 3-2-1 with a 1-field beside it, all road steps ≤ 1 after.
    const g2 = map([
      "32111",
      "22111",
      "11111",
    ]);
    const t2 = createTrack();
    for (let x = 0; x <= 2; x++) buildTile(t2, "road", x, 0, 1);
    const ok = planLevel(g2, rectTiles(0, 0, 2, 0), { track: t2 });
    expect(ok.refused).toEqual([]);
    expect(ok.changes.length).toBe(5);     // 2 patch + 3 ramps
    const applied = applyLevelPlan(g2, ok);
    assertInvariant(g2, applied);
  });

  it("refuses a cliff (three or more) the one-level ramp cannot bridge", () => {
    // The same legal slope, no road: the drop of three beside the low end
    // cannot be bridged by ONE ramp of one level, so the tiles beside it
    // refuse with "cliff" and nothing folds.
    const g = map([
      "3210",
      "2210",
      "1100",
    ]);
    const plan = planLevel(g, rectTiles(0, 0, 3, 0), {}, 3);
    expect(plan.refused.length).toBe(3);
    expect(plan.refused.every(([, , r]) => r === "cliff")).toBe(true);
    expect(LEVEL_REFUSAL_TEXT.cliff).toMatch(/cliff|drop/i);
    const applied = applyLevelPlan(g, plan);
    expect(applied).toEqual([]);
    assertInvariant(g, applied);
  });

  it("option-off maps (no height bytes) are a no-op", () => {
    const g = map();
    (g as { height?: Uint8Array }).height = undefined;
    const plan = planLevel(g, rectTiles(0, 0, 2, 2));
    expect(plan.changes).toEqual([]);
    expect(plan.money).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("#456 Level Ground — the money (BUILD-1's levelCost seam)", () => {
  it("prices tiles × levels — patch AND ramps — from the one table", () => {
    // The legal slope 3-2-1 with a 1-field beside it: levelling the row to 3
    // pulls the three edge tiles up one level each (the one-level ramps).
    const g = map([
      "32111",
      "22111",
      "11111",
    ]);
    const cost = levelCost(g, rectTiles(0, 0, 2, 0));
    // (1,0): 2→3, (2,0): 1→3, ramps (3,0) (3,1) (2,1): 1→2 → 6 tile-levels.
    expect(cost).toEqual({ money: 60, levels: 6 });
    // The one price table: {stone: 2} a tile-level is $10 at starting prices,
    // and the money row the commit charges is exactly `levels ×` it.
    expect(LEVEL_GROUND_COST).toEqual({ stone: 2 });
    expect(LEVEL_GROUND_PRICE).toBe(moneyValueOf(LEVEL_GROUND_COST));
    expect(LEVEL_GROUND_PRICE).toBe(10);
    // The plan and the cost seam agree to the number.
    const plan = planLevel(g, rectTiles(0, 0, 2, 0));
    expect(plan.money).toBe((cost as { money: number }).money);
    expect(plan.levels).toBe((cost as { levels: number }).levels);
  });

  it("answers with a refusal instead of a price when anything refuses", () => {
    const g = map(["00~", "000", "000"]);
    const cost = levelCost(g, rectTiles(0, 0, 2, 2));
    expect("refusal" in cost).toBe(true);
    if ("refusal" in cost) expect(cost.refusal).toBe("water");
    // Pure: the map is untouched by a costing.
    expect(heightAt(g, 2, 0)).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("#456 Level Ground — the wire (saves + MP)", () => {
  it("carries the changed heights as the diff from the seed map, and round-trips", () => {
    const g = map([
      "1111",
      "1221",
      "1221",
      "1111",
    ]);
    const seedHeights = new Uint8Array(g.height!);
    const plan = planLevel(g, rectTiles(0, 0, 2, 2), {}, 1);
    const changed = applyLevelPlan(g, plan);
    expect(changed.length).toBe(4);
    // The wire diff is exactly the four changed tiles.
    const wire = heightDiffWire(g.height!, seedHeights, MAP_W, MAP_H);
    expect(wire.length).toBe(4 * 3);
    // A fresh map (the loader's `generateMap` result) plus the diff = ours.
    const fresh = map([
      "1111",
      "1221",
      "1221",
      "1111",
    ]);
    const written = applyHeightEdits(fresh, wire);
    expect(written.length).toBe(4);
    expect(Array.from(fresh.height!)).toEqual(Array.from(g.height!));
    // A wire with no edits is a no-op, and a corrupt/out-of-range triple is
    // skipped rather than half-applied.
    expect(applyHeightEdits(fresh, [])).toEqual([]);
    expect(applyHeightEdits(fresh, [1, 1, 9, 0, 0, 2])).toEqual([[0, 0]]);   // 9 refused; 2 lands
    expect(heightAt(fresh, 0, 0)).toBe(2);
    // `setHeightTiles` (the grid mutation seam) is the same write path.
    const g2 = map();
    expect(setHeightTiles(g2, [[2, 2, 3]])).toEqual([[2, 2]]);
    expect(heightAt(g2, 2, 2)).toBe(3);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("#456 Level Ground — mesh rebuild only for the touched chunk", () => {
  it("the windowed rewrite equals a full rebuild, and the window is bounded", () => {
    const g = map([
      "32111",
      "22111",
      "11111",
    ]);
    // The map the renderer holds: a corner-lattice snapshot (exactly what
    // `mountTerrainGl` passes `setMap`).
    const heights = new Uint8Array((MAP_W + 1) * (MAP_H + 1));
    for (let j = 0; j <= MAP_H; j++) {
      for (let i = 0; i <= MAP_W; i++) heights[j * (MAP_W + 1) + i] = Math.max(0, Math.round(cornerHeight(g, i, j)));
    }
    const input = { w: MAP_W, h: MAP_H, terrain: g.terrain, rivers: g.rivers, heights, seed: 1 };
    const fullBefore = buildTerrainMesh(input);
    const shadeBefore = buildVertexShade(input);

    // Level the row to 3 — 2 patch moves and 3 ramps, one batch.
    const plan = planLevel(g, rectTiles(0, 0, 2, 0));
    const changed = applyLevelPlan(g, plan);
    expect(changed.length).toBe(5);
    invalidateElevation(g);
    invalidateDraper(g);

    // ONE batch, the `TerrainGl.heightsChanged` contract: refresh the corner
    // rows the change touches, then rebuild the chunk.
    const win = meshRefreshWindow(input, changed);
    expect(win).not.toBeNull();
    expect(win!.full).toBe(false);                     // a patch ≠ the map
    for (let j = win!.y0; j <= Math.min(MAP_H, win!.y1 + 1); j++) {
      for (let i = win!.x0; i <= Math.min(MAP_W, win!.x1 + 1); i++) {
        heights[j * (MAP_W + 1) + i] = Math.max(0, Math.round(cornerHeight(g, i, j)));
      }
    }
    const positions = fullBefore.positions.slice();
    const uvTile = fullBefore.uvTile.slice();
    const indices = fullBefore.indices.slice();
    const shade = shadeBefore.slice();
    writeVertexRows(input, win!.j0, win!.j1, positions, uvTile);
    writeShadeRows(input, win!.j0, win!.j1, shade);
    writeIndexRows(input, win!.ty0, win!.ty1, indices);

    // …equals a FULL rebuild of the edited map.
    const fullAfter = buildTerrainMesh(input);
    const shadeAfter = buildVertexShade(input);
    expect(Array.from(positions)).toEqual(Array.from(fullAfter.positions));
    expect(Array.from(uvTile)).toEqual(Array.from(fullAfter.uvTile));
    expect(Array.from(indices)).toEqual(Array.from(fullAfter.indices));
    expect(Array.from(shade)).toEqual(Array.from(shadeAfter));
    // And the untouched world outside the window's rows really is untouched:
    // vertex rows outside [j0, j1] equal the pre-edit buffers.
    const w1 = MAP_W + 1;
    for (let j = 0; j < MAP_H + 1; j++) {
      if (j >= win!.j0 && j <= win!.j1) continue;
      for (let i = 0; i < w1; i++) {
        const v = j * w1 + i;
        expect(positions[v * 2]).toBe(fullBefore.positions[v * 2]);
        expect(positions[v * 2 + 1]).toBe(fullBefore.positions[v * 2 + 1]);
      }
    }
    // A change covering the whole island IS a full rebuild instead.
    const all: [number, number][] = [];
    for (let y = 0; y < MAP_H; y += 20) for (let x = 0; x < MAP_W; x += 20) all.push([x, y]);
    expect(meshRefreshWindow(input, all)!.full).toBe(true);
    expect(meshRefreshWindow(input, [])).toBeNull();
    expect(meshRefreshWindow(input, [[-1, -1], [MAP_W, MAP_H]])).toBeNull();
  });
});
