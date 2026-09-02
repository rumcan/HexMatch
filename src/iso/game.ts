// ─────────────────────────────────────────────────────────────────────────
// E8 / E9 — isometric game controller. Wires the grid, world, renderer and
// the quarry together; owns the guided setup (free Factory → free Harvester
// → fixed free-road budget). Free setup builds are flagged `{free:true}` at
// the data level so no affordability timer can ever revoke them (K1/E8).
// ─────────────────────────────────────────────────────────────────────────

import { generateGrid, IsoMap } from "./grid";
import { IsoWorld } from "./world";
import { IsoRenderer } from "./renderer";
import {
  Cargo, CARGO_KEYS,
  START_ROAD_BUDGET, TRANSPORT, Transport,
} from "./config";
import { Industry } from "./grid";

export type BuildTool = "road" | "rail" | "harvester" | "demolish";
export type SetupStep = "factory" | "harvester" | "connect" | "play";

export interface IsoState {
  map: IsoMap;
  world: IsoWorld;
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
  harvest: () => void;
  destroy: () => void;
}

export function createGame(canvas: HTMLCanvasElement, seed?: number): IsoGame {
  const map = generateGrid(seed ?? ((Date.now() & 0x7fffffff) >>> 0));
  const world = new IsoWorld(map, 1);
  const player = 0;
  const state: IsoState = {
    map, world, player,
    cargo: { grain: 0, wood: 0, ore: 0, stone: 12, oil: 0, gold: 0 },
    step: "factory",
    tool: "harvester",
    roadBudget: START_ROAD_BUDGET,
    free: true,
  };
  const renderer = new IsoRenderer(canvas, world);
  renderer.recentre();

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
      // free setup road: explicitly flagged free, never inferred from phase
      state.roadBudget -= n;
    } else if (canAfford(cost)) {
      pay(cost);
    } else {
      // charged only what was affordable — partial prefix (E5)
      let afford = 0;
      for (let i = n; i > 0; i--) {
        if (canAfford(costOf(kind, i))) { afford = i; break; }
      }
      // rebuild only the affordable prefix
      for (const t of tiles.slice(afford)) world.net.demolish(kind, t.x, t.y);
      pay(costOf(kind, afford));
      world.checkConnections();
    }
    world.checkConnections();
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
      if (world.net.has("road", tile.x, tile.y)) { world.net.demolish("road", tile.x, tile.y); world.checkConnections(); }
      if (world.net.has("rail", tile.x, tile.y)) { world.net.demolish("rail", tile.x, tile.y); world.checkConnections(); }
      onStateChange();
    }
  };

  // Place a harvester on the empty tile adjacent to the clicked industry that
  // (a) is grass, (b) touches the 4×4 catchment and (c) will be road-adjacent.
  function placeHarvesterNear(tx: number, ty: number) {
    // place on the first free, non-industry tile around the click whose
    // catchment overlaps an industry
    for (let y = ty - 1; y <= ty + 3; y++) {
      for (let x = tx - 1; x <= tx + 3; x++) {
        if (!inWorld(x, y)) continue;
        if (state.map.occup[y * state.map.w + x] !== -1) continue;
        if (world.net.has("road", x, y) || world.net.has("rail", x, y)) continue;
        const h = world.placeHarvester(player, x, y);
        if (h) {
          if (state.step === "harvester") state.step = "connect";
          state.tool = "road";
          onStateChange();
          return;
        }
      }
    }
  }

  function maybeFinishConnect() {
    // once the first harvester connects to the factory, setup ends
    if (state.step !== "connect") return;
    if (world.harvesters.length) {
      const st = world.connState.get(world.harvesters[0].id);
      if (st && (st.road || st.rail)) {
        state.step = "play";
        state.free = false;
      }
    }
  }

  function inWorld(x: number, y: number) {
    return x >= 0 && y >= 0 && x < map.w && y < map.h;
  }

  let onStateChange = () => {};
  let onSelectIndustry: ((ind: Industry) => void) | null = null;

  // harvest tick: connected industries feed the quarry pool (mapped to gems)
  function harvest() {
    const gained = world.playerResources(player, performance.now());
    for (const cargo of CARGO_KEYS) {
      const amt = gained[cargo] ?? 0;
      if (amt >= 1) {
        state.cargo[cargo] += Math.floor(amt);
      }
    }
  }
  const harvestTimer = window.setInterval(harvest, 20000);

  return {
    state,
    renderer,
    onStateChange: (fn: () => void) => { onStateChange = fn; },
    onSelectIndustry: (fn: (ind: Industry) => void) => { onSelectIndustry = fn; },
    setTool(t: BuildTool) { state.tool = t; renderer.buildKind = t; onStateChange(); },
    harvest,
    destroy() { window.clearInterval(harvestTimer); },
  };
}
