# Railway art (RAIL-03 / #177)

Original transparent PNG art for the Railways epic (#142), compiled by
`tools/make-railway-art.mjs`. Nothing here is extracted from Transport Fever;
there is no third-party art in this folder at all — every pixel is generated
from a parametric model in tile space, so the licence is the repository's own.

## Files

```
locomotive_{ne,se,sw,nw}@{0.5x,1x,2x}.png   moving, 1x1 footprint, 3 axles a side
wagon_{ne,se,sw,nw}@{0.5x,1x,2x}.png        moving, 1x1 footprint, ore load
platform_{ne,se,sw,nw}@{0.5x,1x,2x}.png     static, 2x3 (ne/sw) or 3x2 (se/nw)
train-depot_{ne,se,sw,nw}@{0.5x,1x,2x}.png  static, 2x2, one declared rail exit
manifest.json                               geometry + alpha facts (see below)
contact-sheet.png                           every sprite at 1x, labelled
LICENSES.md                                 provenance statement
```

2× is the authored master (`tools/make-railway-art.mjs` draws straight into the
game's dimetric projection at double size). 1× and 0.5× are derived from it with
a Lanczos kernel, and every master is padded so both dimensions are multiples
of 4 and the anchor is an even 2× pixel — so `round(size * zoom)` is the real
pixel size of each zoom file and the anchor scales exactly.

## How the game uses it

`src/iso/rail-art.ts` imports these PNGs with an eager `import.meta.glob` (the
same route `scenery-art.ts` and `vehicle-art.ts` take, and why `vite.config.ts`
needs no copy step for this folder) and installs each sprite into the atlas — a
whole per-zoom image IS the sprite, placed by the manifest's anchor.
`manifest.json` rides in as a plain JSON import. Moving sprites (locomotive, wagon) are anchored
on their GROUND CONTACT point and drawn as `world.vehicles` items
(`drawOriginMoving`); the static ones (platform, depot) are ordinary
footprint-anchored structure sprites and are drawn as `world.extra` items,
exactly like a factory or a depot.

Art is an upgrade, never a gate: if this folder (or a single file) is missing,
`loadRailwaySprites` returns 0 and the game falls back to its flat vector-drawn
railway. Because the glob is eager, the PNGs are part of the bundle and resolve
identically under `vite dev`, `vite preview` and a deployed build — no manifest
fetch, no production copy. `tests/unit/iso-rail-art.test.ts` pins the contract.

## manifest.json

Per sprite:

| field | meaning |
| --- | --- |
| `w`, `h` | sprite size at 1× (the image is the whole sprite) |
| `anchor` | placement point at 1×, sprite-local: the ground contact point (moving) or the footprint's south vertex (static — the same convention every other structure in the atlas uses) |
| `footprint` | tiles covered: [1,1] vehicles, [3,2]/[2,3] platform, [2,2] depot |
| `moving` | true for locomotive/wagon — the renderer anchors these on a fractional tile |
| `box2x` | master size in pixels (2×), i.e. the file's own size ÷ 2 at 1× |
| `lenTiles`, `widthTiles` | vehicle body extents in tiles (wagon spacing) |
| `coupler.front`/`.rear` | tile offset of each coupler from the anchor, along the heading |
| `alpha` | `coverage` and the four `corners` (all 0 — the art is transparent) |

## Regenerating

```bash
node tools/make-railway-art.mjs            # all 16 sprites + manifest + docs + sheet
node tools/make-railway-art.mjs wagon_se   # one sprite
```
