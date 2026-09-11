// MP-04 — delta tests: dirty journal, diff/apply, randomised byte-identity,
// tile cap, and the 16 KiB size guard.
//
// The acceptance test (§5): "for any sequence of actions, applying the full
// snapshot then N deltas must produce a Track byte-identical to the host's."
// `random-actions stay byte-identical` runs it with three seeds against REAL
// map seeding and the REAL mutation functions, cross-checked every step
// against the full-scan oracle `diffTrack`.
//
// NOTE on what the journal promises: it is a conservative over-approximation
// — autotiling TOUCHES the tile plus its neighbours, but an empty neighbour
// recomputes to the value it already had. So `drain ⊇ diff`, never `drain ≡
// diff`. The invariant under test is the subset direction: every tile whose
// VALUES changed must be journalled (a missed mutation desyncs the guest;
// a redundant entry is just bytes).
import { describe, it, expect, beforeEach } from "vitest";
import { MAP_W, MAP_H, mulberry32 } from "../../src/game/config";
import { generateMap } from "../../src/iso/grid";
import {
  DirtyTiles,
  buildTile,
  createTrack,
  demolishTile,
  dirtyTiles,
  seedPublicRoads,
  seedTownRoads,
  type Track,
  type TrackKind,
} from "../../src/iso/track";
import {
  applySnapshot,
  buildSnapshot,
  snapshotBytes,
  type Snapshot,
} from "../../src/iso/snapshot";
import { FRAME_CAP_BYTES } from "../../src/net/protocol";
import {
  MAX_DELTA_TILES,
  applyTrackDelta,
  buildPublish,
  deltaBytes,
  diffTrack,
  readTiles,
  type PublishFields,
} from "../../src/net/delta";

beforeEach(() => {
  dirtyTiles.clear();
});

// ── helpers ─────────────────────────────────────────────────────────────

/** First differing tile across all four layers, with coordinates — or null. */
function firstDiff(a: Track, b: Track): string | null {
  const layers = [
    ["dirt", a.dirt, b.dirt],
    ["road", a.road, b.road],
    ["owner", a.owner, b.owner],
    ["upgraded", a.upgraded, b.upgraded],
  ] as const;
  for (const [name, la, lb] of layers) {
    for (let i = 0; i < la.length; i++) {
      if (la[i] !== lb[i]) {
        const x = i % MAP_W;
        const y = Math.floor(i / MAP_W);
        return `${name}[${i}] (x=${x},y=${y}): host=${la[i]} guest=${lb[i]}`;
      }
    }
  }
  return null;
}

function cloneTrack(t: Track): Track {
  const c = createTrack();
  c.dirt.set(t.dirt);
  c.road.set(t.road);
  c.owner.set(t.owner);
  c.upgraded.set(t.upgraded);
  return c;
}

function fields(over: Partial<PublishFields> = {}): PublishFields {
  return {
    t: 0,
    seq: 0,
    harvesters: [],
    factories: [],
    players: [],
    setupPhase: true,
    won: false,
    ...over,
  };
}

// ── dirty journal ─────────────────────────────────────────────────────────

describe("MP-04 dirty journal", () => {
  it("is a sorted, draining set", () => {
    const d = new DirtyTiles();
    expect(d.size).toBe(0);
    d.mark(9);
    d.markAll([3, 9, 5]);
    expect(d.size).toBe(3);
    expect(d.has(5)).toBe(true);
    expect(d.has(6)).toBe(false);
    expect(d.drain()).toEqual([3, 5, 9]);
    expect(d.size).toBe(0);
    d.mark(1);
    d.clear();
    expect(d.size).toBe(0);
  });

  it("buildTile journals exactly the touched tiles", () => {
    const t = createTrack();
    const r = buildTile(t, "dirt", 10, 10, 1);
    if (r === null) throw new Error("buildTile unexpectedly returned null");
    expect(dirtyTiles.drain()).toEqual([...r.tiles].sort((a, b) => a - b));
    expect(dirtyTiles.size).toBe(0);
  });

  it("demolishTile journals the touched tiles", () => {
    const t = createTrack();
    buildTile(t, "road", 20, 20, 2);
    dirtyTiles.clear();
    const r = demolishTile(t, "road", 20, 20);
    if (r === null) throw new Error("demolishTile unexpectedly returned null");
    const drained = new Set(dirtyTiles.drain());
    for (const i of r.tiles) expect(drained.has(i)).toBe(true);
  });

  it("paving (road over dirt) journals the upgrade", () => {
    const t = createTrack();
    buildTile(t, "dirt", 30, 30, 1);
    dirtyTiles.clear();
    const r = buildTile(t, "road", 30, 30, 1);
    expect(r).not.toBeNull();
    expect(dirtyTiles.size).toBeGreaterThan(0);
  });

  it("no-op builds journal nothing", () => {
    const t = createTrack();
    buildTile(t, "road", 40, 40, 1);
    dirtyTiles.clear();
    // Dirt over pavement is a no-op (no downgrade)…
    expect(buildTile(t, "dirt", 40, 40, 1)).toBeNull();
    // …as is anything off the map.
    expect(buildTile(t, "dirt", -1, 0, 1)).toBeNull();
    expect(buildTile(t, "road", MAP_W, MAP_H, 1)).toBeNull();
    expect(demolishTile(t, "dirt", -5, 99)).toBeNull();
    expect(dirtyTiles.size).toBe(0);
  });
});

