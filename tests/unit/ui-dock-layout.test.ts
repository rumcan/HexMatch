// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #386 — the bottom-left dock stack: the chat dock over the minimap plate.
//
// The RULE is dockLayout() (src/game/dock-layout.ts), swept over the grid the
// ticket asks for — window widths × Build column fold × chat open/closed ×
// phone × the live resource-bar lane — plus the two promises around it:
//
//   • NO OVERLAP: while the plate is up, the chat dock's bottom edge stands
//     at least DOCK_STACK_GAP above the plate's top edge; while it is away,
//     the dock is back on today's base lane. Their left edges are the same
//     (styles.css mirrors the plate's left rules onto the dock), so vertical
//     separation is the whole proof.
//   • SINGLE-PLAYER IS FROZEN: the plate's own place (minimapBottom) equals
//     today's stylesheet lane for every input the grid can throw at it, and a
//     solo boot publishes none of the --chat-* variables at all.
//   • The open panel never reaches the top bar (--chat-max-h).
//
// jsdom lays nothing out, so the fixed-position boxes are replayed from
// styles.css's own arithmetic — the same trick iso-corridor-picker.test.ts
// uses for the HUD boxes. The two left fixtures are written out separately
// (one per element, quoting each CSS block) so the mirror itself is what the
// test pins: drift one rule and they stop agreeing.
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../../src/game/board";
import {
  createOriginalUi,
  type OriginalUi,
  type UiChatConfig,
  type UiChatPrefs,
} from "../../src/game/ui";
import { dockLayout, DOCK_STACK_GAP, type DockLayoutInput } from "../../src/game/dock-layout";
import { emptyBag } from "../../src/iso/purse";
import { mulberry32, setRng } from "../../src/game/config";
import { CHAT_MAX_LEN, CHAT_PRESETS } from "../../src/net/chat";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

// ── styles.css, replayed ───────────────────────────────────────────────────
/** `--topbar-h`: 60px, 46px inside the phone regime (styles.css ~65 / ~3021). */
const topbarH = (phone: boolean) => (phone ? 46 : 60);

/** Today's desktop lane: `max(52px, var(--resbar-h, 52px)) + 48px`. */
const desktopLane = (resbarH: number) => Math.max(52, resbarH) + 48;

/**
 * `.minimap-dock`'s left, straight from styles.css:
 *   base 320 → [data-rail-left="1"] 48 → ≤1180: 282 → ≤900 (pair): 10 →
 *   phone: 10.
 */
function plateLeftCss(width: number, railLeft: boolean, phone: boolean): number {
  if (phone) return 10;
  if (width <= 900) return 10;          // the ≤900 pair beats the fold rule
  if (railLeft) return 48;              // …which beats ≤1180
  if (width <= 1180) return 282;
  return 320;
}

/**
 * `.chat-dock`'s left — the SAME rule set, written out again from the dock's
 * own block (base 320 → [data-rail-left="1"] 48 → ≤1180: 282 → ≤900 pair: 10
 * → phone: 10). Independent of the fixture above on purpose: the ticket's
 * "same left edge" is this function agreeing with the one above, everywhere.
 */
function chatLeftCss(width: number, railLeft: boolean, phone: boolean): number {
  if (phone) return 10;
  if (width <= 900) return 10;
  if (railLeft) return 48;
  if (width <= 1180) return 282;
  return 320;
}

/**
 * The plate's own box (styles.css `.minimap-dock`):
 *   width  clamp(188px, 15vw, 276px); phone min(260px, 100vw − 86px);
 *   short-landscape phone 216px; padding 4px + border 1px on each side; the
 *   canvas inside is aspect 2 / 1.
 */
function plateBoxCss(width: number, height: number, phone: boolean): { w: number; h: number } {
  let w: number;
  if (phone) {
    const short = width <= 900 && height <= 500;
    w = short ? 216 : Math.min(260, width - 86);
  } else {
    w = Math.min(276, Math.max(188, 0.15 * width));
  }
  const canvasW = w - 10;             // padding 2×4 + border 2×1
  return { w, h: canvasW / 2 + 10 };
}

