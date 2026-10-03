# TOWN-2 (#653) — organic towns

**Owner playtest (2026-10-03):** "There should be bigger plots and diagonal
roads. More interesting towns and cities. Not perfect squares."

## The option

New map option **`layout`** — `"grid"` (default) or `"organic"` — riding the
same chain of custody as the other map features (`src/iso/map-options.ts`,
`MatchSettings.map` in `src/net/match-settings.ts`):

- **New games from the menu generate `organic`.** Under the unit-test runner
  the default stays `grid`, so every seed-pinned suite keeps its maps.
- **A resumed save keeps the plan it was generated with.** The save's `map`
  record carries `layout`; a record without the key predates TOWN-2 and
  regenerates `"grid"`.
- **In a networked room the host's record wins** (a guest's `?layout=` is
  ignored), same as every other map feature.
- `?layout=organic` / `?layout=grid` is a new-game URL param; a URL never
  re-terrains a resumed save.
- Story contracts, scenarios and the Starter Island keep their tuned
  (`grid`) towns.

## What an organic town is

Still the 3-tile street lattice (`TOWN_BLOCK` in `src/iso/grid.ts`) for its
core, then, all seeded from the map seed:

1. **Irregular outline** — each corner may lose a 1×1 or 2×2 bite, and three
   2-wide notches (2–3 blocks deep) are cut into the middle of distinct
   edges (`organicBlockMask`). Notches are holes *inside* the town's final
   bounding box, so no organic town reads as a rectangle (pinned: bounding
   box fill < 85%).
2. **Diagonal avenue(s)** — one 45° street carved through the town's middle
   on the lane tiles beside the centre block (the centre stays a 2×2 block at
   the town origin), sometimes a second crossing it around the plaza
   (`organicTownLayout`). Consecutive avenue tiles carry the existing #440
   diagonal road links, stamped onto the track at boot by
   `seedTownDiagonals` (track.ts) right after `seedTownRoads`. Pinned: every
   organic town has a diagonal run of ≥ 6 tiles.
3. **Bigger plots** — block pairs merge at `ORGANIC_PAIR_CHANCE` (0.5, vs the
   `shapes` option's 0.25) into 2×4 / 4×2 plots; adjacent merges stack into
   whole superblocks with a long building each (the existing `shapes` art
   path draws them). Pinned: every organic town has a plot ≥ 2×4.
4. Lots fronting an avenue are **1×1 wedge lots** (`Town.organicWedges`) —
   trees, parks and lawns, never block or long buildings, so the diagonal
   keeps its sliced-lot edge.

## Staying buildable

- Bites open onto the country around the town; when the lanes or the ring
  road fence one anyway, `openOrganicCourts` cuts a **gate** (removes one
  fence tile, keeping the streets connected and every lot's frontage) so the
  pocket stays open ground instead of becoming the enclave the generator's
  reachability checks refuse. A pocket no gate can open rejects the
  candidate; the town is drawn from another centre.
- Everything downstream is unchanged: every lot touches a street, the
  streets ride one network with the public highways, the ring road still
  attaches to the inter-town highways, traffic lights and ambient cars work.

## Compatibility

- `layout` absent → `"grid"` → **every pre-TOWN-2 seed is byte-identical**
  (pinned: default vs explicit-`grid` deep-equal on the pinned seeds; the
  full existing suite passes untouched).
- The saved town data is the stored houses/roads, so a saved organic town
  reloads as-is; the MP wire field is optional and host-owned.
- One latent grid-plan quirk is fixed **for organic towns only**
  (`townLayout`'s `fullLaneExtent`): a town whose `span` is a multiple of 3
  could leave its westmost block column without a street lane; grid maps
  keep the old behaviour byte for byte.

Targeted tests: `tests/unit/town-2-organic.test.ts` (new).
