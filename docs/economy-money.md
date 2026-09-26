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
* **buying** — `quoteBuy` prices a purchase at the sale price **+15% spread**.
  It is implemented and tested (`no infinite loop: buying back what you just
  sold always loses money`) but **not wired into the UI yet** — see §7.

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
  it cannot spend is money it is not using.

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

## 7. Known gaps / follow-ups

* **Buying is modelled but not wired.** `quoteBuy` / `buyPrice` exist and are
  tested; the Market tab shows no Buy button yet.
* **A guest cannot sell.** `onSell` refuses on a guest with "Selling is handled
  by the host in this room" — the host owns the slippage, so a guest's sale
  needs a relayed intent like the bank's. The guest *sees* live prices and the
  host's money, because both ride the player wire.
* **The rival's planner is still resource-shaped** (see §5). A money-native
  planner would let it price a plan exactly instead of through `buildPurse`.
* **Balance is a first pass.** `test:slow` (rival balance) is the lead's run:
  watch that the rival still reaches its first Depot in the first two minutes
  and still wins *sometimes* — a rival that hoards is the failure mode to look
  for, and `DUMP_FLOOR` / the 2% edge are the two knobs for it.
