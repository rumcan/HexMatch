// @vitest-environment jsdom
//
// CONTINUE-01 (#191) — the save shelf the new Continue doors read from.
//
// These pin:
//   · which slots are offered (sandbox + each fresh story slot, nothing
//     stale and no story slot for a contract the campaign no longer ships);
//   · the dossier text ("vs AI (Normal) · 7★ vs 5★ · saved 2 h ago"),
//     including the ★ totals re-derived from the SAVED TRACK — VP is not in
//     the payload, so a summary that printed it from thin air would lie;
//   · the one write path (`discardSoloSave`): the sandbox clear also forgets
//     the difficulty pick, a contract clear never touches it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SAVE_KEY, SAVEGAME_VERSION, saveKeyFor, trackSave,
  type SaveGamePayload,
} from "../../src/iso/savegame-runtime";
import { SNAPSHOT_VERSION } from "../../src/iso/snapshot";
import { createTrack, PRESENT } from "../../src/iso/track";
import {
  describeSave, discardSoloSave, formatSavedAgo, mostRecentSave,
  resumableSaves, saveForMode, soloSaveKey,
} from "../../src/iso/save-summary";
import { SKILL_STORAGE_KEY } from "../../src/iso/skill";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const FRESH_WINDOW = 7 * DAY;

interface MakeOpts {
  key?: string;
  chapterId?: string | null;
  savedAt?: number;
  skillKey?: string;
  phase?: string;
  /** [you paved tiles, you extra plants, rival paved tiles]. */
  world?: { youPaved?: number; youPlants?: number; aiPaved?: number; youPlatforms?: number; aiPlatforms?: number };
}

/**
 * Stamp a throwaway track the same way game.ts would: owner 1 = you, 2 = ai,
 * and every scored tile carries dirt provenance + pavement + the upgrade
 * bit. The economy arrays bind those owner numbers to VP identities; extra
 * plants (id > 0) are worth a star each.
 */
function makeSave(now: number, opts: MakeOpts = {}): { key: string; payload: SaveGamePayload } {
  const key = opts.key ?? saveKeyFor(opts.chapterId ?? null);
  const track = createTrack();
  const pave = (from: number, n: number, ownerId: number) => {
    for (let k = 0; k < n; k++) {
      const i = from + k;
      track.dirt[i] = PRESENT;
      track.road[i] = PRESENT;
      track.upgraded[i] = PRESENT;
      track.owner[i] = ownerId;
    }
  };
  const w = opts.world ?? {};
  // you owns the first map row, ai the second — never the same tile twice.
  pave(0, w.youPaved ?? 20, 1);
  pave(64, w.aiPaved ?? 20, 2);
  const factories = [
    { owner: "you", ownerId: 1, tx: 5, ty: 5, id: 0, townId: 0 },
    { owner: "ai", ownerId: 2, tx: 20, ty: 20, id: 0, townId: 1 },
  ];
  for (let p = 0; p < (w.youPlants ?? 0); p++) {
    factories.push({ owner: "you", ownerId: 1, tx: 30 + p, ty: 30, id: p + 1, townId: null });
  }
  const payload: SaveGamePayload = {
    v: SAVEGAME_VERSION,
    snapV: SNAPSHOT_VERSION,
    savedAt: opts.savedAt ?? now - 2 * HOUR,
    seed: 1337,
    skillKey: opts.skillKey ?? "normal",
    phase: opts.phase ?? "play",
    winnerId: null,
    bandit: {},
    track: trackSave(track),
    eco: {
      harvesters: [
        { id: 1, owner: "you", ownerId: 1, tx: 6, ty: 5 },
        { id: 2, owner: "ai", ownerId: 2, tx: 21, ty: 20 },
      ],
      factories,
    },
    players: [],
    boards: [],
    clocks: {},
    // Railways v1: platforms are flat owner-scored records worth a star each.
    // RAIL-04's wire shape: the railway rides the payload's `rail` field and
    // its platforms/depots ride `structures` with a `kind` discriminator.
    ...((w.youPlatforms ?? w.aiPlatforms) ? {
      rail: {
        revision: 0, seq: 0,
        structures: [
          ...Array.from({ length: w.youPlatforms ?? 0 }, (_, i) => ({
            id: i, kind: "platform" as const, ownerId: 1, owner: "you",
            tx: i, ty: 40, w: 2, h: 1, view: "ne",
            anchor: { kind: "industry" as const, id: i, tiles: [] },
          })),
          ...Array.from({ length: w.aiPlatforms ?? 0 }, (_, i) => ({
            id: 100 + i, kind: "platform" as const, ownerId: 2, owner: "ai",
            tx: i, ty: 50, w: 2, h: 1, view: "ne",
            anchor: { kind: "industry" as const, id: 100 + i, tiles: [] },
          })),
        ],
        lines: [],
        trains: [],
      },
    } : {}),
  };
  if (opts.phase === "won") {
    payload.phase = "won";
    payload.winnerId = "you";
  }
  return { key, payload };
}

