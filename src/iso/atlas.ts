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
   * Building-layer placement: the anchor lands on the footprint's CENTRE
   * instead of its south-corner reference (see drawOrigin in depth.ts).
   * Set for sprites that blit from per-building PNGs (see buildingImages) —
   * the art is placed free on the footprint and does not snap to the grid.
   */
  center?: boolean;
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
  /**
   * W-series: per-LAYER images (assets/layers/roads@…x, buildings@…x). When
   * set, `imageForSprite` prefers the sprite's own layer atlas — roads and
   * buildings ship as separate PNGs and blit from separate images — falling
   * back to the monolithic `images` for anything a layer set doesn't cover.
   */
  readonly layerImages = new Map<"roads" | "buildings", Map<number, AtlasImage>>();
  private masks = new Map<string, AlphaMask>();

  /** The layer atlas a sprite blits from, if the layer images are loaded. */
  layerOfSprite(name: string): "roads" | "buildings" | null {
    if (this.layerImages.size === 0) return null;
    if (/^(road|dirt)_/.test(name)) return "roads";
    if (/^terrain_/.test(name)) return null;   // ground sprites: never blitted
    // TRAFFIC-01: the ambient car cells (car1_* … car3_*) were cut into the
    // monolithic atlas AFTER the layer sheets were last built, so the
    // buildings layer holds only transparent pixels at their rects — routed
    // there, every car blitted as nothing. They live in the monolith alone.
    if (/^car\d+_/.test(name)) return null;
    return "buildings";
  }

  /**
   * Building layers: per-building PNGs (assets/buildings/, authored by
   * tools/make-building-pngs.mjs) — ONE standalone transparent PNG per
   * sprite, one per zoom, placed free on the footprint's centre. A sprite
   * with a building image blits from its OWN whole image (its def rect is
   * 0,0,w,h at 1×), before the shared layer sheets are even consulted.
   */
  readonly buildingImages = new Map<string, Map<number, AtlasImage>>();

  /** True when the sprite has per-building PNG layers installed. */
  hasBuilding(name: string): boolean { return this.buildingImages.has(name); }

  /** Image to blit `name` from at zoom `z` (per-building PNG when available). */
  imageForSprite(name: string, z: number): AtlasImage | undefined {
    const building = this.buildingImages.get(name)?.get(z);
    if (building) return building;
    const layer = this.layerOfSprite(name);
    if (layer) {
      const img = this.layerImages.get(layer)?.get(z);
      if (img) return img;
    }
    return this.images.get(z);
  }

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
   */
  zoomRect(s: SpriteDef, z: number): { x: number; y: number; w: number; h: number } {
    return {
      x: Math.round(s.x * z),
      y: Math.round(s.y * z),
      w: Math.round(s.w * z),
      h: Math.round(s.h * z),
    };
  }

  /** `zoomRect` for a single animation frame (frames tile horizontally). */
  zoomFrameRect(s: SpriteDef, frame: number, z: number): { x: number; y: number; w: number; h: number } {
    const n = s.frames ?? 1;
    const fw = s.w / n;
    const x = s.x + fw * (frame % n);
    return {
      x: Math.round(x * z),
      y: Math.round(s.y * z),
      w: Math.round(fw * z),
      h: Math.round(s.h * z),
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
  buildMasks(atlas);
  return atlas;
}

/** Alpha masks for per-building sprites, rasterised from their own 1× PNG. */
export function buildBuildingMasks(atlas: Atlas): void {
  if (typeof document === "undefined") return;
  for (const [name, byZoom] of atlas.buildingImages) {
    const img = byZoom.get(1);
    if (!img) continue;
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) continue;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height);
    atlas.setMask(name, maskFromRGBA(d.data, img.width, img.height));
  }
}

/**
 * Load the per-building PNG layers (assets/buildings/). For every sprite in
 * the buildings manifest the monolith def is overridden: the whole per-zoom
 * image IS the sprite (rect 0,0,w,h at 1×), the anchor is the authoring
 * convention's footprint-centre anchor, and placement switches to centre
 * anchoring (def.center). Returns the number of sprites installed — 0 when
 * the directory/manifest is absent, in which case the shared buildings sheet
 * keeps drawing everything. Never throws: building art is an upgrade, the
 * sheet path remains fully playable.
 */
export async function loadBuildingLayers(atlas: Atlas, baseUrl = "/assets/buildings/"): Promise<number> {
  let res: Response;
  try { res = await fetch(`${baseUrl}manifest.json`); } catch { return 0; }
  if (!res.ok) return 0;
  const m: {
    sprites: Record<string, { footprint: [number, number]; anchor: [number, number]; w: number; h: number }>;
  } = await res.json().catch(() => null);
  const names = m?.sprites ? Object.entries(m.sprites) : [];
  await Promise.all(names.map(async ([name, def]) => {
    const s = atlas.manifest.sprites[name];
    if (!s) return;                                  // unknown sprite: nothing to override
    const load = (file: string) => fetch(`${baseUrl}${file}`).then((r) => {
      if (!r.ok) throw new Error(`${file} → HTTP ${r.status}`);
      return r.blob();
    }).then((b) => createImageBitmap(b));
    try {
      const [i05, i1, i2] = await Promise.all([
        load(`${name}@0.5x.png`), load(`${name}@1x.png`), load(`${name}@2x.png`),
      ]);
      atlas.buildingImages.set(name, new Map([[0.5, i05], [1, i1], [2, i2]]));
      s.x = 0; s.y = 0; s.w = def.w; s.h = def.h;
      s.anchor = def.anchor;
      s.center = true;
      if (def.footprint) s.footprint = def.footprint;
    } catch (err) {
      console.warn(`[building-layers] ${name}: fell back to the shared sheet`, err);
    }
  }));
  buildBuildingMasks(atlas);
  return atlas.buildingImages.size;
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
  for (const [name, s] of Object.entries(atlas.manifest.sprites)) {
    const r = atlas.frameRect(s, 0);
    if (r.w <= 0 || r.h <= 0) continue;
    const d = ctx.getImageData(r.x, r.y, r.w, r.h);
    atlas.setMask(name, maskFromRGBA(d.data, r.w, r.h));
  }
}
