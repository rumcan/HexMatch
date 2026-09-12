CAR ART (TRAFFIC-01) — 3 cars, 4 diagonal views each.

These are the ambient-traffic cars you see driving the streets. Right now
every file is a COPY of the OpenGFX goods lorry (../goods_lorry_*.png) —
the placeholder art. Replace any file with your own car PNG and run:

    npm run slice-atlas

...to repack the atlas; the game picks the art up on next load.

Naming:  car<number>_<view>.png
  car:   1, 2 or 3        -> the car named "car 1" / "car 2" / "car 3"
  view:  ne = driving up/right
         se = driving down/right
         sw = driving down/left
         nw = driving up/left

Format: any size PNG with transparency, 1x resolution (the truck source is
~20x15 px). It is trimmed to its opaque bounding box and anchored
bottom-centre automatically (tools/slice-atlas.mjs), so no hand-tuning.

The manifest declarations for these 12 sprites live in
tools/iso-atlas.cells.json (search "car1_ne" ... "car3_nw"), and the game
maps them in src/iso/cars.ts (SPRITE family per car index).
