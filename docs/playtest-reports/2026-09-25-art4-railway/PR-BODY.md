Closes #402

> **Delivery note — the branch was taken.** While I was working, ticket **#401**
> (the parallel rail-turn agent) pushed to and opened **PR #403** from
> `arena/01a0d9c6-hexmatch` — the same branch this session is pinned to. My five
> commits are therefore **local only**: I did not push (the push was rejected as
> non-fast-forward) and I did not force-push over their commits, per the
> session's rules. Everything below is verified and ready; the lead needs to
> land it on a branch of its own (a patch export and these commits are in the
> workspace). The files I touch do not overlap #403's (`src/iso/rail-renderer.ts`,
> `src/iso/rail-geometry.ts`, one new test file, one docs folder — versus
> `rail.ts`/`ai.ts` there), so the two merge cleanly in either order.

## What changed

**`src/iso/rail-geometry.ts` (the cross-section — the ticket's headline).**

| | before | after |
| --- | --- | --- |
| ballast bed | 0.465 tile | **0.42** (the spec's 40–45% band; a paved road is 0.78, so the bed is 54% of it and 61% with the margin) |
| bed margin | 0.045, **dark** rim | 0.028, **light** gravel edge fading into the grass |
| rail head | 0.0525 | **0.036** |
| rail web | 0.0825 | 0.052 |
| sleeper | 0.36 × 0.0675 | **0.28 × 0.05**, pitch unchanged at 0.25 (the absolute lattice) |
| buffer beam | 0.405 × 0.075 | 0.36 × 0.06 |

`RAIL_GAUGE` (0.24) and `TIE_SPACING` (0.25) are deliberately **unchanged**: the
first is the contract with the train and platform/depot lane art (changing it
puts the wheels off the steel), the second is what makes a sleeper land exactly
on every tile join.

**`src/iso/rail-renderer.ts` (renderer restriction lifted for this file).**

* The bed is now painted the way `road-renderer.ts` paints asphalt: a
  `CanvasPattern` used as the stroke style, in **absolute ground coordinates**
  (`repeat / image.width` scaled uniformly), so two chunks sample the same
  material field and the bed does not slide when the camera pans or a chunk
  boundary falls on it. A light margin pass goes under it.
* The gravel swatch is **code-generated** (no gravel art exists): 128 px
  seamless wrapping value-noise + wrapped pebbles with a lit upper-left cap, so
  the gravel and the rails agree about where the light is. Deterministic
  (mulberry32, fixed seed), built once per process, cached — including the
  failure case, so a canvas-less test never retries or logs per chunk.
* Rails are slim steel over a dark web, with the head **offset towards the
  light** (a constant ground vector), which leaves the web showing along the
  rail's lower-right side — the "thin upper-left highlight" — plus one
  low-alpha spark pass on the lit side at the closest zoom only.
* **Zoom tiers**, on top of the existing quality-preset tiers (the weaker of the
  two wins): closest = gravel + sleepers + rail pair + lit edge + crossing
  boards; middle = the same without the lit edge and the individual boards
  (one slab); far = **one thin two-tone line** down the tile centre-lines, no
  bed and no sleepers. The zoom is read off the raster's own transform
  (`contextZoom`), so `RoadCache` and every call site are untouched.
* The cache is intact: same `RoadCache` chunk rasters, same revision gate, and
  every new pass is batched — a whole chunk is still a fixed handful of canvas
  calls, whatever the tile count.

**Named file/size for the painted ballast** (`RAIL_BALLAST_TEXTURE`, and the
report folder's README): `assets/railway/ballast.webp`, **seamless 256×256**,
one repeat spanning `GRAVEL_REPEAT` = 1.2 tile units. `RailStyle.ballast` is
already sampled in preference to the generated swatch; the two pieces of
plumbing it still needs are outside this ticket's files (see follow-ups).

**Tests/docs:** new `tests/unit/iso-402-rail-art.test.ts` (14 tests) pins the
cross-section band, the sleepers/margin/deck nesting, the gravel's
determinism/colour/seamlessness/pebble wrap, the pattern wiring, the tiers (zoom
× quality), the lit edge's direction and constant offset, and the batching. New
`docs/playtest-reports/2026-09-25-art4-railway/` holds **before/after sheets for
all seven cases at all three zooms**, rendered through the shipping painters
(`ART4_PREVIEW=1`, off by default, like the E2 preview in `iso-elevation.test.ts`).

## Acceptance boxes — how each was checked

- [x] **Rail reads clearly narrower than a paved road, with a gravel bed, at all
  three zooms.** Geometry asserted in the new suite (`RAIL_BED_WIDTH` ∈
  [0.40, 0.45]; bed + margin < `ROAD_WIDTH.paved`, ratio < 0.7); visually
  `straight-vs-road` sheet, three zooms, rail beside a paved road.
- [x] **Straights, diagonals, curves, junctions, bridges, slopes and platforms
  all render correctly (before/after screenshots of each).** Seven cases × three
  zooms × before/after in the report folder; the same fixtures are asserted in
  `iso-rail-geometry` (port contract on all 16 masks, diagonals, bends,
  T/crossroads, buffer stops, lanes) and `iso-bridges`/`iso-elevation`, all
  green. **Caveat:** these are headless renders through the real painters, not
  browser screenshots — this sandbox has no browser.
- [x] **Trains sit on the rails.** The train's geometry is untouched: rails are
  still the centre-line ±`RAIL_GAUGE`/2, the centre-lines are still the paths
  `rail.ts`'s `pointAt` drives, and the port contract test (which pins that two
  neighbours compute the same two steel points) still passes. **Not** verified
  visually — see "could not verify".
- [x] **`iso-rail-geometry`, `iso-rail-cache` and `iso-renderer-cache` tests pass;
  no frame-time regression.** All three green (plus `iso-bridges`,
  `iso-elevation` and the new file — 6 files, 91 passed / 5 pre-existing skips).
  No frame-time regression is *designed* in and asserted structurally (op-count
  parity for 1 vs 40 tiles; no new cache dimension; gravel raster built once,
  ~22 ms, then cached) — but no browser frame timing was measured.

## Exact test files run (all in the background, per the playbook)

```
npx vitest run tests/unit/iso-402-rail-art.test.ts tests/unit/iso-rail-geometry.test.ts \
  tests/unit/iso-rail-cache.test.ts tests/unit/iso-renderer-cache.test.ts \
  tests/unit/iso-bridges.test.ts tests/unit/iso-elevation.test.ts --reporter=dot
→ Test Files 6 passed (6) · Tests 91 passed | 5 skipped (96) · 95.9s · EXIT 0

npx tsc --noEmit -p .
→ EXIT 0

npx eslint src/iso/rail-renderer.ts src/iso/rail-geometry.ts tests/unit/iso-402-rail-art.test.ts
→ clean
```

The 5 skips are the pre-existing `it.skip`s in `iso-rail-geometry` (the
lattice/crossing names) — nothing was skipped or loosened by this PR. I did not
run `npm test`, `test:slow`, `test:e2e*`, Playwright, `iso-game`, `iso-ai-sweep`
or `iso-rebalance`, and I did not run any file outside this ticket's list.

## What I could NOT verify (please play-test)

- **No browser in this sandbox**, so no real `npm run dev` screenshot and no
  frame timing. The sheets are the shipping painters driven by a recording 2D
  context (real geometry, real widths, real gravel bytes, real drape); what they
  do not exercise is the browser's own path — `createPattern`+`setTransform` on
  a real canvas, the ground texture under the bed, the `blur(1px)` soften pass
  that only runs at the closest zoom (it will soften the 1.3 px steel; worth a
  look) and anti-aliasing.
- **Train cars.** They are unchanged geometry, so they should still ride the
  rails — but the car *art* is a 0.44-wide lane (`tools/railway/cut_train.py`)
  against a bed that is now 0.42, so the wheels/skirt will just touch the bed's
  edge instead of sitting well inside it. Re-cutting them is the lead's call; if
  you do, the lane the art must match is `RAIL_GAUGE`/`RAIL_WIDTH`, not the bed.
- **Level crossings with the new LOD**, a junction/curve *on a bridge*, the
  minimap's rail layer, and a real map (elevation + rivers + buildings + roads
  around the track).
- **The platform and depot art** are still drawn at the old, bigger scale — see
  the follow-up below. They are the most likely thing to look off next to the
  new track.

## Follow-ups noticed, not done (outside this ticket's files)

1. **Wire the painted ballast** (2 mechanical changes): a `setRailBallast(image)`
   on `RoadCache` + `IsoRenderer` (the mirror of `setRoadStyle`) and the boot load
   of `assets/railway/ballast.webp` in `game.ts` beside the `assets/roads/*`
   load. `tools/make-road-textures.mjs` already verifies seams and can ship it.
2. **Re-cut the railway structures' internal lanes** —
   `tools/make-railway-art.mjs` draws the platform's rails at ±0.16 and the
   depot's at ±0.15 with 0.48 × 0.09 sleepers and a brown apron, all at the old
   scale; they now read bigger than the track they join. Art tools are the
   lead's; the manifest and `loadRailwaySprites` need no change, just a re-run.
3. `tools/make-railway-art.mjs`'s header still documents the old 25%-smaller
   figures as the cross-section contract; it drifted from `rail-geometry.ts`
   when the ticket's scale landed.
4. If the zoom steps in `ZOOM_STEPS` ever change (ART-3 / #399 is heading
   toward per-zoom art), revisit `RAIL_CLOSE_ZOOM`/`RAIL_MID_ZOOM` — only the
   2× step currently draws the lit edge.
