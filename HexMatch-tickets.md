# HexMatch — issue backlog

Each section is one GitHub issue. Suggested labels in brackets. Line numbers are against `main` @ 7 commits.

---

## 1. Setup-phase build mode is cleared ~1s after it is armed, so rail/HQ highlights vanish
`[bug] [P0] [setup]`

**Symptom:** You start a game, the "Lay your first Rail" banner appears with glowing edges, and about one second later every glowing marker disappears. The banner stays up, so the game looks frozen/broken. Clicking an edge afterwards does nothing.

**Root cause:** in `src/game/main.ts` the once-per-second housekeeping block inside `frame()` (~lines 107–116) is guarded only by `G.running && !G.won`, not by `!G.setupPhase`, unlike the two blocks directly above it. It runs:

```ts
if (G.buildMode && G.buildMode !== "toll" && G.buildMode !== "bandit"
    && COSTS[G.buildMode] && !canAfford(me, COSTS[G.buildMode].cost)) {
  clearMode();
}
```

During setup `G.buildMode === "road"` and the player has zero resources, so `canAfford` fails and `clearMode()` runs — setting `view.mode = null`, which empties `legalEdges` on the next `computeLegality()` and wipes the markers. Setup rails are supposed to be free (`doRoad(p, id, true)`), so the affordability check should not apply at all.

**Fix:** skip the auto-deselect while `G.setupPhase` is true (and ideally skip it for any build that is currently free). Also consider having `clearMode()` refuse to run during setup, since `bus.on("build:mode")` already special-cases setup.

