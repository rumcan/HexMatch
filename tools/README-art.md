# Art pipeline — Kenney isometric packs (K1–K5)

All game art comes from Kenney's isometric sets (CC0 1.0 — public domain):

| Pack | Path | Used for |
| --- | --- | --- |
| Isometric Miniatures | `src/iso/kenny/miniatures/PNG` | terrain blocks, road tiles |
| Isometric Landscape | `src/iso/kenny/landscape/PNG` | terrain alternates, industries |
| Isometric Buildings | `src/iso/kenny/buildings/PNG` | factories, depots |
| Isometric Vehicles | `src/iso/kenny/vehicles/PNG` | the cargo truck (8 compass frames) |

Kenney's ground tiles are **132×64 block diamonds** over a dirt skirt whose
depth **varies by tile** (66px for the landscape blocks, 50px for water) — the
K0 constants in `src/game/config.ts` (`TILE_W=132`, `TILE_H=64`) were measured
from them, and the map is 32×32 at that scale. `BLOCK_H=66` is the *deepest*
skirt, used only to size caches; it is not a height every tile is forced to.

### K-FIX-1 — the bottom-anchor rule (read this before touching the packer)

Kenney's own [3D-import
docs](https://kenney.nl/knowledge-base/game-assets-3d) place iso tiles with
**one fixed drawing offset**: tiles are *meant* to be different heights and
grow **upward** into the transparent margin around them ("margin for larger
tiles, or tiles that don't fit within the usual tile size"). The
[PIXI/Kenney road tutorial](https://github.com/peepsquest/tutorials) names the
failure mode of ignoring this: *"tiles with height seem to float as they are
drawn from the top instead of the bottom — the fix is to draw from the
bottom."* Unity's isometric tilemap docs describe the same projection
(dimetric, "Isometric Z as Y": height is added upward from a fixed floor).

So the packer **never crops, pads or height-normalises a sprite**. Every PNG
is packed at native size and anchored on its measured *ground row* — the row
of its base diamond's left/right corners. A flat 83px water tile, a 99px
grass block, a 127px industry and a five-storey composite all share one ground
line and differ only in how far they extend above it. This replaces the PR #24
skirt normalisation, which forced every tile to 50px, fought the format, and
broke stacked-building anchors.

## The three tools

```bash
node tools/make-derived-art.mjs   # 1. draw what Kenney doesn't ship
npm run slice-atlas               # 2. pack assets/iso-atlas/* + measure anchors
node tools/render-reference.mjs   # 3. render docs/kenney-*.png acceptance shots
```

**`tools/iso-atlas.cells.json`** is the authoritative sprite table. Each cell
is a bare PNG reference plus what the packer needs to know:

```jsonc
{ "name": "road_0110", "png": "landscapeTiles_123.png",
  "kind": "ground", "footprint": [1, 1],
  "mask": "0110",                       // road/rail cells: NE=1 SE=2 SW=4 NW=8
  "note": "NE|SW bend" },

{ "name": "factory_blue", "png": "building_085.png",
  "kind": "standing", "footprint": [1, 1],
  "tintLum": [70, 130, 220] },          // luminance-preserving player tint

{ "name": "vehicle_truck_ne", "png": "garbage_NE.png",
  "kind": "vehicle", "footprint": [1, 1], "heading": "ne" }
```

No compose/box/crop/sprite-id/layers/generator fields — the OpenGFX pipeline
is gone. `tests/unit/iso-manifest.test.ts` enforces this schema.

**`tools/slice-atlas.mjs`** (the packer) measures each PNG to find its base
diamond's **ground row** — the row where its left and right corners sit — and
derives the anchor from it, so nothing is hand-authored:

- `ground` cells (terrain/road/rail): anchor = centre of the ground row;
  cells whose ground row is not at y≈32, or whose widest row does not span
  the tile, are REJECTED (slopes stay out — the grid is flat-only).
- `standing` cells (buildings/industries): anchor = centre of the base
  diamond's ground row, so the base sits on the tile diamond.
- composite `stack` cells: anchored on the **base layer's** ground row, and
  each layer above rests on the measured top face of the one below (the rise
  is measured per layer, not a per-storey constant).
- `vehicle` cells: bottom-centre, so the sprite rests on the road surface.
- `tintLum` tints are applied to the source PNG once at pack time
  (luminance-preserving), not per-frame in the game.

The packer emits `assets/iso-atlas/{manifest.json, atlas@{0.5,1,2}x.png,
contact-sheet.png, footprint-check.png}` and validates against
`tools/atlas-manifest.schema.json` (`node tools/validate-manifest.mjs`).

**`tools/make-derived-art.mjs`** draws the pieces Kenney does not ship into
`src/iso/kenny/derived/`: the 16 rail masks (dark-steel rails + sleepers only
on set arms, from the widest-row geometry of the road set), the level
crossing, and the `highlight`/`highlight_soft` placement glows. Derived PNGs
are committed and referenced by `cells.json` like any other source.

## Roads: masks → PNGs (the 90° bug)

Our mask convention is **NE=1, SE=2, SW=4, NW=8** (compass around the tile).
Each of the 16 masks names one Kenney road tile, and the two straight
diagonals are *different tiles* (`landscapeTiles_082` vs `_074`).
`tests/unit/iso-atlas-pixels.test.ts` probes asphalt at each diamond edge
midpoint of the source PNGs, so a 90° rotation cannot slip in unnoticed.

## Heads-up

- Kenney's file names are irregular (`landscapeTiles_018.png`,
  `building_085.png`, spaces in the vehicle colour dirs); the cells table is
  the spelling authority.
- The vehicle packs also carry `_D`/`_U` slope frames — unused (flat grid).
- For headless inspection: `node tools/peek.mjs <file.png> <x> <y> <w> <h>`.

## Credit

Art by Kenney — https://kenney.nl — isometric packs, licensed CC0 1.0
(public domain): https://creativecommons.org/publicdomain/zero/1.0/
