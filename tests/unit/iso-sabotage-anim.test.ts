// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// M3 (#258) — the sabotage event window's animation.
//
// The PURE layer (what to paint, at what time) is pinned first: each kind has
// its own props, a frame is a pure function of (kind, t), every motion is a
// whole number of cycles over the kind's period so the loop has no seam, and
// nothing is ever painted outside the slot.
//
// Then the CONTROLLER: no canvas and no context until a window is opened (the
// ticket's "animations load only when opened"), one frame per tick while open,
// NOTHING per tick while closed, no second requestAnimationFrame loop, and
// reduced motion — read live — leaves the still image alone and paints no
// frame at all.
//
// Then the two of them through #256's window, which is the component a player
// actually opens.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from "vitest";
import {
  SABOTAGE_ANIM_PERIOD_MS, SABOTAGE_SLOT_FALLBACK_W, createSabotageOverlay,
  drawSabotageOverlay, sabotageAnimKind, sabotageAnimPeriod, sabotageOverlayFrame,
  type SabotageOp,
} from "../../src/iso/sabotage-anim";
import {
  createSabotageEventWindow, createSabotageImageSlot, type SabotageEvent,
} from "../../src/iso/protest";
import { BANDIT_MS, PROTEST_MS } from "../../src/game/config";

vi.mock("../../src/assets/sabotage/blockade.png", () => ({ default: "blockade.png" }));
vi.mock("../../src/assets/sabotage/protest.png", () => ({ default: "protest.png" }));

// ── helpers ───────────────────────────────────────────────────────────────
/** Floats are compared after a 1e-6 rounding: the loop is exact, but `t + P`
 *  is not the same double as `t` plus a whole number of cycles. */
const clean = (ops: readonly SabotageOp[]): unknown =>
  JSON.parse(JSON.stringify(ops, (_k, v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v)));

const sample = (kind: string, count = 24) => {
  const P = sabotageAnimPeriod(kind);
  return Array.from({ length: count }, (_v, i) => sabotageOverlayFrame(kind, (i * P) / count));
};

/** A 2d context that records every method call, like the minimap's DOM test. */
function recordingCtx() {
  const calls: { method: string; args: unknown[] }[] = [];
  const fills: string[] = [];
  const store: Record<string, unknown> = {};
  const ctx = new Proxy(store, {
    get(t, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop === "fillStyle") return t[prop];
      return (...args: unknown[]) => { calls.push({ method: prop, args }); };
    },
    set(t, prop, value) {
      if (prop === "fillStyle") fills.push(String(value));
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, fills };
}

/** A MediaQueryList the test drives: `set(true)` is the OS asking for less motion. */
function stubMotion(reduce: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: reduce,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (_type: string, cb: () => void) => { listeners.add(cb); },
    removeEventListener: (_type: string, cb: () => void) => { listeners.delete(cb); },
    addListener: (cb: () => void) => { listeners.add(cb); },
    removeListener: (cb: () => void) => { listeners.delete(cb); },
    dispatchEvent: () => true,
  };
  const original = window.matchMedia;
  window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
  return {
    listeners,
    set(next: boolean) { query.matches = next; for (const cb of [...listeners]) cb(); },
    restore() { window.matchMedia = original; },
  };
}

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  host.remove();
  vi.restoreAllMocks();
});

