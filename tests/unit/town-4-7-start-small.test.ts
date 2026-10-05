// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.7 (#700): planned towns start as a TOWN, and some get two avenues.
//
// Owner (2026-10-04): "The town started at city v2? It should still start at a
// town level, and some can have 2 avenues."
//   • Tall art waits for its tier (`TOWN_ART_MIN_TIER`): no tower or office
//     block stands in a tier-0 planned town, and each gated sprite appears
//     only from its own tier.
//   • About a third of planned towns get a second avenue crossing the first;
//     its carriageways carry the OTHER axis tier, each with a partner and a
//     one-way direction, and it meets the main avenue in a junction.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateMap, townBuildings } from "../../src/iso/grid";
import { TOWN_ART_MIN_TIER, townArtUnlocked } from "../../src/iso/config";
import { CROSS_AVENUE_PERCENT, planAvenueTiles } from "../../src/iso/town-plan";
import {
  AVENUE_X, AVENUE_Y, avenueJunction, avenuePartner, avenueTravelDir, createTrack, roadTierAt,
  seedTownAvenues, seedTownRoads,
} from "../../src/iso/track";

type Def = { footprint: [number, number] };
const bm = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as { sprites: Record<string, Def> };
const sm = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8")) as { sprites: Record<string, Def> };
const KNOWN = new Set([...Object.keys(bm.sprites), ...Object.keys(sm.sprites)]);
const footprintOf = (s: string): [number, number] => (bm.sprites[s] ?? sm.sprites[s])?.footprint ?? [1, 1];
const base = (s: string): string => s.replace(/_r$/, "");

describe("TOWN-4.7 tier-gated heights", () => {
  it("gates by the base name, so a mirror shares its sprite's tier", () => {
    expect(townArtUnlocked("town_office_tower_modern", 2)).toBe(false);
    expect(townArtUnlocked("town_office_tower_modern", 3)).toBe(true);
    expect(townArtUnlocked("terrace_2x1_yard_r", 0)).toBe(true);
    expect(townArtUnlocked("town_shops_offices_r", 1)).toBe(false);
  });

  for (const seed of [1, 7, 42, 1337]) {
    it(`seed ${seed}: no gated art before its tier, and some tall art by tier 3`, () => {
      const grid = generateMap(seed, { layout: "planned" });
      let tallAtTop = 0;
      for (const tier of [0, 1, 2, 3]) {
        for (const town of grid.towns) {
          const laid = townBuildings(town, footprintOf, { tier, grid, shapes: true, spriteKnown: (s) => KNOWN.has(s) });
          for (const b of laid) {
            const gate = TOWN_ART_MIN_TIER[base(b.sprite)] ?? 0;
            expect(gate, `seed ${seed} tier ${tier} town ${town.id}: ${b.sprite} before its tier ${gate}`)
              .toBeLessThanOrEqual(tier);
            if (tier === 3 && gate >= 2) tallAtTop++;
          }
        }
      }
      expect(tallAtTop, `seed ${seed}: the city grew no tall buildings by tier 3`).toBeGreaterThan(0);
    });
  }
});

describe("TOWN-4.7 a second, crossing avenue", () => {
  const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
  const plans = seeds.flatMap((seed) => generateMap(seed, { layout: "planned" }).towns
    .filter((t) => t.plan).map((t) => ({ seed, town: t, plan: t.plan! })));

  it(`gives roughly ${CROSS_AVENUE_PERCENT}% of planned towns a cross avenue`, () => {
    const crossed = plans.filter((p) => p.plan.crossAvenueTiles).length;
    const pct = (100 * crossed) / plans.length;
    // A hash roll is the ceiling; a town whose ground cannot take the cross
    // avenue keeps one avenue, so the rate lands at or a little under it.
    expect(pct, `${crossed}/${plans.length}`).toBeGreaterThan(15);
    expect(pct, `${crossed}/${plans.length}`).toBeLessThanOrEqual(CROSS_AVENUE_PERCENT + 10);
  });

  it("stamps the cross avenue with the other axis tier, paired, one-way, meeting in a junction", () => {
    let checked = 0;
    for (const seed of [...new Set(plans.filter((p) => p.plan.crossAvenueTiles).map((p) => p.seed))].slice(0, 6)) {
      const grid = generateMap(seed, { layout: "planned" });
      const t = createTrack(false);
      seedTownRoads(t, grid);
      seedTownAvenues(t, grid);
      for (const town of grid.towns) {
        const plan = town.plan;
        if (!plan?.crossAvenueTiles) continue;
        const crossTier = plan.axis === "x" ? AVENUE_Y : AVENUE_X;
        for (const [x, y] of plan.crossAvenueTiles) {
          expect(roadTierAt(t, x, y), `seed ${seed} (${x},${y}) cross tier`).toBe(crossTier);
          expect(avenuePartner(t, x, y), `seed ${seed} (${x},${y}) partner`).not.toBeNull();
          expect(avenueTravelDir(t, x, y), `seed ${seed} (${x},${y}) direction`).not.toBeNull();
        }
        // Where the cross avenue meets the main one, the main avenue's tiles
        // are junctions (their perpendicular neighbour is not their partner).
        const cross = new Set(plan.crossAvenueTiles.map(([x, y]) => `${x},${y}`));
        const meeting = plan.avenueTiles.filter(([x, y]) =>
          [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => cross.has(`${x + dx},${y + dy}`)));
        expect(meeting.length, `seed ${seed} town ${town.id}: the avenues never meet`).toBeGreaterThan(0);
        expect(meeting.some(([x, y]) => avenueJunction(t, x, y)), `seed ${seed} town ${town.id}: no junction`).toBe(true);
        expect(planAvenueTiles(plan).length).toBe(plan.avenueTiles.length + plan.crossAvenueTiles.length);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
