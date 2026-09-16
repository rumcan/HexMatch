// ══════════════════════════════════════════════════════════════════════════
// AI-03 — single-player save/restore, the runtime shell around `game.ts`.
//
// The ask, verbatim: "a refresh restarts the game. you need to save the game
// state so refresh doesn't restart the game, and add a restart button."
//
// The shape is deliberately boring: one JSON payload in localStorage, written
// every few seconds and on pagehide, read once at boot. The map itself is
// seed-derived (`generateMap(seed)`) so only MUTABLE state travels — the
// track layers (base64), the two players' purses and free allowances, the
// factories/harvesters, the industry's mutation fields, both boards (they
// serialise themselves: gem grid + pools + effect clocks as REMAINING ms),
// and the few live clocks the rival runs on. Everything else is either pure
// (scaffolding, overlays) or re-derivable (VP from the track, `planTrucks`
// after the next syncWorld, quarry reach/clocks on the next refresh, offers
// after the market's own expiry sweep).
//
// L1e (#236) adds the new loop's own state to that list: the flag the save was
// played under (`loop`) and the income remainders its clock had banked but not
// yet paid (`loopCarry`). Depot yield levels need no field of their own — they
// ride `eco.harvesters`, the records they belong to. Both are OPTIONAL and no
// version was bumped, so a save written before them loads exactly as before
// and reads as the shipped loop, which is what it was.
//
// Versioned (SAVEGAME_VERSION) so a stale shape from an older build fails
// closed to a fresh game instead of half-restoring.
// ══════════════════════════════════════════════════════════════════════════
import type { Cargo } from "./config";
import type { Track } from "./track";
import type { EconomyState } from "./economy";
import {
  SNAPSHOT_VERSION, bytesToBase64, base64ToBytes, type RailWire,
} from "./snapshot";

export const SAVE_KEY = "hexmatch:save";
export const SAVEGAME_VERSION = 1;

export interface SavedBoardShape { kind: string; data: unknown }

export interface SaveGamePayload {
  v: number;
  snapV: number;
  savedAt: number;
  seed: number;
  skillKey: string;
  phase: string;
  winnerId: string | null;
  /** Optional narrative continuity. Saves written before cinematic endings did
   *  not have it, so restore treats a missing record as a quiet rivalry. */
  story?: {
    playerSabotage: number;
    rivalSabotage: number;
    winningSource: "upgrade" | "plant" | "platform" | null;
    /** Optional because cinematic saves created before conversational oil
     * banter did not track whether its one-off scene had played. */
    oilBanterSeen?: boolean;
  };
  /** Industry id → raid REMAINING ms (phase-offset free, so a reload keeps
   *  the bandit on exactly the time it had left). */
  bandit: Record<number, number>;
  /** Protests on public roads: tile + REMAINING ms (like `bandit` above).
   *  Optional so saves written before protests existed (same v) still load. */
  protests?: { x: number; y: number; left: number; owner: string }[];
  track: { dirt: string; road: string; owner: string; upgraded: string };
  /** RAIL-04 (#178): the railway — layer, platforms, depots, lines, trains.
   *  Optional so saves written before railways existed still load (they read as
   *  a world with no railway, which is exactly what they are). */
  rail?: RailWire;
  /** L1e (#236): which loop this save was played under — `true` for the
   *  redesigned clock loop (`?loop=new`), absent or `false` for the shipped
   *  one. Optional and additive (no version bump here — #230 L15 does that
   *  once, at the end), so every save written before the field existed reads
   *  as `false`: the loop it was actually played under. */
  loop?: boolean;
  /** L1e (#236): the per-depot fractional income remainder the clock banks
   *  between payouts (#233) — depot id → the sub-unit cargo it had earned but
   *  not yet paid. Without it a reload restarts every depot at zero and the
   *  first ticks after a Continue come up short of the rate the player was
   *  earning. Values live in [0, 1); anything else is ignored on restore. */
  loopCarry?: Record<string, number>;
  eco: {
    /** The depot records, `yield` included — L4's tuning level rides the
     *  record it belongs to (`Harvester.yield`), so a restored depot keeps the
     *  rate its session earned instead of dropping back to the baseline. */
    harvesters: EconomyState["harvesters"];
    factories: EconomyState["factories"];
  };
  /**
   * L5 (#219): …and the seat's place in the depot TREE. `depotTier` is the
   * rung it has unlocked, the two town fields its city upgrade. Optional on
   * the TYPE (an old save simply has none) — the reader treats absence as the
   * fresh-seat values, which is exactly what such a save was played with.
   */
  players: {
    purse: Record<string, number>; freeTrack: number; freeDepots: number;
    depotTier?: number; townLevel?: number; townBonus?: number;
  }[];
  boards: SavedBoardShape[];
  /** Reserved. The live AI pacing clocks (build/offer/raid) re-start clean
   *  on restore — a few seconds of drift is not worth serialising timers. */
  clocks: Record<string, number>;
}

