import { test, expect, type Page } from "@playwright/test";
import {
  attachLogs, expectBooted, expectInPlay, pairUp, playSetup, press, startMatch, toStartScreen,
  type Side,
} from "./mp-harness";

// ══════════════════════════════════════════════════════════════════════════
// B6 (#251) — multiplayer battles, two browsers, the real room:
//
//   • the host challenges, the guest accepts (a friendly duel through the
//     `__iso.offerDuel` door — no contested industry to engineer), and the
//     two seats play it to a finish by CLICKING gems on their own screens;
//   • after every move both screens show the SAME board, health and turn
//     (the host validates, the guest replays seed + move log);
//   • a guest refresh mid-battle rejoins the same battle state (the full
//     save rides the snapshot).
// ══════════════════════════════════════════════════════════════════════════

interface Probe {
  offer: unknown;
  seat: 0 | 1;
  moves: number;
  turn: 0 | 1 | null;
  over: boolean | null;
  winner: 0 | 1 | null;
  board: string | null;
  health: number[] | null;
}

type IsoWin = { __iso: {
  mpBattle: Probe;
  offerDuel(rules?: Record<string, number>): boolean;
  acceptChallenge(): boolean;
  battleScreen: { battle: { board: { findMove(): number[] | null } } } | null;
} };

const probe = (page: Page): Promise<Probe> =>
  page.evaluate(() => (window as unknown as IsoWin).__iso.mpBattle);

/** The seat on turn clicks one legal swap on its OWN screen (the real UI). */
async function clickMove(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const iso = (window as unknown as IsoWin).__iso;
    const grid = document.querySelector(".battle-card .grid");
    if (!iso.battleScreen || !grid || grid.classList.contains("locked")) return false;
    const mv = iso.battleScreen.battle.board.findMove();
    if (!mv) return false;
    const click = (r: number, c: number) =>
      (document.querySelector(`.battle-card .gem[data-r="${r}"][data-c="${c}"]`) as HTMLElement | null)?.click();
    click(mv[0], mv[1]);
    click(mv[2], mv[3]);
    return true;
  });
}

/** Both screens agree: same log length, board, health, turn, verdict. */
async function expectSameBattle(host: Side, guest: Side, what: string): Promise<Probe> {
  let last: [Probe, Probe] | null = null;
  await expect.poll(async () => {
    last = [await probe(host.page), await probe(guest.page)];
    const [h, g] = last;
    return h.board !== null && JSON.stringify({ ...h, seat: 0, offer: null })
      === JSON.stringify({ ...g, seat: 0, offer: null });
  }, { message: `both seats see the same battle ${what}`, timeout: 30_000 }).toBe(true);
  return last![0];
}

test("B6: two browsers challenge, play and finish a battle on the same board; a refresh rejoins it", async ({ browser }, testInfo) => {
  test.setTimeout(720_000);
  const pair = await pairUp(browser);
  const { host, guest } = pair;
  try {
    await startMatch(pair);
    await Promise.all([expectBooted(host), expectBooted(guest)]);
    await playSetup(pair);

    // ── challenge → accept ──
    const offered = await host.page.evaluate(
      () => (window as unknown as IsoWin).__iso.offerDuel({ turnLimit: 8, turnMs: 60_000 }),
    );
    expect(offered, "the host's challenge went out").toBe(true);
    await expect.poll(async () => (await probe(guest.page)).offer !== null,
      { message: "the guest sees the challenge", timeout: 30_000 }).toBe(true);
    expect(await guest.page.evaluate(() => (window as unknown as IsoWin).__iso.acceptChallenge()),
      "the guest's accept was sent").toBe(true);
    for (const side of [host, guest]) {
      await expect(side.page.locator(".battle-root"), `${side.name}'s battle screen opens`).toBeVisible({ timeout: 30_000 });
    }
    let state = await expectSameBattle(host, guest, "at the opening");
    expect(state.moves).toBe(0);

    // ── play: whoever is on turn clicks; both boards agree after every move ──
    let rejoined = false;
    for (let i = 0; i < 60 && !state.over; i++) {
      const onTurn = state.turn === 0 ? host : guest;
      const before = state.moves;
      await expect.poll(() => clickMove(onTurn.page),
        { message: `${onTurn.name} can move (move ${before + 1})`, timeout: 30_000 }).toBe(true);
      await expect.poll(async () => (await probe(host.page)).moves,
        { message: `the host took move ${before + 1}`, timeout: 30_000 }).toBeGreaterThan(before);
      state = await expectSameBattle(host, guest, `after move ${before + 1}`);

      // ── mid-battle: the guest refreshes and walks back into the SAME duel ──
      if (!rejoined && state.moves >= 3 && !state.over) {
        rejoined = true;
        const atDrop = state;
        await guest.page.reload();
        await toStartScreen(guest);
        await expect(guest.page.getByRole("heading", { name: /match in progress/i }))
          .toBeVisible({ timeout: 30_000 });
        await press(guest.page.getByRole("button", { name: /Rejoin the match/ }), "Rejoin the match");
        await press(guest.page.getByRole("button", { name: /^Play$/ }), "Play");
        await expectInPlay(guest);
        await expect(guest.page.locator(".battle-root"), "the rejoined guest is back in the battle")
          .toBeVisible({ timeout: 60_000 });
        state = await expectSameBattle(host, guest, "after the refresh");
        expect(state.moves, "the rejoin resumed the same log").toBe(atDrop.moves);
        expect(state.board, "the rejoin restored the same board").toBe(atDrop.board);
      }
    }
    expect(rejoined, "the refresh step ran").toBe(true);
    expect(state.over, "the battle finished").toBe(true);

    // ── the result: both see the same verdict, from their own side ──
    for (const side of [host, guest]) {
      await expect(side.page.locator(".battle-verdict"), `${side.name} sees the result`)
        .toHaveText(/VICTORY|DEFEAT|DRAW/, { timeout: 15_000 });
    }
    const hv = await host.page.locator(".battle-verdict").textContent();
    const gv = await guest.page.locator(".battle-verdict").textContent();
    const flip: Record<string, string> = { VICTORY: "DEFEAT", DEFEAT: "VICTORY", DRAW: "DRAW" };
    expect(flip[hv!.trim()], "the verdicts mirror each other").toBe(gv!.trim());
    for (const side of [host, guest]) {
      await side.page.locator(".battle-continue").click();
      await expect(side.page.locator(".battle-root")).toHaveCount(0);
    }
    expect(host.errors, "no uncaught errors on the host page").toEqual([]);
    expect(guest.errors, "no uncaught errors on the guest page").toEqual([]);
  } finally {
    await attachLogs(testInfo, host, guest);
    await host.ctx.close();
    await guest.ctx.close();
  }
});
