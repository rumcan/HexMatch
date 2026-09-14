// @vitest-environment jsdom
//
// FIT-01 + RAIL-01 — the desktop column fit and the collapsible rails.
//
// FIT-01: the Processing Plant column used to overflow the fixed aside box
// and paint its last gem rows behind the resource footer (z 38 over the
// aside's z 30, under a blur). Two measurements fix it: the footer's live
// height (--resbar-h, published by ui.ts — the chip row wraps on narrow
// windows and the bar grows UP), and the column's own scrollHeight, from
// which the fit solves the zoom that makes board + fixed furniture land
// inside the aside. RAIL-01: both desktop columns fold against their screen
// edge behind one brass key each, and a phone never sees any of it.
//
// jsdom lays nothing out, so the measurement-driven tests stub the two
// reads the fit makes (rightAside.clientHeight, #iso-trade.scrollHeight)
// the same way iso-mobile-fit.test.ts stubs the phone's board slot — and
// the stub scrollHeight is HONEST: it tracks the live zoom like a real
// layout would, which is what lets the idempotence assertion below mean
// something. Pixels belong to the e2e project and the live preview.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Board } from "../../src/game/board";
import { createOriginalUi, type OriginalUi } from "../../src/game/ui";
import { createIsoMarket, emptyBag } from "../../src/iso/market";
import { mulberry32, setRng, CELL, BOARD_W, BOARD_H } from "../../src/game/config";

const DESK = { w: 1280, h: 800 };
const css = readFileSync("src/game/styles.css", "utf8");

function setViewport(w: number, h: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
}

/** jsdom has no layout: hand the aside column the box the desktop gives it. */
function stubColumnBox(ui: OriginalUi, asideH: number, chromeH: number) {
  const aside = ui.el.querySelector(".aside.right") as HTMLElement;
  const col = ui.el.querySelector("#iso-trade") as HTMLElement;
  const wrap = ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement;
  Object.defineProperty(aside, "clientHeight", { configurable: true, value: asideH });
  // honest layout: the column is the fixed furniture plus the board box at
  // whatever zoom it is currently laid out at (zoom 1 before the first fit).
  const boxH = CELL * BOARD_H + 10;
  Object.defineProperty(col, "scrollHeight", {
    configurable: true,
    get: () => chromeH + Math.ceil(boxH * (Number(wrap.style.zoom || "1") || 1)),
  });
  return { aside, col, wrap };
}

function mount() {
  setRng(mulberry32(7));
  const board = new Board();
  const market = createIsoMarket([{ i: 0, id: "you", name: "You", human: true, purse: emptyBag() }]);
  const ui = createOriginalUi(board, market, market.players[0], {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(),
    onBlackAction: vi.fn(),
  });
  document.body.append(ui.el);
  return { board, ui };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  setViewport(DESK.w, DESK.h);
});

