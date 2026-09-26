// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../../src/game/board";
import { mulberry32, setRng } from "../../src/game/config";
import { createOriginalUi, type OriginalUi, type UiState } from "../../src/game/ui";
import { emptyBag } from "../../src/iso/purse";
import { moneyMarkup } from "../../src/game/hud-icons";
import { RAIL_COSTS } from "../../src/iso/rail";

function viewport(w = 1280, h = 800) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
}
function mount(newLoop = true): OriginalUi {
  setRng(mulberry32(7));
  const ui = createOriginalUi(new Board(), { id: "you", name: "You", res: emptyBag(), unlocked: null }, {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(),
    onBank: vi.fn(() => "done" as const), onBlackAction: vi.fn(), onSell: vi.fn(() => 10),
    requestBoardSize: () => false,
  }, { newLoop });
  document.body.append(ui.el);
  return ui;
}
function state(patch: Partial<UiState> = {}): UiState {
  return {
    players: [], purse: emptyBag(), money: 500, phase: "play", tool: "select",
    freeTrack: 0, freeDepots: 0, banner: null, bannerKey: null, costInfo: null,
    inspect: null, reach: {}, resetIn: 0, portrait: "you", tuning: null,
    ...patch,
  };
}
function el(ui: OriginalUi, selector: string): HTMLElement {
  const node = ui.el.querySelector<HTMLElement>(selector);
  expect(node, selector).not.toBeNull();
  return node!;
}
const badge = (ui: OriginalUi, tab: string) => el(ui, `[data-tab="${tab}"] .tab-badge`);
const collapsed = (ui: OriginalUi) => el(ui, "#iso-plant").classList.contains("plant-collapsed");

