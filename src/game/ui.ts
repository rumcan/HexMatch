import {
  RES, RES_KEYS, ResKey, COSTS, SABOTAGE, SECURITY, CELL, VP, TILES, REPAIR_COST,
  BOARD_W, BOARD_H, GEM_SHEET, GEM_FRAME, GEM_FRAMES,
} from "./config";
import { G, Player, Offer, bus } from "./state";
import { canAfford } from "./actions";
import { liveOffers } from "./trade";
import { playerResources } from "./hexmap";

let root: HTMLElement;
const el: any = {};
const gemEls = new Map<number, HTMLElement>();
let selected: { r: number; c: number } | null = null;
let down: { r: number; c: number } | null = null;
const feed: { who: number; text: string }[] = [];

// ── gem sprite helper ─────────────────────────────────────────────
// Returns an inline element showing one frame of gems_spritesheet.png.
// Used everywhere a resource needs an icon: chips, costs, offers, tax rows.
export function gemIcon(res: ResKey, size = 20): string {
  const frame = GEM_FRAME[res] ?? 0;
  const pos = (frame * 100) / (GEM_FRAMES - 1);
  return `<i class="gem-ic" style="width:${size}px;height:${size}px;` +
    `background-image:url(${GEM_SHEET});` +
    `background-size:${GEM_FRAMES * 100}% 100%;` +
    `background-position:${pos}% 50%"></i>`;
}

const h = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

const costStr = (cost: Partial<Record<ResKey, number>>) =>
  (Object.keys(cost) as ResKey[]).map((k) => `${cost[k]}${gemIcon(k, 16)}`).join(" ");

export function buildDOM(container: HTMLElement) {
  root = container;
  root.innerHTML = "";

  const canvas = h("canvas", "map-canvas") as HTMLCanvasElement;
  canvas.id = "map";
  root.appendChild(canvas);
  el.canvas = canvas;

  root.appendChild(h("div", "vignette"));

  // ── top bar: logo, tycoon roster (horizontal), VP + controls ──
  const top = h("header", "topbar");
  top.appendChild(h("div", "logo", `<span class="logo-mark">⚙️</span> HEXMATCH <em>INDUSTRIES</em>`));
  // tycoons now live in the top bar, laid out in a single row
  el.kingdoms = h("div", "kingdoms");
  top.appendChild(el.kingdoms);
  const right = h("div", "top-right");
  el.vp = h("div", "vp-badge");
  right.appendChild(el.vp);
  const helpBtn = h("button", "icon-btn", "❔");
  helpBtn.title = "How to play";
  helpBtn.onclick = () => helpModal();
  const fitBtn = h("button", "icon-btn", "🎯");
  fitBtn.title = "Recenter map";
  fitBtn.onclick = () => bus.emit("fit");
  right.appendChild(fitBtn);
  right.appendChild(helpBtn);
  top.appendChild(right);
  root.appendChild(top);

  // ── footer: your resources, centred ──
  const footer = h("footer", "resbar");
  el.chips = h("div", "chipbar");
  footer.appendChild(el.chips);
  root.appendChild(footer);

  // ── left aside ──
  const left = h("aside", "aside left");
  const bp = h("div", "panel");
  bp.appendChild(h("div", "panel-title", "🏗️ Build"));
  el.build = h("div", "build-list");
  bp.appendChild(el.build);
  left.appendChild(bp);

  const sp = h("div", "panel grow");
  sp.appendChild(h("div", "panel-title", "🕵️ Black Market"));
  el.sabotage = h("div", "sab-list");
  sp.appendChild(el.sabotage);
  left.appendChild(sp);
  root.appendChild(left);

  // ── rival offer tray: floats left of the Quarry panel ──
  el.offerTray = h("div", "offer-tray hidden");
  root.appendChild(el.offerTray);

  // ── right aside ──
  const rt = h("aside", "aside right");
  const qp = h("div", "panel");
  const qh = h("div", "quarry-head");
  qh.appendChild(h("div", "panel-title", "💎 Your Quarry"));
  el.quarryStatus = h("div", "quarry-status");
  qh.appendChild(el.quarryStatus);
  el.comboBank = h("div", "combo-bank");
  qh.appendChild(el.comboBank);
  const resetBtn = h("button", "reset-btn", "♻ Reset");
  resetBtn.title = "Collapse the quarry: lose ALL resources, get a fresh neutral board";
  resetBtn.onclick = () => bus.emit("board:reset");
  qh.appendChild(resetBtn);
  qp.appendChild(qh);

  const bar = h("div", "upbar");
  el.upbarFill = h("div", "upbar-fill");
  bar.appendChild(el.upbarFill);
  qp.appendChild(bar);

  const wrap = h("div", "board-wrap");
  el.grid = h("div", "grid");
  el.grid.style.width = CELL * BOARD_W + "px";
  el.grid.style.height = CELL * BOARD_H + "px";
  wrap.appendChild(el.grid);
  el.fog = h("div", "fog-overlay", "🌫️ WAR FOG");
  wrap.appendChild(el.fog);
  qp.appendChild(wrap);
  rt.appendChild(qp);
  el.boardWrap = wrap;

  // tabs panel
  const tp = h("div", "panel grow");
  const tabs = h("div", "tabs");
  el.tabMarket = h("button", "tab active", "Market");
  el.tabBank = h("button", "tab", "Bank");
  el.tabFeed = h("button", "tab", "Feed");
  el.tabMarket.onclick = () => setTab("market");
  el.tabBank.onclick = () => setTab("bank");
  el.tabFeed.onclick = () => setTab("feed");
  tabs.appendChild(el.tabMarket); tabs.appendChild(el.tabBank); tabs.appendChild(el.tabFeed);
  tp.appendChild(tabs);
  el.marketPane = h("div", "pane market-pane");
  el.bankPane = h("div", "pane bank-pane hidden");
  el.feedPane = h("div", "pane feed-pane hidden");
  tp.appendChild(el.marketPane);
  tp.appendChild(el.bankPane);
  tp.appendChild(el.feedPane);
  rt.appendChild(tp);
  root.appendChild(rt);

  // overlays
  el.toasts = h("div", "toasts"); root.appendChild(el.toasts);
  el.modebar = h("div", "modebar hidden"); root.appendChild(el.modebar);
  el.banner = h("div", "banner hidden"); root.appendChild(el.banner);
  el.modalRoot = h("div", "modal-root hidden"); root.appendChild(el.modalRoot);

  // ── mobile bottom nav (hidden by CSS on desktop) ──
  el.mobileNav = h("nav", "mnav");
  const views: [string, string, string][] = [
    ["map", "🗺", "Map"],
    ["quarry", "💎", "Quarry"],
    ["build", "🏗", "Build"],
    ["trade", "⇄", "Trade"],
  ];
  for (const [v, ic, label] of views) {
    const b = h("button", "mnav-btn" + (v === "map" ? " active" : ""));
    b.dataset.view = v;
    b.innerHTML = `<i>${ic}</i><span>${label}</span>`;
    b.onclick = () => setMobileView(v);
    el.mobileNav.appendChild(b);
  }
  root.appendChild(el.mobileNav);
  root.dataset.view = "map";

  bindGrid();
  bindFeed();
  buildMarketForm();
  responsiveZoom();
  window.addEventListener("resize", responsiveZoom);
  window.addEventListener("orientationchange", responsiveZoom);
}

