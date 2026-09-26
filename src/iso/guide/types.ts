// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the in-game guide: the shape of a step.
//
// A step is four things and nothing else:
//
//   • a TARGET — a UI element (CSS selector / `data-act` / `data-tool` /
//     `data-tab`) or a spot on the map (a tile, or a box of tiles), resolved
//     against the live DOM and the live camera every frame;
//   • a SPOTLIGHT — the veil dims everything but that rect and pulses it;
//   • a POINTER — the hand/arrow that sits on the target;
//   • a CAPTION — one short line, voiced by the narrator when the clip exists.
//
// …and a COMPLETION — how the step knows the player did the thing. It is an
// EVENT, never a poll: the guide listens for the click, the tool pick, the
// build, the tab or the game's own hook, and moves on the moment it lands.
//
// No step ever pauses a clock. The guide is a caption over a live game: the
// economy keeps ticking while the player reads, which is the whole difference
// between this and the card tour it replaces (src/iso/tutorial.ts, removed).
// ══════════════════════════════════════════════════════════════════════════

/** The ten sections, in the order the ticket lists them. Dams are off. */
export const GUIDE_SECTION_IDS = [
  "getting-started",
  "factory",
  "depots",
  "logistics",
  "rail",
  "upgrades",
  "drawer",
  "rivals",
  "winning",
  "settings",
] as const;

export type GuideSectionId = (typeof GUIDE_SECTION_IDS)[number];

/** What a step points at. */
export type GuideTarget =
  /** A UI element. `selector` may list candidates, separated by commas — the
   *  first one that is actually VISIBLE wins, so the same step works on the
   *  desktop rail and inside the phone's Build / Economy sheets. */
  | { kind: "ui"; selector: string }
  /** One map tile, centred. Converted with the camera each frame. */
  | { kind: "tile"; tx: number; ty: number }
  /** A box of map tiles (r0..r1 inclusive), converted with the camera. */
  | { kind: "area"; x0: number; y0: number; x1: number; y1: number }
  /**
   * A LIVE spot on the map — the town you are building beside, the industry
   * your first Depot serves, your own factory. The host resolves it against
   * the game state each frame, so the guide points at the thing that exists
   * rather than at a coordinate a different seed never grew.
   */
  | { kind: "anchor"; what: GuideAnchor }
  /** A "look at the whole screen" step — no spotlight hole, just the caption. */
  | { kind: "screen" };

export type GuideAnchor = "town" | "industry" | "factory" | "depot" | "centre";

/** How a step knows it is done. */
export type GuideCompletion =
  /** The Next key is the only door (a "look" step). */
  | { kind: "next" }
  /** The player clicks the target (or anything in its selector list). */
  | { kind: "click"; selector: string }
  /** A build tool is picked from the rail / Build sheet. */
  | { kind: "tool"; tool: string }
  /** Something was BUILT — the map click that placed it, not the button. */
  | { kind: "build"; what: GuideBuildKind }
  /** A drawer tab (or phone sheet) was opened. */
  | { kind: "tab"; tab: string }
  /** One of the game's own events fired. */
  | { kind: "event"; name: GuideEventName };

export type GuideBuildKind =
  | "factory" | "depot" | "road" | "rail" | "platform" | "city";

/** The events the game hands the guide. Named after what happened, not after
 *  the code that did it. */
export type GuideEventName =
  | "factory-placed"
  | "depot-placed"
  | "road-placed"
  | "rail-placed"
  | "platform-placed"
  | "session-finished"
  | "depot-upgraded"
  | "city-upgraded"
  | "first-income"
  | "battle-finished";

/** What the guide can do for the player on the way into a step. */
export type GuideAssist =
  /** Arm this build tool for them (they still make the placement). */
  | { kind: "tool"; tool: string }
  /** Open this drawer tab so the target is on screen. */
  | { kind: "tab"; tab: string }
  /** Open this phone sheet (Map / Build / Economy) so the target is on screen.
   *  A no-op on desktop, where both columns are already standing. */
  | { kind: "sheet"; view: "map" | "build" | "trade" }
  /** Call the game's own recenter. */
  | { kind: "recenter" };

export interface GuideStep {
  /** Unique inside its section. */
  id: string;
  /** Two or three words — the strip's kicker. */
  title: string;
  /** The ONE caption. Plain words, no identifiers, no ticket numbers. */
  caption: string;
  /** Small print under the caption — the gesture, the price, the caveat. */
  hint?: string;
  /** A line id in assets/voice/lines.json. Missing audio is silent. */
  voice?: string;
  target: GuideTarget;
  complete: GuideCompletion;
  /** Offer a Next key as well (a step that can be read and moved on from). */
  next?: boolean;
  /** The guide performs this on the way in. */
  assist?: GuideAssist;
}

export interface GuideSection {
  id: GuideSectionId;
  /** The Tutorial menu's row label. */
  title: string;
  /** One line under it in the menu. */
  blurb: string;
  steps: GuideStep[];
}

/** Everything the renderer needs to paint one frame. */
export interface GuideView {
  running: boolean;
  sectionId: GuideSectionId | null;
  sectionTitle: string;
  /** 1-based, for the "2 / 6" counter. */
  stepNumber: number;
  stepCount: number;
  step: GuideStep | null;
  /** Sections still queued behind this one (the first game's chain). */
  queued: GuideSectionId[];
  /** Why the last run stopped. */
  outcome: GuideOutcome | null;
  /** The step's own target, so the renderer does not re-read the table. */
  target: GuideTarget | null;
}

export type GuideOutcome = "finished" | "skipped" | "ended";

/** Everything that can move the engine forward. */
export type GuideEvent =
  /** A click landed on something. `selector` is the candidate it matched. */
  | { kind: "click"; selector: string }
  | { kind: "tool"; tool: string }
  | { kind: "build"; what: GuideBuildKind }
  | { kind: "tab"; tab: string }
  | { kind: "game"; name: GuideEventName }
  // The engine's own advance. `stepSatisfied` answers for it so a step that
  // offers a Next is satisfied by one, and a gesture-only step never is.
  | { kind: "next" };

/** The one storage shape: which sections are done, and has the player asked
 *  the guide to go away. Per browser (localStorage), in a try/catch — a
 *  private-mode refusal is a fresh shelf, never a crash. */
export interface GuideProgress {
  done: GuideSectionId[];
  dismissed: boolean;
}

export const EMPTY_PROGRESS: GuideProgress = { done: [], dismissed: false };
