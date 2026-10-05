// TOWN-2b (#697): organic towns (the diagonal avenue through the middle) are no
// longer offered for a NEW game. Old organic saves and rooms still load as they
// were; a remembered "organic" choice on the Play screen falls back to the default.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NEW_GAME_MAP_KEY, defaultNewGameMap, loadNewGameMap } from "../../src/ui/new-game-map";
import { readTownLayout } from "../../src/net/match-settings";

const store = (v: string): Storage => {
  const m = new Map<string, string>([[NEW_GAME_MAP_KEY, v]]);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined,
    clear: () => undefined, key: () => null, length: m.size } as Storage;
};

describe("TOWN-2b: no organic choice for a new game", () => {
  it("a remembered organic choice falls back to the default layout", () => {
    expect(loadNewGameMap(store(JSON.stringify({ size: "large", layout: "organic" }))).layout)
      .toBe(defaultNewGameMap().layout);
    expect(loadNewGameMap(store(JSON.stringify({ size: "large", layout: "grid" }))).layout).toBe("grid");
  });

  it("old records still read organic, so saves and rooms keep their towns", () => {
    expect(readTownLayout("organic")).toBe("organic");
  });

  it("neither picker offers organic", () => {
    for (const f of ["src/ui/NewGameSettingsPage.tsx", "src/ui/StartScreen.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/organic: "winding lanes"/);
    }
  });
});
