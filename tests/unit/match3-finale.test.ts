// MATCH-2 — the finale: 5★ triggers slow-mo + push-in + music through the
// hooks; 4★ the small flourish; reduced motion keeps the music, drops the
// motion. Asserted headless (no timers, no audio) through `SessionRunner`.
import { describe, expect, it } from "vitest";
import { FINALE, FinaleController, SessionRunner, finaleTimeScale, finaleZoom, planFinale, tuningStarScores, type FinalePlan } from "../../src/match3";

const motion = { reducedMotion: false, perfMode: false };

describe("MATCH-2 — the finale plan", () => {
  it("is nothing under 4★", () => {
    expect(planFinale(0, motion)).toBeNull();
    expect(planFinale(3, motion)).toBeNull();
  });

  it("4★ is the small flourish: no slow-mo, no music", () => {
    const p = planFinale(4, motion)!;
    expect(p.stars).toBe(4);
    expect(p.slowMo).toBe(false);
    expect(p.music).toBeNull();
    expect(p.flourish).toBe("star_4");
    expect(p.pushIn).toBe(1);
  });

  it("5★ is the Peggle moment: ×0.25 easing back, push-in, music", () => {
    const p = planFinale(5, motion)!;
    expect(p.slowMo).toBe(true);
    expect(p.timeScale).toBe(FINALE.timeScale);
    expect(p.timeScale).toBeCloseTo(0.25);
    expect(p.pushIn).toBe(FINALE.pushIn);
    expect(p.music).toBe("finale");
    expect(p.flourish).toBe("star_5");
  });

  it("reduced motion: no slow-mo, no push-in — music and flourish still happen", () => {
    const p = planFinale(5, { reducedMotion: true, perfMode: false })!;
    expect(p.slowMo).toBe(false);
    expect(p.timeScale).toBe(1);
    expect(p.pushIn).toBe(1);
    expect(p.music).toBe("finale");
    expect(p.flourish).toBe("star_5");
  });

  it("performance mode drops the slow-mo polish but keeps the celebration", () => {
    const p = planFinale(5, { reducedMotion: false, perfMode: true })!;
    expect(p.slowMo).toBe(false);
    expect(p.music).toBe("finale");
    expect(p.pushIn).toBe(FINALE.pushIn);
  });
});

describe("MATCH-2 — the finale clock", () => {
  const p = planFinale(5, motion)!;

  it("holds a quarter speed, then eases back to 1 by the end", () => {
    expect(finaleTimeScale(p, 0)).toBeCloseTo(0.25);
    expect(finaleTimeScale(p, p.holdMs)).toBeCloseTo(0.25);
    const mid = finaleTimeScale(p, (p.holdMs + p.durationMs) / 2);
    expect(mid).toBeGreaterThan(0.25);
    expect(mid).toBeLessThan(1);
    // monotone on the way back
    let prev = 0;
    for (let t = p.holdMs; t <= p.durationMs; t += 50) {
      const s = finaleTimeScale(p, t);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s;
    }
    expect(finaleTimeScale(p, p.durationMs)).toBe(1);
    expect(finaleTimeScale(p, -1)).toBe(1);
    expect(finaleTimeScale(null, 100)).toBe(1);
  });

  it("pushes the camera in a few percent and settles it back", () => {
    expect(finaleZoom(p, 0)).toBeCloseTo(1);
    expect(finaleZoom(p, FINALE.pushInPeakMs)).toBeCloseTo(FINALE.pushIn);
    expect(finaleZoom(p, p.durationMs)).toBe(1);
    const rm = planFinale(5, { reducedMotion: true, perfMode: false })!;
    expect(finaleZoom(rm, FINALE.pushInPeakMs)).toBe(1);
  });

  it("the controller fires start / flourish / music / timeScale / end once each", () => {
    const calls: string[] = [];
    let clock = 1000;
    const fc = new FinaleController(
      {
        onStart: (pl) => calls.push(`start:${pl.stars}`),
        onFlourish: (c) => calls.push(`flourish:${c}`),
        onMusic: (c) => calls.push(`music:${c}`),
        onTimeScale: (s) => calls.push(`ts:${s.toFixed(2)}`),
        onEnd: (pl) => calls.push(`end:${pl.stars}`),
      },
      () => clock,
    );
    expect(fc.trigger(3, motion)).toBeNull();
    const plan = fc.trigger(5, motion)!;
    expect(plan.stars).toBe(5);
    expect(fc.trigger(5, motion)).toBeNull(); // once
    expect(fc.trigger(4, motion)).toBeNull(); // never downgrades
    expect(fc.timeScale()).toBeCloseTo(0.25);
    clock += 1500;
    fc.tick();
    expect(fc.active).toBe(true);
    clock += 2000;
    fc.tick();
    expect(fc.active).toBe(false);
    expect(fc.timeScale()).toBe(1);
    expect(calls[0]).toBe("start:5");
    expect(calls).toContain("flourish:star_5");
    expect(calls).toContain("music:finale");
    expect(calls).toContain("ts:0.25");
    expect(calls[calls.length - 1]).toBe("end:5");
  });

  it("a 4★ finale is upgraded by a 5★ one", () => {
    const starts: number[] = [];
    const fc = new FinaleController({ onStart: (pl) => starts.push(pl.stars) }, () => 0);
    fc.trigger(4, motion);
    fc.trigger(5, motion);
    expect(starts).toEqual([4, 5]);
  });
});

