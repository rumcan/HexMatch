// ══════════════════════════════════════════════════════════════════════════
// #136 — `loadBuildingLayers` is an ASYNCHRONOUS, per-sprite install, and the
// contract a completeness check can rely on.
//
// The browser spec (tests/e2e/building-layers.spec.ts) used to wait for
// `Atlas.buildingImages` to be non-empty and then demand every sprite in
// assets/buildings/manifest.json. That is not a completion signal: each sprite
// installs the moment ITS OWN tier fetches resolve, so the table is part-built
// for as long as the slowest PNG takes — and it also holds scenery and vehicle
// sprites, which can make it non-empty before a single building has landed.
// Pinned here, at the loader, with the network on a leash:
//
//   1. a non-empty table mid-load is normal, and the load still completes;
//   2. one dead tier drops exactly that sprite back to the shared sheet, warns
//      `[building-layers]`, and leaves every other sprite installed;
//   3. a quality cap fetches no tier above it (GFX-01), and raising the cap
//      later fills only what is missing;
//   4. a manifest name the atlas has no sprite def for is skipped quietly —
//      the one "never installed" case that is an asset defect, not a slow load.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, loadBuildingLayers, type Manifest } from "../../src/iso/atlas";

const BUILDINGS = "assets/buildings/manifest.json";
const ATLAS = "assets/iso-atlas/manifest.json";

interface BuildingsManifest {
  sprites: Record<string, { footprint: [number, number]; anchor: [number, number]; w: number; h: number }>;
}

const buildingsManifest = (): BuildingsManifest =>
  JSON.parse(readFileSync(BUILDINGS, "utf8")) as BuildingsManifest;
const NAMES = Object.keys(buildingsManifest().sprites);

/**
 * A fresh Atlas per test: `loadBuildingLayers` MUTATES the sprite defs it
 * overrides (rect 0,0,w,h, the authoring anchor, `center`), so a shared
 * manifest would carry one test's overrides into the next.
 */
const freshAtlas = (): Atlas => new Atlas(JSON.parse(readFileSync(ATLAS, "utf8")) as Manifest);

const tiersOf = (atlas: Atlas, name: string): number[] =>
  [...(atlas.buildingImages.get(name)?.keys() ?? [])].sort((a, b) => a - b);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Which sprite a `name@tier.png` file belongs to. */
const spriteOf = (file: string): string => file.replace(/@[^@]+\.png$/, "");

interface Stub {
  /** ms a file's response is held for, by file name. */
  delay?: (file: string) => number;
  /** A non-200 status for a file, by file name. */
  fail?: (file: string) => number | undefined;
  /** Serve this instead of the committed manifest. */
  manifest?: BuildingsManifest;
}

