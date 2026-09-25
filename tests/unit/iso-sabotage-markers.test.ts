// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// M2 (#256) — Sabotage events on the minimap & the Sabotage Event Window.
//
// Tests:
// - Collection of live protests and blockades into sabotage events.
// - Conversion to MinimapMarker objects with owner colours & countdown rings.
// - Redraw-on-change gate: minimap does not redraw per frame while ring step is unchanged.
// - Sabotage Image Slot component: sets correct image per sabotage kind.
// - Sabotage Event Window component: open, live countdown update, auto-close on expiry,
//   "Go there" pan, and dismiss.
// - Integration: clicking a marker on minimap opens event window; "Go there" pans camera.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { BANDIT_MS, PROTEST_MS, MAP_W, MAP_H, tileToScreen } from "../../src/game/config";
import { centerOnTile, createCamera, worldToScreen, type Camera } from "../../src/iso/camera";
import { createTrack } from "../../src/iso/track";
import {
  createMinimap, createRedrawGate, markersKey, minimapLayout, tileToMinimap,
  type Minimap, type MinimapScene,
} from "../../src/iso/minimap";
import {
  collectSabotageEvents, sabotageEventsToMarkers, collectSabotageMarkers,
  fmtSabotageCountdown, createSabotageImageSlot, createSabotageEventWindow,
  type Protest, type SabotageEvent, type SabotageIndustryTarget, type SabotagePlayerInfo,
} from "../../src/iso/protest";

// Mock asset images for jsdom
vi.mock("../../src/assets/sabotage/blockade.png", () => ({ default: "blockade.png" }));
vi.mock("../../src/assets/sabotage/protest.png", () => ({ default: "protest.png" }));

describe("M2 sabotage events — data collection and markers", () => {
  const players: SabotagePlayerInfo[] = [
    { id: "you", name: "Player", colour: "#5aa8ff" },
    { id: "ai", name: "Torvin", colour: "#ff7a5a" },
  ];

  it("formats countdown times correctly", () => {
    expect(fmtSabotageCountdown(45000)).toBe("0:45");
    expect(fmtSabotageCountdown(120000)).toBe("2:00");
    expect(fmtSabotageCountdown(65000)).toBe("1:05");
    expect(fmtSabotageCountdown(0)).toBe("0:00");
    expect(fmtSabotageCountdown(-500)).toBe("0:00");
  });

  it("collects active protests and blockades into sabotage events", () => {
    const now = 10000;
    const protests: Protest[] = [
      { tx: 25, ty: 40, until: now + 60000, owner: "you" },
      { tx: 30, ty: 50, until: now - 1000, owner: "ai" }, // expired
    ];
    const industries: SabotageIndustryTarget[] = [
      { id: 1, tx: 10, ty: 20, w: 3, h: 3, type: "coal_mine", banditUntil: now + 30000, banditOwner: "ai" },
      { id: 2, tx: 60, ty: 70, w: 4, h: 4, type: "farm", banditUntil: now - 500, banditOwner: "you" }, // expired
    ];

    const events = collectSabotageEvents({ protests, industries, players, now });
    expect(events).toHaveLength(2);

    const prot = events.find((e) => e.kind === "protest")!;
    expect(prot).toBeDefined();
    expect(prot.id).toBe("protest:25,40");
    expect(prot.tx).toBe(25);
    expect(prot.ty).toBe(40);
    expect(prot.owner).toBe("you");
    expect(prot.targetName).toContain("Public Road");
    expect(prot.totalDuration).toBe(PROTEST_MS);

    const block = events.find((e) => e.kind === "blockade")!;
    expect(block).toBeDefined();
    expect(block.id).toBe("blockade:1");
    // Center of 3x3 footprint at (10, 20) is (10 + 1, 20 + 1) = (11, 21)
    expect(block.tx).toBe(11);
    expect(block.ty).toBe(21);
    expect(block.owner).toBe("ai");
    expect(block.targetName).toMatch(/Coal Mine|coal_mine/);
    expect(block.totalDuration).toBe(BANDIT_MS);
  });

  it("converts sabotage events to MinimapMarkers with owner colour and progress ring", () => {
    const now = 10000;
    const events: SabotageEvent[] = [
      {
        id: "protest:25,40",
        kind: "protest",
        tx: 25,
        ty: 40,
        until: now + 60000, // half of 120s
        totalDuration: PROTEST_MS,
        owner: "you",
        targetName: "Public Road (25, 40)",
        label: "Protest",
      },
      {
        id: "blockade:1",
        kind: "blockade",
        tx: 11,
        ty: 21,
        until: now + 45000, // full 45s
        totalDuration: BANDIT_MS,
        owner: "ai",
        targetName: "Coal Mine",
        label: "Blockade",
      },
    ];

    const markers = sabotageEventsToMarkers(events, players, now);
    expect(markers).toHaveLength(2);

    const pMarker = markers.find((m) => m.id === "protest:25,40")!;
    expect(pMarker.color).toBe("#5aa8ff"); // you
    expect(pMarker.progress).toBeCloseTo(0.5, 2);
    expect(pMarker.label).toMatch(/Protest — 1:00/);

    const bMarker = markers.find((m) => m.id === "blockade:1")!;
    expect(bMarker.color).toBe("#ff7a5a"); // ai
    expect(bMarker.progress).toBeCloseTo(1.0, 2);
    expect(bMarker.label).toMatch(/Blockade — 0:45/);
  });

  it("gating: markersKey preserves the redraw-on-change rule across minor time ticks", () => {
    const now = 10000;
    const events: SabotageEvent[] = [
      {
        id: "blockade:1",
        kind: "blockade",
        tx: 11,
        ty: 21,
        until: now + 40000,
        totalDuration: BANDIT_MS,
        owner: "ai",
        targetName: "Coal Mine",
        label: "Blockade",
      },
    ];

    const m0 = sabotageEventsToMarkers(events, players, now);
    const key0 = markersKey(m0);

    // 16ms later (next 60fps frame): ring step (1/48 of 45s = 937ms) does NOT change
    const m1 = sabotageEventsToMarkers(events, players, now + 16);
    const key1 = markersKey(m1);
    expect(key1).toBe(key0);

    // 1000ms later: ring step ticks!
    const m2 = sabotageEventsToMarkers(events, players, now + 1000);
    const key2 = markersKey(m2);
    expect(key2).not.toBe(key0);
  });
});

