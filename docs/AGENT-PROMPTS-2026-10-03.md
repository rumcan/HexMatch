# Agent prompts - 2026-10-03 (lead handover)

Each section is ONE complete, paste-ready prompt. Agents start on a preset arena branch and rebase it on the base branch named in the prompt. These are not GitHub issues: the TICKET block is the spec. The lead merges; agents never do. Prompts that touch 3D use base `feat/live-3d-rotation-wip`; the rest use `main`.

---

## 3D-FIX-2 - 3D-FIX-2: build ghost and overlays break when the camera is rotated

```text
You are working on HexMatch Industries (repo rumcan/HexMatch), an isometric
transport-tycoon + match-3 game (TypeScript, Vite, canvas). You do ONE ticket:
3D-FIX-2 — "3D-FIX-2: build ghost and overlays break when the camera is rotated". The TICKET block at the end of this prompt is the spec
(there is no GitHub issue to read). Where it and an OLDER ticket or doc
disagree, this ticket wins.

READ FIRST: AGENTS.md, docs/AGENT_PLAYBOOK.md (sections 2 and 3 are binding),
docs/HANDOVER-2026-10-03.md and docs/HANDOVER-2026-10-03-b.md (current state,
known gaps), then the TICKET below in full, then the files it names.

SETUP
  Your arena session starts on a PRESET branch name. Keep that branch name and
  REBASE it on the base branch named in THE WORK:
    git fetch origin && git rebase origin/feat/live-3d-rotation-wip
  then npm ci. If the rebase conflicts, keep BOTH sides of any conflict unless
  one side is plainly superseded, and say what you chose in the PR.
  Never force-push over commits you did not write.

TESTING — BINDING (docs/AGENT_PLAYBOOK.md §2)
  • NEVER run: npm test, npm run test:all, npm run test:slow, npm run test:e2e*,
    npx playwright, or vitest with no file arguments. The lead runs those.
  • Run ONLY the test files named below plus any test file you add, ALWAYS in
    the background, and poll the log:
      (npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo EXIT $? >> /tmp/t.log) &
      ... keep working ... then: tail -30 /tmp/t.log
  • Typecheck in the background the same way (~45 s), BOTH configs:
      (npx tsc --noEmit -p . > /tmp/tsc.log 2>&1; npx tsc --noEmit -p tsconfig.e2e.json >> /tmp/tsc.log 2>&1; echo EXIT $? >> /tmp/tsc.log) &
  • Known failures/flakes: some e2e specs time out on slow CI runners and
    `mp-battle` B6 is quarantined; the long simulations are in test:slow.
    Anything else in your files is yours to fix. Never loosen or skip a test you
    did not write. Do not edit docs/BALANCE.md (it is generated).
  • Never run tests/unit/iso-game.test.ts, iso-ai-sweep, iso-rebalance,
    battle-ai-sim or match3-balance-bot.
  • If one test run takes more than 5 minutes, kill it, note it in the PR, move on.
  • Don't install browsers or start a dev server to verify: write browser
    checks in the PR as "for the lead to play-test" (give exact steps: URL with
    ?three=1 where relevant, keys, __iso twins to call, what to look at).

DELIVER
  • Commit in small steps. Rebase on origin/feat/live-3d-rotation-wip again before opening the PR.
  • PR base branch: feat/live-3d-rotation-wip. PR title "3D-FIX-2: build ghost and overlays break when the camera is rotated", body starts with
    "Ref 3D-FIX-2" (there is no issue to close).
  • PR body: what changed, each acceptance box with HOW you checked it, the exact
    test files you ran and their result, what you could NOT verify (the lead
    play-tests), follow-ups you noticed but did not do.
  • Do not merge. Do not deploy. Do not push to main.
  • If "gh pr create" says a PR already exists for your branch, STOP and tell
    the owner. Never push onto someone else's PR or force-push over commits you
    did not write.
  • Stay inside the areas this ticket names (src/iso/renderer.ts, src/iso/overlay-art.ts, src/iso/minimap.ts, src/iso/game.ts (ghost/preview/overlay code only), src/iso/depth.ts, tools/perf/three-ghost.mjs, tests/unit); if it needs more, say so
    in the PR.
  • Do NOT generate, edit or re-export any image, 3D model or audio. The lead
    does all art and audio (placeholders are fine; list the file names you need).
    Exception only where the ticket says so for a .glb it names.
  • Saves stay backward-compatible (old saves load) and new MP/snapshot wire
    fields are optional.
  • Frame rate is the top priority for anything in the 3D layer or the render
    loop: add no per-frame allocation, no extra draw calls per building, no
    extra full-canvas passes. State in the PR what you did to protect fps.

CURRENT STATE OF THE GAME (2026-10-03 — read it; older tickets predate it)
  • Economy: every BUILD costs money ($, BUILD_COSTS_MONEY, canPayBuild /
    spendBuild in game.ts); city upgrades cost resources. Manager perks price
    builds through perkPrice() in src/iso/managers.ts; a host match setting
    can turn perks off (perkManagerOf).
  • The FLEET epic (#594) is merged: buy/upgrade trucks and trains, wagons per
    cargo, the Passing Loop with block reservation (src/iso/rail-blocks.ts).
    Rail may cross a road at 90 degrees (crossingRefusalAt in src/iso/rail.ts);
    trainSpawnHint explains why no train spawned (#650).
  • Multiplayer: a joined guest's seat is human on the host; the Multiplayer
    menu tab is hidden behind a PIN (src/ui/mp-gate.ts, ?mp=1949). The traffic
    and vehicle sims are SHARED host/guest: keep them deterministic, no
    Math.random in sim code.
  • CI: the unit suite is sharded 3 ways and the e2e suites 6 ways; the long
    whole-race simulations live in `npm run test:slow`. `main` should be green;
    some e2e specs still time out on slow CI runners — those are known flakes.
  • Towns: tiles are laid on a fixed 3-tile street lattice (TOWN_BLOCK = 3,
    townLayout / townBuildings / mergeTownBlocks in src/iso/grid.ts). Tiers 0-3
    grow a town (src/iso/town-growth.ts, grownTownHouses). CITY-1 (#657) fills
    free lots with ordinary 1x1 houses (TOWN_HOME_VARIANTS, townLotFiller) and
    CIVIC-1 (#658) lays hospitals/schools/stadiums (CIVIC_BUILDINGS in
    config.ts, layCivicBuildings). Old saves keep the towns they were saved
    with; do not change footprints of saved towns without a migration.
  • Live 3D (NOT on main): branch `feat/live-3d-rotation-wip` has a three.js
    layer (src/iso/three-layer.ts, behind ?three=1), 60+ building models plus
    vehicles, platform and depot in public/models/*.glb, camera rotation on `[`
    and `]` (view yaw in quarter turns about tile (0,0): src/iso/camera.ts,
    depth.ts turnPlaced/turnFootprint/turnTilePoint/yawQuarter, elevation.ts
    pickTile(yaw), road-renderer.ts RoadCache.paint, terrain-gl shaders uYaw).
    Clouds are off (CLOUDS_ENABLED=false in renderer.ts). The raw Meshy models
    (tools/art-src/meshy/*/model.glb, 401 MB) are git-ignored, so you cannot
    rebuild models from source; the built public/models/*.glb ARE committed
    (tools/models/build-models.mjs documents the pipeline).
  • Art: per-building PNGs in assets/buildings/ compiled from
    assets/buildings-src/ (tools/make-building-pngs.mjs). The lead makes all
    art and audio.
  • UI: paper cards, ORANGE buttons (never lemon), flat colours, no gradients.
  • This repo's game is the ENGINE for a game-jam entry; keep changes
    backward-compatible and behind options where a ticket says so.
  • RUN store / RUN Bits / MON-2 / MON-3 are OUT of scope.
  • Other agents work in parallel; rebase on origin/feat/live-3d-rotation-wip before the PR and
    keep both sides of any conflict.
  • Dev notes for the lead's play-test: only one Vite can use the run.game SDK
    port 9001; set RUNDOT_DEV_ROOM_PORT=9011 for a second server.

THE WORK
  Implement this ticket exactly as its Build and Acceptance sections say.
  Base branch: origin/feat/live-3d-rotation-wip.

TARGETED TESTS (background only)
  tests/unit/iso-camera-yaw.test.ts, tests/unit/iso-depth.test.ts, tests/unit/iso-yaw-lot.test.ts, tests/unit/iso-elevation-pick.test.ts, plus NEW tests/unit/3d-fix-2-ghost-yaw.test.ts.

TICKET 3D-FIX-2 — 3D-FIX-2: build ghost and overlays break when the camera is rotated
PROBLEM (owner playtest, 2026-10-03). With ?three=1, turn the camera with [ or ] while
PLACING a building. The build ghost is drawn as a flat, glassy sprite several tiles to the lower right of
the cyan tile-highlight diamond, and the placement lane band is displaced too. At yaw 0 everything is fine.
Camera rotation itself (ground, 3D buildings, roads, picking) is correct and approved by the owner.

STATE. A WIP commit 5e973a0a on this branch already started the fix (renderer.ts, overlay-art.ts,
minimap.ts, game.ts, tools/perf/three-ghost.mjs). It typechecks but is NOT verified. Review it first; keep what
is right, rewrite what is not.

BUILD
1. Every overlay that is positioned from a tile must use the yaw-turned position, through the same helpers the
   sprites and picking use (turnPlaced / turnFootprint / turnTilePoint / yawQuarter in src/iso/depth.ts, and
   worldToScreen with the camera yaw). Cover: the build ghost sprite, the footprint diamond / tile highlight,
   the hover highlight, the "cannot build" red tint, the drag lane band, road / rail drag previews, the
   platform ghost, claim flags, lane invites, labels, and the minimap view box.
2. The ghost must stay on the tile that pick() returns under the cursor at all four yaws, including on hills
   (hill lift stays screen-vertical; see pickTile in src/iso/elevation.ts).
3. Non-square footprints (1x2, 2x1, 2x4) must turn with the camera: the ghost footprint at yaw 90 is the
   transposed footprint.
4. Do not touch yaw 0 behaviour: at yaw 0 every overlay must be pixel-identical to before.
5. Add `__iso` twins only if you need them for the test (the file already has viewYaw() and
   tileAtScreen(sx, sy)).

ACCEPTANCE
[ ] At yaw 0/90/180/270 the ghost, highlight and lane band sit exactly on the picked tile (flat ground).
[ ] Same on a hill tile (lift direction is correct under the turn).
[ ] A 1x2 and a 2x4 ghost cover the right tiles at all four yaws.
[ ] Claim flags, lane invites and the minimap view box follow the turn (list what you checked in the PR).
[ ] fps: no per-frame allocation added; say what you did (cache turned footprints per (id, yaw)).
[ ] New unit test proves the overlay-position math round-trips: screen -> pick tile -> overlay position equals
    the tile's turned screen position, at all four yaws, with and without hill lift.
[ ] Browser steps written in the PR for the lead: ?three=1, Play, place a building, press ] three times, hover
    near the town, confirm the diamond and ghost coincide.
```

