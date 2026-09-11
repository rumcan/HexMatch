# buildings-src — one PNG per building

Each building/industry is **one standalone transparent PNG** (a "layer"), placed
free on its footprint. Only the roads have to fit the iso grid exactly.

## The convention (author at 2× — the most zoomed-in version)

For a building whose footprint is **w×h tiles** (the game's footprint, from
`assets/iso-atlas/manifest.json` — it does not change with the art):

| | formula (2× px) | 1×1 | 2×2 | 3×3 | 4×4 |
| --- | --- | --- | --- | --- | --- |
| **canvas** (square, transparent) | (w+h) × 64 | 128² | 256² | 384² | 512² |
| **anchor** (x, y from top-left) | ((w+h) × 32, (w+h) × 48) | 64, 96 | 128, 192 | 192, 288 | 256, 384 |
| **ground zone** (bottom of canvas) | (w+h) × 32 | 64 | 128 | 192 | 256 |
| **max building rise** above anchor | (w+h) × 48 | 96 | 192 | 288 | 384 |

- The **ground zone** is where the footprint lives: the diamond spans the full
  canvas width, top vertex at canvas centre. Art may cover it exactly (ground
  detail, driveway, field) or ignore it — it never has to snap to the grid.
- The **anchor** is the footprint's centre: the game places that exact pixel
  on the footprint centre. Draw the building's ground line around it.
- Above the anchor you have the **max rise** before the canvas edge clips.
- Name the file `<sprite-name>@2x.png` (the sprite name = the game key:
  `farm`, `forest`, `ore_mine`, `quarry`, `oil_rig`, `gold_mine`, `factory`,
  `depot_*`, `town_center`, `town_house_a`, …).

## Workflow

```bash
# 1. open the matching template (templates/<w>x<h>@2x.png), paste your art in
# 2. rebuild the game variants (2x → 1x / 0.5x, nearest, exact pixel subsets)
node tools/make-building-pngs.mjs            # all of them
node tools/make-building-pngs.mjs farm       # just one
node tools/make-building-pngs.mjs --templates  # (re)generate templates
```

Output: `assets/buildings/<name>@{0.5x,1x,2x}.png` + `manifest.json`. The
game loads them automatically — a building that has a PNG layer blits from its
own files (footprint-centre anchored); everything else keeps blitting from the
shared `assets/layers/buildings@*.png` sheet.

The pipeline validates the canvas size against the footprint and refuses
anything off-spec.