beforeEach(() => {
  vi.useFakeTimers();
  viewport();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HUD-1 contextual panels", () => {
  it("boots with a slim, keyboard-operable Plant chip and a closed drawer", () => {
    const ui = mount();
    ui.paint(state());
    expect(ui.el.dataset.railRight).toBe("1");
    expect(collapsed(ui)).toBe(true);
    expect(el(ui, "#iso-tuning").inert).toBe(true);
    const toggle = el(ui, ".plant-toggle");
    expect(toggle.getAttribute("aria-controls")).toBe("iso-tuning");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    ui.paint(state()); // ordinary frame must respect the player's choice
    expect(collapsed(ui)).toBe(false);
    expect(el(ui, "#iso-tuning").inert).toBe(false);
    toggle.click();
    expect(collapsed(ui)).toBe(true);
  });

  it("expands for retunes, badging the action, and collapses when no longer ready", () => {
    const ui = mount();
    ui.paint(state({ tuningIdle: { retune: { depotId: 1, cargo: "wood", yield: 1, risks: false } } }));
    expect(collapsed(ui)).toBe(false);
    expect(el(ui, ".plant-badge").textContent).toBe("Retune ready");
    expect(el(ui, "#iso-tuning-retune").classList.contains("hidden")).toBe(false);
    ui.paint(state());
    expect(collapsed(ui)).toBe(true);
  });

  it("expands for a selected Depot and folds when its action card closes", () => {
    const ui = mount();
    ui.paint(state());
    ui.showDepotCard({ title: "Wood Depot", yieldNow: 1, cap: 2, nextCap: 4,
      upgradeCost: "$100", retuneCost: "Free", busy: false,
      onUpgrade: () => false, onRetune: () => false });
    expect(collapsed(ui)).toBe(false);
    ui.closeActionCard();
    expect(collapsed(ui)).toBe(true);
  });

  it("badges an affordable city upgrade without covering the map; costs remain cargo icons", () => {
    const ui = mount();
    ui.paint(state({ town: { level: 0, maxLevel: 1, cost: { wood: 20, stone: 10 }, affordable: true, bonus: 0, ceiling: 0.5 } }));
    expect(collapsed(ui)).toBe(true);
    expect(el(ui, ".plant-badge").textContent).toBe("Upgrade ready");
    el(ui, ".plant-toggle").click();
    const cost = el(ui, ".tp-city .k-cost");
    expect(cost.querySelectorAll(".cargo-ic").length).toBe(2);
    expect(cost.textContent).not.toContain("$");
  });

  it("never leaves a running session's shared plate inert", () => {
    const ui = mount();
    ui.paint(state());
    ui.paint(state({ tuning: { kind: "depot", cargo: "wood", moves: 10, movesLeft: 10, score: 0, yield: 1, abandonYield: 1 } }));
    expect(el(ui, "#iso-plant").classList.contains("hidden")).toBe(true);
    expect(el(ui, "#iso-tuning").inert).toBe(false);
    expect(ui.isQuarryOpen()).toBe(true);
    ui.paint(state());
    expect(collapsed(ui)).toBe(true);
    expect(el(ui, "#iso-tuning").inert).toBe(true);
  });

  it("closes a tutorial-opened drawer on guide completion, not on later frames", () => {
    const ui = mount();
    ui.el.classList.add("guide-on");
    ui.paint(state());
    ui.setTab("market");
    expect(ui.el.dataset.railRight).toBe("0");
    ui.el.classList.remove("guide-on");
    ui.paint(state());
    expect(ui.el.dataset.railRight).toBe("1");
    ui.setTab("market");
    ui.paint(state());
    expect(ui.el.dataset.railRight).toBe("0");
  });

  it("only marks quests seen while the selected tab is actually open", () => {
    const ui = mount();
    const item = { id: "wood", who: "Mabel", text: "Deliver wood", progress: "0/10", reward: "+1★" };
    const withQuests = state({ quests: { hidden: false, items: [item] } });
    ui.paint(withQuests);
    expect(badge(ui, "quests").textContent).toBe("1");
    el(ui, '[data-tab="quests"]').click();
    expect(badge(ui, "quests").classList.contains("hidden")).toBe(true);
    el(ui, '[data-tab="quests"]').click(); // close, but keep this tab selected
    withQuests.quests!.items.push({ ...item, id: "ore" });
    ui.paint(withQuests);
    expect(badge(ui, "quests").textContent).toBe("1");
    ui.paint(withQuests);
    expect(badge(ui, "quests").textContent).toBe("1");
    el(ui, '[data-tab="quests"]').click();
    expect(badge(ui, "quests").classList.contains("hidden")).toBe(true);
  });

  it("badges live price alerts without auto-opening the drawer", () => {
    const ui = mount();
    const alert = state({ market: [], marketEvent: "Wood demand rises" });
    ui.paint(alert);
    expect(ui.el.dataset.railRight).toBe("1");
    expect(badge(ui, "market").textContent).toBe("1");
    ui.setTab("market");
    expect(badge(ui, "market").classList.contains("hidden")).toBe(true);
    el(ui, '[data-tab="market"]').click();
    ui.paint({ ...alert, marketEvent: "Ore demand rises" });
    expect(badge(ui, "market").textContent).toBe("1");
    ui.paint(state());
    expect(badge(ui, "market").classList.contains("hidden")).toBe(true);
    ui.paint(alert); // the same named event can recur later
    expect(badge(ui, "market").textContent).toBe("1");
  });

  it.each([[390, 844], [900, 380]])("keeps phone sheets unfolded at %s×%s", (w, h) => {
    viewport(w, h);
    const ui = mount();
    ui.paint(state());
    expect(ui.el.dataset.phone).toBe("1");
    expect(collapsed(ui)).toBe(false);
    expect(el(ui, "#iso-tuning").inert).toBe(false);
    ui.el.classList.add("guide-on");
    ui.paint(state());
    ui.setTab("bank");
    ui.el.classList.remove("guide-on");
    ui.paint(state());
    expect(ui.el.dataset.railRight).toBe("0");
  });

  it("keeps badge text nodes stable across unchanged frames", () => {
    const ui = mount();
    const s = state({ town: { level: 0, maxLevel: 1, cost: { wood: 20 }, affordable: true, bonus: 0, ceiling: 0.5 } });
    ui.paint(s);
    ui.feed("Delivery arrived");
    const plantText = el(ui, ".plant-badge").firstChild;
    const feedText = badge(ui, "feed").firstChild;
    for (let i = 0; i < 10; i++) ui.paint(s);
    expect(el(ui, ".plant-badge").firstChild).toBe(plantText);
    expect(badge(ui, "feed").firstChild).toBe(feedText);
  });

  it("does not add a contextual Plant to the legacy loop", () => {
    const ui = mount(false);
    expect(ui.el.querySelector("#iso-plant")).toBeNull();
    ui.openSessionBoard();
    expect(ui.isQuarryOpen()).toBe(true);
  });

  it("quotes the authoritative dollar rail cost in the Railway panel", () => {
    const ui = mount();
    const note = el(ui, ".rail-panel .pane-note");
    expect(note.innerHTML).toContain(moneyMarkup(RAIL_COSTS.rail));
    expect(note.textContent).not.toContain("costs stone");
  });
});

