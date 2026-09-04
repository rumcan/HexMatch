# HexMatch — gameplay changes (TK-series)

Your eight gameplay/design changes, restated as implementable tickets. **These assume a working, playable game** — several of them (rail, vehicles→harvest) only make sense once the W-series logic bugs (`HexMatch-open-backlog-v11.md`) are fixed and once the Kenney art migration lands, because they reference buses/trains and the Processing Plant.

**Do the W-series bug fixes and the Kenney art migration first.** Then this. Sequencing note at the end.

Where a TK item overlaps an open bug, I've flagged it so you don't fix the same thing twice.

---

## TK-001. Rebind map panning to middle mouse; left-click is build-only
`[input]`

Panning moves to the **middle mouse button**; left-click is reserved exclusively for placement, to stop accidental build-while-panning.

- In the iso input handler, move the pan drag from left-button to middle-button (`button === 1`).
- Left-button (`button === 0`) only ever hits the place/select path.
- Keep touch panning as-is (one finger), and keep the existing wheel zoom.

**Acceptance:** left-drag never pans; middle-drag pans; left-click places or selects; no accidental placement while panning.

---

## TK-002. Rail is an independent network, not a road upgrade
`[gameplay] [core]`

Today rail and road share the network model, and there's a road→rail in-place upgrade. Change rail to a **separate, expansive network that can cross roads**.

- Rail gets its own connectivity flood, independent of road — a factory connected by rail is connected even with no road.
- Rail and road may **cross** (level crossing) without merging networks.
- Remove or rethink the in-place road→rail upgrade if it conflicts with "independent network" (a rail tile is built as rail, not upgraded from road).
- **Fix the initialisation orientation bug:** rail placed on the first tile shows the wrong sprite orientation. This is the same class as the old road remap — check the rail mask→sprite mapping and its initial state.

**Overlap flag:** this interacts with **W2** (track ownership) in the bug backlog. Do W2 first — once track has an owner and per-player networks work, making rail its own network on top of that is a smaller change. Don't build TK-002 on the current ownerless shared track.

**Acceptance:** a rail-only connection works with no road; rail crosses road at a crossing without joining networks; a freshly placed rail tile shows the correct orientation; the 16-mask rail test passes.

---

## TK-003. Replace factory and harvester sprites
`[assets]`

Superseded by the Kenney migration — do it there, not here. The factory becomes a larger Kenney industrial building (K3); the harvester becomes a **bus/train terminal** Kenney asset (K3/K5) rather than the current depot. Listed here for traceability; the actual work is K3.

**Acceptance:** covered by K3's acceptance.

---

## TK-004. Vehicles move along placed roads
`[feature] [rendering]`

Investigate then implement buses/trains moving back and forth along built track. The Kenney vehicle set (K5) has directional sprites, so the art supports it.

**Feasibility notes (from the asset check):**
- Vehicles have `_N/_NE/_E/_SE/_SW/_NW` directional frames — a moving vehicle swaps frame by heading. No rotation maths needed, just pick the frame.
- A vehicle animates on the **overlay layer** (the 60fps layer), not the cached structure layer, so it doesn't invalidate chunks each frame.
- Path: a vehicle walks the tiles of a connected route between a harvester and the factory, reversing at each end. The connectivity flood already knows the route.
- This ties into **TK-007** — the vehicle's arrival at the plant is what triggers resource spawns. Build the movement first, then wire arrival to the plant.

**Acceptance:** at least one vehicle travels a connected route, picking the correct directional sprite per segment, reversing at the ends, animating smoothly on the overlay layer without stuttering the map.

---

## TK-005. Bigger map, a few towns, cap resources at 2 nodes each
`[map]`

- Increase map dimensions (coordinate with **K0** — Kenney tiles are 2× the pixels, so "bigger" is in tiles, and the on-screen size depends on the new tile constants; decide the two together).
- Generate a small number of **towns/cities** — clusters of Kenney residential/commercial buildings — during map gen.
- **Cap each natural resource at 2 nodes max** (currently the quota is higher). So at most 2 ore mines, 2 forests, etc.

**Overlap flag:** the resource cap changes `INDUSTRY_QUOTA` in `grid.ts`, which the economy is tuned against — expect to re-touch the E8 economy numbers after.

**Acceptance:** map is larger; towns appear as building clusters; no resource type has more than 2 nodes; every resource still appears at least once; determinism test still passes (same seed → same map).

---

## TK-006. First building must be placed in a town's radius
`[gameplay]`

The player's first placement (the factory) must fall within the radius of a generated town/city (depends on TK-005 towns existing).

- During setup-factory, restrict legal tiles to those within a town radius; reject/ignore clicks outside it with a clear prompt.
- The setup highlight (the U2 footprint preview) should visually indicate the legal town area.

**Acceptance:** the factory can only be placed within a town radius; the legal area is shown during setup; placing outside is refused with a message.

---

## TK-007. Overhaul HexMatch: rename to Processing Plant, remove the bomb, tie spawns to vehicle arrival
`[gameplay] [ui]`

Three changes to the match-3:

