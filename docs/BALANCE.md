# BAL-1: match arc and rival difficulty calibration

## Running

- `npm run balance:sim` runs 30 deterministic map seeds against Easy, Normal, and Hard and writes the full per-seed trace to `docs/playtest-reports/balance-471.json`.
- `npx vitest run tests/unit/iso-471-balance-smoke.test.ts --reporter=dot` is the short deterministic opening-window smoke check included in `test:slow` (3 seeds, 1 simulated minute each; ~101 seconds locally). It checks trace validity, not calibrated target drift.
- The balance runner compares the current Normal AI policy (used as a steady proxy) against each rival preset. It records victory time, winner, stars over time, and a resource stock-value proxy over time.

## Important scope and limitations

This is a first measurement pass, not proof that the ticket targets have been met. The existing race harness predates BAL-1 and does not reproduce the live money ledger and market, so its base-price resource value is **not actual money**. It also does not implement separate novice/steady/sharp scripted player bots, and it does not simulate FTUE-1 completion. Consequently the measurements cannot validate actual match length, difficulty win-rate targets, or the trainee-never-wins constraint. No balance knob has been changed based on this incomplete proxy. A live-economy simulation and bot policies are required before making claims against those acceptance targets.

## Current target status

| Target | Status |
| --- | --- |
| Normal match length 15–20 minutes vs steady | Not verified by the legacy harness; requires the live-economy clock and a faithful steady bot. |
| Rival win rate Easy ~20%, Normal ~40%, Hard ~60% (±5%) | Not verified; calibrate against scripted player policies, at least 30 seeds per level. |
| Trainee (FTUE-1) never beats novice | Not verified; FTUE-1 dependency is not merged. |
| Smoke check catches >15% drift | Smoke currently guards only deterministic completion/progress; rate and duration drift gates need calibrated baselines first. |

## Tuning history

No changes to ★ thresholds, clocks, rival action cadence, `START_MONEY`, `BASE_PRICE`, or the build-money table were made for this report. The existing price and money rules remain documented in [economy-money.md](economy-money.md).
