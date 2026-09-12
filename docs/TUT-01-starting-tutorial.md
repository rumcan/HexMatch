# TUT-01 — the starting tutorial

## The ask

> we need a starting tutorial that shows you how to play the game. Simply
> showing them how the game works. you build a processing plant. you build a
> depot, you connect them with roads and then you play match 3. truck creates
> resources in you matching board that you use to expand. How to gain win
> points. this should have a never show this again button.

Every one of those sentences is a step, in that order.

## What shipped

One stepped card — `src/iso/tutorial.ts` — that opens over the freshly booted
HUD before the player's first click and walks the whole loop. It is a tour, not
a scripted hand-holding: nothing is placed for the player, no game rule changes
while it is up, and the map keeps rendering underneath it.

| # | Step id | What it teaches | Figure |
| - | ------- | --------------- | ------ |
| 1 | `loop` | The one loop: node → Depot → roads → plant → match-3 → cargo → expand | the loop as a chain of brass chips |
| 2 | `plant` | Raise the free opening **Processing Plant**, edge-on to a town | mini-map: a legal footprint in green, a refused one in red |
| 3 | `depot` | **Depot** in a 4×4 catchment; one Depot holds each industry; first is free | mini-map: an industry, its catchment, the Depot |
| 4 | `roads` | **Dirt Road** drag from Depot to Plant; the lorry IS the connection; paved is faster and is what scores | mini-map: dirt → paved → plant, lorry on the run |
| 5 | `board` | **Match-3**: deliveries stamp numbered tokens, only tokened gems pay, 4 doubles, 5 forges a bomb | the real painted hex gems, with token badges and a 3-run lit |
| 6 | `expand` | Cargo lands in the purse and buys the next Depot / road / plant; Bank 4:1, Market, Feed; Gold is sabotage money | — |
| 7 | `victory` | **How ★ are won**: +0.25★ per dirt tile paved, +1★ per extra plant, 0★ for dirt and for road on virgin ground, first to N★ | the point sources itemised on ledger paper |
| 8 | `desk` | Controls and where every panel lives | — |

The card's foot is three controls: **Never show this again** on the left, one
diamond pip per step in the middle (clickable), **◀ Back / Next ▶** on the
right — and the last step's key reads **Start playing ▶**. `Esc`, the ✕ and a
click on the veil all skip; `←`/`→`/`Home`/`End` walk; `Tab` is trapped inside
the card while it is the only thing that matters.

## The gate: when it appears, and the one way to stop it

```
shouldShowTutorial(search, storage)
  ?tutorial=0 | off | never | no   → false   (playtest links, the e2e gameplay specs)
  ?tutorial=1 | on  | yes          → true    (a reviewer, over a stored dismissal)
  hexmatch:tutorial === "never"    → false   (the player pressed the button)
  otherwise                        → true
```

and `game.ts` only asks when it also asks AI-02's difficulty prompt:

* **no restored save** — a resume belongs to a player who is mid-match (AI-03's
  rule; the tour is the same kind of first-run card as the difficulty picker);
* **a solo seat** — a networked match is already live and the host is waiting.

The dismissal is one localStorage key, `hexmatch:tutorial = "never"`
(`TUTORIAL_STORAGE_KEY` / `TUTORIAL_NEVER`). It is **data, never a phase
inference** — E8's K1 rule, the same discipline `freeTrack` and `skill.ts`
follow — so no code path can silently un-ask or re-ask it.

The asymmetry the ticket asked for is deliberate and is printed on the card:

| Exit | Writes `hexmatch:tutorial`? |
| ---- | --------------------------- |
| **Never show this again** | **yes** — the only exit that persists |
| Start playing ▶ (last step) | no |
| ✕ / `Esc` / the veil | no |
| `?tutorial=0` | no (it is a URL, not a preference) |

So a player who skips keeps meeting it until they say stop, and the sentence
under the buttons tells them exactly that: *"Skip closes it for now — 'Never
show this again' is what keeps it closed. Replay it any time from the ❔ in the
top bar."*

The ❔ help modal's new **▶ Replay the tour** opens it with `force: true`, so
the lesson is never lost by the preference — the preference only stops the tour
opening *itself*. A replay passes the HUD's live numbers (see below) and leaves
the stored preference untouched.

## Boot order

```
boot (no save, solo)
  ├─ TUT-01 the tour           ← one card, eight steps, skippable
  │     └─ awaited
  ├─ AI-02 choose your rival   ← the smaller question, asked second
  └─ the player's first click
```

Both prompts are awaited in sequence, so two overlays never stack on the same
boot. The tour goes first because "how does this game work" has to exist as an
idea before "how sharp should the rival be" means anything. It costs nothing to
read it: `aiTick` and the economy clock both refuse to run before
`phase === "play"`, and the tour is up during `setup-factory` — the rival does
not move until the player's Plant and first Depot are down.

