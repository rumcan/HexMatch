// ══════════════════════════════════════════════════════════════════════════
// RAIL-6 (#575) — expandable stations, headless.
//
// A station is ONE structure: a warehouse plus one to four lanes (platform
// tracks). Placing a platform makes a 1-lane station; the upgrade adds a lane
// on the side the player picks, priced from the shared money table, refused in
// the same vocabulary as every other placement. The warehouse art tier follows
// the lane count. Every lane is its own approach: `autoTrains` only starts a
// line when both stations have a lane to assign, trains book a lane at the
// stop they are heading for, and a train that finds every lane busy HOLDS at
// the throat until one frees — a queue that always drains, never a deadlock.
//
// The map is hand-built: one plant station facing a trunk line with a 45° fan
// onto each lane's western approach, and three industry stations merging into
// the trunk. Every assertion is about a rule, not about a particular island.
//
//   industry C (29,16) ╲ diag run
//   industry A (29,20) ──╲        trunk row y=22, x 33..38
//   plant P    (40,20)    (34,22)═══(38,22)╱(39,21)─ lane 0 track y=21
//   industry B (29,24) ──╱(36,22)    ╲(39,22)─ lane 1 track y=23 (added)
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createRailState, RAIL_COSTS, MAX_LANES, placePlatform, layPlatformTrack, buildRail,
  addStationLane, laneRefusal, stationLanes, laneTrackTiles, laneStopTile, laneOriginAt,
  stationWarehouseTier, railStructureItems, autoTrains, tickTrains, createLine, railToWire,
  applyRailWire, railPanelRows, structureById, hasRail, trainTile,
  type Train, type RailState, type RailStructure,
} from "../../src/iso/rail";
import { createTrack, tIdx, type Track } from "../../src/iso/track";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { BUILD_COSTS } from "../../src/iso/config";

// ── fixtures ──────────────────────────────────────────────────────────────
function flatGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], towns: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 7,
  };
}

const row = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);

interface World {
  grid: Grid; track: Track; state: RailState;
  P: RailStructure; A: RailStructure; B: RailStructure; C: RailStructure;
  lay: (tiles: [number, number][], owner?: number) => void;
}

/** A bare plant station at (40,20) — no network, for the placement rules. */
function bareWorld(): World {
  const grid = flatGrid();
  const track = createTrack();
  const state = createRailState();
  const lay = (tiles: [number, number][], owner = 1) => {
    const res = buildRail(grid, track, state, owner, tiles);
    expect(res.why, `lay ${JSON.stringify(tiles)}`).toBe("ok");
  };
  const P = placePlatform(state, "you", 1, 40, 20, "sw", { kind: "plant", id: 0, tiles: [] });
  layPlatformTrack(grid, track, state, P);
  const stub = P;
  return { grid, track, state, P: stub, A: stub, B: stub, C: stub, lay };
}

/**
 * The full junction: the plant station, the trunk with its fan, and the three
 * industry stations each merged into the trunk with 45° runs only.
 */
function stationWorld(): World {
  const w = bareWorld();
  const { grid, track, state, lay } = w;
  // The trunk row and the fan: one tile that diagonals onto lane 0's western
  // approach, so a train rounds 45° into the lane track and stops on it.
  lay(row(22, 33, 38));
  lay([[38, 22], [39, 21], [40, 21]]);
  // The industry stations are four long, placed so each lane's track ENDS at
  // x=32, where its connector starts.
  // Industry A (29,20): track y=21, one bend down into the trunk.
  const A = placePlatform(state, "you", 1, 29, 20, "sw", { kind: "industry", id: 10, tiles: [] });
  layPlatformTrack(grid, track, state, A);
  lay([[32, 21], [33, 21], [34, 22], [35, 22]]);
  // Industry B (29,24): track y=25, a diagonal run up into the trunk.
  const B = placePlatform(state, "you", 1, 29, 24, "sw", { kind: "industry", id: 11, tiles: [] });
  layPlatformTrack(grid, track, state, B);
  lay([[32, 25], [33, 25], [34, 24], [35, 23], [36, 22]]);
  // Industry C (29,16): track y=17. A stopping lane is axis-only, so the
  // connector steps straight off it before the long diagonal run down.
  const C = placePlatform(state, "you", 1, 29, 16, "sw", { kind: "industry", id: 12, tiles: [] });
  layPlatformTrack(grid, track, state, C);
  lay([[32, 17], [33, 17], [34, 18], [35, 19], [36, 20], [36, 21], [37, 22]]);
  return { ...w, A, B, C };
}

