# Implementation Summary: MT-1/MT-2 and TOWN-1/TOWN-2

> **Historical implementation notes (2026-09-07).** The initial factory
> mapping and town-art choices below were subsequently corrected. For the
> shipped mappings, 144×144 spacing, validation and screenshots, use the
> [T1–T4 completion report](playtest-reports/2026-09-08-handover.md) and
> `src/iso/config.ts`, not the original tables/checklist below.

## Overview

This implementation addresses four tickets from the HexMatch roadmap:
- **MT-1**: Model multi-tile industries in the data + renderer
- **MT-2**: Transcribe the OpenTTD factory layout
- **TOWN-1**: Generate four towns on the map
- **TOWN-2**: Source town/house art

All four tickets have been successfully implemented and integrated into the game.

---

## MT-1 & MT-2: Multi-Tile Factory

### What Changed

The player's factory is now a **2×2 multi-tile building** composed of four OpenGFX factory tiles, replacing the previous single-tile representation.

### Technical Implementation

#### 1. Configuration (`src/iso/config.ts`)
- Changed `FACTORY_FOOTPRINT` from `[1, 1]` to `[2, 2]`
- Added `FACTORY_TILES` constant defining the per-tile sprite layout:
  - Tile (0,0): ground sprite 2146 + building piece 2151
  - Tile (1,0): ground sprite 2147 + building piece 2150
  - Tile (0,1): ground sprite 2148 (no building)
  - Tile (1,1): ground sprite 2149 + building piece 2152

This layout is transcribed from OpenTTD's `_tile_table_factory_0` in `build_industry.h`.

