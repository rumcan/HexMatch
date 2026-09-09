# Economy UI and factory routing

## Plan
1. Disable unaffordable actions using native button semantics and grayscale styling; read authoritative costs and live resources. Preserve free depot/track allowances and action-side validation.
2. Change only the Demolish sublabel to `Refund 50%`.
3. Consolidate Bank, Market, Processing Plant and Feed into a single window. Keep the board mounted, move Black Market below Bank, retain plant construction, and use one mobile Economy navigation entry.
4. Resolve road deliveries by shortest usable network route, then let existing plant-placement/network invalidation replan all trucks.
5. Cover UI transitions and routing regressions; typecheck, lint, build and test before PR.

## Questions reviewed and decisions
- **Distance metric?** Usable road path length, not geometric proximity. Shared BFS respects public/owned roads and mutual connection bits.
- **Rail and ownership?** Preserve rail priority and restrict destinations to the depot owner's factories.
- **Equal distances?** First factory in the existing stable order wins; switch only for a strictly shorter route.
- **Disconnected new plant?** Does not attract trucks. Removing a destination returns trucks to the best remaining connected plant.
- **Truck continuity?** Retain existing network-change behavior: routes restart at their depots and delivery counters reset. No new mid-route transfer mechanic.
- **What is removed?** Standalone board/market launchers, not the Processing Plant construction tool.
- **Refund scope?** Label only, as requested for planned behaviour; existing demolition accounting is unchanged.
- **Hidden tab state?** DOM and game logic remain mounted; bank, offers, feed and board retain state and continue receiving updates.
- **Disabled actions?** Native disabled prevents keyboard and pointer activation. Resource and form changes update availability; underlying affordability guards remain authoritative.

## Validation
- Full Vitest suite: 39 files, 635 tests passed.
- Typecheck passed; ESLint passed with existing warnings and no errors.
- Production build passed (also invoked by Playwright).
- Added browser regression across configured desktop/mobile sizes. Local execution blocked: Chromium is absent and Playwright's browser download failed with ECONNRESET. Browser assertions must still run in CI/an environment with Chromium.
