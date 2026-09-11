# Ticket pack: Processing Plants, Depots and resource economy
Terminology: The Factory is the physical processing site. Its match-3 interface is the Processing Plant. A Depot collects resources from nearby nodes and supplies a Factory through the transport network.

PP-01 — Rename Quarry and Harvester in the UI
Status: DONE
Type: UI / terminology

Requirements
Rename the match-3 Quarry interface to Processing Plant.
Rename Harvester / Harvesters to Depot / Depots.
Update buttons, headings, tooltips, placement instructions, inspectors, notifications and accessibility labels.
Explain the gameplay loop clearly:
Resource node → Depot → transport network → Factory → processing → resources available for construction.

Acceptance criteria
No player-facing references to “Harvester” remain.
The match-3 interface is consistently called “Processing Plant.”
Stone-producing quarry resource nodes keep their existing name; this is not a global replacement of every occurrence of “quarry.”
These renames alone do not change gameplay, building footprints or saved-game compatibility.

PP-02 — Require Factory placement next to a town
Type: Gameplay rule

Requirements
Starting Factories and additional processing sites must be built next to a town.
Define “next to” consistently: at least one tile of the Factory’s footprint must share an edge with a town tile. Diagonal-only contact does not qualify.
The entire Factory footprint must remain on legal ground without overlapping the town or another building.
Apply the same rule to human players and the AI.

Acceptance criteria
Placement away from a town is rejected with a clear explanation.
The preview and actual placement use identical rules.
The AI cannot bypass town adjacency through a fallback placement.
Generated maps provide enough valid starting sites for all players.
Starting resources and transport allowances allow a town-adjacent Factory to establish its first working Depot connection without becoming stuck.

PP-03 — Clearly distinguish building footprint from reach
Type: UI / placement feedback

Requirements
Show two clearly different overlays while placing Factories and Depots:

Building footprint: a strong outline or solid translucent fill showing exactly which tiles the building occupies.
Reach: a lighter overlay showing the building’s actual collection or connection area.
For each building:

Factory: show its 2×2 footprint, qualifying town and town-adjacency area. Do not suggest that it harvests surrounding resource nodes.
Depot: show its 1×1 footprint separately from its resource catchment.

Acceptance criteria
Players can immediately distinguish placement tiles from reach tiles.
Resource nodes within a Depot’s catchment are visibly identified.
Invalid placement has a distinct appearance and a readable reason.
Overlays use the same footprint and reach calculations as gameplay.
The preview matches the final placement at every zoom level, using both mouse and touch.

PP-04 — Award manufactured resources without requiring a matching Depot
Type: Bug fix / processing rule
Priority: High

Reproduction
Have no Depot supplying Oil.
Match four Oil gems in the Processing Plant.
A numbered Oil token is created.
Clear that token.
Currently, the player receives no Oil.

Required behaviour
A numbered resource legitimately created in the Processing Plant must award its resource when cleared—even when the player has no Depot supplying that resource.

Special matches therefore provide a way to manufacture resources that the player cannot currently harvest.

Acceptance criteria
Clearing a tier-1 token in an ordinary match awards its base resource amount.
Existing tier and match bonuses still apply correctly.
Payout works for every resource type, including Oil.
Each token pays exactly once, including when cleared through special effects or cascades.
Reach refreshes or route disconnections do not erase already-created numbered output.
Inventory changes, gain notifications and displayed amounts agree.
Ordinary, unnumbered matches do not suddenly award resources.
Important distinction: Depots and transport connections still control the arrival of new delivered inputs. They must not block collection of output already created on the processing board.

Update tests that currently treat every disconnected-resource payout as invalid.

PP-05 — Require Oil when building additional Depots
Type: Economy / construction costs

Requirements
Every paid, newly built Depot must require Oil alongside its other construction materials.
Show the complete cost before placement.
Apply the same cost to player actions, AI decisions and multiplayer validation.

