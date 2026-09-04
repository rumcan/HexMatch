# HexMatch — open backlog

Supersedes v9. Audited against `main` @ `41de9e9` (PR #13 merged). Roads and grass are fixed and confirmed. Y3 landed — buildings are now single declared sprites, no `compose` blocks — but that fix overshot, so the buildings now sit too *small* in their footprints. Plus four separate issues from your latest screenshots.

**Standing principle, still in force:** the UI is the original HexMatch interface and the gameplay stays essentially what it was.

**Work order: V1 → V2 → V3 → V4 → V5.** V1 and V2 are the visible building problems; V3/V4 are quick UI bugs; V5 is the asset wiring you set up.

---

## What's fixed (confirmed)

- **Roads** — real OpenGFX road sprites now, full-width with centre markings. Y4c done.
- **Grass** — flat, no triangles. Done.
- **Buildings are single declared sprites** — no more `compose` stitching. The ore mine, farm, forest and gold mine now read as real, coherent buildings. That part of Y3 worked.

---

## V1. Buildings are drawn ~1 tile but reserve a 2×2 / 3×3 footprint
`[bug] [P0] [renderer]`

**This is "the industry buildings are visually only 1 square but take up multiple squares."** Confirmed by measuring the atlas:

| Building | Sprite size | Footprint | Footprint should span |
|---|---|---|---|
| `factory_blue` | 64×69 | 3×3 | 192px wide |
| `ore_mine` | 73×65 | 3×3 | 192px wide |
| `farm` | 64×37 | 2×2 | 128px wide |
| `gold_mine` | 64×… | 2×2 | 128px wide |

Y3 swung the pendulum the other way. The old `compose` blocks were too big and stitched from fragments; the new single sprites are correct *buildings* but each is roughly one tile wide, sitting on a footprint that reserves four or nine. So the building floats in the top of a much larger reserved area, and placing one blocks tiles that look empty.

Two ways to resolve it — **decide explicitly, don't split the difference:**

**(a) Shrink the footprint to match the sprite (recommended, less work).**
Most of these buildings genuinely are ~1–2 tiles of art. Set each industry's gameplay footprint to what the sprite actually covers: farm/forest/gold/ore → `[1,1]` or `[2,2]` as the art dictates; factory → `[2,2]`. The footprint drives catchment and occupancy, so this also makes placement feel honest — you block the tiles you visibly cover. Re-tune catchment radius if needed.

**(b) Use real multi-tile industry art to fill the 3×3.**
Keep the big footprints and draw the industry as OpenTTD does — several per-tile sprites composed across the footprint via the `build_industry.h` layout. This is faithful but much more work and is the thing Y3 option (b) deliberately deferred. Only worth it if you want the big sprawling industries from the reference art.

Recommend (a) now, revisit (b) later if the map feels sparse. Either way the acceptance is the same: **the reserved footprint equals what the player sees.**

**Acceptance:** placing any building highlights and occupies exactly the tiles the sprite visibly covers; no empty-looking tiles are blocked; the debug footprint-outline overlay (from Y7) sits flush around the sprite base.

---

## V2. The factory sprite is broken — it's one corner-piece of a multi-tile industry
`[bug] [P0] [assets]`

**This is "the factory building is completely broken now."** In the screenshot it's a thin sliver of blue chimneys on a grey slab. Cause, confirmed from the sprite catalog:

The cells file picks sprite **2150** for the factory. But 2150 is only **57×62 — one building piece** of the factory. A factory in OpenGFX is a *multi-tile industry*: the full building is assembled from several sprites (2150, 2151, 2152, 2157–2160 …) laid across its tiles, plus ground pads (2148, 2153–2156). Picking one piece gives you one corner — the sliver you see.

The other industries got lucky: the coal/ore mine's building (2013) happens to be a mostly-complete structure in a single sprite, so it reads fine. The factory doesn't have that — its art is inherently multi-part.

**Fix — pick a factory that is one coherent sprite, or compose it correctly:**

1. **Simplest:** use a single-sprite building that reads as a factory/HQ from a different declaration. Candidates worth rendering: the misc-industry buildings 2165 (64×62), 2167 (64×57), 2169 (64×77) in `industries_misc.png` — taller single structures that look like a works. Pick one that reads as a main factory, apply the player tint, done. This keeps the "one declared sprite" rule from Y3.

2. **Faithful:** compose the real factory from its declared pieces using the OpenTTD layout — but that's the multi-tile work from V1 option (b) and should only happen if you go that route for all industries.

Do **not** hand-crop a rectangle out of `factory.png` — that's how it broke in the first place. Whatever sprite you choose must be a whole declared sprite id.

**Acceptance:** the factory renders as one complete, recognisable building with its player tint; each of the four colours (blue/red/purple/green) renders correctly; no sliver, no floating slab.

---

## V3. The Quarry board is clipped — right 3 columns cut off
`[bug] [ui]`

**This is "the match-3 table should have 3 more columns; those cols are missing."** The board data is fine — `BOARD_W = 9` in `config.ts` and the grid renders all 9 columns. The columns aren't missing; the **panel is too narrow and clips them.** In the screenshot the quarry panel's right edge cuts through the grid.

Likely one of:
- The `responsiveZoom()` in `ui.ts` scales the board wrap by viewport *height* on desktop (`z = 0.8` etc.) but the panel's fixed width doesn't account for `9 × CELL` at that zoom, so the grid overflows its container and the container clips it.
- The restored `styles.css` panel width was sized for a different `CELL` or `BOARD_W` than the iso build uses.

**Fix:** make the quarry panel width derive from `BOARD_W × CELL × zoom` plus padding, so all 9 columns always fit, and let the panel size to its content rather than a fixed width that assumes fewer columns. Verify at the desktop zoom levels in `responsiveZoom` (0.68 / 0.8 / 0.9 / 1.0) and on a narrow window.

**Acceptance:** all 9 columns and 9 rows of the quarry are visible and un-clipped at every zoom level and at window widths from ~1000px up; the board is never cut by the panel edge.

---

## V4. Toast X button doesn't close the toast
`[bug] [ui]`

**This is "toasts can't be closed — clicking the X leaves it there."** In `ui.ts` the `toast()` function builds the toast div and auto-removes it after 2400ms, but **there's no click handler on the X** — the X is drawn (from the restored markup) but wired to nothing, so clicking it does nothing and the toast only goes away on its own timer.

**Fix:** add a close handler. When building the toast, attach the X element's `onclick` to remove the toast immediately (`t.classList.remove("in")` then `t.remove()`), and clear its auto-dismiss timeout so it can't double-fire. If several toasts stack, each X closes only its own.

**Acceptance:** clicking a toast's X removes that toast at once; other toasts are unaffected; the auto-dismiss still works for toasts left alone.

---

## V5. Wire in the restored gem and UI art assets
`[assets] [ui]`

You've put art back into `src/assets/ui/` and `src/assets/gems/` for the gems and button backgrounds. **Important: these are only in your local working copy — they are not on GitHub.** I checked the latest `main` and neither folder exists in the repo. So:

1. **Commit and push the assets first**, or the AI can't see them and will have nothing to wire. Confirm `src/assets/ui/` and `src/assets/gems/` show up in `git status` and get committed.

2. Then replace the current gem rendering with the sprite art. Right now `ui.ts` draws gems as CSS radial-gradients — there's a comment, "the old spritesheet was pruned," and `gemFace()` returns a gradient per resource. Point that at the real gem sprites in `src/assets/gems/` instead (one image per cargo colour, or a spritesheet with an index per `ResKey`).

3. Use the button-background art from `src/assets/ui/` for the BUILD / BLACK MARKET / tab buttons, per the original interface's styling.

**Map the six gem images to the six cargoes explicitly** (`grain, wood, ore, stone, oil, gold`) so there's no ambiguity about which sprite is which resource — the same bijection `quarry.ts` already relies on.

**Acceptance:** gems render as the restored sprite art, not gradients; buttons use the restored backgrounds; the six gem sprites map one-to-one to the six cargoes; assets are committed to the repo, not just local.

---

## Sequencing

**V1 → V2 → V3 → V4 → V5.**

V1 and V2 are the building problems and are related — decide the footprint-vs-art question in V1 first, because V2's factory choice depends on it (if you go multi-tile in V1, the factory composes; if you shrink footprints, the factory is one sprite). V3 and V4 are small, independent UI fixes — either order. V5 last, and **push the assets before starting it.**

---

## Process note

The building sizing is a fresh instance of a familiar pattern: a fix (Y3, single sprites) that corrected one failure mode (stitched fragments) and created its mirror (sprites too small for the footprint) because the footprint side wasn't adjusted with it. The Y6 invariant "sprite width ≤ footprint_w × 64 + 32" catches *too big*; add its partner — flag when a building sprite is dramatically *smaller* than its footprint (say, < half the footprint's pixel span) — so "building doesn't fill its tiles" becomes a test failure rather than a screenshot catch.