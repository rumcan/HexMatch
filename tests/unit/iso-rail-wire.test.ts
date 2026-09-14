// ══════════════════════════════════════════════════════════════════════════
// RAIL-04 (#178) — the railway on the wire.
//
// The epic's multiplayer rule is the same one the road tiers keep: the host is
// authoritative for the whole world, and a guest renders what it is told. So
// the railway has to travel — its own layer, its platforms and depots, its
// lines and its trains — on the join snapshot AND on every steady-state delta,
// and the guest applies it without ever inventing rail state of its own.
//
// These tests pin the wire itself: the shape, the tolerant reader, the
// "layers are omitted when the revision did not move" optimisation, the
// round trip through `buildSnapshot`/`applySnapshot`, and the delta's
// `rail` field.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createRailState, buildRail, placePlatform, placeDepot, assignLine, railToWire,
  applyRailWire, clearRail, railLayerPatch, copyRailLayer, DWELL_MS, type RailState,
} from "../../src/iso/rail";
import {
  buildSnapshot, applySnapshot, validateSnapshot, base64ToBytes, bytesToBase64,
  EXPECTED_TRACK_BYTES, type SnapshotSource,
} from "../../src/iso/snapshot";
import { buildPublish } from "../../src/net/delta";
import { createTrack, DirtyTiles } from "../../src/iso/track";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

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
 * One complete two-stop line, the same geometry `iso-rail.test.ts` uses: source
 * platform (lane row y=3), dest platform, the rail between them, and a depot
 * hanging off the row by a stub. `assignLine` puts a train in it.
 */
function running() {
  const grid = flatGrid();
  const track = createTrack();
  const state = createRailState();
  const source = placePlatform(state, "you", 1, 7, 3, "se", { kind: "industry", id: 0, tiles: [] });
  const dest = placePlatform(state, "you", 1, 17, 3, "se", { kind: "plant", id: 0, tiles: [] });
  buildRail(grid, track, state, 1, row(3, 10, 16));
  buildRail(grid, track, state, 1, [[13, 4]]);
  const depot = placeDepot(state, "you", 1, 13, 5, "ne");
  const plan = assignLine(state, 1, source.id, dest.id);
  return { grid, track, state, source, dest, depot, plan };
}

const source = (state: RailState): SnapshotSource => ({
  seed: 20260914,
  track: createTrack(),
  harvesters: [],
  factories: [],
  setupPhase: false,
  won: false,
  players: [{ id: "p1", vp: 0, res: { stone: 4 } }],
  rail: railToWire(state),
});

describe("RAIL-04 the wire shape", () => {
  it("sends nothing for a world with no railway", () => {
    // A match that never laid rail must not pay a byte for the feature.
    expect(railToWire(createRailState())).toBeUndefined();
    const snap = buildSnapshot(source(createRailState()));
    expect(snap.rail).toBeUndefined();
    expect(validateSnapshot(snap)).toBeNull();
  });

  it("carries the layer, the platforms, the line and the train", () => {
    const { state, plan } = running();
    expect(plan.ok).toBe(true);
    const wire = railToWire(state);
    expect(wire).toBeDefined();
    expect(base64ToBytes(wire!.tile!).length).toBe(EXPECTED_TRACK_BYTES);
    expect(base64ToBytes(wire!.owner!).length).toBe(EXPECTED_TRACK_BYTES);
    expect(wire!.revision).toBeGreaterThan(0);
    expect(wire!.structures).toHaveLength(3);        // source, dest, depot
    expect(wire!.structures.filter((s) => s.kind === "platform")).toHaveLength(2);
    expect(wire!.structures.find((s) => s.kind === "depot")!.view).toBe("ne");
    expect(wire!.lines).toHaveLength(1);
    expect(wire!.trains).toHaveLength(1);
    const train = wire!.trains[0];
    expect(train.lineId).toBe(wire!.lines[0].id);
    expect(train.depotId).toBe(state.trains[0].depotId);
    expect(train.route.length).toBeGreaterThan(1);
    expect(train.dwellMs).toBeLessThanOrEqual(DWELL_MS);
  });

  it("omits the two layers for a delta whose rail revision did not move", () => {
    // Structures, lines and trains are small and always ride (the guest's
    // panel and its trains need them every tick); the base64 layers are ~2 KB
    // each and a guest that already has them must not be sent them again.
    const { state } = running();
    const light = railToWire(state, { layers: false })!;
    expect(light.tile).toBeUndefined();
    expect(light.owner).toBeUndefined();
    expect(light.structures).toHaveLength(3);
    expect(light.trains).toHaveLength(1);
    expect(light.revision).toBe(state.rail.revision);
  });

  it("deep-copies the tuples — a delta may not alias the host's state", () => {
    const { state } = running();
    const snap = buildSnapshot(source(state));
    const sent = snap.rail!.trains[0];
    const live = state.trains[0];
    expect(sent.route).not.toBe(live.route);
    sent.route[0][0] += 5;
    expect(live.route[0][0]).not.toBe(sent.route[0][0] + 0);
    // …and the layer bytes are copied, not shared buffers.
    expect(snap.rail!.structures[0]).not.toBe(state.structures[0]);
  });
});

