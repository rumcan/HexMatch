import { test, expect } from "@playwright/test";
import {
  attachLogs, expectBooted, lobbySeats, ownUsername, pairUp, playSetup, readState, startMatch, wireHas,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// #132 — two people, one room: the lobby, the map, and the two openings.
//
// Everything here is the real thing: `vite dev` with the room sidecar the
// multiplayer plugin starts, the production SDK adapter (`src/net/transport.ts`
// → `@series-inc/rundot-game-sdk`), and `src/rooms/HexmatchRoom.ts` compiled by
// the sidecar. The two seats are two browser CONTEXTS — separate identities,
// separate sessionStorage, separate sockets — entered the way a player enters:
// Play → Host a game → read the code → Play → Join with a code → Start game.
//
// Nothing is mocked, and no wait is a sleep: every step waits on the state the
// room or the game actually reached (a code the room minted, a seat the roster
// painted, `__iso.phase` past the loading screen).
// ══════════════════════════════════════════════════════════════════════════

test("two windows meet in one room, seat, and start on the same map", async ({ browser }, testInfo) => {
  const pair = await pairUp(browser);
  const { host, guest, code } = pair;
  try {
    // ── two contexts really are two people ────────────────────────────────
    // The SDK's dev delegate keeps its profile in sessionStorage, so a fresh
    // context mints a fresh `Dev Player XXXX`. If these ever came out equal,
    // the "second player" would be the same seat twice and every assertion
    // below would pass for the wrong reason.
    const [hostName, guestName] = await Promise.all([ownUsername(host), ownUsername(guest)]);
    expect(hostName).toMatch(/^Dev Player [0-9A-F]{4}$/);
    expect(guestName).toMatch(/^Dev Player [0-9A-F]{4}$/);
    expect(guestName).not.toBe(hostName);

    // ── the room minted the code the guest typed ──────────────────────────
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
    for (const side of [host, guest]) {
      expect(wireHas(side, "room:joined"), `${side.name} was joined by the room`).toBe(true);
      expect(wireHas(side, "welcome"), `${side.name} heard the greeting`).toBe(true);
    }
    expect(wireHas(host, `room:joined:${code}`), "the code on screen is the room's own").toBe(true);

    // ── both lobbies paint both seats, by name ────────────────────────────
    // The welcome is the only list that names everyone: a joiner hears nothing
    // about players who arrived before it, so a lobby built from the live room
    // roster alone shows the guest one nameless seat. Both screens, both names,
    // in the room's own slot order (host first) — that is the regression this
    // pair of assertions exists for.
    const hostSeats = await lobbySeats(host);
    const guestSeats = await lobbySeats(guest);
    expect(hostSeats.map((s) => s.name)).toEqual([hostName, guestName]);
    expect(guestSeats.map((s) => s.name)).toEqual([hostName, guestName]);
    expect(hostSeats.map((s) => s.status)).toEqual(["Connected", "Connected"]);
    expect(guestSeats.map((s) => s.status)).toEqual(["Connected", "Connected"]);

    // ── Start, on both screens, and the long boot ─────────────────────────
    await startMatch(pair);
    await Promise.all([expectBooted(host), expectBooted(guest)]);

    // ── one island, minted once by the room ───────────────────────────────
    const [hostBoot, guestBoot] = await Promise.all([readState(host), readState(guest)]);
    expect(hostBoot.seed, "the room's seed reaches both seats").toBe(guestBoot.seed);
    expect(hostBoot.map, "and it is the same island").toEqual(guestBoot.map);
    expect(hostBoot.map.industries.length).toBeGreaterThan(0);
    expect(hostBoot.map.towns.length).toBeGreaterThan(0);

    // ── the two openings, mirrored ────────────────────────────────────────
    await playSetup(pair);
    const [hostPlay, guestPlay] = await Promise.all([readState(host), readState(guest)]);
    const own = (s: typeof hostPlay) => ({
      factories: s.factories.filter(([owner]) => owner === "you").map(([, tx, ty]) => `${tx},${ty}`),
      depots: s.harvesters.filter(([owner]) => owner === "you").map(([, tx, ty]) => `${tx},${ty}`),
    });
    const rival = (s: typeof hostPlay) => ({
      factories: s.factories.filter(([owner]) => owner === "ai").map(([, tx, ty]) => `${tx},${ty}`),
      depots: s.harvesters.filter(([owner]) => owner === "ai").map(([, tx, ty]) => `${tx},${ty}`),
    });
    expect(own(hostPlay).factories).toHaveLength(1);
    expect(own(hostPlay).depots).toHaveLength(1);
    expect(own(guestPlay).factories).toHaveLength(1);
    expect(own(guestPlay).depots).toHaveLength(1);
    // Each seat's own world holds the other seat's opening too — and holds it
    // where the OTHER seat says it stands. The opening factory is the one tile
    // the two seats can never both have (one Factory per seat), so this pair of
    // equalities is the whole "the room relays positions, not a rendered
    // guess" claim in one line each.
    expect(rival(hostPlay).factories, "the host sees the guest's Factory where the guest put it")
      .toEqual(own(guestPlay).factories);
    expect(rival(guestPlay).factories, "the guest sees the host's Factory where the host put it")
      .toEqual(own(hostPlay).factories);
    expect(rival(hostPlay).depots).toEqual(own(guestPlay).depots);
    expect(rival(guestPlay).depots).toEqual(own(hostPlay).depots);
    // Both seats are out of setup and playing.
    expect(hostPlay.phase).toBe("play");
    expect(guestPlay.phase).toBe("play");

    // ── the boards: each seat's own, each seat's copy of the other's ──────
    // #117 publishes a board only when it changed, and always under the seat
    // that owns it. The mirror is exact in both directions; the independence
    // of the two boards is what the reset spec proves (a board-local action on
    // one seat must not touch the other's).
    expect(hostPlay.rivalBoardSig, "the host's copy of the guest's board is the guest's board")
      .toBe(guestPlay.boardSig);
    expect(guestPlay.rivalBoardSig, "and the other way round").toBe(hostPlay.boardSig);

    // ── the game never threw ─────────────────────────────────────────────
    // A page error is the one failure mode a screenshot misses: the game keeps
    // painting while a listener is dead.
    expect(host.errors, "no uncaught errors in the host page").toEqual([]);
    expect(guest.errors, "no uncaught errors in the guest page").toEqual([]);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});
