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

- **BAL-2 (#530, 2026-09-27): the knobs below are the post-#431
  recalibration.** #431 removed the rival's gold-opener stall (its
  `rivalBuyTowardGoal` tail), which the #523 harness had been counting as a
  non-win — Hard jumped 60.0% → 66.7% and the smoke's seed-1–8 slice read
  62.5% → 75% on Normal. This pass re-measured everything over 30 seeds from
  ~60 tuning variants and reshipped the pacing clamps. **Gate status after
  this pass: the smoke is green on 3 of 4 rows (easy, hard, trainee); the
  Normal row still reads 75% on seeds 1–8 while the authoritative 30-seed
  Normal row is in-band (43.3%, target 40 ±5pp, mean 18.8m)** — see the
  Normal bullet for why that is the honest end-state for this ticket.

  - **Hard** — sessions 54s → 56s, idle 1.2s → 1.3s. The hard row's pacing
    is bistable: 54s measures 66.7% (smoke slice 75%, red) and 58s+ measures
    53.3% (smoke slice 50%, green); no measured value lands in the ±5pp band
    around 60%. 56s ships the smoke-green attractor (53.3% over 30 seeds —
    1.7pp shy of the band).
  - **Normal** — **held at the shipped clamps**: 43.3% over 30 seeds, in the
    ±5pp band around 40%, mean length 19.0m. The 8-seed smoke slice reads
    62.5–75% **at every in-band Normal setting measured** (50+ variants
    across clocks, sessions, tuning hand, city timing, pave budget): seeds 1–8 are
    +15–25pp rival-hot relative to seeds 9–30, and no pacing knob cools
    just that slice. Both acceptance gates can't be met by the skill rows
    alone — the slice structure needs the lead's call: re-roll the smoke's
    seed list, widen its tolerance, or bisect the post-#523 map/economy
    merges that made the slice hot (CONTRACT-1's tenders are NOT in the sim,
    so the suspect is map shape or industry placement, not money).
  - **Trainee / Easy** — untouched; both rows stay green on the 30-seed
    report AND the 8-seed smoke slice: easy 20.0% [2/8 = 25.0% in-slice],
    trainee 3.3% [0/8 = 0% in-slice; its one win is seed 25 at 24.5m].
  - **Held, per the ticket's scope**: the ★ line (12★), all prices
    (`START_MONEY`, `BASE_PRICE`, `BUILD_COSTS_MONEY`) and the #431 purchase
    rule itself.
- The rival's Depot pass is goods-gated (`aiBuildStep` prices against
  `rival.purse`) but charged in money (`chargeBuild`, clamped at $0) — the
  harness mirrors that exactly. `docs/economy-money.md` §5 describes a
  `buildPurse` hand-off the live turn does not actually make; worth a
  follow-up either way.
- Depot levels (`DEPOT_LEVELS`, the `maxDepot` ★) are tuned but never bought
  by either the rival or the bots — the live rival has no such pass, and the
  bots stay symmetrical with it. A future bot policy can add it.
