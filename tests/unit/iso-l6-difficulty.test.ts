// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// L6 (#220) — Difficulty: decay as the axis (Easy / Normal / Hard).
//
// The ticket's whole argument is that the three difficulties are ONE codepath
// with different numbers, so this file proves that and nothing else:
//
//   • the table — one row per difficulty, `matchEnabled` true in all three
//     (match-3 STAYS on Easy: the change from the original brief), and the
//     picker's sentence for each row says what that row's flags actually do;
//   • the rules, pure — the floor a session maps onto, the settle clamp that
//     makes Easy/Normal monotone and Hard not, one cooling step of decay, and
//     the single `retuneOwed` predicate that decides whether a re-match exists;
//   • one live game, three rows — the difficulty flipped through the live
//     setting while the SAME clock, plate and settle answer differently: Easy
//     generous and frozen, Normal climbing only and owed one session per
//     upgrade, Hard cooling on the tick with a re-match that can cost you. That
//     is the acceptance's "proven by a unit test that toggles the flags";
//   • the level and the spent credit ride the wire and the save, so a guest and
//     a resumed game agree with the host about what a Depot is worth;
//   • the shipped loop is untouched while the flag is dev-only.
//
// The `test:slow` economy sweeps stay the backstop for the decay RATE; this
// file pins the RULES.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WATER, type Grid, type Industry } from "../../src/iso/grid";
import {
  MAP_W, MAP_H, TUNING, DIFFICULTY_RULES, DEFAULT_DIFFICULTY,
  type DifficultyKey, type DifficultyRules,
} from "../../src/iso/config";
import { buildTile, createTrack, type Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import { RIVAL_SKILLS, SKILL_KEYS } from "../../src/iso/skill";
import {
  abandonYieldFor, birthYieldFor, clampYield, createTuningSession, decayYield,
  difficultyRulesFor, recordTuningCleared, retuneOwed, settleTuningYield,
  TUNING_ABANDON_YIELD, tuningSessionYield, tuningYieldFor,
} from "../../src/iso/tuning";
import { transportTierOf, TRANSPORT_TIERS } from "../../src/iso/loop";
import { buildSnapshot, applySnapshot, SNAPSHOT_VERSION, type SnapshotSource } from "../../src/iso/snapshot";
import {
  SAVE_KEY, SAVEGAME_VERSION, readSave, type SaveGamePayload,
} from "../../src/iso/savegame-runtime";
import { depotCargo, type EconomyState, type Harvester } from "../../src/iso/economy";

// ── stub the art imports (vite handles these in the browser) ──────────────
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
      }
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") {
        return () => ({ addColorStop: () => undefined });
      }
      return () => undefined;
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
}

function stubImage() {
  class FakeImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
}

/** The slice of `window.__iso` this file drives. */
interface DifficultyHook {
  readonly newLoop: boolean;
  grid: Grid;
  track: Track;
  eco: EconomyState;
  purse: Record<string, number>;
  board: { onClear(n: number, chain: number): void; busy: boolean };
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  demolish: (tx: number, ty: number) => void;
  /** The L1b clock — the income pass AND L6's cooling pass — on a now. */
  econTick: (now?: number) => void;
  setRivalSkill: (key: DifficultyKey) => void;
  /** The live difficulty's ECONOMY flags: its row of `DIFFICULTY_RULES`. */
  readonly difficulty: DifficultyRules & { key: DifficultyKey; label: string };
  readonly depotYields: {
    id: number; owner: string; tx: number; ty: number;
    yield: number | null; tuneTier: number | null; tier: number;
  }[];
  readonly tuning: { depotId: number; yield: number; yieldFloor: number } | null;
  tuningFinish: (abandon?: boolean) => void;
  /** The plate's Retune key, and the offer that puts it on screen. */
  retuneDepot: (depotId?: number) => boolean;
  retuneOffer: () => { depotId: number; cargo: string | null; yield: number; risks: boolean } | null;
  depotTier: (depotId: number) => number | null;
}

