// ══════════════════════════════════════════════════════════════════════════
// U1 — the restored HexMatch interface, driven by the iso game.
//
// This file is the recovered `src/game/ui.ts` (861 lines from the pre-iso UI)
// re-wired to the iso state. The layout, class names and panel structure are
// the ORIGINAL HUD:
//
//   Left column   BUILD   Rail / Factory / Foundry controls (mapped onto the
//                         iso Dirt Road / Road / Depot / Demolish tools)
//   Left column   BLACK MARKET  Blockade, Protest, Security,
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
// it takes the live iso primitives (`board`, the local seat, the player purse)
// and renders the same chrome from them.
// ══════════════════════════════════════════════════════════════════════════
import {
  CELL, RES,
  SABOTAGE, SECURITY, type ResKey,
} from "./config";
// L11 (#226): the bank — the one exchange left. `bankAllowed`/`bankTier` are
// the same gate the placement runs, so a locked cargo is never offered a
// button that the rule would then refuse.
// L11 (#226), restored by L17 (#245): the bank — the one exchange, back at the
// town's middle building, at 3:1. `bankAllowed`/`bankTier` are the same gate
// the game runs, so a locked cargo is never offered a button the rule would
// then refuse.
import { BANK_RATE, bankAllowed, bankTier } from "../iso/bank";
import { type CargoBag } from "../iso/purse";
// VP-01: the victory numbers come from the iso config, NOT from the legacy
// `VP = { target: 10 }` in game/config.ts that this file used to read. That
// constant and the engine's own `VP_TARGET` were two numbers with one name,
// and the HUD was already showing "/10" while the game was winning at 12 — the
// scoreboard now has exactly one source, `VICTORY` in src/iso/config.ts.
import { CARGO, CARGOES, TRANSPORT, VICTORY, TUNING, type Cargo, type Portrait } from "../iso/config";
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
import { Board, BOARD_ANIMATION_MS, FAST_ANIMATION_MS, type FxType, type Gem } from "./board";
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
  HUD_ICONS, cargoIconHtml, costMarkup, depotButtonMarkup, soundIconHtml,
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

/** L8 (#222): one optional quest, as the chrome prints it. The game owns the
 *  rule behind every string here (`progress` is computed by quests.ts); the
 *  chrome only paints. */
export interface UiQuestItem {
  /** Stable id — the handle "dismiss this one" travels back on. */
  id: string;
  /** Who is speaking (the contract's rival, the guide, the sandbox foreman). */
  who: string;
  /** The offer, in their voice. */
  text: string;
  /** How far along the player is ("2/3", "best ×2.4 · need ×2"). */
  progress: string;
  /** What completing it pays ("2 ⛏️ Ore"). */
  reward: string;
}

/** L8 (#222): the quest panel's state. `hidden` is the player's own choice
 *  (the panel shrinks to a flag they can click back open). */
export interface UiQuestPanel {
  hidden: boolean;
  items: UiQuestItem[];
}

export interface UiState {
  players: UiPlayer[];
  purse: Partial<Record<Cargo, number>>;
  /**
   * L16 (#231): the per-resource storage cap the local seat plays under, or
   * undefined when no cap applies (the shipped loop, and dev mode's unlimited
   * purse — `?unlimited=0` restores it). Set, the resource bar prints
   * `amount / cap` and classes any cargo sitting at its cap `.full`: clock
   * income past the cap is lost, and the bar is where that has to read at a
   * glance.
   */
  storageCap?: number;
  phase: string;
  tool: UiTool;
  freeTrack: number;
  /**
   * L5 (#219): the rungs of the depot tree this seat has UNLOCKED, so the
   * Depot button can quote the cheapest type that is actually open to it (and
   * the modebar can say why a locked type is locked). Absent on the shipped
   * loop — one mix, one rung.
   */
  depotTier?: number;
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
  /** L8 (#222): objective line — what the player should do next. Omitted on
   *  the shipped loop. The banner keeps protest/disconnect/won; the objective
   *  is the game telling the player the loop. */
  objective?: string | null;
  /** L8 (#222): banner vs objective stability key for objective dismissal. */
  objectiveKey?: string | null;
  /** L8 (#222): per-second income per cargo — the build/match delta, so the
   *  chip bar reads as a live rate and not a static purse. Omitted on the
   *  shipped loop. */
  incomeRates?: Partial<Record<Cargo, number>>;
  /**
   * L8 (#222): the OPTIONAL quests — suggestions voiced by the match's cast,
   * never a requirement. `null`/omitted when there are none to show (the
   * retired loop, a guest, a finished match). Collapsed the chrome prints one
   * slim line; opened it lists the offers, each dismissible, and the whole
   * panel hides — ignoring every quest is a legal way to play, and the chrome
   * has to make that obvious rather than nag.
   */
  quests?: UiQuestPanel | null;
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
  /**
   * L4 (#218): the tuning session the plant board is open for. THREE
   * meanings, and the difference matters:
   *   • omitted / `undefined` — not the new loop: the board is the always-on
   *     processing plant it has always been (this is the shipped game);
   *   • `null` — the new loop, no session: the board is DOWN. The plate says
   *     why and the grid is not on screen at all, because on this loop
   *     match-3 only exists while a Depot is being tuned;
   *   • a session — the board is up, scoped to that Depot's cargo, with the
   *     moves left, the running score and the yield it is currently worth.
   *
   * L6 (#220) adds `tuningIdle` beside it: what the plate SAYS when the answer
   * is `null` depends on the difficulty, not on the chrome.
   */
  tuning?: UiTuningSession | null;
  /**
   * L6 (#220): what the plant plate says BETWEEN sessions. `tuning === null`
   * already means "new loop, board down"; this says what the player can do about
   * it, and it is the difficulty's answer and not the chrome's:
   *
   *   • `retune` — the one Depot a re-tune is owed on (weakest first), or null.
   *     Easy's row (`rematch: "never"`) always answers null, so the plate there
   *     is the shipped line and not a key that would refuse to work;
   *   • `economyLine` — the difficulty's own sentence about what happens to a
   *     yield, so the panel states the rule the top bar was switched to.
   */
  tuningIdle?: UiTuningIdle;
  /**
   * L5 (#219): the city upgrade, as the plate's own key needs it. Omitted on
   * the shipped loop — the button does not exist there, and neither does the
   * rule. A present record always paints the key; `note` explains a key that
   * is off (shortfall, no session left to run, or the city already upgraded).
   *
   * It travels BESIDE `tuningIdle`, not inside it: the city key is about the
   * whole network (L5), the re-match key about one Depot's cooling yield (L6),
   * and both can be on screen at once — a Hard seat with a city upgrade to buy
   * and a Depot it is owed a re-match on.
   */
  town?: UiTownState | null;
}

/** L6 (#220): the Depot the plate is offering a re-match for. */
export interface UiRetuneOffer {
  /** `Harvester.id` — the game re-resolves it; the chrome never holds a record. */
  depotId: number;
  /** The Depot's cargo, when it holds an industry (null = open ground). */
  cargo: Cargo | null;
  /** The yield it is at NOW — after Hard's decay has been shaving it. */
  yield: number;
  /** True when a worse session can lower the level (Hard's row only). */
  risks: boolean;
}

/** L6 (#220): the plate between sessions. */
export interface UiTuningIdle {
  retune: UiRetuneOffer | null;
  economyLine?: string;
}

/**
 * L5 (#219): one city upgrade, as the HUD needs it — the next row of
 * `TOWN_UPGRADES`, priced by the game.
 */
export interface UiTownState {
  /** Levels bought so far. */
  level: number;
  /** How many rows the table holds (1 in the MVP's one-tier city). */
  maxLevel: number;
  /** What the next upgrade costs. Empty when there is nothing left to buy. */
  cost: Partial<Record<Cargo, number>>;
  /** The purse covers `cost` — the key's only enabled state. */
  affordable: boolean;
  /** The base-rate bonus already banked (0 before the first upgrade). */
  bonus: number;
  /** The ceiling a full-marks session would set — what the key promises. */
  ceiling: number;
  /** Why the key is off, in one line. */
  note?: string;
}

