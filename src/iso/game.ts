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
  createGesture, pointerDown, pointerMove, pointerUp, isPanButton,
  type Camera, type GestureState,
} from "./camera";
import { IsoRenderer, type World } from "./renderer";
import { generateMap, resolveMapSeed, industryAt, type Grid, type Industry } from "./grid";
import {
  createTrack, drawBits, previewDrag, commitDrag, canBuildOn, hasTrack,
  demolishTile, tIdx, playerNetwork, canAfford,
  type Track, type TrackKind, type Purse, type DragPreview,
} from "./track";
import {
  createScoreState, rescore, vpFor, industriesInCatchment,
  playerResources, buildAllComponents, resolveConnection, catchmentRect,
  type EconomyState, type Harvester, type ScoreState, type VpEvent,
} from "./economy";
import { aiBuildStep } from "./ai";
import { createVehicleSystem, vehiclePos, type VehicleSystem } from "./vehicles";
import { CARGO, FACTORY_FOOTPRINT, INDUSTRY_BY_KEY, TRANSPORT, VP_TARGET, type Cargo } from "./config";
import {
  MAP_W, MAP_H, BANDIT_MS, BLOCK_MS, FOG_MS, SABOTAGE, SECURITY, type ResKey,
} from "../game/config";
import { createQuarry, GEM_TO_CARGO, type Quarry } from "./quarry";
import { createIsoMarket, toBag, type CargoBag, type IsoMarket } from "./market";
import { createOriginalUi, type OriginalUi } from "../game/ui";
import { joinFromSnapshot } from "./snapshot";
export { joinFromSnapshot };

// ── tuning (E8's rebalance surface, all in one place) ─────────────────────
export const FREE_SETUP_TRACK = 12;
export const HARVEST_MS = 3000;      // economy tick
export const AI_BUILD_MS = 9000;
/** E8: start with stone for roads, no ore — rail is gated behind an ore mine. */
export const START_PURSE: Purse = { stone: 12, ore: 0 };
export { VP_TARGET };

