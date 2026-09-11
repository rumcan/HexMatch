import { test, expect } from "@playwright/test";

// ══════════════════════════════════════════════════════════════════════════
// B-0 — the per-building PNG layers must SHIP in the production build.
//
// `loadBuildingLayers()` runtime-fetches `<base>assets/buildings/…`. The dev
// server resolves that off the project root, but `vite build` only ships what
// is bundled or copied — without the copy step in vite.config.ts the manifest
// 404s in preview and every building silently falls back to the shared sheet,
// making the new art invisible in production. These specs run against the
// REAL built app (vite preview), so a regression here cannot pass by accident.
// ══════════════════════════════════════════════════════════════════════════

const BUILDINGS = "/hexmatch/assets/buildings/";

test.describe("B-0 building PNG layers in the production build", () => {
  test("the buildings manifest is served from dist with an oil_rig entry", async ({ page }) => {
    const res = await page.request.get(`${BUILDINGS}manifest.json`);
    expect(res.ok(), "assets/buildings/manifest.json must be HTTP 200 in the built game").toBeTruthy();
    expect(res.headers()["content-type"]).toContain("json");
    const body = (await res.json()) as {
      sprites: Record<string, { w: number; h: number; anchor: [number, number] }>;
    };
    const oilRig = body.sprites.oil_rig;
    expect(oilRig, "oil_rig must be a shipped building layer").toBeTruthy();
    // every entry must stay well-formed for loadBuildingLayers:
    for (const [name, def] of Object.entries(body.sprites)) {
      expect(def.w, `${name} w`).toBeGreaterThan(0);
      expect(def.h, `${name} h`).toBeGreaterThan(0);
      expect(def.anchor, `${name} anchor`).toHaveLength(2);
    }
  });

  test("every manifest building ships all three zoom PNGs", async ({ page }) => {
    const body = (await (await page.request.get(`${BUILDINGS}manifest.json`)).json()) as {
      sprites: Record<string, unknown>;
    };
    const names = Object.keys(body.sprites);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      for (const z of ["0.5x", "1x", "2x"]) {
        const res = await page.request.get(`${BUILDINGS}${name}@${z}.png`);
        expect(res.ok(), `${name}@${z}.png must be HTTP 200`).toBeTruthy();
        expect(res.headers()["content-type"]).toContain("png");
      }
    }
  });

  test("the built game boots with zero [building-layers] fallback warnings", async ({ page }) => {
    const warnings: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "warning") warnings.push(msg.text());
    });
    await page.addInitScript(() => localStorage.setItem("hexmatch:rival-skill", "normal"));
    await page.goto("/hexmatch/?seed=79");
    await page.waitForFunction(() => {
      const h = (window as any).__iso;
      return !!h && h.phase === "setup-factory" && !!h.grid && h.grid.industries.length > 0;
    }, null, { timeout: 20000 });
    expect(
      warnings.filter((w) => w.includes("[building-layers]")),
      "no [building-layers] console warnings in the built game",
    ).toEqual([]);
  });
});
