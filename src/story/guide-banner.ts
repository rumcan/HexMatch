// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the guide takes the setup sheet.
//
// In a sandbox match the loop's opening beats arrive as the posted manila
// sheet ("Place your Factory next to a town — click a buildable tile").
// Inside a CONTRACT that sheet would break the fiction: the player has just
// watched Mabel brief them in person, and then a faceless notice repeats her
// job. So in story mode the keys below are SPOKEN instead — the same
// instruction, in her voice, on a speech bubble with her painted face beside
// it (the bubble half lives in `styles.css` under `.banner.narrated`; the
// face rides `UiState.bannerFace`).
//
// Only the keys Mabel has a line for are converted; every other banner
// (protest armed, dirt value, the win line) stays the posted sheet, because
// a guide who narrates the protest countdown is a guide who never stops
// talking. The stable `bannerKey` is the seam — BANNER-ONCE dismissals keep
// working exactly as they do on the sheet, bubble included.
// ══════════════════════════════════════════════════════════════════════════
import type { Expression } from "./cast";

export interface GuideBanner {
  mood: Expression;
  text: string;
}

const GUIDE_BANNERS: Record<string, GuideBanner> = {
  "setup-factory": {
    mood: "calm",
    text: "Boss — the Processing Plant goes beside a town. Click a glowing tile and I will file the deed myself.",
  },
  "setup-depot": {
    mood: "calm",
    text: "Now the Depot: stand it inside an industry's 4×4 catchment — one Depot holds each industry, and this first one is on the house.",
  },
  "free-track": {
    mood: "smile",
    text: "Drag a road from the Depot to your Plant, boss — the first tiles are on the allowance. Pave them later and they pay for themselves.",
  },
  "nothing-connected": {
    mood: "mad",
    text: "Boss, the Plant only pays for cargo your network REACHES — and nothing is connected yet. Road, then road, then road.",
  },
  "match-gems": {
    mood: "smile",
    text: "The board is your freight desk, boss: match the tokened gems and the lorries load. Everything else we buy pays out of that.",
  },
};

export const GUIDE_BANNER_KEYS: readonly string[] = Object.keys(GUIDE_BANNERS);

/** Mabel's line for a banner key, or null when the posted sheet stays. */
export const guideBanner = (key: string | null): GuideBanner | null =>
  (key ? GUIDE_BANNERS[key] ?? null : null);
