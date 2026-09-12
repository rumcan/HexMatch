// ══════════════════════════════════════════════════════════════════════════
// U1 — the restored HexMatch interface, driven by the iso game.
//
// This file is the recovered `src/game/ui.ts` (861 lines from the pre-iso UI)
// re-wired to the iso state. The layout, class names and panel structure are
// the ORIGINAL HUD:
//
//   Left column   BUILD   Rail / Factory / Foundry controls (mapped onto the
//                         iso Dirt Road / Road / Depot / Demolish tools)
//   Left column   BLACK MARKET  Blockade, Frost, Girders, Smog, Security,
//                         Repair, Protest — wired to the quarry board +
//                         industry blockades the iso economy already honours.
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
  BOARD_W, BOARD_H, CELL, RES, OFFER_LIFE,
  SABOTAGE, SECURITY, REPAIR_COST, type ResKey,
} from "./config";
import { BANK_RATE, MAX_OFFERS } from "./trade";
// VP-01: the victory numbers come from the iso config, NOT from the legacy
// `VP = { target: 10 }` in game/config.ts that this file used to read. That
// constant and the engine's own `VP_TARGET` were two numbers with one name,
// and the HUD was already showing "/10" while the game was winning at 12 — the
// scoreboard now has exactly one source, `VICTORY` in src/iso/config.ts.
import { CARGO, CARGOES, TRANSPORT, VICTORY, UPGRADE_COST, type Cargo, type Portrait } from "../iso/config";
import { DEPOT_COST, costCompact, depotButtonLabel } from "../iso/construction";
import { PLANT_COST } from "../iso/plants";
import { GEM_TO_CARGO } from "../iso/quarry";
// VP-01: quarters on the scoreboard — 4.75★, not 4.7499999999999996★.
import { fmtVp } from "../iso/victory";
// AI-01: the rival difficulty presets the top-bar selector switches between.
import { RIVAL_SKILLS, SKILL_KEYS, type SkillKey } from "../iso/skill";
// PP-14: the praying angel that a cross match summons, and the choir that
// sings with it. Both are one-shot fx answers to `onFx("cross", …)`.
import angelUrl from "../assets/ui/angel.png";
import { playHoly, prewarmHoly } from "./holy";
// SFX-01: the UI sound layer. `attachUiSound` gives every control in this
// chrome a hover tick and a press sound from ONE delegation; the calls below
// are only the moments that are not a button — a tab sliding, a toast saying
// no, a gem clearing, the wire opening.
import { attachUiSound, registerSoundPainter, soundGlyph, soundLabel, sfx } from "../audio/sfx";
import type { Cue } from "../audio/cues";
// PP-14b: the tycoon portraits live with the NOIR mugshots further down — one
// set of faces, so the start-screen pick and the dossiers read the same files.

// PP-14: the cross bounty chooser offers the five CARGOES, and each button
// must hand the board back its COLOUR key — the reverse of GEM_TO_CARGO.
const CARGO_TO_GEM: Partial<Record<Cargo, ResKey>> = Object.fromEntries(
  Object.entries(GEM_TO_CARGO).map(([gem, cargo]) => [cargo, gem]),
) as Partial<Record<Cargo, ResKey>>;
import { Board, type FxType, type Gem } from "./board";
import type { IsoMarket, IsoMarketPlayer, Offer } from "../iso/market";
import portraitYou from "../assets/ui/tycoon_you_small.png";
import portraitKrag from "../assets/ui/tycoon_krag.png";
import portraitTorvin from "../assets/ui/tycoon_torvin_small.png";
import portraitVex from "../assets/ui/tycoon_vex_small.png";

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

// ── NOIR: the painted mugshots ──────────────────────────────────────────────
// `tycoon_*.png` are the family portraits (src/assets/ui/, kept when U1 pruned
// the `<img>` that used to read them). The roster is a wall of dossiers, so the
// face goes back on the card: seat order is the tie-break for a name we do not
// recognise, which keeps "You" the player and every rival its own portrait
// however the scoreboard sorts them.

const PORTRAIT_BY_SEAT = [portraitYou, portraitKrag, portraitTorvin, portraitVex];
const PORTRAIT_BY_NAME: Record<string, string> = {
  you: portraitYou, krag: portraitKrag, torvin: portraitTorvin, vex: portraitVex,
  // PP-14b: the solo rival is simply named "Rival", which is no surname in the
  // family — name Torvin here rather than let the seat tie-break hand him
  // Krag's face. Torvin plays the rival; the player's own is chosen below.
  rival: portraitTorvin,
};

/** The dossier face for one player: their named portrait, else their seat's. */
const portraitFor = (p: UiPlayer, index: number): string =>
  PORTRAIT_BY_NAME[p.name.trim().toLowerCase()] ?? PORTRAIT_BY_SEAT[index % PORTRAIT_BY_SEAT.length];

// ── tool + state shapes ─────────────────────────────────────────────────────
/** PP-06: `plant` raises an additional processing plant beside another town. */
export type UiTool = "dirt" | "road" | "harvester" | "plant" | "demolish";

export interface UiPlayer {
  id: string;
  name: string;
  colour: string;
  vp: number;
  human: boolean;
  /** AI-03: what the ★ total is made of — shown as the native hover tooltip
   *  over this player's name row in the header ("what did I and the rival
   *  receive win points for"). */
  vpTip?: string;
}

export interface UiState {
  players: UiPlayer[];
  purse: Partial<Record<Cargo, number>>;
  phase: string;
  tool: UiTool;
  freeTrack: number;
  /** PP-05: Depots left on the free-setup allowance — the Build button reads
   *  "free setup" while it lasts and the full Oil cost afterwards. */
  freeDepots: number;
  banner: string | null;
  costInfo: string | null;
  inspect: string | null;
  /** PP-03: tones the inspector when it is a placement verdict (e.g. the red
   *  "can't go here — …" reason for an invalid Factory/Depot hover). */
  inspectTone?: "good" | "bad" | null;
  reach: Partial<Record<Cargo, number>>;
  /** PP-14b: ms left on the Processing Plant reset cooldown (0 = ready). */
  resetIn: number;
  /** PP-14b: which tycoon portrait the player picked. */
  portrait: Portrait;
}

