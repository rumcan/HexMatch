# HexMatch — open backlog

Supersedes `HexMatch-open-backlog-v2.md`. Audited against `main` @ `a265fc9` (PR #6 merged): `npm ci`, `tsc --noEmit` clean, **242 unit tests passing** across 17 files, **76 e2e tests registered** across 5 files.

**Work order: E13 → G6 → G8 → E8 (pass 2) → E11 → R9.** E14 any time.

---

## Landed in E12

Verified independently against the merged tree, not taken from the PR description.

| Item | Verified |
|---|---|
| Iso is the standalone default | `src/App.tsx` boots `startIsoGame` directly; legacy only at `?legacy=1`. |
| Legacy behind a lazy import | `await import("./game/main-legacy")` inside the effect, with a comment explaining that a static import would defeat it. |
| Bundle fence | Default chunk 234.6 kB with **zero** `MapView3D` / `THREE` / `BufferGeometry` references. Legacy chunk 640.3 kB carries them. Measured on a real build. |
| Rename preserves history | Git records `main.ts` → `main-legacy.ts` at 95% similarity, not delete+add. |
| E11 round-test flake fixed | `findSouthCorridor()` checks bounds, water and occupancy. **Reproduced the original defect independently**: a 2000-seed sweep against the old logic put the factory off-map on 198 seeds (9.9%), consistent with the reported 8.5%. This was a test betting on luck, not an engine bug. |
| Suite stability | 8 consecutive `vitest run` invocations, 242/242 every time. |
| Atlas gate | `npm run slice-atlas` reproduces `assets/iso-atlas/` byte-identically. |
| New DOM e2e | `tests/e2e/iso-game.spec.ts` registers 8 tests; `window.__iso.tileScreenAt` added as the coordinate probe. |

---

# Open

## E13. CI does not run the e2e suite — 76 tests never execute automatically
`[chore] [testing] [P0]` — do this first

`.github/workflows/ci.yml` runs `npm ci`, `typecheck`, `npm test` and the atlas gate. There is **no e2e job**. All 76 Playwright tests across 5 files — including the new `iso-game.spec.ts` that exercises real pointer input, real rAF rendering and real canvas pixel assertions — run only when someone remembers to run them locally.

This was flagged during the E12 review because the sandbox couldn't reach the Chrome-for-Testing CDN, so those 8 new tests are **currently unverified in a browser by anyone**. That's a gap in the merge, but the durable problem is the missing CI job: without it, T1 and T2 were only half-delivered, and the mobile viewport coverage from T2 has the same exposure.

**Fix**

```yaml
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

**Acceptance**
- E2E job green on `main` and required on PRs.
- The 8 `iso-game.spec.ts` tests pass in a real browser — this is the first actual confirmation they work.
- Failure artifacts (report, traces, screenshots) uploaded so a red run is diagnosable without a local repro.
- Someone runs `npm run test:e2e` locally once before this lands, so a failure is triaged as a genuine bug rather than a CI-config problem.

If the full matrix of 5 viewport projects is too slow for every PR, run desktop chromium on PRs and the full matrix nightly. Don't drop the mobile projects entirely — G4 and G5 both changed things the mobile specs assert on.

---

## E14. Remove the tracked patch file
`[chore]` — two minutes

`01a0664c-881a-7e2d-a962-ae437c7347a9.patch` was committed at `67ba58b` and is still on `main` after the merge. It's now a duplicate of history that will confuse anyone browsing the root.

`git rm 01a0664c-881a-7e2d-a962-ae437c7347a9.patch`. While there, add `*.patch` to `.gitignore` so the next one doesn't land the same way.

Also decide on `tools/peek.mjs` — its own header calls it a "scratch helper". Either document it in the README's tooling section as a kept debugging tool, or remove it. It's genuinely useful for headless sprite inspection, so documenting is probably right.

---

## G6. Road/rail sprites are programmer-art lines, not OpenGFX track
`[assets] [polish]`

`makeGenerated()` in `tools/slice-atlas.mjs` still draws road and rail as flat grey (`[86,86,86]`) and brown (`[122,82,36]`) segments. Geometry is correct as of G1, so this is purely a visual swap.

Slice real half-pieces from OpenGFX:
- Road: `src/assets/sprites/png/landscape/landscape031.png`
- Rail: `src/assets/sprites/png/infrastructure/rail/`, with `base-1005-rail-infra.pnml` for sprite indices

Slice **one half-piece per kind**, rotate and mirror into four directions, overlay for all 16 masks. Do not slice 16 separate crops; alignment won't hold across them.

**Acceptance**
- The G1 pixel test passes **unchanged** after the swap. This is the load-bearing guard — it proves the new art didn't move the connection points. Do not regenerate or relax that test as part of this ticket.
- Half-pieces meet the tile edge at the exact midpoint at consistent width, so adjacent tiles form a continuous run with no step or gap.
- Level-crossing sprite added for tiles carrying both road and rail.
- Contact sheet regenerated; G7 atlas gate green.

---

## G8. Dark wedge artifacts scattered across grass tiles
`[bug] [renderer] [investigate]`

Still blocked on fresh screenshots. G2 fixed the white seam row, which may have been the entire cause — **re-capture at the same zoom as the original close-up before doing any work here.**

If wedges persist, isolate in order:
1. Full map of `terrain_grass_a` only, chunk caching **disabled**. Clean → the cache is at fault.
2. Re-enable chunk caching. Wedges returning at 8×8 tile intervals → chunk-boundary seam.
3. Wedges only where `terrain_grass_b` sits → that variant is the problem. It renders noticeably more olive than `grass_a` and may be a field tile rather than grass.

Attach before/after captures either way.

---

## E8. Economy rebalance — pass 2
`[design] [gameplay]`

Pass 1 landed the structure: `VP_TARGET = 12`, `START_PURSE = { stone: 12, ore: 0 }`, quotas raised. The gating is real — rail costs `2 ore + 1 stone` and you start with no ore, so you must road out to an ore mine first.

What pass 1 can't tell you is whether the curve is good. Watch:

- **Time-to-first-rail.** `ore_mine` quota is 5 on a landmass that grew when G3 removed the lakes. An ore mine may now sit close enough to the start that rail arrives almost immediately, collapsing the road-vs-rail decision into a menu. If it's under a couple of minutes, lower the quota or raise rail's cost.
- Whether 12 stone plus the free setup track reliably reaches a first industry on a sparse map roll.
- Whether `VP_TARGET = 12` gives the game length you want, with road at 1 VP and rail at 3.
- Whether rail's 1.6× throughput *and* 3 VP makes road strictly obsolete once ore flows. If so road needs a niche — `onRough` is a lever already in the data.

File one follow-up per lever rather than a single open-ended rebalance ticket.

---

## E11. Cutover — delete the hex path
`[chore]`

Still present: `src/game/hexmap.ts`, `src/map3d/MapView3D.ts`, `"three": "^0.185.1"`, the legacy `.jpg` terrain textures (824 kB, still emitted to `dist/`), `src/game/main-legacy.ts`, and the `?legacy=1` branch in `App.tsx`.

E12 already achieved the important part — legacy costs the default bundle nothing. So this is now pure housekeeping rather than a performance fix, and the urgency has dropped accordingly.

Hold until G6 and G8 are done; the legacy path is a useful comparison point while the iso renderer is still being corrected. When it goes, the legacy Playwright specs (`touch-camera.spec.ts` and the legacy boot tests) go with it, and the T2 snapshots need rebaselining.

---

## R9. Prune the OpenGFX asset tree
`[chore] [repo-size]`

`src/assets/sprites/` is **19 MB** — the whole OpenGFX tree including aircraft, ships, trains, toyland, arctic, tropical, manager faces, `.xcf`/`.psd` sources and `.pnml` definitions. The game uses a small fraction.

Prune to `terrain/`, `industries/`, `infrastructure/`, `landscape/`, `trees/temperate/`, `miscellaneous/` and the `stations/` working files. Keep the OpenGFX attribution in the README.

**Do this after G6**, which needs `landscape031.png` and the rail sheets. Cross-check against `tools/iso-atlas.cells.json` before deleting — and note the G7 atlas gate makes this safe: run `npm run slice-atlas` after pruning and CI tells you immediately if you cut too deep. 