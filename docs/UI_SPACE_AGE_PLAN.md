# UI restyle: "Space Age" theme + map-first layout — plan

Owner decisions (2026-09-25, from mockup review):
- **Palette: Space Age** — charcoal, orange, aqua, lemon (tokens below).
- **Square corners, flat colours.** No rounded corners, gradients, bevels, rivets, glows or inner shadows. Panels are separated by 1px dark lines and 3px orange rules.
- **Fonts:** Jost for headings and UI (uppercase, tracked, for headings). Barlow Semi Condensed stays for dense numbers. Yellowtail script is used ONLY for "Industries" in the logo. Cinzel, Barlow Condensed and Special Elite go.
- **Layout:**
  - slim top bar (with the resources in it);
  - icon tool rail on the left;
  - minimap **top right**;
  - the right column becomes a **centered bottom drawer** (tab strip at the bottom centre, panel opens upward, closed by default);
  - the match-3 session window stays a centred modal.
- Scope is cosmetic plus layout. No gameplay changes. Map, building, vehicle, gem and portrait art are untouched.

Mockups: the Space Age scheme in the session's "v2 flat" mockup (top bar, left rail, minimap top right, drawer). The drawer is centered, not full width.

---

## Tokens (new file `src/game/theme-space-age.css`, imported in `src/App.tsx` right after `./game/styles.css`)

```css
:root {
  /* Space Age palette */
  --sa-ink:#0f1214; --sa-panel:#1f2427; --sa-panel-2:#2a3034; --sa-line:#343b3f; --sa-line-hi:#4a5357;
  --sa-bone:#eee6d4; --sa-bone-dim:#b9b3a6; --sa-bone-mute:#7d786e;
  --sa-orange:#f08a24; --sa-orange-hi:#ffb061; --sa-orange-lo:#8a4a0c; --sa-on-orange:#1f1204;
  --sa-aqua:#4fb3bf; --sa-aqua-hi:#8fd6de; --sa-aqua-lo:#245a61;
  --sa-lemon:#f2d64b; --sa-on-lemon:#2b2604;
  --sa-red:#e2553f; --sa-green:#7cc47f; --sa-sky:#6fb0e0;
  /* channels for the remap script: rgb(var(--c-x) / a) */
  --c-orange:240 138 36; --c-bone:238 230 212; --c-ink:15 18 20; --c-line:74 83 87; --c-red:226 85 63; --c-lemon:242 214 75; --c-aqua:79 179 191;

  /* old token names → new values (keeps every var() use in styles.css working) */
  --bg:var(--sa-ink); --walnut:var(--sa-panel); --iron-hi:var(--sa-panel-2);
  --glass:#1f2427f5; --glass-hi:var(--sa-panel-2); --glass-lo:#0f1214e6;
  --line:var(--sa-line); --line-hi:var(--sa-line-hi);
  --brass:var(--sa-orange); --brass-hi:#fff3dc; --brass-lo:var(--sa-line-hi); --patina:var(--sa-aqua);
  --txt:var(--sa-bone); --txt-dim:var(--sa-bone-dim); --txt-mute:var(--sa-bone-mute);
  --gold:var(--sa-lemon); --gold2:#f7e58a; --gold-d:#8c7a1c; --gold-glow:transparent;
  --danger:#c43e2c; --danger2:var(--sa-red); --good:var(--sa-green); --info:var(--sa-sky);
  --r:0;
  /* the plate/texture system goes flat (keep layer syntax valid) */
  --flat:linear-gradient(var(--sa-panel),var(--sa-panel));
  --iron:var(--flat); --iron-big:var(--flat);
  --plate-rivet:none; --plate-lamp:none; --plate-bevel:none; --plate-grain:none; --plate-body:var(--flat); --plate-wash-brass:var(--flat);
  --felt:var(--flat); --ledger:var(--flat); --smoke:none;
  --corner-tl:none; --corner-tr:none; --corner-bl:none; --corner-br:none;
  --boss-tl:none; --boss-tr:none; --boss-bl:none; --boss-br:none;
  --seal:none; --seal-sm:none;
  --room: /* menu backdrop: flat angled bands, no image */
    linear-gradient(115deg, transparent 0 62%, #f08a2414 62% 66%, transparent 66%),
    linear-gradient(115deg, transparent 0 70%, #4fb3bf12 70% 72%, transparent 72%),
    linear-gradient(var(--sa-ink),var(--sa-ink));
  /* fonts */
  --display:"Jost","Segoe UI",system-ui,sans-serif;
  --sans:"Jost","Segoe UI",system-ui,sans-serif;
  --serif:"Barlow Semi Condensed","Segoe UI",system-ui,sans-serif;
  --script:"Yellowtail",cursive;
  /* layout */
  --topbar-h:44px; --rail-w:72px; --dock-h:36px; --drawer-h:0px;
}
```

