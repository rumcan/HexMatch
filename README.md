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
```

## Game entry points (E12)

The isometric game is the standalone default at `/`. The classic hex +
match-3 game is preserved unchanged and reachable behind the URL flag
`?legacy=1` (e.g. `/hexmatch/?legacy=1`); it is imported lazily so the
default bundle never includes it or its three.js dependency. e2e specs for
the legacy game boot through the flag URL; the iso specs boot the default
route with real DOM, real rendering and no mocking.

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
