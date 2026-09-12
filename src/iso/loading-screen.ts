// ══════════════════════════════════════════════════════════════════════════
// LOAD-01 — the loading screen between "choose your rival" and the first
// playable frame.
//
// Every art load in the boot is non-gating by design (a missing PNG falls
// back to the sheet, a missing texture to flat colour), which kept the game
// playable but meant the player's first seconds were a map visibly assembling
// itself: flat ground, then trees popping in, then the lorries repainting.
// This overlay covers that window. It is shown the moment the difficulty is
// picked (or straight away when there is no prompt — a save, a `?rival=`
// link, a hosted match) and lifts once every tracked load has SETTLED.
//
// Settled, not succeeded: a failed load still counts as done, because the
// renderer already has a fallback for it and the game must never hang on a
// loading bar. `MAX_WAIT_MS` is the last backstop for a load that never
// settles at all (a stalled request).
//
// The task list is declared up front so the bar only ever moves forward —
// loads that depend on the base atlas register after it decodes, and a bar
// that re-grew its denominator would jump backwards.
// ══════════════════════════════════════════════════════════════════════════

export interface LoadingTask {
  /** Stable id `track()` is called with. */
  id: string;
  /** What the checklist shows while it is pending. */
  label: string;
}

export interface LoadingScreen {
  /** Mark `id` done when `promise` settles (either way). Returns `promise`. */
  track<T>(id: string, promise: Promise<T>): Promise<T>;
  /** Mount the overlay over the host — a no-op once everything has settled. */
  show(subtitle?: string): void;
  /** Settle every remaining task now (a fatal boot error, or teardown). */
  finish(): void;
  /** True while the overlay is mounted (including its fade-out). */
  readonly active: boolean;
  /** True once every task has settled. */
  readonly ready: boolean;
  readonly progress: { done: number; total: number };
  dispose(): void;
}

/** Last-resort ceiling: past this the overlay lifts whatever is still pending. */
export const MAX_WAIT_MS = 30_000;
/** Matches the `.iso-loading-out` transition in styles.css. */
export const FADE_MS = 380;

export function createLoadingScreen(host: HTMLElement, tasks: readonly LoadingTask[]): LoadingScreen {
  const settled = new Set<string>();
  const known = new Set(tasks.map((t) => t.id));
  let overlay: HTMLDivElement | null = null;
  let bar: HTMLDivElement | null = null;
  let pct: HTMLElement | null = null;
  let status: HTMLElement | null = null;
  let backstop = 0;
  let fadeTimer = 0;

  const ready = () => settled.size >= known.size;

  const paint = () => {
    if (!overlay) return;
    const done = settled.size, total = known.size;
    const ratio = total ? done / total : 1;
    bar!.style.width = `${Math.round(ratio * 100)}%`;
    pct!.textContent = `${Math.round(ratio * 100)}%`;
    overlay.querySelector(".iso-loading-track")!.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
    for (const li of overlay.querySelectorAll<HTMLLIElement>("li[data-task]")) {
      li.classList.toggle("done", settled.has(li.dataset.task!));
    }
    const next = tasks.find((t) => !settled.has(t.id));
    status!.textContent = next ? `${next.label}…` : "Opening for business";
  };

  const lift = () => {
    window.clearTimeout(backstop);
    if (!overlay || overlay.classList.contains("iso-loading-out")) return;
    const el = overlay;
    el.classList.add("iso-loading-out");
    fadeTimer = window.setTimeout(() => {
      el.remove();
      if (overlay === el) overlay = null;
    }, FADE_MS);
  };

  const settle = (id: string) => {
    if (!known.has(id) || settled.has(id)) return;
    settled.add(id);
    paint();
    if (ready()) lift();
  };

  return {
    track(id, promise) {
      promise.then(() => settle(id), () => settle(id));
      return promise;
    },
    show(subtitle) {
      if (overlay || ready()) return;
      overlay = document.createElement("div");
      overlay.id = "iso-loading";
      overlay.setAttribute("role", "status");
      overlay.setAttribute("aria-live", "polite");
      overlay.innerHTML = `<div class="iso-loading-card">
        <p class="iso-loading-kicker">Hexmatch Industries</p>
        <h2>Preparing the island</h2>
        <p class="iso-loading-sub"></p>
        <div class="iso-loading-track" role="progressbar" aria-label="Loading art" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="iso-loading-bar"></div>
        </div>
        <div class="iso-loading-meta"><span class="iso-loading-status"></span><span class="iso-loading-pct"></span></div>
        <ul class="iso-loading-steps"></ul>
      </div>`;
      const sub = overlay.querySelector<HTMLElement>(".iso-loading-sub")!;
      if (subtitle) sub.textContent = subtitle; else sub.remove();
      const list = overlay.querySelector(".iso-loading-steps")!;
      for (const t of tasks) {
        const li = document.createElement("li");
        li.dataset.task = t.id;
        li.textContent = t.label;
        list.appendChild(li);
      }
      bar = overlay.querySelector(".iso-loading-bar");
      pct = overlay.querySelector(".iso-loading-pct");
      status = overlay.querySelector(".iso-loading-status");
      host.appendChild(overlay);
      paint();
      backstop = window.setTimeout(() => {
        console.warn("[loading] lifted after", MAX_WAIT_MS, "ms; still pending:",
          tasks.filter((t) => !settled.has(t.id)).map((t) => t.id));
        lift();
      }, MAX_WAIT_MS);
    },
    finish() {
      for (const t of tasks) settle(t.id);
    },
    get active() { return overlay !== null; },
    get ready() { return ready(); },
    get progress() { return { done: settled.size, total: known.size }; },
    dispose() {
      window.clearTimeout(backstop);
      window.clearTimeout(fadeTimer);
      overlay?.remove();
      overlay = null;
    },
  };
}
