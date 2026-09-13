// ══════════════════════════════════════════════════════════════════════════
// PLACEMENT OVERLAY (vector) — the building highlight, drawn as geometry.
//
// This is the overlay the player stares at every time they place something,
// and it used to be four pre-rendered PNG cells in the atlas (`highlight`,
// `highlight_bad`, `highlight_soft`, `node_mark`) blitted tile by tile. That
// had three costs the vector version does not:
//
//   1. SEAMS. Every tile blitted its own full diamond outline, so a 3×3 plant
//      footprint read as nine boxes rather than one site. The outline here is
//      the boundary of the whole tile SET (`boundaryLoops`), so interior
//      edges simply do not exist.
//   2. RESOLUTION. A sprite is painted once at 0.5×/1×/2× and cannot be
//      thinner than the pixel grid it was baked on. These are strokes, so the
//      line weight, the dash period and the corner brackets are chosen in
//      device pixels and stay crisp at every zoom and every DPR.
//   3. NO VOLUME. A flat diamond cannot say "a building goes HERE". The ghost
//      pass draws the actual sprite that the click would place — the same
//      atlas cell, the same anchor, the same footprint — tinted and
//      translucent, standing on a light pool clipped to its own footprint.
//
// The atlas cells stay packed: like the road sprites, they are the rollback
// (`__iso.highlightMode('sprites')`) and the pixel tests still pin them. Only
// the default draw path changed.
//
// Everything here is pure painting: no game state, no atlas mutation. The
// renderer owns one `PlacementOverlay` and hands it the scene; the scene is
// derived from the SAME overlay items the game already computed, so the
// vector overlay can never disagree with the placement rules — it is another
// view of the same list, not a second opinion.
// ══════════════════════════════════════════════════════════════════════════
import { tileToScreen } from "../game/config";
import { worldToScreen, type Camera } from "./camera";
import type { Atlas } from "./atlas";
import { place, type DrawItem } from "./depth";

type Ctx2D = CanvasRenderingContext2D;
type Surface = HTMLCanvasElement | OffscreenCanvas;

/** A tile coordinate pair. */
export type Tile = readonly [number, number];

/**
 * What a highlighted tile MEANS. The overlay items the game emits still carry
 * their historical sprite names (the placement plans, the unit tests and the
 * multiplayer-free debug surface all speak them); this table is the one place
 * that translates a name into a role, so the art and the rules stay decoupled.
 */
export type OverlayRole = "footprint" | "blocked" | "reach" | "node";

export const OVERLAY_ROLE_BY_SPRITE: Readonly<Record<string, OverlayRole>> = {
  highlight: "footprint",
  highlight_bad: "blocked",
  highlight_soft: "reach",
  node_mark: "node",
};

/** The role an overlay sprite name paints as, or null when it is not one. */
export const overlayRoleOf = (sprite: string): OverlayRole | null =>
  OVERLAY_ROLE_BY_SPRITE[sprite] ?? null;

/** True when the overlay sprite is painted by this module, not blitted. */
export const isVectorOverlaySprite = (sprite: string): boolean =>
  overlayRoleOf(sprite) !== null;

// ── palette ────────────────────────────────────────────────────────────────
/** One hue family: outline ink, fill, and the two ghost tints. */
export interface OverlayTone {
  ink: string;
  fill: string;
  /** The ghost's body tint. */
  tint: string;
  /** The light pool the ghost stands on. */
  glow: string;
}

export interface OverlayStyle {
  valid: OverlayTone;
  bad: OverlayTone;
  reach: OverlayTone;
  node: OverlayTone;
  /** Footprint fill alpha, top → bottom of the gradient (a lit floor, not a flat wash). */
  fillTop: number;
  fillBottom: number;
  /** Footprint outline alpha at the peak of the breathing pulse. */
  inkAlpha: number;
  /** Reach band: fill alpha and the marching-ants outline alpha. */
  reachFill: number;
  reachInk: number;
  /** Node tag bracket alpha. */
  nodeInk: number;
  /** Refusal hatch: line alpha and spacing in world pixels. */
  hatchAlpha: number;
  hatchGap: number;
  /** Ghost: body alpha, the bob amplitude in world pixels, and the pool's peak alpha. */
  ghostAlpha: number;
  ghostBob: number;
  poolAlpha: number;
}

