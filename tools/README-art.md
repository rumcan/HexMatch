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
| Towns | `houses/buildings.png`, `houses/temprtbuilds.png`, `houses/base-1421.1425.1424-offices.png` |
| Main Factory (HQ) | `industries/factory.png` |
| Road half-piece | `infrastructure/infra06.png` (spr1332; see `base-1309-road-infra.pnml`) |
| Rail half-piece | `infrastructure/infra06.png` (spr1012; see `base-1005-rail-infra.pnml`) |
| Level crossing | `infrastructure/infra06.png` (spr1370) |

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
  - `layers: [{sprite, tint?, tintLum?}]` (+ optional `frames`) — a declared building on
    its declared ground tile, each drawn at `tileOrigin + (xrel, yrel)`
    (OpenTTD's own placement rule, Y7). `tint` multiplies opaque pixels
    (multiplicative recolouring); `tintLum` preserves luminance/shading for
    player-coloured factories and the genuinely grey quarry. A shared base
    must not also contain the building supplied by `frames`. The oil rig declares its six animation
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
- **Grouped editing sheets:** `node tools/make-atlas-groups.mjs` (chained into
  `npm run slice-atlas`, standalone via `npm run atlas:groups`) splits the one
  large atlas into logical groups under `assets/iso-atlas/groups/` — one PNG
  per group (auto-paginated), every sheet ≤ 1920×1080 so it fits an
  image-generating UI. Each sprite is cropped verbatim from the packed atlas
  onto a white card over a transparency checker, with its manifest sprite
  name — the variable/key the game uses — rendered as text underneath
  (animated strips show every frame, tagged `[xN]`). `groups@<z>x.json`
  indexes the sheets and records each sprite's art rect (sheet pixels, card
  and label excluded) so a future tool can slice sprites back out of an
  edited sheet. The sheets are editing masters / visual reference only: the
  game keeps loading `atlas@1x/@2x/@0.5x.png` + `manifest.json` unchanged.
  `tests/unit/iso-atlas-groups.test.ts` pins the ≤1920×1080, exact-coverage
  and no-overlap invariants (so a manifest change without regenerated groups
  fails `npm test`), and the G7 CI step byte-compares the committed sheets.
- **Y6 invariants** live in `tests/unit/iso-manifest.test.ts`: no compose/crop
  keys remain, every atlas sprite resolves to declared ids, no road/rail cell
  uses the generator, width ≤ footprint_w × 64 + 32, and every manifest anchor
  equals the declared derivation recomputed from the PNML.
  `tests/unit/iso-atlas-pixels.test.ts` asserts each road mask is
  pixel-identical to its declared tile and that adjacent declared road pieces
  tile seamlessly (the rewritten X4 join test).
- The atlas currently contains **103 packed sprites** from 73 source cells,
  including per-tile multi-tile industries/factories, four town cells, 32
  road/rail variants, crossing and the two highlights.

## T1–T4 reproducible visual review

The three house sheets above are mirrored from OpenGFX commit
`c51c904f4f6e7466ee73f907520ef7ea9a53bcbb`; their Git blob hashes match the
incoming patch. The patch's misspelled `temperptbuilds.png` was an HTTP 404
JSON response, not an image, and is intentionally not included.

```bash
node tools/parse-pnml.mjs
npm run slice-atlas
node tools/validate-manifest.mjs assets/iso-atlas/manifest.json
npm run dev -- --port 5173
# In another terminal (requires Playwright Chromium):
node tools/capture-iso-review.mjs
```

The capture tool uses the real browser renderer, fixed seed 1337 and animation
phase 0. It writes close-ups at 2× and the full 144×144 map at native 0.5× to
`test-results/iso-review/` (ignored). `ISO_REVIEW_URL` and
`CHROMIUM_EXECUTABLE` are optional environment overrides. Reviewed evidence is
linked from `docs/playtest-reports/2026-09-08-handover.md`.

Gold/quarry grounds 2256, 2257 and 2260 have OpenGFX palette shimmer, not
separate building frames. They remain static until palette cycling is
supported; only the shaft tower uses the three explicit 2263–2265 frames.

## Licence

Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX),
© 2007–2016 the OpenGFX team, licensed GPLv2 — see `LICENSE`.
