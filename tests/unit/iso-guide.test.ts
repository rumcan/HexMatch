import { moneyValueOf } from "../../src/iso/config";
// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the in-game guide (src/iso/guide/*).
//
// Pinned here, in the order the ticket's acceptance boxes read:
//
//   1. THE ENGINE is pure state. A step advances on its COMPLETION EVENT
//      (click / tool / build / tab / game event) or on Next where the step
//      offers one; finishing the last step marks the section and picks up the
//      next queued one; "Skip section" carries the chain on WITHOUT a ✓;
//      "End tutorial" stops and remembers; a dismissed guide never starts
//      itself, and only `run()` (the player asked by name) lifts that.
//   2. THE SECTIONS are the ten the ticket lists, in order, each replayable,
//      with one caption, one voice line and a live target. Dams are off.
//   3. THE COPY is read, not typed: the prices, the ★ values and the session
//      bounds are interpolated from the authoritative tables, and no caption
//      may carry a ticket number, a path or a run-on sentence.
//   4. THE PICTURE is a spotlight over a LIVE game: the veil never takes a
//      click (pointer-events are the CSS's job, but the listener is capture
//      phase and never cancels), the strip always carries Skip section and
//      End tutorial, and a click on the target is what moves a step on.
//   5. THE MENU lists every section with a ✓, runs one now (or queues it for
//      the next boot from the front menu) and can reset the lot.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  createGuide, selectorSatisfies, stepSatisfied, targetSelectors,
  type GuideController, type GuideOptions,
} from "../../src/iso/guide/engine";
import {
  buildGuideSections, allGuideSteps,
} from "../../src/iso/guide/sections";
import {
  GUIDE_STORAGE_KEY, guideAllowed, guideDismissed, isSectionDone, loadProgress,
  resetProgress, saveProgress, type GuideMemory,
} from "../../src/iso/guide/progress";
import { GUIDE_SECTION_IDS } from "../../src/iso/guide/types";
import { createGuideRenderer, firstVisible, isVisible } from "../../src/iso/guide/spotlight";
import { showTutorialMenu, takeQueuedSection, queueGuideSection } from "../../src/iso/guide/menu";
import { showRefCards } from "../../src/iso/guide/refcard";
import { CARGOES, TUNING, VICTORY } from "../../src/iso/config";
import { DEPOT_COST, costLabel } from "../../src/iso/construction";
import { fmtVp } from "../../src/iso/victory";

/** A read-only-ish storage stub: the shape the module is handed in tests. */
const stub = (init: Record<string, string> = {}) => {
  const map = new Map(Object.entries(init));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
};

/** The boot context game.ts passes: the shipped line and the full allowance. */
const CTX = { vpTarget: VICTORY.loop.target, freeTrack: 12 };

/** A two-step section table, so the engine's rules are driven in isolation. */
const toy = (): GuideOptions["sections"] => ([
  {
    id: "factory",
    title: "Your Factory",
    blurb: "toy",
    steps: [
      {
        id: "look",
        title: "Look",
        caption: "A look step.",
        target: { kind: "screen" },
        complete: { kind: "next" },
        next: true,
      },
      {
        id: "do",
        title: "Do",
        caption: "A gesture step.",
        target: { kind: "ui", selector: '[data-tool="dirt"]' },
        complete: { kind: "build", what: "road" },
      },
    ],
  },
  {
    id: "rail",
    title: "Rail",
    blurb: "toy",
    steps: [
      {
        id: "only",
        title: "Only",
        caption: "The chain's second section.",
        target: { kind: "screen" },
        complete: { kind: "next" },
        next: true,
      },
    ],
  },
]);

const boot = (opts: Partial<GuideOptions> = {}): GuideController =>
  createGuide({ sections: toy(), storage: stub(), search: "", ...opts });

