# HexMatch — backlog

Supersedes `HexMatch-tickets.md`. Everything worth keeping from that file is carried over below, renumbered, plus the isometric migration epic.

**Order of work:** K1 → T1/T2 → E0 → E1/E2/E3 → E4 → E5 → E6 → E7 → E8/E9/E10 → E11. The K-tickets are independent and can land any time. The T-tickets are a hard blocker on E4.

---

# Part 1 — Carried over (still valid after the migration)

## K1. Setup-phase build mode is cleared ~1s after it is armed, so rail/HQ highlights vanish
`[bug] [P0] [setup]`

**Symptom:** You start a game, the "Lay your first Rail" banner appears with glowing edges, and about one second later every glowing marker disappears. The banner stays up, so the game looks frozen. Clicking an edge afterwards does nothing.

**Root cause:** in `src/game/main.ts` the once-per-second housekeeping block inside `frame()` (~lines 107–116) is guarded only by `G.running && !G.won`, not by `!G.setupPhase`, unlike the two blocks directly above it. It runs:

```ts
if (G.buildMode && G.buildMode !== "toll" && G.buildMode !== "bandit"
    && COSTS[G.buildMode] && !canAfford(me, COSTS[G.buildMode].cost)) {
  clearMode();
}
```

During setup `G.buildMode === "road"` and the player has zero resources, so `canAfford` fails and `clearMode()` runs — setting `view.mode = null`, which empties `legalEdges` on the next `computeLegality()` and wipes the markers. Setup rails are free (`doRoad(p, id, true)`), so the check should not apply.

**Fix:** skip the auto-deselect while `G.setupPhase` is true, and ideally for any build that is currently free.

**Survives the migration** — this is in the frame loop, not the renderer. Fix it now regardless.

**Acceptance:** highlights stay lit for the whole setup phase with 0 resources; auto-deselect still works after setup; regression test added under T1.

---

## K2. `computeLegality()` runs on every animation frame
`[perf]`

`main.ts` line 121 calls `computeLegality()` inside the rAF loop. It iterates every vertex or edge and calls `canBuildRoad` / `canBuildSettlement` per element, 60× per second, even when nothing changed and even when no build mode is armed.

**Fix:** dirty-flag driven off the `build` / `build:mode` / `toll` bus events, or throttle to the 1s housekeeping cadence. Early-return when `view.mode` is null.

**Survives** — the legality function gets rewritten for stations in E6, but the dirty-flag pattern carries straight over. Doing it now means E6 inherits the right shape.

---

## K3. Viewport meta doesn't guard against browser gestures
`[bug] [mobile]`

`index.html` has `width=device-width, initial-scale=1.0` only. The canvas sets `touch-action: none`, but the surrounding page doesn't, so double-tap-to-zoom and iOS Safari pinch still fire over the UI panels. No `viewport-fit=cover` either, so the map is letterboxed by the notch and home indicator.

**Fix:** add `viewport-fit=cover`, `maximum-scale=1`, `user-scalable=no`; `overscroll-behavior: none` and `touch-action: manipulation` on `body`; `env(safe-area-inset-*)` padding on the top bar and bottom mobile nav.

**Survives** — HTML-level, renderer-agnostic.

---

## K4. `dist/` and `server/node_modules/` are committed
`[chore] [repo-hygiene]`

`.gitignore` contains only `node_modules/`. Build output and the server's vendored `ws` tree are checked in (14MB clone), so diffs are noisy and dependency updates never surface in review.

**Fix:**
```
node_modules/
**/node_modules/
dist/
*.local
.DS_Store
.vscode/
```
then `git rm -r --cached dist server/node_modules` and commit. **Check `server/Dockerfile` first** — if it copies `dist/` rather than running `npm ci && npm run build`, fix that before pushing or the Fly deploy ships an empty app.

---

## K5. No typecheck or lint; project metadata is scaffolding leftovers
`[chore] [dx]`

