// ══════════════════════════════════════════════════════════════════════════
// M3 (#258) — the sabotage event window MOVES.
//
// #256's window shows a still illustration per sabotage kind (a placeholder
// PNG today, the lead's art later — `src/assets/sabotage/*.png`). This module
// animates the WINDOW and the overlays painted ON TOP of that picture; it
// never animates pixels baked into the picture, so the lead can swap the
// placeholders for the real art without re-timing anything.
//
//   protest   a picket line bobbing out of step, signs waving, a barrel fire
//             smoking, and a lorry at the kerb leaning on its horn
//   blockade  three bandits sat at the gate crate playing cards, a lantern
//             swinging on its hook, cigar smoke
//
// Two pieces, split the way every #254/#256 module here is split, so the
// rules are testable without a canvas:
//
//   sabotageOverlayFrame(kind, t)  PURE — the shapes to paint at time `t`
//                                  (see SabotageOp; positions are fractions of
//                                  the slot, sizes are fractions of its
//                                  HEIGHT, so any canvas size draws the same
//                                  picture).
//   createSabotageOverlay({host})  the controller — one canvas stacked over
//                                  the still, driven by the GAME's own frame
//                                  clock (the window's `update(t)`), not by a
//                                  second requestAnimationFrame loop.
//
// ── cost ────────────────────────────────────────────────────────────────
// Boot: nothing. No image, no canvas, no context — the canvas is made the
// first time a window is OPENED (`start()`) and never before, which is the
// "animations load only when opened" budget from the ticket.
// Open: one clearRect plus ~25 vector shapes per frame on a ≤300×170 canvas.
// Closed, or `prefers-reduced-motion: reduce`: `tick()` returns before it
// touches the context (the still image is what the player sees), and the
// media query is re-read when the OS setting changes, so flipping it mid-event
// stops the overlay on the next frame without reopening the window.
//
// ── art brief (for the lead's replacement PNGs) ─────────────────────────
// The overlays assume the still is the SAME 16:9 crop and leave room for:
//   protest   a dark or mid-tone backdrop, a ground line near 90% height and
//             clear air above it: a sign-bearing crowd with a burning barrel
//             in the middle of it and a lorry at the kerb on the left draw
//             from about 55% height down.
//   blockade  the gate/industry in the upper third, an empty middle for the
//             crate and the card game, and the lower fifth free of faces — a
//             seated bandit band with a lantern to its right draws there.
// Sizes above 1.0 (the plank across the gate) and positions at 0 or 1 are
// allowed, so a new PNG needs no re-timing and no code change.
// ══════════════════════════════════════════════════════════════════════════

/** The two illustrations #256 ships. `bandit` is that table's alias for a blockade. */
export type SabotageAnimKind = "blockade" | "protest";

/** Maps any event kind (or image-table key) onto an animation. */
export function sabotageAnimKind(kind: string): SabotageAnimKind {
  return kind === "protest" ? "protest" : "blockade";
}

/**
 * One loop length per kind, ms. Every motion below is a WHOLE number of cycles
 * over the period (and every travelling prop uses a `rise` counter that runs
 * 0→1), so the last frame joins the first with no jump — the loop has no seam.
 */
export const SABOTAGE_ANIM_PERIOD_MS: Record<SabotageAnimKind, number> = {
  protest: 2600,
  blockade: 3400,
};

export const sabotageAnimPeriod = (kind: string): number =>
  SABOTAGE_ANIM_PERIOD_MS[sabotageAnimKind(kind)];

// ── the ops ───────────────────────────────────────────────────────────────
/**
 * A soft light pool (a fire, a lamp on the crate).
 * `x`/`y` are fractions of the slot's width/height; `r` is a fraction of the
 * slot's HEIGHT. `alpha` 0..1 multiplies the colour.
 */
export interface SabotageGlowOp {
  kind: "glow"; x: number; y: number; r: number; colour: string; alpha: number;
}
/** A smoke puff. Same units as a glow. */
export interface SabotagePuffOp {
  kind: "puff"; x: number; y: number; r: number; alpha: number;
}
/**
 * A person, feet at (`x`, `y`), `scale` = their height in slot heights.
 * `bob` (-1..1) lifts them, `stride` (-1..1) swings their legs; `sit` folds
 * them (a bandit on the crate) and keeps their legs out of the way.
 */
