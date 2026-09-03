# HexMatch — status audit and remaining work

Audited against `main` @ `94c274a`. Verified by cloning, `npm ci`, `tsc --noEmit`, `vitest run`, `playwright test --list`, and reading the source.

---

## Verified state

**Green.** Typecheck clean. 72 unit tests passing across 8 files. 68 Playwright tests registered across 4 specs and 5 viewport projects.

### Landed and confirmed

| Ticket | Evidence |
|---|---|
| **K1** setup-mode clobber | `main.ts` ~line 151 now wraps the affordability check in `if (!G.setupPhase)`, with a comment explaining why. E2E test asserts highlights stay lit. |
| **K2** per-frame legality | Replaced with a `legalityDirty` flag; `computeLegality()` only runs when set. |
| **K3** viewport meta | Mobile e2e checks no horizontal overflow at 360px. |
| **K4** repo hygiene | `.gitignore` covers `dist/`, `**/node_modules/`, coverage, playwright artifacts. `dist/` and `server/node_modules/` are gone from the tree. |
| **K5** typecheck/lint/metadata | `build` is `tsc --noEmit && vite build`. ESLint configured. `package.json` renamed to `hexmatch` with a real description. LICENSE and README present. |
| **K6–K8** server | 9 server tests including unassigned-guest intent rejection and socket flood rate-limiting. |
| **T1** harness | Vitest + Playwright + a `window.__hex` test hook. Unit coverage on hexmap, actions, board, trade, server, projection, iso-grid, iso-manifest. |
| **T2** mobile coverage | 5 viewport projects (iPhone, android-small, android-landscape, etc.), tap-to-place, orientation change, camera clamp. |
| **E0** constants | `src/game/config.ts` has `TILE_W=64, TILE_H=32, MAP_W=MAP_H=48`, `tileToScreen`/`screenToTile`. **`screenToTile` correctly uses `Math.floor`.** Round-trip tests pass. |
| **E2** tables | `src/iso/config.ts` — six cargoes with Ore merged, six industries with footprints, `TRANSPORT` with road (1 stone, 1 VP, 1.0×) and rail (2 ore + 1 stone, 3 VP, 1.6×), `UPGRADE_COST`. |
| **E3** grid gen | `src/iso/grid.ts`, 200 lines. Typed-array terrain, Poisson-disc industry placement with per-type quotas, occupancy `Int16Array`. 11 tests including determinism. |
| **E1** tooling | `tools/slice-atlas.mjs`, JSON schema, `validate-manifest.mjs`, contact sheet, three zoom levels. Works. |

The old mobile tickets (5–9) were also implemented against `MapView3D.ts` — `touch-camera.spec.ts` covers two-finger orbit, pinch zoom, and finger-lift promotion. That's fine; it keeps the hex game playable, and E11 deletes it all.

### Not started

E4 (renderer), E5 (track), E6 (stations/catchment), E7 (AI), E8 (setup/rebalance), E9 (UI), E10 (net), E11 (cutover). No `src/iso/renderer.ts`, no `roadBits`, no station model.

---

# Remaining work

## R1. Finish the atlas — only 4 of ~30 sprites exist
`[assets] [blocker on E4]`

`assets/iso-atlas/manifest.json` has exactly four sprites: `terrain_grass_a`, `terrain_grass_b`, `terrain_rough`, `terrain_water`. The pipeline is proven end to end, but no industry, building, road or rail sprite has been cut.

Extend `tools/iso-atlas.cells.json` with, from `src/assets/sprites/png/`:

| Sprite | Source | Footprint |
|---|---|---|
| `farm` | `industries/farm_temperate.png` | 2×2 |
| `forest` | `industries/lumbermill.png` + `trees/temperate/` | 2×2 |
| `ore_mine` | `industries/steelmill.png` | 3×3 |
| `quarry` | `industries/goldmine/goldmine_base.gimp.png` (grey reskin) | 3×3 |
| `oil_rig` | `industries/oilwell/oilwell_anim1–6` | 2×2, 6 frames |
| `gold_mine` | `industries/goldmine/goldmine_base.gimp.png` | 2×2 |
| `factory_{blue,red,purple,green}` | `industries/factory.png` | 3×3 |
| `depot_{blue,red,purple,green}` | `miscellaneous/hq.png` or `stations/` | 1×1 |
| `road_half`, `rail_half` | `landscape/landscape031.png`, `infrastructure/rail/` | 1×1 |
| `highlight` | draw programmatically | 1×1 |