describe("RAIL-04 the guest applies what it is told", () => {
  it("round-trips a running railway through buildSnapshot/applySnapshot", () => {
    const { state } = running();
    const snap = buildSnapshot(source(state));
    // Through JSON, the way it actually travels.
    const applied = applySnapshot(JSON.parse(JSON.stringify(snap)));
    expect(applied.rail).toBeDefined();

    const guest = createRailState();
    expect(applyRailWire(guest, applied.rail)).toBe(true);
    expect(guest.rail.tile).toEqual(state.rail.tile);
    expect(guest.rail.owner).toEqual(state.rail.owner);
    expect(guest.rail.revision).toBeGreaterThanOrEqual(state.rail.revision);
    expect(guest.structures).toHaveLength(state.structures.length);
    expect(guest.lines).toHaveLength(1);
    expect(guest.trains).toHaveLength(1);
    expect(guest.trains[0].route).toEqual(state.trains[0].route);
    expect(guest.trains[0].status).toBe(state.trains[0].status);
    expect(guest.seq).toBe(state.seq);
  });

  it("keeps the guest's own bytes when a delta omits the layers", () => {
    const { state } = running();
    const guest = createRailState();
    applyRailWire(guest, railToWire(state, { layers: false }));
    expect(guest.rail.tile.every((b) => b === 0)).toBe(true);   // nothing claimed
    expect(guest.structures).toHaveLength(3);
    // …then the layers arrive (a build bumps the revision) and are adopted.
    const full = railToWire(state);
    guest.trains.length = 0;
    applyRailWire(guest, full);
    expect(guest.rail.tile).toEqual(state.rail.tile);
    expect(guest.trains).toHaveLength(1);
  });

  it("tolerates a malformed wire instead of throwing mid-apply", () => {
    const guest = createRailState();
    const ok = applyRailWire(guest, {
      revision: 4,
      seq: 3,
      tile: bytesToBase64(new Uint8Array(4)),        // wrong size → skipped
      owner: bytesToBase64(new Uint8Array(4)),
      structures: [{ tx: "nope" } as never, ...railToWire(running().state)!.structures],
      lines: [{ id: 1, ownerId: 1, name: "x", source: 2, dest: 3 }],
      trains: [{ id: 9, route: [[1, 1]], dist: 0 } as never],
    });
    expect(ok).toBe(true);
    expect(guest.rail.tile.every((b) => b === 0)).toBe(true);
    expect(guest.structures).toHaveLength(3);      // the bad record was skipped
    expect(guest.lines).toHaveLength(1);
    expect(guest.trains).toHaveLength(1);
    expect(guest.trains[0].status).toBe("stored"); // unknown status → the safe one
    expect(guest.trains[0].target).toBe("depot");
    expect(applyRailWire(guest, null)).toBe(false);
  });

  it("clears a stale railway when a full state says there is none", () => {
    const { state } = running();
    const guest = createRailState();
    applyRailWire(guest, railToWire(state));
    expect(guest.structures.length).toBeGreaterThan(0);
    expect(clearRail(guest)).toBe(true);
    expect(guest.rail.tile.every((b) => b === 0)).toBe(true);
    expect(guest.structures).toHaveLength(0);
    expect(guest.lines).toHaveLength(0);
    expect(guest.trains).toHaveLength(0);
    expect(clearRail(guest)).toBe(false);          // already empty: nothing to do
  });
});

