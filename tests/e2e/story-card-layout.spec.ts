import { test, expect, type Page } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// #122 — the contract card's status badge must not sit on the heading.
//
// The reported screenshot was "Filed · lost" painted over "CONTRACT I ·
// BLACKWOOD FREIGHT". `story-card-layout.test.ts` pins the DOM and the
// stylesheet; this spec pins the thing only a browser can answer: do the two
// boxes actually intersect, at the widths the game has to hold up at.
//
// It measures real rectangles rather than eyeballing a screenshot, so a card
// that overlaps by a pixel fails the same way one that overlaps by a line
// does.
// ══════════════════════════════════════════════════════════════════════════

/** A campaign record with one card in every state: lost, won, open, sealed. */
const FOUR_STATE_RECORD = JSON.stringify({
  unlocked: 4,
  results: { inheritance: "loss", "toll-king": "win" },
  introSeen: true,
  advisor: true,
});

/** Long headings are what made the collision: widen every kicker in place. */
const LONGEN_KICKERS = () => {
  document.querySelectorAll<HTMLElement>(".cc-kicker").forEach((k, i) => {
    k.textContent = `CONTRACT ${["I", "II", "III", "IV", "V"][i]} · BLACKWOOD FREIGHT & MERCANTILE TRUST COMPANY`;
  });
};

async function openCampaign(page: Page) {
  await page.addInitScript(([record]) => {
    localStorage.setItem("hexmatch:tutorial", "never");
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:story", record);
  }, [FOUR_STATE_RECORD] as const);
  await page.goto("/");
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Story Mode/ }).click();
  await expect(page.locator(".chapter-card")).toHaveCount(5);
}

/** THE acceptance: no card's heading, badge, portrait or brief overlaps
 *  another, and nothing is clipped to make room. */
async function expectNoCollisions(page: Page, label: string) {
  const report = await page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const hits = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
      !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
    const overlaps: string[] = [];
    const clipped: string[] = [];
    const spilled: string[] = [];

    for (const card of Array.from(document.querySelectorAll(".chapter-card"))) {
      const name = card.querySelector(".cc-name")?.textContent ?? "?";
      const kicker = card.querySelector(".cc-kicker");
      const badge = card.querySelector(".cc-seal, .cc-lock");
      const face = card.querySelector(".cc-face");
      const brief = card.querySelector(".cc-brief");
      const meta = card.querySelector(".cc-meta");
      const panel = card.closest(".start-panel");

      const parts: [string, Element | null][] = [
        ["kicker", kicker], ["badge", badge], ["portrait", face],
        ["brief", brief], ["meta", meta],
      ];
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const [an, a] = parts[i], [bn, b] = parts[j];
          if (!a || !b) continue;
          if (hits(rect(a), rect(b))) overlaps.push(`${name}: ${an} × ${bn}`);
        }
      }
      for (const [n, el] of parts) {
        if (!el) continue;
        // Text that needed more room than it got is the "hidden by clipping"
        // failure mode the ticket calls out.
        if (el.scrollWidth > el.clientWidth + 1) clipped.push(`${name}: ${n}`);
      }
      if (panel) {
        const c = rect(card), p = rect(panel);
        if (c.right > p.right + 1 || c.left < p.left - 1) spilled.push(name);
      }
    }
    return { overlaps, clipped, spilled };
  });

  expect(report.overlaps, `${label}: overlapping boxes`).toEqual([]);
  expect(report.clipped, `${label}: clipped text`).toEqual([]);
  expect(report.spilled, `${label}: card outside its panel`).toEqual([]);
}

test("the lost contract's badge clears the heading at desktop width", async ({ page }) => {
  await openCampaign(page);
  // The reported card: the FIRST contract, in the reported (lost) state.
  // Addressed by position, not by title — PR #125 renamed chapter 1.
  const reported = page.locator(".chapter-card").first();
  await expect(reported.locator(".cc-seal.loss")).toHaveText("Filed · lost");
  await expectNoCollisions(page, "desktop");
});

test("no card collides when every heading is long", async ({ page }) => {
  await openCampaign(page);
  await page.evaluate(LONGEN_KICKERS);
  await expectNoCollisions(page, "long headings");
});

test("no card collides at the narrow widths the game supports", async ({ page }) => {
  await openCampaign(page);
  for (const width of [1280, 900, 768, 480, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(LONGEN_KICKERS);
    await expectNoCollisions(page, `${width}px`);
  }
});

test("no card collides at 200% zoom", async ({ page }) => {
  await openCampaign(page);
  // CSS zoom is the layout half of browser zoom — the same shrink in the
  // space a card gets, which is what this collision is about.
  await page.addStyleTag({ content: "html { zoom: 2; }" });
  await page.evaluate(LONGEN_KICKERS);
  await expectNoCollisions(page, "200% zoom");
});

test("the cards stay keyboard reachable and selectable where unlocked", async ({ page }) => {
  await openCampaign(page);
  const open = page.locator(".chapter-card:not(.locked)");
  await expect(open).toHaveCount(4);
  await open.first().focus();
  await expect(open.first()).toBeFocused();
  // Tab walks every unlocked card, and never lands on a sealed one.
  for (let i = 0; i < 4; i++) {
    const focused = page.locator(".chapter-card:focus");
    await expect(focused).toHaveCount(1);
    await expect(focused).not.toHaveClass(/locked/);
    await page.keyboard.press("Tab");
  }
  await expect(page.locator(".chapter-card.locked")).toBeDisabled();
});
