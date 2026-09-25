// ══════════════════════════════════════════════════════════════════════════
// MON-1 (#367) — the Store panel, one projector for every door.
//
// The same contract as `iso/settings-sheet.ts`: mount a `.modal-root` plate
// over whatever host stands up (the React main menu, the imperative in-game
// ☰ menu), paint from `subscribeStore`, tear itself down on Done / backdrop /
// Escape. Two doors, one panel, so the front menu and a live match can never
// show different prices or a different idea of what is owned.
//
// What the panel promises:
//   · every catalogue row, with its price and what it unlocks;
//   · OWNED / BUY / UNAVAILABLE, painted from the store, never guessed;
//   · a Buy that reports what happened — bought, refused, no charge, or
//     "the store is not reachable" — and never leaves a row spinning;
//   · the purse, and a door to the platform's own Bits store for a top-up.
//
// ART: MON-1 has none. Each row carries a text glyph standing in for the
// item's 96×96 brass plate (see the PR's art request) — the glyph lives in
// `STORE_ITEMS[].icon` in src/iso/config.ts, so swapping in a sprite is a
// one-field change per item.
// ══════════════════════════════════════════════════════════════════════════
import { STORE_ITEMS, fmtBits } from "../iso/config";
import {
  buyStoreItem, loadStore, refreshStore, storeSnapshot, subscribeStore,
  type StoreFailure, type StoreSnapshot, type StoreStatus,
} from "./store";
import { sfx } from "../audio/sfx";

export interface StorePanelHandle {
  readonly el: HTMLElement;
  /** Resolves when the panel closes itself — Done, backdrop, or Escape. */
  readonly promise: Promise<void>;
  /** Tear it down from the outside (React unmount, game dispose). Idempotent. */
  destroy(): void;
}

/** What the store's status means to a player reading the panel. */
const STATUS_NOTE: Record<StoreStatus, string> = {
  loading: "Asking RUN what you already own…",
  ready: "Prices are in RUN Bits. Buying is a one-time unlock — it stays yours.",
  mock: "MOCK STORE — no real Bits are spent and nothing leaves this browser. Add ?store=mock to any HexMatch URL to get back here.",
  unavailable: "The store is not reachable from this page — it needs the RUN.world host. Nothing here is locked: the whole island plays, with or without it.",
};

function failureCopy(reason: StoreFailure | null): string {
  switch (reason) {
    case "user-cancelled": return "No charge. Nothing was bought.";
    case "insufficient-funds": return "Not enough Bits. Top up and try again.";
    case "unavailable": return "The store is not reachable from this page. Nothing was charged.";
    case "unknown-item": return "This item is not in the catalogue — nothing was charged.";
    case "error": return "The purchase could not be completed. Nothing was charged — try again.";
    default: return "";
  }
}

/**
 * Raise the panel over `host` (default `document.body`).
 *
 * Never throws and never blocks the game: the store answers in the background
 * and the panel repaints when it does, so a slow or missing platform costs a
 * sentence of copy and nothing else.
 */
