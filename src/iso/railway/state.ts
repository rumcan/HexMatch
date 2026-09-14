// @ts-nocheck
// ══════════════════════════════════════════════════════════════════════════
// Railways v1 — State, costs and platform scoring (task 1/8 foundation)
// Defines RailwayState with stable IDs, ownership and occupancy layers.
// ══════════════════════════════════════════════════════════════════════════
import { MAP_W, MAP_H } from "../../game/config";
import { BUILD_COSTS, VICTORY, type Cargo } from "../config";
import { PRESENT } from "../track";

export const RAIL_PRESENT = PRESENT;
export const PLATFORM_VP = VICTORY.platform;

export type RailOrientation = 0 | 1 | 2 | 3;

export interface RailPlatform {
  id: number;
  owner: string;
  ownerId: number;
  tx: number;
  ty: number;
  rotation: RailOrientation;
  /** Anchor assignment: industry id or owned plant id */
  anchor: { kind: "industry"; id: number } | { kind: "plant"; id: number };
  /** Stable name for UI */
  name?: string;
}

export interface TrainDepot {
  id: number;
  owner: string;
  ownerId: number;
  tx: number;
  ty: number;
  rotation: RailOrientation;
}

export type TrainState = "stored" | "departing" | "moving" | "dwelling" | "returning" | "blocked";

export interface Train {
  id: number;
  owner: string;
  ownerId: number;
  depotId: number;
  lineId: number | null;
  state: TrainState;
  /** Has the train reached its source platform since departure? */
  hasReachedSource: boolean;
  /** Platform dwell countdown etc. (ms) */
  dwellUntil?: number;
  /** Current rail path for movement (tile indices) */
  path?: number[];
  /** Progress along path (0..path.length-1 fractional) */
  progress?: number;
  /** Blocked reason for UI */
  blockedReason?: string;
}

export interface RailLine {
  id: number;
  owner: string;
  ownerId: number;
  name: string;
  sourcePlatformId: number; // industry-anchored
  destPlatformId: number;   // plant-anchored
  trainId: number | null;   // assigned train
}

export interface RailwayState {
  /** Rail track layer: direction bits + PRESENT (separate from road layers) */
  rail: Uint8Array;
  /** Per-tile rail owner (0 = none, else player index+1) */
  railOwner: Uint8Array;
  /** Monotonic revision for cache invalidation (graph, quarry refresh) */
  railRevision: number;
  platforms: RailPlatform[];
  depots: TrainDepot[];
  lines: RailLine[];
  trains: Train[];
  nextPlatformId: number;
  nextDepotId: number;
  nextLineId: number;
  nextTrainId: number;
}

export const createRailwayState = (): RailwayState => ({
  rail: new Uint8Array(MAP_W * MAP_H),
  railOwner: new Uint8Array(MAP_W * MAP_H),
  railRevision: 0,
  platforms: [],
  depots: [],
  lines: [],
  trains: [],
  nextPlatformId: 1,
  nextDepotId: 1,
  nextLineId: 1,
  nextTrainId: 1,
});

// ── Costs (authoritative BUILD_COSTS aliases) ───────────────────────────
export const RAIL_COST: Partial<Record<Cargo, number>> = BUILD_COSTS.rail;
export const PLATFORM_COST: Partial<Record<Cargo, number>> = BUILD_COSTS.platform;
export const TRAIN_DEPOT_COST: Partial<Record<Cargo, number>> = BUILD_COSTS.trainDepot;
export const TRAIN_COST: Partial<Record<Cargo, number>> = BUILD_COSTS.train;

export function platformRefund(): Partial<Record<Cargo, number>> {
  const out: Partial<Record<Cargo, number>> = {};
  for (const [k, v] of Object.entries(PLATFORM_COST) as [Cargo, number][]) out[k] = Math.floor(v / 2);
  return out;
}
export function trainDepotRefund(): Partial<Record<Cargo, number>> {
  const out: Partial<Record<Cargo, number>> = {};
  for (const [k, v] of Object.entries(TRAIN_DEPOT_COST) as [Cargo, number][]) out[k] = Math.floor(v / 2);
  return out;
}
export function trainRefund(): Partial<Record<Cargo, number>> {
  const out: Partial<Record<Cargo, number>> = {};
  for (const [k, v] of Object.entries(TRAIN_COST) as [Cargo, number][]) out[k] = Math.floor(v / 2);
  return out;
}
export function railRefund(): Partial<Record<Cargo, number>> {
  const out: Partial<Record<Cargo, number>> = {};
  for (const [k, v] of Object.entries(RAIL_COST) as [Cargo, number][]) out[k] = Math.floor(v / 2);
  return out;
}

// ── Helpers ───────────────────────────────────────────────────────────────
export const tIdx = (tx: number, ty: number) => ty * MAP_W + tx;
export const inMapRail = (tx: number, ty: number) => tx >= 0 && tx < MAP_W && ty >= 0 && ty < MAP_H;

export function cloneRailwayState(src: RailwayState): RailwayState {
  return {
    rail: new Uint8Array(src.rail),
    railOwner: new Uint8Array(src.railOwner),
    railRevision: src.railRevision,
    platforms: src.platforms.map(p => ({ ...p, anchor: { ...p.anchor } })),
    depots: src.depots.map(d => ({ ...d })),
    lines: src.lines.map(l => ({ ...l })),
    trains: src.trains.map(t => ({ ...t, path: t.path ? [...t.path] : undefined })),
    nextPlatformId: src.nextPlatformId,
    nextDepotId: src.nextDepotId,
    nextLineId: src.nextLineId,
    nextTrainId: src.nextTrainId,
  };
}
