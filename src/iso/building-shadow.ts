// ══════════════════════════════════════════════════════════════════════════
// Building shadows — a soft cast shadow under every free-placed building.
//
// Drawn by the renderer, NOT baked into the art, and that is a deliberate
// choice: `assets/buildings/` compiles to tight-trimmed PNGs whose alpha is
// also the PICK mask (`maskFromRGBA`, threshold 8). A shadow composited into
// those pixels sits far above that threshold, so it would grow every
// building's clickable silhouette out to the upper right — clicking empty
// grass behind a depot would select the depot, and every placement check
// that goes through `pickSprite` would inherit the error. A ground pass has
// no such coupling, costs one fill per visible building, and needs no art
// rebuild.
//
// THE SHAPE IS THE FOOTPRINT DIAMOND, not an ellipse. Buildings carry their
// OWN opaque ground plate — the farm's field, the sawmill's yard — covering
// the footprint, so the only part of any shadow that is ever seen is the part
// that clears that plate. An ellipse was the first attempt and it was the
// wrong shape twice over: inscribed, it never reached the grass at all;
// circumscribed, it bulged past all four diamond edges at once and read as a
// symmetric halo of ambient occlusion rather than a shadow thrown one way. A
// diamond offset up-screen matches the plate's own silhouette, so it hides
// under the art everywhere except along the top-right edges, which is
// precisely where a cast shadow belongs.
//
// Buildings overhang their footprints by different amounts and at different
// heights, and there is no cheap silhouette to project, so the footprint is
// the honest source for the shape.
// ══════════════════════════════════════════════════════════════════════════
import { HW, HH, TILE_H, tileToScreen } from "../game/config";
import type { SpriteDef } from "./atlas";
import type { Placed } from "./depth";

/**
 * Offset of the shadow from the footprint, in world pixels: positive x is
 * right, negative y is UP the screen.
 *
 * Cast to the UPPER RIGHT, matching the trees. As noted there, this is an art
 * direction and not a physical one — with the sun in the upper left the cast
 * would fall to the lower right — but on an isometric ground plane a shadow
 * thrown up-screen lies BEHIND the thing casting it, which seats it on the
 * ground instead of pooling in front and hiding its own frontage.
 *
 * Absolute, not a fraction of the building: the sun is the same distance away
 * from a house as from a 4×4 industry, and a proportional offset threw the
 * industry's shadow four times as far.
 *
 * Resolved against the diamond's top-right edge, whose outward normal is
 * (HW, -HH) normalised: this pair clears that edge by ~12 world px and
 * RECEDES behind the top-left one, so the shadow appears on one side only.
 */
export const SHADOW_DX = 10;
export const SHADOW_DY = -6;
/**
 * Uniform outward growth of the diamond, in world pixels, before the offset.
 *
 * A hint of contact darkening on the two front edges as well, so the building
 * is seated rather than appearing to hover with a shadow stuck behind it.
 */
export const SHADOW_GROW = 2;
/**
 * Feather radius in world pixels, applied with the 2D context's own blur.
 *
 * A hard-edged diamond of ink reads as a second ground plate. The blur is in
 * canvas pixels, so it is scaled by the zoom at paint time.
 */
export const SHADOW_BLUR = 3.5;
/**
 * Peak opacity.
 *
 * Below the trees' 0.55. Buildings come in blocks — a town is houses on
 * adjacent tiles — and these shapes are painted independently, so neighbours'
 * shadows stack; at 0.55 a row of houses pooled into one dark slab.
 */
export const SHADOW_ALPHA = 0.44;
/** A cool near-black; pure black over the warm meadow reads as a hole. */
const SHADOW_INK = "rgb(20,26,16)";

/**
 * Half-extents of the shadow diamond in world pixels: the footprint's own
 * diamond, grown. A w×h footprint spans (w+h) tiles corner to corner on both
 * screen axes.
 */
export function shadowRadii(fw: number, fh: number): [number, number] {
  return [(fw + fh) * HW / 2 + SHADOW_GROW, (fw + fh) * HH / 2 + SHADOW_GROW / 2];
}

type Ctx2D = CanvasRenderingContext2D;
type Surface = HTMLCanvasElement | OffscreenCanvas;
interface Cam { x: number; y: number; zoom: number }

/** A pre-blurred shadow stamp, and where its top-left sits from the centre. */
interface Stamp {
  surface: Surface;
  /** World-space offset of the stamp's top-left from the shadow's centre. */
  ox: number;
  oy: number;
  w: number;
  h: number;
}

