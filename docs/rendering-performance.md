# Rendering optimization

## PERF-01 — the toggleable Performance mode (issue #183)

A user reported severe lag at fullscreen 1920×1080 on Low. Source inspection
of `a4511d8` found the gap is the rendering POLICY, not the art detail:
Low already loads half-detail art and renders 5% scenery density, but the
terrain layer still repaints ~30×/second (animated ocean + breathing surf),
the backing canvas still pays 2× device pixels, and the miniature pass is
unaffected. Fixing any one of those alone leaves the others.

Performance mode is therefore a **separate, persisted, toggleable axis**
beside Texture detail in Settings (help text: “Simpler ground and water,
fewer effects, smoother play.”; default OFF; `?performance=1|0` boot flag).
Selecting Low alone never forces it, and it applies at every quality.

One shared policy — `renderPolicy()` in `src/iso/graphics.ts` — derives
everything from (quality, performance) so the three consumers cannot drift:

| axis | performance OFF | performance ON |
|---|---|---|
| terrain art | seamless textures (per quality tier) | flat muted green land, flat sand coast, blue water |
| water/shore | drifting ocean, breathing surf (~30 Hz) | one static coast from the same contours |
| build grid | — | subtle isometric grid, cached in the terrain chunks |
| terrain decals | painted | omitted |
| backing DPR | min(2, devicePixelRatio) | **1** (unified boot + runtime) |
| miniature pass | the stored choice | suppressed; the stored choice is preserved and restored |
| texture quality | whatever is selected | unchanged (buildings/roads keep their tier) |

### What changes where

- `src/iso/renderer.ts` — `setPerformanceMode()`. ON: the terrain layer
  draws the flat scene (flat water fill → cached flat chunks → one static
  shore stroke) and the ambient `TERRAIN_FRAME_MS` timer **disarms**: an
  idle map repaints the terrain canvas only when a camera/zoom/resize, map
  edit, asset readiness or quality change dirties it. The flat chunks ride
  the existing chunk cache (the mode switch clears it, so a key can never
  serve the wrong paint; culling is the visible chunk range as before).
  `__iso.rendering().terrain` exposes `{ performance, animated, redraws }`
  — the idle counter the A/B validation reads.
- `src/iso/game.ts` — one effective dpr (`min(policy.dprCap,
  devicePixelRatio)`) for boot zoom, pointer→backing conversion, tap slop,
  anchored labels and the canvas resize; the settings subscriber resizes
  the three layers, the camera (centre world point preserved) and the
  miniature plate on every policy change. The former `applyQuality` is now
  `applyRenderPolicy(policy)`: the serialised apply chain also skips the
  ground/decal texture LOADS while the flat policy stands (and releases
  them with `setGround(null)`), and every async step re-reads the settings
  after its awaits so a stale load cannot restore old terrain.
- `src/iso/miniature.ts` — a suppressed pass releases its scratch buffers
  (an idle performance mode holds no post buffers at all).
- `src/iso/settings-sheet.ts` — the Performance mode switch beside
  Miniature; while it stands the Miniature switch is disabled with
  “Unavailable while Performance mode is on.” and its stored preference
  survives.
- `src/iso/ground.ts` — `paintFlatGroundTiles`: solid sand/grass fills on
  the same `groundContours` as the textured ground, plus one grid stroke
  clipped to the land. Deterministic in (grid, range) — no time.

### Validation

- Unit: `tests/unit/iso-performance.test.ts` pins the cadence contract
  (idle frames never redraw in performance mode; camera/world/mode changes
  repaint exactly once; stepping back re-arms the 30 Hz cadence; the mode
  switch releases the chunk cache) and the flat paint (two solid fills,
  one grid stroke, balanced state). `tests/unit/iso-graphics.test.ts` pins
  the store migration (a pre-performance blob means OFF) and the policy
  matrix. E2E: `tests/e2e/perf-mode.spec.ts` boots the flat scene in a
  real browser and asserts the DPR-capped backing, the static idle redraw
  count, the colour-count of the terrain canvas (flat scene: a handful of
  colours; textured meadow: thousands), the settings-sheet behaviour
  (suppressed-but-preserved miniature, camera centre point preserved
  across a toggle), persistence across a reload WITHOUT the URL flag, and
  convergence of a rapid ON→OFF→ON burst.
- The live 1920×1080 A/B (p50/p95 frame time, long frames, draw-pass
  counts, memory — baseline vs flat terrain vs static refresh vs DPR cap vs
  miniature off) needs the reference desktop: no browser was installable in
  the authoring sandbox (Chromium download blocked; the issue's own
  follow-up records the same limitation). `__iso.rendering()` + the
  `redraws` counter plus the browser's Performance panel are the
  measurement path; the idle-terrain acceptance (draw count unchanged
  across animation frames) is machine-checked by the unit + e2e suites.

## Changes

- Depth sorting sweeps world-space X bounds before testing exact sprite intersections. The original `isBehind` rules, Tier-1 tie order and cycle reporting remain unchanged.
- A minimum-index heap replaces sorting and shifting the entire ready queue on every topological-sort step. This preserves the original smallest-ready-index policy.
- Static placements are reused while traffic moves. Vehicles are freshly placed and appended in their original input order, then sorted together with buildings/scenery. Existing world, tile, camera, road-mode and full invalidation paths rebuild the cache; late artwork/pad updates also invalidate it. Call these invalidation APIs after mutating static world data, as before.
- Debug payloads (including per-sprite records and the full draw-order map) are only constructed when render logging is enabled. On-demand diagnostics remain available.
- A final structures redraw clears traffic when the last vehicle disappears.

No artwork, road geometry, simulation rules or sprite depth rules were changed. The sweep still has quadratic worst-case behavior when every box overlaps on X; it is not a guarantee of linear rendering time.

## Reproduce the sorter benchmark

```sh
HEX_DEPTH_BENCH=1 npx vitest run tests/unit/iso-depth-performance.test.ts
```

The test uses a deterministic synthetic 2,500-sprite scene drawn from the shipped manifest, including fractional placements, over a 144-tile coordinate range. It checks exact output against a frozen copy of the previous sorter before timing. Each sorter gets five warm-up runs and fifteen measured runs; the reported statistic is the median.

On this sandbox, an isolated run measured **112.99 ms original / 4.35 ms optimized**, approximately **26× faster for this sorting workload**. This is not an in-browser or whole-game FPS measurement, nor a reproduction of the previous agent's unavailable benchmark. Results depend on hardware, scene density and competing processes. No timing threshold is enforced in CI.

## Validation

- 40 seeded dense scenes match the reference sorter by object identity and cycle report.
- Additional cases cover empty/singleton input, ties, touching bounds, fully overlapping boxes and an explicit cycle with a downstream survivor.
- Renderer cache tests cover static-object reuse, moving/removing traffic, tile/world/camera/full/road-mode invalidation and late sprite-size changes. Logging-disabled trace calls are also checked.
- Type checks, production build and lint of changed files pass.
- Targeted existing depth/renderer/road/scenery/vehicle suites plus the cache suite: 174 passed, one failed. The failure at `tests/unit/iso-vehicles.test.ts:212` also reproduces with both production files restored to HEAD: the highway route ends three tiles from the factory origin rather than the test's expected one. It is not changed here.
- Repository-wide lint reports two existing unused-variable errors (`SW`, `SH`) in `tools/slice-atlas.mjs:435`.
- The full unit-suite attempt exceeded its 180-second command budget and was stopped; it is not claimed green. Browser visual/E2E checks were not run.
