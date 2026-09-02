import { describe, it, expect, beforeEach } from "vitest";
import { IsoWorld } from "../../src/iso/world";
import { generateGrid } from "../../src/iso/grid";
import { setRng, mulberry32, TERRAIN } from "../../src/iso/config";

// A controlled world: all grass, one farm industry at a known location.
function harness() {
  setRng(mulberry32(424242));
  const map = generateGrid(424242);
  map.terrain.fill(TERRAIN.GRASS);
  map.industries.length = 0;
  map.occup.fill(-1);
  const farm = { id: 0, type: "farm" as const, tx: 20, ty: 20, w: 2, h: 2, output: 1.0, banditUntil: 0 };
  map.industries.push(farm);
  for (let y = 20; y < 22; y++) for (let x = 20; x < 22; x++) map.occup[y * map.w + x] = 0;
  return new IsoWorld(map, 1);
}

describe("E8 setup → E6 connection, full loop", () => {
  let w: IsoWorld;
  beforeEach(() => { w = harness(); });

  it("free factory + harvester + road connects, yields cargo and awards road VP", () => {
    // factory SE end (14,22), harvester NW at (19,21); straight road row 22
    // (15..19) sits adjacent to both.
    expect(w.placeFactory(0, 14, 22)).toBe(true);
    const hv = w.placeHarvester(0, 19, 21);
    expect(hv).not.toBeNull();
    // free setup road (the controller flags these free; here we just build)
    for (let x = 15; x <= 19; x++) w.net.build("road", x, 22);
    w.checkConnections();

    const st = w.connState.get(hv!.id)!;
    expect(st.road || st.rail).toBe(true);
    expect(w.vp[0]).toBe(1); // road = 1 VP per connection
    const res = w.playerResources(0, 1000);
    expect(res.grain).toBeGreaterThan(0);
  });

  it("breaking the path within one frame revokes the connection and VP", () => {
    w.placeFactory(0, 14, 22);
    const hv = w.placeHarvester(0, 19, 21);
    for (let x = 15; x <= 19; x++) w.net.build("road", x, 22);
    w.checkConnections();
    expect(w.vp[0]).toBe(1);

    // demolish the middle tile → disconnected immediately
    w.net.demolish("road", 17, 22);
    w.checkConnections();
    expect(w.connState.get(hv!.id)!.road).toBe(false);
    expect(w.vp[0]).toBe(0);
    expect(w.playerResources(0, 1000).grain ?? 0).toBe(0);
  });

  it("upgrading the connection to rail raises VP to 3 and applies 1.6× (E2)", () => {
    w.placeFactory(0, 14, 22);
    const hv = w.placeHarvester(0, 19, 21);
    for (let x = 15; x <= 19; x++) {
      w.net.build("road", x, 22);
      w.net.build("rail", x, 22);   // crossing: rail runs alongside
    }
    w.checkConnections();
    // rail present → rail wins (higher multiplier & VP)
    const st = w.connState.get(hv!.id)!;
    expect(st.rail).toBe(true);
    expect(w.vp[0]).toBe(3);
    expect(w.playerResources(0, 1000).grain).toBeCloseTo(1.6, 5);
  });

  it("fills the free road budget path via drag and counts exactly the tiles (E5/E8)", () => {
    w.placeFactory(0, 14, 22);
    const path = w.net.dragPath("road", 15, 22, 19, 22);
    const charged = w.net.commitDrag("road", path);
    expect(charged.length).toBe(5); // 5 new tiles; a re-drag would charge 0
    expect(w.net.commitDrag("road", path).length).toBe(0);
  });
});
