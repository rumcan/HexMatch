# SFX-01 — UI sound: a synthesised mix for the Foundry Syndicate

## What the player asked for

> Create UI sounds for the game. Subtle and pleasantly sensory.

Two constraints hide inside "subtle": the game had **no audio layer at all**
(the single exception being PP-14's choir for the holy cross), and it is a game
that fires a lot of small events — a cascade clears nine gems, a drag lays six
tiles, a bad tick stacks four toasts. Sound that is pleasant for ten seconds and
exhausting after ten minutes is the default failure mode, so this ticket is as
much about **when not to play** as about what to play.

## What shipped

| Piece | Where | What it does |
| ----- | ----- | ------------ |
| The bus | `src/audio/engine.ts` | One `AudioContext`, one master gain, one soft limiter (`master → compressor → destination`), the mute/volume setting and its persistence, the gesture gate, the per-cue throttle and the voice budget — plus the two synthesis primitives every cue is built from: `tone()` (an enveloped oscillator with an optional pitch sweep) and `noiseBurst()` (a grain of white noise through a swept filter). |
| The catalogue | `src/audio/cues.ts` | 24 cues, each a short recipe of those two primitives, each with its own gap and a one-line note (`CUE_NOTES`) saying what it is and where it fires. Also the pentatonic ladder and the streak logic that makes a cascade climb. |
| The API + the delegation | `src/audio/sfx.ts` | `sfx.play(cue, { gain, step })` for game code, and `attachUiSound()` — one document-wide capture listener pair that gives **every control** a hover tick and a press sound, so no button has to remember to make a noise. Plus the `M` shortcut, the sound-control painter registry and `window.__sfx`. |
| The switch | `src/game/ui.ts` (top bar), `src/game/styles.css` (`.sound-btn`) | A 🔊/🔇 `.icon-btn` beside 🎯 and ❔, with `aria-label`/`aria-pressed`, persisted in `localStorage` (`hexmatch:audio`), also driven by `M` and by `__sfx.mute()`. The muted state loses the lamp: dimmer brass, desaturated glyph. |
| The choir joins the bus | `src/game/holy.ts` | PP-14's recipe is untouched note for note; it now sings **into the shared master gain** instead of straight to the speakers, and returns early when muted. A mute button that spared the loudest sound in the game would not be a mute. |
| The wiring | `src/iso/game.ts`, `src/game/ui.ts`, `src/iso/ending.ts`, `src/iso/skill-picker.ts`, `src/ui/StartScreen.tsx`, `src/main.tsx` | See the map below. |
| Boot silence flag | `?sound=0` (also `off`/`mute`/`false`, and `?sfx=`) | Boots muted without writing to storage — for CI, for a playtest link, for a library. |
| e2e hygiene | `playwright.config.ts` | `--mute-audio`: the graph is still built exactly as in a real session (so a regression still fails a spec), it just never reaches a speaker on the runner. |

## The mix

The theme is *The Foundry Syndicate* — carved iron, aged brass, oiled walnut, one
amber lamp, a typewriter ledger ([`UI-NOIR-THEME.md`](UI-NOIR-THEME.md)). So the
palette is **wood, felt, paper, glass and brass**, and never the bright digital
beep a game reaches for when nobody is listening for it. Concretely: a *tone*
carries the pitch and the body, a *noise burst* carries the material — the
transient is what decides whether a click reads as brass, as a fingertip on
paper, or as a shovel in gravel.

Every cue is short and quiet, and that claim is measured rather than hoped: the
shipped catalogue's loudest single layer peaks at **0.16**, its loudest cue at
**0.34** summed across layers that are not in fact simultaneous (the eight-note
`victory`, spread over 2.1 s), its pitches span **44 Hz – 2.1 kHz**, and its
longest layer is **2.12 s**. The master defaults to **0.55**, so the worst
moment in the HUD lands near −15 dBFS. The limiter exists because the cues are
individually quiet but a cascade stacks six of them inside 40 ms, and it is the
*sum* that would crackle. `tests/unit/sfx.test.ts` audits all four numbers on
every cue, so the ceiling can only move in a diff that moves it on purpose.

| Cue | The moment | The sound |
| --- | ---------- | --------- |
| `hover` | a control noticed | 16 ms of air at 2.6 kHz under a whisper of 1.76 kHz, jittered ±40 cents so a row of buttons cannot sound like one stuck note |
| `click` | any button, chip, mini-action | a brass key settling: triangle 300→190 Hz plus a 12 ms transient |
| `tab` | Market / Bank / Plant / Feed, Map / Build / Economy, a `<select>` changing | a drawer sliding one bay — mostly noise, 1250→620 Hz, almost no body |
| `select` | a gem picked up, a tool armed, a tycoon chosen, a difficulty card | a small glass ping on a fifth (784 + 1176 Hz); `step` transposes it |
| `pick` | the cross bounty chooser spending one unit | the ladder, one rung per tap — the panel audibly fills up |
| `swap` | two gems traded | cards sliding on felt: noise 780→2300 Hz with a little lift |
| `open` / `close` | Help, a modal, the final ledger, a toast's ✕, Review / Restart | two notes a fifth apart, rising to open and falling to close |
| `pop` | one gem cleared | a marble dropped in a wooden box, climbing the pentatonic ladder as the cascade runs |
| `crack` | ice or a girder cracked, the Repair Crew at work | a bright splinter at 2.8 kHz over a 190→120 Hz thump |
| `up` | a token stamped up a grade | one note bending up, no transient |
| `boom` | a bomb, or sabotage landing across the map | behind a door, not in the room: 112→44 Hz, over in 300 ms |
| `combo` | the `CHAIN x2` / `COMBO x3!!` callout | a hand bell rung once, brighter per tier |
| `deny` | a refusal, a bad swap, a toast that says no | a palm flat on the ledger — two muted knocks a minor second apart. Deliberately not a buzzer |
| `place` | dirt road laid | a shovel patting earth down; `step` (tiles in the drag) adds up to two further pats behind the first |
| `pave` | a paved Road laid, or a dirt tile upgraded | the same pat, brighter, with a trowel ring at 1.18/1.76 kHz |
| `build` | Factory, Depot or Processing Plant raised; Security Forces hired | a heavy crate set down (98→68 Hz), dust, then the brass latch |
| `demolish` | a building or a road torn up | a 220 ms crumble with three splinters in it |
| `harvest` | cargo landed in the purse | three quiet rungs up |
| `coin` | Gold from a combo, a gold mine, or a blessed cross | two coins touching, then the shimmer of the second |
| `star` | a Victory Point earned | one small brass bell with a long tail — the only sound allowed to ring |
| `wire` | Torvin's private wire opens | two telegraph clicks and the paper behind them |
| `victory` / `defeat` | the final ledger | a soft pad under a four-note cadence that lands on the tonic; the same shape descending a fifth and muted for a loss. No fail horn |

### The three rules that keep it subtle

1. **Every cue has a gap.** `hover` 55 ms, `pop` 38 ms, `deny` 200 ms, `wire`
   420 ms, `victory` 900 ms. Nine gems resolving in one synchronous pass are
   heard as **one** strike; the same nine gems arriving as the board animates are
   heard one by one, climbing. A stack of four bad toasts knocks twice, not four
   times.
2. **The cascade sings a ladder.** `pop` and `pick` keep a streak: hits inside
   650 ms (900 ms for the chooser) rise step by step through a **major
   pentatonic on A** and fall back to the root after a pause. No two notes in
   that scale clash, which is why a cascade the simulation produced at random
   still sounds composed. It is the single most "sensory" trick in the mix.
3. **Good news does not double up.** A refusal gets a sound (`deny`) because it
   is the one message a player might miss at the edge of their vision. A *gain*
   does not get a toast sound, because every gain already sounds where it
   happens — `harvest`, `coin`, `star`, `build` — and a second chime on the
   toast that reports it is exactly the doubling that makes a game feel noisy.

### The mix budget

A cue is 1–6 layers; `MAX_VOICES` is 18, i.e. roughly four things at once, and
the 25th is dropped rather than allowed to clip. Layers are accounted **by end
time** (pruned on each new cue) and disconnected on `onended`, so a long session
neither leaks nodes nor slowly mutes itself.

## Why the whole thing is synthesised

The repo ships no audio assets and no audio pipeline, and PP-14 already set the
precedent: a generated sound needs nothing to load, can never 404, costs no
bytes, and can be *tuned in a diff* — "the click is too bright" is a one-number
change in `cues.ts`, not a re-export from a DAW. Three further rules come
straight from PP-14 and are enforced by tests:

* **Garnish must never break the board.** Every entry point is wrapped, and
  every *optional* node — the limiter, the biquad, the noise buffer, `detune` —
  is **feature-detected**, never assumed. A browser, a private-browsing block or
  a two-node test fake that offers only part of the API degrades to a simpler
  sound or to silence, never to a throw. `tests/unit/iso-game.test.ts` has stubbed
  `createGain` + `createOscillator` and nothing else since PP-14; the whole
  catalogue still runs against it.
* **Nothing sounds before the player touches the page.** Autoplay policy wants a
  gesture anyway, so `attachUiSound` only arms the engine from an event whose
  `isTrusted` is true, and `sfx.play()` refuses until then. A background tab
  never bleeps to itself, a boot-time toast is silent, and every synthetic event
  in a headless suite is silent — which is precisely what keeps PP-14's
  oscillator counts (`> 10` for a holy cross, `0` for a broken one) meaningful.
* **Sound never touches the simulation RNG.** Only `Math.random`, and only for
  the grain of a noise burst, so a cue cannot move a dice roll the game depends
  on (the rule `rivalry.ts` keeps for its flavour text).

## The wire, end to end

```
main.tsx           attachUiSound()            one delegation for the whole app
                                            ├─ pointerdown (trusted) → unlock() → pressCueFor(target)
                                            ├─ pointerover (trusted, not touch) → hoverCueFor(target)
                                            ├─ keydown Enter/Space → pressCueFor(target)
                                            ├─ keydown M → sfx.toggle() → "select" on the way back up
                                            └─ change on a <select> → "tab"

ui.ts              attachUiSound(root)        idempotent — covers a UI mounted without App
                   🔊 .icon-btn               sfx.toggle() + registerSoundPainter(paintSound)
                   setTab / setMobileView  →  "tab"       (only when the pane really moves)
                   selectOrSwap           →  "select" / "swap"   (the grid is data-sfx="off")
                   fx(type)               →  pop crack up boom deny combo · cross → playHoly()
                   popup(gains)           →  "harvest"    (only when something landed)
                   toast(bad|danger)      →  "deny"
                   helpModal / showModal  →  "open"   ·  every close path → "close"
                   showNextRivalryBeat    →  "wire"
                   .cross-pick-btn        →  data-sfx="pick"   · .cross-pick-confirm → "coin"

game.ts            commitTrackDrag        →  "place" | "pave"  { step: tiles }
                   placeFactoryFor / placeHarvester / placePlant (human seat) → "build"
                   doDemolish (human seat)→  "demolish"
                   rescoreNow, ★ up       →  "star"
                   quarry onGold          →  "coin"
                   buyBlack harden/block/fog, placeProtest → "boom" (gain 0.55–0.65)
                   buyBlack security → "build" · repair → "crack"
                   presentEnding          →  "victory" | "defeat"

holy.ts            playHoly()             →  the PP-14 recipe, into the shared bus
```

Only the human seat's actions sound: the rival builds, paves and demolishes in
the same shared functions, and a game that narrates the AI's turns to you is a
game you cannot read your own moves in. The rival is heard through `wire` (its
banter) and `boom` (your sabotage landing on it) — never through its own builds.

### Markup, not handlers

A control that wants a different sound says so in markup, and a control that
wants none says `data-sfx="off"`:

```
data-sfx="<cue>"          this element presses as that cue
data-sfx="off"            no hover, no press — subtree-wide (the 🔇 button, the gem grid)
data-sfx-hover="<cue>"    override the hover tick only ("off" = none)
```

That is why the bounty chooser, the ending card, the difficulty prompt and the
start screen needed no handlers at all: `review.dataset.sfx = "close"`,
`restart.dataset.sfx = "open"`, `btn.dataset.sfx = "select"`. It is also why the
chooser's taps are silent in the headless suites while still being loud in a
browser — the sound belongs to the *touch*, not to the bookkeeping.

Two conventions the delegation keeps, so nobody has to think about them: a
`<select>` is **silent when pressed** and sounds its `change` (`tab`), because
opening the list is not the choice — choosing is; and a nested scope **stands
down** when an ancestor is already listening, so `main.tsx`'s document-wide
attach and `ui.ts`'s HUD-root attach (which exists for a chrome mounted without
`App`, as the headless suites do) never both answer the same click.

