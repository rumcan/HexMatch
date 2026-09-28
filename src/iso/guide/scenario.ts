// TUT-2: one deterministic, disposable island per lesson. The same placement
// planners used by the game choose the fixture sites; never ship coordinates
// that could become illegal after a terrain retune.
import { generateMap, STARTER_ISLAND, STARTER_ISLAND_SEED, type Grid, type MapPreset } from "../grid";
import { planDepotPlacement, planFactoryPlacement } from "../placement";
import type { Track } from "../track";
import { GUIDE_SECTION_IDS, type GuideSectionId } from "./types";

export interface TutorialSites {
  factory: { tx: number; ty: number; rot: number };
  depot: { tx: number; ty: number; facing: NonNullable<ReturnType<typeof planDepotPlacement>["facing"]> };
}

export function tutorialMap(id: GuideSectionId): Grid {
  const preset: MapPreset = {
    ...STARTER_ISLAND,
    key: `tutorial-${id}`,
    industries: id === "getting-started" || id === "factory" ? ["farm"]
      : id === "depots" || id === "logistics" ? ["farm", "forest"]
      : STARTER_ISLAND.industries,
  };
  return generateMap(STARTER_ISLAND_SEED + GUIDE_SECTION_IDS.indexOf(id), {
    preset, rivers: false, elevation: true, shapes: true, rings: true,
  });
}

export function tutorialSites(grid: Grid, track: Track): TutorialSites {
  const town = grid.towns[0];
  const industry = grid.industries[0];
  if (!town || !industry) throw new Error("Tutorial map needs a town and an industry");
  const candidates = (cx: number, cy: number, radius: number) => {
    const out: { tx: number; ty: number; distance: number }[] = [];
    for (let ty = Math.max(2, cy - radius); ty <= Math.min(grid.h - 5, cy + radius); ty++)
      for (let tx = Math.max(2, cx - radius); tx <= Math.min(grid.w - 5, cx + radius); tx++)
        out.push({ tx, ty, distance: Math.abs(cx - tx) + Math.abs(cy - ty) });
    return out.sort((a, b) => a.distance - b.distance || a.ty - b.ty || a.tx - b.tx);
  };
  const factory = candidates(town.tx, town.ty, 16).flatMap(({ tx, ty }) =>
    [0, 1].filter((rot) => planFactoryPlacement(grid, tx, ty, { requireTown: true, track, rot }).valid)
      .map((rot) => ({ tx, ty, rot })))[0];
  if (!factory) throw new Error("Tutorial map has no legal factory site");
  const depot = candidates(industry.tx, industry.ty, 8).map(({ tx, ty }) => {
    const plan = planDepotPlacement(grid, [], tx, ty, { factories: [factory] });
    return plan.valid && plan.facing ? { tx, ty, facing: plan.facing } : null;
  }).find((site) => site !== null);
  if (!depot) throw new Error("Tutorial map has no legal depot site");
  return { factory, depot };
}

/** Earlier lessons start empty; later ones start with the prerequisites already
 * standing, rather than asking the player to replay the first two lessons. */
export function tutorialPrerequisites(id: GuideSectionId): { factory: boolean; depot: boolean } {
  const index = GUIDE_SECTION_IDS.indexOf(id);
  return { factory: index > 1, depot: index > 2 && id !== "rail" };
}
