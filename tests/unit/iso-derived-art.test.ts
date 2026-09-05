import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ══════════════════════════════════════════════════════════════════════════
// G9 — the committed derived art must be exactly what its generator produces.
//
// `src/iso/kenny/derived/*.png` are build outputs of
// `tools/make-derived-art.mjs`, but they are committed because the atlas
// packer reads them like any Kenney source. Two of them (`rail_0101`,
// `rail_1010`) were committed from an older revision of the script, which put
// dark rail pixels on an UNSET arm — the exact 90°-off class of bug the K2
// pixel table exists to catch — and left `main` failing 1 of 333 tests.
//
// CI already regenerates and `git diff --exit-code`s the art; this is the same
// gate runnable from `npm test`, so the drift cannot reappear silently between
// pushes. It shells out rather than importing the generator: the point is to
// test the committed artefacts against the tool a human would run.
// ══════════════════════════════════════════════════════════════════════════

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DERIVED = join(ROOT, "src/iso/kenny/derived");
const GENERATOR = join(ROOT, "tools/make-derived-art.mjs");

describe("G9 derived rail art is in sync with its generator", () => {
  it("`make-derived-art.mjs --check` finds no drift", () => {
    expect(existsSync(GENERATOR), "the generator must exist").toBe(true);
    const r = spawnSync(process.execPath, ["tools/make-derived-art.mjs", "--check"], {
      cwd: ROOT, encoding: "utf8",
    });
    const log = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    // a non-zero exit here means the committed PNGs are stale: run
    // `node tools/make-derived-art.mjs`, then commit the regenerated art.
    expect(log, `--check failed:\n${log}`).toContain("in sync");
    expect(r.status).toBe(0);
  }, 120_000);

  it("the stale rail straights are the small regenerated files, not the old 12 kB ones", () => {
    // The stale artefacts were ~12.7 kB (an older script drew a full block per
    // arm); the current generator produces ~2.3 kB. A size guard makes the
    // specific regression readable in a test name, and `--check` above is what
    // actually enforces byte identity.
    for (const name of ["rail_0101.png", "rail_1010.png"]) {
      const p = join(DERIVED, name);
      expect(existsSync(p), `${name} must be committed`).toBe(true);
      expect(readFileSync(p).length).toBeLessThan(4096);
    }
  });
});
