// ══════════════════════════════════════════════════════════════════════════
// FTUE-1 (#464) — the Starter Island's unit pins.
//   • the preset MAP: one town, four industries near it, gentle terrain (every
//     industry stands on a flat apron) — pinned on many seeds, not one lucky
//     draw, and the ordinary generator stays ordinary;
//   • the trainee rival's flags — especially "never contests" and "never
//     challenges" (its numbers are the PIN, `winTarget` the scenario's short
//     line: first to 6★), plus a behavioural pin that a contest-free plan
//     never reaches for an industry the player has staked;
//   • first-launch ROUTING (App): the onboarding key and the fresh-link guard.
// The guide chain's own content is TUT-03's (already tested in iso-guide /
// iso-l8); here the chain ORDER the first game runs, end to end.
// ══════════════════════════════════════════════════════════════════════════
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GRASS, ROUGH, STARTER_ISLAND, STARTER_ISLAND_SEED, WATER, generateMap, heightAt, starterIslandGrid,
  type Grid,
} from "../../src/iso/grid";
import { RIVAL_SKILLS, SKILL_KEYS, type SkillKey } from "../../src/iso/skill";
import { BATTLE_SKILLS } from "../../src/iso/battle-ai";
import { difficultyRulesFor } from "../../src/iso/tuning";
import { FIRST_GAME_CHAIN } from "../../src/iso/guide";
import { planCandidates } from "../../src/iso/ai";
import { industriesInCatchment, type EconomyState, type Factory, type Harvester } from "../../src/iso/economy";
import { createTrack } from "../../src/iso/track";
import { MAP_H, MAP_W } from "../../src/game/config";

const height = (g: Grid, x: number, y: number): number => heightAt(g, x, y);

/** Point (px,py) ↔ axis-aligned rect (x..x+w-1, y..y+h-1), Chebyshev. */
const pointRectDist = (
  px: number, py: number, x: number, y: number, w: number, h: number,
): number => {
  const dx = Math.max(x - px, 0, px - (x + w - 1));
  const dy = Math.max(y - py, 0, py - (y + h - 1));
  return Math.max(dx, dy);
};

/** The map's idea of an industry footprint (all starter kinds are 4×4). */
const spanOf = (): [number, number] => [4, 4];

/**
 * The Starter Island's contract with the FTUE-1 ticket: a small world the
 * player can learn in — ONE town, the four road industries within N tiles of
 * it (the Default line's 32: closer than "several match-3 boards" and a
 * healthy streak from the dock), and GENTLE terrain — every industry stands
 * on a flat apron (its own level, never ROUGH), so every one of them is
 * actually buildable.
 */
function expectStarterInvariants(g: Grid, n = 32): void {
  // one town
  expect(g.towns.length).toBe(1);
  const town = g.towns[0]!;

  // four industries, one of each starter kind
  expect(g.industries.length).toBe(4);
  expect(g.industries.map((i) => i.type).sort()).toEqual(["farm", "forest", "ore_mine", "quarry"]);

  // each within N tiles of the town
  for (const ind of g.industries) {
    const [w, h] = spanOf();
    const d = pointRectDist(town.tx, town.ty, ind.tx, ind.ty, w, h);
    expect(d, `${ind.type} is ${d} tiles from the town`).toBeLessThanOrEqual(n);
  }

  // gentle terrain: an apron at the industry's own level around every one of
  // them (water tolerated at the rim — a preset island can kiss the coast).
  for (const ind of g.industries) {
    const [w, h] = spanOf();
    const level = height(g, ind.tx, ind.ty);
    for (let y = ind.ty - 1; y <= ind.ty + h; y++) {
      for (let x = ind.tx - 1; x <= ind.tx + w; x++) {
        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
        if (x >= ind.tx && x < ind.tx + w && y >= ind.ty && y < ind.ty + h) continue; // the lot itself
        const t = g.terrain[x + y * MAP_W]!;
        if (t === WATER) continue;
        expect(height(g, x, y), `apron tile (${x},${y}) of ${ind.type}`).toBe(level);
        // …and never a rough tile: the apron is TERRAIN-gentle, not just level.
        expect(t, `apron tile (${x},${y}) of ${ind.type}`).not.toBe(ROUGH);
      }
    }
  }
}

describe("FTUE-1 (#464) the Starter Island map preset", () => {
  it("one town, four industries close by, flat aprons", () => {
    const g = starterIslandGrid();
    expectStarterInvariants(g);
  });

  it("holds on six more seeds (the preset's placement, not one lucky draw)", () => {
    for (const seed of [1, 2, 3, 4, 5, 20260926]) {
      const g = generateMap(seed, { preset: STARTER_ISLAND });
      expectStarterInvariants(g);
    }
  });

  it("the ordinary generator is still ordinary", () => {
    const g = generateMap(STARTER_ISLAND_SEED);
    expect(g.towns.length).toBeGreaterThan(1);
    expect(g.industries.length).toBeGreaterThan(4);
    // …and the preset rides alongside it: same seed, preset map, Starter
    // Island — two different products of one generator.
    const s = generateMap(STARTER_ISLAND_SEED, { preset: STARTER_ISLAND });
    expect(s.towns.length).toBe(1);
  });
});

