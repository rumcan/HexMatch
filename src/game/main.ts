import {
  UPGRADE_EVERY, RAID_EVERY, TAX_EVERY_ROUNDS, RES, ResKey, RES_KEYS, SABOTAGE, SECURITY,
  COSTS, REPAIR_COST, choice, setRng, mulberry32,
} from "./config";
import { G, bus, makePlayer, Player } from "./state";
import {
  generateMap, playerResources, canBuildSettlement, canBuildRoad, canBuildCity,
  tollRoadOwner,
} from "./hexmap";
import { MapView } from "../map3d/MapView3D";
import { Board } from "./board";
import {
  doRoad, doSettlement, doCity, doCapital, doTollRoad, grantStartRails, buySecurity,
  placeBandit, applySabotage, canAfford, gainRes, findLegalSettlement,
} from "./actions";
import { postOffer, acceptOffer, cancelOffer, tickMarket, bankTrade } from "./trade";
import { aiTick } from "./ai";
import * as UI from "./ui";

const PLAYER_DEFS = [
  { name: "You", human: true, color: "#39b6ff" },
  { name: "Krag Steelworks", human: false, color: "#e0503a" },
  { name: "Vex Industries", human: false, color: "#c05cff" },
  { name: "Torvin & Sons", human: false, color: "#4ecb6e" },
];

let view: MapView;
let board: Board;
let raf = 0;

// Ticket #10: legality only depends on (mode, map ownership/buildings), not on
// the clock. We recompute only when something could have changed those inputs.
let legalityDirty = true;
export function markLegalityDirty() { legalityDirty = true; }

// Test hook (ticket #3): expose live game state when the page is opened with
// ?hexhook=1 (Playwright) or built under the test env flag. Lets e2e assert on
// view.legalEdges / phase / resources without scraping pixels.
function installTestHook() {
  const on =
    (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("hexhook")) ||
    (import.meta as any).env?.VITEST === true ||
    (import.meta as any).env?.DEV;
  if (!on || typeof window === "undefined") return;
  (window as any).__hex = {
    G,
    get view() { return view; },
    get board() { return board; },
    // helpers for tests
    setMode(m: string | null) { bus.emit("build:mode", m); },
    pick(hit: { kind: string; id: number } | null) { handlePick(hit); },
  };
}