- `npm run build` is bare `vite build`, which does **not** typecheck — TS errors ship silently. Change to `tsc --noEmit && vite build`.
- No ESLint/Prettier, so the `any` casts through `main.ts` (`(v: any)`, `(d: any)`) go unchecked.
- `package.json` still says `"name": "react-vite-tailwind"`, version `0.0.0`, no description.
- `vite-plugin-singlefile` is a dependency but isn't referenced in `vite.config.ts` — wire it up or drop it. Note `config.ts` imports textures specifically so singlefile can inline them, so this may be a real regression.
- No README: no build/run instructions, no note that the room server is a separate process.

---

## K6. Room server hardening: unbounded payloads, no origin check, no rate limiting
`[bug] [security] [server]`

`server/server.js` relays whatever it's handed:
- `new WebSocketServer({ server })` has no `maxPayload`, so one client can push arbitrarily large `snapshot` frames and OOM the process.
- No `verifyClient` / origin allow-list — anyone can connect to `wss://hexmatch.fly.dev` and spam `create`, minting unbounded rooms (each held an hour) with no cap.
- No per-connection rate limit; `intent` / `snapshot` forwarded unthrottled.
- `msg.state` and `msg.payload` are forwarded unvalidated. The host trusts guest intents, so a malicious guest can send intents for a slot it doesn't own — the host should verify `from` maps to the assigned slot.

**Fix:** set `maxPayload` (a few hundred KB), cap rooms and rooms-per-IP, token-bucket per socket, validate message shapes, host-side slot ownership check.

**Fully survives** — `server.js` is untouched by the migration until E10.

---

## K7. Guests can join a room whose host has already left
`[bug] [server] [multiplayer]`

On host disconnect the room is kept for `ROOM_TTL_MS` with `closedAt` set, but `case "join"` never checks `closedAt` or `hostWs.readyState`. A guest joining in that window gets a `joined` message then sits in a dead lobby — `send(room.hostWs, ...)` silently no-ops because `send()` only writes when `readyState === 1`. There's also no way for a reloading host to reclaim the room; a reload mints a new code, so the "hold the room in case of reload" comment describes an unimplemented feature.

**Fix:** reject joins into a closed room with a clear error; add a `rehost` message keyed by a host token so a reloading host can reattach.

---

## K8. `MAX_PLAYERS` capacity check is hard to read
`[chore] [server]`

`if (room.guests.size + 1 >= MAX_PLAYERS)` mixes "guests plus host" with "would this join fit". It happens to allow the intended 3 guests, but breaks the moment `MAX_PLAYERS` changes. Rewrite as `if (room.guests.size >= MAX_PLAYERS - 1)` with a comment, or track `MAX_GUESTS` directly. Unit test the boundary.

---

### Closed as obsoleted by E4

Old tickets 5–9 (touch orbit unreachable, pinch anchoring, stale pinch state after a finger lifts, `resize()` using `window.innerWidth`, camera bounds clamping) and old ticket 2 (marker visibility) and old ticket 12 (no touch press feedback) were all fixes inside `MapView3D.ts`, which E11 deletes. An isometric renderer has no orbit — pan and zoom become a translate and a scale — so most of these stop existing rather than getting fixed.

**If a patch for these already exists and passes review, merge it** — you have to play the game during the migration, and merging costs nothing. If it's half-finished, close it. Don't start new work here.

The underlying *problems* are restated as acceptance criteria on E4.

---

# Part 2 — Test harness (blocker on E4)

## T1. Headless test harness
`[chore] [testing] [P0] [blocker]`

There is no test runner, no CI, no `test` script. Every bug above was found by reading source.

This must land **before** E4. The migration touches every system; without tests you'll be verifying a 48×48 map by hand on every commit. Some of these tests die with `hexmap.ts` — that's fine, they're earning their keep now and the harness itself is what carries forward.

