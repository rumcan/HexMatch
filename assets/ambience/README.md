# Ambience beds (SFX-1 #463) — needed from the lead

The island's room tone: five looping beds under `assets/ambience/`, cross-faded
by `src/audio/ambience.ts` from the camera's zoom and position. Until these
files land, each bed plays a procedural placeholder loop baked in code (shaped
noise; chirps for the birds) — a shipped file replaces its bed wholesale the
moment it decodes, with no code change.

Wanted, one MP3 per bed (all five optional independently — ship any subset):

| File          | Heard…                                            | Notes                                   |
|---------------|---------------------------------------------------|-----------------------------------------|
| `sea.mp3`     | near a coast, louder at close zoom                | soft surf, no gulls (birds is separate) |
| `town.mp3`    | over towns, louder at close zoom                  | distant murmur, no intelligible voices  |
| `birds.mp3`   | countryside at zoom 1–2                           | sparse song, mostly air                 |
| `wind.mp3`    | everywhere, most in the countryside               | gentle air, no howling                  |
| `traffic.mp3` | the far zoom (0.5×)                               | far-away hum, wheels and engines        |

Mixing notes:

* Each file must loop seamlessly (equal loudness at both ends, no fade-out).
* 8–15 seconds each is plenty; the engine loops them forever.
* Peaks around −18 dBFS — the engine holds ambience well under the radio
  (`AMBIENCE_CEILINGS` in `src/audio/ambience.ts`), but a hot file still wins.
* Mono or stereo both fine; MP3 like the rest of the game's audio.

The build already ships this directory beside `index.html` (the voice/music/sfx
copy step in `vite.config.ts`), and the game fetches
`<base>/assets/ambience/<bed>.mp3` — a missing file is simply its placeholder.
