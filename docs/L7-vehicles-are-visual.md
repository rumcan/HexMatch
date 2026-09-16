# L7 (#221) — vehicles are visual; speed reflects the tick rate

Three statements, one ticket:

1. a connected Depot shows a lorry driving its route to the plant and back —
   disconnecting it takes the lorry away;
2. that lorry's speed is the Depot's **effective tick rate**
   (`yield × distance × transport`), so the traffic on the map explains the
   purse on the HUD — at a slower base pace than the lorries ran at;
3. no vehicle holds economic state. Switching every vehicle off changes
   **nothing** the economy pays.

On `main` (before this branch) lorries were already cosmetic where income is
concerned — L1c (#234) moved the new loop's purse onto the clock and left the
lorries driving. What #221 adds is the second half: the pace, and the proof.

## The speed model

| | shipped loop (`newLoop` off) | new loop (`?loop=new`) |
| --- | --- | --- |
| base pace | `TRUCK_SPEED` = 1 tile / 600 ms on gravel (tarmac: 1 / 150 ms) | `TRUCK_RATE_SPEED` = 1 tile / 600 ms at rate 1 |
| what moves it | `segFast` — a paved segment is `TRUCK_ROAD_MULT` (4×) faster | the Depot's tick rate: `BASE_RATE × yield × distance × transport` |
| where it comes from | AI-02's per-segment plan | the L1b clock's own factor, handed over at plan time |

Rate 0.5 (untuned, far) drives one tile per 1200 ms; rate 1 (untuned, next
door) one per 600 ms; rate 2.5 (a fully tuned, near Depot) one per 240 ms. The
clock pays those same Depots `rate × cargo` every `HARVEST_MS` (3 s), so the
lorry and the purse are scaled by **one number**: `depotTickRate` in
`src/iso/loop.ts`.

* `depotTickRate(depot, distance)` is the single definition of
  `BASE_RATE × yield × distance × transport`. `economyTick` pays by it; the
  planner is handed it (`truckRateFor` → `planTrucks(…, { rateFor })`), stamped
  on the lorry as `Truck.rate`, and `truckSpeed` reads it as
  `TRUCK_RATE_SPEED × rate`.
* Because it is *derived*, nothing needs saving or syncing: the rate comes from
  the Depot's `yield` (already on the depot record) and the route the lorry
  already measures. A lorry with no `rate` — a pre-L7 save, the shipped loop, a
  hand-built fixture — keeps AI-02's exact pace, so every old test and every
  old save behaves as it did.
* A paced lorry is **uniform** along its route: on the new loop the rate is
  the throttle, so a paced lorry carries no `segFast` at all (one pace, not
  two). Paving is not lost — the paved tier reaches the Depot's income through
  the connection multiplier it always had; `transportFactor` in `loop.ts`
  stays the L2 seam that will carry rail's 1.6×.

### Why the two loops have two constants

The sluggish base is `TRUCK_RATE_SPEED`, and it belongs to the **new** loop
only. The shipped loop has its own base — `TRUCK_SPEED`, which the free-gravel
redesign set to 1/600 with `TRUCK_ROAD_MULT` 4 (tarmac keeps 1/150) — because
that loop's *board* is paced off the lorries (`deliveryDistances` in
`quarry.ts`): there the lorry is the token clock, so its number is economy
balance, not presentation. #221 must not retune a shipped economy, so it leaves
that constant alone and introduces its own.

The two numbers being equal today is a **coincidence of two rules with
different owners**, deliberately not an equation: the tests pin
`TRUCK_RATE_SPEED ≤ TRUCK_SPEED` and that even the fastest paced lorry
(rate 2.5, near) stays slower than tarmac — not `TRUCK_RATE_SPEED * 2 ===
TRUCK_SPEED`, which a gravel retune would break in a way that says nothing.

