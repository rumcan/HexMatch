# HexMatch — instructions for the coding agent (updated after MB1)

**Status check first.** I audited `main` @ `dddf568` (PR #19). MB1 — stacked multi-storey buildings — is **fully merged and working**. Both pieces of the previous instruction are done:

- Factory (`factory_*`) renders as 5-layer towers; depot (`depot_*`) as proper base+floor+roof stacks — the roof-only depot bug is fixed.
- Industries (farm, forest, ore_mine, quarry, oil_rig, gold_mine) stayed single-`png`, correctly scoped.
- Verified: typecheck clean, **333 unit tests pass**, `slice-atlas` reproduces the atlas byte-identically (G7 gate green), and the composite `parts` geometry is exactly the 36px-per-storey offset (factory parts at dy 149/113/77/41/0).
- The rail-pixel test the PR flagged as failing now **passes** (12/12) — no longer an issue.

**So there is no outstanding art/renderer work to finish.** Don't re-do MB1. Below is what's actually left, in priority order. Each is its own PR; stop at each acceptance block.

---

## Where things stand

The **art pipeline is complete**: Kenney tiles mapped, roads connecting, terrain flat, buildings coherent and now multi-storey. What remains is **gameplay**, not art. The biggest items are still the logic bugs from the W-series (`docs/HexMatch-open-backlog.md` earlier revisions), most of which predate the art work and are still open.

If any of these were closed in a PR I haven't seen, skip them — check the ticket status in `docs/` before starting.

---

## Priority 1 — verify the game is actually playable end to end
`[testing]`

Before new features, confirm the core loop works with the current build, because a lot has changed underneath it. Run through, in a real browser:

1. Place factory → place harvester → connect them with road.
2. Match gems in the Processing Plant / Quarry → confirm cargo increases, and only for connected industries.
3. Spend cargo to build more road/rail.
4. Confirm gold from combos reaches the purse (this was broken — `board.onGold` wiring).
5. Confirm the rival builds its own road and doesn't ride yours (track ownership).

Whatever fails here is the real top priority. File one ticket per broken step. Don't assume the W-series fixes all landed — verify.

---

## Priority 2 — remaining TK gameplay tickets

From `docs/HexMatch-tk-gameplay.md`, the ones not yet done (check status first):

- **TK-002** — rail as an independent network that crosses roads. Depends on track ownership (W2) being in place first.
- **TK-004** — vehicles moving along roads. The Kenney vehicle art and directional frames are already in the atlas (K5 done), so this is movement logic, not art. Ties into TK-007.
- **TK-005** — bigger map + towns + cap resources at 2 nodes each.
- **TK-006** — first building must be placed in a town radius (needs TK-005 towns).
- **TK-007** — rename Quarry → Processing Plant, remove timed bomb spawns, tie resource spawns to vehicle arrival (needs TK-004).

Each is one PR. TK-004 → TK-007 is the natural pair (vehicles must move before arrival can trigger spawns).

---

## Priority 3 — polish

- **Map scale / terrain tuning** (`docs/HexMatch-art-polish.md`, M-series): if the map still feels sparse or too brown after TK-005, retune. Coordinate with TK-005 — same change.
- **Art Lab stack editor**: per the repo docs this already shipped. If the human wants to re-theme buildings, it's the tool for it — no code work needed.

---

## Rules for every PR here

1. **One ticket per PR.** No bundling. This project has repeatedly shipped half-done or timed out from over-scoping.
2. **Stop at the acceptance block.** Don't continue into the next ticket.
3. **Verify claims before reporting done** — run typecheck, tests, and for anything visual, actually render it. Several past "done"s were set-up-but-not-wired.
4. **Check `docs/` ticket status first** — don't re-do finished work.
5. Keep the G7 atlas gate green: after any `cells.json` change, run `npm run slice-atlas` and commit the regenerated atlas.

---

## What NOT to do

- Don't touch the art pipeline, the Kenney mapping, or MB1 stacking — it's done and verified.
- Don't reconstruct or hand-edit `iso-atlas.cells.json` from memory — edit the real file, run the packer, check the diff.
- Don't start a second big change while one is in review.

---

## Tickets filed 2026-09-05 (Priority 1 play-test)

Priority 1 is done: the core loop was played end to end and one ticket was
filed per broken step. Full evidence in
`docs/playtest-reports/2026-09-05-priority-1.md`.

| ticket | file | state |
|--------|------|-------|
| **W8** — the rival never builds a single tile (AI deadlock) | `docs/tickets/W8-rival-never-builds.md` | **FIXED 2026-09-05** — step 5 of the core loop works: 0 deadlocked rival tiles on seeds 1337/7/2024 (was 51/37/0), and the rival is never placed on a tile it cannot build from |
| **W9** — free setup track pays for rail, bypassing the ore gate | `docs/tickets/W9-free-setup-track-pays-for-rail.md` | **FIXED 2026-09-05** — option (a): the allowance buys road only, for the player and the rival; E8's ore gate holds |
| **G9** — committed derived rail art is stale; the suite is red | `docs/tickets/G9-stale-derived-rail-art.md` | **FIXED 2026-09-05** — art regenerated, and `make-derived-art.mjs --check` (run by `npm test`) now fails on drift |

Steps 1–4 of the core loop verified **working** (place → connect → match →
spend → combo gold all land correctly; W5's `board.onGold` wire is good).
Step 5 works as of the W8 fix.

Each ticket file carries a **Resolution** section: what changed, the acceptance
list ticked item by item, and what was measured. All three landed on
`arena/01a0717e-hexmatch` — one commit per ticket, in the order the backlog
asks for (G9 first, because a red suite hides everything else; then W8; then
W9, whose numbers are easiest to read on a rival that actually builds).

The "333 unit tests pass" and "rail-pixel test now passes" claims at the top of
this file were **false** on `main` when the play-test measured them (see G9).
They are true again now, with new numbers: **362 unit tests pass**, typecheck
clean, lint 0 errors, `slice-atlas` reproduces `assets/iso-atlas` byte for byte
and `make-derived-art.mjs --check` reports no drift. The rest of the top
section stands — MB1 is done and the art pipeline was not touched.

### Still open

One ticket is open: **E14** (`docs/tickets/E14-e2e-corridor-picker-returns-null.md`)
— the CI `e2e` job's gameplay spec. It is **not** a regression from W8/W9/G9;
it has been red since the Kenney art cutover doubled the tile geometry
(`TILE_W 64 → 132`), and PR #18 worked around it for the TK-001 test only
without ticketing it. E14 has the provenance, the arithmetic and the fix
candidates. Fixing it matters beyond the one red job: while `e2e` is red it
blocks nothing, which is how G9's red unit suite reached `main`.

Otherwise nothing in `docs/tickets/` is open. Next up is Priority 2 — the
remaining TK gameplay tickets (TK-002, TK-004 → TK-007, TK-005 → TK-006), one
PR each. TK-002's dependency (track ownership, W2) is in place, and TK-004's
art (K5 vehicles, directional frames) is already in the atlas.

One caveat carried over from the play-test, unchanged by these fixes: the
sandbox has no browser, so `npm run test:e2e` (real chromium, CSS-occlusion
assertions) was **not** run for W8/W9/G9 — CI ran it instead, and reports the
pre-existing E14 failure (3 passed, 1 failed at the corridor picker) while the
`test` job is green for the first time since the cutover. Worth a pass in a real
browser before the play-test report is closed out — `npm run dev`, then the five
core-loop steps, with step 5 (the rival builds its own road) now expected to
pass.