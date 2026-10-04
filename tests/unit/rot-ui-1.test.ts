// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// ROT-UI-1 — the rotate keys under the minimap plate, and the plate that turns
// with the view.
//
// Three claims, tested as separately as they can be:
//
//   • THE KEYS — two `.icon-btn`s live inside the plate (never over the map),
//     they are hidden until the ONE predicate says the view can turn
//     (`rotationAvailable()`, three-layer.ts), they report through the game's
//     own hook, and the FIRST button-turn names the `[` / `]` keys with a
//     once-per-profile toast.
//   • THE TURN — the plate is turned world: a click still centres the tile the
//     arrows point at, the view rectangle is exactly what the main canvas
//     shows, and map-north points up / left / down / right at the quarter
//     turns. All four yaws, on the SAME rules the app runs.
//   • THE COST — the redraw gate sees a turn (and only a turn) as a view
//     change: a settled view redraws nothing.
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Board } from "../../src/game/board";
import { mulberry32, setRng, MAP_H, MAP_W, tileToScreen } from "../../src/game/config";
import { createOriginalUi, takeRotateHint, ROTATE_HINT_KEY, type OriginalUi } from "../../src/game/ui";
import { emptyBag } from "../../src/iso/purse";
import {
  centerOnTile, createCamera, getViewYaw, getViewYawTarget, rotateViewStep, screenToTileAt, screenToWorld,
  snapViewYaw, tickViewYaw, worldToScreen, turnWorld, type Camera,
} from "../../src/iso/camera";
import {
  cameraAt, createMinimap, createRedrawGate, minimapLayout, minimapToTile, networkKey, northBadgeAt,
  northDir, pressAt, rectContains, tileToMinimap, viewKey, viewportRect, type Minimap,
} from "../../src/iso/minimap";
import { createTrack } from "../../src/iso/track";
import { rotationAvailable, threeWanted } from "../../src/iso/three-layer";

/** A ResizeObserver the test drives by hand (the iso-minimap-dom harness). */
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

const YAW = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2] as const;
const name = (i: number) => `yaw ${i * 90}`;

function viewport(w = 1280, h = 800) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: h });
}
function mount(hooks: Record<string, unknown> = {}): OriginalUi {
  setRng(mulberry32(7));
  const ui = createOriginalUi(new Board(), { id: "you", name: "You", res: emptyBag(), unlocked: null }, {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(),
    onBank: vi.fn(() => "done" as const), onBlackAction: vi.fn(), onSell: vi.fn(() => 10),
    requestBoardSize: () => false,
    ...hooks,
  } as never);
  document.body.append(ui.el);
  return ui;
}
const row = (ui: OriginalUi) => ui.el.querySelector<HTMLElement>(".minimap-rotate")!;
const keys = (ui: OriginalUi) => [...ui.el.querySelectorAll<HTMLButtonElement>(".minimap-rotate button")];
const toastTexts = (ui: OriginalUi) =>
  [...ui.el.querySelectorAll(".toast .toast-msg")].map((n) => n.textContent);

/** The plate as the app fits it right now (the live yaw is part of the fit). */
const plate = () => minimapLayout(200, 100, 2);

beforeEach(() => {
  vi.useFakeTimers();
  viewport();
  (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  localStorage.removeItem(ROTATE_HINT_KEY);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).ResizeObserver;
  snapViewYaw(createCamera(800, 600), 0);   // the yaw is module state: leave it at 0
});