export function startGame(container: HTMLElement) {
  // players
  G.players = PLAYER_DEFS.map((d, i) => makePlayer(i, d.name, d.human, d.color));
  // A fixed seed (via ?seed=123) makes the whole run reproducible for tests.
  const seedParam =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("seed")
      : null;
  const seed = seedParam ? (Number(seedParam) >>> 0) : undefined;
  // Seed the game RNG too, so AI timing/decisions and board fills are
  // reproducible in tests; normal play keeps a fresh random stream.
  if (seed !== undefined) setRng(mulberry32(seed ^ 0x5eed5));
  else setRng(Math.random);
  G.map = generateMap(seed);
  G.seed = seed ?? null;
  G.offers = []; G.offerSeq = 1; G.won = false; G.running = true;
  G.setupPhase = true; G.buildMode = null; G.pendingSabotage = null; G.upgradeTimer = 0;
  G.access = {};
  G.raidTimer = RAID_EVERY;

  board = new Board();
  G.board = board;
  board.onHarvest = (res, amt) => { gainRes(G.players[0], res, amt); };
  board.onGold = (n) => { gainRes(G.players[0], "gold", n); };
  board.onFx = (t, r, c, txt) => UI.fx(t, r, c, txt);
  board.onChange = () => UI.renderBoard();
  board.onPopup = (g, l) => UI.popup(g, l);
  // combo bank: every 2 combos mints a wild gold coin on the board
  board.onCombo = (count, need, granted) => {
    if (granted) UI.toast("Combo bonus — a gold coin appeared in your quarry!", "success");
    UI.setComboBank(count, need);
  };

  UI.buildDOM(container);
  view = new MapView(UI.getCanvas(), G.map);
  G.view = view;
  view.fit();
  view.onPick = handlePick;

  // AI get a capital + start rails + one free factory (bootstrap)
  for (let i = 1; i < G.players.length; i++) {
    const ai = G.players[i];
    doCapital(ai, findLegalSettlement(ai, true));
    grantStartRails(ai, 2);
    const fv = findLegalSettlement(ai, false);
    if (fv >= 0) doSettlement(ai, fv, true);
  }

  wireBus();
  installTestHook();

  // human setup — place Capital, then pick 2 starting rails yourself
  G.setupPhase = true;
  G.setupStep = 0;   // 0 = capital, 1 = rail #1, 2 = rail #2
  legalityDirty = true;
  updateSetupPrompt();

  UI.renderHUD();
  UI.renderKingdoms();
  UI.renderBuild();
  UI.renderSabotage();
  UI.renderMarket();
  UI.renderFeed();
  UI.renderBoard();
  UI.helpModal();

  bus.emit("log", { who: 0, text: "Establish your HQ to launch your empire." });

  let last = performance.now();
  let acc = 0;
  const frame = (now: number) => {
    const dt = Math.min(100, now - last); last = now;
    if (G.running && !G.won) {
      if (!G.setupPhase) {
        G.upgradeTimer += dt;
        if (G.upgradeTimer >= UPGRADE_EVERY) {
          G.upgradeTimer = 0;
          board.spawnTokens(G.access);
          G.taxRound = (G.taxRound || 0) + 1;
          if (G.taxRound >= TAX_EVERY_ROUNDS) { G.taxRound = 0; taxman(); }
        }
      }
      if (!G.setupPhase) {
        aiTick(now, dt);
        tickMarket(now);
        board.tickEffects(now);
        G.raidTimer -= dt;
        if (G.raidTimer <= 0) { G.raidTimer = RAID_EVERY; banditRaid(); }
      }
      acc += dt;
      if (acc > 1000) {
        acc = 0;
        // if you can no longer afford the armed build, deselect it.
        // NEVER during setup: setup builds (capital, rails) are free and the
        // player has 0 resources, so the affordability check would instantly
        // strip the guided markers (ticket #1).
        if (!G.setupPhase) {
          const me = G.players[0] as Player;
          if (G.buildMode && G.buildMode !== "toll" && G.buildMode !== "bandit"
              && COSTS[G.buildMode] && !canAfford(me, COSTS[G.buildMode].cost)) {
            clearMode();
          }
        }
        UI.renderMarket(); UI.renderHUD(); UI.renderKingdoms(); UI.renderSabotage(); UI.renderBuild();
      }
    }
    UI.setUpgradeBar(G.setupPhase ? 0 : G.upgradeTimer / UPGRADE_EVERY);
    UI.renderQuarry(now);
    if (legalityDirty) { legalityDirty = false; computeLegality(); }
    view.draw(now, G.players);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// Smugglers raid whoever hoards the most of one resource, every 2 minutes.
function banditRaid() {
  const res = choice(RES_KEYS);
  let victim: Player | null = null;
  let max = 0;
  for (const p of G.players as Player[]) {
    if (p.res[res] > max) { max = p.res[res]; victim = p; }
  }
  if (!victim || max < 2) return; // nothing worth stealing
  const stolen = Math.min(victim.res[res], Math.max(2, Math.floor(max / 2)));
  victim.res[res] -= stolen;
  const txt = `📦 Smugglers raided ${victim.name}, stealing ${stolen}${RES[res].icon} ${RES[res].name}!`;
  bus.emit("log", { who: victim.i, text: txt });
  if (victim.human) UI.toast(`Smugglers stole ${stolen} ${RES[res].name} from you!`, "danger");
  else UI.toast(`Smugglers raided ${victim.name}'s ${RES[res].name} stockpile.`, "info");
  UI.renderHUD(); UI.renderKingdoms();
}

// The Taxman bleeds the RICHEST tycoon every few resource rounds: they lose
// half their total goods. The human chooses which; AIs lose half of each.
function taxman() {
  const total = (p: Player) => RES_KEYS.reduce((s, k) => s + p.res[k], 0);
  let victim: Player | null = null, max = -1;
  for (const p of G.players as Player[]) { const t = total(p); if (t > max) { max = t; victim = p; } }
  if (!victim || max < 8) return; // not worth taxing
  const amount = Math.floor(max / 2);
  if (victim.human) {
    UI.taxModal(victim, amount, () => { UI.renderHUD(); UI.renderKingdoms(); });
    UI.toast(`💼 The Taxman cometh! Surrender ${amount} goods.`, "danger");
    bus.emit("log", { who: victim.i, text: `The Taxman demanded ${amount} goods from you.` });
  } else {
    for (const k of RES_KEYS) victim.res[k] = Math.ceil(victim.res[k] / 2);
    bus.emit("log", { who: victim.i, text: `The Taxman bled ${victim.name} for half their goods.` });
    UI.toast(`The Taxman hit ${victim.name} — the market leader!`, "info");
    UI.renderHUD(); UI.renderKingdoms();
  }
}

function recomputePool() {
  // `access` = what your map buildings let you HARVEST (drives the 20s token spawn).
  G.access = playerResources(G.map, G.players[0], performance.now());
  // The spawn pool is the 5 RESOURCE colours (never gold). Gold coins are wild
  // and appear ONLY via the once-per-round spawn — never falling from the top.
  board.pool = RES_KEYS.filter((k) => k !== "gold");
}

function updateSetupPrompt() {
  if (G.setupStep === 0) {
    G.buildMode = "capital";
    view.mode = "capital";
    UI.showBanner(`<b>Establish your Headquarters</b><br><small>The heart of your empire — all rails must trace back to it. Click a glowing node.</small>`);
    UI.showModeBar("capital");
  } else {
    G.buildMode = "road";
    view.mode = "road";
    const n = G.setupStep === 1 ? "first" : "second";
    UI.showBanner(`<b>Lay your ${n} Rail</b><br><small>Pick a glowing border connected to your network. It's free.</small>`);
    UI.showModeBar("road");
  }
  UI.renderBuild();
  markLegalityDirty();
}

function endSetup() {
  G.setupPhase = false;
  G.buildMode = null;
  view.mode = null;
  markLegalityDirty();
  UI.showBanner(null);
  UI.showModeBar(null);
  recomputePool();
  board.initFill();
  board.spawnTokens(G.access);
  UI.renderBoard();
  UI.renderBuild();
  UI.toast("HQ established! Build rails outward, then factories. Rivals now stir.", "success");
  bus.emit("log", { who: 0, text: "The race to dominate the market begins!" });
}

function clearMode() {
  // Setup is a guided flow: the mode is owned by updateSetupPrompt() and must
  // never be cleared by Escape, auto-deselect, or a re-click (ticket #1).
  if (G.setupPhase) return;
  G.buildMode = null;
  G.pendingSabotage = null;
  view.mode = null;
  markLegalityDirty();
  UI.showModeBar(null);
  UI.renderBuild();
  UI.renderSabotage();
  UI.renderKingdoms();
}

function handlePick(hit: { kind: string; id: number } | null) {
  if (!hit) return;
  const p = G.players[0] as Player;
  const mode = G.buildMode;

  if (mode === "bandit" && hit.kind === "tile") {
    if (placeBandit(p, hit.id)) {
      UI.toast("Blockade set! That district is picketed.", "success");
      bus.emit("log", { who: 0, text: "You set up a Blockade." });
      clearMode();
    } else UI.toast("Not enough Gold for a Blockade.", "danger");
    return;
  }
  if (mode === "capital" && hit.kind === "vertex" && G.setupPhase) {
    if (doCapital(p, hit.id)) {
      recomputePool();
      G.setupStep = 1;
      updateSetupPrompt();
      UI.renderHUD(); UI.renderKingdoms();
    } else UI.toast("Too close to another building — pick another node.", "danger");
    return;
  }
  if (mode === "toll" && hit.kind === "edge") {
    const owner = tollRoadOwner(G.map, p, hit.id);
    if (owner < 0) { UI.toast("Click a rival's own rail that touches your network.", "danger"); return; }
    const rival = G.players[owner] as Player;
    if (doTollRoad(p, hit.id)) {
      UI.toast(`Toll paid to ${rival.name}! You may now build along their rails.`, "success");
      bus.emit("log", { who: 0, text: `You paid a toll to ${rival.name} for rail passage.` });
      recomputePool();
      clearMode(); UI.renderHUD(); UI.renderKingdoms();
    } else UI.toast("Toll failed.", "danger");
    return;
  }
  if (mode === "road" && hit.kind === "edge") {
    if (G.setupPhase) {
      if (!canBuildRoad(G.map, p, hit.id)) { UI.toast("Pick a border connected to your network.", "danger"); return; }
      if (doRoad(p, hit.id, true)) {   // free during setup
        G.setupStep++;
        recomputePool();
        UI.renderHUD(); UI.renderKingdoms();
        if (G.setupStep >= 3) endSetup(); else updateSetupPrompt();
      }
      return;
    }
    if (canBuildRoad(G.map, p, hit.id)) {
      if (doRoad(p, hit.id)) { UI.renderHUD(); UI.renderBuild(); } // stays armed
      else UI.toast("Not enough resources for a Rail.", "danger");
    } else UI.toast("Rails must connect to your network (back to your HQ).", "danger");
    return;
  }
  if (mode === "settlement" && hit.kind === "vertex") {
    if (!canBuildSettlement(G.map, p, hit.id, false)) {
      const v = G.map.verts[hit.id];
      if (v.building) UI.toast("That node is taken.", "danger");
      else UI.toast("Must connect to your rail network, and not be next to another building.", "danger");
      return;
    }
    if (doSettlement(p, hit.id)) {
      UI.toast("Factory built! +1★", "success");
      bus.emit("log", { who: 0, text: "You built a Factory." });
      recomputePool();
      clearMode(); UI.renderHUD(); UI.renderKingdoms();
    } else UI.toast("Not enough resources.", "danger");
    return;
  }
  if (mode === "city" && hit.kind === "vertex") {
    if (!canBuildCity(G.map, p, hit.id)) { UI.toast("Upgrade one of your own factories.", "danger"); return; }
    if (doCity(p, hit.id)) {
      UI.toast("Foundry raised! +2★", "success");
      bus.emit("log", { who: 0, text: "You raised a Foundry." });
      recomputePool();
      clearMode(); UI.renderHUD(); UI.renderKingdoms();
    } else UI.toast("Not enough resources (2🌾 3⚙️).", "danger");
    return;
  }
  if (!mode && hit.kind === "tile") UI.tileInfo(hit.id);
}

function computeLegality() {
  const p = G.players[0] as Player;
  view.legalVerts.clear(); view.legalEdges.clear();
  const m = view.mode;
  if (m === "capital") {
    G.map.verts.forEach((v: any) => { if (canBuildSettlement(G.map, p, v.i, true)) view.legalVerts.add(v.i); });
  } else if (m === "road") {
    G.map.edges.forEach((e: any) => { if (canBuildRoad(G.map, p, e.i)) view.legalEdges.add(e.i); });
  } else if (m === "toll") {
    G.map.edges.forEach((e: any) => { if (tollRoadOwner(G.map, p, e.i) >= 0) view.legalEdges.add(e.i); });
  } else if (m === "settlement") {
    G.map.verts.forEach((v: any) => { if (canBuildSettlement(G.map, p, v.i, false)) view.legalVerts.add(v.i); });
  } else if (m === "city") {
    p.settlements.forEach((v: number) => view.legalVerts.add(v));
  }
}

function wireBus() {
  bus.on("build:mode", (mode: string | null) => {
    if (G.setupPhase) {
      // can't cancel or change mode mid-setup; just re-show the guided prompt
      updateSetupPrompt();
      return;
    }
    if (mode === null) { clearMode(); return; }
    G.pendingSabotage = null;
    if (G.buildMode === mode) { clearMode(); return; }
    const p = G.players[0] as Player;
    // can't afford → don't select, just report exactly what's missing
    if (mode !== "toll" && !canAfford(p, COSTS[mode].cost)) {
      const cost = COSTS[mode].cost;
      const missing = (Object.keys(cost) as ResKey[])
        .filter((k) => p.res[k] < (cost[k] ?? 0))
        .map((k) => `${(cost[k] ?? 0) - p.res[k]} more ${RES[k].name}`)
        .join(", ");
      UI.toast(`Can't build ${COSTS[mode].label} — need ${missing}.`, "danger");
      return;
    }
    G.buildMode = mode; view.mode = mode;
    markLegalityDirty();
    UI.showModeBar(mode); UI.renderBuild(); UI.renderSabotage(); UI.renderKingdoms();
  });

  bus.on("sabotage:buy", (key: string) => {
    const p = G.players[0] as Player;
    if (p.res.gold < SABOTAGE[key].gold) { UI.toast(`Need ${SABOTAGE[key].gold} Gold.`, "danger"); return; }
    if (key === "bandit") {
      G.buildMode = "bandit"; G.pendingSabotage = null; view.mode = null;
      markLegalityDirty();
      UI.showModeBar("bandit"); UI.renderSabotage();
    } else {
      G.pendingSabotage = key; G.buildMode = null; view.mode = null;
      markLegalityDirty();
      UI.showModeBar(null);
      UI.toast(`${SABOTAGE[key].name} armed — click a rival kingdom to strike.`, "info");
      UI.renderSabotage(); UI.renderKingdoms();
    }
    UI.renderBuild();
  });

  bus.on("player:click", (idx: number) => {
    const key = G.pendingSabotage;
    if (!key) return;
    const victim = G.players[idx] as Player;
    if (applySabotage(G.players[0], key, victim)) {
      UI.toast(`${SABOTAGE[key].name} unleashed on ${victim.name}!`, "success");
      bus.emit("log", { who: 0, text: `You used ${SABOTAGE[key].name} on ${victim.name}.` });
    } else UI.toast("Sabotage failed.", "danger");
    G.pendingSabotage = null;
    UI.renderHUD(); UI.renderKingdoms(); UI.renderSabotage();
  });

  bus.on("offer:create", (d: any) => {
    if (postOffer(G.players[0], d.give, d.giveN, d.want, d.wantN)) {
      UI.toast("Offer posted to the market.", "success");
    } else UI.toast("Can't post that offer (goods, duplicate, or 3-offer limit).", "danger");
    UI.renderMarket(); UI.renderHUD();
  });
  bus.on("offer:accept", (id: number) => {
    if (acceptOffer(G.players[0], id)) UI.toast("Trade complete!", "success");
    else UI.toast("Offer already taken or unaffordable.", "danger");
    UI.renderMarket(); UI.renderHUD();
  });
  bus.on("offer:cancel", (d: any) => {
    if (typeof d === "number") cancelOffer(G.players[0], d);
    UI.renderMarket(); UI.renderHUD();
  });
  // AI/expiry-driven market changes → just refresh the panels (no re-posting!)
  bus.on("market:changed", () => { UI.renderMarket(); UI.renderHUD(); });

  bus.on("bank:trade", (d: any) => {
    const p = G.players[0] as Player;
    if (d.give === d.want) { UI.toast("Pick two different resources.", "danger"); return; }
    if (bankTrade(p, d.give, d.want)) {
      UI.toast(`Banked 4 ${RES[d.give as ResKey].name} → 1 ${RES[d.want as ResKey].name}.`, "success");
      UI.renderHUD();
    } else UI.toast(`Need 4 ${RES[d.give as ResKey].name} to bank.`, "danger");
  });

  bus.on("security:buy", () => {
    const p = G.players[0] as Player;
    if (p.securedUntil > performance.now()) { UI.toast("Security is already active.", "info"); return; }
    if (buySecurity(p)) {
      UI.toast(`Security Forces hired for ${Math.round(SECURITY.ms / 1000)}s — immune to Blockade & Smog.`, "success");
      bus.emit("log", { who: 0, text: "You hired Security Forces." });
      UI.renderHUD(); UI.renderSabotage();
    } else UI.toast(`Need ${SECURITY.gold} Gold for Security.`, "danger");
  });

  bus.on("repair:buy", () => {
    const p = G.players[0] as Player;
    if (!canAfford(p, REPAIR_COST)) { UI.toast(`Need ${Object.keys(REPAIR_COST).map((k) => REPAIR_COST[k as ResKey] + RES[k as ResKey].icon).join(" ")}.`, "danger"); return; }
    const n = board.smashBlocks();
    if (n === 0) { UI.toast("Nothing to repair — no blocks or frost.", "info"); return; }
    for (const k of Object.keys(REPAIR_COST) as ResKey[]) p.res[k] -= REPAIR_COST[k] ?? 0;
    UI.toast(`Repair crew cleared ${n} obstacle${n > 1 ? "s" : ""}!`, "success");
    bus.emit("log", { who: 0, text: `You dispatched a repair crew (${n} obstacles cleared).` });
    UI.renderHUD(); UI.renderSabotage();
  });

  bus.on("fit", () => view.fit());

  bus.on("build", (d: any) => {
    if (d?.p?.human) recomputePool();
    // roads/capitals/factories change reachability and the legal sets
    if (d?.kind !== "toll") markLegalityDirty();
    UI.renderHUD(); UI.renderKingdoms();
  });
  bus.on("sabotage", (d: any) => {
    if (d?.key === "bandit") recomputePool();
    UI.renderHUD(); UI.renderKingdoms();
  });
  bus.on("win", (p: Player) => { G.won = true; G.running = false; UI.winModal(p); });
  bus.on("board:reset", () => {
    if (G.setupPhase || G.won) return;
    const p = G.players[0] as Player;
    UI.confirmModal(
      "Collapse the Quarry?",
      "You will lose <b>ALL</b> your resources and get a fresh board of blank neutral gems. Use this only when you're truly stuck.",
      () => {
        for (const k of RES_KEYS) p.res[k] = 0;
        board.resetNeutral();
        UI.renderHUD();
        UI.toast("Quarry collapsed. Fresh neutral board — start matching!", "info");
        bus.emit("log", { who: 0, text: "You collapsed your quarry for a fresh start." });
      });
  });
  bus.on("toast", (d: any) => UI.toast(d.text, d.kind || "info"));
  bus.on("toll", (d: any) => {
    if (d?.owner?.human) UI.toast(`${d.payer.name} paid you a rail toll!`, "success");
    UI.renderHUD(); UI.renderKingdoms();
  });

  window.addEventListener("keydown", (e) => {
    if (G.setupPhase) return;
    if (e.key === "1") bus.emit("build:mode", "road");
    else if (e.key === "2") bus.emit("build:mode", "settlement");
    else if (e.key === "3") bus.emit("build:mode", "city");
    else if (e.key === "4") bus.emit("build:mode", "toll");
    else if (e.key === "Escape") clearMode();
  });
}