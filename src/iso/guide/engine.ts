// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the step engine.
//
// Pure state, no DOM, no clock: `createGuide` is handed the section table and
// a memory and returns a controller the renderer and the game both drive.
// That is what makes the rules testable in node — every one of them is a
// function call, not a screenshot:
//
//   • a step advances when its COMPLETION EVENT arrives (click / tool / build
//     / tab / game event), or on Next when the step offers one;
//   • finishing the last step marks the section done and picks up the next
//     queued section (the first game's chain);
//   • "Skip section" drops this section and moves to the next queued one;
//   • "End tutorial" stops everything and remembers the dismissal;
//   • a dismissed guide never starts itself again — only `run()` (a click in
//     the Tutorial menu) or `runChain()` (a first game) does, and `run()`
//     clears the dismissal because the player asked by name;
//   • progress is written through the memory on every change, in a try/catch.
// ══════════════════════════════════════════════════════════════════════════
import {
  type GuideEvent, type GuideProgress, type GuideSection, type GuideSectionId,
  type GuideStep, type GuideTarget, type GuideView, type GuideOutcome,
} from "./types";
import {
  guideAllowed, guideDismissed, loadProgress, resetProgress, saveProgress,
  type GuideMemory,
} from "./progress";

export interface GuideOptions {
  /** Where progress lives. Omit for the live localStorage; pass a stub (or
   *  null for "no memory at all") in a test. */
  storage?: GuideMemory | null;
  search?: string;
  /** The section table. Injected by the caller (sections.ts) so the engine
   *  stays free of the content — and so a test can drive a two-step section. */
  sections?: readonly GuideSection[];
}

export interface GuideController {
  /** The frame the renderer paints. */
  view(): GuideView;
  progress(): GuideProgress;
  isDone(id: GuideSectionId): boolean;
  /** True when the guide may open itself (a first game). */
  allowed(): boolean;
  dismissed(): boolean;
  /** Run ONE section now, in the current game. The player asked, so this
   *  clears a dismissal. Returns false for an unknown id. */
  run(id: GuideSectionId): boolean;
  /** Queue sections and start the first (the first game's auto-run). */
  runChain(ids: readonly GuideSectionId[]): void;
  /** Next / Back — only where the step offers a Next. */
  next(): void;
  back(): void;
  /** "Skip section": this section is not done; the chain carries on. */
  skip(): void;
  /** "End tutorial": stop, and remember that the player asked. */
  end(): void;
  /** "Reset tutorial" — forget every ✓ and every dismissal. */
  reset(): void;
  /** A completion event from the DOM or the game. */
  emit(event: GuideEvent): void;
  /** Subscribe to every change. Returns the off switch. */
  onChange(fn: () => void): () => void;
  /** Tear everything down (a disposed game). */
  destroy(): void;
}

const normSelector = (s: string): string => s.replace(/\s+/g, "").trim();

/** Does a click that matched `got` satisfy a step that wants `want`? */
export function selectorSatisfies(want: string, got: string): boolean {
  return normSelector(want) === normSelector(got);
}

/**
 * The whole completion rule, in one pure function: does this event finish this
 * step? A step that offers a Next also accepts one, so a "look" step can be
 * read and moved on from without doing anything.
 */
export function stepSatisfied(step: GuideStep, event: GuideEvent): boolean {
  const c = step.complete;
  // Owner call: EVERY step can be moved on from with Next — the game may
  // already be past it (the Factory is built), or the player just wants
  // to read on. Doing the action still advances by itself.
  if (event.kind === "next") return true;
  // A step whose only door is Next is never satisfied by a gesture.
  if (c.kind === "next") return false;
  switch (event.kind) {
    case "click":
      return c.kind === "click" && selectorSatisfies(c.selector, event.selector);
    case "tool":
      return c.kind === "tool" && event.tool === c.tool;
    case "build":
      return c.kind === "build" && event.what === c.what;
    case "tab":
      return c.kind === "tab" && event.tab === c.tab;
    case "game":
      return c.kind === "event" && event.name === c.name;
    default:
      return false;
  }
}

/** Every selector a step's target names, for the click listener. */
export function targetSelectors(target: GuideTarget | null): string[] {
  if (!target || target.kind !== "ui") return [];
  return target.selector.split(",").map((s) => s.trim()).filter(Boolean);
}

