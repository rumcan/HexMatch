# ART-3D — every building, vehicle and train as a real 3D model (#504)

Owner decision (2026-09-27): **redo all buildings, cars and trains as full 3D
models in Meshy**, one style and one scale. The game keeps drawing 2D
isometric sprites. The 3D models (GLB) are the source of truth, and our own
camera renders them into those sprites. A three.js in-game renderer could use
the same GLBs later, unchanged.

## Why 3D solves what painting could not

- **One scale.** Every model sits in metres: a 12 m tile, and a 2.1 m door on
  every building. Painted masters drifted; the pilot's flats master was
  drawn about 1.5× too big for its storeys.
- **One sun.** The renderer lights everything from the same upper-left sun,
  so the SW wall is always the lit one. No more mirrors that flip the light.
- **Real rotations.** `_r` and 4-way vehicle headings are the same model
  turned, not mirrored or redrawn.
- **Free variants later:** night windows (#473), snow, damage and liveries
  from one model.

## Pipeline

| Step | Command | Output |
| --- | --- | --- |
| 1. Model | `node tools/meshy/submit.mjs --env ../hm-hud/.env.local <name>…` | `tools/art-src/meshy/<name>/model.glb`, `thumbnail.png`, `task.json` |
| 2. Choose front | `node tools/meshy/render.mjs <name> --turn all` | `turns.png`, a 4-up sheet with one quarter turn each |
| 3. Render | `node tools/meshy/render.mjs <name> --turn <t>` (and `--r` for the other orientation) | `render_t<t>[_r]@2x.png` on the authoring canvas |
| 4. Compile | copy to `assets/buildings-src/<name>@2x.png`, then `node tools/make-building-pngs.mjs <name>` | `assets/buildings/*` and the manifest |
| 5. QA | `node tools/footprint-check.mjs`, plus an old-vs-new sheet for the owner | |

- `submit.mjs` upscales each master 4× (lanczos) before upload, polls the
  task, and resumes an interrupted run without paying twice. It reads
  `MESHY_API_KEY` from the environment or the `--env` dotenv file. The key
  is never printed, logged or committed.
- `render.mjs` uses a headless Chromium with three.js and an orthographic
  2:1 camera (30° elevation, 45° azimuth), at 7.54 px/m at 2×.
  - Each model is squared to the grid by its minimum-area plan and fitted
    uniformly to its footprint (`--fill`, 0.92 by default).
  - The canvas is the overhang form of `docs/building-layers.md`: the
    diamond is pinned to the bottom, and the anchor is the footprint centre.
    A model too tall for the canvas is reported as CLIPPED.
  - Lighting defaults: a hemisphere ambient of 2.8 and a 1.1 sun from the
    upper left. Meshy bakes shading into its textures, so a strong sun
    darkens them twice.

## Pilot result (2026-09-27)

`town_small_house_1x1_1` (1×1), `town_flats` (2×2) and `factory` (3×3), on
`meshy-6` with a 30k polycount and textures.

- **Style carries over.** Walls, roof slate, doors, fire escapes, sawtooth
  roofs and chimneys all survive. The painted look is not blurred.
- **Scale is now real.** House 7.0 m, flats 18.3 m (4 storeys), factory
  chimneys 17.3 m.
- **Cost is about 77 credits per model, not the 30 in the #504 estimate.**
  The pilot used 230 credits.
- Sheets: `tools/art-src/meshy/pilot.png` (master vs render),
  `tools/art-src/meshy/<name>/turns.png`.

## Scope and budget

| Batch | Models | Notes |
| --- | --- | --- |
| A. Industries | farm, forest, ore_mine, quarry, oil_rig, gold_mine, factory, factory_2x4 | 8 models. The map's most-seen art goes first. |
| B. Depots | depot_1x2, truck_depot and its entrances | 3–6 models. The entrances may be one model with different doors. |
| C. Town | about 40 `town_*` masters, shops, store, terrace | About 40 models. `_r` needs no model of its own. |
| D. Vehicles | truck (red/blue from one model), sedan, pickup, bus, delivery van | 5 models. The cars come from text-to-3D (image generation is paused); they serve #392. |
| E. Railway | loco, tender, box, flat and tank cars, platform, train-depot | 7 models |

About 67 models × 77 credits is **about 5,200 credits, or 6,000–6,500 with
retries.** The account held 51 credits after the pilot, so the batch needs
a top-up first.

Vehicles and train cars use `drawOriginMoving` (anchor under the centre)
and 8 headings. The renderer needs a `--moving` mode for them, with a
heading list and no footprint fit. The fit scales them to a real length:
truck 7 m, car 4.8 m, loco 16 m. Model files are named `veh_<name>`
and `rail_<name>`.

## Storage

The GLBs are the paid-for source: about 5–6 MB each, about 400 MB for the
full set. The repo pack is already 553 MB, so the GLBs stay out of git
(`.gitignore`) and live in the lead's clone (`hm-hud/tools/art-src/meshy/`).
`task.json`, the renders and the sheets are committed.

**Open decision:** long-term, either Git LFS or a
`gltf-transform optimize` pass (meshopt plus 1K webp textures, about 1 MB
per model) to commit them.

## Rules that do not change

- 1950s–60s, Blizzard-style painted look, upper-left sun, door-height scale,
  isolated on transparent (see `docs/ART_PIPELINE.md`).
- The game engine is untouched. Only the sprites change, through the
  existing compile step.