export interface UiHooks {
  onTool: (tool: UiTool) => void;
  onRecenter: () => void;
  onSwap: (r1: number, c1: number, r2: number, c2: number) => void;
  onReset: () => void;
  onBlackAction: (key: string) => void;
  /** AI-01: the player picked a rival difficulty (applies from the next turn). */
  onSkill?: (key: SkillKey) => void;
  /** AI-01: the boot difficulty, so the selector opens on the right value. */
  skill?: SkillKey;
}

export interface UiRivalryBeat {
  speaker: "rival" | "you";
  text: string;
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
  /** A brief, non-modal exchange beside the HUD. The portrait switches with
   *  each speaker; game.ts also records every beat in the Feed for later. */
  rivalQuip: (beats: readonly UiRivalryBeat[]) => void;
  toast: (text: string, kind?: "good" | "bad" | "info" | "danger" | "success") => void;
  fx: (type: FxType, r: number, c: number, text?: string) => void;
  popup: (gains: Partial<Record<ResKey, number>>, label: string) => void;
  /**
   * PP-14b: the board paused on a cross and is waiting for the player's picks.
   * `kind` names the shape (holy 3×4 → 6 picks, broken 3×3 → 3 picks); show
   * the five-cargo chooser and answer `pick(chosen)` when the units are
   * confirmed (or after the auto-pick timer, so the cascade never hangs).
   */
  crossPick: (kind: "holy" | "broken", picks: number, pick: (chosen: ResKey[]) => void) => void;
  isQuarryOpen: () => boolean;
  isTradeOpen: () => boolean;
  showModal: (html: string) => void;
  hideModal: () => void;
}

// ── gem face helper ─────────────────────────────────────────────────────────
// V5: gems draw the restored sprite art (src/assets/gems/<cargo>.png). The
// radial gradient is only the fallback for a missing file, so a pruned assets
// folder degrades to a coloured gem instead of a broken image.
const gemFace = (res: ResKey) =>
  `radial-gradient(circle at 34% 28%, ${RES[res].c2}, ${RES[res].c1})`;
const gemArtUrl = (res: ResKey): string | null => GEM_ART[GEM_TO_CARGO[res]] ?? null;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
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

/**
 * PP-08: Security Forces are DEFENSIVE, not sabotage, so they were repriced
 * from Gold to materials (`SECURITY.cost`, legacy ResKey table — same shape
 * as REPAIR_COST). `wheat`→grain, `brick`→stone, the same mapping Repair Crew
 * uses. Gold is reserved for Black Market sabotage and pays for nothing else.
 */
const SECURITY_ISO: Partial<Record<Cargo, number>> = {
  grain: SECURITY.cost?.wheat ?? 0,
  stone: SECURITY.cost?.brick ?? 0,
};