/** Stub `fetch` + `createImageBitmap` against the committed building art. */
function stubNetwork(stub: Stub = {}): { requested: string[]; pngs: string[] } {
  const requested: string[] = [];
  const pngs: string[] = [];
  const manifest = stub.manifest ?? buildingsManifest();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    const file = url.slice(url.lastIndexOf("/") + 1);
    requested.push(file);
    if (file === "manifest.json") {
      return { ok: true, status: 200, json: async () => manifest } as unknown as Response;
    }
    pngs.push(file);
    const ms = stub.delay?.(file) ?? 0;
    if (ms > 0) await sleep(ms);
    const status = stub.fail?.(file) ?? 200;
    if (status !== 200) return { ok: false, status, blob: async () => ({}) } as unknown as Response;
    return { ok: true, status, blob: async () => ({ file }) } as unknown as Response;
  });
  vi.stubGlobal("createImageBitmap", async (blob: unknown) => ({ width: 8, height: 8, blob }));
  return { requested, pngs };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("#136 loadBuildingLayers installs per sprite, as each one's PNGs land", () => {
  it("a non-empty table mid-load is normal — and the load still completes", async () => {
    // Half the sprites answer at once, half are held 60ms: the table is
    // observably part-built while the promise is still in flight.
    stubNetwork({ delay: (f) => (spriteOf(f).length % 2 ? 60 : 0) });
    const atlas = freshAtlas();

    const loading = loadBuildingLayers(atlas, "/assets/buildings/");
    await sleep(15);
    const partBuilt = atlas.buildingImages.size;
    expect(partBuilt, "the immediate sprites should already be installed").toBeGreaterThan(0);
    expect(
      partBuilt,
      `${partBuilt}/${NAMES.length} installed mid-load: the held sprites must not be there yet —`
      + " this is the state the old browser spec read as 'loaded'",
    ).toBeLessThan(NAMES.length);

    // Settled, the table holds every manifest sprite — and nothing is left
    // half-tiered, which is what a completeness check has to be able to wait
    // for (the browser side waits on `__iso.artLoad.ready` for exactly this).
    expect(await loading, "the resolved count is the whole table").toBe(NAMES.length);
    expect([...atlas.buildingImages.keys()].sort(), "every manifest sprite installs").toEqual([...NAMES].sort());
    for (const name of NAMES) expect(tiersOf(atlas, name), `${name} tiers`).toEqual([0.5, 1, 2]);
    // The override is what makes it a building layer rather than a sheet cell.
    for (const name of NAMES) expect(atlas.get(name)?.center, `${name} centre-anchored`).toBe(true);
  });

  it("one dead tier drops that sprite to the sheet, warns, and spares the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const victim = "farm";
    stubNetwork({ fail: (f) => (f === `${victim}@1x.png` ? 404 : undefined) });
    const atlas = freshAtlas();
    const sheetDef = { ...atlas.get(victim)! };

    await loadBuildingLayers(atlas, "/assets/buildings/");

    expect(atlas.hasBuilding(victim), `${victim} must fall back, not half-install`).toBe(false);
    expect(tiersOf(atlas, victim)).toEqual([]);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes(`[building-layers] ${victim}`)),
      `the fallback must be loud: ${warn.mock.calls.map((c) => String(c[0])).join(" | ")}`,
    ).toBe(true);
    // Untouched: the shared sheet's own rect/anchor still draw it.
    expect(atlas.get(victim)).toMatchObject({ x: sheetDef.x, y: sheetDef.y, w: sheetDef.w, h: sheetDef.h });
    expect(atlas.get(victim)?.center, "a sprite on the sheet is not centre-anchored").toBeUndefined();

    const others = NAMES.filter((n) => n !== victim);
    expect(others.filter((n) => !atlas.hasBuilding(n)), "one dead file is one building's problem").toEqual([]);
    for (const name of others) expect(tiersOf(atlas, name), `${name} tiers`).toEqual([0.5, 1, 2]);
  });

  it("a quality cap fetches nothing above it, and raising it fills the gap", async () => {
    const { pngs } = stubNetwork();
    const atlas = freshAtlas();
    atlas.detailCap = 1;

    await loadBuildingLayers(atlas, "/assets/buildings/", 1);
    expect(pngs.filter((f) => f.endsWith("@2x.png")), "medium never pays for 2×").toEqual([]);
    expect(pngs.filter((f) => f.endsWith("@1x.png")).length).toBe(NAMES.length);
    for (const name of NAMES) expect(tiersOf(atlas, name), `${name} at cap 1`).toEqual([0.5, 1]);

    // GFX-01's runtime quality raise: only the missing tier is fetched, and no
    // bitmap is decoded twice.
    const before = pngs.length;
    atlas.detailCap = 2;
    await loadBuildingLayers(atlas, "/assets/buildings/", 2);
    const refill = pngs.slice(before);
    expect(refill.length, "one fetch per sprite").toBe(NAMES.length);
    expect(refill.filter((f) => !f.endsWith("@2x.png")), "the fill pass re-fetches nothing it has").toEqual([]);
    for (const name of NAMES) expect(tiersOf(atlas, name), `${name} at cap 2`).toEqual([0.5, 1, 2]);
  });

  it("a manifest name the atlas does not know is skipped quietly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const served = buildingsManifest();
    served.sprites.ghost_shed = { footprint: [1, 1], anchor: [32, 48], w: 64, h: 64 };
    const { pngs } = stubNetwork({ manifest: served });
    const atlas = freshAtlas();

    await loadBuildingLayers(atlas, "/assets/buildings/");

    // Nothing to override, so nothing is fetched and nothing is installed —
    // and it is NOT a fallback: no warning, because no art failed.
    expect(atlas.hasBuilding("ghost_shed")).toBe(false);
    expect(pngs.filter((f) => spriteOf(f) === "ghost_shed")).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0])), "an unknown sprite is not an art failure").toEqual([]);
    expect(
      NAMES.filter((n) => !atlas.hasBuilding(n)),
      "the sprites the atlas does know still all install",
    ).toEqual([]);
  });
});
