// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { MP_PIN, lockMultiplayer, multiplayerVisible, tryMultiplayerPin, unlockFromUrl } from "../../src/ui/mp-gate";

// Owner (2026-09-29): Multiplayer hides behind a PIN until this device unlocks it.
describe("mp-gate", () => {
  beforeEach(() => lockMultiplayer());

  it("starts hidden", () => {
    expect(multiplayerVisible()).toBe(false);
  });
  it("a wrong PIN keeps it hidden; the right one unlocks and persists", () => {
    expect(tryMultiplayerPin("0000")).toBe(false);
    expect(tryMultiplayerPin(null)).toBe(false);
    expect(multiplayerVisible()).toBe(false);
    expect(tryMultiplayerPin(` ${MP_PIN} `)).toBe(true);
    expect(multiplayerVisible()).toBe(true);
    expect(localStorage.getItem("hexmatch:mp-unlocked")).toBe("1");
  });
  it("?mp=<pin> unlocks; any other ?mp does not", () => {
    expect(unlockFromUrl("?mp=nope")).toBe(false);
    expect(multiplayerVisible()).toBe(false);
    expect(unlockFromUrl(`?seed=1&mp=${MP_PIN}`)).toBe(true);
    expect(multiplayerVisible()).toBe(true);
  });
  it("lock hides it again", () => {
    tryMultiplayerPin(MP_PIN);
    lockMultiplayer();
    expect(multiplayerVisible()).toBe(false);
  });
});
