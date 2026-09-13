import { it } from "vitest";
import { generateMap } from "../../src/iso/grid";
import { buildRefusal } from "../../src/iso/track";
import { planFactoryPlacement, factoryFootprintTiles, factoryQualifyingTowns } from "../../src/iso/placement";

const DIRS = [
  { name: "SW", dx: 0, dy: 1 }, { name: "NW", dx: -1, dy: 0 },
  { name: "NE", dx: 0, dy: -1 }, { name: "SE", dx: 1, dy: 0 },
];

it("world-level reachability: can any ≤12 column end in a legal factory?", async () => {
  for (const seed of [79, 1337, 7]) {
    const g = generateMap(seed);
    let anyOk = 0, cols = 0, endOk = 0, bestLen = 0;
    const reasons: Record<string, number> = {};
    for (const ind of g.industries) {
      for (const d of DIRS) {
        const hx = d.dx === 1 ? ind.tx + ind.w : d.dx === -1 ? ind.tx - 1 : ind.tx;
        const hy = d.dy === 1 ? ind.ty + ind.h : d.dy === -1 ? ind.ty - 1 : ind.ty;
        let clean = 0;
        cols++;
        for (let j = 0; j <= 14; j++) {
          const tx = hx + d.dx * j, ty = hy + d.dy * j;
          const ref = buildRefusal(g, "road", tx, ty);
          if (ref !== null) {
            reasons[ref] = (reasons[ref] ?? 0) + 1;
            break;
          }
          clean = j + 1;
          if (j >= 3) {
            const plan = planFactoryPlacement(g, tx, ty, { requireTown: true });
            if (plan.valid) { endOk++; bestLen = Math.max(bestLen, j + 1); break; }
            reasons["fac:" + (plan.code ?? "?")] = (reasons["fac:" + (plan.code ?? "?")] ?? 0) + 1;
          }
        }
        if (clean >= 4) anyOk++;
      }
    }
    console.log(`seed ${seed}: industries=${g.industries.length} towns=${g.towns.length} cols=${cols} cols≥4clean=${anyOk} endpointsValid=${endOk} bestLen=${bestLen} reasons=${JSON.stringify(reasons)}`);
    // town distances: min over industries of axis-walk distance to any town tile
    let minD = Infinity;
    for (const ind of g.industries) {
      for (const d of DIRS) {
        const hx = d.dx === 1 ? ind.tx + ind.w : d.dx === -1 ? ind.tx - 1 : ind.tx;
        const hy = d.dy === 1 ? ind.ty + ind.h : d.dy === -1 ? ind.ty - 1 : ind.ty;
        for (let j = 0; j <= 40; j++) {
          const tx = hx + d.dx * j, ty = hy + d.dy * j;
          if (factoryQualifyingTowns(g, tx, ty).length > 0) { minD = Math.min(minD, j); break; }
        }
      }
    }
    console.log(`  nearest town-adjacent endpoint along an axis: ${minD === Infinity ? "NONE in 40" : minD}`);
  }
}, 300_000);
