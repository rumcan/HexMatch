# TOWN-4.3 (#679) — planned towns

**Owner brief (TOWN-4 epic, §2):** "A third layout: `planned`. A seeded master
plan — one straight avenue, a square, real blocks — instead of the grid
lattice or the organic outline. Grid and organic towns must not change."

Implemented as `layout: "planned"` on the existing chain of custody, with the
generator in the new `src/iso/town-plan.ts` (`planTown`, pure: it reads
`terrain`/`occ`/`rng` and writes nothing).

## The option

`layout` is the TOWN-2 map option (`src/iso/map-options.ts`,
`MatchSettings.map` in `src/net/match-settings.ts`). `"planned"` joins the
known names:

- **Opt-in.** The default is unchanged (`grid` under the test runner,
  TOWN-4.5 flips the menu default): absent/unknown → `grid`, and every
  pre-TOWN-4 seed stays byte-identical (fingerprints below).
- `?layout=planned` is a new-game URL param, exactly like `?layout=organic`.
- A save keeps the layout it was generated with (the plan is regenerated
  from the seed, so `Town.plan` is not saved); a room takes the host's
  record; a malformed layout still drops the whole map record.

## What a planned town is

`planTown(cx, cy, terrain, occ, rng, size, industries)` draws one master plan
centred on the HALL tile `(cx, cy)` — `Town.tx/ty`, the square's
avenue-facing centre. The plan works in its own frame (`u` along the avenue,
`v` across it) and folds it onto the world with `axis` (`"x"`/`"y"`) and
`mirror` (`±1`), both chosen by MEASUREMENT (the longer free corridor each
way), never by an RNG draw, so the same centre always draws the same plan.

Frame, with the hall at `(0, 0)`:

| piece        | plan frame                                  |
| ------------ | ------------------------------------------- |
| avenue       | `v = −2, −1` (two carriageways), `u ∈ [U0, U1]` |
| square       | `v ∈ [0, 3]`, `u ∈ [−1, 2]` (4×4; 6 wide large) |
| hall         | `(0, 0)` — the plaza's avenue-edge centre   |
| row A blocks | between the avenue and the parallel street   |
| row B blocks | the outer ribbon beyond the parallel street  |

- **Avenue**: straight, axis-aligned, two tiles wide, extended to both plan
  edges; length 22–28 tiles standard, 32–40 large. Both carriageways must be
  free for the whole run, and the run must reach `minHalf` (11 / 16) either
  way from the hall — otherwise the centre is rejected and `placeTowns`
  tries another. The avenue's four end tiles are `plan.termini`.
- **Square**: at the avenue's midpoint on one side, 4×4 (4×6 large), its
  avenue-facing centre tile the hall/church (`Town.tx/ty`).
- **Cross streets**: every 6–8 tiles (`period` drawn from `[6, 7, 8]`) from a
  seeded 0–2 phase, drawn per side with a 1–2 tile stagger on the far side,
  so many crossings meet as T-junctions. The parallel street spans the first
  to last cross street — both ends are junctions, never stubs.
- **Spur lanes** (outer residential): every surviving cross street continues
  one block deep into the outer ribbon and ends in a turning circle
  (`culDeSacs`) — the one legal dead end (BUILD item 6).
- **Blocks**: `row A` is 4–5 deep, `row B` 2–3 (3–4 large). Every street edge
  carries depth-2 lots (`interior` records the yards behind them); the
  corner lots front the busier street (avenue > street > lane).
- **Districts**: 0 = the village beside the avenue, 1–3 successive rings
  outward, from proportional rings (0.45 / 0.7 / 0.9 of the plan's half
  extents). Zones: downtown (avenue edge, `|u| ≤ 10`, district ≤ 1), inner,
  outer, edge (district ≥ 3), plus the civic plots (`CIVIC-1` candidates):
  a post office beside the plaza, a school and a hospital in the outer
  ribbon, a stadium on the widest outer block (`PLAN_CIVIC`).
- **Terrain**: a block whose ground is not free (water, rivers, steep
  slopes, industry halo within `PLANNED_INDUSTRY_SEP`) is dropped whole,
  streets included. A plan that loses more than 40% of its ideal blocks, or
  keeps fewer than 6 real blocks (with lots), is rejected — `planTown`
  returns `null` and the town tries another centre.

### Tuning constants (`KNOBS` in `src/iso/town-plan.ts`)

