// ══════════════════════════════════════════════════════════════════════════
// AI-03 — single-player save/restore, the runtime shell around `game.ts`.
//
// L15 (#230): the redesign is now the only loop. Saves from the old loop
// (v1 / snap 15 / protocol 9) are refused with a clear toast — "This save is
// from an older version — start a new game" — and the slot is left alone so
// the message is honest when read. The version is 3 / snap 17 — boards removed.
//
// TOWN-4.1 (#677): snap 18 makes the map SIZE a per-game option. A save
// records it in its `map` record (`map.size`, absent = standard), and a snap
// 17 save — written before the option existed — is a 144×144 map whose track
// bytes are exactly what snap 18 writes for one, so it still loads (at 144):
// see SAVE_SNAP_VERSIONS.
//
// The shape is deliberately boring: one JSON payload in localStorage, written
// every few seconds and on pagehide, read once at boot. The map itself is
// seed-derived (`generateMap(seed)`) so only MUTABLE state travels — the
// track layers (base64), the two players' purses and free allowances, the
// factories/harvesters, the industry's mutation fields, both boards (they
// serialise themselves: gem grid + pools + effect clocks as REMAINING ms),
// and the few live clocks the rival runs on. Everything else is either pure
// (scaffolding, overlays) or re-derivable (VP from the track, `planTrucks`
// after the next syncWorld, quarry reach/clocks on the next refresh).
//
// L1e (#236) adds the new loop's own state to that list: the flag the save was
// played under (`loop`) and the income remainders its clock had banked but not
// yet paid (`loopCarry`). Depot yield levels need no field of their own — they
// ride `eco.harvesters`, the records they belong to.
// ══════════════════════════════════════════════════════════════════════════
import type { Cargo } from "./config";
import { MAP_SIZES } from "../game/config";
import { readMapSize, type MapSizeName, type TownLayout } from "../net/match-settings";
import type { Track } from "./track";
import type { EconomyState } from "./economy";
import {
  SNAPSHOT_VERSION, bytesToBase64, base64ToBytes, type RailWire,
} from "./snapshot";
import type { DamWire } from "./dams";

export const SAVE_KEY = "hexmatch:save";
export const SAVEGAME_VERSION = 3;
export const OLD_SAVE_TOAST = "This save is from an older version — start a new game";

/**
 * TOWN-4.1 (#677): the snapshot versions whose saves this build loads. The
 * current one, and 17 — the last version before the map size was an option:
 * every snap 17 save is a standard (144×144) map with byte-identical track
 * layers, so bumping the WIRE version must not refuse it (the protocol.ts
 * v9 note: "a bump there would refuse every existing single-player save").
 * The next bump that keeps saves loadable adds the outgoing version here;
 * one that genuinely moves the seeded map leaves it out.
 */
export const SAVE_SNAP_VERSIONS: readonly number[] = [17, SNAPSHOT_VERSION];

const snapVersionLoads = (snapV: unknown): boolean =>
  typeof snapV === "number" && SAVE_SNAP_VERSIONS.includes(snapV);

export interface SavedBoardShape { kind: string; data: unknown }

