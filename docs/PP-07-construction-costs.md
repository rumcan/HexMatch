# PP-07 — Construction cost rebalance (Catan-style resource roles)

## What was locked

Every normal resource now has a construction role, and **every** build price
lives in ONE authoritative table — `BUILD_COSTS` in `src/iso/config.ts`,
re-exported by `src/iso/construction.ts` (the PP-05 module every caller
already imports). UI labels, placement rules, the AI planner and the test
suite all read that table; nothing else in the codebase prices a build.

| Action                  | Cost                                   | Role model |
| ----------------------- | -------------------------------------- | ---------- |
| Road tile               | 1 Wood + 1 Stone                       | basic infrastructure |
| Rail tile               | 1 Wood + 1 Stone + 4 Ore               | industrial investment, faster delivery |
| Upgrade Road → Rail     | 4 Ore (per tile, in place)             | same investment, no rebuild |
| Additional Depot        | 1 Wood + 1 Stone + 1 Grain + 1 Oil     | workforce + fuel for expansion |
| Additional Plant        | 2 Wood + 2 Stone + 2 Grain + 3 Ore     | industrial-scale construction |

Resource roles:

- **Wood + Stone** — basic infrastructure: both track kinds and both buildings.
- **Grain** — the workforce: paid with every Depot and Plant expansion.
- **Ore** — the industrial investment: gates Rail, upgrades and Plants.
- **Oil** — Depot expansion only (fuel), at a fractional trickle rate.
- **Gold** — Black Market sabotage only; never a construction cost, and
  excluded from the 4:1 bank (PP-08).

The ticket's proposed starting numbers are shipped as-is; the playtests
(`docs/playtest-reports/2026-09-08-pp07.md` and
`2026-09-08-pp07-cost-rebalance.md`) show they open the game on every seed
sampled. They are the tuning baseline, not the final curve.

## How the pieces fit

- `config.ts` — declares `BUILD_COSTS` (lowest import layer, so every module
  can read it without a cycle). `TRANSPORT.road.cost` / `TRANSPORT.rail.cost`
  and `UPGRADE_COST` alias into it.
- `construction.ts` — re-exports the table plus PP-05's pricing helpers
  (`priceDepot`, `costLabel`, `depotButtonLabel`, `FREE_SETUP_DEPOTS`).
  `DEPOT_COST` is the table's depot entry.
- `track.ts` — `tileCost` (the single function the human drag AND the rival's
  planner ask) resolves `TRANSPORT[kind].cost` / `UPGRADE_COST` at call time.
- `plants.ts` — `PLANT_COST` is the table's plant entry.
- `game.ts` — `placeHarvester` charges via `priceDepot(p.purse, p.freeDepots)`;
  `aiTick` plans via `aiBuildStep` on the same table and banks toward the
  plan it wants when nothing is affordable yet (see below).
- `ui.ts` — Build-panel prices rendered from the table; the Depot button
  refreshes from `depotButtonLabel` as the allowance burns down.

## Setup exceptions (deliberate, and the only ones)

The first Factory is free, and the first Depot rides the `freeDepots` setup
allowance (DATA on the player record, E8's K1 rule — a refused placement can
never silently burn it). The 12-tile free allowance buys **road only**,
unchanged. The opening turn therefore needs no cargo at all; the first real
spend is the second Depot.

## Retuning needed for the new costs

- `START_PURSE`: `{ wood: 12, stone: 12, ore: 0 }` (was `{ stone: 12, ore: 0 }`).
  Road tiles now cost Wood + Stone; without opening Wood the player could lay
  exactly one road tile before dead stop. 12 Wood + 12 Stone is exactly the
  same 12-tile paid-road capacity the old 12-stone purse bought, split across
  the two infrastructure cargoes.
- Free allowance and its road-only restriction: unchanged (E8/W9 re-pinned in
  `tests/unit/iso-rebalance.test.ts`).
- Trickle yields: unchanged in value, but the payout rounding was broken —
  see below.

## Yield fix that the ticket's "tune costs and yields together" forced

Per-tick `Math.round` on the trickle paid **zero forever** for Oil (0.4) and
Gold (0.3). With Oil now gating every paid Depot, that was an endless
dependency loop by construction. `economyTick` (`src/iso/game.ts`) now
accumulates the fractional part per cargo and pays the integer floor:
Oil 0.4/tick → 1 Oil every ~7.5 s.

## The rival uses the same escape hatch

The rival's only income is the trickle, and no single trickle cargo buys a
second Depot plus the track to reach it. When `aiBuildStep` finds nothing
affordable, `aiTick` banks at 4:1 toward the plan with the **least
shortfall** — priced with a hypothetical deep purse, because
`planCandidates` drops unaffordable plans — then retries once. Two exchanges
per build clock, Gold never touched, and the rival never sells a cargo its
target plan still needs. The rival otherwise plans and pays through the
identical `planCandidates`/`BUILD_COSTS`/`priceDepot` path.

## Where to tune

All of PP-07 lives in two places: the price table (`BUILD_COSTS` in
`src/iso/config.ts`) and the opening stock (`START_PURSE` in
`src/iso/game.ts`). Yields stay in `INDUSTRY_BY_KEY.output`
(`src/iso/config.ts`). The progression harness
(`tests/unit/iso-progression.test.ts`) re-measures time-to-first-connection,
second Depot and second plant whenever any of them moves.
