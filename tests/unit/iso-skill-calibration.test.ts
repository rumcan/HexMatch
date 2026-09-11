// ══════════════════════════════════════════════════════════════════════════
// AI-01 — how hard is a difficulty preset, MEASURED: two AI seats racing.
//
// The difficulty presets in `src/iso/skill.ts` are numbers, and numbers chosen
// by feel rot. This file is the measurement the presets were set BY, and the
// way they have to stay honest afterwards: **two AI seats play each other
// through the same simulator the VP-01 race uses
// (`tests/unit/helpers/race.ts`), and the speed at which each seat reaches
// the win points — the per-seat times to 1★, 5★ and 10★ — is how hard the
// rival is.**
//
// Three seat truths the assertions have to respect, all measured on the way
// here (see docs/playtest-reports/2026-09-10-ai-skills.md):
//
//   * the two chairs are NOT symmetric. Seat 1 opens farthest-from-center,
//     seat 2 farthest-from-seat-1 — the live game's own factory rule — and on
//     a real map those two lanes can differ a lot, as much as the skill
//     presets themselves. So a single "hard beats easy" race proves nothing:
//     the signal is the MIRROR times (skill vs identical twin, per chair) and
//     the POOLED head-to-head (each preset plays both chairs), never one
//     pairing;
//   * every preset must still be a GAME. The easy rival finishes its own
//     mirror inside a session with the loser of that mirror still racing —
//     an easy chair the player can catch, not a spectator seat.
//   * the 10★ line lands mid-opening, where every preset moves together.
//     The sim's seats live on trickle + bank income with no match-3 board,
//     so extra build turns and bigger pave batches don't convert until the
//     engine phase — on 1337 all three mirrors cross 10★ on the SAME tick
//     (947s), and even a full 36m window ends pooled 74.5/77.5/74.5★. The
//     old 20★ line separated them (25.3/25.4/26.1m on 1337 — already a
//     photo finish, down from the AI-01 report's 9.9/10.1/17.6m); at 10★
//     strict ordering would assert noise. The live difference a player
//     feels is the clocks (pinned below), the raid cadence, and Blockades.
//
// Two things this pins, in order of importance:
//
//   1. mirror matches end: EVERY preset reaches 10★ inside the window against
//      an identical twin, and the trailer was still playing (≥ half the win);
//   2. the ladder never inverts: at the 10★ line the mirrors end in the same
//      breath (see the third seat truth), so the sim asserts hard ≤ normal ≤
//      easy on finishing time and hard ≥ easy pooled over both chairs —
//      guards that catch an INVERTED ladder, not a photo finish — while hard
//      still wins the chair-1 race outright.
//
// Runtime is three mirrors + two head-to-heads per seed; each race breaks on
// the first 10★. Default one seed keeps the suite inside a few minutes; the
// playtest-report spread:
//
//   AI_RACE_SEEDS=1337,7,42 AI_RACE_MINUTES=40 npx vitest run tests/unit/iso-skill-calibration.test.ts
//
// The printed table it produces is the one quoted in
// `docs/playtest-reports/2026-09-10-ai-skills.md`.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { VP_TARGET } from "../../src/iso/config";
import { RIVAL_SKILLS, type SkillKey } from "../../src/iso/skill";
import { victoryBreakdown } from "../../src/iso/victory";
import {
  runRace, pacePerMinute, countTier, MIN, type Race,
} from "./helpers/race";

// The win line is back to 10★ after the AI-02 20★ detour (even the easy
// mirror crossed the far line at 26.1m on 1337) — 36 minutes is generous.
const RACE_MINUTES = Number(process.env.AI_RACE_MINUTES ?? 36);
const SEEDS = (process.env.AI_RACE_SEEDS ?? "1337").split(",").map((x) => Number(x));

/** When a seat crossed `vp`, or null inside this window. */
const at = (r: Race, id: "you" | "ai", vp: number): number | null =>
  r.seats.find((s) => s.id === id)!.milestones.find((m) => m.vp === vp)?.at ?? null;

const fmt = (ms: number | null) => (ms === null ? "   —  " : MIN(ms).padStart(5));

/** The mirror-match report line for one preset on one seed. */
function mirror(seed: number, key: SkillKey): Race {
  const r = runRace(seed, { minutes: RACE_MINUTES, skills: [key, key] });
  const a = r.seats[0], b = r.seats[1];
  console.log(
    `  ${key.padEnd(6)} seed ${r.seed} │ 1★ ${fmt(at(r, "you", 1))} / ${fmt(at(r, "ai", 1))}`
    + ` │ 5★ ${fmt(at(r, "you", 5))} / ${fmt(at(r, "ai", 5))}`
    + ` │ 10★ ${fmt(at(r, "you", VP_TARGET))} / ${fmt(at(r, "ai", VP_TARGET))}`
    + ` │ final ${r.vp.you}★/${r.vp.ai}★`
    + ` │ winner ${r.winner ? `${r.winner.id} ${MIN(r.winner.at)}` : "—"}`
    + ` │ offers ${a.offersPosted + b.offersPosted} posted, ${a.offersTaken + b.offersTaken} taken`,
  );
  return r;
}

