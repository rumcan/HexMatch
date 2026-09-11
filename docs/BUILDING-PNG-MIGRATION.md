# Building PNG migration — agent instruction spec

**Status:** planning doc. Nothing here has been implemented yet. Each section
below is a self-contained brief you can hand to one AI agent. Run them in the
order given: B-0 first (it is a release blocker), then B-1/B-2 (art), then B-3
(perf), then B-4 (cleanup) last.

Read `docs/building-layers.md` and `assets/buildings-src/README.md` before
starting any of these. They describe the authoring convention and the engine
path and are still accurate.

---

## Where the system actually stands today

Verified against the working tree on `main`:

- The pipeline exists and works: `tools/make-building-pngs.mjs` reads
  `assets/buildings-src/<name>@2x.png`, validates the canvas against the
  footprint in `assets/iso-atlas/manifest.json`, and emits
  `assets/buildings/<name>@{0.5x,1x,2x}.png` + `manifest.json`.
- The engine path exists and works: `loadBuildingLayers()` in
  `src/iso/atlas.ts` fetches that manifest at runtime, overrides each covered
  sprite's def (whole image = sprite, centre anchor, `center: true`) and builds
  its alpha mask. `Atlas.imageForSprite` prefers a per-building PNG over the
  shared sheet, and a missing file falls back per sprite.
- `assets/buildings/` currently contains **only `oil_rig`** (all three zooms,
  manifest entry present).
- `assets/buildings-src/` currently contains **three** authored sources:
  `oil_rig@2x.png`, `town_house_c@2x.png`, `town_house_pool@2x.png`. If you
  expected three *town houses*, two of them are not in the tree — check they
  were saved before starting B-1.

So "how do we do this" is, on the happy path, two commands. Everything below is
about the four things that are not on the happy path.

---

## B-0 — Ship the PNGs in the production build (BLOCKER, do this first)

**The bug.** `assets/` is not Vite's `publicDir` (`public/` is empty and
`vite.config.ts` sets no `publicDir`). Everything else reaches the browser
through a static `import` in `src/iso/game.ts`, so Vite bundles and hashes it.
But `loadBuildingLayers()` does a **runtime `fetch`** of
`${import.meta.env.BASE_URL}assets/buildings/manifest.json`. Under `vite dev`
that resolves off the project root and works. Under `vite build` nothing copies
`assets/buildings/` into `dist/` — confirmed: `find dist -name '*oil_rig*'`
returns nothing.

Result: in every built or deployed copy of the game the manifest fetch 404s,
`loadBuildingLayers` returns 0, and **all** buildings silently fall back to the
shared sheet. The new art appears to work locally and is invisible in
production. Any acceptance screenshot taken from `npm run dev` is therefore not
evidence.

**Instruction to the agent:**

> Make `assets/buildings/` (manifest plus every `@0.5x/@1x/@2x` PNG) available
> at `<base>assets/buildings/` in the production build, so
> `loadBuildingLayers()` resolves identically under `vite dev`, `vite preview`
> and the deployed build.
>
> Pick one of these and state which you chose and why:
>
> 1. **Static copy** — add a `viteStaticCopy`-style plugin (or a small
>    `closeBundle` hook) in `vite.config.ts` that copies `assets/buildings/**`
>    into `dist/assets/buildings/`. Keeps the runtime fetch and the per-sprite
>    fallback exactly as designed. Preferred: that non-gating design is
>    deliberate and worth keeping.
> 2. **Bundle import** — have `make-building-pngs.mjs` also emit a small `.ts`
>    module that statically imports each PNG, and change `loadBuildingLayers`
>    to take resolved URLs instead of fetching. Gets hashing and cache-busting,
>    but turns the art into a hard build dependency and loses the "drop a file
>    in and it appears" ergonomics.
>
> Do NOT move `assets/` into `public/` wholesale — that would deoptimise the
> atlases and ground textures, which are correctly bundled today.
>
> **Acceptance:** `npm run build && npm run preview`, open the game, and show in
> the devtools Network tab that `/hexmatch/assets/buildings/manifest.json` and
> `oil_rig@1x.png` return 200, with no `[building-layers]` console warning. Add
> an assertion to `tests/e2e/` that the building-manifest request succeeded, so
> this cannot silently regress.

---

## B-1 — Wire the new PNGs into the game

Three separate cases. Do not conflate them.

### B-1a — `oil_rig`: already correct, just verify

3×3 footprint, 384² source, all three outputs present. The source PNG has a
newer mtime than the generated files, so regenerate it and verify visually.

### B-1b — `town_house_pool`: correct name, needs generating