**Acceptance criteria**
- HQ and rail highlights stay lit for the whole setup phase, indefinitely, with 0 resources.
- Auto-deselect on unaffordable builds still works after setup ends.
- Regression test in the headless suite (see #3): advance 3s of fake time in setup, assert `view.legalEdges.size > 0`.

---

## 2. Legal-move markers sit too low and blend into the terrain
`[bug] [ux] [3d]`

**Symptom:** The glowing edge dashes and vertex discs that mark legal placements are hard to see against the map, especially over the green forest/pasture tiles and at low camera angles. Users can't tell where they're allowed to build.

**Where:** `src/map3d/MapView3D.ts` → `rebuildMarkers()` (~lines 753–797).

Contributing factors:
- Edge dashes are placed at `edgeY(e) + 0.07` with a `BoxGeometry(0.1, 0.05, 0.24)` — only ~5cm of world height, so they intersect and z-fight with tile geometry on sloped/tall tiles.
- They use `MeshStandardMaterial` (lit), so they darken in shadow instead of reading as UI.
- Marker colour `0xffe27a` gold is low-contrast against desert/goldmine tiles.

**Fix (suggested)**
- Raise edge markers to roughly the vertex-marker height (`+0.16`–`+0.25`) and add a thin vertical beam/glow like the vertex markers already have.
- Switch marker materials to `MeshBasicMaterial` with `depthTest: false` and a dedicated render order so they always draw on top of terrain.
- Add a dark outline or contrasting rim so gold markers stay legible on desert.

**Acceptance criteria**
- Markers clearly readable on all 8 tile types at min and max zoom, and at the shallowest allowed pitch (0.22).
- No z-fighting when the camera orbits.
- Screenshot test at 3 camera angles added to the visual suite.

---

## 3. No automated tests at all — stand up a headless test harness
`[chore] [testing] [P0]`

There is no test runner, no CI, and no `test` script in `package.json`. Every regression above is only findable by hand.

**Scope**
- Add Vitest for unit tests over the pure game logic: `hexmap.ts` (map generation determinism given a seed, adjacency, `canBuildRoad` / `canBuildSettlement` / `canBuildCity` / `tollRoadOwner`), `actions.ts`, `trade.ts`, `board.ts` match detection.
- Add Playwright for headless browser runs of the real game against `vite preview`, with WebGL via headless Chromium (`--use-gl=swiftshader`).
- Make the game deterministic under test: `generateMap(seed)` already takes a seed, but `Math.random()` is used elsewhere — inject a seeded RNG so runs are reproducible.
- Expose a small test hook (e.g. `window.__hex = { G, view, board }` behind an env flag) so Playwright can assert on `view.legalEdges`, resources, and phase without scraping pixels.
- Add a GitHub Actions workflow running typecheck + unit + e2e on PRs.

**Acceptance criteria**
- `npm test` and `npm run test:e2e` pass locally and in CI.
- A smoke e2e that boots the game, places HQ and both setup rails, and asserts setup ends.

---

## 4. Headless mobile-viewport test coverage
`[chore] [testing] [mobile]`

Depends on #3.

**Scope**
- Playwright projects for iPhone-class (390×844), small Android (360×640) and landscape phone (844×390) using `hasTouch: true` and `isMobile: true`.
- Cover: bottom mobile nav switching panels (`setMobileView`), the quarry board fitting via `responsiveZoom()` without overflow, banner/modal layout below 760px and below 420px, and the map canvas receiving touch gestures.
- Add screenshot snapshots for each viewport so layout regressions are caught.
- Drive real touch gestures (`page.touchscreen`, multi-pointer via CDP) to exercise tap-to-place, one-finger pan and pinch-zoom.

**Acceptance criteria**
- No horizontal overflow at 360px wide in any tab.
- Tap-to-place works headlessly on a touch viewport.
- Snapshots committed and enforced in CI.

---

## 5. Mobile camera: orbit is unreachable on touch
`[bug] [mobile] [camera] [P0]`

**Where:** `src/map3d/MapView3D.ts` → `bindInput()` (~lines 822–920).

On touch, one finger is hard-wired to `pan` (`mode = (e.button === 0 && !e.shiftKey) ? "pan" : "orbit"` — touch always reports `button === 0`). Two fingers set `mode = "orbit"` on `pointerdown`, but the `pointermove` handler for `pointers.size === 2` handles pinch distance and then `return`s before any orbit code runs. Net result: **there is no way to rotate or change pitch on a phone or tablet.** The comment "pinch-zoom + orbit" describes behaviour that isn't implemented.

**Fix:** in the two-finger move branch, also apply rotation from the movement of the pinch midpoint (horizontal → `tYaw`, vertical → `tPitch`), keeping the existing pitch clamp. Alternatively add an explicit on-screen rotate control for touch.

**Acceptance criteria**
- Two-finger twist/drag rotates and pitches the camera on a touch device.
- One-finger pan and tap-to-place are unaffected.

---

## 6. Pinch zoom jumps and isn't anchored to the fingers
`[bug] [mobile] [camera]`

Two problems in the same handler:

1. `pinchDist` is seeded on `pointerdown` of the second finger, but if the second `pointerdown` is missed (common when a finger lands during a fling, or when the first `pointermove` beats it), `pinchDist` is 0 and the first move is skipped — the zoom stutters.
2. Zoom is applied to `tDist` around the camera target, not around the pinch midpoint, so the map slides away from the fingers as you zoom. On a small screen this makes it very hard to zoom in on a specific junction.

**Fix:** derive `pinchDist` lazily on the first two-pointer move if it's 0; and adjust `tTarget` toward the world point under the pinch midpoint proportionally to the zoom delta, so the point under the fingers stays put. Same treatment for the wheel handler (cursor-anchored zoom).

---

## 7. Lifting one finger after a pinch leaves the camera in a bad state
`[bug] [mobile] [camera]`

In `release()`, a pointer that isn't `activeId` deletes itself and returns early *without* resetting `mode`. After a pinch, `mode` is `"orbit"` and `activeId` is the first finger — lift the second finger and the remaining finger now orbits instead of panning, with no `px/py` re-seed, so the camera snaps on the next move. Lifting the *first* finger instead leaves `mode = "none"` while a finger is still down, so that finger does nothing until it's lifted and re-placed.

**Fix:** when `pointers.size` drops from 2 to 1, promote the remaining pointer to `activeId`, re-seed `px/py/sx/sy` from its last known position, reset `mode` to `"pan"`, and clear `pinchDist`. Cover with a multi-pointer test in #4.

---

## 8. `resize()` uses `window.innerWidth/Height` and ignores the visual viewport
`[bug] [mobile] [camera]`

`resize()` (~line 801) sizes the renderer from `window.innerWidth/innerHeight` rather than the canvas's own client rect, and only listens to `resize` (line 219), not `orientationchange` or `visualViewport`. On mobile Safari/Chrome the collapsing URL bar changes the visual viewport without always firing a layout `resize`, so the canvas drawing buffer and the CSS box drift apart. The result is a stretched/offset render and, worse, `pickAt()` mis-hits because it projects into a viewport that doesn't match where the user actually tapped.

**Fix:** use `canvas.clientWidth/clientHeight` (or a `ResizeObserver` on the canvas), listen to `visualViewport.resize` and `orientationchange`, and re-run `fit()`/`setViewOffset` afterwards. Note `leftPanel`/`rightPanel` offsets are already zeroed under 1200px, so only the sizing path needs changing.

**Acceptance criteria**
- Rotating the device and scrolling the URL bar away leaves the map correctly sized.
- Taps land on the marker under the finger at every viewport size.

---

## 9. Camera can be panned off the map with no way back
`[bug] [ux] [camera]`

`tTarget` is never clamped in the pan branch, and `tDist` only clamps to `[3.2, 70]`. A few flicks and the island is off-screen entirely; the only recovery is the "fit" action, which isn't obvious on mobile. Clamp `tTarget` to `map.bounds` plus a margin, and consider a rubber-band snap-back. A visible "recentre" button on the mobile map tab would help too.

---

## 10. `computeLegality()` runs on every animation frame
`[perf] [mobile]`

`main.ts` line 121 calls `computeLegality()` inside the rAF loop. It iterates every vertex or every edge and calls `canBuildRoad`/`canBuildSettlement` per element — 60× per second, even when nothing has changed and even when no build mode is armed. On a mid-range phone this is a meaningful chunk of the frame budget on top of the WebGL work.

**Fix:** recompute only when the inputs change (build mode, player buildings/roads, resources) — e.g. a dirty flag set from the `build` / `build:mode` / `toll` bus events — or throttle to the same 1s cadence as the other housekeeping. Early-return immediately when `view.mode` is null.

---

## 11. Viewport meta doesn't guard against browser gestures on the canvas
`[bug] [mobile]`

`index.html` has `width=device-width, initial-scale=1.0` only. The canvas sets `touch-action: none`, but the surrounding page does not, so double-tap-to-zoom and iOS Safari's pinch can still fire over UI panels and interrupt map gestures. There's also no `viewport-fit=cover`, so the map is letterboxed by the notch/home indicator on iPhones.

**Fix:** add `viewport-fit=cover`, `maximum-scale=1`, `user-scalable=no`; add `overscroll-behavior: none` and `touch-action: manipulation` on `body`; apply `env(safe-area-inset-*)` padding to the top bar and the bottom mobile nav.

---

## 12. Tap targets give no hover/press feedback on touch
`[ux] [mobile]`

`pickAt()` is only used to set `this.hover` when `!isTouch` (~line 869), so the hover emphasis in `draw()` never fires on a phone. On touch there's no confirmation of what you're about to place until it's already placed, and the pick radius (60px for edges) means near-misses are silent. Add a press state on `pointerdown` for touch — highlight the nearest legal target and hold it until release or cancel.

---

## 13. `dist/` and `server/node_modules/` are committed
`[chore] [repo-hygiene]`

`.gitignore` contains only `node_modules/`, and build output plus the server's dependency tree are checked in (14MB clone, `ws` vendored under `server/node_modules`). This makes diffs noisy, invites stale builds being deployed, and means dependency updates never show up in review.

**Fix:** add `dist/`, `**/node_modules/`, `*.local`, editor dirs to `.gitignore`; `git rm -r --cached dist server/node_modules`; build in CI instead. Confirm the Fly deploy uses `npm ci` in the Dockerfile rather than the committed tree.

---

## 14. No typecheck or lint step; project metadata is scaffolding leftovers
`[chore] [dx]`

- `npm run build` is bare `vite build`, which does **not** typecheck — TS errors ship silently. Change to `tsc --noEmit && vite build`.
- No ESLint/Prettier config, so the `any` casts scattered through `main.ts` (`(v: any)`, `(d: any)`) are unchecked.
- `package.json` still says `"name": "react-vite-tailwind"` with `version 0.0.0` and no description.
- `vite-plugin-singlefile` is a dependency but isn't used in `vite.config.ts` — either wire it up or drop it.
- The repo has no README: no build/run instructions, no note that the room server is a separate process.

---

## 15. Room server hardening: unbounded payloads, no origin check, no rate limiting
`[bug] [security] [server]`

`server/server.js` relays whatever it's handed:
- `new WebSocketServer({ server })` has no `maxPayload`, so a single client can push arbitrarily large `snapshot` frames and OOM the process.
- No `verifyClient`/origin allow-list — anyone can connect to `wss://hexmatch.fly.dev` and spam `create`, minting unbounded rooms (each held for an hour) with no cap on total rooms.
- No per-connection message rate limit; `intent`/`snapshot` are forwarded unthrottled.
- `msg.state` and `msg.payload` are forwarded to other clients unvalidated. The host trusts guest intents; a malicious guest can send intents for slots it doesn't own — the host should verify `from` maps to the guest's assigned slot.

**Fix:** set `maxPayload` (a few hundred KB), cap rooms and rooms-per-IP, add a token-bucket per socket, validate message shapes, and have the host reject intents whose `from` doesn't match the assigned slot.

---

## 16. Guests can join a room whose host has already left
`[bug] [server] [multiplayer]`

On host disconnect the room is kept for `ROOM_TTL_MS` with `closedAt` set, but `case "join"` never checks `closedAt` or `hostWs.readyState`. A guest joining in that window gets a `joined` message and then sits in a dead lobby: `send(room.hostWs, ...)` silently no-ops because `send()` only writes when `readyState === 1`. There's also no way for a reloading host to reclaim the room — the reload creates a brand-new code, so the "hold the room in case of reload" comment describes an unimplemented feature.

**Fix:** reject joins into a closed room with a clear error, and add a `rehost` message keyed by a host token so a reloading host can reattach and guests can resume.

---

## 17. `MAX_PLAYERS` capacity check is hard to read and off by one from its own comment
`[chore] [server]`

`if (room.guests.size + 1 >= MAX_PLAYERS)` mixes "guests plus the host" with "would this join fit". It happens to allow the intended 3 guests, but the intent isn't obvious and it will break the moment `MAX_PLAYERS` changes. Rewrite as an explicit `if (room.guests.size >= MAX_PLAYERS - 1)` with a comment, or track `MAX_GUESTS` directly. Add a unit test for the boundary.
