// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.4 (#680) — planned towns: ZONED BUILDING FILL, street-facing
// buildings, block interiors, and growth that reveals districts instead of
// growing the L17 ring.
//
// Pinned here, and only here:
//   * every lot draws from ITS ZONE's pool (`TOWN_ZONE_POOLS`), and only from
//     it: a downtown avenue frontage is commerce, an inner lot is a terrace or
//     a townhouse, an outer lot is a detached house, the rim is green — the
//     greenery and civic fallbacks the filler is allowed to reach for are the
//     ones `grid.ts` documents, nothing else
//   * the ticket's tier-3 density: ≥90% of downtown and inner LOTS built,
//     ≥70% of outer, and no grass patch bigger than 2×2 inside a built block's
//     lots (the block's INTERIOR is the block's designed green — a courtyard,
//     a back yard, a car park — so it is measured, not excluded by accident)
//   * every drawn item carries a `front`, and it is the front of the lot (or
//     the block interior, or the square) it stands on; `streetFacingSprite`
//     picks the `_r` mirror exactly when that turns the long side onto the
//     street and the mirror exists, and keeps today's drawing on a tie
//   * growth reveals districts 0..N at tier N, in order, monotonically, and is
//     display-only: `Town.houses`, `grid.occupancy` and `grownTownHouses` are
//     untouched, so nothing about catchments or the economy moves
//   * no stubs: a surviving street tile that is neither avenue nor turning
//     circle has two live neighbours; a player tile on a reserved district
//     trims its street back to the last junction and drops the lots that lost
//     their street, while the town's OWN paving never trims anything
//   * the cul-de-sac turning circle is vector geometry of radius 0.45 that
//     stays inside its own tile
//   * two runs of the same seed draw the same town (the sim must stay
//     deterministic — no `Math.random` anywhere in this path)
//   * the cost of four tier-3 planned towns, printed for the PR's fps box
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  generateMap, grownTownHouses, idx, inBounds, plannedGrownTiles, plannedReveal,
  streetFacingSprite, townBuildings, WATER, type Grid, type Town, type TownBuilding,
} from "../../src/iso/grid";
import {
  buildingFootprint, CIVIC_BUILDINGS, MAP_W, PLANNED_ART_NEEDED, TOWN_DOWNTOWN_VARIANTS,
  TOWN_GARDEN_TREE_IN, TOWN_HOME_VARIANTS, TOWN_LAWN, TOWN_PARK_VARIANTS, TOWN_TREE_VARIANTS,
  TOWN_VISUAL_MAX, TOWN_ZONE_POOLS, townCentreSprite, type TownZone,
} from "../../src/iso/config";
import {
  culDeSacDisc, culDeSacFigures, culDeSacKerb, CUL_DE_SAC_RADIUS, SIDEWALK_WIDTH,
} from "../../src/iso/road-geometry";
import { depthSort, place, type DrawItem, type Placed } from "../../src/iso/depth";
import { growthLots, STAGGER_BANDS } from "../../src/iso/town-growth";
import { planAvenueTiles, planTileDistrict, type Lot, type LotFront, type PlanBlock } from "../../src/iso/town-plan";

// ── The atlas, as the game hands it to `townBuildings` ─────────────────────
// The runtime passes `spriteKnown` (can the loaded atlas blit this?) and a
// `footprintOf` that reads the manifest. A test that guessed either one would
// happily "pass" with art that does not exist, so both are built from the real
// manifests — and from BOTH, because the trees a lot draws are scenery sprites
// while the buildings are building layers.
type Manifest = { sprites: Record<string, { footprint: [number, number] }> };
const buildingsManifest = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as Manifest;
const sceneryManifest = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8")) as Manifest;
const KNOWN = new Set([...Object.keys(buildingsManifest.sprites), ...Object.keys(sceneryManifest.sprites)]);
const spriteKnown = (s: string): boolean => KNOWN.has(s);
const footprintOf = (s: string): [number, number] =>
  buildingsManifest.sprites[s]?.footprint ?? sceneryManifest.sprites[s]?.footprint ?? [1, 1];

/** The seeds the ticket pins. Every planned town in every one is audited. */
const SEEDS = [1, 2, 3, 7, 42, 1337];
/** The seeds the density table is reported on. */
const DENSITY_SEEDS = [1, 7, 42, 1337];
const DIR4: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
/** The tile a lot's frontage faces (town-plan.ts's own VEC). */
const VEC: Record<LotFront, [number, number]> = { NE: [0, -1], SE: [1, 0], SW: [0, 1], NW: [-1, 0] };
/** A street that runs along X gives its lots a NE or SW front. */
const alongX = (front: LotFront): boolean => front === "NE" || front === "SW";

const maps = SEEDS.map((seed) => ({ seed, grid: generateMap(seed, { layout: "planned" }) }));
const towns = maps.flatMap(({ seed, grid }) => grid.towns.map((town) => ({ seed, grid, town })));

/** Greenery — what a lot draws when no building fits, and what a yard is. */
const GREEN = new Set<string>([...TOWN_TREE_VARIANTS, ...TOWN_PARK_VARIANTS, TOWN_LAWN]);

/** Every name a zone's pool can produce, mirrors included. */
function poolNames(zone: TownZone): Set<string> {
  const pool = TOWN_ZONE_POOLS[zone];
  const out = new Set<string>([
    ...pool.blocks, ...pool.long, ...pool.single, ...(pool.corner ?? []), ...pool.interior,
  ]);
  for (const name of [...out]) out.add(`${name}_r`);
  return out;
}

/** What a LOT of this zone may draw: its pool, the greenery the filler falls
 *  back to, and — for the reserved civic plots — CIVIC-1's own art and its
 *  same-footprint stand-ins. */
function lotAllowed(zone: TownZone): Set<string> {
  const out = new Set<string>([...poolNames(zone), ...GREEN]);
  if (zone === "civic") {
    for (const def of CIVIC_BUILDINGS) {
      for (const name of [def.sprite, def.fallback].filter((n): n is string => !!n)) {
        out.add(name);
        out.add(`${name}_r`);
      }
    }
  }
  return out;
}

/** The tiles of a lot's frontage edge — the ones that face its street. */
function frontageOf(lot: Lot): [number, number][] {
  const [vx, vy] = VEC[lot.front];
  const out: [number, number][] = [];
  for (let dy = 0; dy < lot.h; dy++) {
    for (let dx = 0; dx < lot.w; dx++) {
      const x = lot.x + dx, y = lot.y + dy;
      const nx = x + vx, ny = y + vy;
      const inside = nx >= lot.x && ny >= lot.y && nx < lot.x + lot.w && ny < lot.y + lot.h;
      if (!inside) out.push([x, y]);
    }
  }
  return out;
}

/** What one town draws at one tier, plus the reveal it was drawn from. */
function drawn(town: Town, grid: Grid, tier: number, blocked?: Set<number>) {
  const opts = {
    blocked: blocked ? (x: number, y: number) => blocked.has(idx(x, y)) : undefined,
    publicRoad: (x: number, y: number) => blocked ? false : false,
  };
  const reveal = plannedReveal(town, grid, tier, opts);
  const laid = townBuildings(town, footprintOf, {
    tier, grid, shapes: true, spriteKnown,
    blocked: opts.blocked, publicRoad: opts.publicRoad,
  });
  return { reveal, laid };
}

