// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// PROG-1 (#475) — scenario unlocks and campaign flow (no RUN, no cosmetics).
//
//   · the four scenario presets generate reliably (one invariant test each);
//   · scenario unlocks persist, and locked cards say how they open;
//   · the campaign flow: chapter bests and the next-contract door;
//   · the MainMenu Scenarios door and the ending's Next-contract button.
//
// Map budgets: elevation maps cost ~7 s each, so each preset test generates
// at most three of them (well under the 30 s per-test limit).
// ══════════════════════════════════════════════════════════════════════════
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The scenario list mounts the REAL StartScreen; only the room lifecycle is
// faked, exactly as tests/unit/start-screen.test.ts fakes it.
vi.mock("../../src/net/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/net/transport")>();
  return {
    ...actual,
    createRoom: vi.fn(),
    joinRoomByCode: vi.fn(),
    quickMatch: vi.fn(),
    listRejoinableRooms: vi.fn(),
    readActiveMatch: vi.fn(),
    writeActiveMatch: vi.fn(),
    promptLogin: vi.fn(async () => ({ success: false })),
    isOfflineMockRealtime: vi.fn(() => false),
  };
});
vi.mock("../../src/net/rankstore", () => ({
  rankStore: () => ({
    loadState: async () => ({ rating: 1180, matches: 12, wins: 7, losses: 5, season: "s1" }),
    fileResult: async () => ({ state: null, verdict: null, applied: true, ladder: null }),
    loadLadder: async () => null,
  }),
}));
import {
  FRESH_SCENARIOS, SCENARIOS, SCENARIO_STORAGE_KEY, describeScenarioBest,
  effectiveUnlocked, formatBestTime, isScenarioUnlocked, loadScenarioProgress,
  nextScenarioId, pinnedScenario, recordScenarioResult, scenarioById,
  scenarioMapGen, scenarioUnlockHint,
} from "../../src/story/scenarios";
import {
  FRESH_PROGRESS, loadStoryProgress, recordChapterResult,
} from "../../src/story/progress";
import { CHAPTERS, chapterAfter } from "../../src/story/chapters";
import {
  generateMap, footprintNearWater, idx, landComponentCount, WATER,
  type Grid,
} from "../../src/iso/grid";
import { MAP_H, MAP_W } from "../../src/game/config";
import MainMenu from "../../src/ui/MainMenu";
import {
  buildEnding, showEndingScreen, type EndingInput,
} from "../../src/iso/ending";
import StartScreen, { type StartChoice } from "../../src/ui/StartScreen";

const store = (init: Record<string, string> = {}) => ({
  getItem: (k: string) => (k in init ? init[k] : null),
  setItem: (k: string, v: string) => { init[k] = v; },
});

const scenarioMap = (id: string): Grid => {
  const def = scenarioById(id)!;
  return generateMap(def.seed, scenarioMapGen(def, def.mapOptions));
};

/** Same seed twice → the same map, byte for byte. */
function expectSameMap(a: Grid, b: Grid): void {
  expect([...a.terrain]).toEqual([...b.terrain]);
  expect([...(a.height ?? [])]).toEqual([...(b.height ?? [])]);
  expect(a.industries.map((i) => [i.type, i.tx, i.ty, i.w, i.h]))
    .toEqual(b.industries.map((i) => [i.type, i.tx, i.ty, i.w, i.h]));
  expect(a.towns.map((t) => [t.tx, t.ty, t.houses.length, t.roads.length]))
    .toEqual(b.towns.map((t) => [t.tx, t.ty, t.houses.length, t.roads.length]));
  expect(a.rivers ? [...a.rivers] : null).toEqual(b.rivers ? [...b.rivers] : null);
}

const countMask = (mask: Uint8Array | undefined): number => {
  if (!mask) return 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
};

