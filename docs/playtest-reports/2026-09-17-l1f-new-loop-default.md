# L1f (#237) — the new loop is the default, and the promise says so

**Date:** 2026-09-17
**Ticket:** #237 *L1f — Turn the new loop on by default + update listing/tutorial copy*
(epic #223, the last sub-issue of #215; gated on the MVP milestone + playtest sign-off)
**Branch:** `arena/01a0adeb-hexmatch`

## What flipped

`src/iso/game.ts` resolves the flag the other way round now:

```ts
const newLoopRequested = opts.newLoop ?? loopParam !== "old";
```

* **No URL parameter is needed.** A solo sandbox boot — `/`, a playtest link, a
  production deploy — runs the clock loop. The `import.meta.env.DEV` gate L1a
  (#232) put around `?loop=new` is gone: it existed only while the loop was an
  experiment, and this ticket is the experiment shipping.
* **`?loop=old` is the escape hatch**, kept for one release, and
  `opts.newLoop: false` is its harness twin. `?loop=new` still resolves — it
  names the default instead of unlocking a hidden one, so every playtest link
  filed since #232 keeps working.
* **`opts.newLoop` still pins either way** (tests, harnesses, a link that wants
  a specific loop), which is what keeps the retired loop's suite honest.
* **The sandbox-only note answers a request, not a default.** It used to fire
  whenever a boot asked for the new loop and was refused (a room, a contract).
  After the flip every MP seat and every contract boot "asks" by default, so the
  note now waits for `opts.newLoop === true` or `?loop=new` — otherwise the
  campaign would open with an apology for the loop it is correctly not running.
  Refusal itself is unchanged: rooms and contracts stay on the retired loop
  until their own post-MVP tickets land.
* **Saves**: L1e's rule still holds in both directions — an old save loads under
  the new loop unchanged (its depots simply have no level, and the clock reads
  an absent level as the baseline), and a new-loop save opened through `?loop=old`
  is held back, unwritten, with the note that names the door (`open with
  ?loop=new` — after the flip that is what dropping `?loop=old` means).

## The bug the flip walked into

`showTutorial` built its context as `{ vpTarget, freeTrack }` and **dropped
`newLoop`**. Both callers (game.ts's boot chain and the ❔ replay) had been
handing the flag over since L4 (#218), so the tour's new-loop copy — the tuning
session, the clock caption — was unreachable from the game: a
`?loop=new` boot always recited the retired loop's sentences, and the L4 test
missed it because it asserted `buildTutorialSteps(…, { newLoop: true })`
directly rather than the card the boot mounts. With the flag now on by default
that dropped line IS the onboarding, so it is wired up and pinned by a boot test
that reads the mounted card.

## The copy that moved

| Surface | Was | Now |
| --- | --- | --- |
| **RUN.world listing** | "…match gems to turn every delivery into cash" | solds the clock + the tuning session (text below; the field lives in the RUN.world console, not in this repo) |
| **Setup toast** (`game.ts`) | `…then match the tokened gems in the Processing Plant` | the two sentences are now an exported pair, `setupDepotToast(newLoop)`, pinned for both loops; a default boot gives *"a connected Depot ticks its cargo in on the clock"* |
| **How to Play tour** (`tutorial.ts`) | "every delivery stamps a cargo token onto a gem" | the tour is built from the boot's flag, so the default game shows the tuning-session copy; the retired loop keeps the token copy behind `?loop=old` |
| **Tour · roads** | allowance countdown + "paving is the only road work that scores" | free gravel with no allowance countdown (L2's `freeAllowanceCovers`), paved lane at `×TRANSPORT.road.throughput`, "buys throughput, never ★" |
| **Tour · depot** | "every Depot after it costs `DEPOT_COST`" | the price is the industry you stand on (L5's tree: a Farm Depot 2 🪵 Wood, a Forest Depot 2 🪨 Stone) |
| **Tour · expand** | "Ore is the gate" | the tree's next rung is the gate, priced from `DEPOT_TREE` |
| **Tour · victory** | +0.25★ per pave, +1★ per plant, 10★ line | the loop's own three rows from `VICTORY.loop` (type / rung / city) and the live ★ target |

Everything above reads the tables the game pays from — no retyped number — which
is the tour's standing rule (`docs/TUT-01-starting-tutorial.md`).

## The listing copy for the RUN.world console

Repo note: the description and the screenshots are the **portal's** fields
(RUN.world console → this game's listing); nothing in this repo carries them, so
the replacement text lives here for whoever pastes it, in the same release as the
flip — the lesson the Merge Gardens deconstruction review left.

> **Hexmatch Industries** — build a freight empire on one island, and tune it
> with match-3. Lay a **free dirt road** from an industry to your Processing
> Plant, stand a **Depot** on the resource it reaches, then play a **short
> match-3 session** to set that Depot's **yield** — it ticks cargo in on the
> clock from then on. Spend the cargo on the next rung of the depot tree and on
> city upgrades that make the whole network tick harder, and out-build the rival
> to **12★**. Difficulty changes how long a tuned yield lasts — Easy never
> cools, Normal never drops, Hard decays and a re-match can lower it — never
> whether match-3 is part of the game.

Keywords stay as they are (`multiplayer, strategy, tycoon, match-3, puzzle,
economy, transport, pvp` — `game.config.prod.json`).

**Screenshots to replace** (the current set shows the token board as the money
engine, which is the sentence the listing no longer says):

1. A tuning session mid-flight: the plant floor with the plate counting moves
   and the yield it is worth.
2. A connected Depot + the purse chips climbing on the 3-second clock (the
   inspector open, showing `yield × distance × lane`).
3. The depot tree with the next rung's price on it, and a city upgrade beside it.
4. The island itself: a grown network of free gravel, lorries running, rival on
   the far side.
5. The ★ tooltip (the loop's three rows) at a score near the line.

## Verification

*Per the L-issue rule: verify by playing, not just by green tests.*

* `tests/unit/iso-l1f-default-loop.test.ts` boots the **real** game the way a URL
  does — `startIsoGame(root, {})` against a bare `?seed=1337`, no options — and
  reads the mounted DOM and `window.__iso`: the flag, the board being down, the
  Road button, the ★ line, the opening toasts after a Depot actually goes down,
  the tour card the first game opens, and the contract's refusal. Each has a
  `?loop=old` twin, so the escape hatch is proven to be the old game and not a
  half-migrated one.

### The harnesses that meant the old loop say so in their address bar

`iso-game.test.ts` is 3,600 lines of the RETIRED loop's behaviour — the always-on
board, the +0.25★ paving line, the 10★ race — and it said which loop it wanted
by *saying nothing*, because the retired loop was the default. Flipping the
default moves the ground under all of it: my first pass pinned each boot call
(`newLoop: false`, ~100 edits in eleven files), and every test it missed showed
up as a failure about a paving star or a 5★ chair that had nothing to do with this
ticket.

The pin is now one line per file, and it is the same door a player uses.
`startIsoGame` reads `?loop` off `location.search` itself, and every one of these
harnesses already writes an address bar in its `beforeEach` to pick its seed — so
that line carries the hatch:

```ts
window.history.replaceState(null, "", "/?seed=1337&loop=old");
```

Nineteen unit files that boot a solo game changed exactly that (plus
`iso-mp`/`iso-leave-room`/`iso-match-settings`, where it is a no-op the reader
still wants to see: `newLoop` is `… && isSolo() && !storyOn`, so a room and a
chapter are on the retired loop whatever the URL says). A test that wants the
other loop says so out loud — `{ newLoop: true }`, or its own `replaceState`, as
the L-series files already did while the flag was still off.

One attempt deserves a note, because it looked right and was not: a
`@vitest-environment-options {"url": "…?loop=old"}` docblock at the top of the
file sets the jsdom URL, and the game does honour it — but the `beforeEach` two
lines later replaces the URL to set the seed, and the hatch vanished with it. A
silent half-pin, which is the worst kind. The seed line is where the loop belongs.

#237's own acceptance pair in `iso-game.test.ts` reads the DEFAULT, so it steps
out of the hatch for the duration of the test and puts it back:

* *"with no loop parameter in the address bar the game is on the new loop"*;
* *"behind the hatch the economy chrome is still the whole one"*.

* **Whole unit suite, branch vs `main`:** 135 files, 1,457+ tests, and the
  branch's failure set is a SUBSET of `main`'s — 21 failures here, 21 there, the
  same names (measured in this sandbox; the box has two cores, so the number that
  matters is *which* tests, not how many passed). No new failure needed a
  loosened assertion: `iso-victory.test.ts`'s paving-cost test looked new (it is
  outside the 31-file list the pins were bisected against) and was checked on
  `main` in a worktree at `9efd770` — it fails there too, identically.

* Playwright, `desktop-chromium` in CI (`npm run test:e2e`, which builds first —
  so it is the production bundle, not a dev-server one, that is being proven):
  the browser path this sandbox cannot run (no Chromium download available here),
  so the click-through — map clicks for the Factory and the first Depot, the
  setup toast, the tour — is asserted there.
  * `tests/e2e/iso-loop-default.spec.ts` is NEW and is the ticket's acceptance in
    a browser: a bare boot reports `newLoop === true`, races 12★, has the board
    DOWN, sells free gravel and a Road button with no paving ★; the first
    tour's `loop` card says "tuning session" and never "stamps a cargo token",
    its roads card does not count down an allowance, and its ★ ledger ends on
    12★ with the loop's five rows.
  * `iso-game.spec.ts` (gameplay), `mobile-board-fit.spec.ts` (the always-on
    board's geometry), `iso-skill.spec.ts` (the chairs' short race) and
    `iso-tutorial.spec.ts` (the retired tour's cards) each boot through
    `?loop=old`, because every one of them asserts the retired loop's copy or
    geometry. Pinning them keeps them honest instead of loosening them.

## Known leftovers (deliberately not in this PR)
* **The repo's CI is red at the base.** Every one of the last five pushes to
  `main` failed all three jobs (`test`, `e2e`, `e2e-multiplayer`), and the 21
  failures above are #200's territory — reported here rather than folded into
  this PR, per the rule that a failure which also fails on `main` gets a link and
  not a fix. This PR's own `ci` run should show the same set, no more.

* **The ❔ help-modal plaque** (`src/game/ui.ts`, `helpModal()`) still describes the
  retired loop — "pave a Dirt Road tile into a Road for +0.25★", "Match tokens
  to process", `DEPOT_COST` for every Depot. Rewriting it is a second rule
  document, which is #230's job (*"Leftover sweep — copy, tabs, dead code, wire
  and saves"*) and #222's (*"Rewrite the tutorial steps and setup toasts for the
  new loop"*). One issue per PR, and this one is already the copy release.
* **Match/truck payouts** — #234 (L1c) is still open in the tracker while its
  behaviour is already covered by #233/#227's tests; if it lands differently,
  the tour's `expand` lede and the listing sentence above are the two lines to
  re-read.
* **Multiplayer, story contracts, and the `loop` chain figure** in the tour's
  first card (it still walks `… → Processing Plant → Match 3 → Cargo → Expand`):
  the caption above the chain is correct on both loops; the node list is #222's.
