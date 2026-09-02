# HexMatch — Isometric implementation spec (E-series, detailed)

Replaces the E-series summaries in `HexMatch-backlog.md`. The K- and T-tickets there are unchanged. This document is deliberately prescriptive: every ticket states the formula, the data layout, or the lookup table to implement, plus how to prove it works.

---

## The gameplay loop this has to serve

Unchanged from the hex version in shape, changed in mechanism:

1. Place **one main Factory** (your HQ, the delivery destination).
2. Place **one harvesting building** on an industry.
3. You start with a small budget of **road** connecting the two.
4. Connected industries feed the **match-3 quarry** — matching gems harvests from whatever your network reaches.
5. **Trade** surplus cargo for cargo you don't produce.
6. Spend cargo to **build road or rail out to a new industry**, place another harvester, repeat.

The new axis: **road is cheap and scores few points, rail is expensive and scores many.** That's the whole risk/reward curve, so it has to be legible in the UI at the moment of building, not buried in a stats screen.

---

## E0. Projection, grid and sprite constants
`[design] [blocker]` — nothing else starts until this is merged.

### Projection

Use **2:1 dimetric**. <cite index="28-1">A true isometric projection at 30° is virtually impossible to draw cleanly on an LCD without severe aliasing, which is why the industry universally adopted the 2:1 pixel ratio — a tile exactly twice as wide as tall — because it allows clean stair-stepping pixel art.</cite>

Grid → screen, the standard form <cite index="29-1">(`screen.x = (map.x - map.y) * TILE_WIDTH_HALF; screen.y = (map.x + map.y) * TILE_HEIGHT_HALF`)</cite>:

```ts
export const TILE_W = 64, TILE_H = 32;
export const HW = TILE_W / 2, HH = TILE_H / 2;   // 32, 16

export const tileToScreen = (tx: number, ty: number): [number, number] =>
  [(tx - ty) * HW, (tx + ty) * HH];
```

Screen → grid is the algebraic inverse <cite index="29-1">(`map.x = (screen.x / TILE_WIDTH_HALF + screen.y / TILE_HEIGHT_HALF) / 2`, `map.y = (screen.y / TILE_HEIGHT_HALF - screen.x / TILE_WIDTH_HALF) / 2`)</cite>:

```ts
export const screenToTile = (sx: number, sy: number): [number, number] => {
  const a = sx / HW, b = sy / HH;
  return [Math.floor((a + b) / 2), Math.floor((b - a) / 2)];
};
```

**Note the `Math.floor`, not `Math.round`.** Rounding gives you the nearest tile *centre*, which is wrong at diamond edges and produces an off-by-one band along every tile boundary. Flooring gives the tile whose diamond contains the point. This is the single most common isometric picking bug — write the test first (E4).

### Constants to fix now

| Constant | Value | Note |
|---|---|---|
| `TILE_W` × `TILE_H` | 64 × 32 | verify against the source art before slicing |
| `MAP_W` × `MAP_H` | 48 × 48 | 2304 tiles; budget checked in E4 |
| Terrain height | **flat** | see below |
| Zoom range | 0.5× – 2.0× | integer steps only: 0.5, 1, 2 |

**Flat terrain for v1, non-negotiable.** Stepped iso multiplies the tile-variant count by the corner-height combinations, and it breaks depth sorting outright — <cite index="2-1">the standard back-to-front, bottom-up per-level algorithm cuts off any object taller than one unit with objects at the higher level, and the workarounds ("draw the level above until everything behind the tall object is drawn, then return to the unfinished lower level") introduce their own problems, because it isn't clear which objects are "behind" a tall object transitioning between tiles</cite>. Ship flat. Revisit only if the game is otherwise finished.

### Zoom must be integer-stepped

