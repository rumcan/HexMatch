// ROADS-3 (#394): highways connect only through ramps; roads cross over them
// on overpasses (straight through, no turning); highway bridges span wider.
import { describe, expect, it } from "vitest";
import {
  createTrack, buildTile, commitDrag, previewDrag, roadTierAt, setRoadTier, hasTrack,
  ROAD_TIER, OVERPASS_X, OVERPASS_Y, tIdx,
} from "../../src/iso/track";
import { buildComponents } from "../../src/iso/economy";
import { roadPath } from "../../src/iso/road-routing";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

const rich = { wood: 9999, stone: 9999, ore: 9999, grain: 999, oil: 999, gold: 999 };
function flat(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 1,
  } as Grid;
}
/** A highway along x at y=20 from x=10..30, owner 1. */
function highway(t: ReturnType<typeof createTrack>) {
  for (let x = 10; x <= 30; x++) buildTile(t, "road", x, 20, 1);
  for (let x = 10; x <= 30; x++) setRoadTier(t, x, 20, ROAD_TIER.highway);
}
const bits = (t: ReturnType<typeof createTrack>, x: number, y: number) => t.road[tIdx(x, y)] & 0b1111;

describe("ROADS-3 highway access", () => {
  it("a Road beside a Highway does not join it", () => {
    const t = createTrack();
    highway(t);
    buildTile(t, "road", 15, 21, 1);                  // just below the highway
    buildTile(t, "road", 15, 22, 1);
    expect(bits(t, 15, 21) & 1).toBe(0);              // no NE link up to the highway
    const c = buildComponents(t, 1);
    expect(c.comp[tIdx(15, 21)]).not.toBe(c.comp[tIdx(15, 20)]);
  });

  it("a Ramp joins them", () => {
    const t = createTrack();
    highway(t);
    buildTile(t, "road", 15, 21, 1);
    buildTile(t, "road", 15, 22, 1);
    setRoadTier(t, 15, 21, ROAD_TIER.ramp);
    const c = buildComponents(t, 1);
    expect(c.comp[tIdx(15, 22)]).toBe(c.comp[tIdx(15, 20)]);
  });

  it("a Road dragged across a Highway builds an overpass: straight through, no turning", () => {
    const g = flat(), t = createTrack();
    highway(t);
    const pv = previewDrag(g, t, "road", rich, 20, 17, 20, 23, true, undefined, 0, undefined, true, {}, "road");
    expect(pv.tiles.length).toBe(7);
    commitDrag(t, "road", pv, 1, "road");
    const v = roadTierAt(t, 20, 20);
    expect(v === OVERPASS_X || v === OVERPASS_Y).toBe(true);
    // the highway keeps running along x through the overpass
    const c = buildComponents(t, 1);
    expect(c.comp[tIdx(19, 20)]).toBe(c.comp[tIdx(21, 20)]);
    // the road either side is ONE network (over the bridge)…
    expect(c.comp[tIdx(20, 19)]).toBe(c.comp[tIdx(20, 21)]);
    // …and NOT the highway's
    expect(c.comp[tIdx(20, 19)]).not.toBe(c.comp[tIdx(19, 20)]);
    // routing: across is fine, onto the highway is not
    const across = roadPath(t, 1, [[20, 17]], new Set([tIdx(20, 23)]));
    expect(across).not.toBeNull();
    const onto = roadPath(t, 1, [[20, 17]], new Set([tIdx(12, 20)]));
    expect(onto).toBeNull();
  });

  it("plain maps are unchanged: a road junction still links every way", () => {
    const t = createTrack();
    for (let x = 10; x <= 14; x++) buildTile(t, "road", x, 10, 1);
    buildTile(t, "road", 12, 11, 1);
    expect(bits(t, 12, 10) & 4).toBe(4);             // SW link down to the side road
    expect(hasTrack(t, "road", 12, 11)).toBe(true);
  });

  it("a Highway bridge spans 4 water tiles; a Road does not", () => {
    const g = flat();
    g.rivers = new Uint8Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) for (let x = 40; x <= 43; x++) { g.terrain[y * MAP_W + x] = WATER; g.rivers[y * MAP_W + x] = 1; }
    const hw = previewDrag(g, createTrack(), "road", rich, 36, 50, 47, 50, true, undefined, 0, undefined, true, {}, "highway");
    expect(hw.bridges).toBe(4);
    const rd = previewDrag(g, createTrack(), "road", rich, 36, 50, 47, 50, true, undefined, 0, undefined, true, {}, "road");
    expect(rd.bridges).toBe(0);
  });
});
