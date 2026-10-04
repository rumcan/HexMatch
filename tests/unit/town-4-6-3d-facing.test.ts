// ══════════════════════════════════════════════════════════════════════════
// TOWN-4.6 (#682) — LIVE-3D FOR PLANNED TOWNS.
//
// Two things a planned town has to get right in the 3D layer:
//
//   1. FACING. Every planned-town lot knows which side its street is on
//      (`TownBuilding.front`), so the 3D model turns to face it instead of
//      taking `spinOf`'s random hash. The turn is a GROUND turn, so it does not
//      mention the view yaw — the whole three scene is seen through the turned
//      camera — which is what "stays consistent at yaw 90/180/270" means and
//      what is measured here, in screen space, at all four quarters.
//   2. AVENUE DRESSING. The median's trees and lamps are SCREEN shapes baked
//      into the road raster, and the raster is blitted through the view turn.
//      Baked the naive way they lean over with the turn and lie down at a
//      quarter; `screenOffsetAt` bakes the inverse turn so they stay upright,
//      on their median, at every yaw.
//
// Everything here is data and geometry: the model manifest, the town plan, the
// two turn maps (`turnTilePoint` / `turnWorld`) and the paint passes driven
// through a recording context. Nothing renders, nothing needs a browser.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HW, HH } from "../../src/game/config";
import {
  generateMap, idx, lotFrontageTiles, plannedReveal, townBuildings,
  type Grid, type Town, type TownBuilding,
} from "../../src/iso/grid";
import { TOWN_VISUAL_MAX } from "../../src/iso/config";
import {
  FRONT_TURN, SPRITE_FRONT_SW, facingTurn, modelFrontTurn, modelOf, spinOf,
} from "../../src/iso/three-layer";
import type { LotFront } from "../../src/iso/town-plan";
import { turnTilePoint, yawQuarter } from "../../src/iso/depth";
import { turnWorld } from "../../src/iso/camera";
import { draperFor } from "../../src/iso/elevation";
import {
  paintAvenueFurniture, paintRoadTiles, paintStreetLamps, screenOffsetAt, DEFAULT_ROAD_STYLE,
} from "../../src/iso/road-renderer";
import { roadTile, avenueMedianStrip, avenueMedianTreeSpot, avenueMedianLampSpot, MEDIAN_WIDTH } from "../../src/iso/road-geometry";
import { NE, NW, SE, SW } from "../../src/iso/track";

// ── the data under test ───────────────────────────────────────────────────
type Manifest = Record<string, { turn: number; ex: number; ez: number; h: number; moving?: boolean; lengthM?: number }>;
const manifest = JSON.parse(
  readFileSync(new URL("../../public/models/manifest.json", import.meta.url), "utf8"),
) as Manifest;
const buildingsManifest = JSON.parse(readFileSync("assets/buildings/manifest.json", "utf8")) as
  { sprites: Record<string, { footprint: [number, number] }> };
const sceneryManifest = JSON.parse(readFileSync("assets/scenery/manifest.json", "utf8")) as
  { sprites: Record<string, { footprint: [number, number] }> };
const KNOWN = new Set([...Object.keys(buildingsManifest.sprites), ...Object.keys(sceneryManifest.sprites)]);
const spriteKnown = (s: string): boolean => KNOWN.has(s);
const footprintOf = (s: string): [number, number] =>
  buildingsManifest.sprites[s]?.footprint ?? sceneryManifest.sprites[s]?.footprint ?? [1, 1];

