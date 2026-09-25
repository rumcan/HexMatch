// ══════════════════════════════════════════════════════════════════════════
// R3 (#270) — DAMS: the unit tests `src/iso/dams.ts` shipped without (#384).
//
// A dam is a two-tile STRUCTURE over one tile of a NARROW straight river: the
// river tile (its SITE, the bonus's centre) plus one bank tile the footprint
// leans onto. Everything below is pinned against the module's own constants
// (`DAM_BONUS`, `DAM_RANGE`, `SIDES`) — never a guess — and against the entry
// points the game actually calls:
//
//   • GEOMETRY  damBank / damOrigin / damFootprint / damDrawOrigin /
//     damContains / damSpan, for both axes and both sides: the footprint is
//     exactly the river crossing plus the dry half, and the DrawItem origin is
//     the site pulled back by the footprint's extent (so the renderer's
//     south-vertex anchor lands on the site's south vertex).
//   • SITES     damRiverAt / bankTileUsable / damSitesFor on small synthetic
//     rivers built the way `tests/unit/iso-bridges.test.ts` builds them (a
//     WATER stripe with `Grid.rivers` set): one narrow river gives exactly the
//     expected sites; wide water, the sea, a pond and a river mouth give none.
//   • REFUSALS  every reason `damRefusal` can give, plus E4's (#268) flat
//     footprint read — whose WATER half is exempt, which is what leaves the
//     "not-flat" reason unreachable for a two-tile footprint (pinned below as
//     the shipped behaviour, and reported in the PR).
//   • ECONOMY   damBonusAtTiles / damCityBonusAt: in range yes, out of range
//     no, and never stacked past the cap.
//   • WIRE      damsToWire ↔ damsFromWire, and what empty/null reads as.
//   • INTERACTION  a road, a rail line and a bridge all keep off a dam's
//     footprint, and a dam keeps off standing track — through the same
//     refusal entry points the game uses (`buildRefusal`, `railTileRefusal`,
//     `platformRefusal`, `previewDrag`, `railPreview`, `planBridges`).
//
// No map generation and no game boot: the fixtures are full-size grids (so
// `idx`/`tIdx` agree) with a hand-carved river, which keeps the file
// deterministic and well inside a second.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { FIELD_OCC, GRASS, TOWN_OCC, WATER, idx, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { BUILD_COSTS } from "../../src/iso/config";
import {
  DAM_BONUS, DAM_COST, DAM_RANGE, DAM_REFUSAL_TEXT, DAM_SIDES, SIDES, bankTileUsable,
  damBank, damBonusAt, damBonusAtTiles, damCityBonusAt, damContains, damDrawOrigin,
  damFootprint, damOrigin, damRefusal, damRiverAt, damSitesFor, damSpan, damsFromWire,
  damsToWire, type Dam, type DamAxis, type DamSide, type DamWire,
} from "../../src/iso/dams";
import { BRIDGE_REFUSAL_TEXT, planBridges } from "../../src/iso/bridges";
import { footprintFlatTiles } from "../../src/iso/slopes";
import {
  buildRefusal, canBuildOn, commitDrag, createTrack, hasTrack, previewDrag, tIdx,
  type Purse, type Track,
} from "../../src/iso/track";
import {
  RAIL_PRESENT, createRailState, hasRail, platformRefusal, platformTrackAt, railPreview,
  railTileRefusal, type RailState,
} from "../../src/iso/rail";

// ── fixtures ──────────────────────────────────────────────────────────────
/** A map-sized grid with nothing on it: dry grass, unoccupied, no rivers. */
function makeGrid(): Grid {
  return {
    w: MAP_W, h: MAP_H,
    terrain: new Uint8Array(MAP_W * MAP_H).fill(GRASS),
    industries: [], towns: [], publicRoads: [],
    occupancy: new Int16Array(MAP_W * MAP_H).fill(-1),
    seed: 0,
  } as Grid;
}

/** Water: RIVER water (`Grid.rivers` set) unless `river` is false (sea/lake). */
function water(grid: Grid, x: number, y: number, river = true): void {
  grid.terrain[idx(x, y)] = WATER;
  if (!river) return;
  grid.rivers = grid.rivers ?? new Uint8Array(MAP_W * MAP_H);
  grid.rivers[idx(x, y)] = 1;
}

/** A river that runs ALONG Y (a vertical stripe): water at x=10, y ∈ [y0,y1]. */
function riverAlongY(y0 = 5, y1 = 9, width = 1): Grid {
  const grid = makeGrid();
  for (let y = y0; y <= y1; y++) for (let i = 0; i < width; i++) water(grid, 10 + i, y);
  return grid;
}

