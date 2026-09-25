# Battles: balance, onboarding and ★ (#252, B7)

This PR balances the battle system that is on main now:
- Puzzle-Quest layout, match damage, the 20-turn limit;
- territorial fights (#322 / #323);
- minimap sabotage events and the event window.

It also decides how battles pay ★ and adds the first How to Play page for battles.

## Release gate

`tests/unit/battle-balance.test.ts` checks these gates when run with `BATTLE_BALANCE=1`. They are the targets this tuning was chosen against:

| Gate | Target | Before | After |
|---|---|---|---|
| Normal mirror: mean turns per battle (both seats' moves) | 10–18 | 5.1 | **13.2** |
| Normal mirror: ends by knockout (not the limit) | ≥ 60% | 100% | **87%** |
| Draws | < 5% | 0% | **0–1.5%** |
| Seat 0 (moves first) wins, normal mirror | ≤ 62% | 76% | **57%** |
| Seat 0 wins, greedy mirror | 38–62% | 66% | **46%** |
| Skill ladder: easy vs greedy | < 50% | 56% ✗ | **23%** |
| Skill ladder: hard vs greedy | > 50% | 80% | **93%** |
| Full spell kit vs no spells (normal) | > 50% | 45% ✗ | **70%** |
| Best single-ability loadout in the round robin | < 62% | 54%\* | **59%** |

\* Before, no loadout could dominate because almost nobody cast anything (see [Abilities](#abilities-and-openings)).

## How it is measured

The harness is `tests/unit/helpers/battle-sim.ts`. It drives the **real engine** (`createBattle`) with the **real rival policies** from `src/iso/battle-ai.ts` (#249), seeded only, with no `Math.random()`.

**Policies:**
- `easy`, `normal`, `hard`: `chooseBattleMove` with the live `BATTLE_SKILLS`.
- `greedy`: `greedyBattleMove`, the ladder's strawman (best immediate move, swap or spell).
- `swapper`: greedy with the spell book shut. This is the "no abilities" baseline.
- `spam: <ability>`: casts that ability whenever it is castable, otherwise plays its policy. This prices an ability's raw worth apart from the AI's opinion of it (the AI's cast heuristics were themselves part of the problem).

**Seeds and skills:**
- Seeds are `seedList(n, base) = base + 17·i`.
- Mirrors use base 5000; easy/hard vs greedy use 9000; spells vs none 7000 (greedy) and 7100 (normal); spam 7200; the round robin 8000.
- **Chairs alternate by seed**, so every matchup plays both seats equally often. The seat-0 rate is counted over decisive games.
- The doc tables use **N = 200** seeds per row (hard: 100, round-robin pairs: 100).
- At N = 200 one standard error is about ±3.5 points. Per-ability round-robin totals are 500 games each, about ±2.2.

**Run it:**

```bash
# the release gates (about 1 minute; N defaults to 200, the doc's tables)
BATTLE_BALANCE=1 npx vitest run tests/unit/battle-balance.test.ts
# a different N moves every row (the runs are seeded, so each N is repeatable)
BATTLE_BALANCE=1 BATTLE_BALANCE_N=400 npx vitest run tests/unit/battle-balance.test.ts
```

The fast half of the same file always runs. It pins the tuned table, the three new engine knobs, the ★ cap and the one-time hint.

## What was wrong (before, 2026-09-25)

These are the shipped tables, measured with this harness:

| Matchup (N = 200) | Turns | KO | Seat 0 wins | Extra turn per swap |
|---|---|---|---|---|
| greedy mirror | 8.8 | 96% | 66% | — |
| normal mirror | 5.1 | 100% | 76% | 0.70 |
| hard mirror | 3.5 | 100% | **93%** | — |

A cross-check on untouched `main` code (N = 60) agrees: seat 0 won 71 / 83 / 98%, easy vs greedy was 57%, and hard vs greedy was 85%.

1. **Battles were over in 2–4 of your own moves.** At 30 health, a swap averaged 7–11 damage once match damage (1 per gem) was on. The 20-turn limit never came into play.
2. **The first mover won.** A 4-match, an L/T shape or a 2-pass cascade gave an extra turn. Two gravity passes happen on their own, so 70–89% of normal/hard swaps kept the turn. Hard players chained the opening into a knockout 93–98% of the time.
3. **Casting was a losing move.** Every ability except Bribe spent the turn. A swap was worth ~7 damage plus mana plus a 70% chance of another swap. Against that, Dynamite dealt 4, Repair healed 6, and Girders/Frost/Smog hampered one enemy turn. Spamming any turn-costing ability won only **29–33%** against no spells, and the full kit won 41–45%. Normal and hard AIs, which can see a move ahead, simply stopped casting (0.0–0.2 casts per battle).
4. **The skill ladder was broken.** Easy *beat* greedy (56%), because greedy cast the bad spells and Easy only takes the free ones.

## What changed

| Rule | Before | After | Why |
|---|---|---|---|
| `startHealth` | 30 | **50** | Battles now last 13 turns (normal) instead of 5. |
| `extraTurnOnCascade` | 2 passes | **3 passes** | Two passes happen by gravity alone; they were a coin flip for a free turn. |
| `extraTurnChain` (new) | ∞ | **1** | One extra turn, then the turn passes, however big the move. The rival always answers. |
| `secondSeatHealth` (new) | 0 | **+10** | The seat that moves second opens at 60 (start and cap). This compensates the first move in a damage race. |
| Smog | uses the turn | **free action** | A turn for half a match's mana was a losing trade. |
| Girders | stone3 ore3, 3 girders, cd 3, uses the turn | **stone2 ore2, 4 girders, cd 2, free** | Obstacles now **arm** and drop when the caster's turn passes (see below). |
| Frost | grain3 wood3, 4 gems, cd 3, uses the turn | **grain2 wood2, 6 gems, cd 2, free** | Same as Girders. |
| Dynamite | 4 damage | **9 damage** | About one swap's worth, so spending the turn on it is a real choice. |
| Repair Crew | heal 6 | **heal 10** | Same reasoning. It caps at the seat's own full health. |
| Bribe, mana, damage per gem, turn limit, turn clock | — | unchanged | — |
| `challengeGold` 12, `declineGold` 9, player cooldown 2:00 | — | unchanged | This simulator cannot price them (see [the map side](#the-map-side-challenge-costs-and-cooldowns)). |

**Two engine changes** (`src/game/battle.ts`) make those rows possible. Both are rules-driven, saved, restored and carried on the wire (the rules and state travel with `DuelWire`):

- `extraTurnChain` sets `state.chain`, the extra turns the mover has chained so far.
- A **free** Girders or Frost cast *arms* its obstacles (`state.armed`). They drop the moment the caster's turn passes, and lift when it comes back, exactly as a turn-costing cast's obstacles do. Without this, a free Girders would block the caster's own follow-up swap, which breaks the playtest rule "obstacles never block the one who cast them".
- **Numbers alone could not fix the obstacle spells.** Even at 7 girders / 8 frost gems, cheap and on a 2-turn cooldown, turn-costing obstacles won only **20–29%** when spammed. The opponent nearly always still finds a match.

**One AI fix** (`src/iso/battle-ai.ts`): a free action worth more than 1 is now cast *first*, because it competes with no swap. Before, the rival priced Bribe against the best swap (the code's own comment said a free action "competes with nothing"). The extra-turn bonus also respects the chain cap.

## After (2026-09-25, shipped tables)

| Matchup (N = 200) | Turns | KO | Draws | Seat 0 wins | Extra turn per swap |
|---|---|---|---|---|---|
| greedy mirror | 17.8 | 48% | 1.5% | 46% | — |
| normal mirror | 13.2 | 87% | 0% | **57%** | 0.37 |
| hard mirror | 13.3 | 86% | 2% | 64% | — |

- Easy vs greedy: **23%**. Hard vs greedy: **93%**. The ladder is ordered again.
- Greedy's full kit vs the same bot without spells: **62%**. Normal's full kit vs normal without Depots: **70%**. Normal now casts 4.9 times a battle.

**The hard mirror keeps a 64% first-move edge.** +12 health fixes it (59%), but over-compensates greedy (40%) and normal only improves to 54%. Humans play closer to greedy/normal than to a 2-ply search, so +10 is the compromise. The sweep:

| `secondSeatHealth` | greedy | normal | hard |
|---|---|---|---|
| 0 (after the other changes) | 65% | 73% | 82% |
| 8 | 54% | 59% | 67% |
| **10** | **46%** | **57%** | **64%** |
| 12 | 40% | 54% | 59% |

In solo the player is always seat 0, the seat that moves first. The +10 is the rival's compensation, and it shows on its health bar (60).

### The road here (the sweep, abridged)

| Variant (N = 60–120) | Normal turns | Seat 0 (g / n / h) | Spells vs none |
|---|---|---|---|
| shipped | 4.5 | 71 / 83 / 97 | 43% |
| cascade off | 5.1 | 70 / 78 / 77 | 38% |
| cascade off, health 50 | 10.9 | 63 / 68 / 80 | 38% |
| chain 1, cascade 3, health 45 | 10.1 | 65 / 73 / 82 | 37% |
| … + second seat +2 **mana** each colour | 11.4 | 74 / 70 / 76 | 37% |
| … + second seat +8 **health** | 11.6–12.1 | 49–57 / 57–58 / 64–72 | 34–36% |
| … + Dynamite 8, Repair 10 | 12.8 | 53 / 65 / 78 | 46% |
| … + control spells free, health 50 | 14.0 | 50 / 58 / 58 | 63% |

**Takeaways:**
- Health alone lengthens battles but keeps the first-mover lock.
- A mana head start barely moves it.
- A health head start does.
- Only free control spells plus a stronger Dynamite and Repair turned casting from a trap into a choice.

## Abilities and openings

An **opening** here is a loadout: the set of Depots a seat brings, which is what gates its spells on the map. The table measures each ability as a *single-Depot loadout*:

- **AI** = that loadout, played by greedy (g) or normal (n), against the same policy with no spells;
- **spam** = normal casting it whenever it can;
- **round robin** = the six single-ability loadouts played against each other with normal, averaged over the five opponents.

| Ability | Before: AI g / n | Before: spam | Before: round robin | After: AI g / n | After: normal casts per battle | After: spam | After: round robin |
|---|---|---|---|---|---|---|---|
| Iron Girders | 50 / 48 | 33% | 48% | 52 / 48 | 1.2 | 50% | 45% |
| Frost | 47 / 52 | 29% | 46% | 49 / 48 | 1.2 | 45% | 47% |
| Smog | 46 / 48 | 32% | 52% | 56 / 49 | 1.5 | 56% | 46% |
| Dynamite | 47 / 50 | 33% | 50% | 52 / 62 | 1.4 | 47% | **59%** |
| Repair Crew | 49 / 49 | 33% | 54% | 58 / 60 | 1.2 | 53% | 57% |
| Gold Bribe | 52 / 45 | 49% | 51% | 52 / 50 | 1.1 | 45% | 46% |
| **Full kit** | 41 / 45 | — | — | **62 / 70** | 4.9 | — | — |

**Reading it:**
- **Before:** every turn-costing ability lost about two thirds of the games when used (spam 29–33%). The flat round robin only meant nobody cast: 0.0–0.2 casts per battle.
- **After:** every ability is at least break-even when spammed (45–56%, within noise of 50%). The full kit is clearly worth owning (62–70%), so building Depots pays off in battle.
- **No loadout dominates.** The round-robin spread is 45–59%, under the 62% gate.
- **Dynamite and Repair lead** because the rival AI plays direct-value spells better than disruption. Its Girders/Frost heuristic is crude ("cast while not far behind"). Spammed, the control spells are as good as Dynamite (45–56% against 47%).
- Trimming Dynamite/Repair further (8 / 9–10, cooldown 3) did not move them below ~58% in three sweeps, so the gap is the AI, not the table. It is a follow-up.

## ★: what battles pay, and the cap

**Decision:** battles pay ★ through **what they hold**, not through the fight. The rule is **+1★ per contested site held**:
- a contested site is an industry or a town where the last battle fought over it went your way;
- the standing winner is `siteRights[id].streak` (and they still have rights there), or `townHolds[id].holder`;
- the cap is **at most 2★ per seat**.

| | |
|---|---|
| Revocable | Lose the next battle there and the ★ moves to the winner. A draw changes nothing. |
| Unfarmable | Winning a fight pays nothing by itself. A site nobody fought over pays nothing (first-come holds are the `type` row's business). Declining is a forfeit, but the challenger paid 12 Gold for it. |
| Derived | No new saved or wire state. `siteRights` and `townHolds` are already in the snapshot and the save, and the ★ is re-derived on every rescore like every other loop source. |
| Capped | `VICTORY.loop.holdCap = 2`. Sites that already pay keep their slot, so winning a third site does not reshuffle which two pay. Losing one lets the next held site step in. |

**Why this and not "★ per battle won":**
- #228 / L13 asks for ★ from several independent sources, with *control* ★ such as holding contested industry, and quests capped.
- A per-win ★ is a farm: two players trading the same site would both climb.
- A held site is a position the rival can take back, so the ★ reflects the map, not the kill count.

**Battling is one route among several:**

| Source | ★ each | Available without a battle |
|---|---|---|
| Depot running | 1 | up to 6 cargo types |
| Route fully paved | 1 | one per Depot |
| Depot at top level | 1 | one per Depot |
| City upgrade tier | 1 | 3 |
| **Contested site held** | 1 | **0. Capped at 2 in total** |

- **Winnable without battling.** The line is 12★, and the non-battle rows alone offer well over 12. Every race suite in `test:slow` (`iso-l1d-race`, `iso-ai-sweep`) races AIs to the line with no battles at all. This PR changes nothing they score.
- **Winnable with battling, but not by battling alone.** 2★ is 17% of the line, less than the city's 3★. It can decide a close race (a player on 10★ holding two contested sites wins), and it can swing back: the loser of the next fight loses the ★.

The ending ledger shows a **"Contested sites held"** row only when it paid, so a game won without battling reads exactly as before. The ★ tooltip lists the row with its cap ("Contested sites held: 3 (2 pay) × 1★ = 2★ (max 2★)"). The toast says "Contested site held · +1★" or "Contested site lost · −1★".

## The map side: challenge costs and cooldowns

`challengeGold` 12, `declineGold` 9 and the 2-minute player cooldown are **unchanged**:
- The battle simulator plays battles, not economies, so it cannot price Gold against the other uses of Gold.
- #322 set those numbers from playtests a week ago.
- With the ★ capped at 2 and revocable, the most a challenge can buy is a 1★ swing plus site rights.

What changed on the map is **legibility**:
- A contested site wears **⚔** on its name tag, and the viewer's challenge clock while it runs ("⚔ Farm · 1:20").
- It gets a **minimap dot** in the standing winner's colour. Tapping the dot opens the site's card.
- The card says who won the last battle and when you can challenge next.

## Onboarding

- **How to Play: battles** (`src/iso/battle-howto.ts`) is five cards on the same projector as the starting tour: turns, mana, extra turns, abilities, and the limit and stakes.
- Every number on it is read from `BATTLE_RULES`, `BATTLE_ABILITIES` and `VICTORY.loop`, so a retune moves the page with it (the test checks this).
- It fits a phone: it uses the tour's mobile layout, and its figures are gems and ledger rows, not screenshots.
- It opens from three places: **❔ Help → "⚔ How battles work"**, **☰ → "How battles work"**, and the **?** on the battle screen.
- **First-battle hint:** three lines at the foot of the first battle's screen ever, with "Got it" and "How battles work". It is shown once (`localStorage` `hexmatch:battle-hint`). It never blocks the board: in multiplayer the turn clock is running.

## What the lead should check with `test:slow`

1. `tests/unit/battle-ai-sim.test.ts`, the #249 ladder. It spreads `BATTLE_RULES` with its own overrides (`turnLimit 30, damagePerGem 2, startHealth 24`), so it now also inherits the chain cap and the +10 second seat. Chairs alternate, so the second-seat bonus is symmetric. It should still pass: easy loses more than half vs greedy, hard wins more than half. This PR ran it once; the result is in the PR body.
2. `iso-l1d-race` and `iso-ai-sweep`: no battles are fought there. They should score exactly as on main. That is the "winnable without battling" half.
3. **A playtest (acceptance: "a new player understands their first battle"):** a first battle with the hint, then the page from the "?". This cannot be verified headless.

## Follow-ups (not in this PR)

1. **Rival cast heuristics for control spells** (`evalAbility` girders / frost). The rival under-plays them, which is why Dynamite and Repair lead the round robin (59 / 57%).
2. **The first seat.** The solo player always moves first, and the MP host always moves first. A seeded or defender-first `firstSeat` would let the +10 shrink. It needs a duel-wire field.
3. **Economy-level battle sims.** Put challenges into the race harness so challenge Gold and the cooldown can be priced against paving and upgrades.
4. The restore path clears `score.types / rungs / city / holds` but not `routes / levels` (pre-existing; a restored game may briefly re-award those).
