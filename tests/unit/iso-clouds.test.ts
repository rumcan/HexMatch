// @vitest-environment jsdom
// ══════════════════════════════════════════════════════════════════════════
// AMB-1 (#390) — drifting clouds when zoomed out.
//
//   • the sky is a pure function of (map seed, timeMs): same seed + time is
//     the same sky, on host and guest, in every session;
//   • the zoom fade is full at 0.5, ~40% at 1, gone at 2;
//   • clouds wrap around the map bounds instead of drifting off forever;
//   • the renderer paints at most a handful of sprites, paints nothing when
//     the setting is off / zoomed in / in performance mode, freezes the sky
//     under reduced motion, and never lets a cloud near `pick`;
//   • the "Clouds" switch lives in the graphics store (default on, persisted,
//     suppressed by performance mode) and on the settings sheet.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { Atlas, type Manifest } from "../../src/iso/atlas";
import {
  CLOUD_ALPHA_MAX, CLOUD_COUNT, CLOUD_SHADOW_ALPHA, CLOUD_SHADOW_DX, CLOUD_SHADOW_DY,
  CLOUD_SPRITE_H, CLOUD_SPRITE_W, CLOUD_VARIANTS,
  cloudAlphaForZoom, cloudPositions, createCloudField, paintCloudLayer,
  writeCloudPositions, type CloudSprites,
} from "../../src/iso/clouds";
import { IsoRenderer, type World } from "../../src/iso/renderer";
import { createCamera, centerOnMap } from "../../src/iso/camera";
import { MAP_W, MAP_H } from "../../src/game/config";
import { generateMap } from "../../src/iso/grid";
import {
  DEFAULT_SETTINGS, GRAPHICS_STORAGE_KEY,
  currentGraphics, parseSettings, renderPolicy, resetGraphicsForTests,
  setGraphics, subscribeGraphics, urlOverrides,
} from "../../src/iso/graphics";
import { showSettingsSheet } from "../../src/iso/settings-sheet";

// The structures pass is incidental here (the pick test boots it); shadows
// out, exactly like the renderer-cache suite.
vi.mock("../../src/iso/building-shadow", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/iso/building-shadow")>(),
  paintBuildingShadows: () => 0,
}));

const manifest: Manifest = JSON.parse(
  readFileSync("assets/iso-atlas/manifest.json", "utf8"),
);

// ── deterministic sky ───────────────────────────────────────────────────────

