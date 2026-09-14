# CONTINUE-01 — Continue game, and a deliberate New game (#191)

## The complaint

There was no way to deliberately **start a new game** from the menus. Picking
**Play vs AI** — or reopening a contract — silently resumed the previous
match, because boot restored *any* save younger than seven days
(`loadRecentSave` in `src/iso/savegame-runtime.ts`), not a save the player had
asked to continue. The only escape was the in-game ☰ menu → **New Game**,
which you only find after you are already back in the old match.

## The model

Boot behaviour itself is unchanged — a refresh still resumes exactly where
the pagehide autosave left off, and multiplayer still never touches the save.
What changed is the **menus**: resuming and starting new are now two explicit
doors.

- `src/iso/save-summary.ts` is the read-only shelf both menus read from:
  `resumableSaves()` / `mostRecentSave()` / `saveForMode()` scan the sandbox
  slot (`hexmatch:save`) and every story slot
  (`hexmatch:save:story:<chapter>`), apply the boot's own seven-day freshness
  window, and re-derive the two ★ totals from the saved track layers
  (`rescore` — VP is derived state and is not in the payload). It never
  writes; the one write path is `discardSoloSave(chapterId)`, which clears the
  slot and — for the sandbox only — the remembered difficulty pick, matching
  the ☰ menu's New Game semantics.
- **Front menu** (`MainMenu.tsx`): when any resumable solo save exists a gold
  **Continue** door sits above Play, naming the freshest slot —
  `Continue — vs AI (Normal) · 7★ vs 5★ · saved 2 h ago`, or the contract
  name for a story slot. Play beneath it reads "start a new game". With no
  save, nothing changes: Play keeps the gold door.
- **Mode screen** (`StartScreen.tsx`): a resumable sandbox save promotes
  **Continue** to the gold door there too, and **Play vs AI** now means a NEW
  match — with a save present it raises the painted confirm plate (#121), and
  only confirming clears the slot before booting; cancel leaves everything.
- **Campaign list**: an open contract with a save becomes a **Continue card**
  (gold ribbon with score and age; clicking the card resumes, as a refresh
  would), with a sibling **↻ Start over** door that asks once, then clears
  just that contract's slot and boots the briefing. Sealed and fresh cards
  are unchanged.
- **Ending ledger**: "Continue the campaign" (story) now clears the decided
  contract's slot before returning to the campaign — the result is already
  recorded, and without the clear the card would keep offering Continue
  straight back into the ledger. `restartArmed` stops the teardown autosave
  rewriting the slot.

The in-game ☰ → **New Game** and the ledger's **Restart** flows are
untouched; they were already the explicit reset once inside a match.

## Tests

- `tests/unit/save-summary.test.ts` — the shelf: slot discovery, freshness
  window, ghost-contract slots, ★ re-derivation from the track, dossier text,
  and the sandbox-vs-contract clear semantics.
- `tests/unit/continue-game.test.ts` — the real React mode screen and
  campaign list: Continue resumes without clearing, Play-vs-AI and Start-over
  ask first, cancel keeps the slot, confirm clears (and the difficulty pick
  only for the sandbox).
- `tests/unit/main-menu.test.ts` — the front door's Continue/Play gold
  styling, dossier and callbacks.
- `tests/unit/iso-game.test.ts` — winning a contract and taking "Continue the
  campaign" removes its save slot.
- `tests/e2e/continue-game.spec.ts` — the full walk in a browser: quit →
  Continue resumes ("restored from your save"), the Play-vs-AI ask
  (cancel/confirm), and a contract's Start over into a fresh briefing.
