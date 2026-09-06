# HexMatch — the documented Kenney isometric method (this replaces the skirt-normalisation approach)

> **Status: both tickets below are CLOSED (2026-09-06).** The backlog is empty.
> The research and rationale are kept here as the standing reference for how
> Kenney art is placed in this repo; the implementation notes, acceptance and
> test-bite evidence live in `docs/tickets/K-FIX-1-*.md` and `K-FIX-2-*.md`.

I researched how Kenney's isometric tiles are *meant* to be placed. The sources below show the current approach (normalising skirt heights) is **fighting the format**. Kenney tiles are designed to be different heights — you anchor them at the **bottom** and let them grow upward. That's the whole trick, and it's what every hovering/slicing/stepping bug has been working around instead of using.

## Sources

1. **Kenney's official documentation** — "Importing 3D models into game engines" (kenney.nl/knowledge-base/game-assets-3d), the *Isometric renders* section, gives the exact placement rule:
   > A flat single tile is `128 × 64`. The transparent pixels around each tile are **margin for larger tiles, or tiles that don't fit within the usual tile size.** Set the drawing **offset to X: -192, Y: 170**; set tile width/height to `128 × 64`.

   The key idea: every tile sits in a larger transparent canvas, and a **single fixed drawing offset** positions them all. Taller tiles occupy more of the canvas upward; the offset is constant. You do **not** resize or crop tiles to match.

2. **PIXI isometric tutorial using Kenney road tiles** (peepsquest/tutorials) — describes *your exact bug* and its fix:
   > "Tiles with height (z-direction) seem to **float** as they are drawn from the top instead of the bottom. Ooops! The fix is to draw tiles from the **bottom-left**."

   It sets the sprite anchor to bottom (`anchor.y = 1`) so a tile of any height sits correctly on the ground. Flat and tall tiles share one bottom anchor line.

3. **Unity isometric tilemap docs** — confirms the projection: dimetric, cell `(1, 0.5, 1)`, and "Isometric Z as Y" — a tile's height is added to its Y so taller tiles offset upward from the same base cell. Same principle: height grows up from a fixed floor.

## What this means for HexMatch

**The skirt-normalisation in PR #24 was the wrong fix.** Cropping every tile's skirt to 50px forces all tiles to one height — which fights Kenney's design (tiles are *meant* to vary) and broke the stacked-building anchors (PR #24's regression). The documented method is the opposite: **keep every tile its native height, anchor them all at the bottom.**

### The correct rule

- Every sprite is positioned so its **bottom-centre** lands on the tile's screen position (the diamond's south point on the ground plane).
- A flat tile and a tall building share the **same bottom anchor** — the building simply extends further up the screen. No height normalisation, no per-tile skirt offset.
- In HexMatch's terms: `anchor` should be the **bottom-centre pixel** of the sprite (`[floor(w/2), h-1]` region, at the tile's south point), NOT the widest row. The renderer draws at `screenY - (h - bottomAnchorOffset)`.

This is why a stacked building broke: normalisation moved the widest row but the composite anchor still pointed at the old spot. If the anchor were **bottom-based**, stacking would just work — each layer's bottom sits on the layer below, and the whole stack's bottom sits on the tile.

---

## K-FIX-1. Switch to bottom-anchor placement; remove skirt normalisation
`[P0] [renderer] [assets]` — **DONE 2026-09-06** (`arena/01a076ea-hexmatch`).
See [docs/tickets/K-FIX-1-bottom-anchor-placement.md](tickets/K-FIX-1-bottom-anchor-placement.md).

**Replace the skirt-normalisation approach with Kenney's documented bottom-anchor method.**

1. **Stop normalising skirts.** Remove `normaliseSkirt` from `tools/slice-atlas.mjs`. Keep every Kenney tile its native size — the transparent margin around each tile is intentional (Kenney's docs: "margin for larger tiles").

2. **Anchor every sprite at bottom-centre.** In the packer, compute each sprite's anchor as the point that sits on the tile's ground position — the **bottom-centre of the diamond**, not the widest row. For a flat tile that's near the bottom of the canvas; for a tall building it's the same relative point on its base. Concretely: the anchor is where the tile's south corner (the bottom vertex of the ground diamond) sits in the sprite's pixels.

3. **One consistent ground reference.** Kenney tiles all share the same diamond footprint (128×64 canonical; 132×66 here) at a **fixed position within their canvas** — the bottom. Find that shared bottom line once; every sprite anchors to it. A flat grass tile and a 6-storey tower both have their diamond base at that line.

4. **Verify with the C5 console** (already built): `dumpTile().skirtDriftPx` and `dumpBuilding().gapPx` should be 0 — but now because everything shares a bottom anchor, not because heights were forced equal.

**Acceptance:**
- No `normaliseSkirt` / height-forcing in the pipeline; tiles keep native size.
- Flat terrain (grass, water, rough) sits coplanar — adjacent tiles share the ground line, no stepping.
- Single AND stacked buildings sit flush on their tile, base not clipped (`gapPx === 0` for factory and depot).
- The manifest invariant: every sprite's anchor is its bottom-centre ground point; stacked composite anchor = base layer's bottom, same as a single tile.
- Screenshot confirms: grass/water flush, buildings seated, no slicing.

**Reference the sources above in the PR** so the reviewer can confirm the method matches Kenney's own docs.

---

## K-FIX-2. Re-pick road tiles as FLAT roads, not embankment pieces
`[P0] [assets]` — **DONE 2026-09-06** (`arena/01a076ea-hexmatch`).
See [docs/tickets/K-FIX-2-flat-road-tiles.md](tickets/K-FIX-2-flat-road-tiles.md).

Independent of the anchor fix. The current road tiles (`082/074/125/090`) are Kenney pieces with **raised retaining walls baked in** — roads on embankments. Kenney's set also has flat street tiles. Apply the human's Art Lab road choices (flat streets), and when picking, use the road preview to reject any tile with raised sidewalls — pick tiles whose asphalt is flush with the ground surface.

Once K-FIX-1 lands (bottom anchor), a flat road tile will sit correctly coplanar with grass. An embankment tile will still look raised because it *is* — so this is a tile-choice fix, not a geometry one.

**Acceptance:** roads render flush with terrain, no embankment walls; road tiles match the human's flat-road Art Lab picks; straight + corner + crossroads all sit flat and connect.

---

## Why this is the right fix and normalisation wasn't

| | Skirt normalisation (PR #24) | Bottom anchor (Kenney's docs) |
|---|---|---|
| Tile heights | forced equal (crop skirts) | kept native (as designed) |
| Stacked buildings | broke (anchor not recomputed) | work naturally (bottom stacks on bottom) |
| Matches Kenney docs | no — fights the margin design | yes — "draw from the bottom" |
| Tall buildings | must special-case | just extend upward, same anchor |
| Future tiles | must be re-normalised | drop in, anchored at bottom |

The documented method is less code and can't produce the hovering/slicing class of bug, because a bottom-anchored sprite of any height always sits on the floor by construction.

## One-line summary for the agent

> Research shows Kenney iso tiles are designed to be different heights and anchored at the BOTTOM (kenney.nl 3D-import docs: fixed drawing offset, tiles grow upward into transparent margin; PIXI/Kenney tutorial: "tiles float because drawn from the top — fix is draw from the bottom"). Remove PR #24's skirt normalisation, anchor every sprite (flat, tall, stacked) at its bottom-centre ground point instead of its widest row. Separately, re-pick the road tiles as flat streets, not embankment pieces.