# L16 (#231) playtest — storage cap raised by city upgrades

**Date:** 2026-09-17
**Ticket:** #231 *L16 — Storage cap raised by city upgrades* (epic #223, wave M6)
**Build:** `arena/01a0ad89-hexmatch`, dev server `?seed=1337&loop=new&unlimited=0`
(DEV-only flag, solo; `unlimited=0` turns the dev purse floor OFF so the play
runs the real capped economy — the ticket's own instruction for how to test it)
**Harnesses:** `tests/unit/iso-l16-storage.test.ts` (the acceptance block, booted
real game in jsdom) and a scripted headless-Chromium session against the live dev
server — real boot, real menu clicks, real placement/drag/button paths.

## The rule as it played

- **The bar counts toward something.** At boot the footer read
  `0/24 · 12/24 · 0/24 · 12/24 · 0/24 · 0/24` (grain, wood, ore, stone, oil,
  gold) — the starting cap (24, `STORAGE_CAP_BASE`) fits the 12-wood /
  12-stone opening purse with headroom.
- **Income stops at the cap.** A free-setup Farm Depot, tuned to the default
  yield and joined to the player's Factory with free gravel (the real
  `placeDepot` + `dragBuild("dirt")` paths), filled its grain store to
  `24/24` on the 3-second clock and stopped. The chip wore the full state
  (gold keyline + gold count, `.chip.full`) and the tooltip said
  *“Storage full — clock income past 24 is lost. A city upgrade raises the
  cap.”*
- **The inspector says what is being wasted.** Hovering the capped Depot:
  `Depot (yours) · holding 1 industry · link: dirt ×1 · distance: 4 tiles ·
  ×1 (near) · ⚠ storage full — this Depot's Grain output is being wasted`.
- **The upgrade is the answer the UI promises.** Clicking the real `🏙
  Upgrade city` button (`.tp-city`) opened the tuning session; a played
  session landed the level, and the SAME frame every denominator moved from
  `/24` to `/60` (`TOWN_UPGRADES[0].storage = 36`). Income resumed: from
  `59/60` the next tick pinned the store at `60/60` and flagged full again.
- **Nothing is ever taken back and nothing is blocked.** Balances above the
  cap (dev's 9999 floor shape, an over-cap purse in the unit tests) are left
  exactly where they are and pay prices exactly as under the cap — “never
  spend-blocked, just not stored.” The `?unlimited` dev floor bypasses the
  cap entirely; `?unlimited=0` (this session) is how the real economy is
  playtested.
- **The rival plays the same rule.** Its clock income clamps at the same 24,
  and a rival pressed against the cap SPENDS: the city upgrade is hoisted
  above its greedy depot pass (which could otherwise eat the upgrade's mix
  and leave the seat capped for a whole turn), and the tree reserve is
  skipped for cargoes whose income is being wasted. Pinned by the unit test
  (`prefers upgrading when its purse is pressed against the cap`), and the
  whole-race version runs in `npm run test:slow` with the harness's
  `loopIncome` clamped at the same cap.

## The opening, checked as data

The acceptance line “the depot tree is still completable from `START_PURSE`
with the starting cap” is walked in the unit suite: every rung's mix (largest
single-cargo ask 6, the city upgrade's wood) and the whole `START_PURSE` sit
under the 24 cap, so no price the opening or the first tier can ask is
unpurchasable against a capped store. The walk buys the first city upgrade at
the earliest point its mix exists (right after the rung-0 depot pair).

## Numbers worth keeping

- A fresh Farm Depot (output 1, default yield) on a near paved link ticks
  ≈ 4 grain / 3 s and fills the 24-store in ≈ 18 ticks (~54 s of play) — the
  cap bites on ONE untuned depot, which is the Merge Gardens pressure point
  the ticket is after, without dead-ending anything.
- The first upgrade costs 6/4/4 and raises the cap by 36 (24 → 60) while
  also setting the base-rate bonus (×1.6 on a full session) — one decision:
  spend the surplus or raise the ceiling on the surplus.