describe("ROT-UI-1 — the rotate keys", () => {
  it("the predicate is the 3D layer's, and a 2D boot does not satisfy it", () => {
    expect(rotationAvailable()).toBe(false);           // nothing mounted here (no WebGL in jsdom)
    expect(threeWanted("")).toBe(false);               // no ?three=1
    expect(threeWanted("?three=1")).toBe(true);        // asked for, but the mount is what counts
  });

  it("renders under the minimap canvas, hidden until rotation is available", () => {
    const ui = mount();
    const r = row(ui);
    expect(r).not.toBeNull();
    // in the plate, and the map is the plate's first child (the canvas mounts later, above the chrome)
    expect(ui.minimapHost.contains(r)).toBe(true);
    expect(r.classList.contains("hidden")).toBe(true);
    expect(r.getAttribute("aria-hidden")).toBe("true");

    const [left, right] = keys(ui);
    expect(keys(ui).length).toBe(2);
    expect(left.title).toBe("Rotate view left ([)");
    expect(left.getAttribute("aria-label")).toBe("Rotate view left ([)");
    expect(right.title).toBe("Rotate view right (])");
    expect(right.getAttribute("aria-label")).toBe("Rotate view right (])");
    expect(left.querySelector("svg.hud-ic")).not.toBeNull();   // a stroke key, like every HUD key

    ui.setRotationAvailable(true);
    expect(r.classList.contains("hidden")).toBe(false);
    expect(r.getAttribute("aria-hidden")).toBe("false");
    ui.setRotationAvailable(false);
    expect(r.classList.contains("hidden")).toBe(true);
  });

  it("the minimap canvas is inserted ABOVE the chrome row when the plate is laid out", () => {
    const ui = mount();
    const mm: Minimap = createMinimap(ui.minimapHost, {
      ground: { terrain: new Uint8Array(MAP_W * MAP_H) },
      camera: () => createCamera(1280, 720),
      commit: () => {},
      scene: () => ({ track: createTrack(), towns: [], sites: [] }),
    });
    FakeRO.last!.fire(ui.minimapHost, 200, 0);   // the plate is laid out → the canvas mounts
    expect(ui.minimapHost.firstElementChild?.tagName).toBe("CANVAS");
    expect(ui.minimapHost.querySelector(".minimap-rotate")).not.toBeNull();
    mm.destroy();
  });

  it("a click reports through the game's hook, exactly like the keys", () => {
    const onRotate = vi.fn();
    const ui = mount({ onRotate });
    ui.setRotationAvailable(true);
    const [left, right] = keys(ui);
    left.click();
    right.click();
    expect(onRotate.mock.calls).toEqual([[-1], [1]]);
    // and the hook's own write is the step the keys use
    snapViewYaw(createCamera(800, 600), 0);
    expect(getViewYawTarget()).toBe(0);
    onRotate.mock.calls.forEach(([dir]) => rotateViewStep(dir));   // what game.ts wires it to
    expect(getViewYawTarget()).toBeCloseTo(0, 9);                  // −1 then +1
    rotateViewStep(1);
    expect(getViewYawTarget()).toBeCloseTo(Math.PI / 2, 9);
  });

  it("the first button-turn names the keys, once per profile", () => {
    const ui = mount({ onRotate: vi.fn() });
    ui.setRotationAvailable(true);
    const [left] = keys(ui);
    left.click();
    expect(toastTexts(ui)).toEqual(["Tip: [ and ] rotate too"]);
    expect(takeRotateHint()).toBe(false);   // the profile now knows
    // let the toast close, then turn again: the gate — not the toast queue — is what silences it
    vi.advanceTimersByTime(4000);
    expect(toastTexts(ui)).toEqual([]);
    left.click();
    expect(toastTexts(ui)).toEqual([]);
  });

  it("the tip gate is pure: first call true, later calls false, refused storage true", () => {
    const store = new Map<string, string>();
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    expect(takeRotateHint(fake)).toBe(true);
    expect(store.get(ROTATE_HINT_KEY)).toBe("seen");
    expect(takeRotateHint(fake)).toBe(false);
    expect(takeRotateHint(fake)).toBe(false);
    expect(takeRotateHint(null)).toBe(true);   // no storage (a private tab): show it
    const refuses = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(takeRotateHint(refuses)).toBe(true);
  });
});

describe("ROT-UI-1 — one rotate step, eased like the keys", () => {
  it("moves the yaw target a quarter turn at a time and eases toward it", () => {
    snapViewYaw(createCamera(800, 600), 0);
    rotateViewStep(1);
    expect(getViewYawTarget()).toBeCloseTo(Math.PI / 2, 9);
    expect(getViewYaw()).toBe(0);                       // nothing moves until the loop ticks
    expect(tickViewYaw(createCamera(800, 600), 16)).not.toBeNull();
    expect(getViewYaw()).toBeGreaterThan(0);
    expect(getViewYaw()).toBeLessThan(Math.PI / 2);
    rotateViewStep(-1);
    expect(getViewYawTarget()).toBeCloseTo(0, 9);
  });
});