## Auditioning it

A dev build (or `?iso-debug=1`, `?sfx-debug=1`) installs `window.__sfx`:

```js
__sfx.help                 // the one-line menu
__sfx.audition()           // walk the whole catalogue, one cue every 720 ms
__sfx.play("pave", { step: 6 })
__sfx.cues()               // the 24 names
__sfx.notes()              // what each one is for
__sfx.volume(0.3)          // master gain, persisted
__sfx.mute() / unmute() / toggle()
__sfx.stats()              // { played, throttled, refused, layers, live }
```

`stats()` is the mix's own instrument: after a real cascade, `throttled` should
be visibly larger than `played` (the gaps are working) and `live` should never
have gone near 18.

## Tests

`tests/unit/sfx.test.ts` (43 cases) with a recording fake Web Audio graph in
`tests/unit/helpers/audio.ts` — a fake that counts nodes, records every
automation event on every param, and can fire `onended` so teardown is
observable. jsdom cannot build a *trusted* event (it defines `isTrusted` as an
own, non-configurable getter, so neither `defineProperty` nor a subclass gets
past it), which is why `attachUiSound` takes an injectable `isTrusted`
predicate; nothing in `src/` ever passes one.

* **The catalogue is complete and self-describing** — every cue builds at least
  one layer and carries a note; the moments the game has cannot be renamed
  silently.
