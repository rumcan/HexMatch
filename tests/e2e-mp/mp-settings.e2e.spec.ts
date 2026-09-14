import { test, expect } from "@playwright/test";
import {
  attachLogs, expectBooted, openSide, pairUp, press, readState, startMatch, toStartScreen, hostRoom,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// #186 — a host's custom match settings, in two real browsers and one room.
//
// The unit suites pin the record and the wire; this pins the ticket's
// acceptance criteria where a player would meet them:
//
//   * "Changing the win target to e.g. 5★ ends the game at 5★ for host and
//     guest, and the HUD shows 'first to 5★'" — both windows, from the HUD;
//   * "Choosing Rich resources starts every player with 2× the default purse.
//     Host and guest purses match." — read out of both seats' live worlds;
//   * "Guests see the settings read-only as soon as they join, updating live
//     if the host changes them" — asserted BEFORE anyone presses Start;
//   * "Host can add at least 1 AI seat … and start a game" — a host who fills
//     the open seat with a machine starts alone, and the machine is the seat.
//
// Nothing is mocked: `vite dev`, the room sidecar, the production SDK adapter
// and the real room, entered the way a player enters.
// ══════════════════════════════════════════════════════════════════════════

/** The lobby's one-line summary of the rules the ROOM holds. */
const summary = (side: { page: import("@playwright/test").Page }) =>
  side.page.locator(".match-settings .ms-summary");

test("a host's ★ line and purse become the guest's rules, live and in game", async ({ browser }, testInfo) => {
  const pair = await pairUp(browser);
  const { host, guest } = pair;
  try {
    // ── the guest arrives on the shipped rules ────────────────────────────
    // A room nobody has customised carries no settings block at all, so the
    // guest's panel reads the defaults rather than a guess.
    await expect(summary(guest)).toHaveText(/First to 10★ · Standard resources/);

    // ── the host moves two dials ──────────────────────────────────────────
    await press(host.page.getByRole("button", { name: /^Short/ }), "the Short ★ preset");
    await press(host.page.getByRole("button", { name: /^Rich 2×/ }), "the Rich purse preset");
    await expect(summary(host)).toHaveText(/First to 5★ · Rich 2× resources/);

    // ── and the guest hears it, still in the lobby, with no dials of its own ─
    // This is the whole point of holding the rules in the ROOM: a guest reads
    // what the host filed, before the match exists.
    await expect(summary(guest)).toHaveText(/First to 5★ · Rich 2× resources/);
    const guestDials = guest.page.locator(".match-settings fieldset.ms-group");
    await expect(guestDials).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(guestDials.nth(i)).toBeDisabled();

    // ── both seats boot on those rules ────────────────────────────────────
    await startMatch(pair);
    await Promise.all([expectBooted(host), expectBooted(guest)]);

    for (const side of [host, guest]) {
      const rules = await side.page.evaluate(() =>
        (window as unknown as { __iso: { matchSettings: unknown } }).__iso.matchSettings);
      expect(rules, `${side.name} booted on the room's rules`).toMatchObject({
        winTarget: 5,
        startPurse: { wood: 24, stone: 24, ore: 0 },
      });
      // "Host and guest purses match" — every seat, on both browsers.
      const seats = await side.page.evaluate(() =>
        (window as unknown as { __iso: { players: { purse: Record<string, number> }[] } }).__iso.players);
      for (const seat of seats) {
        expect(seat.purse, `${side.name} seat purse`).toMatchObject({ wood: 24, stone: 24, ore: 0 });
      }
      // The HUD's ★ badge is the line the player actually reads.
      await expect(side.page.locator("#iso-vp")).toContainText("/5");
    }

    // ── and the two worlds still agree ────────────────────────────────────
    const [hostState, guestState] = await Promise.all([readState(host), readState(guest)]);
    expect(hostState.purse).toMatchObject({ wood: 24, stone: 24, ore: 0 });
    expect(guestState.purse).toMatchObject({ wood: 24, stone: 24, ore: 0 });
  } finally {
    await attachLogs(testInfo, host, guest);
  }
});

test("a host who fills the open seat with an AI starts without waiting", async ({ browser }, testInfo) => {
  const host = await openSide(browser, "host");
  try {
    await toStartScreen(host);
    await hostRoom(host);

    // One seat in the room, so the shipped lobby would wait for a rival.
    await expect(host.page.getByRole("button", { name: /Start game/ })).toBeDisabled();

    // An AI takes the second seat — with a difficulty the host picks.
    await press(host.page.getByRole("button", { name: /Add AI opponent/ }), "Add AI opponent");
    await expect(host.page.locator(".ms-seat .ms-badge.ai")).toHaveCount(1);
    await host.page.locator(".ms-skill").selectOption("hard");
    await expect(host.page.getByRole("button", { name: /Start game/ })).toBeEnabled();

    // The room was told, so a late joiner reads the same rules.
    await expect(summary(host)).toHaveText(/AI Hard/);

    await press(host.page.getByRole("button", { name: /Start game/ }), "Start game");
    await expectBooted(host);

    // The machine is the seat: the host is simulating it, and the room's
    // difficulty is the one it plays at.
    const seat = await host.page.evaluate(() => {
      const h = (window as unknown as { __iso: { aiSeat: boolean; matchSettings: { aiSeats: string[] }; rivalSkill: { key: string } } }).__iso;
      return { aiSeat: h.aiSeat, aiSeats: h.matchSettings.aiSeats, skill: h.rivalSkill.key };
    });
    expect(seat).toEqual({ aiSeat: true, aiSeats: ["hard"], skill: "hard" });
  } finally {
    await attachLogs(testInfo, host);
  }
});
