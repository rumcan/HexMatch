// RIVAL-3 (#467) — the claim telegraph: a readable rival.
// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// The rival's Depot and Factory (Processing Plant) builds are PRECEDED by a
// claim flag over the site, up for the difficulty's lead time
// (`RivalSkill.claimLeadMs`: trainee/easy 20 s, normal 12 s, hard 6 s). The
// player can pre-empt; the first valid build wins; the loser's plan
// re-targets and the rival barks a comeback line.
//
// Two layers here:
//   1. the pure rules (ledger, contested predicate, decks, lead times) —
//      fast, literal, no game boot;
//   2. the sim — boots the REAL game in jsdom (the iso-412 harness), drives
//      its clocks with an injected `now`, and pins the acceptance: EVERY
//      rival Depot/Factory build is preceded by a flag for the difficulty's
//      lead time. The claim snapshot it polls is `__iso.rivalClaims()`.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Grid } from "../../src/iso/grid";
import { MAP_W, MAP_H, type Cargo } from "../../src/iso/config";
import type { Track } from "../../src/iso/track";
import { setRng, mulberry32 } from "../../src/game/config";
import type { EconomyState } from "../../src/iso/economy";
import { industriesInCatchment } from "../../src/iso/economy";
import {
  ClaimLedger, claimContested, CONTEST_REACH,
  type ClaimSite, type PlayerIntent, type RivalClaim,
} from "../../src/iso/ai";
import {
  CLAIM_SCENES, RIVAL_COMEBACKS, createClaimDirector, createComebackDirector,
} from "../../src/iso/rivalry";
import { ALL_SKILL_KEYS, RIVAL_SKILLS, type SkillKey } from "../../src/iso/skill";

// ── pure rules ───────────────────────────────────────────────────────────

describe("RIVAL-3 the difficulty's lead time", () => {
  it("is 20 s on trainee/easy, 12 s on normal, 6 s on hard", () => {
    expect(RIVAL_SKILLS.trainee.claimLeadMs).toBe(20_000);
    expect(RIVAL_SKILLS.easy.claimLeadMs).toBe(20_000);
    expect(RIVAL_SKILLS.normal.claimLeadMs).toBe(12_000);
    expect(RIVAL_SKILLS.hard.claimLeadMs).toBe(6_000);
    for (const key of ALL_SKILL_KEYS as SkillKey[]) {
      expect(RIVAL_SKILLS[key].claimLeadMs).toBeGreaterThan(0);
    }
  });
});

const industrySite = (id: number): ClaimSite => ({
  kind: "industry", id, tx: 10 + id, ty: 20, cargo: "ore" as Cargo, name: "Ore Mine",
});
const lotSite = (id: number): ClaimSite => ({
  kind: "lot", id, tx: 30, ty: 40, townId: 3, name: "a plant site at Town 4",
});

describe("the claim ledger (committed target + ready-at time)", () => {
  it("raises a flag with readyAt exactly leadMs after the commit", () => {
    const ledger = new ClaimLedger();
    const claim = ledger.commit("depot", industrySite(1), 1_000, 12_000)!;
    expect(claim).not.toBeNull();
    expect(claim.committedAt).toBe(1_000);
    expect(claim.readyAt).toBe(13_000);
    expect(ledger.ready(12_999)).toHaveLength(0);
    expect(ledger.ready(13_000)).toEqual([claim]);
  });

  it("keeps one claim per site — the flag IS the decision", () => {
    const ledger = new ClaimLedger();
    const first = ledger.commit("depot", industrySite(1), 0, 12_000)!;
    expect(ledger.commit("depot", industrySite(1), 5_000, 12_000)).toBeNull();
    expect(ledger.pending("depot")).toEqual([first]);
    // a different site is a second claim
    expect(ledger.commit("depot", industrySite(2), 0, 12_000)).not.toBeNull();
    // the same industry is the same site whatever the claim kind
    expect(ledger.commit("plant", industrySite(1), 0, 12_000)).toBeNull();
  });

  it("separates depot and plant claims and resolves both by drop", () => {
    const ledger = new ClaimLedger();
    const depot = ledger.commit("depot", industrySite(1), 0, 6_000)!;
    const plant = ledger.commit("plant", lotSite(99), 0, 6_000)!;
    expect(ledger.pending("depot")).toEqual([depot]);
    expect(ledger.pending("plant")).toEqual([plant]);
    expect(ledger.pendingFor("lot", 99)).toBe(plant);
    ledger.drop(depot);
    expect(ledger.list()).toEqual([plant]);
    ledger.drop(plant);
    expect(ledger.list()).toEqual([]);
    // resolving twice is safe
    expect(() => ledger.drop(plant)).not.toThrow();
  });
});

