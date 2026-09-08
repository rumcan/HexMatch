import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // PP-13: this suite is a simulation harness, not a unit-test suite in the
    // usual sense — dozens of tests generate a 144×144 map and run A* over it,
    // and several drive the rival AI for many turns. Vitest's 5s default was
    // already marginal for them (iso-rebalance's 40-seed ore-distance sweep sat
    // at ~3s locally, ~5s on a shared runner) and the bigger towns tipped two
    // of them over in CI. 30s is ~10× the slowest test that has no budget of
    // its own; tests that legitimately need more still say so per test.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
