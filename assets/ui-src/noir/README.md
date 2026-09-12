# ui-src/noir — the painted plates behind the HUD theme

One file per family of element. These are the **masters**: big, opaque,
not optimised, occasionally overlapping in what they carry. Everything the game
loads is *derived* from them by `npm run noir-art`
(`tools/make-noir-art.mjs` → `src/assets/ui/noir/`), so an edit here is a
re-style of the whole interface — nothing in `src/` has to change.

| Plate | Grid | Becomes |
| --- | --- | --- |
| `frame-panel.png` | one 1:1 plate | `corner-{tl,tr,bl,br}.webp` — each corner's iron chamfer, masked to the L along its two edges, for plates whose contents reach the corner; `boss-{tl,tr,bl,br}.webp` — the brass medallion cut out of the same corner (dome, scroll, amber stone) for dialogs with a gutter; and `felt.webp`, its centre field, seamless, so panels and the board share one material |
| `frame-plate.png` | one ~4:1 plate | the reference for the iron that CSS *draws* (`--plate-rivet/-lamp/-bevel/-grain/-body`) — a bitmap plate cannot serve a 28px tab and a 74px dialog at once without squashing one of them |
| `bg-warroom.png` | one 16:9 scene | `backdrop.webp` — cut to a square, so `cover` serves a 1400×900 desktop and a 400×800 phone from one file at one uniform scale (`.ui-root`, `.vignette::after`, the difficulty prompt) |
| `tex-smoke.png` | seamless-ish tile | `smoke.webp` — the haze in the beam; static on purpose, see the note in `styles.css` |
| `tex-ledger.png` | one sheet | `ledger.webp` — manila for the feed, the telegram banner, offer cards and the help columns |
| `icons-build.png` | **3 cols × 2 rows** | `sigil/<key>.png` — one framed card per tool, sliced at exact thirds/halves |
| `icons-sab.png` | **4 cols × 2 rows** | `sigil/<key>.png` — one per racket, in `SABOTAGE`'s order plus security and repair |
| `icons-gems.png` | **3 cols × 2 rows** | `src/assets/gems/<cargo>.png` — the six match-3 tokens, matted to a circle |
| `emblem-logo.png` | one centred seal | `emblem.png` (256, dialogs) and `emblem-sm.png` (96, the top bar), with the flat black page knocked out to alpha |

## Rules for replacing a plate

1. **Keep the grid.** The slicer takes cell *i* as an exact fraction of the
   sheet — 3×2 for the tools and the gems, 4×2 for the sabotage — so a sheet
   with a different cell count is a different `GRID` entry in the tool, not a
   free edit. Cell order is row-major and must keep matching the key list.
2. **Keep the frame margin.** Each cell is shaved by `INSET` (2.8%) so no
   neighbour bleeds into a sigil; paint the motif inside that.
3. **Keep painted elements off the corners of `frame-panel.png` past ~20% of
   the side**, or the `border-image` slice starts clipping the ornament that
   makes the frame read as a frame.
5. Draw at the resolution here (≈1024 on the long edge); the tool downscales
   and that is what keeps the plates crisp at 68px.

`tests/unit/iso-noir-theme.test.ts` pins the contract from the other end: every
`url()` in the stylesheet must resolve, every tool and racket must have a
sigil, every cargo must have a round token with real transparency, and the
nine sheets above must still be in this folder.

## Provenance

The plates are generated artwork produced for this theme (2026-09-11) in a
"carved iron and aged brass, one amber lamp, 1930s prohibition noir"
direction. Like the rest of the repo's art, they are free to use under the
licence in `LICENSE`.
