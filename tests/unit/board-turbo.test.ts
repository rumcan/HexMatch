// @vitest-environment jsdom
// Issue #152 — the board must keep up with the user. While a valid move is
// queued behind the running animation, every wait collapses to
// FAST_ANIMATION_MS and cleared gems leave a fading `.gem-remnant` behind.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Board, BOARD_ANIMATION_MS, FAST_ANIMATION_MS } from "../../src/game/board";
import { createOriginalUi } from "../../src/game/ui";
import { createIsoMarket, emptyBag } from "../../src/iso/market";
import { mulberry32, setRng } from "../../src/game/config";

/** Checkerboard: no accidental matches; every painted match is deliberate. */
function boardFixture() {
  vi.useFakeTimers();
  setRng(mulberry32(1234));
  const board = new Board();
  for (const g of board.gems()) g.res = (g.r + g.c) % 2 ? "ore" : "wheat";
  vi.spyOn(board, "hasMove").mockReturnValue(true);
  // Refill alternates two colours that appear nowhere else, so a refill can
  // never chain into a second cascade pass by chance.
  let n = 0;
  const cycle = ["brick", "gold", "ore"] as const;
  vi.spyOn(board, "randRes").mockImplementation(() => cycle[n++ % 3]);
  return board;
}
/** Paint a 3-match on row `r` completed by swapping (r, c+2) up from (r+1, c+2).
 *  The gem swapped DOWN is gold — a colour the checkerboard never holds — so
 *  the swap itself cannot form a second, accidental line. */
function paintMove(board: Board, r: number, c: number, res: "wood" | "sheep") {
  board.grid[r][c]!.res = board.grid[r][c + 1]!.res = board.grid[r + 1][c + 2]!.res = res;
  board.grid[r][c + 2]!.res = "gold";
  return { r1: r, c1: c + 2, r2: r + 1, c2: c + 2 };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("issue #152 — turbo catch-up while moves are queued", () => {
  it("runs at FAST_ANIMATION_MS when a queued move is a valid match, then reverts", async () => {
    const board = boardFixture();
    const turbo = vi.fn(); board.onTurbo = turbo;
    const a = paintMove(board, 0, 0, "wood");
    const b = paintMove(board, 5, 3, "sheep");
    const first = board.trySwap(a.r1, a.c1, a.r2, a.c2, 0);
    expect(board.busy).toBe(true);
    board.trySwap(b.r1, b.c1, b.r2, b.c2, 0); // queued while busy
    expect(board.queuedMoves).toBe(1);
    expect(board.turbo).toBe(true);

    // The first swap's wait was scheduled BEFORE the queue existed, so it
    // still takes the standard swap time; every wait after it is turbo.
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.swap);
    expect(board.grid[0][0]).toBeNull(); // match cleared
    await vi.advanceTimersByTimeAsync(FAST_ANIMATION_MS.clear);
    expect(board.grid[0][0]).not.toBeNull(); // refilled at turbo speed
    await vi.advanceTimersByTimeAsync(FAST_ANIMATION_MS.fall);
    // First settle is over; the queued swap has been taken at once.
    expect(board.queuedMoves).toBe(0);
    expect(board.grid[5][5]!.res).toBe("sheep");
    expect(turbo).toHaveBeenNthCalledWith(1, true);

    // Nothing queued any more → the second move's waits are standard again.
    await vi.advanceTimersByTimeAsync(FAST_ANIMATION_MS.swap);
    expect(board.grid[5][3]).not.toBeNull(); // not yet cleared at turbo pace
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.swap - FAST_ANIMATION_MS.swap);
    expect(board.grid[5][3]).toBeNull();
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.clear + BOARD_ANIMATION_MS.fall);
    await first;
    expect(board.busy).toBe(false);
    expect(turbo).toHaveBeenLastCalledWith(false);
  });

  it("does not accelerate for a queued swap that is a dud", async () => {
    const board = boardFixture();
    const a = paintMove(board, 0, 0, "wood");
    const swap = board.trySwap(a.r1, a.c1, a.r2, a.c2, 0);
    board.trySwap(6, 6, 6, 7, 0); // both present, no match → not turbo
    expect(board.turbo).toBe(false);
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.swap);
    expect(board.grid[0][0]).toBeNull();
    await vi.advanceTimersByTimeAsync(FAST_ANIMATION_MS.clear);
    expect(board.grid[0][0]).toBeNull(); // still clearing at standard pace
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.clear - FAST_ANIMATION_MS.clear);
    expect(board.grid[0][0]).not.toBeNull();
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.fall + BOARD_ANIMATION_MS.swap * 2);
    await swap;
    expect(board.busy).toBe(false);
  });

  it("credits every queued match exactly once at turbo speed", async () => {
    const board = boardFixture();
    const harvested: [string, number][] = [];
    board.onHarvest = (res, n) => { harvested.push([res, n]); };
    board.onToken = () => true;
    const a = paintMove(board, 0, 0, "wood");
    const b = paintMove(board, 5, 3, "sheep");
    board.grid[0][0]!.tier = 1;
    board.grid[5][3]!.tier = 2;
    const p = board.trySwap(a.r1, a.c1, a.r2, a.c2, 0);
    board.trySwap(b.r1, b.c1, b.r2, b.c2, 0);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(harvested).toEqual([["wood", 1], ["sheep", 2]]);
    expect(board.busy).toBe(false);
  });
});

