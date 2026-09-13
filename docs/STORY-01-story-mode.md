# STORY-01 — Story Mode: *The Foundry Syndicate*, a campaign in five contracts

The ask, taken literally: *"design a story mode for the game, with more rival
characters, portraits with expression, a helpful guide, skippable intro
sequence with beautiful backgrounds, polished dialog, based on our theme and
whatever else you can think of."*

So: the sandbox tycoon match becomes one season of a life. An inherited
freight company (Hextall Freight, 1949), a bookkeeper who keeps it honest, and
the five tycoons of the Foundry Syndicate who divided this island before the
war and are politely waiting for the heir to fold. Every chapter **is** a live
match — same map, board, economy, AI — wearing a contract: the rival's name
and voice, the ★ line it races to, the difficulty the rival plays at, a fixed
seed (a contract is a *place*; it must not move between attempts), and three
scenes around it: the briefing before the boot prompts, the handshake after a
win, the rally after a loss.

## The cast (`src/story/cast.ts`)

| Who | Role | Voice rule | Art |
| --- | --- | --- | --- |
| Torvin | The Old Baron · ch I | wants to sound dangerous, catastrophically bad at comebacks (his original deck) | painted sheet |
| Silas Marrow | The Toll King · ch II | threatens in condolences; every kindness is an invoice | painted sheet |
| Delphine Roque | The Oil Queen · ch III | calls everyone darling; sabotage as a party invitation | painted sheet |
| Krag | The Quarry King · ch IV | few words, all of them stone; oddly tender about rocks | painted sheet |
| Aldous Griev | The Chairman · ch V | speaks in minutes and bylaws; the politeness is the threat | painted sheet |
| **Mabel Quill** | **the guide** | warm, sharp, numbers-minded; hints arrive as bookkeeping | painted sheet |
| Anne / James Hextall | the player | dry; punctures every rival bit in one line | the U1 mugshots |

### Portraits with expression — one painting, four moods