const write = (key: string, payload: SaveGamePayload) =>
  localStorage.setItem(key, JSON.stringify(payload));

let now: number;
beforeEach(() => {
  localStorage.clear();
  now = 1_000_000_000_000; // fixed clock; savedAt deltas are what matter
});
afterEach(() => localStorage.clear());

describe("resumableSaves — the shelf", () => {
  it("is empty on a fresh machine", () => {
    expect(resumableSaves(now)).toEqual([]);
    expect(mostRecentSave(now)).toBeNull();
    expect(saveForMode(null, now)).toBeNull();
  });

  it("offers the sandbox slot, re-derived stars and all", () => {
    // 20 paved tiles = 5★, two extra plants = +2★ → 7★ vs 5★.
    const { key, payload } = makeSave(now, { world: { youPaved: 20, youPlants: 2, aiPaved: 20 } });
    write(key, payload);
    const [s] = resumableSaves(now);
    expect(s).toMatchObject({
      key: SAVE_KEY,
      chapterId: null,
      chapterName: null,
      skillKey: "normal",
      skillLabel: "Normal",
      youStars: 7,
      rivalStars: 5,
      finished: false,
    });
  });

  // ── L13 (#228): a save is scored by the table it was PLAYED under ────────
  it("scores a new-loop save on the new loop's table, not on its pavement", () => {
    // The same world, saved twice. On the shipped loop those 20 paved tiles
    // are 5★; under `?loop=new` pavement pays nothing at all, and the seat's
    // rungs and city tiers are what the dossier must count.
    const shipped = makeSave(now, { world: { youPaved: 20, aiPaved: 0 } });
    write(shipped.key, shipped.payload);
    expect(saveForMode(null, now)?.youStars).toBe(5);

    const loop = makeSave(now, { world: { youPaved: 20, aiPaved: 0 } });
    loop.payload.loop = true;
    // L1e carries the seat records; two rungs and one city tier is 2×1 + 1×2.
    loop.payload.players = [
      { purse: {}, freeTrack: 0, freeDepots: 0, depotTier: 2, townLevel: 1, townBonus: 0.6 },
      { purse: {}, freeTrack: 0, freeDepots: 0, depotTier: 0, townLevel: 0, townBonus: 0 },
    ];
    write(loop.key, loop.payload);
    const s = saveForMode(null, now);
    // 2 rungs (2★) + 1 city (2★) = 4★. The 20 paved tiles are worth nothing.
    expect(s?.youStars).toBe(4);
    expect(s?.rivalStars).toBe(0);
  });

  it("reads a new-loop save with no seat records as a fresh seat", () => {
    // A save written before L1e carried the seat rows: absence is zero, not a
    // crash and not the shipped loop's pavement score.
    const { key, payload } = makeSave(now, { world: { youPaved: 20, aiPaved: 20 } });
    payload.loop = true;
    write(key, payload);
    expect(saveForMode(null, now)).toMatchObject({ youStars: 0, rivalStars: 0 });
  });

  it("offers each fresh story slot with the contract name", () => {
    const a = makeSave(now, { chapterId: "inheritance", savedAt: now - HOUR, world: { youPaved: 4, aiPaved: 0 } });
    const b = makeSave(now, { chapterId: "black-gold", savedAt: now - 30 * MIN, world: { youPaved: 0, aiPaved: 28 } });
    write(a.key, a.payload);
    write(b.key, b.payload);
    const saves = resumableSaves(now);
    expect(saves.map((s) => s.chapterId)).toEqual(["inheritance", "black-gold"]);
    expect(saves[0].chapterName).toBe("First Day on the Job");
    expect(saves[1].chapterName).toBe("Black Gold");
    // 1★ vs 0★ for the first contract; the rival's 28 tiles = 7★ in the third
    expect(saves.map((s) => [s.youStars, s.rivalStars])).toEqual([[1, 0], [0, 7]]);
    // mode-scoped lookup sees exactly its own slot
    expect(saveForMode("black-gold", now)?.key).toBe(saveKeyFor("black-gold"));
    expect(saveForMode(null, now)).toBeNull();
  });

  it("picks the freshest slot across sandbox and story for the front door", () => {
    const old = makeSave(now, { savedAt: now - 3 * HOUR });
    const fresh = makeSave(now, { chapterId: "toll-king", savedAt: now - 10 * MIN });
    write(old.key, old.payload);
    write(fresh.key, fresh.payload);
    expect(mostRecentSave(now)?.chapterId).toBe("toll-king");
  });

  it("ignores saves older than the boot's own freshness window", () => {
    const { key, payload } = makeSave(now, { savedAt: now - FRESH_WINDOW - HOUR });
    write(key, payload);
    expect(resumableSaves(now)).toEqual([]);
    // a save right inside the window still counts
    const edge = makeSave(now, { savedAt: now - FRESH_WINDOW + MIN });
    write(edge.key, edge.payload);
    expect(resumableSaves(now)).toHaveLength(1);
  });

  it("skips a story slot whose contract no longer exists", () => {
    const ghost = makeSave(now, { key: saveKeyFor("contract-from-the-cutting-room") });
    write(ghost.key, ghost.payload);
    expect(resumableSaves(now)).toEqual([]);
  });

  it("survives a corrupt track layer without dropping the door", () => {
    const { key, payload } = makeSave(now);
    // Three bytes too long for the dirt layer: trackRestored's typed-array
    // `.set()` throws, and the summary must fail closed to zero stars.
    payload.track.dirt = `${payload.track.dirt}AAAA`;
    write(key, payload);
    const [s] = resumableSaves(now);
    expect(s.youStars).toBe(0);
    expect(s.rivalStars).toBe(0);
  });

  it("counts rail platforms (Railways v1) in the star totals", () => {
    // 20 paves = 5★, one platform = +1★ → you 6★; the rival's two platforms
    // sit on zero paves, so its total is exactly 2★.
    const { key, payload } = makeSave(now, {
      world: { youPaved: 20, youPlatforms: 1, aiPaved: 0, aiPlatforms: 2 },
    });
    write(key, payload);
    const s = mostRecentSave(now)!;
    expect([s.youStars, s.rivalStars]).toEqual([6, 2]);
  });

  it("marks a decided match as finished with the winner named", () => {
    const { key, payload } = makeSave(now, { phase: "won", world: { youPaved: 40 } });
    write(key, payload);
    const s = mostRecentSave(now)!;
    expect(s.finished).toBe(true);
    expect(s.winnerId).toBe("you");
  });
});

