// ══════════════════════════════════════════════════════════════════════════
// 3D-FIX-2 (#661) — the build ghost and the overlays follow the CAMERA TURN.
//
// Owner playtest (2026-10-03, ?three=1): turn the camera with [ or ] while
// PLACING a building and the ghost is drawn "several tiles to the lower right"
// of the cyan highlight diamond, with the lane band displaced beside it.
//
// The rule every one of those overlays has to obey — and the one the bug
// broke — is a ROUND TRIP:
//
//     screen ──pick──▶ tile ──overlay position──▶ screen
//
// and the second screen point must be the one the first came from. Both halves
// are measured here against an INDEPENDENT reference:
//
//   • the pick is `pickTile` (src/iso/elevation.ts) fed `screenToWorld`, which
//     is what `IsoRenderer.pick` — and therefore `__iso.tileAtScreen` — does;
//   • the overlay position is the same maths `PlacementOverlay.paintGhost`,
//     `PlacementOverlay.corner` and `tileCentre` (renderer.ts) run: the FLAT
//     world point is turned by the view, and the HILL LIFT comes off
//     AFTERWARDS, screen-vertical — the direction the terrain shader lifts in.
//
// The ghost's own anchor has one more wrinkle (b4b1a47e): the art is a
// BILLBOARD, so only its anchor turns, and the anchor is re-pinned to the
// TURNED footprint (the south vertex of a turned footprint is a different
// corner of the same lot). So the promise tested below is not "the anchor is
// the turned anchor" but the one the player actually reads:
//
//     the ghost's anchor pixel lands ON the cyan diamond of the tile the
//     cursor picked — inside it at every yaw, flat or on a hill.
//
// Pinned: all four yaws, flat ground and a hill, square AND non-square
// footprints (1×2, 2×1, 2×4 — a ghost at yaw 90 covers the TRANSPOSED
// footprint), the yaw-0 identity, and the fps promise (the turned seat is
// memoised, so a still cursor allocates nothing).
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  createCamera, screenToWorld, snapViewYaw, turnWorld, worldToScreen, type Camera,
} from "../../src/iso/camera";
import {
  createSeatMemo, footprintPin, place, seatFind, seatTurned, turnFootprint, turnPlaced, turnTilePoint,
  yawQuarter, type Placed, type SeatMemo,
} from "../../src/iso/depth";
import { LEVEL_PX, cornerHeight, elevationActive, pickTile, tileSurfaceHeight } from "../../src/iso/elevation";
import { GRASS, WATER, type Grid } from "../../src/iso/grid";
import { HW, HH, tileToScreen } from "../../src/game/config";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { boundaryLoops, tileLoop, type Tile } from "../../src/iso/overlay-art";

afterEach(() => { snapViewYaw(createCamera(800, 600), 0); });

const QUARTERS = [0, 1, 2, 3] as const;
const FOOTPRINTS: [number, number][] = [[1, 1], [1, 2], [2, 1], [2, 4], [4, 2]];

// ── fixtures ────────────────────────────────────────────────────────────────
/** A tiny hand-built map: heights given as rows of digits, `~` is water. */
function synthetic(rows: string[]): Grid {
  const h = rows.length, w = rows[0].length;
  const terrain = new Uint8Array(w * h);
  const height = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = rows[y][x];
    const i = y * w + x;
    if (c === "~") { terrain[i] = WATER; height[i] = 0; }
    else { terrain[i] = GRASS; height[i] = Number(c); }
  }
  return {
    w, h, terrain, height, industries: [], towns: [],
    occupancy: new Uint8Array(w * h), seed: 1,
  } as unknown as Grid;
}

const rows = (fill: (x: number, y: number) => string): string[] =>
  Array.from({ length: 24 }, (_, y) => Array.from({ length: 24 }, (_, x) => fill(x, y)).join(""));

/** Flat: elevation is OFF, so every lift below must be exactly 0. */
const FLAT = synthetic(rows(() => "0"));
/**
 * A hill: a plateau of level 3 over tiles 8..15 in both axes, so a tile
 * standing well inside it shares its lift with all four of its corners (the
 * corner lattice is the MIN of the touching tiles) — only the LIFT DIRECTION
 * is under test, never an occlusion ambiguity.
 */
