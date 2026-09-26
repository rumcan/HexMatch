// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the guide's picture: spotlight, pointer, caption strip.
//
// One fixed layer over the game, built from the shipped Space Age tokens
// (charcoal panel, lemon step counter with dark text, square corners, flat
// colour, weight ≤ 500 — theme-space-age.css).
//
//   • THE VEIL dims everything but the target's rect. It is one element with
//     a 9999px box-shadow, so there is no second full-screen div to keep in
//     sync, and `pointer-events: none` throughout: the game stays playable
//     while the guide is up. Nothing here ever blocks a click.
//   • THE POINTER is a hand that bobs on the target. It is decoration, never
//     a hit area.
//   • THE STRIP is the ONE caption — the old tour's top banner and clipped
//     bottom hint said the same thing twice; this says it once. It carries the
//     section name, the lemon step counter, the caption, the gesture hint, and
//     the three keys that are ALWAYS there: Skip section, End tutorial, and
//     Next when the step offers one.
//
// The layer is mounted inside the game root (or the main menu's host), so it
// inherits the phone regime and the theme variables. It repositions itself on
// its own animation frame while it stands — the camera moves, the panels
// slide, the sheets open, and the hole has to follow all of it.
// ══════════════════════════════════════════════════════════════════════════
import type { GuideTarget, GuideView } from "./types";
import { targetSelectors } from "./engine";

export interface GuideRendererHooks {
  /** A completion event arrived (a click on a target, a tool, a tab). */
  emit(event: { kind: "click"; selector: string }
    | { kind: "tool"; tool: string }
    | { kind: "tab"; tab: string }): void;
  next(): void;
  back(): void;
  skip(): void;
  end(): void;
  /** The rect, in viewport coordinates, of a map target. Null = no hole. */
  mapRect(target: GuideTarget): { x: number; y: number; w: number; h: number } | null;
}

export interface GuideRenderer {
  mount(host: HTMLElement): void;
  /** Repaint for this frame. Cheap when nothing changed. */
  paint(view: GuideView): void;
  unmount(): void;
  readonly el: HTMLElement | null;
}

const LAYER_ID = "iso-guide";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
};

/** Is this element actually on screen? A collapsed rail, a closed sheet and a
 *  `display:none` node all answer no — which is how one selector list serves
 *  the desktop rail AND the phone's Build / Economy sheets. */
export function isVisible(node: Element | null): boolean {
  if (!node || !node.isConnected) return false;
  const r = node.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const style = typeof getComputedStyle === "function"
    ? getComputedStyle(node)
    : null;
  if (style && (style.visibility === "hidden" || style.display === "none")) return false;
  if (style && Number(style.opacity) === 0) return false;
  return true;
}

/** The first VISIBLE candidate of a comma-separated selector list. */
export function firstVisible(root: ParentNode, selector: string): HTMLElement | null {
  for (const one of selector.split(",")) {
    const q = one.trim();
    if (!q) continue;
    let hit: HTMLElement | null = null;
    try { hit = root.querySelector<HTMLElement>(q); } catch { hit = null; }
    if (isVisible(hit)) return hit;
  }
  return null;
}

