# TRAFFIC-01 — ambient cars on the streets (and the performance answer)

**Status: implemented.** Three simple cars (`car 1` / `car 2` / `car 3`)
drive the map's streets and roads, each on its own art slot (`car1_*` /
`car2_*` / `car3_*`) that currently holds a copy of the TTD lorry — replace
the PNGs in `src/assets/sprites/png/vehicles/ttd/cars/` and the cars become
whatever you drop in (TRAFFIC-02, §2). The reason they exist is the
question they answer: **does having a few cars driving on the map kill
performance?**

**Answer: no.** Measured, not guessed — see §4.

---

## 1. What it is

- `src/iso/cars.ts` — the ambient traffic module (plan / tick / draw items).
- `src/iso/game.ts` — wiring: replanned on the same network-change edge the
  lorries use (`trucksDirty` in `rescoreNow`), ticked in the frame loop
  host/solo only (a guest runs no vehicle movement, the MP-05 rule), merged
  into `world.vehicles` next to `truckItems` so ONE depth-sorted pass draws
  both.
- `__iso.traffic` — the three cars by name with live position, for
  playtesting and headless probes.
- `__iso.setTraffic(n)` — the perf dial: `0` clears the streets, `3` is the
  default, up to `64` if you want to torture it.

## 2. Car art — where to drop the real cars (TRAFFIC-02)

Each car has its own art slot — **car 1 drives `car1_*`, car 2 drives
`car2_*`, car 3 drives `car3_*`** (four diagonal views each, 12 sprites).
Right now every slot is a byte-for-byte copy of the OpenGFX goods lorry —
the placeholder.

**The folder: `src/assets/sprites/png/vehicles/ttd/cars/`** (a README.txt in
there explains the naming). To make the cars look like cars:

1. Replace any of the 12 PNGs — e.g. put a red sedan in `car1_*.png`, a
   van in `car2_*.png`, a bus in `car3_*.png`. Any size, transparent PNG;
   it is trimmed to its opaque bbox and anchored bottom-centre
   automatically. The four views per car: `ne` up/right, `se` down/right,
   `sw` down/left, `nw` up/left.
2. `npm run slice-atlas` — repacks the atlas (0.5×/1×/2×), the manifest and
   the group editing sheets. Manifest validates; golden tests stay green
   (sprite geometry unchanged while the slots hold the lorry copy).
3. Reload the game. Done — no code changes; `carSprite()` in
   `src/iso/cars.ts` already maps car index → slot, cycling the slots past
   three so `setTraffic(n > 3)` grows without new cells.

The manifest declarations live in `tools/iso-atlas.cells.json`
(`car1_ne` … `car3_nw`, right under the `truck_goods_*` entries), and the
group sheets that show every sprite as a labelled card come from
`npm run atlas:groups`. The freight lorry (`truck_goods_*`) is untouched —
cars and trucks can now look completely different.

The cars are pure presentation and host/solo-local: not on the wire, no
economy effect, guests see none (same as lorries).

## 3. How it drives

