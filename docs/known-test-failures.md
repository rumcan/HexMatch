# Known Test Failures

This file tracks tests that are **quarantined** on `main` — they are `it.skip` / `test.fixme` with a linked issue, instead of being left red. When a row is fixed, delete it. When everything is green, this file stays at the header only.

> Contract: never leave `main` red. If something cannot be fixed immediately, quarantine it here and link the tracking issue. See `AGENTS.md` §6 and [#200](https://github.com/rumcan/HexMatch/issues/200).

| Test file | Test name | Since | Issue | Reason | Owner |
|---|---|---|---|---|---|
| _none — `main` is green as of #205 + #200 remediation_ | — | — | — | — | — |

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