describe("FTUE-1 (#464) the trainee rival", () => {
  it("builds slowly, never contests, never challenges", () => {
    const t = RIVAL_SKILLS.trainee;
    // slow
    expect(t.buildMs).toBeGreaterThan(RIVAL_SKILLS.normal.buildMs);
    expect(t.idleMs).toBeGreaterThan(RIVAL_SKILLS.normal.idleMs);
    expect(t.expandPerTurn).toBeLessThanOrEqual(RIVAL_SKILLS.normal.expandPerTurn);
    expect(t.urgencyBias).toBeLessThan(RIVAL_SKILLS.normal.urgencyBias);
    // never contests the player's industries, never calls a battle
    expect(t.contests).toBe(false);
    expect(t.challenges).toBe(false);
    // the small easies the ticket names
    expect(t.raidEveryMs).toBe(0);
    expect(t.blockades).toBe(false);
    expect(t.rail).toBe(false);
    // …and the scenario's short race
    expect(t.winTarget).toBe(6);
  });

  it("is a SkillKey with battle and difficulty rows (the ladder untouched)", () => {
    const key: SkillKey = "trainee";
    expect(RIVAL_SKILLS[key].key).toBe("trainee");
    // the difficulty picker's ladder is still exactly three (its pin)
    expect(SKILL_KEYS).toEqual(["easy", "normal", "hard"]);
    // the shared battle rows are Record<SkillKey, …> — the trainee has one
    expect(BATTLE_SKILLS.trainee.challengeEveryMs).toBe(Infinity);
    expect(BATTLE_SKILLS.trainee.depth).toBe(0);
    // the tuning ladder aliases it onto the easy rules without a new row
    expect(difficultyRulesFor("trainee")).toBe(difficultyRulesFor("easy"));
    // the other three keep their own rows
    expect(difficultyRulesFor("hard")).not.toBe(difficultyRulesFor("easy"));
  });

  it("a contest-free plan never reaches for an industry the player has staked", () => {
    // A tiny economy on the Starter Island: the player's network has staked
    // the farm (a harvester's catchment — the claim rule's unit), and the
    // trainee plans from its own factory.
    const grid = starterIslandGrid();
    const track = createTrack();
    const farm = grid.industries.find((i) => i.type === "farm")!;
    const player: Harvester = { id: 1, owner: "you", ownerId: 1, tx: farm.tx - 2, ty: farm.ty };
    // the rival plans from its factory on open ground near the map centre
    // (a scan, not a guess: town and industry tiles are impassable to the
    // planner, so the fixture must stand on real buildable grass)
    const open = (() => {
      const cx = Math.floor(MAP_W / 2), cy = Math.floor(MAP_H / 2);
      for (let r = 0; r < 80; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = cx + dx, y = cy + dy;
            if (x < 8 || y < 8 || x >= MAP_W - 8 || y >= MAP_H - 8) continue;
            const i = x + y * MAP_W;
            if (grid.terrain[i] !== GRASS || grid.occupancy[i] !== -1) continue;
            return [x, y] as const;
          }
        }
      }
      throw new Error("no open ground on the Starter Island?");
    })();
    const rivalF: Factory = { owner: "ai", ownerId: 2, tx: open[0], ty: open[1], id: 2, townId: null };
    const eco: EconomyState = { grid, track, harvesters: [player], factories: [rivalF] };
    const purse = { wood: 999, stone: 999, grain: 999, oil: 999, ore: 999, gold: 999 };
    const catchesFarm = (c: { hx: number; hy: number }): boolean =>
      industriesInCatchment(grid, {
        id: -1, owner: "ai", ownerId: 2, tx: c.hx, ty: c.hy,
      }).some((x) => x.id === farm.id);

    // the player's stake is real: the harvester's catchment holds the farm
    expect(industriesInCatchment(grid, player).some((x) => x.id === farm.id)).toBe(true);

    // an ordinary rival plans for it (the shipped race) …
    const racing = planCandidates(eco, rivalF, { stock: {}, purse, free: 24, freeDepots: 4 });
    expect(racing.some(catchesFarm)).toBe(true);

    // …the trainee never does: no lot of any plan can take the player's stake.
    const polite = planCandidates(eco, rivalF, {
      stock: {}, purse, free: 24, freeDepots: 4, contests: false,
    });
    expect(polite.some(catchesFarm)).toBe(false);
    // it still PLANS — just away from the player's ground (the other three).
    expect(polite.length).toBeGreaterThan(0);
  });
});

describe("FTUE-1 (#464) the first game's chain", () => {
  it("runs the ticket's five, in the ticket's order (rail and the drawer are later questions)", () => {
    expect(FIRST_GAME_CHAIN).toEqual(["getting-started", "factory", "depots", "logistics", "upgrades"]);
  });
});

describe("FTUE-1 (#464) first-launch routing (App)", () => {
  const KEY = "hexmatch:onboarded";
  const freshen = (search: string) => vi.stubGlobal("location", {
    ...window.location,
    href: `https://example.test/${search}`,
    search,
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("isFirstLaunch: fresh browser true; onboarding done false; a save false; a pinned link false", async () => {
    // The module keeps these helpers out of the export surface; the App's
    // first-launch decision is the thing to pin. (Direct wiring lives in the
    // play-test checklist.)
    const mod = await import("../../src/App");
    expect(mod.ONBOARDED_KEY).toBe(KEY);
    expect(typeof mod.isFirstLaunch).toBe("function");
    expect(typeof mod.markOnboarded).toBe("function");

    localStorage.clear();
    freshen("");
    expect(mod.isFirstLaunch()).toBe(true);

    mod.markOnboarded();
    expect(localStorage.getItem(KEY)).toBe("1");
    expect(mod.isFirstLaunch()).toBe(false);

    localStorage.clear();
    freshen("?seed=1337");
    expect(mod.isFirstLaunch()).toBe(false);

    localStorage.clear();
    freshen("?fresh=1");
    expect(mod.isFirstLaunch()).toBe(true);
    mod.markOnboarded();                       // …and a fresh link never writes
    expect(localStorage.getItem(KEY)).toBe(null);
  });
});
