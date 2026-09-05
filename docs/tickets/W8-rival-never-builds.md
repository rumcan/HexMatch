# W8 — The rival never builds a single tile (AI deadlock)

**Status:** FIXED — 2026-09-05, on `arena/01a0717e-hexmatch`. See
[Resolution](#resolution-2026-09-05) at the bottom.
**Filed:** OPEN — found by the Priority-1 play-test, 2026-09-05.
**Severity:** HIGH. Step 5 of the core loop ("the rival builds its own road")
does not happen in a large fraction of games. The rival is a scoreboard entry
with 0 VP and 0 income for the whole match.
**Area:** `src/iso/ai.ts`, `src/iso/game.ts` (rival placement).
**Not to be confused with:** W3 ("the rival never builds"), which was fixed by
giving the AI its own owner-scoped network and a free-track allowance. Those
fixes are in place and working — this is a *different* deadlock that survives
them.

---

## What a player sees

Place a factory, connect a harvester, play for several minutes. The rival's
road network never appears. Its VP stays at 0, its purse never moves, and it
never contests an industry. The player wins by default.

## Reproduce (deterministic)

Seed 1337, player factory at (23, 22) — the rival is placed at (2, 2), which is
**rough** ground:

```ts
const grid = generateMap(1337);
const track = createTrack();
const econ = { grid, track, harvesters: [],
  factories: [{ owner: "ai", ownerId: 2, tx: 2, ty: 2 }] };
for (let i = 0; i < 6; i++) {
  aiBuildStep(econ, econ.factories[0],
    { stock: { stone: 12, ore: 0 }, purse: { stone: 12, ore: 0 }, free: 12 }, i + 1);
}
// → track.owner has zero tiles owned by 2, zero harvesters, every turn.
```

Confirmed end-to-end in a real DOM run of the built app (`?seed=1337`, factory
at (23,22), 8 injected AI turns): rival-owned tiles = 0, rival harvesters = 0,
`vp = { you: 3, ai: 0 }`, while the rival's factory had **25/25 industries and
671 tiles of walkable ground** in range.

### How often

Sweeping every legal player-factory tile (step 2) and simulating 4 AI turns:

| seed | placements | rival lands on rough | rival builds **0 tiles** |
|------|-----------:|--------------------:|------------------------:|
| 1337 | 160        | 51                  | **51 (32%)**             |
| 7    | 157        | 37                  | **37 (24%)**             |
| 2024 | 165        | 84                  | 0                        |

Rough ground alone is not enough (seed 2024 has 84 rough placements and no
deadlock) — the second ingredient below is required. Where both are present
the failure rate was **100%** (51/51 and 37/37).

## Root cause — three faults that compound

1. **Degenerate candidate wins the ranking.**
   `planCandidates` scores candidates with
   `scarcity × output / Math.max(0.3, path.cost)` (`src/iso/ai.ts:284`).
   A candidate whose path is a single tile — a harvester spot that *is* an
   existing network tile, e.g. the rival's own factory tile — has `path.cost`
   `0`, so it is divided by the 0.3 floor and scores ~3.3× a one-tile build,
   ~10× a three-tile build. It sorts first, always.

2. **Rail-first never falls back.**
   `planCandidates` tries `rail` first and bails out of the loop as soon as
   rail produced *any* candidate (`src/iso/ai.ts:253`, `290`). Rail cannot be
   built on rough ground (`TRANSPORT.rail.onRough === false`), so when the
   top rail candidate sits on rough, road is never considered.
   `game.ts:293` places the rival with a **road** legality test only
   (`canBuildOn(grid, "road", x, y)`), so the rival is routinely handed a tile
   where rail is impossible.

3. **A no-op turn is reported as a real turn.**
   `executeCandidate` silently `continue`s past tiles it cannot build
   (`src/iso/ai.ts:329-330`) and still returns an outcome object, so
   `aiBuildStep` returns non-null and `aiTick` treats the turn as spent
   (`src/iso/game.ts:478`: `if (!out) return;`). The AI re-picks the same
   doomed candidate every 9 s, forever.

**Contributing:** even in the road case the harvester is never placed, because
`isServiced` (`src/iso/economy.ts:95`) only looks at the four *neighbours* of
the harvester tile — track laid **on** the tile the depot stands on does not
count as servicing it. So the degenerate "build one tile under the factory"
plan yields no harvester either.

## Acceptance

1. Unit test: with seed 1337 and the rival at (2,2) (and at every other legal
   rival tile), four `aiBuildStep` turns lay at least one tile and place at
   least one harvester that is serviced. Fails on current `main`.
2. Unit test: `planCandidates` never returns a candidate whose path would
   build zero tiles. Either exclude paths of length 1 that contain no new
   tile, or include the "already built" tiles in the buildability test.
3. Unit test: `aiBuildStep` returns `null` (not a truthy no-op) when it did
   not place a harvester and did not build a tile, so `aiTick` can try the
   next candidate / the other transport kind on the following turn.
4. `planCandidates` must fall through to `road` when the rail candidate is not
   buildable, not merely when it is absent.
5. The rival-placement search in `game.ts:291-298` should prefer a tile that
   is legal for **rail** too (`canBuildOn(grid, "rail", x, y)`), or at least
   verify a buildable plan exists before committing the tile.
6. 333 unit tests pass; `npm run typecheck` clean.

## Out of scope for this ticket

- Do NOT re-tune the scoring weights (W3's `scarcity × output / cost` shape is
  the owner's call) beyond removing the degenerate-path dominance.
- Do NOT touch track ownership (W2) or the free-allowance cost model (W1).
- See also **W9** (free setup track pays for rail) — a separate, smaller issue.

---

## Resolution (2026-09-05)

All three faults fixed, plus the rival-placement search (acceptance 5) and the
contributing `isServiced` blind spot — the latter is handled in the AI's plan
filter rather than by changing `isServiced`, because `linkedBy` has the same
neighbours-only view: a depot serviced by track under its own tile would still
have no connection, no VP and no yield, so teaching `isServiced` to count that
tile would only move the dead end downstream. The AI now refuses to plan it.

Measured over the same search space the ticket used.

| seed | legal rival tiles | built **0 tiles** before | after the fix | of which enclaves |
|------|------------------:|-------------------------:|--------------:|------------------:|
| 1337 | 160 | **51 (32%)** | **0** | 1 — `(2,2)` |
| 7    | 157 | **37 (24%)** | **0** | 0 |
| 2024 | 165 | 0 | **0** | 1 — `(2,14)` |

"Enclave" = a tile whose road-legal component contains no harvester spot but
itself, i.e. water and industry footprints wall it in. No AI change can build
from one; the fix is to never place the rival there (fault 3 below). Across all
482 player placements swept on those three seeds, `chooseRivalFactorySpot` now
commits **0 enclaves and 0 rail-illegal tiles**.

### What changed

| file | change |
|------|--------|
| `src/iso/ai.ts` | new `planFeasibility()` — the executability + servicing test a candidate must pass; `planCandidates` filters on it; `aiBuildStep` walks the ranked list and returns `null` for a turn that achieved nothing; new `chooseRivalFactorySpot()` |
| `src/iso/game.ts` | `placeFactory` places the rival with `chooseRivalFactorySpot` instead of the road-only farthest-tile loop; new `__iso.placeFactory` test twin |
| `tests/unit/iso-ai.test.ts` | +10 focused W8 regressions (feasibility, degenerate ranking, no-op turns, rival placement) |
| `tests/unit/iso-ai-sweep.test.ts` | new — the whole-map sweeps (slow, so it is its own file) |
| `tests/unit/helpers/rival-map.ts` | new — `canReachASpot` (the enclave predicate: one BFS over road-legal ground) and `rivalSearchTiles` |
| `tests/unit/iso-game.test.ts` | +2 — the real setup click hands the rival a rail-legal, reachable tile, and four real `aiTick`s build track, a harvester and VP |

### The three faults, one by one

1. **Degenerate candidate wins the ranking.** A candidate is now rejected
   unless its plan is *viable*: every path tile legal for the transport kind,
   AND the harvester serviced once that track is laid. The one-tile
   "path" onto the AI's own factory tile is not viable — `isServiced` looks at
   the depot's four *neighbours*, so track laid under the depot services
   nothing — so it can no longer be ranked at all, let alone first. The
   scoring formula itself is untouched (`scarcity × output / max(0.3, cost)`),
   per the out-of-scope note.
2. **Rail-first never falls back.** Unbuildable rail plans are rejected inside
   the rail pass, so `out` stays empty and the loop falls through to `road` —
   the fall-through is now triggered by "cannot be built", not only by "was
   absent".
3. **A no-op turn reported as a real turn.** `aiBuildStep` walks the ranked
   candidates and returns the first that lays a tile or places a harvester;
   if none does, it returns `null`, so `aiTick`'s `if (!out) return;` sees the
   truth. `executeCandidate`'s skip-unbuildable behaviour is kept as a guard.
4. **Rival placement (acceptance 5).** `chooseRivalFactorySpot` ranks legal
   tiles rail-legal-first, then farthest, then tile index, and probes the top
   of the ranking with a real `bestCandidate` so a tile is only committed when
   a buildable plan exists for it. Deterministic, and bounded (8 probes).

### One correction to the ticket's acceptance 1

Acceptance 1 asks for the rival **at (2,2)** on seed 1337 to lay a tile and
place a harvester in four turns. That tile cannot support any build: it is
ROUGH, water at `(2,1)`, `(1,2)` and `(3,2)`, and the `oil_rig` footprint at
`(2,3)` is its only land neighbour. Its road-legal
component is the single tile itself, so there is no path to any harvester spot
and no plan of any kind exists (this is true with an unlimited purse too). It
is an enclave, and it is one of the two the sweep finds across the three seeds
(`(2,14)` on seed 2024 is the other).

The fix for that tile is acceptance 5, not acceptance 1–4: the rival is never
*placed* there any more. Both halves are tested — `iso-ai.test.ts` asserts
`(2,2)` is an enclave and that a truthy no-op is never returned from it, and
the sweep asserts every **non-enclave** legal tile builds. The game-level test
asserts the real setup click with the player at `(23,22)` (the ticket's repro)
no longer hands the rival `(2,2)`.

Acceptance 2 was likewise implemented as the stronger "no candidate can be a
no-op" invariant rather than a blanket ban on zero-tile paths: a zero-build
candidate is kept **only** when the trunk already runs beside an uncovered
industry and the turn places a serviced harvester for free. Banning that shape
outright would leave the rival walking past free harvesters — and stalling
outright once every remaining candidate was free.

### Acceptance

1. ✅ Sweep, seed 1337 (and 7, 2024): every legal non-enclave rival tile lays
   ≥1 tile and lands ≥1 serviced harvester — `iso-ai-sweep.test.ts`. On the
   pre-fix code this is exactly the population the ticket measured deadlocking
   (51/160 on seed 1337, 37/157 on seed 7), so the sweep is red there and
   green here.
2. ✅ `planCandidates` never returns a candidate that would achieve nothing;
   every returned plan is executable and services its harvester
   (`planFeasibility(...).viable`) — asserted per candidate across the sampled
   sweep. See the refinement note above.
3. ✅ `aiBuildStep` returns `null` for a turn that placed no harvester and
   built no tile — `iso-ai.test.ts`, "a no-op turn is reported as no turn".
4. ✅ Rail falls through to road when the rail plan is not buildable —
   `iso-ai.test.ts`, "falls through to road when the rail plan cannot be built"
   plus the rough-factory synthetic ("never offers a path that lays nothing").
5. ✅ `chooseRivalFactorySpot` prefers rail-legal tiles AND verifies a
   buildable plan exists before committing — 3 unit tests in `iso-ai.test.ts`
   plus a sampled sweep over every 4th player placement in
   `iso-ai-sweep.test.ts`; wired into `game.ts` and covered end to end by the
   two new `iso-game.test.ts` tests.
6. ✅ **352 unit tests pass** (333 before: +19 across this ticket and G9);
   `npm run typecheck` clean; `npm run lint` 0 errors.

### Verified end to end

`tests/unit/iso-game.test.ts` boots the real game in jsdom, drives the real
`placeFactory` through the new `__iso.placeFactory` twin, and runs four real
`aiTick`s: the rival ends with owned track, a harvester, and `vp.ai > 0`
(it was `vp = { you: 3, ai: 0 }` with 0 owned tiles before). The W3 test
("N aiTicks grow the rival's track…") still passes unchanged.

### Not covered

The sandbox has no browser, so `npm run test:e2e` could not be run here; the
playwright suite asserts CSS occlusion, which this run cannot. Worth a pass in
a real browser before closing the ticket on the play-test report.