describe("RAIL-04 validation and the delta field", () => {
  it("refuses a malformed rail record rather than half-applying it", () => {
    const snap = buildSnapshot(source(running().state));
    const broken = { ...snap, rail: { ...snap.rail!, trains: "nope" as never } };
    expect(validateSnapshot(broken)?.code).toBe("malformed");
    const wrongSize = { ...snap, rail: { ...snap.rail!, tile: bytesToBase64(new Uint8Array(8)) } };
    expect(validateSnapshot(wrongSize)?.code).toBe("malformed");
    // …and a v12 guest (one version behind) is refused by the version gate.
    expect(validateSnapshot({ ...snap, version: 12 })?.code).toBe("version");
  });

  it("sends a SPARSE patch, not two 27 KB layers, on a build delta", () => {
    // The size fact the design turns on: one base64 layer is 27 KB — more than
    // an entire 16 KB frame — so a delta must never carry it. A built line is a
    // few dozen tiles, so the patch is a few dozen records.
    const { state } = running();
    const wire = railToWire(state, { layers: false })!;
    wire.tiles = railLayerPatch(state, new Uint8Array(state.rail.tile.length), new Uint8Array(state.rail.owner.length));
    expect(wire.tiles.length).toBeGreaterThan(0);
    expect(wire.tiles.length).toBeLessThan(200);
    expect(JSON.stringify(wire).length).toBeLessThan(8 * 1024);
  });

  it("keeps rail off a delta when there is no railway, and on it when there is", () => {
    const track = createTrack();
    const plain = buildPublish(track, new DirtyTiles(), {
      t: 1, seq: 1, harvesters: [], factories: [], players: [],
      setupPhase: false, won: false,
      rivalSabotage: { frozen: [], girders: [], smogIn: 0 },
    });
    expect(plain.kind).toBe("delta");
    if (plain.kind !== "delta") throw new Error("unreachable");
    expect("rail" in plain.msg).toBe(false);

    const { state } = running();
    // The delta's shape: patch, not layers. (A whole layer pair would blow the
    // frame cap and fall back to a full snapshot — the test above proves the
    // patch is what keeps a build a delta.)
    const wire = railToWire(state, { layers: false })!;
    wire.tiles = railLayerPatch(state, new Uint8Array(state.rail.tile.length), new Uint8Array(state.rail.owner.length));
    const wired = buildPublish(track, new DirtyTiles(), {
      t: 2, seq: 2, harvesters: [], factories: [], players: [],
      setupPhase: false, won: false,
      rivalSabotage: { frozen: [], girders: [], smogIn: 0 },
      rail: wire,
    });
    expect(wired.kind).toBe("delta");
    if (wired.kind !== "delta") throw new Error("unreachable");
    expect(wired.msg.rail).toBeDefined();
    expect(wired.msg.rail!.trains).toHaveLength(1);
    expect(wired.msg.rail!.tiles!.length).toBeGreaterThan(0);
    // …and the guest that applies it ends up with the host's exact layer.
    const guest = createRailState();
    applyRailWire(guest, wired.msg.rail);
    expect(guest.rail.tile).toEqual(state.rail.tile);
    expect(guest.rail.owner).toEqual(state.rail.owner);
  });

  it("a JOIN sends the layers whole — the guest has nothing to patch", () => {
    const { state } = running();
    const wire = railToWire(state, { layers: true })!;
    expect(wire.tile).toBeDefined();
    expect(applyRailWire(createRailState(), wire)).toBe(true);
  });
});
