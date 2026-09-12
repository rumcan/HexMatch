// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// LOAD-01 — the loading screen (src/iso/loading-screen.ts).
//
// Pinned here:
//   * progress counts SETTLED tasks — a rejected load is done, never a hang;
//   * the overlay lifts (fade, then removal) once every declared task settles;
//   * show() after everything already landed renders nothing (no flash);
//   * the MAX_WAIT_MS backstop lifts it even when a load never settles.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createLoadingScreen, FADE_MS, MAX_WAIT_MS } from "../../src/iso/loading-screen";

const TASKS = [
  { id: "a", label: "Alpha" },
  { id: "b", label: "Beta" },
];
let host: HTMLDivElement;

/** A promise plus its handles, so a test decides when a load lands. */
const deferred = () => {
  let resolve!: () => void, reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  promise.catch(() => {});
  return { promise, resolve, reject };
};
const flush = () => Promise.resolve().then(() => Promise.resolve());

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => { vi.useRealTimers(); });

describe("LOAD-01 loading screen", () => {
  it("fills as tasks settle, counts a failure as done, then lifts", async () => {
    const ls = createLoadingScreen(host, TASKS);
    const a = deferred(), b = deferred();
    ls.track("a", a.promise);
    ls.track("b", b.promise);
    ls.show("Rival: Hard");

    const el = host.querySelector("#iso-loading")!;
    expect(el).not.toBeNull();
    expect(el.textContent).toContain("Rival: Hard");
    expect(el.querySelectorAll("li[data-task]")).toHaveLength(2);
    expect(ls.active).toBe(true);

    a.resolve(); await flush();
    expect(ls.progress).toEqual({ done: 1, total: 2 });
    expect(el.querySelector(".iso-loading-pct")!.textContent).toBe("50%");
    expect(el.querySelector('li[data-task="a"]')!.classList.contains("done")).toBe(true);
    expect(el.querySelector(".iso-loading-status")!.textContent).toBe("Beta…");

    b.reject(new Error("404")); await flush();
    expect(ls.ready).toBe(true);
    expect(el.classList.contains("iso-loading-out")).toBe(true);
    vi.advanceTimersByTime(FADE_MS);
    expect(host.querySelector("#iso-loading")).toBeNull();
    expect(ls.active).toBe(false);
  });

  it("does not flash when everything landed before show()", () => {
    const ls = createLoadingScreen(host, TASKS);
    ls.finish();
    ls.show();
    expect(host.querySelector("#iso-loading")).toBeNull();
    expect(ls.active).toBe(false);
  });

  it("lifts after MAX_WAIT_MS when a load never settles", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ls = createLoadingScreen(host, TASKS);
    ls.track("a", new Promise(() => {}));
    ls.show();
    vi.advanceTimersByTime(MAX_WAIT_MS + FADE_MS);
    expect(host.querySelector("#iso-loading")).toBeNull();
  });

  it("ignores ids it was not told about", async () => {
    const ls = createLoadingScreen(host, TASKS);
    ls.track("zzz", Promise.resolve());
    await flush();
    expect(ls.progress).toEqual({ done: 0, total: 2 });
  });
});
