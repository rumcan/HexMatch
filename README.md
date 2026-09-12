# Hexmatch Industries

A hex/isometric industry-tycoon + match-3 game. The current E-series work
converts the game to a 2:1 dimetric (isometric) canvas-2d renderer with
road/rail transport — see `docs/HexMatch-isometric-spec.md` (E0–E11).

The map is **144×144** (three times each old dimension, nine times the area),
with **25 industries and four towns**. Counts stay fixed so the larger map
provides more separation. The T1–T4 handover fixes and rendered review are in
[`docs/playtest-reports/2026-09-08-handover.md`](docs/playtest-reports/2026-09-08-handover.md).

## Develop

```bash
npm install
npm run dev          # vite dev server
npm run build        # typecheck (tsc) + production build
npm test             # vitest unit suite (pure game logic)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npx playwright install chromium   # one-time, for the e2e suites
npm run test:e2e     # real-browser e2e (builds + previews first)
node tools/parse-pnml.mjs   # rebuild tools/opengfx-sprites.json from the .pnml declarations
npm run slice-atlas  # rebuild assets/iso-atlas from tools/iso-atlas.cells.json
npm run noir-art     # rebuild the HUD theme art from assets/ui-src/noir
```

## Tooling

Sprites are packed by `tools/slice-atlas.mjs` from `tools/iso-atlas.cells.json`
(see `tools/README-art.md`). For headless sprite inspection — ASCII-preview a
rectangular region of a PNG:

```bash
node tools/peek.mjs <file.png> <x> <y> <w> <h> [maxW] [maxH]
```

To trace a screenshot back to game state (C5), the running game exposes a
debug console on `window.__iso` — `dumpTile`, `dumpAt`, `dumpBuilding`,
`dumpNetwork`, `config`, `probe`, `rendering`, `renderLog` and on-map
`overlay` marks. Dev builds always have it; a production build only with
`?iso-debug=1`. `__iso.rendering()` returns the renderer's last-frame draw
facts and warnings; `__iso.renderLog(true)` (or the URL flag `?render-log=1`)
turns on the per-blit `[render]` console trace. See
[`docs/iso-debug-console.md`](docs/iso-debug-console.md).
The HUD chrome (panels, buttons, board tokens, dialogs, backgrounds) is one
theme: *The Foundry Syndicate* — carved iron and aged brass under a single
amber lamp. The painted masters live in `assets/ui-src/noir/` and
`npm run noir-art` derives everything the game loads — except the board's
tokens, which stay the repo's own painted **hex** gems in `src/assets/gems/`
(it is HEXmatch, after all); the type (Cinzel, Barlow
Condensed, Special Elite) is vendored in `src/assets/fonts/` so it renders the
same offline. Design notes and the layout rule the theme must not break:
[`docs/UI-NOIR-THEME.md`](docs/UI-NOIR-THEME.md).

Sound is one theme too (SFX-01): a **synthesised** mix of wood, felt, paper,
glass and brass — 24 cues in `src/audio/cues.ts`, built on the one bus in
`src/audio/engine.ts` that PP-14's choir now sings into as well, and wired to
every control by a single document-wide delegation (`src/audio/sfx.ts`), so a
new button is voiced by markup (`data-sfx="coin"`) rather than by a handler. No
audio assets, no decode, nothing to 404. The top bar's 🔊 toggles it (`M` does
the same), the choice persists, `?sound=0` boots silent, and a dev build exposes
`window.__sfx` — `__sfx.audition()` walks the whole catalogue, `__sfx.stats()`
reports what the throttle and the voice budget actually swallowed. The mix and
its three quietness rules: [`docs/SFX-01-ui-sound.md`](docs/SFX-01-ui-sound.md).

## Game entry

The isometric canvas-2d game is the only boot path (`/`). The hex + three.js
path (`?legacy=1`) was deleted in E11. e2e specs boot the default route with
real DOM, real rendering and no mocking.

## Onboarding

A first game opens with the **starting tour** (`src/iso/tutorial.ts`): eight
stepped cards that walk the whole loop — raise the Processing Plant beside a
town, build a Depot inside an industry's catchment, drag roads between them,
play the match-3 board the lorries feed, spend the cargo it pays, and take ★ by
paving your own dirt and by raising more plants. *Never show this again* is the
one exit that persists (`hexmatch:tutorial` in localStorage); skipping only
closes the card for the session, the ❔ in the top bar replays the tour at any
time and re-tells the full rules beside it, and `?tutorial=0` keeps it out of
the way of a playtest link. Every price and ★ value in the copy is read from
the same tables the HUD reads, so a rebalance moves the lesson with the rule:
[`docs/TUT-01-starting-tutorial.md`](docs/TUT-01-starting-tutorial.md).

## Multiplayer (RUN.world rooms)

Host / join-by-code / quick-match run over RUN.world realtime rooms: the relay
is `src/rooms/HexmatchRoom.ts` (registered in `rundot/realtime.config.json`),
the SDK seam is `src/net/transport.ts`, and the entry point is
`src/ui/StartScreen.tsx`. `npm run dev` starts a local room sidecar on port 9001
alongside Vite, so two browser windows on one machine can play — an incognito
window included, no account needed. Full recipe, tunnel/preview testing, and the
headless relay check:

```bash
npm run dev                        # vite + local room sidecar (9001)
node tools/two-client-check.mjs    # headless host/join/intent/forgery check
```

See [`docs/multiplayer-local-testing.md`](docs/multiplayer-local-testing.md) and
[`docs/HexMatch-tickets.md`](docs/HexMatch-tickets.md).

### Legacy relay (self-hosted, unused by the RUN build)

A separate Node process in `server/` (`ws` relay, Jackbox-style). A published
RUN game cannot reach it — the platform sandbox blocks external hosts — so it is
a self-hosted option and a protocol reference only:

```bash
npm --prefix server install
npm --prefix server start     # port 8787 (PORT env overrides)
```

## Placement overlay (vector)

The building highlight is drawn as geometry, not blitted: `src/iso/overlay-art.ts`
paints one merged outline per site with corner brackets, a marching-ants
catchment ring, hatched refusals and a transparent preview of the building the
click would raise. `__iso.highlightMode('sprites')` restores the baked cells as
a rollback. Design notes and the A/B seam:
[`docs/placement-overlay.md`](docs/placement-overlay.md).

## Art pipeline (E1 + W-series)

Sprites are derived from OpenGFX and packed from a shared manifest — see
`tools/README-art.md` and `tools/atlas-manifest.schema.json`. The W-series
terrain overhaul replaced the per-tile ground sprites with a pattern-painted
landscape (seamless grass/sand textures, an animated ocean, beach ring and
procedural surf) and split roads/buildings into separate layer atlases —
see [`docs/w-series-terrain.md`](docs/w-series-terrain.md).

> Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX),
> © 2007–2016 the OpenGFX team, licensed GPLv2. See `LICENSE`.
