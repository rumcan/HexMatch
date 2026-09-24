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
// board owns gems, and neither keeps a balance. The old
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
// B2 (#247): the battle screen — a full-screen 1v1 over the map. The debug
// console's `startBattle` opens one against a placeholder opponent; B5 wires
// the map's challenge/sabotage doors into the same entry point.
import { startBattleScreen, openBattleScreen, type BattleScreenHandle } from "../game/battle-screen";
// B6 (#251): host-authoritative MP duels — validation, clock, forfeit, wire.
import {
  createDuel, applyPlayerMove, noteHumanMove, duelToWire, duelFromWire,
  duelClockTick, duelPresence, duelGraceTick, endByForfeit,
  type Duel, type DuelWire,
} from "../game/battle-mp";
import type { BattleMove, BattleSeat } from "../game/battle";
import { chooseBattleMove } from "./battle-ai";
// B5 (#250): the map's battle layer — challenges, conquests, fight-offs and
// the cooldowns that pace them (pure bookkeeping in battle-map.ts).
import {
  createChallengeState, canChallenge, canChallengeTown, markChallenge, markRivalChallenge,
  rivalChallengeDue, settleMapBattle, unlockTownHold,
  pickRivalChallengeTarget, challengeRefusalText, isComeback, hasOpenPlant,
  cheapestSale, applySale, listSales,
  type ChallengeState, type PendingFightOff, type MapBattleStake, type SaleOption,
} from "./battle-map";
import { BATTLE_RULES } from "./config";
import portraitYou from "../assets/ui/tycoon_you_small.png";
import portraitVex from "../assets/ui/tycoon_vex_small.png";


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
  FIELD_OCC, generateMap, grownTownHouses, resolveMapSeed, seedTownLevels, setTownLevel,
  TOWN_BLOCK, townBuildings, townForSeat, townGrownRings, townTier,
  tileInFootprint, townHouseAt, townObstacleTiles,
  type Grid, type Industry, type Town,
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
  buildAllComponents, resolveConnection, industryLocks, heldIndustries,
  lockedIndustryIdsFor,
  depotCargo, depotRoutePaved, isServiced, isRailDepot,
  pickBlockadeTarget, harvesterYield, depotPathLength,
  type EconomyState, type Factory, type Harvester,
} from "./economy";
// VP-01: the scoreboard lives in its own module now, because what it counts
// changed from "connections a player has made" to "tiles and plants a player
// has UPGRADED" — a different question about a different part of the state.
import {
  createScoreState, rescore, vpFor, hasWon, fmtVp, paveVp, vpDeltaText,
  victoryBreakdown, revokeCityStars,
  type ScoreState, type VpEvent, type LoopScoring,
} from "./victory";
import {
  aiBuildStep, chooseRivalFactorySpot, deepPlanCandidates, planBankTrades,
  planUpgrades, executePaves,
  paveCandidates, rivalPace, scoreCargoWant, treeGoal, treeWants, type RivalPace,
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
  CARGO, CARGOES, DEPOT_TREE, DEPOT_TREE_ORDER, DEPOT_RUNG_GATE, DEPOT_LEVELS, depotYieldCap, DEPOT_TIER_MAX, FACTORY_FOOTPRINT, FACTORY_SPRITE,
  INDUSTRY_BY_KEY, TRANSPORT, TOWN_UPGRADES, TOWN_TIER_LEGACY, TOWN_VISUAL_MAX,
  townCentreSprite, townTierLabel,
  BASE_RATE, VICTORY, VP_TARGET, UPGRADE_COST, TUNING,
  type Cargo, type Portrait,
} from "./config";
import {
  DEFAULT_FACING, DEPOT_FACINGS, DEPOT_SPRITES, depotContains, depotFacingOf, depotFacings,
  depotTiles, rotateFacing, type DepotFacing,
  industriesTouchingDepot,
} from "./depot";
import {
  depotRate, depotTransportTier, depotYield, distanceBandForPath, distanceFactorForPath,
  transportFactor,
} from "./loop";
// L8 (#222): the loop made legible — the objective line and the income
// readouts, as pure rules. game.ts feeds them the same numbers `economyTick`
// multiplies; ui.ts paints them. (ui.ts has carried the objective element and
// the chip rate since #287 — this is the wiring that fills them.)
import {
  depotReadout, incomeRates as loopIncomeRates, objectiveLine, type RateRow,
} from "./readouts";
// L8 (#222): the OPTIONAL quests — suggestions voiced by the match's cast,
// generated from this map and this seat, never a requirement. The rules are
// pure (`quests.ts`); this file owns which ones are on offer, what pays them,
// and the player's own "hide" / "dismiss" choices.
import {
  questDone, questHave, questOffers as questOffersFor, questProgressText, questReward,
  questText, selectQuests, speakerFor, speakerName, typesRunning,
  QUEST_OFFER_MAX, type QuestDef, type QuestSpeaker, type QuestView,
} from "./quests";
import { mulberry32 } from "../game/config";
// L4 (#218): the tuning session — the one thing that sets a depot's yield.
// The rules live in `tuning.ts` (pure, unit-tested); this file is where they
// meet the board, the depot record and the HUD.
// L5 (#219): …and where a finished session also opens the next rung of the
// depot tree / confirms a city upgrade (Addition A's gate).
import {
  abandonYieldFor, birthYieldFor, createTownSession, createTuningSession, decayYield,
  depotSessionOutcome, difficultyRulesFor, obstacleIntroLine, recordTuningCleared, retuneOwed,
  rivalTuningGold, rivalTuningScore, rivalTuningYield, settleTuningYield,
  sessionObstacles as sessionObstaclesFor, takeTuningMove, townBonusFor, tuningMovesLeft,
  unlockTierAfterSession, tuningOver, tuningSessionGold, tuningSessionYield,
  tuningStarLabel, tuningStarScores, tuningStarsFor,
  TUNING_ABANDON_YIELD, TUNING_REWARD_SCORE, type TuningOutcome, type TuningSession, type TuningStars,
} from "./tuning";
import {
  FREE_SETUP_DEPOTS, costCompact, costLabel, depotTypeLabel, DEPOT_UPGRADE_COST, DEPOT_RETUNE_COST,
  priceDepot, priceTownUpgrade, rungLabel, shortfallLabel, storageCapFor,
} from "./construction";
// L11 (#226): the bank — the one exchange left, and the rung gate it obeys.
// `bankAllowed` is what the HUD's selects ask too, so a locked cargo cannot be
// clicked and then refused: the button and the rule are the same question.
// L17 (#245): the bank is BACK at the town's middle building, at 3:1.
import { BANK_RATE, bankAllowed, bankTier, bankTrade, isCargo } from "./bank";
// TRADE (owner call, 2026-09): the offer board is back beside the bank.
import {
  createOfferBook, postOffer, acceptOffer, cancelOffer, expireOffers, liveOffers,
  rivalWouldAccept, chooseRivalOffer, offersToWire, offersFromWire,
  OFFER_REFUSAL_TEXT, RIVAL_TRADE_MS,
  type Offer, type OfferRefusal, type Seat,
} from "./offers";
import { toBag, type CargoBag } from "./purse";
import type { BoardObstacles } from "../game/board";
import {
  MAP_W, MAP_H, BANDIT_MS, PROTEST_MS, SABOTAGE, SECURITY,
  rand,
  tileToScreen, type ResKey,
} from "../game/config";
import { createQuarry, CARGO_TO_GEM, GEM_TO_CARGO, type Quarry } from "./quarry";
import {
  saveKeyFor, SAVEGAME_VERSION, OLD_SAVE_TOAST,
  loadRecentSave, clearSave, trackSave, trackRestored,
  loopCarryToWire, savedLoopCarry,
  type SaveGamePayload,
} from "./savegame-runtime";
import { RES } from "../game/config";
// L10 (#225): the rival's plant is a board you can WATCH (AI-03's peek panel)
// and nothing else. Its frost/girder/smog cards, the clocks that expired them
// and the damage model that scaled the rival's income by how wrecked the plant
// looked are all gone — obstacles belong to a tuning session now, and the
// rival's yield is docked by them once, in `rivalTuningYield`. One board, one
// name; the sabotage overlay that used to travel the wire for it went too.
import { createRivalPlant } from "./rival-plant";
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
  createRailState, railPreview, buildRail, demolishRail, structureAt, hasRail, railDrawLayer, railTileRefusal,
  placePlatform, placeDepot, platformRefusal, depotRefusal, resolveAnchor,
  RAIL_COSTS, RAIL_REFUSAL_TEXT, footprintTiles,
  railStructureItems, trainItems, autoTrains, layPlatformTrack, platformTrackAt, RAIL_DIAG, assignLine, renameLine, buyTrain, startLine, recallTrain, sellTrain, tickTrains,
  rotateView, trainOccupies, trainBasedAt, railPanelRows, canPay, costEntries, resaleValue, demolishStructure, PLATFORM_VP,
  footprintFor, depotExit, RAIL_VIEWS, trainTile, ownerRailTiles as ownerRailTilesOf,
  railToWire, applyRailWire, clearRail, railLayerPatch, copyRailLayer,
  type RailState, type RailView, type RailStructure,
} from "./rail";
import { loadRailwaySprites } from "./rail-art";
import { createOriginalUi, RAIL_TOOL_KEYS, type OriginalUi } from "../game/ui";
import { HUD_ICONS, cargoIconHtml, costMarkup } from "../game/hud-icons";
// #302: the six board-gem tokens, pre-decoded behind the loading screen.
import { GEM_ART } from "../game/gem-art";
// SFX-01: the UI sound layer. Everything the player DOES on the map (a road
// laid, a building raised, a demolition, a star earned, the final ledger) gets
// one cue from here; the chrome's own clicks and hovers are handled once, by
// the delegation `attachUiSound` installs. docs/SFX-01-ui-sound.md.
import { sfx } from "../audio/sfx";
// AI-02: the start-of-game difficulty prompt (see skill-picker.ts for the
// "when do we ask" contract: only when nothing has chosen yet).
import { promptForRivalSkill } from "./skill-picker";
import { createLoadingScreen, createRevealGate } from "./loading-screen";
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
import type { UiRivalryBeat, UiTuningResult } from "../game/ui";
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
  type Snapshot, type WirePlayer,
} from "./snapshot";
export { joinFromSnapshot };
// MP-05: the wire. `session.ts` owns roles/roster/chunked state transfer and
// never imports the SDK (transport.ts does); `protocol.ts` owns the message
// union; `delta.ts` owns the per-action patch format. game.ts is the only
// place that knows all three AND the game rules.
import { NetSession, type NetRole } from "../net/session";
import { applyTrackDelta } from "../net/delta";
import { HOST_LEFT_REASON, type ChatMsg, type DeltaMsg, type IntentMsg } from "../net/protocol";
// C1 (#255): the chat rules' shipped constants — the game knows the presets it
// shows and (for `__iso.chat`) the caps it can print, nothing more. Every rule
// lives in `../net/chat` and is applied by the session; there is no chat LOGIC
// in this file on purpose (the panel is #257).
import { CHAT_MAX_LEN, CHAT_PRESETS } from "../net/chat";
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
/**
 * L14 (#229): how far a Depot must cool below what a fresh session would set
 * before the rival spends a turn re-tuning it. One fifth is "visibly worse than
 * it was" — the point where a player reaches for the Re-tune key — and it keeps
 * a Hard rival's re-matches to roughly one turn in four instead of every turn.
 *
 * A constant rather than a skill lever on purpose: what a difficulty changes is
 * how fast a yield cools (`DIFFICULTY_RULES`) and how good its sessions are
 * (`tuningSkill`), not how the seat answers them. Exported because the race
 * harness mirrors the re-match (`tests/unit/helpers/race.ts`), and a harness
 * with its own threshold would measure a rival nobody ships.
 */
export const RIVAL_REMATCH_DROP = 0.2;
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
  /** Stable seat index — the wire, the save and the HUD all address a seat by
   *  it (L11 / #226: it used to route trade offers; those are gone). */
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
   *
   * L5 (#219): the setup allowance is type-blind (the map's own opening, see
   * `FREE_SETUP_DEPOTS`); the type gate below is what the allowance never
   * bypasses for a *paid* Depot.
   */
  freeDepots: number;
  /**
   * L5 (#219): the rungs of `DEPOT_TREE` this seat has unlocked — 0 at boot,
   * +1 per tuning session it actually played (`unlockTierAfterSession` in
   * tuning.ts). A Depot whose type sits above this is refused for
   * progression, before anything is priced or spent.
   */
  depotTier: number;
  /** L5 (#219): how many city upgrades this seat has bought. */
  townLevel: number;
  /**
   * L5 (#219): the base-rate bonus its city's tuning session set (0 while no
   * upgrade stands). `economyTick` multiplies every connected Depot's rate by
   * `1 + townBonus`, so one number scales a whole network.
   */
  townBonus: number;
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
   * run.world feedback (2026-09): the player's very first game. No tour, no
   * difficulty prompt (Normal, changeable in the top bar) — the coach teaches
   * the loop one step at a time instead.
   */
  firstRun?: boolean;
  /**
   * Owner call (2026-09): CONQUEST — no ★ line; the game ends only when a
   * player cannot go on (no open plant, no Gold for a challenge, nothing left
   * to sell). A resumed save keeps whatever mode it was saved in.
   */
  conquest?: boolean;
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

/**
 * L4 (#218) / L1f (#237): the sentence a placed setup Depot ends with. ONE
 * pair, exported, and the boot's own flag picks it — the new loop promises
 * the clock (a connected Depot ticks its cargo in on the clock), the retired
 * loop still sends the player to the always-on board's tokened gems. The
 * map-click path passes `newLoop` and nothing else.
 */
