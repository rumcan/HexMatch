# Radio stations (RADIO-2, #432)

The in-game player opens a **public HTTPS stream in the player's own
browser**. HexMatch does not download, cache, bundle or rebroadcast the
audio. Each station below was checked against its published terms before it
was added. The same URLs and the credit line live in `src/audio/radio.ts`
(`RADIO_STATIONS`).

Attribution is the station name plus the credit line, on the chip tooltip
and in Settings → Station. The "Licence" link opens the terms page (the raw
URL is not painted as text).

The lead play-tests whether each stream actually starts. This sandbox could
not complete a TLS handshake to the stream hosts, so playback itself was
**not** verified here.

## Dial

| id | Station | Mood | Stream | Licence | Terms |
| --- | --- | --- | --- | --- | --- |
| `hexmatch-lofi` | HexMatch Lofi | Lofi beats | `/assets/music/lofi/*.mp3` (playlist, loops) | Original music made for HexMatch (generated for the game; no third-party licence) | — |
| `radionos-lounge` | RadioNOS Lounge | 1950s-60s lounge, bossa, easy listening | `https://nos.radio.br:443/stream/13/;` | CC, public domain, or artist-authorized | https://radionos.com/site/sobre/ |
| `radionos-jazz` | RadioNOS Jazz | Jazz | `https://nos.radio.br:443/stream/3/;` | CC, public domain, or artist-authorized | https://radionos.com/site/sobre/ |
| `mdk-space` | MDK Space Radio | Space-age experimental | `https://radio.mdkband.com/stream.mp3` | CC BY 3.0 | https://creativecommons.org/licenses/by/3.0/ |
| `dogmazic` | Radio Dogmazic | Free-licence mix | `https://radio.dogmazic.net:8001/stream.mp3` | Free licences, credit the artist | https://www.dogmazic.net/licences.php |

Default station is HexMatch Lofi (our own playlist). The choice is stored under `hexmatch:radio-station`, separate from
the on/off, show and volume object at `hexmatch:radio`.

## Why these, and not others

### SomaFM — removed

https://somafm.com/contact/tos.html forbids embedding SomaFM in any website, application or platform without prior written permission, and their direct-link pages say the URLs are not for video games. The owner removed Secret Agent (2026-09-26). The default station is now **HexMatch Lofi**: six original lofi tracks generated for the game (rundot), shipped in `assets/music/lofi/` and copied into the build beside `assets/voice/`. They play in turn and loop.

Tracks:

- `/assets/music/lofi/lofi-01-main-street.mp3`
- `/assets/music/lofi/lofi-02-rail-yard.mp3`
- `/assets/music/lofi/lofi-03-harbour.mp3`
- `/assets/music/lofi/lofi-04-night-shift.mp3`
- `/assets/music/lofi/lofi-05-drive-in.mp3`
- `/assets/music/lofi/lofi-06-sunday-plant.mp3`

### RadioNOS Lounge and Jazz

https://radionos.com/site/sobre/ — non-commercial station that states it
only plays Creative Commons, public-domain, or music an independent artist
authorized them to broadcast. The site itself is CC BY 4.0
(https://creativecommons.org/licenses/by/4.0/). They publish the direct
stream URL on each channel page (Lounge: https://radionos.com/site/lounge-channel/,
Jazz: https://radionos.com/site/jazz-channel/). They do not say "personal
use only" or "not for games".

Caveat, written down so the lead can pull these if they disagree: some
tracks may be CC-BY-NC, or authorized only to RadioNOS (their third
criterion), not to every downstream player. We attribute RadioNOS and link
the policy. We do not rebroadcast; each browser opens their public URL.

Lounge is the era fit: their own description is 1950s-60s harmony, bossa
nova and easy listening.

### MDK Space Radio

https://mdkband.com/mdk/ — MDK release their own music under CC BY 3.0
(https://creativecommons.org/licenses/by/3.0/). The player at
https://radio.mdkband.com/ labels the transmission "music by MDK · CC BY 3.0"
and publishes `https://radio.mdkband.com/stream.mp3` as a direct stream.
CC BY 3.0 allows playback in a game, including a commercial one, with
credit. Credit line: "Music by MDK. Creative Commons Attribution. Credit MDK."

### Radio Dogmazic

https://www.dogmazic.net/ — Musique Libre's archive. They say you may play
the music at a party or in a podcast: it is legal, free, and has no ads.
The licence table (https://www.dogmazic.net/licences.php) is the per-track
grant; many licences allow non-commercial broadcast with attribution, and
the freer ones (CC BY, CC0, Art Libre) allow commercial broadcast too.
Their radio page publishes the direct stream
`https://radio.dogmazic.net:8001/stream.mp3`.

Caveat: the radio mixes licences, including NC. A free game with no ads in
the player is the non-commercial case. Credit the artist (the live playlist
is on https://radio.dogmazic.net/). We cannot show per-track titles without
ICY metadata, which `<audio>` does not expose. Station-level credit plus
the licence link is what the chip shows.

## Considered and not added

- **More SomaFM channels** — same terms as Secret Agent; embedding in a game
  is not allowed. See above.
- **LuxuriaMusic, The Quiet Village, and other era streams** — the mood is
  right (exotica, surf, space-age bachelor pad) but no terms were found that
  allow playback inside a third-party game. Not added.
- **Public Domain Jazz** (`http://relay.publicdomainradio.org/jazz_swing.mp3`)
  — the project digitises public-domain recordings, but the stream is HTTP
  only (mixed content on an HTTPS page) and "public domain" here follows
  Swiss practice, which is not the same as US sound-recording terms. Not
  added.
- **Streamsafe** (https://streamsafe.cc/streamsafe/) — CC BY and CC0, and
  they want the stream played on other people's broadcasts, but only if
  **per-track artist credits** are on screen. We cannot read ICY tags from
  `<audio>` without a proxy. Not added until that credit line exists.
- **Space Travel Radio** — GEMA-free / mostly CC, but the terms
  (https://www.spacetravelradio.de/) do not say a third-party game may embed
  the stream. Not added.

## Bundled playlist — not done

A looped CC0 / CC-BY playlist of 1950s-60s lounge, exotica and surf, served
from `assets/`, would fill the gap the live dial cannot (surf and classic
exotica have no stream whose terms clearly allow a game). **Not bundled
here** — the lead sources audio. If that playlist is wanted, it should be a
follow-up, not a download in this change.

## Behaviour

- ‹ › on the desktop chip, and a Station list in Settings. Phone keeps the
  one round play key (MUSIC-1); the list in Settings is the picker there.
- The choice survives a reload. A storage that throws does not throw out of
  the player; the dial falls back to Secret Agent.
- A stream error tunes the next station and toasts
  "`<name>` is not answering. Tuning `<next>`." When every station has
  failed, the old offline + backoff path runs, then the dial is tried again.
- Nothing calls `play()` until a tap. Changing station while idle does not
  open a connection.
- Master Sound off (the Sound switch, or `?sound=0`) forces the radio
  element to volume 0. Reduced motion still snaps the voice duck.