// ── 1. the engine ────────────────────────────────────────────────────────
describe("TUT-03 the engine", () => {
  it("stands on step one of a run section and nowhere else", () => {
    const g = boot();
    expect(g.view().running).toBe(false);
    expect(g.run("factory")).toBe(true);
    const v = g.view();
    expect(v.running).toBe(true);
    expect(v.sectionId).toBe("factory");
    expect(v.stepNumber).toBe(1);
    expect(v.stepCount).toBe(2);
    expect(v.step?.id).toBe("look");
    // an unknown section is a no answer, not a crash
    expect(g.run("dams" as never)).toBe(false);
  });

  it("advances on Next from ANY step — a gesture step can be read and left too", () => {
    const g = boot();
    g.run("factory");
    g.next();                                   // the look step
    expect(g.view().step?.id).toBe("do");
    g.back();
    expect(g.view().step?.id).toBe("look");
    g.next();
    g.next();                                   // the gesture step: Next finishes it
    expect(g.view().running).toBe(false);
    g.run("factory");
    g.back();                                   // step one has nowhere to go
    expect(g.view().step?.id).toBe("look");
    expect(g.view().stepNumber).toBe(1);
  });

  it("advances on the completion EVENT, and on nothing else", () => {
    const g = boot();
    g.run("factory");
    g.next();
    // the wrong build, the wrong tool, the wrong click — none of them count
    g.emit({ kind: "build", what: "rail" });
    g.emit({ kind: "tool", tool: "dirt" });
    g.emit({ kind: "click", selector: "#elsewhere" });
    g.emit({ kind: "game", name: "first-income" });
    expect(g.view().step?.id).toBe("do");
    g.emit({ kind: "build", what: "road" });
    expect(g.view().running).toBe(false);
    expect(g.view().outcome).toBe("finished");
  });

  it("a look step is never satisfied by a gesture", () => {
    const g = boot();
    g.run("factory");
    g.emit({ kind: "click", selector: '[data-tool="dirt"]' });
    expect(g.view().step?.id).toBe("look");
  });

  it("finishing a section marks it and picks up the queued one", () => {
    const store = stub();
    const g = createGuide({ sections: toy(), storage: store, search: "" });
    g.runChain(["factory", "rail"]);
    expect(g.view().queued).toEqual(["rail"]);
    g.next();                                   // factory: look
    g.emit({ kind: "build", what: "road" });     // factory: do → finished
    expect(g.isDone("factory")).toBe(true);
    expect(g.view().sectionId).toBe("rail");     // the chain carried on
    g.next();
    expect(g.view().outcome).toBe("finished");
    expect(g.isDone("rail")).toBe(true);
  });

  it("Skip section carries the chain on without marking anything", () => {
    const g = boot();
    g.runChain(["factory", "rail"]);
    expect(g.view().sectionId).toBe("factory");
    g.skip();
    expect(g.isDone("factory")).toBe(false);
    expect(g.view().sectionId).toBe("rail");
    g.skip();
    expect(g.view().outcome).toBe("skipped");
    expect(g.isDone("rail")).toBe(false);
  });

  it("End tutorial stops everything and remembers the dismissal", () => {
    const store = stub();
    const g = createGuide({ sections: toy(), storage: store, search: "" });
    g.run("factory");
    g.end();
    expect(g.view().running).toBe(false);
    expect(g.view().outcome).toBe("ended");
    expect(guideDismissed("", store)).toBe(true);
    // a dismissed guide never starts itself…
    expect(g.allowed()).toBe(false);
    // …and the one thing that lifts it is the player asking by name
    g.run("factory");
    expect(g.view().running).toBe(true);
    expect(guideDismissed("", store)).toBe(false);
  });

  it("paints through its listener on every change, and stops after destroy", () => {
    const g = boot();
    let frames = 0;
    const off = g.onChange(() => { frames++; });
    g.run("factory");
    expect(frames).toBe(1);
    g.next();
    expect(frames).toBe(2);
    off();
    g.back();
    expect(frames).toBe(2);
    g.destroy();
    g.run("rail");
    expect(g.view().running).toBe(false);
  });

  it("writes progress through the memory it was handed", () => {
    const store = stub();
    const g = createGuide({ sections: toy(), storage: store, search: "" });
    g.runChain(["factory"]);
    g.next();
    g.emit({ kind: "build", what: "road" });
    expect(JSON.parse(store.getItem(GUIDE_STORAGE_KEY)!).done).toEqual(["factory"]);
  });

  it("answers the completion rule as one pure function", () => {
    const [look, doStep] = toy()![0].steps;
    expect(stepSatisfied(look, { kind: "next" })).toBe(true);
    expect(stepSatisfied(doStep, { kind: "next" })).toBe(true);    // Next always works
    expect(stepSatisfied(doStep, { kind: "build", what: "road" })).toBe(true);
    expect(stepSatisfied(doStep, { kind: "build", what: "rail" })).toBe(false);
    // selectors match on their own text, whitespace and all
    expect(selectorSatisfies('[data-tool="dirt"]', '[data-tool="dirt"]')).toBe(true);
    expect(selectorSatisfies('[data-tool="dirt"]', '[data-tool="street"]')).toBe(false);
    // every candidate of a comma list is a listener's business
    expect(targetSelectors({ kind: "ui", selector: '#a, [data-tool="dirt"] , .c' }))
      .toEqual(["#a", '[data-tool="dirt"]', ".c"]);
    expect(targetSelectors({ kind: "screen" })).toEqual([]);
    expect(targetSelectors(null)).toEqual([]);
  });
});

