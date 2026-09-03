import { describe, it, expect } from "vitest";
import {
  SNAPSHOT_VERSION, EXPECTED_TRACK_BYTES, bytesToBase64, base64ToBytes,
  buildSnapshot, validateSnapshot, applySnapshot, snapshotBytes,
  SnapshotError, type SnapshotSource,
} from "../../src/iso/snapshot";
import { createTrack, buildTile, hasTrack, bitsAt, tIdx } from "../../src/iso/track";
import { createScoreState } from "../../src/iso/economy";
import { generateMap } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";

function source(): SnapshotSource {
  const track = createTrack();
  for (let x = 5; x <= 30; x++) buildTile(track, "road", x, 10);
  for (let y = 5; y <= 30; y++) buildTile(track, "rail", 12, y);
  const score = createScoreState();
  score.connections.set(1, "road");
  score.connections.set(2, "rail");
  return {
    seed: 20260903,
    track,
    harvesters: [
      { id: 1, owner: "p1", tx: 6, ty: 11 },
      { id: 2, owner: "p2", tx: 13, ty: 9 },
    ],
    factories: [
      { owner: "p1", tx: 30, ty: 11 },
      { owner: "p2", tx: 12, ty: 30 },
    ],
    score,
    setupPhase: false,
    won: false,
    players: [
      { id: "p1", vp: 1, res: { stone: 4, ore: 2 } },
      { id: "p2", vp: 3, res: { grain: 1 } },
    ],
    t: 1234,
  };
}

describe("E10 base64 typed arrays", () => {
  it("round-trips an arbitrary byte array exactly", () => {
    const bytes = new Uint8Array(EXPECTED_TRACK_BYTES);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31) & 0xff;
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips the empty and all-ones cases", () => {
    const zero = new Uint8Array(16);
    expect(base64ToBytes(bytesToBase64(zero))).toEqual(zero);
    const ones = new Uint8Array(16).fill(255);
    expect(base64ToBytes(bytesToBase64(ones))).toEqual(ones);
  });

  it("is a constant 3072 chars regardless of how much track exists", () => {
    // The real value of base64 here is that it is FLAT: an empty map and a
    // saturated one cost the same, so the host's bandwidth never spikes as
    // the game fills up. (The spec's "~10KB as JSON" is optimistic — the
    // measured JSON encoding is 4.6KB empty and 6.9KB saturated.)
    const empty = new Uint8Array(EXPECTED_TRACK_BYTES);
    const full = new Uint8Array(EXPECTED_TRACK_BYTES).fill(31);
    expect(bytesToBase64(empty)).toHaveLength(3072);
    expect(bytesToBase64(full)).toHaveLength(3072);
  });

  it("beats a JSON array, and by most where it matters — a busy map", () => {
    const full = new Uint8Array(EXPECTED_TRACK_BYTES).fill(31);
    const b64 = bytesToBase64(full).length;
    const json = JSON.stringify(Array.from(full)).length;
    expect(b64).toBeLessThan(json);
    expect(json / b64).toBeGreaterThan(2);        // 2.25x at saturation
  });
});

describe("E10 snapshot shape", () => {
  it("carries a version and the seed", () => {
    const s = buildSnapshot(source());
    expect(s.version).toBe(SNAPSHOT_VERSION);
    expect(s.seed).toBe(20260903);
  });

  it("never sends terrain or industries — they are seed-derived", () => {
    const s = buildSnapshot(source()) as unknown as Record<string, unknown>;
    expect(s.terrain).toBeUndefined();
    expect(s.industries).toBeUndefined();
    expect(s.occupancy).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain("terrain");
  });

  it("sends the track layers as base64 strings, not arrays", () => {
    const s = buildSnapshot(source());
    expect(typeof s.road).toBe("string");
    expect(typeof s.rail).toBe("string");
    expect(base64ToBytes(s.road)).toHaveLength(EXPECTED_TRACK_BYTES);
  });

  it("is smaller on the wire than the JSON-array equivalent", () => {
    const src = source();
    const s = buildSnapshot(src);
    const asJsonArrays = JSON.stringify({
      ...s,
      road: Array.from(src.track.road),
      rail: Array.from(src.track.rail),
    }).length;
    expect(snapshotBytes(s)).toBeLessThan(asJsonArrays);
    // and the whole snapshot stays inside a single small frame
    expect(snapshotBytes(s)).toBeLessThan(8_000);
  });
});

