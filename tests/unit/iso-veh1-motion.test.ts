import { describe, expect, it } from "vitest";
import { stepGhost, lightAspect, LIGHT_CYCLE_MS, LIGHT_HOLD_TILES, createAmbience, tickTruckGhosts,
  type GhostPose, type SignalMap } from "../../src/iso/ambience";
import { tickTrucks, truckItems, TRUCK_SPEED, type Truck } from "../../src/iso/vehicles";
import { buildTile, createTrack, setRoadTier, ROAD_TIER, tIdx } from "../../src/iso/track";

type Tile = [number, number];
const route: Tile[] = [[10, 10], [11, 10], [12, 11], [12, 12], [11, 13], [10, 13], [9, 12], [9, 11], [10, 10]];
const views = ["se", "s", "sw", "w", "nw", "n", "ne", "e"];
const backViews = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
function truck(path = route): Truck {
  return { ownerId: 1, depotId: 1, factory: path.at(-1)!, route: path,
    leg: 0, t: 0, reverse: false, deliveries: 0 };
}
function draw(t: Truck, pose: GhostPose = t, track?: ReturnType<typeof createTrack>) {
  return truckItems({ trucks: [{ ...t, ...pose }] }, undefined, track)[0];
}
const signals: SignalMap = { seed: 4, junctions: new Map([[tIdx(11, 10), 2]]) };
function lightTime(aspect: "red" | "green") {
  for (let ms = 0; ms < LIGHT_CYCLE_MS; ms += 10) {
    if (lightAspect(4, 2, 0, ms) === aspect) return ms;
  }
  throw new Error(`No ${aspect}`);
}