<cite index="40-1">Scaling images inside `drawImage` is a documented canvas performance mistake; cache several sizes on an offscreen canvas at load time instead of constantly scaling in the draw call.</cite> With three fixed zoom levels you pre-render the atlas at 0.5×, 1× and 2× once, and every frame is a 1:1 blit. Free zoom would force per-frame scaling of every sprite.

**Acceptance:** constants in `config.ts`; `tileToScreen`/`screenToTile` exported with unit tests asserting round-trip identity for all 2304 tiles and correct results at the four diamond corners of at least 20 sampled tiles.

---

## E1. Atlas manifest + slicer
`[tooling] [assets]` — depends on E0.

### Manifest schema

```json
{
  "image": "industries@1x.png",
  "tileW": 64, "tileH": 32,
  "sprites": {
    "coal_mine":  { "x": 0,   "y": 0, "w": 192, "h": 160, "footprint": [3,3], "anchor": [96,148], "frames": 1 },
    "oil_rig":    { "x": 192, "y": 0, "w": 128, "h": 176, "footprint": [2,2], "anchor": [64,160], "frames": 4, "frameMs": 180 },
    "road_0011":  { "x": 0, "y": 256, "w": 64, "h": 32, "footprint": [1,1], "anchor": [32,32], "frames": 1 }
  }
}
```

**`anchor` is the contract that makes everything else work.** It is the pixel inside the sprite that lands exactly on the screen position of the footprint's **south corner** — the bottom vertex of the diamond of the tile at `(originX + w - 1, originY + h - 1)`. Draw position is then:

```ts
const [sx, sy] = tileToScreen(o.tx + s.footprint[0] - 1, o.ty + s.footprint[1] - 1);
ctx.drawImage(atlas, s.x, s.y, s.w, s.h,
  Math.floor(sx + HW - s.anchor[0] + camX),   // integer — see below
  Math.floor(sy + TILE_H - s.anchor[1] + camY),
  s.w, s.h);
```

<cite index="40-1">Always round coordinates with `Math.floor` before `drawImage`; sub-pixel positions force the browser into extra anti-aliasing work.</cite> With pixel art it also visibly blurs the sprite.

### Slicer (`tools/slice-atlas.mjs`, Node + sharp)

- Input: source sheets plus a hand-written cell map.
- Output: `@1x`, `@2x` (nearest-neighbour upscale) and `@0.5x` PNGs plus one shared manifest.
- **Required: a debug contact sheet.** Every sprite drawn on a tile-grid background with its anchor pixel marked in magenta and its footprint diamond outlined. Anchor errors are then one glance away instead of being discovered after placing 400 buildings.

**Acceptance:** contact sheet shows every sprite flush on its footprint at all three scales; manifest validates against a JSON schema in CI.

---

## E2. Cargo, industries, and the road/rail scoring split
`[design] [config]`

### Industries

| Industry | Cargo | Footprint | Rel. output |
|---|---|---|---|
| Farm | Grain | 2×2 | 1.0 |
| Forest | Wood | 2×2 | 1.0 |
| Coal Mine | Coal | 3×3 | 0.8 |
| Iron Mine | Iron | 3×3 | 0.8 |
| Quarry | Stone | 3×3 | 0.7 |
| Oil Rig | Oil | 2×2 | 0.4 |
| Gold Mine | Gold | 2×2 | 0.3 |

**Blocking constraint:** the match-3 board hard-codes six gem frames (`GEM_FRAMES = 6`, `GEM_FRAME`, and `gems_spritesheet.png` is exactly 6 × 128px). Seven cargoes needs new gem art. **Decide in this ticket:** commission a 7th frame, or cut to six by merging Iron and Coal into "Ore". Do not let this drift — `board.ts` will silently mis-index.

### Road vs rail

This is the core new mechanic. Both connect industries; they differ on cost, throughput and score.

| | Road | Rail |
|---|---|---|
| Cost per tile | 1 Stone | 2 Iron + 1 Stone |
| VP per completed connection | 1 | 3 |
| Throughput multiplier | 1.0× | 1.6× |
| Buildable on rough terrain | yes | no (needs flat) |
| Can cross the other type | level crossing, free | level crossing, free |

