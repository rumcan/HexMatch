# HexMatch — revert the art to OpenGFX (keep all gameplay)

For the coding agent. The Kenney isometric art cost more than it delivered: buildings clip/hover/vanish per zoom, brown skirts leak, tiles have inconsistent heights the renderer can't model. The OpenGFX pixel-art version that preceded it had a **working flat renderer** and looked correct. This doc reverts to it — **without losing any of the 55 commits of gameplay work** (gold match-3, AI rival, economy, market, trading, tests) that landed after the cutover.

---

## Why NOT a git revert

The Kenney cutover is commit **`e4bd232`** ("K0-K4: Kenney isometric art cutover"). Since then, **55 commits** have landed on top of and interleaved with it. `git revert e4bd232` (or resetting to before it) would destroy all of that — the gold change, the rival fix, economy tuning, the market, the golden-image tests, everything.

**This is a FORWARD restore, not a git revert.** We copy the OpenGFX art + pipeline back from history and re-point the constants, leaving every gameplay file as it is on current `main`.

Good news, verified: the cutover **only touched the art layer** — 8 files. It did **not** touch `board.ts`, `economy.ts`, `ai.ts`, `market.ts`, `quarry.ts`, or `trade.ts`. So the art and the gameplay are cleanly separable.

---

## The two reference commits

- **`14072fe`** — the last commit with OpenGFX art fully intact (immediately before the cutover). This is the SOURCE for everything we restore.
- **`e4bd232`** — the cutover itself. Its file list IS the exact scope of what to revert:
  ```
  src/game/config.ts          (constants: TILE_W/H, MAP_W/H)
  src/iso/config.ts           (iso-specific constants)
  src/iso/renderer.ts         (block-tile anchor/clip math)
  tools/slice-atlas.mjs       (packer)
  tools/iso-atlas.cells.json  (tile mapping)
  assets/iso-atlas/*          (packed atlas + manifest)
  tests/unit/iso-atlas-pixels.test.ts
  tests/unit/iso-renderer.test.ts
  ```
  Plus K5/K6 follow-ups (`560e6cb`, `6d1db76`) that added Kenney vehicles and **deleted the OpenGFX source tree**.

Everything else on `main` stays.

---

## R1. Restore the OpenGFX source art and pipeline
`[P0] [assets] [tooling]`

### What to restore from `14072fe`
```bash
# the OpenGFX PNG source tree + pnml declarations (K6 deleted these)
git checkout 14072fe -- src/assets/sprites/

# the declaration-driven packer and parser (the cutover rewrote slice-atlas;
# K6 deleted parse-pnml)
git checkout 14072fe -- tools/slice-atlas.mjs
git checkout 14072fe -- tools/parse-pnml.mjs        # if it existed at 14072fe
git checkout 14072fe -- tools/iso-atlas.cells.json

# the flat-tile renderer math + constants
git checkout 14072fe -- src/game/config.ts
git checkout 14072fe -- src/iso/config.ts
git checkout 14072fe -- src/iso/renderer.ts
```

### The critical constants that come back (verified at `14072fe`)
```ts
export const TILE_W = 64, TILE_H = 32;   // was 132/64 under Kenney
export const HW = 32, HH = 16;
export const MAP_W = 48, MAP_H = 48;     // was 32/32
// NO BLOCK_H — OpenGFX tiles are FLAT (64×31 diamond, no cube skirt).
```
This is the whole point: OpenGFX tiles are **flat pixel diamonds with no skirt**, so the entire brown-skirt / block-side / anchor-height problem class **does not exist**. There is nothing to clip, no skirt to hide, no per-tile height to model.

### Then regenerate the atlas
```bash
node tools/parse-pnml.mjs        # rebuild opengfx-sprites.json from .pnml
node tools/slice-atlas.mjs       # repack the OpenGFX atlas
```

### Acceptance
- The map renders in OpenGFX pixel art: flat grass/water/rough, roads that connect, industries as recognisable buildings — matching how it looked at `14072fe`.
- No brown skirt anywhere, no hovering, no per-zoom vanishing (these were all Kenney-block artifacts that cannot occur with flat tiles).
- `npm run typecheck`, `npm test`, `vite build` all green.

---

## R2. Reconcile the tile mapping with post-cutover gameplay
`[P0] [assets]`

The OpenGFX `iso-atlas.cells.json` from `14072fe` predates several gameplay changes. After restoring it, reconcile:

