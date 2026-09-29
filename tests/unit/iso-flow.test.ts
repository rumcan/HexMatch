import { describe, expect, it } from "vitest";
import {
  addIncident, createFlowState, fixedAspect, flowAspect, rebuildFlow, segmentFactor,
  setSource, signalStop, stepFlow, tileFactor, type FlowState,
} from "../../src/iso/flow/flow-core";
import { LIGHT_CYCLE_MS, lightAspect } from "../../src/iso/ambience";

/** A plus-shaped crossroads at (5,5) on a 11×11 map. */
function crossroads(mode: "actuated" | "fixed" = "actuated"): FlowState {
  const W = 11;
  const graph = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    graph.set(a, [...(graph.get(a) ?? []), b]);
    graph.set(b, [...(graph.get(b) ?? []), a]);
  };
  for (let x = 0; x < 10; x++) link(5 * W + x, 5 * W + x + 1);
  for (let y = 0; y < 10; y++) link(y * W + 5, (y + 1) * W + 5);
  const s = createFlowState({ signalMode: mode, incidents: false, backgroundScale: 0 }, 42);
  rebuildFlow(s, {
    mapW: W, mapH: W, seed: 42, graph,
    junctions: new Map([[5 * W + 5, 7]]),
    towns: [{ id: 7, tx: 5, ty: 5, weight: 1 }],
    capacityOf: () => 6,
  });
  return s;
}

describe("FLOW-1 core", () => {
  it("fixed mode is AMB-3's lightAspect bit for bit", () => {
    const s = crossroads("fixed");
    for (let t = 0; t < LIGHT_CYCLE_MS * 2; t += 137) {
      for (const axis of [0, 1] as const) {
        expect(fixedAspect(s.cfg, 99, 3, axis, t)).toBe(lightAspect(99, 3, axis, t));
      }
    }
  });

  it("actuated lights are never green on both axes and do switch", () => {
    const s = crossroads();
    let sawSwitch = false;
    const first = flowAspect(s, 7, 0);
    for (let n = 0; n < 400; n++) {
      // demand on axis 1 only
      setSource(s, "cars", [{ i: 4 * 11 + 5, pcu: 6 }]);
      stepFlow(s, 100);
      const a = flowAspect(s, 7, 0), b = flowAspect(s, 7, 1);
      expect(a === "green" && b === "green").toBe(false);
      if (a !== first) sawSwitch = true;
    }
    expect(sawSwitch).toBe(true);
  });

  it("congestion lowers the speed factor, bounded by minSpeedFactor", () => {
    const s = crossroads();
    const i = 5 * 11 + 2;
    expect(tileFactor(s, i)).toBe(1);
    for (let n = 0; n < 60; n++) { setSource(s, "cars", [{ i, pcu: 30 }]); stepFlow(s, 100); }
    const f = tileFactor(s, i);
    expect(f).toBeLessThan(0.6);
    expect(f).toBeGreaterThanOrEqual(s.cfg.minSpeedFactor);
    expect(segmentFactor(s, i, i + 1)).toBeLessThan(1);
  });

  it("an incident cuts capacity", () => {
    const s = crossroads();
    const i = 5 * 11 + 8;
    for (let n = 0; n < 40; n++) { setSource(s, "cars", [{ i, pcu: 5 }]); stepFlow(s, 100); }
    const before = tileFactor(s, i);
    addIncident(s, i, 10000);
    expect(tileFactor(s, i)).toBeLessThan(before);
  });

  it("stop line binds on red, releases once past the line", () => {
    const s = crossroads("fixed");
    const route: [number, number][] = [[3, 5], [4, 5], [5, 5], [6, 5]];
    // find a time where axis 0 is red
    let t = 0;
    while (fixedAspect(s.cfg, 42, 7, 0, t) !== "red") t += 50;
    const stop = signalStop(s, route, 1, 0.1, false, t);
    expect(stop).not.toBeNull();
    expect(signalStop(s, route, 1, 0.9, false, t)).toBeNull();   // past the line
    expect(signalStop(s, route, 2, 0.1, false, t)).toBeNull();   // leaving the junction
  });
});
