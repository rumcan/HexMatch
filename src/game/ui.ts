// ══════════════════════════════════════════════════════════════════════════
// U1 — the restored HexMatch interface, driven by the iso game.
//
// This file is the recovered `src/game/ui.ts` (861 lines from the pre-iso UI)
// re-wired to the iso state. The layout, class names and panel structure are
// the ORIGINAL HUD:
//
//   Left column   BUILD   Rail / Factory / Foundry controls (mapped onto the
//                         iso Road / Rail / Harvester / Demolish tools)
//   Left column   BLACK MARKET  Blockade, Frost, Girders, Smog, Security,
//                         Repair — wired to the quarry board + industry
//                         blockades the iso economy already honours.
//   Right column  YOUR QUARRY  the 9×9 match-3 board in the original panel,
//                         with MARKET / BANK / FEED tabs and the offer
//                         composer beneath it.
//   Top bar       logo, rival cards, VP.
//   Bottom        the six resource chips.
//
// The old global state (`state.ts`, `actions.ts`, `hexmap.ts`) is gone; J2
// deleted it deliberately. This module therefore never imports those files:
// it takes the live iso primitives (`board`, `market`, the player purse) and
// renders the same chrome from them.
// ══════════════════════════════════════════════════════════════════════════
import {
  BOARD_W, BOARD_H, CELL, RES, VP, OFFER_LIFE,
  SABOTAGE, SECURITY, REPAIR_COST, type ResKey,
} from "./config";
import { BANK_RATE, MAX_OFFERS } from "./trade";
import { CARGO, CARGOES, type Cargo } from "../iso/config";
import { GEM_TO_CARGO } from "../iso/quarry";
import { Board, type Gem } from "./board";
import type { IsoMarket, IsoMarketPlayer, Offer } from "../iso/market";

// ── V5: the restored gem art ────────────────────────────────────────────────
// One sprite per cargo in src/assets/gems/, mapped through the same gem→cargo
// bijection quarry.ts uses, so a colour can never draw the wrong sprite. The
// files are committed to the repo; drop a replacement PNG of the same name in
// and it is picked up here.
const GEM_ART: Record<Cargo, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>("../assets/gems/*.png", { eager: true, import: "default" }),
  ).map(([path, url]) => [path.split("/").pop()!.replace(/\.png$/, ""), url]),
) as Record<Cargo, string>;

// ── tool + state shapes ─────────────────────────────────────────────────────
export type UiTool = "road" | "rail" | "harvester" | "demolish";

export interface UiPlayer {
  id: string;
  name: string;
  colour: string;
  vp: number;
  human: boolean;
}

export interface UiState {
  players: UiPlayer[];
  purse: Partial<Record<Cargo, number>>;
  phase: string;
  tool: UiTool;
  freeTrack: number;
  banner: string | null;
  costInfo: string | null;
  inspect: string | null;
  reach: Partial<Record<Cargo, number>>;
}

export interface UiHooks {
  onTool: (tool: UiTool) => void;
  onRecenter: () => void;
  onSwap: (r1: number, c1: number, r2: number, c2: number) => void;
  onReset: () => void;
  onBlackAction: (key: string) => void;
  onCancelModal?: () => void;
}

export interface OriginalUi {
  el: HTMLElement;
  /** Where the iso canvas layer stack is mounted (the original map canvas slot). */
  mapHost: HTMLElement;
  renderBoard: () => void;
  setReach: (reach: Partial<Record<Cargo, number>>) => void;
  setCombo: (count: number, need: number) => void;
  paint: (state: UiState) => void;
  feed: (text: string, who?: string) => void;
  toast: (text: string, kind?: "good" | "bad" | "info" | "danger" | "success") => void;
  fx: (type: string, r: number, c: number, text?: string) => void;
  popup: (gains: Partial<Record<ResKey, number>>, label: string) => void;
  isQuarryOpen: () => boolean;
  isTradeOpen: () => boolean;
  showModal: (html: string) => void;
  hideModal: () => void;
  cancelBlackMode: () => void;
  /** Toggles the blockade crosshair mode (Blockade waits for an industry). */
  setBanditMode: (v: boolean) => void;
}

// ── gem face helper ─────────────────────────────────────────────────────────
// V5: gems draw the restored sprite art (src/assets/gems/<cargo>.png). The
// radial gradient is only the fallback for a missing file, so a pruned assets
// folder degrades to a coloured gem instead of a broken image.
const gemFace = (res: ResKey) =>
  `radial-gradient(circle at 34% 28%, ${RES[res].c2}, ${RES[res].c1})`;
const gemArtUrl = (res: ResKey): string | null => GEM_ART[GEM_TO_CARGO[res]] ?? null;

const h = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const costStr = (cost: Partial<Record<Cargo, number>>) =>
  (Object.keys(cost) as Cargo[]).map((k) => `${cost[k]}${CARGO[k].icon}`).join(" ");

/** Repair Crew numbers are still declared in the old ResKey table — map them. */
const REPAIR_ISO: Partial<Record<Cargo, number>> = {
  wood: REPAIR_COST.wood ?? 0,
  stone: REPAIR_COST.brick ?? 0,
  grain: REPAIR_COST.wheat ?? 0,
  ore: REPAIR_COST.ore ?? 0,
};

