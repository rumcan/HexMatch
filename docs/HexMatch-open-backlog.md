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

## D1. Normalise skirt height so tiles and buildings share one ground plane
`[P0] [renderer] [assets]`

The fix has two valid approaches. **Approach A is strongly recommended** — it's simpler, matches the "flat uniform terrain" intent, and can't drift again.

### Approach A — one canonical skirt, enforced at pack time (recommended)

- Pick **one canonical skirt height** — 49px (water's value; the smallest common one, so nothing gets clipped).
- In `tools/slice-atlas.mjs`, for every `ground` and `standing` sprite, **crop or pad the skirt to exactly the canonical height** so every sprite's `(bottom − widestRow)` is identical. The diamond top is untouched; only the skirt below the widest row is normalised.
- The renderer's single `BLOCK_H` now becomes *correct* because every tile genuinely has that skirt. No per-tile offset needed.
- Extend the existing flat-only filter: reject a terrain tile if, after normalisation, its top surface isn't clean — but the normalisation itself handles the height.

**Why 49 not 50:** measure the real canonical from the tiles you actually use and set `BLOCK_H` to match it exactly. Don't leave `BLOCK_H=50` if the tiles are 49 — that 1px will still gap.

### Approach B — carry per-tile skirt in the manifest

- The packer measures each sprite's skirt and writes it to the manifest.
- The renderer offsets each sprite by *its own* skirt relative to the ground plane: a building on a tile sits at that tile's ground surface (`screenY + groundSkirt`), and the building's own foot aligns there regardless of its sprite skirt.
- More flexible (keeps tiles at native height) but more places to get wrong, and depth-sort/picking must use the corrected geometry too.

**Use A.** B only if you later want tiles of deliberately different heights (you don't, for a flat map).

### Verify with C5 (this is what the console is for)

After the fix, `__iso.dumpTile(tx,ty).skirtDriftPx` should be **0 for every tile**, and `__iso.dumpBuilding(tx,ty).gapPx` should be **0** for every building. That's the measurable acceptance — the console the last PR built is exactly the right tool to confirm this one.

**Acceptance:**
- `skirtDriftPx === 0` for all terrain tiles; `gapPx === 0` for all buildings (checked via `__iso`).
- Screenshot: grass and water tiles sit at the same level (no step); buildings sit flush on the ground (no hover); the placement highlight is at the building's base level.
- Depth sort and picking use the normalised geometry (buildings don't mis-occlude, clicks land on the right tile).
- G7 atlas gate green after re-slice.

---

## D2. Make C3 (can't build roads) verifiable now that C5 exists
`[gameplay]`

You still couldn't build roads. With D1's geometry fixed, picking should land on the right tile. To confirm rather than guess, use the console the last PR added:

- Click where a road should go; call `__iso.dumpAt(screenX, screenY)` → does it resolve to the tile you clicked, or one behind/below? (Catches a residual pick offset.)
- `__iso.dumpNetwork('you')` → is the tile adjacent to your network? (Catches an adjacency bug.)

If D1 fixes picking and roads build → close C3. If picking is right but build is still refused → it's a network-adjacency bug, dig there. **Don't fix blind — use the console.**

**Acceptance:** dragging from a network-adjacent tile builds road; any refusal shows a toast with the reason; confirmed via `__iso.dumpAt`/`dumpNetwork`.

---

## D3. Optional — make the debug console visible without devtools
`[tooling]`

Since you expected to *see* something: add a toggle (a key like backtick, or a URL param `?debug=1`) that turns on the C5 overlay on-screen — drawing skirt drift, gaps, and network tiles directly on the map, plus a small HUD line. Then the debug info is visible in a screenshot without you opening devtools or typing commands. The overlay draw code from C5 already exists; this just binds it to a visible toggle and prints a one-line legend.

**Acceptance:** a documented key/param toggles a visible debug overlay; a screenshot taken with it on shows skirt/gap/network state.

---

## Sequencing

**D1 → D2 → D3.**

D1 is the fix for everything you're seeing — the stepped terrain and the hovering buildings are one bug (variable skirt vs assumed constant). Do it, verify `skirtDriftPx`/`gapPx` are zero with the console, screenshot. D2 confirms roads with the same console. D3 makes future screenshots self-diagnosing.

## The one-line summary for the agent

> The renderer assumes every Kenney tile has a 50px skirt. They don't (grass 65, water 49, buildings 59–67). Normalise every sprite's skirt to one canonical height at pack time so the single `BLOCK_H` is actually true. Confirm with `__iso.dumpTile().skirtDriftPx === 0` and `__iso.dumpBuilding().gapPx === 0`. This is C1, which PR #23 measured but did not fix.