// ── the pure frames ───────────────────────────────────────────────────────
describe("M3 (#258) sabotage overlay frames", () => {
  const KINDS = ["protest", "blockade"] as const;

  it("maps a kind onto its animation, whatever the image table calls it", () => {
    expect(sabotageAnimKind("protest")).toBe("protest");
    expect(sabotageAnimKind("blockade")).toBe("blockade");
    expect(sabotageAnimKind("bandit")).toBe("blockade");   // #256's alias
    expect(sabotageAnimKind("something-new")).toBe("blockade");
    expect(sabotageAnimPeriod("protest")).toBe(SABOTAGE_ANIM_PERIOD_MS.protest);
    expect(sabotageAnimPeriod("bandit")).toBe(SABOTAGE_ANIM_PERIOD_MS.blockade);
  });

  it("is a pure function of (kind, t)", () => {
    for (const kind of KINDS) {
      expect(clean(sabotageOverlayFrame(kind, 1234))).toEqual(clean(sabotageOverlayFrame(kind, 1234)));
      expect(clean(sabotageOverlayFrame(kind, 0))).toEqual(clean(sabotageOverlayFrame(kind, 0)));
      // a nonsense clock must not throw or produce NaN
      for (const op of sabotageOverlayFrame(kind, NaN)) {
        for (const [key, value] of Object.entries(op)) {
          if (typeof value === "number") expect(Number.isFinite(value), `${kind}.${key}`).toBe(true);
        }
      }
    }
  });

  it("loops with no seam: t and t + period are the same frame", () => {
    for (const kind of KINDS) {
      const P = SABOTAGE_ANIM_PERIOD_MS[kind];
      for (const t of [0, 137, 913, 2599]) {
        expect(clean(sabotageOverlayFrame(kind, t)), `${kind} @ ${t}`)
          .toEqual(clean(sabotageOverlayFrame(kind, t + P)));
      }
    }
  });

  it("paints both kinds with props, and never outside the slot", () => {
    for (const kind of KINDS) {
      const kinds = new Set<string>();
      for (const frame of sample(kind)) {
        expect(frame.length).toBeGreaterThan(8);
        expect(frame.length).toBeLessThan(64);      // the per-frame budget stays tiny
        for (const op of frame) {
          kinds.add(op.kind);
          expect(op.x, `${kind} ${op.kind}.x`).toBeGreaterThanOrEqual(0);
          expect(op.x).toBeLessThanOrEqual(1);
          expect(op.y, `${kind} ${op.kind}.y`).toBeGreaterThanOrEqual(0);
          expect(op.y).toBeLessThanOrEqual(1);
          if ("colour" in op) expect(op.colour).toMatch(/^#[0-9a-f]{6}$/i);
          const alpha = (op as { alpha?: number }).alpha;
          if (alpha !== undefined) {
            expect(alpha).toBeGreaterThanOrEqual(0);
            expect(alpha).toBeLessThanOrEqual(1);
          }
          if (op.kind === "glow" || op.kind === "puff" || op.kind === "dot") {
            expect(op.r).toBeGreaterThan(0);
            expect(op.r).toBeLessThan(0.5);
          }
          if (op.kind === "figure") {
            expect(op.scale).toBeGreaterThan(0);
            expect(op.scale).toBeLessThan(0.5);
            expect(Math.abs(op.bob)).toBeLessThanOrEqual(1);
            expect(Math.abs(op.stride)).toBeLessThanOrEqual(1);
          }
          if (op.kind === "sign") {
            expect(op.w).toBeGreaterThan(0);
            expect(op.h).toBeGreaterThan(0);
          }
        }
      }
      // every primitive the painter knows how to draw is exercised
      expect([...kinds].sort()).toEqual(["dot", "figure", "glow", "puff", "sign"]);
    }
  });

  it("protest: the picket line bobs out of step and the lorry honks three times a loop", () => {
    const P = SABOTAGE_ANIM_PERIOD_MS.protest;
    const figures = (t: number) => sabotageOverlayFrame("protest", t)
      .filter((op) => op.kind === "figure") as Extract<SabotageOp, { kind: "figure" }>[];

    const crowd = figures(0);
    expect(crowd).toHaveLength(6);
    // out of step: no two picketers are at the same point in their bob
    expect(new Set(crowd.map((f) => Math.round(f.bob * 1000))).size).toBeGreaterThan(3);
    // and they move: every one of them is somewhere else half a loop later
    const later = figures(P / 2);
    expect(crowd.map((f) => Math.round(f.bob * 1000))).not.toEqual(later.map((f) => Math.round(f.bob * 1000)));

    // the horn: dot of the 3-cycle wave → loud at P/12 (sin = 1), silent at P/4 (sin = -1)
    const horn = (t: number) => sabotageOverlayFrame("protest", t)
      .filter((op) => op.kind === "dot" && op.colour === "#ffd75a") as Extract<SabotageOp, { kind: "dot" }>[];
    expect(horn(P / 12)).toHaveLength(3);
    expect(horn(P / 12).every((d) => Math.abs(d.alpha - 0.5) < 1e-6)).toBe(true);
    expect(horn(P / 12).some((d) => d.r > 0.03)).toBe(true);
    expect(horn(P / 4).every((d) => d.alpha < 1e-6)).toBe(true);

    // the fire smokes: something is always climbing out of it
    const puffs = sabotageOverlayFrame("protest", 0.3 * P)
      .filter((op) => op.kind === "puff") as Extract<SabotageOp, { kind: "puff" }>[];
    expect(puffs).toHaveLength(5);
    expect(puffs.some((p) => p.alpha > 0.05)).toBe(true);
    expect(Math.min(...puffs.map((p) => p.y))).toBeLessThan(0.78);
  });

  it("blockade: bandits sat at the crate deal cards across it, under a swinging lamp", () => {
    const P = SABOTAGE_ANIM_PERIOD_MS.blockade;
    const kinds = sample("blockade");
    const figures = sabotageOverlayFrame("blockade", 0).filter((op) => op.kind === "figure");
    expect(figures).toHaveLength(3);
    expect(figures.every((f) => (f as Extract<SabotageOp, { kind: "figure" }>).sit)).toBe(true);

    const cards = (ops: readonly SabotageOp[]) =>
      ops.filter((op) => op.kind === "sign" && op.colour === "#f4ecd8") as Extract<SabotageOp, { kind: "sign" }>[];
    const flown = kinds.flatMap(cards);
    expect(flown.length).toBeGreaterThan(0);
    // dealt from one side of the crate to the other, over the whole loop
    expect(Math.min(...flown.map((c) => c.x))).toBeLessThan(0.4);
    expect(Math.max(...flown.map((c) => c.x))).toBeGreaterThan(0.6);
    // a card in flight is off the table's line — the arc, not a slide
    expect(flown.some((c) => c.y < 0.56)).toBe(true);
    // and each one fades in as it leaves a hand and out as it lands, so the
    // loop's seam (alpha 0) is invisible
    expect(flown.every((c) => (c.alpha ?? 1) >= 0 && (c.alpha ?? 1) <= 1)).toBe(true);
    expect(flown.some((c) => (c.alpha ?? 1) < 0.3)).toBe(true);

    // the lamp swings: the lamp dot is at a different x over the loop, and the
    // candlelight behind it flickers (its alpha is not constant)
    const lamps = kinds.map((ops) =>
      ops.filter((op) => op.kind === "dot" && op.x > 0.7) as Extract<SabotageOp, { kind: "dot" }>[]);
    expect(new Set(lamps.map((l) => Math.round(l[0].x * 1000))).size).toBeGreaterThan(4);
    const glow = kinds.map((ops) => ops.filter((op) => op.kind === "glow" && op.x > 0.7)[0].alpha);
    expect(Math.max(...glow) - Math.min(...glow)).toBeGreaterThan(0.05);
  });
});

// ── the painter ───────────────────────────────────────────────────────────
describe("M3 (#258) sabotage overlay painter", () => {
  const oneOfEach: SabotageOp[] = [
    { kind: "glow", x: 0.5, y: 0.5, r: 0.2, colour: "#ff9a3c", alpha: 0.3 },
    { kind: "puff", x: 0.5, y: 0.5, r: 0.1, alpha: 0.3 },
    { kind: "figure", x: 0.5, y: 0.9, scale: 0.2, bob: 0.5, stride: -0.5, colour: "#c9563c" },
    { kind: "figure", x: 0.4, y: 0.9, scale: 0.2, bob: 0, stride: 0, colour: "#4f7fb4", sit: true },
    { kind: "sign", x: 0.5, y: 0.4, w: 0.2, h: 0.1, tilt: 0.2, colour: "#efe3c4", post: true },
    { kind: "sign", x: 0.6, y: 0.6, w: 0.1, h: 0.08, tilt: -0.4, colour: "#f4ecd8", alpha: 0.25 },
    { kind: "dot", x: 0.8, y: 0.3, r: 0.02, colour: "#ffd75a", alpha: 0.5 },
  ];

  it("clears the canvas first and then paints every op", () => {
    const { ctx, calls } = recordingCtx();
    drawSabotageOverlay(ctx, oneOfEach, 320, 180);
    expect(calls[0]).toEqual({ method: "clearRect", args: [0, 0, 320, 180] });
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("arc");
    expect(methods).toContain("fillRect");
    expect(methods.filter((m) => m === "save").length).toBe(methods.filter((m) => m === "restore").length);  // balanced
    expect(methods.filter((m) => m === "save").length).toBe(2);          // the two signs
    // 3 glow rings + 1 puff + 2 heads + 1 dot
    expect(methods.filter((m) => m === "arc").length).toBe(7);

    // nothing to paint is still a clear — a frame that ends the animation leaves
    // the still image, not the last animated frame
    const empty = recordingCtx();
    drawSabotageOverlay(empty.ctx, [], 320, 180);
    expect(empty.calls).toEqual([{ method: "clearRect", args: [0, 0, 320, 180] }]);
  });

  it("scales ops to the canvas: positions in slot fractions, sizes in slot heights", () => {
    const { ctx, calls, fills } = recordingCtx();
    drawSabotageOverlay(ctx, [{ kind: "dot", x: 0.5, y: 0.9, r: 0.02, colour: "#ffffff", alpha: 0.5 }], 320, 180);
    const arc = calls.find((c) => c.method === "arc")!;
    expect(arc.args[0]).toBeCloseTo(160, 6);
    expect(arc.args[1]).toBeCloseTo(162, 6);
    expect(arc.args[2]).toBeCloseTo(3.6, 6);            // 0.02 × the 180px height
    expect(fills).toContain("rgba(255, 255, 255, 0.5)");
  });
});

// ── the controller ────────────────────────────────────────────────────────
describe("M3 (#258) sabotage overlay controller", () => {
  let getContext: MockInstance;
  let rec: { ctx: CanvasRenderingContext2D; calls: { method: string; args: unknown[] }[]; fills: string[] };

  beforeEach(() => {
    rec = recordingCtx();
    // Like the plate tests: jsdom has no 2d context of its own.
    getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation((() => rec.ctx) as never);
  });

  it("makes no canvas and touches no context until a window is opened", () => {
    const overlay = createSabotageOverlay({ host });
    expect(overlay.canvas).toBeNull();
    expect(overlay.running).toBe(false);
    expect(host.querySelectorAll("canvas")).toHaveLength(0);
    for (let i = 0; i < 30; i++) overlay.tick(i * 16);         // a closed window's frame
    expect(getContext).not.toHaveBeenCalled();
    expect(rec.calls).toEqual([]);
    expect(overlay.frames).toBe(0);
    overlay.destroy();
  });

  it("paints one frame per tick while open — on the game's clock, with no rAF of its own", () => {
    const raf = typeof globalThis.requestAnimationFrame === "function"
      ? vi.spyOn(globalThis, "requestAnimationFrame") : null;
    const overlay = createSabotageOverlay({ host });
    overlay.setKind("protest");
    overlay.start();

    const canvas = overlay.canvas!;
    expect(canvas.className).toBe("sabotage-anim-overlay");
    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
    expect(overlay.running).toBe(true);

    overlay.tick(0);
    const afterFirst = rec.calls.length;
    expect(afterFirst).toBeGreaterThan(6);
    expect(rec.calls[0].method).toBe("clearRect");
    expect(overlay.frames).toBe(1);

    overlay.tick(16);
    expect(rec.calls.length).toBeGreaterThan(afterFirst);      // a second frame, not a key compare
    expect(overlay.frames).toBe(2);
    expect(raf?.mock.calls.length ?? 0).toBe(0);

    // closed: the canvas is blanked once, and every later tick is free
    overlay.stop();
    expect(overlay.running).toBe(false);
    const blanked = rec.calls.length;
    expect(rec.calls[blanked - 1].method).toBe("clearRect");
    for (let i = 0; i < 20; i++) overlay.tick(100 + i * 16);
    expect(rec.calls.length).toBe(blanked);
    expect(overlay.frames).toBe(2);

    // reopening keeps the same canvas (the budget is "created once, used often")
    overlay.start();
    overlay.tick(400);
    expect(overlay.canvas).toBe(canvas);
    expect(overlay.frames).toBe(3);
    overlay.destroy();
  });

  it("sizes the backing store to the slot and the device pixel ratio", () => {
    Object.defineProperty(host, "clientWidth", { value: 320, configurable: true });
    Object.defineProperty(host, "clientHeight", { value: 180, configurable: true });
    const dpr = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    try {
      const overlay = createSabotageOverlay({ host });
      overlay.start();
      expect([overlay.canvas!.width, overlay.canvas!.height]).toEqual([640, 360]);
      overlay.tick(0);
      // the painter gets the backing store, and the ops scale with it
      expect(rec.calls[0]).toEqual({ method: "clearRect", args: [0, 0, 640, 360] });
      overlay.destroy();
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: dpr, configurable: true });
    }
  });

  it("falls back to a drawable size on a slot that has never been laid out", () => {
    // jsdom's clientWidth is 0, exactly like a slot inside a display:none window
    const overlay = createSabotageOverlay({ host });
    overlay.start();
    expect(overlay.canvas!.width).toBe(SABOTAGE_SLOT_FALLBACK_W);
    expect(overlay.canvas!.height).toBe(Math.round((SABOTAGE_SLOT_FALLBACK_W * 9) / 16));
    overlay.destroy();
  });

  it("shows the STILL under reduced motion, and never starts painting", () => {
    const motion = stubMotion(true);
    try {
      const overlay = createSabotageOverlay({ host });
      overlay.setKind("blockade");
      overlay.start();
      expect(overlay.running).toBe(false);
      expect(overlay.canvas).toBeNull();                 // nothing is even created
      expect(host.querySelectorAll("canvas")).toHaveLength(0);
      for (let i = 0; i < 20; i++) overlay.tick(i * 16);
      expect(getContext).not.toHaveBeenCalled();
      expect(rec.calls).toEqual([]);
      expect(overlay.frames).toBe(0);
      overlay.destroy();
    } finally {
      motion.restore();
    }
  });

  it("follows the OS setting live: reduced motion stops mid-event, and back", () => {
    const motion = stubMotion(false);
    try {
      const overlay = createSabotageOverlay({ host });
      overlay.start();
      overlay.tick(0);
      expect(overlay.running).toBe(true);
      expect(overlay.frames).toBe(1);
      const canvas = overlay.canvas!;

      motion.set(true);                                   // the player flips the setting
      expect(overlay.running).toBe(false);
      const blanked = rec.calls.length;
      expect(rec.calls[blanked - 1].method).toBe("clearRect");   // the still shows again
      for (let i = 1; i <= 10; i++) overlay.tick(i * 16);
      expect(overlay.frames).toBe(1);

      motion.set(false);                                  // and back
      expect(overlay.running).toBe(true);
      overlay.tick(200);
      expect(overlay.frames).toBe(2);
      expect(overlay.canvas).toBe(canvas);                // no second canvas, no reload
      overlay.destroy();
    } finally {
      motion.restore();
    }
  });

  it("destroy drops the canvas and the media-query listener", () => {
    const motion = stubMotion(false);
    try {
      const overlay = createSabotageOverlay({ host });
      overlay.start();
      overlay.tick(0);
      expect(motion.listeners.size).toBe(1);
      overlay.destroy();
      expect(motion.listeners.size).toBe(0);
      expect(host.querySelectorAll("canvas")).toHaveLength(0);
      expect(overlay.canvas).toBeNull();
      const calls = rec.calls.length;
      overlay.tick(1000);
      expect(rec.calls.length).toBe(calls);
    } finally {
      motion.restore();
    }
  });
});

