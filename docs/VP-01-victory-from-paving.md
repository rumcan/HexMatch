# VP-01 — Victory Points from paving, and an AI that races for them

## The rule that shipped

| Board event                                                       | Victory Points |
| ----------------------------------------------------------------- | -------------- |
| A Dirt Road tile of yours paved into a Road (in place, 4 Ore)      | **+0.25★**     |
| A processing plant raised after setup (`PLANT_COST`, beside a town) | **+1★**        |
| A Dirt Road, however useful                                          | 0★             |
| A Road laid on ground that was never your gravel                     | 0★             |
| Reaching an industry, connecting a depot, owning a long line         | 0★             |
| **First to**                                                         | **10★**        |

0.25 was the settled number, not the first one. The brief asked for 0.5 per
upgraded road tile; running the race harness (`tests/unit/iso-vp-race.test.ts`,
measured again at `upgrade: 0.5` for this note) had a bare-economy seat at 8.5★
by minute 3 and **winning at 6.9 minutes** — with no match-3 income in the
figure, i.e. the fastest a game could possibly go. Halving it doubled the bill to
**40 paved tiles and 160 Ore** and moved the same seat's win to 12.4 minutes,
which is a match. See `docs/playtest-reports/2026-09-10-vp01-vp-race.md`.

Two properties fall out of the rule, and both are the design:

1. **Ore is the scoreboard.** A pave is 4 Ore and Ore comes out of an ore mine
   that is *in production* — serviced by a depot, on a road, feeding a plant.
   So the race to 10★ is a race to build a working economy, and the transport
   tiers keep their old meaning (×1.0 dirt, ×1.6 paved) as **throughput only**.
2. **Points are revocable, so losing a road hurts.** The score is a live view of
   the network, not a history of what you built: tear up a paved tile or demolish
   a plant and its point leaves the board with it. That is why the scoreboard is a
   **diff** (`rescore`) and never a running total.

`src/iso/config.ts` carries the three numbers as one table, `VICTORY`, and
`VP_TARGET = VICTORY.target` is the legacy alias everything else kept using:

```ts
export const VICTORY = { upgrade: 0.25, plant: 1, target: 10 } as const;
```

## What was deleted, and why that is most of the diff

The old model paid **per connection**: `TRANSPORT.dirt.vp = 1`,
`TRANSPORT.road.vp = 3`, `VP_TARGET = 12`, with `economy.ts` resolving each
harvester's best tier and `ScoreState.connections` remembering which harvester
had which. That made the scoreboard a census of depots: whoever sprayed the
cheapest gravel links around first, won — the road tier was a bonus, never the
objective. Gone:

- `TransportDef.vp` — a tier no longer has a VP, it has `vpUpgrade` (what one
  tile of it pays when it *replaces* the tier below; 0 for dirt, 0.25 for road);
- `Connection.vp` — `resolveConnection` now returns `{ kind, multiplier, factory }`.
  Throughput stayed, points left;
- `ScoreState.connections` and the harvester-keyed `awarded / revoked / upgraded /
  downgraded` event vocabulary, with `±1 / ±3` deltas;
- `SnapshotSource.score` and the snapshot's `connections` field: with points living
  in the track bits, a score is *derived* state and cannot be sent without risking
  a disagreement about it. `Snapshot` went **v8 → v9** (the `upgraded` layer in,
  `connections` out) and a v8 peer is refused on the version gate — mixed-version
  rooms used to be able to agree on the map and disagree on the win, which is the
  worst desync this game can have.

The legacy `VP = { target: 10 }` in `src/game/config.ts` stays (it is a shared-UI
constant with save-compatible naming) but is documented as retired by VP-01 — and
it had already drifted, saying 10 while the engine won at 12.

## Provenance: the one bit that makes the rule expressible

"Paved" and "upgraded from dirt" are the same two bytes on the track layers: a
Road is a Road. The distinction is an event in the past, so the past is stored —
`Track.upgraded`, one `PRESENT` bit per tile, sitting beside `dirt`/`road`/`owner`
and travelling in the snapshot:

```ts
// track.ts — buildTile, the single place a tile changes tier
if (kind === "road" && (dirt[i] & PRESENT) !== 0) {
  dirt[i] = 0;                            // paving CONSUMES the gravel
  layerOf(t, kind)[i] |= PRESENT;
  if (t.owner[i] !== PUBLIC_OWNER) t.upgraded[i] = PRESENT;   // ← the score
}
```

It is written at exactly that choke point and cleared by `demolishTile`. Two
rejected alternatives are worth recording, because they are the tempting ones:

- *derive it from `owner` + `road`*: cannot work — a Road laid on virgin ground
  is byte-identical to an upgrade;
