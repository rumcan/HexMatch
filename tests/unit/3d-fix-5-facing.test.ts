// 3D-FIX-5 (#664) — VEHICLE, PLATFORM AND DEPOT MODELS FACE AND SIT CORRECTLY AT EVERY YAW.
//
// Three things have to be true of a 3D model that moves or that has a front:
//
//  1. its FRONT points along the direction of travel, at every heading and at every view yaw;
//  2. a rail platform's LONG axis follows the rail axis of its view (a 1x4 platform is not a 4x1 one);
//  3. the plan that is fitted to a footprint is the plan AFTER the quarter turn, not before.
//
// All three are DATA questions, so this file drives them as tables: the heading table and the alias table from
// src/iso/three-layer.ts, the front axis and its flip from tools/models/build-models.mjs, and the plan extents
// from public/models/manifest.json. Nothing here renders, so nothing here needs a browser.
//
// THE CONVENTION (see the comment on HEADING_DEG in three-layer.ts): a heading is a GROUND direction —
// se = +u, sw = +v, nw = -u, ne = -v — and the whole three scene is seen through the turned camera, so the
// model's own yaw never depends on the view yaw. That is what "at every yaw" is testing: the front and the
// travel direction are turned by the SAME map, so they agree at all four quarters or at none.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { HW, HH } from "../../src/game/config";
import { HEADING_DEG, VEHICLE_MODEL_ALIAS, modelOf, spinOf } from "../../src/iso/three-layer";
import { PLATFORM_FOOTPRINT, DEPOT_FOOTPRINT } from "../../src/iso/rail";
import { CAR_MODELS, CAR_VIEWS } from "../../src/iso/ambience";
import { turnWorld } from "../../src/iso/camera";

// ── the data under test ─────────────────────────────────────────────────────────────────────────────────────
const manifest = JSON.parse(
  readFileSync(new URL("../../public/models/manifest.json", import.meta.url), "utf8"),
) as Record<string, { turn: number; ex: number; ez: number; h: number; moving?: boolean; lengthM?: number }>;
const buildSrc = readFileSync(new URL("../../tools/models/build-models.mjs", import.meta.url), "utf8");

/** FRONT_AXIS from the builder: the axis a model's FRONT points along in its own frame ("-x" = came out backwards). */
const FRONT_AXIS: Record<string, string> = Object.fromEntries(
  [...(/const FRONT_AXIS = \{([\s\S]*?)\};/.exec(buildSrc)?.[1] ?? "").matchAll(/(\w+):\s*"(-?x)"/g)]
    .map((m) => [m[1], m[2]]),
);

const MOVING = [
  "car_sedan_1", "car_sedan_2", "car_sedan_3",
  "vehicle_truck", "vehicle_truck_blue",
  "rail_loco", "rail_tender", "rail_box", "rail_flat", "rail_tank",
] as const;
const HEADINGS8 = ["se", "e", "ne", "n", "nw", "w", "sw", "s"] as const;
const HEADINGS4 = ["ne", "se", "sw", "nw"] as const;
const QUARTERS = [0, 1, 2, 3] as const;
const S = Math.SQRT1_2;
/** A heading is a GROUND direction: +u runs to the screen's south-east, +v to its south-west. */
const TRAVEL: Record<string, [number, number]> = {
  se: [1, 0], e: [S, -S], ne: [0, -1], n: [-S, -S], nw: [-1, 0], w: [-S, S], sw: [0, 1], s: [S, S],
};
const yawRad = (q: number) => (q * Math.PI) / 2;
/** A ground-plane direction -> screen pixels, under the view turn (the terrain's own linear map). */
const toScreen = ([du, dv]: [number, number], q: number): [number, number] =>
  turnWorld((du - dv) * HW, (du + dv) * HH, yawRad(q));
const cross = (a: readonly number[], b: readonly number[]) => a[0] * b[1] - a[1] * b[0];
const len = (a: readonly number[]) => Math.hypot(a[0], a[1]);