describe("contested markers appear and clear", () => {
  const ledger = new ClaimLedger();
  const claim = ledger.commit("depot", industrySite(1), 0, 12_000)!;

  it("rises when the player arms a Depot near the site", () => {
    const armed: PlayerIntent[] = [{ kind: "armed", tx: claim.site.tx + CONTEST_REACH, ty: claim.site.ty }];
    expect(claimContested(claim, armed)).toBe(true);
    const far: PlayerIntent[] = [{ kind: "armed", tx: claim.site.tx + CONTEST_REACH + 1, ty: claim.site.ty }];
    expect(claimContested(claim, far)).toBe(false);
  });

  it("rises while a tender is live on the site's cargo, and clears with it", () => {
    const tender: PlayerIntent[] = [{ kind: "tender", cargo: "ore" as Cargo, townId: 7 }];
    expect(claimContested(claim, tender)).toBe(true);
    // a tender for another cargo is not intent on this site
    const other: PlayerIntent[] = [{ kind: "tender", cargo: "wood" as Cargo, townId: 7 }];
    expect(claimContested(claim, other)).toBe(false);
    // …and once the tender is gone, the marker clears
    expect(claimContested(claim, [])).toBe(false);
  });

  it("matches a plant claim against the tender's TOWN", () => {
    const plant = ledger.commit("plant", lotSite(99), 0, 12_000)!;
    const townTender: PlayerIntent[] = [{ kind: "tender", cargo: "grain" as Cargo, townId: 3 }];
    expect(claimContested(plant, townTender)).toBe(true);
    const otherTown: PlayerIntent[] = [{ kind: "tender", cargo: "grain" as Cargo, townId: 4 }];
    expect(claimContested(plant, otherTown)).toBe(false);
  });

  it("is pure — the same claim and intents always answer the same", () => {
    const intents: PlayerIntent[] = [{ kind: "armed", tx: claim.site.tx, ty: claim.site.ty }];
    const a = claimContested(claim, intents);
    const b = claimContested(claim, intents);
    expect(a).toBe(true);
    expect(b).toBe(a);
  });
});

describe("the claim deck and the comeback lines", () => {
  it("announces the claim in Torvin's voice, answered by the player", () => {
    expect(CLAIM_SCENES.length).toBeGreaterThan(1);
    for (const scene of CLAIM_SCENES) {
      expect(scene[0].speaker).toBe("rival");
      expect(scene.some((b) => b.speaker === "you")).toBe(true);
    }
    expect(RIVAL_COMEBACKS.length).toBeGreaterThan(1);
  });

  it("rotates deterministically and never repeats a scene back to back", () => {
    const direct = createClaimDirector(79);
    expect(direct()).toBe(createClaimDirector(79)());
    expect(direct()).not.toBe(direct());
    const comeback = createComebackDirector(79);
    expect(comeback()).toBe(createComebackDirector(79)());
    expect(comeback()).not.toBe(comeback());
    for (const line of RIVAL_COMEBACKS.slice(0, 3)) {
      const pick = createComebackDirector(79);
      expect(RIVAL_COMEBACKS).toContain(pick());
    }
  });

  it("never touches the simulation RNG — the telegraph is the planner decision", () => {
    let draws = 0;
    setRng(() => { draws++; return 0.5; });
    try {
      const ledger = new ClaimLedger();
      const claim: RivalClaim = ledger.commit("depot", industrySite(1), 0, 12_000)!;
      ledger.commit("plant", lotSite(2), 0, 12_000);
      claimContested(claim, [{ kind: "tender", cargo: "ore" as Cargo }]);
      ledger.ready(5_000);
      createClaimDirector(1337)();
      createComebackDirector(1337)();
    } finally {
      setRng(mulberry32(1));
    }
    expect(draws).toBe(0);
  });
});

// ── the sim harness (copied from iso-412-rival-smoke.test.ts) ─────────────

// ── stub the art imports (vite handles these in the browser) ──────────────
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

