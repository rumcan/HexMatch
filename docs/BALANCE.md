# Match arc & rival balance (BAL-1, #471)

**A match should have a clear arc (land grab → logistics race → contests →
finale) that ends in 15–20 minutes, and each difficulty should have a known,
fair win rate.** This doc is the balance surface: the targets, the knobs, and
the measured results the harness keeps up to date.

---

## 1. The targets

| Matchup | Rival win rate | Match length |
| --- | --- | --- |
| **steady** bot vs **Easy** | ~20% | — |
| **steady** bot vs **Normal** | ~40% | **15–20 min** |
| **steady** bot vs **Hard** | ~60% | — |
| **novice** bot vs **Trainee** | **0%** ("the trainee never beats novice") | — |

**Tolerances.** "Within ±5%" is read as: win rates ±5 **percentage points**
(the finest band integer wins over 30+ seeds can carry), match length ±5%
**relative** on the 15–20 min band (14.25–21 min on the mean). The `test:slow`
smoke runs a handful of seeds and gates a drift of more than **15** (win rates
±15pp, length ±15% relative → 12.75–23 min) — the ticket's "smoke version
that fails if a target drifts more than 15%", with the same reading.

## 2. The harness

One command plays the whole matrix and rewrites the results block below:

```bash
npm run balance                      # 30 seeds × 4 matchups (long — get a coffee)
BALANCE_SEEDS=1-10 npm run balance   # a quick re-measure while tuning
```

- `tests/unit/helpers/balance-sim.ts` — the headless match runner (the
  `l1d-race` pattern, extended with scripted player bots and the money
  economy). Deterministic: no `Math.random` anywhere.
- `tests/unit/iso-471-balance-sim.test.ts` — the full run + report writer.
- `tests/unit/iso-471-balance-smoke.test.ts` — the drift gate, in
  `npm run test:slow`.

### The player bots

A bot is a build order + two clocks + a market policy. The build order is
scripted by priority over the engine's own candidate list (the shared
`deepPlanCandidates` ranking, steered by the depot tree's `wantCargo`), so no
bot is a hand-picked tile script that only works on one seed. Both openings
come from the engine's own factory rule — a weaker opening than a thinking
human takes, on purpose.

| Bot | build / idle / session | tune | pave | townRsv | market |
| --- | --- | --- | --- | --- | --- |
| **novice** ("first Depot, then slow") | 26s / 12s / 135s | 0.35 | 2 tiles | 1.5 | dumps on sight, no timing |
| **steady** ("a sensible build order") | 13s / 5s / 85s | 0.62 | 6 tiles | 1.0 | the rival's own rule (sell ≥2% above your recent average) |
| **sharp** ("optimised + market timing") | 8s / 2.5s / 55s | 0.85 | 10 tiles | 0.7 | waits for a +6% edge; dumps only under storage pressure |

The shared build order: the free opening Depot, the Processing Plant as soon
as the next Depot's price still fits alongside it (the plant is the reach —
and the income — engine), then Depots → city tiers → re-matches → routes,
each behind the same guards the live turn uses. A plant budget (1 for
novice, 2 for the others) is the one place a bot says "enough": reach is a
means, not a goal — the measured v1 bot bought four plants in one match
($672 of a $300-start economy).

`sessionMs` is the one that matters most: a Depot (with its tune), a city tier
and a re-match each cost the PLAYER a real tuning session on the board, and
the bot's `sessionMs` is how long one takes its hands.

### What the sim models (and what it does not)