describe("M2 sabotage image slot (#258 component hook)", () => {
  it("creates an image slot component and switches images by kind", () => {
    const slot = createSabotageImageSlot("blockade");
    expect(slot.element.classList.contains("sabotage-image-slot")).toBe(true);
    expect(slot.img.src).toContain("blockade.png");
    expect(slot.element.dataset.kind).toBe("blockade");

    slot.setKind("protest");
    expect(slot.img.src).toContain("protest.png");
    expect(slot.element.dataset.kind).toBe("protest");

    slot.destroy();
  });
});

describe("M2 Sabotage Event Window component", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("mounts hidden and opens when an event is passed", () => {
    const goToSpy = vi.fn();
    const closeSpy = vi.fn();

    const win = createSabotageEventWindow({
      host,
      onGoTo: goToSpy,
      onClose: closeSpy,
      resolvePlayerName: (id) => (id === "you" ? "You" : "Torvin"),
    });

    expect(win.isOpen).toBe(false);
    expect(win.element.classList.contains("hidden")).toBe(true);

    const now = performance.now();
    const event: SabotageEvent = {
      id: "blockade:3",
      kind: "blockade",
      tx: 15,
      ty: 25,
      until: now + 35000,
      totalDuration: BANDIT_MS,
      owner: "ai",
      targetName: "Iron Ore Mine",
      label: "Blockade",
    };

    win.open(event);
    expect(win.isOpen).toBe(true);
    expect(win.element.classList.contains("hidden")).toBe(false);

    // Check title, owner, target and countdown text
    expect(win.element.querySelector(".sabotage-window-title")?.textContent).toMatch(/BLOCKADE/i);
    expect(win.element.querySelector(".sabotage-owner")?.textContent).toBe("Torvin");
    expect(win.element.querySelector(".sabotage-target")?.textContent).toBe("Iron Ore Mine");
    expect(win.element.querySelector(".sabotage-countdown")?.textContent).toBe("0:35");

    // "Go there" button
    const goToBtn = win.element.querySelector(".sabotage-goto-btn") as HTMLButtonElement;
    goToBtn.click();
    expect(goToSpy).toHaveBeenCalledWith(15, 25);

    // Close button
    const closeBtn = win.element.querySelector(".sabotage-window-close") as HTMLButtonElement;
    closeBtn.click();
    expect(win.isOpen).toBe(false);
    expect(win.element.classList.contains("hidden")).toBe(true);
    expect(closeSpy).toHaveBeenCalled();

    win.destroy();
  });

  it("automatically closes when sabotage expires", () => {
    const win = createSabotageEventWindow({ host, onGoTo: vi.fn() });
    const now = performance.now();
    const event: SabotageEvent = {
      id: "protest:10,20",
      kind: "protest",
      tx: 10,
      ty: 20,
      until: now + 1000,
      totalDuration: PROTEST_MS,
      owner: "you",
      targetName: "Public Road (10, 20)",
      label: "Protest",
    };

    win.open(event);
    expect(win.isOpen).toBe(true);

    // Update before expiry
    win.update(now + 500);
    expect(win.isOpen).toBe(true);

    // Update at or after expiry -> closes
    win.update(now + 1000);
    expect(win.isOpen).toBe(false);
    expect(win.element.classList.contains("hidden")).toBe(true);

    win.destroy();
  });

  it("automatically closes if the event is removed from active events list", () => {
    const win = createSabotageEventWindow({ host, onGoTo: vi.fn() });
    const now = performance.now();
    const event: SabotageEvent = {
      id: "protest:10,20",
      kind: "protest",
      tx: 10,
      ty: 20,
      until: now + 60000,
      totalDuration: PROTEST_MS,
      owner: "you",
      targetName: "Public Road (10, 20)",
      label: "Protest",
    };

    win.open(event);
    expect(win.isOpen).toBe(true);

    // Dispersed early: active list no longer contains this event
    win.update(now + 5000, []);
    expect(win.isOpen).toBe(false);

    win.destroy();
  });
});

