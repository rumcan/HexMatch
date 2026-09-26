// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

it("Road Ways button and N share toggle state; typing and modified keys do not toggle", async () => {
  const ctx = new Proxy({}, { get: (_target, key) => key === "measureText"
    ? () => ({ width: 0 }) : () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("Image", class { set src(_value: string) {} });
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("No art in this UI unit test")));
  localStorage.setItem("hexmatch:tutorial", "never");
  window.history.replaceState(null, "", "/?seed=1337");
  const root = document.createElement("div");
  document.body.append(root);
  let dispose: (() => void) | undefined;
  try {
    const { startIsoGame } = await import("../../src/iso/game");
    dispose = startIsoGame(root);
    const button = root.querySelector<HTMLButtonElement>('[data-flyout="roads"] [data-act="network-view"]')!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-pressed")).toBe("false");
    button.click();
    expect(button.getAttribute("aria-pressed")).toBe("true");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true }));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    const input = document.createElement("input"); root.append(input);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "n", bubbles: true }));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "N" }));
    expect(button.getAttribute("aria-pressed")).toBe("true");
  } finally {
    dispose?.(); root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("lorry trips/min agrees with actual deliveries over ten round trips on mixed tiers and slopes", async () => {
  const { routeTripsPerMinute } = await import("../../src/iso/game");
  const { tickTrucks, createTruckState } = await import("../../src/iso/vehicles");
  const state = createTruckState();
  const truck = { ownerId: 1, depotId: 1, factory: [3, 1] as [number, number],
    route: [[0, 0], [1, 1], [3, 1]] as [number, number][], leg: 0, t: 0,
    reverse: false, segMult: [2, 5], segClimb: [1, -1], rateMult: 1.25, deliveries: 0 };
  state.trucks = [truck];
  const trips = routeTripsPerMinute(truck);
  expect(trips).toBeGreaterThan(0);
  tickTrucks(state, 60_000 / trips * 10);
  expect(truck.deliveries).toBe(10);
  expect(routeTripsPerMinute(truck, true)).toBe(0);
  expect(routeTripsPerMinute(undefined)).toBe(0);
});
