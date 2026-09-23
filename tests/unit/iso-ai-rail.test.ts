// ══════════════════════════════════════════════════════════════════════════
// RAIL-05 (#182) — the rival's railway: planned and built through rail.ts.
//
// `planRailMove` decides ONE rail action per turn and `executeRailMove`
// commits it through the same shared functions the player's clicks run
// (`buildRail`, `placePlatform`, `placeDepot`, `assignLine`, `sellTrain`).
// These tests drive that loop on a hand-built flat map — a plant far enough
// from an industry that the road is not the cheap answer — and pin:
//
//   * the order a new line is built in: platforms → track → depot → train,
//     then nothing more while it runs (one train per network);
//   * a CUT line is repaired, never "recalled" into a loop that cannot route;
//   * an orphaned train at home is sold, and a moving orphan is left alone;
//   * the easy chair never plays the railway;
//   * a platform's point cannot be farmed by demolishing and rebuilding.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  planRailMove, executeRailMove, railStepCost, validateRailDrag, type RailMove,
} from "../../src/iso/ai";
import {
  createRailState, tickTrains, autoTrains, demolishRail, buildRail, createLine, buyTrain,
  structuresOf, railComponents, stopTile, trainOccupies, laneTiles, platformTrack, trainAtHome,
  placePlatform, demolishStructure,
  type RailState,
} from "../../src/iso/rail";
import { createTrack, tIdx, type Track } from "../../src/iso/track";
import { GRASS, WATER, type Grid, type Industry } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";
import { RIVAL_SKILLS } from "../../src/iso/skill";
import { createScoreState, rescore, vpFor } from "../../src/iso/victory";
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

/** A plant at (30,40) and an industry 30 tiles east — well past the road threshold. */
function world(): World {
  const grid = flatGrid([industry(60, 40)]);
  const track = createTrack();
  const rail = createRailState();
  const factory: Factory = { owner: "ai", ownerId: OWNER, tx: 30, ty: 40, id: 0, townId: null };
  const eco: EconomyState = { grid, track, harvesters: [], factories: [factory], rail };
  return { grid, track, rail, factory, eco };
}

const plan = (w: World, useRail = true) =>
  planRailMove(w.eco, w.rail, w.factory, { purse: rich, ownerId: OWNER, useRail, now: 0 });

/** Plan → execute until the planner has nothing to do (or `stopAt` is planned). */
function drive(w: World, stopAt?: RailMove["kind"], turns = 80): { kinds: RailMove["kind"][]; next: RailMove | null } {
  const kinds: RailMove["kind"][] = [];
  for (let i = 0; i < turns; i++) {
    const move = plan(w);
    if (!move || move.kind === stopAt) return { kinds, next: move };
    const res = executeRailMove(w.eco, w.rail, move, "ai", OWNER);
    expect(res, `turn ${i}: the planned ${move.kind} was refused on execute`).not.toBeNull();
    kinds.push(move.kind);
    tickTrains(w.rail, 1_000);
  }
  return { kinds, next: plan(w) };
}

const platformOf = (rail: RailState, kind: "industry" | "plant") =>
  structuresOf(rail, OWNER, "platform").find((p) => p.anchor?.kind === kind)!;

describe("RAIL-05 the rival builds a line through the shared rules", () => {
  it("builds platforms, then track — no depot, no train to buy — and then waits", () => {
    const w = world();
    const { kinds, next } = drive(w);
    expect(kinds[0]).toBe("platform");
    const first = (k: RailMove["kind"]) => kinds.indexOf(k);
    expect(kinds.filter((k) => k === "platform")).toHaveLength(2);
    expect(first("track")).toBeGreaterThan(kinds.lastIndexOf("platform"));
    // Playtest (2026-09): the depot is gone and trains spawn on their own.
    expect(first("depot")).toBe(-1);
    expect(first("train")).toBe(-1);
    // The line is complete, so the planner has nothing left to do.
    expect(next).toBeNull();
    expect(platformOf(w.rail, "plant")).toBeTruthy();
    expect(platformOf(w.rail, "industry")).toBeTruthy();
    // The track the rival laid is DRIVABLE (no 90° bend): the automatic
    // train runs it.
    expect(autoTrains(w.rail, OWNER)).toBe(true);
    expect(w.rail.lines).toHaveLength(1);
    expect(w.rail.trains).toHaveLength(1);
    for (let i = 0; i < 60; i++) tickTrains(w.rail, 1_000);
    expect(["moving", "dwelling"]).toContain(w.rail.trains[0].status);
  });
});

