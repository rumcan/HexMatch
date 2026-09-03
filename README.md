# Hexmatch Industries

A hex/isometric industry-tycoon + match-3 game. The current E-series work
converts the game to a 2:1 dimetric (isometric) canvas-2d renderer with
road/rail transport — see `docs/HexMatch-isometric-spec.md` (E0–E11).

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
npm run slice-atlas  # rebuild assets/iso-atlas from tools/iso-atlas.cells.json
```

## Tooling

Sprites are packed by `tools/slice-atlas.mjs` from `tools/iso-atlas.cells.json`
(see `tools/README-art.md`). For headless sprite inspection — ASCII-preview a
rectangular region of a PNG, with blue-key / page-white / id-label marked:

```bash
node tools/peek.mjs <file.png> <x> <y> <w> <h> [maxW] [maxH]
```

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

## Art pipeline (E1)

Sprites are derived from OpenGFX and packed from a shared manifest — see
`tools/README-art.md` and `tools/atlas-manifest.schema.json`.

> Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX),
> © 2007–2016 the OpenGFX team, licensed GPLv2. See `LICENSE`.