/**
 * The theme's own metals, read off the noir HUD (`src/game/styles.css`):
 * lamp-amber `--gold` for a legal site, `--danger2` for a refused one, brass
 * for the informational catchment, parchment for a node tag. Nothing here is
 * a new colour — the overlay is part of the same chrome as the panels.
 */
export const DEFAULT_OVERLAY_STYLE: OverlayStyle = {
  valid: { ink: "#ffd98a", fill: "#ffb02e", tint: "#ffd98a", glow: "#ffb02e" },
  bad: { ink: "#e2704f", fill: "#b23a26", tint: "#e2704f", glow: "#b23a26" },
  reach: { ink: "#c9a24a", fill: "#c9a24a", tint: "#c9a24a", glow: "#c9a24a" },
  node: { ink: "#f2dca6", fill: "#f2dca6", tint: "#f2dca6", glow: "#f2dca6" },
  fillTop: 0.30,
  fillBottom: 0.11,
  inkAlpha: 0.92,
  reachFill: 0.10,
  reachInk: 0.42,
  nodeInk: 0.78,
  hatchAlpha: 0.16,
  hatchGap: 7,
  ghostAlpha: 0.52,
  ghostBob: 1.8,
  poolAlpha: 0.30,
};

/** `#rrggbb` + alpha → `rgba()`. Keeps every colour in one notation. */
export function rgba(hex: string, alpha: number): string {
  const v = parseInt(hex.slice(1), 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

// ── geometry: the boundary of a tile set ────────────────────────────────────
/**
 * A closed ring of tile-CORNER coordinates (the lattice `tileToScreen` maps),
 * wound so the interior is on the left of each directed edge.
 */
export interface BoundaryLoop {
  corners: [number, number][];
}

const keyOf = (x: number, y: number) => `${x},${y}`;

/**
 * The four directed boundary edges of one tile, in tile-corner coordinates.
 *
 * Tile (tx,ty)'s diamond has its TOP vertex at corner (tx,ty), its right at
 * (tx+1,ty), bottom at (tx+1,ty+1) and left at (tx,ty+1) — see the projection
 * note at the top of `src/game/config.ts`. Each edge below is paired with the
 * neighbour that would hide it: an edge is only part of the outline when that
 * neighbour is not in the set. Walking top→right→bottom→left keeps every
 * loop consistently wound, which is what lets one path fill the union of any
 * shape without a single interior seam.
 */
const EDGES: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 0],   // NE edge (tx,ty)→(tx+1,ty),     hidden by tile (tx, ty-1)
  [1, 0, 1],    // SE edge (tx+1,ty)→(tx+1,ty+1), hidden by tile (tx+1, ty)
  [0, 1, 2],    // SW edge (tx+1,ty+1)→(tx,ty+1), hidden by tile (tx, ty+1)
  [-1, 0, 3],   // NW edge (tx,ty+1)→(tx,ty),     hidden by tile (tx-1, ty)
];

/**
 * The outline of a set of tiles as closed corner loops.
 *
 * This is the whole point of drawing the grid instead of blitting it: a 3×3
 * footprint comes back as ONE four-corner loop, so the site reads as one
 * place. Adjacent tiles merge; a diagonal-only touch (two tiles meeting at a
 * single corner) stays two loops, which is correct — nothing connects them.
 */
