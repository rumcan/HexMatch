# HexMatch — multi-tile industries + four towns (OpenGFX)

Two features for the coding agent, each with research, the exact OpenGFX data, and acceptance criteria. Now that the flat OpenGFX renderer works, multi-tile industries are finally viable — OpenGFX industries were *designed* as multi-tile, and the data to place them is in the repo.

---

## Background research: how OpenGFX industries actually work

OpenGFX industries are **not single sprites** — they're several per-tile sprites composed across a footprint, exactly as OpenTTD draws them. Verified in the repo's own declarations (`src/assets/sprites/pnml/base/base-2011-industries.pnml`):

The **factory** is sprites **2146–2160**:
- **2146, 2147, 2148, 2149** — four **ground tiles** (each `64×31`, `xrel −31, yrel 0`) — the concrete pads, one per footprint tile.
- **2150, 2151, 2152, …** — **building pieces** with tall offsets (e.g. 2150 is `57×62` at `xrel −28, yrel −37`) — the brick halls and chimneys that sit up above the ground.

So a factory is a **2×2 footprint**: four tiles, each drawn as `ground sprite` + (on some tiles) a `building piece` at its declared `xrel/yrel`. The current cell uses just **one** building sprite (2169) on a **1×1** footprint — that's the "1-tile slice" you see.

This is the same pattern the research doc (`docs/HexMatch-iso-research.md`, P7) describes: *multi-tile sprites are anchored by their footprint, composed per-tile.* And critically — because OpenGFX tiles are **flat** (no skirt), composing them is straightforward: each tile's ground + building draws at its own screen position, depth-sorted, with the declared offsets. No block-height math.

The layout (which tile gets which piece) is defined in OpenTTD's `src/table/build_industry.h` as `_industry_tile_table_*`. For the base factory it's roughly a 2×2 block with the ground on all four and building pieces on the back tiles. The agent should transcribe the real table (see R-MT-2).

---

## MT-1. Model multi-tile industries in the data + renderer
`[P0] [assets] [renderer]`

### Spec
An industry cell gains a **footprint** larger than 1×1 and a **per-tile layer list**: for each `(dx, dy)` in the footprint, the ground sprite and any building sprite drawn there, each by its declared `xrel/yrel`.

Proposed cells.json shape (additive — single-tile industries keep their current form):
```json
{
  "name": "factory",
  "footprint": [2, 2],
  "tiles": [
    { "dx": 0, "dy": 0, "ground": 2146, "building": 2151 },
    { "dx": 1, "dy": 0, "ground": 2147, "building": 2150 },
    { "dx": 0, "dy": 1, "ground": 2148 },
    { "dx": 1, "dy": 1, "ground": 2149, "building": 2152 }
  ]
}
```
(exact sprite→tile assignment comes from the OpenTTD table in MT-2.)

### Renderer
- Each footprint tile draws its ground sprite at that tile's screen position, then its building piece at the same position offset by the piece's `xrel/yrel`.
- **Depth:** each tile of the industry sorts individually by `(tx+dx)+(ty+dy)` — the industry is NOT one sprite, it's N tiles that interleave correctly with roads/other buildings by the normal painter order (research P6). This is why a multi-tile industry can have a road pass in front of its front tiles and behind its back tiles correctly.
- Because tiles are flat, there is **no clipping and no skirt** — reuse the working flat draw path.