- *keep a ledger in `ScoreState`*: cannot work either — build and demolish reach
  the track from five places (`commitDrag`, both rival passes, the quarry's
  auto-lay, `applySnapshot`), and a ledger has to be wrong the moment one of them
  forgets to update it. A bit on the tile cannot get out of sync with the tile.

`victory.ts` is the only reader: `scoredPaves` wants **both** bits (provenance
without pavement is gravel that was re-laid; pavement without provenance is a Road
built new), and `scoredPlants` pays a plant only when `id > OPENING_PLANT_ID`,
because the setup Factory is free.

## How the pieces fit

- **`src/iso/victory.ts`** (new) — `ScoreState { paved, plants, vp }`,
  `createScoreState`, `rescore`, `vpFor`, `hasWon`, `victoryBreakdown`,
  `paveVp`, `fmtVp`, `vpDeltaText`, `ownerIdsByNumber`. It imports `track`,
  `config` and `economy`'s types only, so it is *below* `game.ts` and adds no cycle.
- **`track.ts`** — the `upgraded` layer, `isUpgradedRoad`, `tileAlreadyCarries`,
  and `previewDrag(…).upgrades`: how many tiles a *pending* drag would upgrade,
  which is what lets the mode bar price the points before the click.
- **`economy.ts`** — lost its scoring tail; `sharedComponents` is exported now
  because the AI's pave ranking needs component identity, not just the merged set.
- **`ai.ts`** — `paveCandidates`, `planUpgrades`, `executePaves` (below).
- **`game.ts`** — `rescoreNow()` (rescore + `netVersion` bump) is called from the
  build and demolish paths only, never on a clock: a timer-scored board drifts.
  `applyVpEvents` aggregates the diff into one toast per (owner, source), floats
  at most four `+0.25★` markers on the tiles that moved, and runs the win check.
- **`snapshot.ts`** — v9: `upgraded` joins the four base64 layers, `connections`
  and `SnapshotSource.score` leave.
- **`ui.ts` / `debug.ts`** — tool subs (`Dirt Road · 0★`, `Road · +0.25★ paving dirt`),
  badge and kingdom bar off `VICTORY.target` via `fmtVp`, a help section
  ("🏆 How you score"), and `~tile`'s `paveState`
  (`upgraded | laid-new | paveable | empty`) for the console.

## The AI's upgrade

The rival's turn went from "one build, or nothing" to the three actions the new
scoreboard pays for, most valuable first, each paying for itself before it is
applied:

1. **a plant** — 1★, the cheapest point on the board, and it widens delivery
   reach. Same `placePlant` rule as the human's click (PP-06's no-bypass rule);
2. **a depot** on the catchment `planCandidates` rates best, priced by the same
   `priceDepot`/`tileCost` model the player's drag preview uses;
3. **the pave pass** — `planUpgrades` ranks its own gravel (one tile per live
   gravel component first, then the rest of those by distance from its plant,
   then everything else), cuts the list at `floor((ore − keepOre) / 4)` capped at
   8 tiles, and `executePaves` lays them through `buildTile`, which is what stamps
   the point.

Around those three:

- **tile values are per-Ore, and Ore is weighted** — `CARGO_VALUE` puts Ore at
  1.7 against Stone/Wood at 1.0, and a candidate is scored `value / max(0.3,
  path.cost)`, so a plan that pays for itself in ore for paving is the one it
  takes;
- **catchment value is diluted and blockade-aware** — an industry the rival has
  to share with your depot is worth its share, and one you have blockaded is
  worth nothing this turn;
- **dirt first** — `planCandidates` now offers `"dirt"` before `"road"`. Laying a
  Road on virgin ground costs 4 extra Ore per tile and returns 0★, so the planner
  lays gravel, banks the Ore, and converts it into points *and* ×1.6 with the pave
  pass. `preferPaved: true` is the option that asks for road up front;
- **it reads the scoreboard before it spends** — `rivalPace(you, ai, target)` in
  `ai.ts` is a pure function of two totals, and the rival's whole reaction is
  three numbers: a seat a plant (1★) behind *sprints*, making **four** bank
  exchanges a turn instead of two and weighting Ore-bearing ground **1.5×** in the
  depot planner, so it stops chasing the bigger farm and goes for the mine that
  prints points. What does *not* change is the size of the goal — a first version
  let a sprinting rival bank at eight tiles (32 Ore) instead of four, and the
  5-seed race answered that with a seat on 0★ for the entire game (it sold four
  stacks a turn toward a milestone it could never reach, and stopped affording
  the economy that would have carried it there). A plan has to be short enough to
  finish; `planUpgrades` still spends all eight tiles in one pass when the Ore is
  already in the purse. A rival ahead of you changes nothing at all — compounding
  income is the right play when you are winning, and this is the one place the AI
  is allowed to be boring. `__iso.rivalPace` exposes the read, so a playtest can
  ask *why* a turn looked odd;
