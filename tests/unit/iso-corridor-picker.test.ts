// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// E14 — the e2e corridor picker, verified headlessly.
//
// The real-browser suite is the only place the picker runs, and it has been
// red since the Kenney cutover (docs/tickets/E14-e2e-corridor-picker-returns-null.md),
// so "the fix works" could only be asserted from CI. These tests give the same
// verdict without a browser: the REAL map generator, the REAL camera maths
// (including the exact zoom step the spec's wheel gesture performs), the REAL
// `buildRefusal` legality rule, and the HUD boxes computed from the committed
// CSS — jsdom has no layout, so the fixed-position chrome is replayed from
// `src/game/styles.css` arithmetic (same numbers the ticket derived).
//
// What is NOT mocked: anything about the game. `window.__iso` is a thin shim
// over the same three fields game.ts exposes to the browser (grid,
// tileScreenAt, tileProbe), built from the same functions game.ts uses.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MAP_W, MAP_H } from "../../src/game/config";
import { generateMap } from "../../src/iso/grid";
import {
  createCamera, centerOnTile, zoomStepAt, tileToScreenAt, screenToWorld, type Camera,
} from "../../src/iso/camera";
import { flatPick } from "../../src/iso/renderer";
import {
  createTrack, buildRefusal, previewDrag, playerNetwork, type TrackKind,
} from "../../src/iso/track";
import { industriesInCatchment } from "../../src/iso/economy";
import {
  findIsoCorridor, isoTileOcclusion, isoTileClickPoint, type Corridor,
} from "../../tests/e2e/corridor-picker";

const VIEW_W = 1280, VIEW_H = 720;   // devices["Desktop Chrome"] at dpr 1
const DPR = 1;

/**
 * The fixed HUD boxes that sit over the map, straight from
 * `src/game/styles.css` at 1280×720 (see the E14 ticket's arithmetic):
 *  .topbar   fixed top:0, height 60, z 40
 *  .resbar   fixed bottom:0 (the asides stop at bottom:52px), z 38
 *  .aside.left  fixed 10px, width 300 (1280 > the 1180px narrow breakpoint)
 *  .aside.right fixed 10px, width --board-px + 30 where ui.ts publishes
 *               ceil((CELL·BOARD_W + 10) · 0.68) = 338 for innerHeight ≤ 720
 *  #iso-banner  .banner, fixed top:104, centred, max-width 400, z 45
 */
function hudBoxes() {
  const boardPx = 54 * 9;                                   // CELL · BOARD_W
  const boardW = Math.ceil((boardPx + 10) * 0.68);         // responsiveZoom @ vh≤720
  return {
    topbar: { left: 0, top: 0, right: VIEW_W, bottom: 60 },
    resbar: { left: 0, top: VIEW_H - 52, right: VIEW_W, bottom: VIEW_H },
    left: { left: 10, top: 68, right: 10 + 300, bottom: VIEW_H - 52 },
    right: { left: VIEW_W - 10 - (boardW + 30), top: 68, right: VIEW_W - 10, bottom: VIEW_H - 52 },
    banner: { left: VIEW_W / 2 - 200, top: 104, right: VIEW_W / 2 + 200, bottom: 104 + 58 },
  };
}

type Rect = { left: number; top: number; right: number; bottom: number };

let cleanup: (() => void)[] = [];
let cam: Camera;
let track: ReturnType<typeof createTrack>;
type Seed = { owner: string; ownerId: number; tx: number; ty: number; id?: number };
let eco: {
  grid: ReturnType<typeof generateMap>;
  track: typeof track;
  harvesters: Seed[];
  factories: Seed[];
};
let boxes: Record<string, Rect>;

function inside(r: Rect, x: number, y: number) {
  return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
}