const HILL = synthetic(rows((x, y) => (x >= 8 && x <= 15 && y >= 8 && y <= 15 ? "3" : "0")));
/** Tiles wholly inside the plateau (every one of their four corners is level 3). */
const PLATEAU: [number, number][] = [[10, 10], [12, 13], [9, 14], [14, 9]];

/** The lift `place()` bakes into a Placed: the surface height at the footprint's S tile. */
const liftOf = (grid: Grid, tx: number, ty: number, fw: number, fh: number): number =>
  elevationActive(grid) ? tileSurfaceHeight(grid, tx + fw - 1, ty + fh - 1) * LEVEL_PX : 0;

/**
 * THE REFERENCE: where an overlay paints ground point (u,v) of the map.
 *
 * The flat world point is turned by the view; the hill lift comes off
 * afterwards, screen-vertical. This is `tileCentre` (renderer.ts) and
 * `tileScreenAt`'s lift rule, written out again here so the test does not
 * inherit a bug from the thing it checks.
 */
function overlayPoint(cam: Camera, grid: Grid, u: number, v: number): [number, number] {
  const [wx, wy] = tileToScreen(u, v);
  const lift = elevationActive(grid) ? tileSurfaceHeight(grid, Math.floor(u), Math.floor(v)) * LEVEL_PX : 0;
  const [sx, sy] = worldToScreen(cam, wx, wy);
  return [sx, sy - lift * cam.zoom];
}

/** A camera turned `k` quarters, with a deliberately off-round pan. */
const camAt = (k: number, zoom: 0.5 | 1 | 2 = 1): Camera =>
  snapViewYaw({ ...createCamera(900, 640), zoom, x: 137, y: -211 }, (k * Math.PI) / 2);

/** A stand-in `Placed` for a footprint the atlas has no cell for (as iso-yaw-lot does). */
function synth(opts: {
  tx: number; ty: number; fw: number; fh: number; grid: Grid; center?: boolean;
}): Placed {
  const { tx, ty, fw, fh, grid } = opts;
  const anchor: [number, number] = [40 + fw * 9, 60 + fh * 7];
  const def = {
    footprint: [fw, fh], anchor, center: opts.center ?? true, w: 96, h: 96, sprite: "ghost",
  } as unknown as Placed["def"];
  const [px, py] = footprintPin(def, tx, ty, fw, fh);
  const elev = liftOf(grid, tx, ty, fw, fh);
  return {
    def, sprite: "ghost", tx, ty, w: 96, h: 96, key: 0,
    wx: px - anchor[0], wy: py - anchor[1] - elev, elev,
  } as unknown as Placed;
}

/** Where the ghost's ANCHOR pixel lands on screen (the art is a billboard). */
function ghostAnchor(cam: Camera, seat: { wx: number; wy: number }, def: Placed["def"]): [number, number] {
  const [sx, sy] = worldToScreen(cam, seat.wx, seat.wy);
  return [sx + def.anchor[0] * cam.zoom, sy + def.anchor[1] * cam.zoom];
}

/**
 * The CYAN DIAMOND, drawn exactly as `PlacementOverlay` draws it: the boundary
 * of the whole tile set, each corner raised by its own lattice height, then
 * the lift taken off screen-vertically after the turn.
 */
function diamondScreen(cam: Camera, grid: Grid, tiles: Tile[]): [number, number][] {
  const pts: [number, number][] = [];
  for (const loop of boundaryLoops(tiles)) {
    for (const c of loop.corners) {
      const [wx, wy] = tileToScreen(c[0], c[1]);
      const lift = elevationActive(grid) ? cornerHeight(grid, c[0], c[1]) * LEVEL_PX : 0;
      const [sx, sy] = worldToScreen(cam, wx, wy);
      pts.push([sx, sy - lift * cam.zoom]);
    }
  }
  return pts;
}

/** Even-odd point-in-polygon over one or more closed rings. */
function inside(pt: [number, number], poly: [number, number][], groups: number[]): boolean {
  let at = 0, any = false;
  for (const n of groups) {
    const ring = poly.slice(at, at + n); at += n;
    let inside_ = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside_ = !inside_;
    }
    if (inside_) any = true;
  }
  return any;
}

const loopGroups = (tiles: Tile[]): number[] => boundaryLoops(tiles).map((l) => l.corners.length);

