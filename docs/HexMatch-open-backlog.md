# HexMatch — brown only at the map edge (the real geometry rule)

Audited against `main` @ `e5f3b8e`. Your spec — **"never see brown at the base of any road or building; brown only at the very edge of the map"** — is exactly the correct isometric look, and it pinpoints the real bug. This supersedes the anchor tickets: the anchor is a symptom, this is the cause.

---

## What the brown is, and why it shows everywhere

Every Kenney tile is a diamond **top** plus a cube **skirt** below it. The skirt's bottom band is brown dirt (measured: grass tile is green to y≈60, shaded green to y≈80, then **brown `rgb(128,95,62)` at y90–97**). That brown is the bottom of every tile's block.

The map is drawn back-to-front, so each tile covers the one behind it — but the geometry doesn't line up:

```
Adjacent tiles are HH = 32px apart vertically on screen.
Each tile's skirt is BLOCK_H = 50px tall.
→ 50 − 32 = 18px of skirt pokes out below the covering tile.
```

So **every interior tile leaks 18px of brown skirt** below the tile in front of it. That's the brown at the base of every road and building. It's not an anchor bug — it's that the skirt is taller than the vertical gap between tiles, so it can never be fully hidden by the neighbour.

---

## N1. Interior tiles show no skirt; only map-edge tiles draw the full block
`[P0] [renderer]`

**The rule:** a tile's brown skirt should only be visible where there is **no tile in front of it** — i.e. the front/outer edge of the island. Every interior tile's skirt must be fully covered.

Two ways to achieve it. **Approach A is cleaner and matches how flat iso maps normally work.**

### Approach A — draw the ground as a flat surface, skirt only on the border

- Render interior tiles as **just the diamond top** (no skirt) — a flat tessellating surface with zero brown. Since every tile's top diamond exactly abuts its neighbours, a field of tops is a seamless ground plane.
- For **edge tiles** (a tile with water or empty in front of it, toward the bottom of the screen), draw the full block including the brown skirt, so the island has a visible thickness at its coastline.
- "Edge" = any tile whose SE and/or SW neighbour (the two that would cover its skirt) is water or off-map. Those are the only tiles that should show brown.

This needs the packer to keep the diamond-top and the skirt as separable, OR the renderer to clip interior tiles to their diamond top (draw only y ≤ groundRow + a hair) and draw edge tiles in full.

### Approach B — shrink the skirt to the vertical gap

- Crop every tile's skirt to exactly `HH = 32px` (the tile spacing) instead of 50px. Then a tile's skirt reaches precisely to the next tile's top and is fully covered — no leak. Edge tiles still show their (now 32px) skirt as the island thickness.
- Simpler (one crop in the packer), but the island's edge is thinner and every tile still carries a skirt; if the vertical spacing ever changes, the leak returns. Approach A is more robust.

**Recommend A.** It gives a clean flat ground and a proper thick coastline, and it's the standard isometric approach (flat tiles interior, blocks at the rim).

### Buildings and roads

Same rule applies. A building/road tile's own skirt must not show — the building sits on the flat ground plane, and the ground tile under/around it provides the (hidden) thickness. Once interior ground tiles stop leaking skirt, roads and buildings won't have brown at their base either, because there's no exposed skirt anywhere except the coast.

**Acceptance:**
- No brown anywhere on the interior of the map — grass/road/building bases all sit on a flat continuous surface.
- Brown (island thickness) appears **only** at the outer edge, where tiles face water or the void.
- Screenshot: a road crossing the interior shows no brown at its edges; the island's coastline shows the brown block side.
- A test: for a fully-interior tile (all four neighbours land), the rendered output has zero brown-range pixels below its diamond.

---

## N2. This also fixes the "hovering building" and "elevated road"
`[P0]` — folds in the prior anchor/road tickets

The hover gap and the elevated-looking roads are the **same brown-skirt problem** seen differently:

- **Hovering building:** you see the tile's diamond "under" the building because the building's skirt (brown) is leaking below where the ground tile covers it — the diamond peeking out is the exposed skirt band. Fix N1 and there's no exposed skirt to see.
- **Elevated road:** the road looks raised because its brown skirt shows on all sides, reading as a kerb/embankment. With N1 (no interior skirt), the road surface sits flush on the flat ground.

