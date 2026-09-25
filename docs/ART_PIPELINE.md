# HexMatch Industries: Art Pipeline (for AI agents)

How new art gets into HexMatch: where it comes from, how a raw image becomes a
runtime sprite or texture, what the manifests promise, and how to check it.
Written so an agent (e.g. on arena.ai) can take a ticket that needs art —
rivers (#260), bridges (#266), dams (#270), a better ocean and beach, new
buildings — generate the images, process them and ship them in one PR.

**Style identity:** a warm, painterly 1920s–50s industrial tycoon world in
2:1 isometric — weathered brick, concrete and iron, muted olive grass, soft
top-left daylight, no outlines, no pixel art, no text in the art. New art must
sit next to the existing buildings (`assets/buildings/*`), scenery and ground
without looking like it came from a different game.

## 1. Where art comes from

| Source | Use it for | Cost |
| --- | --- | --- |
| **RUN image generation** (`rundot generate image`, Gemini image model) | Anything painted: buildings, dams, bridges, props, trains, ground textures | ~120–150 credits (~13¢) per image |
| **Code** (Python/Node scripts in `tools/`) | Things that must be exact: seamless noise textures, masks, overlays, the vector track and roads | free |
| **Owner-supplied art** (`assets/**/source/`) | Anything the owner draws or hands over | — |

Tested 2026-09-24: a generated **dam** (reference: `assets/buildings/factory@2x.png`)
came back detailed and on-style; a code-drawn dam was flat and unusable. A
generated **ocean** texture was good painterly water but not seamless (the
pipeline fixes that). A code-drawn **beach** (`tools/terrain/make_terrain_art.py`)
matched the grass palette better than the shipped one. Rule of thumb:
**painted objects → generate; tiling ground → generate or code, whichever reads better in game.**

## 2. Setting up the generator (agent sandbox)

```bash
# the RUN CLI must be installed and on PATH
rundot --version
# headless login with a per-game API key the owner creates once:
#   rundot game api-keys create        (owner, on their machine — prints rk_…)
echo "$RUNDOT_API_KEY" | rundot login --api-key-stdin
rundot whoami                          # must show the HexMatch game id j6nEFaCvhcxBfRDBUd5Q
RUNDOT_BETA_FEATURES=1 rundot credits  # balance before you start
```

Run every command from the repo root: the game id is read from
`game.config.prod.json`. Log each generation's `credits.used` in the PR.

## 3. Transparent PNGs — yes, directly

`rundot generate image … --remove-background` returns a **real RGBA PNG**
(tested: the dam came back 43 % fully transparent with soft anti-aliased
edges, 0.6 % semi-transparent fringe). Use it for every sprite.

```bash
rundot generate image --prompt "<prompt>" \
  --reference-image assets/buildings/factory@2x.png \
  --remove-background --remove-background-model birefnet --remove-background-variant heavy \
  --aspect-ratio 1:1 --out tools/art-src/<ticket>/<name>-raw.png --json
```

- `birefnet` + `heavy` is the better matte for fine detail (railings,
  spray); `bria` (default) is faster. Try `bria` first; switch if edges eat detail.
- Background removal can also be run on an existing image:
  `rundot image remove-bg --help`.
- **Fallback: magenta key.** If a removal eats part of the subject (white
  water, glass, steam), regenerate WITHOUT `--remove-background`, asking for
  *"isolated on a flat pure magenta #FF00FF background"*, then key it with
  our own tools (§5.2). The keyer detects the corner colour, despills the
  fringe, and `clean-magenta-fringe.mjs` removes the leftover mauve keyline.
  Never ship a sprite with any magenta left on an edge.
- Ground **textures** are opaque — never remove their background.

## 4. Prompts that work

Always give a **reference image** from the game (up to 10 with repeated
`--reference-image`) and say "in exactly the same painterly style, lighting
and scale as the reference". Good references:

| Making | Reference |
| --- | --- |
| buildings, dams, bridges, industrial props | `assets/buildings/factory@2x.png`, `assets/buildings/ore_mine@2x.png` |
| farm / nature props | `assets/buildings/farm@2x.png`, `assets/scenery/forest_mixed@2x.webp` |
| ground textures | `assets/ground/grass.png` |
| rail things | `assets/railway/platform_se@2x.png`, `assets/railway/car-loco_se@2x.png` |

**Sprite prompt template**

> Isometric 2:1 game sprite of **<subject>**, **<materials, era, details>**,
> painted in exactly the same detailed painterly style, lighting and scale as
> the reference building, viewed from the south-east at the same isometric
> angle, the object only — **no ground block, no terrain base, no diorama
> cut-away, no shadow plate**, isolated on a plain white background, no text,
> no border.

The "no ground block / no diorama" line matters: without it the model paints
the object on a slab of cut-away earth (the first dam test did).

**Texture prompt template**

> Seamless tileable top-down texture of **<surface>** for an isometric tycoon
> strategy game, **<colour words>**, painterly hand-painted style matching the
> reference grass texture, orthographic straight-down view, no horizon, no
> perspective, no objects, even lighting, fills the whole square.

Palette anchors (sampled from the shipped art): grass mean `#354312`;
the old sand `#dea757` reads too orange next to it — aim for a muted beige
around `#cdbb95`; sea around `#1b5f72` with lighter caps `#3f8c94`.

**Headings.** The game needs a sprite per view it can be seen from:
- symmetric footprints (dams, bridges, straight things): generate ONE view and
  mirror it (`ImageOps.mirror`) for the other axis — see §5.3;
- things with a front (a building entrance): 4 views, or 2 + mirrors. Ask
  for "viewed from the south-west" for the other side.

## 5. From raw image to runtime asset

All processing lives in `tools/`. Raw generations go in
`tools/art-src/<ticket-or-topic>/` (committed, so the result is rebuildable);
runtime files go under `assets/`.

### 5.1 Geometry every sprite must meet

- Tiles are **64×32 px at 1×** (2:1). Sprites are authored at **2×** and
  shipped at `@2x`, `@1x` and `@0.5x` (`tools/make-detail-tiers.mjs` does the
  ground; each sprite script writes its own three sizes).
- A static sprite is placed by its **anchor**: the pixel that lands on the
  **SOUTH vertex** of its footprint (`src/iso/depth.ts` `drawOrigin`). The
  footprint `[w, h]` is in tiles (`w` along grid x = screen down-right,
  `h` along grid y = screen down-left).
- Moving sprites (vehicles, train cars) anchor on the ground point under
  their centre (`drawOriginMoving`).
- The art's base edges must run at the game's angle: **dy/dx = ±0.5**. AI
  art is usually flatter (0.2–0.35). Straighten it with a vertical shear
  (keeps uprights vertical) — `tools/railway/cut_platform.py` and
  `tools/railway/cut_train.py` (`square_to_track`) do exactly this: measure
  the base/wheel line, shear to 0.5, scale the long edge to the footprint.

### 5.2 Buildings (and anything that sits on a footprint)

Declare the sprite in `assets/buildings-src/footprints.json` first — a
rectangle's name is `<w>x<h>` with `w` along grid x and `h` along grid y, so
art whose LONG side runs isometrically lower-left → upper-right is `1x2`,
`1x3`, `2x4` (and its `_r` mirror `2x1`, `3x1`, `4x2`). Nothing else can tell
the compiler what canvas a 1×3 and a 2×2 (both 256²) mean.

```bash
# 1a. art that already sits on the game's angle: fit it by its alpha box
node tools/fit-building-art.mjs <sprite-name> tools/art-src/<t>/<name>-raw.png
# 1b. art drawn flatter than 2:1 (most AI art): measure the base, shear it
#     onto the footprint diamond, declare the foot room it reports
node tools/normalize-building-art.mjs <sprite-name> tools/art-src/<t>/<name>-raw.png
#     …and the other orientation, if the lighting allows it (see below)
node tools/normalize-building-art.mjs <sprite-name> tools/art-src/<t>/<name>-raw.png --mirror
# 2. only if it was magenta-keyed: remove the mauve keyline
node tools/clean-magenta-fringe.mjs <sprite-name>
# 3. build the runtime PNGs + manifest (assets/buildings/)
node tools/make-building-pngs.mjs <sprite-name>
# 4. check the base sits inside its footprint diamond (also reviews the F5 set)
node tools/footprint-check.mjs
# 5. eyeball the parcel against its template guide + the scale figure
node tools/overlay-building-template.mjs <sprite-name>
```

`normalize-building-art.mjs` reports what it measured and what it could not
fix (see its header): `edgeOffset2x` is how far each front edge misses its
diamond edge; `cornerError2x` is where the drawing's own plan proportions
cannot match the declaration (the shear fixes angles, not proportions);
`planRatio` compares the two. A `planRatio` off by more than ~1.5× means the
art is drawn for the other orientation — declare that one.

**Lighting:** the world's light is upper-LEFT — every shipped master has a
lighter south-west wall than south-east (ratio 1.2–1.8). Check a mirror with
`node tools/normalize-building-art.mjs --lighting-check <file>` before shipping
it; a mirror that flips the light reads as a second sun next to the first
(which is why trees are never mirrored). A raw drawing that itself comes back
lit from the right (`shops_1x3`, 2026-09) is the one case to call out in the PR
rather than hide: its `_r` mirror is the one on the house convention.

Details of the authoring canvas and anchor: `docs/building-layers.md`,
`assets/buildings-src/README.md`, templates in `assets/buildings-src/templates/`
(`node tools/make-building-pngs.mjs --templates`).

### 5.3 Structures with their own manifest (rail, rivers, dams, bridges)

Rail structures and cars have their own folder + manifest
(`assets/railway/manifest.json`, loaded by `src/iso/rail-art.ts`). New
families (rivers, dams, bridges) follow the same shape:
`assets/<family>/<name>@{2x,1x,0.5x}.png` + `assets/<family>/manifest.json`
with `{ w, h, anchor: [x, y] (1×), footprint: [w, h], moving }`, and a small
`<family>-art.ts` loader modelled on `rail-art.ts` (static imports via
`import.meta.glob`, install into `atlas.buildingImages`, non-gating: a
missing file falls back to vector drawing).

Write one Python cutter per family in `tools/<family>/` (see
`tools/railway/cut_platform.py` for a complete example: shear to 2:1, fit to
footprint, anchor on the south vertex, mirror for the other axis, write the
three sizes and the manifest). Keep it re-runnable.

### 5.4 Ground textures

- **Generated:** save the raw image as `tools/texture-src/<name>-src.png`,
  then `node tools/make-ground-textures.mjs <name>` — it makes the texture
  seamless (offset-roll cross-fade, no mirror echo), writes
  `assets/ground/<name>.png` (512²) and the medium/low tiers.
- **Code-drawn:** `python tools/terrain/make_terrain_art.py [water sand river dam]`
  — band-limited periodic noise, seamless by construction; writes the same
  outputs. Tune colours/frequencies at the top of each `make_*` function.
- The game loads `grass`, `sand`, `water` today (`src/iso/ground-art.ts`).
  A new surface (e.g. `river`) needs a line there and a paint pass in
  `src/iso/ground.ts`.

## 6. Checking the result

1. **Contact sheet** — tile every texture 2×2 (a seam shows as a cross) and
   put every sprite on grass and on its footprint diamond.
   `tools/terrain/preview.png` is one; `tools/footprint-check.mjs` for buildings.
2. **Alpha audit** — no opaque background left, no magenta/white fringe:
   the corners of every sprite must be `alpha 0`; run
   `node tools/clean-magenta-fringe.mjs` on anything that was keyed.
3. **In game** — `npm run dev`, then look at the thing at zoom 1× and 2×,
   next to existing buildings, on the angle it will be seen from. Screenshot
   before/after into the PR. The dev server's `?fresh=1` starts a clean game;
   `window.__iso` has hooks (`placePlatform`, `railDrag`, `centerOn`,
   `setTool`, …) to set a scene up fast.
4. **Tests** — `npm run typecheck && npm test` (art manifests are pinned by
   `tests/unit/iso-rail-art.test.ts` and friends; update the pins when a
   size or anchor changes, never loosen an unrelated test).

## 7. Ticket recipes

| Ticket | Art needed | Route |
| --- | --- | --- |
| Ocean & beach refresh | new `water` (sea) and `sand` textures | sea: generate (§4 texture) → `make-ground-textures`; beach: `make_terrain_art.py sand` or generate. Compare both in game, keep the better. |
| #260 Rivers | `river` texture (flows along one axis; the renderer rotates it for the other), bank/shore edge treatment | texture: generate or `make_terrain_art.py river`; banks can reuse the coast's foam/shallow bands in `ground.ts` |
| #270 Dams | `dam_x` / `dam_y` sprites, footprint 1×2 / 2×1 across the river | generate ONE view with the sprite template ("small concrete gravity dam with a gatehouse and a central spillway, white water, no ground block") + `--remove-background`, shear to 2:1, mirror for the other axis, `assets/rivers/manifest.json` |
| #266 Bridges | road bridge + rail bridge, straight, both axes; piers | generate one view each, mirror; the deck must line up with the vector road/rail width (`ROAD_WIDTH`, `RAIL_GAUGE`) — check in game |
| New buildings | per `docs/building-layers.md` | §5.2 |

## 8. Rules for agents

- Put every raw generation you ship in `tools/art-src/`, and the exact prompt
  + model + seed (from `--json`) in the PR description, so it can be redone.
- Don't overwrite shipped art without a before/after screenshot in the PR.
- Spend: stop and ask if a ticket needs more than ~40 generations.
- No logos, brand names, real company names, text or UI in the images.
- One ticket per PR; the art and the code that uses it land together.
