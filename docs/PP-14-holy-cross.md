# PP-14 — The holy cross: an angel and a choir for the cross match

## What the player asked for

When a match lands in the shape of an **X / cross** — 3 gems in a row and 3 in
a column overlapping on the centre gem (5 unique gems) — two things must
happen:

1. a **holy sound** (choir), and
2. a **PNG of a praying angel** popping up on the board, in the same
   one-shot pop style as the other fx icons (✦ crack, ✖ bad swap, 💣 bomb).

## What shipped

| Piece | Where | What it does |
| ----- | ----- | ------------ |
| Cross detection | `src/game/board.ts` `crosses()` | A horizontal 3-run + a vertical 3-run of one colour whose overlap is the centre gem of *both* runs. A corner share stays an L; an end share stays a T (L-SHAPE) — only the true cross is holy. |
| The reward | `board.ts` `resolve()` | The cross grants the same two random materials it always did (it used to be swallowed by `lShapes` and paid as an L-SHAPE) — now under its own name: **HOLY CROSS**, which is also the arcade callout. |
| The angel | `src/assets/ui/angel.png`, `ui.ts` `fx()`, `.fx-cross` in `styles.css` | `onFx("cross", r, c)` pops the praying-angel PNG at the crossing gem — same absolute-positioned one-shot div as every other fx, risen higher with a golden halo (`crossfx` + `crosshalo` keyframes, glow via `drop-shadow`). |
| The choir | `src/game/holy.ts` `playHoly()` | Synthesised on the spot with Web Audio — no asset, no decode, no network: an A-major pad (6 detuned voice pairs with slow wobble = "many voices") under a soft high bell arpeggio. Wrapped so a missing/blocked AudioContext stays silent instead of breaking the board. |

### Why the sound is synthesised, not recorded

The repo ships no audio assets and no audio pipeline. A generated chord
swell needs nothing to load, can never 404, and the whole call is inside a
try/catch — sound is garnish, and garnish must never break the board. It is
triggered from `ui.fx()` on the `cross` type, i.e. exactly once per cross, at
the same instant the angel pops (the swap that made the match is a user
gesture, so the AudioContext starts unlocked).

### The wire, end to end

```
cross on board  →  resolve()  →  onFx("cross", mid.r, mid.c)
                              →  ui.fx("cross")  →  .fx-cross div + angel.png
                                                 →  playHoly()  →  choir swell + bells
```

Only the player's board is wired to `ui.fx` (`iso/game.ts`), so the rival's
headless board never summons the angel — the blessing is earned, not awarded.

## Tests

- `tests/unit/board.test.ts` — a cross grants exactly `["HOLY CROSS", "HOLY CROSS"]`
  and fires `cross` at (2,2); a T-shape still pays as L-SHAPE; a corner L still
  pays as L-SHAPE.
- `tests/unit/iso-game.test.ts` (PP-14 block) — the mounted UI pops `.fx-cross`
  with the angel PNG at the crossing cell, floats the HOLY CROSS callout, and
  starts the choir (fake AudioContext counts oscillators).
- `tests/unit/iso-fx-styles.test.ts` — the existing FxType→CSS contract now
  covers `cross`, so `.fx-cross` can never silently lose its rule.
- `tests/unit/holy.test.ts` — `playHoly()` never throws where there is no
  AudioContext (jsdom).
