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
  CELL, RES, OFFER_LIFE,
  SABOTAGE, SECURITY, REPAIR_COST, type ResKey,
} from "./config";
import { BANK_RATE, MAX_OFFERS } from "./trade";
// VP-01: the victory numbers come from the iso config, NOT from the legacy
// `VP = { target: 10 }` in game/config.ts that this file used to read. That
// constant and the engine's own `VP_TARGET` were two numbers with one name,
// and the HUD was already showing "/10" while the game was winning at 12 — the
// scoreboard now has exactly one source, `VICTORY` in src/iso/config.ts.
import { CARGO, CARGOES, TRANSPORT, VICTORY, UPGRADE_COST, type Cargo, type Portrait } from "../iso/config";
import { DEPOT_COST } from "../iso/construction";
import { PLANT_COST } from "../iso/plants";
import { GEM_TO_CARGO } from "../iso/quarry";
// RAIL-04 (#178): the buttons print the railway's real prices and its real
// point value — the same table and the same constant the placement charges.
import { RAIL_COSTS } from "../iso/rail";
// VP-01: quarters on the scoreboard — 4.75★, not 4.7499999999999996★.
import { fmtVp } from "../iso/victory";
// AI-01: the rival difficulty presets the top-bar selector switches between.
import { RIVAL_SKILLS, SKILL_KEYS, type SkillKey } from "../iso/skill";
// TUT-01: the stepped starting tour. The ❔ help modal is the reference card;
// this is the lesson, replayable from it at any time (and shown once at boot by
// game.ts, which owns that gate).
import { showTutorial, type TutorialHandle } from "../iso/tutorial";
// PP-14: the praying angel that a cross match summons, and the choir that
// sings with it. Both are one-shot fx answers to `onFx("cross", …)`.
import angelUrl from "../assets/ui/angel.png";
import { playHoly, prewarmHoly } from "./holy";
// SFX-01: the UI sound layer. `attachUiSound` gives every control in this
// chrome a hover tick and a press sound from ONE delegation; the calls below
// are only the moments that are not a button — a tab sliding, a toast saying
// no, a gem clearing, the wire opening.
import { attachUiSound, registerSoundPainter, soundLabel, sfx } from "../audio/sfx";
import type { Cue } from "../audio/cues";
// PP-14b: the tycoon portraits live with the NOIR mugshots further down — one
// set of faces, so the start-screen pick and the dossiers read the same files.

// PP-14: the cross bounty chooser offers the five CARGOES, and each button
// must hand the board back its COLOUR key — the reverse of GEM_TO_CARGO.
const CARGO_TO_GEM: Partial<Record<Cargo, ResKey>> = Object.fromEntries(
  Object.entries(GEM_TO_CARGO).map(([gem, cargo]) => [cargo, gem]),
) as Partial<Record<Cargo, ResKey>>;
import { Board, BOARD_ANIMATION_MS, FAST_ANIMATION_MS, type FxType, type Gem } from "./board";
import type { IsoMarket, IsoMarketPlayer, Offer } from "../iso/market";
import portraitYou from "../assets/ui/tycoon_you_small.png";
import portraitKrag from "../assets/ui/tycoon_krag.png";
import portraitTorvin from "../assets/ui/tycoon_torvin_small.png";
import portraitVex from "../assets/ui/tycoon_vex_small.png";
// STORY-01: the wire's office voice (Mabel) and her standing expression.
import { faceOf } from "../story/cast";
// MOBILE-01: copy that names controls must name the ones this device HAS.
import { coarsePointer } from "../iso/touch";

// ── V5: the restored gem art ────────────────────────────────────────────────
// One sprite per cargo (./gem-art.ts), mapped through the same gem→cargo
// bijection quarry.ts uses, so a colour can never draw the wrong sprite.
import { GEM_ART } from "./gem-art";
import {
  HUD_ICONS, ICON_CROSS, cargoIconHtml, costMarkup, depotButtonMarkup, soundIconHtml,
} from "./hud-icons";

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
/**
 * PP-06: `plant` raises an additional processing plant beside another town.
 * `select` is the pointer: it builds nothing — it highlights the tile under
 * the cursor and lets the inspector say what it is (the strategy-game
 * "read the map" hand). Right-click on the map drops any tool back to it,
 * and Q does the same from the keyboard.
 */
export type UiTool =
  | "select" | "dirt" | "road" | "harvester" | "plant" | "demolish"
  // RAIL-04 (#178): the railway's tools. `rail` drags track, `platform` and
  // `raildepot` place one structure in the current heading (R turns it), and
  // `railway` holds the panel: the lines, the trains and the buy/recall/sell
  // buttons.
  | "rail" | "platform" | "raildepot" | "railway";

/** RAIL-05 (#182): the tools the railway feature flag owns — the set the
 *  campaign boot hides when the flag is down. */
export const RAIL_TOOL_KEYS: ReadonlySet<UiTool> = new Set<UiTool>([
  "rail", "platform", "raildepot", "railway",
]);

/**
 * RAIL-04: one row of the Railway panel. The MODEL is `railPanelRows` in
 * `rail.ts` (platforms, depots, trains and which actions each offers); the game
 * adds the price the button should print, because only it knows the tables.
 */
export interface UiRailRow {
  id: number;
  kind: "platform" | "depot" | "train";
  label: string;
  detail: string;
  actions: ("assign" | "recall" | "sell" | "buy" | "start")[];
  /** `assign`: the partner platform. `buy`: the line the train is bought for. */
  partnerId?: number;
  /** What the action costs, in the game's own cargo wording. */
  hint?: string;
}

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
  /** BANNER-ONCE: the stable id behind `banner`. The ✕ dismissal is
   *  remembered by this, not the exact text, so a closed banner never pops
   *  back up when its wording changes and returns (tool switch, countdown). */
  bannerKey: string | null;
  /**
   * STORY-01: when set, the sheet is SPOKEN — the banner paints as Mabel's
   *   speech bubble with this face beside it (a quadrant of her expression
   *   sheet at a uniform 2×, or a solo portrait at `cover`). Null/omitted:
   *   the posted manila sheet, exactly as before the campaign.
   */
  bannerFace?: { url: string; pos: readonly [number, number] | null } | null;
  /** STORY-01: the name tag on the bubble ("Mabel Quill"). */
  bannerWho?: string | null;
  costInfo: string | null;
  inspect: string | null;
  /** PP-03: tones the inspector when it is a placement verdict (e.g. the red
   *  "can't go here — …" reason for an invalid Factory/Depot hover). */
  inspectTone?: "good" | "bad" | null;
  reach: Partial<Record<Cargo, number>>;
  /** PP-14b: ms left on the Processing Plant reset cooldown (0 = ready). */
  resetIn: number;
  /**
   * AI-04: the ★ line this game races to — the difficulty owns it now (5★ on
   * easy, the shipped `VICTORY.target` elsewhere), so the HUD reads it off the
   * state instead of the constant. Optional: a state that omits it (an older
   * test harness) falls back to the shipped line.
   */
  vpTarget?: number;
  /**
   * STORY-01: the dossier face the rival seat wears — a quadrant of the
   * campaign's painted expression sheet (`pos` set, drawn at a uniform 2×)
   * or a solo portrait (`pos` null, drawn `cover`). Omitted: the name/seat
   * mugshot map, exactly as before the campaign existed.
   */
  rivalFace?: { url: string; pos: readonly [number, number] | null };
  /** PP-14b: which tycoon portrait the player picked. */
  portrait: Portrait;
  /**
   * NAMES: whether the name tags are shown over the map's features — the
   * top-bar Names button paints its pressed state from this.
   */
  showNames?: boolean;
  /**
   * RAIL-04 (#178): the Railway panel — one row per platform, depot and train,
   * each carrying the actions a player may take on it. Optional: a state that
   * omits it (an older harness, a game with no railway yet) simply shows the
   * panel's empty hint.
   */
  rail?: { rows: UiRailRow[]; view: string };
}

export interface UiHooks {
  onTool: (tool: UiTool) => void;
  /**
   * RAIL-04: the Railway panel's buttons. `id` is the row's rail id (a
   * platform, a depot or a train — the action says which table), and `assign`
   * also carries the partner platform the line would run to; `buy` carries
   * the line the train is bought for, and `start` sends a parked train off. The game owns the
   * rules and the prices; this chrome only reports the click.
   */
  onRailAction: (id: number, action: "assign" | "recall" | "sell" | "buy" | "start", partnerId?: number) => void;
  /**
   * NAMES: the top-bar "Names" button reports a toggle. The game owns the
   * state and the localStorage record; the chrome only repaints its pressed
   * look from `UiState.showNames` on the next paint.
   */
  onNames?: () => void;
  /** NAMES: the boot state, so the button opens in the right pressed look. */
  names?: boolean;
  onRecenter: () => void;
  /**
   * MOBILE-01: the floating zoom keys (the wheel's touch twin). Omitted by
   * harnesses that mount the chrome without a camera behind it.
   */
  onZoom?: (dir: 1 | -1) => void;
  onSwap: (r1: number, c1: number, r2: number, c2: number) => void;
  onReset: () => void;
  onBlackAction: (key: string) => void;
  /** AI-01: the player picked a rival difficulty (applies from the next turn). */
  onSkill?: (key: SkillKey) => void;
  /** AI-01: the boot difficulty, so the selector opens on the right value. */
  skill?: SkillKey;
  /**
   * MOBILE-02: the phone chrome wants a board that FILLS the window — more
   * columns/rows at a smaller cell where the viewport leaves room, instead of
   * the shipped 7×8 shrunk toward a clip. The chrome only ASKS; the game
   * answers. It may grow a solo board (and must not on a multiplayer GUEST,
   * whose grid is authored by the host), and it may answer `false` to veto
   * the request entirely. Return true when the size was applied.
   *
   * #163: the ask only ever comes from a SETTLED measurement of the visible
   * plant slot — never from a tab switch — so the same viewport always asks
   * for the same rectangle. The chrome may also ask to RETRACT columns/rows
   * it itself added earlier in this session when they no longer fit at the
   * comfortable cell size, but only before the player has played into them;
   * the shipped size, restored saves and host-authored boards are never
   * asked to shrink (a guest vetoes every answer here regardless).
   */
  requestBoardSize?: (w: number, h: number) => boolean;
}

