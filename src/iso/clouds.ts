// ══════════════════════════════════════════════════════════════════════════
// AMB-1 (#390) — soft painterly clouds that drift over the map when zoomed out.
//
// Two layers, both cosmetic (nothing simulated, nothing on the wire):
//   · the CLOUDS ride the overlay canvas, above the structures but below the
//     placement previews, the debug marks and the protest crowds — building
//     feedback always stays crisp while the sky drifts behind it;
//   · the SHADOWS ride the terrain canvas, right after the ground (and after
//     the clear when the WebGL2 ground owns the pixels), as a faint dark veil
//     offset for the upper-left sun. They are plain low-alpha blobs, NOT a
//     multiply pass: the GL ground lives on a separate canvas underneath, so
//     there is nothing inside the 2D terrain canvas for multiply to darken.
//
// Everything positional is a pure function of (map seed, timeMs): one slow
// deterministic wind per map, clouds wrap around the map bounds. The rAF
// clock behind `timeMs` is per-client — like the ocean drift, host and guest
// see the same sky pattern but not the same phase, and nobody can tell.
//
// Fade is driven by `cam.zoom` (ZOOM_STEPS 0.5/1/2): full at 0.5, ~40% at 1,
// gone at 2 — so the closest zoom pays zero cloud cost and the clouds never
// get in the way of building. The game additionally gates them on the
// "Clouds" setting (graphics.ts, default on), forces them off in performance
// mode (the render policy), and freezes them when the OS asks to reduce
// motion (the renderer pins `timeMs` to 0, the same freeze overlay-art uses).
//
// Art: the lead generates 4–6 cloud sprites + matching shadow masks with
// rundot — until then `makeCloudSprites()` paints soft procedural blobs
// (radial-gradient puffs baked once into offscreen canvases). To install the
// real art, build a `CloudSprites` (clouds + same-shape dark masks) and hand
// it to `renderer.setCloudSprites()` — same contract, no other change.
// ══════════════════════════════════════════════════════════════════════════
import { TILE_W, mulberry32 } from "../game/config";
import { mapWorldBounds, type Camera } from "./camera";

/** How many clouds share the sky — the ticket caps on-screen sprites at ~8. */
// Owner: at least 8 clouds on screen at the normal zoom. The field is ~60x
// the screen, so the sky holds a few hundred small clouds; only the ones on
// screen are drawn.
export const CLOUD_COUNT = 240;
/** Procedural placeholder variants (the lead's rundot set is 4–6 too). */
export const CLOUD_VARIANTS = 4;
/** The veil's alpha at the furthest zoom (the ticket wants about 0.25–0.45). */
export const CLOUD_ALPHA_MAX = 0.36;
/** The ground shadows stay a whisper — barely-there darkening. */
export const CLOUD_SHADOW_ALPHA = 0.16;
/** Wind speed in world pixels per second: slow drift, ~10 min to cross. */
export const CLOUD_WIND_MIN = 2;
export const CLOUD_WIND_MAX = 4;
/** One cloud covers 10–18 tiles across — a veil, not confetti. */
export const CLOUD_W_MIN_TILES = 4;
export const CLOUD_W_MAX_TILES = 8;
/** The placeholder sprite raster (16:9, soft blobs on transparency). */
export const CLOUD_SPRITE_W = 256;
export const CLOUD_SPRITE_H = 144;
/** How far past the map diamond a cloud may drift before it wraps (world px). */
export const CLOUD_WRAP_MARGIN = 640;
/**
 * Sun sits upper-left, so a shadow falls lower-right of its cloud (world px —
 * a straight screen offset once projected). Small on purpose: a large offset
 * reads as a second cloud, not as shade.
 */
/** Owner: the clouds sit ABOVE the map - they slide faster than the ground
 *  when the camera pans (parallax). Shadows stay pinned to the ground. */
export const CLOUD_PARALLAX = 1.6;
export const CLOUD_SHADOW_DX = 96;
export const CLOUD_SHADOW_DY = 48;

/** One cloud's seed-derived facts: its base position, size and sprite. */
export interface CloudDef {
  /** Base world position (wind + time move it from here). */
  bx: number;
  by: number;
  /** Width in world px; height follows the sprite's aspect. */
  w: number;
  /** Index into the sprite set. */
  variant: number;
}

