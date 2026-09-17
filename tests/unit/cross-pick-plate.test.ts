// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// #185 — the Holy / Broken Cross blessing popup must read as the same game.
//
// The restyle promise is specific: the shared `.panel` plate over a light
// board dim, the ledger kicker + engraved display title with no emoji, the
// purse-chip cargo tiles, and the dialog `.big-btn` as the confirm — the
// blue-slate gradient and the candy buttons are gone. The behaviour (queue,
// spend/take-back, outside clicks cannot dismiss) is pinned by
// cross-choice.test.ts; THIS file pins the plate: what `crossPick()` builds,
// and what `styles.css` says about it.
// ══════════════════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Board } from "../../src/game/board";
import { createOriginalUi } from "../../src/game/ui";
import { emptyBag } from "../../src/iso/bank";
import { mulberry32, setRng } from "../../src/game/config";

const css = readFileSync("src/game/styles.css", "utf8");

// 🙏 / ✝ and friends — the pictographs the popup used to wear as chrome.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}]/u;

function uiWithPick(kind: "holy" | "broken", picks: number) {
  setRng(mulberry32(1234));
  const board = new Board();
  const seat = { id: "you", name: "You", res: emptyBag(), unlocked: null };
  const ui = createOriginalUi(board, seat, {
    onTool: vi.fn(), onRecenter: vi.fn(), onSwap: vi.fn(), onReset: vi.fn(),
    onBank: vi.fn(() => "done" as const), onBlackAction: vi.fn(),
  });
  document.body.append(ui.el);
  ui.crossPick(kind, picks, vi.fn());
  return ui;
}
afterEach(() => document.body.replaceChildren());

describe("#185 the chooser is a house plate, not a guest app", () => {
  it.each(["holy", "broken"] as const)("the %s panel reuses the shared .panel treatment over a board dim", (kind) => {
    const ui = uiWithPick(kind, kind === "holy" ? 6 : 3);
    const back = ui.el.querySelector(".cross-pick-back")!;
    const panel = ui.el.querySelector(".cross-pick")!;
    expect(panel.classList.contains("panel"), "the plate rides the shared .panel treatment").toBe(true);
    expect(back.contains(panel)).toBe(true);
    // and the dim cannot answer for the player: no handler, clicks pass nowhere
    const before = ui.el.querySelectorAll(".cross-pick").length;
    back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ui.el.querySelectorAll(".cross-pick").length, "a click on the dim dismisses nothing").toBe(before);
  });

  it("titles the plate in the display face with a kicker — and no emoji", () => {
    const ui = uiWithPick("holy", 6);
    const panel = ui.el.querySelector(".cross-pick")!;
    expect(panel.querySelector(".cross-pick-kicker")!.textContent).toBe("Blessing");
    expect(panel.querySelector(".cross-pick-title")!.textContent).toBe("Holy Cross");
    expect(panel.querySelector(".cross-pick-title svg.hud-ic"), "the house stroke cross seals the title").toBeTruthy();
    expect(panel.innerHTML, "no OS emoji survives in the popup's markup").not.toMatch(EMOJI);
  });

  it("makes the confirm the dialog's primary button, labelled plain Bless +N", () => {
    const ui = uiWithPick("broken", 3);
    const confirm = ui.el.querySelector<HTMLButtonElement>(".cross-pick-confirm")!;
    expect(confirm.classList.contains("big-btn"), "the confirm is the dialog primary button").toBe(true);
    expect(confirm.textContent).toBe("Bless +3");
    expect(confirm.disabled, "confirm stays dark until every bounty is spent").toBe(true);
  });

  it("keeps the cargo tiles as tap-sized tokens with the SFX hooks", () => {
    const ui = uiWithPick("holy", 6);
    const tiles = [...ui.el.querySelectorAll<HTMLButtonElement>(".cross-pick-btn")];
    expect(tiles).toHaveLength(5);
    for (const t of tiles) {
      expect(t.querySelector("img.cargo-ic"), "tile shows the painted cargo token").toBeTruthy();
      expect(t.dataset.sfx, "the `pick` hook belongs to the touch").toBe("pick");
    }
    expect(ui.el.querySelector(".cross-pick-confirm")!.dataset.sfx).toBe("coin");
  });
});

describe("#185 the stylesheet says so too", () => {
  const bodiesFor = (selector: string): string[] => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[},\\s])${esc}(?=[\\s,{])`, "gm");
    const out: string[] = [];
    for (let m = re.exec(css); m; m = re.exec(css)) {
      const open = css.indexOf("{", m.index);
      const close = open < 0 ? -1 : css.indexOf("}", open);
      if (close > open) out.push(css.slice(open + 1, close));
    }
    return out;
  };

  it("left the blue-slate gradient and the cool Broken Cross palette behind", () => {
    // the exact hard-coded colours the ticket named; if one returns, the
    // popup left the house again.
    expect(css).not.toMatch(/#1d2a38|#0f1620|#7e93ad|#c3d3e4|#9fb3c8/);
    // …and the plate paints no background of its own — `.panel` owns the face.
    for (const body of bodiesFor(".cross-pick")) {
      expect(body, ".cross-pick paints over the shared plate").not.toMatch(/(?:^|[;{\s])background:/);
    }
  });

  it("collapses the entrance under reduced motion into the readable end state", () => {
    // the blanket `* { animation-duration: .01ms }` keeps every one-shot here:
    // both crosspick keyframes must END visible, or the plate pops in empty.
    expect(css, "the blanket reduced-motion collapse is gone — re-pin this test").toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]{0,400}\*\s*\{\s*animation-duration:\s*\.01ms/,
    );
    for (const name of ["crosspickin", "crosspickdim"]) {
      const m = new RegExp(`@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
      expect(m, `@keyframes ${name} is missing`).toBeTruthy();
      const to = /to\s*\{([^}]*)\}/.exec(m![1])!;
      expect(to[1], `${name} does not end at opacity 1`).toMatch(/opacity:\s*1/);
    }
  });

  it("fits the phone board with thumb-sized targets", () => {
    // MOBILE-02's media pair must shrink the gauge: 46×50 tiles (≥44px) and
    // a 44px-tall confirm. Read from the LAST rules written for these
    // selectors (the phone block sits after the base block in the sheet).
    const phone = (sel: string, re: RegExp) => bodiesFor(sel).filter((b) => re.test(b)).pop();
    expect(phone(".cross-pick-btn", /width:\s*46px/), "no phone tile size").toMatch(/width:\s*46px;\s*height:\s*50px/);
    expect(bodiesFor(".cross-pick-confirm").find((b) => /min-height:\s*44px/.test(b)), "no 44px phone confirm").toBeTruthy();
    // the row wraps before the plate can clip, and the plate caps at the dim.
    expect(bodiesFor(".cross-pick-row").join(" ")).toMatch(/flex-wrap:\s*wrap/);
    expect(bodiesFor(".cross-pick").join(" ")).toMatch(/max-width:\s*100%/);
  });
});
