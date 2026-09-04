# HexMatch — Kenney art migration (K-series)

A deliberate art-direction change for the game jam: replace the OpenGFX pixel-art tiles with Kenney's CC0 isometric 3D-rendered assets (`src/iso/kenny/{buildings,landscape,vehicles}`, confirmed present in the repo).

**This is bigger than any sprite ticket so far — the tile geometry itself changes.** This doc gives the exact measured numbers so nothing is left to "figure out." Values derived from the actual assets are marked ✓measured; the few that need a human eye are marked ⚠human — those are the only judgment calls.

Keep this **entirely separate from the TK gameplay tickets and the W-series bug fixes.** Order across tracks: fix W-series bugs → **this migration** → TK gameplay. Do not interleave; that is what timed out before. One ticket per session, stop at each acceptance block.

---

## The measured geometry (use these exact numbers)

I measured every ground tile in `src/iso/kenny/landscape/PNG`. They are consistent:

```
Canvas per ground tile:    132 x 83 px            ✓measured
Diamond top surface:       132 wide x 64 tall     (apex at y=0, widest row at y=32)   ✓measured
  -> TILE_W = 132, TILE_H = 64   (was 64 x 31)
Base block (skirt) height: 50 px below the diamond's widest row   ✓measured
  -> every tile draws a 50px cube-side below its diamond top
```

Projection (same form, new constants):
```ts
export const TILE_W = 132, TILE_H = 64;
export const HW = 66, HH = 32;          // half-width, half-height of the diamond
export const BLOCK_H = 50;              // base-block skirt height

export const tileToScreen = (tx, ty) => [(tx - ty) * HW, (tx + ty) * HH];
export const screenToTile = (sx, sy) => {   // still Math.floor, not round
  const a = sx / HW, b = sy / HH;
  return [Math.floor((a + b) / 2), Math.floor((b - a) / 2)];
};
```

**The anchor is now a formula, not a per-sprite guess.** Every Kenney ground tile is 132x83 with the diamond apex at top-centre. Draw a ground tile so its diamond top lands on the tile's screen position:

```
drawX = screenX(tx,ty) - HW      // left edge of the 132px canvas
drawY = screenY(tx,ty) - HH      // apex sits HH above the tile centre-line
```

Buildings share the same footprint but are taller canvases (e.g. `buildingTiles_036.png` is 133x127). They use the **bottom-centre** anchor: align the sprite's bottom-centre to the ground tile's bottom-centre and it stands on the tile, height rising up-screen. General rule for any sprite: `drawX = screenX - floor(spriteW/2)`, `drawY = screenY + HH - spriteH`. Compute once, reuse — no hand anchors anywhere.

⚠human: a few landscape tiles (e.g. `landscapeTiles_050`) have a **taller** diamond — those are slope/ramp tiles. **Do not use them.** Stay flat-topped. Filter by rejecting any tile whose widest opaque row is not at y≈32.

---

## K0. Record constants; prove one tile + one building render correctly
`[design] [blocker]`

Everything downstream depends on this. Write the constants above into `config.ts`. Map size: Kenney tiles are ~2x the OpenGFX pixels, so keep the tile count **lower** — recommend **32x32** (was 48x48) so the map is not enormous; confirm draw count is fine.

Stay flat-topped. Kenney has slopes/ramps; using them reopens every slope-sorting problem. Flat only.

**Acceptance:** constants in `config.ts`; one flat grass tile and one building rendered at 132px via the bottom-centre anchor formula, sitting flush (building standing on the tile, not floating or sunk); committed reference screenshot; no hand-authored anchor anywhere.

---

## K1. New atlas pipeline — one PNG per sprite, retire the pnml/blue-key path
`[tooling] [assets]`

Kenney assets are individual RGBA PNGs. The entire OpenGFX pipeline is obsolete: no sheet-slicing, no blue-key, no `.pnml` parsing, no generated masks.

- New `iso-atlas.cells.json` maps each game concept -> a **Kenney PNG path** (not a sprite id, crop box, or compose block). Example: `{ "name": "terrain_grass", "png": "landscape/PNG/landscapeTiles_003.png" }`.
- The slicer becomes a **packer**: load the listed PNGs, pack into one atlas or reference directly (with ~130 tiles, direct load is simpler — measure before over-engineering). Emit a manifest with each sprite's real `w`/`h` and the **computed** anchor from the formula above.
- No `compose`, `box`, `crop`, `sprite`-id, `layers`, or `generator` fields. If any survive, the cell was not migrated.
- Retire `parse-pnml.mjs`, the `.pnml` tree, `opengfx-sprites.json`, and the generator/blue-key slicer code — but **only in K6**, after K2–K4 confirm coverage. Prune last (the R9 lesson).

**Acceptance:** atlas builds from Kenney PNGs; manifest carries real sizes and formula-computed anchors; contact sheet renders every mapped sprite flush; a test asserts no cell contains `compose`/`box`/`crop`/`generator`.

---

## K2. Map terrain and roads to Kenney landscape tiles
`[assets]`

The landscape set has **128 tiles** ✓measured (grass, water, shore, rough, trees, and a full road set). I auto-detected **42 road-surface tiles** — more than enough for all 16 masks plus curves and junctions.

**Terrain (straightforward):** grass, water, rough — pick the flat-topped variants (reject slopes per the ⚠human note).

**Roads — the one place to be careful, because this is the bug that keeps recurring.** Kenney roads are **pre-shaded finished 3D pieces**, so map each of the 16 direction masks to a specific PNG. Nothing to generate, nothing to rotate — the piece is drawn as-is.

