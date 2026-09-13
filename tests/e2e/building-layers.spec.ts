import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bootBudget } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// ART-1950S / TICKET-B0 — the per-building PNG layers must ship in the
// PRODUCTION build.
//
// `loadBuildingLayers()` (src/iso/atlas.ts) runtime-fetches
// `${BASE_URL}assets/buildings/manifest.json`. Under `vite dev` that resolves
// off the project root, so the art "works locally" while a plain `vite build`
// shipped nothing — every layer fetch 404'd and the game silently fell back
// to the shared buildings sheet (the release bug this spec pins shut).
// The `hexmatch:building-layers` plugin in vite.config.ts now copies
// assets/buildings/** into dist/assets/buildings/, and this spec runs against
// `vite preview` of that build — a dev-server screenshot is not evidence.
//
// #136 — and the check has to WAIT for the layers instead of catching them
// mid-flight. `loadBuildingLayers` installs one sprite at a time as its own
// parallel image loads land, so "the table is non-empty" is a START signal:
// the spec used to wait for exactly that and then demand all 58 manifest
// sprites, which passed or failed on how the fetches happened to interleave
// (46 of 58 on a desktop Chromium run). Everything below therefore
//   1. waits for the boot art loads to SETTLE (`__iso.artLoad.ready`, the
//      loading screen's own completion flag) and then polls for inclusion of
//      the expected names, rather than trusting the first non-empty map;
//   2. asserts per REQUIRED NAME and per requested TIER — never against a
//      count of `__iso.buildings`, which is a deliberate superset (scenery-art
//      and vehicle-art install through the same `Atlas.buildingImages` table);
//   3. keeps every old failure mode: a 404, a request that never fired, an
//      unexpected fetch above the quality cap, a `[building-layers]` fallback
//      warning. (The loading screen lifting on its 30s backstop is reported as
//      context, not failed on: a software-rasterizing runner trips it with
//      every layer intact, and a stall that really costs a layer shows up as a
//      missing name or a boot that never settles.)
//   4. re-runs the contract with the individual PNG responses deliberately
//      staggered by up to 2.4s, and proves the map really was observed
//      non-empty-but-incomplete while it waited — asynchronous loading is not
//      a false failure;
//   5. re-runs it with ONE required PNG forced to 404 and asserts the SAME
//      predicate names that sprite, so "the check still fails for missing
//      art" is tested rather than claimed. The required set is read from the
//      manifest at run time; it is never lowered to whatever happened to
//      arrive.
// ══════════════════════════════════════════════════════════════════════════

/** The art pipeline's own declarations — the required set is READ, not typed. */
const spriteNames = (rel: string): string[] =>
  Object.keys(
    (JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")) as {
      sprites: Record<string, unknown>;
    }).sprites,
  );

/** Every sprite assets/buildings/manifest.json promises a PNG set for. */
const REQUIRED = spriteNames("../../assets/buildings/manifest.json").sort();
/**
 * The iso-atlas sprite table. `loadBuildingLayers` skips a buildings-manifest
 * name the atlas has no def for (there is nothing to override), so a name that
 * never installs has two very different causes and the failure says which.
 */
const ATLAS_SPRITES = new Set(spriteNames("../../assets/iso-atlas/manifest.json"));

/** DETAIL_ZOOMS (src/iso/atlas.ts): the three pixel tiers every art set ships. */
const TIERS = [
  { z: 0.5, suffix: "0.5x" },
  { z: 1, suffix: "1x" },
  { z: 2, suffix: "2x" },
] as const;
type Tier = (typeof TIERS)[number];
/** GFX-01: a quality cap loads these tiers and never fetches the ones above. */
const tiersUnder = (cap: number): readonly Tier[] => TIERS.filter((t) => t.z <= cap);
/** The cap each preset boots at (QUALITY_MAX_DETAIL / ZOOM_STEPS). */
const CAP_OF = { low: 0.5, medium: 1, high: 2 } as const;

// ── what the browser saw ──────────────────────────────────────────────────

