// @vitest-environment jsdom
// Issue #162 — drag-and-drop swaps commit on RELEASE, never mid-gesture.
// A drag past the threshold must not call onSwap until pointerup; a short
// release, a cancel, a wall or a second finger springs back with no move.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Board } from "../../src/game/board";
import { CELL } from "../../src/game/config";
import { createOriginalUi } from "../../src/game/ui";
import { createIsoMarket, emptyBag } from "../../src/iso/market";
import { mulberry32, setRng } from "../../src/game/config";

function uiFixture() {
  setRng(mulberry32(99));
  const board = new Board();
  // No blockers anywhere: every neighbour of a drag origin is swappable
  // unless a test chains one deliberately.
  for (const g of board.gems()) { g.block = false; g.special = null; }
  const market = createIsoMarket([{ i: 0, id: "you", name: "You", human: true, purse: emptyBag() }]);
  const hooks = {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(),
    onReset: vi.fn(), onBlackAction: vi.fn(),
  };
  const ui = createOriginalUi(board, market, market.players[0], hooks);
  document.body.append(ui.el);
  board.onChange = ui.renderBoard;
  const grid = ui.el.querySelector("#iso-gems") as HTMLElement;
  // jsdom lays nothing out — pin the board's box so client px map to cells.
  const W = CELL * board.w, H = CELL * board.h;
  vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: W, bottom: H, width: W, height: H,
    toJSON: () => ({}),
  } as DOMRect);
  return { board, ui, grid, hooks };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const center = (r: number, c: number) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });

function pointer(type: string, x: number, y: number, init: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true, cancelable: true, button: 0,
    pointerId: 1, pointerType: "mouse", isPrimary: true,
    clientX: x, clientY: y, ...init,
  });
}

function gemEl(ui: { el: HTMLElement }, board: Board, r: number, c: number): HTMLElement {
  const g = board.grid[r][c];
  if (!g) throw new Error(`no gem at ${r},${c}`);
  const el = ui.el.querySelector(`.gem[data-id="${g.id}"]`);
  if (!el) throw new Error(`no element for gem ${g.id}`);
  return el as HTMLElement;
}

const click = () => new MouseEvent("click", { bubbles: true });