Acceptance criteria
A player with sufficient other materials but insufficient Oil cannot build a paid Depot.
Failed placement consumes nothing.
Successful placement deducts the complete cost exactly once.
Oil obtained through Processing Plant matches is valid construction stock.
The opening cannot become impossible because Oil production itself requires a Depot.
Proposed setup exception: Keep the first setup Depot free; require Oil for every subsequent Depot.

Dependency: PP-04 must work before this cost change is enabled.

PP-06 — Allow additional processing plants at other towns
Type: Gameplay expansion

Requirements
After setup, players can spend resources to build additional Factory/processing-plant sites near other towns.
These are additional instances of the same processing-site building, not a separate building type with conflicting rules.
Each site must have ownership, a town association and a valid footprint.
Each site acts as a delivery destination for the player’s connected Depots.
Processed resources contribute to the player’s construction inventory.

Acceptance criteria
Additional plants obey the same town-adjacency rule as the starting Factory.
Costs are previewed and charged exactly once.
Routing, processing, scoring and AI no longer assume that a player has only one Factory.
Connecting a Depot to multiple plants cannot duplicate its production or repeatedly award the same VP.
Selecting or switching plants cannot reset progress or reroll a board for free.
Save/load and multiplayer preserve all plants and their state.
Design decision to lock before implementation: Does each plant have its own persistent processing board, or do all plants share one board? Define input allocation and sabotage targeting alongside that decision.

PP-07 — Rebalance construction and expansion using Catan-style resource roles
Type: Economy / balancing

Goal
Make resource combinations drive meaningful choices:

Wood and Stone: basic infrastructure.
Grain: workforce and expansion.
Ore: industrial investment and better transport.
Oil: Depot expansion.
Gold: Black Market sabotage only.

Suggested first playtest costs
These are starting proposals, not final balanced values.

Purchase  Proposed cost
Road tile 1 Wood + 1 Stone
Rail tile 1 Wood + 1 Stone + 4 Ore
Upgrade Road to Rail  4 Ore
Additional Depot  1 Wood + 1 Stone + 1 Grain + 1 Oil
Additional Processing Plant 2 Wood + 2 Stone + 2 Grain + 3 Ore

Acceptance criteria
Every normal resource has a useful construction role.
All costs come from one authoritative table used by the UI, gameplay and AI.
Starting stock and free transport are retuned if necessary for the new prices.
Test opening progression and expansion on the actual 144×144 map, not just short synthetic routes.
Players can manufacture a missing resource without entering an endless dependency loop.
Record time to first connection, second Depot and second processing plant during playtesting.
Tune costs and processing yields together; do not assume the proposed numbers are balanced without testing.

PP-08 — Reserve Gold exclusively for Black Market sabotage
Type: Economy rule

Requirements
Gold is used only to purchase Black Market actions that sabotage opponents.
Remove Gold from ordinary construction, Depot costs, processing plants, transport, upgrades and repairs.
Gold cannot substitute for missing construction materials.
Ordinary market exchanges must not turn Gold into a general-purpose construction currency.
Audit existing non-sabotage Gold purchases, including security/defensive actions, and reprice them without Gold.

Acceptance criteria
Every normal construction action can be completed without Gold.
Black Market sabotage displays and deducts its Gold cost correctly.
Insufficient Gold prevents sabotage without consuming other resources.
Gold earned through processing or bonuses reaches the Gold balance.
UI copy clearly explains: “Gold is reserved for Black Market sabotage.”
Player, AI and multiplayer rules enforce the same restriction.

PP-09 — Enable Gold Gem Spawning
Status: DONE
Type: Bug fix / processing rule

Requirements
Gold gems must be added to the Processing Plant board and start spawning like other resource types the moment a Depot is built adjacent to a Gold Mine.

Acceptance criteria
Building a Depot next to a Gold Mine immediately triggers Gold gems to begin dropping in the match-3 interface.

PP-10 — Add Simple Roads to Towns
Type: Feature / map generation

Requirements
Generate simple roads within or connecting to towns to improve structural layout and visual connectivity.

