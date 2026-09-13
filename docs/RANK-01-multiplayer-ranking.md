# RANK-01 — multiplayer ranking: Elo ratings, tiers, badges and the ladder

*"Multiplayer ranking system with Elo-style ratings, rank tiers and badges."*
This document is the record of that pass: the numbers, the decisions that were
not obvious, where each rule is enforced, and how it was verified.

Four decisions were taken with the product, and everything below follows from
them:

| Decision | Why |
|---|---|
| **Quick match is the only rated door.** Host and join-by-code stay casual forever. | A shared code is how you play with friends. A ladder fed by arranged matches is a ladder of arrangements. Ratings never move for AI or story matches either. |
| **There is a Ladder panel**, sourced from the RUN leaderboard API. | The issue asked for "top ratings"; a panel that degrades silently beats a page that breaks when the platform is unavailable. |
| **Seasons are a seam, not a rotation.** The file carries a season key; the reset recipe is written down (§7) but nothing rotates today. | A reset needs a decision about soft vs hard, and a season that silently starts over is worse than no season. |
| **Badges are painted plates**, generated from one hand-painted master and committed. | Matches the story-art pipeline (`assets/story-src`, `assets/ui-src/noir`): the theme lives in the artwork, not in a CSS tint. |

---

## 1. The rating (src/net/rating.ts)

Classic Elo over a pairwise, decisive game — which is exactly what a two-seat
race is, so there are only two knobs:

| Constant | Value | Why |
|---|---|---|
| `START_RATING` | 1000 | The issue's number, and a round one. Inside Bronze's band, so the first wins are the promotion. |
| `K_PROVISIONAL` | 40 | A new player's rating is a guess; let it move fast for the first ten matches. |
| `PROVISIONAL_MATCHES` | 10 | After this, `K_ESTABLISHED` = 16. Halving K is the classic chess pairing. |
| `RATING_FLOOR` | 100 | A rating that can run to zero turns a bad start into a hole. Clamped, not wrapped. |

One expectation produces both halves of a match (`rateMatch`), so the winner's
gain and the loser's loss are computed from the SAME pre-match pair — the
classic bug is updating one side first and then reading the new number as the
other's opponent, so the two are never evaluated separately.

### Tiers

| Key | From | Badge mark |
|---|---|---|
| `unranked` | — (no rated match yet) | the master's bare iron, no pips |
| `bronze` | 0 | 1 star |
| `silver` | 1100 | 2 stars |
| `gold` | 1250 | 3 stars |
| `platinum` | 1400 | 4 stars |
| `diamond` | 1550 | 5 stars |
| `master` | 1750 | 6 stars, open-ended |

`unranked` is a STATE (`matches === 0`), not a band: a player who has never
played must not be shown a rank they have not earned. Promotion and demotion
are reported only when the tier KEY changes, so the ending screen does not
celebrate every win as a promotion.

### The local write rule (advanceRating)

A stored file is replaced by a NEWER one, and "newer" means more matches — not
a higher number. A loss therefore lowers the stored rating, which is the whole
point of a rating. What the rule refuses is an OLD file overwriting a newer
one: two tabs, an offline device, or a late result from a previous match can
all hand it a state built from a shorter history, and the longer history is the
truth. A season change replaces outright (§7).

## 2. Who files a match, and what a forfeit is

**The room files the result, never the players** (`src/rooms/HexmatchRoom.ts`).
Both seats compute the same two halves from the board the room holds, so the
two clients cannot disagree about one match:

1. Each player publishes its rating once on join (`playerRating`); the room
   requires the id to be the sender's and, on the first publish, a join token
   it can hold the seat to afterwards.
2. When the host crosses the star line, the host sends `resultClaim`. The room
   validates it (host-only, both ids are members, one result per room) and
   broadcasts `result` to EVERYONE — including the host, so both seats act on
   one verdict instead of each trusting itself. The result carries no rating
   numbers, only the two ids and the board it was computed against.
3. Each seat applies its own half, keeps the file, and re-publishes the new
   number so a rematch in the same room rates correctly.

**Abandonment is a loss for the seat that empties.** A ladder that ignored
abandonment would make quitting strictly better than losing, and the top of the
board would belong to whoever walked away fastest.

