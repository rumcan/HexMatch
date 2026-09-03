// ══════════════════════════════════════════════════════════════════════════
// J1 — the trading panel, surfaced over the iso market.
//
// The rules live in `src/game/trade.ts` (restored, map-agnostic) and the book
// lives in `src/iso/market.ts`; this file is only chrome. It never holds a
// balance: every number it prints is read back out of the player's purse.
// ══════════════════════════════════════════════════════════════════════════
import { BANK_RATE, MAX_OFFERS } from "../game/trade";
import { CARGO, CARGOES, type Cargo } from "./config";
import type { IsoMarket, IsoMarketPlayer } from "./market";

export interface TradePanelHooks {
  onNotice?: (text: string, kind?: "good" | "bad" | "info") => void;
  onChange?: () => void;
  onToggle?: (visible: boolean) => void;
}

export interface TradePanel {
  el: HTMLElement;
  render: () => void;
  setVisible: (v: boolean) => void;
  isVisible: () => boolean;
}

const options = (sel: Cargo) =>
  CARGOES.map((c) =>
    `<option value="${c}"${c === sel ? " selected" : ""}>${CARGO[c].icon} ${CARGO[c].name}</option>`)
    .join("");

const val = <T extends string>(e: HTMLSelectElement | null, fallback: T): T =>
  (e?.value as T) || fallback;

const num = (e: HTMLInputElement | null, fallback: number) => {
  const n = Math.floor(Number(e?.value ?? fallback));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function createTradePanel(
  market: IsoMarket, me: IsoMarketPlayer, hooks: TradePanelHooks = {},
): TradePanel {
  const el = document.createElement("div");
  el.className = "iso-panel iso-trade";
  el.id = "iso-trade";
  el.style.display = "none";

  const head = document.createElement("div");
  head.className = "iso-panel-head";
  head.innerHTML =
    `<span>Market</span><small>bank ${BANK_RATE}:1 · rival ${MAX_OFFERS} offers max</small>` +
    `<button type="button" class="iso-x" data-act="trade-hide" aria-label="Hide market">–</button>`;

  const body = document.createElement("div");
  body.className = "iso-trade-body";
  body.innerHTML = `
    <div class="iso-trade-row">
      <label>Bank</label>
      <select data-f="bank-give">${options("stone")}</select>
      <span class="iso-times">×${BANK_RATE} →</span>
      <select data-f="bank-want">${options("ore")}</select>
      <button type="button" data-act="bank">Trade</button>
    </div>
    <div class="iso-trade-row">
      <label>Offer</label>
      <select data-f="give">${options("stone")}</select>
      <input data-f="give-n" type="number" min="1" value="2" />
      <span class="iso-times">for</span>
      <select data-f="want">${options("ore")}</select>
      <input data-f="want-n" type="number" min="1" value="2" />
      <button type="button" data-act="post">Post</button>
    </div>
    <div class="iso-offers" id="iso-offers"></div>`;

  el.append(head, body);

  const $ = <T extends HTMLElement>(f: string) => body.querySelector<T>(`[data-f="${f}"]`);
  const offersEl = body.querySelector("#iso-offers") as HTMLElement;

  let visible = false;

  const act = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "bank") {
      const give = val($<HTMLSelectElement>("bank-give"), "stone" as Cargo);
      const want = val($<HTMLSelectElement>("bank-want"), "ore" as Cargo);
      if (give === want) hooks.onNotice?.("Pick two different cargoes.", "bad");
      else if (market.bank(me, give, want)) hooks.onNotice?.(`Bank: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}.`, "good");
      else hooks.onNotice?.(`The bank wants ${BANK_RATE} ${CARGO[give].name}.`, "bad");
    } else if (a === "post") {
      const give = val($<HTMLSelectElement>("give"), "stone" as Cargo);
      const want = val($<HTMLSelectElement>("want"), "ore" as Cargo);
      const giveN = num($<HTMLInputElement>("give-n"), 2);
      const wantN = num($<HTMLInputElement>("want-n"), 2);
      if (market.post(me, give, giveN, want, wantN)) {
        hooks.onNotice?.(`Offer posted: ${giveN} ${CARGO[give].name} for ${wantN} ${CARGO[want].name}.`, "info");
      } else {
        hooks.onNotice?.("Cannot post that offer (escrow, self-trade, or the 3-offer cap).", "bad");
      }
    } else if (a === "cancel") {
      const id = Number(b.dataset.id);
      if (market.cancel(me, id)) hooks.onNotice?.("Offer withdrawn, escrow refunded.", "info");
    }
    hooks.onChange?.();
    render();
  };

  function render() {
    const mine = market.live(me);
    offersEl.innerHTML = mine.length
      ? mine.map((o) =>
        `<div class="iso-offer"><span>${o.giveN} ${CARGO[o.give].icon} → ${o.wantN} ${CARGO[o.want].icon}</span>` +
        `<button type="button" data-act="cancel" data-id="${o.id}">Withdraw</button></div>`).join("")
      : `<div class="iso-none">No live offers. The rival answers a fair offer within a few seconds.</div>`;
  }

  body.addEventListener("click", act);
  head.querySelector("[data-act=trade-hide]")?.addEventListener("click", () => setVisible(false));

  function setVisible(v: boolean) {
    visible = v;
    el.style.display = v ? "" : "none";
    if (v) render();
    hooks.onToggle?.(v);
  }

  render();

  return { el, render, setVisible, isVisible: () => visible };
}
