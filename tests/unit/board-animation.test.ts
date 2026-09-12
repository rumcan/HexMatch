import { afterEach, describe, expect, it, vi } from "vitest";
import { Board, BOARD_ANIMATION_MS } from "../../src/game/board";
import { mulberry32, setRng } from "../../src/game/config";

function boardFixture() {
  vi.useFakeTimers();
  setRng(mulberry32(1234));
  const board = new Board();
  for (const g of board.gems()) g.res = (g.r + g.c) % 2 ? "ore" : "wheat";
  // Avoid unrelated automatic reshuffles at the end of these timing tests.
  vi.spyOn(board, "hasMove").mockReturnValue(true);
  return board;
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("faster processing-plant animation", () => {
  it("unlocks a single-match swap in 280ms instead of 560ms", async () => {
    const board = boardFixture();
    board.grid[0][0]!.res = board.grid[0][1]!.res = board.grid[1][2]!.res = "wood";
    const changed = vi.fn(); board.onChange = changed;
    // Resolve the real first match, but isolate timing from random refill cascades.
    const find = board.findGroups.bind(board);
    vi.spyOn(board, "findGroups")
      .mockImplementationOnce(find).mockImplementationOnce(find).mockReturnValue([]);
    const swap = board.trySwap(0, 2, 1, 2, 0);
    expect(board.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.swap - 1);
    expect(changed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(board.grid[0][0]).toBeNull(); // match cleared after the swap finishes
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.clear);
    expect(board.grid[0][0]).not.toBeNull(); // refill begins after the clear animation
    await vi.advanceTimersByTimeAsync(BOARD_ANIMATION_MS.fall - 1);
    expect(board.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await swap;
    expect(board.busy).toBe(false);
    expect(BOARD_ANIMATION_MS.swap + BOARD_ANIMATION_MS.clear + BOARD_ANIMATION_MS.fall).toBe(280);
  });

  it("finishes a rejected swap and its return animation in 160ms", async () => {
    const board = boardFixture();
    vi.spyOn(board, "findGroups").mockReturnValue([]);
    const a = board.grid[0][0], b = board.grid[0][1];
    const swap = board.trySwap(0, 0, 0, 1, 0);
    await vi.advanceTimersByTimeAsync(80);
    expect(board.grid[0][0]).toBe(a); expect(board.grid[0][1]).toBe(b);
    expect(board.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(79);
    expect(board.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await swap;
    expect(board.busy).toBe(false);
  });

  it("finishes a bomb swap in 325ms when no follow-up matches form", async () => {
    const board = boardFixture();
    board.grid[0][0]!.special = "bomb";
    vi.spyOn(board, "findGroups").mockReturnValue([]);
    const swap = board.trySwap(0, 0, 0, 1, 0);
    await vi.advanceTimersByTimeAsync(324);
    expect(board.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await swap;
    expect(board.busy).toBe(false);
  });
});