* **Nothing sounds before a real gesture** — no nodes at all until `unlock()`; a
  synthetic `pointerdown` neither arms nor sounds; a jsdom `.click()` on a
  `data-sfx="pick"` button is silent, which is the property PP-14's oscillator
  counts rest on.
* **The delegation's policy** — press/hover classification by element, subtree
  opt-out, disabled controls, child-target resolution, one hover per control
  rather than per child, no hover on touch (but a tap still sounds), keyboard
  parity, text fields left alone (Space types a space, `M` types an m),
  attach-once/detach-clean, a `<select>` voiced by its change and not its press,
  and a nested scope standing down under an already-attached ancestor (asserted
  through `stats().throttled === 0`, because a duplicate hidden by a gap is
  exactly the kind that ships).
* **The mix is legal Web Audio, and measurably quiet** — every cue audited
  against the rules a real engine enforces: no exponential ramp to zero on any
  param (an `InvalidValueError`, not a quiet note), every frequency positive and
  inside hearing, every gain finite and non-negative, every layer started before
  it is stopped, one enveloping gain per layer, and the peak ceilings above.
* **The mix cannot run away** — a synchronous nine-gem burst is one sound; an
  animated cascade is nine and climbs the ladder (440 → 493.88 → 587.33 → …) and
  resets after a pause; the voice budget holds and frees; finished layers
  disconnect; everything started is stopped.