Ornament pseudo-elements that draw `--corner-*` / `--boss-*` / `--seal*`: find them with `grep -n "var(--corner-\|var(--boss-\|var(--seal" src/game/styles.css`, and add `display:none` for each selector in the theme file.

---

## Phases (one commit each, on branch `ui/space-age`, worktree `hm-ui`)

**P0: Prep.**
- `git worktree add ../hm-ui origin/main` and link `node_modules` to hm-hud's.
- Take "before" screenshots (browser pane) at 1440×900, 1024×768 and 375×812 of: main menu, mode screen, in-game (Build rail, each right-column tab), session window, settings sheet, How to Play, battle screen and ending. Save them to the scratchpad `ui-before/`.
- #386 (minimap/chat overlap) is superseded by P6/P7: close it, or merge it only if it's already done and conflict-free.

**P1: Fonts and tokens.**
- Download woff2 files into `src/assets/fonts/`:
  - `https://cdn.jsdelivr.net/npm/@fontsource/jost/files/jost-latin-{400,500,600,700}-normal.woff2`
  - `https://cdn.jsdelivr.net/npm/@fontsource/yellowtail/files/yellowtail-latin-400-normal.woff2`
- In `styles.css` (~lines 45–56), replace the `@font-face` block: keep Barlow Semi Condensed 400/500/600, add Jost ×4 and Yellowtail, and remove Cinzel, Barlow Condensed and Special Elite (and their files).
- Create `theme-space-age.css` with the tokens above and import it in `App.tsx`.
- Headings: add `text-transform:uppercase; letter-spacing:.12em; font-weight:600` to the selectors that use `var(--display)` and aren't already uppercase (check visually).
- Update `tests/unit/iso-noir-theme.test.ts` ~96: the expected font list becomes the new @font-face families in declared order.

**P2: Colour remap script** (`tools/ui/space-age-remap.mjs`, run once, commit script + result + `tools/ui/space-age-remap.report.txt`).
- Parse `styles.css` rule by rule. Skip PROTECTED selectors: anything matching `gem|\.face|\.grid|\.cell|board-|cargo|\.res-|c-grain|c-wood|c-ore|c-stone|c-oil|c-gold|iso-label|float|portrait|tycoon_|ending/|story` (the gem/board art, cargo identity colours, map-label legibility, portraits).
- Explicit families, with the alpha kept:
  - `255,176,46` / `255,166,43` / `233,168,62` / `#ffb02e` / `#e9a83e` → `rgb(var(--c-orange) / a)`
  - `201,162,74` / `200,161,58` / `107,81,35` / `98,68,24` / `#c9a24a` / `#6b5123` → `rgb(var(--c-line) / a)`
  - `242,220,166` / `#f2dca6` / `#efe4d0` / `#fff6dd` / `#f2e6c8` → `rgb(var(--c-bone) / a)`
  - `226,112,79` → `rgb(var(--c-red) / a)`
