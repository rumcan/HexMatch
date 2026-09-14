# RAIL-01 — the board clears the footer, and the desktop panels fold away

*"The Processing Plant match-3 board extends downwards behind the bottom
resource footer, clipping and obscuring the bottom row of gems. The desktop
sidebars occupy significant screen real estate and cannot be collapsed to
view the map."* — [issue #151](https://github.com/rumcan/HexMatch/issues/151)

Both reports share one root: the two fixed columns were treated as constants
in a window that is not one. The right column's board was sized by viewport
*BANDS* (`vh ≤ 720 → 0.68 …`), never by the space the column actually has —
so on any window where tabs + plant head + reach strip + board exceeded
`100vh − topbar − 52px`, the overflow painted straight under the resource
bar (`.resbar`, z 38, with a blur, over the aside's z 30). And the same
always-there columns gave the player no way to step back and look at the
map they are placing roads on.

---

## 1. FIT-01 — the board never paints behind the footer

Three layers, in `src/game/ui.ts` (`responsiveZoom()`) and `src/game/styles.css`:

1. **The footer is measured, not assumed.** The chip row wraps on narrow
   desktop windows, and `.resbar` — fixed to `bottom: 0` — grows *upward*
   when it does. `ui.ts` now reads `footer.offsetHeight` on every resize and
   publishes it as `--resbar-h`; both asides park on
   `bottom: max(52px, var(--resbar-h, 52px))`. The historic 52px stays the
   floor and the no-measurement fallback (jsdom keeps every pinned number).
2. **The zoom fits the measured column.** The desktop branch of
   `responsiveZoom()` keeps the band heuristic as its starting point, then
   measures the live economy column (`#iso-trade.scrollHeight`) and the
   room the aside actually has (`rightAside.clientHeight` — which already
   ends at the footer's live edge). The board's share of the column at the
   current zoom is known arithmetic (`CELL·board.h + 10`, times the zoom the
   column was laid out at), so the fixed furniture around it is
   `colH − boxNow`, and the fitted zoom is one linear solve:
   `z = min(band, (asideH − chrome − 2) / box)`. The solve is **idempotent**
   — a column that fits holds its zoom — so resize-event storms cannot make
   the board pulse, and the plant pane being hidden (another tab owns the
   column) skips the clamp entirely; returning to the Plant tab re-fits.
3. **The column clips as a safety net.** `.aside.right` is `overflow:
   hidden`: if anything ever overflows again it stops at the column's own
   edge, above the footer, instead of sliding behind the bar to be cut in
   half by it. (`.aside.left` gets `overflow-y: auto` for the same reason —
   a tall Build list scrolls instead of spilling.)

The phone fit (MOBILE-02) is untouched: it measures the board slot the
full-bleed sheet leaves and grows the board into it.

## 2. RAIL-01 — collapsible desktop panels

Each column gets one slim brass key on its outer edge — a child of the
aside, so it rides the panel's slide and stays reachable on the folded
sliver:

- **Board panel (right):** collapses to the RIGHT edge
  (`translateX(calc(100% − 28px))`), leaving a 28px sliver of the panel's
  left edge on screen. Expanded, the chevron points right (▸ — the way the
  panel will travel); folded, it points back toward the center (◂).
- **Build menu (left):** collapses to the LEFT edge
  (`translateX(calc(−100% + 28px))`). Expanded, the chevron points left (◂);
  folded, back toward the center (▸).

Details that keep it honest:

- **State is two root attributes** (`data-rail-left` / `data-rail-right`);
  the stylesheet owns the whole animation (`.25s ease` transform). ui.ts
  only flips the attribute, so CSS and markup can never disagree about a
  mid-flight frame.
- **One writer** (`paintRails()`) moves attribute, `aria-expanded`, chevron,
  title, sound cue and `inert` together, and repaints nothing when nothing
  changed (resize storms call it per event).
- **A folded panel leaves the tab order with it.** `inert` goes on the
  panel *content* — never the aside, the key lives beside it — so a keyboard
  walk cannot land on tabs and market rows nobody can see.
- **A phone never sees any of it.** Crossing into the phone regime clears
  both folds (`railSyncViewport()` in `responsiveZoom()`), the phone media
  block drops the keys (`display: none !important`) and undoes the fold
  transform, and the click handlers stand down on `isPhoneViewport()`. The
  sheets keep their dedicated tab-based navigation untouched.
- **ARIA:** the keys are `<button>`s with `aria-controls` naming the panel
  (`#iso-aside-left` / `#iso-aside-right`, new ids) and `aria-expanded`
  carrying the state.

## 3. Verified

- `tests/unit/iso-rails.test.ts` (new, 16 tests): the footer-height publish,
  the measured clamp (including the exact fitted zoom, the above-the-footer
  invariant, idempotence under a resize storm, the hidden-pane skip and the
  plant-tab re-fit), both fold toggles (attributes, ARIA, chevrons, inert,
  independence), the phone-regime clear, and the stylesheet contracts
  (transition, fold transforms, key placement, phone kill-switch, the
  `--resbar-h` floor).
- `tests/unit/iso-noir-theme.test.ts`: the `.aside` geometry pin moved with
  the rule — `bottom: max(52px, var(--resbar-h, 52px))` — with the corridor
  picker's 52px model still replaying the floor.
- `tests/unit/iso-corridor-picker.test.ts` and the full unit suite pass; the
  `vh ≤ 720 → 0.68` jsdom contract is preserved where nothing is measurable.
- Pixels belong to the e2e desktop project and the live preview.
