// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Board } from "../../src/game/board";
import { createOriginalUi } from "../../src/game/ui";
import { createIsoMarket, emptyBag } from "../../src/iso/market";
import { mulberry32, setRng } from "../../src/game/config";

function setup() {
  vi.useFakeTimers();
  setRng(mulberry32(1234));
  const board = new Board();
  // Isolate the painted match from incidental crosses in the random fill.
  for (const g of board.gems()) g.res = (g.r + g.c) % 2 ? "wood" : "wheat";
  const market = createIsoMarket([{ i: 0, id: "you", name: "You", human: true, purse: emptyBag() }]);
  const ui = createOriginalUi(board, market, market.players[0], {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(), onBlackAction: vi.fn(),
  });
  document.body.append(ui.el);
  board.onCrossChoice = ui.crossPick;
  return { board, ui };
}
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
const button = (panel: Element, selector: string) => panel.querySelector<HTMLButtonElement>(selector)!;
function isolatePass(board: Board) {
  const groups = board.findGroups();
  vi.spyOn(board, "findGroups").mockReturnValueOnce(groups).mockReturnValue([]);
  vi.spyOn(board, "hasMove").mockReturnValue(true);
}

describe("cross resource confirmation", () => {
  it.each(["holy", "broken"] as const)("keeps a %s choice and the board paused beyond both old deadlines", async (kind) => {
    const { board, ui } = setup();
    const cells = [[2, 1], [2, 2], [2, 3], [1, 2], [3, 2]];
    if (kind === "holy") cells.push([4, 2]);
    for (const [r, c] of cells) board.grid[r][c]!.res = "sheep";
    isolatePass(board);
    const bonus = vi.fn(); board.onBonus = bonus;
    const settled = board.settle();
    const panel = ui.el.querySelector(".cross-pick")!;
    const confirm = button(panel, ".cross-pick-confirm");
    const wood = button(panel, '[data-cargo="wood"]');
    const stone = button(panel, '[data-cargo="stone"]');
    wood.click();
    confirm.click(); // disabled: incomplete allocations cannot dismiss the panel
    await vi.advanceTimersByTimeAsync(60_000);
    document.body.click();
    expect(ui.el.querySelector(".cross-pick")).toBe(panel);
    expect(board.busy).toBe(true);
    expect(bonus).not.toHaveBeenCalled();
    expect(wood.dataset.n).toBe("1");
    const picks = kind === "holy" ? 6 : 3;
    for (let i = 1; i < picks; i++) stone.click();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(bonus).not.toHaveBeenCalled(); // full allocation also needs confirmation
    expect(ui.el.querySelector(".cross-pick")).toBe(panel);
    confirm.click(); confirm.click(); // stale buttons cannot pay twice
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    expect(bonus).toHaveBeenCalledTimes(picks);
    expect(bonus.mock.calls.map(([res]) => res)).toEqual(["wood", ...Array(picks - 1).fill("brick")]);
    expect(ui.el.querySelector(".cross-pick")).toBeNull();
    expect(board.busy).toBe(false);
  });

  it("queues another choice without replacing or auto-answering the first", async () => {
    const { ui } = setup();
    const first = vi.fn(), second = vi.fn();
    ui.crossPick("broken", 3, first);
    const panel = ui.el.querySelector(".cross-pick")!;
    button(panel, '[data-cargo="wood"]').click();
    ui.crossPick("holy", 6, second);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ui.el.querySelectorAll(".cross-pick")).toHaveLength(1);
    expect(ui.el.querySelector(".cross-pick")).toBe(panel);
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    button(panel, '[data-cargo="stone"]').click();
    button(panel, '[data-cargo="stone"]').click();
    button(panel, ".cross-pick-confirm").click();
    expect(first).toHaveBeenCalledExactlyOnceWith(["wood", "brick", "brick"]);
    const next = ui.el.querySelector(".cross-pick")!;
    expect(next).not.toBe(panel);
    expect(next.querySelector(".cross-pick-count")!.textContent).toBe("0 / 6 spent");
    for (let i = 0; i < 6; i++) button(next, '[data-cargo="wood"]').click();
    button(next, ".cross-pick-confirm").click();
    expect(second).toHaveBeenCalledExactlyOnceWith(Array(6).fill("wood"));
    expect(ui.el.querySelector(".cross-pick")).toBeNull();
  });

  it.each([0, 1, 2, 3])("recognizes a T rotated %i quarter turns as broken, with three picks and no L bonus", async (turns) => {
    const { board, ui } = setup();
    for (const [x0, y0] of [[-1, 0], [0, 0], [1, 0], [0, 1], [0, 2]]) {
      let x = x0, y = y0;
      for (let i = 0; i < turns; i++) [x, y] = [-y, x];
      board.grid[3 + y][3 + x]!.res = "sheep";
    }
    isolatePass(board);
    const fx = vi.fn(), bonus = vi.fn();
    board.onFx = fx; board.onBonus = bonus;
    const settled = board.settle();
    expect(fx).toHaveBeenCalledWith("bcross", 3, 3);
    expect(fx.mock.calls.some(([type]) => type === "cross")).toBe(false);
    const panel = ui.el.querySelector(".cross-pick.broken")!;
    expect(panel).not.toBeNull();
    for (let i = 0; i < 3; i++) button(panel, '[data-cargo="wood"]').click();
    button(panel, ".cross-pick-confirm").click();
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    expect(bonus.mock.calls).toEqual(Array.from({ length: 3 }, () => ["wood", 1, "BROKEN CROSS"]));
  });
});
