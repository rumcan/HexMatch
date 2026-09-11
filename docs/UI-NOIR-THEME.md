# The UI theme: "The Foundry Syndicate" (Warcraft × Mafia)

A restyle of the HUD's chrome — panels, buttons, board, dialogs, type and
backgrounds. No rules, no numbers, no class names and no layout box changed:
the game plays exactly as it did, it is just wearing iron, brass and smoke now.

## The brief, taken literally

*Warcraft* gives the **materials and the ornament**: carved granite and
blackened iron plates, aged-brass bevels, riveted corners, a faceted gem set
into the middle of the crest, engraved Roman capitals, chunky hand-painted loot
icons that read at 40px.

*Mafia* gives the **light and the paperwork**: one amber lamp in a dark room,
cigarette smoke across the plans on the table, oxblood and sepia, manila ledger
paper, a typewriter for every figure, mugshot portraits on dossier cards, the
black market as an actual racket instead of a menu.

Where the two agree — 1920s bank façades and horde war-plinths are both carved
in capital letters over riveted metal — is where the theme lives.

## What changed

| Element | Was | Now |
| --- | --- | --- |
| Type | `"Barlow Condensed"` named but never loaded, so everything fell back to Segoe UI/system | Cinzel (display, carved) · Barlow Condensed (labels) · Barlow Semi Condensed (body) · Special Elite (typewriter ledger), all **vendored** in `src/assets/fonts/` |
| Palette | cool near-black glass, orange signal gold | iron `#191310` over walnut, brass `#c9a24a`, lamp `#ffb02e`, oxblood `#b23a26`, patina `#46705c`, parchment `#ece0c6` |
| Panels | frosted glass with a hairline | painted felt inset (`felt.webp`), brass hairline, engraved corner brackets, one lamp overhead — all drawn inside the box |
| Buttons | flat plate, procedural hazard-stripe banner | the iron of a button drawn from six fixed-px layers (rivets, lamp, bevel, hammer-grain, body) with a framed job card at the right; hover lifts it, active rings it in brass |
| Board | 48px nearest-neighbour pixel gems | the repo's own six 128px painted cargo **hexes** (pointy-top, the shape the board is named for), re-lit under the lamp: `saturate(1.02)` + a longer drop-shadow, `cover` sizing so a token is never stretched, and the selection glow drawn on the hex itself instead of a square ring. `make-noir-art.mjs` repaints them only behind an explicit `--gems` |
| Background | `#0b1a26` behind an opaque canvas | the war-room: the board is a table under a banker's lamp with smoke in the beam and rain on the window, graded through `.vignette` (the one overlay already sitting above the map canvases) |
| Rival roster | coloured initials | the `tycoon_*.png` portraits, back on the dossier cards (they existed, unused, since U1 pruned the `<img>`) |
| Feed, offers, banner, help | tinted rectangles | manila: the ledger paper, the visiting cards, the telegram, the pinned rule sheets |
| Modals & difficulty prompt | translucent box | felt inset, brass edge, and the frame plate's own brass **medallions** — dome, scroll, amber stone — painted in the four corners (`boss-*.webp`), with the guild seal above the title. Tighter plates (sidebar, tray, toast) wear the frame's iron **chamfer** instead, masked to the L along its two edges, because a medallion there would sit on the type |

## Two more rules: no seams, no stretching

Painted chrome breaks in exactly two ways, so the theme is built so it cannot.

**Nothing is tiled that is not seamless.** The felt, the smoke and the manila
are the only repeating layers, and `tools/make-noir-art.mjs` folds each one
closed before writing it: roll the sheet by half its size, so the tile's edges
become two neighbouring columns of the painting, then cross-fade the crease the
roll left in the middle against its own mirror image. The tool prints the result
as levels — the mean step across a wrap boundary, beside the sheet's own grain:

```
felt.webp      edge 0.66  crease 0.46  inside 0.01
smoke.webp     edge 2.54  crease 0.64  inside 0.94
ledger.webp    edge 8.69  crease 1.67  inside 5.88
```

and fails the run if a tile would draw a line. `npm run noir-art --
--seam-check /tmp/seams.png` writes every repeating sheet as 2×2 with the join
ruled in red, for the times a number is not enough. (The manila's 8.7 is its
own ruling period, and it is `cover`ed rather than tiled anyway.)

