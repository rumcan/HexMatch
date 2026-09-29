# FLOW-1 — traffic lights, road lines and a traffic simulation that the lorries feel

`src/iso/flow/` is a drop-in module. Its files:

| file | what | imports |
|---|---|---|
| `flow-core.ts` | the simulation: signal controllers, density field, BPR speed, stop lines, incidents | **nothing** (pure) |
| `flow-paint.ts` | canvas painters: stop lines, zebras, street centre lines, signal heads, cones, heat map | types from `flow-core` |
| `index.ts` | bridge to the game (Track, Grid, road graph, road geometry), hooks, `window.__traffic` | game modules |

`hexmatch-traffic.patch` adds the hooks. It changes **only existing files**
(`ambience.ts`, `vehicles.ts`, `cars.ts`, `road-renderer.ts`, about 60 lines in total).
`game.ts` is **not** touched.

```bash
cp -r hexmatch-traffic/src/iso/flow  src/iso/flow
cp hexmatch-traffic/tests/unit/iso-flow.test.ts tests/unit/
git apply hexmatch-traffic.patch
npm run typecheck && npm test
```

## What the player sees

* **Traffic lights at every town junction** (3+ arms, the same set AMB-3 found). Each arm has a
  pole with a real three-aspect head on the inbound kerb. Before this, AMB-3's lights ran but
  were never drawn (`DRAW_STAND_INS = false`).
* **Road lines**: a stop line and a zebra crossing on every signalised arm, plus a dashed centre
  line on town streets. These are baked into the cached road raster, so they cost nothing per frame.
* **Lorries stop at red lights.** This acts on the *economic* pose (the one `tickTrucks`
  integrates and `deliveries` counts), not only the drawn ghost.
* **Congestion slows lorries.** Town centres at rush hour, the approaches to busy junctions, and
  incidents (seeded, rare, placed where the traffic is) all reduce speed. The fixes are a
  higher road tier (more capacity) or a route that avoids the town.
* **Freight priority**: a waiting lorry weighs 2.5× a car in the actuated controller.

## The model (why it is cheap)

```
density[i] ← EMA( background[i] × rush(t) + observed PCU on i ,  τ = 1.5 s )     10 Hz, road tiles only
speed(i)   = max(minSpeedFactor, 1 / (1 + α·(density[i] / capacity[i])^β))       BPR, α = .15, β = 4
capacity   = dirt 2.5 · street 4 · road 6 · highway 12 PCU    × 0.35 under an incident
```

* Each visible car stands for `carPcu = 3` vehicles, so twelve sprites can fill a high street.
* Background demand falls off from each town (`weight × e^(−d/r)`). Highways carry a
  through-traffic floor. `rush(t)` has two peaks per 4-minute "day".
* Each town has one signal controller (the same granularity `lightAspect(seed, townId, axis, t)`
  already uses), so cars, walkers, truck ghosts and lorries all read **one** truth.
  * `actuated` (default): min green 2.8 s, max 9 s, gap-out, switch when the cross street has
    1.6× our demand, amber 0.9 s, all-red 0.45 s, forced change after 14 s. The longest red is
    about 10.4 s, under `JAM_TIMEOUT_MS`, so queued cars never despawn.
  * `fixed`: a bit-exact replica of AMB-3's seeded 9 s cycle.
* Cost: one `Float32Array` pass over the road tiles every 100 ms. Each query is O(1). There is
  no pathfinding and no per-vehicle allocation.

## Safety and compatibility

* Every hook falls back to today's behaviour unless the flow is **live** (ticked within the last
  1.5 s, enabled, and a road network exists).
* **Off under vitest** unless a test calls `configureTrafficFlow({ enabled: true })`, so the
  existing suites keep their exact numbers.
* Nothing is saved and nothing goes on the wire. The host's lorries feel the host's traffic.
  Guests replicate lorry poses exactly as before. In `fixed` mode the lights are identical on
  every client. In `actuated` mode a guest's *drawn* lights follow its own local demand.
* No lorry can be wedged: every red is capped by the controller, and `maxHoldMs = 20 s` is a
  second safety valve per junction.
* `lorryTripsPerMin` (the depot card) still shows the free-flow pace. Use
  `trafficFlowStats()` to show a "traffic delay" readout.

## Flags and console

`?traffic=0` off · `?traffic=fixed` · `?traffic=heat` · `?traffic-impact=0.5`

```js
__traffic.stats()                 // rush, mean/max density, congested tiles, switches, step cost
__traffic.config({ truckImpact: .5, signalMode: "fixed", incidents: false })
__traffic.heat(true)              // congestion overlay
__traffic.incident(40, 52, 30000) // cones on tile (40,52) for 30 s
__traffic.towns()                 // controller phase + per-axis demand
```
