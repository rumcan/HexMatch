# L10 (#225) — Frost tiles and iron girders are board obstacles set by difficulty

The board already had both obstacles, and both arrived as **sabotage**: a Black
Market card, a timer, and an overlay that shipped them to the other seat's
plant. L9 (#224) retired the cards. This ticket is where the obstacles come
back — as part of the **tuning session**, placed when it opens and gone when it
closes.

## The rule now

| | Easy | Normal | Hard |
|---|---|---|---|
| Frosted gems (`hard > 0`) | — | 6 (3 on a first Depot) | 6 (3 on a first Depot) |
| Ice thickness | — | 1 match | 2 matches (1 on a first Depot) |
| Iron girders (`block`) | — | — | 3 (1 on a first Depot) |

- The table is `DIFFICULTY_RULES[key].obstacles` in `src/iso/config.ts` — the
  same row L6 (#220) already reads for decay, the yield floor and the re-match
  policy. Difficulty is data; there is no `if (hard)` anywhere in the path.
- Counts ramp with the Depot's **transport tier** (`transportTierOf`, L6's
  upgrade axis): a first Depot standing on open ground meets half the table and
  one-match ice; every tier the player has paid for restores the full row
  (`OBSTACLE_RAMP`).
- Placement is the board's (`Board.seedObstacles`): seeded RNG (`shuffle`), in
  cell order, and **after every single placement `hasMove()` must still answer
  true** — the deadlock guard decides, so a session never opens on a board with
  no legal move. What actually landed is what the intro reports.
- No timers. What clears them is play: a frosted gem still matches and cracks
  one step per pass (`settle`), and a girder is broken back into an ordinary
  gem by a removal next to it. Closing the session takes whatever is left off
  (`clearObstacles`), and the ♻ reset re-deals the session's own table — it
  collapses the board, not the difficulty.

## What went away

- **Smog** — `Board.fog`, `fogUntil`, the `.fog-overlay` / `.stat.fog` styles
  and the `smogIn` field on the wire. A cloud whose only mechanic was "no swaps
  for 30s" is not worth a third obstacle.
- **The sabotage path** — `harden`, `dropBlocks`, `smashBlocks` (the Repair
  Crew), `sabotageState` / `applySabotage` (the guest overlay) and the
  `rivalSabotage` field on the snapshot and the delta. Nothing outside a
  session can put an obstacle on a board, because there is no call left that
  can.
- **`rival-plant.ts`'s damage model** — `plantHealth`, `GIRDER_WEIGHT`,
  `SMOG_YIELD`, `MIN_HEALTH`, `frost()`, `girders()`, `smog()`, `tick()`. The
  rival's income is no longer scaled by how wrecked a plant looks; its tuning
  result is L4's simulated session (`rivalTuningYield`) docked once by
  `obstacleDrag` — the same table, read at that Depot's tier. Easy puts no
  obstacles on a board, so its rival keeps L4's number exactly (L6's rule: the
  rival is never handed the player's concession).

## The world

The obstacles are named in the game's own terms — *"Hard: the rails froze
overnight and girders fell on the line — 3 iced, 1 girder."* — because a puzzle
tile that does not belong to the story breaks the fiction (the Merge Gardens
lesson from the deconstruction review: it swapped fruit for books and cameras
to fit its mansion). Frost and girders were already industrial; **any new
obstacle must come from the same world** (rubble, an oil slick, rust), never a
generic match-3 blocker. Final copy lands in L8 (#222).

## Tests

`tests/unit/iso-l10-obstacles.test.ts` is the acceptance block: the table per
difficulty, the tier ramp, the placement (seeded, never deadlocked), one live
game per row (board dealt, intro line, obstacles gone on close), and the
"nothing outside a session can place one" negative. Also touched:
`tests/unit/board.test.ts` (the obstacles block), `iso-rival-plant.test.ts`
(the plant is a board; the rival's session is docked), `iso-l4-tuning` and
`iso-l1d-rival-clock` (the rival's level is now the docked number), and the
`harden`/`dropBlocks` call sites in `iso-mp` became `seedObstacles`.
