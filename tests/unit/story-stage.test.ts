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
import { describe, it, expect, afterEach } from "vitest";
import { showScene, type SceneHandle } from "../../src/story/stage";
import { say, narrate, title, type ScriptScene } from "../../src/story/script";

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
});