/**
 * Pre-rendered shadow stamps, keyed by footprint and zoom.
 *
 * The feather is one `ctx.filter = blur(...)` — and that is why it is baked
 * into a stamp instead of applied per building. Blurring at draw time made
 * the wide 0.5× map sweep in `tools/capture-scenery-review.mjs` time out at
 * 30 s: a canvas filter is a surface operation, so N buildings cost N full
 * filter passes, and the structures layer re-rasters on every pan. Footprints
 * come in a handful of sizes, so the whole set is a handful of small canvases
 * and each building becomes one `drawImage`.
 */
export class ShadowStamps {
  private readonly stamps = new Map<string, Stamp | null>();

  /** Number of cached stamps — for the renderer's diagnostics. */
  get size(): number { return this.stamps.size; }

  clear(): void { this.stamps.clear(); }

  stamp(
    fw: number, fh: number, zoom: number,
    makeSurface: (w: number, h: number) => Surface | null,
  ): Stamp | null {
    const key = `${fw}x${fh}@${zoom}`;
    const hit = this.stamps.get(key);
    if (hit !== undefined) return hit;

    const [rx, ry] = shadowRadii(fw, fh);
    // Room for the blur to run out to nothing on every side.
    const m = SHADOW_BLUR * 3;
    const w = Math.ceil((rx + m) * 2 * zoom), h = Math.ceil((ry + m) * 2 * zoom);
    const surface = makeSurface(w, h);
    const ctx = surface
      ? (surface as HTMLCanvasElement).getContext("2d") as Ctx2D | null
      : null;
    if (!surface || !ctx) { this.stamps.set(key, null); return null; }

    const cx = (rx + m) * zoom, cy = (ry + m) * zoom;
    // Canvas filters are not universally implemented (jsdom, older surfaces);
    // without one the diamond is simply crisp, which is a lesser look and not
    // a broken one.
    if ("filter" in ctx) ctx.filter = `blur(${(SHADOW_BLUR * zoom).toFixed(2)}px)`;
    ctx.fillStyle = SHADOW_INK;
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry * zoom);
    ctx.lineTo(cx + rx * zoom, cy);
    ctx.lineTo(cx, cy + ry * zoom);
    ctx.lineTo(cx - rx * zoom, cy);
    ctx.closePath();
    ctx.fill();
    if ("filter" in ctx) ctx.filter = "none";

    const out: Stamp = { surface, ox: -(rx + m), oy: -(ry + m), w, h };
    this.stamps.set(key, out);
    return out;
  }
}

/**
 * World-space centre of a building's shadow: the footprint's CENTRE — the
 * same point `drawOrigin` places a `def.center` sprite on, so the shadow is
 * concentric with the art rather than with the grid — thrown up and right.
 */
export function shadowCentre(def: SpriteDef, tx: number, ty: number): [number, number] {
  const [fw, fh] = def.footprint;
  const [sx, sy] = tileToScreen(tx + fw - 1, ty + fh - 1);
  return [
    sx - (fw - fh) * (HW / 2) + SHADOW_DX,
    sy + TILE_H - (fw + fh) * (HH / 2) + SHADOW_DY,
  ];
}

/** True for the sprites that get a cast shadow: free-placed building art. */
export const castsShadow = (p: Placed): boolean =>
  !!p.def.center && !p.decor && p.fx === undefined;

/**
 * Paint the shadows for a draw order. Call ONCE, after the roads and before
 * any sprite: every shadow belongs to the ground, so none of them may land
 * on top of a building, a tree or a lorry.
 *
 * Returns the number painted (the renderer's trace reads it).
 */
export function paintBuildingShadows(
  ctx: Ctx2D, cam: Cam, order: Placed[], stamps: ShadowStamps,
  makeSurface: (w: number, h: number) => Surface | null,
): number {
  const z = cam.zoom;
  let n = 0;
  let saved = false;
  for (const p of order) {
    if (!castsShadow(p)) continue;
    const [fw, fh] = p.def.footprint;
    const st = stamps.stamp(fw, fh, z, makeSurface);
    if (!st) continue;
    if (!saved) {
      ctx.save();
      ctx.globalAlpha = SHADOW_ALPHA;
      saved = true;
    }
    const [wx, wy] = shadowCentre(p.def, p.tx, p.ty);
    ctx.drawImage(
      st.surface as unknown as CanvasImageSource,
      Math.round((wx + st.ox) * z + cam.x), Math.round((wy + st.oy) * z + cam.y),
    );
    n++;
  }
  if (saved) ctx.restore();
  return n;
}