describe("E10 round trip", () => {
  it("restores both track layers byte-for-byte", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    expect(out.track.road).toEqual(src.track.road);
    expect(out.track.rail).toEqual(src.track.rail);
  });

  it("preserves direction masks, so autotiling survives the wire", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    for (const x of [6, 15, 29]) {
      expect(bitsAt(out.track, "road", x, 10)).toBe(bitsAt(src.track, "road", x, 10));
    }
    expect(hasTrack(out.track, "rail", 12, 20)).toBe(true);
    expect(hasTrack(out.track, "road", 40, 40)).toBe(false);
  });

  it("restores harvesters, factories, players and connections", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    expect(out.harvesters).toEqual(src.harvesters);
    expect(out.factories).toEqual(src.factories);
    expect(out.players).toEqual(src.players);
    expect(out.connections.get(1)).toBe("road");
    expect(out.connections.get(2)).toBe("rail");
    expect(out.setupPhase).toBe(false);
    expect(out.t).toBe(1234);
  });

  it("deep-copies, so mutating the source cannot reach the applied state", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    src.harvesters[0].tx = 999;
    src.track.road[tIdx(6, 10)] = 0;
    expect(out.harvesters[0].tx).toBe(6);
    expect(hasTrack(out.track, "road", 6, 10)).toBe(true);
  });

  it("lets both sides regenerate the identical map from the seed alone", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    const host = generateMap(src.seed);
    const guest = generateMap(out.seed);
    expect(guest.terrain).toEqual(host.terrain);
    expect(guest.industries).toEqual(host.industries);
    expect(guest.occupancy).toEqual(host.occupancy);
  });
});

describe("E10 version gating", () => {
  it("accepts a matching version", () => {
    expect(validateSnapshot(buildSnapshot(source()))).toBeNull();
  });

  it("rejects a mismatched version with an actionable message", () => {
    const s = { ...buildSnapshot(source()), version: SNAPSHOT_VERSION + 1 };
    const err = validateSnapshot(s)!;
    expect(err).toBeInstanceOf(SnapshotError);
    expect(err.code).toBe("version");
    expect(err.message).toMatch(/incompatible version/i);
    expect(err.message).toMatch(/reload/i);
    expect(() => applySnapshot(s)).toThrow(SnapshotError);
  });

  it("rejects a snapshot with no version at all", () => {
    const s = buildSnapshot(source()) as Partial<ReturnType<typeof buildSnapshot>>;
    delete s.version;
    expect(validateSnapshot(s)!.code).toBe("malformed");
  });

  it("rejects junk rather than throwing something unhelpful", () => {
    for (const junk of [null, undefined, 42, "hello", []]) {
      const err = validateSnapshot(junk);
      expect(err).toBeInstanceOf(SnapshotError);
    }
  });
});

describe("E10 malformed payloads", () => {
  it("rejects a truncated track layer instead of half-applying it", () => {
    const s = { ...buildSnapshot(source()), road: bytesToBase64(new Uint8Array(10)) };
    const err = validateSnapshot(s)!;
    expect(err.code).toBe("malformed");
    expect(err.message).toMatch(/wrong size/i);
    expect(() => applySnapshot(s)).toThrow(/wrong size/i);
  });

  it("rejects a missing seed and missing structure lists", () => {
    const base = buildSnapshot(source());
    expect(validateSnapshot({ ...base, seed: undefined })!.code).toBe("malformed");
    expect(validateSnapshot({ ...base, harvesters: undefined })!.code).toBe("malformed");
    expect(validateSnapshot({ ...base, road: undefined })!.code).toBe("malformed");
  });

  it("rejects a seed mismatch when the guest already generated a map", () => {
    const s = buildSnapshot(source());
    const err = validateSnapshot(s, 999)!;
    expect(err.code).toBe("seed");
    expect(err.message).toMatch(/seed mismatch/i);
    // ...and accepts the matching seed
    expect(validateSnapshot(s, 20260903)).toBeNull();
  });

  it("does not mutate anything when it rejects", () => {
    const s = { ...buildSnapshot(source()), version: 999 };
    const before = JSON.stringify(s);
    expect(() => applySnapshot(s)).toThrow();
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("E10 scale", () => {
  it("handles a fully saturated map without blowing up", () => {
    const src = source();
    src.track.road.fill(31);
    src.track.rail.fill(31);
    const s = buildSnapshot(src);
    expect(snapshotBytes(s)).toBeLessThan(20_000);
    const out = applySnapshot(s);
    expect(out.track.road).toEqual(src.track.road);
  });

  it("the track layers are exactly one byte per tile", () => {
    expect(EXPECTED_TRACK_BYTES).toBe(MAP_W * MAP_H);
    expect(EXPECTED_TRACK_BYTES).toBe(2304);
  });
});
