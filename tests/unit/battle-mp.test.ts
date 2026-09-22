// ══════════════════════════════════════════════════════════════════════════
// B6 (#251) — multiplayer battles: the host's authority over the duel.
//
// The unit half of the acceptance block, pinned against `battle-mp.ts`:
//
//   • a guest cannot make an illegal move or act out of turn — the host
//     rejects it and NOTHING changes (board, log, turn);
//   • refreshing mid-battle rejoins the same battle state — the wire's full
//     save restores the exact continuation, and the seed + move log replays
//     to the same board the guest animates;
//   • the host's turn clock: a timed-out turn passes via a legal auto-play,
//     N in a row forfeit, and a disconnect pauses the clock until the grace
//     period hands the duel to the seat still there.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import {
  createDuel, applyPlayerMove, duelToWire, duelFromWire, duelClockTick,
  duelPresence, duelGraceTick, noteHumanMove,
  DISCONNECT_GRACE_MS, TIMEOUTS_BEFORE_FORFEIT, type Duel,
} from "../../src/game/battle-mp";
import { createBattle, type BattleMove } from "../../src/game/battle";
import { BATTLE_RULES } from "../../src/iso/config";
import { validateSnapshot, applySnapshot, buildSnapshot } from "../../src/iso/snapshot";
import { MAP_W, MAP_H } from "../../src/game/config";
import type { Track } from "../../src/iso/track";

const players: [{ id: string; name: string }, { id: string; name: string }] = [
  { id: "you", name: "Host" },
  { id: "ai", name: "Guest" },
];

const fresh = (seed = 11, now = 0): Duel => createDuel(seed, BATTLE_RULES, players, now, false);
const fingerprint = (d: Duel) => JSON.stringify(d.battle.save());

/** A legal swap for whoever is on turn (the board's own finder). */
function legal(d: Duel): BattleMove {
  const m = d.battle.board.findMove();
  if (!m) throw new Error("no legal move on the fixture board");
  return { t: "swap", r1: m[0], c1: m[1], r2: m[2], c2: m[3] };
}

/** A swap of two neighbours that makes no match (a dud the engine refuses). */
function dud(d: Duel): BattleMove {
  const g = d.battle.board.grid;
  for (let r = 0; r < d.battle.board.h; r++) {
    for (let c = 0; c + 1 < d.battle.board.w; c++) {
      if (g[r][c] && g[r][c + 1] && g[r][c]!.res === g[r][c + 1]!.res) {
        return { t: "swap", r1: r, c1: c, r2: r, c2: c + 1 };   // same colour: never a match
      }
    }
  }
  throw new Error("no same-colour neighbours on the fixture board");
}

