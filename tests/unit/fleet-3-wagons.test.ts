// ════════════════════════════════════════════════════════════════════════
// FLEET-3 (#597) — trains carry the right wagons for their cargo, headless.
//
// The cargo→wagon table, the sprite lookup with its fallback chain, loaded vs
// empty by leg, the panel's words, N-wagon spacing round a bend, and a wagon
// type that changes only at a departure. Hand-built rail states: every
// assertion is about a rule, not about a particular map.
// ════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createRailState, buildRail, tickTrains, trainItems, carPlacements, carOffsets,
  consistOf, consistLabel, railPanelRows, lineCargoOf, refreshLineCargo, trainLoaded,
  wagonSpriteName, wagonCount, WAGON_OF_CARGO, WAGON_BASE_KIND, WAGON_NAME, OCT_NAMES,
  railToWire, applyRailWire,
  type RailState, type Train, type RailStructure,
} from "../../src/iso/rail";
import { createTrack } from "../../src/iso/track";
import { CARGOES, INDUSTRY_BY_KEY, type Cargo } from "../../src/iso/config";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

const flatGrid = (): Grid => ({
  w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
  industries: [], towns: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 7,
});
const row = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);

/** A fake atlas: it "has" exactly the names it is given. */
const atlasOf = (names: string[]) => ({ has: (n: string) => names.includes(n) });
const allCarSprites = OCT_NAMES.flatMap((o) => ["loco", "tender", "box", "tank", "flat"].map((k) => `car-${k}_${o}`));

/** A straight-then-diagonal track with one train (and its line) on it. */
function bendFixture(over: Partial<Train> = {}, cargo?: Cargo) {
  const grid = flatGrid();
  const track = createTrack();
  const state = createRailState();
  buildRail(grid, track, state, 1, [...row(10, 10, 14), [15, 11], [16, 12], [17, 13]]);
  const train: Train = {
    id: 4, ownerId: 1, lineId: 1, depotId: 0, status: "moving", target: "dest",
    route: [[10, 10], [11, 10], [12, 10], [13, 10], [14, 10], [15, 11], [16, 12], [17, 13]],
    dist: 0, planRevision: state.rail.revision, dwellMs: 0, dirBit: 0, resold: false,
    wagonCargo: cargo, ...over,
  };
  state.trains.push(train);
  state.lines.push({ id: 1, ownerId: 1, name: "L", source: 0, dest: 0, cargo });
  return { state, train };
}

const wagonNames = (state: RailState, atlas?: { has(n: string): boolean }): string[] =>
  trainItems(state, atlas).map((i) => i.sprite).filter((n) => n.startsWith("wagon_") || /^car-(box|tank|flat)_/.test(n));