---

## 3D-FIX-3 - 3D-FIX-3: cream hotel building becomes a true 1x2; verify the glass-tower plinth

```text
You are working on HexMatch Industries (repo rumcan/HexMatch), an isometric
transport-tycoon + match-3 game (TypeScript, Vite, canvas). You do ONE ticket:
3D-FIX-3 — "3D-FIX-3: cream hotel building becomes a true 1x2; verify the glass-tower plinth". The TICKET block at the end of this prompt is the spec
(there is no GitHub issue to read). Where it and an OLDER ticket or doc
disagree, this ticket wins.

READ FIRST: AGENTS.md, docs/AGENT_PLAYBOOK.md (sections 2 and 3 are binding),
docs/HANDOVER-2026-10-03.md and docs/HANDOVER-2026-10-03-b.md (current state,
known gaps), then the TICKET below in full, then the files it names.

SETUP
  Your arena session starts on a PRESET branch name. Keep that branch name and
  REBASE it on the base branch named in THE WORK:
    git fetch origin && git rebase origin/feat/live-3d-rotation-wip
  then npm ci. If the rebase conflicts, keep BOTH sides of any conflict unless
  one side is plainly superseded, and say what you chose in the PR.
  Never force-push over commits you did not write.

TESTING — BINDING (docs/AGENT_PLAYBOOK.md §2)
  • NEVER run: npm test, npm run test:all, npm run test:slow, npm run test:e2e*,
    npx playwright, or vitest with no file arguments. The lead runs those.
  • Run ONLY the test files named below plus any test file you add, ALWAYS in
    the background, and poll the log:
      (npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo EXIT $? >> /tmp/t.log) &
      ... keep working ... then: tail -30 /tmp/t.log
  • Typecheck in the background the same way (~45 s), BOTH configs:
      (npx tsc --noEmit -p . > /tmp/tsc.log 2>&1; npx tsc --noEmit -p tsconfig.e2e.json >> /tmp/tsc.log 2>&1; echo EXIT $? >> /tmp/tsc.log) &
  • Known failures/flakes: some e2e specs time out on slow CI runners and
    `mp-battle` B6 is quarantined; the long simulations are in test:slow.
    Anything else in your files is yours to fix. Never loosen or skip a test you
    did not write. Do not edit docs/BALANCE.md (it is generated).
  • Never run tests/unit/iso-game.test.ts, iso-ai-sweep, iso-rebalance,
    battle-ai-sim or match3-balance-bot.
  • If one test run takes more than 5 minutes, kill it, note it in the PR, move on.
  • Don't install browsers or start a dev server to verify: write browser
    checks in the PR as "for the lead to play-test" (give exact steps: URL with
    ?three=1 where relevant, keys, __iso twins to call, what to look at).

DELIVER
  • Commit in small steps. Rebase on origin/feat/live-3d-rotation-wip again before opening the PR.
  • PR base branch: feat/live-3d-rotation-wip. PR title "3D-FIX-3: cream hotel building becomes a true 1x2; verify the glass-tower plinth", body starts with
    "Ref 3D-FIX-3" (there is no issue to close).
  • PR body: what changed, each acceptance box with HOW you checked it, the exact
    test files you ran and their result, what you could NOT verify (the lead
    play-tests), follow-ups you noticed but did not do.
  • Do not merge. Do not deploy. Do not push to main.
  • If "gh pr create" says a PR already exists for your branch, STOP and tell
    the owner. Never push onto someone else's PR or force-push over commits you
    did not write.
  • Stay inside the areas this ticket names (assets/buildings/manifest.json (footprint entry only), src/iso/config.ts (building footprints / variant lists), src/iso/grid.ts (town block layout), src/iso/three-layer.ts, tools/models/build-models.mjs, public/models/manifest.json, public/models/town_hotel.glb (re-fit only), tests/unit); if it needs more, say so
    in the PR.
  • Do NOT generate, edit or re-export any image, 3D model or audio. The lead
    does all art and audio (placeholders are fine; list the file names you need).
    Exception only where the ticket says so for a .glb it names.
  • Saves stay backward-compatible (old saves load) and new MP/snapshot wire
    fields are optional.
  • Frame rate is the top priority for anything in the 3D layer or the render
    loop: add no per-frame allocation, no extra draw calls per building, no
    extra full-canvas passes. State in the PR what you did to protect fps.

CURRENT STATE OF THE GAME (2026-10-03 — read it; older tickets predate it)
  • Economy: every BUILD costs money ($, BUILD_COSTS_MONEY, canPayBuild /
    spendBuild in game.ts); city upgrades cost resources. Manager perks price
    builds through perkPrice() in src/iso/managers.ts; a host match setting
    can turn perks off (perkManagerOf).
  • The FLEET epic (#594) is merged: buy/upgrade trucks and trains, wagons per
    cargo, the Passing Loop with block reservation (src/iso/rail-blocks.ts).
    Rail may cross a road at 90 degrees (crossingRefusalAt in src/iso/rail.ts);
    trainSpawnHint explains why no train spawned (#650).
  • Multiplayer: a joined guest's seat is human on the host; the Multiplayer
    menu tab is hidden behind a PIN (src/ui/mp-gate.ts, ?mp=1949). The traffic
    and vehicle sims are SHARED host/guest: keep them deterministic, no
    Math.random in sim code.
  • CI: the unit suite is sharded 3 ways and the e2e suites 6 ways; the long
    whole-race simulations live in `npm run test:slow`. `main` should be green;
    some e2e specs still time out on slow CI runners — those are known flakes.
  • Towns: tiles are laid on a fixed 3-tile street lattice (TOWN_BLOCK = 3,
    townLayout / townBuildings / mergeTownBlocks in src/iso/grid.ts). Tiers 0-3
    grow a town (src/iso/town-growth.ts, grownTownHouses). CITY-1 (#657) fills
    free lots with ordinary 1x1 houses (TOWN_HOME_VARIANTS, townLotFiller) and
    CIVIC-1 (#658) lays hospitals/schools/stadiums (CIVIC_BUILDINGS in
    config.ts, layCivicBuildings). Old saves keep the towns they were saved
    with; do not change footprints of saved towns without a migration.
  • Live 3D (NOT on main): branch `feat/live-3d-rotation-wip` has a three.js
    layer (src/iso/three-layer.ts, behind ?three=1), 60+ building models plus
    vehicles, platform and depot in public/models/*.glb, camera rotation on `[`
    and `]` (view yaw in quarter turns about tile (0,0): src/iso/camera.ts,
    depth.ts turnPlaced/turnFootprint/turnTilePoint/yawQuarter, elevation.ts
    pickTile(yaw), road-renderer.ts RoadCache.paint, terrain-gl shaders uYaw).
    Clouds are off (CLOUDS_ENABLED=false in renderer.ts). The raw Meshy models
    (tools/art-src/meshy/*/model.glb, 401 MB) are git-ignored, so you cannot
    rebuild models from source; the built public/models/*.glb ARE committed
    (tools/models/build-models.mjs documents the pipeline).
  • Art: per-building PNGs in assets/buildings/ compiled from
    assets/buildings-src/ (tools/make-building-pngs.mjs). The lead makes all
    art and audio.
  • UI: paper cards, ORANGE buttons (never lemon), flat colours, no gradients.
  • This repo's game is the ENGINE for a game-jam entry; keep changes
    backward-compatible and behind options where a ticket says so.
  • RUN store / RUN Bits / MON-2 / MON-3 are OUT of scope.
  • Other agents work in parallel; rebase on origin/feat/live-3d-rotation-wip before the PR and
    keep both sides of any conflict.
  • Dev notes for the lead's play-test: only one Vite can use the run.game SDK
    port 9001; set RUNDOT_DEV_ROOM_PORT=9011 for a second server.

THE WORK
  Implement this ticket exactly as its Build and Acceptance sections say.
  Base branch: origin/feat/live-3d-rotation-wip.

TARGETED TESTS (background only)
  tests/unit/iso-town-art.test.ts, tests/unit/iso-yaw-lot.test.ts, tests/unit/city-1-fill.test.ts, tests/unit/iso-town-no-1x1.test.ts, tests/unit/iso-559-town-trees.test.ts, tests/unit/3d-fix-1-towers.test.ts, plus NEW tests/unit/3d-fix-3-hotel-1x2.test.ts.

TICKET 3D-FIX-3 — 3D-FIX-3: cream hotel building becomes a true 1x2; verify the glass-tower plinth
PROBLEM (owner playtest). The 5-storey red-brick building with cream stone bands, orange window bays,
a striped glass canopy over the entrance and a roof terrace with a skylight is "too large". The owner wants it
to be a 1x2 building. 3D-FIX-1 (PR #656) only scaled `town_hotel` to 60% via MODEL_SCALE in
src/iso/three-layer.ts as a stopgap; that is NOT what was asked.

CAUTION. `town_hotel` has a [2,2] footprint in assets/buildings/manifest.json but is not named anywhere in
src/ or tests/. The agent that wrote #656 matched it by looking at the PNG. FIRST confirm in code which 2x2
sprites towns really place (run townBuildings(t, footprintOf, {tier:3}) over several seeds, as #656 did, and
also look at how TOWN_HOUSE_VARIANTS / TOWN_BLOCK_VARIANTS are built from the manifest) and confirm town_hotel
is among them, or find the real building by matching assets/buildings/*@1x.png. If the building is a different
sprite, retarget everything below to it and say so loudly in the PR.

BUILD
1. Change the sprite's footprint from [2,2] to [1,2] in assets/buildings/manifest.json, and make the PNG art
   and its hit/sort box consistent. You may not edit images: if the existing PNG cannot be used as a 1x2, list
   what the lead must re-render and keep a clearly marked fallback.
2. Town layout (townBuildings / mergeTownBlocks / the quad packer in src/iso/grid.ts): where a 2x2 block was
   drawn, a 1x2 now covers half of it. The other half must be filled with a legal filler lot (a house from
   TOWN_HOME_VARIANTS via townLotFiller, or a tree) so every pinned invariant still holds: nothing over a
   street, nothing off the town, no overlaps, no bare tiles.
3. Saves: towns already saved keep their saved building lists; do NOT change footprints of saved towns. Old saves
   must load without a crash. Add a test with a saved town that contains the old 2x2 hotel.
4. 3D: re-fit public/models/town_hotel.glb to the 1x2 plan in tools/models/build-models.mjs (plan scale, height
   proportional, footprint matches). Remove the town_hotel entry from MODEL_SCALE in three-layer.ts once the
   model is fitted (keep store_2x4: 0.6). Random facing (spinOf in three-layer.ts) must treat it as a
   non-square footprint: 0 or 180 degrees only.
5. Also eyeball-check by test only that town_office_tower_modern and town_shops_modern keep the solid plinth
   added in #656 (tests/unit/3d-fix-1-towers.test.ts must stay green). Write browser steps for the lead.

ACCEPTANCE
[ ] The identified sprite's footprint is [1,2] everywhere (manifest, footprintOf, 3D plan).
[ ] Tier-3 towns on seeds 1, 2, 3, 42, 1337 still satisfy all layout invariants and have no bare tiles.
[ ] An old save with the 2x2 hotel loads and renders.
[ ] No MODEL_SCALE stopgap left for it; the GLB is fitted.
[ ] New test covers the footprint, the layout invariants and the old-save case.
[ ] fps: no extra draw calls; the model stays within the existing triangle budget (report KB before/after).
```