/**
 * The front that SHIPPES: +1 along the model's own X, or -1 if a model is recorded as backwards in FRONT_AXIS
 * and is not corrected by FLIP. FLIP is derived from FRONT_AXIS in the builder (one source of truth), so a
 * "-x" model is always flipped — but the test reads the derivation too, and fails if it ever stops being so.
 */
const frontSign = (model: string): number => (FRONT_AXIS[model] === "-x" && !flippedInBuild(model) ? -1 : 1);
const flippedInBuild = (model: string): boolean => FRONT_AXIS[model] === "-x";
/** three's Y rotation by a: x' = x cos a + z sin a, z' = -x sin a + z cos a, and (X, Z) is (u, v). */
const frontGround = (model: string, heading: string): [number, number] => {
  const a = ((HEADING_DEG[heading] ?? 0) * Math.PI) / 180;
  const fx = frontSign(model);
  return [fx * Math.cos(a), -fx * Math.sin(a)];
};

describe("3D-FIX-5 nothing drives backwards", () => {
  it("the flip is derived from the front-axis table, so the two can never drift apart", () => {
    // A hand-kept second list is how a model ends up driving in reverse after someone edits one half of it.
    expect(buildSrc).toMatch(/const FLIP = Object\.fromEntries\(Object\.entries\(FRONT_AXIS\)/);
    expect(Object.keys(FRONT_AXIS).length).toBeGreaterThan(0);
    for (const [model, axis] of Object.entries(FRONT_AXIS)) {
      expect(axis === "-x" || axis === "+x", `${model}: ${axis}`).toBe(true);
    }
  });

  it("every moving model exists and ships with its front on +X", () => {
    for (const m of MOVING) {
      expect(manifest[m], `${m} is in public/models/manifest.json`).toBeTruthy();
      expect(manifest[m].moving, `${m} is a moving model`).toBe(true);
      expect(frontSign(m), `${m} would drive backwards`).toBe(1);
    }
  });
});

describe("3D-FIX-5 the front points along the direction of travel", () => {
  it("for 10 models x 4 headings x 4 view yaws (160 cases)", () => {
    for (const model of MOVING) {
      for (const heading of HEADINGS4) {
        for (const q of QUARTERS) {
          const front = toScreen(frontGround(model, heading), q);
          const travel = toScreen(TRAVEL[heading], q);
          const d = Math.hypot(front[0] - travel[0], front[1] - travel[1]);
          expect(d, `${model} ${heading} yaw ${q * 90}: front ${front} vs travel ${travel}`).toBeLessThan(1e-9);
        }
      }
      // …and it is a real turn, not a coincidence of the four diagonals: the eight headings all agree too.
      for (const heading of HEADINGS8) {
        const front = frontGround(model, heading);
        expect(Math.hypot(front[0] - TRAVEL[heading][0], front[1] - TRAVEL[heading][1]),
          `${model} ${heading}`).toBeLessThan(1e-9);
      }
    }
  });

  it("the same model yaw is used at every view yaw — the camera turn is not baked into the heading", () => {
    // The whole point of the bug: if the heading were corrected per view, the front would only be right at
    // yaw 0. The ground-space front is the same number at all four quarters (it is the SCREEN vector that turns).
    for (const model of MOVING) {
      for (const heading of HEADINGS4) {
        const g = frontGround(model, heading);
        for (const q of QUARTERS) {
          const s = toScreen(g, q);
          const t = toScreen(TRAVEL[heading], q);
          expect(Math.abs(len(s) - len(t))).toBeLessThan(1e-9);   // the turn is rigid: no stretch either
          expect(Math.abs(cross(s, t))).toBeLessThan(1e-9);        // parallel, and the test above pins the sign
        }
      }
    }
  });

  it("the blue livery faces the same way as the red lorry it is painted from", () => {
    // vehicle_truck_blue is the same geometry with its red turned to hue 215, so it must inherit the flip.
    for (const heading of HEADINGS8) {
      expect(frontGround("vehicle_truck_blue", heading)).toEqual(frontGround("vehicle_truck", heading));
    }
  });

  it("the heading table covers exactly the eight headings the sprites use", () => {
    expect(Object.keys(HEADING_DEG).sort()).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
  });
});

describe("3D-FIX-5 pickup, van and bus keep the lorry's scaling, through ONE table", () => {
  it("is one table, every alias resolves, and the lorry-bodied three are the lorry", () => {
    expect(Object.keys(VEHICLE_MODEL_ALIAS).sort()).toEqual(["bus", "pickup", "sedan", "sedan2", "van"]);
    for (const [car, alias] of Object.entries(VEHICLE_MODEL_ALIAS)) {
      expect(manifest[alias.model], `${car} -> ${alias.model} exists`).toBeTruthy();
      expect(manifest[alias.model].moving, `${car} -> ${alias.model} is a moving model`).toBe(true);
    }
    // The bug the handover listed: pickup was a finned sedan, so a pickup was shorter than the car it passed.
    for (const car of ["pickup", "van", "bus"]) {
      expect(VEHICLE_MODEL_ALIAS[car].model, `${car} keeps the lorry`).toBe("vehicle_truck");
    }
  });

  it("scales uniformly — one length, never a per-axis stretch", () => {
    for (const [car, alias] of Object.entries(VEHICLE_MODEL_ALIAS)) {
      const m = manifest[alias.model];
      const lengthM = alias.lengthM ?? m.lengthM ?? 5;
      const s = lengthM / 12;                     // one tile = 12 m: the lorry's own scaling, unchanged
      expect(s).toBeGreaterThan(0.25);
      expect(s).toBeLessThan(1);
      // The length is the ONLY thing an alias may change: the model's plan is squared to the grid, so the
      // fitted plan is the length along X and (length x ez/ex) along Z, i.e. the model's own proportions.
      const alongX = s, alongZ = s * (m.ez / m.ex);
      expect(Math.abs(alongZ / alongX - m.ez / m.ex), `${car} keeps the lorry's proportions`).toBeLessThan(1e-12);
      expect(alongX).toBeLessThanOrEqual(1);      // a vehicle never grows past its own tile of track
    }
  });

  it("the lengths follow the 1x art, not taste", () => {
    // The shipped lorry sprite is 26 px at 1x for 7 m; the ambience notes size sedan 22, pickup 24, van 22, bus 32.
    const pxPerM = 26 / 7;
    for (const [car, px] of [["pickup", 24], ["van", 22], ["bus", 32]] as const) {
      const want = px / pxPerM;
      expect(Math.abs((VEHICLE_MODEL_ALIAS[car].lengthM ?? 0) - want),
        `${car} is ${VEHICLE_MODEL_ALIAS[car].lengthM} m, the art says ${want.toFixed(2)} m`).toBeLessThan(1);
    }
  });
});

describe("3D-FIX-5 the platform's long axis follows the rail axis", () => {
  it("at all four views, and at all four view yaws (the axis is turned with the ground, not re-chosen)", () => {
    const mi = manifest.platform;
    expect(mi, "the platform model is in the manifest").toBeTruthy();
    expect(mi.ex).toBeGreaterThan(mi.ez);                      // the model lies along its own X
    for (const view of HEADINGS4) {
      const mo = modelOf(`platform_${view}`, manifest);
      expect(mo?.name, `platform_${view} resolves to a model`).toBe("platform");
      const fp = PLATFORM_FOOTPRINT[view];
      const longAlongU = fp[0] >= fp[1];
      for (const q of QUARTERS) {
        // spinOf is 0 or 2 for a non-square footprint, so it cannot change the axis — only `extra` can.
        const rot = (mi.turn + mo!.extra + (spinOf(`platform_${view}`, 10, 10, fp[0], fp[1]) | 0)) & 3;
        const axisGround: [number, number] = [Math.cos((rot * Math.PI) / 2), -Math.sin((rot * Math.PI) / 2)];
        const railGround: [number, number] = longAlongU ? [1, 0] : [0, 1];
        const a = toScreen(axisGround, q), b = toScreen(railGround, q);
        expect(Math.abs(cross(a, b)), `platform_${view} at yaw ${q * 90}: long axis off the rail`).toBeLessThan(1e-9);
      }
    }
  });

  it("sits on its footprint: the plan is fitted AFTER the quarter turn, so a 1x4 is not a 4x1", () => {
    // The fit in three-layer's fill(): the extents are swapped for an odd turn, then filled to 0.92 of the lot.
    // Without that swap a 1x4 platform would be fitted as if it were 4 wide and 1 long — a one-tile stub.
    const mi = manifest.platform;
    for (const view of HEADINGS4) {
      const mo = modelOf(`platform_${view}`, manifest)!;
      const [w, h] = PLATFORM_FOOTPRINT[view];
      const rot = (mi.turn + mo.extra) & 3;
      const ex = rot & 1 ? mi.ez : mi.ex, ez = rot & 1 ? mi.ex : mi.ez;
      const s = Math.min((w * 0.92) / ex, (h * 0.92) / ez);
      // ex / ez are ALREADY the model's extents along the lot's u / v after the turn.
      const alongU = ex * s, alongV = ez * s;
      expect(alongU, `platform_${view} wider than its lot`).toBeLessThanOrEqual(w + 1e-9);
      expect(alongV, `platform_${view} longer than its lot`).toBeLessThanOrEqual(h + 1e-9);
      // …and it FILLS the lot: the constraining side is 0.92 of it (the standard fill) — a platform that ends
      // up a single tile long is the bug this catches.
      expect(Math.max(alongU / w, alongV / h), `platform_${view} does not fill its lot`).toBeCloseTo(0.92, 9);
      // …and it keeps the MODEL's shape (1 : 0.2634, the plan the builder squared), turned with the lot — not
      // the lot's own 1:4, and not the unturned plan either.
      expect(alongV / alongU, `platform_${view} keeps its own shape`).toBeCloseTo(ez / ex, 9);
    }
  });
});

describe("3D-FIX-5 the train depot has all four views", () => {
  it("resolves every view and advances one quarter turn per view", () => {
    const mi = manifest["train-depot"];
    expect(mi, "the depot model is in the manifest").toBeTruthy();
    const rots = HEADINGS4.map((view) => {
      const mo = modelOf(`train-depot_${view}`, manifest);
      expect(mo?.name, `train-depot_${view} resolves to a model`).toBe("train-depot");
      return (mi.turn + mo!.extra) & 3;
    });
    // ne -> se -> sw -> nw is one quarter turn each, so the entrance sweeps the compass exactly once.
    for (let i = 1; i < rots.length; i++) expect(rots[i]).toBe((rots[i - 1] + 1) & 3);
    expect(new Set(rots).size).toBe(4);
  });

  it("sits on its 2x2 footprint with a uniform scale", () => {
    const mi = manifest["train-depot"];
    const [w, h] = DEPOT_FOOTPRINT;
    expect([w, h]).toEqual([2, 2]);
    for (const view of HEADINGS4) {
      const mo = modelOf(`train-depot_${view}`, manifest)!;
      const rot = (mi.turn + mo.extra) & 3;
      const ex = rot & 1 ? mi.ez : mi.ex, ez = rot & 1 ? mi.ex : mi.ez;
      const s = Math.min((w * 0.92) / ex, (h * 0.92) / ez);
      const alongU = ex * s, alongV = ez * s;
      expect(alongU).toBeLessThanOrEqual(w + 1e-9);
      expect(alongV).toBeLessThanOrEqual(h + 1e-9);
      expect(Math.max(alongU / w, alongV / h)).toBeCloseTo(0.92, 9);
    }
  });
});

describe("3D-FIX-5 the 2D art is hidden only where the 3D layer really draws", () => {
  const gameSrc = readFileSync(new URL("../../src/iso/game.ts", import.meta.url), "utf8");

  it("the alias table is exactly the sim's CAR_MODELS, so no car is left without an alias", () => {
    expect([...CAR_MODELS].sort()).toEqual(Object.keys(VEHICLE_MODEL_ALIAS).sort());
    // …and every alias covers every heading the sim can ask for (`car_<model>_<view>`).
    for (const model of CAR_MODELS) {
      for (const view of CAR_VIEWS) {
        expect(VEHICLE_MODEL_ALIAS[model], `${model}_${view}`).toBeTruthy();
        expect(HEADING_DEG[view], `heading ${view}`).toBeTypeOf("number");
      }
    }
  });

  it("a rail structure's 2D art is hidden only when a 3D model replaces it", () => {
    const rail3d = /const RAIL_3D = (\/\^[^;]+\/)/.exec(gameSrc)?.[1] ?? "";
    expect(rail3d).toBeTruthy();
    const re = new RegExp(rail3d.slice(1, -1));
    for (const view of HEADINGS4) {
      expect(re.test(`platform_${view}`), `platform_${view} is drawn in 3D, so its 2D art is hidden`).toBe(true);
      expect(re.test(`train-depot_${view}`), `train-depot_${view} is drawn in 3D`).toBe(true);
      // …and each of them has a model to replace it with: nothing is hidden into thin air.
      expect(modelOf(`platform_${view}`, manifest)?.name).toBe("platform");
      expect(modelOf(`train-depot_${view}`, manifest)?.name).toBe("train-depot");
    }
    // Rail art the 3D layer does NOT draw keeps its 2D sprite.
    for (const other of ["passing_loop_se", "track_se_nw", "platform_cap_se", "buffer_stop_se"]) {
      expect(re.test(other), `${other} keeps its 2D art`).toBe(false);
    }
  });

  it("the two hide contracts are wired to the same predicates the 3D layer answers with", () => {
    expect(gameSrc).toMatch(/setHideVehicle\(\(e\) => threeLayer\.drawsVehicle\(e\.sprite\)\)/);
    expect(gameSrc).toMatch(/RAIL_3D\.test\(e\.sprite\)/);                 // only the rail art the 3D layer draws
    expect(gameSrc).toMatch(/&& threeLayer\.drawsSprite\(e\.sprite\)/);    // …and only when its model is ready
    // A vehicle is hidden ONLY when its model is ready, so a model that fails to load falls back to the sprite.
    const src = readFileSync(new URL("../../src/iso/three-layer.ts", import.meta.url), "utf8");
    expect(src).toMatch(/const drawsVehicle = \(sprite: string\): boolean => \{\s*\n\s*if \(noModels\) return false;/);
    expect(src).toMatch(/return !!sp && vReady\(sp\.st\);/);
  });
});

describe("3D-FIX-5 the tables are data, not per-frame work", () => {
  it("adds nothing to the vehicle loop: a heading is one table lookup, an alias one table lookup", () => {
    // fps is the first rule of this layer: every lookup the vehicle loop makes is a property read on a module
    // constant. If either table ever becomes a function call per frame, this is the test that should notice.
    const src = readFileSync(new URL("../../src/iso/three-layer.ts", import.meta.url), "utf8");
    expect(src).toMatch(/export const HEADING_DEG: Record<string, number>/);
    expect(src).toMatch(/export const VEHICLE_MODEL_ALIAS: Record<string, \{ model: string; lengthM\?: number \}>/);
    expect(src).toMatch(/const c = VEHICLE_MODEL_ALIAS\[m\[1\]\]/);
    expect(src).toMatch(/yaw: \(HEADING_DEG\[view\] \* Math\.PI\) \/ 180/);
    // …and the spec is memoised per sprite name, so a frame that draws 200 lorries still parses nothing.
    expect(src).toMatch(/let sp = vSpecs\.get\(sprite\);/);
    expect(src).toMatch(/if \(sp !== undefined\) return sp;/);
  });
});