- **Cargo/industry set:** confirm the six industries (farm/forest/ore/quarry/oil/gold) still map to OpenGFX sprites. The OpenGFX cells file already had these (it's where they came from originally).
- **Roads/rail:** OpenGFX used the declared 1332-road-set + derived rail. Confirm the 16 masks resolve. The RoadBits remap (`toOpenttdRoadBits`) may live in `track.ts` — keep it.
- **No `stack` / `compose`:** OpenGFX buildings are single sprites; the Kenney-era `stack` field is gone with the revert. Confirm no cell references it.
- **Gems are unaffected** — the match-3 gem art (`src/assets/gems/*.png`) is UI, separate from the map atlas. Leave it. The new gem sprites stay.

### Acceptance
- Every game concept (terrain, 16 road masks, 16 rail masks, 6 industries, factory, depot, highlight) resolves to an OpenGFX sprite in the restored cells file.
- No `stack`, `compose`, `box`, or Kenney path remains in `iso-atlas.cells.json`.

---

## R3. Restore the flat-tile renderer, delete block-tile logic
`[P0] [renderer]`

Restoring `renderer.ts` from `14072fe` (R1) brings back the flat-tile draw path. Then **remove the block-tile machinery** the cutover added, which has no meaning for flat tiles:

- `skirtCovered`, `aboveGroundPoly`, `clipAboveGround` — delete. Flat tiles have no skirt to clip. (This is the code that clipped buildings and made them vanish.)
- `BLOCK_H` references — delete.
- The `+HH` / block-height offsets in culling and chunk sizing — revert to the flat-tile versions from `14072fe`.
- Anchor: OpenGFX sprites anchor by their declared `xrel`/`yrel` (from the `.pnml`), NOT a measured widest-row/skirt. Confirm the restored renderer uses declared offsets.

### Why this fixes everything at once
Per the research (`HexMatch-iso-research.md`): the entire bug class — hovering buildings, brown skirts, per-zoom vanishing, highlight offset — came from the block tiles having heights the renderer modelled with clips and fudges. **Flat OpenGFX tiles have none of that.** A flat diamond sits on the grid by its declared offset; a building is drawn whole on top; there is nothing to clip or normalise.

### Acceptance
- No `skirtCovered`/`aboveGroundPoly`/`BLOCK_H` anywhere in `src/iso/`.
- Buildings draw whole at every zoom (0.5/1/2×) — verified by screenshot at each zoom.
- The placement highlight is on the same tile as the building base (flat-tile pick is the clean inverse, no fudge).

---

## R4. Delete the Kenney assets and update credits
`[chore]`

Once R1–R3 render correctly:
- Delete `src/iso/kenny/` (the Kenney PNGs — buildings, landscape, vehicles).
- Remove Kenney from README credits; restore the OpenGFX (GPLv2) attribution.
- Remove any Kenney-specific tooling (`normaliseSkirt` etc.) if not already gone with the renderer revert.
- Keep `docs/HexMatch-iso-research.md` — it explains *why* flat tiles are correct and block tiles were the mistake; useful if anyone proposes 3D-style art again.

### Acceptance
- No `kenny`/`kenney` path in `src/` or the atlas.
- README credits OpenGFX; licence is consistent.
- Bundle size drops (Kenney art was larger).

---

## R5. Restore/adapt the OpenGFX-era tests; keep the gameplay tests
`[testing]`

The cutover rewrote `iso-atlas-pixels.test.ts` and `iso-renderer.test.ts` for block tiles. Restore their `14072fe` versions (flat-tile assertions). **Keep all gameplay tests** (board, economy, ai, market, quarry, trade) exactly as they are on current `main` — they're art-agnostic.

- Restore: the two art/renderer test files from `14072fe`.
- Keep: everything else, including the golden-image test if I0 from the prior ticket set landed (adapt its reference PNGs to OpenGFX art).
- Delete: `iso-skirt.test.ts` and any Kenney-block-specific test — flat tiles have no skirt.

### Acceptance
- Full suite green; the restored art tests assert flat-tile geometry; all gameplay tests unchanged and passing.

---

## Sequencing & the one rule

**R1 → R2 → R3 → R4 → R5.**

R1 restores art + constants, R2 reconciles the mapping, R3 strips the block-tile renderer machinery, R4 deletes Kenney, R5 fixes tests.

**The one rule for the agent:** this is a *forward restore*, never a `git revert`/`reset` — 55 gameplay commits sit on top of the cutover and must survive. Copy specific files from `14072fe`, leave `board.ts`/`economy.ts`/`ai.ts`/`market.ts`/`quarry.ts`/`trade.ts` and all their tests exactly as they are on `main`.

## One-line summary

> Forward-restore the OpenGFX flat pixel-art pipeline from commit 14072fe (art tree, slice-atlas, parse-pnml, cells.json, TILE_W/H=64/32, renderer) and delete the Kenney block-tile machinery (kenny/ assets, skirtCovered/aboveGroundPoly/BLOCK_H) — while keeping every gameplay file and test from current main untouched. Flat tiles have no skirt, so the entire hover/brown/vanish bug class disappears by construction.