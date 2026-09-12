import { describe, expect, it } from "vitest";
import {
  OIL_DRILLING_SCENE, RIVALRY_LINES, RIVALRY_SCENES,
  createRivalDirector, createRivalVoice, rivalLine, rivalryScene,
  type RivalryDirection, type RivalryTactic,
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
