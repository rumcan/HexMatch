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