CAR ART (TRAFFIC-01) — 3 cars, 4 diagonal views each, 12 PNGs.

These are the ambient-traffic cars you see driving the streets. The files
are the real car art: car 1 dark teal, car 2 light grey, car 3 green — each
a 50x50 transparent PNG. Replace any file with your own car PNG and run:

    npm run slice-atlas

...to repack the atlas; the game picks the art up on next load.

Fitting the road: the 12 car cells in tools/iso-atlas.cells.json carry
"scale": 0.5, so each 50x50 source is nearest-resized to 25x25 before the
pipeline trims it to its opaque bbox — the cars pack at ~22-25 x 14-16 px,
a bit bigger than the 20x15 lorry but still on the road. If you drop in
larger art, adjust that "scale" so the packed size stays in the same
envelope. The zoom atlases are integer-scale copies of the 1x cells, so the
fit holds at 0.5x / 1x / 2x.

Naming:  car<number>_<view>.png
  car:   1, 2 or 3        -> the car named "car 1" / "car 2" / "car 3"
  view:  ne = driving up/right
         se = driving down/right
         sw = driving down/left
         nw = driving up/left

Format: any size PNG with transparency, 1x resolution. It is (scaled,
then) trimmed to its opaque bounding box and anchored bottom-centre
automatically (tools/slice-atlas.mjs), so no hand-tuning.

The manifest declarations for these 12 sprites live in
tools/iso-atlas.cells.json (search "car1_ne" ... "car3_nw"), and the game
maps them in src/iso/cars.ts (SPRITE family per car index; the slots cycle
past three, so "car 4" wears car 1's livery).
