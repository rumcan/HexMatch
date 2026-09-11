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
- ART-05…07: ALL 43 town pool variants (homes, cottages, townhouses,
  commercial, offices, flats) — pool complete 2026-09-11

### PLACEHOLDERS (sheet-reference art — swap for 1950s art, ART-05…07)

**None remain — all 43 pool variants carry authored 1950s art.**

Polish candidates (installed and passing; widest aspect drift from the sheet
reference — re-run with a ratio-stating prompt if a polish pass is wanted):

- `town_townhouse_gardens_2` (1.91 vs reference 1.488 — scene reads flatter
  and wider than the reference)
- `town_flats_arctic_1x1_1` (0.561 vs reference 0.64)

Retry technique that fixed earlier misses: state the reference's explicit
width/height ratio in the prompt (validate-art.mjs prints aspectRef).

### Done, then reverted (bonus ticket)
- ART-08 match-3 gems in `src/assets/gems/` — all 6 were restyled to the
  1950s brief (`grain`, `wood`, `ore`, `stone`, `oil`, `gold`), then
  **reverted to the original hexgems** after playtesting in the live
  preview: the original gems read better on the match-3 board. The 1950s
  restyle is archived — raw masters in `assets/gems-src/`, one command to
  re-apply any of them:
  `node tools/make-gem-pngs.mjs <cargo>   # no raw arg → re-emit from the archived master`

**ART-1950S building art is COMPLETE: every building layer (58) carries
authored 1950s art. No building placeholders remain.** Match-3 gems
intentionally remain on the original art (see above).

Open follow-ups needing user sign-off (no art generation required):
- polish candidates: `town_townhouse_gardens_2` (1.91 vs ref 1.488),
  `town_flats_arctic_1x1_1` (0.561 vs ref 0.64)
- B4 audit: 74 candidate sprites confirmed unreferenced at runtime
  (docs/art-audit-2026-09-11.md) — deletion awaiting sign-off
- B1c: `town_house_c` art compiled but not wired into TOWN_HOUSE_VARIANTS
- stray root `.patch` files (`01a07ce9-*.patch`, `building-layers.patch`)
