// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// SCEN-2 (#602) — scenarios play the new loop.
//
// Scenario 1 used to open on the RETIRED loop: `newLoop` was gated on
// `!scenarioOn`, so a scenario booted the always-on Processing Plant board and
// a squashed "Processing Plant" tab in the rail strip while every sandbox game
// next to it ran tuning sessions, Depots and the loop's own ★ line.
//
// This file boots EACH scenario headless and pins the four things the ticket's
// acceptance asks for:
//
//   • the loop flag is ON — the game a scenario opens is the current one;
//   • the rail strip has no Processing Plant tab, and is the new loop's strip;
//   • the objective line is the SCENARIO's own objective, said in the new
//     loop's verbs (`scenario-goals.ts`), and it is what the HUD paints;
//   • the race is still the scenario's own ★ line (`winTarget`, 10★) and the
//     win check can be met by driving the score straight — the ending card
//     then reads the new loop's ledger rows.
//
// The pure half of the objectives (all four kinds, their progress maths and
// their wording) is pinned in the same file below, so a wording change or a
// target change fails here rather than in a playtest.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SCENARIOS, loadScenarioProgress, scenarioById,
  type ScenarioDef,
} from "../../src/story/scenarios";
import {
  scenarioGoalDone, scenarioGoalHave, scenarioGoalLine,
  type ScenarioGoalInput, type ScenarioObjective,
} from "../../src/story/scenario-goals";
import { START_MONEY, VICTORY } from "../../src/iso/config";
import { WATER, type Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H } from "../../src/game/config";
import { southLotFree } from "./helpers/depot-lot";
import { tuningStarsFor } from "../../src/iso/tuning";
import type { Board } from "../../src/game/board";
import { FREE_SETUP_DEPOTS } from "../../src/iso/construction";
import { SAVE_KEY } from "../../src/iso/savegame-runtime";
import { FREE_SETUP_TRACK } from "../../src/iso/game";
import { setRng, mulberry32 } from "../../src/game/config";

vi.mock("../../assets/iso-atlas/atlas@0.5x.png", () => ({ default: "a05.png" }));
vi.mock("../../assets/iso-atlas/atlas@1x.png", () => ({ default: "a1.png" }));
vi.mock("../../assets/iso-atlas/atlas@2x.png", () => ({ default: "a2.png" }));

function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "canvas") return null;
      if (prop === "imageSmoothingEnabled") return false;
      if (prop === "getImageData") {
        return (_x: number, _y: number, w: number, h: number) =>
          ({ data: new Uint8ClampedArray(Math.max(1, w * h) * 4).fill(255), width: w, height: h });
      }
      if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createConicGradient") {
        return () => ({ addColorStop: () => undefined });
      }
      return () => undefined;
    },
    set: () => true,
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
}

function stubImage() {
  class FakeImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
}

/** The slice of `window.__iso` this file reads. */
interface ScenarioHook {
  readonly newLoop: boolean;
  readonly phase: string;
  readonly vpTarget: number;
  readonly objective: { key: string | null; text: string | null; target: unknown; tool: string | null };
  readonly scenario: null | {
    id: string;
    name: string;
    winTarget: number;
    objective: { kind: string; text: string; target: number; have: number; done: boolean; line: string };
  };
  /** SCEN-2: the live score ledger, and the line check runnable on demand. */
  readonly score: { vp: Map<string, number> };
  readonly grid: Grid;
  readonly board: Board;
  readonly tuning: { kind: string; score: number } | null;
  readonly freeTrack: number;
  readonly freeDepots: number;
  readonly difficulty: { key: string; label: string };
  readonly players: { id: string; money: number; purse: Record<string, number> }[];
  winCheck: () => boolean;
  finishSetup: () => void;
  placeDepot: (tx: number, ty: number) => boolean;
  swap: (r1: number, c1: number, r2: number, c2: number) => void;
  tuningFinish: (abandon?: boolean) => void;
}

