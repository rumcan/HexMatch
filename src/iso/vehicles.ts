// ══════════════════════════════════════════════════════════════════════════
// K5 — Vehicles (art only; movement is TK-004).
//
// Kenney's vehicle sets ship a frame per compass heading (_N _NE _E _SE _S
// _SW _W _NW — the flat-road variants; the D/U suffixes are for slopes, which
// the flat-only grid never uses). A vehicle therefore just picks the frame
// matching its heading — no rotation maths anywhere, which is exactly what
// TK-004's straight-line runner needs.
//
// The chosen cargo vehicle is the garbage truck (a proper truck per
// TK-003/007); it is packed as vehicle_truck_<heading> with a bottom-centre
// anchor, so it rests on the road surface at the tile centre.
// ══════════════════════════════════════════════════════════════════════════
import { tileToScreen } from "../game/config";

export type Heading = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

/** Compass order — matches Kenney's frame suffixes 1:1. */
export const HEADINGS: Heading[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/** Atlas sprite for a vehicle heading (one frame per compass direction). */
export const vehicleSprite = (h: Heading, vehicle = "truck"): string =>
  `vehicle_${vehicle}_${h}`;

/** Screen-space unit vector of a heading (world px per tile step). */
export const headingStep: Record<Heading, [number, number]> = {
  n: tileToScreenDir(-1, -1), ne: tileToScreenDir(0, -1), e: tileToScreenDir(1, -1),
  se: tileToScreenDir(1, 0), s: tileToScreenDir(1, 1), sw: tileToScreenDir(0, 1),
  w: tileToScreenDir(-1, 1), nw: tileToScreenDir(-1, 0),
};
function tileToScreenDir(dx: number, dy: number): [number, number] {
  const [sx, sy] = tileToScreen(dx, dy);
  return [Math.sign(sx), Math.sign(sy)];
}

/**
 * The heading of a vehicle driving one tile from `from` to `to` (TK-004's
 * per-step frame pick). The eight tile-neighbourhood steps map onto the
 * eight compass frames through the projection itself.
 */
export function headingForStep(
  from: { tx: number; ty: number }, to: { tx: number; ty: number },
): Heading {
  const dx = to.tx - from.tx, dy = to.ty - from.ty;
  const key = `${dx},${dy}`;
  const table: Record<string, Heading> = {
    "0,-1": "ne", "1,0": "se", "0,1": "sw", "-1,0": "nw",   // road directions
    "1,-1": "e", "1,1": "s", "-1,1": "w", "-1,-1": "n",     // screen diagonals
  };
  const h = table[key];
  if (!h) throw new Error(`headingForStep: (${dx},${dy}) is not a tile-neighbour step`);
  return h;
}

/**
 * A heading that follows a road tile's autotile mask (direction bits NE=1
 * SE=2 SW=4 NW=8). With `preferFrom` (a heading the vehicle arrived on) the
 * arm continuing that way wins; otherwise the lowest set bit decides — the
 * asphalt runs there either way, so a static vehicle faces correctly.
 */
export function headingForDir(bits: number, preferFrom?: Heading): Heading {
  const bitHeading: Record<number, Heading> = { 1: "ne", 2: "se", 4: "sw", 8: "nw" };
  const opposite: Record<Heading, Heading> = {
    n: "s", ne: "sw", e: "w", se: "nw", s: "n", sw: "ne", w: "e", nw: "se",
  };
  if (preferFrom) {
    // the arm AHEAD of an arriving vehicle is the opposite of where it came from
    const ahead = opposite[preferFrom];
    for (const bit of [1, 2, 4, 8]) {
      if (bits & bit && bitHeading[bit] === ahead) return ahead;
    }
  }
  for (const bit of [1, 2, 4, 8]) if (bits & bit) return bitHeading[bit];
  return "ne";   // lone stub (mask 0): face its dead-end arm
}

/** One road tile's low nibble + the track layer it came from. */
export interface RoadTile { tx: number; ty: number; bits: number; }

/**
 * Static display vehicles for a road network: one truck per 4-connected
 * road component, parked on the component's front-most tile (max tx+ty)
 * facing back along its connected arm. Art-only (K5); TK-004 replaces this
 * with real movement.
 */
export function vehiclesForRoads(
  roadBits: Uint8Array, w: number, h: number,
): { sprite: string; tx: number; ty: number; ref: { kind: "vehicle" } }[] {
  const seen = new Uint8Array(w * h);
  const out: { sprite: string; tx: number; ty: number; ref: { kind: "vehicle" } }[] = [];
  const D: [number, number, number][] = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !(roadBits[start] & 0b1111)) continue;
    // flood the component, remembering the front-most tile and a connected arm
    const stack = [start];
    seen[start] = 1;
    let front = start;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      if (x + y > (front % w) + ((front / w) | 0)) front = i;
      for (const [dx, dy] of D) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!seen[ni] && (roadBits[ni] & 0b1111)) { seen[ni] = 1; stack.push(ni); }
      }
    }
    const bits = roadBits[front] & 0b1111;
    // face the arm that leads back INTO the component (asphalt that continues)
    let heading: Heading | null = null;
    const bitHeading: Record<number, Heading> = { 1: "ne", 2: "se", 4: "sw", 8: "nw" };
    for (const [dx, dy, bit] of D) {
      if (!(bits & bit)) continue;
      const nx = front % w + dx, ny = ((front / w) | 0) + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (roadBits[ny * w + nx] & 0b1111) { heading = bitHeading[bit]; break; }
    }
    out.push({
      sprite: vehicleSprite(heading ?? headingForDir(bits)),
      tx: front % w, ty: (front / w) | 0,
      ref: { kind: "vehicle" },
    });
  }
  return out;
}
