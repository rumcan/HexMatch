import { describe, it, expect } from "vitest";
import { generateGrid } from "../../src/iso/grid";
import { IsoWorld } from "../../src/iso/world";
import { TERRAIN, TRANSPORT } from "../../src/iso/config";

// A controlled world on all-grass terrain with a known industry we can target.
function harness() {
  const m = generateGrid(555);
  m.terrain.fill(TERRAIN.GRASS);
  // clear industries then add one farm at a known spot
  m.industries.length = 0;
  m.occup.fill(-1);
  const farm = { id: 0, type: "farm" as const, tx: 20, ty: 20, w: 2, h: 2, output: 1.0, banditUntil: 0 };
  m.industries.push(farm);
  for (let y = 20; y < 22; y++) for (let x = 20; x < 22; x++) m.occup[y * m.w + x] = 0;
  return new IsoWorld(m, 1);
}

describe("E6 factory + harvester placement", () => {
  it("places a factory on grass", () => {
    const w = harness();
    expect(w.placeFactory(0, 10, 10)).toBe(true);
    expect(w.factories.get(0)).toEqual({ tx: 10, ty: 10 });
  });

  it("rejects a harvester whose catchment contains no industry", () => {
    const w = harness();
    w.placeFactory(0, 10, 10);
    // far corner (30,30) is empty grass with no industry in its 4×4 catchment
    expect(w.placeHarvester(0, 30, 30)).toBeNull();
  });

  it("allows placing a harvester before the road (setup order, E8)", () => {
    const w = harness();
    w.placeFactory(0, 30, 30);
    // harvester over the farm catchment with NO road yet → allowed, unconnected
    const h = w.placeHarvester(0, 19, 22);
    expect(h).not.toBeNull();
    expect(w.playerResources(0, 1000).grain ?? 0).toBe(0);
  });

  it("a harvester adjacent to the farm catchment works once roaded", () => {
    const w = harness();
    w.placeFactory(0, 14, 22);
    // build a road strip from near the factory to near the farm
    const path = w.net.dragPath("road", 15, 22, 19, 22, false);
    w.net.commitDrag("road", path);
    // harvester at (19,21) sits just north of the road (19,22) and its 4×4
    // catchment covers the farm (20..21, 20..21)
    const h = w.placeHarvester(0, 19, 21);
    expect(h).not.toBeNull();
  });
});

describe("E6 connection flood fill", () => {
  it("connected road path yields resources; breaking one tile stops it", () => {
    const w = harness();
    w.placeFactory(0, 14, 23);                       // road (15,23) sits just SE of it
    for (let x = 15; x <= 19; x++) w.net.build("road", x, 23);
    // harvester at (19,22): adjacent to road (19,23) to its N, catchment covers farm
    const h = w.placeHarvester(0, 19, 22);
    expect(h).not.toBeNull();
    // connected over road → grain flows
    const res0 = w.playerResources(0, 1000);
    expect(res0.grain).toBeGreaterThan(0);
    expect(w.vp[0]).toBe(TRANSPORT.road.vp);

    // demolish the middle road tile: disconnected → no resources, VP revoked
    w.net.demolish("road", 17, 23);
    w.checkConnections();
    const res1 = w.playerResources(0, 1000);
    expect(res1.grain ?? 0).toBe(0);
    expect(w.vp[0]).toBe(0);
  });

  it("a rail connection awards 3 VP and applies the 1.6× multiplier", () => {
    const w = harness();
    w.placeFactory(0, 14, 23);
    for (let x = 15; x <= 19; x++) w.net.build("rail", x, 23);
    const h = w.placeHarvester(0, 19, 22);
    expect(h).not.toBeNull();
    const res = w.playerResources(0, 1000);
    // farm output 1.0 × rail 1.6
    expect(res.grain).toBeCloseTo(1.6, 5);
    expect(w.vp[0]).toBe(TRANSPORT.rail.vp);
  });

  it("a blockaded industry produces nothing", () => {
    const w = harness();
    w.placeFactory(0, 14, 23);
    for (let x = 15; x <= 19; x++) w.net.build("road", x, 23);
    w.placeHarvester(0, 19, 22);
    w.map.industries[0].banditUntil = 9999999;
    const res = w.playerResources(0, 1000);
    expect(res.grain ?? 0).toBe(0);
  });
});

describe("E6 connection only uses both-facing-bit links", () => {
  it("a gap in the path means no connection (flood respects facing bits)", () => {
    const w = harness();
    w.placeFactory(0, 14, 23);
    w.net.build("road", 15, 23);
    w.net.build("road", 16, 23);
    w.net.demolish("road", 16, 23);   // gap
    for (let x = 17; x <= 19; x++) w.net.build("road", x, 23);
    const h = w.placeHarvester(0, 19, 22);
    expect(h).not.toBeNull();
    w.checkConnections();
    expect(w.vp[0]).toBe(0);
  });
});
