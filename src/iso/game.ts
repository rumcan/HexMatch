import {
  armSessionSabotage, isSessionSabotage, readBlackMarket, rebaseBlackMarket, sabotagedObstacles,
  sabotagedScore, sessionSabotage, SESSION_SABOTAGE_COOLDOWN_MS, type BlackMarketState,
} from "./black-market";
import { totalStorageRent, storageRentLabel } from "./storage-rent";
import { flowSignals } from "./flow";
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
import {
  resolveMapOptions, resolveTownLayout, resolveMapSize, readMapSize,
  type MapOptions, type TownLayout, type MapSizeName,
} from "./map-options";
import { mountTerrainGl, terrainGlWanted, type TerrainGl } from "./terrain-gl-adapter";
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
// BATTLE-1 (#468): the stakes card (`openStakesCard`) — what a duel is for,
// before the duel.
import {
  startBattleScreen, openBattleScreen, openStakesCard,
  type BattleScreenHandle, type StakesCardHandle, type StakesRow,
} from "../game/battle-screen";
// B6 (#251): host-authoritative MP duels — validation, clock, forfeit, wire.
import {
  createDuel, applyPlayerMove, noteHumanMove, duelToWire, duelFromWire,
  duelClockTick, duelPresence, duelGraceTick, endByForfeit,
  type Duel, type DuelWire,
} from "../game/battle-mp";
import type { BattleMove, BattleSeat } from "../game/battle";
import { chooseBattleMove } from "./battle-ai";
import { showBattleHowto, takeFirstBattleHint } from "./battle-howto";
// B5 (#250): the map's battle layer — challenges, conquests, fight-offs and
// the cooldowns that pace them (pure bookkeeping in battle-map.ts).
import {
  createChallengeState, canChallenge, canChallengeTown, markChallenge, markRivalChallenge,
  contestedIndustries, contestedTowns, battleCooldownLeft, fmtBattleCooldown,
  rivalChallengeDue, settleMapBattle, unlockTownHold,
  pickRivalChallengeTarget, challengeRefusalText, isComeback, hasOpenPlant,
  cheapestSale, applySale, listSales,
  battleStakeFacts, siteIncome, stakeSiteTile,
  type BattleStakeFacts,
  type ChallengeState, type PendingFightOff, type MapBattleStake, type SaleOption,
} from "./battle-map";
import { BATTLE_RULES } from "./config";


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
// LIGHT-1 (#473): the match-time grade. Presentation only — not saved, not
// on the wire. Both seats compute it from the scoreboard they already share.
import {
  ENDING_NIGHT_CLASS, currentLightingChoice, effectiveLighting, endingNightActive,
  leaderProgress, setLightingChoice, smoothMatchProgress, urlLightingProgress,
} from "./lighting";
import { createTiltShiftPass } from "./miniature";
import { createMinimap, minimapSceneOf, type MinimapMarker } from "./minimap";
import {
  createSabotageEventWindow, collectSabotageEvents, sabotageEventsToMarkers,
  type Protest,
} from "./protest";
import { loadGroundTextures } from "./ground";
import {
  createCamera, tickViewYaw, getViewYaw, rotateViewStep, centerOnTile, centerOnWorld, resizeCamera, zoomStepAt, zoomAt, tileToScreenAt,
  createGesture, pointerDown, pointerMove, pointerUp, worldToScreen, panBy,
  bootZoomFor, tapSlop, HH, HW, visibleTileRange, screenToTileAt,
  type Camera, type GestureState,
} from "./camera";
// AMB-2 (#391): the bird pool — cosmetic, seeded from the map seed, drawn at
// the closest zoom through the renderer's shared above-structures hook.
import { createBirds, paintBirds, scareBirds, tickBirds, BIRD_VIEW_PAD, type BirdState } from "./birds";
import { LEVEL_PX, MAX_LEVEL, elevationActive, invalidateDraper, invalidateElevation, surfaceHeight, tileSurfaceHeight } from "./elevation";
// #456 LEVEL GROUND — the terraform rule: plan (pure), apply (the height
// bytes), the wire diff of edited heights, and the refusal wording. The
// planner's `levelCost` seam is for BUILD-1 (#460)'s "Slope: level it for $X"
// card; this file owns the gesture, the charge and the rebuilds.
import {
  LEVEL_REFUSAL_TEXT, applyHeightEdits, applyLevelPlan, heightDiffWire, levelCost, planLevel, rectTiles,
  type LevelPlan,
} from "./level-ground";
import { createLabelLayer, type LabelEntry, type LabelLayer } from "./labels";
import { IsoRenderer, composeRouteOverlay, paintClaimFlags, paintLaneInvite, type ClaimFlagView, type LaneInviteView, type World, type RouteOverlayPath, setHideExtra, setHideVehicle } from "./renderer";
import { mountThreeLayer, rotationAvailable, threeWanted, type ThreeLayer } from "./three-layer";
import { DEFAULT_ROAD_STYLE } from "./road-renderer";
// R2 (#266): the bridge rules' wording, for the refusals the drag can hit.
import { BRIDGE_REFUSAL_TEXT } from "./bridges";
import { scatterScenery, type DecalImages, type Scenery } from "./scenery";
import { loadDecalImages, loadScenerySprites } from "./scenery-art";
import { loadVehicleLayers } from "./vehicle-art";
// TOWN-2 (#470): the tier-up moment — scaffolds and cranes on the lots a city
// upgrade adds, the flag and bunting flourish over the town hall, and the
// timings/rules for both (see the module header for the whole contract).
import { createGrowthMoment, type GrowthMoment } from "./town-growth";
import {
  FIELD_OCC, WATER, generateMap, heightAt, grownTownHouses, resolveMapSeed, seedTownLevels, setTownLevel,
  STARTER_ISLAND_SEED, starterIslandGrid,
  TOWN_BLOCK, townBuildings, townForSeat, townGrownRings, townTier,
  tileInFootprint, townHouseAt, townObstacleTiles, rotatedSpan,
  type Grid, type Industry, type Town,
} from "./grid";
import {
  createTrack, drawBits, previewDrag, commitDrag, canBuildOn, hasTrack,
  demolishTile, tIdx, canAfford, buildRefusal, seedTownRoads, seedTownDiagonals,
  seedTownAvenues, seedPublicRoads, isPublicRoad, isUpgradedRoad, tileCost, structureTiles,
  dirtyTiles, plantFootprintTiles, buildTile, PUBLIC_OWNER, type RoadTierKey,
  highwayRouteTiers, planInterchange, buildInterchange, tierTileCost, setRoadTier, ROAD_TIER, ROAD_TIER_KEYS, addCost, roadDragRefusalText,
  type Track, type TrackKind, type Purse, type DragPreview,
} from "./track";
import {
  industriesInCatchment, ownerIdOf,
  buildAllComponents, resolveConnection, industryLocks, heldIndustries,
  lockedIndustryIdsFor,
  depotCargo, depotRoutePaved, isServiced, isRailDepot,
  pickBlockadeTarget, harvesterYield, depotPathLength,
  type EconomyState, type Factory, type Harvester,
  depotRouteTiles,
  clockFactorOf, cargoPerMinute, routeDollarsPerMin, depotRoutePay, depotRouteName,
  forecastStretchUpgrade, formatUpgradePreview, pickLargestGain, routeLedgerText, stretchAround,
  slowestOnRoute, routePaceNames, cargoDisplayName, formatCargoRate,
} from "./economy";
// VP-01: the scoreboard lives in its own module now, because what it counts
// changed from "connections a player has made" to "tiles and plants a player
// has UPGRADED" — a different question about a different part of the state.
import {
  createScoreState, rescore, vpFor, hasWon, fmtVp, paveVp, vpDeltaText,
  victoryBreakdown, revokeCityStars,
  type ScoreState, type VpEvent, type LoopScoring,
} from "./victory";
// BAL-1 (#471): the phase beats (the Feed's arc announcements).
import { phaseBeatFor, type PhaseBeatId } from "./phases";
// R3 (#270): the hydro dam — its site rule, its footprint, its bonus and its
// wire shape all live in `dams.ts`; this file is where a dam is BUILT
// (the tool, the click, the cost), DEMOLISHED (the usual 50% refund),
// REPORTED (`builtAt`), PAID (the clock-income factor) and SHOWN (the
// inspector, the chip rates, the map).
import {
  DAM_BONUS, DAM_COST, DAM_RANGE, DAM_REFUSAL_TEXT, DAM_SIDES, SIDES,
  damBonusAtTiles, damCityBonusAt, damContains, damDrawOrigin, damFootprint,
  damRefusal, damRiverAt, damSitesFor, damsFromWire, damsToWire,
  type Dam, type DamSide, DAMS_ENABLED } from "./dams";
import {
  chooseRivalFactorySpot, deepPlanCandidates, planBankTrades, planGoalPurchase, goalOutOfReach,
  planUpgrades, executePaves,
  paveCandidates, rivalPace, scoreCargoWant, treeGoal, treeWants, type RivalPace,
  planRailMove, executeRailMove, planRivalTruck, planRivalTruckUpgrade,
  planCandidates, executeCandidate, ClaimLedger, claimContested,
  type ClaimSite, type RivalClaim, type PlayerIntent, type PlanOptions,
} from "./ai";
import {
  RIVAL_SKILLS, resolveSkillKey, skillKeyFromUrl, SKILL_STORAGE_KEY, type RivalSkill, type SkillKey,
} from "./skill";
import {
  depotPreviewSprite, placementReasonText, planDepotPlacement, planFactoryPlacement, type PlacementPlan,
} from "./placement";
import {
  assistText, depotAssistFor, DEPOT_ASSIST, legalDepotSpots, legalPlantSpots, legalPlatformSpots,
  MONEY_ASSIST, PLANT_ASSIST, RAIL_ASSIST, moneyFix, slopeAssistFor, type AssistCopy,
} from "./placement-assist";
import type { GhostSpec } from "./overlay-art";
import {
  PLANT_COST, PLANT_REFUSAL_TEXT, addPlant, adjacentTown, buildingAt,
  chooseAiPlantSpot, plantRefusal, plantsOf, resolvePlantTarget,
} from "./plants";
import {
  CARGO, CARGOES, DEPOT_TREE, DEPOT_TREE_ORDER, DEPOT_RUNG_GATE, DEPOT_LEVELS, depotYieldCap, DEPOT_TIER_MAX,
  factoryFootprintFor, factorySpriteFor,
  INDUSTRY_BY_KEY, TRANSPORT, TOWN_UPGRADES, TOWN_TIER_LEGACY, TOWN_VISUAL_MAX,
  townCentreSprite, townTierLabel,
  BASE_RATE, VICTORY, VP_TARGET, UPGRADE_COST, TUNING,
  BASE_PRICE, BUILD_COSTS_MONEY, FLEET, START_MONEY, moneyValueOf, LEVEL_GROUND_COST,
  type Cargo, type Portrait,
} from "./config";
// CAST-1 (docs/CAST.md): the managers' perks — one multiplier per price seam.
import {
  DEFAULT_MANAGER, effectiveBalance, buyMovesOffer, fixerLeft, fixerRefillIn, freshFixer,
  managerOrNull, perkPrice, perksOf, readFixer, sabotageGold, sabotageTilesBonus, securityCost,
  spendFixer, tuningScore, returnToSenderOf, truckSpeedOf, trainSpeedOf,
  battlePerksOf,
  type BuildClass, type FixerState, type LegacyPortrait, type ManagerId,
} from "./managers";
// ECON-1 (#421): the market — prices, slippage, demand events and the money
// formatter. Pure and seeded, so the host and the guest agree without a
// message and a save restores into the same prices it left.
import {
  createMarket, marketToWire, marketFromWire, priceOf,
  sell as sellOnMarket, eventsAt, trendPct, history as priceHistory,
  rivalSellLot, sellable, money as moneyStr, quoteBuy, buyPrice,
  rumourAt, createAlert, alertTick as priceAlertTick, type PriceAlert,
} from "./market";
import {
  DEFAULT_FACING, DEPOT_FACINGS, DEPOT_SPRITES, depotContains, depotEntranceTiles, depotFacingOf, depotFacings,
  depotSites, depotTiles, rotateFacing, type DepotFacing,
} from "./depot";
// #456: the flat-footprint test the rival's Level Ground planner reads — the
// same "can a Depot stand here" question `planDepotPlacement` answers.
import { footprintFlat } from "./slopes";
import {
  depotRate, depotTransportTier, depotYield, distanceBandForPath, distanceFactorForPath,
  transportFactor,
} from "./loop";
// L8 (#222): the loop made legible — the objective line and the income
// readouts, as pure rules. game.ts feeds them the same numbers `economyTick`
// multiplies; ui.ts paints them. (ui.ts has carried the objective element and
// the chip rate since #287 — this is the wiring that fills them.)
import {
  depotReadout, incomeRates as loopIncomeRates, type RateRow,
} from "./readouts";
// GOAL-1 (#459): the "Next step" advisor — replaces the old objectiveLine with
// a priority list that reads from more of the live state (money, market,
// town upgrades, rival contests). Pure in next-step.ts; this file wires it.
import { nextStep as nextStepAdvisor, type AdvisorTool, type NextStep } from "./next-step";
// L8 (#222): the OPTIONAL quests — suggestions voiced by the match's cast,
// generated from this map and this seat, never a requirement. The rules are
// pure (`quests.ts`); this file owns which ones are on offer, what pays them,
// and the player's own "hide" / "dismiss" choices.
// CONTRACT-1 (#466): town contracts replace Quests — deliveries with deadlines,
// and a public tender both seats race. The old quest imports are kept for
// backward compat (saves) but the live game uses contracts.
import {
  questDone, questHave, questProgressText, questReward,
  questText, speakerFor, speakerName,
  type QuestDef, type QuestSpeaker, type QuestView,
  // CONTRACT-1
  contractOffers as contractOffersFor,
  selectContracts,
  contractProgressText,
  contractTimeLeft,
  contractTimeLeftText,
  isContractExpired,
  addContractDelivery,
  resolveTenderRace,
  rivalCanWinTender,
  contractsToWire,
  contractsFromWire,
  CONTRACT_OFFER_MAX as CONTRACT_OFFER_MAX_NEW,
  CONTRACT_PRIVATE_COUNT,
  type ContractDef,
  type ContractView,
  type ActiveContract,
  type ContractWire,
} from "./quests";
import { mulberry32 } from "../game/config";
import { Board } from "../game/board";
// L4 (#218): the tuning session — the one thing that sets a depot's yield.
// The rules live in `tuning.ts` (pure, unit-tested); this file is where they
// meet the board, the depot record and the HUD.
// L5 (#219): …and where a finished session also opens the next rung of the
// depot tree / confirms a city upgrade (Addition A's gate).
import {
  abandonYieldFor, birthYieldFor, createTownSession, createTuningSession, decayYield,
  depotSessionOutcome, difficultyRulesFor, obstacleIntroLine, openingActCell, recordTuningCleared, retuneOwed,
  rivalTuningScore, settleTuningYield,
  sessionMovesFor, sessionObstacles as sessionObstaclesFor, takeTuningMove, townBonusFor, tuningMovesLeft,
  unlockTierAfterSession, tuningOver, tuningSessionGold, tuningSessionYield,
   tuningStarLabel, tuningStarScores, tuningStarsFor, tuningGoldFor, rivalYieldForShare,
  TUNING_ABANDON_YIELD, TUNING_REWARD_SCORE, type TuningOutcome, type TuningSession, type TuningStars,
} from "./tuning";
import {
  FREE_SETUP_DEPOTS, costLabel, depotTypeLabel, DEPOT_UPGRADE_COST, DEPOT_RETUNE_COST,
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
  // TOWN-4.1 (#677): the runtime map size — set once per boot, claimed by this
  // game and released by its dispose.
  MAP_SIZES, setMapSize, claimMapSize, releaseMapSize,
} from "../game/config";
import { createQuarry, CARGO_TO_GEM, GEM_TO_CARGO, type Quarry } from "./quarry";
import {
  saveKeyFor, scenarioSaveKey, SAVEGAME_VERSION, OLD_SAVE_TOAST,
  loadRecentSave, clearSave, trackSave, trackRestored, isOldSave, saveFitsItsMap,
  loopCarryToWire, savedLoopCarry,
  type SaveGamePayload,
} from "./savegame-runtime";
// L10 (#225): the rival's plant is a board you can WATCH (AI-03's peek panel)
// and nothing else. Its frost/girder/smog cards, the clocks that expired them
// and the damage model that scaled the rival's income by how wrecked the plant
// looked are all gone — obstacles belong to a tuning session now, and the
// rival's yield is docked by them once, in `rivalTuningYield`. One board, one
// name; the sabotage overlay that used to travel the wire for it went too.
import { createRivalPlant } from "./rival-plant";
import type { GuideAnchor } from "./guide/types";
import { createFloatLayer, type FloatLayer } from "./floats";
import {
  createTruckState, planTrucks, tickTrucks, truckItems, roadRouteForHarvester, lorryTripsPerMin, DEPOT_LOAD_MS,
  type Truck,
} from "./vehicles";
import { trafficScaledHaul, trafficFactorOf } from "./traffic-income";
import { truckCountOf, truckKey, fleetLoadFactor, truckBuyCheck, truckSellRefusal, truckSellRefund, truckBuyPrice, truckUpgradePrice, truckSpeedMultOf, truckLevelOf, truckSpeedMultAt, truckUpgradeCheck } from "./fleet";
import {
  CAR_COUNT, createCarState, planCars, tickCars, carItems,
} from "./cars";
// AMB-3 (#392): pedestrians, traffic lights and the car-density budget.
// Cosmetic, seeded, and absent from the wire and from saves — each client
// builds its own. Truck delivery ticks do not read any of it.
import {
  AMBIENT_ART_NEEDED, CAR_HARD_CAP, ambienceVisible, ambientCarBudget,
  createAmbience, paintAmbience, tickAmbience, tickTruckGhosts,
  type AmbienceState, type PaintCar,
} from "./ambience";
// RAIL-04 (#178): the railway's rules — its own layer, its own structures and
// its own trains — and the loader for its PNGs. Every rule lives in `rail.ts`
// and every cost in `rail.ts`/`config.ts`: this file is the one place those
// rules are APPLIED (tools, clicks, the panel, the frame), never re-derived.
import {
  createRailState, railPreview, buildRail, demolishRail, structureAt, hasRail, railDrawLayer, railTileRefusal,
  placePlatform, placeDepot, platformRefusal, depotRefusal, resolveAnchor,
  RAIL_COSTS, RAIL_REFUSAL_TEXT, footprintTiles,
  railStructureItems, trainItems, autoTrains, trainSpawnHint, layPlatformTrack, platformTrackAt, RAIL_DIAG, assignLine, renameLine, buyTrain, startLine, recallTrain, sellTrain, tickTrains,
  rotateView, trainOccupies, trainLevel, planRivalTrainUpgrade, trainUpgradeCheck, setTrainLevel, trainLoadFactorOf, TRAIN_LEVELS, trainUpgradePrice, trainBasedAt, railPanelRows, trainBuyRefusal, railComponents, resaleValue, demolishStructure, PLATFORM_VP,
  footprintFor, depotExit, RAIL_VIEWS, trainTile, ownerRailTiles as ownerRailTilesOf,
  // RAIL-6 (#575): the station upgrade — one shared rule set for the click,
  // the preview, the guest intent and the rival.
  laneRefusal, addStationLane, nextLaneAt, laneSlabTiles, laneTrackTiles, laneStopTile,
  laneInviteAt, laneInviteFor, laneInviteTiles, laneSideOf, type LaneInvite,
  stationLanes, structureById, MAX_LANES,
  platformGhostItems, depotGhostItems, laneGhostItems,
  // FLEET-2 (#596): the Passing Loop - the one refusal rule, the commit, the ghost.
  loopRefusal, placeLoop, loopGhostItems, planRivalLoop, loopRunAt, loopStripAt, loopRun,
  RAIL_OVERPASS, railToWire, applyRailWire, clearRail, railLayerPatch, copyRailLayer,
  type RailState, type RailView, type RailStructure,
} from "./rail";
import { loadRailwaySprites, loadStationSprites, makeLaneSlabSprites } from "./rail-art";
import { loadRiverSprites } from "./rivers-art";
import { createOriginalUi, RAIL_TOOL_KEYS, type OriginalUi } from "../game/ui";
import { moneyMarkup } from "../game/hud-icons";
// #302: the six board-gem tokens, pre-decoded behind the loading screen.
import { GEM_ART } from "../game/gem-art";
// SFX-01: the UI sound layer. Everything the player DOES on the map (a road
// laid, a building raised, a demolition, a star earned, the final ledger) gets
// one cue from here; the chrome's own clicks and hovers are handled once, by
// the delegation `attachUiSound` installs. docs/SFX-01-ui-sound.md.
import { sfx } from "../audio/sfx";
// VO-1: spoken lines on coach steps (ui.ts) and on feed events below.
// A missing MP3 is a subtitle; it must never throw into the match.
// MUSIC-1 (#377): `onVoiceLine` is the ducking hook — see where the radio is
// mounted, below the minimap.
import { onVoiceLine, voice } from "../game/voice";
// MUSIC-1 (#377): the mini radio player (state machine + element + pill). Its
// own bus, its own settings; nothing about it touches the wire or a save.
import { mountRadioWidget, radio, radioText, type RadioWidget } from "../audio/radio";
// SFX-1 (#463): ambience by zoom — the island's own beds, fed from the camera
// below. Like the radio: nothing on the wire, nothing in a save.
import { ambience } from "../audio/ambience";
// AI-02: the start-of-game difficulty prompt (see skill-picker.ts for the
// "when do we ask" contract: only when nothing has chosen yet).
import { promptForRivalSkill } from "./skill-picker";
import { MIN_SHOW_MS, createLoadingScreen, createRevealGate } from "./loading-screen";
// TUT-03 (#422): the in-game, voiced guide — a step engine that points at
// the real controls and waits for the player to use them. It replaces the
// eight-card tour (`src/iso/tutorial.ts`, removed): the Tutorial menu, the
// spotlight and the narrator all live in src/iso/guide.
import { createGuideHost, takeQueuedSection, type GuideHost } from "./guide";
import { tutorialMap, tutorialSites, tutorialPrerequisites } from "./guide/scenario";
import { GUIDE_SECTION_IDS, type GuideSectionId } from "./guide/types";
import { showSettingsSheet, type SettingsSheetHandle } from "./settings-sheet";
// MON-1 (#367): the RUN Bits store — THE panel the main menu raises too, so
// the front door and a live match never quote a different price. `loadStore`
// warms the entitlement cache at boot; the store is never a gate.
import { showStorePanel, type StorePanelHandle } from "../game/store-panel";
import { loadStore } from "../game/store";
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
import {
  createHistory, recordSample, recordEvent, recordDepotDelivery, finalizeHistory, buildSummary,
  type MatchHistory,
} from "./match-history";
// STORY-01 — the campaign seam: a contract names the rival, the voice, the
// ★ line and the three scenes around the match; the guide rides the wire.
import { CAST, FACE_FOR_DIRECTION, faceOf, type Expression } from "../story/cast";
// CAST-1: the managers' faces, their unlock record, and Cornelius Graves.
import { RIVAL, managerThumb, recordManagerMatch } from "../story/managers";
import { CHAPTERS, EMPLOYER, chapterAfter, chapterById, type StoryChapter } from "../story/chapters";
import { createStoryDirector } from "../story/voices";
import { advisorBeats, type AdvisorEvent } from "../story/advisor";
import { advisorEnabled, recordChapterResult } from "../story/progress";
import { recordScenarioResult, scenarioById, type ScenarioDef } from "../story/scenarios";
import {
  scenarioGoalDone, scenarioGoalHave, scenarioGoalLine,
  type ScenarioGoalInput, type ScenarioObjective,
} from "../story/scenario-goals";
import { showScene, type SceneHandle } from "../story/stage";
import type { UiRivalryBeat, UiTuningResult, FleetCardInfo } from "../game/ui";
import {
  OIL_DRILLING_SCENE, createBanterDirector, createClaimDirector, createComebackDirector,
  createGoldMineDirector, createRivalDirector,
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
  perksEnabled,
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
// MATCH-2 (#566): the star moment — the finale clock and the board's own cues.
import { FinaleController } from "../match3/finale";
import { playMatch3Cue, stopFinaleMusic } from "../match3/audio";

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
  | "select" | "dirt" | "road" | "interchange" | "harvester" | "plant" | "demolish"
  // RAIL-04 (#178): the railway's four verbs. `rail` is a drag (tiles),
  // `platform` and `raildepot` are one-click placements in the current
  // heading, and `railway` is the panel — lines, trains and their actions.
  | "rail" | "platform" | "raildepot" | "railway"
  // FLEET-2 (#596): the Passing Loop - a one-click placement beside a straight
  // run of the player's own rail (R turns it, as for a platform).
  | "loop"
  // R3 (#270): the hydro dam — a one-click placement on a river tile, with
  // R rotating which bank the footprint leans onto.
  | "dam"
  // #456: Level Ground — a drag (rect) or tap (tile) that levels to the drag
  // start's height; Shift/Alt tap raises/lowers one tile one level.
  | "level";

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
  /**
   * ECON-1 (#421): MONEY ($) — what this seat BUILDS with. Resources stay the
   * currency of city upgrades and the depot tree; every construction charge
   * goes through `spendBuild` below, which debits this number. Saved and
   * synced (the host owns it, like the rest of the economy).
   */
  money: number;
  /**
   * CAST-1: the seat's manager — whose perk and quirk its prices obey. `null`
   * is "no manager": the AI rival always, and any seat booted without one, so
   * those seats price exactly as before. Saved and wired (additive-optional,
   * like `money`), and the host applies it per seat.
   */
  manager: ManagerId | null;
  /** CAST-1: Rafael's free Black Market allowance (the window and its spends). */
  fixer: FixerState;
  blackMarket?: BlackMarketState;
  /**
   * PERK-1 (#600): Dolores' Return to Sender has already bounced the match's
   * first sabotage card (set on the DEFENDER the card was played on). Additive
   * optional: an old save or wire without it reads as "not spent yet".
   */
  sentBack?: boolean;
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
  /**
   * PP-14b → CAST-1: the manager the player picked. Absent = no manager (no
   * perks — every harness that boots a game directly); the legacy "vex"/"you"
   * portraits of old links and saves read as Anne/James.
   */
  portrait?: Portrait | LegacyPortrait;
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
   * PROG-1 (#475): the scenario this match plays (`SCENARIOS[].id`). Solo
   * only, like a contract: it names the seed, the map, the rival's fixed
   * difficulty and the ★ line. An unknown id — or a networked seat — reads
   * as no scenario at all.
   */
  scenario?: string;
  /**
   * PROG-1 (#475): the ending's "Next contract ▸" returns through here with
   * the next chapter's id. Absent, the door is not offered.
   */
  onNextChapter?: (chapterId: string) => void;
  /**
   * RAIL-05 (#182): force the railway feature flag. Absent, the flag is read
   * from `?rail=1` and is otherwise OFF in every mode until #179/#181 land
   * (the release gate in docs/railway-balance.md).
   */
  rail?: boolean;
  /**
   * R1 (#260): force the rivers map option. Absent, it is read from
   * `?rivers=1` and applies to solo (non-story) boots only — a networked room
   * regenerates the map from the seed alone, so rivers are not on the wire yet.
   */
  rivers?: boolean;
  /** E1 (#261): force seed-derived elevation; absent reads `?elevation=1`. */
  elevation?: boolean;
  /**
   * F4 (#275): force the shapes map option (long town buildings on merged
   * blocks, the long Factory footprint). Absent, it is read from `?shapes=1`
   * and applies to solo (non-story) boots only — like rivers, the option
   * changes what the seed generates, and a networked room regenerates the map
   * from the seed alone, so shapes are not on the wire yet.
   */
  shapes?: boolean;
  /**
   * #440: force the 45° road rule. Absent, it is read from `?diag=0|1` and is
   * otherwise ON for a new game — see `map-options.ts` for the whole chain
   * (a resumed save keeps its own value; in a room the host's record wins, so
   * this is a solo/debug lever like `rivers`).
   */
  diag?: boolean;
  /**
   * TOWN-2 (#653): force the town street plan — `"organic"` (irregular
   * outlines, 45° avenues, bigger plots) or `"grid"` (every pre-TOWN-2 map).
   * Absent, it is read from `?layout=grid|organic` over the same chain as the
   * other map options: a new game generates organic, a resumed save keeps the
   * plan it was saved from (a save without the key predates TOWN-2 and stays
   * grid), and in a room the host's record wins. A story contract and the
   * Starter Island keep their tuned (grid) towns.
   */
  layout?: TownLayout;
  /**
   * TOWN-4.1 (#677): force the map size — `"standard"` (144×144, every save,
   * chapter, scenario and room before the option) or `"large"` (216×216).
   * Absent, it is read from `?size=standard|large` for a NEW game, from the
   * save's own record when one resumes (absent there = standard), and from
   * the host's record in a room (a guest's URL never splits the seats). The
   * Starter Island and the lessons are always standard. Explicit wins over a
   * save: a save of another size is then not resumed (a different map).
   */
  size?: MapSizeName;
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
   *
   * FTUE-1 (#464): the first game IS the Starter Island (see `starterIsland`
   * below) — this flag still owns the first-launch extras (the camera opens
   * on the town).
   */
  firstRun?: boolean;
  /**
   * FTUE-1 (#464): the STARTER ISLAND scenario — the fixed preset map (one
   * town, four industries close by, flat aprons), the trainee rival and the
   * short 6★ line. The first launch runs it (`firstRun` implies it), the
   * Tutorial menu's "Play the Starter Island" replays it, and a save taken
   * inside it resumes it (its skill is cast as `trainee`). Absent = the
   * ordinary game.
   */
  starterIsland?: boolean;
  /** An isolated, unsaved practice match for one guide section. */
  tutorialSection?: GuideSectionId;
  onTutorialExit?: () => void;
  onTutorialSection?: (id: GuideSectionId) => void;
  /**
   * FTUE-1 (#464): leave the Starter Island for the NORMAL game. Wired to the
   * first screen's "Skip to the real game" and to the won ledger's "Build
   * another empire" door — both mark onboarding done and open a real match.
   * Absent (a test harness, a room) keeps every existing door as it was.
   */
  onPlayNormalGame?: () => void;
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
   *
   * FTUE-1 (#464): `won` says whether the local seat took the ledger — the
   * Starter Island marks onboarding done on a win (a loss leaves it open so
   * "Demand a rematch" runs the island again).
   */
  onMatchEnded?: (won?: boolean) => void;
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
  const tutorialSection = opts.tutorialSection;
  // ── DOM ────────────────────────────────────────────────────────────────
  // U1: the recovered UI owns the chrome. It is created once the trading
  // state exists (below); the iso canvas layer stack is mounted into its
  // original map-canvas slot. Keep `.iso-game` on the root for the boot test.
  root.innerHTML = "";
  root.classList.add("iso-game");
  let ui: OriginalUi;
  /** VO-1: cue a scripted line. Never throws — a bad trigger is silence. */
  const voiceCue = (trigger: string, once = false): void => {
    try {
      if (once) voice.cueOnce(trigger);
      else voice.cue(trigger);
    } catch { /* a voice line must not stop the match */ }
  };
  let voicedIncome = false;
  let voicedTrain = false;
  const notePlayerTrain = (): void => {
    if (voicedTrain) return;
    voicedTrain = true;
    voiceCue("player:first-train");
  };
  // MON-1 (#367): warm the entitlement cache as the match boots, so the ☰
  // menu's Store row opens already knowing what this player owns.
  // Fire-and-forget by design: an unreachable store is never a reason for a
  // slower boot, and never a reason the island does not load.
  void loadStore();

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
  // CAST-1: the manager — null when the caller named none (no perks), and the
  // face falls back to the default manager so the HUD always has one.
  const playerManager: ManagerId | null = managerOrNull(opts.portrait);
  let portrait: Portrait = playerManager ?? DEFAULT_MANAGER;
  /**
   * STORY-01: the contract this match plays. Solo only — a networked seat's
   * match belongs to the room — and an id the campaign does not know reads as
   * no story at all, so a stale playtest link can never break a boot.
   */
  const storyChapter: StoryChapter | null =
    opts.story && isSolo() ? chapterById(opts.story) : null;
  const storyOn = storyChapter !== null;
  /**
   * PROG-1 (#475): the scenario this match plays. Solo only, and a contract
   * wins over a scenario when both are named (the App never names both —
   * this is the stale-link guard, mirroring the story one above).
   */
  const scenarioDef: ScenarioDef | null =
    !storyChapter && opts.scenario && isSolo() ? scenarioById(opts.scenario) : null;
  const scenarioOn = scenarioDef !== null;
  /**
   * SCEN-2 (#602): the counters a scenario's objective reads — cargo carried
   * into the player's plant, the best ★ a PLAYED Depot tuning reached, and the
   * rival battles won. Plain match-local numbers: they are never saved, never
   * on the wire, and stay zero on every boot that is not a scenario, so a
   * sandbox game pays nothing for them. `trainLines` is not a counter — the
   * rail state is the truth, so it is read live (`scenarioGoalState`).
   */
  let scenarioDelivered = 0;
  let scenarioBestTuningStars = 0;
  let scenarioBattlesWon = 0;
  /** The completion line is fed once, the frame the goal closes. */
  let scenarioGoalFed = false;
  /** PROG-1 (#475): where "Next contract ▸" walks (null past the ledger). */
  const nextChapter = storyChapter ? chapterAfter(storyChapter.id) : null;
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
  const railAvailable = opts.tutorialSection ? true : (opts.rail ?? railParam !== "0");
  const loopParam = (() => {
    try { return new URLSearchParams(location.search).get("loop"); } catch { return null; }
  })();
  const newLoopRequested = opts.tutorialSection ? true : (opts.newLoop ?? loopParam !== "old");
  // The new loop is sandbox-only: a networked room or a story contract ignores
  // the request and says so — the toast waits until no boot overlay covers the
  // map (see the frame loop's `loopToastPending`).
  // SCEN-2 (#602) — owner, 2026-09-28: scenarios play the CURRENT game. The
  // old loop left scenario 1 on a squashed Processing Plant tab and a board the
  // rest of the build had retired: no tuning sessions, no Depots-and-clock
  // economy, none of the new UI. A scenario is a PLACE, not a second game — it
  // changes the map, the rival, the ★ line and the job, never the rules — so
  // only a story contract (and a room, which never reads this flag) still
  // holds the retired loop.
  const newLoop = newLoopRequested && isSolo() && !storyOn;
  // Only someone who named the loop gets told a room or a contract refused it.
  // A default boot is not a refusal, it is the game, and every MP/story seat
  // would otherwise open with an apology for the loop it is correctly on.
  const newLoopAsked = opts.newLoop === true || loopParam === "new";
  let loopToastPending = newLoopAsked && !newLoop;
  /** The cast member playing the rival: the contract's, else Torvin as ever. */
  const rivalCast = storyChapter ? storyChapter.rival : "torvin";
  /** The player's own cast id, for every line the wire answers in. */
  const playerCast: ManagerId = portrait;

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
  // R1 (#260): the rivers map option. OFF by default so every existing seed /
  // save / room is untouched; `?rivers=1` (or `opts.rivers`) turns it on for a
  // solo sandbox boot. Solo-only: a networked room regenerates from the seed
  // alone and rivers are not on the wire yet, so MP deliberately ignores it.
  const freshLink = (() => { try { return new URLSearchParams(location.search).get("fresh") === "1"; } catch { return false; } })();
  // A rivers boot never reads or writes the save slot: resuming a rivers map
  // without the flag would regenerate a different (riverless) terrain under
  // the saved network, so rivers play is a fresh sandbox each time. Shapes
  // change the generated map the same way, so they get the same treatment.
  const savesOff = isMp() || !!opts.tutorialSection || freshLink || !!(window as unknown as Record<string, unknown>).__ISO_DISABLE_SAVE;
  // MAP-1 (#412): a URL that names a map feature asks for a FRESH map with it —
  // don't resume a save onto a different terrain (the save is still written).
  const searchNow = (() => { try { return location.search; } catch { return ""; } })();
  // TOWN-4.1 (#677): `?size=` is one of them — a URL that names a size asks
  // for a fresh map of that size, never a resumed save resized under it.
  const mapParamsInUrl = /[?&](rivers|elevation|shapes|rings|layout|size)=/.test(searchNow);
  // STORY-01 fix: each mode has its own save slot — the sandbox's, or this
  // contract's. A contract that read the sandbox save resumed that world (its
  // seed, the rival's network, phase "play") against the chapter's lower ★
  // line and lost on the first rescore.
  // PROG-1 (#475): scenarios get their own slots the same way.
  const saveKey = storyChapter
    ? saveKeyFor(storyChapter.id)
    : scenarioDef ? scenarioSaveKey(scenarioDef.id) : saveKeyFor(null);
  const recentSave = savesOff || mapParamsInUrl ? null : loadRecentSave(Date.now(), saveKey);
  // TOWN-4.1 (#677): an EXPLICIT size (tests, debug boots) outranks the save's
  // record — and a save recorded at another size is another map, so it is not
  // resumed under it (its bytes would not fit the track this boot builds).
  const explicitSize = readMapSize(opts.size);
  const foundSave = recentSave && explicitSize
    && (readMapSize((recentSave.map as { size?: unknown } | undefined)?.size) ?? "standard") !== explicitSize
    ? null : recentSave;
  // L15 (#230): old saves (v1 / snap 15) are from a different game — refuse
  // with a clear message and keep the slot untouched so the toast is honest.
  // The new loop is the only loop now, so no save needs a flag to open.
  const rawSave = savesOff ? null : (() => { try { const r = localStorage.getItem(saveKey); return r ? JSON.parse(r) : null; } catch { return null; } })();
  // TOWN-4.1 (#677): the version rule lives in `isOldSave` now (it also takes a
  // snap 17 save — a 144 map, byte for byte), and a save whose layers do not
  // fit the map size its own record names is refused the same way rather than
  // restored into a track of another size.
  const isOld = rawSave !== null && (isOldSave(rawSave) || !saveFitsItsMap(rawSave));
  const bootSave = isOld ? null : foundSave;
  let saveToastPending = false;
  let oldSaveToastPending = isOld;
  // STORY-01: a contract is a PLACE — its map must not move between attempts —
  // so the chapter's seed sits in the chain between an explicit `?seed=`
  // (playtests, saved seeds) and the fresh random one. A resumed save keeps
  // carrying its own seed, as always. PROG-1 (#475): a scenario is a place
  // the same way — its seed sits beside the chapter's.
  // FTUE-1 (#464): the STARTER ISLAND runs on a first launch (App's routing),
  // on the Tutorial menu's "Play the Starter Island" replay — and when a save
  // taken inside it resumes (its rival is cast `trainee`, a skill no ordinary
  // game ever stores). The scenario is a PLACE: one fixed seed, the preset's
  // map features, whatever the ambient options say.
  const starterSaved = (bootSave as { skillKey?: string } | null)?.skillKey === "trainee";
  const starterIsland = opts.starterIsland === true || opts.firstRun === true || starterSaved;
  /**
   * Owner (2026-09-28): only a lesson (a tutorial section or the Starter
   * Island) walks the player through placing a Depot before play starts. A
   * real match opens on the Plant alone — the Depots are the player's call.
   */
  const setupNeedsDepot = !!opts.tutorialSection || starterIsland;
  const seed = opts.tutorialSection ? STARTER_ISLAND_SEED + GUIDE_SECTION_IDS.indexOf(opts.tutorialSection)
    : starterIsland
    ? STARTER_ISLAND_SEED
    : (opts.seed ?? bootSave?.seed ?? storyChapter?.seed ?? scenarioDef?.seed ?? resolveMapSeed());
  // PROG-1 (#475): the match's wall clock, for scenario and contract best
  // times — boot to final ledger, briefing included. A resumed save restarts
  // it: a best time is a best sitting, not a best fortnight.
  const matchWallStart = Date.now();
  // MAP-1 (#412): rivers + dams, elevation and shapes are ON for new games;
  // #440 puts 45° roads on the same list. See map-options.ts for who decides
  // (save, room, story, scenario, URL, default). `diag` is deliberately absent
  // from `mapParamsInUrl` above: it re-terrains nothing, so a `?diag=0` boot
  // keeps the save in front of it instead of throwing the map away to honour it.
  // FTUE-1 (#464): …except the Starter Island, which is tuned terrain (its
  // own map options, recorded on the save like any other game's). TOWN-2
  // (#653): its towns stay grid-plan for the same reason — the guide walks
  // the island's tuned streets.
  const mapOptions: MapOptions = opts.tutorialSection || starterIsland
    ? { rivers: false, elevation: true, shapes: true, rings: true, diag: true }
    : resolveMapOptions({
      explicit: { rivers: opts.rivers, elevation: opts.elevation, shapes: opts.shapes, rings: (opts as { rings?: boolean }).rings, diag: opts.diag },
      search: searchNow,
      save: bootSave ? (bootSave as unknown as { map?: unknown }) : null,
      room: isMp() ? settings : null,
      story: storyOn ? (storyChapter ?? {}) : null,
      scenario: scenarioOn ? (scenarioDef ?? {}) : null,
    });
  // TOWN-2 (#653): the town street plan, over the same chain of custody as
  // the booleans (explicit → URL → save → room → story/scenario → the
  // new-game default, which is organic outside the unit-test runner). The
  // resolved value is written BACK into `mapOptions` so the save this game
  // writes records the plan its map was generated under — a saved organic
  // town reloads as the organic town it is, and a pre-TOWN-2 save (no key)
  // keeps regenerating grid.
  const townLayout = resolveTownLayout({
    explicit: { layout: opts.layout },
    search: searchNow,
    save: bootSave ? (bootSave as unknown as { map?: unknown }) : null,
    room: isMp() ? settings : null,
    story: storyOn ? (storyChapter ?? {}) : null,
    scenario: scenarioOn ? (scenarioDef ?? {}) : null,
  });
  mapOptions.layout = townLayout;
  // TOWN-4.1 (#677): the map SIZE, over the ticket's chain (explicit → a new
  // game's `?size=` → the save's record → the host's room record → story /
  // scenario → the default — standard everywhere until TOWN-4.5). The Starter
  // Island and the lessons are fixed places: standard, like the rest of their
  // hard-coded map record. Written back so the save records it, and SET here —
  // once, before generateMap / createTrack / any map-sized allocation below.
  const mapSize: MapSizeName = opts.tutorialSection || starterIsland ? "standard"
    : resolveMapSize({
      explicit: { size: explicitSize ?? undefined },
      search: searchNow,
      save: bootSave ? (bootSave as unknown as { map?: unknown }) : null,
      room: isMp() ? settings : null,
      story: storyOn ? (storyChapter ?? {}) : null,
      scenario: scenarioOn ? (scenarioDef ?? {}) : null,
    });
  mapOptions.size = mapSize;
  setMapSize(MAP_SIZES[mapSize], MAP_SIZES[mapSize]);
  const mapSizeClaim = claimMapSize();
  const organicTowns = townLayout === "organic";
  const riversOn = mapOptions.rivers, elevationOn = mapOptions.elevation, shapesOn = mapOptions.shapes;
  const grid: Grid = opts.tutorialSection ? tutorialMap(opts.tutorialSection)
    : starterIsland
    ? starterIslandGrid()
    : generateMap(seed, {
      rivers: riversOn, elevation: elevationOn, shapes: shapesOn, rings: mapOptions.rings,
      layout: townLayout,
      // TOWN-4.1: held to the size just set (a mismatch throws, never builds).
      size: mapSize,
      ...(scenarioDef?.gen ?? {}),
    });
  // #456: the seed-derived heights, kept as the baseline the edited-heights
  // diff is measured against (saves and the MP wire carry only the delta from
  // THIS, the way map options travel — the terrain itself regenerates).
  const seedHeights: Uint8Array | null = grid.height ? new Uint8Array(grid.height) : null;
  // F4 (#275): the Factory this map plays with. Shapes maps carry the long
  // `factory_2x4` span on the grid; every legacy map falls back to the
  // constant. Drawn from the grid (not re-derived) so the boot, the rules and
  // the renderer can never disagree about the footprint.
  const factoryFp = factoryFootprintFor(shapesOn);
  // SCENERY: decals + clumped trees, a pure function of the seed (so a guest
  // regenerates exactly the host's woodland from the seed alone — scenery is
  // never on the wire). Computed before the towns stamp their roads because
  // it reads `grid.occupancy`/`grid.publicRoads`, both of which `generateMap`
  // has already filled; nothing in `track` affects it.
  const scenery: Scenery = scatterScenery(grid);
  // AMB-2 (#391): the bird pool. Built once per map from the map seed, like
  // the scenery — the species a tile belongs to is read off the terrain,
  // rivers, town tiles and the wheat fields beside the farms, so the pool
  // costs one derivation per map and NOTHING per frame until the camera
  // reaches the closest zoom. Cosmetic through and through: no save field, no
  // wire message, no draw-list entry, nothing for `renderer.pick` to find.
  const birds: BirdState = createBirds(
    grid, scenery.fields.filter((f) => f.sprite === "wheat_field"),
  );
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
  // #440: the road rule the whole game builds under — the drag, the routing,
  // the rival and the renderers all read THIS flag, so a save, a room and a
  // `?diag=0` boot can never leave two parts of one game disagreeing.
  const track: Track = createTrack(mapOptions.diag);
  // RAIL-04 (#178): the railway's own world. #142 is explicit that rail is a
  // SECOND, owner-scoped graph — it never reuses the road tiers, their bytes or
  // their names — so this is a separate state object beside `track`, created
  // here and read by the tools, the panel, the economy and the snapshot.
  const rail: RailState = createRailState();
  /** RAIL-02: the heading the platform/depot tools place with — R turns it. */
  let railView: RailView = "se";
  /**
   * R3 (#270): the bank the Dam tool leans onto — R cycles it. The river's
   * axis fixes the footprint (1×2 or 2×1); the side is the one free choice,
   * and `damSideAtSite` folds it to the axis's first side when the held side
   * runs along the river rather than across it, so a click always builds the
   * footprint the site allows.
   */
  let damSide: DamSide = "s";
  /** F3 (#274): quarter-turns the factory/plant ghost is rotated — R turns it. 0..3, legacy absent=0. */
  let factoryView = 0;
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
  // TOWN-2 (#653): an organic town's 45° avenue links, after the endpoints
  // are paved. A no-op on grid-plan maps.
  seedTownDiagonals(track, grid);
  // ROADS-2 (#393): on new maps a town's own streets are STREETS (slow,
  // kerbed) — freight through a town centre costs speed. Rides with the
  // town-roads map option (#296 \`rings\`), so older maps and saves keep Road.
  if (mapOptions.rings) {
    for (const town of grid.towns) for (const [x, y] of town.roads) setRoadTier(track, x, y, ROAD_TIER.street);
  }
  // TOWN-4.3 (#679): a planned town's AVENUE goes on after the streets (and
  // after the street tier above): it is laid at full length from tier 0 — the
  // town's spine — and `stampAvenue` in track.ts is the single place that
  // learns about the TOWN-4.2 avenue tier when it lands. A no-op on grid and
  // organic maps, which carry no plan.
  seedTownAvenues(track, grid);
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
    { i: 0, id: "you", name: "You", colour: "#5aa8ff", purse: toBag(startPurse), human: true, freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS, depotTier: 0, townLevel: 0, townBonus: 0, money: START_MONEY, manager: playerManager, fixer: freshFixer() },
    // STORY-01: a contract renames and recolours the rival seat — the dossier
    // cards, the scoreboard and the ending ledger all read this name, so the
    // whole HUD introduces whoever the chapter cast.
    // #186: both seats open on the room's purse — the settings are the ROOM's
    // rules, so a Rich game is rich for the guest and for the AI alike, and the
    // two purses can never disagree about what the host chose.
    { i: 1, id: "ai", name: storyChapter ? CAST[rivalCast].name : "Rival", colour: storyChapter ? CAST[rivalCast].colour : "#ff7a5a", purse: toBag(startPurse), human: false, freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS, depotTier: 0, townLevel: 0, townBonus: 0, money: START_MONEY, manager: null, fixer: freshFixer() },
  ];
  const me = players[0], rival = players[1];
  /**
   * CAST-1: the face a seat wears on battle screens and the ledger — the
   * player's own manager, another human's manager (as the host echoed it),
   * or the AI's: a contract's rival, else Cornelius Graves.
   */
  const seatFace = (p: PlayerState): string => {
    if (p === me) return managerThumb(portrait);
    if (p.human) return managerThumb(p.manager ?? DEFAULT_MANAGER);
    return storyChapter ? (CAST[rivalCast].solo ?? faceOf(rivalCast, "calm").url) : RIVAL.thumb;
  };

  // DEV: unlimited resources for YOUR seat while testing. Only in the Vite dev
  // server — never in unit tests (vitest also sets DEV) and never in a shipped
  // build. `?unlimited=0` turns it off to test the real economy in dev.
  const DEV_PURSE_FLOOR = 9999;
  const DEV_MONEY_FLOOR = 999_999;
  const devUnlimited = import.meta.env.DEV && import.meta.env.MODE !== "test"
    && !(typeof location !== "undefined" && /[?&]unlimited=0\b/.test(location.search));
  const topUpDevPurse = () => {
    if (!devUnlimited) return;
    for (const c of CARGOES) if ((me.purse[c] ?? 0) < DEV_PURSE_FLOOR) me.purse[c] = DEV_PURSE_FLOOR;
    // ECON-1: dev's unlimited seat is unlimited in MONEY too, or every build
    // would still be gated behind a market the tester is not here to play.
    if (me.money < DEV_MONEY_FLOOR) me.money = DEV_MONEY_FLOOR;
  };
  topUpDevPurse();

  // ══════════════════════════════════════════════════════════════════════════
  // ECON-1 (#421) — MONEY and the market, wired.
  //
  // `market` is the price model (src/iso/market.ts); `marketMs` is the clock it
  // reads — milliseconds of PLAY, advanced by the frame loop on the host and
  // mirrored on the guest, so both seats price the same minute. Every build
  // charge in this file goes through `canPayBuild` / `spendBuild`, which price
  // a resource bill in money (`moneyValueOf`, the table `BUILD_COSTS_MONEY` is
  // derived from) and debit the seat's `money`. City upgrades and the depot
  // rungs keep paying RESOURCES through the old `spend` / `canAfford` seam.
  // ══════════════════════════════════════════════════════════════════════════
  const market = createMarket(seed);
  let marketMs = 0;
  /** The frame clock the market was last advanced at (`0` = not started). */
  let marketLast = 0;
  /** Demand events already announced, so the Feed says each one once. */
  const announcedEvents = new Set<string>();

  /** What a resource bill costs in money ($). One conversion, everywhere. */
  const moneyCostOf = (cost: Purse): number => moneyValueOf(cost);
  /**
   * CAST-1: what THIS seat pays for a bill of this build class — the one place
   * a manager's perk or quirk touches a build price (docs/CAST.md). `other`
   * (and a seat with no manager) is exactly `moneyCostOf`.
   */
  /**
   * MP-MGR (owner, 2026-09-29): the manager whose PERKS a seat plays with.
   * The host may switch perks off for the room (`settings.perks === false`);
   * then every seat resolves to none while `p.manager` (the portrait, the
   * identity) stays. Every perk reader goes through this one seam.
   */
  const perksOn = perksEnabled(settings);
  const perkManagerOf = (p: PlayerState): ManagerId | null => (perksOn ? p.manager : null);
  const seatCostOf = (p: PlayerState, cost: Purse, cls: BuildClass = "other"): number =>
    perkPrice(moneyCostOf(cost), perkManagerOf(p), cls);
  /** CAST-1: the balance a drag preview should test (see `effectiveBalance`). */
  const previewBalance = (p: PlayerState, cls: BuildClass): number =>
    effectiveBalance(p.money, perkManagerOf(p), cls);
  /** Can this seat pay for a build that used to cost `cost` in resources? */
  const canPayBuild = (p: PlayerState, cost: Purse, cls: BuildClass = "other"): boolean =>
    p.money >= seatCostOf(p, cost, cls);
  /** Charge a BUILD. Never takes a seat below $0 — the refusal comes first. */
  const spendBuild = (p: PlayerState, cost: Purse, cls: BuildClass = "other"): boolean => {
    const price = seatCostOf(p, cost, cls);
    if (p.money < price) return false;
    p.money -= price;
    return true;
  };
  /**
   * ECON-1: a seat's build budget, expressed as a RESOURCE purse — what its
   * money would buy at the starting prices.
   *
   * It is what the HUD's own affordability questions ask ("can I afford the
   * Depot under the pointer?") now that the answer is a money question.
   *
   * The RIVAL's planner is deliberately NOT given this purse: `ai.ts` plans
   * against real stock, and handing it a rich synthetic one changed the shape
   * of every search (the #412 smoke went from 29 s to over 3 minutes). The
   * rival plans with its goods exactly as before and PAYS in money —
   * `canPayBuild` gates it, `chargeBuild` (clamped at $0) charges it. See
   * docs/economy-money.md §5.
   */
  const buildPurse = (p: PlayerState): Purse =>
    Object.fromEntries(CARGOES.map((c) => [c, Math.floor(p.money / BASE_PRICE[c])])) as Purse;

  /** Charge a build that has already happened. Clamped at $0, never refused. */
  const chargeBuild = (p: PlayerState, cost: Purse, cls: BuildClass = "other"): void => {
    p.money = Math.max(0, p.money - seatCostOf(p, cost, cls));
  };

  /** A demolish refund, in money — of what this seat PAID (CAST-1). */
  const refundBuild = (p: PlayerState, cost: Purse, fraction = 1, cls: BuildClass = "other"): void => {
    p.money += Math.max(0, Math.floor(seatCostOf(p, cost, cls) * fraction));
  };
  /** The live price of one unit of `cargo` on this match's market. */
  const unitPrice = (cargo: Cargo): number => priceOf(market, cargo, marketMs);

  /**
   * ECON-1: a seat sells goods. The market owns the price and the slippage;
   * this owns the purse and the money. Returns what it fetched ($).
   */
  function sellCargo(p: PlayerState, cargo: Cargo, n: number): number {
    if (!sellable(cargo)) return 0;
    const units = Math.max(0, Math.min(Math.floor(n), Math.floor(p.purse[cargo] ?? 0)));
    if (units <= 0) return 0;
    const quote = sellOnMarket(market, cargo, units, marketMs);
    p.purse[cargo] = (p.purse[cargo] ?? 0) - quote.units;
    p.money += quote.revenue;
    // END-1 (#472): biggest sale highlight
    try {
      const seatIdx = p.i === 0 ? 0 : 1;
      const t = (performance.now() - matchHistory.startMs) / 1000;
      recordEvent(matchHistory, { kind: "sale", seat: seatIdx as 0 | 1, cargo, units: quote.units, revenue: quote.revenue, t });
    } catch {}
    return quote.revenue;
  }

  /**
   * MKT-2 (#465): a seat buys goods with money at the price plus the spread.
   * The mirror of `sellCargo`: the market owns the quote, this owns the purse
   * and the money. Returns what it cost ($), or 0 when it refused.
   */
  function buyCargo(p: PlayerState, cargo: Cargo, n: number): number {
    if (!sellable(cargo)) return 0;
    const units = Math.max(0, Math.floor(n));
    if (units <= 0) return 0;
    const quote = quoteBuy(market, cargo, units, marketMs);
    if (quote.units <= 0 || quote.cost <= 0 || p.money < quote.cost) return 0;
    p.money -= quote.cost;
    p.purse[cargo] = (p.purse[cargo] ?? 0) + quote.units;
    return quote.cost;
  }

  /**
   * MKT-2 (#465): the LOCAL seat's price alerts, one per cargo at most.
   * Session-local and client-local — they evaluate against the mirrored
   * prices, so a guest's alerts need no wire and ride no save.
   */
  const alerts = new Map<Cargo, PriceAlert>();

  /**
   * MKT-2 (#465): evaluate the local seat's alerts against the live price. A
   * firing alert toasts and writes one Feed line, once per crossing (the
   * re-arm rule is `priceAlertTick`'s). Returns what fired, for the tests.
   */
  function checkAlerts(): Cargo[] {
    const fired: Cargo[] = [];
    for (const alert of alerts.values()) {
      if (!priceAlertTick(market, alert, marketMs)) continue;
      fired.push(alert.cargo);
      const p = priceOf(market, alert.cargo, marketMs);
      toast(`🔔 ${CARGO[alert.cargo].name} hit ${moneyStr(p)} (above ${moneyStr(alert.above)}).`, "good");
      ui.feed(`Price alert — ${CARGO[alert.cargo].name} hit ${moneyStr(p)} (above ${moneyStr(alert.above)}).`);
    }
    return fired;
  }

  /** The exchange's rows for the HUD — one per sellable good. */
  const marketRows = () =>
    CARGOES.filter(sellable).map((cargo) => ({
      cargo,
      price: priceOf(market, cargo, marketMs),
      trend: trendPct(market, cargo, marketMs),
      spark: priceHistory(market, cargo, marketMs, 24),
      held: Math.floor(me.purse[cargo] ?? 0),
      // MKT-2 (#465): what a Buy pays per unit, and the seat's alert line.
      buy: buyPrice(market, cargo, marketMs),
      alert: alerts.get(cargo)?.above ?? null,
    }));

  /**
   * MKT-2 (#465): the exchange's SELL door — the Market tab's Sell buttons and
   * the `exchangeSell` test twin. A guest's sale is a HOST INTENT, like the
   * bank's: the host owns the slippage, so the trade exists only once the
   * host's delta says so (`"relayed"`). Solo and host apply it here and now.
   */
  const sellDoor = (cargo: Cargo, n: number | "all"): number | string => {
    if (!sellable(cargo)) return "Gold is the Black Market's money — it is not sold here.";
    if (isGuest()) {
      if (!net?.sendIntent("build", { do: "sell", cargo, n })) return "Not connected.";
      return "relayed";
    }
    const held = Math.floor(me.purse[cargo] ?? 0);
    if (held <= 0) return `No ${CARGO[cargo].name} to sell.`;
    const units = n === "all" ? held : Math.min(held, Math.max(1, Math.floor(n)));
    const got = sellCargo(me, cargo, units);
    if (got <= 0) return "That sale fetched nothing.";
    ui.feed(`Sold ${units} ${CARGO[cargo].name} for ${moneyStr(got)}.`);
    // SFX-1 (#463): a market sale rings the till. Silent headless (unarmed).
    sfx.play("coin");
    if (isMp()) publishNet(performance.now(), true);
    return got;
  };

  /**
   * MKT-2 (#465): the exchange's BUY door — Buy 1 / Buy 10 at price + spread,
   * so a missing upgrade input can be bought. Same relay rule as selling: the
   * host applies a guest's buy against the guest's own seat.
   */
  const buyDoor = (cargo: Cargo, n: number): number | string => {
    if (!sellable(cargo)) return "Gold is the Black Market's money — it is not bought here.";
    const units = Math.max(0, Math.floor(n));
    if (units <= 0) return "Nothing to buy.";
    if (isGuest()) {
      if (!net?.sendIntent("build", { do: "buy", cargo, n: units })) return "Not connected.";
      return "relayed";
    }
    const quote = quoteBuy(market, cargo, units, marketMs);
    if (quote.units <= 0) return "Nothing to buy.";
    if (me.money < quote.cost) return `Not enough money — ${units} ${CARGO[cargo].name} costs ${moneyStr(quote.cost)}.`;
    buyCargo(me, cargo, units);
    ui.feed(`Bought ${units} ${CARGO[cargo].name} for ${moneyStr(quote.cost)}.`);
    if (isMp()) publishNet(performance.now(), true);
    return quote.units;
  };

  /**
   * MKT-2 (#465): the exchange's ALERT door — "notify me above $X", per cargo.
   * Local to this client (it evaluates against the mirrored prices), so it
   * works on a guest with no relay. `null` (or anything not a price) clears.
   */
  const alertDoor = (cargo: Cargo, above: number | null): string => {
    if (!sellable(cargo)) return "Gold has no exchange price to watch.";
    if (above === null || !Number.isFinite(above) || above <= 0) {
      alerts.delete(cargo);
      return `${CARGO[cargo].name} alert cleared.`;
    }
    alerts.set(cargo, createAlert(cargo, above));
    return `${CARGO[cargo].name} alert set above ${moneyStr(above)}.`;
  };

  /**
   * ECON-1 (#421): the RIVAL trades. It sells a good when the market is paying
   * above that good's recent average (`rivalSellLot`), never below the reserve
   * it is keeping for its NEXT CITY UPGRADE — city upgrades still cost
   * resources, so a rival that sold everything could never buy one — and never
   * more than a lot at a time, so it pays slippage like the player does.
   */
  let lastRivalSell = 0;
  const RIVAL_SELL_MS = 5_000;
  function rivalMarketTick(now: number): void {
    if (isGuest() || phase !== "play") return;
    if (now - lastRivalSell < RIVAL_SELL_MS) return;
    lastRivalSell = now;
    const upgrade = TOWN_UPGRADES[Math.min(rival.townLevel, TOWN_UPGRADES.length - 1)];
    const reserve = (upgrade?.cost ?? {}) as Purse;
    // MKT-2 (#465): the rival reads the SAME rumours the Market tab prints —
    // false ones included on Hard — and waits out a rumoured boom.
    const rum = rumourAt(seed, marketMs, skillKey);
    for (const cargo of CARGOES) {
      if (!sellable(cargo)) continue;
      const held = Math.floor(rival.purse[cargo] ?? 0);
      const lot = rivalSellLot(market, cargo, held, reserve[cargo] ?? 0, marketMs,
        { rumourBoom: !!rum && rum.boom && rum.cargo === cargo });
      if (lot > 0) sellCargo(rival, cargo, lot);
    }
  }

  /** Announce demand events in the Feed, once each, as they open. */
  function marketEventTick(): void {
    for (const ev of eventsAt(seed, marketMs)) {
      if (announcedEvents.has(ev.id)) continue;
      announcedEvents.add(ev.id);
      ui.feed(`Market — ${ev.label}.`);
      toast(ev.label, ev.mult > 1 ? "good" : "bad");
    }
  }

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
  // FTUE-1 (#464): the Starter Island CASTS its rival (the trainee), exactly
  // like a contract does — the resolver never gets a vote, and the pick is
  // not persisted: the player's own difficulty for normal games is theirs.
  // PROG-1 (#475): a scenario casts its rival at its fixed difficulty, like a
  // contract — the scenario IS the pacing.
  let skillKey: SkillKey = opts.tutorialSection ? "hard"
    : starterIsland
    ? "trainee"
    : storyChapter
      ? storyChapter.skill
      : scenarioDef
        ? scenarioDef.skill
      : aiOpponent
        ? settings.aiSeats[0]
        : resolveSkillKey();
  // AI-01: a pinned `?rival=` link is an explicit choice, exactly like a pick
  // in the top-bar selector — so it persists for the next boot. Only the URL
  // path writes here: a plain boot must leave the storage key ABSENT or the
  // AI-02 start-of-game picker would never ask a fresh player again. A
  // scenario cast (Starter Island, PROG-1) never writes the player's key at all.
  if (!starterIsland && !opts.tutorialSection && !storyChapter && !scenarioDef && skillKeyFromUrl()) {
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
  // against 0.25★ paves and would be reached by three depot types. SCEN-2
  // (#602) moved scenarios onto that loop, which is why the scenario branch
  // (and the contract's) now sits ABOVE the flag: a scenario's ★ line is the
  // race PROG-1 sold on its card ("first to 10★"), and `VICTORY.loop.target`
  // must not silently rewrite it — the card, the HUD badge and the win check
  // all read this one function.
  let conquest = opts.conquest === true;
  let lastConquestCheck = 0;
  // FTUE-1 (#464): the Starter Island is a SHORT, winnable race — the
  // trainee's own ★ line (6), read live like every other line, so the HUD,
  // the king bars and the win check all agree.
  // PROG-1 (#475): a scenario races its own ★ line, like a contract.
  const winTarget = (): number => opts.tutorialSection ? skill().winTarget
    : starterIsland
    ? skill().winTarget
    : storyChapter
      ? storyChapter.target
      : scenarioDef
        ? scenarioDef.winTarget
        : (newLoop
          ? VICTORY.loop.target
          : (isSolo() ? skill().winTarget : settings.winTarget));

  // R3 (#270): the standing dams live on the economy state — the clock reads
  // their bonus off it in `economyTick`, and the save/snapshot carry it as
  // its own field (the sites themselves are seed-derived river water).
  const eco: EconomyState = { grid, track, harvesters: [], factories: [], rail, dams: [] };
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
    // R3 (#270): the DAM stands on its river tile and the bank it leans
    // onto — checked before the bridge derivation, because a deck laid over
    // the dam's water would otherwise read "bridge" (track on water) and the
    // dam's own tag would hide under it. A standing dam is a structure the
    // way a platform is one, so every builder that keeps off structures
    // (roads, rail, the other seat's depots) reads this one tag for it.
    if (eco.dams.some((d) => damContains(d, x, y))) return "dam";
    // R2 (#266): TRACK ON WATER IS A BRIDGE DECK. Checked first, because the
    // bytes that prove it are the road/rail layers this map already has: the
    // tile's terrain says water, and either layer says something is standing
    // there. Reported before the rail branches so a rail bridge reads
    // "bridge", not "rail" — everything that must keep off a deck (a platform,
    // a depot, the rival's road drag) reads this one tag.
    if (grid.terrain[tIdx(x, y)] === WATER
      && (hasRail(rail.rail, x, y) || hasTrack(track, "road", x, y) || hasTrack(track, "dirt", x, y))) {
      return "bridge";
    }
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
      x, y, f.tx, f.ty, factoryFp[0], factoryFp[1], f.rot ?? 0,
    ))) return "plant";
    if (townPlantReady) {
      if (townPlantTiles.has(tIdx(x, y))) return "plant";
    } else if (townHouseAt(grid, x, y)) return "plant";
    return null;
  };
  /** PP-15: the local seat may START a road drag on its own plant or depot.
   *  `canBuildOn` refuses those tiles (#298); the drag steps over them. */
  const ownFloor = (tx: number, ty: number) =>
    structureTiles(eco.factories, eco.harvesters, me.i + 1, factoryFp).has(tIdx(tx, ty));
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
  /**
   * AMB-3: `null` means "follow the town budget" (at least the shipped dozen,
   * more when towns are big or upgraded, never over `CAR_HARD_CAP`).
   * `__iso.setTraffic` pins a dial and the budget stops overriding it.
   */
  let trafficDial: number | null = null;
  const carBudget = (): number => trafficDial ?? Math.max(
    CAR_COUNT,
    Math.min(CAR_HARD_CAP, ambientCarBudget(grid.towns)),
  );
  let carCount = carBudget();
  // Named apart from the audio `ambience` import — that one is the island bed.
  const streetLife: AmbienceState = createAmbience(seed);
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
  // The fixture is born before the first world sync, from the SAME placement
  // planners as a player click. Nothing enters a save slot (savesOff above).
  const lessonSites = opts.tutorialSection ? tutorialSites(grid, track) : null;
  if (opts.tutorialSection && lessonSites) {
    factoryView = lessonSites.factory.rot;
    const prerequisites = tutorialPrerequisites(opts.tutorialSection);
    if (prerequisites.factory) {
      const { tx, ty, rot } = lessonSites.factory;
      eco.factories.push({ owner: me.id, ownerId: me.i + 1, id: 0, tx, ty, rot,
        townId: adjacentTown(grid, tx, ty, rot)?.id ?? null });
      phase = "setup-harvester";
    }
    if (prerequisites.depot) {
      const { tx, ty, facing } = lessonSites.depot;
      const contested = opts.tutorialSection === "rivals";
      const owner = contested ? rival : me;
      eco.harvesters.push({ id: allocHarvesterId(), owner: owner.id, ownerId: owner.i + 1,
        tx, ty, facing, yield: 1 });
      // The rival's resource has an actual serviced claim, not a pretend
      // marker: the game's own challenge eligibility sees the same road.
      if (contested) {
        const entrance = depotEntranceTiles(tx, ty, facing)
          .find(([x, y]) => canBuildOn(grid, "dirt", x, y));
        if (!entrance) throw new Error("Tutorial rival has no road entrance");
        buildTile(track, "dirt", entrance[0], entrance[1], rival.i + 1);
      } else me.freeDepots = 0;
      phase = "play";
    }
    if (opts.tutorialSection === "rail") phase = "play";
    me.money = 100_000; // practice builds cannot run out of money
    // Only the lesson's prerequisite materials are staged. Filling every
    // warehouse to 1000 would start storage rent and hide the first-income
    // moment the Logistics lesson waits for.
    if (opts.tutorialSection === "upgrades") {
      me.purse.wood = Math.max(me.purse.wood ?? 0, 20);
      me.purse.stone = Math.max(me.purse.stone ?? 0, 14);
      me.purse.grain = Math.max(me.purse.grain ?? 0, 14);
    }
    if (opts.tutorialSection === "rail") me.purse.stone = Math.max(me.purse.stone ?? 0, 20);
    if (opts.tutorialSection === "rivals") me.purse.gold = BATTLE_RULES.challengeGold + 2;
  }
  let tool: Tool = "dirt";
  /** ROADS-2 (#393): the paved tier the Road tool lays (the rail's Street /
   *  Road / Highway buttons all arm "road" with one of these). */
  let roadTier: RoadTierKey = "road";
  /** #462: the Depot a Select click is reading — its route stays drawn. */
  let selectedDepotId: number | null = null;
  /** #462: Network view — every one of your routes, coloured by speed. */
  let networkView = false;
  const toggleNetworkView = (): void => {
    networkView = !networkView;
    toast(networkView ? "Network view on — routes coloured by speed." : "Network view off.", "info");
  };
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
   * CAST-1: may this ending file a result with the manager unlocks? Only a
   * match DECIDED in this session — a save restored onto its final ledger, or
   * a guest joining a finished room, re-shows the ending and must not count
   * the same win twice.
   */
  let endingRecordable = true;
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

  // END-1 (#472): match history — sampled every 10 s: ★, money, events. Save-safe and MP-safe.
  const matchHistory: MatchHistory = createHistory(rankBootAt);

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
   * C2 (#257) put the panel on this log: every line that lands here is also
   * handed to the chrome (`ui.chatLine`), with the speaker's own name and
   * colour so the panel never has to guess whose seat a frame came from.
   * `__iso.chat()` reads the same log, which is what lets a probe assert on a
   * conversation the UI is showing.
   */
  const chatLog: ChatMsg[] = [];
  /** Bound the log: a match can run for hours and nothing prunes it otherwise. */
  const CHAT_LOG_MAX = 50;

  /**
   * One line into the log and onto the panel. `role` is the LOCAL seat's
   * answer to "who said this" — mine, or the other seat's — because a wire name
   * is the room's, not a role: the panel needs both the name (from the frame)
   * and the seat (from here) to colour the line the way every other surface
   * colours a player.
   */
  function pushChat(msg: ChatMsg, role: "you" | "peer" = "peer"): void {
    chatLog.push(msg);
    if (chatLog.length > CHAT_LOG_MAX) chatLog.splice(0, chatLog.length - CHAT_LOG_MAX);
    const speaker = role === "you" ? players[0] : players[1];
    ui?.chatLine({ role, who: msg.from, colour: speaker?.colour ?? "", text: msg.text });
  }

  /**
   * C2 (#257): a NOTICE from the room itself — the far seat dropping, coming
   * back, or emptying for good. It belongs in the conversation, not only in a
   * toast that is gone in two seconds: "why did nobody answer me" is answered by
   * the line above it.
   */
  function chatNotice(text: string): void {
    ui?.chatLine({ role: "system", who: "", colour: "", text });
  }

  /** TUT-03 (#422): the guide — spotlight, caption strip, Tutorial menu. Held
   *  so `dispose` can unmount the layer and drop its document listener, the
   *  same reason `endingView` is. */
  let guide: GuideHost | null = null;
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
  // RIVAL-3 (#467): the claim deck (the bark that goes UP with a claim flag)
  // and the comeback line (the bark when a claim loses the race). Same rule
  // as the decks above: deterministic and never the simulation RNG.
  const nextClaimScene = createClaimDirector(seed);
  const nextComebackLine = createComebackDirector(seed);
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
  },
  // PERK-1 (#600): Kenji's Shortcut rides the seat's board. The board is
  // constructed HERE, inside the call — the fill (and its rolls off the game's
  // stream) happen before the quarry body, exactly as with the default
  // `new Board()` the quarry used to build, so the deterministic boot order
  // is untouched. Null seats build the shipped board.
  new Board({ shortcut: perksOf(perkManagerOf(me)).shortcut }));

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
      if (t === "select") { cancelPlacement(); return; }
      // ROADS-2 (#393): Street / Highway are the Road tool at another tier.
      // TOWN-4.2 (#678): Avenue too (the straight-pair drag lives in track.ts).
      const key = t as string;
      if (key === "street" || key === "highway" || key === "road" || key === "ramp" || key === "avenue") {
        roadTier = key;
        armTool("road");
        return;
      }
      armTool(t as Tool);
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
      else if (action === "upgrade") railUpgrade(id);   // FLEET-4 (#598)
      // RAIL-6 (#575): "Add lane" arms the upgrade; the next map click picks
      // the side. The panel row's hint prints the price the click will charge.
      else if (action === "lane") {
        laneToolStation = laneToolStation === id ? null : id;
        if (laneToolStation !== null) {
          toast("Click the side of the station the new lane should run on — Esc cancels.", "info");
        }
      }
      else railSell(id);
      paintOverlayNow();
    },
    // NAMES: the top-bar "Names" button. The game owns the state (and the
    // localStorage record); the button only reports the toggle and reads
    // `showNames` back through `paint`.
    onNames: toggleNames,
    onNetworkView: toggleNetworkView,
    names: showNames,
    onRecenter: recenterCamera,
    // GOAL-1 (#459): the "Next step" advisor click pans to a specific tile and
    // arms the right tool. Same centerOnTile the "?" and debug paths use.
    onCenterTile: (tx: number, ty: number) => {
      commitCamera(centerOnTile(cam, tx, ty));
    },
    // MOBILE-01: the floating +/− keys are the wheel's touch twin — one zoom
    // step about the middle of the screen, exactly where a thumb-panner's eye
    // already is. Anchored at the viewport centre, like a wheel at centre.
    onZoom: (dir) => {
      stopCameraMotion();
      commitCamera(zoomStepAt(cam, dir, cam.vw / 2, cam.vh / 2));
    },
    // ROT-UI-1: the rotate keys under the minimap plate. Same door the `[` and
    // `]` keys open (`rotateViewStep` in camera.ts) — the loop's tickViewYaw
    // eases the turn and re-pivots the camera, so nothing more to do here.
    onRotate: (dir) => rotateViewStep(dir),
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
    // BUILD-1 (#460): the Undo chip's click — the same door Ctrl/Cmd+Z opens.
    onUndo: () => {
      const why = requestUndo();
      if (why) toast(`Can't undo — ${why}.`, "info");
    },
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
    // PERK-1 (#600): the session's perk keys — the game owns the Gold, the
    // busy gate and the +3; the chrome only reports the press.
    onTuningBuyMoves: () => sessionBuyMoves(),
    onTuningHint: () => sessionHint(),
    onTuningShuffle: () => sessionShuffle(),
    // #300: the pop-up's Confirm — applies the result it shows, exactly.
    onTuningConfirm: () => confirmTuningResult(),
    onTuningRetune: () => retuneNow(),
    // L8 (#222): the quest panel's own choices — a dismissed offer and a
    // hidden panel are the player's, and both ride the save.
    // CONTRACT-1 (#466): contracts replace Quests — accept/dismiss/hide/show
    onQuestAction: (id, action) => contractAction(id, action as any),
    // L5 (#219): …and the city upgrade's key. Same rule: it calls the game.
    onTownUpgrade: () => { buyTownUpgrade(); },
    // TUT-03 (#422): the ❔ card's Tutorial door opens the same menu ☰ does.
    onTutorial: () => guide?.openMenu(),
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
    // ECON-1 (#421) + MKT-2 (#465): the exchange's doors. Selling and buying
    // relay on a guest (the host owns the slippage); alerts are local.
    onSell: sellDoor,
    onBuy: buyDoor,
    onAlert: alertDoor,
    // TRADE (owner call, 2026-09): the Market tab's three doors.
    onOfferPost: (give, giveN, want, wantN) => tradeRequest("post", { give, giveN, want, wantN }),
    onOfferAccept: (id) => tradeRequest("accept", { id }),
    onOfferCancel: (id) => tradeRequest("cancel", { id }),
    // AI-01: the top-bar difficulty selector. Applies on the NEXT rival tick —
    // the clocks and budgets re-read `skill()` every call, so there is nothing
    // to restart.
    // MP-05: the difficulty selector is an AI feature — there is no AI rival
    // in a hosted game, so the selector is simply not built.
    // FTUE-1 (#464): no difficulty switch beside a scenario cast — the
    // Starter Island's rival is the trainee, the same way a hosted game has
    // no selector (the hook's absence is what keeps it out of the top bar).
    onSkill: isSolo() && !starterIsland && !tutorialSection ? (key) => setRivalSkill(key) : undefined,
    skill: isSolo() ? skillKey : undefined,
  }, {
    rail: railAvailable,
    // R3 (#270): the Dam button is a rivers-plus-new-loop feature — the two
    // flags its placement rule gates on (no dam-able water without rivers,
    // and the bonus multiplies a clock-income factor that only the new loop
    // pays). The button hides where the rules could never say "ok".
    dams: DAMS_ENABLED && riversOn && newLoop,
    // CAST-1: the build buttons quote this seat's perk prices.
    manager: playerManager,
    newLoop,
    /**
     * C2 (#257): the chat panel, and the whole of its gate.
     *
     * A config is passed ONLY when this client is in a room — solo, a story
     * contract and `?loop=old` pass nothing, which is the ticket's "multiplayer
     * only (hidden in solo / vs AI)" read as a construction-time fact rather
     * than a visibility flag: no other seat, no panel, no dead controls.
     *
     * Everything with a rule behind it is the session's (`sendChat` is the
     * same call `__iso.sendChat` makes, and the guard inside it applies the
     * length cap, the word filter, presets-only and the rate window to every
     * line this panel offers): the chrome asks and reports.
     */
    chat: net ? {
      presets: CHAT_PRESETS,
      maxLength: CHAT_MAX_LEN,
      getPrefs: () => net!.chatPrefs,
      setPrefs: (patch) => { net!.setChatPrefs(patch); },
      send: (text) => {
        // The wire's own verb, so the panel and `__iso.sendChat` cannot drift:
        // a line that goes out is logged as MINE (it comes back through the
        // guard's door, already filtered and stamped), a refusal is described.
        const res = net!.sendChat(text);
        if (res.ok) pushChat(res.msg, "you");
        return res.ok ? { ok: true as const } : { ok: false as const, reason: res.reason };
      },
      // The far seat's name once the roster has one; before that (and for a
      // host whose seat no human took) the header says there is nobody there.
      peerName: () => {
        const info = net?.info ?? null;
        if (!info || info.roster.length < 2) return null;
        return players[1].name || null;
      },
    } : undefined,
  });
  onBoardChange = () => ui.renderBoard();
  root.appendChild(ui.el);

  // ── TUT-03 (#422): the guide ────────────────────────────────────────────
  // The step engine, the spotlight and the Tutorial menu, over the live game.
  // Two seams and nothing else:
  //   · `mapRect` — the camera maths that turns a tile into a screen rect,
  //     asked for once a frame while a step is standing (never polled);
  //   · `assist` — the one thing a step may do FOR the player: open the sheet
  //     its target lives in, or arm the tool it is about to use.
  // Completions arrive as events from the placement paths below, so the guide
  // advances on the same gesture the game already handles.
  // A practice match ignores unrelated tool picks (without disabling the
  // camera, the menu or the Exit key). Install before the guide's own capture
  // listener so a refused pick cannot accidentally complete a step.
  const gateLessonTool = (event: MouseEvent) => {
    if (!opts.tutorialSection) return;
    const button = (event.target as Element | null)?.closest<HTMLElement>("[data-tool]");
    const picked = button?.dataset.tool;
    if (!picked) return;
    const c = guide?.controller.view().step?.complete;
    const expected = c?.kind === "tool" ? c.tool : c?.kind === "build"
      ? ({ road: "dirt", rail: "rail", platform: "platform", depot: "harvester" } as Record<string, string>)[c.what]
      : c?.kind === "event" && c.name === "challenge-started" ? "select" : null;
    if (picked === "select" || picked === expected || c?.kind === "build" && c.what === "road" && picked === "road") return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  document.addEventListener("click", gateLessonTool, true);
  guide = createGuideHost({
    root: ui.el,
    ctx: { vpTarget: winTarget(), freeTrack: me.freeTrack },
    live: true,
    // FTUE-1 (#464): the Starter Island's exit door — the host stands the
    // "Skip to the real game" chip beside the strip while the first-game
    // chain runs, and this is where it lands (App boots the normal match).
    onPlayNormalGame: opts.onPlayNormalGame,
    standalone: !!opts.tutorialSection,
    onTutorialSection: opts.onTutorialSection ? (id) => { saveNow(); opts.onTutorialSection?.(id); } : undefined,
    onOutcome: opts.tutorialSection ? () => opts.onTutorialExit?.() : undefined,
    mapRect: (target) => {
      if (target.kind === "screen") return null;
      const lessonStep = guide?.controller.view().step;
      if (opts.tutorialSection === "rivals" && lessonStep?.id === "challenge"
        && target.kind === "anchor" && target.what === "industry") {
        const ind = grid.industries[0];
        return ind ? guideTileRect({ x0: ind.tx, y0: ind.ty,
          x1: ind.tx + ind.w - 1, y1: ind.ty + ind.h - 1 }) : null;
      }
      if (lessonSites && lessonStep?.complete.kind === "build") {
        const site = lessonStep.complete.what === "factory" ? lessonSites.factory
          : lessonStep.complete.what === "depot" ? lessonSites.depot : null;
        // Highlight the origin tile, not the entire footprint: only its
        // corner click places the building at the scripted legal site.
        if (site && target.kind === "anchor") return guideTileRect({
          x0: site.tx, y0: site.ty, x1: site.tx, y1: site.ty,
        });
      }
      const box = target.kind === "area" ? target
        // A UI or full-screen target has no place on the map; the spotlight
        // finds it by its selector instead, and this seam answers "nothing".
        : target.kind === "ui" ? null
        : guideAnchorBox(target);
      return box ? guideTileRect(box) : null;
    },
    already: (sectionId, stepId) => {
      const k = `${sectionId}:${stepId}`;
      const mine = me.i + 1;
      const hasFactory = eco.factories.some((f) => f.ownerId === mine);
      const hasDepot = eco.harvesters.some((h) => h.ownerId === mine);
      if (opts.tutorialSection) return false;
      if (k === "factory:place" || k === "factory:rotate") return hasFactory;
      if (k === "depots:place") return hasDepot;
      if (k === "logistics:connect" || k === "logistics:income") return voicedIncome;
      return false;
    },
    assist: (a) => {
      // Every assist goes through a door the player already has: the tool
      // BUTTON (not the internal arming), the drawer tab, the phone sheet.
      if (a.kind === "tool") {
        ui.el.querySelector<HTMLButtonElement>(`[data-tool="${a.tool}"]`)?.click();
      } else if (a.kind === "tab") ui.setTab(a.tab);
      else if (a.kind === "sheet") ui.setMobileView(a.view);
      else if (a.kind === "recenter") recenterCamera();
    },
  });
  // A section picked on the FRONT menu's Tutorial door waits for this boot.
  const queuedGuide = takeQueuedSection();
  if (opts.tutorialSection) guide.run(opts.tutorialSection);
  else if (queuedGuide) guide.run(queuedGuide);
  /**
   * True while a guide step is standing. The only two things that still bow
   * to it are the boot toasts (a save or loop announcement must not be
   * shouted over a caption) and the tool-cancel key — the guide never blocks
   * the game, the clock or the map.
   */
  const guideRunning = (): boolean => guide?.controller.view().running === true;

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
  ], {
    // CAST-1: the poster stays up 3 s on a real boot; the unit suites (which
    // pump a handful of frames on real timers) keep the old instant lift.
    minShowMs: import.meta.env.MODE === "test" ? 0 : MIN_SHOW_MS,
  });
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

  // TUT-03 (#422) + AI-02: the boot prompts, in the order a new player meets
  // them. A CONTRACT's briefing stands first (STORY-01), then the difficulty
  // chooser — a much smaller question than "how does this game work", which is
  // why the guide no longer stands in this chain at all: it is a caption over
  // a LIVE game, it starts itself once the boot is done, and nothing waits on
  // it. The first game runs "Getting started" and nothing else; every other
  // section is one click away in the Tutorial menu.
  //
  // The chain is gated the same way AI-03 settled it: a saved game means no
  // prompt and no fresh map — the save carries the pick, and refresh resumes
  // exactly where it left off ("a refresh restarts the game" — not any more;
  // Restart starts over). A networked seat skips it too: that match is already
  // live and the host is waiting. (`bootSave` was read up top, before the map
  // generated, so the seed the save carries is the seed the map was grown
  // from.) A dismissed guide never restarts itself — `guide.runFirstGame()`
  // reads the record (src/iso/guide/progress.ts) and stays quiet.
  if (!bootSave && isSolo()) {
    void (async () => {
      // STORY-01: a contract opens with its briefing — the rival's face, the
      // bookkeeper's terms — before any onboarding, because "who am I and who
      // is that" precedes "what button is this". Skippable like every other
      // reel; a skip is a choice, not a fault. Then the guide (if it is still
      // welcome) and the difficulty prompt — which a contract does not ask,
      // the chapter having already cast the rival at a fixed difficulty.
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
      } else if (scenarioDef) {
        // SCEN-2 (#602): a scenario briefs in the NEW UI — the Feed, the one
        // message channel HUD-1 (#469) left standing, beside the objective
        // line the advisor's lane already paints (see `paintUi`). There is no
        // reel to sit through: a scenario has no cast scenes, and its terms
        // are three short lines the player can read while the map loads.
        ui.feed(`${scenarioDef.name} — ${scenarioDef.tagline}`, "Scenario");
        ui.feed(scenarioDef.brief, "Scenario");
        ui.feed(`Objective: ${scenarioDef.objective.text}`, "Scenario");
      }
      // TUT-03 (#422): the card tour is gone. The guide never BLOCKS the boot
      // chain — it is a caption over a live game, so the difficulty prompt and
      // the loading screen no longer wait on a modal a player has to read.
      // The game may have been torn down while a reel was up (a test's
      // dispose, a rematch); the rest of this chain belongs to a live boot.
      if (disposed) return;
      // AI-02: ask for the difficulty before the first click (only when no
      // previous choice exists — see skill-picker.ts). The overlay sits over
      // the freshly booted UI; the pick flips the LIVE game straight into
      // `setRivalSkill`, persists for the next boot, and syncs the top-bar
      // selector the `onSkill` hook would otherwise own. A contract skips the
      // question: the chapter cast the rival, and re-asking would un-cast it.
      // SCEN-2 (#602): a scenario casts its rival the same way (PROG-1's "the
      // scenario IS the pacing"), and on the new loop the answer would not stop
      // at the rival — the difficulty IS the economy's row
      // (`difficultyRulesFor`), so a stray pick would re-tune the very map the
      // scenario was built around.
      if (opts.tutorialSection) {
        // A lesson has its own setup and no difficulty prompt or first-game chain.
      } else if (starterIsland && newLoop) {
        // FTUE-1 (#464): the Starter Island — no difficulty question (the
        // rival is CAST as the trainee, above, and never persisted), and the
        // guide takes over with its whole chain (Getting started → Factory →
        // Depots → Logistics → Upgrades), pointed at the real controls,
        // voiced, and dismissible at any moment. It never blocks the clock:
        // the player reads it while the island runs.
        guide?.runFirstGame();
      } else if (!storyChapter && !scenarioDef) {
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
      noteTuningStars();
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
    noteTuningStars();
  };
  // MATCH-2 (#566) — the star moment. Crossing ★★★★ mid-session rings a
  // flourish over the board; crossing ★★★★★ is the Legendary finale: the
  // cascades still in the air play at a quarter speed and ease back (the
  // board divides every wait by this clock), the board pushes in and bursts,
  // and the Ode to Joy plays over it. The session's results wait for it to
  // land (`quarryTick`). Reduced motion keeps the music and the banner and
  // drops the slow-mo and the push; the performance preset drops the slow-mo.
  const finale = new FinaleController({
    onStart: (plan) => ui.boardFinale(plan.stars, plan.durationMs),
    onFlourish: (cue) => { playMatch3Cue(cue); },
    onMusic: (cue) => { playMatch3Cue(cue); },
  });
  /** The highest rating this session has already celebrated. */
  let finaleStars = 0;
  quarry.board.timeScale = () => finale.timeScale();
  function noteTuningStars(): void {
    if (!tuning || tuningResult) return;
    const stars = tuningStarsFor(tuning.score);
    if (stars < 4 || stars <= finaleStars) return;
    finaleStars = stars;
    finale.trigger(stars, {
      reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
      perfMode: renderer?.performanceMode ?? false,
    });
  }
  /** A Legendary finale is still playing: the session's results wait for it. */
  const finaleHolds = (): boolean => finale.active && finale.plan?.stars === 5;
  /** A new session starts un-celebrated (and the last one's music is over). */
  function resetFinale(): void {
    finale.reset();
    finaleStars = 0;
    stopFinaleMusic();
  }
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
    // E3 (#269): a float/label over a raised tile must rise with it. Lift the
    // anchor by the surface height of the tile under it (sampled at the tile
    // centre, never a shared corner). Flat map → lift 0, position unchanged.
    const lift = elevationActive(grid)
      ? tileSurfaceHeight(grid, Math.floor(tx), Math.floor(ty)) * LEVEL_PX
      : 0;
    return [x / d, (y - lift) / d];
  };
  // ── TUT-03 (#422): the guide's map maths ────────────────────────────────
  // The camera is in device pixels; the DOM is in CSS pixels. Everything the
  // guide points at on the map goes through here, once a frame, so a pan, a
  // zoom or a raised tile moves the spotlight with the thing it names.
  type GuideBox = { x0: number; y0: number; x1: number; y1: number };
  const guideTileRect = (box: GuideBox): { x: number; y: number; w: number; h: number } | null => {
    const d = dpr();
    const host = ui.mapHost.getBoundingClientRect();
    const hw = (HW * cam.zoom) / d;
    const hh = (HH * cam.zoom) / d;
    const [, ty] = tileToScreenAt(cam, box.x0, box.y0);     // the top vertex
    const [, by] = tileToScreenAt(cam, box.x1, box.y1);     // the bottom tile
    const [lx] = tileToScreenAt(cam, box.x0, box.y1);       // the left flank
    const [rx] = tileToScreenAt(cam, box.x1, box.y0);       // the right flank
    const left = (lx - hw) / d;
    const top = (ty - hh) / d;
    const right = (rx + hw) / d;
    const bottom = (by + 2 * hh) / d;
    if (right - left < 4 || bottom - top < 4) return null;
    return { x: host.left + left, y: host.top + top, w: right - left, h: bottom - top };
  };
  /**
   * A LIVE anchor: the town you build beside, the industry your first Depot
   * serves, your own factory. Resolved against the game state every frame, so
   * the guide points at the thing this seed actually grew.
   */
  const guideAnchorBox = (
    t: { kind: "tile"; tx: number; ty: number } | { kind: "anchor"; what: GuideAnchor },
  ): GuideBox | null => {
    if (t.kind === "tile") return { x0: t.tx, y0: t.ty, x1: t.tx, y1: t.ty };
    const mine = eco.factories.find((f) => f.owner === "you") ?? null;
    const dist = (tx: number, ty: number): number => {
      if (!mine) return 0;
      return Math.abs(tx - mine.tx) + Math.abs(ty - mine.ty);
    };
    const nearest = <T extends { tx: number; ty: number }>(rows: readonly T[]): T | null =>
      rows.reduce<T | null>((best, r) => (!best || dist(r.tx, r.ty) < dist(best.tx, best.ty) ? r : best), null);
    if (t.what === "factory") {
      return mine ? { x0: mine.tx, y0: mine.ty, x1: mine.tx, y1: mine.ty } : null;
    }
    if (t.what === "depot") {
      const d = eco.harvesters.find((h) => h.owner === "you");
      return d ? { x0: d.tx, y0: d.ty, x1: d.tx, y1: d.ty } : null;
    }
    if (t.what === "town") {
      const town = nearest(grid.towns);
      // A town is a cluster; frame its centre with a tile of margin so the
      // spotlight reads as "here" rather than as one house.
      return town ? { x0: town.tx - 1, y0: town.ty - 1, x1: town.tx + 1, y1: town.ty + 1 } : null;
    }
    if (t.what === "industry") {
      const ind = nearest(grid.industries);
      return ind ? { x0: ind.tx, y0: ind.ty, x1: ind.tx + ind.w - 1, y1: ind.ty + ind.h - 1 } : null;
    }
    const c = Math.floor(MAP_W / 2);
    return { x0: c - 2, y0: c - 2, x1: c + 2, y1: c + 2 };
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
    // E4 (#268): the plant's footprint has to sit on one level.
    "not-flat": "Needs flat ground",
    "no-town": "Plant must touch a town",
  };
  const TRACK_FLASH_TEXT: Record<string, string> = {
    "out-of-bounds": "Off the map",
    water: "Can't build on water",
    occupied: "Tile is occupied",
    field: "Demolish the field first",
    rough: "Road can't cross rough — use Dirt",
    "not-adjacent": "Drag out from your Factory / Depot",
    // E4 (#268): the road's slope rule — one level per tile.
    "too-steep": "Too steep — one level per tile",
    // R2 (#266): a bridge is straight, so a spur beside a deck is refused —
    // and this is the tile the drag stopped on.
    "bridge-junction": "No junctions on a bridge",
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
  // Terrain-GL (opt-in, docs/TERRAIN_GL.md): the WebGL2 ground mounts under
  // the 2D stack; null = no WebGL2 / not asked for, and the 2D ground stays.
  const terrainGl: TerrainGl | null = terrainGlWanted() ? mountTerrainGl(ui.mapHost, grid, seed) : null;
  // LIVE-3D spike: `?three=1` mounts the instanced 3D building layer under the overlay canvas.
  // LIVE-3D: the railway structures the 3D layer draws (platform and train depot art, any view)
  let lastThreeItems: { sprite: string; tx: number; ty: number; w: number; h: number; lift: number }[] = [];   // __iso.threeItems
  const RAIL_3D = /^(platform|train-depot)_(ne|se|sw|nw)$/;
  const threeLayer: ThreeLayer | null = threeWanted() ? mountThreeLayer(ui.mapHost, canvases.overlay) : null;
  // ROT-UI-1: the rotate keys under the minimap exist only where the view can
  // actually turn — three-layer.ts's one predicate (false without ?three=1, and
  // false when the WebGL layer failed to mount).
  ui.setRotationAvailable(rotationAvailable());
  // terrain elevation in px at a ground point, for the 3D vehicles (depth.ts E3: moving sprites read the surface at their tile centre)
  const threeLift = (u: number, v: number): number => (elevationActive(grid) ? surfaceHeight(grid, u, v) * LEVEL_PX : 0);
  if (threeLayer) {
    setHideExtra((e) => {
      const k = (e.ref as { kind?: string } | undefined)?.kind;
      return (k === "town" || k === "harvester" || k === "factory" || (k === "rail" && RAIL_3D.test(e.sprite))) && threeLayer.drawsSprite(e.sprite);
    });
    // the 2D sprites a ready 3D model replaces disappear as models land: re-sync once they do
    threeLayer.onModels = () => syncWorld();
    setHideVehicle((e) => threeLayer.drawsVehicle(e.sprite));
  }
  const stage = ui.mapHost;
  // GFX-01: the tilt-shift composite. It mounts its own canvas above the
  // three layers and stays `display: none` until the setting says otherwise,
  // so at the default (off) it costs one early return in the frame loop.
  const mini = createTiltShiftPass(canvases, stage);

  const world: World = {
    grid,
    roadBits: drawBits(track, "road"),
    dirtBits: drawBits(track, "dirt"),
    roadTiers: track.tier,
    // #440: the painter draws the road rule the simulation builds under.
    diagonalRoads: track.diagonalRoads,
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
    // FTUE-1 (#464): every Starter Island boot opens this way (first launch,
    // replay, resume) — the town is the scenario's heart.
    if ((starterIsland || opts.tutorialSection) && ind && grid.towns.length) {
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
    // SFX-1 (#463): the island listens to the camera too — see probeAmbience.
    probeAmbience();
  }

  /**
   * SFX-1 (#463): feed the ambience its probe — the zoom plus what the
   * camera's centre tile sits near (water within earshot? a town?). Called
   * from every camera commit and, because a town can grow under a still
   * camera (and the first gesture arms the engine after the last commit),
   * from the frame loop at ~2 Hz. A few hundred array reads; the ambience
   * itself folds re-probes closer than 250 ms into one glide.
   */
  function probeAmbience(): void {
    try {
      if (!grid || !grid.terrain) return;
      const [cx, cy] = screenToTileAt(cam, cam.vw / 2, cam.vh / 2);
      // Earshot, in tiles: the coast carries further than a town's murmur.
      const COAST_R = 10, TOWN_R = 9;
      let nearCoast = false;
      const x0 = Math.max(0, cx - COAST_R), x1 = Math.min(grid.w - 1, cx + COAST_R);
      const y0 = Math.max(0, cy - COAST_R), y1 = Math.min(grid.h - 1, cy + COAST_R);
      for (let y = y0; y <= y1 && !nearCoast; y++) {
        for (let x = x0; x <= x1; x++) {
          if (grid.terrain[tIdx(x, y)] === WATER) { nearCoast = true; break; }
        }
      }
      let nearTown = false;
      for (const town of grid.towns) {
        const pts: readonly (readonly [number, number])[] =
          town.houses.length > 0 ? town.houses : [[town.tx, town.ty]];
        for (const [hx, hy] of pts) {
          if (Math.abs(hx - cx) + Math.abs(hy - cy) <= TOWN_R) { nearTown = true; break; }
        }
        if (nearTown) break;
      }
      ambience.setProbe({ zoom: cam.zoom, nearCoast, nearTown });
    } catch { /* garnish */ }
  }

  /**
   * BATTLE-1 (#468): the camera FLIES to a tile — an ease-out pan, a breath
   * long, so a battle's aftermath lands the eye on the site it settled.
   * `prefers-reduced-motion: reduce` skips the pan (the tile centres at once,
   * the same end state); a pointer-down cancels it mid-flight, because the
   * player's hand outranks the choreography.
   */
  let flyRaf = 0;
  /**
   * Owner bug (2026-09-29): "on your very first zoom the camera jumps north".
   * A running fly-to or ease-back keeps writing x/y toward a target computed
   * at the OLD zoom, so a wheel/key zoom mid-flight lands somewhere else. Any
   * zoom is the player's hand: it stops both animations first.
   */
  function stopCameraMotion(): void {
    window.cancelAnimationFrame(flyRaf);
    cameraAnim = null;
  }
  function flyCameraTo(tx: number, ty: number, ms = 750): void {
    let reduced = false;
    try { reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch { reduced = false; }
    if (reduced) { commitCamera(centerOnTile(cam, tx, ty)); return; }
    window.cancelAnimationFrame(flyRaf);
    const fromX = cam.x, fromY = cam.y;
    const target = centerOnTile(cam, tx, ty);
    const t0 = performance.now();
    const stop = () => window.cancelAnimationFrame(flyRaf);
    window.addEventListener("pointerdown", stop, { once: true, capture: true });
    const step = (t: number) => {
      const k = Math.max(0, Math.min(1, (t - t0) / ms));
      const e = 1 - Math.pow(1 - k, 3);
      commitCamera({ ...cam, x: fromX + (target.x - fromX) * e, y: fromY + (target.y - fromY) * e });
      if (k < 1) flyRaf = window.requestAnimationFrame(step);
      else window.removeEventListener("pointerdown", stop, { capture: true });
    };
    flyRaf = window.requestAnimationFrame(step);
  }

  // #461 TUNE-1: camera easing back to Depot after a session, and payoff tracking.
  let cameraAnim: { sx: number; sy: number; tx: number; ty: number; t0: number; dur: number } | null = null;
  const recentTunePayoff = new Map<number, { until: number; deltaPct: number; yield: number }>();
  const CAMERA_EASE_DUR = 700;

  const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3);

  function easeCameraToTile(tx: number, ty: number, now = performance.now()): void {
    try {
      const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) {
        const [wx, wy] = tileToScreen(tx, ty);
        commitCamera(centerOnWorld(cam, wx, wy));
        return;
      }
      const [wx, wy] = tileToScreen(tx, ty);
      const target = centerOnWorld(cam, wx, wy);
      cameraAnim = { sx: cam.x, sy: cam.y, tx: target.x, ty: target.y, t0: now, dur: CAMERA_EASE_DUR };
    } catch {}
  }

  function tickCameraAnim(now: number): void {
    if (!cameraAnim) return;
    const p = Math.min(1, (now - cameraAnim.t0) / cameraAnim.dur);
    if (p >= 1) {
      commitCamera({ ...cam, x: cameraAnim.tx, y: cameraAnim.ty });
      cameraAnim = null;
      return;
    }
    const e = easeOutCubic(p);
    const nx = cameraAnim.sx + (cameraAnim.tx - cameraAnim.sx) * e;
    const ny = cameraAnim.sy + (cameraAnim.ty - cameraAnim.sy) * e;
    commitCamera({ ...cam, x: nx, y: ny });
  }

  // M2 (#256): active protests on public roads
  const protests = new Map<number, Protest>();

  // M1 (#254): the minimap — its own module (src/iso/minimap.ts) on the HUD's
  // plate. It reads the world by reference and redraws each layer only when
  // its key moves (terrain: this map; network: netVersion + rail.revision;
  // view: the camera), and it moves the camera through `commitCamera`, like
  // every other camera write. #256 hangs its sabotage markers on
  // `minimap.setMarkers` / `minimap.onMarker` / `minimap.goTo`.
  const minimap = createMinimap(ui.minimapHost, {
    ground: { terrain: grid.terrain, trees: scenery.trees, forests: scenery.forests },
    camera: () => cam,
    commit: (next) => commitCamera(next),
    scene: () => minimapSceneOf({
      grid, track, eco, rail,
      drawRail: world.rail, fields: world.fields, cleared: world.sceneryBlocked,
    }),
    // Seat colours by owner id — the same blue/red split the depots wear.
    ownerColour: (id) => players[id - 1]?.colour,
  });

  // MUSIC-1 (#377): the mini radio, in the HUD's top-right dock. The widget
  // owns the pill; `radio` (the singleton the settings sheet also drives) owns
  // the element, the settings and the retry schedule. One line of wiring here
  // is the whole voice↔music contract: duck while a line speaks, restore after.
  const radioWidget: RadioWidget = mountRadioWidget(ui.radioHost, radio);
  const offVoiceDuck = onVoiceLine((line) => {
    try { radio.duck(line !== null); } catch { /* garnish */ }
    // SFX-1 (#463): the island ducks under a spoken line exactly like the radio.
    try { ambience.duck(line !== null); } catch { /* garnish */ }
  });

  // M2 (#256): Sabotage Event Window — opens on clicking a sabotage marker on the minimap
  const sabotageWindow = createSabotageEventWindow({
    host: ui.el,
    onGoTo: (tx, ty) => minimap.goTo(tx, ty),
    resolvePlayerName: (id) => {
      if (id === me.id || id === "you") return "You";
      const p = players.find((pl) => pl.id === id);
      return p?.name ?? (id === rival.id || id === "ai" ? "Rival" : id);
    },
  });

  minimap.onMarker = (marker) => {
    // B7 (#252): a contested site's dot opens that site's card
    const contest = /^contest:(ind|town):(\d+)$/.exec(marker.id);
    if (contest) {
      const id = Number(contest[2]);
      if (contest[1] === "ind") { const ind = grid.industries[id]; if (ind) showIndustryCard(ind); }
      else { const tw = grid.towns[id]; if (tw) showTownCard(tw); }
      return;
    }
    const now = performance.now();
    const source = {
      protests: protests.values(),
      industries: grid.industries,
      players,
      now,
    };
    const events = collectSabotageEvents(source);
    const ev = events.find((e) => e.id === marker.id);
    if (ev) {
      sabotageWindow.open(ev);
    }
  };

  /** C5: the atlas instance lives in the async boot; the debug console reads it here. */
  let atlasRef: Atlas | null = null;
  let hover: { tx: number; ty: number; ref: unknown } | null = null;
  let drag: { ax: number; ay: number; bx: number; by: number; xFirst: boolean } | null = null;
  let preview: DragPreview | null = null;
  // #456: the Level Ground drag's plan — the same "one preview seam" the
  // track tools have (`preview` is a DragPreview; this is its Level twin).
  let levelPlan: LevelPlan | null = null;

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
  // RADIO-2: a dead stream skips to the next station and says so. The hook
  // outlives the widget (the radio keeps playing across a quit) until dispose.
  radio.setNotice((text) => toast(text, "info"));

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

  // BAL-1 (#471) — phase beats. The Feed names the arc as the ★ LEADER
  // crosses each share of the line ("Mid-game: tenders open", "Final stretch:
  // X★ to win") — once per beat, whichever seat is ahead. Pure rule in
  // `phases.ts`; this is only the Feed and the seen-set.
  const seenPhaseBeats = new Set<PhaseBeatId>();
  function phaseTick() {
    if (phase !== "play") return;
    for (;;) {
      const beat = phaseBeatFor(vpFor(score, me.id), vpFor(score, rival.id), winTarget(), seenPhaseBeats);
      if (!beat) break;
      seenPhaseBeats.add(beat.id);
      ui.feed(beat.text(winTarget()));
    }
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
    // VO-1: the match is decided once. The portrait answers, then the rival.
    if (winner.id === me.id) {
      voiceCue("player:win");
      voiceCue("rival:you-won");
    } else {
      voiceCue("player:lose");
      voiceCue("rival:you-lost");
    }
    // #164: the match is decided — whatever "match in progress" memo the
    // front door wrote for this seat is now a lie, and only the layer that
    // wrote it can drop it. FTUE-1 (#464): `won` says whose ledger this is —
    // the Starter Island marks onboarding done on a win.
    opts.onMatchEnded?.(winner.id === me.id);
    // CAST-1: file the result with the manager unlocks (earned by PLAY only —
    // the Starter Island tutorial never counts). A win that hires someone
    // says so on the ledger: "New manager unlocked!".
    const hired: ManagerId[] = endingRecordable
      ? recordManagerMatch({
        won: winner.id === me.id,
        skill: isSolo() ? skillKey : null,
        multiplayer: !isSolo() && !aiOpponent,
        scenario: scenarioOn,
        tutorial: starterIsland,
      })
      : [];
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
    // END-1 (#472): finalize history and build summary
    try { finalizeHistory(matchHistory, performance.now()); } catch {}
    let summary = null as ReturnType<typeof buildSummary> | null;
    try { summary = buildSummary(matchHistory); } catch {}

    const openLedger = () => {
      endingView = showEndingScreen(ui.el, model, {
        playerPortrait: portrait,
        rivalPortrait: storyChapter ? (CAST[rivalCast].solo ?? faceOf(rivalCast, "calm").url) : RIVAL.thumb,
        unlocked: hired,
        // RANK-01: `undefined` when this match is not rated at all (no row),
        // `null` while a rated match waits on the room's verdict (the row
        // prints "filing…"), and the line itself once it has landed.
        rank: rankRuntime ? (rankVerdict ? rankLineFor(rankVerdict) : null) : undefined,
        summary,
        // TOWN-3 (#561): the ending's "First to each town tier" line names
        // towns instead of numbering them.
        townNames: grid.towns.map((t) => t.name ?? `Town ${t.id + 1}`),
        onRestart: () => {
          restartArmed = true;
          clearSave(saveKey);
          // FTUE-1 (#464): won the Starter Island? "Build another empire" is
          // the NORMAL game (the real map, a real rival) — the scenario's exit
          // door, the same one the first screen's skip chip opens. A LOSS
          // keeps today's reload: no onboarding flag is set, so the reload
          // runs the island again — "Demand a rematch" means exactly that.
          if (starterIsland && model.outcome === "victory" && opts.onPlayNormalGame) {
            opts.onPlayNormalGame();
            return;
          }
          // Keep the selected difficulty: this is a rematch, not first-run
          // onboarding. The ☰ menu's New Game remains the full reset.
          location.reload();
        },
        onRematch: () => {
          // Same settings, new seed — clear save and reload without seed param
          restartArmed = true;
          clearSave(saveKey);
          try {
            const url = new URL(location.href);
            url.searchParams.delete("seed");
            // Keep map options and other flags, drop seed so a fresh one generates
            history.replaceState(null, "", url.toString());
          } catch {}
          location.reload();
        },
        onSameMap: () => {
          // Same seed — clear save and reload with current seed pinned
          restartArmed = true;
          clearSave(saveKey);
          try {
            const url = new URL(location.href);
            url.searchParams.set("seed", String(seed));
            history.replaceState(null, "", url.toString());
          } catch {}
          location.reload();
        },
        onMainMenu: () => {
          restartArmed = true;
          clearSave(saveKey);
          if (opts.onQuitToMenu) opts.onQuitToMenu();
          else {
            try { location.href = "/"; } catch { location.reload(); }
          }
        },
        // STORY-01: the ledger's third door — back to the campaign menu with
        // the contract recorded, instead of a reload into the same chapter.
        // CONTINUE-01 (#191): the decided contract is cleared first — its
        // result is already recorded, and leaving the finished save behind
        // would make the campaign card offer "Continue" straight back into
        // this ledger instead of a fresh attempt. `restartArmed` stops the
        // teardown's autosave from rewriting the slot we just cleared.
        // PROG-1 (#475): scenario matches get the same door back to their list.
        ...(storyOn || scenarioOn ? {
          onContinue: () => {
            restartArmed = true;
            clearSave(saveKey);
            opts.onStoryExit?.();
          },
          onNextContract: (() => {
            const curIdx = storyChapter ? storyChapter.index : -1;
            const next = curIdx >= 0 ? CHAPTERS[curIdx + 1] : null;
            if (!next) return undefined;
            return () => {
              restartArmed = true;
              clearSave(saveKey);
              try {
                const url = new URL(location.href);
                url.searchParams.set("chapter", next.id);
                url.searchParams.delete("seed");
                history.replaceState(null, "", url.toString());
              } catch {}
              location.reload();
            };
          })(),
        } : {}),
        // PROG-1 (#475): a won contract's straight line into the next one.
        // The win is already recorded (below), so the next contract is open;
        // the finished slot clears exactly as the list door clears it.
        ...(storyOn && model.outcome === "victory" && nextChapter && opts.onNextChapter ? {
          onNextContract: () => {
            restartArmed = true;
            clearSave(saveKey);
            opts.onNextChapter?.(nextChapter.id);
          },
        } : {}),
      });
      // LIGHT-1: night blue on the ending card. The card text is not recoloured.
      // Always-day, performance mode and reduced motion leave the ledger as it was.
      if (endingView && endingNightActive({ performance: currentGraphics().performance, reducedMotion })) {
        endingView.element.classList.add(ENDING_NIGHT_CLASS);
      }
    };
    // STORY-01: the epilogue stands BEFORE the ledger — the rival concedes (or
    // gloats) in person, Mabel closes the book, and only then does the match
    // show its arithmetic. The result is recorded first: a refresh mid-reel
    // must not lose the contract.
    if (storyChapter) {
      const won = winner.id === me.id;
      // PROG-1 (#475): the win carries its margin and time for the chapter
      // list's best-results line — floored exactly as the HUD prints them.
      recordChapterResult(storyChapter.id, storyChapter.index, won, CHAPTERS.length,
        undefined, undefined, {
          margin: Math.floor(vpFor(score, me.id)) - Math.floor(vpFor(score, rival.id)),
          timeMs: Date.now() - matchWallStart,
        });
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
    } else if (scenarioDef) {
      // PROG-1 (#475): the scenario is filed before the ledger stands — a
      // refresh mid-ledger must not lose the win. No epilogue scenes: the
      // Feed seals it, the list shows it.
      const won = winner.id === me.id;
      recordScenarioResult(scenarioDef.id, scenarioDef.index, won, {
        margin: Math.floor(vpFor(score, me.id)) - Math.floor(vpFor(score, rival.id)),
        timeMs: Date.now() - matchWallStart,
      });
      if (won) ui.feed(`Scenario filed: ${scenarioDef.name}`, "Scenario");
      openLedger();
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
  // CONTRACT-1 (#466) — town contracts replace Quests — deliveries with
  // deadlines, and a public tender both seats race.
  //
  // Old L8 (#222) quests were suggestions with small cargo rewards. Contracts
  // give direction, use the market, and create head-to-head moments:
  //   • 3 at a time: 2 private, 1 public tender that both seats race;
  //   • delivery counted from cargo actually arriving at the seat's Factory
  //     for that town, after acceptance;
  //   • failing a private contract costs nothing but time;
  //   • generation deterministic from seed and state, scaled by difficulty
  //     and match phase;
  //   • the rival accepts tenders it can plausibly win (RIVAL-3 telegraphs it).
  // ══════════════════════════════════════════════════════════════════════════

  /** Legacy quest compat — kept for old saves, but no longer used for offers. */
  const questSpeakerFor = (def: QuestDef): QuestSpeaker => speakerFor(def.strategy, storyOn);
  const questSpeakerName = (speaker: QuestSpeaker): string =>
    speakerName(speaker, storyOn ? CAST[rivalCast].name : null);
  function questViewNow(): QuestView {
    const locks = industryLocks(eco);
    const unclaimed: Partial<Record<Cargo, number>> = {};
    for (const ind of grid.industries) {
      if (locks.has(ind.id)) continue;
      const idef = INDUSTRY_BY_KEY[ind.type];
      if (!idef) continue;
      unclaimed[idef.cargo] = (unclaimed[idef.cargo] ?? 0) + 1;
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

  // ── contract view ───────────────────────────────────────────────────────
  function contractViewNow(): ContractView {
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
    const vpNow = vpFor(score, "you");
    const target = winTarget();
    const phase = target > 0 ? Math.min(1, vpNow / target) : 0;
    const townsForView = grid.towns.map((t) => ({
      id: t.id,
      name: t.name ?? `Town ${t.id + 1}`,
      tx: t.tx,
      ty: t.ty,
    }));
    const depotCargoes = eco.harvesters
      .filter((h) => h.owner === me.id || h.owner === rival.id)
      .map((h) => ({
        cargo: depotCargo(eco, h) ?? "grain" as Cargo,
        connected: isServiced(eco.track, h, eco.rail),
      }));
    return {
      seed,
      towns: townsForView,
      cargoesRunning: cargosOf(me.id, true),
      depotCount: mine.length,
      connected,
      townLevel: me.townLevel,
      townLevels: TOWN_UPGRADES.length,
      difficulty: skillKey as ContractView["difficulty"],
      phase,
      money: me.money ?? 0,
      rivalCargoes: cargosOf(rival.id, true),
      depotCargoes,
    };
  }

  // ── contract state ──────────────────────────────────────────────────────
  let contractOffersList: ContractDef[] = [];
  let activeContracts: ActiveContract[] = [];
  const contractSpent = new Set<string>();
  const contractPaid = new Set<string>();
  let contractsHidden = false;
  const contractRng = mulberry32((seed ^ 0x5f3759df) >>> 0);
  let contractPendingOffers: string[] | null = null;
  let contractWorld: string | null = null;
  let contractPendingActive: ActiveContract[] | null = null;

  // legacy quest vars kept for save compat
  let quests: QuestDef[] = [];
  const questSpent = new Set<string>();
  const questPaid = new Set<string>();
  let questsHidden = false;

  function payQuest(def: QuestDef): boolean {
    if (questPaid.has(def.id)) return false;
    questPaid.add(def.id);
    questSpent.add(def.id);
    const rw = questReward(def);
    earn(me, rw.purse);
    const speaker = questSpeakerFor(def);
    toast(`Quest complete — ${questSpeakerName(speaker)}: +${rw.label}`, "good");
    quests = quests.filter((q) => q.id !== def.id);
    try {
      const t = (performance.now() - matchHistory.startMs) / 1000;
      recordEvent(matchHistory, { kind: "quest", seat: 0, questId: def.id, t });
    } catch {}
    return true;
  }

  // ── contract pay ────────────────────────────────────────────────────────
  function payContract(active: ActiveContract): boolean {
    if (contractPaid.has(active.def.id + ":" + active.owner)) return false;
    // For tender, only first deliverer pays; others already marked lost
    if (active.status !== "completed") return false;
    contractPaid.add(active.def.id + ":" + active.owner);
    contractSpent.add(active.def.id);
    const seat = active.owner === 0 ? me : rival;
    // $ reward
    const money = active.def.rewardMoney;
    seat.money = (seat.money ?? 0) + money;
    // Town-growth progress: for now, give a small townBonus bump and feed line
    if (active.def.rewardTown > 0 && seat.townLevel < TOWN_UPGRADES.length) {
      // We don't auto-upgrade town, but we give a bonus that the town growth moment can use
      // For simplicity, add to townBonus (which multiplies income)
      seat.townBonus = (seat.townBonus ?? 0) + active.def.rewardTown * 0.1;
    }
    const whoName = active.owner === 0 ? me.name : rival.name;
    const speaker = active.def.speaker;
    const who = speakerName(speaker, storyOn ? CAST[rivalCast].name : null);
    const tender = active.def.kind === "tender" ? "Tender won" : "Contract complete";
    if (active.owner === 0) {
      toast(`${tender} — ${who}: +$${money} for ${active.def.amount} ${CARGO[active.def.cargo].name} to ${active.def.townName}`, "good");
      ui.feed(`${whoName} completed ${active.def.kind} contract: ${active.def.amount} ${CARGO[active.def.cargo].name} to ${active.def.townName} (+$${money})`, whoName);
    } else {
      // Rival won a tender — Feed and bark
      ui.feed(`${whoName} wins tender: ${active.def.amount} ${CARGO[active.def.cargo].name} to ${active.def.townName} (+$${money})`, whoName);
      // Rival bark via rivalry.ts if available
      try {
        const bark = active.def.kind === "tender"
          ? `Tender ${active.def.townName} is mine. First to deliver takes it — and I delivered.`
          : `${active.def.townName} contract done. My line runs.`;
        ui.feed(`${rival.name}: ${bark}`, rival.name);
      } catch {}
    }
    try {
      const t = (performance.now() - matchHistory.startMs) / 1000;
      recordEvent(matchHistory, { kind: "quest", seat: active.owner as 0 | 1, questId: active.def.id, t });
    } catch {}
    // Remove from active list
    activeContracts = activeContracts.filter((a) => !(a.def.id === active.def.id && a.owner === active.owner));
    return true;
  }

  function addDeliveryToContracts(seatIdx: 0 | 1, cargo: Cargo, amount: number, now: number): void {
    let changed = false;
    activeContracts = activeContracts.map((a) => {
      if (a.owner !== seatIdx) return a;
      if (a.status !== "active") return a;
      if (a.def.cargo !== cargo) return a;
      if (now > a.expiresAt) return a;
      const next = addContractDelivery(a, cargo, amount);
      if (next.status === "completed") changed = true;
      return next;
    });
    if (changed) {
      // Resolve tender race: if a tender completed, mark losers
      const res = resolveTenderRace(activeContracts, now);
      if (res.winner) {
        activeContracts = res.actives;
        // Pay winner immediately
        payContract(res.winner);
        // Losers get feed
        for (const loser of res.losers) {
          if (loser.owner === 0) {
            toast(`Tender lost — ${loser.def.townName} taken by ${rival.name}`, "bad");
            ui.feed(`Tender ${loser.def.townName} lost to ${rival.name}`, me.name);
          }
        }
        // Refresh offers after a tender resolves
        contractWorld = null;
      } else {
        // Check private completions
        for (const a of [...activeContracts]) {
          if (a.status === "completed") payContract(a);
        }
      }
    }
  }

  function syncQuests(): void {
    syncContracts();
  }

  function syncContracts(): void {
    if (!newLoop || phase !== "play") {
      if (contractOffersList.length) contractOffersList = [];
      if (activeContracts.length) activeContracts = [];
      return;
    }
    // Guests don't generate; they mirror host via wire (see applyNetSnapshot/delta)
    if (isGuest()) {
      // Still need to handle expiry for guest's own view of its active contracts
      const now = performance.now();
      let expired = false;
      activeContracts = activeContracts.map((a) => {
        if (a.status === "active" && now >= a.expiresAt) {
          expired = true;
          return { ...a, status: "expired" as const };
        }
        return a;
      });
      if (expired) {
        activeContracts = activeContracts.filter((a) => a.status !== "expired");
        contractWorld = null;
      }
      return;
    }

    const view = contractViewNow();
    const now = performance.now();

    // Restore from save: offers + active
    if (contractPendingOffers) {
      const pool = contractOffersFor(view, contractRng);
      const byId = new Map(pool.map((q) => [q.id, q]));
      contractOffersList = [
        ...contractOffersList,
        ...contractPendingOffers.map((id) => byId.get(id)).filter((q): q is ContractDef => q !== undefined),
      ];
      contractPendingOffers = null;
    }
    if (contractPendingActive) {
      // Merge saved active contracts (they already have progress)
      for (const saved of contractPendingActive) {
        if (!activeContracts.some((a) => a.def.id === saved.def.id && a.owner === saved.owner)) {
          activeContracts.push(saved);
        }
      }
      contractPendingActive = null;
    }

    // Expiry check for active
    let hadExpiry = false;
    activeContracts = activeContracts.map((a) => {
      if (a.status === "active" && isContractExpired(a, now)) {
        hadExpiry = true;
        if (a.owner === 0 && a.def.kind === "private") {
          toast(`Contract expired — ${a.def.townName} (${a.def.amount} ${CARGO[a.def.cargo].name})`, "info");
          ui.feed(`Contract expired: ${a.def.amount} ${CARGO[a.def.cargo].name} to ${a.def.townName}`, me.name);
        }
        return { ...a, status: "expired" as const };
      }
      return a;
    });
    if (hadExpiry) {
      const before = activeContracts.length;
      activeContracts = activeContracts.filter((a) => a.status !== "expired");
      if (activeContracts.length !== before) contractWorld = null;
    }

    // Pay any completed that haven't been paid yet (delivery counting may have marked completed)
    for (const a of [...activeContracts]) {
      if (a.status === "completed") payContract(a);
    }

    // Rival accepts tenders it can plausibly win
    // Look at available tender offers
    for (const offer of [...contractOffersList]) {
      if (offer.kind !== "tender") continue;
      if (activeContracts.some((a) => a.def.id === offer.id && a.owner === 1)) continue;
      // Rival can win?
      if (!rivalCanWinTender(view, offer)) continue;
      // 70% chance to accept if plausible, scaled by difficulty
      const chance = skillKey === "hard" ? 0.9 : skillKey === "normal" ? 0.7 : 0.4;
      if (contractRng() < chance) {
        // Accept for rival
        const acceptedAt = now;
        const expiresAt = acceptedAt + offer.deadlineMs;
        activeContracts.push({
          def: offer,
          acceptedAt,
          expiresAt,
          delivered: 0,
          owner: 1,
          status: "active",
        });
        contractOffersList = contractOffersList.filter((o) => o.id !== offer.id);
        ui.feed(`${rival.name} accepts tender: ${offer.amount} ${CARGO[offer.cargo].name} to ${offer.townName}`, rival.name);
        // RIVAL-3 (#467): the acceptance IS the telegraph — a live tender is
        // player intent on every site that serves it (`playerClaimIntents`),
        // so the moment the rival takes this tender, any claim flag it has on
        // a site of this cargo/town starts pulsing "Contested" and the Feed
        // says it (`noteClaimContested`).
      }
    }

    // When to draw again: fill when seat moved or when a contract was paid/expired
    const worldKey = `${view.depotCount}:${view.connected}:${view.cargoesRunning.join(",")}:${view.townLevel}:${me.depotTier}:${activeContracts.length}:${contractOffersList.length}`;
    const first = contractWorld === null;
    const moved = !first && worldKey !== contractWorld;
    contractWorld = worldKey;

    const needOffers = CONTRACT_OFFER_MAX_NEW - contractOffersList.length;
    if (needOffers <= 0) return;
    // START-1 (#604): a real match is in `play` before the first Depot stands.
    // Town contracts are delivery work — with zero Depots there is nothing to
    // carry it, so the panel holds its offers until the FIRST Depot stands
    // and the objective line alone says "build your first Depot". Contracts
    // already dealt (offers on the table, an active delivery) keep running —
    // a seat that LOST its last Depot mid-match keeps its deadlines.
    if (view.depotCount === 0) return;
    if (!(first || moved || hadExpiry)) {
      // Also refill if we have less than max and no active change? For now only on first/moved/expiry
      // But spec says offers refresh when one completes or expires — hadExpiry covers expiry,
      // and payContract sets contractWorld to null, so moved will be true next tick after completion
      if (contractOffersList.length >= CONTRACT_PRIVATE_COUNT) return;
    }
    const avoid = new Set<string>();
    for (const a of activeContracts) {
      avoid.add(`${a.def.cargo}:${a.def.townId}`);
    }
    for (const o of contractOffersList) {
      avoid.add(`${o.cargo}:${o.townId}`);
    }
    const pool = contractOffersFor(view, contractRng);
    const next = selectContracts(pool, contractRng, {
      max: needOffers,
      exclude: contractSpent,
      avoidCargoTown: avoid,
    });
    if (next.length) contractOffersList = [...contractOffersList, ...next];
  }

  const questsSave = () => ({
    offers: quests.map((q) => q.id),
    spent: [...questSpent],
    paid: [...questPaid],
    hidden: questsHidden,
  });

  const contractsSave = () => ({
    offers: contractOffersList.map((o) => o.id),
    active: activeContracts.map((a) => ({
      def: {
        id: a.def.id,
        kind: a.def.kind,
        cargo: a.def.cargo,
        amount: a.def.amount,
        townId: a.def.townId,
        townName: a.def.townName,
        rewardMoney: a.def.rewardMoney,
        rewardTown: a.def.rewardTown,
        deadlineMs: a.def.deadlineMs,
        speaker: a.def.speaker,
      },
      acceptedAt: a.acceptedAt,
      expiresAt: a.expiresAt,
      delivered: a.delivered,
      owner: a.owner,
      status: a.status,
    })),
    spent: [...contractSpent],
    paid: [...contractPaid],
    hidden: contractsHidden,
  });

  function questAction(id: string, action: "dismiss" | "hide" | "show"): void {
    if (action === "hide") { questsHidden = true; return; }
    if (action === "show") { questsHidden = false; return; }
    questSpent.add(id);
    quests = quests.filter((q) => q.id !== id);
  }

  function contractAction(id: string, action: "dismiss" | "hide" | "show" | "accept"): void {
    if (action === "hide") { contractsHidden = true; return; }
    if (action === "show") { contractsHidden = false; return; }
    if (action === "accept") {
      const offer = contractOffersList.find((o) => o.id === id);
      if (!offer) return;
      const now = performance.now();
      // Don't allow duplicate cargo+town active for same owner
      if (activeContracts.some((a) => a.owner === 0 && a.def.cargo === offer.cargo && a.def.townId === offer.townId && a.status === "active")) {
        toast(`Already have a contract for ${offer.townName} ${CARGO[offer.cargo].name}`, "info");
        return;
      }
      activeContracts.push({
        def: offer,
        acceptedAt: now,
        expiresAt: now + offer.deadlineMs,
        delivered: 0,
        owner: 0,
        status: "active",
      });
      contractOffersList = contractOffersList.filter((o) => o.id !== id);
      ui.feed(`Accepted ${offer.kind} contract: ${offer.amount} ${CARGO[offer.cargo].name} to ${offer.townName}`, me.name);
      contractWorld = null;
      if (isMp()) publishNet(now, true);
      return;
    }
    // dismiss
    contractSpent.add(id);
    contractOffersList = contractOffersList.filter((o) => o.id !== id);
    activeContracts = activeContracts.filter((a) => !(a.def.id === id && a.owner === 0));
    if (isMp()) publishNet(performance.now(), true);
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

  // ── TOWN-2 (#470): the tier-up moment ────────────────────────────────────
  /**
   * The town draw tiles as the LAST `syncWorld` laid them, per town. Read by
   * `growTownArt` BEFORE it re-syncs, so the lots a tier-up just added are a
   * diff of the town's own draw list rather than a second source of truth for
   * its layout (the layout stays `townBuildings`' alone).
   */
  let townDrawnTiles = new Map<number, Set<string>>();
  /**
   * The seat a running moment belongs to. The Feed line is posted for the
   * LOCAL seat only — the rival's growth already says so at its own call site
   * (L14), and one event should not take two lines — so `growTownArt` sets
   * this just before `start` and the `feed` dep below reads it.
   */
  let growthSeat: PlayerState | null = null;
  /**
   * The construction state the town draw items wear while a tier-up builds
   * out. Created here, above `syncWorld`, because the town block asks it what
   * every lot looks like; every dep is a lazy closure, so nothing below has to
   * exist yet at this point in the boot.
   */
  const growthMoment: GrowthMoment = createGrowthMoment({
    // The atlas decides whether the lead's scaffold / crane / bunting art has
    // landed. A name it does not know falls back to the finished building at a
    // rising alpha — an unknown sprite draws nothing at all (`place` in
    // depth.ts), which would punch holes in a growing district.
    hasArt: (name) => atlasRef?.has(name) ?? false,
    // A stage change re-lays the town through the same door every build uses,
    // and only on a stage change: `tick` compares a key, it never repaints per
    // frame (#417's "no frame-rate drop when a town grows" still holds).
    apply: () => syncWorld(),
    // The camera eases to the town; `flyCameraTo` snaps under reduced motion
    // and cancels on a pointer-down of its own, so this is safe to ask for.
    // CAM-1: the camera moves only for the player's OWN town growth. A rival's
    // tier-up used to fly the view to the rival's town (owner: the camera must
    // never move on anything but the player's own input).
    camera: (tx, ty) => { if (growthSeat?.id === me.id) flyCameraTo(tx, ty); },
    feed: (text) => { if (growthSeat?.id === me.id) ui.feed(text, me.name); },
    // SFX-1 (#463): the tier-up beat — the recorded `city-upgrade` sample,
    // falling back to its synth recipe while the file is missing or loading.
    sound: () => sfx.play("city-upgrade"),
    // The flag/bunting placeholder: a float over the hall while that art is
    // missing, so the beat is visible on a checkout without the PNGs.
    float: (text, tx, ty) => { floats.add(text, tx, ty, { cls: "delivery" }); },
    reducedMotion: () => {
      try {
        return typeof matchMedia === "function"
          && matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch { return false; }
    },
    // "Skippable by any click": a capture-phase pointerdown ANYWHERE ends the
    // sequence on the spot. It never prevents or swallows the click — the tool
    // under the cursor still does its job — and it is armed only while a moment
    // runs, so the map carries no permanent listener for a 3-second beat.
    onSkip: (handler) => {
      const on = (): void => handler();
      window.addEventListener("pointerdown", on, { capture: true });
      return () => window.removeEventListener("pointerdown", on, { capture: true });
    },
  });

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
    // F3: footprint uses rot.
    const blocked = new Set<number>();
    for (const f of eco.factories)
      for (const [x, y] of plantFootprintTiles(f.tx, f.ty, f.rot ?? 0, factoryFp))
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
    // footprint origin. The manifest footprint matches the map's Factory span
    // (both derive from the art), so the anchor lands on the footprint's south
    // corner exactly like any other multi-tile building.
    // F3: art swaps to _r when rotated. F4: shapes maps draw the long
    // `factory_2x4` complex instead of the legacy square one.
    const factoryItems = eco.factories.map((f) => ({
      sprite: factorySpriteFor(shapesOn, f.rot ?? 0),
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
    // #470: the tiles each town draws in THIS sync — the diff `growTownArt`
    // reads to find the lots a tier-up just added.
    const drawnNow = new Map<number, Set<string>>();
    const townItems = grid.towns.flatMap((t) => {
      const tier = newLoop ? townTier(t) : TOWN_TIER_LEGACY;
      // #417: the GROWN tiles are read while `built` still holds only the
      // player's ground, and are marked built only AFTER `townBuildings` has
      // laid the districts. That function derives the very same ring through
      // the same `isBuilt` question — marking the tiles first made its own
      // grownTownHouses call skip every grown tile, so the draw list came
      // back with the base town only (tall centre, empty grass around it).
      const grown = tier >= 2 ? grownTownHouses(t, grid, townGrownRings(tier), isBuilt) : [];
      const laid = townBuildings(t, footprintOf, {
        tier, grid, blocked: isBuilt, shapes: shapesOn,
        // TOWN-2 (#653): organic towns draw from the long-building path and
        // keep their avenue-frontage wedge lots to 1×1 fill.
        organic: organicTowns,
        // MAP-2 (#559): the tree defs arrive with the scenery load, so a lot
        // may only draw one the atlas can actually blit yet.
        spriteKnown: (s) => atlasRef?.has(s) === true,
      });
      const ring = new Set<number>();
      for (const [gx, gy] of grown) {
        const gi = tIdx(gx, gy);
        built.add(gi);
        blocked.add(gi);
        ring.add(gi);
      }
      for (const [x, y] of townObstacleTiles(
        t,
        laid.map((b) => {
          const [w, h] = footprintOf(b.sprite);
          return { tx: b.tx, ty: b.ty, w, h };
        }),
        (x, y) => ring.has(tIdx(x, y)),
      )) townPlantTiles.add(tIdx(x, y));
      drawnNow.set(t.id, new Set(laid.map((b) => `${b.tx},${b.ty}`)));
      return laid.map((b) => {
        // TOWN-2 (#470): a lot this tier-up just added wears its construction
        // look while the moment runs — scaffold, then crane, then finished (or
        // the finished sprite at a rising alpha until that art exists). The
        // item keeps its tile and its town ref, so a district never loses a
        // draw item mid-build and nothing here changes what `townBuildings`
        // decided. Outside a moment `lookFor` is null and this is a pass-through.
        const look = growthMoment.lookFor(t.id, b.tx, b.ty);
        return {
          sprite: look?.sprite ?? b.sprite,
          tx: b.tx, ty: b.ty,
          ref: { kind: "town", id: t.id } as unknown,
          ...(look && look.alpha < 1 ? { alpha: look.alpha } : {}),
        };
      });
    });
    townDrawnTiles = drawnNow;
    townPlantReady = true;
    world.sceneryBlocked = blocked;
    // TOWN-2 (#470): the flag and bunting flourish over the town hall. It is an
    // OVERLAY, not a town draw item — `decor` so picking ignores it (the bank
    // underneath stays clickable while the flags are up), `lift` so it sorts
    // over the hall it hangs on, and a `town-fx` ref so `townDrawItems` and
    // everything else that reads the town's buildings never sees it. Empty
    // while the art is missing (`flourishLookAt` answers null) or no moment is
    // running — the float layer carries the beat until the PNGs land.
    const flourish = growthMoment.flourish();
    const flourishItems = flourish ? [{
      sprite: flourish.sprite,
      tx: flourish.tx, ty: flourish.ty,
      alpha: flourish.alpha,
      decor: true,
      lift: 1,
      ref: { kind: "town-fx", id: flourish.townId } as unknown,
    }] : [];
    world.extra = [
      ...townItems,
      ...flourishItems,
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
      // RAIL-6 (#575): the atlas decides whether a platform draws as its
      // STATION (warehouse, slabs, caps) or as the platform sprite it always
      // was — the same non-gating contract, probed per sprite family.
      ...railStructureItems(rail, atlasRef ?? undefined),
      // R3 (#270): the hydro dams — the same non-gating contract. `dam_y`
      // spans a river along x (the 1×2 footprint), `dam_x` a river along y
      // (the 2×1), each anchored on its footprint's south vertex by the
      // atlas def the river-art loader writes (no `center`, like the
      // platform). The ref names the owner, for the hover inspector.
      ...eco.dams.map((d) => {
        const [ox, oy] = damDrawOrigin(d);
        return {
          sprite: d.axis === "x" ? "dam_y" : "dam_x",
          tx: ox, ty: oy,
          ref: { kind: "dam", id: d.id, owner: d.owner },
        };
      }),
    ];
    // Every world change funnels through here (builds, demolition, loads,
    // guest snapshots and deltas), so it retires the network-derived caches
    // too: hover routes, score breakdowns, inspector components, drag previews.
    netVersion++;
    syncLabels();
    if (threeLayer) {
      // LIVE-3D spike: one box per town building / depot / plant, rebuilt only when the world syncs.
      lastThreeItems = (world.extra ?? []).flatMap((e) => {
        const k = (e.ref as { kind?: string } | undefined)?.kind;
        if (k !== "town" && k !== "harvester" && k !== "factory" && !(k === "rail" && RAIL_3D.test(e.sprite))) return [];
        const [w, h] = footprintOf(e.sprite);
        // the 2D sprite rides up the hill with its base (depth.ts E3); the 3D model gets the same lift
        const lift = elevationActive(grid) ? surfaceHeight(grid, e.tx + w - 0.5, e.ty + h - 0.5) * LEVEL_PX : 0;
        return [{ sprite: e.sprite, tx: e.tx, ty: e.ty, w, h, lift }];
      });
      threeLayer.setItems(lastThreeItems);
    }
    renderer?.setWorld(world);
  };

  /**
   * NAMES: rebuild the tag set from the live world — industry footprints
   * (anchored at the footprint centre so the name sits over the building,
   * not its top corner), towns, the plants and the depots, each with its
   * owner. Runs inside `syncWorld`, so any build/demolish/snapshot that
   * changes who stands where updates the tags on the same beat.
   */
  /**
   * B7 (#252): the viewer's challenge clock as the contested tags print it
   * ("1:20"), or "" while they may fight. Written by the frame loop (which
   * owns the clock and re-syncs the tags when the text changes), read here —
   * `syncLabels` also runs during boot, before the challenge state exists.
   */
  let contestClock = "";
  /** B7: the contested-site set + clock the tags last printed (frame-loop key). */
  let contestKey = "";
  /**
   * RES-LABELS-1: the one resource site whose name chip may be on the map
   * right now: the site under the pointer, else the site whose card is open
   * ("selected"). Resource sites no longer wear a PERMANENT name chip — the
   * dark "QUARRY" tag that reduplicated the hover readout — so a site's name
   * appears at most once, and only while hovered or selected. Towns, plants
   * and depots keep their permanent tags. Null means no industry chip at all.
   */
  const focusIndustryId = (): number | null => {
    if (hover) {
      const occ = hover.tx >= 0 && hover.ty >= 0 && hover.tx < MAP_W && hover.ty < MAP_H
        ? grid.occupancy[tIdx(hover.tx, hover.ty)] : -1;
      if (occ >= 0 && grid.industries[occ]) return grid.industries[occ].id;
    }
    if (battleCardKey.startsWith("industry:")) {
      const id = Number(battleCardKey.slice("industry:".length));
      if (Number.isInteger(id) && grid.industries[id]) return id;
    }
    return null;
  };
  const syncLabels = () => {
    const entries: LabelEntry[] = [];
    // B7 (#252): a site someone has WON a battle over wears ⚔ (and, while the
    // viewer's challenge clock runs, when they may fight again)
    const contested = contestedIndustries(eco);
    const contestedT = contestedTowns(eco);
    const sword = (name: string) => `⚔ ${name}${contestClock ? ` · ${contestClock}` : ""}`;
    // RES-LABELS-1: no permanent name chip on resource sites; only the hovered / selected site wears one,
    // and a site someone won a battle over keeps its sword chip.
    const focusInd = focusIndustryId();
    for (const ind of grid.industries) {
      if (ind.id !== focusInd && !contested.has(ind.id)) continue;
      const def = INDUSTRY_BY_KEY[ind.type];
      const hot = contested.has(ind.id);
      entries.push({
        key: `ind-${ind.id}`,
        name: hot ? sword(def?.name ?? ind.type) : (def?.name ?? ind.type),
        tx: ind.tx + ind.w / 2,
        ty: ind.ty + ind.h / 2,
        cls: hot ? "label-industry label-contested" : "label-industry",
      });
    }
    for (const t of grid.towns) {
      const hot = contestedT.has(t.id);
      const label = t.name ?? "Town";
      entries.push({
        key: `town-${t.id}`, name: hot ? sword(label) : label, tx: t.tx, ty: t.ty,
        cls: hot ? "label-town label-contested" : "label-town",
      });
    }
    for (const f of eco.factories) {
      const [lfw, lfh] = rotatedSpan(factoryFp[0], factoryFp[1], f.rot ?? 0);
      entries.push({
        key: `plant-${f.owner}-${f.id}`,
        name: f.owner === me.id ? "Your Plant" : "Rival's Plant",
        tx: f.tx + lfw / 2,
        ty: f.ty + lfh / 2,
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
          // B7 (#252): the battle route — held, and (the one a player can act
          // on) lost to the next fight there
          : source === "hold"
            ? (gained
              ? `Contested site held · ${vpDeltaText(b.vp)}`
              : `Contested site lost · ${vpDeltaText(b.vp)}`)
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
    // The scoreboard's own tie-breaker — see `checkWinLine`.
    checkWinLine(events);
  }

  /**
   * The scoreboard's own tie-breaker: the first seat observed crossing the
   * line wins. Capture the event that did it so the intertitle can say whether
   * the last fraction came from pavement, a new plant, or (the new loop) a
   * Depot type starting to run.
   *
   * SCEN-2 (#602): split out of `applyVpEvents` so the SAME check can also be
   * run on its own — `__iso.winCheck()` calls this straight after a test or a
   * probe has driven `score.vp` to a seat's ★ line. A scenario's line is a
   * number the acceptance drives directly, and a check that only ever ran at
   * the end of an event batch would leave that hand-driven match running on
   * its line forever. The live path is unchanged: `applyVpEvents` calls this
   * once per batch, from the same place it always ran.
   */
  function checkWinLine(events: VpEvent[]) {
    if (phase !== "play") return;
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
          + (b.holds > 0 ? `, ${b.holds} contested site${b.holds === 1 ? "" : "s"} held` : "")
        : `${b.paved} paved tile${b.paved === 1 ? "" : "s"}, ${b.plants} plant${b.plants === 1 ? "" : "s"}`;
      toast(`${p.name} wins — ${fmtVp(vpFor(score, p.id))}★ (${how})`,
        p === me ? "good" : "bad");
      presentEnding(decisive);
      break;
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
        if (p === me) sfx.play("star");
        ui.feed(`${p === me ? "You" : p.name} reach ${stars}★ of ${winTarget()}★`, p.name);
        // VO-1: the rival pulling ahead is already a feed line. One taunt, rate-limited.
        if (p !== me && stars > Math.floor(vpFor(score, me.id))) voiceCue("rival:ahead");
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

  function placeFactoryFor(p: PlayerState, tx: number, ty: number, rot = 0): boolean {
    const blocked = townBlockedFor(p, tx, ty);
    if (blocked) {
      if (p === me) { toast(blocked, "bad"); flashAt(tx, ty, "Rival's town"); }
      return false;
    }
    const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true, track, rot });
    if (!plan.valid) {
      toast(plan.code === "not-near-town"
        ? "The Factory must be placed next to a town — its footprint must share an edge with a town tile."
        : `Can't build there — ${plan.why ?? "not buildable"}.`, "bad");
      if (p === me) flashAt(tx, ty, plan.code === "not-near-town" ? "Factory must touch a town" : "Can't build here");
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
        if (eco.factories.some((f) => {
          const [fw, fh] = rotatedSpan(factoryFp[0], factoryFp[1], f.rot ?? 0);
          return fx >= f.tx && fx < f.tx + fw && fy >= f.ty && fy < f.ty + fh;
        })) {
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
      toast(`${p === me ? "You already have" : "That seat already has"} a starting Factory.`, "bad");
      if (p === me) flashAt(tx, ty, "You already have a Factory");
      return false;
    }
    // W2: the factory carries its builder's track-owner id (player index + 1).
    // PP-06: the starting Factory is plant #0 — same building, same record.
    // F3: orientation stored on wire/save.
    eco.factories.push({
      owner: p.id, ownerId: p.i + 1, tx, ty,
      id: 0, townId: adjacentTown(grid, tx, ty, rot)?.id ?? null,
      rot: rot & 3,
    });
    noteWorldBuild();      // BUILD-1 (#460): the opening Factory is a build
    // SFX-01: a heavy crate set down and latched. The rival's own factory
    // appears in the same instant as the player's, so only the human's click
    // gets the sound — one thunk per gesture, whoever else moved.
    if (p === me) sfx.play("build");
    return true;
  }

  /** The opening Plant stands: a lesson goes on to its setup Depot, a match starts. */
  function afterOpeningFactory(): void {
    if (setupNeedsDepot) { phase = "setup-harvester"; return; }
    phase = "play";
    lastHarvest = performance.now();
    lastAi = performance.now();
  }

  function placeFactory(tx: number, ty: number): boolean {
    if (!placeFactoryFor(me, tx, ty, factoryView)) return false;
    if (!isSolo() && !aiOpponent) {
      // MP-05: no AI rival to seat — the guest places its own opening Factory
      // through an intent, on its own click.
      // #186: an AI-filled seat is seated below, exactly as in solo — there is
      // nobody on the other end of the wire to click for it.
      afterOpeningFactory();
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
      const rot = (spot as any)[2] ?? 0;
      eco.factories.push({
        owner: "ai", ownerId: rival.i + 1, tx: spot[0], ty: spot[1],
        id: 0, townId: adjacentTown(grid, spot[0], spot[1], rot)?.id ?? null,
        rot,
      });
    }
    afterOpeningFactory();
    syncWorld();
    // TUT-03 (#422): the guide's "raise your factory" step ends here — the
    // player DID it, which is the only thing that ever advances a step.
    guide?.emit({ kind: "build", what: "factory" });
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
    owner: f.owner, ownerId: f.ownerId, tx: f.tx, ty: f.ty, id: f.id ?? 0, rot: f.rot ?? 0,
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
  const railKindName = (kind: RailStructure["kind"]) => (kind === "platform" ? "Platform" : kind === "loop" ? "Passing Loop" : "Train depot");

  /**
   * RAIL-02 (#176): place a platform — the anchor rule, the one-per-anchor
   * limit, the 4 Wood + 4 Stone + 12 Ore + 2 Oil price and the +1★ are all the
   * rail module's, and this is only the click that pays for it.
   *
   * #181: `view` is the heading to build in, defaulting to the local tool's.
   * The HOST passes the heading a guest's intent named, because the refusal
   * it checked and the structure it commits have to be the same shape: judged
   * with the guest's rotation and built with the host's would put the guest's
   * platform down somewhere it never previewed (or silently refuse it after
   * the check said ok).
   */
  function placeRailPlatform(tx: number, ty: number, p: PlayerState, view: RailView = railView): boolean {
    const ownerId = p.i + 1;
    // #400: the Depot refusal's set. A platform at an industry this seat may
    // not claim is `industry-taken` — the same sentence a second Depot gets —
    // so building one never switches the other seat's Depot off.
    const why = platformRefusal(
      grid, rail.structures, railPlants(), ownerId, tx, ty, view, undefined,
      lockedIndustryIdsFor(eco, p.id), rail.rail,
    );
    if (why !== "ok") {
      if (p === me) {
        toast(RAIL_REFUSAL_TEXT[why], "bad");
        flashAt(tx, ty, why === "anchor-taken" ? "You already have one here"
          : why === "industry-taken" ? "Already claimed" : "Can't build here");
      }
      return false;
    }
    // PERK-1 (#600): the platform is its OWN class — Anne's Station Master
    // cuts it; James's rail quirk no longer taxes the platform he distrusts.
    if (!canPayBuild(p, RAIL_COSTS.platform, "platform")) {
      if (p === me) {
        toast(`Not enough money — a platform costs $${seatCostOf(p, RAIL_COSTS.platform, "platform")}.`, "bad");
        flashAt(tx, ty, `Platform costs $${seatCostOf(p, RAIL_COSTS.platform, "platform")}`);
      }
      return false;
    }
    const anchor = resolveAnchor(grid, railPlants(), ownerId, tx, ty, view);
    // A platform at an industry IS a Depot — one tuning session at a time.
    if (anchor?.kind === "industry" && newLoop && tuning && p === me) {
      toast("Finish the tuning session first — one Depot is tuned at a time.", "bad");
      if (p === me) flashAt(tx, ty, "Finish the tuning session first");
      return false;
    }
    if (!spendBuild(p, RAIL_COSTS.platform, "platform")) return false;
    // BUILD-1 (#460): snapshot the rail the platform's build is about to
    // touch — its footprint plus the three stopping tiles — so an undo can
    // hand the ground back exactly as it was.
    const [pw, ph] = footprintFor("platform", view);
    const before: [number, number][] = [];
    for (let dy = 0; dy < ph; dy++) for (let dx = 0; dx < pw; dx++) before.push([tx + dx, ty + dy]);
    const railBytes = snapshotRailBytes([...before, ...platformTrackAt(tx, ty, view)]);
    const built = placePlatform(rail, p.id, ownerId, tx, ty, view, anchor);
    layPlatformTrack(grid, track, rail, built);
    const depot = adoptPlatformDepot(built, p);
    recordUndo({
      kind: "platform", structureId: built.id, depotRecordId: depot?.id,
      money: seatCostOf(p, RAIL_COSTS.platform, "platform"), freeDepotsSpent: false, railBytes,
    }, p);
    if (p === me) sfx.play("build");
    syncWorld();
    rescoreNow();       // RAIL-02: the platform's ★ rides the same rescore
    if (p === me) {
      toast(depot
        ? "Platform built at the industry — tune its yield, then run rail to your plant's platform."
        : "Plant platform built — run rail to it from an industry platform.", "good");
    }
    if (!opts.tutorialSection || depot) guide?.emit({ kind: "build", what: "platform" });
    if (depot && newLoop && p === me && !isGuest()) openTuningSession(depot);
    return !!built;
  }

  /**
   * FLEET-2 (#596): place a Passing Loop. The refusal is the rail module's one
   * `loopRefusal` (the click, the ghost, a guest's intent and the rival all
   * ask it); the price is its own `BUILD_COSTS.loop`, in the platform's class
   * (Anne's Station Master cuts it). `tx, ty` is the RUN's first tile.
   */
  function placeRailLoop(tx: number, ty: number, p: PlayerState, view: RailView = railView): boolean {
    const ownerId = p.i + 1;
    const why = loopRefusal(grid, rail, ownerId, tx, ty, view);
    if (why !== "ok") {
      if (p === me) {
        toast(RAIL_REFUSAL_TEXT[why], "bad");
        flashAt(tx, ty, "Can't build here");
      }
      return false;
    }
    if (!canPayBuild(p, RAIL_COSTS.loop, "platform")) {
      if (p === me) {
        toast(`Not enough money — a Passing Loop costs $${seatCostOf(p, RAIL_COSTS.loop, "platform")}.`, "bad");
        flashAt(tx, ty, `Loop costs $${seatCostOf(p, RAIL_COSTS.loop, "platform")}`);
      }
      return false;
    }
    if (!spendBuild(p, RAIL_COSTS.loop, "platform")) return false;
    placeLoop(rail, p.id, ownerId, tx, ty, view);
    if (p === me) sfx.play("build");
    syncWorld();
    if (p === me) toast("Passing Loop built — trains on this line can pass each other here.", "good");
    return true;
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

  // ── RAIL-6 (#575): the station upgrade ──────────────────────────────────
  /**
   * The station the "Add lane" click armed, or null. While armed, the next
   * map click picks the SIDE the new lane runs on (the side of the station
   * the click fell on), the preview paints the lane it would build, and Esc
   * puts the tool down. The rule, the price and the refusal are the rail
   * module's — this is only the hand that holds it.
   */
  let laneToolStation: number | null = null;

  /** Which side of a station a click tile names: the side it falls on. */
  const laneSideFor = (s: RailStructure, tx: number, ty: number): 1 | -1 => laneSideOf(s, tx, ty);

  /**
   * RAIL-8 (owner, 2026-09-29): "I would never have known you could add lanes".
   * A station now INVITES the upgrade: hover one of yours with the pointer in
   * your hand and the lane it could grow shows as a transparent ghost with a
   * dashed "+" circle on it; clicking the circle (or the ghost ground) builds
   * it — the same `addStationLaneAt` the panel's orange button arms. Clicking
   * the station itself pins the invitation (a phone has no hover), and the
   * next click elsewhere lets it go.
   */
  let pinnedLaneStation: number | null = null;
  /** The badge the overlay painter draws this frame (set by `overlayFrame`). */
  let laneInviteView: LaneInviteView | null = null;
  /** Why a lane would be refused, in a few words for the badge's caption. */
  const LANE_WHY_SHORT: Partial<Record<string, string>> = {
    "off-map": "Map edge", water: "Water in the way", occupied: "No room here",
    "foreign-rail": "Rival rail in the way", "track-blocked": "Something in the way",
    overlap: "No room here", "not-flat": "Ground is not flat", "too-sharp": "Track would bend too sharply",
    "axis-only": "Diagonal track in the way", "overpass-stop": "An overpass is in the way",
    "max-lanes": "Station is full",
  };
  /** The picked building's station id, when the pointer is over a platform. */
  const stationIdOfRef = (ref: unknown): number | undefined => {
    const r = ref as { kind?: string; railKind?: string; structure?: number } | null | undefined;
    return r && r.kind === "rail" && r.railKind === "platform" && typeof r.structure === "number" ? r.structure : undefined;
  };
  /**
   * The invitation for a tile — Select in hand, a play-phase seat, no lesson.
   * `pinnedFallback` (the overlay's question) also answers with the pinned
   * station's invitation when the pointer is not on one; the CLICK asks
   * without it, so a pinned station never swallows the clicks that follow.
   */
  const laneInviteUnder = (tx: number, ty: number, pinnedFallback = true, pickRef?: unknown): LaneInvite | null => {
    if (phase !== "play" || opts.tutorialSection || tool !== "select" || tuning || pendingProtest) return null;
    const ref = stationIdOfRef(pickRef !== undefined ? pickRef
      : hover && hover.tx === tx && hover.ty === ty ? hover.ref : undefined);
    const under = laneInviteAt(grid, rail, me.i + 1, tx, ty, ref);
    if (under) return under;
    if (!pinnedFallback || pinnedLaneStation === null) return null;
    // a pinned station keeps offering its next lane on the first side that can take it
    const a = laneInviteFor(grid, rail, me.i + 1, pinnedLaneStation, 1);
    const b = laneInviteFor(grid, rail, me.i + 1, pinnedLaneStation, -1);
    if (!a && !b) { pinnedLaneStation = null; return null; }
    return a && (a.why === "ok" || !b || b.why !== "ok") ? a : b;
  };

  /**
   * Grow a station by one lane on one side — the refusal first (the same
   * `laneRefusal` the preview and the host intent read), then the money (the
   * shared table, the seat's perk class `rail`), then the build.
   */
  function addStationLaneAt(stationId: number, side: 1 | -1, p: PlayerState): boolean {
    const ownerId = p.i + 1;
    const why = laneRefusal(grid, rail, ownerId, stationId, side);
    if (why !== "ok") {
      if (p === me) {
        toast(RAIL_REFUSAL_TEXT[why], "bad");
        const s = structureById(rail, stationId);
        if (s) flashAt(s.tx, s.ty, RAIL_REFUSAL_TEXT[why]);
      }
      return false;
    }
    // PERK-1 (#600): the station lane prices with the platform (Station
    // Master covers "platforms and station lanes").
    if (!canPayBuild(p, RAIL_COSTS.lane, "platform")) {
      if (p === me) {
        toast(`Not enough money — a lane costs $${seatCostOf(p, RAIL_COSTS.lane, "platform")}.`, "bad");
        const s = structureById(rail, stationId);
        if (s) flashAt(s.tx, s.ty, `A lane costs $${seatCostOf(p, RAIL_COSTS.lane, "platform")}`);
      }
      return false;
    }
    if (!spendBuild(p, RAIL_COSTS.lane, "platform")) return false;
    const res = addStationLane(grid, track, rail, ownerId, stationId, side);
    if (!res.ok || !res.lane) {
      refundBuild(p, RAIL_COSTS.lane, 1, "platform");   // the refusal moved mid-click
      return false;
    }
    syncWorld();
    if (p === me) {
      sfx.play("build");
      const s = structureById(rail, stationId);
      const n = s ? stationLanes(s).length : 0;
      toast(`Lane added — the station now holds ${n} of ${MAX_LANES} lanes.`, "good");
    }
    return true;
  }

  /**
   * RAIL-02 (#176): place a train depot — 2×2, one declared rail exit, and the
   * exit has to join the owner's own rail (`depotRefusal` says why not).
   * #181: `view` is the heading, defaulting to the local tool's — the host
   * passes a guest's intent heading through the same refusal and the same
   * build, exactly as `placeRailPlatform` does.
   */
  function placeRailDepot(tx: number, ty: number, p: PlayerState, view: RailView = railView): boolean {
    const ownerId = p.i + 1;
    const why = depotRefusal(grid, rail, ownerId, tx, ty, view);
    if (why !== "ok") {
      if (p === me) {
        toast(RAIL_REFUSAL_TEXT[why], "bad");
        flashAt(tx, ty, why === "no-network" || why === "exit-blocked" ? "The exit needs your rail" : "Can't build here");
      }
      return false;
    }
    // PERK-1 (#600): the Train Depot is Anne's Shed Deal class, not track.
    if (!canPayBuild(p, RAIL_COSTS.depot, "trainDepot")) {
      if (p === me) {
        toast(`Not enough money — a train depot costs $${seatCostOf(p, RAIL_COSTS.depot, "trainDepot")}.`, "bad");
        flashAt(tx, ty, `Train depot costs $${seatCostOf(p, RAIL_COSTS.depot, "trainDepot")}`);
      }
      return false;
    }
    if (!spendBuild(p, RAIL_COSTS.depot, "trainDepot")) return false;
    // BUILD-1 (#460): the shed's lane autotiles into its neighbours — the
    // snapshot ring covers them, so the undo restores the whole patch.
    const railBytes = snapshotRailBytes([
      [tx, ty], [tx + 1, ty], [tx, ty + 1], [tx + 1, ty + 1],
    ]);
    const built = placeDepot(rail, p.id, ownerId, tx, ty, view);
    recordUndo({
      kind: "raildepot", structureId: built.id,
      money: seatCostOf(p, RAIL_COSTS.depot, "trainDepot"), freeDepotsSpent: false, railBytes,
    }, p);
    if (p === me) sfx.play("build");
    syncWorld();
    rescoreNow();
    if (p === me) toast("Train depot built. Buy a train from the Railway panel when a line is ready.", "good");
    return !!built;
  }

  /**
   * BUILD-1 (#460): one currency story — rail prices (trains, refunds, the
   * panel hints) are quoted in $, the same `moneyValueOf` the charges run
   * through. Cargo icons belong to the city upgrade, never a build.
   */
  const railCostLabel = (cost: Purse): string =>
    `$${moneyValueOf(cost).toLocaleString("en-US")}`;

  // ── R3 (#270): the hydro dam ─────────────────────────────────────────────
  let nextDamId = 1;

  /**
   * The side `placeDam` will actually use at site (wx,wy): the held `damSide`
   * when it is ACROSS the river's axis there, else the axis's first side
   * (north for a river along x, east for one along y). The river's axis is
   * the map's — the tool cannot rotate a dam onto a bend or a wide channel.
   */
  const damSideAtSite = (wx: number, wy: number, held: DamSide): DamSide => {
    const river = damRiverAt(grid, wx, wy);
    if ("why" in river) return held;
    return SIDES[river.axis].includes(held) ? held : SIDES[river.axis][0];
  };

  /**
   * The tiles a dam's bonus is measured from for this Depot — its 2×2 lot,
   * or, a platform-Depot, the platform it stands on. The bonus is a
   * Manhattan distance from the dam's SITE (its river tile) to the NEAREST
   * of these, so a platform at the far end of its three-tile footprint is
   * reached by its near tile, exactly as a truck Depot is.
   */
  function depotBonusTiles(h: Harvester): [number, number][] {
    if (isRailDepot(h)) {
      const s = rail.structures.find((st) => st.id === h.platformId);
      if (s) return footprintTiles(s);
      return [[h.tx, h.ty]];
    }
    return [[h.tx, h.ty], [h.tx + 1, h.ty], [h.tx, h.ty + 1], [h.tx + 1, h.ty + 1]];
  }

  /**
   * The two halves of the dam's factor for this seat's Depot — the DEPOT term
   * (0 or `DAM_BONUS`) and the CITY term (0 or `DAM_BONUS`, added to the
   * factor's city bonus when the seat's city stands in range of its dam).
   * The same numbers `economyTick` pays, the inspector prints and the chip
   * rates fold in — one read, no drift.
   */
  function damFactorsFor(
    seat: PlayerState, h: Harvester,
    factory: { townId?: number | null } | null | undefined,
  ): { dam: number; damCity: number } {
    const town = factory?.townId != null ? grid.towns[factory.townId] ?? null : null;
    return {
      dam: damBonusAtTiles(eco.dams, seat.i + 1, depotBonusTiles(h)),
      damCity: damCityBonusAt(eco.dams, seat.i + 1, town),
    };
  }

  /**
   * R3 (#270): build a hydro dam at river tile (wx,wy). Same shape as the
   * other one-click placements — the shared refusal first, then the price,
   * then the build, then the usual sync + rescore beats so every cache
   * (components, routes, the score, the overlay) re-reads the world.
   */
  function placeDam(wx: number, wy: number, p: PlayerState, held: DamSide = damSide): boolean {
    const ownerId = p.i + 1;
    const river = damRiverAt(grid, wx, wy);
    if ("why" in river) {
      if (p === me) {
        toast(DAM_REFUSAL_TEXT[river.why], "bad");
        flashAt(wx, wy, "No dam here");
      }
      return false;
    }
    // The side the SEAT drew is the side the host validates and builds with —
    // one refusal, one dam (the platform heading's rule, #181).
    const side = damSideAtSite(wx, wy, held);
    const why = damRefusal(grid, eco.dams, ownerId, wx, wy, side);
    if (why !== "ok") {
      if (p === me) {
        toast(DAM_REFUSAL_TEXT[why], "bad");
        flashAt(wx, wy, why === "site-taken" ? "A dam already stands here"
          : why === "crossed" ? "A bridge crosses here" : "Can't build here");
      }
      return false;
    }
    if (!canPayBuild(p, DAM_COST)) {
      if (p === me) {
        toast(`Not enough money — a dam costs $${moneyCostOf(DAM_COST)}.`, "bad");
        flashAt(wx, wy, "Not enough money");
      }
      return false;
    }
    if (!spendBuild(p, DAM_COST)) return false;
    const dam: Dam = { id: nextDamId++, owner: p.id, ownerId, wx, wy, axis: river.axis, side };
    eco.dams.push(dam);
    noteWorldBuild();      // BUILD-1 (#460): a build closes the undo window
    if (p === me) sfx.play("build");
    syncWorld();
    rescoreNow();
    if (p === me) {
      toast(`Hydro dam built — +${Math.round(DAM_BONUS * 100)}% output for Depots and the city within ${DAM_RANGE} tiles.`, "good");
    }
    return true;
  }

  /** The dam standing at (tx,ty) — either of its two tiles — or null. */
  const damAtTile = (tx: number, ty: number): Dam | null =>
    eco.dams.find((d) => damContains(d, tx, ty)) ?? null;

  /**
   * R3 (#270): the dam comes down through the same Demolish tool as every
   * other structure, with the usual floor(50%) refund. Returns true when a
   * dam was removed. The site is free again — the river was never gone.
   */
  function demolishDam(tx: number, ty: number, p: PlayerState = me): boolean {
    const d = damAtTile(tx, ty);
    if (!d) return false;
    if (d.owner !== p.id) {
      toast("That dam isn't yours.", "bad");
      if (p === me) flashAt(tx, ty, "Not yours to remove");
      return false;
    }
    const gone = eco.dams.findIndex((x) => x.id === d.id);
    if (gone < 0) return false;
    eco.dams.splice(gone, 1);
    const refund = resaleValue(DAM_COST);
    // ECON-1 (#421): a demolish refunds MONEY — the build was paid in money.
    if (Object.keys(refund).length) refundBuild(p, refund);
    if (p === me) sfx.play("demolish");
    noteWorldBuild();      // BUILD-1 (#460): a demolish closes undo windows
    syncWorld();
    rescoreNow();
    toast(`Hydro dam removed${moneyValueOf(refund) > 0 ? ` — $${moneyValueOf(refund).toLocaleString("en-US")} salvaged` : ""}.`, "info");
    return true;
  }

  function placeInterchange(tx: number, ty: number, p: PlayerState = me): boolean {
    const plan = buildInterchange(grid, track, p.i + 1, tx, ty, p.purse, previewBalance(p, "road"));
    if (plan.why) { if (p === me) toast(plan.why, "bad"); return false; }
    chargeBuild(p, plan.cost, "road"); // same synchronous all-or-nothing affordability check
    for (const [x, y] of plan.tiles) renderer?.invalidateTile(x, y);
    noteWorldBuild();      // BUILD-1 (#460): a build closes the undo window
    syncWorld(); rescoreNow();
    if (p === me) { sfx.play("build"); toast("Diamond interchange built.", "good"); }
    return true;
  }

  /**
   * RAIL-04 (#178): commit a rail drag. The tiles and the price come from
   * `railPreview` — the same function the overlay painted from — so what the
   * player saw is what they are charged, and `buildRail` refuses per tile in
   * the shared vocabulary when the pointer outran its own legality.
   */
  function commitRailDrag(p: PlayerState, pv: DragPreview & { why?: string | null }) {
    const res = buildRail(grid, track, rail, p.i + 1, pv.tiles, true);
    // BUILD-1 (#460): rail can join a fresh platform's lane — laying it
    // closes the undo window.
    if (res.built.length) noteWorldBuild();
    if (!Object.keys(res.cost).length && !res.built.length) {
      if (p === me) toast(res.why === "ok" ? "Can't build rail there." : RAIL_REFUSAL_TEXT[res.why as never], "bad");
      return;
    }
    if (Object.keys(res.cost).length && !spendBuild(p, res.cost, "rail")) {
      // Unreachable in practice (the preview refused unaffordable tiles); the
      // guard is what keeps the invariant true regardless.
      toast("Not enough money.", "bad");
    }
    if (p === me && res.built.length) sfx.play("place", { step: res.built.length });
    for (const [bx, by] of res.built) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, y = by + dy;
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
      }
    }
    if (res.why !== "ok" && p === me) toast(RAIL_REFUSAL_TEXT[res.why], "info");
    syncWorld();
    rescoreNow();
    if (p === me && res.built.length) {
      const end = res.built[res.built.length - 1];
      flashAt(end[0], end[1], "Rail laid", "good");
      guide?.emit({ kind: "build", what: "rail" });
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
    const pv = railPreview(grid, track, rail, me.i + 1, me.purse, ax, ay, bx, by, xFirst, true);
    if (pv.tiles.length === 0) return null;
    if (isGuest()) {
      net?.sendIntent("build", { do: "rail", ax, ay, bx, by, xFirst });
      return pv;
    }
    commitRailDrag(me, pv);
    return pv;
  };

  // ══════════════════════════════════════════════════════════════════════
  // BUILD-1 (#460) — the 8-second UNDO.
  //
  // For 8 seconds after a Depot, a Processing Plant, a Platform or a Train
  // Depot goes down, its builder may take it back: a 100% money refund and
  // the tiles exactly as they were. The window is deliberately narrow and the
  // rule deliberately strict — it is a misclick rescue, not a strategy tool:
  //
  //   • only the LATEST build of its seat (a newer build replaces the chip);
  //   • only while NOTHING depends on it: no cargo moved through it, no
  //     tuning settled on it, no line or train on it, no depot feeding the
  //     plant — and no build or demolish anywhere since (any of those could
  //     have attached to it, so the chip greys out with the reason);
  //   • the rival never undoes — only human seats ever get a record;
  //   • in a room the undo is a HOST INTENT: the host keeps the records for
  //     both seats, the guest's chip sends `{ do: "undo" }` and the host
  //     validates and applies it against the guest's seat.
  //
  // Records live only in memory — an 8-second window never crosses a save.
  // ══════════════════════════════════════════════════════════════════════
  const UNDO_WINDOW_MS = 8000;
  type UndoKind = "harvester" | "plant" | "platform" | "raildepot";
  interface UndoRailByte { idx: number; tile: number; owner: number }
  interface UndoRecord {
    kind: UndoKind;
    /** The builder's seat — the record belongs to them alone. */
    seatId: string;
    /** `performance.now()` when the build landed. */
    at: number;
    /** The build counter at the moment of the build (see `buildSeq`). */
    seqAt: number;
    /** The $ actually charged (0 while the setup allowance paid). */
    money: number;
    /** The free-setup Depot allowance was spent — undo gives it back. */
    freeDepotsSpent: boolean;
    harvesterId?: number;
    /** Platform: the Depot record it adopted (the cargo-moved flag reads it). */
    depotRecordId?: number;
    factoryId?: number;
    structureId?: number;
    /** Rail bytes the structure's placement touched — restored verbatim. */
    railBytes?: UndoRailByte[];
    /** Set by the economy clock / lorry deliveries once cargo moves on it. */
    cargoMoved?: boolean;
  }
  /**
   * Counts every build and demolish, whoever did it. An undo is only legal
   * while this still reads what it read at the build — any world edit since
   * could have attached to the new thing, so the chip greys out instead of
   * guessing.
   */
  let buildSeq = 0;
  const noteWorldBuild = () => { buildSeq++; };
  /** One undoable build per seat — the newest replaces whatever stood before. */
  const undoRecs = new Map<string, UndoRecord>();

  /**
   * The rail bytes a structure's placement will touch — its footprint, its
   * lane and one ring beyond (autotiling reaches the neighbours) — snapshotted
   * BEFORE the build so the undo restores them verbatim.
   */
  function snapshotRailBytes(tiles: readonly [number, number][]): UndoRailByte[] {
    const idxs = new Set<number>();
    for (const [x, y] of tiles) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < MAP_W && ny < MAP_H) idxs.add(tIdx(nx, ny));
        }
      }
    }
    return [...idxs].map((i) => ({ idx: i, tile: rail.rail.tile[i], owner: rail.rail.owner[i] }));
  }

  /**
   * File the undo record for a build that just succeeded. `noteWorldBuild`
   * runs for EVERY seat (the rival's builds close windows too); a record is
   * kept only for humans — the rival never undoes.
   */
  function recordUndo(rec: Omit<UndoRecord, "at" | "seqAt" | "seatId">, p: PlayerState): void {
    noteWorldBuild();
    // Only HUMAN seats keep records — the rival never undoes. Seat 1 reads
    // `human: false` even when a real guest holds it (the flag marks the AI),
    // so the room check stands in for the guest's humanity on the host.
    const humanSeat = p.human || (net !== null && p.i === 1);
    if (!humanSeat) return;
    undoRecs.set(p.id, { ...rec, seatId: p.id, at: performance.now(), seqAt: buildSeq });
  }

  /** The economy clock / the lorries report cargo moving through a Depot. */
  const flagUndoCargoMoved = (depotId: number): void => {
    for (const rec of undoRecs.values()) {
      if (rec.cargoMoved) continue;
      if (rec.harvesterId === depotId || rec.depotRecordId === depotId) rec.cargoMoved = true;
    }
  };

  /** Why this undo is refused right now, or null when it would go through. */
  function undoBlockReason(rec: UndoRecord, now: number): string | null {
    if (now - rec.at > UNDO_WINDOW_MS) return "the 8 seconds are over";
    if (buildSeq !== rec.seqAt) return "something else was built or demolished since";
    if (rec.cargoMoved) return "cargo already moved through it";
    if (rec.kind === "harvester") {
      const h = eco.harvesters.find((x) => x.id === rec.harvesterId);
      if (!h) return "the depot is already gone";
      if (h.closed) return "a battle closed this depot";
      if (h.tuneTier !== undefined) return "its yield is already tuned";
      if ((h.level ?? 1) > 1) return "it is already upgraded";
      if (tuning && tuning.depotId === rec.harvesterId && tuning.used > 0) {
        return "the tuning session already made moves";
      }
    } else if (rec.kind === "plant") {
      const f = eco.factories.find((x) => x.id === rec.factoryId);
      if (!f) return "the plant is already gone";
      if (plantsOf(eco, rec.seatId).length <= 1) return "your last plant cannot be undone";
      // A Depot already routed to this plant depends on it — the connection
      // question is the same one the clock and the scoreboard ask.
      const comp = buildAllComponents(eco.track, ownerIdOf(eco, rec.seatId));
      for (const h of eco.harvesters) {
        if (h.owner !== rec.seatId) continue;
        const conn = resolveConnection(eco, comp, h);
        if (conn.factory === f) return "your depots already feed this plant";
      }
    } else {
      const s = rail.structures.find((x) => x.id === rec.structureId);
      if (!s) return "it is already gone";
      if (rail.lines.some((l) => l.source === s.id || l.dest === s.id)) {
        return "a line already runs through it";
      }
      if (trainBasedAt(rail, s.id)) return "a train is based at it";
      for (const [x, y] of footprintTiles(s)) {
        if (trainOccupies(rail, x, y)) return "a train is standing on it";
      }
    }
    return null;
  }

  /**
   * Apply one undo for seat `p`. Answers the refusal in words, or null when
   * the build came back: the record removed, the rail bytes restored, the
   * money refunded in full, the free allowance returned.
   */
  function applyUndo(p: PlayerState, rec: UndoRecord, now: number): string | null {
    const blocked = undoBlockReason(rec, now);
    if (blocked) return blocked;
    if (rec.kind === "harvester") {
      const i = eco.harvesters.findIndex((h) => h.id === rec.harvesterId);
      if (i < 0) return "the depot is already gone";
      // The build opened this session; the undo closes it — BEFORE the record
      // dies, so the settle never writes a yield onto a ghost.
      if (tuning && tuning.depotId === rec.harvesterId) {
        closeTuningSession(true, "Build undone — the tuning session closed with it.");
      }
      const [gone] = eco.harvesters.splice(i, 1);
      if (gone) loopCarry.delete(gone.id);
    } else if (rec.kind === "plant") {
      const i = eco.factories.findIndex((f) => f.id === rec.factoryId);
      if (i < 0) return "the plant is already gone";
      eco.factories.splice(i, 1);
    } else {
      const i = rail.structures.findIndex((s) => s.id === rec.structureId);
      if (i < 0) return "it is already gone";
      rail.structures.splice(i, 1);
      if (rec.kind === "platform") dropPlatformDepot(rec.structureId!);
      for (const b of rec.railBytes ?? []) {
        rail.rail.tile[b.idx] = b.tile;
        rail.rail.owner[b.idx] = b.owner;
      }
      rail.rail.revision++;
    }
    if (rec.freeDepotsSpent) p.freeDepots += 1;
    if (rec.money > 0) p.money += rec.money;   // the 100% refund
    undoRecs.delete(p.id);
    syncWorld();
    rescoreNow();
    return null;
  }

  /**
   * The undo the local seat asks for. Solo/host apply it on the spot; a
   * guest sends the intent and the host answers (the delta lands the undone
   * world, a refusal lands as a notice). Answers the refusal in words, null
   * on success, "nothing" when there is simply nothing to undo.
   */
  function requestUndo(now = performance.now()): string | null {
    if (isGuest()) {
      // The HOST holds the record — the guest forwards the request and hears
      // the verdict as the host's echo. Only an optimistic chip that is
      // visibly EXPIRED short-circuits locally.
      if (guestUndoChip && guestUndoChip.untilMs <= now) return "nothing to undo";
      net?.sendIntent("build", { do: "undo" });
      return null;
    }
    const rec = undoRecs.get(me.id);
    if (!rec || now - rec.at > UNDO_WINDOW_MS) {
      if (rec) undoRecs.delete(me.id);
      return "nothing to undo";
    }
    const why = applyUndo(me, rec, now);
    if (why) return why;
    sfx.play("demolish");
    paintOverlayNow();
    return null;
  }

  /**
   * The chip's state for the HUD paint: what it counts down to, and the
   * reason it is grey when it is grey. A guest's chip is OPTIMISTIC — the
   * host owns the record, so the guest shows the build it just asked for and
   * lets the intent carry the validation.
   */
  interface UndoChipState { untilMs: number; blocked: string | null; kind: UndoKind }
  let guestUndoChip: UndoChipState | null = null;
  /**
   * BUILD-1 (#460): a guest's chip is optimistic — the record lives on the
   * host, so the guest shows the build it just ASKED for and lets the intent
   * carry the validation. Called from the guest's click sites, right next to
   * the `sendIntent` that asked for the build.
   */
  function noteGuestBuild(kind: UndoKind, now = performance.now()): void {
    guestUndoChip = { untilMs: now + UNDO_WINDOW_MS, blocked: null, kind };
  }
  function undoChipState(now: number): UndoChipState | null {
    if (isGuest()) {
      if (guestUndoChip && guestUndoChip.untilMs <= now) guestUndoChip = null;
      return guestUndoChip;
    }
    const rec = undoRecs.get(me.id);
    if (!rec) return null;
    if (now - rec.at > UNDO_WINDOW_MS) { undoRecs.delete(me.id); return null; }
    return { untilMs: rec.at + UNDO_WINDOW_MS, blocked: undoBlockReason(rec, now), kind: rec.kind };
  }

  /**
   * RAIL-04 (#178): buy a locomotive and one wagon and put them on a line —
   * "assign an owned industry platform to an owned plant platform, with a
   * reachable depot". The one-train-per-connected-network limit, the depot
   * reachability and the price are all checked inside `assignLine`/here, in
   * that order, so the player hears about the rule before the price.
   */
  function railAssign(sourceId: number, destId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "assign", source: sourceId, dest: destId }); return true; }
    const plan = assignLine(rail, p.i + 1, sourceId, destId, undefined, grid);
    if (!plan.ok) {
      if (p === me) toast(plan.why ?? "That line cannot run.", "bad");
      return false;
    }
    if (!canPayBuild(p, RAIL_COSTS.train, "rail")) {
      // The train is bought with the line: undo the assignment rather than
      // leaving a line with no locomotive on it.
      if (plan.line) rail.lines.splice(rail.lines.indexOf(plan.line), 1);
      if (plan.train) rail.trains.splice(rail.trains.indexOf(plan.train), 1);
      if (p === me) toast(`Not enough money — a train costs $${seatCostOf(p, RAIL_COSTS.train, "rail")}.`, "bad");
      return false;
    }
    spendBuild(p, RAIL_COSTS.train, "rail");
    if (p === me) sfx.play("build");
    syncWorld();
    rescoreNow();
    if (p === me) {
      toast(`${plan.line?.name ?? "Line"} assigned — the train is leaving the depot.`, "good");
      notePlayerTrain();
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
      if (p === me) toast("Assign a line first — a train needs somewhere to run.", "bad");
      return false;
    }
    if (!canPayBuild(p, RAIL_COSTS.train, "rail")) {
      if (p === me) toast(`Not enough money — a train costs $${seatCostOf(p, RAIL_COSTS.train, "rail")}.`, "bad");
      return false;
    }
    const bought = buyTrain(rail, p.i + 1, depotId, lineId, grid);
    if (!bought.ok) {
      if (p === me) toast(bought.why ?? "That train cannot be bought.", "bad");
      return false;
    }
    spendBuild(p, RAIL_COSTS.train, "rail");
    if (p === me) sfx.play("build");
    syncWorld();
    if (p === me) {
      toast("Train bought — it is waiting in the depot. Press Start to send it off.", "good");
      notePlayerTrain();
    }
    return true;
  }

  /** #179: send a parked train off along its line. */
  function railStart(trainId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "start", id: trainId }); return true; }
    const train = rail.trains.find((t) => t.id === trainId && t.ownerId === p.i + 1);
    if (!train) return false;
    const ok = startLine(rail, p.i + 1, train.lineId, grid);
    if (p === me) {
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
    const ok = recallTrain(rail, train, grid);
    if (p === me && ok) toast("Train recalled to its depot.", "info");
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
      if (p === me) toast(sale.why ?? "That train cannot be sold.", "bad");
      return false;
    }
    refundBuild(p, sale.refund, 1, "rail");   // ECON-1 (#421): a train sells for money
    if (p === me) sfx.play("demolish");
    syncWorld();
    rescoreNow();
    if (p === me) toast(`Train sold — ${railCostLabel(sale.refund)} salvaged.`, "info");
    return true;
  }

  /**
   * FLEET-4 (#598): upgrade one of the seat's trains a level - faster and one
   * more wagon (L2 x1.25 / 2 wagons, L3 x1.5 / 3). Applied AT ONCE, even while
   * the train is running: the consist just grows behind it. Same refusal ladder
   * (`trainUpgradeCheck`) as the button, the guest intent and the rival.
   */
  function railUpgrade(trainId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "railact", what: "upgrade", id: trainId }); return true; }
    const train = rail.trains.find((t) => t.id === trainId);
    const check = trainUpgradeCheck(train, p.i + 1, p.money, perkManagerOf(p));
    if (!check.ok || !train) {
      if (p === me) toast(check.why ?? "That train cannot be upgraded.", "bad");
      return false;
    }
    p.money -= check.price;
    setTrainLevel(train, trainLevel(train) + 1);
    if (p === me) { sfx.play("build"); toast(`Train upgraded to level ${trainLevel(train)}.`, "good"); }
    syncWorld();
    rescoreNow();
    return true;
  }

  // ══════════════════════════════════════════════════════════════════════
  // FLEET-1 (#595) — buy and sell trucks. `Harvester.trucks` is the count
  // (absent = 1); `planTrucks` turns it into lorries on the next replan and
  // `haulFactor` turns it into income. The refusal ladder is `truckBuyCheck`
  // (fleet.ts) — the same call the Fleet card, the guest intent and the rival
  // read, so a disabled button always says why the click would be refused.
  // ══════════════════════════════════════════════════════════════════════
  function truckBuyWhy(depotId: number, p: PlayerState = me) {
    const h = eco.harvesters.find((x) => x.id === depotId);
    const connected = !!h && h.platformId === undefined && roadRouteForHarvester(eco, h) !== null;
    return truckBuyCheck(h, p.i + 1, connected, p.money, perkManagerOf(p));
  }

  function fleetBuyTruck(depotId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "truck", act: "buy", depot: depotId }); return true; }
    const check = truckBuyWhy(depotId, p);
    if (!check.ok) {
      if (p === me) toast(check.why ?? "That truck cannot be bought.", "bad");
      return false;
    }
    const h = eco.harvesters.find((x) => x.id === depotId)!;
    p.money -= check.price;
    h.trucks = truckCountOf(h) + 1;
    trucksDirty = true;                 // replan: the new lorry joins the route
    if (p === me) {
      sfx.play("build");
      toast(`Truck bought — this Depot now runs ${h.trucks} trucks.`, "good");
    }
    return true;
  }

  // FLEET-5 (#599): upgrade the whole fleet one level (faster, same sprites).
  function truckUpgradeWhy(depotId: number, p: PlayerState = me) {
    const h = eco.harvesters.find((x) => x.id === depotId);
    const connected = !!h && h.platformId === undefined && roadRouteForHarvester(eco, h) !== null;
    return truckUpgradeCheck(h, p.i + 1, connected, p.money, perkManagerOf(p));
  }

  function fleetUpgradeTrucks(depotId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "truck", act: "upgrade", depot: depotId }); return true; }
    const check = truckUpgradeWhy(depotId, p);
    if (!check.ok) {
      if (p === me) toast(check.why ?? "That upgrade cannot be bought.", "bad");
      return false;
    }
    const h = eco.harvesters.find((x) => x.id === depotId)!;
    p.money -= check.price;
    h.truckLevel = truckLevelOf(h) + 1;
    trucksDirty = true;                 // replan restamps every lorry's pace
    refreshTruckRates();
    if (p === me) {
      sfx.play("build");
      toast(`Trucks upgraded - level ${h.truckLevel}, x${truckSpeedMultAt(h.truckLevel)} speed.`, "good");
    }
    return true;
  }

  function fleetSellTruck(depotId: number, p: PlayerState = me): boolean {
    if (isGuest()) { net?.sendIntent("build", { do: "truck", act: "sell", depot: depotId }); return true; }
    const h = eco.harvesters.find((x) => x.id === depotId);
    const why = truckSellRefusal(h, p.i + 1);
    if (why || !h) {
      if (p === me) toast(why ?? "That truck cannot be sold.", "bad");
      return false;
    }
    const refund = truckSellRefund(truckCountOf(h), perkManagerOf(p));
    p.money += refund;
    h.trucks = truckCountOf(h) - 1;
    trucksDirty = true;
    if (p === me) {
      sfx.play("demolish");
      toast(`Truck sold — $${refund} back.`, "info");
    }
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
    const plan = sabotagedObstacles(sessionObstaclesFor(difficultyRules(), depotTier(depot)), me.blackMarket, marketMs);
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
   * BM-2 adds live sabotage at session opening. Obstacles already dealt stay
   * breakable until that session ends; expiry only stops new affected sessions.
   */
  /**
   * FLEET-1 (#595): the transport seam the income clock, the ledger, the chip
   * rates and the readouts all multiply by - the (constant) transport tier
   * times what the Depot's lorry count carries. One expression, so "more
   * trucks = more loads per minute" is real income, never just extra sprites.
   */
  // FLEET-4 (#598): a platform depot hauls by train - its train's wagons carry more per trip.
  const trainLoadFactor = (h: Harvester): number => {
    if (!isRailDepot(h)) return 1;
    return trainLoadFactorOf(rail, h.platformId);
  };
  // TRAFFIC-INCOME: town traffic slows the lorries, so it slows the income (0.4..1, host-local).
  const haulFactor = (h: Harvester): number => trafficScaledHaul(transportFactor(h) * fleetLoadFactor(h) * trainLoadFactor(h), h.id);
  function cargoPerMinForDepot(depot: Harvester, yieldLevel: number): number {
    try {
      const now = performance.now();
      const comp = componentsFor(depot.ownerId);
      const locks = industryLocks(eco);
      const res = harvesterYield(eco, comp, locks, depot, now);
      let amount = Object.values(res.yields).reduce((a, b) => a + (b as number), 0);
      if (amount <= 0) {
        // Not yet serviced — estimate from catchment so target card is not 0.
        const cat = industriesInCatchment(grid, depot);
        amount = cat.reduce((a, ind) => {
          const def = INDUSTRY_BY_KEY[ind.type];
          return a + (ind.output ?? def?.output ?? 0) * TRANSPORT.dirt.throughput;
        }, 0);
      }
      const d = distanceInfoFor(depot.id);
      const seat = players.find((p) => p.id === depot.owner) ?? me;
      const damF = damFactorsFor(seat, depot, res.connection?.factory);
      const cityB = cityBonusFor(seat.id, res.connection?.factory) || (seat.townBonus ?? 0);
      const factor = BASE_RATE * yieldLevel * d.factor * haulFactor(depot) * (1 + (damF.dam ?? 0)) * (1 + Math.max(0, cityB + (damF.damCity ?? 0)));
      const perTick = amount * factor;
      const perSec = perTick * (1000 / HARVEST_MS);
      return perSec * 60;
    } catch { return 0; }
  }

  /**
   * PERK-1 (#600): the session's perk spend counters — the extra-moves buy
   * (Overtime Crew / Bulk Buyer) and the free reshuffle (Second Sight). A
   * session is a bounded, once-per-depot burst, so the uses live with the
   * session and die with it; null seats open with none of either.
   */
  let sessionBuysLeft = 0;
  let sessionShufflesLeft = 0;

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
    // PERK-1 (#600): Stamina starts the session with a bigger budget.
    tuning = createTuningSession(depot.id, cargo, sessionMovesFor(perkManagerOf(me)));
    // PERK-1: the session's perk uses — the buy and the reshuffle each reset
    // with the session, whatever the seat's manager carries.
    const offer = buyMovesOffer(perkManagerOf(me));
    sessionBuysLeft = offer ? offer.uses : 0;
    sessionShufflesLeft = perksOf(perkManagerOf(me)).secondSight ? 1 : 0;
    resetFinale();
    applySessionSabotageMoves();
    // The obstacles go on AFTER the fresh fill and BEFORE the plate opens:
    // they are part of the board the session deals, so the first thing the
    // player sees is the table as it will be played, not a clean one that
    // grows ice a beat later.
    const obstacles = seedSessionObstacles(depot);
    // PERK-1 (#600): Kenji's Opening Act — the session board opens its act
    // with a disco ball. Placed after the obstacles (the act walks around
    // them), on the same board the player will play; the spiral is pure and
    // deterministic, so the session's seed stays the seed.
    if (perksOf(perkManagerOf(me)).startingSpecial === "disco") {
      const cell = openingActCell(quarry.board.grid);
      const g = cell ? quarry.board.grid[cell.r]?.[cell.c] : undefined;
      if (g) {
        g.special = "disco";
        quarry.board.onChange();
      }
    }
    sfx.play("open");
    // #461 TUNE-1: target card BEFORE the session — current/possible cargo/min, last rating.
    const curYield = depotYield(depot);
    const cap = depotYieldCap(depot.level);
    const possibleYield = Math.min(TUNING.maxYield, cap);
    const targetInfo = {
      targetScore: TUNING.targetScore,
      maxYield: TUNING.maxYield,
      currentYield: curYield,
      currentCargoPerMin: cargoPerMinForDepot(depot, curYield),
      possibleCargoPerMin: cargoPerMinForDepot(depot, possibleYield),
      cargo,
      lastStars: depot.lastStars,
      isRetune: isRematch,
      depotId: depot.id,
    };
    // If target card is skipped (localStorage), UI calls onStart immediately.
    ui.showTuningTarget(targetInfo as any, () => {
      ui.openSessionBoard();
      const intro = obstacleIntroLine(skill().label, obstacles);
      if (intro) toast(intro, "info");
    });
    // For the non-skipped path the intro toast waits for Start — show it after
    // the board opens (inside the callback above). For skipped path the
    // callback already ran and intro is shown. To avoid double toast, we only
    // show here when skip is active (the callback already showed it). So we
    // check localStorage synchronously.
    try {
      if (localStorage.getItem("hexmatch:tuning:skipTarget") === "1") {
        // Already shown via callback — nothing more.
      } else {
        // Target card is up — intro will be shown after Start, not now.
      }
    } catch {}
    void isRematch; void rules;
  }

  /**
   * PERK-1 (#600): the session's extra-moves buy — Overtime Crew (Rafael,
   * 8 Gold, once) and Bulk Buyer (Dolores, 4 Gold, twice) are the SAME key
   * priced by the seat's perk row. Gold (the board's coin), not money: the
   * Black Market's currency is what a session's score pays, so the buy sits
   * with the session's other spend.
   */
  function sessionBuyMoves(): boolean {
    const offer = buyMovesOffer(perkManagerOf(me));
    if (!tuning || !offer || sessionBuysLeft <= 0) return false;
    const gold = me.purse.gold ?? 0;
    if (gold < offer.gold) {
      toast(`Not enough Gold — the extra moves cost ${offer.gold}.`, "bad");
      return false;
    }
    me.purse.gold = gold - offer.gold;
    tuning.moves += 3;
    sessionBuysLeft--;
    toast(`+3 moves for ${offer.gold} Gold — ${tuningMovesLeft(tuning)} to play.`, "good");
    sfx.play("coin");
    onBoardChange();   // the plate re-reads its budget
    return true;
  }

  /**
   * PERK-1 (#600): Second Sight's hint — the best move the session board
   * carries, highlighted by the chrome (two gems glow). A hint costs nothing
   * and is repeatable while the session is open; the board may move on, so
   * the glow is always one move old at most.
   */
  function sessionHint(): boolean {
    if (!tuning || !perksOf(perkManagerOf(me)).secondSight) return false;
    const mv = quarry.board.bestMove();
    if (!mv) {
      toast("No move to point at — the board needs a reshuffle.", "info");
      return false;
    }
    ui.hintMove(mv.r1, mv.c1, mv.r2, mv.c2);
    return true;
  }

  /**
   * PERK-1 (#600): Second Sight's reshuffle — one free `reshuffle` per
   * session (the board's own deadlock shuffle is separate and always on).
   * Refused mid-cascade, like every other board input.
   */
  function sessionShuffle(): boolean {
    if (!tuning || !perksOf(perkManagerOf(me)).secondSight || sessionShufflesLeft <= 0) return false;
    if (quarry.board.busy) return false;
    sessionShufflesLeft--;
    toast("The board reshuffles — one free cut per session.", "good");
    sfx.play("open");
    void quarry.board.reshuffle();
    return true;
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
    window.clearTimeout(cityPickTimer);
    if (on) {
      // Playtest (2026-09): a build tool in the hand owns every map click, so
      // picking a city with Dirt Road still armed built road. Put the tool
      // down first (before the flag, so arming doesn't cancel the pick).
      if (tool !== "select") armTool("select");
      cityPickTimer = window.setTimeout(() => setCityPick(false), 20_000);
    }
    cityPick = on;
    ui.el.dataset.pick = on ? "city" : "";
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
   *
   * TOWN-2 (#470) hangs the tier-up MOMENT on the same door: the camera eases
   * to the town, the lots this growth ADDED go up behind scaffolds and cranes
   * for two and a half seconds, a flag and bunting flourish plays over the
   * town hall, the city-upgrade sound plays and the Feed says so. `by` names
   * the seat that grew (it decides the Feed line); the moment is presentation
   * only — nothing here is saved and nothing goes on the wire, and the restore
   * path never reaches this function at all (`fx = false`).
   */
  function growTownArt(t: Town, now = performance.now(), by: PlayerState = me): void {
    // #470: what this town drew BEFORE the tier changed — read before the
    // re-sync below overwrites it, so the new district is a diff of the town's
    // own draw list.
    const drawnBefore = townDrawnTiles.get(t.id) ?? new Set<string>();
    // A growth inside a growth (two upgrades inside the same three seconds):
    // land the running moment's district first, so the diff below sees finished
    // buildings and the new moment never inherits a scaffold sprite as its
    // "finished" art. No-op — and no sync — when nothing is running.
    growthMoment.finish();
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
    // #296: the ring road grows with the town. A grown town (tier 2+) gets a
    // public road loop just outside its grown districts, on FREE ground only:
    // water, occupied tiles, anything already carrying track or rail and any
    // player building are skipped (the loop simply has a gap there — nothing
    // a player built is ever removed). Idempotent: a restored save re-runs
    // this and finds the loop already paved.
    let grewRing = false;
    if (mapOptions.rings && townGrownRings(Math.max(townTier(t), 1)) > 0) {
      for (let y = t.ty - R; y <= t.ty + R; y++) {
        for (let x = t.tx - R; x <= t.tx + R; x++) {
          if (Math.max(Math.abs(x - t.tx), Math.abs(y - t.ty)) !== R) continue;
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
          const i = y * MAP_W + x;
          if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) continue;
          if (hasTrack(track, "road", x, y) || hasTrack(track, "dirt", x, y) || hasRail(rail.rail, x, y)) continue;
          if (grid.builtAt?.(x, y)) continue;
          buildTile(track, "road", x, y, PUBLIC_OWNER);
          grewRing = true;
        }
      }
      if (grewRing) syncWorld();
    }
    for (let y = t.ty - R; y <= t.ty + R; y++) {
      for (let x = t.tx - R; x <= t.tx + R; x++) {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
      }
    }
    floats.add(`⬆ ${townTierLabel(townTier(t)).toUpperCase()}`, t.tx, t.ty - 1,
      { cls: "delivery", now });
    // TOWN-2 (#470): the lots this growth ADDED — every town draw item whose
    // tile the town did not draw before. At tier 2+ that is the new district
    // (#425 made it drawable); a first upgrade adds none, and the moment is
    // then just the camera, the hall flourish, the sound and the Feed line.
    const tier = townTier(t);
    const newLots = (world.extra ?? []).flatMap((e) => {
      const ref = e.ref as { kind?: string; id?: number } | undefined;
      if (ref?.kind !== "town" || ref.id !== t.id) return [];
      if (drawnBefore.has(`${e.tx},${e.ty}`)) return [];
      const [w, h] = atlasRef?.get(e.sprite)?.footprint ?? [1, 1];
      return [{ tx: e.tx, ty: e.ty, sprite: e.sprite, w, h }];
    });
    growthSeat = by;
    growthMoment.start(
      { id: t.id, tx: t.tx, ty: t.ty, tier, label: townTierLabel(tier) },
      newLots,
      now,
    );
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
    noteTownGrew();
    // #470: `p` names the seat that grew — the moment's Feed line is posted for
    // the local seat only (the rival's growth says so where the rival buys it).
    if (fx) growTownArt(t, performance.now(), p);
    return t;
  }

  function growTownForSeat(p: PlayerState, fx = true): Town | null {
    if (!newLoop) return null;
    const t = townOfSeat(p);
    if (!t) return null;
    const next = Math.max(townTier(t), Math.min(p.townLevel, TOWN_VISUAL_MAX));
    if (!setTownLevel(t, next)) return null;
    noteTownGrew();
    if (fx) growTownArt(t, performance.now(), p);   // #470: the seat that grew
    return t;
  }

  /** AMB-3: a tier-up can raise the car budget. The perf dial, if set, wins. */
  function noteTownGrew(): void {
    if (trafficDial !== null) return;
    const next = carBudget();
    if (next === carCount) return;
    carCount = next;
    if (!isGuest()) cars.cars = planCars(track, grid, cars.cars, carCount, seed);
  }

  function applySessionSabotageMoves(): void {
    const lost = sessionSabotage(me.blackMarket, marketMs).lostMoves;
    if (tuning && lost) {
      tuning.moves = Math.max(1, tuning.moves - lost);
      toast(`Red Tape — the permit office cost this session ${lost} moves.`, "bad");
    }
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
    resetFinale();
    applySessionSabotageMoves();
    const plan = sabotagedObstacles({ frost: 0, girders: 0, frostHard: 1 }, me.blackMarket, marketMs);
    sessionObstacles = quarry.board.seedObstacles(plan.frost, plan.girders, plan.frostHard);
    const intro = obstacleIntroLine("Black Market", sessionObstacles);
    if (intro) toast(intro, "bad");
    sfx.play("open");
    ui.openSessionBoard();
    toast(
      `City upgrade — ${tuning.moves} moves on the plant floor set the base rate for every Depot you have connected.`,
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
    // CAST-1: Kenji's perk — the session SCORES 10% more for his seat, so the
    // stars, the yield and the Gold all settle from one boosted number (the
    // results card shows it). Every other seat scores exactly as played.
    const score = tuningScore(s.score, perkManagerOf(me));
    const base: SessionSettlement = {
      id: ++settleSeq, kind: s.kind, abandon, played, reason, score,
      stars: abandon ? 0 : tuningStarsFor(score), coins: 0,
      prev: undefined, outcome: null, townId: null, cityLevel: 0, cityBonus: 0, bonus: 0,
    };
    if (s.kind === "town") {
      // An abandon is never shown, and the refund below is all it does.
      if (abandon) return base;
      const coins = tuningSessionGold({ ...s, score });
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
      const next = townBonusFor(row?.bonus ?? 0, score);
      const bonus = rules.yieldNeverDrops ? Math.max(city.bonus, next) : next;
      return { ...base, ...at, coins, bonus };
    }
    // A Depot demolished under its session is simply not found: the settle
    // still prices the score (the Gold is paid), and there is no record to set.
    const depot = eco.harvesters.find((h) => h.id === s.depotId);
    const prev = depot?.yield;
    const outcome = depotSessionOutcome(score, prev, rules, { abandon, cap: depotYieldCap(depot?.level) });
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
    // #461: cargo/min and delta for payoff display.
    let prevPerMin: number | undefined;
    let newPerMin: number | undefined;
    let deltaPct: number | undefined;
    try {
      if (depot) {
        prevPerMin = cargoPerMinForDepot(depot, o.from);
        // For new, use the depot's yield after settle? But we have o.yield which is what will be set.
        // Compute using same depot but with new yield — cargoPerMinForDepot reads depotYield, so pass yield directly via helper that takes yieldLevel.
        newPerMin = cargoPerMinForDepot(depot, o.yield);
        if (o.from > 0) deltaPct = ((o.yield - o.from) / o.from) * 100;
      }
    } catch {}
    return {
      ...base, platform: !!depot && isRailDepot(depot),
      from: o.from, to: o.yield, cap: o.cap, capped: o.capped, kept: o.kept, overGold: o.overshootGold,
      prevCargoPerMin: prevPerMin,
      newCargoPerMin: newPerMin,
      deltaPct,
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
    // MATCH-2 (#566): a Legendary finale is let land too — Finish during it is
    // remembered exactly like a Finish mid-cascade, and `quarryTick` ends the
    // session the moment both are over.
    if (quarry.board.busy || finaleHolds()) {
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
    // MATCH-2: the finale's music bows out with the session it celebrated.
    stopFinaleMusic(1.2);
    const played = r.played;
    // SCEN-2 (#602): a scenario's tuning objective — the best ★ a PLAYED Depot
    // session has reached. A town session is not a Depot tuning, and an
    // abandoned board sets nothing: the level has to be earned.
    if (scenarioDef && played && s.kind === "depot") {
      scenarioBestTuningStars = Math.max(scenarioBestTuningStars, tuningStarsFor(s.score));
    }
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
        // END-1 (#472): first to each town tier
        try {
          const t = (performance.now() - matchHistory.startMs) / 1000;
          const lvl = Math.min(r.cityLevel + 1, TOWN_UPGRADES.length);
          recordEvent(matchHistory, { kind: "town", seat: 0, townId: targetTown.id, level: lvl, t });
        } catch {}
      } else {
        if (bonus > 0) me.townBonus = bonus;
        me.townLevel = Math.min(r.cityLevel + 1, TOWN_UPGRADES.length);
        try {
          const t = (performance.now() - matchHistory.startMs) / 1000;
          const lvl = Math.min(r.cityLevel + 1, TOWN_UPGRADES.length);
          // seat-level town upgrade — use townId -1 as sentinel
          recordEvent(matchHistory, { kind: "town", seat: 0, townId: -1, level: lvl, t });
        } catch {}
      }
      noteWorldBuild();      // BUILD-1 (#460): the upgrade lands — a build
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
      guide?.emit({ kind: "build", what: "city" });
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
      // #461 TUNE-1: remember the star rating for retune display and payoff.
      depot.lastStars = r.stars;
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
      guide?.emit({ kind: "game", name: "session-finished" });

      // #461 TUNE-1: on-map payoff after every session — float, camera ease, coin burst on next delivery.
      try {
        const deltaPct = before > 0 ? ((level - before) / before) * 100 : 0;
        const now = performance.now();
        if (depot) {
          // Remember for coin burst when next load lands.
          recentTunePayoff.set(depot.id, { until: now + 30000, deltaPct, yield: level });
          // Yield float over Depot — respects reduced motion via CSS.
          const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!reduce && Math.abs(deltaPct) > 0.5) {
            const sign = deltaPct > 0 ? "+" : "";
            floats.add(`${sign}${Math.round(deltaPct)}%`, depot.tx, depot.ty, { cls: "delivery", now, life: 1600 });
          } else if (!reduce) {
            // Even without delta, show yield.
            floats.add(`×${level}`, depot.tx, depot.ty, { cls: "delivery", now, life: 1400 });
          }
          // Camera eases back to Depot — respects reduced motion inside easeCameraToTile.
          // Delay slightly so results pop-up Confirm has closed and map is visible.
          setTimeout(() => easeCameraToTile(depot.tx, depot.ty, performance.now()), 120);
          // SFX for payoff.
          sfx.play("coin");
        }
      } catch {}
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
    if (!spendBuild(me, DEPOT_RETUNE_COST)) {
      // BUILD-1 (#460): the retune is charged in money like every build.
      toast(`Not enough money — a retune costs $${moneyValueOf(DEPOT_RETUNE_COST)}.`, "bad");
      return false;
    }
    openTuningSession(head.depot, true);
    guide?.emit({ kind: "game", name: "retune-started" });
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
    if (!spendBuild(me, DEPOT_UPGRADE_COST)) {
      // BUILD-1 (#460): the upgrade is charged in money like every build.
      toast(`Not enough money — a Depot upgrade costs $${moneyValueOf(DEPOT_UPGRADE_COST)}.`, "bad");
      return false;
    }
    d.level = lvl + 1;
    toast(`Depot upgraded to level ${d.level} — its yield cap is now ×${depotYieldCap(d.level)}. Tune it up!`, "good");
    ui.feed(`Depot upgraded to level ${d.level} (cap ×${depotYieldCap(d.level)})`, me.name);
    rescoreNow();
    openTuningSession(d, true);
    guide?.emit({ kind: "game", name: "depot-upgraded" });
    return true;
  }

  /**
   * #462: the clock factor the ledger and the upgrade preview multiply by.
   * Same expression `economyTick` passes to `clockFactorOf` — dam and city
   * included — so a cargo/min on the card is a cargo/min the clock will pay.
   */
  function cargoClock(h: Harvester, factory: Factory | null, state: EconomyState = eco): number {
    const seat = h.owner === me.id ? me : rival;
    const damF = damFactorsFor(seat, h, factory);
    return clockFactorOf({
      yieldLevel: depotYield(h),
      distanceFactor: distanceFactorForPath(depotPathLength(state, h)),
      transportFactor: haulFactor(h),
      dam: damF.dam,
      city: hasCities(seat)
        ? cityBonusFor(seat.id, factory) + damF.damCity
        : Math.max(0, seat.townBonus) + damF.damCity,
    });
  }

  /** Cargo/min for one Depot, on `state` (the live world, or a forecast clone). */
  function measureCargo(state: EconomyState, h: Harvester): number {
    const pay = depotRoutePay(state, h, performance.now());
    if (!pay.connected) return 0;
    return cargoPerMinute(pay.rawPerTick, cargoClock(h, pay.factory, state), HARVEST_MS);
  }

  /** The three ledger lines, or null when the Depot has no route to price. */
  function routeLedgerHtml(h: Harvester, now: number): string | null {
    const pay = depotRoutePay(eco, h, now, componentsFor(h.ownerId));
    if (!pay.connected) return null;
    const route = roadRouteForHarvester(eco, h, componentsFor(h.ownerId)) ?? pay.route;
    const slow = route && route.length ? slowestOnRoute(track, route) : pay.slowest;
    const factor = cargoClock(h, pay.factory);
    const text = routeLedgerText({
      cargoPerMin: cargoPerMinute(pay.rawPerTick, factor, HARVEST_MS),
      dollarsPerMin: routeDollarsPerMin(pay.yields, factor, HARVEST_MS, unitPrice),
      cargoName: cargoDisplayName(pay.cargo),
      slowest: slow,
      tripsPerMin: tripsForDepot(h),
    });
    return text.html;
  }

  /**
   * FLEET-1 (#595): a Train Depot row's line picker - every line of mine with
   * the reason a train cannot be bought for it (`trainBuyRefusal`, then the
   * purse). Only while a rail tool has the panel open, so a flood and a path
   * search per line are never paid per paint on the plain map.
   */
  let railFleetComp: { rev: number; comp: Map<number, number> } | null = null;
  function fleetTrainOptions(r: { id: number; kind: string }): { buyLines?: { id: number; name: string; why: string | null }[]; buyPrice?: string; upgrade?: { label: string; why: string | null } } {
    // FLEET-4 (#598): a train row's Upgrade button - the next speed, wagons and price, or why not.
    if (r.kind === "train") {
      const t = rail.trains.find((x) => x.id === r.id);
      if (!t) return {};
      const lv = trainLevel(t);
      if (lv >= TRAIN_LEVELS.max) return { upgrade: { label: "Fully upgraded", why: "Fully upgraded." } };
      const check = trainUpgradeCheck(t, me.i + 1, me.money, perkManagerOf(me));
      const next = lv + 1;
      return { upgrade: {
        label: `Upgrade $${trainUpgradePrice(lv, perkManagerOf(me))} - x${TRAIN_LEVELS.speed[next - 1]} speed, ${TRAIN_LEVELS.wagons[next - 1]} wagons`,
        why: check.why,
      } };
    }
    if (r.kind !== "depot") return {};
    if (tool !== "rail" && tool !== "platform" && tool !== "raildepot" && tool !== "railway") return {};
    const mine = rail.lines.filter((l) => l.ownerId === me.i + 1);
    if (!mine.length) return {};
    const price = seatCostOf(me, RAIL_COSTS.train, "rail");
    const sig = rail.trains.length * 100003 + rail.structures.length * 131 + rail.lines.length + rail.rail.revision * 7;
    if (!railFleetComp || railFleetComp.rev !== sig) {
      railFleetComp = { rev: sig, comp: railComponents(rail, me.i + 1) };
    }
    return {
      buyPrice: `$${price}`,
      buyLines: mine.map((l) => ({
        id: l.id,
        name: l.name,
        why: trainBuyRefusal(rail, me.i + 1, r.id, l.id, grid, railFleetComp!.comp)
          ?? (me.money < price ? `Not enough money - a train costs $${price}.` : null),
      })),
    };
  }

  function tripsForDepot(h: Harvester): number {
    // PERK-1 (#600): the card's trips/min rides the same Lead Foot the tick
    // integrates, so the number on the card is the lorry you're watching.
    // FLEET-1 (#595): every lorry on the route adds its own trips.
    let sum = 0;
    for (const live of trucks.trucks) if (live.depotId === h.id) sum += lorryTripsPerMin(live, truckSpeedForOwner);
    return sum;
  }

  function armedUpgradeTier(): "street" | "road" | "highway" | null {
    if (tool !== "road") return null;
    if (roadTier === "street" || roadTier === "road" || roadTier === "highway") return roadTier;
    return null;
  }

  let upgradePreviewCache: { key: string; text: string | null } | null = null;
  /**
   * "+x% cargo/min on <Depot>" for upgrading the stretch under the pointer.
   * One line: this seat only, and the Depot the stretch helps the most.
   * Cached per network version and tile — a hover must not re-flood every frame.
   */
  function upgradePreviewAt(tx: number, ty: number): string | null {
    const to = armedUpgradeTier();
    if (!to) return null;
    const key = `${netVersion}:${to}:${tx},${ty}`;
    if (upgradePreviewCache?.key === key) return upgradePreviewCache.text;
    const rows: { name: string; forecast: NonNullable<ReturnType<typeof forecastStretchUpgrade>> }[] = [];
    for (const h of eco.harvesters) {
      if (h.owner !== me.id || isRailDepot(h)) continue;
      const route = roadRouteForHarvester(eco, h, componentsFor(h.ownerId));
      if (!route) continue;
      const stretch = stretchAround(track, route, tx, ty);
      if (!stretch.length) continue;
      const pay = depotRoutePay(eco, h, performance.now(), componentsFor(h.ownerId));
      const forecast = forecastStretchUpgrade(eco, h, stretch, to, measureCargo);
      if (forecast) rows.push({ name: depotRouteName(pay.cargo, h.id), forecast });
    }
    const best = pickLargestGain(rows);
    const text = best ? formatUpgradePreview(best.pct, best.name) : null;
    upgradePreviewCache = { key, text };
    return text;
  }

  let routeGeomCache: { version: number; rows: { id: number; tiles: [number, number][]; pace: string[] }[] } | null = null;
  /** Every road route, geometry cached on the network version. Labels are live. */
  function networkPaths(): RouteOverlayPath[] {
    if (!routeGeomCache || routeGeomCache.version !== netVersion) {
      const rows: { id: number; tiles: [number, number][]; pace: string[] }[] = [];
      for (const h of eco.harvesters) {
        if (isRailDepot(h)) continue;
        const route = roadRouteForHarvester(eco, h, componentsFor(h.ownerId));
        if (!route || route.length < 2) continue;
        rows.push({
          id: h.id,
          tiles: route,
          pace: routePaceNames(track, route),
        });
      }
      routeGeomCache = { version: netVersion, rows };
    }
    const out: RouteOverlayPath[] = [];
    for (const row of routeGeomCache.rows) {
      const h = eco.harvesters.find((x) => x.id === row.id);
      if (!h) continue;
      const pay = depotRoutePay(eco, h, performance.now(), componentsFor(h.ownerId));
      const cargo = cargoPerMinute(pay.rawPerTick, cargoClock(h, pay.factory), HARVEST_MS);
      const mid = row.tiles[Math.floor(row.tiles.length / 2)];
      out.push({
        tiles: row.tiles,
        pace: row.pace,
        label: { tx: mid[0], ty: mid[1], text: `${formatCargoRate(cargo)}/min` },
      });
    }
    return out;
  }

  let focusCache: { key: string; path: RouteOverlayPath | null } | null = null;
  /** The aqua line: the Depot under the pointer, else the one a Select click opened. */
  function focusRoute(): RouteOverlayPath | null {
    const ref = hover?.ref as { kind?: string; id?: number } | null;
    const hoveredId = ref?.kind === "harvester" ? ref.id ?? null : null;
    const id = hoveredId ?? selectedDepotId;
    if (id == null) return null;
    const key = `${id}:${netVersion}`;
    if (focusCache?.key === key) return focusCache.path;
    const h = eco.harvesters.find((x) => x.id === id) ?? null;
    const route = h ? roadRouteForHarvester(eco, h, componentsFor(h.ownerId)) : null;
    const path = route && route.length >= 2 ? { tiles: route, focus: true as const } : null;
    focusCache = { key, path };
    return path;
  }

  /** 2026-09: the Depot card a click on one of my Depots opens. */
  /**
   * FLEET-1 (#595): the Fleet block of a Depot card - one row per lorry with
   * its live status, Buy truck at the price this seat pays (James's road perk
   * included) and Sell truck at its one-time 50% refund. A refused button is
   * disabled and says why (`truckBuyCheck`, the same ladder the host runs).
   */
  function fleetCardFor(d: Harvester): FleetCardInfo | undefined {
    if (isRailDepot(d)) return undefined;             // a platform's freight goes by train
    const count = truckCountOf(d);
    const live = trucks.trucks.filter((t) => t.depotId === d.id)
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));
    const rows: { label: string; status: string }[] = [];
    for (let i = 0; i < count; i++) {
      const t = live.find((x) => (x.slot ?? 0) === i);
      rows.push({
        label: `Truck ${i + 1}`,
        status: !t ? (roadRouteForHarvester(eco, d) ? "joining the route" : "parked - no road route")
          : (t.waitMs ?? 0) > 0 ? "loading at the depot"
            : t.reverse ? "heading home" : "hauling to the plant",
      });
    }
    const check = truckBuyWhy(d.id, me);
    const sellWhy = truckSellRefusal(d, me.i + 1);
    const rerun = () => depotCardFor(d);
    const tl = truckLevelOf(d);
    const upCheck = truckUpgradeWhy(d.id, me);
    return {
      heading: `Fleet - ${count} of ${FLEET.maxTrucks} trucks`,
      rows,
      upgrade: {
        level: tl,
        max: FLEET.maxTruckLevel,
        label: tl >= FLEET.maxTruckLevel ? "Trucks maxed" : "Upgrade trucks",
        detail: tl >= FLEET.maxTruckLevel ? `x${truckSpeedMultAt(tl)} speed` : `to x${truckSpeedMultAt(tl + 1)} speed`,
        price: tl >= FLEET.maxTruckLevel ? "-" : `$${upCheck.price}`,
        why: upCheck.ok ? null : (upCheck.why ?? "Cannot upgrade."),
        onClick: () => { fleetUpgradeTrucks(d.id, me); rerun(); },
      },
      buy: {
        label: "Buy truck",
        price: `$${count >= FLEET.maxTrucks ? truckBuyPrice(count - 1, perkManagerOf(me)) : check.price}`,
        why: check.ok ? null : (check.why ?? "Cannot buy a truck."),
        onClick: () => { fleetBuyTruck(d.id, me); rerun(); },
      },
      sell: {
        label: "Sell truck",
        refund: count > 1 ? `$${truckSellRefund(count, perkManagerOf(me))} back` : "-",
        why: sellWhy,
        onClick: () => { fleetSellTruck(d.id, me); rerun(); },
      },
    };
  }
  function depotCardFor(d: Harvester): void {
    selectedDepotId = d.id;
    const lvl = d.level ?? 1;
    // R3 (#270): the dam's bonus, when a dam of mine reaches this Depot —
    // the card prints it beside the yield the clock pays, the same line the
    // hover inspector's readout prints.
    const conn = resolveConnection(eco, componentsFor(d.ownerId), d);
    const damC = damFactorsFor(d.owner === me.id ? me : rival, d, conn?.factory);
    ui.showDepotCard({
      title: `${(() => { const c = depotCargo(eco, d); return c ? DEPOT_TREE[c].name : "Depot"; })()} · level ${lvl}`,
      yieldNow: depotYield(d),
      cap: depotYieldCap(lvl),
      nextCap: lvl < DEPOT_LEVELS.max ? depotYieldCap(lvl + 1) : null,
      // BUILD-1 (#460): one currency story — the card quotes the $ its
      // clicks charge (`spendBuild`), never a resource mix.
      upgradeCost: `$${moneyValueOf(DEPOT_UPGRADE_COST)}`,
      retuneCost: `$${moneyValueOf(DEPOT_RETUNE_COST)}`,
      busy: !!tuning,
      statsLine: routeLedgerHtml(d, performance.now()),
      damLine: damC.dam > 0 ? `dam: ×${1 + damC.dam} — hydro dam nearby` : null,
      // TRAFFIC-INCOME: town traffic slowing this depot's lorries costs income.
      trafficLine: trafficFactorOf(d.id) < 0.95
        ? `Traffic delay −${Math.round((1 - trafficFactorOf(d.id)) * 100)}% — build your own road to avoid town traffic`
        : null,
      lastStars: d.lastStars,
      fleet: fleetCardFor(d),
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
      const score = sabotagedScore(rivalTuningScore(key, 0, rules, tier), rival.blackMarket, marketMs);
      h.yield = rivalYieldForShare(score / TUNING.targetScore, depotYieldCap(h.level));
      tuned.add(h.id);
      // L14 (#229): the tier the session settled on, stamped exactly as a
      // played session stamps it (`settleSession` above). Without it the L6
      // re-match credit is UNREADABLE for a rival Depot — `retuneOwed` reads
      // `tuneTier` against the live tier, and `undefined` is what "never
      // settled" means — so a Normal rival could never re-tune the Depot it
      // paved, which is precisely the one the player gets a key for.
      h.tuneTier = tier;
      // #461 TUNE-1: remember rival's star rating too (saved/synced).
      h.lastStars = tuningStarsFor(score);
      simulated = true;
      // L9 (#224): the simulated session pays the rival the same Gold a
      // played one pays the player, through the same score→Gold curve. This
      // is what keeps its raid table funded once combo Gold stops paying —
      // "Gold still reaches BOTH players at a steady rate without constant
      // matching" is one rule applied twice, not two balance numbers.
      const coins = tuningGoldFor(score);
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
        const fresh = settleTuningYield(level, sabotagedScore(rivalTuningScore(key, 0, rules, tier), rival.blackMarket, marketMs), rules);
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
    // #461: keep rival's stars too.
    head.h.lastStars = tuningStarsFor(sabotagedScore(rivalTuningScore(key, 0, rules, head.tier), rival.blackMarket, marketMs));
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
        // E4 (#268): the lot has to sit on one level.
        "not-flat": "A depot needs flat ground — its 2×2 lot must sit on one level.",
      };
      toast(message[plan.code ?? ""] ?? "Can't build there.", "bad");
      if (p === me) flashAt(tx, ty, plan.why ? `Depot: ${plan.why}` : "Can't build here");
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
      if (p === me) flashAt(tx, ty, "Finish the tuning session first");
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
    const price = priceDepot(buildPurse(p), p.freeDepots, { cargo, tier: p.depotTier, newLoop });
    if (price.locked && price.type) {
      const need = price.tier + 1;
      toast(
        `A ${price.type.name} needs rung ${need} of the depot tree — ${rungLabel(p.depotTier)}. Tune a Depot to open it.`,
        "bad",
      );
      if (p === me) flashAt(tx, ty, `${price.type.name}: rung ${need} locked`);
      return false;
    }
    // PERK-1 (#600): the Yard Deal — the Depot bill prices in its own class.
    // `priceDepot` still QUOTES the resource purse untouched; the seat's
    // money leg (refusal, charge, undo) all read this one number, so the
    // button label, the refusal and the charge are one number (W1).
    const priceUsd = seatCostOf(p, price.cost, "depot");
    if (!canPayBuild(p, price.cost, "depot")) {
      const label = depotTypeLabel(price.type);
      // BUILD-1 (#460): one currency story — the refusal quotes the $ the
      // build charges and how much is short, never a resource mix.
      toast(`Not enough money — a ${label} costs $${priceUsd}, ${moneyFix(priceUsd, p.money)}.`, "bad");
      if (p === me) flashAt(tx, ty, `Not enough money — ${moneyFix(priceUsd, p.money)}`);
      return false;
    }
    if (!spendBuild(p, price.cost, "depot")) return false; // guard; the checks above hold
    p.freeDepots = price.freeLeft;
    const firstDepot = p === me && !eco.harvesters.some((x) => x.owner === p.id);
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
    // BUILD-1 (#460): the misclick rescue — the record carries exactly what
    // the build took ($ charged, free allowance spent) so the undo returns it.
    recordUndo({
      kind: "harvester", harvesterId: h.id,
      money: priceUsd, freeDepotsSpent: price.free,   // PERK-1: refund what the perk price charged
    }, p);
    if (p === me) sfx.play("build");      // SFX-01
    // VO-1: the opening depot is the player's line; a later claim is the rival's.
    if (firstDepot) voiceCue("player:first-depot");
    else if (p === me && served.length && phase !== "setup-harvester") voiceCue("rival:industry-lost");
    syncWorld();
    rescoreNow();
    // Gold Mine warning: the moment the PLAYER stands a Depot beside a Gold
    // Mine, Torvin warns that chasing gold is a young man's game — it drops a
    // sixth colour into the player's own board and a coin buys only Black
    // Market spite aimed at the one rival who'd rather you didn't. He fires
    // the speech to cover his own skin, and the pool rotates so a second gold
    // depot hears a different version. Solo only: in a hosted game seat 1 is a
    // person, not Torvin.
    if (p === me && isSolo() && served.some((ind) => ind.type === "gold_mine")) {
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
    guide?.emit({ kind: "build", what: "depot" });
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
  function placePlant(tx: number, ty: number, p: PlayerState, rot = 0): boolean {
    const blocked = townBlockedFor(p, tx, ty);
    if (blocked) {
      if (p === me) { toast(blocked, "bad"); flashAt(tx, ty, "Rival's town"); }
      return false;
    }
    const why = plantRefusal(grid, track, eco, tx, ty, rot);
    if (why !== null) {
      if (p === me) {
        toast(PLANT_REFUSAL_TEXT[why], "bad");
        // The toast says the rule; the flash — one short line at the refused
        // spot — says where the thing the player aimed at actually goes.
        flashAt(tx, ty, PLANT_FLASH_TEXT[why] ?? "Can't build here");
      }
      return false;
    }
    if (!canPayBuild(p, PLANT_COST)) {
      if (p === me) {
        toast(`Not enough money — a processing plant costs $${moneyCostOf(PLANT_COST)}.`, "bad");
        flashAt(tx, ty, `Plant costs ${plantCostLabel()}`);
      }
      return false;
    }
    if (!spendBuild(p, PLANT_COST)) return false;            // charged exactly once
    const plant = addPlant(grid, track, eco, p.id, p.i + 1, tx, ty, rot);
    if (!plant) {                                        // unreachable; refund
      earn(p, PLANT_COST);
      return false;
    }
    // BUILD-1 (#460): undoable like every other building — the record keeps
    // the $ it cost; the tiles come back because the footprint is derived.
    recordUndo({
      kind: "plant", factoryId: plant.id,
      money: moneyCostOf(PLANT_COST), freeDepotsSpent: false,
    }, p);
    // SFX-01: the crate, then — because a plant is a Victory Point — the
    // star bell from `rescoreNow` a few lines below. Thunk, then chime.
    if (p === me) sfx.play("build");
    syncWorld();
    rescoreNow();
    if (p === me) {
      const n = plantsOf(eco, p.id).length;
      toast(`Processing plant #${n} raised beside the town. Connect depots to it — they all feed the same board.`, "good");
    }
    return true;
  }

  // ══ #456 LEVEL GROUND ══════════════════════════════════════════════════
  // The terraform tool's game half. The RULE (plan, refusals, ramps, the
  // price formula) is pure in `level-ground.ts`; here are the four things
  // only the game can do: pay, write through the map seam + invalidate every
  // height cache, speak MP (guest intent in, height-edits diff out), and let
  // the rival level a site its planner cannot use.

  /** The bill for `plan.levels` tile-levels — the preview's $ number, spent. */
  function levelBill(levels: number): Purse {
    const bill: Purse = {};
    for (const [k, v] of Object.entries(LEVEL_GROUND_COST)) bill[k as Cargo] = (v ?? 0) * levels;
    return bill;
  }

  /**
   * The ONE commit: pay `plan.money`, write the heights, rebuild exactly the
   * touched caches (elevation lattice, draper, ground chunks, road/rail
   * geometry, decals, terrain-GL chunk mesh), publish when hosting. Used by
   * the local gesture AND by the host applying a guest's intent AND by the
   * rival — one price, one rebuild contract, three callers.
   */
  function commitLevel(p: PlayerState, plan: LevelPlan): boolean {
    if (!plan.changes.length) return false;
    const bill = levelBill(plan.levels);
    if (!canPayBuild(p, bill, "level")) {
      toast(`Not enough money — levelling costs $${seatCostOf(p, bill, "level")}.`, "bad");
      return false;
    }
    if (!spendBuild(p, bill, "level")) return false;
    const changed = applyLevelPlan(grid, plan);
    invalidateElevation(grid);
    invalidateDraper(grid);
    renderer?.heightsInvalidated(changed);
    terrainGl?.heightsChanged(grid, changed);
    if (threeLayer) syncWorld();   // the 3D models ride the new terrain height
    // The 1-second flash at the tile the gesture started from — the eye is
    // already there, and the price it was charged is what it wants to see.
    const [sx, sy] = plan.changes[0];
    if (p === me) flashAt(sx, sy, `Levelled · $${plan.money}`, "good");
    if (p === me) sfx.play("pave", { step: Math.min(6, plan.levels) });
    rescoreNow();
    if (isMp() && !isGuest()) publishNet(performance.now(), true);
    return true;
  }

  /**
   * The gesture's commit seam (the `requestTrackBuild` pattern): plan the
   * rectangle toward `target` (the drag-start tile's height, or its ±1 for
   * the Shift/Alt nudge), send a GUEST's levelling to the host as an intent,
   * everyone else commits locally. Returns the plan either way so the caller
   * can toast/flash the refusal the plan carried.
   */
  const requestLevelBuild = (
    ax: number, ay: number, bx: number, by: number, target: number,
  ): LevelPlan | null => {
    if (phase !== "play") return null;
    const plan = planLevel(grid, rectTiles(ax, ay, bx, by), { track }, target);
    if (!plan.changes.length) {
      if (plan.refused.length) {
        toast(LEVEL_REFUSAL_TEXT[plan.refused[0][2]], "bad");
        flashAt(plan.refused[0][0], plan.refused[0][1], LEVEL_REFUSAL_TEXT[plan.refused[0][2]]);
      }
      return plan;
    }
    if (isMp() && isGuest()) {
      // Guest levelling is validated and priced by the host — `applyGuestIntent`
      // re-plans the same rectangle and charges MY seat's purse there.
      net?.sendIntent("build", { do: "level", ax, ay, bx, by, target });
      return plan;
    }
    commitLevel(me, plan);
    return plan;
  };

  /**
   * GUEST: the host's edited heights ARE the world's. The wire carries the
   * whole diff from the seed map, so this resets to the seed heights and
   * applies it — and invalidates exactly the tiles whose byte moved (old vs
   * new), so one changed tile rebuilds one chunk, not the island.
   */
  function applyHostHeights(flat: readonly number[] | undefined): void {
    if (!grid.height || !seedHeights || !flat) return;
    const before = Uint8Array.from(grid.height);
    grid.height.set(seedHeights);
    applyHeightEdits(grid, flat);
    const changed: [number, number][] = [];
    for (let i = 0; i < grid.height.length; i++) {
      if (grid.height[i] !== before[i]) changed.push([i % MAP_W, Math.floor(i / MAP_W)]);
    }
    if (!changed.length) return;
    invalidateElevation(grid);
    invalidateDraper(grid);
    renderer?.heightsInvalidated(changed);
    terrainGl?.heightsChanged(grid, changed);
    if (threeLayer) syncWorld();   // the 3D models ride the new terrain height
  }

  /**
   * THE RIVAL HOOK (the ticket's "may use it"): when the rival's planner can
   * find NO flat Depot lot (or no flat plant site), level the cheapest
   * levelable lot one step toward flat — same rule, same price, its purse.
   * Returns true when it levelled (the turn counts the action and syncs).
   */
  function rivalLevelStep(kind: "depot" | "plant"): boolean {
    if (!grid.height || !elevationActive(grid)) return false;
    const rival = players.find((pl) => !pl.human);
    if (!rival || !canPayBuild(rival, levelBill(1))) return false;
    const lots: [number, number][] = [];
    if (kind === "depot") {
      for (const ind of grid.industries) {
        if (lockedIndustryIdsFor(eco, rival.id).has(ind.id)) continue;
        for (const s of depotSites(grid, ind)) lots.push([s.tx, s.ty]);
      }
      // A flat lot already stands waiting — the planner will take it.
      if (lots.some(([x, y]) => footprintFlat(grid, depotTiles(x, y)))) return false;
    } else {
      if (chooseAiPlantSpot(grid, track, eco, rival.id)) return false;
      for (const t of grid.towns) {
        for (let r = 1; r <= 2; r++) {
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = t.tx + dx, y = t.ty + dy;
            if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
            if (plantRefusal(grid, track, eco, x, y) === "not-flat") lots.push([x, y]);
          }
        }
      }
    }
    // The CHEAPEST legal lot: level its whole footprint toward the
    // footprint's own median height — the ticket's simple case ("one tile is
    // too high on a flat site") generalised to one plan, one price.
    let best: LevelPlan | null = null;
    for (const [x, y] of lots) {
      const fp = kind === "depot" ? depotTiles(x, y) : plantFootprintTiles(x, y);
      const hs = fp.map(([hx, hy]) => heightAt(grid, hx, hy));
      const mid = [...hs].sort((a, b) => a - b)[Math.floor(hs.length / 2)];
      const plan = planLevel(grid, fp, { track }, mid);
      if (plan.changes.length && (!best || plan.money < best.money)) best = plan;
    }
    return best ? commitLevel(rival, best) : false;
  }

  function commitTrackDrag(p: PlayerState, pv: DragPreview, kind: TrackKind, tier: RoadTierKey = "road") {
    // W2: every tile the drag lays is stamped with the builder's owner id,
    // so the committed road is exactly the tiles that join `p`'s network.
    const res = commitDrag(track, kind, pv, p.i + 1, kind === "road" ? tier : "road");
    // BUILD-1 (#460): road tiles are builds too — they can attach to a fresh
    // Depot's entrance, so laying them closes the undo window.
    if (res.built.length) noteWorldBuild();
    // The first human track on the map retires the "connect your depot to
    // your Factory" guidance banner — the guidance is done, and a banner
    // over the map after the first road reads as a popup blocking the game.
    if (p === me && res.built.length && !firstTrackBuilt) {
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
    if (p === me && res.built.length) {
      sfx.play(kind === "road" ? "pave" : "place", { step: res.built.length });
    }
    // W1: the commit spends EXACTLY what the preview charged. The free
    // allowance and the per-tile costs were computed by `previewDrag` over
    // the same cost model the preview drew, so "what you see" and "what you
    // are charged" are one number. `spend` itself is affordability-guarded,
    // so even a stale preview can never push a purse negative.
    p.freeTrack = Math.max(0, p.freeTrack - pv.free);
    if (Object.keys(pv.cost).length && !spendBuild(p, pv.cost, "road")) {
      // Unreachable in practice (the preview refused unaffordable tiles);
      // the guard is what makes the invariant hold regardless.
      toast("Not enough money.", "bad");
    }
    for (const [bx, by] of res.built) {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = bx + dx, y = by + dy;
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
      }
    }
    syncWorld();
    rescoreNow();
    // TUT-03 (#422): the guide's "join Depot to Factory" step ends on the
    // drag, not on the button — the player laid the road themselves.
    if (p === me && res.built.length) {
      // Both tiers are a ROAD to the guide: the lesson is "join the Depot to
      // the Factory", whichever tile the player reached for.
      const connected = !opts.tutorialSection || eco.harvesters.some((h) =>
        h.owner === me.id && resolveConnection(eco, buildAllComponents(track, me.i + 1), h).factory);
      if (connected) {
        guide?.emit({ kind: "build", what: "road" });
        if (opts.tutorialSection && voicedIncome) guide?.emit({ kind: "game", name: "first-income" });
      }
    }
    if (pv.free > 0) toast(`${pv.free} free setup tile${pv.free > 1 ? "s" : ""} used.`, "info");
  }

  /**
   * MP-05: `p` is the seat doing the demolishing. It defaults to the local
   * player, so every existing call site (the click, the e2e twin) is
   * unchanged, while the host can run the SAME path for a guest intent — the
   * "one cost model, one rule" invariant extended to the guest's actions.
   */
  function doDemolish(tx: number, ty: number, p: PlayerState = me) {
    // ── R3 (#270): the dam comes down like any other structure ────────────
    // Either footprint tile (the river tile or the bank) removes it, with
    // the same owner gate as every other build and the floor(50%) refund.
    const dd = damAtTile(tx, ty);
    if (dd) {
      if (dd.owner !== p.id) {
        toast("That dam isn't yours.", "bad");
        if (p === me) flashAt(tx, ty, "Not yours to remove");
        return;
      }
      demolishDam(tx, ty, p);
      return;
    }
    // ── RAIL-04 (#178): the railway comes down through this same tool ───────
    // A platform or a train depot first (its footprint tiles are what a player
    // clicks), then a rail tile. Both are owner-scoped like the road tiers, and
    // both refuse rather than destroy a train: a structure a train is standing
    // on, and a tile a locomotive or its wagon occupies.
    const rs = structureAt(rail, tx, ty);
    if (rs) {
      if (rs.ownerId !== p.i + 1) {
        toast("That railway isn't yours.", "bad");
        if (p === me) flashAt(tx, ty, "Not yours to remove");
        return;
      }
      const cost = rs.kind === "platform" ? RAIL_COSTS.platform : rs.kind === "loop" ? RAIL_COSTS.loop : RAIL_COSTS.depot;
      const gone = demolishStructure(rail, rs.id);
      if (!gone && rs.kind === "loop") {
        // FLEET-2 (#596): a train is on it, or the trains sharing the line still need it.
        toast("Trains on this line still need the Passing Loop — sell a train or wait for it to clear.", "bad");
        if (p === me) flashAt(tx, ty, "Trains need this loop");
        return;
      }
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
        if (p === me) flashAt(tx, ty, based ? "Train is based here" : "A train is on it");
        return;
      }
      // #142: demolition returns floor(50%) of the build price, and the
      // platform's ★ goes with it (`rescoreNow` below revokes it).
      // PERK-1 (#600): the salvage refunds in the class the build PAID — a
      // platform and a train depot are no longer "rail" to the perk table.
      const refundCls: BuildClass = rs.kind === "platform" || rs.kind === "loop" ? "platform" : "trainDepot";
      const refund = resaleValue(cost);
      if (Object.keys(refund).length) refundBuild(p, refund, 1, refundCls);   // ECON-1: money back (CAST-1: of what was paid)

      dropPlatformDepot(rs.id);
      if (p === me) sfx.play("demolish");
      // demolishStructure has already dropped any line that lost a platform —
      // and a depot can no longer come down under its train (that refusal is
      // the `based` branch above), so no train is ever deleted by demolition.
      noteWorldBuild();      // BUILD-1 (#460): a demolish closes undo windows
      syncWorld();
      rescoreNow();
      toast(`${railKindName(rs.kind)} removed${Object.keys(refund).length ? ` — ${railCostLabel(refund)} salvaged` : ""}.`, "info");

      return;
    }
    if (hasRail(rail.rail, tx, ty)) {
      if (rail.rail.owner[tIdx(tx, ty)] !== p.i + 1) {
        toast("That rail isn't yours.", "bad");
        if (p === me) flashAt(tx, ty, "Not yours to remove");
        return;
      }
      if (rail.structures.some((s) => s.kind === "loop" && loopRun(s).some(([x, y]) => x === tx && y === ty))) {
        // FLEET-2 (#596): the loop stands on this run - take the loop down first.
        toast("A Passing Loop stands beside this rail — demolish the loop first.", "bad");
        if (p === me) flashAt(tx, ty, "Loop on this rail");
        return;
      }
      if (trainOccupies(rail, tx, ty)) {
        toast("A train is standing there — move the line first.", "bad");
        if (p === me) flashAt(tx, ty, "A train is on it");
        return;
      }
      demolishRail(rail, tx, ty);
      // A rail tile is 1 Stone, so floor(50%) is nothing — said out loud so
      // the refund line is never a mystery.
      if (p === me) sfx.play("demolish", { gain: 0.6 });
      noteWorldBuild();      // BUILD-1 (#460): a demolish closes undo windows
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
      if (p === me) sfx.play("demolish");   // SFX-01
      noteWorldBuild();      // BUILD-1 (#460): a demolish closes undo windows
      syncWorld(); rescoreNow();
      toast("Depot removed.", "info");
      return;
    }
    // PP-06: a plant is demolishable like any other building — but never the
    // last one, or the player would have nowhere to deliver.
    const pi = eco.factories.findIndex((f) => f.owner === p.id
      && tileInFootprint(tx, ty, f.tx, f.ty, factoryFp[0], factoryFp[1], f.rot ?? 0));
    if (pi >= 0) {
      if (plantsOf(eco, p.id).length <= 1) {
        toast("You can't demolish your only processing plant.", "bad");
        if (p === me) flashAt(tx, ty, "Your last plant stays");
        return;
      }
      eco.factories.splice(pi, 1);
      if (p === me) sfx.play("demolish");   // SFX-01
      noteWorldBuild();      // BUILD-1 (#460): a demolish closes undo windows
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
      if (p === me) sfx.play("demolish");
      noteWorldBuild();      // BUILD-1 (#460): a demolish closes undo windows
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
      if (p === me) flashAt(tx, ty, publicRoad ? "Public road — can't tear up" : "Nothing to demolish");
      return;
    }
    // Demolition refunds. A paved Road pays nothing back: its price is
    // dominated by 4 Ore, and the dirt→road pave is what upgrades are for.
    // L2 (#216) and PP-07 made dirt free outright (BUILD_COSTS.dirt = {}),
    // so tearing it up salvages nothing on EITHER loop — a free tile must
    // not mint resources. Tearing it up is free re-routing.
    // SFX-01: timber coming apart — a little further away for a single tile
    // of track than for a whole building.
    if (p === me) sfx.play("demolish", removedKind === "dirt" ? undefined : { gain: 0.8 });
    if (removedKind === "dirt") toast("Dirt Road cleared.", "info");
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
    }
    noteWorldBuild();      // BUILD-1 (#460): a demolish closes undo windows
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
  // Protests live in the `protests` map hoisted above.
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
    // CAST-1: a Fixer card first, else the (perk-priced) Gold.
    if (!payBlackCard(me, "protest")) return false;
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

  // ── Black Market: map + timed session sabotage (BM-2 #560) ────────────────────────────
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
   * Every key the Black Market answers to — map and session cards
   * (priced in `SABOTAGE`) plus the material-priced defence. Derived
   * from the table, so retiring a card is a one-line config change and the
   * UI, the intents and the rival's raid table all follow.
   */
  const BLACK_MARKET_ACTIONS: ReadonlySet<string> = new Set([...Object.keys(SABOTAGE), "security"]);

  // ── CAST-1: the managers at the Black Market (docs/CAST.md) ──────────────
  /** The Gold a sabotage card costs THIS seat (Dolores pays 10% more). */
  const blackGoldFor = (p: PlayerState, key: string): number =>
    sabotageGold(SABOTAGE[key]?.gold ?? 0, perkManagerOf(p));
  /** Security Forces for THIS seat: free for Dolores, +50% for Rafael. */
  const securityCostFor = (p: PlayerState): Purse =>
    securityCost(SECURITY_ISO_COST as Partial<Record<Cargo, number>>, perkManagerOf(p)) as Purse;
  /** Rafael's free cards left right now, on the match's play clock. */
  const fixerLeftFor = (p: PlayerState): number => fixerLeft(p.fixer, perkManagerOf(p), marketMs);
  /**
   * Pay for a sabotage card: one of Rafael's free cards when he has one, else
   * the seat's Gold. Returns an undo (the "nothing to hit" refund) or null
   * when the seat cannot pay — the toast has already said why.
   */
  const payBlackCard = (p: PlayerState, key: string): (() => void) | null => {
    const free = spendFixer(p.fixer, perkManagerOf(p), marketMs);
    if (free) {
      const before = p.fixer;
      p.fixer = free;
      return () => { p.fixer = before; };
    }
    const gold = blackGoldFor(p, key);
    if ((p.purse.gold ?? 0) < gold) { toast(`Needs ${gold} Gold.`, "bad"); return null; }
    spend(p, { gold });
    return () => earn(p, { gold });
  };
  /** Can this seat pay for `key` right now (a free card or the Gold)? */
  const canPayBlackCard = (p: PlayerState, key: string): boolean =>
    fixerLeftFor(p) > 0 || (p.purse.gold ?? 0) >= blackGoldFor(p, key);

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
  /**
   * BATTLE-1 (#468): the stakes card over the map — the live numbers a duel
   * is for, then Accept or Decline. Open for the player's own challenge
   * (Accept pays the Gold and calls the fight) and for a rival's challenge
   * (Accept defends; Decline forfeits, exactly as the offer card always did).
   */
  let stakesCard: StakesCardHandle | null = null;

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
    id == null ? "the city" : grid.towns[id]?.name ?? `Town ${id + 1}`;
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

  function closeStakesCard(): void {
    stakesCard?.destroy();
    stakesCard = null;
  }

  /** The live facts behind a stake's stakes card (null for fight-offs). */
  const stakeFactsNow = (stake: MapBattleStake): BattleStakeFacts | null =>
    battleStakeFacts(eco, stake, {
      nameOf: (id) => seatName(id),
      tickMs: HARVEST_MS,
      now: performance.now(),
    });

  /** One "income here" row value, honest about whose purse it reads. */
  const incomeRow = (facts: BattleStakeFacts): string => {
    if (facts.holderIncomePerMin <= 0) {
      return facts.holder === "Unclaimed" ? "nothing yet — no one draws here" : `${facts.holder} draw${facts.holder === "You" ? "" : "s"} nothing here right now`;
    }
    const cargo = facts.holderIncomeCargo ? ` ${CARGO[facts.holderIncomeCargo].name}` : "";
    return `${facts.holderIncomePerMin}/min${cargo} — ${facts.holder}`;
  };

  /**
   * BATTLE-1 (#468): the stakes card before a duel. `role` picks the doors:
   *   challenger — Accept pays the Gold and calls the fight (backing out
   *                spends nothing, says so plainly);
   *   defender   — Accept defends the site; Decline FORFEITS it, exactly as
   *                the old offer card's Decline did (silence is a fold too).
   * Nothing here changes a rule: the bill, the cooldown and the offer clock
   * stay exactly where they were — the card only stands between the offer
   * and the duel.
   */
  function openChallengeStakes(
    stake: MapBattleStake,
    role: "challenger" | "defender",
    opts: { onAccept: () => void; onDecline?: () => void; until?: number | null },
  ): void {
    closeStakesCard();
    if (stake.kind === "fightoff") return;   // a fight-off's offer card speaks
    const facts = stakeFactsNow(stake);
    if (!facts) return;
    const gold = BATTLE_RULES.challengeGold;
    const rows: StakesRow[] = [
      { label: "Site", value: facts.site },
      { label: "Held by", value: facts.holder },
      {
        label: "Hold ★",
        value: `+${facts.holdStars}★ while held (cap ${facts.holdCap}★ a seat)`,
      },
      ...(facts.cityStarsPerTier > 0
        ? [{ label: "City ★", value: `a closed plant gives up ${facts.cityStarsPerTier}★ a tier` }]
        : []),
      { label: "Income here", value: incomeRow(facts) },
      {
        label: role === "challenger" ? "Cost" : "They paid",
        value: role === "challenger"
          ? `${gold} Gold — charged when you accept`
          : `${gold} Gold to call this fight`,
      },
      { label: "Difficulty", value: `${skill().label} — ${rival.name}'s play` },
    ];
    const declineNote = role === "challenger"
      ? "Backing out now spends nothing — the site stays as it is."
      : `Declining forfeits: ${seatName(stake.challengerId)} wins the fight and the site moves. Letting the clock run out forfeits too.`;
    stakesCard = openStakesCard(ui.el, {
      title: role === "challenger" ? `Challenge — ${facts.site}` : `${rival.name} challenges you`,
      subtitle: role === "challenger"
        ? `Call a duel for ${facts.site} — win and the map moves your way.`
        : `They are fighting for ${facts.site}. Defend it, or give it up.`,
      rows,
      declineNote,
      acceptLabel: role === "challenger" ? `Accept — pay ${gold} Gold` : "Accept — fight for it",
      declineLabel: role === "challenger" ? "Not now" : "Decline — forfeit",
      until: opts.until ?? null,
      onAccept: () => {
        stakesCard = null;
        opts.onAccept();
      },
      onDecline: () => {
        stakesCard = null;
        opts.onDecline?.();
      },
      onClose: () => {
        stakesCard = null;
      },
    });
  }

  function announceVerdict(stake: MapBattleStake, verdict: ReturnType<typeof settleMapBattle>, playerWon: boolean | null): void {
    // BATTLE-1 (#468): the fight's verdict rings. SFX-1's dedicated battle
    // cues are not on main yet, so these are the shipped table's — "victory"
    // and "defeat" are the two a verdict has always had. Re-check when #463
    // lands.
    if (playerWon === true) sfx.play("victory");
    else if (playerWon === false) sfx.play("defeat");
    if (stake.kind === "fightoff") {
      if (verdict === "cancelled") {
        toast("You fought it off — their Gold stays spent either way.", "good");
        voiceCue("player:battle-won");
        voiceCue("rival:battle-lost");
      } else if (playerWon === false) {
        voiceCue("player:battle-lost");
        voiceCue("rival:battle-won");
      }
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
    // VO-1: battle won/lost, already on the toast. Industry conquest is the
    // "they took it / you took it" line the rival keeps for the feed.
    if (playerWon === true) {
      voiceCue("player:battle-won");
      voiceCue("rival:battle-lost");
    } else if (playerWon === false) {
      voiceCue("player:battle-lost");
      voiceCue("rival:battle-won");
    }
    if (verdict === "conquest" && stake.kind === "industry" && playerWon !== null) {
      voiceCue(playerWon ? "rival:industry-lost" : "rival:industry-taken");
    }
  }

  function finishStake(stake: MapBattleStake, won: boolean | null): ReturnType<typeof settleMapBattle> {
    const verdict = settleMapBattle(eco, stake, won);
    // Owner (2026-09-28): the Gold a challenge costs is the POT — it goes to
    // whoever wins the fight, challenger or defender.
    if (won !== null && stake.kind !== "fightoff") {
      const winnerId = won ? stake.challengerId : players.find((p) => p.id !== stake.challengerId)?.id;
      const w = players.find((p) => p.id === winnerId);
      if (w) {
        earn(w, { gold: BATTLE_RULES.challengeGold });
        if (w.id === me.id) toast(`+${BATTLE_RULES.challengeGold} Gold — you take the challenge pot.`, "good");
      }
    }
    // END-1 (#472): battles won highlight
    try {
      if (won !== null) {
        const playerIsChallenger = stake.kind === "fightoff" ? true : stake.challengerId === me.id;
        const playerWon = stake.kind === "fightoff" ? won : (playerIsChallenger ? won : !won);
        const winnerSeat = playerWon ? 0 : 1;
        const loserSeat = playerWon ? 1 : 0;
        const t = (performance.now() - matchHistory.startMs) / 1000;
        recordEvent(matchHistory, { kind: "battle", winner: winnerSeat as 0 | 1, loser: loserSeat as 0 | 1, t });
        // SCEN-2 (#602): a scenario's battle objective counts WINS, whichever
        // side called the fight — a defended fight-off is a battle won.
        if (playerWon && scenarioDef) scenarioBattlesWon++;
      }
    } catch {}
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
    toast(`${p.name} has nothing left to sell — ${other.name} wins.`, other === me ? "good" : "bad");
    presentEnding(null);
  }

  function fightBusy(): boolean {
    return !!(battleScreen || mapStake || pendingFightOff || pendingChallenge || mpOffer || duel || stakesCard);
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
      // A platform-Depot serves its anchor industry, not the 2×2 lot at its
      // origin — the same catchment the economy pays — so a closed platform
      // reads as a closed Depot here too.
      const challengerClosed = eco.harvesters.some((h) => h.owner === stake.challengerId && h.closed
        && industriesInCatchment(grid, h).some((e) => e.id === stake.industryId));
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

  /**
   * B7 (#252): every battle screen gets the "?" (How to Play) and — on the
   * first battle this browser has ever shown — the one-time hint strip.
   */
  const battleOnboarding = () => ({
    onHelp: () => { showBattleHowto(); },
    firstHint: takeFirstBattleHint(),
  });

  function openMapBattle(stake: MapBattleStake, seed: number, stakeText: string): void {
    mapStake = stake;
    const screen = startBattleScreen(seed, [
      { id: me.id, name: me.name, portrait: seatFace(me), depots: mapDepotCargos(me.i + 1) },
      { id: rival.id, name: rival.name, portrait: seatFace(rival), depots: mapDepotCargos(2 - me.i) },
    ], {
      ...battleOnboarding(),
      // PERK-1 (#600): the player's battle perks, seat 0; the AI rival's
      // seat carries no manager, so its seat is the shipped battle exactly.
      perks: [battlePerksOf(perkManagerOf(me)), null],
      stake: stakeText,
      consequence: battleConsequence(stake),
      // B4 (#249): the rival fights its live skill's line — watchable.
      opponentMove: (b) => chooseBattleMove(b, skill().key),
      onClose: (result) => {
        battleScreen = null;
        const s = mapStake;
        mapStake = null;
        // TUT-03 (#422): the guide's battle step ends when the fight does —
        // win, lose or draw, the player has seen one.
        guide?.emit({ kind: "game", name: "battle-finished" });
        if (!s) return;
        // `result.winner` is the SEAT (0 = the player, the contender list's
        // first entry). `settleMapBattle` speaks for the CHALLENGER (industry
        // and town stakes) or the defender (fight-offs).
        // B7 (#252): this used to call `settleMapBattle` directly — so a solo
        // battle never rescored (the ★ lagged until the next build), a lost
        // town never closed its plant's tiers, and a town stake the RIVAL
        // called was read from the player's side. It now settles exactly as
        // the multiplayer `settleDuel` does, and a draw is a draw (it used
        // to count as the defender's win).
        const iWon = result.winner === 0;
        const won = !result.over || result.winner === null ? null
          : s.kind === "fightoff" ? iWon
            : (s.challengerId === me.id ? iWon : !iWon);
        // BATTLE-1 (#468): the ledger is read BEFORE the settle (so the ★ and
        // the income the aftermath reports are the fight's own delta, not the
        // whole match), and the aftermath card plays after it.
        const before = aftermathBefore(s);
        const verdict = finishStake(s, won);
        if (verdict === "lands" && s.kind === "fightoff") landFightOff(s.pending, performance.now());
        showBattleAftermath(s, verdict, won, before);
      },
    });
    battleScreen = screen;
  }

  /** The ★ and site income the fight starts from (the aftermath's delta base). */
  function aftermathBefore(s: MapBattleStake) {
    return {
      stars: vpFor(score, me.id),
      rivalStars: vpFor(score, rival.id),
      myIncome: s.kind === "fightoff" ? null : siteIncomeFor(s, me.id),
      rivalIncome: s.kind === "fightoff" ? null : siteIncomeFor(s, rival.id),
    };
  }

  /** The per-minute income one seat draws at/through this stake's site. */
  function siteIncomeFor(
    s: MapBattleStake, who: string,
  ): { perMin: number; cargo: string | null } {
    if (s.kind === "industry") {
      const inc = siteIncome(eco, { kind: "industry", industryId: s.industryId }, who, HARVEST_MS, performance.now());
      return { perMin: inc.perMin, cargo: inc.cargo ? CARGO[inc.cargo].name : null };
    }
    if (s.kind === "town") {
      return { perMin: siteIncome(eco, { kind: "town", townId: s.townId }, who, HARVEST_MS, performance.now()).perMin, cargo: null };
    }
    return { perMin: 0, cargo: null };
  }

  /**
   * BATTLE-1 (#468) — the aftermath: the site duel settles and the map says
   * so. The camera flies to the site (instant under reduced motion), a flag
   * swap names who holds it now, the dock card reports the REAL deltas — the
   * ★ and income/min the fight itself moved — and the Feed logs the line.
   * A draw or a fight-off skips the choreography: nothing changed hands.
   */
  function showBattleAftermath(
    s: MapBattleStake,
    verdict: ReturnType<typeof settleMapBattle>,
    won: boolean | null,
    before: { stars: number; rivalStars: number; myIncome: { perMin: number; cargo: string | null } | null; rivalIncome: { perMin: number; cargo: string | null } | null },
  ): void {
    if (s.kind === "fightoff") return;
    const playerWon = won === null ? null : (s.challengerId === me.id ? won : !won);
    const site = s.kind === "industry" ? industryName(s.industryId) : townName(s.townId);
    const tile = stakeSiteTile(eco, s);
    const stars = Math.floor(vpFor(score, me.id)) - Math.floor(before.stars);
    const rivalStars = Math.floor(vpFor(score, rival.id)) - Math.floor(before.rivalStars);
    const myIncome = siteIncomeFor(s, me.id);
    const rivalIncome = siteIncomeFor(s, rival.id);

    // the camera and the flag, when the fight had a place and a winner
    if (tile) flyCameraTo(tile.tx, tile.ty);
    if (tile && playerWon !== null) {
      const holder = s.kind === "industry"
        ? contestedIndustries(eco).get(s.industryId)
        : eco.townHolds?.get(s.townId)?.holder ?? null;
      const holderName = holder ? seatName(holder) : seatName(null);
      floats.add(`⚔ ${holderName} hold${holderName === "You" ? "" : "s"} ${site}`, tile.tx, tile.ty, {
        cls: "flag-swap", life: 2600, now: performance.now(),
      });
    }

    // the aftermath card — the real numbers, or nothing when nothing moved
    const lines: string[] = [];
    if (verdict === "draw" || playerWon === null) {
      lines.push(`A draw — ${site} stands as it was.`);
    } else {
      lines.push(aftermathSiteLine(s, verdict, playerWon, site));
    }
    if (stars !== 0 || rivalStars !== 0) {
      const mine = stars === 0 ? "no ★ change for you" : `you ${stars > 0 ? "+" : "−"}${Math.abs(stars)}★`;
      const theirs = rivalStars === 0 ? "" : ` · ${rival.name} ${rivalStars > 0 ? "+" : "−"}${Math.abs(rivalStars)}★`;
      lines.push(`${mine}${theirs}`);
    }
    if (before.myIncome && before.myIncome.perMin !== myIncome.perMin) {
      const cargo = myIncome.cargo ? ` ${myIncome.cargo}` : "";
      lines.push(`Your income here: ${myIncome.perMin}/min${cargo} (was ${before.myIncome.perMin}/min)`);
    }
    if (before.rivalIncome && before.rivalIncome.perMin !== rivalIncome.perMin) {
      lines.push(`${rival.name}'s income here: ${rivalIncome.perMin}/min (was ${before.rivalIncome.perMin}/min)`);
    }
    showBattleCard(`aftermath:${Date.now()}`, {
      title: `Aftermath — ${site}`,
      lines,
      actions: [{ label: "Close", primary: false, onClick: () => closeBattleCard() }],
    });
    const outcome = verdict === "draw" ? "a draw"
      : playerWon
        ? (verdict === "held" ? "you held it" : "you take it")
        : (verdict === "held" ? `${rival.name} holds it` : `${rival.name} takes it`);
    ui.feed(`Battle for the ${site}: ${outcome}`
      + (stars !== 0 ? ` · you ${stars > 0 ? "+" : "−"}${Math.abs(stars)}★` : ""), me.name);
  }

  /** One line on the aftermath card: what the settle did to the site. */
  function aftermathSiteLine(
    s: MapBattleStake, verdict: string, playerWon: boolean, site: string,
  ): string {
    const what = s.kind === "town" ? "city" : "site";
    if (verdict === "rights" || verdict === "shared") {
      return playerWon ? `First win — you share the ${what} at ${site}.` : `They share the ${what} at ${site} now.`;
    }
    if (verdict === "closed") {
      const mine = s.kind === "industry" ? "Depot" : "plant";
      return playerWon ? `Their ${mine} at ${site} closes — it is yours alone.` : `Your ${mine} at ${site} closes.`;
    }
    if (verdict === "reopened") {
      return playerWon ? `Your ${s.kind === "industry" ? "Depot" : "plant"} at ${site} reopens.` : `Their ${s.kind === "industry" ? "Depot" : "plant"} at ${site} reopens.`;
    }
    if (verdict === "conquest") {
      return playerWon ? `${site} changes hands — now yours.` : `${site} changes hands — now theirs.`;
    }
    return playerWon ? `You held ${site}.` : `They held ${site}.`;
  }

  /**
   * #322: call a fight for an industry. The bill and the player cooldown arm
   * at the call. Decline is a forfeit — the challenger wins.
   */
  /**
   * BATTLE-1 (#468): everything that happens AFTER the stakes card's Accept —
   * the bill, the cooldown, the duel (or, between two people, the offer).
   * The live check runs again: the card stood open for a breath, and the
   * eligibility, the Gold and the cooldown must still hold at the call.
   */
  function callIndustryFight(indId: number): boolean {
    const now = performance.now();
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
    guide?.emit({ kind: "game", name: "challenge-started" });
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

  function challengeIndustry(indId: number): boolean {
    if (opts.tutorialSection === "rivals" && indId !== grid.industries[0]?.id) {
      toast("Challenge the highlighted industry for this lesson.", "info");
      return false;
    }
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
    // BATTLE-1 (#468): the stakes card stands between the click and the
    // charge — the Gold is only spent when the duel is accepted.
    openChallengeStakes(
      {
        kind: "industry", industryId: indId,
        challengerId: me.id, holderId: chk.holder?.owner ?? null,
        challengerHarvesterId: hid(chk.mine), holderHarvesterId: hid(chk.holder),
      },
      "challenger",
      { onAccept: () => { callIndustryFight(indId); } },
    );
    return true;
  }

  /** The call, after the stakes card's Accept — see `callIndustryFight`. */
  function callTownFight(townId: number): boolean {
    const now = performance.now();
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
    const holderId = eco.townHolds?.get(townId)?.holder
      ?? eco.factories.find((f) => !f.closed && f.townId === townId && f.owner !== me.id)?.owner
      ?? null;
    openChallengeStakes(
      { kind: "town", townId, challengerId: me.id, holderId },
      "challenger",
      { onAccept: () => { callTownFight(townId); } },
    );
    return true;
  }

  /** #322: the rival calls a fight — the player may take it or fold. */
  function maybeRivalChallenge(now: number): void {
    if (phase === "won" || inSetup()) return;
    if (fightBusy()) return;
    // FTUE-1 (#464): a skill that never challenges (the trainee) never calls
    // one — not even the boot-fresh clock's first. It still defends.
    if (!skill().challenges) return;
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
    // BATTLE-1 (#468): the stakes card IS the answer — the site, the ★ and
    // income at stake, and a Decline that says plainly it forfeits. The dock
    // card underneath stays (its Fight reopens this card); the offer clock
    // keeps running and silence still folds.
    openDefenderStakes();
  }

  /** The defender's stakes card for the live `pendingChallenge`. */
  function openDefenderStakes(): void {
    const p = pendingChallenge;
    if (!p) return;
    const stake: MapBattleStake = p.kind === "town"
      ? { kind: "town", townId: p.townId ?? 0, challengerId: p.challengerId, holderId: p.holderId }
      : {
        kind: "industry", industryId: p.industryId ?? 0,
        challengerId: p.challengerId, holderId: p.holderId,
        challengerHarvesterId: p.challengerHarvesterId, holderHarvesterId: p.holderHarvesterId,
      };
    openChallengeStakes(stake, "defender", {
      until: p.offerUntil,
      onAccept: () => { acceptChallenge(); },
      onDecline: () => { declineChallenge(); },
    });
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
    closeStakesCard();
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
    closeStakesCard();
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
        target.banditOwner = p.attackerId;
        const def = INDUSTRY_BY_KEY[target.type];
        floats.add("⛓ BLOCKADED", target.tx, target.ty, { cls: "sabotage", now });
        toast(`The Blockade landed on ${def?.name ?? "the industry"} — its depots stop ticking.`, "bad");
        voiceCue("rival:blockade");
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
          // BATTLE-1 (#468): the fight starts from the stakes card — the
          // numbers first, then the doors.
          { label: "Stakes", onClick: () => { openDefenderStakes(); } },
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
      { id: "you", name: g ? rival.name : me.name, portrait: seatFace(g ? rival : me), depots: mapDepotCargos(g ? 2 : 1) },
      { id: "ai", name: g ? me.name : rival.name, portrait: seatFace(g ? me : rival), depots: mapDepotCargos(g ? 1 : 2) },
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
    // PERK-1 (#600): the perks pair follows duelContenders' seat order —
    // seat 0 is the host's seat here, seat 1 the guest's.
    const d = createDuel(seed, nextDuelRules ?? BATTLE_RULES, [players[0], players[1]], now,
      undefined, [battlePerksOf(perkManagerOf(me)), battlePerksOf(perkManagerOf(rival))]);
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
      ...battleOnboarding(),
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
    // PERK-1 (#600): the guest's engine reads the SAME perks the host's does
    // (duelContenders' seat order, from the guest's view).
    const g = isGuest();
    const d = duelFromWire(e, [players[0], players[1]], undefined,
      [battlePerksOf(g ? perkManagerOf(rival) : perkManagerOf(me)), battlePerksOf(g ? perkManagerOf(me) : perkManagerOf(rival))]);
    const screen = openBattleScreen({
      ...battleOnboarding(),
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
    if (phase === "won") return false;
    const now = performance.now();
    if (isSessionSabotage(key)) {
      // Multiplayer has no tuning sessions, so these cards would take Gold for nothing.
      if (!isSolo()) {
        toast(`${SABOTAGE[key].name} only works against tuning sessions — not available in multiplayer.`, "info");
        return false;
      }
      const state = actor.blackMarket ??= readBlackMarket();
      if (marketMs < state.readyAt) {
        toast(`The permit office is lying low — ready in ${Math.ceil((state.readyAt - marketMs) / 1000)}s.`, "info");
        return false;
      }
      if (!payBlackCard(actor, key)) return false;
      const defender = otherSeat(actor);
      if (now < securityOf(defender.id)) {
        state.readyAt = marketMs + SESSION_SABOTAGE_COOLDOWN_MS;
        toast(`Security Forces turned ${SABOTAGE[key].name} away.`, "info");
      } else if (returnToSenderOf(perkManagerOf(defender)) && !defender.sentBack) {
        // PERK-1 (#600): Return to Sender — the match's first card played on
        // her is handed back to its sender (the flag rides the defender's
        // seat, and a card turned away by Security never spends it). The
        // sender's own next session chills instead; Heavy Hands still rides
        // the card — its bonus is the sender's to keep.
        defender.sentBack = true;
        armSessionSabotage(state, state, key, marketMs, sabotageTilesBonus(perkManagerOf(actor)));
        toast(
          `${escText(defender.name)} sent the ${SABOTAGE[key].name} back to ${escText(actor.name)} — ${escText(actor.name)}'s next tuning session is chilled instead.`,
          defender === me ? "good" : "bad",
        );
      } else {
        // PERK-1: Heavy Hands — the sender's frost lands one tile extra.
        armSessionSabotage(state, defender.blackMarket ??= readBlackMarket(), key, marketMs, sabotageTilesBonus(perkManagerOf(actor)));
        toast(`${SABOTAGE[key].name} set against ${escText(defender.name)} — affects newly opened Depot and city tuning sessions.`, defender === me ? "bad" : "good");
      }
      if (isMp()) publishNet(now, true);
      return true;
    }
    if (key === "bandit") {
      // CAST-1: a Fixer card first, else the seat's (perk-priced) Gold.
      const refundCard = payBlackCard(actor, "bandit");
      if (!refundCard) return false;
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
      // PERK-1 (#600): Return to Sender — the match's first Blockade played
      // on her auto-routes to the SENDER'S busiest industry instead (and a
      // card turned away by Security, like the session cards, never spends
      // the bounce).
      const bounced = returnToSenderOf(perkManagerOf(defender)) && !defender.sentBack;
      if (bounced) defender.sentBack = true;
      const target = pickBlockadeTarget(eco, bounced ? actor.id : defender.id, now);
      if (!target) {
        refundCard();   // refund (the Gold, or the Fixer's card); nothing to hit
        if (bounced) defender.sentBack = false;   // nowhere to bounce: the bounce is not spent
        toast("No industry to blockade — gold refunded.", "bad");
        return false;
      }
      // B5 (#250): a Blockade landing on the LOCAL player with no Security up
      // can be FOUGHT OFF — held at the door instead of applied (the hire is
      // already spent, win or lose). MP keeps the old instant apply (B6). The
      // bounced card "lands" on its sender, so the sender is the one who may
      // fight it off.
      const blocked = bounced ? actor : defender;
      if (blocked.id === players[0].id
        && offerFightOff("blockade", actor.id, target.id, undefined, now + BANDIT_MS)) {
        return true;
      }
      target.banditUntil = now + BANDIT_MS;
      target.banditOwner = actor.id;
      const def = INDUSTRY_BY_KEY[target.type];
      // L9 (#224): re-worded against the CLOCK economy — a blockade is not
      // "no one may harvest" any more (nobody harvests by hand), it is "every
      // depot holding that industry stops ticking", which is exactly what
      // `harvesterYield`'s `banditUntil` gate does to the income clock.
      if (bounced) {
        toast(`Returned to sender — the blockade stops ${escText(actor.name)}'s ${def?.name ?? target.type} for ${BANDIT_MS / 1000}s.`,
          blocked === me ? "bad" : "good");
      } else {
        toast(`Blockade set on ${def?.name ?? target.type} — its depots stop ticking for ${BANDIT_MS / 1000}s.`, "good");
      }
      voiceCue("rival:blockade");
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
      if (!canPayBlackCard(actor, "protest")) {
        toast(`Needs ${blackGoldFor(actor, "protest")} Gold.`, "bad");
        return false;
      }
      // PERK-1 (#600): Return to Sender — the match's first card played on
      // her is returned at the door: the crowd auto-places on the SENDER'S
      // own costliest public road (the same auto-target the rival's raid
      // uses), and never needs a click.
      const defender = otherSeat(actor);
      if (returnToSenderOf(perkManagerOf(defender)) && !defender.sentBack) {
        defender.sentBack = true;
        const tile = pickProtestTarget(actor.id, now);
        if (tile) {
          const refund = payBlackCard(actor, "protest");
          if (!refund) {
            defender.sentBack = false;   // the purse emptied mid-buy: not spent
            return false;
          }
          sfx.play("boom", { gain: 0.6 });
          protests.set(tIdx(tile[0], tile[1]), { tx: tile[0], ty: tile[1], until: now + PROTEST_MS, owner: actor.id });
          floats.add("✊ PROTEST", tile[0], tile[1], { cls: "sabotage", now });
          toast(`${escText(defender.name)} sent the protest back to ${escText(actor.name)} — ${escText(actor.name)}'s own road stops for ${fmtProtestLeft(PROTEST_MS)}.`,
            defender === me ? "good" : "bad");
          if (isMp()) publishNet(now, true);
          return true;
        }
        defender.sentBack = false;   // no road of the sender's to stop: not spent
      }
      pendingProtest = true;
      toast(`Protest ready — click any public road to stop every depot routed through it for ${fmtProtestLeft(PROTEST_MS)}.`, "info");
      return true;
    }
    if (key === "security") {
      // PP-08: this is a defensive action, so it is bought with MATERIALS —
      // never with Gold. Insufficient materials refuse the hire and consume
      // nothing (the affordability check runs before any deduction).
      // CAST-1: priced for the buyer — free for Dolores, +50% for Rafael.
      const bill = securityCostFor(actor);
      const affordable = (Object.entries(bill) as [Cargo, number][])
        .every(([k, v]) => (actor.purse[k] ?? 0) >= v);
      if (!affordable) { toast("Not enough materials for Security Forces.", "bad"); return false; }
      spend(actor, bill);
      // A1: Security Forces guard the BUYER's plant against the other seat's
      // sabotage (and, for seat 0, the solo rival's raids — see `rivalRaid`).
      armSecurityFor(actor, now + SECURITY.ms);
      if (actor.id === players[0].id) sfx.play("build");   // SFX-01: a crew sets up on site
      toast(`Security Forces hired — guarded for ${SECURITY.ms / 1000}s.`, "info");
      if (isMp()) publishNet(now, true);
      return true;
    }
    // Unknown/legacy keys cannot spend or mutate a seat.
    toast("That card is no longer on the Black Market.", "info");
    return false;
  }

  function buyBlack(key: string) {
    if (phase === "won") {
      toast("The final ledger is closed. Start a rematch to settle another score.", "info");
      return;
    }
    // The shop's whole inventory, in one place — map/session cards
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
        if (!canPayBlackCard(me, "protest")) {
          toast(`Needs ${blackGoldFor(me, "protest")} Gold.`, "bad");
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

  // ── L8 (#222): legacy quests — definitions now in contract block above
  // (kept for backward compat). Distance cache follows.
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
  let sessionRaidCount = 0;
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
  let rentAnnounced = false;
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
        if (!devUnlimited) {
          const rent = totalStorageRent(seat.purse, storageCapFor(seat.townLevel));
          seat.money -= rent * HARVEST_MS / 60_000;
          if (seat === me && rent > 0 && !rentAnnounced) {
            rentAnnounced = true;
            ui.feed(`Storage rent started — ${storageRentLabel(seat.purse, storageCapFor(seat.townLevel))}. Sell cargo or upgrade your city.`);
          }
        }
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
          // R3 (#270): the dam's two halves, off the SAME read the inspector
          // and the chip rates print — the depot term multiplies the factor
          // (×1.25 when one of the seat's dams reaches this Depot), and the
          // city term adds to the factor's city bonus (the seat's city within
          // range of its dam lifts every Depot that feeds it).
          const damF = damFactorsFor(seat, depot, result.connection?.factory);
          // #462: the same factor the depot ledger and the upgrade preview use
          // (`clockFactorOf`), so a cargo/min on the card is a cargo/min the
          // clock will pay.
          const factor = clockFactorOf({
            yieldLevel: depotYield(depot),
            distanceFactor: distanceInfoFor(depot.id).factor,
            transportFactor: haulFactor(depot),
            dam: damF.dam,
            city: hasCities(seat)
              ? cityBonusFor(seat.id, result.connection?.factory) + damF.damCity
              : Math.max(0, seat.townBonus) + damF.damCity,
          });
          const total = cargoes.reduce((sum, [, amount]) => sum + amount, 0) * factor
            + (loopCarry.get(depot.id) ?? 0);
          const whole = Math.floor(total);
          loopCarry.set(depot.id, total - whole);
          if (whole > 0) {
            // BUILD-1 (#460): cargo just moved through this depot — the undo
            // on its build (if one is still open) dies now.
            flagUndoCargoMoved(depot.id);
            // A depot normally holds one industry/cargo; use the first cargo
            // for the integer credit and retain any sub-unit remainder per
            // depot (one map serves both seats: depot ids are unique).
            earn(seat, { [cargoes[0][0]]: whole } as Purse);
            // CONTRACT-1 (#466): delivery counting at the Factory — cargo actually
            // arriving after acceptance counts toward contracts.
            try {
              const seatIdx = seat.i === 0 ? 0 : 1;
              addDeliveryToContracts(seatIdx as 0 | 1, cargoes[0][0] as Cargo, whole, now);
            } catch {}
            // END-1 (#472): best route highlight — track per-depot totals
            try {
              const seatIdx = seat.i === 0 ? 0 : 1;
              recordDepotDelivery(matchHistory, depot.id, seatIdx as 0 | 1, cargoes[0][0], whole);
              // Also ensure depot event exists for first time
              if (!matchHistory.depotTotals.has(depot.id) || matchHistory.depotTotals.get(depot.id)!.total === whole) {
                const t = (performance.now() - matchHistory.startMs) / 1000;
                // Record first time this depot produced
                if (!matchHistory.events.some((e) => e.kind === "depot" && e.depotId === depot.id)) {
                  recordEvent(matchHistory, { kind: "depot", seat: seatIdx as 0 | 1, depotId: depot.id, cargo: cargoes[0][0], t });
                }
              }
            } catch {}
            // TUT-03 (#422): the guide's own walk — the first cargo that pays
            // is the Logistics step's door, and it fires once per game.
            if (seat === me && !voicedIncome) {
              voicedIncome = true;
              guide?.emit({ kind: "game", name: "first-income" });
            }
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
    // MATCH-2 (#566): the finale runs on real time; a Legendary one holds the
    // results until it has landed (the music plays on under the card).
    finale.tick();
    if (tuning && !tuningResult && !quarry.board.busy && !finaleHolds() && (tuningEndAsked || tuningOver(tuning))) {
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
    if ((isSolo() || aiOpponent) && !tutorialSection) rivalAutoplay(now);
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
    const score = sabotagedScore(rivalTuningScore(skill().key), rival.blackMarket, marketMs);
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
    noteWorldBuild();        // BUILD-1 (#460): the rival's upgrade is a build
    // L17 (#245): the rival's investment shows on the map too — its town
    // takes the same growth step, with the same moment, as the player's.
    const grownRival = rivalCity ? growCity(rivalCity, rival) : growTownForSeat(rival);
    // END-1 (#472): first to each town tier — rival side
    try {
      const t = (performance.now() - matchHistory.startMs) / 1000;
      const lvl = rivalCity ? Math.min(cityOf(rivalCity, rival).level, TOWN_UPGRADES.length) : Math.min(rival.townLevel, TOWN_UPGRADES.length);
      const tid = rivalCity ? rivalCity.id : -1;
      recordEvent(matchHistory, { kind: "town", seat: 1, townId: tid, level: lvl, t });
    } catch {}
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
    // When the shared cooldown allows, alternate Frost and Red Tape.
    // Normal/Hard only (Easy has no raid clock), priced by the shared shop.
    if (newLoop) {
      const key = sessionRaidCount % 2 === 0 ? "frost" : "redTape";
      if (marketMs >= (rival.blackMarket?.readyAt ?? 0)
        && (rival.purse.gold ?? 0) >= blackGoldFor(rival, key) + RIVAL_GOLD_RESERVE
        && buyBlackFor(rival, key)) {
        lastRaid = now;
        sessionRaidCount++;
        return;
      }
    }
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
    // PERK-1 (#600): Return to Sender — the match's first card played on
    // Dolores bounces onto the RIVAL'S OWN route (the hire is paid either
    // way, and a card turned away by Security above never spent the bounce).
    if (returnToSenderOf(perkManagerOf(me)) && !me.sentBack) {
      me.sentBack = true;
      const own = pickProtestTarget(rival.id, now);
      if (own) {
        protests.set(tIdx(own[0], own[1]), { tx: own[0], ty: own[1], until: now + PROTEST_MS, owner: rival.id });
        floats.add("✊ PROTEST", own[0], own[1], { cls: "sabotage", now });
        toast(`Your guard sent the ${def.name} back to the sender — the rival's own road stops for ${fmtProtestLeft(PROTEST_MS)}.`, "good");
        ui.feed(`${rival.name}'s ${def.name} was returned to sender`, rival.name);
        rivalSpeaks("thwarted", "protest");
        if (isMp()) publishNet(now, true);
        return;
      }
      me.sentBack = false;    // nowhere of the rival's to stop: not spent
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
    if (canPayBuild(rival, PLANT_COST)) return false;          // it is buying it this turn
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
  /**
   * ROADS-2 (#393): the rival builds a Highway only where it pays — a LONG,
   * already-paved, level Road route from one of its Depots to its plant
   * (≥ HIGHWAY_MIN_ROUTE tiles), and only while it can afford the upgrade twice
   * over (so a highway never starves its next Depot). One route per turn.
   */
  function rivalHighwayPass(): boolean {
    const HIGHWAY_MIN_ROUTE = 24;
    const mine = eco.factories.filter((f) => f.owner === rival.id && !f.closed);
    if (!mine.length) return false;
    for (const h of eco.harvesters) {
      if (h.owner !== rival.id || h.closed) continue;
      for (const f of mine) {
        const route = depotRouteTiles(eco, h, f);
        if (!route || route.length < HIGHWAY_MIN_ROUTE) continue;
        const tiers = highwayRouteTiers(track, route);
        let ok = true, anyLow = false;
        let cost: Purse = {};
        for (let k = 0; k < route.length && ok; k++) {
          const [x, y] = route[k];
          if (!hasTrack(track, "road", x, y)) { ok = false; break; }
          const c = tierTileCost(track, tiers[k] === ROAD_TIER.ramp ? "ramp" : "highway", x, y);
          if (Object.keys(c).length) { anyLow = true; cost = addCost(cost, c); }
        }
        if (!ok || !anyLow) continue;
        if (!canPayBuild(rival, addCost(cost, cost))) continue;
        if (!spendBuild(rival, cost)) continue;
        // Any road joins a Highway directly now (owner, 2026-09-29), so branch
        // tiles stay Highway; stored Ramps and Overpasses are preserved.
        for (const [k, [x, y]] of route.entries()) {
          const tier = tiers[k];
          if (!Object.keys(tierTileCost(track, tier === ROAD_TIER.ramp ? "ramp" : "highway", x, y)).length) continue;
          setRoadTier(track, x, y, tier);
          renderer?.invalidateTile(x, y);
        }
        ui.feed(`Rival builds a ${route.length}-tile Highway`, rival.name);
        syncWorld();
        rescoreNow();
        return true;
      }
    }
    return false;
  }

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
    if (!spendBuild(rival, plan.cost)) return false;
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
    // PERK-1 (#600): Return to Sender — the match's first card played on
    // Dolores bounces onto the RIVAL'S OWN busiest industry (the hire above
    // is already spent, and a card Security turned away never spent the
    // bounce).
    if (returnToSenderOf(perkManagerOf(me)) && !me.sentBack) {
      me.sentBack = true;
      const own = pickBlockadeTarget(eco, rival.id, now);
      if (own) {
        own.banditUntil = now + BANDIT_MS;
        own.banditOwner = rival.id;
        floats.add("⛓ BLOCKADED", own.tx, own.ty, { cls: "sabotage", now });
        toast(`Your guard sent the blockade back to the sender — the rival's own ${INDUSTRY_BY_KEY[own.type]?.name ?? own.type} stops for ${BANDIT_MS / 1000}s.`, "good");
        rivalSpeaks("thwarted", "bandit");
        return;
      }
      me.sentBack = false;    // the rival holds no industry: not spent
    }
    // B5 (#250): the player may FIGHT OFF a Blockade at the gates (solo; the
    // hire above is already spent either way).
    if (offerFightOff("blockade", rival.id, target.id, undefined, now + BANDIT_MS)) return;
    target.banditUntil = now + BANDIT_MS;
    target.banditOwner = rival.id;
    const def = INDUSTRY_BY_KEY[target.type];
    floats.add("⛓ BLOCKADED", target.tx, target.ty, { cls: "sabotage", now });
    toast(`The rival blockaded your ${def?.name ?? target.type} — its depots stop ticking for ${BANDIT_MS / 1000}s.`, "bad");
    voiceCue("rival:blockade");
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
    if (!railMove || !canPayBuild(rival, railMove.cost)) return { acted: false, laid: [], platform: false };
    const res = executeRailMove(eco, railState, railMove, rival.id, rival.i + 1);
    if (!res) return { acted: false, laid: [], platform: false };
    if (res.refund) refundBuild(rival, res.refund);   // ECON-1: money back
    else if (Object.keys(res.spent).length) chargeBuild(rival, res.spent);
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
  /**
   * R3 (#270): the rival values dam sites the way it values the rest of the
   * map. A site is worth its price when it reaches at least one of the rival's
   * OWN income sources — a Depot (its lot tiles) or one of its cities — within
   * `DAM_RANGE`, AND the rival can pay for it. One dam per turn, the best site
   * by (sources reached, then row-major position). No-op with the rivers
   * option off: no river, no site, ever. Returns whether a dam was built.
   */
  /**
   * FLEET-1 (#595): the rival buys a 2nd lorry for its busiest Depot when it
   * can afford it with a Depot's worth left over. Infrastructure, not a star:
   * no session, and at most one purchase per turn. Same `fleetBuyTruck` (and so
   * the same refusal ladder and price) the player's button runs.
   */
  function rivalTruckStep(): boolean {
    if (!newLoop) return false;
    const owner = rival.i + 1;
    const comp = componentsFor(owner);
    const locks = industryLocks(eco);
    const now = performance.now();
    const cands = eco.harvesters.filter((h) => h.ownerId === owner && !isRailDepot(h) && !h.closed).map((h) => {
      const res = harvesterYield(eco, comp, locks, h, now);
      const amount = Object.values(res.yields).reduce((a, b) => a + (b as number), 0);
      return {
        id: h.id,
        score: amount * depotYield(h) * distanceInfoFor(h.id).factor,
        trucks: truckCountOf(h),
        connected: res.serviced && roadRouteForHarvester(eco, h) !== null,
      };
    });
    const pick = planRivalTruck(cands, rival.money, (n) => truckBuyPrice(n, perkManagerOf(rival)), BUILD_COSTS_MONEY.depot);
    return pick !== null && fleetBuyTruck(pick, rival);
  }

  /** FLEET-5 (#599): the rival speeds up its busiest Depot's fleet when it is rich enough (same `fleetUpgradeTrucks` the button runs). */
  function rivalTruckUpgradeStep(): boolean {
    if (!newLoop) return false;
    const owner = rival.i + 1;
    const comp = componentsFor(owner);
    const locks = industryLocks(eco);
    const now = performance.now();
    const cands = eco.harvesters.filter((h) => h.ownerId === owner && !isRailDepot(h) && !h.closed).map((h) => {
      const res = harvesterYield(eco, comp, locks, h, now);
      const amount = Object.values(res.yields).reduce((a, b) => a + (b as number), 0);
      return {
        id: h.id,
        score: amount * depotYield(h) * distanceInfoFor(h.id).factor,
        level: truckLevelOf(h),
        connected: res.serviced && roadRouteForHarvester(eco, h) !== null,
      };
    });
    const pick = planRivalTruckUpgrade(cands, rival.money, (l) => truckUpgradePrice(l, perkManagerOf(rival)), BUILD_COSTS_MONEY.depot);
    return pick !== null && fleetUpgradeTrucks(pick, rival);
  }

  /** FLEET-4 (#598): the rival upgrades its main train when a Depot's worth is left over. */
  function rivalTrainStep(): boolean {
    if (!newLoop) return false;
    const id = planRivalTrainUpgrade(rail.trains, rival.i + 1, rival.money, perkManagerOf(rival), BUILD_COSTS_MONEY.depot);
    return id !== null && railUpgrade(id, rival);
  }

  /** FLEET-2 (#596): the rival runs 2+ trains on one line - it builds a Passing Loop for them. */
  function rivalLoopStep(): boolean {
    if (!newLoop) return false;
    const pick = planRivalLoop(grid, rail, rival.i + 1);
    if (!pick || !canPayBuild(rival, RAIL_COSTS.loop, "platform")) return false;
    return placeRailLoop(pick.tx, pick.ty, rival, pick.view);
  }

  function rivalDamStep(): boolean {
    if (!DAMS_ENABLED || !riversOn || !newLoop) return false;
    if (!canPayBuild(rival, DAM_COST)) return false;
    const owner = rival.i + 1;
    const sites = damSitesFor(grid);
    if (!sites.length) return false;
    const depots = eco.harvesters.filter((h) => h.ownerId === owner);
    const cities = citiesOf(rival);
    let best: { wx: number; wy: number; side: DamSide; score: number; key: number } | null = null;
    for (const s of sites) {
      // A side whose bank the site rule actually accepts. The bonus is
      // measured from the SITE (its river tile), so any legal side serves —
      // but a site with no clear bank at all is not buildable and scores
      // nothing, so the rival never "wants" a dam it cannot stand.
      let side: DamSide | null = null;
      for (const cand of s.sides) {
        if (damRefusal(grid, eco.dams, owner, s.wx, s.wy, cand) === "ok") { side = cand; break; }
      }
      if (!side) continue;
      let score = 0;
      for (const h of depots) {
        if (depotBonusTiles(h).some(([tx, ty]) => Math.abs(s.wx - tx) + Math.abs(s.wy - ty) <= DAM_RANGE)) score++;
      }
      if (cities.some((t) => Math.abs(s.wx - t.tx) + Math.abs(s.wy - t.ty) <= DAM_RANGE)) score++;
      if (score < 1) continue;
      const key = s.wy * MAP_W + s.wx;
      if (!best || score > best.score || (score === best.score && key < best.key))
        best = { wx: s.wx, wy: s.wy, side, score, key };
    }
    if (!best) return false;
    return placeDam(best.wx, best.wy, rival, best.side);
  }

  function aiNewLoopTurn(f: Factory, now: number): void {
    /** The new loop's planner input — the tree's wants, live (see step 2). */
    const depotOpts = (wantCargo: readonly Cargo[]): PlanOptions => ({
      stock: rival.purse, purse: rival.purse,
      free: rival.freeTrack, freeDepots: rival.freeDepots, now,
      newLoop, depotTier: rival.depotTier, wantCargo,
      // FTUE-1 (#464): the trainee never plans a Depot on the player's stakes.
      contests: skill().contests,
    });
    // #297: the rival is still "playing" its last tuning session. A Depot, a
    // city upgrade and a re-match each cost the player a real session on the
    // board, so each costs the rival `sessionMs` of turn time too. Before this
    // a Normal rival raised two Depots (and opened a rung) every build clock
    // and reached 12★ in about 35 seconds.
    if (now < rivalSessionUntil) {
      // RIVAL-3 (#467): the session runs, the NEXT claim still telegraphs —
      // commit-only (no build, no spend). The flag rides the whole session,
      // well past the lead time, before the turn that builds behind it; one
      // flag at a time, because one Depot is one session.
      commitRivalDepotClaims(
        f,
        () => depotOpts(treeWants(treeGoal({ purse: rival.purse, tier: rival.depotTier }), scoreCargoWant(eco, rival.id))),
        now,
        1,
      );
      return;
    }
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
    // RIVAL-3 (#467): the buy is telegraphed — the claim flag goes up first,
    // the Factory build lands when the difficulty's lead has run.
    let plantNow = false;
    if (canPayBuild(rival, PLANT_COST)) {
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
      plantNow = !goal || covers(withPlant(goal.cost));
    }
    if (rivalPlantClaimStep(now, plantNow)) {
      acted = true;
      // placePlant rescores immediately; if that was the winning star the
      // curtain is already up, and nothing may be added after the ledger.
      if (winner !== null) return;
    } else if (plantNow && rivalLevelStep("plant")) {
      // #456: every plant site is too bumpy to stand on — level one.
      acted = true;
    }

    // ── 2. depot — the tree's next rung, reached on free gravel ────────────
    // Same plan, same prices and same tree gate as the shipped turn
    // (`planCandidates` → `priceDepot`); the new-loop input is `wantCargo`.
    // RIVAL-3 (#467): claim-gated — only a claim flagged for the difficulty's
    // lead time may build, then exactly one flag is kept up (one Depot is one
    // session here; the session-wait above tops it up mid-session).
    // #297: ONE Depot per turn on the new loop — each one is a tuning
    // session, and the session clock paces the next.
    const builtDepot = rivalDepotClaimPass(f, () => depotOpts(want), now, 1, false);
    if (builtDepot) {
      acted = true;
      startSession();
    } else {
      commitRivalDepotClaims(f, () => depotOpts(want), now, 1);
      if (rivalLevelStep("depot")) {
        // #456: no flat Depot lot is left on the map — level the cheapest one
        // toward flat instead (same rule, same price, its purse). Infrastructure
        // is not a session: the turn goes on, and next turn's planner has a
        // site again.
        acted = true;
      }
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
    if (rivalHighwayPass()) acted = true;

    // ── 6. railway (RAIL-05) — shared with the shipped turn ────────────────
    const rail = rivalRailStep(f, now);
    if (rail.acted) acted = true;
    // #297: a platform is a ★, so it is a session like any other scoring
    // action — without this a rich rival would raise one every build clock
    // (the rail flag is dev-only today, but the pace must hold when it ships).
    if (rail.platform) startSession();

    // ── 7. dam (R3, #270) — a hydro dam on a site that reaches the rival ───
    // Infrastructure, not a ★: it takes no session (the pave step's rule) and
    // runs on every turn, so it stands the moment the mix can pay for it.
    if (rivalDamStep()) acted = true;

    // ── 8. fleet (FLEET-1, #595) — a 2nd lorry on the busiest Depot ────────
    if (rivalTruckStep()) acted = true;
    else if (rivalTruckUpgradeStep()) acted = true;
    if (rivalTrainStep()) acted = true;   // FLEET-4 (#598)
    if (rivalLoopStep()) acted = true;    // FLEET-2 (#596)

    if (acted) {
      noteWorldBuild();      // BUILD-1 (#460): the rival's builds close windows
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
    // #431: the bank could not close the gap either — spend the money the
    // market paid it, if it covers the goal's whole shortfall. The Depot is
    // built on the next turn by the ordinary goods-gated planner.
    if (goal && rivalBuyTowardGoal(goal.cost)) {
      syncWorld();
      return;
    }
    // Still nothing: wait for the clock, and the next turn comes on `idleMs`,
    // exactly like the shipped turn's idle path.
    lastAi = now - skill().buildMs + skill().idleMs;
  }

  /** #431: buy the goal's missing goods at the market's buy price, all or
   *  nothing (`planGoalPurchase`); true when the purchase landed. */
  function rivalBuyTowardGoal(cost: Purse): boolean {
    const earns = new Set(eco.harvesters.filter((h) => h.owner === rival.id)
      .map((h) => depotCargo(eco, h)).filter((c): c is Cargo => !!c));
    if (!goalOutOfReach(rival.purse, cost, earns)) return false;
    const plan = planGoalPurchase(rival.purse, cost, rival.money, (cargo, units) => {
      const q = quoteBuy(market, cargo, units, marketMs);
      return q.units === units ? q.cost : null;
    });
    if (!plan) return false;
    rival.money -= plan.price;
    for (const [cargo, n] of Object.entries(plan.buy) as [Cargo, number][]) {
      rival.purse[cargo] = (rival.purse[cargo] ?? 0) + n;
    }
    return true;
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

  // ══════════════════════ RIVAL-3 (#467): the claim telegraph ═════════════
  // The readable rival. Every rival Depot/Factory build is PRECEDED by a
  // claim flag (rival colour) over the site, up for the difficulty's lead
  // time (`RivalSkill.claimLeadMs`), plus a bark from the claim deck. The
  // player can pre-empt; the first valid build wins, the loser's plan
  // re-targets and the rival barks a comeback line.
  //
  // The turn is two-phase: EXECUTE the claims whose lead has run (each one
  // re-planned against its OWN site — the claim pins the planner's DECISION,
  // never the path), then COMMIT the next targets (flag + bark). The
  // pipeline refills every turn, so the steady-state build rate is exactly
  // what it was — the rival is not slower, only legible. No RNG anywhere in
  // this path: the telegraph IS the planner decision, and the barks ride the
  // hash-picked decks in `rivalry.ts`.
  const claimLedger = new ClaimLedger();
  /** A claim whose execute keeps failing gets one minute of grace, then the
   *  flag comes down and the planner re-targets on the next turn. */
  const CLAIM_GIVE_UP_MS = 60_000;
  /** Which claims have had their "Contested" Feed line, so it says it once.
   *  GOAL-1 (#459): the "Next step" advisor may point at a contested site —
   *  wiring that up is follow-up work. */
  const contestAnnounced = new WeakSet<RivalClaim>();

  const industryClaimSite = (ind: Industry): ClaimSite => {
    const def = INDUSTRY_BY_KEY[ind.type];
    return {
      kind: "industry", id: ind.id,
      tx: ind.tx + (ind.w >> 1), ty: ind.ty + (ind.h >> 1),
      cargo: def.cargo, name: def.name,
    };
  };
  const plantClaimSite = (tx: number, ty: number, rot = 0): ClaimSite => {
    const town = adjacentTown(grid, tx, ty, rot);
    return {
      kind: "lot", id: ty * MAP_W + tx, tx, ty,
      townId: town?.id ?? null,
      name: town ? `a plant site at ${town.name ?? `Town ${town.id + 1}`}` : "a plant site",
    };
  };
  const siteLabel = (site: ClaimSite): string =>
    site.name ?? (site.kind === "industry" ? "the industry" : "the plant site");

  /**
   * The player's half of every race: a placement tool ARMED near a site (the
   * live hover while the Depot/Plant tool is out), or a live TENDER (a public
   * offer both seats may race, or one either seat has accepted) — a tender's
   * cargo/town is intent on every site that serves it. Pure inputs, one
   * function, so the Contested rule is the same one the tests exercise.
   */
  const playerClaimIntents = (): PlayerIntent[] => {
    const out: PlayerIntent[] = [];
    if ((tool === "harvester" || tool === "plant") && hover) {
      out.push({ kind: "armed", tx: hover.tx, ty: hover.ty });
    }
    for (const o of contractOffersList) {
      if (o.kind === "tender") out.push({ kind: "tender", cargo: o.cargo, townId: o.townId });
    }
    for (const a of activeContracts) {
      if (a.def.kind === "tender" && a.status === "active") {
        out.push({ kind: "tender", cargo: a.def.cargo, townId: a.def.townId });
      }
    }
    return out;
  };

  /** The flags the overlay draws (renderer.ts `paintClaimFlags`), live. */
  const claimFlagViews = (): ClaimFlagView[] => {
    const intents = playerClaimIntents();
    return claimLedger.list().map((c) => ({
      tx: c.site.tx, ty: c.site.ty,
      colour: rival.colour,
      label: c.site.name ?? null,
      contested: claimContested(c, intents),
    }));
  };

  /** The Feed says "Contested" once per claim while both seats are on it. */
  function noteClaimContested(): void {
    const intents = playerClaimIntents();
    for (const claim of claimLedger.list()) {
      const contested = claimContested(claim, intents);
      if (contested && !contestAnnounced.has(claim)) {
        contestAnnounced.add(claim);
        ui.feed(`Contested — both seats are eyeing ${siteLabel(claim.site)}`);
      } else if (!contested && contestAnnounced.has(claim)) {
        contestAnnounced.delete(claim);
      }
    }
  }

  /** One wire bark per commit wave — the flag carries the rest. */
  const claimBark = () => playRivalryScene(nextClaimScene(), "banter");
  const comebackBark = () => ui.feed(`${rival.name}: ${nextComebackLine()}`, rival.name);

  /**
   * Commit the planner's next targets until `wantPending` Depot claims fly
   * (top-up semantics: the pipeline is kept FULL, not flooded). Each new flag
   * gets a Feed line; one bark per wave. Returns how many flags went up.
   */
  function commitRivalDepotClaims(
    f: Factory, makeOpts: () => PlanOptions, now: number, wantPending: number,
  ): number {
    const want = Math.max(1, wantPending);
    if (claimLedger.pending("depot").length >= want) return 0;
    let committed = 0;
    let barked = false;
    for (const c of planCandidates(eco, f, makeOpts())) {
      if (claimLedger.pending("depot").length >= want) break;
      const site = industryClaimSite(c.industry);
      const claim = claimLedger.commit("depot", site, now, skill().claimLeadMs);
      if (!claim) continue;
      committed++;
      ui.feed(`Rival stakes a claim on ${siteLabel(site)}`, rival.name);
      if (!barked) { claimBark(); barked = true; }
    }
    return committed;
  }

  /**
   * Execute one ready Depot claim — the same planner decision, revalidated.
   * "built" = the Depot landed (the claim's flag preceded it by the full
   * lead); "lost" = the race is over (the site was taken — the plan
   * re-targets and the rival barks); "wait" = the purse isn't ready yet and
   * the flag stays up (one minute of grace, then re-target).
   */
  function tryRivalDepotClaim(
    claim: RivalClaim, f: Factory, makeOpts: () => PlanOptions, now: number,
  ): "built" | "lost" | "wait" {
    const opts = makeOpts();
    // PP-05: the same belt-and-braces gate `aiBuildStep` walked — a Depot
    // placed for a purse that cannot pay would be a free Depot.
    const fallbackDepotCost = priceDepot(opts.purse, opts.freeDepots ?? 0, {
      tier: opts.depotTier, newLoop: opts.newLoop === true,
    }).cost;
    for (const c of planCandidates(eco, f, opts)) {
      if (c.industry.id !== claim.site.id) continue;
      if (!canAfford(opts.purse, addCost(c.cost, c.depotCost ?? fallbackDepotCost))) continue;
      const out = executeCandidate(
        eco, c, rival.id, rival.i + 1, allocHarvesterId(),
        opts.free ?? 0, opts.freeDepots ?? 0, opts.newLoop === true,
      );
      if (out.built.length > 0 || out.harvester) {
        rival.freeTrack = Math.max(0, rival.freeTrack - out.free);
        rival.freeDepots = Math.max(0, rival.freeDepots - out.freeDepots);
        chargeBuild(rival, out.spent);
        for (const [bx, by] of out.built) renderer?.invalidateTile(bx, by);
        // A contested claim the rival WON is a race moment — say so before
        // the ordinary expansion line, and clear the marker with it.
        if (contestAnnounced.has(claim)) {
          ui.feed(`Rival got there first — ${siteLabel(claim.site)} is claimed`, rival.name);
        }
        ui.feed(`Rival expands: a new Depot and ${out.built.length} road tile${out.built.length === 1 ? "" : "s"}`, rival.name);
        voiceCue("rival:industry-taken");
        claimLedger.drop(claim);
        return "built";
      }
    }
    // No executable plan on the claimed site: a lost race, its own earlier
    // build, or a purse that hasn't caught up.
    const holder = industryLocks(eco).get(claim.site.id);
    if (holder && holder.ownerId !== rival.i + 1) {
      claimLedger.drop(claim);
      comebackBark();
      return "lost";
    }
    if (holder) {
      // Its own network already claims the site — nothing left to win there.
      claimLedger.drop(claim);
      return "wait";
    }
    if (now - claim.readyAt > CLAIM_GIVE_UP_MS) claimLedger.drop(claim);
    return "wait";
  }

  /**
   * The two-phase Depot pass: build what the flags have covered long enough,
   * then raise flags on what comes next. Returns whether anything was built.
   * The commit half keeps the pipeline two turns deep per build slot (the
   * lead runs about two build clocks on every difficulty), so the steady
   * state build rate is the one the rival always had. `commit` is off on the
   * idle-retry path and on the new loop, which keeps exactly one flag up.
   */
  function rivalDepotClaimPass(
    f: Factory, makeOpts: () => PlanOptions, now: number, maxBuilds: number, commit = true,
  ): boolean {
    let builtAny = false;
    let budget = Math.max(1, maxBuilds);
    for (const claim of [...claimLedger.ready(now)]) {
      if (claim.kind !== "depot" || budget <= 0) continue;
      if (tryRivalDepotClaim(claim, f, makeOpts, now) === "built") {
        budget--;
        builtAny = true;
      }
    }
    if (commit) commitRivalDepotClaims(f, makeOpts, now, Math.max(2, Math.max(1, maxBuilds) * 2));
    return builtAny;
  }

  /**
   * The Factory (Processing Plant) half: one pending claim at a time, flagged
   * over the lot it would stand on. `wantPlant` is each loop's own "should it
   * buy a plant now" rule, unchanged — the telegraph only splits the buy into
   * flag-then-build. The ready claim builds only under the same rule (it must
   * not eat the purse the rule protects); until then the flag stays up, with
   * the same grace as a Depot claim. Returns whether a plant landed this turn.
   */
  function rivalPlantClaimStep(now: number, wantPlant: boolean): boolean {
    if (wantPlant) {
      for (const claim of [...claimLedger.ready(now)]) {
        if (claim.kind !== "plant") continue;
        const { tx, ty } = claim.site;
        const spot = chooseAiPlantSpot(grid, track, eco, rival.id);
        if (spot && spot[0] === tx && spot[1] === ty) {
          if (placePlant(tx, ty, rival, spot[2] ?? 0)) {
            if (contestAnnounced.has(claim)) {
              ui.feed(`Rival got there first — ${siteLabel(claim.site)} is taken`, rival.name);
            }
            // AI-03c: the feed tells the player the rival JUST scored a ★ —
            // an empty feed used to hide every move it made.
            ui.feed(`Rival raises processing plant #${plantsOf(eco, rival.id).length} (+1★)`, rival.name);
            claimLedger.drop(claim);
            return true;
          }
          // Refused for money only — the flag stays up (grace applies).
          if (now - claim.readyAt > CLAIM_GIVE_UP_MS) claimLedger.drop(claim);
          continue;
        }
        // The planner no longer wants this lot — the plan re-targets. If the
        // lot was TAKEN (the player pre-empted), the rival barks a comeback.
        claimLedger.drop(claim);
        if (buildingAt(eco, tx, ty) || plantRefusal(grid, track, eco, tx, ty) === "occupied") {
          comebackBark();
        }
      }
    }
    // Grace for claims nothing will execute (want gone, or no legal build).
    for (const claim of [...claimLedger.ready(now)]) {
      if (claim.kind === "plant" && now - claim.readyAt > CLAIM_GIVE_UP_MS) claimLedger.drop(claim);
    }
    if (!wantPlant || claimLedger.pending("plant").length > 0) return false;
    const spot = chooseAiPlantSpot(grid, track, eco, rival.id);
    if (!spot) return false;
    const site = plantClaimSite(spot[0], spot[1], spot[2] ?? 0);
    const claim = claimLedger.commit("plant", site, now, skill().claimLeadMs);
    if (!claim) return false;
    ui.feed(`Rival stakes a claim on ${siteLabel(site)}`, rival.name);
    claimBark();
    return false;
  }

  function aiTick(now: number) {
    // B5 (#250): no AI action and no economy churn during a battle; the two
    // offer doors (rival challenges, fight-offs) expire here too.
    if (battleScreen || tutorialSection) return;
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
    // RIVAL-3 (#467): the Contested announcement rides the AI clock too, so a
    // headless sim that only drives `aiTick` sees the same Feed the frame does.
    noteClaimContested();
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
    if (canPayBuild(rival, PLANT_COST)) {
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
    }
    // RIVAL-3 (#467): the plant buy is telegraphed — the claim flag goes up
    // first (bark + Feed), the build lands when the difficulty's lead has run.
    if (rivalPlantClaimStep(now, plantNow)) {
      acted = true;
      // placePlant rescores immediately. If this was the winning star, the
      // curtain is already up; do not let the rest of the same AI turn add
      // roads after the final ledger was photographed.
      if (winner !== null) return;
    } else if (plantNow && rivalLevelStep("plant")) {
      // #456: every plant site is too bumpy to stand on — level one.
      acted = true;
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
      // FTUE-1 (#464): the trainee never plans a Depot on the player's stakes.
      contests: skill().contests,
    });
    // RIVAL-3 (#467): two-phase — build what the flags have covered for the
    // lead time, then flag the next targets. `aiBuildStep` used to plan and
    // build in one motion; the split is that same turn, re-timed so every
    // build lands behind its claim flag.
    if (rivalDepotClaimPass(f, opts, now, skill().expandPerTurn)) acted = true;
    // #456: when the planner found no flat Depot lot (the loop broke out on
    // its first try), level the cheapest lot toward flat — the rival's right
    // to the same tool, at the same price, from its own purse.
    if (rivalLevelStep("depot")) acted = true;
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
      noteWorldBuild();      // BUILD-1 (#460): the rival's builds close windows
      syncWorld();
      invalidateRailLaid(rail.laid);
      rescoreNow();
      return;
    }
    // PP-07 / L11 (#226): nothing affordable at all — bank toward the plan it
    // wants (through the tree gate), then take the turn if the trade unlocked
    // it. Retry in one harvest tick, not one build clock.
    rivalBankTowardPlan(f, now);
    // RIVAL-3 (#467): the retry is an execute-only claim pass — the flags are
    // already up; banking may have just made one of them buildable.
    if (rivalDepotClaimPass(f, opts, now, 1, false)) {
      // L4 (#218): the retry path raises a Depot too — tune it like any other.
      applyRivalTuning();
      noteWorldBuild();      // BUILD-1 (#460): the rival's builds close windows
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
    // ECON-1 (#421): money is host-authoritative like the rest of the economy.
    money: p.money, marketMs, market: marketToWire(market),
    // CAST-1: the seat's manager and the Fixer's allowance — additive-optional
    // like `money`, so an older peer simply ignores them.
    manager: p.manager, fixer: p.fixer, blackMarket: readBlackMarket(p.blackMarket),
    // PERK-1 (#600): the Return-to-Sender spend, so a resync cannot re-arm it.
    sentBack: p.sentBack === true,
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
      .map((ind) => ({ id: ind.id, until: ind.banditUntil, owner: ind.banditOwner }));

  /**
   * GUEST: adopt the host's Blockade set wholesale. The host is authoritative
   * (§9), so an industry absent from the list is NOT blockaded — a lifted
   * blockade has to clear on the guest too, or its map keeps showing a
   * stoppage the host has already forgotten.
   */
  function applyBlockadesWire(list: { id: number; until: number; owner?: string }[]): void {
    const byId = new Map(list.map((b) => [b.id, b]));
    for (const ind of grid.industries) {
      const b = byId.get(ind.id);
      ind.banditUntil = b ? b.until : 0;
      ind.banditOwner = b ? b.owner : undefined;
    }
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
    const trucksWire = trucks.trucks.map((t) => ({ ownerId: t.ownerId, depotId: t.depotId, factory: [...t.factory] as [number, number], route: t.route.map((r) => [...r] as [number, number]), segFast: t.segFast ? [...t.segFast] : [], leg: t.leg, t: t.t, reverse: t.reverse, deliveries: t.deliveries, ...(t.slot ? { slot: t.slot } : {}) }));
    const carsWire = cars.cars.map((c) => ({ name: c.name, carIndex: (c as any).carIndex ?? 1, originTownId: (c as any).originTownId ?? null, destTownId: (c as any).destTownId ?? null, origin: (c as any).origin ? [...(c as any).origin] as [number, number] : null, dest: (c as any).dest ? [...(c as any).dest] as [number, number] : null, route: c.route.map((r) => [...r] as [number, number]), leg: c.leg, t: c.t, state: (c as any).state ?? "driving", waitMs: (c as any).waitMs ?? 0, fadeMs: (c as any).fadeMs ?? 0, fade: (c as any).fade ?? 1, arriveMs: (c as any).arriveMs ?? 0, lastTripKey: (c as any).lastTripKey ?? null }));
    const nowSnap = performance.now();
    return buildSnapshot({
      seed, track,
      harvesters: eco.harvesters,
      factories: eco.factories,
      setupPhase: inSetup(),
      won: phase === "won",
      players: wirePlayers(),
      t: nowSnap,
      protests: protestsWire,
      battle: battleWire(),
      blockades: blockadesWire(),
      trucks: trucksWire,
      cars: carsWire,
      rail: railWire(true),
      // R3 (#270): the dams ride the snapshot — the guest's map shows the
      // standing structures and their bonuses.
      dams: damsToWire(eco.dams),
      winner: winner ? { id: winner.id, source: winningSource } : null,
      clearedFields: [...clearedFields],
      offers: offersToWire(offerBook, nowSnap),
      // CONTRACT-1 (#466): contracts ride the snapshot
      contracts: contractsToWire(contractOffersList, activeContracts, nowSnap),
      // #456: the edited heights ride the full state as the diff from the
      // seed map (absent = the unlevelled island, same as the save).
      ...(seedHeights && grid.height
        ? { heightEdits: heightDiffWire(grid.height, seedHeights, MAP_W, MAP_H) }
        : {}),
    } as any);
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
    const trucksWire = trucks.trucks.map((t) => ({ ownerId: t.ownerId, depotId: t.depotId, factory: [...t.factory] as [number, number], route: t.route.map((r) => [...r] as [number, number]), segFast: t.segFast ? [...t.segFast] : [], leg: t.leg, t: t.t, reverse: t.reverse, deliveries: t.deliveries, ...(t.slot ? { slot: t.slot } : {}) }));
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
      // R3 (#270): the dams ride every delta whole (the harvesters rule, not
      // the rail "absent = unchanged" rule) — a demolished dam is mirrored the
      // same tick. `damsToWire` returns undefined for an empty list, so pin
      // it to an array: an absent `dams` on a delta must mean "unchanged".
      dams: damsToWire(eco.dams) ?? [],
      clearedFields: [...clearedFields],
      // #456: the edited heights ride EVERY delta whole (the clearedFields
      // rule) — absent on an old host means "the seed heights stand". Pinned
      // to an array so an absent field can only ever mean that.
      heightEdits: seedHeights && grid.height
        ? heightDiffWire(grid.height, seedHeights, MAP_W, MAP_H) : [],
      winner: winner ? { id: winner.id, source: winningSource } : null,
      offers: offersToWire(offerBook, now),
      contracts: contractsToWire(contractOffersList, activeContracts, now),
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
    // END-1 (#472): tenders taken (trade offers)
    try {
      const t = (performance.now() - matchHistory.startMs) / 1000;
      recordEvent(matchHistory, {
        kind: "offer",
        from: r.from as 0 | 1,
        to: seat as 0 | 1,
        give: r.give,
        giveN: r.giveN,
        want: r.want,
        wantN: r.wantN,
        t,
      });
    } catch {}
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
    else if (setupNeedsDepot && !eco.harvesters.some((h) => h.owner === me.id)) phase = "setup-harvester";
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
  /**
   * CAST-1: a GUEST tells the host which manager it plays — and keeps telling
   * it (throttled) until the host's seat record echoes it back, because a
   * typed room message is not replayed to a host whose game mounted late.
   */
  let managerAskedAt = -Infinity;
  function announceGuestManager(): void {
    if (!isGuest() || !playerManager || me.manager === playerManager) return;
    const now = performance.now();
    if (now - managerAskedAt < 3000) return;
    managerAskedAt = now;
    net?.sendIntent("build", { do: "manager", id: playerManager });
  }

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
    // ECON-1 (#421): the seat's money, and (once, off the host's record) the
    // market clock and its slippage — the guest prices the same minute.
    const mv = (wire as { money?: number }).money;
    if (typeof mv === "number" && Number.isFinite(mv)) p.money = mv;             // PLAY-FIX-1: rent may leave a seat in debt
    // CAST-1: the host's word on the seat's manager (null = none yet — the
    // guest then prices exactly as the host will) and the Fixer's allowance.
    const mg = (wire as { manager?: unknown }).manager;
    if (mg !== undefined) p.manager = managerOrNull(mg);
    // PERK-1 (#600): the Return-to-Sender spend rides the same record.
    const sbk = (wire as { sentBack?: boolean }).sentBack;
    if (typeof sbk === "boolean") p.sentBack = sbk;
    const fx = (wire as { fixer?: unknown }).fixer;
    if (fx !== undefined) p.fixer = readFixer(fx);
    p.blackMarket = readBlackMarket(wire.blackMarket);
    const mm = (wire as { marketMs?: number }).marketMs;
    if (typeof mm === "number" && Number.isFinite(mm)) marketMs = Math.max(0, mm);
    const mw = (wire as { market?: { seed: number } }).market;
    if (mw) {
      const next = marketFromWire(mw as never, seed);
      market.impact = next.impact; market.impactAt = next.impactAt;
    }
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
    // #456: the edited heights, in the snapshot's whole-diff form — reset to
    // the seed map's heights, then apply what the host carries (an old host
    // carries none, and the seed heights are exactly its world).
    applyHostHeights(applied.heightEdits);
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
    announceGuestManager();
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
    // CONTRACT-1 (#466): contracts ride the snapshot
    try {
      const cw = (applied as any).contracts as ContractWire[] | undefined;
      if (cw) {
        const restored = contractsFromWire(cw, performance.now());
        // Guest mirrors host's active contracts and offers
        activeContracts = restored.actives;
        contractOffersList = restored.offers;
      }
    } catch {}
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
    // R3 (#270): the dams — a full state ALWAYS says what the host's dams ARE
    // (absent = none, the rail rule). `applySnapshot` already validated the
    // rows; `damsFromWire` re-narrows the wire strings to the game types.
    eco.dams = damsFromWire(applied.dams);
    if (applied.cars || applied.rail) {
      // Ensure guest renders vehicles
      world.vehicles = composeVehicles();
    }
    // L15 (#230): boards and crossPrompt are gone from the wire — the board
    // is tuning-only and blessings are retired, so nothing to restore here.
    // winner
    if (applied.winner && applied.winner.id) {
      const w = players.find((p) => p.id === applied.winner!.id);
      if (w) { winner = w; winningSource = applied.winner.source as any; phase = "won"; if (!endingShown) endingRecordable = false; presentEnding(winningSource); }
    } else if (applied.won && !winner) {
      // Fallback: derive winner from VP if wire says won but no id
      for (const p of players) if (hasWon(score, p.id, winTarget())) { winner = p; phase = "won"; if (!endingShown) endingRecordable = false; presentEnding(null); break; }
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
    // #456: the edited heights ride every delta whole (the clearedFields
    // rule). `applyHostHeights` is a no-op when the diff matches the world's
    // current bytes, so the every-tick cost is one short array compare.
    if (Array.isArray(msg.heightEdits)) applyHostHeights(msg.heightEdits);
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
      announceGuestManager();
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
      world.vehicles = composeVehicles();
    }
    // RAIL-04 (#178): a delta's rail field is present on every publish from a
    // host that HAS a railway; absent means "unchanged", so nothing is cleared
    // here (only a full state decides that).
    if ((msg as any).rail && applyRailWire(rail, (msg as any).rail)) {
      world.vehicles = composeVehicles();
      worldDirty = true;
    }
    // R3 (#270): the dams ride the delta whole, so a present field ALWAYS
    // says what the host's dams ARE — an empty list is a demolition to
    // mirror, an absent field is "unchanged". `damsFromWire` re-narrows.
    if (Array.isArray((msg as any).dams)) {
      eco.dams = damsFromWire((msg as any).dams);
      worldDirty = true;
    }
    // CONTRACT-1 (#466): contracts ride the delta whole
    if (Array.isArray((msg as any).contracts)) {
      try {
        const cw = (msg as any).contracts as ContractWire[];
        const restored = contractsFromWire(cw, performance.now());
        activeContracts = restored.actives;
        contractOffersList = restored.offers;
      } catch {}
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
      } else if (what === "manager") {
        // CAST-1: the guest names its manager; the host applies that seat's
        // perks from here on and echoes it on the seat record. A human seat
        // only — an AI-held seat keeps the rival's own rules.
        if (p.human) p.manager = managerOrNull(payload.id);
      } else if (what === "track") {
        const ax = int(payload.ax), ay = int(payload.ay);
        const bx = int(payload.bx), by = int(payload.by);
        if (ax !== null && ay !== null && bx !== null && by !== null) {
          const kind: TrackKind = payload.kind === "road" ? "road" : "dirt";
          const tier: RoadTierKey = kind === "road"
            && ROAD_TIER_KEYS.includes(payload.roadTier as RoadTierKey) ? payload.roadTier as RoadTierKey : "road";
          const pv = previewDrag(grid, track, kind, p.purse, ax, ay, bx, by,
            payload.xFirst !== false, undefined, p.freeTrack,
            structureTiles(eco.factories, eco.harvesters, p.i + 1, factoryFp), newLoop,
            // R2 (#266): a deck is never shared, so the rail layer rides along.
            { railAt: (x, y) => hasRail(rail.rail, x, y), gradeSeparated: true, railDeckAt: (x, y) => !!(rail.rail.tile[tIdx(x, y)] & RAIL_OVERPASS) }, tier, previewBalance(p, "road"));
          if (pv.tiles.length === 0) toast(pv.why ? roadDragRefusalText(pv.why) : "Can't build there.", "bad");
          else commitTrackDrag(p, pv, kind, tier);
        }
      } else if (what === "level") {
        // #456: a guest's levelling. The host re-plans the same rectangle
        // toward the same target with the SAME pure rule the guest previewed
        // — refusals and ramps included — and charges the guest's purse for
        // exactly what lands (`commitLevel` toasts through `intentEcho`, so
        // "Not enough money" reaches the guest the way a build refusal does).
        const ax = int(payload.ax), ay = int(payload.ay);
        const bx = int(payload.bx), by = int(payload.by);
        const target = typeof payload.target === "number" && Number.isInteger(payload.target) ? payload.target : null;
        if (ax !== null && ay !== null && bx !== null && by !== null && target !== null) {
          const plan = planLevel(grid, rectTiles(ax, ay, bx, by), { track }, target);
          if (!plan.changes.length) {
            echoed.push(plan.refused.length
              ? LEVEL_REFUSAL_TEXT[plan.refused[0][2]]
              : "Nothing to level there.");
          } else commitLevel(p, plan);
        }
      } else if (what === "interchange") {
        const tx = int(payload.tx), ty = int(payload.ty);
        if (tx !== null && ty !== null) {
          const plan = planInterchange(grid, track, p.i + 1, tx, ty, p.purse, previewBalance(p, "road"));
          if (plan.why) echoed.push(plan.why); else placeInterchange(tx, ty, p);
        }
      } else if (what === "dam" && DAMS_ENABLED) {
        // R3 (#270): a guest's dam build. The host runs the SAME site rule,
        // the SAME charge and the SAME build against the guest's seat — the
        // side the guest DREW is the side built (#181's heading rule). The
        // refusal must ECHO (a guest seat toasts no one on the host) and the
        // forced publish below is what lands the new dam on the guest.
        const tx = int(payload.tx), ty = int(payload.ty);
        const side = (DAM_SIDES as readonly string[]).includes(String(payload.side))
          ? payload.side as DamSide : "s";
        if (tx !== null && ty !== null) {
          const river = damRiverAt(grid, tx, ty);
          const why = "why" in river ? river.why
            : damRefusal(grid, eco.dams, p.i + 1, tx, ty, damSideAtSite(tx, ty, side));
          if (why !== "ok") echoed.push(DAM_REFUSAL_TEXT[why]);
          else if (!canPayBuild(p, DAM_COST))
            echoed.push(`Not enough money — a dam costs $${moneyCostOf(DAM_COST)}.`);
          else placeDam(tx, ty, p, side);
        }
      } else if (!railAvailable && (what === "rail" || what === "platform" || what === "loop" || what === "raildepot" || what === "railact")) {
        // RAIL-05 (#182): with the flag down the railway does not exist on this
        // host, so a guest's rail request is refused whole — never half-built.
        echoed.push("Rail is not available in this mode.");
      } else if (what === "rail" || what === "platform" || what === "loop" || what === "raildepot") {
        // #181: no phase gate here, on purpose — the other build intents
        // (track, depot, plant) do not have one either: the guest's own phase
        // governs what its UI offers, and the host's rules are the only
        // validation. The heading, though, IS the guest's: it is what its
        // preview drew, so it is what the host validates and builds with.
        if (what === "rail") {
          // RAIL-04 (#178): a guest's rail drag. The host runs the SAME preview
          // and the SAME commit against the guest's seat, so the tiles the guest
          // saw priced are the tiles that get built and charged.
          const ax = int(payload.ax), ay = int(payload.ay);
          const bx = int(payload.bx), by = int(payload.by);
          if (ax !== null && ay !== null && bx !== null && by !== null) {
            const pv = railPreview(grid, track, rail, p.i + 1, p.purse, ax, ay, bx, by,
              payload.xFirst !== false, true);
            if (pv.tiles.length === 0) {
              echoed.push(pv.why && pv.why !== "ok" ? RAIL_REFUSAL_TEXT[pv.why] : "Can't build rail there.");
            } else commitRailDrag(p, pv);
          }
        } else {
          const tx = int(payload.tx), ty = int(payload.ty);
          // #181: the heading the guest drew with is the heading the host
          // validates AND builds with — one refusal, one structure. (Before
          // this, the refusal ran with the guest's heading and the build with
          // the HOST's held one: the two could disagree.)
          const view = (RAIL_VIEWS as readonly string[]).includes(String(payload.view))
            ? payload.view as RailView : "se";
          if (tx !== null && ty !== null) {
            const why = what === "platform"
              ? platformRefusal(grid, rail.structures, railPlants(), p.i + 1, tx, ty, view, undefined, lockedIndustryIdsFor(eco, p.id), rail.rail)
              : what === "loop" ? loopRefusal(grid, rail, p.i + 1, tx, ty, view)   // FLEET-2 (#596)
              : depotRefusal(grid, rail, p.i + 1, tx, ty, view);
            if (why !== "ok") echoed.push(RAIL_REFUSAL_TEXT[why]);
            else if (what === "platform") placeRailPlatform(tx, ty, p, view);
            else if (what === "loop") placeRailLoop(tx, ty, p, view);
            else placeRailDepot(tx, ty, p, view);
          }
        }
      } else if (what === "lane") {
          // RAIL-6 (#575): a guest's lane upgrade — the host runs the SAME
          // `laneRefusal` and charges the guest seat, exactly like the click.
          const stationId = typeof payload.stationId === "number" && Number.isInteger(payload.stationId)
            ? payload.stationId : null;
          const side = payload.side === -1 ? -1 as const : 1 as const;
          if (stationId !== null) {
            const why = laneRefusal(grid, rail, p.i + 1, stationId, side);
            if (why !== "ok") echoed.push(RAIL_REFUSAL_TEXT[why]);
            else addStationLaneAt(stationId, side, p);
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
        else if (payload.what === "upgrade" && id !== null) railUpgrade(id, p);   // FLEET-4 (#598)
        else if (payload.what === "rename" && id !== null && typeof payload.name === "string") railRename(id, payload.name, p);
      } else if (what === "truck") {
        // FLEET-1 (#595): a guest's Buy / Sell truck. The host runs the same
        // refusal ladder and charges the guest's seat; a refusal echoes (a
        // guest seat toasts no one on the host).
        const depot = int(payload.depot);
        if (depot !== null && (payload.act === "buy" || payload.act === "sell" || payload.act === "upgrade")) {
          if (payload.act === "upgrade") {
            const check = truckUpgradeWhy(depot, p);
            if (!check.ok) echoed.push(check.why ?? "That upgrade cannot be bought.");
            else fleetUpgradeTrucks(depot, p);
          } else if (payload.act === "buy") {
            const check = truckBuyWhy(depot, p);
            if (!check.ok) echoed.push(check.why ?? "That truck cannot be bought.");
            else fleetBuyTruck(depot, p);
          } else {
            const why = truckSellRefusal(eco.harvesters.find((x) => x.id === depot), p.i + 1);
            if (why) echoed.push(why); else fleetSellTruck(depot, p);
          }
        }
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
      } else if (what === "sell" || what === "buy") {
        // MKT-2 (#465): a guest's exchange trade is a REQUEST, like the
        // bank's. The host re-runs the whole rule against the GUEST's own
        // seat — a sellable cargo, a sane lot, the purse/money to cover it —
        // through the SAME `sellCargo` / `buyCargo` a local trade uses, so a
        // relayed trade cannot drift from a local one; the forced publish
        // below lands the delta back on the guest. (Note: this is
        // `do: \"sell\"` on the market — the railway's sell is `do:
        // \"railact\"` with `what: \"sell\"`, routed above.)
        const cargo = isCargo(payload.cargo as string) ? payload.cargo as Cargo : null;
        const rawN = payload.n;
        const lot = rawN === "all" && what === "sell" ? "all"
          : typeof rawN === "number" && Number.isFinite(rawN) ? Math.floor(rawN) : null;
        if (cargo === null || !sellable(cargo) || lot === null) {
          echoed.push("The exchange can't read that trade.");
        } else if (what === "sell") {
          const held = Math.floor(p.purse[cargo] ?? 0);
          if (held <= 0) echoed.push(`No ${CARGO[cargo].name} to sell.`);
          else {
            const units = lot === "all" ? held : Math.min(held, Math.max(1, lot));
            const got = sellCargo(p, cargo, units);
            echoed.push(got > 0 ? `Sold ${units} ${CARGO[cargo].name} for ${moneyStr(got)}.`
              : "That sale fetched nothing.");
          }
        } else {
          const units = Math.max(0, lot === "all" ? 0 : lot);
          const quote = units > 0 ? quoteBuy(market, cargo, units, marketMs) : null;
          if (!quote || quote.units <= 0) echoed.push("Nothing to buy.");
          else if (p.money < quote.cost) {
            echoed.push(`Not enough money — ${units} ${CARGO[cargo].name} costs ${moneyStr(quote.cost)}.`);
          } else {
            buyCargo(p, cargo, units);
            echoed.push(`Bought ${units} ${CARGO[cargo].name} for ${moneyStr(quote.cost)}.`);
          }
        }
      } else if (typeof payload.key === "string" || typeof (payload as any).do === "string" && ((payload as any).do === "protest_place" || (payload as any).key)) {
        // blackMarket intents — payload.key or protest_place
        const key = (payload as any).key as string;
        const tx = int(payload.tx), ty = int(payload.ty);
        if (key === "protest_place" && tx !== null && ty !== null) {
          // #115: the guest armed its own targeting and clicked a road — the
          // HOST is authoritative for affordability, road eligibility,
          // occupancy and the charge; the guest paid nothing locally.
          const placeNow = performance.now();
          let bounced = false;
          // PERK-1 (#600): Return to Sender — the match's first card played
          // on the host's Dolores is returned to the guest at the door: the
          // crowd auto-places on the GUEST'S OWN costliest public road.
          const defender = otherSeat(p);
          if (returnToSenderOf(perkManagerOf(defender)) && !defender.sentBack) {
            defender.sentBack = true;
            const tile = pickProtestTarget(p.id, placeNow);
            if (tile) {
              if (!canPayBlackCard(p, "protest")) {
                defender.sentBack = false;
                toast("Needs Gold for protest.", "bad");
              } else {
                payBlackCard(p, "protest");
                protests.set(tIdx(tile[0], tile[1]), { tx: tile[0], ty: tile[1], until: placeNow + PROTEST_MS, owner: p.id });
                floats.add("✊ PROTEST", tile[0], tile[1], { cls: "sabotage", now: placeNow });
                toast(`Returned to sender — the protest stops ${escText(p.name)}'s own road.`, "bad");
                bounced = true;
              }
            } else {
              defender.sentBack = false;   // no road of the guest's to stop: not spent
            }
          }
          if (!bounced) {
            if (!canPayBlackCard(p, "protest")) {
              toast("Needs Gold for protest.", "bad");
            } else if (!isPublicRoad(track, tx, ty)) {
              toast("Protests go on public roads.", "bad");
            } else if (protests.has(tIdx(tx, ty))) {
              toast("Protest already there.", "bad");
            } else {
              payBlackCard(p, "protest");
              protests.set(tIdx(tx, ty), { tx, ty, until: performance.now() + PROTEST_MS, owner: p.id });
              floats.add("✊ PROTEST", tx, ty, { cls: "sabotage", now: performance.now() });
              toast("Protest placed.", "good");
            }
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
      } else if (what === "undo") {
        // BUILD-1 (#460): a guest's undo rides through the host — the host
        // owns the record, runs the SAME window + dependency checks, and the
        // echo tells the guest the outcome (its chip is optimistic).
        const rec = undoRecs.get(p.id);
        if (!rec) echoed.push("nothing to undo");
        else {
          const why = applyUndo(p, rec, performance.now());
          if (why) echoed.push(why);
          else echoed.push("Undo — the build was refunded.");
        }
      } else {
        const tx = int(payload.tx), ty = int(payload.ty);
        const rot = int((payload as any).rot ?? (payload as any).view ?? 0) ?? 0;
        if (tx !== null && ty !== null) {
          if (what === "factory") placeFactoryFor(p, tx, ty, rot);
          else if (what === "depot") placeHarvester(tx, ty, p);
          else if (what === "plant") placePlant(tx, ty, p, rot);
          else if (what === "demolish") doDemolish(tx, ty, p);
          else if (what === "protest_place") {
            // legacy
            if (canPayBlackCard(p, "protest") && isPublicRoad(track, tx, ty) && !protests.has(tIdx(tx, ty))) {
              payBlackCard(p, "protest");
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
        // MP-MGR: a seated human guest is a HUMAN seat (it was left `false`,
        // which made the host ignore the guest's manager intent). An
        // AI-filled room (`aiOpponent`) keeps `false` and the machine.
        if (!aiOpponent && info.roster.length >= 2) players[1].human = true;
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
        // C2 (#257): the conversation records it either way. A toast is gone in
        // two seconds; the last line of a chat log that just went quiet is
        // where a player looks to find out why, and the ending does not change
        // that.
        chatNotice(`${who} left the room.`);
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
        const grace = Math.round(Math.max(graceMs, 0) / 1000);
        chatNotice(`${mpPeerAwayName} disconnected — holding their seat for ${grace}s…`);
        toast(`${escText(mpPeerAwayName)} disconnected — holding their seat for `
          + `${grace}s…`, "info");
      },
      opponentReconnected: (username) => {
        duelPeer("back");
        mpPeerAwayUntil = 0;
        const back = username || mpPeerAwayName || "Opponent";
        chatNotice(`${back} is back — the match resumes.`);
        toast(`${escText(back)} is back — the match resumes.`, "good");
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
  type OverlayFrame = { items: OverlayItem[]; ghost: GhostSpec | null; invite?: LaneInviteView | null };
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

  // ── BUILD-1 (#460): the legal-spot highlight ─────────────────────────────
  // Arming Depot, Factory/Processing Plant or Platform washes every LEGAL
  // anchor in the tool's own rule with a soft aqua tint. The set is computed
  // ONCE per tool arm and per network change (never per frame) and reused by
  // every paint until something the rules read has moved — `netVersion`
  // bumps on every build/demolish, `rail.rail.revision` on every rail edit,
  // and the rotations change the shape a site is judged in.
  let legalSpotCache: { key: string; items: OverlayItem[] } | null = null;
  /** The legal anchors the armed placement tool paints, cached per arm/network. */
  const legalSpotItems = (): OverlayItem[] => {
    const assistTool = phase === "setup-factory" ? "plant" : tool;
    if (assistTool !== "harvester" && assistTool !== "plant" && assistTool !== "platform") {
      legalSpotCache = null;
      return [];
    }
    const rotKey = assistTool === "harvester" ? depotView ?? ""
      : assistTool === "plant" ? factoryView : railView;
    const key = `${assistTool}:${rotKey}:${netVersion}:${rail.rail.revision}:${phase}`;
    if (!legalSpotCache || legalSpotCache.key !== key) {
      let spots: [number, number][] = [];
      if (assistTool === "harvester") {
        spots = legalDepotSpots(grid, eco.harvesters, depotLocks());
      } else if (assistTool === "plant") {
        spots = legalPlantSpots(grid, track, eco, factoryView);
      } else {
        spots = legalPlatformSpots(grid, rail, railPlants(), me.i + 1, railView,
          lockedIndustryIdsFor(eco, me.id));
      }
      legalSpotCache = {
        key,
        items: spots.map(([tx, ty]) => ({ sprite: "highlight_legal", tx, ty })),
      };
    }
    // "Every legal anchor IN VIEW": the set is whole-map (one compute per arm
    // and per network change), the paint is culled to the camera each frame.
    const view = visibleTileRange(cam, 4);
    return legalSpotCache.items.filter((i) =>
      i.tx >= view.x0 && i.tx <= view.x1 && i.ty >= view.y0 && i.ty <= view.y1);
  };

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

  /** F3 (#274): R rotates the factory/plant ghost a quarter-turn. */
  const rotateFactoryView = () => {
    factoryView = (factoryView + 1) & 3;
    return factoryView;
  };

  const factoryPlanForTool = (tx: number, ty: number): PlacementPlan => {
    const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true, track, rot: factoryView });
    const why = plantRefusal(grid, track, eco, tx, ty, factoryView);
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
  /**
   * RAIL-8: fold a station's invitation into a frame — the new lane's tiles
   * banded, its stop marked, the transparent lane standing where it would
   * stand (green when a click would build it, red when it would be refused),
   * and the dashed "+" badge's caption. The SAME `laneRefusal` the click runs.
   */
  const withLaneInvite = (frame: OverlayFrame, inv: LaneInvite): OverlayFrame => {
    const ok = inv.why === "ok";
    const items = [...frame.items];
    const band = ok ? "highlight_soft" : "highlight_bad";
    for (const [x, y] of laneInviteTiles(inv)) items.push({ sprite: band, tx: x, ty: y });
    items.push({ sprite: "node_mark", tx: inv.stop[0], ty: inv.stop[1] });
    const st = structureById(rail, inv.stationId);
    const g = laneGhostItems(inv.origin.tx, inv.origin.ty, st?.view ?? railView, inv.len);
    const cost = seatCostOf(me, RAIL_COSTS.lane, "platform");
    const label = !ok ? (LANE_WHY_SHORT[inv.why] ?? "Can't add a lane here")
      : canPayBuild(me, RAIL_COSTS.lane, "platform") ? `Add lane · $${cost}` : `Add lane · need $${cost}`;
    return {
      items,
      ghost: { sprite: g[0].sprite, tx: g[0].tx, ty: g[0].ty, valid: ok, sprites: g },
      invite: { slab: inv.slab, ok, label },
    };
  };
  const overlayPlanAt = (tx: number, ty: number): OverlayFrame => {
    const items: OverlayItem[] = [];
    let ghost: GhostSpec | null = null;
    let invite: LaneInviteView | undefined;
    const factoryGhostSprite = (rot: number) => factorySpriteFor(shapesOn, rot);
    if (phase === "setup-factory") {
      // PP-02: the preview enforces the same town-adjacency rule as the click.
      const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true, track, rot: factoryView });
      pushPlan(items, plan);
      ghost = { sprite: factoryGhostSprite(factoryView), tx, ty, valid: plan.valid };
    } else if (tool === "harvester" || phase === "setup-harvester") {
      const plan = planDepotPlacement(grid, eco.harvesters, tx, ty, depotLocks());
      pushPlan(items, plan);
      // The outpost art is the cargo's, so the preview shows the mill/rig/mine
      // this site would actually raise (see `depotPreviewSprite`).
      ghost = { sprite: depotPreviewSprite(grid, tx, ty, depotView), tx, ty, valid: plan.valid };
    } else if (laneToolStation !== null) {
      // RAIL-6 (#575): the upgrade preview — the lane the click would build
      // (strip banded, its three stopping tiles banded soft, the stop tile
      // marked), green when `laneRefusal` says ok and red when it does not,
      // with the concrete slab as the ghost. The SAME refusal the click runs.
      const st = structureById(rail, laneToolStation);
      if (st && st.kind === "platform") {
        const side = laneSideFor(st, tx, ty);
        const why = laneRefusal(grid, rail, me.i + 1, st.id, side);
        const ok = why === "ok";
        const probe = nextLaneAt(st, side);
        for (const [x, y] of laneSlabTiles(probe)) {
          if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) items.push({ sprite: ok ? "highlight" : "highlight_bad", tx: x, ty: y });
        }
        for (const [x, y] of laneTrackTiles(probe)) {
          if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) items.push({ sprite: ok ? "highlight_soft" : "highlight_bad", tx: x, ty: y });
        }
        const stop = laneStopTile(probe);
        items.push({ sprite: "node_mark", tx: stop[0], ty: stop[1] });
        // RAIL-7 (#603): ghost draws exactly what will be placed — same sprites
        // as the lane that `addStationLane` will build, via the shared
        // `laneGhostItems` helper (one source of truth with `railStructureItems`).
        const g = laneGhostItems(probe.tx, probe.ty, st.view, probe.len);
        ghost = { sprite: g[0].sprite, tx: g[0].tx, ty: g[0].ty, valid: ok, sprites: g };
        invite = {
          slab: laneSlabTiles(probe), ok,
          label: ok ? `Click to add · $${seatCostOf(me, RAIL_COSTS.lane, "platform")}` : (LANE_WHY_SHORT[why] ?? "Can't add a lane here"),
        };
      }
    } else if (tool === "loop") {
      // FLEET-2 (#596): the ghost is the run (tinted) and the side track that
      // would be laid beside it, green when `loopRefusal` says ok, red else.
      const ok = loopRefusal(grid, rail, me.i + 1, tx, ty, railView) === "ok";
      for (const [x, y] of loopRunAt(tx, ty, railView)) {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) items.push({ sprite: ok ? "highlight_soft" : "highlight_bad", tx: x, ty: y });
      }
      for (const [x, y] of loopStripAt(tx, ty, railView)) {
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) items.push({ sprite: ok ? "highlight" : "highlight_bad", tx: x, ty: y });
      }
      const g = loopGhostItems(tx, ty, railView, atlasRef ?? undefined);
      if (g.length) ghost = { sprite: g[0].sprite, tx: g[0].tx, ty: g[0].ty, valid: ok, sprites: g };
    } else if (tool === "platform" || tool === "raildepot") {
      // RAIL-02 (#176): the same overlay contract as every other placement
      // tool — the footprint green or red, and the transparent building
      // standing in the heading the player is holding (R turns it). The plan is
      // the SAME refusal function the click runs, so the two cannot disagree.
      const kind: "platform" | "depot" = tool === "platform" ? "platform" : "depot";
      const why = kind === "platform"
        ? platformRefusal(grid, rail.structures, railPlants(), me.i + 1, tx, ty, railView, undefined, lockedIndustryIdsFor(eco, me.id), rail.rail)
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
      // RAIL-7 (#603): ghost draws exactly what will be placed — same sprites
      // as `railStructureItems` for the structure the click would build, via
      // the shared helpers `platformGhostItems` / `depotGhostItems` (one source
      // of truth, so they can't drift again).
      if (kind === "platform") {
        const g = platformGhostItems(tx, ty, railView, atlasRef ?? undefined);
        ghost = { sprite: g[0].sprite, tx: g[0].tx, ty: g[0].ty, valid: ok, sprites: g };
      } else {
        const g = depotGhostItems(tx, ty, railView);
        ghost = { sprite: g[0].sprite, tx: g[0].tx, ty: g[0].ty, valid: ok, sprites: g };
      }
    } else if (tool === "interchange") {
      const plan = planInterchange(grid, track, me.i + 1, tx, ty, me.purse, previewBalance(me, "road"));
      for (const [x, y] of plan.tiles.length ? plan.tiles : [[tx, ty, 0]])
        items.push({ sprite: plan.why ? "highlight_bad" : "highlight", tx: x, ty: y });
    } else if (tool === "dam") {
      // R3 (#270): the ghost is the footprint the click would build — the
      // river tile and the bank the held side leans onto (folds to the
      // axis's first side when it runs along the river), green when the site
      // says ok, red on the refusal the click will voice. The ghost sprite is
      // the one the world draws once built (`dam_y` spans a river along x,
      // `dam_x` a river along y).
      const river = damRiverAt(grid, tx, ty);
      if ("why" in river) {
        items.push({ sprite: "highlight_bad", tx, ty });
      } else {
        const side = damSideAtSite(tx, ty, damSide);
        const why = damRefusal(grid, eco.dams, me.i + 1, tx, ty, side);
        const ok = why === "ok";
        for (const [x, y] of damFootprint({ wx: tx, wy: ty, side })) {
          if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) {
            items.push({ sprite: ok ? "highlight" : "highlight_bad", tx: x, ty: y });
          }
        }
        const [ox, oy] = damDrawOrigin({ wx: tx, wy: ty, axis: river.axis });
        ghost = { sprite: river.axis === "x" ? "dam_y" : "dam_x", tx: ox, ty: oy, valid: ok };
      }
    } else if (tool === "plant") {
      // AI-03c: the mid-game plant preview paints from the same folded plan
      // the test twin and the click share — no more green footprints over a
      // building the overlay never saw.
      // F3: ghost art swaps to _r when rotated.
      const plan = factoryPlanForTool(tx, ty);
      pushPlan(items, plan);
      ghost = { sprite: factoryGhostSprite(factoryView), tx, ty, valid: plan.valid };
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
      // RAIL-8: a station of mine under the pointer (or one just clicked) offers its next lane
      const inv = laneInviteUnder(tx, ty);
      if (inv) return withLaneInvite({ items, ghost }, inv);
    }
    // RV-03: hovering an existing depot shows the road the truck takes. The
    // depot is found by tile, so the hover route and the truck agree even when
    // the current tool is not a placement tool (setup phases hover empty tiles
    // and find no depot, so they never double up).
    const dep = eco.harvesters.find((h) => depotContains(h.tx, h.ty, tx, ty));
    if (dep) items.push(...routeOverlayFor(dep));
    return { items, ghost, invite };
  };
  /** The tile items alone — the shape `__iso.overlayItemsFor` has always had. */
  const overlayItemsAt = (tx: number, ty: number): OverlayItem[] =>
    overlayPlanAt(tx, ty).items;
  /** Everything the overlay layer draws this frame (and, on the side, the lane badge). */
  const overlayFrame = (): OverlayFrame => {
    const frame = computeOverlayFrame();
    laneInviteView = frame.invite ?? null;
    return frame;
  };
  const computeOverlayFrame = (): OverlayFrame => {
    if (preview) {
      const items: OverlayItem[] = preview.tiles.map(([x, y]) => ({ sprite: "highlight", tx: x, ty: y }));
      // #298: the tiles the drag ran into and refused — painted red, not built.
      for (const [x, y] of preview.blocked ?? []) {
        items.push({ sprite: "highlight_bad", tx: x, ty: y });
      }
      if (track.diagonalRoads && tool !== "rail") {
        for (const [x, y] of preview.unaffordable) items.push({ sprite: "highlight_bad", tx: x, ty: y });
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
    if (levelPlan && drag) {
      // #456: the level drag paints the patch green, the automatic edge
      // ramps as node marks (the ring they'll climb), and the refused tiles
      // red — the road drag's own "blocked" convention, so a red tile in a
      // level drag means exactly what it means in a road drag: this one
      // stays as it is.
      const items: OverlayItem[] = [];
      const rx0 = Math.min(drag.ax, drag.bx), rx1 = Math.max(drag.ax, drag.bx);
      const ry0 = Math.min(drag.ay, drag.by), ry1 = Math.max(drag.ay, drag.by);
      for (const [x, y] of levelPlan.changes) {
        const inRect = x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
        items.push({ sprite: inRect ? "highlight" : "node_mark", tx: x, ty: y });
      }
      for (const [x, y] of levelPlan.refused) items.push({ sprite: "highlight_bad", tx: x, ty: y });
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
    if (!hover) {
      // RAIL-8: a station clicked on a phone keeps its invitation up with no pointer over it
      const pinned = pinnedLaneStation !== null ? laneInviteUnder(-1, -1) : null;
      const base: OverlayFrame = { items: legalSpotItems(), ghost: null };
      return pinned ? withLaneInvite(base, pinned) : base;
    }
    // Every placement tool — the opening Factory, a Depot, and (since the
    // overlay was unified) the mid-game plant — paints from its placement
    // plan, so all three get the same footprint/reach/node read AND the same
    // transparent building. The plant used to grow its own overlay here
    // (PP-06) which tinted a refused footprint faintly instead of red; the
    // plan it now shares marks each blocking tile individually, matching both
    // the click and the test twin.
    const frame = overlayPlanAt(hover.tx, hover.ty);
    // BUILD-1 (#460): the legal-spot wash rides under the hover's own verdict
    // — the painter keeps the hovered tile green/red, never washed.
    const legal = legalSpotItems();
    return legal.length
      ? { items: [...legal, ...frame.items], ghost: frame.ghost, invite: frame.invite }
      : frame;
  };

  /**
   * L8 (#222): the two readouts the HUD is handed every frame — the objective
   * line ("what do I do next") and the live per-cargo income the chip bar
   * prints. Held here rather than inside `paintUi` so the debug twin can hand
   * a test exactly what the last frame painted, without reading the DOM.
   */
  let objective: string | null = null;
  let objectiveKey: string | null = null;
  // GOAL-1 (#459): click-pan target / arm-tool produced by the advisor this frame.
  let objectiveTarget: NextStep["target"] = null;
  let objectiveTool: AdvisorTool | null = null;
  let incomeRates: Partial<Record<Cargo, number>> | undefined;

  /**
   * BUILD-1 (#460): the cursor card's refusal — a short REASON plus the FIX
   * for the tile under the pointer, from the SAME rule the click enforces.
   * Money refusals are included: a site the rules accept but the purse cannot
   * pay answers "Not enough money — $N more", because that IS the refusal
   * the click would voice. Null when the hover is buildable and payable.
   */
  function hoverAssist(atTile?: { tx: number; ty: number } | null): AssistCopy | null {
    const tile = atTile ?? hover;
    if (!tile) return null;
    const { tx, ty } = tile;
    if (phase === "setup-factory") {
      // BUILD-1 (#460): the opening Factory gets the same reason+fix voice as
      // every later build — its own rule, same cursor card.
      const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true, track, rot: factoryView });
      if (plan.valid) return null;
      if (plan.code === "not-near-town")
        return { reason: "Must touch a town", fix: "pick a lot whose edge meets a town tile" };
      return { reason: "Can't build here", fix: placementReasonText(plan.code) ?? "pick open flat ground" };
    }
    if (tool === "harvester" || phase === "setup-harvester") {
      // BUILD-1 (#460): the new loop tunes one Depot at a time — while a
      // session is open, every lot is refused for THAT reason, so say it.
      if (newLoop && tuning) {
        return { reason: "Tuning in progress", fix: "finish or abandon the open session first" };
      }
      const plan = planDepotPlacement(grid, eco.harvesters, tx, ty, depotLocks());
      if (!plan.valid) {
        // "Taken by the rival" only when it IS the rival's network holding
        // every industry beside the lot — the seat's own hold gets the
        // neutral voice.
        let rivalHolds = false;
        if (plan.code === "industry-taken" && plan.served.length) {
          const locks = industryLocks(eco);
          rivalHolds = plan.served.every((ind) => {
            const holder = locks.get(ind.id);
            return holder !== undefined && holder.owner !== me.id;
          });
        }
        // BUILD-1 (#460) × #456: a lot that only lacks LEVEL ground is no
        // longer a dead end — the fix is the Level tool's own price for this
        // footprint (`slopeAssistFor` runs the seam main left for it).
        if (plan.code === "not-flat") return slopeAssistFor(grid, depotTiles(tx, ty), { track });
        return depotAssistFor(plan.code ?? "", rivalHolds);
      }
      const cargo = newLoop
        ? depotCargo(eco, { id: -1, owner: me.id, ownerId: me.i + 1, tx, ty })
        : null;
      const price = priceDepot(buildPurse(me), me.freeDepots, { cargo, tier: me.depotTier, newLoop });
      if (price.locked && price.type) {
        return { reason: "Rung locked", fix: `tune a Depot to open rung ${price.tier + 1}` };
      }
      // PERK-1 (#600): the refusal quotes the money the click charges.
      if (!canPayBuild(me, price.cost, "depot")) return MONEY_ASSIST(seatCostOf(me, price.cost, "depot"), me.money);
      return null;
    }
    if (tool === "plant") {
      const why = plantRefusal(grid, track, eco, tx, ty, factoryView);
      // The same #456 courtesy the Depot gets: price the level that would
      // make this footprint flat instead of sending the player hunting.
      if (why === "not-flat") {
        return slopeAssistFor(grid, plantFootprintTiles(tx, ty, factoryView, factoryFp), { track });
      }
      if (why !== null) return PLANT_ASSIST[why];
      if (!canPayBuild(me, PLANT_COST)) return MONEY_ASSIST(moneyCostOf(PLANT_COST), me.money);
      return null;
    }
    // RAIL-6 (#575): the armed upgrade reads its refusal in the assist's
    // voice, priced like every other build — the hover card and the click
    // share `laneRefusal`, so they cannot disagree.
    if (laneToolStation !== null) {
      const st = structureById(rail, laneToolStation);
      if (!st) return null;
      const why = laneRefusal(grid, rail, me.i + 1, st.id, laneSideFor(st, tx, ty));
      if (why !== "ok") return RAIL_ASSIST[why];
      // PERK-1 (#600): the lane prices with the platform class.
      if (!canPayBuild(me, RAIL_COSTS.lane, "platform")) {
        return MONEY_ASSIST(seatCostOf(me, RAIL_COSTS.lane, "platform"), me.money);
      }
      return null;
    }
    if (tool === "loop") {
      // FLEET-2 (#596): the same refusal the click runs, in the assist's voice.
      const why = loopRefusal(grid, rail, me.i + 1, tx, ty, railView);
      if (why !== "ok") {
        if (why === "loop-slope") {
          return slopeAssistFor(grid, [...loopRunAt(tx, ty, railView), ...loopStripAt(tx, ty, railView)], { track });
        }
        return RAIL_ASSIST[why];
      }
      if (!canPayBuild(me, RAIL_COSTS.loop, "platform")) return MONEY_ASSIST(seatCostOf(me, RAIL_COSTS.loop, "platform"), me.money);
      return null;
    }
    if (tool === "platform" || tool === "raildepot") {
      const why = tool === "platform"
        ? platformRefusal(grid, rail.structures, railPlants(), me.i + 1, tx, ty, railView, undefined, lockedIndustryIdsFor(eco, me.id), rail.rail)
        : depotRefusal(grid, rail, me.i + 1, tx, ty, railView);
      if (why !== "ok") {
        if (why === "industry-taken" && tool === "platform") {
          // The voice follows the holder, like the Depot's: the seat's own
          // network holding the anchor is "already claimed", not the rival's.
          const anchor = resolveAnchor(grid, railPlants(), me.i + 1, tx, ty, railView);
          if (anchor?.kind === "industry") {
            const holder = industryLocks(eco).get(anchor.id);
            if (holder && holder.owner === me.id) return DEPOT_ASSIST["industry-taken"];
          }
        }
        // A structure whose site only needs levelling says so, with the price
        // the Level tool would charge for that footprint (#456's seam).
        if (why === "not-flat") {
          const [sw, sh] = footprintFor(tool === "platform" ? "platform" : "depot", railView);
          return slopeAssistFor(grid, footprintTiles({ tx, ty, w: sw, h: sh }), { track });
        }
        return RAIL_ASSIST[why];
      }
      const cost = tool === "platform" ? RAIL_COSTS.platform : RAIL_COSTS.depot;
      // PERK-1 (#600): the assist prices in the class the click will charge.
      const railCls: BuildClass = tool === "platform" ? "platform" : "trainDepot";
      if (!canPayBuild(me, cost, railCls)) return MONEY_ASSIST(seatCostOf(me, cost, railCls), me.money);
      return null;
    }
    return null;
  }

  /**
   * SCEN-2 (#602): the live counters a scenario's objective reads, in the
   * shape `scenario-goals.ts` takes — the seat's cargo arrivals, the best
   * PLAYED Depot tuning, the train lines it is running and the battles it has
   * won. `trainLines` is read off the rail state rather than counted, because
   * the rail IS the truth: recall the last train off a line and the line stops
   * counting, which is what "a train line is running" is supposed to mean.
   */
  const scenarioGoalState = (): ScenarioGoalInput => ({
    delivered: scenarioDelivered,
    bestTuningStars: scenarioBestTuningStars,
    trainLines: rail.lines.filter((l) => l.ownerId === me.i + 1
      && rail.trains.some((tr) => tr.lineId === l.id)).length,
    battlesWon: scenarioBattlesWon,
  });

  /**
   * Where the objective lane's click should take the eye, per goal: the seat's
   * Plant for a delivery job (cargo lands there) and its first Depot for a
   * tuning one (that is what gets tuned). Rail and battle goals recentre on
   * the player's anchor (null) — the lane's own contract for "no target".
   */
  const scenarioGoalTarget = (o: ScenarioObjective): { tx: number; ty: number } | null => {
    // A delivery job lands at the Plant; a tuning job happens at a Depot.
    if (o.kind === "deliver") {
      const f = eco.factories.find((x) => x.owner === me.id);
      return f ? { tx: f.tx, ty: f.ty } : null;
    }
    if (o.kind === "tune") {
      const d = eco.harvesters.find((h) => h.owner === me.id);
      if (d) return { tx: d.tx, ty: d.ty };
      const f = eco.factories.find((x) => x.owner === me.id);
      return f ? { tx: f.tx, ty: f.ty } : null;
    }
    return null;
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
      const key = `${netVersion}:${total}:${line}:${p.name}:${(p === me)}`;
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
          // B7 (#252): the battle route, with its cap spelled out
          `Contested sites held: ${b.holdsHeld}${b.holdsHeld > b.holds ? ` (${b.holds} pay)` : ""} × ${VICTORY.loop.hold}★ = ${fmtVp(b.holdVp)}★ (max ${VICTORY.loop.holdCap}★)`,
        ]
        : [
          `Paved road tiles: ${b.paved} × 0.25★ = ${fmtVp(b.pavedVp)}★`,
          `Processing plants: ${b.plants + 1} (opening plant is free; ${b.plants} × 1★ = ${fmtVp(b.plantVp)}★)`,
        ];
      const tip = [
        `${p.name}${p === me ? " (you)" : ""} — ${fmtVp(total)}★ of ${line}★`,
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
    // BUILD-1 (#460): one currency story — every build the cursor prices is
    // quoted in $ (`moneyMarkup`); cargo icons belong to the city upgrade.
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
        ? moneyMarkup(preview.cost, seatCostOf(me, preview.cost, tool === "rail" ? "rail" : "road"))
        : (preview.free > 0 ? `${preview.free} free` : "free");
      costInfo = hintLine(
        `<b>${n}</b> ${n === 1 ? "tile" : "tiles"}` + (preview.truncated
          ? ` · <i>${preview.why ? (tool === "rail"
              ? (RAIL_REFUSAL_TEXT[preview.why as keyof typeof RAIL_REFUSAL_TEXT] || "blocked")
              : roadDragRefusalText(preview.why)) : "blocked"}</i>` : ""),
        `${vpTxt} · ${owed}`,
      );
    } else if (levelPlan && drag) {
      // #456: the level drag's own numbers — what levels, what ramps, what
      // refuses, and the price BEFORE the click (the acceptance's "preview
      // shows the price first"). `levelPlan.money` is exactly what the
      // commit charges; the ramp tiles ride the same per-level price.
      const rx0 = Math.min(drag.ax, drag.bx), rx1 = Math.max(drag.ax, drag.bx);
      const ry0 = Math.min(drag.ay, drag.by), ry1 = Math.max(drag.ay, drag.by);
      let inside = 0, ramps = 0;
      for (const [x, y] of levelPlan.changes) {
        if (x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1) inside++; else ramps++;
      }
      const n = levelPlan.refused.length;
      const tilesTxt = `<b>${inside}</b> ${inside === 1 ? "tile" : "tiles"}`
        + (ramps ? ` + ${ramps} edge ramp${ramps === 1 ? "" : "s"}` : "")
        + (n ? ` · <i>${n} refused</i>` : "");
      const units = levelPlan.levels;
      costInfo = hintLine(tilesTxt,
        `${units} tile-level${units === 1 ? "" : "s"} · ${moneyMarkup(levelBill(units), seatCostOf(me, levelBill(units), "level"))}`);
    } else if (tool === "level") {
      costInfo = hintLine(
        "drag to flatten to where you started · Shift+click raises · Alt+click lowers",
        `${moneyMarkup(levelBill(1), seatCostOf(me, levelBill(1), "level"))} a tile-level`,
      );
    } else if (tool === "interchange" && hover) {
      const plan = planInterchange(grid, track, me.i + 1, hover.tx, hover.ty, me.purse, previewBalance(me, "road"));
      costInfo = hintLine(plan.why ? `<i>${plan.why}</i>` : "Diamond interchange · ready",
        `1 overpass + 4 ramps + new road · ${moneyMarkup(plan.cost)}`);
    } else if (tool === "plant" && hover) {
      // PP-06: the refusal reason is PREVIEWED from the same rule the click
      // enforces, so a click is never a surprise — and this hint is the only
      // place it is spelled out before the click (the inspector's plan
      // verdicts cover the setup Factory and the Depot, not a mid-game plant).
      // VP-01: the ★ a plant is worth rides along, since no button states it.
      // BUILD-1 (#460): a refused tile says the REASON and the FIX; a legal
      // one the purse cannot pay says how much money is short.
      const assist = hoverAssist();
      if (assist) costInfo = hintLine(`<i>${assistText(assist)}</i>`);
      else costInfo = hintLine("ready to raise", `+${fmtVp(VICTORY.plant)}★ · ${moneyMarkup(PLANT_COST)}`);
    } else if (tool === "loop") {
      // FLEET-2 (#596): the reason + fix from the same refusal the click runs.
      const assist = hoverAssist();
      if (assist) costInfo = hintLine(`<i>${assistText(assist)}</i>`);
      else {
        const price = seatCostOf(me, RAIL_COSTS.loop, "platform");
        costInfo = hintLine("Passing Loop · ready", `$${price.toLocaleString("en-US")}`);
      }
    } else if (tool === "platform" || tool === "raildepot") {
      // BUILD-1 (#460): the railway structures had no cursor verdict of their
      // own — a refused tile was just red. The reason + fix come from the
      // same refusal the click runs; a legal tile quotes its $ price.
      const assist = hoverAssist();
      if (assist) costInfo = hintLine(`<i>${assistText(assist)}</i>`);
      else {
        const name = tool === "platform" ? "Platform" : "Train depot";
        const price = seatCostOf(me, tool === "platform" ? RAIL_COSTS.platform : RAIL_COSTS.depot,
        tool === "platform" ? "platform" : "trainDepot");  // PERK-1 (#600): the class the click charges
        costInfo = hintLine(`${name} · ready`, `$${price.toLocaleString("en-US")}`);
      }
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
      //
      // BUILD-1 (#460): a refused tile leads with its reason + fix (the
      // money refusal included — "$N more", never a resource list).
      const assist = hoverAssist();
      const cargo = newLoop && hover
        ? depotCargo(eco, { id: -1, owner: me.id, ownerId: me.i + 1, tx: hover.tx, ty: hover.ty })
        : null;
      const price = priceDepot(buildPurse(me), me.freeDepots, { cargo, tier: me.depotTier, newLoop });
      const label = price.type ? price.type.name : "Depot";
      if (assist) {
        costInfo = hintLine(`<i>${assistText(assist)}</i>`);
      } else if (price.locked && price.type) {
        costInfo = hintLine(`<i>${label} — rung ${price.tier + 1} locked · ${rungLabel(price.unlocked)}</i>`);
      } else if (canPayBuild(me, price.cost, "depot")) {
        // PERK-1 (#600): the hint quotes the money the click charges.
        costInfo = hintLine(
          newLoop && price.type
            ? `place it inside an industry's catchment · ${label} ${moneyMarkup(price.cost, seatCostOf(me, price.cost, "depot"))}`
            : "place it inside an industry's catchment",
        );
      } else {
        costInfo = hintLine(`<i>${assistText(MONEY_ASSIST(seatCostOf(me, price.cost, "depot"), me.money))}</i>`);
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
      // One message, one place: when the hint bar (bottom, with its ✕ cancel)
      // already carries the refusal's reason + fix, the inspector stands down
      // instead of repeating it top-right.
      if (costInfo) { info = ""; infoTone = null; }
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
            // E4 (#268): on an elevation map the number the clock measures is
            // the route's tiles PLUS its climb (`depotPathLength`), so it can
            // be fractional — print it to one decimal there, and byte for byte
            // as it always was on the flat (where it is a whole number).
            info += `<br>` + (d.tiles === null || band === null
              ? `distance: <i>no route</i>`
              : `distance: ${Number.isInteger(d.tiles) ? d.tiles : d.tiles.toFixed(1)} tiles · ×${d.factor} (${band})`);
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
            // R3 (#270): the dam's two halves, off the same read the clock
            // pays — the depot term as its own line, the city term folded
            // into the factor's city bonus the way the tick folds it.
            const damH = damFactorsFor(seat, h, res.connection?.factory);
            const readout = depotReadout({
              yieldLevel: depotYield(h),
              // The tier the upgrade is COUNTED in (L6's re-tune credit): a
              // free dirt road is the same tier as no road at all, and paving
              // is what "this Depot got upgraded" means.
              transportLabel: depotTransportTier(eco, comp, h) === 0 ? "dirt" : "paved",
              transportFactor: haulFactor(h),
              distanceTiles: d.tiles,
              distanceFactor: d.factor,
              distanceBand: band,
              cargo,
              amount: cargo ? (res.yields[cargo] ?? 0) : 0,
              serviced: res.serviced && res.connection.kind !== null,
              stopped: protestedDepot(h, now, comp),
              townBonus: Math.max(0, seat.townBonus) + damH.damCity,
              damBonus: damH.dam,
              // L6 (#220): decay is the difficulty's axis — the line prints the
              // row's own cooling and floor, and nothing at all when the row
              // has no decay (Easy, Normal).
              decayRate: difficultyRules().decayRate,
              minYield: difficultyRules().minYield,
              tickMs: HARVEST_MS,
            });
            info += `<br>${readout.yieldLine}<br>${readout.rateLine}`;
            // #462: cargo/min, $/min, the slowest segment, the lorry's trips.
            // Same seams as the clock (and the Select card), appended so the
            // L8 lines the tests already pin stay byte-for-byte.
            const ledger = routeLedgerHtml(h, now);
            if (ledger) info += `<br>${ledger}`;
            if (readout.damLine) info += `<br>${readout.damLine}`;
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
          && tileInFootprint(hover.tx, hover.ty, x.tx, x.ty, factoryFp[0], factoryFp[1], x.rot ?? 0));
        const served = eco.harvesters.filter((h) => h.owner === owner
          && resolveConnection(eco, componentsFor(h.ownerId), h).factory === f).length;
        info = `<b>Processing Plant</b> (${owner === "you" ? "yours" : "rival"})<br>` +
          `plant ${(f?.id ?? 0) + 1} of ${list.length}` +
          (f?.townId != null ? ` · ${grid.towns[f.townId]?.name ?? `town ${f.townId + 1}`}` : "") + `<br>` +
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
          info = `<b>${t.name ?? `Town ${t.id + 1}`}</b> — ${isBank ? "Town Bank" : "Town Square"}, a ${townTierLabel(tier)}<br>` +
            (mine
              ? (price?.def
                ? `click to upgrade · ${costLabel(price.cost)}`
                : `fully upgraded`)
              : `the town your Factory touches is the one you upgrade`);
        }
      } else if (ref && ref.kind === "dam") {
        // R3 (#270): the dam answers with what it IS and what it PAYS — the
        // same two numbers the clock and the Depot cards read, so the map and
        // the ledger never disagree about the bonus.
        const d = eco.dams.find((x) => x.id === (ref as { id?: number }).id);
        if (d) {
          info = `<b>Hydro Dam</b> (${d.owner === me.id ? "yours" : "rival's"})<br>` +
            `+${Math.round(DAM_BONUS * 100)}% output for Depots within ${DAM_RANGE} tiles` +
            (d.owner === me.id
              ? `<br>and for your city when it stands in range`
              : `<br>the rival's bonus — contest the river before they dam it`);
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
                ? `pave it for <b>+${fmtVp(VICTORY.upgrade)}★</b> ($${moneyValueOf(UPGRADE_COST)})`
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

    // #462: Street / Road / Highway armed, pointer on a route tile — what
    // upgrading that stretch would do to this seat's busiest Depot.
    if (hover && armedUpgradeTier()) {
      const preview = upgradePreviewAt(hover.tx, hover.ty);
      if (preview) info = info ? `${info}<br><b>${preview}</b>` : `<b>${preview}</b>`;
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
    // GOAL-1 (#459): the "Next step" advisor replaces the old objectiveLine.
    // It reads live state (factories, depots, money, market, town upgrades,
    // rival contests) and returns one line, a target tile and a tool. Click
    // is wired through the same onTool/onRecenter doors the player uses.
    objectiveTarget = null;
    objectiveTool = null;
    // SCEN-2 (#602): a scenario's own objective owns the lane while it is
    // OPEN and the match is being PLAYED — the boot's first clicks are still
    // the loop's own onboarding (plant, first Depot, connect it), which the
    // advisor must keep saying, and the briefing already fed the scenario's
    // terms. Once the goal is met it hands the lane straight back and says so
    // in the Feed, once: `ui.feed` is the single message channel HUD-1 left.
    if (newLoop && scenarioDef) {
      const goal = scenarioGoalState();
      if (scenarioGoalDone(scenarioDef.objective, goal)) {
        if (!scenarioGoalFed) {
          scenarioGoalFed = true;
          ui.feed(`${scenarioDef.name}: ${scenarioDef.objective.done}`, "Scenario");
        }
      } else if (phase === "play") {
        objective = scenarioGoalLine(scenarioDef.objective, goal);
        objectiveKey = `scenario:${scenarioDef.id}`;
        objectiveTarget = scenarioGoalTarget(scenarioDef.objective);
      }
    }
    if (newLoop) {
      const myDepots = eco.harvesters.filter((hh) => hh.owner === me.id);
      // Build the per-cargo price map for the idle-money/Stockpile rule.
      const prices: Partial<Record<Cargo, number>> = {};
      for (const c of CARGOES) {
        if (sellable(c)) prices[c] = priceOf(market, c, marketMs);
      }
      // Tuning anchor tile, for click-pan while the board is up.
      let tuningTarget: { tx: number; ty: number } | null = null;
      const tNow = tuning;
      if (tNow) {
        if (tNow.kind === "town") {
          const fac = eco.factories.find((f) => f.owner === me.id);
          if (fac) tuningTarget = { tx: fac.tx, ty: fac.ty };
        } else {
          const d = eco.harvesters.find((h) => h.id === tNow.depotId);
          if (d) tuningTarget = { tx: d.tx + 1, ty: d.ty + 1 };
        }
      }
      // CONTRACT-1: active contract feeds GOAL-1 advisor
      const activeForAdvisor = activeContracts.find((a) => a.owner === 0 && a.status === "active") ?? null;
      const advisorContract = activeForAdvisor
        ? {
            label: `${activeForAdvisor.def.amount - activeForAdvisor.delivered} ${CARGO[activeForAdvisor.def.cargo].name} → ${activeForAdvisor.def.townName} (${contractTimeLeftText(activeForAdvisor, now)})`,
            target: (() => {
              const t = grid.towns.find((tt) => tt.id === activeForAdvisor.def.townId);
              return t ? { tx: t.tx, ty: t.ty } : null;
            })(),
          }
        : null;
      const step = nextStepAdvisor({
        phase,
        playerId: me.id,
        factories: eco.factories,
        harvesters: eco.harvesters,
        industries: grid.industries,
        towns: grid.towns,
        isConnected: (h) => isServiced(eco.track, h, eco.rail),
        money: me.money,
        purse: me.purse,
        freeDepots: me.freeDepots,
        depotTier: me.depotTier,
        townLevel: me.townLevel,
        marketPrices: prices,
        tuning: tNow
          ? {
              kind: tNow.kind,
              cargo: tNow.cargo,
              movesLeft: tuningMovesLeft(tNow),
              moves: tNow.moves,
              target: tuningTarget,
            }
          : null,
        activeContract: advisorContract,
        contestedIndustry: null,     // RIVAL-3 (#467) plugs in later
        winTarget: winTarget(),
        newLoop: true,
      });
      // The advisor only gets the lane when nothing else has claimed it — a
      // scenario's open objective (above) outranks it, exactly as the tuning
      // session outranks both inside `nextStepAdvisor`.
      if (objectiveKey === null) {
        objective = step.text;
        objectiveKey = step.key;
        objectiveTarget = step.target;
        objectiveTool = step.tool;
      }

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
          // R3 (#270): the dam's halves, the same read the clock pays — the
          // depot term as its own factor, the city term folded into the
          // factor's city bonus, so the chip rate and the tick cannot drift.
          const damR = damFactorsFor(me, h, res.connection?.factory);
          for (const [cargo, amount] of Object.entries(res.yields) as [Cargo, number][]) {
            rows.push({
              cargo,
              amount,
              yieldLevel: depotYield(h),
              distanceFactor: d.factor,
              transportFactor: haulFactor(h),
              townBonus: Math.max(0, me.townBonus) + damR.damCity,
              damBonus: damR.dam,
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
        id: p.id, name: p.name, colour: p.colour, vp: vpFor(score, p.id), human: p === me,
        vpTip: vpTooltip(p),
        // CAST-1: each seat's face — the manager, or Cornelius Graves.
        face: seatFace(p),
      })),
      purse: me.purse,
      // ECON-1 (#421): money and the exchange. The rows are derived every
      // paint from the pure price model — no cached prices to go stale, and
      // the same numbers a sale is charged at.
      money: me.money,
      // BUILD-1 (#460): the Undo chip's countdown. The record and its window
      // live with the game; the chrome only counts it down and greys it when
      // blocked. Null = no open build to undo.
      undo: (() => {
        const now = performance.now();
        const u = undoChipState(now);
        if (!u) return null;
        return { leftMs: Math.max(0, u.untilMs - now), blocked: u.blocked, kind: u.kind };
      })(),
      market: marketRows(),
      marketEvent: eventsAt(seed, marketMs).map((e) => e.label).join(" · ") || null,
      // MKT-2 (#465): the next slot's rumour, ~60 s before the event it names.
      marketRumour: rumourAt(seed, marketMs, skillKey)?.label ?? null,
      // L16 (#231): the storage cap the resource bar prints its "amount / cap"
      // readout against — derived from the seat's city level, so the bar and
      // the clock can never disagree. Undefined when no cap applies: the
      // shipped loop, and dev mode's unlimited purse (the cap is bypassed
      // there; `?unlimited=0` brings it back for real-economy playtests).
      storageCap: newLoop && !devUnlimited ? storageCapFor(me.townLevel) : undefined,
      phase,
      tool: (tool === "road" && roadTier !== "road" ? roadTier : tool) as any,
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
      // GOAL-1 (#459): click the advisor → pan camera + arm the right tool.
      objectiveTarget,
      objectiveTool,
      incomeRates,
      // …and the optional quests: what a character suggests, in their voice,
      // with the progress and the reward the game has already computed. The
      // panel is empty on the retired loop and once the match is won.
      // CONTRACT-1 (#466): town contracts replace Quests — deliveries with
      // deadlines, and a public tender both seats race. Active contracts show
      // progress bars/timers Space Age style, offers show Accept.
      quests: newLoop && phase !== "won"
        ? {
            hidden: contractsHidden,
            items: [
              // Active contracts first (with progress)
              ...activeContracts
                .filter((a) => a.owner === 0 && a.status === "active")
                .map((a) => {
                  const now = performance.now();
                  return {
                    id: a.def.id,
                    who: speakerName(a.def.speaker, storyOn ? CAST[rivalCast].name : null),
                    text: `${a.def.amount} ${CARGO[a.def.cargo].name} → ${a.def.townName} (${a.def.kind})`,
                    progress: contractProgressText(a),
                    reward: `$${a.def.rewardMoney}${a.def.rewardTown ? ` + town growth` : ""}`,
                    kind: a.def.kind,
                    delivered: a.delivered,
                    amount: a.def.amount,
                    timeLeftMs: contractTimeLeft(a, now),
                    timeLeftText: contractTimeLeftText(a, now),
                    active: true,
                    tender: a.def.kind === "tender",
                  };
                }),
              // Then offers
              ...contractOffersList.map((def) => {
                return {
                  id: def.id,
                  who: speakerName(def.speaker, storyOn ? CAST[rivalCast].name : null),
                  text: `${def.amount} ${CARGO[def.cargo].name} → ${def.townName} in ${Math.round(def.deadlineMs / 60000)}m — $${def.rewardMoney}${def.rewardTown ? " + town" : ""}`,
                  progress: def.kind === "tender" ? "TENDER — both seats race" : "PRIVATE",
                  reward: `$${def.rewardMoney}`,
                  kind: def.kind,
                  delivered: 0,
                  amount: def.amount,
                  timeLeftMs: def.deadlineMs,
                  timeLeftText: `${Math.round(def.deadlineMs / 60000)}m`,
                  active: false,
                  tender: def.kind === "tender",
                };
              }),
            ],
          }
        : null,
      reach: quarry.reach,
      // PP-14b: the 30s reset cooldown, so the button can count it down.
      // #116: per seat — a guest counts down ITS OWN clock (its cooldown
      // lives on the host; this mirror moves when the guest requests).
      resetIn: Math.max(0, RESET_COOLDOWN_MS - (now - (isGuest() ? guestResetAt : lastResetAt))),
      // PP-14b: the tycoon portrait picked on the start screen.
      portrait,
      // CAST-1: the Black Market at this seat's prices, with the Fixer's chip.
      blackMarket: {
        cooldownSeconds: Math.ceil(Math.max(0, (me.blackMarket?.readyAt ?? 0) - marketMs) / 1000),
        frostSeconds: Math.ceil(Math.max(0, (me.blackMarket?.frostUntil ?? 0) - marketMs) / 1000),
        redTapeSeconds: Math.ceil(Math.max(0, (me.blackMarket?.redTapeUntil ?? 0) - marketMs) / 1000),
        gold: Object.fromEntries(Object.keys(SABOTAGE).map((k) => [k, blackGoldFor(me, k)])),
        security: securityCostFor(me),
        fixer: perksOf(perkManagerOf(me)).freeBlack > 0
          ? { left: fixerLeftFor(me), max: perksOf(perkManagerOf(me)).freeBlack, refillMs: fixerRefillIn(marketMs) }
          : undefined,
      },
      // NAMES: the top-bar Names button paints its pressed state from this.
      showNames,
      networkView,
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
                : tuningSessionYield(tuning, difficultyRules().minYield, depotYieldCap(eco.harvesters.find((hh) => hh.id === tuning!.depotId)?.level)),
              abandonYield: tuning.kind === "town"
                ? TUNING_ABANDON_YIELD
                : abandonYieldFor(difficultyRules()),
              // #301: whether the board is mid-cascade — Finish is disabled
              // only while this is true, not when moves run out.
              busy: quarry.board.busy,
              // PERK-1 (#600): the seat's session keys, as the plate prints
              // them — undefined (the key absent) when the seat carries no
              // such perk, so a null manager opens the shipped plate exactly.
              ...(buyMovesOffer(perkManagerOf(me)) && sessionBuysLeft > 0
                ? { buyGold: buyMovesOffer(perkManagerOf(me))!.gold, buysLeft: sessionBuysLeft }
                : {}),
              ...(perksOf(perkManagerOf(me)).secondSight
                ? { hintOk: true, shufflesLeft: sessionShufflesLeft }
                : {}),
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
          ...fleetTrainOptions(r),
          // RAIL-6 (#575): the upgrade preview in the HUD — the row prints
          // what the next lane costs this seat (perk included), and while the
          // tool is armed, what the click will do.
          hint: r.actions.includes("lane")
            ? `next lane $${seatCostOf(me, RAIL_COSTS.lane, "platform")}`
              + (laneToolStation === r.id ? " · click a side of the station" : "")
            : r.actions.includes("assign") || r.actions.includes("buy") ? `buys a train · ${railCostLabel(RAIL_COSTS.train)}`
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
    // R2 (#266): the layer comes along so the bridge-junction rule can answer —
    // a tile that would hang a side connection on a standing deck.
    const refusal = buildRefusal(grid, kind, tx, ty, undefined, undefined, track);
    if (refusal === null) return;
    if (refusal === "water") {
      // A river is water a bridge could have crossed; the sea and the lakes
      // never are. Say which one refused, so "why not" is answered on the spot.
      toast(grid.rivers?.[tIdx(tx, ty)]
        ? "That river is too wide (or too bent) to bridge here."
        : "Can't build on water.", "bad");
    } else if (refusal === "bridge-junction") {
      toast(BRIDGE_REFUSAL_TEXT.junction, "bad");
    } else if (refusal === "rough") toast("A paved Road can't cross rough ground — use a Dirt Road.", "bad");
    else if (refusal === "too-steep") toast("That is too steep — a road climbs at most one level per tile.", "bad");
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
      me.freeTrack, structureTiles(eco.factories, eco.harvesters, me.i + 1, factoryFp), newLoop,
      // R2 (#266): the drag sees the railway, because a deck is never shared —
      // a road may not span water the railway already bridges.
      { railAt: (x, y) => hasRail(rail.rail, x, y), gradeSeparated: true, railDeckAt: (x, y) => !!(rail.rail.tile[tIdx(x, y)] & RAIL_OVERPASS) }, kind === "road" ? roadTier : "road", previewBalance(me, "road"));
    if (pv.tiles.length === 0) return null;
    if (isGuest()) {
      net?.sendIntent("build", { do: "track", kind, ax, ay, bx, by, xFirst,
        roadTier: kind === "road" ? roadTier : "road",
      });
      return pv;
    }
    commitTrackDrag(me, pv, kind, roadTier);
    return pv;
  };

  // A factory is one multi-tile sprite, but has one network anchor: its
  // origin tile. Town clicks with the plant tool resolve to a legal site
  // beside that town, identically for pointer-move previews and pointer-up.
  // In track mode a click ANYWHERE on our factory must start at
  // that anchor; otherwise a click on its far tiles would start a road the
  // network cannot reach. Keep raw tile picking for other tools/structures.
  const pickForAction = (x: number, y: number) => {
    // MAP-2 (#559): the Level Ground tool targets GROUND — the tile the cursor
    // is over — so a resource whose art covers the lots beside its footprint
    // no longer swallows the click (every such click used to answer with the
    // industry's own tile and refuse with "A building stands there"). Every
    // other tool keeps the sprite-first pick it was built around.
    const p = renderer?.pick(x, y, { sprites: tool !== "level" });
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
    // B7 (#252): who holds it BY BATTLE (the Hold ★), and the viewer's clock
    const won = contestedIndustries(eco).get(ind.id);
    if (won) lines.push(`⚔ Last battle won by ${seatName(won)} (+${VICTORY.loop.hold}★ while held)`);
    const wait = battleCooldownLeft(challengeState, now, me.id);
    if (wait > 0) lines.push(`Your next challenge: ${fmtBattleCooldown(wait)}`);
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
      // B7 (#252): the battle holder (Hold ★) and the viewer's clock
      hold?.holder ? `⚔ Last battle won by ${seatName(hold.holder)} (+${VICTORY.loop.hold}★ while held)` : "",
      battleCooldownLeft(challengeState, now, me.id) > 0
        ? `Your next challenge: ${fmtBattleCooldown(battleCooldownLeft(challengeState, now, me.id))}` : "",
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

  /**
   * MOB-1 (#474): on a phone a TAP with a structure tool no longer builds — it
   * stages the build here and opens the confirm sheet (`ui.showPlaceConfirm`);
   * Place runs it, Cancel or any drop (`dropDrag`) forgets it. A pan never
   * reaches the stage: `onUp` only stages a press that did not move.
   */
  let pendingPlacement: { tool: Tool; tx: number; ty: number } | null = null;
  const CONFIRM_TOOLS: ReadonlySet<Tool> = new Set<Tool>(
    ["harvester", "plant", "platform", "loop", "raildepot", "interchange", "dam", "demolish"]);

  /** D2: one preview seam for pointer motion and R (including tier/bridge costs). */
  const previewRoadGesture = (): DragPreview | null => drag ? previewDrag(
    grid, track, tool as TrackKind, me.purse, drag.ax, drag.ay, drag.bx, drag.by, drag.xFirst,
    undefined, me.freeTrack, structureTiles(eco.factories, eco.harvesters, me.i + 1, factoryFp), newLoop,
    { railAt: (x, y) => hasRail(rail.rail, x, y), gradeSeparated: true, railDeckAt: (x, y) => !!(rail.rail.tile[tIdx(x, y)] & RAIL_OVERPASS) }, tool === "road" ? roadTier : "road", previewBalance(me, "road"),
  ) : null;

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
        if (drag) { drag = null; preview = null; levelPlan = null; dragLive = false; paintOverlayNow(); }
        return;
      }
    }
    const p = pickForAction(x, y);
    if (!p) return;
    // AMB-2 (#391): a click near perched birds puts them up. Purely cosmetic
    // and read-only — it changes nothing about what the click then does, and
    // it is a no-op whenever the bird pool is parked (any zoom but the
    // closest, and every performance-mode frame).
    scareBirds(birds, p.tx + 0.5, p.ty + 0.5);
    const isTrackTool = tool === "road" || tool === "dirt" || tool === "rail" || tool === "level";
    // TK-001: left mouse (button 0) is build/place ONLY — it never starts a
    // pan. Touch keeps its old behaviour (one finger pans, a quick tap places).
    // An armed protest owns the left button: it must never start a track drag.
    if (phase === "play" && isTrackTool && !pendingProtest && (!isMouse || e.button === 0) && e.isPrimary) {
      // RAIL-04: the rail drag arms anywhere — like a road drag, it has no
      // network-adjacency seed requirement (the tiles it lays are judged one by
      // one, and the drag stops at the first tile that refuses). #456: a
      // level drag arms anywhere too — its refusals are per-tile and painted.
      const canStart = tool === "rail"
        || tool === "level"
        || canBuildOn(grid, tool as TrackKind, p.tx, p.ty)
        || ownFloor(p.tx, p.ty);
      if (canStart) {
        drag = { ax: p.tx, ay: p.ty, bx: p.tx, by: p.ty, xFirst: true };
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
    const hadPending = !!pendingPlacement;
    if (hadPending) { pendingPlacement = null; ui.hidePlaceConfirm(); }
    if (!drag && !preview && !levelPlan && !hadPending) return false;
    drag = null; preview = null; levelPlan = null; dragLive = false; previewKey = "";
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
    pinnedLaneStation = null;      // RAIL-8: Esc / right-click lets a station's invitation go too
    if (dropDrag() || armed) paintOverlayNow();
    return armed;
  }

  /**
   * Put a build tool in the hand. Switching tools drops a drag that was
   * planned for the previous one — the preview prices `tool`'s own tiles, so
   * a road drag left armed under the Depot tool would quote the wrong build.
   */
  function armTool(t: Tool) {
    // Playtest (2026-09): picking any tool (Select included) ends a city pick
    // and its upgrade cursor.
    if (cityPick) setCityPick(false);
    pinnedLaneStation = null;      // RAIL-8: a new tool in the hand drops a pinned station invitation
    // RAIL-05 (#182): the flag down means the tool does not exist. Refuse the
    // arm and keep whatever is already in the hand — a hotkey that would
    // summon a refused build is just a confusing one.
    if (!railAvailable && RAIL_TOOL_KEYS.has(t)) {
      toast("Rail is not available in this mode.", "info");
      return;
    }
    // R3 (#270): the dam is a rivers-plus-new-loop tool. Without the rivers
    // map option there is no dam-able water, and without the new loop there
    // is no clock-income factor for the bonus to multiply — so a hotkey that
    // arms it in that mode would summon a build the rules always refuse.
    if (t === "dam" && !DAMS_ENABLED) return;
    if (t === "dam" && !(riversOn && newLoop)) {
      toast("Dams need a river map (rivers on) and the new economy loop.", "info");
      return;
    }
    // #456: Level Ground edits `Grid.height`, and a map with no height bytes
    // has nothing to edit — refuse the arm and say so, like the dam does.
    if (t === "level" && !grid.height) {
      toast("Level Ground needs an elevation map — start a game with elevation on.", "info");
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
        if (tool === "level") {
          // #456: the level preview is `planLevel`'s — the same function the
          // commit re-runs, so the tiles painted and the price shown are one
          // number. Re-plans only when the end tile (or the target's own
          // height, if the ground moved under us) changed.
          drag.bx = p.tx; drag.by = p.ty;
          const levelKey = `level:${drag.ax},${drag.ay}:${p.tx},${p.ty}:${heightAt(grid, drag.ax, drag.ay)}`;
          if (!levelPlan || levelKey !== previewKey) {
            levelPlan = planLevel(grid, rectTiles(drag.ax, drag.ay, p.tx, p.ty), { track },
              heightAt(grid, drag.ax, drag.ay));
            previewKey = levelKey;
            changed = true;
          }
          if (changed) paintOverlayNow();
          return;
        }
        if (tool === "rail") {
          // RAIL-04: the rail preview is `railPreview`'s — the same function
          // the commit re-runs, so the tiles drawn and the price charged are one
          // number. The rail revision is in the key because the validity of a
          // crossing and the legality of a merge depend on the network.
          const railKey = `rail:${drag.ax},${drag.ay}:${p.tx},${p.ty}:${netVersion}:${rail.rail.revision}:${purseKeyEarly}`;
          if (!preview || railKey !== previewKey) {
            preview = railPreview(grid, track, rail, me.i + 1, me.purse,
              drag.ax, drag.ay, p.tx, p.ty, true, true);
            previewKey = railKey;
            changed = true;
          }
          if (changed) paintOverlayNow();
          return;
        }
        drag.bx = p.tx; drag.by = p.ty;
        const kind = tool as TrackKind;   // build-track tools are dirt | road
        // A drag re-plans only when something it depends on moved: the end
        // tile, the network (netVersion), the purse or the free allowance.
        // Sub-tile pointer motion reuses the plan it already has.
        const purseKey = CARGOES.map((c) => me.purse[c] ?? 0).join(",");
        const key = `${kind}:${roadTier}:${drag.ax},${drag.ay}:${p.tx},${p.ty}:${drag.xFirst}:${netVersion}:${me.freeTrack}:${purseKey}`;
        if (!preview || key !== previewKey) {
          // Roads anywhere (main): no network adjacency requirement, so the
          // preview is allowed to start anywhere and grow without a seed.
          // L2: the drag prices with the loop's cost model (dirt free under newLoop).
          preview = previewRoadGesture();
          previewKey = key;
          changed = true;
        }
        if (changed) paintOverlayNow();
        return;
      }
      drag = null; preview = null; levelPlan = null; dragLive = false;
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

  /** The play-phase answer to a click/tap with tool `t` at `p` — every build,
   *  demolish and select a map press can mean. MOB-1 (#474) runs it twice:
   *  straight from `onUp`, and from the phone's confirm sheet. */
  function useToolAt(p: NonNullable<ReturnType<typeof pickForAction>>, t: Tool): void {
    if (opts.tutorialSection) {
      const step = guide?.controller.view().step;
      const action = step?.complete;
      // Reading steps leave Select available for inspection, but never spend
      // practice materials on an unrelated placement or demolition.
      const allowed = action?.kind === "build" && (
        (action.what === "platform" && t === "platform") ||
        (action.what === "depot" && t === "harvester"));
      if (t !== "select" && !allowed) return;
    }
    // A bought protest intercepts the click: it stages on a public road
    // (or refuses and stays armed), and never runs the current tool.
    if (pendingProtest) placeProtest(p.tx, p.ty);
    // RAIL-6 (#575): the armed station upgrade intercepts too — the click
    // tile names the SIDE the new lane runs on, and a committed lane puts
    // the tool down again.
    else if (laneToolStation !== null) {
      const st = structureById(rail, laneToolStation);
      if (!st || st.kind !== "platform") laneToolStation = null;
      else {
        const side = laneSideFor(st, p.tx, p.ty);
        if (isGuest()) {
          net?.sendIntent("build", { do: "lane", stationId: st.id, side });
          laneToolStation = null;
        } else if (addStationLaneAt(st.id, side, me)) laneToolStation = null;
      }
    }
    // PP-05: every Depot after the setup allowance pays DEPOT_COST.
    else if (t === "harvester") {
      if (isGuest()) {
        noteGuestBuild("harvester");   // BUILD-1 (#460): optimistic undo chip
        net?.sendIntent("build", { do: "depot", tx: p.tx, ty: p.ty });
      } else placeHarvester(p.tx, p.ty, me);
    } else if (t === "plant") {
      if (isGuest()) {
        noteGuestBuild("plant");       // BUILD-1 (#460): optimistic undo chip
        net?.sendIntent("build", { do: "plant", tx: p.tx, ty: p.ty });
      } else placePlant(p.tx, p.ty, me);
    } else if (t === "platform" || t === "raildepot") {
      // RAIL-02 (#176): the two railway structures. On a guest the click
      // is an intent like every other build; the host runs the same rule
      // function against the guest's seat (and the same heading, which
      // the guest sends with it).
      if (isGuest()) {
        noteGuestBuild(t);          // BUILD-1 (#460): optimistic undo chip
        net?.sendIntent("build", { do: t === "platform" ? "platform" : "raildepot", tx: p.tx, ty: p.ty, view: railView });
      } else if (t === "platform") placeRailPlatform(p.tx, p.ty, me);
      else placeRailDepot(p.tx, p.ty, me);
    } else if (t === "loop") {
      // FLEET-2 (#596): the Passing Loop - the same click shape as a platform;
      // on a guest an intent the host validates with the same `loopRefusal`.
      if (isGuest()) net?.sendIntent("build", { do: "loop", tx: p.tx, ty: p.ty, view: railView });
      else placeRailLoop(p.tx, p.ty, me);
    } else if (t === "interchange") {
      if (isGuest()) net?.sendIntent("build", { do: "interchange", tx: p.tx, ty: p.ty });
      else placeInterchange(p.tx, p.ty);
    } else if (t === "dam") {
      // R3 (#270): the hydro dam, on a guest an intent like every other
      // build — the host runs the same `damRefusal` against the guest's
      // seat. The side is the guest's own (its R), sent with the intent.
      if (isGuest()) {
        net?.sendIntent("build", { do: "dam", tx: p.tx, ty: p.ty, side: damSide });
      } else placeDam(p.tx, p.ty, me);
    } else if (t === "railway") {
      // The panel tool builds nothing on the map: the panel is the UI's,
      // and a click here is a no-op with a hint rather than a refusal.
      toast("The Railway panel is on the left — assign a line, recall or sell a train.", "info");
    } else if (t === "demolish") {
      if (isGuest()) net?.sendIntent("demolish", { do: "demolish", tx: p.tx, ty: p.ty });
      else doDemolish(p.tx, p.ty);
    } else if (t === "select") {
      // RAIL-8: a click on the invitation (the ghost lane's ground / the "+")
      // builds the lane; a click on one of my stations pins the invitation up
      // (a phone has no hover); any other Select click lets it go.
      const under = laneInviteUnder(p.tx, p.ty, false, p.ref ?? null);
      const shown = under ?? laneInviteUnder(p.tx, p.ty, true, p.ref ?? null);
      if (shown && laneInviteTiles(shown).some(([x, y]) => x === p.tx && y === p.ty)) {
        pinnedLaneStation = shown.stationId;
        if (isGuest()) net?.sendIntent("build", { do: "lane", stationId: shown.stationId, side: shown.side });
        else addStationLaneAt(shown.stationId, shown.side, me);
        paintOverlayNow();
        return;
      }
      if (under) {
        pinnedLaneStation = under.stationId;
        paintOverlayNow();
        return;
      }
      pinnedLaneStation = null;
      // L17 (#245): the town's middle building (church, then bank) is
      // the click target for the city upgrade — the map door beside the
      // HUD key. Any other tool keeps its own behaviour above.
      const town = townCentreAt(p);
      if (town) { selectedDepotId = null; townCentreClick(town); }
      else if (newLoop) {
        const ind = industryAt(p);
        if (ind) { selectedDepotId = null; showIndustryCard(ind); }
        else {
          // 2026-09: a click on one of my Depots opens its card
          // (level, yield vs cap, Upgrade, Retune). #462 keeps that
          // Depot's route drawn until the next Select click.
          const d = myDepotAt(p.tx, p.ty);
          if (d) depotCardFor(d);
          else selectedDepotId = null;
        }
      }
    } else if (t === "road" || t === "dirt" || t === "rail") {
      // A tap with a track tool that got here is a refusal: the legal
      // single-tile build is handled where the drag ends (above).
      refuseTrackAt(t as TrackKind, p.tx, p.ty);
    }
  }

  /** MOB-1 (#474): stage a phone tap's build and ask before placing it. */
  function stagePlacement(p: NonNullable<ReturnType<typeof pickForAction>>, t: Tool): void {
    pendingPlacement = { tool: t, tx: p.tx, ty: p.ty };
    ui.showPlaceConfirm({
      tool: t,
      where: `Tile ${p.tx}, ${p.ty}`,
      onConfirm: () => {
        const staged = pendingPlacement;
        pendingPlacement = null;
        if (staged && phase === "play") useToolAt({ ...p, tx: staged.tx, ty: staged.ty }, staged.tool);
      },
      onCancel: () => { pendingPlacement = null; },
    });
  }

  const onUp = (e: PointerEvent) => {
    const [x, y] = pos(e);
    if (opts.tutorialSection && drag) {
      const action = guide?.controller.view().step?.complete;
      if (!(action?.kind === "build" && (action.what === "road" && (tool === "dirt" || tool === "road")
        || action.what === "rail" && tool === "rail"))) {
        drag = null; preview = null; levelPlan = null; downAt = null;
        g = pointerUp(g, e.pointerId);
        return;
      }
    }
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
      const wasLevel = tool === "level";
      drag = null; preview = null; levelPlan = null; dragLive = false; previewKey = "";
      if (!moved && phase === "play" && !pendingProtest) {
        // RAIL-04: one tile of rail under the finger, exactly like a one-tile
        // road — a tap is how a phone lays a single tile.
        if (wasLevel) {
          // #456: a TAP is one tile levelled to its own height (the edge
          // ramps still run), and the modifier keys switch it to the ±1
          // nudge — Shift raises, Alt lowers (Ctrl is right-click on macOS,
          // so it stays out of the shortcuts).
          const nudge = e.shiftKey ? 1 : (e.altKey ? -1 : 0);
          const h0 = heightAt(grid, ax, ay);
          if (nudge > 0 && h0 >= MAX_LEVEL) toast("Already at the top level.", "info");
          else if (nudge < 0 && h0 <= 0) toast("Already at sea level.", "info");
          else requestLevelBuild(ax, ay, ax, ay, h0 + nudge);
        } else if (wasRail) requestRailBuild(ax, ay, ax, ay, true);
        else {
          const pv = requestTrackBuild(tool as TrackKind, ax, ay, ax, ay, true);
          if (!pv) refuseTrackAt(tool as TrackKind, ax, ay);
        }
      }
      downAt = null;
      g = pointerUp(g, e.pointerId);
      return;
    }
    if (drag && levelPlan) {
      // #456: the level drag commits the plan it drew (or, on a guest, sends
      // the same rectangle and target to the host as an intent). The target
      // is the drag-START tile's height — "level to the height of the tile
      // you started on" — and the plan re-runs over the same inputs.
      const [ax, ay, bx, by] = [drag.ax, drag.ay, drag.bx, drag.by];
      const plan = levelPlan;
      drag = null; preview = null; levelPlan = null; downAt = null; previewKey = "";
      if (plan.changes.length || plan.refused.length) requestLevelBuild(ax, ay, bx, by, heightAt(grid, ax, ay));
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
        if (track.diagonalRoads && preview.why) {
          toast(roadDragRefusalText(preview.why), "bad");
          flashAt(drag.ax, drag.ay, "Can't build here");
        } else if (isRoad && (me.purse.ore ?? 0) < (TRANSPORT.road.cost.ore ?? 0)) {
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
        // Keep R's bend order and the original outgoing-step context. Ending
        // the request at the affordable prefix can turn an overpass crossing
        // into a free endpoint, or make a valid bridge lose its far bank.
        requestTrackBuild(tool as TrackKind, drag.ax, drag.ay,
          track.diagonalRoads ? drag.bx : end[0], track.diagonalRoads ? drag.by : end[1], drag.xFirst);
      }
      drag = null; preview = null; levelPlan = null; downAt = null;
      g = pointerUp(g, e.pointerId);
      return;
    }
    drag = null; preview = null; levelPlan = null;

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
        if (opts.tutorialSection && lessonSites) {
          const step = guide?.controller.view().step;
          const site = step?.complete.kind === "build" && step.complete.what === "factory"
            ? lessonSites.factory : step?.complete.kind === "build" && step.complete.what === "depot"
              ? lessonSites.depot : null;
          if (site && (p.tx !== site.tx || p.ty !== site.ty)) {
            toast("Try the highlighted site for this step.", "info");
            downAt = null;
            g = pointerUp(g, e.pointerId);
            return;
          }
          if ((phase === "setup-factory" || phase === "setup-harvester") && !site) {
            downAt = null;
            g = pointerUp(g, e.pointerId);
            return;
          }
        }
        if (phase === "setup-factory") {
          // MP-05: a guest's opening click is an intent like any other — the
          // host places seat 1's Factory by the same town-adjacency rule.
          // F3: orientation on wire.
          if (isGuest()) net?.sendIntent("build", { do: "factory", tx: p.tx, ty: p.ty, rot: factoryView });
          else { if (lessonSites) factoryView = lessonSites.factory.rot; placeFactory(p.tx, p.ty); }
        } else if (phase === "setup-harvester") {
          // PP-05: the setup Depot is free because `me.freeDepots` is still 1 —
          // the allowance is data on the player record, not this phase.
          if (isGuest()) {
            noteGuestBuild("harvester");   // BUILD-1 (#460): optimistic undo chip
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
          // MOB-1 (#474): a phone tap with a structure tool stages the build
          // behind the confirm sheet instead of placing it outright.
          if (!pendingProtest && e.pointerType === "touch" && ui.el.dataset.phone === "1"
            && CONFIRM_TOOLS.has(tool)) {
            stagePlacement(p, tool);
          } else useToolAt(p, tool);
        }
      }
    }
    downAt = null;
    g = pointerUp(g, e.pointerId);
  };
  canvases.overlay.addEventListener("pointerup", onUp);
  canvases.overlay.addEventListener("pointercancel", (e) => {
    drag = null; preview = null; levelPlan = null; dragLive = false; downAt = null; g = pointerUp(g, e.pointerId);
  });
  // The right button is a game control (it drops the held tool to the
  // pointer), so the browser's context menu must never fight it over the map.
  canvases.overlay.addEventListener("contextmenu", (e) => e.preventDefault());
  canvases.overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x, y] = pos(e as unknown as PointerEvent);
    stopCameraMotion();
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
      "5": "demolish", "6": "rail", "7": "platform", "8": "dam", "9": "level",
    };
    if (!isTypingTarget(e) && map[e.key]) {
      if (map[e.key] === "select") cancelPlacement();
      else armTool(map[e.key]);
    }
    // #462: N toggles Network view — every route, coloured by speed. Not a
    // pan key, not a tool. A field, a chord, and key-repeat do not flip it.
    if (!isTypingTarget(e) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") {
      e.preventDefault();
      if (!e.repeat) toggleNetworkView();
    }
    // BUILD-1 (#460): Ctrl/Cmd+Z is the desktop twin of the Undo chip. It
    // only fires when a build is actually inside its 8-second window; the
    // browser's native undo is never ours, so we take the key.
    if (!isTypingTarget(e) && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey
        && e.key.toLowerCase() === "z" && phase === "play") {
      e.preventDefault();
      const why = requestUndo();
      if (why) toast(`Can't undo — ${why}.`, "info");
      return;
    }
    // RAIL-02: R turns the platform/depot heading a quarter turn — the same
    // four headings the art and the footprints are authored in, in the same
    // order (`rotateView` is the rail module's, not a second list here).
    // F3 (#274): R also rotates factory/plant ghost (factoryView), never both at once.
    // R3 (#270): and the dam's bank side (damSide) — the river's axis fixes
    // the footprint, the side is the choice.
    if (!isTypingTarget(e) && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "r") {
      if (track.diagonalRoads && drag && (tool === "road" || tool === "dirt")) {
        e.preventDefault();
        if (!e.repeat) {
          drag.xFirst = !drag.xFirst;
          preview = dragLive ? previewRoadGesture() : null;
          previewKey = "";
          paintOverlayNow();
        }
        return;
      }
      // The Depot is placed in four rotations too, and R turns whichever tool
      // is armed: over a real site it steps through the sides that site can
      // actually open onto, so a turn never promises an impossible entrance.
      if (tool === "harvester" || phase === "setup-harvester") rotateDepotView();
      else if (tool === "plant" || phase === "setup-factory") rotateFactoryView();
      else if (tool === "dam") damSide = DAM_SIDES[(DAM_SIDES.indexOf(damSide) + 1) % DAM_SIDES.length];
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
      if (guideRunning() || storyView) return;
      if (endingView && !endingView.element.classList.contains("hidden")) return;
      // RAIL-6 (#575): the armed lane upgrade is a tool in the hand — Esc
      // puts it down like any other.
      if (laneToolStation !== null) { laneToolStation = null; toast("Lane upgrade cancelled.", "info"); return; }
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
   * Mirror the OS "reduce motion" setting onto the placement overlay AND the
   * drifting clouds (AMB-1 #390), live: the media query is listened to, not
   * read once, because the setting can change while a game is open and the
   * canvas has no stylesheet to fall back on. Absent `matchMedia` (tests, an
   * odd embed) motion simply stays on.
   */
  let motionQuery: MediaQueryList | null = null;
  /**
   * #438: reduced motion hides birds rather than leaving frozen silhouettes.
   * The overlay and clouds retain their own resting-frame policies.
   */
  let reducedMotion = false;
  /**
   * LIGHT-1 (#473): the grade the screen is showing, eased toward the
   * leader's ★ share so a point landing does not pop the light. `lightingPin`
   * is the debug snap (`__iso.lighting(0.6)`) the lead uses for the four
   * stage screenshots; null follows the scoreboard.
   */
  let lightingShown = 0;
  /** `?light=0.6` snaps the arc for a screenshot. Otherwise the scoreboard. */
  let lightingPin: number | null = urlLightingProgress(
    typeof location !== "undefined" ? location.search : undefined,
  );
  const pushMatchLighting = (dtMs: number) => {
    const target = winTarget();
    const goal = lightingPin != null
      ? lightingPin
      : leaderProgress(players.map((p) => vpFor(score, p.id)), target);
    lightingShown = lightingPin != null ? Math.max(0, Math.min(1, lightingPin)) : smoothMatchProgress(lightingShown, goal, dtMs);
    const L = effectiveLighting({
      choice: currentLightingChoice(),
      progress: lightingShown,
      performance: currentGraphics().performance,
      reducedMotion,
    });
    // The shader multiplies tint × exposure. Hand it the already-floored grade
    // so the ground matches the 2D multiply on buildings and roads.
    terrainGl?.setGrade({ tint: L.grade, exposure: 1, light: L.light, sunDrop: L.sunDrop });
    renderer?.setLighting(L);
  };
  const readMotion = () => {
    reducedMotion = !!motionQuery?.matches;
    birds.reducedMotion = reducedMotion;
    return reducedMotion;
  };
  const syncOverlayMotion = () => {
    if (typeof window.matchMedia !== "function") return;
    if (!motionQuery) {
      motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
      motionQuery.addEventListener?.("change", () => {
        renderer?.setOverlayMotion(!motionQuery!.matches);
        renderer?.setCloudMotion(!motionQuery!.matches);
        readMotion();
      });
    }
    renderer?.setOverlayMotion(!motionQuery.matches);
    renderer?.setCloudMotion(!motionQuery.matches);
    readMotion();
  };

  // ── resize ─────────────────────────────────────────────────────────────
  const resize = () => {
    const d = dpr();
    const w = Math.max(1, Math.floor(stage.clientWidth * d));
    const h = Math.max(1, Math.floor(stage.clientHeight * d));
    for (const c of Object.values(canvases)) { c.width = w; c.height = h; }
    terrainGl?.resize(w, h);
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
   * SFX-1 (#463): the departure watch — which trains were dwelling at a
   * platform on the last frame. A train that was dwelling and is rolling now
   * has just pulled out, and that is the moment the whistle blows. Purely
   * presentational (no economy, no wire): guests run it too.
   */
  const dwellingTrains = new Set<number>();
  function whistleDepartures(): void {
    const now = new Set<number>();
    for (const t of rail.trains) {
      if (t.status === "dwelling") {
        now.add(t.id);
        continue;
      }
      // Was dwelling, is rolling: a departure. The battle owns its own mix,
      // so departures during a fight are tracked but stay silent.
      if (dwellingTrains.has(t.id) && !battleScreen) sfx.play("train-whistle", { gain: 0.5 });
    }
    dwellingTrains.clear();
    for (const id of now) dwellingTrains.add(id);
  }

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
      const seen = seenDeliveries.get(truckKey(truck)) ?? 0;
      seenDeliveries.set(truckKey(truck), truck.deliveries);
      if (truck.deliveries <= seen) continue;
      const due = Math.min(truck.deliveries - seen, MAX_CATCHUP);
      // No horn on deliveries: SFX-1 honked every lorry-load (every few
      // seconds with a few routes) and the owner asked for it gone entirely.
      // BUILD-1 (#460): a lorry-load landed from this depot — cargo moved, so
      // an open undo on its build dies (shipped loop; the new loop flags the
      // same thing from its clock in `economyTick`).
      flagUndoCargoMoved(truck.depotId);
      // #461 TUNE-1: coin burst when next load lands after a tuning session.
      const payoff = recentTunePayoff.get(truck.depotId);
      if (payoff && t <= payoff.until) {
        try {
          const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!reduce) {
            // Short coin burst at the factory.
            const coins = ["💰", "🪙", "💰"];
            for (let c = 0; c < coins.length; c++) {
              const offX = (Math.random() - 0.5) * 0.6;
              const offY = (Math.random() - 0.5) * 0.4;
              floats.add(coins[c], truck.factory[0] + offX, truck.factory[1] + offY, { cls: "delivery", now: t + c * 80, life: 1100 });
            }
            sfx.play("coin");
          }
        } catch {}
        // One burst per depot — clear after first delivery.
        recentTunePayoff.delete(truck.depotId);
      } else if (payoff && t > payoff.until) {
        recentTunePayoff.delete(truck.depotId);
      }
      if (truck.ownerId === mine) {
        // SCEN-2 (#602): a scenario's OBJECTIVE still counts arrivals — on the
        // new loop a Depot's cargo is paid by the clock, but the lorry run is
        // what proves the route works, and "deliver N cargo" is the one thing
        // a player can watch happen. Counted before the new loop's early exit
        // below, so the number is taken either loop.
        if (scenarioDef) scenarioDelivered += due;
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
      seed, map: mapOptions, skillKey: skillKey, phase, winnerId: winner?.id ?? null,
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
      // #456: the LEVELLED heights ride the save as the diff from the
      // seed-derived map ("the way map options are" carried) — the terrain
      // regenerates from `seed`, and these are the tiles the players changed.
      ...(seedHeights && grid.height
        ? { heightEdits: heightDiffWire(grid.height, seedHeights, MAP_W, MAP_H) }
        : {}),
      // R3 (#270): the standing dams ride the save in the snapshot's own wire
      // shape (the map re-derives the river, so only the owner and the bank
      // the footprint leans on travel).
      dams: damsToWire(eco.dams),
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
      // CONTRACT-1 (#466): town contracts replace Quests — same but with active
      // contracts that have progress and deadlines.
      quests: newLoop ? questsSave() : undefined,
      contracts: newLoop ? contractsSave() : undefined,
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
        // ECON-1 (#421): the bank balance rides the save with the purse.
        money: p.money,
        // CAST-1: a resumed match keeps the manager it was started with.
        manager: p.manager, fixer: p.fixer,
        // PERK-1 (#600): a resumed match keeps a spent Return-to-Sender bounce.
        sentBack: p.sentBack === true,
        blackMarket: rebaseBlackMarket(p.blackMarket, marketMs, 0),
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
    // #456: the LEVELLED heights — the way map options ride. The terrain is
    // seed-derived and already regenerated; apply the saved diff on top and
    // drop the height caches (the terrain-GL input was mounted before this
    // call, so its corner rows and mesh need the change, not a fresh mount).
    if (grid.height && d.heightEdits?.length) {
      const changed = applyHeightEdits(grid, d.heightEdits);
      invalidateElevation(grid);
      invalidateDraper(grid);
      renderer?.heightsInvalidated(changed);
      terrainGl?.heightsChanged(grid, changed);
      if (threeLayer) syncWorld();   // the 3D models ride the new terrain height
    }
    // R3 (#270): the dams come back the same way — one owner per site, the
    // bank from the wire row. `damsFromWire` validates row by row, so a stale
    // or foreign row is dropped rather than standing a phantom dam.
    eco.dams = damsFromWire(d.dams);
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
    // L8 (#222): legacy quest state — only spent/paid/hidden kept for old saves
    questSpent.clear();
    for (const id of d.quests?.spent ?? []) questSpent.add(id);
    questPaid.clear();
    for (const id of d.quests?.paid ?? []) questPaid.add(id);
    questsHidden = d.quests?.hidden === true;
    quests = [];
    // CONTRACT-1 (#466): contracts replace quests — same restore shape plus active
    contractPendingOffers = (d as any).contracts?.offers ?? null;
    contractSpent.clear();
    for (const id of (d as any).contracts?.spent ?? []) contractSpent.add(id);
    contractPaid.clear();
    for (const id of (d as any).contracts?.paid ?? []) contractPaid.add(id);
    contractsHidden = (d as any).contracts?.hidden === true;
    contractOffersList = [];
    activeContracts = [];
    contractWorld = null;
    // Rehydrate active contracts from save (if any)
    try {
      const rawActive = (d as any).contracts?.active as any[] | undefined;
      if (rawActive?.length) {
        const now = performance.now();
        // We need a view to resolve town names etc — use current view after map gen
        // For now store as pending and resolve in syncContracts; but we can attempt direct
        const view = contractViewNow();
        const pool = contractOffersFor(view, contractRng);
        const byId = new Map(pool.map((c) => [c.id, c]));
        const rebuilt: ActiveContract[] = [];
        for (const ra of rawActive) {
          const def = byId.get(ra.def?.id) ?? {
            id: ra.def.id,
            kind: ra.def.kind,
            cargo: ra.def.cargo as Cargo,
            amount: ra.def.amount,
            townId: ra.def.townId,
            townName: ra.def.townName,
            rewardMoney: ra.def.rewardMoney,
            rewardTown: ra.def.rewardTown,
            deadlineMs: ra.def.deadlineMs,
            speaker: ra.def.speaker as any,
          } as ContractDef;
          rebuilt.push({
            def,
            acceptedAt: ra.acceptedAt ?? now,
            expiresAt: ra.expiresAt ?? (now + def.deadlineMs),
            delivered: ra.delivered ?? 0,
            owner: ra.owner ?? 0,
            status: ra.status ?? "active",
          });
        }
        contractPendingActive = rebuilt;
      }
    } catch {}
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
      // ECON-1 (#421): a pre-money save has no field — the seat keeps its
      // opening balance rather than restoring as bankrupt.
      const mv = (d.players[i] as { money?: number }).money;
      if (typeof mv === "number" && Number.isFinite(mv)) players[i].money = mv;    // PLAY-FIX-1: rent debt survives a save
      // CAST-1: the manager the match was started with. A pre-CAST save has
      // none and keeps the boot's (legacy "vex"/"you" read as Anne/James).
      const sm = (d.players[i] as { manager?: unknown }).manager;
      if (sm !== undefined) players[i].manager = players[i].human ? managerOrNull(sm) : null;
      // PERK-1 (#600): the bounce spend survives a reload (pre-#600 saves: absent = unspent).
      const sbk = (d.players[i] as { sentBack?: boolean }).sentBack;
      if (typeof sbk === "boolean") players[i].sentBack = sbk;
      players[i].fixer = readFixer((d.players[i] as { fixer?: unknown }).fixer);
      players[i].blackMarket = rebaseBlackMarket(d.players[i].blackMarket, 0, marketMs);
    }
    if (me.manager) portrait = me.manager;
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
        noteTownGrew();
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
    score.holds.clear();   // B7 (#252): held contested sites are derived too
    rescore(eco, score, railPlatforms(), loopScoring());
    for (const p of players) starFed.set(p.id, Math.floor(vpFor(score, p.id)));
    phase = d.phase as typeof phase;
    // START-1 (#604): an old save parked in the forced-Depot step of a REAL
    // match resumes in play — the opening Depot is a choice now. A lesson's
    // save keeps its coached step.
    if (phase === "setup-harvester" && !setupNeedsDepot) phase = "play";
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
    if (phase === "won" && winner) { endingRecordable = false; presentEnding(winningSource); }
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
  if (!savesOff) {
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
  /** MON-1 (#367): at most one store panel over the map. */
  let storeView: StorePanelHandle | null = null;
  /** #121: at most one question stands at a time — a repeat click on a
   *  destructive door must not stack a second plate over the first. */
  let confirmView: ConfirmSheetHandle | null = null;
  let menuTeardown: (() => void) | null = null;
  /** B2 (#247): at most one battle screen over the map (`__iso.startBattle`). */
  let battleScreen: BattleScreenHandle | null = null;
  if (topRight) {
    // Owner (2026-09-28): no window onto the rival's plant — the HUD shows
    // their resource amounts and nothing else.

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
    // UI Space Age (P4): the difficulty select and the sound key move off the
    // top bar into the menu's first row — same nodes, same ids and handlers.
    const gameSec = document.createElement("div");
    gameSec.className = "tm-game";
    for (const q of [".rival-skill", "#iso-sound"]) {
      const n = topRight.querySelector(q);
      if (n) gameSec.appendChild(n);
    }
    if (gameSec.childElementCount) pop.appendChild(gameSec);

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
    // TUT-03 (#422): the Tutorial menu — the list of sections, each one
    // replayable in the game you are standing in, with a ✓ on the ones you
    // have finished. It replaces the card tour AND the "How to Play" door:
    // the short text reference lives inside the menu now.
    menuItem("Tutorial", "replay any section · reset your progress", () => guide?.openMenu());
    // B7 (#252): the battle page, one tap from the same menu
    menuItem("How battles work", "turns, mana, abilities, stakes", () => { showBattleHowto(); });
    // MON-1 (#367): the Store — the same panel the front door raises, over
    // the game root, one instance at a time. An unreachable store paints a
    // sentence and closes like any other sheet; it never blocks the match.
    // Owner call (2026-09-25): the Store is dev-only until the RUN store
    // items exist (much later).
    if (import.meta.env.DEV) menuItem("Store", "unlockables · RUN Bits", () => {
      if (storeView) return;
      const view = showStorePanel(ui.el);
      storeView = view;
      void view.promise.then(() => { if (storeView === view) storeView = null; });
    });
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
    // UI Space Age (P4): the top bar keeps only the race, ?, ☰ and the radio;
    // Recenter and Names live here on every device now.
    menuItem("Recenter Map", "jump back to your Factory", recenterCamera);
    menuItem("Names Over The Map", "show or hide the place tags", toggleNames);    if (isSolo()) {
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
      // MON-1 (#367): the store panel dies with the game, same as the sheet.
      storeView?.destroy();
      storeView = null;
      // #121: a question still standing when the game dies must die with it —
      // destroy() answers `false`, so the half-clicked door never runs either.
      confirmView?.destroy();
      confirmView = null;
    };
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
          // RAIL-6 (#575): the station's warehouse tiers and caps ride the
          // same promise; the code-painted lane slab is generated once, here,
          // whenever a quality pass lands the family.
          loadStationSprites(a, cap).then((n) => { makeLaneSlabSprites(a); return n; }),
          // R3 (#270): the dam's two sprites — the same non-gating contract,
          // and only when the game can actually build one.
          ...(riversOn && newLoop ? [loadRiverSprites(a, cap)] : []),
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
    renderer?.setCloudsEnabled(p.clouds); // AMB-1 (#390): same suppression rule
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
    // FLEET-1 (#595): a lorry's identity is depot + slot (`truckKey`).
    const byKey = new Map(prev.map((x) => [truckKey(x), x]));
    const depotsKnown = new Set(prev.map((x) => x.depotId));
    return next.map((t2) => {
      const old = byKey.get(truckKey(t2));
      if (!old) {
        // A lorry just bought for a depot that already runs: it pulls out of
        // the yard after a load, not onto the middle of the road.
        if ((t2.slot ?? 0) > 0 && depotsKnown.has(t2.depotId)) {
          t2.leg = 0; t2.t = 0; t2.reverse = false; t2.waitMs = DEPOT_LOAD_MS;
        }
        return t2;
      }
      t2.deliveries = old.deliveries;
      if (JSON.stringify(t2.route) === JSON.stringify(old.route)
          && JSON.stringify(t2.segFast) === JSON.stringify(old.segFast)) {
        // trucks integrate with dt, so position is the whole migration state
        t2.leg = old.leg; t2.t = old.t; t2.reverse = old.reverse;
        t2.waitMs = old.waitMs;
        t2._yieldMs = old._yieldMs ?? 0;
        t2._stuckMs = old._stuckMs ?? 0;
        t2._lastSpeed = old._lastSpeed ?? 0;
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
      t.rateMult = depotRate(h, distanceInfoFor(h.id).factor) * truckSpeedMultOf(h);
    }
  }

  // PERK-1 (#600): Lead Foot (trucks) and Express (trains) ride each seat's
  // manager. The ticks take the owner multiplier as a closure, so the shared
  // TRUCK_SPEED/RAIL_SPEED constants — and every pinned constant test — stay
  // untouched; an absent/None/other manager is the base rate.
  const seatForOwner = (ownerId: number): PlayerState | null =>
    ownerId === me.i + 1 ? me : ownerId === rival.i + 1 ? rival : null;
  const truckSpeedForOwner = (ownerId: number): number => {
    const p = seatForOwner(ownerId);
    return p ? truckSpeedOf(perkManagerOf(p)) : 1;
  };
  const trainSpeedForOwner = (ownerId: number): number => {
    const p = seatForOwner(ownerId);
    return p ? trainSpeedOf(perkManagerOf(p)) : 1;
  };

  /** Plan the depot lorries, or the empty list when the debug gate is off. */
  let lastSpawnHint: string | null = null;
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

  // AMB-3: one place that builds the vehicle list, so a guest apply and the
  // frame cannot disagree about zoom, performance mode, or a truck's visual
  // hold. The hold is a copy — `trucks.trucks` itself is untouched. These
  // live on the game function, not inside the boot IIFE: truckTick and the
  // guest appliers call them too.
  function paintCars(): PaintCar[] {
    return cars.cars.map((c) => ({
      name: c.name, model: c.model, carIndex: c.carIndex, state: c.state,
      fade: c.fade, route: c.route, leg: c.leg, t: c.t,
    }));
  }
  function ghostTruckState() {
    if (!ambienceVisible("lights", cam.zoom, currentGraphics().performance) || streetLife.ghosts.size === 0) {
      return trucks;
    }
    return {
      trucks: trucks.trucks.map((t) => {
        const g = streetLife.ghosts.get(truckKey(t));
        return g ? { ...t, leg: g.leg, t: g.t, reverse: g.reverse } : t;
      }),
    };
  }
  function composeVehicles() {
    const atlas = atlasRef ?? undefined;
    const showCars = ambienceVisible("cars", cam.zoom, currentGraphics().performance);
    // Lead (2026-09-28): the shipped car sprites keep driving — `carItems`
    // takes the 1950s model sprites when the atlas has them and the car1_*
    // cells otherwise. The vector stand-ins stay off (ambience.ts).
    const carDraw = showCars ? carItems(cars, track, atlas, seed) : [];
    return carDraw
      .concat(truckItems(ghostTruckState(), atlas, track))
      .concat(trainItems(rail, atlas));
  }
  /** Lights, walkers, car yield, and the visual truck hold. Not the economy. */
  function stepAmbience(dtMs: number): void {
    if (currentGraphics().performance) {
      streetLife.time += dtMs;
      streetLife.pedsActive = false;
      return;
    }
    tickAmbience(streetLife, dtMs, { track, grid, zoom: cam.zoom, performance: false });
    if (!isGuest()) {
      tickCars(cars, dtMs, track, grid, seed, {
        yieldTo: trucks.trucks.map((t) => ({
          id: truckKey(t), route: t.route, leg: t.leg, t: t.t, reverse: t.reverse,
        })),
        signals: streetLife.signals,
        timeMs: streetLife.time,
      });
    }
    tickTruckGhosts(streetLife, trucks.trucks, dtMs);
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
        // MAP-2 (#559): and a town's open lots draw trees through that same
        // table (`lotArtAt` filters the town trees by their atlas footprint),
        // so the draw items laid before this load are re-decided here — the
        // same re-sync the building layers do when their footprints land.
        syncWorld();
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
    // #437: the town blocks take the GROUND's grass texture, not the roads'
    // earth — a town lot is a lawn, so it has to grain like the meadow it is
    // cut out of. It loads on this promise because it belongs to the road
    // style; a failure keeps the flat green fallback, which is still grass.
    void loading.track("roads", Promise.all([
      load(asphaltTex), load(dirtTex), load(groundTextureUrls(cap0).grass),
    ]).then(([asphalt, dirt, grass]) => {
      if (disposed) return;
      renderer?.setRoadStyle({
        ...DEFAULT_ROAD_STYLE,
        paved: { ...DEFAULT_ROAD_STYLE.paved, image: asphalt },
        dirt: { ...DEFAULT_ROAD_STYLE.dirt, image: dirt },
        // #159/#437: a town's blocks borrow the GRASS texture and are glazed
        // to a mown green by the painter, so an empty lot reads as a kept
        // lawn instead of the bare brown yard #437 reported.
        town: { ...DEFAULT_ROAD_STYLE.town, image: grass },
      });
    }).catch((err) => {
      console.warn("[roads] material textures failed to load:", err);
    }));

    // RAIL-03 (#177): the railway art rides the boot beside the buildings and
    // the lorries. Non-gating by contract — a missing folder leaves the vector
    // rail standing — and it lands as its own tracked job so the loading screen
    // reports it like every other layer.
    // With the railway flag down there is nothing to draw, so nothing loads.
    if (railAvailable) void loading.track("railway", Promise.all([
      loadRailwaySprites(atlas, cap0),
      loadStationSprites(atlas, cap0),
    ]).then(([railway, stations]) => {
      makeLaneSlabSprites(atlas);   // RAIL-6: the code-painted lane slab
      const n = railway + stations;
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

    // R3 (#270): the dam art rides the boot beside the railway — the same
    // non-gating contract (a missing folder leaves the map standing), and it
    // only loads where a dam can actually stand: the rivers map option on
    // AND the new loop, the two flags the tool and the bonus gate on.
    if (riversOn && newLoop) void loading.track("rivers", loadRiverSprites(atlas, cap0).then((n) => {
      if (disposed || !n) return;
      syncWorld();
      renderer?.recomputePad();
      renderer?.invalidateAll();
    }).catch((err) => {
      console.warn("[rivers] art failed to load:", err);
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
    if (terrainGl) {
      renderer.externalGround = true;
      // PERF (rail-lag, 2026-09-28): the renderer reports changed tiles ONE
      // AT A TIME, and every GL invalidation is a whole regional pass
      // (distance fields, geometry rows, three texture uploads and a
      // whole-lattice height compare). A rail line — or the rival's build —
      // fired dozens of them back to back and froze the game for seconds.
      // Collect the tiles of one synchronous pass and hand them over once.
      const tg = terrainGl;
      const pendingTiles = new Map<number, [number, number]>();
      let flushQueued = false;
      renderer.onTileInvalidated = (tx, ty) => {
        pendingTiles.set(ty * 4096 + tx, [tx, ty]);
        if (flushQueued) return;
        flushQueued = true;
        queueMicrotask(() => {
          flushQueued = false;
          if (!pendingTiles.size) return;
          const tiles = [...pendingTiles.values()];
          pendingTiles.clear();
          tg.invalidateTiles(tiles);
        });
      };
    }
    renderer.setDecals(scenery);
    // PERF-01: the boot policy's terrain, applied before the first frame —
    // a performance-mode boot draws the flat static ground from frame one
    // (the dpr cap above already sized the backing for it). The apply chain
    // starts believing the same state, so a later quality-only change diffs
    // against boot rather than re-applying the performance leg.
    renderer.setPerformanceMode(policy0.performance);
    renderer.setCloudsEnabled(policy0.clouds);   // AMB-1 (#390): the boot sky
    appliedPerf = policy0.performance;
    renderer.overlayPainter = (ctx, c, t) => {
      paintProtests(ctx, c, t);
      // RIVAL-3 (#467): claim flags + the Contested pulse ride on top of the
      // protest crowd — a claim is an announcement, it stands above.
      paintClaimFlags(ctx, c, grid, claimFlagViews(), t);
      // RAIL-8: the station's dashed "+" invitation, on top of its ghost lane
      if (laneInviteView) paintLaneInvite(ctx, c, grid, laneInviteView, t);
    };
    // AMB-2 (#391): the birds go through the renderer's shared
    // ABOVE-STRUCTURES hook — over the buildings, under the placement
    // feedback, on the overlay layer (which is repainted every frame, so a
    // moving bird can never smear in a damage-patched structures frame), and
    // invisible to `renderer.pick`. The painter is a no-op until the fade has
    // run, which only happens at the closest zoom.
    let lastBirdPaint: number | undefined;
    renderer.aboveStructuresPainter = (ctx, c, timeMs) => {
      // #438: update on EVERY bird paint, including direct overlay repaints.
      // This clock is independent of sim/pause/battle. A hidden tab draws no
      // birds; its first visible repaint advances with a capped dt, not a
      // stale position or the entire time spent in the background.
      const birdDt = lastBirdPaint === undefined ? 16 : timeMs - lastBirdPaint;
      lastBirdPaint = timeMs;
      tickBirds(birds, birdDt, {
        grid,
        zoom: c.zoom,
        view: visibleTileRange(c, BIRD_VIEW_PAD),
        performance: currentGraphics().performance,
        reducedMotion,
        suspended: document.hidden,
        vehicles: world.vehicles,
      });
      paintBirds(ctx, c, grid, birds);
      // AMB-3: vector stand-ins for cars, walkers and lights. No-op at the
      // wrong zoom, in performance mode, and once the model sprites land.
      paintAmbience(ctx, c, grid, streetLife, paintCars(), {
        performance: currentGraphics().performance,
        view: visibleTileRange(c, 2),
        atlasHasModels: !!atlasRef?.has("car_sedan_se"),
      });
    };
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
    // SFX-1 (#463): the ambience re-probe counter — see the tail of `frame`.
    let ambienceTick = 0;
    const frame = (t: number) => {
      if (disposed) return;
      if (loopToastPending && !loading.active && !storyView && !guideRunning()) {
        loopToastPending = false;
        toast("The new loop is sandbox-only for now.", "info");
      }
      if (oldSaveToastPending && !loading.active && !storyView && !guideRunning()) {
        oldSaveToastPending = false;
        toast(OLD_SAVE_TOAST, "info");
      }
      if (saveToastPending && !loading.active && !storyView && !guideRunning()) {
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
      // CAST-1: …and the poster's minimum showing time is over.
      if (reveal.arm((loading.ready && !loading.holding) || !loading.active)) {
        lastHarvest = t; lastAi = t; lastRaid = t;
        lastRivalMove = t; lastRivalTrade = t; lastConquestCheck = t;
      }
      const sim = reveal.live;
      // ECON-1 (#421): the MARKET CLOCK. Prices are a function of the map seed
      // and the milliseconds of PLAY, so it only advances while the sim runs
      // (a paused game, the loading screen and a battle freeze the market with
      // everything else) and the host's number rides the wire to the guest.
      if (sim) {
        if (marketLast > 0) marketMs += Math.max(0, Math.min(1_000, t - marketLast));
        marketLast = t;
        if (!isGuest()) marketEventTick();
        // MKT-2 (#465): every seat evaluates its OWN alerts — the guest's run
        // against the mirrored prices, so they need no host round-trip.
        checkAlerts();
      } else marketLast = t;
      if (sim) economyTick(t);
      // END-1 (#472): sample ★ and $ every 10 s for the summary charts
      if (sim) {
        try {
          recordSample(
            matchHistory,
            t,
            vpFor(score, me.id),
            vpFor(score, rival.id),
            me.money,
            rival.money,
          );
        } catch { /* history must never break the frame */ }
      }
      // ECON-1 (#421): the rival works the market on its own clock.
      if (sim && !tutorialSection) rivalMarketTick(t);
      // L8 (#222): the optional quests — pay what is done, keep 2–3 on the
      // panel. Runs beside the clock it pays against, and before the paint
      // that reads the view it derives.
      syncQuests();
      if (sim) quarryTick(t);
      if (sim && !opts.tutorialSection) aiTick(t);
      // Rivalry idle wire: a Torvin saying / dad joke every so often, mid-game.
      if (sim && !tutorialSection) rivalChitChat(t);
      if (sim && !tutorialSection) advisorTick(t);
      if (sim) phaseTick();   // BAL-1 (#471): Feed beats as the leader advances
      if (sim) noteClaimContested();   // RIVAL-3 (#467): the Feed says "Contested"
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
        tickTrucks(trucks, dt, protests.size > 0 ? new Set(protests.keys()) : undefined, track, truckSpeedForOwner);
      } else {
        // Guest: vehicles are host-authoritative — already synced via snapshot/delta,
        // just ensure world.vehicles reflects the synced state (applied in delta handler)
        // No ticking, no replan.
      }
      // AMB-3: walkers, lights and the visual truck hold. Cars tick here too
      // on the host (stepAmbience skips them for a guest, who already has the
      // host's cars). Performance mode parks the whole layer.
      if (sim) stepAmbience(dt);
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
          const hadTrain = rail.trains.some((t) => t.ownerId === me.i + 1);
          let moved = false;
          for (const p of [me, rival]) moved = autoTrains(rail, p.i + 1, grid) || moved;
          if (moved) {
            syncWorld();
            rescoreNow();
            if (!hadTrain && rail.trains.some((t) => t.ownerId === me.i + 1)) notePlayerTrain();
          }
          // FLEET-3: two platforms and no train used to be silent. Say what is
          // missing, once per distinct reason (never a repeat on every edit).
          const spawnHint = trainSpawnHint(rail, me.i + 1, grid);
          if (spawnHint && spawnHint !== lastSpawnHint) toast(spawnHint, "info");
          lastSpawnHint = spawnHint;
        }
      }
      // #302: trains and deliveries are sim too — a resumed game must not roll
      // its lorries into the Factory while the bar is still up.
      // E4 (#268): the grid rides along so a train climbing a slope loses
      // speed the way a lorry does.
      if (sim) tickTrains(rail, dt, grid, trainSpeedForOwner);
      // SFX-1 (#463): departures whistle on the same frame the wheels start.
      if (sim) whistleDepartures();
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

      // LIVE-3D: ease the view turn and keep the screen-centre ground point fixed (camera.ts)
      if (threeLayer) { const turned = tickViewYaw(cam, dt); if (turned) commitCamera(turned); }
      // TRAFFIC-01: trucks and ambient cars share the vehicles list — one
      // depth-sorted pass draws both, and culling treats them identically.
      // TRUCK-BRAND: the atlas decides whether a lorry wears a livery — the
      // branded sprites only exist once `loadVehicleLayers` has installed them
      // (see below), and until then every truck draws the legacy goods cell.
      world.vehicles = composeVehicles();
      const { items, ghost } = overlayFrame();
      // #462: route lines, set before the overlay pass so a frame never paints
      // a stale list. Geometry is cached on the network version.
      renderer!.routeOverlay = composeRouteOverlay(
        networkView, networkView ? networkPaths() : [], focusRoute(),
      );
      // Owner (2026-09-28): no time-of-day arc — it tinted the map orange and
      // its per-rect grade drew boxes round the cars and trains. The world
      // stays in plain daylight; only the `?light=` screenshot pin still grades.
      if (lightingPin != null) pushMatchLighting(dt);
      terrainGl?.render({ x: cam.x, y: cam.y, zoom: cam.zoom, vw: cam.vw, vh: cam.vh, yaw: getViewYaw() }, t);
      renderer!.render(t, items, ghost);
      threeLayer?.updateVehicles(world.vehicles ?? [], threeLift);
      threeLayer?.update(cam);
      mini.paint();
      // #461: camera ease back to Depot after tuning.
      tickCameraAnim(t);
      // TOWN-2 (#470): the tier-up moment. One compare per frame — it repaints
      // (through `syncWorld`) only when a lot's construction look or the hall's
      // flourish actually changed, and lands the finished district by itself
      // when the sequence runs out.
      growthMoment.tick(t);
      floats.frame(t);
      // NAMES: re-anchor the name tags to the live camera (no-op while the
      // Names button has them hidden).
      labels.frame();
    upgradeMarkers.frame();
      paintUi(t);
      // M2 (#256): update live sabotage markers and the event window countdown.
      const sabotageEvents = collectSabotageEvents({
        protests: protests.values(),
        industries: grid.industries,
        players,
        now: t,
      });
      // B7 (#252): contested sites ride the same plate — a dot in the
      // standing winner's colour; a click opens the site's card. The tags'
      // ⚔ text follows the viewer's challenge clock, re-synced only when the
      // printed text would change (once a second at most).
      const contestInd = contestedIndustries(eco);
      const contestTown = contestedTowns(eco);
      const cd = battleCooldownLeft(challengeState, t, me.id);
      contestClock = cd > 0 ? fmtBattleCooldown(cd) : "";
      // RES-LABELS-1: the hovered / selected resource site rides the same key,
      // so the pointer entering or leaving a site re-syncs the tags next frame.
      const ck = `${[...contestInd].join(",")}|${[...contestTown].join(",")}|${contestClock}|${focusIndustryId() ?? ""}`;
      if (ck !== contestKey) { contestKey = ck; syncLabels(); }
      const colourOf = (id: string) => players.find((p) => p.id === id)?.colour ?? "#e0d2b0";
      const contestMarkers: MinimapMarker[] = [
        ...[...contestInd].flatMap(([id, who]) => {
          const ind = grid.industries[id];
          if (!ind) return [];
          return [{
            id: `contest:ind:${id}`, tx: ind.tx + Math.floor(ind.w / 2), ty: ind.ty + Math.floor(ind.h / 2),
            color: colourOf(who), kind: "contest",
            label: `⚔ ${INDUSTRY_BY_KEY[ind.type]?.name ?? "Industry"} — last battle won by ${seatName(who)}`,
          }];
        }),
        ...[...contestTown].flatMap(([id, who]) => {
          const tw = grid.towns[id];
          if (!tw) return [];
          return [{
            id: `contest:town:${id}`, tx: tw.tx, ty: tw.ty, color: colourOf(who), kind: "contest",
            label: `⚔ ${townName(id)} — last battle won by ${seatName(who)}`,
          }];
        }),
      ];
      minimap.setMarkers([...sabotageEventsToMarkers(sabotageEvents, players, t), ...contestMarkers]);
      sabotageWindow.update(t, sabotageEvents);

      // M1 (#254): last in the frame. With the camera still and the network
      // unchanged this is a key compare; hidden, it returns at once. It
      // catches its own errors, so it can never cost the map a frame.
      minimap.frame(netVersion, rail.rail.revision);

      // SFX-1 (#463): the island re-listens at ~2 Hz — a town that grew under
      // a still camera, or the first gesture arming the engine after the last
      // commit, still lands in the right mix within half a second.
      if (++ambienceTick % 30 === 0) probeAmbience();
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
    /** TOWN-4.1 (#677): the size this game resolved — a boot fact, read-only.
     *  `__iso.mapSize` is the option ("standard" | "large"); the tiles are
     *  `__iso.grid.w` × `__iso.grid.h`. */
    get mapSize() { return { name: mapSize, w: MAP_W, h: MAP_H }; },
    /** E1 (#261): inspect the regenerated height map without coupling callers to its storage. */
    heightAt: (tx: number, ty: number) => heightAt(grid, tx, ty),
    /** L1a (#232): the new-loop feature flag, read-only — it is a boot fact
     *  (`opts.newLoop`, or dev-only `?loop=new`). SCEN-2 (#602): scenarios
     *  play it too; a room or a story contract still refuses it. */
    get newLoop() { return newLoop; },
    /**
     * L8 (#222): the readouts the last frame handed the HUD — the objective
     * line (its stability `key` and its text) and the per-cargo income per
     * second. `__iso.objective.text` is what a player reads under the top bar;
     * `__iso.incomeRates` is what the chips print. Exposed so a probe can pin
     * the numbers the chrome paints without parsing the DOM.
     */
    // GOAL-1 (#459): expose the advisor's target+tool so tests/debug can read
    // the click routing the same frame the chrome paints it.
    get objective() { return { key: objectiveKey, text: objective, target: objectiveTarget, tool: objectiveTool }; },
    get incomeRates() { return incomeRates ?? {}; },
    /**
     * L8 (#222): the optional quests as the HUD is being handed them — the
     * offers (id, strategy, progress, reward), what the player dismissed or
     * completed, and whether the panel is hidden. A probe reads the panel's
     * own state here rather than parsing the chrome.
     */
    get quests() {
      const view = questViewNow();
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
     * GFX-01 / PERF-01 / AMB-1: the video settings. `__iso.graphics()` reads
     * them; `__iso.graphics("medium")` / `__iso.graphics(undefined, true)`
     * (the second argument is the miniature tilt-shift) /
     * `__iso.graphics(undefined, undefined, true)` (the third is performance
     * mode) / `__iso.graphics(undefined, undefined, undefined, false)` (the
     * fourth is the AMB-1 clouds) apply them live through the SAME store the
     * ⚙ panel uses — persistence, the DPR re-size and the repaint included.
     */
    graphics: (q?: Quality, miniature?: boolean, performance?: boolean, clouds?: boolean) =>
      setGraphics({ quality: q, miniature, performance, clouds }),
    /**
     * LIGHT-1: `__iso.lighting()` reads the grade the screen is easing toward.
     * `__iso.lighting(0.6)` snaps to that progress (the four stage shots:
     * 0 morning, 0.6 golden hour, 0.9 dusk, then the ending card for night).
     * `__iso.lighting(null)` follows the scoreboard again.
     * `__iso.lighting("day")` / `__iso.lighting("dynamic")` is the settings switch.
     */
    lighting: (arg?: number | null | "day" | "dynamic") => {
      if (arg === "day" || arg === "dynamic") setLightingChoice(arg);
      else if (arg === null) lightingPin = null;
      else if (typeof arg === "number") lightingPin = arg;
      const L = effectiveLighting({
        choice: currentLightingChoice(),
        progress: lightingShown,
        performance: currentGraphics().performance,
        reducedMotion,
      });
      return {
        choice: currentLightingChoice(),
        progress: lightingShown,
        pin: lightingPin,
        stage: L.stage,
        identity: L.identity,
        windows: L.windows,
        grade: L.grade,
      };
    },
    get vp() { return { you: vpFor(score, "you"), ai: vpFor(score, "ai") }; },
    /** VP-01: the target and the two numbers behind a player's total.
     *  AI-04: the target is the difficulty's line (5★ on easy), not a constant. */
    get vpTarget() { return winTarget(); },
    /**
     * SCEN-2 (#602): the LIVE score ledger — the object `rescore` diffs into
     * and `vpFor` reads. Exposed the way `purses` above is: a test that has to
     * drive a seat to its ★ line (a scenario's win check, an end-game card)
     * can set `vp` and hand it to `winCheck()` below, rather than simulating
     * twenty minutes of building. No gameplay path reads this door.
     */
    get score() { return score; },
    /**
     * SCEN-2 (#602): the ★ line itself, runnable on demand — the same
     * `checkWinLine` every build's rescore ends in, with no VP event to ride
     * in on. Refused for a guest, exactly as the ranked verdict is: the host
     * is the only seat that may call a match. Returns whether the match is now
     * decided, so a probe can assert the line without reading `phase`.
     */
    winCheck: () => {
      if (isGuest()) return false;
      checkWinLine([]);
      return phase === "won";
    },
    /**
     * SCEN-2 (#602): the scenario this match is playing and its objective, as
     * the objective lane paints it — null on every non-scenario boot. `line`
     * is the paint string, `done` is the same question the game asks, both
     * read through `scenario-goals.ts` so a probe reads what the player sees
     * instead of re-deriving it.
     */
    get scenario() {
      if (!scenarioDef) return null;
      const state = scenarioGoalState();
      return {
        id: scenarioDef.id,
        name: scenarioDef.name,
        winTarget: scenarioDef.winTarget,
        objective: {
          kind: scenarioDef.objective.kind,
          text: scenarioDef.objective.text,
          target: scenarioDef.objective.target,
          have: scenarioGoalHave(scenarioDef.objective, state),
          done: scenarioGoalDone(scenarioDef.objective, state),
          line: scenarioGoalLine(scenarioDef.objective, state),
        },
      };
    },
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
      if (ok) { noteTownGrew(); growTownArt(t); }
      return ok;
    },
    /**
     * #417: the town draw items exactly as `syncWorld` laid them — sprite,
     * tile and town id. Read-only (the list rebuilds on every world sync);
     * exposed so a probe can check what a grown town actually draws: the
     * base blocks, the tier centre, and the tier-2+ GROWN districts.
     */
    /** LIVE-3D spike: fps (5 s rAF average), draw calls, triangles, instances; null without ?three=1. */
    threeStats: () => threeLayer?.stats() ?? null,
    // LIVE-3D: the view yaw (radians) and the tile the game would pick under a screen pixel at that yaw
    viewYaw: () => getViewYaw(),
    get threeItems() { return lastThreeItems; },
    tileAtScreen: (sx: number, sy: number) => { const p = renderer!.pick(sx, sy, { sprites: false }); return [p.tx, p.ty] as [number, number]; },
    get townDrawItems() {
      return (world.extra ?? [])
        .filter((e) => (e.ref as { kind?: unknown } | undefined)?.kind === "town")
        .map((e) => ({
          sprite: e.sprite,
          tx: e.tx,
          ty: e.ty,
          townId: (e.ref as { kind: string; id: number }).id,
          // TOWN-2 (#470): a lot under construction draws its scaffold or crane
          // sprite — or, until that art exists, its FINISHED sprite at a rising
          // alpha. The draw item reports the alpha either way, so a probe can
          // see the construction state without knowing which art has landed.
          ...(typeof e.alpha === "number" ? { alpha: e.alpha } : {}),
        }));
    },
    /**
     * TOWN-2 (#470): the tier-up moment, read-only — which town is building,
     * the tier it reached, how many lots are going up, which stage the first
     * wave is on, the hall's flourish stage, and whether the sequence was
     * skipped by a click or collapsed by reduced motion. `active` is false once
     * it has landed; the numbers then describe the moment that just ended.
     *
     *   __iso.townGrowth            what is building right now
     *   __iso.finishTownGrowth()    land it at once (what a click does)
     */
    get townGrowth() { return growthMoment.state; },
    /** #470: end the running tier-up moment now — the same door "skippable by
     *  any click" uses, for a probe or an impatient console. False when nothing
     *  was running. */
    finishTownGrowth: () => growthMoment.skip(),
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
    /** ECON-1 (#421): the local seat's money — settable so a test can fund builds. */
    get money() { return me.money; },
    set money(v: number) { me.money = Math.max(0, v); },
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
    /** ECON-1 (#421): every seat's money, and a setter so a test can fund a seat. */
    get moneys() { return players.map((p) => p.money); },
    setSeatMoney: (i: number, v: number) => { const p = players[i]; if (p) p.money = Math.max(0, v); },
    /**
     * MKT-2 (#465): the exchange's doors, exactly as the Market tab calls
     * them — INCLUDING the guest relay (`"relayed"`: the host's delta is the
     * confirmation). A guest's sale moving nothing locally until the host
     * answers is asserted through these.
     */
    exchangeSell: sellDoor,
    exchangeBuy: buyDoor,
    setAlert: alertDoor,
    /** MKT-2 (#465): evaluate the local seat's alerts now; what fired. */
    checkAlerts: () => checkAlerts(),
    /**
     * BUILD-1 (#460): the placement assist. `legalSpots` returns the WHOLE-MAP
     * set the armed tool paints (before the per-frame camera cull), so a test
     * can compare it field-for-field against the placement acceptance over a
     * seed. `assistAt` runs the same cursor-card reason+fix logic for any
     * tile. `undoInfo`/`undoBuild` drive the 8-second undo from a harness.
     */
    legalSpots: (kind: "harvester" | "plant" | "platform") => {
      if (kind === "harvester") return legalDepotSpots(grid, eco.harvesters, depotLocks());
      if (kind === "plant") return legalPlantSpots(grid, track, eco, factoryView);
      return legalPlatformSpots(grid, rail, railPlants(), me.i + 1, railView,
        lockedIndustryIdsFor(eco, me.id));
    },
    assistAt: (tx: number, ty: number) => hoverAssist({ tx, ty }),
    undoInfo: (now = performance.now(), seat = 0) => {
      const p = players[seat] ?? me;
      const rec = undoRecs.get(p.id);
      if (!rec) return null;
      return {
        kind: rec.kind, seat: p.i,
        leftMs: Math.max(0, rec.at + UNDO_WINDOW_MS - now),
        blocked: undoBlockReason(rec, now),
      };
    },
    undoBuild: (now = performance.now()) => requestUndo(now),
    /**
     * #186: the seats, as the game holds them — id, name, whether a person is
     * on it, its purse and its ★. The two-seat purse check ("host and guest
     * purses match") and the AI-seat check both need to see BOTH seats, and
     * `purse` above is only ever the local one.
     */
    get players() {
      return players.map((p) => ({
        i: p.i, id: p.id, name: p.name, human: p.human, feedsLocal: p === me, manager: p.manager, perkManager: perkManagerOf(p),
        purse: { ...p.purse }, vp: vpFor(score, p.id),
        // L5/L16: the seat's place in the tree and the city ladder, and the
        // storage cap that ladder implies — the numbers the wire and the save
        // already carry, exposed so a test can read them on BOTH seats (the
        // rival's cap pressure is the L16 acceptance's third line).
        depotTier: p.depotTier, townLevel: p.townLevel, townBonus: p.townBonus,
        // ECON-1 (#421): money, so a test can read both seats' banks.
        money: p.money,
        storageCap: storageCapFor(p.townLevel),
      }));
    },
    /**
     * ECON-1 (#421): the market, for tests and the console — the live price of
     * a good, the clock it is priced at, and a sale on the local seat.
     */
    market: {
      get ms() { return marketMs; },
      price: (cargo: Cargo) => unitPrice(cargo),
      advance: (ms: number) => { marketMs = Math.max(0, marketMs + ms); },
      sell: (cargo: Cargo, n: number) => sellCargo(me, cargo, n),
      /** MKT-2 (#465): the next slot's rumour label, as the Market tab prints it. */
      rumour: () => rumourAt(seed, marketMs, skillKey)?.label ?? null,
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
          : tuningSessionYield(tuning, rules.minYield, depotYieldCap(eco.harvesters.find((hh) => hh.id === tuning!.depotId)?.level)),
        yieldFloor: rules.minYield,
        abandonYield: town ? TUNING_ABANDON_YIELD : abandonYieldFor(rules),
        /**
         * L10 (#225): the obstacles this session OPENED with — what actually
         * landed on the board, not what the difficulty's table asked for, so
         * the plate (and a test) can say "3 girders" and mean the three on
         * the grid. Null only if a session is somehow up with no record.
         */
        obstacles: sessionObstacles,
        /**
         * PERK-1 (#600): the seat's session perk state, the same numbers the
         * plate's keys print — the extra-moves buy (Gold price + uses left)
         * and Second Sight's reshuffles. Absent when the seat carries no
         * such perk (null manager opens the shipped plate exactly).
         */
        buyGold: buyMovesOffer(perkManagerOf(me))?.gold,
        buysLeft: sessionBuysLeft,
        hintOk: perksOf(perkManagerOf(me)).secondSight,
        shufflesLeft: sessionShufflesLeft,
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
    /** PERK-1 (#600): the session's perk keys, as test twins — the same
     *  calls the plate's DOM keys make. */
    sessionBuyMoves: () => sessionBuyMoves(),
    sessionHint: () => sessionHint(),
    sessionShuffle: () => sessionShuffle(),
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
      tickTrucks(trucks, dtMs, protests.size > 0 ? new Set(protests.keys()) : undefined, track, truckSpeedForOwner);
      stepAmbience(dtMs);
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
        model: (c as any).model ?? null,
      }));
    },
    /** AMB-3: lights, walkers, and the sprite list the lead still has to draw.
     *  Not `__iso.ambience` — that one is the audio bed. */
    get streetLife() {
      return {
        cars: cars.cars.length,
        carBudget: carCount,
        pedestrians: streetLife.peds.length,
        // TOWN-4.2: the signalled set the cars obey (input junctions UNION
        // Avenue crossings) — falls back to the raw ambience map pre-tick.
        lights: (flowSignals()?.junctions ?? streetLife.signals.junctions).size,
        time: streetLife.time,
        art: AMBIENT_ART_NEEDED,
      };
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
      trafficDial = Math.max(0, Math.min(64, Math.trunc(count) || 0));
      carCount = trafficDial;
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
    get blackMarketStates() { return players.map((p) => readBlackMarket(p.blackMarket)); },
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
    /** CAM-1: camera position, and a rival-seat town growth (must not move it). */
    cameraXY: () => ({ x: cam.x, y: cam.y }),
    growTownAs: (townId: number, seat: "you" | "rival") => {
      const t = grid.towns[Math.floor(townId)];
      if (!t) return false;
      growTownArt(t, performance.now(), seat === "you" ? me : rival);
      return true;
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
    /** F3 (#274): quarter-turns the factory/plant ghost is rotated — R turns it. */
    get factoryView() { return factoryView; },
    setFactoryView: (v: number) => {
      factoryView = (v | 0) & 3;
      return factoryView;
    },
    rotateFactory: () => rotateFactoryView(),
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
    /**
     * #181: the test twin of the SELECT-tool click that opens a Depot's card.
     * A platform-Depot has no 2×2 lot to hit — it is clicked on its platform —
     * so "does THIS seat resolve this tile to its OWN Depot record" is the one
     * question the card's door asks, and the twin asks it through the same
     * `myDepotAt` + `depotCardFor` the click runs. Read-only: it opens the
     * card, it never changes the world. Returns whether a card opened.
     *
     * The click's own door additionally sits inside the `newLoop` branch, and
     * the new loop is solo-only — so in a hosted room the card is reached
     * through the `?loop=new` solo path today. The twin is the seat-frame half
     * (whose Depot is this?) without that upstream gate, which is what a test
     * can hold the guest to.
     */
    depotCardAt: (tx: number, ty: number) => {
      const d = myDepotAt(tx, ty);
      if (!d) return false;
      depotCardFor(d);
      return true;
    },
    /** The test twin of clicking with the Platform / Train Depot tool. */
    placePlatform: (tx: number, ty: number, view?: string, who: "you" | "ai" = "you") => {
      const p = who === "ai" ? rival : me;
      const v = view && (RAIL_VIEWS as readonly string[]).includes(view) ? view as RailView : railView;
      if (who === "you" && isGuest()) {
        return net?.sendIntent("build", { do: "platform", tx, ty, view: v }) ?? false;
      }
      // #181: the heading is an ARGUMENT now, not a temporary write to the
      // local tool state — the same shape the host's intent handler uses.
      return placeRailPlatform(tx, ty, p, v);
    },
    /**
     * FLEET-2 (#596): the test twin of clicking with the Passing Loop tool.
     * `tx, ty` is the first tile of the straight run the loop lies beside;
     * `view` picks the axis and the side (as for a platform). A guest sends
     * the same intent the click sends.
     */
    placeLoop: (tx: number, ty: number, view?: string, who: "you" | "ai" = "you") => {
      const p = who === "ai" ? rival : me;
      const v = view && (RAIL_VIEWS as readonly string[]).includes(view) ? view as RailView : railView;
      if (who === "you" && isGuest()) {
        return net?.sendIntent("build", { do: "loop", tx, ty, view: v }) ?? false;
      }
      return placeRailLoop(tx, ty, p, v);
    },
    /**
     * RAIL-6 (#575): the test twin of the station upgrade — the panel's
     * "Add lane" plus the side-picking click, in one call. A guest sends the
     * same intent the click sends.
     */
    addStationLane: (stationId: number, side: 1 | -1, who: "you" | "ai" = "you") => {
      const p = who === "ai" ? rival : me;
      if (who === "you" && isGuest()) {
        return net?.sendIntent("build", { do: "lane", stationId, side }) ?? false;
      }
      return addStationLaneAt(stationId, side, p);
    },
    /** The armed lane tool, for tests and the debug console. */
    get laneTool() { return laneToolStation; },
    setLaneTool: (id: number | null) => { laneToolStation = id; return laneToolStation; },
    placeRailDepot: (tx: number, ty: number, view?: string, who: "you" | "ai" = "you") => {
      const p = who === "ai" ? rival : me;
      const v = view && (RAIL_VIEWS as readonly string[]).includes(view) ? view as RailView : railView;
      if (who === "you" && isGuest()) {
        return net?.sendIntent("build", { do: "raildepot", tx, ty, view: v }) ?? false;
      }
      return placeRailDepot(tx, ty, p, v);
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
    /** FLEET-4 (#598): the test twin of the train row's Upgrade button. */
    upgradeTrain: (trainId: number, who: "you" | "ai" = "you") =>
      railUpgrade(trainId, who === "ai" ? rival : me),
    /** FLEET-4 (#598): run the rival's upgrade step once (test twin). */
    rivalTrainStep: () => rivalTrainStep(),
    rivalLoopStep: () => rivalLoopStep(),   // FLEET-2 (#596)
    /** FLEET-1 (#595): the test twins of the Fleet card's Buy / Sell truck. */
    buyTruck: (depotId: number, who: "you" | "ai" = "you") =>
      fleetBuyTruck(depotId, who === "ai" ? rival : me),
    /** FLEET-5 (#599): the test twin of the Fleet card's Upgrade trucks. */
    upgradeTrucks: (depotId: number, who: "you" | "ai" = "you") =>
      fleetUpgradeTrucks(depotId, who === "ai" ? rival : me),
    sellTruck: (depotId: number, who: "you" | "ai" = "you") =>
      fleetSellTruck(depotId, who === "ai" ? rival : me),
    railStart: (trainId: number, who: "you" | "ai" = "you") =>
      railStart(trainId, who === "ai" ? rival : me),
    railRename: (lineId: number, name: string, who: "you" | "ai" = "you") =>
      railRename(lineId, name, who === "ai" ? rival : me),
    /** Advance the trains by hand — the headless twin of the frame's tick. */
    railTick: (dtMs = 1000) => { tickTrains(rail, dtMs, grid, trainSpeedForOwner); return rail.trains.length; },
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
     *  centre — clicking it hits that tile (renderer.pickTile, N4). E3 (#269):
     *  lifted by the tile's surface height so the point is where the raised
     *  tile is actually drawn, and `pickTile` resolves it back to this tile. */
    tileScreenAt: (tx: number, ty: number) => {
      const [x, y] = tileToScreenAt(cam, tx, ty);
      const lift = elevationActive(grid)
        ? tileSurfaceHeight(grid, tx, ty) * LEVEL_PX
        : 0;
      return [x, y - lift] as [number, number];
    },
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
     * M1 (#254): the minimap for probes — whether the plate is laid out, its
     * per-layer redraw counts (the "terrain once, network on change, view on
     * camera change" evidence) and the marker hook #256 builds on, so its
     * look can be tried from the console before any sabotage feeds it.
     */
    get minimap() {
      return {
        visible: minimap.visible,
        stats: { ...minimap.stats },
        markers: minimap.markers,
        setMarkers: (list: readonly MinimapMarker[]) => minimap.setMarkers(list),
        goTo: (tx: number, ty: number) => minimap.goTo(tx, ty),
      };
    },
    get sabotageEventWindow() { return sabotageWindow; },
    /**
     * MUSIC-1 (#377) / RADIO-2 (#432): the radio, for probes and the play-test.
     * Reads the state machine, the saved choices and the current station; with
     * an argument it drives the same verbs the pill and the settings sheet use
     * (`__iso.radio({ play: true })`, `__iso.radio({ next: true })`).
     * A console call is not a user gesture, so the browser may refuse the very
     * first `play()` — tapping the pill is the honest way in; this is for
     * inspection and for turning it off without hunting for the widget.
     */
    radio: (action?: {
      play?: boolean; pause?: boolean; duck?: boolean;
      enabled?: boolean; show?: boolean; volume?: number;
      /** RADIO-2: a station id, or step the dial. Does not start playback. */
      station?: string; next?: boolean; prev?: boolean;
    }) => {
      if (action) {
        if (action.enabled !== undefined) radio.setEnabled(action.enabled);
        if (action.show !== undefined) radio.setShow(action.show);
        if (action.volume !== undefined) radio.setVolume(action.volume);
        if (action.duck !== undefined) radio.duck(action.duck);
        if (action.station) radio.setStation(action.station);
        if (action.next) radio.next();
        if (action.prev) radio.prev();
        if (action.play) radio.play();
        if (action.pause) radio.pause();
      }
      return {
        status: radio.machine.status,
        enabled: radio.settings.enabled,
        show: radio.settings.show,
        volume: radio.settings.volume,
        ducked: radio.machine.ducked,
        failures: radio.machine.failures,
        nowPlaying: radio.nowPlaying,
        text: radioText(radio.machine.status, radio.station, radio.nowPlaying),
        stationId: radio.stationId,
        station: radio.station,
        credit: radio.credit,
      };
    },
    /**
     * SFX-1 (#463): the ambience, for probes and the play-test. Reads the
     * last camera probe, the mix weights and the absolute bed gains (all zero
     * until the first real gesture arms the engine); with a `volume` it drives
     * the same slider the settings sheet owns (`__iso.ambience({ volume: 0 })`
     * silences the island without touching anything else).
     */
    ambience: (action?: { volume?: number; duck?: boolean }) => {
      if (action) {
        if (action.volume !== undefined) ambience.setVolume(action.volume);
        if (action.duck !== undefined) ambience.duck(action.duck);
      }
      return {
        probe: ambience.probe,
        volume: ambience.settings.volume,
        levels: ambience.levels(),
        gains: ambience.gains(),
      };
    },
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
      const price = priceDepot(buildPurse(me), me.freeDepots, { cargo, tier: me.depotTier, newLoop });
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
     * #456: the Level Ground twin of `dragBuild` — the same seam the pointer
     * tap/drag uses (commits on solo/host, sends an intent on a guest).
     * `target` is the height to level toward (default: the start tile's).
     */
    levelBuild: (ax: number, ay: number, bx: number, by: number, target?: number): LevelPlan | null =>
      requestLevelBuild(ax, ay, bx, by, target ?? heightAt(grid, ax, ay)),
    /** #456: the read-only twin — `levelCost`'s pure price/refusal answer. */
    levelCostOf: (ax: number, ay: number, bx: number, by: number) =>
      levelCost(grid, rectTiles(ax, ay, bx, by), { track }),
    /** D2: inspect the gesture and the actual overlay items (no second preview). */
    get activeRoadDrag() { return drag && tool !== "rail" && tool !== "level" ? { ...drag, preview } : null; },
    get activeDragOverlay() { return (preview || levelPlan) ? overlayFrame().items : []; },
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
        structureTiles(eco.factories, eco.harvesters, me.i + 1, factoryFp), newLoop,
        { railAt: (x, y) => hasRail(rail.rail, x, y), gradeSeparated: true, railDeckAt: (x, y) => !!(rail.rail.tile[tIdx(x, y)] & RAIL_OVERPASS) }, kind === "road" ? roadTier : "road", previewBalance(me, "road"));
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
    /**
     * R3 (#270): the standing dams, as a copy — the probe's read of who owns
     * which site and onto which bank each footprint leans.
     */
    get dams() { return eco.dams.map((d) => ({ ...d })); },
    /**
     * R3 (#270): the test twin of a Dam-tool click for the LOCAL seat — the
     * same `placeDam` the pointer handler runs (site rule, charge, build,
     * sync, rescore), with the side the test drew. Returns whether a dam was
     * built. A guest seat sends the build intent, exactly the click does.
     */
    placeDamAt: (tx: number, ty: number, side?: DamSide) => {
      if (isGuest()) { net?.sendIntent("build", { do: "dam", tx, ty, side: side ?? damSide }); return true; }
      return placeDam(tx, ty, me, side ?? damSide);
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
    /**
     * RIVAL-3 (#467): the rival's pending claim flags — the telegraph the
     * overlay draws — as data: site anchor, kind, when the flag went up, when
     * the build may land, and whether the site is Contested right now (the
     * live hover/tool/tender intents, or the injected `intents` argument).
     * This is the surface `tests/unit/iso-467-rival-telegraph.test.ts` pins
     * "every build was flagged for the lead time" against.
     */
    rivalClaims: (intents?: PlayerIntent[]) => {
      const live = intents ?? playerClaimIntents();
      return claimLedger.list().map((c) => ({
        kind: c.kind,
        siteKind: c.site.kind,
        siteId: c.site.id,
        tx: c.site.tx,
        ty: c.site.ty,
        name: c.site.name ?? null,
        cargo: c.site.cargo ?? null,
        townId: c.site.townId ?? null,
        committedAt: c.committedAt,
        readyAt: c.readyAt,
        contested: claimContested(c, live),
      }));
    },
    /** RIVAL-3: the placement-hover twin — where the player's tool is pointing. */
    hoverAt: (tx: number, ty: number) => {
      hover = { tx, ty, ref: null };
    },
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
        { id: me.id, name: me.name, portrait: seatFace(me), depots: depotCargos(me.i + 1) },
        { id: rival.id, name: rival.name, portrait: seatFace(rival), depots: depotCargos(2 - me.i) },
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
      // C2 (#257): this line is MINE, and the panel says so — the same door the
      // composer uses, so a console send shows up in the conversation exactly
      // as a typed one does.
      if (res.ok) pushChat(res.msg, "you");
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
    try { voice.detach(); } catch { /* garnish */ }
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
    sabotageWindow.destroy();
    minimap.destroy();
    // MUSIC-1 (#377): the pill goes with the HUD, and the duck listener with
    // the game (the radio itself is the PLAYER's — it keeps playing across a
    // quit to the menu, where the settings sheet can still stop it).
    offVoiceDuck();
    // A game that dies mid-line must not leave the mix ducked for the next one.
    radio.duck(false);
    radio.setNotice(null);
    radioWidget.destroy();
    // SFX-1 (#463): the island goes quiet with the map — unlike the radio it
    // has nothing to say on a menu, and a dead game must not hold its loops.
    try { ambience.duck(false); } catch { /* garnish */ }
    try { ambience.stop(); } catch { /* garnish */ }
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
    guide?.destroy();
    guide = null;
    document.removeEventListener("click", gateLessonTool, true);
    storyView?.destroy();
    storyView = null;
    floats.clear();
    // TOWN-2 (#470): the tier-up moment's click listener goes with the game —
    // a disposed game must not keep arming (or repainting) a build sequence.
    growthMoment.dispose();
    labels.clear();
    upgradeMarkers.clear();
    flashLayer.clear();
    cancelAnimationFrame(raf);
    ro.disconnect();
    terrainGl?.dispose();
    if (threeLayer) { setHideExtra(null); setHideVehicle(null); threeLayer.dispose(); }
    root.classList.remove("iso-game");
    root.innerHTML = "";
    // TOWN-4.1 (#677): the map's buffers die with the game — unlock the size
    // and hand it back (to standard), unless a newer boot has claimed it since.
    releaseMapSize(mapSizeClaim);
  };
}