---

## 3D-FIX-4 - 3D-FIX-4: roads and rail stay on the terrain on slopes when the camera is turned

```text
You are working on HexMatch Industries (repo rumcan/HexMatch), an isometric
transport-tycoon + match-3 game (TypeScript, Vite, canvas). You do ONE ticket:
3D-FIX-4 — "3D-FIX-4: roads and rail stay on the terrain on slopes when the camera is turned". The TICKET block at the end of this prompt is the spec
(there is no GitHub issue to read). Where it and an OLDER ticket or doc
disagree, this ticket wins.

READ FIRST: AGENTS.md, docs/AGENT_PLAYBOOK.md (sections 2 and 3 are binding),
docs/HANDOVER-2026-10-03.md and docs/HANDOVER-2026-10-03-b.md (current state,
known gaps), then the TICKET below in full, then the files it names.

SETUP
  Your arena session starts on a PRESET branch name. Keep that branch name and
  REBASE it on the base branch named in THE WORK:
    git fetch origin && git rebase origin/feat/live-3d-rotation-wip
  then npm ci. If the rebase conflicts, keep BOTH sides of any conflict unless
  one side is plainly superseded, and say what you chose in the PR.
  Never force-push over commits you did not write.

TESTING — BINDING (docs/AGENT_PLAYBOOK.md §2)
  • NEVER run: npm test, npm run test:all, npm run test:slow, npm run test:e2e*,
    npx playwright, or vitest with no file arguments. The lead runs those.
  • Run ONLY the test files named below plus any test file you add, ALWAYS in
    the background, and poll the log:
      (npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo EXIT $? >> /tmp/t.log) &
      ... keep working ... then: tail -30 /tmp/t.log
  • Typecheck in the background the same way (~45 s), BOTH configs:
      (npx tsc --noEmit -p . > /tmp/tsc.log 2>&1; npx tsc --noEmit -p tsconfig.e2e.json >> /tmp/tsc.log 2>&1; echo EXIT $? >> /tmp/tsc.log) &
  • Known failures/flakes: some e2e specs time out on slow CI runners and
    `mp-battle` B6 is quarantined; the long simulations are in test:slow.
    Anything else in your files is yours to fix. Never loosen or skip a test you
    did not write. Do not edit docs/BALANCE.md (it is generated).
  • Never run tests/unit/iso-game.test.ts, iso-ai-sweep, iso-rebalance,
    battle-ai-sim or match3-balance-bot.
  • If one test run takes more than 5 minutes, kill it, note it in the PR, move on.
  • Don't install browsers or start a dev server to verify: write browser
    checks in the PR as "for the lead to play-test" (give exact steps: URL with
    ?three=1 where relevant, keys, __iso twins to call, what to look at).

DELIVER
  • Commit in small steps. Rebase on origin/feat/live-3d-rotation-wip again before opening the PR.
  • PR base branch: feat/live-3d-rotation-wip. PR title "3D-FIX-4: roads and rail stay on the terrain on slopes when the camera is turned", body starts with
    "Ref 3D-FIX-4" (there is no issue to close).
  • PR body: what changed, each acceptance box with HOW you checked it, the exact
    test files you ran and their result, what you could NOT verify (the lead
    play-tests), follow-ups you noticed but did not do.
  • Do not merge. Do not deploy. Do not push to main.
  • If "gh pr create" says a PR already exists for your branch, STOP and tell
    the owner. Never push onto someone else's PR or force-push over commits you
    did not write.
  • Stay inside the areas this ticket names (src/iso/road-renderer.ts, src/iso/renderer.ts (road/rail drawing only), src/iso/depth.ts, src/iso/elevation.ts, tools/perf/three-yaw.mjs, tests/unit); if it needs more, say so
    in the PR.
  • Do NOT generate, edit or re-export any image, 3D model or audio. The lead
    does all art and audio (placeholders are fine; list the file names you need).
    Exception only where the ticket says so for a .glb it names.
  • Saves stay backward-compatible (old saves load) and new MP/snapshot wire
    fields are optional.
  • Frame rate is the top priority for anything in the 3D layer or the render
    loop: add no per-frame allocation, no extra draw calls per building, no
    extra full-canvas passes. State in the PR what you did to protect fps.

CURRENT STATE OF THE GAME (2026-10-03 — read it; older tickets predate it)
  • Economy: every BUILD costs money ($, BUILD_COSTS_MONEY, canPayBuild /
    spendBuild in game.ts); city upgrades cost resources. Manager perks price
    builds through perkPrice() in src/iso/managers.ts; a host match setting
    can turn perks off (perkManagerOf).
  • The FLEET epic (#594) is merged: buy/upgrade trucks and trains, wagons per
    cargo, the Passing Loop with block reservation (src/iso/rail-blocks.ts).
    Rail may cross a road at 90 degrees (crossingRefusalAt in src/iso/rail.ts);
    trainSpawnHint explains why no train spawned (#650).
  • Multiplayer: a joined guest's seat is human on the host; the Multiplayer
    menu tab is hidden behind a PIN (src/ui/mp-gate.ts, ?mp=1949). The traffic
    and vehicle sims are SHARED host/guest: keep them deterministic, no
    Math.random in sim code.
  • CI: the unit suite is sharded 3 ways and the e2e suites 6 ways; the long
    whole-race simulations live in `npm run test:slow`. `main` should be green;
    some e2e specs still time out on slow CI runners — those are known flakes.
  • Towns: tiles are laid on a fixed 3-tile street lattice (TOWN_BLOCK = 3,
    townLayout / townBuildings / mergeTownBlocks in src/iso/grid.ts). Tiers 0-3
    grow a town (src/iso/town-growth.ts, grownTownHouses). CITY-1 (#657) fills
    free lots with ordinary 1x1 houses (TOWN_HOME_VARIANTS, townLotFiller) and
    CIVIC-1 (#658) lays hospitals/schools/stadiums (CIVIC_BUILDINGS in
    config.ts, layCivicBuildings). Old saves keep the towns they were saved
    with; do not change footprints of saved towns without a migration.
  • Live 3D (NOT on main): branch `feat/live-3d-rotation-wip` has a three.js
    layer (src/iso/three-layer.ts, behind ?three=1), 60+ building models plus
    vehicles, platform and depot in public/models/*.glb, camera rotation on `[`
    and `]` (view yaw in quarter turns about tile (0,0): src/iso/camera.ts,
    depth.ts turnPlaced/turnFootprint/turnTilePoint/yawQuarter, elevation.ts
    pickTile(yaw), road-renderer.ts RoadCache.paint, terrain-gl shaders uYaw).
    Clouds are off (CLOUDS_ENABLED=false in renderer.ts). The raw Meshy models
    (tools/art-src/meshy/*/model.glb, 401 MB) are git-ignored, so you cannot
    rebuild models from source; the built public/models/*.glb ARE committed
    (tools/models/build-models.mjs documents the pipeline).
  • Art: per-building PNGs in assets/buildings/ compiled from
    assets/buildings-src/ (tools/make-building-pngs.mjs). The lead makes all
    art and audio.
  • UI: paper cards, ORANGE buttons (never lemon), flat colours, no gradients.
  • This repo's game is the ENGINE for a game-jam entry; keep changes
    backward-compatible and behind options where a ticket says so.
  • RUN store / RUN Bits / MON-2 / MON-3 are OUT of scope.
  • Other agents work in parallel; rebase on origin/feat/live-3d-rotation-wip before the PR and
    keep both sides of any conflict.
  • Dev notes for the lead's play-test: only one Vite can use the run.game SDK
    port 9001; set RUNDOT_DEV_ROOM_PORT=9011 for a second server.

THE WORK
  Implement this ticket exactly as its Build and Acceptance sections say.
  Base branch: origin/feat/live-3d-rotation-wip.

TARGETED TESTS (background only)
  tests/unit/iso-camera-yaw.test.ts, tests/unit/iso-depth.test.ts, tests/unit/iso-elevation.test.ts, tests/unit/iso-elevation-pick.test.ts, plus NEW tests/unit/3d-fix-4-road-lift.test.ts.

TICKET 3D-FIX-4 — 3D-FIX-4: roads and rail stay on the terrain on slopes when the camera is turned
PROBLEM. With ?three=1 and the camera turned (yaw 90/180/270), road and rail bitmaps shear slightly
against the terrain on SLOPED tiles. Flat town roads are exact. Cause: the cached road/rail/decal chunk
bitmaps (RoadCache.paint in src/iso/road-renderer.ts) have the hill lift baked in vertically (screen-vertical),
and at yaw != 0 they are drawn through the lattice-turn affine, so the lift direction is wrong on slopes. A
later commit on this branch (b4b1a47e, "road lift baked per view quarter") may already have improved this;
read it and measure before changing anything.

BUILD
1. Measure: write tools/perf/ checks (or extend three-yaw.mjs) that count road-vs-terrain mismatch on sloped
   tiles at each yaw, so the result is a number, not an impression.
2. Fix properly: bake (or draw) the road chunks per view quarter in the turned frame so the hill lift runs along
   the correct screen direction for that yaw; keep a cache keyed by (chunk, quarter) with a bounded size.
3. Yaw 0 must be byte-identical to today (same pixels, same cache keys).
4. Rail and decals must follow the same rule as roads.
5. Mid-turn easing: decide and document whether the chunks snap to the nearest quarter during the ease (the
   current sprite behaviour) or blend; do not allocate per frame.

ACCEPTANCE
[ ] On a map with slopes, mismatch is 0 (or below a stated, justified threshold) at yaw 0/90/180/270.
[ ] Yaw 0 output unchanged (test or screenshot hash).
[ ] fps at yaw 0/90/180/270 within 1 fps of the numbers in docs/HANDOVER-2026-10-03-b.md (53-59).
[ ] Memory: the new cache is bounded; state the maximum bitmap count and size.
[ ] New unit test covers the lift direction per quarter.
[ ] Browser steps for the lead: seed with hills, ?three=1, press ] and look at a road climbing a slope.
```

