// TUT-02 — stage How to Play shots on the Space Age UI.
//
// Run against a preview server, then commit the webps this writes.
//
//   npx vite preview --host 127.0.0.1 --port 4210
//   node tools/capture-tutorial-shots.cjs
//
// CI's preview is port 4173. Point BASE at whichever server is up:
//   BASE=http://localhost:4173/ node tools/capture-tutorial-shots.cjs
//
// Writes assets/tutorial/<name>.webp at the sizes already in the tree,
// plus rail.webp at the map-shot size (540×330). The rail.webp in the tree
// before this run is a stand-in diagram, not a staged shot. OUT overrides the folder.
// Seed 79, the new loop (no ?loop=old). The session window is #iso-session;
// a Depot's board is closed with __iso.tuningFinish(true). The live purse
// is __iso.purses[0].
const { chromium } = require("@playwright/test");
const sharp = require("sharp");
const path = require("path");

const OUT = process.env.OUT || path.join(__dirname, "..", "assets", "tutorial");
const BASE = process.env.BASE || "http://localhost:4210/";
const W = 1280;
const H = 720;
const SIZES = {
  plant: [540, 330],
  depot: [540, 330],
  roads: [540, 330],
  rail: [540, 330],
  board: [406, 586],
  expand: [640, 496],
  desk: [960, 540],
};