describe("B6 — the host rejects guest moves it should", () => {
  it("out of turn: seat 1 moving on seat 0's turn is refused and nothing changes", async () => {
    const d = fresh();
    expect(d.battle.turn).toBe(0);
    const before = fingerprint(d);
    const res = await applyPlayerMove(d, "ai", legal(d), 0);
    expect(res).toMatchObject({ ok: false, reason: "out-of-turn" });
    expect(fingerprint(d)).toBe(before);
    expect(d.battle.moves).toHaveLength(0);
  });

  it("illegal: a swap that makes no match is refused and the turn stays", async () => {
    const d = fresh();
    const before = fingerprint(d);
    const res = await applyPlayerMove(d, "you", dud(d), 0);
    expect(res).toMatchObject({ ok: false, reason: "illegal" });
    expect(fingerprint(d)).toBe(before);
    expect(d.battle.turn).toBe(0);
  });

  it("illegal: off-board / non-adjacent coordinates are refused", async () => {
    const d = fresh();
    const before = fingerprint(d);
    for (const mv of [
      { t: "swap", r1: -1, c1: 0, r2: 0, c2: 0 },
      { t: "swap", r1: 0, c1: 0, r2: 2, c2: 2 },
      { t: "swap", r1: 99, c1: 99, r2: 99, c2: 98 },
    ] as BattleMove[]) {
      const res = await applyPlayerMove(d, "you", mv, 0);
      expect(res.ok, JSON.stringify(mv)).toBe(false);
    }
    expect(fingerprint(d)).toBe(before);
  });

  it("a stranger (not a duellist) is refused", async () => {
    const d = fresh();
    const res = await applyPlayerMove(d, "spectator", legal(d), 0);
    expect(res).toMatchObject({ ok: false });
    expect(d.battle.moves).toHaveLength(0);
  });

  it("an ability out of turn or without the mana is refused", async () => {
    const d = fresh();
    const offTurn = await applyPlayerMove(d, "ai", { t: "ability", id: "repair", seat: 1 }, 0);
    expect(offTurn).toMatchObject({ ok: false, reason: "out-of-turn" });
    const broke = await applyPlayerMove(d, "you", { t: "ability", id: "repair", seat: 0 }, 0);
    expect(broke).toMatchObject({ ok: false });
    expect(d.battle.moves).toHaveLength(0);
  });

  it("a legal move on your own turn lands, and then it is no longer yours", async () => {
    const d = fresh();
    const res = await applyPlayerMove(d, "you", legal(d), 0);
    expect(res.ok).toBe(true);
    expect(d.battle.moves).toHaveLength(1);
    if (d.battle.turn === 1) {
      const again = await applyPlayerMove(d, "you", legal(d), 0);
      expect(again).toMatchObject({ ok: false, reason: "out-of-turn" });
    }
  });

  it("no duel / a finished duel refuses everything", async () => {
    expect(await applyPlayerMove(null, "you", { t: "swap", r1: 0, c1: 0, r2: 0, c2: 1 }, 0))
      .toMatchObject({ ok: false, reason: "no-duel" });
    const d = fresh();
    (d.battle.state as { over: boolean }).over = true;
    expect(await applyPlayerMove(d, "you", legal(d), 0)).toMatchObject({ ok: false, reason: "over" });
  });
});

describe("B6 — rejoin and the deterministic sync", () => {
  /** Play `n` legal moves, alternating whoever is on turn. */
  async function playSome(d: Duel, n: number): Promise<void> {
    for (let i = 0; i < n && !d.battle.state.over; i++) {
      const who = d.battle.state.players[d.battle.turn].id;
      const res = await applyPlayerMove(d, who, legal(d), i);
      expect(res.ok).toBe(true);
    }
  }

  it("a refresh mid-battle restores the SAME state from the wire (JSON round trip)", async () => {
    const host = fresh(23);
    await playSome(host, 6);
    const wire = JSON.parse(JSON.stringify(duelToWire(host)));
    const rejoined = duelFromWire(wire, players, false);
    expect(fingerprint(rejoined)).toBe(fingerprint(host));
    expect(rejoined.battle.turn).toBe(host.battle.turn);
    expect(rejoined.battle.moves).toEqual(host.battle.moves);
    // …and it CONTINUES identically: the same next move lands the same way.
    const mv = legal(host);
    const who = host.battle.state.players[host.battle.turn].id;
    await applyPlayerMove(host, who, mv, 0);
    await applyPlayerMove(rejoined, who, mv, 0);
    expect(fingerprint(rejoined)).toBe(fingerprint(host));
  });

  it("the guest's replay of seed + move log lands on the host's board", async () => {
    const host = fresh(31);
    await playSome(host, 8);
    const guest = createBattle({ seed: host.seed, players, rules: host.rules });
    for (const m of duelToWire(host).moves) {
      const out = m.t === "swap"
        ? await guest.playSwap(m.r1, m.c1, m.r2, m.c2, 0)
        : await guest.useAbility(m.id);
      expect(out.ok).toBe(true);
    }
    expect(JSON.stringify(guest.save())).toBe(fingerprint(host));
  });

  it("the duel + offer survive the snapshot validator (the rejoin's full state)", async () => {
    const host = fresh(5);
    await playSome(host, 2);
    const engine = duelToWire(host);
    const n = MAP_W * MAP_H;
    const track = {
      dirt: new Uint8Array(n), road: new Uint8Array(n), owner: new Uint8Array(n),
      upgraded: new Uint8Array(n), revision: 0,
    } as unknown as Track;
    const snap = buildSnapshot({
      seed: 1, track, harvesters: [], factories: [], setupPhase: false, won: false,
      players: [{ id: "you", vp: 0, res: {} }, { id: "ai", vp: 0, res: {} }] as never,
      battle: {
        locks: [], readyAt: [], playerReadyAt: [], rivalReadyAt: 0, battles: 1, engine,
        offer: { industryId: 3, challenger: "you", until: 9 },
      },
    });
    const wire = JSON.parse(JSON.stringify(snap));
    expect(validateSnapshot(wire)).toBeNull();
    const applied = applySnapshot(wire);
    expect(applied.battle?.engine?.moves).toEqual(engine.moves);
    expect(applied.battle?.engine?.saved).toEqual(engine.saved);
    expect(applied.battle?.offer).toEqual({ industryId: 3, challenger: "you", until: 9 });
    // a mangled engine is refused, not half-applied
    const bad = validateSnapshot({ ...wire, battle: { ...wire.battle, engine: { seed: "x" } } });
    expect(bad?.message ?? "").toMatch(/battle engine/i);
  });
});