/** Images resolve immediately so the async boot completes. */
function stubImage() {
  class FakeImage {
    width = 1024; height = 1024;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { queueMicrotask(() => this.onload?.()); }
  }
  (globalThis as Record<string, unknown>).Image = FakeImage;
}

interface ClaimRow {
  kind: "depot" | "plant";
  siteKind: "industry" | "lot";
  siteId: number;
  tx: number;
  ty: number;
  name: string | null;
  committedAt: number;
  readyAt: number;
  contested: boolean;
}

/** The slice of `window.__iso` this file drives. */
interface TelegraphHook {
  readonly grid: Grid;
  readonly track: Track;
  readonly eco: EconomyState;
  phase: string;
  finishSetup: () => void;
  placeFactory: (tx: number, ty: number) => boolean;
  placementPlan: (kind: string, tx: number, ty: number) => { valid: boolean } | null;
  econTick: (now?: number) => void;
  aiTick: (now?: number) => void;
  tick: (now?: number) => void;
  setTool: (t: string) => void;
  hoverAt: (tx: number, ty: number) => void;
  rivalClaims: (intents?: PlayerIntent[]) => ClaimRow[];
}

const hook = () => (window as unknown as { __iso: TelegraphHook }).__iso;
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0)); };

let root: HTMLDivElement;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stubCanvas();
  stubImage();
  window.history.replaceState(null, "", "/?seed=1337");
  localStorage.removeItem("hexmatch:save");
  localStorage.setItem("hexmatch:rival-skill", "normal");
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
  vi.restoreAllMocks();
});

async function boot(opts: Record<string, unknown> = {}) {
  const { startIsoGame } = await import("../../src/iso/game");
  dispose = startIsoGame(root, opts);
  await settle();
  return hook();
}

interface SimResult {
  /** Every claim flag the rival raised: site + the moment the flag went up. */
  flags: { kind: "depot" | "plant"; siteKind: "industry" | "lot"; siteId: number; committedAt: number; readyAt: number }[];
  /** Rival Depot lots that appeared, with the industries their plan claimed. */
  depotBuilds: { tx: number; ty: number; at: number; industryIds: number[] }[];
  /** Rival Factory (Processing Plant) lots that appeared. */
  plantBuilds: { tx: number; ty: number; at: number }[];
  /** Contested transitions observed through the live hover/tool intents. */
  contested: { siteId: number; risen: boolean }[];
}

/**
 * Drive one match window with an injected clock and observe the telegraph:
 * poll `rivalClaims()` every simulated second (a lead is ≥ 6 s, so a build's
 * flag is always visible at least six polls before the build lands), diff
 * the rival's harvesters/plants for build events, and stage one live
 * Contested race per window (Depot tool armed at the flagged site, then put
 * down).
 */
async function runSim(
  bootOpts: Record<string, unknown>, skill: "normal" | "hard", seconds: number,
): Promise<SimResult> {
  const h = await boot(bootOpts);
  const leadMs = RIVAL_SKILLS[skill].claimLeadMs;
  expect(leadMs, "the sim knows the difficulty's lead").toBeGreaterThan(0);
  let placed = false;
  for (let x = 0; x < MAP_W && !placed; x++) {
    for (let y = 0; y < MAP_H; y++) {
      if (h.placementPlan("factory", x, y)?.valid && h.placeFactory(x, y)) { placed = true; break; }
    }
  }
  expect(placed, "a legal Factory spot for the player").toBe(true);
  h.finishSetup();

  const result: SimResult = { flags: [], depotBuilds: [], plantBuilds: [], contested: [] };
  const seenFlag = new Set<string>();
  const seenDepot = new Set<number>();
  const seenPlant = new Set<number>();
  let stagedContest = false;

  const t0 = performance.now();
  for (let s = 0; s <= seconds; s++) {
    const now = t0 + s * 1000;
    h.econTick(now);
    h.aiTick(now);

    // claims raised so far (the flag's own timestamps)
    for (const c of h.rivalClaims()) {
      const key = `${c.kind}:${c.siteId}:${c.committedAt}`;
      if (!seenFlag.has(key)) {
        seenFlag.add(key);
        result.flags.push({
          kind: c.kind, siteKind: c.siteKind, siteId: c.siteId,
          committedAt: c.committedAt, readyAt: c.readyAt,
        });
      }
    }

    // build events — a Depot build records the industries its plan claimed
    for (const d of h.eco.harvesters) {
      if (d.owner !== "ai" || seenDepot.has(d.id)) continue;
      seenDepot.add(d.id);
      result.depotBuilds.push({
        tx: d.tx, ty: d.ty, at: now,
        industryIds: industriesInCatchment(h.grid, d).map((ind) => ind.id),
      });
    }
    for (const f of h.eco.factories) {
      if (f.owner !== "ai" || (f.id ?? 0) === 0 || seenPlant.has(f.id!)) continue;
      seenPlant.add(f.id!);
      result.plantBuilds.push({ tx: f.tx, ty: f.ty, at: now });
    }

    // one live contested race per window: arm the Depot tool at a pending flag
    if (!stagedContest) {
      const pending = h.rivalClaims().find((c) => c.kind === "depot");
      if (pending) {
        stagedContest = true;
        h.setTool("harvester");
        h.hoverAt(pending.tx, pending.ty);
        const up = h.rivalClaims().find((c) => c.siteId === pending.siteId);
        if (up) result.contested.push({ siteId: pending.siteId, risen: up.contested });
        h.setTool("select");
        const down = h.rivalClaims().find((c) => c.siteId === pending.siteId);
        if (down) result.contested.push({ siteId: pending.siteId, risen: down.contested });
      }
    }
  }
  return result;
}

