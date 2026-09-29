---
name: hexmatch-lead
description: Run a HexMatch ticket or epic as the lead. I plan, brief Sonnet `hexmatch-coder` agents that write the code, then review, commit, open PRs and merge myself. Use when the owner says "run epic #N", "have the agents do #N", or /hexmatch-lead <issue>.
---

# HexMatch lead loop

You are the **lead** (Opus). You plan, review, commit and merge. **`hexmatch-coder`** agents (Sonnet 5.5, medium effort; see `.claude/agents/hexmatch-coder.md`) write the code. You don't write feature code yourself, except small review fixes.

Argument: an issue or epic number (e.g. `594`).

## 1. Plan
- `gh issue view <n>`, plus every child ticket and every issue they mention.
- Grep the code the work will touch, to find the real files, helpers and hooks (`src/iso/game.ts`, `rail.ts`, `economy`, `net`, the `__iso` test twins). A good brief names them, so the agent doesn't burn tokens hunting.
- Order the tickets. Tickets whose file sets overlap (almost everything touches `game.ts`) run **one after another**, each off the freshly merged main. Only truly disjoint work runs in parallel. Two agents both editing `game.ts` means a merge conflict.
- Show the owner the plan (the order, what runs in parallel, any open design questions) in a few lines. Ask only about real game-design forks. Decide everything else yourself.

## 2. Brief, and reuse before you spawn
**Tokens: reuse coders, don't spawn fresh ones.** A new coder pays to learn the repo all over again. Keep a small standing crew, at most 2 at a time, each owning an area (e.g. a *road/truck* coder and a *rail/train* coder). Give each next ticket to whichever coder already knows those files, via `SendMessage` (its context is cached, so reuse is cheap). Spawn a new one only when no existing coder fits or one's context has become huge. Track the crew in the session: name, area, worktree path, current ticket.

To spawn, use `Agent({ subagent_type: "hexmatch-coder", isolation: "worktree", description, prompt })`. If that type isn't loaded (the session started outside HexMatch), use `general-purpose` + `model: "sonnet"` and have it read the rules file first. The agent runs in the background, and you get a notification when it finishes. The brief (prompt) holds:
- **the spec itself, pasted in and trimmed to what this agent needs.** The coder never reads issues, because the issue bodies carry long arena prompts;
- the ticket number, and the scope for THIS agent, sliced down if the ticket is big;
- the files and functions to start from, and the existing helpers to reuse;
- the acceptance points, written so they can be checked;
- the targeted test files to run, plus the new test file to add;
- the known failures on main that are relevant (`docs/known-test-failures.md` plus the handover memory);
- any decisions you already made, so the agent doesn't re-decide them.

## 3. Review (every agent result)
- Read the report, then read the **diff** in the agent's worktree (the result gives the path and branch). Don't trust the report alone.
- Run `npm run typecheck` (it covers the e2e specs, as CI does) and the targeted tests yourself.
- For UI or feel changes, play-test in the browser pane. Add a `.claude/launch.json` entry that runs `npm --prefix <worktree> run dev -- --port 51xx --strictPort`, and drive the game with the `__iso` twins (`placeFactory`, `finishSetup`, `setSeatMoney`, `placePlatform`, `lookAt`, `tileScreenAt`, …).
- Small problems: fix them yourself. Real rework: `SendMessage` the same agent (it keeps its context) with specific points. Never start a fresh agent for a rework.

## 4. Ship
- In the worktree: create the branch `fleet/<n>-<slug>` (or `<area>/<n>-<slug>`), commit with the ticket ID in the title, push, and run `gh pr create` with "Closes #<n>" and the test evidence.
- Once CI is green (or the only failures are known and already on main), squash-merge with `--delete-branch`, then `git pull --ff-only` in `C:\Work Admin\PERSONAL\Repos\HexMatch`.
- **Recycle the worktree; don't remove it.** Once the PR is merged, run `git -C <worktree> fetch -q && git -C <worktree> checkout -q -B <next-branch> origin/main` so the same coder starts its next ticket on fresh main. Remove worktrees only at the end of the epic, or when you retire a coder.
- Move to the next ticket. At the end of the epic, run the broad sweep (`npm test`, the e2e desktop project) and fix what broke.

## Rules carried over
- The owner's art and audio never go through agents.
- Post-merge bugs → a new small brief to a fresh coder, not the old PR.
- Keep the owner posted with one line per milestone (ticket spawned, PR merged), not play-by-play.