// Switches which panel is on screen when the layout is in phone mode.
// On desktop the nav is hidden and everything is visible at once, so this is
// only ever driven by the bottom nav.
export function setMobileView(v: string) {
  root.dataset.view = v;
  el.mobileNav.querySelectorAll(".mnav-btn").forEach((b: Element) => {
    (b as HTMLElement).classList.toggle("active", (b as HTMLElement).dataset.view === v);
  });
  if (v === "quarry") responsiveZoom();
}

export const isMobile = () => window.innerWidth <= 760;

function responsiveZoom() {
  const wrap = el.boardWrap;
  const boardPx = CELL * BOARD_W;          // intrinsic board size
  let z = 1;

  if (isMobile()) {
    // fit the board to the narrower of viewport width / available height
    const availW = window.innerWidth - 24;
    const availH = window.innerHeight - 210;   // top bar + tabs + nav + footer
    z = Math.min(availW / boardPx, availH / boardPx, 1);
    z = Math.max(0.4, z);
  } else {
    const vh = window.innerHeight;
    if (vh <= 720) z = 0.68; else if (vh <= 800) z = 0.8; else if (vh <= 900) z = 0.9;
  }
  wrap.style.zoom = String(z);
}

// ── TOP: resource chips + VP ──
export function renderHUD() {
  const p = G.players[0] as Player;
  const now = performance.now();
  el.chips.innerHTML = "";
  for (const k of RES_KEYS) {
    const chip = h("div", "chip");
    const recent = (p.lastGain[k] ?? 0) > now - 700;
    if (recent) chip.classList.add("pulse");
    chip.style.setProperty("--c1", RES[k].c1);
    chip.style.setProperty("--c2", RES[k].c2);
    chip.innerHTML = `<span class="chip-ic">${gemIcon(k, 22)}</span><span class="chip-n">${p.res[k]}</span>`;
    el.chips.appendChild(chip);
  }
  el.vp.innerHTML = `<span class="vp-star">★</span> ${p.vp}<span class="vp-tot">/${VP.target}</span>`;
}


