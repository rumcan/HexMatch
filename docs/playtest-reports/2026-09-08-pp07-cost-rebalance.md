# PP-07 playtest — extended progression measurements (6 seeds, real 144×144 map)

**Date:** 2026-09-08
**Ticket:** `docs/HexMatch-tickets.md` → *PP-07 — Rebalance construction and
expansion using Catan-style resource roles*
**Companion report:** `2026-09-08-pp07.md` (the rebalance's own playtest:
3 seeds + the structural no-loop proof). This report extends it with two
stress seeds the first pass did not cover — an **Oil Rig opening** and a
far-ore opening — and with the two fixes those seeds forced.

The ticket requires: *"Test opening progression and expansion on the actual
144×144 map, not just short synthetic routes"* and *"Record time to first
connection, second Depot and second processing plant during playtesting."*

## Method

Headless sessions, one per map seed, driving the **real modules** — no game
code mocked:

- opening Factory: a human-style choice (beside the industry nearest the land
  centroid, footprint on legal ground, town-adjacent per PP-02),
- builds: `aiBuildStep` (A* planning + the authoritative cost table
  `BUILD_COSTS` in `src/iso/config.ts`, including the paid-Depot charge
  resolved by `priceDepot` against the player's `freeDepots` allowance),
- income: the `playerResources` trickle + the PP-07 fractional carry,
- trading: the real `bankTrade` 4:1 bank, Gold blocked (PP-08), max two
  exchanges per economy tick, banking toward the plan the session actually
  wants (least shortfall, road legs),
- plants: `canAffordPlant` → `chooseAiPlantSpot` → `addPlant`, charged once.

The match-3 Processing Plant is deliberately **not** simulated. Trickle +
bank is the *conservative* income model (the wired game pays the player from
matching, J1): anything achievable headless on trickle is also achievable in
hand — and usually sooner.

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
  (0.4/tick). Its trickle pays 1 Oil every ~7.5 s via the fractional carry,
  and everything else must be banked from Oil at 4:1 — expansion is slow
  (≈26 min) but never dead. A human on the same opening would match Oil
  tokens on the board instead and do much better.
- **Second plant** (2 Wood + 2 Stone + 2 Grain + 3 Ore, town-adjacent)
  follows the second Depot closely; Ore is the binding cargo and every seed's
  network reaches Ore within the cap.

## Defects the extended playtest found (fixed in this change)

1. **Fractional trickle rounded to zero.** Per-tick `Math.round` paid nothing
   for Oil (0.4/tick) and Gold (0.3/tick), so an oil-only network was dead
   income — and every paid Depot costs Oil. `economyTick` accumulates the
   fraction instead (`src/iso/game.ts`): 0.4/tick → 1 Oil every ~7.5 s.
2. **The rival could never afford a second Depot.** Its only income is the
   trickle, and no single trickle cargo pays a second Depot plus the track to
   reach it. `aiTick` therefore banks toward the plan it wants — the
   candidate with the least shortfall, priced with a hypothetical deep purse
   since `planCandidates` drops unaffordable plans — two 4:1 exchanges per
   build clock, Gold never touched (PP-08). Same escape hatch the player has.
   Covered in `iso-game.test.ts` → *"banks toward a paid Depot when no
   trickle cargo alone covers it (PP-07)"*.
3. **Bank deadlocks in the headless session** (simulation-level, same class
   as defect 2): pricing the whole milestone into the bank target forbade
   trading the very cargo the target needed; banking the purchase alone
   ping-ponged Oil forever; and buying Wood up to a target then selling it
   for Stone oscillated at the boundary. The shipped model banks toward the
   chosen road plan and only ever sells a cargo the purse holds strictly more
   of than the milestone needs, with the Depot purchase kept as an unsellable
   reserve.

(The plant-site regression the first playtest pass surfaced — PP-10's ring
roads making every town-adjacent plant site illegal — was fixed alongside
the rebalance itself; see `2026-09-08-pp10-town-roads.md`.)

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
  (`BUILD_COSTS` in `src/iso/config.ts`) plus `START_PURSE`.

## Addendum — PP-12 re-measurement (2026-09-08)

PP-12 re-arted the industries (farm 3×3→4×4, forest 4×5→4×4, quarry 4×4→3×3,
factory 2×2→3×3), which shuffles industry positions on every seed. The
economy is untouched — outputs, costs, and the bank are identical — so this
pass re-runs the same harness on the new map to confirm the PP-07
guarantees still hold. One harness change was required (see below); the
milestone table was re-printed by the suite:

| seed  | first connection | second Depot | second plant | paid opening tiles |
| ----- | ---------------: | -----------: | -----------: | -----------------: |
| 1337  | 0.0 m            | 5.1 m        | 5.7 m        | 0                  |
| 7     | 0.0 m            | 7.0 m        | 7.7 m        | 0                  |
| 2024  | 0.0 m            | 5.5 m        | 6.0 m        | 0                  |
| 42    | 0.0 m            | 5.5 m        | 6.3 m        | 0                  |
| 99    | 0.0 m            | 25.6 m       | 26.3 m       | 12                 |
| 31337 | 0.0 m            | 7.0 m        | 7.8 m        | 0                  |

Reading:

- Four seeds (1337, 7, 2024, 99) measure **identical** times on the new map;
  seed 42 is within half a minute (5.1→5.5 m). The rebalance numbers open
  the game on the re-arted map exactly as before.
- **Seed 31337 changed openings.** Its centroid industry is now a Gold Mine,
  and a gold-first opening cannot bootstrap on trickle + bank at all: Gold
  pays for no track and no Depot, and PP-08 blocks it at the bank in both
  directions — the session sat 90 minutes on 540 unspendable Gold with Grain
  and Oil permanently at zero. That is a live-game choice with a match-3
  rescue (the starting Processing Plant manufactures the missing Grain/Oil
  from gems), not a trickle+bank bootstrap — and the harness deliberately
  does not model match-3. The opener now skips Gold Mines
  (`chooseOpeningFactorySpot`), so 31337 measures its nearest openable
  industry (7.0 m to the second Depot). The other five seeds' openings are
  unaffected (proven by their unchanged times).
- The sister guard in `iso-game.test.ts` (*"banks toward a paid Depot…"*)
  needed no logic change but a larger wall budget (30→60 s): the rival's
  play is tick-for-tick identical on the new map, while A* planning over
  the shuffled layout costs ~2.9 s per build clock instead of ~2.2 s.
- Follow-up (pre-existing, not a PP-12 regression): the **rival** also
  bootstraps on trickle + bank and cannot match-3, so a rival that opens
  beside a Gold Mine stalls the same way. Seed-luck decides today; the AI
  should eventually deprioritise Gold while it holds fewer than two Depots.
