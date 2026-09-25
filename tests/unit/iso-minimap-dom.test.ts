// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// M1 (#254) — the minimap CONTROLLER in a DOM: it mounts nothing until the
// plate is laid out (so a headless game harness never sees a fifth canvas),
// redraws each layer only when its key moves, turns a click into the camera
// the pure rules promise, catches up after being hidden, and tears down.
// The pure rules themselves are pinned in iso-minimap.test.ts.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MAP_W, MAP_H, tileToScreen } from "../../src/game/config";
import { centerOnTile, createCamera, worldToScreen, type Camera } from "../../src/iso/camera";
import { createTrack } from "../../src/iso/track";
import { createMinimap, minimapLayout, tileToMinimap, type Minimap, type MinimapScene } from "../../src/iso/minimap";

/** A ResizeObserver the test drives by hand. */
class FakeRO {
  static last: FakeRO | null = null;
  targets = new Set<Element>();
  constructor(private cb: ResizeObserverCallback) { FakeRO.last = this; }
  observe(t: Element) { this.targets.add(t); }
  unobserve(t: Element) { this.targets.delete(t); }
  disconnect() { this.targets.clear(); }
  fire(t: Element, width: number, height: number) {
    if (!this.targets.has(t)) return;
    this.cb([{ target: t, contentRect: { width, height } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

let calls: string[];
const fakeCtx = () => new Proxy({} as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    if (prop === "createImageData") {
      return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    }
    return (..._args: unknown[]) => { calls.push(prop); };
  },
  set(target, prop: string, v) { target[prop] = v; return true; },
});

let host: HTMLElement;
let cam: Camera;
let commits: Camera[];
let scenes: number;
let mm: Minimap;
const scene = (): MinimapScene => { scenes++; return { track: createTrack(), towns: [], sites: [] }; };

beforeEach(() => {
  calls = [];
  commits = [];
  scenes = 0;
  (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement) { calls.push("getContext"); return fakeCtx() as never; } as never);
  host = document.createElement("div");
  document.body.appendChild(host);
  cam = centerOnTile(createCamera(1280, 720), 40, 40);
  mm = createMinimap(host, {
    ground: { terrain: new Uint8Array(MAP_W * MAP_H) },
    camera: () => cam,
    commit: (next) => { cam = next; commits.push(next); },
    scene,
  });
});

afterEach(() => {
  mm.destroy();
  host.remove();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).ResizeObserver;
});

/** Lay the plate out: the host gets a box, then the mounted canvas does. */
function layOut(w = 216, h = 108): HTMLCanvasElement {
  FakeRO.last!.fire(host, w - 10, 0);
  const c = host.querySelector("canvas.minimap-canvas") as HTMLCanvasElement;
  c.getBoundingClientRect = () => ({ left: 100, top: 50, width: w, height: h, right: 100 + w, bottom: 50 + h, x: 100, y: 50, toJSON() {} }) as DOMRect;
  FakeRO.last!.fire(c, w, h);
  return c;
}

describe("M1 minimap controller", () => {
  it("mounts no canvas and touches no context until the plate is laid out", () => {
    expect(mm.canvas).toBeNull();
    expect(host.querySelectorAll("canvas")).toHaveLength(0);
    for (let i = 0; i < 5; i++) mm.frame(i, 0);
    expect(calls).toEqual([]);
    expect(scenes).toBe(0);
    expect(mm.visible).toBe(false);
    // a zero-width report (a folded plate) still mounts nothing
    FakeRO.last!.fire(host, 0, 0);
    expect(host.querySelectorAll("canvas")).toHaveLength(0);
    const c = layOut();
    expect(mm.canvas).toBe(c);
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
    expect(mm.visible).toBe(true);
    mm.frame(0, 0);                       // the backing store is sized on the first frame
    expect([c.width, c.height]).toEqual([432, 216]);   // supersampled ≥2× on a dpr-1 screen
  });

  it("redraws terrain once, the network on its key, the view on the camera", () => {
    layOut();
    mm.frame(0, 0);
    expect(mm.stats).toMatchObject({ terrain: 1, network: 1, view: 1 });
    expect(scenes).toBe(1);
    mm.frame(0, 0);
    mm.frame(0, 0);
    expect(mm.stats).toMatchObject({ terrain: 1, network: 1, view: 1 });
    for (let i = 1; i <= 10; i++) { cam = { ...cam, x: cam.x - 5 }; mm.frame(0, 0); }
    expect(mm.stats).toMatchObject({ terrain: 1, network: 1, view: 11 });
    expect(scenes).toBe(1);               // panning never re-reads the world
    mm.frame(1, 0);
    mm.frame(1, 3);
    expect(mm.stats).toMatchObject({ terrain: 1, network: 3, view: 13 });
    expect(scenes).toBe(3);
  });

  it("a click centres the main view on the clicked spot, through commit", () => {
    const c = layOut();
    mm.frame(0, 0);
    const [mx, my] = tileToMinimap(minimapLayout(216, 108), 100.5, 30.5);
    c.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 100 + mx, clientY: 50 + my, button: 0, isPrimary: true, pointerType: "mouse", pointerId: 1, bubbles: true,
    }));
    c.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, pointerType: "mouse", bubbles: true }));
    expect(commits).toHaveLength(1);
    const [wx, wy] = tileToScreen(100.5, 30.5);
    const [sx, sy] = worldToScreen(cam, wx, wy);
    expect(sx).toBeCloseTo(640, 6);
    expect(sy).toBeCloseTo(360, 6);
    // the right button and non-primary pointers do nothing
    c.dispatchEvent(new PointerEvent("pointerdown", { clientX: 110, clientY: 60, button: 2, isPrimary: true, pointerType: "mouse" }));
    c.dispatchEvent(new PointerEvent("pointerdown", { clientX: 110, clientY: 60, button: 0, isPrimary: false, pointerType: "touch" }));
    expect(commits).toHaveLength(1);
  });

  it("a click on a marker goes to onMarker instead of panning, and goTo pans", () => {
    const c = layOut();
    mm.setMarkers([{ id: "protest:1", tx: 20, ty: 100, color: "#5aa8ff", progress: 0.5, kind: "protest" }]);
    mm.frame(0, 0);
    const opened: string[] = [];
    mm.onMarker = (m) => opened.push(m.id);
    const [mx, my] = tileToMinimap(minimapLayout(216, 108), 20.5, 100.5);
    c.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100 + mx, clientY: 50 + my, button: 0, isPrimary: true, pointerType: "mouse", pointerId: 2 }));
    expect(opened).toEqual(["protest:1"]);
    expect(commits).toHaveLength(0);
    mm.goTo(20, 100);
    const [wx, wy] = tileToScreen(20.5, 100.5);
    expect(worldToScreen(cam, wx, wy).map((v) => Math.round(v))).toEqual([640, 360]);
  });

  it("does no work while folded, and catches up the moment it shows again", () => {
    const c = layOut();
    mm.frame(0, 0);
    const before = { ...mm.stats };
    FakeRO.last!.fire(c, 0, 0);           // folded (display: none)
    expect(mm.visible).toBe(false);
    for (let i = 1; i <= 20; i++) { cam = { ...cam, x: cam.x - 3 }; mm.frame(i, i); }
    expect(mm.stats).toMatchObject({ terrain: before.terrain, network: before.network, view: before.view });
    FakeRO.last!.fire(c, 216, 108);       // unfolded
    mm.frame(20, 20);
    expect(mm.stats).toMatchObject({ terrain: 1, network: before.network + 1, view: before.view + 1 });
  });

  it("markers redraw the view only when their picture changes", () => {
    layOut();
    mm.frame(0, 0);
    const list = (p: number) => [{ id: "blockade:4", tx: 50, ty: 50, color: "#ff7a5a", progress: p }];
    mm.setMarkers(list(0.5));
    mm.frame(0, 0);
    const v = mm.stats.view;
    for (let i = 0; i < 10; i++) { mm.setMarkers(list(0.5 + i * 0.0005)); mm.frame(0, 0); }
    expect(mm.stats.view).toBe(v);
    mm.setMarkers([]);                    // the event ended: gone next frame
    mm.frame(0, 0);
    expect(mm.stats.view).toBe(v + 1);
    expect(mm.markers).toEqual([]);
  });

  it("destroy removes the canvas and stops listening", () => {
    const c = layOut();
    mm.destroy();
    expect(host.querySelectorAll("canvas")).toHaveLength(0);
    expect(mm.canvas).toBeNull();
    expect(FakeRO.last!.targets.size).toBe(0);
    c.dispatchEvent(new PointerEvent("pointerdown", { clientX: 150, clientY: 80, button: 0, isPrimary: true, pointerType: "mouse" }));
    mm.frame(9, 9);
    expect(commits).toHaveLength(0);
  });
});
