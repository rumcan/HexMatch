// ══════════════════════════════════════════════════════════════════════════
// AMB-2 (#391) — the bird pool.
//
// Four things the ticket is explicit about, and one it is not:
//   • spawns are deterministic per seed (and never `Math.random`);
//   • the terrain decides the species (gull / pigeon / crow);
//   • ground birds scatter when a vehicle passes within about a tile, and
//     when the player clicks near them;
//   • the pool only exists at the closest zoom (2), and not at all in
//     performance mode;
//   • and — the one the ticket leaves to us — the birds paint ABOVE the
//     structures without ever entering the draw list `renderer.pick` walks.
// ══════════════════════════════════════════════════════════════════════════
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BIRD_ALTITUDE, BIRD_FADE_MS, BIRD_SPECIES, BIRD_VIEW_PAD, BIRD_ZOOM, CLICK_SCARE_R,
  BIRD_SPEED_MIN, MAX_BIRDS, VEHICLE_SCARE_R,
  birdSites, birdSpeciesAt, birdStats, birdTargetAlpha, createBirds, paintBirds,
  scareBirds, spawnBirds, stepBirdAlpha, tickBirds,
  type BirdState, type BirdTickContext, type TileRange,
} from "../../src/iso/birds";
import { GRASS, WATER, generateMap, type Grid } from "../../src/iso/grid";
import { createCamera, visibleTileRange } from "../../src/iso/camera";
import { LEVEL_PX } from "../../src/iso/elevation";
import { tileToScreen } from "../../src/game/config";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import { IsoRenderer, type World } from "../../src/iso/renderer";

// ── fixtures ──────────────────────────────────────────────────────────────
/** A flat, featureless synthetic map. Everything the tests add is explicit. */
function smallGrid(w = 48, h = 48, seed = 7): Grid {
  return {
    w, h,
    terrain: new Uint8Array(w * h).fill(GRASS),
    industries: [],
    towns: [],
    occupancy: new Int16Array(w * h).fill(-1),
    seed,
  } as unknown as Grid;
}

function pond(grid: Grid, tx: number, ty: number, size: number): void {
  for (let y = ty; y < ty + size; y++) {
    for (let x = tx; x < tx + size; x++) grid.terrain[y * grid.w + x] = WATER;
  }
}

function town(grid: Grid, tx: number, ty: number, houses: [number, number][]): void {
  grid.towns.push({ id: grid.towns.length, tx, ty, houses, roads: [] });
}

function farm(grid: Grid, tx: number, ty: number): void {
  grid.industries.push({
    id: grid.industries.length, type: "farm", tx, ty, w: 4, h: 4,
    output: 1, banditUntil: 0,
  });
}

/** A view of `half` tiles around a point — the tile rect the pool lives in. */
const viewAround = (tx: number, ty: number, half = 12): TileRange =>
  ({ x0: tx - half, y0: ty - half, x1: tx + half, y1: ty + half });

/** Tick a state `frames` times at `dt` ms — the game's own call, in a loop. */
function fall(
  state: BirdState, view: TileRange, frames = 5, dt = 100,
  ctx: Partial<BirdTickContext> = {},
): void {
  for (let i = 0; i < frames; i++) {
    tickBirds(state, dt, { grid: state.sites.grid, zoom: BIRD_ZOOM, view, ...ctx });
  }
}

/**
 * A recording 2D context with a REAL affine transform, so a test can ask where
 * a bird was actually painted rather than what numbers the painter passed.
 */
function stubCtx() {
  type Matrix = [number, number, number, number, number, number];
  const mul = (p: Matrix, q: Matrix): Matrix => [
    p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5],
  ];
  let m: Matrix = [1, 0, 0, 1, 0, 0];
  const stack: Matrix[] = [];
  const bodies: [number, number][] = [];
  const clears: number[] = [];
  const at = (x: number, y: number): [number, number] =>
    [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const ctx = {
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    strokeStyle: "#000",
    fillStyle: "#000",
    save() { stack.push([...m] as Matrix); },
    restore() { m = stack.pop()!; },
    translate(x: number, y: number) { m = mul(m, [1, 0, 0, 1, x, y]); },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      m = [a, b, c, d, e, f];
    },
    clearRect() { clears.push(0); },
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    quadraticCurveTo() {}, stroke() {}, fill() {}, fillRect() {},
    rect() {}, clip() {},
    drawImage() {},
    ellipse(x: number, y: number) { bodies.push(at(x, y)); },
    arc(x: number, y: number) { bodies.push(at(x, y)); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, bodies, clears, matrix: () => m };
}

