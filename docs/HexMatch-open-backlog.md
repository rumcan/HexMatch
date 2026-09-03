# HexMatch — open backlog

Supersedes v6. Audited against `main` after the Y1/Y2 terrain+road PR merged.
**Updated after Part 1 landed: J1 and J2 are done, the game is playable, and
the remaining work is Part 2 (sprites).**

Read this first — the plan is unchanged (put the map into the old game). Part 1
is now history, kept below as a record of what actually shipped and where it
deviated. Two of the Part 2 tickets still need correcting: one is done, and one
was misdiagnosed.

---

## What changed since v6

| v6 ticket | Status now |
|---|---|
| **Y2b** terrain triangles | ✅ **Done.** `cells.json` has a single `terrain_grass` → declared sprite 3981; `terrain_grass_b` and the `tileHash` variant branch are gone. The manifest invariant (every terrain sprite flat 64×31, yrel 0) is in place, so slopes can't be used as flat tiles again. Triangles are gone in-game. Close it. |
| **Y4b** roads 90° | ⚠️ **Partly — and the ticket was incomplete.** The 90° rotation is genuinely fixed: `track.ts` now has `toOpenttdRoadBits`/`fromOpenttdRoadBits`, tested across all 16 masks. But roads still don't look like roads (see Y4c below) — the remap was only half the problem. |
| **Y3** buildings | ❌ Not started. All ten industry/factory cells are still `compose` blocks. |
| **J1** mount the board | ✅ **Done.** `src/iso/game.ts` mounts `Board` as the Quarry panel, gates its harvest on the reachable-cargo set from `economy.ts`, and surfaces the trading panel. See the Part 1 record below. |
| **J2** fate of `hexmap.ts` | ✅ **Done.** `hexmap.ts`, `actions.ts` and `state.ts` deleted; the restored tests rebased. `src/game/` is now `board.ts` + `trade.ts` + `config.ts`. |

Grass was the only visible win when this was written. Now the board is on the
map and the loop closes: factory → harvester → connect → match → cargo → trade.

The core reframing from v6 was **you have a map with no game on it.** That is
fixed. What is left is that some of the sprites on it are still generated
rather than declared — Part 2.

---

# Part 1 — Join the two halves ✅ DONE

## J1. Mount the match-3 board and game UI in the iso app — done

`board.ts` is instantiated by `src/iso/game.ts` and rendered as the Quarry
panel beside the map; the tool bar gained Quarry/Trade toggles without losing
Road/Rail/Harvester/Demolish.

**The join** lives in `src/iso/quarry.ts`:

- `GEM_TO_CARGO` is a bijection from the six gem colours to the six cargoes
  (wheat→grain, wood→wood, ore→ore, gold→gold; brick and sheep take the two
  cargoes with no gem colour, stone and oil). Unit-tested as a bijection.
- The gate is `economy.playerResources` — the reachable set scoring already
  computes. It decides which colours carry harvest tokens, and it is re-read
  **at match time**, not from the cached set the panel displays. A cached gate
  is only as fresh as its last refresh, so "demolish the road, match the tokens
  anyway" would have paid out. Cutting a line also demotes its tokens, so the
  board shows the truth rather than a stale promise.
- Tokens appear the moment a connection completes (`rescoreNow` →
  `quarry.refresh`), not on the 20s clock.

**Deviations worth knowing about:**

1. **The human's passive cargo trickle is gone.** `economyTick` used to pay
   every player for connected harvesters; now it pays only the rival, who has
   no board. Two income systems would have made the quarry decorative, and the
   spec's loop ("matching gems harvests from whatever your network reaches")
   only works if matching is the harvest.
2. **State has one owner: the player purse.** The board owns gems, the market
   owns live offers (escrow), neither keeps a balance. `state.ts`/`actions.ts`
   were not revived — see J2.
3. **`trade.ts` is now generic** over the resource key and takes its market
   record as a parameter, so the iso game and the restored tests share one
   implementation instead of two.

**Acceptance — all met:** map and board boot together; a match increases the
correct cargo and nothing else; unreachable cargo pays nothing; cutting the
line stops it; spending cargo still builds road/rail; trading works (4:1 bank
plus escrowed offers the rival answers); `board.test.ts` and `trade.test.ts`
green. The boot test asserts the board mounts and a gem match moves cargo, and
both gates were mutation-checked — removing either one fails the suite.

No sprite edits, as the ticket asked.

## J2. Decide the fate of `hexmap.ts` — done: deleted

J1 proved the iso grid feeds the board, and a grep confirmed the only importers
left were `actions.ts` (itself dead once `trade.ts` stopped using `gainRes`) and
three test files. Deleted: `hexmap.ts`, `actions.ts`, `state.ts`,
`hexmap.test.ts`, `actions.test.ts`.

`trade.test.ts` was rebased rather than deleted — same five tests, same
assertions, but they build their own market record and traders instead of a hex
map and the global `G`. Trading never touched the grid; that import was the last
thread tying the suite to `hexmap.ts`. `src/game/` is now `board.ts`,
`trade.ts`, `config.ts`.

