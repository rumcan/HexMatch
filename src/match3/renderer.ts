// ══════════════════════════════════════════════════════════════════════════
// MATCH-2 (#566) — the board canvas.
//
// Fable's renderer, brought into the game (the owner liked its feel and
// called the old DOM board clunky). A canvas-2d view of a `Board`, fed by its
// phase stream: every beat the adapter starts (`onPhase(phase, ms)`) becomes
// tweens on the sprites it names, over exactly the `ms` the adapter will
// wait — so the picture and the input lock never disagree, turbo shortens
// the tweens with the waits, and the finale's slow-mo stretches both.
//
//   swap     both stones travel along shallow opposite arcs, swell a touch
//            and lean into the move as they pass; a revert leans back. The
//            contact moment (`contactAt`) sparks and fires `onContact` (the
//            clack is hooked there).
//   clear    the removed stones bloom and vanish, turning; shards of them fly;
//            the callout (`MATCH!`, `COMBO x2`, `COLOUR PURGE`) floats off.
//   fall     each stone drops under an ease-in and lands with a squash and a
//            small rock; spawned stones start above the plate.
//   shuffle  every stone dips and comes back.
//
// At rest the stones are alive but calm: each sways a degree or two and
// breathes on its own slow clock (flat strips), a multi-frame strip drifts
// its frames (the bomb spins). PERFORMANCE MODE draws everything still (no
// idle, no particles, no push-in); REDUCED MOTION drops the idle, the leans,
// the particles and the push-in but keeps the travel itself (a move must
// still read).
//
// In the game the chrome keeps its DOM gems as the INPUT layer (invisible
// buttons: tap, drag, focus and every test that clicks them) and this canvas
// draws the board under them: `attach: false` (the chrome feeds `ingest` and
// `sync`), no plate and no padding (the board frame is the chrome's), the
// live drag offsets read back through `offsetOf`.
// ══════════════════════════════════════════════════════════════════════════

import type { Board } from "./board";
import { STONE_PALETTE, drawFlatGem, frameIndex, stripTypeFor, type StoneStrip, type StripType } from "./stones";
import type { BoardPhase, CellRef, ClearPhase, FallPhase, ResKey, SwapPhase, Special } from "./types";

/** One cell's wipe explosion, start to fade (the owner's 8 frames). */
const BURST_MS = 560;

export interface RendererArt {
  /** The Iron Girder blocker (the painted anvil). */
  girder?: CanvasImageSource | null;
  /** Frost overlays: one hit left, two hits left. */
  ice1?: CanvasImageSource | null;
  ice2?: CanvasImageSource | null;
  /** The disco ball's board wipe: the owner's explosion, played in every cell. */
  burst?: CanvasImageSource[] | null;
}

export interface RendererOptions {
  /** CSS pixels per cell. */
  cell: number;
  getStrip: (type: StripType) => StoneStrip | null;
  perfMode: () => boolean;
  reducedMotion: () => boolean;
  /** The finale's camera (1 = at rest). */
  zoom: () => number;
  /** The finale's clock (particles slow with the board). */
  timeScale: () => number;
  /** Space around the grid, CSS px (default `BOARD_PAD`). */
  pad?: number;
  /** Paint the dark plate behind the cells (default true). */
  plate?: boolean;
  /** Chain onto `board.onPhase`/`onChange` (default true); false = the host calls `ingest`/`sync`. */
  attach?: boolean;
  /** Device pixels per CSS pixel of the canvas (default `devicePixelRatio`). */
  pixelRatio?: () => number;
  /** A live drag offset for a gem, CSS px, or null when it is not in the hand. */
  offsetOf?: (id: number) => readonly [number, number] | null;
  /** Mark the selection's open neighbours (the tap path's legal answers). */
  neighbours?: boolean;
  art?: RendererArt;
  hooks?: {
    onContact?: (phase: SwapPhase) => void;
    onHover?: (cell: CellRef) => void;
    onLand?: (count: number, chain: number) => void;
  };
}

interface Tween {
  start: number;
  dur: number;
  apply: (t: number, s: Sprite) => void;
  done?: (s: Sprite) => void;
  /** one-shots at a fraction of the tween */
  marks?: { at: number; fired: boolean; fire: () => void }[];
}

interface Sprite {
  id: number;
  res: ResKey;
  special: Special;
  hard: number;
  block: boolean;
  tier: number;
  /** Position in cells (column, row) — fractional while moving. */
  x: number;
  y: number;
  /** Turns — picks the frame of a multi-frame strip. */
  angle: number;
  /** Radians — the in-plane lean a flat stone shows while moving. */
  twist: number;
  scale: number;
  sx: number;
  sy: number;
  alpha: number;
  /** CSS px — the invalid-swap jiggle. */
  jx: number;
  dying: boolean;
  /** Dropped out of the hand where it was let go: `sync` must not snap it home. */
  held: boolean;
  /** A frame of the owner's animations to show instead of the still (the match). */
  pose: { kind: "wiggle" | "boom"; frame: number } | null;
  tweens: Tween[];
  seed: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  age: number;
  life: number;
  color: string;
  size: number;
  kind: "shard" | "ice" | "spark";
}

