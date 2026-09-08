Ticket pack: Processing Plants, Depots and resource economy
Terminology: The Factory is the physical processing site. Its match-3 interface is the Processing Plant. A Depot collects resources from nearby nodes and supplies a Factory through the transport network.

PP-01 — Rename Quarry and Harvester in the UI
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

Purchase	Proposed cost
Road tile	1 Wood + 1 Stone
Rail tile	1 Wood + 1 Stone + 4 Ore
Upgrade Road to Rail	4 Ore
Additional Depot	1 Wood + 1 Stone + 1 Grain + 1 Oil
Additional Processing Plant	2 Wood + 2 Stone + 2 Grain + 3 Ore
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