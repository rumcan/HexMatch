// ══════════════════════════════════════════════════════════════════════════
// E11 — the playable isometric game.
//
// Wires the E4–E7 modules into something you can actually sit down and play:
//
//   renderer (E4) + track (E5) + economy (E6) + ai (E7)
//
// J1 joins the two halves of the project: the restored match-3 board
// (`src/game/board.ts`) is mounted as the Quarry panel, and its harvest is
// gated by the same reachable-cargo set `economy.ts` already computes for
// scoring. Cargo has ONE owner — the player purse. The board owns gems, the
// market owns live offers (escrow), and neither keeps a balance. The old
// dispatcher was deliberately NOT revived — J2 deleted `hexmap.ts`,
// `actions.ts` and `state.ts` once this file proved the iso grid feeds the
// board, so `src/game/` is now board + trade + constants and nothing else.
//
// The hex + three.js view path (MapView3D.ts, main-legacy.ts) was deleted in
// the E11 cutover. E8's rule is honoured here: free setup builds
// are flagged `free` at the DATA level, never inferred from the phase, so no
// timer can ever claw them back. That is the K1 bug class and it does not
// recur.
// ══════════════════════════════════════════════════════════════════════════
import manifestJson from "../../assets/iso-atlas/manifest.json";
import atlas05 from "../../assets/iso-atlas/atlas@0.5x.png";
import atlas1 from "../../assets/iso-atlas/atlas@1x.png";
import atlas2 from "../../assets/iso-atlas/atlas@2x.png";

// W-series: LAYER atlases (roads / buildings) + seamless ground textures.
import roads05 from "../../assets/layers/roads@0.5x.png";
import roads1 from "../../assets/layers/roads@1x.png";
import roads2 from "../../assets/layers/roads@2x.png";
import buildings05 from "../../assets/layers/buildings@0.5x.png";
import buildings1 from "../../assets/layers/buildings@1x.png";
import buildings2 from "../../assets/layers/buildings@2x.png";
// GFX-01 terrain LOD: the ground textures resolve per quality preset.
import { groundTextureUrls } from "./ground-art";
// TEMP protest crowd — a placeholder png drawn straight on the overlay
// canvas, not an atlas sprite (see `paintProtests` + tools/make-protest-png.mjs).
import protestArt from "../../assets/protest.png";
// Vector roads: the two seamless material swatches
// (tools/make-road-textures.mjs). Loaded independently of every other art
// group, so a slow or failed decode leaves the roads drawn in their flat
// fallback colours rather than leaving them out.
import asphaltTex from "../../assets/roads/asphalt.webp";
import dirtTex from "../../assets/roads/dirt.webp";

import {
  Atlas, buildMasks, buildBuildingMasks, loadBuildingLayers,
  type Manifest, type AtlasImage,
} from "./atlas";
// GFX-01 / PERF-01: the video settings — pixel-detail cap, the miniature
// tilt-shift pass and the performance-mode render policy.
import {
  currentGraphics, setGraphics, subscribeGraphics, QUALITY_MAX_DETAIL,
  renderPolicy, type Quality, type RenderPolicy,
} from "./graphics";
import { createTiltShiftPass } from "./miniature";
import { loadGroundTextures } from "./ground";
import {
  createCamera, centerOnTile, resizeCamera, zoomStepAt, zoomAt, tileToScreenAt,
  createGesture, pointerDown, pointerMove, pointerUp, worldToScreen, panBy,
  bootZoomFor, tapSlop,
  type Camera, type GestureState,
} from "./camera";
import { createLabelLayer, type LabelEntry, type LabelLayer } from "./labels";
import { coarsePointer } from "./touch";
import { IsoRenderer, type World } from "./renderer";
import { DEFAULT_ROAD_STYLE } from "./road-renderer";
import { scatterScenery, type DecalImages, type Scenery } from "./scenery";
import { loadDecalImages, loadScenerySprites } from "./scenery-art";
import { loadVehicleLayers } from "./vehicle-art";
import {
  FIELD_OCC, generateMap, resolveMapSeed, townBuildings, townForSeat, type Grid, type Industry,
} from "./grid";
import {
  createTrack, drawBits, previewDrag, commitDrag, canBuildOn, hasTrack,
  demolishTile, tIdx, canAfford, buildRefusal, seedTownRoads,
  seedPublicRoads, isPublicRoad, isUpgradedRoad, tileCost, structureTiles,
  dirtyTiles, plantFootprintTiles,
  type Track, type TrackKind, type Purse, type DragPreview,
} from "./track";
import {
  industriesInCatchment, ownerIdOf,
  buildAllComponents, resolveConnection, industryLocks, heldIndustries, lockedIndustryIds,
  pickBlockadeTarget, harvesterYield,
  type EconomyState, type Factory, type Harvester,
} from "./economy";
// VP-01: the scoreboard lives in its own module now, because what it counts
// changed from "connections a player has made" to "tiles and plants a player
// has UPGRADED" — a different question about a different part of the state.
import {
  createScoreState, rescore, vpFor, hasWon, fmtVp, paveVp, vpDeltaText,
  victoryBreakdown,
  type ScoreState, type VpEvent,
} from "./victory";
import {
  aiBuildStep, chooseRivalFactorySpot, deepPlanCandidates, planUpgrades, executePaves,
  paveCandidates, rivalPace, type RivalPace,
  planRailMove, executeRailMove,
} from "./ai";
import {
  RIVAL_SKILLS, resolveSkillKey, skillKeyFromUrl, SKILL_STORAGE_KEY, type RivalSkill, type SkillKey,
} from "./skill";
import {
  depotPreviewSprite, planDepotPlacement, planFactoryPlacement, type PlacementPlan,
} from "./placement";
import type { GhostSpec } from "./overlay-art";
import {
  PLANT_COST, PLANT_REFUSAL_TEXT, addPlant, adjacentTown, buildingAt, canAffordPlant,
  chooseAiPlantSpot, plantRefusal, plantsOf, resolvePlantTarget,
} from "./plants";
import {
  CARGO, CARGOES, FACTORY_FOOTPRINT, FACTORY_SPRITE, INDUSTRY_BY_KEY, TRANSPORT,
  BASE_RATE, VICTORY, VP_TARGET, UPGRADE_COST, TUNING,
  type Cargo, type Portrait,
} from "./config";
import {
  DEFAULT_FACING, DEPOT_FACINGS, DEPOT_SPRITES, depotContains, depotFacingOf, depotFacings,
  depotTiles, rotateFacing, type DepotFacing,
} from "./depot";
import { depotYield, distanceFactor, transportFactor } from "./loop";
// L4 (#218): the tuning session — the one thing that sets a depot's yield.
// The rules live in `tuning.ts` (pure, unit-tested); this file is where they
// meet the board, the depot record and the HUD.
import {
  createTuningSession, recordTuningCleared, rivalTuningYield, takeTuningMove,
  tuningMovesLeft, tuningOver, tuningSessionYield, tuningCargoLabel,
  TUNING_ABANDON_YIELD, type TuningSession,
} from "./tuning";
import {
  DEPOT_COST, FREE_SETUP_DEPOTS, costCompact, costLabel, priceDepot, shortfallLabel,
} from "./construction";
import { bankTrade } from "../game/trade";
import type { CrossKind } from "../game/board";
import {
  MAP_W, MAP_H, BANDIT_MS, BLOCK_MS, FOG_MS, PROTEST_MS, SABOTAGE, SECURITY,
  RES_KEYS, choice, tileToScreen, type ResKey,
} from "../game/config";
import { createQuarry, CARGO_TO_GEM, GEM_TO_CARGO, type Quarry } from "./quarry";
import {
  saveKeyFor, SAVEGAME_VERSION, loadRecentSave, clearSave, trackSave, trackRestored,
  type SaveGamePayload,
} from "./savegame-runtime";
import { RES } from "../game/config";
import { createRivalPlant, plantHealth, RIVAL_FROST_MS, RIVAL_GIRDER_MS, RIVAL_SMOG_MS, type RivalStatus } from "./rival-plant";
import { createFloatLayer, type FloatLayer } from "./floats";
import {
  createTruckState, planTrucks, tickTrucks, truckItems, roadRouteForHarvester,
  type Truck,
} from "./vehicles";
import {
  CAR_COUNT, createCarState, planCars, tickCars, carItems,
} from "./cars";
// RAIL-04 (#178): the railway's rules — its own layer, its own structures and
// its own trains — and the loader for its PNGs. Every rule lives in `rail.ts`
// and every cost in `rail.ts`/`config.ts`: this file is the one place those
// rules are APPLIED (tools, clicks, the panel, the frame), never re-derived.
import {
  createRailState, railPreview, buildRail, demolishRail, structureAt, hasRail, railDrawLayer,
  placePlatform, placeDepot, platformRefusal, depotRefusal, resolveAnchor,
  RAIL_COSTS, RAIL_REFUSAL_TEXT, footprintTiles,
  railStructureItems, trainItems, assignLine, renameLine, buyTrain, startLine, recallTrain, sellTrain, tickTrains,
  rotateView, trainOccupies, trainBasedAt, railPanelRows, canPay, costEntries, resaleValue, demolishStructure, PLATFORM_VP,
  footprintFor, depotExit, RAIL_VIEWS, trainTile, ownerRailTiles as ownerRailTilesOf,
  railToWire, applyRailWire, clearRail, railLayerPatch, copyRailLayer,
  type RailState, type RailView, type RailStructure,
} from "./rail";
import { loadRailwaySprites } from "./rail-art";
import { createIsoMarket, toBag, chooseRivalOffer, type CargoBag, type IsoMarket } from "./market";
import { createOriginalUi, RAIL_TOOL_KEYS, type OriginalUi } from "../game/ui";
import { HUD_ICONS, cargoIconHtml, costMarkup } from "../game/hud-icons";
// SFX-01: the UI sound layer. Everything the player DOES on the map (a road
// laid, a building raised, a demolition, a star earned, the final ledger) gets
// one cue from here; the chrome's own clicks and hovers are handled once, by
// the delegation `attachUiSound` installs. docs/SFX-01-ui-sound.md.
import { sfx } from "../audio/sfx";
// AI-02: the start-of-game difficulty prompt (see skill-picker.ts for the
// "when do we ask" contract: only when nothing has chosen yet).
import { promptForRivalSkill } from "./skill-picker";
import { createLoadingScreen } from "./loading-screen";
// TUT-01: the starting tour — one stepped card that walks the whole loop
// (plant → depot → road → board → expand → points) before the first click.
import { showTutorial, type TutorialHandle } from "./tutorial";
import { showSettingsSheet, type SettingsSheetHandle } from "./settings-sheet";
// #121: the destructive asks are painted plates, not `window.confirm` — a
// native dialog is answered `false` (with nothing on screen) inside a frame
// the host sandboxes without `allow-modals`, which is how the hosted build
// runs, and that read to the player as a dead button.
import {
  showConfirm, type ConfirmSheetHandle, type ConfirmSheetOptions,
} from "./confirm-sheet";
// #164: the "opponent left" sheet — a departure is a decision, and a decision
// needs doors. Never a bare sentence, never a bare backdrop.
import { showLeftSheet, type LeftSheetDoors, type LeftSheetHandle } from "./left-sheet";
import {
  buildEnding, showEndingScreen, type DecisiveSource, type EndingScreenHandle,
} from "./ending";
// STORY-01 — the campaign seam: a contract names the rival, the voice, the
// ★ line and the three scenes around the match; the guide rides the wire.
import { CAST, FACE_FOR_DIRECTION, faceOf, type Expression } from "../story/cast";
import { CHAPTERS, EMPLOYER, chapterById, type StoryChapter } from "../story/chapters";
import { createStoryDirector } from "../story/voices";
import { advisorBeats, type AdvisorEvent } from "../story/advisor";
import { advisorEnabled, recordChapterResult } from "../story/progress";
import { showScene, type SceneHandle } from "../story/stage";
import type { UiRivalryBeat } from "../game/ui";
import {
  OIL_DRILLING_SCENE, createBanterDirector, createGoldMineDirector, createRivalDirector,
  type RivalryDirection, type RivalryScene, type RivalryTactic,
} from "./rivalry";
import {
  createIsoDebug, shouldInstallDebugConsole, shouldAutoEnableDebugOverlays,
  shouldAutoEnableRenderLog,
} from "./debug";
import {
  SNAPSHOT_VERSION, applySnapshot, buildSnapshot, joinFromSnapshot,
  type RivalSabotage, type Snapshot, type WirePlayer,
} from "./snapshot";
export { joinFromSnapshot };
// MP-05: the wire. `session.ts` owns roles/roster/chunked state transfer and
// never imports the SDK (transport.ts does); `protocol.ts` owns the message
// union; `delta.ts` owns the per-action patch format. game.ts is the only
// place that knows all three AND the game rules.
import { NetSession, type NetRole } from "../net/session";
import { applyTrackDelta } from "../net/delta";
import { HOST_LEFT_REASON, type DeltaMsg, type IntentMsg } from "../net/protocol";
// #186: the room's match settings — the ★ line, the opening purse and the AI
// seats a hosted game plays by. Pure data with a strict reader, so a hand-built
// `IsoGameOptions` (a test harness, a playtest link) is normalised exactly like
// a block that crossed the wire.
import {
  DEFAULT_MATCH_SETTINGS,
  describeMatchSettings,
  normalizeMatchSettings,
  type MatchSettings,
} from "../net/match-settings";
// RANK-01 (#147): the rated match. `rank-runtime.ts` holds the rating and talks
// to the room; the STORE arrives by injection (see `IsoGameOptions.rank`) so
// this file keeps its promise of booting in a headless test with no SDK, no
// window and no storage — `rankstore.ts`, which does touch the SDK, is built by
// the React layer and handed in.
import { RankRuntime, type RankStore } from "../net/rank-runtime";
import { fmtRating, fmtRatingDelta, type RankVerdict } from "../net/rating";
import type { EndingRankLine } from "./ending";

// ── tuning (E8's rebalance surface, all in one place) ─────────────────────
/**
 * E8: the opening track allowance, as DATA on the player record (`freeTrack`)
 * so no phase inference or timer can ever claw it back (the K1 bug class).
 *
 * W9: it buys DIRT only. A paved Road tile — new, or an in-place upgrade of a
 * Dirt Road — always pays `TRANSPORT.road.cost` / `UPGRADE_COST`, which keeps
 * the gate honest ("wood and stone for the basic Dirt Road, no ore — the paved
 * Road is gated behind an ore mine"): ore is the first real objective after
 * the opening Dirt Road, and the connection cannot skip straight to road VP
 * (3) and ×1.6 throughput for free. The rule itself lives in
 * `freeAllowanceCovers` (`track.ts`) so the human drag and the AI share one
 * cost model (W3).
 *
 * L2 (#216) MVP: under `newLoop` dirt is free, so the allowance buys nothing
 * on the road tiers and simply idles on the player record (still wired and
 * saved — post-MVP rail work puts it behind the paid tiers per the L2 spec).
 */
export const FREE_SETUP_TRACK = 12;
export const HARVEST_MS = 3000;      // economy tick
/**
 * The rival's build clock. VP-01: two numbers now, because a clock that only
 * ever FIRES turns a rival that cannot yet afford anything into a rival that
 * idles for nine seconds at a time — and under a pave-for-points economy, an
 * idle ten seconds is four Ore of tarmac the player gets for free.
 *
 *   AI_BUILD_MS  a turn that achieved something waits this long for the next;
 *   AI_IDLE_MS   a turn that achieved NOTHING (nothing affordable, no plan)
 *                retries in 2.5s instead, right after the next trickle tick
 *                lands. Same purse, same prices, no cheat — just no dead time.
 *
 * AI-01: these two constants are the NORMAL preset's values, exported for the
 * tests that pin them. `aiTick` reads the live difficulty from `skill()`
 * (`skill.ts`) — the easy and hard presets pace the same turn differently.
 */
export const AI_BUILD_MS = 9000;
export const AI_IDLE_MS = 2500;
/**
 * The WASD camera pan speed, in WORLD pixels per second (÷zoom in the frame
 * loop, so the map glides at the same on-screen speed at every zoom step).
 * Shift holds double.
 */
export const PAN_SPEED = 560;
/**
 * VP-01: how much Gold the rival keeps back for its own economy when it buys a
 * Blockade. Gold buys sabotage and nothing else (PP-08), but a rival that has
 * spent its last coin on a hit and cannot pay for its next Depot has won the
 * exchange and lost the turn, so it holds this much in reserve.
 */
export const RIVAL_GOLD_RESERVE = 2;
/** VP-01: how many tiles the rival's banking milestone is worth (see
 *  `paveMilestone`) — 4 paves, 16 Ore, exactly the 1★ a plant costs. */
const PAVE_MILESTONE_TILES = 4;
/**
 * PP-07: start with wood + stone for the basic Dirt Road (12 paid tiles — the
 * E8 opening curve, now that a Dirt Road tile costs 1 Wood + 1 Stone), and no
 * ore: the paved Road stays gated behind an ore mine. Grain and oil are
 * earned, never granted — depot expansion (grain + oil) and the second plant
 * (grain + ore) are what processing and trade are for.
 */
export const START_PURSE: Purse = { wood: 12, stone: 12, ore: 0 };
/**
 * PP-13: what tearing up a DIRT ROAD tile salvages — exactly ONE unit, drawn
 * at random from this list (so: 1 Wood, or 1 Stone).
 *
 * A Dirt Road tile costs `BUILD_COSTS.dirt` = 1 Wood + 1 Stone, so this is a
 * half-refund: re-routing a mistake costs one material per tile instead of
 * two, but demolition is never free and never profitable. The paved Road is
 * excluded on purpose — its price is dominated by 4 Ore and the dirt→road pave
 * exists precisely so a paved Road does not have to be torn up.
 *
 * L2 (#216): the shipped-loop rule only — under `newLoop` dirt is free and
 * salvages nothing (`doDemolish` gates on the flag).
 */
export const DIRT_DEMOLISH_REFUND: Cargo[] = ["wood", "stone"];
/**
 * PP-05: re-exported from `construction.ts` (the authoritative cost module) so
 * the whole E8 tuning surface is reachable from this file, the way
 * `FREE_SETUP_TRACK` is. It is DATA on the player record (`freeDepots`) for the
 * same reason `freeTrack` is — a phase flag can be clawed back, a number
 * cannot — and it is what keeps the opening solvable: Oil needs a Depot, so
 * charging Oil for the FIRST Depot would deadlock the setup.
 */
export { VP_TARGET, FREE_SETUP_DEPOTS };

/** PP-06: `plant` raises an ADDITIONAL processing plant beside another town. */
/**
 * `select` is the pointer: it never builds — it only highlights the tile
 * under the cursor and lets the inspector say what it is. Right-click drops
 * whatever tool is held back to it (the strategy-game "escape to pointer"),
 * and Q does the same from the keyboard.
 */
export type Tool =
  | "select" | "dirt" | "road" | "harvester" | "plant" | "demolish"
  // RAIL-04 (#178): the railway's four verbs. `rail` is a drag (tiles),
  // `platform` and `raildepot` are one-click placements in the current
  // heading, and `railway` is the panel — lines, trains and their actions.
  | "rail" | "platform" | "raildepot" | "railway";

export interface PlayerState {
  /** Stable market index — offers are routed by it (`trade.ts`). */
  i: number;
  id: string;
  name: string;
  colour: string;
  /** The single owner of this player's cargo. Every cargo key is present. */
  purse: CargoBag;
  human: boolean;
  /** E8: free builds are DATA, not an inference from the phase. */
  freeTrack: number;
  /**
   * PP-05: how many more Depots this player may build for free. Every Depot
   * after the allowance runs out pays `DEPOT_COST` (`construction.ts`) — Oil
   * included — and a refused placement leaves the count untouched.
   */
  freeDepots: number;
}

type Phase = "setup-factory" | "setup-harvester" | "play" | "won";

export interface Toast { text: string; kind: "good" | "bad" | "info"; until: number; }

/**
 * #121: a room username is another player's string, and both of the game's
 * text sinks (`ui.toast`, `ui.showModal`) take HTML. The opponent-left line
 * names who went, so the name crosses that boundary as text.
 */
const escText = (s: string): string => s.replace(
  /[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
);

/**
 * MP-05 — how a match is being played (§9).
 *
 *   solo   unchanged from today: AI rival, local save, local seed.
 *   host   the local browser runs the sim for BOTH seats; the guest's seat is
 *          driven by intents from the relay instead of by `ai.ts`, and every
 *          mutation is published as a delta (or a chunked snapshot).
 *   guest  render-only: no AI, no economy tick, no board clock, no save. The
 *          map arrives from the host (chunked snapshot on join/resync, deltas
 *          after), and every player action leaves as an intent.
 *
 * All three fields are optional and defaulting to solo keeps every existing
 * call site — `startIsoGame(root)` in `App.tsx`, the e2e specs, the headless
 * suites — working unchanged.
 */
export interface IsoGameOptions {
  /** Supplied by the room (`welcome.seed`); overrides `resolveMapSeed`. */
  seed?: number;
  role?: NetRole;
  /** The connected session from `src/net/session.ts`. Required for host/guest. */
  net?: NetSession | null;
  /** PP-14b: which tycoon portrait the player picked (defaults to "vex"). */
  portrait?: Portrait;
  /**
   * RANK-01 (#147): this room's matches are RATED. Set by the start screen for
   * quick match only — a hosted room or a shared code is a game between
   * friends, not a ladder match (see `docs/RANK-01-multiplayer-ranking.md`).
   * Requires `rank` and a live `net`; without either, the flag is inert.
   */
  ranked?: boolean;
  /**
   * RANK-01: where the rating is kept. Built by the React layer
   * (`rankStore()` in `src/net/rankstore.ts`) because it is the one ranking
   * module that touches the SDK. Absent means this match cannot be rated, and
   * `ranked` is then ignored rather than half-honoured.
   */
  rank?: RankStore;
  /**
   * STORY-01: the campaign contract this match plays (`CHAPTERS[].id`). Solo
   * only: a contract names its rival, voice, ★ line and seed, and wraps the
   * match in its briefing and epilogue scenes. An unknown id — or a networked
   * seat, where the room owns the match — reads as no story at all.
   */
  story?: string;
  /** STORY-01: the ending's "Continue the campaign" returns through here. */
  onStoryExit?: () => void;
  /**
   * RAIL-05 (#182): force the railway feature flag. Absent, the flag is read
   * from `?rail=1` and is otherwise OFF in every mode until #179/#181 land
   * (the release gate in docs/railway-balance.md).
   */
  rail?: boolean;
  /**
   * L1a (#232): force the new-loop feature flag. Absent, the flag is read
   * from `?loop=new` — DEV builds only, the same guarantee the rail flag
   * carries — and is otherwise OFF in every mode. The new loop is
   * sandbox-only for now: requested in a multiplayer room or a story
   * contract it is ignored and the player is told so.
   */
  newLoop?: boolean;
  /**
   * #186: the rules a HOSTED room plays by — the ★ line, the opening purse and
   * the AI seats. The start screen passes the room's copy; absent (or unreadable)
   * falls back to the session's, and then to the shipped defaults, so a solo
   * boot and a room nobody customised both get exactly today's game.
   */
  settings?: MatchSettings | null;
  /**
   * SETTINGS-01/GFX-01: the in-game ☰ menu's "Quit to main menu" row returns
   * through here — an App-level unmount (the same door `onStoryExit` walks
   * out of), with the save left exactly where a refresh would have found it.
   * Absent means the row is not offered: a surface that boots a match with no
   * menu to go back to (`main.tsx`'s legacy boot, the test harnesses) gets a
   * menu with no broken door.
   */
  onQuitToMenu?: () => void;
  /**
   * #164: the match was DECIDED — the ledger is standing, or a departure was
   * claimed. The React layer uses this to drop the "match in progress" memo
   * (`writeActiveMatch(null)` in `src/net/transport.ts`): a finished match is
   * nothing to rejoin, and a stale memo would offer exactly that on the next
   * boot. Fires once, from `presentEnding`, for every mode — only a networked
   * seat is handed a callback that cares.
   */
  onMatchEnded?: () => void;
}

export function startIsoGame(root: HTMLElement, opts: IsoGameOptions = {}) {
  // ── DOM ────────────────────────────────────────────────────────────────
  // U1: the recovered UI owns the chrome. It is created once the trading
  // state exists (below); the iso canvas layer stack is mounted into its
  // original map-canvas slot. Keep `.iso-game` on the root for the boot test.
  root.innerHTML = "";
  root.classList.add("iso-game");
  let ui: OriginalUi;

  // ── state ──────────────────────────────────────────────────────────────
  // AI-03: the map is REGENERATED from the save's seed on a resume — never a
  // fresh random one. Without this, a refresh grew brand-new towns and public
  // roads and then slapped the restored track layers on top of a layout they
  // were never built for ("public roads don't spawn correctly").
  // Tests opt out of persistence wholesale via __ISO_DISABLE_SAVE — headless
  // suites boot dozens of games in one window and cannot afford a stranger's
  // save resurrecting over their fixtures.
  // MP-05: the wire, if this match is networked. `role` is a HINT from the
  // start screen (MP-06); the room's welcome is the authority and corrects it
  // through `net.role` the moment it lands, so every role-dependent branch
  // below reads `mpRole()` when it runs rather than capturing a value at boot.
  const net = opts.net ?? null;
  const roleHint: NetRole = opts.role ?? (net ? "guest" : "solo");
  const mpRole = (): NetRole => net?.role ?? roleHint;
  const isSolo = () => mpRole() === "solo";
  const isGuest = () => mpRole() === "guest";
  const isMp = () => mpRole() !== "solo";
  // PP-14b: the tycoon portrait the start screen offered (the rival is always
  // Torvin; the player's own is Vex or You).
  const portrait: Portrait = opts.portrait === "you" ? "you" : "vex";
  /**
   * STORY-01: the contract this match plays. Solo only — a networked seat's
   * match belongs to the room — and an id the campaign does not know reads as
   * no story at all, so a stale playtest link can never break a boot.
   */
  const storyChapter: StoryChapter | null =
    opts.story && isSolo() ? chapterById(opts.story) : null;
  const storyOn = storyChapter !== null;
  // RAIL-05 (#182): the feature flag. OFF everywhere by default: the release
  // gate (docs/railway-balance.md) keeps the railway behind it until the
  // construction UI (#179) and multiplayer authority (#181) are done.
  // `opts.rail` turns it on; `?rail=1` does too, but ONLY in a dev build
  // (`vite dev`), so a production deploy can never show the railway.
  const railParam = (() => {
    try { return new URLSearchParams(location.search).get("rail"); } catch { return null; }
  })();
  const railAvailable = opts.rail ?? (import.meta.env.DEV && railParam === "1");
  // L1a (#232): the new-loop MVP flag — the same contract as the rail flag
  // above. OFF everywhere by default: `opts.newLoop` turns it on (tests,
  // harnesses) and `?loop=new` does too, but ONLY in a dev build, so a
  // production deploy can never ship the redesigned loop (the param read is
  // dead code there and the bundler strips it, exactly like rail's).
  const loopParam = (() => {
    try { return new URLSearchParams(location.search).get("loop"); } catch { return null; }
  })();
  const newLoopRequested = opts.newLoop ?? (import.meta.env.DEV && loopParam === "new");
  // The new loop is sandbox-only for now: a networked room or a story
  // contract ignores the request and says so — the toast waits until no boot
  // overlay covers the map (see the frame loop's `loopToastPending`).
  const newLoop = newLoopRequested && isSolo() && !storyOn;
  let loopToastPending = newLoopRequested && !newLoop;
  /** The cast member playing the rival: the contract's, else Torvin as ever. */
  const rivalCast = storyChapter ? storyChapter.rival : "torvin";
  /** The player's own cast id, for every line the wire answers in. */
  const playerCast: "vex" | "you" = portrait;

  // ── #186: what this room plays by ────────────────────────────────────────
  /**
   * The match settings, resolved once and then read live everywhere the rules
   * show up (`winTarget()`, the opening purse, the AI seat).
   *
   * Order of authority, and why it is this way round:
   *   1. what the caller passed — the start screen hands over the room's copy,
   *      and a test harness may pin one the way a playtest link pins a seed;
   *   2. the session's own copy — a game booted straight from a session (the
   *      e2e suites) still gets the rules the room filed;
   *   3. the shipped defaults.
   *
   * A SOLO boot always lands on the defaults, whatever it was handed: a solo
   * game's ★ line belongs to its difficulty (`RIVAL_SKILLS.easy.winTarget`) and
   * a contract's belongs to its chapter, so a settings block there would be a
   * second opinion about a rule that already has an owner. That is also what
   * makes "defaults unchanged" true by construction — the two paths that could
   * carry a surprise (solo, story) never read this record at all.
   */
  const settings: MatchSettings = isSolo()
    ? DEFAULT_MATCH_SETTINGS
    : normalizeMatchSettings(opts.settings ?? null) ?? net?.settings ?? DEFAULT_MATCH_SETTINGS;
  /**
   * #186: does an AI hold the opponent seat?
   *
   * The host filed an AI seat in its lobby and no human took the seat before it
   * started — "seats fill with AI when the host starts early". Read ONCE at
   * boot, which is safe because the room locks that seat the moment the match
   * goes live (`lockAiSeat` in `src/rooms/HexmatchRoom.ts`): a joiner cannot
   * arrive mid-match into a seat a machine is already playing.
   *
   * A GUEST never runs an AI (§ the issue's rule: AI is simulated on the host
   * and synced like any other seat), and a room where a human did take the seat
   * plays the human — the AI is the filler, never a third player. The check is
   * on a KNOWN guest: the host's own lobby is the authority for the seat it
   * filled (and the start screen clears `aiSeats` when a human is sitting
   * there), so a welcome that has not landed yet cannot talk the host out of
   * the machine it just started a match against.
   */
  const aiOpponent = !isSolo() && mpRole() === "host"
    && settings.aiSeats.length > 0
    && !(net !== null && net.info !== null && net.info.roster.length >= 2);
  /** The opening purse every seat starts with (#186). Solo reads the same
   *  numbers through `START_PURSE`, which the suite pins to this default. */
  const startPurse: Purse = settings.startPurse;

  // PP-14b: the Processing Plant reset's cooldown. `lastResetAt` starts at
  // -Infinity so the very first reset of a boot is always allowed.
  const RESET_COOLDOWN_MS = 30_000;
  let lastResetAt = -Infinity;
  /** #116: the guest seat's own reset clock, enforced by the host per seat —
   *  mirrored locally so the guest's button can count it down. */
  let guestResetAt = -Infinity;

  // A networked match NEVER touches the local save: the room owns the match,
  // and a save written mid-game would resurrect as a solo world on the next
  // boot (and, on the guest, restore a map the host never generated).
  const savesOff = isMp() || !!(window as unknown as Record<string, unknown>).__ISO_DISABLE_SAVE;
  // STORY-01 fix: each mode has its own save slot — the sandbox's, or this
  // contract's. A contract that read the sandbox save resumed that world (its
  // seed, the rival's network, phase "play") against the chapter's lower ★
  // line and lost on the first rescore.
  const saveKey = saveKeyFor(storyChapter?.id);
  const bootSave = savesOff ? null : loadRecentSave(Date.now(), saveKey);
  // STORY-01: a contract is a PLACE — its map must not move between attempts —
  // so the chapter's seed sits in the chain between an explicit `?seed=`
  // (playtests, saved seeds) and the fresh random one. A resumed save keeps
  // carrying its own seed, as always.
  const seed = opts.seed ?? bootSave?.seed ?? storyChapter?.seed ?? resolveMapSeed();
  const grid: Grid = generateMap(seed);
  // SCENERY: decals + clumped trees, a pure function of the seed (so a guest
  // regenerates exactly the host's woodland from the seed alone — scenery is
  // never on the wire). Computed before the towns stamp their roads because
  // it reads `grid.occupancy`/`grid.publicRoads`, both of which `generateMap`
  // has already filled; nothing in `track` affects it.
  const scenery: Scenery = scatterScenery(grid);
  // RES-FIELDS: the wheat fields / tree blocks beside the resources stand on
  // the grid as obstacles (FIELD_OCC) until demolished. Their layout is seeded;
  // only which ones were cleared is state (saved, and sent to a guest).
  const clearedFields = new Set<number>();
  const fieldAt = (tx: number, ty: number) => scenery.fields.find((f) =>
    !clearedFields.has(f.id) && tx >= f.tx && tx < f.tx + 2 && ty >= f.ty && ty < f.ty + 2);
  const stampFields = () => {
    for (const f of scenery.fields) {
      const v = clearedFields.has(f.id) ? -1 : FIELD_OCC;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const i = (f.ty + dy) * MAP_W + f.tx + dx;
          if (grid.occupancy[i] === -1 || grid.occupancy[i] === FIELD_OCC) grid.occupancy[i] = v;
        }
      }
    }
  };
  const setClearedFields = (ids: Iterable<number>) => {
    clearedFields.clear();
    for (const id of ids) if (scenery.fields[id]) clearedFields.add(id);
    stampFields();
  };
  stampFields();
  const track: Track = createTrack();
  // RAIL-04 (#178): the railway's own world. #142 is explicit that rail is a
  // SECOND, owner-scoped graph — it never reuses the road tiers, their bytes or
  // their names — so this is a separate state object beside `track`, created
  // here and read by the tools, the panel, the economy and the snapshot.
  const rail: RailState = createRailState();
  /** RAIL-02: the heading the platform/depot tools place with — R turns it. */
  let railView: RailView = "se";
  /**
   * The rotation the Depot tool places in (R turns it). `null` means "whatever
   * the site opens onto by itself" — the side away from the resource — so a
   * player who never touches R always gets a sensible entrance.
   */
  let depotView: DepotFacing | null = null;
  // PP-10: every town's seed-generated ring road is stamped onto the road
  // layer BEFORE the world exists (world.roadBits is a live reference to
  // track.road), so the first frame already shows settled towns with roads.
  // Neutral ownership: the town roads are never part of a player's network.
  seedTownRoads(track, grid);
  // PP-13: the inter-town highways go on next, stamped PUBLIC_OWNER — every
  // player's network may route over them, which is what makes them worth
  // having on the map at all. Order matters: a highway tile a town already
  // paved is skipped, so the town keeps its neutral ring.
  seedPublicRoads(track, grid);
  const score: ScoreState = createScoreState();

  const players: PlayerState[] = [
    { i: 0, id: "you", name: "You", colour: "#5aa8ff", purse: toBag(startPurse), human: true, freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS },
    // STORY-01: a contract renames and recolours the rival seat — the dossier
    // cards, the scoreboard and the ending ledger all read this name, so the
    // whole HUD introduces whoever the chapter cast.
    // #186: both seats open on the room's purse — the settings are the ROOM's
    // rules, so a Rich game is rich for the guest and for the AI alike, and the
    // two purses can never disagree about what the host chose.
    { i: 1, id: "ai", name: storyChapter ? CAST[rivalCast].name : "Rival", colour: storyChapter ? CAST[rivalCast].colour : "#ff7a5a", purse: toBag(startPurse), human: false, freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS },
  ];
  const me = players[0], rival = players[1];

  // DEV: unlimited resources for YOUR seat while testing. Only in the Vite dev
  // server — never in unit tests (vitest also sets DEV) and never in a shipped
  // build. `?unlimited=0` turns it off to test the real economy in dev.
  const DEV_PURSE_FLOOR = 9999;
  const devUnlimited = import.meta.env.DEV && import.meta.env.MODE !== "test"
    && !(typeof location !== "undefined" && /[?&]unlimited=0\b/.test(location.search));
  const topUpDevPurse = () => {
    if (!devUnlimited) return;
    for (const c of CARGOES) if ((me.purse[c] ?? 0) < DEV_PURSE_FLOOR) me.purse[c] = DEV_PURSE_FLOOR;
  };
  topUpDevPurse();

  // ── AI-01: how hard the rival plays ────────────────────────────────────────
  // One variable, read lively everywhere the rival's pacing shows up: the
  // build/idle clocks, expansion-per-turn, the pave batch, the bank budget,
  // the market cadence and the sabotage switches. Because the turn itself is
  // shared code, flipping the difficulty mid-match (the top-bar selector runs
  // `setRivalSkill`) just changes the numbers the NEXT tick reads — no replay,
  // no reload, and nothing in the ledger to migrate.
  // STORY-01: a contract casts its rival at a fixed difficulty — the chapter
  // IS the pacing — so the resolver (URL, storage) never gets a vote inside a
  // contract. The top-bar selector still works: changing your mind mid-contract
  // changes the live clock, exactly as in a sandbox match.
  // #186: an AI-filled seat in a hosted room is cast by the ROOM's settings —
  // the difficulty the host picked in the lobby, not this browser's last solo
  // pick. A human guest keeps the seat's own (unused) preset, and a solo game
  // resolves exactly as it always did: contract, then URL/storage, then normal.
  let skillKey: SkillKey = storyChapter
    ? storyChapter.skill
    : aiOpponent
      ? settings.aiSeats[0]
      : resolveSkillKey();
  // AI-01: a pinned `?rival=` link is an explicit choice, exactly like a pick
  // in the top-bar selector — so it persists for the next boot. Only the URL
  // path writes here: a plain boot must leave the storage key ABSENT or the
  // AI-02 start-of-game picker would never ask a fresh player again.
  if (!storyChapter && skillKeyFromUrl()) {
    try { localStorage.setItem(SKILL_STORAGE_KEY, skillKey); } catch { /* private mode */ }
  }
  const skill = (): RivalSkill => RIVAL_SKILLS[skillKey];
  /** The selector + the boot URL both land here; persists for the next boot. */
  const setRivalSkill = (key: SkillKey, announce = true) => {
    if (skillKey === key) return;
    skillKey = key;
    try { localStorage.setItem(SKILL_STORAGE_KEY, key); } catch { /* private mode */ }
    if (announce) {
      toast(`Rival difficulty: ${skill().label} — ${skill().blurb}`, "info");
    }
  };

  /**
   * AI-04: the ★ line THIS game races to, read live from the difficulty — the
   * easy chair finishes at 5★ (`RIVAL_SKILLS.easy.winTarget`), every other
   * preset at the shipped `VICTORY.target`. One reader for all five places the
   * line shows up (the win check, the star feed, the rival's race assessment,
   * the ★ tooltips and the HUD), so the scoreboard, the HUD and the win toast
   * can never disagree about how long the race is. Flipping the difficulty
   * mid-game moves the line for the next tick, exactly like the clocks do.
   *
   * Solo only: a hosted game has no difficulty (the selector is not even built,
   * see `onSkill` below) and both seats must see the same line — so #186 moved
   * it onto the ROOM's settings, the one copy of the rules every seat was told
   * at its welcome. The default is `VICTORY.target`, so a room nobody
   * customised races the shipped line, and the HUD's "first to N★", the
   * scoreboard's king bars and the win check all move together when it does.
   */
  // STORY-01: a contract races to its OWN ★ line (5★ for the inheritance, the
  // full 8★ for the Chairman), read live like everything else on this dial —
  // the scoreboard, the HUD badge and the win check all ask `winTarget()`.
  const winTarget = (): number => storyChapter
    ? storyChapter.target
    : (isSolo() ? skill().winTarget : settings.winTarget);

  const eco: EconomyState = { grid, track, harvesters: [], factories: [], rail };
  let nextHarvesterId = 1;
  /**
   * RV-01: road traffic. One lorry per player once a Depot reaches a Factory
   * by road — over private track AND the public highways (PP-13). Replanned
   * only when the economy changes (every build/demolish funnels through
   * `rescoreNow`); the frame loop just advances and draws them.
   */
  const trucks = createTruckState();
  let trucksDirty = true;
  /** TRAFFIC-01: ambient cars — a few simple cars driving the streets and
   *  roads, host/solo-local presentation only (a guest runs no vehicle
   *  movement, same rule as the lorries). Replanned on the same network-
   *  change edge the lorries use; the frame loop advances and draws them.
   *  `carCount` is live-tunable from `__iso.setTraffic(n)` — the performance
   *  probe is "how many cars before it hurts", so the dial exists. */
  const cars = createCarState();
  let carCount = CAR_COUNT;
  /** RV-03: monotonically increments on every network change (set in
   *  `rescoreNow`), so the hover route overlay cache can tell when a build or
   *  demolish may have opened a CLOSER route and must re-run `roadPath`. */
  let netVersion = 0;
  /**
   * PP-05: the next Depot id, skipping ids already on the board. The game's own
   * placements never collide, but structures can arrive from elsewhere (a
   * joined snapshot, a test that pushes one straight into `eco.harvesters`),
   * and `rescore` keys its connection/VP maps BY ID: a duplicate merges two
   * players' connections, the second one reads `from === to`, and that player
   * silently scores no VP for a Depot that is plainly connected. Before PP-05
   * the rival out-built the collision (its second Depot got a fresh id and
   * scored); once a Depot costs Oil it builds only the free one, so the clash
   * became visible. One allocator that cannot repeat removes the class.
   */
  const allocHarvesterId = (): number => {
    while (eco.harvesters.some((h) => h.id === nextHarvesterId)) nextHarvesterId++;
    return nextHarvesterId++;
  };
  let phase: Phase = "setup-factory";
  let tool: Tool = "dirt";
  /**
   * NAMES: the top-bar "Names" button shows/hides the tags that float over
   * resources, towns, plants and depots while you pan. ON by default (a
   * strategy map should be readable), remembered in localStorage.
   */
  const NAMES_STORAGE_KEY = "hexmatch:names";
  let showNames = (() => {
    try { return localStorage.getItem(NAMES_STORAGE_KEY) !== "0"; } catch { return true; }
  })();
  /**
   * The first-road blocker: the guidance banners ("N free track tiles —
   * connect your depot to your Factory") exist to get the player's FIRST
   * track on the map. The moment a human track commit lands, the guidance
   * has done its job — keep showing it over the map after that reads as a
   * popup the player is stuck behind.
   */
  let firstTrackBuilt = false;
  let winner: PlayerState | null = null;
  let winningSource: DecisiveSource = null;
  let endingView: EndingScreenHandle | null = null;
  let endingShown = false;
  /**
   * RANK-01 (#147): the rated match's state. Declared here — with the other
   * end-of-match state, and long before the runtime is built — because
   * `presentEnding` and the restore path both read it, and a `let` declared
   * further down would be a temporal dead zone for a boot that restores a
   * finished match.
   *
   *   rankRuntime — null unless this is a rated room match with a store
   *   rankVerdict — the room's filed result, once it has arrived
   */
  let rankRuntime: RankRuntime | null = null;
  let rankVerdict: RankVerdict | null = null;
  /** When this match booted, for the ladder's required `duration` field. */
  const rankBootAt = performance.now();

  // ── #164: presence of the far seat ─────────────────────────────────────
  /**
   * The opponent's wire id, captured from the roster while it is still whole.
   * A late "claim the win now" runs AFTER the seat emptied and the session
   * pruned the roster, so `wireIdOf(rival)` no longer has a room id to give;
   * this is the copy that survives the departure.
   */
  let mpOpponentWireId = "";
  /**
   * The disconnect countdown's deadline on the `performance.now()` clock, and
   * the name to print beside it. Zero when the peer is present (or this is a
   * solo match). `paintUi` reads both every frame — the banner is the visible
   * countdown the issue asks for, and a per-frame read is the only way the
   * number stays honest without a second timer to leak.
   */
  let mpPeerAwayUntil = 0;
  let mpPeerAwayName = "";
  /**
   * BANNER-ONCE keys the dismissal by id; a NEW disconnect must not inherit
   * the previous one's ✕, so each episode bumps this into the banner's key.
   */
  let mpDisconnectEpisode = 0;
  /**
   * The departure sheet while it stands. One at a time: a reconnect resumes
   * the match and takes it down, a verdict fills it in, and dispose() must
   * not orphan it over a dead board.
   */
  let leftSheet: LeftSheetHandle | null = null;
  /** True once the sheet's Leave door is waiting on a claim it just filed. */
  let leaveAfterVerdict = false;
  let leaveAfterVerdictTimer = 0;
  /**
   * The client's mirror of the room's `matchLive`: state has crossed the wire
   * at least once. Before it, a departure is a lobby exit — there is no rated
   * match to claim, and the doors must not offer one.
   */
  let mpMatchLive = false;
  /** TUT-01: the boot tour, while it is open. Held so `dispose` can take its
   *  document keydown listener with it — the same reason `endingView` is. */
  let tutorialView: TutorialHandle | null = null;
  /** STORY-01: the contract reel (briefing or epilogue) while it stands — the
   *  same ownership rule: its document listeners die with the game. */
  let storyView: SceneHandle | null = null;
  /**
   * Set by the dispose closure at the bottom of this function and read by every
   * async continuation and clock in it. Declared here, beside the other boot
   * state, rather than down in the boot block because TUT-01's prompt chain now
   * awaits the tour before it asks AI-02's question — and a chain that can be
   * torn down mid-await has to be able to ask whether the game still exists.
   */
  let disposed = false;
  /** Restart flips this before clearing the save — the pagehide fired by the
   *  ensuing reload must not resurrect the completed match. */
  let restartArmed = false;

  // Rivalry flavour has its own deterministic scene deck and counters. It
  // never consumes simulation RNG, so extra jokes cannot alter an AI decision.
  // STORY-01: the contract's rival speaks with their own deck (voices.ts) and
  // falls back to Torvin's where theirs is silent; the idle wire follows the
  // same routing. Torvin in a sandbox match keeps his original directors.
  const storyDirector = storyOn ? createStoryDirector(rivalCast, seed) : null;
  const nextRivalScene = storyDirector ?? createRivalDirector(seed);
  const nextGoldMineScene = createGoldMineDirector(seed);
  const nextBanterScene = storyDirector
    ? (): RivalryScene => storyDirector("banter", "protest")
    : createBanterDirector(seed);
  let playerSabotage = 0;
  let rivalSabotageHits = 0;
  let oilBanterSeen = false;
  // The idle wire: one short Torvin exchange every so often, mid-game. The
  // clock arms when play begins and never runs before then (no jokes over the
  // setup banners or the ending screen). Timing jitter uses Math.random —
  // presentation pacing, deliberately NOT the seeded simulation RNG.
  let chitChatArmed = false;
  let nextChitChatAt = 0;
  // The quarry is created before the HUD. Its callback is replaced once the
  // two-portrait wire exists; no board can pay oil during synchronous boot.
  let onFirstOilHarvest: () => void = () => {};

  // ── J1: quarry + market + the restored UI ────────────────────────────────
  // Cargo has exactly one owner (the purse above). The board owns gems and the
  // market owns live offers; the gate between board and purse is `quarry.ts`.
  // U1: the board and trading tabs are rendered by the recovered `ui.ts`
  // chrome, not by the old floating J1 panels.
  let onBoardChange: () => void = () => {};
  let reachSig = "\u0000";   // sentinel so the very first (empty) reach paints

  const gainText = (gains: Partial<Record<Cargo, number>>, label: string) =>
    (Object.entries(gains) as [Cargo, number][])
      .map(([c, n]) => `+${n} ${CARGO[c].icon}`).join(" ") + (label ? ` · ${label}` : "");

  const quarry: Quarry = createQuarry(eco, "you", {
    // L1c (#234): under the new loop the board does not pay — connected
    // Depots tick cargo in on the clock instead. The line is cut INSIDE the
    // quarry so the board's own gain accumulator, and every "+N cargo" pop
    // built from it, can never advertise a payout that did not happen. Gems
    // still clear and cascades still cascade: matching is what sets a Depot's
    // yield. The RIVAL's seat is untouched (#235 gives it the same clock),
    // as are combo Gold below and the board's cross/bonus rewards (#227).
    payCargo: !newLoop,
    onHarvest: (cargo, amount) => {
      earn(me, { [cargo]: amount });
      if (cargo === "oil" && amount > 0) onFirstOilHarvest();
    },
    onBlocked: (cargo, amount) =>
      toast(`No route for ${CARGO[cargo].name} — ${amount} lost. Reconnect it.`, "bad"),
    // W5: the missing wire. The board banks a combo coin every 2 combos;
    // this listener is what puts it in the purse (and keeps the Black Market
    // affordable). The HUD chip refreshes on the next paint, which is every
    // frame.
    onGold: (n) => {
      earn(me, { gold: n });
      // SFX-01: two coins touching. The toast reports it; this is the feel.
      sfx.play("coin");
      toast(`+${n} Gold from combos 🪙`, "good");
    },
    // L1c (#234): the board's own chain/cross rewards still accumulate their
    // "+1"s even though the purse line is cut, so under the new loop the
    // readouts carry the LABEL only — a "+N cargo" nobody was paid is exactly
    // what this ticket removes. (The combos/chain feedback stays: the board is
    // still what sets a Depot's yield.)
    onGains: (gains, label) => {
      if (newLoop) { if (label) toast(label, "good"); return; }
      toast(gainText(gains, label), "good");
    },
    // A1: the floating readout over the board. `ui` does not exist yet at
    // this point (the HUD is built below), but this closure is only ever
    // called by a match, long after boot.
    onPopup: (gains, label) => ui.popup(newLoop ? {} : gains, label),
    onTokens: (pool) => toast(`Tokens: ${(Object.keys(pool) as ResKey[])
      .map((r) => CARGO[GEM_TO_CARGO[r]].name).join(", ")}`, "info"),
    onChange: () => onBoardChange(),
  }, undefined);

  // AI-03: the RIVAL's Processing Plant board — a real quarry of its own,
  // played by a clock-driven autoplayer (`skill().moveMs`, below). It pays
  // the same rules the player's board does: match a token, earn the feed,
  // clear ice, free girders. `rivalPlant.board` is the body that sabotage
  // already hits (A1), so buying Frost on the rival now also lands on the
  // board you can WATCH it play — one economy, one addressable plant.
  // The board drives the purse through the same hooks the player's own
  // quarry does; what it must never do is toast the human about the rival's
  // private matches, so its UI surface says nothing — except when its own
  // peek panel is open (see `openRivalPlantView` below).
  let rivalQuarry: Quarry;

  /** AI-03: the peek panel handle (set when the player opens it). */
  interface RivalBoardView { paint: () => void; close: () => void }
  let rivalBoardView: RivalBoardView | null = null;
  /** TS narrowing helper: closures bind this `let` as null before any
   *  assignment exists in straight-line flow; one method keeps the union. */
  const getRivalView = (): RivalBoardView | null => rivalBoardView;
  const paintRivalView = () => getRivalView()?.paint();

  // W6: the rival's answers and expirations are trade events — surface them
  // in the Feed so "the rival answered my offer" is visible, not silent.
  const market: IsoMarket = createIsoMarket(players.map((p) => ({
    i: p.i, id: p.id, name: p.name,
    // #113: in a hosted game BOTH seats are people. Seat 1's `human:false` is
    // the solo-AI marker; copied into the market it taught `market.tick` to
    // run the solo AI-acceptance policy on the human guest — auto-spending
    // another player's inventory on offers they never accepted. A networked
    // market is all-human: offers only leave the board by expiry, cancellation
    // or a validated acceptance intent.
    // #186: …unless the host filled that seat with a machine, in which case the
    // seat IS an AI and the AI-acceptance policy is exactly what should run on
    // it — there is no person there to accept anything.
    human: isMp() ? !aiOpponent || p !== rival : p.human,
    purse: p.purse,
  })), {
    onOfferClosed: (o, how) => {
      const body = `${o.giveN} ${CARGO[o.give].name} → ${o.wantN} ${CARGO[o.want].name}`;
      // AI-01: offers flow in both directions now (the rival posts too), so
      // the line has to say WHOSE offer left the board, and how.
      if (o.from === players.find((p) => p.human)?.i) {
        if (how === "accepted") ui.feed(`Rival took your offer: ${body}`, rival.name);
        else ui.feed(`Your offer expired — escrow refunded (${body})`);
      } else if (how === "accepted") ui.feed(`You took the rival's offer: ${body}`);
      else ui.feed(`Rival's offer expired (${body})`, rival.name);
    },
  });
  const meTrader = market.players[0];

  // MP-AUDIT: market parity — host is authoritative, guest relays via intents.
  // Escrow, pursey and offer list are synced via snapshot/delta; guest mutators
  // become intents so host can apply them against the guest's player record.
  const __origPost = market.post.bind(market);
  const __origCancel = market.cancel.bind(market);
  const __origAccept = market.accept.bind(market);
  const __origBank = market.bank.bind(market);
  const mpMarketSend = (payload: Record<string, unknown>): boolean => {
    if (!isMp()) return false;
    if (isGuest()) {
      // #114: a relay is a REQUEST, not a trade. The UI reads `relayPending`
      // and says "sent — waiting for the host" instead of declaring success
      // (and the trade only exists once the host's delta says so).
      market.relayPending = true;
      net?.sendIntent("market", payload);
      return true;
    }
    return false;
  };
  market.post = ((p: any, give: any, giveN: any, want: any, wantN: any) => {
    market.relayPending = false;
    if (mpMarketSend({ do: "post", give, giveN, want, wantN })) return true;
    const ok = __origPost(p, give, giveN, want, wantN);
    if (ok && isMp()) publishNet(performance.now(), true);
    return ok;
  }) as typeof market.post;
  market.cancel = ((p: any, id: any) => {
    market.relayPending = false;
    if (mpMarketSend({ do: "cancel", id })) return true;
    const ok = __origCancel(p, id);
    if (ok && isMp()) publishNet(performance.now(), true);
    return ok;
  }) as typeof market.cancel;
  market.accept = ((p: any, id: any) => {
    market.relayPending = false;
    if (mpMarketSend({ do: "accept", id })) return true;
    const ok = __origAccept(p, id);
    if (ok && isMp()) publishNet(performance.now(), true);
    return ok;
  }) as typeof market.accept;
  market.bank = ((p: any, give: any, want: any) => {
    market.relayPending = false;
    if (mpMarketSend({ do: "bank", give, want })) return true;
    const ok = __origBank(p, give, want);
    if (ok && isMp()) publishNet(performance.now(), true);
    return ok;
  }) as typeof market.bank;

  // MOBILE-01: the two camera/names actions the top bar, the ☰ menu and the
  // floating touch cluster ALL offer. One closure each, so the three doors
  // can never drift apart (the menu rows exist because a phone's top bar
  // sheds buttons to fit a thumb — see the ≤480px block in styles.css).
  const toggleNames = () => {
    showNames = !showNames;
    try { localStorage.setItem(NAMES_STORAGE_KEY, showNames ? "1" : "0"); } catch { /* private mode */ }
    labels.setEnabled(showNames);
  };
  const recenterCamera = () => {
    // MP-AUDIT: recenter goes to local seat's factory or its reserved town (MP only); solo stays factory→focus
    const fallback = (() => {
      if (isMp()) {
        const myTownRecenter = townForSeat(grid, isGuest() ? 1 : 0);
        if (myTownRecenter) return { tx: myTownRecenter.tx, ty: myTownRecenter.ty };
      }
      return focus;
    })();
    const f = factoryOf("you") ?? fallback;
    cam = centerOnTile(cam, f.tx, f.ty);
    renderer?.setCamera(cam);
  };

  /**
   * PP-14b/#116: what the Reset button runs, on every seat. The host/solo
   * collapses its own board under the shared 30s cooldown; a guest sends a
   * typed reset intent and the HOST enforces the guest seat's cooldown and
   * collapses the guest's authoritative board — the button is never a silent
   * no-op, and a host refusal comes back as a notice toast.
   */
  function resetPlant() {
    if (isGuest()) {
      const now = performance.now();
      // Mirror of the host's per-seat cooldown, so the button communicates
      // availability instead of eating the click.
      if (now - guestResetAt < RESET_COOLDOWN_MS) {
        const left = Math.ceil((RESET_COOLDOWN_MS - (now - guestResetAt)) / 1000);
        toast(`Processing Plant reset is cooling down — ${left}s to go.`, "info");
        return;
      }
      guestResetAt = now;
      net?.sendIntent("build", { do: "reset" });
      toast("Requesting Processing Plant reset…", "info");
      return;
    }
    const now = performance.now();
    // PP-14b: the reset has a 30s cooldown — collapsing the plant is a free
    // re-roll of the whole board, so it cannot be spammed every cascade.
    if (now - lastResetAt < RESET_COOLDOWN_MS) {
      const left = Math.ceil((RESET_COOLDOWN_MS - (now - lastResetAt)) / 1000);
      toast(`Processing Plant reset is cooling down — ${left}s to go.`, "info");
      return;
    }
    lastResetAt = now;
    quarry.board.resetNeutral();
    toast("Processing Plant collapsed. Fresh neutral board.", "info");
  }
  // Original HUD (U1). It takes the live board + market + the player purse and
  // wires the BUILD / BLACK MARKET / QUARRY / chips chrome to them.
  ui = createOriginalUi(quarry.board, market, meTrader, {
    // #187: every door the chrome has out of a placement — the hint's ✕, the
    // touch chip, a re-tap of the armed Build button — asks for the pointer,
    // and asking for the pointer IS the cancel: `cancelPlacement` takes the
    // armed drag and its ghost with the tool, so no door can leave a preview
    // painted that no pointerup will ever commit (and `costInfo`, derived
    // from `tool`/`preview` below, follows them away on the next frame).
    onTool: (t) => {
      if (t === "select") cancelPlacement();
      else armTool(t as Tool);
    },
    /**
     * RAIL-04 (#178): the Railway panel's three verbs. `assign` finds the
     * partner platform the row named (the model picked it: the industry
     * platform's opposite number, a plant platform of the same owner), `recall`
     * sends a train home, `sell` cashes it in at floor(50%) once it is there.
     */
    onRailAction: (id, action, partnerId) => {
      if (action === "assign") {
        if (partnerId === undefined) return;
        railAssign(id, partnerId);
      } else if (action === "recall") railRecall(id);
      else if (action === "buy") { if (partnerId !== undefined) railBuy(id, partnerId); }
      else if (action === "start") railStart(id);
      else railSell(id);
      paintOverlayNow();
    },
    // NAMES: the top-bar "Names" button. The game owns the state (and the
    // localStorage record); the button only reports the toggle and reads
    // `showNames` back through `paint`.
    onNames: toggleNames,
    names: showNames,
    onRecenter: recenterCamera,
    // MOBILE-01: the floating +/− keys are the wheel's touch twin — one zoom
    // step about the middle of the screen, exactly where a thumb-panner's eye
    // already is. Anchored at the viewport centre, like a wheel at centre.
    onZoom: (dir) => {
      cam = zoomStepAt(cam, dir, cam.vw / 2, cam.vh / 2);
      renderer?.setCamera(cam);
    },
    onSwap: (r1, c1, r2, c2) => {
      // MP-05: guests never mutate their local board. Route the action to the
      // host, where the guest seat's board is authoritative, just like map
      // construction intents. The board result itself is still a follow-up
      // sync concern; this keeps the input path server-authoritative.
      if (isGuest()) {
        net?.sendIntent("build", { do: "swap", r1, c1, r2, c2 });
        return;
      }
      // L4 (#218): the session gate and the move it costs live in
      // `requestBoardSwap`, shared with the `__iso.swap` twin — one rule, two
      // doors.
      requestBoardSwap(r1, c1, r2, c2);
    },
    onReset: () => resetPlant(),
    onBlackAction: (key) => buyBlack(key),
    // MOBILE-02: the phone chrome grows the plant (more columns/rows at a
    // smaller cell) so the match table FILLS the window instead of cropping.
    // The chrome asks; the seat answers. A guest never resizes its own grid —
    // the host authors it and the whole rectangle ships on the wire — so a
    // guest phone only re-zooms what arrives (the #163 retract asks are
    // vetoed here too). Solo and host seats own their board, and the ♻ reset
    // / gravity refill keep whatever size the live grid carries (the board
    // reads its own dims, not the shipped constants).
    requestBoardSize: (w, h) => {
      if (isGuest()) return false;
      // The rival's plant stays at the shipped 7×8 on purpose: the grow is a
      // readability concession for small screens, not an economy boost.
      // #163: a smaller (w,h) is only ever a retract of unplayed columns the
      // chrome itself added this session — restored saves are the floor and
      // are never asked to shrink — so approving it costs no earned gems.
      void w; void h;
      return true;
    },
    // AI-01: the top-bar difficulty selector. Applies on the NEXT rival tick —
    // the clocks and budgets re-read `skill()` every call, so there is nothing
    // to restart.
    // MP-05: the difficulty selector is an AI feature — there is no AI rival
    // in a hosted game, so the selector is simply not built.
    onSkill: isSolo() ? (key) => setRivalSkill(key) : undefined,
    skill: isSolo() ? skillKey : undefined,
  }, { rail: railAvailable, newLoop });
  onBoardChange = () => ui.renderBoard();
  root.appendChild(ui.el);

  // LOAD-01: the loading screen takes over once the boot prompts below are
  // done (or at once when nothing is asked) and lifts when every art load has
  // settled. The loads themselves start at boot regardless — the tour and the
  // difficulty pick are free loading time — so a slow reader usually walks
  // straight into the map. It follows the prompts rather than stacking on them.
  const loading = createLoadingScreen(ui.el, [
    { id: "atlas", label: "Surveying the island" },
    { id: "layers", label: "Grading the terrain" },
    { id: "buildings", label: "Raising the buildings" },
    { id: "scenery", label: "Planting the trees" },
    { id: "vehicles", label: "Fuelling the lorries" },
    { id: "roads", label: "Mixing the asphalt" },
    { id: "protest", label: "Painting the placards" },
  ]);
  // #186: a hosted game says its rules out loud on the way in — the ★ line and
  // the purse are the host's choices, and a guest who never opened the settings
  // panel should still hear them before the map lands.
  const showLoading = () => loading.show(isSolo()
    ? `Rival: ${skill().label} · first to ${winTarget()}★ wins`
    : `${aiOpponent ? `Rival: ${skill().label} · ` : "Setting the table for two tycoons · "}${describeMatchSettings(settings)}`);

  // TUT-01 + AI-02: the two one-shot boot prompts, in the order a new player
  // meets them. The TOUR goes first — it is the "how does this game work" card,
  // and the difficulty chooser that follows is a much smaller question that
  // only makes sense once ★ and the rival exist as ideas. They are awaited in
  // sequence so two overlays never stack on the same boot.
  //
  // Both are gated the same way, and the gate is the same one AI-03 settled:
  // a saved game means NO tour and NO difficulty prompt and NO fresh map — the
  // save carries the pick, and refresh resumes exactly where it left off ("a
  // refresh restarts the game" — not any more; Restart starts over). A
  // networked seat skips them too: that match is already live and the host is
  // waiting. (`bootSave` was read up top, before the map generated, so the seed
  // the save carries is the seed the map was grown from.)
  //
  // The tour returns null once the player has pressed "Never show this again"
  // (src/iso/tutorial.ts owns that key), which leaves the difficulty prompt as
  // the only card on an ordinary boot.
  if (!bootSave && isSolo()) {
    void (async () => {
      // STORY-01: a contract opens with its briefing — the rival's face, the
      // bookkeeper's terms — before any onboarding card, because "who am I
      // and who is that" precedes "what button is this". Skippable like every
      // other reel; a skip is a choice, not a fault. Then the tour (if it is
      // still welcome) and the difficulty prompt — which a contract does not
      // ask, the chapter having already cast the rival at a fixed difficulty.
      if (storyChapter) {
        ui.feed(`${storyChapter.kicker} — ${storyChapter.name}`, "Contract");
        ui.feed(storyChapter.objective, "Contract");
        // BACK TO WORK: the feed says whose job this contract is.
        ui.feed(`Your job: ${storyChapter.jobTitle}, ${EMPLOYER}`, "Contract");
        storyView = showScene(ui.el, storyChapter.pre, {
          player: playerCast,
          skipLabel: "Skip briefing ▸▸",
        });
        await storyView.promise;
        storyView = null;
        if (disposed) return;
      }
      // The two numbers the tour cannot read for itself: the ★ line belongs to
      // the live difficulty, and the free dirt tiles are DATA on the player
      // record. Passing them keeps the copy honest without importing game.ts
      // into tutorial.ts (which would be a cycle).
      tutorialView = showTutorial(ui.el, {
        vpTarget: winTarget(),
        freeTrack: me.freeTrack,
        // L4 (#218): the boot tour describes the loop the game is running —
        // the tuning session on the new loop, the always-on board otherwise.
        newLoop,
      });
      // Always yield, tour or no tour: the rest of this chain reads `disposed`
      // (declared with the other boot state at the top of this function), and a
      // microtask is the earliest point at which reading it is meaningful.
      await (tutorialView ? tutorialView.promise : Promise.resolve());
      tutorialView = null;
      // The game may have been torn down while the card was up (a test's
      // dispose, a rematch). The difficulty prompt belongs to a live boot only.
      if (disposed) return;
      // AI-02: ask for the difficulty before the first click (only when no
      // previous choice exists — see skill-picker.ts). The overlay sits over
      // the freshly booted UI; the pick flips the LIVE game straight into
      // `setRivalSkill`, persists for the next boot, and syncs the top-bar
      // selector the `onSkill` hook would otherwise own. A contract skips the
      // question: the chapter cast the rival, and re-asking would un-cast it.
      if (!storyChapter) {
        await promptForRivalSkill(ui.el, {
          onPick: (key) => {
            setRivalSkill(key);
            try { localStorage.setItem(SKILL_STORAGE_KEY, key); } catch { /* private mode */ }
            const sel = ui.el.querySelector<HTMLSelectElement>("#iso-rival-skill");
            if (sel) sel.value = key;
          },
        });
        if (disposed) return;
      }
      showLoading();
    })();
  } else {
    showLoading();
  }

  // ── A1: the board's own effects finally have somewhere to go ────────────
  // `Board` fires `onFx` for every pop, crack, token-up, bomb, bad swap and
  // callout, and NOTHING had ever assigned it — so all of it, including
  // MATCH! / COMBO x2 / CHAIN x3!! / MATCH 5, died on the board. This one
  // line is the wire the handover was asking for.
  quarry.board.onFx = (type, r, c, text) => ui.fx(type, r, c, text);
  // L4 (#218): the tuning session's odometer. Every resolved pass reports the
  // gems it took off the board; a session score is the sum. Nothing else on
  // this board listens, and with no session open the counter is not even
  // looked at — the old loop plays exactly as it did.
  quarry.board.onClear = (_n, _chain) => {
    if (tuning) recordTuningCleared(tuning, _n);
  };

  // PP-14: a HOLY CROSS pauses the cascade and asks the player which cargo
  // the blessing should be — the board waits on this hook until the UI's
  // chooser answers it (or the backstops auto-pick). PP-14b: the board passes
  // the shape and how many units it owes so the chooser can title and cap
  // itself (6 for a holy cross, 3 for a broken one).
  // MP-AUDIT: cross-bonus choice relay — host holds the pending prompt, guest renders it.
  // #112: the lifecycle is keyed by PROMPT ID (seq) end to end. The host
  // publishes the prompt, the guest shows ONE dialog for it (heartbeat deltas
  // repeat the same seq; re-showing would queue dialogs), the answer travels
  // as one typed intent `{ do: "cross", seq, choices }`, and the host resolves
  // exactly the prompt that seq names — a late timer, a duplicate delta or a
  // malformed reply can never award twice or hang the cascade.
  let pendingCross: { boardOwner: string; kind: CrossKind; picks: number; resolve: (chosen: ResKey[]) => void } | null = null;
  let crossPromptSeq = 0;
  let crossPrompt: import("./snapshot").CrossPromptWire | null = null;
  /** #112: the fallback timer — it captures the seq it may resolve, and it is
   *  cancelled the moment that prompt resolves any other way (answer, newer
   *  prompt, disposal), so an old timer can never answer a newer prompt. */
  let crossTimer: ReturnType<typeof setTimeout> | null = null;
  const clearCrossTimer = () => {
    if (crossTimer !== null) { clearTimeout(crossTimer); crossTimer = null; }
  };
  /** #112: clear the prompt and hand the board the empty fallback, then tell
   *  the guest (the old timeout never published, so the cascade sat on the
   *  fallback while the guest's chooser stayed up forever). */
  const expireCrossPrompt = () => {
    const fallback = pendingCross?.resolve;
    if (!fallback) return;
    clearCrossTimer();
    pendingCross = null;
    crossPrompt = null;
    fallback([]);
    publishNet(performance.now(), true);
  };
  /**
   * The rival's own answer to a cross on ITS board: all of whatever cargo it
   * is shortest of. No dialog — it is not the player's blessing to allocate.
   */
  const rivalCrossPicks = (picks: number): ResKey[] => {
    const scarcest = (CARGOES as readonly Cargo[])
      .filter((c) => c !== "gold")
      .sort((a, b) => (rival.purse[a] ?? 0) - (rival.purse[b] ?? 0)
        || a.localeCompare(b))[0];
    return Array.from({ length: picks }, () => CARGO_TO_GEM[scarcest]);
  };

  const __setCrossPrompt = (boardOwner: string, kind: CrossKind, picks: number, resolve: (chosen: ResKey[]) => void) => {
    // Whose board made the cross decides who answers it. The RIVAL's board
    // answers itself — its blessing pays ITS purse, so putting that chooser on
    // the player's screen asked them to allocate the opponent's bonus, out of
    // nowhere, mid-cascade ("a broken cross randomly triggers on my board").
    const mine = boardOwner === "you" || boardOwner === players[0].id;
    if (!mine && (isSolo() || aiOpponent)) {
      resolve(rivalCrossPicks(picks));
      return;
    }
    // In solo, just show locally; in host, track prompt for guest sync
    // #186: an AI-FILLED seat is handled above — the seat the host would
    // otherwise publish this prompt to is a machine, and a prompt nobody can
    // answer would sit until its 30 s expiry instead of being played.
    if (isSolo() || aiOpponent) {
      ui.crossPick(kind, picks, resolve);
      return;
    }
    if (isGuest()) {
      // guest board should never ask — host is authoritative, but fallback
      ui.crossPick(kind, picks, resolve);
      return;
    }
    // host: if boardOwner is guest seat, publish prompt instead of showing locally
    const guestId = players[1].id; // host's guest seat
    if (boardOwner === guestId) {
      pendingCross = { boardOwner, kind, picks, resolve };
      crossPromptSeq++;
      crossPrompt = { boardOwner, kind, picks, seq: crossPromptSeq };
      publishNet(performance.now(), true);
      // Safety: auto-resolve after 30s if guest never answers (engagement).
      // The timer owns THIS seq only; resolving the prompt any other way
      // cancels it.
      const mySeq = crossPrompt.seq;
      clearCrossTimer();
      crossTimer = setTimeout(() => {
        crossTimer = null;
        if (pendingCross && crossPrompt && crossPrompt.seq === mySeq) expireCrossPrompt();
      }, 30000);
    } else {
      // host's own board — show locally
      ui.crossPick(kind, picks, resolve);
    }
  };
  quarry.board.onCrossChoice = (kind, picks, pick) => __setCrossPrompt("you", kind as CrossKind, picks, pick);
  // MP-AUDIT: guest renders cross prompt that host published
  // #112: the guest tracks the prompt it is SHOWING and the last prompt it
  // ANSWERED, both by seq. A heartbeat delta re-delivers the same seq — that
  // is not a second chooser; a cleared prompt closes the chooser instead of
  // leaving it stuck over a resolved cascade.
  let guestCrossShown: number | null = null;
  let guestCrossAnswered: number | null = null;
  const __showGuestCross = (prompt: import("./snapshot").CrossPromptWire) => {
    if (prompt.seq === guestCrossShown || prompt.seq === guestCrossAnswered) return;
    // A genuinely new prompt replaces whatever is on screen (one dialog, not
    // a queue — crossPick queues when a panel is already open).
    if (guestCrossShown !== null) { ui.crossCancel(); guestCrossShown = null; }
    guestCrossShown = prompt.seq;
    ui.crossPick(prompt.kind as CrossKind, prompt.picks, (chosen) => {
      if (guestCrossShown !== prompt.seq) return;   // a stale dialog never answers a newer prompt
      guestCrossShown = null;
      guestCrossAnswered = prompt.seq;
      net?.sendIntent("cross", { do: "cross", seq: prompt.seq, choices: chosen });
    });
  };
  /** #112: the host cleared/resolved/expired the prompt — take the chooser
   *  down with it. */
  const __clearGuestCross = () => {
    guestCrossShown = null;
    ui.crossCancel();
  };

  // A1: world-anchored floats — the lorry's "+N" at the Factory, and the
  // marker over the rival's plant when sabotage lands. Anchored to the live
  // camera, so they pan and zoom with the tile they belong to.
  //
  // The tile→CSS-px mapping is shared by the three anchored layers: the
  // A1 floats, the NAMES tags (labels) and the 1-second build flash
  // (flashLayer — a FloatLayer of its own so the delivery/sabotage texts a
  // test reads from `floats` never mix with the on-map "build it HERE" line).
  const tileScreenCss = (tx: number, ty: number): [number, number] => {
    const [x, y] = tileToScreenAt(cam, tx, ty);
    const d = dpr();
    return [x / d, y / d];
  };
  const floats: FloatLayer = createFloatLayer(ui.mapHost, tileScreenCss);
  const labels: LabelLayer = createLabelLayer(ui.mapHost, tileScreenCss);
  labels.setEnabled(showNames);
  const flashLayer: FloatLayer = createFloatLayer(ui.mapHost, tileScreenCss);
  /**
   * The 1-second on-map flash: when a build is REFUSED, say it at the spot
   * the player aimed at — where the thing they tried to build actually
   * belongs — instead of (only) in a toast at the edge of the screen.
   */
  const flashAt = (tx: number, ty: number, text: string, tone: "bad" | "good" = "bad") => {
    if (!text) return;
    flashLayer.add(text, tx, ty, { life: 1000, cls: `build-flash ${tone}` });
  };
  /**
   * The one-line version of each placement refusal, sized for a 1-second
   * on-map flash (the toast keeps the full sentence). Keys match the
   * `PlantRefusal` codes and the `buildRefusal` track codes.
   */
  const PLANT_FLASH_TEXT: Record<string, string> = {
    "out-of-bounds": "Off the map",
    water: "No plant on water",
    occupied: "Ground is taken",
    building: "A building is here",
    track: "Clear the track first",
    "no-town": "Plant must touch a town",
  };
  const TRACK_FLASH_TEXT: Record<string, string> = {
    "out-of-bounds": "Off the map",
    water: "Can't build on water",
    occupied: "Tile is occupied",
    field: "Demolish the field first",
    rough: "Road can't cross rough — use Dirt",
    "not-adjacent": "Drag out from your Factory / Depot",
  };

  // A1: the rival owns a Processing Plant now, so Black Market sabotage has
  // somewhere to land that is not the buyer's own board.
  const rivalPlant = createRivalPlant();
  // AI-03: the AI's quarry plays on THAT VERY board — the A1 sabotage
  // target is the quarry's grid, so the rival's autoplayer can clear the
  // ice you bought the way a player would, and you can open its plant and
  // watch it work.
  const rivalBoard = rivalPlant.board;
  rivalQuarry = createQuarry(eco, "ai", {
    onHarvest: (cargo, amount) => earn(rival, { [cargo]: amount }),
    onBlocked: () => {},
    onGold: (n) => {
      earn(rival, { gold: n });
      ui.feed(`Rival banks +${n} Gold from its plant combos 🪙`, rival.name);
    },
    onGains: () => {},
    onTokens: () => {},
    onChange: () => paintRivalView(),
    // AI-03c: pass the shared board INTO the quarry — this used to be a
    // property-assign AFTER creation, which re-bound nothing: the quarry's
    // closure kept minting tokens on its own invisible board while the
    // autoplayer played (and the peek panel showed) the shared one. The
    // flat-purse telemetry that finally smoked this out: reach present,
    // tokens never, income never. One board now — no shadows.
  }, rivalBoard);
  rivalQuarry.board.onCrossChoice = (kind, picks, pick) => __setCrossPrompt("ai", kind as CrossKind, picks, pick);

  // U1: the iso layer stack stays the map; it is mounted inside the original
  // map-canvas slot rather than a bespoke floating panel.
  const mk = (z: number) => {
    const c = document.createElement("canvas");
    c.className = "iso-layer";
    c.style.zIndex = String(z);
    ui.mapHost.appendChild(c);
    return c;
  };
  const canvases = { terrain: mk(1), structures: mk(2), overlay: mk(3) };
  const stage = ui.mapHost;
  // GFX-01: the tilt-shift composite. It mounts its own canvas above the
  // three layers and stays `display: none` until the setting says otherwise,
  // so at the default (off) it costs one early return in the frame loop.
  const mini = createTiltShiftPass(canvases, stage);

  const world: World = {
    grid,
    roadBits: drawBits(track, "road"),
    dirtBits: drawBits(track, "dirt"),
    extra: [],
    trees: scenery.trees,
    forests: scenery.forests,
    fields: scenery.fields,
    sceneryBlocked: new Set<number>(),
    // RAIL-03 (#177): the railway layer the renderer paints the vector track
    // from — refreshed in `syncWorld`, which is the only place the world
    // changes.
    rail: railDrawLayer(rail),
  };

  // MP-AUDIT: distinct starting-town reservations — camera opens near the local seat's town.
  // Deterministic pure function of the seed, so host and guest agree without wire traffic.
  // Solo keeps the original industry focus (D2 regression) — MP seats use reserved towns.
  const focus = (() => {
    if (isMp()) {
      const seatForCamera: 0 | 1 = isGuest() ? 1 : 0;
      const myTown = townForSeat(grid, seatForCamera);
      if (myTown) return { tx: myTown.tx, ty: myTown.ty };
    }
    return grid.industries[0] ?? { tx: MAP_W / 2, ty: MAP_H / 2 };
  })();
  // PERF-01: ONE effective dpr for the whole game — the browser's
  // devicePixelRatio capped by the live render policy (performance mode
  // caps the backing at 1). Every CSS↔backing conversion in the file (boot
  // zoom, pointer `pos`, tap slop, anchored labels/floats, canvas resize)
  // must go through it, or selection, drag ghosts and zoom anchors drift
  // the moment the policy and the screen disagree. Reading the store on
  // each call keeps a runtime toggle truthful without a second source of
  // truth; the store read is one object property.
  const dprCapOf = (): number => renderPolicy(currentGraphics()).dprCap;
  // MOBILE-01: the camera is device-pixel space, so a phone's dpr would
  // otherwise shrink every tile to a third of its desktop size — unreadable
  // and untappable. Boot at the step whose ON-SCREEN tile matches the desktop
  // reference; `resizeCamera` below then preserves the centred focus exactly.
  const bootDpr = () => Math.min(dprCapOf(), (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  let cam: Camera = zoomAt(
    centerOnTile(
      createCamera(stage.clientWidth || 800, stage.clientHeight || 600),
      focus.tx, focus.ty,
    ),
    bootZoomFor(bootDpr()),
    (stage.clientWidth || 800) / 2, (stage.clientHeight || 600) / 2,
  );

  let renderer: IsoRenderer | null = null;
  /** C5: the atlas instance lives in the async boot; the debug console reads it here. */
  let atlasRef: Atlas | null = null;
  let hover: { tx: number; ty: number; ref: unknown } | null = null;
  let drag: { ax: number; ay: number } | null = null;
  let preview: DragPreview | null = null;

  // ── helpers ────────────────────────────────────────────────────────────
  let lastToastText = "", lastToastAt = -1e9;
  /**
   * MP-05: while the host applies a guest's intent, the toasts that path
   * produces are the GUEST's feedback — they go back down the wire in the next
   * delta instead of appearing over the host's own game. Null the rest of the
   * time, so a solo/host game's toasts are untouched.
   */
  let intentEcho: string[] | null = null;
  const toast = (text: string, kind: Toast["kind"] = "info") => {
    if (intentEcho) { intentEcho.push(text); return; }
    const now = performance.now();
    // the board fires per-gem; collapse repeats so a match is one line
    if (text === lastToastText && now - lastToastAt < 1200) return;
    lastToastText = text; lastToastAt = now;
    // U1: the restored HUD owns the toast DOM.
    ui.toast(text, kind);
  };

  /**
   * STORY-01: the face a beat speaks with. Rival beats wear the mood their
   * direction implies off the contract's painted sheet (an attack arrives
   * angry, a thwarted raid reads shocked); the player answers in their own
   * start-screen mugshot, exactly as the wire has always shown them.
   */
  const beatFaces = (direction: RivalryDirection | "banter" | null) => {
    const mood: Expression = direction ? FACE_FOR_DIRECTION[direction] : "calm";
    return {
      rival: faceOf(rivalCast, mood),
      you: faceOf(playerCast, "calm"),
    };
  };

  /** Queue one alternating portrait scene and preserve the whole exchange in
   *  Feed. Torvin never gets an unanswered line. */
  const playRivalryScene = (
    scene: RivalryScene, direction: RivalryDirection | "banter" | null = null,
  ) => {
    const faces = beatFaces(direction);
    const beats: UiRivalryBeat[] = scene.map((beat) => ({
      speaker: beat.speaker,
      text: beat.text,
      face: beat.speaker === "rival" ? faces.rival : faces.you,
    }));
    ui.rivalQuip(beats);
    for (const beat of scene) {
      ui.feed(`“${beat.text}”`, beat.speaker === "rival" ? rival.name : me.name);
    }
  };

  // ── STORY-01: the guide on the wire ──────────────────────────────────────
  // Mabel speaks in contracts only, once per moment per match, and only while
  // the player has not said otherwise (`?advisor=0`, or the stored word). Her
  // beats ride the same queue as the rivalry so a sabotage toast, a rival jab
  // and her advice stack in reading order instead of painting over each other.
  const advisorOn = storyOn && advisorEnabled();
  const advisorSeen = new Set<AdvisorEvent>();
  const ADVISOR_FACE: Record<AdvisorEvent, Expression> = {
    welcome: "calm", stalled: "mad", sabotaged: "shock",
    halfway: "smile", behind: "mad", gold: "calm",
  };
  const playAdvisor = (event: AdvisorEvent) => {
    if (!advisorOn || advisorSeen.has(event)) return;
    advisorSeen.add(event);
    const guideFace = faceOf("mabel", ADVISOR_FACE[event]);
    const playerFace = faceOf(playerCast, "calm");
    const beats: UiRivalryBeat[] = advisorBeats(event, storyChapter).map((beat) => (
      beat.speaker === "guide"
        ? { speaker: "guide", text: beat.text, face: guideFace, label: "Office · Mabel Quill" }
        : { speaker: "you", text: beat.text, face: playerFace }
    ));
    ui.rivalQuip(beats);
    for (const beat of beats) {
      ui.feed(`“${beat.text}”`, beat.speaker === "guide" ? "Mabel Quill" : me.name);
    }
  };
  /** The frame-loop half of the guide: she reads the same state the clocks do. */
  let playStartAt = 0;
  function advisorTick(now: number) {
    if (!advisorOn || phase !== "play") return;
    if (!playStartAt) { playStartAt = now; playAdvisor("welcome"); return; }
    const elapsed = now - playStartAt;
    if (elapsed > 90_000 && !eco.harvesters.some((h) => h.owner === me.id)) {
      playAdvisor("stalled");
    }
    const mine = vpFor(score, me.id);
    const theirs = vpFor(score, rival.id);
    if (mine > 0 && mine >= Math.ceil(winTarget() / 2) && mine < winTarget()) playAdvisor("halfway");
    if (elapsed > 120_000 && theirs - mine >= 3) playAdvisor("behind");
  }

  const rivalSpeaks = (direction: RivalryDirection, tactic: RivalryTactic) => {
    if (direction === "retort") playerSabotage++;
    else if (direction === "attack") rivalSabotageHits++;
    playRivalryScene(nextRivalScene(direction, tactic), direction);
    // STORY-01: a raid that lands is also the moment the guide explains what
    // stops the next one — once per match, and only inside a contract.
    if (direction === "attack") playAdvisor("sabotaged");
  };

  onFirstOilHarvest = () => {
    if (oilBanterSeen || phase !== "play") return;
    oilBanterSeen = true;
    // STORY-01: the first oil is the sixth colour arriving — in a contract it
    // is Mabel, not the rival, who explains what that means for the board.
    if (storyOn) playAdvisor("gold");
    else playRivalryScene(OIL_DRILLING_SCENE);
  };

  /**
   * The idle wire: a short Torvin exchange — an old tycoon's saying, a cringe
   * dad joke — drops into the rivalry feed every so often mid-game, so the two
   * feel like they're keeping each other company between the sabotage
   * set-pieces. It runs solo only (Torvin is the AI rival) and only once play
   * has begun: no jokes over the setup banners or the ending screen.
   *
   * Pacing: the first bit lands ~40s into play (time to get a road down), then
   * roughly every 58–111s. The jitter is Math.random on purpose — presentation
   * cadence, never the seeded simulation RNG.
   */
  const CHIT_CHAT_FIRST_MS = 40_000;
  const CHIT_CHAT_EVERY_MS = 65_000;
  function rivalChitChat(now: number) {
    if (!isSolo() || phase !== "play") return;
    if (!chitChatArmed) {
      chitChatArmed = true;
      nextChitChatAt = now + CHIT_CHAT_FIRST_MS;
      return;
    }
    if (now < nextChitChatAt) return;
    nextChitChatAt = now + CHIT_CHAT_EVERY_MS * (0.9 + Math.random() * 0.7);
    playRivalryScene(nextBanterScene(), "banter");
  }

  /**
   * RANK-01: the ROOM's id for a local seat. The local frame renames and
   * re-orders seats (players[0] is always "me"), while the wire — and every
   * message the room validates — speaks profile ids. The room refuses a result
   * that names a non-member, so getting this wrong would silently unrank a
   * finished match rather than rate the wrong player.
   */
  const wireIdOf = (p: PlayerState): string => {
    if (!net) return p.id;
    if (p === players[0]) return net.playerId;
    // #164: the roster fallback is the CAPTURED id — after a departure the
    // session has pruned the roster, and a claim naming nobody is a claim the
    // room refuses, which would silently unrank the survivor's forfeit win.
    return net.info?.roster.find((e) => e.id !== net.playerId)?.id
      || mpOpponentWireId
      || p.id;
  };

  /** #164: the rating row, as the departure sheet's status line. */
  const ratingLineHtml = (verdict: RankVerdict): string =>
    `Your rating: ${fmtRating(verdict.change.before)} → <b>${fmtRating(verdict.change.after)}</b> `
    + `<span class="rank-delta ${verdict.change.delta >= 0 ? "up" : "down"}">`
    + `${fmtRatingDelta(verdict.change.delta)}</span>`;

  // ── #164: the departure sheet — one dialog, every door, no blank panel ──

  /** The sheet's Leave door, once the rating has landed (or the bounded wait ran out). */
  const quitFromSheet = () => {
    leaveAfterVerdict = false;
    window.clearTimeout(leaveAfterVerdictTimer);
    if (leftSheet) { leftSheet.destroy(); leftSheet = null; }
    opts.onQuitToMenu?.();
  };

  /** "Claim the win now": the room files the forfeit win; the ledger presents it. */
  const claimWinNow = () => {
    leftSheet = null; // the door's click already closed the sheet
    if (net && rankRuntime) {
      rankRuntime.claimWin(net.playerId, wireIdOf(rival), (performance.now() - rankBootAt) / 1000);
    }
    // The ledger is both the celebration and the verdict's home: the room's
    // answer lands a round trip later, and onRankVerdict fills the rank row
    // ("filing…" until it does).
    winner = me;
    phase = "won";
    presentEnding(null);
  };

  /**
   * The Leave door. A survivor who walks out before the room's verdict
   * strands it: the room disposes when it empties, armed forfeit timer and
   * all, and the rating never moves. So Leave claims first when this seat
   * can (the host), or waits for the room's own filing when it cannot (the
   * guest — the room files the leaver's loss shortly after the seat
   * empties), and quits the moment the verdict has folded into the local
   * file. The wait is bounded: a room that never answers must not hold the
   * player hostage.
   */
  const leaveFromSheet = (canClaim: boolean) => {
    if (net && rankRuntime && !rankVerdict && mpMatchLive) {
      if (canClaim) {
        rankRuntime.claimWin(net.playerId, wireIdOf(rival), (performance.now() - rankBootAt) / 1000);
        leftSheet?.setStatus("Claiming your win — filing your rating…");
        leaveAfterVerdict = true;
        leaveAfterVerdictTimer = window.setTimeout(quitFromSheet, 5_000);
        return;
      }
      // A guest cannot file — only the seat that runs the simulation may
      // speak for it — so this waits on the room's own forfeit timer. That
      // is up to FORFEIT_GRACE_MS, and it is worth the wait: the difference
      // is a rating that moves and a rating that does not.
      leftSheet?.setStatus("Waiting for the room to file your win — up to 30 s. "
        + "It lands here, then you return to the menu.");
      leaveAfterVerdict = true;
      leaveAfterVerdictTimer = window.setTimeout(quitFromSheet, 35_000);
      return;
    }
    quitFromSheet();
  };

  /**
   * Raise the departure sheet — the ONE answer to "the far seat is gone".
   * `canClaim` is the host's privilege (the room files a result only from
   * the seat that runs the simulation); a guest survivor waits on the
   * room's own filing instead. A verdict already in hand opens the sheet
   * SETTLED: the rating has moved, Finish and Claim are decisions about a
   * rating that can no longer be filed, and Leave is the only honest door.
   */
  const openLeftSheet = (spec: { title: string; body: string; canClaim: boolean }) => {
    if (leftSheet || endingShown || disposed) return;
    const settled = rankVerdict !== null;
    const doors: LeftSheetDoors = {
      leave: {
        label: !settled && rankRuntime && spec.canClaim && mpMatchLive
          ? "Leave — claim the win first"
          : "Leave the match",
        onClick: () => leaveFromSheet(spec.canClaim),
      },
    };
    if (!settled && spec.canClaim) {
      doors.finish = {
        label: "Finish the game",
        onClick: () => {
          toast(rankRuntime
            ? "Play on — cross the star line and the win is claimed with your rank points."
            : "Play on — the board is yours to finish.", "info");
        },
      };
      if (rankRuntime && mpMatchLive) {
        doors.claim = { label: "Claim the win now", onClick: claimWinNow };
      }
    }
    leftSheet = showLeftSheet(ui.el, {
      title: spec.title,
      body: spec.body,
      ...(settled ? { statusHtml: ratingLineHtml(rankVerdict!) } : {}),
      doors,
    });
  };

  /** RANK-01: the ledger's rating row, from the room's verdict. */
  const rankLineFor = (verdict: RankVerdict): EndingRankLine => ({
    key: verdict.state.matches > 0 ? verdict.tierAfter.key : "unranked",
    tierLabel: verdict.state.matches > 0 ? verdict.tierAfter.label : "Unranked",
    rating: verdict.change.after,
    before: verdict.change.before,
    delta: verdict.change.delta,
    promoted: verdict.promoted,
    demoted: verdict.demoted,
    forfeit: verdict.forfeit,
    provisional: verdict.state.matches < 10,
    opponentKnown: verdict.opponentKnown,
  });

  /**
   * RANK-01: the room filed this match. Fill the ledger's rating row if the
   * ledger is already standing (it usually is — the host claims the result as
   * the star line is crossed, and the room's answer lands a round trip later),
   * and otherwise say it where the player is looking: a match decided by a
   * departure has no ledger, but it does have a rating.
   */
  const onRankVerdict = (verdict: RankVerdict) => {
    rankVerdict = verdict;
    // #164: the departure sheet's Leave door was waiting on exactly this —
    // the rating has folded into the local file, so the quit is honest now.
    if (leaveAfterVerdict) { quitFromSheet(); return; }
    // A standing departure sheet is the verdict's home when the match ended
    // by absence: fill its rating row and fold its doors down to the exit —
    // Finish and Claim are decisions about a rating that has already moved.
    if (leftSheet) { leftSheet.settle(ratingLineHtml(verdict), "Leave the match"); return; }
    const delta = fmtRatingDelta(verdict.change.delta);
    // The ledger usually beats this message to the screen: the host files the
    // result the instant the star line is crossed, so the answer lands a round
    // trip later. Fill the standing ledger's row and say nothing twice.
    if (endingView) {
      endingView.setRank(rankLineFor(verdict));
      return;
    }
    // No ledger is coming when the match was decided by a DEPARTURE: nothing
    // crossed a star line, so this is the only place the rating is ever shown.
    if (verdict.forfeit) {
      // #164: and it is shown on a sheet with a door, never on a panel the
      // player can only backdrop-click away — if no sheet is standing (the
      // events raced, or a reconnect waived one off that then died again),
      // open one, already settled.
      const filed = verdict.outcome === "win"
        ? `${rival.name} left the room, so the match is filed as a win.`
        : "You left the room, so the match is filed as a loss.";
      openLeftSheet({ title: "Opponent left", body: filed, canClaim: false });
      return;
    }
    // A star-line win whose ledger has not mounted yet: one line, and the
    // ledger carries the row a frame later.
    toast(`Rating ${fmtRating(verdict.change.before)} → ${fmtRating(verdict.change.after)} (${delta})`,
      verdict.change.delta >= 0 ? "good" : "bad");
  };

  /** Show the final ledger once. The same model builds victory and defeat, but
   *  only a human win receives the fireworks layer. */
  const presentEnding = (source: DecisiveSource = winningSource) => {
    if (endingShown || !winner) return;
    endingShown = true;
    winningSource = source;
    // #164: the match is decided — whatever "match in progress" memo the
    // front door wrote for this seat is now a lie, and only the layer that
    // wrote it can drop it.
    opts.onMatchEnded?.();
    const playerBreakdown = victoryBreakdown(eco, me.id, railPlatforms());
    const rivalBreakdown = victoryBreakdown(eco, rival.id, railPlatforms());
    const model = buildEnding({
      playerWon: winner.id === me.id,
      playerScore: vpFor(score, me.id),
      rivalScore: vpFor(score, rival.id),
      playerBreakdown,
      rivalBreakdown,
      decisiveSource: source,
      seed,
      rivalName: rival.name,
      difficulty: isSolo() ? skill().label : undefined,
      playerSabotage,
      rivalSabotage: rivalSabotageHits,
    });
    // A rival can cross the line while Help or the plant preview is open. Do
    // not leave that stale modal waiting underneath Review; the final ledger
    // becomes the one authoritative dialog.
    ui.hideModal();
    // SFX-01: the ledger's own cadence — warm and rising when the player won,
    // the same shape descending and muted when they did not. No fail horn: the
    // ending card is already sombre, and the sound must not gloat either way.
    sfx.play(model.outcome === "victory" ? "victory" : "defeat");
    const openLedger = () => {
      endingView = showEndingScreen(ui.el, model, {
        playerPortrait: opts.portrait ?? "vex",
        // RANK-01: `undefined` when this match is not rated at all (no row),
        // `null` while a rated match waits on the room's verdict (the row
        // prints "filing…"), and the line itself once it has landed.
        rank: rankRuntime ? (rankVerdict ? rankLineFor(rankVerdict) : null) : undefined,
        onRestart: () => {
          restartArmed = true;
          clearSave(saveKey);
          // Keep the selected difficulty: this is a rematch, not first-run
          // onboarding. The ☰ menu's New Game remains the full reset.
          location.reload();
        },
        // STORY-01: the ledger's third door — back to the campaign menu with
        // the contract recorded, instead of a reload into the same chapter.
        // CONTINUE-01 (#191): the decided contract is cleared first — its
        // result is already recorded, and leaving the finished save behind
        // would make the campaign card offer "Continue" straight back into
        // this ledger instead of a fresh attempt. `restartArmed` stops the
        // teardown's autosave from rewriting the slot we just cleared.
        ...(storyOn ? {
          onContinue: () => {
            restartArmed = true;
            clearSave(saveKey);
            opts.onStoryExit?.();
          },
        } : {}),
      });
    };
    // STORY-01: the epilogue stands BEFORE the ledger — the rival concedes (or
    // gloats) in person, Mabel closes the book, and only then does the match
    // show its arithmetic. The result is recorded first: a refresh mid-reel
    // must not lose the contract.
    if (storyChapter) {
      const won = winner.id === me.id;
      recordChapterResult(storyChapter.id, storyChapter.index, won, CHAPTERS.length);
      // BACK TO WORK: a won contract is a promotion — say so where the job was named.
      if (won) ui.feed(`Promoted: ${storyChapter.promotion}, ${EMPLOYER}`, "Contract");
      // #123: the loss epilogue shows every line in full immediately — the
      // slow typewriter stays on the win epilogue, the briefing and the reel.
      storyView = showScene(ui.el, won ? storyChapter.win : storyChapter.lose, {
        player: playerCast,
        skipLabel: "Skip epilogue ▸▸",
        instant: !won,
      });
      void storyView.promise.then(() => {
        storyView = null;
        if (!disposed) openLedger();
      });
    } else {
      openLedger();
    }
    // Preserve the completed ledger immediately instead of waiting up to five
    // seconds for autosave. A microtask also makes this safe during restore:
    // all runtime guards below have finished initialising before it writes.
    if (!savesOff) queueMicrotask(() => saveNow());
  };

  /**
   * W1: the affordability guard. `spend` can never take a purse below zero —
   * the preview already refuses unaffordable tiles, so this is the safety net
   * that makes "no purse value ever goes negative" true by construction
   * rather than by every caller remembering to check.
   */
  const spend = (p: PlayerState, cost: Purse): boolean => {
    if (!canAfford(p.purse, cost)) return false;
    for (const [k, v] of Object.entries(cost) as [Cargo, number][]) {
      p.purse[k] = (p.purse[k] ?? 0) - v;
    }
    return true;
  };
  const earn = (p: PlayerState, gain: Purse) => {
    for (const [k, v] of Object.entries(gain) as [Cargo, number][]) {
      p.purse[k] = (p.purse[k] ?? 0) + v;
    }
  };

  const factoryOf = (id: string) => eco.factories.find((f) => f.owner === id) ?? null;

  /** PP-06: the plant price, rendered from the one authoritative constant. */
  const plantCostLabel = () => (Object.entries(PLANT_COST) as [Cargo, number][])
    .map(([k, v]) => `${v} ${CARGO[k].icon}`).join(" ");

  const syncWorld = () => {
    world.roadBits = drawBits(track, "road");
    world.dirtBits = drawBits(track, "dirt");
    // RAIL-03 (#177): the rail bytes the chunk painter draws. Rebuilt here
    // because a lane belongs to a structure, not to the layer, so a platform
    // or a depot placed without laying a single rail tile still changes the
    // track. `rail.revision` rides along and is what the renderer diffs.
    world.rail = railDrawLayer(rail);
    // SCENERY: hide the trees the player has since built over. Roads are not
    // listed — the draw list reads roadBits/dirtBits directly — so this is
    // only the free-standing structures: plant footprints and depots.
    const blocked = new Set<number>();
    for (const f of eco.factories)
      for (const [x, y] of plantFootprintTiles(f.tx, f.ty))
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) blocked.add(y * MAP_W + x);
    for (const h of eco.harvesters)
      for (const [x, y] of depotTiles(h.tx, h.ty))
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) blocked.add(y * MAP_W + x);
    // RAIL-04: a platform or a train depot is a built thing — the trees it
    // stands on are hidden under it, exactly like a plant's footprint.
    for (const s of rail.structures)
      for (const [x, y] of footprintTiles(s))
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) blocked.add(y * MAP_W + x);
    world.sceneryBlocked = blocked;
    world.fields = scenery.fields.filter((f) => !clearedFields.has(f.id));
    // PP-12: one draw item per factory — the single TTD complex, drawn at the
    // footprint origin. The manifest footprint matches FACTORY_FOOTPRINT (both
    // derive from the art), so the anchor lands on the footprint's south
    // corner exactly like any other multi-tile building.
    const factoryItems = eco.factories.map((f) => ({
      sprite: FACTORY_SPRITE,
      tx: f.tx,
      ty: f.ty,
      ref: { kind: "factory", owner: f.owner },
    }));
    // TOWN-1 / TOWN-GRID: the town draw items — art on whole house BLOCKS.
    //
    // `townBuildings` decides the layout (see grid.ts): one 2x2 cell per
    // block where the hash picks one, single houses otherwise. It must be
    // asked at sync time rather than baked at generation, because a town
    // cell's footprint comes from the ATLAS and the per-building PNG layers
    // land after the first sync — `loadBuildingLayers` re-syncs, which is
    // when the towers move off the streets they used to be drawn across.
    const footprintOf = (sprite: string): [number, number] =>
      atlasRef?.get(sprite)?.footprint ?? [1, 1];
    const townItems = grid.towns.flatMap((t) =>
      townBuildings(t, footprintOf).map((b) => ({
        sprite: b.sprite,
        tx: b.tx, ty: b.ty,
        ref: { kind: "town", id: t.id } as unknown,
      })));
    world.extra = [
      ...townItems,
      ...factoryItems,
      // Every Depot is the same truck depot building, whatever it harvests.
      // Ownership shows in the inspector, the catchment overlays and the ref.
      ...eco.harvesters.map((h) => ({
        sprite: DEPOT_SPRITES[depotFacingOf(grid, h)],
        tx: h.tx, ty: h.ty, ref: { kind: "harvester", id: h.id, owner: h.owner },
      })),
      // RAIL-04: the railway's structures are ordinary footprint-anchored
      // sprites in the same static list (`railStructureItems` names them from
      // the manifest, and `syncWorld` is the only writer). A missing PNG just
      // means the sprite name is unknown to the atlas and nothing is drawn.
      ...railStructureItems(rail),
    ];
    // Every world change funnels through here (builds, demolition, loads,
    // guest snapshots and deltas), so it retires the network-derived caches
    // too: hover routes, score breakdowns, inspector components, drag previews.
    netVersion++;
    syncLabels();
    renderer?.setWorld(world);
  };

  /**
   * NAMES: rebuild the tag set from the live world — industry footprints
   * (anchored at the footprint centre so the name sits over the building,
   * not its top corner), towns, the plants and the depots, each with its
   * owner. Runs inside `syncWorld`, so any build/demolish/snapshot that
   * changes who stands where updates the tags on the same beat.
   */
  const syncLabels = () => {
    const entries: LabelEntry[] = [];
    for (const ind of grid.industries) {
      const def = INDUSTRY_BY_KEY[ind.type];
      entries.push({
        key: `ind-${ind.id}`,
        name: def?.name ?? ind.type,
        tx: ind.tx + ind.w / 2,
        ty: ind.ty + ind.h / 2,
        cls: "label-industry",
      });
    }
    for (const t of grid.towns) {
      entries.push({ key: `town-${t.id}`, name: "Town", tx: t.tx, ty: t.ty, cls: "label-town" });
    }
    for (const f of eco.factories) {
      entries.push({
        key: `plant-${f.owner}-${f.id}`,
        name: f.owner === me.id ? "Your Plant" : "Rival's Plant",
        tx: f.tx + FACTORY_FOOTPRINT[0] / 2,
        ty: f.ty + FACTORY_FOOTPRINT[1] / 2,
        cls: "label-plant",
      });
    }
    for (const hv of eco.harvesters) {
      entries.push({
        key: `depot-${hv.id}`,
        name: hv.owner === me.id ? "Your Depot" : "Rival Depot",
        tx: hv.tx, ty: hv.ty,
        cls: "label-depot",
      });
    }
    labels.sync(entries);
  };

  /**
   * VP-01: turn the scoreboard's diff into what the player sees.
   *
   * Two rules shape this, both from the same worry: a drag that paves twelve
   * tiles must not print twelve toasts (the old per-connection event stream was
   * already unreadable at that size), and a point that vanishes without a word
   * is the single most confusing thing this system can do. So events are
   * AGGREGATED per (source, direction) into one line, and the first few are
   * also floated on the map at the tile that earned or lost them — the number
   * appears where the road is, not only on the scoreboard.
   */
  const MAX_FLOATS_PER_EVENT = 4;
  /**
   * TOAST-ONCE: the "you just earned" VP toasts are one-shot per game, by
   * `${source}:${type}` — "upgrade:awarded" ("Paved N Dirt Road tile(s) · +X★")
   * and "plant:awarded" ("Processing plant raised · +1★"). The FIRST time a
   * point arrives the toast spells out what the action is worth in win points;
   * on every later rescore the per-tile float below still marks each point on
   * the map, the badge and the star bell still ring, so the repeated toast is
   * only the noise the player reported. A toast that was shown — closed with
   * the ✕ or auto-dismissed — never returns. The "lost" variants are
   * deliberately excluded: a point VANISHING is the one thing the scoreboard
   * must never report silently. In-memory on purpose: a new game is a new
   * lesson.
   */
  const vpToastSeen = new Set<string>();
  function applyVpEvents(events: VpEvent[], now: number) {
    if (!events.length) return;
    type Bucket = { n: number; vp: number; spots: [number, number][] };
    const byOwner = new Map<string, Map<string, Bucket>>();
    for (const e of events) {
      let kinds = byOwner.get(e.owner);
      if (!kinds) byOwner.set(e.owner, kinds = new Map());
      const key = `${e.source}:${e.type}`;
      const b = kinds.get(key) ?? { n: 0, vp: 0, spots: [] };
      b.n++;
      b.vp += e.delta;
      if (b.spots.length < MAX_FLOATS_PER_EVENT) b.spots.push([e.tx, e.ty]);
      kinds.set(key, b);
    }
    for (const [owner, kinds] of byOwner) {
      const mine = owner === "you";
      for (const [key, b] of kinds) {
        const [source, type] = key.split(":");
        const gained = type === "awarded";
        const label = source === "upgrade"
          ? (gained
            ? `Paved ${b.n} Dirt Road tile${b.n === 1 ? "" : "s"} · ${vpDeltaText(b.vp)}`
            : `${b.n} paved tile${b.n === 1 ? "" : "s"} lost · ${vpDeltaText(b.vp)}`)
          : (gained
            ? `Processing plant raised · ${vpDeltaText(b.vp)}`
            : `Processing plant lost · ${vpDeltaText(b.vp)}`);
        if (!mine) continue;          // the rival's line is its own business
        // TOAST-ONCE: the "you just earned" popup is a first-time lesson, not
        // a per-action ticker — once seen it stays gone (closed or not), while
        // the map floats keep marking every point where it happened.
        if (gained && vpToastSeen.has(key)) {
          for (const [tx, ty] of b.spots) {
            floats.add(vpDeltaText(b.vp / b.n), tx, ty, { cls: "delivery", now });
          }
          continue;
        }
        if (gained) vpToastSeen.add(key);
        toast(label, gained ? "good" : "bad");
        for (const [tx, ty] of b.spots) {
          floats.add(vpDeltaText(b.vp / b.n), tx, ty, { cls: gained ? "delivery" : "sabotage", now });
        }
      }
    }
    // The scoreboard's own tie-breaker: the first seat observed crossing the
    // line wins. Capture the event that did it so the intertitle can say
    // whether the last fraction came from pavement or a new plant.
    if (phase === "play") {
      for (const p of players) {
        if (!hasWon(score, p.id, winTarget())) continue;
        const decisive = [...events].reverse().find(
          (e) => e.owner === p.id && e.type === "awarded",
        )?.source ?? null;
        phase = "won";
        winner = p;
        winningSource = decisive;
        // RANK-01: the host is the ONLY seat that may file a result — it runs
        // the simulation, so it is the only one that can say the line was
        // crossed. The verdict goes to the room, which relays it back to both
        // seats, so neither seat rates this match from its own opinion.
        if (rankRuntime && !isGuest()) {
          const other = p === players[0] ? players[1] : players[0];
          rankRuntime.claimWin(wireIdOf(p), wireIdOf(other), (performance.now() - rankBootAt) / 1000);
        }
        const b = victoryBreakdown(eco, p.id, railPlatforms());
        toast(`${p.name} wins — ${fmtVp(vpFor(score, p.id))}★ `
          + `(${b.paved} paved tile${b.paved === 1 ? "" : "s"}, ${b.plants} plant${b.plants === 1 ? "" : "s"})`,
        p.human ? "good" : "bad");
        presentEnding(decisive);
        break;
      }
    }
  }

  /**
   * The one place the scoreboard is consulted, on every build and demolish
   * (VP-01: it reads the track's pave provenance and the plant list, so it is
   * still a network event and never a clock).
   */
  /** AI-03c: the ★ a player is WATCHED reaching — the feed's heartbeat.
   *  Fires only when a whole star arrives (⁺0.25★ paves stay map floats). */
  const starFed = new Map<string, number>();

  const rescoreNow = () => {
    const now = performance.now();
    // RAIL-02 (#176): platforms are the third scored thing, handed to the
    // scoreboard from the rail state on every rescore — built = awarded,
    // demolished = revoked, both through `applyVpEvents` like everything else.
    applyVpEvents(rescore(eco, score, railPlatforms()), now);
    for (const p of players) {
      const stars = Math.floor(vpFor(score, p.id));
      const last = starFed.get(p.id) ?? 0;
      if (stars > last) {
        starFed.set(p.id, stars);
        // SFX-01: a Victory Point is the only thing worth ringing for. The
        // rival's stars stay silent — the feed line is enough for those.
        if (p.human) sfx.play("star");
        ui.feed(`${p.human ? "You" : p.name} reach ${stars}★ of ${winTarget()}★`, p.name);
      } else if (stars < last) starFed.set(p.id, stars);
    }
    trucksDirty = true;   // RV-01: the network changed — replan the lorries
    netVersion++;         // RV-03: drop the hover-route cache so the closest route is re-checked
    // J1: the network just changed. Recompute what the quarry may pay and
    // spawn tokens for cargo that became reachable — no waiting for the 20s
    // clock, because "I connected it and nothing happened" is how this join
    // would look broken.
    // MP-05: not on a guest — its "reach" is the host's reach, and the tokens
    // it can see were spawned by the host's board clock.
    if (!isGuest()) {
      quarry.refresh(now);
      rivalQuarry.refresh(now);
    }
  };

  // ── actions ────────────────────────────────────────────────────────────
  /**
   * PP-02: the opening Factory for ONE seat — the rule half of `placeFactory`,
   * without the local player's rival search. MP-05 split it out because in a
   * hosted game the GUEST's factory arrives as an intent: same rule function
   * (`planFactoryPlacement` + `requireTown`), same record, no AI.
   *
   * The "already has one" guard is new with the split: a guest could otherwise
   * send the intent twice and open with two free Factories (each is plant #0).
   */
  function placeFactoryFor(p: PlayerState, tx: number, ty: number): boolean {
    const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true, track });
    if (!plan.valid) {
      toast(plan.code === "not-near-town"
        ? "The Factory must be placed next to a town — its footprint must share an edge with a town tile."
        : `Can't build there — ${plan.why ?? "not buildable"}.`, "bad");
      if (p.human) flashAt(tx, ty, plan.code === "not-near-town" ? "Factory must touch a town" : "Can't build here");
      return false;
    }
    // MP: the opening Factory may go beside ANY town — the two seats are rivals
    // racing for one island, not tenants of reserved plots. What stays is the
    // overlap guard: the other seat's opening buildings are live structures,
    // and in a hosted game the guest's Factory intent can land after the host
    // has already moved on to its Depot, so the guard does not wait on phase.
    if (isMp()) {
      // Factory footprints must not overlap live buildings (opening factories also check live buildings)
      for (const [fx, fy] of plan.footprint.map((f) => [f.tx, f.ty] as [number, number])) {
        if (eco.factories.some((f) => fx >= f.tx && fx < f.tx + FACTORY_FOOTPRINT[0] && fy >= f.ty && fy < f.ty + FACTORY_FOOTPRINT[1])) {
          toast("Can't build there — another Factory stands there.", "bad");
          return false;
        }
        if (eco.harvesters.some((h) => depotContains(h.tx, h.ty, fx, fy))) {
          toast("Can't build there — a Depot stands there.", "bad");
          return false;
        }
      }
    }
    if (eco.factories.some((f) => f.ownerId === p.i + 1)) {
      toast(`${p.human ? "You already have" : "That seat already has"} a starting Factory.`, "bad");
      if (p.human) flashAt(tx, ty, "You already have a Factory");
      return false;
    }
    // W2: the factory carries its builder's track-owner id (player index + 1).
    // PP-06: the starting Factory is plant #0 — same building, same record.
    eco.factories.push({
      owner: p.id, ownerId: p.i + 1, tx, ty,
      id: 0, townId: adjacentTown(grid, tx, ty)?.id ?? null,
    });
    // SFX-01: a heavy crate set down and latched. The rival's own factory
    // appears in the same instant as the player's, so only the human's click
    // gets the sound — one thunk per gesture, whoever else moved.
    if (p.human) sfx.play("build");
    return true;
  }

  function placeFactory(tx: number, ty: number): boolean {
    if (!placeFactoryFor(me, tx, ty)) return false;
    if (!isSolo() && !aiOpponent) {
      // MP-05: no AI rival to seat — the guest places its own opening Factory
      // through an intent, on its own click.
      // #186: an AI-filled seat is seated below, exactly as in solo — there is
      // nobody on the other end of the wire to click for it.
      phase = "setup-harvester";
      syncWorld();
      toast("Factory placed. Now place your first depot beside an industry.", "info");
      publishNet(performance.now(), true);
      return true;
    }
    // Give the rival a factory a good distance away, on legal ground it can
    // actually build from. W8: the farthest dirt-legal tile was often ROUGH,
    // where a paved Road is illegal, and the rival's paved-first plan then had
    // nothing to lay — it "played" every 9 s and never built a tile. `ai.ts`
    // ranks paved-legal tiles first and probes the top of the ranking for a
    // real plan before the tile is committed.
    const spot = chooseRivalFactorySpot(grid, track, [tx, ty], {
      purse: rival.purse, free: rival.freeTrack, ownerId: rival.i + 1, owner: rival.id,
      // PP-16: the human's setup Depot is already on the board and already holds
      // its catchment — the rival must not be parked on that ground.
      opponentHarvesters: eco.harvesters.filter((d) => d.ownerId !== rival.i + 1),
      // PP-05: the probe prices the rival's opening Depot on the same free
      // allowance the human's setup Depot rides on.
      freeDepots: rival.freeDepots,
      // L2 (#216): the probe plans with the loop's cost model (dirt free under newLoop).
      newLoop,
    });
    if (spot) {
      eco.factories.push({
        owner: "ai", ownerId: rival.i + 1, tx: spot[0], ty: spot[1],
        id: 0, townId: adjacentTown(grid, spot[0], spot[1])?.id ?? null,
      });
    }
    phase = "setup-harvester";
    syncWorld();
    toast("Factory placed. Now place your first depot beside an industry.", "info");
    return true;
  }

  /**
   * Place a Depot (internally still `harvester` — PP-01 kept the identifiers so
   * saves and snapshots keep working).
   *
   * PP-05: a PAID Depot costs `DEPOT_COST` — Oil included — and the price is
   * resolved by `priceDepot` against this player's purse and free allowance,
   * the same call the HUD label and the AI plan use. Two ordering rules make
   * the ticket's acceptance criteria true by construction:
   *   1. every legality check runs BEFORE the cost is priced, so a refused
   *      placement (water, occupied tile, empty catchment, short purse) has
   *      consumed nothing at all — no partial debit is reachable;
   *   2. the debit is `spend`, which is affordability-guarded and all-or-nothing,
   *      so a successful placement charges the complete cost exactly once.
   *
   * The first Depot each player builds rides on `freeDepots` (DATA, E8's K1
   * rule) rather than on the setup phase, which is what stops the opening from
   * deadlocking: Oil production itself needs a Depot.
   */
  // ── RAIL-04 (#178): the railway's five actions ─────────────────────────────
  /**
   * The owner's plants in the shape the rail rules read them. One adapter, so
   * the anchor rule, the placement preview and the demolish refund all ask
   * about `eco.factories` through the same fields.
   */
  const railPlants = () => eco.factories.map((f) => ({
    owner: f.owner, ownerId: f.ownerId, tx: f.tx, ty: f.ty, id: f.id ?? 0,
  }));

  /** The owner's platforms, as the scoreboard reads them. */
  const railPlatforms = () => rail.structures
    .filter((s) => s.kind === "platform")
    .map((s) => ({ id: s.id, ownerId: s.ownerId, owner: s.owner, tx: s.tx, ty: s.ty }));

  /** One rail structure's kind, in the wording the player reads. */
  const railKindName = (kind: RailStructure["kind"]) => (kind === "platform" ? "Platform" : "Train depot");

  /**
   * RAIL-02 (#176): place a platform — the anchor rule, the one-per-anchor
   * limit, the 4 Wood + 4 Stone + 12 Ore + 2 Oil price and the +1★ are all the
   * rail module's, and this is only the click that pays for it.
   */
  function placeRailPlatform(tx: number, ty: number, p: PlayerState): boolean {
    const ownerId = p.i + 1;
    const why = platformRefusal(grid, rail.structures, railPlants(), ownerId, tx, ty, railView);
    if (why !== "ok") {
      if (p.human) {
        toast(RAIL_REFUSAL_TEXT[why], "bad");
        flashAt(tx, ty, why === "anchor-taken" ? "You already have one here" : "Can't build here");
      }
      return false;
    }
    if (!canPay(p.purse, RAIL_COSTS.platform)) {
      if (p.human) {
        toast(`Not enough materials — a platform costs ${railCostLabel(RAIL_COSTS.platform)}.`, "bad");
        flashAt(tx, ty, `Platform costs ${railCostLabel(RAIL_COSTS.platform)}`);
      }
      return false;
    }
    const anchor = resolveAnchor(grid, railPlants(), ownerId, tx, ty, railView);
    if (!spend(p, RAIL_COSTS.platform)) return false;
    const built = placePlatform(rail, p.id, ownerId, tx, ty, railView, anchor);
    if (p.human) sfx.play("build");
    syncWorld();
    rescoreNow();       // RAIL-02: the platform's ★ rides the same rescore
    if (p.human) {
      toast(`Platform built — +${PLATFORM_VP}★. Run rail from it to a depot to start a line.`, "good");
    }
    return !!built;
  }

  /**
   * RAIL-02 (#176): place a train depot — 2×2, one declared rail exit, and the
   * exit has to join the owner's own rail (`depotRefusal` says why not).
   */
  function placeRailDepot(tx: number, ty: number, p: PlayerState): boolean {
    const ownerId = p.i + 1;
    const why = depotRefusal(grid, rail, ownerId, tx, ty, railView);
    if (why !== "ok") {
      if (p.human) {
        toast(RAIL_REFUSAL_TEXT[why], "bad");
        flashAt(tx, ty, why === "no-network" || why === "exit-blocked" ? "The exit needs your rail" : "Can't build here");
      }
      return false;
    }
    if (!canPay(p.purse, RAIL_COSTS.depot)) {
      if (p.human) {
        toast(`Not enough materials — a train depot costs ${railCostLabel(RAIL_COSTS.depot)}.`, "bad");
        flashAt(tx, ty, `Train depot costs ${railCostLabel(RAIL_COSTS.depot)}`);
      }
      return false;
    }
    if (!spend(p, RAIL_COSTS.depot)) return false;
    const built = placeDepot(rail, p.id, ownerId, tx, ty, railView);
    if (p.human) sfx.play("build");
    syncWorld();
    rescoreNow();
    if (p.human) toast("Train depot built. Buy a train from the Railway panel when a line is ready.", "good");
    return !!built;
  }

  /** The rail drag's price, in the same voice as every other price label. */
  const railCostLabel = (cost: Purse): string =>
    costEntries(cost).map(([cargo, n]) => `${n} ${CARGO[cargo].name}`).join(" + ");

  /**
   * RAIL-04 (#178): commit a rail drag. The tiles and the price come from
   * `railPreview` — the same function the overlay painted from — so what the
   * player saw is what they are charged, and `buildRail` refuses per tile in
   * the shared vocabulary when the pointer outran its own legality.
   */
  function commitRailDrag(p: PlayerState, pv: DragPreview & { why?: string | null }) {
    const res = buildRail(grid, track, rail, p.i + 1, pv.tiles);
    if (!Object.keys(res.cost).length && !res.built.length) {
      if (p.human) toast(res.why === "ok" ? "Can't build rail there." : RAIL_REFUSAL_TEXT[res.why as never], "bad");
      return;
    }
    if (Object.keys(res.cost).length && !spend(p, res.cost)) {
      // Unreachable in practice (the preview refused unaffordable tiles); the
      // guard is what keeps the invariant true regardless.
      toast("Not enough materials.", "bad");
    }
    if (p.human && res.built.length) sfx.play("place", { step: res.built.length });
    for (const [bx, by] of res.built) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, y = by + dy;
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
      }
    }
    if (res.why !== "ok" && p.human) toast(RAIL_REFUSAL_TEXT[res.why], "info");
    syncWorld();
    rescoreNow();
    if (p.human && res.built.length) {
      const end = res.built[res.built.length - 1];
      flashAt(end[0], end[1], "Rail laid", "good");
    }
  }

  /**
   * MP-05: the rail twin of `requestTrackBuild` — solo/host commits, a guest
   * sends the same gesture as an intent and the host runs it against seat 1.
   */
  const requestRailBuild = (
    ax: number, ay: number, bx: number, by: number, xFirst: boolean,
  ): (DragPreview & { why?: string | null }) | null => {
    if (phase !== "play") return null;
    const pv = railPreview(grid, track, rail, me.i + 1, me.purse, ax, ay, bx, by, xFirst);
    if (pv.tiles.length === 0) return null;
    if (isGuest()) {
      net?.sendIntent("build", { do: "rail", ax, ay, bx, by, xFirst });
      return pv;
    }
    commitRailDrag(me, pv);
    return pv;
  };

  /**
   * RAIL-04 (#178): buy a locomotive and one wagon and put them on a line —
   * "assign an owned industry platform to an owned plant platform, with a
   * reachable depot". The one-train-per-connected-network limit, the depot
   * reachability and the price are all checked inside `assignLine`/here, in
   * that order, so the player hears about the rule before the price.
   */
  function railAssign(sourceId: number, destId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "assign", source: sourceId, dest: destId }); return true; }
    const plan = assignLine(rail, p.i + 1, sourceId, destId);
    if (!plan.ok) {
      if (p.human) toast(plan.why ?? "That line cannot run.", "bad");
      return false;
    }
    if (!canPay(p.purse, RAIL_COSTS.train)) {
      // The train is bought with the line: undo the assignment rather than
      // leaving a line with no locomotive on it.
      if (plan.line) rail.lines.splice(rail.lines.indexOf(plan.line), 1);
      if (plan.train) rail.trains.splice(rail.trains.indexOf(plan.train), 1);
      if (p.human) toast(`Not enough materials — a train costs ${railCostLabel(RAIL_COSTS.train)}.`, "bad");
      return false;
    }
    spend(p, RAIL_COSTS.train);
    if (p.human) sfx.play("build");
    syncWorld();
    rescoreNow();
    if (p.human) {
      toast(`${plan.line?.name ?? "Line"} assigned — the train is leaving the depot.`, "good");
    }
    return true;
  }

  /**
   * #179: buy a train into a depot for one of the owner's lines. The rules
   * (ownership, reach, one train per network) are `buyTrain`'s; the price is
   * checked before and charged after, on the host, so a refusal costs nothing.
   */
  function railBuy(depotId: number, lineId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "buy", depot: depotId, line: lineId }); return true; }
    if (!rail.lines.some((l) => l.id === lineId && l.ownerId === p.i + 1)) {
      if (p.human) toast("Assign a line first — a train needs somewhere to run.", "bad");
      return false;
    }
    if (!canPay(p.purse, RAIL_COSTS.train)) {
      if (p.human) toast(`Not enough materials — a train costs ${railCostLabel(RAIL_COSTS.train)}.`, "bad");
      return false;
    }
    const bought = buyTrain(rail, p.i + 1, depotId, lineId);
    if (!bought.ok) {
      if (p.human) toast(bought.why ?? "That train cannot be bought.", "bad");
      return false;
    }
    spend(p, RAIL_COSTS.train);
    if (p.human) sfx.play("build");
    syncWorld();
    if (p.human) toast("Train bought — it is waiting in the depot. Press Start to send it off.", "good");
    return true;
  }

  /** #179: send a parked train off along its line. */
  function railStart(trainId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "start", id: trainId }); return true; }
    const train = rail.trains.find((t) => t.id === trainId && t.ownerId === p.i + 1);
    if (!train) return false;
    const ok = startLine(rail, p.i + 1, train.lineId);
    if (p.human) {
      toast(ok ? "Train started — it is leaving the depot." : (train.blockedWhy ?? "That train cannot start."), ok ? "good" : "bad");
    }
    syncWorld();
    return ok;
  }

  /** #179: rename one of the owner's lines (the rules trim and cap the name). */
  function railRename(lineId: number, name: string, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "rename", id: lineId, name }); return true; }
    const ok = renameLine(rail, p.i + 1, lineId, name);
    if (ok) syncWorld();
    return ok;
  }

  /** Send a line's train home (it stays until it is re-assigned or sold). */
  function railRecall(trainId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "recall", id: trainId }); return true; }
    const train = rail.trains.find((t) => t.id === trainId && t.ownerId === p.i + 1);
    if (!train) return false;
    const ok = recallTrain(rail, train);
    if (p.human && ok) toast("Train recalled to its depot.", "info");
    syncWorld();
    return ok;
  }

  /**
   * Sell a train back at floor(50%) — once, and only once it is home (the rule
   * lives in `sellTrain`, so the panel cannot offer a refund the rules refuse).
   */
  function railSell(trainId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "sell", id: trainId }); return true; }
    const train = rail.trains.find((t) => t.id === trainId && t.ownerId === p.i + 1);
    if (!train) return false;
    const sale = sellTrain(rail, train);
    if (!sale.ok) {
      if (p.human) toast(sale.why ?? "That train cannot be sold.", "bad");
      return false;
    }
    earn(p, sale.refund);
    if (p.human) sfx.play("demolish");
    syncWorld();
    rescoreNow();
    if (p.human) toast(`Train sold — ${railCostLabel(sale.refund)} salvaged.`, "info");
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════
  // L4 (#218) — the tuning session: match-3 sets a depot's yield level.
  //
  // The new loop's core event, and the only thing that opens the board on it:
  //
  //   build a Depot → a bounded session on the plant floor, scoped to that
  //   Depot's cargo → score → yield ×1…×2.5 stored on the Depot → board down.
  //
  // `economyTick` (L1b) reads `depotYield(depot)` every 3 s, so "a better
  // match visibly raises that Depot's tick rate" is one number flowing from
  // `tuning.ts` into the clock. The old loop never enters any of this: its
  // board is always on and keeps paying cargo (#234), so the shipped game is
  // untouched while the flag is dev-only.
  // ══════════════════════════════════════════════════════════════════════
  /** The session in progress — one at a time, and gone when it ends. */
  let tuning: TuningSession | null = null;

  /**
   * May the board take this swap, and if so, spend the move.
   *
   * The ONE gate both the chrome (`onSwap`) and the `__iso.swap` twin go
   * through, so a test can never drive the board somewhere a hand cannot. On
   * the old loop it is the board's own business as it always was; on the new
   * loop it is three rules, in order:
   *
   *   1. a session has to be OPEN — outside one the board is not a game
   *      surface at all ("the player is never forced to play the board outside
   *      a tuning session", and never able to);
   *   2. the swap has to be one the board would actually take — the same
   *      preconditions `trySwap` checks (adjacency is the chrome's), so
   *      tapping a girder or a smogged board costs no move;
   *   3. and then it COSTS one of the session's moves, dud swaps included —
   *      that is what a bounded match-3 session is.
   */
  function requestBoardSwap(r1: number, c1: number, r2: number, c2: number): void {
    const now = performance.now();
    if (newLoop) {
      if (!tuning) {
        toast("Build a Depot to open a tuning session — the board is only up while one runs.", "info");
        return;
      }
      if (quarry.board.fogUntil > now) return;
      const g1 = quarry.board.grid[r1]?.[c1], g2 = quarry.board.grid[r2]?.[c2];
      if (!g1 || !g2 || g1.block || g2.block) return;
      if (!takeTuningMove(tuning)) return;
    }
    void quarry.board.trySwap(r1, c1, r2, c2, now);
  }

  /**
   * The cargo a Depot's session is scoped to.
   *
   * Read from the industries the Depot actually HOLDS (its catchment minus
   * what another network claimed first — the same `heldIndustries` the clock
   * pays it for). A Depot standing on open ground with no road yet holds
   * nothing, and then its catchment's industries are the honest answer: the
   * session is about the resource the Depot was built for, not about whether
   * the player got round to connecting it. Ties go to the bigger producer,
   * which is the cargo the Depot will earn most of once it IS connected.
   */
  function tuningCargoFor(depot: Harvester): Cargo | null {
    const locks = industryLocks(eco);
    const held = heldIndustries(eco, depot, locks);
    const list = held.length ? held : industriesInCatchment(grid, depot);
    let best: Cargo | null = null, bestOut = -1;
    for (const ind of list) {
      const def = INDUSTRY_BY_KEY[ind.type];
      if (!def) continue;
      const out = ind.output ?? def.output;
      if (out > bestOut) { bestOut = out; best = def.cargo; }
    }
    return best;
  }

  /**
   * Open the tuning session for a Depot. The board is wiped to a fresh neutral
   * grid (tokens, frost, girders and smog all go — a session is a skill burst
   * on a clean table, and the rival's sabotage must not be able to rig a
   * yield), biased toward the Depot's own colour, and the plate takes over.
   */
  function openTuningSession(depot: Harvester): void {
    const cargo = tuningCargoFor(depot);
    if (!cargo) return;
    quarry.board.resetNeutral();
    quarry.board.setBias(CARGO_TO_GEM[cargo], TUNING.cargoBias);
    tuning = createTuningSession(depot.id, cargo);
    sfx.play("open");
    ui.openSessionBoard();
    toast(
      `Tuning session — ${tuningCargoLabel(cargo)}: ${TUNING.moves} moves on the plant floor set this Depot's yield.`,
      "info",
    );
  }

  /**
   * Close the open session.
   *
   * `abandon` is the ✕ (or a Depot that was demolished under it): the Depot
   * keeps the defined default yield, so there is never a stuck half-tuned
   * depot and never a session with nowhere to go. Without it, the score the
   * player earned is what lands. Either way the bias comes off the board, the
   * plate goes back to its idle line and the map (phone: the Map view) is
   * what the player is left looking at.
   */
  function closeTuningSession(abandon: boolean, note?: string): void {
    const s = tuning;
    if (!s) return;
    tuning = null;
    quarry.board.setBias(null);
    const depot = eco.harvesters.find((h) => h.id === s.depotId);
    const level = abandon ? TUNING_ABANDON_YIELD : tuningSessionYield(s);
    if (depot) {
      // Stored on the depot record, which is what the L1b clock multiplies by
      // — and what the snapshot (yield) and the savegame (harvesters) carry.
      depot.yield = level;
      const gained = !abandon && level > TUNING_ABANDON_YIELD;
      toast(
        note ?? (gained
          ? `Depot tuned — ${s.score} matched gems, yield ×${level}. It ticks faster from here.`
          : `Depot tuned — yield ×${level} (the default). A better session raises it.`),
        gained ? "good" : "info",
      );
      ui.feed(`Depot tuned: yield ×${level}`, me.name);
    } else if (note) {
      toast(note, "info");
    }
    ui.closeSessionBoard();
    rescoreNow();
  }

  /**
   * L4 (#218): the rival's tuning results. It plays no board for these — each
   * of its depots takes a SIMULATED session off its difficulty preset
   * (`tuningSkill`), which is the same 0…1 axis a player's score lives on. Run
   * on every AI turn and on the economy clock, so a depot from a restored save
   * (or one built before this landed) is never left without a level.
   */
  function applyRivalTuning(): void {
    if (!newLoop) return;
    const key = skill().key;
    for (const h of eco.harvesters) {
      if (h.owner === rival.id && h.yield === undefined) h.yield = rivalTuningYield(key);
    }
  }

  function placeHarvester(tx: number, ty: number, p: PlayerState): boolean {
    // The 2×2 truck Depot: the SAME plan the preview paints and the host
    // validates — four buildable tiles, no overlap with a Depot or a Factory,
    // a resource right beside the lot, an open side for the entrance, and
    // (PP-16) a resource beside it that nobody's road already holds.
    const plan = planDepotPlacement(grid, eco.harvesters, tx, ty, depotLocks());
    if (!plan.valid) {
      const message: Record<string, string> = {
        "depot-taken": "A depot is already there.",
        occupied: "Can't build there — something already stands there.",
        field: "A field or trees stand there — demolish them first.",
        "no-industry-beside": "A depot must sit right beside a resource.",
        "entrance-blocked": "Resources on both sides — the depot needs one open side for its entrance.",
        "industry-taken": "That industry is already claimed — only one Depot may hold it.",
      };
      toast(message[plan.code ?? ""] ?? "Can't build there.", "bad");
      if (p.human) flashAt(tx, ty, plan.why ? `Depot: ${plan.why}` : "Can't build here");
      return false;
    }
    const h: Harvester = {
      id: allocHarvesterId(), owner: p.id, ownerId: p.i + 1, tx, ty, facing: plan.facing ?? DEFAULT_FACING,
    };
    const served = plan.served;
    // L4 (#218): one tuning session at a time. The board is open for the
    // Depot the player is tuning RIGHT NOW, and a second Depot would have no
    // board to be tuned on (the plate is one session's plate). Refused before
    // anything is priced or spent, like every other refusal in here — and the
    // session can always be closed in one click, so this is never a dead end.
    if (newLoop && tuning) {
      toast("Finish the tuning session first — one Depot is tuned at a time.", "bad");
      if (p.human) flashAt(tx, ty, "Finish the tuning session first");
      return false;
    }
    // PP-05: priced only now that the site is legal, and spent only when the
    // whole cost is covered. Oil earned in the Processing Plant is in this same
    // purse, so processed Oil builds Depots with no special case.
    const price = priceDepot(p.purse, p.freeDepots);
    if (!price.affordable) {
      toast(`A Depot costs ${costLabel(DEPOT_COST)} — you need ${shortfallLabel(price.missing)}.`, "bad");
      if (p.human) flashAt(tx, ty, `Needs ${costCompact(DEPOT_COST)}`);
      return false;
    }
    if (!spend(p, price.cost)) return false;      // guard; `price.affordable` holds
    p.freeDepots = price.freeLeft;
    // L4 (#218): under the new loop every Depot is BORN at the default yield
    // and is then tuned. A level is never absent, so a mid-session reload or a
    // depot the player never got round to tuning still ticks (and still
    // round-trips the wire/save as a number).
    if (newLoop) h.yield = TUNING_ABANDON_YIELD;
    // G5: harvesters seed the network; they no longer need existing track.
    eco.harvesters.push(h);
    if (p.human) sfx.play("build");      // SFX-01
    syncWorld();
    rescoreNow();
    // Gold Mine warning: the moment the PLAYER stands a Depot beside a Gold
    // Mine, Torvin warns that chasing gold is a young man's game — it drops a
    // sixth colour into the player's own board and a coin buys only Black
    // Market spite aimed at the one rival who'd rather you didn't. He fires
    // the speech to cover his own skin, and the pool rotates so a second gold
    // depot hears a different version. Solo only: in a hosted game seat 1 is a
    // person, not Torvin.
    if (p.human && isSolo() && served.some((ind) => ind.type === "gold_mine")) {
      // STORY-01: the same fine print, in the guide's voice, inside a contract.
      if (storyOn) playAdvisor("gold");
      else playRivalryScene(nextGoldMineScene());
    }
    // L4 (#218): building the Depot IS opening its tuning session. Opens last,
    // so the Depot exists (and can be scored/paid for) before the board comes
    // up for it. Only the LOCAL seat's own build: a guest's Depot arrives as an
    // intent on the host, and the host has no board of the guest's to open
    // (newLoop is refused in a room anyway — belt and braces).
    if (newLoop && p === me && !isGuest()) openTuningSession(h);
    return true;
  }

  /**
   * PP-06: raise an ADDITIONAL processing plant beside another town.
   *
   * One rule function (`plantRefusal`) gates the preview, this click and the
   * AI, so the town-adjacency requirement has no bypass. The cost is checked
   * BEFORE the site exists and charged exactly once, on the single success
   * path — a refused placement can never take resources.
   */
  function placePlant(tx: number, ty: number, p: PlayerState): boolean {
    const why = plantRefusal(grid, track, eco, tx, ty);
    if (why !== null) {
      if (p.human) {
        toast(PLANT_REFUSAL_TEXT[why], "bad");
        // The toast says the rule; the flash — one short line at the refused
        // spot — says where the thing the player aimed at actually goes.
        flashAt(tx, ty, PLANT_FLASH_TEXT[why] ?? "Can't build here");
      }
      return false;
    }
    if (!canAffordPlant(p.purse)) {
      if (p.human) {
        toast(`Not enough materials — a processing plant costs ${plantCostLabel()}.`, "bad");
        flashAt(tx, ty, `Plant costs ${plantCostLabel()}`);
      }
      return false;
    }
    if (!spend(p, PLANT_COST)) return false;            // charged exactly once
    const plant = addPlant(grid, track, eco, p.id, p.i + 1, tx, ty);
    if (!plant) {                                        // unreachable; refund
      earn(p, PLANT_COST);
      return false;
    }
    // SFX-01: the crate, then — because a plant is a Victory Point — the
    // star bell from `rescoreNow` a few lines below. Thunk, then chime.
    if (p.human) sfx.play("build");
    syncWorld();
    rescoreNow();
    if (p.human) {
      const n = plantsOf(eco, p.id).length;
      toast(`Processing plant #${n} raised beside the town. Connect depots to it — they all feed the same board.`, "good");
    }
    return true;
  }

  function commitTrackDrag(p: PlayerState, pv: DragPreview, kind: TrackKind) {
    // W2: every tile the drag lays is stamped with the builder's owner id,
    // so the committed road is exactly the tiles that join `p`'s network.
    const res = commitDrag(track, kind, pv, p.i + 1);
    // The first human track on the map retires the "connect your depot to
    // your Factory" guidance banner — the guidance is done, and a banner
    // over the map after the first road reads as a popup blocking the game.
    if (p.human && res.built.length && !firstTrackBuilt) {
      firstTrackBuilt = true;
      // …and mark the spot with the one line that says what just happened,
      // at the tile the drag ENDED on (the new end of the network).
      const end = res.built[res.built.length - 1];
      if (end) flashAt(end[0], end[1], kind === "road" ? "Road laid" : "Dirt Road laid", "good");
    }
    // SFX-01: one drag, one sound — a shovel patting earth down for Dirt, or
    // gravel dressed and rolled for a paved Road. The tile count rides along as
    // `step`, so a six-tile line gets two extra pats behind the first instead
    // of six identical knocks (and the cue's own 40 ms gap does the rest).
    if (p.human && res.built.length) {
      sfx.play(kind === "road" ? "pave" : "place", { step: res.built.length });
    }
    // W1: the commit spends EXACTLY what the preview charged. The free
    // allowance and the per-tile costs were computed by `previewDrag` over
    // the same cost model the preview drew, so "what you see" and "what you
    // are charged" are one number. `spend` itself is affordability-guarded,
    // so even a stale preview can never push a purse negative.
    p.freeTrack = Math.max(0, p.freeTrack - pv.free);
    if (Object.keys(pv.cost).length && !spend(p, pv.cost)) {
      // Unreachable in practice (the preview refused unaffordable tiles);
      // the guard is what makes the invariant hold regardless.
      toast("Not enough materials.", "bad");
    }
    for (const [bx, by] of res.built) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, y = by + dy;
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
      }
    }
    syncWorld();
    rescoreNow();
    if (pv.free > 0) toast(`${pv.free} free setup tile${pv.free > 1 ? "s" : ""} used.`, "info");
  }

  /**
   * MP-05: `p` is the seat doing the demolishing. It defaults to the local
   * player, so every existing call site (the click, the e2e twin) is
   * unchanged, while the host can run the SAME path for a guest intent — the
   * "one cost model, one rule" invariant extended to the guest's actions.
   */
  function doDemolish(tx: number, ty: number, p: PlayerState = me) {
    // ── RAIL-04 (#178): the railway comes down through this same tool ───────
    // A platform or a train depot first (its footprint tiles are what a player
    // clicks), then a rail tile. Both are owner-scoped like the road tiers, and
    // both refuse rather than destroy a train: a structure a train is standing
    // on, and a tile a locomotive or its wagon occupies.
    const rs = structureAt(rail, tx, ty);
    if (rs) {
      if (rs.ownerId !== p.i + 1) {
        toast("That railway isn't yours.", "bad");
        if (p.human) flashAt(tx, ty, "Not yours to remove");
        return;
      }
      const cost = rs.kind === "platform" ? RAIL_COSTS.platform : RAIL_COSTS.depot;
      const gone = demolishStructure(rail, rs.id);
      if (!gone) {
        // Two refusals share this path: a train physically ON the structure,
        // and a depot that still has a train based at it (the epic's "never
        // demolish a structure a train occupies" — a shed with a train in it
        // is the clearest case, and destroying it would delete the train).
        const based = rs.kind === "depot" ? trainBasedAt(rail, rs.id) : null;
        toast(
          based ? "A train is based here — sell it first." : "A train is standing there — send it home first.",
          "bad",
        );
        if (p.human) flashAt(tx, ty, based ? "Train is based here" : "A train is on it");
        return;
      }
      // #142: demolition returns floor(50%) of the build price, and the
      // platform's ★ goes with it (`rescoreNow` below revokes it).
      const refund = resaleValue(cost);
      if (Object.keys(refund).length) earn(p, refund);
      if (p.human) sfx.play("demolish");
      // demolishStructure has already dropped any line that lost a platform —
      // and a depot can no longer come down under its train (that refusal is
      // the `based` branch above), so no train is ever deleted by demolition.
      syncWorld();
      rescoreNow();
      toast(`${railKindName(rs.kind)} removed${Object.keys(refund).length ? ` — ${railCostLabel(refund)} salvaged` : ""}.`, "info");
      return;
    }
    if (hasRail(rail.rail, tx, ty)) {
      if (rail.rail.owner[tIdx(tx, ty)] !== p.i + 1) {
        toast("That rail isn't yours.", "bad");
        if (p.human) flashAt(tx, ty, "Not yours to remove");
        return;
      }
      if (trainOccupies(rail, tx, ty)) {
        toast("A train is standing there — move the line first.", "bad");
        if (p.human) flashAt(tx, ty, "A train is on it");
        return;
      }
      demolishRail(rail, tx, ty);
      // A rail tile is 1 Stone, so floor(50%) is nothing — said out loud so
      // the refund line is never a mystery.
      if (p.human) sfx.play("demolish", { gain: 0.6 });
      syncWorld();
      rescoreNow();
      toast("Rail lifted.", "info");
      return;
    }
    // any tile of the 2×2 lot demolishes the Depot standing on it
    const hi = eco.harvesters.findIndex((h) => depotContains(h.tx, h.ty, tx, ty) && h.owner === p.id);
    if (hi >= 0) {
      const removed = eco.harvesters[hi];
      eco.harvesters.splice(hi, 1);
      // L4 (#218): the board was only up for THAT Depot's session. Without
      // this, demolishing a Depot mid-session would leave the player on a
      // board with no session behind it and no key out — the stuck state the
      // ticket calls out.
      if (tuning?.depotId === removed.id) {
        closeTuningSession(false, "The tuned Depot was removed — tuning session closed.");
      }
      if (p.human) sfx.play("demolish");   // SFX-01
      syncWorld(); rescoreNow();
      toast("Depot removed.", "info");
      return;
    }
    // PP-06: a plant is demolishable like any other building — but never the
    // last one, or the player would have nowhere to deliver.
    const pi = eco.factories.findIndex((f) => f.owner === p.id
      && tx >= f.tx && tx < f.tx + FACTORY_FOOTPRINT[0]
      && ty >= f.ty && ty < f.ty + FACTORY_FOOTPRINT[1]);
    if (pi >= 0) {
      if (plantsOf(eco, p.id).length <= 1) {
        toast("You can't demolish your only processing plant.", "bad");
        if (p.human) flashAt(tx, ty, "Your last plant stays");
        return;
      }
      eco.factories.splice(pi, 1);
      if (p.human) sfx.play("demolish");   // SFX-01
      syncWorld(); rescoreNow();
      toast("Processing plant demolished.", "info");
      return;
    }
    // RES-FIELDS: a wheat field or tree block comes down for free, for
    // whoever wants the ground — that is how a Depot or a road gets through.
    const field = fieldAt(tx, ty);
    if (field) {
      clearedFields.add(field.id);
      stampFields();
      if (p.human) sfx.play("demolish");
      syncWorld(); rescoreNow();
      toast(field.sprite === "trees" ? "Trees felled — the ground is clear." : "Wheat field cleared.", "info");
      return;
    }
    let removedKind: TrackKind | null = null;
    // W2: the tool only tears down track YOU built. Your demolish can never
    // cut the rival's line (and vice-versa) — "no implicit sharing" applies
    // to destruction, not just travel. PP-13: that also protects the map's
    // PUBLIC highways, which carry owner `PUBLIC_OWNER` and are nobody's to
    // demolish.
    const mine = track.owner[tIdx(tx, ty)] === p.i + 1;
    for (const kind of ["road", "dirt"] as TrackKind[]) {
      if (mine && hasTrack(track, kind, tx, ty)) {
        demolishTile(track, kind, tx, ty); removedKind = kind; break;
      }
    }
    if (!removedKind) {
      // PP-13: a public highway is track you may USE but never tear up — say
      // so, rather than reporting an empty tile.
      const publicRoad = isPublicRoad(track, tx, ty);
      toast(
        publicRoad
          ? "That's a public road — it isn't yours to demolish."
          : "Nothing to demolish there.",
        "bad",
      );
      if (p.human) flashAt(tx, ty, publicRoad ? "Public road — can't tear up" : "Nothing to demolish");
      return;
    }
    // PP-13: tearing up a DIRT ROAD salvages one of the two materials it cost
    // (`BUILD_COSTS.dirt` is 1 Wood + 1 Stone). WHICH one comes back is the
    // random part, so demolition is a partial refund rather than free
    // re-routing. The paved Road pays nothing back: its price is dominated by
    // 4 Ore, and the dirt→road pave is what upgrades are for.
    // L2 (#216): under newLoop dirt is free, so it salvages nothing — a free
    // tile must not mint resources. Tearing it up is free re-routing.
    // SFX-01: timber coming apart — a little further away for a single tile
    // of track than for a whole building.
    if (p.human) sfx.play("demolish", removedKind === "dirt" ? undefined : { gain: 0.8 });
    if (removedKind === "dirt") {
      if (newLoop) {
        toast("Dirt Road cleared.", "info");
      } else {
        const back = choice(DIRT_DEMOLISH_REFUND);
        earn(p, { [back]: 1 });
        toast(`Dirt Road cleared — salvaged 1 ${CARGO[back].icon} ${CARGO[back].name}.`, "good");
      }
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
    }
    syncWorld();
    rescoreNow();
  }

  // ── Protests: the Black Market's roadblock ─────────────────────────────────
  // A protest is a tile + an expiry, bought with Gold and staged on any PUBLIC
  // road (highways and town streets — `isPublicRoad`). While it stands, every
  // lorry whose next tile is that one holds where it is (`tickTrucks`'
  // `blocked` set): nothing re-routes and nothing else changes — the economy
  // still counts the road as connected, but the deliveries stop arriving, so
  // the bitten cargo stops minting tokens. It blocks YOUR lorries too.
  interface Protest { tx: number; ty: number; until: number; owner: string }
  const protests = new Map<number, Protest>();
  /** A bought protest waiting for its tile — map clicks stage it, Esc cancels. */
  let pendingProtest = false;
  /** Remaining time as the overlay badge and toasts print it: "2:00", "0:07". */
  const fmtProtestLeft = (ms: number): string => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  /** May a protest be staged at (tx,ty)? Any public road with none already. */
  const protestPlaceable = (tx: number, ty: number): boolean =>
    isPublicRoad(track, tx, ty) && !protests.has(tIdx(tx, ty));

  /** Stage the armed protest at (tx,ty), charging the Gold. False = still armed. */
  function placeProtest(tx: number, ty: number): boolean {
    // #115: the guest's two-step protest — the card ARMED targeting locally
    // (see `buyBlack`), and this click submits the tile as an intent. The
    // local road/occupancy checks are FEEDBACK (a bad click keeps targeting,
    // exactly as the host's own click does); the host is authoritative for
    // eligibility, occupancy, affordability and the charge, and its refusal
    // arrives as a notice toast. Nothing is charged here.
    if (isGuest()) {
      if (!isPublicRoad(track, tx, ty)) {
        toast("Protests go on public roads — the highways and town streets.", "bad");
        return false;
      }
      if (protests.has(tIdx(tx, ty))) {
        toast("There's already a protest on that tile.", "bad");
        return false;
      }
      pendingProtest = false;
      net?.sendIntent("blackMarket", { key: "protest_place", tx, ty });
      toast("Requesting protest placement…", "info");
      return true;
    }
    const now = performance.now();
    if (!isPublicRoad(track, tx, ty)) {
      toast("Protests go on public roads — the highways and town streets.", "bad");
      return false;
    }
    if (protests.has(tIdx(tx, ty))) {
      toast("There's already a protest on that tile.", "bad");
      return false;
    }
    const price = SABOTAGE.protest.gold;
    if ((me.purse.gold ?? 0) < price) {
      toast(`Needs ${price} Gold.`, "bad");
      return false;
    }
    spend(me, { gold: price });
    sfx.play("boom", { gain: 0.6 });      // SFX-01: a roadblock goes down
    protests.set(tIdx(tx, ty), { tx, ty, until: now + PROTEST_MS, owner: me.id });
    pendingProtest = false;
    floats.add("✊ PROTEST", tx, ty, { cls: "sabotage", now });
    ui.feed(`You stage a protest on the public road — all trucks stop for ${fmtProtestLeft(PROTEST_MS)}.`);
    toast(`Protest placed — ALL trucks stop for ${fmtProtestLeft(PROTEST_MS)}, yours included.`, "good");
    rivalSpeaks("retort", "protest");
    return true;
  }

  /** Clear every protest whose time is up (one line no matter how many go). */
  function expireProtests(now: number): number {
    let n = 0;
    for (const [i, p] of protests) {
      if (p.until > now) continue;
      protests.delete(i);
      floats.add("ROAD CLEAR", p.tx, p.ty, { cls: "delivery", now });
      n++;
    }
    if (n > 0) {
      const msg = n === 1
        ? "The protest dispersed — traffic is moving again."
        : `${n} protests dispersed — traffic is moving again.`;
      toast(msg, "info");
      ui.feed(msg);
    }
    return n;
  }

  // ── Black Market (U1 wiring over the restored board + industry blockade) ──
  const REPAIR_ISO_COST: Purse = { wood: 1, stone: 1, grain: 1, ore: 1 };
  /**
   * PP-08: Security Forces are defensive, not sabotage, so they no longer cost
   * Gold. `SECURITY.cost` is declared in the legacy ResKey table
   * (`game/config.ts`); GEM_TO_CARGO is the one ResKey→Cargo bijection, so the
   * same mapping the board uses moves the price into purse space
   * (`wheat`→grain, `brick`→stone). Only the five SABOTAGE actions above keep
   * a Gold price — Gold is reserved for Black Market sabotage.
   */
  const SECURITY_ISO_COST: Purse = Object.fromEntries(
    (Object.entries(SECURITY.cost ?? {}) as [ResKey, number][])
      .map(([r, n]) => [GEM_TO_CARGO[r], n]),
  ) as Purse;

  // ── #111/#115: ONE Black-Market core for every seat ──────────────────────
  // A host click, a solo click and a relayed guest intent all run the SAME
  // path (`buyBlackFor`), so spending, eligibility, feedback and effects
  // cannot diverge between seats. The defender is always the seat OPPOSITE
  // the attacker — the pre-fix guest branch reached for `rivalPlant`, which
  // in the host simulation IS the guest's own authoritative board, so the
  // guest paid to freeze itself.
  const otherSeat = (p: PlayerState): PlayerState => players[p.i === 0 ? 1 : 0];
  /** #111: per-seat Security Forces. Seat 0's guard also stops the solo
   *  rival's raids (`rivalRaid`); a guest's hire now guards the guest plant. */
  const securityOf = (id: string) => (id === players[0].id ? securityUntil : guestSecurityUntil);
  const armSecurityFor = (p: PlayerState, until: number) => {
    if (p.i === 0) securityUntil = until; else guestSecurityUntil = until;
  };
  /** The plant board a seat OWNS (host seat = the quarry board, guest seat =
   *  the rival plant's board). */
  const boardOfSeat = (id: string): typeof quarry.board =>
    id === players[0].id ? quarry.board : rivalQuarry.board;
  const sabotageFloat = (defenderId: string, text: string, now: number) => {
    const f = factoryOf(defenderId);
    if (f) floats.add(text, f.tx, f.ty, { cls: "sabotage", now });
  };
  /** The sabotage status of ANY seat's plant — the guest seat's wrapper knows
   *  its own board; the host seat's is counted straight off its board. */
  const sabotageStatusOf = (id: string, now: number): RivalStatus => {
    if (id === players[1].id) return rivalPlant.status(now);
    let frozen = 0, girders = 0;
    for (const g of quarry.board.gems()) {
      if (g.block) girders++;
      else if (g.hard > 0) frozen++;
    }
    return { frozen, girders, smog: quarry.board.fogUntil > now };
  };
  /**
   * #111: Gold-priced plant sabotage for ANY attacker. Charges exactly once
   * (an unaffordable card charges nothing), honours the DEFENDER's Security
   * Forces (paid either way — the rule the solo raid always kept), lands on
   * the opponent's plant, and publishes so both clients see the effect now.
   */
  function plantSabotage(attacker: PlayerState, key: "harden" | "block" | "fog"): boolean {
    const now = performance.now();
    const price = SABOTAGE[key].gold;
    if ((attacker.purse.gold ?? 0) < price) { toast(`Needs ${price} Gold.`, "bad"); return false; }
    const defender = otherSeat(attacker);
    spend(attacker, { gold: price });
    if (now < securityOf(defender.id)) {
      toast(`Security Forces turned the ${SABOTAGE[key].name} away.`, "info");
      return true;
    }
    const ms = key === "harden" ? RIVAL_FROST_MS : key === "block" ? RIVAL_GIRDER_MS : RIVAL_SMOG_MS;
    if (defender.id === players[1].id) {
      // The guest plant's expiry clocks (frost melt, girder haul-away) are
      // booked by its wrapper — attacks on it go THROUGH `rivalPlant`, never
      // at the raw board, or the melt would never be scheduled.
      if (key === "harden") { const n = rivalPlant.frost(now); sabotageFloat(defender.id, `❄ ${n} FROZEN`, now); }
      else if (key === "block") { const n = rivalPlant.girders(now); sabotageFloat(defender.id, `🏗 ${n} GIRDERS`, now); }
      else { rivalPlant.smog(now); sabotageFloat(defender.id, "🌫 SMOG", now); }
    } else {
      // The host plant: same timings, applied straight to the board. Girders
      // expire through the board's own `blockUntil` sweep; frost cracks the
      // way it always has when the defender matches through it.
      const board = quarry.board;
      if (key === "harden") { board.harden(); sabotageFloat(defender.id, `❄ ${sabotageStatusOf(defender.id, now).frozen} FROZEN`, now); }
      else if (key === "block") { board.dropBlocks(4, RIVAL_GIRDER_MS, now); sabotageFloat(defender.id, `🏗 ${sabotageStatusOf(defender.id, now).girders} GIRDERS`, now); }
      else { board.fog(RIVAL_SMOG_MS, now); sabotageFloat(defender.id, "🌫 SMOG", now); }
    }
    // The defender hears about it when it is a person on this machine…
    if (defender.id === players[0].id && isMp()) {
      toast(`${attacker.name} hit your plant with ${SABOTAGE[key].name}!`, "bad");
    }
    // …and the attacker gets the priced receipt (under an intent this is the
    // line the notice echo carries back to the guest's own screen).
    const dent = Math.round((1 - plantHealth(sabotageStatusOf(defender.id, now))) * 100);
    toast(`${SABOTAGE[key].name}: its yield is down ${dent}% for ${ms / 1000}s.`, "good");
    // PP-14b: push immediately so the other browser sees the effect now, not
    // on the next 200ms heartbeat.
    if (isMp()) publishNet(now, true);
    return true;
  }

  /**
   * The shared Black-Market core behind every seat's card. Returns whether
   * the card resolved (charged, or legitimately refused without a charge);
   * its feedback is toasts, so an intent echoes exactly what a click said.
   */
  function buyBlackFor(actor: PlayerState, key: string): boolean {
    const now = performance.now();
    const spendGold = (n: number) => {
      if ((actor.purse.gold ?? 0) < n) { toast(`Needs ${n} Gold.`, "bad"); return false; }
      spend(actor, { gold: n });
      return true;
    };
    if (key === "bandit") {
      if (!spendGold(SABOTAGE.bandit.gold)) return false;
      // TK-008: there is exactly ONE rival per seat, so a Blockade needs no
      // targeting step — auto-route it to the industry that costs the OTHER
      // seat the most yield, whoever is buying.
      const target = pickBlockadeTarget(eco, otherSeat(actor).id, now);
      if (!target) {
        earn(actor, { gold: SABOTAGE.bandit.gold });   // refund; nothing to hit
        toast("No industry to blockade — gold refunded.", "bad");
        return false;
      }
      target.banditUntil = now + BANDIT_MS;
      const def = INDUSTRY_BY_KEY[target.type];
      toast(`Blockade set on ${def?.name ?? target.type} — the rival can't harvest it for ${BANDIT_MS / 1000}s.`, "good");
      if (isMp()) publishNet(now, true);
      return true;
    }
    if (key === "protest") {
      // A protest is bought and then PLACED: armed here, charged at placement,
      // so cancelling (or never finding a road) costs nothing. A guest never
      // reaches this branch on the host — its arming is local (#115) and its
      // placement arrives as a validated `protest_place` intent.
      if (pendingProtest) {
        pendingProtest = false;
        toast("Protest cancelled.", "info");
        return true;
      }
      if ((actor.purse.gold ?? 0) < SABOTAGE.protest.gold) {
        toast(`Needs ${SABOTAGE.protest.gold} Gold.`, "bad");
        return false;
      }
      pendingProtest = true;
      toast(`Protest ready — click any public road to block ALL trucks for ${fmtProtestLeft(PROTEST_MS)}.`, "info");
      return true;
    }
    if (key === "harden" || key === "block" || key === "fog") {
      // ── A1: sabotage hits the OPPONENT's plant, not the buyer's ─────────
      if (!plantSabotage(actor, key)) return false;
      if (actor.id === players[0].id) {
        sfx.play("boom", { gain: key === "fog" ? 0.55 : 0.65 });   // SFX-01
        rivalSpeaks("retort", key);
      }
      return true;
    }
    if (key === "security") {
      // PP-08: this is a defensive action, so it is bought with MATERIALS —
      // never with Gold. Insufficient materials refuse the hire and consume
      // nothing (the affordability check runs before any deduction).
      const affordable = (Object.entries(SECURITY_ISO_COST) as [Cargo, number][])
        .every(([k, v]) => (actor.purse[k] ?? 0) >= v);
      if (!affordable) { toast("Not enough materials for Security Forces.", "bad"); return false; }
      spend(actor, SECURITY_ISO_COST);
      // A1: Security Forces guard the BUYER's plant against the other seat's
      // sabotage (and, for seat 0, the solo rival's raids — see `rivalRaid`).
      armSecurityFor(actor, now + SECURITY.ms);
      if (actor.id === players[0].id) sfx.play("build");   // SFX-01: a crew sets up on site
      toast(`Security Forces hired — guarded for ${SECURITY.ms / 1000}s.`, "info");
      if (isMp()) publishNet(now, true);
      return true;
    }
    if (key === "repair") {
      const affordable = (Object.entries(REPAIR_ISO_COST) as [Cargo, number][])
        .every(([k, v]) => (actor.purse[k] ?? 0) >= v);
      if (!affordable) { toast("Not enough materials for Repair Crew.", "bad"); return false; }
      spend(actor, REPAIR_ISO_COST);
      // A repair crew fixes the BUYER's own plant — for a guest that is the
      // host-side seat-1 board, for the host/solo its own quarry board.
      const n = boardOfSeat(actor.id).smashBlocks();
      if (n && actor.id === players[0].id) sfx.play("crack");   // SFX-01: ice and girders giving way
      toast(n ? `Repair Crew cleared ${n} obstacles.` : "Nothing to repair.", n ? "good" : "info");
      if (n && isMp()) publishNet(now, true);
      return true;
    }
    toast("Not available in this build.", "info");
    return false;
  }

  function buyBlack(key: string) {
    if (phase === "won") {
      toast("The final ledger is closed. Start a rematch to settle another score.", "info");
      return;
    }
    // MP-AUDIT: the Black Market is relayed — a guest's card sends an intent
    // and the host's shared core (`buyBlackFor`) validates, charges and
    // applies it. Protest is the exception (#115): a two-step placement that
    // ARMS locally on the guest and sends the tile as a validated intent.
    if (isGuest()) {
      if (key === "protest") {
        if (pendingProtest) {
          pendingProtest = false;
          toast("Protest cancelled.", "info");
          return;
        }
        // Local affordability is feedback only — the host re-checks against
        // its authoritative purse at placement and its refusal arrives as a
        // notice toast.
        if ((me.purse.gold ?? 0) < SABOTAGE.protest.gold) {
          toast(`Needs ${SABOTAGE.protest.gold} Gold.`, "bad");
          return;
        }
        pendingProtest = true;
        net?.sendIntent("blackMarket", { key: "protest" });
        toast(`Protest ready — click any public road to block ALL trucks for ${fmtProtestLeft(PROTEST_MS)}.`, "info");
        return;
      }
      net?.sendIntent("blackMarket", { key });
      toast(`Requesting ${key}…`, "info");
      return;
    }
    buyBlackFor(me, key);
  }

  // ── economy + AI clocks ────────────────────────────────────────────────
  let lastHarvest = 0, lastAi = 0;
  /** Fractional new-loop income retained per depot until it reaches one. */
  const loopCarry = new Map<number, number>();
  /** A1: Security Forces are on duty until this wall time. */
  let securityUntil = 0;
  /** #111: the guest seat's own Security Forces guard (armed by its hire). */
  let guestSecurityUntil = 0;
  /** A1: when the rival last ran a Black Market raid on the player's plant. */
  let lastRaid = 0;
  /** The sabotage cards `rivalRaid` knows how to aim at the player's plant. */
  const RAID_ACTIONS = new Set(["harden", "block", "fog"]);
  /**
   * PP-07: the fractional remainder of the rival's trickle yield, carried
   * across ticks so sub-1 rates (Oil Rig 0.4/tick, Gold Mine 0.3/tick) still
   * pay out over time instead of rounding to zero forever.
   */
  function economyTick(now: number) {
    // MP-05: a guest runs no economy at all — its cargo, purses and VPs arrive
    // in deltas. Harvest ticks here would credit purses the host overwrites and
    // spawn tokens on a board the guest does not own.
    if (isGuest()) return;
    if (phase !== "play") return;
    if (now - lastHarvest < HARVEST_MS) return;
    lastHarvest = now;
    if (newLoop) {
      // L4 (#218): the rival's depots take their simulated tuning level here,
      // before anything is clocked — an AI turn assigns its own, and this
      // catches everything else (a restored save, a depot built before the
      // redesign). Idempotent: a depot that already has a level is left alone.
      applyRivalTuning();
      // L1b: the host clocks only the local seat. Connectivity is evaluated
      // per depot, so removing a road immediately stops that depot's income.
      const owner = me.id;
      const components = buildAllComponents(eco.track, ownerIdOf(eco, owner));
      const locks = industryLocks(eco);
      for (const depot of eco.harvesters) {
        if (depot.owner !== owner) continue;
        const result = harvesterYield(eco, components, locks, depot, now);
        const cargoes = Object.entries(result.yields) as [Cargo, number][];
        if (!result.serviced || !cargoes.length) continue;
        const factor = BASE_RATE * depotYield(depot) * distanceFactor(depot) * transportFactor(depot);
        const total = cargoes.reduce((sum, [, amount]) => sum + amount, 0) * factor
          + (loopCarry.get(depot.id) ?? 0);
        const whole = Math.floor(total);
        loopCarry.set(depot.id, total - whole);
        if (whole > 0) {
          // A depot normally holds one industry/cargo; use the first cargo for
          // the integer credit and retain any sub-unit remainder per depot.
          earn(me, { [cargoes[0][0]]: whole } as Purse);
        }
      }
      return;
    }
    // AI-03: BOTH seats earn through a Processing Plant board now — yours is
    // the one in the HUD, the rival's is the autoplayed one you can open
    // from its topbar button. The rival-only passive trickle this used to
    // run (J1/W3/PP-07's trickleCarry) is gone: he plays the game like you,
    // tokens gated by his own network, deliveries credited by his own
    // lorries, gold by his own plant combos.
    // What stays here is the network re-read — blockades expire on a clock,
    // and both boards' token gates derive from the reachable set.
    quarry.refresh(now);
    rivalQuarry.refresh(now);
  }

  /** Per frame: board effects, the token spawn, and the market clock. */
  function quarryTick(now: number) {
    // MP-05: on a guest this whole family is host-owned — the boards, the
    // market and the sabotage clocks all live where the sim lives. The guest
    // renders the board panel from its own (inert) grid and changes nothing.
    if (isGuest()) return;
    market.tick(now);
    // A1: ice and girders on the rival's plant expire on their own clock —
    // nobody is there to clear them.
    rivalPlant.tick(now);
    if (phase !== "play") return;
    // MP-05: the rival's market policy is solo-only. In a hosted game seat 1 is
    // a person: the host must not post offers on their behalf.
    // #186: an AI-FILLED seat is the exception — the host is that seat's player,
    // so its offers are posted here exactly as they are in solo.
    if (isSolo() || aiOpponent) rivalMarketOffer(now);
    quarry.tick(now);
    // L4 (#218): a session whose budget is spent and whose board has stopped
    // moving closes ITSELF — the yield lands the moment the last cascade
    // settles, with no modal to dismiss and no way to be stuck holding a
    // finished session.
    if (tuning && tuningOver(tuning) && !quarry.board.busy) closeTuningSession(false);
    // AI-03: the rival's own plant plays: same board clock as yours, then
    // one watchable move per skill().moveMs. trySwap refuses politely when
    // the board is busy or smogged, so the clock can keep cadence calmly.
    rivalQuarry.tick(now);
    // MP: in a hosted game seat 1 is a person who swaps their own board by
    // intent — an autoplaying AI there would be a third player on their board.
    // #186: an AI-FILLED seat has no person on it, so its board plays itself at
    // the same cadence it does in solo (and the guest-side wire carries it).
    if (isSolo() || aiOpponent) rivalAutoplay(now);
  }

  /** AI-03: the rival's match-3 cadence — "a board where he is slowly
   *  matching". One move per moveMs: a single swap at the skill's pace.
   *  TOKEN-SEEKING (AI-03c): pace alone was not the skill — a rival that
   *  matches whatever comes first leaves its tokened gems sitting matched-
   *  less on the board (the stall telemetry: ore hovering at 4-6 while its
   *  own mine's tokens spawned beside it). Every preset seeks the heaviest
   *  match on offer: tokens count for their tier, frozen ones don't exist
   *  here, and easy still reads as a casual player because its clock is
   *  slow and its board is often token-thin.
   *
   *  AI-03d: the seek is only as good as the move list it seeks over, and
   *  `findMove` used to disagree with the board about what a match IS — it
   *  counted a run through any same-coloured neighbour, while `lineRuns`
   *  (what `trySwap` actually clears) breaks a line at a girder or a bomb.
   *  The rival then handed `trySwap` a swap that was reverted, and because a
   *  revert changes nothing, the next tick got the same doomed cells back:
   *  one dead swap replayed every moveMs for the rest of the match, worst on
   *  a plant the player had just bought girders for, and worst of all on a
   *  TOKENED dead swap, which the seek ranked above every real move on the
   *  board. `findMove` now answers with the board's own rule (see board.ts),
   *  so every move it offers here is one `trySwap` carries out. */
  let lastRivalMove = 0;
  function rivalAutoplay(now: number) {
    if (now - lastRivalMove < skill().moveMs) return;
    const mv = rivalBoard.findMove((g) => (g.tier ?? 0));
    if (!mv) { lastRivalMove = now; return; }
    lastRivalMove = now;
    void rivalBoard.trySwap(mv[0], mv[1], mv[2], mv[3], now);
  }

  /**
   * AI-01: the rival POSTS to the market every so often, rather than only
   * answering your offers (the market.tick side) and banking 4:1 (the aiTick
   * side). Its offer is the bank's target spoken out loud — surplus it has
   * above its own plan for a scarce cargo the plan is short of, at a rate
   * (4-for-2) that beats the bank for both parties. It never escrows what the
   * plan still needs, never touches Gold, and the offer tray the player's
   * own posts already use is where it lands — so taking it is one click.
   *
   * The cadence is a skill lever; the easy rival posts less often, and the
   * whole action is deliberately the LEAST important thing the rival does:
   * roads and paves win the race, the market just greases them.
   */
  let lastOfferPost = 0;
  function rivalMarketOffer(now: number) {
    const every = skill().offerEveryMs;
    if (!every) return;
    if (now - lastOfferPost < every) return;
    lastOfferPost = now;
    const f = factoryOf("ai");
    if (!f) return;
    const need = rivalSkintTarget(f, now);
    if (!need) return;
    const idea = chooseRivalOffer(rival.purse, need.goal);
    if (!idea) return;
    const trader = market.players[rival.i];
    if (market.post(trader, idea.give, idea.giveN, idea.want, idea.wantN)) {
      ui.feed(`Rival offers ${idea.giveN} ${CARGO[idea.give].name} → ` +
        `${idea.wantN} ${CARGO[idea.want].name} — take it from the Market tab`, rival.name);
    }
  }

  /**
   * PP-07: the rival resolves missing construction materials the same way
   * the player can — the 4:1 bank. Its only income is the trickle, and NO
   * trickle cargo pays for everything a second Depot costs (Grain + Oil +
   * Wood + Stone from the one table, plus the track leg to reach it):
   * without this the AI deadlocks on its first paid expansion, the exact
   * endless-dependency loop the ticket forbids. Two exchanges per build
   * clock, giving from the cargo it holds most; Gold is never touched
   * (PP-08). The target is the FULL price of the plan it wants — the
   * track leg and the Depot together — so it never trades away a cargo
   * that plan still needs.
   */
  /**
   * VP-01: what the rival believes about the race, right now. Read from the
   * derived scoreboard rather than cached on the turn, because these functions
   * also run from the debug/test hooks and a policy that changes between
   * planning and spending is worse than a slightly stale one.
   */
  const rivalPaceNow = (): RivalPace =>
    rivalPace(vpFor(score, "you"), vpFor(score, "ai"), winTarget());

  /** VP-01: the OTHER milestone the bank can be pointed at — the pavement the
   *  rival can ALMOST afford. Ore comes out of one industry type, so a rival
   *  that never reached a mine has no route to the scoreboard at all, and a
   *  route it cannot fund is not a plan. This lets the 4:1 bank buy INTO the
   *  victory condition instead of only into the next Depot. */
  const paveMilestone = (): Purse | null => {
    // The batch size is a constant and NOT a pace lever, which is the measured
    // lesson recorded on `rivalPace`: a milestone is only a plan if the purse can
    // reach it. 4 tiles is 1★, the same unit as a plant, and the largest step a
    // rival with no Ore can realistically take inside its own income.
    const ranked = paveCandidates(eco, {
      owner: rival.id, ownerId: rival.i + 1, purse: rival.purse,
      maxTiles: PAVE_MILESTONE_TILES,
    });
    if (!ranked.length) return null;
    let ore = 0;
    for (const t of ranked.slice(0, PAVE_MILESTONE_TILES)) ore += tileCost(track, "road", t.x, t.y).ore ?? 0;
    return ore > 0 ? { ore } : null;
  };

  /**
   * VP-01: one bank aimed at the SCOREBOARD rather than at the next Depot.
   *
   * `rivalBankTowardPlan` only runs on an idle turn — and a rival with Wood to
   * burn is never idle: it would rather lay its fortieth gravel tile than buy the
   * Ore that turns thirty of them into points. That is exactly how it stalled a
   * measured race at 6.5★ owning 27 un-paved tiles (seed 2024,
   * `tests/unit/iso-vp-race.test.ts`): busy every turn, pointless every turn.
   * So the rival converts into Ore whenever it has gravel it wants to pave and
   * cannot afford to — and never sells a cargo the Depot plan still needs, so
   * this cannot starve the build step it is competing with.
   */
  /** AI-01: the bank's per-turn exchange budget = the scoreboard's pace plus
   *  the difficulty's appetite, never below one trade. */
  const bankBudget = (pace: RivalPace): number => Math.max(1, pace.bankPerTurn + skill().bankBonus);

  function rivalBankTowardPave(f: Factory, now: number): number {
    const pace = rivalPaceNow();
    const want = paveMilestone();
    if (!want) return 0;
    const price = UPGRADE_COST.ore ?? 4;
    const need = want.ore ?? 0;
    // AI-02: judge the goal by what the PAVE PASS may spend, not the raw
    // purse — `planUpgrades` keeps a Plant's Ore aside whenever a plant is
    // wanted, so a seat holding exactly `need` Ore (less the plant reserve)
    // cannot pave, yet every affordability check said it could. That pairing
    // was the live deadlock the player saw: one depot, one road, paved 2 of
    // 3, and banks that never traded a single unit while Wood piled up at
    // 32/min. (Headless repro: zz-live, 25 minutes of a seed-1337 rival.)
    if (spendableOre() >= need) return 0;                  // it can already pay
    // AI-01: guard the WHOLE depot plan, not just `priceDepot`. The AI-vs-AI
    // race caught the thinner guard feeding the churn this function is part
    // of: it sold the track cargo its own depot plan needed down to the
    // depot's bare price, `rivalBankTowardPlan` bought it back at 4:1 the
    // same turn, and the pair vaporized the purse round-robin instead of
    // ever affording the plan.
    const planGuard = rivalPlanTarget(f, now) ?? {};
    const trader = { res: rival.purse };
    let trades = 0;
    while (spendableOre() < need && trades < bankBudget(pace)) {
      const surplus = (CARGOES as Cargo[])
        .filter((c) => c !== "gold" && c !== "ore" && (rival.purse[c] ?? 0) >= price)
        .filter((c) => (rival.purse[c] ?? 0) - price >= (planGuard[c] ?? 0))
        .sort((a, b) => (rival.purse[b] ?? 0) - (rival.purse[a] ?? 0))[0];
      if (!surplus) return trades;
      if (!bankTrade(trader, surplus, "ore")) return trades;
      trades++;
    }
    return trades;
  }

  /**
   * AI-01: the purse the rival is working toward right now — extracted from
   * `rivalBankTowardPlan` so the bank and the MARKET aim at the same shortage
   * (`rivalMarketOffer` asks for exactly what the next bank exchange would
   * buy). The rule, unchanged: the depot plan closest to affordable (fewest
   * missing units, ties by the planner's score), unless the pave milestone is
   * fewer trades away — the scoreboard outranks the build queue.
   */
  /** AI-01: the depot-plan half of `rivalSkintTarget`, factored out so the
   *  pave bank can guard it (the two banking passes must never sell what
   *  the other is saving for). */
  const rivalPlanTarget = (f: Factory, now: number): Purse | null => {
    // Price with a HYPOTHETICAL deep purse: `planCandidates` drops plans the
    // purse cannot finish, and the plan to bank toward is exactly one of
    // those. AI-01: this goes through `deepPlanCandidates`, which holds the
    // pricey affordability-lifted search against a world fingerprint — a
    // stalled rival re-asks the question every idle tick (~2.5 s), and
    // re-routing an unchanged map was a ~0.2 s hitch each time. Scarcity
    // ranking still reads the REAL stock (order-only, so the cache is safe);
    // only affordability is lifted.
    const cands = deepPlanCandidates(eco, f, {
      stock: rival.purse,
      free: rival.freeTrack, freeDepots: rival.freeDepots, now,
      newLoop,
    });
    const depot = priceDepot(rival.purse, rival.freeDepots).cost;
    let planTarget: Purse | null = null;
    if (cands.length) {
      // Bank toward the plan CLOSEST to affordable — fewest missing units,
      // ties broken by the planner's own score. The top-scored candidate can
      // swing with every trickle of income; "least shortfall" is stable, so
      // the rival works one plan to completion instead of chasing a moving
      // target (and re-rolling its bank trades forever).
      const shortfall = (c: (typeof cands)[number]): number => {
        let missing = 0;
        for (const [k, v] of Object.entries(c.cost)) {
          missing += Math.max(0, v - (rival.purse[k as Cargo] ?? 0));
        }
        for (const [k, v] of Object.entries(depot)) {
          missing += Math.max(0, v - (rival.purse[k as Cargo] ?? 0));
        }
        return missing;
      };
      const chosen = [...cands].sort(
        (a, b) => shortfall(a) - shortfall(b) || b.score - a.score,
      )[0];
      planTarget = {};
      for (const [k, v] of Object.entries(chosen.cost)) planTarget[k as Cargo] = v;
      for (const [k, v] of Object.entries(depot)) planTarget[k as Cargo] = (planTarget[k as Cargo] ?? 0) + v;
    }
    return planTarget;
  };

  /** AI-02: the Ore the pave pass may actually spend — the purse less the
   *  Plant reserve `rivalPavePass` keeps through `planUpgrades`' keepOre.
   *  Shared by the three spots below that, before AI-02, each measured
   *  affordability against the raw purse and, together, deadlocked. */
  const spendableOre = (): number =>
    Math.max(0, (rival.purse.ore ?? 0) - (rivalPlantWanted() ? (PLANT_COST.ore ?? 0) : 0));

  const rivalSkintTarget = (f: Factory, now: number): { goal: Purse; paving: boolean } | null => {
    const planTarget = rivalPlanTarget(f, now);
    const gap = (p: Purse | null, oreAvail: number): number => {
      if (!p) return Infinity;
      let missing = 0;
      for (const [k, v] of Object.entries(p) as [Cargo, number][]) {
        const have = k === "ore" ? oreAvail : (rival.purse[k] ?? 0);
        missing += Math.max(0, v - have);
      }
      return missing;
    };
    const paveTarget = paveMilestone();   // 4 tiles: the smallest step that scores
    // AI-02: the pave goal's "have" is the spendable Ore (plant reserve
    // deducted); the depot plan's banks spend the full purse. Tell the bank
    // WHICH side won — a pave goal must buy Ore past the plant reserve.
    if (paveTarget && gap(paveTarget, spendableOre()) < gap(planTarget, rival.purse.ore ?? 0)) {
      return { goal: paveTarget, paving: true };
    }
    return planTarget ? { goal: planTarget, paving: false } : null;
  };

  const rivalBankTowardPlan = (f: Factory, now: number) => {
    const skint = rivalSkintTarget(f, now);
    if (!skint) return;
    const { goal: target, paving } = skint;
    const trader = { res: rival.purse };
    const budget = bankBudget(rivalPaceNow());
    // AI-02: a bank pointed at the PAVE goal must buy past the plant reserve,
    // or it stops one trade short where the pave pass can still not pay (see
    // `spendableOre`); a bank pointed at the depot plan uses raw numbers.
    const oreNeed = paving
      ? (target.ore ?? 0) + (rivalPlantWanted() ? (PLANT_COST.ore ?? 0) : 0)
      : (target.ore ?? 0);
    let trades = 0;
    for (const [cargo, want] of Object.entries(target) as [Cargo, number][]) {
      if (trades >= budget) break;
      const need = cargo === "ore" ? oreNeed : want;
      while ((rival.purse[cargo] ?? 0) < need && trades < budget) {
        // AI-01: never sell ORE while a pave milestone is on the board — ore
        // is the score, and selling it here while `rivalBankTowardPave` buys
        // it back there is the 4:1 churn the race harness caught.
        const paving = paveMilestone() !== null;
        const surplus = (CARGOES as Cargo[])
          .filter((c) => c !== "gold" && c !== cargo && (rival.purse[c] ?? 0) >= 4)
          .filter((c) => c !== "ore" || !paving)
          .filter((c) => (target[c] ?? 0) <= (rival.purse[c] ?? 0) - 4)
          .sort((a, b) => (rival.purse[b] ?? 0) - (rival.purse[a] ?? 0))[0];
        if (!surplus) break;
        bankTrade(trader, surplus, cargo);
        trades++;
      }
    }
  };

  /**
   * A1: the rival buys back.
   *
   * Sabotage now lands on the rival's plant, which is correct — and which
   * left Repair Crew with nothing to repair and Security Forces with nothing
   * to guard, because nothing could ever dirty YOUR board again. The Black
   * Market is a two-sided shop; the rival raids on its own clock
   * (`RAID_EVERY`), pays the same Gold price, and is turned away by Security
   * Forces. Without this the two defensive purchases are dead weight.
   */
  function rivalRaid(now: number) {
    if (phase !== "play") return;
    // AI-01: the raid cadence is a skill lever; the easy rival never raids
    // (0), the hard one raids on its own shorter clock. RAID_EVERY stays the
    // normal preset's value.
    const every = skill().raidEveryMs;
    if (!every) return;
    if (now - lastRaid < every) return;
    lastRaid = now;
    // VP-01: only the cards this function can actually play. `bandit` is
    // `rivalSabotage`'s business (it targets a district, not the plant) and
    // `security` is a defender's card — and because the hire is paid before the
    // effect, a rival holding exactly 5 Gold used to burn it on a `hit` that did
    // nothing. "Affordable" is not the same question as "playable".
    const keys = (Object.keys(SABOTAGE) as RivalryTactic[]).filter(
      (k) => RAID_ACTIONS.has(k) && (rival.purse.gold ?? 0) >= SABOTAGE[k].gold,
    );
    if (!keys.length) return;                     // no Gold, no raid
    const key = choice(keys);
    const def = SABOTAGE[key];
    spend(rival, { gold: def.gold });             // the hire is paid either way
    if (now < securityUntil) {
      toast(`Security Forces turned the rival's ${def.name} away.`, "info");
      rivalSpeaks("thwarted", key);
      return;
    }
    const hit = (text: string) => {
      const f = factoryOf("you");
      if (f) floats.add(text, f.tx, f.ty, { cls: "sabotage", now });
    };
    if (key === "harden") { quarry.board.harden(); hit("❄ 7 FROZEN"); }
    else if (key === "block") { quarry.board.dropBlocks(4, BLOCK_MS, now); hit("🏗 4 GIRDERS"); }
    else if (key === "fog") { quarry.board.fog(FOG_MS, now); hit("🌫 SMOG"); }
    else return;
    toast(`The rival hit your plant with ${def.name}!`, "bad");
    rivalSpeaks("attack", key);
  }

  /**
   * VP-01: is there a plant the rival could still raise, and does it have the
   * Ore to raise it? The pave pass asks this before it spends: 1★ for
   * 3 Ore beats 0.25★ for 4, so a rival one Ore short of its next plant keeps
   * that Ore instead of paving with it.
   */
  const rivalPlantWanted = (): boolean => {
    if (canAffordPlant(rival.purse)) return false;          // it is buying it this turn
    if (!chooseAiPlantSpot(grid, track, eco, rival.id)) return false;   // nowhere legal
    return true;
  };

  /** The rival paves what it can afford, charges itself, and lets `rescoreNow`
   *  price the points. Returns false when there was nothing to pave. */
  function rivalPavePass(): boolean {
    const plan = planUpgrades(eco, {
      owner: rival.id, ownerId: rival.i + 1, purse: rival.purse,
      // AI-01: the batch cap is a skill lever (8 on normal, 4/12 on easy/hard).
      maxTiles: skill().paveTiles,
      keepOre: rivalPlantWanted() ? (PLANT_COST.ore ?? 0) : 0,
    });
    if (!plan) return false;
    // Charge UP FRONT, exactly as `placePlant` does, and hand back the
    // difference if a tile turned unbuildable between planning and building
    // (the player torn up the gravel under it). That ordering is what makes a
    // failed action cost nothing: `spend` is affordability-guarded, so either
    // every tile is paid for or the purse is untouched.
    if (!spend(rival, plan.cost)) return false;
    const out = executePaves(eco, plan, rival.i + 1);
    if (!out.built.length) {
      earn(rival, plan.cost);              // nothing was built: nothing is owed
      return false;
    }
    // AI-03c: paved tiles are the scoreboard — the feed names the batch.
    ui.feed(`Rival paves ${out.built.length} tile${out.built.length === 1 ? "" : "s"} (+${fmtVp(out.built.length * VICTORY.upgrade)}★)`, rival.name);
    for (const [cargo, v] of Object.entries(plan.cost) as [Cargo, number][]) {
      const owed = v - (out.spent[cargo] ?? 0);
      if (owed > 0) earn(rival, { [cargo]: owed });
    }
    for (const [bx, by] of out.built) renderer?.invalidateTile(bx, by);
    return true;
  }

  /**
   * One rival turn. VP-01 restructured this from "one build, or nothing" into
   * the three actions the new scoreboard actually pays for, most-valuable
   * first, and made the turn idempotent-proof: every action charges itself and
   * nothing is spent on a plan that fails.
   *
   *   1. a PLANT (1★, and it widens delivery reach) — same rule + cost path as
   *      the human's click, so no AI-only adjacency bypass (PP-06);
   *   2. a DEPOT on the best-valued catchment it can afford, priced with the
   *      SAME model the player's drag preview uses (W3) — `freeDepots`
   *      included, so its opening Depot is free and every later one pays for
   *      Oil it has to have earned (PP-05);
   *   3. the PAVE pass — 0.25★ a tile and the ×1.6 multiplier, with the Ore
   *      the first two actions left over.
   *
   * A tick that achieves nothing banks toward the plan it wants (PP-07's
   * escape from the dependency loop) and retries once; if even that fails it
   * shortens its own clock to `AI_IDLE_MS` rather than burning nine seconds of
   * the player's lead.
   */
  /**
   * VP-01: the rival's own Black Market play.
   *
   * `rivalRaid` wrecks the PLAYER's plant with a random affordable action,
   * which is honest but blunt: it spent its whole Gold on Frost Tiles against
   * an opponent it is losing a road race to. Under VP-01 the thing worth
   * stopping is the rival's ORE, and Ore comes out of one industry, so the
   * rival now buys a Blockade on the player's most productive district first —
   * the same auto-targeting rule (TK-008) the player buys, the same Gold price,
   * and the same "one rival, no targeting step" shape.
   *
   * Two guards keep it fair rather than mean: it never spends the last of its
   * Gold (a Depot costs Oil and Oil comes from an economy it still has to
   * build, so a rival that blocks and then cannot expand has traded a point of
   * tempo for none), and it never buys when the player has nothing connected to
   * blockade — no charge for an empty hit.
   */
  function rivalSabotage(now: number) {
    // AI-01: the easy rival leaves your industries alone (`skill().blockades`).
    if (!skill().blockades) return;
    const price = SABOTAGE.bandit.gold;
    // VP-01: `RIVAL_GOLD_RESERVE` exists so a rival that blocks and then cannot
    // expand has not traded a point of tempo for none. When the LEADER is one
    // plant from winning that calculus inverts — a 40-second denial of the
    // leader's Ore is worth more than the reserve — so it spends down to the
    // last coin instead of hoarding it.
    const reserve = rivalPaceNow().deny ? 0 : RIVAL_GOLD_RESERVE;
    if ((rival.purse.gold ?? 0) < price + reserve) return;
    const target = pickBlockadeTarget(eco, "you", now);
    if (!target) return;
    if (!spend(rival, { gold: price })) return;
    target.banditUntil = now + BANDIT_MS;
    const def = INDUSTRY_BY_KEY[target.type];
    floats.add("⛓ BLOCKADED", target.tx, target.ty, { cls: "sabotage", now });
    toast(`The rival blockaded your ${def?.name ?? target.type} — no harvest there for ${BANDIT_MS / 1000}s.`, "bad");
    rivalSpeaks("attack", "bandit");
  }

  function aiTick(now: number) {
    // MP-05: §9 — "the AI rival is disabled in a hosted game; the guest is the
    // rival". Seat 1 is driven by intents from the relay instead.
    // #186: …unless the host filled that seat itself, which is the one hosted
    // game with a machine in it — the AI is simulated ON THE HOST and synced to
    // the guest like any other seat state, so this tick is the whole of "the AI
    // plays" and the guest never runs a line of it.
    if (!isSolo() && !aiOpponent) return;
    if (phase !== "play") return;
    // AI-01: the two clocks come from the live difficulty. The turn that
    // follows is SHARED across presets — easy/hard pace the same policy.
    if (now - lastAi < skill().buildMs) return;
    lastAi = now;
    rivalRaid(now);
    rivalSabotage(now);
    const f = factoryOf("ai");
    if (!f) return;
    const pace = rivalPaceNow();      // VP-01: read once, used by three steps
    // AI-01: losing chases Ore harder or softer depending on the preset.
    const urgency = pace.oreUrgency * skill().urgencyBias;
    let acted = false;

    // 1. plant — the cheapest victory point on the board…
    // AI-01: …but not its REAL cost. 1★ a plant is cheaper than 4 Ore a pave;
    // a plant bought with the purse the next Depot needs is the measured
    // plant-rush stall — the seat paves nothing, banks nothing, and idles at
    // 2-3★ forever (the race harness caught it: mirrors on seeds 42/99
    // ended 2.75★/3.5★ with every turn a plant buy). A plant must now leave
    // the plan the rival is actually working toward intact: when pacing
    // itself, the next Depot plan stays funded (PLANT_COST on top); when
    // paving, the Ore in hand covers its paves — Plant Ore is just also
    // eligible, so one spare Ore and a full purse is a plant.
    let plantNow = false;
    if (canAffordPlant(rival.purse)) {
      const target = rivalSkintTarget(f, now);
      const covers = (want: Purse): boolean =>
        (Object.entries(want) as [Cargo, number][]).every(
          ([k, v]) => ((rival.purse[k] ?? 0) as number) >= v);
      const withPlant = (base: Purse): Purse => {
        const out: Purse = { ...base };
        for (const [k, v] of Object.entries(PLANT_COST) as [Cargo, number][]) {
          out[k] = (out[k] ?? 0) + v;
        }
        return out;
      };
      if (target) {
        // save the plan (depot target in full) or ready Ore for paves; paving
        // needs Ore reserved only up to a plant's worth, so {paves,plant} can
        // share the purse
        const ref: Purse = target.paving
          ? { ore: Math.min(8, (target.goal.ore ?? 0) + 1) }
          : target.goal;
        plantNow = covers(withPlant(ref));
      } else {
        plantNow = true;   // nothing to save for
      }
      if (plantNow) {
        const spot = chooseAiPlantSpot(grid, track, eco, rival.id);
        if (spot && placePlant(spot[0], spot[1], rival)) {
          acted = true;
          // AI-03c: the feed tells the player the rival JUST scored a ★ —
          // an empty feed used to hide every move it made.
          ui.feed(`Rival raises processing plant #${plantsOf(eco, rival.id).length} (+1★)`, rival.name);
          // placePlant rescores immediately. If this was the winning star, the
          // curtain is already up; do not let the rest of the same AI turn add
          // roads after the final ledger was photographed.
          if (winner !== null) return;
        }
      }
    }

    // 2. depot — W3: the same cost model as the player's preview, allowance
    //    first. AI-01: `expandPerTurn` depot plans in ONE turn is what makes a
    //    hard rival visibly SPREAD — each pass re-plans against the purse the
    //    last build left behind, so it can never overdraw.
    const opts = () => ({
      stock: rival.purse, purse: rival.purse,
      free: rival.freeTrack, freeDepots: rival.freeDepots, now,
      oreUrgency: urgency, newLoop,
    });
    const depotBuild = (): boolean => {
      const out = aiBuildStep(eco, f, opts(), allocHarvesterId());
      if (!out) return false;
      rival.freeTrack = Math.max(0, rival.freeTrack - out.free);
      rival.freeDepots = Math.max(0, rival.freeDepots - out.freeDepots);
      spend(rival, out.spent);
      for (const [bx, by] of out.built) renderer?.invalidateTile(bx, by);
      // AI-03c: expansion is the thing the player keeps asking the feed
      // about — say exactly what appeared (depot + its road).
      ui.feed(`Rival expands: a new Depot and ${out.built.length} road tile${out.built.length === 1 ? "" : "s"}`, rival.name);
      return true;
    };
    for (let n = Math.max(1, skill().expandPerTurn); n > 0; n--) {
      if (!depotBuild()) break;
      acted = true;
    }
    // L4 (#218): however many Depots that turn raised, they are all tuned now —
    // the rival's simulated session result, at its difficulty's skill. No
    // board, no session, no waiting: the level is on the record before the
    // economy clock next reads it.
    applyRivalTuning();

    // 3. pave — what the scoreboard pays for, with whatever Ore is spare; and
    //    when the Ore is not spare but the gravel is there, buy it (VP-01)
    if (rivalPavePass()) acted = true;
    else rivalBankTowardPave(f, now);

    // 4. railway (RAIL-05, #182) — the seat's ONE rail action this turn,
    //    committed through the SAME `rail.ts` rules the player's drag commits
    //    through (`executeRailMove` → `buildRail` / `placePlatform` / …). Easy
    //    rivals keep the lever down; the flag down means no railway.
    const railState = railAvailable && skill().rail ? eco.rail ?? null : null;
    const railMove = railState
      ? planRailMove(eco, railState, f, {
        purse: rival.purse, ownerId: rival.i + 1, useRail: true, scope: "line", now,
      })
      : null;
    let railLaid: [number, number][] = [];
    if (railState && railMove && canPay(rival.purse, railMove.cost)) {
      const res = executeRailMove(eco, railState, railMove, rival.id, rival.i + 1);
      if (res) {
        if (res.refund) earn(rival, res.refund);
        else if (Object.keys(res.spent).length) spend(rival, res.spent);
        if (railMove.kind === "track") railLaid = res.tiles;
        acted = true;
        ui.feed(`Rival ${res.label}`, rival.name);
      }
    }

    if (acted) {
      syncWorld();
      // RAIL-05: syncWorld's shadow diff repainted the tiles whose OWN rail
      // byte moved; a track tile's NEIGHBOURS changed shape with it (their
      // rail end-cap becomes a through-run), so the ±1 neighbourhood goes too
      // — the same invalidation the player's `commitRailDrag` does.
      for (const [tx, ty] of railLaid) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const x = tx + dx, y = ty + dy;
          if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
        }
      }
      rescoreNow();
      return;
    }
    // PP-07: nothing affordable at all — bank toward the plan it wants, then
    // take the turn if the trade unlocked it. Retry in one harvest tick, not
    // one build clock.
    rivalBankTowardPlan(f, now);
    const retry = aiBuildStep(eco, f, opts(), allocHarvesterId());
    if (retry) {
      rival.freeTrack = Math.max(0, rival.freeTrack - retry.free);
      rival.freeDepots = Math.max(0, rival.freeDepots - retry.freeDepots);
      spend(rival, retry.spent);
      for (const [bx, by] of retry.built) renderer?.invalidateTile(bx, by);
      // L4 (#218): the retry path raises a Depot too — tune it like any other.
      applyRivalTuning();
      ui.feed(`Rival expands: a new Depot and ${retry.built.length} road tile${retry.built.length === 1 ? "" : "s"}`, rival.name);
    }
    const paved = rivalPavePass();
    if (retry || paved) {
      syncWorld();
      rescoreNow();
      lastAi = now - skill().buildMs + skill().idleMs;    // something happened: soon again
      return;
    }
    lastAi = now - skill().buildMs + skill().idleMs;      // idle: wake up after the next income tick
  }

  // ══════════════════════ MP-05: the networked match ═════════════════════
  // Host authority (§2) with the room as a thin relay: the host browser runs
  // the sim for BOTH seats and publishes what changed; the guest renders what
  // arrives and sends every action as an intent. `src/net/session.ts` owns the
  // wire; this section is the game's half of it.
  //
  // The rule that keeps this small: a guest intent is applied through EXACTLY
  // the functions the host's own click runs (`previewDrag`/`commitDrag`,
  // `placeHarvester`, `placePlant`, `doDemolish`, `placeFactoryFor`) against
  // the GUEST's player record. §4's "the cost rule IS the multiplayer
  // validation" — one code path, so host and guest cannot drift apart.
  //
  // Deliberately out of scope here, so a reader does not mistake it for a bug:
  //   - the Processing Plant board does not travel. §4's delta has no board
  //     field, and the board is an entire second simulation. A guest's plant is
  //     therefore HOST-AUTOPLAYED (`rivalAutoplay`, unchanged): its cargo,
  //     purses and VP are real, its board panel is a spectator view. Board
  //     relay needs its own ticket.
  //   - the market and Black Market are solo-only: offers are client-local
  //     state, so a guest "trading" would trade with a copy of itself.
  //   - sabotage and the rival-difficulty selector are AI features.

  /** Delta publish cadence. Deltas only — a full snapshot is join/resync only
   *  (§1.3), which is why this is a small heartbeat rather than a big one. */
  const PUBLISH_MS = 200;
  let lastPublishAt = -Infinity;

  /** The per-seat figures that ride every delta (the snapshot's player list
   *  plus the opening allowances the HUD previews prices from). */
  const wirePlayers = () => players.map((p) => ({
    id: p.id, vp: vpFor(score, p.id), res: { ...p.purse },
    freeTrack: p.freeTrack, freeDepots: p.freeDepots,
  }));

  /**
   * PP-14b: the Black-Market sabotage on the RIVAL's plant, as it travels the
   * wire. In a hosted game the rival IS the guest's seat, so the guest applies
   * this to its own board (see `applyRivalSabotage`). In solo the field is
   * still built — the same snapshot shape serves both — but nobody reads it.
   */
  const rivalSabotageNow = (): RivalSabotage => rivalPlant.board.sabotageState(performance.now());

  const inSetup = () => phase === "setup-factory" || phase === "setup-harvester";

  /**
   * RAIL-04 (#178): the railway as the wire carries it. Structures, lines and
   * trains ride on EVERY publish — a guest's panel and its trains need them
   * each tick. The layer is the expensive half: one base64 layer is 27 KB,
   * more than a whole 16 KB frame, so a join/resync sends them whole (chunked)
   * and a steady-state delta sends a SPARSE PATCH against `railSent`, the bytes
   * the guest last received. A build bumps the rail revision and therefore the
   * patch; an unchanged raise sends nothing but the trains.
   */
  let lastRailWireRev = -1;
  const railSent = {
    tile: new Uint8Array(rail.rail.tile.length),
    owner: new Uint8Array(rail.rail.owner.length),
  };
  /**
   * #142: "replicate graph changes and routes only by revision; train progress
   * via compact updates and interpolation". The route each train last sent,
   * keyed by id — `railToWire` compares by array identity (a replan is always a
   * new array) and leaves an unchanged leg off the wire, so a steady-state
   * publish is progress (dist, status, dwell) alone. Cleared on every full
   * send, so a join or resync always carries the routes themselves.
   */
  const railRoutesSent = new Map<number, [number, number][]>();
  function railWire(fullLayers = false): Snapshot["rail"] {
    const moved = rail.rail.revision !== lastRailWireRev;
    lastRailWireRev = rail.rail.revision;
    if (fullLayers) railRoutesSent.clear();
    const wire = railToWire(rail, { layers: fullLayers, routeCache: railRoutesSent });
    if (!wire) return undefined;
    if (fullLayers) copyRailLayer(rail, railSent.tile, railSent.owner);
    else if (moved) {
      wire.tiles = railLayerPatch(rail, railSent.tile, railSent.owner);
      copyRailLayer(rail, railSent.tile, railSent.owner);
    }
    return wire;
  }

  /** HOST: the full state (§4 `SnapshotMsg`), built from the live world. */
  function netFullState(): Snapshot | null {
    // MP-AUDIT: full parity snapshot includes market, protests, vehicles, boards, crossPrompt, winner
    const boardsWire = [
      { owner: players[0].id, data: quarry.board.save() },
      { owner: players[1].id, data: rivalQuarry.board.save() },
    ];
    const protestsWire = [...protests.values()].map((p) => ({ x: p.tx, y: p.ty, until: p.until, owner: p.owner }));
    const trucksWire = trucks.trucks.map((t) => ({ ownerId: t.ownerId, depotId: t.depotId, factory: [...t.factory] as [number, number], route: t.route.map((r) => [...r] as [number, number]), segFast: t.segFast ? [...t.segFast] : [], leg: t.leg, t: t.t, reverse: t.reverse, deliveries: t.deliveries }));
    const carsWire = cars.cars.map((c) => ({ name: c.name, carIndex: (c as any).carIndex ?? 1, originTownId: (c as any).originTownId ?? null, destTownId: (c as any).destTownId ?? null, origin: (c as any).origin ? [...(c as any).origin] as [number, number] : null, dest: (c as any).dest ? [...(c as any).dest] as [number, number] : null, route: c.route.map((r) => [...r] as [number, number]), leg: c.leg, t: c.t, state: (c as any).state ?? "driving", waitMs: (c as any).waitMs ?? 0, fadeMs: (c as any).fadeMs ?? 0, fade: (c as any).fade ?? 1, arriveMs: (c as any).arriveMs ?? 0, lastTripKey: (c as any).lastTripKey ?? null }));
    return buildSnapshot({
      seed, track,
      harvesters: eco.harvesters,
      factories: eco.factories,
      setupPhase: inSetup(),
      won: phase === "won",
      players: wirePlayers(),
      t: performance.now(),
      rivalSabotage: rivalSabotageNow(),
      market: { offers: market.ctx.offers.map((o) => ({ id: o.id, from: o.from, give: o.give, giveN: o.giveN, want: o.want, wantN: o.wantN, born: o.born })), offerSeq: market.ctx.offerSeq },
      protests: protestsWire,
      trucks: trucksWire,
      cars: carsWire,
      rail: railWire(true),
      boards: boardsWire,
      crossPrompt,
      winner: winner ? { id: winner.id, source: winningSource } : null,
      clearedFields: [...clearedFields],
    });
  }

  /**
   * #117: which board content each of the last delta's carries, per seat.
   * `Board.save()` embeds remaining sabotage ms, so it differs every call
   * even when nothing happened — the key projects the parts that ARE the
   * board (grid, pool, combo bank, mint counter) plus the two sabotage
   * PRESENCE flags (smog/girders arriving or lifting is a real change; the
   * countdown between is not, and the receiving board's own clocks handle
   * it). An unchanged board is OMITTED from the delta: re-sending it would
   * restore fresh gem ids on the guest and read as a whole-board rebuild.
   */
  let boardSyncKeys: [string, string] | null = null;
  const boardSyncKey = (b: typeof quarry.board): string => {
    const s = b.save() as {
      grid: unknown; pool: unknown; comboCount: unknown; seq: unknown;
      fogIn: number; blockIn: number;
    };
    return JSON.stringify([s.grid, s.pool, s.comboCount, s.seq, s.fogIn > 0, s.blockIn > 0]);
  };

  /**
   * HOST: publish one tick. Throttled because a game mutates many times a
   * second (lorry arrivals, board matches, purses) and every one of them is
   * already visible in the next heartbeat; `force` is for actions the guest
   * is waiting on (its own intent), where the round trip IS the feedback.
   */
  function publishNet(now = performance.now(), force = false): void {
    if (!net || !net.isHost) return;
    if (!force && now - lastPublishAt < PUBLISH_MS) return;
    lastPublishAt = now;
    // #164: the room calls a match "live" on the first state publish; this is
    // the client's mirror of that flag, so the departure doors know whether
    // there is a rated match to claim.
    mpMatchLive = true;
    // #117: only boards whose content changed since the last publish ride
    // this delta. Join/resync snapshots (`netFullState`) always carry both.
    const keys: [string, string] = [boardSyncKey(quarry.board), boardSyncKey(rivalQuarry.board)];
    const boardsWire = [];
    if (!boardSyncKeys || boardSyncKeys[0] !== keys[0]) {
      boardsWire.push({ owner: players[0].id, data: quarry.board.save() });
    }
    if (!boardSyncKeys || boardSyncKeys[1] !== keys[1]) {
      boardsWire.push({ owner: players[1].id, data: rivalQuarry.board.save() });
    }
    boardSyncKeys = keys;
    const protestsWire = [...protests.values()].map((p) => ({ x: p.tx, y: p.ty, until: p.until, owner: p.owner }));
    const trucksWire = trucks.trucks.map((t) => ({ ownerId: t.ownerId, depotId: t.depotId, factory: [...t.factory] as [number, number], route: t.route.map((r) => [...r] as [number, number]), segFast: t.segFast ? [...t.segFast] : [], leg: t.leg, t: t.t, reverse: t.reverse, deliveries: t.deliveries }));
    const carsWire = cars.cars.map((c) => ({ name: c.name, carIndex: (c as any).carIndex ?? 1, originTownId: (c as any).originTownId ?? null, destTownId: (c as any).destTownId ?? null, origin: (c as any).origin ? [...(c as any).origin] as [number, number] : null, dest: (c as any).dest ? [...(c as any).dest] as [number, number] : null, route: c.route.map((r) => [...r] as [number, number]), leg: c.leg, t: c.t, state: (c as any).state ?? "driving", waitMs: (c as any).waitMs ?? 0, fadeMs: (c as any).fadeMs ?? 0, fade: (c as any).fade ?? 1, arriveMs: (c as any).arriveMs ?? 0, lastTripKey: (c as any).lastTripKey ?? null }));
    net.publishTrack(track, dirtyTiles, {
      t: now,
      harvesters: eco.harvesters.map((h) => ({ ...h })),
      factories: eco.factories.map((f) => ({ ...f })),
      players: wirePlayers(),
      setupPhase: inSetup(),
      won: phase === "won",
      rivalSabotage: rivalSabotageNow(),
      market: { offers: market.ctx.offers.map((o) => ({ id: o.id, from: o.from, give: o.give, giveN: o.giveN, want: o.want, wantN: o.wantN, born: o.born })), offerSeq: market.ctx.offerSeq },
      protests: protestsWire,
      trucks: trucksWire,
      cars: carsWire,
      rail: railWire(),
      clearedFields: [...clearedFields],
      // #117: the field is omitted entirely when neither board changed —
      // `buildPublish` keeps optional fields off the wire when undefined.
      ...(boardsWire.length ? { boards: boardsWire } : {}),
      crossPrompt,
      winner: winner ? { id: winner.id, source: winningSource } : null,
    } as any);
  }

  /** One opening line per guest boot; the phase itself is re-derived on every
   *  applied state, because the other seat's structures arrive at their own
   *  pace. */
  let guestOpened = false;

  /**
   * GUEST: the opening phases are per-seat and derived from APPLIED state —
   * "do I have a Factory?", "do I have a Depot?" — rather than from the wire's
   * single `setupPhase`. Both seats set up at the same time in a hosted game,
   * so one shared flag could not say whether THIS seat is done.
   */
  function refreshGuestPhase() {
    if (!isGuest() || phase === "won") return;
    if (!factoryOf(me.id)) phase = "setup-factory";
    else if (!eco.harvesters.some((h) => h.owner === me.id)) phase = "setup-harvester";
    else if (phase !== "play") {
      phase = "play";
      lastHarvest = performance.now();
      lastAi = performance.now();
      if (!guestOpened) {
        guestOpened = true;
        toast("Both seats are open — connect your depot to your Factory.", "info");
      }
    }
  }
  /**
   * GUEST: stamp the host's Black-Market sabotage onto the local plant board.
   * The board is a spectator view, so only the sabotage overlay is applied —
   * the gem layout itself is deliberately not synced.
   */
  function applyRivalSabotage(sab: RivalSabotage) {
    quarry.board.applySabotage(sab);
  }

  /**
   * #114: write an authoritative balance INTO a seat's existing purse object.
   * `players[i].purse = toBag(...)` (the old code) minted a fresh object and
   * left every earlier capture pointing at the stale one — the market's
   * `players[i].res`, the HUD's trade panel and the affordability buttons all
   * kept showing (and pricing from) the opening balance long after the host
   * had moved the real one. The purse object is created ONCE per seat and
   * shared by reference with `createIsoMarket`, so updates go through it.
   */
  function applyPurseWire(p: PlayerState, res: Partial<Record<Cargo, number>>) {
    Object.assign(p.purse, toBag(res));
  }

  /**
   * #137: write ONE mirrored wire player record into its local seat — the
   * purse (through `applyPurseWire`, so #114's identity still holds) AND both
   * setup allowances.
   *
   * The delta path has done this since MP-05; the full-state path applied the
   * purse alone, so a guest that joined or resynced a PROGRESSED match kept the
   * allowances it booted with — it went on advertising a free Depot and 12 free
   * dirt tiles the host had already spent, and priced every drag preview and
   * the HUD's Depot line from them, until some later delta happened to carry
   * the truth. On a stalled connection that delta never arrives. Both paths now
   * read the same helper, which is the only way "a snapshot and a delta restore
   * identical economy state" stays true instead of being a coincidence.
   *
   * `typeof … === "number"`, never truthiness: an EXHAUSTED allowance is 0, and
   * 0 is a VALUE the guest must take, not a missing field to skip. A field that
   * is genuinely absent (a producer with nothing to restore) leaves the seat
   * alone. Affordability and spending stay host-authoritative — this mirrors
   * the host's numbers, it never re-derives them.
   */
  function applyPlayerWire(p: PlayerState, wire: WirePlayer) {
    applyPurseWire(p, wire.res);
    const ft = wire.freeTrack, fd = wire.freeDepots;
    if (typeof ft === "number" && Number.isFinite(ft)) p.freeTrack = ft;
    if (typeof fd === "number" && Number.isFinite(fd)) p.freeDepots = fd;
  }

  /** GUEST: apply a full state (join or resync). Validated first — a version or
   *  seed mismatch must refuse loudly rather than paint a foreign map. */
  function applyNetSnapshot(raw: Snapshot, _seq: number) {
    let applied;
    try {
      applied = applySnapshot(raw, seed);
    } catch (err) {
      net?.halt(err instanceof Error ? err.message : "Rejected the host's state.");
      return;
    }
    track.dirt.set(applied.track.dirt);
    track.road.set(applied.track.road);
    track.owner.set(applied.track.owner);
    track.upgraded.set(applied.track.upgraded);
    eco.harvesters.length = 0;
    setClearedFields(applied.clearedFields);
    eco.harvesters.push(...applied.harvesters.map((h) => ({ ...h, facing: depotFacingOf(grid, h) })));
    eco.factories.length = 0;
    eco.factories.push(...applied.factories.map((f) => ({ ...f })));
    for (let i = 0; i < players.length; i++) {
      const wire = applied.players[i];
      if (!wire) continue;
      // #137: the purse AND both setup allowances — the same seat record a
      // delta writes, through the same helper, zero allowance included.
      applyPlayerWire(players[i], wire);
    }
    if (applied.rivalSabotage) applyRivalSabotage(applied.rivalSabotage);
    // MP-AUDIT: market parity
    if (applied.market) {
      market.ctx.offers.length = 0;
      (market.ctx.offers as any).push(...applied.market.offers.map((o) => ({ ...o })) as any);
      (market.ctx as any).offerSeq = applied.market.offerSeq;
    }
    // protests
    if (applied.protests) {
      protests.clear();
      for (const pw of applied.protests) {
        protests.set(tIdx(pw.x, pw.y), { tx: pw.x, ty: pw.y, until: pw.until, owner: pw.owner });
      }
    }
    // vehicles
    if (applied.trucks) {
      (trucks as any).trucks = applied.trucks.map((t) => ({ ...t, depot: truckLot(t.depotId), factory: [...t.factory] as [number, number], route: t.route.map((r) => [...r] as [number, number]), segFast: t.segFast ? [...t.segFast] : [] }));
    }
    if (applied.cars) {
      (cars as any).cars = applied.cars.map((c: any) => ({ ...c, origin: c.origin ? [...c.origin] as [number, number] : null, dest: c.dest ? [...c.dest] as [number, number] : null, route: c.route.map((r: any) => [...r] as [number, number]) }));
    }
    // RAIL-04 (#178): the railway. A full state ALWAYS says what the host's
    // railway is — an absent field means "none", never "unchanged" (that
    // reading belongs to a delta), so a stale local railway is cleared.
    if (applied.rail) applyRailWire(rail, applied.rail);
    else clearRail(rail);
    if (applied.cars || applied.rail) {
      // Ensure guest renders vehicles
      world.vehicles = (carItems(cars as any) as any)
        .concat(truckItems(trucks as any, atlasRef ?? undefined))
        .concat(trainItems(rail, atlasRef ?? undefined));
    }
    // boards — already in this guest's seat frame. `mirrorSnapshot` renamed the
    // host's "ai" (this guest's seat) to "you" on the way in, so the wire owner
    // IS the local owner. Swapping again here showed the guest the HOST's board.
    if (applied.boards) {
      const byOwner = new Map(applied.boards.map((b) => [b.owner, b.data]));
      const myData = byOwner.get(players[0].id);
      const rivalData = byOwner.get(players[1].id);
      if (myData) {
        try { quarry.board.restore(myData); } catch {}
        onBoardChange();
      }
      if (rivalData) {
        try { rivalQuarry.board.restore(rivalData); } catch {}
      }
    }
    // cross prompt (#112: a null prompt — resolved, expired or cleared — must
    // take the guest's chooser down, not just silently keep it)
    if (applied.crossPrompt) {
      // Already mirrored: a prompt for THIS guest's board arrives as "you".
      const ownerIsGuest = applied.crossPrompt.boardOwner === players[0].id;
      if (isGuest() && ownerIsGuest) {
        __showGuestCross(applied.crossPrompt as any);
      } else if (!isGuest() && !ownerIsGuest) {
        // Should not happen: host already handled its own prompt
      }
      crossPrompt = applied.crossPrompt as any;
    } else {
      crossPrompt = null;
      if (isGuest()) __clearGuestCross();
    }
    // winner
    if (applied.winner && applied.winner.id) {
      const w = players.find((p) => p.id === applied.winner!.id);
      if (w) { winner = w; winningSource = applied.winner.source as any; phase = "won"; presentEnding(winningSource); }
    } else if (applied.won && !winner) {
      // Fallback: derive winner from VP if wire says won but no id
      for (const p of players) if (hasWon(score, p.id, winTarget())) { winner = p; phase = "won"; presentEnding(null); break; }
    } else {
      // If host says not won, clear winner if we had one spuriously
      if (!applied.won) { winner = null; }
    }
    refreshGuestPhase();
    syncWorld();
    rescoreNow();
  }

  /** GUEST: apply one steady-state delta — the hot path (§5). */
  function applyNetDelta(msg: DeltaMsg) {
    let worldDirty = false;
    if (msg.tiles) { applyTrackDelta(track, msg.tiles); worldDirty = true; }
    if (Array.isArray(msg.clearedFields) && msg.clearedFields.length !== clearedFields.size) {
      setClearedFields(msg.clearedFields.filter((id) => Number.isInteger(id) && id >= 0));
      worldDirty = true;
    }
    if (msg.harvesters) {
      eco.harvesters.length = 0;
      eco.harvesters.push(...msg.harvesters.map((h) => ({ ...h, facing: depotFacingOf(grid, h) })));
      worldDirty = true;
    }
    if (msg.factories) {
      eco.factories.length = 0;
      eco.factories.push(...msg.factories.map((f) => ({ ...f })));
      worldDirty = true;
    }
    if (msg.players) {
      for (let i = 0; i < players.length; i++) {
        const wire = msg.players[i];
        if (!wire) continue;
        // MP-05: the opening allowances ride the delta because the previews
        // price from them — a guest that thought it still had 12 free tiles
        // would preview a drag the host then charges for. #137: they ride the
        // FULL state through this same helper too, so the two paths cannot
        // restore different economy state for one seat.
        applyPlayerWire(players[i], wire);
      }
    }
    // PP-14b: the host's sabotage on this seat's plant, applied as an overlay.
    if ((msg as any).rivalSabotage) applyRivalSabotage((msg as any).rivalSabotage);
    // MP-AUDIT: market
    if ((msg as any).market) {
      const m = (msg as any).market;
      market.ctx.offers.length = 0;
      market.ctx.offers.push(...m.offers.map((o: any) => ({ ...o })));
      (market.ctx as any).offerSeq = m.offerSeq;
    }
    if ((msg as any).protests) {
      protests.clear();
      for (const pw of (msg as any).protests) {
        protests.set(tIdx(pw.x, pw.y), { tx: pw.x, ty: pw.y, until: pw.until, owner: pw.owner });
      }
      worldDirty = true;
    }
    if ((msg as any).trucks) {
      (trucks as any).trucks = (msg as any).trucks.map((t: any) => ({ ...t, depot: truckLot(t.depotId), factory: [...t.factory] as [number, number], route: t.route.map((r: any) => [...r] as [number, number]), segFast: t.segFast ? [...t.segFast] : [] }));
      worldDirty = true;
    }
    if ((msg as any).cars) {
      (cars as any).cars = (msg as any).cars.map((c: any) => ({ ...c, origin: c.origin ? [...c.origin] as [number, number] : null, dest: c.dest ? [...c.dest] as [number, number] : null, route: c.route.map((r: any) => [...r] as [number, number]) }));
      world.vehicles = (carItems(cars as any) as any)
        .concat(truckItems(trucks as any, atlasRef ?? undefined))
        .concat(trainItems(rail, atlasRef ?? undefined));
    }
    // RAIL-04 (#178): a delta's rail field is present on every publish from a
    // host that HAS a railway; absent means "unchanged", so nothing is cleared
    // here (only a full state decides that).
    if ((msg as any).rail && applyRailWire(rail, (msg as any).rail)) {
      world.vehicles = (carItems(cars as any) as any)
        .concat(truckItems(trucks as any, atlasRef ?? undefined))
        .concat(trainItems(rail, atlasRef ?? undefined));
      worldDirty = true;
    }
    if ((msg as any).boards) {
      const byOwner = new Map((msg as any).boards.map((b: any) => [b.owner, b.data]));
      // Already mirrored by `mirrorDelta`: "you" is this guest's own board.
      const myData = byOwner.get(players[0].id);
      const rivalData = byOwner.get(players[1].id);
      if (myData) { try { quarry.board.restore(myData); } catch {} onBoardChange(); }
      if (rivalData) { try { rivalQuarry.board.restore(rivalData); } catch {} }
    }
    if ((msg as any).crossPrompt !== undefined) {
      const cp = (msg as any).crossPrompt;
      crossPrompt = cp ?? null;
      if (isGuest()) {
        if (cp) {
          // Already mirrored: a prompt for THIS guest's board arrives as "you".
          const ownerIsGuest = cp.boardOwner === players[0].id;
          if (ownerIsGuest) __showGuestCross(cp);
          else __clearGuestCross();   // the open chooser was for a prompt the host replaced
        } else {
          // #112: the host resolved/expired the prompt — `mirrorDelta` now
          // preserves the explicit null, so the chooser comes down.
          __clearGuestCross();
        }
      }
    }
    if ((msg as any).winner !== undefined) {
      const w = (msg as any).winner;
      if (w && w.id) {
        const found = players.find((p) => p.id === w.id);
        if (found) { winner = found; winningSource = w.source as any; phase = "won"; presentEnding(winningSource); }
      } else if (!w || !w.id) {
        // host cleared winner (should not happen)
      }
    }
    // A refused intent says why, in the host's own words (the echo).
    if (msg.notice) toast(msg.notice, "info");
    refreshGuestPhase();
    if (worldDirty) syncWorld();
    rescoreNow();
  }

  /** HOST: a guest intent, applied against the guest's seat. Malformed input is
   *  ignored outright — the relay is a router, so the game's own rules are the
   *  only validation, and they must never see a shape they cannot read. */
  function applyGuestIntent(msg: IntentMsg) {
    const p = players[1];
    const payload = msg.payload as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") return;
    const int = (v: unknown): number | null =>
      typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MAP_W ? v : null;
    const echoed: string[] = [];
    intentEcho = echoed;
    // NOTE: nothing in this block may `return`. The notice echo and the forced
    // publish below are the guest's ONLY feedback — its click changed nothing
    // locally — so a refusal has to reach them as surely as an action does.
    try {
      const what = payload.do;
      if (what === "track") {
        const ax = int(payload.ax), ay = int(payload.ay);
        const bx = int(payload.bx), by = int(payload.by);
        if (ax !== null && ay !== null && bx !== null && by !== null) {
          const kind: TrackKind = payload.kind === "road" ? "road" : "dirt";
          const pv = previewDrag(grid, track, kind, p.purse, ax, ay, bx, by,
            payload.xFirst !== false, undefined, p.freeTrack,
            structureTiles(eco.factories, eco.harvesters, p.i + 1), newLoop);
          if (pv.tiles.length === 0) toast("Can't build there.", "bad");
          else commitTrackDrag(p, pv, kind);
        }
      } else if (!railAvailable && (what === "rail" || what === "platform" || what === "raildepot" || what === "railact")) {
        // RAIL-05 (#182): with the flag down the railway does not exist on this
        // host, so a guest's rail request is refused whole — never half-built.
        echoed.push("Rail is not available in this mode.");
      } else if (what === "rail") {
        // RAIL-04 (#178): a guest's rail drag. The host runs the SAME preview
        // and the SAME commit against the guest's seat, so the tiles the guest
        // saw priced are the tiles that get built and charged.
        const ax = int(payload.ax), ay = int(payload.ay);
        const bx = int(payload.bx), by = int(payload.by);
        if (ax !== null && ay !== null && bx !== null && by !== null) {
          const pv = railPreview(grid, track, rail, p.i + 1, p.purse, ax, ay, bx, by,
            payload.xFirst !== false);
          if (pv.tiles.length === 0) {
            echoed.push(pv.why && pv.why !== "ok" ? RAIL_REFUSAL_TEXT[pv.why] : "Can't build rail there.");
          } else commitRailDrag(p, pv);
        }
      } else if (what === "platform" || what === "raildepot") {
        const tx = int(payload.tx), ty = int(payload.ty);
        const view = (RAIL_VIEWS as readonly string[]).includes(String(payload.view))
          ? payload.view as RailView : "se";
        if (tx !== null && ty !== null) {
          const why = what === "platform"
            ? platformRefusal(grid, rail.structures, railPlants(), p.i + 1, tx, ty, view)
            : depotRefusal(grid, rail, p.i + 1, tx, ty, view);
          if (why !== "ok") echoed.push(RAIL_REFUSAL_TEXT[why]);
          else if (what === "platform") placeRailPlatform(tx, ty, p);
          else placeRailDepot(tx, ty, p);
        }
      } else if (what === "railact") {
        // The panel's verbs. Malformed bodies are ignored, exactly like
        // every other intent: the rules below are the only validation.
        const id = typeof payload.id === "number" && Number.isInteger(payload.id) ? payload.id : null;
        const source = typeof payload.source === "number" && Number.isInteger(payload.source) ? payload.source : null;
        const dest = typeof payload.dest === "number" && Number.isInteger(payload.dest) ? payload.dest : null;
        const depot = typeof payload.depot === "number" && Number.isInteger(payload.depot) ? payload.depot : null;
        const lineId = typeof payload.line === "number" && Number.isInteger(payload.line) ? payload.line : null;
        if (payload.what === "assign" && source !== null && dest !== null) railAssign(source, dest, p);
        else if (payload.what === "recall" && id !== null) railRecall(id, p);
        else if (payload.what === "sell" && id !== null) railSell(id, p);
        else if (payload.what === "buy" && depot !== null && lineId !== null) railBuy(depot, lineId, p);
        else if (payload.what === "start" && id !== null) railStart(id, p);
        else if (payload.what === "rename" && id !== null && typeof payload.name === "string") railRename(id, payload.name, p);
      } else if (what === "swap") {
        const r1 = int(payload.r1), c1 = int(payload.c1);
        const r2 = int(payload.r2), c2 = int(payload.c2);
        if (r1 !== null && c1 !== null && r2 !== null && c2 !== null) {
          void rivalQuarry.board.trySwap(r1, c1, r2, c2, performance.now());
        }
      } else if (what === "cross") {
        // #112: ONE typed cross intent — `{ do: "cross", seq, choices }` —
        // the exact shape the guest's chooser sends. The host validates the
        // sequence, the exact pick count and the resource keys before the
        // cascade's resolution callback ever runs:
        //   • a duplicate/late seq resolves nothing (the prompt is gone — the
        //     award already happened exactly once);
        //   • a malformed body never resolves a half-award — the prompt is
        //     dropped with the same empty fallback the timeout uses, so the
        //     cascade cannot stall waiting for a reply that will never come.
        const seq = typeof payload.seq === "number" && Number.isInteger(payload.seq) ? payload.seq : -1;
        const validKeys = new Set<string>(RES_KEYS);
        const choices: ResKey[] | null =
          Array.isArray(payload.choices) &&
          (payload.choices as unknown[]).every((c) => typeof c === "string" && validKeys.has(c))
            ? (payload.choices as ResKey[])
            : null;
        const pending = pendingCross;
        const prompt = crossPrompt;
        if (pending && prompt && seq === prompt.seq && choices && choices.length === pending.picks) {
          const resolve = pending.resolve;
          pendingCross = null; crossPrompt = null;
          clearCrossTimer();
          resolve(choices);
        } else if (pending && prompt && seq === prompt.seq) {
          expireCrossPrompt();
          toast("Cross choice rejected.", "info");
        } else {
          toast("Cross choice expired.", "info");
        }
      } else if (what === "reset") {
        // #116: a guest's Processing Plant Reset is an intent against its OWN
        // (host-authoritative) board. The host enforces the per-seat cooldown,
        // so replaying or forging requests cannot bypass it, and the fresh
        // board reaches both views through the ordinary board sync. Explicit
        // rule for busy states: a reset never interrupts a live cascade and
        // never cancels a pending bounty prompt — refuse, don't queue.
        const now = performance.now();
        if (now - guestResetAt < RESET_COOLDOWN_MS) {
          const left = Math.ceil((RESET_COOLDOWN_MS - (now - guestResetAt)) / 1000);
          toast(`Processing Plant reset is cooling down — ${left}s to go.`, "info");
        } else if (pendingCross && pendingCross.boardOwner === players[1].id) {
          toast("Answer the bounty prompt first — the plant can't reset under it.", "info");
        } else if (rivalQuarry.board.busy) {
          toast("The plant is mid-cascade — try the reset again in a moment.", "info");
        } else {
          guestResetAt = now;
          rivalQuarry.board.resetNeutral();
          toast("Processing Plant collapsed. Fresh neutral board.", "info");
        }
      } else if (what === "post" || what === "cancel" || what === "accept" || what === "bank") {
        // market intents (guest's p is index 1)
        const trader = market.players[p.i];
        const mwhat = payload.do as string;
        if (mwhat === "post") {
          const give = String(payload.give) as any, want = String(payload.want) as any;
          const giveN = Number(payload.giveN) || 0, wantN = Number(payload.wantN) || 0;
          if (!(market.post as any)(trader, give, giveN, want, wantN)) toast("Market post rejected.", "bad");
        } else if (mwhat === "cancel") {
          const id = Number(payload.id);
          if (!(market.cancel as any)(trader, id)) toast("Market cancel rejected.", "bad");
        } else if (mwhat === "accept") {
          const id = Number(payload.id);
          if (!(market.accept as any)(trader, id)) toast("Market accept rejected.", "bad");
        } else if (mwhat === "bank") {
          const give = String(payload.give) as any, want = String(payload.want) as any;
          if (!(market.bank as any)(trader, give, want)) toast("Bank trade rejected.", "bad");
        }
      } else if (typeof payload.key === "string" || typeof (payload as any).do === "string" && ((payload as any).do === "protest_place" || (payload as any).key)) {
        // blackMarket intents — payload.key or protest_place
        const key = (payload as any).key as string;
        const tx = int(payload.tx), ty = int(payload.ty);
        if (key === "protest_place" && tx !== null && ty !== null) {
          // #115: the guest armed its own targeting and clicked a road — the
          // HOST is authoritative for affordability, road eligibility,
          // occupancy and the charge; the guest paid nothing locally.
          const price = SABOTAGE.protest.gold;
          if ((p.purse.gold ?? 0) < price) {
            toast("Needs Gold for protest.", "bad");
          } else if (!isPublicRoad(track, tx, ty)) {
            toast("Protests go on public roads.", "bad");
          } else if (protests.has(tIdx(tx, ty))) {
            toast("Protest already there.", "bad");
          } else {
            spend(p, { gold: price });
            protests.set(tIdx(tx, ty), { tx, ty, until: performance.now() + PROTEST_MS, owner: p.id });
            floats.add("✊ PROTEST", tx, ty, { cls: "sabotage", now: performance.now() });
            toast("Protest placed.", "good");
          }
        } else if (key === "protest") {
          // #115: the guest arms its own targeting; this arm intent is only
          // an ack. The placement — and the charge — arrives as a validated
          // `protest_place` intent above.
          net?.setNotice("Protest armed — click a public road to place it.");
        } else if (typeof key === "string") {
          // #111: the SAME Black-Market core a host/solo click runs — one
          // path for spending, eligibility, feedback and effects, so a guest
          // purchase cannot drift from a host purchase. The core targets the
          // seat OPPOSITE the attacker: a guest's Frost Tiles freeze the
          // HOST's plant, never the guest's own.
          buyBlackFor(p, key);
        }
      } else {
        const tx = int(payload.tx), ty = int(payload.ty);
        if (tx !== null && ty !== null) {
          if (what === "factory") placeFactoryFor(p, tx, ty);
          else if (what === "depot") placeHarvester(tx, ty, p);
          else if (what === "plant") placePlant(tx, ty, p);
          else if (what === "demolish") doDemolish(tx, ty, p);
          else if (what === "protest_place") {
            // legacy
            const price = SABOTAGE.protest.gold;
            if ((p.purse.gold ?? 0) >= price && isPublicRoad(track, tx, ty) && !protests.has(tIdx(tx, ty))) {
              spend(p, { gold: price });
              protests.set(tIdx(tx, ty), { tx, ty, until: performance.now() + PROTEST_MS, owner: p.id });
            }
          } else toast("That action is not available in multiplayer yet.", "info");
        } else if (what) {
          // market intents that arrived as build type fallback
          toast("That action is not available in multiplayer yet.", "info");
        }
      }
    } finally {
      intentEcho = null;
    }
    if (echoed.length) net?.setNotice(echoed[echoed.length - 1]);
    publishNet(performance.now(), true);
  }

  if (net) {
    // RANK-01 (#147): a rated match. Built BEFORE attach so the very first
    // greeting/board/result the session delivers already has somewhere to go.
    // `opts.ranked` comes from the start screen and is true for quick match
    // only; a store is required, so a caller that forgot one gets an unranked
    // match rather than a half-rated one.
    if (opts.ranked && opts.rank) {
      rankRuntime = new RankRuntime({
        session: net,
        store: opts.rank,
        board: net.board,
        onVerdict: onRankVerdict,
      });
      // Publish the rating the moment the file is loaded: the room's board is
      // what BOTH seats rate the match from, so the earlier it is complete,
      // the fewer matches are rated against an unknown opponent.
      void rankRuntime.start();
    }
    net.attach({
      info: (info) => {
        // The room's seed is the map. A mismatch means this client grew the
        // wrong island (§11: refuse, never paint a foreign map).
        if ((info.seed >>> 0) !== (seed >>> 0)) {
          net.halt("This room is playing a different map — rejoin to play together.");
          return;
        }
        // Names come from the room: "Rival" is a person now.
        for (const entry of info.roster) {
          // #164: capture the opponent's ROOM id while the roster is whole —
          // a late claim (after the seat emptied and the session pruned the
          // roster) has no other source for the id the room will accept.
          if (entry.id !== net.playerId && entry.id) mpOpponentWireId = entry.id;
          // Wire seat 0 = the host's seat, wire seat 1 = the guest's; the local
          // frame keeps the opener at players[0] (see `mirrorSnapshot`).
          const local = info.role === "host"
            ? (entry.slot === 0 ? players[0] : players[1])
            : (entry.slot === 0 ? players[1] : players[0]);
          if (entry.username) local.name = entry.username;
          // #114: the trade UI (offer tray "Take …'s offer", the scoreboard)
          // reads names from the market's own player list — keep the two
          // rosters in step whenever the room tells us who anyone is.
          market.players[local.i].name = local.name;
        }
        if (info.role !== roleHint) {
          toast(info.role === "host"
            ? "You are hosting this match."
            : "You joined as the guest.", "info");
        }
        if (info.role === "host") publishNet(performance.now(), true);
      },
      ratings: (board) => rankRuntime?.applyBoard(board),
      // RANK-01: the room's verdict on this match. Both seats get it; the
      // rating arithmetic is fed from here and nowhere else.
      result: (msg) => { void rankRuntime?.handleResult(msg); },
      // #164: the guest's mirror of `matchLive` — the first state it receives
      // is the moment this becomes a rated match, so the departure doors know
      // whether there is a win to claim.
      fullState: () => { mpMatchLive = true; return netFullState(); },
      intent: (msg) => applyGuestIntent(msg),
      snapshot: (snap, seq) => { mpMatchLive = true; applyNetSnapshot(snap, seq); },
      delta: (msg) => { mpMatchLive = true; applyNetDelta(msg); },
      reject: (reason) => {
        mpPeerAwayUntil = 0;
        // #164: a reject is fatal — the session halts on it — and it must
        // never be a bare sentence, let alone the blank dark panel an empty
        // reason used to paint. The sheet carries the reason and the one
        // door that is left. A live rated match is filed by the room itself
        // (the leaver's loss), so the verdict fills the sheet when it lands
        // and the Leave door waits for it instead of stranding the rating.
        // A decided match (ledger up) or a sheet already standing owns this
        // moment — the host quitting after a win broadcasts a fatal reject
        // to a loser who has nothing left to decide, so say nothing then.
        if (endingShown || leftSheet) return;
        toast(reason, "bad");
        const hostGone = reason === HOST_LEFT_REASON;
        openLeftSheet({
          title: hostGone ? "Opponent left" : "Match ended",
          body: hostGone && rankRuntime
            ? "The host left the game. The room files this match as your win — your rating lands here in a moment."
            : (reason || "The room ended this match."),
          canClaim: false,
        });
      },
      opponentLeft: (username) => {
        // #121/#164: the far seat emptied. The board is still standing, so
        // this is a decision, not a dead end — and never a bare sentence
        // with no doors. The sheet spells out the rating consequence on
        // every door: finish the game (the star line still claims the win),
        // claim it now, or leave — and leaving claims first, so walking
        // away cannot strand a win the room has not filed yet.
        const who = username || "Your opponent";
        mpPeerAwayUntil = 0; // the countdown is over — the seat has emptied
        // A decided match is already showing its ledger; the far seat
        // emptying now is just teardown (dispose() frees it), not a
        // departure to answer. Say nothing over the ending.
        if (endingShown || leftSheet) return;
        toast(`${escText(who)} left the room.`, "bad");
        openLeftSheet({
          title: "Opponent left",
          body: rankRuntime
            ? `${who} left. Finish the game to claim the win and your rank points, or claim the win now — either way the room files this match in your favour.`
            : `${who} left — this match is over. You can finish the board solo, or head back to the menu.`,
          canClaim: !net.isGuest,
        });
      },
      // #164: the far socket dropped but the seat is NOT lost — the platform
      // holds it for its reconnect window, and the room says so out loud.
      // The banner counts the window down in plain sight (paintUi) while
      // play continues underneath; a return clears it, and an eviction hands
      // over to the "opponent left" sheet above.
      opponentDisconnected: (username, graceMs) => {
        mpPeerAwayName = username || rival.name || "Opponent";
        mpPeerAwayUntil = performance.now() + Math.max(graceMs, 0);
        mpDisconnectEpisode++;
        toast(`${escText(mpPeerAwayName)} disconnected — holding their seat for `
          + `${Math.round(Math.max(graceMs, 0) / 1000)}s…`, "info");
      },
      opponentReconnected: (username) => {
        mpPeerAwayUntil = 0;
        toast(`${escText(username || mpPeerAwayName || "Opponent")} is back — the match resumes.`, "good");
        // The seat may have emptied and refilled (eviction, then a fresh
        // join): a standing departure sheet is now a lie — take it down, and
        // call off a Leave that was waiting on a verdict that will not come.
        if (leftSheet) { leftSheet.destroy(); leftSheet = null; }
        if (leaveAfterVerdict) {
          leaveAfterVerdict = false;
          window.clearTimeout(leaveAfterVerdictTimer);
        }
      },
      status: (state) => {
        // A reconnect is exactly when a guest must re-pull state; the session
        // already asks, this just tells the player not to panic.
        if (state === "reconnecting") toast("Reconnecting…", "info");
        // #115/#112: a dropped link invalidates unconfirmed requests — the
        // protest targeting and the open bounty chooser would otherwise sit
        // there pointing at a host that cannot answer.
        if (state !== "connected") {
          pendingProtest = false;
          __clearGuestCross();
        }
      },
    });
  }

  // ── rendering ──────────────────────────────────────────────────────────
  // PP-03: while a Factory or a Depot is being placed, the overlay is built
  // from the SAME placement plans the click handlers validate with
  // (`planFactoryPlacement` / `planDepotPlacement`), so the preview can never
  // disagree with the final placement:
  //   footprint tiles → solid "highlight", or "highlight_bad" when that tile
  //                     alone refuses the build;
  //   reach tiles     → fainter "highlight_soft" (the Depot's 4×4 catchment;
  //                     the Factory's town-adjacency band);
  //   qualifying or caught tiles → thin "node_mark" outlines (a Depot's
  //                     resource nodes in catchment; the town tiles a Factory
  //                     footprint touches).
  type OverlayItem = { sprite: string; tx: number; ty: number };
  /**
   * One overlay frame: the tiles to mark, plus the transparent building the
   * hover would raise (`null` for the tools that place no building — a road
   * drag, an armed protest). The renderer paints both from this one answer.
   */
  type OverlayFrame = { items: OverlayItem[]; ghost: GhostSpec | null };
  /** AI-03c: the plant tool's preview AND its test twin must answer the same
   *  legality the CLICK enforces. `planFactoryPlacement` knows terrain and
   *  towns but NOT the built world, so it flashed green over footprints a
   *  building already stood on and the click then refused it — "can't place
   *  a second plant". Fold `plantRefusal` in: whole-plan veto, plus the
   *  covered tiles themselves turn red. */
  /**
   * PP-16: what the Depot placement plans must refuse against — the ids of the
   * industries some Depot's road network already holds. Computed here, once per
   * read, and passed in as an option so `planDepotPlacement` stays a question
   * about ground and geography (the lock needs the track layer, which it must
   * not reach for).
   */
  const depotLocks = () => ({ locked: lockedIndustryIds(eco), factories: eco.factories.map((f) => ({ tx: f.tx, ty: f.ty })), facing: depotView });

  /** The lot a wire lorry belongs to — the wire carries only its depot id. */
  const truckLot = (depotId: number): [number, number] | undefined => {
    const h = eco.harvesters.find((x) => x.id === depotId);
    return h ? [h.tx, h.ty] : undefined;
  };

  /** R: the next rotation the Depot tool will place in. */
  const rotateDepotView = () => {
    const site = hover && (tool === "harvester" || phase === "setup-harvester") ? hover : null;
    const legal = site ? depotFacings(grid, site.tx, site.ty) : [];
    if (legal.length > 1) {
      const cur = depotView && legal.includes(depotView) ? depotView : legal[0];
      depotView = legal[(legal.indexOf(cur) + 1) % legal.length];
    } else {
      depotView = rotateFacing(depotView ?? DEFAULT_FACING);
    }
    return depotView;
  };

  const factoryPlanForTool = (tx: number, ty: number): PlacementPlan => {
    const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true, track });
    const why = plantRefusal(grid, track, eco, tx, ty);
    if (why !== null && plan.valid) {
      plan.valid = false;
      plan.code = why;
      plan.why = PLANT_REFUSAL_TEXT[why];
      for (const f of plan.footprint) {
        if (f.ok && (buildingAt(eco, f.tx, f.ty) || grid.occupancy[tIdx(f.tx, f.ty)] >= 0)) {
          f.ok = false; f.why = "occupied";
        }
      }
    }
    return plan;
  };

  const pushPlan = (items: OverlayItem[], plan: PlacementPlan) => {
    for (const [x, y] of plan.reach) items.push({ sprite: "highlight_soft", tx: x, ty: y });
    for (const t of plan.footprint) {
      items.push({ sprite: t.ok ? "highlight" : "highlight_bad", tx: t.tx, ty: t.ty });
    }
    for (const [x, y] of plan.nodes) items.push({ sprite: "node_mark", tx: x, ty: y });
  };
  /**
   * RV-03: the overlay items for a DEPOT hover — the closest ROAD route the
   * lorry drives depot → factory, painted as a soft highlight over the route
   * tiles. This describes the truck on the map, so what you hover is exactly
   * what the truck does; the cache is keyed by (depot id, owner id) plus
   * `netVersion`, which `rescoreNow` bumps on every build/demolish, so the
   * answer is re-checked as soon as a new road may have opened a closer route.
   */
  let hoverRouteCache: { key: string; items: OverlayItem[] } | null = null;
  /**
   * One owner's network components, cached per `netVersion`. The inspector
   * asked for these on every frame of a hover — once per depot for a plant —
   * which re-flooded the network while nothing about it had changed.
   */
  type Components = ReturnType<typeof buildAllComponents>;
  let componentCache: { version: number; byOwner: Map<Harvester["ownerId"], Components> } =
    { version: -1, byOwner: new Map() };
  const componentsFor = (ownerId: Harvester["ownerId"]): Components => {
    if (componentCache.version !== netVersion) componentCache = { version: netVersion, byOwner: new Map() };
    let comp = componentCache.byOwner.get(ownerId);
    if (!comp) { comp = buildAllComponents(track, ownerId); componentCache.byOwner.set(ownerId, comp); }
    return comp;
  };
  /** Header ★ tooltips by player id, rebuilt only when the network or total moves. */
  const vpTipCache = new Map<string, { key: string; tip: string }>();
  const routeOverlayFor = (h: Harvester): OverlayItem[] => {
    const key = `${h.id}:${h.ownerId}:${netVersion}`;
    if (hoverRouteCache && hoverRouteCache.key === key) return hoverRouteCache.items;
    const comp = componentsFor(h.ownerId);
    const route = roadRouteForHarvester(eco, h, comp);
    const items = route
      ? route.map(([x, y]) => ({ sprite: "highlight_soft", tx: x, ty: y }))
      : [];
    hoverRouteCache = { key, items };
    return items;
  };
  /**
   * The placement overlay for a hover at (tx,ty), whatever the input device —
   * mouse and touch both arrive here through `hover`, so the preview is
   * identical at every zoom for both.
   *
   * Returns the tile items AND the ghost: the transparent preview of the
   * building the click would place, standing on the same footprint with the
   * same verdict. They come out of the one plan so the two can never
   * disagree — a green grid under a red building would be worse than either.
   */
  const overlayPlanAt = (tx: number, ty: number): OverlayFrame => {
    const items: OverlayItem[] = [];
    let ghost: GhostSpec | null = null;
    if (phase === "setup-factory") {
      // PP-02: the preview enforces the same town-adjacency rule as the click.
      const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true, track });
      pushPlan(items, plan);
      ghost = { sprite: FACTORY_SPRITE, tx, ty, valid: plan.valid };
    } else if (tool === "harvester" || phase === "setup-harvester") {
      const plan = planDepotPlacement(grid, eco.harvesters, tx, ty, depotLocks());
      pushPlan(items, plan);
      // The outpost art is the cargo's, so the preview shows the mill/rig/mine
      // this site would actually raise (see `depotPreviewSprite`).
      ghost = { sprite: depotPreviewSprite(grid, tx, ty, depotView), tx, ty, valid: plan.valid };
    } else if (tool === "platform" || tool === "raildepot") {
      // RAIL-02 (#176): the same overlay contract as every other placement
      // tool — the footprint green or red, and the transparent building
      // standing in the heading the player is holding (R turns it). The plan is
      // the SAME refusal function the click runs, so the two cannot disagree.
      const kind: "platform" | "depot" = tool === "platform" ? "platform" : "depot";
      const why = kind === "platform"
        ? platformRefusal(grid, rail.structures, railPlants(), me.i + 1, tx, ty, railView)
        : depotRefusal(grid, rail, me.i + 1, tx, ty, railView);
      const ok = why === "ok";
      const [fw, fh] = footprintFor(kind, railView);
      for (let dy = 0; dy < fh; dy++) for (let dx = 0; dx < fw; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x < MAP_W && y < MAP_H) items.push({ sprite: ok ? "highlight" : "highlight_bad", tx: x, ty: y });
      }
      if (kind === "depot") {
        // Where the train will come out: the declared exit, marked so the
        // player can see the join the depot is asking for.
        const exit = depotExit({ id: -1, kind: "depot", ownerId: me.i + 1, owner: "", tx, ty, w: fw, h: fh, view: railView });
        items.push({ sprite: "node_mark", tx: exit.tx, ty: exit.ty });
      }
      ghost = {
        sprite: `${kind === "platform" ? "platform" : "train-depot"}_${railView}`,
        tx, ty, valid: ok,
      };
    } else if (tool === "plant") {
      // AI-03c: the mid-game plant preview paints from the same folded plan
      // the test twin and the click share — no more green footprints over a
      // building the overlay never saw.
      const plan = factoryPlanForTool(tx, ty);
      pushPlan(items, plan);
      ghost = { sprite: FACTORY_SPRITE, tx, ty, valid: plan.valid };
    } else {
      items.push({ sprite: "highlight", tx, ty });
    }
    // RV-03: hovering an existing depot shows the road the truck takes. The
    // depot is found by tile, so the hover route and the truck agree even when
    // the current tool is not a placement tool (setup phases hover empty tiles
    // and find no depot, so they never double up).
    const dep = eco.harvesters.find((h) => depotContains(h.tx, h.ty, tx, ty));
    if (dep) items.push(...routeOverlayFor(dep));
    return { items, ghost };
  };
  /** The tile items alone — the shape `__iso.overlayItemsFor` has always had. */
  const overlayItemsAt = (tx: number, ty: number): OverlayItem[] =>
    overlayPlanAt(tx, ty).items;
  /** Everything the overlay layer draws this frame. */
  const overlayFrame = (): OverlayFrame => {
    if (preview) {
      const items: OverlayItem[] = preview.tiles.map(([x, y]) => ({ sprite: "highlight", tx: x, ty: y }));
      // VP-01: a paved drag over your own gravel is the only road action that
      // scores, so the preview rings the tiles it actually upgrades. Read from
      // the same `tileCost` question the drag was priced with, so what is
      // marked and what is charged can never disagree.
      if (tool === "road") {
        for (const [x, y] of preview.tiles) {
          if (hasTrack(track, "dirt", x, y)) items.push({ sprite: "node_mark", tx: x, ty: y });
        }
      }
      // No ghost: a road drag has no building to preview, and the merged
      // outline the vector overlay draws around the whole drag IS the preview.
      return { items, ghost: null };
    }
    if (pendingProtest && hover) {
      // The armed protest paints its own legality: green on a free public
      // road, red anywhere else — the same rule `placeProtest` enforces.
      const ok = protestPlaceable(hover.tx, hover.ty);
      const items: OverlayItem[] = [{ sprite: ok ? "highlight" : "highlight_bad", tx: hover.tx, ty: hover.ty }];
      if (ok) items.push({ sprite: "node_mark", tx: hover.tx, ty: hover.ty });
      return { items, ghost: null };
    }
    if (!hover) return { items: [], ghost: null };
    // Every placement tool — the opening Factory, a Depot, and (since the
    // overlay was unified) the mid-game plant — paints from its placement
    // plan, so all three get the same footprint/reach/node read AND the same
    // transparent building. The plant used to grow its own overlay here
    // (PP-06) which tinted a refused footprint faintly instead of red; the
    // plan it now shares marks each blocking tile individually, matching both
    // the click and the test twin.
    return overlayPlanAt(hover.tx, hover.ty);
  };

  function paintUi(now: number) {
    // AI-03: what your ★ total is MADE OF, surfaced as the native hover
    // tooltip over each player's name in the header ("I want to see what I
    // and the rival received win points for"). Recomputed live from the
    // network (VICTORY: paves 0.25★, plants-after-the-first 1★).
    function vpTooltip(p: PlayerState): string {
      const total = vpFor(score, p.id);
      // AI-04: the line is the difficulty's, so the tooltip's "of X★" and
      // "Y★ to win" agree with the win check that uses the same reader.
      const line = winTarget();
      const key = `${netVersion}:${total}:${line}:${p.name}:${p.human}`;
      const hit = vpTipCache.get(p.id);
      if (hit && hit.key === key) return hit.tip;
      const b = victoryBreakdown(eco, p.id, railPlatforms());
      const tip = [
        `${p.name}${p.human ? " (you)" : ""} — ${fmtVp(total)}★ of ${line}★`,
        `Paved road tiles: ${b.paved} × 0.25★ = ${fmtVp(b.pavedVp)}★`,
        `Processing plants: ${b.plants + 1} (opening plant is free; ${b.plants} × 1★ = ${fmtVp(b.plantVp)}★)`,
        `${fmtVp(Math.max(0, line - total))}★ to win`,
      ].join("\n");
      vpTipCache.set(p.id, { key, tip });
      return tip;
    }

    // BANNER-ONCE: each banner carries a stable id (`bannerKey`) beside its
    // text. The ✕ dismissal is remembered by that id, not by the exact text —
    // a few of these lines change wording while staying the same banner (the
    // free-tile counter, the protest countdown), so a text-keyed dismissal let
    // a CLOSED banner pop back up whenever the text changed and came back
    // (close "Dirt Road scores nothing…", switch tools, switch back → it
    // returned). The key makes "closed" stick for the rest of the game.
    // NO HINT BANNERS: the step-by-step guidance lines (place your Factory,
    // place your Depot, free track tiles, dirt value, nothing connected,
    // raise a plant, match the tokened gems) were removed — the How to Play
    // tour teaches all of it. Only two banners remain, and neither is a
    // lesson: an armed Protest waiting for its target click, and the result.
    let banner: string | null = null;
    let bannerKey: string | null = null;
    if (phase === "won") {
      bannerKey = "won";
      banner = `${winner?.name} wins — ${fmtVp(vpFor(score, winner?.id ?? ""))}★`;
    } else if (mpPeerAwayUntil > 0 && !endingShown) {
      // #164: the opponent's socket dropped and the platform is holding the
      // seat — the wait is VISIBLE, counted down where the play continues
      // underneath it. A return clears it (deadline → 0); an eviction hands
      // over to the "opponent left" sheet. The episode number keeps a
      // BANNER-ONCE ✕ from silencing the NEXT disconnect too.
      const leftMs = mpPeerAwayUntil - now;
      const secs = Math.max(0, Math.ceil(leftMs / 1000));
      bannerKey = `mp-disconnect-${mpDisconnectEpisode}`;
      banner = `${mpPeerAwayName || "Opponent"} disconnected — `
        + (secs > 0
          ? `reconnecting ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
          : "the room is closing their seat…");
    } else if (pendingProtest) {
      bannerKey = "protest-ready";
      banner = `Protest ready — click a public road to stop ALL trucks for ${fmtProtestLeft(PROTEST_MS)} (Esc cancels)`;
    }

    // #187: the placement hint — ONE slim line, and only what the Build button
    // cannot already say. The button names the tool and prices it from PP-07's
    // one authoritative table, so the hint carries the VERDICT instead: the
    // rule this tool places by, the reason a tile or a purse refuses, and —
    // for a road drag — the tiles and the ★ that drag buys, two numbers that
    // exist only once the drag does. The old bar restated the tool and its
    // whole price on two full-width lines over the map, and its ✕ hid a class
    // the next frame put straight back; this one is derived from `tool` and
    // `preview`, so `cancelPlacement` is what clears it.
    let costInfo: string | null = null;
    /** The hint's two fields: the verdict, then what the gesture buys. */
    const hintLine = (verdict: string, buys = ""): string =>
      `<span class="mb-txt">${verdict}</span>` +
      (buys ? `<span class="mb-cost">${buys}</span>` : "");
    /** What THIS purse is short of, as a price of its own (empty = it isn't). */
    const shortfallOf = (cost: Purse): Purse => {
      const out: Purse = {};
      for (const c of CARGOES) if ((cost[c] ?? 0) > (me.purse[c] ?? 0)) out[c] = cost[c];
      return out;
    };
    if (preview) {
      // W1: the drag's OWN numbers — `preview.cost` is exactly what the commit
      // charges, and a per-tile price on a button cannot say what a nine-tile
      // drag costs. VP-01: and the SCORE it buys comes from the same numbers,
      // so a Road drag onto virgin ground says "+0★" out loud — the whole
      // victory rule in one field.
      const n = preview.tiles.length;
      const paved = preview.upgrades;
      const vpTxt = tool === "road"
        ? (paved > 0 ? `+${fmtVp(paveVp(paved))}★ · paves ${paved}` : "+0★ · pave your dirt for points")
        : "+0★ · dirt scores nothing";
      const owed = Object.keys(preview.cost).length
        ? costMarkup(preview.cost)
        : (preview.free > 0 ? `${preview.free} free` : "free");
      costInfo = hintLine(
        `<b>${n}</b> ${n === 1 ? "tile" : "tiles"}` + (preview.truncated ? ` · <i>blocked</i>` : ""),
        `${vpTxt} · ${owed}`,
      );
    } else if (tool === "plant" && hover) {
      // PP-06: the refusal reason is PREVIEWED from the same rule the click
      // enforces, so a click is never a surprise — and this hint is the only
      // place it is spelled out before the click (the inspector's plan
      // verdicts cover the setup Factory and the Depot, not a mid-game plant).
      // VP-01: the ★ a plant is worth rides along, since no button states it.
      const why = plantRefusal(grid, track, eco, hover.tx, hover.ty);
      const short = shortfallOf(PLANT_COST);
      costInfo = why !== null
        ? hintLine(`<i>${PLANT_REFUSAL_TEXT[why]}</i>`)
        : Object.keys(short).length
          ? hintLine(`<i>needs ${costMarkup(short)}</i>`)
          : hintLine("ready to raise", `+${fmtVp(VICTORY.plant)}★`);
    } else if (tool === "harvester" || phase === "setup-harvester") {
      // PP-05: "show the complete cost before placement" — the Build button
      // states the complete price from the same `priceDepot` the click will
      // charge (W1, applied to buildings), so the hint adds the two things the
      // button cannot: the SITE rule a Depot is placed by, and the shortfall
      // when this purse cannot pay for it.
      const price = priceDepot(me.purse, me.freeDepots);
      costInfo = price.affordable
        ? hintLine("place it inside an industry's catchment")
        : hintLine(`<i>needs ${costMarkup(shortfallOf(DEPOT_COST))}</i>`);
    }

    // PP-03: while a Factory or a Depot is being placed, an INVALID hover
    // answers with its readable reason (distinct red appearance is painted on
    // the overlay). A valid hover falls through to the normal inspector so a
    // node can still be read while you aim at it.
    const placingFactory = phase === "setup-factory" && hover !== null;
    const placingDepot = (phase === "setup-harvester" || tool === "harvester") && hover !== null;
    const plan: PlacementPlan | null = placingFactory
      // PP-02: the inspector's verdict follows the same town-adjacency rule
      // the click and the overlay enforce ("can't go here — its footprint must
      // share an edge with a town").
      ? planFactoryPlacement(grid, hover!.tx, hover!.ty, { requireTown: true, track })
      : placingDepot
        ? planDepotPlacement(grid, eco.harvesters, hover!.tx, hover!.ty, depotLocks())
        : null;
    let infoTone: "bad" | null = null;

    // industry / harvester inspector
    let info = "";
    if (plan && !plan.valid) {
      const label = plan.kind === "factory" ? "Factory" : "Depot";
      info = `<b>${label}</b> can't go here — <i>${plan.why ?? "not buildable"}</i>.`;
      infoTone = "bad";
    } else {
      const ref = hover?.ref as { kind?: string; id?: number } | null;
      if (ref && ref.kind === "harvester") {
        const h = eco.harvesters.find((x) => x.id === ref.id);
        if (h) {
          // W2: the inspector resolves the connection over THIS harvester's
          // own network, not the merged graph.
          const conn = resolveConnection(eco, componentsFor(h.ownerId), h);
          // PP-16: what a Depot is worth is what it HOLDS, not what stands
          // nearby — an industry reached first by another Depot's road pays
          // that one instead, and the panel has to say so or the arithmetic on
          // screen never matches the money arriving.
          const locks = industryLocks(eco);
          const held = heldIndustries(eco, h, locks).length;
          const lost = industriesInCatchment(grid, h).length - held;
          info = `<b>Depot</b> (${h.owner === "you" ? "yours" : "rival"})<br>` +
            `holding ${held} industr${held === 1 ? "y" : "ies"}` +
            (lost > 0 ? ` · ${lost} reached first by another Depot` : "") + `<br>` +
            `link: ${conn.kind ?? "<i>none</i>"} ×${conn.multiplier || 0}`;
        }
      } else if (ref && ref.kind === "factory") {
        const owner = (hover?.ref as { owner?: string } | null)?.owner ?? "";
        const list = plantsOf(eco, owner);
        const f = list.find((x) => hover
          && hover.tx >= x.tx && hover.tx < x.tx + FACTORY_FOOTPRINT[0]
          && hover.ty >= x.ty && hover.ty < x.ty + FACTORY_FOOTPRINT[1]);
        const served = eco.harvesters.filter((h) => h.owner === owner
          && resolveConnection(eco, componentsFor(h.ownerId), h).factory === f).length;
        info = `<b>Processing Plant</b> (${owner === "you" ? "yours" : "rival"})<br>` +
          `plant ${(f?.id ?? 0) + 1} of ${list.length}` +
          (f?.townId != null ? ` · town ${f.townId + 1}` : "") + `<br>` +
          `${served} depot${served === 1 ? "" : "s"} delivering here`;
      } else if (hover) {
        // VP-01: a road tile answers with what it is WORTH, which is the rule
        // the whole victory system turns on and the one a player is most likely
        // to have backwards: gravel is free plumbing (0★), the PAVE over it is
        // the point, and a Road laid on virgin ground is not a pave at all.
        const hIdx = tIdx(hover.tx, hover.ty);
        const pavedHere = isUpgradedRoad(track, hover.tx, hover.ty);
        const hasRoad = hasTrack(track, "road", hover.tx, hover.ty);
        const hasDirt = hasTrack(track, "dirt", hover.tx, hover.ty);
        if ((hasRoad || hasDirt) && grid.occupancy[hIdx] < 0) {
          const owner = track.owner[hIdx];
          const who = owner === me.i + 1 ? "yours" : owner === rival.i + 1 ? "the rival's" : "public";
          const canPave = hasDirt && canBuildOn(grid, "road", hover.tx, hover.ty);
          info = `<b>${pavedHere ? "Paved Road (upgraded)" : hasRoad ? "Road" : "Dirt Road"}</b> · ${who}<br>` +
            (pavedHere && owner === me.i + 1
              ? `<b>+${fmtVp(VICTORY.upgrade)}★</b> — this tile was paved over your Dirt Road`
              : canPave
                ? `pave it for <b>+${fmtVp(VICTORY.upgrade)}★</b> (${costCompact(UPGRADE_COST)})`
                : hasDirt
                  ? `rough ground — a paved Road can't be laid here`
                  : `${who === "yours" ? `laid new — scores nothing; upgrade your gravel instead` : `not yours to score`}`);
          const prot = protests.get(hIdx);
          if (prot) info += `<br>✊ <b>Protest</b> — all trucks stopped (${fmtProtestLeft(prot.until - now)} left)`;
        }
        const occ = grid.occupancy[hIdx];
        if (occ >= 0) {
          const ind: Industry = grid.industries[occ];
          const def = INDUSTRY_BY_KEY[ind.type];
          // PP-16: an industry has ONE holder — the first Depot with a road at
          // it. Listing how many depots are nearby would advertise a sharing
          // rule that no longer exists, so the panel names the owner instead.
          const holder = industryLocks(eco).get(ind.id);
          info = `<b>${def?.name ?? ind.type}</b><br>` +
            `${CARGO[def.cargo].icon} ${CARGO[def.cargo].name} · output ${ind.output}<br>` +
            (holder === undefined
              ? `unclaimed — the first Depot with a road here holds it`
              : `<b>held</b> by ${holder.owner === me.id ? "your" : "the rival's"} Depot`);
        }
      }
    }

    const sig = (Object.entries(quarry.reach) as [Cargo, number][])
      .map(([c, v]) => `${c}:${v.toFixed(2)}`).join(",");
    if (sig !== reachSig) {
      reachSig = sig;
      ui.setReach(quarry.reach);
    }

    ui.paint({
      players: players.map((p) => ({
        id: p.id, name: p.name, colour: p.colour, vp: vpFor(score, p.id), human: p.human,
        vpTip: vpTooltip(p),
      })),
      purse: me.purse,
      phase,
      tool: tool as any,
      // STORY-01: the contract's rival wears their painted sheet on the
      // dossier card; a sandbox match sends nothing and keeps the mugshots.
      ...(storyOn ? { rivalFace: faceOf(rivalCast, "calm") } : {}),
      // AI-04: the race length the HUD should print — 5★ on easy, the shipped
      // line elsewhere. The badge ("You 2★/5") and the king bars' 100% read it.
      vpTarget: winTarget(),
      freeTrack: me.freeTrack,
      freeDepots: me.freeDepots,
      banner,
      // BANNER-ONCE: the stable id behind `banner` (see paintUi) — the ✕
      // dismissal is remembered by this, so a closed line never pops back up
      // when the wording changes and returns.
      bannerKey,
      costInfo,
      inspect: info || null,
      inspectTone: infoTone,
      reach: quarry.reach,
      // PP-14b: the 30s reset cooldown, so the button can count it down.
      // #116: per seat — a guest counts down ITS OWN clock (its cooldown
      // lives on the host; this mirror moves when the guest requests).
      resetIn: Math.max(0, RESET_COOLDOWN_MS - (now - (isGuest() ? guestResetAt : lastResetAt))),
      // PP-14b: the tycoon portrait picked on the start screen.
      portrait,
      // NAMES: the top-bar Names button paints its pressed state from this.
      showNames,
      // L4 (#218): the board's own state on the new loop. `undefined` (the flag
      // off) leaves the always-on plant exactly as it ships; `null` takes the
      // board down between sessions; a session puts it up with its budget, its
      // score and the yield that score is worth right now.
      tuning: newLoop
        ? (tuning
          ? {
              cargo: tuning.cargo, moves: tuning.moves, movesLeft: tuningMovesLeft(tuning),
              score: tuning.score, yield: tuningSessionYield(tuning),
              abandonYield: TUNING_ABANDON_YIELD,
            }
          : null)
        : undefined,
      // RAIL-04 (#178): the Railway panel's rows — the MODEL is `railPanelRows`
      // in the rail module (which platform has a line, which train is stored,
      // which actions are legal); this only adds the price the button prints.
      rail: {
        rows: railPanelRows(rail, me.i + 1).map((r) => ({
          ...r,
          hint: r.actions.includes("assign") || r.actions.includes("buy") ? `buys a train · ${railCostLabel(RAIL_COSTS.train)}`
            : r.actions.includes("sell") ? `refund ${railCostLabel(resaleValue(RAIL_COSTS.train))} once`
              : undefined,
        })),
        view: railView,
      },
    });
  }

  /**
   * MP-05: the ONE drag→action seam. On solo/host it commits exactly as
   * before; on a guest it sends an intent with the SAME endpoints, so the
   * host's `previewDrag`/`commitDrag` runs against the guest's seat and the
   * guest's local preview is what the host is about to do (the two previews
   * share the cost model and the synced purse, so they agree).
   *
   * Returns the preview in both cases: the pointer path paints from it, and the
   * e2e/unit twin (`dragBuild`) asserts on it without a pixel path.
   */
  /**
   * MOBILE-01: the "why not" for a refused track tile, in one place. A drag
   * that previews nothing and a TAP on an illegal tile (the phone's way of
   * laying a single tile of road) must say the same thing, in the same two
   * voices — the toast at the screen's edge and the 1-second flash AT the
   * tile the finger was on.
   */
  const refuseTrackAt = (kind: TrackKind, tx: number, ty: number) => {
    // No network argument, exactly like the drag preview beside it: main's
    // "roads anywhere" dropped the adjacency requirement, so adjacency can
    // no longer be the reason a tile refuses.
    const refusal = buildRefusal(grid, kind, tx, ty);
    if (refusal === null) return;
    if (refusal === "water") toast("Can't build on water.", "bad");
    else if (refusal === "rough") toast("A paved Road can't cross rough ground — use a Dirt Road.", "bad");
    else if (refusal === "occupied") toast("Tile is occupied.", "bad");
    else if (refusal === "field") toast("A field or trees stand there — demolish them first.", "bad");
    else toast("Can't build there.", "bad");
    // And the 1-second flash AT the tile that refused — the toast
    // is at the edge of the screen, the player's eye is here.
    flashAt(tx, ty, TRACK_FLASH_TEXT[refusal] ?? "Can't build here");
  };

  const requestTrackBuild = (
    kind: TrackKind, ax: number, ay: number, bx: number, by: number, xFirst: boolean,
  ): DragPreview | null => {
    if (phase !== "play") return null;
    if (!canBuildOn(grid, kind, ax, ay)) return null;
    const pv = previewDrag(grid, track, kind, me.purse, ax, ay, bx, by, xFirst, undefined,
      me.freeTrack, structureTiles(eco.factories, eco.harvesters, me.i + 1), newLoop);
    if (pv.tiles.length === 0) return null;
    if (isGuest()) {
      net?.sendIntent("build", { do: "track", kind, ax, ay, bx, by, xFirst });
      return pv;
    }
    commitTrackDrag(me, pv, kind);
    return pv;
  };

  // A factory is one multi-tile sprite, but has one network anchor: its
  // origin tile. Town clicks with the plant tool resolve to a legal site
  // beside that town, identically for pointer-move previews and pointer-up.
  // In track mode a click ANYWHERE on our factory must start at
  // that anchor; otherwise a click on its far tiles would start a road the
  // network cannot reach. Keep raw tile picking for other tools/structures.
  const pickForAction = (x: number, y: number) => {
    const p = renderer?.pick(x, y);
    if (!p || phase !== "play") return p;
    if (tool === "plant") {
      const site = resolvePlantTarget(grid, track, eco, p.tx, p.ty);
      return site ? { ...p, tx: site[0], ty: site[1] } : p;
    }
    if (tool !== "road" && tool !== "dirt") return p;
    const ref = p.ref as { kind?: string; owner?: string } | null;
    if (ref?.kind !== "factory" || ref.owner !== me.id) return p;
    const f = factoryOf(me.id);
    return f ? { ...p, tx: f.tx, ty: f.ty } : p;
  };

  // ── input ──────────────────────────────────────────────────────────────
  let g: GestureState = createGesture();
  // PERF-01: the EFFECTIVE dpr (policy-capped), not the browser's — the
  // canvas backing is sized by it in `resize()`, so a pointer CSS pixel maps
  // to backing pixels through exactly this factor. On a dpr-2 screen with
  // performance mode ON the backing is 1× and this returns 1, keeping
  // picking, drags and zoom anchors on the same lattice the renderer draws.
  const dpr = () => Math.min(dprCapOf(), window.devicePixelRatio || 1);
  const pos = (e: PointerEvent): [number, number] => {
    const b = stage.getBoundingClientRect();
    return [(e.clientX - b.left) * dpr(), (e.clientY - b.top) * dpr()];
  };
  let downAt: [number, number] | null = null;
  let moved = false;
  /** MOBILE-01: this press's tap slop, in device px (mouse vs fingertip). */
  let slop = 4;
  /**
   * MOBILE-01: a track drag is ARMED on press but only goes LIVE once the
   * pointer outruns the tap slop. Below it the press is a tap (one tile of
   * track, or a place), and — the part a phone cannot do without — the finger
   * still PANS while the road tool is in the hand. A second finger always
   * wins: it drops the armed drag and takes over as the pinch/pan gesture.
   */
  let dragLive = false;

  canvases.overlay.addEventListener("pointerdown", (e) => {
    if (typeof canvases.overlay.setPointerCapture === "function") {
      canvases.overlay.setPointerCapture(e.pointerId);
    }
    const [x, y] = pos(e);
    downAt = [x, y]; moved = false;
    slop = tapSlop(e.pointerType, dpr());
    const isMouse = e.pointerType === "mouse";
    // MOBILE-01: the gesture bookkeeping runs for every press that MAY pan —
    // every touch/pen point, and the mouse's middle button — INCLUDING the
    // press that arms a track drag. Before this, a second finger landing on a
    // road drag re-anchored the drag instead of pinching, and a phone holding
    // a road tool had no pan and no zoom at all. TK-001 is untouched: a left
    // or right MOUSE press still never enters the pan gesture.
    const panCapable = !isMouse || e.button === 1;
    if (panCapable) {
      const secondFinger = g.pointers.length >= 1 && g.pointers[0].id !== e.pointerId;
      g = pointerDown(g, { id: e.pointerId, x, y });
      if (secondFinger) {
        // The pinch/pan gesture outranks an armed road drag: drop it so the
        // two fingers steer the camera instead of the track preview.
        if (drag) { drag = null; preview = null; dragLive = false; paintOverlayNow(); }
        return;
      }
    }
    const p = pickForAction(x, y);
    if (!p) return;
    const isTrackTool = tool === "road" || tool === "dirt" || tool === "rail";
    // TK-001: left mouse (button 0) is build/place ONLY — it never starts a
    // pan. Touch keeps its old behaviour (one finger pans, a quick tap places).
    // An armed protest owns the left button: it must never start a track drag.
    if (phase === "play" && isTrackTool && !pendingProtest && (!isMouse || e.button === 0) && e.isPrimary) {
      // RAIL-04: the rail drag arms anywhere — like a road drag, it has no
      // network-adjacency seed requirement (the tiles it lays are judged one by
      // one, and the drag stops at the first tile that refuses).
      const canStart = tool === "rail" || canBuildOn(grid, tool as TrackKind, p.tx, p.ty);
      if (canStart) {
        drag = { ax: p.tx, ay: p.ty };
        dragLive = false;
        return;
      }
    }
    // TK-001: mouse panning is the MIDDLE button (button === 1). Left and
    // right mouse presses never enter the pan gesture. The right button's
    // map action is on RELEASE — it cancels the held tool to the pointer
    // (see `onUp`) — so a press here still must not start a drag.
  });

  /**
   * Paint the overlay layer NOW, from the live hover/preview, instead of
   * leaving the pointer's answer to the next animation frame (which also runs
   * the simulation, terrain and traffic first). Same `overlayFrame` the frame
   * loop paints from, so the two can never disagree.
   */
  const paintOverlayNow = () => {
    if (!renderer) return;
    // MOBILE-01: this is a nicety, never a gate. It runs INSIDE pointer
    // handlers, so a throw here (a canvas mock without gradients in the jsdom
    // harness, a lost GL context in the wild) must not abort the gesture or
    // the placement decision that follows — the frame loop repaints the
    // overlay on the next tick anyway.
    try {
      const { items, ghost } = overlayFrame();
      renderer.drawOverlay(items, performance.now(), ghost);
    } catch { /* best-effort; the frame loop repaints next tick */ }
  };
  /** What the current drag preview was computed from; see pointermove. */
  let previewKey = "";

  /** Drop the half-planned drag, if one is armed. */
  function dropDrag(): boolean {
    if (!drag && !preview) return false;
    drag = null; preview = null; dragLive = false; previewKey = "";
    return true;
  }

  /**
   * #187: the ONE way out of a placement. The hint's Cancel ✕, the touch
   * chip, Esc, Q, the right button and a re-tap of the armed Build button all
   * land here, so "cancel" cannot mean one thing in one door and another in
   * the next: the pointer comes back into the hand, the armed drag and its
   * ghost go with it, and the overlay repaints at once instead of leaving
   * tiles painted that no pointerup will ever commit.
   *
   * `costInfo` is derived from `tool`/`preview` in paintUi, so the hint
   * follows them down on the next frame. That derivation is the bug the old
   * `.mb-cancel` ran into: it added a `hidden` class and left the tool armed,
   * so the next frame's `toggle("hidden", !info)` put the bar straight back.
   */
  function cancelPlacement(): boolean {
    const armed = tool !== "select";
    tool = "select";
    if (dropDrag() || armed) paintOverlayNow();
    return armed;
  }

  /**
   * Put a build tool in the hand. Switching tools drops a drag that was
   * planned for the previous one — the preview prices `tool`'s own tiles, so
   * a road drag left armed under the Depot tool would quote the wrong build.
   */
  function armTool(t: Tool) {
    // RAIL-05 (#182): the flag down means the tool does not exist. Refuse the
    // arm and keep whatever is already in the hand — a hotkey that would
    // summon a refused build is just a confusing one.
    if (!railAvailable && RAIL_TOOL_KEYS.has(t)) {
      toast("Rail is not available in this mode.", "info");
      return;
    }
    // The opening Depot is owed: every click in this phase places it, so any
    // other build tool would light up and then silently build a Depot instead.
    if (phase === "setup-harvester" && t !== "harvester") {
      toast("Place your free Depot first — then the rest of the Build menu opens up.", "info");
      return;
    }
    tool = t;
    if (dropDrag()) paintOverlayNow();
  }

  canvases.overlay.addEventListener("pointermove", (e) => {
    const [x, y] = pos(e);
    // MOBILE-01: the slop is per-press and per-pointer-type (`slop`), so a
    // fingertip tap that jitters two CSS pixels still counts as a tap.
    if (downAt && (Math.abs(x - downAt[0]) > slop || Math.abs(y - downAt[1]) > slop)) moved = true;
    const p = pickForAction(x, y);
    let changed = false;
    if (p && (!hover || hover.tx !== p.tx || hover.ty !== p.ty || hover.ref !== p.ref)) {
      hover = { tx: p.tx, ty: p.ty, ref: p.ref };
      changed = true;
    }
    if (drag && p) {
      // MOBILE-01: an armed drag stays DORMANT inside the tap slop, and while
      // it is dormant the finger PANS — the only pan a phone has once a road
      // tool is in the hand. Outrunning the slop makes the drag live.
      if (!dragLive) {
        if (!moved) {
          const out = pointerMove(g, { id: e.pointerId, x, y }, cam);
          g = out.gesture;
          if (out.cam !== cam) { cam = out.cam; renderer?.setCamera(cam); }
          if (changed) paintOverlayNow();
          return;
        }
        dragLive = true;
      }
      // A second finger landed: the pinch owns the gesture now (pointerdown
      // already dropped the drag when it arrived); fall through to the pan.
      if (g.pointers.length < 2) {
        const purseKeyEarly = CARGOES.map((c) => me.purse[c] ?? 0).join(",");
        if (tool === "rail") {
          // RAIL-04: the rail preview is `railPreview`'s — the same function
          // the commit re-runs, so the tiles drawn and the price charged are one
          // number. The rail revision is in the key because the validity of a
          // crossing and the legality of a merge depend on the network.
          const railKey = `rail:${drag.ax},${drag.ay}:${p.tx},${p.ty}:${netVersion}:${rail.rail.revision}:${purseKeyEarly}`;
          if (!preview || railKey !== previewKey) {
            preview = railPreview(grid, track, rail, me.i + 1, me.purse,
              drag.ax, drag.ay, p.tx, p.ty, true);
            previewKey = railKey;
            changed = true;
          }
          if (changed) paintOverlayNow();
          return;
        }
        const kind = tool as TrackKind;   // build-track tools are dirt | road
        // A drag re-plans only when something it depends on moved: the end
        // tile, the network (netVersion), the purse or the free allowance.
        // Sub-tile pointer motion reuses the plan it already has.
        const purseKey = CARGOES.map((c) => me.purse[c] ?? 0).join(",");
        const key = `${kind}:${drag.ax},${drag.ay}:${p.tx},${p.ty}:${netVersion}:${me.freeTrack}:${purseKey}`;
        if (!preview || key !== previewKey) {
          // Roads anywhere (main): no network adjacency requirement, so the
          // preview is allowed to start anywhere and grow without a seed.
          // L2: the drag prices with the loop's cost model (dirt free under newLoop).
          preview = previewDrag(grid, track, kind, me.purse,
            drag.ax, drag.ay, p.tx, p.ty, true, undefined, me.freeTrack,
            structureTiles(eco.factories, eco.harvesters, me.i + 1), newLoop);
          previewKey = key;
          changed = true;
        }
        if (changed) paintOverlayNow();
        return;
      }
      drag = null; preview = null; dragLive = false;
      changed = true;
    }
    if (changed) paintOverlayNow();
    const out = pointerMove(g, { id: e.pointerId, x, y }, cam);
    g = out.gesture;
    if (out.cam !== cam) { cam = out.cam; renderer?.setCamera(cam); }
  });

  // Leaving the map drops the highlight at once. A captured drag keeps its
  // preview — the pointer is still steering it.
  canvases.overlay.addEventListener("pointerleave", () => {
    if (drag || !hover) return;
    hover = null;
    paintOverlayNow();
  });

  const onUp = (e: PointerEvent) => {
    const [x, y] = pos(e);
    // RIGHT-CLICK: the strategy-game "escape to pointer". It cancels whatever
    // tool is held — and an armed protest, the same thing Esc does — and
    // leaves the pointer (select) in the hand, which highlights and names
    // instead of building. A right press never starts a drag, so nothing
    // below can misread it as a build. #187: it goes through the SAME
    // `cancelPlacement` the hint's ✕ uses, so one door cannot leave a ghost
    // or a hint behind that another one clears.
    if (e.pointerType === "mouse" && e.button === 2) {
      if (pendingProtest) {
        pendingProtest = false;
        toast("Protest cancelled.", "info");
      } else {
        cancelPlacement();
      }
      downAt = null;
      g = pointerUp(g, e.pointerId);
      return;
    }
    // MOBILE-01: a track drag that never outran the tap slop is a TAP: one
    // tile of track under the finger (the phone has no "click then click
    // again", and a one-tile road is a thing players lay constantly). The
    // refusal voices are shared with the drag path via `refuseTrackAt`.
    if (drag && !dragLive) {
      const { ax, ay } = drag;
      const wasRail = tool === "rail";
      drag = null; preview = null; dragLive = false;
      if (!moved && phase === "play" && !pendingProtest) {
        // RAIL-04: one tile of rail under the finger, exactly like a one-tile
        // road — a tap is how a phone lays a single tile.
        if (wasRail) requestRailBuild(ax, ay, ax, ay, true);
        else {
          const pv = requestTrackBuild(tool as TrackKind, ax, ay, ax, ay, true);
          if (!pv) refuseTrackAt(tool as TrackKind, ax, ay);
        }
      }
      downAt = null;
      g = pointerUp(g, e.pointerId);
      return;
    }
    if (drag && preview) {
      if (tool === "rail") {
        // RAIL-04: the rail drag commits the preview it drew (or, on a guest,
        // sends the same endpoints to the host as an intent).
        if (preview.tiles.length === 0) {
          const why = (preview as { why?: string | null }).why;
          toast(why && why !== "ok" ? RAIL_REFUSAL_TEXT[why as never] : "Can't build rail there.", "bad");
          flashAt(drag.ax, drag.ay, "No rail here");
        } else {
          const end = preview.tiles[preview.tiles.length - 1];
          requestRailBuild(drag.ax, drag.ay, end[0], end[1], true);
        }
        drag = null; preview = null; downAt = null;
        g = pointerUp(g, e.pointerId);
        return;
      }
      if (preview.tiles.length === 0) {
        // W9: the allowance buys Dirt only, so a paved Road drag with no ore
        // previews nothing at all.
        const isRoad = tool === "road";
        if (isRoad && (me.purse.ore ?? 0) < (TRANSPORT.road.cost.ore ?? 0)) {
          toast(me.freeTrack > 0
            ? "A paved Road costs ore — free setup tiles only cover Dirt Roads."
            : "A paved Road needs ore — connect an ore mine first.", "bad");
          // The 1-second flash, at the tile the drag STARTED from: it says
          // what was tried (a Road) and what is missing, in place.
          flashAt(drag.ax, drag.ay, isRoad ? "Paved Road needs ore" : "No tiles here");
        } else {
          toast("Can't build there.", "bad");
          flashAt(drag.ax, drag.ay, "Can't build here");
        }
      } else {
        // MP-05: the endpoints the intent carries are the preview's own, so the
        // host reproduces the exact plan the guest just saw.
        const end = preview.tiles[preview.tiles.length - 1];
        requestTrackBuild(tool as TrackKind, drag.ax, drag.ay, end[0], end[1], true);
      }
      drag = null; preview = null; downAt = null;
      g = pointerUp(g, e.pointerId);
      return;
    }
    drag = null; preview = null;

    // TK-001: a mouse click that places/builds is LEFT-button only. Middle
    // clicks (pan) and right clicks never fall through to the place path.
    const isMouse = e.pointerType === "mouse";
    if (!moved && (!isMouse || e.button === 0)) {
      const p = pickForAction(x, y);
      // MOBILE-01: touch has no hover, so a TAP is the read-the-map gesture —
      // answer it with the same highlight + inspector a mouse hover paints,
      // instead of leaving the finger with nothing but a silent map.
      if (p && (!hover || hover.tx !== p.tx || hover.ty !== p.ty || hover.ref !== p.ref)) {
        hover = { tx: p.tx, ty: p.ty, ref: p.ref };
        paintOverlayNow();
      }
      if (p) {
        if (phase === "setup-factory") {
          // MP-05: a guest's opening click is an intent like any other — the
          // host places seat 1's Factory by the same town-adjacency rule.
          if (isGuest()) net?.sendIntent("build", { do: "factory", tx: p.tx, ty: p.ty });
          else placeFactory(p.tx, p.ty);
        } else if (phase === "setup-harvester") {
          // PP-05: the setup Depot is free because `me.freeDepots` is still 1 —
          // the allowance is data on the player record, not this phase.
          if (isGuest()) {
            net?.sendIntent("build", { do: "depot", tx: p.tx, ty: p.ty });
          } else if (placeHarvester(p.tx, p.ty, me)) {
            phase = "play";
            lastHarvest = performance.now();
            lastAi = performance.now();
            // L4 (#218): the new loop promises the clock, not the board. The
            // session toast (from `openTuningSession`) has already told the
            // player what the board is for; this line is the other half of the
            // loop — the road that makes the Depot earn.
            toast(newLoop
              ? "Now connect it to your Factory with a Dirt Road — a connected Depot ticks its cargo in on the clock."
              : "Now connect it to your Factory with a Dirt Road or a paved Road — then match the tokened gems in the Processing Plant.", "info");
          }
        } else if (phase === "play") {
          // A bought protest intercepts the click: it stages on a public road
          // (or refuses and stays armed), and never runs the current tool.
          if (pendingProtest) placeProtest(p.tx, p.ty);
          // PP-05: every Depot after the setup allowance pays DEPOT_COST.
          else if (tool === "harvester") {
            if (isGuest()) net?.sendIntent("build", { do: "depot", tx: p.tx, ty: p.ty });
            else placeHarvester(p.tx, p.ty, me);
          } else if (tool === "plant") {
            if (isGuest()) net?.sendIntent("build", { do: "plant", tx: p.tx, ty: p.ty });
            else placePlant(p.tx, p.ty, me);
          } else if (tool === "platform" || tool === "raildepot") {
            // RAIL-02 (#176): the two railway structures. On a guest the click
            // is an intent like every other build; the host runs the same rule
            // function against the guest's seat (and the same heading, which
            // the guest sends with it).
            if (isGuest()) {
              net?.sendIntent("build", { do: tool === "platform" ? "platform" : "raildepot", tx: p.tx, ty: p.ty, view: railView });
            } else if (tool === "platform") placeRailPlatform(p.tx, p.ty, me);
            else placeRailDepot(p.tx, p.ty, me);
          } else if (tool === "railway") {
            // The panel tool builds nothing on the map: the panel is the UI's,
            // and a click here is a no-op with a hint rather than a refusal.
            toast("The Railway panel is on the left — assign a line, recall or sell a train.", "info");
          } else if (tool === "demolish") {
            if (isGuest()) net?.sendIntent("demolish", { do: "demolish", tx: p.tx, ty: p.ty });
            else doDemolish(p.tx, p.ty);
          } else if (tool === "road" || tool === "dirt" || tool === "rail") {
            // A tap with a track tool that got here is a refusal: the legal
            // single-tile build is handled where the drag ends (above).
            refuseTrackAt(tool as TrackKind, p.tx, p.ty);
          }
        }
      }
    }
    downAt = null;
    g = pointerUp(g, e.pointerId);
  };
  canvases.overlay.addEventListener("pointerup", onUp);
  canvases.overlay.addEventListener("pointercancel", (e) => {
    drag = null; preview = null; dragLive = false; downAt = null; g = pointerUp(g, e.pointerId);
  });
  // The right button is a game control (it drops the held tool to the
  // pointer), so the browser's context menu must never fight it over the map.
  canvases.overlay.addEventListener("contextmenu", (e) => e.preventDefault());
  canvases.overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x, y] = pos(e as unknown as PointerEvent);
    cam = zoomStepAt(cam, e.deltaY < 0 ? +1 : -1, x, y);
    renderer?.setCamera(cam);
  }, { passive: false });

  /**
   * WASD map pan (the strategy-game camera). Screen-space, constant WORLD
   * speed (÷zoom), integrated in the frame loop from `panKeys` — held keys
   * pan continuously, Shift doubles the speed. The set is cleared on blur so
   * a key lost to a window switch cannot stick the camera.
   */
  const PAN_KEYS = new Set(["w", "a", "s", "d"]);
  const panKeys = new Set<string>();
  let panShift = false;
  const isTypingTarget = (e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null;
    return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  };

  const onKeydown = (e: KeyboardEvent) => {
    // Tool hotkeys. `q` is the pointer (select) — the keyboard twin of the
    // right-click cancel, and #187 routes both through `cancelPlacement` so
    // the hint and the placement ghost go down with the tool — whatever tool
    // it is, RAIL-04's four included.
    const map: Record<string, Tool> = {
      "q": "select", "1": "dirt", "2": "road", "3": "harvester", "4": "plant",
      "5": "demolish", "6": "rail", "7": "platform", "8": "raildepot", "9": "railway",
    };
    if (!isTypingTarget(e) && map[e.key]) {
      if (map[e.key] === "select") cancelPlacement();
      else armTool(map[e.key]);
    }
    // RAIL-02: R turns the platform/depot heading a quarter turn — the same
    // four headings the art and the footprints are authored in, in the same
    // order (`rotateView` is the rail module's, not a second list here).
    if (!isTypingTarget(e) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "r") {
      // The Depot is placed in four rotations too, and R turns whichever tool
      // is armed: over a real site it steps through the sides that site can
      // actually open onto, so a turn never promises an impossible entrance.
      if (tool === "harvester" || phase === "setup-harvester") rotateDepotView();
      else railView = rotateView(railView);
      paintOverlayNow();
    }
    // WASD pan — plain keys only (a modified key is a browser/editor
    // shortcut, not the camera), and never while typing in a field.
    if (!isTypingTarget(e) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (PAN_KEYS.has(k)) panKeys.add(k);
      panShift = e.shiftKey;
    }
    if (e.key === "Escape") {
      if (pendingProtest) { pendingProtest = false; toast("Protest cancelled.", "info"); return; }
      // #187: Esc is the desktop twin of the hint's Cancel ✕, so it goes
      // through the SAME seam — the tool comes out of the hand and an armed
      // drag goes with it, ghost and priced hint included, plus the
      // `previewKey` that would otherwise let the next pointermove skip
      // re-pricing a drag that is no longer there. The two full-screen layers
      // the game owns keep the key to themselves: closing a tutorial, a story
      // scene or the ending must not also disarm a tool behind it. (The ☰
      // menu, Settings and a confirm question already swallow Esc in a capture
      // listener, so this never fires underneath one of them.)
      if (tutorialView || storyView) return;
      if (endingView && !endingView.element.classList.contains("hidden")) return;
      if (drag || preview) { cancelPlacement(); toast("Drag cancelled.", "info"); return; }
      if (tool !== "select") { cancelPlacement(); toast("Tool cancelled.", "info"); return; }
    }
    if (e.key === "`" || e.key === "~") {
      if (debug) {
        const active = debug.activeOverlays();
        if (active.length > 0) {
          debug.overlay("none");
          toast("Debug overlay: OFF", "info");
        } else {
          debug.overlay("all");
          toast("Debug overlay: ON", "info");
        }
      }
    }
  };
  const onKeyup = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (PAN_KEYS.has(k)) panKeys.delete(k);
    if (e.key === "Shift") panShift = false;
  };
  // A key released in another window never sends its keyup here — without
  // this the camera would pan forever on its own.
  const onWindowBlur = () => { panKeys.clear(); panShift = false; };
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keyup", onKeyup);
  window.addEventListener("blur", onWindowBlur);

  // ── reduced motion ─────────────────────────────────────────────────────
  /**
   * Mirror the OS "reduce motion" setting onto the placement overlay, live:
   * the media query is listened to, not read once, because the setting can
   * change while a game is open and the canvas has no stylesheet to fall back
   * on. Absent `matchMedia` (tests, an odd embed) motion simply stays on.
   */
  let motionQuery: MediaQueryList | null = null;
  const syncOverlayMotion = () => {
    if (typeof window.matchMedia !== "function") return;
    if (!motionQuery) {
      motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      motionQuery.addEventListener?.("change", () => {
        renderer?.setOverlayMotion(!motionQuery!.matches);
      });
    }
    renderer?.setOverlayMotion(!motionQuery.matches);
  };

  // ── resize ─────────────────────────────────────────────────────────────
  const resize = () => {
    const d = dpr();
    const w = Math.max(1, Math.floor(stage.clientWidth * d));
    const h = Math.max(1, Math.floor(stage.clientHeight * d));
    for (const c of Object.values(canvases)) { c.width = w; c.height = h; }
    mini.resize(w, h);
    cam = resizeCamera(cam, w, h);
    renderer?.setCamera(cam);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  window.visualViewport?.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);

  // ── C5: the visual-debug console ───────────────────────────────────────
  // Installed only in a dev build or when the URL asks for it (`?iso-debug` or `?debug`),
  // so a shipped build never creates the dumps and never sets the renderer's
  // debugPainter. Every command reads live state through the getters below,
  // which is the whole point: a screenshot can be traced to the exact numbers
  // the renderer used. See docs/iso-debug-console.md.
  const searchStr = typeof location !== "undefined" ? location.search : "";
  const debug = shouldInstallDebugConsole({
    dev: import.meta.env.DEV,
    search: searchStr,
  }) ? createIsoDebug({
    grid, track, eco, players,
    get camera() { return cam; },
    get renderer() { return renderer; },
    get atlas() { return atlasRef; },
    get hover() { return hover; },
    get tool() { return tool; },
    get phase() { return phase; },
    ownerOf: (who: string) => {
      const p = players.find((q) => q.id === who);
      return p ? p.i + 1 : null;
    },
    dpr,
  }) : null;

  if (debug && shouldAutoEnableDebugOverlays({ search: searchStr })) {
    debug.overlay("all");
  }
  // `?render-log=1`: per-blit renderer trace (source/dest rect, clip, depth
  // key) so a live session can be diagnosed without reading debug.ts.
  const autoRenderLog = shouldAutoEnableRenderLog({ search: searchStr });
  const enableRenderLogOnBoot = () => {
    if (debug && autoRenderLog) (debug.commands.renderLog as (on: boolean) => unknown)(true);
  };

  // ── A1: lorry deliveries ────────────────────────────────────────────────
  // A lorry that reaches the Factory HAS delivered, and that arrival is now
  // the event that mints the token: the "+2 🌾" pops over the Factory on the
  // same frame a gem on the board gains its token. It used to be a 20s clock
  // with a per-tile fudge factor that knew nothing about the road it was
  // pretending to model — the number on the board and the lorry on the map
  // were two unrelated systems that happened to describe the same cargo.
  /** Deliveries already paid out, per depot id. */
  const seenDeliveries = new Map<number, number>();
  /** Never pay more than this many missed deliveries at once (background tab). */
  const MAX_CATCHUP = 3;

  /** Every cargo the given lorries deliver — the OWNER's quarry clock must
   *  skip them (AI-03: generalized over seats, both seats run boards now). */
  function truckCargos(list: Truck[], nowMs: number, owner = "you"): Cargo[] {
    const out = new Set<Cargo>();
    const want = ownerIdOf(eco, owner);
    for (const truck of list) {
      if (truck.ownerId !== want) continue;
      for (const cargo of depotCargos(truck.depotId, nowMs)) out.add(cargo);
    }
    return [...out];
  }

  /** The cargoes the depot at `id` feeds, ignoring blockaded industries. */
  function depotCargos(id: number, nowMs: number): Cargo[] {
    const h = eco.harvesters.find((x) => x.id === id);
    if (!h) return [];
    const out: Cargo[] = [];
    for (const ind of industriesInCatchment(eco.grid, h)) {
      if (ind.banditUntil > nowMs) continue;
      const def = INDUSTRY_BY_KEY[ind.type];
      if (def && !out.includes(def.cargo)) out.push(def.cargo);
    }
    return out;
  }

  /**
   * Turn every lorry arrival since the last frame into a delivery: one token
   * of that depot's cargo on the board, one "+N" over the Factory.
   *
   * L1c (#234): with the new loop on your seat's arrivals are animation only —
   * the lorry still drives its route, but it lands no token and no "+N" (the
   * clock pays the cargo now). See the branch inside.
   */
  function collectDeliveries(t: number) {
    // MP-05: a lorry reaching a factory on a guest's screen is animation, not
    // income — the host owns both seats' boards and their payouts.
    if (isGuest()) return;
    if (phase !== "play") return;
    const mine = ownerIdOf(eco, "you");
    for (const truck of trucks.trucks) {
      const seen = seenDeliveries.get(truck.depotId) ?? 0;
      seenDeliveries.set(truck.depotId, truck.deliveries);
      if (truck.deliveries <= seen) continue;
      const due = Math.min(truck.deliveries - seen, MAX_CATCHUP);
      if (truck.ownerId === mine) {
        // L1c (#234): under the new loop your lorries are ANIMATION — the
        // frame keeps driving them (they leave, arrive and turn around exactly
        // as before) but an arrival mints no token and credits nothing: the
        // clock pays. Their cargoes stay in `seenDeliveries` above so the
        // ledger cannot drift, and the RIVAL's lane below is untouched (#235
        // gives the rival the same clock on its own ticket).
        if (newLoop) continue;
        for (let i = 0; i < due; i++) deliverLoad(truck, t);
      } else if (truck.ownerId === rival.i + 1) {
        // AI-02: the rival's lorries DO feed its game — see rivalDeliverLoad.
        for (let i = 0; i < due; i++) rivalDeliverLoad(truck, t);
      }
    }
  }

  /** AI-03: the rival owns its OWN board now (same quarry, its own matches,
   *  self-paced at skill().moveMs — "he should have a board where he is
   *  slowly matching"), and (AI-03c) its lorries mint tokens on THAT board
   *  the way yours mint them on yours — the "where does the gold come from"
   *  answer, with a playlist: watch it in the peek panel (🏭).
   *  "every time his truck reaches his plant we see one gold icon when it
   *  should be grain??" — gold is never credited here; gold comes from
   *  gold tokens on its board, parity with the player's spawner. */
  function rivalDeliverLoad(truck: Truck, t: number) {
    for (const cargo of depotCargos(truck.depotId, t)) {
      const tier = rivalQuarry.deliver(cargo);
      // no token, no number — same rule as the player's own lorry (A1)
      if (!tier) continue;
      // half a tile down: when both lorries serve the same view the icon
      // columns no longer argue about who delivered.
      floats.add(`+${tier} ${CARGO[cargo].icon}`, truck.factory[0], truck.factory[1] + 0.45,
        { cls: "delivery", now: t });
    }
  }

  /** One lorry-load of cargo: mint the token, then show what it was worth. */
  function deliverLoad(truck: Truck, t: number) {
    for (const cargo of depotCargos(truck.depotId, t)) {
      const tier = quarry.deliver(cargo);
      // A1: no token, no number. An empty lorry must not promise a gem the
      // board never received.
      if (!tier) continue;
      if (cargo === "oil") onFirstOilHarvest();
      floats.add(
        `+${tier} ${CARGO[cargo].icon}`, truck.factory[0], truck.factory[1],
        { cls: "delivery", now: t },
      );
    }
  }

  // ══════════════════════ AI-03: save / restore / peek / new-game ════════
  // One JSON payload in localStorage, refreshed every few seconds and on
  // pagehide. The map is seed-derived, so only mutable state travels.

  function collectSave(): SaveGamePayload {
    const now = performance.now();
    const bandit: Record<number, number> = {};
    for (const ind of grid.industries) {
      if (ind.banditUntil > now) bandit[ind.id] = ind.banditUntil - now;
    }
    return {
      v: SAVEGAME_VERSION,
      snapV: SNAPSHOT_VERSION, // track layers share the MP wire format
      savedAt: Date.now(),
      seed, skillKey: skillKey, phase, winnerId: winner?.id ?? null,
      story: {
        playerSabotage,
        rivalSabotage: rivalSabotageHits,
        winningSource,
        oilBanterSeen,
      },
      bandit,
      protests: [...protests.values()].map((p) => ({
        x: p.tx, y: p.ty, left: Math.max(0, p.until - now), owner: p.owner,
      })),
      track: trackSave(track),
      // RAIL-04 (#178): the railway rides the save — a refresh must not take a
      // built line, its platforms or its train with it.
      rail: railToWire(rail),
      eco: { harvesters: eco.harvesters, factories: eco.factories },
      clearedFields: [...clearedFields],
      players: players.map((p) => ({
        purse: p.purse as unknown as Record<string, number>,
        freeTrack: p.freeTrack, freeDepots: p.freeDepots,
      })),
      boards: [
        { kind: "you", data: quarry.board.save() },
        { kind: "ai", data: rivalQuarry.board.save() },
      ],
      // live AI clocks START FRESH on load — a few seconds of drift is not
      // worth serialising a timer list for (the games feel identical).
      clocks: {},
    };
  }

  /** The autosave writer's handles — cleared in dispose so a dead game can
   *  never serialize its frozen world over a live save (contamination). */
  let saveIv = 0;
  let onPageHide: (() => void) | null = null;

  function saveNow() {
    if (disposed || restartArmed || savesOff) return;
    try {
      localStorage.setItem(saveKey, JSON.stringify(collectSave()));
    } catch { /* private mode / quota — saving must never break the game */ }
  }

  function applySave(d: SaveGamePayload) {
    // difficulty first: every pacing read below derives from it
    skillKey = d.skillKey as SkillKey;
    setRivalSkill(skillKey);
    trackRestored(track, d.track);
    // RAIL-04 (#178): restore the railway BEFORE the rescore below, so the
    // ★ ledger the restore rebuilds already knows about the platforms.
    if (d.rail) applyRailWire(rail, d.rail);
    else clearRail(rail);
    const now = performance.now();
    for (const [k, rem] of Object.entries(d.bandit)) {
      const ind = grid.industries.find((x) => x.id === Number(k));
      if (ind) ind.banditUntil = now + rem;
    }
    protests.clear();
    for (const p of d.protests ?? []) {
      protests.set(tIdx(p.x, p.y), { tx: p.x, ty: p.y, until: now + p.left, owner: p.owner });
    }
    // economy: replace the lists in place — their references are held all
    // over (planTrucks, syncWorld, the AI...)
    setClearedFields(d.clearedFields ?? []);
    eco.harvesters.length = 0;
    eco.harvesters.push(...d.eco.harvesters.map((h) => ({ ...h, facing: depotFacingOf(grid, h) })));
    eco.factories.length = 0; eco.factories.push(...d.eco.factories);
    for (let i = 0; i < players.length && i < d.players.length; i++) {
      Object.assign(players[i].purse, d.players[i].purse);
      players[i].freeTrack = d.players[i].freeTrack;
      players[i].freeDepots = d.players[i].freeDepots;
    }
    // VP is derived state and is intentionally absent from the save. Rebuild
    // its ledgers now (without UI events), or a restored final screen would say
    // 0★ despite showing the winning roads beneath it.
    score.paved.clear(); score.plants.clear(); score.vp.clear();
    rescore(eco, score, railPlatforms());
    for (const p of players) starFed.set(p.id, Math.floor(vpFor(score, p.id)));
    phase = d.phase as typeof phase;
    winner = d.winnerId
      ? (players.find((p) => p.id === d.winnerId) ?? null)
      : null;
    playerSabotage = Math.max(0, Math.floor(d.story?.playerSabotage ?? 0));
    rivalSabotageHits = Math.max(0, Math.floor(d.story?.rivalSabotage ?? 0));
    winningSource = d.story?.winningSource === "upgrade" || d.story?.winningSource === "plant" || d.story?.winningSource === "platform"
      ? d.story.winningSource as any
      : null;
    oilBanterSeen = d.story?.oilBanterSeen === true;
    for (const b of d.boards) {
      if (b.kind === "ai") rivalQuarry.board.restore(b.data);
      else quarry.board.restore(b.data);
    }
    // `Board.restore` mints fresh gem ids and fires no onChange, and the UI has
    // already painted the pre-save board by now — without this the screen kept
    // showing the OLD gems while clicks and drags acted on the restored ones.
    onBoardChange();
    // pacing clocks start clean — no catch-up bursts after a refresh
    lastHarvest = now; lastAi = now; lastRaid = now;
    lastOfferPost = now; lastRivalMove = now;
    // derive everything else: structures, torii, trucks, banners
    syncWorld();
    trucksDirty = true;
    toast("Game restored from your save — you are right where you left it.", "good");
    if (phase === "won" && winner) presentEnding(winningSource);
    // paintUi runs on the next frame — no explicit UI flush needed here.
  }

  if (bootSave) applySave(bootSave);

  // autosave: cheap, and it must never be able to break the frame loop.
  // The interval AND the listener live exactly as long as this game — a
  // disposed game must never write its frozen world into the save the next
  // mount would happily resume (cross-contamination, caught headless).
  // MP-05: a networked match is not saved. `savesOff` already blocks the write
  // (see `saveNow`), and skipping the timer entirely keeps a hosted match from
  // queueing work nobody asked for.
  if (!isMp()) {
    saveIv = window.setInterval(() => saveNow(), 5_000);
    onPageHide = () => saveNow();
    window.addEventListener("pagehide", onPageHide);
  }

  // ══ AI-03 (as revised by SETTINGS-01 / GFX-01 / MP-AUDIT): top-bar right ══
  // 🏭 watch the rival's plant — both seats since #105 synced the guest's
  //   view of the host's plant through the board wire;
  // ☰ the menu — which replaces AI-03's solo-only ↻. One door for the whole
  //   back room: Settings (the sheet the main menu also opens), How to Play
  //   (the ❔ reference card's own modal), New Game (the ↻ flow verbatim, and
  //   still solo-only — a room's match belongs to its session, not to a
  //   reload), and Quit to main menu (offered only when the surface that
  //   booted the match passed `onQuitToMenu`). It sits at the far right of
  //   the bar — where ↻ stood, beside the rival's plant — as asked.
  const topRight = ui.el.querySelector<HTMLElement>(".top-right");
  // The sheet handle and the menu's teardown live at function scope so the
  // dispose closure below can reach them (the listeners ride on `document`).
  let settingsView: SettingsSheetHandle | null = null;
  /** #121: at most one question stands at a time — a repeat click on a
   *  destructive door must not stack a second plate over the first. */
  let confirmView: ConfirmSheetHandle | null = null;
  let menuTeardown: (() => void) | null = null;
  if (topRight) {
    const peek = document.createElement("button");
    peek.type = "button"; peek.id = "iso-rival-peek";
    peek.className = "icon-btn"; peek.innerHTML = HUD_ICONS.binoculars;
    peek.title = "Watch the rival's plant — its board plays itself";
    peek.addEventListener("click", () => toggleRivalPlantView());
    // MP-AUDIT (#105): the peek panel is for BOTH seats now — the host reads
    // its local rivalPlant record; a guest follows the host's plant through
    // the synced board (`rivalQuarry`). (This gate used to be host-only.)
    topRight.appendChild(peek);

    const menuBtn = document.createElement("button");
    menuBtn.type = "button"; menuBtn.id = "iso-menu-btn";
    menuBtn.className = "icon-btn"; menuBtn.textContent = "☰";
    menuBtn.title = "Menu — settings, how to play, quit";
    menuBtn.setAttribute("aria-haspopup", "menu");
    menuBtn.setAttribute("aria-expanded", "false");

    const pop = document.createElement("div");
    pop.id = "iso-topmenu";
    pop.className = "iso-topmenu hidden";
    pop.setAttribute("role", "menu");
    const popHead = document.createElement("div");
    popHead.className = "tm-head";
    const popTitle = document.createElement("b");
    popTitle.textContent = "Menu";
    const popClose = document.createElement("button");
    popClose.type = "button"; popClose.className = "tm-close";
    popClose.title = "Close"; popClose.dataset.sfx = "close";
    popClose.textContent = "✕";
    popHead.append(popTitle, popClose);
    pop.appendChild(popHead);

    let menuOpen = false;
    const setMenu = (on: boolean) => {
      menuOpen = on;
      pop.classList.toggle("hidden", !on);
      menuBtn.setAttribute("aria-expanded", String(on));
    };
    const menuItem = (label: string, hint: string, onPick: () => void) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "tm-item"; b.setAttribute("role", "menuitem");
      b.dataset.sfx = "click";
      const sp = document.createElement("span"); sp.textContent = label;
      const sm = document.createElement("small"); sm.textContent = hint;
      b.append(sp, sm);
      b.addEventListener("click", () => { setMenu(false); onPick(); });
      pop.appendChild(b);
    };
    popClose.addEventListener("click", () => setMenu(false));

    // Settings — THE sheet (iso/settings-sheet.ts), the same projector the
    // front door raises over the menu plate, mounted over the game root. One
    // instance at a time; closing repaints nothing here because every control
    // in the sheet subscribes to the store, and so does the game.
    menuItem("Settings", "texture detail · miniature · performance · sound", () => {
      if (settingsView) return;
      const view = showSettingsSheet(ui.el);
      settingsView = view;
      void view.promise.then(() => { if (settingsView === view) settingsView = null; });
    });
    menuItem("How to Play", "the reference card, eight rules", () => ui.showHelp());
    /**
     * #121: one destructive ask, as a painted plate. A double click cannot
     * stack a second question (the plate's backdrop covers the ☰ that opened
     * it), and the handle is tracked so the menu's teardown closes it rather
     * than orphaning it over a dead board.
     */
    const ask = (o: ConfirmSheetOptions): Promise<boolean> => {
      if (confirmView) return Promise.resolve(false);
      const view = showConfirm(ui.el, o);
      confirmView = view;
      return view.promise.then((ok) => {
        if (confirmView === view) confirmView = null;
        return ok;
      });
    };
    // MOBILE-01: on a coarse pointer the top bar sheds its 🎯 and Aa keys to
    // fit a thumb (styles.css ≤480px), so their actions move in here — the
    // same closures the top bar and the floating cluster call.
    if (coarsePointer()) {
      menuItem("Recenter Map", "jump back to your Factory", recenterCamera);
      menuItem("Names Over The Map", "show or hide the place tags", toggleNames);
    }    if (isSolo()) {
      // MP-05 unchanged: a RESTART is solo-only, in a room the session owns
      // the match. The confirm-and-clear flow is AI-03's verbatim.
      menuItem("New Game", "clears the save and the difficulty pick", () => {
        void ask({
          title: "Start a new game?",
          body: "The save and your difficulty pick are cleared.",
          confirmLabel: "Start over",
          danger: true,
        }).then((ok) => {
          if (!ok) return;
          restartArmed = true; // do NOT let the pagehide autosave re-write the save
          clearSave(saveKey);
          try { localStorage.removeItem(SKILL_STORAGE_KEY); } catch { /* private mode */ }
          location.reload();
        });
      });
    }
    if (opts.onQuitToMenu) {
      menuItem(isSolo() ? "Quit to Main Menu" : "Leave Room",
        isSolo() ? "the match stays saved — Continue resumes it" : "the other seat is told you left",
        () => {
          // A solo quit is plain navigation (the save holds the match); a
          // room's quit strands the far seat, so that one confirms — and the
          // confirm is the sheet, because a native `window.confirm` is
          // answered `false` with nothing on screen inside a host frame that
          // sandboxes modals (#121: that silence was the whole bug report).
          if (isSolo()) { opts.onQuitToMenu?.(); return; }
          void ask({
            title: "Leave this room?",
            // RANK-01: a rated match says what leaving costs BEFORE it costs
            // it. The number itself is not in the copy — the arithmetic needs
            // the opponent's rating, and a confirm is no place for a
            // spreadsheet — but "filed as a loss" is the whole of the warning.
            body: rankRuntime
              ? "You return to the main menu and the other seat is told you left. This is a ranked match: leaving before the final star files it as a loss."
              : "You return to the main menu and the other seat is told you left.",
            confirmLabel: "Leave room",
            danger: true,
          }).then((ok) => {
            if (!ok) return;
            // RANK-01: the room will file this seat's loss the moment the seat
            // empties, and the leaver will never see that message — it is
            // leaving. So the leaving seat applies its own loss here, from the
            // same board the survivor's side uses, and the two land on the
            // same number. `phase === "won"` is excluded: the match is
            // decided, nothing is forfeited.
            if (rankRuntime && !endingShown) void rankRuntime.fileOwnForfeit(wireIdOf(rival));
            opts.onQuitToMenu?.();
          });
        });
    }

    topRight.appendChild(menuBtn);
    ui.el.appendChild(pop);
    // The one listener the whole menu hangs on: the button toggles its
    // popover. (onDocDown will NOT fight it — its target is inside menuBtn.)
    menuBtn.addEventListener("click", () => setMenu(!menuOpen));
    const onDocDown = (e: Event) => {
      const t = e.target as Node;
      if (menuOpen && !pop.contains(t) && !menuBtn.contains(t)) setMenu(false);
    };
    const onDocKey = (e: KeyboardEvent) => {
      if (!menuOpen) return;
      // Escape belongs to the menu while it is open — swallow it so the tool
      // cancel does not double-fire on the same key.
      if (e.key === "Escape") { e.stopPropagation(); setMenu(false); }
    };
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onDocKey, true);
    menuTeardown = () => {
      document.removeEventListener("pointerdown", onDocDown, true);
      document.removeEventListener("keydown", onDocKey, true);
      settingsView?.destroy();
      settingsView = null;
      // #121: a question still standing when the game dies must die with it —
      // destroy() answers `false`, so the half-clicked door never runs either.
      confirmView?.destroy();
      confirmView = null;
    };
  }

  function toggleRivalPlantView() {
    const open = getRivalView();
    if (open) { open.close(); rivalBoardView = null; return; }
    const el = document.createElement("div");
    el.id = "iso-rival-view";
    const head = document.createElement("header");
    const title = document.createElement("b");
    title.textContent = `${rival.name}'s processing plant`;
    const statusEl = document.createElement("span");
    statusEl.className = "rb-status";
    const purseEl = document.createElement("div");
    purseEl.className = "rb-purse";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button"; closeBtn.textContent = "✕";
    closeBtn.className = "rb-close";
    closeBtn.addEventListener("click", () => toggleRivalPlantView());
    head.appendChild(title); head.appendChild(statusEl); head.appendChild(closeBtn);
    const grid = document.createElement("div");
    grid.className = "rb-grid";
    el.appendChild(head); el.appendChild(purseEl); el.appendChild(grid);
    ui.el.appendChild(el);

    const H = rivalBoard.grid.length, W = rivalBoard.grid[0]?.length ?? 0;
    grid.style.gridTemplateColumns = `repeat(${W}, 24px)`;
    const cells: HTMLElement[][] = [];
    for (let r = 0; r < H; r++) {
      const row: HTMLElement[] = [];
      for (let c = 0; c < W; c++) {
        const cell = document.createElement("div");
        cell.className = "rb-cell";
        grid.appendChild(cell); row.push(cell);
      }
      cells.push(row);
    }
    const paint = () => {
      const st = rivalPlant.status(performance.now());
      const bits: string[] = [];
      if (st.frozen) bits.push(`❄ ${st.frozen} frozen`);
      if (st.girders) bits.push(`🏗 ${st.girders} girders`);
      if (st.smog) bits.push("☁ smogged");
      statusEl.textContent = bits.length ? " · " + bits.join(" · ") : " · healthy";
      // AI-03: the rival's purse, per cargo — "where is all that gold coming
      // from?" is answered by watching it move against the board above.
      purseEl.innerHTML = (CARGOES as Cargo[])
        .map((k) => `<span class="rb-chip">${cargoIconHtml(k)}&nbsp;${rival.purse[k] ?? 0}</span>`)
        .join("");
      for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
        const g = rivalBoard.grid[r]?.[c] ?? null;
        const cell = cells[r]?.[c];
        if (!cell) continue;
        if (!g) { cell.style.background = "transparent"; cell.textContent = ""; cell.title = ""; cell.style.boxShadow = "none"; continue; }
        const R = RES[g.res];
        cell.style.background = `radial-gradient(circle at 35% 30%, ${R.c2}, ${R.c1})`;
        cell.style.boxShadow = g.tier ? `inset 0 0 0 2px ${R.ring}` : "none";
        cell.textContent = g.block ? "🏗" : g.hard > 0 ? "❄" : g.special ? "💣" : g.tier === 2 ? "◆" : g.tier === 1 ? "◇" : "";
        cell.title = `${R.name}${g.tier ? ` tier ${g.tier}` : ""}${g.hard ? " (frozen)" : ""}${g.block ? " (girder)" : ""}`;
      }
    };
    paint();
    const iv = window.setInterval(paint, 350);
    rivalBoardView = { paint, close: () => { window.clearInterval(iv); el.remove(); } };
  }

  // ── Protests on the map ──────────────────────────────────────────────────
  // The crowd is a TEMP png (`assets/protest.png`, transparent, ~1.5 tiles
  // wide) drawn straight onto the overlay canvas — above road, trucks and
  // previews — with the time left under it. It deliberately bypasses the
  // atlas: no cells.json surgery for placeholder art. Swap the file and the
  // crowd changes; `tools/make-protest-png.mjs` regenerates it.
  let protestImg: HTMLImageElement | null = null;
  /** Box of the temp png in world px — keep in lockstep with the generator. */
  const PROTEST_PNG_W = 96, PROTEST_PNG_H = 84;
  /** Crowd + countdown for every live protest, plus the armed-placement ghost. */
  function paintProtests(ctx: CanvasRenderingContext2D, cam: Camera, now: number) {
    if (!protestImg) return;
    const z = cam.zoom;
    const w = Math.max(1, Math.floor(PROTEST_PNG_W * z));
    const h = Math.max(1, Math.floor(PROTEST_PNG_H * z));
    const draw = (tx: number, ty: number, alpha: number, label: string | null) => {
      // Feet on the road: the png's bottom-centre lands on the tile diamond's
      // bottom vertex, the same ground point a truck drives over.
      const [wx, wy] = tileToScreen(tx + 1, ty + 1);
      const [bx, by] = worldToScreen(cam, wx, wy);
      if (bx < -w || by < -h - 24 * z || bx > cam.vw + w || by > cam.vh + h) return;
      ctx.globalAlpha = alpha;
      ctx.drawImage(protestImg!, Math.floor(bx - w / 2), Math.floor(by - h + 6 * z), w, h);
      ctx.globalAlpha = 1;
      if (label !== null) {
        ctx.font = `bold ${Math.max(10, Math.round(11 * z))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.75)";
        const lx = Math.floor(bx), ly = Math.floor(by + 4 * z) + 10;
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = "#ffd75a";
        ctx.fillText(label, lx, ly);
      }
    };
    for (const p of protests.values()) draw(p.tx, p.ty, 1, fmtProtestLeft(p.until - now));
    if (pendingProtest && hover && protestPlaceable(hover.tx, hover.ty)) {
      draw(hover.tx, hover.ty, 0.55, null);
    }
  }

  // ── boot ───────────────────────────────────────────────────────────────
  let raf = 0;

  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej; img.src = src;
  });

  /* ══ GFX-01 — pixel-detail loading ══════════════════════════════════════
   * The three shipped detail levels live in tables here so the SAME loader
   * serves boot (only ≤ cap) and a runtime preset change (fills in the newly
   * wanted level, prunes above it). `bitmapCache` de-dupes concurrent
   * requests for one URL; it is deliberately cleared for the levels being
   * pruned, so stepping DOWN actually frees the big ImageBitmaps instead of
   * pinning them through a resolved promise. */
  const monolithUrls = new Map<number, string>([[0.5, atlas05], [1, atlas1], [2, atlas2]]);
  const roadUrls = new Map<number, string>([[0.5, roads05], [1, roads1], [2, roads2]]);
  const sheetUrls = new Map<number, string>([[0.5, buildings05], [1, buildings1], [2, buildings2]]);
  const buildingsBase = `${import.meta.env.BASE_URL}assets/buildings/`;
  const bitmapCache = new Map<string, Promise<AtlasImage>>();
  const cachedLoad = (u: string): Promise<AtlasImage> => {
    let p = bitmapCache.get(u);
    if (!p) { p = load(u); bitmapCache.set(u, p); }
    return p;
  };
  /** Fill `store` with every detail level ≤ cap it is missing. */
  const capImages = (
    urls: Map<number, string>, store: Map<number, AtlasImage>, cap: number,
  ) => Promise.all(
    [...urls]
      .filter(([z]) => z <= cap && !store.has(z))
      .map(async ([z, u]) => { store.set(z, await cachedLoad(u)); }),
  );

  /**
   * Apply the EFFECTIVE RENDER POLICY (quality + performance mode) while the
   * game is live: load the atlas levels newly at or below the cap (monolith,
   * layer sheets, per-building PNGs, scenery, liveried trucks), the ground
   * textures (always, perf keeps them) and — only when decals are wanted —
   * the terrain decals; then re-aim the atlas cap, free everything above it,
   * install ground/decal art and repaint. Serialized through `detailApplying`
   * so a rapid toggle cannot interleave two half-applied states; every async
   * step re-reads the settings AFTER its awaits, so a stale load never
   * restores old terrain. A load failure leaves the CURRENT policy standing.
   */
  let detailApplying: Promise<void> = Promise.resolve();
  /** The performance flag the last COMPLETED apply installed (or null: none yet). */
  let appliedPerf: boolean | null = null;
  const applyRenderPolicy = (policy: RenderPolicy): Promise<void> => {
    detailApplying = detailApplying.then(async () => {
      const a = atlasRef;
      if (disposed || !a) return;
      const cap = policy.detail;
      const capChanged = a.detailCap !== cap;
      const perfChanged = appliedPerf !== policy.performance;
      if (!capChanged && !perfChanged) return;
      appliedPerf = policy.performance;
      const r = renderer;
      // PERF-01 new: ground textures stay even in perf mode; only decals are
      // skipped when policy.decals is false. So always fetch ground, conditionally decals.
      const wantDecals = policy.decals;
      let groundTex: Awaited<ReturnType<typeof loadGroundTextures>> | null = null;
      let decalTex: Awaited<ReturnType<typeof loadDecalImages>> | null = null;
      try {
        await Promise.all([
          loadGroundTextures(groundTextureUrls(cap)).then((t) => { groundTex = t; })
            .catch((err) => console.warn("[gfx] ground textures for this preset failed to load", err)),
          ...(wantDecals
            ? [
              loadDecalImages(cap).then((d) => { decalTex = d; })
                .catch((err) => console.warn("[gfx] decals for this preset failed to load", err)),
            ]
            : []),
          capImages(monolithUrls, a.images, cap),
          ...(a.layerImages.has("roads")
            ? [capImages(roadUrls, a.layerImages.get("roads")!, cap)] : []),
          ...(a.layerImages.has("buildings")
            ? [capImages(sheetUrls, a.layerImages.get("buildings")!, cap)] : []),
          loadBuildingLayers(a, buildingsBase, cap),
          loadScenerySprites(a, cap),
          loadVehicleLayers(a, cap),
          // RAIL-03 (#177): the railway's sixteen PNGs — same contract as the
          // lorries (eager glob, per-zoom, non-gating), so a quality change
          // fills the levels the new cap asks for and never re-fetches.
          loadRailwaySprites(a, cap),
        ]);
      } catch (err) {
        console.warn("[gfx] detail levels failed to load; keeping the current preset", err);
        return;
      }
      // PERF-01 stale-load guard: the settings moved again mid-fetch. The
      // change always enqueued its own task (the store notifies
      // synchronously), and THAT task applies the final state — this one
      // must not overwrite it with the tier it loaded.
      const now = renderPolicy(currentGraphics());
      if (disposed || now.quality !== policy.quality || now.performance !== policy.performance) return;
      if (r) {
        if (capChanged) r.setDetailCap(cap);   // caps the atlas, prunes, repaints
        r.setPerformanceMode(policy.performance);
        if (groundTex) r.setGround(groundTex);
        if (decalTex) r.setDecalImages(decalTex);
        buildMasks(a);
        buildBuildingMasks(a);
        r.recomputePad();
        r.invalidateAll();
      } else {
        a.detailCap = cap;
        a.pruneDetail();
      }
      for (const m of [monolithUrls, roadUrls, sheetUrls])
        for (const [z, u] of m) if (z > cap) bitmapCache.delete(u);
    });
    return detailApplying;
  };

  // Live wiring of the settings store: the ⚙ modal, `__iso.graphics()` and
  // any other subscriber all arrive here. The boot path below reads the same
  // store BEFORE loading, so a preset picked before the atlases fetched is
  // what those fetches honour. PERF-01: one change may move several policy
  // fields at once (performance mode caps the DPR, so the BACKING changes
  // too) — resize the layers, the camera and the miniature plate before the
  // next frame, or the old backing keeps drawing at the wrong scale until
  // some unrelated ResizeObserver event happens to fire.
  const gfxUnsub = subscribeGraphics((g) => {
    const p = renderPolicy(g);
    mini.setEnabled(p.miniature);         // effective: suppressed under performance mode
    resize();                             // unified boot + runtime DPR policy
    renderer?.setPerformanceMode(p.performance);
    void applyRenderPolicy(p);
  });
  mini.setEnabled(renderPolicy(currentGraphics()).miniature);
  /** What the boot loading below fetches — the preset at frame 0. A settings
   *  change while the loading screen is up is cosmetic until boot reads it;
   *  the overlay is in front of everything then anyway. */
  const gfxBoot = currentGraphics();
  const cap0 = QUALITY_MAX_DETAIL[gfxBoot.quality];
  // PERF-01: the boot policy. A performance-mode boot never fetches the
  // seamless ground textures or terrain decals (the flat scene does not use
  // them); the atlas tiers still follow the quality, because buildings and
  // roads are drawn textured at every quality.
  const policy0 = renderPolicy(gfxBoot);

  /** AI-03: keep moving lorries when a replan leaves their route identical.
   *  Merged by the stable depot id (the lorry's true identity since the W2
   *  audit): same route AND same per-segment paved flags → the lorry keeps
   *  its position (leg/t/reverse/lastAdvance) and drives on mid-crack.
   *  A genuinely changed route keeps only its deliveries tally (the work is
   *  done either way) and starts the new legs from the depot. New lorries
   *  are the plan's own; removed ones vanish — the ghost-truck erase a few
   *  lines below deals with their sprites. */
  function planTrucksTrucksMerge(prev: Truck[], next: Truck[]): Truck[] {
    const byDepot = new Map(prev.map((x) => [x.depotId, x]));
    return next.map((t2) => {
      const old = byDepot.get(t2.depotId);
      if (!old) return t2;
      t2.deliveries = old.deliveries;
      if (JSON.stringify(t2.route) === JSON.stringify(old.route)
          && JSON.stringify(t2.segFast) === JSON.stringify(old.segFast)) {
        // trucks integrate with dt, so position is the whole migration state
        t2.leg = old.leg; t2.t = old.t; t2.reverse = old.reverse;
      }
      return t2;
    });
  }

  (async () => {
    // GFX-01: only the detail levels the quality preset permits are fetched
    // at boot — `medium` never pays for the 2× sheets, `low` decodes nothing
    // finer than 0.5×. The URL imports still resolve (they are build-time
    // asset paths); they are simply not loaded into bitmaps.
    const images = new Map<number, AtlasImage>();
    await loading.track("atlas", capImages(monolithUrls, images, cap0));
    const atlas = new Atlas(manifestJson as unknown as Manifest, images);
    atlas.detailCap = cap0;
    buildMasks(atlas);
    if (disposed) return;

    // W-series: the roads and buildings blit from their own LAYER atlases
    // (assets/layers/, identical sprite rects), and the ground paints from
    // the seamless world-anchored textures. Both load in parallel with the
    // first frame — the renderer falls back to the monolithic atlas and flat
    // ground colours until they arrive, then invalidates everything.
    const roadsStore = new Map<number, AtlasImage>();
    const sheetsStore = new Map<number, AtlasImage>();
    const layersPromise = loading.track("layers", Promise.all([
      capImages(roadUrls, roadsStore, cap0),
      capImages(sheetUrls, sheetsStore, cap0),
      // PERF-01 new: ground textures always load, even in perf mode.
      loadGroundTextures(groundTextureUrls(cap0)),
    ]).then(([, , tex]) => {
      if (disposed) return;
      atlas.layerImages.set("roads", roadsStore);
      atlas.layerImages.set("buildings", sheetsStore);
      if (tex) renderer?.setGround(tex);
    }).catch((err) => {
      // Textures are an upgrade, never a gate: the flat-colour ground and the
      // monolithic atlas remain fully playable.
      console.warn("[w-series] layer art failed to load:", err);
    }));

    // Building layers (assets/buildings/): per-building PNGs that override
    // the shared sheet for the sprites they cover, placed free on their
    // footprints' centres. Parallel, non-gating — a missing manifest or a
    // failed sprite just keeps the sheet art for that building.
    // SCENERY art (assets/ground/decals/, assets/scenery/): the decal patches
    // and the tree sprites. Non-gating like every other art load — until it
    // lands the map is the plain meadow with no trees, which is playable.
    // PERF-01: the terrain DECALS are ground art — a flat-mode boot skips
    // them; the tree SPRITES are structures-layer art and still load.
    void loading.track("scenery", Promise.all([
      policy0.decals
        ? loadDecalImages(cap0)
        : Promise.resolve<DecalImages | null>(null),
      loadScenerySprites(atlas, cap0),
    ]).then(([decals, trees]) => {
      if (disposed) return;
      // PERF-01 stale-load guard, as on the layers path: a decal image only
      // installs while the textured policy still stands.
      if (decals && renderPolicy(currentGraphics()).decals) renderer?.setDecalImages(decals);
      if (trees) {
        // The tree defs just joined the sprite table, so the cull pad (max
        // footprint + tallest sprite) may have grown.
        renderer?.recomputePad();
      }
      renderer?.invalidateAll();
    }).catch((err) => {
      console.warn("[scenery] art failed to load:", err);
    }));

// TRUCK-BRAND art (assets/vehicles/): the eight liveried lorries — blue for
    // the player, red for the rival, four headings each. Installed into the
    // sprite table like the scenery, and just as non-gating: while this is
    // pending (or on a checkout without the PNGs) the legacy `truck_goods_*`
    // sheet cells draw every lorry, which is the same lorry unpainted.
    void loading.track("vehicles", loadVehicleLayers(atlas, cap0).then((n) => {
      if (disposed || !n) return;
      // The trucks are drawn from the structures layer every frame, so the new
      // defs only need the vehicle items re-derived — but invalidate anyway, the
      // same way the building layers do, so a paused/still frame updates too.
      renderer?.invalidateAll();
    }).catch((err) => {
      console.warn("[truck-brand] failed to load:", err);
    }));

    // Road materials, on their own promise. Both must decode before the style
    // is installed — a half-textured road network would look like a bug — but
    // nothing waits on them, and a failure keeps the flat palette, which is a
    // complete look rather than an error state.
    void loading.track("roads", Promise.all([load(asphaltTex), load(dirtTex)]).then(([asphalt, dirt]) => {
      if (disposed) return;
      renderer?.setRoadStyle({
        ...DEFAULT_ROAD_STYLE,
        paved: { ...DEFAULT_ROAD_STYLE.paved, image: asphalt },
        dirt: { ...DEFAULT_ROAD_STYLE.dirt, image: dirt },
        // #159: a town's blocks borrow the earth texture and are washed to the
        // town's own grey-brown by the painter, so the yards grain like made
        // ground beside the asphalt instead of looking like a second road.
        town: { ...DEFAULT_ROAD_STYLE.town, image: dirt },
      });
    }).catch((err) => {
      console.warn("[roads] material textures failed to load:", err);
    }));

    // RAIL-03 (#177): the railway art rides the boot beside the buildings and
    // the lorries. Non-gating by contract — a missing folder leaves the vector
    // rail standing — and it lands as its own tracked job so the loading screen
    // reports it like every other layer.
    // With the railway flag down there is nothing to draw, so nothing loads.
    if (railAvailable) void loading.track("railway", loadRailwaySprites(atlas, cap0).then((n) => {
      if (disposed || !n) return;
      // A late-landing def can be TALLER than anything the cull pad was built
      // against, and the sprite table just changed: re-sync and re-pad, exactly
      // like the building layers above.
      syncWorld();
      renderer?.recomputePad();
      renderer?.invalidateAll();
    }).catch((err) => {
      console.warn("[railway] art failed to load:", err);
    }));

    void loading.track("buildings", loadBuildingLayers(atlas, buildingsBase, cap0).then((n) => {
      if (disposed || !n) return;
      // TOWN-GRID: the layers also bring the real FOOTPRINTS with them (a
      // town cell can be 2x2), and the town draw items were built against the
      // sheet's 1x1 defs. Re-sync so `townBuildings` re-lays each settlement
      // on its house blocks — without this the 2x2 towers stay anchored on
      // single tiles and hang over the streets.
      syncWorld();
      // B-3.2: the layers just MUTATED sprite w/h (a per-building PNG can
      // out-tall the tallest sheet sprite), so the constructor-time cull pad
      // is stale — tall buildings would pop at the screen edge.
      renderer?.recomputePad();
      renderer?.invalidateAll();
    }).catch((err) => {
      console.warn("[building-layers] failed to load:", err);
    }));

    atlasRef = atlas;
    renderer = new IsoRenderer(canvases, atlas, cam, world);
    renderer.setDecals(scenery);
    // PERF-01: the boot policy's terrain, applied before the first frame —
    // a performance-mode boot draws the flat static ground from frame one
    // (the dpr cap above already sized the backing for it). The apply chain
    // starts believing the same state, so a later quality-only change diffs
    // against boot rather than re-applying the performance leg.
    renderer.setPerformanceMode(policy0.performance);
    appliedPerf = policy0.performance;
    renderer.overlayPainter = (ctx, c, t) => paintProtests(ctx, c, t);
    // QoL: the placement overlay animates (a breathing outline, a marching
    // reach band, a ghost that floats). A player who asks the OS to reduce
    // motion gets the identical overlay frozen at its resting frame — the
    // stylesheet already does this for the HUD, this is the canvas half.
    syncOverlayMotion();
    void loading.track("protest", load(protestArt).then((img) => { protestImg = img; }).catch(() => {}));
    debug?.attachRenderer();
    enableRenderLogOnBoot();
    resize();
    syncWorld();
    void layersPromise;

    let lastFrameT = 0;
    const frame = (t: number) => {
      if (disposed) return;
      // L1a (#232): the new loop's "sandbox-only" note waits until nothing
      // covers the map — a boot-time toast would fire under the loading
      // screen (z 95 over the toast lane's 55), a contract's briefing or the
      // tour and auto-dismiss unseen.
      if (loopToastPending && !loading.active && !storyView && !tutorialView) {
        loopToastPending = false;
        toast("The new loop is sandbox-only for now.", "info");
      }
      // RV-01: the lorries move in TILE units per millisecond, so the frame
      // needs a real dt (capped — a background tab must not teleport them).
      const dt = Math.min(100, Math.max(0, t - lastFrameT));
      lastFrameT = t;
      topUpDevPurse();
      economyTick(t);
      quarryTick(t);
      aiTick(t);
      // Rivalry idle wire: a Torvin saying / dad joke every so often, mid-game.
      rivalChitChat(t);
      advisorTick(t);
      // MP-05: protests are solo/host-only (buyBlack refuses guests, like the
      // rest of the Black Market), so the sweep is a no-op on a guest — it
      // runs unguarded rather than splitting the heartbeat below.
      if (protests.size > 0) expireProtests(t);
      // MP-05: the host's heartbeat — one small delta per `PUBLISH_MS`, full
      // state only when `buildPublish` says the delta would not fit (§5).
      publishNet(t);
      // MP-AUDIT: vehicle presentation parity — host simulates, guest renders host vehicles.
      if (!isGuest()) {
        if (trucksDirty) {
          trucks.trucks = planTrucksTrucksMerge(trucks.trucks, planTrucks(eco));
          // TRAFFIC-02: bounded trips — town-derived access nodes, host-only.
          // Retains unaffected trips on road edits (planCars checks revision).
          cars.cars = planCars(track, grid, cars.cars, carCount, seed);
          trucksDirty = false;
          // AI-03: the replan no longer resets driving lorries — see
          // planTrucksTrucksMerge just above trucksTick. seenDeliveries is
          // keyed by the stable depot id, so the ledger survives every replan.
          quarry.setTruckServed(truckCargos(trucks.trucks, t));
          rivalQuarry.setTruckServed(truckCargos(trucks.trucks, t, "ai"));
          // a vanished truck must not linger as a ghost on the structures layer
          renderer?.setWorld(world);
        }
        // Protests hold lorries before the blocked tile — the set is rebuilt per
        // frame only while a protest stands (usually it is undefined: no crowd,
        // no cost, no behaviour change).
        tickTrucks(trucks, dt, protests.size > 0 ? new Set(protests.keys()) : undefined);
        // TRAFFIC-01: the ambient cars roll on the same frame, host/solo only.
        tickCars(cars, dt, track, grid, seed);
      } else {
        // Guest: vehicles are host-authoritative — already synced via snapshot/delta,
        // just ensure world.vehicles reflects the synced state (applied in delta handler)
        // No ticking, no replan.
      }
      // RAIL-04 (#178): the trains advance on the same frame as the lorries.
      // BOTH seats run this: the state machine is a pure function of the shared
      // rail state, so a guest renders the host's trains without a new wire
      // field — while the SERVICE verdict, which is what the economy pays, is
      // the host's alone (`railServicedIndustries` reads the host's state).
      tickTrains(rail, dt);
      collectDeliveries(t);

      // WASD camera pan: held keys integrate at a constant world speed per
      // frame (dt-capped like the lorries), ÷zoom so the map glides at the
      // same on-screen speed at every zoom step. `panBy` clamps to the map.
      if (panKeys.size > 0 && renderer) {
        let dx = 0, dy = 0;
        // The keys move the CAMERA: `cam.x/y` is the world's screen offset, so
        // looking left (A) slides the world right (+x), and so on.
        if (panKeys.has("a")) dx += 1;
        if (panKeys.has("d")) dx -= 1;
        if (panKeys.has("w")) dy += 1;
        if (panKeys.has("s")) dy -= 1;
        if (dx !== 0 || dy !== 0) {
          const step = (PAN_SPEED * (panShift ? 2 : 1) * dt) / 1000 / cam.zoom;
          cam = panBy(cam, dx * step, dy * step);
          renderer.setCamera(cam);
        }
      }

      // TRAFFIC-01: trucks and ambient cars share the vehicles list — one
      // depth-sorted pass draws both, and culling treats them identically.
      // TRUCK-BRAND: the atlas decides whether a lorry wears a livery — the
      // branded sprites only exist once `loadVehicleLayers` has installed them
      // (see below), and until then every truck draws the legacy goods cell.
      world.vehicles = carItems(cars)
        .concat(truckItems(trucks, atlasRef ?? undefined))
        .concat(trainItems(rail, atlasRef ?? undefined));
      const { items, ghost } = overlayFrame();
      renderer!.render(t, items, ghost);
      mini.paint();
      floats.frame(t);
      // NAMES: re-anchor the name tags to the live camera (no-op while the
      // Names button has them hidden).
      labels.frame();
      paintUi(t);
      raf = requestAnimationFrame(frame);

 
    };
    raf = requestAnimationFrame(frame);
  })().catch((err) => {
    // The base atlas is the one gating load: without it the dependent loads
    // never register, so settle them all rather than leave the bar hanging.
    loading.finish();
    ui.toast(`Failed to load art: ${err}`, "bad");
  });

  // expose for e2e (mirrors the existing window.__hex hook)
  (window as unknown as Record<string, unknown>).__iso = {
    get phase() { return phase; },
    get tool() { return tool; },
    /** L1a (#232): the new-loop feature flag, read-only — it is a boot fact
     *  (`opts.newLoop`, or dev-only `?loop=new`; never on in production, in a
     *  room or in a story contract). */
    get newLoop() { return newLoop; },
    /** LOAD-01: true while the loading screen covers the map. */
    get loading() { return loading.active; },
    /**
     * #136: the boot art loads' SETTLE state — the question `loading` above
     * cannot answer. `loading` reports the OVERLAY, which is false before
     * `show()` ever mounts it (everything can settle first) and true through
     * its fade-out, so "the overlay is down" is not "the art finished".
     * `ready` is that: every task handed to `loading.track()` — "atlas",
     * "layers", "buildings", "scenery", "vehicles", "roads", "protest" — has
     * settled. An asset-completeness assertion waits on THIS, because
     * `loadBuildingLayers` installs each sprite as its own parallel image
     * loads land: a non-empty `buildingImages` is a start signal, not an end
     * one. `done`/`total` are the failure message when it never settles (and
     * `active` stays available for the overlay question).
     */
    get artLoad() { return { active: loading.active, ready: loading.ready, ...loading.progress }; },
    /**
     * GFX-01 / PERF-01: the video settings. `__iso.graphics()` reads them;
     * `__iso.graphics("medium")` / `__iso.graphics(undefined, true)` (the
     * second argument is the miniature tilt-shift) / `__iso.graphics(undefined,
     * undefined, true)` (the third is performance mode) apply them live
     * through the SAME store the ⚙ panel uses — persistence, the DPR
     * re-size and the repaint included.
     */
    graphics: (q?: Quality, miniature?: boolean, performance?: boolean) =>
      setGraphics({ quality: q, miniature, performance }),
    get vp() { return { you: vpFor(score, "you"), ai: vpFor(score, "ai") }; },
    /** VP-01: the target and the two numbers behind a player's total.
     *  AI-04: the target is the difficulty's line (5★ on easy), not a constant. */
    get vpTarget() { return winTarget(); },
    get vpRates() { return { upgrade: VICTORY.upgrade, plant: VICTORY.plant, platform: PLATFORM_VP }; },
    // RAIL-02 (#176): the breakdown includes the platform line, read from the
    // rail state like `rescoreNow` does — the twin must not report a total the
    // scoreboard would not.
    victoryOf: (who: string) => victoryBreakdown(eco, who, railPlatforms()),
    /** VP-01: how many of `who`'s tiles carry pave provenance (its score is
     *  this × `VICTORY.upgrade`, plus 1★ a plant). */
    pavedTiles: (who: string) => {
      const id = players.find((p) => p.id === who)?.i;
      if (id === undefined) return 0;
      let n = 0;
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          if (track.owner[tIdx(x, y)] === id + 1 && isUpgradedRoad(track, x, y)) n++;
        }
      }
      return n;
    },
    /** VP-01: run the rival's pave pass on demand (the AI turn's third action,
     *  exposed so a test can assert the pave without waiting on the clock).
     *  Atomic like the real turn: it rescores, so `vp.ai` is current after it. */
    rivalPave: () => {
      const ok = rivalPavePass();
      if (ok) { syncWorld(); rescoreNow(); }
      return ok;
    },
    /** VP-01: the "buy the Ore my paving wants" bank on its own, returning the
     *  number of exchanges made (0 means a guard refused: nothing paveable, the
     *  price already covered, or no cargo it could sell without starving the
     *  Depot plan). `aiTick` calls exactly this on a turn the pave pass was
     *  price-blocked, so the count is the rule under test without a clock. */
    rivalBank: () => rivalBankTowardPave(factoryOf("ai")!, performance.now()),
    /** VP-01: the rival's read of the scoreboard and the four numbers that
     *  follow from it — exposed so a playtest (or a test) can ask WHY a turn
     *  was spent the way it was without re-deriving the policy. */
    get rivalPace() { return rivalPaceNow(); },
    /** AI-01: the live difficulty (preset + knobs) and how to change it —
     *  the same call the top-bar selector makes. */
    get rivalSkill() { return skill(); },
    setRivalSkill: (key: SkillKey) => setRivalSkill(key, false),
    /** AI-01: run the rival's market-offer check on demand (cadence-gated),
     *  the test twin of the per-frame clock call. Returns true when an offer
     *  was actually posted. */
    rivalOffer: (now = performance.now()) => {
      const before = market.ctx.offers.length;
      rivalMarketOffer(now);
      return market.ctx.offers.length > before;
    },
    get purse() { return me.purse; },
    /**
     * #186: the seats, as the game holds them — id, name, whether a person is
     * on it, its purse and its ★. The two-seat purse check ("host and guest
     * purses match") and the AI-seat check both need to see BOTH seats, and
     * `purse` above is only ever the local one.
     */
    get players() {
      return players.map((p) => ({
        i: p.i, id: p.id, name: p.name, human: p.human,
        purse: { ...p.purse }, vp: vpFor(score, p.id),
      }));
    },
    /** #186: the rules this match booted with, and whether a machine holds the
     *  opponent seat. Both are boot facts — a test reads them to prove the
     *  room's settings reached the game rather than inferring it. */
    get matchSettings() { return settings; },
    get aiSeat() { return aiOpponent; },
    get harvesters() { return eco.harvesters; },
    get factories() { return eco.factories; },
    get freeTrack() { return me.freeTrack; },
    /**
     * ART-1950S (TICKET-B0): every sprite with per-zoom art installed in
     * `Atlas.buildingImages` — the sprites whose art overrides the shared
     * sheet. e2e asserts against this instead of sniffing network responses
     * (a 200 on the manifest alone does not prove a layer landed), and the
     * B4 dead-art audit reuses it. Empty array = everything is drawing from
     * the shared buildings sheet (the non-gating fallback).
     *
     * #136: this list is a deliberate SUPERSET of the buildings manifest —
     * scenery-art.ts (trees) and vehicle-art.ts (liveried lorries) install
     * through the same table — so neither its length nor its first non-empty
     * moment says anything about whether assets/buildings/ finished loading.
     * Completeness checks read `buildingLayers` below instead.
     */
    get buildings() { return atlasRef ? [...atlasRef.buildingImages.keys()] : []; },
    /**
     * #136: what the per-building PNG pass installed, per sprite AND per zoom
     * tier — the shape an asset-completeness check actually needs. `buildings`
     * above can answer "is farm in the table" but not "does farm hold its 1×
     * layer", and counting the table measures three features at once.
     * `tiers` maps each installed sprite to the sorted zoom levels it holds
     * (0.5 / 1 / 2), `cap` is the GFX-01 detail cap the boot loaded under —
     * the highest tier anything could have fetched — and `quality` the preset
     * that produced it, so a spec can pin the tiers it expects instead of
     * demanding @2x from a medium-quality boot. `null` before the atlas
     * exists.
     */
    get buildingLayers() {
      const a = atlasRef;
      if (!a) return null;
      const tiers: Record<string, number[]> = {};
      for (const [name, byZoom] of a.buildingImages) tiers[name] = [...byZoom.keys()].sort((x, y) => x - y);
      return { cap: a.detailCap, quality: currentGraphics().quality, tiers };
    },
    /**
     * ART-1950S (TICKET-B4): every sprite name the renderer actually blitted
     * this session (industries, depots, town houses, roads, dirt, trucks,
     * extras — ground tiles are pattern-painted and never appear). The
     * dead-art audit unions this with the by-construction families to derive
     * deletion candidates; see docs/iso-debug-console.md and
     * tools/art-audit.mjs.
     */
    get drawnSprites() { return renderer ? [...renderer.drawnSprites] : []; },
    grid, track, eco,
    // ── J1: the quarry join, exposed so the boot test can prove the loop ──
    get board() { return quarry.board; },
    /** The rival seat's board — the one its autoplayer plays. */
    get rivalBoard() { return rivalQuarry.board; },
    /**
     * L4 (#218): the tuning session, as the HUD sees it — null when no session
     * is open (on the new loop that ALSO means the board is down). The game
     * holds a live record; this hands back a plain snapshot plus the two
     * derived numbers, so a test reads the same values the plate prints.
     */
    get tuning() {
      if (!tuning) return null;
      return {
        depotId: tuning.depotId, cargo: tuning.cargo,
        moves: tuning.moves, movesLeft: tuningMovesLeft(tuning), used: tuning.used,
        score: tuning.score, yield: tuningSessionYield(tuning),
        abandonYield: TUNING_ABANDON_YIELD,
      };
    },
    /**
     * L4 (#218): the plate's two keys, as twins — `tuningFinish()` closes the
     * session keeping the score (Finish), `tuningFinish(true)` abandons it
     * (the ✕). Both are the same call the DOM buttons make, so a test never
     * has to reach through the chrome to end a session.
     */
    tuningFinish: (abandon = false) => { closeTuningSession(abandon); },
    /** L4 (#218): every depot's yield level, by owner — the number the L1b
     *  clock multiplies by. `null` = no level stored (an untuned depot). */
    get depotYields() {
      return eco.harvesters.map((h) => ({ id: h.id, owner: h.owner, tx: h.tx, ty: h.ty, yield: h.yield ?? null }));
    },
    /** L4 (#218): the rival's tuning level sweep, on demand — the same call an
     *  AI turn makes, for tests that raise a rival depot by hand. */
    rivalTuning: () => { applyRivalTuning(); },
    get reach() { return quarry.reach; },
    /** AI-03 diagnostics: the rival's own quarry reach — the token gate its
     *  income depends on; empty while its depot↔factory road isn't attached. */
    get rivalReach() { return rivalQuarry.reach; },
    /** AI-03 diagnostics: the lorries the planner is running (depot ids +
     *  deliveries), so headless probes can see both seats' road income. */
    get trucksList() { return trucks.trucks.map((x) => ({ ...x })); },
    /* AI-03: the lorry clock's test twin — in the live game only the rAF
     * frame advances lorries (and delivery credits ride their arrivals), so
     * a headless harness that drives aiTick/econTick/tick saw an economy
     * without roads. Same integrator the frame calls, on demand. */
    truckTick: (now = performance.now(), dtMs = 1000) => {
      // MP-05: the twin mirrors the FRAME, so it inherits the frame's guest
      // rule — a guest runs no vehicle movement (§9).
      if (isGuest()) return;
      // includes the frame's replan step: headless tests have no rAF, and
      // without this branch a dirty world never receives lorries at all.
      if (trucksDirty) {
        trucks.trucks = planTrucksTrucksMerge(trucks.trucks, planTrucks(eco));
        cars.cars = planCars(track, grid, cars.cars, carCount, seed);
        trucksDirty = false;
        quarry.setTruckServed(truckCargos(trucks.trucks, now));
        rivalQuarry.setTruckServed(truckCargos(trucks.trucks, now, "ai"));
      }
      tickTrucks(trucks, dtMs, protests.size > 0 ? new Set(protests.keys()) : undefined);
      tickCars(cars, dtMs, track, grid, seed);
      collectDeliveries(now);
    },
    /** TRAFFIC-01 diagnostics: the ambient cars by NAME (car 1 / car 2 /
     *  car 3) with their live position, so headless probes and the perf
     *  dial can tell them apart while the art is still the lorry. */
    get traffic() {
      return cars.cars.map((c) => ({
        name: c.name, state: (c as any).state ?? "driving", loop: (c as any).loop ?? false, reverse: (c as any).reverse ?? false,
        leg: c.leg, t: Math.round(c.t * 1000) / 1000,
        routeTiles: c.route.length,
        originTownId: (c as any).originTownId ?? null,
        destTownId: (c as any).destTownId ?? null,
        origin: (c as any).origin ?? null,
        dest: (c as any).dest ?? null,
        fade: (c as any).fade ?? 1,
      }));
    },
    /** TRAFFIC-01 perf dial: set the ambient-traffic volume (0 clears the
     *  streets, 3 is the default "a few"). Replans from the live road
     *  surface immediately — no build needed to feel the cost. */
    setTraffic: (count: number) => {
      if (isGuest()) return [];
      carCount = Math.max(0, Math.min(64, Math.trunc(count) || 0));
      cars.cars = planCars(track, grid, cars.cars, carCount, seed);
      renderer?.setWorld(world);
      return cars.cars.map((c) => c.name);
    },
    quarry, market,
    /** A1: the rival's Processing Plant — where Black Market sabotage lands. */
    rivalPlant,
    /** PP-14b: the Black Market twin, exposed so the MP test can buy sabotage
     *  and prove it crosses the wire (buyBlack refuses on a guest, exactly as
     *  the click path does). */
    buyBlack: (key: string) => buyBlack(key),
    /** A1: the map floats currently on screen (deliveries + sabotage marks). */
    floats,
    /** NAMES: the map's name-tag layer (industries, towns, plants, depots). */
    labels,
    /** NAMES: the Names-button state — true = tags are shown over the map. */
    get showNames() { return showNames; },
    /** The 1-second build flashes currently on the map (texts only). */
    flashTexts: () => flashLayer.texts(),
    /** The WASD pan keys currently held (tests the camera input set). */
    get panKeys() { return [...panKeys]; },
    /** Refresh the reachable set now (spawn tokens for newly reached cargo). */
    refreshQuarry: (now = performance.now()) => quarry.refresh(now),
    /** Story test twin of the player's first successful Oil harvest. */
    firstOilHarvest: () => onFirstOilHarvest(),
    /** Story test twin of the idle wire: one Torvin saying / dad-joke exchange
     *  now, honouring the same solo + in-play gates the clock uses, but
     *  skipping the wait so a test can drive the exchange on demand. */
    chitChat: () => {
      if (!isSolo() || phase !== "play") return;
      playRivalryScene(nextBanterScene(), "banter");
    },
    /** The next Gold Mine warning, as `placeHarvester` will play it when the
     *  player stands a Depot beside a Gold Mine (test twin). */
    goldMineWarning: (): RivalryScene => nextGoldMineScene(),
    /** The e2e twin of clicking two adjacent gems in the Quarry panel — the
     *  same gate as the chrome's (L4: a session must be open, and a move is
     *  spent), so a test cannot play a board a player could not. */
    swap: (r1: number, c1: number, r2: number, c2: number) => requestBoardSwap(r1, c1, r2, c2),
    /** #187: the same seam the chrome's doors use — asking for the pointer
     *  CANCELS (tool, armed drag and placement ghost together), anything else
     *  arms. A test twin that assigned `tool` directly would leave the drag the
     *  real cancel clears, and the two paths would drift. */
    setTool: (t: Tool) => { if (t === "select") cancelPlacement(); else armTool(t); },
    // ── RAIL-04 (#178): the railway's test twins ──────────────────────────
    /**
     * RAIL-05 (#182): the LIVE rail state itself — the object the rules, the
     * renderer and the rival mutate. For tools that must run the shared rail
     * functions against the real world (the rail screenshot script plans a
     * line with `planRailMove`); `rail` below stays the plain-data summary.
     */
    get railState() { return rail; },
    /** The live rail state, read-only by convention (the twins below mutate). */
    get rail() {
      return {
        revision: rail.rail.revision,
        tiles: ownerRailTilesOf(rail, me.i + 1).length,
        structures: rail.structures.map((s) => ({
          id: s.id, kind: s.kind, ownerId: s.ownerId, tx: s.tx, ty: s.ty, view: s.view,
          anchor: s.anchor ? { kind: s.anchor.kind, id: s.anchor.id } : null,
        })),
        lines: rail.lines.map((l) => ({ id: l.id, ownerId: l.ownerId, name: l.name, source: l.source, dest: l.dest })),
        trains: rail.trains.map((t) => ({
          id: t.id, ownerId: t.ownerId, lineId: t.lineId, depotId: t.depotId,
          status: t.status, target: t.target, dist: t.dist, dwellMs: t.dwellMs,
          tile: trainTile(t), blockedWhy: t.blockedWhy ?? null,
        })),
      };
    },
    /** The heading the platform/depot tools place with (R in the live game). */
    get railView() { return railView; },
    setRailView: (v: string) => {
      if ((RAIL_VIEWS as readonly string[]).includes(v)) railView = v as RailView;
      return railView;
    },
    /** The rotation the Depot tool places in (R in the live game); null = the
     *  site's own default, the side away from the resource. */
    get depotView() { return depotView; },
    setDepotView: (v: string | null) => {
      depotView = v !== null && (DEPOT_FACINGS as readonly string[]).includes(v)
        ? v as DepotFacing : null;
      return depotView;
    },
    rotateDepot: () => rotateDepotView(),
    /** The Railway panel's rows, exactly what the UI paints. */
    railPanel: (who: "you" | "ai" = "you") =>
      railPanelRows(rail, who === "ai" ? rival.i + 1 : me.i + 1),
    /** The test twin of a rail drag (solo/host commits, a guest sends). */
    railDrag: (ax: number, ay: number, bx: number, by: number) =>
      requestRailBuild(ax, ay, bx, by, true),
    /** The test twin of clicking with the Platform / Train Depot tool. */
    placePlatform: (tx: number, ty: number, view?: string, who: "you" | "ai" = "you") => {
      const p = who === "ai" ? rival : me;
      const v = view && (RAIL_VIEWS as readonly string[]).includes(view) ? view as RailView : railView;
      if (who === "you" && isGuest()) {
        return net?.sendIntent("build", { do: "platform", tx, ty, view: v }) ?? false;
      }
      const held = railView;
      railView = v;
      const ok = placeRailPlatform(tx, ty, p);
      railView = held;
      return ok;
    },
    placeRailDepot: (tx: number, ty: number, view?: string, who: "you" | "ai" = "you") => {
      const p = who === "ai" ? rival : me;
      const v = view && (RAIL_VIEWS as readonly string[]).includes(view) ? view as RailView : railView;
      if (who === "you" && isGuest()) {
        return net?.sendIntent("build", { do: "raildepot", tx, ty, view: v }) ?? false;
      }
      const held = railView;
      railView = v;
      const ok = placeRailDepot(tx, ty, p);
      railView = held;
      return ok;
    },
    /** The test twin of the panel's Assign / Recall / Sell buttons. */
    railAssign: (sourceId: number, destId: number, who: "you" | "ai" = "you") =>
      railAssign(sourceId, destId, who === "ai" ? rival : me),
    railRecall: (trainId: number, who: "you" | "ai" = "you") =>
      railRecall(trainId, who === "ai" ? rival : me),
    railSell: (trainId: number, who: "you" | "ai" = "you") =>
      railSell(trainId, who === "ai" ? rival : me),
    /** #179: the test twins of the panel's Buy train / Start buttons, and a rename. */
    railBuy: (depotId: number, lineId: number, who: "you" | "ai" = "you") =>
      railBuy(depotId, lineId, who === "ai" ? rival : me),
    railStart: (trainId: number, who: "you" | "ai" = "you") =>
      railStart(trainId, who === "ai" ? rival : me),
    railRename: (lineId: number, name: string, who: "you" | "ai" = "you") =>
      railRename(lineId, name, who === "ai" ? rival : me),
    /** Advance the trains by hand — the headless twin of the frame's tick. */
    railTick: (dtMs = 1000) => { tickTrains(rail, dtMs); return rail.trains.length; },
    /** How many tiles of this seat's rail the layer holds. */
    railTiles: (who: "you" | "ai" = "you") =>
      ownerRailTilesOf(rail, who === "ai" ? rival.i + 1 : me.i + 1).length,
    /** PP-06: the test twin of clicking with the Processing Plant tool. */
    placePlant: (tx: number, ty: number, who: "you" | "ai" = "you") => {
      // MP-05: a guest's own placement is an intent; the "ai" twin stays a
      // local call, because that is how the HOST seats a remote player.
      if (who === "you" && isGuest()) return net?.sendIntent("build", { do: "plant", tx, ty }) ?? false;
      return placePlant(tx, ty, who === "ai" ? rival : me);
    },
    /** PP-06: every processing plant a player owns (starting Factory first). */
    plantsOf: (who: string) => plantsOf(eco, who),
    get plantCost() { return { ...PLANT_COST }; },
    /**
     * W8: the test twin of the setup click that places YOUR factory. It runs
     * the real `placeFactory`, including the rival-placement search, so the
     * tile the rival is handed can be asserted (and its builds driven) without
     * a pixel-driven pointer path. Returns false on illegal ground, exactly
     * like the click does.
     */
    placeFactory: (tx: number, ty: number) => {
      if (isGuest()) return net?.sendIntent("build", { do: "factory", tx, ty }) ?? false;
      return placeFactory(tx, ty);
    },
    /**
     * PP-05: the test twin of the Depot placement click — the real
     * `placeHarvester`, including the Oil cost, the free-setup allowance and
     * the "a refusal consumes nothing" ordering. Returns false when the site is
     * illegal OR the purse is short, exactly like the click does.
     */
    placeDepot: (tx: number, ty: number) => {
      if (isGuest()) return net?.sendIntent("build", { do: "depot", tx, ty }) ?? false;
      return placeHarvester(tx, ty, me);
    },
    /** PP-05: the live free-Depot allowance, so a test can watch it burn. */
    get freeDepots() { return me.freeDepots; },
    /** PP-05: what the next Depot placement will charge THIS purse — the same
     *  `priceDepot` the click, the HUD and the AI all read. */
    depotPrice: () => priceDepot(me.purse, me.freeDepots),
    /** V4: the e2e/unit twin of the HUD toast, so tests can drive the toast
     *  stack (and its ✕) without playing a whole round. */
    toast: (text: string, kind: Toast["kind"] = "info") => toast(text, kind),
    /** Screen position (device px, live camera) of a tile's drawn diamond
     *  centre — clicking it hits that tile (renderer.flatPick, N4). */
    tileScreenAt: (tx: number, ty: number) => tileToScreenAt(cam, tx, ty),
    /**
     * RAIL-05 (#182): the screenshot twin of panning and zooming by hand —
     * centre the camera on a tile, optionally at one of the zoom steps (the
     * same `zoomAt` the wheel uses, so the atlas swap and clamp still apply).
     */
    lookAt: (tx: number, ty: number, zoom?: number) => {
      if (zoom === 0.5 || zoom === 1 || zoom === 2) cam = zoomAt(cam, zoom, cam.vw / 2, cam.vh / 2);
      cam = centerOnTile(cam, tx, ty);
      renderer?.setCamera(cam);
      return { x: cam.x, y: cam.y, zoom: cam.zoom };
    },
    /**
     * E14: the live camera, so a test can report the zoom it picked a corridor
     * at instead of assuming the boot value.
     */
    get camera() { return cam; },
    /**
     * E14: what a pointer event at a CANVAS point (device px, the same space
     * `pos()` hands the click handlers) resolves to — literally
     * the two-stage hit-test plus the own-factory anchor normalisation a
     * track click goes through. The
     * corridor picker uses it to prove the tile it names is the tile a click at
     * that pixel selects, which is the only way to catch the "I clicked the
     * tile I could see and built on the one behind it" class of bug from a
     * screenshot. Returns null before the atlas/renderer exist.
     */
    pickAt: (sx: number, sy: number) => {
      const p = pickForAction(sx, sy);
      return p ? { tx: p.tx, ty: p.ty, sprite: p.sprite?.sprite ?? null } : null;
    },
    /**
     * E14/C5: the read-only legality answer for a tile, built from the SAME
     * rules the click handlers run (`buildRefusal` in track.ts, the harvester
     * checks in `placeHarvester`) — and with the REASON, so "I clicked and
     * nothing happened" is a one-call diagnosis instead of a read of game.ts.
     * The e2e corridor picker filters through this rather than re-deriving
     * WATER=1 from the outside.
     */
    tileProbe: (kind: TrackKind, tx: number, ty: number) => {
      const why = buildRefusal(grid, kind, tx, ty);
      const taken = eco.harvesters.some((x) => depotContains(x.tx, x.ty, tx, ty));
      const served = why === null && !taken
        ? industriesInCatchment(grid, { id: -1, owner: "you", ownerId: 0, tx, ty })
        : [];
      // PP-16: and every industry in reach has to be still free, or the tile is
      // not a Depot site. The probe answers with the CLICK's own code, so the
      // corridor picker can never plan a Depot the round would refuse.
      const locks = industryLocks(eco);
      const claimed = served.length > 0 && served.every((x) => locks.has(x.id));
      // PP-05: the probe also reports what the Depot would COST, priced by the
      // same `priceDepot` the click runs — so "is this tile usable" and "can I
      // pay for it" come from one module instead of the e2e tooling guessing.
      // `ok` stays a SITE-legality answer (the corridor picker filters on it
      // during setup, when the allowance covers the Depot); affordability is
      // reported alongside, never folded into it.
      const price = priceDepot(me.purse, me.freeDepots);
      return {
        build: { ok: why === null, why },
        harvester: {
          ok: why === null && !taken && served.length > 0 && !claimed,
          why: why ?? (taken ? "harvester-taken"
            : claimed ? "industry-taken"
            : served.length ? null : "no-industry-in-catchment"),
          industries: served.map((x) => x.id),
          /** the ones another Depot's network holds (PP-16) */
          held: served.filter((x) => locks.has(x.id)).map((x) => x.id),
          cost: { ...price.cost },
          free: price.free,
          affordable: price.affordable,
        },
      };
    },
    /**
     * PP-03: the e2e/unit twin of the placement overlay — the full
     * footprint/reach/validity plan for a Factory or Depot hover at (tx,ty),
     * built by the SAME module the frame overlay paints from (and the same
     * rules the click handlers run), so a test can assert the preview without
     * a pixel path.
     */
    placementPlan: (kind: "factory" | "depot", tx: number, ty: number): PlacementPlan =>
      kind === "factory"
        // PP-02 + AI-03c: the twin mirrors the live overlay AND the click —
        // the folded plan includes the built-world refusal the bare setup
        // plan never saw.
        ? factoryPlanForTool(tx, ty)
        : planDepotPlacement(grid, eco.harvesters, tx, ty, depotLocks()),
    /**
     * PP-03: the exact overlay items `renderer.drawOverlay` paints for a
     * placement hover at (tx,ty) under the live phase/tool — the tile list the
     * preview draws, ready to be diffed against the plan above.
     */
    overlayItemsFor: (tx: number, ty: number) => overlayItemsAt(tx, ty),
    /**
     * The transparent building preview the overlay draws for a placement hover
     * at (tx,ty): the sprite the click would place, its footprint origin, and
     * the plan's verdict (which picks the tint). Null for the tools that place
     * no building. Same source as `overlayItemsFor`, so the ghost and the grid
     * it stands on can never disagree.
     */
    ghostFor: (tx: number, ty: number): GhostSpec | null => overlayPlanAt(tx, ty).ghost,
    /**
     * RV-03: the tiles of the closest road route a DEPOT at (tx,ty) drives to
     * its factory, or null when that depot has no road connection. This is the
     * route the hover overlay paints and the truck drives, exposed so a test
     * can assert the path without a sprite path.
     */
    routeForDepot: (tx: number, ty: number) => {
      const h = eco.harvesters.find((x) => x.tx === tx && x.ty === ty);
      if (!h) return null;
      return roadRouteForHarvester(eco, h, buildAllComponents(track, h.ownerId));
    },
    /**
     * W1/W2: the e2e/unit twin of a track drag — the exact pointer path
     * (owned network check → preview with the free allowance → commit).
     * Returns the committed preview, or null when the drag can't start.
     */
    dragBuild: (kind: TrackKind, ax: number, ay: number, bx: number, by: number, xFirst = true): DragPreview | null =>
      // MP-05: the same seam the pointer path uses — commits on solo/host,
      // sends an intent on a guest.
      requestTrackBuild(kind, ax, ay, bx, by, xFirst),
    /**
     * W1/PP-15: the read-only half of `dragBuild` — the preview the pointer
     * drag WOULD compute, with nothing committed. The e2e corridor spec needs
     * it for its allowance accounting, because "how many tiles does this
     * corridor cost" is no longer "how many tiles are in the column": the
     * player's own buildings' ground is stepped over (PP-15). Deriving the
     * number here means the spec can never bake in a tile count or re-derive
     * the footprint from the outside — it reads the same preview the click
     * spends.
     */
    dragPreview: (kind: TrackKind, ax: number, ay: number, bx: number, by: number, xFirst = true): DragPreview | null => {
      if (phase !== "play") return null;
      if (!canBuildOn(grid, kind, ax, ay)) return null;
      return previewDrag(grid, track, kind, me.purse, ax, ay, bx, by, xFirst, undefined, me.freeTrack,
        structureTiles(eco.factories, eco.harvesters, me.i + 1), newLoop);
    },
    /**
     * PP-13: the e2e/unit twin of a demolish click — the same `doDemolish`
     * the pointer handler runs, so the road-salvage refund and the "that's a
     * public road" refusal are reachable from a test without a pixel path.
     */
    demolish: (tx: number, ty: number) => {
      if (isGuest()) { net?.sendIntent("demolish", { do: "demolish", tx, ty }); return; }
      doDemolish(tx, ty);
    },
    /** The Black Market twin of buying a Protest: arms it (or cancels). */
    armProtest: () => buyBlack("protest"),
    /** The map-click twin: stage the armed protest at (tx,ty). */
    placeProtest: (tx: number, ty: number) => placeProtest(tx, ty),
    /** #116: the Reset twin — exactly what the `.reset-btn` click runs. */
    resetPlant: () => resetPlant(),
    /** Every live protest (tile + expiry), for the overlay/painter tests. */
    get protests() { return [...protests.values()]; },
    get protestPending() { return pendingProtest; },
    /** The expiry sweep's test twin, with an injectable now. */
    protestTick: (now = performance.now()) => expireProtests(now),
    /** W3: the e2e/unit twin of the AI build clock, with an injectable now. */
    aiTick: (now = performance.now()) => aiTick(now),
    /** The per-frame harvest clock (the rival's passive income lives here). */
    econTick: (now = performance.now()) => economyTick(now),
    /**
     * The test twin of finishing the setup clicks (factory + first
     * harvester): it is what flips the game into `play`, which the AI and
     * economy clocks refuse to run before.
     */
    finishSetup: () => {
      phase = "play";
      lastHarvest = performance.now();
      lastAi = performance.now();
    },
    /** W6: the per-frame board+market clock, with an injectable now — the
     *  twin the Feed assertions drive (the rival answers inside market.tick). */
    tick: (now = performance.now()) => quarryTick(now),
    // C5: the visual-debug console — dumpTile / dumpAt / dumpBuilding /
    // dumpNetwork / overlay / config / probe. Spread only when the gate is on,
    // so a production build exposes nothing (see src/iso/debug.ts).
    ...(debug ? debug.commands : {}),
  };

  return () => {
    disposed = true;
    // #112/#115: a disposed game resolves nothing and leaves nothing armed —
    // the prompt timer dies (an old timer must never answer a newer prompt,
    // and a dead game must not resolve one at all), any open bounty chooser
    // comes down, and protest targeting is cleared.
    clearCrossTimer();
    pendingCross = null;
    if (isGuest()) __clearGuestCross();
    pendingProtest = false;
    loading.dispose();
    // GFX-01: the settings subscription and the composite layer die with the
    // game (the store itself persists — it is the PLAYER's setting, not this
    // match's state).
    gfxUnsub();
    mini.destroy();
    // SETTINGS-01: the ☰ menu's document listeners die with the game, and an
    // open sheet is destroyed rather than orphaned over a dead board.
    menuTeardown?.();
    menuTeardown = null;
    // #164: the departure sheet is torn down with the game (never orphaned
    // over a dead board), and a Leave that was waiting on a verdict is
    // cancelled — its timer must not fire into a disposed game.
    leftSheet?.destroy();
    leftSheet = null;
    leaveAfterVerdict = false;
    if (leaveAfterVerdictTimer) window.clearTimeout(leaveAfterVerdictTimer);
    leaveAfterVerdictTimer = 0;
    net?.dispose();
    window.clearInterval(saveIv);
    if (onPageHide) window.removeEventListener("pagehide", onPageHide);
    // The WASD camera keys: a disposed game must stop panning (and stop
    // remembering keys held over its head).
    window.removeEventListener("keydown", onKeydown);
    window.removeEventListener("keyup", onKeyup);
    window.removeEventListener("blur", onWindowBlur);
    // AI-03: the dead game must not keep overwriting the live save either;
    // last intact state stays — the interval was the only writer.
    endingView?.destroy();
    endingView = null;
    // TUT-01: the tour holds a document keydown listener, so it goes the same
    // way the ending ledger does — and destroying it settles its promise, which
    // is what stops the boot chain from awaiting a card that no longer exists.
    tutorialView?.destroy();
    tutorialView = null;
    storyView?.destroy();
    storyView = null;
    floats.clear();
    labels.clear();
    flashLayer.clear();
    cancelAnimationFrame(raf);
    ro.disconnect();
    root.classList.remove("iso-game");
    root.innerHTML = "";
  };
}