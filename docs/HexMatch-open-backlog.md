# HexMatch — open backlog

Supersedes v8. Audited against `main` @ `ea97e96`. The original UI is now restored (U1 done). The live issue is that building sprites don't fill their isometric footprint — new ticket **Y7**, with Y3 tightened to cover the same root cause.

**Read this first.** The direction for the rest of the project, stated plainly so it stops drifting:

> **The UI must be the original HexMatch interface, and the gameplay must stay essentially what it was.** This is not a redesign. The isometric map replaces the old hex map underneath a game that otherwise looks and plays the same. When a ticket and "what the old game did" disagree, the old game wins.

Two new tickets capture what regressed against that principle (U1, U2). The sprite tickets (Y4c, Y3, Y5/Y6) are unchanged and still open.

**Work order: Y4c → Y3 (+Y7) → Y5/Y6.** U1 (restore UI) is done. U2 (setup highlight) still open, do it any time.

---

## What you're looking at, and why

**"Why am I seeing a new UI?"** Because J1 wrote one from scratch. It mounted the match-3 board as a floating dark "Quarry" panel with its own styling, rather than restoring the original interface. The original still exists in git history and is fully recoverable — see U1. Your first screenshot from way back (left BUILD + BLACK MARKET panels, right YOUR QUARRY with MARKET/BANK/FEED tabs, resource chips along the bottom) is the target, not the floating panel you have now.

**"The roads still look like crap."** Correct and unchanged — that's Y4c, still open, generator still running. Not touched by Part 1.

**"The build highlight is harvester-sized, then it builds the factory."** Real bug, confirmed in `game.ts`. That's U2.

Nothing here is mysterious; J1 delivered the *mechanics* of the join correctly (the harvest gating is genuinely good work) but replaced the presentation instead of reinstating it.

---

# Part A — Restore the original UI and feel

## U1. Bring back the original HexMatch interface
`[P0] [ui] [regression]`

The original UI is not lost. It's in history at the commit before it was deleted:

- `src/game/ui.ts` — **861 lines**, the full interface
- `src/game/styles.css` — **1209 lines**, all of its styling

Recover both:

```bash
git show 36413cf^:src/game/ui.ts    > src/game/ui.ts
git show 36413cf^:src/game/styles.css > src/game/styles.css
```

The original layout (matches the earliest screenshots):

- **Left column — BUILD:** Rail, Factory, Foundry, Toll Pass, each with its cost pills.
- **Left column — BLACK MARKET:** Blockade, Frost Tiles, Iron Girders, Smog Cloud, Security Forces.
- **Right column — YOUR QUARRY:** the match-3 grid, with **MARKET / BANK / FEED** tabs and the offer composer beneath it.
- **Top bar:** the four rival industry cards and the VP star counter.
- **Bottom:** the six resource chips.

**This is a reskin-in-place, not a rewrite.** The task is to make the recovered `ui.ts` drive the iso game:

