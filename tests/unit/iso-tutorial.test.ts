// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// TUT-01 — the starting tutorial (src/iso/tutorial.ts).
//
// Pinned here, in the order the module's own header states its rules:
//
//   1. THE GATE. The module owns the storage half of "opens on a first game":
//      `shouldShowTutorial` says yes on a clean shelf, no once the player has
//      pressed "Never show this again", and `?tutorial=0/1` overrides for
//      playtest links, the e2e gameplay specs and a reviewer who wants to
//      look again. `showTutorial` honours the same gate unless asked with
//      `force` (the ❔ help modal's replay is exactly that).
//   2. THE COPY IS READ, NOT TYPED. Every price, ★ value and allowance in the
//      tour is interpolated from the authoritative tables, so a rebalance
//      moves the lesson with the rule. The drift guard at the bottom of the
//      block is the point: change the numbers, the text changes.
//   3. THE PROJECTOR. One card, painted with the shipped `.tut-*` CSS
//      classes and the `data-step`/`data-act` hooks the e2e suite walks.
//      Back/Next walk the steps, ✕ and the veil dismiss WITHOUT persisting,
//      "Never show this again" is the one exit that remembers — and says so,
//      and the last step's key starts production WITHOUT dismissing the tour.
//   4. THE DESK CARD names the rail that exists, on each loop (#226, #299):
//      the retired loop keeps Processing Plant/Feed, the new loop gets Bank,
//      Feed and the session window — and neither names the retired Market tab.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  TUTORIAL_NEVER, TUTORIAL_STORAGE_KEY, buildTutorialSteps, isTutorialDismissed,
  setTutorialDismissed, shouldShowTutorial, showTutorial,
  type TutorialHandle, type TutorialResult,
} from "../../src/iso/tutorial";
import { CARGOES, TRANSPORT, VICTORY, TUNING } from "../../src/iso/config";
import { DEPOT_COST, costCompact, costLabel } from "../../src/iso/construction";
import { fmtVp } from "../../src/iso/victory";

/** The boot context game.ts passes: the shipped line and the full allowance. */
const CTX = { vpTarget: VICTORY.loop.target, freeTrack: 12 };
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

