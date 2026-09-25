// ══════════════════════════════════════════════════════════════════════════
// #386 — the bottom-left dock stack: where the chat dock stands over the
// minimap plate.
//
// THE LAYOUT (mirrored in the styles.css `.chat-dock` comment — the two must
// always say the same thing):
//
//   The minimap plate is the anchor. It keeps its own place on the bottom
//   lane in every regime — no chat state, no fold, no width ever moves it,
//   so single-player is pixel-identical to what styles.css writes. The chat
//   dock (which exists only in a hosted game) shares the plate's LEFT edge
//   (styles.css mirrors the plate's left rules onto it, fold transition
//   included) and, whenever the plate is showing, its BOTTOM edge sits
//   `DOCK_STACK_GAP` px directly above the plate's top edge. When the plate
//   is folded away the dock drops back to its own base lane — today's place,
//   to the pixel. Open, the panel grows UPWARD from that same edge and its
//   height is capped (`chatMaxH`) so its top edge never reaches the top bar
//   (where the radio now lives, #377).
//
//   Phone exception: an OPEN sheet would have to perch above the plate with
//   its top under the bar (there is no vertical room), so on a phone the
//   sheet wins — styles.css tucks the plate while `data-chat-open="1"` and
//   the sheet keeps its own lane. The folded pill still stacks over the
//   plate like desktop. Either way the two boxes never intersect.
//
// The helper is pure: numbers in, numbers out. ui.ts feeds it the live
// measures (the plate's box height, the resource-bar lane, the viewport) and
// publishes what styles.css reads:
//
//   --minimap-h   the plate's live height — published by src/iso/minimap.ts
//                 (the same way ui.ts publishes --board-px), read here as the
//                 input `minimapH` and available to anything else that wants
//                 to stack over the plate (the sabotage window is a follow-up).
//   --chat-lift   what styles.css adds to the dock's base lane:
//                 bottom: calc(<base> + var(--chat-lift, 0px)).
//                 A delta, not an absolute: the phone bases carry
//                 env(safe-area-inset-bottom), which JS cannot know.
//   --chat-max-h  the cap for the open panel.
// ══════════════════════════════════════════════════════════════════════════

/** The air between the plate's top edge and the chat dock's bottom edge. */
export const DOCK_STACK_GAP = 6;

/** styles.css `--topbar-h`: 60px, 46px inside the phone regime. */
const TOPBAR_H_DESKTOP = 60;
const TOPBAR_H_PHONE = 46;
/** Clear air under whatever the top edge must clear. */
const TOP_CLEAR = 8;
/**
 * On a phone the dock's base lanes carry `env(safe-area-inset-bottom)` (the
 * home indicator) — JS cannot read that, so the cap reserves its usual 34px
 * when it lifts the panel. Over-reserving only makes the cap bite a little
 * earlier on a notchless phone; under-reserving would slide the open sheet
 * under the top bar on a notched one.
 */
const PHONE_HOME_INDICATOR = 34;
/** styles.css `.minimap-dock` on a phone: `--resbar-gap` + 48 (default 130). */
const PHONE_GAP_FALLBACK = 130;
const PHONE_PLATE_LIFT = 48;
/** styles.css `.chat-dock` on a phone: the folded pill / the open sheet. */
const PHONE_PILL_BOTTOM = 152;
const PHONE_SHEET_BOTTOM = 106;
/** styles.css desktop lane: `max(52px, --resbar-h) + 48px`. */
const RESBAR_FLOOR = 52;
const LANE_LIFT = 48;
/** Never hand back a cap too small for the dock's own head bar. */
const MIN_PANEL_H = 96;