describe("FLEET-3: each cargo has its wagon", () => {
  it("maps every cargo to its wagon type and dresses it on a shipped car body", () => {
    expect(WAGON_OF_CARGO).toEqual({
      grain: "grain-hopper", wood: "log-flatcar", ore: "ore-hopper",
      stone: "gondola", oil: "tank-car", gold: "armoured-boxcar",
    });
    expect(WAGON_BASE_KIND["tank-car"]).toBe("tank");
    expect(new Set(CARGOES.map((c) => WAGON_OF_CARGO[c])).size).toBe(CARGOES.length);
    for (const c of CARGOES) {
      const t = { wagonCargo: c } as Train;
      expect(consistOf(t)).toEqual(["loco", "tender", WAGON_BASE_KIND[WAGON_OF_CARGO[c]]]);
    }
  });

  it("a line's cargo is the cargo of the industry its source station is anchored to", () => {
    for (const c of CARGOES) {
      const key = Object.entries(INDUSTRY_BY_KEY).find(([, d]) => d.cargo === c)![0];
      const grid = { industries: [{ id: 0, type: key }] } as unknown as Grid;
      const state = createRailState();
      const src = { id: 10, kind: "platform", ownerId: 1, anchor: { kind: "industry", id: 0, tiles: [] } } as unknown as RailStructure;
      const dst = { id: 11, kind: "platform", ownerId: 1, anchor: { kind: "plant", id: 0, tiles: [] } } as unknown as RailStructure;
      state.structures.push(src, dst);
      state.lines.push({ id: 1, ownerId: 1, name: "L", source: 10, dest: 11 });
      expect(lineCargoOf(state, state.lines[0], grid)).toBe(c);
      expect(refreshLineCargo(state, grid)).toBe(true);
      expect(state.lines[0].cargo).toBe(c);
      expect(refreshLineCargo(state, grid)).toBe(false);
    }
  });

  it("a train on an oil line draws tank cars; the sprite falls back when the art is missing", () => {
    const { state } = bendFixture({ dist: 6 }, "oil");
    const h = OCT_NAMES[carPlacements(state, state.trains[0]).at(-1)!.oct];
    // No cargo art in the atlas: the shipped tank car.
    expect(wagonNames(state, atlasOf(allCarSprites))).toEqual([`car-tank_${h}`]);
    // Its own art present: the oil wagon (oil has no loaded look, so the empty art serves).
    const own = atlasOf([...allCarSprites, `wagon_oil_${h}`]);
    expect(wagonNames(state, own)).toEqual([`wagon_oil_${h}`]);
    // With no atlas at all the best name is returned (tools, tests).
    expect(wagonNames(state)).toEqual([`wagon_oil_${h}_loaded`]);
    expect(wagonSpriteName("tank", "oil", "ne", false, atlasOf([]))).toBe("car-tank_ne");
    expect(wagonSpriteName("box", undefined, "ne", true)).toBe("car-box_ne");
  });
});

describe("FLEET-3: loaded on the way to the plant, empty on the way back", () => {
  it("picks the loaded sprite on the leg to the plant and the empty one on return", () => {
    const { state, train } = bendFixture({ dist: 6 }, "grain");
    const h = OCT_NAMES[carPlacements(state, train).at(-1)!.oct];
    const atlas = atlasOf([...allCarSprites, `wagon_grain_${h}`, `wagon_grain_${h}_loaded`]);

    train.target = "dest";                                   // heading for the plant
    expect(trainLoaded(train)).toBe(true);
    expect(wagonNames(state, atlas)).toEqual([`wagon_grain_${h}_loaded`]);

    train.target = "source";                                 // coming back
    expect(trainLoaded(train)).toBe(false);
    expect(wagonNames(state, atlas)).toEqual([`wagon_grain_${h}`]);

    // Only the wagons change; the loco is still the plain loco.
    expect(trainItems(state, atlas).some((i) => i.sprite.startsWith("car-loco_"))).toBe(true);
  });

  it("a loaded look that is not authored falls back to the empty art, then the plain car", () => {
    const { state, train } = bendFixture({ dist: 6, target: "dest" }, "wood");
    const h = OCT_NAMES[carPlacements(state, train).at(-1)!.oct];
    expect(wagonNames(state, atlasOf([...allCarSprites, `wagon_wood_${h}`]))).toEqual([`wagon_wood_${h}`]);
    expect(wagonNames(state, atlasOf(allCarSprites))).toEqual([`car-flat_${h}`]);
  });

  it("a stored train is empty", () => {
    expect(trainLoaded({ status: "stored", target: "dest" })).toBe(false);
  });
});

describe("FLEET-3: the wagon type changes at a departure", () => {
  it("a changed line cargo shows on the NEXT departure from the source, not mid-run", () => {
    const { state, train } = bendFixture({ dist: 3 }, "grain");
    state.lines[0].cargo = "oil";
    tickTrains(state, 10);                                   // mid-run: no change
    expect(train.wagonCargo).toBe("grain");
    // Dwelling at the source, the dwell ends: it leaves loaded with the new cargo.
    train.status = "dwelling"; train.target = "source"; train.dwellMs = 5;
    tickTrains(state, 100);
    expect(train.wagonCargo).toBe("oil");
  });

  it("an old train with no wagon type takes its line's at the next tick", () => {
    const { state, train } = bendFixture({ dist: 3 });
    state.lines[0].cargo = "gold";
    tickTrains(state, 10);
    expect(train.wagonCargo).toBe("gold");
    expect(consistOf(train)[2]).toBe("box");
  });
});

