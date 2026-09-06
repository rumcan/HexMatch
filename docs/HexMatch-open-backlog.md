# HexMatch — isometric rendering, rebuilt to spec (I-series)

**Status: FIXED — 2026-09-06, on `arena/01a07788-hexmatch`.** All six
I-series tickets are implemented and guarded by the committed three-zoom
golden scene. See [Resolution](#resolution-2026-09-06).

Every ticket below carries a **SPEC** section quoting the authoritative principle it enforces (from `HexMatch-iso-research.md`), the **exact current-code violation** (verified against `main` @ `0bec138` / PR #26), the **fix**, and a **pixel-level acceptance test**. The rule from the research holds throughout:

> Ground tiles tessellate into a plane and only the island's rim shows a block side. Buildings are positioned whole on that plane by ONE bottom-anchor and are NEVER clipped. ONE coordinate transform (no fudge) drives draw, highlight and pick. Elevation is −z·TILE_H up and +z depth.

**State verified when these tickets were filed (historical baseline):**
- P4 (pick fudge): the `+HH` in `flatPick` is **already removed** — good, don't reintroduce it. (I2 guards it.)
- P1 (building clip): `skirtCovered` **is still applied to buildings** at `renderer.ts:382` — this is the live regression. **I1 fixes it.**
- P5 (stacking): composites now measure per-layer rise — closer to correct; I3 verifies against the formula.

**Order: I0 (golden-image test) → I1 → I2 → I3 → I4 → I5.** I0 first on purpose — it's the safety net every prior round lacked.

---

## I0. Golden-image render tests at every zoom (build this FIRST)

**Status: FIXED — 2026-09-06.**

`[P0] [testing] [infra]`

### SPEC
> Research Part 5: "The project's tests kept passing while the game broke because they tested the *stated* fix, not the *rendered result*. … Without a real-browser golden-image test, the human is the regression test — which is exactly the loop this project has been stuck in."

Every visual regression in this project shipped with green tests. The root cause is the absence of a test that looks at pixels the way the player does. This ticket builds that test. **It must exist before the other fixes, so each fix is proven by a reference image, not by a unit test of its own internals.**

### What to build
- A deterministic fixture scene (seed-fixed): a grass field, one straight road, one corner road, one single-piece industry, one stacked building (factory), and a coastline edge — all visible at once.
- Render it through the **real renderer** (`drawStructures` + terrain) at zoom **0.5, 1, 2** into an offscreen canvas.
- Commit the three outputs as reference PNGs. The test re-renders and compares pixel-for-pixel (with a tiny tolerance for AA).
- If no browser/canvas in CI: use the same software rasteriser approach as `iso-skirt.test.ts` (it already rasterises real atlas pixels with the renderer's draw math) — extend it to a full scene, not just a skirt check.

### Acceptance
- Three committed reference renders; the test fails if any pixel drifts beyond tolerance.
- Three named assertions the render must satisfy, each a separate test so a failure is specific:
  1. **building-intact**: the stacked building's opaque pixel count at each zoom is within 2% of its unclipped sprite (catches I1 clipping).
  2. **no-interior-brown**: zero brown-range pixels below any non-edge tile (catches skirt leaks).
  3. **highlight==base**: the hover highlight diamond, `pick()`, and the placed building's base tile are the identical tile (catches I2).
- CI runs it on every PR. A red golden-image test blocks merge.

---

## I1. Never clip buildings — the N1 skirt rule is ground-tiles ONLY

**Status: FIXED — 2026-09-06.**

`[P0] [renderer]`

### SPEC
> **P1 — Objects are POSITIONED, never CLIPPED.** [Bellanger; Phaser] "A tall sprite is placed by its anchor and drawn **whole**. Its height is handled by *where you put it* and *what order you draw it*, never by cutting pixels off it." No isometric tutorial clips a sprite, ever.
> **P2 — Ground tiles form a continuous plane; only the rim shows a block side.** The brown-skirt problem is a *ground-tile* problem, solved by tile treatment, not by clipping the things standing on the ground.

### Current violation (verified)
`src/iso/renderer.ts:382` in `drawStructures`:
```js
const covered = skirtCovered(this.world.grid, p.tx, p.ty, p.def.footprint[0], p.def.footprint[1]);
p.clipped = covered;                       // ← applied to ALL structures incl. buildings
this.blit(ctx, p, timeMs, covered);
```
`aboveGroundPoly` is a flat-tile clip shape (footprint diamond + straight up, nothing below/outside). On a building — which is wider than its footprint and whose walls descend to/below the diamond — it slices the walls off. Rounded by zoom, it cuts differently per zoom → buildings hover/vanish (your three screenshots).

### Fix
- In `drawStructures`, apply the skirt clip **only when `p.def.kind === "ground"`** (roads/rail). For `kind === "standing"` (buildings, composites) draw the sprite **whole, unclipped**.
- The building doesn't need clipping: once interior ground tiles are handled (I4), the building stands on a skirtless plane and has no brown to hide.

### Acceptance
- `drawStructures` never passes a clip to a `standing` sprite (assert in a unit test + the I0 building-intact render).
- Buildings render identically and completely at 0.5/1/2× — none clipped, none missing, verified by I0 at all three zooms and while panning.
- Roads (ground kind) keep their working clip.

---

## I2. One coordinate transform for draw, highlight and pick — no fudge

**Status: FIXED — 2026-09-06.**

`[P0] [renderer]`

### SPEC
> **P4 — ONE coordinate convention for draw AND pick.** [Phaser] "`isoToCart` is the exact inverse of `cartToIso`. No `+HH` fudge anywhere." The highlight is placed with the *same* transform that draws tiles, so it is always on the tile the math picks.

### Current state (verified)
The `+HH` fudge in `flatPick` is **already removed** on `main` @ 0bec138 (0 matches for `wy + HH`). Good. **This ticket is a guard, not a fix:** ensure it never returns, and prove draw/highlight/pick agree.

### Fix / guard
- Confirm `flatPick` is the exact algebraic inverse of the draw transform (`wx=(tx-ty)·HW − anchorX`, `wy=(tx+ty)·HH − anchorY`), with **no additive compensation term**.
- The hover highlight must be positioned with `tileToScreen(hoverTx,hoverTy)` — the identical transform used to draw a tile — not a separate path.
- Delete any stale comments referencing the old "pick cell top vertex / sample HH below" model so nobody reintroduces the fudge.

### Acceptance
- Grep: zero additive `+ HH` / `- HH` compensation terms in `flatPick` or the highlight placement.
- I0 **highlight==base** test passes: for any hovered tile, the highlight diamond, `pick()`, and a building placed there occupy the same tile — at every zoom and at non-zero camera offset.
- A unit test round-trips `screenToTile(tileToScreen(t)) === t` for all tiles (already the K0 intent — assert it explicitly).

---

## I3. Stacked buildings anchor at base bottom; elevation is a formula

**Status: FIXED — 2026-09-06.**

`[P0] [renderer] [assets]`

### SPEC
> **P3 — Anchor is the single source of truth; for blocky tiles it's the BOTTOM.** [Unity: "Tile Pivot Y … maximum at your Tile Height"] Single, composite, terrain — all use the same bottom-anchor rule.
> **P5 — Elevation offsets UP and adds depth; never changes the sprite.** [Phaser] `isoY = (cartX+cartY)·TH/2 − z·TILE_H`; `depth = cartX+cartY+z`. A multi-storey building IS this: each storey `z` higher, offset up `z·TILE_H`, depth `+z`.

### Current state (verified)
Composites now measure per-layer rise (`slice-atlas.mjs` — "the rise is MEASURED per layer, BOTTOM face on the layer below's TOP face"). This is closer to correct than the old `STOREY=36` constant. But earlier audits showed the composite **anchor** landing off its base ground row. Verify against the formula and fix if drift remains.

### Fix
- The composite's anchor Y = the **base layer's** ground-contact row expressed in the assembled sprite's coordinates (`basePart.dy + basePart.groundRow`). Not the union bbox top, not `-minTop`.
- Each stacked layer sits at `−(cumulative rise)` above the base; the rise per layer = the measured gap from a layer's ground row to the top face of the layer below (matches P5's `z·TILE_H` generalised to real art heights).
- Depth: the whole stack sorts as one object on its **base** footprint tile (P6), drawn in front of that tile.

### Acceptance
- Manifest invariant (unit test): for every composite, `anchor[1] === basePart.dy + basePart.groundRow`.
- `__iso.dumpBuilding(tx,ty).gapPx === 0` for factory and depot.
- I0 render: the 5-storey factory sits flush on its tile, floors flush, roof on top, no gap under the base — at all zooms.

---

## I4. Ground-tile skirt: flat interior, block only at the island rim

**Status: FIXED — 2026-09-06.**

`[P0] [renderer] [assets]`

### SPEC
> **P2** — interior ground tiles tessellate into a plane; **K-c** — "you only want that [cube] side at the island's edge; interior tiles' sides are covered by the tile in front, *provided the vertical spacing ≥ the exposed side height*. If the art's side is taller than the spacing, either (i) pick/author tiles whose side ≤ spacing, or (ii) draw interior tiles as flat tops and the block only at the rim."
> **P8** — "prevent seams by tile OVERFLOW, never gaps; use straight alpha."

### Current state
`BLOCK_H = 66` but tile vertical spacing is `HH = 32`. So each tile's 66px side exceeds the 32px spacing by 34px → interior sides leak (the brown). This is the ground-tile half of the brown problem (buildings are I1).

### Fix (choose per K-c, recommend option ii)
- **Interior ground/road tile** (all four neighbours are land): draw only its diamond top (flat), no block side.
- **Edge tile** (a neighbour toward the viewer is water/off-map): draw the full block including the brown side — this is the island's visible thickness.
- "Edge" = SE and/or SW neighbour is water or off-map (those are the tiles whose side would otherwise be exposed).
- This is the ONLY place skirt/block logic lives. Buildings (I1) are never involved.

### Acceptance
- I0 **no-interior-brown**: zero brown below any interior tile; the interior reads as a continuous flat plane.
- The coastline shows the brown block side (island thickness).
- A built road on the interior is flush with the grass, no brown kerb.

---

## I5. Fix grass seams and repick flush road tiles

**Status: FIXED — 2026-09-06.**

`[P1] [assets]`

### SPEC
> **P8 — seams:** "it's better for the tile to overflow slightly than to be too small … use straight alpha, or translucent edges take the sky/background colour (visible seams)."
> **K-c / P2 — roads:** the "elevated road" look is a road *tile with a raised side baked in*; interior roads must be flush ground tiles.

### Current violations
1. Hard dark lines at every grass seam (your screenshots) — either sub-pixel gaps from `Math.floor` draw positions exposing the darker background, or the grass tile's own dark bottom-edge lip tiling.
2. Road tiles picked for connection geometry but with raised sides → "elevated road."

### Fix
- **Seams:** ensure adjacent tiles' floored draw positions abut with no 1px gap at any zoom (draw tiles to slightly overflow, per P8); if the grass art has a baked dark edge lip, repick a cleaner flat grass tile via the Art Lab, or once I4 draws interior tiles as flat tops the lip is hidden anyway — verify after I4.
- **Roads:** repick the flat/flush road tiles in the Art Lab (asphalt at ground level, no raised concrete side), keeping the connection masks. Verify a road tile sits level with adjacent grass.

### Acceptance
- Interior grass reads as a continuous field — no hard dark grid between tiles, at all zooms.
- Roads are flush with terrain; screenshot of a road beside grass shows no kerb/step.

---

## Sequencing & the meta-rule

**I0 → I1 → I2 → I3 → I4 → I5.**

I0 (golden-image) first — it is the test that proves every subsequent fix and would have caught every past regression. Then I1 (stop clipping buildings — the live regression), I2 (guard the pick fix), I3 (stack anchors), I4 (ground skirt = rim only), I5 (seams + road art).

**The meta-rule for whoever implements these** (from the research): *ground tiles and buildings are different.* Ground tiles tessellate into a plane and only the rim shows a block side (I4). Buildings are positioned whole on that plane and never clipped (I1). Every past round broke because it tried to fix a ground-tile problem by cutting up buildings. Do not repeat it — and let I0's building-intact test stop you if you do.

---

## Resolution (2026-09-06)

| ticket | delivered |
|---|---|
| **I0** | `tests/unit/iso-golden.test.ts` renders one deterministic full scene through the real atlas, anchor/depth, skirt and pick math at 0.5×/1×/2×. Three reference PNGs are committed under `tests/fixtures/iso-golden/`; named assertions cover building integrity, inland brown, transform agreement and hard seams. `npm test` runs this gate on every CI/PR. |
| **I1** | `shouldClipGroundSkirt` is now the renderer's single boundary: inland `ground` art is clipped, while every `standing` sprite (single-piece and composite) is drawn whole and remains wholly pickable. |
| **I2** | `screenToTile` is the one centred-diamond inverse shared by camera, renderer (`flatPick` is an alias), input and highlights. Round trips are pinned for every map tile at every zoom with a non-zero camera offset. |
| **I3** | Composite manifest parts retain their measured `groundRow` and `rise`. The packer defines `anchorY` as `base.dy + base.groundRow`; schema validation and unit tests enforce the base-contact and every consecutive-rise equation for factory/depot variants. |
| **I4** | Terrain and flush ground overlays clip their block side inland and keep it at the SE/SW water or map rim. Structure clip coordinates now scale once—not twice—at 0.5× and 2×. |
| **I5** | Roads remain on the reviewed flat K-FIX-2 mask set. Grass now uses a generated straight-alpha top with one logical pixel of 1:1 overflow (`derived/terrain_grass.png`), removing the dark interior grid without runtime image scaling; chunk bounds include the overflow. |

### Verification

- Golden scene contains a grass field, straight road, corner road, single-piece
  industry, five-layer factory, placement highlight and coastline in every PNG.
- The derived-art reproducibility gate regenerates the new grass source as well
  as rail/crossing/highlights; a second atlas build was byte-identical.
- `npm test`: 419 passed. `npm run typecheck`, `npm run build`, manifest
  validation and the atlas regeneration gate also passed. `npm run lint`
  completed with no errors (33 pre-existing warnings).