export function boundaryLoops(tiles: Iterable<Tile>): BoundaryLoop[] {
  // Deduplicated: a tile the caller listed twice would otherwise emit its
  // four edges twice and come back as two coincident loops.
  const set = new Set<string>();
  const list: [number, number][] = [];
  for (const [x, y] of tiles) {
    const k = keyOf(x, y);
    if (set.has(k)) continue;
    set.add(k);
    list.push([x, y]);
  }
  // start corner → the boundary edges leaving it. A list, not a slot: at a
  // diagonal pinch point two loops share one corner.
  const outgoing = new Map<string, [number, number][]>();
  const push = (x: number, y: number, to: [number, number]) => {
    const k = keyOf(x, y);
    const at = outgoing.get(k);
    if (at) at.push(to); else outgoing.set(k, [to]);
  };
  for (const [x, y] of list) {
    for (const [dx, dy, edge] of EDGES) {
      if (set.has(keyOf(x + dx, y + dy))) continue;
      const from: [number, number] = edge === 0 ? [x, y]
        : edge === 1 ? [x + 1, y]
          : edge === 2 ? [x + 1, y + 1]
            : [x, y + 1];
      const to: [number, number] = edge === 0 ? [x + 1, y]
        : edge === 1 ? [x + 1, y + 1]
          : edge === 2 ? [x, y + 1]
            : [x, y];
      push(from[0], from[1], to);
    }
  }
  const loops: BoundaryLoop[] = [];
  for (const [startKey, edges] of outgoing) {
    while (edges.length) {
      const corners: [number, number][] = [];
      const [sx, sy] = startKey.split(",").map(Number) as [number, number];
      let cx = sx, cy = sy;
      // Walk until the chain closes. `edges.shift()` consumes, so a corner
      // shared by two loops is entered once by each.
      for (;;) {
        corners.push([cx, cy]);
        const list = outgoing.get(keyOf(cx, cy));
        const next = list?.shift();
        if (!next) break;                  // open chain — cannot happen on a closed set
        [cx, cy] = next;
        if (cx === sx && cy === sy) break;
      }
      const simple = simplifyLoop(corners);
      if (simple.length > 2) loops.push({ corners: simple });
    }
  }
  return loops;
}

/**
 * Drop the corners that are not corners.
 *
 * The walk above follows tile edges, so a straight run of three tiles
 * contributes three collinear vertices along one side of the outline. The
 * shape is already right; the vertices are not — and the corner brackets are
 * drawn AT them, so a 3×3 site would grow a bracket at every tile join
 * instead of four at its corners. Corner-space is an integer lattice and the
 * edges are axis-aligned, so "turns" are exact: keep a vertex only when its
 * direction changes.
 */
export function simplifyLoop(corners: readonly [number, number][]): [number, number][] {
  const n = corners.length;
  if (n < 3) return [...corners];
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = corners[(i - 1 + n) % n];
    const [cx, cy] = corners[i];
    const [nx, ny] = corners[(i + 1) % n];
    // incoming and outgoing directions; a vertex is a corner iff they differ.
    const inX = Math.sign(cx - px), inY = Math.sign(cy - py);
    const outX = Math.sign(nx - cx), outY = Math.sign(ny - cy);
    if (inX !== outX || inY !== outY) out.push([cx, cy]);
  }
  return out.length >= 3 ? out : [...corners];
}

/** The single-tile loop of one tile (a node tag brackets each tile alone). */
export function tileLoop(tx: number, ty: number): BoundaryLoop {
  return { corners: [[tx, ty], [tx + 1, ty], [tx + 1, ty + 1], [tx, ty + 1]] };
}

/** Screen-space bounding box of a set of loops, for gradients and clipping. */
export function loopsBounds(
  cam: Camera, loops: readonly BoundaryLoop[],
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const loop of loops) {
    for (const [cx, cy] of loop.corners) {
      const [wx, wy] = tileToScreen(cx, cy);
      const [sx, sy] = worldToScreen(cam, wx, wy);
      if (sx < x0) x0 = sx;
      if (sy < y0) y0 = sy;
      if (sx > x1) x1 = sx;
      if (sy > y1) y1 = sy;
    }
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
}

// ── the scene ───────────────────────────────────────────────────────────────
/** The tiles to paint, by role. Built from the game's overlay items. */
export interface OverlayScene {
  footprint: Tile[];
  blocked: Tile[];
  reach: Tile[];
  nodes: Tile[];
}

/**
 * The transparent building preview: the exact sprite the click would place,
 * standing on the footprint it would occupy. `valid` picks the tint — a
 * refused site shows the same building in the refusal hue, which is the whole
 * answer to "why won't it let me" without reading a line of text.
 */
export interface GhostSpec {
  sprite: string;
  tx: number;
  ty: number;
  valid: boolean;
}

export const emptyScene = (): OverlayScene =>
  ({ footprint: [], blocked: [], reach: [], nodes: [] });

