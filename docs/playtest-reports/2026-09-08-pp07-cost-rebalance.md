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
- builds: `aiBuildStep` (A* planning + the authoritative cost table, including
  the new paid-Depot charge),
- income: the `playerResources` trickle + the PP-07 fractional carry,
- trading: the real `bankTrade` 4:1 bank, Gold blocked (PP-08), max two
  exchanges per economy tick,
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
| 1337  | 0.0 m            | 8.1 m        | 8.8 m        | 0                  |
| 7     | 0.0 m            | 11.1 m       | 11.3 m       | 0                  |
| 2024  | 0.0 m            | 8.7 m        | 8.8 m        | 0                  |
| 42    | 0.0 m            | 8.1 m        | 8.4 m        | 0                  |
| 99    | 0.0 m            | 33.8 m       | 33.9 m       | 12                 |
| 31337 | 0.0 m            | 21.8 m       | 22.9 m       | 0                  |

Reading:

- **First connection** lands on the first build turn on every seed: the
  12-tile free road allowance plus the 12 Wood + 12 Stone opening stock
  always covers it ("paid opening tiles" = paid track laid up to the first
  scored connection; 0–12 across the sample).
- **Second Depot** (1 Wood + 1 Stone + 1 Grain + 1 Oil + the track leg to an
  uncovered industry) is reached on every seed through trickle income plus
  4:1 banking — **no endless dependency loop** — in roughly 8–11 minutes for
  favourable openings.
- **Seed 99** is the stress case: the central industry is an **Oil Rig**
  (0.4/tick). Its trickle pays 1 Oil every ~7.5 s via the PP-07 fractional
  carry, and everything else must be banked from Oil at 4:1 — expansion is
  slow (≈34 min) but never dead. A human on the same opening would match
  Oil tokens on the board instead and do much better.
- **Second plant** (2 Wood + 2 Stone + 2 Grain + 3 Ore, town-adjacent)
  follows the second Depot closely; Ore is the binding cargo and every seed's
  network reaches Ore within the cap.

## Defects the playtest found (fixed in this change)

1. **Fractional trickle rounded to zero.** Per-tick `Math.round` paid nothing
   for Oil (0.4/tick) and Gold (0.3/tick), so an oil-only network was dead
   income — and every paid Depot now costs Oil. `economyTick` accumulates the
   fraction instead (`src/iso/game.ts`): 0.4/tick → 1 Oil per ~7.5 s.
2. **The rival could never afford a second Depot.** Its only income is the
   trickle, and no single trickle cargo pays Grain + Oil + Wood + Stone. The
   rival now uses the same escape hatch the player has — the 4:1 bank, two
   exchanges per build clock, never touching Gold (PP-08) — in `aiTick`.
3. **Test-harness id collision** (not shipped logic): the W3 test pushed a
   player harvester with id 1, the same id the game's counter hands the
   rival's first build, which made `rescore` attribute the rival's connection
   to the player's entry. The test now uses id 100.

## Balance notes for the next pass

- The ticket's proposed numbers are the shipped numbers; they open the game
  on every seed tested. Treat them as the playtest baseline, not the final
  curve.
- Oil gating every paid Depot makes Oil Rigs strategically valuable early;
  watch whether a forest/quarry-free opening feels starved once humans (not
  the conservative sim) play it.
- Rail is still gated behind an Ore mine (Wood + Stone + 4 Ore, allowance
  buys road only) — the E8/W9 gate is intact and re-pinned in
  `iso-rebalance.test.ts`.
- Candidate levers if expansion feels slow: Depot price, `HARVEST_MS`, or a
  slightly richer opening stock — all single constants in one table
  (`src/iso/costs.ts`) plus `START_PURSE`.