// ── through #256's window ─────────────────────────────────────────────────
describe("M3 (#258) the event window animates", () => {
  const event = (kind: "blockade" | "protest", until: number): SabotageEvent => ({
    id: `${kind}:7`,
    kind,
    tx: 30,
    ty: 40,
    until,
    totalDuration: kind === "protest" ? PROTEST_MS : BANDIT_MS,
    owner: "ai",
    targetName: "Public Road (30, 40)",
    label: kind === "protest" ? "Protest" : "Blockade",
  });

  let getContext: MockInstance;
  let rec: { ctx: CanvasRenderingContext2D; calls: { method: string; args: unknown[] }[]; fills: string[] };

  beforeEach(() => {
    rec = recordingCtx();
    getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation((() => rec.ctx) as never);
  });

  it("starts when the window opens, ticks with the frame, stops when it closes", () => {
    const win = createSabotageEventWindow({ host, onGoTo: vi.fn() });
    expect(win.animating).toBe(false);
    expect(host.querySelectorAll("canvas")).toHaveLength(0);

    const now = performance.now();
    win.open(event("protest", now + 60000));
    expect(win.animating).toBe(true);
    expect(host.querySelectorAll("canvas.sabotage-anim-overlay")).toHaveLength(1);

    win.update(now);
    win.update(now + 16);
    win.update(now + 32);
    expect(win.frames).toBe(3);

    // switching the sabotage restarts the loop on the new kind
    win.open(event("blockade", now + 60000));
    win.update(now + 48);
    expect(win.animating).toBe(true);
    expect(win.frames).toBe(4);

    win.close();
    expect(win.animating).toBe(false);
    const calls = rec.calls.length;
    for (let i = 0; i < 10; i++) win.update(now + 64 + i * 16);
    expect(rec.calls.length).toBe(calls);
    expect(win.frames).toBe(4);

    win.destroy();
    expect(host.querySelectorAll("canvas")).toHaveLength(0);
  });

  it("leaves the still image and paints nothing under reduced motion", () => {
    const motion = stubMotion(true);
    try {
      const win = createSabotageEventWindow({ host, onGoTo: vi.fn() });
      const now = performance.now();
      win.open(event("blockade", now + 60000));
      expect(win.isOpen).toBe(true);
      expect(win.animating).toBe(false);
      expect(host.querySelectorAll("canvas")).toHaveLength(0);
      for (let i = 0; i < 10; i++) win.update(now + i * 16);
      expect(getContext).not.toHaveBeenCalled();
      expect(win.frames).toBe(0);
      // the illustration itself is untouched
      const img = win.element.querySelector(".sabotage-illustration") as HTMLImageElement;
      expect(img.src).toContain("blockade.png");
      win.destroy();
    } finally {
      motion.restore();
    }
  });

  it("the slot keeps both layers and hands them back on destroy", () => {
    const slot = createSabotageImageSlot("protest");
    expect(slot.animating).toBe(false);
    expect(slot.canvas).toBeNull();
    slot.setKind("bandit");                       // #256's alias for a blockade
    expect(slot.element.dataset.kind).toBe("bandit");
    expect(slot.img.src).toContain("blockade.png");
    slot.start();
    slot.tick(0);
    expect(slot.animating).toBe(true);
    expect(slot.frames).toBe(1);
    expect(slot.element.querySelectorAll("canvas")).toHaveLength(1);
    slot.stop();
    expect(slot.animating).toBe(false);
    slot.destroy();
    expect(slot.element.querySelectorAll("canvas")).toHaveLength(0);
  });
});