export interface DockLayoutInput {
  /**
   * The minimap plate's live box height in px. 0 while the plate is hidden —
   * a folded plate measures 0, and that one number is both "how tall" and
   * "is it up".
   */
  minimapH: number;
  /** The chat panel is open. Only the phone's base lane cares (pill/sheet). */
  chatOpen: boolean;
  /** Phone regime (`.ui-root[data-phone="1"]`): its own lanes, shorter bar. */
  phone: boolean;
  /** `window.innerHeight` — the cap stops the panel below the top bar. */
  height: number;
  /** Live resource-bar height (`--resbar-h`); 0 = the stylesheet's 52px floor. */
  resbarH: number;
  /**
   * Phone: viewport bottom → resource-bar top (`--resbar-gap`), the base the
   * plate stands on. 0/absent = the stylesheet's 130px default.
   */
  resbarGap: number;
  /**
   * `--safe-top`, when the browser resolves it to px (0/absent otherwise).
   * The top bar sits below it, so the cap must too.
   */
  safeTop?: number;
}

export interface DockLayout {
  /**
   * Where the plate stands, px from the viewport bottom — today's base lane,
   * ALWAYS. Nothing in here ever moves it; single-player has no chat dock and
   * no `--chat-*` variables, and this number is what proves the plate's own
   * place is frozen.
   */
  minimapBottom: number;
  /**
   * The chat dock's bottom edge, px from the viewport bottom (safe-area
   * excluded — styles.css adds `env(safe-area-inset-bottom)` itself).
   * Equals the dock's base lane while the plate is hidden; the plate's top
   * edge + `DOCK_STACK_GAP` while it is showing.
   */
  chatBottom: number;
  /**
   * `chatBottom - base lane`: what styles.css adds to the dock's base
   * (`bottom: calc(<base> + var(--chat-lift, 0px))`). 0 = today's place.
   */
  chatLift: number;
  /**
   * Max height for the dock (px): `chatBottom + chatMaxH` stops `topbar + 8`
   * below the viewport top, so the open panel never reaches the top bar or
   * the radio in it.
   */
  chatMaxH: number;
}

/** Today's base lanes — the numbers styles.css writes, in one place. */
function baseLanes(input: DockLayoutInput): { minimapBottom: number; chatBase: number } {
  const { phone, chatOpen, resbarH, resbarGap } = input;
  if (phone) {
    // .minimap-dock phone: var(--resbar-gap, 130px) + 48px
    const gap = resbarGap > 0 ? resbarGap : PHONE_GAP_FALLBACK;
    return {
      minimapBottom: gap + PHONE_PLATE_LIFT,
      chatBase: chatOpen ? PHONE_SHEET_BOTTOM : PHONE_PILL_BOTTOM,
    };
  }
  // Desktop: both docks share the resource-bar lane.
  const lane = Math.max(RESBAR_FLOOR, resbarH) + LANE_LIFT;
  return { minimapBottom: lane, chatBase: lane };
}

/**
 * The bottom-left dock stack (see the header).
 *
 * Grid-testable by construction: every input is a plain number or flag, and
 * `chatBottom ≥ minimapBottom + minimapH` whenever the plate is up is the
 * no-overlap promise the unit test sweeps.
 */
export function dockLayout(input: DockLayoutInput): DockLayout {
  const { minimapH, phone, height, safeTop = 0 } = input;
  const { minimapBottom, chatBase } = baseLanes(input);

  const plateH = Number.isFinite(minimapH) ? Math.max(0, minimapH) : 0;
  // Plate up → stack directly over it (never below its top edge); plate
  // folded → the dock's own base lane, i.e. today's place to the pixel.
  const chatBottom = plateH > 0
    ? Math.max(chatBase, minimapBottom + plateH + DOCK_STACK_GAP)
    : chatBase;
  const chatLift = chatBottom - chatBase;

  const topbarH = phone ? TOPBAR_H_PHONE : TOPBAR_H_DESKTOP;
  const safeFloor = phone ? PHONE_HOME_INDICATOR : 0;
  const topClear = topbarH + Math.max(0, safeTop) + safeFloor + TOP_CLEAR;
  const chatMaxH = Math.max(MIN_PANEL_H, Math.round(height - chatBottom - topClear));

  return {
    minimapBottom,
    chatBottom: Math.round(chatBottom),
    chatLift: Math.round(chatLift),
    chatMaxH,
  };
}
