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
| Board | 48px nearest-neighbour pixel gems | the repo's own six 128px painted cargo **hexes** (pointy-top, the shape the board is named for), shown exactly as they were painted: no tint, no boost, no theme filter — only `cover` sizing (the old `100% 100%` was a per-axis stretch), a percentage hex clip instead of a square ring, and the base sheet's one soft drop-shadow. `make-noir-art.mjs` repaints them only behind an explicit `--gems` |
| Background | `#0b1a26` behind an opaque canvas | the war-room: the board is a table under a banker's lamp with smoke in the beam and rain on the window, graded through `.vignette` (the one overlay already sitting above the map canvases) |
| Rival roster | coloured initials | the `tycoon_*.png` portraits, back on the dossier cards (they existed, unused, since U1 pruned the `<img>`) |
| Feed, offers, banner, help | tinted rectangles | manila: the ledger paper, the visiting cards, the telegram, the pinned rule sheets |
| Modals & difficulty prompt | translucent box | Ordinary modals use a felt inset, brass edge, and the frame plate's brass **medallions** (`boss-*.webp`). The difficulty prompt deliberately uses a clean felt card and simple brass keyline with **no ornamental corners**, keeping the three choices uncluttered. Tighter plates (sidebar, tray, toast) wear the frame's iron **chamfer** instead |

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
`background-position: right center` — inside the *padding* box, so it overlaps
the padding — which means a flex label will happily typeset straight over it.
Each action button therefore declares the art twice, from the same two custom
properties: `--sigil-w` (the edge the card is scaled to) and `--sigil-gutter`
(the padding reserved for it, `w + 4px` at minimum). `padding-right:
var(--sigil-gutter)` makes the gutter real for the text, `background-size: auto
var(--sigil-w)` keeps the card inside it, and `right 8px center` pulls the card
off the plate's edge so the clearance is 18px and not 10. `.bb-mid
{ overflow-wrap: break-word }` is the backstop: a cost line that genuinely
cannot fit breaks onto a second line and the plate grows, rather than losing
glyphs under the paint. The phone sheet narrows the panel, so it scales both
numbers down rather than squeezing the label.

Measured, not eyeballed, by reading the advance widths out of the vendored woff2
(`fontTools`) and wrapping at the box the CSS builds — a 266px plate with 14/64
of padding and an 8px gap leaves **180px of column**, and the widest of the five
labels is 127px (`1🌾 1🪵 1🪙 · +2★ paving dirt`, Special Elite at 11px, four
emoji counted at a font em each). Longest title: `PROCESSING PLANT` at 115px.
All five therefore sit on one line with 50px+ to spare, and the sabotage cards
get the same guard (`.sab-top > b` breaks, `.sab-cost` is `flex: 0 0 auto` so
the price can never squeeze the racket's name into the art).

**A corner medallion is solid metal, so only real modals pay for it.** The brass
`boss-*.webp` ornaments measure 255 alpha in *all four* corners: they are
squares, not chamfers that fade out. Ordinary modal titles therefore keep their
derived safe band. The difficulty chooser was simplified after visual review:
its four ornamental bosses competed with the three difficulty cards, so the
`.iso-skill-card::after` paint and its dead title gutter were removed entirely.
It is now a clean felt rectangle with one brass keyline.

```css
.modal.box { --corner-inset: 0; --corner: 44px;
             --text-clear: calc(var(--corner-inset) + var(--corner)); }
.modal h2 { padding-inline: var(--text-clear); justify-content: safe center; }
#iso-skill-prompt h2 { text-align: center; } /* no corner ornament to clear */
```

On phones the modal's inset grows to its 14px brass mat and the medallion
shrinks to 34px, with the title following the same arithmetic. The difficulty
card has no ornament variables at either breakpoint. `safe center` remains
load-bearing on modal flex titles: it prevents the guild seal overflowing into
the solid brass square when horizontal room runs out.

**Paper is read, not admired.** The instruction banner used the ledger sheet at
`multiply` under 11.5px typewriter ink; the sheet's own grain is ±26 levels per
channel, which at that size is static over the type. The banner (and the log
rows, same recipe) paints the ledger once, then washes it flat with ivory at
.74 — texture as a hint, not as noise — and the message moves to the body face
at 13px on `#1f1405`. The line the player reads mid-game, "Place your Depot —
it needs an industry in its 4×4 catchment…", goes from 3 wrapped lines of 11.5px
to 2 of 13px on a 402px column.

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

## A theme layer has to survive the merge

A pure theme is written as rewrites of two files, and a rewrite is exactly what
git cannot merge: the HOLY CROSS feature (PP-14) landed on `main` while this
branch was open, both sides touched `styles.css` and `ui.ts`, and the resolution
is "this branch's file, with the incoming blocks re-applied by hand". Two rules
make that safe, and both are tested:

- **The contract tests are file-wide, not rule-by-rule.** "never sizes a bitmap
  to two different axes" reads every `background-size` declaration in the sheet,
  so a block written after the pass cannot smuggle a stretch in. It caught one:
  `.fx-cross` arrived with `background-size: 100% 100%`, and since its box is a
  76px square, `contain` is the identical picture drawn proportionally. That is
  the *only* word the theme changed in PP-14's CSS.
- **A merge-contract test asserts the incoming features are still wired.** It
  requires `.cross-pick*` to have bodies, `.start-screen` to exist,
  `angel.png`/`holy.ts` to be on disk and `crossPick` to be both defined and
  returned — the failure mode of a whole-file theme is silently dropping someone
  else's feature, so that failure mode is pinned.

Everything else main wrote stays untouched: `.start-screen` is a pre-theme
screen outside this pass, and the chooser's own gradient panels keep their
original colours (they read `--serif`/`--gold2`, which now resolve to noir
values anyway).

## Final reels and the two-way wire

The ending is a story, not a score toast. `src/iso/ending.ts` carries nine
victory epilogues and nine grim defeat epilogues, split across paving-led,
plant-led, and balanced empires. The ledger selects the reel and the decisive
build supplies the final line. The most explicit success reel begins:

> You went on to become the greatest entrepreneur America had ever seen. Your
> little freight concern grew into the largest network in the United States…

That prose is rendered under **The years that followed**, followed by a final
two-portrait Rival/You exchange. Fireworks occupy a layer inside the victory
card so they remain visible on a phone where the card is almost full-screen;
defeat receives
ash instead. Review hides the reel without destroying it and leaves a **Final
ledger** ticket to reopen it.

`src/iso/rivalry.ts` writes Torvin as an old industrialist whose threats keep
collapsing under their own wordplay. Every scene alternates `rival → you`, and
`src/game/ui.ts` swaps the wire card from Torvin's portrait/red keyline to the
player's selected portrait/blue keyline for the reply. The first Oil delivery
runs the longer “How about you drill this!” hand-gesture exchange; subsequent
Black Market attacks use shorter paired scenes. The card remains
pointer-transparent, queues rather than drops replies, and keeps the complete
conversation in the Feed.

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