---

## 3D-FIX-5 - 3D-FIX-5: vehicle, platform and depot 3D models face and sit correctly at every yaw

```text
You are working on HexMatch Industries (repo rumcan/HexMatch), an isometric
transport-tycoon + match-3 game (TypeScript, Vite, canvas). You do ONE ticket:
3D-FIX-5 — "3D-FIX-5: vehicle, platform and depot 3D models face and sit correctly at every yaw". The TICKET block at the end of this prompt is the spec
(there is no GitHub issue to read). Where it and an OLDER ticket or doc
disagree, this ticket wins.

READ FIRST: AGENTS.md, docs/AGENT_PLAYBOOK.md (sections 2 and 3 are binding),
docs/HANDOVER-2026-10-03.md and docs/HANDOVER-2026-10-03-b.md (current state,
known gaps), then the TICKET below in full, then the files it names.

SETUP
  Your arena session starts on a PRESET branch name. Keep that branch name and
  REBASE it on the base branch named in THE WORK:
    git fetch origin && git rebase origin/feat/live-3d-rotation-wip
  then npm ci. If the rebase conflicts, keep BOTH sides of any conflict unless
  one side is plainly superseded, and say what you chose in the PR.
  Never force-push over commits you did not write.

TESTING — BINDING (docs/AGENT_PLAYBOOK.md §2)
  • NEVER run: npm test, npm run test:all, npm run test:slow, npm run test:e2e*,
    npx playwright, or vitest with no file arguments. The lead runs those.
  • Run ONLY the test files named below plus any test file you add, ALWAYS in
    the background, and poll the log:
      (npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo EXIT $? >> /tmp/t.log) &
      ... keep working ... then: tail -30 /tmp/t.log
  • Typecheck in the background the same way (~45 s), BOTH configs:
      (npx tsc --noEmit -p . > /tmp/tsc.log 2>&1; npx tsc --noEmit -p tsconfig.e2e.json >> /tmp/tsc.log 2>&1; echo EXIT $? >> /tmp/tsc.log) &
  • Known failures/flakes: some e2e specs time out on slow CI runners and
    `mp-battle` B6 is quarantined; the long simulations are in test:slow.
    Anything else in your files is yours to fix. Never loosen or skip a test you
    did not write. Do not edit docs/BALANCE.md (it is generated).
  • Never run tests/unit/iso-game.test.ts, iso-ai-sweep, iso-rebalance,
    battle-ai-sim or match3-balance-bot.
  • If one test run takes more than 5 minutes, kill it, note it in the PR, move on.
  • Don't install browsers or start a dev server to verify: write browser
    checks in the PR as "for the lead to play-test" (give exact steps: URL with
    ?three=1 where relevant, keys, __iso twins to call, what to look at).

DELIVER
  • Commit in small steps. Rebase on origin/feat/live-3d-rotation-wip again before opening the PR.
  • PR base branch: feat/live-3d-rotation-wip. PR title "3D-FIX-5: vehicle, platform and depot 3D models face and sit correctly at every yaw", body starts with
    "Ref 3D-FIX-5" (there is no issue to close).
  • PR body: what changed, each acceptance box with HOW you checked it, the exact
    test files you ran and their result, what you could NOT verify (the lead
    play-tests), follow-ups you noticed but did not do.
  • Do not merge. Do not deploy. Do not push to main.
  • If "gh pr create" says a PR already exists for your branch, STOP and tell
    the owner. Never push onto someone else's PR or force-push over commits you
    did not write.
  • Stay inside the areas this ticket names (src/iso/three-layer.ts, src/iso/vehicles.ts (draw items only), tools/models/build-models.mjs (FLIP / FOOTPRINT tables), public/models/*.glb for the models named below, public/models/manifest.json, tools/perf/three-platform.mjs, tools/perf/three-depot.mjs, tests/unit); if it needs more, say so
    in the PR.
  • Do NOT generate, edit or re-export any image, 3D model or audio. The lead
    does all art and audio (placeholders are fine; list the file names you need).
    Exception only where the ticket says so for a .glb it names.
  • Saves stay backward-compatible (old saves load) and new MP/snapshot wire
    fields are optional.
  • Frame rate is the top priority for anything in the 3D layer or the render
    loop: add no per-frame allocation, no extra draw calls per building, no
    extra full-canvas passes. State in the PR what you did to protect fps.

CURRENT STATE OF THE GAME (2026-10-03 — read it; older tickets predate it)
  • Economy: every BUILD costs money ($, BUILD_COSTS_MONEY, canPayBuild /
    spendBuild in game.ts); city upgrades cost resources. Manager perks price
    builds through perkPrice() in src/iso/managers.ts; a host match setting
    can turn perks off (perkManagerOf).
  • The FLEET epic (#594) is merged: buy/upgrade trucks and trains, wagons per
    cargo, the Passing Loop with block reservation (src/iso/rail-blocks.ts).
    Rail may cross a road at 90 degrees (crossingRefusalAt in src/iso/rail.ts);
    trainSpawnHint explains why no train spawned (#650).
  • Multiplayer: a joined guest's seat is human on the host; the Multiplayer
    menu tab is hidden behind a PIN (src/ui/mp-gate.ts, ?mp=1949). The traffic
    and vehicle sims are SHARED host/guest: keep them deterministic, no
    Math.random in sim code.
  • CI: the unit suite is sharded 3 ways and the e2e suites 6 ways; the long
    whole-race simulations live in `npm run test:slow`. `main` should be green;
    some e2e specs still time out on slow CI runners — those are known flakes.
  • Towns: tiles are laid on a fixed 3-tile street lattice (TOWN_BLOCK = 3,
    townLayout / townBuildings / mergeTownBlocks in src/iso/grid.ts). Tiers 0-3
    grow a town (src/iso/town-growth.ts, grownTownHouses). CITY-1 (#657) fills
    free lots with ordinary 1x1 houses (TOWN_HOME_VARIANTS, townLotFiller) and
    CIVIC-1 (#658) lays hospitals/schools/stadiums (CIVIC_BUILDINGS in
    config.ts, layCivicBuildings). Old saves keep the towns they were saved
    with; do not change footprints of saved towns without a migration.
  • Live 3D (NOT on main): branch `feat/live-3d-rotation-wip` has a three.js
    layer (src/iso/three-layer.ts, behind ?three=1), 60+ building models plus
    vehicles, platform and depot in public/models/*.glb, camera rotation on `[`
    and `]` (view yaw in quarter turns about tile (0,0): src/iso/camera.ts,
    depth.ts turnPlaced/turnFootprint/turnTilePoint/yawQuarter, elevation.ts
    pickTile(yaw), road-renderer.ts RoadCache.paint, terrain-gl shaders uYaw).
    Clouds are off (CLOUDS_ENABLED=false in renderer.ts). The raw Meshy models
    (tools/art-src/meshy/*/model.glb, 401 MB) are git-ignored, so you cannot
    rebuild models from source; the built public/models/*.glb ARE committed
    (tools/models/build-models.mjs documents the pipeline).
  • Art: per-building PNGs in assets/buildings/ compiled from
    assets/buildings-src/ (tools/make-building-pngs.mjs). The lead makes all
    art and audio.
  • UI: paper cards, ORANGE buttons (never lemon), flat colours, no gradients.
  • This repo's game is the ENGINE for a game-jam entry; keep changes
    backward-compatible and behind options where a ticket says so.
  • RUN store / RUN Bits / MON-2 / MON-3 are OUT of scope.
  • Other agents work in parallel; rebase on origin/feat/live-3d-rotation-wip before the PR and
    keep both sides of any conflict.
  • Dev notes for the lead's play-test: only one Vite can use the run.game SDK
    port 9001; set RUNDOT_DEV_ROOM_PORT=9011 for a second server.

THE WORK
  Implement this ticket exactly as its Build and Acceptance sections say.
  Base branch: origin/feat/live-3d-rotation-wip.

TARGETED TESTS (background only)
  tests/unit/iso-yaw-lot.test.ts, tests/unit/iso-camera-yaw.test.ts, tests/unit/iso-depth.test.ts, tests/unit/iso-traffic-gap.test.ts, plus NEW tests/unit/3d-fix-5-facing.test.ts.

TICKET 3D-FIX-5 — 3D-FIX-5: vehicle, platform and depot 3D models face and sit correctly at every yaw
PROBLEM. In ?three=1 the owner reported player truck models driving backwards, and the train platform
not rotating correctly. Fixes landed on this branch (FLIP for vehicle_truck, vehicle_truck_blue, rail_loco;
platform and train-depot mapped as platform_<view> / train-depot_<view>) but were only checked in a model
gallery and at yaw 0 for the platform. Verify and fix the rest.

BUILD
1. Write a pure function test of the heading -> model-yaw mapping (three-layer.ts): for each vehicle model
   (3 sedans, vehicle_truck, vehicle_truck_blue, rail_loco, rail_tender, rail_box, rail_flat, rail_tank) and
   for each of the 4 travel headings and 4 camera yaws, the model's FRONT must point along the travel
   direction on screen. Record each model's front axis in a table (FLIP / FRONT_AXIS in build-models.mjs) so it
   is data, not a special case in the render loop. Fix any model that is wrong; rebuild only those models.
2. Platform (platform_<view>, 1x4 plan): its long axis must follow the rail axis for all four views at all four
   yaws; ne/sw turn a half turn, se/nw a quarter turn relative to each other (verify against the 2D art).
3. Train depot (train-depot_<view>): confirm all four views (the lead's earlier check covered only se and nw).
4. Vehicles without their own model (pickup, van, bus use the lorry model scaled): keep that, but make the
   fallback one table (VEHICLE_MODEL_ALIAS) so a real model is a one-line change when the art lands.
5. 2D sprites for anything the 3D layer draws must stay hidden (hideVehicle-style); anything with no ready 3D
   model must still draw in 2D.

ACCEPTANCE
[ ] Table-driven test: front points along travel for every model x heading x yaw.
[ ] Platform and depot footprints and orientations covered by a test for all four views x four yaws.
[ ] No model rebuilt unless the test proved it wrong; list each rebuilt GLB with KB before/after.
[ ] fps unchanged (no per-frame allocation in the heading mapping).
[ ] Browser steps for the lead: watch a lorry and a train drive both ways at two yaws.
```

