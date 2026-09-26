// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the in-game, voiced guide.
//
//   src/iso/guide/types.ts      what a step IS (target, completion, caption)
//   src/iso/guide/sections.ts   the ten sections' content
//   src/iso/guide/progress.ts   the record: done ✓, dismissed, the gate
//   src/iso/guide/engine.ts     the step engine (pure — no DOM, no clock)
//   src/iso/guide/spotlight.ts  the picture: veil, pointer, caption strip
//   src/iso/guide/menu.ts       the Tutorial menu (☰ → Tutorial, front menu)
//   src/iso/guide/host.ts       the seam the game talks to
//
// The card tour it replaces (`src/iso/tutorial.ts`) is gone: the guide points
// at the real controls in the real game and waits for the player to use them.
// ══════════════════════════════════════════════════════════════════════════
export { createGuide, stepSatisfied, selectorSatisfies, targetSelectors } from "./engine";
export type { GuideController, GuideOptions } from "./engine";
export { buildGuideSections, allGuideSteps, type GuideContext } from "./sections";
export {
  GUIDE_STORAGE_KEY, LEGACY_TUTORIAL_KEY, guideAllowed, guideDismissed,
  isSectionDone, loadProgress, resetProgress, saveProgress,
} from "./progress";
export { showTutorialMenu, queueGuideSection, takeQueuedSection } from "./menu";
export type { TutorialMenuHandle, TutorialMenuOptions } from "./menu";
export { createGuideHost, FIRST_GAME_CHAIN } from "./host";
export type { GuideHost, GuideHostHooks, GuideRect } from "./host";
export { createGuideRenderer, firstVisible, isVisible } from "./spotlight";
export {
  GUIDE_SECTION_IDS, EMPTY_PROGRESS,
} from "./types";
export type {
  GuideAnchor, GuideAssist, GuideBuildKind, GuideCompletion, GuideEvent,
  GuideEventName, GuideOutcome, GuideProgress, GuideSection, GuideSectionId,
  GuideStep, GuideTarget, GuideView,
} from "./types";
