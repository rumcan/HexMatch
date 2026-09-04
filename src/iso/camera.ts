// ══════════════════════════════════════════════════════════════════════════
// E4 — Camera: translate + discrete scale.
//
// An isometric camera is a pan (camX/camY, in device pixels) plus one of the
// three fixed zoom steps (0.5/1/2). There is no projection maths in the pan
// path and no per-frame drawImage scaling: the atlas is pre-rendered at each
// zoom, so a zoom change is an atlas swap plus a camera fixup.
//
// World space = the 1× isometric projection of the grid (tileToScreen).
// Screen space = device pixels inside the canvas:
//
//     screen = world * zoom + cam
//     world  = (screen - cam) / zoom
//
// Everything here is pure so the acceptance criteria (anchored zoom, clamp,
// pointer promotion) are unit-testable without a DOM.
// ══════════════════════════════════════════════════════════════════════════
import {
  HW, HH, MAP_W, MAP_H, ZOOM_STEPS, tileToScreen, screenToTile, type Zoom,
} from "../game/config";

export interface Camera {
  x: number;        // device-pixel translation
  y: number;
  zoom: Zoom;
  vw: number;       // viewport size in device pixels
  vh: number;
}

export const createCamera = (vw = 800, vh = 600): Camera => ({
  x: vw / 2, y: vh / 2, zoom: 1, vw, vh,
});

// ── space conversions ─────────────────────────────────────────────────────
export const worldToScreen = (c: Camera, wx: number, wy: number): [number, number] =>
  [wx * c.zoom + c.x, wy * c.zoom + c.y];

export const screenToWorld = (c: Camera, sx: number, sy: number): [number, number] =>
  [(sx - c.x) / c.zoom, (sy - c.y) / c.zoom];

/** Flat pick (stage 1): screen pixel → tile. Fractional tiles are floored. */
export function screenToTileAt(c: Camera, sx: number, sy: number): [number, number] {
  const [wx, wy] = screenToWorld(c, sx, sy);
  return screenToTile(wx, wy);
}

/** Screen position of the TOP vertex of tile (tx,ty). */
export function tileToScreenAt(c: Camera, tx: number, ty: number): [number, number] {
  const [wx, wy] = tileToScreen(tx, ty);
  return worldToScreen(c, wx, wy);
}

// ── zoom ──────────────────────────────────────────────────────────────────
export const zoomIndex = (z: Zoom) => ZOOM_STEPS.indexOf(z);

export function stepZoom(z: Zoom, dir: number): Zoom {
  const i = zoomIndex(z) + Math.sign(dir);
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i))];
}

/**
 * Zoom anchored to a screen point (pinch midpoint / wheel cursor). The world
 * point under the anchor must project back to the same screen pixel after the
 * zoom change — otherwise the map slides out from under the fingers.
 */
export function zoomAt(c: Camera, z: Zoom, sx: number, sy: number): Camera {
  const [wx, wy] = screenToWorld(c, sx, sy);
  const next: Camera = { ...c, zoom: z };
  next.x = sx - wx * z;
  next.y = sy - wy * z;
  return clampCamera(next);
}

export const zoomStepAt = (c: Camera, dir: number, sx: number, sy: number): Camera =>
  zoomAt(c, stepZoom(c.zoom, dir), sx, sy);

// ── panning + clamping ────────────────────────────────────────────────────
/** Axis-aligned bounds of the whole map diamond in world space. */
export function mapWorldBounds(): { minX: number; minY: number; maxX: number; maxY: number } {
  // corners: (0,0) top, (MAP_W,0) right, (MAP_W,MAP_H) bottom, (0,MAP_H) left
  return {
    minX: -MAP_H * HW,
    maxX: MAP_W * HW,
    minY: 0,
    maxY: (MAP_W + MAP_H) * HH,
  };
}

/**
 * Clamp so the map's bounding diamond always intersects the viewport: at least
 * one map edge stays on screen, in both axes.
 */
export function clampCamera(c: Camera): Camera {
  const b = mapWorldBounds();
  const z = c.zoom;
  const left = b.minX * z, right = b.maxX * z;
  const top = b.minY * z, bottom = b.maxY * z;
  // screen x of map left edge = left + camX; require left+camX <= vw and
  // right+camX >= 0  →  -right <= camX <= vw - left
  const x = Math.max(-right, Math.min(c.vw - left, c.x));
  const y = Math.max(-bottom, Math.min(c.vh - top, c.y));
  return { ...c, x, y };
}

export const panBy = (c: Camera, dx: number, dy: number): Camera =>
  clampCamera({ ...c, x: c.x + dx, y: c.y + dy });

/** Centre the camera on a tile (recentre button). */
export function centerOnTile(c: Camera, tx: number, ty: number): Camera {
  const [wx, wy] = tileToScreen(tx, ty);
  return clampCamera({ ...c, x: c.vw / 2 - wx * c.zoom, y: c.vh / 2 - wy * c.zoom });
}

export const centerOnMap = (c: Camera): Camera =>
  centerOnTile(c, MAP_W / 2, MAP_H / 2);

