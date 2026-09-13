// GFX-01 — video settings: the store, the atlas detail cap, the tilt-shift
// geometry. All of this is pure enough to test without a canvas: the store
// speaks plain objects, the Atlas clamps numbers and prunes Maps, and the
// miniature band is arithmetic on 0..1 stops.
import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_SETTINGS, GRAPHICS_STORAGE_KEY, QUALITY_MAX_DETAIL,
  currentGraphics, currentDetailCap, parseQuality, parseSettings, resetGraphicsForTests,
  setGraphics, subscribeGraphics, urlOverrides,
} from "../../src/iso/graphics";
import {
  Atlas, maskFromRGBA, maskZoom, type Manifest,
} from "../../src/iso/atlas";
import { bandStops, blurRadiusFor } from "../../src/iso/miniature";

// ── the store ───────────────────────────────────────────────────────────────

type FakeStorage = { data: Map<string, string> };
function withStorage(fn: (st: FakeStorage) => void): void {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => { data.set(k, String(v)); },
    removeItem: (k: string) => { data.delete(k); },
  };
  (globalThis as Record<string, unknown>).localStorage = store;
  try { fn({ data }); } finally {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
}

describe("GFX-01 graphics store", () => {
  afterEach(() => {
    resetGraphicsForTests();
    delete (globalThis as Record<string, unknown>).localStorage;
    delete (globalThis as Record<string, unknown>).location;
  });

  it("parses quality names, rejects anything else", () => {
    expect(parseQuality("low")).toBe("low");
    expect(parseQuality("MEDIUM")).toBe("medium");
    expect(parseQuality("High")).toBe("high");
    expect(parseQuality("ultra")).toBe(null);
    expect(parseQuality(undefined)).toBe(null);
  });

  it("maps presets to the three shipped detail levels", () => {
    expect(QUALITY_MAX_DETAIL.low).toBe(0.5);
    expect(QUALITY_MAX_DETAIL.medium).toBe(1);
    expect(QUALITY_MAX_DETAIL.high).toBe(2);
  });

  it("precedence: defaults < storage < URL flags", () => {
    expect(parseSettings(null, { quality: null, miniature: null })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ quality: "low", miniature: true }),
      { quality: null, miniature: null }))
      .toEqual({ quality: "low", miniature: true });
    // a half-written blob still merges over the defaults
    expect(parseSettings(JSON.stringify({ quality: "medium" }),
      { quality: null, miniature: null }))
      .toEqual({ quality: "medium", miniature: false });
    expect(parseSettings("not json", { quality: null, miniature: null })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ quality: "low" }),
      { quality: "high", miniature: true }))
      .toEqual({ quality: "high", miniature: true });
  });

  it("reads the URL flags it documents, and ignores garbage", () => {
    expect(urlOverrides("?quality=low&miniature=1"))
      .toEqual({ quality: "low", miniature: true });
    expect(urlOverrides("?miniature=off")).toEqual({ quality: null, miniature: false });
    expect(urlOverrides("?quality=ultra&miniature=maybe"))
      .toEqual({ quality: null, miniature: null });
    expect(urlOverrides(undefined)).toEqual({ quality: null, miniature: null });
  });

  it("setGraphics persists, notifies only on change, and survives private mode", () => {
    (globalThis as Record<string, unknown>).location = { search: "" };
    resetGraphicsForTests();
    withStorage(() => {
      const seen: unknown[] = [];
      const unsub = subscribeGraphics((s) => { seen.push(s); });
      expect(currentGraphics()).toEqual(DEFAULT_SETTINGS);
      setGraphics({ quality: "medium" });
      expect(seen).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem(GRAPHICS_STORAGE_KEY)!))
        .toEqual({ quality: "medium", miniature: false });
      setGraphics({ quality: "medium" });          // a no-op notifies nobody
      expect(seen).toHaveLength(1);
      setGraphics({ miniature: true });
      expect(seen).toHaveLength(2);
      expect(currentDetailCap()).toBe(1);
      unsub();
      setGraphics({ quality: "low" });
      expect(seen).toHaveLength(2);                  // unsubscribed in time
      expect(currentDetailCap()).toBe(0.5);
    });
    // storage absent entirely: the setters still work, only persistence dies
    resetGraphicsForTests();
    (globalThis as Record<string, unknown>).localStorage = undefined;
    expect(() => { setGraphics({ quality: "low" }); }).not.toThrow();
  });

  it("a boot location flag is read once and never written back", () => {
    withStorage(() => {
      (globalThis as Record<string, unknown>).location = { search: "?quality=low&miniature=1" };
      resetGraphicsForTests();
      expect(currentGraphics()).toEqual({ quality: "low", miniature: true });
      expect(localStorage.getItem(GRAPHICS_STORAGE_KEY)).toBe(null);
    });
  });
});

// ── the atlas detail cap ────────────────────────────────────────────────────

const stubImage = (name: string) => ({ name, width: 10, height: 10 });

function makeAtlas(): Atlas {
  const manifest = {
    images: {}, tileW: 64, tileH: 32,
    sprites: { farm: { x: 4, y: 8, w: 32, h: 32, footprint: [1, 1], anchor: [16, 31] } },
  } as unknown as Manifest;
  return new Atlas(manifest, new Map([[0.5, stubImage("mono@0.5")], [1, stubImage("mono@1")]]));
}

