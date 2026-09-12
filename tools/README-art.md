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

## Scenery — ground decals and trees

The pattern-painted ground is one continuous meadow, which is the point (no
per-tile sprite puzzle) but leaves a flat green field at map scale. Scenery
breaks it up.

**Nothing in this pipeline is drawn by the tool.** A first pass generated
trees as stacked SVG blobs and ground patches as noise fields; both read as
stickers laid on top of painted OpenGFX pixel art, however they were tuned.
`tools/make-scenery-art.mjs` now only ever CUTS, FITS and OPTIMISES artwork
that already exists.

```bash
npm run scenery-art      # = make-ground-textures.mjs grass + make-scenery-art.mjs
```

### Trees

Cut from `tools/scenery-src/trees.png` — six painted species, found by
connected-component labelling so the sheet's spacing and size are free.

Scale comes from the ART, not a hand-set table: the tallest tree on the sheet
is mapped to `TALLEST_2X` and everything else scaled by that same factor, so
the proportions the artist drew survive into the game. Each species then ships
three or four **size** variants, which is what stops a wood reading as a row
of identical stamps.

Variants are size ONLY. Mirroring was tried and removed: every tree on the
sheet is lit from the upper right, and a mirrored copy is lit from the upper
left — scattered through a wood that reads immediately as two suns. Scale is
the one transform that leaves the key light where the artist put it, and a
mixed-age wood is a better result anyway.

Each sprite gets a **soft cast shadow** composited under its foot: a 2:1
squashed ellipse (the ground plane), smoothstepped twice so it is dense under
the trunk and gone well before its rim. Without it a tree hovers — the art has
no contact point of its own and a flat painted meadow gives it nothing to sit
on.

Geometry is the same contract as `make-building-pngs.mjs`: centre-anchored
(`def.center`), and the anchor is the foot of the trunk — taken from the
centroid of the bottom few rows, not the bounding-box centre, because a
painted tree leans and a bbox anchor visibly drifts the wood off the grid.
Sizes are snapped so `w@2x = 2·w@1x = 4·w@0.5x` exactly (the blit's source
rect is `round(w · zoom)`; a mismatch crops an edge).

### Forest blocks

`forest-conifer.png` and `forest-mixed.png` become 4×4 sprites. Unlike a 1×1
tree, a multi-tile block's GROUND DIAMOND has to line up with a specific
number of tiles, and the bounding box is the wrong thing to scale from because
the canopies overhang the ground by a different amount in each drawing. So the
scale comes from the diamond: the widest opaque row of the picture IS its
waist, and that is mapped to the exact width 4×4 tiles span. The anchor
follows — the waist's midpoint, half a diamond above the bottom vertex.

They are placed first and their sixteen tiles reserved, so no 1×1 tree sprouts
out of the middle of a painted wood; a skirt of single trees is then planted
around each, which is what makes a block feather into the meadow instead of
ending on its own footprint edge. Anything built on ANY of the sixteen clears
the whole block — a half-erased painted wood would look far worse than a
cleared one.

### Ground decals

Cut from `tools/scenery-src/*.png` — four families (`bare`, `dry`, `rocky`,
`lush`), see the README in that folder. **A family with no source ships
nothing** and the ground paints a plain meadow there; there is no procedural
fallback, because filling missing art in with something invented is the thing
that went wrong the first time.

Output is 768×384, authored 2:1 SQUASHED because a patch lies flat on the iso
ground, with three ROTATED variants per source (a ground texture has no up,
and rotating beats cropping, which would cut the soft rim off). The engine
also mirrors a patch at draw time, so twelve files give twenty-four apparent
shapes.

Patches are drawn LARGE — 3½ to 10 tiles across — roughly one per 70 land
tiles, overlapping freely, and each fades out across the outer part of its
radius. They are painted per frame on the terrain canvas above the cached
ground chunks (`paintDecals` in `src/iso/scenery.ts`), never baked into a
chunk: the 8×8 chunk that owned a patch's tile would cut it straight through.

### Formats

Split on purpose, and it is worth about a megabyte:

* **Trees stay PNG** (quantised palette, max zlib effort). They are small and
  they are mostly alpha EDGE — a lossy codec spends its bits on the flat
  middle of an image and fringes exactly the thin, high-contrast boundary a
  tree is made of.
* **Forest blocks and ground patches ship WebP.** Large, low-frequency painted
  texture with a wide feathered rim is the case lossy compression is good at
  and palette PNG is bad at: one patch is 184 kB as a quantised PNG and 73 kB
  as WebP, with no visible difference on a texture that is about to be scaled
  and alpha-blended anyway. `alphaQuality` is held high because the feather IS
  the effect — banding there would put a visible rim back on.

`loadScenerySprites` resolves either extension, so the split is invisible to
the engine.

### Rules and review

Trees are DECOR: never written to `grid.occupancy` (no placement rule sees
them), skipped by picking (`decor` on the draw item), and hidden — not
deleted — the moment a road or a building lands on the tile. The scatter is a
pure function of the seed, so a multiplayer guest regenerates the host's
woodland from the seed alone; scenery is never on the wire.

Optimisation is part of the build: every output is tight-trimmed and written
as a quantised palette PNG at maximum zlib effort. All sixteen tree sprites at
three zooms come to about 40 kB.

```bash
npm run dev
# In another terminal (requires Playwright Chromium):
node tools/capture-scenery-review.mjs
```

That writes the densest tree clump at 2×/1×/0.5× plus a wide map sweep to
`test-results/scenery-review/` (ignored). `scenery-lab.html` is the same
review in the live dev server (`/hexmatch/scenery-lab.html?seed=1337`).

## Licence

Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX),
© 2007–2016 the OpenGFX team, licensed GPLv2 — see `LICENSE`.