`showTutorial` returns a handle whose `promise` settles exactly once, and
`dispose()` calls `destroy()` on it — which settles the promise, so a game torn
down mid-tour can never leave the boot chain awaiting a card that no longer
exists (and never leaks its document `keydown` listener).

## Rule 1: no number is typed twice

The tour is prose about a live economy, so it reads the economy. Every price,
★ value and board dimension in the copy is interpolated from the authoritative
table at render time:

| In the copy | Read from |
| ----------- | --------- |
| Depot price | `costLabel(DEPOT_COST)` |
| Dirt / paved / pave-in-place prices | `costCompact(TRANSPORT.dirt.cost / TRANSPORT.road.cost / UPGRADE_COST)` |
| Extra plant price | `costCompact(PLANT_COST)` |
| ★ per pave, ★ per plant, 0★ rows | `VICTORY.upgrade` / `VICTORY.plant` via `fmtVp` |
| Bank rate | `BANK_RATE` |
| Board size | `BOARD_W × BOARD_H` |
| The ★ line it races to | `ctx.vpTarget` — `winTarget()` at boot, the HUD's live line on a replay |
| Free dirt tiles | `ctx.freeTrack` — `me.freeTrack` at boot, the HUD's live count on a replay |

Those last two are the only numbers the module cannot read for itself (one
belongs to the live difficulty, the other is data on the player record), so
`game.ts` and the help modal pass them in — importing `game.ts` from
`tutorial.ts` would be a cycle. `buildTutorialSteps({ vpTarget: 5, freeTrack: 3 })`
therefore prints an Easy-chair 5★ race and a 3-tile allowance, which is what
the drift guard in `tests/unit/iso-tutorial.test.ts` pins: a rebalance moves the
lesson with the rule, or the test fails.

## Files

| File | What it does |
| ---- | ------------ |
| `src/iso/tutorial.ts` | **new** — the gate, the pure content builder, the projector |
| `src/game/styles.css` | **new** `TUT-01` section: the card, the four figure kinds, the phone layout |
| `src/iso/game.ts` | boot wiring (tour → difficulty prompt), `tutorialView` + its `destroy()` in dispose |
| `src/game/ui.ts` | the ❔ help modal's *Replay the tour*, and the two live numbers it passes |
| `tests/unit/iso-tutorial.test.ts` | **new** — 35 tests: gate, content, projector, figures, the ask item by item |
| `tests/e2e/iso-tutorial.spec.ts` | **new** — real browser: first boot, handover, persistence, replay |
| `tests/e2e/*.spec.ts`, `tests/unit/iso-*.test.ts` | the boot harnesses remember the dismissal, exactly as they already remember a difficulty, so they play a game instead of testing onboarding |

The figures are CSS, not art: the mini-maps are `clip-path` diamonds on the
map's own 2:1 lattice, the board step draws the repo's painted hex gems from
`src/assets/gems/` through the same glob `ui.ts` uses, and the ledger is the
same paper as `.help-col` and `.tax-row`. No atlas cell, no new PNG, nothing to
404 — and no HUD box moves, so the corridor picker's geometry is untouched
(`tests/unit/iso-noir-theme.test.ts` still passes unchanged).

## Testing

```bash
npx vitest run tests/unit/iso-tutorial.test.ts
npx playwright test tests/e2e/iso-tutorial.spec.ts
```

The unit suite is the content contract (does the copy quote the tables, does
the gate answer correctly, does only the button persist, does the projector
walk both ways and settle once). The e2e spec is the wiring contract a headless
DOM cannot give: that a first-time player really meets the tour after *Play vs
AI*, that the difficulty prompt waits for it, that the ledger prints the live
difficulty's ★ line, and that a reload after *Never show this again* boots
straight to the map while ❔ still replays the lesson.

## Where to tune

* **A step's words** — `buildTutorialSteps` in `src/iso/tutorial.ts`. Add a
  `TutorialStep` to the array; the pips, the counter and the keyboard all read
  the array's length, so nothing else changes.
* **A new figure kind** — extend the `TutorialFigure` union, add a branch to
  `figureNode`, add a `.tut-fig-<kind>` block to the CSS. The projector is
  exhaustive over the union, so `tsc` names every place that needs the branch.
* **When it appears** — `shouldShowTutorial` for the preference and the URL
  flags; the `!bootSave && isSolo()` block in `game.ts` for the boot gate.
* **The card's look** — the `TUT-01` section of `src/game/styles.css`, which
  sits beside AI-02's difficulty prompt and shares its felt plate.
