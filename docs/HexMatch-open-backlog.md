# HexMatch — open backlog

Consolidated. Supersedes `HexMatch-remaining.md` and `HexMatch-graphics-fixes.md`. Everything already delivered has been dropped; what remains is listed once.

Audited against `main` @ `7e56ea2`: `npm ci`, `tsc --noEmit` clean, **232 unit tests passing** across 16 files. `src/iso/` is 3025 lines across 13 modules.

**Closed since the last audit:** K1–K8, T1, T2, E0–E7 and most of E9/E10 are done. R7 (stray `patch1.patch` / `HexMatch-tickets.md`) — files are gone. R8 (duplicate `image`/`images` manifest key) — only `images` remains. R1 (atlas) — all 51 sprites now generated, though several are wrong; see G1/G2/G4.

**Work order: G1 → G2 → G7 → G3 → G5 → G4 → G8 → G6 → E8 → E11 → R9.**

**Done this pass:** G1, G2, G3, G4 (depot re-sourced to ≤40px, four tints), G5, G7 (CI atlas dirty check), E8 (first pass: `VP_TARGET=12`, `START_PURSE` has no ore, quotas raised after G3), R6 (`resolveMapSeed` / `joinFromSnapshot`).

**Still open / needs further consideration:** G6 (OpenGFX half-pieces), G8 (re-screenshot after G2; not isolated in this pass), E8 follow-up playtesting, E11 (hex cutover — after remaining G-series), R9 (prune OpenGFX after G6).

---

# Part 1 — Graphics and build rules (G-series)

## G0. "My local still shows the old map" — not a bug
`[support]`

`src/App.tsx` already defaults to the isometric game; the hex/3D game only loads at `?legacy=1`. A stale checkout or dev-server cache is the cause:

```bash
git pull && rm -rf node_modules/.vite dist && npm ci && npm run dev
```

Hard-reload (Ctrl+Shift+R), confirm no `?legacy=1` in the URL. See also G7 — the atlas is a build artifact, and a stale one renders the new map with old sprites.

---

## G1. Road and rail directions are geometrically wrong — 3 of 4 point the wrong way
`[bug] [P0] [assets]`

**This is the "roads don't align to the direction you're building" bug.**

The 4-bit mask logic in `src/iso/track.ts` is **correct**. `DIRS`, the `DIR` deltas and `OPPOSITE` all check out against the projection: `NE=[0,-1]` gives screen delta `(+32,-16)` = up-right, `SE=[1,0]` gives `(+32,+16)` = down-right. The bug is entirely in the **sprite generator**.

`tools/slice-atlas.mjs` → `makeGenerated()`, ~line 266:

```js
const dirs = {
  1: { a: [32, 16], b: [0, 0] },    // NE
  2: { a: [32, 16], b: [64, 32] },  // SE
  4: { a: [32, 16], b: [64, 64] },  // SW
  8: { a: [32, 16], b: [0, 32] },   // NW
};
const ex = cx + (bx - ax) * 0.5;
const ey = cy + (by - ay) * 0.5;
```

With `cx,cy = 32,16`:

| Bit | Intended | Computed | Actually points |
|---|---|---|---|
| 1 (NE) | (48, 8) | **(16, 8)** | NW — wrong |
| 2 (SE) | (48, 24) | (48, 24) | SE — correct |
| 4 (SW) | (16, 24) | **(48, 40)** | off-cell, clipped (cell is 32 tall) |
| 8 (NW) | (16, 8) | **(16, 24)** | SW — wrong |

NE draws NW, NW draws SW, SW draws nothing, only SE is right. Rendering `road_1111` from the committed atlas confirms it: **three arms instead of four**.

**Correct values.** In a 64×32 cell the diamond vertices are top `(32,0)`, right `(64,16)`, bottom `(32,32)`, left `(0,16)`. Each arm runs from centre `(32,16)` to the midpoint of the corresponding edge:

```js
const dirs = {
  1: [48,  8],  // NE — midpoint of top-right edge    (32,0)-(64,16)
  2: [48, 24],  // SE — midpoint of bottom-right edge (64,16)-(32,32)
  4: [16, 24],  // SW — midpoint of bottom-left edge  (32,32)-(0,16)
  8: [16,  8],  // NW — midpoint of top-left edge     (0,16)-(32,0)
};
```

Drop the `a`/`b`/`* 0.5` indirection and draw centre→endpoint directly. The halving is what pushed SW off-cell.

**Acceptance**
- Unit test: for each of the 16 masks, the generated cell has non-transparent pixels within 2px of each expected edge midpoint for every set bit, and **none** within 6px of the midpoints of unset bits. This is the test that would have caught it.
- `road_1111` shows four arms meeting at centre; `road_0011` (NE+SE) is a corner, not a straight line.
- An L-shaped drag renders its corner tile as a curve joining the two actual neighbours.

---

## G2. Every terrain tile has a white 1px seam row along its bottom
`[bug] [P0] [assets]`

