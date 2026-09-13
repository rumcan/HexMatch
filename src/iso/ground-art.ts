// ══════════════════════════════════════════════════════════════════════════
// GFX-01 terrain LOD — the ground texture URLs for a graphics preset.
//
// The seamless grass/sand/water textures ship at full size in assets/ground/
// and as half- and quarter-size copies in medium/ and low/
// (tools/make-detail-tiers.mjs). Browser/bundler-only: it uses
// `import.meta.glob`, like scenery-art.ts, so ground.ts stays Node-importable.
// ══════════════════════════════════════════════════════════════════════════
import { detailTierFor, tierDir, type DetailTier } from "./detail-tiers";

// Vite needs literal glob patterns, so one glob per tier.
const byTier: Record<DetailTier, Record<string, string>> = {
  high: import.meta.glob<string>("../../assets/ground/*.png", { eager: true, import: "default" }),
  medium: import.meta.glob<string>("../../assets/ground/medium/*.png", { eager: true, import: "default" }),
  low: import.meta.glob<string>("../../assets/ground/low/*.png", { eager: true, import: "default" }),
};

/**
 * The three ground texture URLs for a detail cap. A texture missing from the
 * wanted tier falls back to the full-size file, so a partial art drop still
 * paints a ground rather than dropping to flat colours.
 */
export function groundTextureUrls(cap: number): { grass: string; sand: string; water: string } {
  const tier = detailTierFor(cap);
  const url = (name: string) =>
    byTier[tier][`../../assets/ground/${tierDir(tier)}${name}.png`]
    ?? byTier.high[`../../assets/ground/${name}.png`];
  return { grass: url("grass"), sand: url("sand"), water: url("water") };
}