describe("HUD-1 single message channel", () => {
  it("queues FIFO with one toast even during dismissal, logging each message once", async () => {
    const ui = mount();
    ui.toast("First", "danger");
    ui.toast("Second", "success");
    ui.toast("Third", "info");
    ui.toast("Second", "success");
    expect(ui.el.querySelectorAll(".toast")).toHaveLength(1);
    expect(ui.el.querySelectorAll(".feed-row")).toHaveLength(3);
    expect(badge(ui, "feed").textContent).toBe("3");
    const close = el(ui, ".toast-x");
    close.click();
    close.click(); // no double dequeue
    await vi.advanceTimersByTimeAsync(299);
    expect(el(ui, ".toast-msg").textContent).toBe("First");
    await vi.advanceTimersByTimeAsync(1);
    expect(ui.el.querySelectorAll(".toast")).toHaveLength(1);
    expect(el(ui, ".toast-msg").textContent).toBe("Second");
    await vi.advanceTimersByTimeAsync(2700);
    expect(el(ui, ".toast-msg").textContent).toBe("Third");
    await vi.advanceTimersByTimeAsync(2700);
    expect(ui.el.querySelectorAll(".toast")).toHaveLength(0);
    expect(ui.el.querySelectorAll(".feed-row")).toHaveLength(3);
  });

  it("routes routine gains and Feed messages only to history with an unread badge", () => {
    const ui = mount();
    ui.toast("+3 Gold from combos", "good");
    ui.feed("A lorry arrived");
    expect(ui.el.querySelectorAll(".toast")).toHaveLength(0);
    expect(badge(ui, "feed").textContent).toBe("2");
    ui.setTab("feed");
    expect(badge(ui, "feed").classList.contains("hidden")).toBe(true);
    ui.feed("Another lorry arrived");
    expect(badge(ui, "feed").classList.contains("hidden")).toBe(true);
    el(ui, '[data-tab="feed"]').click();
    ui.feed("A new arrival");
    expect(badge(ui, "feed").textContent).toBe("1");
  });

  it("allows explicit priority without changing the message tone", () => {
    const ui = mount();
    ui.toast("Routine update", "info", "low");
    ui.toast("Important good news", "good", "normal");
    expect(ui.el.querySelectorAll(".toast")).toHaveLength(1);
    expect(el(ui, ".toast-msg").textContent).toBe("Important good news");
    expect(ui.el.querySelectorAll(".feed-row")).toHaveLength(2);
  });

  it("makes all forty retained messages readable and bounds history and unread count", () => {
    const ui = mount();
    for (let i = 0; i < 45; i++) ui.feed(`Delivery ${i}`);
    expect(ui.el.querySelectorAll(".feed-row")).toHaveLength(40);
    expect(badge(ui, "feed").textContent).toBe("40");
    expect(el(ui, ".feed-pane").textContent).toContain("Delivery 5");
    expect(el(ui, ".feed-pane").textContent).not.toContain("Delivery 0");
  });

  it("does not acknowledge messages behind a blocking session", () => {
    const ui = mount();
    ui.setTab("feed");
    ui.paint(state({ tuning: { kind: "depot", cargo: "wood", moves: 10, movesLeft: 10, score: 0, yield: 1, abandonYield: 1 } }));
    ui.feed("Delivery while tuning");
    expect(badge(ui, "feed").textContent).toBe("1");
    ui.paint(state());
    expect(badge(ui, "feed").classList.contains("hidden")).toBe(true);
  });

  it.each([true, false])("deduplicates the Feed/Toast doors in either order (feed first: %s)", (feedFirst) => {
    const ui = mount();
    if (feedFirst) ui.feed("Bank trade done");
    ui.toast("Bank trade done.", "success");
    if (!feedFirst) ui.feed("Bank trade done");
    expect(ui.el.querySelectorAll(".feed-row")).toHaveLength(1);
    expect(ui.el.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("treats message text as text, not markup", () => {
    const ui = mount();
    ui.toast("<img src=x onerror=alert(1)>", "info");
    expect(el(ui, ".toast-msg").querySelector("img")).toBeNull();
    expect(el(ui, ".feed-row").textContent).toContain("<img");
  });

  it("drops a detached game's pending queue", async () => {
    const ui = mount();
    ui.toast("First");
    ui.toast("Second");
    ui.el.remove();
    await vi.advanceTimersByTimeAsync(2700);
    expect(ui.el.querySelectorAll(".toast")).toHaveLength(0);
  });
});

it("scopes radio compaction to desktop and exposes controls on focus as well as hover", () => {
  const css = readFileSync("src/game/theme-space-age.css", "utf8");
  const rules = css.slice(css.indexOf("/* HUD-1:"));
  expect(rules).toContain("@media (min-width: 761px)");
  expect(rules).toContain('.ui-root:not([data-phone="1"]) .radio-pill:not(:hover):not(:focus-within) > :not(.radio-play)');
});