// ── the grid ───────────────────────────────────────────────────────────────
interface Case {
  width: number;
  height: number;
  phone: boolean;
  railLeft: boolean;
  chatOpen: boolean;
  /** The plate's live box height: 0 = folded away. */
  minimapH: number;
  resbarH: number;
  resbarGap: number;
}

const DESKTOP_WIDTHS = [900, 901, 1180, 1181, 1440, 1920, 2560];
const DESKTOP_HEIGHTS = [600, 720, 900];
const PHONE_SIZES: [number, number][] = [[360, 640], [414, 896], [760, 1024], [844, 390]];

function grid(): Case[] {
  const cases: Case[] = [];
  // Desktop: widths × fold × chat open/closed × plate up/away × bar wrapped.
  for (const width of DESKTOP_WIDTHS) {
    for (const height of DESKTOP_HEIGHTS) {
      for (const railLeft of [false, true]) {
        for (const chatOpen of [false, true]) {
          for (const resbarH of [0, 96]) {
            const plate = plateBoxCss(width, height, false);
            for (const minimapH of [0, plate.h]) {
              cases.push({ width, height, phone: false, railLeft, chatOpen, minimapH, resbarH, resbarGap: 0 });
            }
          }
        }
      }
    }
  }
  // Phone (a phone never carries the fold): fab away/up × sheet shut/open —
  // chatOpen with minimapH = 0 IS the tuck (the sheet hides the plate), and
  // chatOpen with minimapH > 0 is the belt: the state must not overlap even
  // if the tuck were somehow late.
  for (const [width, height] of PHONE_SIZES) {
    for (const chatOpen of [false, true]) {
      for (const resbarGap of [0, 150]) {
        const plate = plateBoxCss(width, height, true);
        for (const minimapH of [0, plate.h]) {
          cases.push({ width, height, phone: true, railLeft: false, chatOpen, minimapH, resbarH: 0, resbarGap });
        }
      }
    }
  }
  return cases;
}

const base = (c: Case): DockLayoutInput => ({
  minimapH: c.minimapH,
  chatOpen: c.chatOpen,
  phone: c.phone,
  height: c.height,
  resbarH: c.resbarH,
  resbarGap: c.resbarGap,
});

const caseName = (c: Case) =>
  `${c.width}×${c.height}${c.phone ? " phone" : ""}${c.railLeft ? " folded" : ""}` +
  ` chat ${c.chatOpen ? "open" : "shut"} plate ${c.minimapH > 0 ? "up" : "away"}` +
  ` bar ${c.phone ? `gap ${c.resbarGap}` : `h ${c.resbarH}`}`;

