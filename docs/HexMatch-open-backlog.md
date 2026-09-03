# HexMatch — open backlog

Supersedes v6. Audited against `main` after the Y1/Y2 terrain+road PR merged.

Read this first — the plan is unchanged (put the map into the old game), but two of the Part 2 tickets need correcting: one is done, and one was misdiagnosed.

---

## What changed since v6

| v6 ticket | Status now |
|---|---|
| **Y2b** terrain triangles | ✅ **Done.** `cells.json` has a single `terrain_grass` → declared sprite 3981; `terrain_grass_b` and the `tileHash` variant branch are gone. The manifest invariant (every terrain sprite flat 64×31, yrel 0) is in place, so slopes can't be used as flat tiles again. Triangles are gone in-game. Close it. |
| **Y4b** roads 90° | ⚠️ **Partly — and the ticket was incomplete.** The 90° rotation is genuinely fixed: `track.ts` now has `toOpenttdRoadBits`/`fromOpenttdRoadBits`, tested across all 16 masks. But roads still don't look like roads (see Y4c below) — the remap was only half the problem. |
| **Y3** buildings | ❌ Not started. All ten industry/factory cells are still `compose` blocks. |
| **J1** mount the board | ❌ Not started. `src/iso/game.ts` still imports nothing from `board.ts`. Verified: zero references to board/quarry/gem in the iso layer. |

Grass is the one visible win, which matches what you're seeing.

The core reframing from v6 still stands and is still the point: **you have a map with no game on it.** J1 remains the most important thing on this list.

---

# Part 1 — Join the two halves (still the priority)

## J1. Mount the match-3 board and game UI in the iso app
`[P0] [gameplay] [blocker]`

Unchanged from v6. Until this lands the project is not a game. `board.ts`, `trade.ts`, `actions.ts`, `state.ts` are all on disk and imported by nothing.

**Wire the board in.** `src/iso/game.ts` instantiates `Board` from `src/game/board.ts`; it renders as a panel in the iso layout; matching gems harvests cargo. The six gem colours already map to the six iso cargoes (`grain, wood, ore, stone, oil, gold`).

**Gate harvest by the network — this is the join.** A gem match yields cargo only for industries the player's road/rail network reaches. The iso side already computes that reachable set for scoring (`economy.ts`); feed the same set into the board.

**Restore the rest of the interface.** Trading panel (`trade.ts`) surfaced; resource counts, VP / "first to 12"; extend the existing Road/Rail/Harvester/Demolish tool bar rather than replacing it.

**Reconcile state.** `iso/game.ts` has its own state; `state.ts`/`actions.ts` are the restored dispatch layer. Pick one owner — do not run two state systems. Likely fold what the board needs into the iso state rather than reviving the old dispatcher wholesale.

**Acceptance**
- Booting shows the map **and** the match-3 board together.
- Matching gems increases the correct cargo, and only for connected industries.
- Spending cargo builds road/rail as it does now; trading works.
- Full loop playable: factory → harvester → connect → match → cargo → trade → expand.
- `board.test.ts` and `trade.test.ts` stay green.
- A boot test asserts the board mounts and a gem match changes cargo — so the game can never silently ship with no harvesting loop again.

**Keep this session narrow.** Wire the board, gate it, surface the panels, stop. No sprite edits in the J1 commit — the last large multi-part attempt timed out from scope.

## J2. Decide the fate of `hexmap.ts`
`[chore]`

Unchanged. `hexmap.ts` is still on disk, imported by the restored `board.ts`/tests. Once J1 proves the iso grid feeds the board, confirm nothing live imports hexmap, delete it, and rebase the restored tests onto the iso grid. Separate commit from J1.

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

**J1 → J2 → Y4c → Y3 → Y5/Y6.**

J1 first and alone — it's what turns this back into a game, and it's the one to keep narrow.

Y4c before Y3 only because it's smaller and proves the "delete the generator, use the declared sprite" pattern one more time; order between them doesn't much matter. Both are quick now that the parser exists and can be checked by eye in a running game.

---

## Process note

Two recurring failure modes on this project, worth guarding against directly:

1. **"Set up but not applied."** Terrain got the parser; roads got the remap; both stopped one step short of using the result. The Y5/Y6 invariants (no `compose`, no generator reference) turn "did you actually finish" into a red CI run instead of a screenshot review.
2. **Scope timeouts.** The one big multi-part attempt crashed. Every ticket above is sized to one session; keep them that way and stop at each acceptance block rather than continuing into the next.