/** L4 (#218): one live tuning session, as the HUD needs it. */
export interface UiTuningSession {
  /**
   * L5 (#219): which progression the session confirms — a Depot's yield
   * ("depot") or the CITY upgrade's base-rate bonus ("town"). The plate's
   * title says which, because the two read very differently ("what you are
   * about to earn" vs "what the whole city is about to earn").
   */
  kind: "depot" | "town";
  /**
   * #299: which record the session settles — the Depot's `Harvester.id`, or
   * `TOWN_SESSION_ID` (-1) for the city. The window's title names the cargo
   * and its tooltip names the lot, so two Depots of one cargo never read
   * identical.
   */
  depotId?: number;
  /** The cargo the session depot collects (its board is scoped to it). `null`
   *  on a town session: the board plays neutral and the upgrade lifts every
   *  cargo the city handles. */
  cargo: Cargo | null;
  /** The budget the session opened with. */
  moves: number;
  /** Moves not yet spent. */
  movesLeft: number;
  /** Gems cleared so far. */
  score: number;
  /** The yield this score is currently worth. */
  yield: number;
  /** What abandoning pays — the plate states both numbers, never a promise. */
  abandonYield: number;
  /** #301: whether the board is currently animating a cascade — Finish and
   *  Abandon are disabled only while this is true, not when moves run out. */
  busy?: boolean;
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
  /**
   * L11 (#226), restored by L17 (#245): the bank exchange. The GAME owns it —
   * the tier gate against the seat's own rungs, the guest relay (`"relayed"`:
   * the host has to confirm) and the host publish. The chrome never touches a
   * balance itself.
   */
  onBank: (give: Cargo, want: Cargo) => "done" | "relayed" | "refused";
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
  /**
   * L4 (#218): the tuning plate's two keys. `abandon` is the ✕ that closes a
   * session without playing it out (paying the default yield); otherwise the
   * player is FINISHING early, which keeps the score they earned. The game
   * owns both rules — the chrome only reports which key was pressed — and the
   * plate is never shown outside a session, so this is the only door out of
   * one.
   */
  onTuningEnd?: (abandon: boolean) => void;
  /**
   * L8 (#222): what the player did with the quest panel. `dismiss` retires one
   * offer for the rest of the game; `hide`/`show` put the whole panel away and
   * bring it back. The game owns both (they ride the save with the paid set),
   * and NOTHING in the rules reads them — the panel is the player's own.
   */
  onQuestAction?: (id: string, action: "dismiss" | "hide" | "show") => void;
  /**
   * L6 (#220): the plate's Retune key. The chrome never decides whether a
   * re-match is allowed — it shows the key because `UiState.tuningIdle` said so,
   * and reports the click. `game.ts` re-checks the rules (credit owed, one
   * session at a time) because a keyboard caller skips the key.
   */
  onTuningRetune?: () => void;
  /**
   * L5 (#219): the plate's city key. The game owns the price, the session and
   * the refusal copy; the chrome only reports the click.
   */
  onTownUpgrade?: () => void;
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
  /**
   * `score` (L12 #227): the new loop's readout — the pass's session SCORE
   * instead of cargo gains. The old loop never passes it.
   */
  popup: (gains: Partial<Record<ResKey, number>>, label: string, score?: number) => void;
  /**
   * PP-14b: the board paused on a cross and is waiting for the player's picks.
   * `kind` names the shape (holy 3×4 → 6 picks, broken 3×3 → 3 picks); show
   * the five-cargo chooser and answer `pick(chosen)` when the units are
   * confirmed (or after the auto-pick timer, so the cascade never hangs).
   */
  /**
   * #112: take the cross chooser down WITHOUT answering it — the host
   * resolved, expired or cleared the prompt, so a stale dialog must not sit
   * over a cascade that has moved on (and a queued second chooser must not
   * surface afterwards).
   */
  isQuarryOpen: () => boolean;
  isTradeOpen: () => boolean;
  /**
   * L4 (#218): bring the tuning board into view — the plant tab on the desktop
   * (unfolding the right column when it had been put away) or the Economy
   * sheet on a phone. Called once when a session opens: the board is the thing
   * the player was just asked to play, and a board behind a folded panel is a
   * board nobody finds.
   */
  openSessionBoard: () => void;
  /**
   * L17 (#245): bring the BANK into view — the map door to it is the town's
   * middle building, which is what you click to upgrade the city and to
   * trade. Desktop: the Bank tab (unfolding the right column when it had
   * been put away). Phone: the Economy sheet, same as a session board.
   */
  openBank: () => void;
  /**
   * L4 (#218): the session is over — put the map back in front of the player.
   * Desktop: nothing to do (the map never left; the plate and the board fold
   * away with it). Phone: the Economy sheet handed the screen back to the Map
   * view, which is what "close the board, return to the map" means there.
   */
  closeSessionBoard: () => void;
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

/**
 * PP-08: Security Forces are DEFENSIVE, not sabotage, so they were repriced
 * from Gold to materials (`SECURITY.cost`, legacy ResKey table).
 * `wheat`→grain, `brick`→stone. Gold is reserved for Black Market sabotage
 * and pays for nothing else.
 *
 * L9 (#224): Security Forces are the panel's ONLY non-Gold row now — Repair
 * Crew went with the three board cards it existed to undo (nothing can frost,
 * girder on a plant any more), so `REPAIR_COST` has no reader here.
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
 *  until #179/#181 land). L11 (#226): the Market tab is gone on EVERY loop,
 *  so `true` retires no tab — the Bank stays, tier-gated. */
export interface OriginalUiOptions {
  rail?: boolean;
  newLoop?: boolean;
}

/**
 * L11 (#226): what the chrome needs from the LOCAL seat. The game passes a
 * LIVE view of its own record — `res` is the very purse object it mutates and
 * `unlocked` is read off the seat's `depotTier` every paint, so a rung won
 * mid-game opens the bank the same frame and no copy can go stale.
 */
export interface UiSeat {
  /** Seat id ("you" / "ai") — the feed's own-vs-rival colour reads it. */
  id: string;
  name: string;
  /** The one owner of this seat's cargo: the purse object, by reference. */
  res: CargoBag;
  /**
   * L11 (#226): the rungs of `DEPOT_TREE` this seat has unlocked, or null
   * when no tree applies (the shipped loop) — the bank's gate, and what the
   * Bank pane's own select labels price from.
   */
  unlocked: number | null;
}

export function createOriginalUi(
  board: Board,
  seat: UiSeat,
  hooks: UiHooks,
  opts: OriginalUiOptions = {},
): OriginalUi {
  const root = h("div", "ui-root");
  root.dataset.view = "map";
  // L15 (#230): the new loop is the only loop — no trading surfaces.
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
  // L6 (#220): the same setting now also carries the player's own economy rules
  // (decay, the yield floor, whether a Depot can be re-tuned), so the control
  // says DIFFICULTY and not "Rival" — one knob, one honest name. The id, the
  // class and the storage key stay as they were: they are plumbing, and #230 is
  // the sweep that renames them.
  if (hooks.onSkill) {
    const skillWrap = h("label", "rival-skill");
    const sel = h("select", "rival-skill-sel") as HTMLSelectElement;
    sel.title = "Difficulty: how hard the rival plays, and what happens to the yield you tune (applies immediately)";
    for (const key of SKILL_KEYS) {
      const o = document.createElement("option");
      o.value = key;
      o.text = `Difficulty: ${RIVAL_SKILLS[key].label}`;
      // L13 (#228): under the new loop EVERY chair races the loop's own line
      // (`VICTORY.loop.target`), so the easy preset's "first to 5★" is no
      // longer true — strip the shipped line out of the blurb rather than
      // promising a race length the win check will not honour.
      const blurb = true
        ? RIVAL_SKILLS[key].blurb.replace(/\s*—?\s*and a short race, first to \d+★\.?/, ".")
        : RIVAL_SKILLS[key].blurb;
      o.title = `${blurb} ${RIVAL_SKILLS[key].economyLine}`;
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
  // L9 (#224): …and what the shop actually sells now — map sabotage. Nothing
  // in this panel reaches a match-3 board any more.
  sp.appendChild(h("div", "pane-note gold-rule",
    `${cargoIconHtml("gold")} ${GOLD_RULE} Construction and trade never touch it. Map sabotage only — nothing here touches a plant board.`));
  const sabList = h("div", "sab-list");
  sp.appendChild(sabList);

  root.appendChild(left);

  // ── right: shared economy window ────────────────────────────
  const rightAside = h("aside", "aside right iso-panel");
  // RAIL-01: same contract as the build column — the key names its panel.
  rightAside.id = "iso-aside-right";
  // #299 — on the new loop the Processing Plant is NOT a tab. The tuning
  // session is its own window over the map: a centred plate on a blocking
  // backdrop, opened when a Depot is placed (and for a city upgrade), closed
  // when it settles. The rail keeps Bank and Feed, plus the plant's idle
  // plate — the one line that says how to open a session, the Retune key and
  // the city key — in a small card under the tabs. The retired loop (`opts.newLoop`
  // off: story, a hosted match, `?loop=old`) has no sessions at all, so its
  // always-on board stays in the rail exactly as it shipped.
  const sessionMode = opts.newLoop === true;
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

  // ── L4 (#218) — the tuning plate ─────────────────────────────────────────
  // The board's state, at the top of the plant panel: either the live session
  // (cargo, moves left, score, the yield it is worth right now, and the two
  // keys out of it) or, on the new loop with no session up, the one line that
  // says why there is no board. Painted from `UiState.tuning`; the structure
  // is built once here and only its text and classes move, so a click can
  // never be lost to a per-frame rebuild.
  const tuningPlate = h("div", "tuning-plate hidden");
  tuningPlate.id = "iso-tuning";
  const tpHead = h("div", "tp-head");
  const tpTitle = h("b", "tp-title");
  const tpMoves = h("span", "tp-moves");
  tpHead.append(tpTitle, tpMoves);
  const tpRow = h("div", "tp-row");
  const tpScore = h("span", "tp-score");
  const tpYield = h("span", "tp-yield");
  const tpFinish = h("button", "tp-finish", "Finish");
  tpFinish.type = "button";
  tpFinish.title = "Close the session and keep the yield you have earned";
  // #301: abandon is now explicitly labelled — it must never be mistaken for a
  // plain close. The old \"✕\" looked like \"dismiss\" and threw away the score.
  const tpAbandon = h("button", "tp-abandon", "Abandon — default yield");
  tpAbandon.type = "button";
  tpAbandon.title = "Abandon — close without playing it out. The Depot keeps the default yield";
  tpAbandon.setAttribute("aria-label", "Abandon the tuning session — keeps default yield");
  // #301: keep the live session for the confirm gate — abandon with a score
  // asks first, because it discards what Finish would keep.
  let liveTuning: UiTuningSession | null = null;
  // Two-step confirm: first click arms, second click confirms within 4s.
  // This avoids `window.confirm` which is blocked in the hosted sandbox
  // (answered false with no dialog) and would make abandon impossible.
  let abandonConfirmUntil = 0;
  let abandonConfirmScore = -1;
  tpFinish.onclick = () => hooks.onTuningEnd?.(false);
  tpAbandon.onclick = () => {
    const t = liveTuning;
    const now = Date.now();
    if (t && t.score > 0) {
      if (abandonConfirmUntil < now || abandonConfirmScore !== t.score) {
        // First click — arm confirm
        abandonConfirmUntil = now + 4000;
        abandonConfirmScore = t.score;
        const fy = (y: number) => y.toFixed(2).replace(/0$/, "");
        const earned = `×${fy(t.yield)}`;
        const def = `×${fy(t.abandonYield)}`;
        tpAbandon.textContent = `Confirm abandon? ${earned} → ${def}`;
        tpAbandon.title = `Click again to confirm abandoning — you scored ${t.score} for ${earned}, abandoning keeps only ${def}`;
        // Auto-reset after window
        window.setTimeout(() => {
          if (Date.now() >= abandonConfirmUntil) {
            tpAbandon.textContent = "Abandon — default yield";
            const cur = liveTuning;
            if (cur) {
              const fy2 = (y: number) => y.toFixed(2).replace(/0$/, "");
              tpAbandon.title = `Abandon — close without playing it out. The Depot keeps the default yield ×${fy2(cur.abandonYield)}`;
            }
          }
        }, 4100);
        // Also try native confirm as extra gate where it works — if user cancels, stay armed
        // but don't abandon yet. In sandboxed hosts this returns false immediately,
        // so we stay in the armed state and second click will abandon.
        try {
          const fy3 = (y: number) => y.toFixed(2).replace(/0$/, "");
          const msg = `Abandon tuning session? You scored ${t.score} for ×${fy3(t.yield)} — abandoning keeps only ×${fy3(t.abandonYield)}.`;
          if (window.confirm(msg)) {
            // User confirmed via dialog — proceed immediately
            abandonConfirmUntil = 0;
            tpAbandon.textContent = "Abandon — default yield";
            hooks.onTuningEnd?.(true);
            return;
          }
          // If confirm returned false, we keep the armed state for second click
          return;
        } catch {
          // confirm not available — keep armed state
          return;
        }
      }
      // Second click within window — confirm
      abandonConfirmUntil = 0;
      tpAbandon.textContent = "Abandon — default yield";
    }
    hooks.onTuningEnd?.(true);
  };
  tpRow.append(tpScore, tpYield, tpFinish, tpAbandon);
  const tpIdle = h("div", "tp-idle");
  const tpIdleText = h("span", "tp-idle-text");
  // L6 (#220): the re-match key, beside the line that explains it. Built once
  // and shown only when the game says a Depot is owed one — on Easy it is never
  // shown, because Easy's rules row says so (see `paintTuning`).
  const tpRetune = h("button", "tp-retune", "Retune");
  tpRetune.type = "button";
  tpRetune.id = "iso-tuning-retune";
  tpRetune.dataset.sfx = "select";
  tpRetune.onclick = () => hooks.onTuningRetune?.();
  tpIdle.append(tpIdleText, tpRetune);
  // L5 (#219): the city upgrade's key sits under the session plate — the new
  // loop's second thing match-3 buys. It is the same surface as the session
  // (the plate is "what your economy is worth right now"), so a player who
  // has just tuned a Depot reads the next thing to do in the same place, and
  // it is independent of L6's re-match key above (both may be on screen).
  const tpCity = h("button", "tp-city hidden", "");
  tpCity.type = "button";
  tpCity.onclick = () => hooks.onTownUpgrade?.();
  tuningPlate.append(tpHead, tpRow, tpIdle, tpCity);
  qp.appendChild(tuningPlate);

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
  // L11 (#226): the MARKET tab is gone on every loop. The offer board it
  // opened — post, accept, cancel, the rival's own posts, the escrow behind
  // them — was the other way around L5's resource tree, and the ticket keeps
  // the bank only (tier-gated, see `bank.ts`). The Bank tab stays: it is a
  // real rule on both loops, the rebalancing tool the tree leaves standing,
  // so L1a's "no trade surfaces under the new loop" is now "no OFFER surfaces"
  // — one strip, Bank / Processing Plant / Feed, serves desktop and phone.
  const tabBank = h("button", "tab active", `<i class="tab-ic" aria-hidden="true">${HUD_ICONS.bank}</i><span class="tab-l">Bank</span>`);
  const tabFeed = h("button", "tab", `<i class="tab-ic" aria-hidden="true">${HUD_ICONS.feed}</i><span class="tab-l">Feed</span>`);
  tabBank.onclick = () => setTab("bank");
  tabFeed.onclick = () => setTab("feed");
  // #299: the Plant tab only exists where the plant is a pane at all — the
  // retired loop. On the new loop the session moved out of the rail and into
  // its own window, so the strip is Bank / Feed and nothing else.
  const tabPlant = sessionMode ? null
    : h("button", "tab", `<i class="tab-ic" aria-hidden="true">${HUD_ICONS.plant}</i><span class="tab-l">Processing Plant</span>`);
  if (tabPlant) tabPlant.onclick = () => setTab("plant");
  const tabDefs: [HTMLElement, "bank" | "plant" | "feed"][] = sessionMode
    ? [[tabBank, "bank"], [tabFeed, "feed"]]
    : [[tabBank, "bank"], [tabPlant!, "plant"], [tabFeed, "feed"]];
  for (const [tab, name] of tabDefs) {
    tab.dataset.tab = name;
    tabs.appendChild(tab);
  }
  tp.appendChild(tabs);
  const bankPane = h("div", "pane bank-pane");
  const feedPane = h("div", "pane feed-pane hidden");
  tp.appendChild(bankPane);
  tp.appendChild(feedPane);
  /**
   * #299 — the session window. The plant panel (`qp`) is built the same way
   * on both loops; what changes is its HOST. On the new loop it is born
   * inside a centred, modal plate over the map — `#iso-session` — which the
   * game opens when a Depot (or a city upgrade) raises a tuning session and
   * closes when the session settles. While it runs, the backdrop swallows
   * every map gesture and the rails/map go `inert`: the session is the main
   * screen. On a phone the window is the screen (see styles.css — the same
   * full-bleed regime the trade sheet used to own the board). On the retired
   * loop `qp` stays a pane of the rail's tab strip, exactly as it shipped.
   */
  let sessionWin: HTMLElement | null = null;
  let sessionFrame: HTMLElement | null = null;
  let plantCard: HTMLElement | null = null;
  if (sessionMode) {
    const win = h("div", "session-window hidden");
    win.id = "iso-session";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-modal", "true");
    win.setAttribute("aria-label", "Tuning session");
    const back = h("div", "session-back");
    // Closing a session is the plate's two doors, never a stray click: the
    // backdrop refuses its own press and says what will end it.
    back.onclick = () => {
      toast("The plant floor is mid-session — Finish keeps your yield, Abandon closes it.", "info");
    };
    const frame = h("div", "session-frame panel");
    frame.tabIndex = -1;
    qp.classList.add("hidden");   // the window opens on a session; see setSessionWindow
    frame.appendChild(qp);
    win.append(back, frame);
    sessionWin = win;
    sessionFrame = frame;
    // Between sessions the board is down and the plate lives in this rail
    // card — the strip's small print: how to open one, the Retune key, the
    // city key. `paintTuning` moves the plate between the two hosts as the
    // session comes and goes.
    const card = h("div", "panel plant-card");
    card.id = "iso-plant";
    card.appendChild(h("div", "panel-title", "Plant"));
    card.appendChild(tuningPlate);
    plantCard = card;
    rightAside.appendChild(tp);
    rightAside.appendChild(card);
    // The window is mounted OUTSIDE the rails so the backdrop covers them:
    // a running session owns the screen, top to bottom.
    root.appendChild(rightAside);
    root.appendChild(win);
  } else {
    tp.appendChild(qp);
    rightAside.appendChild(tp);
    root.appendChild(rightAside);
  }

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
  // #299: on the new loop the right column is the Bank & Feed rail — the
  // Processing Plant left it for the session window.
  railRightBtn.setAttribute("aria-label",
    sessionMode ? "Toggle the Bank & Feed rail" : "Toggle the Processing Plant panel");
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
    railRightBtn.title = sessionMode
      ? (railRightCollapsed ? "Expand the Bank & Feed rail" : "Collapse the Bank & Feed rail")
      : (railRightCollapsed ? "Expand the Processing Plant panel" : "Collapse the Processing Plant panel");
    // The drawer cue follows the ACT of this click, so the dataset (read by
    // the sound delegation) is set for the state the click is ABOUT to enter.
    railLeftBtn.dataset.sfx = railLeftCollapsed ? "close" : "open";
    railRightBtn.dataset.sfx = railRightCollapsed ? "close" : "open";
    // A folded panel is a 28px sliver; its controls are off-viewport and must
    // leave the tab order with it — otherwise a keyboard walk lands on tabs
    // and shop rows nobody can see. `inert` on the panel CONTENT (never on
    // the aside: the key lives beside the panel and stays reachable) removes
    // them from focus, pointer and AT traversal, and undoes itself on unfold.
    bp.inert = railLeftCollapsed;
    tp.inert = railRightCollapsed;
    // #299: the plant card is rail content too — it leaves the tab order
    // with the column, same rule as the trade panel beside it.
    if (plantCard) plantCard.inert = railRightCollapsed;
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
  // L8 (#222): the objective line — one line that always says the current goal
  // on the new loop. It sits below the top bar like the banner, but it is not
  // the banner: it is the loop made legible (connect→tune→earn→spend) and it
  // hides only when a banner with higher priority owns the lane.
  const objectiveEl = h("div", "objective hidden");
  objectiveEl.id = "iso-objective";
  root.appendChild(objectiveEl);
  // L8 (#222): the optional quests — the objective line's siblings, and its
  // opposite in tone: the objective says what the LOOP needs next, a quest
  // suggests what a character would like. One slim line while it is collapsed
  // (the #187 rule: never two lines of chrome over the map), the offers when
  // the player opens it, a ✕ on every row and a Hide for the panel, because
  // the one thing this chrome must never look like is a to-do list that has to
  // be finished.
  const questsEl = h("div", "quests hidden");
  questsEl.id = "iso-quests";
  const questsHead = h("button", "quests-head") as HTMLButtonElement;
  questsHead.type = "button";
  questsHead.innerHTML = `<span class="q-flag" aria-hidden="true">⚑</span>`
    + `<span class="q-title">Quests</span>`
    + `<span class="q-count"></span>`
    + `<span class="q-caret" aria-hidden="true">▸</span>`;
  const questsCount = questsHead.querySelector(".q-count") as HTMLElement;
  const questsList = h("ul", "quests-list hidden");
  questsEl.append(questsHead, questsList);
  root.appendChild(questsEl);
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

  // ── gem / HUD DOM state ──────────────────────────────────────────────────
  const gemEls = new Map<number, HTMLElement>();
  let selected: { r: number; c: number } | null = null;
  const feedEntries: { who: string; colour: string; text: string }[] = [];
  // U1: the restored HUD paints on the game's rAF loop. Re-rendering the
  // Black-Market grid on every frame would detach a button
  // between its pointerdown and pointerup, so a real click could be lost.
  // Render it only when its visible content actually changed (L11 #226 retired the offer lists).
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
  // L13 (#228): what the Road button promises. Under the new loop paving pays
  // nothing (L2 made dirt free; the ★ moved to depot types, rungs and city
  // tiers), so the line sells the reason Road is still worth laying — it is
  // the fast transport tier — instead of a quarter-star nobody will be paid.
  // The retired loop (`?loop=old`, story, multiplayer) still PAYS its paving
  // ★ (VP-01), so its button must keep promising it — the rule is the loop's,
  // and the chrome forks on `opts.newLoop` exactly like the rail strip does.
  const newLoopChrome = opts.newLoop === true;
  const roadRule = newLoopChrome ? "faster hauling · 0★" : `+${VICTORY.upgrade}★ paving dirt`;
  const TOOLS: { key: UiTool; label: string; sub: string }[] = [
    // The pointer goes first: it is the hand you hold between builds —
    // hover to read what a tile is, click to select it, right-click (or Q)
    // to return here from any tool.
    // MOBILE-01: "Q / right-click" is noise on a phone — the tap and the
    // held-tool chip are the touch hand's versions of the same two ideas.
    { key: "select", label: "Select", sub: coarsePointer() ? "Point & inspect · tap reads a tile" : "Point & inspect · Q / right-click" },
    // L2 (#216): under true dirt is free — the button says so (`costMarkup({})`
    // renders "free"), instead of quoting a price the placement never charges.
    { key: "dirt", label: "Dirt Road", sub: `${costMarkup({})} · 0★` },
    // L13 (#228): paving stopped scoring under the new loop — the ★ come from
    // depot types, tree rungs and city tiers now. A button that still promised
    // "+0.25★ paving dirt" would sell the player the one plan the scoreboard
    // no longer pays for. Road is still worth building (it is the fast
    // transport tier, `TRANSPORT.road.factor`), so the line says THAT instead.
    { key: "road", label: "Road", sub: `${costMarkup(TRANSPORT.road.cost)} · ${roadRule}` },
    // PP-05: `depotSub` refreshes the Depot line below as the free-setup
    // allowance burns down. L5 (#219): on the new loop the price is the
    // industry's own mix, so the line says "from …" rather than quoting the
    // retired loop's single mix.
    { key: "harvester", label: "Depot", sub: depotButtonMarkup(0, { newLoop: newLoopChrome, tier: 0 }) },
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
      const afford = (seat.res.gold ?? 0) >= s.gold;
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
      .every(([k, v]) => (seat.res[k] ?? 0) >= v);
    const sb = h("button", "sab-btn secure-btn" + (secOn ? " active" : secAfford ? "" : " disabled"));
    sb.innerHTML = `<div class="sab-top"><b>🛡️ ${SECURITY.name}</b><span class="sab-cost">${costStr(SECURITY_ISO)}</span></div>` +
      `<div class="sab-desc">${SECURITY.desc}</div>`;
    sb.disabled = !secAfford;
    sb.dataset.black = "security";
    sb.onclick = () => hooks.onBlackAction("security");
    sabList.appendChild(sb);

  }

  // ── the bank ──────────────────────────────────────────────────────────────
  // L11 (#226), restored by L17 (#245): ONE exchange, and its gate. Gold never
  // appears in either select — it pays for Black Market sabotage and nothing
  // else (PP-08) — and under the new loop a cargo the seat has not unlocked is
  // offered as a DISABLED row that says which rung it wants, so the panel can
  // never promise an exchange the rule refuses. `updateBankButtons` re-reads
  // both the purse and the rungs, so a rung won in a tuning session opens the
  // select the same frame the session closes.
  const mkSel = (value: Cargo) => {
    const sel = h("select", "res-sel") as HTMLSelectElement;
    for (const k of CARGOES) {
      if (k === "gold") continue;                    // PP-08: outside the bank
      const o = document.createElement("option");
      o.value = k;
      o.text = CARGO[k].name;
      sel.appendChild(o);
    }
    sel.value = value;
    return sel;
  };
  const bankGive = mkSel("stone");
  const bankWant = mkSel("ore");
  bankGive.dataset.f = "bank-give";
  bankWant.dataset.f = "bank-want";

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
  const bankNote = h("div", "pane-note");
  bankPane.appendChild(bankNote);
  // L1a (#232) / L9 (#224) / L17 (#245): where the Black Market hangs. Its
  // rows are the same on both loops; only the shelf moves. The new loop keeps
  // the shop in the BUILD column — the Bank tab hosts only the bank (and, on
  // the map, the town's middle building is the door to it); the shipped loop
  // leaves the shop where it has always been: under the Bank tab, below the
  // Gold rule, as the pane's LAST panel (the shape PP-08 shipped and the
  // specs assert).
  if (opts.newLoop === true) left.appendChild(sp);
  else bankPane.appendChild(sp);

  /**
   * The panel's gate line, spelled for the loop it is running under. `null`
   * rungs = the shipped loop, where the bank has no tree to respect.
   */
  function bankNoteText(): string {
    const unlocked = seat.unlocked;
    if (unlocked === null) {
      return `The bank always trades ${BANK_RATE} of one good for 1 of another. No rival required, no waiting. ${cargoIconHtml("gold")} ${GOLD_RULE}`;
    }
    const open = CARGOES.filter((k) => bankAllowed(k, unlocked)).map((k) => CARGO[k].name);
    return `The bank trades ${BANK_RATE} of one good for 1 of another — but only within the rungs you have unlocked: `
      + `<b>${open.join(", ")}</b>. It rebalances what the tree has already given you; it never skips a rung. `
      + `Play a Depot's tuning session to unlock the next one. ${cargoIconHtml("gold")} ${GOLD_RULE}`;
  }

  /** Locked options are disabled and labelled with the rung they want. */
  function paintBankOptions() {
    const unlocked = seat.unlocked;
    for (const sel of [bankGive, bankWant]) {
      for (const o of Array.from(sel.options)) {
        const cargo = o.value as Cargo;
        const allowed = bankAllowed(cargo, unlocked);
        o.disabled = !allowed;
        o.text = allowed || unlocked === null
          ? CARGO[cargo].name
          : `${CARGO[cargo].name} — needs rung ${bankTier(cargo)}`;
      }
      // A select whose value is locked would show a row the click refuses;
      // fall to the first open cargo instead.
      if (!bankAllowed(sel.value as Cargo, unlocked)) {
        const fallback = CARGOES.find((k) => bankAllowed(k, unlocked));
        if (fallback) sel.value = fallback;
      }
    }
    bankNote.innerHTML = bankNoteText();
  }

  function updateBankButtons() {
    const give = bankGive.value as Cargo;
    const want = bankWant.value as Cargo;
    const unlocked = seat.unlocked;
    bankBtn.disabled = give === want
      || !bankAllowed(give, unlocked) || !bankAllowed(want, unlocked)
      || (seat.res[give] ?? 0) < BANK_RATE;
  }
  for (const input of [bankGive, bankWant]) {
    input.addEventListener("input", () => { updateBankButtons(); });
    input.addEventListener("change", () => { updateBankButtons(); });
  }

  /**
   * The exchange. The GAME owns it (`hooks.onBank`): it holds the tier gate,
   * the relay for a guest seat and the publish for a host — the chrome only
   * says what happened.
   */
  function doBank() {
    const give = bankGive.value as Cargo;
    const want = bankWant.value as Cargo;
    if (give === want) { toast("Pick two different goods to trade.", "danger"); return; }
    // PP-08: the bank never turns Gold into construction stock (or back) —
    // defence in depth, the select cannot offer it.
    if (give === "gold" || want === "gold") { toast(`🪙 ${GOLD_RULE}`, "danger"); return; }
    const how = hooks.onBank(give, want);
    if (how === "relayed") {
      // #114: a guest's bank trade is a request until the host accepts it.
      toast(`Sent to the host — the trade lands once they confirm.`, "info");
      feed(`Bank request sent: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}`);
    } else if (how === "done") {
      toast(`Bank: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}.`, "success");
      // W6: bank trades are trades — log them even with no rival around.
      feed(`Bank: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}`);
    } else if (!bankAllowed(give, seat.unlocked) || !bankAllowed(want, seat.unlocked)) {
      const locked = [give, want].find((c) => !bankAllowed(c, seat.unlocked))!;
      toast(`${CARGO[locked].name} needs rung ${bankTier(locked)} — tune a Depot to unlock it.`, "danger");
    } else {
      toast(`The bank wants ${BANK_RATE} ${CARGO[give].name}.`, "danger");
    }
    renderBank();
  }

  /**
   * The Bank pane's paint, gated by `lastBankKey` (the purse, the rungs and
   * the two selections folded into one string): a per-frame rebuild would
   * detach a select between its pointerdown and pointerup — the bug the old
   * offer list had — while a balance that changed under a STABLE panel (the
   * guest's authoritative purse sync, most visibly) must repaint, or the
   * Exchange button stays disabled after the purse has long funded it.
   */
  let lastBankKey = "\u0000";
  function renderBank() {
    const unlocked = seat.unlocked;
    const bankKey = CARGOES.map((c) => seat.res[c] ?? 0).join(",")
      + "#" + (unlocked === null ? "tree" : unlocked)
      + "#" + bankGive.value + ">" + bankWant.value;
    if (bankKey === lastBankKey) return;
    lastBankKey = bankKey;
    paintBankOptions();
    updateBankButtons();
  }

  /**
   * PP-08: Gold is never a trade good and never a construction stock, so it is
   * not a cross-bounty choice either — the bounty pays in the five cargos the
   * depot tree uses. (It was the market composer's list before L11 / #226;
   * the bounty chooser is the only reader left.)
   */
  // ── feed ─  // ── feed ──────────────────────────────────────────────────────────────────
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
  let currentTab: "bank" | "plant" | "feed" | null = null;
  function setTab(t: "bank" | "plant" | "feed") {
    // PP-14b: a pending cross bounty lives inside the plant panel — switching
    // away would hide it mid-pick and the cascade would sit unseen until the
    // timer answers for the player. Stay put instead. #299: on the new loop
    // the plant is not a tab at all, so any switch would hide the bounty.
    if (pickEl && (t !== "plant" || sessionMode)) {
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
    // #299: the plant pane only answers to the tab strip while it IS a pane.
    // On the new loop its visibility is the session window's business
    // (`setSessionWindow`), and there is no plant tab to light up.
    if (!sessionMode) {
      tabPlant!.classList.toggle("active", t === "plant");
      qp.classList.toggle("hidden", t !== "plant");
    }
    tabBank.classList.toggle("active", t === "bank");
    bankPane.classList.toggle("hidden", t !== "bank");
    tabFeed.classList.toggle("active", t === "feed");
    feedPane.classList.toggle("hidden", t !== "feed");
    // MOBILE-02: the plant tab re-fits the board — the full-bleed sheet only
    // leaves a measurable slot once this pane is the visible one.
    // FIT-01: and so does the desktop — the fit clamps on the measured plant
    // column, which has no box while another tab hides it, so a window
    // resized over Bank/Plant/Feed would come back to a stale board.
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
  // Hover is a CSS glow behind the gem (styles.css) — nothing moves. Press and
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
    if (!drag) return;
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
  // A hidden tab voids the gesture too — the hand is gone, and a `.dragging`
  // gem must never survive the layout it was held in. No click follows, so
  // the swallow flag stays untouched; the hint re-arms on return.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelDrag();
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

  // L15 (#230): blessings retired — no chooser.
  let pickEl: HTMLElement | null = null;
  // L15: crossCancel retired

  function popup(gains: Partial<Record<ResKey, number>>, label: string, score?: number) {
    // SFX-01: the chute pays out. Only when cargo actually landed — an empty
    // popup is a cascade's COMBO label, which already rang its bell. L12
    // (#227): a score-only popup stays quiet too; the pass already has its
    // match sound, and a second chime on every match is the noise.
    if (Object.keys(gains).length) sfx.play("harvest");
    // AUDIT 2026-09-11 — ResKey → Cargo: sheep 🐑 has no purse entry,
    // brick 🧱 has none either. The popup must show the Cargo the purse
    // actually received (sheep→oil 🛢️, brick→stone 🪨, wheat→grain 🌾)
    // via GEM_TO_CARGO, or a chain's 2× would float a dead sheep icon.
    const parts = (Object.keys(gains) as ResKey[]).map((k) => {
      const cargo = GEM_TO_CARGO[k as ResKey];
      const icon = cargo ? cargoIconHtml(cargo) : RES[k as ResKey].icon;
      return `<span>+${gains[k as ResKey] ?? 0}${icon}</span>`;
    }).join("");
    // L12 (#227) — the new loop's readout: the pass's SCORE in one number, no
    // cargo icons to draw wrong. The old "+N cargo" popups are what this
    // replaces; gains and score never mix in one popup (the new loop has no
    // gains).
    const scorePart = score && score > 0 ? `<span class="hp-score">+${score} score</span>` : "";
    const body = parts || scorePart;
    // A1: no gains means no body — a tokenless cascade still has its COMBO
    // label, and an empty flex row would float an empty box beside it. A
    // popup with neither label nor body floats nothing at all.
    if (!label && !body) return;
    const e = h("div", "harvest-pop");
    e.innerHTML = (label ? `<b class="hp-label">${label}</b>` : "")
      + (body ? `<div class="hp-body">${body}</div>` : "");
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
    // L11 (#226): the local seat is the only player record the chrome holds —
    // a line tagged with anyone else is the rival's, and the colour says so.
    const mine = !who || who === seat.name;
    feedEntries.unshift({
      who: who ?? seat.name,
      colour: mine ? "#5aa8ff" : "#ff7a5a",
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
    // #299: on the new loop the board's settled-fit runs from the SESSION
    // WINDOW's slot, not from the economy sheet (the plant is no longer a
    // tab there); the retired loop keeps the trade-sheet gate unchanged.
    const plantUp = sessionMode
      ? !qp.classList.contains("hidden")
      : root.dataset.view === "trade" && !qp.classList.contains("hidden");
    if (isPhoneViewport() && plantUp) {
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
      // #299: the rail column only hosts the board on the retired loop — on
      // the new one the plant lives in the session window, and the column's
      // box says nothing about the board's room. The window measures itself
      // (below) instead.
      if (asideH > 100 && colH > 100 && !qp.classList.contains("hidden") && !sessionMode) {
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
    // #299: with the session window up, the board's room is the WINDOW's, not
    // the column's — the frame caps its height in CSS, the slot flexes, and
    // this pass closes whatever pixels remain (the phone rule, applied to the
    // desktop too while the window owns the screen). Unmeasured (jsdom, or a
    // window mid-transition) keeps the band heuristic, so the numbers tests
    // pin on survive.
    if (sessionMode && sessionWin && !sessionWin.classList.contains("hidden")) {
      const winW = boardSlot.clientWidth, winH = boardSlot.clientHeight;
      if (winW > 100 && winH > 100) {
        z = Math.max(0.3, Math.min(
          z,
          (winW - PHONE_SLOT_PAD_W) / (CELL * board.w),
          (winH - PHONE_SLOT_PAD_H) / (CELL * board.h),
          1,
        ));
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
  // ── L8 (#222): the optional quest panel ──────────────────────────────────
  /** UI-local: the player opened the list (the game owns only "hidden"). */
  let questsOpen = false;
  /** The last list painted — rows are rebuilt only when their text changes. */
  let questsSig: string | null = null;
  /** The last panel the game handed us, so a click can repaint at once. */
  let questsPanel: UiQuestPanel | null = null;

  /**
   * Paint the quest panel: one slim line while it is shut, the offers when the
   * player opened it. Every row carries its own ✕ and the list carries a Hide,
   * so the player can put the whole thing away — and the game remembers both,
   * because "ignoring the quests" has to survive a repaint.
   */
  function renderQuests(panel: UiQuestPanel | null, bannerUp = false): void {
    questsPanel = panel;
    const items = panel?.items ?? [];
    const live = !!panel && items.length > 0 && !bannerUp;
    questsEl.classList.toggle("hidden", !live);
    if (!live || !panel) {
      questsSig = null;
      return;
    }
    const shut = panel.hidden;
    // A banner owns the top lane while it is up: the list stays shut, the one
    // line stays (the banner is the more urgent thing on that patch of screen).
    const open = !shut && questsOpen;
    questsEl.classList.toggle("shut", shut);
    questsList.classList.toggle("hidden", !open);
    questsHead.setAttribute("aria-expanded", String(open));
    questsHead.setAttribute("aria-label", shut ? "Show quests"
      : open ? "Collapse the quest list" : "Expand the quest list");
    questsHead.title = shut
      ? "Quests hidden — click to show them again"
      : "Optional quests — suggestions, never requirements";
    const count = String(items.length);
    if (questsCount.textContent !== count) questsCount.textContent = count;
    const sig = items.map((i) => `${i.id}|${i.who}|${i.text}|${i.progress}|${i.reward}`).join("\u0001");
    if (sig === questsSig) return;
    questsSig = sig;
    questsList.innerHTML = "";
    for (const item of items) {
      const li = h("li", "quest") as HTMLLIElement;
      li.dataset.quest = item.id;
      const meta = h("div", "q-meta");
      const x = h("button", "q-x", "✕") as HTMLButtonElement;
      x.type = "button";
      x.setAttribute("aria-label", `Dismiss the quest from ${item.who}`);
      x.onclick = (ev) => { ev.stopPropagation(); hooks.onQuestAction?.(item.id, "dismiss"); };
      meta.append(h("span", "q-prog", item.progress), h("span", "q-reward", item.reward), x);
      li.append(h("div", "q-who", item.who), h("div", "q-text", item.text), meta);
      questsList.appendChild(li);
    }
    const foot = h("li", "quests-foot");
    const hide = h("button", "q-hide", "Hide quests") as HTMLButtonElement;
    hide.type = "button";
    hide.onclick = (ev) => { ev.stopPropagation(); questsOpen = false; hooks.onQuestAction?.("", "hide"); };
    foot.appendChild(hide);
    questsList.appendChild(foot);
  }

  questsHead.onclick = () => {
    const panel = questsPanel;
    if (!panel) return;
    // Shut by the game's flag: the click is the way back, and the game is the
    // one that remembers it reopened.
    if (panel.hidden) {
      questsOpen = true;
      hooks.onQuestAction?.("", "show");
      return;
    }
    questsOpen = !questsOpen;
    renderQuests(panel);
  };

  /** L8 (#222): per-cargo /s readout beside each chip. */
  const chipRates = new Map<Cargo, HTMLElement>();
  let lastRatesSig = "\u0000";
  /** L16 (#231): the chip MEDALLION per cargo — the node the `.full` state classes. */
  const chipEls = new Map<Cargo, HTMLElement>();
  let lastVpHtml = "";
  const kingRows = new Map<number, { row: HTMLElement; cls: string; colour: string; tip: string; html: string }>();
  let lastModebarInfo: string | null = null;
  let lastInspectHtml = "";

  function renderHUD(
    purse: Partial<Record<Cargo, number>>,
    players: UiPlayer[],
    portrait: Portrait,
    target: number,
    rates?: Partial<Record<Cargo, number>>,
    storageCap?: number,
  ) {
    // L8 (#222): the income readout — per-second, per resource, on the chip bar
    // itself. A new Depot being connected or a better tune visibly lifts the
    // number before the purse has banked it, so the economy is read where it
    // is earned.
    const ratesSig = CARGOES.map((c) => String(rates?.[c] ?? "-")).join(",");
    const ratesChanged = ratesSig !== lastRatesSig;
    if (ratesChanged) lastRatesSig = ratesSig;
    for (const k of CARGOES) {
      let num = chipNums.get(k);
      let chip = chipEls.get(k);
      let rateEl = chipRates.get(k);
      if (!num || !chip) {
        chip = h("div", "chip");
        chip.style.setProperty("--c1", CARGO[k].c1);
        chip.style.setProperty("--c2", CARGO[k].c2);
        chip.innerHTML = `<span class="chip-ic">${cargoIconHtml(k)}</span><span class="chip-n"></span><span class="chip-r hidden"></span>`;
        // PP-08: the Gold chip states what the currency is for, so a player
        // holding coins never mistakes them for construction stock.
        if (k === "gold") chip.title = GOLD_RULE;
        chips.appendChild(chip);
        num = chip.querySelector(".chip-n") as HTMLElement;
        rateEl = chip.querySelector(".chip-r") as HTMLElement;
        chipNums.set(k, num);
        chipEls.set(k, chip);
        chipRates.set(k, rateEl);
      }
      // L16 (#231): with a storage cap the chip counts TOWARD something —
      // "amount / cap" — and a cargo sitting at its cap wears the full state,
      // because every tick past it is income the clock is dropping. Without a
      // cap (the shipped loop, dev's unlimited purse) the chip is the bare
      // amount it always was, byte for byte.
      const amount = purse[k] ?? 0;
      const full = storageCap !== undefined && amount >= storageCap;
      const text = storageCap === undefined ? String(amount) : `${amount}/${storageCap}`;
      if (num.textContent !== text) num.textContent = text;
      if (ratesChanged && rateEl) {
        const r = rates?.[k] ?? 0;
        // Show at most one decimal, hide when the cargo is not ticking (0/s).
        const show = Math.abs(r) >= 0.05;
        const txt = show ? `+${r.toFixed(1).replace(/\.0$/, "")}/s` : "";
        if (rateEl.textContent !== txt) rateEl.textContent = txt;
        rateEl.classList.toggle("hidden", !show);
        // Title keeps the precise number for hover.
        const title = show ? `${r.toFixed(2)}/s from connected Depots` : "";
        if (rateEl.title !== title) rateEl.title = title;
      }
      // The class and the tooltip flip together, and only on the flip — a
      // per-frame write would churn the style recalc the retention tests
      // watch for. Gold keeps its currency rule, with the cap appended.
      if (chip.classList.contains("full") !== full) {
        chip.classList.toggle("full", full);
        if (full) {
          chip.title = k === "gold"
            ? `${GOLD_RULE} — storage full`
            : `Storage full — clock income past ${storageCap} is lost. A city upgrade raises the cap.`;
        } else if (k === "gold") {
          chip.title = GOLD_RULE;
        } else {
          chip.removeAttribute("title");
        }
      }
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

  // ── L4 (#218): the tuning plate, and the board's session gate ─────────────
  /** Yield as the plate prints it: never more than two decimals, and never a
   *  trailing zero (1.6, 1.62, 2.0) — the same number the depot stores. */
  const fmtYield = (y: number) => y.toFixed(2).replace(/0$/, "");
  /** No-session copy. One line, and it names the building that opens one. */
  const TUNING_IDLE = "No tuning session — build a Depot to raise its yield.";
  /** L6 (#220): "Retune ⛏️ Ore Depot (now ×1.12)" for the plate's offer. */
  const retuneLabel = (r: UiRetuneOffer): string =>
    `Retune ${r.cargo ? `${CARGO[r.cargo].icon} ${CARGO[r.cargo].name}` : "Depot"} (now ×${fmtYield(r.yield)})`;
  let lastTuningSig = "\u0000";
  /**
   * #299 — the ONE writer that opens or closes the session window (new loop
   * only; on the retired loop `sessionWin` is null and this is never called).
   * Opening moves the tuning plate INTO the window and the map, the rails and
   * the phone nav go inert behind the backdrop — the session is the main
   * screen while it runs, and the player leaves it through the plate's own
   * Finish / Abandon keys, never around it. Closing does the reverse: the
   * plate rides back to the rail card, the board goes down, the map wakes.
   *
   * Idempotent by design: the game's `openSessionBoard`/`closeSessionBoard`
   * calls and `paintTuning`'s per-frame reconciliation both route here, and
   * a pass that would change nothing writes nothing.
   */
  function setSessionWindow(open: boolean): void {
    if (!sessionWin) return;
    const wasOpen = !sessionWin.classList.contains("hidden");
    if (wasOpen === open) return;
    sessionWin.classList.toggle("hidden", !open);
    // The plant pane's own visibility mirrors the window — `isQuarryOpen`,
    // the phone fit and the rail-fit guard all read it, and on this loop it
    // means exactly "the board is up".
    qp.classList.toggle("hidden", !open);
    // The rail card shows the plant only while it holds it: between sessions.
    plantCard!.classList.toggle("hidden", open);
    root.dataset.session = open ? "1" : "0";
    // One plate, two hosts: the window during a session, the rail card when
    // the session is over. Moving it is safe — every paint writes through
    // these same node references — but it must land where it was built:
    // right under the plant head, ABOVE the board, so it rides in ahead of
    // the (window-hidden) upgrade bar rather than trailing after the slot.
    if (open) qp.insertBefore(tuningPlate, upbar);
    else plantCard!.appendChild(tuningPlate);
    // The lock: map, rails and nav stop answering input while the window is
    // up — inert takes the pointer events, the tab order and AT traversal,
    // and the backdrop over the rest swallows the presses aimed at them.
    mapHost.inert = open;
    left.inert = open;
    rightAside.inert = open;
    mobileNav.inert = open;
    if (!open) sfx.play("close");
    if (open) sessionFrame!.focus({ preventScroll: true });
    // The board re-fits to its new box: measured in the open window (the
    // phone grow-fit and the desktop window clamp both key off it), and back
    // to the plain column once the window comes down.
    responsiveZoom();
  }

  /**
   * Paint the plate and gate the board.
   *
   * `undefined` is NOT the new loop — the shipped always-on plant, untouched.
   * `null` is the new loop between sessions: the board comes DOWN (the grid
   * is hidden outright, so there is nothing to swipe at) and the plate says
   * how to open it. A session puts the board back and counts it down.
   *
   * The repaint is gated on a signature like every other per-frame surface
   * here, so a still session writes nothing.
   */
  function paintTuning(t: UiTuningSession | null | undefined, idle?: UiTuningIdle) {
    const sig = t === undefined ? "legacy"
      // L6: the idle signature carries the offer, so a Depot cooling into (or
      // out of) a re-match repaints the plate without a poll of its own.
      // L5: a LIVE session's signature carries its KIND as well — a city
      // session has no cargo, and the two promises read very differently, so
      // switching between them must repaint.
      // #301: busy is part of the sig — Finish is disabled only while the
      // board animates, not when moves run out, so a cascade must repaint.
      : t === null ? `none:${idle?.retune ? `${idle.retune.depotId}:${idle.retune.yield}` : "-"}`
        : `${t.kind}:${t.cargo ?? "-"}:${t.movesLeft}:${t.moves}:${t.score}:${t.yield}:${t.busy ? 1 : 0}`;
    if (sig === lastTuningSig) return;
    lastTuningSig = sig;
    if (t === undefined) {
      // Not the new loop: no plate, board exactly as it always was.
      liveTuning = null;
      abandonConfirmUntil = 0;
      abandonConfirmScore = -1;
      tpAbandon.textContent = "Abandon — default yield";
      tuningPlate.classList.add("hidden");
      tuningPlate.classList.remove("idle");
      qp.classList.remove("tuning-idle");
      boardWrap.classList.remove("hidden");
      // L6 (#220): the re-match key belongs to a session that does not exist on
      // this loop, so it is taken out back here rather than left visible under a
      // hidden plate — `#iso-tuning-retune` is hidden unless the new loop is
      // running AND a Depot owes a re-tune.
      tpRetune.classList.add("hidden");
      return;
    }
    tuningPlate.classList.remove("hidden");
    const live = t !== null;
    // #299: on this loop the session IS the window — an open session stands
    // it up over the map (plate and board riding with it), and the idle
    // signal puts the plate back in the rail card and takes the window down.
    // `setSessionWindow` no-ops when the state already matches, so this and
    // the game's explicit open/close calls can never fight.
    if (sessionMode) setSessionWindow(live);
    tuningPlate.classList.toggle("idle", !live);
    qp.classList.toggle("tuning-idle", !live);
    // The board is up for a session and down between them. A session that has
    // spent its last move stays up until its cascade settles (the game closes
    // it), so this is never "the board vanished mid-match".
    boardWrap.classList.toggle("hidden", !live);
    tpIdle.classList.toggle("hidden", live);
    tpHead.classList.toggle("hidden", !live);
    tpRow.classList.toggle("hidden", !live);
    if (!live) {
      liveTuning = null;
      abandonConfirmUntil = 0;
      abandonConfirmScore = -1;
      tpAbandon.textContent = "Abandon — default yield";
      // L6 (#220): between sessions the plate carries the difficulty's answer.
      // The re-match key appears when the game says a Depot owes one; Easy's
      // rules never say it, so Easy keeps the shipped line verbatim (and
      // `iso-l6-difficulty.test.ts` pins exactly that).
      const offer = idle?.retune ?? null;
      tpRetune.classList.toggle("hidden", !offer);
      tpRetune.disabled = !offer;
      tpIdleText.textContent = offer
        ? `Your weakest Depot is at ×${fmtYield(offer.yield)}${
          offer.risks ? " and cooling — a better session raises it, a poor one costs you." : " — you are owed a re-match."}`
        : TUNING_IDLE;
      tpRetune.textContent = offer ? retuneLabel(offer) : "Retune";
      tpRetune.title = offer
        ? `Open a tuning session for Depot #${offer.depotId} — ${
          offer.risks ? "Hard: the new level replaces it, so play it well." : "your yield can only go up."}`
        : "No re-match is owed on this difficulty";
      return;
    }
    // L5 (#219): a session confirms one of two things — a Depot's yield, or
    // the city's base-rate bonus for EVERY connected Depot. Same board, same
    // budget, different promise, so the plate's words say which.
    const town = t.kind === "town";
    tpTitle.textContent = town
      ? "🏙️ Tuning the City"
      : t.cargo ? `Tuning ${CARGO[t.cargo].icon} ${CARGO[t.cargo].name} Depot` : "Tuning";
    // #299: the window's title says WHICH job the session is for — the plate
    // already names the cargo, the tooltip pins the exact Depot on the map.
    tpTitle.title = town
      ? "A city-upgrade session: the score lifts the base rate of every connected Depot"
      : Number.isFinite(t.depotId) && (t.depotId ?? -1) >= 0
        ? `Harvester Depot #${t.depotId} — the lot the Depot stands on is the one this score tunes`
        : "The Depot that was just placed";
    // Keep the live session for the abandon confirm gate above.
    liveTuning = t;
    tpMoves.textContent = `${t.movesLeft}/${t.moves} moves`;
    tpScore.innerHTML = `Score <b>${t.score}</b>`;
    tpYield.innerHTML = town
      ? `Base rate <b>+${Math.round(t.yield * 100)}%</b>`
      : `Yield <b>×${fmtYield(t.yield)}</b>`;
    // #301: Finish is enabled when moves are 0 — it is the ONLY highlighted
    // action then. It is disabled only while the board is animating.
    const busy = !!t.busy;
    tpFinish.disabled = busy;
    tpAbandon.disabled = busy;
    tpFinish.classList.toggle("primary", t.movesLeft === 0);
    tpFinish.title = busy
      ? "Board animating — wait for the cascade to settle"
      : town
        ? `Close the session — every connected Depot then earns +${Math.round(t.yield * 100)}% base rate`
          + ` (abandoning refunds the upgrade)`
        : `Close the session — this Depot then ticks at ×${fmtYield(t.yield)}`
          + ` (abandoning pays ×${fmtYield(t.abandonYield)})`;
    tpAbandon.title = busy
      ? "Board animating — wait for the cascade to settle"
      : town
        ? "Abandon — close without playing it out. The upgrade is refunded and the city is unchanged"
        : `Abandon — close without playing it out. The Depot keeps the default yield ×${fmtYield(t.abandonYield)}`;
    // #301: keep abandon label honest — if confirm window expired or score is 0,
    // show the default label, not a stale "Confirm abandon?" from a previous score.
    const now = Date.now();
    if (t.score === 0 || abandonConfirmScore !== t.score || abandonConfirmUntil < now) {
      if (abandonConfirmUntil !== 0 || tpAbandon.textContent?.startsWith("Confirm")) {
        tpAbandon.textContent = "Abandon — default yield";
      }
      if (abandonConfirmUntil < now) {
        abandonConfirmUntil = 0;
        abandonConfirmScore = -1;
      }
    }
  }

  const costSig = (cost: Partial<Record<Cargo, number>>) =>
    Object.entries(cost).map(([k, v]) => `${k}${v}`).join(",");

  // ── L5 (#219): the city key, painted from `UiState.town` ──────────────────
  /** Last painted city key, so a still one writes nothing (same rule as the
   *  plate above). */
  let lastTownSig = "\u0000";
  /**
   * Paint the city upgrade's key.
   *
   * `undefined` / `null` = not the new loop (or no city state to show): the
   * key does not exist. A record always paints it; the game's `note` is the
   * reason it is off, and the label always states the complete price — the
   * same "show the cost before the click" rule as the Build column.
   */
  function paintTown(t: UiTownState | null | undefined) {
    const sig = t === undefined || t === null ? "none"
      : `${t.level}:${t.maxLevel}:${t.affordable}:${t.bonus}:${t.ceiling}:${t.note ?? ""}:${costSig(t.cost)}`;
    if (sig === lastTownSig) return;
    lastTownSig = sig;
    if (!t) { tpCity.classList.add("hidden"); return; }
    tpCity.classList.remove("hidden");
    if (t.level >= t.maxLevel) {
      tpCity.disabled = true;
      tpCity.classList.add("done");
      tpCity.innerHTML = `🏙 City upgraded — base rate +${Math.round(t.bonus * 100)}%`;
      tpCity.title = "The city is at its top level on the new loop.";
      return;
    }
    tpCity.classList.remove("done");
    tpCity.disabled = !t.affordable;
    tpCity.innerHTML = `🏙 Upgrade city · ${costMarkup(t.cost)} → base rate +${Math.round(t.ceiling * 100)}%`;
    tpCity.title = t.affordable
      ? "Play a tuning session to confirm the upgrade — the score sets how much of the base-rate bonus lands."
      : (t.note ?? "Save up the materials first.");
  }

  // ── paint ─────────────────────────────────────────────────────────────────
  function paint(state: UiState) {
    paintTuning(state.tuning, state.tuningIdle);
    paintTown(state.town);
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
    renderHUD(state.purse, state.players, state.portrait, state.vpTarget ?? VICTORY.target, state.incomeRates, state.storageCap);

    // PP-14b: the reset button counts its cooldown down and disables while
    // the plant re-arms.
    const resetLeft = Math.ceil((state.resetIn ?? 0) / 1000);
    resetBtn.disabled = resetLeft > 0;
    const resetText = resetLeft > 0 ? `♻ Reset ${resetLeft}s` : "♻ Reset";
    if (resetBtn.textContent !== resetText) resetBtn.textContent = resetText;
    // PP-08: the panel re-renders when Gold changes OR when the material
    // affordability of the one non-gold action (Security Forces) flips —
    // otherwise a purse that only gained/lost materials would show a stale
    // button. (L9 #224 retired Repair Crew, the other material row.)
    const matAfford = (cost: Partial<Record<Cargo, number>>) =>
      (Object.entries(cost) as [Cargo, number][]).every(([k, v]) => (seat.res[k] ?? 0) >= v);
    const sabKey = `${seat.res.gold ?? 0}:${matAfford(SECURITY_ISO)}`;
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
    // L8 (#222): the objective line, always visible on the new loop when no
    // higher-priority banner owns the lane. It is the one-line answer to
    // "what do I do next" that the spec asks be always legible.
    {
      const obj = state.objective ?? null;
      const objKey = state.objectiveKey ?? null;
      // Objective hides when a real banner is up — the protest countdown or the
      // disconnect sheet is more urgent than the loop reminder.
      const show = !!obj && !state.banner;
      objectiveEl.textContent = obj ?? "";
      if (objKey) objectiveEl.dataset.key = objKey;
      objectiveEl.classList.toggle("hidden", !show);
      // Banner height var must count the objective when banner itself is hidden,
      // otherwise the Build sheet would slide under the objective line on a
      // phone exactly as it used to slide under a banner.
      // Handled below: bannerH reads the VISIBLE top lane (banner || objective).
    }
    // L8 (#222): the optional quests, under the objective line — the same lane,
    // the same promise ("here is what to do next"), a different voice: a
    // character suggesting, never the game requiring.
    // While a banner is up (a protest countdown, a disconnect, the ending) the
    // lane belongs to it: the panel steps aside and comes back with the banner
    // gone, keeping the player's own open/hidden choice.
    renderQuests(state.quests ?? null, !!state.banner);
    const toolState = state.tool;
    // While the opening Depot is owed, every other build is locked out (the
    // game refuses them too) — greyed so the menu never promises a plant.
    const depotOwed = state.phase === "setup-harvester";
    buildList.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === toolState);
      b.classList.toggle("locked", depotOwed && b.dataset.tool !== "harvester" && b.dataset.tool !== "select");
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
    // L8 (#222): the objective shares that lane, so its height counts when it
    // is the visible one.
    const bannerH = !banner.classList.contains("hidden") ? banner.offsetHeight
      : !objectiveEl.classList.contains("hidden") ? objectiveEl.offsetHeight : 0;
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
    const sub = depotButtonMarkup(state.freeDepots, { newLoop: newLoopChrome, tier: state.depotTier ?? 0 });
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
      // L2 (#216): under true dirt costs nothing, so the button prices {}
      // and an empty purse never disables it.
      const cost = tool === "plant" ? PLANT_COST : tool === "harvester" ? DEPOT_COST
        : tool === "road" ? TRANSPORT.road.cost
        : tool === "dirt" ? {}
        : tool === "platform" ? RAIL_COSTS.platform
        : tool === "raildepot" ? RAIL_COSTS.depot : {};
      // W9: the free setup allowance buys Dirt Roads only.
      // L2: under true dirt is free with or without the allowance.
      const free = tool === "harvester" ? state.freeDepots > 0
        : (tool === "dirt") && true;
      button.disabled = !free && !Object.entries(cost).every(([k, v]) => (state.purse[k as Cargo] ?? 0) >= v);
      button.classList.toggle("disabled", button.disabled);
    });
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
    // L11 (#226): the Bank pane's repaint gate. The key is everything the
    // panel draws from — the purse (affordability), the rungs (which cargos
    // the gate opens) and the two selections — so a host's authoritative
    // purse sync, or a rung won in a tuning session, repaints the panel while
    // a frame that changed none of them leaves the DOM (and any in-flight
    // pointer) alone.
    renderBank();
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
    const TOUCH_CONTROLS = coarsePointer()
      ? `<p><h3>Playing by touch</h3><p><b>One finger</b> pans the map and drags roads tile by tile; <b>a tap</b> places a building or lays a single road tile; <b>two fingers</b> pinch-zoom. The <b>+ / − / 🎯</b> keys at the map's right edge zoom and recentre. The chip at the lower-left names the tool in your hand and <b>puts it down</b> on a tap, and a tap with <b>Select</b> reads the tile under your finger in the inspector. The bottom bar switches <b>Map / Build / Economy</b>.</p>`
      : "";
    sfx.play("open");
    modalRoot.classList.remove("hidden");
    modalRoot.innerHTML = `
      <div class="modal-back"></div>
      <div class="modal box">
        <h2>Hexmatch Industries</h2>
        <p class="sub">Build road & rail to city & depots, tune depots with match-3, earn yield×distance×road. First to <b>${hudVpTarget}★</b> wins.</p>
        <div class="help-cols">
          <div class="help-col"><h3>The Territory</h3><p>Place <b>Depots</b> beside resource nodes. Build <b>Dirt Road</b> (free, ×1.0) and <b>Road</b> (faster hauling ×1.6) and <b>Rail</b> (fastest) to the <b>City</b>. Distance matters — longer lines have smaller <b>distanceFactor</b>. The inspector shows yield, distance and transport per depot.</p>
<p><h3>How you score</h3><p>Roads score nothing. Points come from <b>breadth + depth + network</b>: a <b>depot type running</b> (per distinct cargo, +${VICTORY.loop.type}★, revocable), a <b>depot-tree rung</b> (+${VICTORY.loop.rung}★, never revoked), a <b>city upgrade tier</b> (+${VICTORY.loop.city}★) and a <b>railway platform</b> (+${VICTORY.platform}★). Pool is bigger than the line — many routes to ${hudVpTarget}★.</p><p>Move the camera with <b>WASD</b> or <b>middle mouse</b> (wheel zooms). Right-click drops the tool. The pointer reads the map via the inspector.</p>${TOUCH_CONTROLS}<p>Top-bar <b>Aa Names</b> toggles name tags.</p></div>
          <div class="help-col"><h3>Tuning</h3><p>Building a Depot opens a <b>bounded match-3 session</b>. Score becomes the Depot's <b>yield</b> (×${TUNING.minYield}–×${TUNING.maxYield}). A connected Depot then ticks <b>yield × distanceFactor × transportFactor</b> cargo per clock tick. <b>5 in a row</b> makes a bomb. Finish keeps score; ✕ abandons for default yield. Difficulty changes decay: Easy never cools, Normal never drops, Hard can cool and lower.</p></div>
          <div class="help-col"><h3>Gold & Defence</h3><p><b>Gold</b> 🪙 is from gold-mine access or combos. It buys <b>Black Market</b> sabotage only — never construction. <b>Blockade</b> ⛓ stops an industry's depots for 45s, <b>Protest</b> ✊ shuts a public road for 2:00 (every truck through it stops, including yours). <b>Security Forces</b> (ordinary materials) turn both away. <b>Feed</b> logs every event.</p></div>
        </div>
        <div class="confirm-row">
          <button class="big-btn ghost" id="tourBtn" data-sfx="open">▶ Replay the tour</button>
          <button class="big-btn" id="startBtn">Start Production</button>
        </div>
      </div>`;
    const shut = () => { sfx.play("close"); modalRoot.classList.add("hidden"); };
    (modalRoot.querySelector("#startBtn") as HTMLElement).onclick = shut;
    (modalRoot.querySelector(".modal-back") as HTMLElement).onclick = shut;
    (modalRoot.querySelector("#tourBtn") as HTMLElement).onclick = () => {
      shut();
      if (tourView) return;
      tourView = showTutorial(root, {
        force: true,
        vpTarget: hudVpTarget,
        freeTrack: hudFreeTrack,
        newLoop: newLoopChrome,
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
  renderBank();
  renderBoard();
  responsiveZoom();
  // #299: the boot pane. The retired loop opens on its always-on plant; on
  // the new loop the plant has no tab to open — the rail starts on the Bank.
  setTab(sessionMode ? "bank" : "plant");

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
    isQuarryOpen: () => !qp.classList.contains("hidden"),
    isTradeOpen: () => !bankPane.classList.contains("hidden"),
    openSessionBoard: () => {
      // #299: the session comes UP as its own window over the map. The phone
      // no longer needs the trade sheet — the window is full-bleed there —
      // and the rail needs no unfolding: the board is no longer in it.
      if (sessionMode) { setSessionWindow(true); return; }
      setTab("plant");
      if (isPhoneViewport()) setMobileView("trade");
      else if (railRightCollapsed) { railRightCollapsed = false; paintRails(); }
    },
    openBank: () => {
      // #299: with a session running the window already owns the screen and
      // the rail is inert — the game's refusal toast is the answer here.
      if (sessionMode && sessionWin && !sessionWin.classList.contains("hidden")) return;
      setTab("bank");
      if (isPhoneViewport()) setMobileView("trade");
      else if (railRightCollapsed) { railRightCollapsed = false; paintRails(); }
    },
    closeSessionBoard: () => {
      if (sessionMode) { setSessionWindow(false); return; }
      if (isPhoneViewport() && root.dataset.view === "trade") setMobileView("map");
    },
    showModal,
    hideModal,
    showHelp: () => helpModal(),
  };
}