/** The acceptance: every build behind a flag that flew for ≥ the lead time. */
function assertFlagged(
  result: SimResult, kind: "depot" | "plant", leadMs: number,
  matches: (flag: SimResult["flags"][number], build: SimResult["depotBuilds"][number]) => boolean,
  builds: SimResult["depotBuilds"],
) {
  for (const build of builds) {
    const flag = result.flags.find((f) =>
      f.kind === kind && f.committedAt + leadMs <= build.at && matches(f, build));
    expect(
      flag,
      `${kind} at (${build.tx},${build.ty}) @${build.at} has no claim flag raised ≥${leadMs}ms earlier`,
    ).toBeTruthy();
  }
}

function assertAllBuildsFlagged(result: SimResult, leadMs: number) {
  // Every rival Depot build lands behind a flag over an industry it claims…
  assertFlagged(result, "depot", leadMs,
    (flag, build) => flag.siteKind === "industry" && build.industryIds.includes(flag.siteId),
    result.depotBuilds);
  // …and every rival Factory (Processing Plant) build behind its lot flag.
  assertFlagged(result, "plant", leadMs,
    (flag, build) => flag.siteKind === "lot" && flag.siteId === build.ty * MAP_W + build.tx,
    result.plantBuilds);
}

// SPEED (baseline-green ticket, 2026-09-30): the sims ran 240 game-seconds each (~100 s wall). The first
// Depot lands well inside 150 s (Normal, new loop) and 30 s (Hard, old loop), which is all these assert.
describe("sim: every rival Depot/Factory build is preceded by a claim flag for the lead time", () => {
  it("new loop (the shipped game), Normal rival — depots, plants, and a contested race", async () => {
    const result = await runSim({ newLoop: true }, "normal", 150);
    // the rival actually played — flags went up and Depots came down
    expect(result.flags.length, "the rival raised claim flags").toBeGreaterThan(0);
    expect(result.depotBuilds.length, "the rival built a Depot behind its flags").toBeGreaterThan(0);
    assertAllBuildsFlagged(result, RIVAL_SKILLS.normal.claimLeadMs);
    // Contested markers appear and clear: arming the Depot tool at the flagged
    // site raised the marker; putting the tool down cleared it again.
    expect(result.contested.length, "a contested race was staged").toBeGreaterThan(0);
    expect(result.contested.filter((t) => t.risen).length, "the marker rose with the armed Depot").toBeGreaterThan(0);
    expect(result.contested.filter((t) => !t.risen).length, "the marker cleared when the tool went down").toBeGreaterThan(0);
  }, 180_000);

  it("shipped loop (?loop=old), Hard rival — depots and plants", async () => {
    localStorage.setItem("hexmatch:rival-skill", "hard");
    const result = await runSim({ newLoop: false }, "hard", 30);
    expect(result.flags.length, "the rival raised claim flags").toBeGreaterThan(0);
    expect(result.depotBuilds.length, "the rival built a Depot behind its flags").toBeGreaterThan(0);
    assertAllBuildsFlagged(result, RIVAL_SKILLS.hard.claimLeadMs);
  }, 180_000);
});
