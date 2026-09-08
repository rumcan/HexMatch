# HexMatch — Handover: fix the remaining visuals + triple the map

> **Completed 2026-09-08:** See the [implementation and visual review](playtest-reports/2026-09-08-handover.md).
> The original incoming handover is preserved below for context; PR #33 has since merged.

**Written by:** the previous agent (arena session `arena/01a07ce9-hexmatch`)
**State at handover:** F1/F2/F3 are implemented and committed; PR **#33** is open
(`arena/01a07ce9-hexmatch` → `main`). Owner review verdict on the rendered map
(attached screenshots `image-1..5`):

| Screenshot | Subject      | Verdict            |
|------------|--------------|--------------------|
| image-3    | Farm         | ✅ great           |
| —          | Ore mine     | ✅ great           |
| image-2    | Gold mine    | ❌ needs work      |
| image-5    | Towns        | ❌ needs work      |
| image-4    | Factory      | ❌ needs work      |
| image-1    | (map)        | — reference        |

**New requirement:** triple the map size so there is more space between
industries and towns.

The screenshots are the ground truth. The farm (image-3) and ore mine are the
"good" bar to match. **Render and compare against the screenshots/OpenTTD —
do not fix by green tests alone.**

---

## T1 `[P0] [assets]` Gold mine (and quarry) render wrong — finished ground sprites used as building overlays

### Root cause (confirmed in code + authoritative data)
OpenGFX's "finished gold mine" sprites **2247–2262 are the ground tiles
themselves** — the headframe, pit, works and hut are baked into the ground
tile art (each is a full `64×31` tile, the raised ones taller: 2247 is
`64×52 yrel −21`, 2250 is `64×43 yrel −12`, etc.). Only **2263/2264/2265** are
a separate building piece (the animated shaft tower, `45×54 −23/−27`).

`src/iso/config.ts` → `GOLD_MINE_TILES` wrongly treats three of them as
buildings over the generic coal-dirt ground:

```ts
{ dx: 0, dy: 0, m: 72, ground: 2022, building: 2247 }, // ← 2247 is a GROUND tile
{ dx: 0, dy: 2, m: 74, ground: 2022, building: 2249 }, // ← same
{ dx: 0, dy: 3, m: 75, ground: 2022, building: 2250 }, // ← same
```

