// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 (#566) — the board canvas, mounted in the chrome.
//
// The owner's call: the board looks and moves like Fable's rebuild (its
// canvas renderer, src/match3/renderer.ts), not like the old DOM board. So the
// chrome keeps its DOM gems as the INPUT layer — invisible buttons that still
// take the taps, the drags, the focus and every test that clicks them — and
// this canvas, laid under them inside the grid, draws the board:
//
//   · the phase stream (`Board.onPhase`) drives every motion, over exactly the
//     beat the board waits (turbo and the finale's slow-mo included);
//   · `renderBoard` → `sync()` reconciles the sprites with the grid;
//   · a gem in the hand is drawn where the hand holds it (`offsetOf` reads the
//     drag offset the chrome writes onto the invisible button), and a gem let
//     go is dropped there (`dropAt`) so its swap — or its spring home — starts
//     from the hand, not from its cell.
//
// The art: the owner's painted cargo icons (flat for now — the 3D stones are
// next month), each with a soft contact shadow baked once; the bomb's 24-frame
// turn and the frost slabs from src/assets/board/ when present; the painted
// anvil for an Iron Girder. Anything missing falls back to a vector drawing,
// so the board never shows a hole (and headless tests, which never decode an
// image, run the same code).
// ══════════════════════════════════════════════════════════════════════════
import { BoardRenderer } from "../match3/renderer";
import { sliceSheet, withShadow, type StoneStrip, type StripType } from "../match3/stones";
import type { BoardPhase, CellRef, SwapPhase } from "../match3/types";
import type { Board } from "./board";
import type { Cargo } from "../iso/config";
import { GEM_ART, GEM_ART_2X } from "./gem-art";
import girderUrl from "../assets/ui/girder-anvil.png";

/** Optional board art (the bomb's turn, the frost slabs): a missing file is a vector fallback. */
const BOARD_ART = import.meta.glob<string>("../assets/board/*.{webp,png}", { eager: true, import: "default" });
const art = (name: string): string | undefined => BOARD_ART[`../assets/board/${name}`];
/** The owner's per-gem animations and iced pictures (tools/make-gem-anims.py). */
const ANIM = import.meta.glob<string>("../assets/gems/anim/*.png", { eager: true, import: "default" });

/** Frames in the bomb's sheet (one full turn). */
export const BOMB_FRAMES = 24;

export interface BoardCanvasHost {
  board: Board;
  /** The gem container: the canvas is laid inside it, under the buttons. */
  grid: HTMLElement;
  /** Grid px per cell. */
  cell: number;
  reduceMotion: () => boolean;
  /** The invisible input button for a gem id, if it is on the board. */
  gemEl(id: number): HTMLElement | undefined;
  /** The finale's camera and clock (1 = at rest). */
  zoom?: () => number;
  hooks?: {
    onContact?: (phase: SwapPhase) => void;
    onLand?: (count: number, chain: number) => void;
  };
}

export interface BoardCanvas {
  ingest(phase: BoardPhase, ms: number): void;
  sync(snap?: boolean): void;
  resize(): void;
  setSelected(cell: CellRef | null): void;
  setHover(cell: CellRef | null): void;
  dropAt(id: number, dx: number, dy: number): void;
  settleHome(id: number): void;
  shake(ids: number[]): void;
  destroy(): void;
}

