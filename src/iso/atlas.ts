// ══════════════════════════════════════════════════════════════════════════
// E4 — Atlas: sprite table, per-zoom images, and alpha masks for picking.
//
// The manifest (E1) stores every rect/anchor at 1×; @2x and @0.5x images are
// the same layout multiplied by the zoom, so a sprite lookup at zoom z is just
// `scaleSprite(s, z)`. Nothing is ever scaled inside drawImage.
//
// Alpha masks are built once per sprite at load and used by stage-2 picking
// (click the chimney → get the mine). They are stored at 1× and sampled with
// the cursor position divided by the zoom.
// ══════════════════════════════════════════════════════════════════════════

export interface SpriteDef {
  x: number; y: number; w: number; h: number;
  footprint: [number, number];
  anchor: [number, number];
  frames?: number;
  frameMs?: number;
  slices?: { x: number; y: number; w: number; h: number }[];
  /**
   * MB1 multi-storey stack: when present this sprite is a COMPOSITE — x/y are
   * unused, w/h are its union bounding box, and it is drawn (and alpha-tested)
   * by blitting each part at a (dx, dy) world-1x offset from the box's top-left,
   * sourced from the part's own packed layer sprite. Bottom-to-top order.
   */
  parts?: { sprite: string; dx: number; dy: number }[];
}

export interface Manifest {
  images: Record<string, string>;
  tileW: number;
  tileH: number;
  sprites: Record<string, SpriteDef>;
  meta?: unknown;
}

/** Anything that can be blitted — real ImageBitmap in the browser, stub in tests. */
export interface AtlasImage {
  width: number;
  height: number;
}

export interface AlphaMask {
  w: number; h: number;
  bits: Uint8Array;   // 1 byte per 1× pixel, 0 = transparent
}

export class Atlas {
  readonly manifest: Manifest;
  readonly images: Map<number, AtlasImage>;
  private masks = new Map<string, AlphaMask>();

  constructor(manifest: Manifest, images: Map<number, AtlasImage> = new Map()) {
    this.manifest = manifest;
    this.images = images;
  }

  get(name: string): SpriteDef | undefined {
    return this.manifest.sprites[name];
  }

  has(name: string): boolean {
    return name in this.manifest.sprites;
  }

  image(zoom: number): AtlasImage | undefined {
    return this.images.get(zoom);
  }

  /** Source rect of animation frame `i` (frames tile horizontally). */
  frameRect(s: SpriteDef, frame = 0): { x: number; y: number; w: number; h: number } {
    const n = s.frames ?? 1;
    const fw = s.w / n;
    return { x: s.x + fw * (frame % n), y: s.y, w: fw, h: s.h };
  }

  /** Frame index for a sprite at time `t` ms. */
  frameAt(s: SpriteDef, t: number): number {
    const n = s.frames ?? 1;
    if (n <= 1) return 0;
    return Math.floor(t / (s.frameMs ?? 200)) % n;
  }

  setMask(name: string, mask: AlphaMask) { this.masks.set(name, mask); }
  mask(name: string): AlphaMask | undefined { return this.masks.get(name); }

  /**
   * Alpha test in 1× sprite-local coordinates. Out-of-range is a miss. With no
   * mask registered the bounding box is treated as opaque (conservative: the
   * sprite still wins the pick, which is the pre-mask behaviour).
   */
  opaqueAt(name: string, lx: number, ly: number): boolean {
    const s = this.get(name);
    if (!s) return false;
    const fw = s.w / (s.frames ?? 1);
    if (lx < 0 || ly < 0 || lx >= fw || ly >= s.h) return false;
    const m = this.masks.get(name);
    if (!m) return true;
    return m.bits[(ly | 0) * m.w + (lx | 0)] !== 0;
  }
}

/** Build an alpha mask from raw RGBA pixels (ImageData.data) of frame 0. */
export function maskFromRGBA(
  data: Uint8ClampedArray | Uint8Array, w: number, h: number, threshold = 8,
): AlphaMask {
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bits[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
  return { w, h, bits };
}

/** Load the manifest + per-zoom images in a browser. */
export async function loadAtlas(baseUrl = "/assets/iso-atlas/"): Promise<Atlas> {
  const manifest: Manifest = await fetch(`${baseUrl}manifest.json`).then((r) => r.json());
  const images = new Map<number, AtlasImage>();
  const entries = Object.entries(manifest.images);
  await Promise.all(entries.map(async ([z, file]) => {
    const blob = await fetch(`${baseUrl}${file}`).then((r) => r.blob());
    images.set(Number(z), await createImageBitmap(blob));
  }));
  const atlas = new Atlas(manifest, images);
  buildMasks(atlas);
  return atlas;
}

/** Rasterise every sprite's frame 0 from the 1× image into an alpha mask. */
export function buildMasks(atlas: Atlas): void {
  const img = atlas.image(1);
  if (!img || typeof document === "undefined") return;
  const canvas = document.createElement("canvas");
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
  // Pass 1: real packed sprites (composites carry no atlas region of their own).
  const compositeNames: string[] = [];
  for (const [name, s] of Object.entries(atlas.manifest.sprites)) {
    if (s.parts) { compositeNames.push(name); continue; }
    const r = atlas.frameRect(s, 0);
    if (r.w <= 0 || r.h <= 0) continue;
    const d = ctx.getImageData(r.x, r.y, r.w, r.h);
    atlas.setMask(name, maskFromRGBA(d.data, r.w, r.h));
  }
  // Pass 2: a composite's mask is the union of its parts' masks at their
  // (dx, dy) offsets — clicking any floor of the tower selects the building.
  for (const name of compositeNames) {
    const s = atlas.get(name)!;
    const bits = new Uint8Array(s.w * s.h);
    for (const p of s.parts!) {
      const part = atlas.get(p.sprite);
      const pm = part ? atlas.mask(p.sprite) : undefined;
      if (!part || !pm) continue;
      for (let ly = 0; ly < pm.h; ly++) {
        for (let lx = 0; lx < pm.w; lx++) {
          if (pm.bits[ly * pm.w + lx] === 0) continue;
          const x = p.dx + lx, y = p.dy + ly;
          if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
          bits[y * s.w + x] = 1;
        }
      }
    }
    atlas.setMask(name, { w: s.w, h: s.h, bits });
  }
}
