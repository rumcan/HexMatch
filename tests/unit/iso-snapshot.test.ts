import { describe, it, expect } from "vitest";
import {
  SNAPSHOT_VERSION, EXPECTED_TRACK_BYTES, bytesToBase64, base64ToBytes,
  buildSnapshot, validateSnapshot, applySnapshot, snapshotBytes,
  SnapshotError, type SnapshotSource,
} from "../../src/iso/snapshot";
import { createTrack, buildTile, hasTrack, bitsAt, tIdx, isUpgradedRoad } from "../../src/iso/track";
import { generateMap } from "../../src/iso/grid";
import { joinFromSnapshot } from "../../src/iso/snapshot";
import { MAP_W, MAP_H } from "../../src/game/config";
import { createScoreState, rescore, vpFor, hasWon } from "../../src/iso/victory";

function source(): SnapshotSource {
  const track = createTrack();
  for (let x = 5; x <= 30; x++) buildTile(track, "dirt", x, 10, 1);
  for (let y = 5; y <= 30; y++) buildTile(track, "road", 12, y, 1);
  // VP-01: `track.upgraded` is the ONLY thing the scoreboard reads, and it is
  // not in the payload as a score — the snapshot carries provenance and both
  // sides derive the points. So the crossing at (12,10) (a paved tile over the
  // gravel p1 laid first) has to travel, or a rejoining guest would call the
  // host's whole network "laid on virgin ground" and show 0★.
  return {
    seed: 20260903,
    track,
    harvesters: [
      { id: 1, owner: "p1", ownerId: 1, tx: 6, ty: 11 },
      { id: 2, owner: "p2", ownerId: 2, tx: 13, ty: 9 },
    ],
    factories: [
      { owner: "p1", ownerId: 1, tx: 30, ty: 11 },
      { owner: "p2", ownerId: 2, tx: 12, ty: 30 },
    ],
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

  it("has a fixed base64 length regardless of how much track exists", () => {
    // The real value of base64 here is that it is FLAT: an empty map and a
    // saturated one cost the same, so the host's bandwidth never spikes as
    // the game fills up.
    const empty = new Uint8Array(EXPECTED_TRACK_BYTES);
    const full = new Uint8Array(EXPECTED_TRACK_BYTES).fill(31);
    // base64 of one full layer is 4·⌈bytes/3⌉, whatever the map size (T4).
    expect(bytesToBase64(empty)).toHaveLength(Math.ceil(EXPECTED_TRACK_BYTES / 3) * 4);
    expect(bytesToBase64(full)).toHaveLength(Math.ceil(EXPECTED_TRACK_BYTES / 3) * 4);
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
    expect(typeof s.dirt).toBe("string");
    expect(typeof s.road).toBe("string");
    // W2: the owner layer travels too, otherwise a rejoined guest sees one
    // shared graph instead of two players' networks.
    expect(typeof s.owner).toBe("string");
    expect(typeof s.upgraded).toBe("string");
    expect(base64ToBytes(s.dirt)).toHaveLength(EXPECTED_TRACK_BYTES);
    expect(base64ToBytes(s.owner)).toHaveLength(EXPECTED_TRACK_BYTES);
    expect(base64ToBytes(s.upgraded)).toHaveLength(EXPECTED_TRACK_BYTES);
  });

  it("is smaller on the wire than the JSON-array equivalent", () => {
    const src = source();
    const s = buildSnapshot(src);
    const asJsonArrays = JSON.stringify({
      ...s,
      dirt: Array.from(src.track.dirt),
      road: Array.from(src.track.road),
      owner: Array.from(src.track.owner),
      upgraded: Array.from(src.track.upgraded),
    }).length;
    expect(snapshotBytes(s)).toBeLessThan(asJsonArrays);
    // and the whole snapshot stays small on the wire: the track payload is now
    // FOUR layers of base64 (≈4 B/tile each, 5.33 B/tile all in), so ~6 B/tile
    // still holds with headroom (T4). VP-01 bought the fourth layer by deleting
    // the `connections` map, which used to travel as per-harvester JSON.
    expect(snapshotBytes(s)).toBeLessThan(6 * EXPECTED_TRACK_BYTES);
  });
});

