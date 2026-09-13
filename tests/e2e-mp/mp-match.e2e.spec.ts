import { test, expect, type Browser } from "@playwright/test";
import {
  attachLogs, clickReset, contestedDepotSite, expectBooted, expectPurse, expectToast, fundDepots,
  ownUsername, pairUp, placeDepot, planValid, playSetup, postOffer, readState, setPurse, setRivalRes,
  startMatch, takeNewestOffer, tileOccupants, tray, type PlanSite,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// #132 — the things only a REAL room can prove about a match in progress.
//
// A simulated room can replay a fixed script; it cannot make two independent
// clients disagree. Every test here drives a real action on one seat and reads
// the consequence off the OTHER seat's own world — through the sidecar, the
// production adapter and the room bundle, with no mock in the path.
//
//   * market   — the host's offer, taken from the guest's tray, moves both
//                purses by exactly the trade and nothing else.
//   * reset    — a guest's board-local action re-rolls ITS board, reaches the
//                host as the host's copy of that board, and leaves the host's
//                own board untouched.
//   * conflict — two seats click the same legal tile at the same instant; the
//                authoritative world settles on ONE depot, and both seats
//                agree whose it is.
// ══════════════════════════════════════════════════════════════════════════

/** The shared opening every test in this file needs: two people in one room,
 *  seated through the UI, both booted, both out of setup. */
async function matchedPair(browser: Browser) {
  const pair = await pairUp(browser);
  await startMatch(pair);
  await Promise.all([expectBooted(pair.host), expectBooted(pair.guest)]);
  await playSetup(pair);
  return pair;
}

test("a guest takes the host's offer from the tray and both purses move by the trade", async ({ browser }, testInfo) => {
  const pair = await matchedPair(browser);
  const { host, guest } = pair;
  try {
    // The host posts 2 stone for 2 ore. The offer is only takeable if the
    // GUEST has the ore, and only payable if the HOST has the stone, so both
    // sides of the trade are funded before the click. (`setRivalRes` writes
    // the host's authoritative copy of the guest's bag — the same object its
    // intent is settled against.)
    await host.page.evaluate(setPurse, { cargo: "stone", amount: 10 });
    await host.page.evaluate(setRivalRes, { cargo: "ore", amount: 5 });
    const posted = await host.page.evaluate(postOffer, { give: "stone", giveN: 2, want: "ore", wantN: 2 });
    expect(posted, "the host's own market took the offer").toBe(true);

    // The guest's world learns of it, and the tray says so — with the POSTER'S
    // name on it (#114: names come from the room, not from a placeholder).
    await expect.poll(async () => (await tray(guest)).offers, { message: "the guest's tray shows the offer" }).toBe(1);
    const shown = await tray(guest);
    expect(shown.visible, "the offer tray is on screen (≥1321px wide)").toBe(true);
    expect(shown.text.toUpperCase(), "the tray names the seat that posted")
      .toContain((await ownUsername(host)).toUpperCase());
    await expect.poll(async () => (await tray(guest)).takeEnabled, {
      message: "the guest can afford the take (its own bag arrives with the host's delta)",
    }).toBe(true);

    // Take, through the same button a player presses.
    await takeNewestOffer(guest);

    // The trade is the ONLY change: the host pays the escrowed stone and
    // receives the ore; the guest pays ore and receives stone.
    await expect.poll(async () => (await readState(host)).offers.length, { message: "the offer left the board" }).toBe(0);
    await expectPurse(host, "stone", 8);
    await expectPurse(host, "ore", 2);
    await expectPurse(guest, "ore", 3);
    await expectPurse(guest, "stone", 14);
    // Wood was never part of the offer and never moved on either seat.
    expect((await readState(host)).purse.wood).toBe(12);
    expect((await readState(guest)).purse.wood).toBe(12);

    // And the two worlds agree about both purses: the host's copy of the
    // guest's bag is the guest's bag, and vice versa.
    const after = await Promise.all([readState(host), readState(guest)]);
    expect(after[0].rivalPurse.ore, "the host's view of the guest's ore").toBe(after[1].purse.ore);
    expect(after[0].rivalPurse.stone, "the host's view of the guest's stone").toBe(after[1].purse.stone);
    expect(after[1].rivalPurse.stone, "the guest's view of the host's stone").toBe(after[0].purse.stone);
    expect(after[1].rivalPurse.ore, "the guest's view of the host's ore").toBe(after[0].purse.ore);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});

test("a guest's Reset re-rolls its own board, reaches the host, and spares the host's board", async ({ browser }, testInfo) => {
  const pair = await matchedPair(browser);
  const { host, guest } = pair;
  try {
    const beforeGuest = await readState(guest);
    const beforeHost = await readState(host);
    // Both boards are the fresh opening boards: one deal per seat, and each
    // seat's copy of the other's.
    expect(beforeHost.boardSig).toBe(beforeGuest.rivalBoardSig);
    expect(beforeHost.rivalBoardSig).toBe(beforeGuest.boardSig);

    // The guest presses ♻ Reset — the shipped button, not a test hook.
    await clickReset(guest);

    // The guest's own board is re-dealt, and the guest is told so…
    await expect.poll(async () => (await readState(guest)).boardSig, {
      message: "the guest's own board is a fresh neutral one",
    }).not.toBe(beforeGuest.boardSig);
    await expectToast(guest, /Processing Plant collapsed\. Fresh neutral board\./);

    // …the HOST's copy of the guest's board becomes that same new board…
    const afterGuest = await readState(guest);
    await expect.poll(async () => (await readState(host)).rivalBoardSig, {
      message: "the host holds the guest's new board, byte for byte",
    }).toBe(afterGuest.boardSig);

    // …and the host's own board never moved. This is the independence claim:
    // a board-local action on one seat may not deal the other seat's tiles, and
    // a delta that carried the wrong board would fail exactly here.
    expect((await readState(host)).boardSig, "the host's own board is untouched").toBe(beforeHost.boardSig);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});

test("two seats clicking one tile at the same instant settle on a single depot", async ({ browser }, testInfo) => {
  const pair = await matchedPair(browser);
  const { host, guest } = pair;
  try {
    // Both seat purses are deep enough to pay a Depot (wood/stone/grain/oil) —
    // the host's own, and its authoritative copy of the guest's. A refusal can
    // therefore only mean "the race", never "you could not afford it".
    await fundDepots(host);

    // One tile both seats may build on, by each seat's OWN plan.
    const site = await contestedDepotSite(pair);
    expect(site, "the island offers a depot tile both seats may build on").not.toBeNull();
    const plan: PlanSite = { kind: "depot", tx: site!.tx, ty: site!.ty };
    expect(await host.page.evaluate(planValid, plan), "legal for the host").toBe(true);
    expect(await guest.page.evaluate(planValid, plan), "legal for the guest").toBe(true);

    const before = (await readState(host)).harvesters.length;

    // Both clicks in the same instant: the host's is a local rule check, the
    // guest's a typed intent that has to cross the room.
    const [hostPlaced, guestSent] = await Promise.all([
      host.page.evaluate(placeDepot, site!),
      guest.page.evaluate(placeDepot, site!),
    ]);
    expect(guestSent, "the guest's intent was handed to the room").toBe(true);

    // The authoritative world holds exactly ONE depot on the contested tile…
    await expect.poll(async () => (await host.page.evaluate(tileOccupants, site!)).depots.length, {
      message: `the contested tile holds a depot (host placed: ${hostPlaced})`,
    }).toBe(1);

    // …and it belongs to the seat that won, by the host's own return value;
    // the other seat sees the same depot under the mirrored owner.
    const [hostTile, guestTile] = await Promise.all([
      host.page.evaluate(tileOccupants, site!),
      guest.page.evaluate(tileOccupants, site!),
    ]);
    expect(hostTile.depots, "the winner holds the tile on the host's side").toEqual([hostPlaced ? "you" : "ai"]);
    expect(guestTile.depots, "and on the guest's side, mirrored").toEqual([hostPlaced ? "ai" : "you"]);

    // One depot total, on both seats: the race did not double-book the tile.
    expect((await readState(host)).harvesters.length, "exactly one depot was added").toBe(before + 1);
    expect((await readState(guest)).harvesters.length, "and the guest agrees").toBe(before + 1);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});
