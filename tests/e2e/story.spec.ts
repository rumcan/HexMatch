import { test, expect } from "@playwright/test";
import { STORY_MODE_ENABLED } from "../../src/story/flag";

// Story mode is hidden for now (src/story/flag.ts) — the campaign has no door.
test.skip(!STORY_MODE_ENABLED, "Story mode is hidden (STORY_MODE_ENABLED = false)");
import type { Page } from "@playwright/test";
import { bootBudget } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the campaign in a real browser, against the real built app.
//
// Three seams, no mocking: the menu opens with four sealed contracts on a
// fresh record; a playtest link (`?chapter=`) boots straight into a contract
// with the reel suppressed; and the cutscene stage — reel and briefing alike
// — really stands over the boot and really lifts when skipped, leaving the
// contract's rival wearing their name and painted face in the HUD.
// ══════════════════════════════════════════════════════════════════════════

/** Fresh record, no onboarding: the specs exercise the campaign, not the tour. */
async function primeStory(page: import("@playwright/test").Page, url: string) {
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:tutorial", "never");
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.removeItem("hexmatch:story");
  });
  await page.goto(url);
}

// ══════════════════════════════════════════════════════════════════════════
// #139 — reading the cutscene stage: title, narration and dialogue are three
// different states, and a click means different things in each one.
//
// A briefing opens on its title card (no typing: one click advances), then
// narrates (typing), and only then introduces its speaker — and a click
// MID-TYPING completes the line instead of advancing it. The specs below
// follow those states explicitly: every advance is bounded, every wait is
// for an observable condition (the next line standing, the ▾ out, the stage
// gone), and every failure names the scene state it found instead of
// counting clicks.
// ══════════════════════════════════════════════════════════════════════════

/** Whatever the cutscene stage is showing, as one readable snapshot. */
interface StorySnapshot {
  present: boolean;
  /** `data-scene`: "intro", "c1-pre", "c3-pre", … — which reel is standing. */
  scene: string;
  kind: "title" | "narration" | "dialogue" | "unknown";
  title: string;
  name: string;
  text: string;
  /** A click advances from here: a title stands, or the ▾ is out. */
  ready: boolean;
  caption: string;
}

async function storyState(page: Page): Promise<StorySnapshot> {
  return page.evaluate((): StorySnapshot => {
    const stage = document.querySelector(".story-stage");
    if (!stage) {
      return {
        present: false, scene: "", kind: "unknown",
        title: "", name: "", text: "", ready: true, caption: "",
      };
    }
    const textOf = (sel: string): string =>
      stage.querySelector(sel)?.textContent?.trim() ?? "";
    const shown = (sel: string): boolean => {
      const node = stage.querySelector(sel);
      return !!node && !node.classList.contains("hidden");
    };
    const isTitle = shown(".story-titlecard");
    const dossierUp = shown(".story-dossier");
    const plate = stage.querySelector(".story-plate");
    const kind: StorySnapshot["kind"] = isTitle
      ? "title"
      : dossierUp
        ? "dialogue"
        : plate && !plate.classList.contains("hidden") && plate.classList.contains("narrator")
          ? "narration"
          : "unknown";
    const next = stage.querySelector(".story-next");
    return {
      present: true,
      scene: stage.getAttribute("data-scene") ?? "",
      kind,
      title: textOf(".story-titlecard"),
      name: textOf(".story-name"),
      text: textOf(".story-text"),
      ready: isTitle || (!!next && !next.classList.contains("hidden")),
      caption: textOf(".story-caption"),
    };
  });
}

/** The failure voice: what the stage was showing when the spec looked. */
const describeStory = (s: StorySnapshot): string =>
  !s.present
    ? "no story stage is standing — the game is under it"
    : s.kind === "title"
      ? `scene "${s.scene}" is showing its title card "${s.title}"`
      : s.kind === "narration"
        ? `scene "${s.scene}" is narrating "${s.text.slice(0, 90)}…"`
        : s.kind === "dialogue"
          ? `scene "${s.scene}" has ${s.name || "(no speaker)"} saying "${s.text.slice(0, 90)}…"`
          : `scene "${s.scene}" is between lines (caption "${s.caption}")`;

