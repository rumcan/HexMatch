# N1 — Brown only at the map edge (skirt only on the coastline)

**Status:** FIXED — 2026-09-06, on `arena/01a07734-hexmatch` (this PR), using
**Approach A** (interior tiles draw no skirt; the coast draws the full block).
See [Resolution](#resolution-2026-09-06).
**Filed:** `docs/HexMatch-open-backlog.md`, P0, `[renderer]`. Folds in **N2**
(the "hovering building" and "elevated road" complaints) — same root cause.
**Area:** `src/iso/renderer.ts` (terrain chunks, structure blits),
`src/iso/depth.ts` (stage-2 pick), `tools/render-reference.mjs` (reference
renders), `tests/unit/iso-skirt.test.ts` (new, pixel-true).

---

## The rule (from the backlog, unchanged)

> A tile's brown skirt must be visible ONLY where no tile in front of it
> covers the skirt — i.e. where a SE or SW neighbour is water or off-map.
> Every interior tile must show no brown at all.

The backlog predicted the cause as "skirt (50px) taller than the tile gap
(32px) ⇒ every interior tile leaks 18px". **Measured reality on the current
(K-FIX-1) art is one step removed**, and the pixel tests in
`tests/unit/iso-skirt.test.ts` pin it both ways:

- On the **terrain layer** the 18px interior leak does not exist any more:
  in back-to-front painter order a Kenney block's skirt IS fully covered by
  the tiles in front (verified by drawing a 9×9 grass patch with the rule
  disabled — brown appears only at the patch rim).
- The leak the screenshots actually show is on the **structures layer**:
  road/rail/building sprites are blitted AFTER the whole terrain plane, so
  their full block side paints **on top of** the grass tile in front — that
  is the brown at the base of every road and building, and (with the old
  block-side road pieces) the "elevated road" kerb look.

The fix is the same rule either way, applied to both layers.

## What changed

| file | change |
|------|--------|
| `src/iso/renderer.ts` | `skirtCovered(grid, tx, ty, fw, fh)` — true iff every SE/SW neighbour of the footprint is land on the map (the definition of interior). `aboveGroundPoly(...)` — the clip region an interior sprite may paint: its ground diamond plus everything above it, nothing below the diamond's two lower edges. `chunkCanvas` clips interior terrain tiles to their diamond; `drawStructures`/`blit` clip interior structure sprites the same way (footprint-exact, zoom-scaled, composites and all). Edge sprites (water/void in front) draw the full block — that IS the coastline. |
| `src/iso/depth.ts` | `Placed.clipped` — the renderer flags interior sprites; `aboveGroundAt(def, lx, ly)` is the picker's twin of the clip polygon; `pickSprite` never hits an undrawn skirt, so hovering where a skirt would have been lands on the ground tile in front — agreeing with the eye (and with N4's one-convention rule). |
| `tools/render-reference.mjs` | every scene declares a grass/water grid and blits through the same `covered()`/clip-poly rule; new acceptance render `docs/kenney-n1-skirt.png` — interior road + buildings flush with no brown at their bases, coastline keeping its block side. All four K-renders regenerated (the K3 scene visibly loses the dark skirt band along its road). |
| `tests/unit/iso-skirt.test.ts` | new. A small software rasteriser draws REAL atlas pixels with the renderer's exact draw math and the real clip polygon (even-odd point-in-polygon), then asserts the backlog's acceptance verbatim: zero brown-range pixels below a fully-interior tile; the plane still tessellates (no holes); roads/buildings on the structures layer draw no skirt; coast tiles and coast roads keep their block side; plus the classification sweep over a generated island (seed 1337). |

## Acceptance

1. ✅ **No brown anywhere on the interior** — pixel-true: a 9×9 grass field
   (and the same field with an interior road or a farm on the structures
   layer) has **0** brown-range pixels in the window below the centre
   diamond. The coast keeps its brown: a one-tile island shows >200 brown
   pixels of block side, a coast road likewise.
2. ✅ **Brown appears only at the outer edge** — `skirtCovered` is asserted
   over a whole generated map (seed 1337): the coast set is exactly
   "SE or SW neighbour is water/off-map", and the interior set is everything
   else (coast >20 tiles, interior >400 on that seed).
3. ✅ **Screenshot** — `docs/kenney-n1-skirt.png`: a road crossing the
   interior shows no brown at its edges; the island's coastline shows the
   brown block side. The old K3 reference render (in git history) shows the
   dark skirt band along the road that this removes.
4. ✅ **N2 (hovering building / elevated road)** — the same fix: with no
   interior skirt drawn there is no exposed skirt band under a building and
   no block side reading as a road kerb. The pick change (no undrawn skirt
   is hoverable) is asserted separately in the N4 ticket's suite.
5. ✅ **408 unit tests pass** (390 before: +18 across the three backlog
   tickets); `npm run typecheck` clean; `npm run lint` 0 errors, warnings
   unchanged from `main` (35, all pre-existing); derived art in sync;
   manifest valid; `vite build` succeeds.

## Verified the tests actually bite

- Stubbing `skirtCovered` to always-true (draw every skirt) fails **5** tests
  of `iso-skirt.test.ts` — the interior road/building no-brown assertions and
  both coast guards — and restoring the rule makes them green.
- The two "BITE" tests reproduce the pre-fix structures-layer leak with the
  rule disabled **inside the test** (no code stub needed) and assert the leak
  exists there (>100 brown pixels), so the suite cannot rot into passing
  vacuously.

## Not covered

No browser in the sandbox (`npx playwright install chromium` cannot reach the
CDN — same limitation recorded on E14/W8/W9/G9/K-FIX-1/K-FIX-2), so
`npm run test:e2e` was not run. The pixel suite composites the exact atlas
pixels with the exact draw/clip math, so it shows what the canvas paints, but
a real-browser hover-and-place pass is still worth doing before closing this
on a play-test report.
