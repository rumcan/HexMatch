import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// @ts-expect-error Importable Node CLI helper (plain JS).
import { isCli } from "../../tools/is-cli.mjs";

// These same cases run on Windows CI with native backslash paths, including
// spaces and URL-escaped characters. No CLI (and no art generator) is invoked.
describe("#458 import-safe CLI entry checks", () => {
  it("recognises absolute and relative native entry paths", () => {
    const entry = resolve("tools/a folder #1/fixture.mjs");
    const url = pathToFileURL(entry).href;
    expect(isCli(url, entry)).toBe(true);
    expect(isCli(url, "tools/a folder #1/fixture.mjs")).toBe(true);
  });
  it("does not run on import, absent argv, or a same-named file elsewhere", () => {
    const url = pathToFileURL(resolve("tools/fixture.mjs")).href;
    expect(isCli(url, "")).toBe(false);
    expect(isCli(url, "node_modules/vitest/vitest.mjs")).toBe(false);
    expect(isCli(url, "elsewhere/fixture.mjs")).toBe(false);
  });
});