| constant                | standard | large |
| ----------------------- | -------- | ----- |
| `aveMin` / `aveMax`     | 22 / 28  | 32 / 40 |
| `squareU` × `squareV`   | 4 × 4    | 4 × 6 |
| `depthsA` (row A)       | 4–5      | 4–5   |
| `depthsB` (row B)       | 2–3      | 3–4   |
| `minHalf` (avenue run from the hall) | 11 | 16 |
| `sep` (`plannedTownSep`, Chebyshev between centres) | 44 | 64 |

Cross-street period `6–8`, stagger `1–2`, district rings `0.45/0.7/0.9`,
`PLANNED_INDUSTRY_SEP = 8` (mirrors grid's `TOWN_INDUSTRY_SEP`),
`TOWN_HOUSES_MIN = 18` still gates the committed village.

`placeTowns` sizes the plan from the map it is drawing on (TOWN-4.1's live
`MAP_W`): standard → the left column above, large → the right one.

**RNG draw order** (determinism contract): avenue length, `dA[0]`, `dA[1]`,
`dB[0]`, `dB[1]`, then per side the cross-street `period` and `phase` (side 1
adds the stagger draw). Lot widths use a pure `hash(u, v)`. Nothing else
draws.

## What the town owns at generation

- `Town.houses` — every district-0 LOT tile (the ground `townBuildings` may
  build on, and what CIVIC-1's budget spends).
- `Town.roads` — every district-0 street tile **plus the whole avenue** (the
  spine is laid at full length from tier 0), stamped `seedTownRoads` as
  always.
- the square's tiles — town ground too, stamped `TOWN_OCC` beside the
  houses/roads (the plaza is public ground, not a lot and not a lane).
- Districts 1–3 are **reserved, not stamped**: they stay free land for the
  player, exactly as L17's grown ring does, until TOWN-4.4 (#680) reveals
  them on the town's tier schedule (player-built tiles skipped, streets
  trimmed back to their last junction). `plan.reserved` is the tile list that
  the PP-14 industry repair reads so growth never lands on a resource node.
- A planned town carries **no** `organicDiag`/`organicWedges`: the art pass is
  the grid one, over the district-0 village.

## Highways and boot stamping

- `publicRoadTiles` keeps its incremental Prim growth, but a component that
  holds a planned town's `plan.termini` is linked **to a terminus** (the
  nearer avenue end) instead of to whichever town tile the flood reaches
  first — so every highway enters a planned town at an avenue end. A map with
  no planned towns has no doors and keeps the historical targets, so every
  existing seed's highways stay byte-identical.