describe("GFX-01 atlas detail cap", () => {
  it("defaults to no cap and passes every zoom through", () => {
    const a = new Atlas({ images: {}, tileW: 64, tileH: 32, sprites: {} });
    expect(a.detailCap).toBe(2);
    for (const z of [0.5, 1, 2]) expect(a.atlasZoomFor(z)).toBe(z);
  });

  it("folds camera zooms above the cap onto the loaded level", () => {
    const a = makeAtlas();
    a.detailCap = 0.5;
    expect(a.atlasZoomFor(1)).toBe(0.5);
    expect(a.atlasZoomFor(2)).toBe(0.5);
    expect(a.atlasZoomFor(0.5)).toBe(0.5);
  });

  it("imageForSprite serves the clamped sheet from every store", () => {
    const a = makeAtlas();
    a.detailCap = 1;
    // monolith
    expect(a.imageForSprite("farm", 2)).toEqual(stubImage("mono@1"));
    // buildings layer shadows the monolith at the SAME zoom, not above it
    a.layerImages.set("buildings", new Map([[1, stubImage("sheet@1")]]));
    expect(a.imageForSprite("farm", 2)).toEqual(stubImage("sheet@1"));
    // per-building PNGs win, also at the clamped zoom
    a.buildingImages.set("farm", new Map([[1, stubImage("png@1")], [0.5, stubImage("png@0.5")]]));
    expect(a.imageForSprite("farm", 2)).toEqual(stubImage("png@1"));
    a.detailCap = 0.5;
    expect(a.imageForSprite("farm", 2)).toEqual(stubImage("png@0.5"));
  });

  it("pruneDetail frees exactly the levels above the cap, in every store", () => {
    const a = makeAtlas();
    expect(a.image(1)).toBeTruthy();
    a.buildingImages.set("farm", new Map([[0.5, stubImage("p")], [1, stubImage("p")], [2, stubImage("p")]]));
    a.layerImages.set("roads", new Map([[0.5, stubImage("r")], [2, stubImage("r")]]));
    a.detailCap = 0.5;
    a.pruneDetail();
    expect([...a.images.keys()]).toEqual([0.5]);
    expect([...a.buildingImages.get("farm")!.keys()]).toEqual([0.5]);
    expect([...a.layerImages.get("roads")!.keys()]).toEqual([0.5]);
  });

  it("masks rasterise from the best zoom ≤ 1 and index in 1× coordinates", () => {
    expect(maskZoom([0.5, 1, 2])).toBe(1);     // the 1× sheet when it exists
    expect(maskZoom([0.5, 2])).toBe(0.5);      // `low`: half-res, scaled lookups
    expect(maskZoom([2])).toBe(2);
    expect(maskZoom([])).toBe(null);

    // A 2×1 half-res mask: pixel 0 opaque, pixel 1 clear.
    const a = makeAtlas();
    const m = maskFromRGBA(new Uint8Array([0, 0, 0, 255, 0, 0, 0, 0]), 2, 1, 8, 0.5);
    expect(m.scale).toBe(0.5);
    a.setMask("farm", m);
    // farm is 32×32 at 1× (one frame); a 2-wide half-res mask covers x∈[0,4).
    expect(a.opaqueAt("farm", 0.5, 0)).toBe(true);
    expect(a.opaqueAt("farm", 1.9, 0)).toBe(true);
    expect(a.opaqueAt("farm", 2.1, 0)).toBe(false);    // bit 1 of the mask is clear
    expect(a.opaqueAt("farm", 31.5, 0)).toBe(false);   // inside the sprite, outside the mask
    expect(a.opaqueAt("farm", 33, 0)).toBe(false);     // outside the SPRITE
    // a scale-1 mask indexes exactly like it did before the detail cap existed
    const m1 = maskFromRGBA(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2);
    expect(m1.scale).toBeUndefined();
    a.setMask("farm", m1);
    expect(a.opaqueAt("farm", 0, 0)).toBe(true);
    expect(a.opaqueAt("farm", 0, 1)).toBe(false);
    expect(a.opaqueAt("farm", 4, 4)).toBe(false);
  });
});

// ── the tilt-shift geometry ─────────────────────────────────────────────────

describe("GFX-01 miniature band", () => {
  it("stops are clamped to [0,1] and monotonic for the shipped preset", () => {
    const b = bandStops();
    expect(b.top0).toBeLessThanOrEqual(b.top1);
    expect(b.top1).toBeLessThanOrEqual(b.bot0);
    expect(b.bot0).toBeLessThanOrEqual(b.bot1);
    for (const v of [b.top0, b.top1, b.bot0, b.bot1]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("the sharp band straddles the viewfinder centre, biased up", () => {
    const b = bandStops(0.30, 0.20, 0.04);
    expect(b.top1).toBeCloseTo(0.46 - 0.15, 10);
    expect(b.bot0).toBeCloseTo(0.46 + 0.15, 10);
    // degenerate parameters stay legal for createLinearGradient
    const w = bandStops(2, 2, -1);
    for (const v of [w.top0, w.top1, w.bot0, w.bot1]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("blur grows with the viewport but never melts the map", () => {
    expect(blurRadiusFor(400)).toBe(2);              // floor
    expect(blurRadiusFor(1080)).toBeCloseTo(4.536, 3);
    expect(blurRadiusFor(100_000)).toBe(6.5);        // ceiling
  });
});