export interface UiRivalryBeat {
  /** STORY-01 adds the office: Mabel Quill rides the same wire as the rival,
   *  in her own patina keyline, when the guide has something to say. */
  speaker: "rival" | "you" | "guide";
  text: string;
  /** STORY-01: the face this beat speaks with — a quadrant of a painted
   *  expression sheet (`pos` set, drawn at a uniform 2×) or a solo portrait
   *  (`pos` null, drawn `cover`). Omitted: the speaker's standing mugshot. */
  face?: { url: string; pos: readonly [number, number] | null };
  /** STORY-01: overrides the small keyline label ("Office · Mabel Quill"). */
  label?: string;
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
  /**
   * #112: take the cross chooser down WITHOUT answering it — the host
   * resolved, expired or cleared the prompt, so a stale dialog must not sit
   * over a cascade that has moved on (and a queued second chooser must not
   * surface afterwards).
   */
  crossCancel: () => void;
  isQuarryOpen: () => boolean;
  isTradeOpen: () => boolean;
  showModal: (html: string) => void;
  hideModal: () => void;
  /** GFX-01/SETTINGS-01: raise the same ❔ reference card the top bar opens.
   *  The ☰ menu's "How to Play" row routes through here so one modal serves
   *  both keys (and `window.__iso` can open it from the console). */
  showHelp: () => void;
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

const costStr = (cost: Partial<Record<Cargo, number>>) => costMarkup(cost);

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

/**
 * MOBILE-02: the phone regime, asked the same way the stylesheet asks it —
 * a portrait sheet at ≤760px, or the short landscape phone at ≤900×500
 * (styles.css owns both media queries). JS needs the answer too, because the
 * phone layout is not just CSS there: the board grows into a fit, the top
 * bar tucks, the private wire falls silent, and all of that must flip on the
 * EXACT breakpoint the sheet does — not one pixel of drift. Absent window
 * (headless boards, node tests) this is a desktop.
 */
const isPhoneViewport = (): boolean => {
  if (typeof window === "undefined") return false;
  const w = window.innerWidth, h = window.innerHeight;
  return w <= 760 || (w <= 900 && h <= 500);
};

/** Optional per-boot chrome flags (RAIL-05: the railway's four buttons only
 *  exist when the feature flag lets them — the campaign boots without rail
 *  until #179/#181 land). */
export interface OriginalUiOptions {
  rail?: boolean;
}

export function createOriginalUi(
  board: Board,
  market: IsoMarket,
  me: IsoMarketPlayer,
  hooks: UiHooks,
  opts: OriginalUiOptions = {},
): OriginalUi {
  const root = h("div", "ui-root");
  root.dataset.view = "map";
  root.style.setProperty("--gem-move-ms", `${BOARD_ANIMATION_MS.swap}ms`);
  root.style.setProperty("--gem-clear-ms", `${BOARD_ANIMATION_MS.clear}ms`);
  // #162: falls ease under their own wait (swap/clear kept theirs), so the
  // DOM's gravity can never outrun the board logic it trails.
  root.style.setProperty("--gem-fall-ms", `${BOARD_ANIMATION_MS.fall}ms`);

  // Issue #152 — turbo catch-up. While the player has a valid move queued the
  // board runs its waits at FAST_ANIMATION_MS; the gem transitions must snap
  // to match or the DOM would still be gliding when the next swap lands.
  // The board flips this on and off (`onTurbo`); `renderBoard` reads
  // `turboMode` to decide whether a cleared gem leaves a remnant behind.
  let turboMode = false;
  /** How long a `.gem-remnant` lingers before it is pulled from the DOM. */
  const REMNANT_MS = 320;
  function setTurbo(on: boolean) {
    if (on === turboMode) return;
    turboMode = on;
    const t = on ? FAST_ANIMATION_MS : BOARD_ANIMATION_MS;
    root.style.setProperty("--gem-move-ms", `${t.swap}ms`);
    root.style.setProperty("--gem-clear-ms", `${t.clear}ms`);
    root.style.setProperty("--gem-fall-ms", `${t.fall}ms`);
    root.classList.toggle("turbo", on);
  }
  board.onTurbo = setTurbo;

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
    skillWrap.appendChild(h("span", "rival-skill-ic", HUD_ICONS.gear));
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
    soundBtn.innerHTML = soundIconHtml(on);
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
  // GFX-01: the ⚙ this panel used to carry is gone — SETTINGS-01 raised the
  // whole room instead. The ☰ menu game.ts mounts at the far right of this
  // bar carries Settings, How to Play and Quit to main menu, and the Settings
  // row opens `iso/settings-sheet.ts` — the SAME projector the main menu
  // opens, so the door and the match can never show different controls.
  const fitBtn = h("button", "icon-btn", HUD_ICONS.reticle);
  fitBtn.title = "Recenter map";
  fitBtn.dataset.act = "recenter";
  fitBtn.onclick = () => hooks.onRecenter();
  right.appendChild(fitBtn);
  // NAMES: show/hide the tags that float over resources, towns, plants and
  // depots while you pan. ON by default — the map should be readable at a
  // glance, the way a strategy map is — and the choice is the game's to
  // remember (it persists; the chrome only reports the toggle here).
  // MOBILE-01: the word is its own span so a phone can keep the monogram key
  // and drop the word — the word is what used to wrap out of a 26px button
  // and hang over the map.
  const namesBtn = h("button", "icon-btn names-btn", `Aa<span class="nb-word"> Names</span>`);
  namesBtn.id = "iso-names";
  namesBtn.type = "button";
  namesBtn.title = "Show / hide names over resources, towns and buildings";
  namesBtn.setAttribute("aria-pressed", String(hooks.names ?? true));
  namesBtn.onclick = () => hooks.onNames?.();
  right.appendChild(namesBtn);
  const helpBtn = h("button", "icon-btn help-btn", HUD_ICONS.help);
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
  // RAIL-01: the collapse key names the panel it folds (aria-controls).
  left.id = "iso-aside-left";
  const bp = h("div", "panel");
  bp.appendChild(h("div", "panel-title", "Build"));
  const buildList = h("div", "build-list");
  bp.appendChild(buildList);
  left.appendChild(bp);

  // ── RAIL-04 (#178): the Railway panel ────────────────────────────────────
  // Shown while a railway tool is held (the tile tool, the two placements and
  // the panel button itself). The rows come from the game — one per platform,
  // depot and train, with the actions the RULES allow — so the panel can never
  // offer a button the rules would refuse (a sell before the train is home, an
  // assign on a network that already runs one).
  const railPanel = h("div", "panel rail-panel hidden");
  railPanel.appendChild(h("div", "panel-title", "Railway"));
  const railNote = h("div", "pane-note");
  railNote.innerHTML = "Rail costs stone · a platform pays +1★ · one train per connected network. <b>R</b> turns a platform or depot.";
  railPanel.appendChild(railNote);
  const railRows = h("div", "rail-rows");
  railPanel.appendChild(railRows);
  left.appendChild(railPanel);

  const sp = h("div", "panel grow");
  sp.appendChild(h("div", "panel-title", "Black Market"));
  // PP-08: the standing currency rule, stated right where Gold is spent.
  sp.appendChild(h("div", "pane-note gold-rule", `${cargoIconHtml("gold")} ${GOLD_RULE} Construction and trade never touch it.`));
  const sabList = h("div", "sab-list");
  sp.appendChild(sabList);

  root.appendChild(left);

  // ── rival offer tray (floats left of the Quarry) ─────────────────────────
  const offerTray = h("div", "offer-tray hidden");
  root.appendChild(offerTray);

  // ── right: shared economy window ────────────────────────────
  const rightAside = h("aside", "aside right iso-panel");
  // RAIL-01: same contract as the build column — the key names its panel.
  rightAside.id = "iso-aside-right";
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
  // MOBILE-02: the layout box follows the LIVE board, not the shipped
  // constants — a phone may have grown the grid to fill its window (and a
  // restored save carries whatever rectangle it was left in).
  applyGridSize();
  boardWrap.appendChild(grid);
  // MOBILE-02: the wrap rides inside a slot. On the desktop the slot is
  // `display:contents` (invisible, nothing changes); on a phone the trade
  // sheet makes it the flex box between the tab strip and the footer, so the
  // chrome can MEASURE the room the board owns and size the board into it —
  // which is what turns "fits without a scroll where it can" into "always
  // fits": the gap is filled with extra columns/rows first, zoom second.
  const boardSlot = h("div", "board-slot");
  boardSlot.appendChild(boardWrap);
  qp.appendChild(boardSlot);


  // Shared tabs; keep the existing board mounted while switching panes.
  // MOBILE-02: every tab is icon + word now, and the word lives in its own
  // span so the phone strip can drop to icon-only on the very narrow ends
  // without touching markup or the accessible name (unit tests keep reading
  // the full words out of `textContent`).
  const tp = h("div", "panel grow");
  tp.id = "iso-trade";
  // MOBILE-02: the tuck handle. On a phone in the economy sheet the top bar
  // hides itself once it stops changing (see syncTopbarTuck); this thin grab
  // strip above the tabs is the deliberate way to call it back down.
  const topGrip = h("button", "tb-grip");
  topGrip.type = "button";
  topGrip.title = "Show the top bar";
  topGrip.setAttribute("aria-label", "Show the top bar");
  topGrip.dataset.sfx = "open";
  topGrip.innerHTML = `<span class="tb-grip-pill" aria-hidden="true"></span>`;
  topGrip.onclick = () => revealTopbar(6000);
  tp.appendChild(topGrip);
  const tabs = h("div", "tabs");
  const tabMarket = h("button", "tab active", `<i class="tab-ic" aria-hidden="true">${HUD_ICONS.market}</i><span class="tab-l">Market</span>`);
  const tabBank = h("button", "tab", `<i class="tab-ic" aria-hidden="true">${HUD_ICONS.bank}</i><span class="tab-l">Bank</span>`);
  const tabFeed = h("button", "tab", `<i class="tab-ic" aria-hidden="true">${HUD_ICONS.feed}</i><span class="tab-l">Feed</span>`);
  tabMarket.onclick = () => setTab("market");
  tabBank.onclick = () => setTab("bank");
  tabFeed.onclick = () => setTab("feed");
  const tabPlant = h("button", "tab", `<i class="tab-ic" aria-hidden="true">${HUD_ICONS.plant}</i><span class="tab-l">Processing Plant</span>`);
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

  // ── RAIL-01 — the desktop collapse keys ─────────────────────────────────
  // The map is the game; the two fixed columns are instruments hung over it,
  // and the ticket that raised them asked for a way to put them away. Each
  // column gets one slim brass key on its outer edge (a child, so it rides
  // the panel's own slide and stays reachable on the folded 28px sliver the
  // stylesheet leaves on screen). The chevron points where the panel goes
  // NEXT: expanded, toward the screen edge it folds against; folded, back
  // toward the center. State lives on the root as data-rail-left /
  // data-rail-right — the stylesheet owns the whole animation off those two
  // attributes — and a phone NEVER sees any of it: railSyncViewport() clears
  // a collapse the instant the viewport crosses to the sheet regime, and the
  // phone block drops the keys outright.
  let railLeftCollapsed = false;
  let railRightCollapsed = false;
  let railSig = "\u0000";
  const railLeftBtn = h("button", "rail-toggle rail-toggle-left", "◂");
  const railRightBtn = h("button", "rail-toggle rail-toggle-right", "▸");
  railLeftBtn.id = "iso-rail-left";
  railRightBtn.id = "iso-rail-right";
  railLeftBtn.type = "button";
  railRightBtn.type = "button";
  railLeftBtn.setAttribute("aria-controls", "iso-aside-left");
  railRightBtn.setAttribute("aria-controls", "iso-aside-right");
  railLeftBtn.setAttribute("aria-label", "Toggle the Build menu panel");
  railRightBtn.setAttribute("aria-label", "Toggle the Processing Plant panel");
  left.appendChild(railLeftBtn);
  rightAside.appendChild(railRightBtn);
  /** One writer for both keys: attribute, ARIA state, chevron and title all
   *  move together, and identical states repaint nothing (resize calls this
   *  on every frame of a window drag). */
  function paintRails() {
    const sig = `${railLeftCollapsed ? 1 : 0}${railRightCollapsed ? 1 : 0}`;
    if (sig === railSig) return;
    railSig = sig;
    root.dataset.railLeft = railLeftCollapsed ? "1" : "0";
    root.dataset.railRight = railRightCollapsed ? "1" : "0";
    railLeftBtn.setAttribute("aria-expanded", String(!railLeftCollapsed));
    railRightBtn.setAttribute("aria-expanded", String(!railRightCollapsed));
    railLeftBtn.textContent = railLeftCollapsed ? "▸" : "◂";
    railRightBtn.textContent = railRightCollapsed ? "◂" : "▸";
    railLeftBtn.title = railLeftCollapsed ? "Expand the Build menu" : "Collapse the Build menu";
    railRightBtn.title = railRightCollapsed ? "Expand the Processing Plant panel" : "Collapse the Processing Plant panel";
    // The drawer cue follows the ACT of this click, so the dataset (read by
    // the sound delegation) is set for the state the click is ABOUT to enter.
    railLeftBtn.dataset.sfx = railLeftCollapsed ? "close" : "open";
    railRightBtn.dataset.sfx = railRightCollapsed ? "close" : "open";
    // A folded panel is a 28px sliver; its controls are off-viewport and must
    // leave the tab order with it — otherwise a keyboard walk lands on tabs
    // and market rows nobody can see. `inert` on the panel CONTENT (never on
    // the aside: the key lives beside the panel and stays reachable) removes
    // them from focus, pointer and AT traversal, and undoes itself on unfold.
    bp.inert = railLeftCollapsed;
    tp.inert = railRightCollapsed;
  }
  railLeftBtn.onclick = () => {
    if (isPhoneViewport()) return;
    railLeftCollapsed = !railLeftCollapsed;
    paintRails();
  };
  railRightBtn.onclick = () => {
    if (isPhoneViewport()) return;
    railRightCollapsed = !railRightCollapsed;
    paintRails();
  };
  /** RAIL-01: the sheets own the panels on a phone. Crossing the regime
   *  hands them back unfolded — called from responsiveZoom, which is the one
   *  place that already knows the regime flipped. */
  function railSyncViewport() {
    if (isPhoneViewport() && (railLeftCollapsed || railRightCollapsed)) {
      railLeftCollapsed = false;
      railRightCollapsed = false;
      paintRails();
    }
  }
  paintRails();

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
  // #187: the placement hint — one slim line, pinned above the resource bar,
  // carrying the verdict for the tool in the hand (the rule it places by, a
  // refusal, the ★ a road drag buys). It replaced a full-width two-line work
  // order that restated the tool and its price — both already on the Build
  // button — and covered the map and the build list on a phone. On a phone the
  // held-tool chip below carries the same verdict, so this pill is desktop
  // only (styles.css owns the swap; the two never show at once).
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
  // MOBILE-01: the touch-only floating cluster. A phone has no wheel and no
  // middle button, so the camera's three moves — recentre, zoom in, zoom out —
  // live here as thumbs-reach keys, and the held-tool chip gives a fingertip
  // the one thing a right-click used to be: "put the tool down".
  const fabs = h("div", "fabs");
  const zoomInBtn = h("button", "fab zoom-in", "+");
  zoomInBtn.type = "button";
  zoomInBtn.title = "Zoom in";
  zoomInBtn.setAttribute("aria-label", "Zoom in");
  zoomInBtn.onclick = () => hooks.onZoom?.(1);
  const zoomOutBtn = h("button", "fab zoom-out", "−");
  zoomOutBtn.type = "button";
  zoomOutBtn.title = "Zoom out";
  zoomOutBtn.setAttribute("aria-label", "Zoom out");
  zoomOutBtn.onclick = () => hooks.onZoom?.(-1);
  const recenterBtn = h("button", "recenter-btn", HUD_ICONS.reticle);
  recenterBtn.title = "Recenter map";
  recenterBtn.onclick = () => hooks.onRecenter();
  fabs.append(zoomInBtn, zoomOutBtn, recenterBtn);
  root.appendChild(fabs);
  // The held tool, named and droppable, while it is not the pointer. Desktop
  // keeps right-click/Q and the slim hint pill; this chip is the touch hand's
  // escape hatch — and, since #187, its verdict line too: in the phone regime
  // the desktop pill is hidden, so the one thumb-reach pill above the resource
  // bar carries the tool's name, the placement verdict and the ✕ that puts it
  // down (which now really disarms the tool, drag and ghost included).
  const toolChip = h("button", "toolchip hidden");
  toolChip.type = "button";
  toolChip.dataset.sfx = "close";
  const toolChipLabel = h("span", "tc-label");
  const toolChipHint = h("span", "tc-hint");
  const toolChipX = h("span", "tc-x", "✕");
  toolChip.append(toolChipLabel, toolChipHint, toolChipX);
  toolChip.title = "Put this tool back to the pointer";
  toolChip.onclick = () => hooks.onTool("select");
  root.appendChild(toolChip);

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
  const feedEntries: { who: string; colour: string; text: string }[] = [];
  // U1: the restored HUD paints on the game's rAF loop. Re-rendering the
  // Black-Market grid and the offer lists on every frame would detach a button
  // between its pointerdown and pointerup, so a real click could be lost.
  // Render those only when their visible content actually changed.
  // V4: banner dismissal state — paint() runs every frame, so the banner is
  // rebuilt only when its content changes and a dismissal stays dismissed.
  // BANNER-ONCE: the dismissal is remembered by the banner's stable id
  // (`dismissedBannerKey`), NOT its exact text. V4's text key let a CLOSED
  // banner return whenever the wording changed and came back — close the
  // "Dirt Road scores nothing… 0.25★ a tile" line, switch to the Road tool,
  // switch back to Dirt, and the very banner the player had just dismissed
  // was on screen again. Keyed by identity, a closed banner stays closed for
  // the rest of the game (the ❔ help still re-tells the rules).
  let lastBannerText: string | null = null;
  let lastBannerKey: string | null = null;
  /** MOBILE-01: paint gates for the held-tool chip and the banner height var. */
  let lastChipTool: string = "\u0000";
  let lastBannerH = -1;
  /** #187: the chip's verdict line, gated like every other per-frame write. */
  let lastChipHint: string | null = null;
  /**
   * #187: what the last paint put in the hand, and whether the phase MANDATES
   * a placement. The Build buttons read these to decide whether a re-tap arms
   * or cancels, and the hint's ✕ is only offered when cancelling is a move the
   * game actually has.
   */
  let armedTool: UiTool | null = null;
  let placementMandatory = false;
  let dismissedBannerKey: string | null = null;
  let lastSabKey = "\u0000";
  let lastMarketKey = "\u0000";
  /** RAIL-04: the Railway panel's repaint gate (its rows, folded to a string). */
  let lastRailKey = "\u0000";

  // ── build list: the iso tools, keeping the original Build panel layout ────
  // PP-07: every price line is READ from the one authoritative cost table
  // (BUILD_COSTS, via the TRANSPORT / DEPOT_COST / PLANT_COST aliases), never
  // typed here — the buttons state the complete cost before the first click
  // and can never drift from what the placement actually charges.
  // VP-01: the two road buttons tell the truth about points — gravel scores
  // nothing, and the only road action that does is paving over gravel you
  // already laid (which is also the cheaper of the two paved options).
  const TOOLS: { key: UiTool; label: string; sub: string }[] = [
    // The pointer goes first: it is the hand you hold between builds —
    // hover to read what a tile is, click to select it, right-click (or Q)
    // to return here from any tool.
    // MOBILE-01: "Q / right-click" is noise on a phone — the tap and the
    // held-tool chip are the touch hand's versions of the same two ideas.
    { key: "select", label: "Select", sub: coarsePointer() ? "Point & inspect · tap reads a tile" : "Point & inspect · Q / right-click" },
    { key: "dirt", label: "Dirt Road", sub: `${costMarkup(TRANSPORT.dirt.cost)} · 0★` },
    { key: "road", label: "Road", sub: `${costMarkup(TRANSPORT.road.cost)} · +${VICTORY.upgrade}★ paving dirt` },
    // PP-05: `depotSub` refreshes the Depot line below as the free-setup
    // allowance burns down.
    { key: "harvester", label: "Depot", sub: depotButtonMarkup(0) },
    // PP-06: another instance of the SAME processing building, raised beside
    // another town.
    { key: "plant", label: "Processing Plant", sub: `${costMarkup(PLANT_COST)} · next to a town` },
    // ── RAIL-04 (#178): the railway's four buttons ────────────────────────
    // The prices are read from the same table the placement charges
    // (`RAIL_COSTS`) and the point from the same constant the scoreboard pays
    // (`VICTORY.platform`, aliased in rail.ts as PLATFORM_VP).
    { key: "rail", label: "Rail", sub: `${costMarkup(RAIL_COSTS.rail)} a tile · 0★` },
    { key: "platform", label: "Platform", sub: `${costMarkup(RAIL_COSTS.platform)} · +${VICTORY.platform}★` },
    { key: "raildepot", label: "Train Depot", sub: `${costMarkup(RAIL_COSTS.depot)} · needs your rail` },
    { key: "railway", label: "Railway", sub: "Lines · trains · assign & sell" },
    { key: "demolish", label: "Demolish", sub: "Refund 50%" },
  ];
  // RAIL-05 (#182): with the flag down the four railway buttons do not exist
  // — a button the rules would refuse is a promise the HUD cannot keep.
  const visibleTools = opts.rail === false
    ? TOOLS.filter((t) => !RAIL_TOOL_KEYS.has(t.key))
    : TOOLS;
  let depotSub: HTMLElement | null = null;
  let lastDepotSub = "\u0000";
  for (const t of visibleTools) {
    // V5: each tool gets its own banner artwork class (bg-dirt / bg-road /
    // bg-harvester / bg-demolish) — they all shared bg-rail before.
    const b = h("button", "build-btn bg-" + t.key);
    b.dataset.tool = t.key;
    b.innerHTML = `<div class="bb-mid"><b>${t.label}</b><small>${t.sub}</small></div>`;
    b.onclick = () => {
      // #187: the button is its own toggle — a re-tap of the tool already in
      // the hand puts it down, the same gesture as the hint's ✕, Esc and the
      // right button, so the Build sheet is never a one-way door. Not while
      // the phase OWES a placement (the opening Factory/Depot): there is
      // nothing to cancel then, and the tap simply keeps the tool armed.
      if (t.key !== "select" && t.key === armedTool && !placementMandatory) hooks.onTool("select");
      else hooks.onTool(t.key);
    };
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
      b.innerHTML = `<div class="sab-top"><b>${s.name}</b><span class="sab-cost">${s.gold}${cargoIconHtml("gold")}</span></div>` +
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
    `The bank always trades four of one good for one of another. No rival required, no waiting. ${cargoIconHtml("gold")} ${GOLD_RULE}`));

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
      // #114: on a guest the post is a REQUEST the host must still accept —
      // say that, not "posted" (the offer exists once the host's sync says so).
      if (market.relayPending) {
        toast(`Sent to the host — the offer is live once they confirm.`, "info");
        feed(`Offer request sent: ${giveN} ${CARGO[give].name} → ${wantN} ${CARGO[want].name}`);
      } else {
        toast(`Offer posted: ${giveN} ${CARGO[give].name} → ${wantN} ${CARGO[want].name}.`, "info");
        // W6: the feed is the trade log — posting is a trade event.
        feed(`Posted ${giveN} ${CARGO[give].name} → ${wantN} ${CARGO[want].name}`);
      }
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
      // #114: a guest's bank trade is a request until the host accepts it.
      if (market.relayPending) {
        toast(`Sent to the host — the trade lands once they confirm.`, "info");
        feed(`Bank request sent: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}`);
      } else {
        toast(`Bank: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}.`, "success");
        // W6: bank trades are trades — log them even with no rival around.
        feed(`Bank: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}`);
      }
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
        <div class="offer-body"><span class="give">${o.giveN}${cargoIconHtml(o.give)}</span><span class="arrow">➜</span><span class="want">${o.wantN}${cargoIconHtml(o.want)}</span></div>`;
      const act = h("div", "offer-act");
      const b = h("button", "mini danger", "Cancel");
      b.dataset.cancel = String(o.id);
      b.onclick = () => {
        if (market.cancel(me, o.id)) {
          // #114: a guest's withdraw is a request until the host confirms.
          if (market.relayPending) toast("Withdraw request sent — waiting for the host.", "info");
          else {
            toast("Offer withdrawn, escrow refunded.", "info");
            feed(`Withdrew offer ${o.giveN} ${CARGO[o.give].name} → ${o.wantN} ${CARGO[o.want].name} (escrow refunded)`);
          }
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
      <span class="tray-body">${o.giveN}${cargoIconHtml(o.give)}<i class="arrow">➜</i>${o.wantN}${cargoIconHtml(o.want)}</span>`;
    const b = h("button", "mini" + (can ? "" : " disabled"), "Take");
    b.disabled = !can;
    b.onclick = (e) => {
      e.stopPropagation();
      if (market.accept(me, o.id)) {
        // #114: never spend, and never claim the trade, before the host has
        // validated and applied the acceptance intent.
        if (market.relayPending) toast(`Accept request sent — waiting for the host.`, "info");
        else {
          toast(`Took ${from.name}'s offer.`, "success");
          feed(`Took ${from.name}'s offer: ${o.giveN} ${CARGO[o.give].name} → ${o.wantN} ${CARGO[o.want].name}`);
        }
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
    resetIdleHint(); // #162: a tab switch is a touch — and a hint for a hidden board is pointless
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
    // MOBILE-02: the plant tab re-fits the board — the full-bleed sheet only
    // leaves a measurable slot once this pane is the visible one.
    // FIT-01: and so does the desktop — the fit clamps on the measured plant
    // column, which has no box while another tab hides it, so a window
    // resized over Market/Bank/Feed would come back to a stale board.
    // #163: this runs AFTER every pane has swapped (`.hidden` is
    // display:none), so the immediate zoom pass measures the settled sheet;
    // the board-SIZE decision itself is deferred to the next settled frame
    // (schedulePhoneFit) — measuring while the outgoing pane still shared
    // the flex space is what minted the bogus 11-column board.
    if (t === "plant") responsiveZoom();
  }

  function setMobileView(v: string) {
    if (root.dataset.view !== v) sfx.play("tab");
    root.dataset.view = v;
    mobileNav.querySelectorAll(".mnav-btn").forEach((b: Element) => {
      (b as HTMLElement).classList.toggle("active", (b as HTMLElement).dataset.view === v);
    });
    // MOBILE-02: every view change re-runs the phone fit — arriving at trade
    // gives the board its measurement pass (and tucks the top bar), leaving
    // it hands the bar back to the map and the build sheet.
    responsiveZoom();
  }

  // ── board interactions ────────────────────────────────────────────────────
  const cellFrom = (e: { clientX: number; clientY: number }): { r: number; c: number } | null =>
    cellIn(e, grid.getBoundingClientRect());
  /** The cell under a client point, against a rect the caller already read. */
  const cellIn = (e: { clientX: number; clientY: number }, rect: DOMRect): { r: number; c: number } | null => {
    // MOBILE-02: measured against the LIVE board rectangle — the phone board
    // may carry more columns than the shipped 7×8, and a restored save may
    // carry whatever the session it came from was sized to.
    const cw = rect.width / board.w, ch = rect.height / board.h;
    const c = Math.floor((e.clientX - rect.left) / cw);
    const r = Math.floor((e.clientY - rect.top) / ch);
    if (r < 0 || r >= board.h || c < 0 || c >= board.w) return null;
    return { r, c };
  };
  const adj = (a: { r: number; c: number }, b: { r: number; c: number }) =>
    Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

  const selectOrSwap = (cell: { r: number; c: number }) => {
    resetIdleHint(); // #162: any tap is a touch — the idle hint stands down
    if (selected && adj(selected, cell)) {
      // SFX-01: a soft thud as the gem settles — the board's own `bad` fx
      // answers a swap that did not match, so this one is deliberately
      // neutral, just the gesture, then the verdict.
      sfx.play("swap");
      // #163: the player has played into the board — any session-added
      // rows/columns are earned now and the fit becomes grow-only.
      markBoardPlayed();
      noteSwap(selected.r, selected.c, cell.r, cell.c);
      hooks.onSwap(selected.r, selected.c, cell.r, cell.c);
      selected = null;
    } else {
      // …and a soft thud when a gem is picked up. The grid opts out of
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
  // MOBILE-02: a board tap puts the top bar away if it is standing — the
  // player's hand is on the gems, and the bar only covered the tab strip.
  grid.addEventListener("pointerdown", () => {
    if (topbarTucks() && !top.classList.contains("tucked")) {
      window.clearTimeout(topTuckTimer);
      top.classList.add("tucked");
    }
  });

  // Click is the touch/desktop picker path (and what the e2e/unit tests drive).
  grid.addEventListener("click", (e) => {
    // TACTILE-01: a press that became a drag already swapped (or sprang back);
    // the click the browser fires after it must not also pick a gem.
    if (swallowClick) { swallowClick = false; return; }
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".gem");
    if (b?.dataset.r && b?.dataset.c) {
      selectOrSwap({ r: Number(b.dataset.r), c: Number(b.dataset.c) });
      return;
    }
    const cell = cellFrom(e);
    if (cell) selectOrSwap(cell);
  });
  // ── TACTILE-01: the board answers the hand ────────────────────────────────
  // Hover: the gem under a mouse leans a few px toward the cursor. Press and
  // drag (mouse or touch): the picked-up gem follows along the ONE axis being
  // pulled — the four directions a gem can trade in — while the neighbour it
  // would trade with gives way AND lights up as the previewed target.
  // #162: NOTHING commits mid-gesture — the swap is decided on RELEASE. Past
  // half a cell toward an open neighbour the swap commits; both gems then
  // ease from wherever the hand left them into their cells and settle with a
  // small wobble. Short of that, dragged back, cancelled, or aimed at a wall,
  // the gems spring home and no move is spent.
  // renderBoard owns each gem's inline `transform` (its cell); everything here
  // rides the independent `translate` property, so the two never fight.
  const reduceMotion = typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** Hover lean at the very edge of the cell, in grid px. */
  const LEAN_PX = 3;
  /** Client px a press must travel before it counts as a drag (not a click). */
  const DRAG_START_PX = 5;
  /** Grid px pulled along the axis before a release commits the swap (#162:
   *  the hand's travel, not the gem's — the gem trails at 0.8×). */
  const COMMIT_PX = CELL * 0.5;
  /** The release glide (`.gem.gliding` in styles.css) runs at the board's own
   *  swap pace — turbo-aware, like the `--gem-move-ms` var it eases under —
   *  so the DOM never lags the logic it just triggered. */
  const glideMs = () => (turboMode ? FAST_ANIMATION_MS.swap : BOARD_ANIMATION_MS.swap);
  const SETTLE_MS = 300;
  /** Ms with no board touch before one valid pair pulses as a hint. */
  const IDLE_HINT_MS = 6000;
  /** How long the idle hint stays on the board before it clears. */
  const HINT_SHOW_MS = 1600;
  type Cell = { r: number; c: number };
  interface Drag {
    from: Cell; el: HTMLElement; gemId: number;
    pointerId: number; x0: number; y0: number; active: boolean; peer: HTMLElement | null;
    /** The live preview, refreshed by every pointermove: the locked axis, the
     *  hand's pull along it in grid px, the targeted cell and whether a swap
     *  there is legal. The release decision reads THIS, never the event. */
    horiz: boolean; pull: number; to: Cell | null; open: boolean;
  }
  let drag: Drag | null = null;
  let leaning: HTMLElement | null = null;
  let swallowClick = false;

  /** Client px → grid px (the board panel is zoomed to fit its column). */
  const toLocal = () => (CELL * board.w) / (grid.getBoundingClientRect().width || CELL * board.w);
  const baseOf = (el: HTMLElement): [number, number] =>
    [Number(el.dataset.c) * CELL + 3, Number(el.dataset.r) * CELL + 3];
  const offsetOf = (el: HTMLElement): [number, number] => {
    const [x = "0", y = "0"] = el.style.translate.split(" ");
    return [parseFloat(x) || 0, parseFloat(y) || 0];
  };
  const setOffset = (el: HTMLElement, horiz: boolean, px: number) => {
    el.style.translate = horiz ? `${px}px 0px` : `0px ${px}px`;
  };
  const unlean = () => {
    if (leaning && !leaning.classList.contains("dragging")) leaning.style.translate = "";
    leaning = null;
  };

  /**
   * Ease `el` from the screen spot it was last seen at (`sx`,`sy`, grid px)
   * into its CURRENT cell. When the board took the swap, renderBoard has
   * already moved the base; when it refused (busy, fogged, a guest's board),
   * the base is unchanged and the same glide is a spring back home.
   */
  function glide(el: HTMLElement, sx: number, sy: number, shake: boolean) {
    el.classList.remove("dragging", "yielding");
    const [bx, by] = baseOf(el);
    el.style.transition = "none";
    el.style.transform = `translate(${bx}px, ${by}px)`;
    el.style.translate = `${sx - bx}px ${sy - by}px`;
    void el.offsetWidth; // commit the jump before the transition resumes
    el.style.transition = "";
    // Only a release eases `translate`; hover and held gems follow the pointer.
    el.classList.add("gliding");
    el.style.translate = "";
    const ms = glideMs();
    window.setTimeout(() => el.classList.remove("gliding"), ms);
    // A wobble is a celebration for a settled swap — fast play (turbo) and
    // reduced motion both skip it.
    if (!shake || reduceMotion || turboMode) return;
    window.setTimeout(() => {
      el.classList.remove("settle");
      void el.offsetWidth;
      el.classList.add("settle");
      window.setTimeout(() => el.classList.remove("settle"), SETTLE_MS);
    }, Math.max(0, ms - 60));
  }

  /** Snapshot where each gem is on screen, run `act`, then glide them all. */
  function releaseGems(d: Drag, act: () => void, shake: boolean) {
    const els = d.peer ? [d.el, d.peer] : [d.el];
    const seen = els.map((el) => {
      const [bx, by] = baseOf(el), [tx, ty] = offsetOf(el);
      return [bx + tx, by + ty] as const;
    });
    act();
    els.forEach((el, i) => glide(el, seen[i][0], seen[i][1], shake));
  }

  // ── #162: invalid-swap shake + idle hint ─────────────────────────────────
  // Every swap the player commits (tap or drag) is queued here in commit
  // order. The board answers a dud with `onFx("bad")` and a match with pops;
  // `fx()` below shakes the dud's two gems and drops matched entries, so an
  // invalid swap reads as "not allowed" instead of nothing happening — with
  // no board change at all (the wire already carries everything this needs).
  const pendingSwaps: { r1: number; c1: number; r2: number; c2: number }[] = [];
  const SHAKE_MS = 260;
  function shakeCells(a: Cell, b: Cell) {
    if (reduceMotion) return;
    for (const cell of [a, b]) {
      const g = board.grid[cell.r]?.[cell.c];
      const el = g ? gemEls.get(g.id) : undefined;
      if (!el) continue;
      el.classList.remove("shake");
      void el.offsetWidth;
      el.classList.add("shake");
      window.setTimeout(() => el.classList.remove("shake"), SHAKE_MS + 30);
    }
  }
  /** A dud landed: shake its two gems (or nothing, if they are gone). */
  function shakePendingSwap() {
    const s = pendingSwaps.shift();
    if (s) shakeCells({ r: s.r1, c: s.c1 }, { r: s.r2, c: s.c2 });
  }
  /** A match resolved: every older commit was legal, drop them all. */
  function clearPendingSwaps() {
    pendingSwaps.length = 0;
  }
  function noteSwap(r1: number, c1: number, r2: number, c2: number) {
    pendingSwaps.push({ r1, c1, r2, c2 });
    if (pendingSwaps.length > 8) pendingSwaps.shift(); // same cap as the board's queue
  }

  let idleTimer = 0;
  let hintEls: HTMLElement[] = [];
  function clearHint() {
    for (const el of hintEls) el.classList.remove("hint");
    hintEls = [];
  }
  /** One valid pair pulses gently — the board teaching its own grammar. */
  function showIdleHint() {
    idleTimer = 0;
    // A hint is for a quiet, visible, idle board — never mid-gesture, never
    // mid-cascade, never under the cross chooser, never on another tab.
    if (document.hidden || drag || board.busy || pickEl || qp.classList.contains("hidden")) {
      armIdleHint();
      return;
    }
    const mv = board.findMove();
    if (!mv) { armIdleHint(); return; } // deadlocked — the guard reshuffles, not us
    const els: HTMLElement[] = [];
    for (const [r, c] of [[mv[0], mv[1]], [mv[2], mv[3]]] as const) {
      const g = board.grid[r]?.[c];
      const el = g ? gemEls.get(g.id) : undefined;
      if (el) els.push(el);
    }
    if (els.length === 2) {
      clearHint();
      hintEls = els;
      for (const el of els) el.classList.add("hint");
      window.setTimeout(() => { clearHint(); armIdleHint(); }, HINT_SHOW_MS);
    } else {
      armIdleHint();
    }
  }
  function armIdleHint() {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(showIdleHint, IDLE_HINT_MS);
  }
  function resetIdleHint() {
    clearHint();
    armIdleHint();
  }

  grid.addEventListener("pointerdown", (e) => {
    swallowClick = false;
    // #162: a second finger voids the gesture — the held gems spring back
    // and the new press is ignored (its tap must not select mid-void).
    if (drag) {
      cancelDrag();
      swallowClick = true;
      return;
    }
    if (e.button !== 0) return;
    const from = cellFrom(e);
    const g = from ? board.grid[from.r]?.[from.c] : null;
    const el = g ? gemEls.get(g.id) : undefined;
    if (!from || !g || !el || g.block) return;
    unlean();
    resetIdleHint();
    // #162: the pickup is ON PRESS, not after 5px of travel — the gem lifts
    // under the finger the instant it is touched (a tap flashes it, then the
    // click handler below owns the selection).
    el.classList.remove("gliding");
    el.classList.add("dragging");
    drag = {
      from, el, gemId: g.id, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY,
      active: false, peer: null, horiz: true, pull: 0, to: null, open: false,
    };
  });

  grid.addEventListener("pointermove", (e) => {
    if (!drag) {
      // hover lean — a mouse only; a finger has no hover to answer
      if (reduceMotion || e.pointerType !== "mouse") return;
      // Read the geometry ONCE, before any style write, so the lean never
      // forces a second layout inside the same event.
      const rect = grid.getBoundingClientRect();
      const k = (CELL * board.w) / (rect.width || CELL * board.w);
      const cell = cellIn(e, rect);
      const g = cell ? board.grid[cell.r]?.[cell.c] : null;
      const el = g && !g.block ? gemEls.get(g.id) ?? null : null;
      if (el !== leaning) unlean();
      if (!el || !cell) return;
      const lean = (v: number) => Math.max(-1, Math.min(1, v / (CELL / 2))) * LEAN_PX;
      const lx = (e.clientX - rect.left) * k - (cell.c + 0.5) * CELL;
      const ly = (e.clientY - rect.top) * k - (cell.r + 0.5) * CELL;
      el.style.translate = `${lean(lx)}px ${lean(ly)}px`;
      leaning = el;
      return;
    }
    if (e.pointerId !== drag.pointerId) return;
    // #162: leaving the board voids the gesture — with pointer capture the
    // moves keep arriving, so the bounds check does what pointerleave would.
    const rect = grid.getBoundingClientRect();
    if (rect.width > 0 && (e.clientX < rect.left || e.clientX > rect.right
      || e.clientY < rect.top || e.clientY > rect.bottom)) {
      cancelDrag();
      swallowClick = true;
      return;
    }
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active && Math.hypot(dx, dy) < DRAG_START_PX) return;
    const k = toLocal();   // geometry first, before the class/style writes below
    if (!drag.active) {
      drag.active = true;
      try { grid.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      sfx.play("select");
    }
    const horiz = Math.abs(dx) >= Math.abs(dy);
    const pull = (horiz ? dx : dy) * k;
    const dir = Math.sign(pull);
    const to = { r: drag.from.r + (horiz ? 0 : dir), c: drag.from.c + (horiz ? dir : 0) };
    const tg = dir ? board.grid[to.r]?.[to.c] : null;
    const open = !!tg && !tg.block;
    // The release decision reads this preview — the move only stores it.
    drag.horiz = horiz; drag.pull = pull; drag.to = to; drag.open = open;
    const peer = open ? gemEls.get(tg.id) ?? null : null;
    if (peer !== drag.peer) {
      if (drag.peer) { drag.peer.style.translate = ""; drag.peer.classList.remove("yielding"); }
      drag.peer = peer;
      // `.yielding` IS the target highlight (styles.css): the neighbour the
      // release would trade with glows while the preview holds it.
      peer?.classList.add("yielding");
    }
    // A little resistance: the gem trails the hand, and a wall (the board
    // edge, a chained block) rubber-bands a few px and offers no target.
    const travel = open ? Math.min(Math.abs(pull), CELL) * 0.8 : Math.min(Math.abs(pull) * 0.15, 10);
    const off = dir * travel;
    // reset the cross axis too, so flicking between directions never leaves a diagonal
    setOffset(drag.el, horiz, off);
    if (peer) setOffset(peer, horiz, -off * 0.45);
    // #162: NO commit here — the swap is decided on release (commitDrag),
    // so the hand can change its mind until the very last pixel.
  });

  // #162: release DECIDES. Past the threshold toward an open neighbour the
  // swap commits; short of it — or dragged back, or aimed at a wall — the
  // gems spring home and no move is spent. The gem-identity check is the
  // cascade guard: if gravity carried the held gem away mid-preview (a drag
  // drawn during a running cascade), the stale cells do NOT swap.
  const commitDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    if (!d.active) {
      // a plain press — drop the pickup flash, the click handler owns it
      d.el.classList.remove("dragging");
      return;
    }
    swallowClick = true;
    const held = board.grid[d.from.r]?.[d.from.c];
    const commit = d.open && d.to !== null && Math.abs(d.pull) >= COMMIT_PX
      && held?.id === d.gemId;
    if (!commit || !d.to) {
      releaseGems(d, () => {}, false);
      return;
    }
    const to = d.to;
    releaseGems(d, () => {
      sfx.play("swap");
      markBoardPlayed();   // #163: a drag swap earns the grown band too
      noteSwap(d.from.r, d.from.c, to.r, to.c);
      hooks.onSwap(d.from.r, d.from.c, to.r, to.c);
      selected = null;
      renderSelection();
      resetIdleHint();
    }, true);
  };
  /** Void the gesture unconditionally: spring back, never commit. */
  function cancelDrag() {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.active) {
      d.el.classList.remove("dragging");
      return;
    }
    releaseGems(d, () => {}, false);
  }
  const cancelDragEvent = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const wasActive = drag.active;
    cancelDrag();
    if (wasActive) swallowClick = true;
  };
  window.addEventListener("pointerup", commitDrag);
  window.addEventListener("pointercancel", cancelDragEvent);
  grid.addEventListener("pointerleave", () => { if (!drag) unlean(); });
  // A hidden tab voids the gesture too — the hand is gone, and a `.dragging`
  // gem must never survive the layout it was held in. No click follows, so
  // the swallow flag stays untouched; the hint re-arms on return.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { cancelDrag(); clearHint(); }
    else armIdleHint();
  });

  function renderSelection() {
    gemEls.forEach((elem) => elem.classList.remove("sel", "neighbor"));
    if (!selected) return;
    const g = board.grid[selected.r]?.[selected.c];
    if (!g) return;
    gemEls.get(g.id)?.classList.add("sel");
    // #162: the tap path names its legal answers — every open orthogonal
    // neighbour of the selection glows faintly, so the second tap is never a
    // guess. Blocked cells stay dark: they cannot be traded with.
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const n = board.grid[selected.r + dr]?.[selected.c + dc];
      if (n && !n.block) gemEls.get(n.id)?.classList.add("neighbor");
    }
  }

  function styleGem(elem: HTMLElement, g: Gem) {
    const face = elem.querySelector(".face") as HTMLElement;
    const icon = elem.querySelector(".icon") as HTMLElement;
    const badge = elem.querySelector(".badge") as HTMLElement;
    // #162: a re-style must never strip a live gesture — `renderBoard`
    // re-styles EVERY gem on EVERY change (a lorry's token, a sabotage
    // frost, a cascade refill), and any of those can land mid-drag. The
    // transient animation states survive; `.sel`/`.neighbor` are re-applied
    // by renderSelection below, and `.hint` is deliberately dropped (a
    // changed board voids the old hint; the idle timer re-arms its own).
    const keep = ["dragging", "yielding", "gliding", "settle", "shake", "falling"]
      .filter((c) => elem.classList.contains(c));
    elem.className = "gem res-" + g.res;
    for (const c of keep) elem.classList.add(c);
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
    // #163: notice a board REPLACED under the chrome (restored save, host
    // multiplayer sync) so its rectangle becomes the sacred floor the fit
    // never shrinks below — before the layout box is synced below.
    noteBoardProvenance();
    // MOBILE-02: keep the layout box honest every pass. The board can be
    // REPLACED under the chrome without a resize — a save restored by game.ts
    // (a rectangle saved on another device), a multiplayer sync that ships
    // the host's whole grid — and those paths only know to call renderBoard.
    applyGridSize();
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
        // #162: refills drop in from above the board — staged above their
        // cell for one frame, then eased home with the fall. Skipped under
        // turbo (the remnant is the juice there) and reduced motion.
        if (g.isNew && !turboMode && !reduceMotion) {
          elem.style.transform = `translate(${x}px, ${y - CELL * 3}px)`;
          grid.appendChild(elem);
          gemEls.set(g.id, elem);
          styleGem(elem, g);
          const el = elem, homeX = x, homeY = y;
          const fallMs = BOARD_ANIMATION_MS.fall;
          el.style.setProperty("--fall-ms", `${fallMs}ms`);
          el.classList.add("falling");
          requestAnimationFrame(() => {
            el.style.transform = `translate(${homeX}px, ${homeY}px)`;
            window.setTimeout(() => {
              el.classList.remove("falling");
              el.style.removeProperty("--fall-ms");
            }, fallMs + 40);
          });
        } else {
          elem.style.transform = `translate(${x}px, ${y}px)`;
          grid.appendChild(elem);
          gemEls.set(g.id, elem);
          styleGem(elem, g);
        }
      } else {
        // #162: a gem that FELL reads as falling — its drop eases with
        // gravity and lands with a small bounce, longer drops taking longer
        // (capped at the board's own fall wait, so the DOM never outruns the
        // logic). Sideways steps (swaps) keep the swap easing instead.
        const oldR = Number(elem.dataset.r), oldC = Number(elem.dataset.c);
        const dist = g.r - oldR;
        const fell = !turboMode && !reduceMotion && oldC === g.c && dist > 0;
        elem.dataset.r = String(g.r);
        elem.dataset.c = String(g.c);
        elem.style.transform = `translate(${x}px, ${y}px)`;
        styleGem(elem, g);
        if (fell) {
          const fallMs = BOARD_ANIMATION_MS.fall;
          elem.style.setProperty("--fall-ms", `${Math.min(fallMs, 45 + dist * 25)}ms`);
          elem.classList.add("falling");
          const el = elem;
          window.setTimeout(() => {
            el.classList.remove("falling");
            el.style.removeProperty("--fall-ms");
          }, fallMs + 40);
        }
      }
      g.isNew = false;
    }
    gemEls.forEach((elem, id) => {
      if (!present.has(id)) {
        if (turboMode) {
          // Issue #152: the live gem is yanked at once so the refill can
          // drop in, and a ghost of it is left on the cell to flash and
          // dissolve in the background — the payoff the player would
          // otherwise never see at turbo speed.
          spawnRemnant(elem);
          elem.remove();
        } else {
          elem.classList.add("gone");
          setTimeout(() => elem.remove(), BOARD_ANIMATION_MS.clear);
        }
        gemEls.delete(id);
      }
    });
    const combo = board.comboCount;
    setCombo(combo, Board.COMBOS_PER_GOLD);
    renderSelection();
  }

  /** Issue #152 — clone a cleared gem into an inert `.gem-remnant` that
   *  fades out where the gem stood. Selection / drag state is stripped so
   *  the ghost is only ever the token's face. */
  function spawnRemnant(src: HTMLElement) {
    const ghost = src.cloneNode(true) as HTMLElement;
    ghost.className = `gem-remnant ${src.className}`
      .replace(/\b(sel|selected|dragging|yielding|gliding|settle|gone)\b/g, "")
      .replace(/\s+/g, " ").trim();
    ghost.removeAttribute("data-id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("tabindex", "-1");
    ghost.style.translate = "";
    ghost.style.transform = src.style.transform;
    grid.appendChild(ghost);
    // Two frames in the DOM at rest, then the fade — the transition needs
    // a start state to run from.
    requestAnimationFrame(() => requestAnimationFrame(() => ghost.classList.add("fade")));
    setTimeout(() => ghost.remove(), REMNANT_MS + 40);
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
    // #162: the verdict on the player's commits. A dud ("bad") shakes the
    // two gems of the oldest unanswered swap; any pop, callout or blessing
    // proves a match resolved and retires every older commit with it.
    if (type === "bad") shakePendingSwap();
    else if (type === "pop" || type === "chain" || type === "combo"
      || type === "cross" || type === "bcross" || type === "boom") clearPendingSwaps();
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
  // any mix). Confirmation requires the full allocation. There is no timer:
  // the panel and paused cascade wait until the player explicitly confirms.
  // Outside clicks/tab switches cannot dismiss it. Queue additional choices
  // rather than auto-answering and replacing an unfinished allocation.
  // #185 restyled the plate into the house language — shared `.panel`
  // treatment over a light board dim, chip-dark cargo tiles, and the dialog
  // `.big-btn` as the confirm. None of the flow above changed.
  let pickEl: HTMLElement | null = null;
  const pickQueue: { kind: "holy" | "broken"; picks: number; pick: (chosen: ResKey[]) => void }[] = [];

  function crossPick(kind: "holy" | "broken", picks: number, pick: (chosen: ResKey[]) => void) {
    if (pickEl) {
      pickQueue.push({ kind, picks, pick });
      return;
    }
    const pickCounts = new Map<ResKey, number>();
    const total = () => [...pickCounts.values()].reduce((a, b) => a + b, 0);
    const expand = () => {
      const chosen: ResKey[] = [];
      for (const [res, n] of pickCounts) for (let i = 0; i < n; i++) chosen.push(res);
      return chosen;
    };
    const holy = kind === "holy";
    // #185: the plate is the house plate. It wears the shared `.panel`
    // treatment (felt, glass gradient, brass keyline, `--r`) exactly like the
    // Bank, Market and build panels, and it rides a light dim — the modal
    // sheets' `.modal-back` idea, sized to the board rather than the window.
    // The dim swallows clicks aimed at the board (which is paused anyway) and
    // carries no handler of its own: outside clicks still cannot dismiss it.
    // No emoji anywhere in the markup; the title is the ledger kicker over an
    // engraved display-face name sealed with the stroke-SVG cross.
    const back = h("div", "cross-pick-back");
    const panel = h("div", `cross-pick panel${holy ? "" : " broken"}`);
    const head = h("div", "cross-pick-head");
    head.appendChild(h("div", "cross-pick-kicker", "Blessing"));
    head.appendChild(h(
      "div", "cross-pick-title",
      `${ICON_CROSS}<span>${holy ? "Holy Cross" : "Broken Cross"}</span>`,
    ));
    panel.appendChild(head);
    panel.appendChild(h("div", "cross-pick-sub", `Spend ${picks} bounties · repeats allowed`));
    const row = h("div", "cross-pick-row");
    const count = h("div", "cross-pick-count", `0 / ${picks} spent`);
    // #185: the confirm is the game's primary action button — the brass
    // "sign here" plate of the dialogs, class and all.
    const confirm = h("button", "cross-pick-confirm big-btn", `Bless +${picks}`);
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
      // #185: the cargo's own two colours ride along as `--c1/--c2` — the
      // tile reads chip-dark like the purse's, and the colour lives in its
      // painted gem token and the assay line struck under it.
      b.style.setProperty("--c1", CARGO[cargo].c1);
      b.style.setProperty("--c2", CARGO[cargo].c2);
      b.innerHTML = `${cargoIconHtml(cargo, "cargo-ic cargo-ic-lg")}<span>+1</span>`;
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
    confirm.onclick = () => {
      if (pickEl !== back || total() !== picks) return;
      const chosen = expand();
      back.remove();
      pickEl = null;
      pick(chosen);
      const next = pickQueue.shift();
      if (next) crossPick(next.kind, next.picks, next.pick);
    };
    panel.appendChild(row);
    panel.appendChild(count);
    panel.appendChild(confirm);
    back.appendChild(panel);
    boardWrap.appendChild(back);
    pickEl = back;
  }

  /** #112: close the chooser and drain any queued ones without answering. */
  function crossCancel() {
    pickQueue.length = 0;
    pickEl?.remove();
    pickEl = null;
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
      const icon = cargo ? cargoIconHtml(cargo) : RES[k as ResKey].icon;
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
  // STORY-01: the guide's standing face — the calm quadrant of her sheet —
  // for the office beats that arrive without a mood of their own.
  const rivalWireGuideFace = faceOf("mabel", "calm");
  /** STORY-01: the rival seat's dossier face for this match (paint sets it). */
  let rivalFaceOverride: { url: string; pos: readonly [number, number] | null } | null = null;

  const paintRivalryBeat = (beat: UiRivalryBeat) => {
    const yours = beat.speaker === "you";
    const guide = beat.speaker === "guide";
    rivalWire.dataset.speaker = beat.speaker;
    rivalWire.classList.toggle("you-speaking", yours);
    rivalWire.classList.toggle("guide-speaking", guide);
    // STORY-01: a beat may carry the exact face it speaks with — an
    // expression quadrant off the campaign's painted sheets (uniform 2×,
    // never stretched) — and the wire wears it for as long as the beat
    // stands. Without one, the speaker's standing mugshot returns.
    if (beat.face) {
      rivalWireFace.style.backgroundImage = `url(${beat.face.url})`;
      if (beat.face.pos) {
        rivalWireFace.style.backgroundSize = "200% 200%";
        rivalWireFace.style.backgroundPosition = `${beat.face.pos[0]}% ${beat.face.pos[1]}%`;
      } else {
        rivalWireFace.style.backgroundSize = "cover";
        rivalWireFace.style.backgroundPosition = "center 20%";
      }
    } else {
      const standing = yours ? rivalWirePlayerPortrait : guide ? rivalWireGuideFace.url : portraitTorvin;
      rivalWireFace.style.backgroundImage = `url(${standing})`;
      rivalWireFace.style.backgroundSize = guide ? "200% 200%" : "cover";
      rivalWireFace.style.backgroundPosition = guide
        ? `${rivalWireGuideFace.pos?.[0] ?? 0}% ${rivalWireGuideFace.pos?.[1] ?? 0}%`
        : "center 20%";
    }
    rivalWireLabel.textContent = beat.label
      ?? (yours ? "You · Open channel" : guide ? "Office · Mabel Quill" : "Rival · Private wire");
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
    // Doubled: the exchange was going past faster than anyone could read it,
    // and it is dialogue — the whole point of it is to be read. Every term of
    // the old formula is 2x, so a short jab still clears sooner than a long
    // one instead of everything sitting at the cap.
    const readingTime = Math.min(8_400, Math.max(4_800, 2_600 + beat.text.length * 60));
    window.setTimeout(() => {
      rivalWire.classList.remove("show");
      rivalWire.classList.add("leaving");
      window.setTimeout(showNextRivalryBeat, 220);
    }, readingTime);
  };

  function rivalQuip(beats: readonly UiRivalryBeat[]) {
    if (!beats.length) return;
    // MOBILE-02: on a phone the private wire is OFF — its card stood between
    // the player and the board and the window has no rows to spare. Nothing
    // is lost from the record: game.ts has already written every beat into
    // the Feed tab, which is where gossip belongs on a screen this small.
    if (isPhoneViewport()) return;
    rivalWireQueue.push(...beats);
    // A sabotage toast is normally appended just before this call. Move the
    // wire to the lane's end so the messages stack in reading order.
    toasts.appendChild(rivalWire);
    if (!rivalWireBusy) showNextRivalryBeat();
  }

  /**
   * MOBILE-02: the grid's LAYOUT box always matches the board it carries.
   * Gems stay drawn at the shipped CELL (80px) with their `translate`
   * positions; `zoom` on the wrap is the only scaling — so one width write
   * covers a grown board, a restored save, and the plain 7×8 alike.
   */
  function applyGridSize() {
    grid.style.width = CELL * board.w + "px";
    grid.style.height = CELL * board.h + "px";
    grid.style.setProperty("--gem", (CELL - 6) + "px");
  }

  /**
   * #163 — settled phone board sizing.
   *
   * The board may GROW beyond its shipped rectangle ONLY from a SETTLED
   * measurement of the visible plant slot: never from the box a tab switch
   * exposes for the instant between un-hiding the plant pane and hiding the
   * outgoing one. That transient wide-but-short box (full width, a sliver of
   * height) drove `cell` to its 30px floor, made `availW / cell` ask for the
   * 11-column maximum, and — because the fit was grow-only — stuck for the
   * rest of the match, shrinking every gem into a band.
   *
   * `paintZoom` below is safe on every pass (zoom is never sticky), but the
   * size decision lives here: it runs a frame after every tab/view/resize
   * pass and from a ResizeObserver on the slot, both of which only ever
   * report post-layout boxes. Comfort and aspect guards mean even a settled
   * but too-small slot earns zoom, never extra columns; a session-added
   * band stays retractable until the player has played into it, while the
   * shipped size, restored saves and host-authored boards are sacred.
   *
   * #188 — and ONE settled box decides ONE rectangle. The settled measurement
   * was necessary but not sufficient on its own: `Board.setSize` repaints the
   * chrome through the game's `onChange`, and that repaint promoted the
   * chrome's own grow to the baseline, so every LATER settled pass measured
   * from a bigger board and grew again. Each Plant round-trip therefore added
   * two rows in portrait (7×8 → 7×10 → 7×11) and two COLUMNS in a landscape
   * slot (7×8 → 9×8 → 11×8 → 13×8 …), which walks exactly into the 11-column
   * board that no longer fits — the bug #163 was supposed to have closed.
   * Two guards close it for good: the rectangle is claimed BEFORE `setSize`,
   * so a repaint cannot mistake the chrome for a host; and a box this fit has
   * already answered can never decide again, so a tab switch cannot resize
   * the board even when the measurement jitters by a pixel.
   */
  const PHONE_GROW_MAX = 2;       // at most +2 columns / +2 rows over baseline
  const PHONE_MIN_CELL = 30;      // added cells must render at least this big
  const PHONE_MAX_CELL = 92;      // never upscale gems past this on-screen size
  const PHONE_SLOT_PAD_W = 14;    // felt breathing room around the board
  const PHONE_SLOT_PAD_H = 10;
  // The floor the fit never shrinks under: the live rectangle at mount, and
  // any replacement noticed by noteBoardProvenance (restored save / host
  // sync). Growth is always measured relative to THIS, not to 7×8.
  let baseBoardW = board.w;
  let baseBoardH = board.h;
  let knownBoardW = board.w;
  let knownBoardH = board.h;
  // A band this chrome itself added stays retractable until the player's
  // first swap lands; afterwards the board is grow-only for the session.
  let boardPlayed = false;
  let fitFrameQueued = false;
  // #188: the settled slot box the live rectangle was last DECIDED from, as
  // `"<w>x<h>"`. Empty until a real decision has been made. A tab switch
  // cannot move the slot, so a pass that measures the box one has already
  // answered must not touch the board at all — that is what makes "switching
  // tabs never resizes the board" a structural fact instead of an arithmetic
  // coincidence that only holds while the measured box holds still to the
  // pixel. Only a genuinely different settled box re-opens the decision.
  let settledSlotKey = "";

  /** Adopt an externally-authored rectangle (restore / host) as the floor. */
  function noteBoardProvenance() {
    if (board.w === knownBoardW && board.h === knownBoardH) return;
    baseBoardW = knownBoardW = board.w;
    baseBoardH = knownBoardH = board.h;
    boardPlayed = false;
    // #188: a REPLACED board earns one fresh settled look at the slot it now
    // lives in — its rectangle, not the one this chrome last answered for,
    // is what the next decision must be measured against.
    settledSlotKey = "";
  }

  /** Lock in any session-added band: the player has swapped into the board. */
  function markBoardPlayed() {
    boardPlayed = true;
  }

  /**
   * The rectangle the settled slot asks for, from its ASPECT RATIO: one
   * shared cell size fills the limiting axis of the BASELINE board, and
   * each axis then spends its own slack at that cell — a portrait slot adds
   * rows, a landscape one adds columns, never 4 columns and 0 rows off a
   * squashed height. Growth is capped at +2 per axis and switches off
   * entirely the moment the baseline board itself would not render at the
   * 30px comfortable floor (that slot gets zoom, not columns).
   */
  function phoneBoardTarget(slotW: number, slotH: number): { w: number; h: number } {
    const availW = slotW - PHONE_SLOT_PAD_W;
    const availH = slotH - PHONE_SLOT_PAD_H;
    const fillCell = Math.floor(Math.min(availW / baseBoardW, availH / baseBoardH));
    if (fillCell < PHONE_MIN_CELL) return { w: baseBoardW, h: baseBoardH };
    const cell = Math.min(PHONE_MAX_CELL, fillCell);
    const w = Math.min(baseBoardW + PHONE_GROW_MAX,
      Math.max(baseBoardW, Math.floor(availW / cell)));
    const h = Math.min(baseBoardH + PHONE_GROW_MAX,
      Math.max(baseBoardH, Math.floor(availH / cell)));
    return { w, h };
  }

  /** The deferred, settled half of the phone fit. */
  function settlePhoneFit() {
    fitFrameQueued = false;
    if (isPhoneViewport()
      && root.dataset.view === "trade"
      && !qp.classList.contains("hidden")) {
      const slotW = boardSlot.clientWidth;
      const slotH = boardSlot.clientHeight;
      if (slotW > 100 && slotH > 100) {
        // #188: ONE settled box decides ONE rectangle. A tab switch cannot
        // move the slot, so a pass that re-measures a box this fit has
        // already answered must leave the board alone — however many times
        // the pane is un-hidden, and to the pixel. Only a different settled
        // box (a real resize, a rotation, the chrome coming or going) earns
        // a new decision. `paintZoom` below still runs on every pass: zoom
        // is reversible and always has to answer the CURRENT box.
        const boxKey = `${slotW}x${slotH}`;
        if (boxKey !== settledSlotKey) {
          settledSlotKey = boxKey;
          const { w: wantW, h: wantH } = phoneBoardTarget(slotW, slotH);
          const curW = board.w, curH = board.h;
          // Before the first swap a session-added band is advisory: a settled
          // slot that no longer fits it retracts the extra rows/columns. Once
          // played into, the board is grow-only; the baseline can never be
          // asked to shrink either way, and the game vetoes every resize it
          // does not own (a multiplayer guest's host-authored grid).
          const fitW = boardPlayed ? Math.max(curW, wantW) : wantW;
          const fitH = boardPlayed ? Math.max(curH, wantH) : wantH;
          if ((fitW !== curW || fitH !== curH)
            && (hooks.requestBoardSize?.(fitW, fitH) ?? true)) {
            // #188: CLAIM the rectangle before it lands. `Board.setSize` fires
            // the game's `onChange` → `renderBoard` synchronously, and
            // `noteBoardProvenance` would read the chrome's OWN grow as an
            // externally-authored board and promote it to the floor. Every
            // later pass then measured from the promoted base and grew again
            // — +2 rows on each tab round-trip in portrait, and +2 COLUMNS on
            // each round-trip in a landscape slot (7 → 9 → 11 → 13 …), which
            // is the 11-column board #188 reported and the reason the +2 cap
            // did not hold. Claiming first keeps the shipped (or restored)
            // baseline the yardstick for the whole session.
            knownBoardW = fitW;
            knownBoardH = fitH;
            board.setSize(fitW, fitH);
            boardPlayed = false;   // the fresh band is unplayed until a swap
            applyGridSize();
            renderBoard();
          }
        }
      }
    }
    paintZoom();
  }

  /** Ask for the settled pass on the next frame (idempotent per frame). */
  function schedulePhoneFit() {
    if (fitFrameQueued || typeof requestAnimationFrame !== "function") return;
    fitFrameQueued = true;
    requestAnimationFrame(() => settlePhoneFit());
  }

  function paintZoom() {
    const phone = isPhoneViewport();
    const phoneStr = phone ? "1" : "";
    if (root.dataset.phone !== phoneStr) root.dataset.phone = phoneStr;
    // FIT-01: the asides park on the resource bar's live top edge, and the
    // bar is not a constant — the chip row wraps on narrow windows and the
    // bar (fixed to bottom: 0) grows UPWARD. Measure it here, where a resize
    // is already being handled, and publish it; styles.css puts both columns
    // on max(52px, --resbar-h). jsdom lays nothing out (0) and keeps the
    // stylesheet's 52px fallback, so every pinned number below survives.
    const resbarH = footer.offsetHeight;
    if (resbarH > 0) root.style.setProperty("--resbar-h", `${resbarH}px`);
    // RAIL-01: a collapse is a desktop affordance — crossing into the phone
    // regime hands the panels back to the sheets, unfolded.
    railSyncViewport();
    const wrap = boardWrap;
    let z = 1;
    if (phone) {
      // MOBILE-02: the match table IS the screen on a phone. This pass only
      // sets the ZOOM — cheap, reversible and safe to run mid tab-switch.
      // Growing rows/columns lives in settlePhoneFit (#163), which runs from
      // a settled post-layout measurement, never from a transient box. Zoom
      // closes the remaining pixels so the current rectangle never clips and
      // the sheet never scrolls to reach a gem.
      const slotW = boardSlot.clientWidth, slotH = boardSlot.clientHeight;
      const measured = slotW > 100 && slotH > 100;
      const availW = Math.max(140, (measured ? slotW : window.innerWidth - 44) - PHONE_SLOT_PAD_W);
      const availH = Math.max(120,
        (measured ? slotH : window.innerHeight - (window.innerWidth <= 760 ? 380 : 250)) - PHONE_SLOT_PAD_H);
      z = Math.max(0.2, Math.min(availW / (CELL * board.w), availH / (CELL * board.h), 1));
    } else {
      const boardPx = CELL * board.w;
      const vh = window.innerHeight;
      if (vh <= 720) z = 0.68; else if (vh <= 800) z = 0.8; else if (vh <= 900) z = 0.9;
      // V3: the height-only rule could leave the board wider than the space
      // the right column has on a narrow desktop window, and the panel edge
      // cut the last columns off the quarry. Clamp by that width too.
      const leftW = window.innerWidth <= 900 ? 0 : (window.innerWidth <= 1180 ? 262 : 300);
      const availW = window.innerWidth - leftW - 64;
      z = Math.max(0.4, Math.min(z, availW / (boardPx + 10)));
      // FIT-01: the height rules above guess from viewport bands; the column
      // can be MEASURED, so measure it. scrollHeight of the economy panel is
      // everything it wants to paint — tabs, plant head, reach strip, board
      // — and the board's share of that at the CURRENT zoom is known, so the
      // fixed furniture around it is `colH − boxNow`. The zoom then closes
      // whatever gap remains between that furniture and the room the column
      // actually has (rightAside.clientHeight already ends at the resource
      // bar, however tall the wrapped chip row made it). The board's share
      // scales with zoom, the furniture does not — one linear solve. It is
      // also IDEMPOTENT: a column that fits holds its zoom (room/boxH ≥ the
      // zoom colH was laid out at), a column that doesn't gives back exactly
      // the zoom that fits — so resize-event storms can never make the board
      // pulse or drift. Guards keep the unmeasured or not-laid-out cases
      // (jsdom, another tab hiding the plant pane) on the band heuristic.
      const asideH = rightAside.clientHeight;
      const colH = tp.scrollHeight;
      if (asideH > 100 && colH > 100 && !qp.classList.contains("hidden")) {
        const boxH = CELL * board.h + 10;                    // the board box at zoom 1
        const zNow = Number(wrap.style.zoom || "1") || 1;    // the zoom colH was laid out at
        const boxNow = Math.ceil(boxH * zNow);
        if (boxNow > 0 && boxNow < colH) {
          const chromeH = colH - boxNow;
          const room = asideH - chromeH - 2;                 // 2px: the column breathes
          z = Math.max(0.4, Math.min(z, room / boxH));
        }
      }
    }
    wrap.style.zoom = String(z);
    // V3: publish the zoomed board width. The right aside and the quarry
    // panel size themselves from it (styles.css), so the panel always fits
    // every live column instead of a fixed width that assumes fewer.
    const boardW = Math.ceil((CELL * board.w + 10) * z);
    root.style.setProperty("--board-px", `${boardW}px`);
    root.style.setProperty("--tray-right", `${boardW + 52}px`);
    // dataset twin of the custom properties (jsdom has no `zoom`/var support,
    // and tests assert the published numbers through these).
    boardWrap.dataset.zoom = String(z);
    root.dataset.boardPx = String(boardW);
    syncTopbarTuck();
  }

  /**
   * Every layout trigger (boot, tab switch, view switch, window resize) gets
   * the immediate zoom pass, then asks the settled pass to re-validate the
   * board rectangle before the next paint. Tab switches that land on the
   * same viewport therefore ask for the SAME size and change nothing
   * (#163); only a genuinely different settled box can.
   */
  function responsiveZoom() {
    // #162: a new layout voids any held gesture (see the visibility hook).
    cancelDrag();
    paintZoom();
    schedulePhoneFit();
  }
  window.addEventListener("resize", responsiveZoom);
  window.addEventListener("orientationchange", responsiveZoom);
  // The observer delivers exactly the boxes the grow step is allowed to
  // trust: post-layout sizes of the slot, fired between frames. The pane
  // swap a tab switch performs settles within the SAME synchronous task, so
  // only its final box is ever reported — the squashed mid-switch box is
  // not observable. Absent RO (headless tests, older engines) the next-frame
  // fallback above carries the same contract.
  if (typeof ResizeObserver === "function") {
    const slotObserver = new ResizeObserver(() => settlePhoneFit());
    slotObserver.observe(boardSlot);
  }

  // ── MOBILE-02: the tucking top bar ───────────────────────────────────
  // A phone gives the match table the whole window; the top bar earns its
  // pixels back. It tucks away while the economy sheet is open, and drops
  // back down (with a brass flash) the moment the score plaque moves — or
  // the moment the player taps the grip above the tabs, and tucks again on
  // the next touch of the board. Off the trade sheet, and off phones, it
  // simply stays where it always was.
  let topTuckTimer = 0;
  let lastHudFlash = 0;
  const topbarTucks = () => isPhoneViewport() && root.dataset.view === "trade";
  function revealTopbar(holdMs = 2400) {
    window.clearTimeout(topTuckTimer);
    if (!topbarTucks()) return;
    top.classList.remove("tucked");
    topTuckTimer = window.setTimeout(() => {
      if (topbarTucks()) top.classList.add("tucked");
    }, holdMs);
  }
  function syncTopbarTuck() {
    window.clearTimeout(topTuckTimer);
    if (topbarTucks()) {
      // Entering the trade sheet with the bar still up lets it go right away
      // (the CSS transition animates it) — the tab strip under the notch must
      // be tappable the moment the sheet is, never locked behind a bar the
      // player did not ask for. The bar comes back for CHANGES and for the
      // grip, not for a view switch.
      if (!top.classList.contains("tucked")) {
        topTuckTimer = window.setTimeout(() => {
          if (topbarTucks()) top.classList.add("tucked");
        }, 350);
      }
      return;
    }
    top.classList.remove("tucked");
  }
  function flashTopbarOnChange() {
    const now = performance.now();
    // A cascade churns the purse every pass; a bar that re-drops per coin is
    // the same flicker the wire was. At most one reveal every few seconds.
    if (now - lastHudFlash < 5000) return;
    lastHudFlash = now;
    if (!topbarTucks()) return;
    revealTopbar(2600);
    top.classList.add("changed");
    window.setTimeout(() => top.classList.remove("changed"), 1400);
  }

  // ── top HUD: chips, VP, kingdoms ──────────────────────────────────────────
  // The HUD is painted every frame, so its nodes are built once and only what
  // actually changed is written. Replacing them per frame churned the DOM and
  // could swallow a hover or click landing between two frames.
  const chipNums = new Map<Cargo, HTMLElement>();
  let lastVpHtml = "";
  const kingRows = new Map<number, { row: HTMLElement; cls: string; colour: string; tip: string; html: string }>();
  let lastModebarInfo: string | null = null;
  let lastInspectHtml = "";

  function renderHUD(purse: Partial<Record<Cargo, number>>, players: UiPlayer[], portrait: Portrait, target: number) {
    for (const k of CARGOES) {
      let num = chipNums.get(k);
      if (!num) {
        const chip = h("div", "chip");
        chip.style.setProperty("--c1", CARGO[k].c1);
        chip.style.setProperty("--c2", CARGO[k].c2);
        chip.innerHTML = `<span class="chip-ic">${cargoIconHtml(k)}</span><span class="chip-n"></span>`;
        // PP-08: the Gold chip states what the currency is for, so a player
        // holding coins never mistakes them for construction stock.
        if (k === "gold") chip.title = GOLD_RULE;
        chips.appendChild(chip);
        num = chip.querySelector(".chip-n") as HTMLElement;
        chipNums.set(k, num);
      }
      const text = String(purse[k] ?? 0);
      if (num.textContent !== text) num.textContent = text;
    }
    const meP = players.find((p) => p.human);
    const yourVp = meP?.vp ?? 0;
    // AI-04: the line the difficulty set (5★ on easy), kept for the help modal
    // below, which has no state of its own.
    hudVpTarget = target;
    // The original badge is just a star counter; keeping "You" in it lets the
    // boot/e2e assertions stay unambiguous for the single-player build.
    const vpHtml = `<span class="vp-star">★</span> You ${fmtVp(yourVp)}<span class="vp-tot">/${target}</span>`;
    if (vpHtml !== lastVpHtml) {
      vp.innerHTML = vpHtml; lastVpHtml = vpHtml;
      // MOBILE-02: the SCORE is the milestone worth breaking a phone's view
      // for. The purse changes every cascade — a bar that re-dropped per
      // coin would be the flicker the wire was.
      flashTopbarOnChange();
    }

    const list = [...players].sort((a, b) => b.vp - a.vp);
    const live = new Set<number>();
    list.forEach((p, i) => {
      const seat = players.indexOf(p);
      live.add(seat);
      let rec = kingRows.get(seat);
      if (!rec) {
        rec = { row: h("div"), cls: "", colour: "", tip: "", html: "" };
        kingRows.set(seat, rec);
      }
      const cls = "king" + (p.human ? " self" : "");
      if (rec.cls !== cls) { rec.row.className = cls; rec.cls = cls; }
      if (rec.colour !== p.colour) { rec.row.style.setProperty("--pc", p.colour); rec.colour = p.colour; }
      // AI-03: the breakdown is prebuilt by the game (it owns the ledger);
      // native title keeps this one line of tooltip code.
      const tip = p.vpTip ?? "";
      if (rec.tip !== tip) {
        if (tip) rec.row.title = tip; else rec.row.removeAttribute("title");
        rec.tip = tip;
      }
      // PP-14b + NOIR: the dossier face. The player's own is the Vex or You
      // portrait picked on the start screen; every rival keeps the mugshot its
      // name (or seat) maps to — Torvin plays the solo rival. The coloured
      // initial stays as the fallback under the image.
      const face = p.human
        ? (portrait === "you" ? portraitYou : portraitVex)
        : portraitFor(p, seat);
      // STORY-01: a contract's rival wears their painted expression sheet on
      // the dossier card — one quadrant at a uniform 2×, never stretched —
      // while a sandbox match keeps the mugshot its name or seat maps to.
      const rivalFace = !p.human && rivalFaceOverride ? rivalFaceOverride : null;
      const faceStyle = rivalFace && rivalFace.pos
        ? `background-image:url(${rivalFace.url});background-size:200% 200%;background-position:${rivalFace.pos[0]}% ${rivalFace.pos[1]}%`
        : rivalFace
          ? `background-image:url(${rivalFace.url});background-size:cover;background-position:center 20%`
          : `background-image:url(${face})`;
      const html = `
        <div class="king-av has-portrait" style="${faceStyle}">${p.name[0]}</div>
        <div class="king-mid">
          <div class="king-name">${p.name}${p.human ? " <span class='you'>YOU</span>" : ""}</div>
          <div class="king-bar"><i style="width:${Math.min(100, (p.vp / target) * 100)}%;background:${p.colour}"></i></div>
        </div>
        <div class="king-vp">${fmtVp(p.vp)}<small>★</small></div>`;
      if (rec.html !== html) { rec.row.innerHTML = html; rec.html = html; }
      if (kingdoms.children[i] !== rec.row) kingdoms.insertBefore(rec.row, kingdoms.children[i] ?? null);
    });
    for (const [seat, rec] of kingRows) {
      if (!live.has(seat)) { rec.row.remove(); kingRows.delete(seat); }
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
    // STORY-01: the contract's rival wears their painted sheet on the dossier
    // card; a sandbox match (no face on the state) keeps the mugshot map.
    rivalFaceOverride = state.rivalFace ?? null;
    // TUT-01: remember the live free-tile allowance so a tour replayed from ❔
    // quotes the game being played, not the shipped constant.
    hudFreeTrack = state.freeTrack;
    if (rivalWire.dataset.speaker === "you") {
      rivalWireFace.style.backgroundImage = `url(${rivalWirePlayerPortrait})`;
    }
    renderHUD(state.purse, state.players, state.portrait, state.vpTarget ?? VICTORY.target);
    // PP-14b: the reset button counts its cooldown down and disables while
    // the plant re-arms.
    const resetLeft = Math.ceil((state.resetIn ?? 0) / 1000);
    resetBtn.disabled = resetLeft > 0;
    const resetText = resetLeft > 0 ? `♻ Reset ${resetLeft}s` : "♻ Reset";
    if (resetBtn.textContent !== resetText) resetBtn.textContent = resetText;
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
    // reported "click the X and it stays there". Rebuild only when the content
    // changes. BANNER-ONCE: and the dismissal is keyed on the stable id, so a
    // closed banner is gone for good — a text-keyed dismissal came back to
    // life every time the line's wording changed and returned (see
    // `dismissedBannerKey`).
    if (state.banner !== lastBannerText || state.bannerKey !== lastBannerKey) {
      lastBannerText = state.banner;
      lastBannerKey = state.bannerKey;
      if (state.banner && dismissedBannerKey !== state.bannerKey) {
        const text = state.banner;
        const key = state.bannerKey;
        // STORY-01: a voiced banner is a speech bubble, not a posted sheet —
        // her face, her name tag, her line. The ✕ and the BANNER-ONCE
        // dismissal work identically on both, because the key is the seam.
        const face = state.bannerFace ?? null;
        banner.classList.toggle("narrated", !!face);
        banner.innerHTML = `<button class="banner-close" title="Hide">✕</button>` +
          (face
            ? `<span class="banner-face" aria-hidden="true"></span>`
              + `<b class="banner-who">${state.bannerWho ?? "Mabel Quill"}</b>`
              + `<small>${text}</small>`
            : `<small>${text}</small>`);
        if (face) {
          const faceEl = banner.querySelector(".banner-face") as HTMLElement;
          faceEl.style.backgroundImage = `url(${face.url})`;
          if (face.pos) {
            faceEl.style.backgroundSize = "200% 200%";
            faceEl.style.backgroundPosition = `${face.pos[0]}% ${face.pos[1]}%`;
          } else {
            faceEl.style.backgroundSize = "cover";
            faceEl.style.backgroundPosition = "center 20%";
          }
        }
        const bx = banner.querySelector(".banner-close") as HTMLElement;
        bx.dataset.sfx = "close";
        bx.onclick = () => {
          dismissedBannerKey = key;
          banner.classList.add("hidden");
        };
      }
    }
    banner.classList.toggle("hidden", !state.banner || dismissedBannerKey === state.bannerKey);
    const toolState = state.tool;
    buildList.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === toolState);
    });
    // #187: what a Build button's re-tap means this frame. The button is its
    // own toggle — re-tapping the armed tool puts it down, the same gesture as
    // the hint's ✕, Esc and the right button — except while the phase still
    // OWES a placement (the opening Factory, the opening Depot), where there
    // is nothing to cancel and a ✕ would be a dead button.
    armedTool = toolState;
    placementMandatory = state.phase === "setup-factory" || state.phase === "setup-harvester";
    // MOBILE-01: the held-tool chip. A touch hand has no right-click and no Q,
    // so while anything but the pointer is in the hand the chip names it and
    // puts it down on a tap. It reads the SAME button the Build sheet lit, so
    // the two can never disagree about what is held.
    if (toolState !== lastChipTool) {
      lastChipTool = toolState;
      const held = toolState !== "select"
        ? buildList.querySelector<HTMLElement>(`[data-tool="${toolState}"] .bb-mid b`)
        : null;
      const label = held?.textContent?.trim() ?? "";
      toolChipLabel.textContent = label || toolState;
      // The chip's own text is its accessible name, and the ✕ is a bare glyph
      // now that the verdict rides beside it — so name the whole button.
      toolChip.setAttribute("aria-label", `Put the ${label || toolState} tool down`);
      toolChip.classList.toggle("hidden", toolState === "select");
      // #187: on a phone the Build sheet is full-bleed, so arming a tool from
      // it left the player looking at a list instead of the map they are about
      // to tap. Hand the screen back to the map on the TRANSITION into a tool
      // — never on every frame, or a player who re-opens Build to switch tools
      // would be thrown straight back out again. The chip above (and the ✕ on
      // it) is the way out from there.
      if (toolState !== "select" && isPhoneViewport() && root.dataset.view === "build") {
        setMobileView("map");
      }
    }
    // #187: in the phone regime the chip IS the placement hint — styles.css
    // hides the desktop pill there, so one thumb-reach line carries the tool's
    // name, the verdict and the ✕, instead of two pills saying half of it each.
    const chipHint = state.costInfo ?? "";
    if (chipHint !== lastChipHint) {
      lastChipHint = chipHint;
      toolChipHint.innerHTML = chipHint;
      toolChipHint.classList.toggle("hidden", !chipHint);
    }
    // MOBILE-01: on a phone the sheets rise to just under the top bar, which
    // is exactly where the banner is posted — so the posted sheet covered the
    // first row of the Build list. Publish the banner's live height and let
    // the mobile sheet top edge sit below it (styles.css reads --banner-h).
    const bannerH = banner.classList.contains("hidden") ? 0 : banner.offsetHeight;
    if (bannerH !== lastBannerH) {
      lastBannerH = bannerH;
      root.style.setProperty("--banner-h", `${bannerH}px`);
    }
    // NAMES: the top-bar button's pressed look follows the live state —
    // whichever way it changed (this chrome's click or the game's hook).
    const namesOn = state.showNames ?? true;
    namesBtn.setAttribute("aria-pressed", String(namesOn));
    namesBtn.classList.toggle("active", namesOn);
    // PP-05: keep the Depot's price line honest without rebuilding the button
    // (a rebuilt button drops a click mid-gesture, the reason `renderSabotage`
    // is change-gated too). The cost text comes from the same table the
    // placement charges; `disabled` mirrors the affordability the click checks.
    const sub = depotButtonMarkup(state.freeDepots);   // allowance first, then Oil
    if (sub !== lastDepotSub) {
      lastDepotSub = sub;
      if (depotSub) depotSub.innerHTML = sub;
    }
    // RAIL-04: the Railway panel. Repainted only when its rows change, for the
    // same reason the Black Market is: a rebuild between a button's pointerdown
    // and pointerup would swallow the click.
    const railState = state.rail;
    const railPanelOn = railState !== undefined
      && (state.tool === "rail" || state.tool === "platform"
        || state.tool === "raildepot" || state.tool === "railway");
    // The key carries the PANEL'S STATE as well as its rows: a fresh game has
    // no rows at all, so an empty-but-visible panel would key the same as a
    // hidden one and the toggle below would never fire the first time a rail
    // tool is picked up.
    const railKey = railPanelOn
      ? "on|" + railState!.rows.map((r) => `${r.id}:${r.kind}:${r.label}:${r.detail}:${r.actions.join(",")}:${r.hint ?? ""}`).join("|")
      : "off|";
    if (railKey !== lastRailKey) {
      lastRailKey = railKey;
      railPanel.classList.toggle("hidden", !railPanelOn);
      railRows.innerHTML = "";
      if (!railPanelOn) {
        // nothing to paint; the panel is hidden
      } else if (!railState!.rows.length) {
        railRows.appendChild(h("div", "rail-empty",
          "No railway yet — drag Rail to a resource, then place a Platform beside it and a Train Depot on the line."));
      } else {
        for (const row of railState!.rows) {
          const line = h("div", "rail-row");
          line.innerHTML = `<b>${row.label}</b><small>${row.detail}${row.hint ? ` · ${row.hint}` : ""}</small>`;
          for (const action of row.actions) {
            const b = h("button", "rail-act", action === "assign" ? "Assign line" : action === "buy" ? "Buy train"
              : action === "start" ? "Start" : action === "recall" ? "Recall" : "Sell");
            b.dataset.railAction = `${row.id}:${action}`;
            b.dataset.sfx = "click";
            b.onclick = () => hooks.onRailAction(row.id, action, row.partnerId);
            line.appendChild(b);
          }
          railRows.appendChild(line);
        }
      }
    }
    buildList.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((button) => {
      const tool = button.dataset.tool as UiTool;
      const cost = tool === "plant" ? PLANT_COST : tool === "harvester" ? DEPOT_COST
        : tool === "road" || tool === "dirt" ? TRANSPORT[tool].cost
        : tool === "platform" ? RAIL_COSTS.platform
        : tool === "raildepot" ? RAIL_COSTS.depot : {};
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
    // #187: the hint. One slim line, and its ✕ is a REAL cancel: it asks for
    // the pointer through the same hook the Select button and the touch chip
    // use, which in game.ts disarms the tool, drops an armed drag and repaints
    // the overlay — so `state.costInfo` is null on the next frame and this bar
    // STAYS down. The old ✕ only added a `hidden` class that the very next
    // `classList.toggle("hidden", !info)` took straight back off, leaving the
    // tool armed and the next map tap building.
    // While the phase mandates a placement there is nothing to cancel, so no
    // dead button is offered at all.
    const info = state.costInfo;
    const cancellable = !!info && !placementMandatory && toolState !== "select";
    // The bar is rebuilt when the verdict changes OR when the ✕ appears/goes
    // away — a phase that stops mandating a placement must grow its cancel.
    // An empty `costInfo` empties the bar too, so the DOM says what the state
    // says: a cancelled hint is gone, not merely hidden with its old text.
    const barSig = info === null ? null : `${cancellable ? "✕" : ""}\u0000${info}`;
    if (barSig !== lastModebarInfo) {
      lastModebarInfo = barSig;
      modebar.innerHTML = info ?? "";
      if (cancellable) {
        const cancel = h("button", "mb-cancel", "✕");
        cancel.type = "button";
        cancel.dataset.sfx = "close";
        cancel.title = "Cancel — put the tool down (Esc / right-click)";
        cancel.setAttribute("aria-label", "Cancel this placement and return to the pointer");
        cancel.onclick = () => hooks.onTool("select");
        modebar.appendChild(cancel);
      }
    }
    modebar.classList.toggle("hidden", !info);
    const inspectHtml = state.inspect ?? "";
    if (inspectHtml !== lastInspectHtml) {
      inspectEl.innerHTML = inspectHtml;
      lastInspectHtml = inspectHtml;
    }
    inspectEl.classList.toggle("bad", !!state.inspect && state.inspectTone === "bad");
    inspectEl.classList.toggle("good", !!state.inspect && state.inspectTone === "good");
    const inspectDisplay = state.inspect ? "block" : "none";
    if (inspectEl.style.display !== inspectDisplay) inspectEl.style.display = inspectDisplay;
    const now = performance.now();
    // Refresh when offers are born/expired/accepted, and once per second so the
    // on-card countdown stays live without rebuilding the DOM every frame.
    const offerSecs = (o: import("../iso/market").Offer) =>
      Math.max(0, Math.ceil((OFFER_LIFE - (now - o.born)) / 1000));
    // #114: affordability is part of what this UI displays — the Post, Bank
    // and Take buttons all price from the purse. A balance that changed under
    // a STABLE offer list (the guest's authoritative purse sync, most
    // visibly) must re-render, or a Take button stays disabled after the
    // purse it prices from has long funded it.
    const affordKey = CARGOES.map((c) => me.res[c] ?? 0).join(",");
    const marketKey = affordKey + "#" + market.ctx.offers
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
      .map((c) => `<span class="chip" style="--c:${CARGO[c].c2}">${cargoIconHtml(c)}${CARGO[c].name}</span>`).join("");
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
  /**
   * AI-04: the ★ line the last painted HUD showed, so the help modal's "first
   * to N★" matches the badge the player is looking at (5★ on easy). Seeded with
   * the shipped line, which is what it reads before the first paint.
   */
  let hudVpTarget: number = VICTORY.target;
  /**
   * TUT-01: the same idea for the tour's second number — the free dirt tiles
   * the setup allowance is paying for. The tour reads both from here when the
   * ❔ replays it mid-game, so its copy quotes the game the player is IN rather
   * than a constant that may have moved.
   */
  let hudFreeTrack = 0;
  /** The replayed tour, while it is open — held so ❔ cannot stack a second. */
  let tourView: TutorialHandle | null = null;

  function helpModal() {
    // MOBILE-01: the reference card names the controls the device actually
    // has. On touch that is the finger grammar (tap, drag, pinch) plus the
    // floating keys and the held-tool chip; on a mouse it is the keyboard and
    // the three buttons. One paragraph, swapped — never both, never neither.
    const TOUCH_CONTROLS = coarsePointer()
      ? `<p><h3>Playing by touch</h3><p><b>One finger</b> pans the map and drags roads tile by tile; <b>a tap</b> places a building or lays a single road tile; <b>two fingers</b> pinch-zoom. The <b>+ / − / 🎯</b> keys at the map's right edge zoom and recentre. The chip at the lower-left names the tool in your hand and <b>puts it down</b> on a tap, and a tap with <b>Select</b> reads the tile under your finger in the inspector. The bottom bar switches <b>Map / Build / Economy</b>.</p>`
      : "";
    sfx.play("open");
    modalRoot.classList.remove("hidden");
    modalRoot.innerHTML = `
      <div class="modal-back"></div>
      <div class="modal box">
        <h2>Hexmatch Industries</h2>
        <p class="sub">Two worlds, one empire: <b>resource node → Depot → transport network → Factory → processing → resources available for construction</b>. First to <b>${hudVpTarget}★ Victory Points</b> wins.</p>
        <div class="help-cols">
          <div class="help-col"><h3>The Territory</h3><p>Place <b>Depots</b> beside resource nodes to collect their output, then build <b>Dirt Roads</b> &amp; <b>Roads</b> (paved) to carry it to your Factory. The connection sets the multiplier — ×1.0 on gravel, ×1.6 anywhere a paved tile touches the line — and nothing else.</p>
<p><h3>How you score (VP-01)</h3><p><b>Dirt Roads score nothing.</b> Points come from <b>upgrading</b>: pave a Dirt Road tile into a Road for <b>+${VICTORY.upgrade}★</b> (it costs only ${costMarkup(UPGRADE_COST)}, since the gravel is already paid for), and raise a <b>processing plant</b> beside another town for <b>+${VICTORY.plant}★</b>. Four paves to the point; <b>${hudVpTarget}★</b> wins. A Road laid on virgin ground scores nothing — the point is for improving what you built. Tear up a paved tile or demolish a plant and the point goes back.</p><p>Your <b>first Depot is free</b>; every Depot after it costs <b>${costMarkup(DEPOT_COST)}</b>, so reaching new industries (or manufacturing in the Processing Plant) is what buys expansion. A Depot you cannot pay for is refused and consumes nothing.</p><p><b>Lorries run 2× faster on paved Roads</b> — paving a lane is both the points and the income (AI-02).</p><p>Move the camera with <b>WASD</b> (Shift holds double speed) or the <b>middle mouse button</b> (wheel zooms, touch drags pan). The left button only places or selects — dragging it never pans. <b>Right-click drops the tool you are holding</b> back to the pointer, and the pointer reads the map: hover a resource, town, plant or depot and the inspector says exactly what it is.</p>${TOUCH_CONTROLS}<p>The top-bar <b>Aa Names</b> switch shows or hides the name tags over the map's features while you pan.</p></div>
          <div class="help-col"><h3>The Processing Plant</h3><p>Where your Factory turns delivered cargo into resources available for construction. Match tokens to process: a colour only pays when your network reaches its industry. Match 4 doubles, match 5 makes a <b>bomb</b>. <b>Gold</b> 🪙 is its own colour — its gems drop only while a depot sits beside a gold mine (and pay once it's connected).</p></div>
          <div class="help-col"><h3>Gold, Trade & Defence</h3><p>Earn <b>gold</b> from gold-mine access or combos. <b>Gold is reserved for Black Market sabotage</b> — it never buys construction, cannot substitute for missing materials, and is refused by every market exchange. Security Forces and Repair Crew are hired with ordinary materials. A <b>Protest</b> ✊ shuts any public road for 2:00 — every truck stops, including your own.</p></div>
        </div>
        <div class="confirm-row">
          <button class="big-btn ghost" id="tourBtn" data-sfx="open">▶ Replay the tour</button>
          <button class="big-btn" id="startBtn">Start Production</button>
        </div>
      </div>`;
    const shut = () => { sfx.play("close"); modalRoot.classList.add("hidden"); };
    (modalRoot.querySelector("#startBtn") as HTMLElement).onclick = shut;
    (modalRoot.querySelector(".modal-back") as HTMLElement).onclick = shut;
    // TUT-01: the plaque above is the reference; the tour is the lesson. Both
    // stay reachable forever — "Never show this again" only stops the tour
    // opening ITSELF at boot, it never takes the lesson away.
    (modalRoot.querySelector("#tourBtn") as HTMLElement).onclick = () => {
      shut();
      if (tourView) return;
      tourView = showTutorial(root, {
        force: true,
        vpTarget: hudVpTarget,
        freeTrack: hudFreeTrack,
        onClose: () => { tourView = null; },
      });
    };
  }

  function showModal(html: string) {
    // #164: never stand up a bare backdrop. A modal whose content carries no
    // readable text is the blank dark panel a player cannot dismiss and
    // cannot understand — the report's second bug, and every caller that
    // interpolates a possibly-empty string (a reject reason, a verdict line)
    // could produce it. An empty ask becomes a CLOSE: whatever was standing
    // comes down instead of darkness going up.
    if (!html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").trim()) {
      hideModal();
      return;
    }
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
  armIdleHint(); // #162: the idle hint arms at boot and re-arms on every touch

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
    crossCancel,
    isQuarryOpen: () => !qp.classList.contains("hidden"),
    isTradeOpen: () => !marketPane.classList.contains("hidden") || !bankPane.classList.contains("hidden"),
    showModal,
    hideModal,
    showHelp: () => helpModal(),
  };
}