describe("AMB-1 deterministic sky", () => {
  it("is a pure function of (seed, time): same inputs, same sky", () => {
    const a = createCloudField(1234);
    const b = createCloudField(1234);
    expect(b).toEqual(a);
    expect(cloudPositions(a, 60_000)).toEqual(cloudPositions(b, 60_000));
    // …and the same instant twice is the same sky (no hidden clock)
    expect(cloudPositions(a, 60_000)).toEqual(cloudPositions(a, 60_000));
  });

  it("differs per map seed (wind and clouds)", () => {
    const a = createCloudField(1234);
    const b = createCloudField(98765);
    expect([b.windX, b.windY, b.windSpeed]).not.toEqual([a.windX, a.windY, a.windSpeed]);
    expect(cloudPositions(b, 0)).not.toEqual(cloudPositions(a, 0));
  });

  it("drifts along the wind as time advances", () => {
    const field = createCloudField(4242);
    const p0 = cloudPositions(field, 0);
    const p1 = cloudPositions(field, 10_000);
    // 10 s at windSpeed along the unit wind vector (no wrap on this scale).
    // Precision 2: positions round-trip through a Float32Array scratch, whose
    // epsilon at map-scale magnitudes (~4e3) is ~5e-4 — far below a pixel.
    // (a cloud that crossed the wrap seam in those 10 s is compared modulo the span)
    const spanX = field.maxX - field.minX, spanY = field.maxY - field.minY;
    const near = (a: number, b: number, span: number) => {
      const d = Math.abs(a - b) % span;
      return Math.min(d, span - d) < 0.05;
    };
    for (let i = 0; i < field.clouds.length; i++) {
      expect(near(p1[i].x, p0[i].x + field.windX * field.windSpeed * 10, spanX)).toBe(true);
      expect(near(p1[i].y, p0[i].y + field.windY * field.windSpeed * 10, spanY)).toBe(true);
    }
    expect(p1).not.toEqual(p0);
  });

  it("wraps around the map bounds — never drifts off, even after hours", () => {
    const field = createCloudField(777);
    for (const t of [0, 61_000, 3_600_000, 1e9, 1e12]) {
      for (const p of cloudPositions(field, t)) {
        expect(p.x).toBeGreaterThanOrEqual(field.minX);
        expect(p.x).toBeLessThanOrEqual(field.maxX);
        expect(p.y).toBeGreaterThanOrEqual(field.minY);
        expect(p.y).toBeLessThanOrEqual(field.maxY);
      }
    }
    // negative time (a clock jump) is clamped, not wrapped into nonsense
    expect(cloudPositions(field, -5_000)).toEqual(cloudPositions(field, 0));
  });

  it("keeps every variant in range and the count under the ticket's cap", () => {
    const field = createCloudField(99);
    expect(field.clouds.length).toBe(CLOUD_COUNT);
    expect(field.clouds.length).toBeLessThanOrEqual(480); // owner: at least 8 on screen
    for (const c of field.clouds) {
      expect(c.variant).toBeGreaterThanOrEqual(0);
      expect(c.variant).toBeLessThan(CLOUD_VARIANTS);
      expect(c.w).toBeGreaterThan(0);
    }
  });

  it("writes positions into the caller's scratch (the hot path allocates nothing)", () => {
    const field = createCloudField(5);
    const scratch = new Float32Array(CLOUD_COUNT * 2);
    writeCloudPositions(field, 12345, scratch);
    const first = Array.from(scratch);
    writeCloudPositions(field, 67890, scratch);
    // same buffer, new numbers — no allocation, no stale read
    expect(scratch).toHaveLength(CLOUD_COUNT * 2);
    expect(Array.from(scratch)).not.toEqual(first);
    expect(scratch[0]).toBeCloseTo(cloudPositions(field, 67890)[0].x, 4);
  });
});

// ── zoom fade ───────────────────────────────────────────────────────────────

describe("AMB-1 zoom fade", () => {
  it("is full at 0.5 and gone from the medium zoom on (owner: far zoom only)", () => {
    expect(cloudAlphaForZoom(0.5)).toBe(1);
    expect(cloudAlphaForZoom(1)).toBe(0);
    expect(cloudAlphaForZoom(2)).toBe(0);
  });

  it("clamps outside the steps and falls monotonically between them", () => {
    expect(cloudAlphaForZoom(0.25)).toBe(1);
    expect(cloudAlphaForZoom(3)).toBe(0);
    let prev = Infinity;
    for (let z = 0.5; z <= 2.01; z += 0.05) {
      const a = cloudAlphaForZoom(z);
      expect(a).toBeLessThanOrEqual(prev);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThanOrEqual(1);
      prev = a;
    }
  });
});

// ── paint ───────────────────────────────────────────────────────────────────

const fakeSprites = (): CloudSprites => {
  const clouds = Array.from({ length: CLOUD_VARIANTS }, (_, i) => ({ tag: `cloud-${i}` }));
  const shadows = Array.from({ length: CLOUD_VARIANTS }, (_, i) => ({ tag: `shadow-${i}` }));
  return {
    clouds: clouds as unknown as CloudSprites["clouds"],
    shadows: shadows as unknown as CloudSprites["shadows"],
  };
};

/** Minimal recording context: the cloud path only draws images + alpha. */
const stubCtx = () => ({
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  fillRect: vi.fn(),
  globalAlpha: 1,
});
type StubCtx = ReturnType<typeof stubCtx>;

