HexMatch — open backlog

Supersedes v10. Audited against main @ 6d23143 (PR #14 merged). This round is almost all gameplay logic, not sprites — the map looks close to right now, but the game underneath has several broken rules. Every item below was traced to a specific line, not inferred from the screenshots.

Standing principle: the UI is the original interface and the gameplay stays essentially what it was.

Work order: W1 → W2 → W3 → W4 → W5 → W6 → W7. W1–W4 are the "I can't actually play" bugs and come first.

W1. Building road puts you into negative stone — no affordability check at commit

[bug] [P0] [economy]

"I build a road and it fails, then I have minus stone." Confirmed in game.ts commitTrackDrag:

ts
const n = res.built.length;
const free = Math.min(p.freeTrack, n);
p.freeTrack -= free;
if (n > free) { let cost = …; spend(p, cost); }   // spend() just subtracts — no guard

spend() subtracts unconditionally: p.purse[k] = (p.purse[k] ?? 0) - v. There's no canAfford check at commit, so if the committed length costs more than you hold, your purse goes negative.

There's also a mismatch between preview and commit. previewDrag computes cost with tileCost (full price, no free-tile accounting) and truncates when you can't afford it — but commitTrackDrag applies the free allowance after, using different arithmetic. So the preview and the charge disagree, which is how a drag that "looked fine" charges you into the negative, and how a drag can "fail for no reason" (the preview truncated on full-price cost while you actually had free tiles).

Fix:

Make previewDrag and commitTrackDrag use the same cost model — apply the free-tile allowance inside the preview so what you see is what you're charged.
Guard spend() (or the commit) with canAfford; never allow a purse below zero. If a drag isn't fully affordable, build only the affordable prefix (the preview already computes unaffordable — commit exactly tiles, not more).

Acceptance: no purse value ever goes negative; the tiles charged equal the tiles previewed; a drag longer than you can afford builds the affordable prefix and charges exactly that.

W2. The rival uses your roads — track has no owner

[bug] [P0] [gameplay] [core]

"The rival doesn't build roads, uses my roads, has no roads connected to his factory." This is a real architectural gap, confirmed in track.ts:

Track is two Uint8Arrays of direction bits — road and rail — with no ownership. playerNetwork(track, owner, factories, harvesters) seeds from the owner's factory/harvesters, then floods over any track via hasTrack(...). Since track tiles aren't tagged by player, the flood runs over everyone's road indiscriminately. So:

The rival's network reaches industries over your road, with no road of its own — exactly what you see.
Toll-road revenue (a settled design point) can't work; there's no owner to charge.
Two players' networks are effectively one shared graph.

Fix — give track an owner.

Add a per-tile owner to the track model — either a third Uint8Array (0 = none, 1 = you, 2 = rival) parallel to the bit layers, or fold owner into the tile record.
buildTile / commitDrag stamp the builder's id.
playerNetwork's flood only traverses a neighbour tile if its owner matches (or is shared infrastructure you explicitly allow — e.g. a toll crossing).
Level crossings and shared junctions need a rule; simplest for v1 is "track is owned solely by its builder; no implicit sharing."

This also sets up the toll mechanic later (TRANSPORT/sabotage already reserve gold for it).

Acceptance: a player's network reaches an industry only over that player's own track; the rival must build its own road to connect; demolishing your road never disconnects the rival and vice-versa; a unit test builds two disjoint networks and asserts neither sees the other's tiles.

W3. The rival never builds — aiBuildStep result likely rejected or deadlocked

[bug] [P0] [ai]

"The rival doesn't build roads." aiTick calls aiBuildStep every AI_BUILD_MS and, on a result, spends and applies it. Two things to check, in order:

Does aiBuildStep ever return a build? It A*-paths from the AI's network and returns tiles to build. If W2's ownership change isn't in yet, the AI may "already be connected" over your road and therefore never decide to build. Fixing W2 likely un-sticks this — the AI will see it has no network of its own and start building. Check this first; W3 may partly resolve as a side effect.
Is the AI deadlocked on cost like the human (see W4)? The AI starts with the same START_PURSE of { stone: 12, ore: 0 }. If it wants rail it can't afford ore either. Make sure the AI falls back to road (its comment says it should: "build road if it cannot afford rail") and that road is actually reachable.

Also confirm the AI places harvesters and plays no quarry — by design it has no board, so its only income is the passive trickle (which J1 kept on only for the rival). Verify that trickle actually credits the rival's purse, or it can never afford anything after the free-setup tiles.

Acceptance: within a minute of play the rival has built road from its own factory and connected at least one industry; the rival's stone/ore change over time (it's earning and spending); a headless test runs N AI ticks and asserts the rival's track tile count increases.

W4. Rail is unbuildable — a bootstrap deadlock

[bug] [P0] [economy] [design]

"I can't build any railways." The numbers deadlock:

