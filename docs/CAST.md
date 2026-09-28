# CAST-1 — the Managers of Hexmatch Industries

Owner brief (2026-09-27): the two "Hextalls" become a roster of five managers
with names, stories, a perk and a quirk each, earned by play. The AI opponent
gets a face and a name: Cornelius Graves. The company is just
**Hexmatch Industries** — the "Hextall" surname is gone everywhere.

This file is the plan the PR was built from, and the reference for what each
manager does.

## The cast

| Manager | Title | Perk (player seat only) | Quirk | Unlock |
|---|---|---|---|---|
| **James Calloway** | The Road Man | Road Ways (dirt, street, road, highway, ramps, road bridges/overpasses) cost **25% less** | Rail Ways cost 10% more | Hired from the start |
| **Anne Whitmore** | The Rail Baroness | Rail Ways (rail track, platforms, train depots) cost **25% less** | Road Ways cost 10% more | Hired from the start |
| **Rafael Duarte** | The Fixer | **4 free Black Market sabotage cards** (Blockade or Protest) in every 5 minutes of play — a visible counter chip in the Black Market | Security Forces cost 50% more | Win 1 match |
| **Dolores Vance** | The Magnate | **Security Forces are free** | Black Market sabotage costs 10% more Gold | Win a match on Normal or Hard (or any multiplayer win) |
| **Kenji Arata** | The Prodigy | Tuning sessions score **+20%** (the yield and Gold a session settles to) | Level Ground costs 25% more | Win 3 matches, or win any Scenario |

