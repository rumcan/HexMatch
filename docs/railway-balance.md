# Railways v1: balance and release gate (#182)

## Release gate

- The railway sits behind a feature flag that is **off in every mode by default**. `?rail=1` (or the `rail` start option) turns it on for testing and playtests.
- When the flag is off, the build buttons don't exist and the host refuses rail requests from a guest.
- It stays off until #179 (construction UI) and #181 (multiplayer authority) are done and this document has passing balance results. Rail in the campaign needs its own decision, plus tutorial and objective updates.

## How it is measured

- `tests/unit/iso-rail-balance.test.ts` is gated with `RAIL_BALANCE=1`. It races two AI seats through `tests/unit/helpers/race.ts`: one seat plays a railway strategy, the other plays road only, in both chairs.
- Seeds 7, 42, 79, 199 and 1337, normal skill; hard on seeds 7 and 1337.
- Strategies:
  - `mixed`: the live order, road turn then one rail action;
  - `exclusive`: a rail action only on turns where the road did nothing;
  - `railFirst`: the rail action first, then road building;
  - `platforms`: platforms only, for their points.

```bash
RAIL_BALANCE=1 RAIL_BALANCE_SEEDS=7 RAIL_BALANCE_OUT=out.jsonl npx vitest run tests/unit/iso-rail-balance.test.ts
```

## Result (2026-09-14): the rival never builds rail

**51 races, 0 rail actions.** Every rail strategy produced exactly the road-only result: same winners, same times, same scores. So the balance acceptance items (no deadlock, no dominant platform-only strategy, 1★ per platform) **cannot be judged yet**.

**Why:** the planner works. It finds 11–15 targets per map and plans a platform each turn, but it never affords one. A platform costs 4 Wood, 4 Stone, 12 Ore and 2 Oil:

- **Oil stays at 0 for the whole game.** No opening depot mines Oil, and the bank only turns surplus into Ore for paving.
- **Ore is spent as it arrives,** by paving (4 at a time), road building and plants.

**What was tried:** reserving the platform's Ore from paving and banking toward the missing cargo. It still produced 0 rail actions, because Oil never arrived, and it cut the rail seat's score (seed 1337: 10★ → 3.75★). It was backed out.

## Follow-ups (not in this PR)

1. **An economy that can reach rail.** Give the rival a reason to hold Oil: plan an Oil Rig depot or bank toward Oil. Consider starting rail only after the opening network, for example two or more depots. Possibly tune the platform's Oil and Ore price.
2. **Pave and rail in the same turn.** It can't be measured until rail actions happen. Rerun `mixed` against `exclusive`.
3. **Rerun this matrix** and fill in this document before switching the flag on anywhere.
4. **Rendering polish from the screenshots** (`docs/railway-08/`):
   - the track reads a little like a road: dark bed, light edges, sleepers barely visible at zoom 2;
   - the zoom 2 and zoom 1 captures look close in scale;
   - no train sprite was visible in the moving-train capture.
