# HexMatch — open backlog

Supersedes the E13–R9 list. Audited against this cut: `tsc --noEmit` clean, unit suite green, G1 pixel test **unchanged** after the G6 art swap, G7 atlas gate (`npm run slice-atlas` then `git diff --exit-code assets/iso-atlas/`) is the CI check.

**Landed this pass (work order E13 → G6 → G8 → E8 pass 2 → E11 → R9, E14 anytime): E13, E14, G6, G8, E8 pass 2, E11, R9.**

---

## Landed

### E13. CI runs e2e
`.github/workflows/ci.yml` has an `e2e` job: `npx playwright install --with-deps chromium` then `npx playwright test --project=desktop-chromium`, with the HTML report uploaded on failure. Desktop chromium is the PR check so the required job stays fast; `.github/workflows/e2e-nightly.yml` runs the full viewport matrix so G4/G5 mobile coverage is not dropped. Iso layout assertions run on every project (`iso-game.spec.ts` "iso layout on every viewport").

Branch protection still has to mark the `e2e` job required — that is a GitHub setting, not a file.

### E14. Tracked patch gone
`01a0664c-881a-7e2d-a962-ae437c7347a9.patch` removed. `*.patch` is in `.gitignore`. `tools/peek.mjs` is documented in the README tooling section (kept: it is the headless sprite inspector).

### G6. OpenGFX road/rail
`makeGenerated()` slices **one** half-piece per kind from `infra06.png` (spr1332 road / spr1012 rail, indices from the OpenGFX pnml), rotate/mirrors into four directions, overlays for all 16 masks. Grass is keyed out so the result is a transparent overlay. Half-pieces are clipped to the G1 centre→edge-midpoint segments (`TRACK_HALF_W = 5.2`) so adjacent tiles meet at the exact midpoint at consistent width.

A `crossing` sprite (spr1370, centre intersection) is emitted and `buildDrawList` draws it on tiles that carry both layers.

The G1 pixel test in `tests/unit/iso-atlas-pixels.test.ts` passes **unchanged**. Contact sheet regenerated (52 sprites).

### G8. Dark wedges
Re-captured an 8×8 of `terrain_grass_a` at 1× into the old 512×288 chunk surface and the padded surface (`docs/g8-chunk-before.png`, `docs/g8-chunk-after.png`).

Cause was (2), not (1) or (3): the easternmost tile of every chunk (`tx - ty` max) had its right 32px clipped because sprites are drawn at `+HW` relative to the origin while the canvas was exactly `16*HW` wide. Against `#0b1a26` that reads as a dark wedge at 8-tile intervals. `chunkSurfaceSize` now pads a full tile on both axes; the G8 unit test pins `drawX + 64 <= w`.

`terrain_grass_b` is a real grass variant (full diamond), not a field tile. It is slightly more olive; that is colour variation, not the wedge.

### E8 pass 2 — measurements, follow-ups filed
Pass 1 structure is unchanged (`VP_TARGET = 12`, `START_PURSE = { stone: 12, ore: 0 }`, `ore_mine` quota 5, rail `2 ore + 1 stone`). Across 80 seeds, distance from the land centroid to the nearest ore mine:

| | tiles |
|---|---|
| min | 0 |
| p50 | 10 |
| p90 | 17 |
| max | 24 |
| within 12 free setup tiles | 47 / 80 (59%) |

Once the free road lands, harvest is ~1 ore / 3s, so the first rail tile is **6 seconds** later. That is under a couple of minutes on a majority of maps — the road-vs-rail decision collapses into a menu. Follow-ups below, one lever each.

### E11. Hex path deleted
Removed `src/game/hexmap.ts`, `src/map3d/MapView3D.ts`, `src/game/main-legacy.ts`, the `?legacy=1` branch, `three` / `@types/three`, the legacy `.jpg` terrain textures (they were imported from `src/game/config.ts` and leaked into the iso bundle), and the hex-only modules that only the legacy boot touched (`board.ts`, `actions.ts`, `ai.ts`, `ui.ts`, `net.ts`, `lobby.ts`, `state.ts`, `trade.ts`, `styles.css`). Legacy Playwright specs (`touch-camera.spec.ts`, `smoke.spec.ts`, `markers.spec.ts`, `mobile.spec.ts`, `helpers.ts`) went with it. Iso layout e2e covers the mobile viewports those T2 snapshots used to.

### R9. OpenGFX tree pruned
`src/assets/sprites/` 19 MB → 5.6 MB. Kept `png/terrain/`, `industries/`, `infrastructure/`, `landscape/`, `trees/temperate/`, `miscellaneous/`, `stations/`. Cross-checked against `tools/iso-atlas.cells.json`; `npm run slice-atlas` still reproduces the atlas.

OpenGFX attribution remains in the README.

---

# Open

## E8a. First rail arrives in six seconds — raise rail's ore cost
`[design] [gameplay]`

59% of maps put an ore mine inside the 12-tile free-setup allowance. Harvest then produces the 2 ore a rail tile costs in two 3s ticks. Raise `TRANSPORT.rail.cost.ore` from 2 to 4 (or 5) so the first rail is a stockpile decision, not an afterthought. Do not touch quota or `VP_TARGET` in this ticket.

**Acceptance:** time-to-first-rail-tile after connecting an ore mine is ≥ ~30s of harvest at 1.0×. Existing economy tests that hard-code `cost.ore === 2` are updated.

## E8b. Give road a late-game niche besides `onRough`
`[design] [gameplay]`

Rail's 1.6× throughput *and* 3 VP still make road strictly obsolete once ore flows. `onRough: true` is already the data lever — it is invisible. Either surface it in the drag cost readout ("rough: road only") or give road a second niche (cheaper repair, faster build, or a 1.0× that's enough for grain/wood while rail is reserved for ore/gold). One change, not both.

## E8c. Is `VP_TARGET = 12` the length you want?
`[design] [gameplay]`

Road connections are 1 VP, rail 3. Twelve points is four rail links or twelve road links. After E8a the game will run longer; re-time a 2p vs AI game and move the target in isolation (suggest 18 if a round is currently < 10 minutes, 9 if it drags past 25).

## E13 follow-up. Mark the `e2e` CI job required
`[chore]`

The job exists. GitHub branch protection on `main` still has to tick it as a required status check so a red e2e run blocks merge.