**Coal mine animation frames are already available** (`coalmine_anim1–3`) if you want a second animated industry.

Road and rail: extract **one half-piece each** and have the slicer composite all 16 bitmask variants by rotation and mirroring. Do not cut 16 separate sprites — alignment will not hold.

**Acceptance:** contact sheet shows every sprite flush on its footprint at all three scales; `validate-manifest.mjs` green; multi-tile anchors verified by eye against the debug grid.

---

## R2. E4 — isometric renderer  ✅ LANDED
`[renderer] [large]`

**Done.** `src/iso/camera.ts`, `src/iso/atlas.ts`, `src/iso/depth.ts`,
`src/iso/renderer.ts`, plus a visual harness at `iso-demo.html` →
`src/iso/demo.ts` (`npm run dev`, then `/hexmatch/iso-demo.html`).
Covered by 32 new unit tests in `tests/unit/iso-{camera,depth,renderer}.test.ts`
(108 unit tests total, typecheck and lint clean).

- Three stacked canvases; terrain and structures redraw only when dirty.
- 8×8 chunk cache into `OffscreenCanvas`, keyed by zoom, invalidated per tile
  and dropped wholesale on a zoom change.
- Culling from the four screen corners, padded by `cullPad()` = largest
  footprint + tallest sprite in tiles.
- Tier-1 max-corner key + Tier-2 Kahn topological sort over only the
  screen-overlapping subset; Tier-3 cycles are reported, not silently dropped.
- Two-stage picking: flat `screenToTile`, then front-to-back alpha-mask pass.
- Integer zoom steps 0.5/1/2 with pre-rendered atlases, `Math.floor` on every
  draw coordinate, anchored pinch/wheel zoom, pointer promotion, camera clamp.

Still open against E4: the committed reference-PNG fixture test and porting
`touch-camera.spec.ts` onto the new view — both are blocked on E11 mounting the
iso renderer as the game's actual map, so they land with the cutover.

The original brief follows.

The single biggest remaining piece. Full spec in `docs/HexMatch-isometric-spec.md` § E4. Summary of what must be built in `src/iso/renderer.ts`:

- Three stacked canvases: terrain (redraw on camera/zoom change), structures (redraw on world change), overlay (60fps).
- 8×8 tile chunk caching into `OffscreenCanvas`, invalidated per changed tile.
- Viewport culling — convert the four screen corners via `screenToTile`, pad by the largest footprint plus sprite height in tiles.
- **Depth sort, three tiers:** max-corner key `(tx+w-1)+(ty+h-1)` by default; topological sort over only the sprites whose screen bounds actually intersect; sprite slicing as the escape hatch. `tx+ty` alone is wrong for multi-tile footprints.
- **Two-stage picking:** flat `screenToTile` first, then a front-to-back sprite pass with alpha masks so clicking a mine's chimney selects the mine, not the grass behind it.
- Integer-stepped zoom (0.5/1/2) with pre-rendered atlases — never scale inside `drawImage`.
- `Math.floor` all draw coordinates.

Camera acceptance criteria are listed in the spec and mirror what `touch-camera.spec.ts` already asserts against the 3D view — port those tests rather than rewriting them.

---

## R3. E5 — track model and drag-to-build  ✅ LANDED
`[gameplay] [core]`

**Done.** `src/iso/track.ts`, covered by 36 unit tests in
`tests/unit/iso-track.test.ts` (144 unit tests total, typecheck and lint clean).
Drag-to-build is wired into the E4 harness: shift+drag lays track, `r` toggles
road/rail, `f` flips the L corner.

- `road`/`rail` `Uint8Array(MAP_W*MAP_H)` layers, 4-bit masks `NE=1 SE=2 SW=4
  NW=8`, sprite key built from the mask (`road_0011`), all 32 keys verified
  present in the atlas.
- A fifth `PRESENT` bit (0b10000) above the direction nibble, so a lone stub
  with mask `0000` is still drawn — without it a freshly placed isolated tile
  is invisible. The renderer masks the low nibble for the sprite name.