/** The element a real pointer event would hit at (x,y) — replayed from rects. */
function topAt(x: number, y: number): { kind: "canvas" | string; id?: string } {
  const order = ["banner", "topbar", "resbar", "left", "right"] as const;
  for (const k of order) {
    if (inside(boxes[k], x, y)) return { kind: k };
  }
  return { kind: "canvas" };
}

/** Boot the same state the e2e boots: seeded map, camera centred on the
 *  first industry, then the spec's real wheel gesture (deltaY > 0 = out). */
function bootCamera(seed: number, wheelOut: number) {
  const grid = generateMap(seed);
  const focus = grid.industries[0];
  let c = centerOnTile(createCamera(VIEW_W * DPR, VIEW_H * DPR), focus.tx, focus.ty);
  for (let i = 0; i < wheelOut; i++) c = zoomStepAt(c, -1, (VIEW_W / 2) * DPR, (VIEW_H / 2) * DPR);
  return { grid, cam: c };
}

function installHook(grid: ReturnType<typeof generateMap>, onCamera: () => Camera) {
  track = createTrack();
  eco = { grid, track, harvesters: [], factories: [] };
  const hook = {
    grid,
    tileScreenAt: (tx: number, ty: number) => tileToScreenAt(onCamera(), tx, ty),
    get camera() { return onCamera(); },
    // The stage-1 half of the real two-stage pick. Stage 2 needs the atlas
    // alpha masks, which no jsdom run has — so in here the pick can only ever
    // agree with the flat lattice, which is exactly what makes the aim search
    // resolve to the conventional point. The browser run has both stages.
    pickAt: (sx: number, sy: number) => {
      const [wx, wy] = screenToWorld(onCamera(), sx, sy);
      const [tx, ty] = flatPick(wx, wy);
      return { tx, ty, sprite: null };
    },
    tileProbe: (kind: TrackKind, tx: number, ty: number) => {
      const why = buildRefusal(grid, kind, tx, ty);
      const taken = eco.harvesters.some((h) => h.tx === tx && h.ty === ty);
      const served = why === null && !taken
        ? industriesInCatchment(grid, { id: -1, owner: "you", ownerId: 0, tx, ty })
        : [];
      return {
        build: { ok: why === null, why },
        harvester: {
          ok: why === null && !taken && served.length > 0,
          why: why ?? (taken ? "harvester-taken" : served.length ? null : "no-industry-in-catchment"),
          industries: served.map((x) => x.id),
        },
      };
    },
  };
  Object.defineProperty(window, "__iso", { value: hook, configurable: true, writable: true });

  // jsdom has no layout: hand the page the hit-test the CSS implies.
  const canvas = document.createElement("canvas");
  canvas.className = "iso-layer";
  document.body.appendChild(canvas);
  const asides: HTMLElement[] = [];
  for (const [cls, rect] of [["aside left iso-panel", boxes.left], ["aside right iso-panel", boxes.right]] as const) {
    const el = document.createElement("aside");
    el.className = cls;
    el.getBoundingClientRect = () => box(rect);
    document.body.appendChild(el);
    asides.push(el);
  }
  // jsdom does not implement elementsFromPoint at all — that is exactly the
  // layout the shim below supplies from the committed CSS.
  const realFromPoint = document.elementsFromPoint as typeof document.elementsFromPoint | undefined;
  document.elementsFromPoint = ((x: number, y: number) => {
    const top = topAt(x, y);
    if (top.kind === "canvas") return [canvas];
    const el = top.kind === "left" || top.kind === "right"
      ? asides[top.kind === "left" ? 0 : 1]
      : Object.assign(document.createElement("div"), {
        id: top.kind === "banner" ? "iso-banner" : "",
        className: top.kind === "banner" ? "banner" : top.kind,
      });
    return [el];
  }) as typeof realFromPoint;

  cleanup.push(() => {
    if (realFromPoint) document.elementsFromPoint = realFromPoint;
    else delete (document as unknown as Record<string, unknown>).elementsFromPoint;
    canvas.remove();
    for (const a of asides) a.remove();
    delete (window as Record<string, unknown>).__iso;
  });
}

