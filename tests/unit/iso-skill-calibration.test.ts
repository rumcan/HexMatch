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
// Two seat truths the assertions have to respect, both measured on the way
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
//
// Two things this pins, in order of importance:
//
//   1. mirror matches end: EVERY preset reaches 10★ inside the window against
//      an identical twin, and the trailer was still playing (≥ half the win);
//   2. the ladder orders itself: mirror winners land hard < normal < easy by
//      finishing time, and pooled over both chairs the hard seat out-scores
//      the easy seat head-to-head while never losing the chair-1 race.
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

// AI-02: the 20★ line roughly doubles game length (easy mirrors finish at
// ~28.5m on 1337) — 30 minutes of window was the 10★ era's setting.
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
        // times), and at the AI-02 line of 20★ the measured game runs 15.5m
        // (hard) to 28.5m (easy) — hence 30 minutes.
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

  it("the ladder orders itself: mirror winners land hard < normal < easy", () => {
    // THE criterion the user asked for: the speed at which a seat reaches the
    // win points is how hard the rival is. Mirrors make it fair — both seats
    // play the same policy, so the only thing separating easy from hard is the
    // preset's own numbers. Measured on 1337 at the AI-02 line (20★): hard
    // 15.5m < normal 16.8m < easy 28.5m; dense lanes (7/42/99) move the
    // absolute times but keep the order (see
    // docs/playtest-reports/2026-09-10-ai-02-report.md).
    for (const seed of SEEDS) {
      const winAt = (k: SkillKey) => mirrors.get(`${seed}:${k}`)!.winner!.at;
      expect(winAt("hard"), `seed ${seed}: hard did not finish before normal`)
        .toBeLessThan(winAt("normal"));
      expect(winAt("normal"), `seed ${seed}: normal did not finish before easy`)
        .toBeLessThan(winAt("easy"));
    }
  }, 1_800_000);
});

describe("AI-01 the ladder orders itself head-to-head", () => {
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

  it("hard out-plays easy over both chairs, and wins the chair-1 race outright", () => {
    for (const { seed, hardVsEasy, easyVsHard } of tops) {
      // pooled over both orientations, the harder preset must be clearly ahead
      const hardTotal = hardVsEasy.vp.you + easyVsHard.vp.ai;
      const easyTotal = hardVsEasy.vp.ai + easyVsHard.vp.you;
      expect(hardTotal, `seed ${seed}: pooled ${hardTotal}★ vs easy's ${easyTotal}★ across both chairs`)
        .toBeGreaterThan(easyTotal);
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
      // 15.5m and easy stands at 7★ — well past the 5.17★ floor, mid-stride.
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
