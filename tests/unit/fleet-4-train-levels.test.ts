// FLEET-4 (#598) — train levels 1-3: speed, wagons, price, wire, rival.
import { describe, it, expect } from "vitest";
import {
  createRailState, buildRail, tickTrains, consistOf, wagonCount, railToWire, applyRailWire,
  setTrainLevel, trainLevel, trainSpeedMult, trainUpgradeBase, trainUpgradePrice, trainUpgradeCheck,
  trainLoadFactorOf, planRivalTrainUpgrade, TRAIN_LEVELS, railPanelRows,
  type Train,
} from "../../src/iso/rail";
import { createTrack } from "../../src/iso/track";
import { BUILD_COSTS_MONEY } from "../../src/iso/config";
import { perkPrice } from "../../src/iso/managers";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

const flatGrid = (): Grid => ({
  w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
  industries: [], towns: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 7,
});
const row = (y: number, x0: number, x1: number): [number, number][] =>
  Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y] as [number, number]);

function fixture(level?: number) {
  const grid = flatGrid();
  const state = createRailState();
  buildRail(grid, createTrack(), state, 1, row(10, 10, 30));
  const train: Train = {
    id: 4, ownerId: 1, lineId: 1, depotId: 0, status: "moving", target: "dest",
    route: row(10, 10, 30), dist: 0, planRevision: state.rail.revision, dwellMs: 0, dirBit: 0, resold: false,
    wagonCargo: "ore",
  };
  if (level) setTrainLevel(train, level);
  state.trains.push(train);
  state.lines.push({ id: 1, ownerId: 1, name: "L", source: 7, dest: 8, cargo: "ore" });
  return { grid, state, train };
}
/** ms until the train reaches the far stop (the leg the round trip repeats twice). */
function legMs(level?: number): number {
  const { grid, state, train } = fixture(level);
  let t = 0;
  while (train.status === "moving" && t < 600000) { tickTrains(state, 10, grid); t += 10; }
  expect(train.status).toBe("dwelling");
  return t;
}

describe("FLEET-4: train levels", () => {
  it("(a) a level-3 train runs a trip in about 2/3 of level 1's time", () => {
    const l1 = legMs(), l2 = legMs(2), l3 = legMs(3);
    expect(l3 / l1).toBeGreaterThan(0.64);
    expect(l3 / l1).toBeLessThan(0.70);
    expect(l2).toBeLessThan(l1);
    expect(l3).toBeLessThan(l2);
    expect(trainSpeedMult({ level: 3 })).toBe(1.5);
  });

  it("(b) wagons follow the level, and the delivered amount scales with them", () => {
    const { state, train } = fixture();
    expect(trainLevel(train)).toBe(1);
    expect(wagonCount(train)).toBe(1);
    expect(trainLoadFactorOf(state, 7)).toBe(1);
    for (const lv of [2, 3]) {
      setTrainLevel(train, lv);
      expect(wagonCount(train)).toBe(TRAIN_LEVELS.wagons[lv - 1]);
      expect(consistOf(train).length).toBe(2 + lv);
      // wagons × speed (lead, 2026-09-29: speed pays too, as with trucks)
      expect(trainLoadFactorOf(state, 7)).toBeCloseTo(TRAIN_LEVELS.wagons[lv - 1] * TRAIN_LEVELS.speed[lv - 1], 6);
    }
    expect(trainLoadFactorOf(state, 99)).toBe(1);
  });

  it("(c) the price ladder and the Anne perk", () => {
    const base = BUILD_COSTS_MONEY.trainUpgrade;
    expect(trainUpgradeBase(1)).toBe(Math.round(base));
    expect(trainUpgradeBase(2)).toBe(Math.round(base * 1.6));
    expect(trainUpgradeBase(3)).toBe(0);
    expect(trainUpgradePrice(1, null)).toBe(trainUpgradeBase(1));
    expect(trainUpgradePrice(1, "anne")).toBe(perkPrice(trainUpgradeBase(1), "anne", "rail"));
    expect(trainUpgradePrice(1, "anne")).toBeLessThan(trainUpgradePrice(1, null));
    const t = { ownerId: 1, level: 1 };
    expect(trainUpgradeCheck(t, 1, 0, null).ok).toBe(false);
    expect(trainUpgradeCheck(t, 2, 9999, null).ok).toBe(false);
    expect(trainUpgradeCheck(t, 1, 9999, null).ok).toBe(true);
    expect(trainUpgradeCheck({ ownerId: 1, level: 3 }, 1, 9999, null).why).toMatch(/upgraded/);
  });

  it("(d) the wire round-trips the level; absent reads as 1; the panel row carries it", () => {
    const { state, train } = fixture(3);
    const wire = railToWire(state)!;
    const guest = createRailState();
    applyRailWire(guest, wire);
    expect(guest.trains[0].level).toBe(3);
    expect(guest.trains[0].wagons).toBe(3);
    const old = JSON.parse(JSON.stringify(wire));
    delete old.trains[0].level; delete old.trains[0].wagons;
    applyRailWire(guest, old);
    expect(trainLevel(guest.trains[0])).toBe(1);
    old.trains[0].level = 99;
    applyRailWire(guest, old);
    expect(trainLevel(guest.trains[0])).toBe(3);
    expect(railPanelRows(state, 1).find((r) => r.kind === "train")?.level).toBe(trainLevel(train));
  });

  it("(e) the rival upgrades its main train when rich, and not when poor", () => {
    const trains = [
      { id: 1, ownerId: 1, level: 1 }, { id: 2, ownerId: 2, level: 2 }, { id: 3, ownerId: 2 },
    ];
    const price = trainUpgradePrice(1, null);
    const reserve = BUILD_COSTS_MONEY.depot;
    expect(planRivalTrainUpgrade(trains, 2, price + reserve, null, reserve)).toBe(3);
    expect(planRivalTrainUpgrade(trains, 2, price + reserve - 1, null, reserve)).toBeNull();
    expect(planRivalTrainUpgrade([{ id: 5, ownerId: 2, level: 3 }], 2, 1e6, null, reserve)).toBeNull();
  });
});