Rendering `terrain_grass_a/b`, `terrain_rough` and `terrain_water` from `atlas@1x.png` shows a **solid white horizontal line** across the bottom of each. This is the white dashed fringe along the entire coastline in the preview.

Cause is the 1px-overlap handling in `tools/slice-atlas.mjs`, which crops 64×31 plus "one extra bottom row when the sheet row below the box is content". For these terrain sheets the row below the blue box is the **white page background**, not content, so the test passes on white and bakes a white row in.

**Fix:** treat white (`#FFFFFF`) as page background in that test, as blue already is. Or clone the tile's own last row unconditionally for 1×1 ground tiles — they never need a genuine overlap row.

**Acceptance:** no fully-opaque white pixels in any `terrain_*` sprite; two grass tiles blitted adjacently leave no seam; manifest test asserts no terrain cell's bottom row is pure white.

---

## G3. Water should only ring the outside of the map
`[gameplay] [map]`

`src/iso/grid.ts` → `makeTerrain()` generates a ragged coastline **and** interior lakes:

```js
const lakes = 9 + Math.floor(rng() * 7);   // 9–15 interior lakes
```

These fragment the landmass, block routes unpredictably, and — since `canBuildOn` rejects water — can strand an industry with no legal approach.

**Fix:** delete the lake loop. Keep the ragged outer ring (`d < jag`, 2–4 tiles) and the `ROUGH` blobs, which are road-buildable and add texture without blocking.

**Acceptance**
- Every non-water tile is reachable from every other by 4-way land movement — assert with a flood fill in the grid test. This is the criterion that matters; it guarantees no unreachable industry.
- Every industry has at least one adjacent land tile.
- Determinism test still passes.

Removing 9–15 lakes from a 48×48 grid meaningfully raises land area, so `INDUSTRY_QUOTA` likely wants a pass afterwards.

---

## G4. The harvester sprite is far too large and is the wrong building
`[bug] [assets]`

`tools/iso-atlas.cells.json`:

```json
{"name": "depot_blue", "footprint": [1,1], "crop": [162,249,65,51], "source": "hq", "tint": [70,130,220]}
```

It's cropped from `miscellaneous/hq.png` — the OpenTTD **company headquarters**, a large multi-tile office block, not a small loading depot. At 65×51 on a 1×1 footprint it stands over 1.5× tile height and wider than the tile, visually swallowing neighbours. Rendering it also shows a blue water-like base plate carried over from the source.

**Fix:** re-source from something depot-scaled. Already in the repo:
- `src/assets/sprites/source/stations/ogfx_sta_road_Working_File.png` — road stop / truck depot, right scale
- `src/assets/sprites/png/infrastructure/tramtracks_bare_depot.png`
- `src/assets/sprites/png/stations/RevStatBuilding_DanMacK.png`

Target ≤ 64×40, reading clearly as a small utility building. Keep the four player tints.

**Acceptance:** sprite height ≤ 40px at 1×; placed on a tile it doesn't overlap the neighbouring diamond by more than a few pixels; all four colourways; contact sheet shows it flush on its footprint.

---

## G5. Track can be built anywhere on land — it must extend an existing network
`[gameplay] [P0] [core]`

`src/iso/track.ts` → `canBuildOn()` checks only terrain and industry occupancy:

```ts
if (terrain === WATER) return false;
if (terrain === ROUGH && !TRANSPORT[kind].onRough) return false;
if (grid.occupancy[i] >= 0) return false;
return true;
```

No network-adjacency rule, so a player can drop disconnected road anywhere. That breaks the intended loop — road grows outward from what you already own.

The current rule is also backwards from the design: harvester placement requires touching existing road (`"A harvester must touch road or rail"`), but road placement requires nothing. **The harvester is the anchor, and road grows from it.**

**Intended rule.** A track tile is legal only if 4-adjacent to a tile already in the player's network, seeded by:
- the player's Factory footprint,
- each of the player's Harvesters,
- plus every track tile already connected to either.

**Implementation notes**
- Add `canBuildOn(grid, kind, tx, ty, network?: Set<number>)` — keep the current terrain checks, add the adjacency test when a network is supplied. Leave the 3-arg form for the AI's pathing cost function, which needs pure terrain legality.
- Maintain the network set incrementally: seed from factory + harvesters, union in each committed tile. A full flood fill per drag-preview frame is too slow at 48×48 with a 60fps preview.
- `previewDrag()` must respect it — truncate at the first tile not adjacent to the network-so-far, so a drag extends tile by tile but can't jump a gap.
- Harvester placement then **should not** require existing adjacency; it becomes a new seed. Drop the `"A harvester must touch road or rail"` check and its toast.
- Setup becomes: place Factory → place Harvester → free track allowance connects them. Both are seeds, so the drag can start at either end.

**Acceptance**
- Building a tile not adjacent to your network is rejected with a clear toast.
- A drag from the harvester outward builds continuously; a drag starting in empty terrain builds nothing.
- Rival networks don't count as yours.
- Demolishing a mid-path tile splits the network — tiles beyond the break stop being valid extension points. Test explicitly: an incrementally-maintained set is easy to get wrong on removal, so demolish should force a rebuild of the affected component.
- `src/iso/ai.ts` obeys the same rule — its A* currently paths on terrain legality alone and needs to path *from* its own network.