export interface SaveGamePayload {
  v: number;
  snapV: number;
  savedAt: number;
  seed: number;
  /** MAP-1 (#412): the map features this save was generated with. Absent in
   *  saves made before MAP-1 (those maps were all-OFF). `diag` (#440) is
   *  optional for the same reason one layer down: a save written before the
   *  45° road rule carries no key, and `readMapOptions` reads a missing key as
   *  OFF — so it resumes axis-only, exactly as it was played. */
  map?: {
    rivers: boolean; elevation: boolean; shapes: boolean; rings?: boolean; diag?: boolean;
    /** TOWN-2 (#653): the street plan; absent = "grid" (a pre-TOWN-2 save). */
    layout?: TownLayout;
    /** TOWN-4.1 (#677): the map size; absent = "standard" (every save before it). */
    size?: MapSizeName;
  };
  skillKey: string;
  phase: string;
  winnerId: string | null;
  story?: {
    playerSabotage: number;
    rivalSabotage: number;
    winningSource: "platform" | "type" | "rung" | "city" | "route" | "level" | "upgrade" | "plant" | "hold" | null;
    oilBanterSeen?: boolean;
  };
  bandit: Record<number, number>;
  protests?: { x: number; y: number; left: number; owner: string }[];
  /**
   * B5 (#250): the map's battle layer — the industries a conquest took
   * (`industryId → holder harvester id`) and the cooldown clocks as ms LEFT
   * (the `protests.left` rule). Absent from a pre-B5 save — the loader then
   * reads an un-fought map, which is exactly what that save was.
   */
  battle?: {
    locks: [number, number][];
    readyAt: [string, number][];
    playerReadyAt: [string, number][];
    rivalDueIn: number;
    battles: number;
    siteRights?: [number, { rights: string[]; streak: { playerId: string; wins: number } | null }][];
    townHolds?: [number, { holder: string; wins: number; locked: boolean }][];
  };
  track: { dirt: string; road: string; owner: string; upgraded: string; tier?: string };
  rail?: RailWire;
  /**
   * #456 Level Ground — the edited heights, the way map options ride: flat
   * `[x, y, level]` triples for every tile that differs from the seed-derived
   * map (the map regenerates from `seed`; only the terraforming travels).
   * Absent in a pre-#456 save — the loader then reads the unlevelled island,
   * which is exactly what that save was taken from.
   */
  heightEdits?: number[];
  /**
   * R3 (#270): the standing hydro dams, in the snapshot's own wire shape
   * (the map regenerates the sites from the seed; ownership + bank lean
   * travel). Absent from a pre-dam save — the loader reads an undammed map,
   * which is exactly the map that save was taken from.
   */
  dams?: DamWire[];
  loop?: boolean;
  loopCarry?: Record<string, number>;
  /**
   * L17 (#245): the towns' visual tiers, in map order (`Town.level`, the same
   * clamp `setTownLevel` applies). Absent from a pre-L17 save — the loader
   * then re-derives the tiers from the seats' `townLevel`, so a save taken
   * mid-growth still reloads with the map it was saved from.
   */
  towns?: number[];
  /**
   * L8 (#222): the optional quests' own state — the panel that was on screen,
   * what has been paid, what the player dismissed or hid. The quest DEFS are
   * data re-derived from the restored map, so only ids and choices travel; a
   * reload must not be able to re-earn a reward (the paid set is the proof).
   * CONTRACT-1 (#466): town contracts replace Quests — same shape plus active
   * contracts with progress and deadlines.
   */
  quests?: {
    offers?: string[];
    spent?: string[];
    paid?: string[];
    hidden?: boolean;
  };
  contracts?: {
    offers?: string[];
    active?: {
      def: {
        id: string;
        kind: "private" | "tender";
        cargo: string;
        amount: number;
        townId: number;
        townName: string;
        rewardMoney: number;
        rewardTown: number;
        deadlineMs: number;
        speaker: string;
      };
      acceptedAt: number;
      expiresAt: number;
      delivered: number;
      owner: number;
      status: "active" | "completed" | "expired" | "lost";
    }[];
    spent?: string[];
    paid?: string[];
    hidden?: boolean;
  };
  eco: {
    harvesters: EconomyState["harvesters"];
    factories: EconomyState["factories"];
  };
  players: {
    purse: Record<string, number>; freeTrack: number; freeDepots: number;
    depotTier?: number; townLevel?: number; townBonus?: number;
    /** ECON-1 (#421): the seat's money. Absent in a pre-money save. */
    money?: number;
    /** CAST-1: the seat's manager (legacy "vex"/"you" map). Absent pre-CAST. */
    manager?: string | null;
    /** CAST-1: Rafael's free Black Market allowance. */
    fixer?: { window: number; used: number };
    /** BM-2: remaining milliseconds; rebased to the new match clock on restore. */
    blackMarket?: import("./black-market").BlackMarketState;
  }[];
  clearedFields?: number[];
  /** 2026-09: conquest mode — no ★ line, play until a player is bankrupt. */
  conquest?: boolean;
  /** 2026-09: per-city tiers — [townId, owner, level, bonus]. */
  cities?: [number, string, number, number][];
  clocks: Record<string, number>;
}

const trackSave = (track: Track): SaveGamePayload["track"] => ({
  dirt: bytesToBase64(track.dirt), road: bytesToBase64(track.road),
  owner: bytesToBase64(track.owner), upgraded: bytesToBase64(track.upgraded),
  // ROADS-2 (#393): road tiers (absent in older saves → all Road).
  ...(track.tier && track.tier.some((v) => v !== 0) ? { tier: bytesToBase64(track.tier) } : {}),
});

function trackRestored(track: Track, w: SaveGamePayload["track"]): void {
  track.dirt.set(base64ToBytes(w.dirt));
  track.road.set(base64ToBytes(w.road));
  track.owner.set(base64ToBytes(w.owner));
  track.upgraded.set(base64ToBytes(w.upgraded));
  if (!track.tier) track.tier = new Uint8Array(track.road.length);
  track.tier.fill(0);
  if (w.tier) track.tier.set(base64ToBytes(w.tier));
  track.revision++;
}

