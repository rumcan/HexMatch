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

This relay is local/self-hosted play only. A game published to RUN.world is
sandboxed to a host allowlist and cannot reach a backend you host, so nothing
in `src/` may connect to it — see the next section.

## RUN.world multiplayer (BETA)

The jam's two-player game runs on RUN.world's realtime rooms instead of the
relay above. The tickets and the constraints behind them (auth, the 16 KiB
frame cap, host authority) are in
[`docs/HexMatch-tickets.md`](docs/HexMatch-tickets.md) — MP-01 … MP-09.

| Path | Role |
|---|---|
| `rundot/realtime.config.json` | registers the `hexmatch` room type (2 players) |
| `src/rooms/HexmatchRoom.ts` | server-side `GameRoom` — mints the map seed, names the host, routes messages |
| `src/net/protocol.ts` | the message union shared by the client and the room |

The room is a **thin validating relay**, not the simulation: the host browser
stays authoritative and the room's only real authority is refusing world state
from anyone who is not the host.

`rundotMultiplayerPlugin()` (in `vite.config.ts`) bundles the room into
`dist/server-bundle.js` and copies the room config to `dist/rooms.config.json`
on build. Under `npm run dev` it also runs the rooms locally on port 9001, so
two browser profiles can host/join by code without the platform.

## Art pipeline (E1)

Sprites are derived from OpenGFX and packed from a shared manifest — see
`tools/README-art.md` and `tools/atlas-manifest.schema.json`.

> Graphics derived from OpenGFX (https://github.com/OpenTTD/OpenGFX),
> © 2007–2016 the OpenGFX team, licensed GPLv2. See `LICENSE`.
