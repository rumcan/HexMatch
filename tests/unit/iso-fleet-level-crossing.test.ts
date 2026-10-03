// Level crossings: rail over a PUBLIC road, perpendicular and straight only.
import { describe, it, expect } from "vitest";
import {
  createRailState, buildRail, railTileRefusal, railPath, railToWire, applyRailWire, hasRail,
} from "../../src/iso/rail";
import {
  createTrack, tIdx, roadConnectionMask, PUBLIC_OWNER, NE, SE, SW, NW, type Track,
} from "../../src/iso/track";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

const grid = (): Grid => ({
  w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS), industries: [], towns: [],
  occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 7,
});
type T = [number, number];
const col = (x: number, y0: number, y1: number): T[] => Array.from({ length: y1 - y0 + 1 }, (_, i) => [x, y0 + i]);
const row = (y: number, x0: number, x1: number): T[] => Array.from({ length: x1 - x0 + 1 }, (_, i) => [x0 + i, y]);

/** A public street along x (NW|SE bits) on row y, x0..x1. */
function street(track: Track, y: number, x0: number, x1: number) {
  for (let x = x0; x <= x1; x++) {
    let m = 0;
    if (x > x0) m |= NW;
    if (x < x1) m |= SE;
    track.road[tIdx(x, y)] = 16 | m;
    track.owner[tIdx(x, y)] = PUBLIC_OWNER;
  }
}

function setup() {
  const g = grid(), track = createTrack(), state = createRailState();
  street(track, 30, 25, 35);
  return { g, track, state };
}

describe("level crossing on a public road", () => {
  it("allows a perpendicular straight rail, leaves the road untouched and keeps both connected", () => {
    const w = setup();
    const roadBefore = w.track.road.slice(), ownerBefore = w.track.owner.slice();
    const rail = col(30, 26, 34);
    const res = buildRail(w.g, w.track, w.state, 1, rail);
    expect(res.why).toBe("ok");
    expect(w.track.road).toEqual(roadBefore);
    expect(w.track.owner).toEqual(ownerBefore);
    // rail network still runs across the crossing tile
    expect(railPath(w.state, 1, [rail[0]], new Set([tIdx(...rail.at(-1)!)]))).toEqual(rail);
    // road network keeps its straight connection through the same tile
    expect(roadConnectionMask(w.track, 30, 30)).toBe(NW | SE);
    expect(roadConnectionMask(w.track, 29, 30) & SE).toBeTruthy();
    expect(roadConnectionMask(w.track, 31, 30) & NW).toBeTruthy();
  });

  it("refuses rail running ALONG the road", () => {
    const w = setup();
    expect(buildRail(w.g, w.track, w.state, 1, row(30, 27, 33)).why).toMatch(/road-parallel|crossing-curve/);
  });

  it("refuses a bend on the road tile, and a junction", () => {
    const w = setup();
    const bend = buildRail(w.g, w.track, w.state, 1, [...col(30, 26, 30), ...row(30, 31, 33)]);
    expect(bend.why).not.toBe("ok");
    const j = setup();
    j.track.road[tIdx(30, 30)] |= NE;           // a T junction at (30,30)
    j.track.road[tIdx(30, 29)] = 16 | SW;
    j.track.owner[tIdx(30, 29)] = PUBLIC_OWNER;
    expect(railTileRefusal(j.g, j.track, j.state, 1, 30, 30)).toBe("crossing-curve");
    expect(buildRail(j.g, j.track, j.state, 1, col(30, 31, 34)).why).toBe("ok"); // off the junction is fine
    void SE; void SW;
  });

  it("round-trips through the save wire", () => {
    const w = setup();
    expect(buildRail(w.g, w.track, w.state, 1, col(30, 26, 34)).why).toBe("ok");
    const wire = JSON.parse(JSON.stringify(railToWire(w.state)));
    const back = createRailState();
    applyRailWire(back, wire);
    expect(hasRail(back.rail, 30, 30)).toBe(true);
    expect(Array.from(back.rail.tile)).toEqual(Array.from(w.state.rail.tile));
    expect(Array.from(back.rail.owner)).toEqual(Array.from(w.state.rail.owner));
    expect(railPath(back, 1, [[30, 26]], new Set([tIdx(30, 34)]))).toEqual(col(30, 26, 34));
  });
});
