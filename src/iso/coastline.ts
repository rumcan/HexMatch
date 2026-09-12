import { tileToScreen } from "../game/config";

export type CoastPoint = [number, number];

/** Trace the union, not each diamond. Clockwise edges keep land on the right.
 * At diagonal contacts turn right so separate islands never become a bow tie.
 * Hole loops retain the opposite winding for Canvas's nonzero fill rule. */
export function traceCoast(w: number, h: number, inside: (x: number, y: number) => boolean): CoastPoint[][] {
  type Edge = { a: CoastPoint; b: CoastPoint; dir: number; used: boolean };
  const edges: Edge[] = [];
  const starts = new Map<string, Edge[]>();
  const key = ([x, y]: CoastPoint) => `${x},${y}`;
  const has = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && inside(x, y);
  const add = (a: CoastPoint, b: CoastPoint, dir: number) => {
    const e = { a, b, dir, used: false };
    edges.push(e);
    const k = key(a);
    const list = starts.get(k) ?? [];
    list.push(e); starts.set(k, list);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!has(x, y)) continue;
    if (!has(x, y - 1)) add([x, y], [x + 1, y], 0);
    if (!has(x + 1, y)) add([x + 1, y], [x + 1, y + 1], 1);
    if (!has(x, y + 1)) add([x + 1, y + 1], [x, y + 1], 2);
    if (!has(x - 1, y)) add([x, y + 1], [x, y], 3);
  }
  const loops: CoastPoint[][] = [];
  for (const first of edges) {
    if (first.used) continue;
    const loop: CoastPoint[] = [];
    let e: Edge | undefined = first;
    while (e && !e.used) {
      e.used = true; loop.push(e.a);
      if (key(e.b) === key(first.a)) break;
      const dir: number = e.dir;
      const candidates: Edge[] = (starts.get(key(e.b)) ?? []).filter(n => !n.used);
      e = [1, 0, 3, 2].flatMap(turn => candidates.filter(n => n.dir === (dir + turn) % 4))[0];
    }
    if (loop.length >= 4) loops.push(loop);
  }
  // Filter the single-cell zigzags before rounding. Limit movement to less
  // than half a cell in each grid axis so the coastline stays near its tiles.
  return loops.map(loop => {
    if (loop.length > 8) {
      const source = loop;
      loop = source.map((p, i) => {
        const mean: CoastPoint = [0, 0];
        for (let d = -3; d <= 3; d++) {
          const q = source[(i + d + source.length) % source.length];
          mean[0] += q[0] / 7; mean[1] += q[1] / 7;
        }
        return p.map((v, axis) => v + Math.max(-.45, Math.min(.45, mean[axis] - v))) as CoastPoint;
      });
    }
    for (let pass = 0; pass < 2; pass++) {
      const rounded: CoastPoint[] = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        rounded.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25],
          [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
      }
      loop = rounded;
    }
    return loop.map(([x, y]) => tileToScreen(x, y));
  });
}

/** Fill only water disconnected from the outside ocean. No random draws. */
export function fillCoastalHoles(t: Uint8Array, w: number, h: number, water: number, land: number): void {
  const seen = new Uint8Array(t.length), queue: number[] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (seen[i] || t[i] !== water) return;
    seen[i] = 1; queue.push(i);
  };
  for (let x = 0; x < w; x++) { visit(x, 0); visit(x, h - 1); }
  for (let y = 0; y < h; y++) { visit(0, y); visit(w - 1, y); }
  for (let n = 0; n < queue.length; n++) {
    const i = queue[n], x = i % w, y = Math.floor(i / w);
    visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  for (let i = 0; i < t.length; i++) if (t[i] === water && !seen[i]) t[i] = land;
}
