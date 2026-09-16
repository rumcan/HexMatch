import { WATER, type Grid } from "../../../src/iso/grid";

/**
 * The 2×2 truck Depot the live-game "south corridor" fixtures stand below an
 * industry. `hy` is the lot's FRONT row, so the lot's origin is (hx, hy - 1),
 * and with the industry on its NE side the lot opens SW: its gate is
 * (hx, hy + 1) — exactly where those fixtures start their road run.
 *
 * True when the lot stands on open ground and nothing else touches its SE or
 * SW side (an industry there would take the side the entrance needs).
 */
export function southLotFree(grid: Grid, hx: number, hy: number): boolean {
  const open = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.occupancy[y * grid.w + x] === -1;
  for (const [x, y] of [[hx, hy - 1], [hx + 1, hy - 1], [hx, hy], [hx + 1, hy]]) {
    if (!open(x, y) || grid.terrain[y * grid.w + x] === WATER) return false;
  }
  return open(hx + 2, hy - 1) && open(hx + 2, hy) && open(hx + 1, hy + 1);
}
