// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createHistory, recordSample, recordEvent, recordDepotDelivery, finalizeHistory, buildSummary,
  MAX_SAMPLES, MAX_EVENTS, SAMPLE_INTERVAL_MS,
  type MatchHistory,
} from "../../src/iso/match-history";
import { buildEnding, showEndingScreen } from "../../src/iso/ending";

beforeEach(() => {
  document.body.innerHTML = "";
  (window as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(performance.now());
    return 1;
  };
});

describe("END-1 match history recorder", () => {
  it("samples every 10s and caps memory", () => {
    const h = createHistory(0);
    // Try to push 500 samples, 10s apart
    for (let i = 0; i < 500; i++) {
      recordSample(h, i * SAMPLE_INTERVAL_MS, i, i * 0.5, i * 100, i * 80);
    }
    expect(h.samples.length).toBeLessThanOrEqual(MAX_SAMPLES);
    expect(h.samples.length).toBe(MAX_SAMPLES);
    // First sample should be recent, not ancient, because we cap
    // but we keep at most MAX_SAMPLES
    expect(h.samples[0].t).toBeGreaterThan(0);
  });

  it("caps events", () => {
    const h = createHistory(0);
    for (let i = 0; i < 500; i++) {
      recordEvent(h, { kind: "sale", seat: 0, cargo: "grain", units: 1, revenue: i, t: i });
    }
    expect(h.events.length).toBeLessThanOrEqual(MAX_EVENTS);
    expect(h.events.length).toBe(MAX_EVENTS);
  });

  it("tracks depot totals for best route", () => {
    const h = createHistory(0);
    recordDepotDelivery(h, 1, 0, "ore", 10);
    recordDepotDelivery(h, 1, 0, "ore", 5);
    recordDepotDelivery(h, 2, 1, "wood", 20);
    expect(h.depotTotals.get(1)!.total).toBe(15);
    expect(h.depotTotals.get(2)!.total).toBe(20);
  });
});