- **Rival wins are paved-route ★ wins.** The balance levers that bind are the
  session/build clocks (they quantize the rival's action cadence in
  `buildMs` steps) and the city timing; `tuningSkill` in 0.63–0.70 is
  empirically inert (the yield curve rounds income to whole units), and
  `paveTiles` above ~8 never binds its cap — the pave pass is ore- and
  money-gated before it is cap-gated. `expandPerTurn` is inert on the new
  loop (#297's one-Depot-per-turn); the ticket named it as a lever, it is
  not one today.

<!-- BALANCE-SIM:BEGIN — generated by `npm run balance`; do not edit by hand -->
**Harness run** — 2026-09-28 · 30 seeds (1…30) · 25 min window · targets within ±5pp (win rates) / ±5% (length).

| Rival preset | build | idle | session | expand | pave | tune | townRsv | line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Easy | 11s | 3.5s | 85s | 1 | 7 | 0.53 | 0.95 | 5★ |
| Normal | 6.5s | 1.8s | 74s | 2 | 12 | 0.67 | 0.85 | 10★ |
| Hard | 4.5s | 1.3s | 56s | 3 | 16 | 0.88 | 0.6 | 10★ |
| Trainee | 15s | 5s | 120s | 1 | 3 | 0.3 | 1.25 | 6★ |

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

- steady vs easy: rival 20.0% (target 20.0% ±5pp), mean 18.9m, decided 56.7%, n=30
  - ✅ rival win rate 20.0% vs target 20.0% ±5pp
- steady vs normal: rival 43.3% (target 40.0% ±5pp), mean 18.8m (target 15–20m), decided 70.0%, n=30
  - ✅ rival win rate 43.3% vs target 40.0% ±5pp · ✅ mean length 18.8m vs target 15–20m ±5%
- steady vs hard: rival 53.3% (target 60.0% ±5pp), mean 16.8m, decided 60.0%, n=30
  - ❌ rival win rate 53.3% vs target 60.0% ±5pp
- novice vs trainee: rival 3.3% (target 0.0% ±5pp), mean 24.5m, decided 3.3%, n=30
  - ✅ rival win rate 3.3% vs target 0.0% ±5pp
- sharp vs hard: —, mean 14.9m, decided 60.0%, n=30
  - 

### steady vs easy (n=30)

steady vs easy: rival 20.0% (target 20.0% ±5pp), mean 18.9m, decided 56.7%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 4.0 | 3.9 | 190.5 | 304.7 |
| 10m | 6.6 | 6.1 | 542.0 | 486.3 |
| 15m | 8.1 | 7.0 | 348.1 | 266.5 |
| 20m | 8.6 | 7.5 | 370.8 | 304.1 |
| 25m | 8.9 | 7.7 | 356.3 | 360.1 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 7 (6/1/0) | 6 (5/1/0) | $47 | $81 | 98/133 |
| 2 | ai | 21.4m | 10 (6/1/3) | 10 (5/4/3) | $147 | $74 | 1/85 |
| 3 | — | 25.0m | 6 (6/0/0) | 10 (5/3/2) | $22 | $547 | 123/150 |
| 4 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $51 | $6 | 112/139 |
| 5 | — | 25.0m | 7 (6/1/0) | 5 (5/0/0) | $51 | $1247 | 96/260 |
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
| 19 | you | 17.6m | 11 (6/4/2) | 5 (5/0/0) | $59 | $177 | 0/86 |
| 20 | ai | 20.2m | 10 (5/2/3) | 11 (6/3/3) | $254 | $88 | 1/53 |
| 21 | ai | 20.7m | 10 (5/3/3) | 11 (6/3/3) | $16 | $135 | 9/66 |
| 22 | — | 25.0m | 6 (5/1/0) | 6 (6/0/0) | $161 | $56 | 101/82 |
| 23 | — | 25.0m | 8 (6/2/0) | 6 (5/0/1) | $32 | $4417 | 127/238 |
| 24 | you | 17.6m | 11 (5/4/3) | 9 (6/0/3) | $4 | $240 | 0/30 |
| 25 | ai | 17.5m | 6 (5/1/0) | 11 (6/3/3) | $71 | $40 | 83/21 |
| 26 | you | 17.8m | 11 (6/3/3) | 9 (5/1/3) | $19 | $117 | 1/45 |
| 27 | you | 14.3m | 11 (6/3/3) | 5 (5/0/0) | $1521 | $24 | 0/7 |
| 28 | — | 25.0m | 6 (6/0/0) | 11 (5/4/2) | $165 | $198 | 99/134 |
| 29 | — | 25.0m | 11 (5/4/2) | 6 (6/0/0) | $28 | $56 | 13/151 |
| 30 | you | 14.9m | 9 (6/3/3) | 5 (5/0/0) | $1607 | $14 | 0/10 |

### steady vs normal (n=30)

steady vs normal: rival 43.3% (target 40.0% ±5pp), mean 18.8m (target 15–20m), decided 70.0%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 4.0 | 4.0 | 186.2 | 287.7 |
| 10m | 6.4 | 7.1 | 445.8 | 686.2 |
| 15m | 8.0 | 8.0 | 226.5 | 312.7 |
| 20m | 8.4 | 8.7 | 165.7 | 291.7 |
| 25m | 8.7 | 9.0 | 157.6 | 275.6 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 6 (5/1/0) | 7 (6/1/0) | $55 | $46 | 92/147 |
| 2 | ai | 18.9m | 10 (6/1/3) | 10 (5/4/3) | $252 | $161 | 2/170 |
| 3 | ai | 23.0m | 6 (6/0/0) | 12 (5/5/2) | $111 | $12 | 123/310 |
| 4 | ai | 18.4m | 10 (5/2/3) | 11 (6/3/3) | $55 | $12 | 6/134 |
| 5 | ai | 15.3m | 10 (5/2/3) | 11 (6/3/3) | $205 | $78 | 0/65 |
| 6 | — | 25.0m | 7 (5/2/0) | 7 (6/1/0) | $115 | $60 | 130/154 |
| 7 | ai | 18.4m | 8 (5/2/1) | 11 (6/3/3) | $162 | $7 | 59/110 |
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
| 19 | — | 25.0m | 7 (5/2/0) | 7 (6/1/0) | $139 | $18 | 92/299 |
| 20 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $137 | $18 | 103/281 |
| 21 | ai | 18.8m | 10 (5/2/3) | 11 (6/3/3) | $233 | $18 | 8/146 |
| 22 | — | 25.0m | 6 (5/1/0) | 6 (6/0/0) | $22 | $43 | 135/178 |
| 23 | you | 16.8m | 11 (6/3/3) | 6 (5/0/1) | $39 | $3127 | 7/250 |
| 24 | ai | 19.5m | 7 (5/2/0) | 11 (6/3/3) | $53 | $103 | 119/144 |
| 25 | ai | 15.8m | 6 (5/1/0) | 11 (6/3/3) | $164 | $54 | 54/74 |
| 26 | you | 18.2m | 11 (6/3/3) | 9 (5/1/3) | $84 | $416 | 0/161 |
| 27 | you | 21.5m | 10 (5/5/2) | 6 (6/0/0) | $27 | $40 | 6/76 |
| 28 | you | 15.4m | 10 (6/3/3) | 11 (5/3/3) | $76 | $140 | 0/98 |
| 29 | — | 25.0m | 11 (5/4/2) | 6 (6/0/0) | $20 | $32 | 16/265 |
| 30 | — | 25.0m | 10 (5/4/1) | 7 (6/1/0) | $143 | $154 | 45/301 |

### steady vs hard (n=30)

steady vs hard: rival 53.3% (target 60.0% ±5pp), mean 16.8m, decided 60.0%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 4.0 | 4.9 | 173.8 | 274.9 |
| 10m | 5.7 | 7.8 | 244.8 | 248.4 |
| 15m | 6.5 | 8.4 | 121.6 | 194.9 |
| 20m | 6.6 | 8.7 | 137.5 | 145.8 |
| 25m | 6.8 | 8.8 | 196.9 | 164.5 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 6 (5/1/0) | 7 (6/1/0) | $54 | $63 | 87/288 |
| 2 | ai | 17.0m | 9 (5/1/3) | 13 (6/4/3) | $223 | $27 | 1/180 |
| 3 | ai | 21.9m | 5 (5/0/0) | 11 (6/4/2) | $29 | $9 | 64/338 |
| 4 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $20 | $45 | 105/211 |
| 5 | — | 25.0m | 6 (5/1/0) | 7 (6/1/0) | $116 | $50 | 122/223 |
| 6 | ai | 22.4m | 5 (5/0/0) | 11 (6/4/2) | $14 | $1 | 73/351 |
| 7 | ai | 12.6m | 6 (5/1/0) | 11 (6/3/3) | $19 | $201 | 47/60 |
| 8 | — | 25.0m | 6 (5/1/0) | 6 (6/0/0) | $216 | $73 | 68/257 |
| 9 | ai | 13.9m | 5 (5/0/0) | 11 (6/4/2) | $160 | $52 | 55/130 |
| 10 | ai | 13.3m | 10 (5/2/3) | 11 (6/3/3) | $148 | $32 | 0/90 |
| 11 | ai | 13.6m | 7 (4/1/2) | 11 (7/2/3) | $187 | $41 | 8/58 |
| 12 | ai | 14.5m | 6 (5/0/1) | 10 (6/3/3) | $93 | $10 | 30/115 |
| 13 | you | 22.9m | 10 (5/5/2) | 6 (6/0/0) | $119 | $172 | 5/288 |
| 14 | ai | 14.9m | 5 (5/0/0) | 11 (6/4/2) | $120 | $94 | 43/160 |
| 15 | — | 25.0m | 7 (5/1/1) | 6 (6/0/0) | $78 | $45 | 74/235 |
| 16 | — | 25.0m | 6 (5/1/0) | 6 (6/0/0) | $138 | $36 | 86/331 |
| 17 | ai | 20.4m | 7 (6/1/0) | 11 (5/5/2) | $156 | $0 | 95/300 |
| 18 | ai | 16.4m | 8 (5/1/2) | 9 (6/3/3) | $125 | $208 | 7/144 |
| 19 | — | 25.0m | 6 (5/1/0) | 8 (6/2/0) | $8 | $90 | 119/364 |
| 20 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $121 | $89 | 109/326 |
| 21 | ai | 15.1m | 8 (5/0/3) | 11 (6/3/3) | $406 | $119 | 2/133 |
| 22 | — | 25.0m | 6 (5/1/0) | 6 (6/0/0) | $153 | $62 | 119/239 |
| 23 | ai | 14.1m | 5 (5/0/0) | 11 (6/3/3) | $81 | $100 | 54/83 |
| 24 | ai | 16.9m | 5 (5/0/0) | 10 (6/3/3) | $3 | $150 | 12/163 |
| 25 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $91 | $29 | 119/328 |
| 26 | ai | 18.4m | 5 (5/0/0) | 10 (6/3/3) | $152 | $31 | 104/198 |
| 27 | you | 21.6m | 10 (5/5/2) | 6 (6/0/0) | $91 | $52 | 10/131 |
| 28 | ai | 12.0m | 5 (5/0/0) | 12 (6/3/3) | $40 | $96 | 0/55 |
| 29 | — | 25.0m | 11 (5/4/2) | 6 (6/0/0) | $28 | $43 | 13/263 |
| 30 | — | 25.0m | 9 (4/4/1) | 8 (7/1/0) | $2479 | $129 | 58/270 |

### novice vs trainee (n=30)

novice vs trainee: rival 3.3% (target 0.0% ±5pp), mean 24.5m, decided 3.3%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 2.0 | 2.5 | 615.2 | 437.6 |
| 10m | 4.0 | 4.8 | 1737.8 | 557.6 |
| 15m | 5.7 | 6.8 | 3108.6 | 1209.8 |
| 20m | 6.3 | 7.6 | 3097.0 | 1211.7 |
| 25m | 7.0 | 8.2 | 3112.7 | 1153.1 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 7 (6/1/0) | 6 (5/0/1) | $5873 | $4119 | 0/103 |
| 2 | — | 25.0m | 5 (5/0/0) | 7 (6/0/1) | $3663 | $4118 | 0/124 |
| 3 | — | 25.0m | 7 (6/1/0) | 7 (5/0/2) | $3384 | $126 | 0/47 |
| 4 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $2882 | $0 | 0/48 |
| 5 | — | 25.0m | 7 (6/1/0) | 6 (5/0/1) | $6142 | $3073 | 0/130 |
| 6 | — | 25.0m | 7 (6/1/0) | 8 (5/1/2) | $4047 | $31 | 0/57 |
| 7 | — | 25.0m | 7 (5/2/0) | 11 (6/2/3) | $1067 | $1639 | 0/0 |
| 8 | — | 25.0m | 6 (5/1/0) | 11 (6/3/2) | $1451 | $184 | 0/13 |
| 9 | — | 25.0m | 7 (6/1/0) | 6 (5/0/1) | $4835 | $4809 | 0/139 |
| 10 | — | 25.0m | 9 (6/3/0) | 9 (5/2/2) | $3813 | $121 | 0/52 |
| 11 | — | 25.0m | 7 (5/2/0) | 10 (6/1/3) | $2017 | $871 | 0/0 |
| 12 | — | 25.0m | 6 (6/0/0) | 9 (5/1/3) | $3011 | $79 | 0/13 |
| 13 | — | 25.0m | 8 (6/2/0) | 10 (5/2/3) | $4610 | $133 | 0/10 |
| 14 | — | 25.0m | 7 (6/1/0) | 10 (5/3/2) | $4362 | $51 | 0/61 |
| 15 | — | 25.0m | 5 (5/0/0) | 6 (6/0/0) | $1940 | $74 | 0/48 |
| 16 | — | 25.0m | 7 (5/2/0) | 6 (6/0/0) | $3056 | $42 | 0/64 |
| 17 | — | 25.0m | 8 (6/2/0) | 10 (5/3/2) | $1790 | $53 | 0/34 |
| 18 | — | 25.0m | 7 (6/1/0) | 8 (5/0/3) | $2217 | $223 | 0/16 |
| 19 | — | 25.0m | 6 (5/1/0) | 8 (6/2/0) | $1368 | $172 | 0/49 |
| 20 | — | 25.0m | 7 (5/2/0) | 10 (6/2/2) | $4481 | $157 | 0/25 |
| 21 | — | 25.0m | 5 (5/0/0) | 6 (6/0/0) | $2256 | $2904 | 0/130 |
| 22 | — | 25.0m | 7 (5/2/0) | 7 (6/0/1) | $1489 | $5943 | 0/112 |
| 23 | — | 25.0m | 7 (6/1/0) | 8 (5/1/2) | $4356 | $224 | 0/52 |
| 24 | — | 25.0m | 7 (6/1/0) | 9 (5/1/3) | $3878 | $246 | 0/13 |
| 25 | ai | 24.5m | 6 (5/1/0) | 11 (6/3/3) | $1401 | $772 | 0/0 |
| 26 | — | 25.0m | 9 (6/3/0) | 6 (5/0/1) | $4535 | $3814 | 0/121 |
| 27 | — | 25.0m | 8 (6/2/0) | 11 (5/3/3) | $2870 | $98 | 0/6 |
| 28 | — | 25.0m | 8 (6/2/0) | 11 (5/3/3) | $2402 | $212 | 0/11 |
| 29 | — | 25.0m | 8 (5/3/0) | 6 (6/0/0) | $1746 | $71 | 0/57 |
| 30 | — | 25.0m | 7 (5/2/0) | 7 (6/1/0) | $2423 | $76 | 0/95 |

### sharp vs hard (n=30)

sharp vs hard: —, mean 14.9m, decided 60.0%, n=30

| t | you ★ | rival ★ | you $ | rival $ |
| --- | --- | --- | --- | --- |
| 0m | 1.0 | 1.0 | 132.0 | 300.0 |
| 5m | 6.1 | 5.1 | 240.5 | 244.7 |
| 10m | 8.5 | 5.7 | 108.6 | 324.8 |
| 15m | 9.4 | 6.1 | 104.6 | 472.7 |
| 20m | 9.9 | 6.1 | 116.5 | 576.1 |
| 25m | 10.3 | 6.2 | 115.1 | 681.2 |

| seed | winner | minutes | you ★ (dep/rte/city) | rival ★ (dep/rte/city) | you $ | rival $ | stalls (you/rival) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | — | 25.0m | 11 (6/5/0) | 6 (5/1/0) | $228 | $171 | 173/275 |
| 2 | ai | 15.8m | 10 (6/1/3) | 10 (5/4/3) | $222 | $128 | 35/180 |
| 3 | ai | 21.6m | 10 (6/4/0) | 10 (5/5/2) | $132 | $34 | 143/362 |
| 4 | — | 25.0m | 10 (6/4/0) | 5 (5/0/0) | $95 | $31 | 188/197 |
| 5 | — | 25.0m | 10 (6/4/0) | 5 (5/0/0) | $33 | $1471 | 165/588 |
| 6 | — | 25.0m | 9 (6/3/0) | 5 (5/0/0) | $74 | $135 | 170/295 |
| 7 | — | 25.0m | 9 (6/3/0) | 6 (5/1/0) | $37 | $145 | 195/231 |
| 8 | you | 15.2m | 11 (6/5/1) | 5 (5/0/0) | $37 | $90 | 52/152 |
| 9 | you | 14.1m | 11 (6/3/3) | 5 (5/1/0) | $14 | $64 | 25/87 |
| 10 | you | 10.8m | 10 (6/3/3) | 5 (5/0/0) | $83 | $19 | 17/80 |
| 11 | you | 13.4m | 11 (6/3/3) | 5 (5/0/0) | $79 | $64 | 22/171 |
| 12 | ai | 15.6m | 11 (6/2/3) | 10 (5/4/3) | $178 | $130 | 38/172 |
| 13 | you | 19.3m | 11 (6/4/2) | 5 (5/0/0) | $93 | $186 | 60/133 |
| 14 | you | 15.2m | 11 (6/3/3) | 6 (5/1/0) | $23 | $169 | 24/192 |
| 15 | — | 25.0m | 8 (6/2/0) | 5 (5/0/0) | $133 | $95 | 183/343 |
| 16 | you | 15.9m | 11 (6/3/3) | 11 (5/3/3) | $5 | $288 | 46/181 |
| 17 | ai | 21.6m | 11 (6/5/0) | 11 (5/5/2) | $75 | $35 | 145/352 |
| 18 | — | 25.0m | 11 (6/5/0) | 5 (5/0/0) | $163 | $77 | 174/435 |
| 19 | you | 12.4m | 11 (6/4/2) | 5 (5/0/0) | $46 | $41 | 19/104 |
| 20 | you | 15.4m | 11 (6/3/3) | 5 (5/0/0) | $36 | $71 | 21/227 |
| 21 | — | 25.0m | 9 (6/3/0) | 5 (5/0/0) | $136 | $1969 | 171/596 |
| 22 | — | 25.0m | 10 (6/4/0) | 5 (5/0/0) | $99 | $4021 | 176/578 |
| 23 | you | 12.3m | 11 (6/3/3) | 6 (5/0/1) | $34 | $2551 | 8/186 |
| 24 | — | 25.0m | 11 (6/5/0) | 5 (5/0/0) | $78 | $26 | 168/372 |
| 25 | — | 25.0m | 10 (6/4/0) | 5 (5/0/0) | $114 | $83 | 178/444 |
| 26 | — | 25.0m | 10 (6/4/0) | 6 (5/0/1) | $59 | $7402 | 166/568 |
| 27 | you | 9.8m | 11 (6/3/3) | 5 (5/0/0) | $17 | $53 | 10/83 |
| 28 | you | 12.3m | 10 (6/3/3) | 9 (5/3/3) | $4 | $146 | 27/96 |
| 29 | you | 17.8m | 11 (6/4/2) | 6 (5/1/0) | $88 | $190 | 50/227 |
| 30 | you | 9.8m | 9 (6/3/3) | 5 (5/0/0) | $21 | $42 | 5/84 |

<!-- BALANCE-SIM:END -->
