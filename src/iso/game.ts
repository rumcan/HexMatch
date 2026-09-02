// ─────────────────────────────────────────────────────────────────────────
// E8 / E9 + quarry loop — isometric game controller. Wires the grid, world,
// renderer and the match-3 quarry together; owns the guided setup (free
// Factory → free Harvester → fixed free-road budget). Free setup builds are
// flagged at the data level (`state.free` / roadBudget) so no affordability
// timer can ever revoke them (K1/E8).
//
// The economy loop: connected industries mint TIERED gems into the quarry
// (world.accessTiers → quarry.spawnTokens every SPROUT_EVERY); the player
// matches gems to mine cargo (quarry.onHarvest → state.cargo), which is spent
// on road/rail. Cargo is ONLY earned by matching.
// ─────────────────────────────────────────────────────────────────────────

import { generateGrid, IsoMap, Industry } from "./grid";
import { IsoWorld } from "./world";
import { IsoRenderer } from "./renderer";
import { Quarry } from "./quarry";
import {
  Cargo, START_ROAD_BUDGET, TRANSPORT, Transport, SPROUT_EVERY,
} from "./config";

export type BuildTool = "road" | "rail" | "harvester" | "demolish";
export type SetupStep = "factory" | "harvester" | "connect" | "play";

export interface IsoState {
  map: IsoMap;
  world: IsoWorld;
  quarry: Quarry;
  player: number;
  cargo: Record<Cargo, number>;
  step: SetupStep;
  tool: BuildTool;
  roadBudget: number;       // remaining free setup roads
  free: boolean;            // true while setup builds are free (data-level flag)
}

export interface IsoGame {
  state: IsoState;
  renderer: IsoRenderer;
  onStateChange: (fn: () => void) => void;
  onSelectIndustry: (fn: (ind: Industry) => void) => void;
  setTool: (t: BuildTool) => void;
  swapQuarry: (r1: number, c1: number, r2: number, c2: number) => Promise<Partial<Record<Cargo, number>>>;
  sprout: () => void;
  destroy: () => void;
}

