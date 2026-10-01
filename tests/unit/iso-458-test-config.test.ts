import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import config from "../../vitest.config";

const root = resolve(import.meta.dirname, "../..");
const { scripts } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
// 2026-09-30 (baseline-green ticket): the whole-race / balance / calibration files moved out of the
// default gate (CI's 10-minute step timed out). `iso-471-balance-sim` keeps its own `balance` script.
const slowFiles = [
  "iso-ai-sweep", "iso-rebalance", "iso-debug", "iso-l1d-race", "battle-ai-sim",
  "iso-471-balance-smoke", "iso-471-balance-trace-smoke",
  "iso-game", "iso-vp-race", "iso-skill-calibration", "match3-balance-bot", "iso-471-balance-trace",
  "battle-balance", "iso-297-rival-pace", "iso-412-rival-smoke",
].map((name) => `tests/unit/${name}.test.ts`);
const ownScript = ["tests/unit/iso-471-balance-sim.test.ts"];

describe("#458 fast default test contract", () => {
  it("excludes every slow simulation from npm test but retains it in test:slow", () => {
    expect(scripts.test).toMatch(/^vitest run /);
    const excluded = [...scripts.test.matchAll(/--exclude\s+(\S+)/g)].map((m) => m[1]);
    expect(excluded.sort()).toEqual([...slowFiles, ...ownScript].sort());
    const selected = scripts["test:slow"].split(/\s+/).filter((arg: string) => arg.endsWith(".test.ts"));
    expect(selected.sort()).toEqual([...slowFiles].sort());
    for (const file of slowFiles) expect(readFileSync(resolve(root, file), "utf8").length).toBeGreaterThan(0);
  });

  it("keeps caches inside the worktree, outside potentially shared node_modules", () => {
    const local = relative(root, config.cacheDir!);
    expect(isAbsolute(local)).toBe(false);
    expect(local.startsWith("..")).toBe(false);
    expect(local.split(/[\\/]/)).not.toContain("node_modules");
    expect(local.split(/[\\/]/)).toEqual([".cache", "vitest"]);
  });

  it("uses Vitest 4's worker limit rather than ignored poolOptions", () => {
    expect(config.test?.maxWorkers).toBe(3);
    expect(config.test).not.toHaveProperty("poolOptions");
  });
});
