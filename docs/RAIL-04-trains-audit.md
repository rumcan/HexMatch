# RAIL-04 (#178) — trains and two-stop lines: audit of the shipped rules

*"Implement stored/departing/moving/dwelling/returning/blocked states … start at
depot exit; 1.5s platform dwell … position wagon by cumulative path distance
around corners … replan on graph revision, stop safely on broken routes, return
before one-time 50% resale."* — [issue #178](https://github.com/rumcan/HexMatch/issues/178), parent spec [#142](https://github.com/rumcan/HexMatch/issues/142).

The slice landed in [#199](https://github.com/rumcan/HexMatch/pull/199); this is
the audit of `src/iso/rail.ts` against the ticket, the gaps it closed, and the
tests that pin them. Nothing here re-implements a clause that already held.

## Checklist → where it lives → what pins it

| #178 clause | Implementation | Test |
| --- | --- | --- |
| six states | `TrainStatus` / `TRAIN_STATUSES` | `iso-rail.test.ts` "the train's states and motion", `trainStatusText` rows |
| buy loco + wagon into an **owned** depot | `assignLine` → `depotReaching` (owner-scoped) | "finds a depot that reaches the source, and refuses one that cannot" |
| owned industry platform → owned plant platform, reachable depot | `lineRefusal`, `depotReaching` | "assigns a line only between an industry platform and a plant platform" |
| one active train per connected owner component, on **assignment and merges** | `assignLine` (component of the depot exit) + `buildRail`'s merge guard (`component-conflict`) | "refuses a second train on the same component…", "refuses the merge tile that would join two components with a train each" |
| start at the depot exit | `assignLine` seeds the route with `depotExit` | "starts at the depot exit, departs to the source and dwells 1.5s" |
| 1.5 s dwell | `DWELL_MS` | same test |
| speed = 2× dirt lorry, dt-driven | `RAIL_SPEED = TRUCK_SPEED * 2`, `tickTrains(state, dtMs)` | "runs a train at exactly twice the dirt lorry's pace", "folds a huge dt across tiles without teleporting" |
| wagon by cumulative path distance around corners | `pointAt` + `WAGON_OFFSET` | "carries the wagon behind the locomotive on the same polyline" |
| replan on graph revision | `planLeg` when `planRevision !== revision` | "keeps a rolling train's sub-tile progress when the graph is revised elsewhere" |
| stop safely on broken routes | `planLeg` parks the train `blocked` with `blockedWhy` | "stops safely when the route is cut, and replans when the graph is repaired" |
| return before one-time 50 % resale | `recallTrain`, `sellTrain`, `resold` | "returns home on recall, and only then sells at 50% — once" |
| reuse the lorry motion/draw patterns | `trainItems` mirrors `truckItems` (`fx`/`fy`, no `ref`); no spawns or ambient loops | "draws structures as footprint items and a train as two moving items" |
| host authority, no parallel rule copies | every rule in `rail.ts`; `game.ts` only applies them, the panel renders `railPanelRows` | `iso-rail-wire.test.ts`, `iso-game.test.ts` RL-4 |
| prices stay configurable | `BUILD_COSTS` (`config.ts`) via `RAIL_COSTS` | "prices rail, platform, depot and train from one table" |

## Gaps found and closed

1. **A depot could be demolished out from under its train.** `demolishStructure`
   only refused a structure whose *tiles* a train occupied, and a stored train
   has no route — so no tile — and a train out on its line is not on the shed
   either. The demolition went through and silently deleted the train and its
   line, refunding only the depot. #142 is explicit: *"disallow demolishing
   rail/structures physically occupied by a train, with visible reason."* The
   shed's train is the clearest case of occupancy, so the demolition is refused
   now (`trainBasedAt`), the toast says why, and the player sells the train
   first — which is where the 50 % lives.
2. **A train stopped safely at its depot could never be sold.** `sellTrain`
   demanded `status === "stored"`, and a route cut at the depot leaves the
   train `blocked` for good — its 4 Ore + 2 Oil were unreachable, and the panel
   offered it a `recall` that could never route. "Returned to depot" is now
   `trainAtHome` (stored, or blocked *on the depot exit*), so the one-time 50 %
   is reachable; the panel offers `sell` for exactly that train and nothing
   else.
3. **Every publish re-sent every train's whole leg.** #142: *"replicate graph
   changes and routes only by revision; train progress via compact updates and
   interpolation. No whole rail array/full routes every frame."* `railToWire`
   now takes a route cache: a leg rides once and again only when it changes
   (identity — `planLeg` always allocates a new array), so a steady-state delta
   carries progress (dist, status, dwell) alone; a join, a resync and a save
   always carry the legs, and a guest that gets a record with no `route` keeps
   the leg it holds.

Smaller wording fix in the same pass: the depot row said "train at home" while
its train was out running; it says "train based here".

## Not gaps

- *"damage-render patterns"*: v1 has no vehicle damage (no fuel, upkeep or
  bandit attacks on trains), so there is no damage state to render; what the
  clause pins — the fractional-moving-item contract — is shared with
  `truckItems` and covered above.
- **Buy and assign are one action.** #178 lists them in sequence, and
  `assignLine` is that single authoritative call: the host checks the purse
  (`game.ts` rolls the purchase back when it cannot pay), the platforms, the
  depot reach and the one-train rule before a train exists. A depot-only
  purchase with no line would have no state to be in but `stored`.