// Maps a tycoon to its portrait class. Falls back to a coloured initial if the
// name isn't recognised, so custom/extra players still render.
function portraitClass(p: Player): string {
  if (p.human) return "pt-you";
  const n = p.name.toLowerCase();
  if (n.includes("krag")) return "pt-krag";
  if (n.includes("vex")) return "pt-vex";
  if (n.includes("torvin")) return "pt-torvin";
  return "";
}

// ── kingdoms leaderboard ──
export function renderKingdoms() {
  const now = performance.now();
  const list = [...G.players].sort((a: Player, b: Player) => b.vp - a.vp);
  el.kingdoms.innerHTML = "";
  for (const p of list as Player[]) {
    const row = h("div", "king" + (p.human ? " self" : "") + (G.pendingSabotage && !p.human ? " targetable" : ""));
    const slowed = p.slowedUntil > now;
    row.style.setProperty("--pc", p.color);
    row.innerHTML = `
      <div class="king-av has-portrait ${portraitClass(p)}">${p.name[0]}</div>
      <div class="king-mid">
        <div class="king-name">${p.name}${p.human ? " <span class='you'>YOU</span>" : ""}${slowed ? " <span class='sabbed'>⚠ hit</span>" : ""}</div>
        <div class="king-bar"><i style="width:${Math.min(100, p.vp / VP.target * 100)}%;background:${p.color}"></i></div>
      </div>
      <div class="king-vp">${p.vp}<small>★</small></div>`;
    if (G.pendingSabotage && !p.human) {
      row.onclick = () => bus.emit("player:click", p.i);
    }
    el.kingdoms.appendChild(row);
  }
}

// ── build buttons ──
export function renderBuild() {
  const p = G.players[0] as Player;
  el.build.innerHTML = "";
  // `bg` selects the line-art artwork behind each button (see styles.css)
  const items: { mode: string; bg: string }[] = [
    { mode: "road", bg: "bg-rail" },
    { mode: "settlement", bg: "bg-factory" },
    { mode: "city", bg: "bg-foundry" },
  ];
  for (const it of items) {
    const c = COSTS[it.mode];
    const afford = canAfford(p, c.cost) || G.setupPhase;
    const active = G.buildMode === it.mode;
    // greyed = can't afford; highlighted = currently selected; ready = affordable
    const cls = "build-btn " + it.bg + (active ? " active" : afford ? " ready" : " disabled");
    const b = h("button", cls);
    b.innerHTML = `<span class="bb-mid"><b>${c.label}</b><small>${costStr(c.cost)}${c.vp ? ` · +${c.vp}★` : ""}</small></span>`;
    b.onclick = () => bus.emit("build:mode", it.mode);
    el.build.appendChild(b);
  }
  // Toll pass — always available (cost is paid on use)
  const active = G.buildMode === "toll";
  const tb = h("button", "build-btn toll-btn" + (active ? " active" : G.setupPhase ? " disabled" : " ready"));
  tb.innerHTML = `<span class="bb-mid"><b>Toll Pass</b><small>use a rival's rails · ½ your goods</small></span>`;
  tb.onclick = () => bus.emit("build:mode", "toll");
  el.build.appendChild(tb);
}

// ── black market ──
export function renderSabotage() {
  const p = G.players[0] as Player;
  el.sabotage.innerHTML = "";
  for (const key of Object.keys(SABOTAGE)) {
    const s = SABOTAGE[key];
    const afford = p.res.gold >= s.gold;
    const armed = G.pendingSabotage === key || (key === "bandit" && G.buildMode === "bandit");
    // `sb-<key>` selects the banner artwork for this ability (see styles.css)
    const b = h("button", "sab-btn sb-" + key + (afford ? "" : " disabled") + (armed ? " active" : ""));
    b.innerHTML = `<div class="sab-top"><b>${s.name}</b><span class="sab-cost">${s.gold}🪙</span></div>
      <div class="sab-desc">${s.desc}</div>`;
    b.onclick = () => bus.emit("sabotage:buy", key);
    el.sabotage.appendChild(b);
  }
  // ── Security Forces (defensive) — immunity to Blockade & Smog ──
  const secOn = p.securedUntil > performance.now();
  const secAfford = p.res.gold >= SECURITY.gold;
  const sb = h("button", "sab-btn secure-btn" + (secOn ? " active" : secAfford ? "" : " disabled"));
  const secLeft = secOn ? ` (${Math.ceil((p.securedUntil - performance.now()) / 1000)}s)` : "";
  sb.innerHTML = `<div class="sab-top"><b>🛡️ ${SECURITY.name}${secLeft}</b><span class="sab-cost">${SECURITY.gold}🪙</span></div>
    <div class="sab-desc">${SECURITY.desc}</div>`;
  sb.onclick = () => bus.emit("security:buy");
  el.sabotage.appendChild(sb);
  // ── Repair Crew (defensive) — clear board obstacles ──
  const cost = costStr(REPAIR_COST);
  const afford = canAfford(p, REPAIR_COST);
  const rb = h("button", "sab-btn repair-btn" + (afford ? "" : " disabled"));
  rb.innerHTML = `<div class="sab-top"><b>🔧 Repair Crew</b><span class="sab-cost">${cost}</span></div>
    <div class="sab-desc">Clear all Iron Girders & thaw all Frost tiles instantly.</div>`;
  rb.onclick = () => bus.emit("repair:buy");
  el.sabotage.appendChild(rb);
}

