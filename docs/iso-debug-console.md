# `window.__iso` — the visual-debug console (C5)

Every art/geometry bug in this repo has arrived as a screenshot: *"the house
floats"*, *"the highlight is a level below the building"*, *"I clicked a tile
and nothing happened"*. Reading those reports off pixels is how a whole commit
got spent re-deriving what a two-line dump would have said. The console puts
the **state behind a screenshot** in the page, on the same `window.__iso` test
hook the e2e suite already uses.

Implemented in `src/iso/debug.ts`, wired in `src/iso/game.ts`, pinned by
`tests/unit/iso-debug.test.ts`.

## Turning it on

It is **not** in a shipped build by default:

| context | available when |
|---|---|
| `npm run dev` (Vite dev server) | always — `import.meta.env.DEV` |
| `npm run build && npm run preview`, prod hosting | with **`?iso-debug=1`** or **`?debug=1`** on the URL, e.g. `/hexmatch/?seed=1337&debug=1` (`?iso-debug=0` = off) |

The gate is `shouldInstallDebugConsole({ dev, search })`, and when it says no,
`game.ts` installs nothing and the renderer's `debugPainter` stays `null` — no
dump code runs at all, so there is nothing to strip later.

Passing `?debug=1`, `?debug`, or `?iso-debug=1` also automatically activates the
debug overlays on boot. In any session where the debug console is installed, pressing
the **backtick / tilde** key (`` ` `` or `~`) toggles all visual debug overlays on and off.
When overlays are active, an on-screen HUD box renders at the top-left of the canvas
with an active overlay summary and color legend.

## The commands

All of them `console.log` the object they return, so `copy(__iso.dumpTile(24,7))`
in DevTools gives you pasteable JSON. Positions are reported in **both** spaces
on purpose: the canvas and `renderer.pick` speak **device** pixels, a screenshot
and `page.mouse` speak **CSS** pixels.

### `__iso.dumpTile(tx, ty)`

Everything that decides how one tile looks:

```
terrain / terrainName / index      which cell of the grid this is
sprite                             terrain_grass | terrain_water | terrain_rough
cell                               the resolved atlas entry: rect, footprint, anchor, frames
surfaceDriftPx                     this tile's anchor row − the shared ground line
world / anchorWorld                the top vertex (pick lattice) and the south corner (where
                                   the sprite's anchor lands), in world space
screen / anchorScreen / css        the same points at the live camera (device px) and in CSS px
halfDiamond                        the on-screen diamond half-extents at the live zoom
occupancy / industry               what stands on it
track                              roadBits, railBits, owner id
build { ok, why }                  would the CURRENT tool's build be refused here, and why
pickAtCentre                       what `renderer.pick` says about this tile's own centre
```

The anchor is **derived from the declared `.pnml` offsets** — the packer
(`tools/slice-atlas.mjs`) never measures pixels to place a tile, so this is the
ground truth for "do the terrain tiles and the buildings agree".

OpenGFX tiles are **flat** pixel diamonds with no skirt. The number that
settles a *"the terrain is stepping"* report is **`surfaceDriftPx`**: it is 0
on every correctly-anchored tile. A non-zero `surfaceDriftPx` is the real bug
class.

### `__iso.dumpAt(x, y[, { device: true }])`

Which tile a **screen point** resolves to, with both halves of the two-stage
pick:

```
device, world                      the point, after the dpr multiply
flatPick                           stage 1 — the floor() lattice
spritePick                         stage 2 — the alpha-mask override, if any
overridden                         true when stage 2 moved the answer
resolvesTo, inMap                  the tile a click here actually selects
```

This is the answer to "the pick is landing on the wrong tile". Pass CSS pixels
(a screenshot coordinate, `page.mouse`'s unit) by default; `{device:true}` for
raw canvas pixels.

### `__iso.dumpBuilding(tx, ty)`

Every structure drawn on that tile — with the one number that settles a hover
report:

```
structures[].gapPx      the sprite's anchor row minus the footprint's south corner
                        0 = flush, > 0 = floating, < 0 = sunk
structures[].footWorldY / footScreenY / drawWorld / drawScreen
structures[].surfaceWorldY  world y of the footprint's south corner
ground                    the terrain under it: sprite, driftPx
```

A `gapPx` of 0 with a visibly floating building means the building is flush and
the **terrain sprite** is the thing that is off — read `ground.driftPx`.

### `__iso.dumpNetwork(player)`

The adjacency answer, i.e. "why was my road refused":

```
player, ownerId              "you" → 1, "ai" → 2 (unknown id ⇒ { error })
seeds                        the factories/harvesters that seed the flood
tiles, roadTiles, railTiles  the counts
list                         up to 256 [tx, ty] pairs, `truncated` if capped
```

`canBuildOn` only accepts a tile that is in this set or adjacent to it
(`buildRefusal` → `"not-adjacent"`), so `dumpNetwork` plus `dumpTile.build.why`
names the reason for any silent refusal.

### `__iso.overlay(name[, on])`

Draws the diagnostics **on the map**, so a screenshot carries them. Every frame,
after the normal overlay items, into the overlay canvas.

| name | what it paints |
|---|---|
| `anchor` | a green crosshair at every structure's contact point (its anchor on the footprint's south corner), and `sprite ±gap px` next to any that is not flush |
| `network` | the network tiles of both players filled — green for you, red for the rival |
| `pick` | the hovered tile's **drawn** diamond in white and its **pick cell** as a dashed magenta outline on the SAME spot (one convention — any visible offset between them is a bug) plus a crosshair at the viewport centre |

```js
__iso.overlay("anchor")         // on
__iso.overlay("anchor", false)  // off
__iso.overlay("all")
__iso.overlay("none")
__iso.overlay()                 // { active: ["network"], drawn: true }
```

### `__iso.config()`

The resolved cell of **every sprite on screen right now**: atlas rect,
footprint, anchor, plus `frames`, so "which PNG is that?" is one call. It
also returns `camera`, `geometry` (tileW/tileH/HW/HH/map) and `manifestMeta`.

> The manifest deliberately carries no source-PNG paths (the packer owns those;
> nothing else may). To go from a sprite back to its OpenGFX file, read
> `tools/iso-atlas.cells.json` — or re-run `npm run slice-atlas`, which prints
> `name  WxH  anchor=[x,y]  <- path/to.png` for every cell.

### `__iso.rendering()`

The renderer's own snapshot of the **last frame's draw facts** — not a
re-derivation, the values `IsoRenderer` actually used:

```
camera                 zoom / viewport / translation (device px)
cull                   the cull pad and the padded visible tile range
chunkCacheEntries      how many terrain chunk surfaces are cached
groundAnchorReference  terrain_grass anchor.y (the shared OpenGFX ground line)
depthCycles            occlusion cycles the depth sort had to break
structures[]           per drawn sprite: resolved name, tile, footprint,
                       anchor, world/screen draw origin, depth key
sourceRect[]           for each on-screen sprite: the 1× manifest rect scaled
                       naively (`raw`) and the actual integer rect the packer
                       put in the zoomed atlas (`packed`)
warnings[]             known bug classes it detected: ground-anchor drift >1px
                       off the shared line, fractional zoom source rects (the
                       0.5× crop class), depth cycles, and the highlight
                       anchor drift
```

`__iso.rendering()` is the first call after a screenshot: it names the sprite,
the source/dest rect at the live zoom and every warning, so a render issue is
traced to a number instead of re-derived from pixels.

### `__iso.renderLog(on = true)`

Toggles the per-blit `[render]` **console.debug** trace inside the renderer.
With it on, every terrain tile, chunk build/blit, structure blit and `pick()`
emits one structured line:

```
[render] terrain    { chunk, tile, sprite, anchor, dest, src, clip, z }
[render] chunk-built { key, chunk, origin, surface, sprites, z }
[render] blit       { sprite, tile, clipped, z, anchor, world, screen, src, dest, depthKey }
[render] pick       { input, world, flat, sprite, result, z }
```

It is off by default even in a dev build so a normal session is not flooded.
Turn it on with `__iso.renderLog(true)` in the console, or boot with
**`?render-log=1`** (the app auto-enables it once the renderer is created).
In the standalone `iso-demo` page (`src/iso/demo.ts`, a bare renderer with no
game console), press **`L`** to toggle the same trace.

### `__iso.probe(tx, ty)`

The small one that pays for itself: the game's own verdict for the tile under
the cursor for the current tool — `build {ok, why}`, `harvester {ok, why,
industries, rect}`, `terrain`, `rough`, `occupied`. `why` is produced by
`buildRefusal` in `src/iso/track.ts`, the same function `canBuildOn` delegates
to, so a probe can never disagree with the rule that gates the build.

## Repeatable workflow: screenshot → state

1. Boot with the flag on and the map pinned:
   `npm run dev` → `http://localhost:5173/hexmatch/?seed=1337&iso-debug=1` (the app is served under `base: "/hexmatch/"`).
2. Turn on what the report is about — `__iso.overlay("anchor")` for a floating
   building, `overlay("network")` for a refused road, `overlay("pick")` for a
   click that landed elsewhere — and screenshot **with the overlay on**. The
   overlay is drawn from the live camera, so the marks line up with the pixels
   in the screenshot.
3. Read the tile off the screenshot: measure the point in the image, then
   `__iso.dumpAt(x, y)` — the numbers are **CSS px by default** (`dumpAt`
   multiplies by dpr itself, and echoes `input.unit` so a paste says which unit
   it read). Measuring on a device-pixel crop instead? `__iso.dumpAt(x, y,
   {device: true})`. `resolvesTo` is the tile you are actually pointing at.
   The point is read relative to the map's own canvas box, which today starts at
   the viewport origin (`#map` is `position:absolute; inset:0` inside a
   `position:fixed; inset:0` `.ui-root`) — so viewport px and canvas px are the
   same number. If that layout ever gains an inset, subtract it:
   `dumpAt(x - map.getBoundingClientRect().left, …)`, which is what
   `isoTileClickPoint` in `tests/e2e/corridor-picker.ts` measures rather than
   assumes.
4. Dump it: `__iso.dumpBuilding(tx, ty)` for a building complaint (read
   `gapPx`, then `ground.driftPx`), `__iso.dumpTile(tx, ty)` for anything
   terrain-shaped, `copy(__iso.config())` to attach the resolved cells.
5. Paste the numbers with the screenshot. `gapPx ≠ 0` is an anchoring bug;
   `gapPx = 0` with `ground.driftPx ≠ 0` is a terrain-sprite bug;
   `build.ok = false` is a rules answer, not a bug — `why` says which.

The e2e suite uses the same surfaces the console exposes:
`tests/e2e/corridor-picker.ts` filters candidate corridor tiles through
`__iso.tileProbe` and `__iso.pickAt` rather than re-deriving the rules, which is
what makes a red run there name a cause (see
`docs/tickets/E14-e2e-corridor-picker-returns-null.md`).