- **the turn cannot be wasted** — when all three actions fail it banks toward the
  plan it wants (PP-07's escape hatch, now able to buy **into the scoreboard**:
  the 4:1 bank will convert Wood into the Ore a pave needs, choosing whichever
  milestone — next depot or next four paves — has the smaller shortfall) and
  retries; an idle turn shortens its own clock to `AI_IDLE_MS` (2.5 s, one income
  tick) instead of burning the full `AI_BUILD_MS`;
- **it plays the Black Market too** — `rivalSabotage` buys a Blockade on the
  industry feeding *your* best connection when it can pay and still keep
  `RIVAL_GOLD_RESERVE` (2 gold) in hand, floating `⛓ BLOCKADED` on your map tile.
  The reserve has one exception, and it is the other half of reading the
  scoreboard: when *you* are within a plant of winning, denial outranks its own
  economy and it spends down to the last coin (`pace.deny`). And `rivalRaid` now
  filters its purchase list to the three cards it can actually aim at your plant
  — `bandit` (a district card, which `rivalSabotage` owns) and `security` (a
  defender's card) used to be picked up as "affordable", paid for, and dropped,
  because the hire is charged before the effect;
- **routing knows about its own pavement** — `networkTiles` seeds from the MERGED
  network and `stepCost` discounts only what `tileAlreadyCarries` confirms. Without
  this the rival treated a trunk it had just paved as foreign ground and answered
  it with a parallel gravel spur.

Two AI behaviours are deliberate non-features. It does **not** repair: a paved
tile it tears up is gone (there is no repair entry point on the rival's side). And
it may **pave across your dirt** if the route lets it — `buildTile` gives a tile
to the last real builder, so it pays 4 Ore, takes the ground and takes the 0.25★
with it. One tile, one point, whoever's it ends up being: documented, not blocked.

## Consequences worth knowing

- **Borrowing a highway is throughput, not points.** A dirt feeder onto the map's
  public tarmac still resolves to the road tier and ×1.6 — but nobody upgraded
  anything, so it scores nothing. That was the old model's best cheap trick.
- **One paved tile flips a whole line.** `roadComp` is true if *any* tile of a
  component is paved, so a single 0.25★ upgrade on a live gravel component takes
  every depot on it to ×1.6. The in-game help says so; it is the cheapest move on
  the board and the AI's pave ranking is built around it.
- **Rough ground cannot be paved** (`TRANSPORT.road.onRough === false`). A network
  that lives entirely in the hills around an ore mine has nothing to upgrade and
  scores 0★ forever — `iso-game.test.ts`'s W3 rival is that case, and it is why
  the pave pass returns "nothing to do" rather than an error.
- **Points do not require a live connection.** A paved tile pays whether or not
  anything is driving on it — the road is built and the money is spent. What
  *does* require a live line is the Ore to buy the next one.
- **The win is checked once a turn, so the last turn can overshoot.** 0.25 steps
  mean a *single* pave lands exactly on 10★ — but a build turn can pave eight
  tiles *and* raise a plant, and the gate reads the turn's total (seed 2024 of
  `iso-vp-race.test.ts` finished 10.25★). That is the design: the banner prints
  the true number and `fmtVp` shows `9.75` rather than float noise, and what must
  never happen is the check *lagging* a turn and a player sitting on 13★.

## Where to tune

The whole rule is four numbers: `VICTORY` (`src/iso/config.ts`) for the rates and
the target, `UPGRADE_COST.ore` (same file, via `BUILD_COSTS.upgrade`) for the
price of a pave, and `PLANT_COST` (`plants.ts`, from the same table) for the price
of the other point. `START_PURSE` and `AI_BUILD_MS`/`AI_IDLE_MS` live in
`game.ts`; the rival's catch-up thresholds are the two comparisons inside
`rivalPace` (`VICTORY.plant` for both), and its cruise budget — 4-tile pave batch,
2 exchanges a turn, 2 gold in reserve — is the `false` branch of the same object. Three harnesses re-measure whenever any of them moves:
`tests/unit/iso-victory.test.ts` (what scores, what does not, what takes it
back), `tests/unit/iso-progression.test.ts` (the opening: connection, second
depot, second plant, first pave) and `tests/unit/iso-vp-race.test.ts` (a whole
game, both seats, to 10★).