describe("PROG-1 scenario presets", () => {
  it("ships four scenarios in unlock order, each a fixed place with a fair race", () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(
      ["river-valley", "highlands", "twin-towns", "archipelago"]);
    for (const [i, s] of SCENARIOS.entries()) {
      expect(s.index).toBe(i);
      expect(Number.isInteger(s.seed)).toBe(true);
      expect(["easy", "normal", "hard"]).toContain(s.skill);
      expect(s.winTarget).toBeGreaterThanOrEqual(3);
      // the generator options are the resolved map options plus the knobs
      const gen = scenarioMapGen(s, s.mapOptions);
      expect(gen.rivers).toBe(s.mapOptions.rivers);
      expect(gen.elevation).toBe(s.mapOptions.elevation);
    }
    expect(scenarioById("highlands")?.name).toBe("Highlands");
    expect(scenarioById("nope")).toBeNull();
    expect(nextScenarioId("river-valley")).toBe("highlands");
    expect(nextScenarioId("archipelago")).toBeNull();
  });

  it("River Valley: rivers on, industries along the water", () => {
    const def = scenarioById("river-valley")!;
    expect(def.mapOptions.rivers).toBe(true);
    const g = scenarioMap("river-valley");
    expectSameMap(g, scenarioMap("river-valley"));
    // rivers run: dozens of river tiles, not a dry map that claims otherwise
    expect(countMask(g.rivers)).toBeGreaterThanOrEqual(40);
    // the full quota still places — the waterfront rule never costs a node
    expect(g.industries).toHaveLength(11);
    const near = g.industries.filter((ind) =>
      footprintNearWater(g.terrain, ind.tx, ind.ty, ind.w, ind.h)).length;
    expect(near).toBeGreaterThanOrEqual(8);
    // …and the rule is doing work: the same seed without it hugs less water
    const unruled = generateMap(def.seed, {
      rivers: true, elevation: true, shapes: true, rings: true,
    });
    const plainNear = unruled.industries.filter((ind) =>
      footprintNearWater(unruled.terrain, ind.tx, ind.ty, ind.w, ind.h)).length;
    expect(near).toBeGreaterThan(plainNear);
  }, 60000);

  it("Highlands: strong elevation, footprints still flat", () => {
    const def = scenarioById("highlands")!;
    expect(def.gen.elevationStrength).toBe("strong");
    const g = scenarioMap("highlands");
    expectSameMap(g, scenarioMap("highlands"));
    const height = g.height!;
    let high = 0, land = 0, max = 0;
    for (let i = 0; i < g.terrain.length; i++) {
      if (g.terrain[i] === WATER) continue;
      land++;
      max = Math.max(max, height[i]);
      if (height[i] >= 3) high++;
    }
    // high ground, not a hill or two: most of the land sits at 3+
    expect(max).toBe(4);
    expect(high / land).toBeGreaterThanOrEqual(0.45);
    // stronger than the same seed's normal field, by construction
    const normal = generateMap(def.seed, {
      rivers: false, elevation: true, shapes: true, rings: true,
    });
    let normalHigh = 0;
    for (let i = 0; i < normal.terrain.length; i++) {
      if (normal.terrain[i] === WATER) continue;
      if (normal.height![i] >= 3) normalHigh++;
    }
    expect(high).toBeGreaterThan(normalHigh);
    // …but every industry still stands on one level (Level Ground's promise)
    for (const ind of g.industries) {
      const levels = new Set<number>();
      for (let y = ind.ty; y < ind.ty + ind.h; y++) {
        for (let x = ind.tx; x < ind.tx + ind.w; x++) levels.add(height[idx(x, y)]);
      }
      expect(levels.size, `${ind.type} at ${ind.tx},${ind.ty}`).toBe(1);
    }
  }, 60000);

  it("Twin Towns: two towns with a contested middle", () => {
    const def = scenarioById("twin-towns")!;
    expect(def.gen.townCount).toBe(2);
    const g = scenarioMap("twin-towns");
    expectSameMap(g, scenarioMap("twin-towns"));
    expect(g.towns).toHaveLength(2);
    // far apart — room for a middle worth contesting
    const [a, b] = g.towns;
    const dist = Math.hypot(a.tx - b.tx, a.ty - b.ty);
    expect(dist).toBeGreaterThanOrEqual(40);
    // the middle is land, and something in it is worth paving to
    const mx = Math.round((a.tx + b.tx) / 2), my = Math.round((a.ty + b.ty) / 2);
    expect(g.terrain[idx(mx, my)] === WATER).toBe(false);
    const nearMid = g.industries.filter((ind) =>
      Math.hypot(ind.tx + ind.w / 2 - mx, ind.ty + ind.h / 2 - my) <= 30).length;
    expect(nearMid).toBeGreaterThanOrEqual(1);
    // two towns on every seed, not just the shipped one (fast: no elevation)
    for (const seed of [11, 777]) {
      const other = generateMap(seed, {
        rivers: true, elevation: false, shapes: true, rings: true, townCount: 2,
      });
      expect(other.towns).toHaveLength(2);
    }
  }, 60000);

  it("Archipelago: four islands, one town per shore, bridges do the rest", () => {
    const g = scenarioMap("archipelago");
    expectSameMap(g, scenarioMap("archipelago"));
    const comps = landComponentCount(g.terrain);
    expect(comps).toBeGreaterThanOrEqual(4);
    // one town per island: label the masses, read each town's label
    const seen = new Int32Array(g.terrain.length).fill(-1);
    let n = 0;
    for (let i = 0; i < g.terrain.length; i++) {
      if (seen[i] !== -1 || g.terrain[i] === WATER) continue;
      const stack = [i];
      seen[i] = n;
      while (stack.length) {
        const cur = stack.pop()!;
        const x = cur % MAP_W, y = (cur / MAP_W) | 0;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
          const ni = ny * MAP_W + nx;
          if (seen[ni] !== -1 || g.terrain[ni] === WATER) continue;
          seen[ni] = n;
          stack.push(ni);
        }
      }
      n++;
    }
    expect(g.towns).toHaveLength(4);
    expect(new Set(g.towns.map((t) => seen[idx(t.tx, t.ty)]))).toHaveLength(4);
    // the full quota still places, and no highway crosses the water for free
    expect(g.industries).toHaveLength(11);
    expect(g.publicRoads ?? []).toHaveLength(0);
    // islands on every seed, not just the shipped one (fast: no elevation)
    for (const seed of [11, 777]) {
      const other = generateMap(seed, {
        elevation: false, shapes: true, rings: true, archipelago: true,
      });
      expect(landComponentCount(other.terrain)).toBeGreaterThanOrEqual(4);
      expect(other.towns).toHaveLength(4);
      expect(other.industries).toHaveLength(11);
    }
  }, 90000);

  it("leaves the default map alone", () => {
    const g = generateMap(1337);
    expect(g.towns).toHaveLength(4);
    expect(g.industries).toHaveLength(11);
    expect(landComponentCount(g.terrain)).toBe(1);
    expect(g.rivers).toBeUndefined();
  });
});