// ── diff / apply ──────────────────────────────────────────────────────────

describe("MP-04 diffTrack / applyTrackDelta", () => {
  it("diffs nothing on identical tracks", () => {
    expect(diffTrack(createTrack(), createTrack())).toEqual([]);
  });

  it("finds a changed tile on every layer", () => {
    const prev = createTrack();
    const next = cloneTrack(prev);
    buildTile(next, "road", 12, 12, 2);
    dirtyTiles.clear(); // the oracle reads values, not the journal
    const d = diffTrack(prev, next);
    expect(d.length).toBeGreaterThanOrEqual(1);
    const self = d.find((c) => c.i === 12 * MAP_W + 12);
    if (self === undefined) throw new Error("built tile missing from the diff");
    expect(self.road).not.toBe(0);
    expect(self.owner).toBe(2);
  });

  it("round-trips through applyTrackDelta", () => {
    const prev = createTrack();
    const next = cloneTrack(prev);
    buildTile(next, "dirt", 5, 5, 1);
    buildTile(next, "road", 6, 5, 1);
    demolishTile(next, "dirt", 5, 5);
    dirtyTiles.clear();
    const guest = cloneTrack(prev);
    applyTrackDelta(guest, diffTrack(prev, next));
    expect(firstDiff(next, guest)).toBeNull();
  });

  it("applyTrackDelta is a tolerant reader", () => {
    const t = createTrack();
    buildTile(t, "dirt", 8, 8, 1);
    dirtyTiles.clear();
    const before = cloneTrack(t);
    // None of these may throw, and none may corrupt the track.
    applyTrackDelta(t, undefined);
    applyTrackDelta(t, null as unknown as undefined);
    applyTrackDelta(t, "nope" as unknown as undefined);
    applyTrackDelta(t, [null, "x", 7, {}, { i: -1 }, { i: 1e9 }, { i: 1.5 }] as never);
    applyTrackDelta(t, [{ i: 8 * MAP_W + 8, dirt: "abc", road: null, owner: 999, upgraded: -1 }] as never);
    expect(firstDiff(before, t)).toBeNull();
    // …while a valid entry still applies.
    applyTrackDelta(t, [{ i: 9 * MAP_W + 9, dirt: 19, road: 0, owner: 1, upgraded: 0 }]);
    expect(t.dirt[9 * MAP_W + 9]).toBe(19);
  });

  it("readTiles skips indices the guest could not apply", () => {
    const t = createTrack();
    const good = 3 * MAP_W + 3;
    const out = readTiles(t, [-1, MAP_W * MAP_H, 1.5, Number.NaN, good]);
    expect(out.map((c) => c.i)).toEqual([good]);
  });
});

// ── randomised byte-identity (the §5 acceptance test) ─────────────────────

