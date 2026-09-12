# Rendering optimization

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