- Fallback for any other literal: convert to OKLCH.
  - chroma < 0.06 and hue in 20–110° (warm grey/brown) → the same L at hue 215°, chroma 0.01 (cool charcoal ramp).
  - L > 0.82 and warm → bone.
  - warm and chroma ≥ 0.06 → orange at a matched L.
  - Leave cool and neutral colours alone.
- The report lists every change (selector, old → new).

**P3: Flatten pass** (same script, `--flatten`, non-protected rules only).
- `border-radius` values other than `50%` → `0`.
- `box-shadow` that is inset, or a glow (blur ≥ 8px with orange/lemon/bone), → `none`. Plain panel drop shadows → `none`, and add `border:1px solid var(--sa-ink)` where the panel sits on the map.
- `background`/`background-image` made only of gradients → its first colour stop (already remapped). Leave mixed layers that contain `url()` (sigils) alone.
- `text-shadow`: keep only on protected map labels and floats; elsewhere → `none`.

**P4: Top bar (44px).**
- In `ui.ts`, move `chips` (the resource `.chipbar`, ~1044) from the footer into the top bar after the logo. Hide the `.resbar` footer. Phone: the chips become a second top-bar row that scrolls sideways.
- Replace every `max(52px, var(--resbar-h, 52px))` in `styles.css` with `var(--dock-h)` (check with grep; about a dozen).
- Logo: `HEXMATCH` in Jost 600, tracked, plus `<span class="logo-script">Industries</span>` in `--script`, orange. Drop the emblem mark.
- Move the difficulty `<select id="iso-rival-skill">`, the Names toggle, fit-camera and the sound button out of `.top-right` into the ☰ popover, under a "Game" heading. Keep their ids, `data-act` values and handlers; move the DOM nodes, don't rebuild them.
- Keep in the bar: the race (portraits 28px square + `★ n/12`), `?`, ☰ and the radio.
- Bar style: `--sa-panel`, with a 3px `--sa-orange` bottom rule.

**P5: Left tool rail.**
- `.aside.left` → `width:var(--rail-w)`, flush left (`left:0`), `top:var(--topbar-h)`, `bottom:var(--dock-h)`, flat panel.
- `.build-btn` → 72×56 tile: a 22px icon above an 11px label; hide the cost lines in the rail. Selected = orange fill with `--sa-on-orange` text. Unaffordable = 45% opacity.
- Icons: new `src/ui/icons.ts` with inline SVG path data (Tabler Icons, MIT; add the licence note) for: pointer, route (dirt), road, building-warehouse (depot), building-factory-2 (plant), building-community (city), train (rail), building-arch (platform), bulldozer (demolish), shield (security), mask/flame/ban (rackets). The build buttons render `<span class="bb-ico">${svg}</span>` instead of the painted sigil background. Stroke is `currentColor`.
- Flyout card: one shared `.tool-card` element (fixed, `left: calc(var(--rail-w) + 6px)`). It's filled from the button's name and cost HTML on pointerenter/focus, and stays up while the tool is selected. Flat bone card with a 3px orange left rule. When the rail tool is selected, the rail options (`railPanel`) show inside this card.
- The rackets/sabotage panel (`sp`, `sabList`) moves out of the left column into the Black market pane (it keeps its data-acts).
- Update the sigil-gutter tests in `iso-noir-theme.test.ts` (build button / racket artwork gutter, the phone sigil size) to the new tile contract: the icon slot exists, the label has ≥ 60px. List that change in the PR.
- Hide `.rail-toggle-left` on desktop.

**P6: Minimap top right.**
- `.minimap-dock` → `top: calc(var(--topbar-h) + var(--safe-top) + 8px); right: 8px; left:auto; bottom:auto; width: clamp(150px, 13vw, 220px)`. Flat frame; the viewport rectangle is drawn in lemon (in `src/iso/minimap.ts`).
- `.rival-quip` sits under the minimap.
- The chat dock (MP) goes bottom-left: `left: calc(var(--rail-w) + 12px); bottom: calc(var(--dock-h) + 12px)`.

