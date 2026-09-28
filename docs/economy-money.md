# Money and the market (ECON-1, #421)

**Resources are what you upgrade CITIES with. Money (`$`) is what you BUILD
with. You get money by SELLING resources on a market whose prices move.**

Everything below is implemented in three places and nowhere else:

| Where | What it owns |
| --- | --- |
| `src/iso/config.ts` | `BASE_PRICE`, `moneyValueOf`, `BUILD_COSTS_MONEY`, `START_MONEY` |
| `src/iso/market.ts` | the price model — walk, events, slippage, the rival's sell rule. Pure, seeded, no `Math.random`, no `Date.now` |
| `src/iso/game.ts` | the purse (`PlayerState.money`), `canPayBuild` / `spendBuild` / `refundBuild`, the market clock, the sell hook, the rival's market tick, the save and the wire |

---

## 1. Base prices

`BASE_PRICE` is what one unit of a good fetches at minute 0 of every match.

| Good | Base price |
| --- | --- |
| Grain | $6 |
| Wood | $5 |
| Stone | $5 |
| Ore | $8 |
| Oil | $12 |
| Gold | $40 (never sold — see §6) |

## 2. The cost table

`BUILD_COSTS_MONEY` is **derived**, never hand-typed: it is the old resource
bill (`BUILD_COSTS`, which city upgrades and the depot tree still read) priced
at the base prices above. Change a resource cost or a base price and the money
price follows; `tests/unit/iso-market.test.ts` pins that every build key has a
row and that the row matches `moneyValueOf(BUILD_COSTS[key])`.

| Build | Resources (unchanged) | Money |
| --- | --- | --- |
| Dirt Road | — | **free** |
| Street (per tile) | 2 wood 2 stone 4 ore | $52 |
| Road (per tile) | 3 wood 3 stone 12 ore | $126 |
| Pave over dirt | 12 ore | $96 |
| Ramp | 3 wood 6 stone 10 ore | $125 |
| Highway (per tile) | 4 wood 10 stone 24 ore | $262 |
| Overpass deck | 6 wood 12 stone 8 ore | $154 |
| Bridge deck (per water tile) | 9 wood 9 stone | $90 |
| Rail (per tile) | 3 stone | $15 |
| Rail bridge deck | 9 stone | $45 |
| Platform | 12 wood 12 stone 36 ore 6 oil | $480 |
| Train Depot | 9 wood 9 stone 12 ore 6 oil | $258 |
| Train | 12 ore 6 oil | $168 |
| Depot | 3 of each but gold | $108 |
| Processing Plant | 6 wood 6 stone 6 grain 9 ore | $168 |
| Dam (off — `DAMS_ENABLED === false`) | 12 wood 12 stone 18 ore 6 oil | $336 |

**City upgrades are NOT in this table.** `TOWN_UPGRADES` keeps costing
resources, and so do the depot tree's rung gates — that is what keeps
resources worth holding rather than dumping the moment they arrive.

`START_MONEY` is **$300**: one Depot plus a couple of paved tiles, i.e. about
the opening the old 12 wood + 12 stone purse bought.

Demolishing refunds **money** at the same 50% the resource refund used to be
(`resaleValue` → `refundBuild`).

## 3. The price model

    price = base × exp(walk) × Π(events) × (1 − impact)

* **walk** — a seeded Ornstein–Uhlenbeck (mean-reverting) random walk in log
  space: `x ← x(1 − θ) + σ·z`, θ = 0.08, σ = 0.055, one step every 5 s,
  interpolated between steps and clamped to ±0.4 in log space (≈ 0.67×…1.5×).
  Deterministic from `(map seed, cargo, step)` — host and guest compute the
  same number with no wire message, and a save restores the same prices.
* **events** — one slot a minute, ~34% of slots fire, each event runs 2 min.
  Booms are +25…50%, gluts −20…−35%, e.g. *"Steel boom: Ore +39% for 2 min"*.
  They are announced in the Feed and as a toast, once each. Slot 0 is quiet,
  so every match opens at exactly the base prices. Gold never gets an event.
