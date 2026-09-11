# ART-1950S — authored art vs placeholders

`tools/fit-building-art.mjs` fits LOOSE art onto a compliant `@2x` master.
Every sprite below has a compiled per-building PNG layer; the **placeholder**
masters are the sprite's own sheet reference (identical pixels to the shared
atlas art, re-fitted onto the authoring canvas) so the pipeline, geometry and
picking are all exercised today and swapping in real art later is ONE command:

```bash
# 1. author/save loose art anywhere (opaque output on a solid magenta
#    backing works — the fit tool keys it out; transparent PNGs pass through)
# 2. fit + compile + manifest update:
node tools/fit-building-art.mjs <sprite-name> path/to/raw-art.png
node tools/make-building-pngs.mjs <sprite-name>
```

Design briefs for every remaining sprite live in
`docs/ai-codex-art-tickets-1950s.md` (§ ART-05…08). Reference cells for
conditioning the image model are extracted with (sharp, from
`assets/iso-atlas/manifest.json` rect × 2):

```bash
node -e "const s=require('./assets/iso-atlas/manifest.json').sprites.<name>; \
  require('sharp')('assets/iso-atlas/atlas@2x.png') \
  .extract({left:s.x*2,top:s.y*2,width:s.w*2,height:s.h*2}) \
  .png().toFile('/tmp/ref-<name>.png')"
```

## Status 2026-09-11

### Authored 1950s art (complete — real art, not placeholders)
- `oil_rig`, `town_house_pool`, `town_house_c` *(pre-existing masters; c re-fitted onto a compliant canvas)*
- ART-01: `farm`, `forest`, `ore_mine`, `quarry`, `gold_mine`
- ART-02: `factory`
- ART-03: `depot_grain`, `depot_wood`, `depot_ore`, `depot_stone`, `depot_oil`, `depot_gold`
- ART-04: `town_center`

### PLACEHOLDERS (sheet-reference art — swap for 1950s art, ART-05…07)
Residential homes & cottages (ART-05, 14 of 15; `town_house_pool` is authored):
- `town_small_house_1x1_1`
- `town_small_house_arctic_1x1_2`
- `town_house_modern`
- `town_house_modern_2`
- `town_house_swiss`
- `town_house_arctic_1x1_5`
- `town_cottage_old_small`
- `town_cottage_old_small_2`
- `town_cottage_old_small_a`
- `town_cottage_tall`
- `town_cottage_arctic_1x1_1`
- `town_townhouse_3`
- `town_townhouse_garden_2`
- `town_townhouse_gardens_2`

Commercial shops & services (ART-06, 12 of 12):
- `town_bank`
- `town_cinema`
- `town_hotel`
- `town_shops_modern`
- `town_shops_offices`
- `town_shops_offices_2`
- `town_shop_small`
- `town_shops_arctic_1x1_2`
- `town_offices_1423`
- `town_office_1460`
- `town_office_tower_modern`
- `town_fountain_1x1`

Urban apartments & flats (ART-07, 16 of 16):
- `town_flats`
- `town_flats_2`
- `town_flats_4`
- `town_flats_grey`
- `town_flats_townhouse_tall`
- `town_small_flat_1x1_1`
- `town_small_flat_1x1_2`
- `town_flats_arctic_1x1_1`
- `town_flats_arctic_1x1_2`
- `town_flats_arctic_2x1_1`
- `town_flats_arctic_2x1_2`
- `town_flats_trop_1x1_4`
- `town_flats_trop_1x1_7`
- `town_flats_trop_2x1_6`
- `town_townhouse_garden_3`
- `town_offices_tall`

### Not yet started (bonus ticket, existing art still in use)
- ART-08 match-3 gems `src/assets/gems/{grain,wood,ore,stone,oil,gold}.png`
  (current Kenney-style gem art remains; restyle to the 1950s brief when
  image generation is available again)