describe("FIT-01 the board never paints behind the resource footer", () => {
  it("publishes the measured footer height and keeps the stylesheet floor when it cannot measure", () => {
    const { ui } = mount();
    // jsdom: offsetHeight 0 → nothing published, the CSS fallback stands.
    expect(ui.el.querySelector(".resbar")).toBeTruthy();
    expect(ui.el.style.getPropertyValue("--resbar-h")).toBe("");
    window.dispatchEvent(new Event("resize"));
    expect(ui.el.style.getPropertyValue("--resbar-h")).toBe("");
    // A real bar: the wrapped chip row made the footer 88px tall.
    const footer = ui.el.querySelector(".resbar") as HTMLElement;
    Object.defineProperty(footer, "offsetHeight", { configurable: true, value: 88 });
    window.dispatchEvent(new Event("resize"));
    expect(ui.el.style.getPropertyValue("--resbar-h")).toBe("88px");
    // …and the CSS parks both columns on max(52px, that var) — pinned below.
  });

  it("clamps the desktop zoom to the measured column so board + furniture fit the aside", () => {
    const { ui } = mount();
    setViewport(1280, 768);                    // band heuristic: 0.8 — overflows this box
    // 768 - 60 topbar - 8 gap - 52 floor = 648 of column; 380 of it is
    // furniture (tabs, plant head, reach strip, paddings).
    const { wrap } = stubColumnBox(ui, 648, 380);
    window.dispatchEvent(new Event("resize"));
    const boxH = CELL * BOARD_H + 10;
    const z = Number(wrap.dataset.zoom);
    // the fit: (648 - 380 - 2) of room for a 650px board
    expect(z).toBeCloseTo(266 / boxH, 10);
    expect(z).toBeLessThan(0.8);
    // the INVARIANT the ticket asks for: the laid-out column lands inside
    // the aside box — above the footer — with the furniture in place.
    expect(380 + Math.ceil(boxH * z)).toBeLessThanOrEqual(648);
    // …and the published panel width follows the fitted board, as V3 pinned.
    expect(Number(ui.el.dataset.boardPx)).toBe(Math.ceil((CELL * BOARD_W + 10) * z));
  });

  it("holds its zoom when the window resize-storms (idempotent fit, no pulse)", () => {
    const { ui } = mount();
    setViewport(1280, 768);
    const { wrap } = stubColumnBox(ui, 648, 380);
    window.dispatchEvent(new Event("resize"));
    const z1 = Number(wrap.dataset.zoom);
    expect(z1).toBeLessThan(0.8);              // fitted, not the band guess
    for (let i = 0; i < 25; i++) window.dispatchEvent(new Event("resize"));
    // An honest layout reports the same column every time once fitted, so
    // the fit returns the same zoom — the board must never breathe between
    // the band heuristic and the fitted one.
    expect(Number(wrap.dataset.zoom)).toBe(z1);
  });

  it("keeps the band heuristic exactly where nothing is measurable (jsdom contract)", () => {
    const { ui } = mount();
    setViewport(1280, 700);
    window.dispatchEvent(new Event("resize"));
    const wrap = ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement;
    expect(wrap.dataset.zoom).toBe("0.68");   // iso-corridor-picker replays this number
  });

  it("does not clamp while the plant pane is hidden (another tab owns the column)", () => {
    const { ui } = mount();
    setViewport(1280, 768);
    stubColumnBox(ui, 648, 380);
    // Market owns the column now: the fit must not read it as plant chrome.
    (ui.el.querySelector('[data-tab="market"]') as HTMLElement).click();
    window.dispatchEvent(new Event("resize"));
    const wrap = ui.el.querySelector("#iso-quarry .board-wrap:last-child") as HTMLElement;
    expect(wrap.dataset.zoom).toBe("0.8");    // the band heuristic, untouched
  });

  it("re-fits when the player returns to the plant tab on desktop", () => {
    const { ui } = mount();
    setViewport(1280, 768);
    const { wrap } = stubColumnBox(ui, 648, 380);
    // resize while Market is up (fit skips the hidden plant column)…
    (ui.el.querySelector('[data-tab="market"]') as HTMLElement).click();
    window.dispatchEvent(new Event("resize"));
    expect(wrap.dataset.zoom).toBe("0.8");
    // …then Plant again: the tab re-runs the fit with the plant column live.
    (ui.el.querySelector('[data-tab="plant"]') as HTMLElement).click();
    expect(Number(wrap.dataset.zoom)).toBeCloseTo(266 / (CELL * BOARD_H + 10), 10);
  });
});

describe("RAIL-01 the desktop columns fold against their screen edges", () => {
  it("mounts one key per column, wired to the panel it folds", () => {
    const { ui } = mount();
    const left = ui.el.querySelector(".aside.left") as HTMLElement;
    const right = ui.el.querySelector(".aside.right") as HTMLElement;
    const leftBtn = left.querySelector(".rail-toggle") as HTMLButtonElement;
    const rightBtn = right.querySelector(".rail-toggle") as HTMLButtonElement;
    expect(leftBtn.id).toBe("iso-rail-left");
    expect(rightBtn.id).toBe("iso-rail-right");
    expect(left.id).toBe("iso-aside-left");
    expect(right.id).toBe("iso-aside-right");
    expect(leftBtn.getAttribute("aria-controls")).toBe(left.id);
    expect(rightBtn.getAttribute("aria-controls")).toBe(right.id);
    // expanded by default, chevron pointing the way each panel folds:
    // the build menu folds LEFT, the board folds RIGHT (the ticket's arrows).
    expect(leftBtn.getAttribute("aria-expanded")).toBe("true");
    expect(rightBtn.getAttribute("aria-expanded")).toBe("true");
    expect(leftBtn.textContent).toBe("◂");
    expect(rightBtn.textContent).toBe("▸");
    expect(ui.el.dataset.railLeft).toBe("0");
    expect(ui.el.dataset.railRight).toBe("0");
  });

  it("collapses the board panel to the right edge and back", () => {
    const { ui } = mount();
    const rightBtn = ui.el.querySelector("#iso-rail-right") as HTMLButtonElement;
    const panel = ui.el.querySelector("#iso-trade") as HTMLElement;
    rightBtn.click();
    expect(ui.el.dataset.railRight).toBe("1");
    expect(rightBtn.getAttribute("aria-expanded")).toBe("false");
    expect(rightBtn.textContent).toBe("◂");      // toward the center: expand
    expect(rightBtn.title).toMatch(/Expand/);
    // folded controls leave the tab order with the panel
    expect(panel.inert).toBe(true);
    rightBtn.click();
    expect(ui.el.dataset.railRight).toBe("0");
    expect(rightBtn.getAttribute("aria-expanded")).toBe("true");
    expect(rightBtn.textContent).toBe("▸");      // toward the edge: fold
    expect(rightBtn.title).toMatch(/Collapse/);
    expect(panel.inert).toBe(false);
  });

  it("collapses the build menu to the left edge and back", () => {
    const { ui } = mount();
    const leftBtn = ui.el.querySelector("#iso-rail-left") as HTMLButtonElement;
    const panel = ui.el.querySelector(".aside.left .panel") as HTMLElement;
    leftBtn.click();
    expect(ui.el.dataset.railLeft).toBe("1");
    expect(leftBtn.getAttribute("aria-expanded")).toBe("false");
    expect(leftBtn.textContent).toBe("▸");       // toward the center: expand
    expect(panel.inert).toBe(true);
    leftBtn.click();
    expect(ui.el.dataset.railLeft).toBe("0");
    expect(leftBtn.textContent).toBe("◂");
    expect(panel.inert).toBe(false);
  });

  it("collapses both sides independently", () => {
    const { ui } = mount();
    (ui.el.querySelector("#iso-rail-left") as HTMLButtonElement).click();
    expect(ui.el.dataset.railLeft).toBe("1");
    expect(ui.el.dataset.railRight).toBe("0");
    (ui.el.querySelector("#iso-rail-right") as HTMLButtonElement).click();
    expect(ui.el.dataset.railRight).toBe("1");
    expect(ui.el.dataset.railLeft).toBe("1");
  });

  it("never reaches a phone: crossing the regime unfolds the panels and the keys go dead", () => {
    const { ui } = mount();
    (ui.el.querySelector("#iso-rail-left") as HTMLButtonElement).click();
    (ui.el.querySelector("#iso-rail-right") as HTMLButtonElement).click();
    expect(ui.el.dataset.railRight).toBe("1");
    // cross to the phone regime: the sheets own the panels again
    setViewport(390, 844);
    window.dispatchEvent(new Event("resize"));
    expect(ui.el.dataset.phone).toBe("1");
    expect(ui.el.dataset.railLeft).toBe("0");
    expect(ui.el.dataset.railRight).toBe("0");
    const leftBtn = ui.el.querySelector("#iso-rail-left") as HTMLButtonElement;
    const rightBtn = ui.el.querySelector("#iso-rail-right") as HTMLButtonElement;
    expect(leftBtn.getAttribute("aria-expanded")).toBe("true");
    expect(rightBtn.getAttribute("aria-expanded")).toBe("true");
    // …and the unfolded panels take focus again
    expect((ui.el.querySelector(".aside.left .panel") as HTMLElement).inert).toBe(false);
    expect((ui.el.querySelector("#iso-trade") as HTMLElement).inert).toBe(false);
    // …and on the phone the keys are inert
    rightBtn.click();
    expect(ui.el.dataset.railRight).toBe("0");
  });
});

