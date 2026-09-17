// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEnding, endingPathFor, showEndingScreen,
  type EndingBreakdown, type EndingInput, type EndingRankLine,
} from "../../src/iso/ending";

const paving: EndingBreakdown = { paved: 36, plants: 1, pavedVp: 9, plantVp: 1 };
const balanced: EndingBreakdown = { paved: 32, plants: 2, pavedVp: 8, plantVp: 2 };
const plants: EndingBreakdown = { paved: 28, plants: 3, pavedVp: 7, plantVp: 3 };
const losing: EndingBreakdown = { paved: 19, plants: 1, pavedVp: 4.75, plantVp: 1 };

const input = (patch: Partial<EndingInput> = {}): EndingInput => ({
  playerWon: true,
  playerScore: 10,
  rivalScore: 7.5,
  playerBreakdown: paving,
  rivalBreakdown: losing,
  decisiveSource: "upgrade",
  seed: 1337,
  rivalName: "Rival",
  difficulty: "Hard",
  ...patch,
});

beforeEach(() => {
  document.body.innerHTML = "";
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(performance.now());
    return 1;
  }) as typeof window.requestAnimationFrame;
});

describe("cinematic ending story", () => {
  it("classifies routes using the point ledger an actual ten-star game can make", () => {
    expect(endingPathFor(paving)).toBe("paving");
    expect(endingPathFor(balanced)).toBe("balanced");
    expect(endingPathFor(plants)).toBe("plants");
  });

  it("changes the title and method with the way the winner scored", () => {
    expect(buildEnding(input({ playerBreakdown: paving })).title).toBe("The Asphalt Crown");
    expect(buildEnding(input({ playerBreakdown: balanced })).title).toBe("The Complete Empire");
    expect(buildEnding(input({ playerBreakdown: plants })).title).toBe("An Empire of Smoke");
    expect(buildEnding(input({ playerBreakdown: plants })).method).toMatch(/processing plants/i);
  });

  it("has three distinct victory and grim epilogues for every winning route", () => {
    for (const route of [paving, balanced, plants]) {
      const victories = [0, 1, 2].map((variant) => buildEnding(input({
        playerWon: true,
        playerBreakdown: route,
        variant,
      })).epilogue);
      const defeats = [0, 1, 2].map((variant) => buildEnding(input({
        playerWon: false,
        rivalBreakdown: route,
        variant,
      })).epilogue);
      expect(new Set(victories).size).toBe(3);
      expect(new Set(defeats).size).toBe(3);
      expect(new Set([...victories, ...defeats]).size).toBe(6);
    }
    expect(buildEnding(input({ seed: 99 })).epilogue).toBe(buildEnding(input({ seed: 99 })).epilogue);
    expect(buildEnding(input({ variant: 0 })).epilogue)
      .toMatch(/greatest entrepreneur America had ever seen/i);
    expect(buildEnding(input({ variant: 0 })).epilogue)
      .toMatch(/largest network in the United States/i);
  });

  it("delivers the explicit greatest-entrepreneur, family, and happy-old-age ending", () => {
    const end = buildEnding(input({ playerBreakdown: paving, variant: 0 }));
    expect(end.epilogue).toMatch(/greatest entrepreneur America had ever seen/i);
    expect(end.epilogue).toMatch(/raised seven children/i);
    expect(end.epilogue).toMatch(/died peacefully.*ninety-four/i);
  });

  it("uses a separate grim deck when the rival wins, based on the rival's route", () => {
    const end = buildEnding(input({
      playerWon: false,
      playerScore: 6.25,
      rivalScore: 10,
      playerBreakdown: losing,
      rivalBreakdown: plants,
      decisiveSource: "plant",
      variant: 0,
    }));
    expect(end.outcome).toBe("defeat");
    expect(end.path).toBe("plants");
    expect(end.title).toBe("The Furnaces Went Dark");
    expect(end.epilogue).toMatch(/auctioned|receivers|gates closed/i);
    expect(end.decisive).toMatch(/newest processing plant/i);
    expect(end.rows[0].detail).toBe("28 tiles × 0.25★");
    expect(end.rows[1].detail).toBe("3 plants × 1★");
  });

  it.skip("lets the Black Market history colour the final coda", () => {
    expect(buildEnding(input({ playerSabotage: 4 })).coda).toMatch(/Senate hearings/i);
    expect(buildEnding(input({ rivalSabotage: 4 })).coda).toMatch(/sabotage struck/i);
  });
});