describe("3D-FIX-2: the pick → overlay → pick round trip at every yaw", () => {
  it("a tile's overlay point picks that tile back at yaw 0/90/180/270 (flat)", () => {
    expect(elevationActive(FLAT)).toBe(false);
    for (const k of QUARTERS) {
      const cam = camAt(k);
      const yaw = (k * Math.PI) / 2;
      for (const [tx, ty] of [[0, 0], [5, 9], [12, 12], [20, 3], [3, 20]]) {
        const [sx, sy] = overlayPoint(cam, FLAT, tx + 0.5, ty + 0.5);
        const [wx, wy] = screenToWorld(cam, sx, sy);
        expect(pickTile(FLAT, wx, wy, yaw), `yaw ${k * 90} tile ${tx},${ty}`).toEqual([tx, ty]);
      }
    }
  });

  it("the same round trip holds on a hill — the lift is screen-vertical under the turn", () => {
    expect(elevationActive(HILL)).toBe(true);
    for (const k of QUARTERS) {
      const cam = camAt(k);
      const yaw = (k * Math.PI) / 2;
      for (const [tx, ty] of PLATEAU) {
        const lift = tileSurfaceHeight(HILL, tx, ty) * LEVEL_PX;
        expect(lift).toBeCloseTo(3 * LEVEL_PX, 6);
        const [sx, sy] = overlayPoint(cam, HILL, tx + 0.5, ty + 0.5);
        // Undo the lift (screen-vertical!) and the flat projection comes back
        // exactly — which is the whole claim about the lift's direction.
        const [wx, wy] = screenToWorld(cam, sx, sy + lift * cam.zoom);
        const [fx, fy] = tileToScreen(tx + 0.5, ty + 0.5);
        expect(wx).toBeCloseTo(fx, 6);
        expect(wy).toBeCloseTo(fy, 6);
        // ...and the lifted point itself picks the tile.
        const [px, py] = screenToWorld(cam, sx, sy);
        expect(pickTile(HILL, px, py, yaw), `yaw ${k * 90} tile ${tx},${ty}`).toEqual([tx, ty]);
      }
    }
  });

  it("the ghost's anchor sits on the turned footprint's pin at every yaw, both anchor kinds", () => {
    for (const grid of [FLAT, HILL]) {
      for (const center of [true, false]) {
        for (const [fw, fh] of FOOTPRINTS) {
          for (const k of QUARTERS) {
            const cam = camAt(k);
            const yaw = (k * Math.PI) / 2;
            const tx = 10, ty = 11;
            const p = synth({ tx, ty, fw, fh, grid, center });
            const seat = seatTurned(createSeatMemo(), p, yaw, k);
            const [ax, ay] = ghostAnchor(cam, seat, p.def);
            // The anchor is pinned to the TURNED footprint (a billboard's art
            // cannot turn, so its anchor is re-seated on the lot it now covers).
            const [a, b, w2, h2] = turnFootprint(tx, ty, fw, fh, k);
            const [pinX, pinY] = footprintPin(p.def, a, b, w2, h2);
            expect(ax, `${fw}x${fh}${center ? " c" : ""} yaw ${k * 90}`)
              .toBeCloseTo(pinX * cam.zoom + cam.x, 6);
            expect(ay, `${fw}x${fh}${center ? " c" : ""} yaw ${k * 90}`)
              .toBeCloseTo(pinY * cam.zoom + cam.y - (p.elev ?? 0) * cam.zoom, 6);
          }
        }
      }
    }
  });

  it("the ghost's anchor is ON the cyan diamond of the tile the cursor picked", () => {
    // The acceptance box the owner wrote: the ghost and the highlight coincide.
    for (const grid of [FLAT, HILL]) {
      for (const center of [true, false]) {
        for (const [fw, fh] of FOOTPRINTS) {
          for (const k of QUARTERS) {
            const cam = camAt(k);
            const yaw = (k * Math.PI) / 2;
            const tx = 10, ty = 11;
            const tiles: Tile[] = [];
            for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) tiles.push([tx + dx, ty + dy]);
            const poly = diamondScreen(cam, grid, tiles);
            const groups = loopGroups(tiles);
            const p = synth({ tx, ty, fw, fh, grid, center });
            const [ax, ay] = ghostAnchor(cam, seatTurned(createSeatMemo(), p, yaw, k), p.def);
            // A boundary vertex is a legal seat (the south-anchored art stands
            // on the diamond's front corner), so nudge the test point a hair
            // inward from the diamond's own centre before the containment test.
            const [cx, cy] = overlayPoint(cam, grid, tx + fw / 2, ty + fh / 2);
            const probe: [number, number] = [ax + (cx - ax) * 1e-3, ay + (cy - ay) * 1e-3];
            expect(inside(probe, poly, groups), `${fw}x${fh}${center ? " c" : ""} yaw ${k * 90} anchor ${ax},${ay}`)
              .toBe(true);
          }
        }
      }
    }
  });

  it("a non-square ghost covers the TRANSPOSED footprint (every tile of it picks back)", () => {
    for (const grid of [FLAT, HILL]) {
      for (const [fw, fh] of FOOTPRINTS) {
        for (const k of QUARTERS) {
          const cam = camAt(k);
          const yaw = (k * Math.PI) / 2;
          const tx = 10, ty = 11;
          const [a, b, w2, h2] = turnFootprint(tx, ty, fw, fh, k);
          expect([w2, h2], `${fw}x${fh} at yaw ${k * 90}`).toEqual(k % 2 ? [fh, fw] : [fw, fh]);
          // Every tile the ghost stands on picks itself back through the turn.
          for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
            const [sx, sy] = overlayPoint(cam, grid, tx + dx + 0.5, ty + dy + 0.5);
            const [wx, wy] = screenToWorld(cam, sx, sy);
            expect(pickTile(grid, wx, wy, yaw), `${fw}x${fh} tile ${tx + dx},${ty + dy} yaw ${k * 90}`)
              .toEqual([tx + dx, ty + dy]);
          }
          // ...and the turned footprint is exactly the turn of that tile set.
          const turned = new Set<string>();
          for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
            const [u, v] = turnTilePoint(tx + dx + 0.5, ty + dy + 0.5, k);
            turned.add(`${Math.floor(u)},${Math.floor(v)}`);
          }
          const span = new Set<string>();
          for (let dy = 0; dy < h2; dy++) for (let dx = 0; dx < w2; dx++) span.add(`${a + dx},${b + dy}`);
          expect([...span].sort()).toEqual([...turned].sort());
        }
      }
    }
  });

  it("a real atlas sprite: place() lifts it, and its seat lands on the same pin", () => {
    const atlas = new Atlas(JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest);
    const sprite = "terrain_grass";
    const tx = 11, ty = 12;
    const p = place(atlas, { sprite, tx, ty }, HILL) as Placed;
    const [fw, fh] = p.def.footprint;
    expect(p.elev).toBeCloseTo(tileSurfaceHeight(HILL, tx + fw - 1, ty + fh - 1) * LEVEL_PX, 6);
    for (const k of QUARTERS) {
      const cam = camAt(k);
      const [ax, ay] = ghostAnchor(cam, seatTurned(createSeatMemo(), p, (k * Math.PI) / 2, k), p.def);
      const [a, b, w2, h2] = turnFootprint(tx, ty, fw, fh, k);
      const [pinX, pinY] = footprintPin(p.def, a, b, w2, h2);
      expect(ax).toBeCloseTo(pinX * cam.zoom + cam.x, 6);
      expect(ay).toBeCloseTo(pinY * cam.zoom + cam.y - (p.elev ?? 0) * cam.zoom, 6);
    }
  });
});

