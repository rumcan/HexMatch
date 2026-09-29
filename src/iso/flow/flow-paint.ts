// ══════════════════════════════════════════════════════════════════════════
// FLOW-1 — painting. Pure canvas code, no game imports.
//
// Two kinds of paint, on two different layers, for a reason:
//
//   • GROUND MARKINGS (stop lines, zebra crossings, street centre lines) never
//     change between road edits, so they are drawn in GROUND UNITS into the
//     road raster cache (`road-renderer.ts` sets a ground→pixel transform and
//     calls `paintJunctionMarkings`). Cost per frame: zero.
//   • SIGNAL HEADS, incidents and the congestion heat map change every frame,
//     so they are drawn in SCREEN space by the ambience overlay through a
//     `project(fx, fy)` callback. Only what is on screen, capped.
//
// Right-hand traffic throughout, matching `traffic.ts`'s `lanePerp`: for a
// heading u the driver's right is (-u.y, u.x) in ground coordinates.
// ══════════════════════════════════════════════════════════════════════════
import type { FlowAspect, FlowAxis, FlowIncident, FlowJunction } from "./flow-core";

export type GPt = [number, number];

/** The road raster's draper (`elevation.ts`). Identity on a flat map. */
export interface FlowDrape {
  path(points: GPt[]): ReadonlyArray<readonly [number, number]>;
}

export const IDENTITY_DRAPE: FlowDrape = { path: (p) => p };

export const FLOW_PALETTE = {
  paint: "#ece8da",
  paintAlpha: 0.86,
  zebraAlpha: 0.8,
  street: "#d8b453",
  streetAlpha: 0.62,
  pole: "#23201c",
  housing: "#15130f",
  housingEdge: "#5a5247",
  dim: "#34302a",
  red: "#ff4b3a",
  amber: "#ffb52e",
  green: "#43e06a",
  cone: "#ff7a1a",
  coneBand: "#fff3e0",
} as const;

const LIT: Record<FlowAspect, string> = {
  red: FLOW_PALETTE.red,
  amber: FLOW_PALETTE.amber,
  green: FLOW_PALETTE.green,
};

function unit(ax: number, ay: number): GPt {
  const l = Math.hypot(ax, ay) || 1;
  return [ax / l, ay / l];
}

function strokePath(ctx: CanvasRenderingContext2D, drape: FlowDrape, pts: GPt[]): void {
  const p = drape.path(pts);
  if (p.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]);
  ctx.stroke();
}

export interface MarkingOpts {
  /** Offset from a tile index to its centre in the target space (0.5 in the road raster). */
  centre?: number;
  drape?: FlowDrape;
  zebra?: boolean;
  stopLine?: boolean;
}

/**
 * Stop lines and zebra crossings on every arm of one signalised junction.
 * The context must already carry a GROUND→pixel transform; widths are in
 * tile units.
 */
export function paintJunctionMarkings(
  ctx: CanvasRenderingContext2D,
  j: Pick<FlowJunction, "x" | "y" | "arms">,
  halfWidth: number,
  opts: MarkingOpts = {},
): void {
  const c = opts.centre ?? 0.5;
  const drape = opts.drape ?? IDENTITY_DRAPE;
  const cx = j.x + c, cy = j.y + c;
  const hw = Math.max(0.08, Math.min(0.32, halfWidth));
  const d0 = hw + 0.035;
  const d1 = Math.min(0.43, hw + 0.15);
  const ds = Math.min(0.48, d1 + 0.045);
  ctx.save();
  ctx.lineCap = "butt";
  ctx.setLineDash?.([]);
  ctx.strokeStyle = FLOW_PALETTE.paint;
  for (const [ax, ay] of j.arms) {
    const [ux, uy] = unit(ax, ay);
    const rx = uy, ry = -ux;                   // right of the INBOUND driver
    if (opts.zebra !== false) {
      const n = 5;
      const span = hw * 0.92;
      const sw = (2 * span) / (2 * n - 1);
      ctx.globalAlpha = FLOW_PALETTE.zebraAlpha;
      ctx.lineWidth = sw;
      for (let s = 0; s < n; s++) {
        const l = -span + sw / 2 + s * 2 * sw;
        strokePath(ctx, drape, [
          [cx + ux * d0 + rx * l, cy + uy * d0 + ry * l],
          [cx + ux * d1 + rx * l, cy + uy * d1 + ry * l],
        ]);
      }
    }
    if (opts.stopLine !== false) {
      ctx.globalAlpha = FLOW_PALETTE.paintAlpha;
      ctx.lineWidth = 0.034;
      const sx = cx + ux * ds, sy = cy + uy * ds;
      strokePath(ctx, drape, [[sx, sy], [sx + rx * hw * 0.94, sy + ry * hw * 0.94]]);
    }
  }
  ctx.restore();
}

/** A dashed centre line along a polyline in ground units (town streets). */
export function paintCentreLine(
  ctx: CanvasRenderingContext2D, pts: GPt[], drape: FlowDrape = IDENTITY_DRAPE,
): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = "butt";
  ctx.strokeStyle = FLOW_PALETTE.street;
  ctx.globalAlpha = FLOW_PALETTE.streetAlpha;
  ctx.lineWidth = 0.022;
  ctx.setLineDash?.([0.1, 0.12]);
  strokePath(ctx, drape, pts);
  ctx.restore();
}

