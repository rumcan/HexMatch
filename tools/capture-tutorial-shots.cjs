const { chromium } = require("@playwright/test");
const OUT = process.env.OUT, B = "http://localhost:4210/";
const W = 1280, H = 720, CX = 580, CY = 400;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(() => { try { localStorage.setItem("hexmatch:tutorial", "never"); localStorage.setItem("hexmatch:rival-skill", "normal"); localStorage.removeItem("hexmatch:save"); localStorage.removeItem("hexmatch:graphics"); } catch {} });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(B + "?seed=79");
  await p.waitForTimeout(3500);
  await p.getByRole("button", { name: /^PLAY\b/i }).first().click();
  await p.waitForTimeout(1500);
  await p.getByRole("button", { name: /Play vs AI/i }).first().click();
  await p.waitForFunction(() => window.__iso && !window.__iso.loading, null, { timeout: 40000 });
  await p.waitForTimeout(2500);
  await p.addStyleTag({ content: "#iso-banner,#rundot-game-mock-overlay,.toast,.toasts,.iso-toast{display:none!important}" });
  const scr = (tx, ty) => p.evaluate(([x, y]) => window.__iso.tileScreenAt(x, y), [tx, ty]);
  async function centerOn(tx, ty) {
    for (let i = 0; i < 6; i++) {
      const [sx, sy] = await scr(tx, ty);
      const dx = sx - CX, dy = sy - CY;
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      await p.mouse.move(CX, CY);
      await p.mouse.down({ button: "middle" });
      await p.mouse.move(CX - dx, CY - dy, { steps: 12 });
      await p.mouse.up({ button: "middle" });
      await p.waitForTimeout(250);
    }
  }
  const hover = async (tx, ty) => { const [sx, sy] = await scr(tx, ty); await p.mouse.move(sx - 3, sy - 3); await p.mouse.move(sx, sy, { steps: 3 }); await p.waitForTimeout(700); };
  const shot = (name, clip) => p.screenshot({ path: `${OUT}/${name}.png`, clip });
  const MAPCLIP = { x: CX - 270, y: CY - 175, width: 540, height: 330 };
  const log = {};

  // Candidate (factory, depot) pairs: the depot serves only ordinary cargo.
  const pairs = await p.evaluate(() => {
    const iso = window.__iso, g = iso.grid;
    const depots = [];
    for (const ind of g.industries) {
      if (ind.type === "gold_mine") continue;
      for (let y = ind.ty - 4; y <= ind.ty + ind.h + 3; y++) for (let x = ind.tx - 4; x <= ind.tx + ind.w + 3; x++) {
        const pl = iso.placementPlan("depot", x, y);
        if (pl.valid && pl.served.length && pl.served.every((s) => s.type !== "gold_mine")) depots.push({ x, y, served: pl.served.map((s) => s.type) });
      }
    }
    const facs = [];
    for (const t of g.towns) for (let dy = -14; dy <= 14; dy++) for (let dx = -14; dx <= 14; dx++) {
      const x = t.tx + dx, y = t.ty + dy;
      if (iso.placementPlan("factory", x, y).valid) facs.push({ x, y, town: t.id });
    }
    const out = [];
    for (const f of facs) for (const d of depots) {
      const dist = Math.max(Math.abs(f.x + 1 - d.x), Math.abs(f.y + 1 - d.y));
      if (dist >= 4 && dist <= 9) out.push({ f, d, dist });
    }
    out.sort((a, b) => a.dist - b.dist);
    return { n: out.length, depots: depots.length, facs: facs.length, top: out.slice(0, 60) };
  });
  log.candidates = { pairs: pairs.n, depots: pairs.depots, factories: pairs.facs };
  if (!pairs.top.length) throw new Error("no candidate pairs " + JSON.stringify(log));
  const pick = pairs.top[0];
  const site = pick.f, dep = pick.d;
  log.site = site; log.depotPlan = dep; log.dist = pick.dist;

  // 1. PLANT
  await centerOn(site.x, site.y);
  await hover(site.x, site.y);
  await shot("plant", MAPCLIP);

  // 2. DEPOT
  log.factory = await p.evaluate(([x, y]) => window.__iso.placeFactory(x, y), [site.x, site.y]);
  await p.waitForTimeout(800);
  log.depotStillValid = await p.evaluate(([x, y]) => window.__iso.placementPlan("depot", x, y).valid, [dep.x, dep.y]);
  await centerOn(Math.round((dep.x + site.x + 1) / 2), Math.round((dep.y + site.y + 1) / 2));
  await hover(dep.x, dep.y);
  await shot("depot", MAPCLIP);

  // 3. ROADS
  log.placedDepot = await p.evaluate(([x, y]) => window.__iso.placeDepot(x, y), [dep.x, dep.y]);
  await p.evaluate(() => window.__iso.finishSetup());
  await p.waitForTimeout(500);
  log.road = await p.evaluate(([dx0, dy0, fx, fy]) => {
    const iso = window.__iso; const N = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const starts = N.map(([a, c]) => [dx0 + a, dy0 + c]);
    const ends = [];
    for (let y = fy - 1; y <= fy + 3; y++) for (let x = fx - 1; x <= fx + 3; x++) ends.push([x, y]);
    const cands = [];
    for (const [ax, ay] of starts) for (const [bx, by] of ends) for (const xf of [true, false]) {
      const pv = iso.dragPreview("dirt", ax, ay, bx, by, xf);
      if (pv && pv.tiles && pv.tiles.length) cands.push({ ax, ay, bx, by, xf, n: pv.tiles.length });
    }
    cands.sort((a, b) => a.n - b.n);
    for (const c of cands) {
      iso.dragBuild("dirt", c.ax, c.ay, c.bx, c.by, c.xf);
      const route = iso.routeForDepot(dx0, dy0);
      if (route && route.length) return { ...c, route };
    }
    return { fail: true, cands: cands.length };
  }, [dep.x, dep.y, site.x, site.y]);
  await p.waitForTimeout(800);
  const route = log.road.route || [[dep.x, dep.y], [site.x, site.y]];
  const mid = route[Math.floor(route.length / 2)];
  await centerOn(mid[0], mid[1]);
  for (let i = 0; i < 12; i++) {
    await p.evaluate(() => window.__iso.truckTick(performance.now(), 200));
    await p.waitForTimeout(80);
  }
  await p.mouse.move(5, H - 5);
  await p.waitForTimeout(700);
  log.trucks = await p.evaluate(() => window.__iso.trucksList.length);
  if (log.road.route) log.road.route = log.road.route.length;
  await shot("roads", MAPCLIP);

  // 4. BOARD: deliveries until tokens stand on the board
  let tokens = 0;
  for (let i = 0; i < 60 && tokens < 4; i++) {
    await p.evaluate(() => { const iso = window.__iso; const t = performance.now(); iso.truckTick(t, 3000); iso.refreshQuarry(t); iso.econTick(t + 5000); iso.tick(t); });
    await p.waitForTimeout(120);
    tokens = await p.evaluate(() => window.__iso.board.gems().filter((g) => g && g.tier > 0).length);
  }
  log.tokens = tokens;
  log.reach = await p.evaluate(() => window.__iso.reach);
  await p.waitForTimeout(900);
  const q = await p.locator("#iso-quarry").boundingBox();
  await shot("board", { x: q.x - 4, y: q.y - 4, width: q.width + 8, height: Math.min(q.height + 8, H - q.y) });

  // 5. SPEND: Bank tab + purse
  const bank = p.locator(".tab", { hasText: /bank/i }).first();
  if (await bank.count()) { await bank.click(); await p.waitForTimeout(700); }
  const res = await p.locator("#iso-res").boundingBox();
  const trade = await p.locator("#iso-trade").boundingBox();
  const x0 = Math.floor(res.x - 8), y0 = Math.floor(trade.y - 6);
  await shot("expand", { x: x0, y: y0, width: Math.ceil(trade.x + trade.width + 6 - x0), height: Math.ceil(res.y + res.height + 6 - y0) });

  // 6. DESK
  const plantTab = p.locator(".tab", { hasText: /processing/i }).first();
  if (await plantTab.count()) { await plantTab.click(); await p.waitForTimeout(600); }
  await centerOn(mid[0], mid[1]);
  await p.mouse.move(5, H - 5);
  await p.waitForTimeout(700);
  await shot("desk", { x: 0, y: 0, width: W, height: H });

  console.log(JSON.stringify({ ...log, errors: errs.slice(0, 3) }, null, 1));
  await b.close();
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