So N1 is the root fix for all three complaints (brown, hover, elevation). The separate anchor ticket (R1) is still worth doing for correctness of *tall stacked* buildings — a 5-storey factory's base must still land on the right tile — but N1 is what removes the brown.

**Verify all three in one screenshot:** interior road with no brown and flush surface; building sitting flush with no diamond peeking under it; coastline showing brown thickness.

---

## N3. Gold match-3 change (unchanged from prior ticket, separate PR)
`[feature]`

Restating so it's not lost: gold becomes its own colour matching only gold (remove wild behaviour); gold gems spawn only when a harvester is connected to a gold mine (join the existing network-reach gate in `quarry.ts`); spawn mechanic (replacing other gems) unchanged. Board logic — its own PR, after the rendering fix.

---

## Sequencing

**N1 → N2 verify → R1 (tall-stack anchor) → N3 (gold).**

N1 is the one fix that resolves the brown, the hover, and the elevation together — because they're all the exposed-skirt problem. Do it, screenshot the interior (no brown) and the coast (brown), and the visual complaints that have dogged this for many rounds are finally closed. R1 remains only for tall stacked buildings landing on the correct tile. N3 is the separate gold feature.

## The one-line rule for the agent

> A tile's brown skirt is 50px but tiles are only 32px apart on screen, so every interior tile leaks 18px of brown below its neighbour. Fix: interior tiles render as flat diamond tops only (no skirt); draw the full brown block ONLY on tiles at the island edge (SE/SW neighbour is water or off-map). Brown appears only at the coastline, never under a road or building.

---

# ADDENDUM — the building must sit ON the highlighted diamond (explicit)

Your screenshot shows a **second, distinct bug** the tickets above did NOT state clearly. This is not the brown skirt — even with N1's brown gone, this would remain.

## The bug: draw and pick use two different tile conventions

There are two conflicting tile→screen conventions in the codebase (confirmed in code):

- **Drawing** (`renderer.ts` ~line 244): a tile's diamond is **centred** on `tileToScreen(tx,ty)`.
- **Picking** (`flatPick`, `renderer.ts` line 362): the pick cell's **top vertex** is at `tileToScreen(tx,ty)` — offset by `HH` (32px) from the draw convention.

`flatPick` patches over the gap with a `+HH` fudge (`b = (wy + HH) / HH`). That fudge is tuned for flat ground, so it does not hold for a building's placement highlight. Result, exactly as in your screenshot: **the yellow highlight diamond is one tile away from where the building's base is drawn.** The cursor lights up one diamond; the building sits on a different one.

## N4. The building base must occupy the exact tile the cursor highlights
`[P0] [renderer]`

**Acceptance — state it exactly like this, because it's what the screenshot shows:**

- When the cursor is over tile (tx,ty), the placement highlight diamond, the building's base footprint, and `pick()`'s returned tile must all be the **same** (tx,ty). No HH offset between any of them.
- Concretely: the base of a placed building sits **on the highlighted diamond** — the diamond the mouse lights up is the diamond the building's foot occupies, not the tile behind or in front of it.
- The real fix is to make drawing and picking use **one** tile→screen convention, and delete the `+HH` compensation in `flatPick`. Either the diamond is centred on the lattice point and picking matches that, or the diamond's top vertex is the lattice point and drawing matches that — but both must agree, with no fudge factor.

**Verify (the screenshot test):** hover a tile, note the highlighted diamond, place the building — its base covers that exact diamond. Then hover a placed building: the highlight under the cursor is the same diamond the building stands on. If the highlight and the base are ever a tile apart, it's not fixed.

**Why this matters beyond looks:** if the highlight and the real placement tile differ, the player builds on the wrong tile — roads connect to the wrong place, harvesters land off the industry. This is a gameplay-correctness bug, not just visual.

## Relationship to the other fixes

- **N1** removes the brown skirt.
- **N4** puts the building on the correct (highlighted) tile.
- **R1** makes tall stacked buildings anchor on their base tile.

All three must hold together for the final result: a building with no brown, sitting flush **on the diamond the cursor highlights**. Verify all three in one hover-and-place screenshot.

## One-line rule for the agent

> Drawing centres a tile's diamond on tileToScreen; picking puts the diamond's top vertex there — a 32px (HH) mismatch that flatPick papers over with +HH. Unify them to ONE convention and delete the fudge, so the highlighted diamond, the building's base, and pick() are always the same tile. The building must sit ON the diamond the cursor lights up.