/** Every response under assets/buildings/, plus the console lines that matter. */
interface AssetLog {
  /** "farm@1x.png" → each status that URL produced (a repeat is a fact). */
  statuses: Map<string, number[]>;
  /**
   * The same responses in arrival order, timed from when this spec started
   * watching — verdict context ("did the load trickle or arrive at once").
   * Not the staggered spec's proof: a page busy enough to software-rasterize
   * every frame delivers its response events in one late burst, so that spec
   * times the delay route in Node instead.
   */
  arrivals: { t: number; path: string; status: number }[];
  /** `[building-layers]` fallback warnings — a sprite that dropped to the sheet. */
  warnings: string[];
  /**
   * Context, not failure: the loading screen lifting on its 30s backstop. On a
   * software-rasterizing runner the boot art can take longer than that and
   * still land perfectly, and a stall that actually costs a layer shows up as
   * a missing name or an unsettled boot anyway — so this is reported in the
   * verdict rather than failed on.
   */
  notes: string[];
}

function watchBuildingAssets(page: Page): AssetLog {
  const t0 = Date.now();
  const log: AssetLog = { statuses: new Map(), arrivals: [], warnings: [], notes: [] };
  page.on("response", (res) => {
    const url = res.url();
    const at = url.indexOf("/assets/buildings/");
    if (at < 0) return;
    const path = url.slice(at + "/assets/buildings/".length).split(/[?#]/)[0];
    log.statuses.set(path, [...(log.statuses.get(path) ?? []), res.status()]);
    log.arrivals.push({ t: Date.now() - t0, path, status: res.status() });
  });
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[building-layers]")) log.warnings.push(text);
    else if (text.includes("[loading] lifted after")) log.notes.push(text);
  });
  return log;
}

/**
 * Copy the log BEFORE the spec's own probe fetch of the manifest lands in it:
 * `readReport` re-requests manifest.json to read what the build shipped, and
 * that request must not be mistaken for the app's boot fetch (a build that
 * copied nothing would otherwise look like a 200 the game never asked for).
 */
const freezeLog = (log: AssetLog): AssetLog => ({
  statuses: new Map([...log.statuses].map(([path, codes]) => [path, [...codes]])),
  arrivals: log.arrivals.map((a) => ({ ...a })),
  warnings: [...log.warnings],
  notes: [...log.notes],
});

/** One reading of the built app's building-layer state. */
interface LayerReport {
  /** The GFX-01 detail cap the boot loaded under, and the preset behind it. */
  cap: number | null;
  quality: string | null;
  /** The manifest the BUILT app serves — what the copy step actually shipped. */
  servedManifest: string[];
  servedManifestStatus: number;
  /** Sprite name → the zoom tiers installed for it (the superset table). */
  installed: Record<string, number[]>;
}

async function readReport(page: Page): Promise<LayerReport> {
  return page.evaluate(async () => {
    const layers = (window as unknown as {
      __iso?: { buildingLayers?: { cap: number; quality: string; tiers: Record<string, number[]> } | null };
    }).__iso?.buildingLayers ?? null;
    const res = await fetch("assets/buildings/manifest.json", { cache: "no-store" });
    const m = res.ok ? ((await res.json()) as { sprites?: Record<string, unknown> }) : null;
    return {
      cap: layers?.cap ?? null,
      quality: layers?.quality ?? null,
      servedManifest: m?.sprites ? Object.keys(m.sprites).sort() : [],
      servedManifestStatus: res.status,
      installed: layers?.tiers ?? {},
    };
  });
}

// ── boot ──────────────────────────────────────────────────────────────────

/**
 * Two bootBudget waits run in series (reach the map, then let the art settle)
 * plus a bounded completeness poll, so a test's own ceiling has to be wider
 * than a single boot. The inner waits keep the honest budgets — this only
 * stops the project's 30s from firing before them on a slow runner.
 */
const specTimeout = (): number => Math.min(240_000, bootBudget() * 2 + 30_000);

