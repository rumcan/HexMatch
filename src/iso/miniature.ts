// ══════════════════════════════════════════════════════════════════════════
// GFX-01 — the MINIATURE (tilt-shift) post pass.
//
// "Make it look small" is an old photography trick: a tilt-shift lens keeps
// one horizontal slice of the frame sharp and throws the rest out of focus.
// The brain reads a shallow depth of field as "this scene is tiny" — the
// whole island becomes a model railway in a shoebox. The effect is finished
// off the way model-kit photos are finished: saturated, gently contrasted,
// with the corners falling into a soft lamp vignette.
//
// Implementation, because the game is a STACK of three canvases (terrain /
// structures / overlay) that the compositor glues in CSS: a per-layer blur
// would blur each layer against transparent black and break that stacking.
// So when miniature is ON, this pass re-glues the stack ITSELF every frame —
//   1. composite the three layers into a full-size sharp buffer;
//   2. downscale it to a half-size buffer and blur it there (canvas
//      `ctx.filter`, one GPU trip at quarter the pixels — the blur's own
//      softness hides the low resolution);
//   3. paint the blurred half-size buffer back over the display canvas;
//   4. paint the sharp buffer through a vertical gradient alpha mask, so the
//      focus band keeps crisp pixels and the blur fades in over its edges;
//   5. grade (saturate/contrast) + vignette on the display canvas.
// The display canvas sits above the three layers (z-index 4) with
// `pointer-events: none`, so input still lands on the overlay canvas exactly
// as before — this only replaces what the eye sees, never what the picker
// sees. With the pass OFF the canvas is `display: none` and the frame costs
// nothing, which is why the default stays off: it is a look, not a feature.
//
// Where `ctx.filter` does not exist (old engines, the node test harness), the
// pass degrades to a UNIFORM CSS blur on the whole display canvas — no band,
// no per-band sharpness, still a miniature, never a crash.
// ══════════════════════════════════════════════════════════════════════════
import type { RendererCanvases } from "./renderer";

/** Blur radius in DEVICE pixels for a viewport `h` tall (dpr included). */
export const blurRadiusFor = (h: number): number =>
  Math.max(2, Math.min(6.5, h * 0.0042));

/**
 * The focus band of the tilt-shift, normalised to the canvas height:
 * `blurTop` is where the blur ends and full sharpness starts, `blurBottom`
 * the mirror image, each flanked by its feather (`topFeather` … `blurTop`).
 * `band` is the sharp share of the frame; `feather` the gradient run on each
 * side. The band is lifted a touch above dead centre — the eye reads a
 * diorama best when the sharp slice sits on the horizon third, not on the
 * mathematical middle.
 */
export interface BandStops {
  /** alpha 0 (fully blurred) at the very top */
  top0: number;
  /** alpha 1 (fully sharp) at the band's upper edge */
  top1: number;
  /** alpha 1 at the band's lower edge */
  bot0: number;
  /** alpha 0 (fully blurred) at the very bottom */
  bot1: number;
}

export const bandStops = (
  band = 0.30, feather = 0.20, centreBias = 0.04,
): BandStops => {
  const c = 0.5 - centreBias;
  const half = band / 2;
  return {
    top0: Math.max(0, c - half - feather),
    top1: Math.max(0, c - half),
    bot0: Math.min(1, c + half),
    bot1: Math.min(1, c + half + feather),
  };
};

/** The whole look applied by the pass — exported so tests pin the defaults. */
export const MINIATURE_GRADE = "saturate(1.32) contrast(1.07) brightness(1.03)";
export const MINIATURE_VIGNETTE = 0.22;

