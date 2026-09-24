import { test, expect } from "@playwright/test";
import { bootSoloIso, bootBudget } from "./boot";

// ══════════════════════════════════════════════════════════════════════════
// L8 (#222) — the loop made legible, in a REAL browser.
//
// The jsdom spec (tests/unit/iso-l8-legibility.test.ts) proves the rules and
// the wiring. This one proves the two things jsdom cannot: that the production
// bundle a player is handed actually paints the objective line, the per-cargo
// income readout and the Depot card, and that the optional quests are the
// compact, dismissible, ignorable thing the ticket asks for — a slim line that
// opens into 2–3 plans from different strategies, none of which gates the game.
//
// The setup steps use the game's own debug twins (`__iso.placeDepot`,
// `__iso.dragBuild`, `__iso.econTick`) because this spec is about what the HUD
// shows, not about how a click travels; the click path itself is the subject of
// iso-game.spec.ts. Every assertion below reads real DOM.
// ══════════════════════════════════════════════════════════════════════════

// The built app is served at the preview ROOT, not under a subpath: vite.config
// pins `base: "./"` so the bundle resolves beside index.html wherever RUN.world
// mounts it (…/1.18.0/index.html). The suite's older specs still prefix
// "/" — under this config those URLs hit the SPA fallback and the
// module requests 404, which is why this spec boots the root it is served from.
const BASE = "/";

test("L8: the objective line, the chip rate and the Depot card on a fresh boot", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await bootSoloIso(page, {
    url: `${BASE}?seed=1337`,
    remembered: { "hexmatch:tutorial": "never", "hexmatch:rival-skill": "normal" },
  });

  // ── the objective line: one line, on screen, naming the current goal ─────
  const objective = page.locator("#iso-objective");
  await expect(objective).toBeVisible();
  await expect(objective).toContainText(/Factory/i);
  expect(await page.evaluate(() => (window as any).__iso.objective.key)).toBe("setup-factory");

  // The setup is played out by the twin (the factory/setup click path is
  // iso-game.spec.ts's subject).
  await page.evaluate(() => (window as any).__iso.finishSetup());
  await expect.poll(() => page.evaluate(() => (window as any).__iso.objective.key))
    .not.toBe("setup-factory");

  // ── a Depot, by the game's own rules: scan for a legal catchment lot ─────
  // The scan asks the GAME: `tileProbe("dirt", …)` is the click's own legality
  // code. A Depot is a 2×2 lot that has to share an EDGE with the industry's
  // footprint, so the walk starts on the row directly below it (dy 0) and goes
  // a few rows south — the same lot the unit harness places (ind.ty + ind.h).
  const placed = await page.evaluate(() => {
    const h = (window as any).__iso;
    const W = h.grid.w, H = h.grid.h;
    for (const ind of h.grid.industries) {
      for (let dy = 0; dy <= 4; dy++) {
        for (let dx = -2; dx <= ind.w + 1; dx++) {
          const tx = ind.tx + dx, ty = ind.ty + ind.h + dy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          if (!h.tileProbe("dirt", tx, ty).harvester.ok) continue;
          if (h.placeDepot(tx, ty)) return { tx, ty };
        }
      }
    }
    return null;
  });
  expect(placed, "the map offers at least one legal Depot lot").toBeTruthy();

  // The opening Depot opens its tuning session: the objective line says so —
  // the board IS the goal while it is up.
  await expect(objective).toContainText(/Match to set your .*Depot's output/i);
  expect(await page.evaluate(() => (window as any).__iso.objective.key)).toBe("tuning-depot");

  // Finish the session (the plate's own Finish, through the twin the unit
  // harness uses), and the line moves to the missing half of the connection.
  await page.evaluate(() => (window as any).__iso.tuningFinish(false));
  await expect(objective).toContainText(/road/i);
  expect(await page.evaluate(() => (window as any).__iso.objective.key)).toBe("need-road");

  // ── the connection: a Factory at the far end, free gravel between ───────
  const joined = await page.evaluate(() => {
    const h = (window as any).__iso;
    const me = h.players.find((p: any) => p.id === "you");
    const d = h.eco.harvesters.find((x: any) => x.owner === "you");
    if (!d) return null;
    // PP-15: the Factory stands off the drag column.
    h.eco.factories.push({ owner: "you", ownerId: me.i + 1, tx: d.tx, ty: d.ty + 6, id: 0, townId: null });
    const built = h.dragBuild("dirt", d.tx, d.ty + 1, d.tx, d.ty + 6);
    return { built, tx: d.tx, ty: d.ty };
  });
  expect(joined, "a Depot and a Factory are on the map").toBeTruthy();

  // The line moves on to whatever the loop wants next — and it is never
  // empty while the match runs.
  await expect.poll(() => page.evaluate(() => (window as any).__iso.objective.text))
    .not.toMatch(/road/i);
  expect(await page.evaluate(() => (window as any).__iso.objective.text)).toBeTruthy();

  // ── the income readout: per second, per resource, on the chip itself ────
  await expect.poll(async () => page.evaluate(() => {
    const rates = (window as any).__iso.incomeRates as Record<string, number>;
    return Object.keys(rates).length;
  })).toBeGreaterThan(0);

  const readout = await page.evaluate(() => {
    const h = (window as any).__iso;
    const rates = h.incomeRates as Record<string, number>;
    const cargo = Object.keys(rates)[0];
    const chip = [...document.querySelectorAll(".chip")].find((c) =>
      c.querySelector("img.cargo-ic")?.getAttribute("alt") ===
      ({ wood: "Wood", stone: "Stone", grain: "Grain", ore: "Ore", oil: "Oil", gold: "Gold" } as any)[cargo]);
    const el = chip?.querySelector(".chip-r") as HTMLElement | undefined;
    return { cargo, rate: rates[cargo], chipText: el && !el.classList.contains("hidden") ? el.textContent : null };
  });
  expect(readout.cargo, "a connected, tuned Depot earns").toBeTruthy();
  expect(readout.rate).toBeGreaterThan(0);
  expect(readout.chipText, "the chip carries the rate").toMatch(/^\+\d/);
  expect(readout.chipText).toContain("/s");

  // …and the rate is not decoration: the clock banks it. Three ticks are nine
  // seconds, so the purse grows by about rate × 9 (the clock's own fractional
  // carry is at most one unit per Depot).
  const purseTotal = () => page.evaluate(() => {
    const p = (window as any).__iso.purse as Record<string, number>;
    return ["wood", "stone", "grain", "ore", "oil", "gold"]
      .reduce((n, c) => n + (p[c] ?? 0), 0);
  });
  const before = await purseTotal();
  await page.evaluate(() => {
    const h = (window as any).__iso;
    let now = performance.now();
    for (let i = 0; i < 3; i++) h.econTick(now += 10_000);
  });
  const earned = (await purseTotal()) - before;
  expect(Math.abs(earned - readout.rate * 9)).toBeLessThanOrEqual(1);

  // ── the Depot card: the factors the tick multiplies, in words ───────────
  // Pan the camera onto the Depot first — the hover only lands on a tile that
  // is actually inside the viewport (the unit harness's `centerOn` step).
  await page.evaluate(([tx, ty]) => (window as any).__iso.centerOn(tx, ty), [placed!.tx, placed!.ty]);
  await page.waitForTimeout(250);
  const [sx, sy] = await page.evaluate(([tx, ty]) => (window as any).__iso.tileScreenAt(tx, ty),
    [placed!.tx, placed!.ty]);
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  await page.mouse.move(sx / dpr, sy / dpr);
  const inspect = page.locator(".iso-inspect");
  await expect(inspect).toBeVisible();
  await expect(inspect).toContainText(/yield: ×[\d.]+ · transport: \w+ ×[\d.]+/);
  await expect(inspect).toContainText(/rate: [\d.]+\/tick · [\d.]+\/s/);
  await expect(inspect).toContainText(/distance: \d+ tiles/);

  expect(errors).toEqual([]);
});

