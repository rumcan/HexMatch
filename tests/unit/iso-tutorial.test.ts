// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// TUT-01 — the starting tutorial (src/iso/tutorial.ts).
//
// Pinned here, in the order the module's own header states its rules:
//
//   1. THE GATE. It opens on a first game and never again once the player has
//      pressed "Never show this again" — a stored preference, not a phase
//      inference — and `?tutorial=0/1` overrides it for playtest links, the
//      e2e gameplay specs and a reviewer who wants to look again.
//   2. THE COPY IS READ, NOT TYPED. Every price, ★ value, board dimension and
//      allowance in the tour is interpolated from the authoritative tables, so
//      a rebalance moves the lesson with the rule. The drift guard at the
//      bottom of that block is the point: change the numbers, the text changes.
//   3. THE PROJECTOR. Steps walk forward and back, the dots jump, Esc/✕/the
//      veil skip WITHOUT persisting, and the one button that persists says so
//      on the card.
//   4. THE ASK. The six things the ticket named — plant, depot, roads, match-3,
//      the truck that feeds the board, and how points are won — are each
//      actually on screen, in that order.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TUTORIAL_NEVER, TUTORIAL_STORAGE_KEY, buildTutorialSteps, isTutorialDismissed,
  setTutorialDismissed, shouldShowTutorial, showTutorial,
  type TutorialHandle, type TutorialResult,
} from "../../src/iso/tutorial";
import { BOARD_H, BOARD_W } from "../../src/game/config";
import { BANK_RATE } from "../../src/game/trade";
import { CARGOES, TRANSPORT, UPGRADE_COST, VICTORY } from "../../src/iso/config";
import { DEPOT_COST, costCompact, costLabel } from "../../src/iso/construction";
import { PLANT_COST } from "../../src/iso/plants";
import { fmtVp } from "../../src/iso/victory";

/** The boot context game.ts passes: the shipped line and the full allowance. */
const CTX = { vpTarget: VICTORY.target, freeTrack: 12 };
/** A read-only storage stub, the shape the skill-picker tests use. */
const store = (init: Record<string, string> = {}) => ({
  getItem: (k: string) => (k in init ? init[k] : null),
  setItem: (k: string, v: string) => { init[k] = v; },
  removeItem: (k: string) => { delete init[k]; },
});

const STEP_IDS = ["loop", "plant", "depot", "roads", "board", "expand", "victory", "desk"];

let host: HTMLDivElement;
let open: TutorialHandle | null = null;

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  open?.destroy();
  open = null;
});

/** Open the tour (never gated) and return both the handle and its result. */
function show(opts: Parameters<typeof showTutorial>[1] = {}) {
  const handle = showTutorial(host, { force: true, ...opts });
  expect(handle, "the tour did not open").toBeTruthy();
  open = handle;
  return handle!;
}
const card = () => host.querySelector("#iso-tutorial") as HTMLElement | null;
const click = (sel: string) => {
  const btn = card()!.querySelector(sel) as HTMLElement | null;
  expect(btn, `no ${sel} on the card`).toBeTruthy();
  btn!.click();
};
const key = (k: string, init: KeyboardEventInit = {}) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { key: k, cancelable: true, ...init }));