/** Add lane 1 (side +1) and join its track to the fan, as a player's drag would. */
function openSecondLane(w: World): void {
  const res = addStationLane(w.grid, w.track, w.state, 1, w.P.id, 1);
  expect(res.why ?? "ok").toBe("ok");
  expect(res.ok).toBe(true);
  // The lane's track lands as its own short row; the join re-walks the tiles
  // the station owns (free) and writes the explicit links to the fan.
  w.lay([[38, 22], [39, 22], [40, 23], [41, 23], [42, 23]]);
}

/** Run both automatic lines up: A on lane 0, then the upgrade, then B on lane 1. */
function twoLineWorld(): World {
  const w = stationWorld();
  expect(autoTrains(w.state, 1)).toBe(true);       // line 1: A → P on lane 0
  expect(w.state.lines).toHaveLength(1);
  openSecondLane(w);
  expect(autoTrains(w.state, 1)).toBe(true);       // line 2: B → P on lane 1
  expect(w.state.lines).toHaveLength(2);
  return w;
}

const trainOf = (w: World, lineId: number): Train =>
  w.state.trains.find((t) => t.lineId === lineId)!;

describe("RAIL-6 the station and its lanes", () => {
  it("a placed platform is a ONE-lane station, and the upgrade grows it to four", () => {
    const w = bareWorld();
    const { state, P } = w;
    const lanes0 = stationLanes(P);
    expect(lanes0).toHaveLength(1);
    expect(lanes0[0]).toMatchObject({ view: "sw", tx: 40, ty: 20, lineId: null });
    // The lane's track is the platform track the epic always had.
    expect(laneTrackTiles(lanes0[0])).toEqual([[40, 21], [41, 21], [42, 21], [43, 21]]);
    expect(laneStopTile(lanes0[0])).toEqual([41, 21]);

    // Three upgrades, each on the side the player picks — one lane at a time.
    const origins: [number, number][] = [];
    for (let n = 2; n <= MAX_LANES; n++) {
      const res = addStationLane(w.grid, w.track, state, 1, P.id, 1);
      expect(res.ok, `lane ${n}: ${res.why}`).toBe(true);
      expect(stationLanes(P)).toHaveLength(n);
      // The new lane is the outermost: two tiles along the row axis (its own
      // strip plus its own track), and its stopping tiles are laid with it.
      origins.push([res.lane!.tx, res.lane!.ty]);
      for (const [x, y] of laneTrackTiles(res.lane!)) expect(hasRail(state.rail, x, y)).toBe(true);
    }
    expect(origins).toEqual([[40, 22], [40, 24], [40, 26]]);
    // Lanes stay in map order along the row — a stable draw and panel order.
    expect(stationLanes(P).map((l) => l.ty)).toEqual([20, 22, 24, 26]);

    // The fifth lane is refused, on BOTH sides, with the maximum's own reason.
    expect(laneRefusal(w.grid, state, 1, P.id, 1)).toBe("max-lanes");
    expect(laneRefusal(w.grid, state, 1, P.id, -1)).toBe("max-lanes");
    expect(addStationLane(w.grid, w.track, state, 1, P.id, 1)).toEqual({ ok: false, why: "max-lanes" });
  });

  it("the player picks the side: -1 grows the other way", () => {
    const w = bareWorld();
    expect(laneOriginAt(w.P, -1)).toEqual({ tx: 40, ty: 18 });
    const res = addStationLane(w.grid, w.track, w.state, 1, w.P.id, -1);
    expect(res.ok).toBe(true);
    expect([res.lane!.tx, res.lane!.ty]).toEqual([40, 18]);
    expect(laneTrackTiles(res.lane!)).toEqual([[40, 19], [41, 19], [42, 19], [43, 19]]);
    for (const [x, y] of laneTrackTiles(res.lane!)) expect(hasRail(w.state.rail, x, y)).toBe(true);
    // The lane list is map-ordered: the new lane sorts BEFORE lane 0.
    expect(stationLanes(w.P).map((l) => l.ty)).toEqual([18, 20]);
  });

  it("refuses in the shared vocabulary, and says why", () => {
    // Water under the new lane's strip.
    {
      const w = bareWorld();
      w.grid.terrain[tIdx(41, 22)] = WATER;
      expect(laneRefusal(w.grid, w.state, 1, w.P.id, 1)).toBe("water");
    }
    // Something occupies the ground (an industry lot, a field).
    {
      const w = bareWorld();
      w.grid.occupancy[tIdx(41, 22)] = 3;
      expect(laneRefusal(w.grid, w.state, 1, w.P.id, 1)).toBe("occupied");
    }
    // Another structure overlaps the lane's footprint.
    {
      const w = bareWorld();
      placePlatform(w.state, "you", 1, 40, 22, "sw", null);
      expect(laneRefusal(w.grid, w.state, 1, w.P.id, 1)).toBe("overlap");
    }
    // The lane's track must be approached along its axis: a diagonal link
    // landing on a stopping tile would give trains a 90° into the lane.
    {
      const w = bareWorld();
      w.lay([[39, 24], [40, 23]]);
      expect(laneRefusal(w.grid, w.state, 1, w.P.id, 1)).toBe("axis-only");
    }
    // Not your station, and no station at all.
    {
      const w = bareWorld();
      expect(laneRefusal(w.grid, w.state, 2, w.P.id, 1)).toBe("not-yours");
      expect(laneRefusal(w.grid, w.state, 1, 99999, 1)).toBe("missing");
    }
  });

  it("is priced per lane from the SHARED money cost table", () => {
    // The Rail Baroness perk is a seat discount the game layer applies on top
    // (`seatCostOf`); the rule module reads the one table everyone pays from.
    expect(RAIL_COSTS.lane).toEqual(BUILD_COSTS.stationLane);
    expect(RAIL_COSTS.lane).toEqual({ wood: 3, stone: 3, ore: 6, oil: 1 });
  });

  it("draws the warehouse at the lane count's tier, one slab run per lane", () => {
    expect(stationWarehouseTier(1)).toBe(1);
    expect(stationWarehouseTier(2)).toBe(2);
    expect(stationWarehouseTier(3)).toBe(3);
    expect(stationWarehouseTier(4)).toBe(3);   // three art tiers for four lanes

    const w = bareWorld();
    expect(addStationLane(w.grid, w.track, w.state, 1, w.P.id, 1).ok).toBe(true);
    // Warehouse on the head tile of lane 0, then per lane: the concrete slabs
    // (the first lane's head tile is the warehouse's own ground, and the cap
    // finishes every lane) — back to front, in map order.
    // Owner art (2026-09-29): four-tile lanes each draw the owner's platform
    // drawing at the lane's own origin (the warehouse/slab set is for old
    // three-tile lanes).
    expect(railStructureItems(w.state).map((i) => [i.sprite, i.tx, i.ty])).toEqual([
      ["platform_sw", 40, 20], ["platform_sw", 40, 22],
    ]);
    // An atlas without the station art falls back to the legacy platform sprite.
    expect(railStructureItems(w.state, { has: () => false }).map((i) => [i.sprite, i.tx, i.ty]))
      .toEqual([["platform_sw", 40, 20]]);
  });

  it("the panel row shows the lanes, the busy count, and NO lane action (the on-map + invite adds lanes)", () => {
    const w = twoLineWorld();
    const rows = railPanelRows(w.state, 1);
    const p = rows.find((r) => r.id === w.P.id)!;
    expect(p.label).toBe("Station · 2 lanes (sw) · plant #0");
    expect(p.actions).toEqual([]);
    // Both trains are booked into their lanes from the first metre.
    expect(p.detail).toMatch(/lines: Line 1, Line 2 · 2\/2 lanes busy/);
    const a = rows.find((r) => r.id === w.A.id)!;
    expect(a.label).toBe("Station · 1 lane (sw) · industry #10");
    expect(a.detail).toMatch(/line: Line 1 · 0\/1 lane busy/);
    const c = rows.find((r) => r.id === w.C.id)!;
    expect(c.detail).toMatch(/not on a line/);
    expect(c.actions).toEqual([]);

    // At four lanes the upgrade is gone — nothing left to click.
    const bare = bareWorld();
    for (let n = 0; n < 3; n++) addStationLane(bare.grid, bare.track, bare.state, 1, bare.P.id, 1);
    const full = railPanelRows(bare.state, 1).find((r) => r.id === bare.P.id)!;
    expect(full.label).toBe("Station · 4 lanes (sw) · plant #0");
    expect(full.actions).toEqual([]);
  });
});

