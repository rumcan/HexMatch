import { describe, expect, it } from "vitest";
import { MAP_W, MAP_H, mulberry32 } from "../../src/game/config";
import { GRASS, type Grid, type Industry } from "../../src/iso/grid";
import { INDUSTRY_BY_KEY } from "../../src/iso/config";
import { createTrack, DIRS, DIR, OPPOSITE, tIdx } from "../../src/iso/track";
import {
  RAIL_PRESENT, RAIL_DE, RAIL_DS, RAIL_REFUSAL_TEXT, createRailState,
  buildRail, railPreview, railTileRefusal, octPath, railPath, railToWire, applyRailWire,
  placePlatform, layPlatformTrack, tickTrains, autoTrains, type RailState,
} from "../../src/iso/rail";
import { planRailRoute, validateRailDrag, planRailMove, executeRailMove } from "../../src/iso/ai";
import type { EconomyState, Factory } from "../../src/iso/economy";

type Tile = [number, number];
const rich = { wood: 99999, stone: 99999, grain: 99999, ore: 99999, oil: 99999 };
function world(seed = 401) {
  const grid: Grid = { w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), industries: [], towns: [], seed };
  return { grid, track: createTrack(), state: createRailState() };
}

// Independent oracle: decode the raw one-sided diagonal storage as well as
// reciprocal orthogonal bits. Do NOT call the production turn/join predicate.
function neighbours(state: RailState, x: number, y: number): Tile[] {
  const rail = state.rail, i = tIdx(x, y), out: Tile[] = [];
  const own = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H
    && !!(rail.tile[tIdx(nx, ny)] & RAIL_PRESENT) && rail.owner[tIdx(nx, ny)] === rail.owner[i];
  for (const d of DIRS) {
    const nx = x + DIR[d][0], ny = y + DIR[d][1];
    if ((rail.tile[i] & d) && own(nx, ny) && (rail.tile[tIdx(nx, ny)] & OPPOSITE[d])) out.push([nx, ny]);
  }
  for (const [dx, dy] of [[1, -1], [1, 1], [-1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (!own(nx, ny)) continue;
    const lower = dx > 0 ? i : tIdx(nx, ny);
    const bit = dx * dy < 0 ? RAIL_DE : RAIL_DS;
    if (rail.tile[lower] & bit) out.push([nx, ny]);
  }
  return out;
}
const legal = (a: Tile, b: Tile) =>
  (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b)) >= Math.SQRT1_2 - 1e-9;
function invariant(state: RailState, context = "") {
  for (let i = 0; i < state.rail.tile.length; i++) {
    if (!(state.rail.tile[i] & RAIL_PRESENT)) continue;
    const x = i % MAP_W, y = Math.floor(i / MAP_W), ns = neighbours(state, x, y);
    if (ns.length < 2) continue;
    // Owner clarification: WYEs are permitted. Each incoming arm must have
    // at least one <=45° exit, not every possible pair at a switch.
    for (const a of ns) expect(ns.some((b) => b !== a && legal(
      [x - a[0], y - a[1]], [b[0] - x, b[1] - y],
    )), `${context}: unsupported arm ${a} -> ${x},${y}`).toBe(true);
  }
}
function routeInvariant(route: Tile[]) {
  for (let i = 2; i < route.length; i++) expect(legal(
    [route[i - 1][0] - route[i - 2][0], route[i - 1][1] - route[i - 2][1]],
    [route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]],
  )).toBe(true);
}