describe("AMB-1 paint", () => {
  it("paints every cloud when the whole sky is on screen (≤ 8 blits)", () => {
    const field = createCloudField(2026);
    const ctx = stubCtx();
    // a viewport that swallows the map diamond whole: nothing culls
    const cam = { ...centerOnMap(createCamera(12000, 8000)), zoom: 0.5 as const };
    const scratch = new Float32Array(CLOUD_COUNT * 2);
    const blits = paintCloudLayer(ctx as unknown as CanvasRenderingContext2D,
      cam, field, fakeSprites(), 1, 30_000, scratch, false);
    expect(blits).toBe(CLOUD_COUNT);
    expect(blits).toBeLessThanOrEqual(CLOUD_COUNT);
    expect(ctx.drawImage).toHaveBeenCalledTimes(CLOUD_COUNT);
    // cloud sprites, not shadow masks, sized by the zoom
    for (const call of ctx.drawImage.mock.calls) {
      expect((call[0] as { tag: string }).tag.startsWith("cloud-")).toBe(true);
      expect(call[3]).toBeGreaterThan(0);
      // ceil'd destination rect keeps the sprite's aspect (±1px rounding)
      expect(Math.abs((call[4] as number) - (call[3] as number) * (CLOUD_SPRITE_H / CLOUD_SPRITE_W)))
        .toBeLessThanOrEqual(1);
    }
    // alpha restored — the pass must not leak translucency into later passes
    expect(ctx.globalAlpha).toBe(1);
  });

  it("culls off-screen veils and draws nothing at fade 0 or without art", () => {
    const field = createCloudField(2026);
    const scratch = new Float32Array(CLOUD_COUNT * 2);
    const tiny = { ...centerOnMap(createCamera(800, 600)), zoom: 0.5 as const };
    const ctx = stubCtx();
    const some = paintCloudLayer(ctx as unknown as CanvasRenderingContext2D,
      tiny, field, fakeSprites(), 1, 0, scratch, false);
    expect(some).toBeLessThanOrEqual(CLOUD_COUNT);
    // fade 0 (the closest zoom): zero blits, context untouched
    const ctx2 = stubCtx();
    expect(paintCloudLayer(ctx2 as unknown as CanvasRenderingContext2D,
      tiny, field, fakeSprites(), 0, 0, scratch, false)).toBe(0);
    expect(ctx2.drawImage).not.toHaveBeenCalled();
    // no art (the node harness has no canvas API): zero blits, no crash
    const ctx3 = stubCtx();
    expect(paintCloudLayer(ctx3 as unknown as CanvasRenderingContext2D,
      tiny, field, null, 1, 0, scratch, false)).toBe(0);
    expect(ctx3.drawImage).not.toHaveBeenCalled();
  });

  it("offsets the shadows for the upper-left sun and keeps them faint", () => {
    const field = createCloudField(31337);
    const scratch = new Float32Array(CLOUD_COUNT * 2);
    const cam = { ...centerOnMap(createCamera(12000, 8000)), zoom: 0.5 as const };
    const sprites = fakeSprites();
    const puffCtx = stubCtx();
    paintCloudLayer(puffCtx as unknown as CanvasRenderingContext2D,
      cam, field, sprites, 1, 45_000, scratch, false);
    const shadeCtx = stubCtx();
    // record the alpha each layer paints at (calls still record on the mock)
    const alphas: number[] = [];
    for (const c of [puffCtx, shadeCtx]) {
      (c.drawImage as ReturnType<typeof vi.fn>).mockImplementation(() => {
        alphas.push(c.globalAlpha);
      });
    }
    // re-run with the spies armed (same inputs → same draws)
    puffCtx.drawImage.mockClear();
    shadeCtx.drawImage.mockClear();
    alphas.length = 0;
    paintCloudLayer(puffCtx as unknown as CanvasRenderingContext2D,
      cam, field, sprites, 1, 45_000, scratch, false);
    const puffAlpha = alphas.slice();
    alphas.length = 0;
    paintCloudLayer(shadeCtx as unknown as CanvasRenderingContext2D,
      cam, field, sprites, 1, 45_000, scratch, true);
    const shadeAlpha = alphas.slice();
    expect(shadeCtx.drawImage).toHaveBeenCalledTimes(CLOUD_COUNT);
    // Shadows sit on the GROUND (no parallax): each is its cloud's ground
    // position, lower-right by the sun offset (±1px floor). The veils ride a
    // parallax layer above, so they are not compared pixel-for-pixel here.
    const shades = shadeCtx.drawImage.mock.calls;
    const ground = cloudPositions(field, 45_000);
    for (let i = 0; i < CLOUD_COUNT; i++) {
      const w = field.clouds[i].w * cam.zoom;
      const h = (w * 144) / 256;
      expect((shades[i][0] as { tag: string }).tag.startsWith("shadow-")).toBe(true);
      expect(shades[i][1] as number)
        .toBeCloseTo(Math.floor((ground[i].x + CLOUD_SHADOW_DX) * cam.zoom + cam.x - w / 2), 0);
      expect(shades[i][2] as number)
        .toBeCloseTo(Math.floor((ground[i].y + CLOUD_SHADOW_DY) * cam.zoom + cam.y - h / 2), 0);
    }
    // the veil reads, the shadows show
    expect(puffAlpha.every((a) => a === CLOUD_ALPHA_MAX)).toBe(true);
    expect(shadeAlpha.every((a) => a === CLOUD_SHADOW_ALPHA)).toBe(true);
    expect(CLOUD_ALPHA_MAX).toBeGreaterThanOrEqual(0.25);
    expect(CLOUD_ALPHA_MAX).toBeLessThanOrEqual(0.45);
  });
});