---

## RES-LABELS-1 - RES-LABELS-1: remove the redundant name chip on resource sites

```text
You are working on HexMatch Industries (repo rumcan/HexMatch), an isometric
transport-tycoon + match-3 game (TypeScript, Vite, canvas). You do ONE ticket:
RES-LABELS-1 — "RES-LABELS-1: remove the redundant name chip on resource sites". The TICKET block at the end of this prompt is the spec
(there is no GitHub issue to read). Where it and an OLDER ticket or doc
disagree, this ticket wins.

READ FIRST: AGENTS.md, docs/AGENT_PLAYBOOK.md (sections 2 and 3 are binding),
docs/HANDOVER-2026-10-03.md and docs/HANDOVER-2026-10-03-b.md (current state,
known gaps), then the TICKET below in full, then the files it names.

SETUP
  Your arena session starts on a PRESET branch name. Keep that branch name and
  REBASE it on the base branch named in THE WORK:
    git fetch origin && git rebase origin/main
  then npm ci. If the rebase conflicts, keep BOTH sides of any conflict unless
  one side is plainly superseded, and say what you chose in the PR.
  Never force-push over commits you did not write.

TESTING — BINDING (docs/AGENT_PLAYBOOK.md §2)
  • NEVER run: npm test, npm run test:all, npm run test:slow, npm run test:e2e*,
    npx playwright, or vitest with no file arguments. The lead runs those.
  • Run ONLY the test files named below plus any test file you add, ALWAYS in
    the background, and poll the log:
      (npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo EXIT $? >> /tmp/t.log) &
      ... keep working ... then: tail -30 /tmp/t.log
  • Typecheck in the background the same way (~45 s), BOTH configs:
      (npx tsc --noEmit -p . > /tmp/tsc.log 2>&1; npx tsc --noEmit -p tsconfig.e2e.json >> /tmp/tsc.log 2>&1; echo EXIT $? >> /tmp/tsc.log) &
  • Known failures/flakes: some e2e specs time out on slow CI runners and
    `mp-battle` B6 is quarantined; the long simulations are in test:slow.
    Anything else in your files is yours to fix. Never loosen or skip a test you
    did not write. Do not edit docs/BALANCE.md (it is generated).
  • Never run tests/unit/iso-game.test.ts, iso-ai-sweep, iso-rebalance,
    battle-ai-sim or match3-balance-bot.
  • If one test run takes more than 5 minutes, kill it, note it in the PR, move on.
  • Don't install browsers or start a dev server to verify: write browser
    checks in the PR as "for the lead to play-test" (give exact steps: URL with
    ?three=1 where relevant, keys, __iso twins to call, what to look at).

DELIVER
  • Commit in small steps. Rebase on origin/main again before opening the PR.
  • PR base branch: main. PR title "RES-LABELS-1: remove the redundant name chip on resource sites", body starts with
    "Ref RES-LABELS-1" (there is no issue to close).
  • PR body: what changed, each acceptance box with HOW you checked it, the exact
    test files you ran and their result, what you could NOT verify (the lead
    play-tests), follow-ups you noticed but did not do.
  • Do not merge. Do not deploy. Do not push to main.
  • If "gh pr create" says a PR already exists for your branch, STOP and tell
    the owner. Never push onto someone else's PR or force-push over commits you
    did not write.
  • Stay inside the areas this ticket names (src/iso/renderer.ts, src/iso/overlay-art.ts, src/iso/game.ts (label drawing only), tests/unit); if it needs more, say so
    in the PR.
  • Do NOT generate, edit or re-export any image, 3D model or audio. The lead
    does all art and audio (placeholders are fine; list the file names you need).
    Exception only where the ticket says so for a .glb it names.
  • Saves stay backward-compatible (old saves load) and new MP/snapshot wire
    fields are optional.
  • Frame rate is the top priority for anything in the 3D layer or the render
    loop: add no per-frame allocation, no extra draw calls per building, no
    extra full-canvas passes. State in the PR what you did to protect fps.

CURRENT STATE OF THE GAME (2026-10-03 — read it; older tickets predate it)
  • Economy: every BUILD costs money ($, BUILD_COSTS_MONEY, canPayBuild /
    spendBuild in game.ts); city upgrades cost resources. Manager perks price
    builds through perkPrice() in src/iso/managers.ts; a host match setting
    can turn perks off (perkManagerOf).
  • The FLEET epic (#594) is merged: buy/upgrade trucks and trains, wagons per
    cargo, the Passing Loop with block reservation (src/iso/rail-blocks.ts).
    Rail may cross a road at 90 degrees (crossingRefusalAt in src/iso/rail.ts);
    trainSpawnHint explains why no train spawned (#650).
  • Multiplayer: a joined guest's seat is human on the host; the Multiplayer
    menu tab is hidden behind a PIN (src/ui/mp-gate.ts, ?mp=1949). The traffic
    and vehicle sims are SHARED host/guest: keep them deterministic, no
    Math.random in sim code.
  • CI: the unit suite is sharded 3 ways and the e2e suites 6 ways; the long
    whole-race simulations live in `npm run test:slow`. `main` should be green;
    some e2e specs still time out on slow CI runners — those are known flakes.
  • Towns: tiles are laid on a fixed 3-tile street lattice (TOWN_BLOCK = 3,
    townLayout / townBuildings / mergeTownBlocks in src/iso/grid.ts). Tiers 0-3
    grow a town (src/iso/town-growth.ts, grownTownHouses). CITY-1 (#657) fills
    free lots with ordinary 1x1 houses (TOWN_HOME_VARIANTS, townLotFiller) and
    CIVIC-1 (#658) lays hospitals/schools/stadiums (CIVIC_BUILDINGS in
    config.ts, layCivicBuildings). Old saves keep the towns they were saved
    with; do not change footprints of saved towns without a migration.
  • Live 3D (NOT on main): branch `feat/live-3d-rotation-wip` has a three.js
    layer (src/iso/three-layer.ts, behind ?three=1), 60+ building models plus
    vehicles, platform and depot in public/models/*.glb, camera rotation on `[`
    and `]` (view yaw in quarter turns about tile (0,0): src/iso/camera.ts,
    depth.ts turnPlaced/turnFootprint/turnTilePoint/yawQuarter, elevation.ts
    pickTile(yaw), road-renderer.ts RoadCache.paint, terrain-gl shaders uYaw).
    Clouds are off (CLOUDS_ENABLED=false in renderer.ts). The raw Meshy models
    (tools/art-src/meshy/*/model.glb, 401 MB) are git-ignored, so you cannot
    rebuild models from source; the built public/models/*.glb ARE committed
    (tools/models/build-models.mjs documents the pipeline).
  • Art: per-building PNGs in assets/buildings/ compiled from
    assets/buildings-src/ (tools/make-building-pngs.mjs). The lead makes all
    art and audio.
  • UI: paper cards, ORANGE buttons (never lemon), flat colours, no gradients.
  • This repo's game is the ENGINE for a game-jam entry; keep changes
    backward-compatible and behind options where a ticket says so.
  • RUN store / RUN Bits / MON-2 / MON-3 are OUT of scope.
  • Other agents work in parallel; rebase on origin/main before the PR and
    keep both sides of any conflict.
  • Dev notes for the lead's play-test: only one Vite can use the run.game SDK
    port 9001; set RUNDOT_DEV_ROOM_PORT=9011 for a second server.

THE WORK
  Implement this ticket exactly as its Build and Acceptance sections say.
  Base branch: origin/main.

TARGETED TESTS (background only)
  tests/unit/iso-camera.test.ts, tests/unit/iso-depth.test.ts, plus NEW tests/unit/res-labels-1.test.ts.

TICKET RES-LABELS-1 — RES-LABELS-1: remove the redundant name chip on resource sites
PROBLEM (owner playtest). A resource site such as the Quarry shows a dark "QUARRY" name chip on top of
the building and a smaller "Quarry" caption underneath, "for no reason". The red flag that used to sit there is
already gone (owner removed it); do NOT touch flags.

BUILD
1. Find what draws the chip and the caption (grep the label / chip / caption / name drawing in renderer.ts,
   overlay-art.ts, game.ts; check hover vs always-on vs selected).
2. Decide the rule, and keep it small: a resource site shows NO permanent name chip. A name may appear only
   while hovered or selected, once, not twice. Town names (e.g. ELMWOOD) and the YOUR PLANT / rival plant tags
   stay exactly as they are.
3. Check the plain 2D game and ?three=1 both.
4. If the chip text is needed for accessibility (aria / tooltip), keep it there and not on the canvas.

ACCEPTANCE
[ ] No permanent QUARRY chip or caption on resource sites; hovering shows at most one name.
[ ] Town name labels and the plant tags are byte-identical to before (test or note how checked).
[ ] A unit test pins the rule for each resource-site kind (quarry, mine, farm, forest, oil, ...).
[ ] Browser steps for the lead: open the map, look at a quarry, hover it.
```

