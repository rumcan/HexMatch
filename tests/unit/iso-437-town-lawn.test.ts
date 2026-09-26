// ══════════════════════════════════════════════════════════════════════════
// #437 — no town block and no apron renders as bare brown dirt.
//
// The owner's report: "the empty lots inside town blocks, and the ground
// around the houses, are bare brown dirt. It reads as mud." There were two
// independent sources, and this suite pins both.
//
//   1. THE 2D PASS. `paintTownGround` fills every town-block tile with
//      `RoadStyle.town`, which used to be the DIRT road texture under a
//      grey-brown wash. It is now the grass texture under a thin green glaze
//      — a mown lawn. Pinned here as: the town material is green, it is not
//      the dirt material, and the glaze is green too.
//
//   2. THE TERRAIN SHADER. The WebGL2 ground blends grass / meadow / DIRT
//      from low-frequency noise with no idea where the towns are, so a dirt
//      blob could (and did) land on a town or on the cleared ground around an
//      industry. `settledGroundBytes` now feeds the renderer a tended-ground
//      mask, `buildFields` grows the apron off it, and the shader multiplies
//      the dirt weight by (1 - lawn). Pinned here as: the mask covers every
//      town tile and every industry tile on real maps, the baked field is
//      fully tended on all of them, and the shader still carries the factor
//      that zeroes the dirt material there.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import {
  FIELD_OCC, TOWN_OCC, WATER, generateMap, settledGroundBytes,
} from "../../src/iso/grid";
import { MAP_H, MAP_W } from "../../src/iso/config";
import { terrainMapInput } from "../../src/iso/terrain-gl-adapter";
import { TERRAIN_FS } from "../../src/iso/terrain-gl/shaders";
import {
  LAWN_FEATHER, buildFields, encodeLawn, updateFieldsRegion,
  type TerrainMapInput,
} from "../../src/iso/terrain-gl/mesh";
import { DEFAULT_ROAD_STYLE, TOWN_GROUND_WASH } from "../../src/iso/road-renderer";

const SEEDS = [7, 42, 199, 1337];

