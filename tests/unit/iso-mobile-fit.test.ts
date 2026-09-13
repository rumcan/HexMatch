// @vitest-environment jsdom
//
// MOBILE-02 — the phone fit contract. On a phone viewport the match table
// owns the window: the chrome measures the slot the sheet leaves it, grows
// the board into that space through the game's `requestBoardSize` answer
// (never below the shipped 7×8, never while unmeasured), resizes the grid
// box to the live board, and re-fits on orientation. The private wire falls
// silent, and the top bar tucks on the trade sheet — dropping back when a
// number in it changes. These are the numbers jsdom can actually observe;
// pixels belong to the e2e phone projects and the live preview.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../../src/game/board";
import { createOriginalUi, type OriginalUi } from "../../src/game/ui";
import { createIsoMarket, emptyBag } from "../../src/iso/market";
import { mulberry32, setRng, BOARD_W, BOARD_H, CELL } from "../../src/game/config";

const PHONE = { w: 390, h: 844 };
const DESK = { w: 1280, h: 800 };

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
}

/** jsdom has no layout: hand the slot the box the phone sheet would give it. */
function stubSlotBox(ui: OriginalUi, w: number, h: number) {
  const slot = ui.el.querySelector("#iso-quarry .board-slot") as HTMLElement;
  Object.defineProperty(slot, "clientWidth", { configurable: true, value: w });
  Object.defineProperty(slot, "clientHeight", { configurable: true, value: h });
  return slot;
}

function mount(size: (w: number, h: number) => boolean) {
  setRng(mulberry32(7));
  const board = new Board();
  const market = createIsoMarket([{ i: 0, id: "you", name: "You", human: true, purse: emptyBag() }]);
  const ui = createOriginalUi(board, market, market.players[0], {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(),
    onBlackAction: vi.fn(),
    requestBoardSize: size,
  });
  document.body.append(ui.el);
  return { board, ui, market };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  setViewport(DESK.w, DESK.h);
});