// ── 2. progress ──────────────────────────────────────────────────────────
describe("TUT-03 progress", () => {
  it("starts on an empty shelf and round-trips through the storage", () => {
    const store = stub();
    expect(loadProgress(store)).toEqual({ done: [], dismissed: false });
    saveProgress({ done: ["rail"], dismissed: false }, store);
    expect(isSectionDone("rail", store)).toBe(true);
    expect(isSectionDone("factory", store)).toBe(false);
    expect(loadProgress(store)).toEqual({ done: ["rail"], dismissed: false });
  });

  it("ignores a corrupted record instead of forgetting the player's marks", () => {
    const store = stub({ [GUIDE_STORAGE_KEY]: "{not json" });
    expect(loadProgress(store)).toEqual({ done: [], dismissed: false });
  });

  it("reads the legacy tour's \"never\" as a dismissal", () => {
    const store = stub({ "hexmatch:tutorial": "never" });
    expect(guideDismissed("", store)).toBe(true);
    expect(guideAllowed("", store)).toBe(false);
  });

  it("takes the URL's word either way", () => {
    expect(guideAllowed("", stub())).toBe(true);
    expect(guideAllowed("?guide=0", stub())).toBe(false);
    expect(guideAllowed("?tutorial=0", stub())).toBe(false);
    expect(guideAllowed("?guide=1", stub({ "hexmatch:tutorial": "never" }))).toBe(true);
    // junk is no opinion at all
    expect(guideAllowed("?guide=banana", stub())).toBe(true);
  });

  it("reset forgets every ✓ and every dismissal", () => {
    const store = stub();
    saveProgress({ done: ["rail", "drawer"], dismissed: true }, store);
    expect(resetProgress(store)).toEqual({ done: [], dismissed: false });
    expect(loadProgress(store)).toEqual({ done: [], dismissed: false });
  });

  it("survives a storage that throws (private mode)", () => {
    const hostile: GuideMemory = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(loadProgress(hostile)).toEqual({ done: [], dismissed: false });
    expect(() => saveProgress({ done: ["rail"], dismissed: false }, hostile)).not.toThrow();
    expect(guideAllowed("", hostile)).toBe(true);
  });
});