describe("M2 minimap + sabotage integration", () => {
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

  let host: HTMLElement;
  let cam: Camera;
  let commits: Camera[];
  let mm: Minimap;

  const scene = (): MinimapScene => ({ track: createTrack(), towns: [], sites: [] });

  beforeEach(() => {
    commits = [];
    (globalThis as Record<string, unknown>).ResizeObserver = FakeRO;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      function (this: HTMLCanvasElement) {
        return new Proxy({}, {
          get: (_t, prop: string) => {
            if (prop === "createImageData") {
              return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
            }
            return () => undefined;
          },
          set: () => true,
        }) as never;
      }
    );
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

  function layOut(w = 216, h = 108): HTMLCanvasElement {
    FakeRO.last!.fire(host, w - 10, 0);
    const c = host.querySelector("canvas.minimap-canvas") as HTMLCanvasElement;
    c.getBoundingClientRect = () => ({ left: 100, top: 50, width: w, height: h, right: 100 + w, bottom: 50 + h, x: 100, y: 50, toJSON() {} }) as DOMRect;
    FakeRO.last!.fire(c, w, h);
    return c;
  }

  it("clicking a sabotage marker triggers onMarker, opens event window, and 'Go there' pans camera", () => {
    const c = layOut();
    const eventWindow = createSabotageEventWindow({
      host,
      onGoTo: (tx, ty) => mm.goTo(tx, ty),
    });

    const now = performance.now();
    const players: SabotagePlayerInfo[] = [{ id: "ai", colour: "#ff7a5a" }];
    const events: SabotageEvent[] = [
      {
        id: "blockade:5",
        kind: "blockade",
        tx: 30,
        ty: 80,
        until: now + 40000,
        totalDuration: BANDIT_MS,
        owner: "ai",
        targetName: "Limestone Quarry",
        label: "Blockade",
      },
    ];

    mm.setMarkers(sabotageEventsToMarkers(events, players, now));
    mm.frame(0, 0);

    mm.onMarker = (marker) => {
      const ev = events.find((e) => e.id === marker.id);
      if (ev) eventWindow.open(ev);
    };

    // Click marker on minimap canvas
    const [mx, my] = tileToMinimap(minimapLayout(216, 108), 30.5, 80.5);
    c.dispatchEvent(new PointerEvent("pointerdown", {
      clientX: 100 + mx, clientY: 50 + my, button: 0, isPrimary: true, pointerType: "mouse", pointerId: 1,
    }));

    expect(eventWindow.isOpen).toBe(true);
    expect(eventWindow.element.querySelector(".sabotage-target")?.textContent).toBe("Limestone Quarry");

    // Click "Go there" in the event window
    const goToBtn = eventWindow.element.querySelector(".sabotage-goto-btn") as HTMLButtonElement;
    goToBtn.click();

    expect(commits.length).toBeGreaterThan(0);
    const [wx, wy] = tileToScreen(30.5, 80.5);
    expect(worldToScreen(cam, wx, wy).map((v) => Math.round(v))).toEqual([640, 360]);

    eventWindow.destroy();
  });

  it("works for a multiplayer guest adopting host wire state", () => {
    // Guest receives snapshot / delta with protests and blockades
    const now = performance.now();
    const guestProtests = new Map<number, Protest>();
    const guestIndustries: SabotageIndustryTarget[] = [
      { id: 0, tx: 12, ty: 18, w: 3, h: 3, type: "farm", banditUntil: 0 },
      { id: 1, tx: 50, ty: 50, w: 4, h: 4, type: "coal_mine", banditUntil: 0 },
    ];
    const guestPlayers: SabotagePlayerInfo[] = [
      { id: "host", name: "Host Player", colour: "#5aa8ff" },
      { id: "guest", name: "Guest Player", colour: "#ff7a5a" },
    ];

    // Wire delta received:
    const wireProtests = [{ x: 20, y: 30, until: now + 50000, owner: "host" }];
    const wireBlockades = [{ id: 1, until: now + 35000, owner: "guest" }];

    // Apply wire state as guest does
    for (const pw of wireProtests) {
      guestProtests.set(pw.y * MAP_W + pw.x, { tx: pw.x, ty: pw.y, until: pw.until, owner: pw.owner });
    }
    for (const bw of wireBlockades) {
      const ind = guestIndustries.find((i) => i.id === bw.id);
      if (ind) {
        ind.banditUntil = bw.until;
        ind.banditOwner = bw.owner;
      }
    }

    const markers = collectSabotageMarkers({
      protests: guestProtests.values(),
      industries: guestIndustries,
      players: guestPlayers,
      now,
    });

    expect(markers).toHaveLength(2);
    const pMarker = markers.find((m) => m.id === "protest:20,30");
    const bMarker = markers.find((m) => m.id === "blockade:1");
    expect(pMarker?.color).toBe("#5aa8ff"); // Host's colour
    expect(bMarker?.color).toBe("#ff7a5a"); // Guest's colour
  });
});
