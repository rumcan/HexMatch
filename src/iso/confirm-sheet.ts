// ══════════════════════════════════════════════════════════════════════════
// #121 — the in-game confirm sheet: the dialog that replaces `window.confirm`.
//
// The ☰ menu's two destructive doors ("New Game", "Leave Room") used to ask
// through the browser's native `window.confirm`. That works in a top-level
// tab and silently fails inside one: a page embedded in an iframe the host
// sandboxes without `allow-modals` gets `confirm()` answered `false` and no
// dialog at all, so the click looked dead — the report behind #121 is exactly
// "Leave Room does nothing". The hosted build runs inside RUN.world's frame,
// where the game cannot promise that permission, so the ask has to be a
// plate the game paints itself.
//
// It is the same projector contract as the settings sheet and the tutorial —
// mount a `.modal-root` over a host, resolve, tear itself down — because that
// is how every other modal in the game already behaves, and because it needs
// no React and no permission:
//
//   · resolves `true` ONLY on the confirm button. Escape, the backdrop and
//     `destroy()` all answer `false`, so a sheet killed by a navigation or a
//     game dispose can never be mistaken for a yes;
//   · the CANCEL button takes focus. Leaving a room and clearing a save are
//     both irreversible, so the door a keyboard lands on first is the one
//     that keeps the match;
//   · text arrives as strings and is written with `textContent` — a title
//     containing markup stays text rather than becoming markup.
// ══════════════════════════════════════════════════════════════════════════
import { sfx } from "../audio/sfx";

export interface ConfirmSheetOptions {
  /** Heading. Written as text. */
  title: string;
  /** The one sentence that says what is about to be lost. Written as text. */
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Confirm wears the theme's `.danger` button (irreversible actions). */
  danger?: boolean;
}

export interface ConfirmSheetHandle {
  readonly el: HTMLElement;
  /** Resolves with the player's answer. `destroy()` resolves `false`. */
  readonly promise: Promise<boolean>;
  /** Close it from the outside. Idempotent; answers `false`. */
  destroy(): void;
}

let sheetId = 0;

/**
 * Raise a confirm plate over `host`. Nothing else in the game may paint a
 * confirm: this is the one door a destructive click walks through.
 */
export function showConfirm(
  host: HTMLElement, opts: ConfirmSheetOptions,
): ConfirmSheetHandle {
  const id = ++sheetId;
  let resolveAnswer: (ok: boolean) => void = () => {};
  const promise = new Promise<boolean>((res) => { resolveAnswer = res; });
  let closed = false;

  const root = document.createElement("div");
  root.className = "modal-root confirm-sheet";
  root.innerHTML = `
    <div class="modal-back" data-confirm-cancel></div>
    <div class="modal box small" role="dialog" aria-modal="true"
         aria-labelledby="confirm-title-${id}" aria-describedby="confirm-body-${id}">
      <h2 id="confirm-title-${id}"></h2>
      <p class="sub" id="confirm-body-${id}"></p>
      <div class="confirm-row">
        <button type="button" class="big-btn ghost" data-confirm-cancel data-sfx="close"></button>
        <button type="button" class="big-btn" data-confirm-ok data-sfx="click"></button>
      </div>
    </div>`;

  const panel = root.querySelector(".modal.box") as HTMLElement;
  const okBtn = root.querySelector("[data-confirm-ok]") as HTMLButtonElement;
  const cancelBtn = root.querySelector("button[data-confirm-cancel]") as HTMLButtonElement;
  panel.querySelector("h2")!.textContent = opts.title;
  panel.querySelector(".sub")!.textContent = opts.body;
  okBtn.textContent = opts.confirmLabel ?? "Confirm";
  cancelBtn.textContent = opts.cancelLabel ?? "Cancel";
  if (opts.danger) okBtn.classList.add("danger");

  host.appendChild(root);

  const close = (ok: boolean) => {
    if (closed) return;                       // a double click answers once
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    resolveAnswer(ok);
  };

  // Escape is a cancel, and it is swallowed: the game's own Escape (tool
  // cancel) must not fire underneath a question the player has not answered.
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); close(false); return; }
    if (e.key !== "Tab") return;
    // The same trap the ending ledger walks: the plate keeps keyboard focus on
    // its own two doors, and a focus that starts outside it is pulled back in
    // rather than being left to wander the game behind the backdrop.
    const doors = [cancelBtn, okBtn];
    const at = doors.indexOf(document.activeElement as HTMLButtonElement);
    const outside = at === -1;
    if (e.shiftKey && (outside || at === 0)) {
      e.preventDefault();
      doors[doors.length - 1].focus();
    } else if (!e.shiftKey && (outside || at === doors.length - 1)) {
      e.preventDefault();
      doors[0].focus();
    }
  }
  document.addEventListener("keydown", onKey, true);

  for (const el of root.querySelectorAll<HTMLElement>("[data-confirm-cancel]")) {
    el.onclick = () => close(false);
  }
  okBtn.onclick = () => close(true);

  try { sfx.play("open"); } catch { /* an un-armed engine stays silent */ }
  cancelBtn.focus();

  return { el: root, promise, destroy: () => close(false) };
}