describe("B6 — the host's turn clock and disconnects", () => {
  it("a timed-out turn passes via one legal auto-play", async () => {
    const d = fresh(9, 0);
    const r = await duelClockTick(d, BATTLE_RULES.turnMs + 1, () => 0.5);
    expect(r.auto).toBe(true);
    expect(d.battle.moves).toHaveLength(1);
    expect(d.timeouts[0]).toBe(1);
  });

  it("nothing happens before the deadline", async () => {
    const d = fresh(9, 0);
    const r = await duelClockTick(d, BATTLE_RULES.turnMs - 1, () => 0.5);
    expect(r.auto).toBe(false);
    expect(d.battle.moves).toHaveLength(0);
  });

  it(`${TIMEOUTS_BEFORE_FORFEIT} stalls in a row forfeit to the other seat; a human move clears the count`, async () => {
    const d = fresh(13, 0);
    let now = 0;
    let winner = null;
    for (let i = 0; i < 40 && winner === null; i++) {
      // seat 1 always plays by hand; seat 0 always stalls
      if (d.battle.turn === 1) {
        const res = await applyPlayerMove(d, "ai", legal(d), now);
        expect(res.ok).toBe(true);
        noteHumanMove(d, 1, now);
        expect(d.timeouts[1]).toBe(0);
        continue;
      }
      now = d.turnDeadline + 1;
      winner = (await duelClockTick(d, now, () => 0.3)).winner;
    }
    expect(winner).toBe(1);
    expect(d.battle.state.over).toBe(true);
    expect(d.battle.state.winner).toBe(1);
  });

  it("a disconnect pauses the clock; the grace period forfeits to the seat still there", async () => {
    const d = fresh(17, 0);
    duelPresence(d, 1, false, 100);
    const paused = await duelClockTick(d, BATTLE_RULES.turnMs * 5, () => 0.5);
    expect(paused.auto).toBe(false);
    expect(d.battle.moves).toHaveLength(0);
    expect(duelGraceTick(d, 100 + DISCONNECT_GRACE_MS - 1)).toBeNull();
    expect(duelGraceTick(d, 100 + DISCONNECT_GRACE_MS)).toBe(0);
    expect(d.battle.state).toMatchObject({ over: true, winner: 0 });
    expect(duelToWire(d)).toMatchObject({ over: true, winner: 0 });
  });

  it("coming back inside the grace keeps the duel alive", () => {
    const d = fresh(17, 0);
    duelPresence(d, 1, false, 100);
    duelPresence(d, 1, true, 5_000);
    expect(duelGraceTick(d, 100 + DISCONNECT_GRACE_MS * 2)).toBeNull();
    expect(d.battle.state.over).toBe(false);
  });
});
