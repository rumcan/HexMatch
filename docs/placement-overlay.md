# Placement overlay — the building highlight, drawn as geometry

The overlay a player stares at every time they place something used to be four
pre-rendered PNG cells in the atlas (`highlight`, `highlight_bad`,
`highlight_soft`, `node_mark`) blitted tile by tile. It now has two upgrades:

1. **The grid is vector.** The four roles are painted as canvas paths by
   `src/iso/overlay-art.ts` instead of blitted, so the lines stay crisp at every
   zoom and DPR and a multi-tile site reads as *one* outline rather than nine
   boxes.
2. **The building is previewed.** While a Factory, plant or Depot is being
   placed, the overlay draws the exact sprite the click would raise —
   transparent, tinted by the verdict, standing on a light pool clipped to its
   own footprint.

![A 3×3 plant site: one merged outline with corner brackets, a red hatched
refused tile, the dashed catchment ring, node tags, and the transparent
factory preview.](placement-overlay/preview.png)

(The figure is a replay of the real `PlacementOverlay.paint` command stream onto
an SVG ground, with the factory sprite drawn at the ghost's blit alpha — the
same code path the game runs.)

## Roles — one vocabulary, two renderers

The game still emits its historical overlay item names; the placement plans,
the unit tests and `__iso.overlayItemsFor` all speak them. `overlay-art.ts`
translates a name into a role exactly once (`OVERLAY_ROLE_BY_SPRITE`), so the
art and the rules stay decoupled:

| item name       | role        | look                                                   |
|-----------------|-------------|--------------------------------------------------------|
| `highlight`     | footprint   | gradient floor, bright outline, corner brackets         |
| `highlight_bad` | blocked     | red outline + sparse hatch, brackets                    |
| `highlight_soft`| reach       | faint fill + slow marching-ants outline                 |
| `node_mark`     | node        | four inset brackets per tile, no fill                   |

## The merged outline

The whole point of vector is that interior seams disappear. `boundaryLoops()`
walks the boundary edges of the tile *set* and returns closed corner loops — a
3×3 footprint comes back as one four-corner loop, so the site gets one outline
and four brackets. A collinear run (`simplifyLoop`) drops the tile-join vertices
so a straight edge never grows a bracket mid-run. The same path is used for the
fill, the stroke, the hatch clip and the ghost's light pool, so they always
agree.

## The ghost

`overlayFrame()` in `game.ts` returns the tile items **and** a `GhostSpec`
(sprite, footprint origin, verdict) from the *same* placement plan, so the grid
and the building can never disagree. The sprite is placed by `place()` — the
same call the structures pass uses — so its foot lands exactly where the real
building's will. It is tinted once per (sprite, zoom, verdict) with a
`source-atop` gradient over its own alpha (chimneys and wheels still read),
then blitted translucent. A legal ghost breathes and floats a pixel or two; a
refused one sits still in the danger hue. The ground light pool is clipped to
the footprint so a glow can never lie about the site's size.

## A/B seam and rollback

`IsoRenderer.setHighlightMode("vector" | "sprites")` is the same renderer-local
switch the roads have: the baked cells stay packed as the rollback and the
pixel tests still pin them, and `__iso.highlightMode('sprites')` flips live for
comparison. It is renderer state only — never persisted, never on the wire, so
both players always place by the same rules whatever they are looking at.
`IsoRenderer.setOverlayMotion(false)` (wired to `prefers-reduced-motion`)
freezes the pulse, the ants and the ghost's bob without changing a colour, shape
or position.

Diagnostics: `__iso.rendering().overlay` reports the mode and, in vector mode,
the tile counts, boundary loops and the ghost the last frame painted.