**P7: Centered bottom drawer** (was the right column).
- `.aside.right` (desktop ≥ 761px) becomes:
  - `left:50%; transform:translateX(-50%); bottom:0; top:auto; right:auto;`
  - `width:min(760px, calc(100vw - var(--rail-w) - 24px))`
  - `display:flex; flex-direction:column-reverse`
- The tab strip (`tabs`, ~1284) is the bottom row, `height:var(--dock-h)`, on `--sa-ink`. The active tab is bone with ink text. The Quests badge is orange.
- Panes sit above the strip with `max-height:min(300px, 45vh)` and scroll inside.
- Closed = only the strip. Reuse the existing `data-rail-right="1"` as "closed" (the game already unfolds it when it needs the Bank etc.). Default is closed on desktop.
  - Clicking the active tab closes it; clicking another tab opens and switches.
  - Esc closes, unless a modal is up.
- New first tab, **Plant**: move the plant card (`#iso-plant`: retune key, city key) into a `plantPane`, and wire it into the existing tab switching.
- `ui.ts` publishes `--drawer-h` (a ResizeObserver on the aside) so that `.modebar`, `.toasts` and the banner sit at `bottom: calc(var(--drawer-h) + 10px)`.
- Remove the `--board-px`-based width rule for `.aside.right` on desktop (the session window owns the board). Hide `.rail-toggle-right` on desktop.

**P8: Coach, banner, toasts and modals.**
- Coach step and banner: a flat ink strip at top centre under the bar. The step label is lemon, the text bone.
- Toasts: flat panel with a 3px left rule in the semantic colour.
- Modals, the settings sheet, How to Play, the skill picker, the battle screen (`.battle-pq`), the ending ledger, the loading screen and the session window: square, flat `--sa-panel`, with a 3px orange top rule. Primary button: lemon fill with `--sa-on-lemon` text. Secondary: 1px bone outline. Danger: red.

**P9: Front door** (`src/ui/MainMenu.tsx`, `src/ui/StartScreen.tsx`, their styles).
- The flat `--room` backdrop replaces the noir harbour painting.
- The panel is square charcoal with a 3px orange top rule, and the new logo.
- Main menu: the primary button is **Continue** when a save exists; otherwise **Quick start** (solo vs AI Normal, straight in via the same `begin({mode:"ai", portrait:"vex"})`). "Play" is renamed **New game** (opens the mode screen). Settings, How to Play and Store become a compact row of text buttons.
- Mode screen: keep the two columns, restyled. Manager portraits at 64px square.

**P10: Canvas colours.**
- `src/iso/overlay-art.ts` `DEFAULT_OVERLAY_STYLE`: valid → aqua, bad → red, the reach band → orange.
- `src/iso/minimap.ts`: the frame and viewport rectangle.
- Check that floats and labels pick up Jost through the tokens.

**P11: Verify.**
- `npx tsc --noEmit -p .`
- Targeted tests (background): iso-noir-theme, start-menu-two-column, story-contract-layout, iso-l8-legibility, iso-build-hint, iso-fx-styles, iso-corridor-picker, iso-rails, radio, ui-copy-guard, iso-299-session-window, iso-input-qol, main-menu, iso-skill-picker. Update geometry assertions only deliberately, and list each one in the PR.
- Playwright desktop-chromium: no new failures compared with main (28/40 fail on main today).
- "After" screenshots at the same 3 sizes and screens; publish before/after as a gallery.
- Contrast: bone on panel ≈ 12:1; orange and aqua on panel ≥ 4.5:1; lemon button text ≥ 7:1.
- The owner plays on the dev server before merge.

## Out of scope / later
- Generated menu key art (a sunny 1950s town).
- A two-sided race meter in the top bar.
- The phone layout beyond theme + chips row.
- Deleting the now-unused `assets/ui/noir/*` art (after one release).
