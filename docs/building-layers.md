# Building layers — one PNG per building

Buildings (industries, depots, town) are drawn as **one standalone transparent
PNG per sprite** ("building layer"), placed free on its footprint — the
art does not have to snap to the iso grid. Only the roads stay exact-grid
(they keep using the shared `assets/layers/roads@*.png` sheet).

Replaces the old behaviour where every building was a rect cut from the shared
`buildings@*.png` sheet, anchored by its south-corner reference (which left
art visibly offset from its tiles).

## Authoring convention (author at 2×, the most zoomed-in version)

For a building whose footprint is **w×h tiles** (footprints are the game's,
from `assets/iso-atlas/manifest.json` — the art never changes them):

| | formula (2× px) | 1×1 | 2×2 | 3×3 | 4×4 |
| --- | --- | --- | --- | --- | --- |
| canvas (square, transparent) | (w+h) × 64 | 128² | 256² | 384² | 512² |
| anchor (x, y from top-left) | ((w+h) × 32, (w+h) × 48) | 64, 96 | 128, 192 | 192, 288 | 256, 384 |
| ground zone (bottom of canvas) | (w+h) × 32 | 64 | 128 | 192 | 256 |
| max building rise above anchor | (w+h) × 48 | 96 | 192 | 288 | 384 |

- The **ground zone** is where the footprint diamond sits (full canvas width,
  top vertex at canvas centre). Cover it exactly or not at all.
- The **anchor** is the footprint's centre: the renderer places that exact
  pixel on the footprint centre (`def.center` branch of `drawOrigin` in
  `src/iso/depth.ts`), so art drawn on the template sits concentric with its
  tiles.
- Draw the building's ground line around the anchor; above it you have the
  max rise before the canvas edge clips.
- **Overhang extension (ART-1950S):** a source may exceed the base canvas —
  the TTD art overhangs its footprint (20 of 43 town sprites, 4 of 6 depots
  at 2×). Keep the ground diamond pinned to the canvas bottom (bottom vertex
  at `(W/2, H)`, anchor at `(W/2, H − (w+h)×16)` at 2×) with headroom above
  and symmetric width either side; `W`, `H` ≥ `S`. The base canvas is the
  `W = H = S` special case. See `assets/buildings-src/README.md`.

## Pipeline

```bash
# templates (marked canvas per footprint: ground diamond, tile grid, anchor)
node tools/make-building-pngs.mjs --templates

# drop <name>@2x.png into assets/buildings-src/ (name = sprite key:
# farm, forest, ore_mine, quarry, oil_rig, gold_mine, factory, depot_*, …)
node tools/make-building-pngs.mjs            # all, or: ... farm quarry

# fit loose art (transparent or chroma-backed) onto the right canvas,
# scaled/positioned from the sprite's own sheet reference:
node tools/fit-building-art.mjs farm path/to/raw-art.png
```

The tool validates the canvas size against the footprint (base size or a
larger overhang canvas), writes
`assets/buildings/<name>@{0.5x,1x,2x}.png` plus `manifest.json`. Outputs are
**tight-trimmed** to the art's alpha box — `w`/`h`/`anchor` in the manifest
are expressed relative to the trimmed image — and the 1×/0.5× tiers are
resampled with a quality kernel (lanczos3; sharp premultiplies alpha during
resize, so transparent edges stay clean). Nothing is ever scaled inside
drawImage: each zoom blits a pre-rendered file at its exact pixel size.

## Engine

- `Atlas.buildingImages` (src/iso/atlas.ts): per-sprite, per-zoom images.
  `imageForSprite` prefers a building PNG over the shared sheet; a failed
  sprite falls back to the sheet individually.
- `loadBuildingLayers()` fetches `assets/buildings/manifest.json` at runtime
  (base-prefixed URL), overrides each covered sprite's def (whole image is
  the sprite: rect 0,0,w,h at 1×; spec anchor; `center: true`) and builds its
  alpha mask for picking.
- Placement: `def.center` switches the anchor from the south-corner reference
  to the footprint bbox centre. Depth key (max corner), culling and picking
  are unchanged; picking uses the building's own alpha mask.
- Non-gating: no manifest → the shared sheet keeps drawing everything.

Review: `tools/capture-iso-review.mjs` loads the building layers too.