1. **Rename "Quarry" → "Processing Plant"** everywhere in the UI (panel title, banners, toasts, mobile nav label).
2. **Disable time-based bomb spawning** — the board currently spawns bombs on a timer (the `blockUntil`/fog/collapse mechanics or a bomb spawn in `board.ts`). Turn off the unintentional time-based one.
3. **Tie resource-number spawns to vehicle arrival** — instead of tokens spawning on the 20s clock (or on connection, as J1 wired), a resource token spawns on a gem **when a bus/train physically arrives at the plant** (TK-004). This makes the transport loop drive the match-3 directly: no vehicles arriving → no new resource tokens.

**Overlap flag:** this changes the J1 harvest-gating model. Right now tokens spawn when a connection completes and harvest is gated by network reach. TK-007 makes *arrival* the trigger instead of *connection*. That's a real design shift — the network still gates what's *possible*, but a vehicle trip is what *delivers*. Make sure the gate (unreachable cargo pays nothing) still holds on top of the new arrival trigger.

**Depends on TK-004** (vehicles must move and arrive before arrival can trigger anything).

**Acceptance:** the panel reads "Processing Plant"; no bombs spawn on a timer; a resource token appears on the board only when a vehicle reaches the plant; unreachable cargo still never spawns.

---

## TK-008. Auto-route black-market sabotage to the single rival
`[gameplay] [ui]`

With only one rival, skip manual target selection — any purchased sabotage (Blockade, Frost, Smog, etc.) applies to the rival automatically.

- Remove the targeting step/crosshair mode for black-market actions.
- On purchase, apply the effect directly to the rival.

**Overlap flag:** black-market actions spend gold, and **gold is currently broken (W5)** — `onGold` isn't wired, so you never accumulate gold to spend. Fix W5 first or none of the black-market actions are testable.

**Acceptance:** buying a sabotage applies it to the rival with no targeting step; the effect fires; it costs gold (once W5 is fixed).

---

## Sequencing across all three tracks

The project now has three parallel bodies of work. Suggested global order:

1. **W-series bug fixes** (`v11`) — the game must actually be playable first. W5 (gold) and W2 (track ownership) in particular gate TK-008 and TK-002.
2. **Kenney art migration** (`kenney-art.md`, K0–K6) — the art-direction change. K0 gates everything visual.
3. **TK gameplay** (this doc) — in this internal order: TK-001 (input, trivial) → TK-005/TK-006 (map + towns) → TK-002 (rail network, after W2) → TK-004 (vehicles, after K5) → TK-007 (plant + arrival, after TK-004) → TK-008 (sabotage, after W5). TK-003 folds into K3.

Don't interleave the art migration and the gameplay changes in one session. Each ticket, one session, stop at its acceptance block.
## Status — implemented in this PR (2026-09-04)

The W-series bug fixes and the Kenney art migration (K0–K6) are already landed
in the codebase (`src/iso/`, `src/game/`), so the tickets below were assessed
against the live iso build and the ones marked ✅ were completed here.

- ✅ **TK-001 — Rebind map panning to middle mouse; left-click is build-only.**
  `src/iso/game.ts` input handlers: a mouse pans only on `pointerType ===
  "mouse" && button === 1`; left button (0) only reaches the build-drag / click
  paths and never seeds a pan; the right button no longer builds (its old
  `isPrimary` drag could start a road). Touch gestures are unchanged. Coverage:
  new e2e case (`tests/e2e/iso-game.spec.ts`) proving left-drag neither pans
  nor places during setup while middle-drag pans and a plain left click still
  places.

- ✅ **TK-008 — Auto-route black-market sabotage to the single rival.**
  The targeting crosshair is gone. Buying **Blockade** now spends the gold and
  immediately blockades the industry that costs the rival the most current
  yield — computed by the new pure helpers `industryClaimValues` /
  `pickBlockadeTarget` in `src/iso/economy.ts` (fallbacks: the best industry
  inside the rival's harvester catchments, then the industry nearest the rival
  factory; refunded if there is nothing to block). All crosshair plumbing was
  deleted: `blackMode` in `src/iso/game.ts` and `banditMode` /
  `setBanditMode` / `cancelBlackMode` / `onCancelModal` in `src/game/ui.ts`.
  Frost/Girders/Smog/Repair/Security already fire immediately (no targeting
  step); Frost/Girders/Smog act on the shared quarry board as before. Unit
  coverage in `tests/unit/iso-economy.test.ts` and a one-click DOM purchase
  test in `tests/unit/iso-game.test.ts`.

- 🚧 **TK-002 — Rail as an independent network.** Mostly landed already: rail
  is its own layer with owner-scoped, per-layer component floods
  (`buildComponents`), a tile carrying road+rail is a level crossing that
  draws road + rail + `crossing` (`renderer.buildDrawList`), and all 16 rail
  masks exist as derived sprites. Not changed here: the road→rail in-place
  upgrade cost (`UPGRADE_COST`) and the shared *build* flood
  (`playerNetwork` floods both layers) still treat a crossing as upgradeable
  in place — revisit together with W2 ownership semantics.

- 🚧 **TK-004 / TK-007** — vehicles are art-only (`src/iso/vehicles.ts`);
  movement, arrival-triggered spawning and the Processing Plant rename are a
  single dependent chunk and were not started.

- 🚧 **TK-005 / TK-006** — map is 32×32 with no towns and `INDUSTRY_QUOTA` is
  not capped at 2; towns + first-placement radius are a mapgen/economy chunk
  and were not started.

- **TK-003** — superseded by the landed K3 art migration.
