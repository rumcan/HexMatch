# #119 triage — RUN.world shell console errors

**Date:** 2026-09-13 · **Ticket:** #119 (investigation-only) · **Base:** main `57f1fa9`, branch `arena/01a09abe-hexmatch`

## Where these errors come from

The game runs inside RUN.world's H5 shell. The SDK we ship
(`@series-inc/rundot-game-sdk`) carries the shell's own bootstrap —
`dist/chunk-4J2RDAOR.js` embeds a **"RUN.world Embedded Libraries WebView
Shim"** that is "injected into H5 game WebViews BEFORE the game's main script
runs" (verbatim from the shipped source). Most of the console noise in a
RUN.world playtest therefore originates above our document: the shell's iframe
bridge, its quest service client, and its API wrapper. None of it is controllable
from this repo, and per the ticket **none of it may be worked around by
disabling CSP/iframe safeguards or by capturing tokens** — nothing below does.

## Error-by-error classification

| # | Console error | Attribution | Evidence | Action |
|---|---------------|-------------|----------|--------|
| 1 | `H5MessageBus` iframe errors (postMessage/`message` channel) | **Platform shell.** The shim's iframe bridge wires the game WebView to the host page. | SDK dist chunk ships the shim + bus; no repo reference to `H5MessageBus` outside `node_modules` | None. Log-only noise from the host frame. A follow-up could ask RUN to downgrade its own logging level. |
| 2 | Quests `401` | **Platform shell.** The shell's quest/missions client calls RUN's quest API; a game with no quest integration (ours) gets 401. | SDK dist carries the auth/quest error catalogue (`auth/too-many-requests`, …); our code never calls a quest endpoint (`grep -r quests src/` → 0 hits) | None. Optionally register quest hooks with RUN if/when the platform ticket asks for it. |
| 3 | `manifest.json` `404` | **Ours (two candidates), both self-healing.** (a) `assets/buildings/manifest.json` is fetched at runtime by `loadBuildingLayers()` (`src/iso/atlas.ts:325`); under `vite build` it is shipped by the `copyBuildingLayers` plugin (`vite.config.ts:44-70`), so a 404 here means an old deploy predating the plugin — per-building art silently falls back to the shared sheet, game stays playable. (b) the shell's own webmanifest — `index.html` declares no `<link rel="manifest">`, so a manifest 404 for the *document* is the host frame's. | atlas fetch is wrapped: `try { res = await fetch(...) } catch { return 0 }` + `if (!res.ok) return 0` | Verify on the next live pass which URL 404s (Network tab, status + initiator). If (a): redeploy — the build already ships the file. If (b): platform. |
| 4 | `No requestId` | **Platform SDK.** The SDK's API wrapper complains when a request leaves its instrumented fetch without its own request-id bookkeeping. | `requestId` machinery lives in the SDK dist chunks; no repo source mentions it | None. It is the SDK logging about the shell's own calls (or warning us if WE call SDK endpoints outside its wrapper — no such call exists: `transport.ts` is the only SDK importer and goes through `RundotGameAPI`). |
| 5 | `AudioContext was not allowed to start` (before gesture) | **Ours, one known residual path, benign.** The audio layer's discipline is correct by construction: `sfx.ts` checks `event.isTrusted` before `unlock()`, `unlock()` (`src/audio/engine.ts:188`) creates/resumes the context inside the gesture, and `prewarmHoly()` is wired to a real `pointerdown` on the board (`src/game/ui.ts:931`). The residual warning comes from `playHoly()` (`src/game/holy.ts:46`): the cross resolves "a beat after" the click, so its `ctx.resume()` runs in a `setTimeout` outside the gesture task — Chrome logs the warning once, the context starts on the next interaction, sound is never lost. | engine.ts rule 3 + holy.ts comment "cross resolves a beat AFTER the click" | None required for #119. If a later ticket wants the console fully clean: create the context inside the click handler and only *schedule* the choir, or `resume()` inside the event task and start the swell from there. |
| 6 | 373 report-only CSP violations | **Platform, advisory by design.** `report-only` means the policy is in monitoring mode — nothing is blocked, nothing is degraded. The violations come from the shell/SDK inline bootstrap and bridge. | SDK shim is exactly the kind of inline/injected code report-only CSP counts | None. Never "fix" by loosening CSP or iframe sandboxing (ticket guardrail). The count is the shell's signal to read, not ours to silence. |

## Summary

**6 error classes: 5 platform/shell-side, 1 ours-and-benign, 0 gameplay-affecting.**
The one URL that can 404 from our build (`assets/buildings/manifest.json`) is
shipped by the current build plugin and degrades to the sheet fallback by
design, so the only plausible repro is a stale deploy. No code change is
warranted from this ticket; the two candidate follow-ups (quest integration if
RUN asks for it; moving the choir's `resume()` inside the gesture task for a
fully quiet console) are recorded above and deliberately out of #119's scope.

## Verification steps for the next live playtest

1. DevTools → Network, filter `manifest` — record the 404ing URL and its
   initiator (document vs `atlas.ts` fetch). Expected under a current deploy:
   no buildings-manifest 404.
2. Console, filter `AudioContext` — the warning should appear at most once,
   coincident with a holy-cross resolution, never at boot.
3. Confirm `localStorage["hexmatch:audio"]` stays untouched by the shell and
   that no token/credential values appear in any logged payload (guardrail:
   no token capture was performed or needed for this triage).

## Guardrails honoured

- No CSP directive was loosened, removed, or worked around.
- No iframe sandbox attribute was touched.
- No token, cookie, or credential capture of any kind was done.
