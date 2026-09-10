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

import { Atlas, buildMasks, type Manifest, type AtlasImage } from "./atlas";
import {
  createCamera, centerOnTile, resizeCamera, zoomStepAt, tileToScreenAt,
  createGesture, pointerDown, pointerMove, pointerUp,
  type Camera, type GestureState,
} from "./camera";
import { IsoRenderer, type World } from "./renderer";
import { generateMap, resolveMapSeed, type Grid, type Industry } from "./grid";
import {
  createTrack, drawBits, previewDrag, commitDrag, canBuildOn, hasTrack,
  demolishTile, tIdx, playerNetwork, canAfford, buildRefusal, seedTownRoads,
  seedPublicRoads, isPublicRoad, isUpgradedRoad, tileCost,
  type Track, type TrackKind, type Purse, type DragPreview,
} from "./track";
import {
  industriesInCatchment, ownerIdOf,
  playerResources, buildAllComponents, resolveConnection,
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
  aiBuildStep, chooseRivalFactorySpot, planCandidates, planUpgrades, executePaves,
  paveCandidates, rivalPace, type RivalPace,
} from "./ai";
import { planDepotPlacement, planFactoryPlacement, type PlacementPlan } from "./placement";
import {
  PLANT_COST, PLANT_REFUSAL_TEXT, addPlant, adjacentTown, canAffordPlant,
  chooseAiPlantSpot, footprintTiles, plantRefusal, plantsOf,
} from "./plants";
import {
  CARGO, CARGOES, FACTORY_FOOTPRINT, FACTORY_SPRITE, INDUSTRY_BY_KEY, TRANSPORT,
  VICTORY, VP_TARGET, UPGRADE_COST,
  depotSpriteForCargo, townHouseSprite, type Cargo,
} from "./config";
import {
  DEPOT_COST, FREE_SETUP_DEPOTS, costCompact, costLabel, priceDepot, shortfallLabel,
} from "./construction";
import { bankTrade } from "../game/trade";
import {
  MAP_W, MAP_H, BANDIT_MS, BLOCK_MS, FOG_MS, RAID_EVERY, SABOTAGE, SECURITY,
  choice, type ResKey,
} from "../game/config";
import { createQuarry, GEM_TO_CARGO, type Quarry } from "./quarry";
import { createRivalPlant, RIVAL_FROST_MS, RIVAL_GIRDER_MS, RIVAL_SMOG_MS } from "./rival-plant";
import { createFloatLayer, type FloatLayer } from "./floats";
import {
  createTruckState, planTrucks, tickTrucks, truckItems, roadRouteForHarvester,
  type Truck,
} from "./vehicles";
import { createIsoMarket, toBag, type CargoBag, type IsoMarket } from "./market";
import { createOriginalUi, type OriginalUi } from "../game/ui";
import {
  createIsoDebug, shouldInstallDebugConsole, shouldAutoEnableDebugOverlays,
  shouldAutoEnableRenderLog,
} from "./debug";
import { joinFromSnapshot } from "./snapshot";
export { joinFromSnapshot };

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