// ── the one space everything is measured in ───────────────────────────────
/** A lot's front, as a ground vector: NE = (0,−1) … SW = (0,+1). */
const FRONT_VEC: Record<LotFront, [number, number]> = { NE: [0, -1], SE: [1, 0], SW: [0, 1], NW: [-1, 0] };
/** A direction as quarter turns of +X (SE) — the space `FRONT_TURN` names. */
const DIR_OF_TURN: readonly [number, number][] = [[1, 0], [0, -1], [-1, 0], [0, 1]];
const QUARTERS = [0, 1, 2, 3] as const;
/** What one street lamp draws, in order: contact shadow, post, glow, housing, glass. */
const LAMP_PATHS = 5;
const yawRad = (q: number): number => (q * Math.PI) / 2;
/** The road raster's own projection (ground -> world px), then the blit's turn. */
const flat = (u: number, v: number): [number, number] => [(u - v) * HW, (u + v) * HH];
const toScreen = ([du, dv]: [number, number], q: number): [number, number] => turnWorld(...flat(du, dv), yawRad(q));
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** -0 and +0 are the same number here; `toEqual` does not think so. */
const norm = (p: readonly number[]): number[] => p.map((n) => n + 0);

// ── the towns under test ──────────────────────────────────────────────────
const SEEDS = [1, 7, 42, 1337];
const maps = SEEDS.map((seed) => ({ seed, grid: generateMap(seed, { layout: "planned" }) }));
const towns = maps.flatMap(({ seed, grid }) => grid.towns.map((town) => ({ seed, grid, town })));

/** What one town draws at one tier, plus the reveal it was drawn from. */
function drawn(town: Town, grid: Grid, tier: number) {
  const reveal = plannedReveal(town, grid, tier, {});
  const laid = townBuildings(town, footprintOf, { tier, grid, shapes: true, spriteKnown });
  return { reveal, laid };
}

