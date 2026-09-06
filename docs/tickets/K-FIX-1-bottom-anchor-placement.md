# K-FIX-1 — Switch to bottom-anchor placement; remove skirt normalisation

**Status:** FIXED — 2026-09-06, on `arena/01a076ea-hexmatch`.
**Filed:** `docs/HexMatch-open-backlog.md`, P0, `[renderer] [assets]`.
**Area:** `tools/slice-atlas.mjs` (the packer), `tools/make-derived-art.mjs`,
`src/game/config.ts`, `src/iso/debug.ts`.

---

## The rule, and where it comes from

The backlog's research is the specification, and the implementation follows it
literally. Three sources, all saying the same thing:

1. **Kenney, "Importing 3D models into game engines"**
   (kenney.nl/knowledge-base/game-assets-3d), *Isometric renders*: a flat
   single tile is `128 × 64`, and *"the transparent pixels around each tile are
   margin for larger tiles, or tiles that don't fit within the usual tile
   size."* Placement is **one fixed drawing offset** (X: −192, Y: 170) for
   every tile, whatever its height. Tiles are meant to vary; the offset does
   not.
2. **PIXI isometric tutorial using Kenney road tiles** (peepsquest/tutorials) —
   this repo's exact bug, named: *"Tiles with height (z-direction) seem to
   float as they are drawn from the top instead of the bottom. Ooops! The fix
   is to draw tiles from the bottom-left."*
3. **Unity isometric tilemap docs** — dimetric cell `(1, 0.5, 1)` with
   "Isometric Z as Y": height is added upward from a fixed floor.

PR #24's skirt normalisation did the opposite — it cropped every tile to a
50px skirt to force one height. That fights the format, and it is what broke
the stacked-building anchors.

## What changed

| file | change |
|------|--------|
| `tools/slice-atlas.mjs` | **`normaliseSkirt` deleted.** Every source PNG is packed at its native size. New measured primitives: `groundRow(c)` (the base diamond's left/right corner row — the tile's ground contact line), `bottomRow(c)`, and `layerRise(c)`. `anchorFor` returns the ground row for `ground` **and** `standing` cells; vehicles are unchanged (bottom-centre). The flat-only filter now tests the *ground row* rather than the widest row. |
| `tools/slice-atlas.mjs` (composites) | the per-storey `STOREY = 36` constant is **gone**. Layer *i* sits on the measured top face of layer *i−1* (`layerRise`), so a 60px roof cap and an 85px storey stack correctly without a magic number, and the composite anchor is the base layer's ground row. |
| `tools/make-derived-art.mjs` | the derived rail/crossing tiles were drawn on an 83px canvas — a shallower skirt than the 99px Kenney roads they connect to. That mismatch was *hidden* by normalisation and became visible the moment tiles kept their native height, so the derived block silhouette now matches `landscapeTiles_067` exactly (132×99, plateau to y=65, taper to the bottom vertex at y=98). The crossing's base road was also moved to the flat crossroads (K-FIX-2). The glows keep their own compact 83px canvas — they are UI diamonds, not blocks. |
| `tools/iso-atlas.cells.json` | `blockH` removed — it existed only to drive the normalisation. |
| `tools/render-reference.mjs` | `blit` now understands composites (draws `parts` bottom→top), so the committed acceptance renders show the real stacked buildings instead of just their base layer. |
| `src/game/config.ts` | `BLOCK_H` is now **66** and documented as *the deepest skirt in the set* — a budget for chunk-surface sizing and cull padding, not a height every tile is forced to. |
| `src/iso/debug.ts` | the C5 console reports what the new rule actually promises. `skirtPx` is the tile's **native** skirt (and is *expected* to vary); the new **`surfaceDriftPx`** is the tile's ground row minus the shared ground line, and that is the number that settles a "terrain is stepping" report. `skirtDriftPx` is kept as an alias so older reports still resolve. The `skirt` overlay flags red on surface drift, not on skirt depth. |

## Acceptance

1. ✅ **No `normaliseSkirt` / height-forcing anywhere in the pipeline; tiles
   keep native size.** Asserted, not just done: `iso-manifest.test.ts` →
   *"declares NO canonical block height (skirt normalisation is gone)"* greps
   the packer for `normaliseSkirt` and the cells file for `blockH`.
2. ✅ **Flat terrain is coplanar.** `iso-debug.test.ts` walks all 32×32 tiles
   and asserts `surfaceDriftPx === 0` on every one — *and*, in the same loop,
   asserts the set of skirt depths has **more than one** member. That second
   assertion is the guard against a silent return to normalisation: the map is
   coplanar **because** of the anchor, while genuinely mixing tile heights
   (grass 66px, water 50px).
3. ✅ **Single AND stacked buildings sit flush, base not clipped.**
   `dumpBuilding().gapPx === 0` for the industries (`iso-debug.test.ts`), and
   `factory_blue` / `depot_blue` are composites whose anchor is their base
   layer's ground row (`iso-atlas-pixels.test.ts`). `docs/kenney-k0-flush.png`
   shows the five-storey factory standing on its tile.
4. ✅ **Manifest invariant:** every sprite's anchor is its measured ground
   point, and a stacked composite's anchor equals its base layer's — the
   existing `iso-manifest.test.ts` anchor test recomputes anchors from the
   source pixels and demands the manifest match.
5. ✅ Reference renders regenerated: `docs/kenney-k0-flush.png`,
   `kenney-k2-roads.png`, `kenney-k3-scene.png`, `kenney-k5-vehicles.png`,
   plus `assets/iso-atlas/contact-sheet.png` and `footprint-check.png`.
6. ✅ **390 unit tests pass** (387 before); `npm run typecheck` clean;
   `npm run lint` 0 errors, no new warnings; `node tools/make-derived-art.mjs
   --check` in sync; `node tools/validate-manifest.mjs` valid.

## Verified the tests actually bite

Two separate reversions, each caught:

- Anchoring on the **widest row** again (the pre-K-FIX-1 rule) fails **4**
  tests.
- Restoring PR #24's **skirt normalisation** (crop every ground/standing sprite
  to a 50px skirt) fails **2** tests — including the coplanarity sweep, via
  the "skirts should differ" guard.

Restoring the shipped code makes both green again, so the suite pins the
behaviour rather than describing it.

## Not covered

The sandbox has no browser (`npx playwright install chromium` cannot fetch),
so `npm run test:e2e` was not run — same limitation recorded on W8/W9/G9. The
acceptance renders are composited with the exact draw math of
`src/iso/depth.ts` (`drawOrigin`) and `src/iso/renderer.ts`, so they show what
the game draws, but a real-browser pass is still worth doing before closing
this on a play-test report.
