# HexMatch — tile geometry, config, and debug tooling

Audited against `main` @ `08230e3`. Root-caused from the three screenshots plus the code. There are **four distinct bugs** and one tooling request. Ordered by priority.

---

## The core discovery: Kenney tiles have variable skirt height, the renderer assumes one

Every Kenney tile is a **two-level block**: a flat diamond TOP (where things sit) and a vertical SKIRT below it (the brown/side block). The renderer treats the skirt as a single constant `BLOCK_H = 50`. **It isn't constant.** Measured:

| tile | top-surface | skirt |
|---|---|---|
| grass 010 (live) | 33px | **49px** |
| grass 067 (your config) | 33px | **65px** |
| water 066 | 33px | 49px |

Buildings anchor to their **widest row** and are drawn at `sy − anchor`, where `sy = (tx+ty)·HH` is the diamond *centre*. That math is only correct if every tile's top-to-widest distance matches. Because terrain skirts vary (and differ from what buildings assume), a building placed on a taller-skirt tile **floats above the ground** — exactly screenshot 3, where the house hovers over a visible gap, and screenshot 2, where the highlight diamond sits below the building.

This single geometry gap explains the "two levels — the game doesn't know" observation. It's real, and it's the root cause of the hovering.

---

## C1. Buildings hover above their tile — skirt height isn't modelled
`[P0] [renderer]`

**Symptom:** buildings float above the ground surface; the placement highlight sits at a different level than the building (screenshots 2 & 3).

**Cause:** the renderer positions every sprite by its widest row against the diamond centre-line, ignoring that a tile's *ground surface* is `skirt` pixels below its widest row, and that skirt varies per tile. A building's foot must land on the ground tile's TOP surface, not float at the diamond centre.

**Fix direction:**
- The ground surface of a tile is at `screenY(tx,ty) + (skirt of that tile)` — not at the diamond centre. Buildings must anchor their foot to that surface.
- Either: (a) normalise all terrain tiles to one skirt height at pack time (reject/crop tiles whose skirt ≠ the canonical value — the flat-only filter already rejects slopes, extend it to skirt height), or (b) carry each tile's skirt in the manifest and offset buildings by the skirt of the tile they sit on.
- (a) is simpler and matches the "flat uniform terrain" intent. Pick one canonical skirt (49px, the common value) and only use terrain tiles with that skirt. **Your config's grass 067 has a 65px skirt — that's why it would sit differently from the buildings.** Prefer a 49px-skirt flat grass instead.

**Acceptance:** buildings sit flush on the ground with no gap; the placement highlight is at the same level as the building base; verified by screenshot at 2–3 map positions.

**This interacts with C2** — don't pick terrain tiles until the skirt rule is decided, or you'll pick a good-looking tile with the wrong skirt and reintroduce the hover.

---

## C2. The tile config STILL isn't applied — and the export only half-landed
`[P0] [assets]`

Confirmed on `main`: `terrain_grass` is still `landscapeTiles_010`, `farm` still `buildingTiles_083`, `forest` still `landscapeTiles_028` — the **original programmatic picks**. Meanwhile the depots carry MB1 *stacks*. So the live config is a contradictory mix: the stacking work from PR #19 landed, but **your Art Lab terrain/road/industry choices never did.**

That's why "even after the CSV export the tiles are wrong" — the export didn't reach `tools/iso-atlas.cells.json`. Either it wasn't committed, or a later PR overwrote it with the old picks.

**Fix:**
1. Get your real exported `iso-atlas.cells.json` (the actual file, not a paste).
2. Merge it correctly: keep the MB1 `stack` entries for factory/depot, apply your terrain/road/industry `png` choices. Someone has to reconcile the two — they're both wanted.
3. **Respect C1's skirt rule** when choosing terrain — don't pick a 65px-skirt tile if the canonical is 49px.
4. `make-derived-art.mjs && parse-pnml.mjs && slice-atlas`, commit the atlas, G7 gate green.

**Acceptance:** every terrain/road/industry tile matches your Art Lab choices AND satisfies C1's skirt constraint; factory/depot stacks preserved; map renders flat with buildings flush.

---

## C3. Can't build roads
`[P0] [gameplay]`

**Symptom:** "I could not make any roads myself."

**Likely cause (needs the console tooling in C5 to confirm):** road build only starts if `canBuildOn(grid, tool, p.tx, p.ty, net)` passes, where `net` is your network (must be adjacent to your factory/harvester). Two candidates:
- The **pick is landing on the wrong tile** because of the C1 geometry bug — you click a buildable tile but `pick()` returns the tile behind/below it, which isn't network-adjacent, so the build is silently refused.
- Or the network seeding is wrong and no tile ever reads as adjacent.