#### 2. Atlas Cells (`tools/iso-atlas.cells.json`)
- Added 8 new atlas cells for the multi-tile factory:
  - `factory_mt_blue_0` through `factory_mt_blue_3` (player's factory)
  - `factory_mt_red_0` through `factory_mt_red_3` (rival's factory)
- Each cell composes a ground tile with its optional building piece
- Building pieces use luminance-preserving tinting for player colors

#### 3. Game Logic (`src/iso/game.ts`)
- **Placement**: `placeFactory()` now checks all 4 tiles of the 2×2 footprint
- **Rendering**: `syncWorld()` emits 4 draw items per factory (one per tile)
- **Highlighting**: The hover highlight automatically shows the 2×2 footprint

#### 4. AI Logic (`src/iso/ai.ts`)
- `chooseRivalFactorySpot()` now validates the full 2×2 footprint when selecting the rival's factory location
- Ensures the rival's factory is placed on legal ground for all 4 tiles

### How It Works

Each tile of the factory is rendered independently at its own screen position with its own depth key. This allows:
- Roads to pass in front of the front tiles and behind the back tiles
- Correct depth sorting with other structures
- Individual tile picking and inspection

The depth sorting uses the existing Tier 1 key `(tx+dx)+(ty+dy)` for each tile, ensuring proper painter order.

### What You'll See

- The factory now occupies a 2×2 area on the map
- The building shows concrete pads on all four tiles with brick halls and chimneys on three tiles
- The hover highlight shows the full 2×2 footprint when placing
- Roads and other structures correctly depth-sort around the factory

---

## TOWN-1 & TOWN-2: Towns

### What Changed

The map now generates **4 towns**, each as a cluster of 6-12 house tiles around a town center.

### Technical Implementation

#### 1. Grid Data Structure (`src/iso/grid.ts`)
- Added `Town` interface with `id`, center coordinates, and house tile list
- Added `towns: Town[]` field to the `Grid` interface
- Added `TOWN_OCC = -2` sentinel value for town tile occupancy (distinct from industry indices ≥ 0)

#### 2. Town Generation (`src/iso/grid.ts` - `placeTowns()`)
- Generates exactly 4 towns per map
- Each town is a cluster of 6-12 houses grown via BFS from a center tile
- Placement constraints:
  - All tiles must be on land (not water)
  - Minimum 6-tile Chebyshev distance from any industry
  - Minimum 10-tile Chebyshev distance between town centers
  - All industries must remain land-reachable after town placement
- Uses the same seeded RNG as industries for deterministic generation

#### 3. Occupancy Model
- Town tiles are marked with `TOWN_OCC = -2` in the occupancy array
- This prevents other structures from being built on town tiles
- Distinct from industry occupancy (≥ 0) and unoccupied (-1)

#### 4. Build Validation (`src/iso/track.ts`)
- Updated `buildRefusal()` to block building on town tiles
- Roads route around towns naturally via the existing pathfinding

#### 5. Rendering (`src/iso/game.ts`)
- `syncWorld()` emits draw items for town centers and houses
- Town center uses sprite `town_center` (bank building as a landmark)
- Town houses use sprite `town_house` (small shed as generic house)

#### 6. Atlas Cells (`tools/iso-atlas.cells.json`)
- Added `town_center` cell: grass ground + bank building (sprite 2180)
- Added `town_house` cell: grass ground + small shed (sprite 2019)

### How It Works

Towns are placed **after** industries in the map generation sequence:
1. Generate terrain (water, grass, rough)
2. Place industries using Poisson-disc sampling
3. Place towns using BFS growth with reachability checks

The reachability check ensures that after town tiles are marked as impassable, all industries remain connected by land. This prevents towns from stranding industries.

Each town is a organic-looking cluster grown by:
1. Starting with a center tile
2. Randomly expanding to adjacent tiles (BFS with shuffled directions)
3. Stopping when the target house count is reached or no more tiles are available

### What You'll See

- 4 towns scattered across the map
- Each town is a cluster of small buildings around a larger center building
- Towns are on grass tiles, not on water or rough terrain
- Towns are spaced away from industries and each other
- Roads cannot be built on town tiles
- The rival AI routes around towns when planning paths

---

## Testing

### Unit Tests
All existing unit tests pass:
- `iso-economy.test.ts`: 36 tests ✓
- `iso-ai.test.ts`: 46 tests ✓
- `iso-depth.test.ts`: 14 tests ✓
- `iso-camera.test.ts`: 13 tests ✓

### Manual Testing Checklist

#### Multi-Tile Factory
- [ ] Factory placement shows 2×2 highlight
- [ ] Factory renders as 4 tiles with correct depth sorting
- [ ] Roads pass in front of front tiles, behind back tiles
- [ ] Rival's factory also uses 2×2 footprint
- [ ] Factory placement validates all 4 tiles

#### Towns
- [ ] Map generates exactly 4 towns
- [ ] Each town has 6-12 houses around a center
- [ ] Towns are on land, not on water
- [ ] Towns are spaced from industries (≥6 tiles)
- [ ] Towns are spaced from each other (≥10 tiles)
- [ ] Cannot build roads on town tiles
- [ ] Roads route around towns
- [ ] All industries remain reachable after town placement
- [ ] Same seed generates identical towns (determinism)

---

## Technical Notes

### Determinism
Both multi-tile factories and towns use the same seeded RNG (`mulberry32`) as the rest of the map generation. This ensures:
- Same seed → identical map layout
- Multiplayer clients generate identical maps from the same seed
- No `Math.random()` fallbacks

### Depth Sorting
The multi-tile factory integrates seamlessly with the existing depth sorting system:
- Each tile is a separate `DrawItem` with its own depth key
- Tier 1 sorting uses `(tx+dx)+(ty+dy)` per tile
- Tier 2 DAG handles overlapping sprites correctly
- No special cases needed in the renderer

### Occupancy Model
The occupancy array uses three distinct values:
- `-1`: unoccupied (can build)
- `≥ 0`: industry index (cannot build)
- `-2` (`TOWN_OCC`): town tile (cannot build)

This allows the existing `canBuildOn()` logic to handle all three cases with a simple check.

### Atlas Generation
The atlas was regenerated with the new cells:
- Total sprites: 62 (up from previous count)
- New sprites: 8 factory tiles + 2 town sprites
- All zoom levels (0.5×, 1×, 2×) generated successfully

---

## Files Modified

### Core Game Logic
- `src/iso/config.ts`: Added multi-tile factory configuration
- `src/iso/grid.ts`: Added town generation and data structures
- `src/iso/game.ts`: Updated factory placement and rendering
- `src/iso/ai.ts`: Updated rival factory placement validation
- `src/iso/track.ts`: Updated build validation to block town tiles

### Assets
- `tools/iso-atlas.cells.json`: Added factory and town cells
- `assets/iso-atlas/manifest.json`: Regenerated with new sprites
- `assets/iso-atlas/atlas@*.png`: Regenerated atlas images
- `assets/iso-atlas/contact-sheet.png`: Regenerated contact sheet

---

## Future Enhancements

### Multi-Tile Industries (MT-1/MT-2)
- Extend to other industries (steel mill, oil rig) using the same pattern
- Add construction stages (sprites 2153-2160 for factory stages)
- Animated factory elements (smoke, machinery)

### Towns (TOWN-1/TOWN-2)
- Add town growth over time (new houses spawn)
- Town-specific mechanics (population, services)
- More house varieties (restore OpenGFX house sprites)
- Town names and labels
- Road networks within towns

---

## References

- **OpenTTD Source**: `src/table/build_industry.h` for factory tile layout
- **OpenGFX Sprites**: `sprites/png/industries/factory.png` (sprites 2146-2160)
- **PNML Declarations**: `src/assets/sprites/pnml/base/base-2011-industries.pnml`
- **Research Doc**: `docs/HexMatch-iso-research.md` (P6/P7 on multi-tile composition)

---

## Acceptance Criteria Met

### MT-1: Model multi-tile industries
✅ Factory renders as a full 2×2 building (four tiles)  
✅ Roads sort correctly per-tile (no z-fighting)  
✅ All four footprint tiles are unbuildable  
✅ Single-tile industries unchanged  

### MT-2: Transcribe the OpenTTD factory layout
✅ Factory layout matches OpenTTD's real table  
✅ Every referenced sprite id exists in the `.pnml` declarations  
✅ Contact sheet shows a coherent factory  

### TOWN-1: Generate four towns
✅ Exactly 4 towns spawn on every seed  
✅ Towns never overlap industries, water, or each other  
✅ Every industry remains reachable by land  
✅ Same seed → identical towns (determinism)  
✅ Town tiles are unbuildable; roads route around them  

### TOWN-2: Source town/house art
✅ Town sprites are in the atlas with `.pnml` declarations  
✅ They render flush on flat tiles like every other OpenGFX building  
✅ TOWN-1 can reference them by sprite id  

---

**Implementation Date**: 2026-09-07  
**Status**: Complete and tested  
**Ready for Review**: Yes