describe("#401 rail turns, including joins and auto-links", () => {
  it.each([false, true])("refuses starting/ending a perpendicular join (reverse=%s), with a red prefix preview", (reverse) => {
    const { grid, track, state } = world();
    buildRail(grid, track, state, 1, octPath(10, 10, 16, 10));
    const [a, b]: Tile[] = reverse ? [[16, 14], [16, 10]] : [[16, 10], [16, 14]];
    const bytes = state.rail.tile.slice(), owners = state.rail.owner.slice(), revision = state.rail.revision;
    const preview = railPreview(grid, track, state, 1, rich, ...a, ...b);
    expect(preview.why).toBe("too-sharp");
    expect(RAIL_REFUSAL_TEXT[preview.why!]).toBe("Too sharp for rail: turns must be 45° or less");
    expect(preview.truncated).toBe(true);
    expect(preview.blocked[0]).toEqual([16, 11]);
    expect(preview.tiles).toEqual(reverse ? [[16, 14], [16, 13], [16, 12]] : [[16, 10]]);
    expect(state.rail.tile).toEqual(bytes);
    expect(state.rail.owner).toEqual(owners);
    expect(state.rail.revision).toBe(revision);
    const result = buildRail(grid, track, state, 1, octPath(...a, ...b));
    expect(result.why).toBe(preview.why);
    expect(result.built).toEqual(preview.tiles);
    expect(result.cost).toEqual(preview.cost);
    invariant(state);
  });

  it("refuses a one-tile auto-link, without changing neighbours, owner or revision", () => {
    const { grid, track, state } = world();
    buildRail(grid, track, state, 1, octPath(10, 10, 15, 10));
    const bytes = state.rail.tile.slice(), owners = state.rail.owner.slice(), revision = state.rail.revision;
    expect(railTileRefusal(grid, track, state, 1, 15, 11)).toBe("too-sharp");
    const result = buildRail(grid, track, state, 1, [[15, 11]]);
    expect(result).toMatchObject({ ok: false, why: "too-sharp", built: [], cost: {} });
    expect(state.rail.tile).toEqual(bytes);
    expect(state.rail.owner).toEqual(owners);
    expect(state.rail.revision).toBe(revision);
    // Collinear auto-link still works.
    expect(buildRail(grid, track, state, 1, [[16, 10]]).why).toBe("ok");
    invariant(state);
  });

  it.each([false, true])("refuses the 90°+90° diagonal zig-zag in either storage direction (%s)", (reverse) => {
    const { grid, track, state } = world();
    // Parallel diagonal straights, separated by one diagonal in the other axis.
    const first: Tile[] = [[10, 10], [11, 11], [12, 12]];
    const second: Tile[] = [[13, 11], [14, 12], [15, 13]];
    buildRail(grid, track, state, 1, first);
    buildRail(grid, track, state, 1, second);
    const path: Tile[] = reverse ? [[13, 11], [12, 12]] : [[12, 12], [13, 11]];
    const bytes = state.rail.tile.slice();
    expect(validateRailDrag(grid, track, state, 1, path).why).toBe("too-sharp");
    const preview = railPreview(grid, track, state, 1, rich, ...path[0], ...path[1]);
    expect(preview.why).toBe("too-sharp");
    expect(preview.blocked).toContainEqual(path[1]);
    expect(buildRail(grid, track, state, 1, path).why).toBe("too-sharp");
    expect(state.rail.tile).toEqual(bytes); // especially the lower-x diagonal slot
    invariant(state);
  });

  it("refuses a sharp turn inside a supplied drag as well as a join", () => {
    const { grid, track, state } = world();
    const path: Tile[] = [[10, 10], [11, 10], [11, 11], [12, 11]];
    expect(validateRailDrag(grid, track, state, 1, path).why).toBe("too-sharp");
    const result = buildRail(grid, track, state, 1, path);
    expect(result.why).toBe("too-sharp");
    expect(result.built).toEqual(path.slice(0, 2));
    invariant(state);
  });

  it("allows a 45°+45° jog over two tiles, joining two drags", () => {
    const { grid, track, state } = world();
    buildRail(grid, track, state, 1, octPath(8, 10, 12, 10));
    buildRail(grid, track, state, 1, octPath(14, 12, 18, 12));
    const jog = octPath(12, 10, 14, 12);
    expect(validateRailDrag(grid, track, state, 1, jog).ok).toBe(true);
    expect(buildRail(grid, track, state, 1, jog).why).toBe("ok");
    const route = railPath(state, 1, [[8, 10]], new Set([tIdx(18, 12)]));
    expect(route).not.toBeNull();
    routeInvariant(route!);
    invariant(state);
  });

  it("keeps a legal WYE but rejects a sharp extra spur", () => {
    const { grid, track, state } = world();
    buildRail(grid, track, state, 1, octPath(10, 10, 18, 10));
    expect(buildRail(grid, track, state, 1, octPath(14, 10, 17, 13)).why).toBe("ok");
    expect(neighbours(state, 14, 10)).toHaveLength(3);
    expect(buildRail(grid, track, state, 1, [[12, 9]]).why).toBe("too-sharp");
    invariant(state);
    routeInvariant(railPath(state, 1, [[10, 10]], new Set([tIdx(17, 13)]))!);
  });

  it("platform track goes through the same join guard", () => {
    const { grid, track, state } = world();
    buildRail(grid, track, state, 1, octPath(10, 10, 16, 10));
    const p = placePlatform(state, "you", 1, 15, 11, "se", null);
    layPlatformTrack(grid, track, state, p);
    expect(state.rail.tile[tIdx(16, 11)]).toBe(0);
    invariant(state);
  });

  it("property: seeded random drags, single-tile auto-links and existing-track joins stay legal", () => {
    let accepted = 0, refused = 0;
    for (const seed of [401, 268, 181, 9901]) {
      const { grid, track, state } = world(seed), random = mulberry32(seed);
      const coord = () => 10 + Math.floor(random() * 20);
      for (let n = 0; n < 120; n++) {
        const standing: Tile[] = [];
        for (let i = 0; i < state.rail.tile.length; i++) if (state.rail.tile[i] & RAIL_PRESENT) {
          standing.push([i % MAP_W, Math.floor(i / MAP_W)]);
        }
        const old = () => standing[Math.floor(random() * standing.length)];
        const a: Tile = n % 3 === 0 && standing.length ? old() : [coord(), coord()];
        const b: Tile = n % 5 === 0 ? a : n % 3 === 1 && standing.length ? old() : [coord(), coord()];
        const first = random() > 0.5;
        const preview = railPreview(grid, track, state, 1, rich, ...a, ...b, first);
        // game.ts commits preview.tiles, not the original full gesture.
        const commit: RailState = { ...state, rail: { ...state.rail,
          tile: state.rail.tile.slice(), owner: state.rail.owner.slice() } };
        const prefix = buildRail(grid, track, commit, 1, preview.tiles);
        expect(prefix.built, `committed prefix seed=${seed}, action=${n}`).toEqual(preview.tiles);
        expect(prefix.cost).toEqual(preview.cost);
        invariant(commit, `prefix seed=${seed}, action=${n}`);
        const result = buildRail(grid, track, state, 1, octPath(...a, ...b, first));
        expect(result.built, `seed=${seed}, action=${n}`).toEqual(preview.tiles);
        expect(result.cost).toEqual(preview.cost);
        if (result.built.length) accepted++;
        if (result.why === "too-sharp") refused++;
        invariant(state, `seed=${seed}, action=${n}`);
      }
    }
    expect(accepted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });

  it("affordable prefixes remain buildable when a planned diagonal is cut off", () => {
    const { grid, track, state } = world();
    buildRail(grid, track, state, 1, octPath(12, 10, 17, 10));
    for (const stone of [0, 3, 6, 9, 12]) {
      const preview = railPreview(grid, track, state, 1, { stone }, 10, 12, 16, 18);
      const commit: RailState = { ...state, rail: { ...state.rail,
        tile: state.rail.tile.slice(), owner: state.rail.owner.slice() } };
      const result = buildRail(grid, track, commit, 1, preview.tiles);
      expect(result.built).toEqual(preview.tiles);
      expect(result.cost).toEqual(preview.cost);
      invariant(commit);
    }
  });

  it("rival A* returns only a fully validated join (or no route)", () => {
    const { grid, track, state } = world();
    buildRail(grid, track, state, 2, octPath(10, 10, 18, 10));
    const path = planRailRoute(grid, track, state, 2, 18, 10, 24, 18);
    expect(path).not.toBeNull();
    expect(validateRailDrag(grid, track, state, 2, path!).ok).toBe(true);
    expect(buildRail(grid, track, state, 2, path!).why).toBe("ok");
    invariant(state);
  });

  it("seeded rival: 120 one-second ticks plan/execute, spawn and drive legal track", () => {
    const { grid, track, state } = world(401), random = mulberry32(grid.seed);
    const type = Object.keys(INDUSTRY_BY_KEY)[0], def = INDUSTRY_BY_KEY[type];
    const ind: Industry = { id: 0, type, tx: 60 + Math.floor(random() * 3), ty: 40,
      w: def.footprint[0], h: def.footprint[1], output: def.output, banditUntil: 0 };
    grid.industries.push(ind);
    for (let y = ind.ty; y < ind.ty + ind.h; y++) for (let x = ind.tx; x < ind.tx + ind.w; x++) grid.occupancy[tIdx(x, y)] = 0;
    const factory: Factory = { owner: "ai", ownerId: 2, tx: 30, ty: 40, id: 0, townId: null };
    const eco: EconomyState = { grid, track, rail: state, factories: [factory], harvesters: [] };
    let trackMoves = 0;
    for (let tick = 0; tick < 120; tick++) {
      const move = planRailMove(eco, state, factory, { purse: rich, ownerId: 2, useRail: true, now: tick * 1000 });
      if (move) {
        if (move.kind === "track") {
          expect(validateRailDrag(grid, track, state, 2, move.tiles).ok).toBe(true);
          trackMoves++;
        }
        expect(executeRailMove(eco, state, move, "ai", 2)).not.toBeNull();
      }
      autoTrains(state, 2);
      tickTrains(state, 1000, grid);
      invariant(state, `rival tick=${tick}`);
      for (const t of state.trains) routeInvariant(t.route);
    }
    expect(trackMoves).toBeGreaterThan(0); // no vacuous 'rival built nothing' pass
    expect(state.trains.length).toBeGreaterThan(0);
    expect(state.trains.some((t) => t.status === "moving" || t.status === "dwelling")).toBe(true);
  });

  it.each([0, 4])("loads sharp legacy bytes unchanged and blocks the transition (distance=%s)", (dist) => {
    const { state } = world();
    // Legacy right-angle L, stamped directly rather than through today's builder.
    const source = placePlatform(state, "you", 1, 9, 9, "sw", { kind: "industry", id: 0, tiles: [] });
    const dest = placePlatform(state, "you", 1, 13, 13, "se", { kind: "plant", id: 0, tiles: [] });
    const old: Tile[] = [...octPath(10, 10, 14, 10), ...octPath(14, 11, 14, 14)];
    state.lines.push({ id: 1, ownerId: 1, name: "Legacy L", source: source.id, dest: dest.id });
    for (const [x, y] of old) { state.rail.tile[tIdx(x, y)] = RAIL_PRESENT; state.rail.owner[tIdx(x, y)] = 1; }
    for (let n = 1; n < old.length; n++) {
      const a = old[n - 1], b = old[n];
      const d = DIRS.find((d) => a[0] + DIR[d][0] === b[0] && a[1] + DIR[d][1] === b[1])!;
      state.rail.tile[tIdx(...a)] |= d;
      state.rail.tile[tIdx(...b)] |= OPPOSITE[d];
    }
    state.rail.revision = 9;
    state.trains.push({ id: 1, ownerId: 1, lineId: 1, depotId: 0, status: "moving", target: "dest",
      route: old, dist, planRevision: 9, dwellMs: 0, dirBit: 2, resold: false });
    const loaded = createRailState();
    expect(applyRailWire(loaded, railToWire(state))).toBe(true);
    expect(loaded.rail.tile).toEqual(state.rail.tile);
    expect(loaded.rail.owner).toEqual(state.rail.owner);
    expect(loaded.trains[0].planRevision).toBe(-1);
    expect(railPath(loaded, 1, [old[0]], new Set([tIdx(...old[old.length - 1])]))).toBeNull();
    tickTrains(loaded, 1000);
    expect(loaded.trains[0].status).toBe("blocked");
    expect(loaded.trains[0].blockedWhy).toContain("90° bend");
    expect(loaded.rail.tile).toEqual(state.rail.tile);
  });
});