---

## E2E-GREEN-1 - E2E-GREEN-1: get the sharded e2e CI shards green without loosening tests

```text
You are working on HexMatch Industries (repo rumcan/HexMatch), an isometric
transport-tycoon + match-3 game (TypeScript, Vite, canvas). You do ONE ticket:
E2E-GREEN-1 — "E2E-GREEN-1: get the sharded e2e CI shards green without loosening tests". The TICKET block at the end of this prompt is the spec
(there is no GitHub issue to read). Where it and an OLDER ticket or doc
disagree, this ticket wins.

READ FIRST: AGENTS.md, docs/AGENT_PLAYBOOK.md (sections 2 and 3 are binding),
docs/HANDOVER-2026-10-03.md and docs/HANDOVER-2026-10-03-b.md (current state,
known gaps), then the TICKET below in full, then the files it names.

SETUP
  Your arena session starts on a PRESET branch name. Keep that branch name and
  REBASE it on the base branch named in THE WORK:
    git fetch origin && git rebase origin/main
  then npm ci. If the rebase conflicts, keep BOTH sides of any conflict unless
  one side is plainly superseded, and say what you chose in the PR.
  Never force-push over commits you did not write.

TESTING — BINDING (docs/AGENT_PLAYBOOK.md §2)
  • NEVER run: npm test, npm run test:all, npm run test:slow, npm run test:e2e*,
    npx playwright, or vitest with no file arguments. The lead runs those.
  • Run ONLY the test files named below plus any test file you add, ALWAYS in
    the background, and poll the log:
      (npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo EXIT $? >> /tmp/t.log) &
      ... keep working ... then: tail -30 /tmp/t.log
  • Typecheck in the background the same way (~45 s), BOTH configs:
      (npx tsc --noEmit -p . > /tmp/tsc.log 2>&1; npx tsc --noEmit -p tsconfig.e2e.json >> /tmp/tsc.log 2>&1; echo EXIT $? >> /tmp/tsc.log) &
  • Known failures/flakes: some e2e specs time out on slow CI runners and
    `mp-battle` B6 is quarantined; the long simulations are in test:slow.
    Anything else in your files is yours to fix. Never loosen or skip a test you
    did not write. Do not edit docs/BALANCE.md (it is generated).
  • Never run tests/unit/iso-game.test.ts, iso-ai-sweep, iso-rebalance,
    battle-ai-sim or match3-balance-bot.
  • If one test run takes more than 5 minutes, kill it, note it in the PR, move on.
  • Don't install browsers or start a dev server to verify: write browser
    checks in the PR as "for the lead to play-test" (give exact steps: URL with
    ?three=1 where relevant, keys, __iso twins to call, what to look at).

DELIVER
  • Commit in small steps. Rebase on origin/main again before opening the PR.
  • PR base branch: main. PR title "E2E-GREEN-1: get the sharded e2e CI shards green without loosening tests", body starts with
    "Ref E2E-GREEN-1" (there is no issue to close).
  • PR body: what changed, each acceptance box with HOW you checked it, the exact
    test files you ran and their result, what you could NOT verify (the lead
    play-tests), follow-ups you noticed but did not do.
  • Do not merge. Do not deploy. Do not push to main.
  • If "gh pr create" says a PR already exists for your branch, STOP and tell
    the owner. Never push onto someone else's PR or force-push over commits you
    did not write.
  • Stay inside the areas this ticket names (.github/workflows/ci.yml, playwright.config.*, tests/e2e/*.spec.ts and tests/e2e-mp/*.spec.ts (timeouts / readiness waits / quarantine only), docs/known-test-failures.md); if it needs more, say so
    in the PR.
  • Do NOT generate, edit or re-export any image, 3D model or audio. The lead
    does all art and audio (placeholders are fine; list the file names you need).
    Exception only where the ticket says so for a .glb it names.
  • Saves stay backward-compatible (old saves load) and new MP/snapshot wire
    fields are optional.
  • Frame rate is the top priority for anything in the 3D layer or the render
    loop: add no per-frame allocation, no extra draw calls per building, no
    extra full-canvas passes. State in the PR what you did to protect fps.

CURRENT STATE OF THE GAME (2026-10-03 — read it; older tickets predate it)
  • Economy: every BUILD costs money ($, BUILD_COSTS_MONEY, canPayBuild /
    spendBuild in game.ts); city upgrades cost resources. Manager perks price
    builds through perkPrice() in src/iso/managers.ts; a host match setting
    can turn perks off (perkManagerOf).
  • The FLEET epic (#594) is merged: buy/upgrade trucks and trains, wagons per
    cargo, the Passing Loop with block reservation (src/iso/rail-blocks.ts).
    Rail may cross a road at 90 degrees (crossingRefusalAt in src/iso/rail.ts);
    trainSpawnHint explains why no train spawned (#650).
  • Multiplayer: a joined guest's seat is human on the host; the Multiplayer
    menu tab is hidden behind a PIN (src/ui/mp-gate.ts, ?mp=1949). The traffic
    and vehicle sims are SHARED host/guest: keep them deterministic, no
    Math.random in sim code.
  • CI: the unit suite is sharded 3 ways and the e2e suites 6 ways; the long
    whole-race simulations live in `npm run test:slow`. `main` should be green;
    some e2e specs still time out on slow CI runners — those are known flakes.
  • Towns: tiles are laid on a fixed 3-tile street lattice (TOWN_BLOCK = 3,
    townLayout / townBuildings / mergeTownBlocks in src/iso/grid.ts). Tiers 0-3
    grow a town (src/iso/town-growth.ts, grownTownHouses). CITY-1 (#657) fills
    free lots with ordinary 1x1 houses (TOWN_HOME_VARIANTS, townLotFiller) and
    CIVIC-1 (#658) lays hospitals/schools/stadiums (CIVIC_BUILDINGS in
    config.ts, layCivicBuildings). Old saves keep the towns they were saved
    with; do not change footprints of saved towns without a migration.
  • Live 3D (NOT on main): branch `feat/live-3d-rotation-wip` has a three.js
    layer (src/iso/three-layer.ts, behind ?three=1), 60+ building models plus
    vehicles, platform and depot in public/models/*.glb, camera rotation on `[`
    and `]` (view yaw in quarter turns about tile (0,0): src/iso/camera.ts,
    depth.ts turnPlaced/turnFootprint/turnTilePoint/yawQuarter, elevation.ts
    pickTile(yaw), road-renderer.ts RoadCache.paint, terrain-gl shaders uYaw).
    Clouds are off (CLOUDS_ENABLED=false in renderer.ts). The raw Meshy models
    (tools/art-src/meshy/*/model.glb, 401 MB) are git-ignored, so you cannot
    rebuild models from source; the built public/models/*.glb ARE committed
    (tools/models/build-models.mjs documents the pipeline).
  • Art: per-building PNGs in assets/buildings/ compiled from
    assets/buildings-src/ (tools/make-building-pngs.mjs). The lead makes all
    art and audio.
  • UI: paper cards, ORANGE buttons (never lemon), flat colours, no gradients.
  • This repo's game is the ENGINE for a game-jam entry; keep changes
    backward-compatible and behind options where a ticket says so.
  • RUN store / RUN Bits / MON-2 / MON-3 are OUT of scope.
  • Other agents work in parallel; rebase on origin/main before the PR and
    keep both sides of any conflict.
  • Dev notes for the lead's play-test: only one Vite can use the run.game SDK
    port 9001; set RUNDOT_DEV_ROOM_PORT=9011 for a second server.

THE WORK
  Implement this ticket exactly as its Build and Acceptance sections say.
  Base branch: origin/main.

TARGETED TESTS (background only)
  NONE of the e2e files may be run locally (playbook rule). Verify by reading CI logs: `gh run view <id> --log-failed` and `gh pr checks <PR>`. Local typecheck only (both tsconfigs).

TICKET E2E-GREEN-1 — E2E-GREEN-1: get the sharded e2e CI shards green without loosening tests
PROBLEM. CI on main is red in several e2e shards even after sharding to 6 (PR #648). Seen failing, all
timeouts: iso-game.spec.ts:215 (15 s predicate), iso-tutorial.spec.ts:305 (boot waitForFunction 120 s),
perf-mode.spec.ts:135 (settings sheet, page.evaluate 120 s), mp-leave.e2e.spec.ts:92 and mp-lobby.e2e.spec.ts:21
("guest mirrors the host's opening", 60 s), and in later runs e2e shards 2/3/5 and MP shards 1/3/4/5 plus unit
shard 1 in one run. Software-GL runners are slow.

BUILD
1. Pull the last 3 CI runs for main (`gh run list --branch main -L 3`) and for the open PR you are rebased on.
   Build a table: spec, shard, failure kind, how often it fails across runs (flaky vs always).
2. For each ALWAYS-failing spec, find the real cause in the log (not a guess). Fix it if it is a test-harness
   readiness problem (wait for the right ready flag instead of a fixed timeout, boot helper, port clash, MP room
   server start-up). Raise a timeout only where the log shows a load-related timeout, and only that spec.
3. For genuinely flaky specs that you cannot fix: quarantine with test.fixme / it.skip + a linked GitHub issue
   (create it with gh) + a row in docs/known-test-failures.md. Never loosen an assertion. Never delete a test.
4. Consider rebalancing shards (Playwright --shard splits by file; heavy files such as iso-game and iso-tutorial
   may need to be split or marked for their own shard) and adding `retries: 1` ONLY on CI for e2e (not unit).
5. Do not change game code. If a failure is a real game bug, file an issue and quarantine.

ACCEPTANCE
[ ] The table above is in the PR body.
[ ] After your change, the PR's own CI e2e and e2e-multiplayer jobs are green or every remaining red spec is
    quarantined with an issue link and a docs/known-test-failures.md row (paste the final `gh pr checks`).
[ ] No assertion weakened; list every timeout you raised and why.
[ ] Both typecheck configs clean.
```

