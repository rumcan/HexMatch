# PP-14 — The holy cross: an angel and a choir for the cross match

## What the player asked for

When a match lands in the shape of an **X / cross** — 3 gems in a row and 4
in a column overlapping on one gem (6 unique gems) — two things must happen:

1. a **holy sound** (choir), and
2. a **PNG of a praying angel** popping up on the board, in the same
   one-shot pop style as the other fx icons (✦ crack, ✖ bad swap, 💣 bomb).

The cross pays **4 of one resource the player chooses** — a five-cargo
chooser pops over the board and the cascade waits for the pick.

## What shipped

| Piece | Where | What it does |
| ----- | ----- | ------------ |
| Cross detection | `src/game/board.ts` `crossPair()` / `crosses()` | A 3-run and a 4-run of one colour, one horizontal and one vertical, overlapping on exactly one gem: the centre of the 3-run and an interior (non-end) gem of the 4-run. Either orientation counts (3 across + 4 down, or 4 across + 3 down). A corner share stays an L; an end share stays a T — only the true cross is holy. |
| The reward | `board.ts` `resolve()` / `settle()` / `chooseCrossReward()` | The cascade PAUSES on `onCrossChoice`: the UI's chooser answers which cargo the blessing should be, and the board pays **4 of that one cargo** under the arcade name **HOLY CROSS** — paid as forged (never network-gated), so the chosen cargo lands in the purse whatever the network reaches. A match-5 / L still pays 2 random. |
| The chooser | `ui.ts` `crossPick()`, `.cross-pick` in `styles.css` | Five cargo buttons (+4 each) pop over the board with the angel's moment. Clicking one credits the purse and closes the panel; a 6.5s UI timer auto-answers with a random cargo, and the board's own 8s backstop is the second line of defence — a cascade can never hang on an unanswered chooser. |
| The angel | `src/assets/ui/angel.png`, `ui.ts` `fx()`, `.fx-cross` in `styles.css` | `onFx("cross", r, c)` pops the praying-angel PNG at the crossing gem — same absolute-positioned one-shot div as every other fx, risen higher with a golden halo (`crossfx` + `crosshalo` keyframes, glow via `drop-shadow`). |
| The choir | `src/game/holy.ts` `playHoly()` | Synthesised on the spot with Web Audio — no asset, no decode, no network: an A-major pad (6 detuned voice pairs with slow wobble = "many voices") under a soft high bell arpeggio. Wrapped so a missing/blocked AudioContext stays silent instead of breaking the board. |

### Why the sound is synthesised, not recorded

The repo ships no audio assets and no audio pipeline. A generated chord
swell needs nothing to load, can never 404, and the whole call is inside a
try/catch — sound is garnish, and garnish must never break the board. The
context is unlocked (`prewarmHoly`) on the first touch of the board, and the
choir plays from `ui.fx()` on the `cross` type — exactly once per cross, at
the same instant the angel pops.

### The wire, end to end

```
cross on board  →  resolve()  →  onFx("cross", mid.r, mid.c)
                              →  ui.fx("cross")  →  .fx-cross div + angel.png
                                                 →  playHoly()  →  choir swell + bells
              →  settle() pauses  →  onCrossChoice(pick)
                                  →  ui.crossPick()  →  player clicks a cargo
                                  →  pick(res)  →  +4 of that cargo, cascade resumes
```

Only the player's board is wired to `ui.fx` / `onCrossChoice` (`iso/game.ts`),
so the rival's headless board never summons the angel and auto-picks a random
cargo — the blessing is earned, not awarded.

## Tests

- `tests/unit/board.test.ts` — a 3+4 cross pauses on the chooser and, when it
  answers "wood", pays exactly `HOLY CROSS:wood:1` ×4 and fires `cross` at
  the crossing gem; with no chooser wired it still pays four of ONE random
  cargo; the rotated 4+3 cross is holy too; a 3+3 T and a 4-run sharing its
  end stay L-SHAPEs.
- `tests/unit/iso-game.test.ts` (PP-14 block) — the mounted UI pops `.fx-cross`
  with the angel PNG at the crossing cell, shows the five-cargo chooser,
  starts the choir (fake AudioContext counts oscillators), and clicking the
  wood button pays +4 wood into the purse and closes the panel.
- `tests/unit/iso-fx-styles.test.ts` — the existing FxType→CSS contract now
  covers `cross`, so `.fx-cross` can never silently lose its rule.
- `tests/unit/holy.test.ts` — `playHoly()` / `prewarmHoly()` never throw
  where there is no AudioContext (jsdom).