// ── renderer plumbing ───────────────────────────────────────────────────────

function setupRenderer(seed = 1234, zoom: 0.5 | 1 | 2 = 0.5) {
  const atlas = new Atlas(JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest);
  const ctxT = stubCtx();
  const ctxS = stubCtx();
  const ctxO = stubCtx();
  const canvasFor = (c: StubCtx) => ({ getContext: () => c }) as unknown as HTMLCanvasElement;
  const world: World = {
    grid: generateMap(seed),
    roadBits: new Uint8Array(MAP_W * MAP_H),
    dirtBits: new Uint8Array(MAP_W * MAP_H),
  };
  const cam = { ...centerOnMap(createCamera(12000, 8000)), zoom };
  const renderer = new IsoRenderer(
    { terrain: canvasFor(ctxT), structures: canvasFor(ctxS), overlay: canvasFor(ctxO) },
    atlas, cam, world,
  );
  renderer.setCloudSprites(fakeSprites());
  return { renderer, atlas, world, ctxT, ctxS, ctxO };
}

describe("AMB-1 renderer plumbing", () => {
  it("derives the sky from the map seed, and re-derives it on a new map", () => {
    const { renderer, world } = setupRenderer(111);
    expect(renderer.cloudSky.seed).toBe(111);
    const before = cloudPositions(renderer.cloudSky, 10_000);
    renderer.setWorld({ ...world, grid: generateMap(222) });
    expect(renderer.cloudSky.seed).toBe(222);
    expect(cloudPositions(renderer.cloudSky, 10_000)).not.toEqual(before);
  });

  it("paints shadows then clouds over the structures at far zoom (nothing under roads)", () => {
    const { renderer, ctxO, ctxT } = setupRenderer(7, 0.5);
    renderer.drawOverlay([], 20_000);
    // owner: shadows fall on roads and towns too - both passes are above the
    // structures now (shadows first, then the veils); the ground gets none.
    expect(ctxO.drawImage).toHaveBeenCalledTimes(CLOUD_COUNT * 2);
    expect(ctxT.drawImage).not.toHaveBeenCalled();
    expect(renderer.cloudDiagnostics()).toMatchObject({
      enabled: true, motion: true, fade: 1, blits: CLOUD_COUNT, shadowBlits: CLOUD_COUNT,
    });
  });

  it("setting off → nothing drawn, on either layer", () => {
    const { renderer, ctxO, ctxT } = setupRenderer(7, 0.5);
    renderer.setCloudsEnabled(false);
    renderer.drawOverlay([], 20_000);
    (renderer as unknown as { paintCloudShadows: (t: number) => void }).paintCloudShadows(20_000);
    expect(ctxO.drawImage).not.toHaveBeenCalled();
    expect(ctxT.drawImage).not.toHaveBeenCalled();
    expect(renderer.cloudDiagnostics()).toMatchObject({ enabled: false, fade: 0, blits: 0, shadowBlits: 0 });
    // …and back on again without a re-seed (shadows + veils)
    renderer.setCloudsEnabled(true);
    renderer.drawOverlay([], 20_000);
    expect(ctxO.drawImage).toHaveBeenCalledTimes(CLOUD_COUNT * 2);
  });

  it("paints no veils at the medium or closest zoom (fade 0)", () => {
    const near = setupRenderer(7, 2);
    near.renderer.drawOverlay([], 20_000);
    expect(near.renderer.cloudDiagnostics()).toMatchObject({ fade: 0, blits: 0 });
    const mid = setupRenderer(7, 1);
    mid.renderer.drawOverlay([], 20_000);
    // no veils at medium zoom - only the ground shadows are drawn there
    expect(mid.renderer.cloudDiagnostics()).toMatchObject({ fade: 0, blits: 0 });
    expect(mid.renderer.cloudDiagnostics().shadowBlits).toBeGreaterThan(0);
  });

  it("freezes the sky when reduced motion asks (same draws at any time)", () => {
    const { renderer, ctxO } = setupRenderer(7, 0.5);
    renderer.setCloudMotion(false);
    renderer.drawOverlay([], 10_000);
    const a = ctxO.drawImage.mock.calls.map((c) => [...c]);
    ctxO.drawImage.mockClear();
    renderer.drawOverlay([], 60_000);
    const b = ctxO.drawImage.mock.calls.map((c) => [...c]);
    expect(b).toEqual(a);
    // motion back on: the sky moves again
    renderer.setCloudMotion(true);
    ctxO.drawImage.mockClear();
    renderer.drawOverlay([], 610_000);
    expect(ctxO.drawImage.mock.calls.map((c) => [...c])).not.toEqual(a);
  });

  it("reuses one scratch buffer across frames (no per-frame allocation)", () => {
    const { renderer } = setupRenderer(7, 0.5);
    const priv = renderer as unknown as { cloudScratch: Float32Array };
    const first = priv.cloudScratch;
    renderer.drawOverlay([], 1_000);
    renderer.drawOverlay([], 2_000);
    expect(priv.cloudScratch).toBe(first);
    expect(first).toHaveLength(CLOUD_COUNT * 2);
  });

  it("pick ignores the clouds: identical with the sky on or off", () => {
    const { renderer } = setupRenderer(555, 0.5);
    renderer.setRoadMode("sprites");
    renderer.setCloudsEnabled(true);
    const on = renderer.pick(6000, 4000);
    renderer.setCloudsEnabled(false);
    const off = renderer.pick(6000, 4000);
    expect([off.tx, off.ty]).toEqual([on.tx, on.ty]);
    // belt and braces: a cloud sprite can never be in the draw order —
    // clouds are painted straight onto the canvases, never placed
    renderer.setCloudsEnabled(true);
    renderer.drawOverlay([], 20_000);
    expect(renderer.drawOrder.some((p) => /cloud/i.test(p.sprite))).toBe(false);
  });
});

