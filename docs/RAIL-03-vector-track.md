# RAIL-03 (#177) — vector rail track, PNG trains: what shipped and where it lives

*"Rail TRACK is vector, drawn like the roads. This is the core of this ticket …
computed in code … painted into the cached chunk raster the roads use,
invalidated by the rail revision. No track sprites and no atlas cells for rails.
Frames blit the cached chunks; train movement must not repaint track or
terrain."* — [issue #177](https://github.com/rumcan/HexMatch/issues/177), parent
spec [#142](https://github.com/rumcan/HexMatch/issues/142).

Before this slice the railway had art (`assets/railway/`, `src/iso/rail-art.ts`)
and rules (`src/iso/rail.ts`) but **no track**: there was no rail cell in the
atlas and nothing drew the layer's bytes. This slice adds the fourth piece —
the vector track — and pins the art/rules contract around it.

## Files added

| File | What it is |
| --- | --- |
| `src/iso/rail-geometry.ts` | The track's ground-plane geometry: masks → runs → steel, sleepers, ballast, crossing boards, buffer stops. The rail twin of `road-geometry.ts`; the only place a rail tile's shape is decided. |
| `src/iso/rail-renderer.ts` | `railTilesIn` / `paintRailTiles`: the batched canvas passes, the detail tiers, and the style. |
| `tests/unit/iso-rail-geometry.test.ts` | The geometry contract: 16 masks, port joins, tie lattice, crossings, lanes, tiers. |
| `tests/unit/iso-rail-cache.test.ts` | The cache and frame contract: rasterise once, sparse invalidation, trains are sprites. |

## Files extended

| File | What changed |
| --- | --- |
| `src/iso/road-renderer.ts` | `RoadWorld.rail`; the rail pass inside `chunk()` after `paintRoadTiles`; `setRailDetail` / `setRailOnly` (both re-key the rasters); `invalidateTile(..., reach)`. |
| `src/iso/renderer.ts` | `World.rail`; `syncRailCache()` — the revision-gated sparse diff; the rail detail pinned from the atlas cap; the `__iso.rendering()` rail block. |
| `src/iso/rail.ts` | `railDrawLayer()` (the effective masks + owners + revision the renderer reads) and `crossingMasksOk()` (the shape half of `crossingOk`, so the geometry's twin can be proved against it). |
| `src/iso/game.ts` | `world.rail = railDrawLayer(rail)` in the world literal and in `syncWorld()`. Nothing else: the drag/commit path already existed (#178). |
| `tests/unit/iso-rail-art.test.ts` | Coupling contract, 1950s palette, provenance and the no-copy-step build guard. |
| `tests/unit/iso-road-cache.test.ts` | One assertion updated for the empty-chunk rule (see below). |

## Checklist → where it lives → what pins it

| #177 clause | Implementation | Pinned by |
| --- | --- | --- |
| Track is vector, in the cached chunk raster | `paintRailTiles` runs inside `RoadCache.chunk()`, after `paintRoadTiles`, into the same surface | `iso-rail-cache.test.ts` "rasterises a chunk once, then only blits it" |
| No track sprites, no atlas cells | the atlas has no rail cell at all; `world.rail` never joins the draw list | `iso-rail-cache.test.ts` "draws the train as a sprite" (no `rail_*` item), atlas audit |
| Two steel rails + sleepers on an absolute lattice | `RAIL_GAUGE`/`RAIL_WIDTH`, `latticeTies` on multiples of `TIE_SPACING` | "is absolute: one sleeper per lattice point, uniform, across tiles and chunks" |
| Seamless across tiles and chunks | ports are the shared ground points; the offset at an end port is the neighbour's own | "lands both rails exactly on the neighbour's rails at every port, all 16 masks" |
| All 16 masks, T and cross, dead ends | `railRuns` pairs arms through the centre; `railTile` adds a buffer stop where the neighbour does not face back | "has geometry for every mask…", "pairs opposite arms…", "draws a buffer stop exactly where the steel ends" |
| Level crossings, road unchanged | `levelCrossing` on masks; the planks/slab are drawn over the untouched road pass; a crossing tile gets no ballast and no sleepers | "classifies crossings exactly as rail.ts does, for all 256 mask pairs", "draws boards between the rails and leaves the road surface alone" |
| Platform / depot lanes line up with ports | `laneTiles`' axis decides the arm; the lane's port bit is the connection, so the steel runs through | "runs the internal track along the lane axis, on all four rotations", "joins the lane to the player's rail at every port" |
| Rail after the roads, before every sprite | the rail pass is inside the chunk raster; the raster is blitted before the first sprite | structural: `drawStructures` blits the cache first (see `render()`), plus the paint-order note in `rail-renderer.ts` |
| Batched into a few paths per chunk | every pass collects the whole chunk and issues one `stroke()`/`fill()` | "costs the same handful of calls for 40 rail tiles as for one" |
| Sparse invalidation by rail revision | `renderer.syncRailCache()`: revision gate, byte diff, `invalidateTile(..., "rail", 1)` | "clears once on first sight of the layer, then drops exactly the tiles that changed", "re-rasterises only the chunks a rail edit touches" |
| Train movement repaints nothing | trains are `world.vehicles` draw items; the layer's revision does not move | "draws the train as a sprite: moving it repaints no track, on any frame" |
| Owner tint **or** neutral steel | **neutral** — see "Decisions" | `rail-geometry.ts` header; the layer still carries `owner` so a change of hands invalidates |
| Optional ballast | the ballast bed (+ shoulder), drawn at High and Medium | "keeps every rail, board and stop identical between tiers" |
| Tiers change detail only | `railDetailFor`: bed / boards / sleeper stride | "draws a lower tier's sleepers at the SAME coordinates, never elsewhere" |
| Vector drag preview | the rail drag rides the same vector overlay as a road drag (`highlight` is an overlay ROLE, painted as boundary loops — never a blit) | `overlay-art.ts`'s scene split; #179 owns any further UI |
| Art: 48 files at every tier | `loadRailwaySprites` (already on main) | `iso-rail-art.test.ts` "installs every sprite…", "has all 48 PNGs on disk" |
| Anchor / footprint / coupling / alpha match the rules | manifest vs `PLATFORM_FOOTPRINT`, `DEPOT_FOOTPRINT`, `LOCO_LEN`/`WAGON_LEN`/`WAGON_OFFSET` | "gives every sprite its footprint, anchor and moving flag", "couples the wagon to the locomotive exactly as the rules space it" |
| 1950s palette, licences, no Transport Fever asset | the generator's palette + `LICENSES.md` | "carries the 1950s palette it was drawn from", "states its provenance" |
| Production build ships the art with no copy step | `import.meta.glob`, no `vite.config.ts` entry | "ships with no build-time copy step"; the build itself (below) |

## Decisions that needed making

1. **A bend is a mitred corner, not a quarter arc.** #178's `pointAt` drives the
   locomotive along the tile-centre polylines, so the steel has to be on those
   polylines: an arc inside the tile would leave the train visibly beside its
   own rails. `railRuns` therefore pairs arms through the centre exactly as
   `roadFigures` does, and the two rails mitre at the corner (round join), so a
   bend still reads as a bend. This is the one place the ticket's wording
   ("curves (quarter arcs)") is not followed literally, and it is followed in
   spirit: the corner is drawn from the same 4-bit mask, batch and lattice as
   everything else.
2. **The tie lattice is 0.25, not the art's 0.23.** 0.25 divides the half-tile,
   so the half-integer ports ARE lattice points and the half-open ownership rule
   `(lo, hi]` lands a sleeper exactly on every join — one tile owns each
   sleeper, so neighbours cannot double up and a chunk boundary cannot shift the
   rhythm. The art's platform lane uses 0.23 (its own drawing); the two never
   meet, because the lane's TIES are drawn by this module too.
3. **Neutral steel, no owner tint.** The road surface carries no owner tint
   either, and ownership is told by the platform, the depot and the locomotive
   — the replaceable PNGs — and by the Railway panel. `Rail.owner` still rides
   in the layer, so a change of hands invalidates that tile's chunks and a
   future owner-tinted detail cannot serve a stale raster.
4. **A crossing tile has no ballast and no sleepers.** A level crossing is road
   surface between the rails: boards on the road, steel over the boards. That is
   also why the road pass had to stay exactly as it was.
5. **The rail pass runs in BOTH road modes.** `__iso.roadMode("sprites")` is the
   A/B seam for the ROAD implementation, and the railway has no cells to fall
   back on, so in that mode the rasters are set to `rail-only` and carry the
   track alone. The flag is part of a raster's content, so it re-keys the cache
   like a detail-tier change.
6. **A chunk with nothing to draw is never rasterised, and never blitted.** It
   is remembered as empty (no surface, no bytes) so the next frame is a hit and
   the blit is skipped. This is what keeps `rail-only` mode free over a map with
   no railway, and it also removes a transparent full-chunk blit per empty chunk
   from the textured path. One existing road-cache assertion ("caches nothing"
   when no surface can be allocated) was updated to the new, stronger contract:
   no bytes are held, and only the chunks that carry road are re-attempted.

## Evidence

- `npx tsc --noEmit` — clean.
- New suites: `iso-rail-geometry.test.ts` 19 tests, `iso-rail-cache.test.ts` 8,
  `iso-rail-art.test.ts` 11.
- `npx vite build --base=./` — every one of the 48 railway PNGs ships: 38 as
  hashed files under `dist/assets/` (referenced relative to `./`) and 10 inlined
  as data URIs by Vite's 4 KiB inline limit. No PNG is missing, and
  `vite.config.ts` has no railway copy step.
- Performance: the rail passes are a constant handful of canvas calls per chunk
  ("costs the same handful of calls for 40 rail tiles as for one"), the frame
  walks the viewport's chunks, and a rail edit re-rasterises one or two of them
  ("re-rasterises only the chunks a rail edit touches").

## Not in this slice

- **PR screenshots** (straight, curve, T, cross, dead end, crossing, platform
  ×4, depot ×4, a train on a curve, Low vs High) need a real Chromium for
  `tools/capture-iso-review.mjs`; this environment has none (`playwright install
  chromium` cannot reach `cdn.playwright.dev`). The equivalent evidence here is
  the geometry contract above; the screenshots are the first thing to capture on
  a machine with a browser.
- **The Railway panel / construction UI polish** belongs to #179, which owns the
  tool UI. Nothing about the drag preview changed here: it already rides the
  vector overlay, and the preview's key already includes the rail revision.
