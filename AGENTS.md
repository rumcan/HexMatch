# Agent Contract — HexMatch

> **Rule zero: `main` is green. Any failure on your branch is yours to investigate.**

This repo is built by many AI agents (and humans) in parallel. A red `main` wastes every other agent's time — each has to re-discover which failures are "theirs" by checking out `main`, re-running suites and comparing. Real regressions hide in the noise; agents "fix" unrelated tests to get green; trust in the suite collapses and `main` gets redder.

This contract keeps `main` green and tells you exactly what to run and what not to touch.

---

## 1. The promise

- `npm run typecheck && npm test` passes on a clean checkout of `main` — locally and in CI — with **no suite-load errors**.
- `npx playwright test --project=desktop-chromium` passes on `main`.
- Two consecutive full CI runs on `main` are green (no flakes).
- A PR with a failing required check **cannot merge** (branch protection on `main` — `ci / test` and `ci / e2e` are required).

If you see a failure on `main` itself, **stop and report it** — link [issue #200](https://github.com/rumcan/HexMatch/issues/200) and the failing run. Do not "fix" the test by loosening its assertion to make your PR green.

## 2. How to check a failure against `main` quickly

Don't re-run the whole suite on `main`. Isolate the one spec that failed on your branch, then run that same spec on `main` in a worktree:

```bash
# one-time: keep a worktree of main beside your checkout
git worktree add ../main-check origin/main

# later, after you see a failure on your branch:
# 1) reproduce it on your branch (example: one file, one test name)
npx vitest run tests/unit/iso-game.test.ts -t "mounts three canvas layers"

# 2) run the SAME command in the worktree
../main-check/node_modules/.bin/vitest run tests/unit/iso-game.test.ts -t "mounts three canvas layers"
# or simply:
(cd ../main-check && npm ci && npx vitest run tests/unit/iso-game.test.ts -t "mounts three canvas layers")

# if it passes on main and fails on your branch → it is yours
# if it fails on main too → main is red: file a bug, link #200, do not relax the test
```

For Playwright:

```bash
npx playwright test --project=desktop-chromium tests/e2e/iso-game.spec.ts
# same worktree check
(cd ../main-check && npx playwright test --project=desktop-chromium tests/e2e/iso-game.spec.ts)
```

Clean up when done: `git worktree remove ../main-check`.

## 3. Never loosen or skip an unrelated test to get green

- Don't change an assertion that has nothing to do with your ticket.
- Don't add `it.skip` / `test.fixme` without a **linked issue number** in the skip reason, and an entry in `docs/known-test-failures.md`.
- If you quarantine a test, the file `docs/known-test-failures.md` must list it: what it asserts, why it is quarantined, which issue tracks the fix, and when it was added. The file stays empty (header only) when all is well.

Rule of thumb: **if you didn't change the code the test covers, you shouldn't change the test.**

## 4. What to run for your change

### Fast path — every PR

```bash
npm run typecheck
npm test                          # fast unit project (excludes heavy seed sweeps)
npx playwright test --project=desktop-chromium   # single-desktop e2e (required CI check)
```

`npm test` is the **fast** unit suite. Heavy seed sweeps (`iso-ai-sweep`, `iso-rebalance`, `iso-debug` network dump) live in `npm run test:slow` so the default suite stays deterministic under full-suite load. Only run the slow project when you touch **AI, map generation, rival placement, or economy balancing** — or when CI tells you to.

### When you changed...

| You touched | Run this | Why |
|---|---|---|
| **UI / HUD / theme / `src/game/ui.ts` / `src/game/styles.css` / `assets/ui-src`** | `npm test` + `npx playwright test --project=desktop-chromium tests/e2e/iso-game.spec.ts tests/e2e/building-layers.spec.ts` | layout + HUD assertions run on every Playwright project (#205 audit added 10-tool bar) |
| **Game logic / economy / placement / `src/iso/*`** | `npm test` + the one relevant spec, e.g. `npx vitest run tests/unit/iso-pp07-costs.test.ts` | fast feedback on the rule you changed |
| **Map gen / AI / balancing / `src/iso/grid.ts` / `src/iso/economy.ts` / `src/iso/rail.ts`** | `npm test` + `npm run test:slow` + `npx playwright test --project=desktop-chromium` | slow sweeps are the only ones that generate 144×144 maps and run A* over them |
| **Story / cutscene / `src/story/*` / `tests/e2e/story.spec.ts`** | `npm test` + `npx playwright test --project=desktop-chromium tests/e2e/story.spec.ts tests/e2e/continue-game.spec.ts` | story boots a separate `?chapter=` URL, not the solo iso boot |
| **Multiplayer / `src/net/*` / `src/rooms/*` / `rundot/*`** | `npm test` + `npm run test:e2e:mp` (needs dev server + `rundot/realtime.e2e.config.json`) | the MP suite runs `vite dev` with the real room sidecar, not `vite preview` |

### Full CI replication (rarely needed)

```bash
npm run typecheck
npm test                 # fast
npm run test:slow        # only if you touched AI/map
npm run test:e2e         # full desktop-chromium (builds first, ~5 min)
npm run test:e2e:mp      # multiplayer (dev server, 60s grace waits)
```

## 5. Suite quirks — read before you "fix" a flake

- **Atlas pixels / manifest / parse-pnml** — these tests read `assets/iso-atlas/manifest.json`, `tools/iso-atlas.cells.json`, and the PNML declarations in `src/assets/sprites/pnml/`. If the gitignored artifact `tools/opengfx-sprites.json` is missing (clean checkout before `node tools/parse-pnml.mjs`), the suite now **skips with a clear message** instead of crashing with `SyntaxError: Invalid or unexpected token`. Run `node tools/parse-pnml.mjs` to regenerate it; CI does this before `npm run slice-atlas`.

- **Scenery / vehicle art loads** — unit tests boot the real game in `jsdom`. `fetch("/assets/...")` for scenery/ground/decals uses relative URLs that resolve to `file:` under `vitest` — they log `TypeError: Failed to parse URL from /assets/...` and fall back to placeholders. Those `[scenery] not installed` warnings are **expected noise** in `npm test` — they do not fail the test. Only a missing **required** sprite (e.g., `road_0011`) fails.

- **Seed sweeps are heavy** — `iso-ai-sweep` (184 lines, 4 seeds × multiple AI turns), `iso-rebalance` (40-seed ore-distance sweep, ~3s locally), `iso-debug` `dumpNetwork` (≈10s per boot). They have `testTimeout: 30_000` (or per-test 10_000) and `hookTimeout: 30_000` in `vitest.config.ts`. Under full-suite parallelism they can still exceed the shared runner's budget — hence the `test:slow` split and `poolOptions.maxThreads = 3` tuning so full runs behave like isolated runs. If a sweep flakes only under `npm test` but passes alone, run it alone and file a `docs/known-test-failures.md` entry with the seed / timeout, rather than bumping the global timeout.

- **E2e boot waits** — desktop boots in ~20s (`bootBudget()` in `tests/e2e/boot.ts`), phone emulation (dpr 2–3, software raster) needs 150s. `bootSoloIso` waits for `__iso.phase === "setup-factory" && !__iso.loading && __iso.grid.industries.length > 0` — never a fixed `sleep`. Building-layer specs additionally wait for `__iso.artLoad.ready` (the loading screen's own completion flag) and poll for inclusion of every `assets/buildings/manifest.json` name, because `loadBuildingLayers` installs PNGs as they arrive. If you add a new art set, expose a new `__iso.artLoad.*` flag and wait for it — don't add `waitForTimeout`.

## 6. Quarantine protocol

If a test cannot be fixed right away:

```ts
// in the test file
it.skip("gives wood, stone, grain, ore and oil each a useful role — see #200", () => { ... });
// or Playwright
test.fixme("boot times out on CI — tracked in #201", async () => { ... });
```

And in `docs/known-test-failures.md`:

```md
| Test file | Test name | Since | Issue | Reason | Owner |
|---|---|---|---|---|---|
| `tests/unit/iso-pp07-costs.test.ts` | "gives wood … useful role" | 2026-09-14 | #200 | RAIL-04 added platform/trainDepot/train oil costs — test expects only depot | @rumcan |
```

The nightly e2e workflow (`e2e-nightly.yml`) automatically opens or updates a tracking issue when the full viewport matrix fails — no manual filing needed. Daytime PR CI only blocks on `desktop-chromium`.

## 7. Branch protection (for maintainers)

`main` is protected:

- Require PR before merging
- Require status checks: `ci / test` and `ci / e2e` must pass
- Require branches to be up to date before merging
- Dismiss stale approvals on new pushes
- Do not allow force-pushes or deletion

Enable with `gh` (one-time):

```bash
gh api repos/rumcan/HexMatch/branches/main/protection \
  -X PUT \
  -f required_status_checks='{"strict":true,"contexts":["test","e2e"]}' \
  -f enforce_admins=true \
  -f required_pull_request_reviews='{"required_approving_review_count":1}' \
  -f restrictions=null
# or via Settings → Branches → Branch protection rules on GitHub
```

## 8. Where to look when `main` is red

1. **CI run** — `.github/workflows/ci.yml` (typecheck → `npm test` → `slice-atlas` → `e2e` → `e2e-multiplayer`)
2. **Nightly** — `.github/workflows/e2e-nightly.yml` (full matrix, posts report artifact, opens tracking issue on failure)
3. **Local full replication** — `npm run typecheck && npm test && npm run test:slow && npx playwright test --project=desktop-chromium`
4. **This issue** — [#200](https://github.com/rumcan/HexMatch/issues/200) ("Get main green and keep it green") is the umbrella. File follow-ups against it.

---

*Filed from the #200 remediation. If this document itself is wrong, fix it — and keep the contract short enough that the next agent actually reads it.*
