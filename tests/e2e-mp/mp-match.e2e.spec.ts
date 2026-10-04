import { test, expect, type Browser } from "@playwright/test";
import {
  attachLogs, bankExchange, clickReset, contestedDepotSite, expectBooted, expectPurse, expectToast,
  fundDepots, pairUp, placeDepot, planValid, playSetup, readState, setPurse, setRivalRes,
  startMatch, tileOccupants, type PlanSite,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// #132 — the things only a REAL room can prove about a match in progress.
//
// A simulated room can replay a fixed script; it cannot make two independent
// clients disagree. Every test here drives a real action on one seat and reads
// the consequence off the OTHER seat's own world — through the sidecar, the
// production adapter and the room bundle, with no mock in the path.
//
//   * bank     — the guest's Exchange reaches the host as an INTENT, and the
//                host's answer moves both purses by exactly the rate and
//                nothing else (the offer board's replacement, L11 / #226).
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

// Green baseline (2026-10-01): the bank has charged 3:1 since L17 (#245, `BANK_RATE` in src/iso/bank.ts); this spec
// still said 4:1. Stale expectation after a deliberate rebalance, not a regression.
const BANK_RATE = 3;

test("a guest's Exchange reaches the host and both purses move at the bank's rate", async ({ browser }, testInfo) => {
  const pair = await matchedPair(browser);
  const { host, guest } = pair;
  try {
    // L11 (#226): the offer board is gone; the BANK is the one exchange left,
    // and it may not skip a rung of L5's tree. This pair trades rung-0 stock
    // (3 Wood → 1 Grain), so the gate lets it through on both seats. The host
    // funds its AUTHORITATIVE copy of the guest's bag first — `setRivalRes`
    // writes the very object the guest's intent is settled against.
    await host.page.evaluate(setPurse, { cargo: "wood", amount: 12 });
    await host.page.evaluate(setRivalRes, { cargo: "wood", amount: 12 });
    // The guest's own world learns of it through the host's delta, so its
    // Exchange is affordable when it is pressed.
    await expectPurse(guest, "wood", 12);
    const before = await readState(host);
    const guestWood = before.rivalPurse.wood ?? 0;
    const guestGrain = before.rivalPurse.grain ?? 0;
    const hostWood = before.purse.wood ?? 0;
    const hostGrain = before.purse.grain ?? 0;

    // Press Exchange on the GUEST's Bank pane. A guest's press is a REQUEST:
    // it changes nothing locally until the host's answer arrives.
    await bankExchange(guest, "wood", "grain");

    // The host validates it against the GUEST seat's own record and applies
    // the rate there: 3 Wood → 1 Grain, and nothing else.
    await expect.poll(async () => (await readState(host)).rivalPurse.wood,
      { message: "the host's view of the guest's wood" }).toBe(guestWood - BANK_RATE);
    await expect.poll(async () => (await readState(host)).rivalPurse.grain,
      { message: "the host's view of the guest's grain" }).toBe(guestGrain + 1);
    // The HOST's own bag is untouched by the guest's exchange.
    const after = await readState(host);
    expect(after.purse.wood, "the host's own wood").toBe(hostWood);
    expect(after.purse.grain, "the host's own grain").toBe(hostGrain);

    // …and the guest's own purse follows that answer, to the digit.
    await expectPurse(guest, "wood", guestWood - BANK_RATE);
    await expectPurse(guest, "grain", guestGrain + 1);

    // Both worlds agree about the guest's bag: the host's copy is the guest's.
    const guestSeen = await readState(guest);
    expect(after.rivalPurse.wood, "the host's view of the guest's wood").toBe(guestSeen.purse.wood);
    expect(after.rivalPurse.grain, "the host's view of the guest's grain").toBe(guestSeen.purse.grain);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});

// E2E-GREEN-1 (#666): the suite's per-test wall is `BOOT_BUDGET * 4` = 360 s
// (playwright.multiplayer.config.ts), and this two-seat re-roll measured the
// full 6.0 m on both attempts of run 37161647680 before the wall cut it off —
// the same spec passed on the push run of that very commit. It is a budget,
// not a behaviour: the steps and assertions are untouched.
test("a guest's Reset re-rolls its seat's board on the host and spares the host's own board", async ({ browser }, testInfo) => {
  test.setTimeout(540_000);
  const pair = await matchedPair(browser);
  const { host, guest } = pair;
  try {
    const beforeGuest = await readState(guest);
    const beforeHost = await readState(host);
    // Each seat holds its own opening board. L15 (#230) took boards off the wire (the board is
    // tuning-only), so a seat's copy of the OTHER board is no longer mirrored — the independence
    // this test proves is now total: a Reset on one seat cannot touch the other's board at all.
    expect(beforeHost.boardSig.length).toBeGreaterThan(0);
    expect(beforeGuest.boardSig.length).toBeGreaterThan(0);

    // The guest presses ♻ Reset — the shipped button, not a test hook.
    await clickReset(guest);

    // Green baseline (2026-10-01): since L15 (#230) boards are off the wire and MP-05 keeps a guest's
    // local board inert ("guests never mutate their local board"), so the guest's OWN copy no longer
    // re-deals and no "Fresh neutral board" toast reaches it. The reset is a typed intent the HOST
    // runs on the guest seat's AUTHORITATIVE board (`rivalPlant`), so that is where it shows: the
    // guest is told its request went out, and the host's copy of the guest's board is re-dealt.
    await expectToast(guest, /Requesting Processing Plant reset/);
    await expect.poll(async () => (await readState(host)).rivalBoardSig, {
      message: "the host's authoritative copy of the guest's board is re-dealt",
    }).not.toBe(beforeHost.rivalBoardSig);

    // …and the host's own board never moved. This is the independence claim: a board-local action
    // on one seat may not deal the other seat's tiles.
    expect((await readState(host)).boardSig, "the host's own board is untouched").toBe(beforeHost.boardSig);
    expect((await readState(guest)).boardSig, "the guest's local board stays inert (MP-05)").toBe(beforeGuest.boardSig);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});

// E2E-GREEN-1 (#666): same class as the re-roll above — 5.1 m of the 6.0 m
// wall on the loaded run, 51 s of headroom. Same budget for the same reason:
// two seats, a live room, software GL.
test("two seats clicking one tile at the same instant settle on a single depot", async ({ browser }, testInfo) => {
  test.setTimeout(540_000);
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
    const hostTile = await host.page.evaluate(tileOccupants, site!);
    expect(hostTile.depots, "the winner holds the tile on the host's side").toEqual([hostPlaced ? "you" : "ai"]);
    // Green baseline (2026-10-01): the guest learns of the depot through the host's NEXT delta, which on a
    // loaded runner lands after the host's own world shows it, so this is a poll, not a one-shot read
    // (the assertion itself is unchanged).
    await expect.poll(async () => (await guest.page.evaluate(tileOccupants, site!)).depots, {
      message: "and on the guest's side, mirrored",
    }).toEqual([hostPlaced ? "ai" : "you"]);

    // One depot total, on both seats: the race did not double-book the tile.
    expect((await readState(host)).harvesters.length, "exactly one depot was added").toBe(before + 1);
    await expect.poll(async () => (await readState(guest)).harvesters.length, { message: "and the guest agrees" }).toBe(before + 1);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});