**CAST-2 (#558) — the unlockables edge out the starters.** Rafael, Dolores and
Kenji were a touch weaker than the starting pair, so hiring one felt like no
reward. Each is now slightly better — the perk buffed or the quirk softened, one
lever each, kept modest and never past the starters' 25% ceiling: Rafael's
allowance is **4** free cards (was 3), Dolores pays **10%** more for sabotage
(was 20%), Kenji's tuning is **+20%** (was +10%). James and Anne are unchanged.
The perks stay player-seat only, so the BAL-1 gate and every AI test read the
AI rival's null seat and are untouched.

**The Rival — Cornelius Graves**, Chairman of Graves Consolidated. Not
playable. He is the face of the AI opponent in a sandbox or scenario match:
the rival's avatar in the top bar, the private wire (rival lines), battle
screens and the ending card. Story contracts keep their own cast.

### Stories (1949)

- **James Calloway** — Drove supply convoys across three countries in the war
  and came home certain the island only needed better roads. Bought a surplus
  army lorry in '46, graded his first mile by hand, and has not stopped since.
  *Quote:* "Build it first. Build it bigger. Then build the road to it."
- **Anne Whitmore** — A signalman's daughter who ran the wartime freight
  timetables for the whole northern line. When the railways went up for sale
  in '48 she bought the timetables first and the track second.
  *Quote:* "Anyone can lay track. I know when the train is due."
- **Rafael Duarte** — Ran cargo through three blockaded ports and never filed
  the same manifest twice. He is legitimate now — mostly — and every dock
  foreman on the island owes him a favour he has not called in yet.
  *Quote:* "Everything on this island has a price. I just know who's selling."
- **Dolores Vance** — Old mill money from the mainland, she came to the island
  to buy it quietly, one parcel at a time. The police chief dines at her table
  on Thursdays, and nobody touches a Vance depot.
  *Quote:* "I don't do business with trouble. I simply own its landlord."
- **Kenji Arata** — Top of his engineering class at twenty, he rebuilt a failing
  cannery's line with a slide rule and a stopwatch and tripled its output. To
  him every depot is a puzzle with a better answer.
  *Quote:* "There is always a faster line. I just haven't drawn it yet."
- **Cornelius Graves** — Owned the docks, the mines and half the magistrates
  before the war, and means to own them after it. Calls every newcomer "son",
  lights a cigar he never finishes, and has buried four rival firms without
  once raising his voice.

## Rules of the build

1. **Perks go through the existing price paths.** `src/iso/managers.ts` is the
   pure rulebook (ids, perk table, legacy mapping, unlock rules, the Fixer's
   refill window). `game.ts` asks it for a multiplier at the one seam each cost
   already passes through: `canPayBuild` / `spendBuild` / `chargeBuild` /
   `refundBuild` take a build class (`road` / `rail` / `level`), the drag
   previews get the seat's effective balance, the Black Market core
   (`buyBlackFor`, `placeProtest`, the guest intents) prices its cards through
   `blackMarketGold` / `securityCostFor`, and `settleSession` scores through
   `tuningScore`.
2. **Player seat only.** A seat's manager is `PlayerState.manager`. The AI
   rival's seat is `null` — no perk, no quirk — so the BAL-1 balance gate and
   every AI test are untouched. A game booted without a manager (every unit
   test that calls `startIsoGame` directly) is `null` too: no perks, today's
   numbers.
3. **Multiplayer.** The manager rides the existing seat record: `manager` is an
   additive-optional field on the wire/save player (like `money`, no version
   bump). The host sets its own seat from the start screen; the guest sends a
   `{ do: "manager" }` build intent (re-sent until the host's echo carries it);
   the host applies perks per seat, the guest prices its previews from the
   echoed record.
4. **Save compatibility.** `normalizeManager` maps the legacy portraits —
   `"vex"` → Anne, `"you"` → James — and anything unknown to the default.
   `hexmatch:menu-character` keeps storing the manager id ("james"/"anne" as
   before).
5. **Unlocks are earned by play only** (no RUN store, no Bits, no money).
   `hexmatch:managers` in localStorage holds wins / Normal+ wins / scenario
   wins and the sticky unlocked set. The ending card says **New manager
   unlocked!** when a win hires someone. The Starter Island tutorial does not
   count.
6. **Art.** `tools/cast/slice-avatars.py` (PIL + numpy) splits each 2×2 sheet
   into hero / ghost / bust / think by alpha islands (erode → seed → regrow),
   trims each to its own bbox, and writes `hero-*`, `ghost-*`, `bust-*`,
   `think-*`, `thumb-*` webp next to the existing poster art, plus
   `loading-poster(-portrait).webp`. Re-runnable; source sheets stay
   untracked in the lead clone's `assets/avatars/` and `assets/poster/`.

## UI

- **Main menu:** "The Hextalls" tab → **The Managers**: five cards (thumb,
  name, title, perk), locked ones greyed with the unlock condition.
- **Play screen roster:** five portraits in the sidebar (`01 / 05`), the hero
  fills the blue stage (cover). A locked manager can be previewed — the
  profile shows a lock plate with the condition — but you play as the last
  hired manager, named above the mode buttons.
- **Profile panel (Step 0 fix):** no scrollbars at any width — the name is
  clamped, the rank badge text wraps, overflow hidden. CAST-2 (#558) removed the
  HISTORY tab; the profile now foregrounds the perk and quirk (they take the
  space History used) with the name, title and quote, laid out to fit at
  1280×800 and at phone width with nothing clipped.
- **In game:** the top-bar `.king-av` shows the manager's thumb for the player
  and Cornelius for the rival; the Black Market shows the Fixer's chip and the
  perk-adjusted prices; the build buttons quote perk-adjusted prices.
- **Loading screen:** the landscape poster (portrait poster on a portrait
  viewport), cover-fit, the progress card over it; it stays up at least 3 s.
- Style: UIX rules — flat colours, no gradients, orange buttons, paper cards.

## Tests

`tests/unit/cast-managers.test.ts` — perk multipliers, the Fixer's 4-per-5-min
refill, free Security, the legacy portrait map, unlock rules and their
persistence. `tests/unit/iso-loading-screen.test.ts` — the 3 s floor (fake
timers). Existing menu / start-screen / story tests follow the new names.