describe("describeSave — the button's second line", () => {
  it("names the sandbox mode, difficulty, score and age", () => {
    const { key, payload } = makeSave(now, {
      skillKey: "hard", savedAt: now - 2 * HOUR,
      world: { youPaved: 28, youPlants: 0, aiPaved: 20 },
    });
    write(key, payload);
    expect(describeSave(mostRecentSave(now)!, now))
      .toBe("vs AI (Hard) · 7★ vs 5★ · saved 2 h ago");
  });

  it("names a contract instead of a difficulty", () => {
    const { key, payload } = makeSave(now, {
      chapterId: "stone-thunder", savedAt: now - 5 * MIN,
    });
    write(key, payload);
    expect(describeSave(mostRecentSave(now)!, now))
      .toBe("Stone & Thunder · 5★ vs 5★ · saved 5 min ago");
  });

  it("prints a final score for a decided match", () => {
    const { key, payload } = makeSave(now, { phase: "won", savedAt: now - DAY });
    write(key, payload);
    expect(describeSave(mostRecentSave(now)!, now))
      .toBe("vs AI (Normal) · final 5★ vs 5★ · saved 1 d ago");
  });

  it("formats compact ages", () => {
    expect(formatSavedAgo(now, now)).toBe("just now");
    expect(formatSavedAgo(now - 30 * 1000, now)).toBe("just now");
    expect(formatSavedAgo(now - MIN, now)).toBe("1 min ago");
    expect(formatSavedAgo(now - 45 * MIN, now)).toBe("45 min ago");
    expect(formatSavedAgo(now - 3 * HOUR, now)).toBe("3 h ago");
    expect(formatSavedAgo(now - 2 * DAY, now)).toBe("2 d ago");
  });
});

describe("discardSoloSave — the deliberate new game", () => {
  it("clears the sandbox slot and the difficulty pick", () => {
    const { key, payload } = makeSave(now);
    write(key, payload);
    localStorage.setItem(SKILL_STORAGE_KEY, "hard");
    discardSoloSave(null);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
    expect(localStorage.getItem(SKILL_STORAGE_KEY)).toBeNull();
  });

  it("clears one contract slot and leaves the difficulty pick alone", () => {
    const a = makeSave(now, { chapterId: "inheritance" });
    const b = makeSave(now, { chapterId: "black-gold" });
    write(a.key, a.payload);
    write(b.key, b.payload);
    localStorage.setItem(SKILL_STORAGE_KEY, "hard");
    discardSoloSave("inheritance");
    expect(localStorage.getItem(a.key)).toBeNull();
    // the other contract, the sandbox convention and the pick all survive
    expect(localStorage.getItem(b.key)).not.toBeNull();
    expect(localStorage.getItem(SKILL_STORAGE_KEY)).toBe("hard");
  });

  it("makes the slot disappear from the shelf immediately", () => {
    const { key, payload } = makeSave(now, { chapterId: "toll-king" });
    write(key, payload);
    expect(resumableSaves(now)).toHaveLength(1);
    discardSoloSave("toll-king");
    expect(resumableSaves(now)).toEqual([]);
    expect(soloSaveKey("toll-king")).toBe(saveKeyFor("toll-king"));
  });
});