The C1 fix may resolve this for free (correct geometry → correct pick → correct adjacency). Verify after C1: if picking is fixed and roads still can't be built, it's a network-adjacency bug and needs its own dig.

**Acceptance:** dragging from a tile adjacent to your factory/harvester builds road; the preview shows the affordable path; a toast explains any refusal (not silent).

---

## C4. Art Lab has missing/wrong images — slots you didn't choose
`[tooling] [assets]`

**Symptom:** "the art lab had a lot of missing things in the image list, like that harvester I did not choose."

Two separate issues:
- **Missing candidates:** the Art Lab's candidate grid is generated from a fixed count per folder. If a folder's real file count differs, some tiles are missing or some indices 404 (the earlier red-tile bug was this). Re-verify the exact file lists.
- **The harvester/depot you didn't choose:** the depot is a *stack* now (MB1), and the Art Lab's single-png picker can't represent or edit stacks — so it shows whatever the stack's base layer is, which looks like a choice you didn't make. The Art Lab needs the stack-editor follow-up (from the MB1 ticket) to handle depot/factory properly.

**Fix:** regenerate the Art Lab candidate lists from the actual folder contents (glob, don't assume counts); and either hide stacked slots from the single-png picker or build the stack editor so they're editable.

**Acceptance:** every candidate thumbnail loads (no missing/broken images); stacked building slots are either editable via a stack UI or clearly marked as stack-managed, not shown as a wrong single pick.

---

## C5. Add console commands for visual debugging
`[tooling]` — the human's suggestion, and a good one

> **✅ DONE 2026-09-05** (`arena/01a072d3-hexmatch`). All six suggested
> commands landed on `window.__iso` (`dumpTile`, `dumpAt`, `dumpBuilding`,
> `dumpNetwork`, `overlay`, `config`) plus a `probe` for the "why was my click
> refused" case; the overlay toggles paint on the map; the whole console is
> gated behind `import.meta.env.DEV || ?iso-debug=1` so a production build
> installs nothing; and it is documented in
> [`docs/iso-debug-console.md`](./iso-debug-console.md) with the
> screenshot→state workflow. It is pinned by `tests/unit/iso-debug.test.ts`
> (9 tests) against the real booted game.
> C1's premise is now *measurable* rather than arguable: `dumpTile().skirtDriftPx`
> is the per-tile block-depth drift (grass 067 measures **+16 px** against the
> canonical 50, water 066 measures 0), and `dumpBuilding().gapPx` is the hover
> in pixels — which is exactly what this ticket asked the tooling to produce.

So screenshots can be traced to state, add debug console commands exposed on `window.__iso` (the test hook already exists). When you paste a screenshot, these let the state behind it be dumped and compared.

Suggested commands:
- `__iso.dumpTile(tx, ty)` → the tile's terrain cell, sprite name, computed skirt, anchor, screen position, and what `pick()` returns for its centre. **Directly diagnoses C1/C3.**
- `__iso.dumpAt(screenX, screenY)` → which tile the picker resolves a screen point to (catches the wrong-tile-picked bug).
- `__iso.dumpBuilding(tx, ty)` → the building's stack layers, each layer's draw offset, and the gap (if any) between its foot and the tile surface. **Directly shows the hover.**
- `__iso.dumpNetwork(player)` → the set of tiles counted as that player's network (diagnoses C3's adjacency).
- `__iso.overlay('skirt'|'anchor'|'network'|'pick')` → toggle a debug overlay drawing these on the map, so a screenshot shows them.
- `__iso.config()` → dump the resolved cells.json entry for every on-screen sprite, so a screenshot can be matched to exactly which tiles are mapped.

Wire them behind the existing debug/env flag so they don't ship in production. Then a screenshot plus `__iso.dumpBuilding(tx,ty)` output tells us exactly where the geometry breaks, instead of guessing from pixels.

**Acceptance:** the commands exist on `window.__iso`, each returns/logs structured data, and the overlay toggles render on the map. Document them in `docs/` so the workflow is repeatable.

---

## Sequencing

**C1 → C5 → C2 → C3 → C4.**

- **C1** (skirt geometry) is the root cause of the hovering and probably the road-build failure. Fix it first.
- **C5** (console tools) right after — cheap, and it makes C2/C3 verifiable from screenshots instead of guesswork. Arguably do C5 *first* so C1 can be confirmed with the overlay.
- **C2** (apply config) once the skirt rule is settled, so terrain picks satisfy it.
- **C3** (roads) — retest after C1; may be fixed, may need a network dig.
- **C4** (Art Lab) — tooling cleanup, lower urgency.

## Note

C1 and C3 are likely the same root cause seen twice (bad geometry → bad picking → can't build). Fix C1, add C5's overlay, re-screenshot, and C3 may resolve. Don't fix them as separate blind changes — confirm with the console tools first.