Acceptance criteria
Towns successfully generate and display a basic internal road network upon creation.

PP-11 — Integrate New Isometric Assets
Type: Art / Asset replacement

Requirements
Review the new images in the `assets\iso-ttd` folder (including town buildings like those in `image_00c1ad.png`) and update the game assets accordingly:
1. Replace existing resource nodes with the new images, matching them by name.
2. Replace generic Depots with resource-specific buildings (e.g., place a lumbermill at a forest instead of a standard Depot).
3. Replace the Factory/Processing Plant with one of the new factory images. The new image must dictate the number of tiles the Factory occupies.
4. Use the remaining unused building images to generate towns.

Acceptance criteria
All resource nodes use the updated `iso-ttd` art.
Depot art dynamically changes based on the resource it is harvesting (lumbermill for wood, etc.).
Factory footprint matches the tile dimensions of its new sprite.
Towns are visually populated using the remaining building assets.

VP-01 — Victory Points from Paving, and a Better AI Opponent
Status: DONE
Type: Victory-rule change / AI

Requirements
Give win points for the roads you upgrade from dirt to paved.
Dirt roads do not give win points.
A Road built on ground that was never your dirt does not give win points either: the point is for the upgrade.
Each upgraded road tile is worth 0.25 VP — every four upgrades is one point (settled down from the proposed 0.5, which ended games too quickly).
Building a processing plant gives 1 VP; only plants raised after the free opening Factory count.
Demolishing a paved tile or a plant takes its point back.
First to 10 VP wins.
Full AI upgrade: the rival plays the new victory condition — it paves for points, values industries by VP per Ore, plans ore → pave → plant, stops wasting turns, banks toward the milestone it cannot yet afford, and reacts to the player's lead.

