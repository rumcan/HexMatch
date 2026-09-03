HexMatch — open backlog

Supersedes HexMatch-open-backlog.md. Audited against main @ fc4ebb4: npm ci, tsc --noEmit clean, 242 unit tests passing across 17 files.

Work order: G6 → G8 → E8 (pass 2) → E11 → R9.

Landed since the audit

- E11 round test flake fixed: the setup→connect→score unit test picked
  `industries[0]` unconditionally; on ~8.5% of random map seeds that industry
  sits near the map's bottom edge, so the factory tile landed off-map and the
  round never scored. Both iso-game round tests now share a legal-corridor
  scan (bounds + water + occupancy). 242/242 stable across repeated runs.
- E12 cutover (iso standalone default, legacy behind `?legacy=1`):
  `src/game/main.ts` → `src/game/main-legacy.ts` (unchanged code + own
  stylesheet import), App.tsx lazy-imports the legacy branch so the default
  bundle no longer ships the hex game / three.js; e2e legacy suites boot the
  flag URL. README documents both entry points.
- E12 DOM e2e: `tests/e2e/iso-game.spec.ts` boots the default route in a real
  browser and plays a full round (factory → harvester → road drag → +1 VP)
  with real pointer events, real rAF rendering and canvas-pixel checks, no
  mocking. `window.__iso.tileScreenAt` added as the e2e coordinate probe
  (mirrors `__hex.view.screenPosOf`).
- Verified: typecheck clean, 242 unit tests, iso e2e green on desktop
  chromium; slice-atlas reproduces assets/iso-atlas byte-identically (G7 CI
  gate stays green).

Verification of the last batch

Each claim was checked against source and against the rebuilt atlas, not taken on trust.

Ticket	Verified	Evidence
G1 road/rail directions	✅	dirs table in slice-atlas.mjs now matches the four edge midpoints exactly. I re-derived it independently from the atlas: for all 16 masks, every set bit has pixels within 2px of its expected midpoint and every unset bit has none. road_1111 renders four arms.
G2 white seam row	✅	Scanned every terrain_* sprite's bottom row in atlas@1x.png for opaque white — none found.
G3 interior lakes	✅	Lake loop gone; comment documents keeping only the largest 4-connected landmass so ragged islets can't strand industries. Reachability test present in iso-grid.test.ts.
G4 depot size	✅	depot_blue is now 48×36 (was 65×51), anchor [24,35], four tints. Within the ≤64×40 target.
G5 network-grown track	✅	canBuildOn takes an optional network: Set<number>; previewDrag carries a growing set so a drag extends tile by tile without jumping gaps.
G7 atlas CI	✅	.github/workflows/ci.yml runs slice-atlas then git diff --exit-code assets/iso-atlas/.
E8 first pass	✅	VP_TARGET = 12, START_PURSE = { stone: 12, ore: 0 }, quotas raised (farm 5, forest 6, ore_mine 5, quarry 4). Rail gating is real — rail needs 2 ore and you start with none.
R6 seed	✅	resolveMapSeed() and joinFromSnapshot() replace the bare Math.random() call in game.ts.

The road-direction fix is worth calling out: the independent pixel check across all 16 masks passed clean, which is the strongest possible confirmation that the geometry is right rather than merely different.

Open
G6. Road/rail sprites are programmer-art lines, not OpenGFX track

[assets] [polish] — next up

makeGenerated() in tools/slice-atlas.mjs still draws road and rail as flat grey ([86,86,86]) and brown ([122,82,36]) line segments. The geometry is now correct, so this is purely a visual swap.

Replace the generated arms with real half-pieces sliced from OpenGFX:

Road: src/assets/sprites/png/landscape/landscape031.png
Rail: src/assets/sprites/png/infrastructure/rail/, with base-1005-rail-infra.pnml for sprite indices

Keep the compositing approach — slice one half-piece per kind, rotate and mirror into the four directions, overlay to build all 16 masks. Do not slice 16 separate sprites; alignment won't hold across separate crops.

Acceptance

The G1 pixel test still passes unchanged after the swap. This is the guard that matters — it proves the art change didn't move the connection points.
Half-pieces meet the tile edge at the exact midpoint and at consistent width, so two adjacent tiles form one continuous run with no step or gap.
Level crossing sprite added for tiles carrying both road and rail.
Contact sheet regenerated; CI atlas check green.
G8. Dark wedge artifacts scattered across grass tiles

[bug] [renderer] [investigate]

Blocked on fresh screenshots. G2 is fixed, so re-capture at the same zoom as the earlier close-up before doing anything else — the white-row bug may have been the whole cause.

If wedges persist, isolate in this order:

Render a full map of terrain_grass_a only, chunk caching disabled. If clean, the cache is at fault.
Re-enable chunk caching. If wedges return at 8×8 tile intervals, it's a chunk-boundary seam.
If they appear only where terrain_grass_b is placed, that variant is the problem — it renders noticeably more olive than grass_a and may be a field tile rather than grass.

Attach before/after captures to the ticket either way.

E8. Economy rebalance — pass 2

[design] [gameplay]

Pass 1 landed the structure. What it can't tell you is whether the curve is any good; that needs play.

The gating now works as designed: START_PURSE gives 12 stone and zero ore, and rail costs 2 ore + 1 stone, so you must road out to an ore mine before rail becomes available. Verify in play that this ordering actually bites — with ore_mine quota raised to 5 on a now-larger landmass, an ore mine may sit close enough to the start that rail is reachable almost immediately, which collapses the risk/reward choice into a menu.

Things to watch and tune:

Time-to-first-rail. If it's under a couple of minutes, either lower the ore quota or raise rail's cost.
Whether 12 stone plus the free setup track is enough to reach a first industry on a sparse map roll.
Whether VP_TARGET = 12 produces a game length you want, given road scores 1 and rail 3 per connection.
Whether the 1.6× rail throughput multiplier plus 3 VP makes road strictly obsolete once ore flows. If so, road needs a niche — cheaper on rough terrain is one lever already in the data (onRough).

File individual follow-ups per lever rather than one open-ended rebalance ticket.

E11. Cutover — delete the hex path

[chore]

Still present: src/game/hexmap.ts, src/map3d/MapView3D.ts, "three": "^0.185.1", the terrain .jpg textures, and the ?legacy=1 branch in App.tsx.

Removing three drops roughly 600KB from the bundle. Regenerate the T2 Playwright snapshots afterwards — all of them will need rebaselining against the iso renderer.

Hold until G6 and G8 are done. The legacy path is a useful comparison point while the iso renderer is still being corrected, and it costs nothing but bundle size to keep for now.

R9. Prune the OpenGFX asset tree

[chore] [repo-size]

src/assets/sprites/ is still 19MB — the whole OpenGFX tree including aircraft, ships, trains, toyland, arctic, tropical, African manager faces, .xcf/.psd sources and .pnml definitions. The game uses a small fraction.

Prune to terrain/, industries/, infrastructure/, landscape/, trees/temperate/, miscellaneous/ and the stations/ working files. Keep the OpenGFX attribution in the README regardless.

Do this after G6, which needs landscape031.png and the rail infrastructure sheets — and confirm the exact source list against tools/iso-atlas.cells.json before deleting, since the CI atlas check (G7) will now catch a missing source immediately. That's a nice property: run npm run slice-atlas after pruning and CI tells you if you cut too deep.