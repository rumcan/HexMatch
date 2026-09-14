# MOBILE-02 — the match table owns the screen

*"Fix mobile match 3 so that the match table is always fullscreen and fits in
window. I would rather we add more cols to the board at different size to fit
than have this [a board cropped by the fold]. Also the header is not showing
its info, it's squashing stuff — add another row and make the displays of
things smaller. Find a different way that takes less space for the tabs of the
match-3 window; the stuff at the top can auto hide and show if they change.
Make the buttons much smaller. Turn the chatter off between you and the rival
— it takes up too much space."*

Every symptom in the screenshots had the same root: the economy sheet was a
scrolling panel inside a phone window that had nothing to scroll. The wire
card, the title row, the combo plate, the reach strip and the rules paragraph
stood between the finger and the gems, and the fixed 7×8 board was squeezed
under them by a `zoom` that bottomed out at 0.4 — below the floor the last
rows simply spilled past the fold and were cut.

---

## 1. The board fills the window — columns and rows first, pixels second

`responsiveZoom()` (in `src/game/ui.ts`) answers a new question on phones:
not "how small can I make the fixed board", but "what board fits this
window".

* The phone fit measures the **slot** the sheet leaves for the board
  (`.board-slot` between the tab strip and the floating footer), picks the
  cell that fills it, and proposes `cols × rows` around the shipped 7×8. A
  390×844 portrait phone gets roughly 7×10 at ~52 px gems; a 844×390
  landscape phone buys its extra width with columns — 7×8 → 9×8.