describe("PROG-1 scenario unlocks", () => {
  it("starts fresh: River Valley open, the rest sealed with a reason", () => {
    const p = loadScenarioProgress(store());
    expect(p).toEqual(FRESH_SCENARIOS);
    expect(isScenarioUnlocked("river-valley", p)).toBe(true);
    expect(isScenarioUnlocked("highlands", p)).toBe(false);
    expect(scenarioUnlockHint("river-valley")).toBeNull();
    expect(scenarioUnlockHint("highlands")).toMatch(/river valley/i);
    expect(scenarioUnlockHint("highlands")).toMatch(/campaign contract/i);
    expect(scenarioUnlockHint("archipelago")).toMatch(/twin towns/i);
  });

  it("a win opens the next scenario and keeps the best time and margin", () => {
    const s = store();
    let p = recordScenarioResult("river-valley", 0, true,
      { timeMs: 600_000, margin: 3 }, loadScenarioProgress(s), s);
    expect(p.unlocked).toBe(2);
    expect(p.results["river-valley"]).toEqual({ wins: 1, bestTimeMs: 600_000, bestMargin: 3 });
    expect(isScenarioUnlocked("highlands", p)).toBe(true);
    // a faster, narrower win keeps the fastest time AND the widest margin
    p = recordScenarioResult("river-valley", 0, true,
      { timeMs: 500_000, margin: 1 }, p, s);
    expect(p.results["river-valley"]).toEqual({ wins: 2, bestTimeMs: 500_000, bestMargin: 3 });
    // a loss keeps nothing and opens nothing
    const before = JSON.stringify(p);
    p = recordScenarioResult("highlands", 1, false, { timeMs: 1, margin: 99 }, p, s);
    expect(JSON.stringify(p)).toBe(before);
    // and the record survives a reload
    expect(loadScenarioProgress(s).results["river-valley"]!.wins).toBe(2);
    expect(describeScenarioBest(p.results["river-valley"]!)).toBe("2 wins · best +3★ · fastest 8:20");
    expect(describeScenarioBest({ wins: 0, bestTimeMs: null, bestMargin: null })).toBeNull();
  });

  it("caps the unlock at the last scenario", () => {
    const s = store();
    const p = recordScenarioResult("archipelago", 3, true, {}, loadScenarioProgress(s), s);
    expect(p.unlocked).toBe(4);
  });

  it("reads corruption as a fresh list, not a sealed one", () => {
    const s = store({ [SCENARIO_STORAGE_KEY]: "{not json" });
    expect(loadScenarioProgress(s)).toEqual(FRESH_SCENARIOS);
    const s2 = store({
      [SCENARIO_STORAGE_KEY]: JSON.stringify({ unlocked: -2, results: { "river-valley": { wins: "many" } } }),
    });
    const p = loadScenarioProgress(s2);
    expect(p.unlocked).toBe(1);
    expect(p.results["river-valley"]).toEqual({ wins: 0, bestTimeMs: null, bestMargin: null });
  });

  it("lets each filed campaign contract open one more scenario", () => {
    const scen = loadScenarioProgress(store());
    const story = loadStoryProgress(store({
      "hexmatch:story": JSON.stringify({ unlocked: 2, results: { inheritance: "win" } }),
    }));
    expect(effectiveUnlocked(scen, null)).toBe(1);
    expect(effectiveUnlocked(scen, story)).toBe(2);
    expect(isScenarioUnlocked("highlands", scen, story)).toBe(true);
    expect(isScenarioUnlocked("twin-towns", scen, story)).toBe(false);
  });

  it("pins a scenario for playtest links without touching the record", () => {
    expect(pinnedScenario("?scenario=highlands")).toBe("highlands");
    expect(pinnedScenario("?scenario=HIGHLANDS")).toBe("highlands");
    expect(pinnedScenario("")).toBeNull();
    expect(pinnedScenario("?seed=7")).toBeNull();
    expect(formatBestTime(500_000)).toBe("8:20");
    expect(formatBestTime(3_661_000)).toBe("1:01:01");
  });
});