- Incremental autotiling: a placement recomputes exactly 5 tiles (self + 4
  neighbours, clipped at the map edge) and invalidates 1–4 chunks.
- Connection bits are mutual — a bit is set only when the neighbour faces
  back, which is precisely the invariant E6's flood fill needs.
- L-shaped Manhattan drag with axis flip, obstacle truncation, free re-drags
  over same-kind track, in-place road→rail upgrade charging only the
  difference, and an affordable-prefix preview. No A* (reserved for E7).
- `connectedTiles`/`areConnected` flood fill over mutual masks: the base E6
  will hang catchment and connection scoring on.

The original brief follows.

Two `Uint8Array(MAP_W*MAP_H)` layers, `roadBits` and `railBits`, holding 4-bit direction masks (`NE=1, SE=2, SW=4, NW=8`). Sprite key by binary mask: `road_${bits.toString(2).padStart(4,'0')}`.

Incremental autotiling: placing at `(tx,ty)` recomputes that tile plus its four neighbours and invalidates the containing chunks. Never recompute the whole map.

L-shaped Manhattan drag preview with live cost, truncating at obstacles. No A* for the player — reserve it for the AI.

---

## R4. E6 — stations, catchment, connection scoring
`[gameplay] [core]`

Rewrite `playerResources` to walk harvesters → 4×4 catchment → overlapping industries → output × transport multiplier. Flood fill over direction masks where a tile connects only if **both** neighbours set the facing bit.

VP awarded on connection completion, revoked on break, checked on every build and demolish. Overlapping catchments split output proportionally.

---

## R5. E7–E11 — AI, rebalance, UI, netcode, cutover

Per spec. E11 deletes `hexmap.ts`, `MapView3D.ts`, the terrain `.jpg` textures and the `three` dependency (~600KB), and regenerates the T2 snapshots.

---

# Issues found during the audit

## R6. `generateMap()` falls back to `Math.random` for its seed
`[bug] [multiplayer]`

`src/iso/grid.ts` line 180:

```ts
const s = (seed === undefined ? Math.floor(Math.random() * 0xffffffff) : seed) >>> 0;
```

`main.ts` line 67 also does `setRng(Math.random)` and `config.ts` defaults `_rng = Math.random`.

Determinism holds *only when a seed is explicitly passed*. That's fine for tests, but the multiplayer path in E10 must guarantee the host's seed reaches every guest before `generateMap` is called, or clients silently generate different maps. Right now nothing enforces that.

**Fix:** make `seed` a required parameter, or have the caller always supply one. Add a test asserting two `generateMap()` calls with no argument produce *different* maps (proving the fallback works) and that the game boot path never takes the fallback branch.

## R7. `HexMatch-tickets.md` and `patch1.patch` still in the repo root
`[chore]`

Both superseded. `HexMatch-tickets.md` in particular describes fixes to `MapView3D.ts` that E11 deletes; leaving it will send someone down a dead path. Delete both, or move to `docs/archive/`.

## R8. Atlas manifest has both `image` and `images`
`[chore] [assets]`

`manifest.json` carries a singular `image` key alongside the `images` map of zoom levels. Whichever is vestigial should go before E4 starts reading it, so the renderer doesn't bind to the wrong one.

## R9. OpenGFX assets are unpruned
`[chore] [repo-size]`

`src/assets/sprites/` contains the whole OpenGFX tree — aircraft, ships, trains, toyland, arctic, tropical, African manager faces, `.xcf`/`.psd` sources, `.pnml` definitions. The game will use maybe 3% of it.

Prune to `terrain/`, `industries/`, `infrastructure/`, `landscape/`, `trees/temperate/`, `miscellaneous/`, plus the `stations/` working files. Keep the OpenGFX attribution in the README regardless.

Do this **after R1** so you don't delete a source the cell map turns out to need.

---

# Suggested order

**R1 ✅ → R2 ✅ → R3 ✅ → R4 → R5.** R6 and R7 are five-minute fixes; do them now. R8 before R2. R9 after R1.

R1 is the real blocker: the renderer can't be meaningfully tested against four terrain tiles, and the depth-sort and picking acceptance criteria both require multi-tile sprites with real anchors to prove anything.