⚠human: **the mask->PNG mapping needs a person to eyeball the pieces once.** The 42 candidates include straights (in both diagonal orientations), curves, T-junctions, crossroads, dead-ends. Lay them out and assign:
- `road_0000` (isolated) -> a dead-end/stub
- `road_0101` / `road_1010` (the two straights) -> the two straight PNGs. **This is where the 90-degree bug lived:** the NE-SW straight and the NW-SE straight are *different Kenney tiles*, so pick the one whose asphalt visually runs the right way for each mask. Verify with an in-game L-bend.
- the four corner masks -> the four curve PNGs
- the four T-masks -> the T-junction PNGs
- `road_1111` -> the crossroads PNG

Write it as an explicit 16-entry table in `cells.json`. Fill gaps with a tile you draw.

**Acceptance:** all 16 masks map to a named Kenney PNG; a straight road placed in each diagonal runs the right way (eyeball an L-bend); no generation/rotation path remains; missing pieces listed.

---

## K3. Map industries, factory and depot to Kenney buildings
`[assets]`

132 building tiles ✓measured — houses, shops, offices, industrial, varying heights. Each is **one coherent finished building**, which permanently ends the compose/fragment/too-small saga (V1/V2/W7 cannot recur — nothing to assemble).

- Assign one distinct building per concept: factory (largest/most industrial), farm, forest, ore mine, quarry, oil rig, gold mine, plus player depot/terminal and the main factory in four colours.
- **Match building height to footprint from the start** (K0 sets footprints). Big multi-storey for a 2x2; small single for 1x1. Because the anchor is bottom-centre and computed, a correctly-sized building sits in its footprint by construction — the V1 "too small" problem was an OpenGFX-era artifact of wrong footprints; set them to match the chosen Kenney art here.
- **Player tinting:** Kenney buildings are flat solid colours, so a hue-shift or coloured multiply overlay should read cleanly. Test on the real art; if hue-shift muddies it, use a small coloured roof/flag marker per player instead.

⚠human: which building reads as "factory" vs "farm" is an aesthetic pick from the buildings contact sheet.

**Acceptance:** every industry, the factory (four tints), and the depot map to a coherent building sized to its footprint; each stands correctly on the map — no overhang, float, or fragment.

---

## K4. Renderer updates for the taller, blocky tiles
`[renderer]`

The 50px base block means the renderer changes beyond swapping images. These are the subtle bits — give this ticket room.

- **Draw origin:** apply the K0 anchor formula. The diamond top is offset up-screen; the base block fills the 50px below. A tile now paints 132x83, not 64x31.
- **Depth sort — re-baseline.** Taller tiles and standing buildings overlap more of the tiles behind them than flat diamonds did. Max-corner + topological sort is still right, but its fixtures assumed flat 64x31 — re-baseline the reference renders against Kenney geometry. Watch a tall building behind a short one on the next row.
- **Picking — re-check.** The flat-then-sprite pick assumed a flat diamond. With a 50px block the clickable **top surface** is 50px above where the flat-diamond inverse lands. Adjust the flat pick to hit the diamond top; keep the sprite-alpha second pass for tall buildings. Test: click a roof -> selects that tile; click the block-side -> still that tile.
- **Chunk cache:** cell size scales to 132px tiles; an 8x8 chunk is now ~1056px wide. Confirm memory or drop to smaller chunks.

**Acceptance:** tiles and buildings sort correctly as the camera moves; clicking selects the tile whose top is under the cursor; no z-fighting at chunk seams; depth and pick tests re-baselined and green.

---

## K5. Vehicles (art only; movement is TK-004)
`[assets]`

553 vehicle PNGs ✓measured across Ambulance/Civilian/Garbage/Police/Taxi, each with **directional sprites** — `_N _NE _E _SE _SW _W _NW` plus `D` variants. The directional set is complete, so a moving vehicle just picks the frame matching its heading — no rotation maths, exactly what TK-004 needs.

For this ticket: get the chosen vehicle (a bus/truck for cargo per TK-003/007) into the atlas with directional frames indexed by compass heading, and confirm the headings cover the road directions the track uses. Movement is TK-004.

**Acceptance:** chosen vehicle sprites in the atlas, frames indexed by heading; a static vehicle places on a road tile facing correctly; every road direction used has a matching frame.

---

## K6. Prune OpenGFX and the old pipeline
`[chore]`

Only after K2–K4 confirm coverage: delete `src/assets/sprites/` (OpenGFX PNGs + `.pnml`), `parse-pnml.mjs`, the slicer's blue-key/generator code, and `opengfx-sprites.json`. Update credits: OpenGFX (GPLv2) gone; Kenney is **CC0** — no obligations, credit optional. Drops the GPL entanglement, worth having clean for a jam entry.

**Acceptance:** no OpenGFX asset or code remains in the active path; README credits Kenney (CC0); atlas still builds; bundle shrinks.

---

## Sequencing

**K0 -> K1 -> K2 -> K3 -> K4 -> K5 -> K6.**

K0 first and alone (constants gate everything). K1 before any mapping. K2/K3 are the bulk, checkable by eye. K4 is riskiest — taller tiles touch depth-sort and picking, historically the two subtlest things here — so its own session, lean on re-baselined tests. K5 sets up TK-004. K6 strictly last.

The only real judgment calls are the ⚠human ones: which building looks like a factory, and the 16-entry road mask->PNG table. Everything else is the measured numbers above — hand them over as-is.