// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — the rank badges, as the app loads them.
//
// One import per tier, through Vite, so a badge is a bundled asset with a
// hashed URL: no fetch at paint time, no broken image on a slow link, and the
// ledger's rating row renders in the same frame as the rest of the card.
//
// The PNGs are DERIVED, never hand-edited — `tools/make-rank-badges.mjs` builds
// all seven from the one painted medallion master in
// `assets/ui-src/rank/medallion-master.png`. The keys here must stay in step
// with `RANK_TIERS` in `src/net/rating.ts` and with the tool's own table;
// `tests/unit/net-rank.test.ts` checks all three against the files on disk, so
// a renamed tier is a failing test rather than a blank square in the lobby.
// ══════════════════════════════════════════════════════════════════════════
import bronze from "../assets/ui/rank/bronze.png";
import silver from "../assets/ui/rank/silver.png";
import gold from "../assets/ui/rank/gold.png";
import platinum from "../assets/ui/rank/platinum.png";
import diamond from "../assets/ui/rank/diamond.png";
import master from "../assets/ui/rank/master.png";
import unranked from "../assets/ui/rank/unranked.png";

/** Badge key → bundled URL. Keys match `RANK_TIERS[].key` + `UNRANKED_KEY`. */
export const RANK_BADGES: Readonly<Record<string, string>> = Object.freeze({
  unranked, bronze, silver, gold, platinum, diamond, master,
});

/** The badge for a player with no rated match yet. */
export { UNRANKED_KEY } from "../net/rating";

/** Every badge key, lowest tier first — the order the ladder panel prints in. */
export const RANK_BADGE_KEYS: readonly string[] = [
  "unranked", "bronze", "silver", "gold", "platinum", "diamond", "master",
];

/**
 * The URL for a badge key, falling back to `unranked` rather than to nothing:
 * a tier this build does not know (a rating file written by a newer version,
 * a renamed band) still shows a medal, which is what the player is looking at.
 */
export function badgeUrlFor(key: string): string {
  return RANK_BADGES[key] ?? RANK_BADGES.unranked;
}
