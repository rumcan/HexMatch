import { test, expect } from "@playwright/test";
import {
  attachLogs, dropRoomSocket, expectBooted, expectNoEndedMatch, findSpot, fundDepots, MP_REATTACH_MS,
  pairUp, placeDepot, playSetup, readState, startMatch, tileOccupants, wireHas, type FindSpotOptions,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// #132 — the transport boundary: a link dies mid-match and comes back.
//
// This is the one scenario a mocked room cannot express at all. The guest's
// WebSocket to the room sidecar is closed underneath the SDK (exactly what a
// dropped network does), the sidecar marks the seat disconnected and starts its
// grace timer, and the SDK re-attaches inside that window with a fresh ticket
// and `reconnect: true`. Then:
//
//   * the room confirms the same seat back (`room:reconnected`, no new join);
//   * the HOST is never told the seat left — it saw the drop, not a departure,
//     so it kept playing instead of showing an ended match;
//   * the returning guest is brought back up to date with the host's newer
//     world (a resync, or the ordinary deltas that follow it);
//   * and if the grace HAD expired, the guest would instead be told the match
//     was over — the leave spec pins that branch, so this pair of specs covers
//     both outcomes the issue asks for.
// ══════════════════════════════════════════════════════════════════════════

test("a dropped guest link re-attaches inside the room's grace and catches up", async ({ browser }, testInfo) => {
  const pair = await pairUp(browser);
  const { host, guest } = pair;
  try {
    await startMatch(pair);
    await Promise.all([expectBooted(host), expectBooted(guest)]);
    await playSetup(pair);

    const depotsBefore = (await readState(guest)).harvesters.length;

    // The drop, and — in the same instant — a host action the guest must end up
    // holding. Whatever the ordering turns out to be, the guest's world has to
    // agree with the host's afterwards; that is the convergence claim.
    await fundDepots(host);
    const depotSearch: FindSpotOptions = { kind: "depot", avoid: 6 };
    const spot = await host.page.evaluate(findSpot, depotSearch);
    expect(spot, "the host has a spare depot tile").not.toBeNull();
    const site = { tx: spot![0], ty: spot![1] };

    const dropped = await guest.page.evaluate(dropRoomSocket);
    expect(dropped, "the guest's room socket was closed underneath it").toBe(true);
    const hostPlaced = await host.page.evaluate(placeDepot, site);
    expect(hostPlaced, "the host kept playing while the guest was away").toBe(true);

    // The SDK re-attaches: a new socket, and the room's own confirmation that
    // this is the SAME seat resumed — not a fresh join (which the locked room
    // could not even accept).
    await expect.poll(() => wireHas(guest, "room:reconnected"), {
      message: "the guest's SDK re-attached to the room inside the grace",
      timeout: MP_REATTACH_MS,
    }).toBe(true);
    expect(wireHas(guest, "reject"), "the returning guest was not turned away").toBe(false);
    expect(wireHas(guest, "room:playerLeft"), "and the guest was not evicted").toBe(false);

    // Host's side of the same boundary: it saw the drop, never a departure.
    await expect.poll(() => wireHas(host, "room:playerDisconnected"), {
      message: "the host saw the guest's link drop",
      timeout: MP_REATTACH_MS,
    }).toBe(true);
    expect(wireHas(host, "room:playerLeft"), "the host never saw the seat evicted").toBe(false);

    // Convergence: the guest holds the depot the host raised while it was away,
    // and the two worlds agree about the tile.
    await expect.poll(async () => (await readState(guest)).harvesters.length, {
      message: "the returning guest caught up with the host's world",
    }).toBe(depotsBefore + 1);
    const [hostTile, guestTile] = await Promise.all([
      host.page.evaluate(tileOccupants, site),
      guest.page.evaluate(tileOccupants, site),
    ]);
    expect(hostTile.depots, "the host's depot is on the tile").toEqual(["you"]);
    expect(guestTile.depots, "and the guest sees it, mirrored").toEqual(["ai"]);

    // Nobody was told the match ended: a drop inside the grace is not a leave.
    await expectNoEndedMatch(host);
    await expectNoEndedMatch(guest);
    expect(host.errors, "no uncaught errors on the host page").toEqual([]);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});
