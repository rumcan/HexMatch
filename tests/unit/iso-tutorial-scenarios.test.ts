import { describe, expect, it } from "vitest";
import { GUIDE_SECTION_IDS } from "../../src/iso/guide/types";
import { tutorialMap, tutorialPrerequisites, tutorialSites } from "../../src/iso/guide/scenario";
import { buildGuideSections } from "../../src/iso/guide/sections";
import { createGuide } from "../../src/iso/guide/engine";
import { createTrack, seedTownRoads, seedPublicRoads } from "../../src/iso/track";
import { planFactoryPlacement, planDepotPlacement } from "../../src/iso/placement";

describe.each(GUIDE_SECTION_IDS)("standalone tutorial: %s", (id) => {
  it("boots a fixed preset with legal, highlighted fixture sites", () => {
    const grid = tutorialMap(id);
    expect(grid.towns).toHaveLength(1);
    expect(grid.industries.length).toBeGreaterThan(0);
    const track = createTrack(grid);
    seedTownRoads(track, grid);
    seedPublicRoads(track, grid);
    const { factory, depot } = tutorialSites(grid, track);
    expect(planFactoryPlacement(grid, factory.tx, factory.ty, { track, requireTown: true, rot: factory.rot }).valid).toBe(true);
    expect(planDepotPlacement(grid, [], depot.tx, depot.ty, { factories: [factory] }).valid).toBe(true);
    const prereq = tutorialPrerequisites(id);
    expect(prereq.depot && !prereq.factory).toBe(false);
  });

  it("requires each step's actual completion, in order", () => {
    const section = buildGuideSections({ vpTarget: 999, freeTrack: 12 }).find((s) => s.id === id)!;
    const guide = createGuide({ sections: [section], storage: null, requireActions: true });
    guide.run(id);
    for (const step of section.steps) {
      expect(guide.view().step?.id).toBe(step.id);
      if (step.complete.kind !== "next") {
        guide.next();
        guide.emit({ kind: "next" });
        expect(guide.view().step?.id).toBe(step.id);
        guide.emit({ kind: "build", what: "factory" });
        if (step.complete.kind !== "build" || step.complete.what !== "factory")
          expect(guide.view().step?.id).toBe(step.id);
      }
      const c = step.complete;
      switch (c.kind) {
        case "next": guide.next(); break;
        case "click": guide.emit({ kind: "click", selector: c.selector }); break;
        case "tool": guide.emit({ kind: "tool", tool: c.tool }); break;
        case "build": guide.emit({ kind: "build", what: c.what }); break;
        case "tab": guide.emit({ kind: "tab", tab: c.tab }); break;
        case "event": guide.emit({ kind: "game", name: c.name }); break;
      }
    }
    expect(guide.view().outcome).toBe("finished");
    expect(guide.progress().done).toContain(id);
  });
});