describe("PROG-1 campaign flow", () => {
  it("walks contracts in order and stops past the ledger", () => {
    expect(CHAPTERS.map((c) => chapterAfter(c.id)?.id ?? null)).toEqual([
      "toll-king", "black-gold", "stone-thunder", "chairmans-ledger", null,
    ]);
    expect(chapterAfter("nope")).toBeNull();
  });

  it("keeps each won contract's widest margin and fastest win", () => {
    const s = store();
    // old records carry no bests — and the fresh shape never grew one
    expect(loadStoryProgress(store())).toEqual(FRESH_PROGRESS);
    expect("bests" in FRESH_PROGRESS).toBe(false);
    let p = recordChapterResult("inheritance", 0, true, 5, loadStoryProgress(s), s,
      { margin: 2, timeMs: 900_000 });
    expect(p.results.inheritance).toBe("win");
    expect(p.bests?.inheritance).toEqual({ bestMargin: 2, bestTimeMs: 900_000 });
    // a second win keeps the widest margin and the fastest time independently
    p = recordChapterResult("inheritance", 0, true, 5, p, s, { margin: 4, timeMs: 1_200_000 });
    expect(p.bests?.inheritance).toEqual({ bestMargin: 4, bestTimeMs: 900_000 });
    // a loss keeps nothing — and a win without stats keeps what it had
    p = recordChapterResult("toll-king", 1, false, 5, p, s, { margin: 9, timeMs: 1 });
    expect(p.bests?.["toll-king"]).toBeUndefined();
    p = recordChapterResult("inheritance", 0, true, 5, p, s);
    expect(p.bests?.inheritance).toEqual({ bestMargin: 4, bestTimeMs: 900_000 });
    expect(loadStoryProgress(s).bests?.inheritance).toEqual({ bestMargin: 4, bestTimeMs: 900_000 });
  });

  it("the ending offers Next contract only when there is one to walk into", () => {
    (window as unknown as { requestAnimationFrame: typeof requestAnimationFrame }) =
      ((cb: FrameRequestCallback) => { cb(performance.now()); return 1; }) as never;
    const input: EndingInput = {
      playerWon: true, playerScore: 10, rivalScore: 7,
      playerBreakdown: { paved: 36, plants: 1, pavedVp: 9, plantVp: 1 },
      rivalBreakdown: { paved: 19, plants: 1, pavedVp: 4.75, plantVp: 1 },
      decisiveSource: "upgrade", seed: 1337, rivalName: "Rival", difficulty: "Normal",
    };
    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const onNext = vi.fn();
      const handle = showEndingScreen(host, buildEnding(input), {
        onRestart: () => {},
        onContinue: () => {},
        onNextContract: onNext,
      });
      const next = host.querySelector(".ending-next") as HTMLButtonElement | null;
      expect(next?.textContent).toMatch(/next contract/i);
      next!.click();
      expect(onNext).toHaveBeenCalledTimes(1);
      handle.destroy();
      // absent without the callback — every sandbox ledger keeps its doors
      const plain = showEndingScreen(host, buildEnding(input), { onRestart: () => {} });
      expect(host.querySelector(".ending-next")).toBeNull();
      plain.destroy();
    } finally {
      host.remove();
    }
  });
});

