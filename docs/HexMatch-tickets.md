# HexMatch — fix towns (0 spawning) + extend multi-tile to all industries

Audited against `main` @ `49662ba` (PR #30). Two findings, both verified by running the code:

1. **Towns: ZERO spawn on every seed** — a self-blocking bug in the reachability check rejects every candidate. That's why you see no towns.
2. **Multi-tile: only the factory got it.** The factory is a correct 2×2, but all six industries (farm/forest/ore/quarry/oil/gold) are still single 1×1 tiles. And each industry's real tile count must come from OpenTTD's tables, not a guess.

---

## F1. Towns place zero because the reachability check blocks the tile it starts from
`[P0] [map] [bug]`

### The bug (verified — ran generateMap on 4 seeds, all returned towns=0)
In `placeTowns` (`src/iso/grid.ts` ~line 333), the reachability guard builds its `blocked` set from **every occupied tile including all industries**:
```js
for (let i = 0; i < MAP_W * MAP_H; i++) {
  if (occ[i] !== -1) blocked.add(i);   // ← adds ALL industry tiles
}
for (const [hx, hy] of houses) blocked.add(idx(hx, hy));
if (!allIndustriesReachable(blocked)) continue;
```
Then `allIndustriesReachable` starts its flood **from an industry tile** and immediately bails:
```js
if (blocked.has(start)) return false;   // start IS an industry tile → always false
```
So every town candidate fails the check → `placed` never becomes true → **0 towns, every seed.** The reachability check is meant to verify that *town* tiles don't wall off industries — it should block only the proposed **town** tiles, not the industries themselves.

### Fix
- `blocked` should contain **only the proposed town house tiles** (and water is already handled inside the flood). Do not add industry tiles to `blocked`.
- The flood then starts from an industry tile (not blocked) and checks that **every** industry tile is still reachable across land that excludes the town footprint. That's the correct question: "do these houses strand an industry?"
- Keep water excluded in the flood (already done).

### Acceptance
- `generateMap(seed)` returns **exactly 4 towns** for seeds 1337, 7, 42, 100 (and generally). Add a unit test asserting `towns.length === 4` across several seeds.
- Towns are visible on the map as building clusters.
- The reachability guarantee still holds: add a test that every industry tile is land-reachable after towns are placed.
- Determinism: same seed → identical towns.

### Watch out
- Don't "fix" this by deleting the reachability check — that reintroduces the stranding risk the check exists for. Fix the `blocked` set to contain only town tiles.

---

## F2. Give each industry its correct multi-tile footprint from the OpenTTD tables
`[P0] [assets] [renderer]`

### Current state (verified)
- Factory: correct 2×2 (`FACTORY_TILES`, sprites 2146–2149 ground + 2150–2152 buildings). Good — this is the pattern to follow.
- farm, forest, ore_mine, quarry, oil_rig, gold_mine: **all still `footprint: [1,1]`**, single sprite. MT-1 was only applied to the factory.

### The rule: each industry's tile count is DATA, not a choice
Every OpenGFX industry has a specific footprint defined by its `_tile_table_*` in OpenTTD's `src/table/build_industry.h`, and its sprites are declared in `src/assets/sprites/pnml/base/base-2011-industries.pnml`. **Transcribe each one; do not assume a size.** For reference, the base-set footprints are roughly:
- **Coal mine / ore (steel mill)** — 3×3 (mine has a headframe + conveyor spanning tiles).
- **Farm** — 2×2 (barn + silo + field tiles).
- **Oil wells / rig** — multi-tile with derricks on some tiles.
- **Forest** — 2×2 (tree tiles + lumber camp) — or keep as a cluster.
- **Gold mine, quarry** — check the table; some are 2×2.

The agent must read the actual `_tile_table_*` for each industry the game uses and transcribe: for each `(dx,dy)`, the ground sprite id and any building sprite id (with the sprite's declared `xrel/yrel` from the `.pnml`).

### Fix
- Generalise the factory's `FACTORY_TILES` approach into a per-industry `tiles` layout (reuse the same data shape and the same per-tile draw path — each tile: ground sprite + optional building piece at its `xrel/yrel`).
- Set each industry's `footprint` to its real size from the table.
- Update placement/occupancy so an industry occupies all its footprint tiles (the factory already does this — extend it).
- Depth: each industry tile sorts individually by `(tx+dx)+(ty+dy)`, exactly like the factory — so roads interleave correctly.

### Watch out (all have bitten this project)
- **Transcribe, don't measure.** The tile→sprite mapping is authoritative data in `build_industry.h`. Do not infer footprints from pixel dimensions — that's produced wrong picks every time.
- **Use declared `xrel/yrel`** from the `.pnml` for each building piece, never a hand-authored anchor.
- **Flat tiles, no clipping.** Reuse the working flat multi-tile draw path from the factory; do not add any skirt/block/clip logic.
- **Catchment counts an industry once** even though it now covers several tiles — verify a harvester's 4×4 catchment credits a 3×3 mine a single time, not nine times.
- **Placement spacing:** bigger footprints need the industry-placement Poisson-disc spacing re-checked so 3×3 industries don't overlap or crowd the coast.

### Acceptance
- Each industry renders at its correct OpenTTD footprint (e.g. ore mine 3×3, farm 2×2), composed from its real ground + building sprites — matching a screenshot of that industry in OpenTTD/OpenGFX.
- Every referenced sprite id exists in the `.pnml`.
- Roads sort correctly per-tile around each multi-tile industry.
- Catchment credits each industry once; all footprint tiles are unbuildable.
- Determinism and reachability (with the bigger footprints) still hold.

---

## F3. Verify the factory layout is the REAL OpenTTD table, not a plausible guess
`[assets]`

While extending to other industries, double-check the factory itself. The current `FACTORY_TILES` comment says "OpenTTD layout (tile indices 39–42) maps to ground tiles 2146–2149" — confirm that mapping against the actual `_tile_table_factory_0` in `build_industry.h`, including **which** tiles carry buildings (2150/2151/2152) and which is the empty yard (currently (0,1)). The screenshot shows the factory reading a bit lopsided — that may be a wrong piece-to-tile assignment.

### Acceptance
- `FACTORY_TILES` matches `_tile_table_factory_0` exactly (tile positions and which sprite each carries).
- The rendered factory matches the OpenTTD factory's appearance.

---

## Sequencing

**F1 → F3 → F2.**

- **F1 (towns)** first — it's a one-spot bug fix (the `blocked` set) and gets towns visible immediately, which is what you're missing.
- **F3** verify the factory layout is real before copying its pattern.
- **F2** extend the verified multi-tile pattern to all industries, each at its real footprint.

## The through-line for the agent

Every industry's footprint and tile layout is **authoritative data** in OpenTTD's `build_industry.h` + the repo's `.pnml` declarations. Transcribe it exactly — do not guess a size or measure it from pixels (that has produced wrong results every time in this project). Reuse the factory's flat multi-tile draw path; add no clipping. And verify by rendering each industry, not by a green test suite — the towns "passed" their unit tests while generating zero on every seed.