describe("RAIL-6 two resources feed one plant station at the same time", () => {
  it("gives each line its own lane, and both trains dwell there at once", () => {
    const w = twoLineWorld();
    const { state, P } = w;
    // One plant station, two lines into it — all lanes of a plant's station
    // feed the plant, and the cargo stays separate per LINE (#462's ledger is
    // keyed by line id, and the two lines are distinct records).
    expect(state.lines.every((l) => l.dest === P.id)).toBe(true);
    expect(new Set(state.lines.map((l) => l.source)).size).toBe(2);
    const lanes = stationLanes(P);
    expect(state.lines.map((l) => l.destLane).sort()).toEqual([...lanes.map((l) => l.id)].sort());
    expect(new Set(state.lines.map((l) => l.destLane)).size).toBe(2);
    expect(lanes.every((l) => l.lineId != null)).toBe(true);

    // Run the railway: both trains reach the station and dwell AT THE SAME
    // TIME, each on its own lane's track — two trains, one plant, one station.
    const tA = trainOf(w, state.lines[0].id);
    const tB = trainOf(w, state.lines[1].id);
    let together: { laneA: number | null | undefined; laneB: number | null | undefined; tileA: [number, number]; tileB: [number, number] } | null = null;
    for (let i = 0; i < 480 && !together; i++) {
      tickTrains(state, 500);
      expect(tA.status).not.toBe("blocked");
      expect(tB.status).not.toBe("blocked");
      if (tA.status === "dwelling" && tA.target === "dest"
        && tB.status === "dwelling" && tB.target === "dest") {
        together = { laneA: tA.laneId, laneB: tB.laneId, tileA: trainTile(tA), tileB: trainTile(tB) };
      }
    }
    expect(together, "both trains dwell at the plant station at once").not.toBeNull();
    expect(together!.laneA).not.toBe(together!.laneB);
    // Lane 0's track is row y=21, lane 1's row y=23 — the trains stand apart.
    expect(together!.tileA[1]).toBe(21);
    expect(together!.tileB[1]).toBe(23);
  });

  it("does not start a third line while every lane is assigned", () => {
    const w = twoLineWorld();
    // C is connected and claimable, but the station's two lanes are taken:
    // the pass changes nothing, however often it runs.
    expect(autoTrains(w.state, 1)).toBe(false);
    expect(w.state.lines).toHaveLength(2);
    expect(w.state.trains).toHaveLength(2);
    // The moment a third lane exists, the line appears on the next pass. The
    // connector joins it through the fan with 45°s only: trunk → (39,23) diag
    // → (39,24) → the lane's own track — a train can drive every step.
    const res = addStationLane(w.grid, w.track, w.state, 1, w.P.id, 1);
    expect(res.ok).toBe(true);
    w.lay([[38, 22], [39, 23], [39, 24], [40, 25], [41, 25], [42, 25]]);
    expect(autoTrains(w.state, 1)).toBe(true);
    expect(w.state.lines).toHaveLength(3);
    expect(w.state.lines[2].source).toBe(w.C.id);
    expect(w.state.lines[2].destLane).toBe(res.lane!.id);
  });
});