export function startIsoGame(root: HTMLElement) {
  // ── DOM ────────────────────────────────────────────────────────────────
  // U1: the recovered UI owns the chrome. It is created once the trading
  // state exists (below); the iso canvas layer stack is mounted into its
  // original map-canvas slot. Keep `.iso-game` on the root for the boot test.
  root.innerHTML = "";
  root.classList.add("iso-game");
  let ui: OriginalUi;

  // ── state ──────────────────────────────────────────────────────────────
  const seed = resolveMapSeed();
  const grid: Grid = generateMap(seed);
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
    onHarvest: (cargo, amount) => earn(me, { [cargo]: amount }),
    onBlocked: (cargo, amount) =>
      toast(`No route for ${CARGO[cargo].name} — ${amount} lost. Reconnect it.`, "bad"),
    // W5: the missing wire. The board banks a combo coin every 2 combos;
    // this listener is what puts it in the purse (and keeps the Black Market
    // affordable). The HUD chip refreshes on the next paint, which is every
    // frame.
    onGold: (n) => {
      earn(me, { gold: n });
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

  // W6: the rival's answers and expirations are trade events — surface them
  // in the Feed so "the rival answered my offer" is visible, not silent.
  const market: IsoMarket = createIsoMarket(players.map((p) => ({
    i: p.i, id: p.id, name: p.name, human: p.human, purse: p.purse,
  })), {
    onOfferClosed: (o, how) => {
      const body = `${o.giveN} ${CARGO[o.give].name} → ${o.wantN} ${CARGO[o.want].name}`;
      if (how === "accepted") ui.feed(`Rival took your offer: ${body}`, rival.name);
      else ui.feed(`Your offer expired — escrow refunded (${body})`);
    },
  });
  const meTrader = market.players[0];

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
      void quarry.board.trySwap(r1, c1, r2, c2, performance.now());
    },
    onReset: () => {
      quarry.board.resetNeutral();
      toast("Processing Plant collapsed. Fresh neutral board.", "info");
    },
    onBlackAction: (key) => buyBlack(key),
  });
  onBoardChange = () => ui.renderBoard();
  root.appendChild(ui.el);

  // ── A1: the board's own effects finally have somewhere to go ────────────
  // `Board` fires `onFx` for every pop, crack, token-up, bomb, bad swap and
  // callout, and NOTHING had ever assigned it — so all of it, including
  // MATCH! / COMBO x2 / CHAIN x3!! / MATCH 5, died on the board. This one
  // line is the wire the handover was asking for.
  quarry.board.onFx = (type, r, c, text) => ui.fx(type, r, c, text);

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
  const toast = (text: string, kind: Toast["kind"] = "info") => {
    const now = performance.now();
    // the board fires per-gem; collapse repeats so a match is one line
    if (text === lastToastText && now - lastToastAt < 1200) return;
    lastToastText = text; lastToastAt = now;
    // U1: the restored HUD owns the toast DOM.
    ui.toast(text, kind);
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
        toast(label, gained ? "good" : "bad");
        for (const [tx, ty] of b.spots) {
          floats.add(vpDeltaText(b.vp / b.n), tx, ty, { cls: gained ? "delivery" : "sabotage", now });
        }
      }
    }
    // the scoreboard's own tie-breaker: whoever crosses 10★ first, wins
    if (phase === "play") {
      for (const p of players) {
        if (!hasWon(score, p.id)) continue;
        phase = "won"; winner = p;
        const b = victoryBreakdown(eco, p.id);
        toast(`${p.name} wins — ${fmtVp(vpFor(score, p.id))}★ `
          + `(${b.paved} paved tile${b.paved === 1 ? "" : "s"}, ${b.plants} plant${b.plants === 1 ? "" : "s"})`,
        p.human ? "good" : "bad");
      }
    }
  }

  /**
   * The one place the scoreboard is consulted, on every build and demolish
   * (VP-01: it reads the track's pave provenance and the plant list, so it is
   * still a network event and never a clock).
   */
  const rescoreNow = () => {
    const now = performance.now();
    applyVpEvents(rescore(eco, score), now);
    trucksDirty = true;   // RV-01: the network changed — replan the lorries
    netVersion++;         // RV-03: drop the hover-route cache so the closest route is re-checked
    // J1: the network just changed. Recompute what the quarry may pay and
    // spawn tokens for cargo that became reachable — no waiting for the 20s
    // clock, because "I connected it and nothing happened" is how this join
    // would look broken.
    quarry.refresh(now);
  };

  // ── actions ────────────────────────────────────────────────────────────
  function placeFactory(tx: number, ty: number): boolean {
    // PP-02: the whole Factory footprint (FACTORY_FOOTPRINT) must be legal ground AND touch a
    // town by an edge. `planFactoryPlacement` with `requireTown` is the same
    // rule the placement preview paints from, so the click and the hover can
    // never disagree about what "next to a town" means.
    const plan = planFactoryPlacement(grid, tx, ty, { requireTown: true });
    if (!plan.valid) {
      toast(plan.code === "not-near-town"
        ? "The Factory must be placed next to a town — its footprint must share an edge with a town tile."
        : `Can't build there — ${plan.why ?? "not buildable"}.`, "bad");
      return false;
    }
    // W2: the factory carries its builder's track-owner id (player index + 1).
    // PP-06: the starting Factory is plant #0 — same building, same record.
    eco.factories.push({
      owner: "you", ownerId: me.i + 1, tx, ty,
      id: 0, townId: adjacentTown(grid, tx, ty)?.id ?? null,
    });
    // Give the rival a factory a good distance away, on legal ground it can
    // actually build from. W8: the farthest dirt-legal tile was often ROUGH,
    // where a paved Road is illegal, and the rival's paved-first plan then had
    // nothing to lay — it "played" every 9 s and never built a tile. `ai.ts`
    // ranks paved-legal tiles first and probes the top of the ranking for a
    // real plan before the tile is committed.
    const spot = chooseRivalFactorySpot(grid, track, [tx, ty], {
      purse: rival.purse, free: rival.freeTrack, ownerId: rival.i + 1, owner: rival.id,
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
    if (!industriesInCatchment(grid, h).length) {
      toast("A depot needs an industry in its 4×4 catchment.", "bad");
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

  function doDemolish(tx: number, ty: number) {
    const hi = eco.harvesters.findIndex((h) => h.tx === tx && h.ty === ty && h.owner === "you");
    if (hi >= 0) {
      eco.harvesters.splice(hi, 1);
      syncWorld(); rescoreNow();
      toast("Depot removed.", "info");
      return;
    }
    // PP-06: a plant is demolishable like any other building — but never the
    // last one, or the player would have nowhere to deliver.
    const pi = eco.factories.findIndex((f) => f.owner === me.id
      && tx >= f.tx && tx < f.tx + FACTORY_FOOTPRINT[0]
      && ty >= f.ty && ty < f.ty + FACTORY_FOOTPRINT[1]);
    if (pi >= 0) {
      if (plantsOf(eco, me.id).length <= 1) {
        toast("You can't demolish your only processing plant.", "bad");
        return;
      }
      eco.factories.splice(pi, 1);
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
    const mine = track.owner[tIdx(tx, ty)] === me.i + 1;
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
    if (removedKind === "dirt") {
      const back = choice(DIRT_DEMOLISH_REFUND);
      earn(me, { [back]: 1 });
      toast(`Dirt Road cleared — salvaged 1 ${CARGO[back].icon} ${CARGO[back].name}.`, "good");
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
    }
    syncWorld();
    rescoreNow();
  }

  // ── Black Market (U1 wiring over the restored board + industry blockade) ──
  const REPAIR_ISO_COST: Purse = { wood: 1, stone: 1, grain: 1, ore: 1 };
  /**
   * PP-08: Security Forces are defensive, not sabotage, so they no longer cost
   * Gold. `SECURITY.cost` is declared in the legacy ResKey table
   * (`game/config.ts`); GEM_TO_CARGO is the one ResKey→Cargo bijection, so the
   * same mapping the board uses moves the price into purse space
   * (`wheat`→grain, `brick`→stone). Only the four SABOTAGE actions above keep
   * a Gold price — Gold is reserved for Black Market sabotage.
   */
  const SECURITY_ISO_COST: Purse = Object.fromEntries(
    (Object.entries(SECURITY.cost ?? {}) as [ResKey, number][])
      .map(([r, n]) => [GEM_TO_CARGO[r], n]),
  ) as Purse;

  function buyBlack(key: string) {
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
      rivalHit(`❄ ${n} FROZEN`);
      toast(`Frost Tiles: ${n} gems frozen in the rival's plant — its yield is down ${dentPct()}% for ${RIVAL_FROST_MS / 1000}s.`, "good");
      return;
    }
    if (key === "block") {
      if (!spendGold(SABOTAGE.block.gold)) return;
      const n = rivalPlant.girders(now);
      rivalHit(`🏗 ${n} GIRDERS`);
      toast(`Iron Girders: ${n} dropped into the rival's plant — its yield is down ${dentPct()}% for ${RIVAL_GIRDER_MS / 1000}s.`, "good");
      return;
    }
    if (key === "fog") {
      if (!spendGold(SABOTAGE.fog.gold)) return;
      rivalPlant.smog(now);
      rivalHit("🌫 SMOG");
      toast(`Smog Cloud over the rival's plant — its yield is down ${dentPct()}% for ${RIVAL_SMOG_MS / 1000}s.`, "good");
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
      toast(`Security Forces hired — guarded for ${SECURITY.ms / 1000}s.`, "info");
      return;
    }
    if (key === "repair") {
      const affordable = (Object.entries(REPAIR_ISO_COST) as [Cargo, number][])
        .every(([k, v]) => (me.purse[k] ?? 0) >= v);
      if (!affordable) { toast("Not enough materials for Repair Crew.", "bad"); return; }
      spend(me, REPAIR_ISO_COST);
      const n = quarry.board.smashBlocks();
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
  const trickleCarry: Partial<Record<Cargo, number>> = {};

  function economyTick(now: number) {
    if (phase !== "play") return;
    if (now - lastHarvest < HARVEST_MS) return;
    lastHarvest = now;
    // J1: YOUR cargo comes from matching the quarry, not from a trickle — the
    // connection decides what the board is allowed to pay. The rival has no
    // board to play, so the passive yield stays as its income.
    // W3: the trickle is computed over the rival's OWN network (W2's
    // owner-scoped components) and credited straight to its purse — this is
    // the rival's only income, so once it connects an industry its stone/ore
    // actually move over time.
    // PP-07: fractional yields ACCUMULATE across ticks instead of rounding
    // each tick. Per-tick rounding paid 0 forever for an Oil Rig (0.4/tick)
    // or a Gold Mine (0.3/tick), so an oil-only network was dead income —
    // and with every paid Depot now costing Oil, that was an opening
    // deadlock. The carry turns 0.4/tick into 1 oil every ~7.5 s.
    const y = playerResources(eco, rival.id, now);
    // A1: the rival's plant is what sabotage wrecks, so it is also what its
    // income runs through. A pristine plant multiplies by 1; ice, girders
    // and smog take their share off the top. Without this a Black Market buy
    // would cost Gold and change nothing.
    const rivalHealth = rivalPlant.health(now);
    const gain: Purse = {};
    for (const [cargo, v] of Object.entries(y) as [Cargo, number][]) {
      const acc = (trickleCarry[cargo] ?? 0) + Math.max(0, v) * rivalHealth;
      const n = Math.floor(acc);
      trickleCarry[cargo] = acc - n;
      if (n > 0) gain[cargo] = n;
    }
    if (Object.keys(gain).length) earn(rival, gain);
    // blockades expire on a clock, so the reachable set is re-read here too
    quarry.refresh(now);
  }

  /** Per frame: board effects, the token spawn, and the market clock. */
  function quarryTick(now: number) {
    market.tick(now);
    // A1: ice and girders on the rival's plant expire on their own clock —
    // nobody is there to clear them.
    rivalPlant.tick(now);
    if (phase !== "play") return;
    quarry.tick(now);
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
    rivalPace(vpFor(score, "you"), vpFor(score, "ai"), VP_TARGET);

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
  function rivalBankTowardPave(): number {
    const pace = rivalPaceNow();
    const want = paveMilestone();
    if (!want) return 0;
    const price = UPGRADE_COST.ore ?? 4;
    const need = want.ore ?? 0;
    if ((rival.purse.ore ?? 0) >= need) return 0;          // it can already pay
    const depot = priceDepot(rival.purse, rival.freeDepots).cost;
    const trader = { res: rival.purse };
    let trades = 0;
    while ((rival.purse.ore ?? 0) < need && trades < pace.bankPerTurn) {
      const surplus = (CARGOES as Cargo[])
        .filter((c) => c !== "gold" && c !== "ore" && (rival.purse[c] ?? 0) >= price)
        .filter((c) => (rival.purse[c] ?? 0) - price >= (depot[c] ?? 0))
        .sort((a, b) => (rival.purse[b] ?? 0) - (rival.purse[a] ?? 0))[0];
      if (!surplus) return trades;
      if (!bankTrade(trader, surplus, "ore")) return trades;
      trades++;
    }
    return trades;
  }

  const rivalBankTowardPlan = (f: Factory) => {
    // Price with a HYPOTHETICAL deep purse: `planCandidates` drops plans the
    // purse cannot finish, and the plan to bank toward is exactly one of
    // those. Scarcity ranking still reads the REAL stock; only affordability
    // is lifted.
    const deep: Purse = { ...rival.purse };
    for (const c of CARGOES) deep[c] = (deep[c] ?? 0) + MAP_W * MAP_H;
    const cands = planCandidates(eco, f, {
      stock: rival.purse, purse: deep,
      free: rival.freeTrack, freeDepots: rival.freeDepots,
    });
    if (!cands.length) return;
    const depot = priceDepot(rival.purse, rival.freeDepots).cost;
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
    const planTarget: Purse = {};
    for (const [k, v] of Object.entries(chosen.cost)) planTarget[k as Cargo] = v;
    for (const [k, v] of Object.entries(depot)) planTarget[k as Cargo] = (planTarget[k as Cargo] ?? 0) + v;
    // …and the scoreboard's own milestone competes with it. Whichever is FEWER
    // trades away gets the turn, so a rival one trade short of four paves
    // paves — 1★ of score and the ×1.6 — rather than grinding out a depot.
    const gap = (p: Purse): number => {
      let missing = 0;
      for (const [k, v] of Object.entries(p) as [Cargo, number][]) {
        missing += Math.max(0, v - (rival.purse[k] ?? 0));
      }
      return missing;
    };
    const paveTarget = paveMilestone();   // 4 tiles: the smallest step that scores
    const target: Purse = paveTarget && gap(paveTarget) < gap(planTarget) ? paveTarget : planTarget;
    const trader = { res: rival.purse };
    const budget = rivalPaceNow().bankPerTurn;
    let trades = 0;
    for (const [cargo, need] of Object.entries(target) as [Cargo, number][]) {
      if (trades >= budget) break;
      while ((rival.purse[cargo] ?? 0) < need && trades < budget) {
        const surplus = (CARGOES as Cargo[])
          .filter((c) => c !== "gold" && c !== cargo && (rival.purse[c] ?? 0) >= 4)
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
    if (now - lastRaid < RAID_EVERY) return;
    lastRaid = now;
    // VP-01: only the cards this function can actually play. `bandit` is
    // `rivalSabotage`'s business (it targets a district, not the plant) and
    // `security` is a defender's card — and because the hire is paid before the
    // effect, a rival holding exactly 5 Gold used to burn it on a `hit` that did
    // nothing. "Affordable" is not the same question as "playable".
    const keys = (Object.keys(SABOTAGE) as string[]).filter(
      (k) => RAID_ACTIONS.has(k) && (rival.purse.gold ?? 0) >= SABOTAGE[k].gold,
    );
    if (!keys.length) return;                     // no Gold, no raid
    const key = choice(keys);
    const def = SABOTAGE[key];
    spend(rival, { gold: def.gold });             // the hire is paid either way
    if (now < securityUntil) {
      toast(`Security Forces turned the rival's ${def.name} away.`, "info");
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
  }

  function aiTick(now: number) {
    if (phase !== "play") return;
    if (now - lastAi < AI_BUILD_MS) return;
    lastAi = now;
    rivalRaid(now);
    rivalSabotage(now);
    const f = factoryOf("ai");
    if (!f) return;
    const pace = rivalPaceNow();      // VP-01: read once, used by three steps
    let acted = false;

    // 1. plant — the cheapest victory point on the board
    if (canAffordPlant(rival.purse)) {
      const spot = chooseAiPlantSpot(grid, track, eco, rival.id);
      if (spot && placePlant(spot[0], spot[1], rival)) acted = true;
    }

    // 2. depot — W3: the same cost model as the player's preview, allowance first
    const opts = {
      stock: rival.purse, purse: rival.purse,
      free: rival.freeTrack, freeDepots: rival.freeDepots, now,
      // VP-01: losing makes an Ore Mine worth more than a bigger farm, because
      // an Ore Mine is the only industry that prints points.
      oreUrgency: pace.oreUrgency,
    };
    const harvesterId = allocHarvesterId();
    const out = aiBuildStep(eco, f, opts, harvesterId);
    if (out) {
      rival.freeTrack = Math.max(0, rival.freeTrack - out.free);
      rival.freeDepots = Math.max(0, rival.freeDepots - out.freeDepots);
      spend(rival, out.spent);
      for (const [bx, by] of out.built) renderer?.invalidateTile(bx, by);
      acted = true;
    }

    // 3. pave — what the scoreboard pays for, with whatever Ore is spare; and
    //    when the Ore is not spare but the gravel is there, buy it (VP-01)
    if (rivalPavePass()) acted = true;
    else rivalBankTowardPave();

    if (acted) {
      syncWorld();
      rescoreNow();
      return;
    }
    // PP-07: nothing affordable at all — bank toward the plan it wants, then
    // take the turn if the trade unlocked it. Retry in one harvest tick, not
    // one build clock.
    rivalBankTowardPlan(f);
    const retry = aiBuildStep(eco, f, opts, allocHarvesterId());
    if (retry) {
      rival.freeTrack = Math.max(0, rival.freeTrack - retry.free);
      rival.freeDepots = Math.max(0, rival.freeDepots - retry.freeDepots);
      spend(rival, retry.spent);
      for (const [bx, by] of retry.built) renderer?.invalidateTile(bx, by);
    }
    const paved = rivalPavePass();
    if (retry || paved) {
      syncWorld();
      rescoreNow();
      lastAi = now - AI_BUILD_MS + AI_IDLE_MS;    // something happened: soon again
      return;
    }
    lastAi = now - AI_BUILD_MS + AI_IDLE_MS;       // idle: wake up after the next income tick
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
      pushPlan(items, planFactoryPlacement(grid, tx, ty, { requireTown: true }));
    } else if (tool === "harvester" || phase === "setup-harvester") {
      pushPlan(items, planDepotPlacement(grid, eco.harvesters, tx, ty));
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

  function paintUi(_now: number) {
    let banner: string | null = null;
    if (phase === "setup-factory") banner = "Place your Factory next to a town — click a buildable tile";
    // PP-05: the setup banner states the price too — the first Depot is free
    // on the allowance, and the player should know the second one is not.
    else if (phase === "setup-harvester") banner = "Place your Depot — it needs an industry in its 4×4 catchment" +
      (me.freeDepots > 0 ? ` (this one is free; later Depots cost ${costLabel(DEPOT_COST)})` : "");
    else if (phase === "won") banner = `${winner?.name} wins — ${fmtVp(vpFor(score, winner?.id ?? ""))}★`;
    else if (me.freeTrack > 0) banner = `${me.freeTrack} free track tiles remaining — connect your depot to your Factory`;
    else if (tool === "dirt") banner = `Dirt Road scores nothing — paving it later is worth ${fmtVp(VICTORY.upgrade)}★ a tile`;
    else if (Object.keys(quarry.reach).length === 0) banner = "Nothing connected — the Processing Plant only pays cargo your network reaches";
    else if (tool === "plant") banner = `Raise another processing plant next to a town — ${plantCostLabel()}`;
    else banner = "Match the tokened gems in the Processing Plant to process";

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
      ? planFactoryPlacement(grid, hover!.tx, hover!.ty, { requireTown: true })
      : placingDepot
        ? planDepotPlacement(grid, eco.harvesters, hover!.tx, hover!.ty)
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
          const inds = industriesInCatchment(grid, h);
          info = `<b>Depot</b> (${h.owner === "you" ? "yours" : "rival"})<br>` +
            `serving ${inds.length} industr${inds.length === 1 ? "y" : "ies"}<br>` +
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
        }
        const occ = grid.occupancy[hIdx];
        if (occ >= 0) {
          const ind: Industry = grid.industries[occ];
          const def = INDUSTRY_BY_KEY[ind.type];
          const servers = eco.harvesters.filter((h) =>
            industriesInCatchment(grid, h).some((i) => i.id === ind.id));
          info = `<b>${def?.name ?? ind.type}</b><br>` +
            `${CARGO[def.cargo].icon} ${CARGO[def.cargo].name} · output ${ind.output}<br>` +
            `${servers.length} depot${servers.length === 1 ? "" : "s"}`;
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
      })),
      purse: me.purse,
      phase,
      tool,
      freeTrack: me.freeTrack,
      freeDepots: me.freeDepots,
      banner,
      costInfo,
      inspect: info || null,
      inspectTone: infoTone,
      reach: quarry.reach,
    });
  }

  // A factory is one multi-tile sprite, but has one network anchor: its
  // origin tile. In track mode a click ANYWHERE on our factory must start at
  // that anchor; otherwise a click on its far tiles would start a road the
  // network cannot reach. Keep raw tile picking for other tools/structures.
  const pickForAction = (x: number, y: number) => {
    const p = renderer?.pick(x, y);
    if (!p || phase !== "play" || (tool !== "road" && tool !== "dirt")) return p;
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
    if (phase === "play" && isTrackTool && (!isMouse || e.button === 0) && e.isPrimary) {
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
        drag.ax, drag.ay, p.tx, p.ty, true, net, me.freeTrack);
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
      } else commitTrackDrag(me, preview, tool as TrackKind);
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
          placeFactory(p.tx, p.ty);
        } else if (phase === "setup-harvester") {
          // PP-05: the setup Depot is free because `me.freeDepots` is still 1 —
          // the allowance is data on the player record, not this phase.
          if (placeHarvester(p.tx, p.ty, me)) {
            phase = "play";
            lastHarvest = performance.now();
            lastAi = performance.now();
            toast("Now connect it to your Factory with a Dirt Road or a paved Road — then match the tokened gems in the Processing Plant.", "info");
          }
        } else if (phase === "play") {
          // PP-05: every Depot after the setup allowance pays DEPOT_COST.
          if (tool === "harvester") placeHarvester(p.tx, p.ty, me);
          else if (tool === "plant") placePlant(p.tx, p.ty, me);
          else if (tool === "demolish") doDemolish(p.tx, p.ty);
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

  /** Every cargo the given lorries deliver — the quarry's clock must skip them. */
  function truckCargos(list: Truck[], nowMs: number): Cargo[] {
    const out = new Set<Cargo>();
    for (const truck of list) {
      if (truck.ownerId !== ownerIdOf(eco, "you")) continue;
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
    if (phase !== "play") return;
    const mine = ownerIdOf(eco, "you");
    for (const truck of trucks.trucks) {
      if (truck.ownerId !== mine) continue;      // the rival's lorries feed no board
      const seen = seenDeliveries.get(truck.depotId) ?? 0;
      seenDeliveries.set(truck.depotId, truck.deliveries);
      if (truck.deliveries <= seen) continue;
      const due = Math.min(truck.deliveries - seen, MAX_CATCHUP);
      for (let i = 0; i < due; i++) deliverLoad(truck, t);
    }
  }

  /** One lorry-load of cargo: mint the token, then show what it was worth. */
  function deliverLoad(truck: Truck, t: number) {
    for (const cargo of depotCargos(truck.depotId, t)) {
      const tier = quarry.deliver(cargo);
      // A1: no token, no number. An empty lorry must not promise a gem the
      // board never received.
      if (!tier) continue;
      floats.add(
        `+${tier} ${CARGO[cargo].icon}`, truck.factory[0], truck.factory[1],
        { cls: "delivery", now: t },
      );
    }
  }

  // ── boot ───────────────────────────────────────────────────────────────
  let raf = 0;
  let disposed = false;

  const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej; img.src = src;
  });

  (async () => {
    const images = new Map<number, AtlasImage>();
    const [a05, a1, a2] = await Promise.all([load(atlas05), load(atlas1), load(atlas2)]);
    images.set(0.5, a05); images.set(1, a1); images.set(2, a2);
    const atlas = new Atlas(manifestJson as unknown as Manifest, images);
    buildMasks(atlas);
    if (disposed) return;

    atlasRef = atlas;
    renderer = new IsoRenderer(canvases, atlas, cam, world);
    debug?.attachRenderer();
    enableRenderLogOnBoot();
    resize();
    syncWorld();

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
      if (trucksDirty) {
        trucks.trucks = planTrucks(eco);
        trucksDirty = false;
        // A1: the lorries were re-planned, so the delivery counters restart
        // from zero — and so does the set of cargoes a lorry (rather than the
        // fallback clock) is responsible for.
        seenDeliveries.clear();
        quarry.setTruckServed(truckCargos(trucks.trucks, t));
        // a vanished truck must not linger as a ghost on the structures layer
        renderer?.setWorld(world);
      }
      tickTrucks(trucks, dt);
      collectDeliveries(t);
      world.vehicles = truckItems(trucks);
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
    /** VP-01: the target and the two numbers behind a player's total. */
    get vpTarget() { return VP_TARGET; },
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
    rivalBank: () => rivalBankTowardPave(),
    /** VP-01: the rival's read of the scoreboard and the four numbers that
     *  follow from it — exposed so a playtest (or a test) can ask WHY a turn
     *  was spent the way it was without re-deriving the policy. */
    get rivalPace() { return rivalPaceNow(); },
    get purse() { return me.purse; },
    get harvesters() { return eco.harvesters; },
    get factories() { return eco.factories; },
    get freeTrack() { return me.freeTrack; },
    grid, track, eco,
    // ── J1: the quarry join, exposed so the boot test can prove the loop ──
    get board() { return quarry.board; },
    get reach() { return quarry.reach; },
    quarry, market,
    /** A1: the rival's Processing Plant — where Black Market sabotage lands. */
    rivalPlant,
    /** A1: the map floats currently on screen (deliveries + sabotage marks). */
    floats,
    /** Refresh the reachable set now (spawn tokens for newly reached cargo). */
    refreshQuarry: (now = performance.now()) => quarry.refresh(now),
    /** The e2e twin of clicking two adjacent gems in the Quarry panel. */
    swap: (r1: number, c1: number, r2: number, c2: number) =>
      quarry.board.trySwap(r1, c1, r2, c2, performance.now()),
    setTool: (t: Tool) => { tool = t; },
    /** PP-06: the test twin of clicking with the Processing Plant tool. */
    placePlant: (tx: number, ty: number, who: "you" | "ai" = "you") =>
      placePlant(tx, ty, who === "ai" ? rival : me),
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
    placeFactory: (tx: number, ty: number) => placeFactory(tx, ty),
    /**
     * PP-05: the test twin of the Depot placement click — the real
     * `placeHarvester`, including the Oil cost, the free-setup allowance and
     * the "a refusal consumes nothing" ordering. Returns false when the site is
     * illegal OR the purse is short, exactly like the click does.
     */
    placeDepot: (tx: number, ty: number) => placeHarvester(tx, ty, me),
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
          ok: why === null && !taken && served.length > 0,
          why: why ?? (taken ? "harvester-taken" : served.length ? null : "no-industry-in-catchment"),
          industries: served.map((x) => x.id),
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
        // PP-02: the twin mirrors the live overlay — factory plans enforce the
        // town-adjacency rule exactly like the click handler.
        ? planFactoryPlacement(grid, tx, ty, { requireTown: true })
        : planDepotPlacement(grid, eco.harvesters, tx, ty),
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
    dragBuild: (kind: TrackKind, ax: number, ay: number, bx: number, by: number, xFirst = true): DragPreview | null => {
      if (phase !== "play") return null;
      const net = playerNetwork(track, me.i + 1, eco.factories, eco.harvesters);
      if (!canBuildOn(grid, kind, ax, ay, net)) return null;
      const pv = previewDrag(grid, track, kind, me.purse, ax, ay, bx, by, xFirst, net, me.freeTrack);
      if (pv.tiles.length === 0) return null;
      commitTrackDrag(me, pv, kind);
      return pv;
    },
    /**
     * PP-13: the e2e/unit twin of a demolish click — the same `doDemolish`
     * the pointer handler runs, so the road-salvage refund and the "that's a
     * public road" refusal are reachable from a test without a pixel path.
     */
    demolish: (tx: number, ty: number) => doDemolish(tx, ty),
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
    floats.clear();
    cancelAnimationFrame(raf);
    ro.disconnect();
    root.classList.remove("iso-game");
    root.innerHTML = "";
  };
}