// ── 1. the gate ───────────────────────────────────────────────────────────
describe("TUT-01 gating", () => {
  it("opens for a first game with nothing remembered", () => {
    expect(shouldShowTutorial("", null)).toBe(true);
    expect(shouldShowTutorial("?seed=79", store({}))).toBe(true);
    // a remembered DIFFERENT preference is not this one
    expect(shouldShowTutorial("", store({ "hexmatch:rival-skill": "easy" }))).toBe(true);
  });

  it("stays shut once the player pressed never-show-again", () => {
    expect(shouldShowTutorial("", store({ [TUTORIAL_STORAGE_KEY]: TUTORIAL_NEVER }))).toBe(false);
    expect(shouldShowTutorial("?seed=79&rival=hard", store({ [TUTORIAL_STORAGE_KEY]: TUTORIAL_NEVER }))).toBe(false);
  });

  it("ignores a corrupted value instead of silencing the tour forever", () => {
    expect(isTutorialDismissed(store({ [TUTORIAL_STORAGE_KEY]: "banana" }))).toBe(false);
    expect(shouldShowTutorial("", store({ [TUTORIAL_STORAGE_KEY]: "banana" }))).toBe(true);
  });

  it("takes the URL's word either way", () => {
    expect(shouldShowTutorial("?tutorial=0", store({}))).toBe(false);
    expect(shouldShowTutorial("tutorial=off", store({}))).toBe(false);
    expect(shouldShowTutorial("?seed=79&tutorial=0", store({}))).toBe(false);
    // …and an explicit ON beats a stored dismissal (a reviewer, a screenshot)
    expect(shouldShowTutorial("?tutorial=1", store({ [TUTORIAL_STORAGE_KEY]: TUTORIAL_NEVER }))).toBe(true);
    // junk is no opinion at all
    expect(shouldShowTutorial("?tutorial=banana", store({}))).toBe(true);
  });

  it("renders nothing at all when gated off, and opens when forced", () => {
    expect(showTutorial(host, {
      search: "", storage: store({ [TUTORIAL_STORAGE_KEY]: TUTORIAL_NEVER }),
    })).toBeNull();
    expect(card()).toBeNull();

    const forced = showTutorial(host, {
      force: true, search: "", storage: store({ [TUTORIAL_STORAGE_KEY]: TUTORIAL_NEVER }),
    });
    expect(forced).toBeTruthy();
    expect(card()).toBeTruthy();
    forced!.destroy();
  });

  it("persists through the real localStorage the boot reads", () => {
    expect(isTutorialDismissed(localStorage)).toBe(false);
    setTutorialDismissed(true, localStorage);
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe(TUTORIAL_NEVER);
    expect(isTutorialDismissed(localStorage)).toBe(true);
    // "not dismissed" is the ABSENCE of a record, never a second value
    setTutorialDismissed(false, localStorage);
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();
  });

  it("survives a storage that throws (private mode)", () => {
    const hostile = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(isTutorialDismissed(hostile)).toBe(false);
    expect(shouldShowTutorial("", hostile)).toBe(true);
    expect(() => setTutorialDismissed(true, hostile)).not.toThrow();
  });
});

// ── 2. the copy is read from the tables ───────────────────────────────────
describe("TUT-01 content", () => {
  const steps = buildTutorialSteps(CTX);
  const byId = (id: string) => steps.find((s) => s.id === id)!;
  const text = (id: string) => {
    const s = byId(id);
    return [s.kicker, s.title, s.lede ?? "", ...s.points, s.tip ?? "", JSON.stringify(s.figure ?? null)].join(" ");
  };

  it("walks the loop in the order the player meets it", () => {
    expect(steps.map((s) => s.id)).toEqual(STEP_IDS);
    for (const s of steps) {
      expect(s.id).toBeTruthy();
      expect(s.kicker.length, `${s.id} has no kicker`).toBeGreaterThan(0);
      expect(s.title.length, `${s.id} has no title`).toBeGreaterThan(0);
      expect(s.points.length, `${s.id} has no bullets`).toBeGreaterThanOrEqual(3);
      for (const p of s.points) expect(p.length, `${s.id} has an empty bullet`).toBeGreaterThan(20);
    }
  });

  it("quotes the authoritative prices, not a retyped number", () => {
    expect(text("depot")).toContain(costLabel(DEPOT_COST));
    expect(text("roads")).toContain(costCompact(TRANSPORT.dirt.cost));
    expect(text("roads")).toContain(costCompact(TRANSPORT.road.cost));
    expect(text("roads")).toContain(costCompact(UPGRADE_COST));
    expect(text("roads")).toContain(String(CTX.freeTrack));
    expect(text("plant")).toContain(costCompact(PLANT_COST));
    expect(text("expand")).toContain(costCompact(PLANT_COST));
    expect(text("expand")).toContain(String(BANK_RATE));
  });

  it("quotes the victory table and the live ★ line", () => {
    const win = text("victory");
    expect(win).toContain(`+${fmtVp(VICTORY.upgrade)}★`);
    expect(win).toContain(`+${fmtVp(VICTORY.plant)}★`);
    expect(win).toContain(`${fmtVp(CTX.vpTarget)}★`);
    // the two things that score nothing are named as scoring nothing
    expect(win).toContain("0★");
  });

  it("quotes the board it is describing", () => {
    expect(text("board")).toContain(`${BOARD_W}×${BOARD_H}`);
    const fig = byId("board").figure;
    expect(fig?.kind).toBe("board");
    if (fig?.kind === "board") {
      expect(fig.cells.length % fig.cols).toBe(0);
      expect(fig.cells.some((c) => c.token === 1)).toBe(true);
      expect(fig.cells.some((c) => c.token === 2)).toBe(true);
      expect(fig.cells.filter((c) => c.hit).length).toBeGreaterThanOrEqual(3);
      for (const c of fig.cells) if (c.cargo) expect(CARGOES).toContain(c.cargo);
    }
  });

  it("moves with a rebalance — the drift guard", () => {
    // Same builder, different world: an Easy-chair race with a 3-tile allowance.
    // If any of these numbers were typed into the copy instead of read, the
    // text below would still say 12 and 10★.
    const other = buildTutorialSteps({ vpTarget: 5, freeTrack: 3 });
    const join = (id: string) => {
      const s = other.find((x) => x.id === id)!;
      return [s.title, s.lede ?? "", ...s.points, s.tip ?? "", JSON.stringify(s.figure ?? null)].join(" ");
    };
    expect(join("victory")).toContain(`${fmtVp(5)}★`);
    expect(join("victory")).not.toContain(`${fmtVp(VICTORY.target)}★`);
    expect(join("roads")).toContain("first 3 of them");
    expect(join("roads")).not.toContain("first 12 of them");
  });

  it("says the rule about the two exits on the card itself", () => {
    show();
    expect(card()!.textContent).toMatch(/never show this again/i);
    expect(card()!.textContent).toMatch(/replay it any time from the ❔/i);
  });
});

