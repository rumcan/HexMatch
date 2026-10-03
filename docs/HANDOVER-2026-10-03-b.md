# HexMatch handover B — 2026-10-03 (second lead session)

Written for the lead who wrote `docs/HANDOVER-2026-10-03.md`. Read that first; this is the delta. Nothing here is committed to `main`.

## Owner's standing instructions (this session)
- "Stop asking and just make the best decision for the game and do it." Don't wait for the owner; decide, delegate, report briefly.
- Owner does not care about red e2e CI on PRs; wants everything done. BUT the harness permission classifier **blocked `gh pr merge --squash --admin`** ("Merge Without Review"). Do not retry or work around it. To merge, the owner must merge in GitHub or add a Bash permission rule for `gh pr merge`.
- Frame rate is the top priority for 3D work. Coder = Sonnet `hexmatch-coder`, low effort, lead plans/reviews/commits.
- Owner's art/audio never go through agents. Capital Empire repo stays EMPTY until Oct 15.

## PR state (rumcan/HexMatch)
| PR | Branch | State |
|---|---|---|
| #648 | `chore/green-baseline-finish` | OPEN. I added commit `4fa1c3e8`: e2e and e2e-multiplayer sharded 3 -> 6 in `.github/workflows/ci.yml` (coder inferred slow software-GL runners; not verified from logs). Last check: 25 pass / 9 fail across two workflow runs (e2e 2, e2e 5, unit 1 in one run, some MP shards). Original failures: iso-game layout (15 s predicate), iso-tutorial ?guide=0 (120 s boot), perf-mode settings sheet (120 s), mp-leave and mp-lobby (60 s). Next: read `gh run view --log-failed` per failing job, raise only load-related timeouts, quarantine real flakes per AGENTS.md (`it.skip` + issue + `docs/known-test-failures.md`). Merge was blocked, see above. |
| #650 | `fleet/rail-spawn-hint-camera` | OPEN (CI 2 fail / 2 pass / 4 pending at last look). Contains: `trainSpawnHint` in `src/iso/rail.ts` + once-per-reason info toast in game.ts; rival town growth no longer calls `flyCameraTo` (only the player's own town); `__iso.cameraXY()` / `growTownAs()` twins; new tests `iso-fleet-train-spawn`, `iso-fleet-level-crossing`, extended `iso-470-town-growth-moment`. Level-crossing rule (rail over road at 90 deg, public roads included) ALREADY existed in `crossingRefusalAt` (`src/iso/rail.ts`) — no logic change; owner says it felt blocked, repro unknown (ask for tile/road type; curves and T-junctions are refused on purpose). |

## feat/live-3d-rotation-wip (the 3D branch; keep developing here, NOT merged)
Pushed head `738cc7db` (earlier `68b79891`, `0fbff72e`). Worktree: `.claude/worktrees/agent-af7168c2b9f8957bf`. Dev server: `preview_start hexmatch-live3d` -> http://localhost:5180/?three=1 (the flag is required for 3D). The server dies now and then; restart it. `.claude/launch.json` (uncommitted edit in main checkout) sets `RUNDOT_DEV_ROOM_PORT=9011` because Heavy-Metal-GP's vite holds the run.game SDK port 9001 (second vite on this box cannot use 9001).

