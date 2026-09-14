import { test, expect, type Browser } from "@playwright/test";
import {
  attachLogs, expectBooted, expectLeftSheet, expectToast, leaveRoom,
  MP_DEPARTURE_MS, ownUsername, pairUp, playSetup, startMatch, wireHas, type Side,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// #132 — leaving, in both directions, through the shipped way out — as #164
// reshaped it.
//
// An explicit "Leave room" is a DELIBERATE departure, and #164 stopped making
// the survivor wait a grace period for one: the leaving client says `abandon`
// on its way out, the room kicks the seat, and `onPlayerLeave("kick")` files
// the leaver's loss and opens the survivor's dialog in the same instant. The
// grace (`reconnectTimeout` in the rooms file) is now reserved for what it is
// for — an involuntary drop — which mp-reconnect/mp-rejoin cover.
//
// Both directions are asserted all the way through:
//
//   wire      the sidecar really told the remaining seat (a mocked room could
//             not produce either frame)
//   toast     the player was told in plain language
//   sheet     the #164 departure dialog — words AND doors, never the blank
//             overlay the old modal could degenerate into — with the board
//             still standing behind it
//
// The GUEST's departure reaches the host as the room's own `result` (the
// forfeit, filed before the roster event) and then the SDK's roster event —
// the #121 path this suite would fail if it broke. The HOST's departure goes
// out as a room `reject` ("The host left the game.") — no host, no truth —
// plus the same result and roster frames.
// ══════════════════════════════════════════════════════════════════════════

async function matchedPair(browser: Browser) {
  const pair = await pairUp(browser);
  await startMatch(pair);
  await Promise.all([expectBooted(pair.host), expectBooted(pair.guest)]);
  await playSetup(pair);
  return pair;
}

/** Both seats keep playing after `side` leaves — i.e. this run really tested
 *  the departure and not a crash that happened to close the page. */
async function expectStillPlaying(other: Side): Promise<void> {
  const state = await other.page.evaluate(() => (window as unknown as { __iso?: { phase?: string } }).__iso?.phase ?? "");
  expect(state, `${other.name} is still in the match`).toBe("play");
}

test("the guest leaves through the menu and the host is told the match is over", async ({ browser }, testInfo) => {
  const pair = await matchedPair(browser);
  const { host, guest } = pair;
  try {
    const guestName = await ownUsername(guest);

    await leaveRoom(guest);

    // The leaver is out: back at the front door, no game running.
    await expect(guest.page.locator(".menu-btn.primary"), "the guest is back at the main menu").toBeVisible();

    // #164: a deliberate leave does not make the survivor count down a seat
    // that will never refill — the abandon rides out with the leave, the room
    // kicks and files at once, and the roster event follows immediately. (The
    // `result` frame is the forfeit itself; MP-08's grace is for DROPS, which
    // mp-reconnect and mp-rejoin pin.)
    await expect.poll(() => wireHas(host, "room:broadcast:result"), {
      message: "the host saw the room file the leaver's loss",
      timeout: MP_DEPARTURE_MS,
    }).toBe(true);
    await expect.poll(() => wireHas(host, "room:playerLeft"), {
      message: "the host saw the seat removed",
      timeout: MP_DEPARTURE_MS,
    }).toBe(true);

    // The host is told, by name — in a toast AND on the departure sheet, with
    // the doors #164 requires: finish the board solo, or leave. Never a blank
    // panel, never a sentence with no way out.
    await expectToast(host, /left the room\./);
    const sheet = await expectLeftSheet(host, /left — this match is over/);
    expect(sheet.text, "the sheet names the seat that left").toContain(guestName);
    expect(sheet.doors, "the survivor keeps a choice").toContain("Finish the game");
    expect(sheet.doors.some((d) => d.startsWith("Leave")), "and a way out").toBe(true);

    // The host's own game never broke: it is still a live match with a board.
    await expectStillPlaying(host);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});

test("the host leaves and the guest is refused by the room, then told the match is over", async ({ browser }, testInfo) => {
  const pair = await matchedPair(browser);
  const { host, guest } = pair;
  try {
    await leaveRoom(host);
    await expect(host.page.locator(".menu-btn.primary"), "the host is back at the main menu").toBeVisible();

    // #121/#164: with no host there is no truth, so the room refuses the
    // stranded guest with a reason a player can read — delivered by the room's
    // `onPlayerLeave`, which an explicit leave reaches at once (the host's own
    // abandon rode out with its leave).
    await expect.poll(() => wireHas(guest, "reject:The host left the game."), {
      message: "the room refused the guest with the host-left reason",
      timeout: MP_DEPARTURE_MS,
    }).toBe(true);
    await expectToast(guest, /The host left the game\./);

    // The refusal raises the departure sheet — the reason on it, word for
    // word, and the one honest door. The roster event lands right behind and
    // must NOT stack a second dialog over the first.
    const sheet = await expectLeftSheet(guest, /The host left the game\./);
    expect(sheet.text, "the sheet is headed by what happened").toContain("Opponent left");
    expect(sheet.doors, "one door: the match is over").toEqual([expect.stringMatching(/^Leave/)]);
    expect(guest.page.locator(".left-sheet"), "one sheet, not two").toHaveCount(1);

    // The guest's page is alive: nothing threw, and the game it is standing in
    // is still `play` (an ended room, not a crashed client).
    expect(guest.errors, "no uncaught errors on the guest page").toEqual([]);
    await expectStillPlaying(guest);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});