Rail is deliberately left coupled: `RAIL_SPEED = TRUCK_SPEED * 2`
(`src/iso/rail.ts`, pinned by `iso-rail.test.ts`). Trains are DEV-only behind
`railAvailable`, ride the shipped pace model, and L2 (#216) owns their pricing
and their 1.6× transport factor; retuning them here would silently move a
number nobody asked this ticket to move. When rail is re-priced, `RAIL_SPEED`
gets its own decision — the seam is one constant. The ticket's note about the
`rail/simple-trains` work ("if merged, it needs the same cosmetic change") is
already satisfied: trains never paid — `rail.ts` says so where it says a
departure fires no `earn()` — and the switch above stops them with the rest.

### Cars: decoupled, not retuned

`CAR_SPEED` used to be `TRUCK_SPEED` imported from `vehicles.ts` — retuning
lorries retuned the scenery. Ambient cars are a town's street life, not a
Depot's output, so `cars.ts` now owns its own literal (`1/300`, unchanged on
screen) and references no lorry constant. A source-level assertion in the L7
suite pins that the file cannot re-acquire the import.

## The switch: `__iso.setVehicles(false)`

The ticket's acceptance needs "income is unchanged with vehicles disabled", and
`setTraffic(0)` cannot answer it — that dial is ambient volume (`carCount`,
0–64) and leaves the lorries driving. So the all-vehicles switch is its own
probe:

| hook | what it does |
| --- | --- |
| `__iso.setVehicles(on)` | plans/integrates/draws no lorry, car or train while off; returns the new state |
| `__iso.vehiclesEnabled` | read-only twin of the switch |
| `__iso.vehicleCount` | `world.vehicles.length` — the draw list, 0 while off |

It is honest about its scope. On the **new** loop it provably moves no cargo —
the clock never reads a vehicle, which is what the acceptance test measures.
On the **shipped** loop lorries *are* the token clock (`collectDeliveries` →
`deliverLoad`), so switching them off there stops exactly the income an empty
street would; the switch does not pretend otherwise. `trucksDirty` is left
standing while off, so switching back on replans instead of resuming a stale
plan (and the lorries keep their places — position retention is unchanged).

### No per-frame cost

