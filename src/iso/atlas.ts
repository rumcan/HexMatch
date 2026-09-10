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
   * Multi-atlas: which image source this sprite blits from.
   * Source 0 (default) = the original atlas images.
   * Source 1, 2, … = additional atlas images (new art).
   * The manifest's `imageSets` array maps each source index to its
   * per-zoom filenames.
   */
  source?: number;
}

export interface Manifest {
  images: Record<string, string>;
  tileW: number;
  tileH: number;
  sprites: Record<string, SpriteDef>;
  meta?: unknown;
  /**
   * Multi-atlas: additional image sources beyond the original `images`.
   * Each entry is a zoom→filename map for that source index.
   * `images` is always source 0; `imageSets[0]` is source 1, etc.
   */
  imageSets?: Record<string, string>[];
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
  /**
   * Multi-atlas: additional image sources. Key is `"sourceIndex:zoom"`.
   * Source 0 images live in `images` (the original map) for backward compat;
   * source 1+ live here.
   */
  readonly extraImages = new Map<string, AtlasImage>();
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

  /**
   * Multi-atlas: return the correct atlas image for a given sprite and zoom.
   * Source 0 sprites use the original `images` map; source 1+ use `extraImages`.
   */
  imageForSprite(sprite: SpriteDef, zoom: number): AtlasImage | undefined {
    const src = sprite.source ?? 0;
    if (src === 0) return this.images.get(zoom);
    return this.extraImages.get(`${src}:${zoom}`);
  }

  /** Source rect of animation frame `i` (frames tile horizontally), at 1×. */
  frameRect(s: SpriteDef, frame = 0): { x: number; y: number; w: number; h: number } {
    const n = s.frames ?? 1;
    const fw = s.w / n;
    return { x: s.x + fw * (frame % n), y: s.y, w: fw, h: s.h };
  }

  /**
   * Source rect in the zoomed atlas image. The packer (tools/slice-atlas.mjs)
   * resizes each sprite to `Math.round(w * z) × Math.round(h * z)` and places
   * it at `Math.round(x * z), Math.round(y * z)`, but the manifest only stores
   * 1× coordinates. Multiplying naively (`s.w * z`) produces fractional
   * source widths (e.g. a 133px sprite at 0.5× → 66.5px) that miss the real
   * 67px packed column, which crops and shifts art per zoom. This returns the
   * *actual* packed integer rect.
   *
   * Multi-atlas: for source 1+ sprites whose image exists only at 1×,
   * the source rect stays at 1× coordinates (the browser scales on blit).
   */
  zoomRect(s: SpriteDef, z: number): { x: number; y: number; w: number; h: number } {
    // Source 1+ images are 1x only — always use1x coordinates.
    const effectiveZ = (s.source ?? 0) > 0 ? 1 : z;
    return {
      x: Math.round(s.x * effectiveZ),
      y: Math.round(s.y * effectiveZ),
      w: Math.round(s.w * effectiveZ),
      h: Math.round(s.h * effectiveZ),
    };
  }

  /** `zoomRect` for a single animation frame (frames tile horizontally). */
  zoomFrameRect(s: SpriteDef, frame: number, z: number): { x: number; y: number; w: number; h: number } {
    const n = s.frames ?? 1;
    const fw = s.w / n;
    const x = s.x + fw * (frame % n);
    // Source 1+ images are 1x only — always use1x coordinates.
    const effectiveZ = (s.source ?? 0) > 0 ? 1 : z;
    return {
      x: Math.round(x * effectiveZ),
      y: Math.round(s.y * effectiveZ),
      w: Math.round(fw * effectiveZ),
      h: Math.round(s.h * effectiveZ),
    };
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
  // Multi-atlas: load extra image sets (source 1, 2, …)
  if (manifest.imageSets) {
    await Promise.all(manifest.imageSets.map(async (set, idx) => {
      const srcIdx = idx + 1;
      await Promise.all(Object.entries(set).map(async ([z, file]) => {
        const blob = await fetch(`${baseUrl}${file}`).then((r) => r.blob());
        atlas.extraImages.set(`${srcIdx}:${Number(z)}`, await createImageBitmap(blob));
      }));
    }));
  }
  buildMasks(atlas);
  return atlas;
}

/** Rasterise every sprite's frame 0 from its source's 1× image into an alpha mask. */
export function buildMasks(atlas: Atlas): void {
  if (typeof document === "undefined") return;

  // Cache canvases per source so we only draw each atlas image once.
  const canvasCache = new Map<number, { ctx: CanvasRenderingContext2D; img: AtlasImage }>();
  const getCtx = (src: number): CanvasRenderingContext2D | null => {
    if (canvasCache.has(src)) return canvasCache.get(src)!.ctx;
    const img = src === 0 ? atlas.image(1) : atlas.extraImages.get(`${src}:1`);
    if (!img) return null;
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
    canvasCache.set(src, { ctx, img });
    return ctx;
  };

  for (const [name, s] of Object.entries(atlas.manifest.sprites)) {
    const src = s.source ?? 0;
    const ctx = getCtx(src);
    if (!ctx) continue;
    const r = atlas.frameRect(s, 0);
    if (r.w <= 0 || r.h <= 0) continue;
    const d = ctx.getImageData(r.x, r.y, r.w, r.h);
    atlas.setMask(name, maskFromRGBA(d.data, r.w, r.h));
  }
}