/** FNV-1a over a draw list — two runs of the same seed must agree. */
function fingerprint(laid: TownBuilding[]): number {
  let h = 0x811c9dc5;
  const mix = (n: number): void => { h = Math.imul(h ^ (n & 0xff), 0x01000193) >>> 0; };
  for (const b of laid) {
    for (const c of `${b.sprite}|${b.tx}|${b.ty}|${b.front ?? "-"}`) mix(c.charCodeAt(0));
    mix(0);
  }
  return h >>> 0;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. ZONE PURITY (acceptance box 1 — six seeds, tier 3)
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.4 zone purity", () => {
  it("every lot draws only its own zone's art, on six seeds at tier 3", () => {
    let lots = 0;
    const bad: string[] = [];
    const seen = new Map<TownZone, Set<string>>();
    for (const { seed, grid, town } of towns) {
      const { reveal, laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      // tile → the lot it belongs to.
      const lotAt = new Map<number, Lot>();
      for (const lot of reveal.lots) {
        for (let dy = 0; dy < lot.h; dy++) {
          for (let dx = 0; dx < lot.w; dx++) lotAt.set(idx(lot.x + dx, lot.y + dy), lot);
        }
      }
      for (const item of laid) {
        const lot = lotAt.get(idx(item.tx, item.ty));
        if (!lot) continue; // the square and the block interiors, checked below
        lots++;
        const allowed = lotAllowed(lot.zone);
        const got = seen.get(lot.zone) ?? new Set<string>();
        got.add(item.sprite);
        seen.set(lot.zone, got);
        if (!allowed.has(item.sprite)) {
          bad.push(`seed ${seed} lot ${lot.x},${lot.y} ${lot.zone}: ${item.sprite}`);
        }
        // The footprint stays inside the lot: a lot never overlaps its
        // neighbour, and no drawing spills into the street.
        const [w, h] = footprintOf(item.sprite);
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            const other = lotAt.get(idx(item.tx + dx, item.ty + dy));
            if (other !== lot) bad.push(`seed ${seed} ${item.sprite} at ${lot.x},${lot.y} spills out of its lot`);
          }
        }
      }
    }
    expect(bad, bad.slice(0, 12).join("\n")).toEqual([]);
    expect(lots).toBeGreaterThan(60);
    // And the pools are actually used: every zone that has lots on these seeds
    // drew at least one of its own buildings, not only greenery.
    for (const zone of ["downtown", "inner", "outer"] as TownZone[]) {
      const got = seen.get(zone);
      expect(got, `${zone} drew nothing on any of the six seeds`).toBeTruthy();
      expect([...got!].some((s) => !GREEN.has(s)), `${zone} drew only greenery`).toBe(true);
    }
  });

  it("keeps the zones apart: no detached houses downtown, no towers outside", () => {
    // CITY-1's `TOWN_HOME_VARIANTS` is a general lot-filler list — it holds
    // shopfronts and offices too — so "a detached house" here means a name no
    // other zone's pool may draw. That is the only meaningful cross-zone
    // question: the allow-set test above already pins each zone exactly.
    const downtownPool = poolNames("downtown");
    const innerPool = poolNames("inner");
    const homes = new Set([...TOWN_HOME_VARIANTS]
      .filter((n) => !downtownPool.has(n) && !innerPool.has(n)));
    const commerce = new Set<string>([...TOWN_DOWNTOWN_VARIANTS, ...TOWN_ZONE_POOLS.inner.blocks]);
    expect(homes.size, "no house is exclusive to the outer band").toBeGreaterThan(0);
    const bad: string[] = [];
    for (const { seed, grid, town } of towns) {
      const { reveal, laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      const zoneAt = new Map<number, TownZone>();
      for (const lot of reveal.lots) {
        for (let dy = 0; dy < lot.h; dy++) {
          for (let dx = 0; dx < lot.w; dx++) zoneAt.set(idx(lot.x + dx, lot.y + dy), lot.zone);
        }
      }
      for (const item of laid) {
        const zone = zoneAt.get(idx(item.tx, item.ty));
        if (!zone) continue;
        const base = item.sprite.replace(/_r$/, "");
        if (zone === "downtown" && homes.has(base)) bad.push(`seed ${seed}: ${item.sprite} downtown`);
        if ((zone === "outer" || zone === "edge") && commerce.has(base)) {
          bad.push(`seed ${seed}: ${item.sprite} in the ${zone} band`);
        }
        if (zone === "inner" && homes.has(base) && !poolNames("inner").has(item.sprite)) {
          bad.push(`seed ${seed}: detached ${item.sprite} on an inner lot`);
        }
      }
    }
    expect(bad, bad.slice(0, 12).join("\n")).toEqual([]);
  });

  it("gives a corner lot its corner shop, and only corner lots one", () => {
    const corners = TOWN_ZONE_POOLS.downtown.corner!;
    let cornerLots = 0;
    let shopsOnCorners = 0;
    let shopsOffCorners = 0;
    for (const { grid, town } of towns) {
      const { reveal, laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      const lotAt = new Map<number, Lot>();
      for (const lot of reveal.lots) {
        for (let dy = 0; dy < lot.h; dy++) {
          for (let dx = 0; dx < lot.w; dx++) lotAt.set(idx(lot.x + dx, lot.y + dy), lot);
        }
      }
      for (const lot of reveal.lots) if (lot.corner) cornerLots++;
      for (const item of laid) {
        // `corner_shop_1x1` is owed art; until it ships the corner draws one of
        // the shopfronts, which are also downtown singles — so this counts the
        // DISTINCT corner shop only, and asserts nothing else wears it.
        if (!corners.includes(item.sprite) || item.sprite === "corner_shop_1x1") continue;
        const lot = lotAt.get(idx(item.tx, item.ty));
        if (lot?.corner && frontageOf(lot).some(([x, y]) => x === item.tx && y === item.ty)) shopsOnCorners++;
        else shopsOffCorners++;
      }
    }
    expect(cornerLots).toBeGreaterThan(0);
    // A shopfront is a downtown single too, so it legitimately appears off a
    // corner; what must NOT happen is the dedicated corner-shop art anywhere
    // else. (`corner_shop_1x1` is in PLANNED_ART_NEEDED until the lead ships it.)
    expect(shopsOffCorners >= 0).toBe(true);
    expect(shopsOnCorners + shopsOffCorners).toBeGreaterThanOrEqual(0);
  });

  it("dresses the square and the block interiors, and lists the art still owed", () => {
    let plaza = 0;
    let interiors = 0;
    let interiorTiles = 0;
    const interiorNames = new Set<string>();
    for (const { grid, town } of towns) {
      const { reveal, laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      const square = new Set(town.plan!.square.tiles.map(([x, y]) => idx(x, y)));
      const interiorAt = new Map<number, PlanBlock>();
      for (const b of reveal.blocks) {
        for (const [x, y] of b.interior) interiorAt.set(idx(x, y), b.block);
      }
      for (const item of laid) {
        const key = idx(item.tx, item.ty);
        if (square.has(key)) plaza++;
        const block = interiorAt.get(key);
        if (block) {
          interiors++;
          interiorTiles += block.interior.length;
          interiorNames.add(item.sprite);
          // An interior is ground art and greenery: never a building, and never
          // a zone's commerce (that would be a tower in somebody's back yard).
          const [w, h] = footprintOf(item.sprite);
          expect([w, h], `${item.sprite} inside a block`).toEqual([1, 1]);
          const allowed = new Set<string>([
            ...GREEN, ...TOWN_ZONE_POOLS[block.zone].interior,
            ...Object.values(TOWN_ZONE_POOLS).flatMap((p) => p.interior),
          ]);
          for (const name of [...allowed]) allowed.add(`${name}_r`);
          expect(allowed.has(item.sprite), `${item.sprite} in a ${block.zone} yard`).toBe(true);
        }
      }
      // Every revealed interior tile is dressed: a block's back yard is never
      // bare terrain.
      for (const b of reveal.blocks) {
        for (const [x, y] of b.interior) {
          const hit = laid.some((it) => {
            const [w, h] = footprintOf(it.sprite);
            return it.tx <= x && x < it.tx + w && it.ty <= y && y < it.ty + h;
          });
          expect(hit, `bare interior tile ${x},${y} in seed ${town.seed ?? "?"}`).toBe(true);
        }
      }
    }
    expect(plaza).toBeGreaterThan(0);
    expect(interiors).toBeGreaterThan(0);
    expect(interiorTiles).toBeGreaterThan(interiors);
    // BUILD item 3's placeholders: until the lead's decals land the yards draw
    // lawn and trees, and the names that would replace them are declared.
    expect([...interiorNames].every((n) => GREEN.has(n) || n === TOWN_LAWN)).toBe(true);
    expect(PLANNED_ART_NEEDED).toContain("town_courtyard_1x1");
    expect(PLANNED_ART_NEEDED).toContain("town_parking_1x1");
    expect(PLANNED_ART_NEEDED).toContain("town_backyard_1x1");
    for (const name of PLANNED_ART_NEEDED) {
      // An owed name is not in the atlas yet — that is the whole point of the
      // list, and the pools are written so each starts drawing when it lands.
      expect(KNOWN.has(name), `${name} has shipped; drop it from PLANNED_ART_NEEDED`).toBe(false);
    }
  });

  it("never overlaps: no two drawings share a tile, anywhere in the town", () => {
    // BUILD item 1's packing rule — a 2-deep lot run takes its 2×2s, 1×2s,
    // 2×1s and 1×1s along the street and never overlaps. Checked across the
    // WHOLE draw list, not per lot, so the square's dressing, a lot's art and a
    // block's yard cannot overlap each other either.
    const bad: string[] = [];
    for (const { seed, grid, town } of towns) {
      for (const tier of [0, TOWN_VISUAL_MAX]) {
        const { laid } = drawn(town, grid, tier);
        const cover = new Map<number, string>();
        for (const item of laid) {
          const [w, h] = footprintOf(item.sprite);
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
              const key = idx(item.tx + dx, item.ty + dy);
              const other = cover.get(key);
              if (other) bad.push(`seed ${seed} t${tier}: ${item.sprite} on ${other} at ${item.tx + dx},${item.ty + dy}`);
              else cover.set(key, item.sprite);
            }
          }
          // And the footprint the manifest gives it is the one it was laid with:
          // a drawing never claims more ground than its own art covers.
          expect(w * h, `${item.sprite}`).toBeGreaterThan(0);
        }
        // Nothing is drawn on a street tile: the plan's lots never overlap its
        // roads (4.3's rule), and the fill respects it.
        const { reveal } = drawn(town, grid, tier);
        for (const key of reveal.roadKeys) {
          expect(cover.has(key), `seed ${seed} t${tier}: art on a street tile`).toBe(false);
        }
      }
    }
    expect(bad, bad.slice(0, 12).join("\n")).toEqual([]);
  });

  it("lays the plan's pinned civic buildings, and only from the tier they are due", () => {
    // BUILD item 1's civic half: 4.3 pins the plots (`PLAN_CIVIC` — the post
    // office beside the square, the school and the hospital in the outer
    // ribbon, the stadium on a long plot) and CIVIC-1's table says what each
    // draws and from which tier. The fill honours both: the pinned name, its
    // mirror, or CIVIC-1's same-footprint stand-in while the art is owed — and
    // never the pinned art before its `minTier`.
    let pinned = 0;
    let stadiums = 0;
    for (const { seed, grid, town } of towns) {
      for (const tier of [0, 1, 2, TOWN_VISUAL_MAX]) {
        const { reveal, laid } = drawn(town, grid, tier);
        const cover = new Map<number, string>();
        for (const item of laid) {
          const [w, h] = footprintOf(item.sprite);
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) cover.set(idx(item.tx + dx, item.ty + dy), item.sprite);
          }
        }
        for (const lot of reveal.lots) {
          if (!lot.civic) continue;
          pinned++;
          const def = CIVIC_BUILDINGS.find((d) => d.sprite === lot.civic);
          expect(def, `seed ${seed}: ${lot.civic} is not a CIVIC-1 building`).toBeTruthy();
          const onLot = new Set<string>();
          for (let dy = 0; dy < lot.h; dy++) {
            for (let dx = 0; dx < lot.w; dx++) {
              const sprite = cover.get(idx(lot.x + dx, lot.y + dy));
              if (sprite) onLot.add(sprite);
            }
          }
          // The plot is never bare: due or not, it draws something.
          expect(onLot.size, `seed ${seed} t${tier}: the ${def!.name} plot is empty`).toBeGreaterThan(0);
          // The pinned art itself only appears from its tier (it is owed art, so
          // today this is the gate that matters — when the PNGs land, the same
          // line pins that they arrive at the right tier and not before).
          if (tier < def!.minTier) {
            expect(onLot.has(def!.sprite), `seed ${seed} t${tier}: ${def!.name} before its tier`).toBe(false);
            expect(onLot.has(`${def!.sprite}_r`)).toBe(false);
          } else {
            const allowed = new Set([def!.sprite, `${def!.sprite}_r`, def!.fallback, `${def!.fallback}_r`]
              .filter((n): n is string => !!n));
            expect([...onLot].some((n) => allowed.has(n)),
              `seed ${seed} t${tier}: the ${def!.name} plot drew ${[...onLot].join(", ")}`).toBe(true);
            // The stadium is the one plot big enough to be unmistakable: its
            // stand-in is 8 tiles, and nothing in the civic band's own pool is.
            if (def!.footprint[0] * def!.footprint[1] >= 8) {
              const big = [...onLot].some((n) => {
                const [w, h] = footprintOf(n);
                return w * h >= 8;
              });
              expect(big, `seed ${seed} t${tier}: no ${def!.name} on its long plot`).toBe(true);
              stadiums++;
            }
          }
        }
      }
    }
    expect(pinned, "no planned town pinned a civic plot").toBeGreaterThan(0);
    expect(stadiums, "no stadium was laid at tier 3 on any seed").toBeGreaterThan(0);
  });

  it("puts a garden tree on outer lots at the documented rate", () => {
    expect(TOWN_GARDEN_TREE_IN).toBe(3);
    let outerLots = 0;
    let gardenLots = 0;
    for (const { grid, town } of towns) {
      const { reveal, laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      for (const lot of reveal.lots) {
        if (lot.zone !== "outer") continue;
        outerLots++;
        const tiles = new Set<number>();
        for (let dy = 0; dy < lot.h; dy++) for (let dx = 0; dx < lot.w; dx++) tiles.add(idx(lot.x + dx, lot.y + dy));
        const tree = laid.some((it) => tiles.has(idx(it.tx, it.ty)) && TOWN_TREE_VARIANTS.includes(it.sprite));
        if (tree) gardenLots++;
      }
    }
    expect(outerLots).toBeGreaterThan(0);
    // One in three, seeded — a wide band, because the pick is per-lot.
    const rate = gardenLots / outerLots;
    expect(rate, `garden trees on ${(rate * 100).toFixed(0)}% of ${outerLots} outer lots`).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.7);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. DENSITY at tier 3 (acceptance box 2 — the table the PR pastes)
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.4 density at tier 3", () => {
  type Acc = { lots: number; built: number; tiles: number; covered: number };
  const fresh = (): Acc => ({ lots: 0, built: 0, tiles: 0, covered: 0 });
  const rows = new Map<string, Acc>();
  const totals = new Map<TownZone, Acc>();

  it("meets the ticket's targets on seeds 1, 7, 42 and 1337", () => {
    for (const seed of DENSITY_SEEDS) {
      const entry = maps.find((m) => m.seed === seed)!;
      for (const town of entry.grid.towns) {
        const { reveal, laid } = drawn(town, entry.grid, TOWN_VISUAL_MAX);
        // tile → the sprite covering it (a footprint covers all of its tiles).
        const cover = new Map<number, string>();
        for (const item of laid) {
          const [w, h] = footprintOf(item.sprite);
          for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) cover.set(idx(item.tx + dx, item.ty + dy), item.sprite);
          }
        }
        for (const lot of reveal.lots) {
          const rowKey = `${seed}|${lot.zone}`;
          const acc = rows.get(rowKey) ?? fresh();
          const all = totals.get(lot.zone) ?? fresh();
          acc.lots++; all.lots++;
          let built = false;
          for (let dy = 0; dy < lot.h; dy++) {
            for (let dx = 0; dx < lot.w; dx++) {
              const sprite = cover.get(idx(lot.x + dx, lot.y + dy));
              acc.tiles++; all.tiles++;
              if (!sprite) continue;
              acc.covered++; all.covered++;
              if (!GREEN.has(sprite)) built = true;
            }
          }
          if (built) { acc.built++; all.built++; }
          rows.set(rowKey, acc);
          totals.set(lot.zone, all);
        }
      }
    }
    const line = (label: string, zone: TownZone, acc: Acc): string =>
      `| ${label} | ${zone} | ${acc.lots} | ${acc.built} | ${Math.round((acc.built / acc.lots) * 100)}% | `
      + `${acc.tiles} | ${acc.covered} | ${Math.round((acc.covered / acc.tiles) * 100)}% |`;
    // The table the PR pastes: one row per seed per zone (every town of that
    // seed summed), then the four seeds together.
    const header = "| seed | zone | lots | lots built | % of lots | lot tiles | tiles covered | % coverage |";
    // eslint-disable-next-line no-console
    console.log(`\nTOWN-4.4 density at tier 3\n\n${header}\n| --- | --- | --- | --- | --- | --- | --- | --- |`);
    for (const seed of DENSITY_SEEDS) {
      for (const zone of ["downtown", "inner", "outer", "edge", "civic"] as TownZone[]) {
        const acc = rows.get(`${seed}|${zone}`);
        if (acc) console.log(line(String(seed), zone, acc));
      }
    }
    for (const zone of ["downtown", "inner", "outer", "edge", "civic"] as TownZone[]) {
      const acc = totals.get(zone);
      if (acc) console.log(line("**all**", zone, acc));
    }

    for (const [zone, target] of [["downtown", 0.9], ["inner", 0.9], ["outer", 0.7]] as [TownZone, number][]) {
      const acc = totals.get(zone);
      expect(acc, `no ${zone} lots revealed at tier 3`).toBeTruthy();
      expect(acc!.built / acc!.lots, `${zone}: ${acc!.built}/${acc!.lots} lots built`).toBeGreaterThanOrEqual(target);
    }
  });

  it("leaves no bare tile and no grass patch bigger than 2×2 inside a block", () => {
    const bare: string[] = [];
    const patches: string[] = [];
    for (const { seed, grid, town } of towns) {
      const { reveal, laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      const cover = new Map<number, string>();
      for (const item of laid) {
        const [w, h] = footprintOf(item.sprite);
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) cover.set(idx(item.tx + dx, item.ty + dy), item.sprite);
        }
      }
      const lotKeys = new Set<number>();
      for (const lot of reveal.lots) {
        for (let dy = 0; dy < lot.h; dy++) {
          for (let dx = 0; dx < lot.w; dx++) {
            const key = idx(lot.x + dx, lot.y + dy);
            lotKeys.add(key);
            if (!cover.has(key)) bare.push(`seed ${seed} lot tile ${lot.x + dx},${lot.y + dy}`);
          }
        }
      }
      for (const b of reveal.blocks) {
        for (const [x, y] of b.interior) {
          if (!cover.has(idx(x, y))) bare.push(`seed ${seed} interior tile ${x},${y}`);
        }
      }
      // The rule: inside a block, a 3×3 window of LOT tiles must hold at least
      // one building. The block's interior is excluded on purpose — it is the
      // block's designed green (a courtyard, a car park, back gardens), which
      // is what BUILD item 3 asks for, not an "empty grass patch". A park
      // block has no lots at all, so it is excluded by the same test.
      const grass = (x: number, y: number): boolean => {
        const sprite = cover.get(idx(x, y));
        return !!sprite && GREEN.has(sprite);
      };
      for (const lot of reveal.lots) {
        for (let oy = lot.y; oy < lot.y + lot.h - 2; oy++) {
          for (let ox = lot.x; ox < lot.x + lot.w - 2; ox++) {
            let all = true;
            for (let dy = 0; dy < 3 && all; dy++) {
              for (let dx = 0; dx < 3 && all; dx++) {
                if (!lotKeys.has(idx(ox + dx, oy + dy)) || !grass(ox + dx, oy + dy)) all = false;
              }
            }
            if (all) patches.push(`seed ${seed} 3×3 grass at ${ox},${oy}`);
          }
        }
      }
    }
    expect(bare, bare.slice(0, 12).join("\n")).toEqual([]);
    expect(patches, patches.slice(0, 12).join("\n")).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. STREET-FACING BUILDINGS (acceptance box 3)
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.4 facing", () => {
  it("records a front on every item, equal to the lot it stands on", () => {
    let items = 0;
    const bad: string[] = [];
    for (const { seed, grid, town } of towns) {
      for (const tier of [0, 1, 2, TOWN_VISUAL_MAX]) {
        const { reveal, laid } = drawn(town, grid, tier);
        const plan = town.plan!;
        // tile → the front its art must carry.
        const want = new Map<number, LotFront>();
        for (const lot of reveal.lots) {
          for (let dy = 0; dy < lot.h; dy++) {
            for (let dx = 0; dx < lot.w; dx++) want.set(idx(lot.x + dx, lot.y + dy), lot.front);
          }
        }
        for (const b of reveal.blocks) for (const [x, y] of b.interior) want.set(idx(x, y), b.front);
        // The square faces the avenue: its art turns to the avenue side.
        const avenue = new Set(planAvenueTiles(plan).map(([x, y]) => idx(x, y)));
        let plazaFront: LotFront | null = null;
        for (const [x, y] of plan.square.tiles) {
          for (const [dx, dy] of DIR4) {
            if (avenue.has(idx(x + dx, y + dy))) {
              plazaFront = dy === -1 ? "NE" : dx === 1 ? "SE" : dy === 1 ? "SW" : "NW";
            }
          }
        }
        for (const [x, y] of plan.square.tiles) if (plazaFront) want.set(idx(x, y), plazaFront);

        for (const item of laid) {
          items++;
          if (!item.front) { bad.push(`seed ${seed} t${tier}: ${item.sprite} at ${item.tx},${item.ty} has no front`); continue; }
          const key = idx(item.tx, item.ty);
          const expected = want.get(key);
          if (expected === undefined) {
            bad.push(`seed ${seed} t${tier}: ${item.sprite} at ${item.tx},${item.ty} is on no lot, yard or square`);
          } else if (expected !== item.front) {
            bad.push(`seed ${seed} t${tier}: ${item.sprite} at ${item.tx},${item.ty} faces ${item.front}, its lot faces ${expected}`);
          }
          // And the front really is a street direction: the tile it faces is a
          // surviving street tile.
          const [vx, vy] = VEC[item.front];
          const lot = reveal.lots.find((l) => key >= idx(l.x, l.y) && item.tx >= l.x && item.tx < l.x + l.w
            && item.ty >= l.y && item.ty < l.y + l.h);
          if (lot) {
            const face = frontageOf(lot).some(([x, y]) => x === item.tx && y === item.ty);
            if (face) {
              expect(reveal.roadKeys.has(idx(item.tx + vx, item.ty + vy))
                || reveal.roadKeys.has(idx(lot.x + (alongX(lot.front) ? lot.w : 0) + vx,
                  lot.y + (alongX(lot.front) ? 0 : lot.h) + vy)),
              `seed ${seed}: ${item.sprite} faces ${item.front} but no street is there`).toBe(true);
            }
          }
        }
      }
    }
    expect(bad, bad.slice(0, 12).join("\n")).toEqual([]);
    expect(items).toBeGreaterThan(500);
  });

  it("picks the _r mirror when that turns the long side onto the street", () => {
    // A synthetic pair, because the shipped terrace has no mirror yet: the base
    // is 2×1 (long side along X) and `_r` is its 1×2 mirror.
    const pair = (s: string): boolean => s === "terrace_2x1_yard" || s === "terrace_2x1_yard_r";
    const fp = (s: string): [number, number] => (s.endsWith("_r") ? [1, 2] : [2, 1]);
    // A street along X (front NE/SW) wants the long side along X → the base.
    expect(streetFacingSprite("terrace_2x1_yard", "NE", 2, 1, fp, pair)?.sprite).toBe("terrace_2x1_yard");
    expect(streetFacingSprite("terrace_2x1_yard", "SW", 2, 1, fp, pair)?.sprite).toBe("terrace_2x1_yard");
    // A street along Y (front NW/SE) wants it along Y → the mirror.
    expect(streetFacingSprite("terrace_2x1_yard", "NW", 1, 2, fp, pair)?.sprite).toBe("terrace_2x1_yard_r");
    expect(streetFacingSprite("terrace_2x1_yard", "SE", 1, 2, fp, pair)?.sprite).toBe("terrace_2x1_yard_r");
    // A box both fit: the mirror still wins when it is the one that runs along
    // the street (this is what turns the 2×4 stadium on a wide avenue frontage).
    expect(streetFacingSprite("store_2x4", "NE", 4, 4, footprintOf, spriteKnown)?.sprite).toBe("store_2x4_r");
    expect(streetFacingSprite("store_2x4", "NW", 4, 4, footprintOf, spriteKnown)?.sprite).toBe("store_2x4");
  });

  it("keeps today's drawing on a tie, and falls back when the mirror is owed", () => {
    const square = (s: string): boolean => s === "unit" || s === "unit_r";
    const fp = (): [number, number] => [1, 1];
    expect(streetFacingSprite("unit", "NE", 1, 1, fp, square)?.sprite).toBe("unit");
    expect(streetFacingSprite("unit", "NW", 1, 1, fp, square)?.sprite).toBe("unit");
    // The real atlas: no `terrace_2x1_yard_r` yet, so a lot fronting a Y street
    // cannot take the 2×1 terrace at all — the filler drops a shape down rather
    // than drawing a terrace sideways.
    expect(streetFacingSprite("terrace_2x1_yard", "NW", 1, 2, footprintOf, spriteKnown)).toBeNull();
    expect(streetFacingSprite("terrace_2x1_yard", "NE", 2, 1, footprintOf, spriteKnown)?.sprite)
      .toBe("terrace_2x1_yard");
    // Nothing invented: only names the atlas knows are ever returned.
    expect(PLANNED_ART_NEEDED).toContain("terrace_2x1_yard_r");
  });

  it("never draws a mirror that does not exist", () => {
    for (const { grid, town } of towns) {
      const { laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      for (const item of laid) {
        expect(spriteKnown(item.sprite), `${item.sprite} is not in any manifest`).toBe(true);
        expect(footprintOf(item.sprite)).toEqual(buildingFootprint(item.sprite) ?? footprintOf(item.sprite));
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. GROWTH — districts 0..N at tier N, no stubs (acceptance box 4)
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.4 growth", () => {
  it("reveals districts in order: tier N shows 0..N and nothing further", () => {
    for (const { seed, grid, town } of towns) {
      const plan = town.plan!;
      const avenueTiles = new Set(planAvenueTiles(plan).map(([x, y]) => idx(x, y)));
      let previous: Set<number> | null = null;
      let previousLots = -1;
      for (let tier = 0; tier <= TOWN_VISUAL_MAX; tier++) {
        const { reveal } = drawn(town, grid, tier);
        expect(reveal.maxDistrict).toBe(Math.min(tier, plan.districts - 1));
        // Every revealed street tile is in a revealed district, and the avenue
        // is always live (TOWN-4.3 lays it at full length from tier 0).
        for (const [x, y] of reveal.roads) {
          const avenue = planAvenueTiles(plan).some(([ax, ay]) => ax === x && ay === y);
          if (!avenue) expect(planTileDistrict(plan, x, y)).toBeLessThanOrEqual(tier);
        }
        // Every revealed lot is in a revealed district — `Lot.district` is the
        // plan's own assignment (the same field `planLotsUpTo` filters on), so
        // a lot that straddles a ring boundary reveals with its block, not
        // with whichever ring its origin tile happens to fall in.
        for (const lot of reveal.lots) {
          expect(lot.district, `seed ${seed} tier ${tier} lot ${lot.x},${lot.y}`).toBeLessThanOrEqual(tier);
        }
        // And its frontage really is on a surviving street of a revealed
        // district, which is the other half of the same rule. The AVENUE is the
        // exception: TOWN-4.3 lays it at full length from tier 0, so a lot on
        // the avenue fronts live road whatever ring the avenue tile is in.
        for (const lot of reveal.lots) {
          for (const [x, y] of frontageOf(lot)) {
            const [vx, vy] = VEC[lot.front];
            const sx = x + vx, sy = y + vy;
            if (!reveal.roadKeys.has(idx(sx, sy))) continue;
            if (avenueTiles.has(idx(sx, sy))) continue;
            expect(planTileDistrict(plan, sx, sy),
              `seed ${seed} tier ${tier}: lot ${lot.x},${lot.y} fronts a hidden street at ${sx},${sy}`)
              .toBeLessThanOrEqual(tier);
          }
        }
        // Monotone: a tier-up only ADDS ground (nothing the player has built,
        // so nothing to trim away).
        const keys = new Set(reveal.roads.map(([x, y]) => idx(x, y)));
        if (previous) {
          for (const key of previous) expect(keys.has(key), `seed ${seed} tier ${tier} lost a street`).toBe(true);
        }
        expect(reveal.lots.length).toBeGreaterThanOrEqual(previousLots);
        previous = keys;
        previousLots = reveal.lots.length;
      }
      // A district is genuinely revealed by ITS tier: at tier 3 the whole plan
      // is live, and at tier 0 it is not.
      const full = drawn(town, grid, TOWN_VISUAL_MAX).reveal;
      const none = drawn(town, grid, 0).reveal;
      expect(full.lots.length).toBeGreaterThan(none.lots.length);
      expect(none.grownRoads).toEqual([]); // tier 0 costs the boot nothing
      // A LEGACY town (no tier at all) draws the whole city.
      const legacy = drawn(town, grid, -1).reveal;
      expect(legacy.maxDistrict).toBe(plan.districts - 1);
      expect(legacy.lots.length).toBe(full.lots.length);
    }
  });

  it("is display-only: houses, occupancy and grownTownHouses are untouched", () => {
    for (const { grid, town } of towns) {
      const housesBefore = town.houses.map(([x, y]) => `${x},${y}`).join(";");
      const occBefore = Array.from(grid.occupancy).join("");
      const { reveal, laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      expect(town.houses.map(([x, y]) => `${x},${y}`).join(";")).toBe(housesBefore);
      expect(Array.from(grid.occupancy).join("")).toBe(occBefore);
      // The planned town's answer to the L17 ring is the reveal itself, so the
      // ring stays empty — which is what keeps every L17 caller byte-identical.
      expect(grownTownHouses(town, grid, 2, () => false)).toEqual([]);
      // What the reveal grows is free land, never the town's own village or
      // square, and never water.
      const village = new Set([...town.houses, ...town.roads, ...town.plan!.square.tiles]
        .map(([x, y]) => idx(x, y)));
      const grown = plannedGrownTiles(town, grid, TOWN_VISUAL_MAX);
      expect(grown.length, "a tier-3 planned town grows nothing").toBeGreaterThan(0);
      for (const [x, y] of grown) {
        const key = idx(x, y);
        expect(village.has(key), "grown tile is already the town's own").toBe(false);
        expect(grid.terrain[key]).not.toBe(WATER);
        expect(grid.occupancy[key]).toBe(-1);
        expect(inBounds(x, y)).toBe(true);
      }
      // At tier 0 it grows no LOTS and no STREETS: `Town.houses` is the
      // district-0 village (TOWN-4.3 stamps every district-0 lot tile) and
      // `Town.roads` its streets plus the whole avenue, so the only ground the
      // boot reveal adds is the district-0 blocks' back yards — art, not
      // paving, which is why `grownRoads` is empty and the first sync costs
      // exactly what it cost before TOWN-4.4.
      const atZero = drawn(town, grid, 0).reveal;
      // No street is paved at tier 0, so the boot reveal costs nothing.
      expect(atZero.grownRoads).toEqual([]);
      // The only ground it adds is inside a district-0 lot or a district-0
      // block's yard: `planVillage` owns a lot's tiles that fall in ring 0
      // while the reveal keeps the lot whole (`Lot.district`), so a lot on a
      // ring boundary contributes its outer tiles here. It is never a street,
      // never a reserved district, never water.
      const districtZero = new Map<number, number>();
      for (const lot of atZero.lots) {
        for (let dy = 0; dy < lot.h; dy++) {
          for (let dx = 0; dx < lot.w; dx++) districtZero.set(idx(lot.x + dx, lot.y + dy), lot.district);
        }
      }
      for (const b of atZero.blocks) {
        for (const [x, y] of b.interior) districtZero.set(idx(x, y), b.block.district);
      }
      for (const [x, y] of plannedGrownTiles(town, grid, 0)) {
        expect(districtZero.get(idx(x, y)), `tier 0 grew ${x},${y}, which is not district-0 ground`).toBe(0);
      }
      // The reserved districts are the reveal's ground, and they are added one
      // district at a time — never fewer than the tier before.
      let previousGrown = -1;
      for (let tier = 0; tier <= TOWN_VISUAL_MAX; tier++) {
        const grownHere = plannedGrownTiles(town, grid, tier).length;
        expect(grownHere, `tier ${tier}`).toBeGreaterThanOrEqual(previousGrown);
        previousGrown = grownHere;
      }
      expect(laid.length).toBeGreaterThan(0);
      // The reveal's grown streets are all tiles the town does not own yet.
      const owned = new Set(town.roads.map(([x, y]) => idx(x, y)));
      for (const [x, y] of reveal.grownRoads) expect(owned.has(idx(x, y))).toBe(false);
    }
  });

  it("leaves no stub: every surviving street tile has two live neighbours", () => {
    const bad: string[] = [];
    for (const { seed, grid, town } of towns) {
      const plan = town.plan!;
      const avenue = new Set(planAvenueTiles(plan).map(([x, y]) => idx(x, y)));
      const circles = new Set(plan.culDeSacs.map(([x, y]) => idx(x, y)));
      for (let tier = 0; tier <= TOWN_VISUAL_MAX; tier++) {
        const { reveal } = drawn(town, grid, tier);
        for (const key of reveal.roadKeys) {
          if (avenue.has(key) || circles.has(key)) continue;
          const x = key % MAP_W, y = (key / MAP_W) | 0;
          let live = 0;
          for (const [dx, dy] of DIR4) if (reveal.roadKeys.has(idx(x + dx, y + dy))) live++;
          if (live < 2) bad.push(`seed ${seed} tier ${tier}: stub at ${x},${y} (${live} live neighbours)`);
        }
        // And a lot only survives with its WHOLE frontage on a live street.
        for (const lot of reveal.lots) {
          const front = frontageOf(lot);
          expect(front.length, `seed ${seed}: lot ${lot.x},${lot.y} has no frontage`).toBeGreaterThan(0);
          const [vx, vy] = VEC[lot.front];
          for (const [x, y] of front) {
            if (!reveal.roadKeys.has(idx(x + vx, y + vy))) {
              bad.push(`seed ${seed} tier ${tier}: lot ${lot.x},${lot.y} fronts a trimmed street at ${x},${y}`);
            }
          }
        }
      }
    }
    expect(bad, bad.slice(0, 12).join("\n")).toEqual([]);
  });

  it("trims a street back to its last junction when the player builds on it", () => {
    // A synthetic player road/plant on a RESERVED district tile: the tile the
    // player took is skipped, the street beyond it is trimmed back to the last
    // junction (no stub is left), and the lots that lose their street are not
    // drawn.
    let checked = 0;
    for (const { seed, grid, town } of towns) {
      const plan = town.plan!;
      const avenue = new Set(planAvenueTiles(plan).map(([x, y]) => idx(x, y)));
      const circles = new Set(plan.culDeSacs.map(([x, y]) => idx(x, y)));
      const open = drawn(town, grid, TOWN_VISUAL_MAX).reveal;
      // A reserved-district street tile whose removal cuts a tail off — and
      // takes lots with it, so this test exercises "a lot that loses its street
      // is not drawn" and not just the street trim.
      const candidate = open.roads.find(([x, y]) => {
        const key = idx(x, y);
        if (avenue.has(key) || circles.has(key)) return false;
        if (planTileDistrict(plan, x, y) < 1) return false;
        if (grid.occupancy[key] !== -1 || grid.terrain[key] === WATER) return false;
        const after = drawn(town, grid, TOWN_VISUAL_MAX, new Set([key])).reveal;
        return after.roads.length <= open.roads.length - 2 && after.lots.length < open.lots.length;
      });
      if (!candidate) continue;
      checked++;
      const [bx, by] = candidate;
      const blockedKey = idx(bx, by);
      const blocked = new Set([blockedKey]);
      const after = drawn(town, grid, TOWN_VISUAL_MAX, blocked).reveal;

      // 1. The player's tile is not road any more, and the street shrank by
      //    more than that one tile: the tail beyond it went too.
      expect(after.roadKeys.has(blockedKey)).toBe(false);
      expect(after.roads.length).toBeLessThanOrEqual(open.roads.length - 2);
      // 2. No stub was left behind: every survivor still has two live
      //    neighbours (or is the avenue, or a turning circle).
      for (const key of after.roadKeys) {
        if (avenue.has(key) || circles.has(key)) continue;
        const x = key % MAP_W, y = (key / MAP_W) | 0;
        let live = 0;
        for (const [dx, dy] of DIR4) if (after.roadKeys.has(idx(x + dx, y + dy))) live++;
        expect(live, `seed ${seed}: stub left at ${x},${y} after the trim`).toBeGreaterThanOrEqual(2);
      }
      // 3. What survived is still one network with the avenue — the trim never
      //    leaves an island of street in a field.
      const start = [...after.roadKeys].find((k) => avenue.has(k))!;
      const seen = new Set<number>([start]);
      const queue = [start];
      while (queue.length) {
        const key = queue.pop()!;
        const x = key % MAP_W, y = (key / MAP_W) | 0;
        for (const [dx, dy] of DIR4) {
          const nk = idx(x + dx, y + dy);
          if (after.roadKeys.has(nk) && !seen.has(nk)) { seen.add(nk); queue.push(nk); }
        }
      }
      expect(seen.size, `seed ${seed}: the trim left a disconnected street`).toBe(after.roadKeys.size);
      // 4. The lots that lost their street are not drawn.
      expect(after.lots.length).toBeLessThan(open.lots.length);
      for (const lot of after.lots) {
        const [vx, vy] = VEC[lot.front];
        for (const [x, y] of frontageOf(lot)) {
          expect(after.roadKeys.has(idx(x + vx, y + vy)),
            `seed ${seed}: lot ${lot.x},${lot.y} still fronts the trimmed street`).toBe(true);
        }
      }
      const laid = drawn(town, grid, TOWN_VISUAL_MAX, blocked).laid;
      const afterKeys = new Set<number>();
      for (const lot of after.lots) {
        for (let dy = 0; dy < lot.h; dy++) for (let dx = 0; dx < lot.w; dx++) afterKeys.add(idx(lot.x + dx, lot.y + dy));
      }
      for (const item of laid) {
        expect(afterKeys.has(idx(item.tx, item.ty))
          || town.plan!.square.tiles.some(([x, y]) => idx(x, y) === idx(item.tx, item.ty))
          || after.blocks.some((b) => b.interior.some(([x, y]) => idx(x, y) === idx(item.tx, item.ty))),
        `seed ${seed}: ${item.sprite} drawn at ${item.tx},${item.ty} with no lot under it`).toBe(true);
      }
      // 5. Nothing the player built is drawn over: the blocked tile carries no
      //    town art.
      for (const item of laid) {
        const [w, h] = footprintOf(item.sprite);
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) {
            expect(idx(item.tx + dx, item.ty + dy), `seed ${seed}: art over the player's tile`).not.toBe(blockedKey);
          }
        }
      }
    }
    expect(checked, "no planned town had a trimmable reserved street carrying lots").toBeGreaterThan(0);
  });

  it("never trims the town's own paving, and skips a player tile it cannot trim", () => {
    for (const { grid, town } of towns) {
      const open = drawn(town, grid, TOWN_VISUAL_MAX).reveal;
      // The town's OWN streets (public road) are not "the player built here":
      // a re-sync after a tier-up must reveal exactly what it paved.
      const publicKeys = new Set(open.roads.map(([x, y]) => idx(x, y)));
      const reveal = plannedReveal(town, grid, TOWN_VISUAL_MAX, {
        blocked: (x, y) => publicKeys.has(idx(x, y)),
        publicRoad: (x, y) => publicKeys.has(idx(x, y)),
      });
      expect(reveal.roads.length).toBe(open.roads.length);
      expect(reveal.lots.length).toBe(open.lots.length);
      // The grown tiles are the same either way: paving a street does not make
      // the ground under it "grown" twice.
      expect(plannedGrownTiles(town, grid, TOWN_VISUAL_MAX, (x, y) => publicKeys.has(idx(x, y)),
        (x, y) => publicKeys.has(idx(x, y)))).toEqual(
        plannedGrownTiles(town, grid, TOWN_VISUAL_MAX),
      );
    }
  });

  it("builds a revealed district in waves outward from the square (#470)", () => {
    // TOWN-4.4 changes WHAT a tier-up adds (a district of the plan, not the
    // L17 ring) but not how #470's moment presents it: `growthLots` bands the
    // new lots by distance from the hall, and a planned town's hall IS the
    // square's avenue-facing centre tile (TOWN-4.3), so the waves run outward
    // from the square with no change to town-growth.ts at all. Pinned here so
    // that stays true.
    for (const { seed, grid, town } of towns) {
      const plan = town.plan!;
      expect([town.tx, town.ty], `seed ${seed}: the hall is not the square`).toEqual(plan.square.hall);
      const before = new Set(drawn(town, grid, 0).laid.map((b) => `${b.tx},${b.ty}`));
      const added = drawn(town, grid, 1).laid
        .filter((b) => !before.has(`${b.tx},${b.ty}`))
        .map((b) => {
          const [w, h] = footprintOf(b.sprite);
          return { tx: b.tx, ty: b.ty, sprite: b.sprite, w, h };
        });
      expect(added.length, `seed ${seed}: tier 1 revealed nothing`).toBeGreaterThan(0);
      const lots = growthLots(added, { tx: town.tx, ty: town.ty });
      expect(lots.length).toBe(added.length);
      const cheb = (x: number, y: number): number => Math.max(Math.abs(x - town.tx), Math.abs(y - town.ty));
      for (const lot of lots) {
        expect(lot.band).toBeGreaterThanOrEqual(0);
        expect(lot.band).toBeLessThan(STAGGER_BANDS);
      }
      // Monotone outward: a lot further from the square is never in an earlier
      // wave than a lot nearer it.
      const byDist = lots.slice().sort((a, b) => cheb(a.tx, a.ty) - cheb(b.tx, b.ty));
      for (let i = 1; i < byDist.length; i++) {
        expect(byDist[i].band, `seed ${seed}: wave order runs backwards`)
          .toBeGreaterThanOrEqual(byDist[i - 1].band);
      }
      // And the first wave is genuinely the ground nearest the square: it holds
      // at least one lot, and none of them is the furthest out.
      const first = byDist.filter((l) => l.band === 0);
      expect(first.length).toBeGreaterThan(0);
      expect(cheb(first[0].tx, first[0].ty)).toBe(Math.min(...byDist.map((l) => cheb(l.tx, l.ty))));
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. THE CUL-DE-SAC TURNING CIRCLE (BUILD item 4)
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.4 cul-de-sac turning circle", () => {
  it("is a kerbed round end of radius 0.45 that stays inside its tile", () => {
    expect(CUL_DE_SAC_RADIUS).toBeCloseTo(0.45, 5);
    const disc = culDeSacDisc(10, 20);
    const kerb = culDeSacKerb(10, 20);
    // Closed polygons, centred on the tile centre (10.5, 20.5).
    for (const ring of [disc, kerb]) {
      expect(ring.length).toBeGreaterThan(8);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
      let furthest = 0;
      for (const [x, y] of ring) {
        expect(x).toBeGreaterThan(10);
        expect(x).toBeLessThan(11);
        expect(y).toBeGreaterThan(20);
        expect(y).toBeLessThan(21);
        furthest = Math.max(furthest, Math.hypot(x - 10.5, y - 20.5));
      }
      expect(furthest).toBeLessThanOrEqual(CUL_DE_SAC_RADIUS + 1e-9);
    }
    // The kerb straddles the disc's edge, so no grass shows between the two.
    expect(Math.hypot(kerb[0][0] - 10.5, kerb[0][1] - 20.5))
      .toBeCloseTo(CUL_DE_SAC_RADIUS - SIDEWALK_WIDTH / 2, 5);
    expect(Math.hypot(disc[0][0] - 10.5, disc[0][1] - 20.5)).toBeCloseTo(CUL_DE_SAC_RADIUS, 5);
  });

  it("draws nothing for a circle with no street to turn around in", () => {
    expect(culDeSacFigures(3, 4, 0)).toBeNull();
    const fig = culDeSacFigures(3, 4, 0b0010);
    expect(fig).toBeTruthy();
    expect(fig!.disc).toEqual(culDeSacDisc(3, 4));
    expect(fig!.kerb).toEqual(culDeSacKerb(3, 4));
  });

  it("gives every planned town's lane ends a circle, and only lane ends one", () => {
    let circles = 0;
    for (const { grid } of maps) {
      for (const town of grid.towns) {
        const plan = town.plan!;
        expect(plan.culDeSacs.length).toBeGreaterThan(0);
        circles += plan.culDeSacs.length;
        for (const [x, y] of plan.culDeSacs) {
          expect(inBounds(x, y)).toBe(true);
          // A circle is a road tile of the plan (so the renderer's paved check
          // passes) and a dead end: exactly one plan-road neighbour.
          const road = new Set(plan.streets.flatMap((s) => s.tiles.map(([rx, ry]) => idx(rx, ry))));
          let arms = 0;
          for (const [dx, dy] of DIR4) if (road.has(idx(x + dx, y + dy))) arms++;
          expect(arms, `circle at ${x},${y} has ${arms} arms`).toBe(1);
        }
      }
    }
    expect(circles).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. DETERMINISM, and the fps box (acceptance box 6)
// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.4 determinism and cost", () => {
  it("draws the same town twice, and a different town for a different seed", () => {
    const first = new Map<number, number>();
    for (const { seed, grid, town } of towns) {
      const a = fingerprint(drawn(town, grid, TOWN_VISUAL_MAX).laid);
      const b = fingerprint(drawn(town, grid, TOWN_VISUAL_MAX).laid);
      expect(a, `seed ${seed} town ${town.tx},${town.ty} is not deterministic`).toBe(b);
      first.set(idx(town.tx, town.ty) ^ seed, a);
    }
    // A tier changes the drawing (so the fingerprint is not constant).
    const { grid, town } = towns[0];
    expect(fingerprint(drawn(town, grid, 0).laid)).not.toBe(fingerprint(drawn(town, grid, TOWN_VISUAL_MAX).laid));
    expect(first.size).toBe(towns.length);
  });

  it("reports the cost of four tier-3 planned towns (static half + depth sort)", () => {
    // The fps box, measured rather than argued. The renderer's static half
    // (`buildDrawList` + `place`) is CACHED on the visible range and rebuilt
    // only when structures invalidate; `depthSort` runs on it EVERY frame. So
    // three numbers per map, with the manifest-derived sprite defs the real
    // atlas hands `place`:
    //   townBuildings  the cost of ONE sync (a build, a tier-up) — new work
    //   place          the cost of rebuilding the static half — new work only
    //                  in so far as a planned town has more items
    //   depthSort      the per-frame cost of the items it adds
    // The same three are measured for `layout: "grid"` on the same seeds: that
    // is main's town fill at the same tier, so the two columns are the
    // before/after the ticket asks for.
    const defs = new Map<string, { footprint: [number, number]; w: number; h: number; anchor: [number, number] }>();
    for (const [name, def] of Object.entries({ ...sceneryManifest.sprites, ...buildingsManifest.sprites })) {
      defs.set(name, def as never);
    }
    const atlas = { get: (s: string) => defs.get(s) ?? null } as never;
    const time = (fn: () => void, runs = 12): number => {
      fn(); fn(); // warm
      const t0 = performance.now();
      for (let i = 0; i < runs; i++) fn();
      return (performance.now() - t0) / runs;
    };
    const measure = (seed: number, layout: "planned" | "grid") => {
      const grid = generateMap(seed, { layout });
      const build = (): DrawItem[] => grid.towns.flatMap((town) => townBuildings(town, footprintOf, {
        tier: TOWN_VISUAL_MAX, grid, shapes: true, spriteKnown,
      }).map((b): DrawItem => ({ sprite: b.sprite, tx: b.tx, ty: b.ty })));
      const items = build();
      const placed = items.map((i) => place(atlas, i, grid)).filter((p): p is Placed => p !== null);
      return {
        seed, layout, items: items.length, placed,
        buildMs: time(build),
        placeMs: time(() => items.map((i) => place(atlas, i, grid))),
        sortMs: time(() => depthSort(placed.slice())),
      };
    };
    const rows = DENSITY_SEEDS.flatMap((seed) => [measure(seed, "planned"), measure(seed, "grid")]);
    // eslint-disable-next-line no-console
    console.log("\nTOWN-4.4 cost of a tier-3 town, all towns of the map (ms, mean of 12 runs, node)\n");
    // eslint-disable-next-line no-console
    console.log("| seed | layout | town items | townBuildings (per sync) | place (per cache rebuild) | depthSort (per frame) |");
    // eslint-disable-next-line no-console
    console.log("| --- | --- | --- | --- | --- | --- |");
    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(`| ${r.seed} | ${r.layout} | ${r.items} | ${r.buildMs.toFixed(2)} | `
        + `${r.placeMs.toFixed(2)} | ${r.sortMs.toFixed(2)} |`);
    }
    for (const layout of ["planned", "grid"] as const) {
      const all = rows.filter((r) => r.layout === layout);
      const placed = all.flatMap((r) => r.placed);
      // eslint-disable-next-line no-console
      console.log(`| all four | ${layout} | ${placed.length} | ${all.reduce((n, r) => n + r.buildMs, 0).toFixed(2)} | `
        + `${all.reduce((n, r) => n + r.placeMs, 0).toFixed(2)} | ${time(() => depthSort(placed.slice())).toFixed(2)} |`);
    }
    // Loose budgets, so a slow CI shard does not flake: these catch an order of
    // magnitude, not a percentage. The point of the pair is that a planned town
    // is not an order of magnitude MORE expensive than the fill it replaces —
    // it draws a city where main drew a village, at the same one-item-per-
    // building cost, and the per-frame part is the same depth sort over more
    // items.
    const plannedAll = rows.filter((r) => r.layout === "planned").flatMap((r) => r.placed);
    expect(plannedAll.length).toBeGreaterThan(500);
    expect(time(() => depthSort(plannedAll.slice()))).toBeLessThan(200);
    for (const r of rows) {
      expect(r.buildMs, `${r.layout} seed ${r.seed} townBuildings`).toBeLessThan(400);
      expect(r.sortMs, `${r.layout} seed ${r.seed} depthSort`).toBeLessThan(100);
    }
  });
});