/** Walk the front door to a booted island, like iso-game.spec.ts does. */
async function bootIso(page: Page, search = "?seed=79"): Promise<void> {
  // TUT-01 / AI-02: remember both boot overlays' preferences — the difficulty
  // prompt and the starting tour — so this spec measures the built art, not
  // the onboarding cards that would otherwise cover it.
  await page.addInitScript(() => {
    localStorage.setItem("hexmatch:rival-skill", "normal");
    localStorage.setItem("hexmatch:tutorial", "never");
  });
  await page.goto(`/hexmatch/${search}`);
  // The start screen is the app's default route — the iso game only mounts
  // once a mode is chosen. "Play vs AI" boots solo play; the ?seed in the URL
  // still pins the map (resolveMapSeed reads location.search).
  await page.locator(".menu-btn.primary").click();
  await page.getByRole("button", { name: /Play vs AI/ }).click();
  await page.waitForFunction(() => {
    const h = (window as unknown as { __iso?: { phase: string; grid?: { industries: unknown[] } } }).__iso;
    return !!h && h.phase === "setup-factory" && !!h.grid && h.grid.industries.length > 0;
  }, null, { timeout: bootBudget() });
}

/**
 * #136 step 1: wait for the boot art loads to SETTLE — not for the overlay to
 * look gone (`__iso.loading` is false before `show()` mounts it and true
 * through its fade) and not for the building table to be non-empty.
 * `artLoad.ready` is the loading screen's own completion flag: every task it
 * was given, "buildings" among them, has resolved or failed. A timeout is
 * reported as the settle state that never arrived, which is the actionable
 * half of it.
 */
async function waitForArtSettled(page: Page): Promise<void> {
  const settled = await page
    .waitForFunction(() => {
      const l = (window as unknown as { __iso?: { artLoad?: { ready: boolean } } }).__iso?.artLoad;
      return !!l && l.ready === true;
    }, null, { timeout: bootBudget() })
    .then(() => true, () => false);
  if (settled) return;
  const state = await page
    .evaluate(() => (window as unknown as { __iso?: { artLoad?: unknown } }).__iso?.artLoad ?? null)
    .catch(() => null);
  expect(state, `boot art loads never settled — __iso.artLoad: ${JSON.stringify(state)}`).not.toBeNull();
  expect((state as { ready: boolean }).ready, `boot art loads never settled: ${JSON.stringify(state)}`).toBe(true);
}

/**
 * #136 step 1, second half: poll for inclusion of every required name and
 * tier. Once the loads have settled this is already true or never will be, so
 * the poll is a grace window rather than a second boot budget — but it turns a
 * future regression in the settle signal into "these names are missing" (the
 * verdict below) instead of a bare timeout.
 *
 * Driven from Node rather than `page.waitForFunction`: a boot that
 * software-rasterizes 1.4M device pixels per frame can block the page's main
 * thread for seconds at a time, which starves in-page polling (and in-page
 * `setInterval` sampling) into never running at all. One `evaluate` per
 * attempt queues behind whatever the page is doing and still lands.
 */