describe("3D-FIX-2: the turned seat is memoised (no per-frame allocation)", () => {
  it("a second look at the same ghost reuses the slot — at every zoom and yaw", () => {
    for (const zoom of [0.5, 1, 2] as const) {
      for (const k of QUARTERS) {
        const cam = camAt(k, zoom);
        expect(cam.zoom).toBe(zoom);
        const memo: SeatMemo = createSeatMemo();
        const yaw = (k * Math.PI) / 2;
        const p = synth({ tx: 10, ty: 11, fw: 2, fh: 4, grid: HILL });
        const first = seatTurned(memo, p, yaw, k);
        const [x0, y0] = [first.wx, first.wy];
        // The cheap half: a straight lookup, no `place()`, no object made.
        expect(seatFind(memo, p.sprite, p.tx, p.ty, yaw, k)).toBe(first);
        const second = seatTurned(memo, p, yaw, k);
        expect(second, `yaw ${k * 90} zoom ${zoom}`).toBe(first);      // same object: nothing allocated
        expect(second.wx).toBe(x0); expect(second.wy).toBe(y0);
        // A different tile needs its own slot, and the first one survives.
        const q = synth({ tx: 12, ty: 11, fw: 2, fh: 4, grid: HILL });
        const other = seatTurned(memo, q, yaw, k);
        expect(other).not.toBe(first);
        expect(seatTurned(memo, p, yaw, k)).toBe(first);
      }
    }
  });

  it("a turn rebuilds the seats (the anchor turns with the view) — and back again", () => {
    const memo: SeatMemo = createSeatMemo();
    const p = synth({ tx: 10, ty: 11, fw: 1, fh: 2, grid: HILL });
    const at0 = { ...seatTurned(memo, p, 0, 0) };
    const at1 = { ...seatTurned(memo, p, Math.PI / 2, 1) };
    expect(memo.slots.length).toBe(1);                 // one ghost, one slot
    expect([at1.wx, at1.wy]).not.toEqual([at0.wx, at0.wy]);
    // A stale seat from the previous quarter must never be served.
    expect(seatFind(memo, p.sprite, p.tx, p.ty, Math.PI / 2, 1)!.wx).toBeCloseTo(at1.wx, 9);
    // ...and turning back restores the yaw-0 seat exactly.
    const back = seatTurned(memo, p, 0, 0);
    expect(back.wx).toBeCloseTo(at0.wx, 9);
    expect(back.wy).toBeCloseTo(at0.wy, 9);
  });

  it("yaw 0 is the identity: the seat is the placement itself, byte for byte", () => {
    const p = synth({ tx: 10, ty: 11, fw: 2, fh: 1, grid: HILL });
    const seat = seatTurned(createSeatMemo(), p, 0, 0);
    expect(seat.wx).toBe(p.wx);
    expect(seat.wy).toBe(p.wy);
    const { draw, sort } = turnPlaced(p, 0, 0);
    expect(draw.wx).toBe(p.wx); expect(draw.wy).toBe(p.wy);
    expect(sort.tx).toBe(p.tx); expect(sort.ty).toBe(p.ty);
    expect(yawQuarter(0)).toBe(0);
  });
});