(async () => {
  const executablePath = process.env.PW_CHROMIUM_EXECUTABLE || undefined;
  const b = await chromium.launch({ executablePath });
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("hexmatch:onboarded", "1");
      localStorage.setItem("hexmatch:tutorial", "never");
      localStorage.setItem("hexmatch:rival-skill", "normal");
      localStorage.removeItem("hexmatch:save");
      localStorage.removeItem("hexmatch:graphics");
    } catch { /* private mode: the boot still has the URL seed */ }
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const url = BASE.replace(/\/?$/, "/") + "?seed=79";
  await p.goto(url, { waitUntil: "domcontentloaded" });
  await p.getByRole("button", { name: /^Play\b/ }).first().click({ timeout: 20000 });
  await p.getByRole("button", { name: /^Play vs AI(?! — Conquest)/ }).click({ timeout: 20000 });
  await p.waitForFunction(() => {
    const h = window.__iso;
    return !!h && h.phase === "setup-factory" && h.grid && h.grid.industries.length > 0 && !h.loading;
  }, null, { timeout: 60000 });
  const art = await p.waitForFunction(
    () => window.__iso.artLoad && window.__iso.artLoad.ready, null, { timeout: 40000 },
  ).then(() => true).catch(() => false);
  await p.addStyleTag({
    content: [
      "#iso-banner,.toast,.toasts,.iso-toast,#iso-rival-quip,.voice-sub,#iso-loading,",
      "#iso-objective,.modebar,#iso-skill-prompt,.coach,#iso-coach,.sr-card",
      "{display:none!important}",
    ].join(""),
  });

  const log = { art, url };
  const scr = (tx, ty) => p.evaluate(([x, y]) => window.__iso.tileScreenAt(x, y), [tx, ty]);
  async function frame(tx, ty, w, h) {
    await p.evaluate(([x, y]) => window.__iso.lookAt(x, y, 1), [tx, ty]);
    await p.waitForTimeout(280);
    const [sx, sy] = await scr(tx, ty);
    return {
      x: Math.max(0, Math.min(W - w, Math.round(sx - w / 2))),
      y: Math.max(0, Math.min(H - h, Math.round(sy - h / 2))),
      width: w,
      height: h,
    };
  }
  const hover = async (tx, ty) => {
    const [sx, sy] = await scr(tx, ty);
    await p.mouse.move(Math.max(2, sx - 4), Math.max(2, sy - 4));
    await p.mouse.move(sx, sy, { steps: 4 });
    await p.waitForTimeout(500);
  };
  async function save(name, clip) {
    const [w, h] = SIZES[name];
    const buf = clip
      ? await p.screenshot({ clip, type: "png" })
      : await p.screenshot({ type: "png" });
    await sharp(buf).resize(w, h, { fit: "cover", position: "centre" }).webp({ quality: 82 })
      .toFile(path.join(OUT, `${name}.webp`));
  }

  // A city and a Depot close enough to share one frame, ordinary cargo only.
  const pairs = await p.evaluate(() => {
    const iso = window.__iso;
    const g = iso.grid;
    const depots = [];
    for (const ind of g.industries) {
      if (ind.type === "gold_mine") continue;
      for (let y = ind.ty - 3; y <= ind.ty + ind.h + 2; y++) {
        for (let x = ind.tx - 3; x <= ind.tx + ind.w + 2; x++) {
          const pl = iso.placementPlan("depot", x, y);
          if (pl.valid && pl.served.length && pl.served.every((s) => s.type !== "gold_mine")) {
            depots.push({ x, y, served: pl.served.map((s) => s.type) });
          }
        }
      }
    }
    const facs = [];
    for (const t of g.towns) {
      for (let dy = -14; dy <= 14; dy++) {
        for (let dx = -14; dx <= 14; dx++) {
          const x = t.tx + dx;
          const y = t.ty + dy;
          if (iso.placementPlan("factory", x, y).valid) facs.push({ x, y, town: t.id });
        }
      }
    }
    const out = [];
    for (const f of facs) {
      for (const d of depots) {
        const dist = Math.max(Math.abs(f.x + 1 - d.x), Math.abs(f.y + 1 - d.y));
        if (dist >= 4 && dist <= 9) out.push({ f, d, dist });
      }
    }
    out.sort((a, b) => a.dist - b.dist);
    return { n: out.length, depots: depots.length, facs: facs.length, top: out.slice(0, 40) };
  });
  log.candidates = { pairs: pairs.n, depots: pairs.depots, factories: pairs.facs };
  if (!pairs.top.length) throw new Error("no candidate pairs " + JSON.stringify(log));
  const site = pairs.top[0].f;
  const dep = pairs.top[0].d;
  log.site = site;
  log.depotPlan = dep;

  // 1. CITY — the plant tool is already in hand during setup.
  await frame(site.x, site.y, 540, 330);
  await hover(site.x, site.y);
  await save("plant", await frame(site.x, site.y, 540, 330));

  // 2. DEPOT — place the city, then preview the lot against the industry.
  log.factory = await p.evaluate(([x, y]) => window.__iso.placeFactory(x, y), [site.x, site.y]);
  await p.waitForTimeout(400);
  await frame(dep.x, dep.y, 540, 330);
  await hover(dep.x, dep.y);
  await save("depot", await frame(dep.x, dep.y, 540, 330));

  // 3. BOARD — placing the Depot opens the session window. Shoot that, then close it.
  log.placedDepot = await p.evaluate(([x, y]) => window.__iso.placeDepot(x, y), [dep.x, dep.y]);
  await p.waitForFunction(() => {
    const s = document.querySelector("#iso-session");
    return !!s && !s.classList.contains("hidden") && !!s.querySelector(".gem");
  }, null, { timeout: 8000 });
  await p.waitForTimeout(400);
  const session = await p.locator("#iso-session .session-frame").boundingBox()
    || await p.locator("#iso-session").boundingBox();
  if (!session) throw new Error("session window has no box");
  await save("board", {
    x: Math.max(0, session.x),
    y: Math.max(0, session.y),
    width: Math.min(session.width, W - session.x),
    height: Math.min(session.height, H - session.y),
  });
  await p.evaluate(() => window.__iso.tuningFinish(true));
  await p.waitForFunction(() => {
    const s = document.querySelector("#iso-session");
    return !s || s.classList.contains("hidden");
  }, null, { timeout: 5000 });

  // 4. ROADS — the clock only runs in play, and a drag is refused before that.
  await p.evaluate(() => window.__iso.finishSetup());
  await p.waitForTimeout(300);
  log.road = await p.evaluate(([dx0, dy0, fx, fy]) => {
    const iso = window.__iso;
    const N = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const starts = N.map(([a, c]) => [dx0 + a, dy0 + c]);
    const ends = [];
    for (let y = fy - 1; y <= fy + 3; y++) for (let x = fx - 1; x <= fx + 3; x++) ends.push([x, y]);
    const cands = [];
    for (const [ax, ay] of starts) {
      for (const [bx, by] of ends) {
        for (const xf of [true, false]) {
          const pv = iso.dragPreview("dirt", ax, ay, bx, by, xf);
          if (pv && pv.tiles && pv.tiles.length) cands.push({ ax, ay, bx, by, xf, n: pv.tiles.length });
        }
      }
    }
    cands.sort((a, c) => a.n - c.n);
    for (const c of cands) {
      iso.dragBuild("dirt", c.ax, c.ay, c.bx, c.by, c.xf);
      const route = iso.routeForDepot(dx0, dy0);
      if (route && route.length) return { ...c, route };
    }
    return { fail: true, cands: cands.length };
  }, [dep.x, dep.y, site.x, site.y]);
  const route = log.road.route || [[dep.x, dep.y], [site.x, site.y]];
  const mid = route[Math.floor(route.length / 2)];
  for (let i = 0; i < 8; i++) {
    await p.evaluate(() => window.__iso.truckTick(performance.now(), 200));
    await p.waitForTimeout(40);
  }
  await p.mouse.move(8, H - 8);
  await save("roads", await frame(mid[0], mid[1], 540, 330));
  if (log.road.route) log.road.route = log.road.route.length;

  // 5. RAIL — fund the live purse, stand a platform at a free industry, lay a short line.
  log.rail = await p.evaluate(() => {
    const iso = window.__iso;
    const bag = iso.purses[0];
    for (const k of ["grain", "wood", "stone", "ore", "oil", "gold"]) bag[k] = 500;
    const views = ["ne", "se", "sw", "nw"];
    let placed = null;
    for (const ind of iso.grid.industries) {
      if (placed) break;
      for (let dy = -4; dy <= ind.h + 4 && !placed; dy++) {
        for (let dx = -4; dx <= ind.w + 4 && !placed; dx++) {
          for (const view of views) {
            if (iso.placePlatform(ind.tx + dx, ind.ty + dy, view)) {
              placed = { x: ind.tx + dx, y: ind.ty + dy, view, type: ind.type };
              break;
            }
          }
        }
      }
    }
    if (!placed) return { fail: true };
    if (iso.tuning) iso.tuningFinish(true);
    const dirs = [[6, 0], [0, 6], [-6, 0], [0, -6], [4, 4], [-4, 4], [8, -2], [5, -3]];
    let line = null;
    for (const [dx, dy] of dirs) {
      const pv = iso.railDrag(placed.x, placed.y, placed.x + dx, placed.y + dy);
      if (pv && pv.tiles && pv.tiles.length) { line = { n: pv.tiles.length, dx, dy }; break; }
    }
    return { placed, line };
  });
  if (!log.rail || !log.rail.placed) throw new Error("no platform site " + JSON.stringify(log.rail));
  await p.mouse.move(8, H - 8);
  await save("rail", await frame(log.rail.placed.x, log.rail.placed.y, 540, 330));

  // 6. SPEND — open the Bank drawer. The purse itself is the top bar.
  await p.locator("#iso-aside-right [data-tab='bank']").click();
  await p.waitForFunction(() => document.querySelector(".ui-root")?.getAttribute("data-rail-right") === "0", null, { timeout: 4000 });
  await p.waitForTimeout(300);
  const drawer = await p.locator("#iso-aside-right").boundingBox();
  if (!drawer) throw new Error("drawer has no box");
  await save("expand", {
    x: Math.max(0, drawer.x),
    y: Math.max(0, drawer.y),
    width: Math.min(drawer.width, W - drawer.x),
    height: Math.min(drawer.height, H - drawer.y),
  });

  // 7. DESK — drawer shut, a tool's price card open, the rail and the minimap in frame.
  await p.locator("#iso-aside-right [data-tab='bank']").click();
  await p.waitForTimeout(200);
  const tool = p.locator("[data-tool='rail']").first();
  await tool.hover();
  await p.waitForTimeout(400);
  await save("desk", null);

  console.log(JSON.stringify({ ...log, errors: errs.slice(0, 4) }, null, 1));
  await b.close();
})().catch((e) => { console.error("ERR", e.stack || e.message); process.exit(1); });