describe("RAIL-05 a broken line is repaired, never recalled into a loop", () => {
  it("re-lays the cut stretch instead of planning a recall", () => {
    const w = world();
    drive(w);
    const plant = platformOf(w.rail, "plant");
    const ind = platformOf(w.rail, "industry");
    const lanes = new Set(w.rail.structures.flatMap((s) =>
      [...laneTiles(s), ...(s.kind === "platform" ? platformTrack(s) : [])].map(([x, y]) => tIdx(x, y))));
    // Cut ONE track tile that really separates the two platforms.
    let cut: [number, number] | null = null;
    for (let i = 0; i < w.rail.rail.tile.length && !cut; i++) {
      if (!w.rail.rail.tile[i] || w.rail.rail.owner[i] !== OWNER || lanes.has(i)) continue;
      const x = i % MAP_W, y = (i / MAP_W) | 0;
      if (trainOccupies(w.rail, x, y)) continue;
      expect(demolishRail(w.rail, x, y)).toBe(true);
      const comp = railComponents(w.rail, OWNER);
      const a = comp.get(tIdx(...stopTile(plant))) ?? 0;
      const b = comp.get(tIdx(...stopTile(ind))) ?? 0;
      if (a !== b || a === 0) cut = [x, y];
      else buildRail(w.grid, w.track, w.rail, OWNER, [[x, y]]);   // not a cut: put it back
    }
    expect(cut, "no single tile separates the platforms").not.toBeNull();
    // Let the train discover the break.
    for (let i = 0; i < 120; i++) tickTrains(w.rail, 1_000);
    const move = plan(w);
    expect(move?.kind).toBe("track");
    // Repairing it lets the planner settle again.
    expect(executeRailMove(w.eco, w.rail, move!, "ai", OWNER)).not.toBeNull();
    const comp = railComponents(w.rail, OWNER);
    expect(comp.get(tIdx(...stopTile(plant)))).toBe(comp.get(tIdx(...stopTile(ind))));
  });

  // Playtest (2026-09): the rival no longer buys trains (they spawn on their
  // own), so it has no bought train to sell. Back when depots return.
  it.skip("sells an orphaned train that is home, and never recalls a moving orphan", () => {
    // Home: a stored train whose line is gone is sold for the one-time 50%.
    const home = world();
    const { next } = drive(home, "train");
    expect(next?.kind).toBe("train");
    const depot = structuresOf(home.rail, OWNER, "depot")[0];
    const line = createLine(home.rail, OWNER, platformOf(home.rail, "industry").id, platformOf(home.rail, "plant").id).line!;
    expect(buyTrain(home.rail, OWNER, depot.id, line.id).ok).toBe(true);
    home.rail.lines.splice(home.rail.lines.indexOf(line), 1);
    expect(trainAtHome(home.rail, home.rail.trains[0])).toBe(true);
    const sell = plan(home);
    expect(sell?.kind).toBe("sell");
    const sold = executeRailMove(home.eco, home.rail, sell!, "ai", OWNER);
    expect(sold?.refund).toBeTruthy();
    expect(home.rail.trains).toHaveLength(0);

    // Away: an orphan out on the line cannot route home (no line), so the
    // planner must not burn its turns on a recall.
    const away = world();
    drive(away);
    for (let i = 0; i < 20; i++) tickTrains(away.rail, 1_000);
    const train = away.rail.trains[0];
    expect(trainAtHome(away.rail, train)).toBe(false);
    away.rail.lines.length = 0;
    const move = plan(away);
    expect(move === null || move.kind !== "recall").toBe(true);
  });
});

describe("RAIL-05 levers and rules", () => {
  it("the easy chair never plays the railway; normal and hard do", () => {
    expect(RIVAL_SKILLS.easy.rail).toBe(false);
    expect(RIVAL_SKILLS.normal.rail).toBe(true);
    expect(RIVAL_SKILLS.hard.rail).toBe(true);
    expect(plan(world(), false)).toBeNull();
  });

  it("ranks with its own cost table but lets the shared rule refuse a drag", () => {
    const w = world();
    w.grid.terrain[tIdx(40, 20)] = WATER;
    expect(Number.isFinite(railStepCost(w.grid, w.track, w.rail, OWNER, 40, 20))).toBe(false);
    const drag: [number, number][] = [[38, 20], [39, 20], [40, 20], [41, 20]];
    const verdict = validateRailDrag(w.grid, w.track, w.rail, OWNER, drag);
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toBe("water");
  });

  it("scores a platform once: demolishing and rebuilding never accumulates a point", () => {
    const w = world();
    const score = createScoreState();
    const platforms = () => w.rail.structures
      .filter((s) => s.kind === "platform")
      .map((s) => ({ id: s.id, ownerId: s.ownerId, owner: s.owner, tx: s.tx, ty: s.ty }));
    for (let cycle = 0; cycle < 4; cycle++) {
      const s = placePlatform(w.rail, "ai", OWNER, 20, 20, "se", { kind: "industry", id: 0, tiles: [] });
      rescore(w.eco, score, platforms());
      expect(vpFor(score, "ai")).toBe(1);
      expect(demolishStructure(w.rail, s.id)).not.toBeNull();
      rescore(w.eco, score, platforms());
      expect(vpFor(score, "ai")).toBe(0);
    }
  });
});