/** A river that runs ALONG X (a horizontal stripe): water at y=10, x ∈ [x0,x1]. */
function riverAlongX(x0 = 5, x1 = 9, width = 1): Grid {
  const grid = makeGrid();
  for (let x = x0; x <= x1; x++) for (let i = 0; i < width; i++) water(grid, x, 10 + i);
  return grid;
}

/** A standing dam, in the shape `game.ts` pushes into `eco.dams`. */
function damAt(
  wx: number, wy: number, axis: DamAxis, side: DamSide, ownerId = 1, id = 1,
): Dam {
  return { id, owner: ownerId === 1 ? "you" : "rival", ownerId, wx, wy, axis, side };
}

/**
 * The `Grid.builtAt` the game installs (`startIsoGame`), reduced to the three
 * tags these tests need and in the game's own priority order: a DAM first (its
 * footprint would otherwise hide under the bridge tag its water tile earns),
 * then TRACK ON WATER = a bridge deck, then the railway's own tiles.
 */
function installBuiltAt(grid: Grid, dams: readonly Dam[], track: Track, rail: RailState): void {
  grid.builtAt = (x, y) => {
    if (dams.some((d) => damContains(d, x, y))) return "dam";
    if (grid.terrain[tIdx(x, y)] === WATER
      && (hasRail(rail.rail, x, y) || hasTrack(track, "dirt", x, y)
        || hasTrack(track, "road", x, y))) return "bridge";
    if (hasRail(rail.rail, x, y)) return "rail";
    return null;
  };
}

const purse: Purse = { wood: 999, stone: 999, ore: 999, grain: 999, oil: 999 };

/** Every legal (axis, side) pair — the four shapes a dam can have. */
const SHAPES: readonly { axis: DamAxis; side: DamSide; dx: number; dy: number }[] = [
  { axis: "x", side: "n", dx: 0, dy: -1 },
  { axis: "x", side: "s", dx: 0, dy: 1 },
  { axis: "y", side: "e", dx: 1, dy: 0 },
  { axis: "y", side: "w", dx: -1, dy: 0 },
];