A "completed connection" = a contiguous path of one transport type linking a harvester to your main Factory. VP is awarded **on completion, once**, and revoked if the path is broken. That means `checkConnection()` runs on every build and every demolish, not on a timer.

Rail being *strictly better per tile but worse per point of cargo* is what makes the choice interesting: early on you cannot afford Iron, so you road out to an Iron Mine, and rail becomes available as a consequence of your own expansion. Verify this ordering survives playtesting — if Iron is reachable at turn one the curve collapses.

**Open design question to settle here:** can you upgrade a road to rail in place, paying the difference? Recommend yes — it gives a use for late-game surplus and avoids demolish-rebuild busywork.

---

## E3. Grid generation
`[feature] [map]`

`src/game/grid.ts` replaces `hexmap.ts`.

- `generateMap(seed)` keeps its signature and `mulberry32` seeding. **Multiplayer depends on this** — `net.ts` ships only the seed and every client regenerates identical geometry. Requires the RNG unification from T1, since `config.ts`'s `rand`/`randInt`/`choice`/`shuffle` currently use bare `Math.random()`.
- Terrain: `Uint8Array(MAP_W * MAP_H)`, values `GRASS | WATER | ROUGH`. A flat typed array, not an array of objects — it's read every frame by the culler.
- Industries: `Industry { id, type, tx, ty, w, h, output, banditUntil }` in a separate list, plus an occupancy `Int16Array` mapping tile index → industry id or -1.
- Placement: Poisson-disc rejection sampling with a minimum separation of 6 tiles, no overlap, not on water, and a quota per industry type so no cargo is absent from the map.

**Acceptance:** same seed produces byte-identical `terrain` and `industries` across two browser contexts, asserted in the T1 suite by hashing both.

---

## E4. Renderer core: culling, sorting, picking
`[feature] [renderer] [large]`

Replaces `MapView3D.ts`. Build as canvas2d first; the design below is the one that makes a WebGL upgrade a drop-in later.

### Layering

<cite index="47-1">Use stacked canvases: draw the static background once, the static objects once, and clear and redraw only the dynamic layer inside the animation loop.</cite> Three layers:

1. **terrain** — redrawn only on camera move or zoom change
2. **structures** — industries, road, rail, stations; redrawn only when the world changes
3. **overlay** — build previews, legal-placement highlights, animated sprite frames, cursor; redrawn every frame

Layer 1 and 2 are cheap because of chunk caching (below); only layer 3 runs at 60fps.

### Chunk caching

<cite index="40-1">Pre-render repeated drawing operations to an offscreen canvas and blit the result rather than repeating the work each frame.</cite>

- Divide the map into 8×8-tile chunks. Each chunk renders its terrain once into an `OffscreenCanvas` and is blitted thereafter.
- Invalidate a chunk when any tile in it changes; invalidate all on zoom change.
- <cite index="48-1">Cache anything that doesn't change — terrain tiles, building sprites, UI backgrounds — and draw dynamic elements directly; the cached images are then just texture copies for the GPU. Main-thread rendering holds up well until roughly 1000 dynamic objects per frame.</cite> We are far under that: only animated industries and the overlay are dynamic.

### Viewport culling

Convert the four screen corners of the viewport to tile space with `screenToTile`, take the bounding box of the results, pad by the largest sprite footprint plus its height in tiles (a 3×3 mine 160px tall reaches ~5 tiles up the screen), and iterate only that range. Essential at 48×48 with tall sprites.

### Depth sorting — read this carefully

The naive key is `tx + ty`. **It is correct only for 1×1 objects of equal height.** With multi-tile footprints it produces visible errors, and the failure is not fixable by tweaking the key: <cite index="52-1">a valid depth order is a topological ordering of a directed acyclic graph of occlusions, and the algorithm fails outright on cyclic overlap, where three objects overlap such that no ordering is correct and the offending shapes must be cut.</cite>

