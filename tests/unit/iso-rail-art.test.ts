// ══════════════════════════════════════════════════════════════════════════
// RAIL-03 (#177) — the railway art contract: names, files, and the loader.
//
// The epic's acceptance is specific: every required sprite name must be present
// after the load completes, every direction at every tier, with the geometry the
// atlas needs. This suite pins all three layers of that promise without a
// browser:
//
//   1. the manifest lists exactly the required names, with footprints, anchors
//      and the moving flag the two renderer placement branches read;
//   2. every name has its three PNG files on disk (@0.5x, @1x, @2x), authored at
//      2× and derived down (the 2× master is the widest);
//   3. `loadRailwaySprites` installs all of them into a fake atlas when the
//      bitmaps can be created, writes NO `center` flag, and — the non-gating
//      part — installs nothing (and throws nothing) when the art is unreadable.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadRailwaySprites, RAILWAY_SPRITE_NAMES } from "../../src/iso/rail-art";
import {
  DEPOT_FOOTPRINT, COUPLE_GAP, LOCO_LEN, WAGON_LEN, WAGON_OFFSET, RAIL_VIEWS,
} from "../../src/iso/rail";
import {
  ALL_SPRITE_NAMES, PALETTE, PLATFORM_FOOTPRINT, SPRITE_KINDS, VIEWS, footprintFor,
} from "../../tools/make-railway-art.mjs";
import type { Atlas } from "../../src/iso/atlas";

const ROOT = resolve(__dirname, "../..");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "assets/railway/manifest.json"), "utf8")) as {
  tileW: number; tileH: number; zooms: number[];
  generatedBy: string; license: string;
  meta: { note: string; palette: Record<string, string> };
  sprites: Record<string, {
    name: string; kind: string; view: string; w: number; h: number;
    anchor: [number, number]; footprint: [number, number]; moving: boolean;
    box2x: [number, number]; alpha: { coverage: number; corners: number[] };
    lenTiles?: number; widthTiles?: number; coupler?: { front: number; rear: number };
  }>;
};

