# Asset Lab notes (AL-1, #667) — 2026-10-03

Status written by the arena agent session for `arena/01a10386-hexmatch`
(#665 + #667). Everything below is what could and could not be done from
this sandbox, and the next step for each vehicle image.

## What Asset Lab is

A **private** run.world app (game id `q0w494FMMiDFRbLiL3tj`), living in a
separate local-only repo `Repos/asset-lab` (NOT this repo). It generates the
missing vehicle source images through `RundotGameAPI.imageGen` (Gemini),
using the existing game art as style references (the STYLE / NEG prompt
strings are in `Repos/asset-lab/main.js`).

## Loading screen — NOT confirmed here

The 2026-10-03 fix (`main.js` calls
`RundotGameAPI.preloader.hideLoadScreen()` at start, try/catch; rebuilt with
`npx vite build`; deployed with `rundot deploy --build-path ./dist`) was made
on the lead's box and is recorded in `docs/HANDOVER-2026-10-03-b.md`.

This sandbox **cannot confirm it visually**:

- there is no `Repos/asset-lab` checkout here (verified: no such directory
  anywhere in the sandbox);
- there is no `rundot` CLI on PATH;
- `imageGen` needs the run.world backend, so it does not work on a local dev
  server;
- the app is private and the ticket forbids making it public, creating
  accounts, or entering any credentials — none were touched.

**Lead check:** open the private link from `rundot game info` run inside
`Repos/asset-lab`; the loading screen must be gone and the 8 presets must
render.

## The 8 presets — none produced here, with the reason per preset

`car_pickup`, `car_bus`, `car_van`, `wagon_grain`, `wagon_wood`,
`wagon_ore`, `wagon_stone`, `wagon_gold`.

Reason (same for all eight): generating them requires the **deployed private
app** (backend imageGen) on the deployed private link, i.e. the owner/lead's
browser and approval. This sandbox has neither the app repo, the rundot CLI,
the private link, nor credentials, and the ticket's DO-NOT list forbids
acquiring any of those. So every image is still owed; nothing was generated,
downloaded, or committed.

When the lead runs them: each result must be ONE whole vehicle, isometric
three-quarter view, flat white background, in the game's 1950s hand-painted
palette; regenerate (change seed / tweak prompt) up to 3 times per preset and
keep the best. Downloads go to `tools/art-src/hunyuan/<preset-id>.png` —
note: that folder does **not** exist in this checkout (checked `main` and
`feat/live-3d-rotation-wip` via `git ls-tree`; it exists untracked on the
lead's box). The images must NOT be committed to git.

## Current stand-ins (what the 3D layer draws today)

From `src/iso/three-layer.ts` on `feat/live-3d-rotation-wip` (the 3D layer is
not on `main`):

- `pickup` → `car_sedan_3` (a sedan stand-in);
- `bus` → `vehicle_truck`, lengthM 9; `van` → `vehicle_truck`, lengthM 5.5;
- wagons via `WAGON_KIND`: grain/ore/gold → `rail_box`, wood/stone →
  `rail_flat`, oil → `rail_tank`.

So every preset above currently wears a stand-in model in `?three=1`.

## Next step per image (once a PNG is accepted)

1. Hunyuan image-to-3D on the GPU box — **only if the owner says the GPU box
   is up** (this agent did not run Hunyuan).
2. Run `tools/models/build-models.mjs` (lives on
   `feat/live-3d-rotation-wip`, not on `main`) to build the `.glb` into
   `public/models/`.
3. Add/replace the `VEHICLE_MODEL` mapping entry in
   `src/iso/three-layer.ts` (`CAR_MODEL_OF` / `WAGON_KIND` tables) so the new
   model is picked instead of the stand-in, then watch it live at all four
   yaws.

## Which presets may need hand art

Unknowable until the presets are actually run on the deployed app — the
ticket's rule is: if a preset is consistently bad after 3 regenerations, edit
its prompt in `Repos/asset-lab/main.js`, rebuild + redeploy, and record the
change; if it is still bad, it needs hand art from the lead. Candidate
trouble spots to watch, based on the stand-ins: `car_bus` and `car_van`
(long/van bodies the lorry model fakes today) and the loaded wagon variants.

## Housekeeping

- Nothing was made public; no credentials or tokens were touched or written.
- Nothing over 5 MB is committed with this change (this doc only; the #665
  code change is source-only).
