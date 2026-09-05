# E14 — The e2e gameplay spec cannot pick a corridor: the tile geometry doubled and the picker never followed

**Status:** OPEN — filed 2026-09-05 while landing W8/W9/G9 on
`arena/01a0717e-hexmatch`.
**Severity:** HIGH for the project, none proven for the game. The only
real-browser gate this repo has has been red since the Kenney art cutover, so it
gates nothing — which is how a red unit suite (G9) and the W-series logic bugs
shipped unnoticed.
**Area:** `tests/e2e/iso-game.spec.ts` (`pickCorridor`), `src/game/config.ts`
(tile geometry), `src/game/styles.css` (the `.iso-panel` asides).
**Known since:** 2026-09-04, commit `30a0290` — diagnosed there, worked around
for one test only, never ticketed.

---

## What fails

```
✘ 3 [desktop-chromium] › tests/e2e/iso-game.spec.ts:212:3 › iso game boots on
    the default route › gameplay: factory → harvester → road drag → +1 VP,
    all real pointer events
    Error: expect(received).not.toBeNull()
    > 85 |     expect(c).not.toBeNull();
      at tests/e2e/iso-game.spec.ts:85:19
  1 failed | 3 passed (21.6s)
```

Line 85 is the tail of `pickCorridor`: **no industry on seed 1337 has a south
corridor that satisfies all of its filters.** The test dies before the first
pointer event, so the whole "factory → harvester → road drag → +1 VP" round —
the only end-to-end proof that a real player can play a turn — is unasserted in
a browser.

## Provenance (git archaeology, not speculation)