| Case | Rule |
|---|---|
| Explicit "Leave room" in a live match | Immediate forfeit. The confirm sheet says so before the player commits. |
| A dropped socket | 30 s of grace (`FORFEIT_GRACE_MS`), cancelled by a reconnect (the room's `reconnectTimeout` is 60 s, so the window is inside it). |
| The host abandons | The guest is credited the win — the same rule, either seat. |
| A departure in the LOBBY (before any state was published) | Nothing is rated. Leaving before the match is not losing. |
| An AI or story match | Nothing is rated. |

The leaver applies its own loss locally on the way out (`fileOwnForfeit`): the
room's `result` is broadcast after that seat is gone, so the leaver would never
see it. That local filing is marked `localOnly` — it does not write to the
ladder. The ladder is written from a result the room witnessed, and a client
that writes its own loss on the way out is a client that could have written
anything on the way out. (A loss cannot raise a keep-best board anyway.)

## 3. What stops a player from lying about a rating

| Defence | Where |
|---|---|
| A rating's `id` must be the SENDER's — nobody can write somebody else's number. | `HexmatchRoom.onRating` |
| The first publish for a seat must carry a join token; later ones must carry the same. A rejoining client re-publishes with the token it was issued. | `HexmatchRoom.onRating` |
| Only the host may file a verdict — the guest does not run the simulation, so it has no standing to declare the star line crossed. | `HexmatchRoom.onResultClaim` |
| `result` carries no numbers: each seat recomputes from the board the room stamped. | `src/net/protocol.ts` → `RankRuntime.handleResult` |
| One result per room, set before the broadcast, so a race between the grace timer and a claim cannot move a rating twice. | `HexmatchRoom.fileResult` |
| The file lives in RUN player storage (`appStorage`), which is per-player and server-backed — not a shared or client-authored blob. | `src/net/transport.ts` (`readPlayerValue` / `writePlayerValue`) |
| A match is filed once per client, guarded by a key derived from the room's own result (`at:winner:loser`), written BEFORE the rating so a crash loses a move rather than duplicating one. | `src/net/rankstore.ts` |

The honest limit: a player owns their own storage bucket, so a determined cheat
can rewrite their own file. That is why **a rating gates nothing** — it is a
badge and a ladder position. The ladder is a keep-best board written from
room-witnessed results, and the room refuses to rate a lobby. The seam to
revisit, if the platform grows server-writable per-player storage, is
`rankstore.ts` plus the two storage wrappers in `transport.ts`.

## 4. Storage and the ladder

| Thing | Where | Key / mode |
|---|---|---|
| The rating file | RUN `appStorage`, mirrored to `localStorage` | `hexmatch:rank:v1` |
| The once-only guard | same, mirrored | `hexmatch:rank:filed:v1` |
| The local mirror prefix | `localStorage` only | `hexmatch:rank:<key>` |
| The public ladder | leaderboard board `ranked` | `rundot/leaderboard.config.json` |

A page with no RUN host (a dev room, a preview) writes the mirror only, and a
mirror that is the only source is promoted to remote on the way out — a rating
kept on one device is a worse rating, not a lost one. Every read resolves; a
ladder that is unreachable returns `null` and the panel says so in one line.

`rundot/leaderboard.config.json` declares the `ranked` mode (bounds 100–4000,
1 s–2 h, all-time period, rate limiting on, z-score detection off). The board
is keep-best, so it holds a player's PEAK rating — a lower submission returns
`accepted: false` and changes nothing, which is why a public board can honestly
show "highest rating" while the private file holds the current one. The config's
shape is pinned by `tests/unit/net-transport.test.ts` against the fields the
SDK's `LeaderboardConfig` requires: a typo in it fails at deploy, in
production, silently — so it is checked here.

## 5. The three surfaces

| Surface | What it shows | Where |
|---|---|---|
| Start screen, "choose" | The player's own badge, rating, W/L, and points to the next tier; the Ladder panel (top 20 + your own row). | `src/ui/StartScreen.tsx` (`.rank-chip`, `.ladder-panel`) |
| Room lobby | A chip per seat — your own from the room's echo, the opponent's from the board; a "· RANKED" kicker and a note for ranked rooms. | `src/ui/StartScreen.tsx` (`chipBySeat`) |
| End of match | Badge, rating, the signed delta (`+18`), promotion/demotion, and — while the room is still filing — "Filed with the room…". A forfeit says so. | `src/iso/ending.ts` (`.ending-rank`), wired in `src/iso/game.ts` |

Badges are 96 px PNGs in `src/assets/ui/rank/`, derived by
`node tools/make-rank-badges.mjs` from the painted master
`assets/ui-src/rank/medallion-master.png` (1–6 stars knocked into the blank
disc; `--contact <png>` writes a review sheet). To restyle every badge, repaint
the master and re-run the tool — no code change, and `badgeUrlFor` falls back
to the unranked plate for a key this build does not know, so a stale bundle
shows a medal rather than a broken image.

## 6. Matchmaking: Any rank / Similar rank

The pool matches criteria by EQUALITY — `MatchmakeOptions.criteria` is a flat
bag of string/number keys, with no "within N points" operator — so a rating
window is expressed as a bucket index (`searchBucket(rating, span)`) and a
WIDER window is a different bucket. `quickMatch` sends `mode` alone for Any
rank, or `mode` + `rank: <bucket>` for a window.

Similar rank is therefore a client-side widening ladder
(`RANK_SEARCH_STEPS` in `src/ui/StartScreen.tsx`): ±75 for 6 s, ±200 for 8 s,
±400 for 8 s, then **Any rank** for the last 8 s. The last rung is the promise
that nobody is stuck forever, and it is also the widest net: the pool requires
a room to satisfy every REQUESTED key, so a plain search can join a room that a
windowed search created, but not the other way round. Total 30 s, matching the
screen's promise.

Two honest notes: a bucket boundary means a window can miss somebody a point
outside it (which is why the ladder widens instead of trusting one bucket), and
a room created by a windowed search carries that criterion for its life — the
widening ladder's later rungs simply stop asking for it.

## 7. A season reset, when it is wanted

The file's `season` is compared, and a file from another season REPLACES the
current one rather than competing with it. So a reset is one write, at the
season seam:

```ts
// src/net/rankstore.ts, at the seam — not shipped (see the decision table)
await saveRankState({ rating: START_RATING, matches: 0, wins: 0, losses: 0, season: "s2" });
```

Because the ladder's board is keep-best, a reset that wants the public board to
follow needs a new board (or a period) rather than a lower submission.

## 8. Where the code is

| File | Owns |
|---|---|
| `src/net/rating.ts` | The arithmetic, the tiers, `searchBucket` — pure, SDK-free, no storage. |
| `src/net/protocol.ts` | The v6 wire: `playerRating`, `ratingUpdate`, `resultClaim`, `result`, `Welcome.ratings`. |
| `src/rooms/HexmatchRoom.ts` | The board, the join tokens, the one-result rule, the forfeit timer. |
| `src/net/session.ts` | The client's copy of the board (`ratings`, `board`, `publishRating`, `claimResult`) — and the `result` that must survive the peer-left halt. |
| `src/net/rank-runtime.ts` | The match's half: publish at boot, file once, re-publish, own-forfeit. Injected into the game, so `iso/game.ts` stays SDK-free. |
| `src/net/rankstore.ts` | The policy: keys, the once-only guard, the local mirror, the ladder write. |
| `src/net/transport.ts` | The SDK seam: `appStorage` wrappers and the leaderboard calls. |
| `src/ui/rank-badge.ts`, `src/assets/ui/rank/` | The plates, and which tier wears which. |
| `tools/make-rank-badges.mjs`, `assets/ui-src/rank/` | Deriving the plates from the master. |
| `rundot/leaderboard.config.json` | The ladder board's server config. |

## 9. How it was verified

| Test | Pins |
|---|---|
| `tests/unit/net-rank.test.ts` | Elo behaviour (lower-rated wins more, provisional moves faster, the floor holds), tier bands and boundaries, `searchBucket`, `parseRankState` tolerance, `advanceRating` newest-wins, and that the badge PNGs match `RANK_TIERS` and the derive tool's table. |
| `tests/unit/net-rankstore.test.ts` | The file read order (remote → mirror → fresh), the mirror promotion, the once-only guard, a loss writing through, `localOnly`, an unreachable ladder, and the match key. |
| `tests/unit/net-rank-runtime.test.ts` | Publish-once at boot, the board the RESULT carried beating the local copy, one filing per match, a foreign result ignored, storage failure not taking the match down, `claimWin` rounding, and the leaver's local-only loss. |
| `tests/unit/net-room.test.ts` | The room's five refusals (foreign id, missing/changed token, guest claim, malformed claim) and the two filings (host claim, abandoned seat), including the 30 s grace with fake timers. |
| `tests/unit/net-session.test.ts` | The welcome's board, `publishRating`'s token, the opponent's number, host-only `claimResult`, and the result that arrives AFTER the peer-left halt. |
| `tests/unit/net-protocol.test.ts` | v6 bumps and rejects v5, the four new messages round-trip, and a malformed welcome board is refused. |
| `tests/unit/start-screen.test.ts` | The Any/Similar control, the widening ladder's four rungs (and that the last one asks for nothing), and a ranked lobby. |
| `tests/unit/net-transport.test.ts` | The `ranked` leaderboard mode and the config's required fields. |

Play it end to end with `npm run dev`, two browser windows and a quick match
(see `docs/multiplayer-local-testing.md`): the lobby shows both badges, the
ending shows the delta, and closing one window files the match as a forfeit for
the seat that closed.
