// ══════════════════════════════════════════════════════════════════════════
// GFX-01 / SETTINGS-01 — the settings sheet, one projector for every door.
//
// The story this module finishes: PR #103 built the front door (Play /
// Settings / How to Play) and left SETTINGS deliberately unwired — "another
// crew is furnishing that room". The room is furnished now. The same sheet
// answers the main-menu door AND the in-game ☰ menu, because both are one
// call to a projector that mounts a `.modal-root` plate over whatever host
// stands up and tears itself down on close — the `showTutorial` contract,
// reused verbatim so React (MainMenu) can own a host div and the imperative
// game (iso/game.ts) can own a handle, and neither re-implements a control.
//
// What the sheet owns (and nothing else):
//   · Texture detail — Low / Medium / High, capping which @0.5x/@1x/@2x art
//     is loaded at all (see graphics.ts + Atlas.detailCap);
//   · Miniature view — the tilt-shift tilt the island looks through
//     (see miniature.ts);
//   · Sound — the SFX-01 mix, reachable here too because the main menu has
//     no 🔊 plate of its own and a player muting from the door must be able
//     to.
// All three write through their stores (graphics.ts, the audio engine), so a
// change made here repaints every OTHER control of the same setting — the
// top-bar 🔊, the in-game modal a second tab could conjure — by the
// registration the stores already provide. The sheet never reads the store
// lazily at paint time after mount; subscribers keep it true.
// ══════════════════════════════════════════════════════════════════════════
import {
  currentGraphics, setGraphics, subscribeGraphics,
  QUALITY_KEYS, QUALITY_LABEL, QUALITY_NOTE, type GraphicsSettings,
} from "./graphics";
import { registerSoundPainter, sfx } from "../audio/sfx";

export interface SettingsSheetHandle {
  readonly el: HTMLElement;
  /** Resolves when the sheet closes itself — Done, backdrop, or Escape. */
  readonly promise: Promise<void>;
  /** Tear it down from the outside (React unmount, game dispose). Idempotent. */
  destroy(): void;
}

export function showSettingsSheet(host: HTMLElement = document.body): SettingsSheetHandle {
  let resolveClosed: () => void = () => {};
  const promise = new Promise<void>((res) => { resolveClosed = res; });
  let closed = false;

  const root = document.createElement("div");
  root.className = "modal-root settings-sheet";
  root.innerHTML = `
    <div class="modal-back" data-gfx-close></div>
    <div class="modal box small gfx-modal" role="dialog" aria-modal="true" aria-label="Settings">
      <h2>Settings</h2>
      <p class="sub">How the island looks and sounds. Everything applies at once and is remembered for the next game.</p>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Texture detail</h3><p class="gfx-note"></p></div>
        <div class="gfx-seg" role="radiogroup" aria-label="Texture detail"></div>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Miniature view</h3><p>Tilt-shift — a sharp band across the middle, the rest softly blurred, colours popped. The island reads as a tiny model.</p></div>
        <button type="button" class="gfx-switch" role="switch" data-gfx="miniature" data-sfx="click">OFF</button>
      </div>
      <div class="gfx-row">
        <div class="gfx-copy"><h3>Sound</h3><p>Brass, felt and paper — every click, coin and cascade (the top bar&rsquo;s 🔊 keeps the same time).</p></div>
        <button type="button" class="gfx-switch" role="switch" data-gfx="sound" data-sfx="click">ON</button>
      </div>
      <div class="confirm-row">
        <button type="button" class="big-btn" data-gfx-close data-sfx="close">Done</button>
      </div>
    </div>`;
  host.appendChild(root);

  const panel = root.querySelector(".modal.box") as HTMLElement;
  const seg = root.querySelector(".gfx-seg") as HTMLElement;
  const note = root.querySelector(".gfx-note") as HTMLElement;
  const miniBtn = root.querySelector("[data-gfx=\"miniature\"]") as HTMLButtonElement;
  const soundBtn = root.querySelector("[data-gfx=\"sound\"]") as HTMLButtonElement;

  for (const q of QUALITY_KEYS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "gfx-q";
    b.dataset.q = q;
    b.setAttribute("role", "radio");
    b.title = QUALITY_NOTE[q];
    b.textContent = QUALITY_LABEL[q];
    b.onclick = () => { setGraphics({ quality: q }); };
    seg.appendChild(b);
  }
  miniBtn.onclick = () => { setGraphics({ miniature: !currentGraphics().miniature }); };
  soundBtn.onclick = () => { sfx.setEnabled(!sfx.isEnabled()); };

  const paint = (g: GraphicsSettings) => {
    note.textContent = QUALITY_NOTE[g.quality];
    for (const b of Array.from(seg.children) as HTMLButtonElement[]) {
      const on = b.dataset.q === g.quality;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    }
    miniBtn.textContent = g.miniature ? "ON" : "OFF";
    miniBtn.classList.toggle("on", g.miniature);
    miniBtn.setAttribute("aria-checked", String(g.miniature));
  };
  const unsubGfx = subscribeGraphics(paint);
  const unsubSound = registerSoundPainter((enabled) => {
    soundBtn.textContent = enabled ? "ON" : "OFF";
    soundBtn.classList.toggle("on", enabled);
    soundBtn.setAttribute("aria-checked", String(enabled));
  });
  paint(currentGraphics());

  const close = () => {
    if (closed) return;
    closed = true;
    unsubGfx();
    unsubSound();
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    resolveClosed();
  };
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }
  document.addEventListener("keydown", onKey, true);
  for (const el of root.querySelectorAll<HTMLElement>("[data-gfx-close]")) el.onclick = close;

  try { sfx.play("open"); } catch { /* an un-armed engine stays silent */ }
  (panel.querySelector(".big-btn") as HTMLButtonElement | null)?.focus();

  return { el: root, promise, destroy: close };
}
