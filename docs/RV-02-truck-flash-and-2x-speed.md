# RV-02 — fix the truck's depth "flash", and drive it 2× faster

**Status: implemented** (was: handoff ticket for a new agent). Everything
needed is here: the verified root cause (measured, not guessed), the exact
edits, the tests to write FIRST, and how to verify without a browser. Two
changes total — one line in `src/iso/depth.ts`, one constant in
`src/iso/vehicles.ts`, plus test updates.

**Reported symptom (player):** *"the truck is flashing. it almost looks like
it is going under some tiles until it reaches the tile and then it is on
top — like the tile it is going towards isn't a higher z-index until it gets
there."* Confirmed against RV-01 as merged (PR #51).

---

## 1. Root cause — VERIFIED, reproduce it yourself before fixing

A truck's draw order is decided in `src/iso/depth.ts`:

- `place()` gives a **moving** item the depth key of its **rounded** tile:
  `key = Math.round(px + fw - 1) + Math.round(py + fh - 1)` (footprint 1×1,
  so `round(fx) + round(fy)`).
- Static sprites — including the **road tiles** — get the integer key
  `tx + ty`.
- `tier1Compare` breaks key ties by ascending **sprite height**
  (`a.h - b.h`): the lorry is h=15–16, a road tile h=32–33 → **the truck
  sorts BEFORE the road on a tie**, so the road (a full opaque tile diamond)
  is painted AFTER it and over it.

So for a leg from tile (3,10) to (4,10), measured with the real atlas:

| truck fx | truck key | road keys (3,10)/(4,10) | draw order | what the player sees |
|---|---|---|---|---|
| 3.2 | **13** (ties source) | 13 / 14 | truck → road(3,10) → road(4,10) | road painted OVER the truck (mostly hidden) |
| 3.7 | **14** (ties dest) | 13 / 14 | road(3,10) → truck → road(4,10) | front half covered by the destination road |
| 4.1 | **14** (ties dest) | 13 / 14 | road(3,10) → truck → road(4,10) | still covered |
| 4.6 | **15** (past both) | 13 / 14 | road(3,10) → road(4,10) → truck | pops fully ON TOP |

The truck spends roughly three quarters of every tile transition partially
or fully under a road sprite, then pops on top for the last stretch — the
"flash". `Math.round` flips the key at the .5 midpoint, which sets the flash
rhythm.

**Reproduce before touching anything** (delete the file afterwards): place
`road_0011` at (3,10) and (4,10), a `truck_goods_se` at `fx 3.2/3.7/4.1/4.6,
fy 10`, run the triple through `depthSort(...)` and log the order. It will
match the table above.

## 2. The fix — a half-step depth bias (TDD: tests first)

### Step 1 — update the tests FIRST (`tests/unit/iso-vehicles.test.ts`)

**(a) The two pinned moving-key assertions** in *"depth-keys a moving sprite
by its rounded tile"* change from integer to half-stepped:

```ts
    const before = place(atlas, {
      sprite: "truck_goods_se", tx: 3, ty: 10, fx: 3.4, fy: 10,
    })!;
    const after = place(atlas, {
      sprite: "truck_goods_se", tx: 3, ty: 10, fx: 3.6, fy: 10,
    })!;
    expect(before.key).toBe(3 + 10 + 0.5);   // was 3 + 10
    expect(after.key).toBe(4 + 10 + 0.5);    // was 4 + 10
```

**(b) ADD a regression test** that pins the actual bug — a truck must sort
AFTER the road tile it is driving on/leaving, at every phase of a leg
(this is the test that fails against the pre-fix tree):

