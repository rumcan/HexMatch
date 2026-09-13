// ══════════════════════════════════════════════════════════════════════════
// GFX-01 terrain LOD — which pre-scaled art tier a graphics preset loads.
//
// The atlases already ship three detail levels (0.5×, 1×, 2×) and the quality
// preset caps which of them load. The ground textures and decals are single
// full-size images, so they get the same treatment as two smaller COPIES:
//
//   high   (cap 2)   — the shipped full-size art, unchanged
//   medium (cap 1)   — half-size copies in a `medium/` folder beside it
//   low    (cap 0.5) — quarter-size copies in a `low/` folder
//
// Kept free of `import.meta.glob` so plain Node (unit tests, tools) can read
// the mapping; the loaders that resolve URLs live in ground-art.ts and
// scenery-art.ts.
// ══════════════════════════════════════════════════════════════════════════

export type DetailTier = "high" | "medium" | "low";

/** Linear size of each tier relative to the shipped full-size art. */
export const TIER_SCALE: Record<DetailTier, number> = { high: 1, medium: 0.5, low: 0.25 };

/** The tier a detail cap (an atlas zoom level: 0.5, 1 or 2) loads. */
export function detailTierFor(cap: number): DetailTier {
  if (cap >= 2) return "high";
  if (cap >= 1) return "medium";
  return "low";
}

/** The sub-folder a tier's copies live in; the full-size art has none. */
export const tierDir = (tier: DetailTier): string => (tier === "high" ? "" : `${tier}/`);
