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

## Slope rules and uphill costs (E4 #268)

Elevation is a **solo map option** (`?elevation=1`, or `opts.elevation`), so every
number below is inert when the option is off: the rules answer "may I", the
costs are zero and the payout is byte for byte the flat game's.

The numbers live in one table — `SLOPES` in `src/iso/config.ts` — and every
gameplay reader goes through `src/iso/slopes.ts`:

| number | value | what it buys |
| --- | --- | --- |
| `roadMaxStep` | 1 | a road (either tier) climbs at most **one level per tile**; the drag stops at the steeper tile and builds the prefix, and a tile that would *join* standing track across a steeper step is refused too |
| `railMaxStep` | 1 | the same limit for rail |
| `railRampRun` | 3 | two level changes must sit **at least 3 steps apart**: a climb is a ramp, never a one-tile cliff. Two changes inside the run, or a diagonal step that also climbs, are refused (`too-steep` / `slope-diagonal`) |
| `climbTiles` | 2 | each level a route climbs or drops counts as **2 extra tiles** of L3 distance (`#217`), so a hill route bands lower than the same length of flat road and the clock pays it slower |
| `uphillSlow` | 1 | a vehicle climbing one level moves at `1 / (1 + levels)` of its speed — halved for one level. Presentation only: the clock is paid by `climbTiles` |

**Why `railRampRun` = 3.** The generator's own inland grade is about one level
per ten tiles, but it also leaves ±1 jitter: on seed 1337 with rivers, 26% of
adjacent tile pairs differ by a level. A run of 3 is three times gentler than
the terrain's own climb, so a *drawn straight line* over a one-tile step is
refused and the player (and the rival) must route to a proper ramp — while every
tile of a 144×144 map is still rail-reachable under the rule (measured by BFS
over the rule's own run state on seeds 42/1337/7/199/20260925: reach is
identical with the run set to 2, 3 or 4, i.e. the rule costs no reachability at
all, it only chooses *where* the ramp goes).

**Exemptions, and why bridges and dams still work.** A tile standing on water
can only be a bridge deck (or the dam's river tile), and the bridge/dam is the
structure that levels its own crossing: the deck sits at water level while its
bank may be any height, so **steps onto, off and along a deck are exempt** from
the grade and the run, and **only the land tiles of a footprint** are graded.
Without that, rail bridges would be illegal on nearly every river: on seed 1337,
51 of 52 river-bank tiles sit one level above the water.

**Footprints.** A Depot's 2×2 lot, a processing plant, the starting Factory, a
railway platform's 1×3 and a dam's dry half all need a **level footprint**
(`not-flat`, "Needs flat ground"): the art is drawn on one diamond and the
rules (catchment, lanes, footing) assume one plane.

**The rival** rehearses the same rules: `roadStepRefusal` is impassable in
`stepCost`, `planRailRoute` carries the ramp run in its A* state (`tile ×
heading × run`), a level change is priced (`COST_SLOPE` 1.5 a level on roads,
6 on rail) and `validateRailDrag` re-checks the whole drag with the shared
rule, so it can never plan a build the player's own preview would refuse.

## Follow-ups (not in this PR)

1. **An economy that can reach rail.** Give the rival a reason to hold Oil: plan an Oil Rig depot or bank toward Oil. Consider starting rail only after the opening network, for example two or more depots. Possibly tune the platform's Oil and Ore price.
2. **Pave and rail in the same turn.** It can't be measured until rail actions happen. Rerun `mixed` against `exclusive`.
3. **Rerun this matrix** and fill in this document before switching the flag on anywhere.
4. **Rendering** is #177's vector rail pass on main (`rail-geometry` / `railDrawLayer`); this PR's parallel rendering was dropped in favour of it when main was merged.