export function setupDepotToast(newLoop: boolean): string {
  return newLoop
    ? "Now connect it to your Factory with a Dirt Road — a connected Depot ticks its cargo in on the clock."
    : "Now connect it to your Factory with a Dirt Road or a paved Road — then match the tokened gems in the Processing Plant.";
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
  // Owner call (2026-09): railways are back in the build menu for playtesting
  // (Rail, Platform, Railway panel — trains spawn on their own, no depot).
  // `?rail=0` hides them again; `opts.rail` still wins for tests.
  const railAvailable = opts.rail ?? railParam !== "0";
  const loopParam = (() => {
    try { return new URLSearchParams(location.search).get("loop"); } catch { return null; }
  })();
  const newLoopRequested = opts.newLoop ?? loopParam !== "old";
  // The new loop is sandbox-only: a networked room or a story contract ignores
  // the request and says so — the toast waits until no boot overlay covers the
  // map (see the frame loop's `loopToastPending`).
  const newLoop = newLoopRequested && isSolo() && !storyOn;
  // Only someone who named the loop gets told a room or a contract refused it.
  // A default boot is not a refusal, it is the game, and every MP/story seat
  // would otherwise open with an apology for the loop it is correctly on.
  const newLoopAsked = opts.newLoop === true || loopParam === "new";
  let loopToastPending = newLoopAsked && !newLoop;
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
  // `?fresh=1` (owner testing, 2026-09): a first-time player's view — no save
  // is loaded and none is written, so the real slots are left untouched.
  const freshLink = (() => { try { return new URLSearchParams(location.search).get("fresh") === "1"; } catch { return false; } })();
  const savesOff = isMp() || freshLink || !!(window as unknown as Record<string, unknown>).__ISO_DISABLE_SAVE;
  // STORY-01 fix: each mode has its own save slot — the sandbox's, or this
  // contract's. A contract that read the sandbox save resumed that world (its
  // seed, the rival's network, phase "play") against the chapter's lower ★
  // line and lost on the first rescore.
  const saveKey = saveKeyFor(storyChapter?.id);
  const foundSave = savesOff ? null : loadRecentSave(Date.now(), saveKey);
  // L15 (#230): old saves (v1 / snap 15) are from a different game — refuse
  // with a clear message and keep the slot untouched so the toast is honest.
  // The new loop is the only loop now, so no save needs a flag to open.
  const rawSave = savesOff ? null : (() => { try { const r = localStorage.getItem(saveKey); return r ? JSON.parse(r) : null; } catch { return null; } })();
  const isOld = rawSave !== null && (rawSave.v !== SAVEGAME_VERSION || rawSave.snapV !== SNAPSHOT_VERSION);
  const bootSave = isOld ? null : foundSave;
  let saveToastPending = false;
  let oldSaveToastPending = isOld;
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
  // L17 (#245): a new-loop game opens with FOUR VILLAGES — small homes and
  // simple footprints, while their streets are already paved with sidewalks,
  // lamps and block ground. The seed-derived map never carries tiers
  // (`Town.level` stays absent = legacy), so this is the same kind of boot
  // stamp `seedTownRoads` is: a new-loop game assigns tier 0 and grows the
  // towns as upgrades confirm; the shipped loop, the rooms and the story
  // never touch `level`, and their towns keep today's streetscape.
  // A loaded save overwrites these below (`applySave` restores `towns`).
  if (newLoop) seedTownLevels(grid, 0);
  const score: ScoreState = createScoreState();

  // L5 (#219): every seat opens at rung 0 of the depot tree (the starter
  // cargos) with no city upgrade — `depotTier`/`townLevel`/`townBonus` are the
  // data the tree gate, the clock's base rate and the wire/save all read.
  const players: PlayerState[] = [
    { i: 0, id: "you", name: "You", colour: "#5aa8ff", purse: toBag(startPurse), human: true, freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS, depotTier: 0, townLevel: 0, townBonus: 0 },
    // STORY-01: a contract renames and recolours the rival seat — the dossier
    // cards, the scoreboard and the ending ledger all read this name, so the
    // whole HUD introduces whoever the chapter cast.
    // #186: both seats open on the room's purse — the settings are the ROOM's
    // rules, so a Rich game is rich for the guest and for the AI alike, and the
    // two purses can never disagree about what the host chose.
    { i: 1, id: "ai", name: storyChapter ? CAST[rivalCast].name : "Rival", colour: storyChapter ? CAST[rivalCast].colour : "#ff7a5a", purse: toBag(startPurse), human: false, freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS, depotTier: 0, townLevel: 0, townBonus: 0 },
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
  // build/idle clocks, expansion-per-turn, the pave batch, the raid cadence
  // and the sabotage switches. Because the turn itself is
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
  /**
   * L6 (#220): the ECONOMY half of the same choice, read live off the same key.
   *
   * One setting, two readers: the rival's pacing presets (`skill()` above) and
   * the row of `DIFFICULTY_RULES` that decides how a Depot's yield is mapped,
   * clamped and cooled. Nothing in the economy reads `skillKey` itself — it
   * reads these flags — which is what makes "all three difficulties share one
   * economy codepath" true rather than a claim: Easy gets no builder-only fork,
   * Hard gets no special case in `economyTick`, they get numbers.
   *
   * Live, not boot-pinned: flipping the difficulty moves the decay and the
   * re-match policy on the next tick, exactly as it moves the rival's clocks
   * and the ★ line (AI-04).
   */
  const difficultyRules = () => difficultyRulesFor(skillKey);
  /** The selector + the boot URL both land here; persists for the next boot. */
  const setRivalSkill = (key: SkillKey, announce = true) => {
    if (skillKey === key) return;
    skillKey = key;
    try { localStorage.setItem(SKILL_STORAGE_KEY, key); } catch { /* private mode */ }
    if (announce) {
      // L6 (#220): one setting, so the toast states both halves — who you play
      // against, and what your own Depots do with the yield you tune.
      toast(`Difficulty: ${skill().label} — ${skill().economyLine}`, "info");
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
  //
  // L13 (#228): the new loop scores from an entirely different table
  // (`VICTORY.loop`), so it races its own line — the shipped 10★ is calibrated
  // against 0.25★ paves and would be reached by three depot types. `newLoop`
  // is solo-only and story-free (L1a), so this branch can sit ahead of both
  // without touching a contract's target or a room's setting.
  let conquest = opts.conquest === true;
  let lastConquestCheck = 0;
  const winTarget = (): number => newLoop
    ? VICTORY.loop.target
    : (storyChapter
      ? storyChapter.target
      : (isSolo() ? skill().winTarget : settings.winTarget));

  const eco: EconomyState = { grid, track, harvesters: [], factories: [], rail };
  // Playtest (2026-09) / #298: the map learns what the game built on it that
  // `occupancy` does not record — rail, platforms, truck Depot lots, and
  // processing plants / town buildings — so a road never runs along a rail
  // line, and nothing is built over a platform, a Depot, the other seat's
  // plant or a town building (the rival's planner reads the same grid).
  // Town-building tiles are rebuilt in `syncWorld` from the same layout the
  // map draws. Until that first sync, house tiles (not streets) stand in.
  let townPlantTiles = new Set<number>();
  let townPlantReady = false;
  grid.builtAt = (x, y) => {
    if (structureAt(rail, x, y)) return "platform";
    if (hasRail(rail.rail, x, y)) {
      const m = rail.rail.tile[tIdx(x, y)];
      if (m & RAIL_DIAG) return "rail";
      const bits = m & 0b1111;
      return bits === 0b1010 ? "rail-x" : bits === 0b0101 ? "rail-y" : "rail";
    }
    if (eco.harvesters.some((h) => !isRailDepot(h) && depotContains(h.tx, h.ty, x, y))) return "depot";
    // Plants are scanned live: a push into `eco.factories` (a test, a restore
    // mid-function) is an obstacle before the next `syncWorld`. The live
    // footprint is the square `FACTORY_FOOTPRINT`; a non-square stamp uses the
    // same `tileInFootprint` helper, which swaps axes on an odd quarter-turn.
    //
    // The retired `?loop=old` hatch is the exception, and only when the boot
    // did not opt into the live loop. W8 asks `canBuildOn` whether a Factory
    // that is already down still sits on road-legal ground — flat, off water,
    // off a town. That question is about the tile. A `{ newLoop: true }` boot
    // (and every default / room / story boot) still reports the footprint as
    // a plant, so the other seat cannot pave it.
    if ((opts.newLoop === true || loopParam !== "old") && eco.factories.some((f) => tileInFootprint(
      x, y, f.tx, f.ty, FACTORY_FOOTPRINT[0], FACTORY_FOOTPRINT[1],
    ))) return "plant";
    if (townPlantReady) {
      if (townPlantTiles.has(tIdx(x, y))) return "plant";
    } else if (townHouseAt(grid, x, y)) return "plant";
    return null;
  };
  /** PP-15: the local seat may START a road drag on its own plant or depot.
   *  `canBuildOn` refuses those tiles (#298); the drag steps over them. */
  const ownFloor = (tx: number, ty: number) =>
    structureTiles(eco.factories, eco.harvesters, me.i + 1).has(tIdx(tx, ty));
  let nextHarvesterId = 1;
  /**
   * RV-01 / L7 (#221): road traffic. One lorry per SERVICED DEPOT once it
   * reaches a Factory by road — over private track AND the public highways
   * (PP-13). Replanned only when the economy changes (every build/demolish
   * funnels through `rescoreNow`); the frame loop just advances and draws
   * them. Disconnecting a depot drops its lorry. Vehicles hold no economic
   * state — `lorriesEnabled` is the debug gate that proves it.
   */
  const trucks = createTruckState();
  let trucksDirty = true;
  /** L7 (#221): debug gate — `__iso.setLorries(false)` (or `setVehicles(false)`)
   *  clears the depot lorries without touching the clock. Default on. */
  let lorriesEnabled = true;
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
  // ── C1 (#255): chat ─────────────────────────────────────────────────────
  /**
   * The chat lines this client has seen, in order — its own sends and the
   * peer's arrivals alike, so a panel can show one conversation.
   *
   * THERE IS NO PANEL YET (that is #257). The wire, its safety rules and the
   * debug hook are this ticket's whole visible half, deliberately: the rules
   * can be play-tested on a real pair of browsers before any UI exists to hide
   * behind. `__iso.chat()` is how a probe reads this.
   */
  const chatLog: ChatMsg[] = [];
  /** Bound the log: a match can run for hours and nothing prunes it otherwise. */
  const CHAT_LOG_MAX = 50;

  function pushChat(msg: ChatMsg): void {
    chatLog.push(msg);
    if (chatLog.length > CHAT_LOG_MAX) chatLog.splice(0, chatLog.length - CHAT_LOG_MAX);
  }

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

  // ── J1: quarry + the restored UI ─────────────────────────────────────────
  // Cargo has exactly one owner (the purse above). The board owns gems; the
  // gate between board and purse is `quarry.ts`. L11 (#226) removed the offer
  // board that used to sit between the two, so the bank is the only exchange
  // left and the purse is the only place a balance lives.
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
    // yield. The RIVAL's seat is cut the same way (#235 gave it the same
    // clock); combo Gold below and the board's cross/bonus rewards stay
    // wired on both seats (#227 re-homes them).
    payCargo: !newLoop,
    // L9 (#224): and the combo coin is not the new loop's Gold source either
    // — a tuning session's SCORE pays Gold (`tuningGoldFor`, credited in
    // `closeTuningSession`), and a Depot holding a Gold Mine ticks Gold in on
    // the clock like any other cargo. The combo bank still counts; it just
    // stops minting.
    payGold: !newLoop,
    // L12 (#227): the new loop's board is token-free to match — nothing
    // spends tokens there, so none mint: the 20-second spawn clock, the
    // first-token grant on a newly-reached cargo and lorry deliveries all
    // sit behind this one flag in quarry.ts.
    spawnTokens: !newLoop,
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
    // L12 (#227): under the new loop the readout carries the pass's SCORE
    // (banked by the onClear/onReward wiring below) instead of cargo gains —
    // the board paid no cargo, and a "+N score" is what the issue replaces
    // the "+N cargo" popups with. Every new-loop popup flushes the bank, so
    // each float shows exactly what ITS pass earned.
    onPopup: (gains, label) => {
      const score = newLoop ? pendingScore : undefined;
      pendingScore = 0;
      ui.popup(newLoop ? {} : gains, label, score);
    },
    // L15: tokens retired — no toast
    onChange: () => onBoardChange(),
  }, undefined);

  // AI-03: the RIVAL's Processing Plant board — a real quarry of its own,
  // played by a clock-driven autoplayer (`skill().moveMs`, below). It pays the
  // same rules the player's board does: match a token, earn the feed. The
  // board drives the purse through the same hooks the player's own quarry
  // does; what it must never do is toast the human about the rival's private
  // matches, so its UI surface says nothing — except when its own peek panel
  // is open (see `openRivalPlantView` below).
  //
  // L1d (#235): on the new loop that purse line is cut for the rival exactly
  // as #234 cut it for the player (`payCargo: false`) — the rival earns on the
  // clock from its connected depots instead, in the same `economyTick` pass.
  // The board stays ALIVE (the autoplay keeps running) because it is the
  // plant you can watch from the peek panel, and because AI-03 is a thing the
  // player is meant to be able to sit and watch. Its combo Gold is untouched
  // (#227 re-homes Gold).
  let rivalQuarry: Quarry;

  /** AI-03: the peek panel handle (set when the player opens it). */
  interface RivalBoardView { paint: () => void; close: () => void }
  let rivalBoardView: RivalBoardView | null = null;
  /** TS narrowing helper: closures bind this `let` as null before any
   *  assignment exists in straight-line flow; one method keeps the union. */
  const getRivalView = (): RivalBoardView | null => rivalBoardView;
  const paintRivalView = () => getRivalView()?.paint();

  // ── L11 (#226): the bank, and nothing else ───────────────────────────────
  // The offer board is gone — with it the escrow, the expiry clock, the
  // rival's answer/post policy, the four guest intents and the snapshot
  // fields that carried it. What is left is the bank, and the bank may not
  // skip a rung: under the new loop a seat can only exchange cargos whose
  // `DEPOT_TREE` row is at or below the rungs it has unlocked (`bank.ts`),
  // which is the same gate `priceDepot` applies to a build. The shipped loop
  // has no tree, so its bank keeps the rule it always had (everything but
  // Gold). Gold is outside both (PP-08): it pays for Black Market sabotage
  // and for nothing else.
  //
  // MP-parity: the host owns the purse. A guest's exchange is a REQUEST
  // (`action: "bank"`) the host validates and applies against the guest's own
  // player record — the UI says "sent to the host" until the delta lands, the
  // same door the rails and the Black Market use.
  function bankRungsFor(p: PlayerState): number | null {
    return newLoop ? p.depotTier : null;
  }

  /** Is this cargo exchangeable at `p`'s seat right now? */
  const bankCanExchange = (p: PlayerState, cargo: Cargo): boolean =>
    bankAllowed(cargo, bankRungsFor(p));

  /**
   * The bank, on the host/solo seat. One owner of the balance (`p.purse`),
   * one rule (`bankTrade`), and a publish when a room is watching.
   */
  function bankFor(p: PlayerState, give: Cargo, want: Cargo): boolean {
    const ok = bankTrade(p.purse, give, want, { unlocked: bankRungsFor(p) });
    if (ok && isMp()) publishNet(performance.now(), true);
    return ok;
  }

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
    commitCamera(centerOnTile(cam, f.tx, f.ty));
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
    // L10 (#225): a reset inside a tuning session re-deals that session's
    // obstacles — the ♻ collapses the board, not the difficulty. (Outside a
    // session there is nothing to re-deal, and a fresh board is fresh.)
    const depot = tuning ? eco.harvesters.find((h) => h.id === tuning!.depotId) : undefined;
    if (depot) seedSessionObstacles(depot);
    toast("Processing Plant collapsed. Fresh neutral board.", "info");
  }
  // Original HUD (U1). It takes the live board and the player's own seat and
  // wires the BUILD / BLACK MARKET / QUARRY / chips chrome to them.
  ui = createOriginalUi(quarry.board, {
    // L11 (#226): the chrome's view of the LOCAL seat. `res` is the live purse
    // object the game mutates and `unlocked` reads the rungs off the seat's own
    // record every paint, so a rung won mid-session opens the bank the same
    // frame (and no copy of either can go stale).
    id: me.id,
    get name() { return me.name; },
    res: me.purse,
    get unlocked() { return newLoop ? me.depotTier : null; },
  }, {
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
      commitCamera(zoomStepAt(cam, dir, cam.vw / 2, cam.vh / 2));
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
    // L4 (#218) + L6 (#220): the plate's keys. `onTuningEnd` was declared on
    // UiHooks in #218 but never passed here, so Finish and ✕ were dead buttons
    // in a live game (the tests drove `__iso.tuningFinish`, which goes straight
    // to the game). Both doors now call the same two functions, and the new
    // re-match key goes through the rules too rather than a chrome-side guess.
    // #300: Finish ENDS the session into its results pop-up (the one running
    // out of moves opens); ✕ still abandons straight onto the map, no pop-up.
    onTuningEnd: (abandon) => (abandon ? closeTuningSession(true) : requestTuningFinish()),
    // #300: the pop-up's Confirm — applies the result it shows, exactly.
    onTuningConfirm: () => confirmTuningResult(),
    onTuningRetune: () => retuneNow(),
    // L8 (#222): the quest panel's own choices — a dismissed offer and a
    // hidden panel are the player's, and both ride the save.
    onQuestAction: (id, action) => questAction(id, action),
    // L5 (#219): …and the city upgrade's key. Same rule: it calls the game.
    onTownUpgrade: () => { buyTownUpgrade(); },
    /**
     * L11 (#226), restored by L17 (#245): the bank exchange. A guest's is a
     * REQUEST — the host owns the purse, validates the pair against the guest
     * seat's own rungs and applies it; the trade exists only once the host's
     * delta says so. Solo and host apply it here and now.
     */
    onBank: (give, want) => {
      if (isGuest()) {
        if (!net?.sendIntent("bank", { do: "bank", give, want })) return "refused";
        return "relayed";
      }
      return bankFor(me, give, want) ? "done" : "refused";
    },
    // TRADE (owner call, 2026-09): the Market tab's three doors.
    onOfferPost: (give, giveN, want, wantN) => tradeRequest("post", { give, giveN, want, wantN }),
    onOfferAccept: (id) => tradeRequest("accept", { id }),
    onOfferCancel: (id) => tradeRequest("cancel", { id }),
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
    // #302: the map is generated synchronously at boot (above), so this step
    // is already done — it is listed so the bar's checklist names every real
    // step the first frame needs, and settled the moment the boot tracks it.
    { id: "map", label: "Charting the island" },
    { id: "atlas", label: "Surveying the island" },
    { id: "layers", label: "Grading the terrain" },
    { id: "buildings", label: "Raising the buildings" },
    { id: "scenery", label: "Planting the trees" },
    { id: "vehicles", label: "Fuelling the lorries" },
    // #302: RAIL-03's track() call names this id, but the LOAD-01 list never
    // declared it — an unknown id settles into the void, so the railway art
    // was the one layer the bar never actually waited on. Declared exactly
    // when it is tracked (rail on), so the bar cannot hang on a job nobody
    // started either.
    ...(railAvailable ? [{ id: "railway", label: "Laying the rails" }] : []),
    { id: "roads", label: "Mixing the asphalt" },
    { id: "protest", label: "Painting the placards" },
    { id: "fonts", label: "Setting the type" },
    { id: "gems", label: "Polishing the gems" },
    // The last step is local, not a fetch: the first rendered frame, settled
    // from the frame loop itself once a frame has actually painted.
    { id: "frame", label: "Raising the curtain" },
  ]);
  // #302: the reveal gate (src/iso/loading-screen.ts) — the economy, rival,
  // board and vehicle clocks start when the game is SHOWN, not when the
  // first frame renders behind the overlay. A resumed game (phase "play"
  // straight from the save) would otherwise earn income and move the rival
  // while the player still stares at the bar.
  const reveal = createRevealGate();
  // The "frame" step's promise — resolved from the frame loop once the first
  // frame has run (painted or thrown: settled, not succeeded, like every
  // other step).
  let resolveFirstFrame: (() => void) | null = null;
  const firstFrame = new Promise<void>((res) => { resolveFirstFrame = res; });
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
      // into tutorial.ts (which would be a cycle). The tour itself is the NEW
      // loop's (L15 #230 wrote it for the tuning session — its "the board is
      // not up otherwise" would lie on the retired loop), so a `?loop=old`
      // boot or a story contract stands no tour at all; the briefing and the
      // difficulty prompt carry those players instead.
      tutorialView = newLoop && !opts.firstRun ? showTutorial(ui.el, {
        vpTarget: winTarget(),
        freeTrack: me.freeTrack,
        newLoop,
      }) : null;
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
      if (opts.firstRun && newLoop) {
        // First game: Normal, no question asked; the coach takes over.
        setRivalSkill("normal");
        try { localStorage.setItem(SKILL_STORAGE_KEY, "normal"); } catch { /* private mode */ }
        const sel = ui.el.querySelector<HTMLSelectElement>("#iso-rival-skill");
        if (sel) sel.value = "normal";
        ui.setCoach(true);
      } else if (!storyChapter) {
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
  quarry.board.onClear = (n, _chain) => {
    // #300: an ended session's score is FROZEN — the results pop-up shows it
    // and Confirm applies it, so nothing may add to it behind the card.
    if (tuning && !tuningResult) {
      recordTuningCleared(tuning, n);
      // L12 (#227): bank the gems as the pass's score so the popup the pass
      // ends with can float what it earned.
      pendingScore += n;
    }
  };
  // L12 (#227) — the board's REWARDS: a cross (holy outscores broken), a big
  // shape, a banked combo, a cracked frost step and a broken girder each pay
  // the session's score the value `TUNING_REWARD_SCORE` assigns them, on top
  // of the gems the pass already cleared. Nothing here can reach a purse — a
  // score-paying board does not fire the cargo wires at all.
  quarry.board.onReward = (kind) => {
    if (!tuning || tuningResult) return;
    const pts = TUNING_REWARD_SCORE[kind];
    recordTuningCleared(tuning, pts);
    pendingScore += pts;
  };
  // L12 (#227) — the new loop's board pays SCORE, not cargo. Set at boot, not
  // per session, so a settle that ever runs outside a session (a test, a save
  // restored mid-cascade) still cannot reach the purse. The old loop and the
  // rival's plant keep the shipped cargo behaviour — their boards never
  // enter score mode.
  if (newLoop) quarry.board.setPaysScore(true);

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
  // L15 (#230): blessings (holy/broken crosses) are gone — the board's
  // cross detection now just banks score, no chooser, no wire, no timer.
  quarry.board.onCrossChoice = (_kind, _picks, pick) => pick([]);

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
  // 2026-09: the glowing "⬆ Upgrade" markers over my cities' town halls in
  // city-pick mode — always on, whatever the Names toggle says.
  const upgradeMarkers: LabelLayer = createLabelLayer(ui.mapHost, tileScreenCss);
  upgradeMarkers.setEnabled(true);
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
    // L1d (#235): mirror of #234 for the "ai" seat — a matched token on the
    // rival's plant clears and cascades, but it credits no cargo. `payCargo`
    // is cut INSIDE the quarry (not by muting `onHarvest`) so the board's own
    // gain accumulator can never advertise a "+N cargo" the rival was not
    // paid, and no "no route — N lost" is raised for cargo nobody owed it.
    payCargo: !newLoop,
    // L9 (#224): …and the combo coin goes the same way, which is the half
    // #235 left to "#227 owns Gold" — this ticket is where that landed. The
    // rival's depots pay its Gold through their simulated tuning sessions
    // (`rivalTuningGold`, in `applyRivalTuning`), so both seats' raid tables
    // are funded by the same rule and neither is minting coins off however
    // long a cascade happens to run.
    payGold: !newLoop,
    onHarvest: (cargo, amount) => earn(rival, { [cargo]: amount }),
    onBlocked: () => {},
    onGold: (n) => {
      earn(rival, { gold: n });
      ui.feed(`Rival earns +${n} Gold from tuning 🪙`, rival.name);
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
  // L15: blessings retired — and the hook must still ANSWER: the cascade
  // pauses on a cross until the hook calls `pick` (board.ts `settle`), so a
  // never-resolving handler would freeze the rival's board mid-swap the first
  // time a cross rolled. Answer empty like the player's board — no chooser,
  // the random top-up runs, the cascade rolls on.
  rivalQuarry.board.onCrossChoice = (_kind, _picks, pick) => pick([]);

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
    const ind = grid.industries[0];
    // Mobile pass (2026-09): the coached first game opens on a TOWN — its
    // first instruction is "place your Factory next to a town", and a phone
    // screen that shows only a farm leaves nothing to aim at.
    if (opts.firstRun && ind && grid.towns.length) {
      const near = [...grid.towns].sort((a, b) =>
        Math.hypot(a.tx - ind.tx, a.ty - ind.ty) - Math.hypot(b.tx - ind.tx, b.ty - ind.ty))[0];
      return { tx: near.tx, ty: near.ty };
    }
    return ind ?? { tx: MAP_W / 2, ty: MAP_H / 2 };
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

  /**
   * #281: the ONE camera commit — the single way `cam` is ever written.
   *
   * Every path that moves the map (the drag gesture, the pinch, WASD, the
   * wheel, the touch +/−, recenter, resize, the test twins) used to be a bare
   * `cam = next; renderer?.setCamera(cam)` pair, and that pair is only half a
   * move: `setCamera` marks the renderer dirty, so the CANVAS lands on the
   * next animation frame — and the three DOM layers anchored to the live
   * camera through `tileScreenCss` (the name tags, the A1 floats, the build
   * flash) waited for their own `frame()` calls near the END of that same
   * frame. Two consequences, both reported in #281:
   *
   *   * anything that presents the map between the write and that frame —
   *     `paintOverlayNow()` inside a pointer handler is exactly that — shows
   *     the map at the new camera with the tags still at the old one;
   *   * a long synchronous task inside the pan (a road/ground chunk-cache
   *     rebuild, `syncWorld`, `planTrucks` on a big network, the autosave)
   *     starves the rAF loop, so the tags sit at the pre-pan position for the
   *     whole stall and then SNAP onto their features when it catches up.
   *     That is the "drift, then snap back seconds later" in the report.
   *
   * So the tags are now moved by the SAME commit the renderer uses: one
   * function, and no camera write can skip the re-anchor. It is cheap and
   * idempotent — `labels.frame()` is a no-op while the Names button has the
   * tags hidden, and the frame loop calls it again next tick for the same
   * numbers.
   */
  function commitCamera(next: Camera) {
    cam = next;
    renderer?.setCamera(cam);
    // The three camera-anchored DOM layers. `now` only reaps expired
    // floats/flash — the re-anchor itself is time-free — and
    // `performance.now()` is the same clock `paintOverlayNow` reads.
    const now = performance.now();
    floats.frame(now);
    flashLayer.frame(now);
    labels.frame();
    upgradeMarkers.frame();
  }

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
    const playerBreakdown = victoryBreakdown(eco, me.id, railPlatforms(), loopScoring());
    const rivalBreakdown = victoryBreakdown(eco, rival.id, railPlatforms(), loopScoring());
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
    // L16 (#231): the storage cap. On the new loop every cargo has a cap
    // derived from the seat's city level (`storageCapFor`), and income above
    // it is LOST — never stored, never spend-blocked: `spend` below and every
    // affordability check read the same purse they always did. Three shape
    // rules, all load-bearing:
    //   • the cap never LOWERS a balance — `Math.max` keeps a purse already
    //     above the cap (dev mode's 9999 floor, a rich start purse) exactly
    //     where it is. The cap gates income, it never confiscates;
    //   • dev mode's unlimited resources BYPASS the cap for the local seat
    //     (`topUpDevPurse` refills it to 9999 every frame; `?unlimited=0`
    //     turns that off and the cap applies, which is how it is playtested);
    //   • the shipped loop is untouched — its purse moves through board
    //     harvests and lorry credits this ticket does not govern, so no cap
    //     applies while the flag is dev-only (same scope as every L-rule).
    const cap = newLoop && !(devUnlimited && p === me)
      ? storageCapFor(p.townLevel)
      : Number.POSITIVE_INFINITY;
    for (const [k, v] of Object.entries(gain) as [Cargo, number][]) {
      const held = p.purse[k] ?? 0;
      p.purse[k] = Math.max(held, Math.min(cap, held + v));
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // L8 (#222) — the optional quests, wired.
  //
  // The rules live in `quests.ts` (pure, unit-tested); this is the half that
  // knows about the live map, the purses and the player's own choices. The
  // contract with the rest of the game is deliberately thin: a quest reads the
  // world to see whether it is done, and writes exactly one thing when it is —
  // `earn(me, reward)`. No tier, no rung, no upgrade, no ★ and no win check
  // ever asks whether a quest exists.
  // ══════════════════════════════════════════════════════════════════════════
  /** Which voice speaks for a strategy in THIS match. */
  const questSpeakerFor = (def: QuestDef): QuestSpeaker => speakerFor(def.strategy, storyOn);
  const questSpeakerName = (speaker: QuestSpeaker): string =>
    speakerName(speaker, storyOn ? CAST[rivalCast].name : null);

  /**
   * The map and the seat, as the quest table asks for them: what is still
   * unclaimed (and by which cargo), what the rival already runs, what this
   * seat's Depots do. Derived every frame, never stored — a quest's progress
   * is a question about the world, not a counter.
   */
  function questViewNow(): QuestView {
    const locks = industryLocks(eco);
    const unclaimed: Partial<Record<Cargo, number>> = {};
    for (const ind of grid.industries) {
      if (locks.has(ind.id)) continue;
      const def = INDUSTRY_BY_KEY[ind.type];
      if (!def) continue;
      unclaimed[def.cargo] = (unclaimed[def.cargo] ?? 0) + 1;
    }
    const cargosOf = (owner: string, onlyServiced: boolean): Cargo[] => {
      const out: Cargo[] = [];
      for (const h of eco.harvesters) {
        if (h.owner !== owner) continue;
        if (onlyServiced && !isServiced(eco.track, h, eco.rail)) continue;
        const cargo = depotCargo(eco, h);
        if (cargo) out.push(cargo);
      }
      return out;
    };
    const mine = eco.harvesters.filter((h) => h.owner === me.id);
    const connected = mine.filter((h) => isServiced(eco.track, h, eco.rail)).length;
    const yields = mine.map((h) => h.yield ?? 0);
    return {
      unclaimed,
      rivalCargoes: cargosOf(rival.id, true),
      depotCount: mine.length,
      connected,
      tunedDepots: mine.filter((h) => h.yield !== undefined).length,
      bestYield: yields.length ? Math.max(...yields) : 0,
      cargoesRunning: cargosOf(me.id, true),
      townLevel: me.townLevel,
      townLevels: TOWN_UPGRADES.length,
    };
  }

  /** What the panel and the reward both read — one derivation per frame. */
  const questView = (): QuestView => questViewCache ?? (questViewCache = questViewNow());

  /**
   * Pay a completed quest: the reward into the local purse, the toast in the
   * speaker's name, the id into `paid`/`spent` so it can never be collected
   * twice (the save carries both sets). One implementation, used by the frame
   * and by the debug twin — the rule can never fork.
   */
  function payQuest(def: QuestDef): boolean {
    if (questPaid.has(def.id)) return false;
    questPaid.add(def.id);
    questSpent.add(def.id);
    const reward = questReward(def);
    earn(me, reward.purse);
    const speaker = questSpeakerFor(def);
    toast(`Quest complete — ${questSpeakerName(speaker)}: +${reward.label}`, "good");
    quests = quests.filter((q) => q.id !== def.id);
    return true;
  }

  /**
   * The quest clock: retire what the map has moved past, pay what is done
   * (once), and keep 2–3 suggestions on the panel. Runs once a frame beside
   * the economy tick; `phase !== "play"` leaves the panel empty, so the setup
   * debt, the ending and a guest seat see none of it.
   */
  function syncQuests(): void {
    if (!newLoop || phase !== "play" || isGuest()) {
      if (quests.length) quests = [];
      questViewCache = null;
      return;
    }
    const view = questViewNow();
    questViewCache = view;

    // A restored panel comes back as it was saved (see `questPendingOffers`).
    if (questPendingOffers) {
      const pool = questOffersFor(view);
      const byId = new Map(pool.map((q) => [q.id, q]));
      quests = [
        ...quests,
        ...questPendingOffers
          .map((id) => byId.get(id))
          .filter((q): q is QuestDef => q !== undefined),
      ];
      questPendingOffers = null;
    }

    // A reward lands exactly once — the id is the proof, and it rides the
    // save, so a reload cannot collect it twice.
    let paid = 0;
    for (const def of [...quests]) {
      if (!questDone(def, view) || !payQuest(def)) continue;
      paid++;
    }

    // Retire the impossible: a claim quest whose last unclaimed industry went
    // to the rival (and which this seat does not run) can never be finished, so
    // it comes off the panel rather than sitting there as a reproach.
    for (const def of [...quests]) {
      if (def.kind !== "claim-cargo" || !def.cargo) continue;
      if (view.cargoesRunning.includes(def.cargo)) continue;
      if ((view.unclaimed[def.cargo] ?? 0) > 0) continue;
      questSpent.add(def.id);
      quests = quests.filter((q) => q.id !== def.id);
    }

    // ── when to draw again ────────────────────────────────────────────────
    // The panel fills once, and then only when the SEAT has actually moved:
    // a new Depot, a new cargo on the clock, a rung, a city tier — or when a
    // quest was just paid (a completion earns the next suggestion). A
    // DISMISSAL is the player's answer and refills nothing: the row goes away
    // and stays away until the situation changes, which is what makes "hide"
    // and "dismiss" honest rather than a whack-a-mole.
    const world = `${view.depotCount}:${view.connected}:${typesRunning(view.cargoesRunning)}`
      + `:${view.townLevel}:${me.depotTier}`;
    const first = questWorld === null;
    const moved = !first && world !== questWorld;
    questWorld = world;

    if (quests.length >= QUEST_OFFER_MAX) return;
    if (!(first || moved || paid > 0)) return;
    const next = selectQuests(questOffersFor(view), questRng, {
      max: QUEST_OFFER_MAX - quests.length,
      exclude: questSpent,
      avoid: quests.map((q) => q.strategy),
    });
    if (next.length) quests = [...quests, ...next];
  }

  /** The quest panel's own slice of the save (ids + the player's choices). */
  const questsSave = () => ({
    offers: quests.map((q) => q.id),
    spent: [...questSpent],
    paid: [...questPaid],
    hidden: questsHidden,
  });

  /** The player's ✕ on a single offer, and the panel's Hide / reopen. */
  function questAction(id: string, action: "dismiss" | "hide" | "show"): void {
    if (action === "hide") { questsHidden = true; return; }
    if (action === "show") { questsHidden = false; return; }
    questSpent.add(id);
    quests = quests.filter((q) => q.id !== id);
  }

  const factoryOf = (id: string) => eco.factories.find((f) => f.owner === id) ?? null;

  /** PP-06: the plant price, rendered from the one authoritative constant. */
  const plantCostLabel = () => (Object.entries(PLANT_COST) as [Cargo, number][])
    .map(([k, v]) => `${v} ${CARGO[k].icon}`).join(" ");

  /**
   * The building a Depot draws: the rotation its entrance opens onto. The
   * per-building PNGs are a separate load from the sheet (`loadBuildingLayers`),
   * so until they land — or on a checkout without them — this falls back to the
   * sheet's own depot cell in the owner's colour, exactly as the lorries fall
   * back to `truck_goods_*`. The fallback keeps the building pickable (the
   * inspector, the hover route) instead of leaving a hole in the draw list.
   */
  const depotSpriteFor = (h: { tx: number; ty: number; ownerId: number; facing?: DepotFacing }) => {
    const want = DEPOT_SPRITES[depotFacingOf(grid, h)];
    if (!atlasRef || atlasRef.has(want)) return want;
    return h.ownerId === me.i + 1 ? "depot_blue" : "depot_red";
  };

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
    for (const h of eco.harvesters.filter((x) => !isRailDepot(x)))
      for (const [x, y] of depotTiles(h.tx, h.ty))
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) blocked.add(y * MAP_W + x);
    // RAIL-04: a platform or a train depot is a built thing — the trees it
    // stands on are hidden under it, exactly like a plant's footprint.
    for (const s of rail.structures)
      for (const [x, y] of footprintTiles(s))
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) blocked.add(y * MAP_W + x);
    // Playtest (2026-09): track is laid over the trees, never under them — a
    // rail tile clears its tree the way a road does.
    for (let i = 0; i < rail.rail.tile.length; i++) {
      if (hasRail(rail.rail, i % MAP_W, (i / MAP_W) | 0)) blocked.add(i);
    }
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
      ...(f.closed ? { alpha: 0.4 } : {}),
    }));
    // TOWN-1 / TOWN-GRID: the town draw items — art on whole house BLOCKS.
    //
    // `townBuildings` decides the layout (see grid.ts): one 2x2 cell per
    // block where the hash picks one, single houses otherwise. It must be
    // asked at sync time rather than baked at generation, because a town
    // cell's footprint comes from the ATLAS and the per-building PNG layers
    // land after the first sync — `loadBuildingLayers` re-syncs, which is
    // when the towers move off the streets they used to be drawn across.
    //
    // L17 (#245): the towns' TIER rides along. Under the new loop a town
    // draws its tier (village smalls, the bank centre, the grown ring);
    // everywhere else `TOWN_TIER_LEGACY` keeps today's look byte for byte.
    // The grown ring is visual-only — it never claims tiles — but it is
    // still buildings, so its tiles hide the trees under them and skip
    // ground the player has already built on (every laid track tile, plus
    // the structures above).
    const footprintOf = (sprite: string): [number, number] =>
      atlasRef?.get(sprite)?.footprint ?? [1, 1];
    const built = new Set<number>(blocked);
    for (let i = 0; i < track.dirt.length; i++) {
      if (track.dirt[i] || track.road[i]) built.add(i);
    }
    const isBuilt = (tx: number, ty: number): boolean => built.has(tIdx(tx, ty));
    // #298: town buildings (not streets, not the L17 grown ring) are obstacles
    // for the other seat's roads, for rail, and for depot placement. Rebuilt
    // here so the footprints match the art `townBuildings` just laid — a 2×2
    // tower claims both of its tiles, in whatever rotation the atlas gives it.
    townPlantTiles = new Set();
    const townItems = grid.towns.flatMap((t) => {
      const tier = newLoop ? townTier(t) : TOWN_TIER_LEGACY;
      const ring = new Set<number>();
      if (tier >= 2) {
        for (const [gx, gy] of grownTownHouses(t, grid, townGrownRings(tier), isBuilt)) {
          const gi = tIdx(gx, gy);
          built.add(gi);
          blocked.add(gi);
          ring.add(gi);
        }
      }
      const laid = townBuildings(t, footprintOf, { tier, grid, blocked: isBuilt });
      for (const [x, y] of townObstacleTiles(
        t,
        laid.map((b) => {
          const [w, h] = footprintOf(b.sprite);
          return { tx: b.tx, ty: b.ty, w, h };
        }),
        (x, y) => ring.has(tIdx(x, y)),
      )) townPlantTiles.add(tIdx(x, y));
      return laid.map((b) => ({
        sprite: b.sprite,
        tx: b.tx, ty: b.ty,
        ref: { kind: "town", id: t.id } as unknown,
      }));
    });
    townPlantReady = true;
    world.sceneryBlocked = blocked;
    world.extra = [
      ...townItems,
      ...factoryItems,
      // Every Depot is the same truck depot building, whatever it harvests.
      // Ownership shows in the inspector, the catchment overlays and the ref.
      ...eco.harvesters.filter((h) => !isRailDepot(h)).map((h) => ({
        sprite: depotSpriteFor(h),
        tx: h.tx, ty: h.ty, ref: { kind: "harvester", id: h.id, owner: h.owner },
        ...(h.closed ? { alpha: 0.4 } : {}),
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
        name: isRailDepot(hv)
          ? (hv.owner === me.id ? "Your Platform" : "Rival Platform")
          : (hv.owner === me.id ? "Your Depot" : "Rival Depot"),
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
    type Bucket = { n: number; vp: number; spots: [number, number][]; cargos: Cargo[] };
    const byOwner = new Map<string, Map<string, Bucket>>();
    for (const e of events) {
      let kinds = byOwner.get(e.owner);
      if (!kinds) byOwner.set(e.owner, kinds = new Map());
      const key = `${e.source}:${e.type}`;
      const b = kinds.get(key) ?? { n: 0, vp: 0, spots: [], cargos: [] };
      b.n++;
      b.vp += e.delta;
      if (b.spots.length < MAX_FLOATS_PER_EVENT) b.spots.push([e.tx, e.ty]);
      if (e.cargo) b.cargos.push(e.cargo);
      kinds.set(key, b);
    }
    for (const [owner, kinds] of byOwner) {
      const mine = owner === "you";
      for (const [key, b] of kinds) {
        const [source, type] = key.split(":");
        const gained = type === "awarded";
        // L13 (#228): the new loop's three sources say what they were for —
        // a ★ that arrives unexplained is the confusion this whole path was
        // built to avoid, and "a depot type stopped running" is the one
        // revocation a player can act on.
        const names = b.cargos.map((c) => CARGO[c].name).join(", ");
        const label = source === "type"
          ? (gained
            ? `${names || "A"} Depot running · ${vpDeltaText(b.vp)}`
            : `${names || "A"} Depot cut off · ${vpDeltaText(b.vp)}`)
          : source === "level"
            ? (gained ? `Depot at top level · ${vpDeltaText(b.vp)}` : `Top-level Depot lost · ${vpDeltaText(b.vp)}`)
          : source === "route"
            ? (gained
              ? `Route fully paved · ${vpDeltaText(b.vp)}`
              : `Paved route broken · ${vpDeltaText(b.vp)}`)
          : source === "rung"
            ? `Depot-tree rung unlocked · ${vpDeltaText(b.vp)}`
            : source === "city"
              ? `City upgraded · ${vpDeltaText(b.vp)}`
              : source === "upgrade"
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
        if (conquest || !hasWon(score, p.id, winTarget())) continue;
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
        const b = victoryBreakdown(eco, p.id, railPlatforms(), loopScoring());
        // L13 (#228): the winning line names the sources the LIVE table paid.
        const how = newLoop
          ? `${b.types} depot type${b.types === 1 ? "" : "s"}, ${b.rungs} rung${b.rungs === 1 ? "" : "s"}, ${b.city} city upgrade${b.city === 1 ? "" : "s"}`
          : `${b.paved} paved tile${b.paved === 1 ? "" : "s"}, ${b.plants} plant${b.plants === 1 ? "" : "s"}`;
        toast(`${p.name} wins — ${fmtVp(vpFor(score, p.id))}★ (${how})`,
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
    applyVpEvents(rescore(eco, score, railPlatforms(), loopScoring()), now);
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
  /**
   * Playtest (2026-09): a town where the OTHER player has an open plant is
   * theirs — you may not build a Factory or plant beside it unless you have
   * won that town in battle (#322's shared city). Returns the refusal, or null.
   */
  function townBlockedFor(p: PlayerState, tx: number, ty: number): string | null {
    const t = adjacentTown(grid, tx, ty);
    if (!t) return null;
    const theirs = eco.factories.find((f) => f.owner !== p.id && !f.closed && f.townId === t.id);
    if (!theirs) return null;
    if (eco.townHolds?.get(t.id)?.holder === p.id) return null;
    const who = players.find((x) => x.id === theirs.owner)?.name ?? "The rival";
    return `${who} holds that town — win it in a battle to build there.`;
  }

  function placeFactoryFor(p: PlayerState, tx: number, ty: number): boolean {
    const blocked = townBlockedFor(p, tx, ty);
    if (blocked) {
      if (p.human) { toast(blocked, "bad"); flashAt(tx, ty, "Rival's town"); }
      return false;
    }
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
      // Owner (2026-09): the objective line says the next step — no toast repeats it.
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
      // L5 (#219): …and with the rungs it has unlocked — a rival that has
      // played no session yet may only open on a starter cargo.
      depotTier: rival.depotTier,
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
    // Owner (2026-09): the objective line says the next step — no toast repeats it.
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

  /**
   * L13 (#228) — the new loop's scoring input, or `undefined` on the shipped
   * loop (where `rescore` keeps paying paves and plants exactly as it always
   * has). This is the ONE place the ★ table is switched.
   *
   * `running` is a NETWORK fact, never a clock one — the rule this whole
   * scoreboard is built on ("points move on a build, never on a timer"). A
   * depot type scores when the seat has a Depot of that cargo that is
   * serviced, connected to one of its own plants, and holding an industry no
   * rival network claimed first. What it deliberately does NOT read is the
   * blockade/protest timers: those stop the cargo for a minute and are meant
   * to hurt income, not to make the star counter flicker on a clock nobody
   * pressed. (The ticket's "hold a contested industry for N minutes" control
   * ★ is explicitly post-MVP.)
   *
   * Rebuilding the components per call is fine because `rescore` runs on
   * build and demolish, which is exactly when the answer can have changed.
   */
  const loopScoring = (): LoopScoring | undefined => {
    if (!newLoop) return undefined;
    const locks = industryLocks(eco);
    const comps = new Map<string, ReturnType<typeof buildAllComponents>>();
    const compFor = (owner: string) => {
      let c = comps.get(owner);
      if (!c) comps.set(owner, c = buildAllComponents(eco.track, ownerIdOf(eco, owner)));
      return c;
    };
    return {
      running: (h) => {
        if (h.closed) return false;
        if (!isServiced(eco.track, h, eco.rail)) return false;
        if (resolveConnection(eco, compFor(h.owner), h).kind === null) return false;
        return heldIndustries(eco, h, locks).length > 0;
      },
      cargoOf: (h) => depotCargo(eco, h),
      // 2026-09: 1★ per Depot whose route to the plant is fully paved.
      routePaved: (h) => depotRoutePaved(eco, h),
      seats: players.map((p) => ({
        owner: p.id, depotTier: p.depotTier, townLevel: p.townLevel,
      })),
    };
  };

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
    // A platform at an industry IS a Depot — one tuning session at a time.
    if (anchor?.kind === "industry" && newLoop && tuning && p === me) {
      toast("Finish the tuning session first — one Depot is tuned at a time.", "bad");
      if (p.human) flashAt(tx, ty, "Finish the tuning session first");
      return false;
    }
    if (!spend(p, RAIL_COSTS.platform)) return false;
    const built = placePlatform(rail, p.id, ownerId, tx, ty, railView, anchor);
    layPlatformTrack(grid, track, rail, built);
    const depot = adoptPlatformDepot(built, p);
    if (p.human) sfx.play("build");
    syncWorld();
    rescoreNow();       // RAIL-02: the platform's ★ rides the same rescore
    if (p.human) {
      toast(depot
        ? "Platform built at the industry — tune its yield, then run rail to your plant's platform."
        : "Plant platform built — run rail to it from an industry platform.", "good");
    }
    if (depot && newLoop && p === me && !isGuest()) openTuningSession(depot);
    return !!built;
  }

  /**
   * Playtest (2026-09): a platform at an industry works exactly like a Depot.
   * It gets the Depot record the economy, the tuning session, levels and ★
   * all read — serviced by its train instead of a road (`isRailDepot`). A plant
   * platform is the other end of the line and holds nothing.
   */
  function adoptPlatformDepot(s: RailStructure, p: PlayerState): Harvester | null {
    if (s.kind !== "platform" || s.anchor?.kind !== "industry") return null;
    const h: Harvester = {
      id: allocHarvesterId(), owner: p.id, ownerId: p.i + 1, tx: s.tx, ty: s.ty,
      platformId: s.id, railIndustryId: s.anchor.id,
    };
    if (newLoop) h.yield = birthYieldFor(difficultyRules());
    eco.harvesters.push(h);
    return h;
  }

  /** The platform is gone: so is the Depot record it stood for. */
  function dropPlatformDepot(platformId: number): void {
    const hi = eco.harvesters.findIndex((h) => h.platformId === platformId);
    if (hi < 0) return;
    const removed = eco.harvesters[hi];
    eco.harvesters.splice(hi, 1);
    loopCarry.delete(removed.id);
    if (tuning?.depotId === removed.id) {
      closeTuningSession(false, "The tuned platform was removed — tuning session closed.");
    }
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
   * #300 — the RESULT an ended session is waiting on. A session ENDS when its
   * budget is spent and the board has settled, or when Finish is pressed; its
   * settlement is frozen here at that moment, the results pop-up counts it up
   * over the session window, and Confirm applies this very record
   * (`closeTuningSession`). While it is set the session is still the one
   * session (every "one at a time" rule keeps reading `tuning`), but its
   * board takes no more moves and its score no more points.
   */
  let tuningResult: SessionSettlement | null = null;
  /** #300: the pop-up's copy of `tuningResult`, built once when it froze. */
  let tuningResultUi: UiTuningResult | null = null;
  /**
   * #300: Finish was pressed while the board was mid-cascade. The session
   * stops taking moves at once and ends the moment the board settles, so the
   * cascade the last move started still lands on the score it is rated by.
   */
  let tuningEndAsked = false;
  /** #300: settlement ids — the pop-up restarts its count-up on a new one. */
  let settleSeq = 0;
  /**
   * L5 (#219): what a city-upgrade session was bought with. Held here (not on
   * the session) because it is the GAME's ledger: the cost is spent when the
   * session opens, and an abandoned one gets exactly this back — no building
   * stands for a city upgrade, so nothing is lost but the time.
   */
  let townPaid: Purse | null = null;
  /**
   * L12 (#227) — the score the running pass has banked since its last popup.
   * Gems (`onClear`) and rewards (`onReward`) add to it while a session is
   * open; the popup the pass ends with shows it and resets it. Declared here
   * (not beside the board wiring) next to the state it belongs to.
   */
  let pendingScore = 0;

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
   *      tapping a girder costs no move;
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
      // #300: an ENDED session is only waiting on its Confirm — its board
      // (dimmed under the results pop-up) takes no more swaps, and a swap
      // refused here costs no move.
      if (tuningResult || tuningEndAsked) return;
      const g1 = quarry.board.grid[r1]?.[c1], g2 = quarry.board.grid[r2]?.[c2];
      if (!g1 || !g2 || g1.block || g2.block) return;
      if (!takeTuningMove(tuning)) return;
    }
    void quarry.board.trySwap(r1, c1, r2, c2, now);
  }

  /**
   * L5 (#219): which cargo (and so which tree TYPE) a Depot built on this
   * site would be — the shared `depotCargo` rule (`economy.ts`), read off the
   * industries the Depot would HOLD. Used to PRICE and GATE a placement before
   * it is committed, and to scope the tuning session once it stands.
   */
  function tuningCargoFor(depot: Harvester): Cargo | null {
    return depotCargo(eco, depot);
  }

  /**
   * L10 (#225) — the obstacles the open session was dealt (what actually
   * landed, not what the table asked for). The plate and the tests read it, so
   * the copy that says "3 girders" and the board that holds three are never
   * two sources of truth.
   */
  let sessionObstacles: BoardObstacles | null = null;

  /**
   * L10 (#225) — deal the difficulty's obstacles onto the session's board.
   *
   * The ONE door an obstacle has on to a board: the row the game is running,
   * thinned by the tier this Depot stands on, placed by the board on the
   * seeded RNG with the deadlock guard watching every single one.
   */
  function seedSessionObstacles(depot: Harvester): BoardObstacles {
    const plan = sessionObstaclesFor(difficultyRules(), depotTier(depot));
    const placed = quarry.board.seedObstacles(plan.frost, plan.girders, plan.frostHard);
    sessionObstacles = placed;
    return placed;
  }

  /**
   * Open the tuning session for a Depot. The board is wiped to a fresh neutral
   * grid (a session is a skill burst on a clean table), biased toward the
   * Depot's own colour, seeded with the difficulty's obstacles, and the plate
   * takes over.
   *
   * The obstacles are the L10 half of this: `sessionObstacles(rules, tier)`
   * reads the row the game is running (Easy none, Normal frost, Hard frost and
   * girders), the tier thins it for a first Depot, and `Board.seedObstacles`
   * places them on seeded RNG without ever leaving a board with no legal move.
   * They are NOT a timer and NOT a purchase — nothing outside a session can
   * put one on a board, and they leave with the session that brought them.
   */
  function openTuningSession(depot: Harvester, isRematch = false): void {
    const rules = difficultyRules();
    // L6 (#220): `matchEnabled` is the ONE flag that can keep this from
    // happening, and all three rows set it true — "match-3 stays on Easy" is a
    // fact about the table, not a branch. Honouring it here (and in
    // `retuneCandidates`) instead of at each caller is what lets a future mode
    // turn the board off as a data change.
    if (!rules.matchEnabled) return;
    const cargo = tuningCargoFor(depot);
    if (!cargo) return;
    quarry.board.resetNeutral();
    quarry.board.setBias(CARGO_TO_GEM[cargo], TUNING.cargoBias);
    tuning = createTuningSession(depot.id, cargo);
    // The obstacles go on AFTER the fresh fill and BEFORE the plate opens:
    // they are part of the board the session deals, so the first thing the
    // player sees is the table as it will be played, not a clean one that
    // grows ice a beat later.
    const obstacles = seedSessionObstacles(depot);
    sfx.play("open");
    ui.openSessionBoard();
    // L10 (#225): the intro names the obstacles in the game's own words — the
    // player is told why the board is tougher before they spend a move on it.
    const intro = obstacleIntroLine(skill().label, obstacles);
    // Owner (2026-09): the session window's plate already says moves, score
    // and yield; only a board with obstacles gets a line of its own.
    if (intro) toast(intro, "info");
    void isRematch; void rules;
  }

  // ── L17 (#245): the town on the map grows with the seat ──────────────────
  /**
   * The town this seat's upgrade grows: the one its Factory is registered to
   * (`Factory.townId`, set at placement — PP-02 requires a Factory to touch a
   * town, so there is always exactly one while the Factory stands).
   *
   * DECIDED, per the ticket's open question "whose town grows": towns are
   * shared map objects and `townLevel` is per seat, so a seat's upgrade grows
   * ITS OWN factory's town; if both seats' factories touch the same town it
   * shows the HIGHER tier (`growTownForSeat` never lowers one). A town stays
   * grown once grown — demolishing the Factory does not shrink the map — and
   * a Factory rebuilt beside another town carries the next growth there.
   */
  // ── Owner call (2026-09): every city you hold upgrades on its own ──────
  // `cityTiers` is the truth (town id → owner, tier, bonus). The seat's
  // `townLevel` / `townBonus` stay as TOTALS (sum of tiers / best bonus) so
  // the ★ table, storage cap, HUD and saves keep reading what they always did;
  // income uses each Depot's OWN city bonus (the town of the plant it feeds).
  const cityTiers = new Map<number, { owner: string; level: number; bonus: number }>();
  /** Towns where `p` has an open plant — the cities `p` may upgrade. */
  function citiesOf(p: PlayerState): Town[] {
    const ids = new Set<number>();
    for (const f of eco.factories) {
      if (f.owner === p.id && !f.closed && f.townId != null) ids.add(f.townId);
    }
    return [...ids].map((id) => grid.towns[id]).filter((t): t is Town => !!t);
  }
  /** A pre-2026-09 seat's single tier lands on its first city once. */
  function migrateSeatCity(p: PlayerState): void {
    if (p.townLevel <= 0) return;
    if ([...cityTiers.values()].some((c) => c.owner === p.id)) return;
    const t = townOfSeat(p);
    if (t) cityTiers.set(t.id, { owner: p.id, level: p.townLevel, bonus: p.townBonus });
  }
  function cityOf(t: Town, p: PlayerState): { owner: string; level: number; bonus: number } {
    migrateSeatCity(p);
    const c = cityTiers.get(t.id);
    return c && c.owner === p.id ? c : { owner: p.id, level: 0, bonus: 0 };
  }
  /** Recompute the seat totals from its cities. */
  function syncSeatCities(p: PlayerState): void {
    let level = 0, bonus = 0;
    for (const c of cityTiers.values()) {
      if (c.owner !== p.id) continue;
      level += c.level; bonus = Math.max(bonus, c.bonus);
    }
    p.townLevel = level;
    p.townBonus = bonus;
  }
  /** The city bonus a Depot's income gets: its delivering plant's town. */
  function cityBonusFor(ownerId: string, factory: { townId?: number | null } | null | undefined): number {
    const id = factory?.townId;
    if (id == null) return 0;
    const c = cityTiers.get(id);
    return c && c.owner === ownerId ? Math.max(0, c.bonus) : 0;
  }
  /** Does this seat run per-city tiers yet? (Legacy seats keep one bonus.) */
  const hasCities = (p: PlayerState): boolean =>
    [...cityTiers.values()].some((c) => c.owner === p.id);
  /** Cities `p` could upgrade right now (held, unlocked, not maxed). */
  function upgradableCities(p: PlayerState): Town[] {
    return citiesOf(p).filter((t) => !eco.townHolds?.get(t.id)?.locked
      && cityOf(t, p).level < TOWN_UPGRADES.length);
  }
  /** The city the open town session is upgrading. */
  let townTarget: number | null = null;
  /** Pick mode: the town halls of my upgradable cities glow until one is tapped. */
  let cityPick = false;
  let cityPickTimer = 0;
  function setCityPick(on: boolean): void {
    cityPick = on;
    window.clearTimeout(cityPickTimer);
    if (on) cityPickTimer = window.setTimeout(() => setCityPick(false), 20_000);
    syncUpgradeMarkers();
  }
  function syncUpgradeMarkers(): void {
    const entries: LabelEntry[] = cityPick
      ? upgradableCities(me).map((t) => ({
        key: `up-${t.id}`, name: `⬆ Upgrade · L${cityOf(t, me).level + 1}`,
        tx: t.tx + 0.5, ty: t.ty + 0.5, cls: "label-upgrade",
      }))
      : [];
    upgradeMarkers?.sync(entries);
  }

  function townOfSeat(p: PlayerState): Town | null {
    const f = eco.factories.find((x) => x.owner === p.id);
    return f?.townId != null ? grid.towns[f.townId] ?? null : null;
  }

  /**
   * The GROWTH MOMENT: re-lay the town's draw items (`syncWorld` re-derives
   * the tier's art) and dirty exactly this town's tiles in the renderer's
   * caches — the road chunks carry the street material, the sidewalks, the
   * lamps and the block ground; the terrain/structure flags carry the
   * buildings. No new drawing pass, no per-frame work: one sync plus a
   * one-shot invalidation over the town's square (its extent plus whatever
   * the tier's grown rings can reach), which is what the ticket's "no frame
   * rate drop when a town grows" asks for. The float reuses the map's own
   * float layer.
   */
  function growTownArt(t: Town, now = performance.now()): void {
    syncWorld();
    let ext = 0;
    const note = (x: number, y: number) => {
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) {
        ext = Math.max(ext, Math.abs(x - t.tx), Math.abs(y - t.ty));
      }
    };
    note(t.tx, t.ty);
    for (const [hx, hy] of t.houses) note(hx, hy);
    for (const [rx, ry] of t.roads) note(rx, ry);
    const R = ext + townGrownRings(Math.max(townTier(t), 1)) * TOWN_BLOCK + 1;
    for (let y = t.ty - R; y <= t.ty + R; y++) {
      for (let x = t.tx - R; x <= t.tx + R; x++) {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
      }
    }
    floats.add(`⬆ ${townTierLabel(townTier(t)).toUpperCase()}`, t.tx, t.ty - 1,
      { cls: "delivery", now });
  }

  /**
   * Grow the seat's town to the seat's tier (its `townLevel`, capped by the
   * map's `TOWN_VISUAL_MAX`). No-op on the shipped loop (towns are set
   * dressing there), with no Factory registered, or when the tier is already
   * shown. `fx` off is the restore path: a loaded save re-lays the map
   * wholesale and must not float or play over the boot.
   */
  /** 2026-09: grow THIS city's art to its own tier. */
  function growCity(t: Town, p: PlayerState, fx = true): Town | null {
    if (!newLoop) return null;
    const next = Math.max(townTier(t), Math.min(cityOf(t, p).level, TOWN_VISUAL_MAX));
    if (!setTownLevel(t, next)) return null;
    if (fx) growTownArt(t);
    return t;
  }

  function growTownForSeat(p: PlayerState, fx = true): Town | null {
    if (!newLoop) return null;
    const t = townOfSeat(p);
    if (!t) return null;
    const next = Math.max(townTier(t), Math.min(p.townLevel, TOWN_VISUAL_MAX));
    if (!setTownLevel(t, next)) return null;
    if (fx) growTownArt(t);
    return t;
  }

  /**
   * L17 (#245): open the CITY upgrade's tuning session.
   *
   * Same budget and board as a Depot's, with two differences that are the
   * point of the upgrade: the board plays NEUTRAL (no cargo bias — a city
   * upgrade is about every cargo the city handles, so the session is a plain
   * skill burst) and the score lands on `player.townBonus`, which
   * `economyTick` multiplies into every connected Depot.
   */
  function openTownSession(): void {
    quarry.board.resetNeutral();
    quarry.board.setBias(null);
    tuning = createTownSession();
    sfx.play("open");
    ui.openSessionBoard();
    toast(
      `City upgrade — ${TUNING.moves} moves on the plant floor set the base rate for every Depot you have connected.`,
      "info",
    );
  }

  /**
   * L5 (#219): buy the next city upgrade.
   *
   * The three refusals are checked before anything is spent, like every other
   * purchase here: the loop has to have city upgrades (new loop only), no
   * other session may be open (one board, one session), and the purse has to
   * cover the row's full mix. What is bought then is not the bonus — it is the
   * SESSION: the cost is spent, the board comes up, and only a played session
   * confirms the upgrade (`closeTuningSession`). Walking away refunds the
   * whole cost, which is the ticket's "a city upgrade cannot be completed
   * without finishing its tuning session" made concrete.
   */
  function buyTownUpgrade(p: PlayerState = me, townId?: number): boolean {
    if (!newLoop) {
      toast("City upgrades are a new-loop building.", "info");
      return false;
    }
    // MP-05: the new loop is solo-only (L1a), so a guest never reaches this —
    // and if an older build asks anyway, the host owns the economy and this
    // seat would only spend cargo the host overwrites. Refuse, name why.
    if (isGuest()) {
      toast("The host owns the city upgrade in a hosted game.", "info");
      return false;
    }
    if (tuning) {
      toast("Finish the tuning session first — one session at a time.", "bad");
      return false;
    }
    // 2026-09: which city? A tapped town hall names it; otherwise one
    // upgradable city is it, and several light up for the player to pick.
    let target: Town | null = townId !== undefined ? grid.towns[townId] ?? null : null;
    if (!target) {
      const list = upgradableCities(p);
      // A seat with no city at all (no plant beside a town yet) keeps the old
      // seat-level upgrade, so nothing that worked before stops working.
      if (list.length === 0 && citiesOf(p).length === 0) return buyTownUpgradeSeat(p);
      if (list.length === 0) {
        const mine = citiesOf(p);
        toast(mine.length === 0 ? "You need a plant beside a town to have a city."
          : mine.some((t) => eco.townHolds?.get(t.id)?.locked) ? "Your cities are locked until you win them again."
            : "Your cities are fully upgraded.", "info");
        return false;
      }
      if (list.length > 1 && p === me) {
        setCityPick(true);
        toast("Tap the glowing town hall of the city to upgrade.", "info");
        return false;
      }
      target = list[0];
    }
    if (!citiesOf(p).some((t) => t.id === target!.id)) {
      toast("That is not your city — you need an open plant beside it.", "info");
      return false;
    }
    if (eco.townHolds?.get(target.id)?.locked) {
      toast("This city is locked until you win it again.", "bad");
      return false;
    }
    setCityPick(false);
    const city = cityOf(target, p);
    return buyTownUpgradeFor(p, city.level, target.id);
  }

  /** The seat-level upgrade (no city yet) — the pre-2026-09 behaviour. */
  function buyTownUpgradeSeat(p: PlayerState): boolean {
    return buyTownUpgradeFor(p, p.townLevel, null);
  }

  function buyTownUpgradeFor(p: PlayerState, level: number, townId: number | null): boolean {
    const price = priceTownUpgrade(p.purse, level);
    if (!price.def) {
      toast("The city is fully upgraded.", "info");
      return false;
    }
    if (!price.affordable) {
      toast(
        `A city upgrade costs ${costLabel(price.cost)} — you need ${shortfallLabel(price.missing, price.cost)}.`,
        "bad",
      );
      return false;
    }
    if (!spend(p, price.cost)) return false;      // guard; `price.affordable` holds
    townPaid = { ...price.cost };
    townTarget = townId;
    openTownSession();
    return true;
  }

  /**
   * #300 — a session's SETTLEMENT: every number closing it will write,
   * computed once. When a session ends into the results pop-up this is frozen
   * (`tuningResult`) and the card counts it up; its Confirm then applies this
   * same record field for field, so the yield on the card is the yield the
   * Depot gets. An abandon (and the settle-now twin) builds one on the spot
   * through the same function — one settle, whichever door closed it.
   */
  interface SessionSettlement {
    /** One per settlement: the pop-up keys its count-up on it. */
    id: number;
    kind: TuningSession["kind"];
    abandon: boolean;
    /** L4/L5's "played": not abandoned, and something was cleared. */
    played: boolean;
    /** How the session ended — the pop-up's heading. */
    reason: "out-of-moves" | "finished";
    score: number;
    stars: TuningStars;
    /** All the Gold it pays: the score's own, plus a Depot's overshoot. */
    coins: number;
    /** Depot: its level before, as stored (undefined = none stored). */
    prev: number | undefined;
    /** Depot: the outcome — `outcome.yield` is what the record is set to. */
    outcome: TuningOutcome | null;
    /** City: the town it upgrades (null = the pre-city seat upgrade). */
    townId: number | null;
    /** City: the tier and bonus before, and the bonus it sets. */
    cityLevel: number;
    cityBonus: number;
    bonus: number;
  }

  /**
   * #300: settle a session — READ ONLY. Every rule the close has always
   * applied is here, unchanged, and nothing is written:
   *
   *   • L6 (#220): the difficulty sits between the score and the record — the
   *     score maps onto THIS row's floor (Easy's is raised) and, on
   *     `yieldNeverDrops`, the better of the old and new levels lands;
   *   • 2026-09: a Depot's LEVEL caps what its session can set (L1 ×2, L2 ×4,
   *     L3 ×6), and the score played past the cap pays Gold instead;
   *   • L9 (#224): the session is THE Gold source on the new loop — its score
   *     pays coins on the same curve for both kinds of session, and an
   *     abandoned one pays none, so a difficulty row that lifts the yield does
   *     not silently lift the purse too;
   *   • L5 (#219): a city session sets how much of its row's ceiling lands
   *     (`townBonusFor`), clamped by the same `yieldNeverDrops`.
   */
  function settleSession(
    s: TuningSession, abandon: boolean, reason: SessionSettlement["reason"] = "finished",
  ): SessionSettlement {
    const rules = difficultyRules();
    // L4/L5: a session that cleared nothing was not "finished" in any sense
    // the tickets mean — every outcome reads this, not the raw flag. It is
    // what makes L5's gate a gate (a rung or a city upgrade confirmed by an
    // empty board is no gate at all).
    const played = !abandon && s.score > 0;
    const base: SessionSettlement = {
      id: ++settleSeq, kind: s.kind, abandon, played, reason, score: s.score,
      stars: abandon ? 0 : tuningStarsFor(s.score), coins: 0,
      prev: undefined, outcome: null, townId: null, cityLevel: 0, cityBonus: 0, bonus: 0,
    };
    if (s.kind === "town") {
      // An abandon is never shown, and the refund below is all it does.
      if (abandon) return base;
      const coins = tuningSessionGold(s);
      const targetTown = grid.towns[townTarget ?? townOfSeat(me)?.id ?? -1] ?? null;
      const city = targetTown ? cityOf(targetTown, me) : { owner: me.id, level: me.townLevel, bonus: me.townBonus };
      const at = { townId: targetTown?.id ?? null, cityLevel: city.level, cityBonus: city.bonus };
      // An empty session confirms nothing: the city keeps the bonus it has —
      // the number the pop-up shows as unchanged (and the upgrade is refunded).
      if (!played) return { ...base, ...at, coins, bonus: city.bonus };
      const row = TOWN_UPGRADES[city.level] ?? TOWN_UPGRADES[TOWN_UPGRADES.length - 1];
      // Easy and Normal keep what they have (the city can only improve); Hard
      // is the row where a badly played upgrade really does cost. Easy's
      // generosity is the curve itself — any played session already banks
      // the bottom 40% of the ceiling.
      const next = townBonusFor(row?.bonus ?? 0, s.score);
      const bonus = rules.yieldNeverDrops ? Math.max(city.bonus, next) : next;
      return { ...base, ...at, coins, bonus };
    }
    // A Depot demolished under its session is simply not found: the settle
    // still prices the score (the Gold is paid), and there is no record to set.
    const depot = eco.harvesters.find((h) => h.id === s.depotId);
    const prev = depot?.yield;
    const outcome = depotSessionOutcome(s.score, prev, rules, { abandon, cap: depotYieldCap(depot?.level) });
    return { ...base, coins: outcome.gold, prev, outcome };
  }

  /** #300: the pop-up's copy of a frozen settlement (built once, when it froze). */
  function resultUiOf(r: SessionSettlement, s: TuningSession): UiTuningResult {
    const base = {
      id: r.id, kind: r.kind, cargo: s.cargo, reason: r.reason, score: r.score, stars: r.stars,
      starScores: tuningStarScores(), verdict: tuningStarLabel(r.stars), gold: r.coins,
      movesLeft: tuningMovesLeft(s), moves: s.moves,
    };
    if (r.kind === "town") {
      // Exactly what the city branch of the close writes: the new bonus when
      // the session was played (never 0 then), the old one when it was not.
      return {
        ...base, from: r.cityBonus,
        to: r.played && r.bonus > 0 ? r.bonus : r.cityBonus, refund: !r.played,
      };
    }
    const o = r.outcome!;
    const depot = eco.harvesters.find((h) => h.id === s.depotId);
    return {
      ...base, platform: !!depot && isRailDepot(depot),
      from: o.from, to: o.yield, cap: o.cap, capped: o.capped, kept: o.kept, overGold: o.overshootGold,
    };
  }

  /**
   * #300 — END the session: freeze its settlement and hand the screen to the
   * results pop-up. The session stays open underneath (the window, the plate,
   * the final board) until Confirm applies exactly what the card shows.
   *
   * Two things end a session: its budget running out once the board has
   * settled (`quarryTick`), and Finish (`requestTuningFinish`). A Finish that
   * arrives mid-cascade is remembered instead of cutting the cascade short —
   * the board stops taking moves at once, and the session ends the moment the
   * last pass lands, so the score the stars rate is the whole score.
   * Returns true when the results are up.
   */
  function endTuningSession(): boolean {
    const s = tuning;
    if (!s) return false;
    if (tuningResult) return true;
    if (quarry.board.busy) {
      tuningEndAsked = true;
      return false;
    }
    tuningEndAsked = false;
    tuningResult = settleSession(s, false, tuningOver(s) ? "out-of-moves" : "finished");
    tuningResultUi = resultUiOf(tuningResult, s);
    return true;
  }

  /**
   * #300: the plate's Finish key. With moves left or none, it ends the session
   * into its results pop-up (the same pop-up running out of moves opens); with
   * the pop-up already up it is that pop-up's Confirm — Finish has always
   * meant "keep what I earned".
   */
  function requestTuningFinish(): void {
    if (!tuning) return;
    if (tuningResult) { confirmTuningResult(); return; }
    endTuningSession();
  }

  /** #300: the results pop-up's Confirm — settle exactly the frozen result. */
  function confirmTuningResult(): void {
    if (!tuning || !tuningResult) return;
    closeTuningSession(false);
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
   *
   * L5 (#219): the same door closes a city-upgrade session, where "played"
   * has a second meaning — a session that cleared nothing confirms nothing, so
   * it is treated exactly like an abandonment and the cost goes back. That is
   * what makes the gate a gate and not a formality: the upgrade lands only
   * when the board was really played.
   *
   * #300: this is also where the results pop-up's Confirm lands. A result the
   * pop-up is showing is applied EXACTLY as shown — Confirm, the settle-now
   * twin (`__iso.tuningFinish`) and a Depot demolished under the card all use
   * the frozen settlement; only an abandon throws it away. With no pop-up up
   * the session is settled here and now, by the same `settleSession`.
   */
  function closeTuningSession(abandon: boolean, note?: string): void {
    const s = tuning;
    if (!s) return;
    const r = !abandon && tuningResult ? tuningResult : settleSession(s, abandon);
    tuningResult = null;
    tuningResultUi = null;
    tuningEndAsked = false;
    tuning = null;
    quarry.board.setBias(null);
    const played = r.played;
    // A town session has no Depot (`depotId` is -1), so this is `undefined`
    // there and the city branch below settles instead.
    // L10 (#225): the obstacles belong to the SESSION, so they go when it does
    // — the board the player is left looking at (the map, or the plant plate's
    // idle line) is never a board with ice on it and no session behind it. In
    // place, not `resetNeutral`: a cascade the last move started may still be
    // in the air, and this session's board is not what the next one deals.
    sessionObstacles = null;
    quarry.board.clearObstacles();
    const depot = eco.harvesters.find((h) => h.id === s.depotId);
    const rules = difficultyRules();
    // L9 (#224): the session is also THE Gold source on the new loop (the
    // board's combo coin stopped paying, `payGold: !newLoop`). Paid here,
    // above the branches, because both kinds of session (L5: a Depot's, or
    // the city's) pay it on the same curve — `settleSession` priced it, and
    // the results pop-up showed exactly this sum.
    const coins = r.coins;
    if (coins > 0) {
      earn(me, { gold: coins });
      sfx.play("coin");     // SFX-01: the same two coins the combo used to ring
    }
    const paid = coins > 0 ? ` +${coins} ${CARGO.gold.icon}` : "";
    // L5 (#219): the city upgrade is a different settlement entirely — the
    // base-rate bonus instead of a Depot's yield, and a full refund when the
    // session was abandoned (or played for nothing), because no building
    // stands for it yet.
    if (s.kind === "town") {
      const refund = townPaid;
      townPaid = null;
      if (!played) {
        if (refund) earn(me, refund);
        toast(
          note ?? (refund
            ? `City upgrade abandoned — ${costLabel(refund)} returned. The city is unchanged.`
            : "City upgrade abandoned. The city is unchanged."),
          "info",
        );
        ui.closeSessionBoard();
        rescoreNow();
        return;
      }
      const targetTown = r.townId === null ? null : grid.towns.find((t) => t.id === r.townId) ?? null;
      townTarget = null;
      // L6 (#220) arrives here too, because the ticket asks for it: the score
      // sets how much of the ceiling lands (`townBonusFor`), and the row's
      // `yieldNeverDrops` decides whether a poor session may take some of it
      // BACK. Both were settled in `settleSession` — this is the bonus the
      // results pop-up showed.
      const bonus = r.bonus;
      if (targetTown) {
        cityTiers.set(targetTown.id, {
          owner: me.id, level: Math.min(r.cityLevel + 1, TOWN_UPGRADES.length),
          bonus: bonus > 0 ? bonus : r.cityBonus,
        });
        syncSeatCities(me);
      } else {
        if (bonus > 0) me.townBonus = bonus;
        me.townLevel = Math.min(r.cityLevel + 1, TOWN_UPGRADES.length);
      }
      // L17 (#245): the town on the map takes the step with the seat — the
      // one the buyer's Factory touches — with the growth moment (art swap,
      // tile invalidation, float) on top. With no Factory standing there is
      // nothing to grow yet; the next upgrade will catch the map up.
      const grown = targetTown ? growCity(targetTown, me) : growTownForSeat(me);
      // Gold follows the score here too (L9's one session, one payout), on the
      // same curve a Depot's session uses.
      ui.feed(`City upgrade: base rate +${Math.round(bonus * 100)}%${paid} (score ${s.score})`, me.name);
      toast(
        `City upgraded — base rate +${Math.round(bonus * 100)}%${paid}.`
        + (grown ? ` Your ${townTierLabel(townTier(grown))} grows on the map — click its bank for the next step.` : "")
        + ` Every connected Depot ticks faster from here.`,
        bonus > 0 ? "good" : "info",
      );
      ui.closeSessionBoard();
      rescoreNow();
      return;
    }
    if (depot && r.outcome) {
      // The settlement's numbers (`settleSession`): the level the Depot was
      // paying at, and the level that lands — the results pop-up's `to`.
      const prev = r.prev;
      const level = r.outcome.yield;
      // Stored on the depot record, which is what the L1b clock multiplies by
      // — and what the snapshot (yield + tuneTier) and the savegame (harvesters)
      // carry.
      depot.yield = level;
      // L5 (#219) — THE SESSION GATE: finishing a session that was actually
      // PLAYED opens the next rung of the depot tree for the seat that owns
      // the Depot. The seat, not "me": a depot session only opens for the
      // local human seat today, but the rule belongs to the record.
      const seat = players.find((x) => x.id === depot.owner) ?? me;
      const rungBefore = Math.min(seat.depotTier, DEPOT_TIER_MAX);
      seat.depotTier = unlockTierAfterSession(rungBefore, played ? s.score : 0);
      const rung = seat.depotTier > rungBefore
        ? ` ${rungLabel(seat.depotTier)} — new Depot types are open.`
        : "";
      // `undefined` here marked "this Depot has never settled a session", which
      // is the one thing the copy below needs to know: a player who has just
      // played their ONE session on Easy must not be told a re-match awaits.
      const first = depot.tuneTier === undefined;
      // The credit is spent against the tier the Depot stands on NOW, so an
      // upgrade it already had when it was tuned cannot pay for a second
      // session and one it buys later can.
      depot.tuneTier = depotTier(depot);
      // Gained/lost are measured against the level the Depot was actually
      // paying at, which for a never-tuned Depot is the default the old loop
      // shipped with — that is what makes Easy's raised floor read as a gain on
      // the very first session, instead of "the default" for a number the
      // player just played for.
      const before = prev ?? TUNING_ABANDON_YIELD;
      const gained = level > before;
      const lost = level < before;
      const after = rules.rematch === "never" ? "That is this Depot's one session."
        : rules.rematch === "upgrade" ? "Another comes with your next upgrade."
          : "You can re-tune it from the plant panel.";
      toast(
        note ?? ((gained
          ? `Depot tuned — ${s.score} score, yield ×${level}.${paid} It ticks faster from here.`
          : lost
            ? `Depot re-tuned badly — yield ×${before} → ×${level}.${paid} and nothing recovers it but a better session. ${after}`
            : `Depot tuned — yield ×${level}${first ? " (the default)." : paid} ${
              first ? "A better session raises it."
                : rules.yieldNeverDrops ? "Kept: a session never lowers a Depot." : ""
            } ${after}`) + rung),
        gained ? "good" : lost ? "bad" : "info",
      );
      ui.feed(`Depot tuned: yield ×${level}${paid}${rung}`, me.name);
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
  /** L6: `retuneCandidates`' memo — the key inside the scan is why it is safe. */
  let retuneCache: {
    key: string; list: { depot: Harvester; yield: number; tier: number }[];
  } | null = null;

  /**
   * L6 (#220): the tier a Depot's link is worth RIGHT NOW — the axis Normal's
   * re-match credit is counted on.
   *
   * It resolves over the LIVE track instead of through the inspector's
   * `componentsFor` cache: that cache is keyed on `netVersion`, and a tier that
   * lags a world edit by one rescore would make the re-match offer wrong for a
   * beat every time a road changed. `track.revision` is bumped by every tile
   * write, so the scan reruns on exactly the moments that can change the answer
   * — and only the truth of the map decides it, which is also why no save can
   * claim an upgrade it never built (see `transportTierOf`).
   */
  function depotTier(depot: Harvester, comp?: Components): number {
    const c = comp ?? buildAllComponents(eco.track, ownerIdOf(eco, depot.owner));
    // L14 (#229): the rule itself lives in `loop.ts` now — the rival's
    // re-match and the race harness read the same function.
    return depotTransportTier(eco, c, depot);
  }

  /**
   * L6 (#220): the player's Depots a re-tune is OWED on, weakest first.
   *
   * One scan, no per-difficulty branches: `retuneOwed` answers "never" for the
   * Easy row without this function knowing which difficulty is on, Hard's
   * low-output Depot rises to the top because the sort is on the live yield
   * (the cooling pass has been shaving it for the last few minutes), and a Depot
   * whose session is still up is skipped. The plate reads the head of the list
   * for its one key and `retuneNow` takes the same list, so the copy and the
   * action can never point at different Depots.
   */
  function retuneCandidates(): { depot: Harvester; yield: number; tier: number }[] {
    if (!newLoop) return [];
    const rules = difficultyRules();
    // Read every frame (the plate paints from it), so it is cached on precisely
    // the inputs the answer depends on: the difficulty row, the map the tiers
    // are derived from, whose session is up, and each Depot's stored level and
    // spent credit. A decay tick changes a level, so the scan reruns once on
    // that tick and never again while the map is idle — the same `key`-string
    // trick `vpTipCache` and `routeOverlayFor` use. One flood pair serves the
    // whole scan, because every Depot in it belongs to this seat.
    const mine = eco.harvesters.filter((h) => h.owner === me.id);
    const key = `${skillKey}|${eco.track.revision}|${tuning?.depotId ?? -1}|`
      + mine.map((h) => `${h.id}:${h.yield ?? "-"}:${h.tuneTier ?? "-"}`).join(",");
    if (retuneCache?.key === key) return retuneCache.list;
    const comp = buildAllComponents(eco.track, ownerIdOf(eco, me.id));
    const out: { depot: Harvester; yield: number; tier: number }[] = [];
    for (const depot of mine) {
      if (tuning && tuning.depotId === depot.id) continue;
      const tier = depotTier(depot, comp);
      if (!retuneOwed(rules, { tier, tuneTier: depot.tuneTier })) continue;
      out.push({ depot, yield: depotYield(depot), tier });
    }
    // Weakest first: "a low-output Depot invites a re-match" IS this sort, not a
    // special case. Ties fall to the older Depot so the offer is stable.
    const list = out.sort((a, b) => a.yield - b.yield || a.depot.id - b.depot.id);
    retuneCache = { key, list };
    return list;
  }

  /**
   * The plant plate's single re-match offer — the head of `retuneCandidates`, or
   * null when there is nothing to offer. Easy always answers null (its row says
   * `rematch: "never"`), so the plate there keeps the shipped "build a Depot"
   * line instead of a key that would refuse to work.
   */
  function retuneOffer() {
    const head = retuneCandidates()[0];
    if (!head) return null;
    return {
      depotId: head.depot.id,
      cargo: tuningCargoFor(head.depot),
      yield: head.yield,
      // Hard is the row where saying the number out loud matters: there an
      // empty session is a real loss, and the key says so before the click.
      risks: !difficultyRules().yieldNeverDrops,
    };
  }

  /**
   * What the plant plate paints while it is UP and no session is open — and
   * `null` when it has something better to say (a live session) or when the
   * plate is not part of this loop at all. `ui.paint` and `__iso.tuningIdle`
   * both read this one object, so the difficulty's promise, its floor and its
   * offer are never two sources of truth, and the UI never forks on a
   * difficulty: it prints what it is handed.
   */
  function tuningIdleInfo(): {
    idle: true; retune: ReturnType<typeof retuneOffer>; economyLine: string; yieldFloor: number;
  } | null {
    if (!newLoop || tuning) return null;
    return {
      idle: true,
      retune: retuneOffer(),
      economyLine: skill().economyLine,
      yieldFloor: difficultyRules().minYield,
    };
  }

  /**
   * The plate's Retune key (and `__iso.retuneDepot`'s). The rules the key's
   * visibility already applied are re-checked here, because a keyboard or debug
   * caller never went through the key: no re-match on Easy, no credit on
   * Normal, one session at a time on all three.
   */
  function retuneNow(depotId?: number): boolean {
    if (!newLoop) return false;
    if (tuning) {
      toast("Finish the tuning session first — one Depot is tuned at a time.", "bad");
      return false;
    }
    const rules = difficultyRules();
    if (!rules.matchEnabled) {
      toast("Match-3 is off on this mode.", "info");
      return false;
    }
    if (rules.rematch === "never") {
      toast(`No re-match on ${skill().label} — the session a Depot is built with is the only one.`, "info");
      return false;
    }
    const list = retuneCandidates();
    const head = depotId === undefined ? list[0] : list.find((c) => c.depot.id === depotId);
    if (!head) {
      toast(rules.rematch === "upgrade"
        ? "No Depot is due a re-tune — one comes with each upgrade."
        : "No Depot to re-tune yet — build one first.", "info");
      return false;
    }
    // 2026-09: a retune is open any time, and costs half a Depot.
    if (!spend(me, DEPOT_RETUNE_COST)) {
      toast(`A retune costs ${costLabel(DEPOT_RETUNE_COST)}.`, "bad");
      return false;
    }
    openTuningSession(head.depot, true);
    return true;
  }

  /**
   * 2026-09: upgrade one of MY Depots a level (cap L1 ×2 → L2 ×4 → L3 ×6).
   * Costs what building a Depot costs, and opens a tuning session at once so
   * the new headroom can be played into straight away (like the city).
   */
  function upgradeDepot(depotId: number): boolean {
    if (!newLoop) return false;
    const d = eco.harvesters.find((h) => h.id === depotId && h.owner === me.id);
    if (!d) return false;
    if (tuning) { toast("Finish the tuning session first.", "bad"); return false; }
    const lvl = d.level ?? 1;
    if (lvl >= DEPOT_LEVELS.max) { toast("That Depot is already at the top level.", "info"); return false; }
    if (!spend(me, DEPOT_UPGRADE_COST)) {
      toast(`A Depot upgrade costs ${costLabel(DEPOT_UPGRADE_COST)}.`, "bad");
      return false;
    }
    d.level = lvl + 1;
    toast(`Depot upgraded to level ${d.level} — its yield cap is now ×${depotYieldCap(d.level)}. Tune it up!`, "good");
    ui.feed(`Depot upgraded to level ${d.level} (cap ×${depotYieldCap(d.level)})`, me.name);
    rescoreNow();
    openTuningSession(d, true);
    return true;
  }

  /** 2026-09: the Depot card a click on one of my Depots opens. */
  function depotCardFor(d: Harvester): void {
    const lvl = d.level ?? 1;
    ui.showDepotCard({
      title: `${(() => { const c = depotCargo(eco, d); return c ? DEPOT_TREE[c].name : "Depot"; })()} · level ${lvl}`,
      yieldNow: depotYield(d),
      cap: depotYieldCap(lvl),
      nextCap: lvl < DEPOT_LEVELS.max ? depotYieldCap(lvl + 1) : null,
      upgradeCost: costLabel(DEPOT_UPGRADE_COST),
      retuneCost: costLabel(DEPOT_RETUNE_COST),
      busy: !!tuning,
      onUpgrade: () => upgradeDepot(d.id),
      onRetune: () => retuneNow(d.id),
    });
  }
  /** My Depot whose 2×2 lot covers this tile, if any. */
  const myDepotAt = (tx: number, ty: number): Harvester | null => {
    // A platform-Depot is clicked on its platform (any of its three tiles).
    const onPlatform = structureAt(rail, tx, ty);
    return eco.harvesters.find((h) => h.owner === me.id && (isRailDepot(h)
      ? onPlatform?.id === h.platformId
      : tx >= h.tx && tx <= h.tx + 1 && ty >= h.ty && ty <= h.ty + 1)) ?? null;
  };

  /**
   * L14 (#229) returns WHICH Depots this pass levelled (the cooling pass must
   * not cool a level assigned inside the same tick).
   *
   * L13 (#228) needs a second answer from the same pass: whether it opened a
   * RUNG, because a rung is a ★ now and every path that opens one has to
   * rescore or the rival's star waits for its next build. That rides on
   * `rungOpened` rather than the return value, so L14's `Set` stays the
   * signature every caller already reads.
   */
  let rivalRungOpened = false;
  function applyRivalTuning(): Set<number> {
    rivalRungOpened = false;
    if (!newLoop) return new Set();
    const key = skill().key;
    // L10 (#225): the rival plays no board, so the obstacles its difficulty
    // puts on one are taken off its simulated session instead — the same table
    // the player's board is seeded from, read at this Depot's tier. This is
    // what replaced `rival-plant.ts`'s damage model: the cost of a hard board
    // is charged once, at the tune, and never melts off on a timer.
    const rules = difficultyRules();
    // One flood fill for the rival's whole network, shared by every Depot in
    // the scan — `depotTier` resolves through it instead of rebuilding the
    // components per Depot (the L6 cache in `retuneCandidates` does the same
    // for the player's seat).
    const comp = buildAllComponents(eco.track, ownerIdOf(eco, rival.id));
    // L14 (#229): which Depots THIS call levelled. The clock hands it to the
    // cooling pass, because a level assigned inside a tick must not be cooled
    // by the same tick — the player's session settles between ticks, and the
    // rival's simulated one has to land the same way or its every fresh tune
    // would immediately shed a tick's worth of decay (2.20 → 2.18 on Hard,
    // measured). A later tick cools it like any other.
    const tuned = new Set<number>();
    let simulated = false;
    for (const h of eco.harvesters) {
      if (h.owner !== rival.id || h.yield !== undefined) continue;
      const tier = depotTier(h, comp);
      h.yield = Math.min(depotYieldCap(h.level), rivalTuningYield(key, 0, rules, tier));
      tuned.add(h.id);
      // L14 (#229): the tier the session settled on, stamped exactly as a
      // played session stamps it (`settleSession` above). Without it the L6
      // re-match credit is UNREADABLE for a rival Depot — `retuneOwed` reads
      // `tuneTier` against the live tier, and `undefined` is what "never
      // settled" means — so a Normal rival could never re-tune the Depot it
      // paved, which is precisely the one the player gets a key for.
      h.tuneTier = tier;
      simulated = true;
      // L9 (#224): the simulated session pays the rival the same Gold a
      // played one pays the player, through the same score→Gold curve. This
      // is what keeps its raid table funded once combo Gold stops paying —
      // "Gold still reaches BOTH players at a steady rate without constant
      // matching" is one rule applied twice, not two balance numbers.
      const coins = rivalTuningGold(key, 0, rules, tier);
      if (coins > 0) earn(rival, { gold: coins });
    }
    // L5 (#219): the rival passes the SAME session gate (#229 L14): a
    // simulated session that tuned a Depot is a session it played, and it
    // opens the next rung of the tree for the rival. One rung per call — the
    // turn's own pacing, not the number of Depots that landed in it — so its
    // progression is bounded by turns exactly as the player's is by sessions.
    //
    // L13 (#228): a rung is worth a ★ now, so the caller is told whether one
    // moved — every path that opens a rung has to rescore, or the rival's
    // star would wait for its next build.
    if (simulated) {
      const before = rival.depotTier;
      rival.depotTier = unlockTierAfterSession(rival.depotTier, 1);
      rivalRungOpened = rival.depotTier > before;
    }
    return tuned;
  }

  /**
   * L14 (#229) — the rival's RE-MATCH: what a seat does about L6's cooling.
   *
   * The player meets decay with the plant plate's Re-tune key, and the key's
   * rule is one predicate (`retuneOwed`): never on Easy, once per transport
   * tier a Depot has moved up on Normal, any time on Hard. The rival reads the
   * SAME predicate and plays the SAME session — simulated, off `tuningSkill`,
   * settled through `settleTuningYield`, so Normal's "a yield never drops" and
   * Hard's "a bad session can cost you" apply to it as they do to the player
   * — and then stamps the tier it settled on, which is what spends the credit.
   *
   * The one judgement the player makes by hand and this makes by number: WHEN
   * a session is worth a turn. On Hard every Depot is permanently due, and a
   * rival that spent every turn re-tuning would never expand again. So it
   * re-tunes a Depot that has actually COOLED — `RIVAL_REMATCH_DROP` below
   * what a fresh session would set it to — which is the same "this one is
   * worth the key" call the plate's weakest-Depot-first sort invites. A
   * re-tune always IMPROVES the level (a session that would not is not taken),
   * so nothing here can shave the rival's own economy.
   *
   * Returns true when the re-tune was the turn's action.
   */
  function rivalRetuneStep(): boolean {
    if (!newLoop) return false;
    const rules = difficultyRules();
    if (!rules.matchEnabled) return false;
    const comp = buildAllComponents(eco.track, ownerIdOf(eco, rival.id));
    const key = skill().key;
    const due = eco.harvesters
      .filter((h) => h.owner === rival.id)
      .map((h) => {
        const tier = depotTier(h, comp);
        const level = depotYield(h);
        const fresh = settleTuningYield(level, rivalTuningScore(key, 0, rules, tier), rules);
        return { h, tier, level, fresh };
      })
      // Lowest-yield Depot first (the plate's own sort), and only one that has
      // something to gain.
      .filter(({ h, tier, level, fresh }) =>
        fresh > level + 1e-9
        && retuneOwed(rules, { tier, tuneTier: h.tuneTier })
        && level <= fresh * (1 - RIVAL_REMATCH_DROP))
      .sort((a, b) => a.level - b.level || a.h.id - b.h.id);
    const head = due[0];
    if (!head) return false;
    head.h.yield = head.fresh;
    head.h.tuneTier = head.tier;
    ui.feed(`Rival re-tunes a Depot: yield ×${head.fresh}`, rival.name);
    return true;
  }

  function placeHarvester(tx: number, ty: number, p: PlayerState): boolean {
    // The 2×2 truck Depot: the SAME plan the preview paints and the host
    // validates — four buildable tiles, no overlap with a Depot or a Factory,
    // a resource right beside the lot, an open side for the entrance, and
    // (PP-16) a resource beside it that nobody's road already holds.
    const plan = planDepotPlacement(grid, eco.harvesters, tx, ty, depotLocksFor(p.id));
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
    //
    // L5 (#219): the price is the TYPE's price — the cargo of the industry this
    // Depot would hold — and the type also has to sit on a rung the seat has
    // unlocked. Both refusals happen here, before anything is spent, and each
    // names its own blocker (money vs progression), exactly like every other
    // refusal in this function.
    // L5 (#219): the type this Depot would be — the biggest industry it would
    // hold, by the same shared `depotCargo` rule that scopes its tuning
    // session once it stands. `h` is not in `eco.harvesters` yet, so this is a
    // quote: what the click would buy, not what a rebuilt network would leave
    // it holding.
    const cargo = newLoop ? depotCargo(eco, h) : null;
    const price = priceDepot(p.purse, p.freeDepots, { cargo, tier: p.depotTier, newLoop });
    if (price.locked && price.type) {
      const need = price.tier + 1;
      toast(
        `A ${price.type.name} needs rung ${need} of the depot tree — ${rungLabel(p.depotTier)}. Tune a Depot to open it.`,
        "bad",
      );
      if (p.human) flashAt(tx, ty, `${price.type.name}: rung ${need} locked`);
      return false;
    }
    if (!price.affordable) {
      const label = depotTypeLabel(price.type);
      toast(`A ${label} costs ${costLabel(price.cost)} — you need ${shortfallLabel(price.missing, price.cost)}.`, "bad");
      if (p.human) flashAt(tx, ty, `Needs ${costCompact(price.cost)}`);
      return false;
    }
    if (!spend(p, price.cost)) return false;      // guard; `price.affordable` holds
    p.freeDepots = price.freeLeft;
    // L4 (#218): under the new loop every Depot is BORN at the default yield
    // and is then tuned. A level is never absent, so a mid-session reload or a
    // depot the player never got round to tuning still ticks (and still
    // round-trips the wire/save as a number).
    // L6 (#220): "born at the default" is now "born at the difficulty's floor" —
    // Easy raises it to 1.5, Normal and Hard keep the shipped baseline, and it
    // is the SAME number an abandoned session pays, so a Depot the player never
    // got round to tuning is exactly as good as one they abandoned on purpose.
    if (newLoop) h.yield = birthYieldFor(difficultyRules());
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
    const blocked = townBlockedFor(p, tx, ty);
    if (blocked) {
      if (p.human) { toast(blocked, "bad"); flashAt(tx, ty, "Rival's town"); }
      return false;
    }
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
      dropPlatformDepot(rs.id);
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
    const hi = eco.harvesters.findIndex((h) => !isRailDepot(h) && depotContains(h.tx, h.ty, tx, ty) && h.owner === p.id);
    if (hi >= 0) {
      const removed = eco.harvesters[hi];
      eco.harvesters.splice(hi, 1);
      // L1e (#236): a removed Depot's banked remainder goes with it. No depot
      // is left to pay it to, and a stale id must not ride the save forever
      // (or come back as a ghost entry the next restore would carry).
      loopCarry.delete(removed.id);
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
    // Demolition refunds. A paved Road pays nothing back: its price is
    // dominated by 4 Ore, and the dirt→road pave is what upgrades are for.
    // L2 (#216) and PP-07 made dirt free outright (BUILD_COSTS.dirt = {}),
    // so tearing it up salvages nothing on EITHER loop — a free tile must
    // not mint resources. Tearing it up is free re-routing.
    // SFX-01: timber coming apart — a little further away for a single tile
    // of track than for a whole building.
    if (p.human) sfx.play("demolish", removedKind === "dirt" ? undefined : { gain: 0.8 });
    if (removedKind === "dirt") toast("Dirt Road cleared.", "info");
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
    }
    syncWorld();
    rescoreNow();
  }

  // ── Protests: the Black Market's roadblock ─────────────────────────────────
  // A protest is a tile + an expiry, bought with Gold and staged on any PUBLIC
  // road (highways and town streets — `isPublicRoad`). Two things happen while
  // it stands, and they are the same fact told twice:
  //
  //   • every lorry whose next tile is that one holds where it is (`tickTrucks`'
  //     `blocked` set) — the visible half, unchanged;
  //   • L9 (#224): every DEPOT whose road route (the L3 path the lorry drives)
  //     crosses the protested tile stops ticking income — the mechanical half.
  //     Trucks are cosmetic after L7, so "the trucks stop" cannot be the whole
  //     rule any more: under the clock economy a roadblock has to bite the
  //     clock, and `protestedDepot` below is where it does.
  //
  // It blocks YOUR routes too — that is the card's whole tension.
  interface Protest { tx: number; ty: number; until: number; owner: string }
  const protests = new Map<number, Protest>();
  /**
   * L9 (#224): is this depot's route cut by a protest right now?
   *
   * The route is the SAME one the lorry drives and the hover overlay paints
   * (`roadRouteForHarvester`), so "the truck is stuck behind the crowd" and
   * "this depot is not paying" are one answer, never two. A depot with no road
   * route (rail-only, or nothing connected) is never protested — there is no
   * path for a crowd to sit on.
   *
   * Security Forces are the defence: a guarded owner's depots keep ticking
   * through a protest, exactly as they shrug off a Blockade.
   */
  function protestedDepot(depot: Harvester, now: number, comp?: Components): boolean {
    if (!protests.size) return false;
    const owner = players.find((p) => p.id === depot.owner);
    if (owner && now < securityOf(owner.id)) return false;
    const route = roadRouteForHarvester(eco, depot, comp);
    if (!route) return false;
    for (const [x, y] of route) {
      const p = protests.get(tIdx(x, y));
      if (p && p.until > now) return true;
    }
    return false;
  }
  /** A bought protest waiting for its tile — map clicks stage it, Esc cancels. */
  let pendingProtest = false;
  /**
   * L9 (#224): where a Protest bought AGAINST `victim` should stand.
   *
   * The rival has no crosshair, so its raid needs the same "one rival, no
   * targeting step" treatment `pickBlockadeTarget` gives a Blockade: the
   * public-road tile that the MOST of the victim's paying routes run through
   * — the crowd that costs it the most ticks. Ties go to the lowest tile
   * index, so the choice is deterministic on a seed (no RNG at all).
   *
   * Null when the victim has no route over a free public road: a protest with
   * nowhere to bite is not bought (the raid leaves its clock un-stamped and
   * tries again), so the rival can never burn Gold on an empty gesture.
   */
  function pickProtestTarget(victim: string, now: number): [number, number] | null {
    const counts = new Map<number, number>();
    const comp = buildAllComponents(eco.track, ownerIdOf(eco, victim));
    for (const depot of eco.harvesters) {
      if (depot.owner !== victim) continue;
      const route = roadRouteForHarvester(eco, depot, comp);
      if (!route) continue;
      for (const [x, y] of route) {
        if (!isPublicRoad(track, x, y)) continue;    // protests go on public roads
        const i = tIdx(x, y);
        const standing = protests.get(i);
        if (standing && standing.until > now) continue;   // one crowd per tile
        counts.set(i, (counts.get(i) ?? 0) + 1);
      }
    }
    let best = -1, bestN = 0;
    for (const [i, n] of counts) {
      if (n > bestN || (n === bestN && best >= 0 && i < best)) { best = i; bestN = n; }
    }
    if (best < 0) return null;
    return [best % MAP_W, (best / MAP_W) | 0];
  }
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
    ui.feed(`You stage a protest on the public road — every depot routed through it stops for ${fmtProtestLeft(PROTEST_MS)}.`);
    toast(`Protest placed — every depot routed through that tile stops ticking for ${fmtProtestLeft(PROTEST_MS)}, yours included.`, "good");
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

  // ── Black Market: MAP-ONLY sabotage (L9 #224) ────────────────────────────
  // Two cards act on the WORLD — a Blockade on an industry and a Protest on a
  // public road — and one defence (Security Forces) turns both away. Nothing
  // in here reaches into a match-3 board any more.
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
  /**
   * L9 (#224): every key the Black Market still answers to — the two map
   * cards (priced in `SABOTAGE`) plus the material-priced defence. Derived
   * from the table, so retiring a card is a one-line config change and the
   * UI, the intents and the rival's raid table all follow.
   */
  const BLACK_MARKET_ACTIONS: ReadonlySet<string> = new Set([...Object.keys(SABOTAGE), "security"]);

  /**
   * The shared Black-Market core behind every seat's card. Returns whether
   * the card resolved (charged, or legitimately refused without a charge);
   * its feedback is toasts, so an intent echoes exactly what a click said.
   */
  /**
   * B5 (#250) — battles on the map. The pure rules live in `battle-map.ts`;
   * this block is the game wiring: the Gold, the screens, the economy pause
   * (the three tick entry points bail on `battleScreen`) and the settle hook.
   * The state rides the wire + saves with the economy — the host owns it (MP
   * battle intents are B6, #251; `isMp()` keeps fight-offs solo-only for now).
   */
  const challengeState: ChallengeState = createChallengeState();
  let pendingFightOff: PendingFightOff | null = null;
  let pendingChallenge: {
    kind: "industry" | "town";
    industryId?: number;
    townId?: number;
    challengerId: string;
    holderId: string | null;
    challengerHarvesterId: number;
    holderHarvesterId: number;
    offerUntil: number;
  } | null = null;
  let mapStake: MapBattleStake | null = null;
  /** The action-card currently shown for a battle offer (so stale ones close). */
  let battleCardKey = "";

  /** The seat's castable cargoes — its depots' harvests (B3's ability gate). */
  const mapDepotCargos = (ownerId: number): Cargo[] => {
    const out = new Set<Cargo>();
    for (const hd of eco.harvesters) {
      if (hd.ownerId !== ownerId) continue;
      const c = depotCargo(eco, hd);
      if (c) out.add(c);
    }
    return [...out];
  };

  const hid = (h: { id: number } | null | undefined): number => h?.id ?? -1;
  const seatName = (id: string | null | undefined): string =>
    id === me.id ? "You" : id === rival.id ? rival.name : (id ?? "Unclaimed");
  const industryName = (id: number | undefined): string =>
    INDUSTRY_BY_KEY[grid.industries[id ?? -1]?.type ?? ""]?.name ?? "the industry";
  const townName = (id: number | undefined): string =>
    id == null ? "the city" : `Town ${id + 1}`;
  const pavedCountOf = (p: PlayerState): number => {
    let n = 0;
    for (let i = 0; i < track.road.length; i++) {
      if (track.owner[i] === p.i + 1 && track.road[i]) n++;
    }
    return n;
  };

  function closeBattleCard(): void {
    if (!battleCardKey) return;
    battleCardKey = "";
    ui.closeActionCard();
  }

  function showBattleCard(key: string, info: Parameters<OriginalUi["showActionCard"]>[0]): void {
    if (battleCardKey === key) return;
    battleCardKey = key;
    ui.showActionCard(info);
  }

  function announceVerdict(stake: MapBattleStake, verdict: ReturnType<typeof settleMapBattle>, playerWon: boolean | null): void {
    if (stake.kind === "fightoff") {
      if (verdict === "cancelled") toast("You fought it off — their Gold stays spent either way.", "good");
      return;
    }
    const what = stake.kind === "town" ? "city" : "industry";
    if (verdict === "draw") { toast("A draw — the map stands.", "info"); return; }
    const mine = playerWon === true;
    if (verdict === "rights" || verdict === "shared") {
      toast(mine ? `First win — you both operate this ${what}.` : `They share the ${what} now.`, mine ? "good" : "info");
    } else if (verdict === "closed") {
      toast(mine ? `Second win — their ${stake.kind === "town" ? "plant" : "depot"} closes.` : `They closed your ${stake.kind === "town" ? "plant" : "depot"}.`, mine ? "good" : "bad");
    } else if (verdict === "reopened") {
      toast(mine ? "Reopened — you operate it again." : "They reopened their site.", mine ? "good" : "info");
    } else if (verdict === "conquest") {
      toast(mine ? `The ${what} is yours.` : `They take the ${what}.`, mine ? "good" : "bad");
    } else if (verdict === "held") {
      toast(mine ? `You held the ${what}.` : `They held the ${what}.`, mine ? "good" : "bad");
    }
  }

  function finishStake(stake: MapBattleStake, won: boolean | null): ReturnType<typeof settleMapBattle> {
    const verdict = settleMapBattle(eco, stake, won);
    if (verdict === "closed" && stake.kind === "town") {
      const loserId = won ? (stake.holderId ?? null) : stake.challengerId;
      if (loserId) {
        // Lose the city: its tiers AND their bonus go with it. Revoking the ★
        // alone was undone by the next rescore (city ★ is a high-water mark of
        // `townLevel`), so the level itself has to drop too.
        const loser = players.find((x) => x.id === loserId);
        if (loser) {
          const c = cityTiers.get(stake.townId);
          if (c && c.owner === loser.id) cityTiers.delete(stake.townId);
          else if (!c) migrateSeatCity(loser);
          syncSeatCities(loser);
          revokeCityStars(score, loserId, loser.townLevel);
        }
      }
    }
    if (stake.kind === "town") {
      const hold = eco.townHolds?.get(stake.townId);
      if (hold && hold.wins >= 2) unlockTownHold(eco, stake.townId);
    }
    const playerIsChallenger = stake.kind === "fightoff" ? true : stake.challengerId === me.id;
    const playerWon = won === null ? null : (playerIsChallenger ? won : !won);
    announceVerdict(stake, verdict, playerWon);
    syncWorld();
    rescoreNow();
    maybeComebackLoss(me);
    maybeComebackLoss(rival);
    return verdict;
  }

  function applySeatSale(p: PlayerState, sale: SaleOption): number {
    if (sale.kind === "city") {
      if (p.townLevel <= 0) return 0;
      migrateSeatCity(p);
      const top = [...cityTiers.entries()].filter(([, c]) => c.owner === p.id && c.level > 0)
        .sort((a, b) => b[1].level - a[1].level)[0];
      if (top) top[1].level--;
      syncSeatCities(p);
      // A sold tier takes its ★ with it (city ★ is otherwise a high-water mark).
      revokeCityStars(score, p.id, p.townLevel);
    }
    const gold = applySale(eco, p.id, sale, track, p.i + 1);
    if (gold <= 0) {
      if (sale.kind === "city") p.townLevel++;
      return 0;
    }
    p.purse.gold = (p.purse.gold ?? 0) + gold;
    syncWorld();
    rescoreNow();
    return gold;
  }

  function sellAsset(p: PlayerState, sale: SaleOption | null = cheapestSale(eco, p.id, pavedCountOf(p), p.townLevel)): boolean {
    if (isGuest() && p === me) {
      if (!sale) return false;
      return net?.sendIntent("battle", { do: "sell", kind: sale.kind, id: sale.id ?? null }) ?? false;
    }
    if (!sale) { toast("Nothing left to sell.", "bad"); return false; }
    const gold = applySeatSale(p, sale);
    if (gold <= 0) { toast("That sale is gone.", "bad"); return false; }
    toast(`Sold ${sale.kind} for ${gold} Gold.`, p === me ? "good" : "info");
    if (p === me) closeBattleCard();
    return true;
  }

  function downgradeCity(p: PlayerState, townId?: number): boolean {
    if (isGuest() && p === me) return net?.sendIntent("battle", { do: "downgrade" }) ?? false;
    const t = townId !== undefined ? grid.towns[townId] ?? null : townOfSeat(p);
    if (!t) { toast("You have no city to claim.", "bad"); return false; }
    const hold = eco.townHolds?.get(t.id);
    if (!hold || hold.holder !== p.id) { toast("You do not hold that city.", "bad"); return false; }
    if (hold.locked) { toast("Win the city again before you can claim it.", "bad"); return false; }
    cityTiers.set(t.id, { owner: p.id, level: 0, bonus: 0 });
    syncSeatCities(p);
    revokeCityStars(score, p.id, p.townLevel);
    toast("City claimed — tiers restart.", p === me ? "info" : "info");
    rescoreNow();
    return true;
  }

  function maybeComebackLoss(p: PlayerState): void {
    if (phase === "won" || inSetup() || isGuest()) return;
    if (hasOpenPlant(eco, p.id)) return;
    if (!isComeback(eco, p.id)) return;
    if ((p.purse.gold ?? 0) >= BATTLE_RULES.challengeGold) return;
    if (cheapestSale(eco, p.id, pavedCountOf(p), p.townLevel)) return;
    const other = otherSeat(p);
    phase = "won";
    winner = other;
    winningSource = null;
    if (rankRuntime && !isGuest()) {
      rankRuntime.claimWin(wireIdOf(other), wireIdOf(p), (performance.now() - rankBootAt) / 1000);
    }
    toast(`${p.name} has nothing left to sell — ${other.name} wins.`, other.human ? "good" : "bad");
    presentEnding(null);
  }

  function fightBusy(): boolean {
    return !!(battleScreen || mapStake || pendingFightOff || pendingChallenge || mpOffer || duel);
  }

  /**
   * Open a map battle (seat 0 = the player) against the live skill's battle
   * policy and settle the stake when the screen closes. The economy is paused
   * for both seats while the screen is up (the tick entry points bail).
   */
  /**
   * Playtest (2026-09): one short line per verdict, from MY side, saying what
   * the fight does on the map — shown on the result card.
   */
  function battleConsequence(stake: MapBattleStake): { win: string; lose: string; draw: string } {
    const draw = "Nothing changes on the map.";
    if (stake.kind === "fightoff") {
      const what = stake.pending.kind === "blockade" ? "Blockade" : "Protest";
      return { win: `The ${what} is cancelled.`, lose: `The ${what} lands as bought.`, draw };
    }
    const iChallenge = stake.challengerId === me.id;
    if (stake.kind === "industry") {
      const ind = grid.industries[stake.industryId];
      const name = INDUSTRY_BY_KEY[ind?.type ?? ""]?.name ?? "the industry";
      const streak = eco.siteRights?.get(stake.industryId)?.streak;
      const next = streak?.playerId === stake.challengerId ? streak.wins + 1 : 1;
      const challengerClosed = eco.harvesters.some((h) => h.owner === stake.challengerId && h.closed
        && industriesTouchingDepot(grid, h.tx, h.ty).some((e) => e.industry.id === stake.industryId));
      if (challengerClosed) {
        return iChallenge
          ? { win: `Your Depot at the ${name} reopens.`, lose: `Your Depot at the ${name} stays closed.`, draw }
          : { win: `Their Depot at the ${name} stays closed.`, lose: `Their Depot at the ${name} reopens.`, draw };
      }
      if (next >= 2) {
        return iChallenge
          ? { win: `Their Depot at the ${name} closes — it is yours alone.`, lose: `They hold the ${name}.`, draw }
          : { win: `You hold the ${name}.`, lose: `Your Depot at the ${name} closes.`, draw };
      }
      return iChallenge
        ? { win: `You can now build your own Depot at the ${name} — you both draw from it.`, lose: `They hold the ${name}.`, draw }
        : { win: `You hold the ${name}.`, lose: `They can now build their own Depot at the ${name} too.`, draw };
    }
    const town = townName(stake.townId);
    const hold = eco.townHolds?.get(stake.townId);
    const next = hold?.holder === stake.challengerId ? hold.wins + 1 : 1;
    if (next >= 2) {
      return iChallenge
        ? { win: `Their plant at ${town} closes and they lose its city ★.`, lose: `They hold ${town}.`, draw }
        : { win: `You hold ${town}.`, lose: `Your plant at ${town} closes and you lose its city ★.`, draw };
    }
    return iChallenge
      ? { win: `You both operate out of ${town} now — its upgrades lock.`, lose: `They hold ${town}.`, draw }
      : { win: `You hold ${town}.`, lose: `They operate out of ${town} too now — its upgrades lock.`, draw };
  }

  function openMapBattle(stake: MapBattleStake, seed: number, stakeText: string): void {
    mapStake = stake;
    const screen = startBattleScreen(seed, [
      { id: me.id, name: me.name, portrait: portraitYou, depots: mapDepotCargos(me.i + 1) },
      { id: rival.id, name: rival.name, portrait: portraitVex, depots: mapDepotCargos(2 - me.i) },
    ], {
      stake: stakeText,
      consequence: battleConsequence(stake),
      // B4 (#249): the rival fights its live skill's line — watchable.
      opponentMove: (b) => chooseBattleMove(b, skill().key),
      onClose: (result) => {
        battleScreen = null;
        const s = mapStake;
        mapStake = null;
        if (!s) return;
        // `result.winner` is the SEAT (0 = the player, the contender list's
        // first entry). `settleMapBattle` speaks for the challenger (industry
        // stakes) or the defender (fight-offs).
        const iWon = result.winner === 0;
        const won = !result.over ? null
          : s.kind === "industry"
            ? (s.challengerId === me.id ? iWon : !iWon)
            : iWon;
        const verdict = settleMapBattle(eco, s, won);
        if (verdict === "conquest") toast("The industry is yours — your depots draw from it now.", "good");
        else if (verdict === "held") toast("They held the industry.", "bad");
        else if (verdict === "draw") toast("A draw — the map stands.", "info");
        else if (verdict === "cancelled") toast("You fought it off — their Gold stays spent either way.", "good");
        else if (verdict === "lands" && s.kind === "fightoff") landFightOff(s.pending, performance.now());
      },
    });
    battleScreen = screen;
  }

  /**
   * #322: call a fight for an industry. The bill and the player cooldown arm
   * at the call. Decline is a forfeit — the challenger wins.
   */
  function challengeIndustry(indId: number): boolean {
    const now = performance.now();
    if (isGuest()) {
      if (battleScreen) { toast("One fight at a time.", "bad"); return false; }
      return net?.sendIntent("battle", { do: "challenge", industry: indId }) ?? false;
    }
    if (fightBusy()) {
      toast("One fight at a time.", "bad");
      return false;
    }
    const chk = canChallenge(eco, challengeState, now, me.id, indId, BATTLE_RULES, me.purse.gold ?? 0);
    if (!chk.ok) {
      toast(challengeRefusalText(chk.reason, BATTLE_RULES.challengeGold), "bad");
      return false;
    }
    spend(me, { gold: BATTLE_RULES.challengeGold });
    markChallenge(challengeState, now, me.id, indId, BATTLE_RULES);
    const def = INDUSTRY_BY_KEY[chk.industry.type];
    const holderId = chk.holder?.owner ?? null;
    if (humanDuels()) {
      mpOffer = {
        kind: "industry", industryId: indId, townId: undefined,
        challengerId: me.id, holderId,
        challengerHarvesterId: hid(chk.mine), holderHarvesterId: hid(chk.holder),
        offerUntil: now + BATTLE_RULES.turnMs * 2,
      };
      toast(`Challenge sent for the ${def?.name ?? "industry"} — waiting for ${rival.name}.`, "info");
      syncBattleCard();
      publishNet(now, true);
      return true;
    }
    openMapBattle(
      {
        kind: "industry", industryId: indId,
        challengerId: me.id, holderId,
        challengerHarvesterId: hid(chk.mine), holderHarvesterId: hid(chk.holder),
      },
      (rand(4294967296) >>> 0),
      `${def?.name ?? "the industry"}`,
    );
    return true;
  }

  function challengeTown(townId: number): boolean {
    const now = performance.now();
    if (isGuest()) {
      if (battleScreen) { toast("One fight at a time.", "bad"); return false; }
      return net?.sendIntent("battle", { do: "challenge", town: townId }) ?? false;
    }
    if (fightBusy()) {
      toast("One fight at a time.", "bad");
      return false;
    }
    const chk = canChallengeTown(eco, challengeState, now, me.id, townId, BATTLE_RULES, me.purse.gold ?? 0);
    if (!chk.ok) {
      toast(challengeRefusalText(chk.reason, BATTLE_RULES.challengeGold), "bad");
      return false;
    }
    spend(me, { gold: BATTLE_RULES.challengeGold });
    markChallenge(challengeState, now, me.id, townId, BATTLE_RULES);
    const holderId = eco.townHolds?.get(townId)?.holder
      ?? eco.factories.find((f) => !f.closed && f.townId === townId && f.owner !== me.id)?.owner
      ?? null;
    if (humanDuels()) {
      mpOffer = {
        kind: "town", industryId: -1, townId,
        challengerId: me.id, holderId,
        challengerHarvesterId: -1, holderHarvesterId: -1,
        offerUntil: now + BATTLE_RULES.turnMs * 2,
      };
      toast(`Challenge sent for ${townName(townId)} — waiting for ${rival.name}.`, "info");
      syncBattleCard();
      publishNet(now, true);
      return true;
    }
    openMapBattle(
      { kind: "town", townId, challengerId: me.id, holderId },
      (rand(4294967296) >>> 0),
      townName(townId),
    );
    return true;
  }

  /** #322: the rival calls a fight — the player may take it or fold. */
  function maybeRivalChallenge(now: number): void {
    if (phase === "won" || inSetup()) return;
    if (fightBusy()) return;
    if (!rivalChallengeDue(challengeState, now)) return;
    if (isComeback(eco, rival.id) && (rival.purse.gold ?? 0) < BATTLE_RULES.challengeGold) {
      const sale = cheapestSale(eco, rival.id, pavedCountOf(rival), rival.townLevel);
      if (sale) { sellAsset(rival, sale); return; }
      maybeComebackLoss(rival);
      return;
    }
    const target = pickRivalChallengeTarget(
      eco, challengeState, now, rival.id, me.id, BATTLE_RULES, rival.purse.gold ?? 0,
    );
    if (!target) return;
    if (target.kind === "town") {
      const holderId = eco.townHolds?.get(target.id)?.holder
        ?? eco.factories.find((f) => !f.closed && f.townId === target.id && f.owner !== rival.id)?.owner
        ?? me.id;
      spend(rival, { gold: BATTLE_RULES.challengeGold });
      markChallenge(challengeState, now, rival.id, target.id, BATTLE_RULES);
      markRivalChallenge(challengeState, now, skill().key);
      pendingChallenge = {
        kind: "town", townId: target.id, challengerId: rival.id, holderId,
        challengerHarvesterId: -1, holderHarvesterId: -1,
        offerUntil: now + BATTLE_RULES.turnMs,
      };
      toast(`${rival.name} challenges you for ${townName(target.id)}!`, "bad");
    } else {
      const chk = canChallenge(eco, challengeState, now, rival.id, target.id, BATTLE_RULES, rival.purse.gold ?? 0);
      if (!chk.ok) return;
      spend(rival, { gold: BATTLE_RULES.challengeGold });
      markChallenge(challengeState, now, rival.id, target.id, BATTLE_RULES);
      markRivalChallenge(challengeState, now, skill().key);
      pendingChallenge = {
        kind: "industry", industryId: target.id, challengerId: rival.id,
        holderId: chk.holder?.owner ?? me.id,
        challengerHarvesterId: hid(chk.mine),
        holderHarvesterId: hid(chk.holder),
        offerUntil: now + BATTLE_RULES.turnMs,
      };
      toast(`${rival.name} challenges you for the ${industryName(target.id)}!`, "bad");
    }
    syncBattleCard();
    rivalSpeaks("attack", "bandit");
  }

  /** Accept the rival's (or MP) challenge and fight it. */
  function acceptChallenge(): boolean {
    if (isGuest()) {
      if (!guestOffer || guestOffer.challenger !== "you") return false;
      return net?.sendIntent("battle", { do: "accept" }) ?? false;
    }
    if (mpOffer) {
      if (mpOffer.challengerId === me.id) return false;
      closeBattleCard();
      return startDuel();
    }
    const p = pendingChallenge;
    if (!p || battleScreen) return false;
    pendingChallenge = null;
    closeBattleCard();
    if (p.kind === "town") {
      openMapBattle(
        { kind: "town", townId: p.townId ?? 0, challengerId: p.challengerId, holderId: p.holderId },
        (rand(4294967296) >>> 0),
        `defending ${townName(p.townId)}`,
      );
      return true;
    }
    openMapBattle(
      {
        kind: "industry", industryId: p.industryId ?? 0,
        challengerId: p.challengerId, holderId: p.holderId,
        challengerHarvesterId: p.challengerHarvesterId, holderHarvesterId: p.holderHarvesterId,
      },
      (rand(4294967296) >>> 0),
      `defending ${industryName(p.industryId)}`,
    );
    return true;
  }

  /**
   * Fold — decline is a forfeit. The challenger wins the fight (no extra Gold).
   * Silence is a fold (the offer expires).
   */
  function declineChallenge(): void {
    if (isGuest()) {
      if (guestOffer && guestOffer.challenger === "you") net?.sendIntent("battle", { do: "decline" });
      return;
    }
    if (mpOffer) {
      if (mpOffer.challengerId !== me.id) declineMpOffer();
      return;
    }
    const p = pendingChallenge;
    if (!p) return;
    pendingChallenge = null;
    closeBattleCard();
    if (p.kind === "town") {
      finishStake({ kind: "town", townId: p.townId ?? 0, challengerId: p.challengerId, holderId: p.holderId }, true);
    } else {
      finishStake({
        kind: "industry", industryId: p.industryId ?? 0,
        challengerId: p.challengerId, holderId: p.holderId,
        challengerHarvesterId: p.challengerHarvesterId, holderHarvesterId: p.holderHarvesterId,
      }, true);
    }
  }

  /**
   * B5: a bought Blockade/Protest at the gates — the player may fight it off
   * instead of eating it. Returns whether the sabotage was HELD at the door
   * (the caller then skips its apply; the attacker's Gold is already spent).
   */
  function offerFightOff(
    kind: "blockade" | "protest",
    attackerId: string,
    industryId: number | undefined,
    tile: [number, number] | undefined,
    until: number,
  ): boolean {
    if (isMp()) return false;                    // MP fights are B6 (#251)
    if (battleScreen || mapStake || pendingFightOff || pendingChallenge) return false;
    pendingFightOff = {
      kind, attackerId, industryId,
      tile: tile ? tIdx(tile[0], tile[1]) : undefined,
      until,
      offerUntil: performance.now() + BATTLE_RULES.turnMs,
    };
    toast(`A ${kind === "blockade" ? "Blockade" : "Protest"} is at your gates.`, "bad");
    ui.feed(`A ${kind} is coming — fight it off or let it land.`);
    syncBattleCard();
    return true;
  }

  /** The fight-off was refused (or timed out): the sabotage lands as bought. */
  function landFightOff(p: PendingFightOff, now: number): void {
    if (p.kind === "blockade" && p.industryId !== undefined) {
      const target = grid.industries[p.industryId];
      if (target) {
        target.banditUntil = p.until;
        const def = INDUSTRY_BY_KEY[target.type];
        floats.add("⛓ BLOCKADED", target.tx, target.ty, { cls: "sabotage", now });
        toast(`The Blockade landed on ${def?.name ?? "the industry"} — its depots stop ticking.`, "bad");
      }
    } else if (p.kind === "protest" && p.tile !== undefined) {
      const tx = p.tile % MAP_W, ty = (p.tile / MAP_W) | 0;
      protests.set(tIdx(tx, ty), { tx, ty, until: p.until, owner: p.attackerId });
      floats.add("✊ PROTEST", tx, ty, { cls: "sabotage", now });
      toast("The protest landed — the road is shut.", "bad");
    }
  }

  /** B5: fight it off — win cancels the sabotage, lose and it lands. */
  function fightOff(): boolean {
    const p = pendingFightOff;
    if (!p || battleScreen) return false;
    pendingFightOff = null;
    closeBattleCard();
    openMapBattle(
      { kind: "fightoff", pending: p },
      (rand(4294967296) >>> 0),
      `fighting off the ${p.kind}`,
    );
    return true;
  }

  function declineFightOff(): void {
    const p = pendingFightOff;
    if (!p) return;
    pendingFightOff = null;
    closeBattleCard();
    landFightOff(p, performance.now());
  }

  /** Offer expiry: silence is a fold for both doors. */
  function b5OffersTick(now: number): void {
    if (pendingChallenge && now >= pendingChallenge.offerUntil) declineChallenge();
    if (pendingFightOff && now >= pendingFightOff.offerUntil) declineFightOff();
    syncBattleCard();
  }

  /** One Fight/Decline/Waiting card for the live offer; stale cards close. */
  function syncBattleCard(): void {
    if (pendingFightOff) {
      const p = pendingFightOff;
      const key = `fightoff:${p.kind}:${p.offerUntil}`;
      showBattleCard(key, {
        title: p.kind === "blockade" ? "Blockade" : "Protest",
        lines: [`A ${p.kind} is at your gates.`],
        until: p.offerUntil,
        actions: [
          { label: "Fight it off", onClick: () => { fightOff(); } },
          { label: "Let it land", primary: false, onClick: () => { declineFightOff(); } },
        ],
      });
      return;
    }
    if (pendingChallenge) {
      const p = pendingChallenge;
      const name = p.kind === "town" ? townName(p.townId) : industryName(p.industryId);
      const key = `pending:${p.kind}:${p.industryId ?? p.townId}:${p.offerUntil}`;
      showBattleCard(key, {
        title: "Challenge",
        lines: [`${rival.name} challenges you for ${name}. Decline forfeits.`],
        until: p.offerUntil,
        actions: [
          { label: "Fight", onClick: () => { acceptChallenge(); } },
          { label: "Decline", primary: false, onClick: () => { declineChallenge(); } },
        ],
      });
      return;
    }
    if (mpOffer) {
      const o = mpOffer;
      const name = o.kind === "town" ? townName(o.townId) : industryName(o.industryId >= 0 ? o.industryId : undefined);
      if (o.challengerId === me.id) {
        const key = `wait:${o.kind}:${o.industryId}:${o.townId}:${o.offerUntil}`;
        showBattleCard(key, {
          title: "Waiting",
          lines: [`Waiting for ${rival.name} to answer the challenge for ${name}.`],
          until: o.offerUntil,
          actions: [{ label: "Close", primary: false, onClick: () => closeBattleCard() }],
        });
      } else {
        const key = `mp:${o.kind}:${o.industryId}:${o.townId}:${o.offerUntil}`;
        showBattleCard(key, {
          title: "Challenge",
          lines: [`${rival.name} challenges you for ${name}. Decline forfeits.`],
          until: o.offerUntil,
          actions: [
            { label: "Fight", onClick: () => { acceptChallenge(); } },
            { label: "Decline", primary: false, onClick: () => { declineChallenge(); } },
          ],
        });
      }
      return;
    }
    if (isGuest() && guestOffer) {
      const o = guestOffer;
      const kind = o.kind ?? (o.townId != null ? "town" : "industry");
      const name = kind === "town" ? townName(o.townId) : industryName(o.industryId);
      if (o.challenger === "you") {
        const key = `guest:${kind}:${o.industryId}:${o.townId}:${o.until}`;
        showBattleCard(key, {
          title: "Challenge",
          lines: [`${rival.name} challenges you for ${name}. Decline forfeits.`],
          until: o.until,
          actions: [
            { label: "Fight", onClick: () => { acceptChallenge(); } },
            { label: "Decline", primary: false, onClick: () => { declineChallenge(); } },
          ],
        });
      } else {
        const key = `guest-wait:${kind}:${o.until}`;
        showBattleCard(key, {
          title: "Waiting",
          lines: [`Waiting for ${rival.name} to answer.`],
          until: o.until,
          actions: [{ label: "Close", primary: false, onClick: () => closeBattleCard() }],
        });
      }
      return;
    }
    if (battleCardKey.startsWith("pending:") || battleCardKey.startsWith("fightoff:")
      || battleCardKey.startsWith("mp:") || battleCardKey.startsWith("wait:")
      || battleCardKey.startsWith("guest")) {
      closeBattleCard();
    }
  }

  // ── B6 (#251) — multiplayer battles (host-authoritative turns) ─────────────
  // The HOST runs the engine (`battle-mp.ts`) and validates every move; the
  // guest submits intents and replays the host's move log on its own copy of
  // the deterministic engine (seed + moves), or restores the full save on a
  // rejoin / a log it cannot extend. Seat 0 = the host ("you"), seat 1 = the
  // guest ("ai"): the engine stays in the HOST frame on both machines and the
  // guest's screen simply plays seat 1. Fight-offs stay solo (`offerFightOff`).

  /** A person sits on seat 1 (not the host's own AI). */
  const humanDuels = () => isMp() && !aiOpponent;
  /** HOST: the challenge waiting on an answer (on the wire as `offer`). */
  let mpOffer: {
    kind: "industry" | "town";
    industryId: number;
    townId?: number;
    challengerId: string;
    holderId: string | null;
    challengerHarvesterId: number;
    holderHarvesterId: number;
    offerUntil: number;
  } | null = null;
  /** HOST: the live duel (its `battle` IS the host screen's engine). */
  let duel: Duel | null = null;
  let duelStakeText = "";
  let duelSettled = false;
  let duelBusy = false;
  /** HOST: the room's seat hold for a dropped guest (`opponentDisconnected`). */
  let duelGraceMs = 0;
  /** HOST: rules for the next duel (the `offerDuel` debug door's override). */
  let nextDuelRules: typeof BATTLE_RULES | null = null;
  /** HOST: the last duel's final wire, kept so a guest still sees the end. */
  let lastDuelWire: DuelWire | null = null;
  /** GUEST: the host's open offer, and which duels this client has done. */
  let guestOffer: NonNullable<Snapshot["battle"]>["offer"] | null = null;
  let guestOfferSeen = "";
  let guestDuelSeed: number | null = null;
  const guestDuelsClosed = new Set<number>();
  let guestReplaying = false;

  /** Both seats in the HOST frame, named from this client's point of view. */
  const duelContenders = () => {
    const g = isGuest();
    return [
      { id: "you", name: g ? rival.name : me.name, portrait: g ? portraitVex : portraitYou, depots: mapDepotCargos(g ? 2 : 1) },
      { id: "ai", name: g ? me.name : rival.name, portrait: g ? portraitYou : portraitVex, depots: mapDepotCargos(g ? 1 : 2) },
    ] as [
      { id: string; name: string; portrait: string | null; depots: Cargo[] },
      { id: string; name: string; portrait: string | null; depots: Cargo[] },
    ];
  };

  /** The timeout auto-play's shuffle — the game's seeded stream. */
  const duelRng = () => rand(1_000_000_000) / 1_000_000_000;

  /** HOST: an accepted offer becomes a duel — seat 0 host, seat 1 guest. */
  function startDuel(): boolean {
    const o = mpOffer;
    if (!o || duel || battleScreen) return false;
    mpOffer = null;
    const now = performance.now();
    const seed = rand(4294967296) >>> 0;
    const players = duelContenders();
    const d = createDuel(seed, nextDuelRules ?? BATTLE_RULES, [players[0], players[1]], now);
    nextDuelRules = null;
    duel = d;
    duelSettled = false;
    // industryId < 0 and no town = a friendly (the debug door): nothing on the map moves.
    mapStake = o.kind === "town"
      ? { kind: "town", townId: o.townId ?? 0, challengerId: o.challengerId, holderId: o.holderId }
      : o.industryId < 0 ? null : {
        kind: "industry", industryId: o.industryId, challengerId: o.challengerId, holderId: o.holderId,
        challengerHarvesterId: o.challengerHarvesterId, holderHarvesterId: o.holderHarvesterId,
      };
    duelStakeText = o.kind === "town" ? townName(o.townId)
      : o.industryId < 0 ? "a friendly"
        : industryName(o.industryId);
    battleScreen = openBattleScreen({
      battle: d.battle,
      contenders: players,
      seat: 0,
      stake: duelStakeText,
      remote: {},
      onLocalMove: () => {
        noteHumanMove(d, 0, performance.now());
        afterDuelMove();
      },
      onClose: () => {
        battleScreen = null;
        if (duel === d) {
          if (!d.battle.state.over) endByForfeit(d, 1);   // torn down mid-fight
          settleDuel();
          duel = null;
        }
        publishNet(performance.now(), true);
      },
    });
    publishNet(now, true);
    return true;
  }

  /** HOST: after any move — settle a finished duel, ship the log now. */
  function afterDuelMove(): void {
    if (duel?.battle.state.over) settleDuel();
    publishNet(performance.now(), true);
  }

  /** HOST: the stake settles once, the moment the duel ends. */
  function settleDuel(): void {
    const d = duel;
    if (!d || duelSettled) return;
    duelSettled = true;
    lastDuelWire = { ...duelToWire(d), stake: duelStakeText };
    const s = mapStake;
    mapStake = null;
    const w = d.battle.state.winner;
    if (!s || (s.kind !== "industry" && s.kind !== "town")) {
      toast(w === null ? "A draw." : w === 0 ? `You beat ${rival.name}.` : `${rival.name} wins the battle.`, "info");
      return;
    }
    const won = w === null ? null : (w === 0 ? me.id : rival.id) === s.challengerId;
    finishStake(s, won);
  }

  /** HOST: the challenged seat folded (or let the offer run out). */
  function declineMpOffer(): void {
    const o = mpOffer;
    if (!o) return;
    mpOffer = null;
    closeBattleCard();
    nextDuelRules = null;
    if (o.kind === "town") {
      finishStake({ kind: "town", townId: o.townId ?? 0, challengerId: o.challengerId, holderId: o.holderId }, true);
    } else if (o.industryId >= 0) {
      finishStake({
        kind: "industry", industryId: o.industryId, challengerId: o.challengerId, holderId: o.holderId,
        challengerHarvesterId: o.challengerHarvesterId, holderHarvesterId: o.holderHarvesterId,
      }, true);
    } else {
      toast(o.challengerId === me.id ? `${rival.name} declined.` : `You declined.`, "info");
    }
    publishNet(performance.now(), true);
  }

  /** HOST: a guest's `battle` intent. Every refusal is echoed. */
  function applyBattleIntent(payload: Record<string, unknown>, echoed: string[]): void {
    const what = payload.do;
    const now = performance.now();
    if (what === "challenge") {
      if (battleScreen || mapStake || mpOffer || duel) { echoed.push("One fight at a time."); return; }
      const townId = typeof payload.town === "number" && Number.isInteger(payload.town) ? payload.town : -1;
      const indId = typeof payload.industry === "number" && Number.isInteger(payload.industry) ? payload.industry : -1;
      if (townId >= 0) {
        const chk = canChallengeTown(eco, challengeState, now, rival.id, townId, BATTLE_RULES, rival.purse.gold ?? 0);
        if (!chk.ok) { echoed.push(`Challenge refused (${chk.reason}).`); return; }
        spend(rival, { gold: BATTLE_RULES.challengeGold });
        markChallenge(challengeState, now, rival.id, townId, BATTLE_RULES);
        const holderId = eco.townHolds?.get(townId)?.holder
          ?? eco.factories.find((f) => !f.closed && f.townId === townId && f.owner !== rival.id)?.owner
          ?? me.id;
        mpOffer = {
          kind: "town", industryId: -1, townId, challengerId: rival.id, holderId,
          challengerHarvesterId: -1, holderHarvesterId: -1,
          offerUntil: now + BATTLE_RULES.turnMs * 2,
        };
        toast(`${rival.name} challenges you for ${townName(townId)}!`, "bad");
        syncBattleCard();
        return;
      }
      const chk = canChallenge(eco, challengeState, now, rival.id, indId, BATTLE_RULES, rival.purse.gold ?? 0);
      if (!chk.ok) { echoed.push(`Challenge refused (${chk.reason}).`); return; }
      spend(rival, { gold: BATTLE_RULES.challengeGold });
      markChallenge(challengeState, now, rival.id, indId, BATTLE_RULES);
      mpOffer = {
        kind: "industry", industryId: indId, challengerId: rival.id,
        holderId: chk.holder?.owner ?? null,
        challengerHarvesterId: hid(chk.mine), holderHarvesterId: hid(chk.holder),
        offerUntil: now + BATTLE_RULES.turnMs * 2,
      };
      toast(`${rival.name} challenges you for the ${industryName(indId)}!`, "bad");
      syncBattleCard();
      return;
    }
    if (what === "sell") {
      const kind = payload.kind === "pave" || payload.kind === "depot" || payload.kind === "city" || payload.kind === "plant"
        ? payload.kind : null;
      if (!kind) { echoed.push("That sale is not available."); return; }
      const id = typeof payload.id === "number" ? payload.id : undefined;
      const sale: SaleOption = { kind, gold: 0, id };
      if (!sellAsset(rival, sale)) echoed.push("That sale is gone.");
      return;
    }
    if (what === "downgrade") {
      if (!downgradeCity(rival)) echoed.push("You cannot claim that city yet.");
      return;
    }
    if (what === "accept" || what === "decline") {
      if (!mpOffer || mpOffer.challengerId !== me.id) { echoed.push("There is no challenge to answer."); return; }
      if (what === "accept") startDuel();
      else declineMpOffer();
      return;
    }
    if (what === "swap" || what === "ability") {
      const d = duel, screen = battleScreen;
      if (!d || !screen) { echoed.push("There is no battle running."); return; }
      const n = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : -1);
      const move: BattleMove = what === "swap"
        ? { t: "swap", r1: n(payload.r1), c1: n(payload.c1), r2: n(payload.r2), c2: n(payload.c2) }
        : { t: "ability", id: String(payload.id ?? ""), seat: 1 };
      // The engine validates (turn, legality, mana) before it mutates; the
      // outcome ships once the cascade has resolved.
      void screen.runExternal(() => applyPlayerMove(d, rival.id, move, performance.now())).then((res) => {
        if (res.ok) {
          noteHumanMove(d, 1, performance.now());
          afterDuelMove();
        } else {
          net?.setNotice(`Move refused (${res.reason}).`);
          publishNet(performance.now(), true);
        }
      });
      return;
    }
    echoed.push("That battle action is not available.");
  }

  /** HOST, every frame: offer expiry, the turn clock, the disconnect grace. */
  function duelTick(now: number): void {
    if (isGuest() || !humanDuels()) return;
    if (mpOffer && now >= mpOffer.offerUntil) declineMpOffer();
    const d = duel, screen = battleScreen;
    if (!d || !screen || duelSettled || duelBusy) return;
    if (duelGraceTick(d, now, duelGraceMs) !== null) {
      toast(`${rival.name} did not come back — the battle is forfeit.`, "info");
      void screen.runExternal(() => undefined).then(afterDuelMove);
      return;
    }
    if (now < d.turnDeadline && !d.seatGone[0] && !d.seatGone[1]) return;
    duelBusy = true;
    void screen.runExternal(() => duelClockTick(d, now, duelRng)).then((r) => {
      duelBusy = false;
      if (r.auto) afterDuelMove();
    });
  }

  /** HOST: the room's presence news, as the duel sees it. */
  function duelPeer(state: "gone" | "back" | "left", graceMs = 0): void {
    if (state === "gone") duelGraceMs = graceMs;
    const d = duel;
    if (!d || duelSettled) return;
    const now = performance.now();
    if (state === "left") {
      endByForfeit(d, 0);
      void battleScreen?.runExternal(() => undefined).then(afterDuelMove);
      return;
    }
    duelPresence(d, 1, state === "back", now);
    publishNet(now, true);
  }

  /** HOST: the battle layer's MP half on the wire. */
  function duelWireOut(): Pick<NonNullable<Snapshot["battle"]>, "engine" | "offer"> {
    return {
      engine: duel && !duelSettled ? { ...duelToWire(duel), stake: duelStakeText } : lastDuelWire ?? undefined,
      offer: mpOffer
        ? {
          kind: mpOffer.kind,
          industryId: mpOffer.kind === "industry" ? mpOffer.industryId : undefined,
          townId: mpOffer.kind === "town" ? mpOffer.townId : undefined,
          challenger: mpOffer.challengerId,
          until: mpOffer.offerUntil,
        }
        : undefined,
    };
  }

  /** GUEST: the host's offer + duel, applied (snapshot or delta). */
  function guestApplyDuel(bw: NonNullable<Snapshot["battle"]>): void {
    if (!isGuest()) return;
    guestOffer = bw.offer ?? null;
    if (guestOffer && guestOffer.challenger === "you") {
      const key = `${guestOffer.kind ?? "industry"}:${guestOffer.industryId}@${guestOffer.townId}@${guestOffer.until}`;
      if (key !== guestOfferSeen) {
        guestOfferSeen = key;
        const kind = guestOffer.kind ?? (guestOffer.townId != null ? "town" : "industry");
        const what = kind === "town"
          ? `for ${townName(guestOffer.townId)}`
          : (guestOffer.industryId ?? 0) < 0
            ? "to a friendly battle"
            : `for the ${industryName(guestOffer.industryId)}`;
        toast(`${rival.name} challenges you ${what}!`, "bad");
        syncBattleCard();
      }
    } else if (!guestOffer && battleCardKey.startsWith("guest")) {
      closeBattleCard();
    }
    const e = bw.engine;
    if (!e || guestDuelsClosed.has(e.seed)) return;
    if (guestDuelSeed !== e.seed || !battleScreen) {
      if (e.over) { guestDuelsClosed.add(e.seed); return; }   // ended unseen
      guestOpenDuel(e);
      return;
    }
    void guestCatchUp(e);
  }

  /** GUEST: open (or re-open, on rejoin/divergence) the duel from the full save. */
  function guestOpenDuel(e: DuelWire): void {
    const seed = e.seed;
    const old = battleScreen;
    guestDuelSeed = null;                     // the old screen's close is not a finish
    battleScreen = null;
    old?.destroy();
    guestDuelSeed = seed;
    const players = duelContenders();
    const d = duelFromWire(e, [players[0], players[1]]);
    const screen = openBattleScreen({
      battle: d.battle,
      contenders: players,
      seat: 1,
      stake: e.stake,
      remote: {
        submit: (m) => {
          net?.sendIntent("battle", m.t === "swap"
            ? { do: "swap", r1: m.r1, c1: m.c1, r2: m.r2, c2: m.c2 }
            : { do: "ability", id: m.id });
        },
      },
      onClose: () => {
        if (battleScreen === screen) battleScreen = null;
        if (guestDuelSeed === seed) { guestDuelsClosed.add(seed); guestDuelSeed = null; }
      },
    });
    battleScreen = screen;
    if (e.over) void screen.runExternal(() => copyVerdict(d.battle, e));
  }

  /** A forfeit ends the duel with no move — the wire's verdict says so. */
  const copyVerdict = (b: Duel["battle"], e: DuelWire): void => {
    if (!e.over) return;
    const st = b.state as { over: boolean; winner: BattleSeat | null };
    st.over = true;
    st.winner = e.winner ?? null;
  };

  /** GUEST: replay the host's moves this engine has not seen yet. */
  async function guestCatchUp(e: DuelWire): Promise<void> {
    const screen = battleScreen;
    if (!screen || guestReplaying) return;
    const b = screen.battle;
    // The host's log must EXTEND ours; anything else and the full save wins.
    const same = b.moves.length <= e.moves.length
      && b.moves.every((m, i) => JSON.stringify(m) === JSON.stringify(e.moves[i]));
    if (!same) { guestOpenDuel(e); return; }
    if (b.moves.length === e.moves.length && (!e.over || b.state.over)) return;
    guestReplaying = true;
    try {
      await screen.runExternal(async () => {
        for (let i = b.moves.length; i < e.moves.length; i++) {
          const m = e.moves[i];
          const out = m.t === "swap"
            ? await b.playSwap(m.r1, m.c1, m.r2, m.c2, Date.now())
            : await b.useAbility(m.id);
          if (!out.ok) break;                 // busy — the next delta retries
        }
        if (b.moves.length === e.moves.length) copyVerdict(b, e);
      });
    } finally {
      guestReplaying = false;
    }
  }

  function buyBlackFor(actor: PlayerState, key: string): boolean {
    const now = performance.now();
    const spendGold = (n: number) => {
      if ((actor.purse.gold ?? 0) < n) { toast(`Needs ${n} Gold.`, "bad"); return false; }
      spend(actor, { gold: n });
      return true;
    };
    if (key === "bandit") {
      if (!spendGold(SABOTAGE.bandit.gold)) return false;
      // L9 (#224): Security Forces are the defence against BOTH map cards, so
      // a guarded defender turns the Blockade away at the door. The hire is
      // paid either way — the rule the solo raid has always kept, and the
      // reason the guard is worth buying before the raid lands.
      const defender = otherSeat(actor);
      if (now < securityOf(defender.id)) {
        toast(`Security Forces turned the ${SABOTAGE.bandit.name} away.`, "info");
        if (isMp()) publishNet(now, true);
        return true;
      }
      // TK-008: there is exactly ONE rival per seat, so a Blockade needs no
      // targeting step — auto-route it to the industry that costs the OTHER
      // seat the most yield, whoever is buying.
      const target = pickBlockadeTarget(eco, defender.id, now);
      if (!target) {
        earn(actor, { gold: SABOTAGE.bandit.gold });   // refund; nothing to hit
        toast("No industry to blockade — gold refunded.", "bad");
        return false;
      }
      // B5 (#250): a Blockade landing on the LOCAL player with no Security up
      // can be FOUGHT OFF — held at the door instead of applied (the hire is
      // already spent, win or lose). MP keeps the old instant apply (B6).
      if (defender.id === players[0].id
        && offerFightOff("blockade", actor.id, target.id, undefined, now + BANDIT_MS)) {
        return true;
      }
      target.banditUntil = now + BANDIT_MS;
      const def = INDUSTRY_BY_KEY[target.type];
      // L9 (#224): re-worded against the CLOCK economy — a blockade is not
      // "no one may harvest" any more (nobody harvests by hand), it is "every
      // depot holding that industry stops ticking", which is exactly what
      // `harvesterYield`'s `banditUntil` gate does to the income clock.
      toast(`Blockade set on ${def?.name ?? target.type} — its depots stop ticking for ${BANDIT_MS / 1000}s.`, "good");
      if (actor.id === players[0].id) {
        sfx.play("boom", { gain: 0.65 });   // SFX-01
        rivalSpeaks("retort", "bandit");
      }
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
      toast(`Protest ready — click any public road to stop every depot routed through it for ${fmtProtestLeft(PROTEST_MS)}.`, "info");
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
    // L9 (#224): every other key is a RETIRED card — the three that reached
    // into a match-3 board (Frost Tiles, Iron Girders, Smog Cloud) and the
    // Repair Crew that existed to undo them. Nothing can dirty a plant board
    // any more, so a crew that clears frost and girders repairs nothing; the
    // obstacles that replace them (#225) belong to a tuning session, which
    // ends by itself. A relayed intent for one of these lands here and is
    // refused without a charge.
    toast("That card is no longer on the Black Market.", "info");
    return false;
  }

  function buyBlack(key: string) {
    if (phase === "won") {
      toast("The final ledger is closed. Start a rematch to settle another score.", "info");
      return;
    }
    // L9 (#224): the shop's whole inventory, in one place — the two MAP cards
    // and the defence. A retired key (a stale save's macro, an old console
    // call, a guest on an older build) is refused HERE, so no intent is ever
    // relayed for a card the rules no longer have.
    if (!BLACK_MARKET_ACTIONS.has(key)) {
      toast("That card is no longer on the Black Market.", "info");
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
        toast(`Protest ready — click any public road to stop every depot routed through it for ${fmtProtestLeft(PROTEST_MS)}.`, "info");
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
  /** #297: the rival's simulated tuning session runs until this time (new loop). */
  let rivalSessionUntil = 0;
  /** Fractional new-loop income retained per depot (either seat) until it
   *  reaches one whole unit. Depot ids are unique, so one map serves both. */
  const loopCarry = new Map<number, number>();

  // ── L8 (#222): the optional quests ──────────────────────────────────────
  /**
   * The offers on the panel right now (2–3, one per strategy). Refilled the
   * frame after one completes or is dismissed.
   */
  let quests: QuestDef[] = [];
  /**
   * Ids the player is DONE with: paid out, dismissed, or retired because the
   * map moved past them. One set for all three, because the rule they share
   * is the same one — never offer this quest again in this game — and it is
   * what rides the save (with the paid set) so a reload cannot re-earn a
   * reward.
   */
  const questSpent = new Set<string>();
  /** The rewards actually paid — the "once" half of a small reward. */
  const questPaid = new Set<string>();
  /** The player's own choice: the panel shrinks to a flag they can reopen. */
  let questsHidden = false;
  /** The seeded picker — never `Math.random`, so a seed offers the same plan. */
  const questRng = mulberry32((seed ^ 0x5f3759df) >>> 0);
  /**
   * The view the last frame derived — the panel's progress strings and the
   * pay/completion test both read THIS, so the chrome and the reward can never
   * disagree about what the player has done.
   */
  let questViewCache: QuestView | null = null;
  /**
   * A restored panel's offer ids, waiting for the next `syncQuests` to resolve
   * them against the freshly-derived pool. A save keeps the panel it had, and
   * the defs themselves need not travel: the tables are data and the map is
   * the same seed.
   */
  let questPendingOffers: string[] | null = null;
  /**
   * What the seat looked like when the panel last drew — depots, links, cargo
   * types, city, rung. The panel redraws when this MOVES (and on a payout), so
   * dismissing a quest cannot be undone by the next frame.
   */
  let questWorld: string | null = null;
  /**
   * L3 (#217): each Depot's road distance, cached per NETWORK — the route
   * length in tiles (`depotPathLength`) and the banded factor the clock pays
   * (`distanceFactorForPath`). Recomputed only when the network moves: the
   * gate is `netVersion`, which every world change funnels through in
   * `syncWorld`, so a tick (or a frame's inspector read) is one integer
   * compare instead of a BFS per Depot. Derived from the track, so — unlike
   * yield — it needs no wire field and no save field: a guest or a restore
   * recomputes the same numbers from the same bytes.
   */
  const distanceCache = new Map<number, { tiles: number | null; factor: number }>();
  let distanceNetVersion = -1;
  function refreshDistanceCache(): void {
    if (distanceNetVersion === netVersion) return;
    distanceNetVersion = netVersion;
    distanceCache.clear();
    for (const h of eco.harvesters) {
      const tiles = depotPathLength(eco, h);
      distanceCache.set(h.id, { tiles, factor: distanceFactorForPath(tiles) });
    }
  }
  /**
   * L3: this Depot's cached distance — the same numbers the tick multiplies
   * and the inspector prints. Freshens the cache first, so both read the
   * network as it stands; the fallback is for an id with no entry, which only
   * a stale caller can name.
   */
  const distanceInfoFor = (id: number): { tiles: number | null; factor: number } => {
    refreshDistanceCache();
    return distanceCache.get(id) ?? { tiles: null, factor: distanceFactorForPath(null) };
  };
  /** A1: Security Forces are on duty until this wall time. */
  let securityUntil = 0;
  /** #111: the guest seat's own Security Forces guard (armed by its hire). */
  let guestSecurityUntil = 0;
  /** A1: when the rival last ran a Black Market raid on the player's plant. */
  let lastRaid = 0;
  /**
   * L9 (#224): the two MAP cards the rival's raid table plays — the same two
   * the player can buy, at the same prices. `bandit` is `rivalSabotage`'s
   * (it auto-targets a district and keeps its own Gold reserve), `protest` is
   * `rivalRaid`'s. The three board cards this set used to hold are gone.
   */
  const RAID_ACTIONS = new Set(["bandit", "protest"]);
  /**
   * The income clock — one call every `HARVEST_MS`, host only, `play` only.
   *
   *   • new loop (L1b/L1d): BOTH seats are paid by their connected depots,
   *     `BASE_RATE × depotYield × distanceFactor × transportFactor` per depot,
   *     with the fractional remainder carried in `loopCarry` (the PP-07 rule:
   *     a sub-1 rate still pays out over time instead of rounding to zero
   *     forever). Nothing else pays cargo — the boards and the lorries are
   *     animation (#234, #235).
   *   • shipped loop: nobody is paid here at all (AI-03 removed the rival's
   *     passive trickle); the clock only re-reads the network so both boards'
   *     token gates follow blockades expiring.
   */
  function economyTick(now: number) {
    // B5 (#250): the economy clock stops for BOTH seats while a battle is up —
    // the fight is the whole world until it settles.
    if (battleScreen) return;
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
      const freshlyTuned = applyRivalTuning();
      // L13 (#228): if that opened a rung it opened a ★ with it, and this is
      // the one caller that is not already inside a build path — so it says
      // so here rather than leaving the star until the rival's next road.
      if (rivalRungOpened) rescoreNow();
      // L1b: the host clocks the local seat. L1d (#235): and the rival's too —
      // both seats earn on the clock through the SAME seams, the same
      // `harvesterYield` connectivity gate and the same per-depot fractional
      // carry, so "the rival is paid by its own connected depots" needs no
      // second rule set. `newLoop` is solo-only (L1a), which is exactly the
      // game where seat 1 is a machine; in a room the host's guest is a person
      // and this branch never runs.
      // Connectivity is evaluated per depot, so removing a road immediately
      // stops that depot's income — on either seat.
      const rules = difficultyRules();
      const locks = industryLocks(eco);
      for (const seat of [me, rival]) {
        const owner = seat.id;
        const components = buildAllComponents(eco.track, ownerIdOf(eco, owner));
        for (const depot of eco.harvesters) {
          if (depot.owner !== owner) continue;
          // L6 (#220): the cooling pass, on this same line for every difficulty.
          // `decayYield` returns null when the row's `decayRate` is 0 (Easy,
          // Normal) or the Depot has no surplus above its floor left to lose, so
          // "no decay" and "decaying" are ONE codepath with different numbers —
          // which is what the acceptance asks a unit test to prove by toggling
          // the flags on a live game. It runs before the pay, so the level the
          // HUD printed is the level this tick paid at; it runs on every Depot
          // the seat owns (a disconnected one cools too, or cutting a road would
          // freeze a fresh tune); and its result is stored back on the Depot
          // record, which is what the snapshot and the autosave already carry.
          // L14 (#229): BOTH seats cool. L6 wrote this for the player alone —
          // "letting a difficulty row shave the AI would make Hard an AI
          // handicap instead of a player challenge" — and that was right while
          // the rival had no answer to cooling. It has one now: the same
          // re-match the player's plate offers (`rivalRetuneStep`), on the same
          // predicate and the same session result. With a reply in hand, decay
          // is not a handicap, it is the rule — the L14 spec's "on Hard its
          // yields decay like the player's" — and it is what makes the rival's
          // Depots cost it a turn to keep at full tilt, exactly as yours do.
          // Easy is unaffected on both seats: its `decayRate` is 0, and the
          // generous `minYield` is still the PLAYER's alone (`rivalTuningYield`
          // never reads it — see the L6 note in tuning.ts).
          const cooled = freshlyTuned.has(depot.id) ? null : decayYield(depot.yield, rules);
          if (cooled !== null) depot.yield = cooled;
          const result = harvesterYield(eco, components, locks, depot, now);
          const cargoes = Object.entries(result.yields) as [Cargo, number][];
          if (!result.serviced || !cargoes.length) continue;
          // L9 (#224): a Protest on this depot's route stops its ticks for as
          // long as the crowd stands — the clock-economy half of the card, and
          // the same fact the halted lorry shows on the map. It applies to
          // BOTH seats (#235 clocks them both): the rival's own routes can be
          // protested by the player, and the player's by the rival's raid,
          // and `protestedDepot` reads each owner's own Security guard.
          // (A Blockade is already inside `harvesterYield`: a blockaded
          // industry yields nothing, so its depot falls out at the
          // `cargoes.length` test above.)
          if (protestedDepot(depot, now, components)) continue;
          // L3 (#217): the road distance behind the tick — read off the
          // per-network cache (one BFS per Depot per network change, never
          // per tick), so a far Depot visibly earns less than a near one.
          // L5 (#219): the CITY UPGRADE factor — one multiplier per seat, from
          // its tuning-confirmed upgrade, applied to every depot it owns (and
          // on top of the distance/yield/transport chain, so it scales the
          // whole network rather than one route). 1 while nothing is raised.
          const factor = BASE_RATE * depotYield(depot) * distanceInfoFor(depot.id).factor
            * transportFactor(depot) * (1 + (hasCities(seat)
              ? cityBonusFor(seat.id, result.connection?.factory) : Math.max(0, seat.townBonus)));
          const total = cargoes.reduce((sum, [, amount]) => sum + amount, 0) * factor
            + (loopCarry.get(depot.id) ?? 0);
          const whole = Math.floor(total);
          loopCarry.set(depot.id, total - whole);
          if (whole > 0) {
            // A depot normally holds one industry/cargo; use the first cargo
            // for the integer credit and retain any sub-unit remainder per
            // depot (one map serves both seats: depot ids are unique).
            earn(seat, { [cargoes[0][0]]: whole } as Purse);
          }
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

  /** Per frame: board effects, the token spawn and the autoplay clocks. */
  function quarryTick(now: number) {
    // MP-05: on a guest this whole family is host-owned — the boards and the
    // sabotage clocks all live where the sim lives. The guest renders the
    // board panel from its own (inert) grid and changes nothing.
    if (isGuest()) return;
    if (phase !== "play") return;
    quarry.tick(now);
    // L4 (#218): a session whose budget is spent and whose board has stopped
    // moving ends ITSELF — the moment the last cascade settles, never
    // mid-cascade, and with no way to be stuck holding a finished session.
    // #300: it ends into the RESULTS pop-up (score, yield, stars) rather than
    // straight onto the map; the yield lands on its one Confirm key. A Finish
    // pressed mid-cascade (`tuningEndAsked`) ends here on the same settle.
    if (tuning && !tuningResult && !quarry.board.busy && (tuningEndAsked || tuningOver(tuning))) {
      endTuningSession();
    }
    // AI-03: the rival's own plant plays: same board clock as yours, then
    // one watchable move per skill().moveMs. trySwap refuses politely when
    // the board is busy, so the clock can keep cadence calmly.
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
    // L14 (#229): under `newLoop` the rival plays no board. Its plant is a
    // spectator panel of a system the loop no longer runs (a board pays no
    // cargo since #234, which is what makes its depots' yield come from the
    // simulated session instead), so watching it "match" would be watching an
    // animation with no game behind it. The moveMs lever is the shipped loop's.
    if (newLoop) return;
    if (now - lastRivalMove < skill().moveMs) return;
    const mv = rivalBoard.findMove((g) => (g.tier ?? 0));
    if (!mv) { lastRivalMove = now; return; }
    lastRivalMove = now;
    void rivalBoard.trySwap(mv[0], mv[1], mv[2], mv[3], now);
  }

  /**
  /**
   * VP-01: what the rival believes about the race, right now. Read from the
   * derived scoreboard rather than cached on the turn, because these functions
   * also run from the debug/test hooks and a policy that changes between
   * planning and spending is worse than a slightly stale one.
   */
  const rivalPaceNow = (): RivalPace =>
    rivalPace(vpFor(score, "you"), vpFor(score, "ai"), winTarget());

  /**
   * L11 (#226): WHAT THE RIVAL IS SAVING FOR — a read, not a trade.
   *
   * These two questions were the rival's BANK's: it traded 4:1 toward whichever
   * need was nearer (`rivalBankTowardPave` / `rivalBankTowardPlan` below), and
   * the plant step and the city upgrade guarded against spending that plan
   * away. The readers are pure planner walks over the same candidates the build
   * step uses — they own no purse and move nothing — and L11 keeps them BECAUSE
   * the bank stays: it is the one exchange left, now gated by the tree
   * (`bank.ts`), so every pass that trades has to know what the rest of the
   * turn is saving for.
   *
   * The two needs, in the order `rivalReserve` weighs them:
   *   • the Depot plan closest to affordable (fewest missing units, ties by
   *     the planner's own score) — priced with the track leg it needs;
   *   • the next pave batch, 4 tiles of `paveCandidates` — 1★, the same unit
   *     as a plant, and the largest step a rival with no Ore can realistically
   *     take inside its own income;
   * and the winner is whichever is nearer (fewer units missing), with the
   * scoreboard outranking the build queue on a tie — VP-01's rule.
   */
  const rivalPlanReserve = (f: Factory, now: number): Purse | null => {
    // Price with a HYPOTHETICAL deep purse: `planCandidates` drops plans the
    // purse cannot finish, and the plan to save for is exactly one of those.
    // AI-01: this goes through `deepPlanCandidates`, which holds the pricey
    // affordability-lifted search against a world fingerprint — a stalled
    // rival re-asks the question every idle tick (~2.5 s), and re-routing an
    // unchanged map was a ~0.2 s hitch each time. Scarcity ranking still reads
    // the REAL stock (order-only, so the cache is safe); only affordability is
    // lifted.
    const cands = deepPlanCandidates(eco, f, {
      stock: rival.purse,
      free: rival.freeTrack, freeDepots: rival.freeDepots, now,
      newLoop,
      // L5 (#219): the reserve works toward plans its own tree can actually buy.
      depotTier: rival.depotTier,
    });
    const depot = priceDepot(rival.purse, rival.freeDepots, { tier: rival.depotTier, newLoop }).cost;
    if (!cands.length) return null;
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
    const out: Purse = {};
    for (const [k, v] of Object.entries(chosen.cost)) out[k as Cargo] = v;
    for (const [k, v] of Object.entries(depot)) out[k as Cargo] = (out[k as Cargo] ?? 0) + v;
    return out;
  };

  /** The next 4-tile pave batch's Ore — what a plant or a city upgrade must
   *  leave behind (see `rivalPlanReserve`). */
  const rivalPaveReserve = (): Purse | null => {
    const ranked = paveCandidates(eco, {
      owner: rival.id, ownerId: rival.i + 1, purse: rival.purse,
      maxTiles: PAVE_MILESTONE_TILES,
    });
    if (!ranked.length) return null;
    let ore = 0;
    for (const t of ranked.slice(0, PAVE_MILESTONE_TILES)) ore += tileCost(track, "road", t.x, t.y).ore ?? 0;
    return ore > 0 ? { ore } : null;
  };

  /** AI-02: the Ore the pave pass may actually spend — the purse less the
   *  Plant reserve `rivalPavePass` keeps through `planUpgrades`' keepOre.
   *  Every affordability question about paving reads this, so a seat that can
   *  only pave by eating the plant's Ore is not treated as if it could. */
  const spendableOre = (): number =>
    Math.max(0, (rival.purse.ore ?? 0) - (rivalPlantWanted() ? (PLANT_COST.ore ?? 0) : 0));

  /**
   * AI-01: the bank's per-turn exchange budget. The SCOREBOARD sets the cruise
   * rate (2 is the player's own rhythm); a SPRINTING seat doubles it, which is
   * what sprinting means — the same milestone, reached in half the turns. The
   * milestone itself is deliberately NOT enlarged: an earlier version aimed a
   * sprinting rival at eight tiles (32 Ore) instead of four (16) and produced
   * the worst possible result on seed 99 of the 5-seed race — 0★ for the whole
   * game, because a poor seat cannot assemble 32 Ore, so it sold four stacks a
   * turn toward a target it could never reach and stopped affording the economy
   * it needed to reach it. A plan has to be short enough to finish;
   * `planUpgrades` still paves all eight tiles at once when the Ore is there.
   */
  const bankBudget = (pace: RivalPace): number => Math.max(1, pace.bankPerTurn);

  /**
   * L11 (#226): THE RIVAL'S BANK — the same 4:1, the same gate and the same
   * planner the player's Exchange runs through (`planBankTrades` → `bankTrade`,
   * with the new loop passing this seat's own `depotTier` as `unlocked`).
   *
   * The ticket's third acceptance line is "the rival still progresses without
   * trading", and on the SHIPPED loop it cannot: `DEPOT_COST` is Wood + Stone +
   * Grain + OIL from one table, the trickle pays a fraction of a cargo at a
   * time, and no plan is reachable by waiting — the PP-07 stall, a rival that
   * expands twice and idles at 2★ for the rest of the match. The bank bridges
   * what the purse is short of, exactly as it did before the ticket; what the
   * ticket changed is the GATE. Under the tree the rival may only exchange
   * cargos whose rung it has unlocked — the rule the player's panel applies —
   * so no seat can buy its way around L5 (#219).
   */
  /**
   * VP-01: one bank aimed at the SCOREBOARD rather than at the next Depot.
   *
   * `rivalBankTowardPlan` only runs on an idle turn — and a rival with Wood to
   * burn is never idle: it would rather lay its fortieth gravel tile than buy
   * the Ore that turns thirty of them into points. That is exactly how it
   * stalled a measured race at 6.5★ owning 27 un-paved tiles (seed 2024,
   * `tests/unit/iso-vp-race.test.ts`): busy every turn, pointless every turn.
   * So the rival converts into Ore whenever it has gravel it wants to pave and
   * cannot afford to — and never sells a cargo the Depot plan still needs, so
   * this cannot starve the build step it is competing with.
   */
  function rivalBankTowardPave(f: Factory, now: number): number {
    // L11 (#226) / L14 (#229): under `newLoop` the rival banks by EARNING the
    // missing cargo — `treeGoal`/`treeWants` steer its connects — so it never
    // exchanges surplus at 4:1 here. The shipped loop is where its bank lives.
    if (newLoop) return 0;
    const want = rivalPaveReserve();
    if (!want) return 0;
    const need = want.ore ?? 0;
    // AI-02: judge the goal by what the PAVE PASS may spend, not the raw purse
    // — `planUpgrades` keeps a Plant's Ore aside whenever a plant is wanted, so
    // a seat holding exactly `need` Ore (less the plant reserve) cannot pave,
    // yet every affordability check said it could. That pairing was the live
    // deadlock the player saw: one depot, one road, paved 2 of 3, and banks
    // that never traded a single unit while Wood piled up at 32/min. (Headless
    // repro: zz-live, 25 minutes of a seed-1337 rival.)
    if (spendableOre() >= need) return 0;                  // it can already pay
    // AI-01: guard the WHOLE depot plan, not just `priceDepot`. The AI-vs-AI
    // race caught the thinner guard feeding the churn this function is part
    // of: it sold the track cargo its own depot plan needed down to the
    // depot's bare price, `rivalBankTowardPlan` bought it back at 4:1 the same
    // turn, and the pair vaporized the purse round-robin instead of ever
    // affording the plan.
    const planGuard = rivalPlanReserve(f, now) ?? {};
    // The Ore the bank must reach is the paved Ore PLUS the plant reserve,
    // because that is the number `spendableOre` already deducted.
    const oreGoal = need + (rivalPlantWanted() ? (PLANT_COST.ore ?? 0) : 0);
    return planBankTrades(
      rival.purse,
      "ore",
      // The whole plan is guarded (not just its Ore): the sell side of an
      // exchange must never empty a cargo the Depot the rival is building is
      // still saving for — AI-01's churn guard, one rule below.
      { ...planGuard, ore: Math.max(planGuard.ore ?? 0, oreGoal) },
      {
        // L17 (#245): the bank is back — the rival gates on its own rungs.
        unlocked: bankRungsFor(rival), budget: bankBudget(rivalPaceNow()),
        need: oreGoal,
      },
    );
  }

  /**
   * PP-07: the rival's idle-turn bank, aimed at the plan it cannot afford.
   *
   * Its only income is the trickle, and NO trickle cargo pays for everything a
   * Depot costs (the table's Wood + Stone + Grain + Oil, plus the track leg to
   * reach it): without this the AI deadlocks on its first paid expansion, the
   * exact endless-dependency loop the ticket forbids. It runs on a turn where
   * nothing else happened, gives from the cargo it holds most, never touches
   * Gold (PP-08), and leaves the rest of the plan's cargo alone — the target IS
   * the full price of the plan it wants, the track leg and the Depot together.
   */
  const rivalBankTowardPlan = (f: Factory, now: number) => {
    const skint = rivalReserve(f, now);
    if (!skint) return;
    const { goal: target, paving } = skint;
    // L17 (#245): the bank is back — the rival gates on its own rungs.
    const unlocked = bankRungsFor(rival);
    let budget = bankBudget(rivalPaceNow());
    // AI-02: a bank pointed at the PAVE goal must buy past the plant reserve,
    // or it stops one trade short where the pave pass can still not pay (see
    // `spendableOre`); a bank pointed at the depot plan uses raw numbers.
    const oreNeed = paving
      ? (target.ore ?? 0) + (rivalPlantWanted() ? (PLANT_COST.ore ?? 0) : 0)
      : (target.ore ?? 0);
    for (const [cargo, amount] of Object.entries(target) as [Cargo, number][]) {
      if (budget <= 0) break;
      const need = cargo === "ore" ? oreNeed : amount;
      if ((rival.purse[cargo] ?? 0) >= need) continue;
      // The guard keeps every OTHER cargo the plan is saving for — the AI-01
      // churn guard, and the reason one pass cannot starve the other.
      budget -= planBankTrades(
        rival.purse,
        cargo,
        { ...target, [cargo]: Math.max(target[cargo] ?? 0, need) },
        { unlocked, budget, need },
      );
    }
  };

  /**
   * The need the rival is working toward right now: the Depot plan, unless the
   * pave batch is fewer units away — then the scoreboard. `paving` says which
   * side won, which is what the plant step's guard reads (a pave goal must be
   * guarded past the plant reserve, a Depot plan in raw numbers).
   */
  const rivalReserve = (f: Factory, now: number): { goal: Purse; paving: boolean } | null => {
    const planTarget = rivalPlanReserve(f, now);
    const gapTo = (p: Purse | null, oreAvail: number): number => {
      if (!p) return Infinity;
      let missing = 0;
      for (const [k, v] of Object.entries(p) as [Cargo, number][]) {
        const have = k === "ore" ? oreAvail : (rival.purse[k] ?? 0);
        missing += Math.max(0, v - have);
      }
      return missing;
    };
    const paveTarget = rivalPaveReserve();
    if (paveTarget && gapTo(paveTarget, spendableOre()) < gapTo(planTarget, rival.purse.ore ?? 0)) {
      return { goal: paveTarget, paving: true };
    }
    return planTarget ? { goal: planTarget, paving: false } : null;
  };

  /**
   * L5 (#219): the rival's CITY UPGRADE.
   *
   * The new loop's second progression, and the AI has to be able to take it or
   * "the rival progresses through the tree" would only ever mean Depot types.
   * Two guards keep it from being a purse sink that starves its own plans, the
   * same shape the plant step uses:
   *
   *   • it must already have a connected Depot for the bonus to multiply;
   *   • the upgrade must be payable WITHOUT the goal it is working toward —
   *     the plant rule ("a plant bought with the purse the next Depot needs is
   *     the measured plant-rush stall") applied to the city — with how much of
   *     that goal it keeps back set by the difficulty (`townReserve`, L14:
   *     the upgrade-timing lever).
   *
   * The session that confirms it is SIMULATED, exactly like the rival's Depot
   * tuning (`rivalTuningScore`), so its bonus lands on the same score→strength
   * curve a played one would — and the difficulty clamp comes for free,
   * because that curve reads the same axis.
   */
  function rivalTownStep(): boolean {
    if (!newLoop) return false;
    const rivalCity = upgradableCities(rival).sort((a, b) => cityOf(a, rival).level - cityOf(b, rival).level)[0]
      ?? null;
    // No city yet (no plant beside a town): the seat-level upgrade, as before.
    if (!rivalCity && citiesOf(rival).length > 0) return false;
    const price = priceTownUpgrade(rival.purse, rivalCity ? cityOf(rivalCity, rival).level : rival.townLevel);
    if (!price.def || !price.affordable) return false;
    if (!eco.harvesters.some((h) => h.owner === rival.id && isServiced(eco.track, h, eco.rail))) return false;
    // L11 (#226) / L14 (#229): the reserve is the TREE's goal, scaled by the
    // difficulty's `townReserve` — the "upgrade timing" lever. The new loop has
    // exactly one thing to save for, and `treeGoal` is it; the shipped loop's
    // palace of plans (a Depot plan AND a pave milestone AND a plant reserve)
    // is the bank's own reader (`rivalReserve`), and this step is newLoop-only.
    const goal = treeGoal({ purse: rival.purse, tier: rival.depotTier });
    const keep = Math.max(0, skill().townReserve);
    const reserve: Purse = {};
    for (const [k, v] of Object.entries(goal?.cost ?? {}) as [Cargo, number][]) {
      reserve[k] = Math.ceil(v * keep);
    }
    const covers = (want: Purse): boolean =>
      (Object.entries(want) as [Cargo, number][]).every(
        ([k, v]) => (rival.purse[k] ?? 0) - (price.cost[k] ?? 0) >= v);
    // L16 (#231): the cap's vote on the reserve. The reserve guards income
    // that is still COMING; a cargo the upgrade costs that already sits at
    // the seat's storage cap is income being LOST every tick, and none of it
    // can be banked — so at the cap, waiting is strictly worse than buying
    // and the reserve is skipped. (The shipped caps sit well above their
    // reserves, so today this only fires on the tightest openings; it is the
    // rule the later, tighter rows of `TOWN_UPGRADES` will need.)
    const wasting = (Object.keys(price.cost) as Cargo[]).some((c) =>
      (rival.purse[c] ?? 0) >= storageCapFor(rival.townLevel));
    if (!wasting && !covers(reserve)) return false;
    if (!spend(rival, price.cost)) return false;
    const score = rivalTuningScore(skill().key);
    if (!rivalCity) {
      rival.townLevel = Math.min(rival.townLevel + 1, TOWN_UPGRADES.length);
      rival.townBonus = townBonusFor(price.def.bonus, score);
    } else {
      const c = cityOf(rivalCity, rival);
      cityTiers.set(rivalCity.id, {
        owner: rival.id, level: Math.min(c.level + 1, TOWN_UPGRADES.length),
        bonus: Math.max(c.bonus, townBonusFor(price.def.bonus, score)),
      });
      syncSeatCities(rival);
    }
    // L17 (#245): the rival's investment shows on the map too — its town
    // takes the same growth step, with the same moment, as the player's.
    const grownRival = rivalCity ? growCity(rivalCity, rival) : growTownForSeat(rival);
    // L14 (#229): say it in the feed, in the same words the player's own
    // upgrade uses (L5) — the rival climbing the city ladder is one of the
    // three things this ticket is about, and a ladder nobody can see is a
    // ladder nobody notices the rival climbing.
    ui.feed(`Rival upgrades its city: base rate +${Math.round(rival.townBonus * 100)}% (score ${Math.round(score)})`, rival.name);
    if (grownRival) {
      ui.feed(`The rival's ${townTierLabel(townTier(grownRival))} grows on the map.`, rival.name);
    }
    return true;
  }

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
    // L9 (#224): the raid plays the SAME card the player can buy, at the SAME
    // price — a Protest on a public road the player's own routes run through.
    // (The Blockade half of the raid table is `rivalSabotage`, immediately
    // below: it has its own targeting and its own Gold reserve.) Nothing here
    // touches a match-3 board any more; the three cards that did are gone.
    if (!RAID_ACTIONS.has("protest")) return;            // card retired
    const def = SABOTAGE.protest;
    if ((rival.purse.gold ?? 0) < def.gold) return;      // no Gold, no raid
    // A protest with nowhere to stand is not a raid — the clock is left
    // un-stamped so it tries again next turn rather than burning the window.
    const spot = pickProtestTarget("you", now);
    if (!spot) return;
    lastRaid = now;
    spend(rival, { gold: def.gold });             // the hire is paid either way
    if (now < securityUntil) {
      toast(`Security Forces turned the rival's ${def.name} away.`, "info");
      rivalSpeaks("thwarted", "protest");
      return;
    }
    const [tx, ty] = spot;
    // B5 (#250): the player may FIGHT OFF a Protest at the gates (solo).
    if (offerFightOff("protest", rival.id, undefined, [tx, ty], now + PROTEST_MS)) {
      rivalSpeaks("attack", "protest");
      return;
    }
    protests.set(tIdx(tx, ty), { tx, ty, until: now + PROTEST_MS, owner: rival.id });
    floats.add("✊ PROTEST", tx, ty, { cls: "sabotage", now });
    toast(
      `The rival staged a protest on the public road — every depot routed through it stops for ${fmtProtestLeft(PROTEST_MS)}.`,
      "bad",
    );
    ui.feed(`Rival stages a protest — the road is shut for ${fmtProtestLeft(PROTEST_MS)}`, rival.name);
    rivalSpeaks("attack", "protest");
    if (isMp()) publishNet(now, true);
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
  /**
   * THE ★ SEAM (L14, #229).
   *
   * Paving is the last old-loop limb the new-loop turn still moves, and it is
   * here on purpose: while `VICTORY.upgrade` pays — 4 Ore a tile, `PAVE_MILESTONE_TILES`
   * to the 1★ a plant costs — paving is the ONLY point a seat can score under
   * `newLoop` (L13/#228 replaces that table with the tree's rungs and the city's
   * tiers and is not merged). Both seats pave, so the race still has a winner.
   *
   * When #228 lands, delete this function, its one call in `aiNewLoopTurn`, the
   * pave branch of the shipped turn, and `scoreCargoWant` in ai.ts — the want
   * that exists only to send a seat with no ore of its own after a mine so it
   * can buy a point. Nothing else in the new loop reaches for ★.
   */
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
    if (!RAID_ACTIONS.has("bandit")) return;              // card retired
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
    // L9 (#224): the guard covers Blockades too — Security Forces are the one
    // answer to both map cards, and the rival pays for the attempt either way
    // (the same rule `rivalRaid` and `buyBlackFor` keep).
    if (now < securityUntil) {
      toast(`Security Forces turned the rival's ${SABOTAGE.bandit.name} away.`, "info");
      rivalSpeaks("thwarted", "bandit");
      return;
    }
    // B5 (#250): the player may FIGHT OFF a Blockade at the gates (solo; the
    // hire above is already spent either way).
    if (offerFightOff("blockade", rival.id, target.id, undefined, now + BANDIT_MS)) return;
    target.banditUntil = now + BANDIT_MS;
    const def = INDUSTRY_BY_KEY[target.type];
    floats.add("⛓ BLOCKADED", target.tx, target.ty, { cls: "sabotage", now });
    toast(`The rival blockaded your ${def?.name ?? target.type} — its depots stop ticking for ${BANDIT_MS / 1000}s.`, "bad");
    rivalSpeaks("attack", "bandit");
  }

  /**
   * RAIL-05 (#182): the seat's ONE rail action this turn — planned and
   * committed through the SAME `rail.ts` rules the player's drag commits
   * through (`planRailMove` → `executeRailMove` → `buildRail` /
   * `placePlatform` / …). Easy rivals keep the lever down (`skill().rail`), and
   * the whole action is inert while the DEV-only `railAvailable` flag is down.
   *
   * Shared by both turns (L14, #229: the new loop keeps the railway), so the
   * two can never disagree about what a rail turn is.
   *
   * #297: `platform` reports whether the move RAISED A PLATFORM — the one rail
   * action that scores (+1★ in both loops). The new-loop turn paces it on the
   * session clock like every other scoring action.
   */
  function rivalRailStep(f: Factory, now: number): { acted: boolean; laid: [number, number][]; platform: boolean } {
    const railState = railAvailable && skill().rail ? eco.rail ?? null : null;
    if (!railState) return { acted: false, laid: [], platform: false };
    const railMove = planRailMove(eco, railState, f, {
      purse: rival.purse, ownerId: rival.i + 1, useRail: true, scope: "line", now,
    });
    if (!railMove || !canPay(rival.purse, railMove.cost)) return { acted: false, laid: [], platform: false };
    const res = executeRailMove(eco, railState, railMove, rival.id, rival.i + 1);
    if (!res) return { acted: false, laid: [], platform: false };
    if (res.refund) earn(rival, res.refund);
    else if (Object.keys(res.spent).length) spend(rival, res.spent);
    if (railMove.kind === "platform") {
      const s = railState.structures[railState.structures.length - 1];
      if (s && s.ownerId === rival.i + 1) adoptPlatformDepot(s, rival);
    }
    ui.feed(`Rival ${res.label}`, rival.name);
    return { acted: true, laid: railMove.kind === "track" ? res.tiles : [], platform: railMove.kind === "platform" };
  }

  /**
   * RAIL-05: `syncWorld`'s shadow diff repainted the tiles whose OWN rail byte
   * moved; a track tile's NEIGHBOURS changed shape with it (their rail end-cap
   * becomes a through-run), so the ±1 neighbourhood goes too — the same
   * invalidation the player's `commitRailDrag` does.
   */
  function invalidateRailLaid(laid: [number, number][]) {
    for (const [tx, ty] of laid) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = tx + dx, y = ty + dy;
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
      }
    }
  }

  /**
   * ══════════════════════════════════════════════════════════════════════════
   * L14 (#229) — ONE rival turn on the NEW loop.
   *
   * The same verbs the player has, in the same order, priced through the same
   * functions:
   *
   *   1. CONNECT — `aiBuildStep` with the loop's own cost model (dirt is free,
   *      L2), so it reaches a fresh industry with gravel and stands a Depot on
   *      it. The ranking is steered by the TREE, not by the scoreboard:
   *      `treeGoal`/`treeWants` name the cargoes the next rung's price is short
   *      of, and the industry that makes one of them outranks the rest. That is
   *      the whole answer to "never deadlocks in the tree" — a seat short of
   *      grain for its Quarry Depot goes and earns grain instead of buying a
   *      fourth forest with the wood it is rich in.
   *   2. TUNE — `applyRivalTuning` gives every Depot it just raised the
   *      simulated session result its difficulty plays (L4/L10), which is also
   *      what opens the next rung (L5's session gate).
   *   3. SPEND — the city upgrade (L5, timed by `skill().townReserve`) and a
   *      re-match on a Depot that has actually cooled (L6's decay, the answer
   *      to it, and the same key the player's plate offers).
   *
   * Deliberately NOT here, because the new loop has no such decision — L14's
   * "no rival code path references removed systems": banking toward a plan
   * (`rivalBankTowardPlan`), buying the Ore the bank would have bought
   * (`rivalBankTowardPave`) and autoplaying its own board (`rivalAutoplay`).
   * Each still exists for the shipped loop and returns immediately under this
   * flag, so the solver, the bank and the watched plant board all stay
   * exactly as shipped for the game that still runs them. (L11 / #226 took
   * the market off BOTH loops — there is no `rivalMarketOffer` left to call.)
   *
   * ONE leftover, on purpose: the pave pass (`rivalPavePass`). Paving is still
   * the only ★ the game pays a seat (L13/#228 replaces the ★ sources — build
   * rungs and city tiers — and is not merged yet), so a rival that stopped
   * paving today would score nothing at all and the race would have no winner.
   * It is the last old-loop limb in this turn, it is documented as such, and
   * #228 is where it goes.
   * ══════════════════════════════════════════════════════════════════════════
   */
  function aiNewLoopTurn(f: Factory, now: number): void {
    // #297: the rival is still "playing" its last tuning session. A Depot, a
    // city upgrade and a re-match each cost the player a real session on the
    // board, so each costs the rival `sessionMs` of turn time too. Before this
    // a Normal rival raised two Depots (and opened a rung) every build clock
    // and reached 12★ in about 35 seconds.
    if (now < rivalSessionUntil) return;
    const startSession = () => { rivalSessionUntil = now + skill().sessionMs; };
    let acted = false;
    // #297: ONE city tier per turn, no matter which step buys it. Without
    // this guard the rival could buy a tier at step 0 (cap-first) AND another
    // at step 4 (post-depot), bursting 4★ of city in a single turn and
    // sprinting to the win line before the player could answer. The flag is
    // set by whichever step lands the tier first and read by the other.
    let townBoughtThisTurn = false;
    // The tree's answer, read once and used by all three verbs below — the
    // plant guard, the planner's ranking and the city's reserve all work
    // toward the SAME goal, so one turn cannot pull in two directions.
    const goal = treeGoal({ purse: rival.purse, tier: rival.depotTier });
    // Owner call (2026-09): with the rung gate off every Depot costs one of
    // each cargo, so no single industry pays for the next one. The bank is how
    // the mix gets made — trade toward it FIRST, then build in the same turn,
    // instead of only banking when a turn found nothing else to do (that
    // trickle never caught up, and the rival stalled).
    if (!DEPOT_RUNG_GATE && goal && goal.missing.length > 0) rivalBankTowardGoal(goal.cost);
    const want = treeWants(goal, scoreCargoWant(eco, rival.id));

    // ── 0. city upgrade FIRST at the cap (L16, #231) ───────────────────────
    // A purse pressed against its storage cap is losing income on every
    // tick, and the depot pass below spends GREEDILY — it can eat the very
    // mix the upgrade costs and leave the seat capped for another whole
    // turn. When the rival is at its cap and the next city upgrade is
    // buyable (price, reserve and all — `rivalTownStep` checks every gate),
    // the upgrade is hoisted above the depot pass: it raises the cap and
    // the base rate together, converting wasted ticks into income. Off the
    // cap, the shipped order — connect first — stands.
    const townFirst = CARGOES.some((c) => (rival.purse[c] ?? 0) >= storageCapFor(rival.townLevel));
    if (townFirst && rivalTownStep()) {
      // #297: …and the tier this turn bought. The early return below is what
      // keeps step 4 from buying a second one today; the flag is what keeps
      // it bought-once if that return ever goes away.
      townBoughtThisTurn = true;
      // #297: a city upgrade is a session — it takes the whole turn.
      startSession();
      syncWorld();
      rescoreNow();
      return;
    }

    // ── 1. plant — reach, and (until #228) a ★ ─────────────────────────────
    // A Processing Plant still earns its 1★ (VICTORY.plant is a live source
    // for both seats) and it still widens the map a seat can deliver over, so
    // the rival buys one exactly as the shipped turn does — under the SAME
    // guard, restated in the new loop's terms: a plant may not eat the purse
    // the next Depot's price needs. `treeGoal` is that purse.
    if (canAffordPlant(rival.purse)) {
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
      // Nothing to save for (no goal left) is a plant, as ever; otherwise the
      // goal's own price has to survive the purchase.
      if (!goal || covers(withPlant(goal.cost))) {
        const spot = chooseAiPlantSpot(grid, track, eco, rival.id);
        if (spot && placePlant(spot[0], spot[1], rival)) {
          acted = true;
          // placePlant rescores immediately; if that was the winning star the
          // curtain is already up, and nothing may be added after the ledger.
          if (winner !== null) return;
        }
      }
    }

    // ── 2. depot — the tree's next rung, reached on free gravel ────────────
    // Same plan, same prices and same tree gate as the shipped turn
    // (`aiBuildStep` → `planCandidates` → `priceDepot`); the new-loop input is
    // `wantCargo`. `expandPerTurn` still paces how many it may raise in one
    // clock, so a hard rival visibly spreads.
    const depotBuild = (): boolean => {
      const out = aiBuildStep(eco, f, {
        stock: rival.purse, purse: rival.purse,
        free: rival.freeTrack, freeDepots: rival.freeDepots, now,
        newLoop, depotTier: rival.depotTier, wantCargo: want,
      }, allocHarvesterId());
      if (!out) return false;
      rival.freeTrack = Math.max(0, rival.freeTrack - out.free);
      rival.freeDepots = Math.max(0, rival.freeDepots - out.freeDepots);
      spend(rival, out.spent);
      for (const [bx, by] of out.built) renderer?.invalidateTile(bx, by);
      ui.feed(`Rival expands: a new Depot and ${out.built.length} road tile${out.built.length === 1 ? "" : "s"}`, rival.name);
      return true;
    };
    // #297: ONE Depot per turn on the new loop — each one is a tuning
    // session, and the session clock paces the next.
    const builtDepot = depotBuild();
    if (builtDepot) {
      acted = true;
      startSession();
    }
    // 3. tune — the simulated session each new Depot would have been built
    //    with, on the record before the income clock next reads it.
    applyRivalTuning();

    // ── 4. spend: the city upgrade, then a re-match on a cooled Depot ──────
    // L16 (#231): at the cap the upgrade ran BEFORE the depot pass (see
    // `townFirst` above); this second call is a no-op then — the row is
    // bought or maxed — but it keeps the call site ONE door for every turn,
    // so a multi-row future cannot grow a second code path.
    // #297: `townBoughtThisTurn` gates this call — one tier per turn is the
    // pace the ★ table was balanced for. Without the gate a cap-first rival
    // could buy two tiers on the same clock and burst past the win line.
    // #297: …and only on a turn that did not already start a session.
    // The two verbs are spelled out (instead of `town() || retune()`) so the
    // flag records WHICH one landed: a tier bought here counts against the
    // one-tier-per-turn pace exactly like a cap-first tier does.
    let spentSession = false;
    if (!builtDepot && !townBoughtThisTurn) {
      if (rivalTownStep()) {
        townBoughtThisTurn = true;
        spentSession = true;
      } else if (rivalRetuneStep()) {
        spentSession = true;
      }
    }
    if (spentSession) {
      acted = true;
      startSession();
    }

    // ── 5. pave — the ★ seam #228 removes (see the note above) ─────────────
    if (rivalPavePass()) acted = true;

    // ── 6. railway (RAIL-05) — shared with the shipped turn ────────────────
    const rail = rivalRailStep(f, now);
    if (rail.acted) acted = true;
    // #297: a platform is a ★, so it is a session like any other scoring
    // action — without this a rich rival would raise one every build clock
    // (the rail flag is dev-only today, but the pace must hold when it ships).
    if (rail.platform) startSession();

    if (acted) {
      syncWorld();
      invalidateRailLaid(rail.laid);
      rescoreNow();
      return;
    }
    // L17 (#245): nothing affordable — before waiting on the clock, trade
    // toward the tree's goal at the bank, through the same gate and planner as
    // the player (its own rungs, `bankPerTurn` trades at most). This is the
    // way out when the other seat holds every industry of a cargo it needs.
    if (goal && rivalBankTowardGoal(goal.cost)) {
      syncWorld();
      rescoreNow();
      return;
    }
    // Still nothing: wait for the clock, and the next turn comes on `idleMs`,
    // exactly like the shipped turn's idle path.
    lastAi = now - skill().buildMs + skill().idleMs;
  }

  /** L17 (#245): one bank pass toward a price; true when any trade landed. */
  function rivalBankTowardGoal(cost: Purse): boolean {
    const unlocked = bankRungsFor(rival);
    let budget = bankBudget(rivalPaceNow());
    let traded = 0;
    for (const [cargo, amount] of Object.entries(cost) as [Cargo, number][]) {
      if (budget <= 0) break;
      if ((rival.purse[cargo] ?? 0) >= amount) continue;
      const n = planBankTrades(rival.purse, cargo, cost, { unlocked, budget, need: amount });
      budget -= n;
      traded += n;
    }
    return traded > 0;
  }

  function aiTick(now: number) {
    // B5 (#250): no AI action and no economy churn during a battle; the two
    // offer doors (rival challenges, fight-offs) expire here too.
    if (battleScreen) return;
    // Playtest (2026-09): nor while YOUR tuning session is open. The session
    // is modal (you cannot lay the road that would claim the industry), and
    // the rival used that window to build beside a Depot you had just placed.
    // Solo only: in a hosted game the other seat is a person.
    if (tuning && (isSolo() || aiOpponent)) return;
    b5OffersTick(now);
    // B6 review fix: the rival's challenge clock is the AI's — in a hosted game
    // with a person on seat 1 it would spend THEIR Gold on fights they never
    // called (and every guest ran it against its local copy of the host).
    if (isSolo() || aiOpponent) maybeRivalChallenge(now);
    maybeComebackLoss(me);
    if (!isGuest()) maybeComebackLoss(rival);
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
    // L14 (#229): the new loop plays a different turn — connect, tune, spend —
    // and it has no bank to fall back on, so it keeps its own shape instead of
    // threading a dozen `if (newLoop)` branches through the shipped one. The
    // raid/sabotage clocks above are shared, and so is the railway below.
    if (newLoop) { aiNewLoopTurn(f, now); return; }
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
      const target = rivalReserve(f, now);
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
      // L5 (#219): the tree gate — the planner may only plan a Depot whose
      // type sits on a rung the rival has opened (a played session each).
      depotTier: rival.depotTier,
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

    // 2b. the city upgrade (L5, #219) — the tree's other progression, and the
    //     one that scales every depot the rival owns. After the Depot pass, so
    //     a turn that just raised one tunes it first; before the pave pass, so
    //     the scoreboard still gets whatever is left.
    if (rivalTownStep()) acted = true;

    // 3. pave — what the scoreboard pays for, with whatever Ore is spare; and
    //    when the Ore is not spare but the gravel is there, buy it (VP-01),
    //    through the same gated bank the plan tail uses.
    if (rivalPavePass()) acted = true;
    else rivalBankTowardPave(f, now);

    // 4. railway (RAIL-05, #182) — the seat's ONE rail action this turn,
    //    committed through the SAME `rail.ts` rules the player's drag commits
    //    through (`executeRailMove` → `buildRail` / `placePlatform` / …). Easy
    //    rivals keep the lever down; the flag down means no railway.
    const rail = rivalRailStep(f, now);
    if (rail.acted) acted = true;

    if (acted) {
      syncWorld();
      invalidateRailLaid(rail.laid);
      rescoreNow();
      return;
    }
    // PP-07 / L11 (#226): nothing affordable at all — bank toward the plan it
    // wants (through the tree gate), then take the turn if the trade unlocked
    // it. Retry in one harvest tick, not one build clock.
    rivalBankTowardPlan(f, now);
    const retry = aiBuildStep(eco, f, opts(), allocHarvesterId());
    if (retry) {
      rival.freeTrack = Math.max(0, rival.freeTrack - retry.free);
      rival.freeDepots = Math.max(0, rival.freeDepots - retry.freeDepots);
      spend(rival, retry.spent);
      for (const [bx, by] of retry.built) renderer?.invalidateTile(bx, by);
      // L4 (#218): the retry path raises a Depot too — tune it like any other.
      applyRivalTuning();
      syncWorld();
      rescoreNow();
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
    // L5 (#219): the seat's place in the depot tree and its city upgrade ride
    // the same record the allowances do — a guest (or a resync) must price the
    // same next Depot and show the same city as the host.
    depotTier: p.depotTier, townLevel: p.townLevel, townBonus: p.townBonus,
  }));

  /**
   * L9 (#224): the live Blockades, for the wire. Industries are seed-derived
   * and never sent, so only the EXPIRY travels — keyed by the industry id both
   * clients already agree on. Without this a guest whose depots were
   * blockaded would simply stop earning with nothing on its map to say why
   * (the Blockade is half the shop now, so that gap is no longer cosmetic).
   */
  const blockadesWire = (now = performance.now()) =>
    grid.industries
      .filter((ind) => ind.banditUntil > now)
      .map((ind) => ({ id: ind.id, until: ind.banditUntil }));

  /**
   * GUEST: adopt the host's Blockade set wholesale. The host is authoritative
   * (§9), so an industry absent from the list is NOT blockaded — a lifted
   * blockade has to clear on the guest too, or its map keeps showing a
   * stoppage the host has already forgotten.
   */
  function applyBlockadesWire(list: { id: number; until: number }[]): void {
    const byId = new Map(list.map((b) => [b.id, b.until]));
    for (const ind of grid.industries) ind.banditUntil = byId.get(ind.id) ?? 0;
  }

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

  /** B5 (#250): the map's battle layer on the wire — conquests + cooldown
   *  clocks (absolute on the shared publish clock, the `protests` rule). */
  function battleWire(): NonNullable<Snapshot["battle"]> {
    return {
      locks: [...(eco.battleLocks ?? [])],
      readyAt: [...challengeState.readyAt],
      playerReadyAt: [...challengeState.playerReadyAt],
      rivalReadyAt: challengeState.rivalReadyAt,
      battles: challengeState.battles,
      siteRights: eco.siteRights
        ? [...eco.siteRights].map(([id, r]) => [id, { rights: [...r.rights], streak: r.streak ? { ...r.streak } : null }] as [number, { rights: string[]; streak: { playerId: string; wins: number } | null }])
        : undefined,
      townHolds: eco.townHolds
        ? [...eco.townHolds].map(([id, h]) => [id, { ...h }] as [number, { holder: string; wins: number; locked: boolean }])
        : undefined,
      ...duelWireOut(),
    };
  }

  /** HOST: the full state (§4 `SnapshotMsg`), built from the live world. */
  function netFullState(): Snapshot | null {
    // L15 (#230): boards and crossPrompt are gone — the board is tuning-only
    // and blessings are retired, so no board state or cross prompt rides the wire.
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
      protests: protestsWire,
      battle: battleWire(),
      blockades: blockadesWire(),
      trucks: trucksWire,
      cars: carsWire,
      rail: railWire(true),
      winner: winner ? { id: winner.id, source: winningSource } : null,
      clearedFields: [...clearedFields],
      offers: offersToWire(offerBook, performance.now()),
    });
  }

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
    mpMatchLive = true;
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
      protests: protestsWire,
      battle: battleWire(),
      blockades: blockadesWire(),
      trucks: trucksWire,
      cars: carsWire,
      rail: railWire(),
      clearedFields: [...clearedFields],
      winner: winner ? { id: winner.id, source: winningSource } : null,
      offers: offersToWire(offerBook, now),
    } as any);
  }

  /** One opening line per guest boot; the phase itself is re-derived on every
   *  applied state, because the other seat's structures arrive at their own
   *  pace. */
  let guestOpened = false;

  // ── TRADE: the offer board (owner call, 2026-09) ─────────────────────────
  // The host (or the solo game) owns the book; purses are the seats' own.
  // A guest sends `trade` intents and reads the book off the wire. Seats are
  // HOST-frame indices (0 = host / solo player, 1 = guest / rival).
  const offerBook = createOfferBook();
  /** GUEST: the host's book, mirrored into this seat's frame. */
  let guestOffers: Offer[] = [];
  let lastRivalTrade = 0;
  const seatPurses = (): [PlayerState["purse"], PlayerState["purse"]] => [players[0].purse, players[1].purse];
  const offerLine = (o: Offer) => `${o.giveN} ${CARGO[o.give].name} for ${o.wantN} ${CARGO[o.want].name}`;

  /** The book as THIS client sees it (own seat = 0). */
  const visibleOffers = (): Offer[] => (isGuest() ? guestOffers : offerBook.offers);

  /** Host/solo: a seat posts. Returns the refusal, or null on success. */
  function tradePost(seat: Seat, give: Cargo, giveN: number, want: Cargo, wantN: number): OfferRefusal | null {
    const r = postOffer(offerBook, players[seat].purse, seat, give, giveN, want, wantN, performance.now());
    if (typeof r === "string") return r;
    ui.feed(`${players[seat].name} offered ${offerLine(r)}.`);
    if (isMp()) publishNet(performance.now(), true);
    return null;
  }

  /** Host/solo: a seat takes another seat's offer. */
  function tradeAccept(seat: Seat, id: number): OfferRefusal | null {
    const r = acceptOffer(offerBook, seatPurses(), seat, id);
    if (typeof r === "string") return r;
    const poster = players[r.from], taker = players[seat];
    ui.feed(`${taker.name} took ${poster.name}'s offer: ${offerLine(r)}.`);
    if (r.from === 0 && seat !== 0) toast(`${taker.name} took your offer: ${offerLine(r)}.`, "good");
    if (isMp()) publishNet(performance.now(), true);
    return null;
  }

  /** Host/solo: a seat withdraws its own offer (escrow refunded). */
  function tradeCancel(seat: Seat, id: number): OfferRefusal | null {
    const r = cancelOffer(offerBook, players[seat].purse, seat, id);
    if (typeof r === "string") return r;
    if (isMp()) publishNet(performance.now(), true);
    return null;
  }

  /**
   * Host/solo, every frame: expire stale offers (refunding escrow) and, when
   * seat 1 is a machine, let it answer the player's offers and post its own
   * toward the Depot it is saving for.
   */
  function tradeTick(now: number): void {
    if (isGuest()) return;
    const gone = expireOffers(offerBook, seatPurses(), now);
    for (const o of gone) {
      if (o.from === 0) ui.feed(`Your offer expired (${offerLine(o)}) — escrow refunded.`);
    }
    if (gone.length && isMp()) publishNet(now, true);
    const machine = isSolo() || aiOpponent;
    if (!machine || phase !== "play" || battleScreen) return;
    if (now - lastRivalTrade < RIVAL_TRADE_MS) return;
    lastRivalTrade = now;
    const need = (treeGoal({ purse: rival.purse, tier: rival.depotTier })?.cost ?? {}) as Record<string, number>;
    for (const o of [...offerBook.offers]) {
      if (o.from !== 0) continue;
      if (rivalWouldAccept(rival.purse, o, need)) tradeAccept(1, o.id);
    }
    if (liveOffers(offerBook, 1).length === 0) {
      const idea = chooseRivalOffer(rival.purse, need);
      if (idea) tradePost(1, idea.give, idea.giveN, idea.want, idea.wantN);
    }
  }

  /** The chrome's doors. A guest's are requests; the host's delta confirms. */
  function tradeRequest(
    what: "post" | "accept" | "cancel",
    args: { give?: Cargo; giveN?: number; want?: Cargo; wantN?: number; id?: number },
  ): "done" | "relayed" | string {
    if (isGuest()) {
      return net?.sendIntent("trade", { do: what, ...args }) ? "relayed" : "Not connected.";
    }
    const r = what === "post"
      ? tradePost(0, args.give!, args.giveN!, args.want!, args.wantN!)
      : what === "accept" ? tradeAccept(0, args.id!) : tradeCancel(0, args.id!);
    return r ? OFFER_REFUSAL_TEXT[r] : "done";
  }

  /** HOST: a guest's `trade` intent, validated against the guest's seat. */
  function applyTradeIntent(payload: Record<string, unknown>, echoed: string[]): void {
    const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : -1);
    const cargo = (v: unknown): Cargo | null => (isCargo(v as string) ? v as Cargo : null);
    let r: OfferRefusal | null = null;
    if (payload.do === "post") {
      const give = cargo(payload.give), want = cargo(payload.want);
      if (!give || !want) { echoed.push("The market can't read that offer."); return; }
      r = tradePost(1, give, num(payload.giveN), want, num(payload.wantN));
    } else if (payload.do === "accept") r = tradeAccept(1, num(payload.id));
    else if (payload.do === "cancel") r = tradeCancel(1, num(payload.id));
    else { echoed.push("That trade action is not available."); return; }
    if (r) echoed.push(OFFER_REFUSAL_TEXT[r]);
  }

  /** A save keeps escrow in the purse: an open offer is refunded on reload. */
  const purseWithEscrow = (seat: Seat): Record<string, number> => {
    const out = { ...(players[seat].purse as Record<string, number>) };
    for (const o of offerBook.offers) if (o.from === seat) out[o.give] = (out[o.give] ?? 0) + o.giveN;
    return out;
  };

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
        // Owner (2026-09): the objective line carries the next step.
      }
    }
  }
  /**
   * #114: write an authoritative balance INTO a seat's existing purse object.
   * `players[i].purse = toBag(...)` (the old code) minted a fresh object and
   * left every earlier capture pointing at the stale one — the HUD's purse
   * readouts and every affordability button kept showing (and pricing from)
   * the opening balance long after the host had moved the real one. The purse
   * object is created ONCE per seat and handed to the HUD by reference
   * (`UiSeat.res`), so updates go through it.
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
    // L5 (#219): the depot tree + city upgrade. Same contract as the
    // allowances above: absent leaves the seat alone, `0` is a value.
    const dt = wire.depotTier, tl = wire.townLevel, tb = wire.townBonus;
    if (typeof dt === "number" && Number.isFinite(dt)) p.depotTier = Math.max(0, Math.floor(dt));
    if (typeof tl === "number" && Number.isFinite(tl)) p.townLevel = Math.max(0, Math.floor(tl));
    if (typeof tb === "number" && Number.isFinite(tb)) p.townBonus = Math.max(0, tb);
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
    // protests
    if (applied.protests) {
      protests.clear();
      for (const pw of applied.protests) {
        protests.set(tIdx(pw.x, pw.y), { tx: pw.x, ty: pw.y, until: pw.until, owner: pw.owner });
      }
    }
    // B5 (#250): the battle layer — a full state always says what the host's
    // conquests and cooldowns ARE (absent = none, the rail rule).
    // TRADE: a full state always says what the book IS (absent = empty).
    guestOffers = offersFromWire(applied.offers ?? [], true, performance.now());
    if (applied.battle) {
      eco.battleLocks = new Map(applied.battle.locks);
      challengeState.readyAt = new Map(applied.battle.readyAt);
      challengeState.playerReadyAt = new Map(applied.battle.playerReadyAt);
      challengeState.rivalReadyAt = applied.battle.rivalReadyAt;
      challengeState.battles = applied.battle.battles;
      guestApplyDuel(applied.battle);
    } else {
      eco.battleLocks = new Map();
      challengeState.readyAt = new Map();
      challengeState.playerReadyAt = new Map();
    }
    // L9 (#224): …and the Blockades, the other half of the map shop. A full
    // state always says what the host's blockades ARE (absent = none).
    applyBlockadesWire(applied.blockades ?? []);
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
    // L15 (#230): boards and crossPrompt are gone from the wire — the board
    // is tuning-only and blessings are retired, so nothing to restore here.
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
    if ((msg as any).protests) {
      protests.clear();
      for (const pw of (msg as any).protests) {
        protests.set(tIdx(pw.x, pw.y), { tx: pw.x, ty: pw.y, until: pw.until, owner: pw.owner });
      }
      worldDirty = true;
    }
    // B5 (#250): the battle layer rides the delta like the rest of the map.
    if ((msg as any).offers) guestOffers = offersFromWire((msg as any).offers, true, performance.now());
    if ((msg as any).battle) {
      const bw = (msg as any).battle;
      eco.battleLocks = new Map(bw.locks ?? []);
      challengeState.readyAt = new Map(bw.readyAt ?? []);
      challengeState.playerReadyAt = new Map(bw.playerReadyAt ?? []);
      challengeState.rivalReadyAt = bw.rivalReadyAt ?? 0;
      challengeState.battles = bw.battles ?? 0;
      if (bw.siteRights) eco.siteRights = new Map(bw.siteRights.map(([id, r]: [number, { rights: string[]; streak: { playerId: string; wins: number } | null }]) => [id, { rights: [...r.rights], streak: r.streak ? { ...r.streak } : null }]));
      if (bw.townHolds) eco.townHolds = new Map(bw.townHolds.map(([id, h]: [number, { holder: string; wins: number; locked: boolean }]) => [id, { ...h }]));
      guestApplyDuel(bw);
      worldDirty = true;
    }
    // L9 (#224): a delta carries the Blockade set whenever it carries any
    // world state, so an expiry the host swept is swept here too.
    if ((msg as any).blockades) {
      applyBlockadesWire((msg as any).blockades);
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
    // L15 (#230): boards and crossPrompt are gone from the wire.
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
      if (msg.action === "trade") {
        applyTradeIntent(payload, echoed);
      } else if (msg.action === "battle") {
        // B6 (#251): checked FIRST — `do: "swap"` also names a build intent.
        applyBattleIntent(payload, echoed);
      } else if (what === "track") {
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
      } else if (what === "reset") {
        const now = performance.now();
        if (now - guestResetAt < RESET_COOLDOWN_MS) {
          const left = Math.ceil((RESET_COOLDOWN_MS - (now - guestResetAt)) / 1000);
          toast(`Processing Plant reset is cooling down — ${left}s to go.`, "info");
        } else if (rivalQuarry.board.busy) {
          toast("The plant is mid-cascade — try the reset again in a moment.", "info");
        } else {
          guestResetAt = now;
          rivalQuarry.board.resetNeutral();
          toast("Processing Plant collapsed. Fresh neutral board.", "info");
        }
      } else if (what === "bank") {
        // L11 (#226), restored by L17 (#245): a guest's bank trade is a
        // REQUEST. The host re-runs the whole rule against the GUEST's own
        // seat — a well-formed pair, the rungs the guest has unlocked, the
        // guest's balance — and applies it to the guest's purse; the forced
        // publish below is what lands the delta back on the guest. One path
        // with solo/host, so a relayed trade cannot drift from a local one.
        const give = isCargo(payload.give as string) ? payload.give as Cargo : null;
        const want = isCargo(payload.want as string) ? payload.want as Cargo : null;
        if (give === null || want === null || give === want
          || give === "gold" || want === "gold") {
          echoed.push("The bank can't read that trade.");
        } else if (!bankCanExchange(p, give) || !bankCanExchange(p, want)) {
          echoed.push(bankAllowed(give, bankRungsFor(p)) && bankAllowed(want, bankRungsFor(p))
            ? `The bank wants ${BANK_RATE} ${CARGO[give].name}.`
            : `${CARGO[[give, want].find((c) => !bankAllowed(c, bankRungsFor(p)))!].name} needs rung ${bankTier([give, want].find((c) => !bankAllowed(c, bankRungsFor(p)))!)} — tune a Depot to unlock it.`);
        } else if ((p.purse[give] ?? 0) < BANK_RATE) {
          echoed.push(`The bank wants ${BANK_RATE} ${CARGO[give].name}.`);
        } else {
          bankTrade(p.purse, give, want, { unlocked: bankRungsFor(p) });
          toast(`Bank: ${BANK_RATE} ${CARGO[give].name} → 1 ${CARGO[want].name}.`, "good");
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
          // seat OPPOSITE the attacker: a guest's Blockade stops the HOST's
          // depots, never the guest's own.
          //
          // L9 (#224): the core also owns the "that card is retired" refusal,
          // so an older guest build relaying `harden` / `block` / `fog` /
          // `repair` is answered rather than obeyed — and charged nothing.
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
          // A typed body with no coordinates and no branch above it: an
          // intent this build does not know (a retired one from an older
          // guest, most likely). Refuse it out loud rather than silently.
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
        duelPeer("left");
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
        duelPeer("gone", graceMs);
        mpPeerAwayName = username || rival.name || "Opponent";
        mpPeerAwayUntil = performance.now() + Math.max(graceMs, 0);
        mpDisconnectEpisode++;
        toast(`${escText(mpPeerAwayName)} disconnected — holding their seat for `
          + `${Math.round(Math.max(graceMs, 0) / 1000)}s…`, "info");
      },
      opponentReconnected: (username) => {
        duelPeer("back");
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
      // C1 (#255): a chat line from the other seat, already through the
      // session's receive rules (length, control characters, word filter, rate
      // window, mute). It lands in the log and nowhere else — chat is not a
      // game action, so it cannot reach the world even by accident.
      chat: (msg) => pushChat(msg),
      status: (state) => {
        // A reconnect is exactly when a guest must re-pull state; the session
        // already asks, this just tells the player not to panic.
        if (state === "reconnecting") toast("Reconnecting…", "info");
        // #115/#112: a dropped link invalidates unconfirmed requests — the
        // protest targeting and the open bounty chooser would otherwise sit
        // there pointing at a host that cannot answer.
        if (state !== "connected") {
          pendingProtest = false;
          // L15: cross retired
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
  const depotLocksFor = (playerId: string) => ({
    locked: lockedIndustryIdsFor(eco, playerId),
    factories: eco.factories.map((f) => ({ tx: f.tx, ty: f.ty })),
    facing: depotView,
  });
  const depotLocks = () => depotLocksFor(me.id);

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
      if (kind === "platform") {
        // Playtest (2026-09): the side its track goes — the three stopping
        // tiles laid with it, banded, and the middle one (where the train
        // stops) tagged. R turns the platform AND swaps the side.
        const row = platformTrackAt(tx, ty, railView);
        for (const [x, y] of row) {
          if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) items.push({ sprite: "highlight_soft", tx: x, ty: y });
        }
        const mid = row[1];
        if (mid) items.push({ sprite: "node_mark", tx: mid[0], ty: mid[1] });
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
    } else if (tool === "rail") {
      // #298: a hover on a plant or a town building is red, same refusal the drag will hit.
      const why = railTileRefusal(grid, track, rail, me.i + 1, tx, ty);
      items.push({ sprite: why === "ok" ? "highlight" : "highlight_bad", tx, ty });
    } else if (tool === "dirt" || tool === "road") {
      // Own plant stays a legal drag start (PP-15); everyone else's building is red.
      const ok = canBuildOn(grid, tool, tx, ty) || ownFloor(tx, ty);
      items.push({ sprite: ok ? "highlight" : "highlight_bad", tx, ty });
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
      // #298: the tiles the drag ran into and refused — painted red, not built.
      for (const [x, y] of preview.blocked ?? []) {
        items.push({ sprite: "highlight_bad", tx: x, ty: y });
      }
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

  /**
   * L8 (#222): the two readouts the HUD is handed every frame — the objective
   * line ("what do I do next") and the live per-cargo income the chip bar
   * prints. Held here rather than inside `paintUi` so the debug twin can hand
   * a test exactly what the last frame painted, without reading the DOM.
   */
  let objective: string | null = null;
  let objectiveKey: string | null = null;
  let incomeRates: Partial<Record<Cargo, number>> | undefined;

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
      const b = victoryBreakdown(eco, p.id, railPlatforms(), loopScoring());
      // L13 (#228): the tooltip is the scoreboard explained, so it lists the
      // rows the LIVE table pays — the new loop's three sources, or the
      // shipped loop's two.
      const rows = newLoop
        ? [
          `Depots running: ${b.types} × ${VICTORY.loop.type}★ = ${fmtVp(b.typeVp)}★`,
          `Fully paved routes: ${b.routes} × ${VICTORY.loop.route}★ = ${fmtVp(b.routeVp)}★`,
          `City upgrades: ${b.city} × ${VICTORY.loop.city}★ = ${fmtVp(b.cityVp)}★`,
        ]
        : [
          `Paved road tiles: ${b.paved} × 0.25★ = ${fmtVp(b.pavedVp)}★`,
          `Processing plants: ${b.plants + 1} (opening plant is free; ${b.plants} × 1★ = ${fmtVp(b.plantVp)}★)`,
        ];
      const tip = [
        `${p.name}${p.human ? " (you)" : ""} — ${fmtVp(total)}★ of ${line}★`,
        ...rows,
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
      banner = `Protest ready — click a public road to stop every depot routed through it for ${fmtProtestLeft(PROTEST_MS)} (Esc cancels)`;
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
      //
      // L5 (#219): on the new loop the price belongs to the TYPE the pointer
      // is over — its cargo decides the mix and its rung decides whether the
      // seat may build it at all — so the hint quotes the tile, and names the
      // progression refusal in its own words when that is the blocker.
      const cargo = newLoop && hover
        ? depotCargo(eco, { id: -1, owner: me.id, ownerId: me.i + 1, tx: hover.tx, ty: hover.ty })
        : null;
      const price = priceDepot(me.purse, me.freeDepots, { cargo, tier: me.depotTier, newLoop });
      const label = price.type ? price.type.name : "Depot";
      if (price.locked && price.type) {
        costInfo = hintLine(`<i>${label} — rung ${price.tier + 1} locked · ${rungLabel(price.unlocked)}</i>`);
      } else if (price.affordable) {
        costInfo = hintLine(
          newLoop && price.type
            ? `place it inside an industry's catchment · ${label} ${costCompact(price.cost)}`
            : "place it inside an industry's catchment",
        );
      } else {
        costInfo = hintLine(`<i>needs ${costMarkup(shortfallOf(price.cost))}</i>`);
      }
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
          // L3 (#217): the road distance the new-loop clock pays this Depot
          // by — the route length in tiles and the banded factor, the same
          // numbers the tick multiplies. The shipped loop has no distance
          // rule, so it prints nothing rather than a number that does nothing.
          if (newLoop) {
            const d = distanceInfoFor(h.id);
            const band = distanceBandForPath(d.tiles);
            info += `<br>` + (d.tiles === null || band === null
              ? `distance: <i>no route</i>`
              : `distance: ${d.tiles} tiles · ×${d.factor} (${band})`);
            // L8 (#222): the rest of the ledger the clock multiplies — the
            // yield the last session SET, the transport tier, and the tick's
            // own rate (per tick and per second). Every number comes off the
            // same seams `economyTick` reads, so the card can never promise
            // income the clock will not pay: a Depot with no route or a
            // protest on it says so instead of printing a rate.
            const comp = componentsFor(h.ownerId);
            const res = harvesterYield(eco, comp, industryLocks(eco), h, now);
            const cargo = tuningCargoFor(h);
            const seat = h.owner === me.id ? me : rival;
            const readout = depotReadout({
              yieldLevel: depotYield(h),
              // The tier the upgrade is COUNTED in (L6's re-tune credit): a
              // free dirt road is the same tier as no road at all, and paving
              // is what "this Depot got upgraded" means.
              transportLabel: depotTransportTier(eco, comp, h) === 0 ? "dirt" : "paved",
              transportFactor: transportFactor(h),
              distanceTiles: d.tiles,
              distanceFactor: d.factor,
              distanceBand: band,
              cargo,
              amount: cargo ? (res.yields[cargo] ?? 0) : 0,
              serviced: res.serviced && res.connection.kind !== null,
              stopped: protestedDepot(h, now, comp),
              townBonus: Math.max(0, seat.townBonus),
              // L6 (#220): decay is the difficulty's axis — the line prints the
              // row's own cooling and floor, and nothing at all when the row
              // has no decay (Easy, Normal).
              decayRate: difficultyRules().decayRate,
              minYield: difficultyRules().minYield,
              tickMs: HARVEST_MS,
            });
            info += `<br>${readout.yieldLine}<br>${readout.rateLine}`;
            if (readout.decayLine) info += `<br>${readout.decayLine}`;
            // L16 (#231): the storage cap's read on this Depot. A connected
            // Depot whose cargo sits AT its owner's cap is being paid nothing
            // for every tick — the income is lost, not stored — and the
            // inspector is where the ticket says that has to be legible, in
            // the same card that prints the rate. Both seats: your own wasted
            // output and the rival's read the same rule.
            if (cargo && conn.kind && (seat.purse[cargo] ?? 0) >= storageCapFor(seat.townLevel)) {
              info += `<br>⚠ <b>storage full</b> — this Depot's ${CARGO[cargo].name} output is being wasted`;
            }
          }
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
      } else if (ref && ref.kind === "town" && newLoop) {
        // L17 (#245): the town centre answers with what it is and what the
        // next step costs — the same numbers the HUD key prints, so the map
        // door and the key can never disagree.
        const t = grid.towns[(ref as { id?: number }).id ?? -1];
        if (t) {
          const tier = Math.max(0, townTier(t));
          const isBank = townCentreSprite(tier) === "town_bank";
          const mine = townOfSeat(me)?.id === t.id;
          const price = mine ? priceTownUpgrade(me.purse, me.townLevel) : null;
          info = `<b>${isBank ? "Town Bank" : "Town Square"}</b> — a ${townTierLabel(tier)}<br>` +
            (mine
              ? (price?.def
                ? `click to upgrade · ${costLabel(price.cost)}`
                : `fully upgraded`)
              : `the town your Factory touches is the one you upgrade`);
        }
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

    // ══════════════════════════════════════════════════════════════════════
    // L8 (#222): the loop made legible.
    //
    // One objective line that always states the current goal, and the live
    // per-second income per cargo, so a new connection or a better tune
    // visibly lifts a number BEFORE the purse has banked it. Both are pure
    // views of the state the tick already owns (see readouts.ts) — never a
    // second source of truth.
    //
    // Only the new loop gets them: on the shipped loop there is no clock and
    // no tuning session, and an objective line over that game would be a
    // promise the rules do not keep.
    // ══════════════════════════════════════════════════════════════════════
    objective = null;
    objectiveKey = null;
    incomeRates = undefined;
    if (newLoop) {
      const myDepots = eco.harvesters.filter((hh) => hh.owner === me.id);
      const connected = myDepots.filter((hh) => isServiced(eco.track, hh, eco.rail));
      const offer = retuneOffer();
      // The tree's next step, NAMED: the cheapest type on a rung this seat has
      // not opened, offered only while its mix is already in the purse.
      // Earning the mix is the `grow` line's job; this line names the unlock.
      const nextType = (Object.values(DEPOT_TREE) as { cargo: Cargo; name: string; tier: number }[])
        .filter((t) => DEPOT_RUNG_GATE && t.tier > me.depotTier)
        .sort((a, b) => a.tier - b.tier)[0] ?? null;
      const nextPrice = nextType
        ? priceDepot(me.purse, me.freeDepots, { cargo: nextType.cargo, tier: me.depotTier, newLoop })
        : null;
      const obj = objectiveLine({
        phase,
        tuning: tuning
          ? {
              kind: tuning.kind,
              cargo: tuning.cargo,
              movesLeft: tuningMovesLeft(tuning),
              moves: tuning.moves,
            }
          : null,
        depotCount: myDepots.length,
        connectedCount: connected.length,
        retune: offer ? { cargo: offer.cargo } : null,
        townLevel: me.townLevel,
        townLevelCount: TOWN_UPGRADES.length,
        nextRung: nextType && nextPrice?.affordable
          ? { name: nextType.name, tier: nextType.tier }
          : null,
        winTarget: winTarget(),
      });
      objective = obj.text;
      objectiveKey = obj.key;

      // The chip bar's rates: the same rows the inspector prices, summed per
      // cargo per second. One flood fill for the seat (`componentsFor`, cached
      // per network version) and one `harvesterYield` per Depot — the same
      // calls the clock makes, so the rate on the chip is the rate the tick
      // will pay, protests and all.
      const rows: RateRow[] = [];
      if (phase === "play") {
        const comp = componentsFor(ownerIdOf(eco, me.id));
        const locks = industryLocks(eco);
        for (const h of myDepots) {
          const res = harvesterYield(eco, comp, locks, h, now);
          if (!res.serviced || res.connection.kind === null) continue;
          if (protestedDepot(h, now, comp)) continue;
          const d = distanceInfoFor(h.id);
          for (const [cargo, amount] of Object.entries(res.yields) as [Cargo, number][]) {
            rows.push({
              cargo,
              amount,
              yieldLevel: depotYield(h),
              distanceFactor: d.factor,
              transportFactor: transportFactor(h),
              townBonus: Math.max(0, me.townBonus),
            });
          }
        }
      }
      const rates = loopIncomeRates(rows, HARVEST_MS);
      // No rows, no readout: the bar stays quiet rather than printing 0/s on
      // every chip before the first road (the chip's own visibility rule).
      incomeRates = Object.keys(rates).length ? rates : undefined;
    }

    ui.paint({
      players: players.map((p) => ({
        id: p.id, name: p.name, colour: p.colour, vp: vpFor(score, p.id), human: p.human,
        vpTip: vpTooltip(p),
      })),
      purse: me.purse,
      // L16 (#231): the storage cap the resource bar prints its "amount / cap"
      // readout against — derived from the seat's city level, so the bar and
      // the clock can never disagree. Undefined when no cap applies: the
      // shipped loop, and dev mode's unlimited purse (the cap is bypassed
      // there; `?unlimited=0` brings it back for real-economy playtests).
      storageCap: newLoop && !devUnlimited ? storageCapFor(me.townLevel) : undefined,
      phase,
      tool: tool as any,
      // STORY-01: the contract's rival wears their painted sheet on the
      // dossier card; a sandbox match sends nothing and keeps the mugshots.
      ...(storyOn ? { rivalFace: faceOf(rivalCast, "calm") } : {}),
      // AI-04: the race length the HUD should print — 5★ on easy, the shipped
      // line elsewhere. The badge ("You 2★/5") and the king bars' 100% read it.
      vpTarget: conquest ? 0 : winTarget(),   // 0 = Conquest (no ★ line)
      freeTrack: me.freeTrack,
      freeDepots: me.freeDepots,
      // L5 (#219): the rung the Depot button quotes its cheapest type from.
      depotTier: me.depotTier,
      banner,
      // BANNER-ONCE: the stable id behind `banner` (see paintUi) — the ✕
      // dismissal is remembered by this, so a closed line never pops back up
      // when the wording changes and returns.
      bannerKey,
      costInfo,
      inspect: info || null,
      inspectTone: infoTone,
      // L8 (#222): the loop made legible — the objective line, the live
      // per-cargo income and the optional quests, painted by ui.ts beside the
      // banner and the chips.
      objective,
      objectiveKey,
      incomeRates,
      // …and the optional quests: what a character suggests, in their voice,
      // with the progress and the reward the game has already computed. The
      // panel is empty on the retired loop, on a guest seat and once the match
      // is won.
      quests: newLoop && phase !== "won"
        ? {
            hidden: questsHidden,
            items: quests.map((def) => {
              const speaker = questSpeakerFor(def);
              return {
                id: def.id,
                who: questSpeakerName(speaker),
                text: questText(def, speaker),
                progress: questProgressText(def, questView()),
                reward: questReward(def).label,
              };
            }),
          }
        : null,
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
              kind: tuning.kind,
              // #299: the session window names the job it is doing — the
              // cargo in the title, the exact Depot in its tooltip.
              depotId: tuning.depotId,
              cargo: tuning.cargo, moves: tuning.moves, movesLeft: tuningMovesLeft(tuning),
              score: tuning.score,
              // L5 (#219): the same "what this score is worth" readout, on the
              // curve the session actually settles on — a Depot's yield (L6:
              // mapped onto THIS difficulty's floor), or the city's base-rate
              // bonus (0 while nothing is raised, and the plate prints it as a
              // percentage).
              yield: tuning.kind === "town"
                ? townBonusFor(TOWN_UPGRADES[Math.min(me.townLevel, TOWN_UPGRADES.length - 1)]?.bonus ?? 0, tuning.score)
                : tuningSessionYield(tuning, difficultyRules().minYield),
              abandonYield: tuning.kind === "town"
                ? TUNING_ABANDON_YIELD
                : abandonYieldFor(difficultyRules()),
              // #301: whether the board is mid-cascade — Finish is disabled
              // only while this is true, not when moves run out.
              busy: quarry.board.busy,
            }
          : null)
        : undefined,
      // #300: the results pop-up — the frozen settlement of a session that has
      // ENDED, up until its Confirm applies it (null = no pop-up).
      tuningResult: newLoop ? tuningResultUi : undefined,
      // L6 (#220): what the plate says BETWEEN sessions. `retuneOffer()` is null
      // on Easy — that row's `rematch: "never"` is what keeps the shipped line
      // on screen instead of a key that would refuse to work — and null on
      // Normal until a Depot has actually been upgraded.
      tuningIdle: tuningIdleInfo() ?? undefined,
      // L5 (#219): the city upgrade's key, priced from the seat's own row of
      // `TOWN_UPGRADES`. `undefined` on the shipped loop: the key does not
      // exist there, exactly like the rule.
      // TRADE: the offer book, in this client's own seat frame.
      offers: { list: visibleOffers(), now: performance.now(), rival: rival.name },
      town: newLoop
        ? (() => {
            const ups = upgradableCities(me);
            const lvl = ups.length ? Math.min(...ups.map((t) => cityOf(t, me).level)) : me.townLevel;
            const price = priceTownUpgrade(me.purse, ups.length ? lvl : TOWN_UPGRADES.length);
            const row = price.def;
            return {
              level: ups.length ? lvl : TOWN_UPGRADES.length,
              maxLevel: TOWN_UPGRADES.length,
              cost: price.cost,
              affordable: price.affordable && !tuning,
              bonus: me.townBonus,
              ceiling: row?.bonus ?? 0,
              note: price.maxed ? "The city is fully upgraded."
                : tuning ? "Finish the tuning session first — one session at a time."
                  : price.affordable ? undefined
                    : `Needs ${shortfallLabel(price.missing, price.cost)}`,
            };
          })()
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
    // Own plant / depot floor is a legal START (PP-15 steps over it). A rival
    // plant is not — `canBuildOn` refuses `builtAt` "plant".
    if (!canBuildOn(grid, kind, ax, ay) && !ownFloor(ax, ay)) return null;
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

  // ── L17 (#245): the town's middle building is the map door to the upgrade ─
  //
  // A picked town item is anchored on its art's origin, and the centre is the
  // one town item placed at the town's centre tile — so a pick at (t.tx, t.ty)
  // with a town ref IS the centre block, church or bank. A pick with no
  // `newLoop` never answers (towns are set dressing on the shipped loop), and
  // a pick with a build tool in the hand belongs to that tool, not the town.
  const townCentreAt = (p: { tx: number; ty: number; ref: unknown }): Town | null => {
    if (!newLoop) return null;
    const ref = p.ref as { kind?: string; id?: number } | null;
    if (!ref || ref.kind !== "town" || typeof ref.id !== "number") return null;
    const t = grid.towns[ref.id] ?? null;
    if (!t || p.tx !== t.tx || p.ty !== t.ty) return null;
    return t;
  };

  /** The click on the centre: my town buys the upgrade, a foreign one explains. */
  function townCentreClick(t: Town): void {
    // 2026-09: any city I hold upgrades from its own town hall.
    const mineHere = citiesOf(me).some((c) => c.id === t.id);
    if (cityPick && mineHere) { buyTownUpgrade(me, t.id); return; }
    if (!mineHere) {
      showTownCard(t);
      return;
    }
    const hold = eco.townHolds?.get(t.id);
    if (hold && !hold.locked && hold.holder === me.id) {
      showTownCard(t);
      return;
    }
    // The centre is also the bank's door (#245): if the upgrade can't be
    // bought yet, open the exchange so the player can trade toward it.
    if (!buyTownUpgrade(me, t.id)) ui.openBank();
  }

  const industryAt = (p: { tx: number; ty: number }): (typeof grid.industries)[number] | null => {
    if (p.tx < 0 || p.ty < 0 || p.tx >= MAP_W || p.ty >= MAP_H) return null;
    const occ = grid.occupancy[tIdx(p.tx, p.ty)];
    if (occ < 0) return null;
    return grid.industries[occ] ?? null;
  };

  function showIndustryCard(ind: typeof grid.industries[number]): void {
    const now = performance.now();
    const def = INDUSTRY_BY_KEY[ind.type];
    const locks = industryLocks(eco);
    const holder = locks.get(ind.id);
    const rights = eco.siteRights?.get(ind.id);
    const chk = canChallenge(eco, challengeState, now, me.id, ind.id, BATTLE_RULES, me.purse.gold ?? 0);
    const busy = fightBusy();
    const reason = busy ? "busy" as const : (chk.ok ? null : chk.reason);
    const lines = [
      `Cargo: ${def ? CARGO[def.cargo].name : "—"}`,
      `Held by: ${seatName(holder?.owner ?? null)}`,
    ];
    if (rights?.rights.length) {
      lines.push(`Rights: ${rights.rights.map((id) => seatName(id)).join(", ")}`);
    }
    const sales = isComeback(eco, me.id) ? listSales(eco, me.id, pavedCountOf(me), me.townLevel) : [];
    showBattleCard(`industry:${ind.id}`, {
      title: def?.name ?? "Industry",
      lines,
      actions: [
        {
          label: "Challenge",
          html: `Challenge <small>${BATTLE_RULES.challengeGold} Gold</small>`,
          disabled: !!reason,
          title: reason ? challengeRefusalText(reason, BATTLE_RULES.challengeGold) : undefined,
          onClick: () => { if (challengeIndustry(ind.id)) closeBattleCard(); },
        },
        ...sales.slice(0, 2).map((s) => ({
          label: `Sell ${s.kind}`,
          html: `Sell ${s.kind} <small>+${s.gold} Gold</small>`,
          primary: false as const,
          onClick: () => { sellAsset(me, s); },
        })),
        { label: "Close", primary: false, onClick: () => closeBattleCard() },
      ],
    });
  }

  function showTownCard(t: Town): void {
    const now = performance.now();
    const hold = eco.townHolds?.get(t.id);
    const chk = canChallengeTown(eco, challengeState, now, me.id, t.id, BATTLE_RULES, me.purse.gold ?? 0);
    const busy = fightBusy();
    const reason = busy ? "busy" as const : (chk.ok ? null : chk.reason);
    const mine = townOfSeat(me)?.id === t.id;
    const canClaim = hold && hold.holder === me.id && !hold.locked;
    const lines = [
      // Playtest (2026-09): a town is held by whoever has an OPEN plant
      // beside it — not only by a battle's winner (that read "Unclaimed").
      `Held by: ${(() => {
        const owners = [...new Set(eco.factories
          .filter((f) => !f.closed && f.townId === t.id).map((f) => f.owner))];
        if (owners.length) return owners.map(seatName).join(" & ");
        if (hold) return seatName(hold.holder);
        return mine ? "You" : "Unclaimed";
      })()}`,
      hold?.locked ? "Upgrades locked until won again." : "",
    ].filter(Boolean);
    showBattleCard(`town:${t.id}`, {
      title: townName(t.id),
      lines,
      actions: [
        {
          label: "Challenge",
          html: `Challenge <small>${BATTLE_RULES.challengeGold} Gold</small>`,
          disabled: !!reason,
          title: reason ? challengeRefusalText(reason, BATTLE_RULES.challengeGold) : undefined,
          onClick: () => { if (challengeTown(t.id)) closeBattleCard(); },
        },
        ...(canClaim ? [{
          label: "Claim city",
          html: "Claim city — tiers restart",
          primary: false as const,
          onClick: () => { if (downgradeCity(me, t.id)) closeBattleCard(); },
        }] : []),
        { label: "Close", primary: false, onClick: () => closeBattleCard() },
      ],
    });
  }

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
      const canStart = tool === "rail"
        || canBuildOn(grid, tool as TrackKind, p.tx, p.ty)
        || ownFloor(p.tx, p.ty);
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
          if (out.cam !== cam) commitCamera(out.cam);
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
    if (out.cam !== cam) commitCamera(out.cam);
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
            // Owner (2026-09): the objective line carries "road it in" now.
            void setupDepotToast;
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
          } else if (tool === "select") {
            // L17 (#245): the town's middle building (church, then bank) is
            // the click target for the city upgrade — the map door beside the
            // HUD key. Any other tool keeps its own behaviour above.
            const town = townCentreAt(p);
            if (town) townCentreClick(town);
            else if (newLoop) {
              const ind = industryAt(p);
              if (ind) showIndustryCard(ind);
              else {
                // 2026-09: a click on one of my Depots opens its card
                // (level, yield vs cap, Upgrade, Retune).
                const d = myDepotAt(p.tx, p.ty);
                if (d) depotCardFor(d);
              }
            }
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
    commitCamera(zoomStepAt(cam, e.deltaY < 0 ? +1 : -1, x, y));
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
      "5": "demolish", "6": "rail", "7": "platform",
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
    commitCamera(resizeCamera(cam, w, h));
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
   * The lorry reservation a board's token clock has to keep its hands off.
   *
   * Shipped loop: the cargoes this seat's lorries carry — an arrival mints
   * their tokens, so the clock must not spawn them too (that was the A1
   * double-pay). New loop (L1c/L1d, #234/#235): no arrival mints anything on
   * either seat, so there is nothing to reserve — and if the reservation
   * stayed, the spawn clock would go quiet for exactly the connected cargoes
   * and the boards would have no tokens to match. The player's board only ever
   * comes up for a tuning session (which fills its own plate), but the rival's
   * plant is the one you can WATCH, and it still banks combo Gold on the
   * matches its tokens allow (#227 owns Gold) — so its clock keeps feeding it.
   */
  const truckServedCargos = (now: number, owner: "you" | "ai"): Cargo[] =>
    (newLoop ? [] : truckCargos(trucks.trucks, now, owner));

  /**
   * Turn every lorry arrival since the last frame into a delivery: one token
   * of that depot's cargo on the board, one "+N" over the Factory.
   *
   * L1c (#234): with the new loop on your seat's arrivals are animation only —
   * the lorry still drives its route, but it lands no token and no "+N" (the
   * clock pays the cargo now). L1d (#235) made that BOTH seats: on the new
   * loop no lorry delivery pays anybody. See the branches inside.
   */
  function collectDeliveries(t: number) {
    // B5 (#250): deliveries are economy clock too — paused during a battle.
    if (battleScreen) return;
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
        // ledger cannot drift, and the RIVAL's lane below now says the same
        // thing (#235 gave the rival the same clock).
        if (newLoop) continue;
        for (let i = 0; i < due; i++) deliverLoad(truck, t);
      } else if (truck.ownerId === rival.i + 1) {
        // AI-02: the rival's lorries DO feed its game — see rivalDeliverLoad.
        // L1d (#235): …on the shipped loop. Under the new loop the rival earns
        // on the clock, so its arrivals are animation exactly like the
        // player's: the lorry still drives, but it mints no token, floats no
        // "+N" and credits nothing. The ledger above is written either way, so
        // the arrival count cannot drift.
        if (newLoop) continue;
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
      // B5 (#250): the map's battle layer — conquests (`locks`), the cooldown
      // clocks (ms LEFT, the `protests.left` rule) and the playtest note's
      // battle count.
      battle: {
        locks: [...(eco.battleLocks ?? [])],
        readyAt: [...challengeState.readyAt].map(([k, v]) => [k, Math.max(0, v - now)] as [string, number]),
        playerReadyAt: [...challengeState.playerReadyAt].map(([k, v]) => [k, Math.max(0, v - now)] as [string, number]),
        rivalDueIn: Math.max(0, challengeState.rivalReadyAt - now),
        battles: challengeState.battles,
      },
      track: trackSave(track),
      // RAIL-04 (#178): the railway rides the save — a refresh must not take a
      // built line, its platforms or its train with it.
      rail: railToWire(rail),
      // L1e (#236): which loop this world earns under, and what its clock had
      // banked but not yet paid. Depot yield levels ride `eco.harvesters`
      // below — the record they belong to — so they need no field here.
      loop: newLoop,
      loopCarry: loopCarryToWire(loopCarry),
      // L17 (#245): the towns' tiers ride the save too — a refresh must not
      // shrink the city the player paid to grow. Written under the new loop
      // only: elsewhere the tiers are legacy and the field would be noise.
      towns: newLoop ? grid.towns.map((t) => townTier(t)) : undefined,
      // L8 (#222): the quest panel's own small state — the offers on screen,
      // what has been paid, what the player retired, and whether they put the
      // panel away. The DEFS are re-derived from the map on the next boot (the
      // tables are data), so only the ids and the choices travel.
      quests: newLoop ? questsSave() : undefined,
      eco: { harvesters: eco.harvesters, factories: eco.factories },
      clearedFields: [...clearedFields],
      // 2026-09: every city's own tier.
      conquest,
      cities: [...cityTiers.entries()].map(([id, c]) => [id, c.owner, c.level, c.bonus] as [number, string, number, number]),
      players: players.map((p) => ({
        // TRADE: escrow rides home in the purse — an open offer is refunded
        // on reload rather than lost (the book itself is not saved).
        purse: purseWithEscrow(p.i as Seat),
        freeTrack: p.freeTrack, freeDepots: p.freeDepots,
        // L5 (#219): a refresh keeps the seat's rung and its city upgrade —
        // the L1e rule for the allowances, applied to the two numbers the
        // depot tree and the income clock read.
        depotTier: p.depotTier, townLevel: p.townLevel, townBonus: p.townBonus,
      })),
      // live AI clocks START FRESH on load — a few seconds of drift is not
      // worth serialising a timer list for (the games feel identical).
      clocks: {},
    };
  }

  /** The autosave writer's handles — cleared in dispose so a dead game can
   *  never serialize its frozen world over a live save (contamination). */
  let saveIv = 0;
  let onPageHide: (() => void) | null = null;

  /**
   * Write the payload now.
   *
   * L15 (#230): an old save (v1 / snap 15) is refused and must not be
   * overwritten by this fresh boot, or the toast pointing at a new game would
   * be a lie. `isOld` is the guard — the slot keeps what it had until the
   * player clears it or starts over.
   */
  function saveNow() {
    if (disposed || restartArmed || savesOff || isOld) return;
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
    // B5 (#250): the battle layer comes back too — conquests and the cooldown
    // clocks re-based onto this session's `performance.now()` (the protests'
    // rule). An old save reads as an un-fought map.
    eco.battleLocks = new Map(d.battle?.locks ?? []);
    challengeState.readyAt = new Map((d.battle?.readyAt ?? []).map(([k, v]) => [k, now + v]));
    challengeState.playerReadyAt = new Map((d.battle?.playerReadyAt ?? []).map(([k, v]) => [k, now + v]));
    challengeState.rivalReadyAt = now + (d.battle?.rivalDueIn ?? 0);
    challengeState.battles = d.battle?.battles ?? 0;
    eco.siteRights = d.battle?.siteRights
      ? new Map(d.battle.siteRights.map(([id, r]) => [id, { rights: [...r.rights], streak: r.streak ? { ...r.streak } : null }]))
      : new Map();
    eco.townHolds = d.battle?.townHolds
      ? new Map(d.battle.townHolds.map(([id, h]) => [id, { ...h }]))
      : new Map();
    // economy: replace the lists in place — their references are held all
    // over (planTrucks, syncWorld, the AI...)
    setClearedFields(d.clearedFields ?? []);
    eco.harvesters.length = 0;
    eco.harvesters.push(...d.eco.harvesters.map((h) => ({ ...h, facing: depotFacingOf(grid, h) })));
    eco.factories.length = 0; eco.factories.push(...d.eco.factories);
    // L1e (#236): the clock's banked remainders come back with their depots,
    // so the first tick after a Continue pays the rate the player was earning
    // instead of restarting every depot from zero (a visible dip, once, every
    // reload). Yields ride the harvesters pushed above. An old save has no
    // `loopCarry`, and this reads as the empty map it always was.
    loopCarry.clear();
    for (const [id, rem] of savedLoopCarry(d)) loopCarry.set(id, rem);
    // L8 (#222): the quest panel's own state, restored the same way — the
    // player's choices come back and the offers themselves are resolved by the
    // next `syncQuests`, off the map the save just rebuilt.
    questPendingOffers = d.quests?.offers ?? null;
    questSpent.clear();
    for (const id of d.quests?.spent ?? []) questSpent.add(id);
    questPaid.clear();
    for (const id of d.quests?.paid ?? []) questPaid.add(id);
    questsHidden = d.quests?.hidden === true;
    quests = [];
    questWorld = null;   // the next frame draws the restored panel afresh
    for (let i = 0; i < players.length && i < d.players.length; i++) {
      Object.assign(players[i].purse, d.players[i].purse);
      players[i].freeTrack = d.players[i].freeTrack;
      players[i].freeDepots = d.players[i].freeDepots;
      // L5 (#219): the rung and the city upgrade come back with the purse —
      // `typeof … === "number"`, so a pre-#219 save (no fields) leaves the
      // fresh-seat zeros in place instead of writing NaN.
      const dt = d.players[i].depotTier, tl = d.players[i].townLevel, tb = d.players[i].townBonus;
      if (typeof dt === "number" && Number.isFinite(dt)) players[i].depotTier = Math.max(0, Math.floor(dt));
      if (typeof tl === "number" && Number.isFinite(tl)) players[i].townLevel = Math.max(0, Math.floor(tl));
      if (typeof tb === "number" && Number.isFinite(tb)) players[i].townBonus = Math.max(0, tb);
    }
    conquest = (d as { conquest?: boolean }).conquest === true || conquest;
    // 2026-09: per-city tiers (older saves migrate lazily from the seat's).
    cityTiers.clear();
    for (const row of (d as { cities?: [number, string, number, number][] }).cities ?? []) {
      if (Array.isArray(row) && typeof row[0] === "number") {
        cityTiers.set(row[0], { owner: String(row[1]), level: Math.max(0, row[2] | 0), bonus: Math.max(0, Number(row[3]) || 0) });
      }
    }
    // L17 (#245): the towns' tiers come back with the seats. The saved array
    // is the authority when it is there (map order, per `townTier`); a save
    // from before this ticket has none, and the map is re-derived from the
    // seats' own `townLevel` instead — the same rule a live upgrade follows —
    // so a mid-growth save still reloads with the map it was saved from. No
    // FX here: the boot sync below lays the whole world fresh.
    if (newLoop) {
      if (d.towns?.length) {
        grid.towns.forEach((t, i) => {
          const v = d.towns?.[i];
          if (typeof v === "number" && Number.isFinite(v)) setTownLevel(t, v);
        });
      } else {
        growTownForSeat(me, false);
        growTownForSeat(rival, false);
      }
    }
    // VP is derived state and is intentionally absent from the save. Rebuild
    // its ledgers now (without UI events), or a restored final screen would say
    // 0★ despite showing the winning roads beneath it.
    // L13 (#228): the new loop's three ledgers are derived state too — a
    // restore that left `rungs`/`city` behind would re-pay nothing and a
    // restore that left `types` behind would revoke a type the map still
    // runs, so all six go before the rebuild.
    score.paved.clear(); score.plants.clear(); score.vp.clear();
    score.types.clear(); score.rungs.clear(); score.city.clear();
    rescore(eco, score, railPlatforms(), loopScoring());
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
    // L15: boards no longer in save — tuning board starts fresh.
    onBoardChange();
    // pacing clocks start clean — no catch-up bursts after a refresh
    lastHarvest = now; lastAi = now; lastRaid = now;
    rivalSessionUntil = 0;
    lastRivalMove = now;
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
  /** B2 (#247): at most one battle screen over the map (`__iso.startBattle`). */
  let battleScreen: BattleScreenHandle | null = null;
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
      const st = rivalPlant.status();
      const bits: string[] = [];
      if (st.frozen) bits.push(`❄ ${st.frozen} frozen`);
      if (st.girders) bits.push(`🏗 ${st.girders} girders`);
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
  /** #302: `document.fonts.ready`, hardened — a boot without a FontFaceSet
   *  (headless, old engine) treats type as ready rather than hanging the bar. */
  const fontsReady = (): Promise<void> => {
    try {
      const fonts = typeof document === "undefined" ? undefined : document.fonts;
      if (!fonts || typeof fonts.ready?.then !== "function") return Promise.resolve();
      return fonts.ready.then(() => undefined, () => undefined);
    } catch {
      return Promise.resolve();
    }
  };

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
        t2.waitMs = old.waitMs;
      }
      // L7: rateMult always comes from `next` (the live yield × distance ×
      // transport). A replan after a tune or a decay must pick up the new
      // pace even when the route itself did not move.
      return t2;
    });
  }

  /** L7 (#221): restamp every lorry's pace from the live clock seams.
   *  Yield decays and a finished session both move the rate without a
   *  network change, so this cannot wait for `trucksDirty`. Distance is
   *  the per-network cache — no extra BFS. */
  function refreshTruckRates(): void {
    if (trucks.trucks.length === 0) return;
    const byId = new Map(eco.harvesters.map((h) => [h.id, h]));
    for (const t of trucks.trucks) {
      const h = byId.get(t.depotId);
      if (!h) continue;
      t.rateMult = depotRate(h, distanceInfoFor(h.id).factor);
    }
  }

  /** Plan the depot lorries, or the empty list when the debug gate is off. */
  /** The rail signature `autoTrains` last ran against (see the frame). */
  let autoTrainSig = "";
  function plannedLorries(): Truck[] {
    return lorriesEnabled ? planTrucks(eco) : [];
  }

  /** L7 (#221): `__iso.setLorries` / `setVehicles` — see the hook below. */
  function setLorriesGate(on: boolean): boolean {
    if (isGuest()) return lorriesEnabled;
    const next = !!on;
    if (next === lorriesEnabled) return lorriesEnabled;
    lorriesEnabled = next;
    if (!lorriesEnabled) {
      trucks.trucks = [];
      trucksDirty = false;
    } else {
      trucks.trucks = planTrucksTrucksMerge(trucks.trucks, planTrucks(eco));
      trucksDirty = false;
      refreshTruckRates();
    }
    renderer?.setWorld(world);
    return lorriesEnabled;
  }

  (async () => {
    // #302: the steps LOAD-01 never tracked. The map is sync-done (see the
    // task list); fonts resolve when the vendored woff2 the chrome paints
    // with are ready; the six gem tokens pre-decode so the board's first
    // paint finds them in the image cache instead of flashing gradients;
    // the frame step resolves from the loop below. (Audio needs no step:
    // the engine only arms on a real gesture, so nothing plays at start.)
    void loading.track("map", Promise.resolve());
    void loading.track("fonts", fontsReady());
    void loading.track("gems", Promise.all(
      Object.values(GEM_ART).map((src) => load(src).then(() => undefined, () => undefined)),
    ));
    void loading.track("frame", firstFrame);
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
      if (loopToastPending && !loading.active && !storyView && !tutorialView) {
        loopToastPending = false;
        toast("The new loop is sandbox-only for now.", "info");
      }
      if (oldSaveToastPending && !loading.active && !storyView && !tutorialView) {
        oldSaveToastPending = false;
        toast(OLD_SAVE_TOAST, "info");
      }
      if (saveToastPending && !loading.active && !storyView && !tutorialView) {
        saveToastPending = false;
        toast(OLD_SAVE_TOAST, "info");
      }
      // RV-01: the lorries move in TILE units per millisecond, so the frame
      // needs a real dt (capped — a background tab must not teleport them).
      const dt = Math.min(100, Math.max(0, t - lastFrameT));
      lastFrameT = t;
      topUpDevPurse();
      // #302: the reveal gate — nothing guarded by `sim` below earns, builds,
      // moves or expires until the game is SHOWN (every tracked load settled
      // and the first frame painted, or no loading overlay standing at all —
      // see createRevealGate). Rendering, the camera, floats and the HUD keep
      // painting behind the bar, so the reveal lands on a live frame. The
      // re-base keeps a slow load from banking a harvest or buying the rival
      // a head start: every pacing clock restarts from the reveal instant,
      // the same "start clean" rule a restore uses.
      if (reveal.arm(loading.ready || !loading.active)) {
        lastHarvest = t; lastAi = t; lastRaid = t;
        lastRivalMove = t; lastRivalTrade = t; lastConquestCheck = t;
      }
      const sim = reveal.live;
      if (sim) economyTick(t);
      // L8 (#222): the optional quests — pay what is done, keep 2–3 on the
      // panel. Runs beside the clock it pays against, and before the paint
      // that reads the view it derives.
      syncQuests();
      if (sim) quarryTick(t);
      if (sim) aiTick(t);
      // Rivalry idle wire: a Torvin saying / dad joke every so often, mid-game.
      if (sim) rivalChitChat(t);
      if (sim) advisorTick(t);
      // MP-05: protests are solo/host-only (buyBlack refuses guests, like the
      // rest of the Black Market), so the sweep is a no-op on a guest — it
      // runs unguarded rather than splitting the heartbeat below.
      if (sim && protests.size > 0) expireProtests(t);
      // B6 (#251): the host's duel clock — offers, turn timer, disconnect grace.
      if (sim) duelTick(t);
      // TRADE: offer expiry + the machine rival's answers/posts (host/solo).
      if (sim) tradeTick(t);
      // Conquest (2026-09): the only way a game ends is a player who cannot
      // go on — checked every few seconds, not only after a battle.
      if (sim && conquest && t - lastConquestCheck > 3000) {
        lastConquestCheck = t;
        maybeComebackLoss(me);
        maybeComebackLoss(rival);
      }
      // MP-05: the host's heartbeat — one small delta per `PUBLISH_MS`, full
      // state only when `buildPublish` says the delta would not fit (§5).
      publishNet(t);
      // MP-AUDIT: vehicle presentation parity — host simulates, guest renders host vehicles.
      // #302: frozen behind the loading screen with the rest of the sim.
      if (sim && !isGuest()) {
        if (trucksDirty) {
          trucks.trucks = planTrucksTrucksMerge(trucks.trucks, plannedLorries());
          // TRAFFIC-02: bounded trips — town-derived access nodes, host-only.
          // Retains unaffected trips on road edits (planCars checks revision).
          cars.cars = planCars(track, grid, cars.cars, carCount, seed);
          trucksDirty = false;
          // AI-03: the replan no longer resets driving lorries — see
          // planTrucksTrucksMerge just above trucksTick. seenDeliveries is
          // keyed by the stable depot id, so the ledger survives every replan.
          quarry.setTruckServed(truckServedCargos(t, "you"));
          rivalQuarry.setTruckServed(truckServedCargos(t, "ai"));
          // a vanished truck must not linger as a ghost on the structures layer
          renderer?.setWorld(world);
        }
        // L7: restamp pace from the live yield/distance/transport so a decay
        // or a finished session is visible on the next frame, not the next
        // build. Cheap: one multiply per lorry, cached distance.
        refreshTruckRates();
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
      // Playtest (2026-09): trains are automatic like the lorries — the host
      // gives every connected industry→plant platform pair a line and a train
      // whenever the rail network or its platforms change (no depot, no buy).
      // #302: like the lorries — no new trains until the reveal.
      if (sim && !isGuest()) {
        const sig = `${rail.rail.revision}:${rail.structures.map((s) => s.id).join(",")}`;
        if (sig !== autoTrainSig) {
          autoTrainSig = sig;
          let moved = false;
          for (const p of [me, rival]) moved = autoTrains(rail, p.i + 1) || moved;
          if (moved) { syncWorld(); rescoreNow(); }
        }
      }
      // #302: trains and deliveries are sim too — a resumed game must not roll
      // its lorries into the Factory while the bar is still up.
      if (sim) tickTrains(rail, dt);
      if (sim) collectDeliveries(t);

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
          commitCamera(panBy(cam, dx * step, dy * step));
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
    upgradeMarkers.frame();
      paintUi(t);
    };

    /**
     * #281: the loop re-arms itself from this wrapper rather than from the
     * tail of `frame`. A throw anywhere in the frame — `overlayFrame`,
     * `renderer.render`, the paint above — used to skip the trailing
     * `labels.frame()` AND the `requestAnimationFrame` re-arm, which froze
     * the map and the tags until some other path restarted the loop: exactly
     * the "it caught up five seconds later" in the report. Now a bad frame
     * costs one frame, is logged instead of swallowed, and the next one runs.
     */
    const loop = (t: number) => {
      try {
        frame(t);
      } catch (err) {
        console.error("[iso] frame failed:", err);
      } finally {
        // #302: the first frame — painted or thrown — settles the "frame"
        // step, which is what lets the loading screen lift onto a live map.
        if (resolveFirstFrame) { resolveFirstFrame(); resolveFirstFrame = null; }
        if (!disposed) raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
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
    /**
     * L8 (#222): the readouts the last frame handed the HUD — the objective
     * line (its stability `key` and its text) and the per-cargo income per
     * second. `__iso.objective.text` is what a player reads under the top bar;
     * `__iso.incomeRates` is what the chips print. Exposed so a probe can pin
     * the numbers the chrome paints without parsing the DOM.
     */
    get objective() { return { key: objectiveKey, text: objective }; },
    get incomeRates() { return incomeRates ?? {}; },
    /**
     * L8 (#222): the optional quests as the HUD is being handed them — the
     * offers (id, strategy, progress, reward), what the player dismissed or
     * completed, and whether the panel is hidden. A probe reads the panel's
     * own state here rather than parsing the chrome.
     */
    get quests() {
      const view = questViewCache ?? questViewNow();
      return {
        hidden: questsHidden,
        offers: quests.map((def) => ({
          id: def.id,
          strategy: def.strategy,
          speaker: questSpeakerFor(def),
          text: questText(def, questSpeakerFor(def)),
          progress: questProgressText(def, view),
          need: def.need,
          have: questHave(def, view),
          done: questDone(def, view),
          reward: questReward(def).label,
        })),
        paid: [...questPaid],
        spent: [...questSpent],
      };
    },
    /** L8 (#222): the panel's own two verbs, the same calls its keys make —
     *  the ✕ retires one offer, Hide/Show puts the panel away and back. */
    questAction: (id: string, action: "dismiss" | "hide" | "show") => questAction(id, action),
    /** L8 (#222): complete a quest by hand — the test twin for the panel's
     *  payout path (the same `earn` + toast the frame runs). */
    questPay: (id?: string) => {
      const def = quests.find((q) => (!id || q.id === id) && !questPaid.has(q.id));
      if (!def) return null;
      const reward = questReward(def);
      return payQuest(def) ? { id: def.id, reward: reward.label } : null;
    },
    /** LOAD-01: true while the loading screen covers the map. */
    get loading() { return loading.active; },
    /**
     * #302: true once the sim clocks are running — the reveal gate has seen
     * the game SHOWN (every tracked load settled, or no loading overlay
     * standing) and the economy/rival/board/vehicle ticks are live. A probe
     * for "clocks don't start before reveal" reads THIS, not the purse: it
     * flips on the reveal frame itself, before any clocked payout could land.
     */
    get clocksLive() { return reveal.live; },
    /**
     * #136: the boot art loads' SETTLE state — the question `loading` above
     * cannot answer. `loading` reports the OVERLAY, which is false before
     * `show()` ever mounts it (everything can settle first) and true through
     * its fade-out, so "the overlay is down" is not "the art finished".
     * `ready` is that: every task handed to `loading.track()` — "map",
     * "atlas", "layers", "buildings", "scenery", "vehicles", "railway" (rail
     * on), "roads", "protest", "fonts", "gems", "frame" — has settled. An
     * asset-completeness assertion waits on THIS, because
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
    /**
     * L13 (#228): the ★ table the LIVE game is paying, so the twin can never
     * report rates the scoreboard is not using. On the shipped loop this is
     * the three rows it always was; under `?loop=new` it is the loop's own
     * three (`VICTORY.loop`) plus the platform row the rail flag still pays.
     * `newLoop` says which, so a reader never has to guess from the keys.
     */
    get vpRates() {
      return newLoop
        ? {
          newLoop: true,
          type: VICTORY.loop.type, route: VICTORY.loop.route, rung: VICTORY.loop.rung, city: VICTORY.loop.city,
          platform: PLATFORM_VP,
        }
        : { upgrade: VICTORY.upgrade, plant: VICTORY.plant, platform: PLATFORM_VP };
    },
    // RAIL-02 (#176): the breakdown includes the platform line, read from the
    // rail state like `rescoreNow` does — the twin must not report a total the
    // scoreboard would not.
    victoryOf: (who: string) => victoryBreakdown(eco, who, railPlatforms(), loopScoring()),
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
    /**
     * L17 (#245): the town tiers, for tests and the console — id, level and
     * label per town, in map order.
     */
    get towns() {
      return grid.towns.map((t) => {
        const lv = townTier(t);
        return { id: t.id, level: lv, label: lv >= 0 ? townTierLabel(lv) : "legacy" };
      });
    },
    /**
     * L17 (#245): the DEBUG HOOK the ticket asks for — build and review the
     * tier art before (and without) a real city upgrade.
     *
     *   `__iso.setTownLevel(townId, level)`  0 village · 1 town (bank) ·
     *                                        2 city · 3 metropolis
     *
     * It applies the tier through the same door a confirmed upgrade uses —
     * `setTownLevel` plus the growth moment (world re-sync, one-shot tile
     * invalidation, float) — so what the console shows is what gameplay will
     * show. It moves NO seat state: `townLevel`/`townBonus` stay where the
     * economy left them. Returns false (changing nothing) for an unknown
     * town; the level is clamped, not thrown on.
     */
    setTownLevel: (townId: number, level: number) => {
      const t = grid.towns[Math.floor(townId)];
      if (!t) return false;
      const ok = setTownLevel(t, level);
      if (ok) growTownArt(t);
      return ok;
    },
    /** VP-01: run the rival's pave pass on demand (the AI turn's third action,
     *  exposed so a test can assert the pave without waiting on the clock).
     *  Atomic like the real turn: it rescores, so `vp.ai` is current after it. */
    rivalPave: () => {
      const ok = rivalPavePass();
      if (ok) { syncWorld(); rescoreNow(); }
      return ok;
    },
    /** VP-01: the rival's read of the scoreboard and the four numbers that
     *  follow from it — exposed so a playtest (or a test) can ask WHY a turn
     *  was spent the way it was without re-deriving the policy. */
    get rivalPace() { return rivalPaceNow(); },
    /** AI-01: the live difficulty (preset + knobs) and how to change it —
     *  the same call the top-bar selector makes. */
    get rivalSkill() { return skill(); },
    setRivalSkill: (key: SkillKey) => setRivalSkill(key, false),
    get purse() { return me.purse; },
    /**
     * L11 (#226): the bank's click path, exposed so a test can aim the LOCAL
     * seat at a locked rung without going through a select that refuses to
     * hold one. True when the exchange moved — the same answer `onBank`
     * reports on the live path, minus the guest relay.
     */
    bank: (give: Cargo, want: Cargo) => bankFor(me, give, want),
    /**
     * L11 (#226): every seat's own purse, in `players` order — the LIVE
     * objects the economy spends from, where `players` above deliberately hands
     * out copies. The offer board used to expose this by reference
     * (`market.players[i].res`, #114); with the board gone the seats' bags are
     * the only thing a test fixture needs to seed, so they hang here.
     */
    get purses() { return players.map((p) => p.purse); },
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
        // L5/L16: the seat's place in the tree and the city ladder, and the
        // storage cap that ladder implies — the numbers the wire and the save
        // already carry, exposed so a test can read them on BOTH seats (the
        // rival's cap pressure is the L16 acceptance's third line).
        depotTier: p.depotTier, townLevel: p.townLevel, townBonus: p.townBonus,
        storageCap: storageCapFor(p.townLevel),
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
     * holds a live record; this hands back a plain snapshot plus the two derived
     * numbers, so a test reads the same values the plate prints.
     *
     * "Null means no session" is the contract, so L6's between-session state
     * lives on `tuningIdle` instead of making this truthy with nothing open;
     * what L6 added INSIDE a session (`yieldFloor`, the difficulty's own mapping
     * floor, and `abandonYield` now read through the row) rides here.
     */
    get tuning() {
      if (!tuning) return null;
      // L5 (#219): a session is one of two kinds now, and its `cargo` is null
      // on a city one (the board plays neutral) — both travel, so a test (or
      // the e2e picker) can tell the two apart without guessing.
      const rules = difficultyRules();
      const town = tuning.kind === "town";
      return {
        kind: tuning.kind,
        depotId: tuning.depotId,
        cargo: tuning.cargo,
        moves: tuning.moves,
        movesLeft: tuningMovesLeft(tuning),
        used: tuning.used,
        score: tuning.score,
        yield: town
          ? townBonusFor(TOWN_UPGRADES[Math.min(me.townLevel, TOWN_UPGRADES.length - 1)]?.bonus ?? 0, tuning.score)
          : tuningSessionYield(tuning, rules.minYield),
        yieldFloor: rules.minYield,
        abandonYield: town ? TUNING_ABANDON_YIELD : abandonYieldFor(rules),
        /**
         * L10 (#225): the obstacles this session OPENED with — what actually
         * landed on the board, not what the difficulty's table asked for, so
         * the plate (and a test) can say "3 girders" and mean the three on
         * the grid. Null only if a session is somehow up with no record.
         */
        obstacles: sessionObstacles,
      };
    },
    /**
     * L6 (#220): what the plant plate is painting while `tuning` is null — the
     * economy line the difficulty row promises, its own mapping floor, and the
     * re-match offer; null off the new loop, where the plate is not up at all.
     */
    get tuningIdle() { return tuningIdleInfo(); },
    /**
     * L6 (#220): the difficulty's ECONOMY flags as the game reads them live —
     * the row of `DIFFICULTY_RULES` the clock and the tuning settle are using
     * this tick. Exposed so a test can flip the difficulty and assert the
     * numbers moved with it, instead of re-deriving them from a label.
     */
    get difficulty() {
      return { key: skillKey, label: skill().label, ...difficultyRules() };
    },
    /** L6: the plate's re-match offer on its own (null = nothing owed). */
    retuneOffer: () => retuneOffer(),
    /** L6: press the plate's Retune key — the same call the DOM key makes. */
    retuneDepot: (depotId?: number) => retuneNow(depotId),
    /** 2026-09: the Depot card's Upgrade door, as a test twin. */
    upgradeDepot: (depotId: number) => upgradeDepot(depotId),
    /** L6: the tier a Depot's link is worth right now (the upgrade axis). */
    depotTier: (depotId: number) => {
      const d = eco.harvesters.find((h) => h.id === depotId);
      return d ? depotTier(d) : null;
    },
    /**
     * L4 (#218): the plate's two keys, as twins — `tuningFinish()` closes the
     * session keeping the score, `tuningFinish(true)` abandons it (the ✕).
     * A test never has to reach through the chrome to end a session.
     *
     * #300: `tuningFinish()` is the SETTLE-NOW door: it closes at once on the
     * same settlement the pop-up would show — and with the results pop-up up,
     * it applies exactly that frozen result (it is Confirm). The chrome's
     * Finish key ends the session INTO the pop-up instead: that is
     * `tuningEnd()` below, and the pop-up's key is `tuningConfirm()`.
     */
    tuningFinish: (abandon = false) => { closeTuningSession(abandon); },
    /** #300: the plate's Finish key — end the session into its results pop-up. */
    tuningEnd: () => { requestTuningFinish(); },
    /** #300: the results pop-up's Confirm — applies exactly the result shown. */
    tuningConfirm: () => { confirmTuningResult(); },
    /**
     * #300: the results pop-up's record — what an ENDED session is worth and
     * exactly what Confirm will apply (`to`). `null` while no session has
     * ended (or once Confirm has applied it).
     */
    get tuningResult() {
      return tuningResultUi ? { ...tuningResultUi, starScores: [...tuningResultUi.starScores] } : null;
    },
    /** #300: a Finish is waiting for the board to settle before it ends the session. */
    get tuningEndAsked() { return tuningEndAsked; },
    /** L4 (#218): every depot's yield level, by owner — the number the L1b
     *  clock multiplies by. `null` = no level stored (an untuned depot). */
    get depotYields() {
      return eco.harvesters.map((h) => ({
        id: h.id, owner: h.owner, tx: h.tx, ty: h.ty,
        yield: h.yield ?? null, tuneTier: h.tuneTier ?? null, tier: depotTier(h),
      }));
    },
    /**
     * L3 (#217): every depot's road distance — the route length in tiles to
     * its nearest owned plant (`null` = no road route) and the banded factor
     * the L1b clock pays it by. Read off the same cache the tick and the
     * inspector use, so a test asserts the numbers the player is paid and
     * shown.
     */
    get depotDistances() {
      return eco.harvesters.map((h) => ({ id: h.id, owner: h.owner, ...distanceInfoFor(h.id) }));
    },
    /** L1e (#236): the income the clock has banked but not yet paid, per
     *  depot — exactly what the save's `loopCarry` carries, so a round-trip
     *  test reads the live map on one side and the payload on the other. */
    get loopCarries() {
      return [...loopCarry.entries()].map(([id, carry]) => ({ id, carry }));
    },
    /** L1e (#236): the autosave writer's twin — writes the payload NOW, the
     *  same call the 5-second interval and `pagehide` make, including its
     *  refusals (a held-back save is not written, so the slot keeps what it
     *  had and a test can assert that by reading the raw string). */
    saveNow: () => { saveNow(); },
    /** L1e (#236): true when this boot found a new-loop save it could not
     *  restore and is holding the slot for the boot that can. */
    get saveHeldBack() { return isOld; },
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
        trucks.trucks = planTrucksTrucksMerge(trucks.trucks, plannedLorries());
        cars.cars = planCars(track, grid, cars.cars, carCount, seed);
        trucksDirty = false;
        quarry.setTruckServed(truckServedCargos(now, "you"));
        rivalQuarry.setTruckServed(truckServedCargos(now, "ai"));
      }
      refreshTruckRates();
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
     *  surface immediately — no build needed to feel the cost.
     *
     *  L7 (#221): this is CARS only. Depot lorries have their own gate
     *  (`setLorries` / `setVehicles`) so a perf probe can silence the town
     *  without hiding the trucks that show a connection. */
    setTraffic: (count: number) => {
      if (isGuest()) return [];
      carCount = Math.max(0, Math.min(64, Math.trunc(count) || 0));
      cars.cars = planCars(track, grid, cars.cars, carCount, seed);
      renderer?.setWorld(world);
      return cars.cars.map((c) => c.name);
    },
    /**
     * L7 (#221): debug gate for depot lorries. `false` clears every truck
     * immediately and stops planning new ones; income is unchanged because
     * vehicles hold no economic state. The ticket's "vehicles disabled"
     * acceptance (`setTraffic(0)` or a new flag) lands here — cars stay on
     * `setTraffic`, lorries on this.
     *
     * `setVehicles` is the same function under the ticket's name.
     */
    setLorries: setLorriesGate,
    setVehicles: setLorriesGate,
    get lorriesEnabled() { return lorriesEnabled; },
    quarry,
    /** A1: the rival's Processing Plant — where Black Market sabotage lands. */
    rivalPlant,
    /** PP-14b: the Black Market twin, exposed so the MP test can buy sabotage
     *  and prove it crosses the wire (buyBlack refuses on a guest, exactly as
     *  the click path does). */
    buyBlack: (key: string) => buyBlack(key),
    /**
     * L9 (#224): the same Black-Market core, run as a NAMED SEAT — the twin a
     * test needs to arm the rival's Security Forces (or to buy its cards) the
     * way the shared path does, rather than poking `securityUntil` from
     * outside. Seat 0 is you, seat 1 the rival/guest; solo/host only, exactly
     * like every other write twin here.
     */
    buyBlackFor: (seat: number, key: string) => {
      if (isGuest()) return false;
      const p = players[seat === 1 ? 1 : 0];
      return buyBlackFor(p, key);
    },
    /**
     * L9 (#224): the rival's raid clock, forced — both halves of its raid
     * table (`rivalRaid` stages the Protest, `rivalSabotage` sets the
     * Blockade) run right now instead of on `RAID_EVERY`. The cadence gate is
     * the only thing skipped; targeting, pricing, the Security check and the
     * feedback are the live ones a real raid uses.
     */
    rivalRaidNow: (now = performance.now()) => {
      if (isGuest()) return;
      lastRaid = -Infinity;
      rivalRaid(now);
      rivalSabotage(now);
    },
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
    /**
     * The twin of what every build and demolish does after it commits: rescore
     * the board, mark the lorries dirty and re-read BOTH seats' reach. A
     * harness that hands a seat a network by pushing records (the rival's
     * corridor in #235's fixtures) has no click to trigger it, and
     * `refreshQuarry` above only ever re-reads the LOCAL seat's.
     */
    rescore: () => rescoreNow(),
    /**
     * L3 (#217): the twin of what every placement commits alongside the
     * rescore — re-sync the renderer's world from the economy. A harness
     * that hands a seat a network by pushing records has no click to trigger
     * it, and hover/pick can only see a depot the renderer knows about.
     */
    syncWorld: () => syncWorld(),
    /**
     * L3 (#217): center the camera on a tile — the test twin of panning.
     * Picks only hit sprites the renderer drew, and it draws the visible
     * range, so a harness reads a far depot the way a player does: pan
     * there first, then hover.
     */
    centerOn: (tx: number, ty: number) => {
      commitCamera(centerOnTile(cam, tx, ty));
    },
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
    /**
     * PP-05: what the next Depot placement will charge THIS purse — the same
     * `priceDepot` the click, the HUD and the AI all read.
     *
     * L5 (#219): pass a tile and the quote is for the TYPE that tile would
     * build (its rung included) — the same quote the click gets — instead of
     * the cheapest type the seat can afford.
     */
    depotPrice: (tx?: number, ty?: number) => {
      const cargo = newLoop && tx !== undefined && ty !== undefined
        ? depotCargo(eco, { id: -1, owner: me.id, ownerId: me.i + 1, tx, ty })
        : null;
      return priceDepot(me.purse, me.freeDepots, { cargo, tier: me.depotTier, newLoop });
    },
    /** L5 (#219): the seat's place in the depot tree, for tests and the HUD's
     *  own readouts. Values, not references — nothing here mutates. */
    treeState: () => ({
      depotTier: me.depotTier, unlocked: rungLabel(me.depotTier),
      townLevel: me.townLevel, townBonus: me.townBonus,
      town: priceTownUpgrade(me.purse, me.townLevel),
      types: DEPOT_TREE_ORDER.map((c) => ({
        cargo: c, name: DEPOT_TREE[c].name, tier: DEPOT_TREE[c].tier,
        cost: { ...DEPOT_TREE[c].cost }, open: !DEPOT_RUNG_GATE || DEPOT_TREE[c].tier <= me.depotTier,
      })),
    }),
    /** L5 (#219): the city upgrade's click, as a test twin — the real
     *  `buyTownUpgrade`, refusals included. */
    buyTownUpgrade: () => buyTownUpgrade(me),
    /**
     * L16 (#231): the storage cap the seat plays under, straight off the same
     * `storageCapFor` the clock's `earn` clamps and the resource bar's
     * "amount / cap" read — `null` when no cap applies (the shipped loop).
     * The twin the cap's own tests read, so they assert the number the rules
     * use rather than re-deriving it from the table.
     */
    storageCap: (who: "you" | "ai" = "you") =>
      newLoop ? storageCapFor(who === "ai" ? rival.townLevel : me.townLevel) : null,
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
      // #281: the zoom step and the recentre are ONE commit, so no camera
      // write here can slip past the tag re-anchor.
      const zoomed = (zoom === 0.5 || zoom === 1 || zoom === 2)
        ? zoomAt(cam, zoom, cam.vw / 2, cam.vh / 2)
        : cam;
      commitCamera(centerOnTile(zoomed, tx, ty));
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
      // L5 (#219): the Depot's TYPE — the biggest industry this site would
      // hold — so the readout prices and gates the exact row the click would.
      const quote: Harvester = { id: -1, owner: me.id, ownerId: me.i + 1, tx, ty };
      const cargo = newLoop ? depotCargo(eco, quote) : null;
      // PP-05: the probe also reports what the Depot would COST, priced by the
      // same `priceDepot` the click runs — so "is this tile usable" and "can I
      // pay for it" come from one module instead of the e2e tooling guessing.
      // `ok` stays a SITE-legality answer (the corridor picker filters on it
      // during setup, when the allowance covers the Depot); affordability is
      // reported alongside, never folded into it.
      const price = priceDepot(me.purse, me.freeDepots, { cargo, tier: me.depotTier, newLoop });
      return {
        build: { ok: why === null, why },
        harvester: {
          ok: why === null && !taken && served.length > 0 && !claimed && !price.locked,
          why: why ?? (taken ? "harvester-taken"
            : claimed ? "industry-taken"
            : served.length ? null : "no-industry-in-catchment"),
          industries: served.map((x) => x.id),
          /** the ones another Depot's network holds (PP-16) */
          held: served.filter((x) => locks.has(x.id)).map((x) => x.id),
          cost: { ...price.cost },
          free: price.free,
          affordable: price.affordable,
          // L5 (#219): the type, its rung and whether the seat has it open —
          // a site can be perfectly legal and still refused for progression.
          type: price.type ? price.type.name : null,
          tier: price.tier,
          locked: price.locked,
          unlocked: price.unlocked,
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
      // any tile of the 2×2 lot names the Depot standing on it
      const h = eco.harvesters.find((x) => depotContains(x.tx, x.ty, tx, ty));
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
      if (!canBuildOn(grid, kind, ax, ay) && !ownFloor(ax, ay)) return null;
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
    /** TRADE: one pass of offer expiry + the machine rival's answers/posts. */
    tradeTick: (now = performance.now()) => tradeTick(now),
    /** TRADE: the live offer book as this client sees it (own seat = 0). */
    get offers() { return visibleOffers().map((o) => ({ ...o })); },
    /** TRADE: the Take / Post / Cancel doors, exactly as the Market tab runs them. */
    acceptOffer: (id: number) => tradeRequest("accept", { id }),
    postOffer: (give: Cargo, giveN: number, want: Cargo, wantN: number) =>
      tradeRequest("post", { give, giveN, want, wantN }),
    cancelOffer: (id: number) => tradeRequest("cancel", { id }),
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
    /** W6: the per-frame board clock, with an injectable now — the twin the
     *  Feed assertions drive (the combat/autoplay cadence lives in it). */
    tick: (now = performance.now()) => quarryTick(now),
    /**
     * B2 (#247): open the battle screen over the map against a placeholder
     * opponent (seeded random legal swaps). `__iso.startBattle(42)` — play it
     * out to the result screen and Continue lands back on the map with no
     * leftover state. Returns the screen handle (`.destroy()` force-closes)
     * with the engine on `.battle` for probes.
     */
    startBattle: (seed = 7) => {
      // B3 (#248): the ability gates read the LIVE economy — a seat may cast
      // only what its depots harvest (B5 runs real challenges the same way).
      const depotCargos = (ownerId: number): Cargo[] => {
        const out = new Set<Cargo>();
        for (const hd of eco.harvesters) {
          if (hd.ownerId !== ownerId) continue;
          const c = depotCargo(eco, hd);
          if (c) out.add(c);
        }
        return [...out];
      };
      const screen = startBattleScreen(seed, [
        { id: me.id, name: me.name, portrait: portraitYou, depots: depotCargos(me.i + 1) },
        { id: rival.id, name: rival.name, portrait: portraitVex, depots: depotCargos(2 - me.i) },
      ], {
        stake: "a skirmish over the yards",
        // B4 (#249): the rival is the live skill's battle policy — swaps and
        // spells, paced by the screen's think-time so the move is watchable.
        opponentMove: (b) => chooseBattleMove(b, skill().key),
        onClose: () => { battleScreen = null; },
      });
      battleScreen = screen;
      return screen;
    },
    /**
     * B5 (#250): the map's battle doors — the playtest + e2e surface.
     * `challengeIndustry(id)` calls a fight over a contested industry (the
     * bill and cooldowns arm at the call); the rival's own challenges arrive
     * as `pendingChallenge` and resolve through accept/decline; a Blockade or
     * Protest at the gates arrives as `pendingFightOff` and resolves through
     * fightOff/declineFightOff. The economy clock is paused while the battle
     * screen is up (the tick entry points bail on `battleScreen`).
     */
    challengeIndustry: (indId: number) => challengeIndustry(indId),
    challengeTown: (townId: number) => challengeTown(townId),
    acceptChallenge: () => acceptChallenge(),
    declineChallenge: () => declineChallenge(),
    fightOff: () => fightOff(),
    declineFightOff: () => declineFightOff(),
    sellAsset: (kind?: SaleOption["kind"], id?: number) =>
      sellAsset(me, kind ? { kind, gold: 0, id } : cheapestSale(eco, me.id, pavedCountOf(me), me.townLevel)),
    downgradeCity: () => downgradeCity(me),
    get pendingChallenge() { return pendingChallenge; },
    get pendingFightOff() { return pendingFightOff; },
    /** The cooldown/counter probe (the playtest note reads `battles`). */
    get challengeState() {
      return {
        battles: challengeState.battles,
        rivalReadyAt: challengeState.rivalReadyAt,
        readyAt: [...challengeState.readyAt],
        playerReadyAt: [...challengeState.playerReadyAt],
        battleLocks: [...(eco.battleLocks ?? [])],
      };
    },
    /** B2: the live battle screen, or null. */
    get battleScreen() { return battleScreen; },
    /**
     * B6 (#251): the host offers the guest a FRIENDLY duel (no stake — no
     * contested industry needed), optionally on shorter rules. The playtest +
     * `tests/e2e-mp` door; the guest answers with acceptChallenge/decline.
     */
    offerDuel: (rules: Partial<typeof BATTLE_RULES> = {}) => {
      if (isGuest() || !humanDuels() || mpOffer || duel || battleScreen) return false;
      nextDuelRules = { ...BATTLE_RULES, ...rules };
      mpOffer = {
        kind: "industry", industryId: -1, challengerId: me.id, holderId: null,
        challengerHarvesterId: -1, holderHarvesterId: -1,
        offerUntil: performance.now() + BATTLE_RULES.turnMs * 2,
      };
      publishNet(performance.now(), true);
      return true;
    },
    /** B6 (#251): the MP duel probe — offer, log length, board fingerprint. */
    get mpBattle() {
      const b = battleScreen?.battle;
      return {
        offer: isGuest() ? guestOffer : duelWireOut().offer ?? null,
        seat: isGuest() ? 1 : 0,
        moves: b ? b.moves.length : 0,
        turn: b ? b.state.turn : null,
        over: b ? b.state.over : null,
        winner: b ? b.state.winner : null,
        board: b ? b.board.grid.map((row) => row.map((g) => (g ? `${g.res}${g.block ? "#" : ""}` : "_")).join("")).join("/") : null,
        health: b ? b.state.players.map((p) => p.health) : null,
      };
    },
    // ── C1 (#255): chat ───────────────────────────────────────────────────
    /**
     * Say one line to the other seat — the ticket's debug hook, and for now the
     * ONLY way a human can chat (the panel is #257).
     *
     * Returns what happened, never a bare boolean: `{ ok: true, msg }` with the
     * exact frame that went out (from the session's guard — already cleaned,
     * filtered and stamped), or `{ ok: false, reason }` where the reason is
     * `"empty" | "preset-only" | "rate" | "offline"`. A solo game is
     * `"offline"`, which is also what a test harness that never joined a room
     * should see. A successful send lands in `__iso.chat().log`, so a single
     * client can read its own side of the conversation.
     */
    sendChat: (text: string) => {
      if (!net) return { ok: false as const, reason: "offline" as const };
      const res = net.sendChat(text);
      if (res.ok) pushChat(res.msg);
      return res;
    },
    /**
     * The chat state, plus the switches a panel (#257) will own. With no
     * argument it reads; with a patch it applies first, so
     * `__iso.chat({ muted: true })` both toggles and reports.
     *
     *   muted      — the opponent's lines stop reaching the log (mine still go)
     *   presetOnly — free text off, both directions: the four presets remain
     *   blocklist  — replace the word filter's list (the shipped one is mild by
     *                design; this is the configuration seam)
     *
     * `stats` is what a probe reads instead of a UI: how many lines went out,
     * how many arrived, and how many were dropped — with the last reason — so
     * "the spam was refused" is an assertion rather than a guess.
     */
    chat: (patch?: { muted?: boolean; presetOnly?: boolean; blocklist?: readonly string[] }) => {
      if (patch && (patch.muted !== undefined || patch.presetOnly !== undefined)) {
        net?.setChatPrefs({ muted: patch.muted, presetOnly: patch.presetOnly });
      }
      if (patch?.blocklist) net?.setChatBlocklist(patch.blocklist);
      return {
        connected: net !== null,
        muted: net?.chatPrefs.muted ?? false,
        presetOnly: net?.chatPrefs.presetOnly ?? false,
        maxLength: CHAT_MAX_LEN,
        presets: [...CHAT_PRESETS],
        stats: net?.chatStats ?? { sent: 0, received: 0, dropped: 0, lastDrop: null },
        log: chatLog.map((m) => ({ ...m })),
      };
    },
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
    // L15: cross timers gone
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
    // B2 (#247): an open battle screen dies with the game — never orphaned
    // over a dead map.
    battleScreen?.destroy();
    battleScreen = null;
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
    upgradeMarkers.clear();
    flashLayer.clear();
    cancelAnimationFrame(raf);
    ro.disconnect();
    root.classList.remove("iso-game");
    root.innerHTML = "";
  };
}