describe("cinematic ending screen", () => {
  it("shows fireworks, source-by-source points, epilogue, and a review/reopen path on victory", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const restart = vi.fn();
    const view = showEndingScreen(host, buildEnding(input({ variant: 0 })), { onRestart: restart });

    expect(view.element.dataset.outcome).toBe("victory");
    expect(view.element.querySelectorAll(".ending-firework")).toHaveLength(7);
    expect(view.element.querySelector(".ending-fireworks")?.parentElement)
      .toBe(view.element.querySelector(".ending-card"));
    expect(view.element.querySelector(".ending-ashes")).toBeNull();
    expect(view.element.textContent).toContain("Where your points came from");
    expect(view.element.textContent).toContain("36 tiles × 0.25★");
    expect(view.element.textContent).toContain("The years that followed");
    expect(view.element.textContent).toContain("Your reply:");
    expect(view.element.textContent).toContain("The End");
    const finalBeats = [...view.element.querySelectorAll<HTMLElement>(".ending-final-beat")];
    expect(finalBeats.map((beat) => beat.classList.contains("player"))).toEqual([false, true]);
    expect(finalBeats[0].querySelector<HTMLElement>(".ending-final-face")!.style.backgroundImage)
      .toMatch(/tycoon_torvin/i);
    expect(finalBeats[1].querySelector<HTMLElement>(".ending-final-face")!.style.backgroundImage)
      .toMatch(/tycoon_vex/i);

    const review = view.element.querySelector(".ending-review") as HTMLButtonElement;
    const rematch = view.element.querySelector(".ending-restart") as HTMLButtonElement;
    review.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(rematch);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(review);

    review.click();
    expect(view.element.classList.contains("hidden")).toBe(true);
    expect(view.reopenButton.classList.contains("hidden")).toBe(false);
    view.reopenButton.click();
    expect(view.element.classList.contains("hidden")).toBe(false);

    (view.element.querySelector(".ending-restart") as HTMLButtonElement).click();
    expect(restart).toHaveBeenCalledOnce();
    view.destroy();
    expect(host.querySelector("#iso-ending")).toBeNull();
  });

  it("shows falling ash—not fireworks—for a loss", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const model = buildEnding(input({
      playerWon: false,
      playerScore: 7,
      rivalScore: 10,
      rivalBreakdown: balanced,
      variant: 1,
    }));
    const view = showEndingScreen(host, model, { onRestart: () => {} });
    expect(view.element.querySelector(".ending-fireworks")).toBeNull();
    expect(view.element.querySelectorAll(".ending-ash")).toHaveLength(24);
    expect(view.element.querySelector(".ending-ashes")?.parentElement)
      .toBe(view.element.querySelector(".ending-card"));
    expect(view.element.textContent).toMatch(/Hostile takeover/i);
    expect(view.element.textContent).toContain("Where Rival's winning points came from");
    expect(view.element.textContent).toContain("Rival's final ledger10★");
    view.destroy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// RANK-01 (#147) — the rating row on the ledger
//
// The issue asks for the rating change on the end-of-match screen. The row has
// three states and the difference is the whole design: an unrated match draws
// NOTHING (a solo game has no rating), a rated match whose verdict has not
// arrived draws a "filing" row (silence would read as a broken feature), and a
// filed match draws the badge, the number and the signed delta — usually
// through `setRank`, because the verdict lands a round trip after the ledger.
// ══════════════════════════════════════════════════════════════════════════
describe("RANK-01 the ending ledger's rating row", () => {
  const line = (patch: Partial<EndingRankLine> = {}): EndingRankLine => ({
    key: "silver",
    tierLabel: "Silver",
    rating: 1196,
    before: 1180,
    delta: 16,
    promoted: false,
    demoted: false,
    forfeit: false,
    provisional: false,
    opponentKnown: true,
    ...patch,
  });

  function mount(options: Parameters<typeof showEndingScreen>[2]) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = showEndingScreen(host, buildEnding(input()), options);
    return view;
  }

  it("draws NO row for an unrated match, and setRank cannot add one", () => {
    const view = mount({ onRestart: () => {} });
    expect(view.element.querySelector(".ending-rank")).toBeNull();
    // A late, unasked-for verdict must not bolt a rating onto a solo game.
    view.setRank(line());
    expect(view.element.querySelector(".ending-rank")).toBeNull();
    view.destroy();
  });

  it("opens PENDING when the room has not filed yet, and fills when it does", () => {
    const view = mount({ onRestart: () => {}, rank: null });
    const row = view.element.querySelector<HTMLElement>(".ending-rank")!;
    expect(row.dataset.state).toBe("pending");
    expect(row.textContent).toContain("Filed with the room");
    expect(row.querySelector("img")?.getAttribute("src")).toMatch(/unranked/i);

    view.setRank(line());
    const filled = view.element.querySelector<HTMLElement>(".ending-rank")!;
    expect(filled.dataset.state).toBe("up");
    expect(filled.textContent).toContain("Silver");
    expect(filled.textContent).toContain("1196");
    expect(filled.textContent).toContain("+16");
    expect(filled.querySelector(".ending-rank-badge")?.getAttribute("src")).toMatch(/silver/i);
    // Nothing special to announce: the row still says where the number came from.
    expect(filled.textContent).toContain("1180 → 1196");
    view.destroy();
  });

  it("prints a loss as a negative, with the notes a player needs", () => {
    const view = mount({
      onRestart: () => {},
      rank: line({ key: "bronze", tierLabel: "Bronze", rating: 1164, delta: -16, demoted: true, provisional: true, opponentKnown: false, forfeit: true }),
    });
    const row = view.element.querySelector<HTMLElement>(".ending-rank")!;
    expect(row.dataset.state).toBe("down");
    expect(row.dataset.demoted).toBe("1");
    expect(row.textContent).toContain("−16");
    expect(row.textContent).toContain("Relegated to Bronze");
    expect(row.textContent).toContain("Placement match.");
    expect(row.textContent).toContain("unknown");
    expect(row.textContent).toContain("forfeit");
    view.destroy();
  });

  it("marks a promotion", () => {
    const view = mount({ onRestart: () => {}, rank: line({ key: "gold", tierLabel: "Gold", rating: 1258, before: 1244, delta: 14, promoted: true }) });
    const row = view.element.querySelector<HTMLElement>(".ending-rank")!;
    expect(row.dataset.promoted).toBe("1");
    expect(row.textContent).toContain("Promoted to Gold");
    view.destroy();
  });
});