| evidence | finding |
|---|---|
| nightly `e2e-nightly.yml` run 2026-09-04T08:50Z @ `1170d64` | **success** — last green run |
| nightly run 2026-09-05T08:21Z @ `3c0c64b` | **failure** |
| `git show 1170d64:src/game/config.ts` | `TILE_W = 64, TILE_H = 32` (HW 32, HH 16), `MAP 48×48` |
| `src/game/config.ts` today | `TILE_W = 132, TILE_H = 64` (HW 66, HH 32), `MAP 32×32` |
| the commit between them | `e4bd232` "K0-K4: Kenney isometric art cutover — **geometry**, atlas packer, terrain/roads/industries, renderer" |
| `30a0290` (PR #18, 2026-09-04 12:52) commit message | *"pickCorridor needs a full 7-tile road corridor inside the boot camera's view; at seed 1337 that camera (zoom 1, centred on industry[0]) frames no such corridor at 1280x720, so the gameplay e2e fails on that shared helper before any pointer event fires."* |
| CI e2e job on PR #19 (`dddf568`), PR #20 (`3c0c64b`), `main` (`af1ec66`), this branch | same spec, same line 85, same `1 failed | 3 passed` |

**The cutover doubled every tile on screen and the e2e picker was not
revisited.** PR #18 already knew the helper was broken and made the *TK-001*
test independent of it (that is why TK-001 passes and this one does not); the
gameplay test at line 212 still calls `pickCorridor` and has been red ever
since, across at least two merges.

Not a W8/W9/G9 regression: those commits touch AI planning, the free-allowance
rule and two derived PNGs. `pickCorridor` reads only `grid.terrain`,
`grid.occupancy`, `tileScreenAt` and the DOM panel hit-test.

## Root cause: the corridor no longer fits between the panels

Numbers for `desktop-chromium` (`devices["Desktop Chrome"]` = 1280×720, dpr 1):

**The canvas is at the viewport origin.** `.ui-root { position: fixed; inset: 0 }`
and `.map-canvas { position: absolute; inset: 0; z-index: 0 }`, so
`tileScreenAt(...)/dpr` *is* a valid viewport coordinate for
`elementsFromPoint` and `page.mouse`. (See "refuted hypothesis" below.)

**The two `.iso-panel` asides are `position: fixed`, `z-index: 30`,
`top: 68px; bottom: 52px`, so they overlay the map and swallow pointer events:**

- `.aside.left { left: 10px; width: 300px }` → blocks `x ∈ [10, 310)`
- `.aside.right { right: 10px; width: calc(var(--board-px) + 30px) }`, and
  `ui.ts:780` publishes `--board-px = ceil((CELL·BOARD_W + 10) · z)` =
  `ceil((54·9 + 10) · 0.68)` = **338** at `innerHeight ≤ 720` (`responsiveZoom`)
  → width 368 → blocks `x ∈ [902, 1270)`

So the clear band is **x ∈ [310, 902) = 592 px**, y ∈ [68, 668].

**What `pickCorridor` demands** (`hx = ind.tx`, `hy = ind.ty + ind.h`,
`fy = hy + 6`; every one of the 7 column tiles must be land, unoccupied,
`inView` *and* `clickable`, plus `inView(hx+1, fy+1)`):

- stepping +1 ty moves the screen by `(−HW, +HH)` = **(−66, +32)**, so the
  column's footprint is **396 px wide × 192 px tall**, and the factory-diagonal
  check adds another 64 px of height → **396 × 256 CSS px**.
- all 7 centres inside the clear band ⇒ the start tile must land in
  **x ∈ [706, 902)** (196 px) and **y ∈ [68, 476]** (408 px) — about **6 % of
  the viewport**.
- the boot camera centres `grid.industries[0]` at (640, 360) at zoom 1
  (`centerOnTile(createCamera(1280, 720), …)`), and every tile centre is on a
  66 px x-lattice, so that 196 px window holds only **3 lattice positions**
  (`S0x = 640 + 66n`, n ∈ {1, 2, 3}). With `hx` pinned to `ind.tx`, only
  industries offset by those exact diagonal steps from `industries[0]` can ever
  qualify — and then their whole 7-tile south column must be buildable land.

**Before the cutover** (HW 32, HH 16) the same 7-tile column was **192 × 96 px**
and the start window was **x ∈ [502, 902) = 400 px ≈ 12 lattice positions**.
Doubling the tile halved the number of viable corridors and quadrupled the area
they must occupy — the helper went from "usually finds one" to "needs luck", and
on seed 1337 the luck runs out.

**Not yet measured:** all of the above is arithmetic from committed CSS/config
plus the CI history, not an observed browser run — there is no browser in this
sandbox (`npx playwright install chromium` cannot reach the CDN). The confirming
experiment is in the next section and takes five minutes.

## Refuted hypothesis — do not chase this

It looks like a coordinate bug: `elementsFromPoint(cx, cy)` is fed
canvas-relative pixels while `inView` compares against `window.innerWidth/Height`.
It is not one:

1. the canvas *is* at the viewport origin (CSS above), and
2. the **passing** TK-001 test uses the identical helpers for real
   `page.mouse` events and asserts that a middle-drag **pans the camera** and a
   left-click **places a factory** — both listeners are on `canvases.overlay`
   (`game.ts:619/645/716`), so those coordinates provably land on the canvas.

The single-tile helper finds clickable tiles; only the 7-tile column fails.
Keep the J1 "never under a panel" rule — it is correct and load-bearing.

## How to confirm (needs a browser)

1. In `pickCorridor`, before returning `null`, log: the number of industries
   tried, and for the best candidate which filter rejected which tile
   (`terrain` / `occupancy` / `inView` / `clickable`), plus
   `document.querySelector(".aside.left").getBoundingClientRect()` and the
   right aside's, and `--board-px`.
2. Expect: rejections dominated by `clickable` on the last (westernmost) column
   tiles — i.e. the column drifting under `.aside.left` — and `inView` rejections
   only near the map edges.
3. Sanity-check the arithmetic: set the camera zoom to 0.5 (real wheel event)
   and re-run the picker; if it starts finding corridors, the footprint/panel
   analysis is right.

## Fix candidates (keep the spec's no-mocking rule)

- **(a) Preferred — zoom out with a real gesture, then pick.** `ZOOM_STEPS` are
  `0.5 / 1 / 2` and `canvases.overlay` already has a `wheel` listener, so
  `page.mouse.wheel(0, -1)` over the map is a genuine user action. At zoom 0.5
  the column footprint halves to 198 × 128 px and the viable start window widens
  ~4× — close to the pre-cutover ratio. Verify the highlight/overlay still
  renders at the 0.5 atlas (it swaps atlases on zoom) before asserting on it.
- **(b) Shorten the corridor** to 4 tiles (`fy = hy + 3`): footprint 198 × 96,
  window ~394 px ≈ 6 lattice positions. Load-bearing updates: the drag loop at
  spec ~261 and `await page.waitForFunction(() => __iso.freeTrack === 5)` at
  spec:268 — the free setup allowance is 12, so a 7-tile road drag leaves 5 and
  a 4-tile one leaves **8**. The test still proves the allowance covers a whole
  multi-tile drag.
- **(c) Search more shapes:** all six iso directions, not only due south, and
  both columns of a multi-tile industry footprint. East/north corridors drift
  right/up instead of left, so they are not all fighting the left panel. Cheap
  and complementary to (a)/(b).
- **(d) Pan per candidate** with a real middle-drag (TK-001 proves it pans) to
  bring the corridor into the clear band before hit-testing it. Most robust,
  but needs a settle-wait and re-computes `tileScreenAt` after each pan.
- **(e) Last resort:** drive the long drag through `__iso.dragBuild` — the twin
  the unit tests use — and keep real pixel clicks for a short visible segment.
  This gives up the occlusion coverage that only this spec provides, so prefer
  (a)+(b) or (a)+(c).

## Acceptance

1. `npx playwright test --project=desktop-chromium` passes 4/4 locally and in
   CI, with `pickCorridor` finding a corridor by real geometry — not by deleting
   the `clickable`/`inView` filters until something slips through.
2. The picked corridor is genuinely reachable: the spec's own
   `elementsFromPoint` assertion holds for **every** tile of the column, which
   is the entire point of the helper (J1).
3. The picker fails loudly and informatively: on `null`, report the closest
   candidate and the filter that rejected it, so the next red run names the
   cause instead of `expect(received).not.toBeNull()`. A previous agent spent a
   whole commit re-deriving this.
4. The picker is **geometry-relative**, not hard-coded to a tile count that only
   fitted at `TILE_W = 64`: express the corridor length in screen pixels (or
   derive it from `HW`/`HH` and the clear band) so the next art/geometry change
   cannot silently break it again. Add a guard that fails with a clear message
   if the clear band is narrower than the corridor footprint.
5. The other three e2e tests keep passing, and the mobile projects (`iphone`,
   `android-small`, `android-landscape` — run by `e2e-nightly.yml` via
   `npm run test:e2e`, not by CI's `--project=desktop-chromium`) are checked
   too; they skip the pointer flow, but the layout test runs on them.
6. Once green, make the e2e job **required** again. It has been red across at
   least PR #18, PR #19, PR #20 and `main` without blocking a single merge.

## Out of scope

- Do not shrink the panels, move the map, or change the camera defaults to make
  the spec pass. The layout is asserted by three other passing tests, and the
  panel widths are deliberate (V3: the quarry column sizes to the board).
- Do not revert or re-tune the Kenney tile geometry (`TILE_W 132 / TILE_H 64`,
  `MAP 32×32`) — that is the shipped art direction; the spec is what is stale.
- Not a W8/W9/G9 regression: see the provenance table.
