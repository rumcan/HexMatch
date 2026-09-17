# MOBILE-01 — the mobile pass

*"Mobile has been neglected. Do a mobile pass and fix everything so it can be
played on mobile."* This document is the record of that pass: what a phone
player could not do before, what changed, and how each change was verified.

The bar: the three phone projects already declared in `playwright.config.ts`
(`iphone` 390×844 dpr3, `android-small` 360×640 dpr2, `android-landscape`
844×390 dpr2 — all `hasTouch` + `isMobile`) plus a manual audit harness that
drives the built game with real CDP touch events (pan, pinch, tap) and
measures every control on screen.

---

## 1. Input — a finger is not a mouse

| Before | After | Where |
|---|---|---|
| One finger with an armed build card painted a road track; the map could not be panned at all while holding a tool | One finger always pans; a tap (inside the slop) still lays exactly one tile | `src/iso/game.ts` (`panCapable`, `dragLive`) |
| Tap slop was 4 device px for every pointer — a fingertip jitter read as a drag | `tapSlop(pointerType, dpr)`: mouse keeps 4 (TK-001), touch gets ~10 CSS px in canvas device px | `src/iso/camera.ts` |
| Pinch had no hand-off: lifting one finger snapped the camera | The surviving finger is promoted with its own origin — no snap | `src/iso/camera.ts` (`pointerUp`) |
| Tapping a tile did nothing a mouse-hover did | A tap sets hover + opens the inspector, so "point and inspect" works by touch | `src/iso/game.ts` |
| Every control surface assumed a hover state | Tool chip, FAB cluster and ☰ rows give touch the same exits mouse-only affordances gave the cursor | `src/game/ui.ts`, `styles.css` |
| Copy said "drag", "hover", "right-click" to everyone | `coarsePointer()` (`src/iso/touch.ts`) switches Select's subtitle, the tour's Controls card and the help modal's new "Playing by touch" paragraph to touch grammar | `touch.ts`, `ui.ts`, `tutorial.ts` |

Verified: CDP touch pan moved the camera with Select armed *and* with Dirt
Road armed; a single tap placed the Factory (setup-factory → setup-harvester)
and the Depot (→ play); a two-finger pinch zoomed 2 → 0.5 and back to 2.

## 2. One tile size on every screen

Every screen booted at zoom 1: 64 CSS px a tile on desktop, **32 at dpr 2 and
21 at dpr 3** — under half a fingertip. `bootZoomFor(dpr)` now picks the step
that lands the tile in a 40–76 CSS px band (phones boot at zoom 2, i.e. the
same 64 CSS px tile desktop has); desktop dpr 1 is untouched, and the boot
zoom is applied about the viewport centre so `scene.focus == centre` still
holds. Unit-pinned in `tests/unit/iso-camera.test.ts` ("MOBILE-01" blocks).

## 3. HUD and layout at phone sizes

* `--safe-top` / `--topbar-h` custom properties now drive the top bar and
  **every** fixed top that hangs off it (`.aside`, `.toasts`,
  the ☰ popover, the rival peek), so a notched phone moves the whole stack
  together instead of shearing it. `--banner-h` (painted by `ui.ts`) lifts
  sheets and toasts clear of a story banner.
* ≤760 px: 46 px top bar, 40 px icon keys, 40 px ☰ close key; panels become
  one sheet per bottom-nav view; the resource bar compacts but stays.
* ≤480 px: Help / Names / Recenter fold into the ☰ popover (which gains
  Recenter and Names rows on coarse pointers).
* Landscape keeps the compact resource bar; the match-3 board folds to the
  economy sheet; nothing overlaps the stage.
* Touch targets: the tour's 9 px diamond pips are buttons, so on ≤760 each
  becomes a 36 px plate with the diamond drawn as a centred pseudo-element
  (same picture, four times the finger); tapping pip 5 jumps to step 5.
* Audited with `overflowX / tinyTargets / belowFold / clipped` empty on boot,
  build sheet, economy sheet, settings, help and the ☰ popup, in portrait and
  landscape.

## 4. Surfaces that were unreachable, not just ugly

* **Story contract list.** `.start-screen` was `place-items: center` +
  `overflow: hidden` with `height: auto`: the ~1500 px chapter panel grew past
  an 844 px viewport, nothing above it scrolled, and chapters II–V, "Watch the
  opening reel" and "Back to the menu" were painted off-screen with no way to
  reach them. Now ≤760 px (and short viewports) get a flex-column plate pinned
  to `100dvh` that scrolls, `margin-block: auto` centring it whenever it fits;
  the how-to/settings projector pins to the viewport so it cannot scroll away.
  Verified by CDP swipe: `scrollTop` reaches max and "Back to the menu" lands
  on screen.
* **Landscape menu** (same root cause, short-viewport branch) scrolls instead
  of hiding Play.
* Help modal and the economy's Bank tab list were already scroll containers —
  confirmed reachable, not assumed.

## 5. Boot flow on a phone

Menu → mode screen → setup-factory → setup-harvester → play walked entirely by
touch (taps, no synthetic clicks), tour included: eight cards fit a 390×844
screen with no clipped content, the Controls card quotes touch grammar, and
the pip row is tappable.

## 6. Test and harness work

* `tests/unit/iso-camera.test.ts`: boot-zoom band, atlas-step validity,
  centre-preserving zoom, tap-slop arithmetic.
* `tests/unit/iso-game.test.ts`: the canvas stub's gradients were `undefined`,
  so any renderer paint inside an input path threw and aborted the handler;
  the stub now returns gradient shapes, and `paintOverlayNow` is try/caught in
  `game.ts` — a cosmetic overlay must never gate input.
* `tests/unit/iso-noir-theme.test.ts`: the `.topbar height` / `.aside top`
  pins moved with the var-derived declarations (the numbers they resolve to on
  desktop are still pinned, at `:root`).
* `tests/e2e/boot.ts` (new): the boot wait, in one place. Two specs
  (`iso-game`, `iso-skill`) never walked the STORY-01 front door, so they timed
  out on **every** project including desktop; both now click Play → Play vs AI
  like the other specs. Phone projects rasterize ~1.4 M device px per frame in
  software, so their boot budget (and per-project test timeout) is 150 s while
  desktop keeps 20 s; `PW_BOOT_BUDGET` overrides both on slow shared runners,
  next to the existing `PW_CHROMIUM_EXECUTABLE`.
* `tests/e2e/building-layers.spec.ts`: the exact-length pin on
  `__iso.buildings` went stale when scenery-art started sharing
  `buildingImages` (91 entries vs a 58-name manifest, on desktop too); the
  spec's promise — every manifest sprite installs, none falls back — is now
  asserted per name.
* `src/iso/skill.ts` + `game.ts`: a pinned `?rival=` link is an explicit
  choice, so it now persists like a selector pick would (AI-01 e2e). A plain
  boot still writes nothing, keeping AI-02's picker able to ask.

## 7. Status and known follow-ups

Green and verified on phone emulation: gameplay boot/tap/pan/pinch, all three
nav sheets, settings, help, ☰ popup, tour, story menu and contract list,
portrait and landscape layout reports.

`iphone` project e2e at the time of writing: `iso-game` layout + economy,
`building-layers`, `story` campaign-menu pass; the remaining phone failures
are interaction-with-emulation issues filed for the next pass, not layout or
input defects seen in the audit — the story stage's advance-on-click and the
tour's Next key under `isMobile` emulation (both advance fine under real CDP
touch in the audit harness), and the difficulty `<select>` reading empty
after `selectOption` at ≤480 px. CI continues to run `desktop-chromium` per
PR; the phone projects run in the nightly matrix.