export function resizeCamera(c: Camera, vw: number, vh: number): Camera {
  return clampCamera({ ...c, vw, vh });
}

// ── viewport culling ──────────────────────────────────────────────────────
export interface TileRange { x0: number; y0: number; x1: number; y1: number; }

/**
 * Tile-space bounding box of the viewport. The four screen corners are
 * converted with screenToTile and the bbox padded by `pad` tiles to account
 * for the largest footprint plus sprite height in tiles (a 3×3 mine 192px
 * tall reaches ~6 tiles up the screen).
 */
export function visibleTileRange(c: Camera, pad = 8): TileRange {
  const corners: [number, number][] = [
    screenToTileAt(c, 0, 0),
    screenToTileAt(c, c.vw, 0),
    screenToTileAt(c, 0, c.vh),
    screenToTileAt(c, c.vw, c.vh),
  ];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [tx, ty] of corners) {
    x0 = Math.min(x0, tx); x1 = Math.max(x1, tx);
    y0 = Math.min(y0, ty); y1 = Math.max(y1, ty);
  }
  return {
    x0: Math.max(0, x0 - pad),
    y0: Math.max(0, y0 - pad),
    x1: Math.min(MAP_W - 1, x1 + pad),
    y1: Math.min(MAP_H - 1, y1 + pad),
  };
}

// ── multi-pointer gesture state machine ───────────────────────────────────
// One finger pans; two fingers pinch-zoom anchored at the midpoint; lifting
// one finger of a pinch PROMOTES the survivor to the pan pointer and re-seeds
// its last position, so there is no snap and no dead finger.
//
// TK-001: on a MOUSE, panning is bound to the MIDDLE button only — the left
// button is reserved exclusively for building placement (a left-drag must
// never scroll the map out from under a placement). Touch and pen keep the
// one-finger pan and the two-finger pinch: there is no middle button there.
export interface Pointer { id: number; x: number; y: number; }

/** Middle mouse button (the TK-001 pan binding). */
export const PAN_BUTTON = 1;

/**
 * May this pointerdown start/hold the pan gesture?
 *   mouse     — the middle button only (TK-001); left is placement-only.
 *   touch/pen — always (one finger pans, two pinch).
 */
export function isPanButton(pointerType: string, button: number): boolean {
  if (pointerType === "mouse") return button === PAN_BUTTON;
  return true;
}

export interface GestureState {
  pointers: Pointer[];
  panId: number | null;
  lastX: number;
  lastY: number;
  pinchDist: number;   // 0 when not pinching
}

export const createGesture = (): GestureState => ({
  pointers: [], panId: null, lastX: 0, lastY: 0, pinchDist: 0,
});

const dist = (a: Pointer, b: Pointer) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Pointer, b: Pointer): [number, number] =>
  [(a.x + b.x) / 2, (a.y + b.y) / 2];

export function pointerDown(g: GestureState, p: Pointer): GestureState {
  const pointers = [...g.pointers.filter((q) => q.id !== p.id), p];
  if (pointers.length >= 2) {
    const [a, b] = pointers;
    return { ...g, pointers, panId: null, pinchDist: dist(a, b) };
  }
  return { ...g, pointers, panId: p.id, lastX: p.x, lastY: p.y, pinchDist: 0 };
}

/** Returns the updated gesture plus the camera it implies. */
export function pointerMove(
  g: GestureState, p: Pointer, cam: Camera,
): { gesture: GestureState; cam: Camera } {
  const pointers = g.pointers.map((q) => (q.id === p.id ? p : q));
  if (pointers.length >= 2) {
    const [a, b] = pointers;
    const d = dist(a, b);
    const [mx, my] = mid(a, b);
    let next = cam;
    // Ratio thresholds keep the discrete steps from chattering.
    if (g.pinchDist > 0 && d / g.pinchDist > 1.35) {
      next = zoomStepAt(cam, +1, mx, my);
      return { gesture: { ...g, pointers, pinchDist: d }, cam: next };
    }
    if (g.pinchDist > 0 && d / g.pinchDist < 0.74) {
      next = zoomStepAt(cam, -1, mx, my);
      return { gesture: { ...g, pointers, pinchDist: d }, cam: next };
    }
    return { gesture: { ...g, pointers }, cam };
  }
  if (g.panId === p.id) {
    const next = panBy(cam, p.x - g.lastX, p.y - g.lastY);
    return { gesture: { ...g, pointers, lastX: p.x, lastY: p.y }, cam: next };
  }
  return { gesture: { ...g, pointers }, cam };
}

export function pointerUp(g: GestureState, id: number): GestureState {
  const pointers = g.pointers.filter((q) => q.id !== id);
  if (pointers.length === 1) {
    // Promotion: the survivor becomes the pan pointer, re-seeded at its own
    // current position so the next move delta is zero (no snap).
    const s = pointers[0];
    return { pointers, panId: s.id, lastX: s.x, lastY: s.y, pinchDist: 0 };
  }
  if (pointers.length === 0) return createGesture();
  return { ...g, pointers, pinchDist: dist(pointers[0], pointers[1]) };
}

export { HW, HH, ZOOM_STEPS };
export type { Zoom };
