# HexMatch — open backlog

Supersedes `HexMatch-open-backlog-v5.md`. Audited against `main` @ `c75aa60` (PR #9 merged).

Read this first — it reframes the whole problem, and the reframing is what your screenshots are pointing at.

---

## What is actually wrong

You have **two half-games that were never joined**:

1. **The old game** (`src/game/`): `board.ts` (the match-3 quarry, 427 lines), `trade.ts`, `actions.ts`, `state.ts`, `hexmap.ts`. The harvesting loop, trading, resources, win condition — the actual *game*.
2. **The iso layer** (`src/iso/`): a map renderer, terrain, roads, industries, a camera. A beautiful board with **no game on it**.

`src/App.tsx` boots `startIsoGame` and nothing else. `board.ts` and `trade.ts` were restored to disk in an earlier round but **nothing imports them** — I checked: no file in `src/iso/` references the board, quarry, or gems. So the match-3 isn't hidden or broken. It is dead code sitting next to a running program.

That is why "I don't see the old game interface with the hex match or any of the old gameplay." It was never wired in. Every previous round treated this as a rendering project and kept polishing sprites on a map that has no game attached.

**Your title is the correct plan: put the new map into the old game.** The iso map becomes the board that the existing match-3 / trade / build loop plays on. That is one integration task, and it should come before any more sprite work — there is no point perfecting a factory sprite for a game you can't play.

The sprite bugs are real and listed below (Part 2), but they are cosmetic next to this. Fix the game first.

---

# Part 1 — Join the two halves (do this first)

## J1. Mount the match-3 board and game UI in the iso app
`[P0] [gameplay] [blocker]`

This is the old X1b, promoted to the top and widened. Until it's done the project is not a game.

**Wire the board in.**
- `src/iso/game.ts` imports and instantiates `Board` from `src/game/board.ts`.
- The board renders as a panel in the iso layout — the same match-3 grid the original game had.
- Matching gems harvests cargo, exactly as before. The six gem colours already map to the six iso cargoes (`grain, wood, ore, stone, oil, gold`) — `src/iso/config.ts` even documents this alignment in a comment.

**Gate harvest by the network (this is the join).**
- A gem match only yields cargo for industries the player's road/rail network actually reaches. The iso side already computes reachable industries for scoring; feed that same set into the board so matching a "wood" gem produces wood only if a forest is connected.
- This is what makes the map matter to the match-3, and the match-3 matter to the map. It's the whole design.

**Restore the rest of the interface.**
- Trading panel (`trade.ts`) surfaced.
- Resource counts, VP / "first to 12", build tool bar — the iso game already has a tool bar (Road / Rail / Harvester / Demolish); extend it rather than replacing it.

**Acceptance**
- Booting the game shows the map **and** the match-3 board together.
- Matching gems increases the correct cargo, and only for connected industries.
- Spending cargo builds road/rail as it does now.
- Trading works.
- A full loop is playable: place factory → harvester → connect → match gems → get cargo → trade → expand.
- `board.test.ts` and `trade.test.ts` stay green.

Do **not** attempt the sprite tickets in the same session. This is the one job.

## J2. Decide the fate of `hexmap.ts` 
`[chore]`

`src/game/hexmap.ts` (the old Voronoi hex map) is still on disk and imported by the restored `board.ts`/tests. Once J1 proves the iso grid feeds the board, hexmap is genuinely dead. Confirm nothing in the live path imports it, then delete it and adjust the restored tests to build against the iso grid. Keep this separate from J1 so J1's diff stays reviewable.

---

# Part 2 — Sprite fixes (after the game is playable)

These are the "screwed up buildings" and the sideways road. They're the still-open Y-series — real, but cosmetic relative to Part 1.

## Y3. Buildings are hand-typed `compose` blocks, not real sprites
`[bug] [assets]`

Still not done. `tools/iso-atlas.cells.json` still builds every industry from guessed pixel boxes:

```json
"factory_blue": { "compose": { "tiles": [ {"dx":0,"dy":0,"box":[65,74]}, ... ],
                               "overlays": [ {"crop":[284,174,109,78], ...} ] }}
```

This is exactly why your screenshots differ per building. `oil_rig` and `ore_mine` look fine because their guessed boxes happen to land on coherent sprite regions. `farm`, `forest`, `gold_mine` and the main `factory` guess **wrong** boxes and stitch together fragments — the "shit" ones. It's the same defect throughout; some cells just got lucky.

The Y1 parser (merged, working) already gives the correct declared sprite for any OpenGFX id. Use it:

- Replace every `compose` block with a single declared building sprite per industry — option (b) from the prior brief. One real building on a plain ground tile.
- No hand-typed `box`/`crop`/`tiles` arrays anywhere in the cells file.
- `factory` uses one declared factory sprite with the player tint applied; stop assembling it from nine tile-boxes plus an overlay.

**Acceptance:** every building sprite is one contiguous structure over a clean footprint; no `compose` blocks remain; contact sheet confirms each reads as a complete building.

## Y4b. Road tiles are rotated 90° — the RoadBits remap is wrong
`[bug] [assets]`

The roads are "better but 90° turned the wrong way." That's the mask-order mismatch flagged earlier and evidently mis-wired: OpenTTD's `RoadBits` order is **NW=1, SW=2, SE=4, NE=8**; your `track.ts` uses **NE=1, SE=2, SW=4, NW=8**. A straight piece therefore selects the perpendicular sprite.

- Write the remap explicitly from your bit order to OpenTTD's, and unit-test all 16 values against expected visual orientation.
- A straight NE–SW connection must render the sprite that visually runs NE–SW, not NW–SE.

**Acceptance:** build a straight road in each of the two diagonal directions and confirm the sprite aligns with the direction of travel; the 16-value remap test passes; the existing X4 join test still passes unchanged.

## Y2b. Confirm the terrain triangles are gone
`[verify]`

The fourth screenshot still shows the green triangles. Earlier work pointed `terrain_grass` at the flat sprite (3981), but the triangles persist — so either the fix didn't land on the variant path, or a second slope sprite is still referenced.

- Verify in `iso-atlas.cells.json` that **no** terrain entry references a sloped ground sprite (heights 23/39/47 or non-zero `yrel`); the flat tile is height 31, `yrel 0`.
- If a `grass_b`/variant entry still points into the slope set, remove it.
- Add the manifest invariant from Y6 so this can't regress: every terrain sprite is 64×31 with `yrel 0`.

## Y5 / Y6. Declared anchors + manifest invariants
`[bug] [renderer] [testing]`

Carried over. After Y3/Y4b land: switch sprite placement from hand-authored `anchor` to declared `xrel`/`yrel`; add the invariants (terrain is flat 64×31; every atlas sprite resolves to a declared id; sprite width ≤ footprint × 64 + 32; the 16-value RoadBits remap). These are the tests that would have caught Y3 and Y4b before they shipped.

---

## Sequencing

**J1 → J2 → Y3 → Y4b → Y2b → Y5/Y6.**

J1 is everything. It's also a big enough task that it should be the sole focus of its session — the last attempt at a large sprite rework timed out from scope, so keep this one narrow: wire the board, gate it by the network, surface the panels, stop. No sprite edits in the J1 commit.

Once the game is actually playable, the sprite fixes are quick and can be verified by eye in a running game instead of against a static contact sheet.