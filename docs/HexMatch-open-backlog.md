# HexMatch — open backlog

Supersedes `HexMatch-open-backlog-v3.md`. Audited against `main` @ `3efbee1` (PR #7 merged): `tsc --noEmit` clean, 208 unit tests passing across 14 files.

**Work order: X1 → X2 → X3 → X4 → X5 → E8a/b/c.**

X1 is a severe regression and everything else should wait on the decision it forces.

---

## X0. Your e2e run — just missing browser binaries
`[support]` — not a bug

```
Executable doesn't exist at ...chromium_headless_shell-1234\chrome-headless-shell.exe
```

Playwright is installed but its browsers aren't. One command:

```
npx playwright install chromium
```

Then `npm run test:e2e` again. Nothing in the repo is wrong — the 6 failures and 6 skips are all this single cause.

---

## X1. E11 deleted the match-3 board, trading, multiplayer and the whole UI layer
`[bug] [P0] [regression] [blocker]`

**This is why "the original game interface with the match 3 isn't in this game at all."** It isn't hidden or unwired — the source files are gone.

`src/game/` went from 12 files to 1. Deleted in the E11 commit:

| File | What it was | Status in iso |
|---|---|---|
| `board.ts` (15 KB) | **the match-3 quarry board** — the core harvesting loop | no replacement |
| `trade.ts` | player-to-player cargo trading | no replacement |
| `net.ts` (10 KB) | multiplayer relay client | partial — `iso/snapshot.ts` only |
| `lobby.ts` | room create/join UI | no replacement |
| `ui.ts` | panels, banners, resource chips | partial — inline in `iso/game.ts` |
| `actions.ts`, `state.ts` | action dispatch, game state | folded into `iso/game.ts` |

The migration spec was explicit that these survive:

> **Survives untouched:** `board.ts` (match-3 quarry), `trade.ts`, `net.ts`, `lobby.ts`, most of `ui.ts`, `state.ts` — roughly 40% of `src/game`.

E11's scope was `hexmap.ts`, `MapView3D.ts`, the `.jpg` textures and `three`. It was executed as "delete everything hex-era" instead. **E9 (UI port) was never done**, so there was nothing on the iso side to receive the match-3 board when its source was removed.

The unit count dropping 242 → 208 is the same event: 34 tests went with `board.test.ts` and `trade.test.ts`.

Without the board there is no harvesting mechanic. The current build is a road-laying sandbox where cargo appears on a timer.

**Recovery.** The files are in git history — nothing is lost. Restore from the commit before the E11 merge:

```bash
git log --oneline --all -- src/game/board.ts     # find last commit containing it
git checkout <sha>^ -- src/game/board.ts src/game/trade.ts src/game/net.ts \
                       src/game/lobby.ts src/game/ui.ts src/game/state.ts \
                       src/game/actions.ts src/game/styles.css
git checkout <sha>^ -- tests/unit/board.test.ts tests/unit/trade.test.ts
```

Restore `board.ts`, `trade.ts` and their tests **first and unmodified** — they were designed to be map-agnostic and should compile against the iso build with little or no change. `ui.ts`, `lobby.ts` and `net.ts` need review, since parts of them reference hex concepts.

**Acceptance**
- The match-3 quarry board renders and is playable in the iso game.
- Matching gems credits the six iso cargoes (`grain, wood, ore, stone, oil, gold`), gated by which industries the player's network actually reaches — this is the E6 catchment wired to the board.
- Trading panel works.
- `board.test.ts` and `trade.test.ts` restored and green; unit count back above 240.

**Do not attempt any further E11 cleanup until this is resolved.**

---

## X2. Grass variant hash produces diagonal stripes, not noise
`[bug] [renderer]`

**This is the "weird pattern" in the grass.** `src/iso/renderer.ts:55`:

```ts
return ((tx * 7 + ty * 13) & 3) === 0 ? "terrain_grass_b" : "terrain_grass_a";
```

Any linear function of `tx` and `ty` taken mod a small number produces a regular lattice, not noise. Printing it makes the failure obvious:

```
B...B...B...B...
.B...B...B...B..
..B...B...B...B.
...B...B...B...B
```

Every `grass_b` tile sits on a perfect diagonal, period 4. In isometric projection a tile-space diagonal maps to a **straight vertical column on screen** — which is exactly the vertical banding running down the whole map in the wide screenshot. G8's chunk-clip fix was a real and separate bug; this one was never the chunk cache.

**Fix:** use a proper integer hash so neighbouring tiles decorrelate:

```ts
function tileHash(tx: number, ty: number): number {
  let h = (tx * 0x1f1f1f1f) ^ (ty * 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 13), 0x297a2d39);
  return (h ^ (h >>> 16)) >>> 0;
}
// ...
return (tileHash(tx, ty) & 7) === 0 ? "terrain_grass_b" : "terrain_grass_a";
```

Also consider whether `grass_b` should be used at all at its current frequency — it reads noticeably more olive than `grass_a`, so even randomly scattered it will look patchy. A ratio nearer 1-in-8 than 1-in-4 is a better starting point.

**Acceptance**
- Unit test: over a 48×48 grid, the set of `grass_b` tiles has no row, column or diagonal with more than a small multiple of the expected count. A lattice fails this; noise passes.
- Screenshot at full map zoom shows no visible banding.

---

## X3. Factory and ore-mine crops span several unrelated source sprites
`[bug] [P0] [assets]`

**This is the "buildings are broken" complaint.** Rendering `factory_blue` straight from `atlas@1x.png` shows it is not one building: it's a chimney pair, a separate shed, a crane, a grey slab and a brick block, scattered with gaps — several distinct OpenGFX sprite boxes captured in one 192×192 crop.

`ore_mine` has identical dimensions and anchor (`192×192`, anchor `[96,176]`), which strongly suggests the same wrong region, or a copy-paste of the same crop rectangle.

The cell definitions in `tools/iso-atlas.cells.json` are grabbing a rectangle of the source *sheet* rather than a single sprite box within it.

**Fix:** re-derive the crop for each from the blue-box bounds of the intended sprite, the same way the working sprites (`farm`, `depot`) were done. `tools/peek.mjs` exists precisely for this — use it to locate the correct box before editing the cell.

**Also check `oil_rig`:** it is `768×160` for a 2×2 footprint. That is 6 × 128 px, i.e. the whole animation strip stored as one sprite. If the manifest doesn't carry `frames: 6` with a per-frame width, the renderer will draw all six frames at once as a 12-tile-wide smear.

**Acceptance**
- Every building sprite is one contiguous structure — verify on the contact sheet, and by rendering each over a flat green background to expose stray fragments.
- No two different sprites share identical crop rectangles.
- `oil_rig` either declares its frames properly or is cut to a single frame.
- Sprite width ≤ footprint width × 64 plus a small overhang, asserted in the manifest test. A 2×2 sprite at 768px wide should have failed automatically.

---

## X4. Road arms stop 1px short of the tile edge
`[bug] [assets]`

**This is "the roads don't reach the end of the tile."** Measuring painted pixels in `road_1111`: the bounding box is x 14–49, y 8–23. The SE and SW arm endpoints are at y = 24, so the paint stops one row short, and the arms taper as they approach the edge because `clipArm()` uses a fixed `TRACK_HALF_W = 5.2` distance from the centre→endpoint segment, which rounds down at the extreme.

Result is a visible gap at every tile join — the dashed, disconnected look in the close-up screenshot.

Note the G1 pixel test still passes: it asserts paint exists *within 2px* of each midpoint, which a 1px shortfall satisfies. The test was written to catch wrong directions, and it did its job; it was never meant to catch short arms.

**Fix:** extend each arm to the edge by clipping against the diamond boundary rather than stopping at the midpoint — run the segment 1–2px past the endpoint and let `inDiamond()` trim it. Confirm the arm's half-width is constant right up to the edge so two adjacent tiles present the same road width.

**Acceptance**
- New test: for each set bit, painted pixels exist **at** the exact edge midpoint, not merely near it.
- New test: two adjacent tiles composited at their real screen offsets show a continuous run with no transparent column at the join. This is the assertion that actually encodes what the player sees.
- Arm width at the edge is within 1px of arm width at the centre.

---

## X5. Manifest test should have caught X3 and X4
`[testing]`

Three of the four defects above were invisible to a green suite. Add cheap invariants to `tests/unit/iso-manifest.test.ts`:

- Sprite width ≤ `footprint[0] * 64 + 32`, height ≤ `footprint[1] * 32 + 160`. Catches the 768px oil rig.
- No two sprites share an identical `{x,y,w,h}` unless they're declared tints of one another. Catches duplicated crops.
- For each generated road/rail mask, paint exists at the exact edge midpoint of every set bit (X4) and nowhere near unset bits (existing G1 check).
- Terrain variant selection over a 48×48 grid has no axis-aligned or diagonal run longer than a threshold (X2).

---

## E8a / E8b / E8c — economy follow-ups
`[design] [gameplay]`

Filed from the pass-2 measurements (across 80 seeds: land-centroid → nearest ore p50 = 10 tiles, 59% within the 12 free-setup tiles, first rail ~6s after the free road lands). The data confirms the concern from the last review — rail is reachable almost immediately, so the road-vs-rail choice isn't currently a decision.

- **E8a** — raise `TRANSPORT.rail.cost.ore` from 2 to 4 so first rail is a stockpiling decision.
- **E8b** — give road a visible late-game niche beyond `onRough`.
- **E8c** — re-time `VP_TARGET = 12` after E8a lands.

Hold all three until X1 is resolved. Rebalancing an economy whose primary harvesting mechanic is missing will produce numbers you have to throw away.

---

## E13 follow-up — mark the e2e job required
`[chore]`

The `e2e` workflow exists and runs on PRs, but branch protection has to mark it required. That's a GitHub repo setting, not a file — Settings → Branches → branch protection rule for `main` → Require status checks → select `e2e`.