interface Callout {
  text: string;
  x: number;
  y: number;
  born: number;
  life: number;
  hot: boolean;
}

interface Ring {
  x: number;
  y: number;
  born: number;
  life: number;
  color: string;
}

const easeOutBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
const easeInQuad = (t: number) => t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

export const BOARD_PAD = 14;

export class BoardRenderer {
  private sprites = new Map<number, Sprite>();
  private particles: Particle[] = [];
  private callouts: Callout[] = [];
  private rings: Ring[] = [];
  /** Disco wipe: one explosion per cell, rippling out from the ball. */
  private bursts: { x: number; y: number; born: number }[] = [];
  private raf = 0;
  private running = false;
  private lastFrame = 0;
  private hover: CellRef | null = null;
  private selected: CellRef | null = null;
  private dpr = 1;
  private frames = 0;
  private unsubscribers: (() => void)[] = [];
  /** Frames drawn in the last second (the perf readout). */
  fps = 0;
  private fpsAcc = 0;
  private fpsAt = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private board: Board,
    private opts: RendererOptions,
  ) {
    if (opts.attach !== false) {
      const prevPhase = board.onPhase;
      const prevChange = board.onChange;
      board.onPhase = (p, ms) => {
        prevPhase(p, ms);
        this.ingest(p, ms);
      };
      board.onChange = () => {
        prevChange();
        this.sync();
      };
      this.unsubscribers.push(() => {
        board.onPhase = prevPhase;
        board.onChange = prevChange;
      });
    }
    this.resize();
    this.sync(true);
  }

  // ── geometry ───────────────────────────────────────────────────────────
  get cell(): number {
    return this.opts.cell;
  }
  private get pad(): number {
    return this.opts.pad ?? BOARD_PAD;
  }
  get widthCss(): number {
    return this.board.w * this.cell + this.pad * 2;
  }
  get heightCss(): number {
    return this.board.h * this.cell + this.pad * 2;
  }

  private pixelRatio(): number {
    const r = this.opts.pixelRatio?.() ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    return Math.min(3, Math.max(0.5, Number.isFinite(r) ? r : 1));
  }

  resize(): void {
    const dpr = this.pixelRatio();
    const w = Math.max(1, Math.round(this.widthCss * dpr)), h = Math.max(1, Math.round(this.heightCss * dpr));
    // unchanged: keep the backing store (a reallocation clears the picture)
    if (w === this.canvas.width && h === this.canvas.height && dpr === this.dpr) return;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(this.widthCss * this.dpr));
    this.canvas.height = Math.max(1, Math.round(this.heightCss * this.dpr));
    this.canvas.style.width = `${this.widthCss}px`;
    this.canvas.style.height = `${this.heightCss}px`;
  }

  /** The cell under a client point, or null off the plate. */
  hitTest(clientX: number, clientY: number): CellRef | null {
    const rect = this.canvas.getBoundingClientRect();
    const sx = (clientX - rect.left) * (this.widthCss / Math.max(1, rect.width));
    const sy = (clientY - rect.top) * (this.heightCss / Math.max(1, rect.height));
    const c = Math.floor((sx - this.pad) / this.cell);
    const r = Math.floor((sy - this.pad) / this.cell);
    if (c < 0 || r < 0 || c >= this.board.w || r >= this.board.h) return null;
    return { r, c };
  }

  setHover(cell: CellRef | null): void {
    const changed = (cell?.r ?? -1) !== (this.hover?.r ?? -1) || (cell?.c ?? -1) !== (this.hover?.c ?? -1);
    this.hover = cell;
    if (changed && cell) this.opts.hooks?.onHover?.(cell);
  }
  setSelected(cell: CellRef | null): void {
    this.selected = cell;
  }

  // ── the hand (the chrome's drag) ───────────────────────────────────────
  /** A gem let go where the hand left it: the next tween starts from there. */
  dropAt(id: number, dx: number, dy: number): void {
    const s = this.sprites.get(id);
    if (!s || (!dx && !dy)) return;
    s.x += dx / this.cell;
    s.y += dy / this.cell;
    s.held = true;
  }

  /** Ease a let-go gem home if no move claimed it (a cancelled or refused drag). */
  settleHome(id: number): void {
    const s = this.sprites.get(id);
    if (!s || s.tweens.length || s.dying) return;
    s.held = false;
    const home = this.cellOf(id);
    if (!home) return;
    const from = { x: s.x, y: s.y };
    if (Math.abs(from.x - home.c) < 1e-3 && Math.abs(from.y - home.r) < 1e-3) return;
    s.tweens.push({
      start: this.now(), dur: 180,
      apply: (t, sp) => {
        const e = easeOutBack(t);
        sp.x = from.x + (home.c - from.x) * e;
        sp.y = from.y + (home.r - from.y) * e;
      },
      done: (sp) => { sp.x = home.c; sp.y = home.r; },
    });
  }

  /** The invalid-swap verdict: a short lateral jiggle on these gems. */
  shake(ids: number[]): void {
    if (!this.motionRich()) return;
    const now = this.now();
    for (const id of ids) {
      const s = this.sprites.get(id);
      if (!s) continue;
      s.tweens.push({
        start: now, dur: 260,
        apply: (t, sp) => { sp.jx = 7 * Math.sin(t * Math.PI * 5) * (1 - t); },
        done: (sp) => { sp.jx = 0; },
      });
    }
  }

  private cellOf(id: number): CellRef | null {
    for (let r = 0; r < this.board.h; r++) {
      for (let c = 0; c < this.board.w; c++) if (this.board.grid[r]?.[c]?.id === id) return { r, c };
    }
    return null;
  }

  // ── lifecycle ──────────────────────────────────────────────────────────
  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      this.frame(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  }
  destroy(): void {
    this.stop();
    for (const u of this.unsubscribers) u();
  }

  // ── sprites ────────────────────────────────────────────────────────────
  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  private makeSprite(g: { id: number; res: ResKey; special: Special; hard: number; block: boolean; tier: number }, x: number, y: number): Sprite {
    const s: Sprite = {
      id: g.id, res: g.res, special: g.special, hard: g.hard, block: g.block, tier: g.tier,
      x, y, angle: 0, twist: 0, scale: 1, sx: 1, sy: 1, alpha: 1, jx: 0,
      dying: false, held: false, pose: null, tweens: [], seed: (g.id * 9301 + 49297) % 233280,
    };
    this.sprites.set(g.id, s);
    return s;
  }

  /** Reconcile with the grid: new gems appear, gone gems (not dying) leave,
   * flags follow the gem, and an idle sprite snaps to its cell. */
  sync(snapAll = false): void {
    const seen = new Set<number>();
    for (let r = 0; r < this.board.h; r++) {
      for (let c = 0; c < this.board.w; c++) {
        const g = this.board.grid[r]?.[c];
        if (!g) continue;
        seen.add(g.id);
        let s = this.sprites.get(g.id);
        if (!s) s = this.makeSprite(g, c, r);
        s.res = g.res;
        s.special = g.special;
        s.hard = g.hard;
        s.block = g.block;
        s.tier = g.tier;
        if (snapAll || (!s.tweens.length && !s.dying && !s.held)) {
          s.x = c;
          s.y = r;
        }
      }
    }
    for (const [id, s] of this.sprites) if (!seen.has(id) && !s.dying) this.sprites.delete(id);
  }

  private cellCentre(x: number, y: number): [number, number] {
    return [this.pad + (x + 0.5) * this.cell, this.pad + (y + 0.5) * this.cell];
  }

  private motionRich(): boolean {
    return !this.opts.perfMode() && !this.opts.reducedMotion();
  }

  // ── phases → tweens ────────────────────────────────────────────────────
  ingest(phase: BoardPhase, ms: number): void {
    const now = this.now();
    const dur = Math.max(1, ms);
    switch (phase.type) {
      case "swap":
      case "revert":
        this.tweenSwap(phase, now, dur);
        break;
      case "clear":
      case "bombClear":
        this.tweenClear(phase, now, dur);
        break;
      case "fall":
      case "bombFall":
        this.tweenFall(phase, now, dur);
        break;
      case "shuffle":
        for (const s of this.sprites.values()) {
          s.tweens.push({ start: now, dur, apply: (t, sp) => {
            sp.alpha = 1 - 0.6 * Math.sin(Math.PI * t);
            sp.scale = 1 - 0.15 * Math.sin(Math.PI * t);
          }, done: (sp) => { sp.alpha = 1; sp.scale = 1; } });
        }
        break;
      default:
        break;
    }
  }

  private tweenSwap(phase: SwapPhase, now: number, dur: number): void {
    const a = this.sprites.get(phase.a.id);
    const b = this.sprites.get(phase.b.id);
    if (!a || !b) return;
    a.held = false;
    b.held = false;
    const rich = this.motionRich();
    const from = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
    const to = { a: { x: phase.b.c, y: phase.b.r }, b: { x: phase.a.c, y: phase.a.r } };
    const dx = to.a.x - from.a.x;
    const dy = to.a.y - from.a.y;
    // perpendicular bulge so the two stones pass side by side
    const px = -dy * 0.22;
    const py = dx * 0.22;
    const angA = a.angle;
    const angB = b.angle;
    // each stone leans INTO its own travel; a revert leans the other way home
    const lean = (phase.type === "revert" ? -1 : 1) * (Math.sign(dx || dy) || 1) * 0.3;
    const marks = [{ at: phase.contactAt, fired: false, fire: () => {
      this.opts.hooks?.onContact?.(phase);
      if (this.motionRich()) {
        const [cx, cy] = this.cellCentre((from.a.x + to.a.x) / 2, (from.a.y + to.a.y) / 2);
        this.spawnParticles(cx, cy, 4, "#ffe9b0", "spark");
      }
    } }];
    a.tweens.push({ start: now, dur, marks, apply: (t, s) => {
      const e = easeInOutSine(t);
      const bulge = Math.sin(Math.PI * t);
      s.x = from.a.x + dx * e + px * bulge;
      s.y = from.a.y + dy * e + py * bulge;
      if (rich) {
        s.angle = angA + 0.5 * e * (phase.type === "revert" ? -1 : 1);
        s.twist = lean * bulge;
      }
      s.scale = 1 + 0.08 * bulge;
    }, done: (s) => { s.x = to.a.x; s.y = to.a.y; s.scale = 1; s.twist = 0; } });
    b.tweens.push({ start: now, dur, apply: (t, s) => {
      const e = easeInOutSine(t);
      const bulge = Math.sin(Math.PI * t);
      s.x = from.b.x - dx * e - px * bulge;
      s.y = from.b.y - dy * e - py * bulge;
      if (rich) {
        s.angle = angB + 0.5 * e * (phase.type === "revert" ? -1 : 1);
        s.twist = -lean * bulge;
      }
      s.scale = 1 + 0.08 * bulge;
    }, done: (s) => { s.x = to.b.x; s.y = to.b.y; s.scale = 1; s.twist = 0; } });
  }

  private tweenClear(phase: ClearPhase, now: number, dur: number): void {
    const rich = this.motionRich();
    for (const cell of phase.removed) {
      const s = this.sprites.get(cell.id);
      const [cx, cy] = this.cellCentre(cell.c, cell.r);
      if (rich) this.spawnShards(cx, cy, phase.type === "bombClear" ? 5 : 8, stripTypeFor({ res: cell.res, special: null }));
      if (!s) continue;
      s.dying = true;
      s.held = false;
      const art = this.opts.getStrip(stripTypeFor({ res: cell.res, special: s.special }));
      if (art?.boom?.length && art.wiggle?.length) {
        // the owner's beat: a quick wiggle, then the burst — it may outlive the
        // board's clear wait (the refill falls in under it), never delays it
        const life = Math.max(dur, 460);
        s.tweens.push({ start: now, dur: life, apply: (t, sp) => {
          if (t < 0.28) sp.pose = { kind: "wiggle", frame: Math.floor((t / 0.28) * 4) % 4 };
          else sp.pose = { kind: "boom", frame: Math.min(3, Math.floor(((t - 0.28) / 0.72) * 4)) };
          sp.scale = 1 + 0.12 * Math.min(1, t / 0.28);
          sp.alpha = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
        }, done: (sp) => this.sprites.delete(sp.id) });
        continue;
      }
      const spin = (s.seed % 2 ? 1 : -1) * 0.55;
      s.tweens.push({ start: now, dur, apply: (t, sp) => {
        sp.scale = t < 0.35 ? 1 + 0.35 * (t / 0.35) : 1.35 * (1 - easeInQuad((t - 0.35) / 0.65));
        sp.alpha = 1 - easeInQuad(t);
        if (rich) { sp.angle += 0.01; sp.twist = spin * t; }
      }, done: (sp) => this.sprites.delete(sp.id) });
    }
    for (const cr of phase.cracked) {
      const [cx, cy] = this.cellCentre(cr.c, cr.r);
      if (rich) this.spawnParticles(cx, cy, 6, cr.kind === "frost" ? "#dff4ff" : "#b8bcc4", "ice");
      const s = this.spriteAt(cr.r, cr.c);
      if (s) s.tweens.push({ start: now, dur: Math.min(dur, 140), apply: (t, sp) => { const k = Math.sin(Math.PI * t); sp.sx = 1 + 0.08 * k; sp.sy = 1 - 0.08 * k; }, done: (sp) => { sp.sx = 1; sp.sy = 1; } });
    }
    for (const m of phase.minted) {
      const s = this.spriteAt(m.r, m.c);
      if (s) s.tweens.push({ start: now, dur: Math.max(dur, 180), apply: (t, sp) => { sp.scale = 0.2 + 0.8 * easeOutBack(t); }, done: (sp) => { sp.scale = 1; } });
    }
    if (phase.bombAt) {
      const [cx, cy] = this.cellCentre(phase.bombAt.c, phase.bombAt.r);
      this.rings.push({ x: cx, y: cy, born: now, life: Math.max(dur * 2, 320), color: phase.wipe ? "#e6a8ff" : "#ffb27a" });
      if (phase.wipe) {
        // the owner's explosion in every cell, rippling out from the ball
        for (const cell of phase.removed) {
          const d = Math.hypot(cell.r - phase.bombAt.r, cell.c - phase.bombAt.c);
          const [x, y] = this.cellCentre(cell.c, cell.r);
          this.bursts.push({ x, y, born: now + d * 45 });
        }
      }
    }
    const call = phase.fx.find((f) => f.type === "chain" || f.type === "combo");
    if (call && call.text) {
      const [cx, cy] = this.cellCentre(call.c, call.r);
      this.callouts.push({ text: call.text, x: cx, y: cy, born: now, life: 900, hot: call.type === "combo" || phase.type === "bombClear" });
    } else if (phase.type === "bombClear") {
      const [cx, cy] = this.cellCentre(phase.bombAt?.c ?? 0, phase.bombAt?.r ?? 0);
      this.callouts.push({ text: phase.label, x: cx, y: cy, born: now, life: 1000, hot: true });
    }
  }

  private spriteAt(r: number, c: number): Sprite | null {
    const g = this.board.grid[r]?.[c];
    return g ? this.sprites.get(g.id) ?? null : null;
  }

  private tweenFall(phase: FallPhase, now: number, dur: number): void {
    let landing = 0;
    const rich = this.motionRich();
    for (const m of phase.moves) {
      let s = this.sprites.get(m.id);
      const g = this.board.grid[m.toR]?.[m.c];
      if (!s) {
        if (!g) continue;
        s = this.makeSprite(g, m.c, m.fromR);
      }
      s.held = false;
      const y0 = m.spawned ? m.fromR : s.y;
      const y1 = m.toR;
      landing++;
      const rock = (s.seed % 2 ? 1 : -1) * 0.09;
      s.tweens.push({ start: now, dur, apply: (t, sp) => {
        sp.y = y0 + (y1 - y0) * easeInQuad(t);
        sp.x = m.c;
        sp.alpha = m.spawned ? Math.min(1, t * 3) : 1;
      }, done: (sp) => {
        sp.y = y1;
        sp.alpha = 1;
        // the squash on landing, and a small rock as it settles
        const t0 = this.now();
        sp.tweens.push({ start: t0, dur: 140, apply: (t, q) => {
          const k = Math.sin(Math.PI * t);
          q.sx = 1 + 0.12 * k;
          q.sy = 1 - 0.14 * k;
          if (rich) q.twist = rock * Math.sin(Math.PI * 2 * t) * (1 - t);
        }, done: (q) => { q.sx = 1; q.sy = 1; q.twist = 0; } });
      } });
    }
    if (landing) {
      const dummy = { start: now, dur, apply: () => {}, done: () => this.opts.hooks?.onLand?.(landing, phase.chain) } as Tween;
      // ride the landing on any one sprite so the hook fires at the frame
      const host = this.sprites.get(phase.moves[0]?.id ?? -1);
      host?.tweens.push(dummy);
    }
  }

  private spawnShards(x: number, y: number, n: number, type: StripType): void {
    const p = STONE_PALETTE[type];
    const colors = [p.base, p.base, p.dark, p.glint];
    for (let i = 0; i < n; i++) this.spawnOne(x, y, colors[i % colors.length], "shard");
    this.spawnOne(x, y, "#ffffff", "spark");
  }

  private spawnParticles(x: number, y: number, n: number, color: string, kind: Particle["kind"]): void {
    for (let i = 0; i < n; i++) this.spawnOne(x, y, color, kind);
  }

  private spawnOne(x: number, y: number, color: string, kind: Particle["kind"]): void {
    if (this.particles.length > 420) return;
    const a = Math.random() * Math.PI * 2;
    const sp = (kind === "spark" ? 40 : 90) + Math.random() * 130;
    this.particles.push({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 70,
      rot: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 14,
      age: 0, life: 380 + Math.random() * 320, color,
      size: kind === "ice" ? 2 + Math.random() * 3 : kind === "shard" ? 3 + Math.random() * 4 : 2 + Math.random() * 2.5,
      kind,
    });
  }

  // ── the frame ──────────────────────────────────────────────────────────
  private frame(t: number): void {
    const dt = this.lastFrame ? Math.min(64, t - this.lastFrame) : 16;
    this.lastFrame = t;
    this.fpsAcc++;
    if (t - this.fpsAt >= 1000) {
      this.fps = this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsAt = t;
    }
    this.update(t, dt);
    // a board out of view (between sessions, another tab) costs no painting
    if (!this.canvas.isConnected || this.canvas.clientWidth === 0) return;
    // the chrome zooms the board to fit its column: keep the backing store sharp
    if (++this.frames % 30 === 0 && Math.abs(this.pixelRatio() - this.dpr) > 0.05) this.resize();
    this.draw(t);
  }

  private update(now: number, dt: number): void {
    const rich = this.motionRich();
    const perf = this.opts.perfMode();
    const ts = this.opts.timeScale();
    for (const s of this.sprites.values()) {
      if (s.tweens.length) {
        const keep: Tween[] = [];
        for (const tw of s.tweens) {
          const t = clamp01((now - tw.start) / tw.dur);
          tw.apply(t, s);
          if (tw.marks) for (const m of tw.marks) if (!m.fired && t >= m.at) {
            m.fired = true;
            m.fire();
          }
          if (t >= 1) tw.done?.(s);
          else keep.push(tw);
        }
        // (a `done` that pushes a follow-up — the landing squash — is seen by
        // this same loop: array iteration reads the live length)
        s.tweens = keep;
      }
      if (!perf && !this.opts.reducedMotion()) {
        const strip = this.opts.getStrip(stripTypeFor(s));
        if (strip && strip.frames > 1) {
          if (s.special === "bomb" || s.special === "disco") s.angle += ((strip.fps / strip.frames) * dt * ts) / 1000;
          else if (rich && !s.tweens.length) s.angle += ((0.02 * dt * ts) / 1000) * (s.seed % 2 ? 1 : -1);
        }
      }
    }
    // particles, on the board's clock
    const scaled = dt * ts;
    for (const p of this.particles) {
      p.age += scaled;
      p.vy += 420 * (scaled / 1000);
      p.x += p.vx * (scaled / 1000);
      p.y += p.vy * (scaled / 1000);
      p.rot += p.spin * (scaled / 1000);
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    this.callouts = this.callouts.filter((c) => now - c.born < c.life);
    this.rings = this.rings.filter((r) => now - r.born < r.life);
    this.bursts = this.bursts.filter((b) => now - b.born < BURST_MS);
  }

  private draw(now: number): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    const W = this.widthCss;
    const H = this.heightCss;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const zoom = this.opts.perfMode() ? 1 : this.opts.zoom();
    ctx.save();
    if (zoom !== 1) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-W / 2, -H / 2);
    }
    if (this.opts.plate !== false) this.drawPlate(ctx, W, H);
    this.drawCells(ctx);
    // idle first, the hand's gem above, falling/dying on top; by y so overlaps read
    const inHand = (s: Sprite) => (this.opts.offsetOf?.(s.id) ? 1 : 0);
    const list = [...this.sprites.values()].sort((a, b) =>
      Number(a.dying) - Number(b.dying) || inHand(a) - inHand(b) || a.y - b.y);
    for (const s of list) this.drawSprite(ctx, s, now);
    this.drawRings(ctx, now);
    this.drawBursts(ctx, now);
    this.drawParticles(ctx);
    this.drawCallouts(ctx, now);
    ctx.restore();
  }

  private drawPlate(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#2a2724");
    g.addColorStop(1, "#171513");
    ctx.fillStyle = g;
    this.roundRect(ctx, 0, 0, W, H, 12);
    ctx.fill();
    ctx.strokeStyle = "rgba(214,168,94,0.35)";
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, 1, 1, W - 2, H - 2, 11);
    ctx.stroke();
  }

  private drawCells(ctx: CanvasRenderingContext2D): void {
    const cell = this.cell;
    const sel = this.selected;
    for (let r = 0; r < this.board.h; r++) {
      for (let c = 0; c < this.board.w; c++) {
        const x = this.pad + c * cell;
        const y = this.pad + r * cell;
        const isSel = sel?.r === r && sel?.c === c;
        const isHov = this.hover?.r === r && this.hover?.c === c;
        ctx.fillStyle = (r + c) % 2 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.12)";
        this.roundRect(ctx, x + 2, y + 2, cell - 4, cell - 4, 6);
        ctx.fill();
        if (isHov && !isSel) {
          ctx.strokeStyle = "rgba(255,226,170,0.35)";
          ctx.lineWidth = 1.5;
          this.roundRect(ctx, x + 3, y + 3, cell - 6, cell - 6, 6);
          ctx.stroke();
        }
        if (isSel) {
          ctx.strokeStyle = "#e8b95a";
          ctx.lineWidth = 2.5;
          this.roundRect(ctx, x + 3, y + 3, cell - 6, cell - 6, 7);
          ctx.stroke();
        }
      }
    }
    // the tap path names its legal answers: every open neighbour of the selection
    if (sel && this.opts.neighbours) {
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
        const n = this.board.grid[sel.r + dr]?.[sel.c + dc];
        if (!n || n.block) continue;
        this.roundRect(ctx, this.pad + (sel.c + dc) * cell + 4, this.pad + (sel.r + dr) * cell + 4, cell - 8, cell - 8, 7);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, now: number): void {
    const cell = this.cell;
    const [bx, by] = this.cellCentre(s.x, s.y);
    const off = this.opts.offsetOf?.(s.id) ?? null;
    const cx = bx + (off?.[0] ?? 0) + s.jx;
    const cy = by + (off?.[1] ?? 0);
    const perf = this.opts.perfMode();
    const rich = this.motionRich();
    const type = stripTypeFor(s);
    const strip = s.block ? null : this.opts.getStrip(type);
    const flat = !strip || strip.frames <= 1;
    // at rest a flat stone sways and breathes on its own slow clock
    const idle = rich && flat && !s.tweens.length && !s.dying && !off;
    let lean = s.twist;
    let breathe = 1;
    if (idle) {
      lean += 0.03 * Math.sin(now / 1500 + s.seed);
      breathe = 1 + 0.012 * Math.sin(now / 1900 + s.seed * 0.7);
    }
    const isSel = !s.dying && this.selected?.r === Math.round(s.y) && this.selected?.c === Math.round(s.x);
    const hovered = !s.dying && this.hover?.r === Math.round(s.y) && this.hover?.c === Math.round(s.x);
    // a hovered stone only leans a hair, side to side
    if (hovered && rich && !isSel && !off) lean += 0.035 * Math.sin(now / 140);
    const pulse = isSel && rich && !off ? 1 + 0.05 * (0.5 - 0.5 * Math.cos((now / 1600) * Math.PI * 2)) : 1;
    const lift = off ? 1.1 : 1;
    const size = cell * 0.92 * s.scale * breathe * pulse * lift;
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.translate(cx, cy);
    if (lean && !perf) ctx.rotate(lean);
    ctx.scale(s.sx, s.sy);
    if (s.block) {
      this.drawBlock(ctx, size);
      ctx.restore();
      return;
    }
    if (s.tier > 0) this.drawTokenGlow(ctx, size, s.tier);
    if (isSel) this.drawGlow(ctx, size, "rgba(255, 214, 140, 0.55)");
    else if (hovered) this.drawGlow(ctx, size, "rgba(255, 226, 170, 0.35)");
    const ice = s.hard > 0 ? (s.hard >= 2 ? strip?.ice2 : strip?.ice1) : undefined;
    const posed = s.pose ? (s.pose.kind === "boom" ? strip?.boom : strip?.wiggle)?.[s.pose.frame] : undefined;
    const lineArt = s.special === "line" ? strip?.line : undefined;
    // Owner (2026-09-28): hover plays no animation — a soft glow and a very
    // slight sway; the wiggle frames are for a stone held or dragged.
    const wiggling = !perf && rich && !ice && !lineArt && (isSel || !!off) && strip?.wiggle?.length;
    if (posed) ctx.drawImage(posed, -size / 2, -size / 2, size, size);
    else if (lineArt && !ice) ctx.drawImage(lineArt, -size / 2, -size / 2, size, size);
    else if (ice) ctx.drawImage(ice, -size / 2, -size / 2, size, size);
    else if (wiggling) ctx.drawImage(strip!.wiggle![Math.floor(now / 120) % strip!.wiggle!.length], -size / 2, -size / 2, size, size);
    else if (strip) this.blit(ctx, strip, perf ? 0 : s.angle, size);
    else drawFlatGem(ctx, type, 0, 0, size);
    if (s.special === "bomb" && rich) {
      const k = 0.5 + 0.5 * Math.sin(now / 160);
      ctx.strokeStyle = `rgba(255,140,70,${0.25 + 0.35 * k})`;
      ctx.lineWidth = 1.5 + k * 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.48 + k * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (s.hard > 0 && !ice) {
      const ice = s.hard >= 2 ? this.opts.art?.ice2 : this.opts.art?.ice1;
      if (ice) {
        const d = size * 1.08;
        ctx.drawImage(ice, -d / 2, -d / 2, d, d);
      } else this.drawFrost(ctx, size, s.hard);
    }
    if (s.tier > 0) this.drawBadge(ctx, size, s.tier);
    ctx.restore();
  }

  private blit(ctx: CanvasRenderingContext2D, strip: StoneStrip, turns: number, size: number): void {
    const img = strip.images[frameIndex(strip, turns)];
    try {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } catch {
      drawFlatGem(ctx, (strip.type as StripType) in STONE_PALETTE ? (strip.type as StripType) : "stone", 0, 0, size);
    }
  }

  private drawGlow(ctx: CanvasRenderingContext2D, size: number, color: string): void {
    const g = ctx.createRadialGradient(0, 0, size * 0.1, 0, 0, size * 0.62);
    g.addColorStop(0, color);
    g.addColorStop(1, "rgba(255, 176, 46, 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, size * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }

  /** A token carries cargo on the next match: a warm gold halo behind it. */
  private drawTokenGlow(ctx: CanvasRenderingContext2D, size: number, tier: number): void {
    this.drawGlow(ctx, size, tier >= 2 ? "rgba(255, 236, 170, 0.8)" : "rgba(255, 196, 80, 0.6)");
  }

  /** …and its grade, on a brass tab at the corner. */
  private drawBadge(ctx: CanvasRenderingContext2D, size: number, tier: number): void {
    const w = Math.max(14, size * 0.24);
    const x = size * 0.5 - w * 0.95;
    const y = -size * 0.5 + w * 0.05;
    ctx.fillStyle = tier >= 2 ? "#fff1c8" : "#f2b43a";
    ctx.strokeStyle = "rgba(20, 16, 11, 0.85)";
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, x, y, w, w, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#14100b";
    ctx.font = `800 ${Math.round(w * 0.72)}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(tier), x + w / 2, y + w / 2 + 1);
  }

  private drawFrost(ctx: CanvasRenderingContext2D, size: number, hard: number): void {
    const r = size * 0.48;
    ctx.fillStyle = hard === 2 ? "rgba(190,232,255,0.62)" : "rgba(190,232,255,0.42)";
    this.roundRect(ctx, -r, -r, r * 2, r * 2, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, -r + 1, -r + 1, r * 2 - 2, r * 2 - 2, 7);
    ctx.stroke();
    if (hard === 1) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.5);
      ctx.lineTo(-r * 0.1, 0);
      ctx.lineTo(-r * 0.3, r * 0.6);
      ctx.moveTo(-r * 0.1, 0);
      ctx.lineTo(r * 0.6, -r * 0.2);
      ctx.stroke();
    }
  }

  /** An Iron Girder: a riveted steel plate with the painted anvil on it. */
  private drawBlock(ctx: CanvasRenderingContext2D, size: number): void {
    const r = size * 0.47;
    ctx.fillStyle = "#2a3034";
    this.roundRect(ctx, -r, -r, r * 2, r * 2, 5);
    ctx.fill();
    ctx.strokeStyle = "#0f1214";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    this.roundRect(ctx, -r + 3, -r + 3, r * 2 - 6, r * 0.5, 4);
    ctx.fill();
    ctx.fillStyle = "#8d9198";
    for (const [dx, dy] of [[-0.78, -0.78], [0.78, -0.78], [-0.78, 0.78], [0.78, 0.78]]) {
      ctx.beginPath();
      ctx.arc(dx * r, dy * r, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    const art = this.opts.art?.girder;
    if (art) {
      const d = size * 0.8;
      ctx.drawImage(art, -d / 2, -d / 2, d, d);
    }
  }

  private drawBursts(ctx: CanvasRenderingContext2D, now: number): void {
    const frames = this.opts.art?.burst;
    if (!frames?.length || !this.bursts.length) return;
    const size = this.cell * 1.45;
    for (const b of this.bursts) {
      const t = (now - b.born) / BURST_MS;
      if (t < 0 || t >= 1) continue;
      const img = frames[Math.min(frames.length - 1, Math.floor(t * frames.length))];
      ctx.drawImage(img, b.x - size / 2, b.y - size / 2, size, size);
    }
  }

  private drawRings(ctx: CanvasRenderingContext2D, now: number): void {
    for (const r of this.rings) {
      const t = clamp01((now - r.born) / r.life);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = 1 - t;
      ctx.lineWidth = 6 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(r.x, r.y, 10 + easeOutCubic(t) * this.cell * 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const t = clamp01(p.age / p.life);
      ctx.globalAlpha = 1 - t * t;
      ctx.fillStyle = p.color;
      if (p.kind === "shard") {
        const s = p.size * (1 - t * 0.35);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -s);
        ctx.lineTo(s * 0.8, s * 0.6);
        ctx.lineTo(-s * 0.7, s * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (p.kind === "ice") {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * 1.6);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawCallouts(ctx: CanvasRenderingContext2D, now: number): void {
    for (const c of this.callouts) {
      const t = clamp01((now - c.born) / c.life);
      const rise = easeOutCubic(t) * 34;
      const pop = t < 0.15 ? easeOutBack(t / 0.15) : 1;
      ctx.save();
      ctx.globalAlpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      ctx.translate(c.x, c.y - rise);
      ctx.scale(pop, pop);
      ctx.font = `800 ${c.hot ? 22 : 17}px "Barlow Semi Condensed", "Arial Narrow", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(0,0,0,0.85)";
      ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = c.hot ? "#ffc857" : "#f6ead2";
      ctx.fillText(c.text, 0, 0);
      ctx.restore();
    }
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
