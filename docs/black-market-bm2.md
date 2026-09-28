# BM-2 (#560): timed Black Market session sabotage

## Cards and balance

| Card | Base Gold | Effect on sessions opened while active |
| --- | ---: | --- |
| Frost / Iron Girders | 24 | For 120 seconds, add 4 frozen gems and 2 breakable girders. |
| Red Tape | 18 | For 60 seconds, remove 2 moves from the session budget. |

Both share a **180-second per-attacker cooldown**, including attempts blocked
by Security Forces and Rafael's free-card purchases. Existing manager pricing
and free-card rules still apply. Unaffordable/cooldown refusals cost nothing.
Security blocks a new attack, but does not cleanse an already active effect.

Effects are sampled when a Depot tuning or city upgrade session opens. They
never interrupt an existing session. Obstacles already dealt remain breakable
until the session ends; expiry prevents them being dealt to later sessions.
Difficulty obstacles are additive, and the board's existing legal-move guard
remains in charge of placement. The solo AI's simulated sessions receive a
score penalty; Normal/Hard rivals alternate the two cards when their raid
clock, cooldown and Gold reserve permit. Easy never raids.

Live deadlines use `marketMs`. Saves store **remaining milliseconds**, rebased
on reload; network snapshots/deltas carry host-clock deadlines. UI cards use
flat paper backgrounds, orange Hire actions, cooldown and victim countdowns.

## Important multiplayer limitation — ticket not fully complete

This checkout explicitly gates the tuning/economy loop to solo games in
`src/iso/game.ts` (`newLoopRequested && isSolo() && !storyOn && !scenarioOn`).
Neither multiplayer seat can open a Depot/city tuning session. This change
**does not enable that unsupported mode**.

Host-intent validation, costs, cooldowns, opposite-seat targeting, expiry and
full/delta synchronization are implemented and tested. However, in multiplayer
(and other modes without tuning), these session cards currently have no board
on which to act. Do not treat wire-state tests as proof of multiplayer gameplay
or merge this as complete acceptance of #560. Multiplayer tuning needs its own
implementation/integration decision before these cards can be useful there.

## Targeted verification

```sh
npx vitest run tests/unit/iso-bm2.test.ts tests/unit/iso-mp.test.ts -t 'BM-2'
```

10 targeted tests pass. The filter excludes unrelated tests; no new test skips
were added. Covers real Depot/city sessions, no mid-session mutation, exact
expiry, legal moves, cost/cooldown/security, AI purchases and simulated results,
save/reload at a different clock origin, and MP intents/deltas/resync/expiry.
E2E is intentionally delegated to the pre-merge reviewer per the owner's request.

## Multiplayer

Multiplayer has no tuning sessions, so Frost / Iron Girders and Red Tape are refused there (no Gold is taken). They are solo-only until MP gains tuning.