Ship this three-tier approach:

**Tier 1 (default).** Sort by the footprint's **maximum** corner, `(tx + w - 1) + (ty + h - 1)`, tie-broken by `tx - ty` then by height. This is correct whenever no two footprints' screen bounding boxes overlap in a cycle — which, given the E3 minimum-separation-6 placement rule, is essentially always for industries.

**Tier 2 (safety net).** Build an "is behind" DAG only over sprites whose screen bounding boxes actually intersect, and topologically sort that subset. <cite index="58-1">This is a real technique with real cost — an implementation profiled at 1–5ms for 100–200 iso sprites, which is O(n²) and degrades fast, and viewport culling was noted as a large win alongside it.</cite> Because Tier 2 runs only on the culled, overlapping subset, n stays in the low tens.

**Tier 3 (escape hatch).** For any remaining cycle, split the offending multi-tile sprite into per-tile strips at slice time. Note this in the atlas manifest as an optional `slices` field so the slicer can emit it. You probably will not need this; specify it so nobody invents a hack under deadline.

**Acceptance:** a deterministic fixture map with a 3×3 mine adjacent to a 2×2 farm and a station between them renders identically to a committed reference PNG at all three zoom levels, from all four map quadrants.

### Picking

Two-stage, and the order matters:

1. **Flat pick.** `screenToTile` on the cursor. This is correct for terrain and road/rail, which are all flush to the ground.
2. **Sprite pick.** Tall sprites overlap the tiles behind them, so a click on the *upper* half of a mine sprite flat-picks the tile *behind* the mine. Walk the culled draw list **front-to-back** (reverse of draw order), test the cursor against each sprite's bounding box, and confirm with an alpha test against a cached `ImageData` alpha mask for that sprite. First hit wins.

Stage 2 overrides stage 1 whenever it hits. Build the alpha masks once at atlas load.

**Acceptance:** clicking the chimney of a mine selects the mine, not the grass behind it; clicking a 1px gap between two buildings selects the terrain; tests assert this at all three zoom levels and at a non-zero camera offset.

### Camera

Carrying over the real problems from the closed mobile tickets — an iso camera is a translate plus a discrete scale, so all of these become tractable:

- One-finger drag pans (translate `camX`/`camY` directly, no projection maths).
- Pinch zoom steps between 0.5/1/2 and must be **anchored to the pinch midpoint**: convert the midpoint to tile space before the zoom change, and after changing zoom adjust `camX`/`camY` so that tile projects back to the same screen point. Same for cursor-anchored wheel zoom.
- Lifting one finger of a pinch promotes the remaining pointer to the active pan pointer and re-seeds its last position — no snap, no dead finger.
- Size the canvas from its own client rect (or a `ResizeObserver`), listening to `visualViewport.resize` and `orientationchange`, never `window.innerWidth`.
- Clamp `camX`/`camY` so the map bounding diamond always intersects the viewport, plus a visible recentre button on mobile.

---

## E5. Road and rail: the tile model
`[feature] [gameplay] [core]`

### Data model

Each tile holds, per transport type, a **4-bit direction mask**. This is exactly OpenTTD's model — its `RoadBits` are per-tile direction bits with helpers like <cite index="32-1">`GetRoadBits`, `DiagDirToRoadBits` and `ConnectRoadToStructure`, which "connects a new structure to an existing road or tram by building the missing roadbit"</cite>.

In isometric space the four neighbours are the diamond's edge directions:

```ts
export const NE = 1, SE = 2, SW = 4, NW = 8;

// tile-space deltas
const DIR: Record<number, [number, number]> = {
  [NE]: [ 0, -1],
  [SE]: [ 1,  0],
  [SW]: [ 0,  1],
  [NW]: [-1,  0],
};
export const OPPOSITE: Record<number, number> = { [NE]: SW, [SE]: NW, [SW]: NE, [NW]: SE };
```

