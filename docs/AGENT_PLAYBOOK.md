# HexMatch — Agent Playbook (arena.ai)

How we push a lot of code through quickly without breaking `main`:

- **Agents** (arena.ai) write the code for ONE ticket each, run only **targeted**
  tests **in the background**, and open a PR. They never merge.
- **The lead** (the owner's Claude Code session) runs the full unit suite, the
  Playwright/e2e suites and a play-test on every PR, fixes what broke, merges,
  and deploys. Agents never run Playwright, e2e or the full suite — that is
  where they got stuck before.
- Tickets run in **waves** (§4). A wave's tickets touch different files, so
  they can run in parallel; the next wave starts when the lead has merged the
  previous one.

---

## 1. The preamble — paste this at the top of EVERY agent prompt

```text
You are working on HexMatch Industries (repo rumcan/HexMatch), an isometric
transport-tycoon + match-3 game (TypeScript, Vite, canvas). You do ONE ticket.

READ FIRST: AGENTS.md, docs/AGENT_PLAYBOOK.md (sections 2 and 3 are binding),
then your ticket (gh issue view <N> --repo rumcan/HexMatch) and every ticket it
says it is blocked by. The ticket text is partly out of date — where this
prompt disagrees with the ticket, THIS PROMPT WINS. In particular: railways are
ON in the game now (Rail + Platform tools, trains spawn on their own, a
platform at an industry works like a Depot); ignore any "railways are off /
DEV-only" line. "Don't touch the renderer" is lifted where the prompt says so.

SETUP
  git fetch origin && git switch -c <branch> origin/main && npm ci

TESTING — BINDING (docs/AGENT_PLAYBOOK.md §2)
  • NEVER run: npm test, npm run test:all, npm run test:slow, npm run test:e2e*,
    npx playwright, or vitest with no file arguments. The lead runs those.
  • Run ONLY the test files named in this prompt plus any test file you add,
    ALWAYS in the background, and poll the log:
      (npx vitest run <files> --reporter=dot > /tmp/t.log 2>&1; echo EXIT $? >> /tmp/t.log) &
      ... keep working ... then: tail -30 /tmp/t.log
  • Typecheck in the background the same way (it takes ~45 s):
      (npx tsc --noEmit -p . > /tmp/tsc.log 2>&1; echo EXIT $? >> /tmp/tsc.log) &
  • A failure listed in docs/AGENT_PLAYBOOK.md §3 is pre-existing: leave it.
    Anything else in your files is yours to fix. Never loosen or skip a test
    you did not write.
  • If one test run takes more than 5 minutes, kill it, note it in the PR,
    and move on. Do not wait on tests.

DELIVER
  • Commit in small steps. Rebase on origin/main before opening the PR.
  • PR title "<ticket id>: <title>", body starts with "Closes #<N>".
  • PR body: what changed, each acceptance box with HOW you checked it,
    the exact test files you ran and their result, what you could NOT verify
    (the lead will play-test it), follow-ups you noticed but did not do.
  • Do not merge. Do not deploy. Do not push to main.
  • Stay inside the files/areas this prompt names; if the ticket needs more,
    say so in the PR instead of doing it.
```

---

## 2. Testing contract (why, and the details)

| Agent does | Lead does (per PR, before merge) |
| --- | --- |
| `npx tsc --noEmit -p .` in the background | full `npm test` |
| the named `tests/unit/*.test.ts` files, in the background | `npx playwright test --project=desktop-chromium` (+ mp suite when net code changed) |
| new unit tests for the ticket's own logic | `npm run test:slow` when economy/AI changed |
| describes what to look at in the PR | plays the game and checks the acceptance boxes |

Background = the shell pattern in the preamble, or the agent tool's own
"run in background" option. The agent must keep working while tests run and
must never block its whole session on one run.

Dev server: agents MAY start `npm run dev` for a quick look if their sandbox
has a browser, but it is optional. If port 9001 is taken, start it with
`RUNDOT_DEV_ROOM_PORT=9011`. The lead does the real play-test.

## 3. Known pre-existing failures on main (agents: ignore these)

Leave these alone; the lead fixes them separately.

- `tests/unit/iso-rail.test.ts` — 6 cost/refund tests (costs were tripled).
- `tests/unit/iso-track.test.ts` — "an unaffordable drag previews and builds only the affordable prefix".
- `tests/unit/iso-ai.test.ts` — "E7 planning > builds dirt when it cannot afford road".
- `tests/unit/iso-ai-sweep.test.ts` — two sweeps (slow; don't run it).
- `tests/unit/iso-rail-art.test.ts` — fails to load (old art generator).
- `tests/unit/iso-rebalance.test.ts` — dirt-cost assertion (slow; don't run it).
- Seed-pinned corridor/victory tests broken by the map-quota change
  (`iso-l13-victory`, `iso-l1f-default-loop` bare boot, `iso-l8-legibility` depot hover, `net-protocol` version pin).

If in doubt: run that ONE file on a clean `origin/main` worktree, in the background.

---

## 4. Order of work (waves)

Parallel inside a wave; a wave starts when the lead has merged the previous
one. "Hot files" are the ones two tickets must not both rewrite at once.

| Wave | Ticket | Area / hot files | Blocked by |
| --- | --- | --- | --- |
| **0** | Lead: ticket housekeeping (§6) | GitHub only | — |
| **1** | #302 Preload behind the loading screen | `loading-screen.ts`, boot in `game.ts` | — |
| 1 | #300 Tuning results pop-up | `ui.ts` session board, `tuning.ts` | — |
| 1 | #343 ART-1 Ocean & beach refresh | `assets/ground`, `tools/` | — |
| 1 | #271 F1 Building templates & tool | `tools/` only | — |
| 1 | #255 C1 Chat protocol | `src/net/*` | — |
| **2** | #298 Nothing built through factories/town buildings | `track.ts`, `placement.ts`, `grid.ts` `builtAt` | — |
| 2 | #272 F2 Engine support for non-square buildings | `depth.ts`, `building-shadow.ts`, `camera.ts`, `atlas.ts` | — |
| 2 | #254 M1 Minimap | new `src/iso/minimap.ts`, small `ui.ts` hook | — |
| 2 | #257 C2 Chat panel | `ui.ts` chat panel | #255 |
| 2 | #181 Railways: multiplayer + saves | `rail.ts` wire, `snapshot.ts`, save runtime | — |
| **3** | #260 R1 Rivers | `grid.ts` generation, `coastline.ts`, `ground.ts` | ART-1 |
| 3 | #274 F3 Building rotation | placement in `game.ts`, `plants.ts` | #272 |
| 3 | #273 F5 Art: first non-square buildings | `assets/`, `tools/` | #271 |
| 3 | #256 M2 Minimap sabotage events | `minimap.ts`, protest/bandit hooks | #254 |
| **4** | #266 R2 Bridges | `track.ts`, `rail.ts`, road/rail renderers, `ai.ts` | #260 |
| 4 | #275 F4 Use the new shapes | towns/industries/depots placement | #273, #274 |
| 4 | #258 M3 Sabotage event animations | minimap event window | #256 |
| **5** | #270 R3 Dams | new `dams.ts`, economy factor, art | #266 |
| 5 | #261 E1 Elevation data | `grid.ts` | #260 |
| **6** | #267 E2 Draw elevation | `ground.ts`, renderers | #261 |
| **7** | #269 E3 Buildings/vehicles/picking on elevation | `depth.ts`, `camera.ts`, renderer | #267 |
| **8** | #268 E4 Slope rules & uphill costs | `track.ts`, `rail.ts`, `ai.ts`, costs | #269 |
| **9** | ROADS-45 Angled roads (optional — owner decides) | `track.ts`, `road-geometry.ts`, `vehicles.ts`, `ai.ts` | #266, #268 |
| **10** | #252 B7 Battle balance & onboarding | `battle*.ts`, config, docs | everything that changes the economy |

Why this order: rivers need the new water art; bridges need rivers; dams need
bridges; elevation comes after rivers so rivers can later run downhill;
angled roads last because they touch the same track core as bridges and
slopes; battle balance last because every economy change above moves it.

---

## 5. Ticket prompts

Each block goes UNDER the preamble (§1). Branch names are suggestions.

### #302 — Preload behind the loading screen  (wave 1)
```text
Ticket #302. Branch: fix/302-preload.
Goal: the loading screen stays up until everything the first frame needs is
ready (atlases, building/vehicle/rail/scenery art, ground textures, gem
sprites, fonts via document.fonts.ready, the map, one rendered frame); the
progress bar tracks those real steps; the economy and rival clocks start only
when the game is shown.
Look at: src/iso/loading-screen.ts, startIsoGame in src/iso/game.ts (the
`loading.track(...)` calls), src/iso/rail-art.ts, scenery/ground loaders.
Do not change what is drawn — only when the game is revealed.
Targeted tests: tests/unit/iso-loading-screen.test.ts, tests/unit/main-menu.test.ts
(+ a new test for "clocks don't start before reveal" if you can make it pure).
In the PR say how to check it with network throttling; the lead will verify.
```

### #300 — Tuning results pop-up  (wave 1)
```text
Ticket #300. Branch: feat/300-tuning-results.
Goal: when a tuning session ends (moves used up after cascades settle, or
Finish pressed) a results pop-up over the session window animates the score,
the yield it sets, and 1–3 stars; one Confirm button applies exactly that
result. Abandon does not show it. Star thresholds in ONE table in
src/iso/config.ts, derived from the score→yield curve in src/iso/tuning.ts.
The session window already exists (#299). Platforms at industries use the
same session — make sure they get the pop-up too.
Look at: src/game/ui.ts (openSessionBoard / session plate), src/iso/tuning.ts,
closeTuningSession in src/iso/game.ts.
Targeted tests: tests/unit/iso-l4-tuning.test.ts, tests/unit/iso-299-session-window.test.ts,
tests/unit/iso-301-finish.test.ts, + a new unit test for the star thresholds.
```

### #343 ART-1 — Ocean & beach refresh  (wave 1, art)
```text
Ticket #343 (ART-1). Branch: art/343-ocean-beach.
Goal: a better-looking sea and beach. Follow docs/ART_PIPELINE.md (sections
2–6). Make 2–3 candidates for each:
  • sea: rundot generate image (texture template, reference assets/ground/grass.png;
    a first test is in tools/art-src/tests/ocean-2026-09-24-raw.png) →
    tools/texture-src/water-src.png → node tools/make-ground-textures.mjs water
  • beach: python tools/terrain/make_terrain_art.py sand (code-drawn, muted
    beige) and/or a generated one → same pipeline
Palette targets are in ART_PIPELINE §4. Keep the shallow-water and foam
bands in src/iso/ground.ts; you MAY tune their colours only.
Put every candidate's 2×2-tiled preview in the PR so the owner can choose;
ship your best pick. Budget: at most 20 generations. RUNDOT_API_KEY is in
your environment.
Targeted tests: tests/unit/iso-ground.test.ts, tests/unit/iso-detail-tiers.test.ts,
tests/unit/iso-coastline.test.ts.
```

### #271 — F1 Building templates & build tool  (wave 1, tools only)
```text
Ticket #271. Branch: tools/271-footprint-templates.
Do exactly the ticket (templates and make-building-pngs for 1×2, 2×1, 1×3,
3×1, 4×2, 2×4; footprint declared, not guessed from canvas size). Tools and
assets/buildings-src only — no game code.
Note: rail platforms are already 1×3/3×1 with their own cutter
(tools/railway/cut_platform.py) — use it as a reference for anchoring on the
south vertex; don't change it.
Targeted tests: tests/unit/iso-building-pngs.test.ts, tests/unit/iso-building-footprint.test.ts.
```

### #255 — C1 Chat protocol  (wave 1)
```text
Ticket #255. Branch: net/255-chat-protocol.
Do the ticket: ChatMsg in the protocol union + HEX_MESSAGE_TYPES, protocol
version bump, limits on send AND receive, sanitising, word filter, mute,
presets, presets-only setting, __iso.sendChat hook. No UI beyond the hook.
The "two clients exchange messages" e2e box is the lead's — write the unit
tests; describe the e2e check in the PR.
Targeted tests: tests/unit/net-protocol.test.ts (its version pin is a known
failure — update the pin to your new version), tests/unit/net-session.test.ts,
tests/unit/net-room.test.ts, + a new tests/unit/net-chat.test.ts.
```

### #298 — Nothing built through factories and town buildings  (wave 2)
```text
Ticket #298. Branch: fix/298-build-overlap.
Current state (newer than the ticket): Grid.builtAt (src/iso/grid.ts, set in
src/iso/game.ts) already stops roads/depots/rail/platforms overlapping each
other and roads running along rail (PR #339). What remains: Processing
Plants/the Factory and town buildings as obstacles for the OTHER seat's
roads and rail, and for depot placement, in every rotation — while a player
may still step a drag over their OWN plant (PP-15, `structures` in
previewDrag). Extend builtAt (add a "plant" kind) rather than adding a
second mechanism; the rival's planner reads the same grid.
Targeted tests: tests/unit/iso-track.test.ts, tests/unit/iso-placement.test.ts,
tests/unit/iso-plants.test.ts, tests/unit/iso-factory.test.ts (+ new cases).
```

### #272 — F2 Engine support for non-square buildings  (wave 2)
```text
Ticket #272. Branch: engine/272-non-square.
Renderer exception: you may change depth.ts sorting, building-shadow.ts,
camera.ts cull pad, atlas picking. Do the ticket with synthetic defs.
Rail platforms (1×3/3×1, src/iso/rail.ts railStructureItems) are a live
example of long thin footprints next to moving trains — include them in the
depth-sort tests.
Targeted tests: tests/unit/iso-depth.test.ts, tests/unit/iso-building-footprint.test.ts,
tests/unit/iso-renderer.test.ts, tests/unit/iso-atlas-building-layers.test.ts.
```

### #254 — M1 Minimap  (wave 2)
```text
Ticket #254. Branch: feat/254-minimap.
Do the ticket. New module src/iso/minimap.ts; keep src/game/ui.ts changes to
mounting + the phone toggle. Show rail and platforms too (rail layer:
railDrawLayer in src/iso/rail.ts). Redraw on change only (netVersion /
rail.revision), viewport rect on camera change. Leave a marker API for #256.
Targeted tests: tests/unit/iso-camera.test.ts + a new tests/unit/iso-minimap.test.ts
(pure: world→minimap mapping, click→camera target, redraw gating).
```

### #257 — C2 Chat panel  (wave 2, after #255 is merged)
```text
Ticket #257. Branch: feat/257-chat-panel.
Do the ticket on top of #255's protocol. UI in src/game/ui.ts (a collapsible
panel; text rendered as text only). Presets as buttons. Mobile: follow the
MOBILE rules already in ui.ts.
Targeted tests: tests/unit/net-chat.test.ts, tests/unit/ui-responsiveness.test.ts
+ a new UI unit test (jsdom) for rendering/escaping.
```

### #181 — Railways: multiplayer + saves  (wave 2)
```text
Ticket #181, REWRITTEN (the old text describes a design we dropped).
Branch: rail/181-mp-saves.
Current rail design: Rail + Platform tools; no train depot and no buying
(trains spawn via autoTrains in src/iso/rail.ts on the host); a platform at an
industry is a Depot record (Harvester.platformId/railIndustryId in
src/iso/economy.ts) with a tuning session; diagonal track is stored in rail
tile bits 32/64 (RAIL_DE/RAIL_DS); train trails (state.trails) are local and
NOT on the wire.
Do:
  1. Guests: every rail action (rail drag, platform place, demolish) goes
     through a host intent and is validated on the host with the same rule
     functions (railPreview/buildRail/platformRefusal/layPlatformTrack) —
     find any path that doesn't and fix it.
  2. Host runs autoTrains; guests only render (no autoTrains on guests).
  3. Save/restore: rail layer (incl. diagonal bits), structures, lines,
     trains and platform-Depot records round-trip; an old save with no rail
     loads with empty rail.
  4. Guests show platform-Depots correctly (label, depot card, no truck).
Targeted tests: tests/unit/iso-rail-wire.test.ts, tests/unit/iso-rail-180.test.ts,
tests/unit/iso-snapshot.test.ts, tests/unit/iso-l1e-save.test.ts,
tests/unit/iso-l17-save.test.ts, tests/unit/net-delta.test.ts.
Two-browser checks are the lead's — list them in the PR.
```

### #260 — R1 Rivers  (wave 3)
```text
Ticket #260. Branch: map/260-rivers.
Renderer exception: you may change src/iso/ground.ts / coastline.ts for river
banks. Art: a river water texture per docs/ART_PIPELINE.md (generated or
`python tools/terrain/make_terrain_art.py river`), shown with 2×2 preview in
the PR. Rivers behind a `rivers` map option; option OFF must generate every
existing seed byte-for-byte as today (test it).
Rivers must also block rail and platforms (railTerrainOk in src/iso/rail.ts)
and be visible to Grid.builtAt consumers as water.
Targeted tests: tests/unit/iso-grid.test.ts, tests/unit/iso-coastline.test.ts,
tests/unit/iso-ground.test.ts, tests/unit/iso-public-roads.test.ts,
tests/unit/iso-town-roads.test.ts + a new reachability test over ~50 seeds.
```

### #274 — F3 Building rotation  (wave 3, after #272)
```text
Ticket #274. Branch: feat/274-rotation.
Do the ticket. Copy the rail precedent: railView + R in src/iso/game.ts and
footprintFor in src/iso/rail.ts. Orientation saved + on the wire.
Targeted tests: tests/unit/iso-placement.test.ts, tests/unit/iso-plants.test.ts,
tests/unit/iso-depot-geometry.test.ts, tests/unit/iso-snapshot.test.ts.
```

### #273 — F5 First non-square building art  (wave 3, after #271)
```text
Ticket #273. Branch: art/273-shapes.
Generate per docs/ART_PIPELINE.md (§4 sprite template, references from
assets/buildings/), process with the #271 tools. Budget ≤ 30 generations.
Contact sheet on footprint diamonds in the PR.
Targeted tests: tests/unit/iso-building-pngs.test.ts, tests/unit/iso-atlas-building-layers.test.ts.
```

### #256 — M2 Minimap sabotage events  (wave 3, after #254)
```text
Ticket #256. Branch: feat/256-minimap-events.
Do the ticket using #254's marker API. Protests and blockades are in
src/iso/protest.ts and the black-market code in src/iso/game.ts.
Targeted tests: tests/unit/iso-minimap.test.ts, tests/unit/iso-protest.test.ts.
```

### #266 — R2 Bridges  (wave 4, after #260)
```text
Ticket #266. Branch: map/266-bridges.
Renderer exception for bridge decks. Must work for roads AND rail — rail
includes the 45° diagonal links (RAIL_DE/RAIL_DS) and the 45° turn rule
(railPath in src/iso/rail.ts): a bridge is straight, so a diagonal may not
start or end on it. Bridge art may be generated (ART_PIPELINE §7) or vector.
The rival's road planner (planRailRoute/findPath in src/iso/ai.ts) must be
able to plan one.
Targeted tests: tests/unit/iso-track.test.ts, tests/unit/iso-rail.test.ts,
tests/unit/iso-rail-geometry.test.ts, tests/unit/iso-road-geometry.test.ts
+ new bridge tests. Don't run iso-ai-sweep; describe the rival check for the lead.
```

### #275 — F4 Use the new shapes  (wave 4)
```text
Ticket #275. Branch: feat/275-use-shapes. Do the ticket with #273's art and
#274's rotation. Seeds with shapes off must be unchanged.
Targeted tests: tests/unit/iso-grid.test.ts, tests/unit/iso-town-art.test.ts,
tests/unit/iso-placement.test.ts.
```

### #258 — M3 Sabotage event animations  (wave 4)
```text
Ticket #258. Branch: feat/258-event-anim. Do the ticket inside #256's event
window; CSS/canvas only, no gameplay change. Art (if any) per ART_PIPELINE.
Targeted tests: tests/unit/iso-minimap.test.ts.
```

### #270 — R3 Dams  (wave 5, after #266)
```text
Ticket #270. Branch: map/270-dams. Use design option 1 (hydro dam: output
bonus to nearby Depots — including platform-Depots — and the city, through
the clock-income factors). Art: follow ART_PIPELINE §7 "Dams" — a first raw
test is tools/art-src/tests/dam-2026-09-24-raw.png (regenerate WITHOUT the
ground block); two headings by mirroring; new assets/rivers/manifest.json
and a loader modelled on src/iso/rail-art.ts.
Targeted tests: tests/unit/iso-economy.test.ts, tests/unit/iso-l3-distance.test.ts
+ new tests/unit/iso-dams.test.ts.
```

### #261 — E1 Elevation data  (wave 5)
```text
Ticket #261. Branch: map/261-elevation-data. Data only, behind an
`elevation` option; option off = identical seeds. Rivers (#260) must stay at
the lowest level along their course.
Targeted tests: tests/unit/iso-grid.test.ts + new height tests.
```

### #267 — E2 Draw elevation  (wave 6)
```text
Ticket #267. Branch: render/267-elevation. Renderer exception. Roads AND the
vector rail (src/iso/rail-geometry.ts, incl. diagonal legs) must follow the
slopes. Cached like today; note fps before/after.
Targeted tests: tests/unit/iso-ground.test.ts, tests/unit/iso-renderer.test.ts,
tests/unit/iso-road-geometry.test.ts, tests/unit/iso-rail-geometry.test.ts.
```

### #269 — E3 Buildings, vehicles and picking on elevation  (wave 7)
```text
Ticket #269. Branch: render/269-elevation-objects. Include train cars
(carPlacements in src/iso/rail.ts) and platforms.
Targeted tests: tests/unit/iso-depth.test.ts, tests/unit/iso-camera.test.ts,
tests/unit/iso-renderer.test.ts.
```

### #268 — E4 Slope rules and uphill costs  (wave 8)
```text
Ticket #268. Branch: map/268-slopes. Trains: no diagonal on a slope; the 45°
rule still applies. Rival planners must price slopes.
Targeted tests: tests/unit/iso-track.test.ts, tests/unit/iso-rail.test.ts,
tests/unit/iso-costs.test.ts. Describe the rival check for the lead.
```

### ROADS-45 — Angled roads  (wave 9, OPTIONAL — only if the owner says go)
```text
Branch: map/roads-45. Replaces #259/#262/#263/#265 for ROADS (rail already
has diagonals: see RAIL_DE/RAIL_DS, octPath and railPath in src/iso/rail.ts
and the diagonal legs in src/iso/rail-geometry.ts — copy that design:
diagonal links stored once on the lower-x tile, octilinear drag, no 90° turns
for vehicles is NOT required for roads). Trucks and the rival's findPath must
use diagonals.
Targeted tests: tests/unit/iso-track.test.ts, tests/unit/iso-road-geometry.test.ts,
tests/unit/iso-road-cache.test.ts, tests/unit/iso-vehicles.test.ts.
```

### #252 — B7 Battle balance & onboarding  (wave 10, last)
```text
Ticket #252. Branch: balance/252-battles. Battles changed a lot since the
ticket (Puzzle-Quest layout, match damage, 20-turn limit, territorial fights
#322/#323). Balance against the CURRENT rules; write docs/battle-balance.md.
Targeted tests: tests/unit/battle.test.ts, tests/unit/battle-abilities.test.ts,
tests/unit/battle-ai.test.ts. battle-ai-sim is slow: run it ONCE, in the
background, with a 10-minute cap.
```

---

## 6. Wave 0 — housekeeping (done 2026-09-24)

- Closed as done: #223, #299. Closed as superseded: #142, #179. Closed as stale: #297.
- #181 rewritten to the current rail design. ART-1 created as #343.
- Still open for the owner: #296 (ring roads exist since PP-10 — close?), #210 (branch protection), angled roads (wave 9) yes/no.

## 7. The lead's merge loop (per PR)

1. `gh pr checkout <n>`; rebase on main if needed.
2. `npx tsc --noEmit -p .` and the full `npm test` (background).
3. `npx playwright test --project=desktop-chromium` (+ `test:e2e:mp` for net
   changes, `test:slow` for economy/AI).
4. Play the acceptance boxes in `npm run dev`.
5. Fix small things on the branch; bounce big ones back to the agent with the
   failing output.
6. Squash-merge, then start the next ticket in the wave queue.