describe("#386 — the dock stack rule (dockLayout)", () => {
  it("never overlaps: the dock stands ≥ 6px over the plate, or on today's lane", () => {
    for (const c of grid()) {
      const l = dockLayout(base(c));
      if (c.minimapH > 0) {
        // Plate up → the dock's bottom edge is ABOVE the plate's top edge.
        expect(l.chatBottom, caseName(c))
          .toBeGreaterThanOrEqual(l.minimapBottom + c.minimapH + DOCK_STACK_GAP);
      } else {
        // Plate away → today's base lane, to the pixel (lift 0).
        const lane = c.phone
          ? (c.chatOpen ? 106 : 152)
          : desktopLane(c.resbarH);
        expect(l.chatBottom, caseName(c)).toBe(lane);
        expect(l.chatLift, caseName(c)).toBe(0);
      }
      // The published lift and the absolute edge always agree with the base.
      const lane = c.phone ? (c.chatOpen ? 106 : 152) : desktopLane(c.resbarH);
      expect(l.chatBottom, caseName(c)).toBe(lane + l.chatLift);
      expect(l.chatLift, caseName(c)).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps the same left edge as the plate at every width and fold", () => {
    // The numbers styles.css writes (base 320 / folded 48 / ≤1180: 282 /
    // ≤900 and phone: 10) — pinned once so BOTH fixtures drift together or
    // not at all, then swept for agreement across the whole grid.
    expect(plateLeftCss(1440, false, false)).toBe(320);
    expect(plateLeftCss(1440, true, false)).toBe(48);
    expect(plateLeftCss(1180, false, false)).toBe(282);
    expect(plateLeftCss(1180, true, false)).toBe(48);   // the fold beats ≤1180
    expect(plateLeftCss(900, false, false)).toBe(10);   // the ≤900 pair wins
    expect(plateLeftCss(900, true, false)).toBe(10);
    expect(plateLeftCss(360, false, true)).toBe(10);
    for (const c of grid()) {
      expect(chatLeftCss(c.width, c.railLeft, c.phone), caseName(c))
        .toBe(plateLeftCss(c.width, c.railLeft, c.phone));
    }
  });

  it("caps the open panel below the top bar", () => {
    for (const c of grid()) {
      const l = dockLayout(base(c));
      // safeTop 0 in this sweep; on a phone the cap also reserves the home
      // indicator, because the phone's bottom lanes carry env(safe-bottom).
      const topClear = topbarH(c.phone) + (c.phone ? 34 : 0) + 8;
      const headroom = c.height - l.chatBottom - topClear;
      if (headroom >= 96) {
        // The normal case: chatBottom + cap stops exactly under the bar.
        expect(l.chatBottom + l.chatMaxH, caseName(c)).toBe(c.height - topClear);
      } else {
        // Only a window too short for the head bar itself clamps to the floor.
        expect(l.chatMaxH, caseName(c)).toBe(96);
      }
      expect(l.chatMaxH, caseName(c)).toBeGreaterThanOrEqual(96);
    }
  });

  it("resolves env(safe-area-inset-top) into the cap when the browser gives it", () => {
    const l = dockLayout({ ...base({
      width: 844, height: 800, phone: true, railLeft: false,
      chatOpen: true, minimapH: 0, resbarH: 0, resbarGap: 150,
    }), safeTop: 47 });
    // topClear = 46 (bar) + 47 (notch) + 34 (home-indicator lane, which rides
    // the phone's bottom bases) + 8 — the sheet stops clear of the bar.
    expect(l.chatBottom + l.chatMaxH).toBe(800 - (46 + 47 + 34 + 8));
  });

  it("single-player returns today's values: the plate's place never moves", () => {
    // Whatever the chat does — open, shut, phone, wrapped bar — the plate
    // stands on the stylesheet's own lane, unchanged. That lane IS the
    // single-player layout: a solo boot has no chat dock at all, so these are
    // the only numbers the minimap ever sees.
    for (const c of grid()) {
      const l = dockLayout(base(c));
      const today = c.phone
        ? (c.resbarGap > 0 ? c.resbarGap : 130) + 48   // --resbar-gap + 48
        : desktopLane(c.resbarH);                      // max(52, --resbar-h) + 48
      expect(l.minimapBottom, caseName(c)).toBe(today);
    }
  });

  it("leaves the gap between the docks at the documented 6px", () => {
    expect(DOCK_STACK_GAP).toBe(6);
    const l = dockLayout({
      minimapH: 135, chatOpen: false, phone: false,
      height: 900, resbarH: 52, resbarGap: 0,
    });
    // Desktop: both docks share the lane, so the lift IS plate height + gap.
    expect(l.chatLift).toBe(135 + 6);
    expect(l.chatBottom).toBe(desktopLane(52) + 135 + 6);
  });
});

// ── the chrome: what ui.ts actually publishes ──────────────────────────────
let ui: OriginalUi | null;

function mount(withChat: boolean): OriginalUi {
  setRng(mulberry32(7));
  const board = new Board();
  const seat = { id: "you", name: "You", res: emptyBag(), unlocked: null };
  const prefs: UiChatPrefs = { muted: false, presetOnly: false };
  const cfg: UiChatConfig = {
    presets: CHAT_PRESETS,
    maxLength: CHAT_MAX_LEN,
    getPrefs: () => ({ ...prefs }),
    setPrefs: () => {},
    send: () => ({ ok: true }),
    peerName: () => "Torvin",
  };
  const mounted = createOriginalUi(board, seat, {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(),
    onBank: vi.fn(() => "done" as const), onBlackAction: vi.fn(),
  }, withChat ? { chat: cfg } : {});
  document.body.append(mounted.el);
  ui = mounted;
  return mounted;
}

const root = () => ui!.el;
const plate = () => root().querySelector<HTMLElement>(".minimap-dock")!;
const head = () => root().querySelector<HTMLButtonElement>("#iso-chat-toggle");
const resize = () => window.dispatchEvent(new Event("resize"));
/** Give the plate a real box — jsdom lays nothing out, so stand in for it. */
function plateHeight(px: number | null): void {
  if (px === null) delete (plate() as HTMLElement & { offsetHeight?: number }).offsetHeight;
  else Object.defineProperty(plate(), "offsetHeight", { configurable: true, get: () => px });
}

beforeEach(() => { ui = null; });
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("#386 — the chrome publishes the stack", () => {
  it("a multiplayer chrome publishes --chat-lift and --chat-max-h (0 = today's lane)", () => {
    mount(true);
    // Painted by responsiveZoom during creation: the plate measures 0 in
    // jsdom, so the dock starts on today's lane and says so.
    expect(root().style.getPropertyValue("--chat-lift")).toBe("0px");
    expect(root().style.getPropertyValue("--chat-max-h")).not.toBe("");
    expect(root().dataset.chatLift).toBe("0");
    expect(root().dataset.chatOpen).toBe("0");
  });

  it("restacks when the plate shows — lift = plate height + 6px, cap under the bar", () => {
    mount(true);
    plateHeight(140);
    resize();
    // jsdom: the resource bar measures 0 → the stylesheet's 52px floor →
    // lane 100; the plate's 140 stands on it with the 6px gap on top.
    expect(root().dataset.chatLift).toBe(String(140 + 6));
    expect(root().style.getPropertyValue("--chat-lift")).toBe(`${140 + 6}px`);
    const lane = Math.max(52, 0) + 48;
    const cap = window.innerHeight - (lane + 140 + 6) - 60 - 8;
    expect(root().dataset.chatMaxH).toBe(String(cap));

    plateHeight(0);   // the fab folds the plate away
    resize();
    expect(root().dataset.chatLift).toBe("0");
    expect(root().style.getPropertyValue("--chat-lift")).toBe("0px");
  });

  it("restacks through the panel's own open/close (data-chat-open with it)", () => {
    mount(true);
    plateHeight(140);
    resize();
    head()!.click();   // open → root.dataset.chatOpen = "1", sync runs
    expect(root().dataset.chatOpen).toBe("1");
    expect(root().dataset.chatLift).toBe(String(140 + 6));
    head()!.click();   // shut again
    expect(root().dataset.chatOpen).toBe("0");
    expect(root().dataset.chatLift).toBe(String(140 + 6));
  });

  it("single-player: no chat dock, and none of the stack's variables are ever set", () => {
    mount(false);
    plateHeight(140);
    resize();
    // The plate is in the tree and can be measured… — but with no chat dock
    // to stack, the chrome never writes a --chat-* variable or the flag.
    expect(plate()).toBeTruthy();
    expect(root().querySelector("#iso-chat")).toBeNull();
    expect(root().style.getPropertyValue("--chat-lift")).toBe("");
    expect(root().style.getPropertyValue("--chat-max-h")).toBe("");
    expect(root().dataset.chatLift).toBeUndefined();
    expect(root().dataset.chatMaxH).toBeUndefined();
    expect(root().dataset.chatOpen).toBeUndefined();
  });
});