Each character's plate is a **2×2 expression sheet** (TL calm · TR smile ·
BL mad · BR shock), painted once and shown as *one quadrant at a uniform 2×*:
`background-size: 200% 200%` plus a two-component `background-position`
(0%/100% per axis pin the sheet's edges to the box). That is the theme's
standing rule — *no picture is scaled per axis* — applied to faces: a
quadrant is a crop at a uniform scale, never a squash. `faceOf(id, mood)` is
the one seam the cutscene stage, the rivalry wire and the chapter menu all
read, so "Torvin, furious" cannot drift between the reel and the HUD. A
character with no sheet (the player's mugshots) degrades to `cover`, never to
a broken image.

The moods are not decoration, they are **direction**: an attack lands on the
wire with the rival's `mad` quadrant, a thwarted raid reads `shock`, the idle
wire `smile`; Mabel's advice wears the mood the moment implies (stern for
"your lorries are idle", wide-eyed for "that was his frost crew").

Masters live in `assets/story-src/` (painted plates, hand-swappable — the
same convention as `assets/ui-src/noir/`); `node tools/make-story-art.mjs`
derives everything the game imports into `src/assets/story/` as webp
(backdrops at 1600 wide, sheets squared to 640) and prints a report. A
missing master is **not** an error: the run synthesises a clearly-marked
placeholder so code, tests and previews work between art batches, and the
console names the stand-ins.

## The dialogue model (`script.ts`, `stage.ts`)

A scene is data — `ScriptScene` is readable by a test with no DOM — and
`stage.ts` is the ~250-line projector beside it, the split `tutorial.ts` and
`ending.ts` already run on. Three kinds of line, one union, exhaustive
projector: a **spoken** line raises a dossier card (quadrant face, engraved
name, small-caps role, accent keyline in the cast colour) beside a felt
plate whose typewriter writes the line out, punctuation pausing like a
reader; a **narrator** line drops the face and centres the plate; a **title**
line drops everything and engraves one Cinzel card alone. Backdrops `cover`
the window and breathe one slow Ken Burns drift; changing place
**cross-fades** two stacked plates instead of cutting.

Click / Enter / Space advances — mid-typing it *completes* the line first,
because "make me wait twice" is not pacing. **Skip ▸▸ and Esc end the scene
now**, and skipping is a choice the campaign records as *seen*, never as a
fault. `prefers-reduced-motion` kills the typewriter, the drift and the
fades outright. Every scene in the campaign is validated by
`sceneIssues()` in a unit test: an unknown speaker, a mood no sheet paints
or a backdrop key with no plate is a build failure, not a blank card.

## The opening reel (`intro.ts`)

One skippable cinematic, four painted places, the whole premise in under a
minute of reading: who you are, who Mabel is, the five tycoons in one line
each, and what a star is worth. It plays **once** (watched or skipped), is
replayable from the campaign menu ("Watch the opening reel"), and
`?storyintro=0` keeps it out of a playtest link's way. React owns only the
seam (`App.tsx`: "the reel is standing" is one piece of state with a host div
under it); the reel itself is the same DOM projector as everything else.

## The guide, in-game (`advisor.ts`)

Mabel is not a tutorial modal nobody reads — she is a voice that arrives at
the moment the player is actually stuck, on the same two-portrait wire the
rivalry uses, in a **patina keyline of her own** (`Office · Mabel Quill`).
Six moments, each keyed to a real state the frame loop can see: `welcome`
(play begins — the chapter's own tactic), `stalled` (90 s in, still no
Depot: the loop's missing hinge, named plainly), `sabotaged` (the first raid
that lands — and what stops the next one), `halfway`, `behind` (the honest
way back: paving), and `gold` (the sixth colour and its one purchase, before
it surprises anybody). Each fires **once per match**; `?advisor=0` or the
stored word silences her (`progress.ts` owns both, the same precedence shape
as `shouldShowTutorial`).

## The rivals' voices (`voices.ts`)

Torvin keeps his deck in `iso/rivalry.ts`. The other four get decks here in
the same shape and under the same three rules: a scene **starts with the
rival and ends with the player puncturing it**; beats alternate speakers
(the face change *is* the speaker change); nothing touches simulation RNG
(`createStoryDirector` hashes seed + call count exactly like
`createRivalDirector`, so a joke can never move a lorry). A rival with no
deck for a direction falls through to Torvin's directors — which only Torvin
ever needs.

## Progress, and the shape of a contract (`progress.ts`, `chapters.ts`)

One localStorage key (`hexmatch:story`), one meaning: how many contracts are
open, the best result per chapter (a win sticks; a loss never overwrites a
win), `introSeen`, and the player's last word on the guide. Corruption reads
as a fresh campaign, never a locked door; private mode plays open-everything-
for-this-session. The ending ledger grows a **third door** inside a contract
— *Continue the campaign ▸* — back to the menu with the result filed; a win
unseals the next contract, a loss only records itself (the retry is the
point).

Playtest seams, in the house style: `?chapter=<id>` boots a contract
directly and steps over the menu lock (the e2e spec and any reviewer's link
use it), `?storyintro=0` suppresses the reel, `?advisor=0/1` the guide.

## What the HUD learned

* the rival **seat** wears the contract's name, colour and painted quadrant
  on its dossier row (`UiState.rivalFace`), so scoreboard, wire and ledger
  all introduce whoever the chapter cast;
* the wire card gained a third speaker (`guide`) and per-beat faces
  (`UiRivalryBeat.face`), still pointer-transparent, still queued, still
  retained in the Feed;
* the contract's ★ line rides the existing live dial (`winTarget()`), so the
  badge, the king bars and the win check cannot disagree about the race;
* a contract casts its rival at a fixed difficulty — the chapter *is* the
  pacing — and skips AI-02's prompt, which would un-cast it.

## Geometry, seams, stretches

The stage is a fixed overlay at `z-index: 80` — above the HUD, never inside
a HUD box, so `tests/unit/iso-corridor-picker.test.ts`'s replayed geometry is
untouched. Its only repeating layer is the theme's seamless smoke; every
bitmap is `cover` or a uniform quadrant; the dialogue plate tiles the
seamless felt at a fixed 480 px. `tests/unit/iso-noir-theme.test.ts` reads
the whole sheet for per-axis stretches and keeps passing.

## Tests

* `story-script.test.ts` — every scene in the campaign through `sceneIssues`,
  the chapter table (contiguity, cast order, rising ★ line, distinct seeds),
  the voice decks' speaker discipline, the guide's coverage;
* `story-stage.test.ts` — the real projector in jsdom: typing, click-to-
  complete, advance, skip, Esc, destroy, backdrop caption, `player`
  resolution;
* `story-progress.test.ts` — unlock sequencing, seal precedence, corruption,
  URL precedence;
* `story-cast.test.ts` — the cast data **and the art on disk**: every master
  painted, every derived plate present, sheets square, backdrops wide;
* `tests/e2e/story.spec.ts` — the menu's locks, a playtest boot, the reel
  playing once and skipping clean, in a real browser.
