// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the guide's seam to the game.
//
// `createGuideHost` is the ONE thing game.ts (and the front menu) talks to.
// It owns the controller, the renderer and the narrator, and it translates:
//
//   game → guide   `emit()` — a click the DOM listener caught, a tool picked,
//                  a tab opened, a Depot placed, a session settled, the first
//                  cargo ticked. Events, never polls: the guide advances on
//                  the same gesture the game already handles.
//   guide → game   `assist()` — the one thing a step may do FOR the player
//                  (open the sheet the target lives in, arm the tool), and
//                  `mapRect()` — the camera maths that turns a tile into a
//                  screen rect, asked for once a frame while the guide stands.
//
// Voice: entering a step cues its line by id. The narrator only speaks while
// narration is on (VO-1's own rule, and the player's "skip narration" wins),
// and a line with no recording is a subtitle and a silent miss — never a
// throw, never a stalled step. The CAPTION is painted by the guide itself, so
// a muted or unrecorded guide still teaches.
// ══════════════════════════════════════════════════════════════════════════
import { voice } from "../../game/voice";
import { createGuide, type GuideController } from "./engine";
import { createGuideRenderer, type GuideRenderer } from "./spotlight";
import { buildGuideSections, type GuideContext } from "./sections";
import { queueGuideSection, showTutorialMenu, type TutorialMenuHandle } from "./menu";
import {
  type GuideAssist, type GuideEvent, type GuideOutcome, type GuideSectionId,
  type GuideTarget, type GuideView,
} from "./types";

export interface GuideRect { x: number; y: number; w: number; h: number }

export interface GuideHostHooks {
  /** Where the layer and the menu sheet hang (the game root). */
  root: HTMLElement;
  /** The live ★ line and free-tile allowance, for the copy. */
  ctx: GuideContext;
  /** The viewport rect of a map target, or null when there is nothing to
   *  point at yet. Called once a frame while the guide stands. */
  mapRect: (target: GuideTarget) => GuideRect | null;
  /** Do the thing the guide asked for on the way into a step. */
  assist: (a: GuideAssist) => void;
  /** True when a match is live (false on the front menu, where a pick queues
   *  the section for the next boot). */
  live: boolean;
  onOutcome?: (outcome: GuideOutcome) => void;
}

export interface GuideHost {
  readonly controller: GuideController;
  /** Run one section now. */
  run(id: GuideSectionId): boolean;
  /** The first game's auto-run: Getting started, and nothing else. */
  runFirstGame(): void;
  /** A completion event from the game. */
  emit(event: GuideEvent): void;
  /** Open the Tutorial menu sheet. */
  openMenu(): void;
  /** Repaint (the game's frame loop calls this; it is cheap). */
  paint(): void;
  destroy(): void;
}

export function createGuideHost(hooks: GuideHostHooks): GuideHost {
  const sections = buildGuideSections(hooks.ctx);
  const controller: GuideController = createGuide({ sections });
  const renderer: GuideRenderer = createGuideRenderer({
    emit: (e) => controller.emit(e),
    next: () => controller.next(),
    back: () => controller.back(),
    skip: () => controller.skip(),
    end: () => controller.end(),
    mapRect: (t) => hooks.mapRect(t),
  });

  let menu: TutorialMenuHandle | null = null;
  let lastStepKey = "\u0000";
  let lastOutcome: GuideOutcome | null = null;
  let disposed = false;

  function speak(view: GuideView): void {
    const step = view.step;
    if (!step) return;
    const key = `${view.sectionId}:${step.id}:${view.stepNumber}`;
    if (key === lastStepKey) return;
    lastStepKey = key;
    // The narrator speaks only while narration is on; the caption carries the
    // step either way, so a muted or unrecorded guide still teaches.
    try { voice.setNarration(true); } catch { /* garnish */ }
    if (!step.voice) return;
    // The caption strip already shows the words: no second subtitle bubble.
    try { voice.say(step.voice, { subtitle: false }); } catch { /* a missing clip is silent */ }
  }

  function applyAssist(view: GuideView): void {
    const step = view.step;
    if (!step?.assist) return;
    // After the gesture that advanced us has finished: the step may have been
    // reached by a click on a drawer tab, whose own handler toggles the drawer
    // AFTER our capture listener — assisting synchronously would be undone.
    const assist = step.assist;
    setTimeout(() => { try { hooks.assist(assist); } catch { /* garnish */ } }, 0);
  }

  function paint(): void {
    if (disposed) return;
    const view = controller.view();
    if (view.running) {
      speak(view);
      applyAssist(view);
    }
    renderer.paint(view);
    if (view.outcome && view.outcome !== lastOutcome) {
      lastOutcome = view.outcome;
      try { hooks.onOutcome?.(view.outcome); } catch { /* garnish */ }
    }
    if (!view.running) lastStepKey = "\u0000";
  }

  const off = controller.onChange(() => paint());

  renderer.mount(hooks.root);

  const host: GuideHost = {
    controller,
    run(id) {
      const ok = controller.run(id);
      paint();
      return ok;
    },
    runFirstGame() {
      // THE FIRST GAME runs ONE section. The rest are there for the asking.
      if (!controller.allowed()) return;
      if (controller.dismissed()) return;
      controller.runChain(["getting-started"]);
      paint();
    },
    emit(event) {
      controller.emit(event);
      paint();
    },
    openMenu() {
      if (menu) return;
      menu = showTutorialMenu(hooks.root, {
        ctx: hooks.ctx,
        progress: controller.progress(),
        live: hooks.live,
        onRun: (id) => {
          if (hooks.live) return host.run(id);
          // No game yet: the boot picks the section up.
          queueGuideSection(id);
          return true;
        },
        onReset: () => {
          controller.reset();
          queueGuideSection(null);
          paint();
        },
        onClose: () => { menu = null; },
      });
    },
    paint,
    destroy() {
      disposed = true;
      off();
      menu?.destroy();
      menu = null;
      renderer.unmount();
      controller.destroy();
    },
  };
  return host;
}
