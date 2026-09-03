# HexMatch — open backlog

Supersedes `HexMatch-open-backlog-v4.md`. Audited against `main` @ `248f78a` (PR #8 merged). The research brief is correct and its central recommendation should be adopted: **stop detecting sprites visually, parse the declarations.**

I verified this end to end rather than taking it on faith. Findings below include the exact root cause of the triangles, the buildings and the roads — all three trace back to the same thing.

**Work order: Y1 → Y2 → Y3 → Y4 → Y5 → X1b → E8b/c.**

---

## Why the last three rounds of fixes didn't hold

Every sprite defect so far has been fixed by adjusting a hand-authored crop rectangle in `tools/iso-atlas.cells.json`. Those rectangles are guesses at where a sprite sits in a PNG. OpenGFX already states, for all 1973 sprites, exactly where each one is and how it must be positioned — and the slicer ignores that entirely.

I parsed the whole catalog to confirm it's practical:

```
parsed sprites: 1973
1332 infra06.png            434,2568  64x31  xrel -31 yrel 0
2011 coalmine_base.gimp.png  66,   8  37x26  xrel -17 yrel -8
2013 coalmine_anim1.png     162,   8  58x50  xrel -16 yrel -33
```

That took a 20-line regex. Every crop box, every offset, every animation frame, machine-readable.

**Blocker: R9 deleted the declarations.** `src/assets/sprites/` was pruned to `png/` only — zero `.pnml` files remain. The prune removed the source of truth and kept only the pixels, which is precisely backwards. That happened on my recommendation, and the ticket didn't flag the `.pnml` files as load-bearing. They are.

---

## Y1. Replace visual slicing with a declaration-driven extractor
`[P0] [tooling] [blocker]`

**Restore the declarations first:**

```bash
git clone --depth 1 https://github.com/OpenTTD/OpenGFX /tmp/ogfx
mkdir -p src/assets/sprites/pnml
cp -r /tmp/ogfx/sprites/base /tmp/ogfx/sprites/templates src/assets/sprites/pnml/
```

Keep `sprites/base/*.pnml` and `sprites/templates/*.pnml`. They're small text files.

**Build `tools/parse-pnml.mjs`** emitting `tools/opengfx-sprites.json` keyed by sprite id:

```json
{ "2013": { "file": "industries/coalmine_anim1.gimp.png",
            "x": 162, "y": 8, "w": 58, "h": 50,
            "xrel": -16, "yrel": -33, "flags": ["ANIM"] } }
```

Two forms must be handled:
- Direct: `base_graphics sprNNNN(NNNN, "file") { [x, y, w, h, xrel, yrel(, flags)] }`
- **Templated**: `{ tmpl_groundtiles(1, 1) }` — expand templates from `sprites/templates/sprite_templates.pnml`. Terrain, roads and rail all use these, so a parser that only handles the direct form will silently miss most of what matters.

`tools/iso-atlas.cells.json` then references **sprite ids**, not pixel rectangles:

```json
{ "name": "terrain_grass", "sprite": 3981, "footprint": [1,1] }
```

**Acceptance:** the cells file contains no hand-authored `crop`/`box` arrays; every sprite in the atlas traces to a declared id; the parser is unit-tested against three known declarations including one templated one.

---

## Y2. The "weird triangles" — `terrain_grass_b` is a slope sprite, not a grass variant
`[bug] [P0] [assets]`

This is the definitive answer, and it explains why the X2 hash fix didn't remove them. The hash fix was correct and necessary; the sprite it selects is wrong.

`iso-atlas.cells.json` has:

```json
{ "name": "terrain_grass_a", "source": "grass", "box": [1, 1] }
{ "name": "terrain_grass_b", "source": "grass", "box": [81, 1] }
```

From `sprites/templates/sprite_templates.pnml`, `tmpl_groundtiles(x, y)` declares **19 sprites — a slope set**, not variants of one flat tile:

```
[   0+x, y, 64, 31, -31,  0 ]   index 0  ← FLAT
[  80+x, y, 64, 31, -31,  0 ]   index 1  ← slope
[ 160+x, y, 64, 23, -31,  0 ]   index 2  ← slope (note height 23)
[ 638+x, y, 64, 39, -31, -8 ]   index 8  ← slope (height 39, yrel -8)
...
```

`box: [81, 1]` is `80 + 1` — **slope sprite index 1**. Every `terrain_grass_b` tile on the map is a hillside drawn on flat ground. Those are your triangles.

Only index 0 is flat. `grass-temperate.gimp.png` contains **no second flat grass tile** — the sheet is one terrain type across 19 slopes.

**Fix.** Use sprite `3981` (flat temperate grass) as the only grass tile. For variation, use the flat tile of the *grassiness* sheets, which are separate declarations:

| Sprite | Sheet | Look |
|---|---|---|
| 3924 | `bare-03-temperate.png` | bare earth |
| 3943 | `bare-13-temperate.png` | 33% grassy |
| 3962 | `bare-23-temperate.png` | 66% grassy |
| **3981** | `grass-temperate.gimp.png` | **100% grassy — the default** |
| 4000 | `rough-temperate.png` | rough |
| 4023 | `rocks-temperate.png` | rocky |

Use 3981 everywhere and mix in 3962 sparingly if you want texture. Never index into a sheet by pixel offset again — that's what Y1 prevents.

**Acceptance:** every terrain sprite in the atlas is 64×31 with `yrel: 0`. Assert it in the manifest test — any ground tile with height 23, 39 or 47, or a non-zero `yrel`, is a slope and must fail.

---

## Y3. Buildings are invented compositions, not real industry layouts
`[bug] [P0] [assets]`

The X3 fix replaced one bad crop with a `compose` block that is still guesswork:

```json
"factory_blue": { "compose": {
  "tiles": [ {"dx":0,"dy":0,"box":[65,74]}, {"dx":1,"dy":0,"box":[145,74]}, ... ],
  "overlays": [ {"source":"factory","crop":[284,174,109,78],"dx":1,"dy":1} ] }}
```

It tiles ground boxes in an arbitrary repeating pattern and pastes one hand-cropped overlay in the middle. `ore_mine` does the same, reusing coal-mine ground boxes. Neither corresponds to any real industry layout, which is why the buildings still look wrong.

Real OpenTTD industries are **per-tile compositions defined in data**:
- `src/table/build_industry.h` — `IndustryTileLayout`, the `(dx, dy, tile_gfx_id)` footprint.
- `src/table/industry_land.h` — `_industry_draw_tile_data`, which ground + building sprite each tile gfx id draws, plus animation.

Coal mine layout 0, for example, is `(1,1,gfx0) (1,2,gfx2) (0,0,gfx5) (1,0,gfx6) (2,0,gfx3) (2,2,gfx3)` — a specific, irregular arrangement, not a 3×3 tiling.

**Two options. Pick one explicitly.**

**(a) Port the layouts.** Transcribe the tile tables for your six industries into TS data, draw ground + building per tile using declared `xrel`/`yrel`. Faithful, and gives correct animation. Maybe a day's work.

**(b) Single-sprite industries.** Give each industry one hand-picked declared building sprite on a plain ground tile, and treat the footprint as a gameplay concept only. Much less work, still looks coherent because every sprite is a real complete building rather than a fragment.

**Recommend (b) for now.** The game doesn't simulate industry tiles individually, so faithful layouts buy appearance only. Option (a) can come later once the pipeline is trustworthy.

Either way: **no more `compose` blocks with hand-typed pixel boxes.**

**Also fix `oil_rig`** — it's `768×160` on a 2×2 footprint, the whole animation strip stored as one sprite. Declared frames are separate sprite ids (the coal hoist is 2013/2014/2015, same box, different files). Reference them individually.

---

## Y4. Use the real 19-piece road set instead of generating arms
`[bug] [assets]`

The generated-arm approach is why roads "don't look like roads" — they're procedurally drawn bands textured with a sampled strip, so joins, widths and curves never match OpenGFX's hand-drawn geometry. The X4 fix made them reach the edge; it can't make them look right.

OpenGFX declares a complete road piece set. All eleven flat pieces are 64×31 at `xrel -31, yrel 0`, and **`infra06.png` is already in your repo**:

| Sprite | Box in `infra06.png` |
|---|---|
| 1332 (Y) | 434, 2568 |
| 1333 (X) | 514, 2568 |
| 1334–1342 | 594,2568 … 482,2632 |

Selection is a documented table. OpenTTD's `GetRoadSpriteOffset` for flat tiles:

```js
const ROAD_OFFSET = [0,18,17,7, 16,0,10,5, 15,8,1,4, 9,3,6,2];
sprite = SPR_ROAD_BASE + ROAD_OFFSET[bits];
```

**Critical detail:** OpenTTD's `RoadBits` order is **NW=1, SW=2, SE=4, NE=8**. Your `track.ts` uses **NE=1, SE=2, SW=4, NW=8**. Do not assume they match — write an explicit remap from your mask to theirs, and unit-test all 16 values. Getting this wrong reproduces the original G1 bug with better art.

Rail: the equivalent set is 1011+, laid out by `tmpl_rail_tracks`.

**Acceptance:** the road generator is deleted; all 16 masks resolve to declared sprite ids via the remap; the existing X4 join test still passes unchanged (it's the guard that the swap didn't move connection points); level crossings use the real crossing sprites.

---

## Y5. Replace hand-authored anchors with declared `xrel`/`yrel`
`[bug] [renderer]`

`manifest.json` carries hand-computed `anchor` values. The declarations give the engine's own placement vector: `xrel`/`yrel` is the offset from the sprite's origin to its bitmap top-left, so the draw is simply

```ts
ctx.drawImage(sheet, sx, sy, sw, sh, ox + xrel, oy + yrel, sw, sh);
```

where `(ox, oy)` is the tile's projected origin. Flat ground is always `xrel: -31, yrel: 0`; tall buildings carry large negative `yrel` (the coal hoist is `-33`), which is what makes them stand correctly instead of floating or sinking.

Carry `xrel`/`yrel` through the manifest and drop `anchor`. This likely fixes building placement issues that haven't been noticed yet.

**Note:** honour the `NOCROP` flag. If a sprite declares it, do not trim transparent edges — offsets depend on the exact declared size.

---

## X1b. Mount the recovered quarry board in the iso UI
`[P0] [gameplay]`

PR #8 restored `board.ts`, `trade.ts` and their tests (208 → 252 tests), which was the urgent half. The modules are still **not wired into the iso game** — there's no match-3 board on screen and no trading panel.

- Mount the quarry board in the iso layout.
- Matching gems credits the six iso cargoes, gated by which industries the player's network reaches (E6 catchment → board).
- Surface the trading panel.

Until this lands the game has no harvesting mechanic, and E8b/E8c stay held — rebalancing an economy whose primary loop isn't connected produces numbers you'll throw away.

---

## Y6. Add the invariants that would have caught Y2 and Y3
`[testing]`

- Every ground/terrain sprite is exactly 64×31 with `yrel: 0`. Catches slope sprites used as flat tiles (Y2).
- Every atlas sprite resolves to a declared OpenGFX sprite id. Catches invented crops (Y3).
- Sprite width ≤ `footprint[0] * 64 + 32`. Catches the 768px oil rig.
- Your bitmask → OpenTTD `RoadBits` remap is exhaustively tested across all 16 values (Y4).

---

## E8b / E8c — held

- **E8b** — give road a late-game niche beyond `onRough`.
- **E8c** — re-time `VP_TARGET` after E8a's ore cost change settles.

Both wait on X1b.