import { test, expect } from "@playwright/test";
import {
  attachLogs, expectBooted, expectInPlay, expectLeftSheet, expectNoLeftSheet, leftSheet,
  openSide, pairUp, playSetup, press, startMatch, toStartScreen, wireHas,
  type Pair, type Side,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// #164 — the two acceptance flows from the bug report, end to end:
//
//   (a) a player KICKED by the browser (a reload kills the socket exactly
//       like the resize-kill does) is announced on the far seat as a
//       countdown over a live board — never a blank overlay — and on return
//       is offered the held seat: "You have a match in progress" → Rejoin →
//       the SAME match, resynced from the host;
//
//   (b) a player who answers that offer with ABANDON in a RANKED match is
//       filed a loss, and the survivor is credited the win with the rating
//       moved — on a sheet with words and a door, whichever way the room's
//       frames race.
//
// The identity that makes (a) honest is the SDK's own dev seam: the fake tab
// profile lives in sessionStorage, so a reloaded page returns as the SAME
// player the room is holding a seat for — the dev stand-in for "the same
// RUN account" from the report. (b) goes through Auto Matchmaking because
// the rated queue is the only door that makes a match ranked.
// ══════════════════════════════════════════════════════════════════════════

/** The survivor's board is still a live match, sheet-free, phase `play`. */
async function expectStillPlaying(side: Side): Promise<void> {
  const phase = await side.page.evaluate(
    () => (window as unknown as { __iso?: { phase?: string } }).__iso?.phase ?? "",
  );
  expect(phase, `${side.name} is still in the match`).toBe("play");
  await expectNoLeftSheet(side);
}

/** The countdown banner, as the survivor sees it: hidden counts as clear. */
function bannerGone(side: Side): () => Promise<boolean> {
  return async () => side.page.evaluate(() => {
    const el = document.getElementById("iso-banner");
    return !el || el.classList.contains("hidden") || !/disconnected/i.test(el.textContent ?? "");
  });
}

/**
 * The rated queue decides who hosts, so the roles are read off the lobbies'
 * own buttons: the creator's primary says "Start game", the joiner's "Play".
 */
async function matchmadeRoles(a: Side, b: Side): Promise<[host: Side, guest: Side]> {
  const label = async (s: Side) =>
    ((await s.page.locator(".lobby-actions .start-primary").textContent().catch(() => "")) ?? "").trim();
  await expect
    .poll(async () => `${await label(a)} | ${await label(b)}`, {
      message: "the queue paired them and a lobby resolved",
      timeout: 150_000,
    })
    .toMatch(/Start game/);
  return (await label(a)) === "Start game" ? [a, b] : [b, a];
}

test("(a) a reload-dropped guest is announced with a countdown, and the walk back resumes the SAME match", async ({ browser }, testInfo) => {
  test.setTimeout(540_000);   // boots the guest's island twice (drop, walk back)
  const pair = await pairUp(browser);
  const { host, guest } = pair;
  try {
    await startMatch(pair);
    await Promise.all([expectBooted(host), expectBooted(guest)]);
    await playSetup(pair);

    // ── the kick: a reload drops the socket exactly like a resize-kill ──
    await guest.page.reload();

    // The survivor hears about it within seconds (the room's presence poll
    // runs every second): a NOTICE WITH A COUNTDOWN over a board that stays
    // live — the held seat is not a departure, so no dialog, no blank panel.
    const banner = host.page.locator("#iso-banner");
    await expect(banner, "the host is told who disconnected").toContainText(/disconnected/i, { timeout: 20_000 });
    await expect(banner, "and shown the window counting down").toContainText(/reconnecting \d+:\d\d/);
    await expectStillPlaying(host);

    // ── the return: same context, same sessionStorage profile, same seat ──
    await toStartScreen(guest);
    await expect(
      guest.page.getByRole("heading", { name: /match in progress/i }),
      "the returner is offered the match instead of a silent fresh start",
    ).toBeVisible({ timeout: 30_000 });
    // The offer names the room it is offering.
    await expect(guest.page.locator(".rejoin-room")).toContainText(pair.code);
    await press(guest.page.getByRole("button", { name: /Rejoin the match/ }), "Rejoin the match");

    // The room re-greets the returner: the lobby lights up from the fresh
    // welcome exactly like a first join, and Play walks back into the LIVE
    // match — the resync lands the guest in `play`, not in a fresh setup.
    await press(guest.page.getByRole("button", { name: /^Play$/ }), "Play");
    await expectInPlay(guest);

    // The survivor's countdown came down, the match resumed on both seats…
    await expect.poll(bannerGone(host), {
      message: "the host's countdown came down when the seat refilled",
      timeout: 60_000,
    }).toBe(true);
    await expectStillPlaying(host);
    // …and the wire proves it was a RESUME: the seat was held the whole time,
    // so the room never announced it as gone.
    expect(wireHas(host, "room:playerLeft"), "the held seat was never evicted").toBe(false);
    expect(host.errors, "no uncaught errors on the host page").toEqual([]);
    expect(guest.errors, "no uncaught errors on the guest page").toEqual([]);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});

test("(b) an abandoned RANKED match credits the survivor: the win is filed and the rating moves", async ({ browser }, testInfo) => {
  test.setTimeout(540_000);
  const seatA = await openSide(browser, "seat-a");
  const seatB = await openSide(browser, "seat-b");
  try {
    await toStartScreen(seatA);
    await toStartScreen(seatB);

    // ── the rated queue pairs them: first arrival creates, second joins ──
    await press(seatA.page.getByRole("button", { name: /Auto Matchmaking/ }), "Auto Matchmaking (seat A)");
    await press(seatB.page.getByRole("button", { name: /Auto Matchmaking/ }), "Auto Matchmaking (seat B)");
    const [host, guest] = await matchmadeRoles(seatA, seatB);
    const pair: Pair = { host, guest, code: "" };

    await startMatch(pair);
    await Promise.all([expectBooted(host), expectBooted(guest)]);
    await playSetup(pair);

    // ── kick the guest; this time the offer is answered with ABANDON ──
    await guest.page.reload();
    await toStartScreen(guest);
    await expect(
      guest.page.getByRole("heading", { name: /match in progress/i }),
    ).toBeVisible({ timeout: 30_000 });
    // The memo remembers what the room summary cannot say: this match was
    // RANKED — and the abandon door says out loud what that costs.
    await expect(guest.page.locator(".rejoin-room")).toContainText(/ranked/i);
    const abandon = guest.page.getByRole("button", { name: /Abandon/ });
    await expect(abandon).toContainText(/loss/i);
    await press(abandon, "Abandon (counts as a loss)");

    // The abandoner files its own loss, tells the room, and lands back on the
    // mode screen — no dialog, no dead end.
    await expect(
      guest.page.getByRole("button", { name: /Auto Matchmaking/ }),
      "the abandoner is back on the mode screen",
    ).toBeVisible({ timeout: 30_000 });

    // ── the survivor: the dialog the issue asked for, with the win CREDITED ──
    // The room files the forfeit before the roster event lands, so the sheet
    // stands with (or settles, a heartbeat later with) the rating row: full
    // gain for the survivor, doors folded down to the one honest exit.
    await expectLeftSheet(host, /Opponent left/);
    await expect
      .poll(async () => (await leftSheet(host))?.ratingRow ?? "", {
        message: "the survivor's win is credited, with the rating moved",
        timeout: 60_000,
      })
      .toMatch(/Your rating/);
    const settled = (await leftSheet(host))!;
    expect(settled.ratingUp, "the credited win moved the rating UP").toBe(true);
    expect(settled.text, "the sheet says the match was filed as a win").toContain("filed as a win");
    expect(settled.doors, "the verdict folds the doors down to the exit").toEqual([
      expect.stringMatching(/^Leave/),
    ]);

    // And the one door on it works: the survivor walks out to the front door,
    // never a blank overlay, never a panel with nothing to click.
    await press(host.page.locator(".left-doors button"), "the sheet's Leave door");
    await expect(host.page.locator(".menu-btn.primary"), "the survivor is back at the main menu")
      .toBeVisible({ timeout: 60_000 });
    expect(host.errors, "no uncaught errors on the host page").toEqual([]);
    expect(guest.errors, "no uncaught errors on the guest page").toEqual([]);
  } finally {
    await attachLogs(testInfo, seatA, seatB);
    await seatA.ctx.close();
    await seatB.ctx.close();
  }
});
