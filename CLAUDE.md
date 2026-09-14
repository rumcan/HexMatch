# CLAUDE.md — same contract as AGENTS.md

This file exists because some agents look for `CLAUDE.md` instead of `AGENTS.md`.
The canonical contract is in `AGENTS.md` — read that file. The short version:

- `main` is green. Any failure on your branch is yours.
- Check a failure against `main` with `git worktree add ../main-check origin/main`.
- Never loosen an unrelated test. Quarantine with `it.skip` + linked issue + `docs/known-test-failures.md`.
- Fast path: `npm run typecheck && npm test && npx playwright test --project=desktop-chromium`.
- Slow path (AI/map/economy): add `npm run test:slow`.
- See `AGENTS.md` for the full testing contract and suite quirks.