function loadImage(url: string | undefined): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    try {
      if (!url || typeof Image === "undefined") return resolve(null);
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
      img.onerror = () => resolve(null);
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

/** The chrome writes a held gem's offset as `translate: Xpx Ypx`. */
function parseTranslate(v: string): [number, number] | null {
  if (!v) return null;
  const [x = "0", y = "0"] = v.split(" ");
  const dx = parseFloat(x) || 0, dy = parseFloat(y) || 0;
  return dx || dy ? [dx, dy] : null;
}

export function mountBoardCanvas(host: BoardCanvasHost): BoardCanvas | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.className = "board-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.grid.insertBefore(canvas, host.grid.firstChild);
  host.grid.classList.add("canvas-board");

  const strips = new Map<StripType, StoneStrip>();
  const boardArt: { girder?: CanvasImageSource | null; ice1?: CanvasImageSource | null; ice2?: CanvasImageSource | null } = {};

  const renderer = new BoardRenderer(canvas, host.board, {
    cell: host.cell,
    pad: 0,
    plate: false,
    attach: false,
    neighbours: true,
    art: boardArt,
    getStrip: (t) => strips.get(t) ?? null,
    perfMode: () => false,
    reducedMotion: host.reduceMotion,
    zoom: () => host.zoom?.() ?? 1,
    timeScale: () => {
      const f = (host.board as unknown as { timeScale?: () => number }).timeScale;
      const v = typeof f === "function" ? f.call(host.board) : 1;
      return Number.isFinite(v) && v > 0 ? v : 1;
    },
    pixelRatio: () => {
      const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
      const w = host.grid.offsetWidth;
      const zoom = w > 0 ? host.grid.getBoundingClientRect().width / w : 1;
      return dpr * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1);
    },
    offsetOf: (id) => {
      const el = host.gemEl(id);
      if (!el || !(el.classList.contains("dragging") || el.classList.contains("yielding"))) return null;
      return parseTranslate(el.style.translate);
    },
    hooks: host.hooks,
  });

  // The art decodes in the background; each kind appears as it lands.
  const dense = typeof window !== "undefined" && (window.devicePixelRatio || 1) > 1.25;
  const cargoArt: Record<Cargo, string> = dense ? GEM_ART_2X : GEM_ART;
  const STRIP_OF: Record<Cargo, StripType> = { grain: "grain", wood: "wood", ore: "ore", stone: "stone", oil: "oil", gold: "gold" };
  for (const cargo of Object.keys(cargoArt) as Cargo[]) {
    const seq = (kind: string) => Promise.all([0, 1, 2, 3].map((i) => loadImage(ANIM[`../assets/gems/anim/${cargo}_${kind}_${i}.png`])));
    void Promise.all([
      loadImage(cargoArt[cargo]), seq("wiggle"), seq("boom"),
      loadImage(ANIM[`../assets/gems/anim/${cargo}_ice1.png`]), loadImage(ANIM[`../assets/gems/anim/${cargo}_ice2.png`]),
    ]).then(([img, wiggle, boom, ice1, ice2]) => {
      if (!img) return;
      const all = (xs: (HTMLImageElement | null)[]) => (xs.every(Boolean) ? xs.map((x) => withShadow(x!)) : undefined);
      strips.set(STRIP_OF[cargo], {
        type: cargo, frames: 1, fps: 0, images: [withShadow(img)],
        wiggle: all(wiggle), boom: all(boom),
        ice1: ice1 ? withShadow(ice1) : undefined, ice2: ice2 ? withShadow(ice2) : undefined,
      });
    });
  }
  void loadImage(art("bomb@2x.webp")).then((img) => {
    if (!img) return;
    const frames = sliceSheet(img, BOMB_FRAMES).map((f) => withShadow(f as HTMLCanvasElement));
    if (frames.length) strips.set("bomb", { type: "bomb", frames: frames.length, fps: 15, images: frames });
  });
  // (frost: each gem has its own iced pictures now; the cube is only the fallback)
  void loadImage(art("ice1@2x.webp")).then((img) => { boardArt.ice1 = img; });
  void loadImage(art("ice2@2x.webp")).then((img) => { boardArt.ice2 = img; });
  void loadImage(girderUrl).then((img) => { boardArt.girder = img; });

  renderer.start();
  return {
    ingest: (p, ms) => renderer.ingest(p, ms),
    sync: (snap) => renderer.sync(snap),
    resize: () => { renderer.resize(); renderer.sync(true); },
    setSelected: (c) => renderer.setSelected(c),
    setHover: (c) => renderer.setHover(c),
    dropAt: (id, dx, dy) => renderer.dropAt(id, dx, dy),
    settleHome: (id) => renderer.settleHome(id),
    shake: (ids) => renderer.shake(ids),
    destroy: () => { renderer.destroy(); canvas.remove(); host.grid.classList.remove("canvas-board"); },
  };
}