---

## AL-1 - AL-1: confirm Asset Lab works and produce the missing vehicle source images

```text
You are working on HexMatch Industries (repo rumcan/HexMatch), an isometric
transport-tycoon + match-3 game (TypeScript, Vite, canvas). You do ONE ticket:
AL-1 — "AL-1: confirm Asset Lab works and produce the missing vehicle source images". The TICKET block at the end of this prompt is the spec
(there is no GitHub issue to read). Where it and an OLDER ticket or doc
disagree, this ticket wins.

READ FIRST: AGENTS.md, docs/AGENT_PLAYBOOK.md (sections 2 and 3 are binding),
docs/HANDOVER-2026-10-03.md and docs/HANDOVER-2026-10-03-b.md (current state,
known gaps), then the TICKET below in full, then the files it names.

SETUP
  Your arena session starts on a PRESET branch name. Keep that branch name and
  REBASE it on the base branch named in THE WORK:
    git fetch origin && git rebase origin/main
  then npm ci. If the rebase conflicts, keep BOTH sides of any conflict unless
  one side is plainly superseded, and say what you chose in the PR.
  Never force-push over commits you did not write.

TESTING — BINDING (docs/AGENT_PLAYBOOK.md §2)
  • NEVER run: npm test, npm run test:all, npm run test:slow, npm run test:e2e*,
    npx playwright, or vitest with no file arguments. The lead runs those.
  • Run ONLY the test files named below plus any test file you add, ALWAYS in
    the background, and poll the log:
      (npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo EXIT $? >> /tmp/t.log) &
      ... keep working ... then: tail -30 /tmp/t.log
  • Typecheck in the background the same way (~45 s), BOTH configs:
      (npx tsc --noEmit -p . > /tmp/tsc.log 2>&1; npx tsc --noEmit -p tsconfig.e2e.json >> /tmp/tsc.log 2>&1; echo EXIT $? >> /tmp/tsc.log) &
  • Known failures/flakes: some e2e specs time out on slow CI runners and
    `mp-battle` B6 is quarantined; the long simulations are in test:slow.
    Anything else in your files is yours to fix. Never loosen or skip a test you
    did not write. Do not edit docs/BALANCE.md (it is generated).
  • Never run tests/unit/iso-game.test.ts, iso-ai-sweep, iso-rebalance,
    battle-ai-sim or match3-balance-bot.
  • If one test run takes more than 5 minutes, kill it, note it in the PR, move on.
  • Don't install browsers or start a dev server to verify: write browser
    checks in the PR as "for the lead to play-test" (give exact steps: URL with
    ?three=1 where relevant, keys, __iso twins to call, what to look at).

DELIVER
  • Commit in small steps. Rebase on origin/main again before opening the PR.
  • PR base branch: main. PR title "AL-1: confirm Asset Lab works and produce the missing vehicle source images", body starts with
    "Ref AL-1" (there is no issue to close).
  • PR body: what changed, each acceptance box with HOW you checked it, the exact
    test files you ran and their result, what you could NOT verify (the lead
    play-tests), follow-ups you noticed but did not do.
  • Do not merge. Do not deploy. Do not push to main.
  • If "gh pr create" says a PR already exists for your branch, STOP and tell
    the owner. Never push onto someone else's PR or force-push over commits you
    did not write.
  • Stay inside the areas this ticket names (Repos/asset-lab (a separate repo, local only; NOT rumcan/HexMatch): main.js, index.html; docs/ asset notes in HexMatch only); if it needs more, say so
    in the PR.
  • Do NOT generate, edit or re-export any image, 3D model or audio. The lead
    does all art and audio (placeholders are fine; list the file names you need).
    Exception only where the ticket says so for a .glb it names.
  • Saves stay backward-compatible (old saves load) and new MP/snapshot wire
    fields are optional.
  • Frame rate is the top priority for anything in the 3D layer or the render
    loop: add no per-frame allocation, no extra draw calls per building, no
    extra full-canvas passes. State in the PR what you did to protect fps.

CURRENT STATE OF THE GAME (2026-10-03 — read it; older tickets predate it)
  • Economy: every BUILD costs money ($, BUILD_COSTS_MONEY, canPayBuild /
    spendBuild in game.ts); city upgrades cost resources. Manager perks price
    builds through perkPrice() in src/iso/managers.ts; a host match setting
    can turn perks off (perkManagerOf).
  • The FLEET epic (#594) is merged: buy/upgrade trucks and trains, wagons per
    cargo, the Passing Loop with block reservation (src/iso/rail-blocks.ts).
    Rail may cross a road at 90 degrees (crossingRefusalAt in src/iso/rail.ts);
    trainSpawnHint explains why no train spawned (#650).
  • Multiplayer: a joined guest's seat is human on the host; the Multiplayer
    menu tab is hidden behind a PIN (src/ui/mp-gate.ts, ?mp=1949). The traffic
    and vehicle sims are SHARED host/guest: keep them deterministic, no
    Math.random in sim code.
  • CI: the unit suite is sharded 3 ways and the e2e suites 6 ways; the long
    whole-race simulations live in `npm run test:slow`. `main` should be green;
    some e2e specs still time out on slow CI runners — those are known flakes.
  • Towns: tiles are laid on a fixed 3-tile street lattice (TOWN_BLOCK = 3,
    townLayout / townBuildings / mergeTownBlocks in src/iso/grid.ts). Tiers 0-3
    grow a town (src/iso/town-growth.ts, grownTownHouses). CITY-1 (#657) fills
    free lots with ordinary 1x1 houses (TOWN_HOME_VARIANTS, townLotFiller) and
    CIVIC-1 (#658) lays hospitals/schools/stadiums (CIVIC_BUILDINGS in
    config.ts, layCivicBuildings). Old saves keep the towns they were saved
    with; do not change footprints of saved towns without a migration.
  • Live 3D (NOT on main): branch `feat/live-3d-rotation-wip` has a three.js
    layer (src/iso/three-layer.ts, behind ?three=1), 60+ building models plus
    vehicles, platform and depot in public/models/*.glb, camera rotation on `[`
    and `]` (view yaw in quarter turns about tile (0,0): src/iso/camera.ts,
    depth.ts turnPlaced/turnFootprint/turnTilePoint/yawQuarter, elevation.ts
    pickTile(yaw), road-renderer.ts RoadCache.paint, terrain-gl shaders uYaw).
    Clouds are off (CLOUDS_ENABLED=false in renderer.ts). The raw Meshy models
    (tools/art-src/meshy/*/model.glb, 401 MB) are git-ignored, so you cannot
    rebuild models from source; the built public/models/*.glb ARE committed
    (tools/models/build-models.mjs documents the pipeline).
  • Art: per-building PNGs in assets/buildings/ compiled from
    assets/buildings-src/ (tools/make-building-pngs.mjs). The lead makes all
    art and audio.
  • UI: paper cards, ORANGE buttons (never lemon), flat colours, no gradients.
  • This repo's game is the ENGINE for a game-jam entry; keep changes
    backward-compatible and behind options where a ticket says so.
  • RUN store / RUN Bits / MON-2 / MON-3 are OUT of scope.
  • Other agents work in parallel; rebase on origin/main before the PR and
    keep both sides of any conflict.
  • Dev notes for the lead's play-test: only one Vite can use the run.game SDK
    port 9001; set RUNDOT_DEV_ROOM_PORT=9011 for a second server.

THE WORK
  Implement this ticket exactly as its Build and Acceptance sections say.
  Base branch: origin/main.

TARGETED TESTS (background only)
  NONE in HexMatch. Verify Asset Lab by opening it (the lead provides the private link from `rundot game info` run inside Repos/asset-lab).

TICKET AL-1 — AL-1: confirm Asset Lab works and produce the missing vehicle source images
CONTEXT. Asset Lab is a private run.world app (game id q0w494FMMiDFRbLiL3tj). It generates source images
for the vehicles that have no model of their own (pickup, bus, van, and five wagon types) through
RundotGameAPI.imageGen (Gemini), with the existing art as style references. Its loading screen was stuck; a fix
was deployed on 2026-10-03: main.js now calls RundotGameAPI.preloader.hideLoadScreen() at start (try/catch).
It has NOT been confirmed visually. imageGen does NOT work on the local dev server (needs the backend), so this
must be checked on the deployed private link.

DO NOT: set the app public, create accounts, enter any credentials or tokens, or write the GPU-box bearer
token anywhere. Those are the owner's. If login or approval is needed, stop and ask the owner in the PR/notes.

BUILD
1. Open the private link (owner supplies it). Confirm the loading screen is gone and the 8 presets render
   (car_pickup, car_bus, car_van, wagon_grain, wagon_wood, wagon_ore, wagon_stone, wagon_gold).
2. Run each preset; check the result is ONE whole vehicle, isometric three-quarter view, flat white background,
   matching the game's 1950s hand-painted palette (see the STYLE and NEG strings in main.js). Regenerate
   (change seed / tweak the prompt) up to 3 times per preset until acceptable; keep the best.
3. Download the images and place them in HexMatch tools/art-src/hunyuan/<preset-id>.png (the folder exists,
   untracked). Do NOT commit them to git; list the file names.
4. If a preset is consistently bad, edit its prompt in Repos/asset-lab/main.js, rebuild (`npx vite build`) and
   redeploy (`rundot deploy --build-path ./dist`), and record what you changed.
5. Write docs/asset-lab-notes.md in HexMatch: which presets are done, which need hand art, and the next step
   for each image (Hunyuan image-to-3D on the GPU box, then tools/models/build-models.mjs + a VEHICLE_MODEL
   entry). Do NOT run Hunyuan yourself unless the owner says the GPU box is up.

ACCEPTANCE
[ ] Loading screen confirmed gone (say how you checked).
[ ] 8 images produced, or a reason per missing one.
[ ] docs/asset-lab-notes.md written; image files named; nothing committed that is over 5 MB.
[ ] Nothing made public, no credentials touched.
```