const manifest: Manifest = JSON.parse(
  readFileSync("assets/iso-atlas/manifest.json", "utf8"),
);

// ══════════════════════════════════════════════════════════════════════════
describe("AMB-2 bird sites — the terrain decides the species", () => {
  it("reads gull by water, pigeon in town, crow by the farm", () => {
    const g = smallGrid();
    pond(g, 10, 10, 5);                   // water at (10..14, 10..14)
    town(g, 30, 30, [[30, 30], [31, 30]]);
    farm(g, 4, 40);                       // farm footprint (4..7, 40..43)
    const sites = birdSites(g);

    expect(birdSpeciesAt(sites, g, 9, 12)).toBe("gull");     // ashore beside the pond
    expect(birdSpeciesAt(sites, g, 12, 12)).toBeNull();      // the water itself
    expect(birdSpeciesAt(sites, g, 30, 30)).toBe("pigeon");  // the town house
    expect(birdSpeciesAt(sites, g, 31, 29)).toBe("pigeon");  // beside it
    expect(birdSpeciesAt(sites, g, 5, 41)).toBe("crow");     // the farm's own tiles
    expect(birdSpeciesAt(sites, g, 8, 41)).toBe("crow");     // just off the footprint
    expect(birdSpeciesAt(sites, g, 24, 24)).toBeNull();      // open meadow
    // Every water tile is water, not a perch (the beach ring is land).
    for (let y = 10; y < 15; y++) {
      for (let x = 10; x < 15; x++) {
        expect(sites.species[y * g.w + x], `${x},${y}`).toBe(0);
      }
    }
  });

  it("gives a tile to the CLOSEST feature, ties to gull → pigeon → crow", () => {
    const g = smallGrid();
    pond(g, 10, 10, 1);                          // water at (10,10)
    town(g, 15, 10, [[15, 10]]);                 // town house at (15,10)
    const sites = birdSites(g);
    expect(birdSpeciesAt(sites, g, 12, 10)).toBe("gull");     // 2 from water, 3 from town
    expect(birdSpeciesAt(sites, g, 13, 10)).toBe("pigeon");   // 3 from water, 2 from town

    // A tie goes to the earlier species in BIRD_SPECIES (gull, then pigeon).
    const tie = smallGrid();
    pond(tie, 12, 10, 1);
    town(tie, 14, 10, [[14, 10]]);               // 2 from water, 2 from the house
    expect(birdSpeciesAt(birdSites(tie), tie, 13, 10)).toBe("gull");
    expect(BIRD_SPECIES).toEqual(["gull", "pigeon", "crow"]);
  });

  it("finds all three species on a real generated map", () => {
    const g = generateMap(4242);
    const sites = birdSites(g);
    for (const s of BIRD_SPECIES) expect(sites.counts[s], s).toBeGreaterThan(0);
    // …and it is deterministic: the same grid derives the same sites.
    expect(birdSites(g).counts).toEqual(sites.counts);
    expect(birdSites(g).species).toEqual(sites.species);
  });

  it("plans only species the map actually has", () => {
    const nothing = smallGrid();
    const empty = createBirds(nothing);
    expect(empty.plan.flocks).toEqual([]);
    expect(empty.plan.perchers).toEqual([]);

    // A pond map has gulls and nothing else: no crow flock, whatever the draw.
    const coast = smallGrid();
    pond(coast, 20, 20, 6);
    const solo = createBirds(coast);
    for (const f of solo.plan.flocks) expect(f.species).toBe("gull");
    for (const s of solo.plan.perchers) expect(s).toBe("gull");
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("AMB-2 spawn determinism", () => {
  const view = (g: Grid): TileRange => viewAround(g.towns[0].tx, g.towns[0].ty, 14);

  it("spawns the same birds for the same seed, every time", () => {
    const a = generateMap(90210);
    const b = generateMap(90210);
    expect(a.seed).toBe(b.seed);
    const sa = createBirds(a);
    const sb = createBirds(b);
    expect(sa.plan).toEqual(sb.plan);
    expect(spawnBirds(sa, view(a))).toBe(spawnBirds(sb, view(b)));
    expect(sa.birds).toEqual(sb.birds);
    // …and a second map from the same seed is a genuinely separate pool: the
    // birds are structures, not shared references.
    expect(sa.birds[0]).not.toBe(sb.birds[0]);
  });

  it("spawns a different pool for a different seed", () => {
    const a = generateMap(1), b = generateMap(2);
    const sa = createBirds(a), sb = createBirds(b);
    spawnBirds(sa, view(a));
    spawnBirds(sb, view(b));
    expect(sa.birds).not.toEqual(sb.birds);
  });

  it("picks every spawn off the seeded stream — never Math.random", () => {
    const src = readFileSync("src/iso/birds.ts", "utf8");
    expect(src.includes("Math.random(")).toBe(false);
    // The plan and the pool both come off `mulberry32(seed ^ salt)`, so two
    // pools made from one grid differ only in what they were asked to hold.
    const g = generateMap(4242);
    const s = createBirds(g);
    const birds: unknown[] = [];
    spawnBirds(s, view(g));
    birds.push(...s.birds);
    spawnBirds(s, view(g));           // respawn: same stream, next draw
    expect(s.birds).toHaveLength(birds.length);
    expect(s.birds).not.toEqual(birds);
  });

  it("caps the pool and keeps it in view while it flies", () => {
    const g = generateMap(4242);
    const state = createBirds(g);
    const view = viewAround(g.towns[0].tx, g.towns[0].ty, 16);
    fall(state, view, 5);
    expect(state.birds.length).toBeGreaterThan(0);
    expect(state.birds.length).toBeLessThanOrEqual(MAX_BIRDS);
    // Two simulated minutes: the pool stays capped, stays near the view (the
    // recycle contract), and never accumulates.
    for (let i = 0; i < 1200; i++) {
      tickBirds(state, 100, { grid: g, zoom: BIRD_ZOOM, view });
      expect(state.birds.length).toBeLessThanOrEqual(MAX_BIRDS);
    }
    for (const b of state.birds) {
      expect(b.x).toBeGreaterThanOrEqual(view.x0 - BIRD_VIEW_PAD - 1);
      expect(b.x).toBeLessThanOrEqual(view.x1 + BIRD_VIEW_PAD + 1);
      expect(b.y).toBeGreaterThanOrEqual(view.y0 - BIRD_VIEW_PAD - 1);
      expect(b.y).toBeLessThanOrEqual(view.y1 + BIRD_VIEW_PAD + 1);
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    }
  });

  it("never teleports the pool at the real zoom-2 view", () => {
    // Five minutes of a real 1280x720 zoom-2 camera on town: the pool must
    // never be seen to jump (a recycle the player can watch — the pre-polish
    // code did it 18 times in 300 ticks, flinging a flock 38 tiles), must never
    // be parked a screen away from the camera, and must stay on screen as a
    // whole. `visibleTileRange(cam, BIRD_VIEW_PAD)` is exactly what game.ts
    // hands the pool, so this is the shipped call, five times over.
    const HW = 32, HH = 16;
    for (const seed of [4242, 7, 99, 1234, 555]) {
      const grid = generateMap(seed);
      const cam = createCamera(1280, 720);
      const cx = grid.towns[0].tx + 0.5, cy = grid.towns[0].ty + 0.5;
      const [wx, wy] = tileToScreen(cx, cy);
      cam.zoom = BIRD_ZOOM;
      cam.x = cam.vw / 2 - wx * cam.zoom;         // the camera holds device px
      cam.y = cam.vh / 2 - wy * cam.zoom;
      const view = visibleTileRange(cam, BIRD_VIEW_PAD);
      const state = createBirds(grid);
      for (let i = 0; i < 50; i++) tickBirds(state, 100, { grid, zoom: cam.zoom, view });
      let teleports = 0, worst = 0, centroid = Infinity;
      const prev: [number, number][] = state.birds.map((b) => [b.x, b.y]);
      const onScreen = (b: { x: number; y: number }): number => {
        const dx = b.x - cx, dy = b.y - cy;
        return Math.max(
          Math.abs(dx - dy) - (cam.vw / 2) / (HW * cam.zoom),
          Math.abs(dx + dy) - (cam.vh / 2) / (HH * cam.zoom),
        );
      };
      for (let i = 0; i < 600; i++) {
        tickBirds(state, 100, { grid, zoom: cam.zoom, view });
        let mx = 0, my = 0, over = 0;
        state.birds.forEach((b, k) => {
          const [px, py] = prev[k] ?? [b.x, b.y];
          const jump = Math.hypot(b.x - px, b.y - py);
          if (jump > 4) teleports++;
          worst = Math.max(worst, onScreen(b));
          mx += b.x; my += b.y; over++;
          prev[k] = [b.x, b.y];
        });
        if (over > 0) centroid = Math.min(centroid, onScreen({ x: mx / over, y: my / over }));
      }
      expect(teleports, `seed ${seed}: the pool was recycled under the player`).toBe(0);
      expect(worst, `seed ${seed}: a bird was parked off the view`).toBeLessThan(5);
      expect(centroid, `seed ${seed}: the pool drifted off the view`).toBeLessThan(3);
      expect(state.birds.length).toBeGreaterThan(0);
    }
  });

  it("reports the pool by species and by stance", () => {
    const g = generateMap(4242);
    const state = createBirds(g);
    fall(state, viewAround(g.towns[0].tx, g.towns[0].ty, 16), 5);
    const stats = birdStats(state);
    expect(stats.total).toBe(state.birds.length);
    expect(stats.flying + stats.perched).toBe(stats.total);
    expect(Object.values(stats.species).reduce((n, v) => n + v, 0)).toBe(stats.total);
    expect(stats.perched).toBeGreaterThan(0);          // "a few also perch"
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("AMB-2 scatter", () => {
  /** A pool, settled, with at least one bird on the ground. */
  function settledView(): { state: BirdState; view: TileRange; grid: Grid } {
    const grid = generateMap(4242);
    const view = viewAround(grid.towns[0].tx, grid.towns[0].ty, 18);
    const state = createBirds(grid);
    fall(state, view, 5);
    return { state, view, grid };
  }
  const perched = (state: BirdState) => state.birds.filter((b) => b.mode === "perch");

  it("leaves perched birds alone while nothing disturbs them", () => {
    const { state, view, grid } = settledView();
    expect(perched(state).length).toBeGreaterThan(0);
    const before = perched(state).map((b) => [b.x, b.y]);
    fall(state, view, 10, 100, { grid });
    const after = perched(state).map((b) => [b.x, b.y]);
    expect(after).toEqual(before);
  });

  it("puts a bird up when a vehicle passes within a tile", () => {
    const { state, view, grid } = settledView();
    const bird = perched(state)[0];
    const spot = [bird.x, bird.y] as const;
    // Nothing near: still perched (the far end of the map is not a scare).
    tickBirds(state, 100, {
      grid, zoom: BIRD_ZOOM, view,
      vehicles: [{ tx: Math.round(bird.x) + 40, ty: Math.round(bird.y) + 40 }],
    });
    expect(perched(state).some((b) => b.x === spot[0] && b.y === spot[1])).toBe(true);
    // A lorry on its tile: up it goes, and away from the lorry.
    tickBirds(state, 100, {
      grid, zoom: BIRD_ZOOM, view,
      vehicles: [{ tx: Math.round(bird.x), ty: Math.round(bird.y) }],
    });
    expect(bird.mode).not.toBe("perch");
    expect(Math.hypot(bird.vx, bird.vy)).toBeGreaterThan(0);
    fall(state, view, 3, 100, { grid });
    expect(bird.alt).toBeGreaterThan(0);
    // …flying AWAY from what spooked it, not past it.
    expect(bird.vx * (Math.round(spot[0]) - bird.x) + bird.vy * (Math.round(spot[1]) - bird.y))
      .toBeLessThanOrEqual(0.5);
    // The trigger really is "about one tile": VEHICLE_SCARE_R is the radius the
    // vehicle loop tests, and it is a tile, not a screen.
    expect(VEHICLE_SCARE_R).toBe(1);
  });

  it("scatters a whole group when the player clicks near them", () => {
    const { state, view, grid } = settledView();
    const target = perched(state)[0];
    const n = scareBirds(state, target.x, target.y, CLICK_SCARE_R);
    expect(n).toBeGreaterThan(0);
    expect(target.mode).not.toBe("perch");
    fall(state, view, 4, 100, { grid });
    expect(target.alt).toBeGreaterThan(0);              // climbing
    // A click nowhere near any bird scares nobody.
    const far = state.birds.length;
    expect(scareBirds(state, -50, -50)).toBe(0);
    expect(state.birds.length).toBe(far);
  });

  it("settles a scattered bird back onto a perch", () => {
    const { state, view, grid } = settledView();
    const bird = perched(state)[0];
    scareBirds(state, bird.x, bird.y, CLICK_SCARE_R);
    expect(bird.mode).toBe("fly");
    // Well past SCARE_MS + jitter: it lands, upright and still.
    fall(state, view, 160, 100, { grid });
    expect(bird.mode).toBe("perch");
    expect(bird.alt).toBe(0);
    // It landed on ground its species belongs to — never on water.
    const [tx, ty] = [Math.floor(bird.x), Math.floor(bird.y)];
    expect(grid.terrain[ty * grid.w + tx]).not.toBe(WATER);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("AMB-2 the zoom gate", () => {
  it("wants nothing but the closest step, and nothing in performance mode", () => {
    expect(BIRD_ZOOM).toBe(2);
    expect(birdTargetAlpha(0.5, false)).toBe(0);
    expect(birdTargetAlpha(1, false)).toBe(0);
    expect(birdTargetAlpha(2, false)).toBe(1);
    expect(birdTargetAlpha(2, true)).toBe(0);
    expect(birdTargetAlpha(1, true)).toBe(0);
  });

  it("fades linearly over BIRD_FADE_MS", () => {
    expect(stepBirdAlpha(0, 1, BIRD_FADE_MS / 2)).toBeCloseTo(0.5, 6);
    expect(stepBirdAlpha(0, 1, BIRD_FADE_MS * 4)).toBe(1);        // clamped
    expect(stepBirdAlpha(1, 0, BIRD_FADE_MS / 4)).toBeCloseTo(0.75, 6);
    expect(stepBirdAlpha(1, 0, BIRD_FADE_MS * 4)).toBe(0);
    expect(stepBirdAlpha(0.5, 0.5, 1000)).toBe(0.5);
  });

  it("parks the whole pool away from the closest step", () => {
    const grid = generateMap(4242);
    const view = viewAround(grid.towns[0].tx, grid.towns[0].ty, 16);
    const state = createBirds(grid);
    for (let i = 0; i < 30; i++) {
      tickBirds(state, 100, { grid, zoom: 1, view });
    }
    expect(state.alpha).toBe(0);
    expect(state.birds.length).toBe(0);
    expect(state.active).toBe(false);

    // Fade in at zoom 2: the pool appears, and it stops short of MAX_BIRDS.
    for (let i = 0; i < Math.ceil(BIRD_FADE_MS / 100) + 1; i++) {
      tickBirds(state, 100, { grid, zoom: 2, view });
    }
    expect(state.alpha).toBe(1);
    expect(state.birds.length).toBeGreaterThan(0);
    expect(state.birds.length).toBeLessThanOrEqual(MAX_BIRDS);

    // Performance mode drains the fade and parks it again.
    for (let i = 0; i < Math.ceil(BIRD_FADE_MS / 100) + 2; i++) {
      tickBirds(state, 100, { grid, zoom: 2, view, performance: true });
    }
    expect(state.alpha).toBe(0);
    expect(state.birds.length).toBe(0);
    expect(state.active).toBe(false);

    // …and zooming back out drains it too, from a live pool.
    for (let i = 0; i < 4; i++) tickBirds(state, 100, { grid, zoom: 2, view });
    expect(state.alpha).toBe(1);
    for (let i = 0; i < 4; i++) tickBirds(state, 100, { grid, zoom: 1, view });
    expect(state.alpha).toBe(0);
    expect(state.birds.length).toBe(0);
  });

  it("hides and parks birds immediately under reduced motion, then resumes", () => {
    const grid = generateMap(4242);
    const view = viewAround(grid.towns[0].tx, grid.towns[0].ty, 16);
    const state = createBirds(grid);
    fall(state, view, 5);
    expect(state.birds.length).toBeGreaterThan(0);
    const time = state.time;
    fall(state, view, 1, 0, { reducedMotion: true });
    expect(state.reducedMotion).toBe(true);
    expect(state.alpha).toBe(0);
    expect(state.birds).toHaveLength(0);
    expect(state.active).toBe(false);
    fall(state, view, 5, 5000, { reducedMotion: true });
    expect(state.time).toBe(time);
    fall(state, view, 5);
    expect(state.reducedMotion).toBe(false);
    expect(state.birds.length).toBeGreaterThan(0);
    expect(state.alpha).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("AMB-2 painting", () => {
  function pool(): { state: BirdState; grid: Grid; view: TileRange } {
    const grid = generateMap(4242);
    const view = viewAround(grid.towns[0].tx, grid.towns[0].ty, 16);
    const state = createBirds(grid);
    fall(state, view, 5);
    return { state, grid, view };
  }
  /** A camera with the town centre in the middle of the viewport. */
  const camAt = (grid: Grid, z = BIRD_ZOOM) => {
    const cam = createCamera(1600, 900);
    const [wx, wy] = tileToScreen(grid.towns[0].tx, grid.towns[0].ty);
    return { ...cam, zoom: z as 2, x: cam.vw / 2 - wx * z, y: cam.vh / 2 - wy * z };
  };

  it("draws nothing while the pool is parked, and a body per bird while it is not", () => {
    const { state, grid } = pool();
    const cam = camAt(grid);
    const { ctx, bodies } = stubCtx();
    const drawn = paintBirds(ctx, cam, grid, state);
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThanOrEqual(state.birds.length);       // off-screen birds are culled
    expect(bodies.length).toBeGreaterThanOrEqual(drawn);         // a body each
    expect(bodies.length).toBeLessThanOrEqual(drawn * 2);        // body + head

    // Park it (zoom out) and paint again: not one stroke lands.
    for (let i = 0; i < 6; i++) {
      tickBirds(state, 100, { grid, zoom: 1, view: state.view });
    }
    expect(state.alpha).toBe(0);
    const before = bodies.length;
    expect(paintBirds(ctx, cam, grid, state)).toBe(0);
    expect(bodies.length).toBe(before);
    expect(paintBirds(null, cam, grid, state)).toBe(0);
    expect(paintBirds(ctx, { ...cam, zoom: 0.5 }, grid, state)).toBe(0);
  });

  it("never paints a retained pool under reduced motion", () => {
    const { state, grid } = pool();
    const { ctx, bodies } = stubCtx();
    state.reducedMotion = true;
    expect(paintBirds(ctx, camAt(grid), grid, state)).toBe(0);
    expect(bodies).toHaveLength(0);
  });

  it("paints a bird where the ground plane says it is, lifted by its altitude", () => {
    const { state, grid } = pool();
    const cam = camAt(grid);
    // One bird, dead centre of the viewport, flying: the projection under test
    // is isolated from the pool's own spawn scatter and from the cull.
    const tx = grid.towns[0].tx + 0.5, ty = grid.towns[0].ty + 0.5;
    const bird = {
      species: "pigeon" as const, mode: "fly" as const, x: tx, y: ty,
      vx: 1, vy: 0, alt: BIRD_ALTITUDE, home: [tx, ty] as [number, number],
      perch: null, flock: 0, percher: false, calmAt: 0, phase: 0, wander: 0,
    };
    state.birds.length = 0;
    state.birds.push(bird);
    const { ctx, bodies } = stubCtx();
    expect(paintBirds(ctx, cam, grid, state)).toBe(1);
    // The body: `tileToScreen` of the bird's ground point, HALF A TILE down to
    // the diamond's centre, minus the altitude, times the zoom plus the pan.
    const expectedX = (bird.x - bird.y) * 32 * cam.zoom + cam.x;
    const expectedY = ((bird.x + bird.y) * 16 + 16 - bird.alt) * cam.zoom + cam.y;
    const [px, py] = bodies[0];
    expect(Math.abs(px - expectedX)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(py - expectedY)).toBeLessThanOrEqual(1.5);
    // …and the altitude really is a lift: the same bird on the ground paints
    // `BIRD_ALTITUDE · zoom` further down the screen.
    const { ctx: gctx, bodies: gbodies } = stubCtx();
    const grounded = { ...bird, alt: 0 };
    state.birds.length = 0;
    state.birds.push(grounded);
    expect(paintBirds(gctx, cam, grid, state)).toBe(1);
    expect(gbodies[0][1] - py).toBeCloseTo(BIRD_ALTITUDE * cam.zoom, 1);

    // On a raised map the same bird rides UP the screen by the surface height
    // (E2's drape), which is what keeps a bird over a hill where it belongs.
    const hilly = { ...grid, height: new Uint8Array(grid.w * grid.h).fill(2) } as Grid;
    const hstate = createBirds(hilly);
    fall(hstate, viewAround(hilly.towns[0].tx, hilly.towns[0].ty, 16), 5);
    hstate.birds.length = 0;
    hstate.birds.push({ ...bird });
    const { ctx: hctx, bodies: hbodies } = stubCtx();
    expect(paintBirds(hctx, cam, hilly, hstate)).toBe(1);
    expect(hbodies[0][1]).toBeCloseTo(py - 2 * LEVEL_PX * cam.zoom, 1);
  });

  it("keeps the birds out of the draw list every pick walks", () => {
    const { state, grid, view } = pool();
    const ctx = stubCtx().ctx;
    const canvas = () => ({ getContext: () => ctx }) as unknown as HTMLCanvasElement;
    const atlas = new Atlas(manifest);
    const world = { grid } as World;
    const cam = camAt(grid);
    const renderer = new IsoRenderer(
      { terrain: canvas(), structures: canvas(), overlay: canvas() },
      atlas, cam, world,
    );
    const painted: number[] = [];
    renderer.aboveStructuresPainter = (c, c2) => { painted.push(paintBirds(c, c2, grid, state)); };
    renderer.drawOverlay([], 0, null);

    // The shared hook ran, above the structures, and it really drew birds
    // (the ones the camera can see; the rest of the pool is culled)…
    expect(painted).toHaveLength(1);
    expect(painted[0]).toBeGreaterThan(0);
    expect(painted[0]).toBeLessThanOrEqual(state.birds.length);
    expect(state.alpha).toBe(1);
    // …and `drawOrder` — the depth-sorted list `renderer.pick` walks
    // front-to-back — is untouched: no bird can be picked, hovered, or built
    // upon, and nothing about the pool has to be undone on the way out.
    expect(renderer.drawOrder).toEqual([]);

    // The hook is off unless the game installs one: a renderer built by the
    // demo (or a test) paints no ambient layer at all.
    const bare = new IsoRenderer(
      { terrain: canvas(), structures: canvas(), overlay: canvas() },
      atlas, cam, world,
    );
    expect(bare.aboveStructuresPainter).toBeNull();
    expect(() => bare.drawOverlay([], 0, null)).not.toThrow();

    // And the pool keeps living inside the view the game handed it.
    expect(view.x1).toBeGreaterThan(view.x0);
  });
});

describe("#438 airborne movement", () => {
  function pool(seed = 4242) {
    const grid = generateMap(seed);
    const view = viewAround(grid.towns[0].tx, grid.towns[0].ty, 16);
    const state = createBirds(grid);
    fall(state, view, 5);
    return { grid, view, state };
  }

  it.each([4242, 99])("moves every airborne bird for ten simulated minutes (seed %i)", (seed) => {
    const { grid, view, state } = pool(seed);
    const start = state.time;
    const steps = [0, 16, 33, 5000];
    let airborneChecks = 0;
    // Include zero-dt bursts lasting more than a second, not just one duplicate timestamp.
    for (let frame = 0; state.time - start < 600_000; frame++) {
      expect(frame).toBeLessThan(50_000); // a stalled clock must fail, not hang the suite
      if (frame % 600 === 0) {
        for (const b of state.birds) if (b.mode === "perch") scareBirds(state, b.x, b.y);
      }
      const before = state.birds.map((b) => [b.x, b.y, b.alt]);
      const dt = frame % 600 < 70 ? 0 : steps[frame % steps.length];
      tickBirds(state, dt, { grid, zoom: BIRD_ZOOM, view });
      expect(Number.isFinite(state.time) && Number.isFinite(state.alpha)).toBe(true);
      state.birds.forEach((b, i) => {
        expect([b.x, b.y, b.vx, b.vy, b.alt].every(Number.isFinite)).toBe(true);
        if (b.mode === "perch") {
          expect(b.alt).toBe(0);
        } else {
          expect(Math.hypot(b.x - before[i][0], b.y - before[i][1], b.alt - before[i][2])).toBeGreaterThan(0);
          airborneChecks++;
        }
      });
    }
    expect(airborneChecks).toBeGreaterThan(10_000);
  });

  it.each([0, -16, NaN, Infinity, -Infinity, 5000])("keeps clocks, fades and flight finite for dt=%s", (dt) => {
    const { grid, view, state } = pool();
    const b = state.birds.find((b) => b.mode === "fly")!;
    const before = [b.x, b.y];
    const time = state.time;
    tickBirds(state, dt, { grid, zoom: BIRD_ZOOM, view });
    expect(state.time).toBeGreaterThan(time);
    expect(state.time - time).toBeLessThanOrEqual(100);
    expect(Number.isFinite(state.alpha)).toBe(true);
    expect([b.x, b.y, b.vx, b.vy, b.alt].every(Number.isFinite)).toBe(true);
    expect([b.x, b.y]).not.toEqual(before);
  });

  it.each([0, NaN, Infinity])("recovers invalid velocity %s without poisoning flockmates", (velocity) => {
    const { state, view } = pool();
    const b = state.birds.find((b) => b.mode === "fly")!;
    b.vx = velocity; b.vy = velocity;
    fall(state, view, 1, 16);
    for (const bird of state.birds.filter((b) => b.mode !== "perch")) {
      expect([bird.x, bird.y, bird.vx, bird.vy].every(Number.isFinite)).toBe(true);
      expect(Math.hypot(bird.vx, bird.vy)).toBeGreaterThanOrEqual(BIRD_SPEED_MIN - 1e-9);
    }
  });

  it("takes off with a nonzero heading when clicked exactly on the bird", () => {
    const { state } = pool();
    const b = state.birds.find((b) => b.mode === "perch")!;
    scareBirds(state, b.x, b.y);
    expect(Math.hypot(b.vx, b.vy)).toBeGreaterThan(0);
  });

  it("finishes a landing on the ground in the same tick", () => {
    const { state, view } = pool();
    const b = state.birds[0];
    b.mode = "land";
    b.perch = [Math.floor(b.x), Math.floor(b.y)];
    b.x = b.perch[0] + 0.5; b.y = b.perch[1] + 0.5;
    b.alt = BIRD_ALTITUDE;
    fall(state, view, 1, 16);
    expect(b.mode).toBe("perch");
    expect(b.alt).toBe(0);
    expect([b.vx, b.vy]).toEqual([0, 0]);
  });

  it("moves inward immediately at a map corner instead of clamping in place", () => {
    const { state, grid } = pool();
    const view = viewAround(0, 0, 16);
    const b = state.birds[0];
    state.birds = [b];
    b.mode = "fly"; b.percher = false;
    b.x = 0.5; b.y = 0.5; b.home = [0.5, 0.5];
    b.vx = -1; b.vy = -1;
    tickBirds(state, 16, { grid, zoom: BIRD_ZOOM, view });
    expect(b.x).toBeGreaterThan(0.5);
    expect(b.y).toBeGreaterThan(0.5);
  });
});
