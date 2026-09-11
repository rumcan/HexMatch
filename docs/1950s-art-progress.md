# 1950s Art Progress & Placeholder Tracker

Tracks execution of `docs/ai-codex-art-tickets-1950s.md`. **Buildings not yet
listed under DONE keep drawing from the shared `assets/layers/buildings@*.png`
sheet** (the per-sprite fallback in `loadBuildingLayers`), so the game is fully
playable at every stage; swapping a placeholder is just: generate →
`node tools/place-building-art.mjs <name> <gen.png>` →
`node tools/make-building-pngs.mjs <name>`.

**Pipeline:** `tools/crop-reference.mjs <name> <out.png>` crops the TTD
silhouette reference from `assets/iso-atlas/groups/` (the §2.3 fidelity
contract) into the tracked `assets/buildings-src/refs/`. The image model
repaints it on a **uniform magenta background** (prompt contract: "Repaint
this isometric game building sprite as a 1950s … Match the reference
silhouette exactly … Solid uniform pure magenta background #FF00FF, no cast
shadows on the background"; for 1×1 townhouses add "about 1.5 times wider
than tall, filling an oblong 2:1 ground diamond"; for known repeat failures
add "one single flat magenta colour everywhere behind the building, no
checkerboard, no transparency grid, no white or dark squares"),
`tools/key-out-magenta.mjs` chroma-keys it to transparency (backdrop colour
estimated from the corners, edge decontamination to kill pink fringing),
`tools/place-building-art.mjs` puts it on the spec canvas (centred, bottom on
the canvas bottom = base front corner on the footprint diamond's south
corner), and `tools/make-building-pngs.mjs` derives trimmed 2×/1×/0.5× +
manifest. `tools/qc-montage.mjs <out.png> <names…>` composites the placed
masters into a grid on #1E2A36 for visual review; a huge "feathered edge px"
count in the keyer output is the early tell for a checkerboard/vignetted
backdrop. QC also includes a magenta-leftover pixel probe (pure-magenta
pixels with alpha>200 must be 0 in every shipped master).

**Manifest: 58 buildings compiled — ALL building restyles complete**
(ART-01…ART-07 done): 20 core/depots/town-center + 10 more residential +
12 commercial + 16 urban flats. Only the 6 bonus match-3 gems (ART-08) remain.

## DONE (1950s Blizzard-style, compiled into `assets/buildings/`)

| sprite | footprint | ticket | notes |
| :--- | :--- | :--- | :--- |
| `farm` | 4×4 | ART-01.1 | barn right, silo centre-left, farmhouse left, fenced wheat plots |
| `forest` | 4×4 | ART-01.2 | log cabins, steaming mill, log cradles, pine framing |
| `ore_mine` | 3×3 | ART-01.3 | twin headframe pulleys, conveyor chute, brick motor house, ore piles |
| `quarry` | 3×3 | ART-01.4 | crusher tower, yellow tin roof, derrick crane, stone stacks |
| `gold_mine` | 4×4 | ART-01.5 | stamp mill, flume on trestles, tunnel portal, quartz tailings |
| `oil_rig` | 3×3 | (ART-01 note) | **re-styled** — the pre-existing authored file was the TTD pixel art (pipeline demo); the epic's §2 style directive now applies to it too |
| `factory` | 3×3 | ART-02.1 | sawtooth skylights, twin smokestacks, steam pipes, roof water towers, green bay doors |
| `depot_grain` | 1×1 | ART-03.1 | timber grain shed + elevator tower, feed sacks, hopper |
| `depot_wood` | 1×1 | ART-03.2 | post-and-tin shelter, lumber stacks, crosscut saw, chopping stump |
| `depot_ore` | 1×1 | ART-03.3 | hopper tower, discharge chute, blue/red ore piles, ore cart |
| `depot_stone` | 1×1 | ART-03.4 | stone weighbridge booth, green shingle roof, stone blocks on pallets |
| `depot_oil` | 1×1 | ART-03.5 | pump manifold, red/cream drum tank, valve wheels, brass dials |
| `depot_gold` | 1×1 | ART-03.6 | fortified assay shack, barred windows, brass chest + gold bars |
| `town_center` | 1×1 | ART-04.1 | white clapboard church, octagonal steeple + rooster vane, stained glass, lawn |

### TICKET-ART-05 — Residential (15): COMPLETE
- [x] `town_small_house_1x1_1` — pale-yellow shiplap, porch, flower bed
- [x] `town_small_house_arctic_1x1_2` — deep green timber, steep gable, chimney smoke
- [x] `town_house_modern` — teak + cream shiplap, ribbon windows, entry canopy
- [x] `town_house_modern_2` — brick base / white upper storey, flower bed
- [x] `town_house_pool` — white clapboard + turquoise pool, diving board
- [x] `town_house_swiss` — brown timber chalet, white gables, balcony flower boxes
- [x] `town_house_arctic_1x1_5` — green timber, snowy yard, mailbox
- [x] `town_cottage_old_small` — patchy shingle roof, veg garden plots
- [x] `town_cottage_old_small_2` — regen accepted (first gen painted a checkerboard backdrop instead of magenta; rejected, reverted to fallback, regenerated with the anti-checkerboard clause)
- [x] `town_cottage_old_small_a` — red-tile roof cottage, front flower garden
- [x] `town_cottage_tall` — tall white two-storey, chimney, flower bed
- [x] `town_cottage_arctic_1x1_1` — snow-covered arctic cottage, water tower
- [x] `town_townhouse_3` — red brick row-home, rooftop antenna
- [x] `town_townhouse_garden_2` — two-tone row-home pair, front garden
- [x] `town_townhouse_gardens_2` — brick/orange row-home, shrub garden

### TICKET-ART-06 — Commercial (12): COMPLETE
- [x] `town_bank` — green dome, stone columns, steps
- [x] `town_cinema` — art-deco façade, marquee + neon
- [x] `town_hotel` — four-storey brick, rooftop deck
- [x] `town_shops_modern` — corner diner, teal/cream, marquee
- [x] `town_shops_offices` — brick pharmacy, green awning
- [x] `town_shops_offices_2` — hardware store, striped awning, signage
- [x] `town_shop_small` — small shop, barber-pole sign
- [x] `town_shops_arctic_1x1_2` — green arctic store, snow-topped flat roof
- [x] `town_offices_1423` — tall cream office block, rooftop pad
- [x] `town_office_1460` — compact brick two-storey office
- [x] `town_office_tower_modern` — teal glass bands, red fire escape, rooftop plant
- [x] `town_fountain_1x1` — tiered marble fountain, paved plaza

**Phase 1 wiring (original TTD art, compiled per ticket — not 1950s restyles):**
`town_house_pool`, `town_house_c` (see B1c; `town_house_c` now 44th pool
variant). `town_house_pool` gets its 1950s restyle under ART-05 (it is in the
variant list); `town_house_c` is an extra variant not in the ART-05/06/07
lists and keeps its TTD art.

### TICKET-ART-07 — Urban flats (16): COMPLETE
- [x] `town_flats` — brownstone, red-tile roof, fire escape
- [x] `town_flats_2` — pink corner flat, awning delicatessen
- [x] `town_flats_4` — regen accepted (first gen painted a checkerboard backdrop; rejected, reverted to fallback, regenerated with the anti-checkerboard clause) — brick tenement, rooftop water tower
- [x] `town_flats_grey` — grey stone block, columned bay
- [x] `town_flats_townhouse_tall` — tall cream flat, dormer windows
- [x] `town_small_flat_1x1_1` — orange two-storey, red awnings
- [x] `town_small_flat_1x1_2` — grey steep-roof flat, antenna
- [x] `town_flats_arctic_1x1_1` — tall snow-topped flat, teal accent
- [x] `town_flats_arctic_1x1_2` — low wide snowy flat, rooftop antennae
- [x] `town_flats_arctic_2x1_1` — long snowy flat block
- [x] `town_flats_arctic_2x1_2` — wide arctic flat, green shutters
- [x] `town_flats_trop_1x1_4` — coral flat, bougainvillea
- [x] `town_flats_trop_1x1_7` — coral flat, palm tree
- [x] `town_flats_trop_2x1_6` — teal/cream tropical block, corner tower
- [x] `town_townhouse_garden_3` — pair of red row-homes, veg beds
- [x] `town_offices_tall` — tall tan tower, columned base

## PLACEHOLDERS — still on the shared sheet (swap list, in ticket order)

**6 images remain = 1 final user message:** the match-3 gems (ART-08 bonus).

### [BONUS] TICKET-ART-08 — match-3 gems (6) → `src/assets/gems/<cargo>.png`
- [ ] `grain.png` — golden wheat sheaf in a brass cogwheel
- [ ] `wood.png` — hewn cedar log with embedded woodsman axe
- [ ] `ore.png` — hematite fused with lustrous black anthracite coal
- [ ] `stone.png` — geometric cut granite & marble masonry stones
- [ ] `oil.png` — deep iridescent oil droplet in a vintage red drum rim
- [ ] `gold.png` — stamped gold bullion bar with radiant specular star glints

### TICKET-B4 (Phase 3, after all art)
- [x] runtime Set tracking: `IsoRenderer.setSpriteUseTracking()` + `__iso.spriteUse(on?)` (flag-gated, off by default)
- [x] static audit: `tools/b4-dead-art-audit.mjs` (literals ∪ constructed families ∪ town pool ∪ optional runtime set) → 65 deletion candidates, all in the documented dead families (`factory_mt_*`, `spare_*`, numbered `_t##` variants, `town_house_a/b`) — **awaiting sign-off + an observed session before any manifest edit/repack**
- [x] safe immediate deletions: `assets/new-atlas/` (already absent in this checkout), `assets/iso-atlas/contact-sheet.png` + `footprint-check.png` (regenerable dev-review outputs, nothing imports them)
- [ ] review stray root-level `.patch` files (`01a07ce9-*.patch`, `building-layers.patch`) — needs user sign-off
- [ ] observed-session audit pass (`__iso.spriteUse(true)` + full exercise, then `--observed`) → proven-dead list → two-stage deletion + `npm run slice-atlas` repack

**Image budget protocol (user-directed):** the image model allows 10 generations
per user message. When the limit is hit, work stops at the image boundary and
resumes on the next user message. Swapping a placeholder is one command each
way (see pipeline above); everything not yet generated keeps the shared-sheet
fallback, so the game is complete at every stage.

## Verification status
- [x] Phase 0: B0 (dist copy + e2e spec), B2 (lanczos3), B3.1 (trim), B3.2 (recomputePad)
- [x] Phase 1: B1a/B1b/B1c compiled; town_house_c in pool (44 variants)
- [x] Phase 2: ART-01…ART-07 complete — 58 sprites in manifest; ART-08 gems pending final batch
- [x] `npm run typecheck && npm run lint && npm test` — green (3 pre-existing rival-AI sim failures, verified identical on base commit)
- [ ] in-browser visual pass of all new buildings at 3 zooms (e2e spec covers manifest/200s + no fallback warnings; runs in CI — sandbox has no browser)