describe("RAIL-01 the stylesheet owns the animation", () => {
  /** Every `{…}` body written for `selector` (same token match as the noir
   *  theme pin — a mention inside a comment must not pass). */
  function bodiesFor(selector: string): string[] {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[},\\s])${esc}(?=[\\s,{])`, "gm");
    const out: string[] = [];
    for (let m = re.exec(css); m; m = re.exec(css)) {
      const open = css.indexOf("{", m.index);
      const close = open < 0 ? -1 : css.indexOf("}", open);
      if (close > open) out.push(css.slice(open + 1, close));
    }
    return out;
  }

  it("slides both columns with the ticket's .25s transform transition", () => {
    const body = bodiesFor(".aside.left, .aside.right").find((b) => /transition:\s*transform/.test(b));
    expect(body).toMatch(/transition:\s*transform\s+\.25s\s+ease/);
  });

  it("folds the build menu left and the board right, each leaving its 28px sliver", () => {
    expect(css).toMatch(/\[data-rail-left="1"\]\s+\.aside\.left\s*\{\s*transform:\s*translateX\(calc\(-100% \+ 28px\)\)/);
    expect(css).toMatch(/\[data-rail-right="1"\]\s+\.aside\.right\s*\{\s*transform:\s*translateX\(calc\(100% - 28px\)\)/);
  });

  it("hangs each key on its panel's outer edge", () => {
    const key = bodiesFor(".rail-toggle").find((b) => /position:\s*absolute/.test(b));
    expect(key, "the key is absolutely positioned").toBeTruthy();
    expect(key).toMatch(/top:\s*50%/);
    expect(key).toMatch(/width:\s*24px/);
    expect(bodiesFor(".rail-toggle-left").some((b) => /right:\s*0/.test(b))).toBe(true);
    expect(bodiesFor(".rail-toggle-right").some((b) => /left:\s*0/.test(b))).toBe(true);
  });

  it("keeps the mobile regime rail-free (sheets keep their tab navigation)", () => {
    // the phone block drops the keys entirely and undoes any fold transform
    expect(css).toMatch(/\.rail-toggle\s*\{\s*display:\s*none\s*!important/);
    const undo = bodiesFor(".aside.left, .aside.right").find((b) => /transform:\s*none\s*!important/.test(b));
    expect(undo, "the phone block undoes the fold transform").toBeTruthy();
  });

  it("parks the columns on the footer's live edge with the 52px floor kept", () => {
    expect(css).toMatch(/\.aside\s*\{[^}]*bottom:\s*max\(52px, var\(--resbar-h, 52px\)\)/);
  });
});
