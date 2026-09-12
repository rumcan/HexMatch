import { describe, expect, it } from "vitest";
import {
  GOLD_MINE_SCENES, OIL_DRILLING_SCENE, RIVAL_BANTER, RIVALRY_LINES, RIVALRY_SCENES,
  createBanterDirector, createGoldMineDirector, createRivalDirector, createRivalVoice,
  rivalLine, rivalryScene, type RivalryDirection, type RivalryTactic,
} from "../../src/iso/rivalry";

const directions: RivalryDirection[] = ["retort", "attack", "thwarted"];
const tactics: RivalryTactic[] = ["bandit", "harden", "block", "fog", "protest"];

describe("the rival's deliberately terrible Black Market banter", () => {
  it("gives every Torvin line an immediate player-portrait callout", () => {
    for (const direction of directions) {
      for (const tactic of tactics) {
        const scenes = RIVALRY_SCENES[direction][tactic];
        expect(scenes.length, `${direction}/${tactic}`).toBeGreaterThanOrEqual(2);
        expect(RIVALRY_LINES[direction][tactic]).toHaveLength(scenes.length);
        for (const scene of scenes) {
          expect(scene[0].speaker).toBe("rival");
          expect(scene.at(-1)?.speaker).toBe("you");
          expect(scene.length % 2).toBe(0);
          for (let i = 0; i < scene.length; i++) {
            expect(scene[i].speaker).toBe(i % 2 === 0 ? "rival" : "you");
            expect(scene[i].text.length).toBeLessThan(100);
          }
        }
      }
    }
  });

  it("sounds like an old tycoon losing a fight with his own comeback", () => {
    const all = Object.values(RIVALRY_SCENES)
      .flatMap((byTactic) => Object.values(byTactic))
      .flat(2)
      .map((beat) => beat.text)
      .join(" ");
    expect(all).toMatch(/Ice to meet you|bingo hall|toll troll|doctor's orders/);
    expect(all).toMatch(/rehearse|not a thing|grandpa|comeback/);
  });

  it("includes the full invisible-hand-gesture oil conversation", () => {
    expect(OIL_DRILLING_SCENE.map((beat) => beat.speaker)).toEqual([
      "rival", "you", "rival", "you", "rival", "you", "rival", "you",
    ]);
    expect(OIL_DRILLING_SCENE.map((beat) => beat.text)).toEqual([
      "I see you're drilling for oil. How about you drill this!",
      "Drill what?",
      "I was making a rude gesture with my hands.",
      "Yeah, I can't see you.",
      "Point stands.",
      "Wait—what point?",
      "Just... you just watch your back, sonny.",
      "Okay...",
    ]);
  });

  it("is deterministic and never touches the simulation RNG", () => {
    expect(rivalLine("retort", "fog", 4, 1337)).toBe(rivalLine("retort", "fog", 4, 1337));
    expect(rivalryScene("attack", "block", 2, 99))
      .toBe(rivalryScene("attack", "block", 2, 99));
    expect(RIVALRY_LINES.retort.fog).toContain(rivalLine("retort", "fog", 4, 1337));
  });

  it("does not repeat the same line or scene back to back", () => {
    const speak = createRivalVoice(79);
    const direct = createRivalDirector(79);
    for (const direction of directions) {
      for (const tactic of tactics) {
        expect(speak(direction, tactic)).not.toBe(speak(direction, tactic));
        expect(direct(direction, tactic)).not.toBe(direct(direction, tactic));
      }
    }
  });
});

/** Every scene Torvin opens (and the player closes) alternates cleanly. */
function expectWellFormed(scene: readonly { speaker: string; text: string }[]) {
  expect(scene.length).toBeGreaterThan(0);
  expect(scene.length % 2).toBe(0);                 // opens with Torvin, ends with the player
  for (let i = 0; i < scene.length; i++) {
    expect(scene[i].speaker).toBe(i % 2 === 0 ? "rival" : "you");
    expect(scene[i].text.length).toBeGreaterThan(0);
  }
}

describe("the Gold Mine warning (a young man's game)", () => {
  it("offers several different speeches, each opening on Torvin", () => {
    expect(GOLD_MINE_SCENES.length).toBeGreaterThanOrEqual(3);
    for (const scene of GOLD_MINE_SCENES) expectWellFormed(scene);
  });

  it("warns that chasing gold is a young man's game", () => {
    const all = GOLD_MINE_SCENES.flat().map((b) => b.text).join(" ");
    expect(all).toMatch(/young man's game/i);
  });

  it("points out both cons: a harder board and a coin that only buys sabotage", () => {
    const all = GOLD_MINE_SCENES.flat().map((b) => b.text).join(" ");
    // Con 1 — gold adds a sixth colour to the match-3 board (harder to match).
    expect(all).toMatch(/sixth colour|six colours|six to match/i);
    // Con 2 — gold buys nothing but Black Market sabotage aimed at the rival.
    expect(all).toMatch(/Black Market/i);
    // …and Torvin is only so honest that it's about his own plant.
    expect(all).toMatch(/my plant|my skin|neighbour|aimed at/i);
  });

  it("mentions the gold mine in every speech", () => {
    for (const scene of GOLD_MINE_SCENES) {
      expect(scene.map((b) => b.text).join(" ")).toMatch(/gold/i);
    }
  });

  it("rotates deterministically and never repeats a speech back to back", () => {
    const a = createGoldMineDirector(1337);
    const b = createGoldMineDirector(1337);
    // same seed → same sequence…
    expect(a()).toBe(b());
    // …and two depots back to back hear two different versions.
    expect(a()).not.toBe(a());
  });
});

describe("the idle wire (sayings and cringe dad jokes)", () => {
  it("has a healthy supply of short two-portrait exchanges", () => {
    expect(RIVAL_BANTER.length).toBeGreaterThanOrEqual(8);
    for (const scene of RIVAL_BANTER) {
      expectWellFormed(scene);
      // short enough to read while a lorry is still on the road
      for (const beat of scene) expect(beat.text.length).toBeLessThan(100);
    }
  });

  it("sounds like an old tycoon, not a threat", () => {
    const all = RIVAL_BANTER.flat().map((b) => b.text).join(" ");
    expect(all).toMatch(/dad joke|joke/i);
    expect(all).toMatch(/sonny|grandpa|old/i);
  });

  it("rotates deterministically and never repeats a bit back to back", () => {
    const a = createBanterDirector(7);
    const b = createBanterDirector(7);
    expect(a()).toBe(b());
    expect(a()).not.toBe(a());
  });
});