- `seedTownAvenues(track, grid)` → `stampAvenue(t, plan)` (track.ts) lays
  **both carriageways as ordinary public road** for now. The one line to
  change when TOWN-4.2 (#678) lands is inside `stampAvenue`:
  `// TODO(TOWN-4.2): AVENUE_X/Y tier`. `game.ts` calls it at boot between
  `seedTownDiagonals` and `seedPublicRoads`.

## Verification

- `tests/unit/town-4-3-planned.test.ts` — the master-plan audit on seeds
  1, 2, 3, 7, 42, 1337 (avenue straight/2-wide/22–28, square + hall, ≥ 6
  blocks, road share 20–30%, no stubs, every lot fronting a street, corner
  lots on the busier street, occupancy = houses + roads + square, only
  district 0 committed, highways at a terminus, one road network, industries
  harvestable), plus the option chain and the boot stamp.
- **Legacy byte-identity**: a fingerprint (FNV-1a over terrain, occupancy,
  towns and public roads) pinned for `grid` and `organic` on seeds
  1/7/42/1337, verified equal to a worktree run of the same function on
  `main` @ `c66a1a5`.
- **Generation time, standard 144 map** (single process, warm, one run per
  seed):

  | seed | organic | planned | delta |
  | ---- | ------- | ------- | ----- |
  | 1    | 337 ms  | 401 ms  | +64 ms |
  | 2    | 262 ms  | 327 ms  | +65 ms |
  | 3    | 296 ms  | 382 ms  | +87 ms |
  | 7    | 225 ms  | 266 ms  | +41 ms |
  | 42   | 296 ms  | 395 ms  | +99 ms |
  | 1337 | 265 ms  | 376 ms  | +111 ms |

  Worst delta +111 ms, inside the +150 ms budget; a planned map places the
  same four towns as an organic one. The epic's 44-tile centre separation
  holds on all six seeds (measured 44–50).
- **The large 216 map** (TOWN-4.1 #677, merged while this was in review):
  plans size themselves large — 32–40 tile avenue, 4×6 square, `sep` 64 — and
  the pinned large seeds keep four towns whose plans never share a tile. Where
  four plans cannot be placed at the 64 target, the ladder's floor keeps four
  interlocking plans instead of dropping a town (seeds 1 and 42). Cost: **2.3–5.9 s
  per large planned map vs 0.62–0.70 s organic** — the per-candidate
  `allIndustriesReachable` + `noEnclaves` floods (each a full 216² sweep) run
  ~50–130 times per map and are what selects the four committed towns
  (~45 ms per candidate on the hardest seed). A follow-up can cache or bound
  that; the standard map's budget above is unaffected.

### Two towns (seed 3 t0, axis x; seed 1 t1, axis y)

`A` avenue · `S` square · `H` hall · `+` street · `~` lane · `c` circle ·
`D`/`i`/`o`/`e` downtown/inner/outer/edge lots · `C` civic lot · `.` interior
· `I` industry · `~` water.

```
── seed 3 town 0 @30,130 axis x mirror -1 avenue 25 blocks 8 lots 164 planRoads 96
     ciiiCCCCiiiic
     +iiiCCCCiiii+
     +++++++++++++
...oo+iiiiCSSSSii+ii.....
...oo+iiiiCSSSSii+ii.....
eeeee+DDDDCSSSSDD+DDDDDDD
eeeee+DDDDCSHSSDD+DDDDDDD
AAAAAAAAAAAAAAAAAAAAAAAAA
AAAAAAAAAAAAAAAAAAAAAAAAA
eeeeee+DDDDDDD+DDDDDDDDDD
eeeeee+DDDDDDD+DDDDDDDDDD
....ii+iiiiiii+ii........
....ii+iiiiiii+ii........
      +++++++++
      +eeCCeee+
      ceeCCeeec
```

```
── seed 1 town 1 @41,44 axis y mirror 1 avenue 27 blocks 10 lots 196 planRoads 119
    ..eeAAee..
    ..eeAAee..
    ..eeAAee..
    ..eeAAee..
    ..eeAAeeii
    ..eeAAeeii
    iieeAA+++++++c
    iieeAADDii+iio
c+++++++AADDii+iio
...+iiDDAADDii+ii.
...+iiDDAADDii+ii.
...+iiDDAACCCC+ii.
...+iiDDAASSSS+ii.
...+iiDDAAHSSS+CC.
c+++++++AASSSS+CC.
eoo+iiDDAASSSS+ii.
eoo+iiDDAADDii+ii.
.oo+iiDDAADDii+ii.
eoo+iiDDAADDii+ii.
eoo+iiDDAADDii+ii.
c+++++++AADDii+iio
    iiDDAADDii+iio
    iiDDAA+++++++c
    ..DDAAoooo
    ..DDAAoooo
    ..DDAAoo..
    ..DDAAoo..
```

## Later tickets

- **Large-map generation cost** — the per-candidate reachability/enclave
  floods are the large map's generation cost (above); caching them per
  committed town, or a cheaper local pre-filter, is the obvious next lever.
- **TOWN-4.2 (#678)** — the avenue's one-way AVENUE_X/Y pair: `stampAvenue`
  is the only place that changes (today it paves both carriageways as
  ordinary public road).
- **TOWN-4.4 (#680)** — zoned fill: reveal districts 1–3 on the tier
  schedule, no new stubs (districts only grow along junctions), cul-de-sac
  circles already recorded, `plan.reserved` feeding the industry repair.
- **TOWN-4.5 (#681)** — SHIPPED: the menu default switch. New free-play
  games boot large (216) + planned; every other boot path is unchanged
  (story/scenarios/Starter Island/tutorial/grid under the runner, resumed
  saves keep their record, old rooms resolve the pinned legacy map —
  standard + organic). New rooms carry size + layout explicitly. The two
  traffic ceilings shipped with it: `TOWN_AMBIENT_CAR_CAP` (ambient cars,
  #687's slice) and `FLOW_TOWN_WEIGHT_CAP` (the flow background), both
  pinned at the heaviest tier-3 grid town, so planned streets earn at least
  a grid town's traffic income. Generation: the planned per-candidate
  enclave flood now runs a same-verdict local check first (large+planned
  ≈ 0.6–1.2 s, was up to ~5.5 s; all 36 size/layout/seed digests
  byte-identical before/after). Gameplay guard: per-town factory sites,
  harvester spots, starting reservations and the rival's real opening on
  seeds 1/7/42/1337 (`tests/unit/town-4-5-defaults.test.ts`).
- **TOWN-4.1 (#677)** — the 216×216 map: pass `size: "large"`.