describe("RAIL-6 three trains, two lanes: a queue at the throat, never a deadlock", () => {
  it("holds the third train outside the station and rotates it through", () => {
    const w = twoLineWorld();
    const { state, P } = w;
    // The third line EXISTS (the rule allows it) but has no lane to stand in:
    // its train runs to the station and queues at the throat.
    const made = createLine(state, 1, w.C.id, P.id);
    expect(made.ok, made.why).toBe(true);
    expect(made.line!.destLane ?? null).toBeNull();
    const tC: Train = {
      id: state.seq++, ownerId: 1, lineId: made.line!.id, depotId: 0,
      status: "stored", target: "dest", route: [], dist: 0,
      planRevision: state.rail.revision, dwellMs: 0, dirBit: 0, resold: false,
      laneId: null, holdStation: null,
    };
    state.trains.push(tC);
    const tA = trainOf(w, state.lines[0].id);
    const tB = trainOf(w, state.lines[1].id);

    // First tick: both lanes are booked, so C plans to the throat and HOLDS —
    // outside the station's track, naming the station it is waiting for.
    tickTrains(state, 500);
    expect(tC.status).toBe("holding");
    expect(tC.holdStation).toBe(P.id);
    expect(tC.laneId).toBeNull();
    expect(tC.route[tC.route.length - 1]).toEqual([39, 21]);
    const stationTracks = new Set(
      stationLanes(P).flatMap((l) => laneTrackTiles(l)).map(([x, y]) => tIdx(x, y)),
    );
    expect(stationTracks.has(tIdx(...tC.route[tC.route.length - 1]))).toBe(false);

    // Run the railway: every train keeps arriving at the plant. A dwell always
    // ends and a departure always frees its lane, so the queue drains — no
    // deadlock, and never two trains booked into the same lane at once.
    const arrivals = new Map<number, number>([[tA.id, 0], [tB.id, 0], [tC.id, 0]]);
    const prev = new Map<number, string>([[tA.id, tA.status], [tB.id, tB.status], [tC.id, tC.status]]);
    let cEntered = false;
    for (let i = 0; i < 800; i++) {
      tickTrains(state, 500);
      for (const t of [tA, tB, tC]) {
        expect(t.status, `train ${t.id} blocked: ${t.blockedWhy}`).not.toBe("blocked");
        if (t.status === "dwelling" && t.target === "dest" && prev.get(t.id) !== "dwelling") {
          arrivals.set(t.id, (arrivals.get(t.id) ?? 0) + 1);
        }
        prev.set(t.id, t.status);
      }
      if (tC.laneId != null && tC.status !== "holding") cEntered = true;
      // One train per lane, at every tick: the lane IS the station's capacity.
      for (const lane of stationLanes(P)) {
        const holders = [tA, tB, tC].filter(
          (t) => t.laneId === lane.id && t.target === "dest" && t.status !== "stored",
        );
        expect(holders.length, `lane ${lane.id} double-booked`).toBeLessThanOrEqual(1);
      }
    }
    expect(cEntered, "the queued train eventually books a lane and runs in").toBe(true);
    for (const t of [tA, tB, tC]) {
      expect(arrivals.get(t.id), `train ${t.id} stopped arriving`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("RAIL-6 the wire carries the lanes (saves, MP, snapshots)", () => {
  it("round-trips lane count, geometry and assignments", () => {
    const w = twoLineWorld();
    tickTrains(w.state, 500);
    const wire = railToWire(w.state, { layers: true })!;
    expect(wire).toBeTruthy();
    const fresh = createRailState();
    expect(applyRailWire(fresh, wire)).toBe(true);

    const P2 = structureById(fresh, w.P.id)!;
    expect(stationLanes(P2).map((l) => ({ id: l.id, tx: l.tx, ty: l.ty, view: l.view, lineId: l.lineId })))
      .toEqual(stationLanes(w.P).map((l) => ({ id: l.id, tx: l.tx, ty: l.ty, view: l.view, lineId: l.lineId })));
    // The lines' lane assignments and the trains' bookings ride along.
    expect(fresh.lines.map((l) => [l.sourceLane ?? null, l.destLane ?? null]))
      .toEqual(w.state.lines.map((l) => [l.sourceLane ?? null, l.destLane ?? null]));
    expect(fresh.trains.map((t) => t.laneId ?? null)).toEqual(w.state.trains.map((t) => t.laneId ?? null));
    // The lane track bytes rode the layers.
    for (const l of stationLanes(P2)) {
      for (const [x, y] of laneTrackTiles(l)) expect(hasRail(fresh.rail, x, y)).toBe(true);
    }
  });

  it("an OLD save (no lanes on the wire) loads as a 1-lane station", () => {
    const w = twoLineWorld();
    const wire = railToWire(w.state)!;
    // Strip every RAIL-6 field, exactly as a pre-#575 snapshot has none.
    for (const s of wire.structures) delete s.lanes;
    wire.lines = wire.lines.map((l) => ({ ...l, sourceLane: undefined, destLane: undefined }));
    wire.trains = wire.trains.map((t) => ({ ...t, laneId: undefined, holdStation: undefined }));
    const fresh = createRailState();
    expect(applyRailWire(fresh, wire)).toBe(true);

    const P2 = structureById(fresh, w.P.id)!;
    const lanes = stationLanes(P2);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ tx: P2.tx, ty: P2.ty, view: P2.view, lineId: null });
    expect(laneTrackTiles(lanes[0])).toEqual([[40, 21], [41, 21], [42, 21], [43, 21]]);
    for (const t of fresh.trains) {
      expect(t.laneId ?? null).toBeNull();
      expect(t.holdStation ?? null).toBeNull();
    }
    // And the old world keeps running: a tick re-books lanes from scratch.
    tickTrains(fresh, 500);
    expect(fresh.trains.every((t) => t.status !== "blocked")).toBe(true);
  });
});