/** "#rrggbb" → [r, g, b]. */
function hex(c: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (!m) throw new Error(`not a hex colour: ${c}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** "rgba(r,g,b,a)" → [r, g, b, a]. */
function rgba(c: string): [number, number, number, number] {
  const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/.exec(c);
  if (!m) throw new Error(`not an rgba colour: ${c}`);
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

// ── 1. the 2D town-block fill ──────────────────────────────────────────────
describe("#437 the 2D town-block ground is a lawn, not dirt", () => {
  it("paints town blocks with a GREEN material", () => {
    const [r, g, b] = hex(DEFAULT_ROAD_STYLE.town.flat);
    expect(g, "green dominates red").toBeGreaterThan(r);
    expect(g, "green dominates blue").toBeGreaterThan(b);
    // A brown is red-dominant (the old #4b463d was r >= g > b). Whatever the
    // exact shade, a town block must never be warmer than it is green again.
    expect(r, "not a brown: red must not lead").toBeLessThan(g);
  });

  it("does not reuse the dirt road material for town blocks", () => {
    expect(DEFAULT_ROAD_STYLE.town.flat).not.toBe(DEFAULT_ROAD_STYLE.dirt.flat);
    const [tr, tg] = hex(DEFAULT_ROAD_STYLE.town.flat);
    const [dr, dg] = hex(DEFAULT_ROAD_STYLE.dirt.flat);
    // The dirt material is red-dominant; the town material must not be.
    expect(dr).toBeGreaterThan(dg);
    expect(tr).toBeLessThan(tg);
  });

  it("glazes the block with a green wash, not a grey-brown one", () => {
    const [r, g, b, a] = rgba(TOWN_GROUND_WASH);
    expect(g, "the glaze is green").toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    // A glaze, not a coat of paint: the grass grain has to survive it.
    expect(a).toBeGreaterThan(0);
    expect(a, "must not flatten the texture into a flat colour").toBeLessThan(0.35);
  });

  it("keeps the shoulder in the same green family as the fill", () => {
    const [r, g, b] = hex(DEFAULT_ROAD_STYLE.town.shoulder);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });
});

// ── 2. the tended-ground mask ──────────────────────────────────────────────
describe("#437 settledGroundBytes covers every town block and industry", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: every town tile and every industry tile is settled`, () => {
      const grid = generateMap(seed);
      const settled = settledGroundBytes(grid);
      expect(settled, "a generated map always has towns and industries").not.toBeNull();
      expect(grid.towns.length).toBeGreaterThan(0);
      expect(grid.industries.length).toBeGreaterThan(0);

      for (const t of grid.towns) {
        for (const [x, y] of t.houses) {
          expect(settled![y * MAP_W + x], `town ${t.id} house (${x},${y})`).toBe(1);
        }
        for (const [x, y] of t.roads) {
          expect(settled![y * MAP_W + x], `town ${t.id} street (${x},${y})`).toBe(1);
        }
      }
      for (const ind of grid.industries) {
        for (let dy = 0; dy < ind.h; dy++) {
          for (let dx = 0; dx < ind.w; dx++) {
            const x = ind.tx + dx, y = ind.ty + dy;
            expect(settled![y * MAP_W + x], `${ind.type} (${x},${y})`).toBe(1);
          }
        }
      }
    });

    it(`seed ${seed}: open ground and standing crops are NOT settled`, () => {
      const grid = generateMap(seed);
      const settled = settledGroundBytes(grid)!;
      let open = 0, fields = 0;
      for (let i = 0; i < settled.length; i++) {
        if (grid.occupancy[i] === -1) { open++; expect(settled[i]).toBe(0); }
        if (grid.occupancy[i] === FIELD_OCC) { fields++; expect(settled[i]).toBe(0); }
      }
      // Guard the guard: the assertions above must actually have run.
      expect(open, "the map has open ground").toBeGreaterThan(1000);
      expect(fields + open, "…and the loop visited it").toBeGreaterThan(1000);
    });
  }

  it("is cached per grid (the towns never move during a game)", () => {
    const grid = generateMap(7);
    expect(settledGroundBytes(grid)).toBe(settledGroundBytes(grid));
  });

  it("marks nothing when the map has neither towns nor industries", () => {
    const grid = generateMap(7);
    const bare = { ...grid, occupancy: new Int16Array(MAP_W * MAP_H).fill(-1) };
    expect(settledGroundBytes(bare)).toBeNull();
  });
});