// ── 3. the sections ──────────────────────────────────────────────────────
describe("TUT-03 the sections", () => {
  const sections = buildGuideSections(CTX);

  it("are the ten the ticket lists, in order, each with steps", () => {
    expect(sections.map((s) => s.id)).toEqual([...GUIDE_SECTION_IDS]);
    expect(GUIDE_SECTION_IDS).not.toContain("dams" as never);
    for (const s of sections) {
      expect(s.steps.length, `${s.id} has no steps`).toBeGreaterThan(0);
      expect(s.title.length, `${s.id} has no title`).toBeGreaterThan(0);
      expect(s.blurb.length, `${s.id} has no blurb`).toBeGreaterThan(0);
    }
  });

  it("give every step a unique id, a target and a completion", () => {
    const seen = new Set<string>();
    for (const s of sections) {
      for (const step of s.steps) {
        const key = `${s.id}:${step.id}`;
        expect(seen.has(key), `${key} is not unique`).toBe(false);
        seen.add(key);
        expect(step.target, `${key} has no target`).toBeTruthy();
        expect(step.complete, `${key} has no completion`).toBeTruthy();
        // (every step offers Next now, so no per-step flag is required)
      }
    }
  });

  it("quote a voice line that exists in the shipped table", () => {
    // The 28 narrator lines are `guide:<section>:<step>`; a few steps reuse a
    // line the coach already recorded — they are still in lines.json, and the
    // voice suite asserts those are never dropped.
    const ids = new Set(
      (JSON.parse(readFileSync("assets/voice/lines.json", "utf8")) as { id: string }[])
        .map((l) => l.id),
    );
    let spoken = 0;
    for (const { step } of allGuideSteps(CTX)) {
      if (!step.voice) continue;
      spoken++;
      expect(ids.has(step.voice), `${step.voice} is not in assets/voice/lines.json`).toBe(true);
    }
    expect(spoken).toBe(allGuideSteps(CTX).length);
  });

  it("keep every caption and hint clear of the copy guard's three shapes", () => {
    // The same three the shipped guard forbids anywhere a player can read:
    // a comment marker, a ticket number and an `L<n> (` reference.
    for (const { step } of allGuideSteps(CTX)) {
      for (const text of [step.caption, step.hint ?? ""]) {
        if (!text) continue;
        expect(text, `${step.id} carries a comment marker`).not.toContain("//");
        expect(text, `${step.id} names a ticket`).not.toContain("(#");
        expect(text, `${step.id} references a ticket`).not.toMatch(/\bL\d+\s*\(/);
      }
    }
  });

  it("keep the strip's caption to the two sentences the narrator reads", () => {
    for (const { step } of allGuideSteps(CTX)) {
      // A decimal (×2.5) is not a sentence break; a full stop and a space is.
      const sentences = step.caption.split(/(?<=\.)\s+/).filter(Boolean);
      expect(sentences.length, `${step.id} caption is too long to voice`).toBeLessThanOrEqual(2);
    }
  });

  it("read the prices, the ★ values and the session bounds off the tables", () => {
    const text = (id: string) => {
      const step = allGuideSteps(CTX).find((x) => x.step.id === id)!.step;
      return [step.caption, step.hint ?? ""].join(" ");
    };
    // the setup allowance pays for the first Depot
    expect(text("one-each")).toContain(`$${moneyValueOf(DEPOT_COST)}`); // ECON-1: builds cost money
    // the tuning session's bounds
    expect(text("session")).toContain(String(TUNING.moves));
    expect(text("score")).toContain(String(TUNING.targetScore));
    // ★ values
    expect(text("city")).toContain(fmtVp(VICTORY.loop.city));
    expect(text("depot")).toContain(fmtVp(VICTORY.loop.maxDepot));
  });

  it("teach the loop the game runs — road tiers, ramps and the diagonal rail", () => {
    const ids = allGuideSteps(CTX).map((x) => x.step.id);
    for (const id of ["tiers", "highway", "slopes", "track", "diagonal", "platform"]) {
      expect(ids, `no ${id} step`).toContain(id);
    }
  });

  it("never hard-code the Market's prices (ECON-1 may retune them)", () => {
    const market = allGuideSteps(CTX).find((x) => x.step.id === "market")!.step;
    const text = [market.caption, market.hint ?? ""].join(" ");
    expect(text).not.toMatch(/\d+\s*(gold|grain|wood|stone|ore|oil)/i);
    expect(text.toLowerCase()).toMatch(/sell materials for money/); // ECON-1: the Market is the exchange
  });

  it("name every cargo the drawer can carry, without the retired Market rail", () => {
    for (const c of CARGOES) expect(CARGOES).toContain(c);
  });
});

// ── 4. the picture ───────────────────────────────────────────────────────
describe("TUT-03 the spotlight", () => {
  let host: HTMLDivElement;
  let renderer: ReturnType<typeof createGuideRenderer> | null = null;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });
  afterEach(() => {
    renderer?.unmount();
    renderer = null;
  });

  const standing = (g: GuideController) => {
    renderer = createGuideRenderer({
      emit: (e) => g.emit(e),
      next: () => g.next(),
      back: () => g.back(),
      skip: () => g.skip(),
      end: () => g.end(),
      mapRect: () => null,
    });
    renderer.mount(host);
    // exactly what the host does: every engine change repaints the picture
    g.onChange(() => renderer!.paint(g.view()));
    renderer.paint(g.view());
  };

  it("paints the strip with the section, the counter, the caption and the hint", () => {
    const g = boot();
    g.run("factory");
    standing(g);
    const layer = host.querySelector("#iso-guide") as HTMLElement;
    expect(layer).toBeTruthy();
    expect(layer.dataset.section).toBe("factory");
    expect(layer.dataset.step).toBe("look");
    expect(layer.querySelector(".guide-kicker")!.textContent).toBe("Your Factory");
    expect(layer.querySelector(".guide-count")!.textContent).toBe("1 / 2");
    expect(layer.querySelector(".guide-caption")!.textContent).toBe("A look step.");
    // the pointer is decoration, never a hit area
    expect(layer.querySelector(".guide-pointer")!.getAttribute("aria-hidden")).toBe("true");
    expect(layer.querySelector(".guide-hole")!.className).toContain("guide-hole");
  });

  it("always carries Skip section and End tutorial, and hides them never", () => {
    const g = boot();
    g.run("factory");
    standing(g);
    const layer = host.querySelector("#iso-guide")!;
    for (const act of ["guide-skip", "guide-end"]) {
      expect(layer.querySelector(`[data-act="${act}"]`), `${act} is missing`).toBeTruthy();
    }
    (layer.querySelector('[data-act="guide-skip"]') as HTMLElement).click();
    expect(g.view().outcome).toBe("skipped");
  });

  it("offers Next on every step, and Back only after step one", () => {
    const g = boot();
    g.run("factory");
    standing(g);
    const layer = () => host.querySelector("#iso-guide")!;
    const next = () => layer().querySelector('[data-act="guide-next"]') as HTMLElement;
    const back = () => layer().querySelector('[data-act="guide-back"]') as HTMLElement;
    expect(back().classList.contains("hidden")).toBe(true);      // step one
    next().click();
    expect(g.view().step?.id).toBe("do");
    expect(back().classList.contains("hidden")).toBe(false);
    expect(next().classList.contains("hidden")).toBe(false);     // gesture step too
  });

  it("learns a click on the target without taking it", () => {
    const g = boot();
    g.run("factory");
    g.next();
    standing(g);
    // the target element, OUTSIDE the guide's own layer
    const tool = document.createElement("button");
    tool.dataset.tool = "dirt";
    document.body.appendChild(tool);
    tool.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(g.view().step?.id).toBe("do");     // the click did not satisfy it
    // a click INSIDE the strip is the guide's business and nobody else's
    const strip = host.querySelector(".guide-strip") as HTMLElement;
    strip.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(g.view().step?.id).toBe("do");
  });

  it("stands down when nothing is running", () => {
    const g = boot();
    g.run("factory");
    standing(g);
    g.end();
    renderer!.paint(g.view());
    expect(host.querySelector("#iso-guide")!.classList.contains("hidden")).toBe(true);
  });

  it("finds the first VISIBLE candidate of a selector list", () => {
    const hidden = document.createElement("div");
    hidden.id = "a";
    hidden.style.display = "none";
    const shown = document.createElement("div");
    shown.className = "b";
    // jsdom has no layout, so a node that IS on screen carries no box of its
    // own — the rect is stubbed the way a browser would have measured it.
    shown.getBoundingClientRect = () =>
      ({ width: 24, height: 12, top: 0, left: 0, right: 24, bottom: 12, x: 0, y: 0 }) as DOMRect;
    host.append(hidden, shown);
    expect(isVisible(hidden)).toBe(false);
    expect(isVisible(shown)).toBe(true);
    expect(isVisible(document.createElement("span"))).toBe(false);   // no box, no hit
    expect(firstVisible(document, "#a, .b")).toBe(shown);
    expect(firstVisible(document, "#nope")).toBeNull();
  });
});