`town_house_pool` **is** in `TOWN_HOUSE_VARIANTS` (`src/iso/config.ts`), so the
game will draw it the moment the files exist. Just run the tool.

### B-1c — `town_house_c`: WILL NOT APPEAR — this is the trap

`town_house_c` is a sprite in `assets/iso-atlas/manifest.json`, so
`make-building-pngs.mjs` accepts it and `loadBuildingLayers` installs it — but
it is **not** in `TOWN_HOUSE_VARIANTS`, and `townHouseSprite()` only ever
returns names from that array. The art gets generated, decoded into memory, and
never drawn. Same for `town_house_a` and `town_house_b`.

**Instruction to the agent:**

> 1. Run `node tools/make-building-pngs.mjs oil_rig town_house_pool town_house_c`
>    and confirm three entries land in `assets/buildings/manifest.json`.
> 2. Ask the user which they want for `town_house_c` before touching
>    `config.ts` — the options differ materially:
>    - **Add to the pool:** append `"town_house_c"` to `TOWN_HOUSE_VARIANTS`.
>      It becomes 1 of 44 variants (~2% of town tiles). Note that changing the
>      array *length* changes `townHouseSprite()` output for every tile (it is
>      `h % TOWN_HOUSE_VARIANTS.length`), so every existing town re-rolls its
>      buildings. Cosmetic, but it will move golden/snapshot tests — check
>      `tests/unit/iso-golden.test.ts` and `tests/unit/iso-art-layout.test.ts`.
>    - **Make it the whole pool:** if the new PNG art is meant to *replace* the
>      old sheet town houses, shrink `TOWN_HOUSE_VARIANTS` to only the names
>      that have per-building PNGs. Cleaner end state; towns look repetitive
>      until more PNGs are authored. This is the direction implied by "replace
>      the buildings in the game", and it pairs with B-4.
> 3. Verify in the running game at all three zoom levels that the art sits
>    concentric with its footprint, and that clicking the building (not just
>    its tile) selects it — picking uses the PNG's own alpha mask via
>    `buildBuildingMasks`, so a bad anchor shows up as a bad hit-box too.
> 4. `assets/buildings-src/*.png` are the authoring masters — commit them
>    alongside the generated output. The generated files are reproducible; the
>    sources are not.

### The general recipe (worth adding to the buildings-src README)

```
1. the sprite name must already be a key in assets/iso-atlas/manifest.json
   (that file is the footprint authority — art never changes a footprint)
2. open assets/buildings-src/templates/<w>x<h>@2x.png, paste art over it,
   ground line on the pink anchor cross, save as <name>@2x.png
3. node tools/make-building-pngs.mjs <name>
4. confirm the name actually reaches the draw path — industries and depots do
   automatically, town houses only via TOWN_HOUSE_VARIANTS
5. npm run build && npm run preview, and verify in the BUILT game, not dev
```

---

## B-2 — Downscale quality (do this before judging the art)

