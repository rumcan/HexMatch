# W8 — The rival never builds a single tile (AI deadlock)

**Status:** OPEN — found by the Priority-1 play-test, 2026-09-05.
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