const SCENE_KEY: Record<OverlayRole, "footprint" | "blocked" | "reach" | "nodes"> = {
  footprint: "footprint", blocked: "blocked", reach: "reach", node: "nodes",
};

/**
 * Split an overlay item list into the vector scene and the leftovers.
 *
 * Duplicates collapse (a tile listed twice must not double-blend its fill),
 * and anything that is not one of the four overlay roles is handed back
 * untouched so the renderer blits it exactly as before.
 */
export function sceneFromItems(items: readonly DrawItem[]): {
  scene: OverlayScene; rest: DrawItem[];
} {
  const scene = emptyScene();
  const rest: DrawItem[] = [];
  const seen: Record<OverlayRole, Set<string>> = {
    footprint: new Set(), blocked: new Set(), reach: new Set(), node: new Set(),
  };
  for (const item of items) {
    const role = overlayRoleOf(item.sprite);
    if (!role) { rest.push(item); continue; }
    const k = keyOf(item.tx, item.ty);
    if (seen[role].has(k)) continue;
    seen[role].add(k);
    scene[SCENE_KEY[role]].push([item.tx, item.ty]);
  }
  return { scene, rest };
}

/** Tiles of `a` that are not in `b` — the reach band never paints under a footprint. */
function subtract(a: readonly Tile[], b: readonly Tile[]): Tile[] {
  if (!b.length) return [...a];
  const drop = new Set(b.map(([x, y]) => keyOf(x, y)));
  return a.filter(([x, y]) => !drop.has(keyOf(x, y)));
}

// ── the painter ─────────────────────────────────────────────────────────────
/** What the last `paint()` actually drew — surfaced through `__iso.rendering()`. */
export interface OverlayStats {
  mode: "vector";
  footprint: number;
  blocked: number;
  reach: number;
  nodes: number;
  /** Boundary loops stroked (1 for a rectangular footprint, however many tiles). */
  loops: number;
  /** The ghost sprite name, or null when no building preview was armed. */
  ghost: string | null;
  /** False when the ghost had no art to draw (unloaded sprite, test stub). */
  ghostDrawn: boolean;
}

interface GhostArt {
  image: Surface;
  /** Size of the tinted surface — the SAMPLED zoom's sprite rect. */
  w: number;
  h: number;
  /**
   * GFX-01: the destination rect at the CAMERA zoom. Equal to w/h at High
   * (and whenever the sampled zoom is not below the camera's), larger when a
   * quality cap stretched coarser art — the same contract the structures blit
   * keeps, so a ghost preview sits exactly where the real building will.
   */
  dw: number;
  dh: number;
}

/** Line weight in DEVICE pixels for a world-pixel weight at this zoom. */
const strokePx = (z: number, weight: number) =>
  Math.max(1, weight * Math.min(2, Math.max(0.55, Math.sqrt(z))));

/**
 * The vector placement overlay.
 *
 * One instance per renderer. The only thing it holds is the ghost cache — a
 * tinted copy of each preview sprite per zoom — because tinting is a
 * composite pass over the sprite's alpha and doing it sixty times a second
 * for one hover would be the most expensive thing on the overlay layer.
 */
export class PlacementOverlay {
  style: OverlayStyle = DEFAULT_OVERLAY_STYLE;
  /**
   * QoL: honour the OS "reduce motion" setting. The pulse, the marching reach
   * band and the ghost's bob are all decoration; with this on they freeze at
   * their resting value and every static property (colour, shape, position)
   * is unchanged. Wired from `matchMedia` in game.ts.
   */
  reducedMotion = false;

  private ghosts = new Map<string, GhostArt | null>();
  private last: OverlayStats | null = null;

  /** The last frame's paint facts, for `__iso.rendering()`. */
  get stats(): OverlayStats | null { return this.last; }

  /** Drop the cached ghost art (a zoom change re-keys it anyway; this is for tests). */
  clearCache(): void { this.ghosts.clear(); }

