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
| Main Factory (HQ) | `industries/food_factory/foodfactory_stage2.png` (TK-003: declared food-processing plant 2189, a larger realistic small factory) |
| Road half-piece | `infrastructure/infra06.png` (spr1332; see `base-1309-road-infra.pnml`) |
| Rail half-piece | `infrastructure/infra06.png` (spr1012; see `base-1005-rail-infra.pnml`) |
| Level crossing | `infrastructure/infra06.png` (spr1370) |
| Harvester (bus terminal) | `infrastructure/infra08.png` (TK-003: declared bus stop 2693) |

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
- **Y3/Y4c/Y5/Y7: the atlas is fully declaration-driven.** The cell map
  (`tools/iso-atlas.cells.json`) contains **no** `compose`/`box`/`crop`/`tiles`
  arrays and no hand-authored anchors. Cell kinds:
  - `sprite: <id>` — one declared OpenGFX ground tile (terrain).
  - `layers: [{sprite, tint?}]` (+ optional `frames`) — a declared building on
    its declared ground tile, each drawn at `tileOrigin + (xrel, yrel)`
    (OpenTTD's own placement rule, Y7). `tint` multiplies opaque pixels
    (player colours, the grey quarry). The oil rig declares its six animation
    stages as per-frame layers.
  - `trackset` — the 16 road/rail bitmask tiles from declared sprites only.
    `mode: "flat"` indexes OpenGFX's finished flat road tiles (1332–1350) with
    OpenTTD's flat selection table after `toOpenttdRoadBits`; `mode:
    "overlays"` draws the declared grass ground plus the declared rail overlay
    pieces (1005–1010) whose two directions are both set. The arm generator,
    `clipArm` and `TRACK_HALF_W` are deleted (Y4c).
  - `generator: "highlight" | "highlight_soft"` — the two procedural placement
    glows; the only non-OpenGFX cells left.
  Anchors are **derived** from the declared offsets
  (`anchor = (-minX + 1, -minY + 31)`, the cell-local tile origin mapped onto
  the renderer's south-corner contract), never measured or hand-tuned (Y5);
  declared rects are trusted verbatim, which is what honouring `NOCROP` means
  here. To re-run: `node tools/parse-pnml.mjs && npm run slice-atlas &&
  node tools/validate-manifest.mjs assets/iso-atlas/manifest.json`.
- **Y7 verification:** `node tools/footprint-check.mjs` renders every building
  over the yellow footprint diamond grid (the overlay the bug was found with)
  at four map quadrant offsets → `assets/iso-atlas/footprint-check.png`.
  Acceptance: each base sits inside its footprint — no overhang past the
  top-left edge, no bare bottom-right corner.
- **Y6 invariants** live in `tests/unit/iso-manifest.test.ts`: no compose/crop
  keys remain, every atlas sprite resolves to declared ids, no road/rail cell
  uses the generator, width ≤ footprint_w × 64 + 32, and every manifest anchor
  equals the declared derivation recomputed from the PNML.
  `tests/unit/iso-atlas-pixels.test.ts` asserts each road mask is
  pixel-identical to its declared tile and that adjacent declared road pieces
  tile seamlessly (the rewritten X4 join test).
- The atlas contains 52 sprites: 3 terrain, 6 industries (incl. the 6-frame
  oil rig), 4 factories, 4 depots, 32 road/rail variants, crossing, and the
  two highlights.

## Licence

Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX),
© 2007–2016 the OpenGFX team, licensed GPLv2 — see `LICENSE`.