Modelled: the clock economy (`loopIncome` — `BASE_RATE × yield × distance ×
transport × town` per connected depot, storage cap and all), the money
economy (`BUILD_COSTS_MONEY` / `START_MONEY`, `spendBuild` for the player
seat, game.ts's clamped `chargeBuild` for the rival), the seeded market
(`market.ts`: OU walk, events, slippage, `rivalSellLot`), the depot tree's
prices, city upgrades, depot tunes / re-matches (simulated sessions on the
same score→yield curve the rival's use), paving and the ★ table
(`VICTORY.loop`, routes and top-level depots included).

Not modelled (both seats miss it equally): the match-3 board itself
(sessions are simulated), battles / contested-site ★, raids / sabotage /
blockades, rail (flagged out of the live game) and dams (off). Multi-city
bookkeeping runs the shared seat-level rule.

### The #503 legacy proxy (kept, renamed)

Main already carried a first BAL-1 measurement pass (`#503`) built on the
pre-BAL-1 `runRace` helper — its own report records that it verifies none
of the targets (no scripted bots, no money ledger, no trainee). Its two
tests are kept running under their own names so nothing is lost:

- `tests/unit/iso-471-balance-trace.test.ts` (`npm run balance:sim`) —
  30 seeds × easy/normal/hard through `runRace`, writing the full trace to
  `docs/playtest-reports/balance-471.json`;
- `tests/unit/iso-471-balance-trace-smoke.test.ts` (in `test:slow`) —
  its 3-seed opening-window validity check.

The calibrated targets and the drift gate live in the two files of §2.

## 3. The knobs

Named by the ticket, in `src/iso/config.ts` / `src/iso/skill.ts`, all
documented in `docs/economy-money.md` when they move:

- **the ★ line** — `VICTORY.loop.target`;
- **the clocks** — `RIVAL_SKILLS[].buildMs / idleMs / sessionMs`;
- **the rival's action cadence** — `expandPerTurn`, `paveTiles`, `townReserve`;
- **prices** — `START_MONEY`, `BASE_PRICE` (which drives the derived
  `BUILD_COSTS_MONEY` table).

The bot profiles are NOT knobs — they are the measuring stick. They were set
once (above) and must not move to chase a target.

## 4. Phase beats (the arc, telegraphed)

The Feed announces the arc as the ★ **leader** crosses each share of the
line (`src/iso/phases.ts`, once per beat, whichever seat is ahead):

- `Mid-game: tenders open.` at ⅓ of the line (CONTRACT-1's tenders are the
  thing this line promises);
- `Final stretch: X★ to win.` at ⅔ of the line.

## 5. Known gaps / follow-ups

- #431 (the rival's stall) is **not merged** at the time of this run — the
  numbers below are measured against the rival as it stands on this branch.
  Re-run `npm run balance` after #431, RIVAL-3 (#467) and CONTRACT-1 (#466)
  land; the win rates move when the rival's planner does.
- The rival's Depot pass is goods-gated (`aiBuildStep` prices against
  `rival.purse`) but charged in money (`chargeBuild`, clamped at $0) — the
  harness mirrors that exactly. `docs/economy-money.md` §5 describes a
  `buildPurse` hand-off the live turn does not actually make; worth a
  follow-up either way.
- Depot levels (`DEPOT_LEVELS`, the `maxDepot` ★) are tuned but never bought
  by either the rival or the bots — the live rival has no such pass, and the
  bots stay symmetrical with it. A future bot policy can add it.

<!-- BALANCE-SIM:BEGIN — generated by `npm run balance`; do not edit by hand -->
**Harness run** — 2026-09-27 · 30 seeds (1…30) · 25 min window · targets within ±5pp (win rates) / ±5% (length).

| Rival preset | build | idle | session | expand | pave | tune | townRsv | line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Trainee | 15s | 5s | 120s | 1 | 3 | 0.3 | 1.25 | 6★ |
| Easy | 11s | 3.5s | 85s | 1 | 7 | 0.53 | 0.95 | 5★ |
| Normal | 6.5s | 1.8s | 74s | 2 | 12 | 0.67 | 0.85 | 10★ |
| Hard | 4.5s | 1.2s | 54s | 3 | 16 | 0.88 | 0.6 | 10★ |

★ line (`VICTORY.loop.target`): **12★** · START_MONEY: **$300**

| Good | BASE_PRICE | | Build | $ | | Bot | build | idle | session | tune | pave | townRsv | sell |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| grain | $6 | | dirt | $0 | | novice | 26s | 12s | 135s | 0.35 | 2 | 1.5 | dump |
| wood | $5 | | road | $126 | | steady | 13s | 5s | 85s | 0.62 | 6 | 1 | average |
| stone | $5 | | upgrade | $96 | | sharp | 8s | 2.5s | 55s | 0.85 | 10 | 0.7 | timing |
| ore | $8 | | depot | $108 | |  |  |  |  |  |  |  |  |
| oil | $12 | | plant | $168 | |  |  |  |  |  |  |  |  |
| gold | $40 | | rail | $15 | |  |  |  |  |  |  |  |  |

### Verdict

- steady vs easy: rival 16.7% (target 20.0% ±5pp), mean 18.5m, decided 60.0%, n=30
  - ✅ rival win rate 16.7% vs target 20.0% ±5pp
- steady vs normal: rival 36.7% (target 40.0% ±5pp), mean 18.3m (target 15–20m), decided 73.3%, n=30
  - ✅ rival win rate 36.7% vs target 40.0% ±5pp · ✅ mean length 18.3m vs target 15–20m ±5%
- steady vs hard: rival 60.0% (target 60.0% ±5pp), mean 15.3m, decided 70.0%, n=30
  - ✅ rival win rate 60.0% vs target 60.0% ±5pp
- novice vs trainee: rival 0.0% (target 0.0% ±5pp), mean NaNm, decided 0.0%, n=30
  - ✅ rival win rate 0.0% vs target 0.0% ±5pp
- sharp vs hard: —, mean 15.4m, decided 66.7%, n=30
  - 

### steady vs easy (n=30)

steady vs easy: rival 16.7% (target 20.0% ±5pp), mean 18.5m, decided 60.0%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 4.0 | 3.6 | 190.3 | 326.3 |
| 10m | 6.6 | 5.7 | 551.5 | 478.5 |
| 15m | 8.3 | 6.5 | 679.3 | 244.1 |
| 20m | 8.7 | 7.0 | 723.6 | 280.3 |
| 25m | 9.0 | 7.2 | 708.6 | 329.6 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 7 (6/1/0) | 6 (5/1/0) | $47 | $81 | 98/133 |
| 2 | ai | 21.4m | 10 (6/1/3) | 10 (5/4/3) | $147 | $74 | 1/85 |
| 3 | — | 25.0m | 6 (6/0/0) | 10 (5/3/2) | $22 | $547 | 123/150 |
| 4 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $51 | $6 | 112/139 |
| 5 | you | 15.2m | 10 (9/1/2) | 1 (1/0/0) | $5196 | $326 | 0/203 |
| 6 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $88 | $124 | 126/114 |
| 7 | — | 25.0m | 10 (6/3/1) | 6 (5/1/0) | $164 | $220 | 61/89 |
| 8 | ai | 24.9m | 10 (6/3/1) | 11 (5/5/2) | $68 | $65 | 55/132 |
| 9 | — | 25.0m | 6 (5/1/0) | 7 (6/1/0) | $151 | $188 | 102/87 |
| 10 | you | 15.1m | 11 (5/4/3) | 9 (6/0/3) | $6 | $76 | 2/10 |
| 11 | you | 16.7m | 10 (5/4/3) | 10 (6/1/3) | $23 | $339 | 0/17 |
| 12 | you | 17.2m | 11 (5/4/3) | 10 (6/1/3) | $59 | $427 | 4/28 |
| 13 | you | 23.0m | 11 (5/5/2) | 6 (6/0/0) | $188 | $172 | 6/129 |
| 14 | you | 18.3m | 11 (6/3/3) | 5 (5/0/0) | $79 | $61 | 1/14 |
| 15 | — | 25.0m | 6 (6/0/0) | 5 (5/0/0) | $162 | $62 | 73/119 |
| 16 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $121 | $17 | 85/172 |
| 17 | ai | 24.6m | 7 (6/1/0) | 11 (5/5/2) | $52 | $64 | 120/141 |
| 18 | you | 19.4m | 11 (6/3/3) | 8 (5/0/3) | $67 | $421 | 1/63 |
| 19 | you | 17.3m | 11 (7/3/2) | 4 (4/0/0) | $72 | $175 | 0/118 |
| 20 | ai | 20.2m | 10 (5/2/3) | 11 (6/3/3) | $254 | $88 | 1/53 |
| 21 | you | 16.7m | 11 (10/0/2) | 1 (1/0/0) | $5637 | $300 | 0/226 |
| 22 | — | 25.0m | 6 (5/1/0) | 6 (6/0/0) | $161 | $56 | 101/82 |
| 23 | — | 25.0m | 8 (6/2/0) | 6 (5/0/1) | $32 | $4417 | 127/238 |
| 24 | you | 17.6m | 11 (5/4/3) | 9 (6/0/3) | $4 | $240 | 0/30 |
| 25 | ai | 17.5m | 6 (5/1/0) | 11 (6/3/3) | $71 | $40 | 83/21 |
| 26 | you | 17.8m | 11 (6/3/3) | 9 (5/1/3) | $19 | $117 | 1/45 |
| 27 | you | 14.3m | 11 (6/3/3) | 5 (5/0/0) | $1567 | $38 | 0/18 |
| 28 | — | 25.0m | 6 (6/0/0) | 11 (5/4/2) | $165 | $198 | 99/134 |
| 29 | — | 25.0m | 11 (5/4/2) | 6 (6/0/0) | $28 | $56 | 13/151 |
| 30 | you | 14.9m | 9 (6/3/3) | 5 (5/0/0) | $1607 | $0 | 0/6 |

### steady vs normal (n=30)

steady vs normal: rival 36.7% (target 40.0% ±5pp), mean 18.3m (target 15–20m), decided 73.3%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 4.0 | 3.6 | 186.6 | 315.3 |
| 10m | 6.4 | 6.5 | 374.3 | 703.5 |
| 15m | 8.1 | 7.4 | 636.3 | 343.3 |
| 20m | 8.5 | 7.9 | 601.3 | 297.3 |
| 25m | 8.8 | 8.2 | 586.6 | 282.3 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 6 (5/1/0) | 7 (6/1/0) | $55 | $46 | 92/147 |
| 2 | ai | 18.9m | 10 (6/1/3) | 10 (5/4/3) | $252 | $161 | 2/170 |
| 3 | ai | 23.0m | 6 (6/0/0) | 12 (5/5/2) | $111 | $12 | 123/310 |
| 4 | ai | 17.0m | 6 (5/1/0) | 12 (6/3/3) | $40 | $69 | 48/90 |
| 5 | you | 15.2m | 10 (9/1/2) | 1 (1/0/0) | $5196 | $327 | 0/414 |
| 6 | — | 25.0m | 7 (5/2/0) | 7 (6/1/0) | $115 | $60 | 130/154 |
| 7 | ai | 18.6m | 8 (5/2/1) | 11 (6/3/3) | $130 | $85 | 61/117 |
| 8 | ai | 22.8m | 10 (6/3/1) | 11 (5/5/2) | $120 | $59 | 42/278 |
| 9 | — | 25.0m | 6 (5/1/0) | 7 (6/1/0) | $149 | $52 | 102/295 |
| 10 | you | 15.3m | 11 (5/4/3) | 9 (6/1/3) | $34 | $141 | 1/59 |
| 11 | you | 16.9m | 10 (5/4/3) | 10 (6/2/3) | $14 | $424 | 0/89 |
| 12 | ai | 17.1m | 6 (5/0/1) | 11 (6/3/3) | $104 | $205 | 58/93 |
| 13 | you | 23.0m | 11 (5/5/2) | 7 (6/1/0) | $150 | $32 | 6/109 |
| 14 | ai | 19.9m | 11 (6/2/3) | 11 (5/5/2) | $100 | $40 | 2/252 |
| 15 | — | 25.0m | 7 (5/1/1) | 6 (6/0/0) | $84 | $25 | 68/267 |
| 16 | you | 18.7m | 11 (6/3/3) | 11 (5/3/3) | $77 | $55 | 1/170 |
| 17 | ai | 23.1m | 7 (6/1/0) | 11 (5/5/2) | $222 | $121 | 117/298 |
| 18 | ai | 18.9m | 8 (5/1/2) | 9 (6/3/3) | $232 | $62 | 10/133 |
| 19 | you | 17.3m | 11 (7/3/2) | 4 (4/0/0) | $72 | $41 | 0/203 |
| 20 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $137 | $18 | 103/281 |
| 21 | you | 16.7m | 11 (10/0/2) | 1 (1/0/0) | $5637 | $300 | 0/459 |
| 22 | — | 25.0m | 6 (5/1/0) | 6 (6/0/0) | $22 | $43 | 135/178 |
| 23 | you | 16.8m | 11 (6/3/3) | 6 (5/0/1) | $39 | $3127 | 7/250 |
| 24 | ai | 19.5m | 7 (5/2/0) | 11 (6/3/3) | $53 | $103 | 119/144 |
| 25 | ai | 15.8m | 6 (5/1/0) | 11 (6/3/3) | $164 | $54 | 54/74 |
| 26 | you | 18.2m | 11 (6/3/3) | 9 (5/1/3) | $84 | $416 | 0/161 |
| 27 | you | 14.3m | 11 (6/3/3) | 5 (5/0/0) | $1522 | $63 | 0/209 |
| 28 | you | 15.4m | 10 (6/3/3) | 11 (5/3/3) | $76 | $140 | 0/98 |
| 29 | — | 25.0m | 11 (5/4/2) | 6 (6/0/0) | $20 | $32 | 16/265 |
| 30 | — | 25.0m | 10 (5/4/1) | 7 (6/1/0) | $143 | $154 | 45/301 |

### steady vs hard (n=30)

steady vs hard: rival 60.0% (target 60.0% ±5pp), mean 15.3m, decided 70.0%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 3.9 | 5.0 | 174.2 | 201.7 |
| 10m | 5.6 | 7.8 | 248.9 | 279.1 |
| 15m | 6.3 | 8.4 | 438.8 | 208.4 |
| 20m | 6.5 | 8.6 | 471.9 | 223.6 |
| 25m | 6.7 | 8.7 | 537.7 | 215.1 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 6 (5/1/0) | 7 (6/1/0) | $54 | $54 | 87/291 |
| 2 | ai | 16.9m | 9 (5/1/3) | 11 (6/4/3) | $84 | $22 | 5/193 |
| 3 | ai | 22.9m | 5 (5/0/0) | 11 (6/5/2) | $29 | $0 | 132/370 |
| 4 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $74 | $25 | 109/309 |
| 5 | you | 15.2m | 10 (9/1/2) | 1 (1/0/0) | $5196 | $326 | 0/426 |
| 6 | ai | 22.1m | 5 (5/0/0) | 11 (6/4/2) | $78 | $92 | 74/357 |
| 7 | ai | 12.4m | 8 (4/2/2) | 11 (7/2/3) | $17 | $159 | 1/63 |
| 8 | ai | 14.8m | 4 (4/0/0) | 9 (7/3/2) | $155 | $53 | 14/145 |
| 9 | ai | 9.3m | 5 (5/0/0) | 11 (6/3/3) | $82 | $98 | 16/5 |
| 10 | ai | 13.3m | 10 (5/2/3) | 11 (6/3/3) | $234 | $133 | 0/103 |
| 11 | ai | 13.1m | 7 (4/1/2) | 11 (7/2/3) | $152 | $105 | 10/68 |
| 12 | ai | 14.3m | 6 (5/0/1) | 11 (6/3/3) | $115 | $93 | 35/125 |
| 13 | ai | 13.1m | 8 (4/2/2) | 11 (7/2/3) | $141 | $207 | 2/73 |
| 14 | ai | 12.4m | 5 (5/0/0) | 11 (6/4/2) | $86 | $39 | 23/112 |
| 15 | — | 25.0m | 4 (4/0/0) | 7 (7/0/0) | $109 | $26 | 61/298 |
| 16 | — | 25.0m | 5 (4/1/0) | 7 (7/0/0) | $85 | $77 | 73/258 |
| 17 | ai | 17.2m | 5 (5/0/0) | 11 (6/4/2) | $139 | $63 | 49/208 |
| 18 | ai | 17.0m | 6 (5/0/1) | 12 (6/3/3) | $172 | $53 | 48/187 |
| 19 | you | 17.4m | 11 (6/4/2) | 5 (5/0/0) | $28 | $36 | 4/252 |
| 20 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $122 | $27 | 109/178 |
| 21 | you | 16.7m | 11 (10/0/2) | 1 (1/0/0) | $5637 | $300 | 0/471 |
| 22 | — | 25.0m | 6 (5/1/0) | 6 (6/0/0) | $67 | $61 | 77/230 |
| 23 | ai | 13.5m | 5 (5/0/0) | 11 (6/3/3) | $49 | $2 | 69/80 |
| 24 | ai | 16.8m | 5 (5/0/0) | 11 (6/3/3) | $140 | $77 | 98/174 |
| 25 | ai | 12.2m | 4 (4/0/0) | 11 (7/2/3) | $64 | $21 | 61/60 |
| 26 | ai | 17.9m | 5 (5/0/0) | 10 (6/3/3) | $94 | $17 | 95/201 |
| 27 | — | 25.0m | 6 (4/2/0) | 7 (7/0/0) | $256 | $24 | 82/311 |
| 28 | ai | 11.8m | 5 (5/0/0) | 10 (6/3/3) | $68 | $30 | 22/66 |
| 29 | — | 25.0m | 11 (5/4/2) | 6 (6/0/0) | $28 | $32 | 13/300 |
| 30 | — | 25.0m | 9 (4/4/1) | 8 (7/1/0) | $2481 | $140 | 58/239 |

### novice vs trainee (n=30)

novice vs trainee: rival 0.0% (target 0.0% ±5pp), mean NaNm, decided 0.0%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 2.0 | 1.3 | 617.6 | 550.1 |
| 10m | 4.0 | 3.0 | 1756.1 | 671.0 |
| 15m | 6.1 | 4.2 | 3609.9 | 855.6 |
| 20m | 6.8 | 4.8 | 4528.6 | 1220.4 |
| 25m | 7.9 | 5.0 | 5216.6 | 1827.0 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 7 (6/1/0) | 5 (5/0/0) | $5524 | $2490 | 0/0 |
| 2 | — | 25.0m | 6 (6/0/0) | 6 (5/0/1) | $5443 | $2321 | 0/0 |
| 3 | — | 25.0m | 7 (7/0/0) | 5 (4/0/1) | $6238 | $2864 | 0/0 |
| 4 | — | 25.0m | 8 (6/2/0) | 7 (5/0/2) | $3158 | $3260 | 0/0 |
| 5 | — | 25.0m | 10 (10/0/0) | 1 (1/0/0) | $10917 | $326 | 0/191 |
| 6 | — | 25.0m | 8 (7/1/0) | 4 (4/0/0) | $5957 | $453 | 0/0 |
| 7 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $4393 | $1390 | 0/0 |
| 8 | — | 25.0m | 7 (6/1/0) | 6 (5/0/1) | $4241 | $1771 | 0/0 |
| 9 | — | 25.0m | 7 (6/1/0) | 6 (5/0/1) | $5099 | $2988 | 0/0 |
| 10 | — | 25.0m | 9 (6/3/0) | 5 (5/0/0) | $4524 | $483 | 0/0 |
| 11 | — | 25.0m | 7 (6/1/0) | 5 (5/0/0) | $4760 | $1436 | 0/0 |
| 12 | — | 25.0m | 7 (7/0/0) | 6 (4/0/2) | $5284 | $3007 | 0/0 |
| 13 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $4777 | $2257 | 0/0 |
| 14 | — | 25.0m | 7 (6/1/0) | 5 (5/0/0) | $5170 | $1059 | 0/0 |
| 15 | — | 25.0m | 6 (6/0/0) | 5 (5/0/0) | $3061 | $2128 | 0/0 |
| 16 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $4315 | $1441 | 0/0 |
| 17 | — | 25.0m | 7 (6/1/0) | 7 (5/0/2) | $3097 | $2003 | 0/0 |
| 18 | — | 25.0m | 7 (6/1/0) | 5 (5/0/0) | $2721 | $1285 | 0/0 |
| 19 | — | 25.0m | 9 (7/2/0) | 4 (4/0/0) | $6362 | $2575 | 0/22 |
| 20 | — | 25.0m | 8 (6/2/0) | 6 (5/0/1) | $7230 | $2289 | 0/0 |
| 21 | — | 25.0m | 10 (10/0/0) | 1 (1/0/0) | $9679 | $322 | 0/191 |
| 22 | — | 25.0m | 7 (6/1/0) | 5 (5/0/0) | $3256 | $2971 | 0/0 |
| 23 | — | 25.0m | 8 (7/1/0) | 5 (4/0/1) | $7160 | $972 | 0/0 |
| 24 | — | 25.0m | 9 (7/2/0) | 6 (4/0/2) | $6515 | $2338 | 0/0 |
| 25 | — | 25.0m | 7 (6/1/0) | 5 (5/0/0) | $3790 | $2238 | 0/0 |
| 26 | — | 25.0m | 9 (6/3/0) | 6 (5/0/1) | $4142 | $2719 | 0/0 |
| 27 | — | 25.0m | 10 (7/3/0) | 4 (4/0/0) | $6788 | $2624 | 0/11 |
| 28 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $4820 | $790 | 0/0 |
| 29 | — | 25.0m | 9 (6/3/0) | 5 (5/0/0) | $3797 | $1015 | 0/0 |
| 30 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $4280 | $994 | 0/0 |

### sharp vs hard (n=30)

sharp vs hard: —, mean 15.4m, decided 66.7%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 6.1 | 4.9 | 231.6 | 205.1 |
| 10m | 8.7 | 5.6 | 170.7 | 294.2 |
| 15m | 9.6 | 6.2 | 180.7 | 385.3 |
| 20m | 10.1 | 6.4 | 185.4 | 475.3 |
| 25m | 10.5 | 6.4 | 198.6 | 549.8 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 11 (6/5/0) | 6 (5/1/0) | $228 | $178 | 174/295 |
| 2 | you | 19.3m | 11 (6/4/2) | 5 (5/0/0) | $77 | $189 | 60/230 |
| 3 | ai | 21.3m | 9 (6/4/0) | 10 (5/5/2) | $24 | $34 | 148/367 |
| 4 | you | 13.4m | 11 (6/3/3) | 10 (5/2/3) | $8 | $410 | 33/123 |
| 5 | you | 9.7m | 11 (10/1/1) | 1 (1/0/0) | $159 | $325 | 0/263 |
| 6 | — | 25.0m | 9 (6/3/0) | 5 (5/0/0) | $39 | $78 | 162/274 |
| 7 | you | 13.7m | 11 (6/3/3) | 9 (5/1/3) | $2 | $162 | 29/136 |
| 8 | ai | 18.5m | 11 (6/4/1) | 11 (5/5/2) | $72 | $41 | 107/280 |
| 9 | you | 14.0m | 11 (6/3/3) | 5 (5/1/0) | $80 | $10 | 20/183 |
| 10 | you | 10.8m | 10 (6/3/3) | 5 (5/0/0) | $32 | $173 | 10/106 |
| 11 | you | 13.4m | 11 (6/3/3) | 5 (5/0/0) | $79 | $175 | 22/182 |
| 12 | ai | 15.3m | 11 (6/2/3) | 11 (5/4/3) | $142 | $68 | 41/182 |
| 13 | you | 19.3m | 11 (6/4/2) | 6 (5/1/0) | $93 | $93 | 60/139 |
| 14 | you | 15.2m | 11 (6/3/3) | 6 (5/1/0) | $23 | $2 | 24/205 |
| 15 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $133 | $87 | 183/246 |
| 16 | you | 15.9m | 11 (6/3/3) | 11 (5/3/3) | $38 | $29 | 51/192 |
| 17 | ai | 21.2m | 11 (6/5/0) | 11 (5/5/2) | $11 | $145 | 148/354 |
| 18 | — | 25.0m | 11 (6/5/0) | 5 (5/0/0) | $159 | $72 | 170/329 |
| 19 | you | 17.9m | 11 (7/5/0) | 5 (4/1/0) | $90 | $54 | 101/258 |
| 20 | — | 25.0m | 11 (6/5/0) | 5 (5/0/0) | $47 | $1427 | 135/568 |
| 21 | you | 10.3m | 11 (10/0/2) | 1 (1/0/0) | $656 | $300 | 0/279 |
| 22 | — | 25.0m | 10 (6/4/0) | 5 (5/0/0) | $93 | $4174 | 165/591 |
| 23 | you | 19.4m | 10 (6/6/0) | 6 (5/0/1) | $101 | $3351 | 97/412 |
| 24 | — | 25.0m | 11 (6/5/0) | 5 (5/0/0) | $80 | $25 | 167/247 |
| 25 | — | 25.0m | 10 (6/4/0) | 5 (5/0/0) | $114 | $93 | 178/431 |
| 26 | — | 25.0m | 10 (6/4/0) | 6 (5/0/1) | $126 | $4294 | 142/568 |
| 27 | — | 25.0m | 11 (6/5/0) | 6 (5/1/0) | $257 | $77 | 188/254 |
| 28 | you | 12.5m | 10 (6/3/3) | 11 (5/3/3) | $66 | $125 | 30/116 |
| 29 | you | 17.8m | 11 (6/4/2) | 6 (5/1/0) | $88 | $13 | 50/155 |
| 30 | you | 9.8m | 9 (6/3/3) | 5 (5/0/0) | $16 | $50 | 5/96 |

<!-- BALANCE-SIM:END -->