**Scope**
- **Vitest** over the pure logic: `hexmap.ts` (seeded determinism, adjacency, `canBuildRoad` / `canBuildSettlement` / `canBuildCity` / `tollRoadOwner`), `actions.ts`, `trade.ts`, `board.ts` match detection.
- **Playwright** against `vite preview`, WebGL under headless Chromium (`--use-gl=swiftshader`).
- **Determinism:** `generateMap(seed)` already takes a seed and uses `mulberry32`, but `config.ts` also exports `rand` / `randInt` / `choice` / `shuffle` backed by bare `Math.random()`, and `ai.ts` calls `Math.random()` directly. Route all of it through one injectable seeded RNG. **This is a prerequisite for E3's cross-client determinism criterion, not just for tests.**
- **Test hook:** `window.__hex = { G, view, board }` behind an env flag, so Playwright can assert on state instead of scraping pixels.
- **CI:** GitHub Actions running `tsc --noEmit`, unit, and e2e on PRs.

**Acceptance:** `npm test` and `npm run test:e2e` green locally and in CI; a smoke e2e that boots the game, places HQ and both setup rails, and asserts setup ends; a regression test for K1 (advance 3s of fake time in setup, assert `view.legalEdges.size > 0`).

---

## T2. Headless mobile-viewport coverage
`[chore] [testing] [mobile]`

Depends on T1.

- Playwright projects for iPhone-class (390×844), small Android (360×640), landscape phone (844×390), with `hasTouch: true`.
- Cover: mobile nav panel switching (`setMobileView`), quarry board fitting via `responsiveZoom()` without overflow, banner and modal layout below 760px and below 420px, canvas receiving touch gestures.
- Screenshot snapshots per viewport, enforced in CI.
- Real touch gestures via `page.touchscreen` and multi-pointer CDP for tap-to-place, one-finger pan, pinch-zoom.

**Acceptance:** no horizontal overflow at 360px in any tab; tap-to-place works headlessly on a touch viewport; snapshots committed.

Note the snapshots will all need regenerating at E11. Expected — the interaction tests are the part that survives.

---

# Part 3 — Epic: Isometric industry map

Catan hex graph → Transport Tycoon style grid. Sequenced so `main` stays playable at every merge: E0–E3 land behind a flag with the hex game untouched; the switch happens at E11.

**The core reframing.** Today a tile's output reaches you if you own a *building on one of its corner vertices* (`playerResources` walks `vert.tiles`). In a TTD-style game, output reaches you if you own a *station whose catchment rectangle overlaps the industry*. That single change forces most of the rest — vertices and edges stop existing, so `canBuildSettlement`, `canBuildRoad`, `tollRoadOwner` and the whole `Vertex`/`Edge` model in `hexmap.ts` go with them.

**Survives untouched:** `board.ts` (match-3 quarry), `trade.ts`, `net.ts`, `lobby.ts`, most of `ui.ts`, `state.ts` — roughly 40% of `src/game`.
**Replaced:** `hexmap.ts` (352 lines), `MapView3D.ts` (1009 lines), the map-facing half of `actions.ts` and `ai.ts`.

---

## E0. Decide the grid + projection constants
`[epic] [design] [blocker]`

Nothing else can start until these are fixed — they set the sprite cell size, which sets the atlas, which sets the renderer.

- **Projection:** 2:1 dimetric. Confirm against the source art before slicing.
- **Tile footprint:** `TILE_W` × `TILE_H`, proposed `64 × 32`.
- **Map size:** proposed `48 × 48` tiles. Current map is 30 plots; a TTD map needs room for track to matter. Sanity-check draw counts at that size first.
- **Multi-tile industries:** the coal mine, quarry and oil rig occupy more than one tile. Proposed convention — each industry has a `w × h` footprint with origin at its north tile, rendered as one sprite anchored to the bottom-centre.
- **Terrain height:** flat, or stepped? **Recommend flat for v1.** Sloped iso roughly triples tile-variant count (4 corner heights × transitions) and complicates track drawing.
- **Coordinates:** world coords stay integer tile `(tx, ty)`; `sx = (tx - ty) * TILE_W/2`, `sy = (tx + ty) * TILE_H/2`.

