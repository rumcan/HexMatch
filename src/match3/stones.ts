// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 (#566) — the stones the board canvas draws, as STRIPS.
//
// A strip is N pictures of one kind of stone turned about the screen's
// vertical axis, a full turn end to end. The board's cargo tokens are the
// owner's painted icons (src/assets/gems/<cargo>@2x.png), flat for now, so
// their strips are ONE frame and the renderer brings them to life in the
// plane (a sway, a twist, a squash) instead of by turning. The bomb is a real
// strip (24 frames of an iron charge on a lit fuse, src/assets/stones/). When
// the 3D stones land (owner: next month), a cargo strip simply gains frames —
// `frameIndex` already picks the frame for any angle.
//
// A kind with no strip yet (the instant before the images decode) is drawn as
// a plain token in its palette (`drawFlatGem`), so the board never shows a
// hole.
// ══════════════════════════════════════════════════════════════════════════

import { RES_TO_STONE, type ResKey, type StoneType, type Special } from "./types";

export type StripType = StoneType | "bomb" | "disco";

export interface StoneStrip {
  type: string;
  frames: number;
  /** Frames per second for a strip that spins by itself (the bomb). */
  fps: number;
  images: CanvasImageSource[];
  /** The owner's wiggle (hover, held, and the beat before a match). */
  wiggle?: CanvasImageSource[];
  /** The burst as the stone is matched away. */
  boom?: CanvasImageSource[];
  /** The stone frozen: one hit left (semi-iced), two hits left (full ice). */
  ice1?: CanvasImageSource;
  ice2?: CanvasImageSource;
  /** Owner (2026-09-28): the LINE gem wears the old octagon gem of its colour. */
  line?: CanvasImageSource;
}

/** The frame at an angle in turns (0…1 = one rotation; any real accepted). */
export function frameIndex(strip: Pick<StoneStrip, "frames">, turns: number): number {
  const n = Math.max(1, strip.frames | 0);
  const t = ((turns % 1) + 1) % 1;
  return Math.min(n - 1, Math.floor(t * n + 1e-9));
}

/** The strip a gem draws from: its cargo, or its special. */
export function stripTypeFor(gem: { res: ResKey; special: Special }): StripType {
  return gem.special === "bomb" ? "bomb" : gem.special === "disco" ? "disco" : RES_TO_STONE[gem.res];
}

/** Cut a horizontal sheet of `frames` equal squares into its pictures. */
export function sliceSheet(sheet: HTMLImageElement | ImageBitmap, frames: number): CanvasImageSource[] {
  const out: CanvasImageSource[] = [];
  const w = sheet.width / frames;
  const h = sheet.height;
  for (let i = 0; i < frames; i++) {
    const c = makeCanvas(w, h);
    const x = c?.getContext("2d") as CanvasRenderingContext2D | null;
    if (!c || !x) return [];
    x.drawImage(sheet, i * w, 0, w, h, 0, 0, w, h);
    out.push(c as CanvasImageSource);
  }
  return out;
}

/**
 * Bake a soft contact shadow under a picture, once, so the board never pays
 * for a canvas blur per stone per frame. Returns a canvas the same size.
 */
export function withShadow(img: CanvasImageSource & { width: number; height: number }): CanvasImageSource {
  const w = img.width, h = img.height;
  const c = makeCanvas(w, h);
  const x = c?.getContext("2d") as CanvasRenderingContext2D | null;
  if (!c || !x) return img;
  x.shadowColor = "rgba(0, 0, 0, 0.55)";
  x.shadowBlur = Math.max(2, w * 0.035);
  x.shadowOffsetY = Math.max(1, h * 0.022);
  x.drawImage(img, 0, 0, w, h);
  return c as CanvasImageSource;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  try {
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w));
      c.height = Math.max(1, Math.round(h));
      return c;
    }
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  } catch {
    /* no canvas here */
  }
  return null;
}

// ── palette: the shards a stone breaks into, read off the paintings ──────────
export interface StonePalette {
  base: string;
  dark: string;
  glint: string;
}

export const STONE_PALETTE: Record<StripType, StonePalette> = {
  grain: { base: "#f2b43a", dark: "#b8641a", glint: "#fff1b8" },
  wood: { base: "#c98549", dark: "#7a4520", glint: "#f6cf9c" },
  ore: { base: "#ff4fae", dark: "#6c707c", glint: "#ffd0ec" },
  stone: { base: "#c9ccd2", dark: "#7c828b", glint: "#ffffff" },
  oil: { base: "#9a4cf4", dark: "#1c1b24", glint: "#e1c6ff" },
  gold: { base: "#ffd24a", dark: "#c58a10", glint: "#fff6c8" },
  bomb: { base: "#3a3a40", dark: "#101014", glint: "#ffb27a" },
  disco: { base: "#9a6ae0", dark: "#2a1a4a", glint: "#f4d8ff" },
};

/** A plain token in the stone's palette — only for the instant before the art decodes. */
export function drawFlatGem(ctx: CanvasRenderingContext2D, type: StripType, x: number, y: number, size: number, alpha = 1): void {
  const p = STONE_PALETTE[type];
  const r = size * 0.36;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = p.dark;
  ctx.beginPath();
  ctx.arc(x, y + r * 0.08, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.base;
  ctx.beginPath();
  ctx.arc(x, y - r * 0.04, r * 0.9, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
