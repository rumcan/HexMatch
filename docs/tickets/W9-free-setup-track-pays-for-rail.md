# W9 — Free setup track pays for rail, bypassing the ore gate

**Status:** FIXED — 2026-09-05, on `arena/01a0717e-hexmatch`, using **option
(a)** (the allowance covers road only). See [Resolution](#resolution-2026-09-05).
**Filed:** OPEN — found by the Priority-1 play-test, 2026-09-05.
**Severity:** LOW / balance. No crash, no broken loop; it defeats a documented
design decision (E8: *"start with stone for roads, no ore — rail is gated
behind an ore mine"*).
**Area:** `src/iso/track.ts` (`previewDrag` free-allowance branch),
`src/iso/config.ts` (`UPGRADE_COST`).

---

## What a player sees

Start a game. The purse is `{ stone: 12, ore: 0 }` and rail costs
`{ ore: 4, stone: 1 }` (`{ ore: 4 }` to upgrade an existing road). Drag the
**rail** tool along the first connected line anyway: it builds, the ore cost is
never charged, and the connection jumps straight to rail VP (3 VP/tile instead
of 1) and rail throughput (×1.6 instead of ×1.0) — all before the player owns
an ore mine.

Observed in a real DOM run of the built app:

```
rail laid over the road line upgrades the connection (road 1 VP → rail 3 VP)
  — rail tiles=5/5  vp 1 → 3
INFO: the free setup allowance also pays for rail (no ore charged)
  — ore 1 → 1,  free 7 → 2
```

## Root cause

`previewDrag` applies the free allowance to **any** tile with a non-empty cost,
without regard to which transport kind or which resource:

```ts
// src/iso/track.ts:346
if (freeLeft > 0) { freeLeft--; tiles.push([x, y]); growing?.add(tIdx(x, y)); continue; }
```

The allowance is consumed before `canAfford` is ever consulted, so the first
`FREE_SETUP_TRACK` (12) tiles of *any* build are free — road or rail, stone or
ore. `commitDrag` then spends exactly `preview.cost`, which is `{}`, so the
purse is never touched.

The same branch governs the human drag, and `planCandidates` mirrors it for the
AI (W3's "same cost model as the player"), so the rival gets free rail too —
when it is not deadlocked by W8.

## Acceptance

Pick one and document it in `src/iso/config.ts` next to `FREE_SETUP_TRACK`:

- **(a) Preferred:** the free allowance covers **road only**. A rail tile —
  new or an upgrade — always pays `TRANSPORT.rail.cost` / `UPGRADE_COST`. This
  keeps E8's gate ("rail is gated behind an ore mine") honest and makes ore the
  first real objective after the opening road.
- **(b)** The allowance covers any tile, but each free rail tile consumes more
  than one unit of the allowance (e.g. 4), so rail eats the budget faster than
  road instead of ignoring it.

Either way:

1. Unit test: with `free: 12, purse: { stone: 12, ore: 0 }`, a rail drag over
   buildable ground lays **0** rail tiles (option a) or ≤ 3 tiles (option b) —
   not the current 12.
2. Unit test: the same drag with `ore: 4` in the purse still lays rail and
   debits exactly 4 ore per tile.
3. `tests/unit/iso-game.test.ts` "W4 a normal session earns the rail" still
   passes, or is updated with the new numbers and the reason recorded here.
4. 333 unit tests pass; typecheck clean.

## Out of scope

- Do NOT change rail's cost, VP or throughput — only what the free allowance
  is allowed to buy.
- W8 (rival never builds) is a separate ticket; fix it first, because W9's
  numbers are easiest to observe on a rival that actually builds.

---

## Resolution (2026-09-05)

**Option (a) implemented:** the free setup allowance buys **road only**. A rail
tile — new, or an in-place upgrade of a road — always pays
`TRANSPORT.rail.cost` (`{ ore: 4, stone: 1 }`) or `UPGRADE_COST` (`{ ore: 4 }`).
E8's gate is honest again: the opening 12 tiles buy the first road, and ore is
the first real objective after it. Rail's cost, VP and throughput are untouched.

### What changed

| file | change |
|------|--------|
| `src/iso/track.ts` | new `freeAllowanceCovers(kind)` — the single place the rule lives; `previewDrag` derives its allowance from it, so a rail drag starts with 0 free tiles and reports `free: 0` |
| `src/iso/ai.ts` | `planCandidates` and `executeCandidate` price with the same function (W3's "same cost model as the player"): the rival gets no free rail, and a rail build consumes **0** allowance so it keeps its road budget |
| `src/iso/config.ts` | the decision documented next to `UPGRADE_COST` / `TRANSPORT.rail`, as the ticket asked. (`FREE_SETUP_TRACK` itself lives in `game.ts` with the rest of the E8 tuning surface — it is documented there too, and both comments point at `freeAllowanceCovers` as the implementation.) |
| `src/iso/game.ts` | doc comment on `FREE_SETUP_TRACK`; and the empty-preview toast now says *"Rail costs ore — free setup tiles only cover road."* instead of the misleading *"Track must extend your network."* |
| `tests/unit/iso-track.test.ts` | +6 — the acceptance cases at the `previewDrag`/`commitDrag` level |
| `tests/unit/iso-ai.test.ts` | +3 — the rival shares the rule, and a rail build burns no allowance |
| `tests/unit/iso-game.test.ts` | +1 — the same three beats through the real game hook (`dragBuild`) |

### Acceptance

1. ✅ With `free: 12, purse: { stone: 12, ore: 0 }`, a rail drag over
   buildable ground lays **0** tiles (was 12), charges nothing, consumes no
   allowance, and marks all 12 tiles `unaffordable` (drawn red, not built).
   Same for an in-place road→rail upgrade drag.
2. ✅ With ore in the purse the same drag lays rail and debits exactly
   `TRANSPORT.rail.cost` per new tile (`{ stone: 12, ore: 4 }` → 1 tile) and
   exactly `UPGRADE_COST.ore = 4` per upgraded tile (`{ stone: 12, ore: 8 }` →
   2 tiles, `cost { ore: 8 }`).
3. ✅ `tests/unit/iso-game.test.ts` "W4 a normal session earns the rail" passes
   **unchanged** — its rail drag is an in-place upgrade paid for with the ore
   the session harvested, which is exactly what option (a) keeps working. No
   numbers needed updating.
4. ✅ **362 unit tests pass** (352 before this ticket, 333 on `main`);
   `npm run typecheck` clean; `npm run lint` 0 errors, no new warnings.

### Verified the tests actually bite

Reverting the one-line rule (`freeAllowanceCovers` → always true, i.e. the
pre-fix behaviour) fails **8** of the new tests across all three files, and
restoring it makes them pass again. So the suite pins the behaviour rather than
just describing it.

### Knock-on, intended

The rival now builds **road** out of setup instead of riding free rail (it was
getting the same bug through W3's shared cost model). Combined with W8 it
builds at all now, and it reaches rail the same way the player does — by
connecting an ore mine and earning ore. Rail VP (3/tile) and throughput (×1.6)
are unchanged, so the scoring split still matters; it just costs what the spec
says it costs.

### Not covered

No browser in the sandbox, so `npm run test:e2e` was not run. The playwright
suite drags road only (its rail assertions are about the tool bar), and the
banner/toast copy it asserts is unchanged.