describe("E10 round trip", () => {
  it("restores all four track layers byte-for-byte", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    expect(out.track.dirt).toEqual(src.track.dirt);
    expect(out.track.road).toEqual(src.track.road);
    expect(out.track.owner).toEqual(src.track.owner);
    expect(out.track.upgraded).toEqual(src.track.upgraded);
  });

  it("VP-01: the pave provenance survives the wire, so the score does too", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    // the crossing tile is a pave over p1's own gravel; the rest of the column
    // was laid on clean ground. Both facts have to travel.
    expect(isUpgradedRoad(out.track, 12, 10)).toBe(true);
    expect(isUpgradedRoad(out.track, 12, 20)).toBe(false);
    expect(out.track.upgraded).toEqual(src.track.upgraded);
    expect(out.score).toBeUndefined();          // derived, never sent

    // The acceptance criterion in full: two independent scorers — the host's and
    // a guest holding only the snapshot — must agree, down to the win check. If
    // `upgraded` ever stops travelling, the guest silently sees a 0★ opponent it
    // cannot beat, which is why this is asserted end to end rather than as a
    // layer comparison.
    const eco = {
      grid: generateMap(src.seed), track: src.track,
      harvesters: src.harvesters, factories: src.factories,
    };
    const hostScore = createScoreState(), guestScore = createScoreState();
    rescore(eco, hostScore);
    rescore({ ...eco, track: out.track }, guestScore);
    expect(vpFor(guestScore, "p1")).toBe(vpFor(hostScore, "p1"));
    expect(vpFor(hostScore, "p1")).toBe(0.25);   // the one crossing tile
    expect(hasWon(hostScore, "p1")).toBe(hasWon(guestScore, "p1"));
  });

  it("W2: an owned tile keeps its owner across the wire", () => {
    const src = source();
    src.track.owner[tIdx(10, 10)] = 1;
    const out = applySnapshot(buildSnapshot(src));
    expect(out.track.owner[tIdx(10, 10)]).toBe(1);
  });

  it("preserves direction masks, so autotiling survives the wire", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    for (const x of [6, 15, 29]) {
      expect(bitsAt(out.track, "dirt", x, 10)).toBe(bitsAt(src.track, "dirt", x, 10));
    }
    expect(hasTrack(out.track, "road", 12, 20)).toBe(true);
    expect(hasTrack(out.track, "dirt", 40, 40)).toBe(false);
  });

  it("restores harvesters, factories and players — and no derived score", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    expect(out.harvesters).toEqual(src.harvesters);
    expect(out.factories).toEqual(src.factories);
    expect(out.players).toEqual(src.players);
    expect(out.setupPhase).toBe(false);
    expect(out.t).toBe(1234);
  });

  it("deep-copies, so mutating the source cannot reach the applied state", () => {
    const src = source();
    const out = applySnapshot(buildSnapshot(src));
    src.harvesters[0].tx = 999;
    src.track.dirt[tIdx(6, 10)] = 0;
    expect(out.harvesters[0].tx).toBe(6);
    expect(hasTrack(out.track, "dirt", 6, 10)).toBe(true);
  });

  it("R6: a guest joining mid-session regenerates the host terrain and industries", () => {
    const src = source();
    const host = generateMap(src.seed);
    const { applied, grid } = joinFromSnapshot(buildSnapshot(src));
    expect(applied.seed).toBe(src.seed);
    expect(grid.terrain).toEqual(host.terrain);
    expect(grid.industries).toEqual(host.industries);
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
  it("rejects a pre-VP-01 v8 peer with a version message before checking layer sizes", () => {
    // VP-01 added the `upgraded` layer (v9). A v8 peer has no provenance to
    // send or read, so both sides would agree on the track and disagree on the
    // score — the nastiest kind of desync, since the scoreboard is the win
    // condition. The version gate is what stops it.
    const v8 = { ...buildSnapshot(source()), version: 8 } as never;
    expect(validateSnapshot(v8)?.code).toBe("version");
    expect(() => applySnapshot(v8)).toThrow(/incompatible version/i);
    // …and the same for the pre-de-railway v7 clients checked below.
  });

  it("rejects pre-de-railway v7 clients with a version message before checking layer sizes", () => {
    // The de-railway rebalanced the game: `dirt`/`road` swapped meaning (the
    // premium paved tier is now `road`) and town roads & inter-town highways
    // moved onto the premium paved layer, so a v7 guest regenerates a
    // DIFFERENT grid of free premium connections from the same seed. The
    // refusal must come from the version check, not from the layer-size check
    // (both layers are the same size across versions, so the version gate is
    // what actually keeps mixed-version rooms from silently diverging).
    const old = { ...buildSnapshot(source()), version: 7 };
    expect(SNAPSHOT_VERSION).toBe(9);
    expect(validateSnapshot(old)?.code).toBe("version");
    expect(() => applySnapshot(old)).toThrow(/incompatible version/i);
  });

  it("rejects a truncated track layer instead of half-applying it", () => {
    const s = { ...buildSnapshot(source()), dirt: bytesToBase64(new Uint8Array(10)) };
    const err = validateSnapshot(s)!;
    expect(err.code).toBe("malformed");
    expect(err.message).toMatch(/wrong size/i);
    expect(() => applySnapshot(s)).toThrow(/wrong size/i);
  });

  it("rejects a missing seed and missing structure lists", () => {
    const base = buildSnapshot(source());
    expect(validateSnapshot({ ...base, seed: undefined })!.code).toBe("malformed");
    expect(validateSnapshot({ ...base, harvesters: undefined })!.code).toBe("malformed");
    expect(validateSnapshot({ ...base, dirt: undefined })!.code).toBe("malformed");
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
    src.track.dirt.fill(31);
    src.track.road.fill(31);
    const s = buildSnapshot(src);
    expect(snapshotBytes(s)).toBeLessThan(10 * EXPECTED_TRACK_BYTES);
    const out = applySnapshot(s);
    expect(out.track.dirt).toEqual(src.track.dirt);
  });

  it("the track layers are exactly one byte per tile", () => {
    expect(EXPECTED_TRACK_BYTES).toBe(MAP_W * MAP_H);
    expect(EXPECTED_TRACK_BYTES).toBe(144 * 144);   // T4: tripled per dimension
  });
});
