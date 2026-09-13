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
// Versioned (SAVEGAME_VERSION) so a stale shape from an older build fails
// closed to a fresh game instead of half-restoring.
// ══════════════════════════════════════════════════════════════════════════
import type { Cargo } from "./config";
import type { Track } from "./track";
import type { EconomyState } from "./economy";
import {
  SNAPSHOT_VERSION, bytesToBase64, base64ToBytes,
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
    winningSource: "upgrade" | "plant" | null;
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
  eco: {
    harvesters: EconomyState["harvesters"];
    factories: EconomyState["factories"];
  };
  players: { purse: Record<string, number>; freeTrack: number; freeDepots: number }[];
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
    // v10 → v12 adds multiplayer wires (market/protests/vehicles/boards) and beach; older saves stay loadable
    // seeded placement. Track bytes and every existing placement are intact.
    if (d.v !== SAVEGAME_VERSION || (d.snapV !== SNAPSHOT_VERSION && d.snapV !== 10 && d.snapV !== 11)) return null;
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

export const boardSaveKey = (which: string): string => which;

// Re-exported so game.ts can import the payload + the base64 helpers from
// one place; the actual (de)serialisation of game.ts's closures lives there,
// because only that file knows what its clocks are called.
export { trackSave, trackRestored, bytesToBase64, base64ToBytes };
export type { Cargo };