Two parallel `Uint8Array(MAP_W * MAP_H)` layers, `roadBits` and `railBits`. A tile with both non-zero is a level crossing and draws a third sprite.

### Autotiling

This is a **4-bit / 16-variant** problem, not a 47-tile one. <cite index="12-1">A four-neighbour bitmask gives exactly 16 possible values, 0 through 15, one per combination, each mapping to a specific tile shape</cite> — and <cite index="18-1">the simplified 4-cardinal format ignores diagonals, producing 16 combinations that are far easier to draw; the tradeoff is no inner corners</cite>, which is irrelevant for road because road has no inner corners.

Name sprites by their mask in binary so the lookup is a string build, not a 16-entry table nobody maintains: `road_${bits.toString(2).padStart(4,'0')}` → `road_0011`. Sixteen road sprites, sixteen rail, plus crossings.

<cite index="12-1">Recompute bitmasks only when the grid changes, and only for the cells whose neighbours were modified, then cache the resulting tile indices — this makes autotiling essentially free at runtime.</cite> On placing at `(tx,ty)`: recompute that tile and its four neighbours, then invalidate the containing chunk(s). Never recompute the whole map.

**Acceptance:** a unit test placing every one of the 16 neighbour configurations asserts the correct sprite key; a test that placing one tile touches exactly 5 tiles' masks and 1–4 chunks.

### Drag-to-build

Follow the OpenTTD interaction, which players already know: <cite index="38-1">put the cursor on the start tile, click and drag to the end tile with white lines previewing the future track, and release to build; a Remove tool drags along existing track to remove it.</cite>

- **Pointer down** on a legal start tile arms the drag.
- **Pointer move** recomputes a preview path and draws it on the overlay layer — legal tiles tinted, illegal tiles and unaffordable overruns tinted red, with a running cost readout pinned near the cursor.
- **Pointer up** commits, charging for the tiles actually placed.

Path shape: **L-shaped Manhattan** (all of one axis, then all of the other), with a modifier key / two-finger tap to flip which axis goes first. Do **not** ship A* auto-routing in v1 — it produces paths players didn't intend and hides cost. Reserve A* for the AI (E7), where nobody is surprised by it.

Obstacles under the drag (water, an industry footprint) truncate the preview at the last legal tile rather than failing the whole drag.

**Acceptance:** dragging across 10 tiles charges exactly 10× the per-tile cost; dragging into water truncates; dragging over existing road of the same type is free and does not double-charge; a drag that costs more than you hold previews the affordable prefix and builds only that.

---

## E6. Stations, catchment and connection scoring
`[feature] [gameplay] [core]`

Replaces vertex adjacency. This is the mechanic that makes the map matter.

- A **harvester** is placed on an industry tile; it must be adjacent to at least one road or rail tile.
- Its **catchment** is a 4×4 rectangle centred on it; any industry overlapping the catchment feeds it.
- `playerResources(map, player, now)` is rewritten: for each harvester, union the industries in catchment, sum output, multiply by the transport multiplier of the *connection type* linking it to the main Factory (1.0 road / 1.6 rail). Blockade (`banditUntil`) still zeroes an industry — that logic carries over cleanly from the hex version.

**Connection check.** A flood fill over `roadBits`/`railBits` respecting direction masks — a tile connects to its neighbour only if *both* set the facing bit, which is what makes `ConnectRoadToStructure`-style half-piece bugs impossible. Run on every build and demolish, not on a timer. Cache the connected-component id per tile; a rebuild is O(tiles) and happens rarely.

If a harvester reaches the Factory by both road and rail, take the rail multiplier and the rail VP. If a rail path is broken, fall back to any surviving road path and **revoke the rail VP** — this must be visible, with a toast and the VP counter animating down, or players will not understand what happened.

