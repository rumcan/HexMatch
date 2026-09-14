// ══════════════════════════════════════════════════════════════════════════
// #164 — the "opponent left" sheet: the dialog a stranded seat deserves.
//
// When the far seat emptied, the game used to raise `ui.showModal` with a
// sentence and no doors — and when the sentence came back empty (a reject
// with no reason text) the player got the bare `.modal-back` instead: a dark
// panel with nothing on it and nothing to click, which is the exact shape the
// bug report describes. Every overlay from here on carries text AND actions.
//
// It is the same projector contract as the confirm sheet (#121) — mount a
// `.modal-root` over a host, tear itself down — with three differences that
// the situation demands:
//
//   · up to THREE doors: Finish the game (keep playing; the star line still
//     claims the win), Claim the win now (ranked shortcut — the room files it
//     the moment the survivor asks), and Leave (back to the main menu);
//   · a status line that can be filled LATE: the room's verdict is a race
//     against this sheet opening (an abandonment files before the roster
//     event lands), so `settle()` writes the rating row into the standing
//     sheet and folds the doors down to the one that is left — Leave;
//   · no dismiss by backdrop or Escape. The match is over and every door is
//     a decision; a stray click must not make it silently.
// ══════════════════════════════════════════════════════════════════════════
import { sfx } from "../audio/sfx";

export interface LeftSheetDoors {
  /** "Finish the game" — close the sheet and keep playing solo. */
  finish?: { label: string; onClick(): void };
  /** "Claim the win now" — ranked only; the room files the forfeit win. */
  claim?: { label: string; onClick(): void };
  /** The one door that is always here: back to the main menu. */
  leave: { label: string; onClick(): void };
}

export interface LeftSheetOptions {
  /** Heading, written as text. */
  title: string;
  /** The plain sentence that says what happened and what it costs. */
  body: string;
  /** Rating row HTML, when the verdict is already in hand at open time. */
  statusHtml?: string;
  doors: LeftSheetDoors;
}

export interface LeftSheetHandle {
  readonly el: HTMLElement;
  /** One extra line under the body — a countdown, a "filing…" note. */
  setStatus(html: string): void;
  /**
   * The room's verdict landed while the sheet stood: write the rating row and
   * fold the doors to Leave alone — Finish and Claim are decisions about a
   * rating that has already moved, and keeping them would be a second,
   * unfileable ask. `leaveLabel` re-names the surviving door ("Leave — claim
   * the win first" is a promise the verdict has now kept).
   */
  settle(statusHtml: string, leaveLabel?: string): void;
  /** Close it from the outside (a reconnect resumed the match). Idempotent. */
  destroy(): void;
}

let sheetId = 0;

/** Raise the sheet over `host`. One may stand at a time — the game enforces
 *  that; two stacked backdrops would be the blank-panel bug all over again. */
export function showLeftSheet(
  host: HTMLElement, opts: LeftSheetOptions,
): LeftSheetHandle {
  const id = ++sheetId;
  let closed = false;

  const root = document.createElement("div");
  root.className = "modal-root left-sheet";
  root.innerHTML = `
    <div class="modal-back"></div>
    <div class="modal box small" role="dialog" aria-modal="true"
         aria-labelledby="left-title-${id}" aria-describedby="left-body-${id}">
      <h2 id="left-title-${id}"></h2>
      <p class="sub" id="left-body-${id}"></p>
      <p class="left-status rank-modal-line hidden"></p>
      <div class="left-doors confirm-row">
        <button type="button" class="big-btn" data-left-finish data-sfx="click"></button>
        <button type="button" class="big-btn ghost" data-left-claim data-sfx="click"></button>
        <button type="button" class="big-btn ghost danger" data-left-leave data-sfx="close"></button>
      </div>
    </div>`;

  const panel = root.querySelector(".modal.box") as HTMLElement;
  const status = panel.querySelector(".left-status") as HTMLElement;
  const finishBtn = root.querySelector("[data-left-finish]") as HTMLButtonElement;
  const claimBtn = root.querySelector("[data-left-claim]") as HTMLButtonElement;
  const leaveBtn = root.querySelector("[data-left-leave]") as HTMLButtonElement;

  panel.querySelector("h2")!.textContent = opts.title;
  panel.querySelector(".sub")!.textContent = opts.body;

  const setStatus = (html: string) => {
    if (!html) { status.classList.add("hidden"); status.innerHTML = ""; return; }
    status.innerHTML = html;
    status.classList.remove("hidden");
  };
  setStatus(opts.statusHtml ?? "");

  const doors: HTMLButtonElement[] = [];
  if (opts.doors.finish) {
    finishBtn.textContent = opts.doors.finish.label;
    finishBtn.onclick = () => { close(); opts.doors.finish!.onClick(); };
    doors.push(finishBtn);
  } else finishBtn.remove();
  if (opts.doors.claim) {
    claimBtn.textContent = opts.doors.claim.label;
    claimBtn.onclick = () => { close(); opts.doors.claim!.onClick(); };
    doors.push(claimBtn);
  } else claimBtn.remove();
  leaveBtn.textContent = opts.doors.leave.label;
  leaveBtn.onclick = () => { close(); opts.doors.leave.onClick(); };
  doors.push(leaveBtn);

  host.appendChild(root);

  function close() {
    if (closed) return;                        // a double click answers once
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    root.remove();
  }

  // Escape is swallowed, not answered: every door on this sheet is a
  // decision with consequences, and the game's own Escape (tool cancel) must
  // not fire underneath a question the player has not answered.
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); return; }
    if (e.key !== "Tab") return;
    // The confirm sheet's focus trap: the keyboard walks the live doors and
    // never wanders into the dead board behind the backdrop.
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

  try { sfx.play("open"); } catch { /* an un-armed engine stays silent */ }
  doors[0].focus();

  return {
    el: root,
    setStatus,
    settle(statusHtml: string, leaveLabel?: string) {
      if (closed) return;
      setStatus(statusHtml);
      // The rating has moved: Finish and Claim are over — Leave is the door.
      finishBtn.remove();
      claimBtn.remove();
      const atFinish = doors.indexOf(finishBtn);
      if (atFinish !== -1) doors.splice(atFinish, 1);
      const atClaim = doors.indexOf(claimBtn);
      if (atClaim !== -1) doors.splice(atClaim, 1);
      if (leaveLabel) leaveBtn.textContent = leaveLabel;
      leaveBtn.focus();
    },
    destroy: close,
  };
}