describe("ROT-UI-1 — the plate turns with the view", () => {
  it("a click still centres the tile under the pointer, at every yaw", () => {
    YAW.forEach((yaw, i) => {
      const cam = snapViewYaw(centerOnTile(createCamera(1280, 720), 72, 72), yaw);
      const l = plate();
      for (const [tx, ty] of [[72, 72], [60, 80], [88, 62]] as const) {
        const [mx, my] = tileToMinimap(l, tx + 0.5, ty + 0.5);
        // the pointer is over that tile on the turned plate …
        expect(minimapToTile(l, mx, my).map(Math.floor), name(i)).toEqual([tx, ty]);
        // … and the camera write centres the tile's middle in the main canvas
        const next = cameraAt(cam, l, mx, my);
        const [wx, wy] = tileToScreen(tx + 0.5, ty + 0.5);
        const [sx, sy] = worldToScreen(next, wx, wy);
        expect(sx, name(i)).toBeCloseTo(next.vw / 2, 6);
        expect(sy, name(i)).toBeCloseTo(next.vh / 2, 6);
        expect(screenToTileAt(next, next.vw / 2, next.vh / 2), name(i)).toEqual([tx, ty]);
      }
    });
  });

  it("the view rectangle is the main canvas, and a press inside it does not jump", () => {
    for (const yaw of YAW) {
      const cam = snapViewYaw(centerOnTile(createCamera(1280, 720), 72, 72), yaw);
      const l = plate();
      const r = viewportRect(l, cam);
      expect(r.w).toBeCloseTo((cam.vw / cam.zoom) * l.s, 9);
      expect(r.h).toBeCloseTo((cam.vh / cam.zoom) * l.s, 9);
      // the tile at the middle of the main canvas is inside the drawn rectangle
      const [tx, ty] = screenToTileAt(cam, cam.vw / 2, cam.vh / 2);
      expect(rectContains(r, ...tileToMinimap(l, tx + 0.5, ty + 0.5))).toBe(true);
      // the rectangle's middle is the world point at the canvas centre
      const [wx, wy] = screenToWorld(cam, cam.vw / 2, cam.vh / 2);
      const [px, py] = worldToScreen(cam, wx, wy);
      expect(px).toBeCloseTo(cam.vw / 2, 6);   // (screenToWorld/worldToScreen round-trip under the turn)
      expect(py).toBeCloseTo(cam.vh / 2, 6);
      const press = pressAt(l, cam, r.x + r.w / 2, r.y + r.h / 2, null, 7);
      expect(press.kind).toBe("pan");
      if (press.kind === "pan") expect(press.camera).toBe(cam);   // grabbing the frame moves nothing
    }
  });

  it("map north points up / left / down / right at the quarter turns, and the badge sits that way", () => {
    const want: [number, number][] = [[0, -1], [-1, 0], [0, 1], [1, 0]];
    YAW.forEach((yaw, i) => {
      const [dx, dy] = northDir(yaw);
      expect(dx, name(i)).toBeCloseTo(want[i][0], 9);
      expect(dy).toBeCloseTo(want[i][1], 9);
      const l = plate();
      const [bx, by] = northBadgeAt(l, yaw);
      // inside the plate …
      expect(bx).toBeGreaterThanOrEqual(0); expect(bx).toBeLessThanOrEqual(l.w);
      expect(by).toBeGreaterThanOrEqual(0); expect(by).toBeLessThanOrEqual(l.h);
      // … and on the north side of its middle
      const vx = bx - l.w / 2, vy = by - l.h / 2;
      expect(vx * dx + vy * dy).toBeGreaterThan(0);
      expect(Math.abs(vx * dy - vy * dx)).toBeLessThan(1e-9);
    });
    // mid-turn it is still the turned map-north, normalised
    for (const yaw of [0.4, 1.1, 2.7]) {
      const [x, y] = turnWorld(0, -1, yaw);
      const d = Math.hypot(x, y);
      const [dx, dy] = northDir(yaw);
      expect(Math.abs(dx - x / d)).toBeLessThan(1e-12);
      expect(Math.abs(dy - y / d)).toBeLessThan(1e-12);
      expect(Math.hypot(dx, dy)).toBeCloseTo(1, 12);
    }
  });

  it("a CLICK on the plate at a turned yaw commits a camera centred on the clicked tile", () => {
    // The controller path end-to-end: pointer → pressAt → cameraAt → commit, at
    // each quarter turn. A fake 2D context lets the plate lay out for real.
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(target, prop: string) {
        if (prop in target) return target[prop];
        if (prop === "createImageData") {
          return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        }
        return () => {};
      },
      set(target, prop: string, v) { target[prop] = v; return true; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
    const host = document.createElement("div");
    document.body.appendChild(host);
    let cam = centerOnTile(createCamera(1280, 720), 72, 72);
    const mm = createMinimap(host, {
      ground: { terrain: new Uint8Array(MAP_W * MAP_H) },
      camera: () => cam,
      commit: (next) => { cam = next; },
      scene: () => ({ track: createTrack(), towns: [], sites: [] }),
    });
    FakeRO.last!.fire(host, 206, 0);
    const c = host.querySelector("canvas.minimap-canvas") as HTMLCanvasElement;
    c.getBoundingClientRect = () => ({
      left: 100, top: 50, width: 216, height: 108, right: 316, bottom: 158, x: 100, y: 50, toJSON() {},
    }) as DOMRect;
    FakeRO.last!.fire(c, 216, 108);
    mm.frame(0, 0);

    YAW.forEach((yaw, i) => {
      cam = snapViewYaw(cam, yaw);
      mm.frame(0, 0);                                  // the turn re-fits the plate's own layout
      const l = minimapLayout(216, 108);               // the controller's own fit (pad 3)
      for (const [tx, ty] of [[100, 40], [40, 100]] as const) {
        const before = { ...cam };
        const [mx, my] = tileToMinimap(l, tx + 0.5, ty + 0.5);
        c.dispatchEvent(new PointerEvent("pointerdown", {
          clientX: 100 + mx, clientY: 50 + my, button: 0, isPrimary: true, pointerType: "mouse", pointerId: 9, bubbles: true,
        }));
        c.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, isPrimary: true, pointerType: "mouse", bubbles: true }));
        expect(cam, name(i)).not.toEqual(before);      // the click MOVE (the tile is off the view rect)
        expect(screenToTileAt(cam, cam.vw / 2, cam.vh / 2), name(i)).toEqual([tx, ty]);
        expect([cam.zoom, cam.vw, cam.vh]).toEqual([1, 1280, 720]);
      }
    });
    mm.destroy();
  });

  it("the redraw gate sees a turn, and only a turn, as a view change", () => {
    const cam: Camera = centerOnTile(createCamera(1280, 720), 40, 40);
    const map = {};
    const size = "432x216@216x108";
    const gate = createRedrawGate();
    const frame = (yaw: number) => ({ map, net: networkKey(0, 0), view: viewKey(cam, size, "", yaw) });
    expect(viewKey(cam, size, "", Math.PI / 2)).not.toBe(viewKey(cam, size, "", 0));
    expect(viewKey(cam, size, "", 0.3)).not.toBe(viewKey(cam, size, "", 0));     // mid-ease redraws
    expect(viewKey(cam, size, "", 0)).toBe(viewKey(cam, size, "", 0));           // settled: same key
    expect(gate.next(frame(0))).toEqual({ terrain: true, network: true, view: true });
    expect(gate.next(frame(0))).toEqual({ terrain: false, network: false, view: false });   // still frame
    expect(gate.next(frame(Math.PI / 2))).toEqual({ terrain: false, network: false, view: true });  // the turn
    expect(gate.next(frame(Math.PI / 2))).toEqual({ terrain: false, network: false, view: false });
  });
});
