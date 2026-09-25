# ART-4 (#402) — smaller railways on a gravel bed: preview sheets

These are the before/after sheets for the PR, rendered **through the shipping
painters** rather than through a browser: `paintRailTiles` (and, for the width
reference, `paintRoadTiles`) is driven with a recording 2D context, its ops
become SVG with the same ground-space transform, widths, alphas and gravel
bytes the game would use, and `sharp` rasterises that. Same geometry, same
palette, same gravel — only the backend differs.

| File | What it shows |
| --- | --- |
| `straight-vs-road` | a straight run (left) beside a paved road (right) — the width reference |
| `diagonal` | the 32/64 diagonal link (`RAIL_DE` east on (10,10), read back west by (11,9)) |
| `curve` | a 90° bend through (10,10), both ends capped by buffer stops |
| `junction` | a crossroads: two through runs, the steel continuous both ways |
| `bridge` | two deck tiles (#266) under the track |
| `slope` | a rail ramp — bed and rails draped by `elevation.ts` (#267/#269) |
| `platform` | the 1×3 platform's own footprint (the sprite itself is a stand-in box) |

Each sheet stacks the three zooms — **2× (closest), 1×, 0.5× (far)** — at 2×
enlargement, nearest-neighbour. `before/` holds the same seven sheets rendered
from `main` at 99c6ad7 (the pre-ART-4 renderer), for comparison.

## Regenerating

```bash
ART4_PREVIEW=1 npx vitest run tests/unit/iso-402-rail-art.test.ts -t "preview"
# → test-results/rail-402/*.png (one file per case and zoom)
# then stack the three zooms per case with any image tool (they are composited
# at 2× nearest-neighbour into this folder).
```

The block is off unless `ART4_PREVIEW=1` is set, exactly like the E2 elevation
preview in `tests/unit/iso-elevation.test.ts`.

## The painted ballast the lead can drop in

The bed samples `RailStyle.ballast` whenever it is set, and the code-generated
swatch otherwise. Shipping a painted one needs two pieces of plumbing outside
this ticket's files: a `setRailBallast(image)` on `RoadCache`/`IsoRenderer`
(mirroring `setRoadStyle`) and the boot load of `assets/railway/ballast.webp` in
`game.ts`. Target: a **seamless 256×256** swatch, one repeat spanning
`GRAVEL_REPEAT` (1.2) tile units — the same discipline
`tools/make-road-textures.mjs` already enforces for `assets/roads/*`, which can
be reused verbatim (it verifies the wrap against the interior and refuses a
swatch that will show a grid).

## What the sheets do NOT prove

* No river, no coast, no buildings, no trains and no grass texture: this is the
  rail (and road) pass alone, on flat colour. The lead's play-test is the real
  check.
* The platform's footprint box is a rectangle, not the platform sprite: it
  shows where the sprite lands, not how it looks.
* Bridges are shown without the water they cross.
