import { describe, expect, it } from "vitest";
import {
  RIVALRY_LINES, createRivalVoice, rivalLine,
  type RivalryDirection, type RivalryTactic,
} from "../../src/iso/rivalry";

const directions: RivalryDirection[] = ["retort", "attack", "thwarted"];
const tactics: RivalryTactic[] = ["bandit", "harden", "block", "fog", "protest"];

describe("the rival's Black Market voice", () => {
  it("has several brief responses for both sides of every tactic", () => {
    for (const direction of directions) {
      for (const tactic of tactics) {
        const lines = RIVALRY_LINES[direction][tactic];
        expect(lines.length, `${direction}/${tactic}`).toBeGreaterThanOrEqual(2);
        for (const line of lines) expect(line.length).toBeLessThan(100);
      }
    }
  });

  it("is deterministic and does not need the simulation RNG", () => {
    expect(rivalLine("retort", "fog", 4, 1337)).toBe(rivalLine("retort", "fog", 4, 1337));
    expect(RIVALRY_LINES.retort.fog).toContain(rivalLine("retort", "fog", 4, 1337));
  });

  it("does not repeat the same tactic line back to back", () => {
    const speak = createRivalVoice(79);
    for (const direction of directions) {
      for (const tactic of tactics) {
        const first = speak(direction, tactic);
        const second = speak(direction, tactic);
        expect(second, `${direction}/${tactic} repeated`).not.toBe(first);
      }
    }
  });
});