  paint(
    ctx: Ctx2D,
    cam: Camera,
    atlas: Atlas,
    scene: OverlayScene,
    ghost: GhostSpec | null,
    timeMs: number,
    makeSurface: (w: number, h: number) => Surface | null,
  ): OverlayStats {
    const s = this.style;
    // A frozen clock is the whole reduced-motion implementation: every
    // animation below is a pure function of `t`.
    const t = this.reducedMotion ? 0 : timeMs;
    const breathe = this.reducedMotion ? 1 : 0.93 + 0.07 * Math.sin(t / 420);

    const solid = scene.footprint;
    const blocked = scene.blocked;
    const reach = subtract(scene.reach, [...solid, ...blocked]);
    const nodes = scene.nodes;

    const solidLoops = boundaryLoops(solid);
    const blockedLoops = boundaryLoops(blocked);
    const reachLoops = boundaryLoops(reach);

    // 1. The reach band: the informational area (a Depot's catchment, a
    //    Factory's town-adjacency ring). Faintest thing on the layer, and the
    //    only dashed one — dashes read as "extent", a solid line reads as "edge".
    if (reachLoops.length) {
      this.paintReach(ctx, cam, reachLoops, t);
    }
    // 2. The footprint: where the building will actually stand.
    if (solidLoops.length) this.paintSite(ctx, cam, solidLoops, s.valid, breathe, false);
    // 3. Refused tiles: same outline language, red, hatched.
    if (blockedLoops.length) this.paintSite(ctx, cam, blockedLoops, s.bad, breathe, true);
    // 4. Node tags: the tiles a placement qualifies or catches. Brackets only —
    //    a tag must never read as a tile you are about to build on.
    if (nodes.length) this.paintNodes(ctx, cam, nodes);
    // 5. The ghost building, last: it is the thing being placed, so it sits
    //    above the grid that describes it and below the debug marks.
    const ghostDrawn = ghost
      ? this.paintGhost(ctx, cam, atlas, ghost, solidLoops, t, makeSurface)
      : false;

    this.last = {
      mode: "vector",
      footprint: solid.length, blocked: blocked.length,
      reach: reach.length, nodes: nodes.length,
      loops: solidLoops.length + blockedLoops.length + reachLoops.length,
      ghost: ghost?.sprite ?? null,
      ghostDrawn,
    };
    return this.last;
  }

