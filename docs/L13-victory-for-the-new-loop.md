# L13 (#228) — Victory points, win condition and end-game for the new loop

> Companion to `docs/VP-01-victory-from-paving.md`, which describes the table
> that still ships. This note describes the table the **new loop** (`?loop=new`)
> races instead, and why the numbers are what they are.

## Why the shipped table could not survive the redesign

VP-01's rule was **0.25★ a paved tile, 1★ an extra Processing Plant, first to
10★**. Both sources were retired by earlier tickets in this epic:

- **L2 (#216) made dirt free.** Paving is now a *throughput* choice (×1.6
  hauling) rather than the spine of the game. 90% of every score on the shipped
  loop came from `VICTORY.upgrade`, so leaving it in place would have meant the
  redesigned economy was still, in scoreboard terms, the old one.
- **L5 (#219) made the CITY the thing you upgrade.** "An extra Processing
  Plant" scored 1★ for feeding a board that is no longer a constant board.

Nothing awards ★ for either action under the flag. The Road button says
"faster hauling · 0★" instead of "+0.25★ paving dirt", because a button that
sells a retired source is a promise the scoreboard will not keep.

## The new table

`VICTORY.loop` in `src/iso/config.ts`:

```ts
loop: { type: 2, rung: 1, city: 2, target: 12 }
```

| Board event                                                        | ★ | Revocable? |
| ------------------------------------------------------------------ | -- | ---------- |
| A **depot type running** — one per distinct cargo the seat has a connected, producing Depot for | **+2★** | **yes** |
| A **rung of the depot tree** unlocked (L5 `depotTier`)               | **+1★** | no (high-water mark) |
| A **city upgrade tier** bought and confirmed (L5 `townLevel`)        | **+2★** | no (high-water mark) |
| A railway **platform**, when the rail flag is on (`PLATFORM_VP`)     | **+1★** | yes |
| Paving a tile, raising an extra plant                                | 0★ | — |
| **First to**                                                         | **12★** | |

### The three axes, and why the pool is bigger than the line

The ticket asks for Catan-style *several routes to victory*: ★ from several
independent sources, no single source required to reach the win line.

- **breadth** — `type`, the long pole. A new type needs an industry of that
  cargo near your network, a road out to it, its rung open and its mix paid.
- **depth** — `city`, fewer richer depots and a higher base rate.
- **progress** — `rung`, cheap and monotone; it marks progress, it does not
  carry a game. 1★ precisely because it is the one source a seat gets almost
  for free — at 2★ every seat would bank a sixth of the line for playing two
  sessions.

The pool is **16★ against a 12★ line**: 6 types (12★) + 2 rungs (2★) + 1 city
tier (2★). That deliberate slack is what makes the routes real — six types
alone wins; four types with both rungs and the city wins; five types and the
rungs wins — and it is why no single source is a toll gate.

### Why "running" is a network fact, not a clock one

A depot type scores when the seat has a Depot of that cargo that is
**serviced**, **connected to one of its own plants**, and **holding an industry
no rival network claimed first**. It deliberately does *not* read the
blockade/protest timers: those stop the cargo for a minute and are meant to
hurt income, not to make the star counter flicker on a clock nobody pressed.
This keeps VP-01's founding rule intact — **points move on a build, never on a
timer** — and it keeps the score a live view of the network: cut the road and
the type stops running, and its 2★ leaves the board with it.

That rule is written out in `game.ts` (`loopScoring`), in the race harness and
in the save-summary dossier. All three must agree; if it changes, change all
three.

## The win line: 12★, and why not 14

The line was measured, not guessed. Crossing times per candidate target,
`fullWindow` races on six seeds (the harness prints these):

| Target | 1337 | 7 | 42 | 99 | 2024 | 5 |
| --- | --- | --- | --- | --- | --- | --- |
| 10★ | 1m | 2m | 1m | 2m | 3m | 1m |
| **12★** | **1m** | **2m** | **1m** | **2m** | **3m** | **9m** |
| 14★ | 2m | 3m | 1m | 3m | 4m | **never** |
| 16★ | 2m | 3m | 2m | 3m | 4m | **never** |

14★ and 16★ **deadlock** on seed 5 — at 16★ the target *is* the entire pool, so
a seat that cannot reach a sixth cargo can never finish. 12★ terminates on
every seed probed while still asking for a real network. The `test:slow` race
(`tests/unit/iso-l1d-race.test.ts`) is the standing deadlock detector.

**Measured race times** (`npm run test:slow`, 30m window, both seats normal):

| Seed | Winner | Final ★ |
| --- | --- | --- |
| 1337 | ai at **0.7m** | you 10 / ai 12 |
| 7 | you at **1.9m** | you 12 / ai 8 |

For comparison, the **shipped** loop on the same harness and seeds wins at
**4.5m** and **4.3m** (10★, 40-ish paved tiles). The new loop is *faster in
harness minutes* because every source in it is an opening-burst unlock: the
tree saturates by simulated minute 2–3, after which nothing else can be scored.
The harness is a deadlock detector and not a wall-clock model of a human game —
it drives both seats with the rival's own turn at AI clocks, with no match-3
session time, no camera, and no human deliberation between builds. A human's
12★ is six industries found, roaded and paid for plus a city upgrade, which is
not a 90-second job. Closing the remaining gap belongs to the AI rewrite
(#229 L14) and the tuning tickets that follow it; this note records the numbers
so the next ticket can see whether it moved them.

## The switch

Passing `loop?: LoopScoring` to `rescore` **is** the flag's whole footprint in
`victory.ts`. With it, paves and plants are collected as *empty maps*, so any
ledger entry from before the flag revokes once and never re-awards.
`victoryBreakdown` mirrors the rule, and returns `loop: true` so its readers
never have to infer which table paid — an all-zero new-loop ledger and an
all-zero shipped one are otherwise identical, and guessing printed
"0 cargo types connected" over a 40-tile paving win.

## What reads the new sources

| Surface | Where |
| --- | --- |
| Scoreboard / win check | `rescore`, `hasWon(score, owner, winTarget())` |
| HUD ★ tooltip | `vpTooltip` — "Depot types running / Depot-tree rungs / City upgrades" |
| Win toast | `game.ts` — "N depot types, N rungs, N city upgrades" |
| Ending ledger | `ledgerRows` — three rows, keyed `types` / `rungs` / `city` |
| Ending path & prose | `endingPathFor` → `network` (breadth) vs `industry` (depth) |
| Save dossier ("7★ vs 5★" on the Continue door) | `starsFromSave` scores a `loop: true` save on the loop's table |
| Debug twin | `__iso.vpRates` reports the live table, with a `newLoop` discriminator |

## Out of scope (post-MVP, per the ticket)

- **control ★** — holding a contested industry for N minutes. Explicitly a
  clock source, which is why the "running" rule above does not read timers.
- **quest rewards** (#222 L8) — small, optional, capped.
- **ranked / contracts / host settings** — these still race the shipped 10★
  line, because `newLoop` is solo-only and story-free (L1a).
