# ART-1950S: AI Codex Tickets for 1950s Blizzard-Style Isometric Buildings

**Epic:** Visual Overhaul — High-Resolution 1950s Retro-Industrial Tycoon (Blizzard RTS Style)  
**Target:** Author high-resolution transparent `@2x` PNG images in `assets/buildings-src/`, wire them into the engine, and ship them in production.  
**Governing Technical Specs:**
- [`docs/BUILDING-PNG-MIGRATION.md`](file:///c:/HexMatch/docs/BUILDING-PNG-MIGRATION.md) *(Agent migration instructions & pipeline rules)*
- [`docs/building-layers.md`](file:///c:/HexMatch/docs/building-layers.md) *(Authoring convention & engine contract)*
- [`tools/make-building-pngs.mjs`](file:///c:/HexMatch/tools/make-building-pngs.mjs) *(Image slicing & manifest compilation tool)*

---

## 1. Rules That Apply to Every Agent / Codex Run

1. **Verify in `npm run preview`, NEVER only in `npm run dev`.**  
   The dev server resolves asset paths from the project root. Under production (`vite build`), assets must be properly copied into `dist/assets/buildings/` (see **TICKET-B0**).
2. **`assets/iso-atlas/manifest.json` is the footprint authority.**  
   Art never changes a footprint; if a building needs different tiles, that is a gameplay change and needs its own decision.
3. **Never delete a test assertion to make a change pass.**  
   Update it, and state in the commit/PR what behaviour changed.
4. **Do not remove a zoom level or any sprite without explicit sign-off.**
5. **Always validate before completion:**  
   `npm run typecheck && npm run lint && npm test`.

---

## 2. Master Art Directive & Visual Style Guide

### 2.1 Aesthetic Theme: 1950s Post-War Industrial Boom
- **Era & Mood:** 1950s American industrial optimism, mid-century modern architecture, streamline moderne curves, post-war steel mills, classic roadside diners, and rural Americana.
- **Materials:** Red clinker brick, corrugated tin roofing, weathered timber beams, painted shiplap siding, riveted cast-iron, copper patina, chrome trim, and warm glowing incandescent lamps/neon accents.
- **Palette:** Rich, warm, saturated Kodachrome color grading. Deep navy/forest shadow tones, sunlit warm amber/cream highlights, punchy primary accents (safety yellow, retro signal red, turquoise patina).

### 2.2 Rendering Style: "Blizzard Gaming Style" (Warcraft 3 / StarCraft RTS)
- **Stylized Realism:** Hand-painted painterly textures with crisp chunky edge highlights and exaggerated bevels for high readability at distance.
- **Massing & Silhouette:** Bold, recognizable silhouettes with strong focal points (exaggerated chimneys, oversized gears, chunky water towers, distinct rooflines).
- **Lighting & Depth:** Top-left 45° warm directional sunlight with deep purple/navy ambient occlusion in crevices and overhangs. Distinct specular pings on metal edges.
- **Micro-Detail with Restraint:** Detailed enough to look high-res at 2×, but avoid noisy photorealistic textures that turn to mush when scaled down.

### 2.3 Projection & Silhouette Fidelity Contract
- **Isometric Projection:** Strict 2:1 dimetric projection (`TILE_W = 64, TILE_H = 32`, screen ratio 2:1, ~26.565° pitch angle). All ground edges must run exactly along the isometric diamond axes.
- **Exact Silhouette Matching:** The new art **must closely match the silhouette, massing, height, and component arrangement** of the original Transport Tycoon Deluxe (OpenGFX) buildings:
  - If the original `ore_mine` has a headframe hoist on the left and conveyor ramps on the right, the 1950s upgraded art must preserve that exact composition so player recognition and depth-sorting remain seamless.
  - Visual references for every building are available in `assets/iso-atlas/groups/`:
    - `02-farm-forest-ore-oil-p1@2x.png` & `p2@2x.png`
    - `03-gold-quarry-p1@2x.png` & `p2@2x.png`
    - `04-factories-depots@2x.png`
    - `05-town-p1@2x.png` & `p2@2x.png`

### 2.4 Technical Canvas Specifications (@2x Master PNGs)
Every asset is an RGBA 32-bit transparent PNG, authoring resolution **2×**:

| Footprint | Canvas Size (2×) | Anchor Point `(ax, ay)` | Ground Zone Height | Max Height Above Anchor | Target Assets |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1×1** | **128 × 128 px** | `(64, 96)` | 64 px (bottom) | 96 px | Depots (`depot_*`), `town_center`, town houses (43) |
| **3×3** | **384 × 384 px** | `(192, 288)` | 192 px (bottom) | 288 px | `factory`, `ore_mine`, `quarry`, `oil_rig` |
| **4×4** | **512 × 512 px** | `(256, 384)` | 256 px (bottom) | 384 px | `farm`, `forest`, `gold_mine` |

- **Anchor:** The pixel that sits directly on the footprint diamond's center on the game map.
- **Ground Zone:** The bottom diamond spanned by the footprint. Art ground outlines (foundations, soil, gravel, paths) must sit within this diamond.
- **Templates:** Base template files with marked ground diamond and anchor cross exist in `assets/buildings-src/templates/<w>x<h>@2x.png`.
- **Output Path:** `assets/buildings-src/<sprite_name>@2x.png`.
- **Compiler:** `node tools/make-building-pngs.mjs <sprite_name>` (generates `1x`, `0.5x` and updates `assets/buildings/manifest.json`).

---

## 3. Dependency Graph & Sequencing

```
PHASE 0: ENGINE & PIPELINE PREREQUISITES
├── TICKET-B0: Ship Building PNGs in Production Build (BLOCKER)
├── TICKET-B2: Quality Downscale Resampling Kernel (Fix Sparkling 0.5x)
└── TICKET-B3: Performance — Tight Alpha Margin Trimming & Cull Pad Recompute

PHASE 1: EXISTING ASSET COMMISSIONING & QUICK WINS
├── TICKET-B1a: Compile & Verify oil_rig (Already authored in buildings-src)
├── TICKET-B1b: Compile & Verify town_house_pool (Already authored in buildings-src)
└── TICKET-B1c: Resolve & Wire town_house_c (The TOWN_HOUSE_VARIANTS pool trap)

PHASE 2: ART GENERATION TICKETS (1950s BLIZZARD STYLE)
├── TICKET-ART-01: Primary Resource Industries (farm, forest, ore_mine, quarry, gold_mine)
├── TICKET-ART-02: Headquarters Processing Plant (factory)
├── TICKET-ART-03: Resource Cargo Depots (6 Outposts: grain, wood, ore, stone, oil, gold)
├── TICKET-ART-04: Town Landmark (town_center church)
├── TICKET-ART-05: Town Houses & Cottages (15 Residential Variants)
├── TICKET-ART-06: Town Commercial Shops & Services (12 Main Street Variants)
├── TICKET-ART-07: Town Urban Apartments & Flats (16 High-Density Variants)
└── [BONUS] TICKET-ART-08: Match-3 Resource Gems (6 Cargo Sprites in src/assets/gems/)

PHASE 3: CLEANUP & AUDIT
└── TICKET-B4: Instrumented Dead-Art Verification and Removal
```

---

## Phase 0: Engine & Pipeline Prerequisites

### TICKET-B0: Ship Building PNGs in Production Build (BLOCKER)
- **Problem:** `loadBuildingLayers()` in `src/iso/atlas.ts` fetches `${BASE_URL}assets/buildings/manifest.json` at runtime. In `vite dev`, this serves from project root. Under `vite build`, `assets/buildings/` is **not copied into `dist/`**. In production / preview, all building layer fetches 404 and silently fall back to the old sprite sheet!
- **Task:** Update `vite.config.ts` with a static copy step (e.g. `vite-plugin-static-copy` or a Rollup `closeBundle` hook) to copy `assets/buildings/**` into `dist/assets/buildings/`.
- **Acceptance:** `npm run build && npm run preview` — verify in Network tab that `/hexmatch/assets/buildings/manifest.json` and `oil_rig@1x.png` return HTTP 200 with zero `[building-layers]` console warnings. Add an assertion in `tests/e2e/`.

### TICKET-B2: Quality Downscale Resampling Kernel
- **Problem:** `tools/make-building-pngs.mjs` derives `1x` and `0.5x` using `kernel: "nearest"`. At 4:1 (0.5x zoom), 15 of every 16 pixels are discarded, breaking thin structures (derrick lattice, railings, window frames) into sparkling noise.
- **Task:** Update `tools/make-building-pngs.mjs` to use `sharp.resize(size, size, { kernel: "lanczos3" })` (or `mitchell`), with premultiplied alpha handling to prevent dark halos on transparent edges.
- **Acceptance:** `oil_rig@0.5x.png` displays clean, continuous lattice lines without sparkling pixel noise.

### TICKET-B3: Tight Alpha Margin Trimming & Dynamic Cull Pad
- **Task B-3.1 (Margin Trimming):** Currently, every building PNG saves the full canvas (e.g. 512² or 384²), drawing thousands of transparent pixels. Update `make-building-pngs.mjs` to compute the tight alpha bounding box (`sharp.trim()`), adjust the `anchor` coordinate relative to the trimmed origin, and store trimmed `w`, `h`, and `anchor` in `manifest.json`.
- **Task B-3.2 (Cull Pad Recomputation):** `IsoRenderer` constructor computes `this.pad = cullPad(atlas)` before `loadBuildingLayers()` mutates sprite sizes. Add `renderer.recomputePad()` called after building layers install so tall buildings do not pop at screen edges.

---

## Phase 1: Existing Asset Commissioning & The Town Pool Trap

### TICKET-B1a: Compile & Verify `oil_rig`
- **File:** `assets/buildings-src/oil_rig@2x.png` (already updated in tree, 384×384 px)
- **Task:** Run `node tools/make-building-pngs.mjs oil_rig` and verify visual alignment in `npm run preview`.

### TICKET-B1b: Compile & Verify `town_house_pool`
- **File:** `assets/buildings-src/town_house_pool@2x.png` (already present in tree, 128×128 px)
- **Task:** Run `node tools/make-building-pngs.mjs town_house_pool`. Since `town_house_pool` is in `TOWN_HOUSE_VARIANTS` in `src/iso/config.ts`, it will render on matching town tiles immediately.

### TICKET-B1c: Resolve & Wire `town_house_c` (The Pool Trap)
- **Problem:** `town_house_c@2x.png` exists in `assets/buildings-src/`, and `town_house_c` is in `assets/iso-atlas/manifest.json`. However, **`town_house_c` is NOT in `TOWN_HOUSE_VARIANTS`** in `src/iso/config.ts`! The game will decode it into memory but never render it.
- **Task:**
  1. Compile with `node tools/make-building-pngs.mjs town_house_c`.
  2. Decide on pool integration:
     - *Option A (Additive):* Append `"town_house_c"` to `TOWN_HOUSE_VARIANTS` in `src/iso/config.ts` (becomes 1 of 44 variants; note: re-rolls town tile spatial hash, update unit tests).
     - *Option B (Replacement Pool):* Shrink `TOWN_HOUSE_VARIANTS` to only point to the new per-building PNGs (`town_house_pool`, `town_house_c`, etc.) as the full replacement migration proceeds.

---

## Phase 2: Art Generation Tickets (1950s Blizzard Style)

### TICKET-ART-01: Primary Resource Industries (5 Missing Nodes)
*Note: `oil_rig` is already in `assets/buildings-src/`.*

#### 1.1 `farm` — 1950s Heartland Grain Farm
- **File:** `assets/buildings-src/farm@2x.png` (512×512 px, footprint **4×4**)
- **Reference:** `farm` in `assets/iso-atlas/groups/02-farm-forest-ore-oil-p1@2x.png`
- **Design Prompt:** 
  > Stylized 1950s American midwestern grain farm, Blizzard RTS hand-painted game art style, 2:1 isometric dimetric perspective. Classic deep red barn with white painted trim, gambrel roof, and open hayloft. Tall cylindrical galvanized corrugated steel grain silo with a conical dome cap. Attached whitewashed farmhouse with stone chimney. Fenced-in golden wheat plot and tractor dirt lane at the base. Chunky, readable geometry, bold stylized painterly textures, warm golden sunlight, rich ambient shadows. Isolated on transparent background, perfectly centered on 4x4 isometric diamond footprint.
- **Silhouette Match:** Barn on right, silo on center-left, farmhouse on left, low fence perimeter.

#### 1.2 `forest` — 1950s Pacific Timber Camp
- **File:** `assets/buildings-src/forest@2x.png` (512×512 px, footprint **4×4**)
- **Reference:** `forest` in `assets/iso-atlas/groups/02-farm-forest-ore-oil-p1@2x.png`
- **Design Prompt:**
  > Stylized 1950s timber and logging camp, Blizzard RTS game art style, 2:1 isometric perspective. Heavy rustic cedar log cabins and a steam-powered lumber mill shed with an iron stovepipe venting white steam. Massive cut redwood/pine logs stacked high on wooden cradles. Tall stylized pine trees framing the rear corner. Woodchip and sawdust ground covering the isometric base. Chunky hand-painted wood grain, warm sun-dappled lighting, bold readability. Transparent background.

#### 1.3 `ore_mine` — 1950s Industrial Ore Pit & Hoist
- **File:** `assets/buildings-src/ore_mine@2x.png` (384×384 px, footprint **3×3**)
- **Reference:** `ore_mine` in `assets/iso-atlas/groups/02-farm-forest-ore-oil-p1@2x.png`
- **Design Prompt:**
  > Stylized 1950s heavy coal and iron ore mine, Blizzard RTS game art style, 2:1 isometric perspective. Imposing dark-painted timber and riveted steel mine headframe (hoist tower) with twin giant spoked pulley wheels at top. Angled enclosed conveyor chute leading down to a corrugated iron ore sorting bin. Small brick motor house with a tin roof. Piles of dark blue-black ore and iron ore slag around the base, with a narrow-gauge mine cart track stub. Chunky silhouette, rich industrial grime, bright copper/steel highlights, transparent background.

#### 1.4 `quarry` — 1950s Open-Pit Stone Quarry
- **File:** `assets/buildings-src/quarry@2x.png` (384×384 px, footprint **3×3**)
- **Reference:** `quarry` in `assets/iso-atlas/groups/03-gold-quarry-p1@2x.png`
- **Design Prompt:**
  > Stylized 1950s granite and limestone quarry processing plant, Blizzard RTS game art style, 2:1 isometric perspective. Heavy-duty timber rock crusher tower with vibrating iron screener chutes. Weathered corrugated tin roof painted faded industrial yellow. Neatly stacked rectangular stone masonry blocks and jagged grey-blue quarry boulders at the base. Stiff wooden derrick boom crane with cable rigging. Bold stylized geometry, chiseled stone textures, dusty ambient lighting, transparent background.

#### 1.5 `gold_mine` — 1950s Boomtown Gold Extraction Facility
- **File:** `assets/buildings-src/gold_mine@2x.png` (512×512 px, footprint **4×4**)
- **Reference:** `gold_mine` in `assets/iso-atlas/groups/03-gold-quarry-p1@2x.png`
- **Design Prompt:**
  > Stylized 1950s gold boomtown stamp mill and shaft entrance, Blizzard RTS game art style, 2:1 isometric perspective. Multilevel wooden stamp mill building built into hillside grade with corrugated tin roof. Wooden water flume/sluice box elevated on timber trestles carrying water into a gold-panning rocker box. Mine tunnel portal framed with heavy squared timber lintels. Piles of golden quartz tailings and wooden crates. Warm golden-hour sunset lighting, rich weathered desert wood, crisp specular highlights on gold flecks, transparent background.

---

### TICKET-ART-02: Headquarters Processing Plant (Factory)

#### 2.1 `factory` — 1950s Industrial Tycoon Factory Complex
- **File:** `assets/buildings-src/factory@2x.png` (384×384 px, footprint **3×3**)
- **Reference:** `factory` in `assets/iso-atlas/groups/04-factories-depots@2x.png`
- **Design Prompt:**
  > Stylized 1950s mid-century manufacturing factory complex, Blizzard RTS game art style, 2:1 isometric perspective. Red clinker brick multi-story industrial building with classic sawtooth factory roof featuring angled glass skylights. Twin tall brick smokestacks billowing stylized puffy white smoke plumes into the sky. Exposed overhead steam pipes with valve gauges connecting buildings. Dark green industrial roll-up bay doors on the ground level with a concrete loading dock. Cast-iron water tower on roof with retro typography. Chunky proportions, warm interior window glow, bold heroic lighting, transparent background.

---

### TICKET-ART-03: Resource Cargo Depots (6 Outposts)
*Footprint: All **1×1** (`128 × 128 px`, anchor `64, 96`)*

- **3.1 `depot_grain`:** 1950s country grain elevator shed, corrugated tin roof, exterior wooden feed sacks and grain hopper.
- **3.2 `depot_wood`:** 1950s timber depot shelter, stacked dimensional lumber, cross-cut saws, chopping stump.
- **3.3 `depot_ore`:** 1950s mining hopper tower, lever-operated iron discharge chute, blue/black ore rocks.
- **3.4 `depot_stone`:** 1950s stone weighbridge booth, green shingle roof, stone blocks stacked on pallets.
- **3.5 `depot_oil`:** 1950s oil pump manifold, cylindrical drum tank, red valve wheels and brass dials.
- **3.6 `depot_gold`:** 1950s fortified gold assay outpost, barred windows, iron-banded door, brass treasure chest.

---

### TICKET-ART-04: Town Landmark (Town Center Church)

#### 4.1 `town_center` — 1950s White Steeple Church & Civic Hall
- **File:** `assets/buildings-src/town_center@2x.png` (128×128 px, footprint **1×1**)
- **Reference:** `town_center` in `assets/iso-atlas/groups/04-factories-depots@2x.png`
- **Design Prompt:**
  > Stylized 1950s traditional white clapboard town church and civic hall, Blizzard RTS game art style, 2:1 isometric perspective. Tall octagonal bell tower steeple topped with a copper weather vane. Arched stained glass windows with soft warm glow, slate blue shingled roof, double wooden entry doors with stone steps. Manicured green lawn border. Heroic, charming Americana aesthetic, transparent background.

---

### TICKET-ART-05 to 07: Town Buildings (43 Variants, 1×1, 128×128 px)
*Reference: `assets/iso-atlas/groups/05-town-p1@2x.png` and `p2@2x.png`*  
*Important: Ensure all target keys are members of `TOWN_HOUSE_VARIANTS` in `src/iso/config.ts`.*

#### Residential Homes & Cottages (15 variants):
`town_small_house_1x1_1`, `town_small_house_arctic_1x1_2`, `town_house_modern`, `town_house_modern_2`, `town_house_pool` *(already in tree)*, `town_house_swiss`, `town_house_arctic_1x1_5`, `town_cottage_old_small`, `town_cottage_old_small_2`, `town_cottage_old_small_a`, `town_cottage_tall`, `town_cottage_arctic_1x1_1`, `town_townhouse_3`, `town_townhouse_garden_2`, `town_townhouse_gardens_2`.

#### Commercial Shops & Services (12 variants):
`town_bank` *(columns & bronze doors)*, `town_cinema` *(neon marquee)*, `town_hotel` *(4-story brick)*, `town_shops_modern` *(corner diner with chrome)*, `town_shops_offices` *(green awning pharmacy)*, `town_shops_offices_2` *(hardware store)*, `town_shop_small` *(barber shop)*, `town_shops_arctic_1x1_2` *(general store)*, `town_offices_1423`, `town_office_1460`, `town_office_tower_modern`, `town_fountain_1x1` *(tiered marble fountain)*.

#### Urban Apartments & Flats (16 variants):
`town_flats` *(brownstone with fire escape)*, `town_flats_2` *(corner flat with deli)*, `town_flats_4` *(tenement with rooftop water tower)*, `town_flats_grey`, `town_flats_townhouse_tall`, `town_small_flat_1x1_1`, `town_small_flat_1x1_2`, `town_flats_arctic_1x1_1`, `town_flats_arctic_1x1_2`, `town_flats_arctic_2x1_1`, `town_flats_arctic_2x1_2`, `town_flats_trop_1x1_4`, `town_flats_trop_1x1_7`, `town_flats_trop_2x1_6`, `town_townhouse_garden_3`, `town_offices_tall`.

---

### [BONUS] TICKET-ART-08: Match-3 Resource Gems (6 Sprites)
- **Path:** `src/assets/gems/<cargo>.png` (128×128 px transparent PNG)
- `grain.png`: Golden wheat sheaf inside a brass cogwheel.
- `wood.png`: Hewn cedar log with an embedded woodsman axe.
- `ore.png`: Metallic hematite fused with lustrous black anthracite coal.
- `stone.png`: Geometric cut granite and marble masonry stones.
- `oil.png`: Deep iridescent oil droplet inside a vintage red drum rim.
- `gold.png`: Stamped gold bullion bar with radiant specular star glints.

---

## Phase 3: Cleanup & Dead Art Removal

### TICKET-B4: Instrumented Dead-Art Verification & Safe Cleanup
- **Principle:** Never delete based on naive string grep — road bitmasks and town sprites are dynamically constructed at runtime.
- **Task:**
  1. Add runtime Set tracking in the draw path on `__iso`.
  2. Run `npm run test:e2e` plus a comprehensive playtest session.
  3. Safe immediate deletions: delete empty `assets/new-atlas/`, and review stray `.patch` files.
  4. Repack atlas with `npm run slice-atlas` after removing verified unreferenced sprites.
