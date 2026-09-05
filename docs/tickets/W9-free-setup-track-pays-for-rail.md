# W9 — Free setup track pays for rail, bypassing the ore gate

**Status:** OPEN — found by the Priority-1 play-test, 2026-09-05.
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