export function createGuide(opts: GuideOptions = {}): GuideController {
  const store = opts.storage;
  const search = opts.search ?? (typeof location !== "undefined" ? location.search : "");
  const table: readonly GuideSection[] = opts.sections ?? [];

  let progress: GuideProgress = loadProgress(store);
  let sectionId: GuideSectionId | null = null;
  let stepIndex = 0;
  let queue: GuideSectionId[] = [];
  let outcome: GuideOutcome | null = null;
  let dead = false;
  const listeners = new Set<() => void>();

  const section = (id: GuideSectionId | null): GuideSection | null =>
    id ? table.find((s) => s.id === id) ?? null : null;
  const currentStep = (): GuideStep | null => section(sectionId)?.steps[stepIndex] ?? null;

  function paint(): void {
    if (dead) return;
    for (const fn of [...listeners]) {
      try { fn(); } catch { /* a bad painter must not stop the guide */ }
    }
  }

  function write(): void {
    saveProgress(progress, store);
  }

  function view(): GuideView {
    const sec = section(sectionId);
    const cur = currentStep();
    return {
      running: !!sec && !!cur,
      sectionId,
      sectionTitle: sec?.title ?? "",
      stepNumber: cur ? stepIndex + 1 : 0,
      stepCount: sec?.steps.length ?? 0,
      step: cur,
      queued: [...queue],
      outcome,
      target: cur?.target ?? null,
    };
  }

  function openSection(id: GuideSectionId | null): void {
    const sec = section(id);
    if (!sec || !sec.steps.length) { stop(null); return; }
    sectionId = sec.id;
    stepIndex = 0;
    outcome = null;
    paint();
  }

  function stop(next: GuideOutcome | null): void {
    sectionId = null;
    stepIndex = 0;
    queue = [];
    if (next) outcome = next;
    paint();
  }

  /** The section is finished: mark it, then the chain carries on. */
  function finishSection(): void {
    if (sectionId && !progress.done.includes(sectionId)) {
      progress = { ...progress, done: [...progress.done, sectionId] };
      write();
    }
    const nextId = queue.shift() ?? null;
    if (nextId) openSection(nextId);
    else stop("finished");
  }

  function advance(): void {
    const sec = section(sectionId);
    if (!sec) return;
    if (stepIndex < sec.steps.length - 1) {
      stepIndex++;
      outcome = null;
      paint();
    } else {
      finishSection();
    }
  }

  return {
    view,
    progress: () => ({ done: [...progress.done], dismissed: progress.dismissed }),
    isDone: (id) => progress.done.includes(id),
    allowed: () => guideAllowed(search, store),
    dismissed: () => guideDismissed(search, store),
    run(id) {
      if (dead) return false;
      if (!section(id)) return false;
      // The player asked by name: that is the one thing that lifts a dismissal.
      if (progress.dismissed) {
        progress = { ...progress, dismissed: false };
        write();
      }
      queue = [];
      openSection(id);
      return true;
    },
    runChain(ids) {
      if (dead) return;
      const list = ids.filter((id) => section(id));
      if (!list.length) return;
      queue = list.slice(1);
      openSection(list[0]);
    },
    next() {
      const cur = currentStep();
      if (!cur) return;
      advance();
    },
    back() {
      if (!sectionId || stepIndex <= 0) return;
      stepIndex--;
      outcome = null;
      paint();
    },
    skip() {
      if (!sectionId) return;
      const nextId = queue.shift() ?? null;
      sectionId = null;
      stepIndex = 0;
      if (nextId) openSection(nextId);
      else stop("skipped");
    },
    end() {
      if (dead) return;
      progress = { ...progress, dismissed: true };
      write();
      stop("ended");
    },
    reset() {
      progress = resetProgress(store);
      stop(null);
    },
    emit(event) {
      if (dead) return;
      const cur = currentStep();
      if (!cur) return;
      if (!stepSatisfied(cur, event)) return;
      advance();
    },
    onChange(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    destroy() {
      dead = true;
      listeners.clear();
      sectionId = null;
      stepIndex = 0;
      queue = [];
    },
  };
}