export interface SabotageFigureOp {
  kind: "figure"; x: number; y: number; scale: number; bob: number; stride: number;
  colour: string; sit?: boolean;
}
/**
 * A board (`w`×`h` in slot heights) centred on (`x`, `y`), rotated by `tilt`
 * radians — a picket sign when `post` is set (the post hangs to the hand
 * below), a lorry, a crate or a flying playing card when it is not.
 */
export interface SabotageSignOp {
  kind: "sign"; x: number; y: number; w: number; h: number; tilt: number;
  colour: string; post?: boolean; alpha?: number;
}
/** A small round — a bulb, a headlight, a honk leaving the cab. */
export interface SabotageDotOp {
  kind: "dot"; x: number; y: number; r: number; colour: string; alpha: number;
}

export type SabotageOp =
  | SabotageGlowOp | SabotagePuffOp | SabotageFigureOp | SabotageSignOp | SabotageDotOp;

// ── the pure frames ───────────────────────────────────────────────────────
const TAU = Math.PI * 2;

/** `#rrggbb` + alpha → `rgba(...)`; any other colour string is passed through. */
function tint(colour: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(colour);
  if (!m) return colour;
  const n = parseInt(m[1], 16);
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Per-actor variety without an RNG: the golden-ratio spread, so a crowd never
 * falls into step and the frame is still a pure function of (kind, t).
 */
const PHI = 0.6180339887498949;
const frac = (v: number) => v - Math.floor(v);
/** A 0→1 counter that wraps once per period — a puff's climb, a card's flight. */
const rise = (t: number, period: number, i: number, k = 1) => frac(t * (k / period) + i * PHI);
/** -1..1, a whole number of cycles per period — a bob, a sway, a flicker. */
const wave = (t: number, period: number, i: number, k = 1) => Math.sin(TAU * rise(t, period, i, k));

const PICKET_COLOURS = ["#c9563c", "#4f7fb4", "#c39a3e", "#6f9457", "#a25f92"];
const SIGN_COLOURS = ["#efe3c4", "#e2c690", "#d8ccae"];
const SMOKE = "#a9a49b";
const BANDIT_COLOURS = ["#8a6f52", "#7d6247", "#6f5a46"];
const CARD_COLOUR = "#f4ecd8";

/**
 * The shapes the sabotage overlay paints at `t` ms into the loop.
 *
 * Pure and total: the same `(kind, t)` always yields the same ops (deep-equal),
 * `t` and `t + period` yield the same frame, and every op is inside the slot.
 */
export function sabotageOverlayFrame(kind: string, tMs: number): SabotageOp[] {
  const k = sabotageAnimKind(kind);
  const period = SABOTAGE_ANIM_PERIOD_MS[k];
  const raw = Number.isFinite(tMs) ? tMs : 0;
  // The phase in the loop, not the clock: `t` and `t + period` then normalise
  // to the SAME double (fmod is exact), which is what makes the seam literally
  // pixel-identical rather than merely imperceptible — and it keeps a window
  // left open for an hour from drifting into float noise.
  const t = ((raw % period) + period) % period;
  return k === "protest" ? protestFrame(t, period) : blockadeFrame(t, period);
}

/** ✊ A picket line: signs, a barrel fire, and a lorry holding its horn down. */
function protestFrame(t: number, P: number): SabotageOp[] {
  const ops: SabotageOp[] = [];

  // The barrel fire: a glow that flickers six times a loop, three flames
  // licking out of it (each at its own point in the burn), and puffs of smoke
  // that climb out, spread, fade, and start again.
  const flicker = 0.5 + 0.5 * wave(t, P, 0, 6);
  ops.push({
    kind: "glow", x: 0.52, y: 0.80, r: 0.10 + 0.02 * flicker,
    colour: "#ff9a3c", alpha: 0.10 + 0.12 * flicker,
  });
  for (let i = 0; i < 3; i++) {
    const p = rise(t, P, i * 5, 2);
    ops.push({
      kind: "dot",
      x: 0.52 + 0.012 * (i - 1) + 0.006 * wave(t, P, i, 3),
      y: 0.80 - 0.035 * p,
      r: 0.008 + 0.007 * (1 - p),
      colour: "#ffb347",
      alpha: 0.30 + 0.45 * (1 - p),
    });
  }
  for (let i = 0; i < 5; i++) {
    const p = rise(t, P, i, 1);
    ops.push({
      kind: "puff",
      x: 0.52 + 0.07 * wave(t, P, i + 40, 1) * p,
      y: 0.78 - 0.42 * p,
      r: 0.028 + 0.075 * p,
      alpha: 0.30 * Math.min(1, 4 * p) * (1 - p),
    });
  }

  // The lorry at the kerb: a box body, a cab with its lights on, two wheels —
  // and three honks a loop (the dot of the 3-cycle wave), each of which jolts
  // the whole lorry forward 2px and throws a ring of sound off the cab.
  const honk = Math.max(0, wave(t, P, 0, 3));
  const jolt = 0.004 * honk;
  const lx = 0.15 + jolt;
  ops.push({ kind: "sign", x: lx, y: 0.85, w: 0.26, h: 0.13, tilt: -0.02 * honk, colour: "#3f6d4f" });   // box body
  ops.push({ kind: "sign", x: lx + 0.165, y: 0.855, w: 0.09, h: 0.10, tilt: -0.02 * honk, colour: "#4f7f5c" }); // cab
  ops.push({ kind: "sign", x: lx + 0.175, y: 0.825, w: 0.05, h: 0.035, tilt: 0, colour: "#9fd6e0", alpha: 0.85 }); // windscreen
  ops.push({ kind: "dot", x: lx + 0.20, y: 0.855, r: 0.010, colour: "#ffe9a8", alpha: 0.9 });           // headlight
  ops.push({ kind: "dot", x: lx + 0.025, y: 0.915, r: 0.017, colour: "#241f19", alpha: 1 });            // wheel
  ops.push({ kind: "dot", x: lx + 0.125, y: 0.915, r: 0.017, colour: "#241f19", alpha: 1 });            // wheel
  for (let i = 0; i < 3; i++) {
    ops.push({
      kind: "dot",
      x: lx + 0.24 + 0.045 * i,
      y: 0.79 - 0.035 * i,
      r: 0.010 + 0.018 * i * honk,
      colour: "#ffd75a",
      alpha: 0.5 * honk,
    });
  }

  // The picket line: six of them, bobbing three times a loop out of step, and
  // five carrying a sign (the one without is the one clapping).
  const CROWD = 6;
  for (let i = 0; i < CROWD; i++) {
    const x = 0.30 + 0.64 * (i / (CROWD - 1)) + 0.008 * wave(t, P, i, 1);
    const scale = 0.17 + 0.015 * (i % 3);
    const bob = wave(t, P, i * 7, 3);
    const stride = wave(t, P, i * 5, 2);
    const colour = PICKET_COLOURS[i % PICKET_COLOURS.length];
    if (i % 3 !== 1) {
      ops.push({
        kind: "sign", x, y: 0.90 - scale - 0.05, w: 0.17, h: 0.12,
        tilt: 0.20 * wave(t, P, i * 3, 2), colour: SIGN_COLOURS[i % SIGN_COLOURS.length], post: true,
      });
    }
    ops.push({ kind: "figure", x, y: 0.90, scale, bob, stride, colour });
  }

  return ops;
}

/** ⛓ Three bandits on the gate crate with a card game and a swinging lamp. */
function blockadeFrame(t: number, P: number): SabotageOp[] {
  const ops: SabotageOp[] = [];

  // The plank across the gate, turning slowly on its ropes.
  ops.push({
    kind: "sign", x: 0.50, y: 0.30, w: 1.05, h: 0.09,
    tilt: 0.012 * wave(t, P, 0, 1), colour: "#6b4a2e",
  });
  ops.push({ kind: "sign", x: 0.12, y: 0.40, w: 0.06, h: 0.36, tilt: 0, colour: "#4d3a26" });
  ops.push({ kind: "sign", x: 0.88, y: 0.40, w: 0.06, h: 0.36, tilt: 0, colour: "#4d3a26" });

  // The lamp on its hook: the rope swings, the flame flickers, the pool of
  // light on the crate breathes with it.
  const swing = wave(t, P, 0, 1);
  const flicker = 0.5 + 0.5 * wave(t, P, 3, 5);
  const lampX = 0.80 + 0.06 * swing;
  ops.push({ kind: "sign", x: (0.80 + lampX) / 2, y: 0.16, w: 0.012, h: 0.14, tilt: 0.5 * swing, colour: "#3a2f22" });
  ops.push({
    kind: "glow", x: lampX, y: 0.30, r: 0.14 + 0.02 * flicker,
    colour: "#ffd06a", alpha: 0.12 + 0.10 * flicker,
  });
  ops.push({ kind: "dot", x: lampX, y: 0.28, r: 0.020, colour: "#ffe6ad", alpha: 0.6 + 0.4 * flicker });
  ops.push({ kind: "glow", x: 0.50, y: 0.72, r: 0.30, colour: "#ffb347", alpha: 0.05 + 0.04 * flicker });

  // Cigar smoke curling up off the middle bandit.
  for (let i = 0; i < 4; i++) {
    const p = rise(t, P, i, 1);
    ops.push({
      kind: "puff",
      x: 0.50 + 0.08 * wave(t, P, i + 20, 1) * p,
      y: 0.62 - 0.36 * p,
      r: 0.02 + 0.05 * p,
      alpha: 0.26 * Math.min(1, 3 * p) * (1 - p),
    });
  }

  // Three of them sat behind the crate, breathing (and one of them leaning).
  for (let i = 0; i < 3; i++) {
    ops.push({
      kind: "figure",
      x: 0.33 + 0.175 * i + 0.015 * wave(t, P, i * 5, 1),
      y: 0.79,
      scale: 0.17,
      bob: 0.4 * wave(t, P, i * 11, 2),
      stride: 0,
      colour: BANDIT_COLOURS[i % BANDIT_COLOURS.length],
      sit: true,
    });
  }
  // …the crate is in FRONT of them, which is what makes them look sat down.
  ops.push({ kind: "sign", x: 0.50, y: 0.78, w: 0.80, h: 0.11, tilt: 0.01 * wave(t, P, 2, 1), colour: "#6b4a2e" });

  // The game: five cards arcing across the crate, dealt over and over. A card
  // fades in as it leaves the hand and out as it lands, so the loop's seam is
  // invisible at alpha 0.
  for (let i = 0; i < 5; i++) {
    const p = rise(t, P, i * 3, 1);
    ops.push({
      kind: "sign",
      x: 0.34 + 0.32 * p,
      y: 0.66 - 0.20 * Math.sin(Math.PI * p),
      w: 0.055, h: 0.08,
      tilt: 0.9 * (p - 0.5) + 0.12 * wave(t, P, i, 2),
      colour: CARD_COLOUR,
      alpha: Math.min(1, 5 * p) * Math.min(1, 5 * (1 - p)),
    });
  }

  return ops;
}

// ── the painter ───────────────────────────────────────────────────────────
/**
 * Paints one frame of the overlay onto a `w`×`h` (backing-pixel) canvas. The
 * ops are resolution-independent, so no transform is needed and a dpr-2
 * canvas is drawn the same way as a dpr-1 one.
 */
export function drawSabotageOverlay(
  ctx: CanvasRenderingContext2D, ops: readonly SabotageOp[], w: number, h: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const u = h;                       // every size in an op is a fraction of the height
  for (const op of ops) {
    switch (op.kind) {
      case "glow": {
        // Three discs instead of a gradient object: one fewer allocation per
        // frame, and at these alphas it reads the same.
        ctx.fillStyle = tint(op.colour, op.alpha / 3);
        for (const k of [1, 0.66, 0.33]) {
          ctx.beginPath();
          ctx.arc(op.x * w, op.y * h, op.r * u * k, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case "puff": {
        ctx.fillStyle = tint(SMOKE, op.alpha);
        ctx.beginPath();
        ctx.arc(op.x * w, op.y * h, op.r * u, 0, TAU);
        ctx.fill();
        break;
      }
      case "figure": {
        const H = op.scale * u;                       // the figure's height
        const cx = op.x * w;
        const feet = op.y * h + op.bob * H * 0.04;    // a bob is 8% of a person
        const headR = H * 0.16;
        const headY = feet - H + headR;
        ctx.fillStyle = op.colour;
        ctx.beginPath();
        ctx.arc(cx, headY, headR, 0, TAU);
        ctx.fill();
        ctx.fillRect(cx - H * 0.15, headY + headR * 0.6, H * 0.30, H * 0.44);   // torso
        if (op.sit) {
          ctx.fillRect(cx - H * 0.10, feet - H * 0.20, H * 0.36, H * 0.14);     // folded legs
        } else {
          const kick = op.stride * H * 0.09;
          ctx.fillRect(cx - H * 0.13 + kick, feet - H * 0.36, H * 0.10, H * 0.36);
          ctx.fillRect(cx + H * 0.03 - kick, feet - H * 0.36, H * 0.10, H * 0.36);
        }
        break;
      }
      case "sign": {
        const bw = op.w * u, bh = op.h * u;
        ctx.save();
        ctx.translate(op.x * w, op.y * h);
        ctx.rotate(op.tilt);
        ctx.fillStyle = tint(op.colour, op.alpha ?? 1);
        if (op.post) ctx.fillRect(-u * 0.006, bh * 0.5, u * 0.012, u * 0.13);   // down to the hand
        ctx.fillRect(-bw * 0.5, -bh * 0.5, bw, bh);
        ctx.restore();
        break;
      }
      case "dot": {
        ctx.fillStyle = tint(op.colour, op.alpha);
        ctx.beginPath();
        ctx.arc(op.x * w, op.y * h, op.r * u, 0, TAU);
        ctx.fill();
        break;
      }
    }
  }
}

// ── the controller ────────────────────────────────────────────────────────
/**
 * The hole a hidden (or never-opened) slot falls back to, CSS px: `clientWidth`
 * is 0 in jsdom and on a slot that has not been laid out yet, and a canvas
 * needs a non-zero backing store.
 */
export const SABOTAGE_SLOT_FALLBACK_W = 176;

export interface SabotageOverlay {
  /** The overlay canvas, or null until a window has been opened with motion allowed. */
  readonly canvas: HTMLCanvasElement | null;
  /** True while frames are actually painted: open AND motion allowed. */
  readonly running: boolean;
  /**
   * Frames painted since the overlay was made — the debug answer to "is it
   * actually animating?", readable as `__iso.sabotageEventWindow.frames`.
   */
  readonly frames: number;
  readonly kind: string;
  /** The sabotage on show changed (`open()` calls it before `start()`). */
  setKind(kind: string): void;
  /** The event window opened (or switched to another sabotage). */
  start(): void;
  /** The event window closed: the canvas is blanked and the next tick is free. */
  stop(): void;
  /** One frame, on the GAME's clock (the frame timestamp `update(t)` gets). */
  tick(now: number): void;
  destroy(): void;
}

export interface SabotageOverlayOptions {
  /** The image slot the canvas is stacked on (`position: relative` in styles.css). */
  host: HTMLElement;
}

/**
 * The animation layer over a sabotage illustration. It paints only while a
 * window is open and the OS has not asked for reduced motion — everywhere else
 * `tick` returns immediately, which is also what makes it invisible to a
 * headless test harness and free when the dock is empty.
 */
export function createSabotageOverlay(opts: SabotageOverlayOptions): SabotageOverlay {
  const host = opts.host;
  const view = (host.ownerDocument?.defaultView ?? null) as (Window & typeof globalThis) | null;

  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  /** A slot whose 2d context could not be had: never try again (jsdom, an old embed). */
  let noContext = false;
  let kind = "protest";
  let wanted = false;                 // the window is open
  let frames = 0;                     // ticks painted, for the debug surface below
  let t0: number | null = null;
  let destroyed = false;

  // ── reduced motion, read live (the setting can change mid-event) ────────
  let motionQuery: MediaQueryList | null = null;
  if (typeof view?.matchMedia === "function") {
    try { motionQuery = view.matchMedia("(prefers-reduced-motion: reduce)"); } catch { motionQuery = null; }
  }
  /** No `matchMedia` (a test, an odd embed) → motion stays on, like game.ts. */
  const motionAllowed = () => !motionQuery?.matches;

  const measure = () => {
    if (!canvas) return;
    const dpr = Math.min(3, Math.max(1, view?.devicePixelRatio ?? 1));
    const cssW = host.clientWidth || SABOTAGE_SLOT_FALLBACK_W;
    const cssH = host.clientHeight || Math.round((cssW * 9) / 16);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    canvas.style.removeProperty("display");   // a slot that just became visible again
  };

  /** Makes the canvas on first use. False when there is nothing to paint on. */
  const ensureCanvas = (): boolean => {
    if (destroyed || noContext) return false;
    if (ctx && canvas) return true;
    canvas = host.ownerDocument.createElement("canvas");
    canvas.className = "sabotage-anim-overlay";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);
    let got: CanvasRenderingContext2D | null = null;
    try {
      got = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    } catch {
      got = null;
    }
    if (!got) {
      // jsdom without node-canvas, and any embed that refuses a context: the
      // still illustration is the whole window, and we do not keep retrying.
      noContext = true;
      canvas.remove();
      canvas = null;
      return false;
    }
    ctx = got;
    measure();
    return true;
  };

  /** Pause: blank the canvas so the still image shows through, keep our intent. */
  const rest = () => {
    t0 = null;
    if (ctx && canvas) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const onMotionChange = () => {
    if (destroyed) return;
    if (!motionAllowed()) { rest(); return; }
    if (wanted) ensureCanvas();
  };
  const listen = (add: boolean) => {
    if (!motionQuery) return;
    if (add) {
      if (typeof motionQuery.addEventListener === "function") motionQuery.addEventListener("change", onMotionChange);
      else motionQuery.addListener?.(onMotionChange);
    } else {
      if (typeof motionQuery.removeEventListener === "function") motionQuery.removeEventListener("change", onMotionChange);
      else motionQuery.removeListener?.(onMotionChange);
    }
  };
  listen(true);

  // A phone that rotates (or a window dragged to another screen) while an event
  // window is open: keep the backing store the size of the slot. Optional —
  // jsdom and older embeds have no ResizeObserver, and a wrong size only ever
  // costs a stretched overlay.
  let ro: ResizeObserver | null = null;

  const start = () => {
    wanted = true;
    t0 = null;
    if (destroyed || !motionAllowed()) return;
    if (ensureCanvas() && canvas && !ro && typeof globalThis.ResizeObserver === "function") {
      ro = new globalThis.ResizeObserver(() => { if (canvas) measure(); });
      ro.observe(host);
    }
  };

  const stop = () => {
    wanted = false;
    rest();
  };

  const tick = (now: number) => {
    if (destroyed || !wanted || !canvas || !ctx || !motionAllowed()) return;
    if (t0 === null) t0 = now;
    drawSabotageOverlay(ctx, sabotageOverlayFrame(kind, now - t0), canvas.width, canvas.height);
    frames++;
  };

  return {
    get canvas() { return canvas; },
    get running() { return !destroyed && wanted && motionAllowed() && ctx !== null; },
    get frames() { return frames; },
    get kind() { return kind; },
    setKind(next: string) {
      kind = next;
      t0 = null;                     // a new sabotage starts its loop at frame 0
    },
    start,
    stop,
    tick,
    destroy() {
      destroyed = true;
      wanted = false;
      listen(false);
      ro?.disconnect();
      ro = null;
      if (canvas) { canvas.remove(); canvas = null; }
      ctx = null;
    },
  };
}
