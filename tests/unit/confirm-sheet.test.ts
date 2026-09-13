// @vitest-environment jsdom
//
// #121 — the confirm plate that replaced `window.confirm` in the ☰ menu.
//
// The report was "Leave Room does nothing": the menu asked through a native
// `window.confirm`, and a page embedded in a frame the host sandboxes without
// `allow-modals` gets that answered `false` with nothing on screen. So the
// property this suite pins is that the ask is a plate the game paints itself —
// one that resolves `true` only when the player actually confirms, and
// `false` for every other way out (cancel, backdrop, Escape, teardown).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { showConfirm } from "../../src/iso/confirm-sheet";

let host: HTMLDivElement;
const handles: { destroy: () => void }[] = [];

const open = (opts?: Partial<Parameters<typeof showConfirm>[1]>) => {
  const h = showConfirm(host, {
    title: "Leave this room?",
    body: "You return to the main menu and the other seat is told you left.",
    confirmLabel: "Leave room",
    ...opts,
  });
  handles.push(h);
  return h;
};

const okBtn = () => host.querySelector<HTMLButtonElement>("[data-confirm-ok]")!;
const cancelBtn = () => host.querySelector<HTMLButtonElement>("button[data-confirm-cancel]")!;
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!;
const key = (k: string) => document.dispatchEvent(
  Object.assign(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })),
);

afterEach(() => {
  for (const h of handles) h.destroy();
  handles.length = 0;
  host.remove();
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

describe("#121 the confirm sheet", () => {
  it("paints a real dialog with the question on it", () => {
    open();
    const d = dialog();
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.querySelector("h2")!.textContent).toBe("Leave this room?");
    expect(d.querySelector(".sub")!.textContent)
      .toBe("You return to the main menu and the other seat is told you left.");
    expect(okBtn().textContent).toBe("Leave room");
    expect(cancelBtn().textContent).toBe("Cancel");
  });

  it("writes a title containing markup as text, never as markup", () => {
    open({ title: '<img src=x onerror="alert(1)">', body: "b" });
    expect(host.querySelector("img")).toBeNull();
    expect(dialog().querySelector("h2")!.textContent).toBe('<img src=x onerror="alert(1)">');
  });

  it("answers true on the confirm door and false on cancel", async () => {
    const yes = open();
    okBtn().click();
    await expect(yes.promise).resolves.toBe(true);

    const no = open();
    cancelBtn().click();
    await expect(no.promise).resolves.toBe(false);
  });

  it("answers false on the backdrop and on Escape — neither is a yes", async () => {
    const backdrop = open();
    host.querySelector<HTMLElement>(".modal-back")!.click();
    await expect(backdrop.promise).resolves.toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    const escaped = open();
    key("Escape");
    await expect(escaped.promise).resolves.toBe(false);
  });

  it("stops Escape reaching the game underneath (a tool cancel must not double-fire)", () => {
    open();
    const seen: string[] = [];
    const spy = (e: Event) => seen.push((e as KeyboardEvent).key);
    document.addEventListener("keydown", spy);      // bubble phase: the game's own
    key("Escape");
    document.removeEventListener("keydown", spy);
    expect(seen).toEqual([]);
  });

  it("destroy() answers false and is idempotent", async () => {
    const h = open();
    h.destroy();
    h.destroy();
    await expect(h.promise).resolves.toBe(false);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("answers once: a second click on the confirm door cannot resolve twice", async () => {
    const h = open();
    const btn = okBtn();
    btn.click();
    btn.click();                                  // the same node, now detached
    await expect(h.promise).resolves.toBe(true);
  });

  it("lands focus on Cancel — the door that keeps the match", () => {
    open();
    expect(document.activeElement).toBe(cancelBtn());
  });

  it("traps Tab on its two doors and pulls a stray focus back in", () => {
    open();
    // From the last door, Tab wraps to the first rather than leaving the plate.
    okBtn().focus();
    key("Tab");
    expect(document.activeElement).toBe(cancelBtn());
    // From the first, shift-Tab wraps to the last.
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Tab", shiftKey: true, bubbles: true, cancelable: true,
    }));
    expect(document.activeElement).toBe(okBtn());
    // Focus that started outside the plate does not stay out there.
    document.body.focus();
    key("Tab");
    expect(document.activeElement).toBe(cancelBtn());
  });

  it("wears the danger button for an irreversible action", () => {
    open({ danger: true });
    expect(okBtn().classList.contains("danger")).toBe(true);
    expect(okBtn().classList.contains("ghost")).toBe(false);
    expect(cancelBtn().classList.contains("ghost")).toBe(true);
  });
});
