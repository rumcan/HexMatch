// ══════════════════════════════════════════════════════════════════════════
// GFX-01 — the video settings store.
//
// The player's LOOK of the game, in one place: how much texture detail the
// art pipeline loads (`quality`) and whether the map wears the miniature
// tilt-shift (`miniature`). Like `?sound` and the rival-skill choice, this is
// pure presentation state: it persists to localStorage, it NEVER enters a
// savegame or the multiplayer wire, and both players simulate the same game
// whatever they are looking at.
//
// `quality` caps the PRELOADED pixel detail at the three shipped art
// resolutions (assets at @0.5x/@1x/@2x):
//   high   — every level, up to the 2× sheets (the historic behaviour);
//   medium — up to the 1× sheets; @2x is never fetched, decoded or held;
//   low    — up to the 0.5× sheets; the chunkiest look, the smallest footprints.
// The renderer samples the capped art and blits it at the camera's own zoom,
// so geometry (anchors, footprints, depth keys, picking) never moves — only
// the texel density behind it does. See `Atlas.detailCap`.
//
// URL flags, same rules as `?sound=0`: `?quality=low|medium|high` and
// `?miniature=1|0` override what is READ at boot without writing to storage,
// so e2e runs and a bookmarked "always miniature" link beat a stranger's
// saved preference predictably.
// ══════════════════════════════════════════════════════════════════════════
import { ZOOM_STEPS, type Zoom } from "../game/config";

export type Quality = "low" | "medium" | "high";

/** The quality keys, in the order the settings panel should show them. */
export const QUALITY_KEYS: readonly Quality[] = ["low", "medium", "high"];

/** The largest pixel-detail level each preset may load, as an atlas zoom. */
export const QUALITY_MAX_DETAIL: Record<Quality, Zoom> = {
  low: ZOOM_STEPS[0],     // 0.5×
  medium: ZOOM_STEPS[1], // 1×
  high: ZOOM_STEPS[2],   // 2× — everything the atlas ships
};

export const QUALITY_LABEL: Record<Quality, string> = {
  low: "Low", medium: "Medium", high: "High",
};

/** One-line copy for the settings panel. */
export const QUALITY_NOTE: Record<Quality, string> = {
  low: "Half-detail art only — the smallest memory, the chunkiest pixels.",
  medium: "Middle-detail art — a fair trade for modest machines.",
  high: "Full 2× detail — the sharpest look (default).",
};

export interface GraphicsSettings {
  quality: Quality;
  /** Tilt-shift "miniature" post pass (src/iso/miniature.ts). */
  miniature: boolean;
}

/** The shipped look: everything loaded, no post pass. */
export const DEFAULT_SETTINGS: GraphicsSettings = { quality: "high", miniature: false };

/** localStorage key — one JSON payload, same pattern as the audio settings. */
export const GRAPHICS_STORAGE_KEY = "hexmatch:graphics";

/** Accepts `low|medium|high` in any case; anything else is null. */
export function parseQuality(v: unknown): Quality | null {
  return typeof v === "string" && (QUALITY_KEYS as readonly string[]).includes(v.toLowerCase())
    ? (v.toLowerCase() as Quality)
    : null;
}

/** The truthy/falsy spellings the URL flags accept. */
function parseFlag(v: string | null): boolean | null {
  if (v === null) return null;
  const s = v.toLowerCase();
  if (["1", "on", "true", "yes"].includes(s)) return true;
  if (["0", "off", "false", "no"].includes(s)) return false;
  return null;
}

/** `?quality=` / `?miniature=` overrides; absent or garbage → null. */
export function urlOverrides(
  search: string | undefined,
): { quality: Quality | null; miniature: boolean | null } {
  const out = { quality: null as Quality | null, miniature: null as boolean | null };
  if (!search) return out;
  try {
    const q = new URLSearchParams(search);
    out.quality = parseQuality(q.get("quality"));
    out.miniature = parseFlag(q.get("miniature"));
  } catch {
    /* a malformed query is simply no override */
  }
  return out;
}

const storage = (): Storage | null =>
  (typeof localStorage !== "undefined" ? localStorage : null);

/** Search string, if a browser `location` exists at all (node tests: none). */
const locationSearch = (): string | undefined =>
  (typeof location !== "undefined" && typeof location.search === "string"
    ? location.search
    : undefined);

/**
 * Merge precedence: defaults < localStorage < URL flags. A remembered setting
 * that the URL also names is IGNORED (the flag is the louder signal), and the
 * flag never writes back to storage — the saved choice survives the bookmark.
 */
export function parseSettings(
  raw: string | null,
  overrides: { quality: Quality | null; miniature: boolean | null },
): GraphicsSettings {
  const s: GraphicsSettings = { ...DEFAULT_SETTINGS };
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<GraphicsSettings>;
      const q = parseQuality(parsed.quality);
      if (q) s.quality = q;
      if (typeof parsed.miniature === "boolean") s.miniature = parsed.miniature;
    } catch {
      /* unreadable blob: the defaults stand */
    }
  }
  if (overrides.quality) s.quality = overrides.quality;
  if (overrides.miniature !== null) s.miniature = overrides.miniature;
  return s;
}

let settings: GraphicsSettings | null = null;
const listeners = new Set<(s: GraphicsSettings) => void>();

function read(): GraphicsSettings {
  settings ??= parseSettings(
    storage()?.getItem(GRAPHICS_STORAGE_KEY) ?? null,
    urlOverrides(locationSearch()),
  );
  return settings;
}

function persist(): void {
  try { storage()?.setItem(GRAPHICS_STORAGE_KEY, JSON.stringify(read())); }
  catch { /* private mode: the choice simply does not survive the reload */ }
}

/** The live settings (a copy — callers must go through `setGraphics`). */
export function currentGraphics(): GraphicsSettings {
  const s = read();
  return { ...s };
}

/** The atlas detail cap implied by the current quality preset. */
export function currentDetailCap(): Zoom {
  return QUALITY_MAX_DETAIL[read().quality];
}

/**
 * Apply a patch, persist it, and notify subscribers. A patch that changes
 * nothing notifies nobody — the toggle button, the modal and the debug
 * console can all fire blindly without the renderer invalidating in a loop.
 */
export function setGraphics(patch: Partial<GraphicsSettings>): GraphicsSettings {
  const s = read();
  const quality = patch.quality !== undefined ? (parseQuality(patch.quality) ?? s.quality) : s.quality;
  const miniature = patch.miniature !== undefined ? !!patch.miniature : s.miniature;
  const next = { quality, miniature };
  if (next.quality === s.quality && next.miniature === s.miniature) return { ...s };
  settings = next;
  persist();
  for (const fn of [...listeners]) fn({ ...next });
  return { ...next };
}

/** Live quality (not the persisted one) — what the Atlas is actually capped to. */
export function subscribeGraphics(fn: (s: GraphicsSettings) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test seam: forget the memoised state (the next read re-runs the pipeline). */
export function resetGraphicsForTests(): void {
  settings = null;
  listeners.clear();
}