describe("AI-01 every difficulty finishes a mirror match", () => {
  const presets: SkillKey[] = ["easy", "normal", "hard"];
  const mirrors = new Map<string, Race>();

  it("prints the ladder (seat A / seat B)", () => {
    for (const seed of SEEDS) {
      console.log(`AI-01 mirror matches (window ${RACE_MINUTES}m):`);
      for (const key of presets) mirrors.set(`${seed}:${key}`, mirror(seed, key));
    }
    expect(mirrors.size).toBe(SEEDS.length * presets.length);
  }, 1_800_000);

  it("every preset reaches the win line, and the trailer was still racing", () => {
    for (const seed of SEEDS) {
      for (const key of presets) {
        const r = mirrors.get(`${seed}:${key}`);
        expect(r, `run the ladder first`).toBeTruthy();
        expect(r!.winner, `seed ${seed}: "${key}" seats never finish a game`).toBeTruthy();
        // …and the loser of a mirror was racing, not parked. The race loop
        // STOPS when the winner crosses the line, so the trailer's total is a
        // mid-game snapshot: judge it against what a flowing seat earns by
        // that minute. The nominal game length the floor scales with is how
        // long the line is: 20 minutes carried the 10★ era (9.9–17.6m winner
        // times) — the AI-02 20★ detour measured 15.5m (hard) to 28.5m
        // (easy), hence the 30-minute scale, generous now the line is 10★.
        const trailer = Math.min(r!.vp.you, r!.vp.ai);
        const floor = (VP_TARGET / 2) * (r!.winner!.at / (30 * 60_000));
        expect(trailer, `seed ${seed}/${key}: mirror loser only reached ${trailer}★ by the winner's ${MIN(r!.winner!.at)}`)
          .toBeGreaterThanOrEqual(Math.min(VP_TARGET / 2, floor));
        // and nobody scored backwards: the winner's own pace over the second
        // half never went negative while nothing is demolished.
        const wk = r!.winner!.id as "you" | "ai";
        expect(pacePerMinute(r!, wk)).toBeGreaterThan(0);
        const bd = victoryBreakdown(r!.eco, r!.winner!.id);
        expect(bd.paved + bd.plants).toBeGreaterThan(0);
      }
    }
  }, 1_800_000);

  it("the ladder never inverts: mirror winners land hard ≤ normal ≤ easy", () => {
    // THE criterion the user asked for, as the 10★ line allows it to be
    // measured: the speed at which a seat reaches the win points is how hard
    // the rival is — but the line lands mid-opening, where the sim's seats
    // are income-capped and every preset moves together (all three 1337
    // mirrors cross 10★ on the SAME tick, 947s). Strict ordering here would
    // assert noise, so the guard is non-strict: it catches an INVERTED
    // ladder (easy strictly faster than hard — a real bug, e.g. swapped
    // presets), not a photo finish. At the old 20★ line this separated
    // 25.3/25.4/26.1m on 1337 — already a photo finish (see the AI-01 and
    // AI-02 playtest reports for the earlier spreads).
    for (const seed of SEEDS) {
      const winAt = (k: SkillKey) => mirrors.get(`${seed}:${k}`)!.winner!.at;
      expect(winAt("hard"), `seed ${seed}: hard finished AFTER normal`)
        .toBeLessThanOrEqual(winAt("normal"));
      expect(winAt("normal"), `seed ${seed}: normal finished AFTER easy`)
        .toBeLessThanOrEqual(winAt("easy"));
    }
  }, 1_800_000);
});

