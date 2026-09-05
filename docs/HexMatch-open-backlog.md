# HexMatch — multi-storey stacked buildings (MB-series)

A feature ticket, plus two Art Lab fixes that already shipped in `art-lab.html`.

---

## Already done in the Art Lab (this session)

- **Red/blank tiles removed.** The candidate grid generated indices 0–129, but landscape only has 0–127 and buildings 0–128. The two missing indices fell through to the red error-fill. Counts corrected.
- **Rail tab added.** Rail art isn't in the landscape/buildings folders — it's 16 script-generated pieces in `src/iso/kenny/derived/rail_*.png` (plus `crossing.png`). There was no way to see or reassign them. Added a **"Rail (derived)"** tab, and clicking any rail slot now auto-switches to it. Note: these are the *finished* rail pieces, so "choosing" here means swapping in different derived art, not picking from a Kenney set — Kenney ships no rail tiles.

---

## MB1. Stacked multi-storey buildings
`[feature] [assets] [renderer]`

> **Status — renderer core DONE.** The data model + packer + renderer side of MB1
> shipped on branch `arena/01a07021-hexmatch` (PR): a `standing` cell now takes
> either `png` (single piece) **or** an ordered `stack` of layer `{ png }`
> descriptors; the packer resolves each distinct (png, tint) layer once into a
> shared packed sprite and emits a **composite** manifest entry whose `parts`
> draw bottom→top (base → floors → roof). Depth-sort and picking treat the whole
> stack as ONE object on its footprint; player tint covers every layer (baked at
> pack time); single-`png` cells are unchanged. `factory_*` are wired as 5-layer
> towers (4× 044 + 057 roof), `depot_*` as 2-storey 3-layer stacks (fixing the
> old roof-only 089 depot). The **Art Lab stack editor UI is still a follow-up
> pass** (per the sequencing note below) — the storey mixes above are an initial
> composition to fine-tune there once the tool can compose/export live.

**What we want:** buildings 3–6 storeys tall, built by stacking Kenney's modular floor pieces (base → middle floors → roof), instead of the current single squat floor.

**Confirmed feasible.** Kenney's building set is modular by design:
- **Base/ground pieces** — the taller tiles (~127px canvas) with the brown foundation block. Used once, at the bottom.
- **Middle floor pieces** — the ~85px window-storey tiles (no foundation). Repeatable; this is what makes a building tall.
- **Roof/cap pieces** — the flat ~54–63px tiles (e.g. 057, 005). Used once, on top.

I verified stacking empirically: **each stacked floor is offset upward by 36px** (at 1× / 132-wide tiles). A base + 3 window floors + a roof composites into a clean 5-storey tower with no gaps or overlaps. The offset is `STOREY = 36` in screen pixels, scaling with zoom.

### Data model change

The cells file currently gives each building one `png`. Multi-storey needs an ordered **layer stack**:

```json
{
  "name": "factory_blue",
  "kind": "standing",
  "footprint": [1,1],
  "stack": [
    { "png": "buildings/PNG/buildingTiles_044.png" },   // base (bottom)
    { "png": "buildings/PNG/buildingTiles_044.png" },   // floor
    { "png": "buildings/PNG/buildingTiles_044.png" },   // floor
    { "png": "buildings/PNG/buildingTiles_057.png" }    // roof (top)
  ]
}
```

Keep `png` (single) working for non-stacked sprites (terrain, roads, industries that stay one-piece), so this is additive: a cell has *either* `png` *or* `stack`.

### Renderer change (`src/iso/renderer.ts`)

When drawing a `standing` sprite that has a `stack`, composite bottom-to-top: draw layer 0 at the tile anchor, then each subsequent layer at `y -= STOREY * zoom`. The stack's overall bounding box (for depth sort and picking) is the base's footprint at ground level with the accumulated height — depth-sort by the base tile, same as any building; picking hits the whole stacked column.

- `STOREY = 36` at 1×; multiply by the render scale.
- The atlas packer must include every layer PNG referenced by any stack.
- Player tint (factory/depot) applies to every layer in the stack.

### Art Lab change (stacking UI)

The Art Lab needs a stack editor for building slots: pick a base, add/remove middle floors (1–4), pick a roof, with a **live assembled preview** showing the tower. Export writes the `stack` array. This is a meaningful tool addition — probably its own pass after the renderer supports stacks, so the tool has something real to target.

### Acceptance

- A building slot can be assigned a stack of 2–6 layers; it renders as a single tall building on the map, floors flush, roof on top.
- Depth sort and picking treat the stack as one object on its footprint tile.
- Player tint covers all layers.
- Single-`png` cells still render unchanged.
- The Art Lab can compose and export a stack, and the exported cells.json drives the renderer correctly.

### Sequencing

Renderer support first (so a hand-written `stack` in cells.json renders), then the Art Lab stacking UI. Don't build the tool before the format renders — same lesson as before, the tool should target something real.

**Suggested storey mix per building:** factory 4–5 storeys, depot 2, residential/town buildings 3–6 for variety. The exact floors are an Art Lab aesthetic choice once the system works.

---

## Current cells.json (baseline — the single-piece config to extend)

This is the working Kenney mapping as of the K-series completion. Multi-storey (MB1) extends the `standing` building cells with a `stack` array; everything else stays as-is. Every building below is currently ONE `png`; the stack version replaces `png` with an ordered `stack` for the buildings you want tall.

Buildings currently mapped (all verified present):

| Slot | Tile | Size | Note |
|---|---|---|---|
| farm | buildingTiles_100 | 133×127 | red barn — full building |
| forest | buildingTiles_113 | 132×127 | tree stand |
| ore_mine | buildingTiles_117 | 132×127 | blue works shed |
| quarry | buildingTiles_108 | 132×127 | grey stone shed |
| oil_rig | buildingTiles_109 | 132×127 | brown industrial block |
| gold_mine | buildingTiles_101 | 132×127 | yellow hut |
| factory_blue | buildingTiles_002 | 132×127 | main factory, tinted |
| factory_red/purple/green | buildingTiles_085 | 133×127 | tinted variants |
| depot_blue | buildingTiles_034 | 132×127 | grey shed, tinted |
| depot_red/purple/green | buildingTiles_089 | **99×60** | ⚠ roof-only piece — renders as a flat cap, not a full depot. Fix when stacking: give depot a proper base+roof stack, or repoint to a full building tile. |

**When adding stacks:** the factory and the town/residential buildings are the ones that benefit from height. The industries (farm, mine, rig) already read fine as single 127px pieces — stacking them is optional. Prioritise `factory_*` (4–5 storeys) and any town buildings; leave industries single unless they look too short next to stacked neighbours.

The full baseline JSON is committed at `tools/iso-atlas.cells.json`; MB1 edits only the `standing` building entries.