// ── the store ───────────────────────────────────────────────────────────────

type FakeStorage = { data: Map<string, string> };
// jsdom's own storage: the sheet tests below need the real one, so the fake
// restores it (rather than deleting the key) on the way out.
const NATIVE_STORAGE: Storage | undefined =
  (globalThis as Record<string, unknown>).localStorage as Storage | undefined;
function withStorage(fn: (st: FakeStorage) => void): void {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
  };
  (globalThis as Record<string, unknown>).localStorage = store;
  try { fn({ data }); } finally {
    (globalThis as Record<string, unknown>).localStorage = NATIVE_STORAGE;
  }
}

describe("AMB-1 Clouds setting", () => {
  afterEach(() => {
    resetGraphicsForTests();
    (globalThis as Record<string, unknown>).localStorage = NATIVE_STORAGE;
    delete (globalThis as Record<string, unknown>).location;
  });

  it("defaults ON, and an old blob without the key migrates to ON", () => {
    expect(DEFAULT_SETTINGS.clouds).toBe(true);
    const none = { quality: null, miniature: null, performance: null, clouds: null } as const;
    expect(parseSettings(null, { ...none }).clouds).toBe(true);
    expect(parseSettings(JSON.stringify({ quality: "low", miniature: true, performance: false }), { ...none }).clouds)
      .toBe(true);
    // an explicit choice still wins; garbage is ignored
    expect(parseSettings(JSON.stringify({ clouds: false }), { ...none }).clouds).toBe(false);
    expect(parseSettings(JSON.stringify({ clouds: "yes" }), { ...none }).clouds).toBe(true);
  });

  it("reads ?clouds= and ignores garbage", () => {
    expect(urlOverrides("?clouds=0")).toMatchObject({ clouds: false });
    expect(urlOverrides("?clouds=off")).toMatchObject({ clouds: false });
    expect(urlOverrides("?clouds=1")).toMatchObject({ clouds: true });
    expect(urlOverrides("?clouds=maybe")).toMatchObject({ clouds: null });
    expect(urlOverrides("?quality=low")).toMatchObject({ clouds: null });
  });

  it("the policy suppresses clouds in performance mode, like miniature", () => {
    expect(renderPolicy({ quality: "high", miniature: false, performance: false, clouds: true }).clouds).toBe(true);
    expect(renderPolicy({ quality: "high", miniature: false, performance: true, clouds: true }).clouds).toBe(false);
    expect(renderPolicy({ quality: "high", miniature: false, performance: false, clouds: false }).clouds).toBe(false);
  });

  it("persists, notifies only on change, and is remembered after a reload", () => {
    (globalThis as Record<string, unknown>).location = { search: "" };
    resetGraphicsForTests();
    withStorage(() => {
      const seen: unknown[] = [];
      const unsub = subscribeGraphics((s) => { seen.push(s); });
      expect(currentGraphics().clouds).toBe(true);
      setGraphics({ clouds: false });
      expect(seen).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem(GRAPHICS_STORAGE_KEY)!).clouds).toBe(false);
      setGraphics({ clouds: false });           // a no-op notifies nobody
      expect(seen).toHaveLength(1);
      unsub();
      // the reload: a fresh store reads the stored choice back
      resetGraphicsForTests();
      expect(currentGraphics().clouds).toBe(false);
    });
  });
});

