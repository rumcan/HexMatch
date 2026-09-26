import { generateMap, FIELD_OCC, type Grid } from "../../../src/iso/grid";
import { scatterScenery } from "../../../src/iso/scenery";
import { defaultMapOptions } from "../../../src/iso/map-options";

/** Bounded, deterministic feature search. Never retry an assertion on a new seed. */
export function seedWithFeature(name: string, accepts: (grid: Grid) => boolean): number {
  for (let seed = 0; seed < 64; seed++) {
    const grid = generateMap(seed, defaultMapOptions());
    // The live boot stamps resource fields before any placement search.
    for (const f of scatterScenery(grid).fields) {
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const i = (f.ty + dy) * grid.w + f.tx + dx;
        if (grid.occupancy[i] === -1) grid.occupancy[i] = FIELD_OCC;
      }
    }
    if (accepts(grid)) return seed;
  }
  throw new Error(`No ${name} found in seeds 0..63`);
}