```ts
  it("sorts ABOVE the road tiles it drives over, at every phase of a leg", () => {
    // The RV-02 flash: the moving key tied with the road tile's integer key
    // and the height tie-break let the road paint OVER the lorry for most of
    // every leg. The +0.5 bias must make the truck strictly later than the
    // road it is mostly on, and later than BOTH end roads once past the
    // midpoint of the leg.
    const roadA = place(atlas, { sprite: "road_0011", tx: 3, ty: 10 })!;
    const roadB = place(atlas, { sprite: "road_0011", tx: 4, ty: 10 })!;
    expect(roadA.key).toBe(13);
    expect(roadB.key).toBe(14);
    for (const [fx, afterBoth] of [[3.2, false], [3.7, true], [4.1, true], [4.6, true]] as const) {
      const truck = place(atlas, {
        sprite: "truck_goods_se", tx: 3, ty: 10, fx, fy: 10,
      })!;
      expect(truck.key, `fx=${fx}`).toBe(Math.round(fx) + 10 + 0.5);
      // later than the road it is leaving, always
      expect(tier1Compare(truck, roadA), `fx=${fx} vs source road`).toBeGreaterThan(0);
      // later than the destination road too, once mostly onto it
      if (afterBoth) {
        expect(tier1Compare(truck, roadB), `fx=${fx} vs destination road`).toBeGreaterThan(0);
      }
    }
  });
```

(`tier1Compare` is already imported in that file's depth section — if not,
add it to the `../../src/iso/depth` import.)

Run: `npx vitest run tests/unit/iso-vehicles.test.ts` — the new/updated
assertions must FAIL (red) against the unfixed tree.

### Step 2 — the one-line implementation (`src/iso/depth.ts`, `place()`)

```ts
    key: moving
      // nearest lattice point — the truck flips draw order as it crosses a
      // tile boundary, exactly where its box starts overlapping the neighbour
      ? Math.round(px + fw - 1) + Math.round(py + fh - 1)
      : (item.tx + fw - 1) + (item.ty + fh - 1),
```
becomes
```ts
    key: moving
      // nearest lattice point + half-step bias: a moving sprite must never
      // TIE with the integer key of the ground sprite it straddles — a tie
      // plus tier1Compare's ascending-height tie-break let a road tile paint
      // OVER the lorry for most of every leg (the RV-02 flash). +0.5 keeps
      // the truck strictly above the tile it is on/leaving, still strictly
      // below the NEXT tile's ground until it crosses the midpoint, and
      // changes nothing about buildings: their integer keys compare the same
      // against x.5 as they did against x.
      ? Math.round(px + fw - 1) + Math.round(py + fh - 1) + 0.5
      : (item.tx + fw - 1) + (item.ty + fh - 1),
```

