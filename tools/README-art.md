# Isometric art pipeline (E1)

Sources are the **OpenGFX** free base-graphics set for OpenTTD
(https://github.com/OpenTTD/OpenGFX), GPL-2.0. Ground tiles measure
64×31 drawn px (+1px row overlap) which locks `TILE_W = 64, TILE_H = 32`
exactly — no rescaling, no reprojection (see `docs/README.md`).

## Sheet format

Sheets are laid out as blue-backed (`#0000FF`) boxes on a white page with a
numeric id label above each box. `tools/opengfx/extract2.py` finds each cell
by its blue backing (labels have <12% blue and are excluded), crops the
content with a 1px margin and writes RGBA PNGs plus a `*_cells.txt` log.

`tools/opengfx/preview.py` renders any extracted PNG as ASCII art so a
headless operator can pick sprites without a viewer:

```bash
python3 tools/opengfx/extract2.py sheets/industries/farm_temperate.png cells/farm --prefix farm
python3 tools/opengfx/preview.py cells/farm/farm_005.png        # one cell
python3 tools/opengfx/preview.py cells/farm/                     # whole folder
```

## Getting the sheets

`raw.githubusercontent.com` may be blocked in some sandboxes; the GitHub API
works and returns the raw bytes:

```bash
gh api -H "Accept: application/vnd.github.raw+json" \
  "repos/OpenTTD/OpenGFX/contents/sprites/png/industries/farm_temperate.png?ref=master" \
  > sheets/farm_temperate.png
```

Sheets used so far (paths under `sprites/png/`):

| Purpose | Sheet |
|---|---|
| Terrain grass / rough / rocks | `terrain/grass-temperate.gimp.png`, `terrain/rough-temperate.png`, `terrain/rocks-temperate.png` |
| Farm (Grain) components | `industries/farm_temperate.png` (fields, farm house, fences, trees) |
| Forest (Wood) | `industries/lumbermill.png`, `trees/temperate/*` |
| Ore mine (Coal+Iron merged) | `industries/coalmine_base.gimp.png` + `coalmine_anim1..3.gimp.png` (4-frame animation) |
| Quarry (Stone) | `industries/goldmine/*` (reskin grey at pack time) |
| Gold mine | `industries/goldmine/goldmine_base.gimp.png` + `goldmine_anim2..3.gimp.png` |
| Oil rig | `industries/oilwell/oilwell_anim1..6.gimp.png` (6-frame animation) |
| Main Factory (HQ) | `industries/factory.png` |
| Road half-piece | `landscape/landscape031.png` |
| Rail half-piece | `infrastructure/rail/monorail_tracks_temperate.png` |

## State of the work

- `extract2.py` / `preview.py` are committed and validated against the farm,
  factory, coalmine, lumbermill, goldmine, oilwell, grass, rough and rocks
  sheets.
- **Terrain atlas is built**: `node tools/slice-atlas.mjs` reads
  `tools/iso-atlas.cells.json` (source-sheet regions) and packs
  `assets/iso-atlas/atlas@1x/@2x/@0.5x.png` + `manifest.json` +
  `contact-sheet.png` (tile-grid background, magenta anchor, flush diamonds).
  Cells verified by numeric content checks (diamond bounds, sea colour).
  `npm run slice-atlas` regenerates; the committed manifest validates in CI
  (`tests/unit/iso-manifest.test.ts` + `tools/validate-manifest.mjs`).
- **Open item:** every industry/farm sheet is a sheet of *components* (one
  iso tile per cell: crop tiles, buildings on their own tile, fences, trees).
  A final industry sprite for a 2×2 / 3×3 footprint must be composed from a
  building cell + its surrounding ground tiles, and the sprite's `anchor`
  (the pixel that lands on the footprint's south corner) measured from the
  composition. This needs one pass of visual QA against
  `docs/contact-sheet.png` before committing `assets/iso-atlas/manifest.json`
  and the packed `@1x/@2x/@0.5x` sheets.
- Farm cells worth reviewing first: the farm-house building cell, a clean
  crop-tile cell and a fence cell (see `farm_*_cells.txt` once extracted).
- Road/rail: per the E5 standing note, extract **one half-piece** from
  `landscape031.png` / the monorail sheet and composite all 16 bitmask
  variants in the atlas packer; do not source 16 separate sprites.
- Until the atlas lands, the E4 renderer draws its terrain/buildings with
  flat colors and keeps an `atlas.load()` drop-in — see `src/iso/renderer.ts`.

## Licence

Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX),
© 2007–2016 the OpenGFX team, licensed GPLv2 — see `LICENSE`.