// ── signal heads (screen space) ─────────────────────────────────────────
export interface PolePlace {
  fx: number;
  fy: number;
  axis: FlowAxis;
  townId: number;
  junction: number;
}

/**
 * One pole per arm, on the inbound driver's kerb just before the stop line.
 * Positions are in the SIMULATION's tile space (tile centre = integer), which
 * is what the overlay's `project` takes.
 */
export function signalPoles(j: FlowJunction, halfWidth: number, centre = 0): PolePlace[] {
  const out: PolePlace[] = [];
  const cx = j.x + centre, cy = j.y + centre;
  for (const [ax, ay] of j.arms) {
    const [ux, uy] = unit(ax, ay);
    const rx = uy, ry = -ux;
    const along = Math.min(0.47, halfWidth + 0.22);
    // tight to the kerb, so the pole stays off the corner plots
    const side = Math.min(0.36, halfWidth + 0.04);
    out.push({
      fx: cx + ux * along + rx * side,
      fy: cy + uy * along + ry * side,
      axis: (Math.abs(ax) >= Math.abs(ay) ? 0 : 1) as FlowAxis,
      townId: j.townId,
      junction: j.i,
    });
  }
  return out;
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A three-aspect signal head on a kerb pole. (sx, sy) is the pole's foot. */
export function paintSignalHead(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, aspect: FlowAspect,
): void {
  const z = zoom;
  // Owner (2026-09-29): half the first size; they stood over the buildings.
  const h = 7.5 * z, w = 1.9 * z, hh = 4.8 * z;
  const top = sy - h - hh;
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#000";
  if (typeof ctx.ellipse === "function") {
    ctx.beginPath();
    ctx.ellipse(sx + 0.75 * z, sy, 1.3 * z, 0.55 * z, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = FLOW_PALETTE.pole;
  ctx.lineWidth = Math.max(0.75, 0.6 * z);
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, sy - h);
  ctx.stroke();
  ctx.fillStyle = FLOW_PALETTE.housing;
  ctx.fillRect(sx - w / 2, top, w, hh);
  ctx.strokeStyle = FLOW_PALETTE.housingEdge;
  ctx.lineWidth = Math.max(0.6, 0.5 * z);
  ctx.strokeRect(sx - w / 2, top, w, hh);
  const r = 0.55 * z;
  const lamps: FlowAspect[] = ["red", "amber", "green"];
  lamps.forEach((lamp, n) => {
    const ly = top + hh * (0.2 + n * 0.3);
    const lit = lamp === aspect;
    if (lit) {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = LIT[lamp];
      disc(ctx, sx, ly, r * 2.7);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = lit ? LIT[lamp] : FLOW_PALETTE.dim;
    disc(ctx, sx, ly, r);
  });
  ctx.restore();
}

/** Cones and a blinking beacon over an incident tile. */
export function paintIncident(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, zoom: number, timeMs: number,
  inc?: Pick<FlowIncident, "startMs" | "untilMs">,
): void {
  const z = zoom;
  ctx.save();
  if (inc) {
    const life = Math.max(1, inc.untilMs - inc.startMs);
    const left = Math.max(0, Math.min(1, (inc.untilMs - timeMs) / life));
    ctx.globalAlpha = 0.18 + 0.1 * left;
    ctx.fillStyle = FLOW_PALETTE.cone;
    if (typeof ctx.ellipse === "function") {
      ctx.beginPath();
      ctx.ellipse(sx, sy, 14 * z, 7 * z, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  const cone = (x: number, y: number) => {
    ctx.fillStyle = FLOW_PALETTE.cone;
    ctx.beginPath();
    ctx.moveTo(x, y - 6 * z);
    ctx.lineTo(x + 2.4 * z, y);
    ctx.lineTo(x - 2.4 * z, y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = FLOW_PALETTE.coneBand;
    ctx.fillRect(x - 1.3 * z, y - 3.4 * z, 2.6 * z, 1 * z);
  };
  cone(sx - 6 * z, sy + 1 * z);
  cone(sx + 6 * z, sy + 1 * z);
  cone(sx, sy + 3.5 * z);
  const blink = 0.5 + 0.5 * Math.sin(timeMs / 140);
  ctx.globalAlpha = 0.35 + 0.65 * blink;
  ctx.fillStyle = FLOW_PALETTE.amber;
  disc(ctx, sx, sy - 9 * z, 1.8 * z);
  ctx.globalAlpha = 0.25 * blink;
  disc(ctx, sx, sy - 9 * z, 5 * z);
  ctx.restore();
}

/** Tint one tile by its speed factor: clear when free, amber → red as it jams. */
export function paintHeatTile(
  ctx: CanvasRenderingContext2D,
  project: (fx: number, fy: number) => [number, number],
  x: number, y: number, factor: number,
): boolean {
  if (factor > 0.93) return false;
  const k = Math.max(0, Math.min(1, (factor - 0.4) / 0.53));
  const hue = Math.round(120 * k);
  const pts = [
    project(x - 0.5, y - 0.5), project(x + 0.5, y - 0.5),
    project(x + 0.5, y + 0.5), project(x - 0.5, y + 0.5),
  ];
  ctx.save();
  ctx.globalAlpha = 0.22 + 0.28 * (1 - k);
  ctx.fillStyle = `hsl(${hue} 90% 50%)`;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  return true;
}