describe("FLEET-3: the train panel names the wagons", () => {
  it("prints 'Loco + 1 tank car' and pluralises for N", () => {
    expect(consistLabel({ wagonCargo: "oil" })).toBe("Loco + 1 tank car");
    expect(consistLabel({ wagonCargo: "oil", wagons: 2 })).toBe("Loco + 2 tank cars");
    for (const c of CARGOES) {
      expect(consistLabel({ wagonCargo: c })).toBe(`Loco + 1 ${WAGON_NAME[WAGON_OF_CARGO[c]][0]}`);
    }
    expect(consistLabel({})).toBe("Loco + 3 wagons");          // no cargo yet: the legacy mixed consist
    expect(consistLabel({ wagons: 1 })).toBe("Loco + 1 wagon");
  });

  it("the Railway panel's train row carries it", () => {
    const { state } = bendFixture({}, "oil");
    const r = railPanelRows(state, 1).find((x) => x.kind === "train")!;
    expect(r.detail).toContain("Loco + 1 tank car");
  });

  it("wagonCount defaults to one and never goes below it", () => {
    expect(wagonCount({})).toBe(1);
    expect(wagonCount({ wagons: 0 })).toBe(1);
    expect(wagonCount({ wagons: 3 })).toBe(3);
  });
});

describe("FLEET-3: N wagons keep their spacing round a bend", () => {
  it("with 3 wagons, consecutive cars stay one coupling apart along the track", () => {
    const { state, train } = bendFixture({ wagons: 3 }, "grain");
    expect(consistOf(train)).toEqual(["loco", "tender", "box", "box", "box"]);
    const offs = carOffsets(consistOf(train));
    let bent = 0;
    for (let i = 0; i < 400 && train.dist < 8.1; i++) {
      tickTrains(state, 25);
      const cars = carPlacements(state, train);
      expect(cars).toHaveLength(5);
      for (let k = 1; k < cars.length; k++) {
        const gap = Math.hypot(cars[k].fx - cars[k - 1].fx, cars[k].fy - cars[k - 1].fy);
        const arc = offs[k] - offs[k - 1];
        if (train.dist > 3) {
          expect(gap).toBeLessThanOrEqual(arc + 1e-6);      // a chord never beats the arc
          expect(gap).toBeGreaterThan(arc * 0.8);            // no overlap, no cutting across
        }
      }
      if (train.dist > 5 && OCT_NAMES[cars[0].oct] !== OCT_NAMES[cars[cars.length - 1].oct]) bent++;
    }
    expect(bent).toBeGreaterThan(0);                         // the run really did span the bend
    expect(wagonNames(state)).toHaveLength(3);               // three grain wagons drawn
  });
});

describe("FLEET-3: the wire carries the new fields", () => {
  it("round-trips them, and an old wire (no wagons, no cargo) still reads", () => {
    const { state } = bendFixture({ wagons: 2 }, "ore");
    const wire = railToWire(state)!;
    const guest = createRailState();
    applyRailWire(guest, wire);
    expect(guest.trains[0].wagonCargo).toBe("ore");
    expect(guest.trains[0].wagons).toBe(2);
    expect(guest.lines[0].cargo).toBe("ore");
    const old = JSON.parse(JSON.stringify(wire));
    delete old.trains[0].wagonCargo; delete old.trains[0].wagons; delete old.lines[0].cargo;
    applyRailWire(guest, old);
    expect(guest.trains[0].wagonCargo).toBeUndefined();
    expect(wagonCount(guest.trains[0])).toBe(1);
  });
});
