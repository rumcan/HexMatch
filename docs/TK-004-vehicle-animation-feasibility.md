# TK-004 — Vehicle animation feasibility (buses on roads)

**Ticket.** Investigate whether vehicles (buses) can be animated moving along placed road tiles through the rendering loop.

**Verdict: FEASIBLE — and already working as a spike.** A bus now shuttles between a serviced harvester (depot) and the Processing Plant along the player's own track, depth-sorted against the buildings it drives past, at a constant world-space speed. The movement engine is pure and unit-tested; the arrival event it fires is the seam TK-007 hangs the Processing Plant's token spawn on.

## What shipped in the spike

| Piece | File | Notes |
| --- | --- | --- |
| Slicer cell kind `kind: "sprite"` | `tools/slice-atlas.mjs` | One declared OpenGFX sprite at its natural crop size — no 64×32 ground cell, no footprint normalisation. Optional exact-match `recolor` map (applied **before** blue-key/white-flood) exists for palette-key (1CC/2CC) sheets. Emits `free: true` in the manifest. |
| Free-floating draw items | `src/iso/depth.ts` | `DrawItem` gained optional `wx/wy` (absolute world px, overrides the tile-derived origin; `(tx,ty)` stays the depth-sort anchor) and `flipX`. `place()` passes them through. |
| Movement engine | `src/iso/vehicles.ts` | Pure: `findRoute` (BFS over the owner's OWN mutually-connected track, both layers), `pathPoints`/`segmentLengths` (tile-centre polyline), `vehiclePos` (constant-speed interpolation + travel axis), `createVehicleSystem` (tick + ping-pong + `onArrival`). |
| Renderer integration | `src/iso/renderer.ts` | `hasAnimation()` also fires when any extra item is free-floating, so layer 2 redraws every frame while a bus is on the map. `blit` honours `flipX` (mirror around the anchor column). |
| Game wiring | `src/iso/game.ts` | `vehicles.sync(eco, "you")` runs in `syncWorld()` — exactly when the track changed, never per frame. The rAF loop ticks the system (dt clamped to 100 ms) and appends the buses' DrawItems to `world.extra`. `__iso.vehicles`, `__iso.vehicleArrivals`, `__iso.lastArrivalAt` expose the seam for tests. |
| Art | `tools/iso-atlas.cells.json` | `vehicle_bus_side` (OpenGFX road vehicle 3094, 28×12) and `vehicle_bus_end` (3092, 8×18). Centre anchors are **derived** in the slicer (`[ceil(w/2), ceil(h/2)]`), preserving the Y5/Y6 no-hand-authored-anchor invariants. |

Sprite placement by travel axis: every tile step is (±HW, ±HH) in world space, so the eight step directions collapse into the two screen diagonals. NE/SW steps have opposite-signed deltas → the `/` diagonal → **side view** (flipped horizontally when heading NE, since the sheet's side view faces SW). NW/SE steps → the `\` diagonal → **end view**. All steps have identical length (35.78 px), so a constant speed needs no per-direction correction.

## Findings that shaped the design

1. **OpenGFX road vehicles in `vehiclesroad01.png` are real-colour art, not 1CC/2CC recolour masks.** An earlier dump that mis-took the channel stride suggested pure palette keys; a stride-correct read shows a blue-livery bus with dark windows and a pure-blue `(0,0,255)` sheet backing that the normal crop already keys out. The `recolor` support ships anyway (exact-match, pre-key) for future vehicles that DO use palette keys.
2. **A dedicated slicer cell kind was required.** Plain numeric-`sprite` cells route through `makeGround`, which force-crops into a 64×32 ground cell with a derived tile anchor — workable but wrong for vehicles, which must (a) not carry baked-in terrain and (b) anchor at an interpolated world point. The new kind is otherwise constraint-free; the validator's "sprite covers < half its footprint" building-reservation guard is skipped for `free: true` sprites, which reserve no tiles at all.
3. **Depth sorting needs no new machinery.** A vehicle is a 1×1 DrawItem whose key comes from its anchor tile; because the bus's anchor tile is the segment it is on, the sort interleaves it correctly with buildings it passes. This is the same Tier-1 key every structure uses — vehicles simply move between keys.
4. **The arrival event is cheap and exact.** `createVehicleSystem.tick` fires `onArrival(vehicle, now)` once per plant-end turnaround (the path's far end is by construction the Processing Plant). TK-007 replaces the time-based token clock with exactly this event; until that ticket lands the counter is only exposed on `__iso`.

## Open items for full productionisation (deliberately out of spike scope)

- **8-view rotation.** The spike uses 2 of the 8 available views (side for one diagonal, end for the other). The sheet has four distinct silhouettes per direction pair; picking per-step direction would sharpen corners and junction behaviour.
- **Route flattening.** `findRoute` returns a BFS shortest path; a real service route should prefer the player's own road layout (and later trains: rail layer only). The spike deliberately lets a bus traverse rail-linked tiles on a crossing, which is visually fine (a crossing always carries road) but a train system must not.
- **Blocked-vehicle behaviour.** Demolishing track under a bus drops it until the next `syncWorld()` rebuild (it reappears at its depot). Production should re-route from the nearest surviving tile or park the bus at the depot with a "route severed" toast.
- **Fleet semantics.** One bus per serviced harvester, capped at `MAX_VEHICLES = 4`. Capacity/cargo modelling (does a full bus matter?) is a design question, not a technical one.
- **Speed/tuning.** `BUS_SPEED_PXPS = 36` reads well at 1× zoom; a tile is crossed in ~1 s.
- **Sound, smoke, stopping at the depot tile centre** — polish.

## Test coverage

- `tests/unit/iso-vehicles.test.ts` — routes (own-track only, disconnected → null, endpoints pinned), interpolation (mid-leg positions, axis by step sign), ping-pong with exactly one arrival per round trip, `onArrival` payload, fleet cap, no factory → no fleet.
- `tests/unit/iso-manifest.test.ts` — Y5 extended: `kind: "sprite"` cells must carry the derived centre anchor.
- `tools/validate-manifest.mjs` — `free: true` sprites are exempt from the footprint-span guard; the manifest schema gained the documented `free` flag.