const box = (r: Rect): DOMRect => ({
  ...r, width: r.right - r.left, height: r.bottom - r.top,
  x: r.left, y: r.top, toJSON: () => ({}),
}) as DOMRect;

/** CSS px centre of a tile's diamond, as the spec's `tileCenter` computes it. */
const centre = (tx: number, ty: number) => {
  const [x, y] = tileToScreenAt(cam, tx, ty);
  return { x: x / DPR, y: y / DPR };
};

/** The click point the picker asked for: centre + aim × one tile step. */
const aimPoint = (aim: { x: number; y: number }, tx: number, ty: number) => {
  const [d0x, d0y] = tileToScreenAt(cam, 0, 0);
  const [d1x, d1y] = tileToScreenAt(cam, 0, 1);
  const [x, y] = tileToScreenAt(cam, tx, ty);
  return {
    x: (x + aim.x * Math.abs(d1x - d0x)) / DPR,
    y: (y + aim.y * Math.abs(d1y - d0y)) / DPR,
    device: [x + aim.x * Math.abs(d1x - d0x), y + aim.y * Math.abs(d1y - d0y)] as [number, number],
  };
};

beforeEach(() => {
  cleanup = [];
  boxes = hudBoxes();
  Object.defineProperty(window, "innerWidth", { value: VIEW_W, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: VIEW_H, configurable: true });
  Object.defineProperty(window, "devicePixelRatio", { value: DPR, configurable: true });
});

afterEach(() => {
  for (const fn of cleanup) fn();
  cleanup = [];
});

/** Set up a boot state and its hook; returns the live map. */
function scene(seed: number, wheelOut: number) {
  const s = bootCamera(seed, wheelOut);
  cam = s.cam;
  installHook(s.grid, () => cam);
  return s;
}