export function createGuideRenderer(hooks: GuideRendererHooks): GuideRenderer {
  let layer: HTMLElement | null = null;
  let hole: HTMLElement | null = null;
  let pointer: HTMLElement | null = null;
  let kicker: HTMLElement | null = null;
  let counter: HTMLElement | null = null;
  let caption: HTMLElement | null = null;
  let hint: HTMLElement | null = null;
  let nextBtn: HTMLButtonElement | null = null;
  let backBtn: HTMLButtonElement | null = null;
  let raf = 0;
  let lastKey = "\u0000";
  let view: GuideView | null = null;

  // ── the one listener every UI completion hangs on ───────────────────────
  // Capture phase, never cancelling: the game's own handler still runs, the
  // guide only learns that the gesture happened. A click inside the guide's
  // own strip is the guide's business and nobody else's.
  const onCaptureClick = (e: MouseEvent): void => {
    const v = view;
    if (!v || !v.step) return;
    const t = e.target as Element | null;
    if (!t || typeof t.closest !== "function") return;
    if (layer && t.closest(`#${LAYER_ID}`)) return;
    const selectors = [...targetSelectors(v.target)];
    if (v.step.complete.kind === "click") selectors.push(v.step.complete.selector);
    for (const sel of selectors) {
      if (!sel) continue;
      let hit: Element | null = null;
      try { hit = t.closest(sel); } catch { hit = null; }
      // No early return: a click on the target may ALSO be the tool or tab
      // the step waits for (a tab step targets that very tab button).
      if (hit) { hooks.emit({ kind: "click", selector: sel }); break; }
    }
    const tool = t.closest<HTMLElement>("[data-tool]");
    if (tool?.dataset.tool) { hooks.emit({ kind: "tool", tool: tool.dataset.tool }); return; }
    const tab = t.closest<HTMLElement>("[data-tab]");
    if (tab?.dataset.tab) { hooks.emit({ kind: "tab", tab: tab.dataset.tab }); return; }
  };

  function position(): void {
    const v = view;
    if (!v || !layer || !hole || !pointer) return;
    const target = v.target;
    let rect: { x: number; y: number; w: number; h: number } | null = null;
    if (target && target.kind === "ui") {
      const node = firstVisible(document, target.selector);
      if (node) {
        const r = node.getBoundingClientRect();
        rect = { x: r.left, y: r.top, w: r.width, h: r.height };
      }
    } else if (target && target.kind !== "screen") {
      rect = hooks.mapRect(target);
    }
    if (!rect || rect.w <= 0 || rect.h <= 0) {
      // Nothing to point at (a collapsed panel, an empty map): dim the whole
      // screen and drop the pointer rather than pretending to know where.
      hole.style.opacity = "0";
      pointer.classList.add("hidden");
      return;
    }
    hole.style.opacity = "1";
    pointer.classList.remove("hidden");
    // A target in the lower half (the drawer, the bottom bays) would sit under
    // the caption strip: lift the strip to the top of the screen instead.
    layer.classList.toggle("guide-top", rect.y + rect.h / 2 > window.innerHeight * 0.5);
    const pad = 6;
    hole.style.left = `${Math.round(rect.x - pad)}px`;
    hole.style.top = `${Math.round(rect.y - pad)}px`;
    hole.style.width = `${Math.round(rect.w + pad * 2)}px`;
    hole.style.height = `${Math.round(rect.h + pad * 2)}px`;
    pointer.style.left = `${Math.round(rect.x + rect.w / 2)}px`;
    pointer.style.top = `${Math.round(rect.y + rect.h / 2)}px`;
  }

  function loop(): void {
    raf = 0;
    position();
    if (view?.running) raf = requestAnimationFrame(loop);
  }

  function build(): void {
    layer = el("div", "guide-layer");
    layer.id = LAYER_ID;
    // The layer lives for the life of the game and stands IDLE (display:none)
    // until a step does — a boot with no guide running must never leave an
    // empty strip over the map, and `paint` lifts this the moment one does.
    layer.classList.add("hidden");
    layer.setAttribute("role", "complementary");
    layer.setAttribute("aria-label", "Tutorial");
    hole = el("div", "guide-hole");
    pointer = el("div", "guide-pointer", "☝");
    pointer.classList.add("hidden");
    pointer.setAttribute("aria-hidden", "true");
    const strip = el("div", "guide-strip");
    const head = el("div", "guide-head");
    kicker = el("b", "guide-kicker", "");
    counter = el("span", "guide-count", "");
    head.append(kicker, counter);
    caption = el("p", "guide-caption", "");
    hint = el("small", "guide-hint", "");
    const row = el("div", "guide-row");
    backBtn = el("button", "guide-key ghost", "← Back") as HTMLButtonElement;
    backBtn.type = "button";
    backBtn.dataset.act = "guide-back";
    backBtn.dataset.sfx = "click";
    backBtn.onclick = () => hooks.back();
    nextBtn = el("button", "guide-key", "Next →") as HTMLButtonElement;
    nextBtn.type = "button";
    nextBtn.dataset.act = "guide-next";
    nextBtn.dataset.sfx = "click";
    nextBtn.onclick = () => hooks.next();
    const spacer = el("span", "guide-spacer");
    const skip = el("button", "guide-key ghost", "Skip section") as HTMLButtonElement;
    skip.type = "button";
    skip.dataset.act = "guide-skip";
    skip.dataset.sfx = "close";
    skip.onclick = () => hooks.skip();
    const stop = el("button", "guide-key ghost", "End tutorial") as HTMLButtonElement;
    stop.type = "button";
    stop.dataset.act = "guide-end";
    stop.dataset.sfx = "close";
    stop.onclick = () => hooks.end();
    row.append(backBtn, nextBtn, spacer, skip, stop);
    strip.append(head, caption, hint, row);
    layer.append(hole, pointer, strip);
  }

  return {
    get el() { return layer; },
    mount(next) {
      build();
      if (!layer) return;
      next.appendChild(layer);
      document.addEventListener("click", onCaptureClick, true);
    },
    paint(next) {
      view = next;
      if (!layer) return;
      if (!next.running) {
        layer.classList.add("hidden");
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        lastKey = "\u0000";
        return;
      }
      layer.classList.remove("hidden");
      const step = next.step!;
      const key = `${next.sectionId}:${step.id}:${next.stepNumber}`;
      if (key !== lastKey) {
        lastKey = key;
        if (kicker) kicker.textContent = next.sectionTitle;
        if (counter) counter.textContent = `${next.stepNumber} / ${next.stepCount}`;
        if (caption) caption.textContent = step.caption;
        if (hint) {
          hint.textContent = step.hint ?? "";
          hint.classList.toggle("hidden", !step.hint);
        }
        if (nextBtn) {
          // Every step offers Next (the action still advances on its own).
          nextBtn.classList.remove("hidden");
          nextBtn.textContent = next.stepNumber === next.stepCount ? "Done →" : "Next →";
        }
        if (backBtn) {
          backBtn.classList.toggle("hidden", next.stepNumber <= 1);
        }
        layer.dataset.section = next.sectionId ?? "";
        layer.dataset.step = step.id;
      }
      if (!raf) raf = requestAnimationFrame(loop);
    },
    unmount() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      document.removeEventListener("click", onCaptureClick, true);
      layer?.remove();
      layer = null;
      view = null;
    },
  };
}