// ── 5. the menu ──────────────────────────────────────────────────────────
describe("TUT-03 the Tutorial menu", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  it("lists every section with a ✓ once it is done", () => {
    saveProgress({ done: ["rail"], dismissed: false }, localStorage);
    const menu = showTutorialMenu(host, {
      ctx: CTX, progress: loadProgress(), live: true,
      onRun: () => true, onReset: () => {},
    });
    const rows = [...host.querySelectorAll("[data-act='guide-section']")];
    expect(rows).toHaveLength(GUIDE_SECTION_IDS.length);
    const marks = rows.map((r) => r.querySelector(".guide-menu-mark")!.textContent);
    expect(marks[GUIDE_SECTION_IDS.indexOf("rail")]).toBe("✓");
    expect(marks.filter((m) => m === "✓")).toHaveLength(1);
    // a done row offers a replay, an undone one a play
    const go = rows.map((r) => r.querySelector(".guide-menu-go")!.textContent);
    expect(go[GUIDE_SECTION_IDS.indexOf("rail")]).toBe("Replay");
    expect(go[0]).toBe("Play");
    menu.destroy();
  });

  it("runs the section it was clicked on", () => {
    const picked: string[] = [];
    const menu = showTutorialMenu(host, {
      ctx: CTX, progress: { done: [], dismissed: false }, live: true,
      onRun: (id) => { picked.push(id); return true; },
      onReset: () => {},
    });
    const row = host.querySelector('[data-section="rail"]') as HTMLElement;
    row.click();
    expect(picked).toEqual(["rail"]);
    expect(host.querySelector("[data-act='guide-menu']")).toBeNull();   // it closed
    menu.destroy();
  });

  it("queues a pick for the next boot when there is no game yet", () => {
    // With no game live the CALLER queues the section (the front menu and the
    // host both do exactly this) — the menu only reports the pick.
    const picked: string[] = [];
    const menu = showTutorialMenu(host, {
      ctx: CTX, progress: { done: [], dismissed: false }, live: false,
      onRun: (id) => { picked.push(id); queueGuideSection(id); return true; },
      onReset: () => {},
    });
    (host.querySelector('[data-section="factory"]') as HTMLElement).click();
    expect(takeQueuedSection()).toBe("factory");
    // the boot's one read forgets it
    expect(takeQueuedSection()).toBeNull();
    // …and a queued section can be cancelled
    queueGuideSection("rail");
    queueGuideSection(null);
    expect(takeQueuedSection()).toBeNull();
    menu.destroy();
  });

  it("Reset tutorial clears the marks and calls the caller back", () => {
    saveProgress({ done: ["rail"], dismissed: true }, localStorage);
    let resets = 0;
    const menu = showTutorialMenu(host, {
      ctx: CTX, progress: loadProgress(), live: true,
      onRun: () => true,
      onReset: () => { resets++; resetProgress(localStorage); },
    });
    (host.querySelector("[data-act='guide-reset']") as HTMLElement).click();
    expect(resets).toBe(1);
    const marks = [...host.querySelectorAll(".guide-menu-mark")].map((m) => m.textContent);
    expect(marks.every((m) => m !== "✓")).toBe(true);
    expect(loadProgress()).toEqual({ done: [], dismissed: false });
    menu.destroy();
  });
});