Acceptance criteria
A Dirt Road connection scores nothing; a paved tile scores 0.25 VP exactly once.
A Road laid on virgin ground scores nothing, at the full Road price — paving is the cheaper, scoring path.
Provenance survives save/load: a rejoined player sees the same score, because the upgrade bit travels on the tile (snapshot v9).
Demolition revokes the point; paving the same tile twice cannot farm it.
Points are owner-scoped: public highways and a rival's paving never land on your total.
The scoreboard is derived from the board, so it can never drift from it.
The AI scores by paving within the opening minutes and a full game between two AI-driven seats ends inside a session (see docs/playtest-reports/2026-09-10-vp01-vp-race.md).
`rivalPace` is a pure read of the two scoreboard totals: a seat a plant behind sprints (4 bank exchanges a turn instead of 2, Ore-bearing ground weighted 1.5x in the depot planner, and the pave goal itself deliberately unchanged), a seat ahead keeps compounding income, and a leader one point from winning is denied with the rival's last Gold instead of its reserve.
The rival never pays for a sabotage card it cannot aim (the raid's purchase list is the three cards it can land on your plant).
The UI explains the rule: tool labels, mode bar, inspector, banners and help all price the pave.
Player, AI and multiplayer rules enforce the same restriction (no AI-only scoring path).

AI-01 — Rival difficulty presets: easy, normal and hard
Status: DONE
Type: AI / balance

Requirements
Give the AI rival three difficulty levels — easy, normal and hard — selectable in game.
Two AIs must be able to play each other, and the speed at which they reach the win points (10★) is the measure of how hard the rival is: harder preset finishes sooner.
The rival uses the market every so often to attempt a trade.
The rival must not be passive: it uses the main roads (town ring roads, public highways) and it expands.

Acceptance criteria
Difficulty is pacing and budget only: every preset runs the same turn policy and the same costs — no cheats.
Three presets (easy / normal / hard) ship; the difficulty is chosen from the top bar, live and mid-game, persists between sessions, and can be pinned per match with ?rival=easy|normal|hard (mirrors ?seed=).
The calibration harness races two AI seats head-to-head on the same map with per-seat clocks and budgets; the ladder assertion is winner-time-to-10★ on mirror matches (hard < normal < easy), and head-to-head pairings run in both seat orientations with results pooled.
Easy and hard both finish mirrors inside the harness window; the loser of a mirror is never parked (proportional pace floor).
The easy rival still expands (depots, paving, offers) and never touches sabotage (no raids, no blockades); hard expands two plans a turn, paves 12 tiles a pass, banks harder, offers more often, raids on its own clock.
See docs/playtest-reports/2026-09-10-ai-skills.md for the measured ladder and the two economy failures (bank churn, plant-rush stall) the harness caught in the shipped rival's own turn.

AI-02 — The live opponent that parked itself, faster trucks on road, and a real race length
Status: DONE
Type: AI / UX / balance

Requirements
The player watched a long live session and reported five faults:

1. "The rival has one factory and one road and one depot and it is just upgrading it" — no expansion, and "if I do nothing, the AI does nothing".
2. "It is not playing the match game to gain gold and using the black market on me" — zero raids in a long session.
3. Trucks should be 2× as fast on the open (paved) road as on dirt, to motivate upgrading lanes.
4. "Increase win points to 20. 10 is way too little."
5. "Make the player select the difficulty at the start of the game."

Diagnosis (headless live-game repro, seed 1337, 25 sim minutes)
The rival opened, paved 2 of its 3 tiles, then sat at 0.5★ for the whole horizon
while Wood piled up at +32/min and every other purse entry stayed frozen. The
deadlock was three guards agreeing on the wrong number: the pave pass refuses
to spend Ore under the 1★-Plant reserve (`keepOre`), while every afford check —
`paveMilestone`'s gap, `rivalBankTowardPlan`'s loop, `rivalBankTowardPave`'s
trigger — asked the RAW purse, saw "enough Ore", and never traded. The sim
never reproduced it because its lane happened to earn Stone; live, on a lane
with none, it was permanent. N.B. this is independent of `aiTick` running on
the frame clock — the rival was thinking fine, it was mis-reading its own wallet.
The raids were structurally impossible, too: lorry deliveries fed only the
player's board ("the rival's lorries feed no board"), so the rival had zero
Gold income, and `rivalRaid` opens with "no Gold, no raid".

Changes
Pave goals are now priced against SPENDABLE Ore (purse minus the plant reserve)
in all three spots, so a stuck seat banks into Ore, paves out of the hole, and
reaches for its next depot plan (seed-1337 live repro afterwards: 4 depots and
19 paves inside 6 minutes, 10★ by minute 11 against an idle player).
Every lorry delivery now pays its OWNING seat: the player's loads still feed
the board; a rival load credits the rival +1 per cargo and +1 Gold — the
abstract match-3 income that primes the raid pool and feeds the market sales.
Trucks integrate per route SEGMENT: paved segments run at 2× (dirt 300ms/tile,
road 150ms), recomputed on every replan, so paving visibly shortens round trips
for both seats.
`VICTORY.target` 10 → 20; the single source means the HUD/help/banners follow;
the ship-constants tests were re-numbered.
A start-of-game difficulty prompt (easy/normal/hard cards with pace/blurb)
shows exactly when nothing has chosen yet: `?rival=` or a stored choice skips
it; the pick flips the live game, persists, and syncs the top-bar selector.

Acceptance criteria
Live headless regression (seed 1337, six in-game minutes, driven at the game's
own clocks): ≥4 rival depots, ≥12 paves, no 300+ Wood hoard — parked rival was
1 depot / 3 tiles / 0.5★ forever before the fix.
Trucks: per-segment 2× pinned (paved trip = half the dirt time; mixed route
pays per segment; plans stamp paved segments on replan; legacy trucks without
seg data keep the old uniform pace).
VP line: `VICTORY.target === 20`; win-check, HUD, help modal and banner all
derive from it.
Difficulty prompt: asks only when no explicit choice exists, URL/store junk
does not silence it, pick persists + applies live; top-bar selector keeps its
mid-game role.
Ladder re-measured at the 20★ line — see docs/playtest-reports/2026-09-10-ai-02-report.md.