/** Open the tour (never gated) and remember the handle for teardown. */
function show(opts: Partial<Parameters<typeof showTutorial>[1]> = {}) {
  const handle = showTutorial(host, { force: true, ...CTX, ...opts });
  expect(handle, "the tour did not open").toBeTruthy();
  open = handle;
  return handle!;
}
const tour = () => host.querySelector("#iso-tutorial") as HTMLElement | null;
const click = (sel: string) => {
  const btn = tour()!.querySelector(sel) as HTMLElement | null;
  expect(btn, `no ${sel} on the card`).toBeTruthy();
  btn!.click();
};

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
      ...CTX, search: "", storage: store({ [TUTORIAL_STORAGE_KEY]: TUTORIAL_NEVER }),
    })).toBeNull();
    expect(tour()).toBeNull();

    const forced = showTutorial(host, {
      ...CTX, force: true, search: "", storage: store({ [TUTORIAL_STORAGE_KEY]: TUTORIAL_NEVER }),
    });
    expect(forced).toBeTruthy();
    expect(tour()).toBeTruthy();
    forced!.destroy();
  });

  it("honours the URL opt-out the e2e gameplay specs boot with", () => {
    expect(showTutorial(host, { ...CTX, search: "?tutorial=0", storage: store({}) })).toBeNull();
    expect(tour()).toBeNull();
    // …without writing the preference — the next plain boot asks again
    const again = showTutorial(host, { ...CTX, search: "", storage: store({}) });
    expect(again).toBeTruthy();
    again!.destroy();
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

  it("the boot's own storage is what the default gate reads", () => {
    // No opts.search / opts.storage at all: the module consults the live
    // localStorage, exactly as the game.ts boot chain does.
    setTutorialDismissed(true, localStorage);
    expect(showTutorial(host, { ...CTX })).toBeNull();
    setTutorialDismissed(false, localStorage);
    const shown = showTutorial(host, { ...CTX });
    expect(shown).toBeTruthy();
    shown!.destroy();
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
      expect(s.points.length, `${s.id} has too few bullets`).toBeGreaterThanOrEqual(3);
      for (const p of s.points) expect(p.length, `${s.id} has an empty bullet`).toBeGreaterThan(20);
    }
  });

  it("quotes the authoritative prices, not a retyped number", () => {
    expect(text("depot")).toContain(costLabel(DEPOT_COST));
    expect(text("roads")).toContain(costCompact(TRANSPORT.dirt.cost));
    expect(text("roads")).toContain(String(CTX.freeTrack));
  });

  it("quotes the victory table and the live ★ line", () => {
    const win = text("victory");
    expect(win).toContain(`First to ${CTX.vpTarget}★ wins`);
    expect(win).toContain(`+${fmtVp(VICTORY.loop.type)}★`);
    expect(win).toContain(`+${fmtVp(VICTORY.loop.rung)}★`);
    expect(win).toContain(`+${fmtVp(VICTORY.loop.city)}★`);
    expect(win).toContain(`+${fmtVp(VICTORY.platform)}★`);
    // …and the tour says plainly that roads themselves score nothing
    expect(win).toMatch(/roads themselves score nothing/i);
  });

  it("quotes the tuning session it is describing", () => {
    expect(text("board")).toContain(`×${TUNING.minYield}`);
    expect(text("board")).toContain(`×${TUNING.maxYield}`);
    expect(text("board")).toMatch(/bounded/i);
    expect(text("board")).toMatch(/Finish keeps/i);
    expect(text("board")).toMatch(/Retune/i);
    // the figure is the live screenshot of that same board
    const fig = byId("board").figure;
    expect(fig?.kind).toBe("shot");
    if (fig?.kind === "shot") {
      expect(fig.src).toMatch(/board.*\.webp/);
      expect(fig.caption).toMatch(/swap two/i);
    }
  });

  it("names every cargo the loop can carry", () => {
    for (const c of CARGOES) expect(text("loop").toLowerCase()).toContain(c);
  });

  it("moves with a rebalance — the drift guard", () => {
    // Same builder, different world: an Easy-chair race with a 3-tile allowance.
    // If any of these numbers were typed into the copy instead of read, the
    // text below would still say 12★ and 12 tiles.
    const other = buildTutorialSteps({ vpTarget: 5, freeTrack: 3 });
    const join = (id: string) => {
      const s = other.find((x) => x.id === id)!;
      return [s.title, s.lede ?? "", ...s.points, s.tip ?? "", JSON.stringify(s.figure ?? null)].join(" ");
    };
    expect(join("victory")).toContain("First to 5★ wins");
    expect(join("victory")).not.toContain(`First to ${VICTORY.loop.target}★ wins`);
    expect(join("roads")).toContain("first 3 of them");
    expect(join("roads")).not.toContain("first 12 of them");
  });
});

