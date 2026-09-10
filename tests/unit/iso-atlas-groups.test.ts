import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import sharp from "sharp";
import type { Manifest } from "../../src/iso/atlas";

/**
 * Grouped atlas editing sheets (tools/make-atlas-groups.mjs): every manifest
 * sprite appears on exactly one sheet, every sheet fits the image-gen UI
 * limit (<= 1920x1080), and every recorded art rect lies inside its sheet
 * without overlapping a sibling. Together with the G7 CI step (slice-atlas
 * output must match the commit) this keeps the sheets fresh: a manifest
 * change without regenerated groups fails the coverage assertion below.
 */

const ZOOM = 2;
const DIR = "assets/iso-atlas/groups";
const MAX_W = 1920;
const MAX_H = 1080;

type Placement = { name: string; x: number; y: number; w: number; h: number };
type Page = { file: string; width: number; height: number; sprites: Placement[] };
type Group = { id: string; title: string; pages: Page[] };
type Index = {
  generatedBy: string; zoom: number; maxSize: [number, number];
  source: { manifest: string; atlas: string };
  groups: Group[];
};

const manifest = JSON.parse(readFileSync("assets/iso-atlas/manifest.json", "utf8")) as Manifest;
const index = JSON.parse(readFileSync(`${DIR}/groups@${ZOOM}x.json`, "utf8")) as Index;

const pages: { group: Group; page: Page }[] = index.groups.flatMap((group) =>
  group.pages.map((page) => ({ group, page })),
);

describe("atlas group sheets", () => {
  it("covers every manifest sprite exactly once", () => {
    const want = Object.keys(manifest.sprites).sort();
    const got = pages.flatMap(({ page }) => page.sprites.map((s) => s.name)).sort();
    expect(got).toEqual(want);
  });

  it("has a unique file per page", () => {
    const files = pages.map(({ page }) => page.file);
    expect(new Set(files).size).toBe(files.length);
  });

  it("keeps every sheet at or under 1920x1080", async () => {
    expect(pages.length).toBeGreaterThan(0);
    for (const { page } of pages) {
      const p = `${DIR}/${page.file}`;
      expect(existsSync(p), `${page.file} exists`).toBe(true);
      const meta = await sharp(p).metadata();
      expect(meta.width).toBeLessThanOrEqual(MAX_W);
      expect(meta.height).toBeLessThanOrEqual(MAX_H);
      // The index must describe the real file, or re-extraction mis-crops.
      expect(meta.width).toBe(page.width);
      expect(meta.height).toBe(page.height);
    }
  });

  it("records art rects at the zoomed manifest size, inside the sheet", () => {
    for (const { page } of pages) {
      for (const s of page.sprites) {
        const m = manifest.sprites[s.name];
        expect(m, `${s.name} is in the manifest`).toBeDefined();
        expect(s.w).toBe(Math.round(m.w * ZOOM));
        expect(s.h).toBe(Math.round(m.h * ZOOM));
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(page.width);
        expect(s.y + s.h).toBeLessThanOrEqual(page.height);
      }
    }
  });

  it("never overlaps two art rects on one sheet", () => {
    for (const { page } of pages) {
      const ss = page.sprites;
      for (let i = 0; i < ss.length; i++) {
        for (let j = i + 1; j < ss.length; j++) {
          const a = ss[i], b = ss[j];
          const overlap =
            a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${a.name} vs ${b.name} on ${page.file}`).toBe(false);
        }
      }
    }
  });
});
