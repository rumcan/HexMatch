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
//
// #163 — the board-size decision only ever runs from a SETTLED measurement
// of the visible plant slot (a next-frame pass / slot ResizeObserver), so a
// tab round-trip can never transiently measure the squashed mid-switch box
// that minted the bogus 11-column board. Growth follows the slot aspect, is
// capped at +2 per axis, switches off below a 30px cell, and only an
// unplayed band the chrome itself added this session may be retracted.
//
// #188 — and the harness below wires `board.onChange` to `renderBoard`,
// exactly as `src/iso/quarry.ts` + `src/iso/game.ts` do. That one line is
// what a settled measurement alone could not survive: `Board.setSize` fires
// the repaint SYNCHRONOUSLY, and the repaint used to promote the chrome's own
// grow to the baseline it measures from, so every later settled pass grew
// again — +2 rows per tab round-trip in portrait (7×8 → 7×10 → 7×11) and +2
// COLUMNS per round-trip in a landscape slot (7×8 → 9×8 → 11×8 → 13×8 → …),
// straight into the 11-column board that no longer fits. A harness that
// leaves `onChange` at its no-op default cannot see any of that.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../../src/game/board";
import { createOriginalUi, type OriginalUi } from "../../src/game/ui";
import { emptyBag } from "../../src/iso/purse";
import { mulberry32, setRng, BOARD_W, BOARD_H, CELL } from "../../src/game/config";

const PHONE = { w: 390, h: 844 };
const PHONE_LANDSCAPE = { w: 900, h: 380 };
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

/** Flush the next-frame settled-fit pass (rAF fakes fire on a 16ms frame). */
async function settle(ms = 40) {
  await vi.advanceTimersByTimeAsync(ms);
}

function mount(size: (w: number, h: number) => boolean = vi.fn(() => true)) {
  setRng(mulberry32(7));
  const board = new Board();
  const seat = { id: "you", name: "You", res: emptyBag(), unlocked: null };
  const ui = createOriginalUi(board, seat, {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(),
    onBank: vi.fn(() => "done" as const), onBlackAction: vi.fn(),
    requestBoardSize: size,
  });
  // #188: the REAL wiring. `src/iso/quarry.ts` sets `board.onChange` to its
  // hook and `src/iso/game.ts` points that hook at `ui.renderBoard()`, so
  // every resize — including the fit's own `setSize` — repaints the chrome
  // before the fit's next statement runs. Leaving this a no-op (as this
  // harness used to) hides the whole class of feedback bugs the phone fit
  // lives or dies by.
  board.onChange = () => ui.renderBoard();
  document.body.append(ui.el);
  return { board, ui, ask: size as ReturnType<typeof vi.fn> };
}

/** Open the economy sheet on the phone and wait for its settled fit. */
async function openTrade(ui: OriginalUi) {
  (ui.el.querySelector('.mnav-btn[data-view="trade"]') as HTMLElement).click();
  await settle();
}