`make-building-pngs.mjs` derives 1× and 0.5× with `kernel: "nearest"`. That was
inherited from the pixel-art atlases, where nearest at exact 2:1 / 4:1 ratios is
correct and crisp. It is the **wrong** choice for rendered, anti-aliased
building art: nearest at 4:1 throws away 15 of every 16 pixels, so thin
structures (the rig's derrick lattice, window frames, railings) break into
sparkling noise at 0.5×. The art will get blamed for what is really a
resampling bug.

**Instruction to the agent:**

> In `tools/make-building-pngs.mjs`, generate the 1× and 0.5× variants with a
> quality kernel (`lanczos3`, or `mitchell` if lanczos ringing shows on hard
> edges) instead of `nearest`. Watch the alpha edges: if transparent margins
> pick up a dark halo, the resize is not premultiply-aware — fix that rather
> than reverting the kernel.
>
> Keep the output *sizes* exactly as they are (exact halves and quarters). The
> "nothing is ever scaled inside `drawImage`" invariant is about the engine and
> is still respected — only the offline resampling filter changes.
>
> Regenerate everything and put a before/after of `oil_rig@0.5x.png` in front of
> the user. If they prefer the crunchier nearest look, make the kernel a
> per-building option in the manifest rather than arguing about it.

---

## B-3 — Performance

A real concern, but the expensive thing is probably not what you think. Work the
list in order and **measure between each step**.

### The actual cost model

Buildings draw on the `structures` canvas, which is redrawn on world change,
not every frame. Per-frame cost is dominated by the `terrain` canvas (drifting
ocean, animated shoreline) and the `overlay`. So building art affects: (a)
**load time and VRAM** — every PNG is decoded to an `ImageBitmap` at three zooms
and held for the session; (b) **the cost of a structures redraw**, which is the
hitch you feel when placing or panning.

### B-3.1 — Trim the transparent margins (biggest single win)

Every building PNG is currently the **full template canvas** — 384×384 at 2× for
a 3×3, of which the art occupies maybe a third. The engine blits the whole
rect, so the GPU composites hundreds of thousands of fully transparent pixels
per building per redraw, and the decoded bitmaps sit ~3× larger in memory than
needed.

> **Instruction:** extend `make-building-pngs.mjs` to compute the art's tight
> alpha bounding box (`sharp(...).trim()` or a manual scan), write the trimmed
> image, and record the trim offset in `assets/buildings/manifest.json` by
> re-expressing `anchor` relative to the trimmed origin.
> `loadBuildingLayers()` already writes `s.w`/`s.h`/`s.anchor` straight from the
> manifest, so if the offset is folded into the anchor there may be **no
> renderer change needed at all**. Verify that claim before writing code and
> state the result explicitly in the PR.
>
> Check `buildBuildingMasks` for any assumption about the untrimmed canvas size.
>
> **Acceptance:** file sizes and decoded dimensions drop substantially; the
> buildings render pixel-identically (compare screenshots); picking still hits
> the same pixels.

### B-3.2 — Stale cull pad

`IsoRenderer` computes `this.pad = cullPad(atlas)` **once in its constructor**
(`src/iso/renderer.ts:314`), scanning `atlas.manifest.sprites` for the tallest
sprite. But `loadBuildingLayers()` resolves *later* and **mutates** `s.w`/`s.h`
on those same defs — `src/iso/game.ts:3048` fires after
`new IsoRenderer(...)` on line 3056. If a building PNG ends up taller than the
tallest sheet sprite, the pad is too small and that building pops in and out at
the screen edge. Conversely, if the pad is dominated by a huge *unused* sprite
(see B-4 — `spare_stadium_*` are the likely culprits) then every frame culls far
too generously and does extra work.

> **Instruction:** recompute the pad after the building layers install. Cheapest
> correct fix is a `renderer.recomputePad()` called from the same `.then()` that
> already calls `invalidateAll()`. Add a unit test in
> `tests/unit/iso-renderer.test.ts` that mutates a sprite def after construction
> and asserts the pad follows.

### B-3.3 — Only then consider dropping a zoom level

**Do this last, and only if 3.1 and 3.2 did not get you there** — it is a
visible quality regression and it is not where the time goes.

If you do it, the one to drop is **2×**, not 0.5×:

- 2× costs the most (4× the pixels of 1×, 16× of 0.5×) in decode time, VRAM and
  download, and it is the level users spend the least time at.
- 0.5× is the zoomed-*out* view where the most buildings are on screen at once,
  so it is the level that most needs its own cheap pre-rendered art.
- Dropping 2× means zoom 2 blits the 1× image scaled, which breaks the "nothing
  is ever scaled inside `drawImage`" invariant the whole art pipeline is built
  on. Read `ZOOM_STEPS` in `src/iso/camera.ts` and decide whether you are
  removing the zoom *step* from the camera or only the *asset* tier — they are
  different changes with different consequences.

> **Instruction:** profile before changing anything. Load a full map, record a
> Chrome performance trace across a pan, a zoom change and a building placement,
> and report: frame time on the terrain canvas, time in a structures redraw,
> total `ImageBitmap` memory, and time-to-first-frame. Present those numbers
> with a recommendation. Do not remove a zoom level without that data and an
> explicit go-ahead from the user.

---

## B-4 — Removing dead art (do this LAST, instrument it, do not grep)

The section most likely to break the game if done carelessly.

### Why the obvious approach is wrong

A scan for sprite names appearing as string literals across `src/`, `tools/` and
`tests/` reports **149 of 239 sprites as "unused"**. That number is badly wrong.
Most of those names are **constructed at runtime** and never written literally:

- `road_0001`, `dirt_1010` and all 81 `dirt_road_####` names come from bitmask
  string building in `src/iso/renderer.ts` (`dirtSpriteName` and friends).
- `depot_grain`, `depot_oil`, … come from `depotSpriteForCargo(cargo)` in
  `src/iso/config.ts`.
- Town-house names come from a hash index into `TOWN_HOUSE_VARIANTS`.

Deleting on a literal grep would silently blank out roads. Genuinely dead
candidates do exist — `factory_mt_*` is documented as legacy ("the game no
longer emits them"), plus `factory_red/purple/green`, the `spare_*` set, the
numbered `*_t##` variants, and `town_house_a/b` — but each needs proof.

### The method: prove it at runtime

> **Instruction to the agent:**
>
> 1. Add a temporary, flag-gated hook in the draw path (`place`/`pickSprite` in
>    `src/iso/depth.ts`, or the blit site in `src/iso/renderer.ts`) that records
>    every sprite name actually drawn into a `Set`, exposed on the existing
>    `__iso` debug object (see `docs/iso-debug-console.md`).
> 2. Exercise the game hard with that flag on: the full Playwright suite
>    (`npm run test:e2e`), then a manual session that places every building
>    type, every depot cargo, builds dirt and paved road in every connectivity
>    shape, grows a town to full size, and plays through to victory. Road
>    bitmasks need deliberate coverage — build a plus-junction, dead ends, and
>    every corner.
> 3. Union the observed set with (a) every name written literally in `src/`,
>    (b) every name a template literal *could* produce — enumerate the
>    `depot_${cargo}` and `road_${bits}` families **by construction**, not by
>    observation — and (c) everything in `TOWN_HOUSE_VARIANTS`.
> 4. The complement of that union is the deletion candidate list. **Present it
>    for sign-off before deleting anything.** Do not delete on your own
>    judgment.
> 5. Delete in two stages, each its own commit:
>    - Stage 1: remove entries from `assets/iso-atlas/manifest.json`, repack
>      with `npm run slice-atlas`, then run `npm test` and `npm run test:e2e`.
>      `tests/unit/iso-manifest.test.ts`, `iso-atlas-pixels.test.ts`,
>      `iso-pp12-assets.test.ts` and `iso-golden.test.ts` all assert against the
>      manifest and will need updating — update them deliberately, never by
>      deleting the assertion.
>    - Stage 2: remove the now-unreferenced source art under `tools/opengfx/`
>      and `tools/texture-src/`.

### Safe to do immediately, no instrumentation needed

- `assets/new-atlas/` is an **empty directory** — remove it.
- `assets/iso-atlas/contact-sheet.png` (696K) and `footprint-check.png` (246K)
  are dev review artifacts, not game assets. Confirm nothing imports them, then
  delete or move them under `docs/` so they stop reading as shipped art.
- `assets/ground/grass.png` is **2.6 MB** for a texture used as a repeating 512²
  pattern — that one file is larger than the entire iso-atlas at 2×. Re-encode
  it (quantise the palette, or use a smaller repeat) and compare quality before
  and after. Almost certainly the biggest load-time win available, and it has
  nothing to do with the building migration.
- The root-level `01a07ce9-*.patch` and `building-layers.patch` look like stray
  artifacts. Ask the user before removing them.

### The long-tail reality

Do not expect the shared `assets/layers/buildings@*.png` sheet to disappear
soon. The migration is only complete when **every** sprite the game can draw has
a per-building PNG — roughly 40 town variants plus every industry and depot.
Until then the sheet must stay loaded, and `loadBuildingLayers`'s per-sprite
fallback is exactly what makes a partial migration safe. Plan for the sheet to
shrink gradually rather than be deleted in one step, and run the repack
(`npm run slice-atlas`) routinely as names come off the list.

---

## Suggested agent sequencing

| # | Brief | Depends on | Risk |
| --- | --- | --- | --- |
| B-0 | Ship PNGs in the production build | — | low, blocking |
| B-1 | Generate and wire the three new PNGs | B-0 | low, but see B-1c |
| B-2 | Fix the downscale kernel | — | low |
| B-3.1 | Trim transparent margins | B-1 | medium |
| B-3.2 | Recompute cull pad after load | — | low |
| B-3.3 | Profile; consider dropping 2× | B-3.1, B-3.2 | high, needs sign-off |
| B-4 | Instrumented dead-art removal | B-1 | high, needs sign-off |

One agent per row. B-0, B-2 and B-3.2 are independent and can run in parallel.

## Rules that apply to every agent on this work

1. **Verify in `npm run preview`, never only in `npm run dev`.** The dev server
   resolves asset paths the production build does not (see B-0).
2. **`assets/iso-atlas/manifest.json` is the footprint authority.** Art never
   changes a footprint; if a building needs different tiles, that is a gameplay
   change and needs its own decision.
3. **Never delete a test assertion to make a change pass.** Update it, and say
   in the PR what behaviour changed.
4. **Do not remove a zoom level, or any sprite, without explicit sign-off.**
5. Run `npm run typecheck && npm run lint && npm test` before handing back.