// ── 3. the baked field the shader samples ──────────────────────────────────
describe("#437 no town-block or apron tile resolves to the dirt material", () => {
  it("encodeLawn is fully tended inside and fades to nothing at LAWN_FEATHER", () => {
    expect(encodeLawn(-4)).toBe(255);      // deep inside a town
    expect(encodeLawn(-0.5)).toBe(255);    // just inside the boundary
    expect(encodeLawn(0)).toBe(255);       // on the boundary
    expect(encodeLawn(LAWN_FEATHER)).toBe(0);
    expect(encodeLawn(LAWN_FEATHER + 5)).toBe(0);
    // …and it is monotone across the apron in between.
    let prev = 256;
    for (let d = 0; d <= LAWN_FEATHER; d += 0.25) {
      const v = encodeLawn(d);
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: the baked lawn field is FULL on every town and industry tile`, () => {
      const grid = generateMap(seed);
      const map = terrainMapInput(grid, seed);
      expect(map.settled, "the adapter hands the mask to the renderer").toBeDefined();
      const fields = buildFields(map);

      for (const t of grid.towns) {
        for (const [x, y] of t.houses) {
          const i = y * MAP_W + x;
          if (grid.terrain[i] === WATER) continue;   // a sunken tile is sea, not lawn
          expect(fields.lawn[i], `town ${t.id} lot (${x},${y}) is bare earth`).toBe(255);
        }
      }
      for (const ind of grid.industries) {
        for (let dy = 0; dy < ind.h; dy++) {
          for (let dx = 0; dx < ind.w; dx++) {
            const i = (ind.ty + dy) * MAP_W + ind.tx + dx;
            if (grid.terrain[i] === WATER) continue;
            expect(fields.lawn[i], `${ind.type} yard is bare earth`).toBe(255);
          }
        }
      }
    });

    it(`seed ${seed}: the apron around a town is tended, and the wild map is not`, () => {
      const grid = generateMap(seed);
      const fields = buildFields(terrainMapInput(grid, seed));
      const town = grid.towns[0];

      // A ring one tile outside the town's own tiles is still tended ground:
      // that ring IS the apron the ticket calls out.
      let apron = 0, checked = 0;
      for (const [x, y] of town.houses) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const i = ny * MAP_W + nx;
          if (grid.occupancy[i] === TOWN_OCC || grid.terrain[i] === WATER) continue;
          checked++;
          if (fields.lawn[i] > 0) apron++;
        }
      }
      expect(checked, "the town has ground beside it").toBeGreaterThan(0);
      expect(apron, "every tile touching a town block is apron").toBe(checked);

      // …and the mask is a local thing, not a flood over the whole map.
      let wild = 0;
      for (let i = 0; i < fields.lawn.length; i++) if (fields.lawn[i] === 0) wild++;
      expect(wild, "most of the map is still wild ground").toBeGreaterThan(fields.lawn.length * 0.5);
    });
  }

  it("leaves the lawn field empty for a map with no settled tiles", () => {
    const w = 24, h = 24;
    const map: TerrainMapInput = { w, h, terrain: new Uint8Array(w * h), seed: 3 };
    const fields = buildFields(map);
    expect(fields.lawn.length).toBe(w * h);
    expect([...fields.lawn].every((v) => v === 0)).toBe(true);
  });

  it("a region update leaves the lawn field identical to a full rebuild", () => {
    const w = 40, h = 40;
    const terrain = new Uint8Array(w * h);
    const settled = new Uint8Array(w * h);
    for (let y = 10; y < 16; y++) for (let x = 12; x < 18; x++) settled[y * w + x] = 1;
    const map: TerrainMapInput = { w, h, terrain, settled, seed: 5 };
    const fields = buildFields(map);

    // Grow the settlement by a block, then update only that window.
    for (let y = 16; y < 19; y++) for (let x = 12; x < 15; x++) settled[y * w + x] = 1;
    updateFieldsRegion(map, fields, 12, 16, 14, 18);
    const full = buildFields(map);
    expect([...fields.lawn]).toEqual([...full.lawn]);
  });
});

// ── 4. the shader still honours the mask ───────────────────────────────────
describe("#437 the terrain shader keeps the dirt material off tended ground", () => {
  it("declares and samples the tended-ground mask", () => {
    expect(TERRAIN_FS).toContain("uniform sampler2D uLawn;");
    expect(TERRAIN_FS).toMatch(/float\s+lawn\s*=\s*texture\(uLawn,\s*fuv\)\.r;/);
  });

  it("multiplies the dirt weight by (1 - lawn), so lawn = 1 means no dirt", () => {
    const line = TERRAIN_FS.split("\n").find((l) => l.includes("float wDirt"));
    expect(line, "the land blend still has a dirt weight").toBeDefined();
    expect(line!.replace(/\s+/g, "")).toContain("*(1.0-lawn)");
  });

  it("tints tended ground rather than repainting it a flat colour", () => {
    expect(TERRAIN_FS).toContain("LAWN_TINT");
    expect(TERRAIN_FS).toMatch(/land\s*=\s*mix\(land,\s*land\s*\*\s*LAWN_TINT,\s*lawn\);/);
    // The tint is a MULTIPLY that keeps the grain and leans green: the green
    // channel survives most, so the lawn is a darker, greener grass.
    const m = /const vec3 LAWN_TINT\s*=\s*vec3\(([\d.]+),\s*([\d.]+),\s*([\d.]+)\);/.exec(TERRAIN_FS);
    expect(m, "LAWN_TINT is a literal vec3").not.toBeNull();
    const [r, g, b] = [Number(m![1]), Number(m![2]), Number(m![3])];
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    for (const c of [r, g, b]) {
      expect(c, "a tint, not a blackout").toBeGreaterThan(0.6);
      expect(c, "a tint, and it must darken").toBeLessThanOrEqual(1);
    }
  });
});
