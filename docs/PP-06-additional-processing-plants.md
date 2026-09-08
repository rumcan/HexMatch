# PP-06 — Additional processing plants at other towns

## The design decision the ticket asked to lock first

> *Does each plant have its own persistent processing board, or do all plants
> share one board? Define input allocation and sabotage targeting alongside
> that decision.*

**Locked: all of a player's plants SHARE ONE processing board.**

| Question | Answer under the shared board |
| --- | --- |
| Input allocation | Every connected Depot feeds the one board. A Depot's cargo is delivered to its **best single connection** (`resolveConnection` already returns one factory, rail beating road), so reaching two plants never doubles anything. |
| What another plant buys you | **Reach**, not throughput: more places on the map a Depot can legally connect to, so distant industries become worth developing. It does not add board slots, tokens or a second match-3 economy. |
| Sabotage targeting | Unchanged: Frost Tiles / Iron Girders / Smog Cloud always land on the one board. No target picker, no ambiguity. |
| Selecting / switching plants | There is nothing to select, therefore nothing that can reset progress or reroll a board — the exploit the acceptance criteria forbid is impossible by construction rather than by a guard. |

Per-plant boards were rejected because they force a plant-selection UI, and a
selection UI is exactly what would let a player reroll a bad board for free.

## Where it lives

- `src/iso/plants.ts` — new, self-contained: `PLANT_COST`, `plantRefusal`
  (the *single* legality rule), `adjacentTown`, `addPlant`, `plantsOf`,
  `chooseAiPlantSpot`.
- `src/iso/economy.ts` — `Factory` gains optional `id` and `townId`. Nothing
  else changed: the economy never assumed one factory per player
  (`resolveConnection` already loops over `state.factories`).
- `src/iso/game.ts` — the `plant` tool: preview overlay, cost preview, click
  placement, demolish, inspector, AI expansion, `__iso.placePlant` test hook.
- `src/game/ui.ts` / `styles.css` — the Build-panel button.

## Rules

- **Town adjacency** is defined once, in `adjacentTown`: at least one of the
  four footprint tiles must share an **edge** with a town tile. Diagonal-only
  contact does not qualify. Ties resolve to the lowest town id, so the
  association is deterministic.
- The whole 2×2 footprint must be on legal ground: no water, no industry or
  town tiles, no other building, no track.
- The **preview overlay, the click and the AI all call `plantRefusal`**, so the
  AI has no adjacency-free fallback and the preview can never disagree with
  the placement.
- Cost (`PLANT_COST` = 2 Wood + 2 Stone + 2 Grain + 3 Ore, PP-07's proposed
  value) is previewed from the same constant that charges it, and charged on
  the one success path — a refused placement can never take resources.
- The starting Factory is plant `#0`: the same record, the same building, the
  same rules.
- Demolishing is allowed except for your **last** plant.

## Save / load and multiplayer

Plants travel in the existing `factories` array of the snapshot, so
`buildSnapshot` / `applySnapshot` carry every plant with its `id` and
`townId` unchanged. `id`/`townId` are optional, so pre-PP-06 snapshots still
validate.

## Tests

`tests/unit/iso-plants.test.ts` (13 cases): edge vs diagonal adjacency, every
refusal reason, preview/placement agreement over a 15×15 sweep, plant records
and ids, the cost constant, one-yield/one-VP with a Depot reaching two plants,
AI expansion picking a *different* town and having no fallback, and the
snapshot round trip.