  // ── individual passes ───────────────────────────────────────────────────
  /** Trace every loop into the current path (no beginPath — the caller owns it). */
  private trace(ctx: Ctx2D, cam: Camera, loops: readonly BoundaryLoop[]): void {
    for (const loop of loops) {
      const [x0, y0] = this.corner(cam, loop.corners[0]);
      ctx.moveTo(x0, y0);
      for (let i = 1; i < loop.corners.length; i++) {
        const [x, y] = this.corner(cam, loop.corners[i]);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
  }

  /** Screen position of a tile-corner lattice point. */
  private corner(cam: Camera, c: readonly [number, number]): [number, number] {
    const [wx, wy] = tileToScreen(c[0], c[1]);
    return worldToScreen(cam, wx, wy);
  }

  private paintReach(
    ctx: Ctx2D, cam: Camera, loops: readonly BoundaryLoop[], t: number,
  ): void {
    const s = this.style;
    ctx.save();
    ctx.beginPath();
    this.trace(ctx, cam, loops);
    ctx.fillStyle = rgba(s.reach.fill, s.reachFill);
    ctx.fill();
    // Marching ants, slow enough to be ambient rather than urgent.
    const z = cam.zoom;
    const dash = 6 * Math.max(0.6, z);
    ctx.setLineDash([dash, dash * 1.4]);
    ctx.lineDashOffset = -(t / 26) % (dash * 2.4);
    ctx.lineWidth = strokePx(z, 1);
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(s.reach.ink, s.reachInk);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A site: one gradient fill over the whole union, one outline around it, and
   * a brighter bracket at every corner. `hatch` adds the refusal stripes.
   */
  private paintSite(
    ctx: Ctx2D, cam: Camera, loops: readonly BoundaryLoop[],
    tone: OverlayTone, breathe: number, hatch: boolean,
  ): void {
    const s = this.style;
    const z = cam.zoom;
    const b = loopsBounds(cam, loops);
    if (!b) return;
    ctx.save();
    ctx.beginPath();
    this.trace(ctx, cam, loops);
    // Lit from the north: the same gradient the HUD's plates use, so the site
    // reads as a floor with a lamp over it rather than a sticker.
    const grad = ctx.createLinearGradient(0, b.y0, 0, b.y1);
    grad.addColorStop(0, rgba(tone.fill, s.fillTop * breathe));
    grad.addColorStop(1, rgba(tone.fill, s.fillBottom * breathe));
    ctx.fillStyle = grad;
    ctx.fill();
    if (hatch) {
      // 45° stripes, clipped to the site. Sparse on purpose: this is a
      // "refused" stamp, not a warning sign.
      ctx.save();
      ctx.clip();
      ctx.lineWidth = strokePx(z, 1);
      ctx.strokeStyle = rgba(tone.ink, s.hatchAlpha * 1.6);
      const gap = s.hatchGap * Math.max(0.6, z);
      const span = b.y1 - b.y0;
      ctx.beginPath();
      for (let x = b.x0 - span; x < b.x1; x += gap) {
        ctx.moveTo(x, b.y1);
        ctx.lineTo(x + span, b.y0);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    this.trace(ctx, cam, loops);
    ctx.lineJoin = "round";
    ctx.lineWidth = strokePx(z, 1.6);
    ctx.strokeStyle = rgba(tone.ink, s.inkAlpha * breathe);
    ctx.stroke();
    ctx.restore();
    // Corner brackets on top of the outline: short, brighter, and the single
    // detail that makes the site read as a surveyor's mark instead of a decal.
    this.brackets(ctx, cam, loops, {
      color: rgba(tone.ink, Math.min(1, s.inkAlpha * breathe + 0.06)),
      width: strokePx(z, 2.1),
      arm: 0.3,
    });
  }

  /** Node tags: four inset brackets per tile, no fill. */
  private paintNodes(ctx: Ctx2D, cam: Camera, nodes: readonly Tile[]): void {
    const s = this.style;
    this.brackets(ctx, cam, nodes.map(([tx, ty]) => tileLoop(tx, ty)), {
      color: rgba(s.node.ink, s.nodeInk),
      width: strokePx(cam.zoom, 1.3),
      arm: 0.34,
    });
  }

  /**
   * Corner brackets: at each loop vertex, a short bright run down both edges.
   * `arm` is the fraction of each edge the bracket covers.
   */
  private brackets(
    ctx: Ctx2D, cam: Camera, loops: readonly BoundaryLoop[],
    opts: { color: string; width: number; arm: number },
  ): void {
    ctx.save();
    ctx.beginPath();
    for (const loop of loops) {
      const n = loop.corners.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const [px, py] = this.corner(cam, loop.corners[i]);
        const [ax, ay] = this.corner(cam, loop.corners[(i - 1 + n) % n]);
        const [bx, by] = this.corner(cam, loop.corners[(i + 1) % n]);
        ctx.moveTo(px + (ax - px) * opts.arm, py + (ay - py) * opts.arm);
        ctx.lineTo(px, py);
        ctx.lineTo(px + (bx - px) * opts.arm, py + (by - py) * opts.arm);
      }
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = opts.width;
    ctx.strokeStyle = opts.color;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The transparent building preview.
   *
   * The sprite is placed by `place()` — the same call the structures pass
   * uses — so the ghost's foot lands exactly where the real building's will,
   * on the same anchor and the same footprint. It is tinted once per
   * (sprite, zoom, verdict) and then blitted translucent, standing on a light
   * pool CLIPPED to the footprint: a soft glow that could bleed past the site
   * would tint neighbouring tiles and lie about the footprint's size.
   */
  private paintGhost(
    ctx: Ctx2D, cam: Camera, atlas: Atlas, ghost: GhostSpec,
    siteLoops: readonly BoundaryLoop[], t: number,
    makeSurface: (w: number, h: number) => Surface | null,
  ): boolean {
    const s = this.style;
    const z = cam.zoom;
    const tone = ghost.valid ? s.valid : s.bad;
    const placed = place(atlas, { sprite: ghost.sprite, tx: ghost.tx, ty: ghost.ty });
    if (!placed) return false;
    const b = siteLoops.length ? loopsBounds(cam, siteLoops) : null;
    if (b) {
      // The light pool: the ground the building will occupy, lit from below.
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const r = Math.max(1, Math.max(b.x1 - b.x0, b.y1 - b.y0) * 0.62);
      ctx.save();
      ctx.beginPath();
      this.trace(ctx, cam, siteLoops);
      ctx.clip();
      const pool = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      pool.addColorStop(0, rgba(tone.glow, s.poolAlpha));
      pool.addColorStop(1, rgba(tone.glow, 0));
      ctx.fillStyle = pool;
      ctx.fillRect(b.x0 - 1, b.y0 - 1, b.x1 - b.x0 + 2, b.y1 - b.y0 + 2);
      ctx.restore();
    }
    const art = this.ghostArt(atlas, ghost.sprite, z, ghost.valid, makeSurface);
    if (!art) return false;   // tinted copy unavailable (art loading) — the pool alone still previews
    // A legal ghost breathes and floats a pixel or two; a refused one sits
    // still — movement is the reward, stillness is the refusal.
    const bob = ghost.valid && !this.reducedMotion
      ? Math.sin(t / 780) * s.ghostBob * z
      : 0;
    const alpha = ghost.valid
      ? s.ghostAlpha + (this.reducedMotion ? 0 : 0.06 * Math.sin(t / 780 + 1))
      : s.ghostAlpha * 0.82;
    const [sx, sy] = worldToScreen(cam, placed.wx, placed.wy);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(
      art.image as unknown as CanvasImageSource,
      Math.floor(sx), Math.floor(sy - bob),
      art.dw, art.dh,
    );
    ctx.restore();
    return true;
  }

  /**
   * A tinted copy of `sprite` at zoom `z`, cached. The tint is laid over the
   * sprite's own alpha (`source-atop`) as a top-down gradient, so the art
   * still reads — chimneys, roofs, wheels — while the whole thing takes the
   * verdict's hue.
   *
   * GFX-01: the key carries the SAMPLED zoom as well as the camera's, so a
   * quality change at runtime (which calls `clearCache()`) and a zoom change
   * both rebuild the surface instead of serving a stale texel density.
   */
  private ghostArt(
    atlas: Atlas, sprite: string, z: number, valid: boolean,
    makeSurface: (w: number, h: number) => Surface | null,
  ): GhostArt | null {
    const az = atlas.atlasZoomFor(z);
    const key = `${sprite}|${z}|${az}|${valid ? "ok" : "bad"}`;
    if (this.ghosts.has(key)) return this.ghosts.get(key) ?? null;
    const built = this.buildGhostArt(atlas, sprite, z, az, valid, makeSurface);
    this.ghosts.set(key, built);
    return built;
  }

  private buildGhostArt(
    atlas: Atlas, sprite: string, z: number, az: number, valid: boolean,
    makeSurface: (w: number, h: number) => Surface | null,
  ): GhostArt | null {
    const def = atlas.get(sprite);
    const img = atlas.imageForSprite(sprite, z);
    if (!def || !img) return null;
    // The packer rounds both position and size per zoom; never scale a 1× rect.
    const src = atlas.zoomFrameRect(def, 0, az);
    const dst = az === z ? src : atlas.zoomFrameRect(def, 0, z);
    if (src.w < 1 || src.h < 1) return null;
    const surf = makeSurface(src.w, src.h);
    if (!surf) return null;
    const ctx = (surf as HTMLCanvasElement).getContext("2d") as Ctx2D | null;
    if (!ctx) return null;
    const tone = valid ? this.style.valid : this.style.bad;
    ctx.clearRect(0, 0, src.w, src.h);
    ctx.drawImage(
      img as unknown as CanvasImageSource,
      src.x, src.y, src.w, src.h, 0, 0, src.w, src.h,
    );
    // Tint only where the sprite is opaque.
    ctx.globalCompositeOperation = "source-atop";
    const grad = ctx.createLinearGradient(0, 0, 0, src.h);
    grad.addColorStop(0, rgba(tone.tint, 0.72));
    grad.addColorStop(0.55, rgba(tone.fill, 0.46));
    grad.addColorStop(1, rgba(tone.fill, 0.30));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, src.w, src.h);
    ctx.globalCompositeOperation = "source-over";
    return { image: surf, w: src.w, h: src.h, dw: dst.w, dh: dst.h };
  }
}