export const saveKeyFor = (storyChapterId?: string | null): string =>
  storyChapterId ? `${SAVE_KEY}:story:${storyChapterId}` : SAVE_KEY;

/**
 * PROG-1 (#475): a scenario match's own slot. Scenarios save beside the
 * sandbox and the contracts — never inside either — so a scenario match can
 * neither clobber nor resume another mode's game.
 */
export const SCENARIO_SAVE_KEY_PREFIX = `${SAVE_KEY}:scenario:`;

export const scenarioSaveKey = (scenarioId: string): string =>
  `${SCENARIO_SAVE_KEY_PREFIX}${scenarioId}`;

export const readSave = (key: string = SAVE_KEY): SaveGamePayload | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveGamePayload;
    if (d.v !== SAVEGAME_VERSION || !snapVersionLoads(d.snapV)) return null;
    if (typeof d.seed !== "number" || !d.track) return null;
    return d;
  } catch { return null; }
};

export function readRawSave(key: string = SAVE_KEY): SaveGamePayload | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as SaveGamePayload;
  } catch { return null; }
}

export function isOldSave(raw: SaveGamePayload | null): boolean {
  if (!raw) return false;
  return raw.v !== SAVEGAME_VERSION || !snapVersionLoads(raw.snapV);
}

/**
 * TOWN-4.1 (#677): the side, in tiles, of the map a save was played on — its
 * own record's `map.size` (absent = standard: every save written before the
 * option). null for a size name this build has no table entry for (a save
 * from a newer build): such a save cannot be regenerated here.
 */
export function saveMapSide(d: { map?: unknown } | null | undefined): number | null {
  const rec = d?.map;
  const raw = rec && typeof rec === "object" ? (rec as Record<string, unknown>).size : undefined;
  if (raw === undefined) return MAP_SIZES.standard;
  const name = readMapSize(raw);
  return name ? MAP_SIZES[name] : null;
}

/**
 * TOWN-4.1 (#677): do the save's layers fit the map its own record names?
 * Every track (and rail) layer that is present and non-empty must be exactly
 * side² bytes. A save that fails was written by a build whose size table
 * differs (or was edited by hand) — restoring it would stamp its bytes into a
 * different-sized track, every row misaligned, so the boot refuses it with
 * the old-save toast instead (and leaves the slot alone). An empty or absent
 * layer is nothing to misplace, so it passes.
 */
export function saveFitsItsMap(d: SaveGamePayload | null | undefined): boolean {
  if (!d) return true;
  const side = saveMapSide(d);
  if (side === null) return false;
  const want = side * side;
  const layers: unknown[] = [];
  if (d.track && typeof d.track === "object") {
    const t = d.track as Record<string, unknown>;
    layers.push(t.dirt, t.road, t.owner, t.upgraded, t.tier);
  }
  if (d.rail && typeof d.rail === "object") {
    const r = d.rail as unknown as Record<string, unknown>;
    layers.push(r.tile, r.owner);
  }
  for (const layer of layers) {
    if (typeof layer !== "string" || layer.length === 0) continue;
    try {
      if (base64ToBytes(layer).length !== want) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export const clearSave = (key: string = SAVE_KEY): void => {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
};

const SAVE_FRESH_MS = 7 * 24 * 3600_000;

export function loadRecentSave(now = Date.now(), key: string = SAVE_KEY): SaveGamePayload | null {
  const d = readSave(key);
  if (!d || now - d.savedAt > SAVE_FRESH_MS) return null;
  return d;
}

export const NEW_LOOP_SAVE_TOAST = OLD_SAVE_TOAST;

export const saveNeedsNewLoop = (_d: SaveGamePayload, _newLoop: boolean): boolean => false;

export function loopCarryToWire(m: Map<number, number>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [id, v] of m) {
    if (!Number.isFinite(id) || !Number.isFinite(v)) continue;
    if (v > 0 && v < 1) out[String(id)] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function savedLoopCarry(d: SaveGamePayload): Map<number, number> {
  const out = new Map<number, number>();
  for (const [k, v] of Object.entries(d.loopCarry ?? {})) {
    const id = Number(k), rem = Number(v);
    if (!Number.isFinite(id) || !Number.isFinite(rem)) continue;
    if (rem > 0 && rem < 1) out.set(id, rem);
  }
  return out;
}

export const boardSaveKey = (which: string): string => which;

export { trackSave, trackRestored, bytesToBase64, base64ToBytes };
export type { Cargo };
