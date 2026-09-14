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
    // #200: full-suite load vs isolated runs — generating 144×144 maps and
    // running A* in many workers at once contends CPU and can tip the sweeps
    // over their budget even though each test passes alone. Limit the pool so
    // a full `npm test` behaves like the isolated `npx vitest run <file>`
    // runs that agents use to bisect failures. The heavy seed sweeps also live
    // in `npm run test:slow` (see package.json) for when AI/map generation is
    // touched — they stay in the default suite too, but this tuning keeps them
    // from flaking under parallelism.
    pool: "threads",
    poolOptions: {
      threads: {
        // 32 tests generating maps at once on a 2-core runner = timeouts.
        // Three threads is enough parallelism to keep the suite fast locally
        // while keeping the 40-seed sweep (~5s on a shared runner) inside its
        // 30s budget. Single-thread would be ~3× slower (~90s extra) for no
        // extra determinism once the sweep is bounded.
        maxThreads: 3,
        minThreads: 1,
      },
      forks: {
        singleFork: false,
      },
    },
  },
});
