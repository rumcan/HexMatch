// TRAFFIC-INCOME: lorries slowed by traffic slow their depot's income.
import { beforeEach, describe, expect, it, vi } from "vitest";

let flowSpeed: number | null = 1;   // null = traffic off (no hook)
vi.mock("../../src/iso/flow", () => ({
  flowTruckHook: () => (flowSpeed === null ? null : {
    speed: () => flowSpeed,
    stopT: () => null,
    hold: () => undefined,
  }),
}));

import { tickTrucks, type Truck } from "../../src/iso/vehicles";
import {
  TRAFFIC_FACTOR_MIN, clearTrafficSamples, trafficFactorOf, trafficScaledHaul,
} from "../../src/iso/traffic-income";

const mkTruck = (depotId: number): Truck => ({
  ownerId: 1, depotId, factory: [30, 0],
  route: Array.from({ length: 31 }, (_, i) => [i, 0] as [number, number]),
  leg: 0, t: 0, reverse: false, deliveries: 0,
} as unknown as Truck);

function drive(depotId: number, seconds: number): void {
  const state = { trucks: [mkTruck(depotId)] } as unknown as Parameters<typeof tickTrucks>[0];
  for (let i = 0; i < seconds * 10; i++) tickTrucks(state, 100);
}

describe("traffic factor", () => {
  beforeEach(() => { flowSpeed = 1; clearTrafficSamples(); });

  it("(a) lorries held at 50% speed give ~0.5 and haulFactor scales with it", () => {
    flowSpeed = 0.5;
    drive(1, 300);
    expect(trafficFactorOf(1)).toBeGreaterThan(0.48);
    expect(trafficFactorOf(1)).toBeLessThan(0.53);
    expect(trafficScaledHaul(2, 1)).toBeCloseTo(2 * trafficFactorOf(1), 6);
  });

  it("(b) free flow is 1.0 (and a depot with no data too)", () => {
    flowSpeed = 1;
    drive(2, 60);
    expect(trafficFactorOf(2)).toBe(1);
    expect(trafficFactorOf(99)).toBe(1);
  });

  it("(c) never below 0.4", () => {
    flowSpeed = 0.05;
    drive(3, 600);
    expect(trafficFactorOf(3)).toBe(TRAFFIC_FACTOR_MIN);
  });

  it("(d) traffic disabled: back to 1.0", () => {
    flowSpeed = 0.5;
    drive(4, 200);
    expect(trafficFactorOf(4)).toBeLessThan(0.7);
    flowSpeed = null;
    drive(4, 1);
    expect(trafficFactorOf(4)).toBe(1);
  });

  it("private roads far from towns are clear: background demand falls off with distance", async () => {
    const { createFlowState, rebuildFlow } = await import("../../src/iso/flow/flow-core");
    const W = 100;
    const graph = new Map<number, number[]>();
    for (let x = 0; x < 80; x++) graph.set(x, [x > 0 ? x - 1 : x + 1, x < 79 ? x + 1 : x - 1]);
    const s = createFlowState();
    rebuildFlow(s, {
      mapW: W, mapH: W, seed: 1, graph, junctions: new Map(),
      towns: [{ id: 0, tx: 5, ty: 0, weight: 1 }], capacityOf: () => 4,
    });
    expect(s.bgBase[5]).toBeGreaterThan(0.5);   // in town: busy
    expect(s.bgBase[70]).toBe(0);               // private road far away: no background
  });
});
