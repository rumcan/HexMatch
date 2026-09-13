# Optimization Preview — applied changes (2026-09-13)

## 1. Pixel-matching / smoothing (already correct, confirmed)
`src/iso/renderer.ts` constructor:
- `ctxT` (terrain): `imageSmoothingEnabled = true`  → smooth downscaled pattern fills
- `ctxS` (structures): `false` → crisp 1:1 pixel art
- `ctxO` (overlay): `false` → crisp overlays

## 2. Performance targets
- `TERRAIN_FRAME_MS = 1000 / 30` (~33.3 ms) = 30 Hz cap for ambient terrain animation
- Chunk cache (`groundChunkCache`) optimized with faster `chunkKey()` method (no per-iteration string allocations)
- Fast fallback path in `drawTerrain`: when no textures loaded, skips `pattern.setTransform()` and fills flat `FALLBACK.water`

## 3. Atlas / resizing paths
- `atlasZoomFor(z)` in `src/iso/atlas.ts`: HIGH cap=2 → 1:1; MEDIUM/LOW → sample capped sheet and scale destination rect (nearest-neighbour, smoothing off on sprite contexts)
- Ground tiers exist: `assets/ground/low/` (128px) and `assets/ground/medium/` (256px) — loaded via `detailTierFor()` in `ground-art.ts`
- Per-building PNG layers: `assets/buildings/` (e.g., `factory@0.5x.png`, `@1x.png`, `@2x.png`) — installed via `loadBuildingLayers()`

## 4. More optimized ocean / terrain (implemented)
### `src/iso/ground.ts` — `oceanMatrix()`
- Pre-computes `sz = z * texScale` so per-frame only does 2 modulo ops + translate + scaleSelf with the pre-computed `sz`

### `src/iso/renderer.ts` — `drawTerrain()`
- Uses faster `chunkKey(z, cx, cy)` instead of inline string interpolation for every visible chunk per redraw
- Added explicit fast-fallback branch: when `this.ground` is null, fill with `FALLBACK.water` directly (no `pattern.setTransform()` overhead)
- Added 30 Hz cap documentation inline (`TERRAIN_FRAME_MS` comment)

### `src/iso/renderer.ts` — `groundFillChunk()`
- Uses `this.chunkKey(z, cx, cy)` instead of `` `${z}:${...}` `` inline allocation

No files deleted or renamed; no art removed; no new branches. All changes on `arena/01a09b4a-hexmatch`.
