import { describe, it, expect } from "vitest";
import { IsoWorld } from "../../src/iso/world";
import { generateGrid } from "../../src/iso/grid";
import { TERRAIN } from "../../src/iso/config";
import {
  buildSnapshot, applySnapshot, encodeBits, decodeBits, SNAPSHOT_VERSION,
} from "../../src/iso/snapshot";

function world() {
  const map = generateGrid(7);
  map.terrain.fill(TERRAIN.GRASS);
  map.industries.length = 0;
  map.occup.fill(-1);
  const farm = { id: 0, type: "farm" as const, tx: 20, ty: 20, w: 2, h: 2, output: 1.0, banditUntil: 0 };
  map.industries.push(farm);
  for (let y = 20; y < 22; y++) for (let x = 20; x < 22; x++) map.occup[y * map.w + x] = 0;
  return new IsoWorld(map, 2);
}

describe("E10 snapshot", () => {
  it("encodes/decodes the transport layers as base64", () => {
    const w = world();
    for (let x = 5; x < 12; x++) w.net.build("road", x, 10);
    const s = encodeBits(w.net.road);
    expect(typeof s).toBe("string");
    expect(s.length).toBeLessThan(w.net.road.length * 1.5);
    const back = decodeBits(s, w.net.road.length);
    expect(Array.from(back)).toEqual(Array.from(w.net.road));
  });

  it("round-trips road, rail, factories and harvesters", () => {
    const a = world();
    a.placeFactory(0, 14, 22);
    for (let x = 15; x <= 19; x++) a.net.build("road", x, 22);
    a.placeHarvester(0, 19, 21);
    a.placeFactory(1, 40, 40);
    a.checkConnections();
    const vpBefore = a.vp[0];

    const snap = buildSnapshot(a, 7);
    const b = world();
    const err = applySnapshot(b, snap, 7);
    expect(err).toBeNull();
    expect(Array.from(b.net.road)).toEqual(Array.from(a.net.road));
    expect(b.factories.get(0)).toEqual({ tx: 14, ty: 22 });
    expect(b.factories.get(1)).toEqual({ tx: 40, ty: 40 });
    expect(b.harvesters.length).toBe(1);
    b.checkConnections();
    expect(b.vp[0]).toBe(vpBefore);
  });

  it("rejects a version mismatch with a clear message", () => {
    const w = world();
    const snap = { ...buildSnapshot(w, 7), version: 999 };
    const err = applySnapshot(world(), snap, 7);
    expect(err).toContain("Version mismatch");
    expect(SNAPSHOT_VERSION).toBe(1);
  });

  it("rejects a seed mismatch", () => {
    const w = world();
    const snap = buildSnapshot(w, 7);
    const err = applySnapshot(world(), snap, 999);
    expect(err).toContain("seed");
  });
});