* **impact (slippage)** — each unit you sell in a lot pushes the price down
  1.2% of what is left, capped at −45%, and recovers exponentially with a
  50 s constant. Selling 10 costs you ~6% on average; dumping 60 in one click
  costs you ~25% and leaves the price down for the next minute.
* **buying** (MKT-2, #465) — the Market tab's Buy 1 / Buy 10 pays the sale
  price **+15% spread** (`quoteBuy` / `buyPrice`), so a missing upgrade input
  can be bought. It is still tested that buying back what you just sold always
  loses money, and a guest's buy is a host intent, like a sale.
* **rumours** (MKT-2, #465) — events are deterministic from the seed, so the
  Market tab forecasts the NEXT slot about 60 s ahead (`rumourAt` in
  `market.ts`): *"Steel boom rumoured: Ore +25–50% in ~1 min"*. The copy
  quotes the scheduled size range (+25–50% / −20–35%), never the exact number.
  Rumours are always honest on Easy and Normal; on Hard each slot's rumour is
  true with 70% probability (one seeded draw per slot, `RUMOUR_HARD_HIT_RATE`)
  and a deliberately wrong one otherwise — a quiet slot can carry a false
  rumour, and a scheduled event can be misreported — so playing the forecast
  stays a decision. In multiplayer each seat reads rumours at its own client's
  difficulty (there is no match-wide difficulty there).
* **price alerts** (MKT-2, #465) — an optional per-cargo "notify me above $X",
  set from the Market tab row. When the live price crosses the line the seat
  gets a toast and one Feed line, once per crossing: firing disarms the alert
  until the price drops back below the line (`alertTick` in `market.ts`).
  Alerts are session-local and client-local — they evaluate against the
  mirrored prices, need no wire, and ride no save.

## 4. A simulated 20-minute game

Both seats on seed 4242, 2 depots for five minutes then 4, then 6, one paved
tile bought every 15 s and a Depot every two minutes. The player sells in lots
of 10 whenever it has them; the rival uses `rivalSellLot` (§5).

| t | Player $ | Player stock | Rival $ | Rival stock | Ore price |
| --- | --- | --- | --- | --- | --- |
| 0 min | $66 | g3 w3 | $66 | g3 w3 | $8.00 |
| 5 min | $35 | g3 w3 s3 o3 | $13 | g21 w23 s3 o3 | $7.98 |
| 10 min | $39 | g3 w3 s3 o3 | $93 | g41 w43 s21 o29 | $7.70 |
| 15 min | $41 | g2 w3 s3 o3 oil9 | $114 | g40 w43 s41 o39 oil23 | $6.76 |
| 20 min | $9 | g2 w3 s3 o3 oil9 | $71 | g40 w43 s41 o39 oil45 | $4.82 |

Read: neither seat gets rich by trading — money goes straight back into the
network, which is the intent. The rival's patience (it waits for a price above
its own moving average) pays about 10–20% more per unit than selling on sight,
and its stock stays high enough to buy a city upgrade.

**No infinite loop.** Selling cannot finance a build that returns more than it
cost in the same minute: the only money source is a sale, a sale moves the
price *down*, buying the same goods back costs price + 15%, and no build pays
money back except a 50% demolish refund.

## 5. The rival

`rivalSellLot(market, cargo, held, reserve, clock)` — pure, unit-tested:

* it sells only when the price is **≥ 2% above that good's moving average**
  (12 samples over the last two minutes),
* it never sells into its **reserve** — what its next city upgrade
  (`TOWN_UPGRADES[townLevel]`) costs in that good,
* it never sells more than **10 units** in one lot, so it pays slippage like
  the player,
* above **40 spare units** it cashes out regardless of the price: a warehouse
  it cannot spend is money it is not using,
* (MKT-2, #465) it reads the **same rumours** the Market tab prints — false
  ones included on Hard — and **waits out a rumoured boom** instead of selling
  into the minute before it (`rumourBoom` in `rivalSellLot`, fed by
  `rivalMarketTick`). The dump floor above still sells: patience is for the
  edge sale, not for a warehouse.

`game.ts` runs that every 5 s (`rivalMarketTick`) and pays for its builds with
`spendBuild` / `chargeBuild`. The AI *planner* still prices plans in resources,
so it is handed a **budget purse** derived from its money at the base prices
(`buildPurse`); charges that land after the build has already executed use
`chargeBuild`, which is clamped at $0. Worst case the rival spends itself broke
and must sell before it builds again — it can never build for free.

## 6. The three decisions the ticket asked for

**Is gold sellable? No.** Gold keeps its single role: Black Market sabotage
(PP-08). It has no exchange row, `sellable("gold")` is false, it is never the
subject of a demand event, and the Market tab repeats the Gold rule. Making it
sellable would turn every sabotage budget into a build budget and quietly
delete the only currency in the game with one purpose.

**Does the Bank stay? Yes, unchanged.** The 3:1 bank (`bank.ts`) converts one
*resource* into another; the market converts resources into *money*. They now
do different jobs, and the bank is the only way to fix a missing input for a
**city upgrade** — which money cannot buy. Folding it into the market would
leave a seat with 30 wood and no ore unable to upgrade at all.

**Does the offer board stay? Yes, as the Market tab's second section.** The
exchange is the tab's headline (it is what a solo player uses every minute);
player-to-player offers sit below it under their own heading. It costs nothing
to keep, it is the only trade surface in multiplayer, and it is already tested
(`tests/unit/iso-offers.test.ts`).

## 7. BAL-1 measurement note (2026-09-26)

No economy prices or money knobs were changed for BAL-1. The new calibration harness currently values the simulated resource purse at `BASE_PRICE` as a stock-value proxy; it does not run the shipped market or money ledger. Do not interpret that proxy as money income or use it to tune build prices. See [BALANCE.md](BALANCE.md) for target status and limitations.

## 8. Known gaps / follow-ups

* ~~**Buying is modelled but not wired.**~~ Done in MKT-2 (#465): Buy 1 / Buy
  10 at price + spread, including a guest's buy via a host intent.
* ~~**A guest cannot sell.**~~ Done in MKT-2 (#465): a guest's sale is a host
  intent like the bank's (`do: "sell"` / `do: "buy"` under the `build` action,
  validated against the guest's own seat). The guest *sees* live prices and
  the host's money, because both ride the player wire.
* **The rival's planner is still resource-shaped** (see §5). A money-native
  planner would let it price a plan exactly instead of through `buildPurse`.
* **Balance is a first pass.** `test:slow` (rival balance) is the lead's run:
  watch that the rival still reaches its first Depot in the first two minutes
  and still wins *sometimes* — a rival that hoards is the failure mode to look
  for, and `DUMP_FLOOR` / the 2% edge are the two knobs for it.

## 8. The BAL-1 balance pass (#471)

The match-arc and rival-difficulty targets live in `docs/BALANCE.md` (targets,
harness, measured results). Every knob that pass turned, and where it lives:

| knob | file | change | why |
| --- | --- | --- | --- |
| `RIVAL_SKILLS.easy` clocks | `src/iso/skill.ts` | session 110s → 85s, build/idle held | the measured "easy wins ~20% vs steady" line (5/30 in the committed report) |
| `RIVAL_SKILLS.easy` cadence | `src/iso/skill.ts` | pave 4 → 7 tiles, townReserve 1.25 → 0.95 | same — the easy rival's mid-game was starved of routes and city tiers |
| `RIVAL_SKILLS.easy` tuning hand | `src/iso/skill.ts` | `tuningSkill` 0.35 → 0.53 | same — a session quality a steady player's still beats |
| `RIVAL_SKILLS.normal` clocks | `src/iso/skill.ts` | session 80s → 74s | onto the measured "normal wins ~40%" line (11/30 in the committed report) |
| `RIVAL_SKILLS.normal` cadence | `src/iso/skill.ts` | pave 10 → 12, townReserve 1 → 0.85, `tuningSkill` 0.62 → 0.67 | same — the ladder rows are one knob: the rival's action cadence and its hands |
| `RIVAL_SKILLS.hard` clocks | `src/iso/skill.ts` | session 55s → 54s | a 1s trim onto the measured "~60%" line; hard measured in-band on the first full round |
| `RIVAL_SKILLS.trainee` | `src/iso/skill.ts` | session 120s, tune 0.30, townReserve 1.25, winTarget 6★ | FTUE-1's (#464) Starter Island rival — measured 0 wins vs novice |
| `DIFFICULTY_RULES.trainee` (new row) | `src/iso/config.ts` | gentle floor (minYield 1.5), no obstacles | the Starter Island's player side — FTUE-1 (#464), not a race knob |

**BAL-2 (#530) — the recalibration after #431 landed (2026-09-27):**

| knob | file | change | why |
| --- | --- | --- | --- |
| `RIVAL_SKILLS.hard.sessionMs` | `src/iso/skill.ts` | session 54s → **56s** | #431 removed the gold-opener stall the #523 harness counted as a non-win: hard's 30-seed win rate climbed 60.0% → 66.7% (±5pp band 55–65) and the smoke's 8-seed slice reached 75% (band edge). The pacing surface is bistable (54s≈66.7%, 58s+≈53.3% win-rate plateaus); 56s is the slower clipping of the fast attractor — measured 53.3% full run (1.7pp shy of the band; the only in-band-proximate point measured) and 50% on the smoke slice. |
| `RIVAL_SKILLS.hard.idleMs` | `src/iso/skill.ts` | idle 1.2s → **1.3s** | paired with the session clock above (the two clocks share a pacing stripe; idle alone measured inert over 30 seeds). |
| `RIVAL_SKILLS.normal` (all knobs) | `src/iso/skill.ts` | **held at shipped values** — measured, not moved | the 30-seed Normal row reads 43.3% (target 40% ±5pp → in band) at the shipped clamps on today's maps, so no knob moved. The smoke's 8-seed slice reads 75% at EVERY measured in-band setting (50+ measured variants): seeds 1–8 run +15–25pp rival-hot relative to seeds 9–30 — a seed-slice structure problem, not a pacing one (see docs/BALANCE.md §5 for the full sweep table and the follow-up options). |

Held on purpose, per #530's scope: the ★ line (`VICTORY.loop.target` = 12★),
every price (`START_MONEY`, `BASE_PRICE` and the derived `BUILD_COSTS_MONEY`
table), and the #431 purchase rule (`goalOutOfReach` / `planGoalPurchase` /
`rivalBuyTowardGoal`) — none were touched for this pass.

Considered and **held at their shipped values** (measured, then documented
here so the next pass does not re-open them blind):

- **`VICTORY.loop.target` (12★)** — a 10★ line was measured and rejected:
  with the rival's Depot bill goods-gated but never deducted (CONTRACT-1,
  #466), a 10★ line is won by filling the map with Depots (~13 min, no
  logistics phase). 12★ keeps the land-grab → logistics → finale arc and
  measured 19.8 min mean vs Normal.
- **`START_MONEY` ($300) and `BASE_PRICE`** — the money ratio between the
  two seats is the CONTRACT-1 asymmetry, not a price bug; moving prices
  moved both seats together and blurred the ladder. Re-check after #466.
- **the market's `DUMP_FLOOR` / 2% edge** — MKT-2 (#465) owns them.
- **per-map yields** — #603's row in §5.

The trainee's rows were added for FTUE-1 (#464) and only re-measured here:
"the trainee never beats the novice" is a harness *target*, not a knob. The
bots' plant budget (§ the bots in `docs/BALANCE.md`) is measuring-stick
policy, not a game knob.