function randomActions(
  rng: () => number,
  host: Track,
  hostHarvesters: Snapshot["harvesters"],
  hostFactories: Snapshot["factories"],
  nextId: { value: number },
): void {
  const kinds: TrackKind[] = ["dirt", "road"];
  const owners = [0, 1, 2];
  const roll = rng();
  const x = Math.floor(rng() * MAP_W);
  const y = Math.floor(rng() * MAP_H);
  const owner = owners[Math.floor(rng() * owners.length)];
  if (roll < 0.45) {
    buildTile(host, kinds[Math.floor(rng() * 2)], x, y, owner);
  } else if (roll < 0.6) {
    demolishTile(host, kinds[Math.floor(rng() * 2)], x, y);
  } else if (roll < 0.75) {
    // Pave-over: gravel first, then tar on the same tile.
    const px = Math.floor(rng() * MAP_W);
    const py = Math.floor(rng() * MAP_H);
    buildTile(host, "dirt", px, py, owner);
    buildTile(host, "road", px, py, owner);
  } else if (roll < 0.85) {
    // Short drag-like line (may run off the map edge — null paths).
    const len = 2 + Math.floor(rng() * 6);
    const horiz = rng() < 0.5;
    for (let k = 0; k < len; k++) {
      buildTile(host, "dirt", x + (horiz ? k : 0), y + (horiz ? 0 : k), owner);
    }
  } else if (roll < 0.92) {
    // Structure-list churn: the delta carries these whole.
    hostHarvesters.push({
      id: nextId.value++,
      owner: owner === 2 ? "p2" : "p1",
      ownerId: owner,
      tx: x,
      ty: y,
    });
    if (hostHarvesters.length > 30) hostHarvesters.splice(Math.floor(rng() * hostHarvesters.length), 1);
    if (rng() < 0.2) hostFactories.push({ owner: "p1", ownerId: 1, tx: x, ty: y });
  } else {
    // Off-map knocks: null paths that must journal nothing.
    buildTile(host, "dirt", -1 - Math.floor(rng() * 3), y, owner);
    demolishTile(host, "road", MAP_W + 1, MAP_H + 1);
  }
}

describe("MP-04 randomised byte-identity", () => {
  for (const seed of [1, 7, 1337]) {
    it(`seed ${seed}: snapshot then N deltas reproduces the host byte-identical`, () => {
      const rng = mulberry32(seed);
      // A REAL map: terrain-derived towns and highways stamped onto the host
      // track, exactly as a hosted game boots — public-road tiles included.
      const grid = generateMap(seed);
      const host = createTrack();
      seedTownRoads(host, grid);
      seedPublicRoads(host, grid);

      const hostHarvesters: Snapshot["harvesters"] = [];
      const hostFactories: Snapshot["factories"] = [];
      const hostPlayers: Snapshot["players"] = [
        { id: "p1", vp: 0, res: { stone: 4 } },
        { id: "p2", vp: 0, res: {} },
      ];
      let setupPhase = true;

      // Initial sync: the guest applies the full snapshot, then ONLY deltas.
      const applied = applySnapshot(
        buildSnapshot({
          seed,
          track: host,
          harvesters: hostHarvesters,
          factories: hostFactories,
          setupPhase,
          won: false,
          players: hostPlayers,
        }),
      );
      const guest = applied.track;
      let guestHarvesters = applied.harvesters;
      let guestFactories = applied.factories;
      let guestPlayers = applied.players;
      let guestSetupPhase = applied.setupPhase;
      expect(firstDiff(host, guest)).toBeNull();
      dirtyTiles.clear(); // the snapshot supersedes the seeding marks

      const nextId = { value: 1 };
      const STEPS = 400;
      for (let step = 1; step <= STEPS; step++) {
        const shadow = cloneTrack(host);
        const acts = 1 + Math.floor(rng() * 3);
        for (let a = 0; a < acts; a++) {
          randomActions(rng, host, hostHarvesters, hostFactories, nextId);
        }
        if (step === 200) setupPhase = false; // the phase flag must travel too

        // The oracle: every tile whose VALUES changed…
        const oracle = new Set(diffTrack(shadow, host).map((c) => c.i));
        // …against the production path: drain the journal, publish.
        const decision = buildPublish(
          host,
          dirtyTiles,
          fields({
            t: step,
            seq: step,
            harvesters: hostHarvesters.map((h) => ({ ...h })),
            factories: hostFactories.map((f) => ({ ...f })),
            players: hostPlayers.map((p) => ({ ...p, res: { ...p.res } })),
            setupPhase,
            won: false,
          }),
        );
        expect(decision.kind).toBe("delta");
        if (decision.kind !== "delta") throw new Error("unreachable");
        const msg = decision.msg;
        expect(msg.seq).toBe(step);
        // …must be journalled (superset allowed, misses forbidden)…
        const sent = new Set(msg.tiles.map((c) => c.i));
        for (const i of oracle) {
          expect(sent.has(i)).toBe(true);
        }
        // …and must fit the frame, every single publish.
        expect(deltaBytes(msg)).toBeLessThanOrEqual(FRAME_CAP_BYTES);
        // Guest applies; lists replace whole.
        applyTrackDelta(guest, msg.tiles);
        guestHarvesters = msg.harvesters;
        guestFactories = msg.factories;
        guestPlayers = msg.players;
        guestSetupPhase = msg.setupPhase;

        if (step % 25 === 0 || step === STEPS) {
          expect(firstDiff(host, guest)).toBeNull();
          expect(guestHarvesters).toEqual(hostHarvesters);
          expect(guestFactories).toEqual(hostFactories);
          expect(guestPlayers).toEqual(hostPlayers);
          expect(guestSetupPhase).toBe(setupPhase);
        }
      }
    });
  }
});