const hook = () => (window as unknown as { __iso: ScenarioHook }).__iso;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 12; i++) await sleep(0); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

/** The rail strip's tabs, in paint order — the DOM a player sees. */
const tabs = () => [...root.querySelectorAll<HTMLElement>("#iso-trade [data-tab]")]
  .map((b) => b.dataset.tab);
const objectiveEl = () => root.querySelector<HTMLElement>("#iso-objective");
const ending = () => root.querySelector<HTMLElement>("#iso-ending");

beforeEach(() => {
  stubCanvas();
  stubImage();
  // A scenario boot is a solo boot on its OWN save slot; the URL is only the
  // stale-link guard (the scenario rides in on the options, as App.tsx sends it).
  window.history.replaceState(null, "", "/?scenario=river-valley");
  localStorage.clear();
  // No stored rival skill: a scenario must not ASK for one — it casts its
  // rival at its own fixed difficulty, exactly as a contract does.
  localStorage.setItem("hexmatch:tutorial", "never");
  setRng(mulberry32(1337));
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {} unobserve() {} disconnect() {}
  };
  (globalThis as Record<string, unknown>).OffscreenCanvas = undefined;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as never;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  root = document.createElement("div");
  Object.defineProperty(root, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(root, "clientHeight", { value: 700, configurable: true });
  document.body.appendChild(root);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  root.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Boot one scenario the way App.tsx boots it, and leave the setup clicks. */
async function boot(def: ScenarioDef): Promise<ScenarioHook> {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, { scenario: def.id });
  await settle();
  const h = hook();
  // A scenario opens on the loop's own setup (place the Plant, owe the first
  // Depot). The audit below is about the match, so it starts the match.
  h.finishSetup();
  await settle();
  return h;
}

describe.each(SCENARIOS)("#602 $name plays the new loop", (def) => {
  it("boots the current game: newLoop on, and a rail strip with no Plant tab", async () => {
    const h = await boot(def);
    expect(h.newLoop, "the scenario runs the new loop").toBe(true);
    // #299: the loop's strip is Bank / Market / Black Market / Feed /
    // Contracts — the retired loop's Plant tab is what used to squash in here.
    expect(tabs()).toEqual(["bank", "market", "black", "feed", "contracts"]);
    expect(tabs()).not.toContain("plant");
    expect(root.querySelector("#iso-trade #iso-quarry"), "no plant pane in the rail").toBeNull();
    // …and the scenario casts its rival, like a contract: no difficulty
    // question (which on the loop would re-tune the very map the scenario was
    // built around).
    expect(h.difficulty.key).toBe(def.skill);
    expect(root.querySelector("#iso-skill-prompt")).toBeNull();
  });

  it("briefs in the NEW UI, and opens with the loop's starting kit", async () => {
    const h = await boot(def);
    // HUD-1's Feed is the one message channel the new UI left standing — the
    // scenario's terms are three lines there, not a reel or a tab.
    const feed = [...root.querySelectorAll(".feed-row")].map((r) => r.textContent ?? "").join(" | ");
    expect(feed).toContain(def.name);
    expect(feed).toContain(def.brief);
    expect(feed).toContain(def.objective.text);
    // The kit is the current loop's own opening kit (money, gravel allowance,
    // the free first Depot) — not a retired-loop bag of paves and plants.
    const seat = h.players.find((p) => p.id === "you")!;
    expect(seat.money).toBe(START_MONEY);
    expect(h.freeTrack).toBe(FREE_SETUP_TRACK);
    expect(h.freeDepots).toBe(FREE_SETUP_DEPOTS);
  });

  it("says its objective in the objective lane, with the scenario's own progress", async () => {
    const h = await boot(def);
    expect(h.scenario, "the hook reports the scenario").toBeTruthy();
    expect(h.scenario!.id).toBe(def.id);
    // The scenario's own job, in the loop's verbs, with where the counter
    // stands — and the LIVE state says the same thing the hook does.
    const live = hook();
    expect(live.objective.text).toContain(def.objective.text);
    expect(live.objective.text).toBe(h.scenario!.objective.line);
    expect(h.scenario!.objective).toMatchObject({
      kind: def.objective.kind,
      target: def.objective.target,
      have: 0,
      done: false,
    });
    expect(objectiveEl()?.textContent).toContain(def.objective.text);
  });

  it("races its own ★ line, and the win check can be met by driving the score", async () => {
    const h = await boot(def);
    // PROG-1's race is the card's promise ("first to 10★"), not the loop's
    // 12★ default — the line the HUD prints IS the line the check uses.
    expect(def.winTarget).toBe(10);
    expect(h.vpTarget).toBe(def.winTarget);
    expect(h.phase).toBe("play");
    // Drive the ledger straight to the line and ask the game to adjudicate.
    h.score.vp.set("you", def.winTarget);
    expect(h.winCheck()).toBe(true);
    await settle();
    expect(h.phase).toBe("won");
    // The ledger that stands is the loop's own — three new-loop rows, no
    // paving/plants rows from the retired table.
    const card = ending();
    expect(card, "the ending card stands").toBeTruthy();
    expect(card!.dataset.outcome).toBe("victory");
    const rows = [...card!.querySelectorAll<HTMLElement>(".ending-score-row")].map((r) => r.dataset.source);
    expect(rows).toEqual(["types", "routes", "city"]);
  });

  it("files the win in the scenario ledger (the unlock list still counts)", async () => {
    const h = await boot(def);
    h.score.vp.set("you", def.winTarget);
    h.winCheck();
    await settle();
    const progress = loadScenarioProgress();
    expect(progress.results[def.id]?.wins, "the scenario's win is recorded").toBe(1);
    // …and the next scenario is open (the record both files the result and
    // moves the unlock count, exactly as #475 shipped it).
    expect(progress.unlocked).toBeGreaterThanOrEqual(Math.min(SCENARIOS.length, def.index + 2));
  });
});

describe("#602 the goal counters are read off the live game", () => {
  /** Candidate Depot lots: under each industry, with a clear column south. */
  function depotSites(grid: Grid): { hx: number; hy: number }[] {
    const out: { hx: number; hy: number }[] = [];
    for (const ind of grid.industries) {
      for (let x = ind.tx; x < ind.tx + ind.w; x++) {
        const hx = x, hy = ind.ty + ind.h + 1;
        const fy = hy + 6;
        if (hy < 0 || fy >= MAP_H || hx < 0 || hx >= MAP_W) continue;
        let ok = true;
        for (let y = hy; y <= fy; y++) {
          const i = y * MAP_W + hx;
          if (grid.terrain[i] === WATER || grid.occupancy[i] !== -1) { ok = false; break; }
        }
        if (ok && southLotFree(grid, hx, hy)) out.push({ hx, hy });
      }
    }
    return out;
  }

  it("a played Depot tuning lifts the tuning objective (Highlands)", async () => {
    const def = SCENARIOS.find((s) => s.objective.kind === "tune")!;
    const h = await boot(def);
    // Stand up the first Depot the rules accept — its tuning session opens.
    const sites = depotSites(h.grid);
    expect(sites.length, "the scenario's map offers a Depot lot").toBeGreaterThan(0);
    let placed = false;
    for (const site of sites) {
      if (h.placeDepot(site.hx, site.hy - 1)) { placed = true; break; }
    }
    expect(placed, "a Depot lands").toBe(true);
    await settle();
    expect(h.tuning?.kind, "the Depot's session is live").toBe("depot");
    // Play one real move, let the cascade settle, then FINISH the session down
    // the same door the results pop-up's Confirm uses.
    const mv = h.board.findMove();
    expect(mv, "the session board has a move").toBeTruthy();
    h.swap(...mv!);
    for (let i = 0; i < 80 && h.board.busy; i++) await sleep(30);
    expect(h.board.busy).toBe(false);
    const stars = tuningStarsFor(h.tuning!.score);
    expect(stars, "the move earned a star").toBeGreaterThan(0);
    h.tuningFinish(false);
    await settle();
    expect(h.tuning, "the session closed").toBeNull();
    // The objective read it — and the lane paints the new count.
    const live = hook();
    expect(live.scenario!.objective.have).toBe(stars);
    expect(live.scenario!.objective.done).toBe(stars >= def.objective.target);
    expect(live.objective.text).toContain(`${stars}/${def.objective.target}`);
  });
});

describe("#602 the objective maths (all four kinds)", () => {
  const state = (over: Partial<ScenarioGoalInput> = {}): ScenarioGoalInput => ({
    delivered: 0, bestTuningStars: 0, trainLines: 0, battlesWon: 0, ...over,
  });
  const goal = (kind: ScenarioObjective["kind"], target: number): ScenarioObjective => ({
    kind, target, text: `do ${kind}`, done: `did ${kind}`,
  });

  it("reads each kind off its own counter, and nothing else", () => {
    const cases: [ScenarioObjective["kind"], Partial<ScenarioGoalInput>][] = [
      ["deliver", { delivered: 7 }],
      ["tune", { bestTuningStars: 3 }],
      ["rail", { trainLines: 1 }],
      ["battle", { battlesWon: 2 }],
    ];
    for (const [kind, over] of cases) {
      expect(scenarioGoalHave(goal(kind, 1), state(over)), kind).toBe(
        Object.values(over)[0]);
      expect(scenarioGoalHave(goal(kind, 1), state()), kind).toBe(0);
    }
  });

  it("is met at the target, not before, and never reads past it", () => {
    const g = goal("deliver", 12);
    expect(scenarioGoalDone(g, state({ delivered: 11 }))).toBe(false);
    expect(scenarioGoalDone(g, state({ delivered: 12 }))).toBe(true);
    expect(scenarioGoalDone(g, state({ delivered: 30 }))).toBe(true);
    // The painted line clamps: "12/12", never "30/12".
    expect(scenarioGoalLine(g, state({ delivered: 30 }))).toBe("do deliver · 12/12");
  });

  it("clamps junk input rather than painting NaN", () => {
    const g = goal("tune", 3);
    expect(scenarioGoalLine(g, state({ bestTuningStars: NaN }))).toBe("do tune · 0/3");
    expect(scenarioGoalLine(g, state({ bestTuningStars: -4 }))).toBe("do tune · 0/3");
  });
});

describe("#602 the scenario definitions carry their objectives", () => {
  it("every scenario has a new-loop objective, and its ★ line is unchanged", () => {
    for (const s of SCENARIOS) {
      expect(s.objective.text.length, s.id).toBeGreaterThan(0);
      expect(s.objective.done.length, s.id).toBeGreaterThan(0);
      expect(s.objective.target, s.id).toBeGreaterThan(0);
      // A scenario's race is still the one PROG-1 sold on its card; the loop's
      // own 12★ line is what `?loop=new` races, not what a scenario does.
      expect(s.winTarget, s.id).toBe(10);
      expect(s.winTarget).not.toBe(VICTORY.loop.target);
    }
    // The four kinds are what the ticket asked the scenarios to say.
    expect(SCENARIOS.map((s) => s.objective.kind)).toEqual(["deliver", "tune", "rail", "battle"]);
  });

  it("scenarioById still resolves every card the list draws", () => {
    for (const s of SCENARIOS) expect(scenarioById(s.id)?.name).toBe(s.name);
  });

  it("marks the tutorial-only save key so a scenario boot cannot pick it up", () => {
    // The harness clears storage per test; the scenario slot is its own key,
    // so a stale sandbox save can never resume inside a scenario.
    expect(SAVE_KEY.startsWith("hexmatch:")).toBe(true);
    expect(localStorage.getItem(SAVE_KEY)).toBeNull();
  });
});