// ── market ──
function buildMarketForm() {
  const mkSel = (id: string) => {
    const s = h("select", "res-sel") as HTMLSelectElement;
    RES_KEYS.forEach((k) => {
      const o = document.createElement("option");
      o.value = k; o.text = RES[k].name;
      s.appendChild(o);
    });
    el[id] = s; return s;
  };
  const mkNum = (id: string, def: number) => {
    const n = h("input", "res-num") as HTMLInputElement;
    n.type = "number"; n.min = "1"; n.max = "9"; n.value = String(def);
    el[id] = n; return n;
  };

  // ── MARKET tab: post an offer to rivals ──
  const form = h("div", "trade-form");
  const giveRow = h("div", "trade-row");
  giveRow.appendChild(h("span", "trade-lbl", "Give"));
  giveRow.appendChild(mkNum("giveN", 1));
  giveRow.appendChild(mkSel("giveSel"));
  const wantRow = h("div", "trade-row");
  wantRow.appendChild(h("span", "trade-lbl", "Want"));
  wantRow.appendChild(mkNum("wantN", 1));
  wantRow.appendChild(mkSel("wantSel"));
  (el.giveSel as HTMLSelectElement).value = "wood";
  (el.wantSel as HTMLSelectElement).value = "ore";

  el.postBtn = h("button", "post-btn", "Post Offer");
  el.postBtn.onclick = () => {
    const p = G.players[0] as Player;
    const give = (el.giveSel as HTMLSelectElement).value as ResKey;
    const want = (el.wantSel as HTMLSelectElement).value as ResKey;
    const giveN = Math.max(1, +(el.giveN as HTMLInputElement).value);
    const wantN = Math.max(1, +(el.wantN as HTMLInputElement).value);

    // check each rule separately so the player is told exactly what's wrong
    if (give === want) {
      toast("Pick two different goods to trade.", "danger");
      return;
    }
    if (p.res[give] < giveN) {
      toast(`Not enough ${RES[give].name} — you have ${p.res[give]}, the offer needs ${giveN}.`, "danger");
      return;
    }
    if (liveOffers(p).length >= 3) {
      toast("You already have 3 offers live. Cancel one first.", "danger");
      return;
    }
    bus.emit("offer:create", { give, giveN, want, wantN });
  };
  form.appendChild(giveRow); form.appendChild(wantRow); form.appendChild(el.postBtn);
  el.marketForm = form;

  // your live offers, with the 3-slot counter
  el.mineHead = h("div", "mine-head");
  el.mineList = h("div", "offer-list mine");
  el.marketPane.appendChild(form);
  el.marketPane.appendChild(el.mineHead);
  el.marketPane.appendChild(el.mineList);

  // ── BANK tab: fixed-rate 4:1 exchange, no rival needed ──
  const bform = h("div", "trade-form");
  const bGive = h("div", "trade-row");
  bGive.appendChild(h("span", "trade-lbl", "Give"));
  bGive.appendChild(h("span", "bank-fixed", "4"));
  bGive.appendChild(mkSel("bankGiveSel"));
  const bWant = h("div", "trade-row");
  bWant.appendChild(h("span", "trade-lbl", "Get"));
  bWant.appendChild(h("span", "bank-fixed", "1"));
  bWant.appendChild(mkSel("bankWantSel"));
  (el.bankGiveSel as HTMLSelectElement).value = "wood";
  (el.bankWantSel as HTMLSelectElement).value = "ore";
  const bank = h("button", "post-btn", "Exchange");
  bank.onclick = () => bus.emit("bank:trade", {
    give: (el.bankGiveSel as HTMLSelectElement).value,
    want: (el.bankWantSel as HTMLSelectElement).value,
  });
  bform.appendChild(bGive); bform.appendChild(bWant); bform.appendChild(bank);
  el.bankPane.appendChild(bform);
  el.bankPane.appendChild(h("div", "pane-note",
    "The bank always trades four of one good for one of another. No rival required, no waiting."));
}