describe("issue #152 — fading remnants in the DOM", () => {
  function uiFixture() {
    const board = boardFixture();
    const market = createIsoMarket([{ i: 0, id: "you", name: "You", human: true, purse: emptyBag() }]);
    const ui = createOriginalUi(board, market, market.players[0], {
      onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(), onBlackAction: vi.fn(),
    });
    document.body.append(ui.el);
    board.onChange = ui.renderBoard;
    return { board, ui };
  }

  it("leaves a .gem-remnant on each cleared cell in turbo mode and snaps the CSS timing", async () => {
    const { board, ui } = uiFixture();
    const a = paintMove(board, 0, 0, "wood");
    const b = paintMove(board, 5, 3, "sheep");
    const idsA = [board.grid[0][0]!.id, board.grid[0][1]!.id, board.grid[1][2]!.id];
    const p = board.trySwap(a.r1, a.c1, a.r2, a.c2, 0);
    board.trySwap(b.r1, b.c1, b.r2, b.c2, 0);
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.swap);
    expect(ui.el.classList.contains("turbo")).toBe(true);
    expect(ui.el.style.getPropertyValue("--gem-move-ms")).toBe(`${FAST_ANIMATION_MS.swap}ms`);
    const ghosts = ui.el.querySelectorAll(".gem-remnant");
    expect(ghosts.length).toBe(3);
    for (const g of ghosts) expect(g.getAttribute("aria-hidden")).toBe("true");
    // the live gems are gone at once — no `.gone` lingering under the refill
    for (const id of idsA) expect(ui.el.querySelector(`.gem[data-id="${id}"]`)).toBeNull();
    await vi.advanceTimersByTimeAsync(400);
    expect(ui.el.querySelectorAll(".gem-remnant").length).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
    expect(ui.el.classList.contains("turbo")).toBe(false);
    expect(ui.el.style.getPropertyValue("--gem-move-ms")).toBe(`${BOARD_ANIMATION_MS.swap}ms`);
  });

  it("keeps the standard shrink-out (no remnant) when nothing is queued", async () => {
    const { board, ui } = uiFixture();
    const a = paintMove(board, 0, 0, "wood");
    const p = board.trySwap(a.r1, a.c1, a.r2, a.c2, 0);
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.swap);
    expect(ui.el.querySelectorAll(".gem-remnant").length).toBe(0);
    expect(ui.el.querySelectorAll(".gem.gone").length).toBe(3);
    await vi.advanceTimersByTimeAsync(2000);
    await p;
  });
});
