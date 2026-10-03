import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Keep transformed manifests local even when worktrees share node_modules.
  cacheDir: path.resolve(__dirname, ".cache/vitest"),
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
    // 2026-09-30 (green-baseline ticket): 120 s. Booting the whole game in jsdom takes 5-15 s on a calm machine and
    // 30-90 s on a shared CI runner or a busy laptop, and the timeouts were the only red left after the stale
    // expectations were fixed.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Vitest 4 removed poolOptions; maxWorkers is the effective limit now.
    // Slow simulations live in test:slow, not the default npm test gate.
    pool: "threads",
    maxWorkers: 3,
    // Green-baseline ticket (2026-10-01): CI's unit step timed out at 10 min on main. It was NOT hung (vitest
    // exits cleanly, no open handles; 182 of 252 files had finished when the timer fired) - the suite is simply
    // heavy, and every booted game logs stack traces (the decal loader's ERR_INVALID_URL, canvas "Not
    // implemented") that vitest has to ship from the worker to the reporter: ~410k log lines, which cost ~30%
    // wall time locally (580 s noisy vs 413 s quiet). Console output is now kept only for tests that FAIL.
    silent: "passed-only",
  },
});