/** PP-08: the standing rule, shown wherever Gold is displayed or traded. */
const GOLD_RULE = "Gold is reserved for Black Market sabotage.";

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
  top.appendChild(h("div", "logo", `<span class="logo-mark" aria-hidden="true"></span> HEXMATCH <em>INDUSTRIES</em>`));
  const kingdoms = h("div", "kingdoms");
  top.appendChild(kingdoms);
  const right = h("div", "top-right");
  // AI-01: how hard the rival plays. A live switch — the next rival turn
  // simply reads the new preset — remembered in localStorage for the next boot.
  if (hooks.onSkill) {
    const skillWrap = h("label", "rival-skill");
    const sel = h("select", "rival-skill-sel") as HTMLSelectElement;
    sel.title = "How hard the rival plays (applies immediately)";
    for (const key of SKILL_KEYS) {
      const o = document.createElement("option");
      o.value = key;
      o.text = `Rival: ${RIVAL_SKILLS[key].label}`;
      o.title = RIVAL_SKILLS[key].blurb;
      sel.appendChild(o);
    }
    sel.value = hooks.skill ?? "normal";
    sel.id = "iso-rival-skill";
    sel.onchange = () => hooks.onSkill!(sel.value as SkillKey);
    skillWrap.appendChild(h("span", "rival-skill-ic", "🤖"));
    skillWrap.appendChild(sel);
    right.appendChild(skillWrap);
  }
  const vp = h("div", "vp-badge", "★ 0");
  vp.id = "iso-vp";
  right.appendChild(vp);
  // SFX-01: the sound switch. It sits with the other top-bar icon buttons and
  // it is the ONE control that opts out of the delegation (`data-sfx="off"`):
  // muting must be silent, and unmuting answers with its own confirming ping
  // so the player hears the state change instead of guessing at it. The choice
  // persists (engine), so the next boot remembers it, and `M` does the same
  // thing from the keyboard.
  const soundBtn = h("button", "icon-btn sound-btn");
  soundBtn.id = "iso-sound";
  soundBtn.type = "button";
  soundBtn.dataset.sfx = "off";
  soundBtn.dataset.act = "sound";
  const paintSound = (on: boolean) => {
    soundBtn.textContent = soundGlyph(on);
    soundBtn.title = soundLabel(on);
    soundBtn.setAttribute("aria-label", on ? "Mute sound" : "Unmute sound");
    soundBtn.setAttribute("aria-pressed", String(!on));
    soundBtn.classList.toggle("sound-off", !on);
  };
  // The toggle repaints itself through the registry (below) and confirms the
  // unmute with its own ping — whichever way the state changed: this click, the
  // `M` shortcut, or `__sfx.mute()` in the console.
  soundBtn.onclick = () => { sfx.toggle(); };
  registerSoundPainter((on) => paintSound(on));
  right.appendChild(soundBtn);
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

  // ── left: BUILD ────────────────────────────────────────────
  const left = h("aside", "aside left iso-panel");
  const bp = h("div", "panel");
  bp.appendChild(h("div", "panel-title", "Build"));
  const buildList = h("div", "build-list");
  bp.appendChild(buildList);
  left.appendChild(bp);

  const sp = h("div", "panel grow");
  sp.appendChild(h("div", "panel-title", "Black Market"));
  // PP-08: the standing currency rule, stated right where Gold is spent.
  sp.appendChild(h("div", "pane-note gold-rule", `🪙 ${GOLD_RULE} Construction and trade never touch it.`));
  const sabList = h("div", "sab-list");
  sp.appendChild(sabList);

  root.appendChild(left);

  // ── rival offer tray (floats left of the Quarry) ─────────────────────────
  const offerTray = h("div", "offer-tray hidden");
  root.appendChild(offerTray);

  // ── right: shared economy window ────────────────────────────
  const rightAside = h("aside", "aside right iso-panel");
  const qp = h("div", "panel");
  qp.id = "iso-quarry";
  const qh = h("div", "quarry-head");
  qh.appendChild(h("div", "panel-title", "Your Processing Plant"));
  const quarryStatus = h("div", "quarry-status");
  qh.appendChild(quarryStatus);
  const comboBank = h("div", "combo-bank");
  qh.appendChild(comboBank);
  const resetBtn = h("button", "reset-btn", "♻ Reset");
  resetBtn.title = "Collapse the Processing Plant: lose ALL resources, get a fresh neutral board";
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
  // SFX-01: gems sound from `selectOrSwap` (above), never from the hover/press
  // delegation — see the comment there.
  grid.dataset.sfx = "off";
  grid.style.width = CELL * BOARD_W + "px";
  grid.style.height = CELL * BOARD_H + "px";
  grid.style.setProperty("--gem", (CELL - 6) + "px");
  boardWrap.appendChild(grid);
  qp.appendChild(boardWrap);


  // Shared tabs; keep the existing board mounted while switching panes.
  const tp = h("div", "panel grow");
  tp.id = "iso-trade";
  const tabs = h("div", "tabs");
  const tabMarket = h("button", "tab active", "Market");
  const tabBank = h("button", "tab", "Bank");
  const tabFeed = h("button", "tab", "Feed");
  tabMarket.onclick = () => setTab("market");
  tabBank.onclick = () => setTab("bank");
  tabFeed.onclick = () => setTab("feed");
  const tabPlant = h("button", "tab", "Processing Plant");
  tabPlant.onclick = () => setTab("plant");
  tabs.append(tabBank, tabMarket, tabPlant, tabFeed);
  tp.appendChild(tabs);
  [tabBank, tabMarket, tabPlant, tabFeed].forEach((tab, i) => {
    tab.dataset.tab = ["bank", "market", "plant", "feed"][i];
  });
  const marketPane = h("div", "pane market-pane");
  const bankPane = h("div", "pane bank-pane hidden");
  const feedPane = h("div", "pane feed-pane hidden");
  tp.appendChild(marketPane); tp.appendChild(bankPane); tp.appendChild(feedPane);
  tp.appendChild(qp);
  rightAside.appendChild(tp);
  root.appendChild(rightAside);

  // ── overlays ──────────────────────────────────────────────────────────────
  const toasts = h("div", "toasts");
  root.appendChild(toasts);
  // A two-way wire: short-lived, pointer-transparent and aria-live="polite".
  // Each beat swaps between Torvin and the player's selected portrait without
  // becoming another modal or interrupting a map gesture.
  const rivalWire = h("aside", "rival-quip hidden");
  rivalWire.id = "iso-rival-quip";
  rivalWire.setAttribute("role", "status");
  rivalWire.setAttribute("aria-live", "polite");
  rivalWire.setAttribute("aria-atomic", "true");
  const rivalWireFace = h("span", "rival-quip-face");
  rivalWireFace.setAttribute("aria-hidden", "true");
  rivalWireFace.style.backgroundImage = `url(${portraitTorvin})`;
  const rivalWireCopy = h("span", "rival-quip-copy");
  const rivalWireLabel = h("b", "rival-quip-label", "Rival · Private wire");
  rivalWireCopy.appendChild(rivalWireLabel);
  const rivalWireText = h("q", "rival-quip-text");
  rivalWireCopy.appendChild(rivalWireText);
  rivalWire.append(rivalWireFace, rivalWireCopy);
  // Share the existing notification lane so a simultaneous rules toast and
  // rival answer stack instead of painting over one another.
  toasts.appendChild(rivalWire);
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
    ["map", "🗺", "Map"], ["build", "🏗", "Build"], ["trade", "⇄", "Economy"],
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
  // PP-07: every price line is READ from the one authoritative cost table
  // (BUILD_COSTS, via the TRANSPORT / DEPOT_COST / PLANT_COST aliases), never
  // typed here — the buttons state the complete cost before the first click
  // and can never drift from what the placement actually charges.
  // VP-01: the two road buttons tell the truth about points — gravel scores
  // nothing, and the only road action that does is paving over gravel you
  // already laid (which is also the cheaper of the two paved options).
  const TOOLS: { key: UiTool; label: string; sub: string }[] = [
    { key: "dirt", label: "Dirt Road", sub: `${costCompact(TRANSPORT.dirt.cost)} · 0★` },
    { key: "road", label: "Road", sub: `${costCompact(TRANSPORT.road.cost)} · +${VICTORY.upgrade}★ paving dirt` },
    // PP-05: `depotSub` refreshes the Depot line below as the free-setup
    // allowance burns down.
    { key: "harvester", label: "Depot", sub: depotButtonLabel(0) },
    // PP-06: another instance of the SAME processing building, raised beside
    // another town.
    { key: "plant", label: "Processing Plant", sub: `${costCompact(PLANT_COST)} · next to a town` },
    { key: "demolish", label: "Demolish", sub: "Refund 50%" },
  ];
  let depotSub: HTMLElement | null = null;
  let lastDepotSub = "\u0000";
  for (const t of TOOLS) {
    // V5: each tool gets its own banner artwork class (bg-dirt / bg-road /
    // bg-harvester / bg-demolish) — they all shared bg-rail before.
    const b = h("button", "build-btn bg-" + t.key);
    b.dataset.tool = t.key;
    b.innerHTML = `<div class="bb-mid"><b>${t.label}</b><small>${t.sub}</small></div>`;
    b.onclick = () => hooks.onTool(t.key);
    if (t.key === "harvester") depotSub = b.querySelector("small");
    buildList.appendChild(b);
  }
  // ── Black Market ──────────────────────────────────────────────────────────
  function renderSabotage() {
    sabList.innerHTML = "";
    for (const key of Object.keys(SABOTAGE)) {
      const s = SABOTAGE[key];
      const afford = (me.res.gold ?? 0) >= s.gold;
      const b = h("button", "sab-btn sb-" + key + (afford ? "" : " disabled"));
      b.innerHTML = `<div class="sab-top"><b>${s.name}</b><span class="sab-cost">${s.gold}🪙</span></div>` +
        `<div class="sab-desc">${s.desc}</div>`;
      b.disabled = !afford;
      b.dataset.black = key;
      b.onclick = () => hooks.onBlackAction(key);
      sabList.appendChild(b);
    }
    const secOn = false;
    // PP-08: Security Forces are bought with MATERIALS now, so their
    // affordability reads the purse, not the Gold balance.
    const secAfford = (Object.entries(SECURITY_ISO) as [Cargo, number][])
      .every(([k, v]) => (me.res[k] ?? 0) >= v);
    const sb = h("button", "sab-btn secure-btn" + (secOn ? " active" : secAfford ? "" : " disabled"));
    sb.innerHTML = `<div class="sab-top"><b>🛡️ ${SECURITY.name}</b><span class="sab-cost">${costStr(SECURITY_ISO)}</span></div>` +
      `<div class="sab-desc">${SECURITY.desc}</div>`;
    sb.disabled = !secAfford;
    sb.dataset.black = "security";
    sb.onclick = () => hooks.onBlackAction("security");
    sabList.appendChild(sb);

    const afford = (Object.entries(REPAIR_ISO) as [Cargo, number][])
      .every(([k, v]) => (me.res[k] ?? 0) >= v);
    const rb = h("button", "sab-btn repair-btn" + (afford ? "" : " disabled"));
    rb.innerHTML = `<div class="sab-top"><b>🔧 Repair Crew</b><span class="sab-cost">${costStr(REPAIR_ISO)}</span></div>` +
      `<div class="sab-desc">Clear all Iron Girders & thaw all Frost tiles instantly.</div>`;
    rb.disabled = !afford;
    rb.dataset.black = "repair";
    rb.onclick = () => hooks.onBlackAction("repair");
    sabList.appendChild(rb);
  }

  // ── market composer ───────────────────────────────────────────────────────
  // PP-08: Gold is not a trading good, so it never appears in either select —
  // it cannot be given, wanted, or banked. The handlers below still guard the
  // rule in case a stale option value survives in the DOM.
  const TRADEABLE = CARGOES.filter((k) => k !== "gold");
  const mkSel = (value: Cargo) => {
    const s = h("select", "res-sel") as HTMLSelectElement;
    for (const k of TRADEABLE) {
      const o = document.createElement("option");
      o.value = k;
      o.text = CARGO[k].name;
      s.appendChild(o);
    }
    s.value = value === "gold" ? "stone" : value;
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

  let postBtn: HTMLButtonElement;
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
    `The bank always trades four of one good for one of another. No rival required, no waiting. 🪙 ${GOLD_RULE}`));

  bankPane.appendChild(sp);

  function updateTradeButtons() {
    postBtn.disabled = market.live(me).length >= MAX_OFFERS || postGive.value === postWant.value
      || (me.res[postGive.value as Cargo] ?? 0) < Math.max(1, Math.floor(Number(postGiveN.value) || 2));
    bankBtn.disabled = bankGive.value === bankWant.value || (me.res[bankGive.value as Cargo] ?? 0) < BANK_RATE;
  }
  for (const input of [postGive, postWant, postGiveN, postWantN, bankGive, bankWant]) {
    input.addEventListener("input", updateTradeButtons);
    input.addEventListener("change", updateTradeButtons);
  }

  function postOffer() {
    const give = postGive.value as Cargo;
    const want = postWant.value as Cargo;
    if (give === want) { toast("Pick two different goods to trade.", "danger"); return; }
    // PP-08: defence in depth — the market refuses gold anyway, and the select
    // never offers it, but say WHY if a stale value ever gets here.
    if (give === "gold" || want === "gold") { toast(`🪙 ${GOLD_RULE}`, "danger"); return; }
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
    // PP-08: the bank never turns Gold into construction stock (or back).
    if (give === "gold" || want === "gold") { toast(`🪙 ${GOLD_RULE}`, "danger"); return; }
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
    updateTradeButtons();
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
    b.disabled = !can;
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
  let currentTab: "market" | "bank" | "plant" | "feed" | null = null;
  function setTab(t: "market" | "bank" | "plant" | "feed") {
    // PP-14b: a pending cross bounty lives inside the plant panel — switching
    // away would hide it mid-pick and the cascade would sit unseen until the
    // timer answers for the player. Stay put instead.
    if (pickEl && t !== "plant") {
      toast("Answer the cross bounty first.", "info");
      return;
    }
    // SFX-01: a drawer sliding one bay — but only when the drawer really moves.
    // The boot calls setTab("plant") and paint() never re-calls it, so an
    // unchanged tab is a no-op here and stays silent.
    if (currentTab !== t) {
      if (currentTab !== null) sfx.play("tab");
      currentTab = t;
    }
    tabs.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((tab) => {
      tab.setAttribute("aria-pressed", String(tab.dataset.tab === t));
    });
    tabPlant.classList.toggle("active", t === "plant");
    qp.classList.toggle("hidden", t !== "plant");
    tabMarket.classList.toggle("active", t === "market");
    tabBank.classList.toggle("active", t === "bank");
    tabFeed.classList.toggle("active", t === "feed");
    marketPane.classList.toggle("hidden", t !== "market");
    bankPane.classList.toggle("hidden", t !== "bank");
    feedPane.classList.toggle("hidden", t !== "feed");
  }

  function setMobileView(v: string) {
    if (root.dataset.view !== v) sfx.play("tab");
    root.dataset.view = v;
    mobileNav.querySelectorAll(".mnav-btn").forEach((b: Element) => {
      (b as HTMLElement).classList.toggle("active", (b as HTMLElement).dataset.view === v);
    });
    if (v === "trade") responsiveZoom();
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
      // SFX-01: cards sliding on felt. The board's own `bad` fx answers a swap
      // that did not match, so this one is deliberately neutral — the player
      // hears the gesture, then the verdict.
      sfx.play("swap");
      hooks.onSwap(selected.r, selected.c, cell.r, cell.c);
      selected = null;
    } else {
      // …and a small glass ping when a gem is picked up. The grid opts out of
      // the document delegation (`data-sfx="off"` below) so the board's two
      // moments are the only two sounds it makes: sweeping the mouse across
      // nine gems must not rattle.
      sfx.play("select");
      selected = cell;
    }
    renderSelection();
  };
  // PP-14: unlock the audio context on the first touch of the board, so the
  // choir can sing the instant a cross resolves (autoplay policies only let
  // an AudioContext start inside user interaction — and a cross lands a beat
  // after the click that made it).
  grid.addEventListener("pointerdown", () => prewarmHoly(), { once: true });

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
    // V5: sprite art per cargo; the gradient only backs a missing file. The
    // sheet's own aspect is square and so is the cell, so the stylesheet sizes
    // the face with `cover` — one bitmap, never stretched per axis, at any zoom.
    const url = gemArtUrl(g.res);
    if (url) {
      face.classList.add("sprite");
      face.style.backgroundImage = `url("${url}")`;
    } else {
      face.style.background = gemFace(g.res);
    }
    if (g.res === "gold") {
      // N3: gold is its own colour now (not a wild) — keep the coin face,
      // drop the misleading "wild" class.
      elem.classList.add("gold");
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
  // ── A1: the board-wide callout slot ─────────────────────────────────────
  // ONE float at a time: a new callout REPLACES the one before it instead of
  // stacking. A cascade therefore reads as a single banner that grows and
  // re-words itself — MATCH! → COMBO x2 → CHAIN x3!! — which is the arcade
  // behaviour the old stacked floats could never produce.
  let floatEl: HTMLElement | null = null;
  let floatTimer = 0;

  function showFloat(text: string, big: boolean) {
    floatEl?.remove();
    window.clearTimeout(floatTimer);
    const f = h("div", `combo-float${big ? " cf-big" : ""}`, text);
    boardWrap.appendChild(f);
    floatEl = f;
    floatTimer = window.setTimeout(() => {
      if (floatEl === f) floatEl = null;
      f.remove();
    }, big ? 950 : 750);
  }

  /**
   * SFX-01: the board's fx are the game's heartbeat, so each FxType has one
   * sound and no more. `pop` climbs a pentatonic ladder on its own (the cue
   * keeps the streak), which is what makes a nine-gem cascade read as a run
   * instead of a machine gun; the CHAIN/COMBO callout rings a bell that gets
   * brighter with the tier it prints.
   */
  const FX_SOUND: Record<FxType, Cue | null> = {
    pop: "pop", crack: "crack", up: "up", boom: "boom", bad: "deny",
    chain: "combo", combo: "combo", cross: null, bcross: "crack",
  };

  function fx(type: FxType, r: number, c: number, text?: string) {
    // PP-14: a cross match summons the angel — the choir sings the instant
    // the shape resolves, and the praying-angel PNG pops over the centre gem
    // in the same one-shot style as every other fx icon.
    if (type === "cross") playHoly();
    const cue = FX_SOUND[type];
    if (cue) {
      // "CHAIN x2" / "COMBO x3!!" carry their tier in the text; the bell reads it.
      const tier = Number(/x(\d+)/.exec(text ?? "")?.[1] ?? 0);
      sfx.play(cue, tier > 1 ? { step: tier - 1 } : undefined);
    }
    const e = h("div", `fx fx-${type}`);
    e.style.left = (c * CELL + CELL / 2) + "px";
    e.style.top = (r * CELL + CELL / 2) + "px";
    if (type === "cross") {
      e.style.backgroundImage = `url("${angelUrl}")`;
      e.setAttribute("aria-hidden", "true");
    }
    if (text) e.textContent = text;
    grid.appendChild(e);
    const callout = type === "chain" || type === "combo";
    setTimeout(() => e.remove(), callout ? 1000 : type === "cross" ? 1150 : 600);
    // A1: every callout now draws in the board slot too — the small text at
    // the matched cell AND the banner above the board. `onFx` was never
    // assigned before this, so both were dead code.
    if (callout && text) showFloat(text, type === "combo");
  }

  // ── PP-14: the cross bounty chooser ──────────────────────────────────────
  // The board pauses the cascade on a HOLY CROSS (6 units) or a BROKEN HOLY
  // CROSS (3 units) and waits; this panel asks how to spend the units of
  // blessing. Repeats are allowed — tap a cargo to add one unit, tap it again
  // to take one back, up to the cross's total (all of one, 2+2, one of each,
  // any mix). The confirm enables at exactly that total, and the 8s timer
  // (the board's own 9s backstop is the second line of defence) auto-confirms
  // whatever is selected so the cascade always resumes — the board fills any
  // unspent unit with a random cargo.
  //
  // The panel must NEVER vanish "weirdly": clicks anywhere outside it do not
  // dismiss it, a tab switch that would hide the plant panel is refused while
  // a pick is pending, and a second cross resolving over an unanswered one
  // answers the first with its current selection before the new chooser shows.
  let pickEl: HTMLElement | null = null;
  let pickTimer = 0;
  let pickFn: ((chosen: ResKey[]) => void) | null = null;
  const pickCounts = new Map<ResKey, number>();

  function crossPick(kind: "holy" | "broken", picks: number, pick: (chosen: ResKey[]) => void) {
    const total = () => [...pickCounts.values()].reduce((a, b) => a + b, 0);
    const expand = () => {
      const chosen: ResKey[] = [];
      for (const [res, n] of pickCounts) for (let i = 0; i < n; i++) chosen.push(res);
      return chosen;
    };
    const close = () => {
      window.clearTimeout(pickTimer);
      pickEl?.remove();
      pickEl = null;
      pickFn = null;
    };
    // A second cross while the first chooser is still open: answer the first
    // with what was picked so far (the board tops up the rest), so its paused
    // cascade can never hang, then show the new chooser.
    if (pickFn) {
      const prev = pickFn;
      const chosen = expand();
      close();
      prev(chosen);
    }
    pickCounts.clear();
    pickFn = pick;
    const holy = kind === "holy";
    const panel = h("div", `cross-pick${holy ? "" : " broken"}`);
    panel.appendChild(h("div", "cross-pick-title", holy ? "🙏 HOLY CROSS" : "✝ BROKEN CROSS"));
    panel.appendChild(h("div", "cross-pick-sub", `Spend ${picks} bounties · repeats allowed`));
    const row = h("div", "cross-pick-row");
    const count = h("div", "cross-pick-count", `0 / ${picks} spent`);
    const confirm = h("button", "cross-pick-confirm", holy ? `🙏 Bless +${picks}` : `✝ Bless +${picks}`);
    (confirm as HTMLButtonElement).type = "button";
    (confirm as HTMLButtonElement).disabled = true;
    // SFX-01: the blessing lands as gold does — two coins touching.
    confirm.dataset.sfx = "coin";
    const refresh = () => {
      count.textContent = `${total()} / ${picks} spent`;
      (confirm as HTMLButtonElement).disabled = total() !== picks;
      row.querySelectorAll<HTMLElement>("[data-gem]").forEach((b) => {
        const n = pickCounts.get(b.dataset.gem as ResKey) ?? 0;
        b.classList.toggle("sel", n > 0);
        b.dataset.n = String(n);
      });
    };
    for (const cargo of TRADEABLE) {
      const gem = CARGO_TO_GEM[cargo];
      if (!gem) continue;
      const b = h("button", "cross-pick-btn");
      (b as HTMLButtonElement).type = "button";
      // SFX-01: each unit spent climbs a semitone (the `pick` cue keeps the
      // streak), so the panel audibly fills up. Declared in markup rather than
      // played from the handler below: the sound belongs to the touch, and the
      // handler stays about the counting.
      b.dataset.sfx = "pick";
      b.dataset.cargo = cargo;
      b.dataset.gem = gem;
      b.style.setProperty("--c1", CARGO[cargo].c1);
      b.style.setProperty("--c2", CARGO[cargo].c2);
      b.innerHTML = `<i>${CARGO[cargo].icon}</i><span>+1</span>`;
      b.title = `Spend a bounty on ${CARGO[cargo].name} (tap again to take it back)`;
      b.onclick = () => {
        const n = pickCounts.get(gem) ?? 0;
        if (total() >= picks) {
          if (n > 0) pickCounts.set(gem, n - 1);       // swap one unit out
          else { toast(`All ${picks} spent — tap a chosen cargo to take one back.`, "info"); return; }
        } else {
          pickCounts.set(gem, n + 1);                  // spend one more unit
        }
        refresh();
      };
      row.appendChild(b);
    }
    confirm.onclick = () => { pick(expand()); close(); };
    panel.appendChild(row);
    panel.appendChild(count);
    panel.appendChild(confirm);
    boardWrap.appendChild(panel);
    pickEl = panel;
    pickTimer = window.setTimeout(() => {
      if (!pickEl) return;
      pick(expand());
      close();
    }, 8000);
  }

  function popup(gains: Partial<Record<ResKey, number>>, label: string) {
    // SFX-01: the chute pays out. Only when something actually landed — an
    // empty popup is a cascade's COMBO label, which already rang its bell.
    if (Object.keys(gains).length) sfx.play("harvest");
    const e = h("div", "harvest-pop");
    // AUDIT 2026-09-11 — ResKey → Cargo: sheep 🐑 has no purse entry,
    // brick 🧱 has none either. The popup must show the Cargo the purse
    // actually received (sheep→oil 🛢️, brick→stone 🪨, wheat→grain 🌾)
    // via GEM_TO_CARGO, or a chain's 2× would float a dead sheep icon.
    const parts = (Object.keys(gains) as ResKey[]).map((k) => {
      const cargo = GEM_TO_CARGO[k as ResKey];
      const icon = cargo ? CARGO[cargo].icon : RES[k as ResKey].icon;
      return `<span>+${gains[k as ResKey] ?? 0}${icon}</span>`;
    }).join("");
    // A1: no gains means no body — a tokenless cascade still has its COMBO
    // label, and an empty flex row would float an empty box beside it.
    e.innerHTML = (label ? `<b class="hp-label">${label}</b>` : "")
      + (parts ? `<div class="hp-body">${parts}</div>` : "");
    boardWrap.appendChild(e);
    setTimeout(() => e.remove(), 1600);
  }

  const lastToast: Record<string, number> = {};
  function toast(text: string, kind: "good" | "bad" | "info" | "danger" | "success" = "info") {
    const now = performance.now();
    if (lastToast[text] && now - lastToast[text] < 900) return;
    lastToast[text] = now;
    // SFX-01: a refusal is worth a sound — two muted knocks, "a palm flat on
    // the ledger" — because it is the one message the player might otherwise
    // miss at the edge of their vision. Good news stays SILENT here on purpose:
    // every gain already sounds where it happens (`harvest`, `coin`, `star`,
    // `build`), and a second chime on the toast that reports it is the doubling
    // that makes a game feel noisy. The cue's own 200 ms gap keeps a cascade of
    // bad news from drumming.
    if (kind === "bad" || kind === "danger") sfx.play("deny");
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
    x.dataset.sfx = "close";
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

  const rivalWireQueue: UiRivalryBeat[] = [];
  let rivalWireBusy = false;
  let rivalWirePlayerPortrait = portraitVex;

  const paintRivalryBeat = (beat: UiRivalryBeat) => {
    const yours = beat.speaker === "you";
    rivalWire.dataset.speaker = beat.speaker;
    rivalWire.classList.toggle("you-speaking", yours);
    rivalWireFace.style.backgroundImage = `url(${yours ? rivalWirePlayerPortrait : portraitTorvin})`;
    rivalWireLabel.textContent = yours ? "You · Open channel" : "Rival · Private wire";
    rivalWireText.textContent = beat.text;
  };

  const showNextRivalryBeat = () => {
    if (!rivalWire.isConnected) {
      rivalWireQueue.length = 0;
      rivalWireBusy = false;
      return;
    }
    const beat = rivalWireQueue.shift();
    if (!beat) {
      rivalWireBusy = false;
      rivalWire.classList.add("hidden");
      rivalWire.classList.remove("show", "leaving");
      return;
    }
    rivalWireBusy = true;
    // SFX-01: a telegraph key and a sheet of paper — the wire opening. The
    // cue's 420 ms gap means a queued exchange ticks once per beat, not once
    // per word, and never over the toast that introduced it.
    sfx.play("wire");
    paintRivalryBeat(beat);
    rivalWire.classList.remove("hidden", "leaving", "show");
    void rivalWire.offsetWidth;
    rivalWire.classList.add("show");
    // One compact line at a time keeps even the longer oil exchange out of the
    // player's way. Replies are never discarded: new scenes join this queue.
    const readingTime = Math.min(4_200, Math.max(2_400, 1_300 + beat.text.length * 30));
    window.setTimeout(() => {
      rivalWire.classList.remove("show");
      rivalWire.classList.add("leaving");
      window.setTimeout(showNextRivalryBeat, 220);
    }, readingTime);
  };

  function rivalQuip(beats: readonly UiRivalryBeat[]) {
    if (!beats.length) return;
    rivalWireQueue.push(...beats);
    // A sabotage toast is normally appended just before this call. Move the
    // wire to the lane's end so the messages stack in reading order.
    toasts.appendChild(rivalWire);
    if (!rivalWireBusy) showNextRivalryBeat();
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
  function renderHUD(purse: Partial<Record<Cargo, number>>, players: UiPlayer[], portrait: Portrait) {
    chips.innerHTML = "";
    for (const k of CARGOES) {
      const chip = h("div", "chip");
      chip.style.setProperty("--c1", CARGO[k].c1);
      chip.style.setProperty("--c2", CARGO[k].c2);
      chip.innerHTML = `<span class="chip-ic"><i class="gem-ic">${CARGO[k].icon}</i></span><span class="chip-n">${purse[k] ?? 0}</span>`;
      // PP-08: the Gold chip states what the currency is for, so a player
      // holding coins never mistakes them for construction stock.
      if (k === "gold") chip.title = GOLD_RULE;
      chips.appendChild(chip);
    }
    const meP = players.find((p) => p.human);
    const yourVp = meP?.vp ?? 0;
    // The original badge is just a star counter; keeping "You" in it lets the
    // boot/e2e assertions stay unambiguous for the single-player build.
    vp.innerHTML = `<span class="vp-star">★</span> You ${fmtVp(yourVp)}<span class="vp-tot">/${VICTORY.target}</span>`;

    const list = [...players].sort((a, b) => b.vp - a.vp);
    kingdoms.innerHTML = "";
    for (const p of list) {
      const row = h("div", "king" + (p.human ? " self" : ""));
      row.style.setProperty("--pc", p.colour);
      // AI-03: the breakdown is prebuilt by the game (it owns the ledger);
      // native title keeps this one line of tooltip code.
      if (p.vpTip) row.title = p.vpTip;
      // PP-14b + NOIR: the dossier face. The player's own is the Vex or You
      // portrait picked on the start screen; every rival keeps the mugshot its
      // name (or seat) maps to — Torvin plays the solo rival. The coloured
      // initial stays as the fallback under the image.
      const face = p.human
        ? (portrait === "you" ? portraitYou : portraitVex)
        : portraitFor(p, players.indexOf(p));
      row.innerHTML = `
        <div class="king-av has-portrait" style="background-image:url(${face})">${p.name[0]}</div>
        <div class="king-mid">
          <div class="king-name">${p.name}${p.human ? " <span class='you'>YOU</span>" : ""}</div>
          <div class="king-bar"><i style="width:${Math.min(100, (p.vp / VICTORY.target) * 100)}%;background:${p.colour}"></i></div>
        </div>
        <div class="king-vp">${fmtVp(p.vp)}<small>★</small></div>`;
      kingdoms.appendChild(row);
    }
  }

  // ── quota status / upgrade bar / combo ─────────────────────────────────────
  // PP-14b: the combo bank is more prominent now — the pips grew, and a bold
  // "N/N" readout spells out how close the next free Gold coin is. The "full"
  // state (the next combo pays) lights the whole bank gold.
  function setCombo(count: number, need: number) {
    comboBank.innerHTML =
      `<span class="cb-lbl">Combo</span>` +
      Array.from({ length: need }, (_, i) => `<i class="${i < count ? "on" : ""}"></i>`).join("") +
      `<b class="cb-n">${count}/${need}</b>`;
    comboBank.classList.toggle("full", count >= need);
  }

  // ── paint ─────────────────────────────────────────────────────────────────
  function paint(state: UiState) {
    rivalWirePlayerPortrait = state.portrait === "you" ? portraitYou : portraitVex;
    if (rivalWire.dataset.speaker === "you") {
      rivalWireFace.style.backgroundImage = `url(${rivalWirePlayerPortrait})`;
    }
    renderHUD(state.purse, state.players, state.portrait);
    // PP-14b: the reset button counts its cooldown down and disables while
    // the plant re-arms.
    const resetLeft = Math.ceil((state.resetIn ?? 0) / 1000);
    resetBtn.disabled = resetLeft > 0;
    resetBtn.textContent = resetLeft > 0 ? `♻ Reset ${resetLeft}s` : "♻ Reset";
    // PP-08: the panel re-renders when Gold changes OR when the material
    // affordability of a non-gold action (Security, Repair) flips — otherwise
    // a purse that only gained/lost materials would show a stale button.
    const matAfford = (cost: Partial<Record<Cargo, number>>) =>
      (Object.entries(cost) as [Cargo, number][]).every(([k, v]) => (me.res[k] ?? 0) >= v);
    const sabKey = `${me.res.gold ?? 0}:${matAfford(SECURITY_ISO)}:${matAfford(REPAIR_ISO)}`;
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
        const bx = banner.querySelector(".banner-close") as HTMLElement;
        bx.dataset.sfx = "close";
        bx.onclick = () => {
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
    // PP-05: keep the Depot's price line honest without rebuilding the button
    // (a rebuilt button drops a click mid-gesture, the reason `renderSabotage`
    // is change-gated too). The cost text comes from the same table the
    // placement charges; `disabled` mirrors the affordability the click checks.
    const sub = depotButtonLabel(state.freeDepots);   // allowance first, then Oil
    if (sub !== lastDepotSub) {
      lastDepotSub = sub;
      if (depotSub) depotSub.textContent = sub;
    }
    buildList.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      const tool = button.dataset.tool as UiTool;
      const cost = tool === "plant" ? PLANT_COST : tool === "harvester" ? DEPOT_COST
        : tool === "road" || tool === "dirt" ? TRANSPORT[tool].cost : {};
      // W9: the free setup allowance buys Dirt Roads only.
      const free = tool === "harvester" ? state.freeDepots > 0
        : (tool === "dirt") && state.freeTrack > 0;
      button.disabled = !free && !Object.entries(cost).every(([k, v]) => (state.purse[k as Cargo] ?? 0) >= v);
      button.classList.toggle("disabled", button.disabled);
    });
    updateTradeButtons();
    buildList.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => {
      b.classList.toggle("active", b.dataset.act === "recenter");
    });
    const info = state.costInfo;
    modebar.classList.toggle("hidden", !info);
    if (info) {
      modebar.innerHTML = info;
      const cancel = h("button", "mb-cancel", "Cancel ✕");
      cancel.dataset.sfx = "close";
      cancel.onclick = () => modebar.classList.add("hidden");
      modebar.appendChild(cancel);
    }
    if (state.inspect) {
      inspectEl.innerHTML = state.inspect;
      inspectEl.classList.toggle("bad", state.inspectTone === "bad");
      inspectEl.classList.toggle("good", state.inspectTone === "good");
      inspectEl.style.display = "block";
    } else {
      inspectEl.innerHTML = "";
      inspectEl.classList.remove("bad", "good");
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
      : "<b>Network reaches</b><i>nothing — connect a depot</i>";
    const hint = h("div", "iso-hint");
    hint.textContent = chipsHtml
      ? "Match 3+ gems. Only tokened gems (numbered) process the cargo above."
      : "Connect a depot to your Factory: tokens only spawn on cargo you reach.";
    reachEl.appendChild(hint);
  }

  // ── help / modals ─────────────────────────────────────────────────────────
  function helpModal() {
    sfx.play("open");
    modalRoot.classList.remove("hidden");
    modalRoot.innerHTML = `
      <div class="modal-back"></div>
      <div class="modal box">
        <h2>Hexmatch Industries</h2>
        <p class="sub">Two worlds, one empire: <b>resource node → Depot → transport network → Factory → processing → resources available for construction</b>. First to <b>${VICTORY.target}★ Victory Points</b> wins.</p>
        <div class="help-cols">
          <div class="help-col"><h3>The Territory</h3><p>Place <b>Depots</b> beside resource nodes to collect their output, then build <b>Dirt Roads</b> &amp; <b>Roads</b> (paved) to carry it to your Factory. The connection sets the multiplier — ×1.0 on gravel, ×1.6 anywhere a paved tile touches the line — and nothing else.</p>
<p><h3>How you score (VP-01)</h3><p><b>Dirt Roads score nothing.</b> Points come from <b>upgrading</b>: pave a Dirt Road tile into a Road for <b>+${VICTORY.upgrade}★</b> (it costs only ${costCompact(UPGRADE_COST)}, since the gravel is already paid for), and raise a <b>processing plant</b> beside another town for <b>+${VICTORY.plant}★</b>. Four paves to the point; <b>${VICTORY.target}★</b> wins. A Road laid on virgin ground scores nothing — the point is for improving what you built. Tear up a paved tile or demolish a plant and the point goes back.</p><p>Your <b>first Depot is free</b>; every Depot after it costs <b>${costCompact(DEPOT_COST)}</b>, so reaching new industries (or manufacturing in the Processing Plant) is what buys expansion. A Depot you cannot pay for is refused and consumes nothing.</p><p><b>Lorries run 2× faster on paved Roads</b> — paving a lane is both the points and the income (AI-02).</p><p>Pan with the <b>middle mouse button</b> (wheel zooms, touch drags pan). The left button only places or selects — dragging it never pans.</p></div>
          <div class="help-col"><h3>The Processing Plant</h3><p>Where your Factory turns delivered cargo into resources available for construction. Match tokens to process: a colour only pays when your network reaches its industry. Match 4 doubles, match 5 makes a <b>bomb</b>. <b>Gold</b> 🪙 is its own colour — its gems drop only while a depot sits beside a gold mine (and pay once it's connected).</p></div>
          <div class="help-col"><h3>Gold, Trade & Defence</h3><p>Earn <b>gold</b> from gold-mine access or combos. <b>Gold is reserved for Black Market sabotage</b> — it never buys construction, cannot substitute for missing materials, and is refused by every market exchange. Security Forces and Repair Crew are hired with ordinary materials. A <b>Protest</b> ✊ shuts any public road for 2:00 — every truck stops, including your own.</p></div>
        </div>
        <button class="big-btn" id="startBtn">Start Production</button>
      </div>`;
    const shut = () => { sfx.play("close"); modalRoot.classList.add("hidden"); };
    (modalRoot.querySelector("#startBtn") as HTMLElement).onclick = shut;
    (modalRoot.querySelector(".modal-back") as HTMLElement).onclick = shut;
  }

  function showModal(html: string) {
    sfx.play("open");
    modalRoot.classList.remove("hidden");
    modalRoot.innerHTML = `<div class="modal-back"></div>${html}`;
    (modalRoot.querySelector(".modal-back") as HTMLElement).onclick = () => {
      sfx.play("close");
      modalRoot.classList.add("hidden");
    };
  }
  function hideModal() {
    if (!modalRoot.classList.contains("hidden")) sfx.play("close");
    modalRoot.classList.add("hidden");
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  // SFX-01: the hover/press delegation for this chrome. `main.tsx` already
  // attaches it to the whole document (so the start screen sounds too) and the
  // install is idempotent per scope — this call is what covers a UI mounted
  // straight into a page, which is how the e2e specs and the headless suites
  // boot it.
  attachUiSound(root);
  renderSabotage();
  renderBoard();
  renderMarket();
  responsiveZoom();
  setTab("plant");

  return {
    el: root,
    mapHost,
    renderBoard,
    setReach,
    setCombo,
    paint,
    feed,
    rivalQuip,
    toast,
    fx,
    popup,
    crossPick,
    isQuarryOpen: () => !qp.classList.contains("hidden"),
    isTradeOpen: () => !marketPane.classList.contains("hidden") || !bankPane.classList.contains("hidden"),
    showModal,
    hideModal,
  };
}