**No picture is scaled per axis.** A tab is 60×28, a build button 300×68 and a
dialog 340×74: one bitmap of an iron plate cannot fit all three without turning
its rivets into ovals, so the plate is *drawn* — `--plate-rivet`, `-lamp`,
`-bevel`, `-grain`, `-body` in `:root`, each a gradient with pixel stops, so it
fills any box at any size and distorts nothing, because there is nothing to
rescale. The frame's corners get the same treatment the other way: CSS cannot
mirror a background, so `make-noir-art.mjs` cuts four of them, each masked down
to the L along its two edges, painted at or below their own 108px, and the run
between them is a rule. Where a real bitmap must fill a box of unknown aspect
— the war-room, the portraits, a gem in a cell — CSS uses `cover`, or
`auto 100%` for the action cards: a uniform scale and a crop, never
`background-size: 100% 100%`, which the theme's test now forbids outright.

**No label runs into its own artwork.** A plate's job card is painted at
`background-position: right center` — inside the *padding* box — so a flex
label would happily typeset straight over it. Each action button therefore
declares the art twice, from the same two custom properties: `--sigil-w` (the
edge the card is scaled to) and `--sigil-gutter` (the padding reserved for it,
`w + 4px` at minimum). `padding-right: var(--sigil-gutter)` makes the gutter
real for the text, `background-size: auto var(--sigil-w)` keeps the card inside
it, and `.bb-mid { overflow-wrap: break-word }` is the backstop: a cost line
that genuinely cannot fit breaks onto a second line and the plate grows, rather
than losing glyphs under the paint. The phone sheet narrows the panel, so it
scales both numbers down rather than squeezing the label.

## The one rule that made this safe: geometry is sacred

`tests/unit/iso-corridor-picker.test.ts` replays the fixed HUD from
`styles.css`'s numbers, and `ui.ts` sizes the whole right column from
`--board-px` (board × zoom). So the theme **never** changes a box:

- top bar 60px, asides `top: 68px / bottom: 52px`, left 300px, `.board-wrap`
  padding 5px, banner `top: 104px`, buttons `min-height: 68px` — all still
  literally in the sheet, and now pinned by `tests/unit/iso-noir-theme.test.ts`;
- ornament is inset shadows, `::before`/`::after` overlays and extra background
  layers, which cost zero layout;
- `#iso-trade > #iso-quarry` keeps `border: 0; margin: 0` — the one panel that
  must not grow a frame, or the last columns clip;
- no `transform` on `.gem`/`.sel`/`.selected`: the board positions every token
  with an inline `translate`, so the lift lives on `.face` instead;
- the FX block (callouts, keyframes, the reduced-motion exemption) is copied
  through verbatim — only the tokens it reads changed value.

The atmosphere is also deliberately **static**. `.vignette` sits above three
canvases that repaint every frame; an animated `background-position` there
would add a full-screen repaint to gameplay for a drift nobody can see at 10%
opacity, and a `filter` on that element would re-run a full-screen pass per
frame. Motion stays where it means something: the cascade callouts, the chip
pulse, the delivery floats.

## Tuning it

Everything reads from one `:root`, so the dial is short:

- `--brass`, `--gold`, `--danger`, `--patina` — the metals;
- `--felt`, `--ledger`, `--smoke`, `--room`, `--seal`, `--corner-*`, `--boss-*`
  — the painted set; `--plate-*` — the drawn iron;
- `--corner` — the ornaments' painted size, per surface (only ever ≤ the 108px
  and 88px they are cut at: shrinking is a scale, growing is a blow-up);
- `--display` / `--serif` / `--sans` / `--mono` — the four voices;
- `--orn` — the corner-bracket arm length; `--r` — the bevel.

Art: edit or replace the plates in `assets/ui-src/noir/` (see its README for the
grid each sheet must keep) and re-run

```bash
npm run noir-art          # → src/assets/ui/noir/  (NOT src/assets/gems/ — see below)
node tools/make-noir-art.mjs --contact /tmp/noir.png   # + a review sheet
node tools/make-noir-art.mjs --seam-check /tmp/seam.png
```

The pre-theme procedural art (`tools/make-ui-art.mjs` → the `build-*.png` and
`sab-*.png` in `src/assets/ui/`) is untouched and still regenerable; the theme
simply points at the noir set.

## Fonts and licences

Cinzel (OFL, NDISCOVER), Barlow Condensed and Barlow Semi Condensed (OFL,
Owen Earl / Mead), Special Elite (OFL, Astigmatic). Vendored as `latin` woff2
only — 12 files, ~270 KB total, so the HUD renders identically offline and in
the preview; each package's OFL text is kept beside it as
`src/assets/fonts/<family>-OFL.txt`. The `src/assets/fonts/README`-equivalent
is this note: **do not** swap a stack entry for a Google Fonts `<link>` — the
point of vendoring is that the sheet is the source of truth.