export function renderMarket() {
  const me = G.players[0] as Player;
  const now = performance.now();
  const mine = (G.offers as Offer[]).filter((o) => o.from === me.i);

  // slot counter + post button state
  el.mineHead.innerHTML =
    `<span>Your offers</span><span class="slot-count${mine.length >= 3 ? " full" : ""}">${mine.length}/3</span>`;
  el.postBtn.classList.toggle("disabled", mine.length >= 3);
  el.postBtn.textContent = mine.length >= 3 ? "Cancel an offer first" : "Post Offer";

  el.mineList.innerHTML = "";
  if (!mine.length) {
    el.mineList.appendChild(h("div", "empty", "No offers posted. Rivals can't see you yet."));
  }
  for (const o of mine) {
    const secs = Math.max(0, Math.ceil((40000 - (now - o.born)) / 1000));
    const card = h("div", "offer");
    card.style.setProperty("--pc", me.color);
    card.innerHTML = `
      <div class="offer-who"><b style="color:${me.color}">You</b><span class="offer-t">${secs}s</span></div>
      <div class="offer-body">
        <span class="give">${o.giveN}${gemIcon(o.give, 16)}</span>
        <span class="arrow">➜</span>
        <span class="want">${o.wantN}${gemIcon(o.want, 16)}</span>
      </div>`;
    const act = h("div", "offer-act");
    const b = h("button", "mini danger", "Cancel");
    b.onclick = () => bus.emit("offer:cancel", o.id);
    act.appendChild(b);
    card.appendChild(act);
    el.mineList.appendChild(card);
  }

  renderOfferTray();
}

// ── floating rival-offer tray (top-right, left of the Quarry) ─────────
// One row per rival showing their newest offer. Hovering a row expands
// only THAT rival's other offers. The DOM is rebuilt only when the set of
// offers actually changes — timers are patched in place — otherwise the
// per-frame re-render destroys hover state and flickers.
let traySig = "";

export function renderOfferTray() {
  const me = G.players[0] as Player;
  const tray = el.offerTray as HTMLElement;
  const rivals = (G.offers as Offer[]).filter((o) => o.from !== me.i);

  if (!rivals.length) { tray.classList.add("hidden"); traySig = ""; return; }
  tray.classList.remove("hidden");

  // affordability is part of the signature so Take buttons stay accurate
  const sig = rivals.map((o) => `${o.id}:${me.res[o.want] >= o.wantN ? 1 : 0}`).join(",");
  if (sig === traySig) { patchTrayTimers(); return; }
  traySig = sig;

  // group by rival, newest first (G.offers is unshifted so order is newest→oldest)
  const byRival = new Map<number, Offer[]>();
  for (const o of rivals) {
    if (!byRival.has(o.from)) byRival.set(o.from, []);
    byRival.get(o.from)!.push(o);
  }

  tray.innerHTML = "";
  for (const [pi, list] of byRival) {
    const from = G.players[pi] as Player;
    const group = h("div", "tray-group");
    group.style.setProperty("--pc", from.color);

    // headline row = this rival's most recent offer
    group.appendChild(offerRow(list[0], from, me, true));

    // the rest, revealed when this group is hovered
    if (list.length > 1) {
      group.appendChild(showMoreRow(list.length - 1));
      const more = h("div", "tray-more");
      list.slice(1).forEach((o) => more.appendChild(offerRow(o, from, me, false)));
      group.appendChild(more);
    }
    tray.appendChild(group);
  }
}

function offerRow(o: Offer, from: Player, me: Player, showName: boolean): HTMLElement {
  const can = me.res[o.want] >= o.wantN;
  const row = h("div", "tray-offer");
  row.innerHTML = `
    <span class="tray-who">${showName ? from.name : ""}</span>
    <span class="tray-t" data-born="${o.born}"></span>
    <span class="tray-body">${o.giveN}${gemIcon(o.give, 15)}<i class="arrow">➜</i>${o.wantN}${gemIcon(o.want, 15)}</span>`;
  const b = h("button", "mini" + (can ? "" : " disabled"), "Take");
  b.onclick = (e) => { e.stopPropagation(); bus.emit("offer:accept", o.id); };
  row.appendChild(b);
  return row;
}

// "Show more ⑵" strip that sits under the headline offer
function showMoreRow(n: number): HTMLElement {
  const r = h("div", "tray-showmore");
  r.innerHTML = `<span>Show more</span><span class="more-count">${n}</span>`;
  return r;
}

// cheap per-frame update: only the countdown text changes
function patchTrayTimers() {
  const now = performance.now();
  (el.offerTray as HTMLElement).querySelectorAll("[data-born]").forEach((n) => {
    const born = +(n as HTMLElement).dataset.born!;
    (n as HTMLElement).textContent = Math.max(0, Math.ceil((40000 - (now - born)) / 1000)) + "s";
  });
}

function setTab(t: "market" | "bank" | "feed") {
  el.tabMarket.classList.toggle("active", t === "market");
  el.tabBank.classList.toggle("active", t === "bank");
  el.tabFeed.classList.toggle("active", t === "feed");
  el.marketPane.classList.toggle("hidden", t !== "market");
  el.bankPane.classList.toggle("hidden", t !== "bank");
  el.feedPane.classList.toggle("hidden", t !== "feed");
}