---

## G6. Road/rail sprites are programmer-art lines, not OpenGFX track
`[assets] [polish]`

`makeGenerated()` draws road and rail as flat grey (`[86,86,86]`) and brown (`[122,82,36]`) segments. Functional, but they read as pencil strokes over detailed pixel art.

After G1 lands, replace the generator with real half-pieces sliced from OpenGFX:
- Road: `src/assets/sprites/png/landscape/landscape031.png`
- Rail: `src/assets/sprites/png/infrastructure/rail/`, with `base-1005-rail-infra.pnml` for sprite indices

Keep the compositing approach — slice **one half-piece per kind**, rotate and mirror into four directions, overlay for all 16 masks. Do not slice 16 separate sprites.

Do G1 first. Fixing geometry with placeholder colours is cheap to verify; doing both at once makes failure ambiguous.

---

## G7. Rebuild and commit the atlas whenever cells change
`[chore] [build]`

`assets/iso-atlas/` is generated by `npm run slice-atlas` but committed. Nothing enforces that it matches `tools/iso-atlas.cells.json`, so a cells edit without a re-run silently ships stale sprites — and G1/G2/G4 all need a re-run to take effect.

**Fix:** CI step running `npm run slice-atlas`, failing if `git diff --exit-code assets/iso-atlas/` is dirty.

---

## G8. Dark wedge artifacts scattered across grass tiles
`[bug] [renderer] [investigate]`

Close-up screenshots show small dark triangular wedges on clean grass in a repeating pattern, plus vertical banding in the wide shot.

Likely one of: the `terrain_grass_b` variant (noticeably more olive than `grass_a` — it may be a field tile, not grass), a chunk-boundary artifact in the 8×8 `OffscreenCanvas` cache, or G2's white row at a different scale.

**Fix G2 first, then re-screenshot.** If wedges persist, isolate by rendering a full-map flat fill of `grass_a` with chunk caching disabled, then re-enable each variable in turn. Attach before/after captures.

---

# Part 2 — Still open from the migration plan

## E8. Starting state and economy rebalance
`[design] [gameplay]`

`VP_TARGET` is still the placeholder `10` with a `// rebalanced in E8` comment. Rebalance against the road/rail curve: `TRANSPORT` VP values (road 1, rail 3), `UPGRADE_COST`, sabotage prices, the free-track allowance, and `INDUSTRY_QUOTA` (which G3 changes by raising land area).

Verify the intended gating actually holds: rail costs `2 ore + 1 stone`, so you must road out to an ore mine before rail is reachable. If ore is available from the starting position the risk/reward curve collapses into a menu. This is the first thing to check in playtesting.

Expect several passes — file follow-ups rather than trying to land it once.

**Note:** free setup builds are already flagged as data (`p.freeTrack`, with a comment that "the allowance is data, so nothing can revoke it"), which correctly avoids K1's bug class. Keep it that way.

---

## E11. Cutover — delete the hex path
`[chore]`

Still present: `src/game/hexmap.ts`, `src/map3d/MapView3D.ts`, `"three": "^0.185.1"` in dependencies, the terrain `.jpg` textures, and the `?legacy=1` branch in `App.tsx`.

Delete all of it once the iso game is stable. Drops ~600KB from the bundle. Regenerate the T2 snapshots afterwards — they'll all need rebaselining.

Do this **after** the G-series. The legacy path is a useful fallback while the iso renderer is still being corrected.

---

## R6. Seed determinism at the multiplayer boundary
`[bug] [multiplayer]`

Partly addressed — `grid.ts` now has an explicit `randomSeed()` and a comment that no client can silently fall back. But `src/iso/game.ts` line 110 still does:

```ts
const seed = (Math.random() * 0xffffffff) >>> 0;
```

Single-player is fine. The multiplayer path must guarantee the host's seed reaches every guest **before** `generateMap` is called, or clients generate different maps with no error surfaced. `src/iso/snapshot.ts` exists but nothing enforces the ordering.

**Acceptance:** a test asserting a guest joining mid-session regenerates the host's exact terrain and industry list; a version mismatch or missing seed produces a clear error rather than a silent desync.

---

## R9. Prune the OpenGFX asset tree
`[chore] [repo-size]`

`src/assets/sprites/` is **19MB** and contains the whole OpenGFX tree — aircraft, ships, trains, toyland, arctic, tropical, African manager faces, `.xcf`/`.psd` sources, `.pnml` definitions. The game uses a small fraction.

Prune to `terrain/`, `industries/`, `infrastructure/`, `landscape/`, `trees/temperate/`, `miscellaneous/`, plus the `stations/` working files. Keep the OpenGFX attribution in the README regardless.

Do this **after G4 and G6**, so you don't delete a source those tickets turn out to need.