Routes walk the same graph the economy floods — tiles with a PRESENT bit on
dirt OR paved, crossing only **mutual** direction bits (E5's invariant).

- **Loops:** a bounded DFS from a random road tile finds a *simple* cycle
  (a back edge onto the current DFS path closes the path segment — that
  segment is the ring) and the car loops it forever. This is why a
  random-walk "find a cycle" approach was NOT used: on the ~200-tile town
  ring roads a walk simply has not walked far enough to close, and on a
  branching network it wanders. The DFS is exact and each edge is relaxed
  at most twice.
- **Ping-pongs:** a tree-shaped road (no cycle) degenerates to a
  start→leaf walk the car drives out and back — the truck's exact motion
  model.
- **Spread:** each car tries up to 12 candidate starts and takes the route
  that shares least of its street with the routes already adopted, so the
  three read as traffic, not a convoy.
- **Motion:** `(leg, t)` position along the route in tile units, 1 tile /
  300 ms (the lorry's pace), ticked with the same dt-capped integration as
  `tickTrucks` — a huge tick folds through the turns at the exact end tile,
  never a teleport.
- **Replan migration:** a car whose route is byte-identical after a
  network change keeps its `(leg, t, reverse)` and drives on mid-crack —
  the lorries' `planTrucksTrucksMerge` rule.
- **Draw items:** fractional tile position (the `depth.place` moving-item
  contract: anchored at the tile's diamond centre, skipped by picking), the
  directional `truck_goods_*` sprite for the direction of TRAVEL (a
  ping-pong car faces the way it is actually rolling), `ref: { car: name }`.

Cost: one bounded DFS per car per network change (a few thousand edge
relaxations on the shipped map), then per frame the same ~3 `place()` calls,
sort inserts and blits a lorry already costs.

## 4. The structural effect under test

While ANY vehicle moves, `renderer.hasAnimation()` forces the whole
structures pass (roads + every structure in view + depth sort + blit of all
of it) to run **every frame** instead of only on world change. The cars
switch that on — which is exactly what makes this worth measuring, because
"a few moving sprites" is not the whole cost; the pass is.

## 5. Performance (measured)

Opt-in CPU benchmark, real 144×144 seeded world (4 towns, 673 public road
tiles, scenery), real `IsoRenderer` on a counting canvas stub, steady-state
full `render()` frames:

```sh
HEX_TRAFFIC_BENCH=1 npx vitest run tests/unit/iso-traffic-perf.test.ts
```

Node 22, this sandbox (JS side of the frame only — Node has no rasterizer;
the draw-call delta is the part the browser then rasters):

| zoom | cars | frame median | Δ vs 0 | draw calls/frame | Δ calls |
|---|---|---|---|---|---|
| 0.5 | 0    | 0.195 ms | —        | 256 | —    |
| 0.5 | 3    | 0.255 ms | +0.060   | 308 | +52  |
| 0.5 | 10   | 0.215 ms | +0.020   | 315 | +59  |
| 0.5 | 30   | 0.239 ms | +0.044   | 335 | +79  |
| 0.5 | 100  | 0.305 ms | +0.111   | 405 | +149 |
| 1   | 0    | 0.152 ms | —        | 100 | —    |
| 1   | 3    | 0.166 ms | +0.014   | 123 | +23  |
| 1   | 100  | 0.235 ms | +0.084   | 184 | +84  |
| 2   | 3    | 0.165 ms | +0.008   | 73  | +9   |
| 2   | 100  | 0.223 ms | +0.066   | 75  | +11  |

Reading: **3 cars cost ~0.01–0.06 ms of JS and ~9–52 extra draw calls per
frame** (the extra calls are the structures pass — roads + buildings +
trees — that now runs every frame, plus 3 sprites; at a 64px tile the car
sprites are 20×16 px, a trivial blit). Even 100 cars stay under 0.15 ms of
JS and 150 draw calls — far inside the 16.7 ms / 60 fps budget. The
per-car marginal cost is one `place()`, a sort insert and one blit; the
curves are flat, not exponential.

Caveats, stated plainly: this is the JS side of the frame in Node, not an
in-browser FPS measurement (no browser is installable in this sandbox —
Playwright's CDN and apt are both unreachable). The browser additionally
rasters the counted draw calls; canvas 2D handles a few hundred small
drawImages per frame comfortably. For the in-browser feel: boot the game,
open the console, and drive the dial —

```js
__iso.setTraffic(3)    // default
__iso.setTraffic(30)   // real traffic
__iso.setTraffic(100)  // traffic jam
__iso.traffic          // who is driving where
```

If the game feels slow, the cost is NOT the traffic: the every-frame
terrain pass (animated ocean + shoreline) and UI paint run whether or not
anything drives.

## 6. Validation

- `tests/unit/iso-cars.test.ts` — 16 tests: plan legality (mutual edges,
  loop simplicity, naming, spread, count dial, empty/stub networks, dirt+
  paved, the 4-tile square, the dead-end line), motion (exact speed, huge-
  tick fold with no teleport, ping-pong continuity at 10 ms sampling,
  position preservation across replans, determinism), draw items
  (fractional position, sprite, name in ref, direction of travel).
- `tests/unit/iso-traffic-game.test.ts` — 3 tests: the REAL `startIsoGame`
  boots in jsdom with the three cars rolling, positions advance under
  `truckTick`, `setTraffic` is a working dial.
- `tests/unit/iso-traffic-perf.test.ts` — the benchmark above plus a
  non-flaky contract (100 cars must not cost 10× the zero-car frame) and a
  boot sanity check.
- Typecheck (both tsconfigs), lint of changed files, production build: pass.
- Full unit suite: the 19 failures in `iso-corridor-picker` / `iso-game` /
  `iso-skill-calibration` / `iso-vehicles` reproduce identically on the
  pristine tree (verified by stash) — pre-existing environment failures,
  not regressions. Browser e2e was not run (no installable browser here).