export type Tool = "road" | "rail" | "harvester" | "demolish";

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
  const score: ScoreState = createScoreState();

  const players: PlayerState[] = [
    { i: 0, id: "you", name: "You", colour: "#5aa8ff", purse: toBag(START_PURSE), human: true, freeTrack: FREE_SETUP_TRACK },
    { i: 1, id: "ai", name: "Rival", colour: "#ff7a5a", purse: toBag(START_PURSE), human: false, freeTrack: FREE_SETUP_TRACK },
  ];
  const me = players[0], rival = players[1];

  const eco: EconomyState = { grid, track, harvesters: [], factories: [] };
  // ── TK-004: buses shuttle depot ↔ plant over the owner's own track. The
  // hook here is the TK-007 seam — arrival AT THE PLANT is the physical event
  // the Processing Plant's token spawn will hang off (W-tickets). Until then
  // the counter is exposed on __iso for tests.
  const vehicles: VehicleSystem = createVehicleSystem({
    onArrival: (_v, now) => { vehicleArrivals++; lastArrivalAt = now; },
  });
  let vehicleArrivals = 0;
  let lastArrivalAt = -1e9;
  let staticExtra: NonNullable<typeof world.extra> = [];
  let nextHarvesterId = 1;
  let phase: Phase = "setup-factory";
  let tool: Tool = "road";
  let winner: PlayerState | null = null;
  /** U1: Blockade waits for the player to click an industry. */
  let blackMode: string | null = null;

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
      toast("Quarry collapsed. Fresh neutral board.", "info");
    },
    onBlackAction: (key) => buyBlack(key),
    onCancelModal: () => { blackMode = null; ui.setBanditMode(false); },
  });
  onBoardChange = () => ui.renderBoard();
  root.appendChild(ui.el);

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
    railBits: drawBits(track, "rail"),
    extra: [],
  };

  // Start the camera somewhere with industries in view.
  const focus = grid.industries[0] ?? { tx: MAP_W / 2, ty: MAP_H / 2 };
  let cam: Camera = centerOnTile(
    createCamera(stage.clientWidth || 800, stage.clientHeight || 600),
    focus.tx, focus.ty,
  );

  let renderer: IsoRenderer | null = null;
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

  const syncWorld = () => {
    world.roadBits = drawBits(track, "road");
    world.railBits = drawBits(track, "rail");
    staticExtra = [
      ...eco.factories.map((f) => ({
        sprite: f.owner === "you" ? "factory_blue" : "factory_red",
        tx: f.tx, ty: f.ty, ref: { kind: "factory", owner: f.owner },
      })),
      ...eco.harvesters.map((h) => ({
        sprite: h.owner === "you" ? "depot_blue" : "depot_red",
        tx: h.tx, ty: h.ty, ref: { kind: "harvester", id: h.id, owner: h.owner },
      })),
    ];
    // TK-004: routes are rebuilt here — exactly when the track changed — not
    // per frame.
    vehicles.sync(eco, "you");
    world.extra = staticExtra;
    renderer?.setWorld(world);
  };

  const applyVpEvents = (events: VpEvent[]) => {
    for (const e of events) {
      const h = eco.harvesters.find((x) => x.id === e.harvester);
      const owner = h?.owner ?? score.owners.get(e.harvester);
      if (owner !== "you") continue;
      if (e.type === "awarded") toast(`Connected by ${e.to} — +${e.delta} VP`, "good");
      else if (e.type === "revoked") toast(`Connection broken — ${e.delta} VP`, "bad");
      else if (e.type === "upgraded") toast(`Upgraded to rail — +${e.delta} VP`, "good");
      else if (e.type === "downgraded") toast(`Rail broken, fell back to road — ${e.delta} VP`, "bad");
    }
  };

  const rescoreNow = () => {
    applyVpEvents(rescore(eco, score));
    if (phase === "play") {
      for (const p of players) {
        if (vpFor(score, p.id) >= VP_TARGET) {
          phase = "won"; winner = p;
          toast(`${p.name} reached ${VP_TARGET} VP!`, p.human ? "good" : "bad");
        }
      }
    }
    // J1: the network just changed. Recompute what the quarry may pay and
    // spawn tokens for cargo that became reachable — no waiting for the 20s
    // clock, because "I connected it and nothing happened" is how this join
    // would look broken.
    quarry.refresh(performance.now());
  };

  // ── actions ────────────────────────────────────────────────────────────
  function placeFactory(tx: number, ty: number): boolean {
    if (!canBuildOn(grid, "road", tx, ty)) { toast("Can't build there.", "bad"); return false; }
    // W2: the factory carries its builder's track-owner id (player index + 1).
    eco.factories.push({ owner: "you", ownerId: me.i + 1, tx, ty });
    // Give the rival a factory a good distance away, on legal ground.
    let best: [number, number] | null = null, bestD = -1;
    for (let y = 2; y < MAP_H - 2; y += 2) {
      for (let x = 2; x < MAP_W - 2; x += 2) {
        if (!canBuildOn(grid, "road", x, y)) continue;
        const d = Math.abs(x - tx) + Math.abs(y - ty);
        if (d > bestD) { bestD = d; best = [x, y]; }
      }
    }
    if (best) eco.factories.push({ owner: "ai", ownerId: rival.i + 1, tx: best[0], ty: best[1] });
    phase = "setup-harvester";
    syncWorld();
    toast("Factory placed. Now place your first harvester beside an industry.", "info");
    return true;
  }

  function placeHarvester(tx: number, ty: number, p: PlayerState, _free: boolean): boolean {
    if (!canBuildOn(grid, "road", tx, ty)) { toast("Can't build there.", "bad"); return false; }
    if (eco.harvesters.some((h) => h.tx === tx && h.ty === ty)) {
      toast("A harvester is already there.", "bad"); return false;
    }
    const h: Harvester = { id: nextHarvesterId++, owner: p.id, ownerId: p.i + 1, tx, ty };
    if (!industriesInCatchment(grid, h).length) {
      toast("A harvester needs an industry in its 4×4 catchment.", "bad");
      return false;
    }
    // G5: harvesters seed the network; they no longer need existing track.
    eco.harvesters.push(h);
    syncWorld();
    rescoreNow();
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
      toast("Harvester removed.", "info");
      return;
    }
    let removed = false;
    // W2: the tool only tears down track YOU built. Your demolish can never
    // cut the rival's line (and vice-versa) — "no implicit sharing" applies
    // to destruction, not just travel.
    const mine = track.owner[tIdx(tx, ty)] === me.i + 1;
    for (const kind of ["rail", "road"] as TrackKind[]) {
      if (mine && hasTrack(track, kind, tx, ty)) { demolishTile(track, kind, tx, ty); removed = true; break; }
    }
    if (!removed) { toast("Nothing to demolish there.", "bad"); return; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy;
      if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) renderer?.invalidateTile(x, y);
    }
    syncWorld();
    rescoreNow();
  }

  // ── Black Market (U1 wiring over the restored board + industry blockade) ──
  const REPAIR_ISO_COST: Purse = { wood: 1, stone: 1, grain: 1, ore: 1 };

  function buyBlack(key: string) {
    const now = performance.now();
    const spendGold = (n: number) => {
      if ((me.purse.gold ?? 0) < n) { toast(`Needs ${n} Gold.`, "bad"); return false; }
      spend(me, { gold: n });
      return true;
    };
    if (key === "bandit") {
      if (!spendGold(SABOTAGE.bandit.gold)) return;
      blackMode = "bandit";
      ui.setBanditMode(true);
      toast("Click an industry to place the Blockade (45s).", "info");
      return;
    }
    if (key === "harden") {
      if (!spendGold(SABOTAGE.harden.gold)) return;
      quarry.board.harden();
      toast("Frost Tiles: 7 gems frozen.", "good");
      return;
    }
    if (key === "block") {
      if (!spendGold(SABOTAGE.block.gold)) return;
      quarry.board.dropBlocks(4, BLOCK_MS, now);
      toast("Iron Girders dropped on the quarry.", "good");
      return;
    }
    if (key === "fog") {
      if (!spendGold(SABOTAGE.fog.gold)) return;
      quarry.board.fog(FOG_MS, now);
      toast("Smog Cloud: no swaps for 30s.", "good");
      return;
    }
    if (key === "security") {
      if (!spendGold(SECURITY.gold)) return;
      toast("Security Forces hired (defensive in this build).", "info");
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
    const y = playerResources(eco, rival.id, now);
    const gain: Purse = {};
    for (const [cargo, v] of Object.entries(y) as [Cargo, number][]) {
      const n = Math.max(0, Math.round(v));
      if (n > 0) gain[cargo] = n;
    }
    if (Object.keys(gain).length) earn(rival, gain);
    // blockades expire on a clock, so the reachable set is re-read here too
    quarry.refresh(now);
  }

  /** Per frame: board effects, the 20s token spawn, and the market clock. */
  function quarryTick(now: number) {
    market.tick(now);
    if (phase !== "play") return;
    quarry.tick(now);
  }

  function aiTick(now: number) {
    if (phase !== "play") return;
    if (now - lastAi < AI_BUILD_MS) return;
    lastAi = now;
    const f = factoryOf("ai");
    if (!f) return;
    // W3: the rival plans with the SAME cost model as the player — its free
    // setup allowance first, then its purse. (W2's ownership change is what
    // un-sticks it: the rival no longer "sees" itself as connected across
    // the player's road, so it actually decides to build.)
    const out = aiBuildStep(eco, f,
      { stock: rival.purse, purse: rival.purse, free: rival.freeTrack }, nextHarvesterId);
    if (!out) return;
    nextHarvesterId++;
    rival.freeTrack = Math.max(0, rival.freeTrack - out.free);
    spend(rival, out.spent);
    for (const [bx, by] of out.built) renderer?.invalidateTile(bx, by);
    syncWorld();
    rescoreNow();
  }

  // ── rendering ──────────────────────────────────────────────────────────
  const overlayItems = () => {
    const items: { sprite: string; tx: number; ty: number }[] = [];
    if (preview) {
      for (const [x, y] of preview.tiles) items.push({ sprite: "highlight", tx: x, ty: y });
    } else if (hover) {
      if (phase === "setup-factory") {
        // U2/V1: highlight the factory's REAL footprint (one diamond — the
        // sprite is a single declared building, see FACTORY_FOOTPRINT) so the
        // build preview matches exactly the tiles the building covers.
        for (let dy = 0; dy < FACTORY_FOOTPRINT[1]; dy++) {
          for (let dx = 0; dx < FACTORY_FOOTPRINT[0]; dx++) {
            const x = hover.tx + dx, y = hover.ty + dy;
            if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
            items.push({ sprite: "highlight", tx: x, ty: y });
          }
        }
      } else if (tool === "harvester" || phase === "setup-harvester") {
        // U2: the harvester is a 1×1 building. Its 4×4 catchment is
        // informational, so the placed tile is the solid glow and the
        // catchment uses the fainter highlight_soft tint.
        items.push({ sprite: "highlight", tx: hover.tx, ty: hover.ty });
        const r = catchmentRect(hover.tx, hover.ty);
        for (let y = r.y0; y <= r.y1; y++) {
          for (let x = r.x0; x <= r.x1; x++) {
            if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
            if (x === hover.tx && y === hover.ty) continue;
            items.push({ sprite: "highlight_soft", tx: x, ty: y });
          }
        }
      } else {
        items.push({ sprite: "highlight", tx: hover.tx, ty: hover.ty });
      }
    }
    return items;
  };

  function paintUi(_now: number) {
    let banner: string | null = null;
    if (phase === "setup-factory") banner = "Place your Factory — click a buildable tile";
    else if (phase === "setup-harvester") banner = "Place your Harvester — it needs an industry in its 4×4 catchment";
    else if (phase === "won") banner = `${winner?.name} wins with ${vpFor(score, winner?.id ?? "")} VP`;
    else if (me.freeTrack > 0) banner = `${me.freeTrack} free track tiles remaining — connect your harvester to your Factory`;
    else if (Object.keys(quarry.reach).length === 0) banner = "Nothing connected — the Quarry only pays cargo your network reaches";
    else banner = "Match the tokened gems in the Quarry to harvest";

    let costInfo: string | null = null;
    if (blackMode === "bandit") {
      costInfo = `<span class="mb-txt">Click an industry to set the Blockade</span><span class="mb-cost">${SABOTAGE.bandit.gold}🪙</span>`;
    } else if (preview) {
      // W1: the label shows the preview's OWN numbers — the charge is
      // `preview.cost` and the free count is `preview.free`, exactly what the
      // commit will do.
      const parts = Object.entries(preview.cost).map(([k, v]) => `${v} ${k}`);
      const n = preview.tiles.length;
      const label = parts.length ? parts.join(" + ")
        : (preview.free > 0 ? "free (setup)" : "free");
      costInfo = `<span class="mb-txt"><b>${n}</b> tiles · ${label}</span>` +
        (preview.truncated ? ` · <i>blocked</i>` : "") +
        `<span class="mb-cost">${TRANSPORT[tool === "rail" ? "rail" : "road"].vp} VP</span>`;
    }

    // industry / harvester inspector
    let info = "";
    const ref = hover?.ref as { kind?: string; id?: number } | null;
    if (ref && ref.kind === "harvester") {
      const h = eco.harvesters.find((x) => x.id === ref.id);
      if (h) {
        // W2: the inspector resolves the connection over THIS harvester's
        // own network, not the merged graph.
        const comp = buildAllComponents(track, h.ownerId);
        const conn = resolveConnection(eco, comp, h);
        const inds = industriesInCatchment(grid, h);
        info = `<b>Harvester</b> (${h.owner === "you" ? "yours" : "rival"})<br>` +
          `serving ${inds.length} industr${inds.length === 1 ? "y" : "ies"}<br>` +
          `link: ${conn.kind ?? "<i>none</i>"} ×${conn.multiplier || 0}`;
      }
    } else if (hover) {
      const occ = grid.occupancy[tIdx(hover.tx, hover.ty)];
      if (occ >= 0) {
        const ind: Industry = grid.industries[occ];
        const def = INDUSTRY_BY_KEY[ind.type];
        const servers = eco.harvesters.filter((h) =>
          industriesInCatchment(grid, h).some((i) => i.id === ind.id));
        info = `<b>${def?.name ?? ind.type}</b><br>` +
          `${CARGO[def.cargo].icon} ${CARGO[def.cargo].name} · output ${ind.output}<br>` +
          `${servers.length} harvester${servers.length === 1 ? "" : "s"}`;
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
      banner,
      costInfo,
      inspect: info || null,
      reach: quarry.reach,
    });
  }

  // ── input ──────────────────────────────────────────────────────────────
  // TK-001: the buttons have disjoint jobs. LEFT mouse = building placement
  // (track drags, factory/harvester clicks, blockades, demolish) and nothing
  // else; MIDDLE mouse = map panning; wheel = zoom. Touch/pen keep the
  // one-finger pan + two-finger pinch (no middle button there). `downBtn`
  // remembers which button went down so a stray middle CLICK can never place
  // a building on pointerup.
  let g: GestureState = createGesture();
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const pos = (e: PointerEvent): [number, number] => {
    const b = stage.getBoundingClientRect();
    return [(e.clientX - b.left) * dpr(), (e.clientY - b.top) * dpr()];
  };
  let downAt: [number, number] | null = null;
  let downBtn: number | null = null;
  let moved = false;

  // Start/hold the pan gesture for panning pointers only (TK-001).
  const beginPan = (e: PointerEvent, x: number, y: number) => {
    if (!isPanButton(e.pointerType, e.button)) return;
    // middle-click autoscroll is the browser's, not ours
    e.preventDefault();
    g = pointerDown(g, { id: e.pointerId, x, y });
  };

  canvases.overlay.addEventListener("pointerdown", (e) => {
    canvases.overlay.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    downAt = [x, y]; downBtn = e.button; moved = false;
    const p = renderer?.pick(x, y);
    if (!p) { beginPan(e, x, y); return; }
    const isTrackTool = tool === "road" || tool === "rail";
    // W2: a drag extends YOUR network only — the rival's road is not a
    // seed you can grow from. TK-001: track drags are a LEFT-button
    // building action; middle-drag must pan instead.
    if (phase === "play" && isTrackTool && e.isPrimary && e.button === 0) {
      const net = playerNetwork(track, me.i + 1, eco.factories, eco.harvesters);
      if (canBuildOn(grid, tool as TrackKind, p.tx, p.ty, net)) {
        drag = { ax: p.tx, ay: p.ty };
        return;
      }
    }
    beginPan(e, x, y);
  });

  canvases.overlay.addEventListener("pointermove", (e) => {
    const [x, y] = pos(e);
    if (downAt && (Math.abs(x - downAt[0]) > 4 || Math.abs(y - downAt[1]) > 4)) moved = true;
    const p = renderer?.pick(x, y);
    if (p) hover = { tx: p.tx, ty: p.ty, ref: p.ref };
    if (drag && p) {
      const kind = tool === "rail" ? "rail" : "road";
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
      if (preview.tiles.length === 0) toast("Track must extend your network.", "bad");
      else commitTrackDrag(me, preview, tool === "rail" ? "rail" : "road");
      drag = null; preview = null; downAt = null;
      g = pointerUp(g, e.pointerId);
      return;
    }
    drag = null; preview = null;

    // TK-001: only a LEFT-button click places buildings — the middle button
    // is the pan binding, so even a motionless middle click must not build.
    if (!moved && downBtn === 0) {
      const p = renderer?.pick(x, y);
      if (p) {
        if (phase === "play" && blackMode === "bandit") {
          const ind = industryAt(grid, p.tx, p.ty);
          if (ind) {
            ind.banditUntil = performance.now() + BANDIT_MS;
            blackMode = null;
            ui.setBanditMode(false);
            const def = INDUSTRY_BY_KEY[ind.type];
            toast(`Blockade set on ${def?.name ?? ind.type} for ${BANDIT_MS / 1000}s.`, "good");
          } else {
            toast("Click an industry to place the Blockade.", "bad");
          }
        } else if (phase === "setup-factory") {
          placeFactory(p.tx, p.ty);
        } else if (phase === "setup-harvester") {
          if (placeHarvester(p.tx, p.ty, me, true)) {
            phase = "play";
            lastHarvest = performance.now();
            lastAi = performance.now();
            toast("Now connect it to your Factory with road or rail — then match the tokened gems in the Quarry.", "info");
          }
        } else if (phase === "play") {
          if (tool === "harvester") placeHarvester(p.tx, p.ty, me, false);
          else if (tool === "demolish") doDemolish(p.tx, p.ty);
        }
      }
    }
    downAt = null;
    downBtn = null;
    g = pointerUp(g, e.pointerId);
  };
  canvases.overlay.addEventListener("pointerup", onUp);
  canvases.overlay.addEventListener("pointercancel", (e) => {
    drag = null; preview = null; downAt = null; downBtn = null; g = pointerUp(g, e.pointerId);
  });
  // TK-001: the overlay is not a scroll surface — kill middle-click autoscroll
  // at the mouse-event layer too (a cancelled pointerdown already suppresses
  // the compatibility mousedown in Chromium; this covers other engines).
  canvases.overlay.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  canvases.overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x, y] = pos(e as unknown as PointerEvent);
    cam = zoomStepAt(cam, e.deltaY < 0 ? +1 : -1, x, y);
    renderer?.setCamera(cam);
  }, { passive: false });

  window.addEventListener("keydown", (e) => {
    const map: Record<string, Tool> = { "1": "road", "2": "rail", "3": "harvester", "4": "demolish" };
    if (map[e.key]) tool = map[e.key];
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

    renderer = new IsoRenderer(canvases, atlas, cam, world);
    resize();
    syncWorld();

    let lastFrame = 0;
    const frame = (t: number) => {
      if (disposed) return;
      const dt = lastFrame ? Math.min(100, t - lastFrame) : 0;
      lastFrame = t;
      economyTick(t);
      quarryTick(t);
      aiTick(t);
      // ── TK-004: advance + draw the shuttling buses (free-floating DrawItems
      // with absolute world positions; the depth sort interleaves them with
      // the buildings they drive past). Route sync happens in syncWorld().
      if (vehicles.vehicles.length) {
        vehicles.tick(t, dt);
        const moving = vehicles.vehicles.map((v) => {
          const { wx, wy, axis } = vehiclePos(v);
          return {
            sprite: axis === "/" ? "vehicle_bus_side" : "vehicle_bus_end",
            tx: v.path[v.leg][0], ty: v.path[v.leg][1],
            wx, wy,
            // the sheet's side view faces the SW travel direction; mirror it
            // for the NE leg so the bus never drives backwards
            flipX: axis === "/" && v.dir === -1,
            ref: { kind: "vehicle", id: v.id },
          };
        });
        world.extra = [...staticExtra, ...moving];
      }
      renderer!.render(t, overlayItems());
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
    get purse() { return me.purse; },
    get harvesters() { return eco.harvesters; },
    get factories() { return eco.factories; },
    get freeTrack() { return me.freeTrack; },
    /** TK-004: the bus fleet and cumulative plant arrivals (the TK-007 seam). */
    get vehicles() { return vehicles; },
    get vehicleArrivals() { return vehicleArrivals; },
    get lastArrivalAt() { return lastArrivalAt; },
    grid, track, eco,
    // ── J1: the quarry join, exposed so the boot test can prove the loop ──
    get board() { return quarry.board; },
    get reach() { return quarry.reach; },
    quarry, market,
    /** Refresh the reachable set now (spawn tokens for newly reached cargo). */
    refreshQuarry: (now = performance.now()) => quarry.refresh(now),
    /** The e2e twin of clicking two adjacent gems in the Quarry panel. */
    swap: (r1: number, c1: number, r2: number, c2: number) =>
      quarry.board.trySwap(r1, c1, r2, c2, performance.now()),
    setTool: (t: Tool) => { tool = t; },
    /** V4: the e2e/unit twin of the HUD toast, so tests can drive the toast
     *  stack (and its ✕) without playing a whole round. */
    toast: (text: string, kind: Toast["kind"] = "info") => toast(text, kind),
    /** Screen position (device px, live camera) of a tile's top vertex — the
     *  e2e twin of __hex.view.screenPosOf. Read-only. */
    tileScreenAt: (tx: number, ty: number) => tileToScreenAt(cam, tx, ty),
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
  };

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    root.classList.remove("iso-game");
    root.innerHTML = "";
  };
}
