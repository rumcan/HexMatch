# L9 (#224) — the Black Market is map sabotage, priced against the clock

The shop used to sell two unrelated things through one currency: cards that
acted on the **world** (a Blockade, a Protest) and cards that reached into a
**match-3 board** (Frost Tiles, Iron Girders, Smog Cloud, plus a Repair Crew to
undo them). That was coherent while the board was an always-on machine you
farmed for cargo. It stopped being coherent at L4 (#218), when the board became
a bounded *tuning session* you open once per Depot: freezing seven gems on a
board nobody is looking at is not sabotage, it is a no-op with a sound effect.

This ticket makes the shop one thing.

## What the shop sells now

| card | key | price | effect |
| --- | --- | --- | --- |
| Blockade | `bandit` | 5 🪙 | the targeted industry's depots **stop ticking** for 45s |
| Protest | `protest` | 6 🪙 | every depot whose road route crosses the protested tile **stops ticking** for 2:00 (and its lorries visibly halt) |
| Security Forces | `security` | 2 🌾 + 1 🪨 | 90s of immunity to **both** |

`SABOTAGE` (`src/game/config.ts`) is the single source: the HUD buttons, the
guest intents, the rival's raid table and the "is this card still real?" gate
(`BLACK_MARKET_ACTIONS` in `src/iso/game.ts`) are all derived from it. Retiring
a card is a one-line change to that table.

### Re-defined against the clock, not the trucks

Trucks have been cosmetic since L7 — income is the L1b `economyTick`, not a
lorry arrival — so the old wordings ("no one may harvest", "holds all lorries")
described a mechanic that no longer decides anything. Both cards now say, and
do, the same thing: **the target's income ticks stop**.

* **Blockade** — `Industry.banditUntil`, already respected by `harvesterYield`,
  `railYield`, `industryClaimValues` and the quarry's token gate. Nothing new;
  the copy just stopped lying.
* **Protest** — new. `protestedDepot(depot, now)` walks the depot's own road
  route (`roadRouteForHarvester`, the same router the lorries use) and returns
  true if any tile on it carries a live protest. The `newLoop` depot loop in
  `economyTick` skips those depots. A depot with no road route is never
  protested, and the lorry-holding behaviour in `tickTrucks` is unchanged — the
  visual and the economic effect now agree.

  The skip sits **inside the two-seat loop** L1d (#235) introduced, so it cuts
  whichever seat owns the protested route: the player can stall the rival's
  haul road, and the rival's raid can stall the player's. `protestedDepot`
  resolves the depot owner's own Security guard, so neither seat's immunity
  leaks to the other.
* **Security Forces** — checked *before* either effect, for the defender's
  seat. The attacker is charged either way, which is what makes buying the
  guard ahead of a raid worth the materials.

### Nothing touches a board

`buyBlack` refuses any key outside `BLACK_MARKET_ACTIONS` before an intent is
relayed, and `buyBlackFor` refuses it again on the host (so an older guest
build, a stale macro or a console call is answered, not obeyed — and charged
nothing). The board primitives `harden` / `dropBlocks` / `fog` still exist in
`src/game/board.ts` with no game-side caller: they are what the *tuning-session
obstacles* (#225) will drive, per difficulty, which is where a board obstacle
belongs now that the board is a bounded session.

## Where Gold comes from

Combo Gold (`Board.COMBOS_PER_GOLD` → the quarry's `onGold` hook) was minted by
an always-on board. Under `newLoop` that board is only up during a session, so
the tap is closed (`payGold: !newLoop` on both quarries) and replaced by the
rule below. This is the half L1d (#235) deferred with "#227 owns Gold": that
ticket cut the rival's **cargo** line (`payCargo`), this one cuts its **coin**
line, and the two hooks sit side by side on both seats' quarries.

**a tuning session pays Gold for its score** — `tuningGoldFor(score)` in
`src/iso/tuning.ts`, bounded by `TUNING.minGold`(1) … `TUNING.maxGold`(3):

| session | Gold |
| --- | --- |
| abandoned, or score 0 | 0 |
| anything cleared | ≥ `minGold` |
| `targetScore` (60 gems) and beyond | `maxGold` |

This was chosen over a Gold-Mine-only source or a new city-upgrade tier because
it keeps Gold inside the loop's own core event: the same burst of matching that
sets a Depot's yield funds the sabotage you aim at the rival, and neither
requires constant matching — one session per Depot, roughly two sessions per
card.

Both seats are funded by the same rule. The rival takes a simulated session per
depot (`rivalTuningYield`) and the same simulated score pays it Gold
(`rivalTuningGold`), so its raid table never runs dry at any difficulty. The
map-side source is unchanged and deliberate: Gold is a cargo and a Gold Mine is
an industry, so a Depot holding one ticks Gold in on the clock — the bulk
source, where the session reward is the steady one that needs no map luck.

With the flag **off** the shipped loop is untouched: 2 combos still buy a coin.

## The rival raids with the same two cards

`RAID_ACTIONS` is `{bandit, protest}`, consulted by both halves of the raid
table, and both pay the `SABOTAGE` price:

* `rivalSabotage` — the Blockade, via `pickBlockadeTarget`.
* `rivalRaid` — the Protest, via the new `pickProtestTarget(victim, now)`:
  deterministic (no RNG), it counts public-road tiles across the victim's depot
  routes and stages on the busiest, ties broken by the lowest tile index. A
  raid with nowhere to stand is **skipped without spending**, and leaves its
  clock un-stamped so it retries next turn rather than burning the window.

## Multiplayer

The host owns the economy, so the effects are computed host-side as before. One
wire change: `Snapshot.blockades` (id + expiry), **snapshot v14**. The Blockade
is half the shop now, and industries are seed-derived and never sent, so a
guest whose depots were blockaded would otherwise watch its income stop with
nothing on its map to explain it. Protests already rode the wire. Saves are
unaffected — `bandit` was always in the save payload — and `readSave` accepts
snapV 10–14, so a game in progress survives the bump.

## The UI

L1a (#232) hid the Black Market panel under `newLoop` because a Gold shop
selling match-3 sabotage made no sense beside a board about to become a
session — "converted post-MVP in #224". This is that conversion, so the panel
comes back: map-only, in the BUILD column (the Bank pane it used to ride in
does not exist under the flag), beside the other things that act on the map.

Repair Crew's button, its `REPAIR_ISO` cost and the `.sab-btn` plates for the
retired cards are deleted. The painted sigils stay on disk for #225 to reuse.
(#225 landed the obstacles on the BOARD rather than back in the shop, so the
sigils are still unused — see `docs/L10-session-obstacles.md`.)

## Tests

`tests/unit/iso-l9-market.test.ts` is the acceptance block, and reads the
"measurably stops income" assertions off the **purse** through `econTick`
rather than off a flag — a card whose only proof is a boolean is a card that
can stop working in silence. Also touched: `iso-game`, `iso-mp` (the Blockade
now crosses the wire), `iso-rivalry` (Torvin's deck follows the inventory),
`iso-noir-theme`, `iso-snapshot`, and the e2e economy-tabs spec.