async function pollComplete(
  page: Page, required: string[], wantTiers: readonly Tier[], timeout: number,
): Promise<boolean> {
  const zs = wantTiers.map((t) => t.z);
  const deadline = Date.now() + timeout;
  for (;;) {
    const complete = await page.evaluate(
      ([names, want]: [string[], number[]]) => {
        const tiers = (window as unknown as {
          __iso?: { buildingLayers?: { tiers: Record<string, number[]> } | null };
        }).__iso?.buildingLayers?.tiers;
        if (!tiers) return false;
        return names.every((n) => {
          const have = tiers[n];
          return Array.isArray(have) && want.every((z) => have.includes(z));
        });
      },
      [required, zs] as [string[], number[]],
    ).catch(() => false);
    if (complete) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * One reading of how much of the required set is live, taken from Node while
 * the page boots. `table` is the whole `Atlas.buildingImages` count — the
 * number the pre-#136 spec watched — and `required` is the part of it that is
 * actually building art; the gap between the two is the superset problem.
 */
interface ProgressSample { t: number; required: number; table: number }

function watchLayerProgress(page: Page, required: string[]): {
  samples: ProgressSample[]; stop: () => Promise<void>;
} {
  const samples: ProgressSample[] = [];
  const t0 = Date.now();
  // A wall-clock fuse as well as `stop()`: if the boot it is watching throws,
  // nothing calls stop, and a loop evaluating a closed page forever would keep
  // the worker busy after the test is over.
  const deadline = t0 + 300_000;
  let running = true;
  const loop = (async () => {
    while (running && Date.now() < deadline) {
      const snap = await page.evaluate((names: string[]) => {
        const tiers = (window as unknown as {
          __iso?: { buildingLayers?: { tiers: Record<string, number[]> } | null };
        }).__iso?.buildingLayers?.tiers;
        if (!tiers) return null;
        let hit = 0;
        for (const n of names) if ((tiers[n] ?? []).length > 0) hit++;
        return { required: hit, table: Object.keys(tiers).length };
      }, required).catch(() => null);            // mid-navigation: sample lost
      if (snap) samples.push({ t: Date.now() - t0, ...snap });
      await new Promise((r) => setTimeout(r, 150));
    }
  })();
  return { samples, stop: async () => { running = false; await loop; } };
}

// ── the verdict ───────────────────────────────────────────────────────────

/** What one scenario expects the loader to have done. */
interface Expectation {
  required: string[];
  expectCap: number;
  wantTiers: readonly Tier[];
}

const notIn = (a: string[], b: string[]): string[] => a.filter((x) => !b.includes(x));

/**
 * The completeness verdict, as readable failures. EMPTY means: every required
 * sprite installed every tier its cap permits, each from a requested 200, with
 * no fallback warning and nothing unexpected fetched under assets/buildings/.
 *
 * One predicate serves the passing scenarios AND the deliberately-broken one
 * (#136 step 5): the missing-PNG spec asserts this same function names its
 * victim, so "the check still fails for a missing asset" is a tested property
 * of the check rather than a comment about it.
 */
function completenessFailures(report: LayerReport, log: AssetLog, want: Expectation): string[] {
  const out: string[] = [];

  // The build must ship the manifest the art pipeline declares. TICKET-B0's
  // own regression (nothing copied) surfaces here as "never requested".
  if (report.servedManifestStatus !== 200) {
    out.push(`assets/buildings/manifest.json → HTTP ${report.servedManifestStatus} (the built app must serve it)`);
  }
  if (!log.statuses.has("manifest.json")) {
    out.push("assets/buildings/manifest.json was never requested at boot (TICKET-B0: the build did not copy the layers)");
  }
  const shippedMissing = notIn(want.required, report.servedManifest);
  const shippedExtra = notIn(report.servedManifest, want.required);
  if (shippedMissing.length || shippedExtra.length) {
    out.push(`served manifest ≠ assets/buildings/manifest.json: missing [${shippedMissing}], unexpected [${shippedExtra}]`);
  }

  // The cap decides which tiers are even fetchable; if it is not what the
  // scenario asked for, the tier assertions below would measure nothing.
  if (report.cap !== want.expectCap) {
    out.push(`detail cap ${report.cap} (quality "${report.quality}"), expected ${want.expectCap}`);
  }

  // Per required name: installed at all, and at every tier the cap permits.
  const tierPaths = new Set<string>();
  for (const n of want.required) {
    for (const t of want.wantTiers) tierPaths.add(`${n}@${t.suffix}.png`);
    const have = report.installed[n];
    if (!have || have.length === 0) {
      const codes = TIERS.flatMap((t) => log.statuses.get(`${n}@${t.suffix}.png`) ?? []);
      const warned = log.warnings.some((w) => w.includes(`[building-layers] ${n}`));
      const why = !ATLAS_SPRITES.has(n)
        ? "assets/iso-atlas/manifest.json has no sprite def for it, so there was nothing to override"
        + " — an asset defect, not a slow load (#136)"
        : `${warned ? "it logged a fallback warning" : "no fallback warning fired"};`
        + ` its PNG requests returned [${codes.length ? codes.join(", ") : "nothing was requested"}]`;
      out.push(`${n}: NOT INSTALLED — ${why}`);
      continue;
    }
    const gaps = want.wantTiers.map((t) => t.z).filter((z) => !have.includes(z));
    if (gaps.length) out.push(`${n}: tier(s) ${gaps.join(", ")} never installed (has ${have.join(", ")})`);
    const over = have.filter((z) => z > want.expectCap);
    if (over.length) out.push(`${n}: tier(s) ${over.join(", ")} loaded above the ${want.expectCap} cap`);
  }

  // Every tier of every required sprite must have been REQUESTED, and 200.
  for (const n of want.required) {
    for (const t of want.wantTiers) {
      const codes = log.statuses.get(`${n}@${t.suffix}.png`);
      if (!codes) out.push(`${n}@${t.suffix}.png: never requested`);
      else if (codes.some((c) => c !== 200)) out.push(`${n}@${t.suffix}.png → HTTP ${codes.join(", ")}`);
    }
  }

  // Anything else under the layers directory: a non-200 is a broken asset, and
  // a 200 nobody asked for is a tier this cap must not load (a quality leak).
  for (const [path, codes] of log.statuses) {
    if (path === "manifest.json" || tierPaths.has(path)) continue;
    if (codes.some((c) => c !== 200)) out.push(`${path} → HTTP ${codes.join(", ")}`);
    else out.push(`${path}: fetched, but nothing at cap ${want.expectCap} should have requested it`);
  }

  // A silent fallback anywhere is the bug this spec exists for: it is how a
  // building ends up drawing from the shared sheet while its PNG "loaded".
  for (const w of log.warnings) out.push(`fallback warning: ${w}`);

  return out;
}

interface BootMeasurement {
  report: LayerReport;
  log: AssetLog;
  /** Every required name held every wanted tier by the end of the poll. */
  complete: boolean;
  want: Expectation;
  /** `completenessFailures` for this boot — the message behind every assert. */
  failures: string[];
}

/** Boot → settle → poll → read, the whole #136 sequence in one call. */
async function measureBoot(
  page: Page, search: string, want: Expectation, grace: number,
): Promise<BootMeasurement> {
  const live = watchBuildingAssets(page);
  await bootIso(page, search);
  await waitForArtSettled(page);
  const complete = await pollComplete(page, want.required, want.wantTiers, grace);
  const log = freezeLog(live);          // before readReport's own probe fetch
  const report = await readReport(page);
  return { report, log, complete, want, failures: completenessFailures(report, log, want) };
}

/** The verdict, worded for an assertion message. */
const verdict = (m: BootMeasurement): string => {
  const required = m.want.required.filter((n) => m.report.installed[n]?.length).length;
  const at = m.log.arrivals;
  const over = at.length ? ` over ${Math.max(...at.map((a) => a.t)) - Math.min(...at.map((a) => a.t))}ms` : "";
  const head = `${m.failures.length} building-layer failure(s)`
    + ` — cap ${m.report.cap}/${m.want.expectCap},`
    + ` ${required}/${m.want.required.length} required sprites installed`
    + ` (${Object.keys(m.report.installed).length} in the table with scenery/vehicles),`
    + ` ${m.log.statuses.size} layer URLs seen, ${at.length} responses${over}`;
  const notes = m.log.notes.length ? `\n(context) ${m.log.notes.join(" | ")}` : "";
  return `${head}:${notes}\n${m.failures.join("\n")}`;
};

// ══════════════════════════════════════════════════════════════════════════

test.describe("building PNG layers ship in the built game", () => {
  test.beforeEach(() => { test.setTimeout(specTimeout()); });

  test("every buildings-manifest sprite installs, at every tier the quality cap loads", async ({ page }) => {
    const want: Expectation = { required: REQUIRED, expectCap: CAP_OF.high, wantTiers: tiersUnder(CAP_OF.high) };
    const m = await measureBoot(page, "?seed=79", want, 15_000);

    expect(REQUIRED.length, "assets/buildings/manifest.json declares no sprites — nothing to check").toBeGreaterThan(0);
    expect(m.complete, `the required building layers never all installed after the boot loads settled — ${verdict(m)}`).toBe(true);

    // No count of `__iso.buildings` appears anywhere above, and none should:
    // #136 is the ticket about a spec that compared 58 against a table that
    // also carries scenery and vehicles, and was still mid-load when it looked.
    // The promise is per name, per tier, per response.
    expect(m.failures, verdict(m)).toEqual([]);
  });

  test("staggered PNG responses still install everything (async loading is not a failure)", async ({ page }) => {
    // Desktop-only: this pins the LOADER's timing contract, which does not
    // change with a viewport, and it holds PNG responses open for up to 2.4s
    // on top of a software-rasterized phone boot.
    test.skip(test.info().project.name !== "desktop-chromium", "loader timing contract: desktop-chromium only (#136)");
    const want: Expectation = { required: REQUIRED, expectCap: CAP_OF.high, wantTiers: tiersUnder(CAP_OF.high) };

    /**
     * A deterministic stagger derived from the sprite name: a quarter of the
     * layers land at once, the rest 0.8s / 1.6s / 2.4s later. `loadBuilding-
     * Layers` installs a sprite when ITS OWN tiers resolve, so the table is
     * provably non-empty and provably incomplete for seconds — the exact state
     * the pre-#136 spec asserted completeness on.
     */
    const delayFor = (name: string): number => {
      let h = 0;
      for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      return (h % 4) * 800;
    };
    const expectedFiles = want.required.flatMap((n) => want.wantTiers.map((t) => `${n}@${t.suffix}.png`));
    /** Each file the route held, and when it let go (Node clock, ms from t0). */
    const released: { path: string; heldMs: number; t: number }[] = [];
    const t0 = Date.now();
    await page.route(/\/assets\/buildings\/[^/?#]+@[^/?#]+\.png$/, async (route) => {
      const url = route.request().url();
      const path = url.slice(url.indexOf("/assets/buildings/") + "/assets/buildings/".length);
      const heldMs = delayFor(/([^/?#]+)@/.exec(path)?.[1] ?? "");
      if (heldMs > 0) await new Promise((r) => setTimeout(r, heldMs));
      released.push({ path, heldMs, t: Date.now() - t0 });
      await route.continue();
    });

    // Watch the installed set from Node while the page boots: the proof that
    // the load really was asynchronous has to survive a page too busy to run
    // its own timers, so the sampling lives here rather than in an init script.
    const progress = watchLayerProgress(page, REQUIRED);
    let m: BootMeasurement;
    try {
      m = await measureBoot(page, "?seed=79", want, 15_000);
    } finally {
      await progress.stop();
    }

    // (a) The stagger was real: every required file went through the delay
    //     route, and the route let them go seconds apart — some at once, the
    //     rest 0.8s / 1.6s / 2.4s later, by name. Timed on the Node clock,
    //     because a boot that software-rasterizes every frame delivers the
    //     page's response events in one late burst and would hide the spread
    //     it is being asked to prove.
    expect(
      expectedFiles.filter((f) => !released.some((r) => r.path === f)),
      "these building PNGs never reached the delay route, so this run proved nothing about them",
    ).toEqual([]);
    const spread = released.length ? Math.max(...released.map((r) => r.t)) - Math.min(...released.map((r) => r.t)) : 0;
    expect(
      spread,
      `the delay route released ${released.length} PNG responses inside ${spread}ms of each other`
      + ` (held: ${[...new Set(released.map((r) => r.heldMs))].sort((a, b) => a - b).join("/")}ms)`,
    ).toBeGreaterThanOrEqual(1_500);

    // (b) And the atlas was SEEN part-built while they landed: a non-empty
    //     buildingImages table that did not yet hold every required sprite —
    //     the observation the old spec mistook for "loaded" (its wait was
    //     `buildings.length > 0`, which scenery alone satisfies, and which the
    //     staggered building installs satisfy long before the last one lands).
    const partBuilt = progress.samples.filter((x) => x.table > 0 && x.required < REQUIRED.length);
    expect(
      partBuilt.length,
      `no part-built layer table was ever observed in ${progress.samples.length} samples`
      + ` (first: ${JSON.stringify(progress.samples.slice(0, 6))})`,
    ).toBeGreaterThan(0);
    // Context for a (c) failure: the shape of the load as it was watched.
    test.info().annotations.push({
      type: "layer progress",
      description: progress.samples.map((x) => `${x.t}ms:${x.required}/${REQUIRED.length}(table ${x.table})`).join(" "),
    });

    // (c) It all arrives anyway: waiting for the loads to settle, then polling
    //     for the names, is enough — the stagger is not a failure.
    expect(m.complete, `the staggered layers never all installed after the boot loads settled — ${verdict(m)}`).toBe(true);
    expect(m.failures, verdict(m)).toEqual([]);
  });

  test("one deliberately missing PNG is reported as a failure by the same check", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "loader failure contract: desktop-chromium only (#136)");
    // A sprite whose art exists in both manifests, so the only thing wrong
    // with it is the response this spec is about to fake.
    const victim = REQUIRED.find((n) => ATLAS_SPRITES.has(n)) ?? REQUIRED[0];
    const missingFile = `${victim}@1x.png`;
    const want: Expectation = { required: REQUIRED, expectCap: CAP_OF.high, wantTiers: tiersUnder(CAP_OF.high) };

    // ONE of the three tiers 404s. `loadBuildingLayers` fetches a sprite's
    // tiers with Promise.all, so a single dead file drops that whole building
    // back to the shared sheet — and must be loud about it.
    await page.route(`**/assets/buildings/${missingFile}`, (route) =>
      route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: `deliberately missing (#136): ${missingFile}`,
      }));

    // Settled, and genuinely incomplete: a short poll (this can never finish)
    // rather than a boot budget spent waiting on a 404.
    const m = await measureBoot(page, "?seed=79", want, 2_000);
    const { report, log } = m;

    expect(m.complete, `the 404 route did not take effect — ${missingFile} installed anyway`).toBe(false);
    expect(log.statuses.get(missingFile), `${missingFile} was never requested, so the scenario proved nothing`).toContain(404);
    expect(report.installed[victim] ?? [], `${victim} installed despite its 1× PNG being gone`).toEqual([]);
    // Everything else is unaffected: the fallback is per sprite, so one missing
    // file is one building's problem and not a boot-wide one.
    for (const n of want.required.filter((x) => x !== victim)) {
      expect(report.installed[n] ?? [], `${n} should still install while ${victim} is missing`)
        .toEqual(want.wantTiers.map((t) => t.z));
    }
    expect(
      log.warnings.some((w) => w.includes("[building-layers]") && w.includes(victim)),
      `no [building-layers] fallback warning named ${victim}: ${log.warnings.join(" | ")}`,
    ).toBe(true);

    // And the check that passes on a healthy build FAILS on this one, naming
    // the sprite — every complaint is about the victim, nothing collateral.
    expect(
      m.failures.some((f) => f.includes(`${victim}: NOT INSTALLED`)),
      `the completeness check did not flag the missing layer:\n${m.failures.join("\n")}`,
    ).toBe(true);
    expect(
      m.failures.filter((f) => !f.includes(victim)),
      `the completeness check blamed more than the missing sprite:\n${m.failures.join("\n")}`,
    ).toEqual([]);
  });

  test("a reduced quality cap loads every sprite at its own tiers only", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop-chromium", "quality-cap contract: desktop-chromium only (#136)");
    // GFX-01: `medium` never fetches @2x. A spec that demanded all three
    // suffixes from every boot would assert a tier this preset is forbidden to
    // load — so the tiers come from the cap the app reports, and the cap
    // itself is pinned.
    const want: Expectation = { required: REQUIRED, expectCap: CAP_OF.medium, wantTiers: tiersUnder(CAP_OF.medium) };
    const m = await measureBoot(page, "?seed=79&quality=medium", want, 15_000);

    expect(m.report.quality, "the ?quality=medium flag did not reach the graphics store").toBe("medium");
    expect(m.complete, `the required building layers never all installed at medium quality — ${verdict(m)}`).toBe(true);
    expect(m.failures, verdict(m)).toEqual([]);
    // The 2× art exists in dist and must stay unfetched at this preset.
    const twoX = [...m.log.statuses.keys()].filter((p) => p.endsWith("@2x.png"));
    expect(twoX, `@2x building PNGs were fetched at medium quality: ${twoX.join(", ")}`).toEqual([]);
  });
});