* The rectangle is decided by the slot's **aspect ratio** and capped at **+2
  per axis** (#163), and it may only be decided from a **settled** box: a
  next-frame pass or the slot's `ResizeObserver`, never the box a tab switch
  exposes for a frame. Growth switches off entirely (zoom only) below a 30 px
  cell, so a short slot can never buy columns with unreadable gems.
* **One settled box decides one rectangle** (#188). The fit records the
  `width × height` it last answered, and only a *different* box may decide
  again — so a tab switch structurally cannot resize the board, whatever the
  arithmetic would do with a measurement that jittered by a pixel. The
  rectangle it asks for is also **claimed before `Board.setSize` runs**:
  `setSize` repaints the chrome through the game's `onChange` synchronously,
  and that repaint must not mistake the chrome's own grow for a restored save
  or a host-authored board and adopt it as the new floor. Before it did, the
  floor ratcheted up once per settled pass and the +2 cap could not hold —
  every Processing Plant round-trip added two rows in portrait (7×8 → 7×10 →
  7×11) and two **columns** in a landscape slot (7×8 → 9×8 → 11×8 → 13×8 …),
  which is the over-wide board of #188.
* The growth goes through **`hooks.requestBoardSize`** — the chrome asks, the
  game answers. `src/iso/game.ts` says yes solo and as host (the host's whole
  rectangle ships on the wire, so a guest sees the same board it grows), and
  says no on a multiplayer **guest**, whose grid the host authors. A veto is
  never fatal: the fit falls back to zoom alone, which now prices height and
  width separately (the old code divided the height budget by the board's
  WIDTH — the arithmetic that cropped the bottom row in the first place).
* The engine's `Board` reads its live size off the grid (`w`/`h` getters) and
  gained `setSize(w, h)`: gems inside the new rectangle keep their identity,
  tokens, frost and girders; new cells drop in fresh; the grid never shrinks
  below what it holds — a window that narrows re-zooms, it never eats a row.
  `initFill`, `findGroups`, `gravity`, `spawnTokens`, `dropBlocks`,
  `harden`, `smashBlocks`, `hasMove`/`findMove` and the deadlock guard all
  count against the live dims, so a ♻ reset re-rolls the board the phone is
  actually holding.
* The grid's layout box is re-published from `renderBoard` on every pass —
  the paths that REPLACE the grid without a resize (a save restored by
  `game.ts`, a multiplayer sync) still land in a panel that fits.

Verified numerically by `tests/unit/iso-mobile-fit.test.ts` (grows into a
stubbed slot, honors the veto, grows only from a real measurement, keeps the
grown rectangle when the window shrinks, follows a restored grid, and — for
#188 — drives ten Plant round-trips with the board's real `onChange` wiring,
which is what the creep needed to show itself) — jsdom has no layout, so the
pixel proof is the three phone projects plus the live preview. That wiring
matters: `src/iso/quarry.ts` points `board.onChange` at `ui.renderBoard()`,
so a harness that leaves it a no-op cannot see any feedback bug in this fit.

## 2. The sheet becomes the window

`[data-view="trade"]` on a phone (`ui.ts` publishes `data-phone="1"` from the
same predicate the media queries answer — `(max-width: 760px), (max-width:
900px) and (orientation: landscape) and (max-height: 500px)`; landscape
phones now join the portrait sheet regime instead of wearing the desktop
column layout):

* `.aside.right` goes inset 0, `overflow: hidden` — the board FITS, there is
  no sheet scroll and no crop by construction.
* The nested plate (`#iso-quarry`) loses its own margins/border/blur; the felt
  rail fills the slot edge to edge, so the table is the screen.
* The resource bar and the bottom nav stay as the floating footer the sheet
  pays for in its own padding (`calc(118px + safe-area)` portrait, 76px
  landscape).

## 3. What was crossed out is gone; what stays is small

* **The private wire is off on phones** — `rivalQuip()` returns before the
  queue on a phone viewport (and the card is `display:none` for a mid-quip
  rotate). Nothing is lost: the beats are already written into the Feed tab.
* **The rules paragraph is out** of the plant sheet (`.iso-hint`); it lives
  in the ❔ reference card. The *Your Processing Plant* title is out while the
  Processing Plant tab is lit — the tab says it.
* **`Network reaches`** stays (it is the rule that gates payouts) but drops to
  a single chip line.
* The tab strip is a compact icon+word segmented row (`⚖ Bank 🏦 …`);
  "PROCESSING PLANT" never wraps to two lines again. Words stay in
  `textContent` (unit-tested names); `≤360 px`-tight tabs ellipsize instead
  of growing the strip.
* Buttons: `♻ Reset` 32→22 px tall, icon keys 40→27 px, combo pips 12→8 px,
  fabs 46→38 px, market rows to 26 px. MOBILE-01 chose those sizes FOR
  thumbs; this ticket overrides them for the match-3 chrome at the player's
  explicit request — the board is the touch target that matters now.

## 4. The top bar: stacked, shrunk, and it tucks

* Portrait phones get a **two-row bar** (60 px): the roster row on top, the
  rival difficulty, the ★ plaque and the keys under it — every readout
  smaller (10–11 px), nothing squashed off the edge. Landscape keeps one row
  at 34 px.
* On the trade sheet the bar **tucks itself away** ~350 ms after entering the
  view (never covering the tabs the player just came to press), and drops
  back — with a brass flash — only when a SCORE lands (`renderHUD` sees
  `★ You n/target` change; purse chip churn deliberately does NOT re-drop
  it), when the grip pill above the tabs is tapped (6 s hold), and tucks
  again the moment a tap lands on the board. Off the trade sheet, on tablets
  and on desktop it simply stays where it always was.

## 5. Files

| File | Change |
|---|---|
| `src/game/board.ts` | live `w`/`h` getters (grid-derived), `setSize()`, every scan/refill counts the live dims |
| `src/game/ui.ts` | `isPhoneViewport()`, slot-measured grow-fit (#163: settled, aspect-driven, +2 cap; #188: one settled box per rectangle, claimed before `setSize`), `applyGridSize()` from `renderBoard`, `.board-slot` mount, icon tabs + grip, tucking top bar with change-flash, phone gate on `rivalQuip`, `requestBoardSize` hook |
| `src/iso/game.ts` | `requestBoardSize` — solo/host yes, guest no |
| `src/game/styles.css` | MOBILE-02 block; landscape phones join the sheet regime; `.board-slot` |
| `tests/unit/iso-mobile-fit.test.ts` | the fit contract, pinned — including the real `board.onChange` wiring and the #188 round-trip runs |

## 6. What did NOT change

Desktop and tablet (>760 px portrait / >500 px landscape) get the identical
layout, the identical 7×8 board and the identical zoom schedule — the base
`.board-slot` is `display: contents`, and every new rule is scoped behind a
phone media query or `data-phone` / `[data-view="trade"]`. The rival's plant,
the headless sim and every existing test boot at the shipped 7×8.