The rate is stamped when lorries are **planned** — network changes
(`rescoreNow` sets `trucksDirty`) and tuning results (the player's
`finishSession` → `rescoreNow`, the rival's `applyRivalTuning`) — never per
frame. The frame still plans only when `trucksDirty`, integrates with the same
`tickTrucks`, and rebuilds `world.vehicles` the way it always did. With
vehicles off the draw list is empty, which also stops `hasAnimation` forcing
the structures pass: the switch is *cheaper* than the status quo, not costlier.

## What keeps the lorry from feeding back into the economy

`Truck.deliveries` is still counted and `quarry.setTruckServed(…)` still reads
it — that is the shipped loop's board gate, and the new loop keeps the count
harmless by never paying for an arrival (L1c/L1d). Nothing in `economyTick`,
`harvest` or `collectDeliveries` reads a lorry's position, its rate or its
count to decide money. The L7 test measures it directly rather than trusting
the claim: it drives one full one-way trip (arrivals included), ticks the clock
three times with the traffic running, then switches every vehicle off, drives
20 frames and ticks the clock three more times — the two income deltas are
equal, and the lorry did not move a tile.

## Tests

`tests/unit/iso-l7-vehicles.test.ts` (9 tests, boots the real game in jsdom):

* the reference pace and the band the rate sweeps it over (never faster than
  the shipped gravel pace, never as fast as tarmac);
* `truckSpeed` scales by the rate and only by the rate (integration too);
* a lorry with no rate keeps AI-02's pace, per-segment flags and all — and a
  paced lorry ignores those flags, because the rate is the throttle;
* a bogus rate (0, negative, NaN, ∞) is no rate — a lorry never freezes;
* `planTrucks` with a resolver stamps `rate` and omits `segFast`; without one
  it is byte-for-byte the old plan;
* `CAR_SPEED` is its own constant and `cars.ts` no longer references lorries;
* the game: every connected Depot gets a lorry whose `rate` equals the cached
  `depotTickRate` (cross-checked against the uncached `liveTickRate`), which
  covers `rate` tiles per 600 ms, and a fully tuned Depot's lorry covers more —
  the same ratio at both ends; tuning a Depot that already has a lorry updates
  the rate without teleporting it;
* cutting the road removes the lorry, mending it brings the lorry back;
* vehicles off: nothing moves, nothing is drawn, and the clock pays exactly
  what it paid with the traffic running.

Existing suites that pin the surrounding rules stay green untouched:
`iso-vehicles`, `iso-vehicles-speed` (AI-02's per-segment model), `iso-cars`,
`iso-rail`, `iso-protest`, `iso-traffic-perf`, `iso-quarry`, `iso-l3-distance`.

## Verification record

The branch was rebased onto `main` @ `a97afaa` (the merge that brought the
free-gravel pace and the 2×2 depot lot into `main`) before any of this was
measured, so every number below describes the code as it will land, not a
pre-rebase tree.

* `npm run typecheck` — clean (both configs), on the branch **and** in a
  scratch worktree of `main` @ `a97afaa` with this change applied as a patch.
* `npx vitest run tests/unit/iso-l7-vehicles.test.ts` — **9/9**, run both in
  the branch and in that scratch worktree.
* The vehicle/route suites + `iso-quarry`, `iso-rail`, `iso-protest`,
  `iso-traffic-perf` — **155/155** on the branch (117/117 of them in the
  scratch worktree).
* `npm run test:slow` — 4 files / 20 tests green (`iso-ai-sweep`,
  `iso-rebalance`, `iso-debug`'s network dump, and the L1d race: two full
  30-minute matches on the new loop finish with a winner).
* `npm test` (full) — before the rebase, this branch and a `main` worktree were
  run one after the other and produced **identical failure sets**, i.e. the
  change added no red. Those pre-existing reds are `iso-detail-tiers` (the
  committed `assets/ground/medium/grass.png` is 100×100 where the test wants
  256×256), `iso-graphics` PERF-01, `iso-performance` ×2, `iso-game`'s ☰-menu
  row, `iso-market`'s clock test (`lastAiTrade` starts at 0, so
  `tick(performance.now() + 10)` fires once process uptime passes 5 s — a
  load/timing flake), and `iso-match-settings` #186 (passes 70/70 when run
  beside `iso-ai`). The same comparison is repeated against `a97afaa` after the
  rebase; the per-file procedure in `AGENTS.md` §2 decides any red it finds.
* `npx eslint` on the four touched `src` files + the new test — 0 errors
  (warnings are the file-wide `no-explicit-any` ones `main` already carries).
* Playwright could not run in this sandbox: the browser download is blocked and
  no cached Chromium exists, so `--project=desktop-chromium` is **not** covered
  here. The behaviour it would cover is exercised through the real game module
  in jsdom instead (the boot harness, the frame's own `truckTick` twin, the
  clock's `econTick`) — the same substitution RV-02 used when this sandbox had
  no browser. Running the desktop project in CI remains the last check before
  merge.
* Manual play: `npm run dev`, then `<preview>/hexmatch/?loop=new&unlimited=0` —
  tune a Depot and watch its lorry pull away from its neighbour's; the shipped
  loop (`<preview>/hexmatch/?unlimited=0`) looks exactly as it did.

## Acceptance

- [x] Every connected Depot shows a moving vehicle; disconnecting stops it
      (plan + integration, integration test above).
- [x] Vehicle speed visibly correlates with the Depot's output rate (`rate` is
      the clock's own factor; a tuned Depot's lorry outruns an untuned one's by
      exactly the ratio of their rates).
- [x] With vehicles disabled, income is unchanged — unit test.

## Follow-ups (not this ticket)

* Rail's 1.6× transport factor (L2, #216) will reach the lorry pace for free:
  `truckRateFor` already reads `depotTickRate`, so the day `transportFactor`
  returns 1.6 for a rail-linked Depot its lorry speeds up with its clock.
* If the new loop ever ships multiplayer, `TruckWire` needs a `rate` field
  (guests draw from `leg/t/reverse` today, so nothing breaks meanwhile).