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
import grassTex from "../../assets/ground/grass.png";
import sandTex from "../../assets/ground/sand.png";
import waterTex from "../../assets/ground/water.png";
// TEMP protest crowd — a placeholder png drawn straight on the overlay
// canvas, not an atlas sprite (see `paintProtests` + tools/make-protest-png.mjs).
import protestArt from "../../assets/protest.png";
// Vector roads: the two seamless material swatches
// (tools/make-road-textures.mjs). Loaded independently of every other art
// group, so a slow or failed decode leaves the roads drawn in their flat
// fallback colours rather than leaving them out.
import asphaltTex from "../../assets/roads/asphalt.webp";
import dirtTex from "../../assets/roads/dirt.webp";

import { Atlas, buildMasks, loadBuildingLayers, type Manifest, type AtlasImage } from "./atlas";
import { loadGroundTextures } from "./ground";
import {
  createCamera, centerOnTile, resizeCamera, zoomStepAt, tileToScreenAt,
  createGesture, pointerDown, pointerMove, pointerUp, worldToScreen,
  type Camera, type GestureState,
} from "./camera";
import { IsoRenderer, type World } from "./renderer";
import { DEFAULT_ROAD_STYLE } from "./road-renderer";
import { scatterScenery, type Scenery } from "./scenery";
import { loadDecalImages, loadScenerySprites } from "./scenery-art";
import { generateMap, resolveMapSeed, type Grid, type Industry } from "./grid";
import {
  createTrack, drawBits, previewDrag, commitDrag, canBuildOn, hasTrack,
  demolishTile, tIdx, playerNetwork, canAfford, buildRefusal, seedTownRoads,
  seedPublicRoads, isPublicRoad, isUpgradedRoad, tileCost, structureTiles,
  dirtyTiles, plantFootprintTiles,
  type Track, type TrackKind, type Purse, type DragPreview,
} from "./track";
import {
  industriesInCatchment, ownerIdOf,
  buildAllComponents, resolveConnection, industryLocks, heldIndustries, lockedIndustryIds,
  pickBlockadeTarget,
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
} from "./ai";
import {
  RIVAL_SKILLS, resolveSkillKey, SKILL_STORAGE_KEY, type RivalSkill, type SkillKey,
} from "./skill";
import { planDepotPlacement, planFactoryPlacement, type PlacementPlan } from "./placement";
import {
  PLANT_COST, PLANT_REFUSAL_TEXT, addPlant, adjacentTown, buildingAt, canAffordPlant,
  chooseAiPlantSpot, footprintTiles, plantRefusal, plantsOf, resolvePlantTarget,
} from "./plants";
import {
  CARGO, CARGOES, FACTORY_FOOTPRINT, FACTORY_SPRITE, INDUSTRY_BY_KEY, TRANSPORT,
  VICTORY, VP_TARGET, UPGRADE_COST,
  depotSpriteForCargo, townHouseSprite, type Cargo, type Portrait,
} from "./config";
import {
  DEPOT_COST, FREE_SETUP_DEPOTS, costCompact, costLabel, priceDepot, shortfallLabel,
} from "./construction";
import { bankTrade } from "../game/trade";
import {
  MAP_W, MAP_H, BANDIT_MS, BLOCK_MS, FOG_MS, PROTEST_MS, SABOTAGE, SECURITY,
  choice, tileToScreen, type ResKey,
} from "../game/config";
import { createQuarry, GEM_TO_CARGO, type Quarry } from "./quarry";
import {
  SAVE_KEY, SAVEGAME_VERSION, loadRecentSave, clearSave, trackSave, trackRestored,
  type SaveGamePayload,
} from "./savegame-runtime";
import { RES } from "../game/config";
import { createRivalPlant, RIVAL_FROST_MS, RIVAL_GIRDER_MS, RIVAL_SMOG_MS } from "./rival-plant";
import { createFloatLayer, type FloatLayer } from "./floats";
import {
  createTruckState, planTrucks, tickTrucks, truckItems, roadRouteForHarvester,
  type Truck,
} from "./vehicles";
import {
  CAR_COUNT, createCarState, planCars, tickCars, carItems,
} from "./cars";
import { createIsoMarket, toBag, chooseRivalOffer, type CargoBag, type IsoMarket } from "./market";
import { createOriginalUi, type OriginalUi } from "../game/ui";
// SFX-01: the UI sound layer. Everything the player DOES on the map (a road
// laid, a building raised, a demolition, a star earned, the final ledger) gets
// one cue from here; the chrome's own clicks and hovers are handled once, by
// the delegation `attachUiSound` installs. docs/SFX-01-ui-sound.md.
import { sfx } from "../audio/sfx";
// AI-02: the start-of-game difficulty prompt (see skill-picker.ts for the
// "when do we ask" contract: only when nothing has chosen yet).
import { promptForRivalSkill } from "./skill-picker";
import {
  buildEnding, showEndingScreen, type DecisiveSource, type EndingScreenHandle,
} from "./ending";
import {
  OIL_DRILLING_SCENE, createRivalDirector,
  type RivalryDirection, type RivalryScene, type RivalryTactic,
} from "./rivalry";
import {
  createIsoDebug, shouldInstallDebugConsole, shouldAutoEnableDebugOverlays,
  shouldAutoEnableRenderLog,
} from "./debug";
import {
  SNAPSHOT_VERSION, applySnapshot, buildSnapshot, joinFromSnapshot,
  type RivalSabotage, type Snapshot,
} from "./snapshot";
export { joinFromSnapshot };
// MP-05: the wire. `session.ts` owns roles/roster/chunked state transfer and
// never imports the SDK (transport.ts does); `protocol.ts` owns the message
// union; `delta.ts` owns the per-action patch format. game.ts is the only
// place that knows all three AND the game rules.
import { NetSession, type NetRole } from "../net/session";
import { applyTrackDelta } from "../net/delta";
import { type DeltaMsg, type IntentMsg } from "../net/protocol";

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
export type Tool = "dirt" | "road" | "harvester" | "plant" | "demolish";

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

  // PP-14b: the Processing Plant reset's cooldown. `lastResetAt` starts at
  // -Infinity so the very first reset of a boot is always allowed.
  const RESET_COOLDOWN_MS = 30_000;
  let lastResetAt = -Infinity;

  // A networked match NEVER touches the local save: the room owns the match,
  // and a save written mid-game would resurrect as a solo world on the next
  // boot (and, on the guest, restore a map the host never generated).
  const savesOff = isMp() || !!(window as unknown as Record<string, unknown>).__ISO_DISABLE_SAVE;
  const bootSave = savesOff ? null : loadRecentSave();
  const seed = opts.seed ?? bootSave?.seed ?? resolveMapSeed();
  const grid: Grid = generateMap(seed);
  // SCENERY: decals + clumped trees, a pure function of the seed (so a guest
  // regenerates exactly the host's woodland from the seed alone — scenery is
  // never on the wire). Computed before the towns stamp their roads because
  // it reads `grid.occupancy`/`grid.publicRoads`, both of which `generateMap`
  // has already filled; nothing in `track` affects it.
  const scenery: Scenery = scatterScenery(grid);
  const track: Track = createTrack();
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
    { i: 0, id: "you", name: "You", colour: "#5aa8ff", purse: toBag(START_PURSE), human: true, freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS },
    { i: 1, id: "ai", name: "Rival", colour: "#ff7a5a", purse: toBag(START_PURSE), human: false, freeTrack: FREE_SETUP_TRACK, freeDepots: FREE_SETUP_DEPOTS },
  ];
  const me = players[0], rival = players[1];

  // ── AI-01: how hard the rival plays ────────────────────────────────────────
  // One variable, read lively everywhere the rival's pacing shows up: the
  // build/idle clocks, expansion-per-turn, the pave batch, the bank budget,
  // the market cadence and the sabotage switches. Because the turn itself is
  // shared code, flipping the difficulty mid-match (the top-bar selector runs
  // `setRivalSkill`) just changes the numbers the NEXT tick reads — no replay,
  // no reload, and nothing in the ledger to migrate.
  let skillKey: SkillKey = resolveSkillKey();
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
   * see `onSkill` below) and both seats must see the same line, so it stays on
   * the constant.
   */
  const winTarget = (): number => (isSolo() ? skill().winTarget : VICTORY.target);

  const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
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
  let winner: PlayerState | null = null;
  let winningSource: DecisiveSource = null;
  let endingView: EndingScreenHandle | null = null;
  let endingShown = false;
  /** Restart flips this before clearing the save — the pagehide fired by the
   *  ensuing reload must not resurrect the completed match. */
  let restartArmed = false;

  // Rivalry flavour has its own deterministic scene deck and counters. It
  // never consumes simulation RNG, so extra jokes cannot alter an AI decision.
  const nextRivalScene = createRivalDirector(seed);
  let playerSabotage = 0;
  let rivalSabotageHits = 0;
  let oilBanterSeen = false;
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
    onGains: (gains, label) => toast(gainText(gains, label), "good"),
    // A1: the floating readout over the board. `ui` does not exist yet at
    // this point (the HUD is built below), but this closure is only ever
    // called by a match, long after boot.
    onPopup: (gains, label) => ui.popup(gains, label),
    onTokens: (pool) => toast(`Tokens: ${(Object.keys(pool) as ResKey[])
      .map((r) => CARGO[GEM_TO_CARGO[r]].name).join(", ")}`, "info"),
    onChange: () => onBoardChange(),
  });

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
    i: p.i, id: p.id, name: p.name, human: p.human, purse: p.purse,
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

  // MP-05: the market is CLIENT state (`offers` live in this browser), so a
  // guest's trade would escrow against a purse the host overwrites and match
  // against an offer list nobody else can see. Refuse the mutators — the tab
  // still renders, and the toast says why. A synced market is its own ticket.
  if (isGuest()) {
    const refused = (): boolean => {
      toast("Trading is not relayed yet in multiplayer.", "info");
      return false;
    };
    market.post = refused;
    market.cancel = refused;
    market.accept = refused;
    market.bank = refused;
  }

  // Original HUD (U1). It takes the live board + market + the player purse and
  // wires the BUILD / BLACK MARKET / QUARRY / chips chrome to them.
  ui = createOriginalUi(quarry.board, market, meTrader, {
    onTool: (t) => { tool = t as Tool; },
    onRecenter: () => {
      const f = factoryOf("you") ?? focus;
      cam = centerOnTile(cam, f.tx, f.ty);
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
      void quarry.board.trySwap(r1, c1, r2, c2, performance.now());
    },
    onReset: () => {
      if (isGuest()) return;
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
    },
    onBlackAction: (key) => buyBlack(key),
    // AI-01: the top-bar difficulty selector. Applies on the NEXT rival tick —
    // the clocks and budgets re-read `skill()` every call, so there is nothing
    // to restart.
    // MP-05: the difficulty selector is an AI feature — there is no AI rival
    // in a hosted game, so the selector is simply not built.
    onSkill: isSolo() ? (key) => setRivalSkill(key) : undefined,
    skill: isSolo() ? skillKey : undefined,
  });
  onBoardChange = () => ui.renderBoard();
  root.appendChild(ui.el);

  // AI-02: ask for the difficulty before the first click (only when no
  // previous choice exists — see skill-picker.ts). The overlay sits over the
  // freshly booted UI; the pick flips the LIVE game straight into
  // `setRivalSkill`, persists for the next boot, and syncs the top-bar
  // selector the `onSkill` hook would otherwise own.
  // AI-03: a saved game means NO difficulty prompt and NO fresh map — the
  // save carries the pick, and refresh resumes exactly where it left off
  // ("a refresh restarts the game" — not any more; Restart starts over).
  // (`bootSave` was read up top, before the map generated, so the seed the
  // save carries is the seed the map was grown from.)
  if (!bootSave && isSolo()) {
    void promptForRivalSkill(ui.el, {
      onPick: (key) => {
        setRivalSkill(key);
        try { localStorage.setItem(SKILL_STORAGE_KEY, key); } catch { /* private mode */ }
        const sel = ui.el.querySelector<HTMLSelectElement>("#iso-rival-skill");
        if (sel) sel.value = key;
      },
    });
  }

  // ── A1: the board's own effects finally have somewhere to go ────────────
  // `Board` fires `onFx` for every pop, crack, token-up, bomb, bad swap and
  // callout, and NOTHING had ever assigned it — so all of it, including
  // MATCH! / COMBO x2 / CHAIN x3!! / MATCH 5, died on the board. This one
  // line is the wire the handover was asking for.
  quarry.board.onFx = (type, r, c, text) => ui.fx(type, r, c, text);

  // PP-14: a HOLY CROSS pauses the cascade and asks the player which cargo
  // the blessing should be — the board waits on this hook until the UI's
  // chooser answers it (or the backstops auto-pick). PP-14b: the board passes
  // the shape and how many units it owes so the chooser can title and cap
  // itself (6 for a holy cross, 3 for a broken one).
  quarry.board.onCrossChoice = (kind, picks, pick) => ui.crossPick(kind, picks, pick);

  // A1: world-anchored floats — the lorry's "+N" at the Factory, and the
  // marker over the rival's plant when sabotage lands. Anchored to the live
  // camera, so they pan and zoom with the tile they belong to.
  const floats: FloatLayer = createFloatLayer(ui.mapHost, (tx, ty) => {
    const [x, y] = tileToScreenAt(cam, tx, ty);
    const d = dpr();
    return [x / d, y / d];
  });

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

  const world: World = {
    grid,
    roadBits: drawBits(track, "road"),
    dirtBits: drawBits(track, "dirt"),
    extra: [],
    trees: scenery.trees,
    forests: scenery.forests,
    sceneryBlocked: new Set<number>(),
  };

  // Start the camera somewhere with industries in view.
  const focus = grid.industries[0] ?? { tx: MAP_W / 2, ty: MAP_H / 2 };
  let cam: Camera = centerOnTile(
    createCamera(stage.clientWidth || 800, stage.clientHeight || 600),
    focus.tx, focus.ty,
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

  /** Queue one alternating portrait scene and preserve the whole exchange in
   *  Feed. Torvin never gets an unanswered line. */
  const playRivalryScene = (scene: RivalryScene) => {
    ui.rivalQuip(scene);
    for (const beat of scene) {
      ui.feed(`“${beat.text}”`, beat.speaker === "rival" ? rival.name : me.name);
    }
  };

  const rivalSpeaks = (direction: RivalryDirection, tactic: RivalryTactic) => {
    if (direction === "retort") playerSabotage++;
    else if (direction === "attack") rivalSabotageHits++;
    playRivalryScene(nextRivalScene(direction, tactic));
  };

  onFirstOilHarvest = () => {
    if (oilBanterSeen || phase !== "play") return;
    oilBanterSeen = true;
    playRivalryScene(OIL_DRILLING_SCENE);
  };

  /** Show the final ledger once. The same model builds victory and defeat, but
   *  only a human win receives the fireworks layer. */
  const presentEnding = (source: DecisiveSource = winningSource) => {
    if (endingShown || !winner) return;
    endingShown = true;
    winningSource = source;
    const playerBreakdown = victoryBreakdown(eco, me.id);
    const rivalBreakdown = victoryBreakdown(eco, rival.id);
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
    endingView = showEndingScreen(ui.el, model, {
      playerPortrait: opts.portrait ?? "vex",
      onRestart: () => {
        restartArmed = true;
        clearSave();
        // Keep the selected difficulty: this is a rematch, not first-run
        // onboarding. The top-bar Restart button remains the full reset.
        location.reload();
      },
    });
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
    // SCENERY: hide the trees the player has since built over. Roads are not
    // listed — the draw list reads roadBits/dirtBits directly — so this is
    // only the free-standing structures: plant footprints and depots.
    const blocked = new Set<number>();
    for (const f of eco.factories)
      for (const [x, y] of plantFootprintTiles(f.tx, f.ty))
        if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) blocked.add(y * MAP_W + x);
    for (const h of eco.harvesters) blocked.add(h.ty * MAP_W + h.tx);
    world.sceneryBlocked = blocked;
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
    // TOWN-1: emit town house and center draw items
    const townItems = grid.towns.flatMap((t) => {
      const items: { sprite: string; tx: number; ty: number; ref: unknown }[] = [];
      // Town center marker at the center tile
      items.push({
        sprite: "town_center",
        tx: t.tx, ty: t.ty,
        ref: { kind: "town", id: t.id },
      });
      // Houses at all non-center tiles. PP-12: one of 43 verbatim TTD house
      // cells, chosen by `townHouseSprite` so every settlement mixes homes,
      // shops, flats and the occasional tall block instead of stamping one
      // sprite. The centre is the TTD church (`town_center` cell).
      for (const [hx, hy] of t.houses) {
        if (hx === t.tx && hy === t.ty) continue; // skip center, already drawn
        items.push({
          sprite: townHouseSprite(hx, hy),
          tx: hx, ty: hy,
          ref: { kind: "town", id: t.id },
        });
      }
      return items;
    });
    world.extra = [
      ...townItems,
      ...factoryItems,
      // PP-12: resource-specific Depot art — the outpost reads as what it
      // harvests (a lumber mill at a forest, a rig at an oil field, …). The
      // first served industry names the cargo; placement always requires one,
      // so the fallback below only serves foreign snapshots. Ownership still
      // shows in the inspector, the catchment overlays and the ref payload.
      ...eco.harvesters.map((h) => {
        const served = industriesInCatchment(grid, h);
        const cargo = served.length ? INDUSTRY_BY_KEY[served[0].type].cargo : "grain";
        return {
          sprite: depotSpriteForCargo(cargo),
          tx: h.tx, ty: h.ty, ref: { kind: "harvester", id: h.id, owner: h.owner },
        };
      }),
    ];
    renderer?.setWorld(world);
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
        const b = victoryBreakdown(eco, p.id);
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
    applyVpEvents(rescore(eco, score), now);
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
    if (!isGuest()) quarry.refresh(now);
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
      return false;
    }
    if (eco.factories.some((f) => f.ownerId === p.i + 1)) {
      toast(`${p.human ? "You already have" : "That seat already has"} a starting Factory.`, "bad");
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
    if (!isSolo()) {
      // MP-05: no AI rival to seat — the guest places its own opening Factory
      // through an intent, on its own click.
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
  function placeHarvester(tx: number, ty: number, p: PlayerState): boolean {
    if (!canBuildOn(grid, "dirt", tx, ty)) { toast("Can't build there.", "bad"); return false; }
    if (eco.harvesters.some((h) => h.tx === tx && h.ty === ty)) {
      toast("A depot is already there.", "bad"); return false;
    }
    const h: Harvester = { id: allocHarvesterId(), owner: p.id, ownerId: p.i + 1, tx, ty };
    const served = industriesInCatchment(grid, h);
    if (!served.length) {
      toast("A depot needs an industry in its 4×4 catchment.", "bad");
      return false;
    }
    // PP-16: one Depot holds one industry, and the first road at the resource
    // takes it. A Depot standing on open ground with no track beside it claims
    // nothing (see `industryLocks`), so it can never shut anyone out — but once
    // a rival's Depot has a road, every industry in its catchment is spoken
    // for, and a second Depot there would harvest nothing. Refused before
    // anything is priced or spent, like every other refusal in here.
    const locks = industryLocks(eco);
    if (served.every((ind) => locks.has(ind.id))) {
      toast("That industry is already claimed — only one Depot may hold it.", "bad");
      return false;
    }
    // PP-05: priced only now that the site is legal, and spent only when the
    // whole cost is covered. Oil earned in the Processing Plant is in this same
    // purse, so processed Oil builds Depots with no special case.
    const price = priceDepot(p.purse, p.freeDepots);
    if (!price.affordable) {
      toast(`A Depot costs ${costLabel(DEPOT_COST)} — you need ${shortfallLabel(price.missing)}.`, "bad");
      return false;
    }
    if (!spend(p, price.cost)) return false;      // guard; `price.affordable` holds
    p.freeDepots = price.freeLeft;
    // G5: harvesters seed the network; they no longer need existing track.
    eco.harvesters.push(h);
    if (p.human) sfx.play("build");      // SFX-01
    syncWorld();
    rescoreNow();
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
      if (p.human) toast(PLANT_REFUSAL_TEXT[why], "bad");
      return false;
    }
    if (!canAffordPlant(p.purse)) {
      if (p.human) {
        toast(`Not enough materials — a processing plant costs ${plantCostLabel()}.`, "bad");
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
    const hi = eco.harvesters.findIndex((h) => h.tx === tx && h.ty === ty && h.owner === p.id);
    if (hi >= 0) {
      eco.harvesters.splice(hi, 1);
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
        return;
      }
      eco.factories.splice(pi, 1);
      if (p.human) sfx.play("demolish");   // SFX-01
      syncWorld(); rescoreNow();
      toast("Processing plant demolished.", "info");
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
      toast(
        isPublicRoad(track, tx, ty)
          ? "That's a public road — it isn't yours to demolish."
          : "Nothing to demolish there.",
        "bad",
      );
      return;
    }
    // PP-13: tearing up a DIRT ROAD salvages one of the two materials it cost
    // (`BUILD_COSTS.dirt` is 1 Wood + 1 Stone). WHICH one comes back is the
    // random part, so demolition is a partial refund rather than free
    // re-routing. The paved Road pays nothing back: its price is dominated by
    // 4 Ore, and the dirt→road pave is what upgrades are for.
    // SFX-01: timber coming apart — a little further away for a single tile
    // of track than for a whole building.
    if (p.human) sfx.play("demolish", removedKind === "dirt" ? undefined : { gain: 0.8 });
    if (removedKind === "dirt") {
      const back = choice(DIRT_DEMOLISH_REFUND);
      earn(p, { [back]: 1 });
      toast(`Dirt Road cleared — salvaged 1 ${CARGO[back].icon} ${CARGO[back].name}.`, "good");
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

  function buyBlack(key: string) {
    if (phase === "won") {
      toast("The final ledger is closed. Start a rematch to settle another score.", "info");
      return;
    }
    // MP-05: sabotage/recon are local-only in a hosted game. Seat 1's Black
    // Market needs an intent + a synced result channel, which §4 does not have
    // yet — refused WITH a reason rather than silently desyncing the purse.
    if (isGuest()) {
      toast("Black Market actions are not relayed yet in multiplayer.", "info");
      return;
    }
    const now = performance.now();
    const spendGold = (n: number) => {
      if ((me.purse.gold ?? 0) < n) { toast(`Needs ${n} Gold.`, "bad"); return false; }
      spend(me, { gold: n });
      return true;
    };
    if (key === "bandit") {
      if (!spendGold(SABOTAGE.bandit.gold)) return;
      // TK-008: there is exactly ONE rival, so a Blockade needs no targeting
      // step — auto-route it to the industry that currently costs the rival
      // the most yield.
      const target = pickBlockadeTarget(eco, rival.id, now);
      if (!target) {
        earn(me, { gold: SABOTAGE.bandit.gold });   // refund; nothing to hit
        toast("No industry to blockade — gold refunded.", "bad");
        return;
      }
      target.banditUntil = now + BANDIT_MS;
      const def = INDUSTRY_BY_KEY[target.type];
      toast(`Blockade set on ${def?.name ?? target.type} — the rival can't harvest it for ${BANDIT_MS / 1000}s.`, "good");
      rivalSpeaks("retort", "bandit");
      return;
    }
    if (key === "protest") {
      // A protest is bought and then PLACED: this arms it, and the next map
      // click stages it on a public road. The Gold is charged on placement,
      // not here, so cancelling (or never finding a road) costs nothing.
      if (pendingProtest) {
        pendingProtest = false;
        toast("Protest cancelled.", "info");
        return;
      }
      if ((me.purse.gold ?? 0) < SABOTAGE.protest.gold) {
        toast(`Needs ${SABOTAGE.protest.gold} Gold.`, "bad");
        return;
      }
      pendingProtest = true;
      toast(`Protest ready — click any public road to block ALL trucks for ${fmtProtestLeft(PROTEST_MS)}.`, "info");
      return;
    }
    // ── A1: sabotage hits the RIVAL's plant, not the buyer's ──────────────
    // These three used to call straight into `quarry.board` — buying Gold-
    // priced sabotage and dumping it on your own Processing Plant. Blockade
    // was always right (it auto-picks the rival's busiest industry); the
    // board actions now join it on the rival's side, on the plant
    // `createRivalPlant` owns. Repair Crew below stays on YOUR board: that is
    // what a repair crew does.
    const rivalHit = (text: string) => {
      const f = factoryOf(rival.id);
      if (f) floats.add(text, f.tx, f.ty, { cls: "sabotage", now });
    };
    /** How far the rival's income just fell, as a whole percentage. */
    const dentPct = () => Math.round((1 - rivalPlant.health(now)) * 100);

    if (key === "harden") {
      if (!spendGold(SABOTAGE.harden.gold)) return;
      const n = rivalPlant.frost(now);
      sfx.play("boom", { gain: 0.65 });   // SFX-01: something landed across the map
      rivalHit(`❄ ${n} FROZEN`);
      toast(`Frost Tiles: ${n} gems frozen in the rival's plant — its yield is down ${dentPct()}% for ${RIVAL_FROST_MS / 1000}s.`, "good");
      rivalSpeaks("retort", "harden");
      // PP-14b: push immediately so the other browser sees the frost now,
      // not on the next 200ms heartbeat.
      publishNet(now, true);
      return;
    }
    if (key === "block") {
      if (!spendGold(SABOTAGE.block.gold)) return;
      const n = rivalPlant.girders(now);
      sfx.play("boom", { gain: 0.65 });   // SFX-01
      rivalHit(`🏗 ${n} GIRDERS`);
      toast(`Iron Girders: ${n} dropped into the rival's plant — its yield is down ${dentPct()}% for ${RIVAL_GIRDER_MS / 1000}s.`, "good");
      rivalSpeaks("retort", "block");
      publishNet(now, true);
      return;
    }
    if (key === "fog") {
      if (!spendGold(SABOTAGE.fog.gold)) return;
      rivalPlant.smog(now);
      sfx.play("boom", { gain: 0.55 });   // SFX-01: smog is the quietest of the three
      rivalHit("🌫 SMOG");
      toast(`Smog Cloud over the rival's plant — its yield is down ${dentPct()}% for ${RIVAL_SMOG_MS / 1000}s.`, "good");
      rivalSpeaks("retort", "fog");
      publishNet(now, true);
      return;
    }
    if (key === "security") {
      // PP-08: this is a defensive action, so it is bought with MATERIALS —
      // never with Gold. Insufficient materials refuse the hire and consume
      // nothing (the affordability check runs before any deduction).
      const affordable = (Object.entries(SECURITY_ISO_COST) as [Cargo, number][])
        .every(([k, v]) => (me.purse[k] ?? 0) >= v);
      if (!affordable) { toast("Not enough materials for Security Forces.", "bad"); return; }
      spend(me, SECURITY_ISO_COST);
      // A1: Security Forces now do the one job their description promises.
      // Sabotage lands on the RIVAL, which left this purchase guarding
      // nothing — until the rival started buying back (see `rivalRaid`),
      // which is the only reason a defence is worth paying for.
      securityUntil = now + SECURITY.ms;
      sfx.play("build");                  // SFX-01: a crew sets up on site
      toast(`Security Forces hired — guarded for ${SECURITY.ms / 1000}s.`, "info");
      return;
    }
    if (key === "repair") {
      const affordable = (Object.entries(REPAIR_ISO_COST) as [Cargo, number][])
        .every(([k, v]) => (me.purse[k] ?? 0) >= v);
      if (!affordable) { toast("Not enough materials for Repair Crew.", "bad"); return; }
      spend(me, REPAIR_ISO_COST);
      const n = quarry.board.smashBlocks();
      if (n) sfx.play("crack");           // SFX-01: ice and girders giving way
      toast(n ? `Repair Crew cleared ${n} obstacles.` : "Nothing to repair.", n ? "good" : "info");
      return;
    }
    toast("Not available in this build.", "info");
  }

  // ── economy + AI clocks ────────────────────────────────────────────────
  let lastHarvest = 0, lastAi = 0;
  /** A1: Security Forces are on duty until this wall time. */
  let securityUntil = 0;
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
    if (isSolo()) rivalMarketOffer(now);
    quarry.tick(now);
    // AI-03: the rival's own plant plays: same board clock as yours, then
    // one watchable move per skill().moveMs. trySwap refuses politely when
    // the board is busy or smogged, so the clock can keep cadence calmly.
    rivalQuarry.tick(now);
    rivalAutoplay(now);
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
    if (!isSolo()) return;
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
      oreUrgency: urgency,
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

    // 3. pave — what the scoreboard pays for, with whatever Ore is spare; and
    //    when the Ore is not spare but the gravel is there, buy it (VP-01)
    if (rivalPavePass()) acted = true;
    else rivalBankTowardPave(f, now);

    if (acted) {
      syncWorld();
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

  /** HOST: the full state (§4 `SnapshotMsg`), built from the live world. */
  function netFullState(): Snapshot | null {
    return buildSnapshot({
      seed, track,
      harvesters: eco.harvesters,
      factories: eco.factories,
      setupPhase: inSetup(),
      won: phase === "won",
      players: wirePlayers(),
      t: performance.now(),
      rivalSabotage: rivalSabotageNow(),
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
    net.publishTrack(track, dirtyTiles, {
      t: now,
      harvesters: eco.harvesters.map((h) => ({ ...h })),
      factories: eco.factories.map((f) => ({ ...f })),
      players: wirePlayers(),
      setupPhase: inSetup(),
      won: phase === "won",
      rivalSabotage: rivalSabotageNow(),
    });
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
    eco.harvesters.push(...applied.harvesters.map((h) => ({ ...h })));
    eco.factories.length = 0;
    eco.factories.push(...applied.factories.map((f) => ({ ...f })));
    for (let i = 0; i < players.length; i++) {
      const wire = applied.players[i];
      if (!wire) continue;
      players[i].purse = toBag(wire.res);
    }
    if (applied.rivalSabotage) applyRivalSabotage(applied.rivalSabotage);
    winner = null;
    refreshGuestPhase();
    syncWorld();
    rescoreNow();
  }

  /** GUEST: apply one steady-state delta — the hot path (§5). */
  function applyNetDelta(msg: DeltaMsg) {
    let world = false;
    if (msg.tiles) { applyTrackDelta(track, msg.tiles); world = true; }
    if (msg.harvesters) {
      eco.harvesters.length = 0;
      eco.harvesters.push(...msg.harvesters.map((h) => ({ ...h })));
      world = true;
    }
    if (msg.factories) {
      eco.factories.length = 0;
      eco.factories.push(...msg.factories.map((f) => ({ ...f })));
      world = true;
    }
    if (msg.players) {
      for (let i = 0; i < players.length; i++) {
        const wire = msg.players[i];
        if (!wire) continue;
        players[i].purse = toBag(wire.res);
        // MP-05: the opening allowances ride the delta because the snapshot's
        // player list (§4) has no room for them, and the previews price from
        // them — a guest that thought it still had 12 free tiles would preview
        // a drag the host then charges for.
        if (typeof wire.freeTrack === "number") players[i].freeTrack = wire.freeTrack;
        if (typeof wire.freeDepots === "number") players[i].freeDepots = wire.freeDepots;
      }
    }
    // PP-14b: the host's sabotage on this seat's plant, applied as an overlay.
    if (msg.rivalSabotage) applyRivalSabotage(msg.rivalSabotage);
    // A refused intent says why, in the host's own words (the echo).
    if (msg.notice) toast(msg.notice, "info");
    refreshGuestPhase();
    if (world) syncWorld();
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
          const owner = playerNetwork(track, p.i + 1, eco.factories, eco.harvesters);
          const pv = previewDrag(grid, track, kind, p.purse, ax, ay, bx, by,
            payload.xFirst !== false, owner, p.freeTrack,
            structureTiles(eco.factories, eco.harvesters, p.i + 1));
          if (pv.tiles.length === 0) toast("That track would not connect to your network.", "bad");
          else commitTrackDrag(p, pv, kind);
        }
      } else if (what === "swap") {
        const r1 = int(payload.r1), c1 = int(payload.c1);
        const r2 = int(payload.r2), c2 = int(payload.c2);
        if (r1 !== null && c1 !== null && r2 !== null && c2 !== null) {
          void rivalQuarry.board.trySwap(r1, c1, r2, c2, performance.now());
        }
      } else {
        const tx = int(payload.tx), ty = int(payload.ty);
        if (tx !== null && ty !== null) {
          if (what === "factory") placeFactoryFor(p, tx, ty);
          else if (what === "depot") placeHarvester(tx, ty, p);
          else if (what === "plant") placePlant(tx, ty, p);
          else if (what === "demolish") doDemolish(tx, ty, p);
          // `swap` / `trade` / `skill` are not relayed yet — see the block comment.
          else toast("That action is not available in multiplayer yet.", "info");
        }
      }
    } finally {
      intentEcho = null;
    }
    if (echoed.length) net?.setNotice(echoed[echoed.length - 1]);
    publishNet(performance.now(), true);
  }

  if (net) {
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
      fullState: () => netFullState(),
      intent: (msg) => applyGuestIntent(msg),
      snapshot: (snap, seq) => applyNetSnapshot(snap, seq),
      delta: (msg) => applyNetDelta(msg),
      reject: (reason) => {
        toast(reason, "bad");
        ui.showModal(`<p>${reason}</p>`);
      },
      status: (state) => {
        // A reconnect is exactly when a guest must re-pull state; the session
        // already asks, this just tells the player not to panic.
        if (state === "reconnecting") toast("Reconnecting…", "info");
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
  const depotLocks = () => ({ locked: lockedIndustryIds(eco) });

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
  const routeOverlayFor = (h: Harvester): OverlayItem[] => {
    const key = `${h.id}:${h.ownerId}:${netVersion}`;
    if (hoverRouteCache && hoverRouteCache.key === key) return hoverRouteCache.items;
    const comp = buildAllComponents(track, h.ownerId);
    const route = roadRouteForHarvester(eco, h, comp);
    const items = route
      ? route.map(([x, y]) => ({ sprite: "highlight_soft", tx: x, ty: y }))
      : [];
    hoverRouteCache = { key, items };
    return items;
  };
  /** The placement overlay for a hover at (tx,ty), whatever the input device —
   *  mouse and touch both arrive here through `hover`, so the preview is
   *  identical at every zoom for both. */
  const overlayItemsAt = (tx: number, ty: number): OverlayItem[] => {
    const items: OverlayItem[] = [];
    if (phase === "setup-factory") {
      // PP-02: the preview enforces the same town-adjacency rule as the click.
      pushPlan(items, planFactoryPlacement(grid, tx, ty, { requireTown: true, track }));
    } else if (tool === "harvester" || phase === "setup-harvester") {
      pushPlan(items, planDepotPlacement(grid, eco.harvesters, tx, ty, depotLocks()));
    } else if (tool === "plant") {
      // AI-03c: the mid-game plant preview paints from the same folded plan
      // the test twin and the click share — no more green footprints over a
      // building the overlay never saw.
      pushPlan(items, factoryPlanForTool(tx, ty));
    } else {
      items.push({ sprite: "highlight", tx, ty });
    }
    // RV-03: hovering an existing depot shows the road the truck takes. The
    // depot is found by tile, so the hover route and the truck agree even when
    // the current tool is not a placement tool (setup phases hover empty tiles
    // and find no depot, so they never double up).
    const dep = eco.harvesters.find((h) => h.tx === tx && h.ty === ty);
    if (dep) items.push(...routeOverlayFor(dep));
    return items;
  };
  const overlayItems = () => {
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
      return items;
    }
    if (pendingProtest && hover) {
      // The armed protest paints its own legality: green on a free public
      // road, red anywhere else — the same rule `placeProtest` enforces.
      const ok = protestPlaceable(hover.tx, hover.ty);
      const items: OverlayItem[] = [{ sprite: ok ? "highlight" : "highlight_bad", tx: hover.tx, ty: hover.ty }];
      if (ok) items.push({ sprite: "node_mark", tx: hover.tx, ty: hover.ty });
      return items;
    }
    if (!hover) return [];
    if (phase === "setup-factory") return overlayItemsAt(hover.tx, hover.ty);
    // PP-06: the plant tool keeps its own overlay — the Factory footprint is the
    // strong layer, the qualifying town the soft one — because the placement
    // plans model factories and depots only. Both come from the SAME rule the
    // click runs.
    if (tool === "plant") {
      const items: OverlayItem[] = [];
      const ok = plantRefusal(grid, track, eco, hover.tx, hover.ty) === null;
      for (const [x, y] of footprintTiles(hover.tx, hover.ty)) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
        // No dedicated invalid sprite in the atlas: a legal footprint is the
        // strong glow, an illegal one only the faint tint (plus the refusal
        // reason in the HUD line below).
        items.push({ sprite: ok ? "highlight" : "highlight_soft", tx: x, ty: y });
      }
      const town = adjacentTown(grid, hover.tx, hover.ty);
      if (town) {
        for (const [hx, hy] of town.houses) {
          items.push({ sprite: "highlight_soft", tx: hx, ty: hy });
        }
      }
      return items;
    }
    return overlayItemsAt(hover.tx, hover.ty);
  };

  function paintUi(now: number) {
    // AI-03: what your ★ total is MADE OF, surfaced as the native hover
    // tooltip over each player's name in the header ("I want to see what I
    // and the rival received win points for"). Recomputed live from the
    // network (VICTORY: paves 0.25★, plants-after-the-first 1★).
    function vpTooltip(p: PlayerState): string {
      const b = victoryBreakdown(eco, p.id);
      const total = vpFor(score, p.id);
      // AI-04: the line is the difficulty's, so the tooltip's "of X★" and
      // "Y★ to win" agree with the win check that uses the same reader.
      const line = winTarget();
      return [
        `${p.name}${p.human ? " (you)" : ""} — ${fmtVp(total)}★ of ${line}★`,
        `Paved road tiles: ${b.paved} × 0.25★ = ${fmtVp(b.pavedVp)}★`,
        `Processing plants: ${b.plants + 1} (opening plant is free; ${b.plants} × 1★ = ${fmtVp(b.plantVp)}★)`,
        `${fmtVp(Math.max(0, line - total))}★ to win`,
      ].join("\n");
    }

    // BANNER-ONCE: each banner carries a stable id (`bannerKey`) beside its
    // text. The ✕ dismissal is remembered by that id, not by the exact text —
    // a few of these lines change wording while staying the same banner (the
    // free-tile counter, the protest countdown), so a text-keyed dismissal let
    // a CLOSED banner pop back up whenever the text changed and came back
    // (close "Dirt Road scores nothing…", switch tools, switch back → it
    // returned). The key makes "closed" stick for the rest of the game.
    let banner: string | null = null;
    let bannerKey: string | null = null;
    if (phase === "setup-factory") {
      bannerKey = "setup-factory";
      banner = "Place your Factory next to a town — click a buildable tile";
    }
    // PP-05: the setup banner states the price too — the first Depot is free
    // on the allowance, and the player should know the second one is not.
    else if (phase === "setup-harvester") {
      bannerKey = "setup-depot";
      banner = "Place your Depot — it needs an industry in its 4×4 catchment, and one Depot holds each industry" +
        (me.freeDepots > 0 ? ` (this one is free; later Depots cost ${costLabel(DEPOT_COST)})` : "");
    } else if (phase === "won") {
      bannerKey = "won";
      banner = `${winner?.name} wins — ${fmtVp(vpFor(score, winner?.id ?? ""))}★`;
    } else if (pendingProtest) {
      bannerKey = "protest-ready";
      banner = `Protest ready — click a public road to stop ALL trucks for ${fmtProtestLeft(PROTEST_MS)} (Esc cancels)`;
    } else if (me.freeTrack > 0) {
      bannerKey = "free-track";
      banner = `${me.freeTrack} free track tiles remaining — connect your depot to your Factory`;
    } else if (tool === "dirt") {
      bannerKey = "dirt-value";
      banner = `Dirt Road scores nothing — paving it later is worth ${fmtVp(VICTORY.upgrade)}★ a tile`;
    } else if (Object.keys(quarry.reach).length === 0) {
      bannerKey = "nothing-connected";
      banner = "Nothing connected — the Processing Plant only pays cargo your network reaches";
    } else if (tool === "plant") {
      bannerKey = "plant";
      banner = `Raise another processing plant next to a town — ${plantCostLabel()}`;
    } else {
      bannerKey = "match-gems";
      banner = "Match the tokened gems in the Processing Plant to process";
    }

    let costInfo: string | null = null;
    if (preview) {
      // W1: the label shows the preview's OWN numbers — the charge is
      // `preview.cost` and the free count is `preview.free`, exactly what the
      // commit will do.
      const parts = Object.entries(preview.cost).map(([k, v]) => `${v} ${k}`);
      const n = preview.tiles.length;
      const label = parts.length ? parts.join(" + ")
        : (preview.free > 0 ? "free (setup)" : "free");
      // VP-01: the modebar prices the SCORE the drag buys, from the same
      // numbers the commit charges (W1, applied to points). Only paving your
      // own gravel is worth anything, so a Road drag onto virgin ground says
      // "+0★" out loud — which is the whole victory rule in one field.
      const paved = preview.upgrades;
      const vpTxt = tool === "road"
        ? (paved > 0 ? `paves ${paved} · +${fmtVp(paveVp(paved))}★` : "+0★ · pave your dirt for points")
        : "+0★ · dirt scores nothing";
      costInfo = `<span class="mb-txt"><b>${n}</b> tiles · ${label}</span>` +
        (preview.truncated ? ` · <i>blocked</i>` : "") +
        `<span class="mb-cost">${vpTxt}</span>`;
    } else if (tool === "plant" && hover) {
      // PP-06: the cost is PREVIEWED from the same constant the charge uses,
      // together with the refusal reason, so a click is never a surprise.
      const why = plantRefusal(grid, track, eco, hover.tx, hover.ty);
      const afford = canAffordPlant(me.purse);
      const note = why !== null ? PLANT_REFUSAL_TEXT[why]
        : afford ? "ready" : "not enough materials";
      // VP-01: the plant is the other half of the scoreboard, so the price tag
      // and the point come up together.
      costInfo = `<span class="mb-txt"><b>Processing plant</b> · ${note}</span>` +
        `<span class="mb-cost">${plantCostLabel()} · +${fmtVp(VICTORY.plant)}★</span>`;
    } else if (tool === "harvester" || phase === "setup-harvester") {
      // PP-05: "show the complete cost before placement" — the Depot tool
      // prices itself from the same `priceDepot` the click will charge, so the
      // modebar and the debit can never disagree (W1, applied to buildings).
      const price = priceDepot(me.purse, me.freeDepots);
      const label = price.free ? "free (setup)" : costLabel(price.cost);
      costInfo = `<span class="mb-txt"><b>Depot</b> · ${label}</span>` +
        (price.affordable
          ? ""
          : ` · <i>needs ${shortfallLabel(price.missing)}</i>`) +
        `<span class="mb-cost">1×1 · industry in catchment</span>`;
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
          const comp = buildAllComponents(track, h.ownerId);
          const conn = resolveConnection(eco, comp, h);
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
          && resolveConnection(eco, buildAllComponents(track, h.ownerId), h).factory === f).length;
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
      tool,
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
      resetIn: Math.max(0, RESET_COOLDOWN_MS - (now - lastResetAt)),
      // PP-14b: the tycoon portrait picked on the start screen.
      portrait,
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
  const requestTrackBuild = (
    kind: TrackKind, ax: number, ay: number, bx: number, by: number, xFirst: boolean,
  ): DragPreview | null => {
    if (phase !== "play") return null;
    const owner = playerNetwork(track, me.i + 1, eco.factories, eco.harvesters);
    if (!canBuildOn(grid, kind, ax, ay, owner)) return null;
    const pv = previewDrag(grid, track, kind, me.purse, ax, ay, bx, by, xFirst, owner,
      me.freeTrack, structureTiles(eco.factories, eco.harvesters, me.i + 1));
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
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const pos = (e: PointerEvent): [number, number] => {
    const b = stage.getBoundingClientRect();
    return [(e.clientX - b.left) * dpr(), (e.clientY - b.top) * dpr()];
  };
  let downAt: [number, number] | null = null;
  let moved = false;

  canvases.overlay.addEventListener("pointerdown", (e) => {
    if (typeof canvases.overlay.setPointerCapture === "function") {
      canvases.overlay.setPointerCapture(e.pointerId);
    }
    const [x, y] = pos(e);
    downAt = [x, y]; moved = false;
    const p = pickForAction(x, y);
    if (!p) return;
    const isMouse = e.pointerType === "mouse";
    const isTrackTool = tool === "road" || tool === "dirt";
    // TK-001: left mouse (button 0) is build/place ONLY — it never starts a
    // pan. Touch keeps its old behaviour (one finger pans, a quick tap places).
    // An armed protest owns the left button: it must never start a track drag.
    if (phase === "play" && isTrackTool && !pendingProtest && (!isMouse || e.button === 0) && e.isPrimary) {
      // W2: a drag extends YOUR network only — the rival's road is not a
      // seed you can grow from.
      const net = playerNetwork(track, me.i + 1, eco.factories, eco.harvesters);
      if (canBuildOn(grid, tool as TrackKind, p.tx, p.ty, net)) {
        drag = { ax: p.tx, ay: p.ty };
        return;
      }
    }
    // TK-001: mouse panning is the MIDDLE button (button === 1). Left and
    // right mouse presses never enter the pan gesture — the right button has
    // no map action at all (previously its isPrimary drag could even build).
    if (isMouse && e.button !== 1) return;
    g = pointerDown(g, { id: e.pointerId, x, y });
  });

  canvases.overlay.addEventListener("pointermove", (e) => {
    const [x, y] = pos(e);
    if (downAt && (Math.abs(x - downAt[0]) > 4 || Math.abs(y - downAt[1]) > 4)) moved = true;
    const p = pickForAction(x, y);
    if (p) hover = { tx: p.tx, ty: p.ty, ref: p.ref };
    if (drag && p) {
      const kind = tool as TrackKind;   // build-track tools are dirt | road
      const net = playerNetwork(track, me.i + 1, eco.factories, eco.harvesters);
      // W1: the preview prices the drag with the REAL purse and the free
      // allowance applied INSIDE the preview (last arg). The old
      // "freeTrack > 0 → 9999 stone" trick priced the preview differently
      // from the commit; now both share one cost model, so what you see is
      // what you are charged.
      preview = previewDrag(grid, track, kind, me.purse,
        drag.ax, drag.ay, p.tx, p.ty, true, net, me.freeTrack,
        structureTiles(eco.factories, eco.harvesters, me.i + 1));
      return;
    }
    const out = pointerMove(g, { id: e.pointerId, x, y }, cam);
    g = out.gesture;
    if (out.cam !== cam) { cam = out.cam; renderer?.setCamera(cam); }
  });

  const onUp = (e: PointerEvent) => {
    const [x, y] = pos(e);
    if (drag && preview) {
      if (preview.tiles.length === 0) {
        // W9: the allowance buys Dirt only, so a paved Road drag with no ore
        // previews nothing at all. Say that, rather than the generic "must
        // extend your network" — which is not why it refused, and reads as a
        // bug.
        if (tool === "road" && (me.purse.ore ?? 0) < (TRANSPORT.road.cost.ore ?? 0)) {
          toast(me.freeTrack > 0
            ? "A paved Road costs ore — free setup tiles only cover Dirt Roads."
            : "A paved Road needs ore — connect an ore mine first.", "bad");
        } else {
          toast("Track must extend your network.", "bad");
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
            toast("Now connect it to your Factory with a Dirt Road or a paved Road — then match the tokened gems in the Processing Plant.", "info");
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
          } else if (tool === "demolish") {
            if (isGuest()) net?.sendIntent("demolish", { do: "demolish", tx: p.tx, ty: p.ty });
            else doDemolish(p.tx, p.ty);
          }
          else if (tool === "road" || tool === "dirt") {
            const net = playerNetwork(track, me.i + 1, eco.factories, eco.harvesters);
            const refusal = buildRefusal(grid, tool as TrackKind, p.tx, p.ty, net);
            if (refusal !== null) {
              if (refusal === "not-adjacent") toast("Track must extend your network.", "bad");
              else if (refusal === "water") toast("Can't build on water.", "bad");
              else if (refusal === "rough") toast("A paved Road can't cross rough ground — use a Dirt Road.", "bad");
              else if (refusal === "occupied") toast("Tile is occupied.", "bad");
              else toast("Can't build there.", "bad");
            }
          }
        }
      }
    }
    downAt = null;
    g = pointerUp(g, e.pointerId);
  };
  canvases.overlay.addEventListener("pointerup", onUp);
  canvases.overlay.addEventListener("pointercancel", (e) => {
    drag = null; preview = null; downAt = null; g = pointerUp(g, e.pointerId);
  });
  canvases.overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x, y] = pos(e as unknown as PointerEvent);
    cam = zoomStepAt(cam, e.deltaY < 0 ? +1 : -1, x, y);
    renderer?.setCamera(cam);
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    const map: Record<string, Tool> = { "1": "dirt", "2": "road", "3": "harvester", "4": "plant", "5": "demolish" };
    if (map[e.key]) tool = map[e.key];
    if (e.key === "Escape" && pendingProtest) {
      pendingProtest = false;
      toast("Protest cancelled.", "info");
      return;
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
  });

  // ── resize ─────────────────────────────────────────────────────────────
  const resize = () => {
    const d = dpr();
    const w = Math.max(1, Math.floor(stage.clientWidth * d));
    const h = Math.max(1, Math.floor(stage.clientHeight * d));
    for (const c of Object.values(canvases)) { c.width = w; c.height = h; }
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
      eco: { harvesters: eco.harvesters, factories: eco.factories },
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
      localStorage.setItem(SAVE_KEY, JSON.stringify(collectSave()));
    } catch { /* private mode / quota — saving must never break the game */ }
  }

  function applySave(d: SaveGamePayload) {
    // difficulty first: every pacing read below derives from it
    skillKey = d.skillKey as SkillKey;
    setRivalSkill(skillKey);
    trackRestored(track, d.track);
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
    eco.harvesters.length = 0; eco.harvesters.push(...d.eco.harvesters);
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
    rescore(eco, score);
    for (const p of players) starFed.set(p.id, Math.floor(vpFor(score, p.id)));
    phase = d.phase as typeof phase;
    winner = d.winnerId
      ? (players.find((p) => p.id === d.winnerId) ?? null)
      : null;
    playerSabotage = Math.max(0, Math.floor(d.story?.playerSabotage ?? 0));
    rivalSabotageHits = Math.max(0, Math.floor(d.story?.rivalSabotage ?? 0));
    winningSource = d.story?.winningSource === "upgrade" || d.story?.winningSource === "plant"
      ? d.story.winningSource
      : null;
    oilBanterSeen = d.story?.oilBanterSeen === true;
    for (const b of d.boards) {
      if (b.kind === "ai") rivalQuarry.board.restore(b.data);
      else quarry.board.restore(b.data);
    }
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

  // ── AI-03: the top-bar buttons — peek at the rival's plant, restart game ──
  const topRight = ui.el.querySelector<HTMLElement>(".top-right");
  if (topRight) {
    const peek = document.createElement("button");
    peek.type = "button"; peek.id = "iso-rival-peek";
    peek.className = "icon-btn"; peek.textContent = "🏭";
    peek.title = "Watch the rival's plant — its board plays itself";
    peek.addEventListener("click", () => toggleRivalPlantView());

    // MP-05: the peek panel reads the LOCAL plant record, which on a guest is
    // not the seat's board (that lives on the host), so it is host-only.
    if (!isGuest()) topRight.appendChild(peek);

    // MP-05: ↻ restarts a SOLO match. In a room the match belongs to the
    // session — reloading would strand the other seat — so the button is gone.
    if (isSolo()) {
      const restart = document.createElement("button");
      restart.type = "button"; restart.id = "iso-restart";
      restart.className = "icon-btn"; restart.textContent = "↻";
      restart.title = "New game — clears the save and the difficulty pick";
      restart.addEventListener("click", () => {
        if (!window.confirm("Start a new game? The save and your difficulty pick are cleared.")) return;
        restartArmed = true; // do NOT let the pagehide autosave re-write the save
        clearSave();
        try { localStorage.removeItem(SKILL_STORAGE_KEY); } catch { /* private mode */ }
        location.reload();
      });
      topRight.appendChild(restart);
    }
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
        .map((k) => `<span class="rb-chip">${CARGO[k].icon}&nbsp;${rival.purse[k] ?? 0}</span>`)
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
  let disposed = false;

  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej; img.src = src;
  });

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
    const images = new Map<number, AtlasImage>();
    const [a05, a1, a2] = await Promise.all([load(atlas05), load(atlas1), load(atlas2)]);
    images.set(0.5, a05); images.set(1, a1); images.set(2, a2);
    const atlas = new Atlas(manifestJson as unknown as Manifest, images);
    buildMasks(atlas);
    if (disposed) return;

    // W-series: the roads and buildings blit from their own LAYER atlases
    // (assets/layers/, identical sprite rects), and the ground paints from
    // the seamless world-anchored textures. Both load in parallel with the
    // first frame — the renderer falls back to the monolithic atlas and flat
    // ground colours until they arrive, then invalidates everything.
    const layersPromise = Promise.all([
      load(roads05), load(roads1), load(roads2),
      load(buildings05), load(buildings1), load(buildings2),
      loadGroundTextures({ grass: grassTex, sand: sandTex, water: waterTex }),
    ]).then(([r05, r1, r2, b05, b1, b2, tex]) => {
      if (disposed) return;
      atlas.layerImages.set("roads", new Map([[0.5, r05], [1, r1], [2, r2]]));
      atlas.layerImages.set("buildings", new Map([[0.5, b05], [1, b1], [2, b2]]));
      renderer?.setGround(tex);
    }).catch((err) => {
      // Textures are an upgrade, never a gate: the flat-colour ground and the
      // monolithic atlas remain fully playable.
      console.warn("[w-series] layer art failed to load:", err);
    });

    // Building layers (assets/buildings/): per-building PNGs that override
    // the shared sheet for the sprites they cover, placed free on their
    // footprints' centres. Parallel, non-gating — a missing manifest or a
    // failed sprite just keeps the sheet art for that building.
    // SCENERY art (assets/ground/decals/, assets/scenery/): the decal patches
    // and the tree sprites. Non-gating like every other art load — until it
    // lands the map is the plain meadow with no trees, which is playable.
    void Promise.all([loadDecalImages(), loadScenerySprites(atlas)]).then(([decals, trees]) => {
      if (disposed) return;
      renderer?.setDecalImages(decals);
      if (trees) {
        // The tree defs just joined the sprite table, so the cull pad (max
        // footprint + tallest sprite) may have grown.
        renderer?.recomputePad();
      }
      renderer?.invalidateAll();
    }).catch((err) => {
      console.warn("[scenery] art failed to load:", err);
    });

    // Road materials, on their own promise. Both must decode before the style
    // is installed — a half-textured road network would look like a bug — but
    // nothing waits on them, and a failure keeps the flat palette, which is a
    // complete look rather than an error state.
    void Promise.all([load(asphaltTex), load(dirtTex)]).then(([asphalt, dirt]) => {
      if (disposed) return;
      renderer?.setRoadStyle({
        ...DEFAULT_ROAD_STYLE,
        paved: { ...DEFAULT_ROAD_STYLE.paved, image: asphalt },
        dirt: { ...DEFAULT_ROAD_STYLE.dirt, image: dirt },
      });
    }).catch((err) => {
      console.warn("[roads] material textures failed to load:", err);
    });

    void loadBuildingLayers(atlas, `${import.meta.env.BASE_URL}assets/buildings/`).then((n) => {
      if (disposed || !n) return;
      // B-3.2: the layers just MUTATED sprite w/h (a per-building PNG can
      // out-tall the tallest sheet sprite), so the constructor-time cull pad
      // is stale — tall buildings would pop at the screen edge.
      renderer?.recomputePad();
      renderer?.invalidateAll();
    }).catch((err) => {
      console.warn("[building-layers] failed to load:", err);
    });

    atlasRef = atlas;
    renderer = new IsoRenderer(canvases, atlas, cam, world);
    renderer.setDecals(scenery);
    renderer.overlayPainter = (ctx, c, t) => paintProtests(ctx, c, t);
    void load(protestArt).then((img) => { protestImg = img; }).catch(() => {});
    debug?.attachRenderer();
    enableRenderLogOnBoot();
    resize();
    syncWorld();
    void layersPromise;

    let lastFrameT = 0;
    const frame = (t: number) => {
      if (disposed) return;
      // RV-01: the lorries move in TILE units per millisecond, so the frame
      // needs a real dt (capped — a background tab must not teleport them).
      const dt = Math.min(100, Math.max(0, t - lastFrameT));
      lastFrameT = t;
      economyTick(t);
      quarryTick(t);
      aiTick(t);
      // MP-05: protests are solo/host-only (buyBlack refuses guests, like the
      // rest of the Black Market), so the sweep is a no-op on a guest — it
      // runs unguarded rather than splitting the heartbeat below.
      if (protests.size > 0) expireProtests(t);
      // MP-05: the host's heartbeat — one small delta per `PUBLISH_MS`, full
      // state only when `buildPublish` says the delta would not fit (§5).
      publishNet(t);
      // MP-05 (§9): a guest runs NO vehicle movement. Lorry positions are not
      // on the wire yet, so the guest's roads stay empty rather than carrying a
      // locally-simulated fleet that disagrees with the host's — the map, the
      // purses and the payouts it renders are the host's, and the guest must not
      // spend a router on a convoy it does not own.
      if (!isGuest()) {
        if (trucksDirty) {
          trucks.trucks = planTrucksTrucksMerge(trucks.trucks, planTrucks(eco));
          // TRAFFIC-01: the road surface is the cars' world too — replan them
          // on the same edge. A car whose route is unchanged keeps its place.
          cars.cars = planCars(track, cars.cars, carCount);
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
        tickCars(cars, dt);
      }
      collectDeliveries(t);
      // TRAFFIC-01: trucks and ambient cars share the vehicles list — one
      // depth-sorted pass draws both, and culling treats them identically.
      world.vehicles = carItems(cars).concat(truckItems(trucks));
      renderer!.render(t, overlayItems());
      floats.frame(t);
      paintUi(t);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  })().catch((err) => {
    ui.toast(`Failed to load art: ${err}`, "bad");
  });

  // expose for e2e (mirrors the existing window.__hex hook)
  (window as unknown as Record<string, unknown>).__iso = {
    get phase() { return phase; },
    get tool() { return tool; },
    get vp() { return { you: vpFor(score, "you"), ai: vpFor(score, "ai") }; },
    /** VP-01: the target and the two numbers behind a player's total.
     *  AI-04: the target is the difficulty's line (5★ on easy), not a constant. */
    get vpTarget() { return winTarget(); },
    get vpRates() { return { upgrade: VICTORY.upgrade, plant: VICTORY.plant }; },
    victoryOf: (who: string) => victoryBreakdown(eco, who),
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
    get harvesters() { return eco.harvesters; },
    get factories() { return eco.factories; },
    get freeTrack() { return me.freeTrack; },
    /**
     * ART-1950S (TICKET-B0): the per-building PNG layers actually installed
     * from assets/buildings/ — the sprites whose art overrides the shared
     * sheet. e2e asserts against this instead of sniffing network responses
     * (a 200 on the manifest alone does not prove a layer landed), and the
     * B4 dead-art audit reuses it. Empty array = everything is drawing from
     * the shared buildings sheet (the non-gating fallback).
     */
    get buildings() { return atlasRef ? [...atlasRef.buildingImages.keys()] : []; },
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
        cars.cars = planCars(track, cars.cars, carCount);
        trucksDirty = false;
        quarry.setTruckServed(truckCargos(trucks.trucks, now));
        rivalQuarry.setTruckServed(truckCargos(trucks.trucks, now, "ai"));
      }
      tickTrucks(trucks, dtMs, protests.size > 0 ? new Set(protests.keys()) : undefined);
      tickCars(cars, dtMs);
      collectDeliveries(now);
    },
    /** TRAFFIC-01 diagnostics: the ambient cars by NAME (car 1 / car 2 /
     *  car 3) with their live position, so headless probes and the perf
     *  dial can tell them apart while the art is still the lorry. */
    get traffic() {
      return cars.cars.map((c) => ({
        name: c.name, loop: c.loop, reverse: c.reverse,
        leg: c.leg, t: Math.round(c.t * 1000) / 1000,
        routeTiles: c.route.length,
      }));
    },
    /** TRAFFIC-01 perf dial: set the ambient-traffic volume (0 clears the
     *  streets, 3 is the default "a few"). Replans from the live road
     *  surface immediately — no build needed to feel the cost. */
    setTraffic: (count: number) => {
      if (isGuest()) return [];
      carCount = Math.max(0, Math.min(64, Math.trunc(count) || 0));
      cars.cars = planCars(track, cars.cars, carCount);
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
    /** Refresh the reachable set now (spawn tokens for newly reached cargo). */
    refreshQuarry: (now = performance.now()) => quarry.refresh(now),
    /** Story test twin of the player's first successful Oil harvest. */
    firstOilHarvest: () => onFirstOilHarvest(),
    /** The e2e twin of clicking two adjacent gems in the Quarry panel. */
    swap: (r1: number, c1: number, r2: number, c2: number) =>
      quarry.board.trySwap(r1, c1, r2, c2, performance.now()),
    setTool: (t: Tool) => { tool = t; },
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
      const taken = eco.harvesters.some((x) => x.tx === tx && x.ty === ty);
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
      const net = playerNetwork(track, me.i + 1, eco.factories, eco.harvesters);
      if (!canBuildOn(grid, kind, ax, ay, net)) return null;
      return previewDrag(grid, track, kind, me.purse, ax, ay, bx, by, xFirst, net, me.freeTrack,
        structureTiles(eco.factories, eco.harvesters, me.i + 1));
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
    net?.dispose();
    window.clearInterval(saveIv);
    if (onPageHide) window.removeEventListener("pagehide", onPageHide);
    // AI-03: the dead game must not keep overwriting the live save either;
    // last intact state stays — the interval was the only writer.
    endingView?.destroy();
    endingView = null;
    floats.clear();
    cancelAnimationFrame(raf);
    ro.disconnect();
    root.classList.remove("iso-game");
    root.innerHTML = "";
  };
}
