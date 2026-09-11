# W-series — Terrain overhaul: pattern-painted ground + layer atlases

The island is no longer a per-tile sprite puzzle (the `terrain_grass` /
`terrain_water` / `terrain_rough` OpenGFX diamonds are gone from the draw
path). The ground is now **one continuously painted landscape**, and roads +
buildings ship as **separate layer-atlas PNGs** that are simply layered on
top.

## The layers, bottom to top

| layer | source | notes |
| --- | --- | --- |
| ocean | `assets/ground/water.png` | seamless texture; fills the whole stage, **animated** — world-anchored canvas pattern that drifts with time and pans with the camera |
| island | `assets/ground/grass.png` | seamless; land diamonds are polygon-filled with ONE world-anchored pattern — no per-tile seams; chunk-cached (8×8) per zoom |
| beach | `assets/ground/sand.png` | the coast ring (see below) paints full sand diamonds over the grass — a connected golden terrace lining the island, scalloped one tile inward |
| surf | procedural | water tiles that touch land get an animated shallow-water tint plus warm foam strokes along every shared edge — two out-of-phase sine waves per tile, so the surf shimmers instead of blinking |
| structures | `assets/layers/roads@*.png`, `assets/layers/buildings@*.png` | same sprite rects as the monolithic atlas (`assets/iso-atlas/manifest.json` stays the geometry source of truth); roads blit from the roads PNG, everything built from the buildings PNG |
| overlay | unchanged | previews, highlights, debug painter |

## Terrain data

`grid.ts` adds a fourth terrain value, `SAND` (3): **every land tile that
touches water** becomes beach after the rock blobs are placed — grass or
rock, the shore is beach. `SAND` is purely cosmetic: every gameplay check
treats it like grass (buildable, flat cost; `factoryReachBand` includes it).
The beach pass consumes no RNG, so maps stay byte-identical under a seed and
multiplayer determinism is untouched.

## Art pipeline

```bash
# 1. sources: tools/texture-src/{grass,sand,water}-src.png (generated art)
node tools/make-ground-textures.mjs     # → assets/ground/*.png (512², seamless)
# 2. layer atlases from the monolithic atlas
node tools/make-layer-atlases.mjs       # → assets/layers/{roads,buildings}@{0.5x,1x,2x}.png + manifest.json
```

`make-ground-textures.mjs` makes the generated textures tileable with an
offset-roll cross-fade (roll by half, smoothstep blend across a ¼-side fade):
the wrap seam shows contiguous source content, and the raw generator edges
fade against unrelated detail — no mirrored "kaleidoscope" echo.

## Renderer notes

- Patterns are **world-anchored**: the pattern transform compensates each
  chunk's origin mod the texture period, so all chunks sample one continuous
  meadow. Zoom swaps rebuild the patterns at the new scale.
- `LAND_SCALE = 2` (grass/sand) and `SEA_SCALE = 1.6` (water): one painted
  brush clump spans roughly a tile, matching the OpenGFX art's reading; they
  also shrink the apparent tiling frequency and stop zoom-step shimmer.
- The terrain layer redraws **every frame** (the ocean drifts, the surf
  breathes); the static island is chunk-cached exactly like the old sprite
  chunks, so the per-frame cost is one fullscreen pattern fill, a handful of
  chunk blits and the visible shore strokes.
- **Fallback-first loading**: the game boots on the monolithic atlas with a
  flat-colour ground (`FALLBACK` in `ground.ts`) and upgrades to textures +
  layer atlases when they arrive; `setGround(null)` / a failed load degrades
  silently. Test stubs without `createPattern` never warn.

## Testing without a browser

- `tests/unit/iso-ground.test.ts` — geometry + wave-shape unit tests for
  `ground.ts`. With `PREVIEW_GROUND=1` it also rasterises a **software
  preview** of the painted ground (the exact polygons, filled by clipping
  tiled textures through SVG-mask rasters, with real atlas sprites on top)
  to `test-results/ground-preview.png` — this is how the look is reviewed in
  a sandbox without Chromium.
- `tests/unit/iso-golden.test.ts` — the pixel goldens now paint the ground
  geometry (land diamonds + sand insets, water transparent) with the flat
  fallback palette through an even-odd scanline fill; pattern pixels are
  browser-AA'd and cannot be pinned by a static golden, the geometry can.
- `tests/unit/iso-debug.test.ts` — the "painter detached" probe counts
  `fillText` ops now: the shoreline foam legitimately strokes every frame.
- `tools/capture-iso-review.mjs` — loads the layer atlases + ground textures
  so a Chromium review (CI/dev machines) shows the real art path.

> Known pre-existing on the post-tickets main (not W-series): 5 rival-AI
> simulations in `tests/unit/iso-game.test.ts` fail on clean `main` too, and
> `iso-vp-race` / `iso-skill-calibration` exceed their budgets under load.
