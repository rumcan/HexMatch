import { it } from "vitest";
import { generateMap } from "../../src/iso/grid";
import { townTilesOf } from "../../src/iso/placement";

it("ind0 nearest town distance per seed", async () => {
  for (const seed of [79, 1337, 7, 42]) {
    const g = generateMap(seed);
    const f = g.industries[0];
    const towns = g.towns.map((t) => {
      let d = Infinity;
      for (const [hx, hy] of townTilesOf(t)) {
        d = Math.min(d, Math.abs(hx - f.tx) + Math.abs(hy - f.ty));
      }
      return d;
    }).sort((a, b) => a - b);
    console.log(`seed ${seed}: ind0 (${f.tx},${f.ty}) town manh distances: ${towns.join(", ")}`);
  }
}, 300_000);