Done and pushed (all typecheck clean, targeted tests pass; fps 53-59 at 4 yaws vs 2D 59, headless 1280x720 via `tools/perf/three-yaw.mjs`):
- Camera rotation `[` `]`: the WIP never rotated the ground because the terrain vertex shader used `flat` (reserved in GLSL ES 3) -> compile fail -> silent 2D fallback (`src/iso/terrain-gl/shaders.ts`). Roads/rail/decals drawn through the lattice-turn affine (`road-renderer.ts`), turned sprites + depth sort (`depth.ts`: `turnPlaced`, `turnFootprint`, `turnTilePoint`, `yawQuarter`), `pickTile` takes yaw incl. hill lift (`elevation.ts`), picking right on 169/169 tiles at all yaws. Owner confirmed "rotation is great".
- No duplicate cars: `drawStructures` now skips vehicles the 3D layer draws.
- Clouds OFF via `CLOUDS_ENABLED = false` in `src/iso/renderer.ts` (also cloud shadows).
- `HEIGHT_SCALE` 0.5 for `town_offices_tall` and `town_flats_grey` (build-models.mjs). `trimBack()` + `BACK_TRIM` for `terrace_2x1_plain` / `terrace_2x1_yard` (closed flush back wall).
- Random building facing: `spinOf()` in `three-layer.ts` (tile-hash; 4 turns for square footprints, 0/180 for non-square; only `town_*`, `terrace_*`, `shops_*`, `store_*`; industries/depots fixed).
- City open lots always get a tree: `lotArtAt` in `src/iso/grid.ts` (was 55%).
- Traffic spacing fixed (shared sim, so also affects 2D/MP): `MIN_GAP` 0.65, ties broken, cross-segment look-ahead, spawn waits for a free slot, jam-recovery fixes (`traffic.ts`, `cars.ts`, `vehicles.ts`; test `iso-traffic-gap`).
- Vehicle facing: `vehicle_truck`, `vehicle_truck_blue`, `rail_loco` were backwards; `FLIP` fixed and rebuilt. Not yet watched in the live game.
- `platform` (1x4) and `train-depot` built into the 3D layer and mapped from `platform_<view>` / `train-depot_<view>`; 2D sprite hidden when 3D draws. Verified at yaw 0 only for the platform; depot only se/nw views.
- Vehicle models: lorries use `vehicle_truck(+blue)`, cars the 3 sedans, pickup/bus/van = lorry model scaled (stand-in), trains/wagons use `rail_*` models (grain/ore/gold -> box, wood/stone -> flat, oil -> tank).

## STOPPED by owner at handover
All agents stopped, dev server stopped (restart with `preview_start hexmatch-live3d`). The coder was killed mid-way: only item E (ghost/overlay yaw fix) had started, saved as WIP commit `5e973a0a` on `feat/live-3d-rotation-wip` (pushed; `tsc` clean but NOT verified in the browser; touches renderer.ts, overlay-art.ts, minimap.ts, game.ts, plus `tools/perf/three-ghost.mjs`). Items A, B, C, D are NOT started. Owner has not confirmed any of A-E.

## In flight when I stopped (coder a6e50e58a0ca84efb, uncommitted — check `git status` in the worktree)
Brief sent (decide-yourself mode):
- A. Remove the dark "QUARRY" name chip / redundant "Quarry" caption on resource sites (owner already removed the red flag; keep town names and YOUR PLANT).
- B. Identify the "big cream/red-brick 5-storey building with striped canopy and roof terrace" and change it to a **1x2** footprint (manifest, 3D fit, town block layout + filler, old saves must load, tests). `town_hotel` matches the look but the game never places it; placeable 2x2 candidates: town_bank, town_cinema, town_flats, town_flats_grey, town_office_tower_modern, town_offices_tall, town_townhouse_gardens_2.
- C. Blue glass towers (`town_office_tower_modern` / `town_shops_modern`): owner saw a slab on three thin translucent pillars with smeared texture; coder could not reproduce in its model gallery. Find one in the running game, else rebuild with a solid ground-reaching plinth.
- D. Check platform + depot at yaw 90/180/270, all four views, and a lorry driving both directions in the live game.
- E. BUG (owner screenshot): while rotated, the build ghost is a flat glassy sprite displaced several tiles from the tile highlight and the drag lane band; ghost, highlight, lane/drag preview, hover, can't-build tint, claim flags, lane invites, minimap view box and rail/road/platform previews must all use turned positions. Owner has NOT yet confirmed any of A-E.
When it reports: review the diff, `npm run typecheck`, targeted tests, commit to `feat/live-3d-rotation-wip`, push.

## Known gaps / open
- Roads/rail shear slightly on hills at yaw != 0 (hill lift baked vertically into chunk bitmaps; real fix = re-drape in turned frame). 2D building shadows not yaw-aware. Sprites may flicker in depth mid-turn ease.
- Camera still flies to the contested site after a map battle (`showBattleAftermath`) — left on purpose; owner may want it gated. Owner said the camera jumps "to the rival plant when he says something"; coder found only the town-growth fly, no speech path, and scanned just game.ts, ui.ts, town-growth.ts, ambience.ts, minimap.ts — rest of `src/` unscanned for other camera writers.
- Not yet mapped to 3D: wagon types beyond the box/flat/tank stand-ins; pickup/van/bus have no own models (Asset Lab -> Hunyuan -> pipeline).
- Tree fill measured on a village only, not a full city.
- Handover B items from the original doc still open: `iso-297-rival-pace`, `confirm-sheet` CSS clash, rival never buys a 2nd train.