export function showStorePanel(host: HTMLElement = document.body): StorePanelHandle {
  let resolveClosed: () => void = () => {};
  const promise = new Promise<void>((res) => { resolveClosed = res; });
  let closed = false;
  let busy = false;

  const root = document.createElement("div");
  root.className = "modal-root store-sheet";
  root.innerHTML = `
    <div class="modal-back" data-store-close></div>
    <div class="modal box store-modal" role="dialog" aria-modal="true" aria-label="Store">
      <h2>Store</h2>
      <p class="sub" data-store-note></p>
      <p class="store-purse" data-store-purse></p>
      <div class="store-items" data-store-items role="list"></div>
      <p class="store-msg" data-store-msg role="status" aria-live="polite"></p>
      <div class="confirm-row">
        <button type="button" class="big-btn" data-store-close data-sfx="close">Done</button>
      </div>
    </div>`;
  host.appendChild(root);

  const note = root.querySelector("[data-store-note]") as HTMLElement;
  const purse = root.querySelector("[data-store-purse]") as HTMLElement;
  const list = root.querySelector("[data-store-items]") as HTMLElement;
  const msg = root.querySelector("[data-store-msg]") as HTMLElement;
  const topUp = document.createElement("button");
  topUp.type = "button";
  topUp.className = "store-topup";
  topUp.dataset.sfx = "click";
  topUp.textContent = "Get more Bits";
  topUp.title = "Open the RUN Bits store";
  topUp.hidden = true;
  topUp.addEventListener("click", () => {
    void openTopUp();
  });
  purse.after(topUp);

  // One row per catalogue item, painted (never re-created) on every store
  // change, so a button mid-purchase keeps its focus and its listeners.
  const rows = STORE_ITEMS.map((item) => {
    const row = document.createElement("div");
    row.className = "store-row";
    row.setAttribute("role", "listitem");
    row.dataset.item = item.id;
    row.innerHTML = `
      <span class="store-icon" aria-hidden="true">${item.icon}</span>
      <span class="store-copy">
        <b class="store-name"></b>
        <span class="store-unlocks"></span>
        <span class="store-rowmsg"></span>
      </span>
      <span class="store-side">
        <span class="store-price"></span>
        <button type="button" class="store-buy" data-sfx="click"></button>
      </span>`;
    (row.querySelector(".store-name") as HTMLElement).textContent = item.name;
    (row.querySelector(".store-unlocks") as HTMLElement).textContent = item.unlocks;
    (row.querySelector(".store-price") as HTMLElement).textContent = fmtBits(item.price);
    if (!item.enforced) {
      const free = document.createElement("span");
      free.className = "store-soon";
      free.textContent = "in the game now — buying it supports the next one";
      (row.querySelector(".store-copy") as HTMLElement).appendChild(free);
    }
    const btn = row.querySelector(".store-buy") as HTMLButtonElement;
    btn.addEventListener("click", () => { void buy(item.id); });
    list.appendChild(row);
    return { item, row, btn, rowmsg: row.querySelector(".store-rowmsg") as HTMLElement };
  });

  async function openTopUp(): Promise<void> {
    // The platform's own store (top-ups). Only offered when there is one —
    // `openBitsStore` resolves null behind a page with no RUN host.
    try {
      const t = await import("../net/transport");
      const res = await t.openBitsStore();
      if (res) void refreshStore();
    } catch {
      /* a top-up door that will not open is not an error to shout about */
    }
  }

  async function buy(itemId: string): Promise<void> {
    if (closed || busy) return;
    const row = rows.find((r) => r.item.id === itemId);
    if (!row || row.btn.disabled) return;
    busy = true;
    msg.textContent = "";
    paintRows();
    try {
      const out = await buyStoreItem(itemId);
      if (out.alreadyOwned || out.ok) {
        row.rowmsg.textContent = out.alreadyOwned ? "Already yours." : "Bought — it is yours.";
        row.rowmsg.className = "store-rowmsg ok";
        msg.textContent = "";
      } else {
        row.rowmsg.textContent = failureCopy(out.reason ?? null);
        row.rowmsg.className = "store-rowmsg bad";
      }
    } finally {
      busy = false;
      paint(storeSnapshot());
    }
  }

  function paintRows(): void {
    const s = storeSnapshot();
    const unavailable = s.status === "unavailable";
    for (const { item, row, btn } of rows) {
      const owned = s.owned.includes(item.id);
      const working = s.purchasing.includes(item.id);
      row.classList.toggle("owned", owned);
      // Unavailable is a DISABLED button, not a hidden one: the row still
      // says what the item is and what it costs, and the panel above says
      // why it cannot be bought here.
      btn.disabled = owned || working || busy || unavailable;
      btn.textContent = owned ? "Owned" : working ? "…" : unavailable ? "Unavailable" : "Buy";
      btn.title = owned
        ? `${item.name} is already yours`
        : unavailable
          ? "The store is not reachable from this page"
          : `${item.name} — ${fmtBits(item.price)}`;
      btn.setAttribute("aria-label", btn.title);
    }
  }

  function paint(s: StoreSnapshot): void {
    note.textContent = STATUS_NOTE[s.status];
    root.classList.toggle("is-unavailable", s.status === "unavailable");
    root.classList.toggle("is-mock", s.status === "mock");
    if (s.status === "mock") purse.textContent = `Mock purse: ${s.balance == null ? "—" : fmtBits(s.balance)}`;
    else if (s.balance == null) purse.textContent = s.status === "loading" ? "" : "Bits balance unavailable.";
    else purse.textContent = `Your Bits: ${fmtBits(s.balance)}`;
    topUp.hidden = s.status !== "ready";
    if (s.lastError && s.status === "unavailable") msg.textContent = "";
    paintRows();
  }

  const unsub = subscribeStore(paint);
  paint(storeSnapshot());
  // Kick a load (and a re-verify) without waiting on it: the panel is already
  // painted from the cache, and a slow platform must never delay the open.
  void loadStore().then(paint).catch(() => paint(storeSnapshot()));

  const close = () => {
    if (closed) return;
    closed = true;
    unsub();
    document.removeEventListener("keydown", onKey, true);
    root.remove();
    resolveClosed();
  };
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }
  document.addEventListener("keydown", onKey, true);
  for (const el of root.querySelectorAll<HTMLElement>("[data-store-close]")) el.onclick = close;

  try { sfx.play("open"); } catch { /* an un-armed engine stays silent */ }
  (root.querySelector(".big-btn") as HTMLButtonElement | null)?.focus();

  return { el: root, promise, destroy: close };
}