export function createOriginalUi(
  board: Board,
  market: IsoMarket,
  me: IsoMarketPlayer,
  hooks: UiHooks,
): OriginalUi {
  const root = h("div", "ui-root");
  root.dataset.view = "map";

  // ── the map slot (original `<canvas id="map">` is now a container for the
  //    iso layer stack: terrain / structures / overlay) ─────────────────────
  const mapHost = h("div", "map-canvas iso-stage");
  mapHost.id = "map";
  root.appendChild(mapHost);
  root.appendChild(h("div", "vignette"));

  // ── top bar ──────────────────────────────────────────────────────────────
  const top = h("header", "topbar");
  top.appendChild(h("div", "logo", `<span class="logo-mark">⚙️</span> HEXMATCH <em>INDUSTRIES</em>`));
  const kingdoms = h("div", "kingdoms");
  top.appendChild(kingdoms);
  const right = h("div", "top-right");
  const vp = h("div", "vp-badge", "★ 0");
  vp.id = "iso-vp";
  right.appendChild(vp);
  const fitBtn = h("button", "icon-btn", "🎯");
  fitBtn.title = "Recenter map";
  fitBtn.dataset.act = "recenter";
  fitBtn.onclick = () => hooks.onRecenter();
  right.appendChild(fitBtn);
  const helpBtn = h("button", "icon-btn", "❔");
  helpBtn.title = "How to play";
  helpBtn.onclick = () => helpModal();
  right.appendChild(helpBtn);
  top.appendChild(right);
  root.appendChild(top);

  // ── footer: resources ─────────────────────────────────────────────────────
  const footer = h("footer", "resbar");
  const chips = h("div", "chipbar");
  chips.id = "iso-res";
  footer.appendChild(chips);
  root.appendChild(footer);

  // ── left: BUILD + BLACK MARKET ────────────────────────────────────────────
  const left = h("aside", "aside left iso-panel");
  const bp = h("div", "panel");
  bp.appendChild(h("div", "panel-title", "🏗️ Build"));
  const buildList = h("div", "build-list");
  bp.appendChild(buildList);
  left.appendChild(bp);

  const sp = h("div", "panel grow");
  sp.appendChild(h("div", "panel-title", "🕵️ Black Market"));
  const sabList = h("div", "sab-list");
  sp.appendChild(sabList);
  left.appendChild(sp);
  root.appendChild(left);

  // ── rival offer tray (floats left of the Quarry) ─────────────────────────
  const offerTray = h("div", "offer-tray hidden");
  root.appendChild(offerTray);

  // ── right: YOUR QUARRY + MARKET / BANK / FEED ────────────────────────────
  const rightAside = h("aside", "aside right iso-panel");
  const qp = h("div", "panel");
  qp.id = "iso-quarry";
  const qh = h("div", "quarry-head");
  qh.appendChild(h("div", "panel-title", "💎 Your Quarry"));
  const quarryStatus = h("div", "quarry-status");
  qh.appendChild(quarryStatus);
  const comboBank = h("div", "combo-bank");
  qh.appendChild(comboBank);
  const resetBtn = h("button", "reset-btn", "♻ Reset");
  resetBtn.title = "Collapse the quarry: lose ALL resources, get a fresh neutral board";
  resetBtn.onclick = () => hooks.onReset();
  qh.appendChild(resetBtn);
  qp.appendChild(qh);

  const upbar = h("div", "upbar");
  const upbarFill = h("div", "upbar-fill");
  upbar.appendChild(upbarFill);
  qp.appendChild(upbar);

  // Reach strip: the original board-wrap is the quarry's board mount.
  const reachEl = h("div", "iso-reach board-wrap");
  reachEl.id = "iso-quarry-reach";
  qp.appendChild(reachEl);

  const boardWrap = h("div", "board-wrap");
  const grid = h("div", "grid");
  grid.id = "iso-gems";
  grid.style.width = CELL * BOARD_W + "px";
  grid.style.height = CELL * BOARD_H + "px";
  boardWrap.appendChild(grid);
  qp.appendChild(boardWrap);
  rightAside.appendChild(qp);

  // tabs panel (Market / Bank / Feed)
  const tp = h("div", "panel grow hidden");
  tp.id = "iso-trade";
  const tabs = h("div", "tabs");
  const tabMarket = h("button", "tab active", "Market");
  const tabBank = h("button", "tab", "Bank");
  const tabFeed = h("button", "tab", "Feed");
  tabMarket.onclick = () => setTab("market");
  tabBank.onclick = () => setTab("bank");
  tabFeed.onclick = () => setTab("feed");
  tabs.appendChild(tabMarket); tabs.appendChild(tabBank); tabs.appendChild(tabFeed);
  tp.appendChild(tabs);
  const marketPane = h("div", "pane market-pane");
  const bankPane = h("div", "pane bank-pane hidden");
  const feedPane = h("div", "pane feed-pane hidden");
  tp.appendChild(marketPane); tp.appendChild(bankPane); tp.appendChild(feedPane);
  rightAside.appendChild(tp);
  root.appendChild(rightAside);

  // ── overlays ──────────────────────────────────────────────────────────────
  const toasts = h("div", "toasts");
  root.appendChild(toasts);
  const modebar = h("div", "modebar hidden");
  root.appendChild(modebar);
  const inspectEl = h("div", "iso-inspect");
  inspectEl.style.display = "none";
  root.appendChild(inspectEl);
  const banner = h("div", "banner hidden");
  banner.id = "iso-banner";
  root.appendChild(banner);
  const modalRoot = h("div", "modal-root hidden");
  root.appendChild(modalRoot);
  const recenterBtn = h("button", "recenter-btn", "🎯");
  recenterBtn.title = "Recenter map";
  recenterBtn.onclick = () => hooks.onRecenter();
  root.appendChild(recenterBtn);

  // ── mobile bottom nav ─────────────────────────────────────────────────────
  const mobileNav = h("nav", "mnav");
  const views: [string, string, string][] = [
    ["map", "🗺", "Map"], ["quarry", "💎", "Quarry"], ["build", "🏗", "Build"], ["trade", "⇄", "Trade"],
  ];
  for (const [v, ic, label] of views) {
    const b = h("button", "mnav-btn" + (v === "map" ? " active" : ""));
    b.dataset.view = v;
    b.innerHTML = `<i>${ic}</i><span>${label}</span>`;
    b.onclick = () => setMobileView(v);
    mobileNav.appendChild(b);
  }
  root.appendChild(mobileNav);

  // ── gem / market DOM state ────────────────────────────────────────────────
  const gemEls = new Map<number, HTMLElement>();
  let selected: { r: number; c: number } | null = null;
  let down: { r: number; c: number } | null = null;
  const feedEntries: { who: string; colour: string; text: string }[] = [];
  let banditMode = false;
  // U1: the restored HUD paints on the game's rAF loop. Re-rendering the
  // Black-Market grid and the offer lists on every frame would detach a button
  // between its pointerdown and pointerup, so a real click could be lost.
  // Render those only when their visible content actually changed.
  // V4: banner dismissal state — paint() runs every frame, so the banner is
  // rebuilt only when its text changes and a dismissed text stays dismissed.
  let lastBannerText: string | null = null;
  let dismissedBanner: string | null = null;
  let lastSabKey = "\u0000";
  let lastMarketKey = "\u0000";

  // ── build list: the iso tools, keeping the original Build panel layout ────
  const TOOLS: { key: UiTool; label: string; sub: string }[] = [
    { key: "road", label: "Road", sub: "1 stone · 1 VP" },
    { key: "rail", label: "Rail", sub: "4 ore + 1 stone · 3 VP" },
    { key: "harvester", label: "Harvester", sub: "free · on industry" },
    { key: "demolish", label: "Demolish", sub: "refund none" },
  ];
  for (const t of TOOLS) {
    // V5: each tool gets its own banner artwork class (bg-road / bg-rail /
    // bg-harvester / bg-demolish) — they all shared bg-rail before.
    const b = h("button", "build-btn bg-" + t.key);
    b.dataset.tool = t.key;
    b.innerHTML = `<div class="bb-mid"><b>${t.label}</b><small>${t.sub}</small></div>`;
    b.onclick = () => hooks.onTool(t.key);
    buildList.appendChild(b);
  }
  // Quarry / Market panel toggles live at the bottom of the build column so
  // the original controls remain one list and the e2e selectors stay stable.
  const quarryBtn = h("button", "build-btn bg-factory", `<div class="bb-mid"><b>Quarry</b><small>match to harvest</small></div>`);
  quarryBtn.dataset.panel = "quarry";
  quarryBtn.onclick = () => setQuarryOpen(!isQuarryOpen());
  buildList.appendChild(quarryBtn);
  const tradeBtn = h("button", "build-btn bg-foundry", `<div class="bb-mid"><b>Market</b><small>bank 4:1</small></div>`);
  tradeBtn.dataset.panel = "trade";
  tradeBtn.onclick = () => setTradeOpen(!isTradeOpen());
  buildList.appendChild(tradeBtn);

  // ── Black Market ──────────────────────────────────────────────────────────
  function renderSabotage() {
    sabList.innerHTML = "";
    for (const key of Object.keys(SABOTAGE)) {
      const s = SABOTAGE[key];
      const afford = (me.res.gold ?? 0) >= s.gold;
      const armed = key === "bandit" && banditMode;
      const b = h("button", "sab-btn sb-" + key + (afford ? "" : " disabled") + (armed ? " active" : ""));
      b.innerHTML = `<div class="sab-top"><b>${s.name}</b><span class="sab-cost">${s.gold}🪙</span></div>` +
        `<div class="sab-desc">${s.desc}</div>`;
      b.dataset.black = key;
      b.onclick = () => hooks.onBlackAction(key);
      sabList.appendChild(b);
    }
    const secOn = false;
    const secAfford = (me.res.gold ?? 0) >= SECURITY.gold;
    const sb = h("button", "sab-btn secure-btn" + (secOn ? " active" : secAfford ? "" : " disabled"));
    sb.innerHTML = `<div class="sab-top"><b>🛡️ ${SECURITY.name}</b><span class="sab-cost">${SECURITY.gold}🪙</span></div>` +
      `<div class="sab-desc">${SECURITY.desc}</div>`;
    sb.dataset.black = "security";
    sb.onclick = () => hooks.onBlackAction("security");
    sabList.appendChild(sb);

    const afford = (Object.entries(REPAIR_ISO) as [Cargo, number][])
      .every(([k, v]) => (me.res[k] ?? 0) >= v);
    const rb = h("button", "sab-btn repair-btn" + (afford ? "" : " disabled"));
    rb.innerHTML = `<div class="sab-top"><b>🔧 Repair Crew</b><span class="sab-cost">${costStr(REPAIR_ISO)}</span></div>` +
      `<div class="sab-desc">Clear all Iron Girders & thaw all Frost tiles instantly.</div>`;
    rb.dataset.black = "repair";
    rb.onclick = () => hooks.onBlackAction("repair");
    sabList.appendChild(rb);
  }

  // ── market composer ───────────────────────────────────────────────────────
  const mkSel = (value: Cargo) => {
    const s = h("select", "res-sel") as HTMLSelectElement;
    for (const k of CARGOES) {
      const o = document.createElement("option");
      o.value = k;
      o.text = CARGO[k].name;
      s.appendChild(o);
    }
    s.value = value;
    return s;
  };
  const mkNum = (def: number) => {
    const n = h("input", "res-num") as HTMLInputElement;
    n.type = "number"; n.min = "1"; n.max = "99"; n.value = String(def);
    return n;
  };

  const postGive = mkSel("stone");
  const postWant = mkSel("ore");
  const postGiveN = mkNum(2);
  const postWantN = mkNum(2);
  const bankGive = mkSel("stone");
  const bankWant = mkSel("ore");
  postGive.dataset.f = "give";
  postWant.dataset.f = "want";
  postGiveN.dataset.f = "give-n";
  postWantN.dataset.f = "want-n";
  bankGive.dataset.f = "bank-give";
  bankWant.dataset.f = "bank-want";

  let postBtn: HTMLElement;
  const form = h("div", "trade-form");
  const giveRow = h("div", "trade-row");
  giveRow.appendChild(h("span", "trade-lbl", "Give"));
  giveRow.appendChild(postGiveN);
  giveRow.appendChild(postGive);
  const wantRow = h("div", "trade-row");
  wantRow.appendChild(h("span", "trade-lbl", "Want"));
  wantRow.appendChild(postWantN);
  wantRow.appendChild(postWant);
  postBtn = h("button", "post-btn", "Post Offer");
  postBtn.dataset.act = "post";
  postBtn.onclick = postOffer;
  form.appendChild(giveRow); form.appendChild(wantRow); form.appendChild(postBtn);
  marketPane.appendChild(form);
  const mineHead = h("div", "mine-head");
  const mineList = h("div", "offer-list mine");
  marketPane.appendChild(mineHead);
  marketPane.appendChild(mineList);

  const bform = h("div", "trade-form");
  const bGive = h("div", "trade-row");
  bGive.appendChild(h("span", "trade-lbl", "Give"));
  bGive.appendChild(h("span", "bank-fixed", String(BANK_RATE)));
  bGive.appendChild(bankGive);
  const bWant = h("div", "trade-row");
  bWant.appendChild(h("span", "trade-lbl", "Get"));
  bWant.appendChild(h("span", "bank-fixed", "1"));
  bWant.appendChild(bankWant);
  const bankBtn = h("button", "post-btn", "Exchange");
  bankBtn.dataset.act = "bank";
  bankBtn.onclick = doBank;
  bform.appendChild(bGive); bform.appendChild(bWant); bform.appendChild(bankBtn);
  bankPane.appendChild(bform);
  bankPane.appendChild(h("div", "pane-note",
    "The bank always trades four of one good for one of another. No rival required, no waiting."));

  function postOffer() {
    const give = postGive.value as Cargo;
    const want = postWant.value as Cargo;
    if (give === want) { toast("Pick two different goods to trade.", "danger"); return; }
    const giveN = Math.max(1, Math.floor(Number(postGiveN.value) || 2));
    const wantN = Math.max(1, Math.floor(Number(postWantN.value) || 2));
    if ((me.res[give] ?? 0) < giveN) { toast(`Not enough ${CARGO[give].name}.`, "danger"); return; }
    if (market.live(me).length >= MAX_OFFERS) { toast("You already have 3 offers live. Cancel one first.", "danger"); return; }
    if (market.post(me, give, giveN, want, wantN)) {
      toast(`Offer posted: ${giveN} ${CARGO[give].name} → ${wantN} ${CARGO[want].name}.`, "info");
      // W6: the feed is the trade log — posting is a trade event.
      feed(`Posted ${giveN} ${CARGO[give].name} → ${wantN} ${CARGO[want].name}`);
    }
    renderMarket();
  }

  function doBank() {
    const give = bankGive.value as Cargo;
    const want = bankWant.value as Cargo;
    if (give === want) { toast("Pick two different goods to trade.", "danger"); return; }
    if (market.bank(me, give, want)) {
      toast(`Bank: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}.`, "success");
      // W6: bank trades are trades — log them even with no rival around.
      feed(`Bank: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}`);
    }
    else toast(`The bank wants ${BANK_RATE} ${CARGO[give].name}.`, "danger");
    renderMarket();
  }

  // ── market / offer tray rendering ─────────────────────────────────────────
  function renderMarket(now: number = performance.now()) {
    const mine = market.live(me);
    mineHead.innerHTML = `<span>Your offers</span><span class="slot-count${mine.length >= MAX_OFFERS ? " full" : ""}">${mine.length}/${MAX_OFFERS}</span>`;
    postBtn.classList.toggle("disabled", mine.length >= MAX_OFFERS);
    postBtn.textContent = mine.length >= MAX_OFFERS ? "Cancel an offer first" : "Post Offer";
    mineList.innerHTML = "";
    if (!mine.length) mineList.appendChild(h("div", "empty", "No offers posted. Rivals can't see you yet."));
    for (const o of mine) {
      const secs = Math.max(0, Math.ceil((OFFER_LIFE - (now - o.born)) / 1000));
      const card = h("div", "offer");
      card.style.setProperty("--pc", me.id === "you" ? "#5aa8ff" : "#ff7a5a");
      card.innerHTML = `
        <div class="offer-who"><b style="color:inherit">You</b><span class="offer-t">${secs}s</span></div>
        <div class="offer-body"><span class="give">${o.giveN}${CARGO[o.give].icon}</span><span class="arrow">➜</span><span class="want">${o.wantN}${CARGO[o.want].icon}</span></div>`;
      const act = h("div", "offer-act");
      const b = h("button", "mini danger", "Cancel");
      b.dataset.cancel = String(o.id);
      b.onclick = () => {
        if (market.cancel(me, o.id)) {
          toast("Offer withdrawn, escrow refunded.", "info");
          feed(`Withdrew offer ${o.giveN} ${CARGO[o.give].name} → ${o.wantN} ${CARGO[o.want].name} (escrow refunded)`);
        }
        renderMarket();
      };
      act.appendChild(b);
      card.appendChild(act);
      mineList.appendChild(card);
    }
    renderOfferTray(now);
  }

  function renderOfferTray(now: number) {
    const rivals = market.ctx.offers.filter((o) => o.from !== me.i);
    if (!rivals.length) { offerTray.classList.add("hidden"); return; }
    offerTray.classList.remove("hidden");
    offerTray.innerHTML = "";
    const byRival = new Map<number, Offer[]>();
    for (const o of rivals) {
      const list = byRival.get(o.from) ?? [];
      list.push(o);
      byRival.set(o.from, list);
    }
    for (const [pi, list] of byRival) {
      const from = market.players[pi];
      if (!from) continue;
      const group = h("div", "tray-group");
      group.style.setProperty("--pc", from.id === "you" ? "#5aa8ff" : "#ff7a5a");
      group.appendChild(offerRow(list[0], from, now, true));
      if (list.length > 1) {
        const more = h("div", "tray-more");
        list.slice(1).forEach((o) => more.appendChild(offerRow(o, from, now, false)));
        group.appendChild(more);
      }
      offerTray.appendChild(group);
    }
  }

  function offerRow(o: Offer, from: IsoMarketPlayer, now: number, showName: boolean): HTMLElement {
    const can = (me.res[o.want] ?? 0) >= o.wantN;
    const row = h("div", "tray-offer");
    const secs = Math.max(0, Math.ceil((OFFER_LIFE - (now - o.born)) / 1000));
    row.innerHTML = `
      <span class="tray-who">${showName ? from.name : ""}</span>
      <span class="tray-t">${secs}s</span>
      <span class="tray-body">${o.giveN}${CARGO[o.give].icon}<i class="arrow">➜</i>${o.wantN}${CARGO[o.want].icon}</span>`;
    const b = h("button", "mini" + (can ? "" : " disabled"), "Take");
    b.onclick = (e) => {
      e.stopPropagation();
      if (market.accept(me, o.id)) {
        toast(`Took ${from.name}'s offer.`, "success");
        feed(`Took ${from.name}'s offer: ${o.giveN} ${CARGO[o.give].name} → ${o.wantN} ${CARGO[o.want].name}`);
      }
      renderMarket();
    };
    row.appendChild(b);
    return row;
  }

  // ── feed ──────────────────────────────────────────────────────────────────
  function renderFeed() {
    feedPane.innerHTML = "";
    feedEntries.slice(0, 14).forEach((f) => {
      const row = h("div", "feed-row");
      row.style.borderLeftColor = f.colour;
      row.textContent = f.text;
      feedPane.appendChild(row);
    });
  }

  // ── tabs / mobile ─────────────────────────────────────────────────────────
  function setTab(t: "market" | "bank" | "feed") {
    tabMarket.classList.toggle("active", t === "market");
    tabBank.classList.toggle("active", t === "bank");
    tabFeed.classList.toggle("active", t === "feed");
    marketPane.classList.toggle("hidden", t !== "market");
    bankPane.classList.toggle("hidden", t !== "bank");
    feedPane.classList.toggle("hidden", t !== "feed");
  }

  function setMobileView(v: string) {
    root.dataset.view = v;
    mobileNav.querySelectorAll(".mnav-btn").forEach((b: Element) => {
      (b as HTMLElement).classList.toggle("active", (b as HTMLElement).dataset.view === v);
    });
    if (v === "quarry") responsiveZoom();
  }

  // W6: the panels toggle via the `hidden` CLASS, not an inline style —
  // `.hidden { display: none !important }` in styles.css used to beat the
  // inline `style.display = ""`, so the Market button "did nothing" while the
  // (inline-style-only) test still passed. The class is the source of truth.
  function isQuarryOpen() {
    return !qp.classList.contains("hidden");
  }
  function setQuarryOpen(v: boolean) {
    qp.classList.toggle("hidden", !v);
  }
  function isTradeOpen() {
    return !tp.classList.contains("hidden");
  }
  function setTradeOpen(v: boolean) {
    tp.classList.toggle("hidden", !v);
    if (v) renderMarket();
  }

  // ── board interactions ────────────────────────────────────────────────────
  const cellFrom = (e: { clientX: number; clientY: number }): { r: number; c: number } | null => {
    const rect = grid.getBoundingClientRect();
    const cw = rect.width / BOARD_W, ch = rect.height / BOARD_H;
    const c = Math.floor((e.clientX - rect.left) / cw);
    const r = Math.floor((e.clientY - rect.top) / ch);
    if (r < 0 || r >= BOARD_H || c < 0 || c >= BOARD_W) return null;
    return { r, c };
  };
  const adj = (a: { r: number; c: number }, b: { r: number; c: number }) =>
    Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

  const selectOrSwap = (cell: { r: number; c: number }) => {
    if (selected && adj(selected, cell)) {
      hooks.onSwap(selected.r, selected.c, cell.r, cell.c);
      selected = null;
    } else {
      selected = cell;
    }
    renderSelection();
  };

  // Click is the touch/desktop picker path (and what the e2e/unit tests drive).
  grid.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".gem");
    if (b?.dataset.r && b?.dataset.c) {
      selectOrSwap({ r: Number(b.dataset.r), c: Number(b.dataset.c) });
      return;
    }
    const cell = cellFrom(e);
    if (cell) selectOrSwap(cell);
  });
  // Pointer drags still work for swipe-to-swap on touch.
  grid.addEventListener("pointerdown", (e) => {
    down = cellFrom(e);
  });
  grid.addEventListener("pointermove", (e) => {
    if (!down) return;
    const cell = cellFrom(e);
    if (cell && adj(down, cell)) { hooks.onSwap(down.r, down.c, cell.r, cell.c); down = null; selected = null; renderSelection(); }
  });
  window.addEventListener("pointerup", () => { down = null; });

  function renderSelection() {
    gemEls.forEach((elem) => elem.classList.remove("sel"));
    if (selected) {
      const g = board.grid[selected.r]?.[selected.c];
      if (g) gemEls.get(g.id)?.classList.add("sel");
    }
  }

  function styleGem(elem: HTMLElement, g: Gem) {
    const face = elem.querySelector(".face") as HTMLElement;
    const icon = elem.querySelector(".icon") as HTMLElement;
    const badge = elem.querySelector(".badge") as HTMLElement;
    elem.className = "gem res-" + g.res;
    elem.dataset.res = g.res;
    elem.dataset.tier = String(g.tier);
    face.removeAttribute("style");
    face.className = "face";
    icon.className = "icon";
    icon.textContent = "";
    badge.className = "badge";
    badge.textContent = "";
    if (g.block) {
      elem.classList.add("block");
      return;
    }
    if (g.special === "bomb") {
      elem.classList.add("bomb");
      icon.textContent = "💣";
      icon.className = "icon bombic";
      return;
    }
    // V5: sprite art per cargo; the gradient only backs a missing file.
    const url = gemArtUrl(g.res);
    if (url) {
      face.classList.add("sprite");
      face.style.backgroundImage = `url("${url}")`;
      face.style.backgroundSize = "100% 100%";
    } else {
      face.style.background = gemFace(g.res);
    }
    if (g.res === "gold") {
      elem.classList.add("wild");
      icon.textContent = "🪙";
    }
    if (g.tier > 0) {
      elem.classList.add("token");
      badge.textContent = String(g.tier);
      badge.classList.add("show", `t${g.tier}`);
    }
    if (g.hard === 2) elem.classList.add("hard2");
    else if (g.hard === 1) elem.classList.add("hard1");
  }

  function renderBoard() {
    const present = new Set<number>();
    for (const g of board.gems()) {
      present.add(g.id);
      let elem = gemEls.get(g.id);
      const x = g.c * CELL + 3, y = g.r * CELL + 3;
      if (!elem) {
        elem = document.createElement("button");
        elem.className = "gem";
        (elem as HTMLButtonElement).type = "button";
        elem.innerHTML = `<div class="face"></div><span class="icon"></span><span class="badge"></span>`;
        elem.dataset.id = String(g.id);
        elem.dataset.r = String(g.r);
        elem.dataset.c = String(g.c);
        elem.style.transform = `translate(${x}px, ${y}px)`;
        grid.appendChild(elem);
        gemEls.set(g.id, elem);
      } else {
        elem.dataset.r = String(g.r);
        elem.dataset.c = String(g.c);
        elem.style.transform = `translate(${x}px, ${y}px)`;
      }
      styleGem(elem, g);
      g.isNew = false;
    }
    gemEls.forEach((elem, id) => {
      if (!present.has(id)) {
        elem.classList.add("gone");
        setTimeout(() => elem.remove(), 260);
        gemEls.delete(id);
      }
    });
    const combo = board.comboCount;
    setCombo(combo, Board.COMBOS_PER_GOLD);
    renderSelection();
  }

  // ── FX / popups / toasts / banner / modals ────────────────────────────────
  function fx(type: string, r: number, c: number, text?: string) {
    const e = h("div", `fx fx-${type}`);
    e.style.left = (c * CELL + CELL / 2) + "px";
    e.style.top = (r * CELL + CELL / 2) + "px";
    if (text) e.textContent = text;
    grid.appendChild(e);
    setTimeout(() => e.remove(), type === "chain" ? 1000 : 600);
  }

  function popup(gains: Partial<Record<ResKey, number>>, label: string) {
    const e = h("div", "harvest-pop");
    const parts = (Object.keys(gains) as ResKey[]).map((k) =>
      `<span>${gains[k] ?? 0}${RES[k].icon}</span>`).join("");
    e.innerHTML = (label ? `<b class="hp-label">${label}</b>` : "") + `<div class="hp-body">${parts}</div>`;
    boardWrap.appendChild(e);
    setTimeout(() => e.remove(), 1600);
  }

  const lastToast: Record<string, number> = {};
  function toast(text: string, kind: "good" | "bad" | "info" | "danger" | "success" = "info") {
    const now = performance.now();
    if (lastToast[text] && now - lastToast[text] < 900) return;
    lastToast[text] = now;
    // V4: the toast carries its own ✕ and the ✕ actually closes it — the
    // auto-dismiss timer is cleared so a closed toast can never re-arm, and
    // each toast owns its timer so closing one leaves the stack intact.
    const t = h("div", `toast ${kind === "danger" ? "danger" : kind}`);
    t.appendChild(h("span", "toast-msg", text));
    const x = h("button", "toast-x", "✕");
    (x as HTMLButtonElement).type = "button";
    x.title = "Dismiss";
    let timer = 0;
    const close = () => {
      window.clearTimeout(timer);
      t.classList.remove("in");
      setTimeout(() => t.remove(), 300);
    };
    x.onclick = (e) => { e.stopPropagation(); close(); };
    t.appendChild(x);
    toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add("in"));
    timer = window.setTimeout(close, 2400);
  }

  function feed(text: string, who?: string) {
    const player = market.players.find((p) => p.name === who) ?? me;
    feedEntries.unshift({
      who: player.name,
      colour: player.id === "you" ? "#5aa8ff" : "#ff7a5a",
      text,
    });
    if (feedEntries.length > 40) feedEntries.pop();
    renderFeed();
  }

  function responsiveZoom() {
    const boardPx = CELL * BOARD_W;
    const wrap = boardWrap;
    let z = 1;
    if (window.innerWidth <= 760) {
      const availW = window.innerWidth - 24;
      const availH = window.innerHeight - 210;
      z = Math.min(availW / boardPx, availH / boardPx, 1);
      z = Math.max(0.4, z);
    } else {
      const vh = window.innerHeight;
      if (vh <= 720) z = 0.68; else if (vh <= 800) z = 0.8; else if (vh <= 900) z = 0.9;
      // V3: the height-only rule could leave the board wider than the space
      // the right column has on a narrow desktop window, and the panel edge
      // cut the last columns off the quarry. Clamp by that width too.
      const leftW = window.innerWidth <= 900 ? 0 : (window.innerWidth <= 1180 ? 262 : 300);
      const availW = window.innerWidth - leftW - 64;
      z = Math.max(0.4, Math.min(z, availW / (boardPx + 10)));
    }
    wrap.style.zoom = String(z);
    // V3: publish the zoomed board width. The right aside and the quarry
    // panel size themselves from it (styles.css), so the panel always fits
    // all BOARD_W columns instead of a fixed width that assumes fewer.
    const boardW = Math.ceil((boardPx + 10) * z);
    root.style.setProperty("--board-px", `${boardW}px`);
    root.style.setProperty("--tray-right", `${boardW + 52}px`);
    // dataset twin of the custom properties (jsdom has no `zoom`/var support,
    // and tests assert the published numbers through these).
    boardWrap.dataset.zoom = String(z);
    root.dataset.boardPx = String(boardW);
  }
  window.addEventListener("resize", responsiveZoom);
  window.addEventListener("orientationchange", responsiveZoom);

  // ── top HUD: chips, VP, kingdoms ──────────────────────────────────────────
  function renderHUD(purse: Partial<Record<Cargo, number>>, players: UiPlayer[]) {
    chips.innerHTML = "";
    for (const k of CARGOES) {
      const chip = h("div", "chip");
      chip.style.setProperty("--c1", CARGO[k].c1);
      chip.style.setProperty("--c2", CARGO[k].c2);
      chip.innerHTML = `<span class="chip-ic"><i class="gem-ic">${CARGO[k].icon}</i></span><span class="chip-n">${purse[k] ?? 0}</span>`;
      chips.appendChild(chip);
    }
    const meP = players.find((p) => p.human);
    const yourVp = meP?.vp ?? 0;
    // The original badge is just a star counter; keeping "You" in it lets the
    // boot/e2e assertions stay unambiguous for the single-player build.
    vp.innerHTML = `<span class="vp-star">★</span> You ${yourVp}<span class="vp-tot">/${VP.target}</span>`;

    const list = [...players].sort((a, b) => b.vp - a.vp);
    kingdoms.innerHTML = "";
    for (const p of list) {
      const row = h("div", "king" + (p.human ? " self" : ""));
      row.style.setProperty("--pc", p.colour);
      row.innerHTML = `
        <div class="king-av">${p.name[0]}</div>
        <div class="king-mid">
          <div class="king-name">${p.name}${p.human ? " <span class='you'>YOU</span>" : ""}</div>
          <div class="king-bar"><i style="width:${Math.min(100, (p.vp / VP.target) * 100)}%;background:${p.colour}"></i></div>
        </div>
        <div class="king-vp">${p.vp}<small>★</small></div>`;
      kingdoms.appendChild(row);
    }
  }

  // ── quota status / upgrade bar / combo ─────────────────────────────────────
  function setCombo(count: number, need: number) {
    comboBank.innerHTML = `<span class="cb-lbl">Combo</span>` +
      Array.from({ length: need }, (_, i) => `<i class="${i < count ? "on" : ""}"></i>`).join("");
  }

  // ── paint ─────────────────────────────────────────────────────────────────
  function paint(state: UiState) {
    renderHUD(state.purse, state.players);
    const sabKey = `${me.res.gold ?? 0}:${banditMode}`;
    if (sabKey !== lastSabKey) {
      lastSabKey = sabKey;
      renderSabotage();
    }
    // V4: the banner's ✕ must stick. paint() runs every frame, so rebuilding
    // the banner (and re-showing it) each frame undid the close click — the
    // reported "click the X and it stays there". Rebuild only when the text
    // changes, and remember a dismissed text until the message changes.
    if (state.banner !== lastBannerText) {
      lastBannerText = state.banner;
      dismissedBanner = null;
      if (state.banner) {
        const text = state.banner;
        banner.innerHTML = `<button class="banner-close" title="Hide">✕</button>` +
          `<small>${text}</small>`;
        (banner.querySelector(".banner-close") as HTMLElement).onclick = () => {
          dismissedBanner = text;
          banner.classList.add("hidden");
        };
      }
    }
    banner.classList.toggle("hidden", !state.banner || dismissedBanner === state.banner);
    const toolState = state.tool;
    buildList.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === toolState);
    });
    buildList.querySelectorAll<HTMLElement>("[data-panel]").forEach((b) => {
      const open = b.dataset.panel === "quarry" ? isQuarryOpen() : isTradeOpen();
      b.classList.toggle("active", open);
    });
    buildList.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
      b.classList.toggle("active", b.dataset.act === "recenter");
    });
    const info = state.costInfo;
    modebar.classList.toggle("hidden", !info);
    if (info) {
      modebar.innerHTML = info;
      const cancel = h("button", "mb-cancel", "Cancel ✕");
      cancel.onclick = () => { banditMode = false; hooks.onCancelModal?.(); renderSabotage(); modebar.classList.add("hidden"); };
      modebar.appendChild(cancel);
    }
    if (state.inspect) {
      inspectEl.innerHTML = state.inspect;
      inspectEl.style.display = "block";
    } else {
      inspectEl.innerHTML = "";
      inspectEl.style.display = "none";
    }
    const now = performance.now();
    // Refresh when offers are born/expired/accepted, and once per second so the
    // on-card countdown stays live without rebuilding the DOM every frame.
    const offerSecs = (o: import("../iso/market").Offer) =>
      Math.max(0, Math.ceil((OFFER_LIFE - (now - o.born)) / 1000));
    const marketKey = market.ctx.offers
      .map((o) => `${o.id}:${o.from}:${o.give}:${o.want}:${o.giveN}:${o.wantN}:${offerSecs(o)}`)
      .join("|");
    if (marketKey !== lastMarketKey) {
      lastMarketKey = marketKey;
      renderMarket(now);
    }
  }

  function setReach(next: Partial<Record<Cargo, number>>) {
    const chipsHtml = CARGOES
      .filter((c) => (next[c] ?? 0) > 0)
      .map((c) => `<span class="chip" style="--c:${CARGO[c].c2}">${CARGO[c].icon}${CARGO[c].name}</span>`).join("");
    reachEl.innerHTML = chipsHtml
      ? `<b>Network reaches</b>${chipsHtml}`
      : "<b>Network reaches</b><i>nothing — connect a harvester</i>";
    const hint = h("div", "iso-hint");
    hint.textContent = chipsHtml
      ? "Match 3+ gems. Only tokened gems (numbered) harvest the cargo above."
      : "Connect a harvester to your Factory: tokens only spawn on cargo you reach.";
    reachEl.appendChild(hint);
  }

  // ── help / modals ─────────────────────────────────────────────────────────
  function helpModal() {
    modalRoot.classList.remove("hidden");
    modalRoot.innerHTML = `
      <div class="modal-back"></div>
      <div class="modal box">
        <h2>⚙️ HEXMATCH INDUSTRIES</h2>
        <p class="sub">Two worlds, one empire. First to <b>${VP.target}★ Victory Points</b> wins.</p>
        <div class="help-cols">
          <div class="help-col"><h3>🏙️ The Territory</h3><p>Build <b>Roads</b> & <b>Rails</b> between your Factory and Harvesters. The rail multiplier and VP are on the connection; a broken line revokes it.</p></div>
          <div class="help-col"><h3>💎 The Quarry</h3><p>Match tokens to harvest. A colour only pays when your network reaches its industry. Match 4 doubles, match 5 makes a <b>bomb</b>. <b>Gold</b> 🌹 is wild.</p></div>
          <div class="help-col"><h3>🪙 Gold, Trade & Defence</h3><p>Earn <b>gold</b> from gold-mine access or combos. Buy Black Market actions, post offers or bank 4:1.</p></div>
        </div>
        <button class="big-btn" id="startBtn">Start Production ⚙️</button>
      </div>`;
    (modalRoot.querySelector("#startBtn") as HTMLElement).onclick = () => modalRoot.classList.add("hidden");
    (modalRoot.querySelector(".modal-back") as HTMLElement).onclick = () => modalRoot.classList.add("hidden");
  }

  function showModal(html: string) {
    modalRoot.classList.remove("hidden");
    modalRoot.innerHTML = `<div class="modal-back"></div>${html}`;
    (modalRoot.querySelector(".modal-back") as HTMLElement).onclick = () => modalRoot.classList.add("hidden");
  }
  function hideModal() { modalRoot.classList.add("hidden"); }

  function cancelBlackMode() {
    banditMode = false;
    modebar.classList.add("hidden");
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  renderSabotage();
  renderBoard();
  renderMarket();
  responsiveZoom();
  setQuarryOpen(true);
  setTradeOpen(false);

  return {
    el: root,
    mapHost,
    renderBoard,
    setReach,
    setCombo,
    paint,
    feed,
    toast,
    fx,
    popup,
    isQuarryOpen,
    isTradeOpen,
    showModal,
    hideModal,
    cancelBlackMode,
    setBanditMode(v: boolean) { banditMode = v; renderSabotage(); },
  };
}