test("L8: the quests are compact, dismissible, and gate nothing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await bootSoloIso(page, {
    url: `${BASE}?seed=1337`,
    remembered: { "hexmatch:tutorial": "never", "hexmatch:rival-skill": "normal" },
  });
  await page.evaluate(() => (window as any).__iso.finishSetup());

  // ── the slim line: collapsed, it is ONE line over the map ───────────────
  const panel = page.locator("#iso-quests");
  await expect(panel).toBeVisible({ timeout: bootBudget() });
  await expect(panel.locator(".quests-head")).toContainText(/Quests/);
  await expect(panel.locator(".quests-list")).toBeHidden();

  // 2–3 offers at once, one per strategy — the ticket's number, and its point.
  const offers = await page.evaluate(() => (window as any).__iso.quests.offers);
  expect(offers.length).toBeGreaterThanOrEqual(2);
  expect(offers.length).toBeLessThanOrEqual(3);
  expect(new Set(offers.map((o: any) => o.strategy)).size).toBe(offers.length);

  // ── opening it: the offers, in the sandbox's foreman voice ─────────────
  await panel.locator(".quests-head").click();
  await expect(panel.locator(".quests-list")).toBeVisible();
  const rows = panel.locator("li.quest");
  await expect(rows).toHaveCount(offers.length);
  await expect(rows.first()).toContainText(/Foreman|boss|Depot|city|road/i);
  await expect(rows.first().locator(".q-reward")).toContainText(/\d/);

  // ── dismissing one: retired for good, and the panel does not nag back ──
  const firstId = offers[0].id;
  const before = offers.length;
  await rows.first().locator(".q-x").click();
  await expect.poll(() => page.evaluate(() => (window as any).__iso.quests.offers.length))
    .toBe(before - 1);
  expect(await page.evaluate(() => (window as any).__iso.quests.spent)).toContain(firstId);

  // ── hiding: the player's own choice, remembered, reversible ────────────
  await panel.locator(".q-hide").click();
  await expect.poll(() => page.evaluate(() => (window as any).__iso.quests.hidden)).toBe(true);
  await expect(panel).toHaveClass(/shut/);
  await panel.locator(".quests-head").click();
  await expect.poll(() => page.evaluate(() => (window as any).__iso.quests.hidden)).toBe(false);

  // ── and none of it is a gate: the ★ line, the tree and the goal are
  // untouched by anything the panel did ────────────────────────────────────
  expect(await page.evaluate(() => (window as any).__iso.vpTarget)).toBe(12);
  expect(await page.evaluate(() => (window as any).__iso.quests.paid)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__iso.objective.text)).toBeTruthy();

  expect(errors).toEqual([]);
});