describe("E14 the corridor picker finds a corridor by real geometry", () => {
  it("plays a whole 4–7 tile corridor inside the clear band at the zoomed-out boot camera", () => {
    const { grid } = scene(1337, 1);
    const c = findIsoCorridor({ minTiles: 4, maxTiles: 7 });

    // the shape is what the test needs: a contiguous single-axis column
    expect(c.tiles).toBeGreaterThanOrEqual(4);
    expect(c.tiles).toBeLessThanOrEqual(7);
    expect(c.col).toHaveLength(c.tiles);
    expect(c.col[0]).toEqual({ tx: c.hx, ty: c.hy });
    expect(c.col[c.tiles - 1]).toEqual({ tx: c.fx, ty: c.fy });
    const steps = c.col.slice(1).map((t, i) => `${t.tx - c.col[i].tx},${t.ty - c.col[i].ty}`);
    expect(new Set(steps).size).toBe(1);
    // the one step is a legal track direction (NE/SE/SW/NW in src/iso/track.ts)
    expect(["0,-1", "1,0", "0,1", "-1,0"]).toContain(steps[0]);

    for (const t of c.col) {
      // inside the map, and legal ground for a road (the game's own rule)
      expect(t.tx).toBeGreaterThanOrEqual(0);
      expect(t.ty).toBeGreaterThanOrEqual(0);
      expect(t.tx).toBeLessThan(MAP_W);
      expect(t.ty).toBeLessThan(MAP_H);
      expect(buildRefusal(grid, "road", t.tx, t.ty)).toBeNull();
      // on screen, and reached through the game's own pick maths
      const p = aimPoint(c.aim, t.tx, t.ty);
      expect(p.x).toBeGreaterThanOrEqual(-20);
      expect(p.x).toBeLessThanOrEqual(VIEW_W + 20);
      expect(p.y).toBeGreaterThanOrEqual(-20);
      expect(p.y).toBeLessThanOrEqual(VIEW_H + 20);
      // A2: reachable — a real pointer event at that point hits the canvas,
      // not the HUD. Checked independently of elementsFromPoint, from the
      // CSS rects, so the helper cannot mark its own homework.
      expect(topAt(p.x, p.y).kind).toBe("canvas");
      // A2: and the point resolves back to the tile it belongs to (stage-1
      // pick; the browser adds the alpha-mask stage on top of this).
      const [wx, wy] = screenToWorld(cam, p.device[0], p.device[1]);
      expect(flatPick(wx, wy)).toEqual([t.tx, t.ty]);
    }
    expect(c.aim).toBeTruthy();
    expect(Math.abs(c.aim.x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(c.aim.y)).toBeLessThanOrEqual(0.5);
    // the harvester end really serves the industry it hangs off
    const probe = (window as unknown as { __iso: { tileProbe: (k: TrackKind, x: number, y: number) => { harvester: { ok: boolean } } } })
      .__iso.tileProbe("road", c.hx, c.hy);
    expect(probe.harvester.ok).toBe(true);
    // the corridor never sits in the strip a panel owns
    for (const t of c.col) {
      const p = aimPoint(c.aim, t.tx, t.ty);
      expect(p.x).toBeGreaterThan(boxes.left.right);
      expect(p.x).toBeLessThan(boxes.right.left);
    }
  });

  it("the picked corridor is a drag the game actually lays, for free, untruncated", () => {
    const { grid } = scene(1337, 1);
    if (!track) throw new Error("hook not installed");
    const c = findIsoCorridor() as Corridor;
    // the same setup state the spec's two clicks leave behind, then the same
    // preview the pointer drag computes (W1's single cost model).
    eco.factories.push({ owner: "you", ownerId: 1, tx: c.fx, ty: c.fy });
    eco.harvesters.push({ id: 1, owner: "you", ownerId: 1, tx: c.hx, ty: c.hy });
    const net = playerNetwork(track, 1, eco.factories, eco.harvesters);
    const pv = previewDrag(grid, track, "road", { stone: 12 }, c.fx, c.fy, c.hx, c.hy, true, net, 12);
    expect(pv.truncated).toBe(false);
    expect(pv.tiles).toHaveLength(c.tiles);
    expect(pv.cost).toEqual({});
    expect(pv.free).toBe(c.tiles);
    expect(pv.unaffordable).toEqual([]);
  });

  it("is not seed-luck: the same search works on the other swept seeds and at zoom 1", () => {
    for (const [seed, wheelOut] of [[1337, 0], [7, 1], [2024, 1], [1337, 1]] as const) {
      scene(seed, wheelOut);
      const c = findIsoCorridor({ minTiles: 3, maxTiles: 7 });
      expect(c.tiles).toBeGreaterThanOrEqual(3);
    }
  });

  it("survives the serialization page.evaluate does (self-contained source)", () => {
    scene(1337, 1);
    const direct = findIsoCorridor();
    // exactly what Playwright ships into the browser: the function's source,
    // revived with no module scope around it.
    const src = `(${findIsoCorridor.toString()})()`;
    const revived = new Function(`return ${src};`) as () => Corridor;
    const inPage = revived();
    expect(inPage).toEqual(direct);
    expect(findIsoCorridor.toString()).not.toMatch(/__name\(|require\(|__vi_esm/);
  });

  it("fails LOUDLY when HUD chrome covers the map, naming the coverer", () => {
    scene(1337, 1);
    // the banner grows to swallow the map — a plausible layout regression
    boxes.banner = { left: 0, top: 0, right: VIEW_W, bottom: VIEW_H };
    const err = (() => { try { findIsoCorridor(); return null; } catch (e) { return e as Error; } })();
    expect(err).not.toBeNull();
    expect(err!.message).toMatch(/no \d+–\d+-tile corridor/);
    expect(err!.message).toMatch(/covered:div#iso-banner/);
    expect(err!.message).toMatch(/Closest: industry/);
    expect(err!.message).toMatch(/Rejections: \{"covered":\d+/);
    expect(err!.message).toMatch(/examples: \{"covered":"covered:div#iso-banner/);
    expect(err!.message).toMatch(/band \d+px/);
  });

  it("guards with a geometry message when the corridor cannot fit the band (A4)", () => {
    scene(1337, 2);          // zoom 0.25-ish clamps at the lowest step: 0.5
    const err = (() => { try { return findIsoCorridor({ minTiles: 20, maxTiles: 24 }); } catch (e) { return e as Error; } })();
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/cannot fit between the HUD panels/);
    expect(err!.message).toMatch(/tile step \d+×\d+px/);
    expect(err!.message).toMatch(/do NOT shrink the corridor or relax the hit-test/);
  });

  it("isoTileOcclusion (the spec's own A2 check) agrees with the picker", () => {
    scene(1337, 1);
    const c = findIsoCorridor() as Corridor;
    expect(isoTileOcclusion({ tiles: c.col, aim: c.aim })).toEqual([]);
    // and it does report a genuinely covered tile: aim at the panel strip
    const inPanel = (() => {
      // any tile of the map, projected — then nudge until it lands under the
      // left aside; this is a check on the CHECKER, not on the picker.
      for (let ty = 0; ty < MAP_H; ty++) {
        for (let tx = 0; tx < MAP_W; tx++) {
          const p = centre(tx, ty);

          if (inside(boxes.left, p.x, p.y)) return { tx, ty };
        }
      }
      return null;
    })();
    expect(inPanel).not.toBeNull();
    const hits = isoTileOcclusion({ tiles: [inPanel!] });
    expect(hits).toHaveLength(1);
    expect(hits[0].coveredBy).toMatch(/aside\.left\.iso-panel/);
  });
});

// ── the pre-cutover assumption, measured (why the ticket exists) ──────────
// The old helper demanded exactly 7 tiles due south of `ind.tx`, which at the
// new geometry needed a ~396×256 px window in a 196 px sliver of lattice. This
// is the same filter, replayed — so the fix is provably a fix and not a
// loosened assertion.
function oldFindSouthColumn(grid: ReturnType<typeof generateMap>): Corridor | null {
  const dpr = DPR;
  const at = (tx: number, ty: number) => {
    const [x, y] = tileToScreenAt(cam, tx, ty);
    return [x / dpr, y / dpr] as [number, number];
  };
  const inView = (tx: number, ty: number) => {
    const [x, y] = at(tx, ty);
    return x >= -20 && x <= VIEW_W + 20 && y >= -20 && y <= VIEW_H + 20;
  };
  for (const ind of grid.industries) {
    const hx = ind.tx, hy = ind.ty + ind.h, fy = hy + 6;
    if (hx < 0 || hx >= MAP_W || fy >= MAP_H) continue;
    if (!inView(hx, fy) || !inView(hx + 1, fy + 1)) continue;
    let ok = true;
    for (let y = hy; y <= fy; y++) {
      if (buildRefusal(grid, "road", hx, y) !== null) { ok = false; break; }
      if (!inView(hx, y)) { ok = false; break; }
      const [x, y2] = at(hx, y);
      if (topAt(x, y2).kind !== "canvas") { ok = false; break; }
    }
    if (!ok) continue;
    return { hx, hy, fx: hx, fy, dir: "SW", tiles: 7, margin: 0, industry: ind.id, col: [] };
  }
  return null;
}

describe("E14 the old 7-tile south column is the thing that broke", () => {
  it("does not exist on seed 1337 at the boot camera, while the new picker does", () => {
    const { grid } = scene(1337, 1);
    expect(oldFindSouthColumn(grid)).toBeNull();
    expect(findIsoCorridor()).not.toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The click point the SPEC uses is the point the corridor was CHOSEN on.
// The first CI run of the E14 spec failed here, not in the picker: the spec
// derived its own tile step from the target tile instead of (0,0)→(0,1), so
// `aim.y = 0.5` moved the mouse sixteen tiles while the corridor search, the
// occlusion re-check and the pixel samples all stayed on the right tile. Both
// halves are pinned below: the shared helper agrees with an independent
// measurement, and a mis-scaled offset is refused by name instead of clicking
// somewhere else silently.
// ══════════════════════════════════════════════════════════════════════════
describe("E14 the click point is measured once, and verified before it is used", () => {
  const revive = <A, R>(fn: (a: A) => R) =>
    new Function(`return (${fn.toString()});`)() as (a: A) => R;

  it("isoTileClickPoint matches an independent measurement, in both call forms", () => {
    scene(1337, 1);
    const c = findIsoCorridor({ minTiles: 4, maxTiles: 7 });
    const inPage = revive(isoTileClickPoint);
    // the revived source must stand alone, like the other two
    expect(isoTileClickPoint.toString()).not.toMatch(/__name\(|require\(|__vi_esm/);

    let tightest = Infinity;
    for (const t of c.col) {
      for (const run of [isoTileClickPoint, inPage]) {
        const p = run({ tx: t.tx, ty: t.ty, aim: c.aim });
        const want = aimPoint(c.aim, t.tx, t.ty);
        expect(p.x).toBeCloseTo(want.x, 6);
        expect(p.y).toBeCloseTo(want.y, 6);
        // the game's own pick (stage 1 here, both stages in the browser)
        // resolves the point back to the tile it was asked for
        expect([p.pickedTx, p.pickedTy]).toEqual([t.tx, t.ty]);
      }
      const p = isoTileClickPoint({ tx: t.tx, ty: t.ty, aim: c.aim });
      // A2 again, from the CSS rects rather than from any helper
      expect(topAt(p.x, p.y).kind).toBe("canvas");
      expect(flatPick(...screenToWorld(cam, p.x * DPR, p.y * DPR))).toEqual([t.tx, t.ty]);
      tightest = Math.min(tightest, p.x - boxes.left.right, boxes.right.left - p.x);
    }
    // the clearance the picker reported IS the clearance of the point the spec
    // clicks: one measurement, two consumers, no drift possible.
    expect(Math.abs(tightest - c.margin)).toBeLessThan(1);
  });

  it("refuses an offset scaled the way the spec once scaled it", () => {
    scene(1337, 1);
    const c = findIsoCorridor({ minTiles: 4, maxTiles: 7 });
    const t = c.col[c.tiles - 1];                 // the factory tile, (24,10)-ish
    const [dx, dy] = tileToScreenAt(cam, t.tx, t.ty);
    const [, sy0] = tileToScreenAt(cam, 0, 0);
    const [nx, ny] = tileToScreenAt(cam, 0, 1);
    const stepY = Math.abs(ny - sy0);             // the step as it should be measured
    // the pre-fix step: measured against the target tile, so ~tiles long
    const badStepY = Math.abs(ny - dy);
    const badDevice: [number, number] = [dx, dy + 0.5 * badStepY];
    const landed = flatPick(...screenToWorld(cam, badDevice[0], badDevice[1]));
    // the bug is real in this geometry: the click was on another tile
    expect([landed[0], landed[1]]).not.toEqual([t.tx, t.ty]);
    expect(badStepY / stepY).toBeGreaterThan(1);

    // and the guard says so, naming the tile the old formula landed on
    const aimY = (0.5 * badStepY) / stepY;
    expect(() => isoTileClickPoint({ tx: t.tx, ty: t.ty, aim: { x: 0, y: aimY } }))
      .toThrow(new RegExp(`\\(${landed[0]},${landed[1]}\\)`));
    try {
      isoTileClickPoint({ tx: t.tx, ty: t.ty, aim: { x: 0, y: aimY } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      expect(msg).toContain("not the requested tile");
      expect(msg).toContain("ONE measured tile step");
    }
  });
});