describe("3D-FIX-2: the highlight diamond follows the turn", () => {
  it("a footprint's corner is drawn where the turned lattice puts it (flat and hill)", () => {
    // PlacementOverlay.corner: tileToScreen(corner) → worldToScreen → minus the
    // corner's own lift, screen-vertical. Checked against the world turn.
    for (const grid of [FLAT, HILL]) {
      for (const k of QUARTERS) {
        const cam = camAt(k);
        const yaw = (k * Math.PI) / 2;
        for (const [cx, cy] of [[10, 11], [12, 11], [12, 13], [10, 13]]) {
          const [wx, wy] = tileToScreen(cx, cy);
          const lift = elevationActive(grid) ? cornerHeight(grid, cx, cy) * LEVEL_PX : 0;
          const [sx, sy] = worldToScreen(cam, wx, wy);
          const drawn: [number, number] = [sx, sy - lift * cam.zoom];
          // The turn of the flat point, then the lift — the same two steps.
          const [twx, twy] = turnWorld(wx, wy, yaw);
          expect(drawn[0]).toBeCloseTo(twx * cam.zoom + cam.x, 6);
          expect(drawn[1]).toBeCloseTo(twy * cam.zoom + cam.y - lift * cam.zoom, 6);
        }
      }
    }
    expect(HW).toBe(32); expect(HH).toBe(16);
  });

  it("the hovered tile's diamond centre is the point that picks it, at every yaw", () => {
    // The cyan diamond the owner saw the ghost drift away from: its centre is
    // the tile's overlay point, and that point picks the tile back.
    for (const grid of [FLAT, HILL]) {
      for (const k of QUARTERS) {
        const cam = camAt(k, 2);
        const yaw = (k * Math.PI) / 2;
        for (const [tx, ty] of [[10, 11], [13, 14], [4, 18]]) {
          const [sx, sy] = overlayPoint(cam, grid, tx + 0.5, ty + 0.5);
          const [wx, wy] = screenToWorld(cam, sx, sy);
          expect(pickTile(grid, wx, wy, yaw)).toEqual([tx, ty]);
          // A single tile's loop is its own diamond — one ring, four corners,
          // and the tile's centre is inside it at every yaw.
          const one = boundaryLoops([[tx, ty]]);
          expect(one.length).toBe(1);
          expect(one[0].corners.length).toBe(4);
          expect(inside([sx, sy], diamondScreen(cam, grid, [[tx, ty]]), loopGroups([[tx, ty]]))).toBe(true);
        }
      }
    }
  });
});
