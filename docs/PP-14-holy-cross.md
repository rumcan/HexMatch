# PP-14 — The holy cross: an angel and a choir for the cross match

## What the player asked for

When a match lands in the shape of an **X / cross** — 3 gems in a row and 4
in a column overlapping on one gem (6 unique gems) — two things must happen:

1. a **holy sound** (choir), and
2. a **PNG of a praying angel** popping up on the board, in the same
   one-shot pop style as the other fx icons (✦ crack, ✖ bad swap, 💣 bomb).

The cross pays **4 of any resource** — double what a match-5 or an L pays
(2 random materials).

## What shipped

| Piece | Where | What it does |
| ----- | ----- | ------------ |
| Cross detection | `src/game/board.ts` `crossPair()` / `crosses()` | A 3-run and a 4-run of one colour, one horizontal and one vertical, overlapping on exactly one gem: the centre of the 3-run and an interior (non-end) gem of the 4-run. Either orientation counts (3 across + 4 down, or 4 across + 3 down). A corner share stays an L; an end share stays a T — only the true cross is holy. |
| The reward | `board.ts` `resolve()` | **4 random materials** drawn from `BASE_POOL` (the five construction cargoes — gold is deliberately absent, matching the match-5/L audit), paid under the arcade name **HOLY CROSS**, which is also the callout. A match-5 / L still pays 2. |
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
cross on board  →  resolve()  →  grantRandom(4, "HOLY CROSS")   (+4 materials)
                              →  onFx("cross", mid.r, mid.c)
                              →  ui.fx("cross")  →  .fx-cross div + angel.png
                                                 →  playHoly()  →  choir swell + bells
```

Only the player's board is wired to `ui.fx` (`iso/game.ts`), so the rival's
headless board never summons the angel — the blessing is earned, not awarded.

## Tests

- `tests/unit/board.test.ts` — a 3+4 cross grants exactly
  `["HOLY CROSS", "HOLY CROSS", "HOLY CROSS", "HOLY CROSS"]` and fires
  `cross` at the crossing gem; the rotated 4+3 cross is holy too; a 3+3 T
  and a 4-run sharing its end stay L-SHAPEs.
- `tests/unit/iso-game.test.ts` (PP-14 block) — the mounted UI pops `.fx-cross`
  with the angel PNG at the crossing cell, floats the HOLY CROSS callout, and
  starts the choir (fake AudioContext counts oscillators).
- `tests/unit/iso-fx-styles.test.ts` — the existing FxType→CSS contract now
  covers `cross`, so `.fx-cross` can never silently lose its rule.
- `tests/unit/holy.test.ts` — `playHoly()` / `prewarmHoly()` never throw
  where there is no AudioContext (jsdom).
