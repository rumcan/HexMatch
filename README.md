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
`npm run noir-art` derives everything the game loads; the type (Cinzel, Barlow
Condensed, Special Elite) is vendored in `src/assets/fonts/` so it renders the
same offline. Design notes and the layout rule the theme must not break:
[`docs/UI-NOIR-THEME.md`](docs/UI-NOIR-THEME.md).

## Game entry

The isometric canvas-2d game is the only boot path (`/`). The hex + three.js
path (`?legacy=1`) was deleted in E11. e2e specs boot the default route with
real DOM, real rendering and no mocking.

## Room server (multiplayer relay)

A separate Node process in `server/` (`ws` relay, Jackbox-style):

```bash
npm --prefix server install
npm --prefix server start     # port 8787 (PORT env overrides)
```

## Art pipeline (E1 + W-series)

Sprites are derived from OpenGFX and packed from a shared manifest — see
`tools/README-art.md` and `tools/atlas-manifest.schema.json`. The W-series
terrain overhaul replaced the per-tile ground sprites with a pattern-painted
landscape (seamless grass/sand textures, an animated ocean, beach ring and
procedural surf) and split roads/buildings into separate layer atlases —
see [`docs/w-series-terrain.md`](docs/w-series-terrain.md).

> Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX),
> © 2007–2016 the OpenGFX team, licensed GPLv2. See `LICENSE`.
