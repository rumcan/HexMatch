# AI Codex Prompt Guide: 1950s Blizzard-Style Building Redo

**Document Purpose:** Master instruction and prompt engineering template for an AI agent tasked with **re-generating all in-game building art assets** for the second ART-1950S pass (the first pass shipped in PR #80 and failed the review below).
**Target Repository:** `HexMatch` (`assets/buildings-src/` → `assets/buildings/`)
**Companion Tools:** [`tools/fit-building-art.mjs`](../tools/fit-building-art.mjs), [`tools/make-building-pngs.mjs`](../tools/make-building-pngs.mjs), [`tools/clean-magenta-fringe.mjs`](../tools/clean-magenta-fringe.mjs), [`tools/overlay-building-template.mjs`](../tools/overlay-building-template.mjs), [`tools/audit-raw-art.mjs`](../tools/audit-raw-art.mjs), [`tools/make-ref-cells.mjs`](../tools/make-ref-cells.mjs)

---

## 1. Context: Why the Previous Round Failed

In the previous image generation pass, the buildings suffered from three critical defects:

1. **Broken Physical Scale Hierarchy:** A 1-room residential cottage was drawn filling the entire canvas, making it appear as massive as a 4-story commercial building or heavy industrial factory. When placed on the game map, residential doors were 3× larger than commercial doors, and human scale was completely inconsistent.
2. **Missing Grounds & Holdings on 1×1 Parcels:** To fit a 1×1 tile diamond naturally without blowing up the structure, a small house **must not** fill the diamond with walls alone. It needs surrounding property: fenced yards, vegetable gardens, small holdings, gravel paths, stone walls, and coops/sheds.
3. **Environmental Inconsistencies & Fringing:** Several sprites had snow/ice on roofs (inherited from OpenGFX "arctic" filenames), inconsistent lighting angles, and soft backgrounds that broke chroma-keying.

This guide provides the exact prompts, scaling rules, viewing angles, and automated pipeline steps to achieve 100% visual consistency.

---

## 2. Core Technical & Visual Directives

### 2.1 Uniform Human Scale Across All Buildings
All buildings share a single, unified miniature scale at **2× resolution**:
- **Human figure reference:** ~10–14 px tall.
- **Standard doorway:** ~16–20 px tall, ~8–10 px wide.
- **Single building story / floor:** ~24–32 px tall.
- **Window:** ~8–12 px tall.

### 2.2 Footprint Parcel Hierarchy

| Footprint | Parcel Diamond Span (@2x) | Building Mass vs. Parcel Grounds Strategy |
| :--- | :--- | :--- |
| **1×1 Small Houses / Cottages** | 128 px wide × 64 px tall | **Structure occupies 35–55% of the diamond.** The remaining parcel is filled with detailed grounds: white picket fences, small vegetable plots, stone wells, front flowerbeds, gravel driveways, wooden sheds, and clotheslines. |
| **1×1 Townhouses / Flats** | 128 px wide × 64 px tall | **Structure occupies 60–75% of the diamond**, rising 2–3 stories tall. Small front stoop, paved rear courtyard/patio with brick walls. |
| **1×1 Commercial / Civic** | 128 px wide × 64 px tall | **Structure occupies 75–90% of the diamond**, rising 2–4 stories tall. Concrete sidewalk perimeter, store awnings, commercial signage. |
| **1×1 Cargo Depots** | 128 px wide × 64 px tall | **Small central shed/hopper (40–60 px wide)** surrounded by cargo pallets, barrels, cranes, and gravel yard. |
| **3×3 Heavy Industry (`factory`, etc.)** | 384 px wide × 192 px tall | **Large multi-structure complex.** Main factory halls, smokestacks, overhead pipes, loading bays. Doorways and windows remain at the exact same 16–20 px scale! |
| **4×4 Rural Complex (`farm`, etc.)** | 512 px wide × 256 px tall | **Expansive agrarian/mining layout.** Barns, silos, farmhouse, dirt lanes, fenced paddocks, wheat fields. |

### 2.3 Viewing Angle & Projection
- **Projection:** Strict **2:1 dimetric isometric** (classic game isometric, ~26.565° pitch angle, 30° grid angle).
- **Orthographic:** Absolutely **no perspective vanishing point** (parallel ground lines never converge). No fish-eye, wide-angle, or tilt-shift blur.
- **Orientation:** Front facades face **South-East or South-West** towards the viewer. Ground edges align with 2:1 isometric diamond axes (2 px horizontal for every 1 px vertical).

### 2.4 Lighting & Weather
- **Light Direction:** Crisp warm sunlight arriving strictly from the **Top-Left (North-West) at a 45° elevation angle**.
- **Shadows:** Soft directional contact shadows falling toward the **Bottom-Right (South-East)**, staying within the ground footprint.
- **STRICTLY NO SNOW:** All buildings must be warm, sunny, temperate/subtropical Americana. **Zero snow, zero frost, zero icicles**, even on buildings with `"arctic"` in their sprite key (e.g. `town_small_house_arctic_1x1_2`).

### 2.5 Pure Chroma-Key Magenta Background (`#FF00FF`)
- Background **must be 100% solid, flat, unshaded pure magenta:** `#FF00FF` (`RGB: 255, 0, 255`).
- **Zero color bleeding:** No magenta reflections on glass, chrome, or roof tiles.
- **Zero magenta rim lighting or shadows:** The building must be lit by warm white/yellow sunlight, never magenta.
- Sharp, clean anti-aliasing against the magenta so that `tools/fit-building-art.mjs` can cleanly extract alpha.

### 2.6 Visual Aesthetic: 1950s Blizzard RTS Style
- **Aesthetic:** 1950s Mid-Century Americana / Retro-Industrial Tycoon (red clinker brick, weathered timber, corrugated galvanized tin, streamline moderne curves, chrome trim, retro signage).
- **Style:** Blizzard RTS hand-painted stylized realism (Warcraft 3 / StarCraft inspired):
  - Chunky, solid, readable forms.
  - Exaggerated edge bevels and crisp warm specular highlights.
  - Deep purple-navy ambient occlusion in crevices.
  - High micro-contrast and readability when zoomed out.

---

## 3. The Master Prompt Template

When generating building art, use this structured prompt:

```text
[AESTHETIC & PERSPECTIVE]
Stylized 1950s retro-industrial Americana architecture, Blizzard RTS game asset style (Warcraft 3 / StarCraft inspired hand-painted stylized realism). True orthographic 2:1 dimetric isometric projection (no perspective convergence, parallel isometric lines).

[SUBJECT & HUMAN SCALE]
A [Building Archetype / Name] built to strict miniature human scale (doors are small, approximately 1/6th of a single-story height). [Detailed description of the structure].

[FOOTPRINT & PARCEL GROUNDS]
The structure is situated on a [1x1 / 3x3 / 4x4] isometric parcel:
- For small houses: The house occupies only 40% of the ground diamond, surrounded by a charming smallholding with white picket fences, a vegetable garden, stone pathway, and a small backyard wooden shed.
- For commercial: The building covers 80% of the ground diamond with paved concrete sidewalk frontage.
- For industrial: Multi-wing facility with loading yards, storage tanks, and pipe manifolds.

[MATERIALS & DETAILS]
1950s post-war materials: [e.g. red clinker brick, weathered cedar siding, galvanized corrugated tin roof, brushed chrome trim, vintage hand-painted sign]. Chunky geometry, bold readable bevels, hand-painted textures with micro-wear. Warm interior window glow. STRICTLY NO SNOW, NO ICE, NO WINTER WEATHER.

[LIGHTING & CAMERA]
Lit by warm direct sunlight from the top-left (North-West) at 45 degrees elevation, casting soft contact shadows toward the bottom-right. Crisp specular highlights on metal edges, deep ambient occlusion under eaves.

[BACKGROUND & ISOLATION]
Isolated on a completely solid, uniform, unshaded pure magenta (#FF00FF) background. Zero magenta color cast, zero magenta rim light on the building edges. Sharp, clean object silhouette.
```

### 3.1 Hardening clauses added after the first redo batch

These phrasings measurably fixed recurring generation habits and should stay in every prompt:

- **Diamond angle:** `true 2:1 dimetric isometric projection (ground edges along the 2:1 diamond axes, NOT steeper true-isometric), no perspective convergence`
  — without it the model returns 30° "true isometric" diamonds that the fit tool cannot correct.
- **Shadow side:** `Sunlight from the top-left corner of the image: left faces brightly sunlit, right faces shaded, contact shadows toward the bottom-right`
  — naming the *image corner* beats naming the compass direction.
- **Chroma safety:** `Isolated on solid pure magenta (#FF00FF) background, zero magenta or pink bounce light on silhouette edges`.
- **Fence/prop containment:** `all fences and fields kept INSIDE the parcel diamond boundary`
  — otherwise fences overshoot the tile and bleed onto neighbours' terrain.
- **Subdivision as the scale cue:** state an explicit window rhythm (`a dense grid of five small windows per floor`) and an explicit door fraction (`about one-sixth of the facade width`). Buildings with few, large windows read as huts blown up to parcel size — the defect that made apartment doors barn-sized next to cottage doors.
- **Silhouette ratio:** state `CLEARLY TALLER THAN WIDE` / `long and LOW, wider than tall` where the OpenGFX reference cell has that proportion.

---

## 4. Specific Exemplar Prompts by Category

### Exemplar A: Small Residential Cottage (1×1 Parcel) — solves the "giant cottage" scale bug
**Sprite:** `town_small_house_1x1_1`
> Stylized 1950s American suburban small cottage, Blizzard RTS hand-painted game art style, true 2:1 dimetric isometric projection without perspective distortion. Built to accurate human miniature scale: the single-story cottage is compact (occupying only 40% of the 1x1 isometric diamond parcel), featuring pastel cream clapboard siding, a brick chimney with gentle smoke, dark slate pitched roof, and small double-hung windows. The remaining 60% of the isometric parcel is a detailed country smallholding: a neat white picket fence with a gate, a gravel garden path, a small vegetable garden plot with green lettuce heads, a blooming flowerbed, and a tiny wooden tool shed in the corner. Clear warm sunny weather, STRICTLY NO SNOW. Warm top-left sunlight casting subtle contact shadows to the bottom-right. Isolated on solid pure magenta (#FF00FF) background with zero magenta color bleed.

### Exemplar B: Commercial Main Street Shop (1×1 Parcel)
**Sprite:** `town_shops_modern` (1950s corner diner)
> Stylized 1950s roadside diner and soda shop, Blizzard RTS hand-painted game art style, true 2:1 dimetric isometric projection. Compact two-story commercial building occupying 80% of the 1x1 isometric diamond parcel. Rounded streamline moderne curved glass corner, gleaming stainless steel chrome band accents, bright turquoise and cream porcelain enamel paneling, and a glowing neon script rooftop sign reading "DINER". Paved light-grey concrete sidewalk wrapping the ground perimeter with a vintage red fire hydrant on the curb. Clear sunny summer day, zero snow. Warm directional top-left sunlight, deep occlusion shadows, crisp specular reflections. Isolated on solid pure magenta (#FF00FF) background.

### Exemplar C: Multi-Story Urban Tenement (1×1 Parcel)
**Sprite:** `town_flats` (brownstone apartments)
> Stylized 1950s 3-story urban brownstone apartment building, Blizzard RTS hand-painted game art style, true 2:1 dimetric isometric projection. Tall and narrow structure occupying 75% of the 1x1 isometric diamond parcel. Weathered red clinker brick facade, ornate stone lintels above windows, green copper oxidized roof cornice, and an authentic black cast-iron fire escape zigzagging down the side facade. Front stone entrance stoop with iron railings leading to a double wooden entry door. Miniature scale with small windows and human-scaled steps. Warm sunny weather, zero snow. Top-left 45-degree sunlight. Isolated on solid pure magenta (#FF00FF) background.

### Exemplar D: Primary Resource Industry (4×4 Parcel)
**Sprite:** `farm` (heartland grain farm)
> Stylized 1950s American heartland agricultural grain farm complex, Blizzard RTS game art style, true 2:1 dimetric isometric projection. Expansive 4x4 parcel layout: large traditional red dairy barn with white trim, gambrel roof, and hayloft door; tall cylindrical galvanized corrugated steel grain silo with silver domed top; adjacent whitewashed two-story farmhouse with red shingle roof; open fenced dirt lane with tractor tire tracks leading to golden wheat field patch with hay sheaves. Tiny human-scale doors and windows. Saturated Kodachrome palette, warm golden sunlight from top-left, rich ambient shadows. Zero snow. Isolated on solid pure magenta (#FF00FF) background.

### Exemplar E: Heavy Industrial Factory (3×3 Parcel)
**Sprite:** `factory` (processing plant)
> Stylized 1950s heavy industrial factory and manufacturing plant, Blizzard RTS game art style, true 2:1 dimetric isometric projection. Massive multi-wing brick industrial complex situated on a 3x3 isometric parcel. Classic sawtooth roofline with angled glass skylight banks, twin towering red brick smokestacks emitting stylized white smoke clouds, exterior elevated steam pipes with brass pressure dials, and dark green roll-up cargo bay doors on a concrete loading dock. Miniature human-scale doors and stairs. Industrial grime with warm interior window glow, bright metallic edge highlights. Warm top-left sunlight. Zero snow. Isolated on solid pure magenta (#FF00FF) background.

---

## 5. Automated Execution Pipeline for the Agent

```bash
# 0. Reference cells for prompt conditioning (prints exact silhouette ratios):
node tools/make-ref-cells.mjs --out /tmp/refs.png <sprite...>

# 1. Fit and key the raw art into the authoring canvas (assets/buildings-src/<name>@2x.png)
#    --scale-mult N nudges size when the silhouette box is inflated by fences/junk.
node tools/fit-building-art.mjs <sprite_name> path/to/raw_art.png [--scale-mult 0.95]

# 2. Kill magenta keyline residue the keyer's distance bands left behind:
node tools/clean-magenta-fringe.mjs <sprite_name>

# 3. Compile the 2x master into the game engine assets (1x, 0.5x downscales + manifest.json):
node tools/make-building-pngs.mjs <sprite_name>

# 4. Verify the parcel sits on the footprint diamond (angle + size + centring):
node tools/overlay-building-template.mjs <sprite_name> --out /tmp/template-overlay-<batch>.png

# 5. Verify the build in preview mode (testing production asset resolution):
npm run build
npm run preview
```

### Optional pre-fit audit
```bash
# slope of the raw parcel edges: |dy/dx| ~= 0.5 is the 2:1 family; >= 0.65 is squished
node tools/audit-raw-art.mjs /tmp/raw-art/<name>.png
```

### Hard-won operational notes
- **Overwrite guard:** `overlay-building-template.mjs` refuses an `--out` that already
  exists unless the filename contains `template-overlay`. A previous session passed a
  raw-art path as `--out` and silently destroyed nine freshly generated raws; keep the
  guard and always pass a distinct `/tmp/template-overlay-*.png` path.
- **Never rescale the template to the master canvas.** On overhang canvases
  (W > (w+h)×64) the diamond stays (w+h)×64 wide. Scaling it fakes "undersized
  parcel" readings — that bug caused a whole round of false conclusions.
- **Back up raws** to `/tmp/raw-art/bak/` immediately after generation.
- **Wide/tall raws can arrive in swapped order** from batch generation; the fitted
  dimensions (not the file name) are the authority on which sprite a file is.
