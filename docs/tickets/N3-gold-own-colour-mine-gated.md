# N3 — Gold becomes its own colour, spawned only with a connected gold mine

**Status:** FIXED — 2026-09-06, on `arena/01a07734-hexmatch` (this PR).
See [Resolution](#resolution-2026-09-06).
**Filed:** `docs/HexMatch-open-backlog.md` N3, `[feature]` — "restating so
it's not lost" from the prior ticket round; the backlog asked for it as its
own PR after the rendering fix.
**Area:** `src/game/board.ts` (match scan, combo banking, spawn gate),
`src/iso/quarry.ts` (the live gate wiring), `src/game/ui.ts` (help copy),
`tests/unit/board.test.ts`, `tests/unit/iso-quarry.test.ts`,
`tests/unit/iso-game.test.ts`.

---

## The change (the backlog's three clauses)

1. **Gold matches only gold.** `Board`'s scan loses the wild branch entirely:
   `lineRuns` matches runs of one colour, and gold is simply a colour. A gold
   gem no longer completes another colour's run; three golds in a row are a
   plain gold match (and pay gold only if a token rides on them, like every
   other colour). Removed: `isWild`, the `color === null` run anchoring, the
   trailing-wild reuse arithmetic, and the "first non-gold" anchor logic in
   `resolve`.
2. **Gold gems spawn only while a harvester is connected to a gold mine.**
   The join is the existing network-reach gate in `quarry.ts`
   (`tokenPool`/`reachableCargo`): `pool.gold` exists only when the network
   actually delivers gold, and `spawnTokens` already spawned from it — that
   path is unchanged and now documented as THE gold-gem path. The other gold
   source, the combo coin, gains `Board.goldReachable` — wired by the quarry
   to a LIVE reach recompute (match-time philosophy: one flood fill per
   banking is free) — and mints its board gem only while the gate is open.
   The coin's **purse** payout (`onGold(1)`, W5) is deliberately
   **unconditional**: banking a combo always pays, exactly as W5 shipped.
3. **Spawn mechanic unchanged** — `spawnGold` still replaces one neutral gem
   in place with a tiered gold gem; nothing about how gems appear moved.

## What changed

| file | change |
|------|--------|
| `src/game/board.ts` | wild-gold logic removed from `lineRuns`/`resolve`; `goldReachable` callback (default deny — a bare board with no map never mints board gold) documented next to the hooks; `registerCombo` gates only the board gem on it; comments updated at `spawnTokens`/`spawnGold`. |
| `src/iso/quarry.ts` | `createQuarry` wires `board.goldReachable` to a live `reachableCargo(...).gold > 0` — the same network gate that spawns the other tokens, evaluated at banking time. |
| `src/game/ui.ts` | the gem element's `wild` class is now `gold` (the coin face is unchanged — gold gems still draw the gold sprite); the Quarry help copy says gold "is its own colour — it spawns only while a harvester is connected to a gold mine" instead of "Gold 🌹 is wild". |
| `tests/unit/board.test.ts` | the "treats gold gems as wildcards" test is replaced by "N3: gold is its own colour — it matches only gold" (gold-between-woods completes nothing; gold-gold-gold is a plain gold run); the combo test sets the gate; new test: without reach a combo pays the purse but places NO gold gem. |
| `tests/unit/iso-quarry.test.ts` | new N3 test through the real quarry: with a gold mine + harvester + factory on the map, the coin mints no gem until the road connects, then does — purse paid both times. |
| `tests/unit/iso-game.test.ts` | the W5 game test additionally asserts the real game's board holds NO gold gem after the coin (this boot has no connected mine) — the gate is wired through the real quarry. |

## Acceptance

1. ✅ **No wild behaviour** — gold-between-woods matches nothing; no test,
   code path or copy describes gold as wild any more.
2. ✅ **Mine-gated spawning** — asserted at three levels: the bare board
   (default deny), the quarry over a real grid/track (no road → no gem → road
   → gem), and the booted game (no gold gem on the real board without a
   connected mine). The join reuses the existing `reachableCargo` gate, as
   the backlog asked.
3. ✅ **Spawn mechanic unchanged** — `spawnGold` still converts one neutral
   gem in place; `spawnTokens`' `pool.gold` path is byte-for-byte the
   shipping behaviour.
4. ✅ **Board logic in its own PR** — this is that PR: the rendering fix
   (N1/N4) and the gold change are separate commits in one reviewable stack,
   with the gold tests confined to the board/quarry/game trio.
5. ✅ **408 unit tests pass** (390 before); typecheck clean; lint 0 errors
   (warnings unchanged from `main`). W5's game test still passes with its new
   N3 assertion.

## Verified the tests actually bite

Three separate reversions, each caught and then made green again:

- Restoring the **wild** scan (gold substitutes in any run) fails the N3
  match test in `board.test.ts`.
- Making the board default gate **always open** fails the board-level
  no-reach test (a combo mints a board gem with no mine).
- **Un-wiring** the quarry's `goldReachable` fails the quarry-level N3 test
  (the connected-mine case stops minting) — the wiring, not the board
  default, is what the live game uses.

## Not covered

No browser in the sandbox, so the visual coin-face/gem-sprite presentation
was not screenshotted from the real app (the sprite mapping is covered by the
V5 suite's jsdom assertions, which pass unchanged).