/**
 * Wait until a click would ADVANCE the standing line: a title needs nothing,
 * a typed line needs its ▾ out. Under reduced-motion or instant text the ▾
 * is already out, so the same wait serves every pacing.
 */
async function waitForStoryReady(page: Page, timeout = 15000): Promise<void> {
  try {
    await page.waitForFunction(() => {
      const stage = document.querySelector(".story-stage");
      if (!stage) return true;
      const title = stage.querySelector(".story-titlecard");
      if (title && !title.classList.contains("hidden")) return true;
      const next = stage.querySelector(".story-next");
      return !!next && !next.classList.contains("hidden");
      // Interval polling, not rAF: the ▾ is timer-driven, and during the boot
      // the frame loop the stage stands over may not be producing frames yet.
    }, null, { timeout, polling: 120 });
  } catch {
    const s = await storyState(page).catch(() => null);
    throw new Error(
      `the story line never became ready within ${timeout}ms: ${s ? describeStory(s) : "the page is gone"}`,
    );
  }
}

/** Two snapshots of the same standing line (no adjacent script lines repeat). */
const sameSnapshot = (a: StorySnapshot, b: StorySnapshot): boolean =>
  a.present && b.present && a.scene === b.scene
  && a.title === b.title && a.name === b.name && a.text === b.text;

/**
 * Advance exactly one line, however many clicks it takes: a mid-typing click
 * completes the line instead of advancing it, so the click-then-ready loop —
 * not a fixed count — is what moves the story.
 */
async function advanceStoryLine(page: Page, maxClicks = 4): Promise<StorySnapshot> {
  const first = await storyState(page);
  if (!first.present) return first;
  // A mid-typing line completes on click instead of advancing: finish it
  // first (one click, instant), then advance exactly one line. Every click
  // is followed by a re-read, so a click that lands a breath after typing
  // finished — and therefore advances instead of completing — is observed
  // in the new line it reached, never mistaken for a completed one.
  let before = first;
  if (!before.ready) {
    await page.locator(".story-stage").click();
    await waitForStoryReady(page);
    const completed = await storyState(page);
    if (!sameSnapshot(completed, before)) return completed;
    before = completed;
  }
  for (let i = 0; i < maxClicks; i++) {
    await page.locator(".story-stage").click();
    await waitForStoryReady(page);
    const after = await storyState(page);
    if (!sameSnapshot(after, before)) return after;
  }
  const stuck = await storyState(page);
  throw new Error(
    `the story did not advance after ${maxClicks} clicks: ${describeStory(stuck)}`,
  );
}

/**
 * Walk the standing reel until `expected` speaks, one ready line at a time.
 * Fails with the scene state it found — never with a bare timeout.
 */
async function advanceToSpeaker(
  page: Page, expected: string, maxLines = 10,
): Promise<StorySnapshot> {
  for (let i = 0; i < maxLines; i++) {
    // The speaker's name is set the moment the line stands — typing only
    // fills the words — so identity is known even mid-typing, and a line
    // that is not our speaker is completed (one click, instant) rather
    // than waited out. The loop re-reads after every click, so no line is
    // ever advanced past without being observed first.
    const s = await storyState(page);
    if (!s.present) {
      throw new Error(
        `expected ${expected} to speak, but the story settled to the game: ${describeStory(s)}`,
      );
    }
    if (s.kind === "dialogue" && s.name === expected) {
      // Let her finish on her own: no click here can overshoot past her.
      await waitForStoryReady(page);
      return storyState(page);
    }
    if (!s.ready) {
      await page.locator(".story-stage").click();
      await waitForStoryReady(page);
      continue;
    }
    await page.locator(".story-stage").click();
  }
  const s = await storyState(page);
  throw new Error(
    `expected ${expected} to speak within ${maxLines} lines, but ${describeStory(s)}`,
  );
}

