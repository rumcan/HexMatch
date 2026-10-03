// Two connected platforms and the auto-train rule (owner report: "the train did
// not spawn when I connected 2 railway platforms").
import { describe, it, expect } from "vitest";
import {
  createRailState, placePlatform, layPlatformTrack, buildRail, autoTrains, stopTile,
  trainSpawnHint, type RailState, type RailStructure,
} from "../../src/iso/rail";
import { createTrack, octPath } from "../../src/iso/track";
import { GRASS, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

const grid = (): Grid => ({
  w: MAP_W, h: MAP_H, terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS), industries: [], towns: [],
  occupancy: new Int16Array(MAP_W * MAP_H).fill(-1), seed: 7,
});

function world(kinds: ["industry" | "plant", "industry" | "plant"], connect = true) {
  const g = grid(), track = createTrack(), state: RailState = createRailState();
  const mk = (x: number, y: number, kind: "industry" | "plant"): RailStructure => {
    const s = placePlatform(state, "you", 1, x, y, "sw", { kind, id: 0, tiles: [] })!;
    layPlatformTrack(g, track, state, s);
    return s;
  };
  const a = mk(20, 20, kinds[0]), b = mk(40, 20, kinds[1]);
  if (connect) {
    const path = octPath(...stopTile(a), ...stopTile(b));
    expect(buildRail(g, track, state, 1, path).why).toBe("ok");
  }
  return { g, state, a, b };
}

describe("auto-train spawn rule", () => {
  it("industry platform + plant platform connected by rail yields a train", () => {
    const w = world(["industry", "plant"]);
    expect(autoTrains(w.state, 1, w.g)).toBe(true);
    expect(w.state.trains).toHaveLength(1);
  });

  it("no train while unconnected, and the hint says so", () => {
    const w = world(["industry", "plant"], false);
    expect(autoTrains(w.state, 1, w.g)).toBe(false);
    expect(trainSpawnHint(w.state, 1, w.g)).toMatch(/connect/i);
  });

  it("two platforms of the same kind never make a line, and the hint says what is missing", () => {
    const w = world(["industry", "industry"]);
    expect(autoTrains(w.state, 1, w.g)).toBe(false);
    expect(trainSpawnHint(w.state, 1, w.g)).toMatch(/plant/i);
    const p = world(["plant", "plant"]);
    expect(trainSpawnHint(p.state, 1, p.g)).toMatch(/industry/i);
  });

  it("no hint once a train runs", () => {
    const w = world(["industry", "plant"]);
    autoTrains(w.state, 1, w.g);
    expect(trainSpawnHint(w.state, 1, w.g)).toBeNull();
  });
});