// ══════════════════════════════════════════════════════════════════════════
describe("R3 (#270) the dam geometry", () => {
  it("pins the constants the rest of the file reads", () => {
    expect(DAM_BONUS).toBe(0.25);
    expect(DAM_RANGE).toBe(4);
    expect(DAM_COST).toEqual(BUILD_COSTS.dam);
    // A copy, not the table itself: the tool must not be able to reprice the game.
    expect(DAM_COST).not.toBe(BUILD_COSTS.dam);
    // The R-key cycle walks all four sides; each axis only leans ACROSS itself.
    expect(DAM_SIDES).toEqual(["n", "s", "e", "w"]);
    expect(SIDES).toEqual({ x: ["n", "s"], y: ["e", "w"] });
  });

  it("puts the bank across the river, on both axes and both sides", () => {
    for (const { side, dx, dy } of SHAPES) {
      expect(damBank({ wx: 10, wy: 10, side })).toEqual([10 + dx, 10 + dy]);
    }
    // The bank is never ALONG the river: a river along x has no east/west bank.
    for (const side of SIDES.x) expect(damBank({ wx: 10, wy: 10, side })[0]).toBe(10);
    for (const side of SIDES.y) expect(damBank({ wx: 10, wy: 10, side })[1]).toBe(10);
  });

  it("the footprint is exactly the river crossing plus the dry half", () => {
    for (const { axis, side, dx, dy } of SHAPES) {
      // The river the shape belongs to: a footprint leaning across a river
      // that runs along x stands at (7,10), one along y at (10,7).
      const [sx, sy] = axis === "x" ? [7, 10] : [10, 7];
      const grid = axis === "x" ? riverAlongX() : riverAlongY();
      const d = damAt(sx, sy, axis, side);
      const fp = damFootprint(d);
      expect(fp).toHaveLength(2);
      expect(fp[0]).toEqual([sx, sy]);                 // the SITE, first
      expect(fp[1]).toEqual([sx + dx, sy + dy]);       // the bank it leans onto
      // One tile of river water, one tile of dry land — the crossing plus the
      // dry half, and nothing else: a dam is not a bridge, it carries no deck.
      expect(grid.terrain[idx(...fp[0])]).toBe(WATER);
      expect(grid.terrain[idx(...fp[1])]).not.toBe(WATER);
      // `damContains` is exactly that pair, and no tile beside it.
      expect(damContains(d, sx, sy)).toBe(true);
      expect(damContains(d, sx + dx, sy + dy)).toBe(true);
      for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const [x, y] = [sx + ox, sy + oy];
        if (x === sx + dx && y === sy + dy) continue;
        expect(damContains(d, x, y), `${side} must not cover ${x},${y}`).toBe(false);
      }
    }
  });

  it("origin and span box the footprint, and the draw origin re-finds the site", () => {
    for (const { axis, side, dx, dy } of SHAPES) {
      const d = damAt(7, 10, axis, side);
      const [fw, fh] = damSpan(d);
      expect([fw, fh]).toEqual(axis === "x" ? [1, 2] : [2, 1]);
      const [ox, oy] = damOrigin(d);
      // The origin is the footprint box's TOP corner …
      expect([ox, oy]).toEqual([Math.min(7, 7 + dx), Math.min(10, 10 + dy)]);
      // … and origin + span − 1 its bottom one: the box holds both tiles.
      expect([ox + fw - 1, oy + fh - 1]).toEqual([Math.max(7, 7 + dx), Math.max(10, 10 + dy)]);
      // The DrawItem origin is the SITE pulled back by the same extent, so the
      // renderer's south-vertex anchor (the box's LAST tile) lands on the site.
      const [dx0, dy0] = damDrawOrigin(d);
      expect([dx0, dy0]).toEqual([7 - (fw - 1), 10 - (fh - 1)]);
      expect([dx0 + fw - 1, dy0 + fh - 1]).toEqual([7, 10]);
    }
    // Spelled out, the two cases the renderer's sprites are cut for.
    expect(damDrawOrigin(damAt(7, 10, "x", "n"))).toEqual([7, 9]);     // `dam_y`, 1×2
    expect(damDrawOrigin(damAt(7, 10, "x", "s"))).toEqual([7, 9]);
    expect(damDrawOrigin(damAt(7, 10, "y", "e"))).toEqual([6, 10]);    // `dam_x`, 2×1
    expect(damDrawOrigin(damAt(7, 10, "y", "w"))).toEqual([6, 10]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("R3 (#270) the site rule", () => {
  it("one narrow river gives exactly the sites on its straight section", () => {
    const alongY = damSitesFor(riverAlongY(5, 9));
    expect(alongY).toEqual([5, 6, 7, 8, 9].map((wy) => ({
      wx: 10, wy, axis: "y", sides: ["e", "w"],
    })));
    const alongX = damSitesFor(riverAlongX(5, 9));
    expect(alongX).toEqual([5, 6, 7, 8, 9].map((wx) => ({
      wx, wy: 10, axis: "x", sides: ["n", "s"],
    })));
    // Row-major, `n` before `s`, `e` before `w`: the enumeration the rival's
    // planner values is a pure function of the map.
    const rows = alongY.map((s) => s.wy * MAP_W + s.wx);
    expect([...rows].sort((a, b) => a - b)).toEqual(rows);
    for (const s of [...alongY, ...alongX]) expect(s.sides).toEqual([...SIDES[s.axis]]);
  });

  it("reads the river's axis off the run, tile by tile", () => {
    const vy = riverAlongY();
    expect(damRiverAt(vy, 10, 7)).toEqual({ axis: "y" });
    expect(damRiverAt(vy, 9, 7)).toEqual({ why: "not-river" });   // the bank is land
    const hx = riverAlongX();
    expect(damRiverAt(hx, 7, 10)).toEqual({ axis: "x" });
    // Both ends of a straight run are still sites — the section is the run.
    expect(damRiverAt(vy, 10, 5)).toEqual({ axis: "y" });
    expect(damRiverAt(vy, 10, 9)).toEqual({ axis: "y" });
  });

  it("gives no site on wide water, the sea, a pond or a river mouth", () => {
    // A 2-tile channel: every tile sees river water on BOTH axes, so it reads
    // as a bend — there are no banks to speak of.
    const wide = riverAlongY(5, 9, 2);
    expect(damSitesFor(wide)).toEqual([]);
    expect(damRiverAt(wide, 10, 7)).toEqual({ why: "bend" });
    expect(damRiverAt(wide, 11, 7)).toEqual({ why: "bend" });

    // The sea and a lake are water WITHOUT the river mask: never dam-able,
    // exactly as they are never bridgeable (#266).
    const sea = makeGrid();
    for (let y = 0; y < 12; y++) for (let x = 4; x < 16; x++) water(sea, x, y, false);
    expect(damSitesFor(sea)).toEqual([]);
    expect(damRiverAt(sea, 10, 5)).toEqual({ why: "not-river" });

    // One tile of river water is a pond: no run, so no "across".
    const pond = makeGrid();
    water(pond, 10, 10);
    expect(damRiverAt(pond, 10, 10)).toEqual({ why: "no-section" });
    expect(damSitesFor(pond)).toEqual([]);

    // With the `rivers` option off there is no mask at all: no site, ever.
    const off = riverAlongY();
    delete off.rivers;
    expect(damSitesFor(off)).toEqual([]);
    expect(damRiverAt(off, 10, 7)).toEqual({ why: "not-river" });

    // A river MOUTH: the run widens to two tiles where it meets the sea, so
    // the mouth tiles are a bend (the widened pair) and "wide" (the tile with
    // the sea on its bank), and the sea beyond is not river water at all.
    const mouth = riverAlongY(5, 11);
    water(mouth, 11, 11);
    for (let x = 8; x <= 13; x++) for (let y = 12; y <= 15; y++) water(mouth, x, y, false);
    expect(damRiverAt(mouth, 10, 11)).toEqual({ why: "bend" });
    expect(damRiverAt(mouth, 11, 11)).toEqual({ why: "wide" });
    expect(damRiverAt(mouth, 10, 12)).toEqual({ why: "not-river" });
    expect(damSitesFor(mouth).some((s) => s.wy >= 11)).toBe(false);
    // …while the straight reach above the mouth is still dam-able.
    expect(damRiverAt(mouth, 10, 10)).toEqual({ axis: "y" });

    // A river along the map's edge has no bank across it: "wide", not a site.
    const edge = riverAlongX(5, 9, 1);
    for (let x = 5; x <= 9; x++) {                       // move the run to y=0
      edge.terrain[idx(x, 10)] = GRASS;
      edge.rivers![idx(x, 10)] = 0;
      water(edge, x, 0);
    }
    expect(damRiverAt(edge, 7, 0)).toEqual({ why: "wide" });
    expect(damSitesFor(edge)).toEqual([]);
  });

  it("a bend in the river has no banks, but the reaches either side do", () => {
    const bend = makeGrid();
    for (let x = 8; x <= 12; x++) water(bend, x, 10);
    for (let y = 11; y <= 14; y++) water(bend, 12, y);
    expect(damRiverAt(bend, 12, 10)).toEqual({ why: "bend" });
    const sites = damSitesFor(bend);
    expect(sites.some((s) => s.wx === 12 && s.wy === 10)).toBe(false);
    // The straight reach west of the corner and the one south of it both dam.
    expect(sites).toContainEqual({ wx: 10, wy: 10, axis: "x", sides: ["n", "s"] });
    expect(sites).toContainEqual({ wx: 12, wy: 12, axis: "y", sides: ["e", "w"] });
  });

  it("bankTileUsable wants dry, unowned, unstamped, in-bounds land", () => {
    const grid = riverAlongY();
    expect(bankTileUsable(grid, 9, 7)).toBe(true);
    expect(bankTileUsable(grid, 11, 7)).toBe(true);
    expect(bankTileUsable(grid, 10, 7)).toBe(false);          // river water
    expect(bankTileUsable(grid, -1, 7)).toBe(false);          // off the map
    expect(bankTileUsable(grid, MAP_W, 7)).toBe(false);
    expect(bankTileUsable(grid, 9, MAP_H)).toBe(false);

    const industry = riverAlongY();
    industry.occupancy[idx(9, 7)] = 0;                        // an industry tile
    expect(bankTileUsable(industry, 9, 7)).toBe(false);
    const town = riverAlongY();
    town.occupancy[idx(9, 7)] = TOWN_OCC;
    expect(bankTileUsable(town, 9, 7)).toBe(false);
    const field = riverAlongY();
    field.occupancy[idx(9, 7)] = FIELD_OCC;                   // a wheat field / tree block
    expect(bankTileUsable(field, 9, 7)).toBe(false);

    // Anything `builtAt` reports — the game's own "something stands here".
    for (const built of ["depot", "plant", "platform", "bridge", "dam", "rail"] as const) {
      const g = riverAlongY();
      g.builtAt = (x, y) => (x === 9 && y === 7 ? built : null);
      expect(bankTileUsable(g, 9, 7), built).toBe(false);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("R3 (#270) the refusals", () => {
  it("answers ok on a legal site, and bad-side across the river's axis", () => {
    const grid = riverAlongY();
    expect(damRefusal(grid, [], 1, 10, 7, "e")).toBe("ok");
    expect(damRefusal(grid, [], 1, 10, 7, "w")).toBe("ok");
    // A river along y has no north/south bank: the footprint would lean ALONG
    // the water instead of across it.
    expect(damRefusal(grid, [], 1, 10, 7, "n")).toBe("bad-side");
    expect(damRefusal(grid, [], 1, 10, 7, "s")).toBe("bad-side");
    const along = riverAlongX();
    expect(damRefusal(along, [], 1, 7, 10, "n")).toBe("ok");
    expect(damRefusal(along, [], 1, 7, 10, "e")).toBe("bad-side");
  });

  it("gives every reason it can", () => {
    const grid = riverAlongY();
    expect(damRefusal(makeGrid(), [], 1, 10, 7, "n")).toBe("not-river");
    const pond = makeGrid();
    water(pond, 10, 10);
    expect(damRefusal(pond, [], 1, 10, 10, "n")).toBe("no-section");
    expect(damRefusal(riverAlongY(5, 9, 2), [], 1, 10, 7, "e")).toBe("bend");
    const wideBank = riverAlongX();
    for (let x = 4; x <= 10; x++) water(wideBank, x, 9, false);   // sea on the north bank
    expect(damRefusal(wideBank, [], 1, 7, 10, "n")).toBe("wide");

    // One owner per site — ANY dam, either seat's, closes it.
    expect(damRefusal(grid, [damAt(10, 7, "y", "e", 1)], 1, 10, 7, "e")).toBe("site-taken");
    expect(damRefusal(grid, [damAt(10, 7, "y", "e", 1)], 2, 10, 7, "w")).toBe("site-taken");
    // …but a dam elsewhere on the same river leaves this site open.
    expect(damRefusal(grid, [damAt(10, 8, "y", "e", 1)], 1, 10, 7, "e")).toBe("ok");

    // A bridge deck already crosses the water: one structure per site.
    const bridged = riverAlongY();
    bridged.builtAt = (x, y) => (x === 10 && y === 7 ? "bridge" : null);
    expect(damRefusal(bridged, [], 1, 10, 7, "e")).toBe("crossed");

    // The bank is not clear: water, industry, town, field, or a built thing.
    const blocked = riverAlongY();
    blocked.occupancy[idx(11, 7)] = 0;
    expect(damRefusal(blocked, [], 1, 10, 7, "e")).toBe("bank-blocked");
    expect(damRefusal(blocked, [], 1, 10, 7, "w")).toBe("ok");       // the other bank is free
    const built = riverAlongY();
    built.builtAt = (x, y) => (x === 11 && y === 7 ? "platform" : null);
    expect(damRefusal(built, [], 1, 10, 7, "e")).toBe("bank-blocked");
  });

  it("words every refusal, and every wording says what is wrong", () => {
    // The whole `DamRefusal` vocabulary: not-river, no-section, bend, wide,
    // site-taken, crossed, bad-side, bank-blocked, not-flat.
    const keys = Object.keys(DAM_REFUSAL_TEXT);
    expect(keys.length).toBe(9);
    for (const k of keys) expect(DAM_REFUSAL_TEXT[k as keyof typeof DAM_REFUSAL_TEXT].length)
      .toBeGreaterThan(0);
    expect(DAM_REFUSAL_TEXT["not-river"]).toMatch(/river/i);
    expect(DAM_REFUSAL_TEXT["wide"]).toMatch(/wide/i);
    expect(DAM_REFUSAL_TEXT["not-flat"]).toMatch(/flat/i);
  });

  it("E4 (#268): the water half is exempt, so a bank a level up still dams", () => {
    // A river cut into a plateau: the water is level 0, both banks level 1 —
    // the ordinary case, per slopes.ts (51 of the 52 river-bank tiles it
    // measured on seed 1337 are level 1).
    const grid = riverAlongY();
    grid.height = new Uint8Array(MAP_W * MAP_H);
    for (let y = 5; y <= 9; y++) {
      grid.height[idx(9, y)] = 1;
      grid.height[idx(11, y)] = 1;
    }
    // The footprint's LAND tiles are one (the bank), and one tile cannot
    // straddle a level change — the water half is not graded at all.
    expect(footprintFlatTiles(grid, damFootprint({ wx: 10, wy: 7, side: "e" }))).toBeNull();
    expect(damRefusal(grid, [], 1, 10, 7, "e")).toBe("ok");
    expect(damRefusal(grid, [], 1, 10, 7, "w")).toBe("ok");
    // A flat bank is no different, and the refusal vocabulary is the same one
    // the platform and plant rules use (#268's shared flat-footprint read).
    expect(damRefusal(riverAlongY(), [], 1, 10, 7, "e")).toBe("ok");
    // NOTE (#384): because a dam's footprint holds exactly ONE land tile, the
    // flat read can never find two land tiles to disagree — `"not-flat"` is in
    // the vocabulary and the wording table, but unreachable through
    // `damRefusal`. Pinned as the shipped behaviour, not asserted as intended;
    // the follow-up is in the PR.
    for (const side of SIDES.y) {
      expect(damRefusal(grid, [], 1, 10, 7, side)).not.toBe("not-flat");
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("R3 (#270) the bonus", () => {
  it("reaches a tile at DAM_RANGE and no further, measured from the SITE", () => {
    const d = damAt(10, 10, "y", "e");                    // bank (11,10)
    for (let r = 0; r <= DAM_RANGE; r++) {
      expect(damBonusAtTiles([d], 1, [[10 + r, 10]]), `+${r} east`).toBe(DAM_BONUS);
      expect(damBonusAtTiles([d], 1, [[10, 10 + r]]), `+${r} south`).toBe(DAM_BONUS);
    }
    expect(damBonusAtTiles([d], 1, [[10 + DAM_RANGE + 1, 10]])).toBe(0);
    expect(damBonusAtTiles([d], 1, [[10, 10 - DAM_RANGE - 1]])).toBe(0);
    // Manhattan, from the SITE — not from the bank tile the sprite leans on:
    // (15,10) is 4 tiles from the BANK but 5 from the site, so it is out.
    expect(damBonusAtTiles([d], 1, [[15, 10]])).toBe(0);
    expect(damBonusAtTiles([d], 1, [[6, 10]])).toBe(DAM_BONUS);   // 4 west of the site
    // A diagonal counts both axes.
    expect(damBonusAtTiles([d], 1, [[12, 12]])).toBe(DAM_BONUS);  // 2 + 2
    expect(damBonusAtTiles([d], 1, [[13, 12]])).toBe(0);          // 3 + 2
  });

  it("reaches a Depot through the NEAREST tile of its lot", () => {
    const d = damAt(10, 10, "y", "e");
    // A truck Depot's 2×2 lot: one tile in range is enough.
    const lot: [number, number][] = [[13, 9], [14, 9], [13, 10], [14, 10]];
    expect(damBonusAtTiles([d], 1, lot)).toBe(DAM_BONUS);         // (13,10) is 3 away
    const far: [number, number][] = [[15, 9], [16, 9], [15, 10], [16, 10]];
    expect(damBonusAtTiles([d], 1, far)).toBe(0);
    expect(damBonusAt([d], 1, 13, 10)).toBe(DAM_BONUS);
  });

  it("never stacks past the cap, and is the owner's alone", () => {
    const a = damAt(10, 10, "y", "e", 1, 1);
    const b = damAt(11, 10, "y", "w", 1, 2);
    const c = damAt(10, 12, "y", "e", 1, 3);
    // Three of the owner's dams all reach the tile: one DAM_BONUS, not three.
    expect(damBonusAtTiles([a, b, c], 1, [[10, 10]])).toBe(DAM_BONUS);
    // The rival's dam is a threat to see, not a bonus to spend.
    expect(damBonusAtTiles([damAt(10, 10, "y", "e", 2)], 1, [[10, 10]])).toBe(0);
    expect(damBonusAtTiles([damAt(10, 10, "y", "e", 1)], 2, [[10, 10]])).toBe(0);
    // No owner id, no bonus.
    expect(damBonusAtTiles([a], 0, [[10, 10]])).toBe(0);
  });

  it("reads no dams, and no tiles, as no bonus", () => {
    expect(damBonusAtTiles(null, 1, [[10, 10]])).toBe(0);
    expect(damBonusAtTiles(undefined, 1, [[10, 10]])).toBe(0);
    expect(damBonusAtTiles([], 1, [[10, 10]])).toBe(0);
    expect(damBonusAtTiles([damAt(10, 10, "y", "e")], 1, [])).toBe(0);
  });

  it("the city half follows the same range, and a missing city pays nothing", () => {
    const d = damAt(10, 10, "y", "e");
    expect(damCityBonusAt([d], 1, { tx: 10 + DAM_RANGE, ty: 10 })).toBe(DAM_BONUS);
    expect(damCityBonusAt([d], 1, { tx: 10 + DAM_RANGE + 1, ty: 10 })).toBe(0);
    expect(damCityBonusAt([d], 1, { tx: 60, ty: 60 })).toBe(0);
    expect(damCityBonusAt([d], 1, null)).toBe(0);
    expect(damCityBonusAt([d], 1, undefined)).toBe(0);
    expect(damCityBonusAt(null, 1, { tx: 10, ty: 10 })).toBe(0);
    expect(damCityBonusAt([damAt(10, 10, "y", "e", 2)], 1, { tx: 10, ty: 10 })).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("R3 (#270) the wire and saves", () => {
  it("round-trips a dam, field for field, in every shape", () => {
    const dams = SHAPES.map(({ axis, side }, i) => damAt(10 + i, 10, axis, side, 1, i + 1));
    const wire = damsToWire(dams);
    expect(wire).toHaveLength(SHAPES.length);
    expect(damsFromWire(wire)).toEqual(dams);
    // The wire is the record minus nothing: the map regenerates the site.
    expect(wire![0]).toEqual({
      id: 1, owner: "you", ownerId: 1, wx: 10, wy: 10, axis: "x", side: "n",
    });
    // A JSON save/snapshot round-trip is the same rows.
    expect(damsFromWire(JSON.parse(JSON.stringify(wire)) as DamWire[])).toEqual(dams);
  });

  it("reads an empty world as undefined out and [] back in", () => {
    expect(damsToWire([])).toBeUndefined();          // the field is simply absent
    expect(damsFromWire([])).toEqual([]);
    expect(damsFromWire(null)).toEqual([]);
    expect(damsFromWire(undefined)).toEqual([]);
    // A pre-dam save carries no field at all; the loader's `dams?.` reads [].
    expect(damsFromWire(({} as { dams?: DamWire[] }).dams)).toEqual([]);
  });

  it("drops a malformed row and keeps the good ones beside it", () => {
    const good = damAt(10, 10, "y", "e", 1, 7);
    const row = damsToWire([good])![0];
    const bad: (DamWire | null)[] = [
      { ...row, axis: "z" },                          // not an axis
      { ...row, side: "n" },                          // not across THIS axis
      { ...row, wx: -1 },                             // off the map
      { ...row, wy: MAP_H },
      { ...row, wx: 1.5 },                            // not a tile
      { ...row, ownerId: 0 },                         // no such seat
      { ...row, ownerId: 2.5 },
      { ...row, owner: 5 as unknown as string },      // not a name
      null,
      undefined as unknown as DamWire,
    ];
    const parsed = damsFromWire([bad[0], row, ...bad.slice(1)] as DamWire[]);
    expect(parsed).toEqual([good]);
    // An all-bad list reads as an empty one, which is the map it came from.
    expect(damsFromWire(bad.filter(Boolean) as DamWire[])).toEqual([]);
    // A duplicate site is a lie: one owner per site, on the wire too.
    expect(damsFromWire([row, { ...row, ownerId: 2, id: 9 }])).toEqual([good]);
    // A row with no usable id still stands — the site is the identity.
    expect(damsFromWire([{ ...row, id: 0 }])[0].id).toBe(0);
    expect(damsFromWire([{ ...row, id: -3 }])[0].id).toBe(0);
    expect(damsFromWire([{ ...row, id: 4 }])[0].id).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("R3 (#270) the dam and the other builders", () => {
  /** A dam standing at (10,7) on a river along y, with the game's `builtAt`. */
  function standing(side: DamSide = "e"): { grid: Grid; track: Track; rail: RailState; dams: Dam[] } {
    const grid = riverAlongY();
    const track = createTrack();
    const rail = createRailState();
    const dams = [damAt(10, 7, "y", side)];
    installBuiltAt(grid, dams, track, rail);
    return { grid, track, rail, dams };
  }

  it("a road may not pave either tile of the footprint", () => {
    const { grid, track } = standing("e");
    const [bx, by] = damBank({ wx: 10, wy: 7, side: "e" });
    // The bank is dry land the map would otherwise pave — the dam tag is what
    // protects it, exactly like a platform's or a Depot's lot.
    expect(grid.builtAt!(bx, by)).toBe("dam");
    expect(buildRefusal(grid, "dirt", bx, by)).toBe("occupied");
    expect(buildRefusal(grid, "road", bx, by)).toBe("occupied");
    expect(canBuildOn(grid, "dirt", bx, by)).toBe(false);
    // The site is water, and water answers before the built tag does.
    expect(grid.builtAt!(10, 7)).toBe("dam");
    expect(buildRefusal(grid, "dirt", 10, 7)).toBe("water");
    // …and a tile two off the river is ordinary ground again.
    expect(buildRefusal(grid, "dirt", 13, 7)).toBeNull();
    // A whole drag from the free bank to the dam's bank dies at the water, and
    // paints both the site and the dam's footing as the obstacle it ran into.
    const pv = previewDrag(grid, track, "dirt", purse, 9, 7, 11, 7, true,
      undefined, 0, undefined, false, { railAt: () => false });
    expect(pv.bridges).toBe(0);
    expect(pv.tiles).toEqual([[9, 7]]);
    expect(pv.truncated).toBe(true);
    expect(pv.blocked).toEqual([[10, 7], [11, 7]]);      // the site, then the dam's bank
  });

  it("a rail line may not run over the footprint", () => {
    const { grid, track, rail } = standing("e");
    const [bx, by] = damBank({ wx: 10, wy: 7, side: "e" });
    expect(railTileRefusal(grid, track, rail, 1, bx, by)).toBe("occupied");
    expect(railTileRefusal(grid, track, rail, 1, 10, 7)).toBe("water");
    // The same line as a rail drag, laid from the free bank: the deck is
    // refused and the drag stops before the water.
    const pv = railPreview(grid, track, rail, 1, purse, 9, 7, 11, 7, true);
    expect(pv.bridges).toBe(0);
    expect(pv.why).toBe("water");
    expect(pv.tiles).toEqual([[9, 7]]);
  });

  it("a platform keeps off the footprint, and off the dam as its track side", () => {
    const { grid } = standing("e");
    const [bx, by] = damBank({ wx: 10, wy: 7, side: "e" });       // (11,7)
    // Footprint ON the bank: "occupied", like any other standing structure.
    expect(platformRefusal(grid, [], [], 1, bx, by - 2, "se")).toBe("occupied");
    // Footprint clear, but the bank is one of its three track tiles.
    const at: [number, number] = [11, 6];
    expect(platformTrackAt(at[0], at[1], "sw")).toContainEqual([bx, by]);
    expect(platformRefusal(grid, [], [], 1, at[0], at[1], "sw")).toBe("track-blocked");
  });

  it("a bridge may not be laid over the dam's water — the site is taken", () => {
    const { grid, track, rail, dams } = standing("e");
    const path: [number, number][] = [[9, 7], [10, 7], [11, 7]];
    const plan = planBridges(grid, path, () => false, () => false);
    expect(plan.runs.size).toBe(0);
    expect(plan.refusal?.why).toBe("shared");
    expect(BRIDGE_REFUSAL_TEXT.shared).toMatch(/already/i);
    // The rail layer reads the same tag through its own plan.
    const railPlan = railPreview(grid, track, rail, 1, purse, 9, 7, 11, 7, true);
    expect(railPlan.bridges).toBe(0);
    expect(railPlan.why).toBe("water");
    // And with the dam gone the same crossing bridges again — the site is the
    // river's, not the dam's.
    dams.length = 0;
    const free = planBridges(grid, path, () => false, () => false);
    expect([...free.deckTiles]).toEqual([tIdx(10, 7)]);
    expect(free.refusal).toBeNull();
  });

  it("a dam may not be placed over standing track", () => {
    // A rail line on the bank tile: the bank is not clear.
    const grid = riverAlongY();
    const track = createTrack();
    const rail = createRailState();
    installBuiltAt(grid, [], track, rail);
    rail.rail.tile[tIdx(11, 7)] = RAIL_PRESENT | 0b1010;   // a straight pair along x
    rail.rail.owner[tIdx(11, 7)] = 1;
    expect(grid.builtAt!(11, 7)).toBe("rail");
    expect(damRefusal(grid, [], 1, 10, 7, "e")).toBe("bank-blocked");
    expect(damRefusal(grid, [], 1, 10, 7, "w")).toBe("ok");

    // A bridge deck on the site: one structure per crossing.
    const bridged = riverAlongY();
    const bTrack = createTrack();
    const bRail = createRailState();
    installBuiltAt(bridged, [], bTrack, bRail);
    const deck = previewDrag(bridged, bTrack, "dirt", purse, 9, 7, 11, 7, true,
      undefined, 0, undefined, false, { railAt: () => false });
    expect(deck.bridges).toBe(1);
    commitDrag(bTrack, "dirt", deck, 1);
    expect(bridged.builtAt!(10, 7)).toBe("bridge");
    expect(damRefusal(bridged, [], 1, 10, 7, "e")).toBe("crossed");
    expect(damRefusal(bridged, [], 1, 10, 7, "w")).toBe("crossed");   // either side

    // A Depot lot or a plant on the bank refuses the same way — the game's own
    // `builtAt` is the one report every builder shares.
    for (const built of ["depot", "plant", "platform", "dam"] as const) {
      const g = riverAlongY();
      g.builtAt = (x, y) => (x === 11 && y === 7 ? built : null);
      expect(damRefusal(g, [], 1, 10, 7, "e"), built).toBe("bank-blocked");
    }
  });
});
