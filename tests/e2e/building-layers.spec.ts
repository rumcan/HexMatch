import { test, expect } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// ART-1950S / TICKET-B0 — the per-building PNG layers must ship in the
// PRODUCTION build.
//
// `loadBuildingLayers()` (src/iso/atlas.ts) runtime-fetches
// `${BASE_URL}assets/buildings/manifest.json`. Under `vite dev` that resolves
// off the project root, so the art "works locally" while a plain `vite build`
// shipped nothing — every layer fetch 404'd and the game silently fell back
// to the shared buildings sheet (the release bug this spec pins shut). The
// `hexmatch:building-layers` plugin in vite.config.ts now copies
// assets/buildings/** into dist/assets/buildings/, and this spec runs against
// `vite preview` of that build — a dev-server screenshot is not evidence.
// ══════════════════════════════════════════════════════════════════════════

test.describe("building PNG layers ship in the built game", () => {
  test("manifest + PNG requests return 200 and the layers install (no sheet fallback)", async ({ page }) => {
    const buildingRequests = new Map<string, number>(); // url → status
    const layerWarnings: string[] = [];
    page.on("response", (res) => {
      const url = res.url();
      if (url.includes("/assets/buildings/")) buildingRequests.set(url, res.status());
    });
    page.on("console", (msg) => {
      if (msg.text().includes("[building-layers]")) layerWarnings.push(msg.text());
    });

    await page.addInitScript(() => localStorage.setItem("hexmatch:rival-skill", "normal"));
    await page.goto("/hexmatch/?seed=79");
    // The start screen is the app's default route — the iso game only mounts
    // once a mode is chosen. "Play vs AI" boots solo play; the ?seed in the
    // URL still pins the map (resolveMapSeed reads location.search).
    await page.getByRole("button", { name: /Play vs AI/ }).click();
    await page.waitForFunction(() => {
      const h = (window as any).__iso;
      return !!h && h.phase === "setup-factory" && !!h.grid && h.grid.industries.length > 0;
    }, null, { timeout: 20000 });

    // The layers load in parallel with the first frame — wait until they land
    // (or fail the assertion below on the timeout).
    await page.waitForFunction(() => {
      const h = (window as any).__iso;
      return Array.isArray(h.buildings) && h.buildings.length > 0;
    }, null, { timeout: 20000 });

    // 1. The manifest itself resolved — the TICKET-B0 regression: with no
    //    copy step in the build this 404s (or never fires at all).
    const manifestStatus = [...buildingRequests.entries()]
      .find(([url]) => url.endsWith("assets/buildings/manifest.json"))?.[1];
    expect(manifestStatus, "assets/buildings/manifest.json must be fetched and 200 in the built app")
      .toBe(200);

    // 2. At least one per-building PNG at every zoom tier came back 200.
    for (const tier of ["@0.5x.png", "@1x.png", "@2x.png"]) {
      const png = [...buildingRequests.entries()].find(([url]) => url.includes(tier));
      expect(png, `a building PNG (${tier}) must be requested`).toBeTruthy();
      expect(png![1], `${png![0]} → HTTP ${png![1]}`).toBe(200);
    }

    // 3. The layers actually INSTALLED — a 200 alone does not prove a sprite
    //    def was overridden. EVERY manifest name must be live in the atlas.
    const { installed, manifestNames } = await page.evaluate(async () => {
      const h = (window as any).__iso;
      const m = await (await fetch("assets/buildings/manifest.json", { cache: "no-store" })).json();
      return { installed: h.buildings as string[], manifestNames: Object.keys(m.sprites as Record<string, unknown>) };
    });
    expect(installed.length, "every buildings-manifest sprite installs (no silent per-sprite fallback)").toBe(manifestNames.length);
    for (const n of manifestNames) expect(installed, `${n} must install its per-building PNG`).toContain(n);

    // 4. No silent fallback warning fired anywhere during boot.
    expect(layerWarnings, `[building-layers] fallback warnings: ${layerWarnings.join(" | ")}`).toEqual([]);
  });
});
