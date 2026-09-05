# HexMatch — open tickets (after PR #21)

Audited against `main` @ `08230e3`. Verified independently: **362/362 unit tests pass** (G9 fixed the honesty problem — the suite no longer lies), typecheck clean. PR #21 landed W8, W9, G9 and filed E14. Good work — the W8 rival-deadlock fix took idle placements from 51/160 → 0/160 on seed 1337.

**But one P0 from the last doc was skipped, and it's the one you keep seeing on screen.**

Ordered by priority. One ticket per PR, stop at each acceptance block, verify before reporting done, keep the G7 atlas gate green.

---

## B1. Apply the Art Lab tile config — STILL not done, startup map still uses old tiles
`[P0] [assets]`

This was A1 in the previous doc and it was **not addressed in PR #21** (that PR did the three logic tickets instead). Confirmed against `main`:

```
terrain_grass -> landscape/PNG/landscapeTiles_010.png   ← still the ramp tile
```

`010` is the sloped block that causes the sloped-grass bug. The human's Art Lab config chose `067` (flat) and picked correct tiles for water, rough, and every industry. That config was never applied — the live cells file still has the original programmatic picks.

Full correction table (live → should be):

| Slot | LIVE (wrong) | Art Lab config |
|---|---|---|
| terrain_grass | landscapeTiles_010 (ramp) | landscapeTiles_067 |
| terrain_water | landscapeTiles_037 | landscapeTiles_066 |
| terrain_rough | landscapeTiles_073 | landscapeTiles_059 |
| farm | buildingTiles_083 | buildingTiles_026 |
| forest | landscapeTiles_028 | buildingTiles_034 |
| ore_mine | buildingTiles_007 | buildingTiles_036 |
| quarry | buildingTiles_081 | buildingTiles_093 |
| gold_mine | buildingTiles_058 | buildingTiles_042 |

**Apply the human's exported `iso-atlas.cells.json` verbatim.** Do NOT re-pick tiles by script — the flat-vs-slope difference is not measurable in pixels (010 and 067 both measure a widest row at y≈33; the difference is only visible to the eye), which is exactly why three prior programmatic attempts picked wrong. Keep the file's `stack` entries — MB1 supports them.

```
cp <human's exported file> tools/iso-atlas.cells.json
node tools/make-derived-art.mjs && node tools/parse-pnml.mjs && npm run slice-atlas
git diff --exit-code assets/iso-atlas/   # commit the regenerated atlas
npm run typecheck && npm test
```

**Acceptance:** `terrain_grass` renders flat, no sloped triangles; all slots match the table; atlas regenerated and committed; G7 gate green; tests pass. Verify by rendering the map, not just running tests.

**If you don't have the human's file:** ask for it. Do not reconstruct it from this table alone — get the real export, because it also contains the correct road/rail and building-stack entries this table doesn't fully list.

---

## B2. E14 — the e2e gameplay spec can't pick a corridor (tile geometry doubled)
`[testing] [P1]`

Already filed and well-diagnosed at `docs/tickets/E14-e2e-corridor-picker-returns-null.md`. I verified the diagnosis: `TILE_W/TILE_H` are now `132/64` (were `64/32` at the last green nightly `1170d64`), so the test's 7-tile due-south corridor spans 396×256 CSS px instead of 192×128, and the start window between the two fixed side panels collapsed to ~3 lattice positions — none of which coincide with a fully-buildable industry column at seed 1337. The picker returns null before any pointer event fires. Tests 1/2/4 pass; test 3 dies in the helper.

This has been red since the Kenney cutover and, because it's a non-required job, **has silently blocked nothing** through PRs #18–#20 — every "e2e fails, pre-existing" note traces here.

The ticket lists four fix candidates; **(a) is right**: zoom out with a real wheel gesture before picking (`page.mouse.wheel`), which respects the spec's no-mocking rule and makes the corridor fit. (b) shortening the corridor to 4 tiles also works and is simpler. Avoid weakening the picker's filters — that hides real bugs.

**Needs a browser to verify** — can't be confirmed in a headless-only sandbox. Do this where Playwright can actually run, or the fix is unverifiable.

**Acceptance:** the gameplay e2e test picks a corridor and completes the factory→harvester→road→+1 VP flow at seed 1337 / 1280×720; the fix uses a real gesture, not a mocked camera or a relaxed filter; e2e job green.

---

## B3. Make the e2e job required once it's green
`[ci]`

The root cause behind E14 hiding so long: the e2e job isn't a required check, so a red e2e has never blocked a merge. Once B2 turns it green, mark it required in branch protection (Settings → Branches → require the `e2e` status check). Otherwise the next geometry change silently breaks it again.

**Acceptance:** e2e is a required check on `main`; a PR with a failing e2e cannot merge.

---

## B4+. Remaining gameplay — Priority 2 TK tickets
`[gameplay]`

With the Priority-1 bugs closed and the map fixed (B1), the next body of work is the TK gameplay tickets from `docs/HexMatch-tk-gameplay.md`, each its own PR:

- **TK-002** — rail as an independent network that crosses roads (track ownership from W2 is in place, so this is now unblocked).
- **TK-004** — vehicles moving along roads. Art + directional frames already in the atlas (K5), so this is movement logic.
- **TK-005** — bigger map + towns + cap resources at 2 nodes each.
- **TK-006** — first building must be placed in a town radius (needs TK-005).
- **TK-007** — rename Quarry → Processing Plant, remove timed bomb spawns, tie spawns to vehicle arrival (needs TK-004).

Natural order: TK-005 → TK-002 → TK-004 → TK-007 → TK-006. Each is one PR.

---

## Sequencing

**B1 → B2 → B3 → B4+.**

- **B1** is the one you keep looking at — do it first, it makes the map finally correct. Highest visible impact, and it's data-only + low risk.
- **B2** needs a browser environment; schedule it where Playwright runs.
- **B3** locks the e2e gate so B2 doesn't silently regress.
- **B4+** is the feature backlog, after the foundation is solid.

## Note on the branch/PR constraint

PR #21 bundled three tickets because the session was pinned to one branch, breaking the one-ticket-per-PR rule. That's a workflow limitation, not a process failure — the agent flagged it and offered to split. If the arena can start each ticket on its own branch, keep one-per-PR. If it can't, group only tightly-related tickets (e.g. B1+B2 are unrelated — don't bundle those) and list them explicitly in the PR body.