describe("issue #162 — drag-and-drop commits on release", () => {
  it("picks the gem up on press, previews the target, and swaps only on release", () => {
    const { board, ui, grid, hooks } = uiFixture();
    const from = center(2, 2);
    grid.dispatchEvent(pointer("pointerdown", from.x, from.y));
    expect(gemEl(ui, board, 2, 2).classList.contains("dragging")).toBe(true);

    // Past half a cell — the target previews, but NOTHING commits yet.
    grid.dispatchEvent(pointer("pointermove", from.x + CELL * 0.6, from.y));
    expect(hooks.onSwap).not.toHaveBeenCalled();
    expect(gemEl(ui, board, 2, 3).classList.contains("yielding")).toBe(true);

    window.dispatchEvent(pointer("pointerup", from.x + CELL * 0.6, from.y));
    expect(hooks.onSwap).toHaveBeenCalledTimes(1);
    expect(hooks.onSwap).toHaveBeenCalledWith(2, 2, 2, 3);
  });

  it("springs back with no move when released short of the threshold", () => {
    const { board, ui, grid, hooks } = uiFixture();
    const from = center(2, 2);
    grid.dispatchEvent(pointer("pointerdown", from.x, from.y));
    grid.dispatchEvent(pointer("pointermove", from.x + CELL * 0.3, from.y));
    window.dispatchEvent(pointer("pointerup", from.x + CELL * 0.3, from.y));
    expect(hooks.onSwap).not.toHaveBeenCalled();
    // Both gems glide home and keep no trace of the gesture.
    for (const [r, c] of [[2, 2], [2, 3]] as const) {
      const el = gemEl(ui, board, r, c);
      expect(el.style.translate).toBe("");
      expect(el.classList.contains("dragging")).toBe(false);
      expect(el.classList.contains("yielding")).toBe(false);
    }
  });

  it("never commits on pointercancel, however far the pull", () => {
    const { board, ui, grid, hooks } = uiFixture();
    const from = center(2, 2);
    grid.dispatchEvent(pointer("pointerdown", from.x, from.y));
    grid.dispatchEvent(pointer("pointermove", from.x + CELL * 0.9, from.y));
    window.dispatchEvent(pointer("pointercancel", from.x + CELL * 0.9, from.y));
    expect(hooks.onSwap).not.toHaveBeenCalled();
    expect(gemEl(ui, board, 2, 2).style.translate).toBe("");
    expect(ui.el.querySelector(".gem.dragging")).toBeNull();
    expect(ui.el.querySelector(".gem.yielding")).toBeNull();
  });

  it("switches the previewed target cleanly when the hand changes direction", () => {
    const { board, ui, grid, hooks } = uiFixture();
    const from = center(2, 2);
    grid.dispatchEvent(pointer("pointerdown", from.x, from.y));
    grid.dispatchEvent(pointer("pointermove", from.x + CELL * 0.6, from.y));
    expect(gemEl(ui, board, 2, 3).classList.contains("yielding")).toBe(true);
    // Down now — the old target lets go, the new one previews, no diagonal.
    grid.dispatchEvent(pointer("pointermove", from.x, from.y + CELL * 0.6));
    const old = gemEl(ui, board, 2, 3);
    expect(old.classList.contains("yielding")).toBe(false);
    expect(old.style.translate).toBe("");
    expect(gemEl(ui, board, 3, 2).classList.contains("yielding")).toBe(true);
    expect(gemEl(ui, board, 2, 2).style.translate).toBe(`0px ${CELL * 0.6 * 0.8}px`);
    window.dispatchEvent(pointer("pointerup", from.x, from.y + CELL * 0.6));
    expect(hooks.onSwap).toHaveBeenCalledWith(2, 2, 3, 2);
  });

  it("rubber-bands against a chained cell and never commits into it", () => {
    const { board, ui, grid, hooks } = uiFixture();
    board.grid[2][3]!.block = true;
    const from = center(2, 2);
    grid.dispatchEvent(pointer("pointerdown", from.x, from.y));
    grid.dispatchEvent(pointer("pointermove", from.x + CELL * 0.9, from.y));
    // A wall offers no target — the gem barely leans, then springs home.
    expect(ui.el.querySelector(".gem.yielding")).toBeNull();
    window.dispatchEvent(pointer("pointerup", from.x + CELL * 0.9, from.y));
    expect(hooks.onSwap).not.toHaveBeenCalled();
    expect(gemEl(ui, board, 2, 2).style.translate).toBe("");
  });

  it("cancels the gesture when the pointer leaves the board", () => {
    const { ui, grid, hooks } = uiFixture();
    const from = center(0, 0);
    grid.dispatchEvent(pointer("pointerdown", from.x, from.y));
    grid.dispatchEvent(pointer("pointermove", from.x, from.y - CELL * 0.9));
    window.dispatchEvent(pointer("pointerup", from.x, from.y - CELL * 0.9));
    expect(hooks.onSwap).not.toHaveBeenCalled();
    expect(ui.el.querySelector(".gem.dragging")).toBeNull();
  });

  it("voids the drag when a second finger lands", () => {
    const { ui, grid, hooks } = uiFixture();
    const from = center(2, 2);
    grid.dispatchEvent(pointer("pointerdown", from.x, from.y, { pointerId: 1 }));
    grid.dispatchEvent(pointer("pointermove", from.x + CELL * 0.9, from.y, { pointerId: 1 }));
    const other = center(4, 4);
    grid.dispatchEvent(pointer("pointerdown", other.x, other.y, { pointerId: 7, isPrimary: false }));
    window.dispatchEvent(pointer("pointerup", from.x + CELL * 0.9, from.y, { pointerId: 1 }));
    expect(hooks.onSwap).not.toHaveBeenCalled();
    expect(ui.el.querySelector(".gem.dragging")).toBeNull();
  });

  it("keeps tap-select: pulsing selection, glowing neighbours, tap-tap swaps", () => {
    const { board, ui, grid, hooks } = uiFixture();
    void grid;
    gemEl(ui, board, 2, 2).dispatchEvent(click());
    expect(hooks.onSwap).not.toHaveBeenCalled();
    expect(gemEl(ui, board, 2, 2).classList.contains("sel")).toBe(true);
    for (const [r, c] of [[1, 2], [3, 2], [2, 1], [2, 3]] as const) {
      expect(gemEl(ui, board, r, c).classList.contains("neighbor")).toBe(true);
    }
    gemEl(ui, board, 2, 3).dispatchEvent(click());
    expect(hooks.onSwap).toHaveBeenCalledTimes(1);
    expect(hooks.onSwap).toHaveBeenCalledWith(2, 2, 2, 3);
  });

  it("shakes both gems when the board refuses the committed swap", () => {
    const { board, ui, hooks } = uiFixture();
    gemEl(ui, board, 2, 2).dispatchEvent(click());
    gemEl(ui, board, 2, 3).dispatchEvent(click());
    expect(hooks.onSwap).toHaveBeenCalledTimes(1);
    // The board's verdict arrives on the fx wire — the dud's gems shake.
    ui.fx("bad", 2, 2);
    expect(gemEl(ui, board, 2, 2).classList.contains("shake")).toBe(true);
    expect(gemEl(ui, board, 2, 3).classList.contains("shake")).toBe(true);
  });

  it("pulses one valid pair after six idle seconds, and a touch stands it down", async () => {
    vi.useFakeTimers();
    const { board, ui, grid } = uiFixture();
    const mv = board.findMove();
    expect(mv).not.toBeNull();
    const [r1, c1, r2, c2] = mv!;
    await vi.advanceTimersByTimeAsync(6000);
    expect(gemEl(ui, board, r1, c1).classList.contains("hint")).toBe(true);
    expect(gemEl(ui, board, r2, c2).classList.contains("hint")).toBe(true);
    // Any touch clears the hint and re-arms the wait.
    const p = center(r1, c1);
    grid.dispatchEvent(pointer("pointerdown", p.x, p.y));
    expect(gemEl(ui, board, r1, c1).classList.contains("hint")).toBe(false);
    expect(gemEl(ui, board, r2, c2).classList.contains("hint")).toBe(false);
    window.dispatchEvent(pointer("pointerup", p.x, p.y));
  });
});