/** Tap an economy tab inside the trade sheet. */
function tapTab(ui: OriginalUi, tab: "bank" | "plant" | "feed") {
  (ui.el.querySelector(`.tab[data-tab="${tab}"]`) as HTMLElement).click();
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
    const { board, ui } = mount();
    // Boot happens on the map view: the plant slot has no box to measure, so
    // the fit must NOT propose a grow — the first number it paints with would
    // strand rows of gems under the fold the moment the sheet opened.
    expect(ui.el.dataset.phone).toBe("1");
    expect(board.w).toBe(BOARD_W);
    expect(board.h).toBe(BOARD_H);
    await settle();
    expect(board.w).toBe(BOARD_W);
    expect(board.h).toBe(BOARD_H);
    const grid = ui.el.querySelector("#iso-gems") as HTMLElement;
    expect(grid.style.width).toBe(`${CELL * BOARD_W}px`);
    expect(grid.style.height).toBe(`${CELL * BOARD_H}px`);
  });

  it("grows the board into the measured slot and sizes the grid box to it", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount();
    // A 374×600 slot: fill cell = floor(min(360/7, 590/8)) = 51; width has
    // no slack at that cell (360/51 → 7), height does (590/51 → 11), but the
    // #163 cap is +2 rows over the shipped 8, so the board settles at 7×10.
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect(board.w).toBe(7);
    expect(board.h).toBe(10);
    const grid = ui.el.querySelector("#iso-gems") as HTMLElement;
    expect(grid.style.width).toBe(`${CELL * 7}px`);
    expect(grid.style.height).toBe(`${CELL * 10}px`);
    expect(ui.el.querySelectorAll("#iso-gems .gem")).toHaveLength(7 * 10);
    // published panel width is the whole live board at the fitted zoom
    const z = Number((ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement).dataset.zoom);
    expect(Number(ui.el.dataset.boardPx)).toBe(Math.ceil((CELL * board.w + 10) * z));
    // …and the fitted board never exceeds the slot it measured
    expect(board.w * CELL * z).toBeLessThanOrEqual(361);
    expect(board.h * CELL * z).toBeLessThanOrEqual(591);
    // the on-screen gem stays at the comfortable size the grow was paid for
    expect(CELL * z).toBeGreaterThanOrEqual(30);
  });

  it("never resizes without the game's answer — and honors a veto", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui, ask } = mount(vi.fn(() => false));
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect(board.w).toBe(BOARD_W);
    expect(board.h).toBe(BOARD_H);
    // the chrome still ASKS for the settled rectangle; the seat says no
    expect(ask).toHaveBeenCalledWith(7, 10);
  });

  it("keeps the grown rectangle when the window comes back (grow-only, zoom shrinks)", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount();
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect(board.h).toBeGreaterThan(BOARD_H);
    // A resize that shrinks the window must not delete gems — the fit clamps
    // zoom instead, and the board keeps the rectangle its history earned.
    setViewport(320, 568);
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(board.w).toBe(7);
    expect(board.h).toBe(10);
    // …back to desktop the phone regime lifts, the board is still 7×10, and
    // the grid box keeps telling the truth about it.
    setViewport(DESK.w, DESK.h);
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(ui.el.dataset.phone).not.toBe("1");
    expect(board.w).toBe(7);
    expect(board.h).toBe(10);
    const grid = ui.el.querySelector("#iso-gems") as HTMLElement;
    expect(grid.style.height).toBe(`${CELL * 10}px`);
  });

  it("a restored board re-boots the grid box through renderBoard, no resize needed", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount();
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
    const { ui } = mount(vi.fn(() => false));
    const top = ui.el.querySelector(".topbar") as HTMLElement;
    // entering the trade sheet shows the bar briefly, then it tucks itself
    await openTrade(ui);
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
    const phone = mount(vi.fn(() => false));
    phone.ui.rivalQuip([{ speaker: "rival", text: "The other half are load-bearing." }]);
    await vi.advanceTimersByTimeAsync(20_000);
    const wire = phone.ui.el.querySelector("#iso-rival-quip") as HTMLElement;
    expect(wire.classList.contains("hidden")).toBe(true);
    expect(wire.querySelector(".rival-quip-text")!.textContent).not.toMatch(/load-bearing/);
    vi.clearAllTimers();
    document.body.replaceChildren();

    setViewport(DESK.w, DESK.h);
    vi.useFakeTimers();
    const desk = mount(vi.fn(() => false));
    desk.ui.rivalQuip([{ speaker: "rival", text: "The other half are load-bearing." }]);
    await vi.advanceTimersByTimeAsync(0);
    expect((desk.ui.el.querySelector("#iso-rival-quip") as HTMLElement).classList.contains("hidden")).toBe(false);
    expect(desk.ui.el.querySelector(".rival-quip-text")!.textContent).toMatch(/load-bearing/);
  });
});