**Acceptance:** constants in `config.ts`, a one-page note in the repo, one hand-placed test sprite rendering at correct size.

---

## E1. Sprite atlas format + slicer tooling
`[tooling] [assets]` — depends on E0.

Build the pipeline before the renderer so it has real data to draw.

**Manifest** (`assets/atlas/<name>.json`), extending the shape already used by `gems_spritesheet.json`:

```json
{
  "image": "industries.png",
  "tileW": 64, "tileH": 32,
  "sprites": {
    "coal_mine": {
      "x": 0, "y": 0, "w": 192, "h": 160,
      "footprint": [3, 3],
      "anchor": [96, 148],
      "frames": 1
    },
    "oil_rig": { "...": "...", "frames": 4, "frameMs": 180 }
  }
}
```

- `anchor` is the pixel that lands on the screen position of the footprint's origin tile — this is what stops tall buildings floating.
- `footprint` drives occupancy and draw sort order.
- `frames` covers the animated pieces (oil derrick, mine conveyor, farm animals).

**Tooling** (`tools/slice-atlas.mjs`, Node + sharp): input source sheets plus a hand-written cell map; output packed PNG plus manifest; **plus a debug contact sheet** — every sprite on a tile-grid background with its anchor marked, so anchor errors are visible at a glance instead of found by placing 400 buildings.

**Acceptance:** slicer produces a loadable atlas; contact sheet shows every sprite flush on its footprint.

---

## E2. New industry + cargo tables
`[design] [config]`

Replace the 6 Catan resources. Current `ResKey` is `wood | brick | sheep | wheat | ore | gold`.

| Industry | Cargo | Notes |
|---|---|---|
| Farm | Grain | high frequency, low value |
| Forest | Wood | |
| Coal Mine | Coal | |
| Iron Mine | Iron | |
| Quarry | Stone | |
| Oil Rig | Oil | rare, high value |
| Gold Mine | Gold | currency, as today |

**Blocking constraint:** the match-3 board hard-codes six gem frames (`GEM_FRAMES = 6`, `GEM_FRAME`, and `gems_spritesheet.png` has exactly 6 × 128px frames). A seventh cargo needs new gem art. Either commission it alongside the industry sprites or cut to six cargoes. Decide in this ticket.

Also: new `COSTS` (track / station / depot replacing rail / factory / foundry), industry placement density replacing `TILE_BAG`, updated `RES` colours and icons. Keep `gold` as the sabotage currency so `SABOTAGE` and `SECURITY` are unaffected.

**Open design question:** does the match-3 board still spawn cargo directly, or does it now generate *transport capacity* you spend moving cargo? The second is more TTD but a much larger change. Decide explicitly rather than by drift.

---

## E3. Tile grid map generation
`[feature] [map]`

New `src/game/grid.ts` replacing the Voronoi island.

- `generateMap(seed)` keeps its signature and `mulberry32` seeding — **multiplayer depends on this**, since `net.ts` ships only the seed and every client regenerates identical geometry.
- Emit a `w × h` terrain array (grass, water, rough) plus `Industry { id, type, tx, ty, w, h, production, banditUntil }`.
- Placement: spaced, non-overlapping, not on water, balanced so no corner is dead.
- Keep `bounds` on the map object; the camera uses it.

**Acceptance:** same seed → byte-identical map across two browsers, asserted in the T1 suite. Requires the RNG unification from T1.

---

## E4. Isometric renderer
`[feature] [renderer] [large]`

Replaces `MapView3D.ts`. Decide first: **2D sprite renderer, or three.js with an orthographic camera and billboards?**

Recommend a dedicated 2D renderer (canvas2d first, batched WebGL quads if profiling demands). The art is pre-rendered iso sprites so nothing needs 3D; it drops `three` (~600KB); and it collapses the mobile camera problems into a translate and a scale.

- Atlas loader reading the E1 manifest.
- Painter's-algorithm order by `(tx + ty)`, multi-tile footprints sorted by origin.
- Viewport culling — essential at 48×48 with tall sprites.
- Screen→tile picking: invert the projection, then correct for tall sprites overlapping tiles behind them (hit-test sprite bounds back-to-front, fall back to the flat-tile inverse).
- Animated frames off the existing rAF loop.