/** The campaign record's word on the opening reel (see progress.ts). */
async function introSeen(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("hexmatch:story") ?? "{}";
      return (JSON.parse(raw) as { introSeen?: unknown }).introSeen === true;
    } catch {
      return false;
    }
  });
}

/** Skip whatever reel or briefing is standing, until the game is under it. */
async function skipToGame(page: Page) {
  // Each pass clears exactly one standing reel: the skip click, then the
  // handoff — the 260ms settle fade lifts and either the next scene stands
  // (reel → briefing) or the game is under it. A pass that finds no stage
  // waits out the handoff's grace before believing the game is there: the
  // reel → briefing crossing goes through a React unmount and a game boot,
  // so stillness, not a single empty read, is the signal.
  for (let i = 0; i < 4; i++) {
    const skip = page.locator(".story-skip");
    if (await skip.count()) {
      const before = await page.locator(".story-stage").first()
        .getAttribute("data-scene").catch(() => null);
      await skip.first().click();
      try {
        await page.waitForFunction(
          (prev: string | null) => {
            const standing = document.querySelector(".story-stage");
            return !standing || standing.getAttribute("data-scene") !== prev;
          },
          before,
          { timeout: 15000, polling: 120 },
        );
      } catch {
        const s = await storyState(page).catch(() => null);
        throw new Error(`Skip did not lift the reel: ${s ? describeStory(s) : "the page is gone"}`);
      }
      continue;
    }
    const handoff = await page.waitForSelector(".story-stage", { timeout: 3000 })
      .then(() => true).catch(() => false);
    if (!handoff) break;
  }
  await expect(page.locator(".story-stage")).toHaveCount(0);
  await page.waitForFunction(() => {
    const h = (window as unknown as { __iso?: { phase?: string } }).__iso;
    return !!h && (h.phase === "setup-factory" || h.phase === "play");
  }, null, { timeout: bootBudget(), polling: 250 });
}

test("the campaign menu opens with one open contract and four sealed", async ({ page }) => {
  await primeStory(page, "/");
  // STORY-01 menu: Play first — the mode screen stands behind the front door
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Story Mode/ }).click();
  const cards = page.locator(".chapter-card");
  await expect(cards).toHaveCount(5);
  await expect(page.locator(".chapter-card.locked")).toHaveCount(4);
  await expect(cards.first()).toContainText("First Day on the Job");
  await expect(cards.first()).toContainText("Logistics Manager");
  await expect(cards.first()).toContainText("vs Torvin");
  // the opening reel is offered exactly while it is still unseen
  await expect(page.getByRole("button", { name: /opening reel/ })).toBeVisible();
});

test("a playtest link boots the contract, and skipping the briefing lands in the game", async ({ page }) => {
  await primeStory(page, "/?chapter=black-gold&storyintro=0");
  // the briefing stands first: the oil field, then Roque in person —
  // title card, rumour narration, and only then her entrance.
  const stage = page.locator(".story-stage");
  await expect(stage).toBeVisible();
  await expect(page.locator(".story-caption")).toContainText("Roque field");
  await expect(page.locator(".story-titlecard")).toContainText("CHAPTER THREE · BLACK GOLD");
  const opening = await storyState(page);
  expect(opening.kind, `the briefing should open on its title card, but ${describeStory(opening)}`).toBe("title");
  const narrated = await advanceStoryLine(page);
  expect(narrated.kind, `the title card should give way to narration, but ${describeStory(narrated)}`).toBe("narration");
  await expect(page.locator(".story-text")).toContainText("rumour had a name");
  const entrance = await advanceToSpeaker(page, "Delphine Roque");
  expect(entrance.scene, `the wrong contract booted: ${describeStory(entrance)}`).toBe("c3-pre");
  await expect(page.locator(".story-name")).toHaveText("Delphine Roque");
  // Skip lifts the briefing; the contract's game is under it
  await skipToGame(page);
  // the contract's rival wears their name in the dossier row
  await expect(page.locator(".king-name").nth(1)).toContainText("Delphine Roque");
  // and the HUD badge races to the contract's line, not the difficulty's
  await expect(page.locator(".vp-tot")).toHaveText("/7");
});