// ── 3. the projector ──────────────────────────────────────────────────────
describe("TUT-01 the card", () => {
  it("opens on the first step, dressed in the shipped classes", () => {
    show();
    const screen = tour()!;
    expect(screen.getAttribute("role")).toBe("dialog");
    expect(screen.getAttribute("aria-modal")).toBe("true");
    expect(screen.dataset.step).toBe("loop");
    expect(screen.querySelector(".tut-title")!.textContent).toBe("One island, one loop");
    // the loop figure is the chain, one node per station, arrows between
    expect(screen.querySelectorAll(".tut-chain-node")).toHaveLength(6);
    expect(screen.querySelectorAll(".tut-points li").length).toBeGreaterThanOrEqual(3);
    // Back has nowhere to go on step one
    expect((screen.querySelector('[data-act="tut-prev"]') as HTMLButtonElement).disabled).toBe(true);
    // …and the walker's key is Next until the last step — never an early Done
    expect(screen.querySelector('[data-act="tut-done"]')).toBeNull();
    expect(screen.querySelector('[data-act="tut-next"]')!.textContent).toMatch(/next/i);
  });

  it("walks forward to the last step and closes as finished — not dismissed", async () => {
    const handle = show();
    for (const id of STEP_IDS.slice(1)) {
      click('[data-act="tut-next"], [data-act="tut-done"]');
      expect(tour()!.dataset.step).toBe(id);
    }
    // the last step's key becomes the one that starts production
    const done = tour()!.querySelector('[data-act="tut-done"]') as HTMLElement;
    expect(done.textContent).toMatch(/start production/i);
    done.click();
    const r: TutorialResult = await handle.promise;
    expect(r).toEqual({ reason: "finished" });
    expect(tour()).toBeNull();
    // finishing the tour is NOT the same as dismissing it
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();
  });

  it("steps back over the same ground it walked forward", () => {
    show();
    click('[data-act="tut-next"]');
    click('[data-act="tut-next"]');
    expect(tour()!.dataset.step).toBe("depot");
    click('[data-act="tut-prev"]');
    expect(tour()!.dataset.step).toBe("plant");
    expect((tour()!.querySelector('[data-act="tut-prev"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it("closes from ✕ and from the veil — and never persists", async () => {
    const a = show();
    click('[data-act="tut-close"]');
    expect(await a.promise).toEqual({ reason: "dismissed" });
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();

    const c = show();
    tour()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(await c.promise).toEqual({ reason: "dismissed" });
    expect(tour()).toBeNull();
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBeNull();
  });

  it("a click INSIDE the card never closes it", () => {
    const handle = show();
    tour()!.querySelector(".tut-card")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(tour()).toBeTruthy();   // still standing
    handle.destroy();
  });

  it("the never-show-again button is the only exit that remembers", async () => {
    const handle = show();
    click('[data-act="tut-never"]');
    const r = await handle.promise;
    expect(r.reason).toBe("never");
    expect(localStorage.getItem(TUTORIAL_STORAGE_KEY)).toBe(TUTORIAL_NEVER);
    expect(isTutorialDismissed(localStorage)).toBe(true);
    expect(tour()).toBeNull();
    // …and the next boot reads that key through the same live storage
    expect(shouldShowTutorial("", localStorage)).toBe(false);
    expect(showTutorial(host, { ...CTX })).toBeNull();
  });

  it("resolves once, however often it is closed", async () => {
    let closes = 0;
    const handle = show({ onClose: () => { closes++; } });
    handle.close("never");
    handle.close("dismissed");
    handle.destroy();
    expect(await handle.promise).toEqual({ reason: "never" });
    expect(closes).toBe(1);
  });

  it("destroy settles the promise so an awaiting boot cannot hang", async () => {
    const handle = show();
    handle.destroy();
    await expect(handle.promise).resolves.toEqual({ reason: "dismissed" });
    expect(tour()).toBeNull();
  });

  it("fires onClose with the same result", async () => {
    let seen: TutorialResult | null = null;
    const handle = show({ onClose: (r) => { seen = r; } });
    click('[data-act="tut-never"]');
    expect(await handle.promise).toEqual(seen);
  });
});

// ── 4. the figures ────────────────────────────────────────────────────────
describe("TUT-01 figures", () => {
  const figureAt = (id: string) => {
    show();
    for (let guard = 0; guard < STEP_IDS.length && tour()!.dataset.step !== id; guard++) {
      click('[data-act="tut-next"]');
    }
    expect(tour()!.dataset.step).toBe(id);
    return tour()!.querySelector(".tut-fig") as HTMLElement;
  };

  it("shows a real screenshot of the game on every map and HUD step", () => {
    const shots = ["plant", "depot", "roads", "board", "expand", "desk"];
    const srcs = new Set<string>();
    for (const id of shots) {
      const fig = figureAt(id);
      expect(fig.classList.contains("tut-fig-shot"), `${id} is a screenshot`).toBe(true);
      const img = fig.querySelector("img.tut-shot") as HTMLImageElement;
      expect(img, `${id} paints an image`).toBeTruthy();
      expect(img.getAttribute("src"), `${id} src`).toMatch(new RegExp(`${id}.*\\.webp`));
      expect(img.alt.length, `${id} alt text`).toBeGreaterThan(10);
      expect(fig.querySelector(".tut-fig-cap")!.textContent!.length, `${id} caption`).toBeGreaterThan(20);
      srcs.add(img.getAttribute("src")!);
    }
    expect(srcs.size, "every step has its own screenshot").toBe(shots.length);
  });

  it("itemises the point sources on the victory ledger", () => {
    const fig = figureAt("victory");
    const rows = [...fig.querySelectorAll(".tut-ledger-row")];
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain(`+${fmtVp(VICTORY.loop.type)}★`);
    expect(rows[1].textContent).toContain(`+${fmtVp(VICTORY.loop.rung)}★`);
    expect(rows[2].textContent).toContain(`+${fmtVp(VICTORY.loop.city)}★`);
    expect(rows[3].textContent).toContain(`+${fmtVp(VICTORY.platform)}★`);
    // the caption prints the line the seat is racing — the live ★ target
    expect(fig.querySelector(".tut-fig-cap")!.textContent).toContain(`${CTX.vpTarget}★`);
  });
});

// ── 5. the new loop's asks, step by step ──────────────────────────────────
describe("TUT-01 the tour teaches the loop the game runs", () => {
  const steps = buildTutorialSteps(CTX);

  it("your city is the hub", () => {
    expect(steps[1].id).toBe("plant");
    expect(steps[1].title).toMatch(/city/i);
  });

  it("you build a depot beside a resource node", () => {
    expect(steps[2].title).toMatch(/depot/i);
    expect(JSON.stringify(steps[2])).toMatch(/4×4 catchment/);
  });

  it("you connect it with roads, and the first tiles are on the house", () => {
    expect(steps[3].title).toMatch(/road/i);
    expect(JSON.stringify(steps[3])).toMatch(/dirt road/i);
    expect(JSON.stringify(steps[3])).toContain(`the first ${CTX.freeTrack} of them`);
  });

  it("and then match-3 tunes what the depot ticks", () => {
    expect(steps[4].title).toMatch(/match-3/i);
    expect(JSON.stringify(steps[4])).toMatch(/swap two/i);
    expect(JSON.stringify(steps[4])).toMatch(/yield/i);
  });

  it("the cargo you collect is what you spend", () => {
    expect(steps[5].title).toMatch(/empire/i);
    expect(JSON.stringify(steps[5])).toMatch(/purse/i);
  });

  it("and the ★ line is how you win", () => {
    expect(steps[6].title).toMatch(/victory points/i);
    expect(steps[6].lede).toMatch(new RegExp(`First to ${CTX.vpTarget}★ wins`, "i"));
  });
});

// ── L11 (#226) / #299: the desk card names the rail that exists ───────────
describe("the desk card names the rail that exists, on both loops", () => {
  // The Market tab is gone on EVERY loop. The retired loop keeps its Plant
  // tab; on the new loop the session owns a window over the map (#299) and
  // the rail is Bank / Feed over the plant's idle card.
  const captionOf = (newLoop: boolean) => {
    const desk = buildTutorialSteps({ ...CTX, newLoop }).find((s) => s.id === "desk")!;
    const fig = desk.figure;
    expect(fig.kind).toBe("shot");
    return fig.kind === "shot" ? fig.caption : "";
  };

  it("the retired loop names its Processing Plant and Feed tabs", () => {
    const line = captionOf(false);
    expect(line).toMatch(/^Right column:/);
    expect(line).toMatch(/Processing Plant/);
    expect(line).toMatch(/Feed/);
    expect(line).not.toMatch(/Market/);
    // …and must not promise the new loop's window
    expect(line).not.toMatch(/session window/);
  });

  it("the new loop names Bank, Feed and the session window — never a Plant tab or Market", () => {
    const line = captionOf(true);
    expect(line).toMatch(/^Right column:/);
    expect(line).toMatch(/Bank/);
    expect(line).toMatch(/Feed/);
    expect(line).toMatch(/session window/);
    expect(line).not.toMatch(/Market/);
    expect(line).not.toMatch(/Plant (and Feed )?tabs/);
  });
});