**Decide here:** what happens when two players' catchments overlap one industry. Recommend splitting output proportionally to the number of claimants, which avoids a first-mover lockout without needing a rating system.

**Acceptance:** placing a harvester next to a farm starts grain; demolishing one road tile mid-path stops it and revokes VP within one frame; a blockaded industry produces nothing; a rail path scores 3 and its 1.6× multiplier applies.

---

## E7. AI
`[feature] [ai]`

`ai.ts`'s `findLegalSettlement` / `findLegalRoad` don't survive. New behaviour: score candidate industries by (cargo scarcity in the AI's stock × output ÷ path cost), A* a path from the nearest owned network tile, build road if it can't afford rail, place a harvester. Reuse the existing skill/timing scaffolding (`nextBuild`, `nextIncome`, `slowedUntil`).

A* here is fine — it's the AI's own path, and it's the natural place for the auto-routing that E5 deliberately keeps out of the player's hands. Cost function: 1 per flat tile, 3 per rough, impassable for water and industry footprints, and **0.3× for tiles already carrying the AI's own network** so it reuses trunk lines instead of building parallel spurs.

Must be deterministic under the seeded RNG so T1 can assert on it.

---

## E8. Starting state and rebalance
`[design] [gameplay]`

Setup phase becomes: place main Factory (free) → place first harvester (free, must be on an industry) → receive a fixed budget of free road tiles (proposed 12) to connect them. If the player places them more than 12 road-tiles apart, top up rather than soft-locking.

**This is where K1's bug class recurs.** The old setup broke because a once-per-second affordability check clawed back a free build. Free setup builds must be flagged as free at the data level (`{ free: true }` on the build action), not inferred from the phase, so no future timer can revoke them.

Then rebalance `VP.target`, `COSTS`, `UPGRADE_EVERY` and sabotage prices against the road/rail curve. Expect several playtest passes; file follow-ups rather than trying to land it once.

---

## E9. UI
`[feature] [ui]`

Build panel becomes Road / Rail / Harvester / Demolish. The road-vs-rail tradeoff must be visible **at the point of decision**: while dragging, show live cost, tiles used, and the VP the completed connection would award, for both types side by side. `tileInfo` becomes an industry inspector listing output, serving harvesters, and connection type. All `showBanner`/`showModeBar` strings change.

---

## E10. Multiplayer snapshot
`[feature] [multiplayer]`

`net.ts` snapshots change shape: terrain and industries are seed-derived and never sent; `roadBits`, `railBits` and the harvester list are. Send the two `Uint8Array`s as base64 rather than JSON arrays — 2304 bytes each, versus roughly 10KB as JSON. Add a `version` field and reject mismatched clients with a clear message; today a stale guest silently desyncs.

---

## E11. Cutover
`[chore]`

Delete `hexmap.ts`, `MapView3D.ts`, the terrain `.jpg` textures, and the `three` / `@types/three` dependencies (~600KB). Regenerate T2 snapshots. Close the obsoleted mobile camera tickets.

---

## Test fixtures to build alongside (extends T1)

These are cheap now and expensive later:

1. **Projection round-trip** — every tile, `screenToTile(tileToScreen(t)) === t`, plus the four diamond corners of 20 sampled tiles.
2. **Autotile table** — all 16 neighbour configurations → expected sprite key.
3. **Incremental autotile** — placing one tile dirties exactly 5 masks.
4. **Depth-sort reference render** — fixture map, committed PNG, three zoom levels, four quadrants.
5. **Pick accuracy** — chimney of a tall sprite, 1px gap between buildings, at three zooms and a non-zero camera offset.
6. **Connection integrity** — build path, assert connected; remove one middle tile, assert disconnected and VP revoked.
7. **Drag cost** — 10 tiles charges 10×; truncation at water; free re-drag over own road.
8. **Determinism** — same seed, two contexts, hash terrain + industries.