**Camera acceptance criteria** (carrying over the real problems from the closed mobile tickets):
- One-finger pan, two-finger pinch-zoom **anchored to the pinch midpoint** so the point under the fingers stays put; same for cursor-anchored wheel zoom.
- Lifting one finger of a pinch promotes the remaining pointer cleanly — no snap, no dead finger.
- Sizing from the canvas client rect (or a `ResizeObserver`), listening to `visualViewport.resize` and `orientationchange`, not `window.innerWidth`. Taps must land on the sprite under the finger at every viewport size.
- Camera clamped to map bounds, with a visible recentre control on mobile.
- Legal-placement highlights drawn as a tinted overlay sprite on the tile, above terrain and below buildings — legible on every terrain type at min and max zoom.

---

## E5. Track model
`[feature] [gameplay]`

Rails stop being graph edges. Each tile may hold a track piece with a direction set (2 straights, 4 curves for v1; junctions later).

- Building is per-tile, ideally click-drag A→B with auto-routing.
- Connectivity is a flood fill over adjacent connected pieces, replacing the "trace back to HQ" rule in `canBuildRoad`.
- Track sprite variants added to the atlas spec; ownership by colour tint.
- `tollRoadOwner` / `doTollRoad` need a replacement concept — proposed: running a train over a rival's track charges a toll automatically. Or cut toll passes from v1.

---

## E6. Stations and catchment
`[feature] [gameplay] [core]`

The mechanic that replaces settlement adjacency, and the heart of the new game.

- A station is placed on a tile adjacent to track.
- It has a catchment rectangle (proposed 4×4 centred on it).
- Any industry overlapping the catchment delivers to that station.
- `playerResources(map, player, now)` is rewritten: walk the player's stations, union the industries in catchment, sum production. Blockade (`banditUntil`) still suppresses an industry — that part carries over cleanly.
- Decide what happens when two players' catchments overlap one industry: split, race, or highest station rating.

**Acceptance:** placing a station next to a farm starts grain income; demolishing it stops income; a blockaded industry produces nothing.

---

## E7. Rewrite the AI
`[feature] [ai]`

`ai.ts` calls `findLegalSettlement` / `findLegalRoad` and picks randomly among legal spots; neither survives. New AI: pick a target industry, path track to it, place a station, valuing industries by cargo scarcity and distance. Keep the skill/timing scaffolding (`nextBuild`, `nextIncome`, `slowedUntil`) — that layer is fine. Decisions must be deterministic under the seeded RNG so T1 can assert on them.

---

## E8. Victory conditions and economy rebalance
`[design] [gameplay]`

`VP.target = 10` with 1★ per factory and 2★ per foundry doesn't map onto stations and track. Options: VP from cargo delivered, network size, or industries served. Then rebalance `COSTS`, `UPGRADE_EVERY` and sabotage prices against the new curve. Expect several playtest passes — file follow-ups rather than trying to nail it once.

---

## E9. UI updates
`[feature] [ui]`

`ui.ts` mostly survives, but: build panel buttons become track / station / depot with new art; `renderBuild` cost pills need new cargo icons; `tileInfo` becomes an industry inspector showing production and serving stations; `showBanner` / `showModeBar` prompt strings all change; mobile map tab needs the new camera controls.

---

## E10. Multiplayer snapshot format
`[feature] [multiplayer]`

Map, track and station state all change shape, so the `net.ts` snapshot schema changes. Add a `version` field and reject mismatched clients with a clear message — today a stale guest silently desyncs.

---

## E11. Cut over and delete the hex path
`[chore]`

Flip the flag; delete `hexmap.ts`, `MapView3D.ts`, the terrain `.jpg` textures, and the `three` / `@types/three` dependencies. Regenerate the T2 snapshots. Close the obsoleted mobile tickets if any are still open.