describe("PROG-1 scenario list", () => {
  let container: HTMLDivElement;
  let root: Root;
  let choices: StartChoice[];

  beforeEach(() => {
    localStorage.clear();
    choices = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
  });

  async function renderList(initial: "choose" | "scenarios" = "scenarios"): Promise<void> {
    await act(async () => {
      root.render(createElement(StartScreen, {
        initial,
        onStart: (c: StartChoice) => choices.push(c),
      }));
    });
  }

  const card = (name: string): HTMLButtonElement => {
    const found = container.querySelector(`[aria-label^="${name}"]`);
    if (!found || !(found instanceof HTMLButtonElement)) {
      throw new Error(`no scenario card for ${name}`);
    }
    return found;
  };

  it("lists four scenarios — one open, three locked with a reason", async () => {
    await renderList();
    expect(container.querySelectorAll(".chapter-card")).toHaveLength(4);
    expect(card("River Valley").disabled).toBe(false);
    expect(card("Highlands").disabled).toBe(true);
    expect(card("Highlands").textContent).toMatch(/river valley/i);
    expect(card("Highlands").textContent).toMatch(/campaign contract/i);
    // the open card starts its scenario
    await act(async () => { card("River Valley").click(); });
    expect(choices).toEqual([{ mode: "scenario", scenario: "river-valley", portrait: "vex" }]);
  });

  it("opens won scenarios with their best lines on the card", async () => {
    localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({
      unlocked: 2,
      results: { "river-valley": { wins: 2, bestTimeMs: 500_000, bestMargin: 3 } },
    }));
    await renderList();
    expect(card("River Valley").textContent).toMatch(/filed · won/i);
    expect(card("River Valley").textContent).toMatch(/best \+3★/);
    expect(card("River Valley").textContent).toMatch(/fastest 8:20/);
    expect(card("Highlands").disabled).toBe(false);
    expect(card("Twin Towns").disabled).toBe(true);
  });

  it("is one door past the mode pick", async () => {
    await renderList("choose");
    const door = [...container.querySelectorAll("button")]
      .find((b) => (b.textContent ?? "").trim().startsWith("Scenarios"));
    expect(door, "the mode pick stands a Scenarios door").toBeTruthy();
    await act(async () => { door!.click(); });
    expect(container.querySelectorAll(".chapter-card")).toHaveLength(4);
  });
});

describe("PROG-1 Scenarios door", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    localStorage.clear();
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    host.remove();
  });

  it("stands a Scenarios door that leaves for the scenario list", () => {
    const onScenarios = vi.fn();
    act(() => {
      root.render(createElement(MainMenu, { onPlay: () => {}, onScenarios }));
    });
    const door = [...host.querySelectorAll("button")]
      .find((b) => /^Scenarios/.test((b.textContent ?? "").trim())) as HTMLButtonElement;
    expect(door, "the Scenarios door stands").toBeTruthy();
    act(() => { door.click(); });
    expect(onScenarios).toHaveBeenCalledTimes(1);
    // and it names how many scenarios are open
    expect(host.querySelector(".menu-scenarios")!.textContent).toMatch(/1 of 4 open/i);
  });

  it("stays quiet without a handler and reports scenario bests", () => {
    localStorage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify({
      unlocked: 2,
      results: { "river-valley": { wins: 2, bestTimeMs: 500_000, bestMargin: 3 } },
    }));
    act(() => {
      root.render(createElement(MainMenu, { onPlay: () => {} }));
    });
    expect([...host.querySelectorAll("button")]
      .some((b) => /^Scenarios/.test((b.textContent ?? "").trim()))).toBe(false);
    expect(host.querySelector(".menu-scenarios")!.textContent).toMatch(/2 of 4 open/i);
    expect(host.querySelector(".menu-scenarios")!.textContent).toMatch(/best \+3/i);
  });
});