// ── the settings sheet ──────────────────────────────────────────────────────

describe("AMB-1 Clouds switch on the settings sheet", () => {
  afterEach(() => {
    resetGraphicsForTests();
    document.body.innerHTML = "";
    localStorage.clear();
  });

  const mount = () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    return showSettingsSheet(host);
  };

  it("shows the switch ON by default and writes through the store", () => {
    const sheet = mount();
    const btn = sheet.el.querySelector("[data-gfx=\"clouds\"]") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("role")).toBe("switch");
    expect(btn.textContent).toBe("ON");
    btn.click();
    expect(btn.textContent).toBe("OFF");
    expect(JSON.parse(localStorage.getItem(GRAPHICS_STORAGE_KEY)!).clouds).toBe(false);
    expect(currentGraphics().clouds).toBe(false);
    sheet.destroy();
  });

  it("is suppressed by performance mode without losing its choice", () => {
    const sheet = mount();
    const btn = sheet.el.querySelector("[data-gfx=\"clouds\"]") as HTMLButtonElement;
    const perf = sheet.el.querySelector("[data-gfx=\"performance\"]") as HTMLButtonElement;
    const note = sheet.el.querySelector(".gfx-cloud-note") as HTMLElement;
    perf.click();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-checked")).toBe("true");   // still ON, stored
    expect(note.textContent).toBe("Unavailable while Performance mode is on.");
    perf.click();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("ON");
    sheet.destroy();
  });
});