describe("MATCH-2 — the finale through the session hooks (headless)", () => {
  /** Play seeds with the competent bot until one crosses the 5★ bar. */
  async function findFiveStar(prefs = motion, maxSeeds = 4000): Promise<{ runner: SessionRunner; log: string[]; plans: FinalePlan[]; scales: number[] } | null> {
    const { chooseBotMove } = await import("../../src/match3");
    for (let seed = 1; seed < maxSeeds; seed++) {
      const log: string[] = [];
      const plans: FinalePlan[] = [];
      const scales: number[] = [];
      let clock = 0;
      const runner = new SessionRunner({
        seed,
        headless: true,
        prefs,
        now: () => clock,
        hooks: {
          onFinaleStart: (p) => {
            plans.push(p);
            log.push(`start:${p.stars}`);
          },
          onFinaleEnd: (p) => log.push(`end:${p.stars}`),
          onMusic: (c) => log.push(`music:${c}`),
          onFlourish: (c) => log.push(`flourish:${c}`),
          onTimeScale: (s) => scales.push(s),
          onSessionEnd: () => log.push("session-end"),
        },
      });
      while (!runner.over) {
        const mv = chooseBotMove(runner.board.engine, "competent", () => 0.5);
        if (!mv) break;
        clock += 10;
        const out = await runner.trySwap(mv[0], mv[1], mv[2], mv[3]);
        if (out === "refused") break;
      }
      if (runner.stars === 5) {
        // the finale's own clock must run out before the card can show
        clock += 5000;
        runner.tick(clock);
        return { runner, log, plans, scales };
      }
    }
    return null;
  }

  it("5★ triggers the finale, the music and the flourish, and the results wait for it", async () => {
    const hit = await findFiveStar();
    expect(hit, "no 5★ session found in the seed range — the bar may have moved").not.toBeNull();
    const { runner, log, plans, scales } = hit!;
    expect(runner.session.score).toBeGreaterThanOrEqual(tuningStarScores()[4]);
    expect(plans.map((p) => p.stars)).toContain(5);
    expect(log).toContain("music:finale");
    expect(log).toContain("flourish:star_5");
    expect(log.indexOf("start:5")).toBeLessThan(log.indexOf("session-end"));
    expect(log.indexOf("end:5")).toBeLessThan(log.indexOf("session-end"));
    expect(Math.min(...scales)).toBeCloseTo(0.25);
    expect(scales[scales.length - 1]).toBe(1);
    expect(runner.finalePlan?.slowMo).toBe(true);
  }, 60000);

  it("reduced motion: the same session plays no slow-mo but still gets the music", async () => {
    const hit = await findFiveStar({ reducedMotion: true, perfMode: false });
    expect(hit).not.toBeNull();
    const { log, plans, scales } = hit!;
    expect(plans.find((p) => p.stars === 5)?.slowMo).toBe(false);
    expect(log).toContain("music:finale");
    expect(log).toContain("flourish:star_5");
    expect(scales.every((s) => s === 1)).toBe(true);
  }, 60000);
});
