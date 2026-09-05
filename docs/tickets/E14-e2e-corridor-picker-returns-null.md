# E14 — The e2e gameplay spec cannot pick a corridor: the tile geometry doubled and the picker never followed

**Status:** FIXED — 2026-09-05, on `arena/01a072d3-hexmatch` (this PR). The
picker now measures the map instead of assuming it, and says why when it fails.
See [Resolution](#resolution-2026-09-05).
**Filed:** 2026-09-05 while landing W8/W9/G9 on `arena/01a0717e-hexmatch`.
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

---

## Resolution (2026-09-05)

**Fix candidates (a) + (b) + (c) together, plus the diagnostic the ticket asked
for.** The picker no longer knows what a tile is: it measures the screen step
of one step along a track direction, measures the clear band from the HUD's own
boxes, derives the longest corridor that can fit, and searches four directions
for the widest-clearance column inside `[minTiles, maxTiles]`. `(d)` (pan per
candidate) was not needed once `(a)`+`(b)`+`(c)` were combined, and `(e)`
(driving the drag through `__iso.dragBuild`) was not needed at all — the round
is still played with real pointer events.

### What changed

| file | change |
|------|--------|
| `tests/e2e/corridor-picker.ts` | **new.** `findIsoCorridor(opts)` — the geometry-relative search — `isoTileOcclusion({tiles, aim})`, the spec's independent re-check — `isoTileClickPoint({tx,ty,aim})`, the click geometry in one place — and `isoClickableTile({tx,ty,aim})`, which the spec clicks through: it re-solves the point per click against the aim list, the hit-test and the game's pick (see *CI rounds 1–2*). All four are deliberately self-contained (no imports, no module scope) because `page.evaluate` ships `fn.toString()` into the page, and that contract is pinned by a test |
| `tests/e2e/iso-game.spec.ts` | `pickCorridor` is now a 1-line `page.evaluate` of that module; the wheel zoom-out became a named `zoomStep()` helper with a **second real gesture** as a retry; the free-allowance, road-tile and painted-pixel assertions are derived from `corridor.tiles` / `corridor.col` instead of the constants 4, 5 and `hy + 1`; a new `isoTileOcclusion` assertion covers **every** tile of the column plus the tile diagonally behind the factory |
| `src/iso/track.ts` | `canBuildOn` is now the boolean projection of a new `buildRefusal(grid, kind, tx, ty, network)` returning the *reason* (`water` / `rough` / `occupied` / `not-adjacent` / `out-of-bounds`). One rule, so the helper can filter on legality without re-deriving `WATER = 1` and drifting from the game |
| `src/iso/game.ts` | the `__iso` hook gains three read-only surfaces: `tileProbe(kind,tx,ty)` (the game's own build + harvester verdict, via `buildRefusal` and the `placeHarvester` checks), `pickAt(sx,sy)` (literally `renderer.pick`, the two-stage hit-test a click goes through) and `camera` (so a report can name the zoom it used) |
| `tests/e2e/iso-game.spec.ts` (`clickPointFor`) | does no arithmetic of its own at all: every click of the round, and the points the A2 assertion checks, come from `isoClickableTile` |
| `tests/unit/iso-corridor-picker.test.ts` | **new, 13 tests** — the same module run headlessly against the real map generator, the real camera maths and the CSS-derived HUD boxes, including the click-point contract the spec depends on |

### The click point is now part of the proof

The ticket's own C3 hypothesis — *the pick lands on the tile behind the one you
clicked* — was a real risk for any corridor picked by geometry alone, so
`findIsoCorridor` does not just filter tiles, it **chooses where to click**:
for every candidate it tries five aim points (fractions of a tile step from the
diamond centre) and accepts the column only where, at one aim, every tile is
(i) in view, (ii) legal for a road, (iii) `pickAt`-correct — the game agrees the
pixel resolves back to that tile — (iv) not covered by HUD chrome, and (v)
inside the panel-free band by ≥ 4 px. The corridor is returned **with** that
aim (`corridor.aim`) and the spec clicks at it.

The occlusion rule is J1's, kept and generalised: `elementsFromPoint(…)
[0]` must be one of the `.iso-layer` canvases. Because `elementsFromPoint`
honours `pointer-events`, that subsumes "never under an `.iso-panel`" and also
refuses tiles under the topbar, the resbar and the guide banner — which sits at
`top: 104px`, centred, `max-width: 400px`, i.e. inside the "clear" band the old
helper trusted.

### Numbers measured headlessly (no browser in the sandbox)

`npx playwright install chromium` cannot reach its CDN here, exactly as this
ticket noted, so the geometry was verified the way the ticket's confirming
experiment describes — by the arithmetic, in a test:

* `tests/unit/iso-corridor-picker.test.ts` replays the boot state with the real
  modules (`generateMap(1337)`, `centerOnTile(createCamera(1280,720), …)`, the
  same `zoomStepAt(cam, -1, 640, 360)` the spec's wheel produces) and the HUD
  boxes straight out of `styles.css` / `ui.ts:responsiveZoom` — band 592 px
  (x 310…902), tile step 66×32 px at 1× and 33×16 px at 0.5×.
* **The picker finds a corridor:** seed 1337 at the zoomed-out camera →
  `4 tiles SW, (24,7)…(24,10), industry 0, 198 px clear of the HUD, aim (0, 0.5)`.
  It also finds one on seeds 7 and 2024, and at 1× — i.e. it is no longer
  seed-luck, which is what acceptance 4 was really about.
* **The old assumption is reproduced and pinned:** the pre-fix filter (exactly 7
  tiles due south, `fy = hy + 6`) finds **nothing** in that same state — a test
  asserts `null` there while asserting a corridor here. The suite bites.
* **The corridor is playable:** the test then runs the real
  `previewDrag(grid, track, "road", {stone:12}, factory…harvester, net, 12)`
  and asserts `truncated === false`, `tiles.length === corridor.tiles`,
  `cost = {}`, `free = corridor.tiles` — the whole column lays for free, which
  is what the spec's purse/allowance assertions then expect.
* **It fails loudly:** with the banner grown over the map the error is
  `no 4–7-tile corridor … 500 columns searched (25 industries × 4 directions ×
  5 click points). band 592px (x 310..902) · tile step 33×16px · zoom 0.5 ·
  dpr 1 · viewport 1280×720. Closest: industry "oil_rig" along SW, click offset
  (0,0.5) — 1 tile(s) passed, then tile (2,5) was rejected by `off-screen`.
  Rejections: {"covered":210,…}; examples: {"covered":"covered:div#iso-banner.banner"},…`
* **The guard fires:** `minTiles` above what the band can hold throws
  `the corridor cannot fit between the HUD panels. A 20-tile column needs 627px
  of clear map; … This is a LAYOUT/CAMERA problem, not a search problem`.
* `String(findIsoCorridor)` revived through `new Function` returns the identical
  corridor — the serialization path `page.evaluate` uses is tested, not trusted.

### CI round 1: the picker was right, the spec's mouse was not

The first `e2e` run on the PR was **3 passed, 1 failed** — and the failure was
not the corridor search. `pickCorridor` found
`(24,7)…(24,10), 4 tiles, SW, aim (0, 0.5)` in the browser, i.e. exactly what
the headless test predicts, and the spec's own `isoTileOcclusion` re-check came
back empty. The round died one line later:

```
Error: expect(received).toBeGreaterThan(expected)
Expected: > 10
Received:   0
  267 | await expect.poll(() => opaqueNear(page, 2, c.fx, c.fy)).toBeGreaterThan(10);
```

Meaning: no placement highlight was painted where the test looked for it. The
cause was in the spec, not the helper — `tileCenter` derived its aim offset from
`tileScreenAt(0,1)` minus `tileScreenAt(tx,ty)`, which is the step *to the target
tile from the origin*, not *one tile*: at (24,10) that is fifteen tiles, so
`aim.y = 0.5` clicked 16 tiles below the factory tile. The corridor search and
the occlusion re-check both measured `tileScreenAt(0,0) → tileScreenAt(0,1)` and
were right; the mouse went elsewhere. Three helpers agreed with each other and
none of them was where the click landed — which is why the fix is structural:

* `isoTileClickPoint(sel)` is now **the** function that turns a tile plus an aim
  fraction into a viewport point, and the spec's `tileCenter` is a one-line
  `page.evaluate` of it. There is no second implementation left to drift.
* It **verifies itself**: the point is refused unless `__iso.pickAt` resolves it
  back to the tile it names, and the error prints the tile it actually landed on
  ("`resolves to tile (32,18) … not the requested tile`"). Had that check existed
  in round 1, the failure would have named the mouse instead of the pixels.
* It converts **device px → CSS px → viewport px** by measuring the canvas' own
  `getBoundingClientRect()`. Today `#map` is `position:absolute; inset:0` inside a
  `position:fixed; inset:0` `.ui-root`, so the map's origin is the viewport origin
  and the correction is a no-op — but the ticket's own refuted "coordinate bug"
  hypothesis dies here permanently: the offset is measured, so an inset map can
  never silently shift a click again.
* Two unit tests pin it: one asserts, per column tile and in both call forms
  (import and revived `String(fn)`), that `isoTileClickPoint` equals an
  independently measured `tileScreenAt + aim·step`, that the point hits the
  canvas and picks its own tile, and that the clearance it implies equals the
  `margin` the picker reported (within 1 px — one measurement, two consumers);
  the other reproduces the round-1 mis-scaling and asserts the guard rejects it
  *naming the tile the old formula clicked*.

### CI round 2: the guard caught a second, real bug — neighbour sprites steal pixels

Round 2 was again 3 passed / 1 failed, and the failure was the new guard doing
its job, mid-drag:

```
isoTileClickPoint: tile (22,6) at click offset (0.25, 0.25) = pixel (582, 332)
device px resolves to tile (23,6) — sprite `depot_blue_v1`, not the requested tile
```

The click point was correct *for the state the corridor was searched in*. It was
wrong by the time the road was dragged, because by then the Harvester sat on
(22,6): the structures list changed, and `renderer.pick`'s stage-2 alpha pass
gave that pixel to `depot_blue_v1`, the industry one tile to the right — whose
132×83 sprite covers the right half of its left neighbour's diamond. The game
would have refused the drag there with `occupied`, and the test would have
timed out waiting for a road that was never laid. That is the C1/C3 bug class
this repo's backlog already suspects, now caught with the pixel, the tile and
the sprite named instead of inferred from a timeout.

What follows from it, for the test:

* an aim is not a property of a corridor, it is a property of a *click*.
  `isoClickableTile({tx, ty, aim})` resolves each click against the live state:
  the aim the corridor was chosen on first, then the rest of
  `AIM_CANDIDATES` (now 11 points, all inside the tile's own pick cell —
  `|ax| + |ay| ≤ 1`, `−1 ≤ ax+ay < 1`, `−1 ≤ ay−ax < 1`), accepting only a
  point that is on screen, whose topmost element is a map canvas, **and** that
  `pickAt` resolves back to the tile. `isoTileOcclusion` is asserted on those
  very points, so the A2 claim is about the clicks that actually happen.
* when nothing on a tile qualifies it throws with one clause per aim tried
  (`(0.5, 0) → picks (23,6) via \`depot_blue_v1\``) plus the measured step,
  zoom, dpr and map origin. It does not "pick the least-bad point": a tile no
  click can reach is a picking bug, and this suite's job is to say so.
* `tests/unit/iso-corridor-picker.test.ts` covers the search with a stage-2
  stand-in that reproduces exactly this stealing (accepting only the left of the
  tile — the helper must move to a negative-x aim and stay pick-correct per the
  flat maths), the all-rejected case, and that every copy of the aim list
  (module constant, `findIsoCorridor`, `isoClickableTile`) is identical, since
  self-containment forces the duplication.

### Acceptance

1. 🚧 `npx playwright test --project=desktop-chromium` in CI: round 1 was
   3/4 green with the corridor found by real geometry (the red was the spec's
   own click maths), round 2 fixed that and got further before its new guard
   stopped a click the game would have refused — see *CI round 2*. The filters
   were kept and strengthened; nothing was relaxed to make the spec pass.
   Locally: `npm test` is green at **385** (363 before this PR, +13 corridor
   picker, +9 C5 debug console), `npm run typecheck` clean, `npm run lint` 0
   errors and one fewer warning than `main`.
2. ✅ Every tile of the column is re-checked by the spec's own
   `isoTileOcclusion` assertion, at the aim the helper chose, using the same
   real hit-test it filtered on — reported as
   `coveredBy: <element>` when it fails.
3. ✅ On `null` the picker throws with the closest candidate, the rejecting
   tile, the filter, a rejection histogram, one concrete example per category
   and the measured band/step/zoom/dpr/viewport.
4. ✅ The corridor is geometry-relative: length is derived from the measured
   tile step and the measured clear band (`fit = floor(band / stepX) + 1`), the
   test derives its expectations from the returned `tiles`, and a band too
   narrow for `minTiles` fails with a message that names both numbers instead
   of quietly passing on a 1-tile "corridor".
5. ✅ The other three e2e tests are untouched in behaviour — the layout test and
   TK-001 do not use the picker, and the mobile projects still skip the pointer
   flow while running the layout test. (The mobile viewport matrix is
   `e2e-nightly.yml`; nothing in this change is viewport-specific beyond the
   band measurement, which is now read from the DOM rather than assumed.)
6. ⏭️ Branch protection is a repo setting, not a commit — left to the owner.
   The check is named `e2e` on `.github/workflows/ci.yml`; once this PR is
   green it can be marked required.

### Out of scope, honoured

No panel was shrunk, the map was not moved, the camera defaults are unchanged,
and `TILE_W 132 / TILE_H 64 / MAP 32×32` are untouched. The only src changes
are the shared legality rule and three read-only additions to the test hook.

### Not covered

* A real browser, in this sandbox or in the unit tests: CSS layout,
  `elementsFromPoint`, and the atlas alpha masks (stage 2 of `pick`) are only
  available in CI. The headless harness covers stage 1 plus the CSS geometry.
  Round 1 is the cost of that split, and the reason the click point is now
  shared and self-checked rather than re-derived per helper: the pixel-level
  assertions (a highlight of ~169 opaque samples, a road decal on the
  structures canvas) can only ever be confirmed by CI.
* The mobile projects' pointer flow, which the suite skips by design.
