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
npm run slice-atlas  # repack assets/iso-atlas from tools/iso-atlas.cells.json
node tools/make-derived-art.mjs   # redraw the derived rail/crossing/glow PNGs
```

## Tooling

Sprites are packed by `tools/slice-atlas.mjs` from `tools/iso-atlas.cells.json`,
which maps every game concept to ONE Kenney PNG (see `tools/README-art.md`).
For headless sprite inspection — ASCII-preview a rectangular region of a PNG:

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

## Art pipeline (K1–K5)

All game art is **Kenney** isometric packs (132×64 blocks, measured — see
`docs/HexMatch-isometric-spec.md`, K0–K6): `tools/iso-atlas.cells.json` maps
each concept to a single Kenney PNG, `tools/slice-atlas.mjs` measures each
PNG's base diamond to compute anchors (nothing hand-authored) and packs the
three-resolution atlas, and `tools/make-derived-art.mjs` draws the pieces
Kenney does not ship (rail masks, level crossing, placement glows).
Reference renders live in `docs/kenney-*.png`.

> Art by Kenney — https://kenney.nl — isometric packs
> (isometric-miniatures, -landscape, -buildings, -vehicles, -roads),
> licensed CC0 1.0 (public domain): https://creativecommons.org/publicdomain/zero/1.0/
> See `LICENSE`.
