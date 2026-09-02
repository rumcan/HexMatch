# Hexmatch Industries — isometric edition

A 2:1 dimetric (isometric) canvas-2d industry-tycoon: place a Factory, connect
harvested industries with **road** (cheap, 1 VP) or **rail** (expensive, 3 VP,
1.6× throughput), and feed a match-3 quarry from whatever your network reaches.

The game renders to stacked 2D canvases — no WebGL/three.js. See
`HexMatch-tickets.md` for the full E-series implementation spec.

## Develop

```bash
npm install
npm run dev        # vite dev server
npm run build      # typecheck (tsc) + production build
npm run preview    # serve the build (base path /hexmatch/)
```

## Test

```bash
npm test           # vitest unit suite (pure game logic)
npm run typecheck  # tsc --noEmit over the app
```

The suite covers the fixtures required by the spec:

| Fixture | File |
|---|---|
| Projection round-trip (all 2304 tiles + diamond corners) | `tests/unit/iso-projection.test.ts` |
| Autotile table (16 masks) + incremental 5-tile dirties | `tests/unit/iso-transport.test.ts` |
| Drag cost (10 tiles, water truncation, free re-drag) | `tests/unit/iso-transport.test.ts` |
| Depth-sort / build list ordering | `src/iso/renderer.ts` (`buildSprites`, Tier-1 key) |
| Connection integrity (build/break, VP award+revoke) | `tests/unit/iso-world.test.ts`, `iso-flow.test.ts` |
| Determinism (same seed → identical terrain + industries) | `tests/unit/iso-grid.test.ts` |
| Snapshot base64 + version rejection | `tests/unit/iso-snapshot.test.ts` |
| Atlas manifest validation | `tests/unit/iso-manifest.test.ts` |
| AI A* + deterministic expansion | `tests/unit/iso-ai.test.ts` |

## Architecture (`src/iso/`)

- `config.ts` — projection constants (`TILE_W/H`, `tileToScreen`/`screenToTile`),
  cargo/industry/transport tables, direction bits, seeded RNG.
- `grid.ts` (`E3`) — flat typed-array terrain + occupancy, Poisson-disc
  industry placement, seed-deterministic.
- `transport.ts` (`E5`) — two `Uint8Array` layers of 4-bit direction masks,
  16-variant autotiling, L-shaped Manhattan drag path with water truncation.
- `world.ts` (`E6`) — factories/harvesters, 4×4 catchment, two-way flood-fill
  connection check, road/rail VP award & revoke.
- `renderer.ts` (`E4`) — stacked canvases, 8×8 chunk caching, viewport culling,
  footprint depth sort, flat+sprite picking, discrete pinch-anchored zoom.
- `game.ts` / `IsoApp.tsx` (`E8/E9`) — guided setup, tools, cost readouts.
- `ai.ts` (`E7`) — scarcity×output scoring with A* pathfinding.
- `snapshot.ts` (`E10`) — base64 transport layers + versioned snapshots.

## Art pipeline (`E1`)

Sprites live in `assets/iso-atlas/manifest.json` (anchor = the pixel that lands
on the footprint's south corner). Slice/upscale/contact-sheet:

```bash
npm i -D sharp
npm run slice-atlas
```

Until the sheet lands, the renderer draws vector placeholders; loading an atlas
is a drop-in via `renderer.loadAtlas()`.

## Room server (multiplayer relay)

The relay is a separate Node process in `server/` (`ws`):

```bash
npm --prefix server install
npm --prefix server start     # port 8787 (PORT env overrides)
```