describe("MOBILE-02 phone fit", () => {
  it("marks the phone regime and keeps 7×8 while nothing is measurable (map view boots)", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(() => true);
    // Boot happens on the map view: the plant slot has no box to measure, so
    // the fit must NOT propose a grow — the first number it paints with would
    // strand rows of gems under the fold the moment the sheet opened.
    expect(ui.el.dataset.phone).toBe("1");
    expect(board.w).toBe(BOARD_W);
    expect(board.h).toBe(BOARD_H);
    const grid = ui.el.querySelector("#iso-gems") as HTMLElement;
    expect(grid.style.width).toBe(`${CELL * BOARD_W}px`);
    expect(grid.style.height).toBe(`${CELL * BOARD_H}px`);
  });

  it("grows the board into the measured slot and sizes the grid box to it", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(() => true);
    // A 374×600 slot: cell = floor(min(360/7, 590/8)) = 51, rows = 590/51 → 11.
    stubSlotBox(ui, 374, 600);
    (ui.el.querySelector('.mnav-btn[data-view="trade"]') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(board.w).toBe(7);
    expect(board.h).toBe(11);
    const grid = ui.el.querySelector("#iso-gems") as HTMLElement;
    expect(grid.style.width).toBe(`${CELL * 7}px`);
    expect(grid.style.height).toBe(`${CELL * 11}px`);
    expect(ui.el.querySelectorAll("#iso-gems .gem")).toHaveLength(7 * 11);
    // published panel width is the whole live board at the fitted zoom
    const z = Number((ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement).dataset.zoom);
expect(Number(ui.el.dataset.boardPx)).toBe(Math.ceil((CELL * board.w + 10) * z));
    // …and the fitted board never exceeds the slot it measured
    expect(board.w * CELL * z).toBeLessThanOrEqual(361);
    expect(board.h * CELL * z).toBeLessThanOrEqual(591);
  });

  it("never resizes without the game's answer — and honors a veto", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(() => false);
    stubSlotBox(ui, 374, 600);
    (ui.el.querySelector('.mnav-btn[data-view="trade"]') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(board.w).toBe(BOARD_W);
    expect(board.h).toBe(BOARD_H);
  });

  it("keeps the grown rectangle when the window comes back (grow-only, zoom shrinks)", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(() => true);
    stubSlotBox(ui, 374, 600);
    (ui.el.querySelector('.mnav-btn[data-view="trade"]') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(board.h).toBeGreaterThan(BOARD_H);
    // A resize that shrinks the window must not delete gems — the fit clamps
    // zoom instead, and the board keeps the rectangle its history earned.
    setViewport(320, 568);
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(0);
    expect(board.h).toBe(11);
    // …back to desktop the phone regime lifts, the board is still 7×11, and
    // the grid box keeps telling the truth about it.
    setViewport(DESK.w, DESK.h);
    window.dispatchEvent(new Event("resize"));
    await vi.advanceTimersByTimeAsync(0);
    expect(ui.el.dataset.phone).not.toBe("1");
    expect(board.w).toBe(7);
    expect(board.h).toBe(11);
    const grid = ui.el.querySelector("#iso-gems") as HTMLElement;
    expect(grid.style.height).toBe(`${CELL * 11}px`);
  });

  it("a restored board re-boots the grid box through renderBoard, no resize needed", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(() => true);
    // Simulate the multiplayer/restore path: the whole grid is swapped under
    // the chrome (a 9-column board arriving from a wider phone), and only
    // renderBoard runs. The layout box must follow without asking.
    let id = 1000;
    board.restore({
      grid: Array.from({ length: 8 }, () =>
        Array.from({ length: 9 }, () => ({ id: id++, res: "wood", tier: 0 }))),
    });
    ui.renderBoard();
    await vi.advanceTimersByTimeAsync(500); // the old elements' `gone` fade-out
    const grid = ui.el.querySelector("#iso-gems") as HTMLElement;
    expect(grid.style.width).toBe(`${CELL * 9}px`);
    expect(grid.style.height).toBe(`${CELL * 8}px`);
    expect(ui.el.querySelectorAll("#iso-gems .gem")).toHaveLength(72);
  });

  it("the top bar tucks on the trade sheet and drops back for a grip press", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { ui } = mount(() => false);
    const top = ui.el.querySelector(".topbar") as HTMLElement;
    // entering the trade sheet shows the bar briefly, then it tucks itself
    (ui.el.querySelector('.mnav-btn[data-view="trade"]') as HTMLElement).click();
    await vi.advanceTimersByTimeAsync(3400);
    expect(top.classList.contains("tucked")).toBe(true);
    // the grip above the tabs calls it back…
    (ui.el.querySelector(".tb-grip") as HTMLElement).click();
    expect(top.classList.contains("tucked")).toBe(false);
    // …and it goes away again on its own
    await vi.advanceTimersByTimeAsync(6100);
    expect(top.classList.contains("tucked")).toBe(true);
    // leaving the trade sheet hands it back permanently
    (ui.el.querySelector('.mnav-btn[data-view="map"]') as HTMLElement).click();
    expect(top.classList.contains("tucked")).toBe(false);
  });

  it("the private wire stays silent on a phone but speaks on a desktop", async () => {
    setViewport(PHONE.w, PHONE.h);
    const phone = mount(() => false);
    phone.ui.rivalQuip([{ speaker: "rival", text: "The other half are load-bearing." }]);
    await vi.advanceTimersByTimeAsync(20_000);
    const wire = phone.ui.el.querySelector("#iso-rival-quip") as HTMLElement;
    expect(wire.classList.contains("hidden")).toBe(true);
    expect(wire.querySelector(".rival-quip-text")!.textContent).not.toMatch(/load-bearing/);
    vi.clearAllTimers();
    document.body.replaceChildren();

    setViewport(DESK.w, DESK.h);
    vi.useFakeTimers();
    const desk = mount(() => false);
    desk.ui.rivalQuip([{ speaker: "rival", text: "The other half are load-bearing." }]);
    await vi.advanceTimersByTimeAsync(0);
    expect((desk.ui.el.querySelector("#iso-rival-quip") as HTMLElement).classList.contains("hidden")).toBe(false);
    expect(desk.ui.el.querySelector(".rival-quip-text")!.textContent).toMatch(/load-bearing/);
  });
});