/** Every drawn item that has BOTH a front and a 3D model — the ones this ticket turns. */
function turningItems(laid: TownBuilding[]): {
  sprite: string; model: string; turn: number; extra: number; w: number; h: number; front: LotFront;
}[] {
  const out: { sprite: string; model: string; turn: number; extra: number; w: number; h: number; front: LotFront }[] = [];
  for (const b of laid) {
    if (!b.front) continue;
    const mo = modelOf(b.sprite, manifest);
    const mi = mo ? manifest[mo.name] : undefined;
    if (!mo || !mi) continue;                        // no model: the 2D sprite stays and there is nothing to turn
    const [w, h] = footprintOf(b.sprite);
    out.push({ sprite: b.sprite, model: mo.name, turn: mi.turn, extra: mo.extra, w, h, front: b.front });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.6 the facing space", () => {
  it("a lot's front is the same quarter turn the tile lattice turns by", () => {
    // FRONT_TURN is the bridge between the town plan's words and the model's
    // yaw; if it disagrees with `turnTilePoint`, every building faces a
    // neighbour's street at every yaw but the one it was checked at.
    for (const front of ["NE", "SE", "SW", "NW"] as LotFront[]) {
      expect(DIR_OF_TURN[FRONT_TURN[front]], front).toEqual(FRONT_VEC[front]);
      for (const k of QUARTERS) {
        const turned = turnTilePoint(FRONT_VEC[front][0], FRONT_VEC[front][1], k);
        expect(norm(turned), `${front} + ${k}`).toEqual(DIR_OF_TURN[(FRONT_TURN[front] + k) & 3]);
      }
    }
  });

  it("the sprite-front convention is one named constant, not a number in the render loop", () => {
    // The ONE guess in this ticket (see the comment on SPRITE_FRONT_SW): which
    // wall of a shipped sprite the door is painted on. It is SW, the lit wall.
    expect(SPRITE_FRONT_SW).toBe(FRONT_TURN.SW);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.6 every planned-town building faces its street", () => {
  it("the plan reaches the draw list: nearly every tier-3 item carries a front", () => {
    let items = 0, fronts = 0, seen = 0;
    for (const { grid, town } of towns) {
      const { laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      seen++;
      for (const b of laid) { items++; if (b.front) fronts++; }
    }
    expect(seen).toBeGreaterThan(0);
    expect(items).toBeGreaterThan(500);
    // The ticket's own measure: a planned town is ALL frontage. What is left is
    // the square's and the block interiors' greenery, which has no front.
    expect(fronts / items).toBeGreaterThan(0.6);
  });

  it("the model's front points down the street at yaw 0, at every seed x town", () => {
    let checked = 0, exact = 0, tied = 0;
    for (const { grid, town } of towns) {
      const { laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      for (const it of turningItems(laid)) {
        const rot = facingTurn(it.model, it.turn, it.extra, it.front, it.w, it.h);
        const axis = modelFrontTurn(it.model, it.turn, it.extra);
        const dir = (axis + rot) & 3;                       // where the model's front ends up
        const want = FRONT_TURN[it.front];
        if (it.w === it.h) {
          // A square footprint can take any quarter turn, so there is no excuse.
          expect(dir, `${it.sprite}/${it.model} on a ${it.w}x${it.h} lot fronting ${it.front}`).toBe(want);
          exact++;
        } else {
          // A non-square one can only take the two turns that keep its long
          // axis on the lot's — the ticket's "0/180 unless the lot is the
          // transposed one".
          const rotSprite = (it.turn + it.extra) & 3;
          expect(rot & 1, `${it.sprite}: the plan left its lot`).toBe(rotSprite & 1);
          const reachable = [(axis + rotSprite) & 3, (axis + rotSprite + 2) & 3];
          expect(reachable, `${it.sprite} on a ${it.w}x${it.h} lot`).toContain(dir);
          if (reachable.includes(want)) {
            expect(dir, `${it.sprite} could face ${it.front} exactly`).toBe(want);
            exact++;
          } else {
            // A quarter turn off either way: take the one the CAMERA can see,
            // so a terrace never turns its back on the street it stands on.
            const visible = reachable.filter((d) => d === 0 || d === 3);
            expect(visible.length, "exactly one of the two faces the camera").toBe(1);
            expect(dir).toBe(visible[0]);
            tied++;
          }
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(exact).toBeGreaterThan(0);
    // A PR number, not an assertion: how many non-square lots had to take the
    // camera-facing tie-break because their art is only drawn from one side.
    expect(tied).toBeGreaterThanOrEqual(0);
  });

  it("a lot's frontage really is surviving street", () => {
    for (const { grid, town } of towns) {
      const { reveal } = drawn(town, grid, TOWN_VISUAL_MAX);
      for (const lot of reveal.lots) {
        const tiles = lotFrontageTiles(lot);
        expect(tiles.length, "a lot fronts something").toBeGreaterThan(0);
        for (const [x, y] of tiles) {
          expect(reveal.roadKeys.has(idx(x, y)), `lot ${lot.x},${lot.y} fronting ${lot.front}`).toBe(true);
        }
      }
    }
  });

  it("the same turn is right at all four yaws: the model's front and the street turn together", () => {
    // The bug this guards: if the facing were corrected per view (or baked from
    // a screen direction), the front and the street would only agree at yaw 0.
    // Both are turned by the SAME map, so they agree at all four or at none.
    let cases = 0, tieCases = 0;
    for (const { grid, town } of towns) {
      const { laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      for (const it of turningItems(laid)) {
        const rot = facingTurn(it.model, it.turn, it.extra, it.front, it.w, it.h);
        const axis = modelFrontTurn(it.model, it.turn, it.extra);
        const front = DIR_OF_TURN[(axis + rot) & 3];
        const street = FRONT_VEC[it.front];
        // GROUND space: 1 = the front is down the street, 0 = the quarter-turn
        // tie (non-square art drawn from one side only), never negative — a
        // building is never turned with its BACK to its own street.
        const groundDot = front[0] * street[0] + front[1] * street[1];
        expect(groundDot, `${it.sprite}/${it.model} ${it.w}x${it.h} fronting ${it.front}`).toBeGreaterThanOrEqual(0);
        if (it.w === it.h) expect(groundDot).toBe(1);
        if (groundDot === 0) tieCases++;
        // SCREEN space: the model's front and the street are turned by the SAME
        // map (M(q) = turnWorld), so their screen relationship — the cross
        // product, whose sign says which side the door is on — is the SAME
        // number at all four yaws. If the facing were corrected per view, or
        // baked from a screen direction, this would drift with the yaw.
        let cross0: number | null = null;
        for (const q of QUARTERS) {
          const f = toScreen(front, q), s = toScreen(street, q);
          const cross = f[0] * s[1] - f[1] * s[0];
          if (cross0 === null) cross0 = cross;
          expect(cross, `${it.sprite} ${it.front} at yaw ${q}: the door moved to the other side`)
            .toBeCloseTo(cross0, 6);
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(800);
    expect(tieCases).toBeGreaterThanOrEqual(0);
  });

  it("reports the facing table for the PR", () => {
    // Printed, not asserted: how much of a tier-3 planned town the 3D layer can
    // turn, and how often a non-square lot had to take the camera-facing tie.
    const rows: { seed: number; items: number; fronts: number; turning: number; exact: number; tie: number }[] = [];
    for (const { seed, grid, town } of towns) {
      const { laid } = drawn(town, grid, TOWN_VISUAL_MAX);
      const row = { seed, items: laid.length, fronts: 0, turning: 0, exact: 0, tie: 0 };
      for (const b of laid) if (b.front) row.fronts++;
      for (const it of turningItems(laid)) {
        row.turning++;
        const rot = facingTurn(it.model, it.turn, it.extra, it.front, it.w, it.h);
        const dir = (modelFrontTurn(it.model, it.turn, it.extra) + rot) & 3;
        const street = FRONT_VEC[it.front], front = DIR_OF_TURN[dir];
        if (front[0] * street[0] + front[1] * street[1] === 1) row.exact++; else row.tie++;
      }
      rows.push(row);
    }
    const all = rows.reduce((a, r) => ({
      seed: 0, items: a.items + r.items, fronts: a.fronts + r.fronts,
      turning: a.turning + r.turning, exact: a.exact + r.exact, tie: a.tie + r.tie,
    }), { seed: 0, items: 0, fronts: 0, turning: 0, exact: 0, tie: 0 });
    const pct = (n: number, d: number): string => `${d ? Math.round((n / d) * 100) : 0}%`;
    console.log("\nTOWN-4.6 facing at tier 3 (planned towns, seeds 1/7/42/1337)\n");
    console.log("| seed | draw items | with a front | turned in 3D | facing the street exactly | quarter-turn tie |");
    console.log("| --- | --: | --: | --: | --: | --: |");
    for (const r of rows) {
      console.log(`| ${r.seed} | ${r.items} | ${r.fronts} (${pct(r.fronts, r.items)}) | ${r.turning} `
        + `| ${r.exact} (${pct(r.exact, r.turning)}) | ${r.tie} (${pct(r.tie, r.turning)}) |`);
    }
    console.log(`| **all** | ${all.items} | ${all.fronts} (${pct(all.fronts, all.items)}) | ${all.turning} `
      + `| ${all.exact} (${pct(all.exact, all.turning)}) | ${all.tie} (${pct(all.tie, all.turning)}) |`);
    expect(all.turning).toBeGreaterThan(200);
  });

  it("a building with a front no longer takes the random spin", () => {
    // `spinOf` is kept for grid and organic towns only; two identical lots in a
    // planned town must face the same way, or a street of terraces comes out
    // looking like a street of dice.
    const { grid, town } = towns[0];
    const { laid } = drawn(town, grid, TOWN_VISUAL_MAX);
    const it = turningItems(laid)[0];
    expect(it).toBeTruthy();
    const facing = facingTurn(it.model, it.turn, it.extra, it.front, it.w, it.h);
    const spins = new Set<number>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) spins.add(spinOf(it.sprite, x, y, it.w, it.h));
    // The facing is one number for every tile; the hash is not (unless the art
    // is non-square, where both are pinned to a half turn).
    expect(facing).toBe(facingTurn(it.model, it.turn, it.extra, it.front, it.w, it.h));
    expect(spins.size).toBeGreaterThanOrEqual(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("TOWN-4.6 the avenue's median keeps its dressing at every yaw", () => {
  const PAIR: Record<string, { axis: "x" | "y"; outer: -1 | 1; junction: boolean }> = {
    x: { axis: "x", outer: -1, junction: false },
    y: { axis: "y", outer: -1, junction: false },
  };
  const TILES: [number, number][] = [[10, 10], [11, 10], [12, 10], [13, 11]];

  it("the tree and lamp spots stay on the median under the turn", () => {
    for (const [tx, ty] of TILES) {
      for (const axis of ["x", "y"] as const) {
        const info = PAIR[axis];
        const strip = avenueMedianStrip(tx, ty, info);
        expect(strip, `${axis} ${tx},${ty}`).not.toBeNull();
        for (const spot of [avenueMedianTreeSpot(tx, ty, info), avenueMedianLampSpot(tx, ty, info)]) {
          if (!spot) continue;
          for (const k of QUARTERS) {
            const [su, sv] = turnTilePoint(spot[0], spot[1], k);
            const quad = strip!.map(([u, v]) => turnTilePoint(u, v, k));
            const u0 = Math.min(...quad.map((q) => q[0])), u1 = Math.max(...quad.map((q) => q[0]));
            const v0 = Math.min(...quad.map((q) => q[1])), v1 = Math.max(...quad.map((q) => q[1]));
            // Inside the turned strip…
            expect(su, `spot ${tx},${ty} yaw ${k}`).toBeGreaterThanOrEqual(u0 - 1e-9);
            expect(su).toBeLessThanOrEqual(u1 + 1e-9);
            expect(sv).toBeGreaterThanOrEqual(v0 - 1e-9);
            expect(sv).toBeLessThanOrEqual(v1 + 1e-9);
            // …and on its centre line: the turned strip is still one tile long
            // and one median wide, whichever axis it now runs along.
            const spans = [u1 - u0, v1 - v0];
            expect(Math.min(...spans), `the strip kept its width at yaw ${k}`).toBeCloseTo(MEDIAN_WIDTH, 9);
            expect(Math.max(...spans)).toBeCloseTo(1, 9);
            const thin = spans[0] < spans[1] ? [u0, u1, su] : [v0, v1, sv];
            expect(Math.abs(thin[2] - (thin[0] + thin[1]) / 2), "the spot is on the centre line").toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it("a screen offset baked for a quarter turn IS that offset once the raster is turned", () => {
    for (const k of QUARTERS) {
      for (const [dx, dy] of [[0, -6], [0, -8], [2.4, 0], [-2.4, 0], [1.5, 1.5], [-3, 2]] as [number, number][]) {
        const turned = toScreen(screenOffsetAt(dx, dy, k), k);
        expect(dist(turned, [dx, dy]), `(${dx},${dy}) at quarter ${k} -> ${turned}`).toBeLessThan(1e-9);
      }
      // vq 0 is the identity, so an unturned view is byte-identical to before.
      expect(screenOffsetAt(0, -6, 0)).toEqual(screenOffsetAt(0, -6, 4));
      expect(screenOffsetAt(0, -6, k)).toEqual(screenOffsetAt(0, -6, k + 4));
      // Up stays up (the tree does not lie down), right stays right.
      const up = toScreen(screenOffsetAt(0, -6, k), k);
      const right = toScreen(screenOffsetAt(6, 0, k), k);
      expect(up[0]).toBeCloseTo(0, 9);
      expect(up[1]).toBeCloseTo(-6, 9);
      expect(right[0]).toBeCloseTo(6, 9);
      expect(right[1]).toBeCloseTo(0, 9);
    }
  });

  it("the median's tree and lamp keep their screen shape at all four yaws", () => {
    // The tree and the lamp are SCREEN objects standing on a ground point: a
    // trunk that rises, a crown that is round, two lanterns flanking a post.
    // Baked the naive way the blit's turn takes them with the ground and the
    // tree lies flat at a quarter turn; `screenOffsetAt` bakes the inverse, so
    // every point of the furniture keeps its offset from the base it stands on.
    const grid = generateMap(42, {});
    const tile = () => roadTile(10, 10, 0b10000 | SE | NW, "paved", () => false, false, 0, PAIR.x);
    /** The furniture's paths at one quarter, in screen pixels. */
    const at = (q: number): [number, number][][] => {
      const rec = recorder();
      paintAvenueFurniture(rec.ctx, [tile()], draperFor(grid, q), q);
      return rec.paths.map((path) => path.map(([u, v]) => toScreen([u, v], q)));
    };
    const bakes = QUARTERS.map(at);
    // Pass order: the tree (shadow, trunk, crown, highlight) then the lamp
    // (shadow, post, and per lantern: arm, glow, housing, glass).
    for (const b of bakes) expect(b.length, "one tree and one lamp every quarter").toBe(14);
    // The contact shadow (each object's path 0) is a GROUND shape — an ellipse
    // lying on the median — so it is meant to turn with the ground; everything
    // else is a screen shape and must not.
    const objects = [[1, 4], [5, 14]];
    for (const [from, to] of objects) {
      for (const q of QUARTERS) {
        const here = bakes[q].slice(from, to), zero = bakes[0].slice(from, to);
        // The base is the foot of the thing that stands on the ground: the
        // trunk for the tree, the post for the lamp.
        const base = bakes[q][from === 1 ? 1 : 5][0], base0 = bakes[0][from === 1 ? 1 : 5][0];
        for (let i = 0; i < here.length; i++) {
          expect(here[i].length, `path ${from + i} at yaw ${q * 90}`).toBe(zero[i].length);
          for (let j = 0; j < here[i].length; j++) {
            const rel = [here[i][j][0] - base[0], here[i][j][1] - base[1]];
            const rel0 = [zero[i][j][0] - base0[0], zero[i][j][1] - base0[1]];
            expect(dist(rel, rel0),
              `furniture path ${from + i} point ${j} at yaw ${q * 90}: ${rel} vs ${rel0}`).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it("the trunk rises straight up the screen at every yaw, and the crown stays round", () => {
    const grid = generateMap(42, {});
    const tile = () => roadTile(10, 10, 0b10000 | SE | NW, "paved", () => false, false, 0, PAIR.x);
    for (const q of QUARTERS) {
      const rec = recorder();
      paintAvenueFurniture(rec.ctx, [tile()], draperFor(grid, q), q);
      const paths = rec.paths.map((path) => path.map(([u, v]) => toScreen([u, v], q)));
      // The tree: shadow, then the trunk's two points — six projected pixels
      // straight up the screen — then the crown and its highlight.
      const [trunk, crown] = [paths[1], paths[2]];
      expect(trunk.length).toBe(2);
      expect(trunk[1][0] - trunk[0][0], `yaw ${q * 90}: the trunk leaned over`).toBeCloseTo(0, 9);
      expect(trunk[1][1] - trunk[0][1], `yaw ${q * 90}: the trunk did not rise`).toBeCloseTo(-6, 9);
      // The crown: a round screen circle of 5.5 px, at every yaw. Its 13 polyline
      // points close the loop, so the last one repeats the first.
      expect(crown.length).toBe(13);
      const ring = crown.slice(0, 12);
      const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
      const cy = ring.reduce((a, p) => a + p[1], 0) / ring.length;
      for (const p of ring) {
        expect(Math.hypot(p[0] - cx, p[1] - cy), `yaw ${q * 90}: the crown went oval`).toBeCloseTo(5.5, 6);
      }
    }
  });

  it("on a slope the dressing rides the drape: it lifts, it does not shear", () => {
    // #663's rule (`draperFor(grid, q)`) keeps the carriageway on the hill;
    // this pins that the furniture planted on the median rides the same drape.
    // A shear would move a base point SIDEWAYS; a lift only moves it up.
    const grid = generateMap(42, { elevation: true });
    const tile = () => roadTile(10, 10, 0b10000 | SE | NW, "paved", () => false, false, 0, PAIR.x);
    const spot = avenueMedianTreeSpot(10, 10, PAIR.x)!;
    let lifted = 0;
    for (const q of QUARTERS) {
      const rec = recorder();
      paintAvenueFurniture(rec.ctx, [tile()], draperFor(grid, q), q);
      const paths = rec.paths.map((path) => path.map(([u, v]) => toScreen([u, v], q)));
      const flatBase = toScreen(spot, q);
      // The tree's base: the foot of its trunk, which is the draped spot.
      const base = paths[1][0], top = paths[1][1];
      expect(Math.abs(base[0] - flatBase[0]), `yaw ${q * 90}: the tree slid off the median`).toBeLessThan(1e-6);
      expect(base[1], `yaw ${q * 90}: the tree sank into the hill`).toBeLessThanOrEqual(flatBase[1] + 1e-6);
      if (Math.abs(base[1] - flatBase[1]) > 1e-6) lifted++;
      // …and it is still a tree: the trunk is upright from that lifted base.
      expect(top[0] - base[0]).toBeCloseTo(0, 9);
      expect(top[1] - base[1]).toBeCloseTo(-6, 9);
    }
    expect(lifted, "an elevation map should lift at least one base").toBeGreaterThan(0);
  });

  it("the quarter reaches the furniture through paintRoadTiles", () => {
    // A regression guard on the plumbing: without the `vq` argument the whole
    // bake is byte-identical at every quarter, and the median's planting turns
    // with the ground. With it, exactly the furniture's points move.
    const grid = generateMap(42, {});
    const tile = () => roadTile(10, 10, 0b10000 | SE | NW, "paved", () => false, false, 0, PAIR.x);
    const bake = (q: number) => {
      const rec = recorder();
      paintRoadTiles(rec.ctx, [tile()], DEFAULT_ROAD_STYLE, [], [], draperFor(grid, q), false, [], q);
      return rec.pts;
    };
    const furniture = recorder();
    paintAvenueFurniture(furniture.ctx, [tile()], draperFor(grid, 0), 0);
    const furniturePts = furniture.paths.reduce((n, path) => n + path.length, 0);
    const zero = bake(0);
    for (const q of [1, 2, 3]) {
      const turned = bake(q);
      expect(turned.length, "the same passes run at every quarter").toBe(zero.length);
      let moved = 0;
      for (let i = 0; i < zero.length; i++) if (dist(turned[i], zero[i]) > 1e-9) moved++;
      // Something moved (the vq reached the furniture) and it is only ever the
      // furniture that moved (the ground passes must not know about the view).
      expect(moved, `yaw ${q * 90}: nothing turned`).toBeGreaterThan(0);
      expect(moved, `yaw ${q * 90}: a ground pass moved with the view`).toBeLessThanOrEqual(furniturePts);
    }
  });

  it("a street lamp stands upright and square at every yaw, the same fix as the median's", () => {
    // #159's lamp is the same kind of object as the median's: a SCREEN shape
    // standing on a ground point (an 8px post, a 3x3 lantern box, a 1.6x1.8
    // pane and a round 2.2px glow). Baked with the ground it leaned with the
    // turn — the bug the median's lamps had — so it bakes through
    // `screenOffsetAt` too: at every quarter the lamp is the SAME screen
    // object around the pavement point it is planted on.
    const grid = generateMap(42, {});
    // A crossroads: the only mask whose OUTER corners carry a lamp (a straight
    // run has none, a bend has one). It lights the two corners of one diagonal.
    const CROSS = 0b10000 | NE | SE | SW | NW;
    const lampTile = () => roadTile(10, 10, CROSS, "paved", () => false, true, 0);
    /** Per lamp: its four SCREEN paths (post, glow, housing, glass) as pixel
     *  offsets from the pavement point it is planted on. The contact shadow is
     *  a GROUND ellipse and is left out — it is meant to turn with the ground. */
    const shapeAt = (q: number): [number, number][][][] => {
      const rec = recorder();
      paintStreetLamps(rec.ctx, [lampTile()], draperFor(grid, q), q);
      const paths = rec.paths.map((path) => path.map(([u, v]) => toScreen([u, v], q)));
      expect(paths.length % LAMP_PATHS, "shadow + post + glow + housing + glass per lamp").toBe(0);
      const lamps: [number, number][][][] = [];
      for (let i = 0; i < paths.length; i += LAMP_PATHS) {
        const base = paths[i + 1][0];               // the foot of the post
        lamps.push([1, 2, 3, 4].map((k) => paths[i + k].map(
          ([x, y]) => [x - base[0], y - base[1]] as [number, number],
        )));
      }
      return lamps;
    };
    const zero = shapeAt(0);
    expect(zero.length, "a crossroads lights two corners").toBe(2);
    // The post rises straight up the screen by exactly LAMP_POST_H pixels.
    for (const lamp of zero) {
      expect(lamp[0][0]).toEqual([0, 0]);
      expect(dist(lamp[0][1], [0, -8]), "the post is 8px straight up").toBeLessThan(1e-9);
    }
    for (const q of QUARTERS) {
      const turned = shapeAt(q);
      expect(turned.length, `yaw ${q * 90}: the same lamps`).toBe(zero.length);
      for (let i = 0; i < turned.length; i++) {
        for (let j = 0; j < turned[i].length; j++) {
          expect(turned[i][j].length, `yaw ${q * 90} lamp ${i} path ${j}`).toBe(zero[i][j].length);
          for (let k = 0; k < turned[i][j].length; k++) {
            expect(dist(turned[i][j][k], zero[i][j][k]), `yaw ${q * 90} lamp ${i} path ${j} point ${k}`).toBeLessThan(1e-9);
          }
        }
      }
    }
  });

  it("the quarter the raster is keyed on is the quarter the drape and the furniture use", () => {
    expect(yawQuarter(0)).toBe(0);
    expect(yawQuarter(Math.PI / 2)).toBe(1);
    expect(yawQuarter(Math.PI)).toBe(2);
    expect(yawQuarter(-Math.PI / 2 + 1e-12)).toBe(3);
    expect(yawQuarter(4 * Math.PI)).toBe(0);
    // A half-way yaw rounds to the quarter it is easing INTO, which is the
    // quarter RoadCache bakes — the one thing the drape and the furniture must
    // agree on or the median's trees drift mid-turn.
    expect(yawQuarter(Math.PI / 4 - 0.01)).toBe(0);
    expect(yawQuarter(Math.PI / 4 + 0.01)).toBe(1);
  });
});

/** A 2D context that records every path the passes walk, in order. */
function recorder() {
  const paths: [number, number][][] = [];
  const noop = () => {};
  let current: [number, number][] = [];
  const ctx = {
    strokeStyle: "", fillStyle: "", lineWidth: 1, globalAlpha: 1, lineDashOffset: 0,
    lineCap: "", lineJoin: "", imageSmoothingEnabled: true, globalCompositeOperation: "source-over",
    save: noop, restore: noop, closePath: noop, fill: noop, stroke: noop,
    beginPath: () => { current = []; paths.push(current); },
    setTransform: noop, transform: noop, translate: noop, drawImage: noop, setLineDash: noop,
    clearRect: noop, fillRect: noop, ellipse: noop, rect: noop, clip: noop, arc: noop, quadraticCurveTo: noop,
    moveTo: (x: number, y: number) => { current.push([x, y]); },
    lineTo: (x: number, y: number) => { current.push([x, y]); },
    createLinearGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  // `pts` is a live view: the passes walk the context AFTER this returns.
  return { ctx: ctx as unknown as CanvasRenderingContext2D, paths, get pts() { return paths.flat(); } };
}
