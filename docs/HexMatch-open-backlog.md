# HexMatch — the skirt-height fix (this is THE bug)

Audited against `main` @ `a04d5a2` (PR #23). You are exactly right: **the Kenney tiles are different heights and the renderer thinks they're all the same.** PR #23 measured the problem but did not fix it. This doc is the fix.

---

## What PR #23 actually did (and didn't)

- ✅ **E14** (e2e corridor picker) — fixed, gameplay test green in a real browser.
- ✅ **C5 console** — landed, but **passive**: `__iso.dumpTile()` etc. only output when you type them in the browser devtools console. Nothing logs on startup and nothing changes visually. That's why "I don't see any console logs or improvements" — there's nothing to see unless you open devtools and call the commands by hand. The agent even measured the bug (`skirtDriftPx +16px on grass 067`) — but measuring ≠ fixing.
- ❌ **C1 (the skirt geometry)** — NOT fixed. The renderer still imports and uses a single `BLOCK_H` constant. This is the bug you're looking at.
- ❌ C2, C3, C4 — still open.

---

## The bug, in exact numbers

Every Kenney tile is a diamond TOP (where things sit) plus a vertical SKIRT below. The skirt height is **different per tile**, but the renderer anchors everything against one constant `BLOCK_H = 50`. Measured on the live config:

| sprite | skirt (px) |
|---|---|
| terrain_grass (067) | **65** |
| terrain_water (066) | **49** |
| terrain_rough (059) | **65** |
| farm base (022) | **67** |
| depot base (044) | **59** |
| the renderer's assumption | **50** |

Two consequences, both visible in your screenshots:

1. **Grass (65) and water (49) differ by 16px.** Adjacent grass and water tiles sit at different heights → the "two levels" stepped look across the map.
2. **Building skirts (59–67) don't match the ground skirt (65), and none match the assumed 50.** A building's foot is positioned as if the ground skirt were 50, so it floats 9–17px above the actual surface → the hovering houses and the highlight-below-building gap.

The renderer positions every sprite by `sy − anchor` where `sy = (tx+ty)·HH` is the diamond centre. That's only correct if `(bottom − widestRow)` is identical for every sprite. It isn't. That mismatch **is** the bug.

---

## D1. Normalise skirt height so tiles and buildings share one ground plane `[FIXED]`
`[P0] [renderer] [assets]`

The fix was implemented using **Approach A**:
- Canonical skirt height is fixed to `BLOCK_H = 50px` (matching the canonical block definition).
- In `tools/slice-atlas.mjs`, all ground tiles and standing structures (both single-cell PNGs and multi-layer composite building stacks) are normalised via `normaliseSkirt(c, BLOCK_H)` so `belowAnchorPx === 50` uniformly across every sprite.
- Atlas and manifest were re-sliced via `npm run slice-atlas` and validated via `npm run validate-manifest`.
- `__iso.dumpTile(tx, ty).skirtDriftPx === 0` and `__iso.dumpBuilding(tx, ty).ground.driftPx === 0` across all tiles on the map. Ground terrain and building bases share a single unified ground plane.

---

## D2. Make C3 (can't build roads) verifiable now that C5 exists `[FIXED]`
`[gameplay]`

With D1 geometry normalised, coordinate picking resolves accurately to hovered tile diamond boundaries.
- Adjacency and building rules are explicitly communicated: if a player clicks or drags a road/rail build tool onto a tile that fails rules (`not-adjacent`, `water`, `rough`, `occupied`), an informative toast appears explaining the refusal (e.g. *"Track must extend your network."*, *"Can't build on water."*, *"Rail cannot cross rough ground."*).
- Network expansion and adjacency confirmed via `__iso.dumpAt` and `__iso.dumpNetwork`.

---

## D3. Optional — make the debug console visible without devtools `[FIXED]`
`[tooling]`

Added keyboard shortcut and query parameter support to toggle visual debug overlays and HUD without requiring devtools:
- Pressing backtick/tilde (`` ` `` or `~`) toggles all debug overlays on and off with an in-game toast notification.
- Adding `?debug=1`, `?debug`, or `?iso-debug=1` to the URL automatically boots the game with overlays enabled.
- When active, a HUD box is drawn directly on the canvas displaying the active overlay layers (`skirt`, `anchor`, `network`, `pick`) and a color legend (`cyan=surface amber=skirt green=anchor magenta=pick`).

---

## Sequencing

**D1 → D2 → D3.**

D1 is the fix for everything you're seeing — the stepped terrain and the hovering buildings are one bug (variable skirt vs assumed constant). Do it, verify `skirtDriftPx`/`gapPx` are zero with the console, screenshot. D2 confirms roads with the same console. D3 makes future screenshots self-diagnosing.

## The one-line summary for the agent

> The renderer assumes every Kenney tile has a 50px skirt. They don't (grass 65, water 49, buildings 59–67). Normalise every sprite's skirt to one canonical height at pack time so the single `BLOCK_H` is actually true. Confirm with `__iso.dumpTile().skirtDriftPx === 0` and `__iso.dumpBuilding().gapPx === 0`. This is C1, which PR #23 measured but did not fix.