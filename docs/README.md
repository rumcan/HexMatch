# OpenGFX as the art base — findings

## Licence: GPLv2, and it's the right fit

OpenGFX is GPL-2.0-only. It exists specifically so OpenTTD can ship without the copyrighted TTD CD files — the project's stated goal is a set of free base graphics that removes any need for the original art. The OpenTTD team's own content-creation statement confirms the licences permit use for any purpose including commercial, and explicitly notes that this permission covers OpenGFX but **not** the original Transport Tycoon Deluxe data files.

**What GPLv2 means for you here:**

- You can use, modify and redistribute the sprites freely.
- If you distribute the game with these assets bundled, the combined work should carry GPLv2 and you should publish the source. Your repo is already public, so this is a small step: add a `LICENSE` file and a credits note.
- For a personal project this is close to no burden at all. The credits list in the OpenGFX repo (`docs/authoroverview.csv`) has per-sprite attribution if you want to be thorough.

The one thing to weigh: GPL is viral for the combined work. If you ever want to close-source HexMatch, keep the assets in a separate downloadable pack rather than bundled. Not worth worrying about now.

## The art matches your spec exactly

Measured from `sprites/png/terrain/grass-temperate.gimp.png`:

**Ground tiles are 64 × 31 pixels.**

That is precisely the `TILE_W = 64, TILE_H = 32` proposed in E0 — 31 drawn pixels with 1px of overlap between rows. No rescaling, no reprojection, no camera-angle guessing. The E0 constants can be locked in as written.

Every sprite is drawn to one fixed projection by construction, which is the problem AI generation could never have solved reliably.

## What's available

In `sprites/png/`:

| Your industry | OpenGFX source |
|---|---|
| Farm | `industries/farm_temperate.png` |
| Forest | `industries/lumbermill.png`, `trees/temperate/` |
| Coal Mine | `industries/coalmine_base.gimp.png` + 3 animation frames |
| Iron Mine | `industries/steelmill.png` (reskin to ore) |
| Quarry | `industries/goldmine/` (reskin grey) |
| Oil Rig | `industries/oilwell/` — 5 animation frames already |
| Gold Mine | `industries/goldmine/goldmine_base.gimp.png` |
| Main Factory | `industries/factory.png` |
| Terrain | `terrain/grass-temperate.gimp.png`, `rough-temperate.png`, `rocks-temperate.png` |
| Road / rail | `landscape/landscape031.png`, `infrastructure/rail/` |

The coal mine and oil well ship with animation frames already, which covers the animated-sprite requirement in E1 for free.

## Sheet format and the extractor

The sheets are laid out as blue-backed (`#0000FF`) boxes on a white page, with a numeric sprite id printed above each box. `extract.py` finds each box, keys the blue to transparent, crops to content, and writes RGBA PNGs.

```bash
python3 extract.py OpenGFX/sprites/png/terrain/grass-temperate.gimp.png out/grass --prefix grass
```

Three details in it that matter, all commented in the source:

1. **Boxes are found by the blue, not by "not white."** The id labels are also not-white and would otherwise be merged into the sprite's bounding box. A sprite may legitimately contain white pixels (the white factory walls), so white is page background only *outside* a box.
2. **Run detection has a gap tolerance.** Sprite content touching the edge of its blue box splits the blue into pieces; a tolerance stitches one box back together while keeping stacked boxes apart.
3. **A row must be ≥15% blue to count as part of a box**, which keeps the id label out of the crop.

**Known tuning item:** on densely packed sheets, the horizontal gap tolerance sometimes merges a box with the label beside it, leaving a white strip. Visible in a few cells of the contact sheet. Terrain and the larger industry sprites come out clean. Drop the horizontal gap from 8 to 3 for those sheets, or crop the strays by hand — there aren't many.

Check output against `contact-sheet.png`, which composites extracted sprites over bright green so any alpha fringe or leftover key colour is obvious. Never check against white.

## Suggested workflow

1. Extract the sheets you need with `extract.py`.
2. Reskin in Photoshop — recolour, add detail, change the era. This is where HexMatch stops looking like OpenTTD, and it's much less work than drawing from scratch.
3. Keep the palette consistent. OpenGFX is 8bpp paletted; if you introduce full-colour elements they'll read as foreign against the rest.
4. Feed the results into the E1 atlas packer with footprints and anchors.

**Road and rail:** still follow the E5 plan — extract one half-piece and composite the 16 masks. `landscape031.png` has the road pieces, but OpenGFX's layout won't map one-to-one onto your 4-bit mask scheme, so building the 16 from a half-piece stays the reliable route.

**AI generation is still useful**, just not for the base set. Use it for pieces OpenGFX lacks — your harvester depot, the blockade marker, player-colour variants — with an extracted OpenGFX sprite attached as the style reference. That solves the camera drift problem the earlier prompt sheet was fighting.

## Attribution

Add to your README:

> Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX), © 2007–2016 the OpenGFX team, licensed GPLv2.