const hook = () => (window as unknown as { __iso: DifficultyHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

const plate = () => root.querySelector("#iso-tuning") as HTMLElement;
const retuneBtn = () => root.querySelector("#iso-tuning-retune") as HTMLButtonElement;
const hidden = (el: HTMLElement | null) => !el || el.classList.contains("hidden");

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.removeItem(SAVE_KEY);
  localStorage.setItem("hexmatch:rival-skill", "normal");
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(1337));
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  vi.restoreAllMocks();
});

async function boot(opts: { newLoop?: boolean } = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

// ── the live map's own Depot sites (the shape iso-l4-tuning.test.ts uses) ──
interface Site { hx: number; hy: number; fy: number; ind: Industry }

function depotSite(grid: Grid, skipId?: number): Site | null {
  for (const ind of grid.industries) {
    if (skipId !== undefined && ind.id === skipId) continue;
    for (let x = ind.tx; x < ind.tx + ind.w; x++) {
      const hx = x, hy = ind.ty + ind.h;
      const fy = hy + 6;
      if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
      let ok = true;
      for (let y = hy; y <= fy; y++) {
        const i = y * MAP_W + hx;
        if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
      }
      if (ok) return { hx, hy, fy, ind };
    }
  }
  return null;
}

/**
 * A Factory at the corridor's far end and the PAVED run that joins it — the
 * tier a player PAYS for, which is what L6 counts as "this Depot was upgraded".
 * Then one harmless gravel tile laid and torn up: `demolish` runs the game's
 * own rescore, which is what drops the network caches the tier is read through
 * (the same trick `iso-game.test.ts` uses to make raw track writes visible).
 */
function connect(h: DifficultyHook, site: Site) {
  h.eco.factories.push({ owner: "you", ownerId: 1, tx: site.hx, ty: site.fy, id: 0, townId: null });
  for (let y = site.hy + 1; y < site.fy; y++) buildTile(h.track, "road", site.hx, y, 1);
  buildTile(h.track, "dirt", site.hx, site.fy + 1, 1);
  h.demolish(site.hx, site.fy + 1);
}

/** n economy ticks on the clock's own cadence, from `from`. Returns the end. */
function ticks(h: DifficultyHook, from: number, n: number): number {
  for (let i = 1; i <= n; i++) h.econTick(from + i * 3_000);
  return from + n * 3_000;
}

const rules = (key: DifficultyKey): DifficultyRules => DIFFICULTY_RULES[key];
const levelOf = (h: DifficultyHook, id: number): number | null =>
  h.depotYields.find((d) => d.id === id)!.yield;
const recOf = (h: DifficultyHook, id: number) => h.depotYields.find((d) => d.id === id)!;

// ══════════════════════════════════════════════════════════════════════════
describe("L6 the table: one setting, flags and not forks", () => {
  it("has exactly one row per difficulty, and match-3 is on in every one", () => {
    expect(Object.keys(DIFFICULTY_RULES)).toEqual(SKILL_KEYS);
    expect(difficultyRulesFor(DEFAULT_DIFFICULTY)).toBe(DIFFICULTY_RULES.normal);
    // A key the table has never heard of falls back to the shipped row, so no
    // caller can be handed `undefined` and read `decayRate` off it.
    expect(difficultyRulesFor("impossible" as DifficultyKey)).toBe(DIFFICULTY_RULES.normal);
    for (const key of SKILL_KEYS) {
      // THE headline of the ticket: difficulty changes the decay, never whether
      // match-3 exists. `matchEnabled` stays a flag (tests, future modes) and no
      // row turns it off.
      expect(rules(key).matchEnabled, `${key} keeps the tuning session`).toBe(true);
      expect(rules(key).minYield).toBeGreaterThanOrEqual(TUNING.minYield);
      expect(rules(key).minYield).toBeLessThan(TUNING.maxYield);
      expect(rules(key).decayRate).toBeGreaterThanOrEqual(0);
    }
    // the axis itself
    expect(rules("easy").decayRate).toBe(0);
    expect(rules("normal").decayRate).toBe(0);
    expect(rules("hard").decayRate).toBeGreaterThan(0);
    expect(rules("hard").decayRate, "a game-length cool, not a blink").toBeLessThan(0.2);
    // Easy is the generous row, and Easy and Normal are the monotone ones
    expect(rules("easy").minYield).toBeGreaterThan(TUNING.minYield);
    expect(rules("normal").minYield).toBe(TUNING.minYield);
    expect(rules("hard").minYield).toBe(TUNING.minYield);
    expect(rules("easy").yieldNeverDrops).toBe(true);
    expect(rules("normal").yieldNeverDrops).toBe(true);
    expect(rules("hard").yieldNeverDrops).toBe(false);
    // …and the re-match policy that splits "never dragged back" from "go again"
    expect(rules("easy").rematch).toBe("never");
    expect(rules("normal").rematch).toBe("upgrade");
    expect(rules("hard").rematch).toBe("open");
  });

  it("promises, in the picker's own words, what the flags do", () => {
    // ONE difficulty setting drives the rival AND these economy flags, so its
    // row is the only place the player is told what the economy half does. If
    // the sentence ever drifts from the numbers, this fails.
    for (const key of SKILL_KEYS) {
      const line = RIVAL_SKILLS[key].economyLine;
      expect(line.length, `${key} states its economy rule`).toBeGreaterThan(20);
      const r = rules(key);
      if (r.decayRate === 0) expect(line, `${key} promises no decay`).not.toMatch(/cool|decay/i);
      else expect(line).toMatch(/cool|decay/i);
      if (r.rematch === "never") expect(line, `${key} promises no re-match`).not.toMatch(/re-tune|upgrade/i);
      if (r.yieldNeverDrops) expect(line, `${key} promises no loss`).not.toMatch(/can cost/i);
      else expect(line).toMatch(/cost/i);
    }
    expect(RIVAL_SKILLS.easy.economyLine).toMatch(/Match-3 still opens/i);
    expect(RIVAL_SKILLS.normal.economyLine).toMatch(/never drops/i);
    expect(RIVAL_SKILLS.hard.economyLine).toMatch(/re-tune it any time/i);
  });

  it("counts an upgrade in the tiers you pay for, not the dirt you were given", () => {
    expect(TRANSPORT_TIERS).toEqual(["base", "paved"]);
    // L2 (#216) made dirt free: connecting a Depot on gravel is not an upgrade,
    // so it must never be worth a re-tune credit. The pave is.
    expect(transportTierOf(null)).toBe(0);
    expect(transportTierOf("dirt")).toBe(0);
    expect(transportTierOf("road")).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L6 the rules, pure", () => {
  it("maps a score onto the difficulty's own floor", () => {
    expect(tuningYieldFor(0)).toBe(TUNING.minYield);                        // shipped default
    expect(tuningYieldFor(0, rules("easy").minYield)).toBe(1.5);             // Easy: nothing cleared still lands well
    expect(tuningYieldFor(0, rules("hard").minYield)).toBe(TUNING.minYield);
    expect(tuningYieldFor(TUNING.targetScore, rules("easy").minYield)).toBe(TUNING.maxYield);
    expect(tuningYieldFor(TUNING.targetScore)).toBe(TUNING.maxYield);
    // A weak session is worth MORE on Easy than the same session on Hard,
    // because the floor is raised and the range is squeezed from below.
    const weak = 12;
    expect(tuningYieldFor(weak, rules("easy").minYield))
      .toBeGreaterThan(tuningYieldFor(weak, rules("hard").minYield));
    // …and abandoning pays that same floor, so ✕ on Easy is not a punishment.
    expect(abandonYieldFor(rules("easy"))).toBe(1.5);
    expect(abandonYieldFor(rules("normal"))).toBe(TUNING_ABANDON_YIELD);
    expect(birthYieldFor(rules("easy"))).toBe(abandonYieldFor(rules("easy")));
    // The clamp is deliberately NOT the difficulty's: a level arriving from
    // another game is sanitised against the shipped range, never rewritten.
    expect(clampYield(0.2)).toBe(TUNING.minYield);
    expect(clampYield(99)).toBe(TUNING.maxYield);
  });

  it("settles so Easy and Normal can only climb, and Hard can lose", () => {
    const s = createTuningSession(1, "ore");
    recordTuningCleared(s, TUNING.targetScore);
    expect(tuningSessionYield(s, rules("easy").minYield)).toBe(TUNING.maxYield);

    // A Depot already at ×2.0, then played badly (score 0).
    expect(settleTuningYield(2, 0, rules("easy"))).toBe(2);
    expect(settleTuningYield(2, 0, rules("normal"))).toBe(2);
    expect(settleTuningYield(2, 0, rules("hard"))).toBe(TUNING.minYield);
    // The same clamp covers a Depot BORN above the line (Easy's 1.5) and then
    // abandoned on purpose: it stays where it was.
    expect(settleTuningYield(1.5, 0, rules("easy"), { abandon: true })).toBe(1.5);
    expect(settleTuningYield(1.5, 0, rules("hard"), { abandon: true })).toBe(TUNING.minYield);
    // First session ever, on a Depot at its birth level: the clamp is a no-op
    // on the way up.
    expect(settleTuningYield(undefined, TUNING.targetScore, rules("normal")))
      .toBe(TUNING.maxYield);
  });

  it("cools a yield on one row and not the other two — same function", () => {
    expect(decayYield(2.5, rules("easy"))).toBeNull();
    expect(decayYield(2.5, rules("normal"))).toBeNull();
    const first = decayYield(2.5, rules("hard"));
    expect(first).not.toBeNull();
    expect(first!).toBeLessThan(2.5);
    expect(first!).toBeGreaterThan(1);

    // The whole cool, run as the clock runs it: monotone, and it STOPS at the
    // floor — decay is a cool, not a slow death of the Depot.
    let y = 2.5, n = 0;
    for (;;) {
      const next = decayYield(y, rules("hard"));
      if (next === null) break;
      expect(next).toBeLessThan(y);
      y = next;
      if (++n > 10_000) throw new Error("decay never settled");
    }
    expect(y).toBe(rules("hard").minYield);
    expect(n, "a cool that takes minutes of play, not one tick").toBeGreaterThan(20);
    expect(n).toBeLessThan(400);

    // Nothing to lose, or nothing stored: at the floor, or never tuned.
    expect(decayYield(TUNING.minYield, rules("hard"))).toBeNull();
    expect(decayYield(undefined, rules("hard"))).toBeNull();
    // A row is just numbers: a steeper rate is fewer ticks, and the same call
    // with the flag down is a no-op — which is the "one codepath" claim.
    expect(decayYield(2.5, { ...rules("hard"), decayRate: 0.5 })).toBeCloseTo(1.75, 2);
    expect(decayYield(2.5, { ...rules("hard"), decayRate: 0 })).toBeNull();
  });

  it("decides 'may I re-match' from the flags, in one predicate", () => {
    const tunedUnpaved = { tier: 0, tuneTier: 0 };        // settled while unconnected
    const paved = { tier: 1, tuneTier: 0 };               // …and then paved
    const untuned = { tier: 1, tuneTier: undefined };     // never had a session
    expect(retuneOwed(rules("easy"), paved)).toBe(false);          // no forced return
    expect(retuneOwed(rules("normal"), tunedUnpaved)).toBe(false); // one per Depot…
    expect(retuneOwed(rules("normal"), paved)).toBe(true);         // …plus one per upgrade
    expect(retuneOwed(rules("normal"), untuned)).toBe(false);
    expect(retuneOwed(rules("hard"), tunedUnpaved)).toBe(true);    // always open
    expect(retuneOwed(rules("hard"), paved)).toBe(true);
    // `matchEnabled` outranks the policy, so a mode with the board off has no
    // re-match either — the flag is honoured, not decorative.
    expect(retuneOwed({ ...rules("hard"), matchEnabled: false }, paved)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L6 one live game, three rows", () => {
  it("Easy: the session opens, a weak one still yields, and nothing cools", async () => {
    const h = await boot({ newLoop: true });
    h.setRivalSkill("easy");
    expect(h.difficulty.decayRate).toBe(0);
    expect(h.difficulty.minYield).toBe(1.5);
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    // Match-3 STILL opens on Easy — the headline change from the old brief.
    expect(h.tuning, "the board is up for the build session").not.toBeNull();
    const id = h.tuning!.depotId;
    expect(h.tuning!.yieldFloor, "the plate maps on Easy's raised floor").toBe(1.5);
    // …and it is played badly on purpose: not one gem cleared.
    h.tuningFinish(false);
    await settle();
    expect(levelOf(h, id), "a session that cleared nothing still lands the raised floor")
      .toBe(rules("easy").minYield);

    // 60 ticks of clock — three minutes of play — and the level is untouched.
    ticks(h, performance.now(), 60);
    expect(levelOf(h, id)).toBe(1.5);
    // And Easy never drags anybody back to the board: no offer, no key.
    expect(h.retuneOffer()).toBeNull();
    expect(h.retuneDepot()).toBe(false);
    expect(hidden(retuneBtn()), "the plate shows no Retune key").toBe(true);
  });

  it("Normal: the yield never drops, and the next session is owed per upgrade", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    const id = h.tuning!.depotId;
    expect(recOf(h, id).tuneTier, "no session has settled yet").toBeNull();
    h.board.onClear(20, 1);                      // a mediocre session
    h.tuningFinish(false);
    await settle();
    const after = levelOf(h, id)!;
    expect(after).toBe(tuningYieldFor(20));
    expect(recOf(h, id).tuneTier, "the credit was spent at tier 0").toBe(0);

    // Nothing owed while the Depot stands where it was tuned…
    expect(h.retuneOffer()).toBeNull();
    expect(hidden(retuneBtn())).toBe(true);
    // …and no decay moves it, however long the game runs.
    ticks(h, performance.now(), 120);
    expect(levelOf(h, id)).toBe(after);

    // Pave the link: exactly one more session, and it is clamped upward.
    connect(h, site);
    await settle();                 // let a frame paint the plate from the new scan
    expect(h.depotTier(id)).toBe(1);
    const offer = h.retuneOffer();
    expect(offer?.depotId).toBe(id);
    expect(offer?.risks, "Normal never risks the level you already hold").toBe(false);
    expect(hidden(retuneBtn()), "the plate shows the key").toBe(false);
    expect(h.retuneDepot()).toBe(true);
    await settle();
    expect(h.tuning, "the re-tune opened a session").not.toBeNull();
    h.tuningFinish(false);                       // played terribly, on purpose
    await settle();
    expect(levelOf(h, id), "a worse session cannot lower it").toBe(after);
    expect(recOf(h, id).tuneTier).toBe(1);
    expect(h.retuneOffer(), "one session per upgrade, not one per frame").toBeNull();
  });

  it("Hard: the level cools on the clock, and the re-match is a real risk", async () => {
    const h = await boot({ newLoop: true });
    h.setRivalSkill("hard");
    expect(h.difficulty.decayRate).toBeGreaterThan(0);
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    const id = h.tuning!.depotId;
    connect(h, site);
    // Play it well: the full multiplier, on a Depot whose cargo the clock pays.
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);
    await settle();
    expect(levelOf(h, id)).toBe(TUNING.maxYield);

    // Income at the fresh level, then the same Depot after the clock has been
    // shaving it. Same loop, same factors, same purse — the only thing that
    // moved is the yield the row says is not permanent.
    // L16 (#231): the storage cap drops income above it, so a window that
    // lets the store fill measures the cap, not the yield (this Depot fills
    // its 24-grain store inside 18 ticks and a second 20-tick window would
    // earn nothing at all). The store is spent down before every tick — the
    // spending a real player does across a match, tick-sized — and the window
    // sums what each tick pays into the freed headroom, so what it measures
    // is exactly the per-tick pay the yield sets.
    const paid = (n: number, from: number): [number, number] => {
      const cargo = depotCargo(h.eco, recOf(h, id)) ?? "grain";
      let sum = 0;
      let now = from;
      for (let i = 0; i < n; i++) {
        h.purse[cargo] = 0;
        h.econTick(now += 3_000);
        sum += h.purse[cargo] ?? 0;
      }
      return [sum, now];
    };
    const t0 = performance.now();
    const [fresh, t1] = paid(20, t0);
    expect(fresh, "a connected, well-tuned Depot pays").toBeGreaterThan(0);
    const cooledTo = levelOf(h, id)!;
    expect(cooledTo, "and the tick has already been cooling it").toBeLessThan(TUNING.maxYield);
    const [cooled] = paid(20, t1);
    expect(cooled, "the cooled Depot pays less than the fresh one").toBeLessThan(fresh);
    expect(cooled).toBeGreaterThan(0);
    expect(levelOf(h, id)!).toBeLessThan(cooledTo);

    // The invite is open on Hard with no upgrade at all, and it goes to the
    // LOWEST-yield Depot — which is what "invites a re-match" means here.
    const offer = h.retuneOffer();
    expect(offer?.depotId).toBe(id);
    expect(offer?.risks, "Hard says out loud that a bad round bites").toBe(true);
    expect(hidden(retuneBtn()), "the plate shows the key").toBe(false);
    expect(retuneBtn().textContent).toMatch(/Retune/i);

    // Take the invite, play it badly: on Hard that costs the level for real.
    expect(h.retuneDepot()).toBe(true);
    await settle();
    h.tuningFinish(false);
    await settle();
    expect(levelOf(h, id), "a bad re-match lowers a Hard Depot").toBe(rules("hard").minYield);
    expect(levelOf(h, id)!).toBeLessThan(cooledTo);
  });

  it("reads the flags live, so switching moves the rules and not the save", async () => {
    const h = await boot({ newLoop: true });
    h.finishSetup();
    const site = depotSite(h.grid)!;
    expect(h.placeDepot(site.hx, site.hy)).toBe(true);
    await settle();
    const id = h.tuning!.depotId;
    h.board.onClear(TUNING.targetScore, 1);
    h.tuningFinish(false);
    await settle();
    const base = levelOf(h, id)!;
    expect(base).toBe(TUNING.maxYield);

    let t = performance.now();
    // Normal freezes it…
    t = ticks(h, t, 40);
    expect(levelOf(h, id)).toBe(base);
    // …and on Hard the SAME Depot is subject to the cooling pass: no reboot, no
    // re-placement, nothing but the row the clock reads this tick.
    h.setRivalSkill("hard");
    t = ticks(h, t, 40);
    const cooledNow = levelOf(h, id)!;
    expect(cooledNow, "Hard cools what Normal froze").toBeLessThan(base);
    // Switching back stops the cool where it got to — the level on the record is
    // the level that pays, and no difficulty claws it up or down.
    h.setRivalSkill("normal");
    ticks(h, t, 40);
    expect(levelOf(h, id)).toBe(cooledNow);
    expect(h.retuneOffer(), "a difficulty switch owes nobody a session").toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L6 the level and the credit travel", () => {
  it("rides the wire with the depot, and a malformed tier is refused", () => {
    const src: SnapshotSource = {
      seed: 1337,
      track: createTrack(),
      harvesters: [
        { id: 1, owner: "p1", ownerId: 1, tx: 6, ty: 11, yield: 1.7, tuneTier: 1 },
        { id: 2, owner: "p2", ownerId: 2, tx: 13, ty: 9 },
      ],
      factories: [{ owner: "p1", ownerId: 1, tx: 30, ty: 11 }],
      setupPhase: false, won: false,
      players: [{ id: "p1", vp: 0, res: {} }, { id: "p2", vp: 0, res: {} }],
      t: 0,
    };
    const snap = buildSnapshot(src);
    expect(snap.harvesters[0].yield).toBe(1.7);
    expect(snap.harvesters[0].tuneTier).toBe(1);
    // A Depot on the old loop sends neither field, so those bytes are unchanged.
    expect("tuneTier" in snap.harvesters[1]).toBe(false);
    const applied = applySnapshot(snap);
    expect(applied.harvesters[0].yield).toBe(1.7);
    expect(applied.harvesters[0].tuneTier).toBe(1);
    expect(applied.harvesters[1].tuneTier).toBeUndefined();
    const bad = { ...snap, harvesters: [{ ...snap.harvesters[0], tuneTier: "owed" }] };
    expect(() => applySnapshot(bad)).toThrow(/malformed/i);
  });

  it("is written to the save slot with the rest of the Depot record", () => {
    // The autosave stores `eco.harvesters` as the live record type, so the cooled
    // level AND the spent credit survive with no field list to keep in sync.
    const payload: Partial<SaveGamePayload> = {
      // The LIVE versions: `readSave` refuses a save whose map version is not
      // the running one (v15 moved the seeded map to 4×4 resource lots), so a
      // stale literal here would test the refusal and nothing else.
      v: SAVEGAME_VERSION, snapV: SNAPSHOT_VERSION,
      savedAt: Date.now(), seed: 1337, skillKey: "hard",
      phase: "play", winnerId: null, bandit: {},
      track: { dirt: "", road: "", owner: "", upgraded: "" },
      eco: {
        harvesters: [{ id: 1, owner: "you", ownerId: 1, tx: 6, ty: 11, yield: 1.37, tuneTier: 1 }],
        factories: [],
      },
      players: [{ purse: {}, freeTrack: 0, freeDepots: 0 }],
      boards: [], clocks: {},
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    const back = readSave()!.eco.harvesters[0] as Harvester;
    expect(back.yield).toBe(1.37);
    expect(back.tuneTier).toBe(1);
  });

  it("lets a guest see the host's cooling: the same snapshot rule both seats read", () => {
    // The host's decay writes `depot.yield`, and `buildSnapshot` forwards whatever
    // the record holds — so a guest applying a snapshot taken after 40 cooling
    // ticks computes the SAME (already-clamped) income multiplier the host paid.
    // This is the divergence #220 would otherwise introduce on Hard.
    const host: Harvester = { id: 1, owner: "p1", ownerId: 1, tx: 6, ty: 11, yield: 2.5, tuneTier: 0 };
    for (let i = 0; i < 40; i++) {
      const cooled = decayYield(host.yield, rules("hard"));
      if (cooled !== null) host.yield = cooled;
    }
    const snap = buildSnapshot({
      seed: 1, track: createTrack(), harvesters: [host], factories: [],
      setupPhase: false, won: false, players: [{ id: "p1", vp: 0, res: {} }], t: 0,
    });
    const guest = applySnapshot(snap).harvesters[0];
    expect(guest.yield).toBe(host.yield);
    expect(guest.tuneTier).toBe(0);
    expect(host.yield!).toBeLessThan(2.5);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("L6 the shipped loop is untouched", () => {
  it("pays nothing, cools nothing and offers nothing while the flag is down", async () => {
    const h = await boot();
    expect(h.newLoop).toBe(false);
    expect(h.tuning).toBeNull();
    expect(hidden(plate()), "the plate is not part of the shipped loop").toBe(true);
    expect(hidden(retuneBtn()), "and neither is the re-match key").toBe(true);
    expect(h.retuneOffer()).toBeNull();
    expect(h.retuneDepot()).toBe(false);

    // A Depot holding a yield on the OLD loop stays exactly where it was on
    // every difficulty: the cooling pass lives in the new loop's clock, and the
    // shipped game has no idea a difficulty table exists.
    h.finishSetup();
    for (const key of SKILL_KEYS) {
      h.setRivalSkill(key as DifficultyKey);
      h.eco.harvesters.push({ id: 77, owner: "you", ownerId: 1, tx: 8, ty: 8, yield: 2.5 });
      ticks(h, performance.now(), 60);
      const d = h.eco.harvesters.find((x) => x.id === 77)!;
      expect(d.yield, `${key} on the old loop`).toBe(2.5);
      expect(d.tuneTier).toBeUndefined();
    }
  });
});
