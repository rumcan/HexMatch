# N4 — The building base must occupy the exact tile the cursor highlights

**Status:** FIXED — 2026-09-06, on `arena/01a07734-hexmatch` (this PR). One
tile→screen convention; the `+HH` fudge is gone.
See [Resolution](#resolution-2026-09-06).
**Filed:** `docs/HexMatch-open-backlog.md` (ADDENDUM), P0, `[renderer]`.
**Area:** `src/iso/renderer.ts` (`flatPick`), `src/game/config.ts` /
`src/iso/camera.ts` / `src/iso/game.ts` (stale convention comments),
`src/iso/debug.ts` (the `pick` overlay), `src/iso/depth.ts` (clip-aware
stage-2 pick).

---

## The bug (from the backlog, confirmed in code)

Drawing and picking used two conflicting conventions:

- **Drawing**: a tile's diamond is **centred** on `tileToScreen(tx,ty)`
  (the K0 anchor row lands there by construction).
- **Picking** (`flatPick`): the pick cell's **top vertex** sat on
  `tileToScreen(tx,ty)` — HH (32px) away from the drawn diamond — and the
  helper sampled HH below the cursor (`(wy + HH) / HH`) to paper over the
  gap. A tuned fudge, exactly as the ticket said: correct for flat ground by
  luck of the arithmetic, and one convention more than a codebase should own.

## What changed

| file | change |
|------|--------|
| `src/iso/renderer.ts` | `flatPick` is now the exact inverse of the DRAWN lattice: with `a = wx/HW`, `b = wy/HH`, the point lies in the drawn diamond of `(i,j)` iff `|a−(i−j)| + |b−(i+j)| ≤ 1`, and `floor((a+b+1)/2), floor((b−a+1)/2)` returns that tile. No sampled offset, no second lattice, no fudge. (For the record: the old `+HH` sample simplified to the very same floors — the old helper was accidentally the correct inverse. N4's value is that the code now SAYS one convention and proves it, instead of expressing it through a compensation the next art change could silently invalidate.) |
| `src/iso/depth.ts` | stage-2 picking agrees with the N1 brush: a clipped (interior) sprite is never hit in its undrawn skirt (`aboveGroundAt`), so `pick()` returns the tile the eye sees — the building's footprint diamond, never the phantom skirt behind it. |
| `src/game/config.ts`, `src/iso/camera.ts`, `src/iso/game.ts` | the "pick cell top vertex / sample HH below" comments are rewritten to the single convention; `screenToTile` is documented as the lattice-cell decomposition used for camera culling bounds only; `__iso.tileScreenAt` documents that clicking its point hits that tile. |
| `src/iso/debug.ts` | the `pick` overlay drew the drawn diamond in white and the pick cell HH below in magenta ("the K4 half-tile offset, visible at last"). Under one convention they coincide, so the overlay now draws the pick cell as a dashed magenta outline on the SAME spot — a visible offset is a regression flag. Doc updated in `docs/iso-debug-console.md`. |
| `tests/unit/iso-skirt.test.ts` | N4 section: `flatPick(p)`'s answer's DRAWN diamond contains p, sampled widely over centres and seams; round-trips all 1024 tile centres and stays put a hair inside each vertex; stage-2 pick ignores undrawn skirts (clipped farm → null below the S vertex; unclipped farm → hit; tower and top face still hit). |

## Acceptance (the ticket's, verbatim)

1. ✅ **One convention** — `flatPick` is the closed-form inverse of the drawn
   lattice (asserted by containment, not by re-derivation, over 700 sampled
   points including seams), and the `+HH` compensation is deleted.
2. ✅ **Highlight = base = pick()** — the highlight is placed from
   `renderer.pick()`'s tile (`game.ts` `overlayItems`), the building is placed
   on the same `pick()` result (the setup click path), and stage-1 flat
   picking now returns exactly the tile whose drawn diamond is under the
   cursor at every zoom. The iso-game suite boots the real game and drives
   real `placeFactory`/drag flows through the same `pick` path.
3. ✅ **Hover a placed building** — the sprite pick returns the building's own
   tile (and never its undrawn skirt), so the highlight under the cursor is
   the diamond the building stands on.
4. ✅ **408 unit tests pass**; typecheck clean; lint 0 errors (warnings
   unchanged from `main`). The existing K4 flat-pick tests passed UNCHANGED —
   they pinned the behaviour (picks the visible diamond), which is the point.

## Verified the tests actually bite

Deleting the skirt-awareness from `pickSprite` (stage 2 hitting undrawn
skirts again) fails the N4 stage-2 pick tests (1 file, the clipped-farm
cases) and restoring it makes them green. The flatPick tests pin the drawn
lattice by containment, so any future off-by-one in the inverse fails them
regardless of how it is expressed.

## Not covered

No browser in the sandbox, so the pixel-level "hover → highlight → place →
re-hover" loop was not driven in real Chromium (`npm run test:e2e`); see the
N1 ticket's note. The jsdom iso-game suite covers the same logic through the
real hook.
