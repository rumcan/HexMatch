# K-FIX-2 — Re-pick road tiles as FLAT roads, not embankment pieces

**Status:** FIXED — 2026-09-06, on `arena/01a076ea-hexmatch`.
**Filed:** `docs/HexMatch-open-backlog.md`, P0, `[assets]`.
**Area:** `tools/iso-atlas.cells.json` (the 16 `road_XXXX` cells),
`tools/make-derived-art.mjs` (the crossing's base road).

---

## What was wrong

The shipped road set (`082 / 074 / 125 / 090` and the rest) are Kenney pieces
with **raised retaining walls baked in** — roads on embankments. They read as
raised next to grass because they *are* raised: the wall geometry sits above
the tile's ground plane. K-FIX-1 fixes where a tile is drawn; it cannot make an
embankment tile flat, so this is a tile-choice fix and was done independently.

## The new set

All sixteen masks are flush streets — asphalt level with the grass, kerb line
only, nothing above the ground plane:

| mask | tile | mask | tile |
|---|---|---|---|
| `0000` | `081` | `1001` | `122` |
| `0001` | `117` | `0101` | `082` |
| `0010` | `105` | `1010` | `074` |
| `0100` | `111` | `0111` | `096` |
| `1000` | `112` | `1110` | `097` |
| `0011` | `118` | `1101` | `089` |
| `0110` | `114` | `1011` | `104` |
| `1100` | `119` | `1111` | `090` |

Eleven of the sixteen changed. The two straights stay `082`/`074` (they were
already flat and already the arm-verified perpendicular pair — the 90° bug
guard is untouched), and `081`/`089`/`090` were already flat. The old dead-end
stubs (`105/039/047/024`), corners (`125/123/126/110`) and T-junctions
(`089/038/121/116`) are replaced: those were the embankment and trench pieces.
`tools/make-derived-art.mjs` also draws the rail/road `crossing` over the flat
crossroads (`090`) instead of the walled `102`.

## How the picks were made

Every flat-topped landscape tile (91 of the 128) was measured for asphalt
coverage on its top surface, then each candidate's **arm signature** was
sampled at the four diamond edge midpoints (NE/SE/SW/NW) to read off the mask
it actually draws — so a tile is assigned to the mask its pixels support, not
to the mask someone hoped it had. Candidates with any geometry above the ground
plane were rejected. The survivors were then rendered as a connected road
network beside the old set for a side-by-side eyeball.

## Acceptance

1. ✅ **Roads render flush with terrain, no embankment walls.** Measured, not
   asserted by filename: `iso-atlas-pixels.test.ts` → *"no road tile has
   raised sidewalls / embankment walls"* reconstructs each tile's ground plane
   (`y = 33 − 32·(1 − |x−cx|/66)`) and counts opaque pixels above it. A flat
   street has a handful of antialiased apex pixels; every rejected embankment
   piece has hundreds. Threshold: `< 30`.
2. ✅ **Road tiles match the reviewed flat-road set** — the full 16-entry table
   is pinned in `iso-atlas-pixels.test.ts` (*"uses the flat-street road
   selections (K-FIX-2)"*), including a distinctness check so no mask can
   silently fall back to the crossroads.
3. ✅ **Straight + corner + crossroads all sit flat and connect.** The existing
   arm-verification test (asphalt crosses every set arm and no unset arm)
   passes over the whole new set unchanged, so connectivity is preserved; the
   new *"every road tile is a flat block sharing the terrain's ground line"*
   test asserts each road's ground line matches grass to within a pixel **and**
   that it kept its native skirt (`> 40px`) rather than being cropped flat.
4. ✅ `docs/kenney-k2-roads.png` regenerated: all 16 masks, the L-bend
   90°-eyeball in both diagonals, and rail + crossing — all flush.
5. ✅ 390 unit tests pass; typecheck clean; lint 0 errors.

## Verified the tests actually bite

Reverting `tools/iso-atlas.cells.json` to the old road picks fails **3** tests
(the selection table, the raised-sidewall measurement, and the ground-line
check), and restoring the new set makes them pass.

## Not covered

No browser in the sandbox, so `npm run test:e2e` was not run.
