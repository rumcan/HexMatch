// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the stage projector (src/story/stage.ts).
//
// The same discipline the tour's spec applies to its projector: the script
// is data (story-script.test.ts reads every scene with no DOM); THIS file
// drives the real projector in jsdom and pins the contract a player feels —
// a line types out, a click completes it before it advances, the last click
// settles "done", Skip and Esc settle "skipped", a backdrop change moves the
// place caption, and `player` lines wear the tycoon the options named.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, afterEach, vi } from "vitest";
import { showScene, type SceneHandle } from "../../src/story/stage";
import { say, narrate, title, type ScriptScene } from "../../src/story/script";
import { CHAPTERS } from "../../src/story/chapters";

const SCENE: ScriptScene = {
  id: "test-scene",
  bg: "harbor",
  lines: [
    title("A TEST CARD", "harbor"),
    say("mabel", "Morning, boss. The books are open."),
    say("player", "Then let us read them."),
    narrate("Somewhere down the dock, a freight whistle.", "office"),
  ],
};

let handle: SceneHandle | null = null;
const host = () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Click the stage: completes a typing line, else advances. */
const click = (el: HTMLElement) => el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

afterEach(() => {
  handle?.destroy();
  handle = null;
  document.body.innerHTML = "";
});

describe("STORY-01 the stage projector", () => {
  it("stands up, types the first line, and settles done at the end", async () => {
    const el = host();
    handle = showScene(el, SCENE);
    await wait(60);
    const stage = el.querySelector(".story-stage");
    expect(stage).toBeTruthy();
    expect(stage?.getAttribute("data-scene")).toBe("test-scene");
    // the title card stands alone: no dossier, no plate
    expect(stage?.querySelector(".story-titlecard.hidden")).toBeNull();
    expect(stage?.querySelector(".story-titlecard")?.classList.contains("on")).toBe(true);

    // click through: title → mabel (typing) → complete → advance…
    click(stage as HTMLElement);            // title → mabel line starts typing
    await wait(40);
    const plate = stage?.querySelector(".story-plate") as HTMLElement;
    expect(plate.classList.contains("hidden")).toBe(false);
    const text = () => stage?.querySelector(".story-text")?.textContent ?? "";
    click(stage as HTMLElement);            // complete the typing line
    expect(text()).toBe("Morning, boss. The books are open.");
    click(stage as HTMLElement);            // → player line
    await wait(20);
    click(stage as HTMLElement);            // complete it
    expect(text()).toBe("Then let us read them.");
    // the player line resolves to the default tycoon (Anne Hextall)
    expect(stage?.querySelector(".story-name")?.textContent).toBe("Anne Hextall");
    click(stage as HTMLElement);            // → narrator line
    await wait(20);
    click(stage as HTMLElement);            // complete narrator
    // the narrator moved the place to the office
    expect(stage?.querySelector(".story-caption")?.textContent).toContain("office");
    const done = handle.promise;
    click(stage as HTMLElement);            // past the last line
    const how = await done;
    expect(how).toBe("done");
    await wait(320);
    expect(el.querySelector(".story-stage")).toBeNull();
  });

  it("skip ends the reel now and says skipped", async () => {
    const el = host();
    handle = showScene(el, SCENE, { skipLabel: "Skip reel ▸▸" });
    await wait(40);
    const skipBtn = el.querySelector(".story-skip") as HTMLButtonElement;
    expect(skipBtn.textContent).toBe("Skip reel ▸▸");
    const p = handle.promise;
    skipBtn.click();
    expect(await p).toBe("skipped");
  });

  it("Escape is a skip, and a mid-typing click completes instead of advancing", async () => {
    const el = host();
    handle = showScene(el, SCENE);
    await wait(40);
    const stage = el.querySelector(".story-stage") as HTMLElement;
    click(stage);                           // title → mabel, typing
    await wait(30);
    const mid = stage.querySelector(".story-text")?.textContent ?? "";
    expect(mid.length).toBeLessThan("Morning, boss. The books are open.".length);
    click(stage);                           // completes, does not advance
    expect(stage.querySelector(".story-text")?.textContent)
      .toBe("Morning, boss. The books are open.");
    const p = handle.promise;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(await p).toBe("skipped");
  });

  it("player lines wear the tycoon the options named", async () => {
    const el = host();
    handle = showScene(el, SCENE, { player: "you" });
    await wait(40);
    const stage = el.querySelector(".story-stage") as HTMLElement;
    click(stage); await wait(20);           // → mabel
    click(stage);                           // complete
    click(stage);                           // → player
    await wait(20);
    click(stage);                           // complete
    expect(stage.querySelector(".story-name")?.textContent).toBe("James Hextall");
  });

  it("destroy tears the stage down and settles an unsettled promise", async () => {
    const el = host();
    handle = showScene(el, SCENE);
    await wait(40);
    const p = handle.promise;
    handle.destroy();
    handle = null;
    expect(await p).toBe("skipped");
    expect(el.querySelector(".story-stage")).toBeNull();
  });

  // #123: loss epilogues show every line in full immediately — no typewriter,
  // no punctuation pauses, no extra click to finish the line.
  it("instant mode shows each line in full with advance visible, no waiting", async () => {
    const LOSS_LIKE: ScriptScene = {
      id: "c1-lose-like",
      bg: "harbor",
      lines: [
        say("torvin", "Do not take it hard, child. Most heirs last two seasons. You lasted one and a half.", "smile"),
        say("player", "That is not comforting. Really, not at all; no, never!"),
        narrate("The ledger opens again tomorrow, boss. Same dock, same plant, same us — punctuation, pauses, and all."),
      ],
    };
    const el = host();
    handle = showScene(el, LOSS_LIKE, { instant: true, skipLabel: "Skip epilogue ▸▸" });
    await wait(60);
    const stage = el.querySelector(".story-stage") as HTMLElement;
    const text = () => stage.querySelector(".story-text")?.textContent ?? "";
    const nextHidden = () => stage.querySelector(".story-next")?.classList.contains("hidden") ?? true;
    // the first line lands in full on its first frame, advance already visible
    expect(text()).toBe(LOSS_LIKE.lines[0].text);
    expect(nextHidden()).toBe(false);
    // one click advances exactly one line — no complete-then-advance double step
    click(stage);
    await wait(20);
    expect(text()).toBe(LOSS_LIKE.lines[1].text);
    expect(nextHidden()).toBe(false);
    click(stage);
    await wait(20);
    expect(text()).toBe(LOSS_LIKE.lines[2].text);
    expect(nextHidden()).toBe(false);
    // no typing timer later overwrites the instantly displayed line
    await wait(300);
    expect(text()).toBe(LOSS_LIKE.lines[2].text);
    const done = handle.promise;
    click(stage);
    expect(await done).toBe("done");
  });

  it("instant mode reveals a line with no timer ticks at all (fake timers)", async () => {
    vi.useFakeTimers();
    // Run the opening rAF synchronously so the test advances zero timers.
    const g = globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame };
    const origRaf = g.requestAnimationFrame;
    g.requestAnimationFrame = ((cb: FrameRequestCallback) => { cb(0); return 0; }) as typeof requestAnimationFrame;
    try {
      const el = host();
      handle = showScene(el, {
        id: "lose",
        bg: "harbor",
        lines: [say("torvin", "Do not take it hard, child. Punctuation; pauses! All of it… at once.", "smile")],
      }, { instant: true });
      // No timer was advanced: the line is already complete, advance visible.
      const stage = el.querySelector(".story-stage") as HTMLElement;
      expect(stage.querySelector(".story-text")?.textContent)
        .toBe("Do not take it hard, child. Punctuation; pauses! All of it… at once.");
      expect(stage.querySelector(".story-next")?.classList.contains("hidden")).toBe(false);
      // One click past the single line settles done (advance fake timers only
      // for the settle fade's own timeout, never for typing).
      click(stage);
      await vi.advanceTimersByTimeAsync(500);
      expect(await handle.promise).toBe("done");
    } finally {
      g.requestAnimationFrame = origRaf;
      vi.useRealTimers();
    }
  });

  it("instant mode keeps Skip, keyboard advance and completion working", async () => {
    // Skip exits promptly with "skipped".
    const el1 = host();
    const h1 = showScene(el1, SCENE, { instant: true, skipLabel: "Skip epilogue ▸▸" });
    await wait(60);
    expect((el1.querySelector(".story-skip") as HTMLButtonElement).textContent).toBe("Skip epilogue ▸▸");
    const p1 = h1.promise;
    (el1.querySelector(".story-skip") as HTMLButtonElement).click();
    expect(await p1).toBe("skipped");
    h1.destroy();
    el1.remove();
    // Enter advances exactly one line, in full.
    const el2 = host();
    handle = showScene(el2, SCENE, { instant: true });
    await wait(60);
    const stage2 = el2.querySelector(".story-stage") as HTMLElement;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await wait(20);
    expect(stage2.querySelector(".story-text")?.textContent).toBe("Morning, boss. The books are open.");
    expect(stage2.querySelector(".story-next")?.classList.contains("hidden")).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    await wait(20);
    expect(stage2.querySelector(".story-text")?.textContent).toBe("Then let us read them.");
  });

  it("every campaign loss epilogue renders in full under instant mode", async () => {
    for (const ch of CHAPTERS) {
      const el = host();
      const h = showScene(el, ch.lose, { instant: true, skipLabel: "Skip epilogue ▸▸" });
      await wait(60);
      const stage = el.querySelector(".story-stage") as HTMLElement;
      // Every loss opens on a spoken line: the plate shows it complete.
      expect(stage.querySelector(".story-text")?.textContent).toBe(ch.lose.lines[0].text);
      expect(stage.querySelector(".story-next")?.classList.contains("hidden")).toBe(false);
      // Walk the whole epilogue one click per line; it must settle done.
      for (let i = 1; i < ch.lose.lines.length; i++) {
        click(stage);
        await wait(15);
        expect(stage.querySelector(".story-text")?.textContent).toBe(ch.lose.lines[i].text);
      }
      const done = h.promise;
      click(stage);
      expect(await done).toBe("done");
      h.destroy();
      el.remove();
    }
  });
});