export function createGame(canvas: HTMLCanvasElement, seed?: number): IsoGame {
  const map = generateGrid(seed ?? ((Date.now() & 0x7fffffff) >>> 0));
  const world = new IsoWorld(map, 1);
  const quarry = new Quarry();
  const player = 0;
  const state: IsoState = {
    map, world, quarry, player,
    // a little stone so the first paid road after the free budget isn't a
    // dead-end; the quarry mints the rest as you match.
    cargo: { grain: 0, wood: 0, ore: 0, stone: 12, oil: 0, gold: 0 },
    step: "factory",
    tool: "harvester",
    roadBudget: START_ROAD_BUDGET,
    free: true,
  };
  const renderer = new IsoRenderer(canvas, world);
  renderer.recentre();

  // matching a network gem mines cargo into the warehouse (spent on builds)
  quarry.onHarvest = (cargo, amount) => { state.cargo[cargo] += amount; onStateChange(); };
  quarry.onChange = () => onStateChange();
  quarry.onCombo = () => onStateChange();

  const costOf = (kind: Transport, n: number): Partial<Record<Cargo, number>> => {
    const cost: Partial<Record<Cargo, number>> = {};
    for (const [k, v] of Object.entries(TRANSPORT[kind].cost) as [Cargo, number][]) {
      cost[k] = (v ?? 0) * n;
    }
    return cost;
  };
  const canAfford = (cost: Partial<Record<Cargo, number>>) =>
    Object.entries(cost).every(([k, v]) => state.cargo[k as Cargo] >= (v ?? 0));
  const pay = (cost: Partial<Record<Cargo, number>>) =>
    Object.entries(cost).forEach(([k, v]) => { state.cargo[k as Cargo] -= v ?? 0; });

  renderer.onBuildCommit = (kind, tiles) => {
    const n = tiles.length;
    if (n === 0) return;
    const cost = costOf(kind, n);
    if (state.free && kind === "road" && state.roadBudget >= n) {
      // free setup road: explicitly free, never inferred from phase
      state.roadBudget -= n;
    } else if (canAfford(cost)) {
      pay(cost);
    } else {
      // build only the affordable prefix (E5), refund the rest
      let afford = 0;
      for (let i = n; i > 0; i--) {
        if (canAfford(costOf(kind, i))) { afford = i; break; }
      }
      for (const t of tiles.slice(afford)) world.net.demolish(kind, t.x, t.y);
      pay(costOf(kind, afford));
      world.checkConnections();
    }
    world.checkConnections();
    refreshAccess();
    maybeFinishConnect();
    onStateChange();
  };

  renderer.onPick = (hit) => {
    if (!hit) return;
    const tile = hit.kind === "terrain" && hit.tx !== undefined && hit.ty !== undefined
      ? { x: hit.tx, y: hit.ty } : null;
    if (state.step === "factory" && tile) {
      if (world.placeFactory(player, tile.x, tile.y)) {
        state.step = "harvester";
        state.tool = "harvester";
        onStateChange();
      }
      return;
    }
    if (hit.kind === "industry") {
      const ind = state.map.industries[hit.id];
      return onSelectIndustry?.(ind);
    }
    if (state.tool === "harvester" && tile) {
      placeHarvesterNear(tile.x, tile.y);
      return;
    }
    if (state.tool === "demolish" && tile) {
      if (world.net.has("road", tile.x, tile.y)) { world.net.demolish("road", tile.x, tile.y); }
      if (world.net.has("rail", tile.x, tile.y)) { world.net.demolish("rail", tile.x, tile.y); }
      world.checkConnections();
      refreshAccess();
      onStateChange();
    }
  };

  // Place a harvester on the first free, non-industry tile near the click
  // whose 4×4 catchment overlaps an industry.
  function placeHarvesterNear(tx: number, ty: number) {
    for (let y = ty - 1; y <= ty + 3; y++) {
      for (let x = tx - 1; x <= tx + 3; x++) {
        if (!inWorld(x, y)) continue;
        if (state.map.occup[y * state.map.w + x] !== -1) continue;
        if (world.net.has("road", x, y) || world.net.has("rail", x, y)) continue;
        const h = world.placeHarvester(player, x, y);
        if (h) {
          if (state.step === "harvester") state.step = "connect";
          state.tool = "road";
          refreshAccess();
          onStateChange();
          return;
        }
      }
    }
  }

  function maybeFinishConnect() {
    if (state.step !== "connect") return;
    if (world.harvesters.length) {
      const st = world.connState.get(world.harvesters[0].id);
      if (st && (st.road || st.rail)) {
        state.step = "play";
        state.free = false;
        sprout(); // first network gems land immediately on completion
      }
    }
  }

  function inWorld(x: number, y: number) {
    return x >= 0 && y >= 0 && x < map.w && y < map.h;
  }

  // The quarry's spawn pool is the cargoes the connected network harvests,
  // with tier from the connection type (rail=2, road=1).
  function refreshAccess() {
    const tiers = world.accessTiers(player, performance.now());
    quarry.pool = (Object.keys(tiers) as Cargo[]).filter((c) => c !== "gold");
    return tiers;
  }

  // SPROUT: connected industries mint tiered gems into the quarry.
  function sprout() {
    if (state.step === "factory" || state.step === "harvester") return;
    const tiers = world.accessTiers(player, performance.now());
    quarry.spawnTokens(tiers);
    onStateChange();
  }

  // UI swaps two adjacent gems; matches mine cargo via onHarvest.
  const swapQuarry: IsoGame["swapQuarry"] = (r1, c1, r2, c2) =>
    quarry.trySwap(r1, c1, r2, c2, performance.now()).then((gains) => {
      refreshAccess();
      onStateChange();
      return gains;
    });

  let onStateChange = () => {};
  let onSelectIndustry: ((ind: Industry) => void) | null = null;

  const sproutTimer = window.setInterval(sprout, SPROUT_EVERY);

  return {
    state,
    renderer,
    onStateChange: (fn: () => void) => { onStateChange = fn; },
    onSelectIndustry: (fn: (ind: Industry) => void) => { onSelectIndustry = fn; },
    setTool(t: BuildTool) { state.tool = t; renderer.buildKind = t; onStateChange(); },
    swapQuarry,
    sprout,
    destroy() { window.clearInterval(sproutTimer); },
  };
}