/** A `#rrggbb` colour's channels, and how far they are from neutral. */
const channels = (hex: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
const chroma = (hex: string): number => Math.max(...channels(hex)) - Math.min(...channels(hex));
const spriteFiles = ALL_SPRITE_NAMES as string[];

/** A stand-in for the real atlas: the loader only reads these three fields. */
function fakeAtlas(cap = 2): Atlas {
  return {
    buildingImages: new Map(),
    manifest: { sprites: {} },
    detailCap: cap,
  } as unknown as Atlas;
}

/** Bitmap plumbing the loader needs — browsers have both, Node does not. */
function stubBitmaps(ok = true) {
  vi.stubGlobal("fetch", async (url: string) => ({
    ok,
    status: ok ? 200 : 404,
    blob: async () => ({ url }),
  }));
  vi.stubGlobal("createImageBitmap", async (b: { url: string }) => ({
    width: b.url.includes("@2x") ? 128 : b.url.includes("@1x") ? 64 : 32,
    height: 64,
    url: b.url,
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("RAIL-03 the art set is complete and self-consistent", () => {
  it("ships every required sprite name, direction and family", () => {
    expect(RAILWAY_SPRITE_NAMES).toEqual([...spriteFiles].sort());
    expect(RAILWAY_SPRITE_NAMES).toHaveLength(SPRITE_KINDS.length * VIEWS.length);
    for (const kind of SPRITE_KINDS) {
      for (const view of VIEWS) {
        const name = kind === "train-depot" ? `train-depot_${view}` : `${kind}_${view}`;
        expect(RAILWAY_SPRITE_NAMES).toContain(name);
      }
    }
  });

  it("gives every sprite its footprint, anchor and moving flag", () => {
    for (const name of spriteFiles) {
      const s = manifest.sprites[name];
      expect(s, name).toBeTruthy();
      const kind = s.kind as never;
      const view = s.view as never;
      expect(s.footprint).toEqual(footprintFor(kind, view));
      if (kind === "platform") expect(s.footprint).toEqual(PLATFORM_FOOTPRINT[view]);
      // …and the depot's, against the RULES' own constant rather than the art's.
      if (kind === "train-depot") expect(s.footprint).toEqual(DEPOT_FOOTPRINT);
      // The anchor is inside the sprite's own box, and the alpha metadata says
      // the art is transparent — the epic's "explicit metadata" clause.
      expect(s.anchor[0]).toBeGreaterThanOrEqual(0);
      expect(s.anchor[1]).toBeGreaterThanOrEqual(0);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
      expect(s.alpha.coverage).toBeGreaterThan(0);
      expect(s.alpha.coverage).toBeLessThan(1);
      expect(s.alpha.corners).toEqual([0, 0, 0, 0]);
      expect(s.moving).toBe(kind === "locomotive" || kind === "wagon");
    }
    // The two moving families carry the length/width a wagon's trail needs.
    expect(manifest.sprites.locomotive_se.lenTiles).toBeGreaterThan(1);
    expect(manifest.sprites.wagon_se.lenTiles).toBeLessThan(manifest.sprites.locomotive_se.lenTiles!);
    expect(manifest.sprites.locomotive_se.widthTiles).toBeLessThan(1);
  });

  it("has all 48 PNGs on disk, at the three tiers the manifest geometry names", () => {
    // PNG stores width/height as big-endian u32 at offset 16 (after the 8-byte
    // signature, the IHDR length and the tag) — reading them beats trusting a
    // file's byte count, which does not grow monotonically for flat art.
    const pngSize = (path: string): [number, number] => {
      const b = readFileSync(path);
      expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
      return [b.readUInt32BE(16), b.readUInt32BE(20)];
    };
    for (const name of spriteFiles) {
      const def = manifest.sprites[name];
      const dims = (["0.5x", "1x", "2x"] as const).map((suffix) => {
        const path = resolve(ROOT, `assets/railway/${name}@${suffix}.png`);
        expect(existsSync(path), path).toBe(true);
        return pngSize(path);
      });
      // 1× is the size the def records, and the tiers are exact halvings and
      // doublings of it (each tier was rounded to whole pixels by the compiler).
      expect(dims[1]).toEqual([def.w, def.h]);
      expect(dims[0][0]).toBeCloseTo(def.w / 2, 0);
      expect(dims[2][0]).toBeCloseTo(def.w * 2, 0);
      expect(dims[0][1]).toBeCloseTo(def.h / 2, 0);
      expect(dims[2][1]).toBeCloseTo(def.h * 2, 0);
    }
  });

  it("couples the wagon to the locomotive exactly as the rules space it", () => {
    for (const view of RAIL_VIEWS) {
      const loco = manifest.sprites[`locomotive_${view}`];
      const wagon = manifest.sprites[`wagon_${view}`];
      // The body lengths the runtime spaces by are the art's own.
      expect(loco.lenTiles).toBeCloseTo(LOCO_LEN, 6);
      expect(wagon.lenTiles).toBeCloseTo(WAGON_LEN, 6);
      // The buffer planes overhang the bodies, and at `WAGON_OFFSET` apart they
      // MEET: never overlapping, and never further apart than the coupling gap.
      const buffers = Math.abs(loco.coupler!.rear) + wagon.coupler!.front;
      expect(buffers).toBeGreaterThan(LOCO_LEN / 2 + WAGON_LEN / 2);
      expect(WAGON_OFFSET - buffers).toBeGreaterThan(0);
      expect(WAGON_OFFSET - buffers).toBeLessThanOrEqual(COUPLE_GAP);
      // Centres, not edges: the coupling sign convention is front-positive.
      expect(loco.coupler!.front).toBeGreaterThan(0);
      expect(loco.coupler!.rear).toBeLessThan(0);
      expect(wagon.coupler!.front).toBeGreaterThan(0);
      expect(wagon.coupler!.rear).toBeLessThan(0);
    }
  });

  it("carries the 1950s palette it was drawn from", () => {
    expect(manifest.meta.palette).toEqual({
      charcoal: PALETTE.charcoal, oxide: PALETTE.oxide, brick: PALETTE.brick,
      slate: PALETTE.slate, steel: PALETTE.steel, brass: PALETTE.brass, cream: PALETTE.cream,
    });
    // The period look is the constraint, so it is asserted as one: running gear
    // and roofing are near-neutral (charcoal, slate, steel), and the only
    // saturated hues are the 1950s railway's own — oxide, brick and brass.
    for (const key of ["charcoal", "slate", "steel"]) expect(chroma(PALETTE[key])).toBeLessThanOrEqual(0x14);
    for (const key of ["oxide", "brick", "brass"]) expect(chroma(PALETTE[key])).toBeGreaterThan(0x40);
    // No modern plastic: every colour is either near-neutral (the greys and
    // slates) or WARM — r ≥ g ≥ b — so nothing in the set is a cyan, a magenta
    // or a green, which is what "1950s railway" rules out.
    for (const value of Object.values(PALETTE)) {
      if (!value.startsWith("#")) continue;               // the two rgba inks
      const [r, g, b] = channels(value);
      const neutral = chroma(value) <= 0x28;
      expect(neutral || (r >= g && g >= b), `${value} is neither neutral nor period-warm`).toBe(true);
    }
  });

  it("states its provenance: original procedural art, no third-party asset", () => {
    const licences = readFileSync(resolve(ROOT, "assets/railway/LICENSES.md"), "utf8");
    expect(manifest.license).toMatch(/original art, procedurally generated/);
    expect(licences).toMatch(/no third-party art/i);
    expect(licences).toMatch(/make-railway-art\.mjs/);
    // The epic's one prohibition, stated as a negative in the file itself.
    expect(licences).toMatch(/\* no Transport Fever \/ Urban Games asset has been extracted/i);
    // Every sprite's own note points at the generator, so a stray hand-made
    // PNG in the folder is visible in review.
    for (const name of spriteFiles) expect(manifest.sprites[name].note).toMatch(/make-railway-art\.mjs/);
  });

  it("ships with no build-time copy step: the art is globbed into the bundle", () => {
    const art = readFileSync(resolve(ROOT, "src/iso/rail-art.ts"), "utf8");
    expect(art).toContain("import.meta.glob<string>");
    expect(art).toContain('"../../assets/railway/*.png"');
    // The folder needs no entry in the bundler config at all — the same promise
    // `assets/buildings/` cannot make and B-0 fell into once.
    const vite = readFileSync(resolve(ROOT, "vite.config.ts"), "utf8");
    expect(vite).not.toMatch(/railway/i);
  });

  it("documents itself: README, licences and a contact sheet ship beside the art", () => {
    for (const f of ["README.md", "LICENSES.md", "contact-sheet.png", "manifest.json"])
      expect(existsSync(resolve(ROOT, `assets/railway/${f}`)), f).toBe(true);
  });
});

describe("RAIL-03 the loader installs the art into the atlas", () => {
  it("installs every sprite, with no `center` flag and the manifest geometry", async () => {
    stubBitmaps(true);
    const atlas = fakeAtlas(2);
    const n = await loadRailwaySprites(atlas);
    expect(n).toBe(spriteFiles.length);
    for (const name of spriteFiles) {
      const def = atlas.manifest.sprites[name];
      expect(def, name).toBeTruthy();
      expect(def.center).toBeUndefined();
      expect(def.anchor).toEqual(manifest.sprites[name].anchor);
      expect(def.footprint).toEqual(manifest.sprites[name].footprint);
      expect([...atlas.buildingImages.get(name)!.keys()].sort()).toEqual([0.5, 1, 2]);
    }
  });

  it("loads only the tiers the quality cap asks for, then fills the rest", async () => {
    stubBitmaps(true);
    const atlas = fakeAtlas(0.5);
    expect(await loadRailwaySprites(atlas)).toBe(spriteFiles.length);
    expect([...atlas.buildingImages.get("locomotive_se")!.keys()]).toEqual([0.5]);
    // Raising the cap adds the missing levels rather than re-fetching any.
    expect(await loadRailwaySprites(atlas, 2)).toBe(spriteFiles.length);
    expect([...atlas.buildingImages.get("locomotive_se")!.keys()].sort()).toEqual([0.5, 1, 2]);
    expect(await loadRailwaySprites(atlas, 2)).toBe(0);       // nothing left to do
  });

  it("is non-gating: unreadable art installs nothing and leaves no defs behind", async () => {
    stubBitmaps(false);
    const atlas = fakeAtlas(2);
    await expect(loadRailwaySprites(atlas)).resolves.toBe(0);
    expect(atlas.buildingImages.size).toBe(0);
    expect(Object.keys(atlas.manifest.sprites)).toHaveLength(0);
  });
});
