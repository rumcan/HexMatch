import { test, expect, type Browser } from "@playwright/test";
import {
  attachLogs, expectBooted, expectEndedMatch, expectToast, leaveRoom, MP_DEPARTURE_MS, ownUsername,
  pairUp, playSetup, startMatch, wireHas, type Side,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// #132 — leaving, in both directions, through the shipped way out.
//
// The room holds a leaver's seat for the grace period (`reconnectTimeout` in
// the rooms file; 5s in `rundot/realtime.e2e.config.json`, 60s in the shipped
// one), and only when that expires does the far seat hear about it. Both
// directions are asserted all the way through:
//
//   wire      the sidecar really told the remaining seat (a mocked room could
//             not produce either frame)
//   toast     the player was told in plain language
//   modal     the match is over, and the board is still standing
//
// The GUEST's departure is silent on the relay, so it can only reach the host
// through the SDK's roster event — which is exactly the #121 path this suite
// would fail if it broke. The HOST's departure goes out as a room `reject`
// ("The host left the game.") and then the same roster event.
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

    // The room holds the seat for its grace, then evicts it — and the SDK's
    // roster event is the only thing that tells the HOST. Both frames are
    // asserted, in order, because a room that never evicted would leave the
    // host simulating against an empty seat forever (#121).
    await expect.poll(() => wireHas(host, "room:playerDisconnected"), {
      message: "the host saw the guest's link drop",
      timeout: MP_DEPARTURE_MS,
    }).toBe(true);
    await expect.poll(() => wireHas(host, "room:playerLeft"), {
      message: "the host saw the seat evicted after the grace",
      timeout: MP_DEPARTURE_MS,
    }).toBe(true);

    // The host is told, by name, that the match is over.
    const modal = await expectEndedMatch(host, /left the room — this match is over\./);
    expect(modal, "the ended-match line names the seat that left").toContain(guestName);
    await expectToast(host, /left the room — this match is over\./);

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
    const hostName = await ownUsername(host);

    await leaveRoom(host);
    await expect(host.page.locator(".menu-btn.primary"), "the host is back at the main menu").toBeVisible();

    // #121: with no host there is no truth, so the room refuses the stranded
    // guest with a reason a player can read — and the guest's toast says it.
    // The refusal is delivered by the room's `onPlayerLeave`, so it arrives
    // only once the host's seat has passed its grace (see the rooms file).
    await expect.poll(() => wireHas(guest, "reject:The host left the game."), {
      message: "the room refused the guest with the host-left reason",
      timeout: MP_DEPARTURE_MS,
    }).toBe(true);
    await expectToast(guest, /The host left the game\./);

    // Then the roster event lands and the guest is told the match is over,
    // naming the seat that left. The board stays standing behind the modal.
    const modal = await expectEndedMatch(guest, /left the room — this match is over\./);
    expect(modal, "the ended-match line names the seat that left").toContain(hostName);
    await expectToast(guest, /left the room — this match is over\./);

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