- Point its build buttons at the iso build tools (the iso game already has Road/Rail/Harvester/Demolish; map the panel's Rail/Factory/Foundry onto the iso equivalents, keeping the original labels and layout).
- Feed its resource chips, VP counter and rival cards from the iso game state.
- Mount the **existing** `board.ts` inside the original QUARRY panel markup rather than the new floating panel. J1's harvest-gating logic in `quarry.ts` is correct and stays — only the container changes from the new panel to the original one.
- Wire the MARKET/BANK/FEED tabs to the trading that J1 already made work.

**Delete the new UI** (`src/iso/game.css` and the bespoke panel markup in `game.ts`) once the original renders. Keep the iso *canvas* layer stack — that's the map, and it's fine. Only the chrome around it reverts.

**Keep the good deviations from J1** (they don't change the UI, only the model):
- The passive cargo trickle staying off for the human, so matching is the only harvest.
- One state owner (the purse), board owns gems, market owns escrow.

**Acceptance**
- The game boots into the original BUILD / BLACK MARKET / QUARRY / chips layout, visually matching the early screenshots — not the floating dark panel.
- Every control the original had is present and wired: build, black-market actions, quarry, market/bank/feed, resource chips, VP.
- The J1 harvest gate still holds (unreachable cargo pays nothing; cutting a line stops it) — reuse `quarry.ts` unchanged.
- Existing board/trade/quarry tests stay green.

**Scope guard:** this is one session — recover the files, wire them to iso state, delete the new chrome, stop. No sprite work, no gameplay changes.

## U2. Setup highlight shows the wrong footprint, and factory/harvester feel swapped
`[bug] [ux]`

Confirmed in `game.ts`. During `setup-factory` the overlay is a single hover tile (`items.push({ sprite: "highlight", tx: hover.tx, ty: hover.ty })`) — 1×1, the size of a harvester — but placing it builds the **3×3 factory**. Then during `setup-harvester` it draws the full 4×4 catchment grid, which reads as the *bigger* highlight even though it places the small harvester. So the two feel backwards.

**Fix:**
- In `setup-factory`, draw the highlight at the factory's real 3×3 footprint (offset from the hover origin the same way the factory sprite is placed), so what you see is what you'll build.
- In `setup-harvester`, keep the catchment preview but visually distinguish the **harvester tile itself** (1×1, the thing being placed) from the catchment area (informational) — e.g. a solid highlight on the placed tile and a fainter tint on the catchment. Right now they're the same `highlight` sprite, which is what makes the harvester look factory-sized.
- Confirm the banners match: "place your Factory" while the 3×3 shows, "place your Harvester" while the 1×1 + catchment shows.

**Acceptance:** the highlight footprint always matches the building that will be placed; factory step shows 3×3, harvester step shows a clear 1×1 with a distinct catchment tint; a quick play-through reads correctly.

---

# Part B — Sprite fixes (unchanged from v7)

## Y4c. Roads still render as the arm-generator's bars, not the real OpenGFX sprite
`[bug] [assets]`

Unchanged and still open. Roads are thin diagonal bars with brown on both long edges and no centre lane marking, because the sprite is still **generated**, not used. OpenGFX sprite 1332 (in `infra06.png`, in the repo) is a full-width grey road with dashed centre markings; the atlas emits a clipped bar textured from a sampled strip.

**This is the third+ time roads have been reported fixed. The generator is the bug — remove it, don't tweak it.**

- OpenGFX ships the complete flat road set at **1332–1342** (rail 1012+): straights, curves, T-junctions, crossroads, each a finished 64×31 tile. Nothing to generate.
- For each of the 16 masks: convert to OpenTTD bit order via the existing `toOpenttdRoadBits`, index OpenTTD's flat table `[0,18,17,7, 16,0,10,5, 15,8,1,4, 9,3,6,2]`, blit that declared sprite.
- **Delete** the road/rail branch of `makeGenerated()`, plus `clipArm` and `TRACK_HALF_W`.

**Acceptance:** a straight road is a full-width grey surface with centre lane markings matching sprite 1332; grep for `clipArm` returns nothing; the 16-mask remap test still passes; rewrite the X4 join test to assert the declared pieces tile seamlessly.

## Y3. Buildings are hand-typed `compose` blocks, not real sprites
`[bug] [assets]`

Unchanged, still not started. All ten industry/factory cells are `compose` blocks stitching guessed pixel boxes. `oil_rig`/`ore_mine` look acceptable by luck; `farm`, `forest`, `gold_mine`, `factory` stitch fragments.

- Replace every `compose` block with **one declared building sprite per industry** (option b).
- No `box`/`crop`/`tiles`/`compose` arrays left in the cells file.
- `factory` uses one declared factory sprite with the player tint.
- `oil_rig`: still 768×160 (the whole 6-frame strip). Reference one frame, or declare `frames` with per-frame width.

**Acceptance:** every building is one contiguous structure; no `compose` remains; width ≤ footprint_w × 64 + 32; contact sheet confirms.

## Y7. Buildings don't fit their isometric footprint
`[bug] [assets] [renderer]`

This is the "buildings aren't fitting into the isometric squares" you're seeing now. I rendered the ore mine over its reserved 3×3 footprint (the yellow diamond grid) and the sprite is a flat rectangle that overhangs the top-left edge and leaves the bottom-right corners of the footprint bare — the sprite's diamond and the tile footprint's diamond are different shapes and don't line up.

Two things cause it, and both are fixed by the same move as terrain and roads:

1. **The sprite isn't the right shape.** These are `compose` blocks stitched from OpenGFX *ground* boxes, and OpenGFX industry tiles were never laid out as a clean 3×3 of diamonds — so the assembled rectangle can't fill an isometric footprint. Y3 (single declared building sprite per industry) is the actual fix; a real declared building is drawn to sit on its tile correctly.

2. **The anchor is hand-guessed on the wrong basis.** The atlas gives `ore_mine` a hand-authored anchor of `[96,176]` on a 192×192 canvas. The declared sprites carry their own placement offsets that are nothing like that — e.g. the coal-mine building sprite (id 2013) is 58×50 with `xrel −16, yrel −33`, and its ground tile (2022) is 64×31 with `xrel −31, yrel 0`. Drawing a declared sprite at `dest = tileOrigin + (xrel, yrel)` is what makes it sit flush; a hand-authored anchor guesses at that and lands the base in the wrong place, which is why the building floats off its squares.

**Fix:** do Y3 (declared sprite, not composed) **and** Y5's anchor change together for buildings — they're the same bug seen from two angles. A single declared building on its declared ground tile, drawn with declared `xrel`/`yrel`, sits inside its footprint by construction. Keep the footprint value itself as the gameplay concept (catchment, occupancy); it does not need to equal the sprite's pixel bounds.

**Acceptance:** rendered over its footprint diamond grid, each building's base sits within the footprint — no overhang past the top-left edge, no bare bottom-right corners. Verify with a debug overlay that draws the footprint outline under each placed building (the same yellow-grid check used to find this). Do the four map quadrants, since a projection/anchor error often only shows at offset.

## Y5 / Y6. Declared anchors + remaining invariants
`[bug] [renderer] [testing]`

After Y4c and Y3: switch placement from hand-authored `anchor` to declared `xrel`/`yrel` (honour `NOCROP`). Add invariants: every atlas sprite resolves to a declared id (no `compose`); width ≤ footprint_w × 64 + 32; no road/rail cell references the generator. Terrain invariant and 16-mask remap test are already in place.

---

## Sequencing

**Y4c → Y3 + Y7 + Y5 (buildings, together) → Y6 → U2.**

U1 is done — the original interface is back. Y4c (roads) next, still the standing road bug. Then Y3, Y7 and Y5 for buildings are one job, not three: replacing a `compose` block with a declared sprite (Y3), making that sprite sit in its footprint (Y7), and drawing it with declared `xrel`/`yrel` (Y5) are the same edit to the same cell. Do all six industries/factory in that one pass, add the Y6 invariants, then U2 (the setup highlight) any time.

---

## Process note

Same two failure modes, plus one new:

1. **"Set up but not applied."** Terrain got the parser, roads got the remap, both stopped short of using the result. The Y5/Y6 invariants make "did you finish" a CI failure, not a screenshot review.
2. **Scope timeouts.** Keep every ticket to one session; stop at each acceptance block.
3. **New — "rebuilt instead of restored."** J1 wrote a new UI when the ticket meant *mount the existing board in the existing interface*. When a task involves an existing surface, the default is to recover and reuse it (it's in git history), not to author a replacement. U1 exists because that default wasn't followed.