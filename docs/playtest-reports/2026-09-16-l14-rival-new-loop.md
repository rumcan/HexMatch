# L14 (#229) playtest — the rival plays the new loop

**Date:** 2026-09-16
**Ticket:** #229 *L14 — Rival AI plays the new loop* (epic #223, wave M5)
**Build:** `arena/01a0aa3e-hexmatch`, dev preview `?loop=new` (DEV-only, solo)
**Harnesses:** the race sim (`tests/unit/iso-l1d-race.test.ts`, `npm run
test:slow`) and a headless LIVE game — a scratch jsdom probe that boots the real
module and drives `econTick` / `aiTick` / `tick` / `truckTick` at 1 s steps, the
same shape AI-02's report used.

## The turn

Under the flag the rival runs the player's verbs in the player's order, priced
through the same functions:

1. **Connect** — `aiBuildStep` with L2's cost model (dirt is free) reaches a
   fresh industry and stands a Depot on it. The ranking is steered by the TREE
   (`treeGoal`/`treeWants`): a seat short of grain for its Quarry Depot connects
   a Farm instead of buying a fourth forest with the wood it is rich in.
2. **Tune** — the simulated session (`applyRivalTuning`, L4/L10) levels every
   Depot it just raised, which is also what opens the next rung (L5's gate).
3. **Spend** — the city upgrade, timed by `townReserve`; otherwise a re-match on
   a Depot that has actually cooled (L6's decay, the player's own key).
4. **Pave** — the ★ seam (#228 removes it: see below), then the railway.

Retired under the flag, not deleted (the shipped loop still runs them): board
autoplay (`rivalAutoplay`), market offers (`rivalMarketOffer`), the 4:1 bank
(`rivalBankTowardPave` / `rivalBankTowardPlan`), and the deep-plan cache only
the bank reads.

## The deadlock this ticket had to fix

`planCandidates` dropped a whole candidate when the NEAREST tile of the seat's
own network was illegal ground — a town ring, a public highway, an industry rim.
On a grown network that is most of the board, and the seat then had no candidate
left anywhere:

```
# seed 7, newLoop, 12 simulated minutes, rival purse grain 286 / wood 189 / stone 202
CANDS real 0 []                       ← every candidate dropped
CANDS deep 1 [ gold_mine@9,120 ]      ← the same planner with a bottomless purse
```

`nearestBuildableSource` (ai.ts) walks the distance order until the tile can
actually be built on. Gated to the new loop: on the shipped loop the old drop was
skipping the A* for most of the board — running it there cost a 12-minute shipped
race 3.5× its wall clock to reach the identical result.

## Races — before this ticket / after

Both seats are the live rival's own policy; the win line is 10★.

| seed | before (HEAD) | after | rival depots (before → after) |
|---|---|---|---|
| 1337 | you 10.25★ / ai 4.75★ at 2.0 m | you 10.5★ / **ai 8★** at 1.5 m | 5 → 13 |
| 7 | you 10.25★ / ai 8.5★ at 2.8 m | you 10.25★ / **ai 9.5★** at 1.4 m | 5 → 12 |
| tree 7 | you at 2.8 m (ai rung 2, city 0) | you at 1.4 m (ai rung 2, city 1) | 5 → 12 |
| tree 42 | **ai** at 1.5 m (ai 17 depots) | you at 1.2 m (ai city 1) | 17 → 12 |
| tree 79 | you at 1.6 m | you at 1.3 m | 4 → 12 |
| tree 199 | you at 1.4 m (ai rung 1) | **ai** at 1.4 m (ai rung 2, city 1) | 1 → 13 |
| tree 1337 | you at 2.0 m | you at 1.5 m | 5 → 13 |

Every seed finishes, every seat reaches **rung 2 and city level 1**, and the
rival is now inside ~1–2★ of the human chair instead of 2–5★. The rival wins 1
of the 7 seeds before and after — on this harness the human chair moves first,
so the mirror is the rival's worst case.

## Difficulty ladder (new loop, 3 seeds × both chairs, pooled ★)

| pooled | hard | easy |
|---|---|---|
| 3 seeds × 2 chairs, 30 m windows | **62.5★** | 14.75★ |

Hard wins every lane at ~1.0 m; easy is still racing at 1.5–2.75★. The hard
seat re-tuned 7 Depots per race, the easy seat 0 — the difficulty's decay
(`DIFFICULTY_RULES`) and its answer (`rivalRetuneStep`) both scale.

## Live game — what the player sees

Seed 1337, `?loop=new`, player idle, 4 simulated minutes (normal):

```
minute 1:  you 0★ / rival 4.25★ — 18 rival Depots
minute 2:  you 0★ / rival 10★   — 25 rival Depots (every industry on the map)
```

Feed lines from that run, in the player's own wording:

```
Rival expands: a new Depot and 20 road tiles
Rival paves 4 tiles (+1★)
Rival reach 7★ of 10★
```

and, on Hard:

```
Rival re-tunes a Depot: yield ×…
Rival upgrades its city: base rate +…% (score …)
```

At HEAD the same probe ended with the rival at 20 Depots and a line the new loop
no longer writes at all: *"Rival offers 4 Grain → 2 Ore — take it from the
Market tab"* — the MVP hides the Market, so the offer is gone with it.

## Verdict

*It feels like it is doing the same thing you are.* The rival connects Depots
along free gravel, climbs the same tree, buys the same city upgrade, re-tunes
what cools, and announces it in the same feed sentences. On Normal it wins some
maps and loses others by about a star; Hard is not a faster clock but a harsher
rule (its yields cool, its sessions are docked by its own obstacles) and it
still wins the ladder by 4×.

## Checks run

| command | result |
|---|---|
| `npm run typecheck` | clean |
| `npm test` (whole fast suite, this 2-core sandbox) | 33 failed / 2362 passed — **the identical 33 at pristine HEAD** (`9750e30`, same box, same run shape): the failure set is byte-for-byte the same, so the branch adds none (the comparison worktree also carried a scratch probe file, hence its ±1 file/pass count). It is the pre-existing dirt-is-free / allowance / renderer-policy set (`iso-ai` ×8, `iso-game` ×8, `iso-performance` ×2, `iso-plant-edge` ×2, `iso-mp` ×2, plus `iso-corridor-picker`, `iso-depot-cost`, `iso-detail-tiers`, `iso-graphics`, `iso-market`, `iso-match-settings`, `iso-skill-calibration`, `iso-victory`, `iso-vp-race`). |
| `npm run test:slow` | 3 failed (2 in `iso-ai-sweep`, 1 in `iso-rebalance`) — the same three at HEAD. **`iso-l1d-race.test.ts` passes: all 7 races finish.** |
| `npx playwright test --project=desktop-chromium` | not runnable here: the chromium download is blocked in this sandbox (`ECONNRESET` from `cdn.playwright.dev`). |

## Follow-ups (not this ticket)

- **#228 (L13)** removes the ★ seam: `rivalPavePass`, its call in
  `aiNewLoopTurn`, and `scoreCargoWant` in ai.ts (the want that exists only so a
  seat with no ore of its own can buy a point).
- **#226 (L11)** re-cuts trading; the bank/market levers are still `RivalSkill`
  fields for the shipped loop.
- **#220** can now re-tune the new loop's own levers: `buildMs`/`idleMs` (the
  reaction clocks), `tuningSkill` (session quality), `townReserve` (upgrade
  timing), `expandPerTurn` (spread).