/** Offscreen raster surface, mirroring the renderer's own helper. */
type Surface = HTMLCanvasElement | OffscreenCanvas;
function makeSurface(w: number, h: number): Surface | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document === "undefined") return null;
  return Object.assign(document.createElement("canvas"), { width: w, height: h });
}
const ctxOf = (s: Surface): CanvasRenderingContext2D =>
  (s as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D;

export interface MiniaturePass {
  readonly enabled: boolean;
  /** Show/hide the composite layer. Safe to call every frame. */
  setEnabled(on: boolean): void;
  /** Keep the display canvas in lockstep with the three game layers. */
  resize(w: number, h: number): void;
  /** One composite. No-op while disabled or before the first resize. */
  paint(): void;
  destroy(): void;
}

/**
 * Create the pass. `host` is the map stage the three layers already live in;
 * the display canvas is inserted as its FIRST child (z-index does the
 * stacking) so `.iso-layer:last-child` in the stylesheet keeps naming the
 * overlay canvas and the crosshair cursor does not move.
 */
export function createTiltShiftPass(canvases: RendererCanvases, host: HTMLElement): MiniaturePass {
  const display = document.createElement("canvas");
  display.className = "iso-layer iso-mini";
  display.style.zIndex = "4";
  display.style.pointerEvents = "none";   // input goes to the overlay beneath
  display.style.display = "none";
  display.setAttribute("aria-hidden", "true");
  host.insertBefore(display, host.firstChild);

  const dctx = ctxOf(display);
  // The whole look rides on canvas `filter`; engines without it fall back to
  // a uniform CSS blur — softer, less clever, still tiny.
  // Annotated `boolean` deliberately: a bare `in` check would let TS narrow
  // `dctx` itself (to `never`) through the aliased condition.
  const filterSupported: boolean = "filter" in dctx;

  let enabled = false;
  let w = 0, h = 0;
  /** The three scratch buffers, sized by the last successful `layout()`. */
  let buf: {
    sharp: Surface; sctx: CanvasRenderingContext2D;
    small: Surface; smctx: CanvasRenderingContext2D;
    band: Surface; bctx: CanvasRenderingContext2D;
  } | null = null;
  let bufW = -1, bufH = -1;

  /** (Re)build the scratch buffers for `w`×`h`. Null when the host has no
   *  surface API at all (the node harness, a stubbed test double). */
  const layout = (): typeof buf => {
    if (buf && bufW === w && bufH === h) return buf;
    const sharp = makeSurface(w, h);
    const band = makeSurface(w, h);
    const small = makeSurface(Math.max(1, Math.ceil(w / 2)), Math.max(1, Math.ceil(h / 2)));
    buf = null;
    bufW = -1; bufH = -1;
    if (!sharp || !band || !small) return null;
    const b = {
      sharp, sctx: ctxOf(sharp),
      small, smctx: ctxOf(small),
      band, bctx: ctxOf(band),
    };
    buf = b; bufW = w; bufH = h;
    return b;
  };

  const paintLayers = (ctx: CanvasRenderingContext2D, dw = w, dh = h) => {
    ctx.drawImage(canvases.terrain as unknown as CanvasImageSource, 0, 0, dw, dh);
    ctx.drawImage(canvases.structures as unknown as CanvasImageSource, 0, 0, dw, dh);
    ctx.drawImage(canvases.overlay as unknown as CanvasImageSource, 0, 0, dw, dh);
  };

  return {
    get enabled() { return enabled; },
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      display.style.display = on ? "" : "none";
      display.style.filter = "";
      if (on) {
        // The stage may have resized since the pass last ran.
        w = Math.max(1, Math.floor(canvases.terrain.width));
        h = Math.max(1, Math.floor(canvases.terrain.height));
      }
    },
    resize(nw, nh) {
      w = Math.max(1, Math.floor(nw));
      h = Math.max(1, Math.floor(nh));
      display.width = w;
      display.height = h;
      if (enabled && !filterSupported) display.style.filter = `blur(${blurRadiusFor(h).toFixed(2)}px)`;
    },
    paint() {
      if (!enabled || w < 2 || h < 2) return;
      if (!filterSupported) {
        // Uniform-blur fallback: the display canvas IS the sharp stack, and
        // the CSS blur lives on the element (`resize` set it).
        dctx.clearRect(0, 0, w, h);
        paintLayers(dctx);
        return;
      }
      const b = layout();
      if (!b) return;                       // no surface API at all (tests)
      const { sharp, sctx, small, smctx, band, bctx } = b;
      // 1. the full-resolution sharp composite of the stack.
      sctx.filter = "none";
      sctx.globalCompositeOperation = "source-over";
      sctx.clearRect(0, 0, w, h);
      paintLayers(sctx);
      // 2. the soft layer: quarter the pixels, one blurred draw. The blur
      //    radius is halved with the buffer, so the visible softness matches.
      const r = blurRadiusFor(h);
      smctx.filter = `blur(${(r / 2).toFixed(2)}px) ${MINIATURE_GRADE}`;
      smctx.clearRect(0, 0, small.width, small.height);
      smctx.drawImage(sharp as unknown as CanvasImageSource, 0, 0, small.width, small.height);
      smctx.filter = "none";
      // 3. soft base first — smoothing on, so the upscale stays creamy.
      dctx.imageSmoothingEnabled = true;
      dctx.globalCompositeOperation = "source-over";
      dctx.clearRect(0, 0, w, h);
      dctx.drawImage(small as unknown as CanvasImageSource, 0, 0, w, h);
      // 4. the sharp band: the graded full-resolution copy, masked to a
      //    feathered horizontal slice. Sampled from the sharp buffer (one
      //    draw) — the layers are already composited there.
      bctx.filter = MINIATURE_GRADE;
      bctx.globalCompositeOperation = "source-over";
      bctx.clearRect(0, 0, w, h);
      bctx.drawImage(sharp as unknown as CanvasImageSource, 0, 0);
      bctx.filter = "none";
      bctx.globalCompositeOperation = "destination-in";
      const grad = bctx.createLinearGradient(0, 0, 0, h);
      const bs = bandStops();
      for (const [o, a] of [[bs.top0, 0], [bs.top1, 1], [bs.bot0, 1], [bs.bot1, 0]] as const) {
        // A non-monotonic stop list throws; clamp the sequence into order.
        const at = Math.max(0, Math.min(1, o));
        grad.addColorStop(at, `rgba(0,0,0,${a})`);
      }
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, w, h);
      bctx.globalCompositeOperation = "source-over";
      dctx.drawImage(band as unknown as CanvasImageSource, 0, 0);
      // 5. the lamp vignette over everything — the frame edges darken, the
      //    way a single bulb over a model table does.
      const vg = dctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.42,
        w / 2, h * 0.46, Math.max(w, h) * 0.78);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, `rgba(6,4,2,${MINIATURE_VIGNETTE})`);
      dctx.fillStyle = vg;
      dctx.fillRect(0, 0, w, h);
    },
    destroy() {
      display.remove();
      buf = null; bufW = -1; bufH = -1;
    },
  };
}