describe("END-1 buildSummary pure builder", () => {
  function scriptedHistory(): MatchHistory {
    const h = createHistory(0);
    // Samples: 0 to 60s
    recordSample(h, 0, 0, 0, 1000, 1000);
    recordSample(h, 10000, 1, 0, 900, 1000);
    recordSample(h, 20000, 2, 1, 800, 900);
    recordSample(h, 30000, 3, 1, 1200, 850);
    recordSample(h, 40000, 4, 2, 1500, 900);
    recordSample(h, 50000, 5, 2, 2000, 950);
    recordSample(h, 60000, 6, 3, 2500, 1000);
    // Depot deliveries
    recordDepotDelivery(h, 10, 0, "ore", 50);
    recordDepotDelivery(h, 11, 0, "wood", 30);
    recordDepotDelivery(h, 12, 1, "grain", 60);
    // Events
    recordEvent(h, { kind: "sale", seat: 0, cargo: "grain", units: 10, revenue: 500, t: 15 });
    recordEvent(h, { kind: "sale", seat: 0, cargo: "ore", units: 5, revenue: 800, t: 35 });
    recordEvent(h, { kind: "sale", seat: 1, cargo: "wood", units: 8, revenue: 600, t: 25 });
    recordEvent(h, { kind: "battle", winner: 0, loser: 1, t: 20 });
    recordEvent(h, { kind: "battle", winner: 0, loser: 1, t: 40 });
    recordEvent(h, { kind: "battle", winner: 1, loser: 0, t: 50 });
    recordEvent(h, { kind: "offer", from: 1, to: 0, give: "wood", giveN: 2, want: "ore", wantN: 1, t: 22 });
    recordEvent(h, { kind: "offer", from: 0, to: 1, give: "grain", giveN: 3, want: "stone", wantN: 2, t: 33 });
    recordEvent(h, { kind: "quest", seat: 0, questId: "q1", t: 18 });
    recordEvent(h, { kind: "quest", seat: 0, questId: "q2", t: 45 });
    recordEvent(h, { kind: "town", seat: 0, townId: 0, level: 1, t: 10 });
    recordEvent(h, { kind: "town", seat: 1, townId: 0, level: 1, t: 12 }); // later, so first is seat 0
    recordEvent(h, { kind: "town", seat: 0, townId: 1, level: 1, t: 30 });
    recordEvent(h, { kind: "town", seat: 0, townId: 1, level: 2, t: 55 });
    finalizeHistory(h, 60000);
    return h;
  }

  it("shows correct charts data (stars and money over time)", () => {
    const h = scriptedHistory();
    const summary = buildSummary(h);
    expect(summary.samples.length).toBe(7);
    expect(summary.samples[0].pStars).toBe(0);
    expect(summary.samples[6].pStars).toBe(6);
    expect(summary.samples[0].pMoney).toBe(1000);
    expect(summary.samples[6].pMoney).toBe(2500);
    expect(summary.duration).toBe(60);
  });

  it("computes best route as highest cargo/min", () => {
    const h = scriptedHistory();
    const summary = buildSummary(h);
    // Depot 12 has 60 total, 60/min at 1 min duration, highest
    expect(summary.highlights.bestRoute).not.toBeNull();
    expect(summary.highlights.bestRoute!.depotId).toBe(12);
    expect(summary.highlights.bestRoute!.cargo).toBe("grain");
    expect(summary.highlights.bestRoute!.seat).toBe(1);
    expect(summary.highlights.bestRoute!.total).toBe(60);
    // perMin = total / minutes = 60 / 1 = 60
    expect(summary.highlights.bestRoute!.perMin).toBeCloseTo(60, 1);
  });

  it("finds biggest sale", () => {
    const h = scriptedHistory();
    const summary = buildSummary(h);
    expect(summary.highlights.biggestSale).not.toBeNull();
    expect(summary.highlights.biggestSale!.revenue).toBe(800);
    expect(summary.highlights.biggestSale!.cargo).toBe("ore");
  });

  it("counts battles won", () => {
    const h = scriptedHistory();
    const summary = buildSummary(h);
    expect(summary.highlights.battles.pWins).toBe(2);
    expect(summary.highlights.battles.rWins).toBe(1);
    expect(summary.highlights.battles.total).toBe(3);
  });

  it("counts contracts and tenders taken", () => {
    const h = scriptedHistory();
    const summary = buildSummary(h);
    expect(summary.highlights.offers.pTaken).toBe(1);
    expect(summary.highlights.offers.rTaken).toBe(1);
    expect(summary.highlights.quests.pDone).toBe(2);
    expect(summary.highlights.quests.total).toBe(2);
  });

  it("finds first to each town tier", () => {
    const h = scriptedHistory();
    const summary = buildSummary(h);
    expect(summary.highlights.townFirsts.length).toBe(3);
    // Town 0 Lv1 first is seat 0 at t=10
    const t0 = summary.highlights.townFirsts.find((f) => f.townId === 0 && f.level === 1)!;
    expect(t0.firstSeat).toBe(0);
    expect(t0.firstT).toBe(10);
    // Town 1 Lv1
    const t1 = summary.highlights.townFirsts.find((f) => f.townId === 1 && f.level === 1)!;
    expect(t1.firstSeat).toBe(0);
    // Town 1 Lv2
    const t2 = summary.highlights.townFirsts.find((f) => f.townId === 1 && f.level === 2)!;
    expect(t2.level).toBe(2);
  });
});