Why +0.5 is correct and safe (verify each claim while you're there):

- **No new ties.** Every static sprite keys integer; a moving item keys
  `integer + 0.5`. Ties can now only be truck-vs-truck (two lorries on the
  same tile — harmless, stable sort).
- **Building occlusion is unchanged.** `isBehind` still works on footprint
  spans; against buildings the truck's `x.5` key orders exactly where the
  integer key ordered (an `x.5` sits strictly between the two neighbouring
  integer keys, and never equals one). A truck still passes UNDER a factory
  that stands in front of it (south-east) and OVER one behind it.
- **The only pixels a ground tile may still cover** are the leading-edge
  sliver of the truck's box poking into the *next* diamond during the first
  half of a leg — before the key flips at the midpoint. That region is where
  the lorry art is transparent (the art is a diagonal sliver inside its
  20×16 box), so it is invisible. Do NOT "fix" that by sorting trucks above
  everything: they must still go under buildings in front of them.
- **Do not** touch `drawOrigin`/`drawOriginMoving`, the sprite anchors, the
  route finder, or any economy/PP-13 code. This is a draw-order bug only.

### Step 3 — 2× speed (`src/iso/vehicles.ts`)

```ts
/** Tiles per millisecond: one tile every 600 ms — lorry, not sports car. */
export const TRUCK_SPEED = 1 / 600;
```
becomes
```ts
/** Tiles per millisecond: one tile every 300 ms — RV-02: doubled. */
export const TRUCK_SPEED = 1 / 300;
```

That is the whole change. The tick tests derive their unit from the constant
(`const TICK = 1 / TRUCK_SPEED;` at the top of `tests/unit/iso-vehicles.test.ts`),
so they adapt automatically — update only the stale comment `// ms per tile
(600)` on that line to `(300)`. Optionally update the "one tile every 0.6 s"
mention in `docs/playtest-reports/2026-09-09-rv01-vehicles.md`.

Do not change `tickTrucks` (its reflection folding is dt-independent and was
pinned for huge ticks) or the frame loop's 100 ms dt cap in `game.ts`.

## 3. Verify

```bash
npx vitest run tests/unit/iso-vehicles.test.ts tests/unit/iso-depth.test.ts   # green, incl. the new regression test
npm test            # full suite (baseline: 37 files / 577 tests, all green)
npm run typecheck   # both configs clean
npm run lint        # 0 errors
npm run build       # clean
```

**Visual check without Chromium** (this sandbox has no browser; Playwright's
CDN is blocked): reuse the software-rasteriser pattern from
`tests/unit/iso-golden.test.ts` in a TEMPORARY test (delete it after): build
a small scene — `road_0011` at (3,10) and (4,10) plus a truck at
`fx = 3.2 / 3.7 / 4.1 / 4.6` — run it through the real `place` →
`depthSort` → per-pixel blit path at zoom 2, write PNGs, and eyeball them
(`read_file` renders images). PASS = the lorry is fully visible in all four
frames (its leading edge may kiss the next diamond at fx=3.2 — art-transparent
pixels only). A truck that disappears for a whole frame range means the bias
regressed; a truck occluded by a BUILDING south-east of it is correct.

## 4. Acceptance criteria

- [x] New regression test ("sorts ABOVE the road tiles it drives over…")
      fails on the pre-fix tree, passes after.
- [x] Moving keys are `round(px)+round(py)+0.5`; both old key assertions
      updated, everything else in `iso-vehicles.test.ts` untouched.
- [x] Truck never disappears under a road/crossing/rail sprite at any phase
      of a leg (the four-frame rasteriser check).
- [x] Truck still renders BEHIND a building that is genuinely in front of it
      (pin exists via depth tests; do not weaken it).
- [x] `TRUCK_SPEED === 1/300`; all `tickTrucks` ping-pong tests still pass
      unchanged (they derive TICK from the constant).
- [x] Full suite, typecheck, lint, build all clean.

## 5. Optional follow-up (NOT required for this ticket)

If more moving-art lands (trains, ships), consider splitting flat ground
(road/rail/crossing draw items) into its own pass drawn before the depth-
sorted structures+vehicles list, so ground can never overdraw any vehicle
regardless of keys. RV-02 deliberately does not do this — the +0.5 bias is
the minimal, fully-pinned fix.

---

*Branch state note for the next agent: work from `main` (RV-01 merged via
PR #51). This file plus the two code edits are the whole ticket.*

## 6. Implementation record

Applied TDD on `arena/01a08527-hexmatch`, branched from `main` at #51:

- RED: updated key assertions + new regression test failed 2/21 against the
  unfixed tree (`expected 13 to be 13.5`), exactly as specified.
- GREEN: one-line `+ 0.5` bias in `place()`, `TRUCK_SPEED = 1/300`, TICK
  comment to `(300)`. Targeted files 35/35; full suite 37 files / 578 tests
  green (+1 over the 577 baseline); `tsc` clean on both configs; lint
  0 errors (warnings at the 25 baseline, none in touched files);
  `npm run build` clean.
- Four-frame rasteriser check (temp test, since deleted): draw order
  `roadA → truck → roadB` at fx=3.2, `roadA → roadB → truck` at
  fx=3.7/4.1/4.6; ~810 truck-visible pixels in every frame (lorry fully
  visible, leading edge over art-transparent pixels only); building
  occlusion verified (`truck → factory_blue` when the factory stands SE).
- The dated RV-01 playtest report was deliberately left untouched (history);
  the "one tile every 0.6 s" mention there now refers to pre-RV-02 tuning.