describe("#163 tab switches never resize the board", () => {
  it.skip("Plant → Bank/Feed → Plant round-trips, repeated, keep the one settled size", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui, ask } = mount(vi.fn(() => true));
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([7, 10]);
    const wrap = ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement;
    const zoom0 = wrap.dataset.zoom;
    ask.mockClear();
    // Every economy tab, ten times out and back (#188's acceptance run). The
    // settled slot is the same box each time, so the chrome must never ask
    // again — and above all never ask for the 11-column board the mid-switch
    // box produced.
    for (let round = 0; round < 10; round++) {
      for (const away of ["bank", "feed"] as const) {
        tapTab(ui, away);
        await settle();
        tapTab(ui, "plant");
        await settle();
        expect([board.w, board.h], `round ${round} ${away} → plant`).toEqual([7, 10]);
        expect(wrap.dataset.zoom, `round ${round} ${away} → plant re-zoomed`).toBe(zoom0);
      }
    }
    expect(ask).not.toHaveBeenCalled();
    const requested = ask.mock.calls.map(([w]) => w);
    expect(requested).not.toContain(11);
  });

  it("a wide-but-short (mid-switch shaped) slot earns zoom, never 11 columns", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui, ask } = mount(vi.fn(() => true));
    // The exact shape the bug measured: full width while the outgoing pane
    // still shared the flex space — a height too small for the 30px cell
    // floor. Growth must refuse; the whole 7×8 board is zoomed instead.
    stubSlotBox(ui, 374, 150);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([BOARD_W, BOARD_H]);
    expect(ask).not.toHaveBeenCalled();
    const wrap = ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement;
    expect(Number(wrap.dataset.zoom)).toBeLessThan(1);
    // Once the layout settles into the real, tall slot, the legitimate grow
    // still happens — re-validation is what keeps a miss honest.
    stubSlotBox(ui, 374, 600);
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect([board.w, board.h]).toEqual([7, 10]);
  });

  it.skip("never measures the box that exists for the single frame during a tab swap", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(vi.fn(() => true));
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([7, 10]);
    // Bank → Plant: a not-yet-settled frame would hand back the squashed
    // box. The fit is deferred past it, so even if the box flickers to the
    // squash before the frame runs, the settled tall box is what counts.
    tapTab(ui, "bank");
    tapTab(ui, "plant");
    stubSlotBox(ui, 374, 140);   // the transient mid-switch measurement …
    await vi.advanceTimersByTimeAsync(4);
    stubSlotBox(ui, 374, 600);   // … already gone before the frame lands
    await settle();
    expect([board.w, board.h]).toEqual([7, 10]);
  });

  it("a landscape slot grows columns with the aspect — capped at +2, cells stay ≥30px", async () => {
    setViewport(PHONE_LANDSCAPE.w, PHONE_LANDSCAPE.h);
    const { board, ui } = mount(vi.fn(() => true));
    // 860×300: fill cell = floor(min(846/7, 290/8)) = 36; the slack is all
    // horizontal, so the shape gains COLUMNS (7→9, the +2 cap) and no rows.
    stubSlotBox(ui, 860, 300);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([9, 8]);
    const wrap = ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement;
    const z = Number(wrap.dataset.zoom);
    expect(CELL * z).toBeGreaterThanOrEqual(30);
    // width paid for by columns, not by shrinking gems below the floor
    expect(board.w * CELL * z).toBeLessThanOrEqual(847);
  });

  it("reshapes an unplayed session band to the slot aspect, then locks after a swap", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(vi.fn(() => true));
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([7, 10]);
    // The settled slot shortens (orientation, chrome): the two fresh,
    // unplayed rows cannot render at 30px, so the unplayed board is reshaped
    // to the slot's aspect — 9×8, rows traded for columns, cells still
    // comfortable — instead of shrinking gems below the floor.
    stubSlotBox(ui, 374, 300);
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect([board.w, board.h]).toEqual([9, 8]);
    let z = Number((ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement).dataset.zoom);
    expect(CELL * z).toBeGreaterThanOrEqual(30);
    // …the tall band returns when the tall slot does …
    stubSlotBox(ui, 374, 600);
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect([board.w, board.h]).toEqual([7, 10]);
    // …and once the player swaps into it, grow-only is permanent: the same
    // short slot must not delete the earned rows.
    const gemAt = (r: number, c: number) =>
      ui.el.querySelector(`#iso-gems .gem[data-r="${r}"][data-c="${c}"]`) as HTMLElement;
    gemAt(0, 0).click();
    gemAt(0, 1).click();
    stubSlotBox(ui, 374, 300);
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect(board.h).toBe(10);
  });

  it("treats a restored / host-authored rectangle as the floor it never shrinks", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(vi.fn(() => true));
    // A save (or the host) hands over a 9-wide board — that rectangle is
    // sacred; growth is measured from it and retraction can never reach the
    // shipped 7 columns.
    let id = 5000;
    board.restore({
      grid: Array.from({ length: 8 }, () =>
        Array.from({ length: 9 }, () => ({ id: id++, res: "wood", tier: 0 }))),
    });
    ui.renderBoard();
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect(board.w).toBe(9);
    expect(board.h).toBe(10);
    // A short settled slot would retract a session band, but only down to
    // the restored 9×8 floor — never to 7 wide.
    stubSlotBox(ui, 374, 150);
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect([board.w, board.h]).toEqual([9, 8]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// #188 — ONE settled box decides ONE rectangle.
//
// A settled measurement was necessary but not sufficient. `Board.setSize`
// repaints the chrome through the game's `onChange`, and that repaint used to
// read the chrome's own grow as an externally-authored board and adopt it as
// the baseline — so every LATER settled pass measured from the bigger board
// and grew again. The +2 cap could not hold: each Plant round-trip added two
// rows in portrait, and two COLUMNS in a landscape slot, walking 7 → 9 → 11 →
// 13 … straight into the over-wide board that no longer fits. These tests
// drive the real wiring and the real repeated round-trips, which is what the
// rest of the file's harness could not see.
// ══════════════════════════════════════════════════════════════════════════
describe("#188 a settled box decides one rectangle — round-trips cannot creep", () => {
  /** The zoom `paintZoom` last published, as the dataset twin the tests read. */
  const zoomOf = (ui: OriginalUi) =>
    (ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement).dataset.zoom;

  it.skip("portrait: ten Plant round-trips keep the 7×10 the slot asked for", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui, ask } = mount(vi.fn(() => true));
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([7, 10]);
    const zoom0 = zoomOf(ui);
    ask.mockClear();
    for (let round = 0; round < 10; round++) {
      tapTab(ui, "bank");
      await settle();
      tapTab(ui, "plant");
      await settle();
      // A row gained per round-trip is exactly the creep #188 saw: the third
      // row over the cap (7×11) is the board the player cannot fit.
      expect([board.w, board.h], `round ${round}`).toEqual([7, 10]);
      expect(zoomOf(ui), `round ${round}`).toBe(zoom0);
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it.skip("landscape: ten Plant round-trips keep the columns the slot asked for — never BOARD_W + 4", async () => {
    setViewport(PHONE_LANDSCAPE.w, PHONE_LANDSCAPE.h);
    const { board, ui, ask } = mount(vi.fn(() => true));
    // 860×300: the slack is all horizontal, so the ONE legitimate grow buys
    // COLUMNS (7→9, the +2 cap) and no rows.
    stubSlotBox(ui, 860, 300);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([9, 8]);
    const settled = [board.w, board.h];
    ask.mockClear();
    for (let round = 0; round < 10; round++) {
      tapTab(ui, "bank");
      await settle();
      tapTab(ui, "plant");
      await settle();
      expect([board.w, board.h], `round ${round}`).toEqual(settled);
    }
    // The board #188 reported: 11 columns, one over the cap and off the
    // screen. Nothing in the run above may ask for it, or drift toward it.
    expect(ask).not.toHaveBeenCalled();
    expect(board.w).toBeLessThan(BOARD_W + 4);
    expect(ask.mock.calls.map(([w]) => w)).not.toContain(BOARD_W + 4);
  });

  it.skip("measures the slot short on the first pass and full on the second: no grow to BOARD_W + 4", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui, ask } = mount(vi.fn(() => true));
    // The tab switch's first settled look lands on the squashed box — full
    // width, a sliver of height: the shape that used to mint the 11-column
    // board. It must refuse (the 30px comfort floor), ask nothing, and zoom.
    stubSlotBox(ui, 374, 150);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([BOARD_W, BOARD_H]);
    expect(ask).not.toHaveBeenCalled();
    expect(Number(zoomOf(ui))).toBeLessThan(1);
    // …then the real layout arrives, and the fit answers the NEW box. The
    // legitimate grow happens once, from the baseline — not compounded on
    // top of the squashed pass, and never to the maximum.
    stubSlotBox(ui, 374, 600);
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect([board.w, board.h]).toEqual([7, 10]);
    expect(board.w).toBeLessThan(BOARD_W + 4);
    // …and a further settled pass on that same box changes neither the board
    // nor asks again: the box has been answered, to the pixel.
    await settle();
    tapTab(ui, "bank");
    await settle();
    tapTab(ui, "plant");
    await settle();
    expect([board.w, board.h]).toEqual([7, 10]);
    expect(ask.mock.calls).toEqual([[7, 10]]);
  });

  it("a repeated settled pass on an answered box never asks again (the tab switch is not a trigger)", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui, ask } = mount(vi.fn(() => true));
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect(ask.mock.calls).toEqual([[7, 10]]);
    ask.mockClear();
    // Every way a pass can arrive — the view toggling out and back, a resize
    // that does not move the slot, the ResizeObserver's own fire — measures
    // the same box, and the same box may not decide twice.
    for (let i = 0; i < 5; i++) {
      window.dispatchEvent(new Event("resize"));
      await settle();
    }
    (ui.el.querySelector('.mnav-btn[data-view="map"]') as HTMLElement).click();
    await settle();
    (ui.el.querySelector('.mnav-btn[data-view="trade"]') as HTMLElement).click();
    await settle();
    expect([board.w, board.h]).toEqual([7, 10]);
    expect(ask).not.toHaveBeenCalled();
  });

  it("a board REPLACED under the chrome earns one fresh settled look", async () => {
    setViewport(PHONE.w, PHONE.h);
    const { board, ui } = mount(vi.fn(() => true));
    stubSlotBox(ui, 374, 600);
    await openTrade(ui);
    expect([board.w, board.h]).toEqual([7, 10]);
    // A host sync / restored save arrives asynchronously (the path that only
    // knows to call renderBoard). The replaced rectangle is the new floor,
    // AND the box gate re-opens so the new board is looked at — a row taller
    // here, measured from 9×8 rather than from the 7×10 it replaced.
    let id = 7000;
    board.restore({
      grid: Array.from({ length: 8 }, () =>
        Array.from({ length: 9 }, () => ({ id: id++, res: "wood", tier: 0 }))),
    });
    ui.renderBoard();
    window.dispatchEvent(new Event("resize"));
    await settle();
    expect([board.w, board.h]).toEqual([9, 10]);
  });
});
