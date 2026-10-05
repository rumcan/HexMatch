# Known Test Failures

This file tracks tests that are **quarantined** on `main` — they are `it.skip` / `test.fixme` with a linked issue, instead of being left red. When a row is fixed, delete it. When everything is green, this file stays at the header only.

> Contract: never leave `main` red. If something cannot be fixed immediately, quarantine it here and link the tracking issue. See `AGENTS.md` §6 and [#200](https://github.com/rumcan/HexMatch/issues/200).

| Test file | Test name | Since | Issue | Reason | Owner |
|---|---|---|---|---|---|
| `tests/unit/iso-progression.test.ts` | `PP-07 opening progression on the real 144×144 map` (whole describe) | 2026-09-30 | _to file_ | The six-seed cargo-purse opening simulation trips its 90 s SLOW watchdog (seed 1337: 2 Depots / 1 plant at t=172 s) since the x3 price pass and ECON-1 (builds paid in $). Needs re-modelling on money; ~90 s of wall time when it runs. | lead |
| `tests/unit/iso-l8-legibility.test.ts` | the four `L8 the quest panel on a live game` tests (`offers 2-3 plans…`, `pays a completed quest once…`, `never touches what the win rule…`, `rides the save…`) | 2026-09-30 | _to file_ | OBSOLETE, not a bug: CONTRACT-1 (#466) replaced the L8 quests panel with town contracts (covered by `iso-466-contracts.test.ts`). Delete or rewrite them against contracts. | lead |
| `tests/e2e/iso-game.spec.ts` | `gameplay: factory → harvester → Dirt Road drag → cargo flows, 0 VP` | 2026-09-30 | #623 | Pointer round written for the pre-redesign HUD. Boot/corridor/flyout steps are already updated (seed 1337, town-side camera framing, Road Ways flyout), but the overlay-pixel probes (`getImageData` on the 2D overlay, software GL) stall for 30s+ and the Depot click point lands under the new HUD (bottom dock / toast). Needs a re-author against the redesigned HUD; the same drag is covered by the `__iso.dragPreview` / unit specs. | unassigned |
| `tests/e2e-mp/mp-rejoin.e2e.spec.ts` | `(a) a reload-dropped guest is announced with a countdown, and the walk back resumes the SAME match` | 2026-10-03 | #671 | `test.fixme` (E2E-GREEN-1, #666). The flow's functional steps all pass; its final claim — `wireHas(host, "room:playerLeft") === false` at `:106`, "the held seat was never evicted" — races the room's pinned 60 s reconnect grace (`rundot/realtime.e2e.config.json`), which the reloaded guest's cold boot cannot reliably beat on a software-GL runner. Same commit, two outcomes: run `37153641120` passed shard 5 while `37153644301`, started the same minute, failed this assertion on both attempts; shard 5 is 9 red / 9 green over the last 18 completed runs (excerpt + table in #671). Fix = a longer `reconnectTimeout` for this shard's rooms config (a file outside #666's scope) or a cheaper return trip; the assertion is untouched. | lead |
| `tests/e2e-mp/mp-rejoin.e2e.spec.ts` | `(b) an abandoned RANKED match credits the survivor: the win is filed and the rating moves` | 2026-10-05 | #711 | `test.fixme`. Red on main since d4bfb52c (TOWN-4.5: rooms default to the large 216 map). After the reload the seat never shows "Match in progress" at `:151` within 30 s (retry: a 60 s click timeout); the large-map cold boots of two windows outrun the budgets on a 2-core runner. Fix = a cheaper large-map boot, or a standard-map e2e queue / larger shard budgets; the assertion is untouched. | lead |
| `tests/e2e-mp/mp-battle.e2e.spec.ts` | `B6: two browsers challenge, play and finish a battle on the same board; a refresh rejoins it` | 2026-10-01 | _to file_ | `test.fixme`. Fails on a loaded Windows machine at a different step on every run (screens one move apart, a `page.evaluate` that never returns, the rejoin's log off by one after the 60 s turn clock auto-played the idle seat). No single deterministic app failure; needs investigating on a quiet runner. Owner: the lead decides. | lead |

## Notes

- 2026-09-22 (B5 branch): two `test:slow` failures observed **on the base itself** (pre-existing, untouched by the branch's diffs):
  1. `tests/unit/iso-rebalance.test.ts > still gates road behind an ore mine (pass 1 structure, PP-07 prices)` — FAILS IN ISOLATION. The test asserts `TRANSPORT.dirt.cost.stone === 1` / `.wood === 1`, but `BUILD_COSTS.dirt` is deliberately `{}` (a Dirt Road is free — the config's own comment states the intent). Stale assertion vs the free-dirt pricing decision; needs a main-side reconciliation (update the assertion, or re-price dirt) under [#200](https://github.com/rumcan/HexMatch/issues/200). Not touched here (unrelated to B5).
  2. `tests/unit/iso-ai-sweep.test.ts > every player placement yields a road-legal, reachable rival tile` — timed out at the default 15s in the batch (the sweep ran 116s under load). Same load-flake class as the earlier #186 note (heavy sweep + `poolOptions.maxThreads = 3`); passes intent-wise when run with a generous timeout. Not quarantined; tracked as infra flake under [#200](https://github.com/rumcan/HexMatch/issues/200).
- 2026-09-22: `tests/unit/iso-match-settings.test.ts > #186 an AI seat is simulated on the host` (#186) is **load-flaky**: it polls `host.aiTick(...)` through a two-browser pump and has failed once (2026-09-22) under full-suite heap pressure while passing in isolation and in a clean full run. Not quarantined — no assertion change; tracked as a test-infra flake under [#200](https://github.com/rumcan/HexMatch/issues/200). If it recurs on CI, quarantine with a link there rather than loosening the polling expectations.

- 2026-09-30 (green-baseline ticket): the default `npm test` had 30+ red tests (stale after the x3 price pass, ECON-1 money, CONTRACT-1, CAST-1, MAP-2 and the four-long platform art) and timed out CI's 10-minute step. Stale expectations were updated with a `STALE (...)` comment naming the change; the whole-race / balance / calibration files moved to `npm run test:slow` (see AGENTS.md section on the fast suite): `iso-game`, `iso-vp-race`, `iso-skill-calibration`, `iso-297-rival-pace`, `iso-412-rival-smoke`, `match3-balance-bot`, `iso-471-balance-trace`, `iso-471-balance-trace-smoke`, `battle-balance`. The two `iso-297-rival-pace` "no burst on seed 7/42: Hard rival never won" tests FAIL when run (rival never wins inside the sim window since the balance pass) - they now live in `test:slow`; the lead should decide whether that is a balance regression or a stale window.
- Also observed: `src/game/ui.ts` uses the class `confirm-sheet` for the placement confirm while `src/iso/confirm-sheet.ts` uses `modal-root confirm-sheet` for the leave/quit sheet - a shared class name (the leave-room tests now select `.modal-root.confirm-sheet`).

## How to quarantine

In the test file:

```ts
it.skip("gives wood, stone, grain, ore and oil each a useful role — see #200", () => { ... });
// or Playwright
test.fixme("boot times out on CI — tracked in #201", async () => { ... });
```

Then add a row above. Include:

- **Test file** — path relative to repo root
- **Test name** — exact `it`/`test` title
- **Since** — date added (YYYY-MM-DD)
- **Issue** — GitHub issue number that tracks the fix
- **Reason** — why it is quarantined (e.g., "RAIL-04 added platform oil cost — assertion expects only depot")
- **Owner** — who is tracking it

## History

- 2026-09-14: Initial file created as part of [#200](https://github.com/rumcan/HexMatch/issues/200) — "Get main green and keep it green". No quarantined tests at creation; the 7 failing unit tests and 3 heavy sweeps were fixed by tuning `vitest.config.ts` (`poolOptions.maxThreads = 3`) and updating assertions for the new railway tools (RAIL-04 audit, #178) that landed in #205.

## Re-checking a quarantined test

Run the one test against `main` in a worktree (see `AGENTS.md` §2) to confirm it still fails there before re-enabling:

```bash
git worktree add ../main-check origin/main
(cd ../main-check && npx vitest run tests/unit/iso-pp07-costs.test.ts -t "gives wood")
git worktree remove ../main-check
```
