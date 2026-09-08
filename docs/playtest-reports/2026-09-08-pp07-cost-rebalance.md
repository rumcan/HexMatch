# PP-07 playtest — construction cost rebalance on the real 144×144 map

**Date:** 2026-09-08
**Ticket:** `docs/HexMatch-tickets.md` → *PP-07 — Rebalance construction and
expansion using Catan-style resource roles*

The ticket requires: *"Test opening progression and expansion on the actual
144×144 map, not just short synthetic routes"* and *"Record time to first
connection, second Depot and second processing plant during playtesting."*

## Method

Headless sessions, one per map seed, driving the **real modules** — no game
code mocked:

- opening Factory: a human-style choice (beside the industry nearest the land
  centroid, footprint on legal ground),
- builds: `aiBuildStep` (A* planning + the authoritative cost table
  `src/iso/construction.ts`, including the paid-Depot charge resolved by
  `priceDepot` against the player's `freeDepots` allowance),
- income: the `playerResources` trickle + the PP-07 fractional carry,
- trading: the real `bankTrade` 4:1 bank, Gold blocked (PP-08), max two
  exchanges per economy tick, banking toward the plan the session actually
  wants (least shortfall, road legs),
- plants: `canAffordPlant` → `chooseAiPlantSpot` → `addPlant`, charged once.

The match-3 Processing Plant is deliberately **not** simulated. Trickle +
bank is the *conservative* income model: a human actively matching tokened
gems earns faster and can manufacture cargo the network does not reach
(PP-04), so anything achievable headless is also achievable in hand — and
usually sooner.

Runs live in `tests/unit/iso-progression.test.ts` (`npm test` →
*iso-progression*); the table below is printed by that suite.

## Measured milestones (6 seeds)

| seed  | first connection | second Depot | second plant | paid opening tiles |
| ----- | ---------------: | -----------: | -----------: | -----------------: |
| 1337  | 0.0 m            | 5.1 m        | 5.7 m        | 0                  |
| 7     | 0.0 m            | 7.0 m        | 7.7 m        | 0                  |
| 2024  | 0.0 m            | 5.5 m        | 6.0 m        | 0                  |
| 42    | 0.0 m            | 5.1 m        | 6.2 m        | 0                  |
| 99    | 0.0 m            | 25.6 m       | 26.3 m       | 12                 |
| 31337 | 0.0 m            | 10.2 m       | 11.3 m       | 0                  |

Reading:

- **First connection** lands on the first build turn on every seed: the
  12-tile free road allowance plus the 12 Wood + 12 Stone opening stock
  always covers it ("paid opening tiles" = paid track laid up to the first
  scored connection; 0–12 across the sample).
- **Second Depot** (1 Wood + 1 Stone + 1 Grain + 1 Oil + the track leg to an
  uncovered industry) is reached on every seed through trickle income plus
  4:1 banking — **no endless dependency loop** — in roughly 5–10 minutes for
  favourable openings.
- **Seed 99** is the stress case: the central industry is an **Oil Rig**
  (0.4/tick). Its trickle pays 1 Oil every ~7.5 s via the PP-07 fractional
  carry, and everything else must be banked from Oil at 4:1 — expansion is
  slow (≈26 min) but never dead. A human on the same opening would match
  Oil tokens on the board instead and do much better.
- **Second plant** (2 Wood + 2 Stone + 2 Grain + 3 Ore, town-adjacent)
  follows the second Depot closely; Ore is the binding cargo and every seed's
  network reaches Ore within the cap.

## Defects the playtest found (fixed in this change)

1. **Fractional trickle rounded to zero.** Per-tick `Math.round` paid nothing
   for Oil (0.4/tick) and Gold (0.3/tick), so an oil-only network was dead
   income — and every paid Depot now costs Oil. `economyTick` accumulates the
   fraction instead (`src/iso/game.ts`): 0.4/tick → 1 Oil every ~7.5 s.
2. **The rival could never afford a second Depot.** Its only income is the
   trickle, and no single trickle cargo pays a second Depot plus the track to
   reach it. `aiTick` therefore banks toward the plan it wants — the
   candidate with the least shortfall, priced with a hypothetical deep purse
   since `planCandidates` drops unaffordable plans — two 4:1 exchanges per
   build clock, Gold never touched (PP-08). Same escape hatch the player has.
3. **No plant could be raised beside a town on real maps** (PP-10 ↔ PP-06
   interaction). PP-10's ring road surrounds every house with `TOWN_OCC`
   tiles, but `adjacentTown` only counted houses: every footprint next to a
   house overlapped the ring ("occupied") and every footprint next to the
   ring alone was "no-town". Town roads are part of the town (grid.ts stamps
   them `TOWN_OCC` for exactly that reason), so `townHasTile` now counts them
   — and `chooseAiPlantSpot` scans far enough past the ring to find the
   legal sites.
4. **Bank deadlocks in the headless session** (simulation-level, same class
   as defect 2): pricing the whole milestone into the bank target forbade
   trading the very cargo the target needed; banking the purchase alone
   ping-ponged Oil forever; and buying Wood up to a target then selling it
   for Stone oscillated at the boundary. The shipped model banks toward the
   chosen plan and only ever sells a cargo the purse holds strictly more of
   than the milestone needs, with the Depot purchase kept as an unsellable
   reserve.

## Balance notes for the next pass

- The ticket's proposed numbers are the shipped numbers; they open the game
  on every seed tested. Treat them as the playtest baseline, not the final
  curve.
- Oil gating every paid Depot makes Oil Rigs strategically valuable early;
  an oil-only opening still expands (seed 99) but ~5× slower than a
  Wood/Stone opening — watch that once humans (not the conservative sim)
  play it.
- Rail is still gated behind an Ore mine (Wood + Stone + 4 Ore, allowance
  buys road only) — the E8/W9 gate is intact and re-pinned in
  `iso-rebalance.test.ts`.
- Candidate levers if expansion feels slow: Depot price, `HARVEST_MS`, or a
  slightly richer opening stock — all single constants in one table
  (`src/iso/construction.ts`) plus `START_PURSE`.