/**
 * The whole sky, derived once per map. Immutable after creation — a frame
 * only READS it (positions go into a caller-owned scratch array, so the hot
 * path allocates nothing).
 */
export interface CloudField {
  readonly seed: number;
  /** The wind's unit vector (one slow deterministic direction per map). */
  readonly windX: number;
  readonly windY: number;
  /** World px per second along the unit vector. */
  readonly windSpeed: number;
  readonly clouds: readonly CloudDef[];
  /** The wrap rectangle in world space (the map diamond + margin). */
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Derive the sky for a map seed. Pure: the same seed always builds the same
 * wind and the same clouds, on host and guest, in every session.
 */
export function createCloudField(seed: number): CloudField {
  const rng = mulberry32((seed >>> 0) ^ 0xc10d5);
  const angle = rng() * Math.PI * 2;
  const windX = Math.cos(angle);
  const windY = Math.sin(angle);
  const windSpeed = CLOUD_WIND_MIN + rng() * (CLOUD_WIND_MAX - CLOUD_WIND_MIN);
  const b = mapWorldBounds();
  const minX = b.minX - CLOUD_WRAP_MARGIN;
  const minY = b.minY - CLOUD_WRAP_MARGIN;
  const maxX = b.maxX + CLOUD_WRAP_MARGIN;
  const maxY = b.maxY + CLOUD_WRAP_MARGIN;
  const sx = maxX - minX, sy = maxY - minY;
  const clouds: CloudDef[] = [];
  for (let i = 0; i < CLOUD_COUNT; i++) {
    clouds.push({
      bx: minX + rng() * sx,
      by: minY + rng() * sy,
      w: (CLOUD_W_MIN_TILES + rng() * (CLOUD_W_MAX_TILES - CLOUD_W_MIN_TILES)) * TILE_W,
      variant: i % CLOUD_VARIANTS,
    });
  }
  return { seed: seed >>> 0, windX, windY, windSpeed, clouds, minX, minY, maxX, maxY };
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * The zoom fade: full at the furthest step, ~40% in the middle, gone at the
 * closest — smoothstep-eased between the stops, clamped outside them. Only
 * the three ZOOM_STEPS ever arrive, but the curve is continuous anyway.
 */
export function cloudAlphaForZoom(zoom: number): number {
  // Owner: the clouds themselves only at the FURTHEST zoom - gone by medium.
  if (zoom <= 0.5) return 1;
  if (zoom >= 0.75) return 0;
  return 1 - smooth((zoom - 0.5) / 0.25);
}

/** Their ground shadows drift over the map at every zoom. */
export function cloudShadowAlphaForZoom(_zoom: number): number {
  return 1;
}

/**
 * Write every cloud's world position at `timeMs` into `out` (pairs of x/y —
 * `out.length` must be at least twice the cloud count). The base position
 * drifts along the wind and wraps around the map bounds. No allocation; the
 * renderer owns one scratch array for the life of the map.
 */
export function writeCloudPositions(field: CloudField, timeMs: number, out: Float32Array): void {
  const t = Math.max(0, timeMs) / 1000;
  const dx = field.windX * field.windSpeed * t;
  const dy = field.windY * field.windSpeed * t;
  const sx = field.maxX - field.minX;
  const sy = field.maxY - field.minY;
  const n = field.clouds.length;
  for (let i = 0; i < n; i++) {
    const c = field.clouds[i];
    // Math.floor, not %, so a negative wind still wraps into the bounds.
    let x = c.bx + dx - field.minX;
    x -= Math.floor(x / sx) * sx;
    let y = c.by + dy - field.minY;
    y -= Math.floor(y / sy) * sy;
    out[i * 2] = field.minX + x;
    out[i * 2 + 1] = field.minY + y;
  }
}

/** Allocating twin of `writeCloudPositions`, for tests and tools. */
export function cloudPositions(field: CloudField, timeMs: number): { x: number; y: number }[] {
  const scratch = new Float32Array(field.clouds.length * 2);
  writeCloudPositions(field, timeMs, scratch);
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < field.clouds.length; i++) {
    out.push({ x: scratch[i * 2], y: scratch[i * 2 + 1] });
  }
  return out;
}

// ── sprites ─────────────────────────────────────────────────────────────────

/**
 * The two sprite sets, matched puff for puff: the white clouds and their dark
 * ground masks. `makeCloudSprites()` bakes the procedural placeholders; the
 * lead's rundot art arrives through the same shape (see the header).
 */
export interface CloudSprites {
  readonly clouds: readonly (HTMLCanvasElement | OffscreenCanvas)[];
  readonly shadows: readonly (HTMLCanvasElement | OffscreenCanvas)[];
}

type Puff = { cx: number; cy: number; r: number };

/** The puff layout for one variant — shared by its cloud and its shadow. */
function variantPuffs(variant: number): Puff[] {
  const rng = mulberry32(0xc10d5 ^ (variant * 0x9e3779b9));
  const n = 10 + Math.floor(rng() * 4);
  const puffs: Puff[] = [];
  for (let i = 0; i < n; i++) {
    // A gaussian-ish cluster (two rngs averaged): dense heart, ragged edge.
    const ex = (rng() + rng() - 1) * CLOUD_SPRITE_W * 0.30;
    const ey = (rng() + rng() - 1) * CLOUD_SPRITE_H * 0.22;
    puffs.push({
      cx: CLOUD_SPRITE_W / 2 + ex,
      cy: CLOUD_SPRITE_H * 0.56 + ey,
      r: CLOUD_SPRITE_H * (0.13 + rng() * 0.22),
    });
  }
  return puffs;
}

function makeSurface(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Paint one placeholder sprite: overlapping radial-gradient puffs. The cloud
 * is lit from the top (cool shade low, bright white high); the shadow reuses
 * the same puffs in dark slate. A destination-out ellipse guarantees the
 * sprite rect itself never shows — every edge falls to transparency.
 */
function paintSprite(puffs: Puff[], shadow: boolean): HTMLCanvasElement | OffscreenCanvas | null {
  const surf = makeSurface(CLOUD_SPRITE_W, CLOUD_SPRITE_H);
  if (!surf) return null;
  const ctx = (surf as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx || typeof ctx.createRadialGradient !== "function") return null;
  const W = CLOUD_SPRITE_W, H = CLOUD_SPRITE_H;
  const blob = (cx: number, cy: number, r: number, stops: [number, string][]) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (const [at, color] of stops) g.addColorStop(at, color);
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  if (shadow) {
    // Owner: a shadow has a HARD edge. One solid union of the puffs (so
    // overlaps never stack darker), anti-aliased only by the canvas itself;
    // its strength is the blit's CLOUD_SHADOW_ALPHA. Every circle is kept
    // inside the sprite so no edge is clipped flat by the rect.
    ctx.fillStyle = "rgb(0,0,0)"; // owner: black, made see-through by the blit alpha
    ctx.beginPath();
    for (const p of puffs) {
      const r = Math.max(2, Math.min(p.r * 0.9, p.cx - 2, W - p.cx - 2, p.cy - 2, H - p.cy - 2));
      ctx.moveTo(p.cx + r, p.cy);
      ctx.arc(p.cx, p.cy, r, 0, Math.PI * 2);
    }
    ctx.fill("nonzero");
    return surf;
  } else {
    // The shade first (low, cool, faint), then the lit puffs over it.
    for (const p of puffs) {
      blob(p.cx, p.cy + p.r * 0.28, p.r * 1.02, [
        [0, "rgba(172,192,210,0.34)"],
        [0.6, "rgba(172,192,210,0.16)"],
        [1, "rgba(172,192,210,0)"],
      ]);
    }
    for (const p of puffs) {
      blob(p.cx, p.cy - p.r * 0.08, p.r, [
        [0, "rgba(255,255,255,0.85)"],
        [0.45, "rgba(248,251,253,0.50)"],
        [1, "rgba(248,251,253,0)"],
      ]);
    }
  }
  // Erase toward the rect: keep the heart, fall to nothing at the edges.
  ctx.globalCompositeOperation = "destination-out";
  const mask = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.62);
  mask.addColorStop(0, "rgba(0,0,0,0)");
  mask.addColorStop(0.55, "rgba(0,0,0,0)");
  mask.addColorStop(1, "rgba(0,0,0,1)");
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  return surf;
}

/**
 * Bake the placeholder set once (one cloud + one shadow per variant). Returns
 * null where no canvas API exists (the node test harness) — the paint entry
 * treats that as "no art, draw nothing", exactly like the ground textures do.
 */
export function makeCloudSprites(): CloudSprites | null {
  const clouds: (HTMLCanvasElement | OffscreenCanvas)[] = [];
  const shadows: (HTMLCanvasElement | OffscreenCanvas)[] = [];
  for (let v = 0; v < CLOUD_VARIANTS; v++) {
    const puffs = variantPuffs(v);
    const cloud = paintSprite(puffs, false);
    const shadow = paintSprite(puffs, true);
    if (!cloud || !shadow) return null;
    clouds.push(cloud);
    shadows.push(shadow);
  }
  return { clouds, shadows };
}

// ── paint ───────────────────────────────────────────────────────────────────

/**
 * Paint one cloud layer: the white veils (`shadow: false`, overlay canvas) or
 * their faint ground shadows (`shadow: true`, terrain canvas, sun-offset).
 *
 * `fade` is `cloudAlphaForZoom(cam.zoom)` — 0 draws nothing. `scratch` is the
 * caller's positions buffer (see `writeCloudPositions`). Returns the blits
 * issued. alloc-free: the loop is numbers and array reads (the projection is
 * inlined rather than calling `worldToScreen`, which returns a tuple).
 *
 * The context surface is deliberately tiny — `drawImage` plus `globalAlpha`,
 * restored to 1 on the way out — so test stubs and half contexts survive it.
 */
export function paintCloudLayer(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  field: CloudField,
  sprites: CloudSprites | null,
  fade: number,
  timeMs: number,
  scratch: Float32Array,
  shadow: boolean,
  /** Paint at this alpha instead (the renderer's flat shadow buffer uses 1). */
  alphaOverride?: number,
): number {
  if (!sprites || !(fade > 0)) return 0;
  const set = shadow ? sprites.shadows : sprites.clouds;
  if (set.length === 0) return 0;
  writeCloudPositions(field, timeMs, scratch);
  const z = cam.zoom;
  const aspect = CLOUD_SPRITE_H / CLOUD_SPRITE_W;
  const alpha = alphaOverride ?? fade * (shadow ? CLOUD_SHADOW_ALPHA : CLOUD_ALPHA_MAX);
  const n = field.clouds.length;
  let blits = 0;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    const c = field.clouds[i];
    let wx = scratch[i * 2];
    let wy = scratch[i * 2 + 1];
    if (shadow) {
      wx += CLOUD_SHADOW_DX;
      wy += CLOUD_SHADOW_DY;
    }
    const w = c.w * z;
    const h = w * aspect;
    let sx: number, sy: number;
    if (shadow) {
      sx = wx * z + cam.x - w / 2;
      sy = wy * z + cam.y - h / 2;
    } else {
      // Parallax: the veil layer moves CLOUD_PARALLAX x the ground's pan,
      // wrapped in screen space over the field's span so the sky never
      // runs out at the map edge.
      const spanX = (field.maxX - field.minX) * z;
      const spanY = (field.maxY - field.minY) * z;
      const ax = -w, ay = -h;
      const px = wx * z + cam.x * CLOUD_PARALLAX - w / 2 - ax;
      const py = wy * z + cam.y * CLOUD_PARALLAX - h / 2 - ay;
      sx = ax + (px - Math.floor(px / spanX) * spanX);
      sy = ay + (py - Math.floor(py / spanY) * spanY);
    }
    // Cull fully off-screen veils — a zoomed-in frame skips most of the sky.
    if (sx + w < 0 || sy + h < 0 || sx > cam.vw || sy > cam.vh) continue;
    const img = set[c.variant % set.length] as unknown as CanvasImageSource;
    ctx.drawImage(img, Math.floor(sx), Math.floor(sy), Math.ceil(w), Math.ceil(h));
    blits++;
  }
  ctx.globalAlpha = 1;
  return blits;
}
