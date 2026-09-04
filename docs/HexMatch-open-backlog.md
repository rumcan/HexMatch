The requested backlog tickets have been categorised and drafted for implementation.

Controls & Input

TK-001: Update Map Panning Controls

Description: Rebind map panning to the middle mouse button.

Acceptance Criteria: Left-click must be restricted entirely to building actions to prevent accidental placements; middle-click exclusively handles camera panning.

Building & Infrastructure

TK-002: Overhaul Rail Building Logic

Description: Separate rails from the road upgrade path to make them a standalone infrastructure type.

Acceptance Criteria: Rails must function as an independent, expansive transport network rather than an upgrade to roads. Allow rails to cross over roads. Fix the current bug where rails default to the incorrect orientation when placed.

Art & Assets

TK-003: Update Industry and Factory Sprites

Description: Replace existing industry sprites with better-matching alternatives from the TTD asset pool.

Acceptance Criteria: Change the factory building to a larger, more realistic small factory sprite. Replace the 'harvester' sprite with an asset resembling a bus or train terminal.

Animation & Rendering

TK-004: Investigate Vehicle Animations

Description: Research the technical effort required to implement moving vehicles.

Acceptance Criteria: Provide a feasibility report on adding animated buses that move back and forth along the established road networks.

Map Generation & World Rules

TK-005: Expand Map Generation Parameters

Description: Adjust map generation to include towns, larger dimensions, and strict resource limits.

Acceptance Criteria: Increase the base map size. Generate a small number of towns across the map. Cap resource generation to a maximum of two nodes per resource type.

TK-006: Restrict Initial Factory Placement

Description: Enforce location constraints for the player's first building.

Acceptance Criteria: The player must be forced to build their initial factory strictly within the radius of a town or city.

Gameplay & Match-3 Mechanics

TK-007: Overhaul Match-3 "Quarry" Mechanics

Description: Rename the Match-3 interface and tie gem spawning to the physical transport network.

Acceptance Criteria: Rename the interface from "Quarry" to "Processing Plant". Fix the bug causing bombs to spawn unintentionally over time. Resource numbers should only spawn on random gems in the match-3 table when a vehicle (bus/train) physically arrives at the plant, requiring the player to process them manually.

TK-008: Automate Rival Sabotage

Description: Streamline the black market mechanics for single-rival gameplay.

Acceptance Criteria: Automatically apply any purchased or acquired black market sabotage effects directly to the rival, bypassing any manual targeting steps.