// ── 3. the projector ──────────────────────────────────────────────────────
describe("TUT-01 the card", () => {
  it("opens on the first step with one dot per step", () => {
    show();
    const screen = card()!;
    expect(screen.getAttribute("role")).toBe("dialog");
    expect(screen.getAttribute("aria-modal")).toBe("true");
    expect(screen.dataset.step).toBe("loop");
    expect(screen.querySelectorAll(".tut-dot")).toHaveLength(STEP_IDS.length);
    expect(screen.querySelector(".tut-dot.on")!.getAttribute("data-step")).toBe("loop");
    expect(screen.querySelector(".tut-title")!.textContent).toBe("One island, one loop");
    // the loop figure is the chain, one node per station
    expect(screen.querySelectorAll(".tut-chain-node")).toHaveLength(7);
    expect(screen.querySelectorAll(".tut-points li").length).toBeGreaterThanOrEqual(3);
    // Back has nowhere to go on step one
    const prev = screen.querySelector('[data-act="tut-prev"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it("is one veil and one card — the overlay centres a single in-flow child", () => {
    show();
    const screen = card()!;
    // `#iso-tutorial` is a ROW flex container that centres what it holds. The
    // veil is out of flow, so the card must be the only in-flow child: a third
    // one (the note about the two exits used to be appended here) sits BESIDE
    // the card and squeezes it — and because the footer's keys are
    // `flex: 0 0 auto` they cannot shrink, so on a phone-width viewport they
    // are pushed out of the plate and out of reach of a click.
    expect([...screen.children].map((n) => n.className)).toEqual(["tut-shade", "tut-card"]);
    const plate = screen.querySelector(".tut-card")!;
    expect([...plate.children].map((n) => n.className))
      .toEqual(["tut-head", "tut-body", "tut-foot", "tut-note"]);
    expect(plate.querySelector(".tut-note")!.textContent).toMatch(/never show this again/i);
    // the footer holds all three controls, in the order the eye reads them
    expect([...plate.querySelector(".tut-foot")!.children].map((n) => n.className))
      .toEqual(["tut-never", "tut-dots", "tut-nav"]);
  });

  it("walks forward to the last step and closes as done", async () => {
    const handle = show();
    for (const id of STEP_IDS.slice(1)) {
      click('[data-act="tut-next"]');
      expect(card()!.dataset.step).toBe(id);
    }
    // the last step's key becomes the one that ends the tour
    const done = card()!.querySelector('[data-act="tut-done"]') as HTMLElement;
    expect(done).toBeTruthy();
    expect(done.textContent).toMatch(/start playing/i);
    done.click();
    const r: TutorialResult = await handle.promise;
    expect(r).toEqual({ reason: "done", step: "desk", index: STEP_IDS.length });
    expect(card()).toBeNull();
    // finishing the tour is NOT the same as dismissing it
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();
  });

  it("steps back, and jumps when a dot is clicked", () => {
    show();
    click('[data-act="tut-next"]');
    click('[data-act="tut-next"]');
    expect(card()!.dataset.step).toBe("depot");
    click('[data-act="tut-prev"]');
    expect(card()!.dataset.step).toBe("plant");
    click('[data-step="victory"]');
    expect(card()!.dataset.step).toBe("victory");
    expect(card()!.querySelector(".tut-dot.on")!.getAttribute("data-step")).toBe("victory");
  });

  it("drives from the keyboard: arrows walk, Home/End jump, Esc skips", async () => {
    const handle = show();
    key("ArrowRight");
    expect(card()!.dataset.step).toBe("plant");
    key("ArrowRight");
    key("ArrowLeft");
    expect(card()!.dataset.step).toBe("plant");
    key("End");
    expect(card()!.dataset.step).toBe("desk");
    key("Home");
    expect(card()!.dataset.step).toBe("loop");
    // ArrowRight off the last step is the same as pressing the last key
    key("End");
    key("ArrowRight");
    expect(await handle.promise).toMatchObject({ reason: "done", step: "desk" });
  });

  it("skips from ✕, from Esc and from the veil — and never persists", async () => {
    const a = show();
    click('[data-act="tut-close"]');
    expect(await a.promise).toMatchObject({ reason: "skip", step: "loop", index: 1 });
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();

    const b = show();
    key("Escape");
    expect(await b.promise).toMatchObject({ reason: "skip" });

    const c = show();
    (card()!.querySelector(".tut-shade") as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    expect(await c.promise).toMatchObject({ reason: "skip" });
    expect(card()).toBeNull();
  });

  it("the never-show-again button is the only exit that remembers", async () => {
    const handle = show();
    click('[data-act="tut-never"]');
    const r = await handle.promise;
    expect(r.reason).toBe("never");
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe(TUTORIAL_NEVER);
    expect(isTutorialDismissed(localStorage)).toBe(true);
    expect(card()).toBeNull();
    // …and the next boot reads that key
    expect(shouldShowTutorial("", localStorage)).toBe(false);
  });

  it("resolves once, however often it is closed", async () => {
    const handle = show();
    handle.close("never");
    handle.close("skip");
    handle.destroy();
    expect(await handle.promise).toMatchObject({ reason: "never" });
  });

  it("destroy settles the promise so an awaiting boot cannot hang", async () => {
    const handle = show();
    handle.destroy();
    await expect(handle.promise).resolves.toMatchObject({ reason: "skip" });
    expect(card()).toBeNull();
  });

  it("reports how far the player got", async () => {
    const handle = show();
    click('[data-act="tut-next"]');
    click('[data-act="tut-next"]');
    click('[data-act="tut-next"]');
    key("Escape");
    expect(await handle.promise).toMatchObject({ reason: "skip", step: "roads", index: 4 });
  });

  it("fires onClose with the same result", async () => {
    let seen: TutorialResult | null = null;
    const handle = show({ onClose: (r) => { seen = r; } });
    click('[data-act="tut-never"]');
    expect(await handle.promise).toEqual(seen);
  });

  it("traps Tab inside the card while it is the only thing that matters", () => {
    show();
    const next = card()!.querySelector(".tut-next") as HTMLElement;
    next.focus();
    key("Tab");
    // the loop is never → back(hidden) → next → dots → ✕, and wraps
    expect(document.activeElement).toBe(card()!.querySelector(".tut-dot"));
    const x = card()!.querySelector('[data-act="tut-close"]') as HTMLElement;
    x.focus();
    key("Tab");
    expect(document.activeElement).toBe(card()!.querySelector('[data-act="tut-never"]'));
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(x);
  });
});

// ── 4. the figures ────────────────────────────────────────────────────────
describe("TUT-01 figures", () => {
  const figureAt = (id: string) => {
    show();
    card()!.querySelector(`[data-step="${id}"]`)!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return card()!.querySelector(".tut-fig") as HTMLElement;
  };

  it("paints the plant step as a mini-map with a legal and a refused footprint", () => {
    const fig = figureAt("plant");
    expect(fig.classList.contains("tut-fig-iso")).toBe(true);
    expect(fig.querySelectorAll(".tut-tile")).toHaveLength(12);
    // the same four-tile footprint twice: once beside a town, once not
    expect(fig.querySelectorAll(".t-plant.ring-good")).toHaveLength(4);
    expect(fig.querySelectorAll(".ring-bad")).toHaveLength(4);
    expect(fig.querySelectorAll(".t-town")).toHaveLength(4);
    // every diamond is positioned on the map's own 2:1 lattice
    const tile = fig.querySelector(".tut-tile") as HTMLElement;
    expect(tile.style.width).toBe("46px");
    expect(tile.style.height).toBe("23px");
    expect(tile.style.left).toMatch(/px$/);
  });

  it("paints the depot catchment and the road run", () => {
    const depot = figureAt("depot");
    // the dotted 4×4 the rule is named after, and nothing else dotted
    expect(depot.querySelectorAll(".tut-tile.ring-route")).toHaveLength(16);
    expect(depot.querySelectorAll(".t-depot")).toHaveLength(1);
    // one industry inside the catchment, one outside it that collects nothing
    expect(depot.querySelectorAll(".t-industry")).toHaveLength(2);
    expect(depot.querySelector(".t-depot.ring-good")).toBeTruthy();

    const roads = figureAt("roads");
    expect(roads.querySelectorAll(".t-dirt")).toHaveLength(2);
    expect(roads.querySelectorAll(".t-road")).toHaveLength(2);
    expect(roads.textContent).toContain("🚚");
    expect(roads.textContent).toContain("🏭");
  });

  it("paints the board step with the real gem art and token badges", () => {
    const fig = figureAt("board");
    const gems = [...fig.querySelectorAll(".tut-gem")] as HTMLElement[];
    expect(gems).toHaveLength(20);
    expect(gems.filter((g) => g.style.backgroundImage.includes("url(")).length)
      .toBe(gems.filter((g) => g.dataset.cargo).length);
    expect(fig.querySelectorAll(".tut-gem-token")).toHaveLength(3);
    expect(fig.querySelector(".tut-gem-token.t2")).toBeTruthy();
    expect(fig.querySelectorAll(".tut-gem-hit")).toHaveLength(3);
    // the cargo each cell shows is a real cargo, and the badge is its tier
    for (const g of gems) if (g.dataset.cargo) expect(CARGOES).toContain(g.dataset.cargo as never);
  });

  it("itemises the point sources on the victory ledger", () => {
    const fig = figureAt("victory");
    const rows = [...fig.querySelectorAll(".tut-ledger-row")];
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain(`+${fmtVp(VICTORY.upgrade)}★`);
    expect(rows[1].textContent).toContain(`+${fmtVp(VICTORY.plant)}★`);
    expect(rows[2].classList.contains("dim")).toBe(true);
    expect(rows[2].textContent).toContain("0★");
    expect(fig.querySelector(".tut-ledger-total")!.textContent)
      .toContain(`${fmtVp(CTX.vpTarget)}★`);
  });
});

// ── 5. the ask, item by item ──────────────────────────────────────────────
describe("TUT-01 the ticket's six sentences are all on screen", () => {
  const all = () => buildTutorialSteps(CTX)
    .map((s) => [s.title, s.lede ?? "", ...s.points, s.tip ?? ""].join(" ")).join(" ");

  it("you build a processing plant", () => {
    expect(all()).toMatch(/processing plant/i);
    expect(buildTutorialSteps(CTX)[1].title).toMatch(/processing plant/i);
  });

  it("you build a depot", () => {
    expect(buildTutorialSteps(CTX)[2].title).toMatch(/depot/i);
    expect(all()).toMatch(/4×4 catchment/);
  });

  it("you connect them with roads", () => {
    expect(buildTutorialSteps(CTX)[3].title).toMatch(/road/i);
    expect(all()).toMatch(/dirt road/i);
  });

  it("and then you play match 3", () => {
    expect(buildTutorialSteps(CTX)[4].title).toMatch(/match-3/i);
    expect(all()).toMatch(/swap two/i);
  });

  it("trucks create resources in your matching board", () => {
    expect(all()).toMatch(/lorry/i);
    expect(all()).toMatch(/delivery stamps a/i);
    expect(all()).toMatch(/token/i);
  });

  it("which you use to expand", () => {
    expect(all()).toMatch(/purse/i);
    expect(buildTutorialSteps(CTX)[5].title).toMatch(/empire/i);
  });

  it("and how to gain win points", () => {
    expect(buildTutorialSteps(CTX)[6].title).toMatch(/victory points/i);
    expect(all()).toMatch(/first to .*★ wins/i);
  });
});
