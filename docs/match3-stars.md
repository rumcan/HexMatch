# The tuning session's 5★ scale (MATCH-2, #566)

_The star tiers laid on the tuning session's score→yield line, and the bot sweep that pins them (`tests/unit/match3-balance-bot.test.ts`). The line itself did not move, so BAL-1 (`npm run balance`, docs/BALANCE.md) does not move either: the economy never reads a star._

## The line (unchanged — L4 / #218)

A session scores **gems cleared + reward points** over **10 moves** on the depot board (7×8, the Depot's cargo at 45 % of every refill, the difficulty's frost and girders). The score buys a yield on one straight line (`tuningYieldFor`, src/iso/tuning.ts):

```
yield(score) = floor + (maxYield − floor) × score / targetScore      (maxYield 2.5 at targetScore 60)
```

No ceiling (owner call, 2026-09) — only the Depot's level cap (the overshoot pays Gold) and the never-drops clamp.

## The five tiers

`TUNING_STARS` in src/iso/config.ts — the only place the bars live. The results pop-up, the plate's meter, the depot card and the rival's rating all read it.

| Stars | Score ≥ | Verdict    | Share of the average player | Share of the competent player |
| ----- | ------- | ---------- | --------------------------- | ----------------------------- |
| ★     | 1       | Tuned      | 32.0 %                      | 13.0 %                        |
| ★★    | 135     | Well tuned | 43.0 %                      | 44.7 %                        |
| ★★★   | 360     | Precision  | 19.3 %                      | 27.7 %                        |
| ★★★★  | 600     | Overdrive  | 5.3 %                       | 12.3 %                        |
| ★★★★★ | 870     | Legendary  | 0.3 %                       | 2.3 %                         |

**Why these bars.** The old table (#300) put ★★★ at the target, score 60 — and the cargo-biased depot board cascades so readily that nearly every session cleared it (the owner's "it's too easy to get 3 stars"). Fable's analytic first cut (42 / 78 / 108 / 138) had the same problem: the average bot scored a median of 118, so it averaged ~3.8★. The bars above are read off the **measured** sweep instead: ★★ at the average player's 30th percentile, ★★★ near their 75th, ★★★★ near their 95th, and ★★★★★ past the competent player's 97th.

**2026-09-28, the line gem:** a match of 4 now leaves a line gem (clears a row and a column; swapped, just the row or the column). It lifts every score, so the bars moved to 450 / 1320 / 1980 / 2760 by the same method (average bot p30 / p75 / p95, competent p97). The share columns above are from the first sweep; `match3-balance-bot.test.ts` holds the gate.

## The sweep

`runBalanceSweep(profile, N)` (src/match3/bot.ts) plays N seeded sessions per profile on the depot board (grain bias, Normal's obstacles, ten moves) on the timer-free engine. One mulberry32 stream per session covers the deal, the refill and the bot's coin flips, so a seed is a full replay.

| Profile   | Plays                                                                  | Mean score | p50 | p90 | p99 | Mean ★ |
| --------- | ---------------------------------------------------------------------- | ---------- | --- | --- | --- | ------ |
| random    | any legal swap                                                         | 103.6      | 93  | 159 | 323 | 1.55   |
| average   | the biggest immediate match 55 % of the time, otherwise any legal swap | 141.2      | 118 | 244 | 447 | 1.99   |
| competent | always the biggest immediate gain; bombs into colour                    | 188.6      | 163 | 329 | 538 | 2.46   |

(300 sessions each, seed base 1000, measured 2026-09-28.)

**The gate** (`BALANCE_GATE`, pinned by `match3-balance-bot.test.ts`): the average player averages **2.0 ± 0.3★**, and the competent player reaches ★★★★★ in **under 5 %** of sessions. If a play-test disagrees with the bots, the knobs are, in order: the `curve` column of `TUNING_STARS` (one table), `AVERAGE_LOOKS` in bot.ts (how often the average bot looks), and only then the reward points.

## The star moment

Crossing ★★★★ mid-session stamps OVERDRIVE over the board with the `star_4` flourish. Crossing ★★★★★ is the Legendary finale (src/match3/finale.ts, wired in src/iso/game.ts): the cascades still in the air play at a quarter speed held for 0.7 s and eased back over 2.8 s, the board pushes in, the stars stamp in, the `star_5` flourish rings and the Ode to Joy plays (`assets/sfx/finale.mp3`). The session's results wait for it to land. Reduced motion keeps the banner and the music and drops the slow-mo and the push; the performance preset drops the slow-mo.

## What moved, what did not

- **Moved:** the star rows (three → five) and their labels; the results card (five stars); the depot card's and the target card's `Last: ★★☆☆☆`; `TuningStars` (0–5); `lastStars` validation in snapshots (0–5 — every old 0–3 value is already legal, so saves load unchanged and keep their count).
- **Did not move:** `TUNING` (moves, target, min/max yield, bias, Gold), `tuningYieldFor`, `settleTuningYield`, `overshootGold`, the reward points, the difficulty rows, the rival's simulated session.