* **The mute switch mutes the whole game** — zero nodes while muted *including
  the choir*; the choir's swell lands on the shared master (`master → limiter →
  destination`); unmuting pings and muting does not; the volume rides the master
  gain and is clamped; muting mid-cue cancels and ramps rather than clicks; the
  choice survives a reload; `?sound=0` boots silent without touching storage;
  registered controls repaint on every change, including from `M`.
* **Garnish never breaks the board** — every cue against no AudioContext at all,
  against a half API (no buffer sources ⇒ noise cues stay silent, tone cues
  still sound), and PP-14's choir through the same two-node stub it has always
  been pinned by (`> 10` oscillators).
* **The console hook** — the `__iso`-style gate, and an audition that really
  walks all 24.

Pre-existing, unrelated and unchanged by this ticket: three heavy rival-AI
timing cases in `tests/unit/iso-game.test.ts` (`N aiTicks grow the rival's
track…`, `banks toward a paid Depot…`, `expands, paves, and never hoards…`) fail
on a pristine `main` checkout in this sandbox too — verified by stashing the
whole diff and re-running them.

## What is deliberately not here

* **No ambience or music.** A 144×144 tycoon map could carry a room tone, a
  lorry hum or a period soundtrack, and each of those is a *decision about the
  game's mood* rather than about its controls. This ticket is UI sound; the bus
  is ready for a bed if one is ever wanted (one more node between `master` and
  the limiter).
* **No per-cue volume sliders.** One switch and one number, persisted. A mixer
  in the top bar of a game with six resource chips would cost more attention
  than it returns; `__sfx.volume()` is the tuning knob and `DEFAULT_VOLUME` is
  the shipped mix.
* **No spatialisation.** The map is isometric and the sounds are not: a build at
  the edge of the screen is not panned to that edge, because the player is
  looking at the HUD when most of these fire. Stereo width on a mono phone
  speaker is a loss, not a feature.
* **No recorded samples, and therefore no loading state.** Nothing to prefetch,
  nothing to decode, nothing to fail.