describe("END-1 ending screen with summary", () => {
  it("renders charts and highlights when summary is present", () => {
    const h = createHistory(0);
    recordSample(h, 0, 0, 0, 1000, 1000);
    recordSample(h, 10000, 1, 0, 900, 1000);
    recordSample(h, 20000, 2, 1, 800, 900);
    recordDepotDelivery(h, 5, 0, "ore", 42);
    recordEvent(h, { kind: "sale", seat: 0, cargo: "grain", units: 10, revenue: 500, t: 15 });
    recordEvent(h, { kind: "battle", winner: 0, loser: 1, t: 20 });
    recordEvent(h, { kind: "town", seat: 0, townId: 0, level: 1, t: 10 });
    finalizeHistory(h, 20000);
    const summary = buildSummary(h);

    const host = document.createElement("div");
    document.body.appendChild(host);
    const model = buildEnding({
      playerWon: true,
      playerScore: 10,
      rivalScore: 7,
      playerBreakdown: { paved: 20, plants: 1, pavedVp: 5, plantVp: 1, types: 3, typeVp: 3, routes: 1, routeVp: 1, city: 1, cityVp: 1 },
      rivalBreakdown: { paved: 10, plants: 0, pavedVp: 2.5, plantVp: 0 },
      seed: 123,
    });

    const onRematch = vi.fn();
    const onSameMap = vi.fn();
    const onNext = vi.fn();
    const onMain = vi.fn();

    const view = showEndingScreen(host, model, {
      onRestart: () => {},
      summary,
      onRematch,
      onSameMap,
      onNextContract: onNext,
      onMainMenu: onMain,
    });

    // Charts exist
    expect(view.element.querySelectorAll(".ending-chart").length).toBe(2);
    expect(view.element.textContent).toContain("Match summary");
    expect(view.element.textContent).toContain("Best route");
    expect(view.element.textContent).toContain("Biggest sale");
    expect(view.element.textContent).toContain("Battles won");
    expect(view.element.textContent).toContain("Contracts & tenders");
    expect(view.element.textContent).toContain("First to each town tier");

    // Buttons exist
    expect(view.element.querySelector(".ending-rematch")).not.toBeNull();
    expect(view.element.querySelector(".ending-same-map")).not.toBeNull();
    expect(view.element.querySelector(".ending-next-contract")).not.toBeNull();
    expect(view.element.querySelector(".ending-main-menu")).not.toBeNull();

    // Clicking them calls the callbacks
    (view.element.querySelector(".ending-rematch") as HTMLButtonElement).click();
    expect(onRematch).toHaveBeenCalledOnce();
    (view.element.querySelector(".ending-same-map") as HTMLButtonElement).click();
    expect(onSameMap).toHaveBeenCalledOnce();
    (view.element.querySelector(".ending-next-contract") as HTMLButtonElement).click();
    expect(onNext).toHaveBeenCalledOnce();
    (view.element.querySelector(".ending-main-menu") as HTMLButtonElement).click();
    expect(onMain).toHaveBeenCalledOnce();

    view.destroy();
  });

  it("keeps rating row when summary is present (RANK-01 stays)", () => {
    const h = createHistory(0);
    recordSample(h, 0, 0, 0, 1000, 1000);
    recordSample(h, 10000, 1, 0, 900, 1000);
    finalizeHistory(h, 10000);
    const summary = buildSummary(h);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const model = buildEnding({
      playerWon: true,
      playerScore: 10,
      rivalScore: 7,
      playerBreakdown: { paved: 20, plants: 1, pavedVp: 5, plantVp: 1 },
      rivalBreakdown: { paved: 10, plants: 0, pavedVp: 2.5, plantVp: 0 },
      seed: 1,
    });
    const view = showEndingScreen(host, model, {
      onRestart: () => {},
      summary,
      rank: {
        key: "silver",
        tierLabel: "Silver",
        rating: 1200,
        before: 1180,
        delta: 20,
        promoted: false,
        demoted: false,
        forfeit: false,
        provisional: false,
        opponentKnown: true,
      },
    });
    expect(view.element.querySelector(".ending-rank")).not.toBeNull();
    expect(view.element.querySelector("#iso-ending-summary")).not.toBeNull();
    view.destroy();
  });
});