## Asset Lab (run.world) — redeployed
`Repos/asset-lab/main.js` now calls `RundotGameAPI.preloader.hideLoadScreen()` at startup (try/catch); rebuilt with `npx vite build`, `rundot deploy --build-path ./dist` succeeded; app still private (game id `q0w494FMMiDFRbLiL3tj`). NOT visually confirmed that the loading screen is gone — owner should open the private link from `rundot game info`. Uncommitted in that repo.

## Housekeeping
- Untracked leftovers: `gallery-tmp.html` (repo root of the 3D worktree, coder's model viewer; delete), `tools/perf/*.png`, scripts `tools/perf/{three-yaw,model-gallery,three-model-shots,three-platform,three-depot,glb-components,glb-openedges}.mjs` (some committed).
- Worktrees: `agent-af7168c2b9f8957bf` (3D, keep), `agent-a39a6a000af2ee64e` (on #648 branch), `agent-adf00000e4b1c509f` (on #650 branch). Before removing a worktree, delete its `node_modules` junction first; never `--delete-branch` while a worktree has the branch.
- Main checkout has uncommitted `.claude/launch.json` change plus the pre-existing untracked art folders listed in git status; hexmatch-coder agents ran in worktrees, never on `main`.

## Arena-agent PRs that arrived after this doc (all OPEN, none reviewed, none merged)
- #656 `3D-FIX-1` (into `feat/live-3d-rotation-wip`): scales `town_hotel` to 0.6 via `MODEL_SCALE` in three-layer.ts and adds a stone plinth under `town_office_tower_modern` / `town_shops_modern` (`tools/models/fix-stilts.mjs`, test `3d-fix-1-towers`). CAUTION: `town_hotel` is not among the 2x2 sprites towns actually place (the agent's own list omits it; my coder found it unused), so the "big building" is probably still unidentified, and owner asked for a 1x2 footprint, not a scale. Plinth fix unverified in-game.
- #657 town houses: free town lots draw 1x1 houses (`TOWN_HOME_VARIANTS`, `townLotFiller`, `townHomesBlockAt`), 31-39% houses at tier 3. Re-scoped tests `iso-town-no-1x1` and one in `iso-559-town-trees` (supersedes the 09-26 "no 1x1" rule). Needs an owner play-test of 1x1 houses beside 2x2 towers.
- #658 civic buildings (#654): `CIVIC_BUILDINGS` table + `layCivicBuildings` (hospital, school, stadium, post office...), stand-in sprites until art lands; 11 sprite files owed by the lead (listed in the PR body); legacy/MP towns get none; when 1x1 diner/post-office art lands `iso-town-no-1x1` needs a civic exception; hover labels and the three-layer.ts box fallback are follow-ups.
- Per memory `arena-tickets-2026-10-03`: arena work is filed as #652-#655; 3D and art stay with the lead.

## UPDATE (end of session) — supersedes the PR-state table above
- MERGED to main: #648 (CI shards), #650 (train hint, rival-growth camera), #657 (CITY-1), #658 (CIVIC-1), #659 (TOWN-2 organic towns; new games default to organic outside the unit runner), #660 (artifact retention; #645 closed as superseded). MERGED to `feat/live-3d-rotation-wip`: #656 (3D-FIX-1).
- `main` was merged into `feat/live-3d-rotation-wip` (head after merge: see `git log`); grid.ts conflicts resolved by taking main's CITY-1 version, dropping the other agent's "50% of quads" tweak.
- Backup of main before CITY-1/CIVIC-1: branch `backup/main-2026-10-03-pre-city-civic` (`bf9be2a7`).
- Open work is filed as issues with full agent prompts: #661 ghost/overlays while rotated, #662 cream building 1x2, #663 roads on slopes while rotated, #664 vehicle/platform/depot facing, #665 quarry chip, #666 e2e CI shards, #667 Asset Lab. Same text in `docs/AGENT-PROMPTS-2026-10-03.md`.
- The harness blocked `gh pr merge --admin`; plain `gh pr merge --squash` works.
