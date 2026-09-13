import { describe, expect, it } from "vitest";
import { currentVersionLabel, gameVersionLabel, versionFromPath } from "../../src/ui/version";

// The main-menu footer shows the RUN.world version, read from the URL folder
// RUN serves each deploy from, plus the build's short git commit.
describe("main menu version label", () => {
  it("reads the version folder RUN.world serves the game from", () => {
    expect(versionFromPath("/1.7.0/index.html")).toBe("1.7.0");
    expect(versionFromPath("/1.12.3/")).toBe("1.12.3");
    expect(versionFromPath("/1.7.0")).toBe("1.7.0");
  });

  it("finds no version locally, or in lookalike paths", () => {
    expect(versionFromPath("/")).toBeNull();
    expect(versionFromPath("/hexmatch/")).toBeNull();
    expect(versionFromPath("/index.html")).toBeNull();
    expect(versionFromPath("/v1.7/index.html")).toBeNull();
    expect(versionFromPath("/1.7.0.1/index.html")).toBeNull();
  });

  it("labels RUN builds with the version and local builds as dev", () => {
    expect(gameVersionLabel("/1.8.0/index.html", "f0e2103")).toBe("v1.8.0 · f0e2103");
    expect(gameVersionLabel("/", "f0e2103")).toBe("dev · f0e2103");
    expect(gameVersionLabel("/1.8.0/index.html", null)).toBe("v1.8.0");
    expect(gameVersionLabel("/", null)).toBe("dev");
  });

  it("does not crash where no build id was injected (unit tests)", () => {
    expect(currentVersionLabel()).toMatch(/^(dev|v\d+\.\d+\.\d+)/);
  });
});