test("the reel plays once for a fresh player and skips clean", async ({ page }) => {
  await primeStory(page, "/");
  // STORY-01 menu: Play first — the mode screen stands behind the front door
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Story Mode/ }).click();
  await page.locator(".chapter-card").first().click();
  // unseen record ⇒ the opening reel stands before the briefing
  const reel = page.locator('.story-stage[data-scene="intro"]');
  await expect(reel).toBeVisible();
  await expect(reel.locator(".story-titlecard")).toContainText("HEXMATCH INDUSTRIES");
  // the reel is unseen until it settles — watched or skipped both count
  expect(await introSeen(page), "a fresh record must not have seen the reel yet").toBe(false);
  await reel.locator(".story-skip").click();
  // …and the contract's briefing follows it: title, narration, then Mabel
  const briefing = page.locator('.story-stage[data-scene="c1-pre"]');
  await expect(briefing).toBeVisible({ timeout: 15000 });
  expect(await introSeen(page), "skipping the reel must mark it seen").toBe(true);
  await expect(briefing.locator(".story-titlecard")).toContainText("CHAPTER ONE · FIRST DAY ON THE JOB");
  const narrated = await advanceStoryLine(page);
  expect(narrated.kind, `the title card should give way to narration, but ${describeStory(narrated)}`).toBe("narration");
  await expect(briefing.locator(".story-text")).toContainText("funeral was on a Tuesday");
  await advanceToSpeaker(page, "Mabel Quill");
  await expect(page.locator(".story-name")).toHaveText("Mabel Quill");
  await skipToGame(page);
  await expect(page.locator(".king-name").nth(1)).toContainText("Torvin");
});

test("a mid-typing click completes the line; the next click advances", async ({ page }) => {
  // #139 — typing, deterministically: the stage reads the OS motion setting
  // once per scene, so pin it to full motion before the boot.
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:tutorial", "never");
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.removeItem("hexmatch:story");
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = ((query: string) => {
      if (query.includes("prefers-reduced-motion")) {
        return {
          matches: false, media: query, onchange: null,
          addListener: () => {}, removeListener: () => {},
          addEventListener: () => {}, removeEventListener: () => {},
          dispatchEvent: () => false,
        };
      }
      return nativeMatchMedia(query);
    }) as typeof window.matchMedia;
  });
  await page.goto("/?chapter=black-gold&storyintro=0");
  const stage = page.locator(".story-stage");
  await expect(stage).toBeVisible();
  await expect(page.locator(".story-titlecard")).toContainText("CHAPTER THREE · BLACK GOLD");
  await stage.click(); // the title needs no typing: one click narrates
  // catch the narration mid-typing — words on the plate, the ▾ still out
  const FULL_LINE = "South of the county the derricks went up like a rumour, and the rumour had a name.";
  try {
    await page.waitForFunction((full: string) => {
      const text = document.querySelector(".story-text")?.textContent ?? "";
      const next = document.querySelector(".story-next");
      return text.length > 0 && text.length < full.length
        && !!next && next.classList.contains("hidden");
    }, FULL_LINE, { timeout: 8000, polling: 30 });
  } catch {
    const s = await storyState(page).catch(() => null);
    throw new Error(
      `never caught the narration mid-typing (typing may be disabled): ${s ? describeStory(s) : "the page is gone"}`,
    );
  }
  await stage.click(); // completes the line — and must NOT advance past it
  await expect(page.locator(".story-text")).toHaveText(FULL_LINE);
  await expect(page.locator(".story-next")).not.toHaveClass(/hidden/);
  const completed = await storyState(page);
  expect(completed.kind, `a mid-typing click completes the line, it must not advance: ${describeStory(completed)}`).toBe("narration");
  await stage.click(); // the line complete, the next click advances — to Roque
  const entrance = await advanceToSpeaker(page, "Delphine Roque", 4);
  expect(entrance.scene, `the wrong contract booted: ${describeStory(entrance)}`).toBe("c3-pre");
  await expect(page.locator(".story-name")).toHaveText("Delphine Roque");
});