The hex-era rule tables in `config.ts` (TILES, COSTS, SABOTAGE/SECURITY, the
hex geometry and sabotage timers) are unreferenced but deliberately kept, and
labelled as such at the top of the file: sabotage is still a settled design
decision, and re-tabling it from scratch would be worse than carrying the
numbers.

---

# Part 2 — Sprite fixes (after the game is playable)

## Y4c. Roads still render as the arm-generator's bars, not the real OpenGFX sprite
`[bug] [assets]` — supersedes the "done" half of Y4b

The 90° fix was real, but roads still don't look like roads — they're thin diagonal bars with brown on **both** long edges and no centre lane marking. That's because the sprite is still being **generated**, not used.

I compared the two directly. OpenGFX sprite 1332 (in `infra06.png`, already in the repo) is a full-width grey road surface filling the tile, with white dashed lane markings down the centre. What the atlas emits is a clipped bar textured from a sampled strip. The PR description gives it away:

> The 16 masks are still **generated from the declared straight half-piece, rotated/mirrored**…

So it changed where the half-piece is *sampled from* but kept `makeGenerated()` / `clipArm` / `TRACK_HALF_W` — the placeholder art path. Sampling real pixels through a procedural clipper still produces procedural bars.

**This is the third time roads have been reported fixed. Each time the generator was tweaked instead of removed. The generator is the bug.**

**Fix — delete the road/rail generator, blit the declared sprites directly:**

- OpenGFX ships the complete flat road set at sprite ids **1332–1342** (rail at 1012+): straights, curves, T-junctions, crossroads, each a finished 64×31 tile. Nothing needs generating.
- For each of the 16 masks: convert to OpenTTD bit order via the existing `toOpenttdRoadBits`, then index OpenTTD's sprite table — `GetRoadSpriteOffset` flat lookup is `[0,18,17,7, 16,0,10,5, 15,8,1,4, 9,3,6,2]` — and blit that declared sprite into the cell.
- **Delete** the road/rail branch of `makeGenerated()`, plus `clipArm` and `TRACK_HALF_W`. They were always placeholder.

**Acceptance**
- A straight road renders as a full-width grey surface with centre lane markings, visually matching sprite 1332 — not a brown-edged bar.
- No road/rail cell passes through the generator; grep for `clipArm` returns nothing.
- The 16-mask remap test still passes.
- The old X4 join test was checking generated geometry — rewrite it to assert the **declared** pieces tile seamlessly (no transparent column at a straight join).

## Y3. Buildings are hand-typed `compose` blocks, not real sprites
`[bug] [assets]`

Unchanged from v6, still not started. All ten industry/factory cells (`farm`, `forest`, `ore_mine`, `quarry`, `oil_rig`, `gold_mine`, `factory_×4`) are `compose` blocks stitching guessed pixel boxes. `oil_rig`/`ore_mine` look acceptable because their guesses happen to land on coherent regions; `farm`, `forest`, `gold_mine` and `factory` stitch fragments — the broken-looking ones.

Same fix as terrain and (now) roads: use the declared sprite, don't assemble one.

- Replace every `compose` block with **one declared building sprite per industry** (option b). One real building on a plain ground tile.
- No `box`/`crop`/`tiles`/`compose` arrays anywhere in the cells file after this.
- `factory` uses one declared factory sprite with the player tint applied.
- **`oil_rig`:** still 768×160 (the whole 6-frame animation strip as one sprite). Reference a single declared frame, or declare `frames` with per-frame width.

**Acceptance:** every building is one contiguous structure; no `compose` blocks remain; sprite width ≤ footprint_w × 64 + 32 (kills the 768px rig); contact sheet confirms each reads as a complete building.

## Y5 / Y6. Declared anchors + remaining invariants
`[bug] [renderer] [testing]`

After Y4c and Y3 land: switch sprite placement from hand-authored `anchor` to declared `xrel`/`yrel` (`dest = tileOrigin + (xrel, yrel)`; honour `NOCROP`). Then the invariants that would have caught the sprite bugs before they shipped:

- Every atlas sprite resolves to a declared OpenGFX id — i.e. **no `compose` blocks remain** (catches Y3).
- Sprite width ≤ footprint_w × 64 + 32 (catches the 768px rig).
- No road/rail cell references the generator (catches Y4c regressions).

The terrain invariant (Y2b) and the 16-mask remap test (Y4b) are already in place.

---

## Sequencing

**~~J1 → J2~~ → Y4c → Y3 → Y5/Y6.**

J1 and J2 are merged. Y4c is next.

Y4c before Y3 only because it's smaller and proves the "delete the generator, use the declared sprite" pattern one more time; order between them doesn't much matter. Both are quick now that the parser exists and can be checked by eye in a running game — and there is now a running game to check them in.

---

## Process note

Two recurring failure modes on this project, worth guarding against directly:

1. **"Set up but not applied."** Terrain got the parser; roads got the remap; both stopped one step short of using the result. The Y5/Y6 invariants (no `compose`, no generator reference) turn "did you actually finish" into a red CI run instead of a screenshot review.
2. **Scope timeouts.** The one big multi-part attempt crashed. Every ticket above is sized to one session; keep them that way and stop at each acceptance block rather than continuing into the next.