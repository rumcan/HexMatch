# vehicles-src — one keyed master per livery and heading

Eight PNGs, authored at **2×** on a pure magenta `#FF00FF` background, one per
`truck_<blue|red>_<ne|se|sw|nw>`. They are the source of `assets/vehicles/`,
which `tools/make-truck-art.mjs` compiles: the key becomes feathered alpha, the
box is snapped to a multiple of 4 so every smaller tier is an exact half, and
the manifest is written from the result.

| | value |
| --- | --- |
| canvas | whatever the keyed art needs, snapped to 4 px (≈ 84 × 40 at 2×) |
| body | ≈ 52 × 34 px at 2× — this is what the tool scales on |
| anchor | x = mean x of the body's lowest 3 rows, y = the body's bottom row |
| key | `#FF00FF`, unshaded, **zero** magenta bleed or rim light on the art |
| sun | top left (45°), contact shadow to the lower right |
| snow | none, in any form, on any part of any truck |

The background must stay a flat key: the tool recovers alpha from the magenta
excess (`a = 1 − (min(r,b) − g)/255`) and un-mixes the colour, so a shaded or
gradient background becomes semi-transparent junk instead of a soft edge.

The heading in the name is the heading the lorry's **front** points to in
screen space, using the map's four diagonals:

* `se` — front toward the lower right, three-quarter nose on;
* `sw` — front toward the lower left, three-quarter nose on;
* `ne` — driving away up-right: the tailboard and load are the lower-left mass;
* `nw` — driving away up-left: tailboard and load at the lower right.

```bash
node tools/make-truck-art.mjs --raw <dir>      # raw keyed art → masters → tiers
node tools/make-truck-art.mjs                  # masters → tiers only
```

`--raw` reads `<dir>/<name>.png` for the eight names above (or a subset given as
extra arguments), fits the body into the compiler's box, and rewrites the
master. Do not mirror or flip a master to save a drawing: every one of them is
lit from the upper left, and a mirrored copy is lit from the upper right — the
map has one sun.