// ── cap and size guard ─────────────────────────────────────────────────────

describe("MP-04 publish cap and size guard", () => {
  it(`flips to a snapshot beyond ${MAX_DELTA_TILES} tiles`, () => {
    const t = createTrack();
    dirtyTiles.markAll(Array.from({ length: 250 }, (_, k) => k * 10));
    const d = buildPublish(t, dirtyTiles, fields({ t: 1, seq: 1 }));
    expect(d.kind).toBe("snapshot");
    if (d.kind !== "snapshot") throw new Error("unreachable");
    expect(d.reason).toMatch(/too large/);
    // The drain already happened — the snapshot the caller now owes
    // supersedes it, so the journal must be empty, not double-sent.
    expect(dirtyTiles.size).toBe(0);
    const heartbeat = buildPublish(t, dirtyTiles, fields({ t: 2, seq: 2 }));
    expect(heartbeat.kind).toBe("delta");
    if (heartbeat.kind !== "delta") throw new Error("unreachable");
    expect(heartbeat.msg.tiles).toEqual([]);
  });

  it("an empty journal publishes a heartbeat delta", () => {
    const t = createTrack();
    const d = buildPublish(t, new DirtyTiles(), fields({ t: 9, seq: 41 }));
    expect(d.kind).toBe("delta");
    if (d.kind !== "delta") throw new Error("unreachable");
    expect(d.msg.t).toBe(9);
    expect(d.msg.seq).toBe(41);
    expect(d.msg.tiles).toEqual([]);
  });

  it("a worst-case capped delta still fits the frame", () => {
    // 200 tiles at maximum JSON width, plus plausibly-maximal lists.
    const msg = {
      type: "delta",
      t: 999999,
      seq: 999999,
      tiles: Array.from({ length: MAX_DELTA_TILES }, () => ({
        i: MAP_W * MAP_H - 1,
        dirt: 255,
        road: 255,
        owner: 255,
        upgraded: 255,
      })),
      harvesters: Array.from({ length: 40 }, (_, k) => ({
        id: k,
        owner: "player-one",
        ownerId: 1,
        tx: MAP_W - 1,
        ty: MAP_H - 1,
      })),
      factories: Array.from({ length: 6 }, () => ({
        owner: "player-one",
        ownerId: 1,
        tx: MAP_W - 1,
        ty: MAP_H - 1,
      })),
      players: [
        { id: "player-one", vp: 99.75, res: { wood: 999, stone: 999, grain: 999, oil: 999, ore: 999, gold: 999 } },
        { id: "player-two", vp: 99.75, res: { wood: 999, stone: 999, grain: 999, oil: 999, ore: 999, gold: 999 } },
      ],
      setupPhase: false,
      won: false,
    } as const;
    expect(deltaBytes(msg)).toBeLessThanOrEqual(FRAME_CAP_BYTES);
  });

  it("trips the snapshot fallback when the lists alone burst the frame", () => {
    const t = createTrack();
    const d = buildPublish(
      t,
      new DirtyTiles(),
      fields({
        t: 1,
        seq: 1,
        harvesters: Array.from({ length: 400 }, (_, k) => ({
          id: k,
          owner: "p1",
          ownerId: 1,
          tx: k % MAP_W,
          ty: k % MAP_H,
        })),
      }),
    );
    expect(d.kind).toBe("snapshot");
    if (d.kind !== "snapshot") throw new Error("unreachable");
    expect(d.reason).toMatch(/serializes to/);
  });

  it("PINNED FACT: a whole snapshot exceeds the frame — MP-05 must chunk it", () => {
    // Four base64 layers are 4 × 27,648 chars on ANY map content (empty or
    // saturated — the length is fixed), so this holds by construction, not by
    // luck. A `SnapshotMsg` can therefore never cross as one message within
    // the guaranteed frame: guest join/resync needs a chunked transfer, which
    // is MP-05's job alongside guest mode. If this ever FAILS (goes under),
    // the chunking requirement — and this comment — can be retired.
    const snap = buildSnapshot({
      seed: 1,
      track: createTrack(),
      harvesters: [],
      factories: [],
      setupPhase: true,
      won: false,
      players: [],
    });
    expect(snapshotBytes(snap)).toBeGreaterThan(FRAME_CAP_BYTES);
  });
});