const trackSave = (track: Track): SaveGamePayload["track"] => ({
  dirt: bytesToBase64(track.dirt), road: bytesToBase64(track.road),
  owner: bytesToBase64(track.owner), upgraded: bytesToBase64(track.upgraded),
});

function trackRestored(track: Track, w: SaveGamePayload["track"]): void {
  track.dirt.set(base64ToBytes(w.dirt));
  track.road.set(base64ToBytes(w.road));
  track.owner.set(base64ToBytes(w.owner));
  track.upgraded.set(base64ToBytes(w.upgraded));
  track.revision++;
}

/**
 * STORY-01 fix: which save a match reads and writes. The sandbox keeps the
 * original `hexmatch:save`; every story contract gets its own slot. They used
 * to share one key, so a contract resumed the last sandbox world — its seed,
 * the rival's network and the play phase — and judged that rival against the
 * chapter's lower ★ line: an instant defeat. Separate slots keep resume-after-
 * refresh for both without either ever loading the other.
 */
export const saveKeyFor = (storyChapterId?: string | null): string =>
  storyChapterId ? `${SAVE_KEY}:story:${storyChapterId}` : SAVE_KEY;

export const readSave = (key: string = SAVE_KEY): SaveGamePayload | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveGamePayload;
    // v10 → v14 adds multiplayer wires (market/protests/vehicles/boards), the
    // repaired beach, the railway and the Blockade wire; older saves stay
    // loadable because every layer added since is either derivable or reads as
    // its empty past — a v12 save simply has no railway, which is what it was
    // played without, and a v13 save carries its blockades in `bandit` (this
    // file's own field) exactly as it always did. Track bytes and every
    // existing placement are intact.
    //
    // L9 (#224): `snapV` is the MP wire version, which this payload borrows
    // for its track layers; the SAVE's own shape did not change, so bumping
    // the wire must not orphan a game somebody is in the middle of.
    const KNOWN_SNAP_V = new Set([SNAPSHOT_VERSION, 10, 11, 12, 13]);
    if (d.v !== SAVEGAME_VERSION || !KNOWN_SNAP_V.has(d.snapV)) return null;
    if (typeof d.seed !== "number" || !d.track) return null;
    return d;
  } catch { return null; }
};

export const clearSave = (key: string = SAVE_KEY): void => {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
};

/** How old is "recent"? A week-old save is nobody's current game. */
const SAVE_FRESH_MS = 7 * 24 * 3600_000;

export function loadRecentSave(now = Date.now(), key: string = SAVE_KEY): SaveGamePayload | null {
  const d = readSave(key);
  if (!d || now - d.savedAt > SAVE_FRESH_MS) return null;
  return d;
}

// ── L1e (#236): the new loop's own fields ──────────────────────────────────
/**
 * What a save written under the redesigned loop says when it is opened
 * without it. The boot does NOT half-restore such a save — its depots carry
 * tuning yields that the shipped loop has no clock to pay — so the world it
 * describes stays on the shelf and the player is told how to open it.
 */
export const NEW_LOOP_SAVE_TOAST = "This save uses the new loop — open with ?loop=new";

/**
 * True when `d` belongs to a new-loop boot and THIS boot is not one. The
 * check is one-directional on purpose: an old save loaded under the new loop
 * is exactly the "old saves still load unchanged" case — its depots simply
 * have no level, and the clock gives an absent level the baseline.
 */
export const saveNeedsNewLoop = (d: SaveGamePayload, newLoop: boolean): boolean =>
  d.loop === true && newLoop !== true;

/**
 * The write side of the clock's banked remainders: a Map keyed by depot id
 * becomes the payload's `Record<string, number>`, dropping anything a hand
 * edit or a stale field could have left outside [0, 1). `undefined` when there
 * is nothing banked, so a save with no new-loop income is byte-for-byte the
 * payload it was before this landed.
 */
export function loopCarryToWire(m: Map<number, number>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [id, v] of m) {
    if (!Number.isFinite(id) || !Number.isFinite(v)) continue;
    if (v > 0 && v < 1) out[String(id)] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The read side: the banked remainders a save carries, cleaned the same way. */
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

// Re-exported so game.ts can import the payload + the base64 helpers from
// one place; the actual (de)serialisation of game.ts's closures lives there,
// because only that file knows what its clocks are called.
export { trackSave, trackRestored, bytesToBase64, base64ToBytes };
export type { Cargo };