START_PURSE = { stone: 12, ore: 0 }.
Rail costs { ore: 4, stone: 1 } per tile.
Ore comes only from an ore mine.
To reach an ore mine you build road (which you can afford: 1 stone) — good.
But you get ore only once a harvester on an ore mine is connected and the quarry pays ore… and the quarry pays ore only if the network reaches an ore mine.

So rail is reachable in principle, but only after a full road-to-ore-mine-plus-harvester-plus-quarry-matching loop. If any link in that chain is broken (W1 negative stone, W2 shared network masking real connection, gold/coin bugs in W5), you never accumulate ore and rail stays grey forever. Part of this is downstream of W1–W3; part is tuning.

Fix:

First fix W1–W3; then verify ore can actually be earned and rail becomes buildable in a real session.
If rail is still unreachable in practice, this is the E8a tuning showing its teeth — ore: 4 per rail tile may be too steep given how slowly ore arrives. Consider a small starting ore stipend, or lowering rail's ore cost, so the first rail is reachable but still a real stockpiling decision. This is a playtest lever, not a fixed answer.

Acceptance: in a normal session a player can build road → connect an ore mine → harvest ore via matches → afford and build rail. If they can't, adjust the ore economy until they can, and document the numbers.

W5. Gold coins do nothing — board.onGold is never wired

[bug] [P0] [economy]

"Gold doesn't work. Even if I get a coin and match it I don't get coins." Confirmed in quarry.ts: it wires board.onHarvest, onPopup, onChange, onTokens — but never board.onGold. The board banks combos (COMBOS_PER_GOLD = 2) and calls onGold(n) when it grants a coin, but nothing is listening, so the coin is never added to your purse. game.ts has no onGold reference at all.

Gold matters because it's the sabotage/black-market currency (Blockade, Security, etc. all spend gold), so this also silently disables the entire Black Market.

Fix: in quarry.ts, wire board.onGold = (n) => hooks.onGold?.(n), and in game.ts implement that hook to earn(me, { gold: n }) and refresh the HUD. Confirm the combo→coin path (2 combos = 1 coin) actually reaches the purse.

Acceptance: banking 2 combos grants 1 gold in your purse; the gold chip increments; black-market actions become affordable once you have gold; a test asserts onGold credits the purse.

W6. The Market button does nothing — trading is dead

[bug] [P0] [ui] [economy]

"The market button does nothing, there's no trading between me and the rival." The restored ui.ts builds Market/Bank/Feed tabs and offer/bank handlers, but something between the tab and the trade isn't connected. Investigate in this order:

Does the Market panel toggle open at all? (V-series added data-panel toggles; confirm the Market button's click actually shows the panel — the toast/panel wiring in game.ts may not be hooked to the restored button.)
Do offers post? ui.ts calls market.post(...); confirm IsoMarket is instantiated and shared between the human and the rival.
Does the rival ever answer offers? The original design had the rival respond on a clock. Confirm there's an AI trade tick; if J1 only ported building AI and not trading AI, the rival will never trade — matching your report.

Fix: wire the Market button to open the panel; ensure one IsoMarket instance is shared; add (or restore) the rival's trade response so posted offers can be taken. Bank trades (4:1) should work even without the rival, so get those working first as the simplest end-to-end check.

Acceptance: clicking Market opens the trading panel; a bank trade (4:1) executes and changes the purse; a posted offer can be answered by the rival; the feed logs trades.

W7. Buildings are single-tile sprites (accepted for now)

[known] [assets]

"The factory is a 1-square cut of a larger factory; the others are one-square pictures but at least not broken." You've accepted these as good-enough, which is right — they read as coherent buildings now (the factory less so, being one piece of a multi-tile industry).

Deferred, not urgent. Two things to keep on the list for when the game plays correctly:

The factory specifically is one piece of a multi-tile OpenGFX industry; a single coherent factory/HQ sprite would read better (candidates were noted earlier: misc-industry buildings 2165/2167/2169). Low priority.
If you ever want the big sprawling industries from the reference art, that's the multi-tile composition route — a real project, only worth it if the map feels too sparse.

No action now. Listed so it isn't lost.

Sequencing

W1 → W2 → W3 → W4 → W5 → W6 → W7(defer).

W1 (negative stone) and W2 (shared network) are the foundation — W3 (AI builds) and W4 (rail reachable) partly resolve once those land, so do them in order and re-test after each. W5 (gold) and W6 (market) are independent and can go in either order. W7 is deferred.

Keep each to one session. W2 is the biggest — track ownership touches the model, the flood, commit, and demolish — so give it its own PR and lean on the two-disjoint-networks test as the guard.

Process note

This round is a useful signal: the sprite pipeline is basically fixed, and what's left is that the game rules were ported piecemeal and several wires were never connected — gold has no listener, track has no owner, the market button has no handler, affordability isn't checked at commit. These aren't hard problems; they're missing connections. A short integration checklist — every board.on* hook has a listener, every panel button has a handler, every spend path checks affordability, every player's network is its own — would catch this whole class in one pass. Worth adding as a boot-time assertion or a test that fails if any board.on* callback is still the default no-op.