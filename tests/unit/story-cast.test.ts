// ══════════════════════════════════════════════════════════════════════════
// STORY-01 — the cast and its painted plates.
//
// Two things are pinned here. First the DATA: every character has a face the
// stage can show (a sheet quadrant or a solo mugshot), the rivals are rivals,
// the guide is neither rival nor player, and the quadrant arithmetic is the
// one the CSS obeys (background-position percentages under a uniform 2×).
// Second the ART, read off disk through the manifest the derive tool runs
// on: every master the campaign names is painted, every derived plate the
// game imports exists, faces are SQUARE (four equal quadrants depend on it)
// and backdrops are wide. A re-painted sheet that breaks the grid fails a
// test, not a cutscene.
// ══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  CAST, CAST_IDS, EXPRESSIONS, FACE_FOR_DIRECTION, FACE_POS, GUIDE, RIVALS,
  faceOf, isPlayer, isRival, resolveSpeaker,
} from "../../src/story/cast";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(readFileSync(path.join(ROOT, "tools/story-art.json"), "utf8")) as {
  src: string; out: string;
  backdrops: { key: string; master: string; width: number }[];
  faces: { key: string; master: string; size: number }[];
};

describe("STORY-01 the cast", () => {
  it("gives every character a face, and every rival a painted sheet", () => {
    for (const id of CAST_IDS) {
      const spec = faceOf(id, "calm");
      expect(spec.url.length, `${id} has no art`).toBeGreaterThan(0);
      if (CAST[id].sheet) expect(spec.pos).toEqual(FACE_POS.calm);
      else expect(spec.pos).toBeNull();
    }
    for (const rival of RIVALS) {
      expect(CAST[rival].sheet, `${rival} needs expressions`).toBeTruthy();
      expect(isRival(rival)).toBe(true);
    }
    expect(CAST[GUIDE].sheet).toBeTruthy();
    for (const id of ["vex", "you"] as const) {
      expect(isPlayer(id)).toBe(true);
      expect(CAST[id].solo).toBeTruthy();
    }
  });

  it("paints exactly the four moods a sheet can hold, in quadrant order", () => {
    expect(EXPRESSIONS).toEqual(["calm", "smile", "mad", "shock"]);
    expect(FACE_POS.calm).toEqual([0, 0]);
    expect(FACE_POS.smile).toEqual([100, 0]);
    expect(FACE_POS.mad).toEqual([0, 100]);
    expect(FACE_POS.shock).toEqual([100, 100]);
    // the wire's moods are all moods a sheet can paint
    for (const mood of Object.values(FACE_FOR_DIRECTION)) {
      expect((EXPRESSIONS as string[]).includes(mood)).toBe(true);
    }
  });

  it("resolves the player stand-in to whichever Hextall the player chose", () => {
    expect(resolveSpeaker("player", "you")).toBe("you");
    expect(resolveSpeaker("player", "vex")).toBe("vex");
    expect(resolveSpeaker("mabel", "you")).toBe("mabel");
  });

  it("names every sheet after its character, so a swap is one file", () => {
    for (const id of [...RIVALS, GUIDE]) {
      expect(CAST[id].sheet).toMatch(new RegExp(`face-${id}\\.webp$`));
    }
  });
});

describe("STORY-01 the painted plates on disk", () => {
  it("has every master painted and every derived plate the game imports", () => {
    for (const bg of manifest.backdrops) {
      expect(existsSync(path.join(ROOT, manifest.src, bg.master)), `${bg.master} missing`).toBe(true);
      expect(existsSync(path.join(ROOT, manifest.out, `bg-${bg.key}.webp`)), `bg-${bg.key} missing`).toBe(true);
    }
    for (const face of manifest.faces) {
      expect(existsSync(path.join(ROOT, manifest.src, face.master)), `${face.master} missing`).toBe(true);
      expect(existsSync(path.join(ROOT, manifest.out, `face-${face.key}.webp`)), `face-${face.key} missing`).toBe(true);
    }
  });

  it("keeps face sheets square (four equal quadrants) and backdrops wide", async () => {
    for (const face of manifest.faces) {
      const meta = await sharp(path.join(ROOT, manifest.out, `face-${face.key}.webp`)).metadata();
      expect(meta.width, `face-${face.key} is not square`).toBe(meta.height);
      expect(meta.width).toBeGreaterThanOrEqual(512);
    }
    for (const bg of manifest.backdrops) {
      const meta = await sharp(path.join(ROOT, manifest.out, `bg-${bg.key}.webp`)).metadata();
      expect((meta.width ?? 0) > (meta.height ?? 0), `bg-${bg.key} is not wide`).toBe(true);
    }
  });
});
