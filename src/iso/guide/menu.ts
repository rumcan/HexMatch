// ══════════════════════════════════════════════════════════════════════════
// TUT-03 (#422) — the Tutorial MENU.
//
// One list, two doors: ☰ → Tutorial inside a game, and the front menu's
// Tutorial button. A row per section with a ✓ once it is done; a click runs
// that section NOW, in the game the player is standing in. "Reset tutorial"
// clears the marks and lets the first game start over.
//
// It is a sheet, not an overlay: the game behind it is a live game, so the
// plate sits over a backdrop and nothing else changes. When the door is the
// front menu there is no game to run in yet, so the menu says which section
// is queued and hands it to the boot through `queueGuideSection` — the next
// game opens on it.
//
// Same projector contract as the settings sheet and the old tour: a host div,
// a handle, a promise that settles on close. React (MainMenu) owns the seam
// one way and game.ts owns it the other, and neither re-implements a control.
// ══════════════════════════════════════════════════════════════════════════
import { sfx } from "../../audio/sfx";
import { buildGuideSections, type GuideContext } from "./sections";
import type { GuideProgress, GuideSectionId } from "./types";
import { GUIDE_SECTION_IDS } from "./types";

export interface TutorialMenuHandle {
  readonly el: HTMLElement;
  /** Resolves when the menu closes (a pick, the backdrop, Done or Escape). */
  readonly promise: Promise<void>;
  close(): void;
  destroy(): void;
}

export interface TutorialMenuOptions {
  ctx: GuideContext;
  progress: GuideProgress;
  /** Run one section now. Return false when there is no game to run it in. */
  onRun: (id: GuideSectionId) => boolean;
  /** "Reset tutorial" — the caller clears the record and repaints. */
  onReset: () => void;
  /** True when a match is live. False on the front menu, where a pick queues
   *  the section for the next boot instead of running it now. */
  live: boolean;
  onClose?: () => void;
}

/** A section picked on the front menu waits here for the boot that reads it. */
let queuedSection: GuideSectionId | null = null;

export function queueGuideSection(id: GuideSectionId | null): void {
  queuedSection = id;
}

/** The boot's one read: take the queued section and forget it. */
export function takeQueuedSection(): GuideSectionId | null {
  const id = queuedSection;
  queuedSection = null;
  return id;
}

/** The short text reference — the few rules a player looks up mid-game. The
 *  guide itself teaches by pointing; this is the page they re-read. */
const REFERENCE: string[] = [
  "Dirt Road is free and slow. Street, Road and Highway haul faster and cost materials.",
  "A Depot needs an industry inside its 4×4 catchment, and one Depot per industry.",
  "A Depot ticks cargo only while a continuous road or rail joins it to your factory.",
  "Rail turns at forty-five degrees, never a sharp corner, and never diagonally across a slope.",
  "A Highway joins your roads through a Ramp; a Road dragged across it becomes an overpass.",
  "Stars come from running Depots, fully paved routes, city tiers, top-level Depots and holds.",
];

export function showTutorialMenu(
  host: HTMLElement, opts: TutorialMenuOptions,
): TutorialMenuHandle {
  let resolveClosed: () => void = () => {};
  const promise = new Promise<void>((res) => { resolveClosed = res; });
  let closed = false;
  let progress = opts.progress;

  const root = document.createElement("div");
  root.className = "modal-root guide-menu";
  root.dataset.act = "guide-menu";

  const plate = document.createElement("div");
  plate.className = "modal box guide-menu-box";
  plate.setAttribute("role", "dialog");
  plate.setAttribute("aria-modal", "true");
  plate.setAttribute("aria-label", "Tutorial");

  const head = document.createElement("div");
  head.className = "guide-menu-head";
  const title = document.createElement("h2");
  title.textContent = "Tutorial";
  const sub = document.createElement("p");
  sub.className = "sub";
  sub.textContent = !opts.live
    ? "Pick a section and it opens in the next game you start."
    : "Pick a section and it runs now, in this game. Each one points at the real controls and waits for you.";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "big-btn ghost guide-menu-done";
  done.dataset.act = "guide-menu-close";
  done.dataset.sfx = "close";
  done.textContent = "Done";
  head.append(title, sub, done);

  const list = document.createElement("div");
  list.className = "guide-menu-list";
  list.dataset.act = "guide-menu-list";

  const ref = document.createElement("div");
  ref.className = "guide-menu-ref";
  const refTitle = document.createElement("h3");
  refTitle.textContent = "The short version";
  const refList = document.createElement("ul");
  for (const line of REFERENCE) {
    const li = document.createElement("li");
    li.textContent = line;
    refList.appendChild(li);
  }
  ref.append(refTitle, refList);

  const foot = document.createElement("div");
  foot.className = "guide-menu-foot";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "big-btn ghost";
  reset.dataset.act = "guide-reset";
  reset.dataset.sfx = "click";
  reset.textContent = "Reset tutorial";
  const note = document.createElement("small");
  note.textContent = "Progress is kept in this browser. A dismissed guide stays dismissed until you pick a section here.";
  foot.append(reset, note);

  plate.append(head, list, ref, foot);
  const back = document.createElement("div");
  back.className = "modal-back";
  root.append(back, plate);

  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    document.removeEventListener("keydown", onKey, true);
    opts.onClose?.();
    resolveClosed();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  };

  done.onclick = close;
  back.onclick = close;
  reset.onclick = () => {
    opts.onReset();
    progress = { done: [], dismissed: false };
    paint();
    sfx.play("click");
  };

  function paint(): void {
    const rows = buildGuideSections(opts.ctx);
    const byId = new Map(rows.map((s) => [s.id, s]));
    list.innerHTML = "";
    for (const id of GUIDE_SECTION_IDS) {
      const sec = byId.get(id);
      if (!sec) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "guide-menu-row";
      b.dataset.act = "guide-section";
      b.dataset.section = id;
      b.dataset.sfx = "open";
      const mark = document.createElement("span");
      mark.className = "guide-menu-mark";
      mark.textContent = progress.done.includes(id) ? "✓" : "";
      mark.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.className = "guide-menu-copy";
      const name = document.createElement("b");
      name.textContent = sec.title;
      const blurb = document.createElement("small");
      blurb.textContent = sec.blurb;
      copy.append(name, blurb);
      const go = document.createElement("span");
      go.className = "guide-menu-go";
      go.textContent = progress.done.includes(id) ? "Replay" : "Play";
      b.append(mark, copy, go);
      b.setAttribute("aria-label",
        `${sec.title} — ${sec.blurb}${progress.done.includes(id) ? " (done)" : ""}`);
      b.onclick = () => {
        sfx.play("open");
        close();
        opts.onRun(id);
      };
      list.appendChild(b);
    }
  }

  paint();
  host.appendChild(root);
  document.addEventListener("keydown", onKey, true);
  sfx.play("open");
  return { el: root, promise, close, destroy: close };
}