describe("VEH-1 drawn lorry motion", () => {
  it.each([false, true])("interpolates the same segment in all eight headings, reverse=%s", (reverse) => {
    const tr = truck();
    for (let leg = 0; leg < route.length - 1; leg++) {
      for (const t of [0, 0.1, 0.4, 0.9, 1]) {
        const item = draw(tr, { leg, t, reverse });
        const a = route[leg], b = route[leg + 1];
        expect(item.fx).toBeCloseTo(a[0] + (b[0] - a[0]) * t);
        expect(item.fy).toBeCloseTo(a[1] + (b[1] - a[1]) * t);
        expect(item.sprite).toBe(`truck_goods_${(reverse ? backViews : views)[leg]}`);
      }
    }
  });

  it.each([
    { lights: false, lanes: false }, { lights: true, lanes: false },
    { lights: false, lanes: true }, { lights: true, lanes: true },
  ])("samples a full drawn round trip (red-light delay=$lights, lanes=$lanes)", ({ lights, lanes }) => {
    const tr = truck();
    const state = { trucks: [tr] };
    const track = lanes ? createTrack(true) : undefined;
    if (track) route.forEach(([x, y]) => buildTile(track, "road", x, y, 1));
    let pose = stepGhost(null, tr, lights ? signals : null, lightTime("red"), 0);
    let returned = false, reachedFactory = false, heldFrames = 0;
    // Keep the light red until the economic lorry has already turned back.
    // The drawn one must still reach the factory before starting its return.
    for (let ms = 0; ms < 30_000 && !returned; ms += 10) {
      const before = pose, a = draw(tr, before, track);
      tickTrucks(state, 10);
      pose = stepGhost(pose, tr, lights ? signals : null,
        ms < 8000 ? lightTime("red") : lightTime("green"), 10);
      const b = draw(tr, pose, track);
      const distance = Math.hypot(b.fx! - a.fx!, b.fy! - a.fy!);
      // Lane interpolation adds a small lateral component, never a jump.
      expect(distance).toBeLessThanOrEqual(TRUCK_SPEED * 3 * 10 * (lanes ? 1.5 : 1) + 1e-8);
      if (distance < 1e-8) heldFrames++;
      const oldS = before.leg + before.t, newS = pose.leg + pose.t;
      if (before.reverse === pose.reverse) {
        expect((newS - oldS) * (pose.reverse ? -1 : 1)).toBeGreaterThanOrEqual(-1e-8);
        // Within a segment the actual DRAWN displacement must face its sprite.
        if (before.leg === pose.leg && distance > 1e-8) {
          const start = route[pose.leg], end = route[pose.leg + 1];
          const sign = pose.reverse ? -1 : 1;
          expect(((b.fx! - a.fx!) * (end[0] - start[0])
            + (b.fy! - a.fy!) * (end[1] - start[1])) * sign).toBeGreaterThan(0);
        }
      } else if (pose.reverse) {
        expect(newS).toBeGreaterThan(route.length - 1 - 0.06);
        reachedFactory = true;
      } else {
        expect(newS).toBeLessThan(0.06);
        returned = true;
      }
      expect(b.sprite).toBe(`truck_goods_${(pose.reverse ? backViews : views)[pose.leg]}`);
    }
    expect(reachedFactory).toBe(true);
    expect(returned).toBe(true);
    if (lights) expect(heldFrames).toBeGreaterThan(100);
  });

  it("does not pull a committed lorry backwards when a light turns red", () => {
    const tr = truck();
    tr.t = 0.9;
    const before = stepGhost(null, tr, signals, lightTime("green"), 0);
    tr.t = 0.95;
    const after = stepGhost(before, tr, signals, lightTime("red"), 40);
    expect(after.t).toBeGreaterThanOrEqual(before.t);
  });

  it.each([false, true])("checks every crossed stop line during a large catch-up tick, reverse=%s", (reverse) => {
    const tr = truck([[10, 10], [11, 10], [12, 10], [13, 10], [14, 10]]);
    const sig: SignalMap = { ...signals, junctions: new Map([[tIdx(12, 10), 2]]) };
    const prev = { leg: reverse ? 3 : 0, t: reverse ? 1 : 0, reverse };
    Object.assign(tr, { leg: reverse ? 0 : 3, t: reverse ? 0 : 1, reverse });
    const pose = stepGhost(prev, tr, sig, lightTime("red"), 2000);
    expect(pose.leg).toBe(reverse ? 2 : 1);
    expect(pose.t).toBeCloseTo(reverse ? LIGHT_HOLD_TILES : 1 - LIGHT_HOLD_TILES);
  });

  it.each([
    { end: [11, 10] as Tile, segFast: undefined, segMult: undefined, segClimb: 0, rateMult: 1 },
    { end: [11, 11] as Tile, segFast: true, segMult: undefined, segClimb: 0, rateMult: 0.7 },
    { end: [12, 10] as Tile, segFast: true, segMult: 2, segClimb: 1, rateMult: 1.3 },
    { end: [11, 10] as Tile, segFast: false, segMult: undefined, segClimb: -1, rateMult: Infinity },
  ])("bounds catch-up by the economic segment's physical speed: %j", (config) => {
    for (const reverse of [false, true]) {
      const tr = truck([[10, 10], config.end]);
      Object.assign(tr, {
        reverse, t: reverse ? 0.05 : 0.95,
        segFast: config.segFast === undefined ? undefined : [config.segFast],
        segMult: config.segMult === undefined ? undefined : [config.segMult],
        segClimb: [config.segClimb], rateMult: config.rateMult,
      });
      const start = { leg: 0, t: reverse ? 0.8 : 0.2, reverse };
      const reference = { ...tr, ...start };
      // A ghost can cover no more than three ordinary ticks' distance.
      tickTrucks({ trucks: [reference] }, 30);
      const economicBefore = structuredClone(tr);
      const pose = stepGhost(start, tr, null, 0, 10);
      expect(pose.t).toBeCloseTo(reference.t);
      expect(tr).toEqual(economicBefore);
    }
  });

  it("keeps a stopped economic lorry still once the ghost catches up", () => {
    const tr = truck();
    tr.t = 0.5;
    let pose = stepGhost({ leg: 0, t: 0.2, reverse: false }, tr, null, 0, 1000);
    for (let i = 0; i < 100; i++) pose = stepGhost(pose, tr, null, 0, 16);
    expect(pose).toMatchObject({ leg: 0, t: 0.5, reverse: false });
  });

  it("keeps lane offsets continuous through turns, tier changes and both endpoints", () => {
    const path: Tile[] = [[10, 10], [11, 10], [12, 11], [12, 12]];
    const tr = truck(path), track = createTrack(true);
    path.forEach(([x, y]) => buildTile(track, "road", x, y, 1));
    setRoadTier(track, 11, 10, ROAD_TIER.highway);
    const gap = (a: GhostPose, b: GhostPose) => {
      const p = draw(tr, a, track), q = draw(tr, b, track);
      return Math.hypot(q.fx! - p.fx!, q.fy! - p.fy!);
    };
    for (const reverse of [false, true]) {
      for (let leg = 0; leg < path.length - 2; leg++) {
        expect(gap({ leg, t: 1 - 1e-7, reverse }, { leg: leg + 1, t: 1e-7, reverse })).toBeLessThan(1e-5);
      }
      expect(gap({ leg: 0, t: 0.5 - 1e-7, reverse }, { leg: 0, t: 0.5 + 1e-7, reverse })).toBeLessThan(1e-5);
    }
    for (const [leg, t] of [[0, 0], [2, 1]]) {
      expect(gap({ leg, t, reverse: false }, { leg, t, reverse: true })).toBeLessThan(1e-5);
    }
    // Return traffic uses the opposite side, not the outbound lane.
    expect(draw(tr, { leg: 0, t: 0.5, reverse: false }, track).fy).toBeGreaterThan(10);
    expect(draw(tr, { leg: 0, t: 0.5, reverse: true }, track).fy).toBeLessThan(10);
  });

  it("resets a ghost on a changed route and removes vanished depots", () => {
    const tr = truck(), amb = createAmbience(4);
    tickTruckGhosts(amb, [tr], 10);
    // A routine replan with the same tiles must preserve a visual hold.
    tr.route = tr.route.map(([x, y]) => [x, y]);
    tr.t = 0.6;
    tickTruckGhosts(amb, [tr], 10);
    expect(amb.ghosts.get(1)!.t).toBeLessThan(0.6);
    tr.route = [[20, 20], [21, 20]];
    tr.t = 0.6;
    tickTruckGhosts(amb, [tr], 10);
    expect(amb.ghosts.get(1)).toMatchObject({ leg: 0, t: 0.6, reverse: false });
    tickTruckGhosts(amb, [], 10);
    expect(amb.ghosts.size).toBe(0);
  });
});
