import { describe, expect, it } from "vitest";
import { fbmField, makeProcedural, variantFromBase, type RawTexture, type TextureSlot } from "../../src/iso/terrain-gl/procedural";
import { TEXTURE_SLOTS } from "../../src/iso/terrain-gl/procedural";

/** Deterministic A/B/C-style source texture with a directional pattern. */
function baseTexture(size: number): RawTexture {
  const data = new Uint8Array(size * size * 4);
  const ramp = fbmField(size, 4, 4, 3, 99);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.round(ramp[y * size + x] * 255);
      data[i + 1] = (x * 5) % 256;
      data[i + 2] = (y * 3) % 256;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

describe("variantFromBase", () => {
  it("keeps the size, the alpha and the pixel budget of the base", () => {
    const base = baseTexture(32);
    for (const v of [1, 2] as const) {
      const out = variantFromBase(base, v);
      expect(out.width).toBe(32);
      expect(out.height).toBe(32);
      expect(out.data.length).toBe(base.data.length);
      for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(255);
    }
  });

  it("is deterministic", () => {
    const base = baseTexture(16);
    expect(Array.from(variantFromBase(base, 1).data)).toEqual(Array.from(variantFromBase(base, 1).data));
    expect(Array.from(variantFromBase(base, 2).data)).toEqual(Array.from(variantFromBase(base, 2).data));
  });

  it("is a rotation of the base, plus a small hue/value shift (never a copy)", () => {
    const size = 32;
    const base = baseTexture(size);
    for (const v of [1, 2] as const) {
      const out = variantFromBase(base, v);
      const shift = v === 1 ? 5 : -4;
      const gain = v === 1 ? [1.06, 1.02, 0.95] : [0.95, 1.0, 1.07];
      let maxDelta = 0, identical = 0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const di = (y * size + x) * 4;
          // the source pixel under the variant's rotation + integer roll
          const sx = v === 1 ? (y + Math.floor(size / 3)) % size : (size - 1 - x + Math.floor(size / 5)) % size;
          const sy = v === 1 ? (size - 1 - x + Math.floor(size / 5)) % size : (size - 1 - y + Math.floor(size / 3)) % size;
          const si = (sy * size + sx) * 4;
          let same = true;
          for (let c = 0; c < 3; c++) {
            const want = Math.max(0, Math.min(255, Math.round(base.data[si + c] * gain[c] + shift)));
            expect(out.data[di + c]).toBe(want); // exact rotation + shift
            maxDelta = Math.max(maxDelta, Math.abs(out.data[di + c] - base.data[si + c]));
            if (out.data[di + c] !== base.data[di + c]) same = false;
          }
          if (same) identical++;
        }
      }
      // the shift stays subtle (the variant has to read as the same material)...
      expect(maxDelta).toBeLessThanOrEqual(20);
      // ...and the result is not just the base in place: the repeat moved
      expect(identical).toBeLessThan(size * size * 0.9);
      expect(Array.from(out.data)).not.toEqual(Array.from(base.data));
    }
  });
});

describe("procedural fallbacks", () => {
  it("builds every slot seamlessly (periodic noise) at the requested size", () => {
    for (const slot of TEXTURE_SLOTS) {
      const t = makeProcedural(slot as TextureSlot, 64);
      expect(t.data.length).toBe(t.width * t.height * 4);
      for (let i = 3; i < t.data.length; i += 4) expect(t.data[i]).toBe(255);
      // every channel is used by at least one slot, so none can be all-zero
      let sum = 0;
      for (let i = 0; i < t.data.length; i += 4) sum += t.data[i] + t.data[i + 1] + t.data[i + 2];
      expect(sum).toBeGreaterThan(0);
    }
  });

  it("is deterministic for a slot", () => {
    expect(Array.from(makeProcedural("grass", 32).data)).toEqual(Array.from(makeProcedural("grass", 32).data));
    expect(Array.from(makeProcedural("dirt", 32).data)).not.toEqual(Array.from(makeProcedural("grass", 32).data));
  });
});