// ══════════════════════════════════════════════════════════════════════════
// #122 — contract status badge must not overlap heading text, at desktop and
// narrow widths, across won/lost/locked/unplayed states.
// ══════════════════════════════════════════════════════════════════════════
type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box, tol = 1): boolean =>
  a.x + tol < b.x + b.width - tol &&
  b.x + tol < a.x + a.width - tol &&
  a.y + tol < b.y + b.height - tol &&
  b.y + tol < a.y + a.height - tol;

async function openCampaignWith(
  page: import("@playwright/test").Page,
  progress: { unlocked: number; results: Record<string, string> },
) {
  await page.addInitScript((p) => {
    localStorage.setItem("hexmatch:tutorial", "never");
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:story", JSON.stringify({ ...p, introSeen: true, advisor: true }));
  }, progress);
  await page.goto("/");
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Story Mode/ }).click();
  await expect(page.locator(".chapter-card")).toHaveCount(5);
}

/** Every leaf box on every card must sit apart — no badge over any heading. */
async function expectCardsHaveNoOverlap(page: import("@playwright/test").Page) {
  const cards = page.locator(".chapter-card");
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const name = (await card.locator(".cc-name").textContent())?.trim() ?? `card ${i}`;
    const parts: Array<[string, Box | null]> = [
      ["face", await card.locator(".cc-face").boundingBox()],
      ["kicker", await card.locator(".cc-kicker").boundingBox()],
      ["name", await card.locator(".cc-name").boundingBox()],
      ["brief", await card.locator(".cc-brief").boundingBox()],
      ["meta", await card.locator(".cc-meta").boundingBox()],
    ];
    const badge = card.locator(".cc-seal, .cc-lock");
    if (await badge.count()) parts.push(["badge", await badge.boundingBox()]);
    for (const [label, box] of parts) {
      expect(box, `${name}: .${label} has a box`).not.toBeNull();
    }
    const boxes = parts as Array<[string, Box]>;
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        expect(
          overlaps(boxes[a][1], boxes[b][1]),
          `${name}: ${boxes[a][0]} overlaps ${boxes[b][0]}`,
        ).toBe(false);
      }
    }
  }
}

test("#122 contract badge never overlaps heading, won/lost/unplayed/locked", async ({ page }) => {
  // Mixed record: loss (the reported Inheritance state), win, unplayed open,
  // and two sealed — every badge state on screen at once.
  await openCampaignWith(page, {
    unlocked: 3,
    results: { inheritance: "loss", "toll-king": "win" },
  });
  await expect(page.locator(".chapter-card .cc-seal.loss").first()).toContainText("Filed · lost");
  await expectCardsHaveNoOverlap(page);

  // Narrow phone width: the header row wraps the badge below the kicker.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  await expectCardsHaveNoOverlap(page);

  // 200% zoom proxy: halve the CSS width so text wraps as it does zoomed.
  await page.setViewportSize({ width: 640, height: 800 });
  await page.waitForTimeout(150);
  await expectCardsHaveNoOverlap(page);
});

test("#122 long contract headings keep clear of their badges", async ({ page }) => {
  // Every contract filed, so even the longest kicker (Contract V) wears a badge.
  await openCampaignWith(page, {
    unlocked: 5,
    results: {
      inheritance: "loss",
      "toll-king": "win",
      "black-gold": "loss",
      "stone-thunder": "win",
      "chairmans-ledger": "loss",
    },
  });
  await expect(page.locator(".chapter-card .cc-seal")).toHaveCount(5);
  await expectCardsHaveNoOverlap(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(150);
  await expectCardsHaveNoOverlap(page);
});