function bindFeed() {
  bus.on("log", (d: { who: number; text: string }) => {
    feed.unshift(d);
    if (feed.length > 40) feed.pop();
    renderFeed();
  });
}
export function renderFeed() {
  el.feedPane.innerHTML = "";
  feed.slice(0, 14).forEach((f) => {
    const p = G.players[f.who] as Player;
    const row = h("div", "feed-row");
    row.style.borderLeftColor = p ? p.color : "#888";
    row.textContent = f.text;
    el.feedPane.appendChild(row);
  });
}

// ── quarry status / upgrade bar ──
export function renderQuarry(now: number) {
  const b = G.board;
  let s = "";
  if (b.fogUntil > now) s += `<span class="stat fog">🌫️ ${Math.ceil((b.fogUntil - now) / 1000)}s</span>`;
  if (b.blockUntil > now) s += `<span class="stat blk">⛓️ ${Math.ceil((b.blockUntil - now) / 1000)}s</span>`;
  el.quarryStatus.innerHTML = s;
  el.fog.classList.toggle("show", b.fogUntil > now);
}
// combo bank indicator — filled pips show progress toward the next gold coin
export function setComboBank(count: number, need: number) {
  if (!el.comboBank) return;
  let pips = "";
  for (let i = 0; i < need; i++) pips += `<i class="${i < count ? "on" : ""}"></i>`;
  el.comboBank.innerHTML = `<span class="cb-lbl">Combo</span>${pips}`;
}

export function setUpgradeBar(pct: number) {
  el.upbarFill.style.width = Math.min(100, pct * 100) + "%";
}

// ── gem grid ──
function bindGrid() {
  const grid = el.grid as HTMLElement;
  const cellFrom = (e: PointerEvent): { r: number; c: number } | null => {
    const rect = grid.getBoundingClientRect();
    const cw = rect.width / BOARD_W, ch = rect.height / BOARD_H;
    const c = Math.floor((e.clientX - rect.left) / cw);
    const r = Math.floor((e.clientY - rect.top) / ch);
    if (r < 0 || r >= BOARD_H || c < 0 || c >= BOARD_W) return null;
    return { r, c };
  };
  const adj = (a: any, b: any) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
  const swap = (a: any, b: any) => G.board.trySwap(a.r, a.c, b.r, b.c, performance.now());

  grid.addEventListener("pointerdown", (e) => {
    const cell = cellFrom(e); if (!cell) return;
    down = cell;
    if (selected && adj(selected, cell)) { swap(selected, cell); selected = null; }
    else selected = cell;
    renderSelection();
  });
  grid.addEventListener("pointermove", (e) => {
    if (!down) return;
    const cell = cellFrom(e);
    if (cell && adj(down, cell)) { swap(down, cell); down = null; selected = null; renderSelection(); }
  });
  window.addEventListener("pointerup", () => { down = null; });
}

function renderSelection() {
  gemEls.forEach((elem) => elem.classList.remove("selected"));
  if (selected) {
    const g = G.board.grid[selected.r][selected.c];
    if (g) gemEls.get(g.id)?.classList.add("selected");
  }
}

function styleGem(elem: HTMLElement, g: any) {
  const face = elem.querySelector(".face") as HTMLElement;
  const icon = elem.querySelector(".icon") as HTMLElement;
  const badge = elem.querySelector(".badge") as HTMLElement;
  elem.className = "gem";
  face.removeAttribute("style");
  face.className = "face";

  if (g.block) {
    elem.classList.add("block");
    icon.className = "icon";
    icon.textContent = "";
    badge.className = "badge";
    return;
  }
  if (g.special === "bomb") {
    elem.classList.add("bomb");
    icon.textContent = "💣";
    icon.className = "icon bombic";
    badge.className = "badge";
    return;
  }

  elem.classList.add("res-" + g.res);
  // sprite-sheet face: one horizontal strip, GEM_FRAMES frames wide
  const frame = GEM_FRAME[g.res as ResKey] ?? 0;
  face.classList.add("sprite");
  face.style.backgroundImage = `url(${GEM_SHEET})`;
  face.style.backgroundSize = `${GEM_FRAMES * 100}% 100%`;
  face.style.backgroundPosition = `${(frame * 100) / (GEM_FRAMES - 1)}% 50%`;
  icon.className = "icon";
  icon.textContent = "";          // artwork lives in the sprite now
  badge.className = "badge";
  if (g.tier > 0) {
    badge.textContent = String(g.tier);
    badge.classList.add("show", `t${g.tier}`);
    elem.classList.add("token");            // tokens glow so they stand out
  }
  if (g.hard === 2) elem.classList.add("hard2");
  else if (g.hard === 1) elem.classList.add("hard1");
}