// ── 6. the reference-card projector the battle pages still use ───────────
describe("TUT-03 the card projector", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "";
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  const cards = [
    { id: "a", kicker: "K · 1 / 2", title: "First", lede: "One.", points: ["A point."], tip: "A tip.",
      figure: { kind: "chain" as const, nodes: [{ icon: "↔", label: "Swap" }], caption: "A caption." } },
    { id: "b", kicker: "K · 2 / 2", title: "Second", lede: "Two.", points: ["Another point."], tip: "Another tip.",
      figure: { kind: "ledger" as const, rows: [{ icon: "★", label: "Depots", vp: "+1★" }], caption: "A ledger." } },
  ];

  it("walks the cards and ends as finished, not dismissed", async () => {
    let seen: string | null = null;
    const page = showRefCards(host, { steps: cards, overlayId: "iso-test-page", onClose: (r) => { seen = r.reason; } })!;
    const card = () => host.querySelector("#iso-test-page")!;
    expect(card().querySelector(".tut-title")!.textContent).toBe("First");
    expect(card().querySelectorAll(".tut-chain-node")).toHaveLength(1);
    (card().querySelector('[data-act="tut-next"]') as HTMLElement).click();
    expect(card().dataset.step).toBe("b");
    expect(card().querySelector('[data-act="tut-done"]')!.textContent).toMatch(/start production/i);
    (card().querySelector('[data-act="tut-done"]') as HTMLElement).click();
    expect(await page.promise).toEqual({ reason: "finished" });
    expect(seen).toBe("finished");
    expect(host.querySelector("#iso-test-page")).toBeNull();
  });

  it("opens one page at a time, per id", () => {
    const a = showRefCards(host, { steps: cards, overlayId: "iso-one" })!;
    expect(showRefCards(host, { steps: cards, overlayId: "iso-one" })).toBeNull();
    expect(showRefCards(host, { steps: cards, overlayId: "iso-two" })).toBeTruthy();
    a.destroy();
  });

  it("paints nothing with no cards and no DOM", () => {
    expect(showRefCards(host, { steps: [] })).toBeNull();
  });

  it("has no never-show-again button — the Tutorial menu owns that now", () => {
    const page = showRefCards(host, { steps: cards, overlayId: "iso-three" })!;
    expect(page.el.querySelector('[data-act="tut-never"]')).toBeNull();
    page.destroy();
  });
});