### Occupancy
- The industry occupies all footprint tiles in `grid.occupancy` (a harvester's 4×4 catchment already handles multi-tile industries — confirm it counts an industry once even if several of its tiles fall in range).

### Acceptance
- The factory renders as a full 2×2 building (four tiles: concrete pads + brick halls + chimneys), not a 1-tile slice.
- A road drawn past the factory sorts correctly per-tile (in front of front tiles, behind back tiles) — no z-fighting.
- All four footprint tiles are unbuildable/occupied; the catchment still credits the industry once.
- Single-tile industries (farm, mine, etc.) are unchanged.

---

## MT-2. Transcribe the OpenTTD factory layout (and pick multi-tile for the others)
`[assets]`

### Spec
Get the exact tile→sprite assignment from OpenTTD's `src/table/build_industry.h`, `_industry_tile_table_factory` (and the industry draw table `industry_land.h` for which sprite each tile-gfx-id draws). Transcribe it into the `tiles` array for the factory. The sprite ids are already declared in the repo's `.pnml` (2146–2160), so this is mapping the layout, not measuring pixels.

For the other industries, decide per-industry whether multi-tile is worth it:
- **Factory** — yes, 2×2, it's the showcase building and currently looks worst.
- **Steel mill / ore, oil rig** — OpenGFX has multi-tile versions (steelmill.png, oilwell) — do these if the factory pattern proves out.
- **Farm, forest, gold mine, quarry** — the single-tile versions already read fine; leave them 1×1 unless they look small next to a 2×2 factory.

### Watch out (this caught us before)
- **Do NOT measure/guess the layout.** The tile→sprite mapping is authoritative data in `build_industry.h`. Transcribe it; don't infer it from pixels. (Every past "measure it" attempt picked wrong.)
- The `.pnml` gives each sprite's exact box and `xrel/yrel` — use those, never a hand-authored anchor.

### Acceptance
- The factory layout matches OpenTTD's real table (same tiles get the same pieces).
- Every referenced sprite id exists in the `.pnml` declarations.
- Contact-sheet/golden render shows a coherent factory.

---

## TOWN-1. Generate four towns on the map
`[P0] [map] [gameplay]`

### Research: what a "town" needs
- **Sprites:** ⚠ **the restored OpenGFX tree has NO house/town sprites** — the earlier R9 prune kept only `industries/ infrastructure/ landscape/ miscellaneous/ stations/ terrain/ trees/`. So towns need art first (TOWN-2). Flag this before starting: you cannot place houses that aren't in the atlas.
- **Placement:** towns are clusters of building tiles, generated deterministically like industries (`grid.ts` already does Poisson-disc industry placement with a seed — towns follow the same pattern).

### Spec
- In `src/iso/grid.ts`, after industry placement, generate **exactly 4 towns**.
- Each town: a cluster of N house tiles (say 6–12) around a town centre, placed on land, not on water, not overlapping industries or each other, spaced apart (reuse the Poisson-disc/min-distance logic already there for industries).
- Deterministic under the map seed (same seed → same 4 towns), because `net.ts` ships only the seed (multiplayer determinism — the existing E10 constraint).
- Towns occupy their tiles in `grid.occupancy` so you can't build on houses; roads may route around/between them.

### Watch out
- **Determinism:** towns must generate from the same seeded RNG as everything else. A `Math.random()` fallback here silently desyncs multiplayer — this exact bug (R6) bit us before. Route through the injected `mulberry32` RNG.
- **Reachability:** don't let a town wall off part of the map. After placing towns, the existing reachability check (every industry reachable by land) must still pass — add towns to that flood-fill as impassable and confirm no industry is stranded.
- **Don't block the coast-only-water rule:** towns are land features; keep water at the map edge only (the earlier G3 fix).

### Acceptance
- Exactly 4 towns spawn, as visible building clusters, on every seed.
- Towns never overlap industries, water, or each other; every industry remains reachable by land.
- Same seed → identical towns in two browsers (determinism test).
- Town tiles are unbuildable; roads route around them.

---

## TOWN-2. Source town/house art (blocker for TOWN-1 visuals)
`[assets]`

### The problem
The OpenGFX house sprites were pruned. Options, in order of preference:
1. **Restore OpenGFX houses from upstream.** The OpenGFX repo has a `houses/` sprite set with `.pnml` declarations. `git`-fetch them from the OpenGFX source (same place the industries came from) into `src/assets/sprites/png/houses/` + the matching `.pnml`, and regenerate the atlas. This keeps one consistent art style.
2. **Use station/misc buildings as stand-in town buildings** (`stations/RevStatBuilding_DanMacK.png`, misc industry buildings) — fewer, less varied, but already present.
3. **Simple town-centre marker** — one distinct building per town (a church/townhall sprite) plus generic house tiles, if full variety isn't needed for the jam.

Recommend option 1 if the OpenGFX house set is accessible; it's the consistent choice. Confirm the sprites exist and declare them in `.pnml` before TOWN-1 tries to place them.

### Watch out
- **Prune lesson (R9):** whatever you restore, keep the `.pnml` declarations — they're the sprite-offset source of truth, not disposable. Don't restore PNGs without their declarations.
- Match the OpenGFX flat-tile convention (64×31 ground + building pieces with `xrel/yrel`), same as industries — so houses drop into the same flat renderer with no special casing.

### Acceptance
- A set of house/town-centre sprites is in the atlas with `.pnml` declarations.
- They render flush on flat tiles like every other OpenGFX building.
- TOWN-1 can reference them by sprite id.

---

## Sequencing

**MT-1 → MT-2 → TOWN-2 → TOWN-1.**

- Multi-tile factory first (MT-1/MT-2) — it's the visible win and proves the flat multi-tile compose works.
- **TOWN-2 before TOWN-1** — you can't place town buildings that aren't in the atlas. Source the art, then generate the towns.

## Watch-outs carried from this project's history (all have bitten us)

1. **Don't measure/guess layouts or tile picks** — use the authoritative `build_industry.h` table and the `.pnml` offsets. Every "I'll infer it from pixels" attempt was wrong.
2. **Determinism** — all town/industry randomness through the seeded `mulberry32`, never `Math.random()`. A fallback desyncs multiplayer silently.
3. **Reachability** — after adding towns, re-run the land-reachability check; a town must not strand an industry.
4. **Keep the `.pnml` when restoring art** — offsets live there; PNGs alone are useless.
5. **Flat tiles, no clipping** — reuse the working OpenGFX flat draw path; do not reintroduce skirt/block/clip logic. Multi-tile industries compose by per-tile depth-sort, not by one big clipped sprite.
6. **Verify by render, not by green tests** — "tests pass" has repeatedly hidden broken visuals. State explicitly what still needs a real-browser check.
7. **One ticket per PR**, stop at each acceptance block.