export function renderBoard() {
  const present = new Set<number>();
  const gems = G.board.gems();
  for (const g of gems) {
    present.add(g.id);
    let elem = gemEls.get(g.id);
    const x = g.c * CELL + 3, y = g.r * CELL + 3;
    if (!elem) {
      elem = h("div", "gem");
      elem.innerHTML = `<div class="face"></div><span class="icon"></span><span class="badge"></span>`;
      (elem as any).dataset.id = g.id;
      el.grid.appendChild(elem);
      gemEls.set(g.id, elem);
      if (g.isNew) {
        elem.style.transition = "none";
        elem.style.transform = `translate(${x}px, ${y - CELL * 3}px)`;
        elem.style.opacity = "0";
        requestAnimationFrame(() => requestAnimationFrame(() => {
          elem!.style.transition = "";
          elem!.style.transform = `translate(${x}px, ${y}px)`;
          elem!.style.opacity = "1";
        }));
      } else {
        elem.style.transform = `translate(${x}px, ${y}px)`;
      }
    } else {
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
  renderSelection();
}

// ── FX ──
export function fx(type: string, r: number, c: number, text?: string) {
  const layer = el.grid as HTMLElement;
  const e = h("div", "fx fx-" + type);
  e.style.left = c * CELL + CELL / 2 + "px";
  e.style.top = r * CELL + CELL / 2 + "px";
  if (text) e.textContent = text;
  layer.appendChild(e);
  setTimeout(() => e.remove(), type === "chain" ? 1000 : 600);
}

export function popup(gains: Partial<Record<ResKey, number>>, label: string) {
  const e = h("div", "harvest-pop");
  const parts = (Object.keys(gains) as ResKey[]).map((k) => `<span>${gains[k]}${gemIcon(k, 18)}</span>`).join("");
  e.innerHTML = (label ? `<b class="hp-label">${label}</b>` : "") + `<div class="hp-body">${parts}</div>`;
  el.boardWrap.appendChild(e);
  setTimeout(() => e.remove(), 1600);
}

// ── toasts ──
export function toast(text: string, kind = "info") {
  const t = h("div", "toast " + kind, text);
  el.toasts.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, 2400);
}

// ── mode bar ──
export function showModeBar(mode: string | null) {
  if (!mode) { el.modebar.classList.add("hidden"); return; }
  el.modebar.classList.remove("hidden");
  let txt = "", cost = "";
  if (mode === "bandit") { txt = "Click a district to set the Blockade"; cost = SABOTAGE.bandit.gold + "🪙"; }
  else if (mode === "capital") { txt = "Click a glowing node to found your Capital"; cost = "FREE"; }
  else if (mode === "toll") { txt = "Click a rival's rail (touching yours) to buy passage"; cost = "½ your goods 💰"; }
  else if (G.setupPhase && mode === "road") { txt = "Click a glowing border to lay your rail"; cost = "FREE"; }
  else { txt = `Click the map to place a ${COSTS[mode].label}`; cost = costStr(COSTS[mode].cost); }
  el.modebar.innerHTML = `<span class="mb-txt">${txt}</span><span class="mb-cost">${cost}</span>`;
  if (mode !== "capital" && !G.setupPhase) {
    const cancel = h("button", "mb-cancel", "Cancel ✕");
    cancel.onclick = () => bus.emit("build:mode", null);
    el.modebar.appendChild(cancel);
  }
}

export function showBanner(text: string | null) {
  if (!text) { el.banner.classList.add("hidden"); return; }
  el.banner.classList.remove("hidden");
  el.banner.innerHTML = `<button class="banner-close" title="Hide">✕</button>` + text;
  (el.banner.querySelector(".banner-close") as HTMLElement).onclick = () =>
    el.banner.classList.add("hidden");
}

// ── modals ──
export function helpModal() {
  el.modalRoot.classList.remove("hidden");
  el.modalRoot.innerHTML = `
  <div class="modal-back"></div>
  <div class="modal box">
    <h2>⚙️ HEXMATCH INDUSTRIES</h2>
    <p class="sub">Two worlds, one empire. First to <b>${VP.target}★ Victory Points</b> wins.</p>
    <div class="help-cols">
      <div class="help-col">
        <h3>🏙️ The Territory</h3>
        <p>Found your <b>Headquarters</b> 🏰 — every rail traces back to it. Build <b>Factories</b> (+1★) & <b>Foundries</b> (+2★) at <b>crossroads</b> where districts meet. Boxed in? Buy a <b>Toll Pass</b> 💰 to run your line through a rival's rails (½ your goods). Terrain by your buildings unlocks <b>gem colours</b>.</p>
      </div>
      <div class="help-col">
        <h3>💎 The Quarry</h3>
        <p>Plain gems are worthless. Every 20s your accessible colours turn into numbered <b>resource tokens</b> — match them to harvest. Match 4 doubles, match 5 makes a <b>bomb</b>. <b>Gold coins</b> 🪙 are <b>wild</b> — they combo with any 2 gems and pay Gold.</p>
      </div>
      <div class="help-col">
        <h3>🪙 Gold, Trade & Defence</h3>
        <p>Collect wild <b>Gold coins</b> to fund the <b>Black Market</b>: sabotage rivals or hire <b>Security Forces</b> for protection. Trade in the live market, or bank <b>4:1</b>. Beware the <b>Taxman</b> — he bleeds the richest tycoon!</p>
      </div>
    </div>
    <button class="big-btn" id="startBtn">Start Production ⚙️</button>
  </div>`;
  (el.modalRoot.querySelector("#startBtn") as HTMLElement).onclick = () => {
    el.modalRoot.classList.add("hidden");
  };
}

export function winModal(p: Player) {
  el.modalRoot.classList.remove("hidden");
  el.modalRoot.innerHTML = `
  <div class="modal-back"></div>
  <div class="modal box small">
    <h2>${p.human ? "🏆 Victory!" : "📉 Bankrupt"}</h2>
    <p class="sub" style="color:${p.color}"><b>${p.name}</b> reached ${p.vp}★ and dominates the market.</p>
    <button class="big-btn" id="againBtn">Play Again</button>
  </div>`;
  (el.modalRoot.querySelector("#againBtn") as HTMLElement).onclick = () => location.reload();
}

export function confirmModal(title: string, body: string, onYes: () => void) {
  el.modalRoot.classList.remove("hidden");
  el.modalRoot.innerHTML = `
  <div class="modal-back"></div>
  <div class="modal box small">
    <h2>${title}</h2>
    <p class="sub">${body}</p>
    <div class="confirm-row">
      <button class="big-btn ghost" id="noBtn">Cancel</button>
      <button class="big-btn danger" id="yesBtn">Collapse</button>
    </div>
  </div>`;
  const close = () => el.modalRoot.classList.add("hidden");
  (el.modalRoot.querySelector("#noBtn") as HTMLElement).onclick = close;
  (el.modalRoot.querySelector("#yesBtn") as HTMLElement).onclick = () => { close(); onYes(); };
  (el.modalRoot.querySelector(".modal-back") as HTMLElement).onclick = close;
}

// Taxman: human picks which goods to surrender (must discard `amount` total)
export function taxModal(p: Player, amount: number, onDone: () => void) {
  const remove: Record<ResKey, number> = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0, gold: 0 };
  const left = () => amount - RES_KEYS.reduce((s, k) => s + remove[k], 0);
  el.modalRoot.classList.remove("hidden");
  const render = () => {
    const rows = RES_KEYS.map((k) => `
      <div class="tax-row">
        <span class="tax-ic">${gemIcon(k, 20)}</span>
        <span class="tax-nm">${RES[k].name}</span>
        <button class="tax-btn" data-k="${k}" data-d="-1">−</button>
        <span class="tax-ct"><b>${remove[k]}</b> / ${p.res[k]}</span>
        <button class="tax-btn" data-k="${k}" data-d="1">+</button>
      </div>`).join("");
    el.modalRoot.innerHTML = `
    <div class="modal-back"></div>
    <div class="modal box small">
      <h2>💼 The Taxman</h2>
      <p class="sub">You lead the market — time to pay up. Surrender <b>${amount}</b> goods of your choosing.</p>
      <div class="tax-list">${rows}</div>
      <p class="tax-left">Still to surrender: <b>${left()}</b></p>
      <button class="big-btn danger" id="payBtn" ${left() === 0 ? "" : "disabled"}>Pay the Taxman</button>
    </div>`;
    el.modalRoot.querySelectorAll(".tax-btn").forEach((b: Element) => {
      (b as HTMLElement).onclick = () => {
        const k = (b as HTMLElement).dataset.k as ResKey;
        const d = +((b as HTMLElement).dataset.d as string);
        const next = remove[k] + d;
        if (next < 0 || next > p.res[k]) return;
        if (d > 0 && left() <= 0) return;
        remove[k] = next; render();
      };
    });
    const pay = el.modalRoot.querySelector("#payBtn") as HTMLElement;
    if (pay) pay.onclick = () => {
      for (const k of RES_KEYS) p.res[k] -= remove[k];
      el.modalRoot.classList.add("hidden");
      onDone();
    };
  };
  render();
}

// tile info toast (no-mode click)
export function tileInfo(tileId: number) {
  const t = G.map.tiles[tileId];
  const res = TILES[t.type as keyof typeof TILES].res;
  const rr = res ? playerResources(G.map, G.players[0], performance.now()) : {};
  const owned = res && (rr as any)[res];
  toast(`${TILES[t.type as keyof typeof TILES].name}${res ? " · " + RES[res].name : " · barren"}${owned ? " (harvesting)" : ""}`, "info");
}

export const getCanvas = () => el.canvas as HTMLCanvasElement;