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

/** FTUE-1 (#464): the first game's chain — the Starter Island's teaching run.
 *  The ticket's five, in the ticket's order (Rail and the drawer are later
 *  questions; each stays one click away in the Tutorial menu). */
export const FIRST_GAME_CHAIN: readonly GuideSectionId[] = [
  "getting-started", "factory", "depots", "logistics", "upgrades",
];

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
  /** Is the game already past this step (the Factory stands, a Depot is
   *  built, income flows)? Such a step is skipped on arrival. */
  already?: (sectionId: string, stepId: string) => boolean;
  /**
   * FTUE-1 (#464): leave the Starter Island for the NORMAL game. While the
   * first-game chain runs, the host stands a "Skip to the real game" key in
   * the strip's own row — the first screen the player sees — and this is
   * where it lands. Absent = no chip (every ordinary boot).
   */
  onPlayNormalGame?: () => void;
}

export interface GuideHost {
  readonly controller: GuideController;
  /** Run one section now. */
  run(id: GuideSectionId): boolean;
  /**
   * FTUE-1 (#464): the first game's auto-run — the whole teaching chain the
   * Starter Island is played under: Getting started → Factory → Depots →
   * Logistics → Upgrades (the ticket's chain; the other five sections stay
   * one click away in the Tutorial menu). Still gated on the guide being
   * welcome (`allowed`, not `dismissed`): a dismissed guide never comes back
   * unasked — but "Skip to the real game" is an EXIT, never a dismissal.
   */
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
    // force: the player opened the tutorial, so it speaks even after the
    // automatic coach narration was skipped this session.
    // A new step cuts the last one off - never a backlog of stale lines.
    try { voice.stop(); } catch { /* garnish */ }
    try { voice.say(step.voice, { subtitle: false, force: true }); } catch { /* a missing clip is silent */ }
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

  let assistedKey = "\u0000";
  function paint(): void {
    if (disposed) return;
    let view = controller.view();
    // A step the game is already past is skipped on arrival (bounded).
    for (let guard = 0; guard < 12 && view.running && view.step && view.sectionId
      && hooks.already?.(view.sectionId, view.step.id); guard++) {
      controller.next();
      view = controller.view();
    }
    try { hooks.root.classList.toggle("guide-on", view.running === true); } catch { /* garnish */ }
    if (view.running) {
      speak(view);
      // Once per step: a repaint (any emitted event) must not re-click the
      // tool or re-open the tab - that loops and fights the player.
      const key = `${view.sectionId}:${view.step?.id}:${view.stepNumber}`;
      if (key !== assistedKey) { assistedKey = key; applyAssist(view); }
    } else assistedKey = "\u0000";
    renderer.paint(view);
    if (view.outcome && view.outcome !== lastOutcome) {
      lastOutcome = view.outcome;
      try { hooks.onOutcome?.(view.outcome); } catch { /* garnish */ }
    }
    if (!view.running) lastStepKey = "\u0000";
    paintChip(view);
  }

  const off = controller.onChange(() => paint());

  renderer.mount(hooks.root);

  // ── FTUE-1 (#464): the Starter Island's exit door ────────────────────────
  // "Skip to the real game" stands in the strip's own key row (the strip is
  // the first screen of the first game) while the FIRST-GAME chain runs —
  // on the first screen and every screen after it, because a player who
  // wants out should never have to hunt. It is an EXIT, not a dismissal:
  // the guide's own "End tutorial" keeps its meaning (stay in the game, stop
  // teaching), and this leaves the scenario for the normal match.
  let chip: HTMLButtonElement | null = null;
  let chainRunning = false;
  function paintChip(view: GuideView): void {
    const show = chainRunning && view.running === true && !!hooks.onPlayNormalGame;
    if (show && !chip) {
      const row = hooks.root.querySelector(".guide-row");
      if (row) {
        chip = document.createElement("button");
        chip.type = "button";
        chip.className = "guide-key ghost";
        chip.dataset.act = "guide-skip-real";
        chip.dataset.sfx = "open";
        chip.textContent = "Skip to the real game";
        chip.title = "Leave the Starter Island and open the real game";
        chip.onclick = () => { try { hooks.onPlayNormalGame?.(); } catch { /* garnish */ } };
        row.appendChild(chip);
      }
    }
    chip?.classList.toggle("hidden", !show);
  }

  const host: GuideHost = {
    controller,
    run(id) {
      // A section picked by name is not the first-game chain: the exit chip
      // stands down (the Tutorial menu is where a section is asked for).
      chainRunning = false;
      const ok = controller.run(id);
      paint();
      return ok;
    },
    runFirstGame() {
      // FTUE-1 (#464): THE FIRST GAME runs the whole chain — Getting started
      // → Factory → Depots → Logistics → Upgrades — inside the Starter
      // Island. The rest are there for the asking (Tutorial menu).
      if (!controller.allowed()) return;
      if (controller.dismissed()) return;
      chainRunning = true;
      controller.runChain(FIRST_GAME_CHAIN);
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
      chip?.remove();
      chip = null;
      renderer.unmount();
      controller.destroy();
    },
  };
  return host;
}
