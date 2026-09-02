// ─────────────────────────────────────────────────────────────────────────
// E5 — road & rail tile model. Two Uint8Array layers, each tile holding a
// 4-bit direction mask (OpenTTD's RoadBits model):
//   NE=1 SE=2 SW=4 NW=8   (the four diamond edge directions)
// A bit set means a transport piece on this tile connects toward that
// neighbour. A connection exists between two tiles only when BOTH set the
// facing bits, which makes half-piece / dangling-connection bugs impossible.
// 16 neighbour combinations → 16 sprite variants, named by binary mask.
// ─────────────────────────────────────────────────────────────────────────

import {
  MAP_W, MAP_H, NE, SE, SW, NW, DIR, OPPOSITE, BIT_TO_DELTA,
  tileIndex, inBounds, Transport, TERRAIN,
} from "./config";
import { IsoMap } from "./grid";

export const DIR_BITS = [NE, SE, SW, NW] as const;

export function bitToward(tx: number, ty: number, nx: number, ny: number): number {
  const key = `${nx - tx},${ny - ty}`;
  return BIT_TO_DELTA[key] ?? 0;
}

/** Auto-tile mask for one transport layer at (tx,ty). */
export function maskAt(bits: Uint8Array, _map: IsoMap, tx: number, ty: number): number {
  let mask = 0;
  for (const bit of DIR_BITS) {
    const [dx, dy] = DIR[bit];
    const nx = tx + dx, ny = ty + dy;
    if (!inBounds(nx, ny)) continue;
    if (bits[tileIndex(nx, ny)] & (OPPOSITE[bit] as number)) mask |= bit;
  }
  return mask;
}

export function spriteKey(kind: Transport, mask: number): string {
  // e.g. road_0011, rail_1010
  return `${kind}_${mask.toString(2).padStart(4, "0")}`;
}

export class TransportNet {
  road = new Uint8Array(MAP_W * MAP_H);
  rail = new Uint8Array(MAP_W * MAP_H);
  map: IsoMap;
  constructor(map: IsoMap) { this.map = map; }

  layer(kind: Transport): Uint8Array { return kind === "road" ? this.road : this.rail; }

  has(kind: Transport, tx: number, ty: number): boolean {
    return this.layer(kind)[tileIndex(tx, ty)] !== 0;
  }

  /** Can a piece of `kind` be laid on this tile? */
  canBuild(kind: Transport, tx: number, ty: number): boolean {
    if (!inBounds(tx, ty)) return false;
    const t = this.map.terrain[tileIndex(tx, ty)];
    if (t === TERRAIN.WATER) return false;
    if (t === TERRAIN.ROUGH && kind === "rail") return false; // rail needs flat (E2)
    if (this.map.occup[tileIndex(tx, ty)] !== -1) return false; // industry footprint
    return true;
  }

  /** Set a transport piece on a tile and connect it to any present neighbours. */
  build(kind: Transport, tx: number, ty: number): boolean {
    if (!this.canBuild(kind, tx, ty)) return false;
    const bits = this.layer(kind);
    const idx = tileIndex(tx, ty);
    // connect to existing same-type neighbours (set both facing bits)
    let mask = bits[idx];
    for (const bit of DIR_BITS) {
      const [dx, dy] = DIR[bit];
      const nx = tx + dx, ny = ty + dy;
      if (inBounds(nx, ny) && this.has(kind, nx, ny)) {
        mask |= bit;
        const nIdx = tileIndex(nx, ny);
        bits[nIdx] |= OPPOSITE[bit] as number;
      }
    }
    // a freshly placed single tile always carries at least a stub; ensure
    // it has a bit even with no neighbour so autotile/sprite isn't empty
    if (mask === 0) mask = NE | SW;
    bits[idx] = mask;
    return true;
  }

  /** Remove a piece and disconnect neighbours' facing bits. */
  demolish(kind: Transport, tx: number, ty: number) {
    const bits = this.layer(kind);
    const idx = tileIndex(tx, ty);
    if (bits[idx] === 0) return;
    bits[idx] = 0;
    for (const bit of DIR_BITS) {
      const [dx, dy] = DIR[bit];
      const nx = tx + dx, ny = ty + dy;
      if (inBounds(nx, ny)) {
        bits[tileIndex(nx, ny)] &= ~(OPPOSITE[bit] as number);
      }
    }
  }

  // ── E5: L-shaped Manhattan drag path ──────────────────────────────────
  /**
   * The L-candidate between two tiles — all of one axis then all of the other
   * (`flip` chooses which axis first) — truncated at the first illegal tile so
   * a drag into water builds the legal prefix rather than failing outright.
   */
  dragPath(kind: Transport, x0: number, y0: number, x1: number, y1: number,
    flip = false): { x: number; y: number }[] {
    const step = (a: number, b: number) => (a < b ? 1 : a > b ? -1 : 0);
    const walk = (horizontalFirst: boolean) => {
      const pts: { x: number; y: number }[] = [{ x: x0, y: y0 }];
      let x = x0, y = y0;
      const legs = horizontalFirst
        ? [["x", step(x0, x1), () => x !== x1], ["y", step(y0, y1), () => y !== y1]]
        : [["y", step(y0, y1), () => y !== y1], ["x", step(x0, x1), () => x !== x1]];
      for (const [axis, s, more] of legs as ["x" | "y", number, () => boolean][]) {
        if (s === 0) continue;
        let guard = 0;
        while (more() && guard++ < 64) {
          if (axis === "x") x += s; else y += s;
          pts.push({ x, y });
        }
      }
      // truncate at first obstacle; existing same-type passes through for free
      const out: { x: number; y: number }[] = [];
      for (const p of pts) {
        if (!inBounds(p.x, p.y)) break;
        if (this.has(kind, p.x, p.y)) { out.push(p); continue; }
        if (!this.canBuild(kind, p.x, p.y)) break;
        out.push(p);
      }
      return out;
    };
    const a = walk(!flip), b = walk(flip);
    return b.length > a.length ? b : a;
  }

  /** Commit a drag path; returns the list of newly-built (charged) tiles. */
  commitDrag(kind: Transport, path: { x: number; y: number }[]): { x: number; y: number }[] {
    const charged: { x: number; y: number }[] = [];
    for (const p of path) {
      if (this.has(kind, p.x, p.y)) continue;
      if (this.build(kind, p.x, p.y)) charged.push(p);
    }
    return charged;
  }
}

// re-export for convenience
export { bitToward as bitBetween };