and `tools/iso-atlas.cells.json` encodes the same bug (`gold_mine_t72` →
`[{2022},{2247}]`, `t74` → `[{2022},{2249}]`, `t75` → `[{2022},{2250}]`, and
the grey `quarry_t72/t74/t75` twins). Result: three tiles draw a coal-dirt
base with a *second full ground tile* overlaid — lopsided and wrong. (The farm
and ore mine are correct because their "building" sprites really are building
pieces over a grass/dirt ground; the gold mine's are not.)

### Authoritative mapping (`_tile_table_gold_mine_0` × pnml "finished goldmine 2247–2262")

| (dx,dy) | m  | ground | building        | note                        |
|---------|----|--------|-----------------|-----------------------------|
| 0,0     | 72 | 2247   | —               | headframe (64×52, −21)      |
| 0,1     | 73 | 2248   | —               | pit (64×32, −1)             |
| 0,2     | 74 | 2249   | —               | works (64×32, −1)           |
| 0,3     | 75 | 2250   | —               | hut (64×43, −12)            |
| 1,0     | 76 | 2251   | —               |                             |
| 1,1     | 77 | 2252   | —               |                             |
| 1,2     | 78 | 2253   | —               |                             |
| 1,3     | 79 | 2254   | 2263/2264/2265  | animated shaft tower        |
| 2,0     | 80 | 2255   | —               |                             |
| 2,1     | 81 | 2256   | —               | ANIM ground (shimmer)       |
| 2,2     | 82 | 2257   | —               | ANIM ground                 |
| 2,3     | 83 | 2258   | —               |                             |
| 3,0     | 84 | 2259   | —               |                             |
| 3,1     | 85 | 2260   | —               | ANIM ground                 |
| 3,2     | 86 | 2261   | —               |                             |
| 3,3     | 87 | 2262   | —               |                             |

### Fix
1. In `src/iso/config.ts`, rewrite `GOLD_MINE_TILES` so each tile's `ground` is
   its own 2247–2262 sprite (drop the `building` field everywhere except
   `(1,3) m79`, which keeps the animated 2263/2264/2265).
2. Update the matching cells in `tools/iso-atlas.cells.json`
   (`gold_mine_t*` and the grey-tinted `quarry_t*`) to the same single-ground
   layout (t79 keeps its animated frame list).
3. `node tools/slice-atlas.mjs` to rebuild the atlas + manifest, then
   `node tools/validate-manifest.mjs assets/iso-atlas/manifest.json`.

### Watch out
- 2256/2257/2260 are **animated grounds** (shimmering ore). If the slicer's
  `frames` mechanism only drives *building* frames, treat them as static for
  now and leave a note — do not fake animation by stacking.
- The quarry is the gold mine grey-tinted: every gold-mine change must be
  mirrored in the `quarry_*` cells (`tint: [138,138,138]`).

### Acceptance
- Gold mine renders as the OpenTTD/OpenGFX gold mine (headframe at one corner,
  shaft tower animated on its own tile), matching the farm/ore-mine quality.
- Quarry looks like the same structure in grey.
- Every referenced sprite id exists in `base-2011-industries.pnml`.

---

## T2 `[P0] [assets] [renderer]` Towns render as industrial junk — use real house sprites

### Root cause (confirmed)
`tools/iso-atlas.cells.json` builds the town from the wrong sprites:

```
town_center → layers: [3981 grass, 2180 "bank building used as town center"]
town_house  → layers: [3981 grass, 2019 "small shed used as generic house"]
```

- **2019 is a coal-mine conveyor shed** — declared in
  `base-2011-industries.pnml` line 14 as
  `spr2019(2019, "sprites/png/industries/coalmine_base.gimp.png") [546, 8, 36, 30, -16, -12]`.
  So every town "house" is actually a piece of coal-mine machinery.
- **2180 is an industries_misc building** (`industries_misc.png` 402,792
  58×44), not a civic building.

That is why the towns (image-5) look like a cluster of sheds rather than a
settlement.

### Fix
Use the temperate house sprites from `src/assets/sprites/pnml/base/base-1440-houses.pnml`
(and `base-1420-houses-church.pnml`). Good candidates:

| role        | sprite | declared rect / xrel yrel | note                                   |
|-------------|--------|----------------------------|----------------------------------------|
| house (2-tile small) | 1444–1446 + ground 1447 | 26×29 (−14,−5) ×3 + 64×35 (−31,−4) | the classic OpenGFX 2×1 house |
| small office | 1458–1460 | 52×31/61/61 (−25,−3/−33) | recolourable, good 1×1 houses      |
| hotel        | 1448–1450 | 64×31/67/74 (−31,−3/−39/−43) | larger, good as the centre       |
| offices (big) | 1421/1422/1425 | 66×87 (−32,−56)          | tall, good centre alternative    |

Suggested composition (verify against image-5 / OpenTTD):
- `town_center`: one prominent building (1448 hotel or 1421 office).
- `town_house`: mix of 1458 (small office) and 1444-type houses. If a 2-tile
  house is wanted, note that 1444–1446 sit on ground tile 1447 and occupy a
  `2×1` footprint — the current town model stamps one `town_house` per 1×1
  tile, so either keep 1×1 sprites or extend the model.

Update the two cells in `tools/iso-atlas.cells.json`, re-slice
(`node tools/slice-atlas.mjs`), re-validate the manifest.

### Acceptance
- Towns look like real settlements (houses + a landmark), consistent with the
  farm/ore-mine quality bar.
- Every referenced sprite id exists in a `.pnml` (grep the declaration files,
  don't assume).

---

## T3 `[P0] [assets] [renderer]` Factory still reads wrong — check ground tint + building anchor

### What is already verified correct
The tile→sprite assignment now matches `_tile_table_factory_0` ×
`_industry_draw_tile_data` (stage-3 entries, re-derived from OpenTTD 0.7.5
`src/table/industry_land.h`):

| (dx,dy) | m  | ground | building | rect (xrel, yrel)        |
|---------|----|--------|----------|---------------------------|
| 0,0     | 39 | 2146   | 2150     | 57×62 (−28, −37) chimney  |
| 0,1     | 40 | 2147   | 2151     | 38×62 (−17, −39)          |
| 1,0     | 41 | 2148   | 2152     | 47×54 (−24, −29)          |
| 1,1     | 42 | 2149   | —        | empty yard                |

Do **not** re-shuffle this mapping — it is right. The remaining visual problem
is one of the two below (I could not see image-4, so verify both):

1. **Ground tint (most likely).** `industry_land.h` sets
   `PALETTE_MODIFIER_COLOUR` on **both** the ground sprites
   (`0x862..0x865` = 2146–2149) **and** the buildings (`0x866..0x868` =
   2150–2152). The whole factory — floor included — is player-coloured. The
   atlas cells (`factory_mt_<color>_*`) currently tint only the building
   layers (`tintLum`) and leave 2146–2149 untinted, so the factory floor
   stays neutral while the buildings are coloured → lopsided. Apply the same
   `tintLum` to the ground layers.
2. **Building anchor.** If the pieces look shifted rather than uncoloured,
   suspect the slicer's placement of tall building layers at their declared
   `xrel/yrel`. Compare `factory_mt_blue_0..3` against a real OpenTTD factory
   screenshot tile by tile.

### Fix
- Add `tintLum` to the four ground layers of every `factory_mt_*` cell in
  `tools/iso-atlas.cells.json`, re-slice, re-validate.
- If the anchor is off, fix it in the cell/layer placement (keep the declared
  `xrel/yrel` from the pnml — never hand-author).

### Acceptance
- Factory matches the OpenTTD factory, uniformly player-coloured, chimney on
  the right tile, empty yard on the right tile.

---

## T4 `[P1] [map]` Triple the map size for breathing room

### Scope
`src/game/config.ts:22` → `export const MAP_W = 48, MAP_H = 48;`
Change to **144×144** (3× each dimension = 9× the tiles; confirm this is the
intended reading of "triple the size" — the alternative is 3× the *area*,
≈ 83×83).

The grid (`MAP_W*MAP_H` typed arrays) and the renderer chunks
(`CHUNK=8`, `chunksX/Y` recompute from `MAP_W/H`) scale automatically. The
work is in the tuning constants and the tests:

### Fix / audit list
1. **Placement spacing** (`src/iso/grid.ts`):
   - Industry placement: Poisson-disc with a `sep` fallback `[6,4,2,1]`
     (line ~66) and a 3-tile coast margin. With 25 industries (see
     `INDUSTRY_QUOTA` in `src/iso/config.ts`) on a 9× larger map, the fallback
     will spread them naturally — verify no overlaps, then consider raising the
     target `sep` so they don't clump.
   - Towns: `TOWN_COUNT = 4`, `TOWN_TOWN_SEP = 10`, `TOWN_INDUSTRY_SEP = 3`,
     `TOWN_HOUSES_MIN/MAX = 6/12` (grid.ts ~line 201). Raise `TOWN_TOWN_SEP`
     and `TOWN_INDUSTRY_SEP` so towns are visibly far from each other and from
     industry (the whole point of the bigger map).
   - Decide whether `INDUSTRY_QUOTA`/`TOWN_COUNT` stay fixed (more space per
     entity — matches the request) or scale up. Owner asked for space, so
     keeping counts and growing spacing is the safe default; flag it in the PR.
2. **Hard-coded test coordinates that will change on the new map:**
   - `tests/unit/iso-ai-sweep.test.ts` pins the seed-1337 enclave set to
     `["44,8"]` and asserts `(2,2)` is water. Both are map-size specific —
     re-derive the enclave set for the new map (the diagnostic helper pattern
     is in the "Errors & Dead Ends" of the session notes: a `zz-diag` test that
     logs `canReachASpot`/enclaves, then delete it).
   - `tests/unit/iso-game.test.ts` already uses the position-agnostic
     `findSouthCorridor` / `findFactorySpot` helpers (good — keep that style).
   - Grep for `48`, `23, 22`, `18, 13` and other seed coordinates across
     `tests/` and update anything map-size specific.
3. **AI sweep runtime budget (critical).** The full seed-1337 sweep already
   runs ~11 min on 48×48 (see `iso-ai-sweep.test.ts`). At 144×144 the full
   pass is ~9× the tiles — not viable. Use `rivalSearchTiles(grid, step)` with
   a larger step, or sample, so the suite stays under CI budget. The `it`
   timeouts (currently 1200s/600s) will need re-checking.
4. **Camera / demo bounds:** verify `src/iso/camera.ts` clamping and
   `src/iso/demo.ts` still behave at the new size (they clamp to `MAP_W−1`
   already, but the initial viewport / zoom defaults may need the map's new
   extent in view).
5. **Docs/comments:** `generateMap`'s docstring says "48×48" — update it and
   any comment citing 48.

### Acceptance
- `generateMap(seed)` produces a 144×144 map; industries and towns are
  spatially comfortable (no adjacency, no crowding), reachability and
  determinism still hold (reuse the F1 tests).
- All tests are size-agnostic or re-derived; the AI sweep stays in budget.
- Render one full map and eyeball it: the owner's complaint is about space,
  so the deliverable is a visibly roomier map.

---

## Sequencing

**T1 → T2 → T3 → T4.**

Do the three visual fixes first (they are independent and local to
`config.ts`/`iso-atlas.cells.json` + re-slice). Do **T4 last**: it invalidates
hard-coded test coordinates and the sweep, and its diffs are large.

## Through-line

- Every tile→sprite mapping is **authoritative data** in
  `build_industry.h` + `industry_land.h` + the repo's `.pnml` files. Transcribe,
  don't guess or measure pixels (that is what produced the gold-mine bug).
- Reuse the flat multi-tile draw path; add no clipping.
- Verify by **rendering and comparing to the screenshots/OpenTTD**, not by a
  green suite — the towns "passed" unit tests while drawing coal-mine sheds.
- After each fix: `node tools/slice-atlas.mjs` and
  `node tools/validate-manifest.mjs assets/iso-atlas/manifest.json`.