describe("AI-01 the ladder holds head-to-head", () => {
  // Each pairing runs in BOTH orientations: the two seats do not get the same
  // map corner (seat 1 opens farthest-from-center, seat 2 farthest-from-seat-1
  // — the live game's own factory rule — and the two lanes can differ as much
  // as the presets themselves). A difficulty order that only shows from the
  // good chair is the chair, so the assertions POOL both orientations and
  // read the chair-1 race (where both presets provably finish) on its own.
  const tops = SEEDS.map((seed) => ({
    seed,
    hardVsEasy: runRace(seed, { minutes: RACE_MINUTES, skills: ["hard", "easy"] }),
    easyVsHard: runRace(seed, { minutes: RACE_MINUTES, skills: ["easy", "hard"] }),
    easyVsNormal: runRace(seed, { minutes: RACE_MINUTES, skills: ["easy", "normal"] }),
  }));

  it("prints the head-to-head table", () => {
    for (const t of tops) {
      console.log(`AI-01 head-to-head, seed ${t.seed} (window ${RACE_MINUTES}m)`);
      for (const [label, r] of [["hard vs easy", t.hardVsEasy], ["easy vs hard", t.easyVsHard], ["easy vs normal", t.easyVsNormal]] as const) {
        const [a, b] = r.seats;
        console.log(
          `  ${label}: ${a.skill.key} ${r.vp.you}★ / ${b.skill.key} ${r.vp.ai}★,`
          + ` winner ${r.winner ? `${r.winner.id} at ${MIN(r.winner.at)}` : "none"},`
          + ` 5★ at ${fmt(at(r, "you", 5))} vs ${fmt(at(r, "ai", 5))},`
          + ` paves you ${a.paves} (gravel left ${countTier(r.eco.track, "dirt", a.ownerId)}), ai ${b.paves}`,
        );
      }
    }
    expect(tops.length).toBe(SEEDS.length);
  }, 1_800_000);

  it("hard holds its own over both chairs, and wins the chair-1 race outright", () => {
    for (const { seed, hardVsEasy, easyVsHard } of tops) {
      // pooled over both orientations, the harder preset must be at least
      // level — non-strict for the same 10★-compression reason as the mirror
      // ladder (17.75★–17.75★ on 1337): the guard catches easy OUT-SCORING
      // hard across both chairs, not a photo finish.
      const hardTotal = hardVsEasy.vp.you + easyVsHard.vp.ai;
      const easyTotal = hardVsEasy.vp.ai + easyVsHard.vp.you;
      expect(hardTotal, `seed ${seed}: pooled ${hardTotal}★ vs easy's ${easyTotal}★ across both chairs`)
        .toBeGreaterThanOrEqual(easyTotal);
      // chair 1 is the lane BOTH presets provably finish in: there, the hard
      // seat reaches 10★ first, no photo finish required.
      const r = hardVsEasy;
      expect(r.winner, `seed ${seed}: nobody finished the chair-1 race`).toBeTruthy();
      expect(r.winner!.id, `seed ${seed}: easy beat hard for the chair-1 mirror lane`).toBe("you");
      expect(at(r, "you", 5)!).toBeLessThan(at(r, "ai", 5) ?? Infinity);
      // …and the easy seat it beat was still playing a real game — "a rival
      // you can catch", not "a rival that never shows up". Same proportional
      // floor as the mirrors (30-minute nominal, per the note above): the
      // moment hard crosses the line the race ENDS, so easy's total is a
      // snapshot of a seat in flight. On 1337 hard wins the chair-1 race at
      // 15.8m and easy stands at 7.75★ — well past the 2.63★ floor, mid-stride.
      expect(r.vp.ai, `seed ${seed}: easy was parked at ${r.vp.ai}★ when hard won at ${MIN(r.winner!.at)}`)
        .toBeGreaterThanOrEqual(
          Math.min(VP_TARGET / 2, (VP_TARGET / 2) * (r.winner!.at / (30 * 60_000))),
        );
    }
  }, 1_800_000);

  it("easy is not slow by being broken: it expands and uses the market", () => {
    for (const { seed, easyVsNormal: r } of tops) {
      const easy = r.seats[0], normal = r.seats[1];
      // both expanded onto the map (the "passive rival" complaint this ticket
      // closed): depots placed and paving started inside the window.
      expect(r.eco.harvesters.filter((h) => h.owner === easy.id).length,
        `seed ${seed}: easy never placed a depot`).toBeGreaterThanOrEqual(2);
      expect(easy.firstPave, `seed ${seed}: easy never paved`).not.toBeNull();
      // the easy seat posts fewer offers over the same window than normal —
      // but it does still use the market every so often.
      expect(easy.offersPosted + normal.offersPosted,
        `seed ${seed}: nobody posted a market offer all game`).toBeGreaterThan(0);
    }
  }, 1_800_000);
});

// The presets' own rails: the printout the playtest report quotes.
describe("AI-01 preset sanity", () => {
  it("clocks ladder the way the labels promise", () => {
    expect(RIVAL_SKILLS.easy.buildMs).toBeGreaterThan(RIVAL_SKILLS.normal.buildMs);
    expect(RIVAL_SKILLS.normal.buildMs).toBeGreaterThan(RIVAL_SKILLS.hard.buildMs);
    expect(RIVAL_SKILLS.easy.paveTiles).toBeLessThan(RIVAL_SKILLS.normal.paveTiles);
    expect(RIVAL_SKILLS.normal.paveTiles).toBeLessThan(RIVAL_SKILLS.hard.paveTiles);
    expect(RIVAL_SKILLS.hard.expandPerTurn).toBeGreaterThan(RIVAL_SKILLS.normal.expandPerTurn);
    // the easy preset never sabotages the player's board; the others do
    expect(RIVAL_SKILLS.easy.blockades).toBe(false);
    expect(RIVAL_SKILLS.easy.raidEveryMs).toBe(0);
    expect(RIVAL_SKILLS.normal.blockades).toBe(true);
    expect(RIVAL_SKILLS.hard.blockades).toBe(true);
  });
});
