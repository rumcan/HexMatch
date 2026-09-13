// ══════════════════════════════════════════════════════════════════════════
// E4 — Atlas: sprite table, per-zoom images, and alpha masks for picking.
//
// The manifest (E1) stores every rect/anchor at 1×; @2x and @0.5x images are
// the same layout multiplied by the zoom, so a sprite lookup at zoom z is just
// `scaleSprite(s, z)`. Nothing is ever scaled inside drawImage — EXCEPT under
// the GFX-01 quality caps, where the deliberate downgrade is that the blit
// samples the highest art that was LOADED (≤ `detailCap`) and stretches it
// into the exact destination rect the full-detail atlas would have used.
// Geometry is therefore identical at every quality; only texel density moves.
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
  bits: Uint8Array;   // 1 byte per MASK pixel, 0 = transparent
  /**
   * GFX-01: the zoom the mask was rasterised at. Normally 1 (the 1× sheet),
   * but at `low` detail only the 0.5× image loads, so the mask is half-res and
   * `opaqueAt` scales sprite-local 1× coordinates by this factor before
   * indexing. Absent means 1.
   */
  scale?: number;
}

/**
 * GFX-01: the three pixel-detail levels every zoom-keyed art set ships.
 * `quality` in the video settings caps which of these are LOADED (and, once
 * dropped, freed) — the renderer always blits at the camera's own zoom.
 */
export const DETAIL_ZOOMS: ReadonlyArray<{ z: number; suffix: string }> = [
  { z: 0.5, suffix: "0.5x" },
  { z: 1, suffix: "1x" },
  { z: 2, suffix: "2x" },
];

/**
 * The best zoom to rasterise an alpha mask from: the highest loaded level at
 * or below 1× (masks speak 1× sprite-local coordinates — sampling a 2× sheet
 * for a 1× mask would need a second resample), else the smallest thing we
 * have at all. `null` when nothing is loaded.
 */
export function maskZoom(loaded: Iterable<number>): number | null {
  let under: number | null = null;
  let over = Infinity;
  for (const z of loaded) {
    if (z <= 1) { if (under === null || z > under) under = z; }
    else if (z < over) over = z;
  }
  return under ?? (Number.isFinite(over) ? over : null);
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

  /**
   * GFX-01: the highest pixel-detail level art was LOADED at, set from the
   * video settings (`graphics.ts`) before any atlas image is installed and
   * re-set live when the player changes the preset. Everything above it is
   * never fetched, and `atlasZoomFor` folds a lookup at a zoom over the cap
   * back to the cap — the renderer samples the capped sheet and scales the
   * destination rect, so sprites keep their exact 1×-geometry footprint at
   * any camera zoom while the texel density drops. 2 (the default) means
   * "everything loads" and makes every lookup behave exactly as before.
   */
  detailCap = 2;

  /** Which loaded zoom to sample for a blit at camera zoom `z`. */
  atlasZoomFor(z: number): number {
    return z < this.detailCap ? z : this.detailCap;
  }

  /** Image to blit `name` from at zoom `z` (per-building PNG when available). */
  imageForSprite(name: string, z: number): AtlasImage | undefined {
    const az = this.atlasZoomFor(z);
    const building = this.buildingImages.get(name)?.get(az);
    if (building) return building;
    const layer = this.layerOfSprite(name);
    if (layer) {
      const img = this.layerImages.get(layer)?.get(az);
      if (img) return img;
    }
    return this.images.get(az);
  }

  /**
   * GFX-01: drop every image ABOVE `detailCap` from every zoom-keyed store —
   * the monolith, the road/building layer sheets and each per-building PNG.
   * Called after the cap is lowered at runtime; the bitmaps lose their last
   * strong reference and the GC reclaims them, which is the memory half of
   * the Medium/Low presets.
   */
  pruneDetail(): void {
    const drop = <T>(m: Map<number, T>): void => {
      for (const z of [...m.keys()]) if (z > this.detailCap) m.delete(z);
    };
    drop(this.images);
    for (const byKind of this.layerImages.values()) drop(byKind);
    for (const byZoom of this.buildingImages.values()) drop(byZoom);
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
   * sprite still wins the pick, which is the pre-mask behaviour). GFX-01: a
   * mask rasterised at a reduced detail level (0.5× at `low` quality) carries
   * that zoom as `scale`, so the 1× coordinates are scaled into it first —
   * picking stays tile-accurate whatever quality the player is looking at.
   */
  opaqueAt(name: string, lx: number, ly: number): boolean {
    const s = this.get(name);
    if (!s) return false;
    const fw = s.w / (s.frames ?? 1);
    if (lx < 0 || ly < 0 || lx >= fw || ly >= s.h) return false;
    const m = this.masks.get(name);
    if (!m) return true;
    const sc = m.scale ?? 1;
    const mx = (lx * sc) | 0;
    const my = (ly * sc) | 0;
    // Past the mask's own coverage is a miss, exactly as out-of-sprite is —
    // at scale 1 this is the old behaviour (the mask covers the full sprite).
    if (mx < 0 || my < 0 || mx >= m.w || my >= m.h) return false;
    return m.bits[my * m.w + mx] !== 0;
  }
}

/** Build an alpha mask from raw RGBA pixels (ImageData.data) of frame 0. */
export function maskFromRGBA(
  data: Uint8ClampedArray | Uint8Array, w: number, h: number, threshold = 8, scale = 1,
): AlphaMask {
  const bits = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bits[i] = data[i * 4 + 3] >= threshold ? 1 : 0;
  return scale === 1 ? { w, h, bits } : { w, h, bits, scale };
}

/**
 * Load the manifest + per-zoom images in a browser. `maxZ` (GFX-01: the
 * graphics-quality cap) skips detail levels above it, and the returned Atlas
 * carries the same cap so lookups never reach for an unloaded sheet.
 */
export async function loadAtlas(baseUrl = "/assets/iso-atlas/", maxZ = 2): Promise<Atlas> {
  const manifest: Manifest = await fetch(`${baseUrl}manifest.json`).then((r) => r.json());
  const images = new Map<number, AtlasImage>();
  const entries = Object.entries(manifest.images).filter(([z]) => Number(z) <= maxZ);
  await Promise.all(entries.map(async ([z, file]) => {
    const blob = await fetch(`${baseUrl}${file}`).then((r) => r.blob());
    images.set(Number(z), await createImageBitmap(blob));
  }));
  const atlas = new Atlas(manifest, images);
  atlas.detailCap = maxZ;
  buildMasks(atlas);
  return atlas;
}

/**
 * Alpha masks for per-building sprites, rasterised from the BEST available
 * PNG of each (1× when the quality preset loaded it, else the capped level —
 * see `maskZoom`). The mask records the zoom it came from, so `opaqueAt`
 * keeps speaking 1× sprite-local coordinates at every quality.
 */
export function buildBuildingMasks(atlas: Atlas): void {
  if (typeof document === "undefined") return;
  for (const [name, byZoom] of atlas.buildingImages) {
    const zk = maskZoom(byZoom.keys());
    if (zk === null) continue;
    const img = byZoom.get(zk);
    if (!img) continue;
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) continue;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height);
    atlas.setMask(name, maskFromRGBA(d.data, img.width, img.height, 8, zk));
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
export async function loadBuildingLayers(
  atlas: Atlas, baseUrl = "/assets/buildings/", maxZ = atlas.detailCap,
): Promise<number> {
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
    // GFX-01: two jobs share this function. The FIRST install takes every
    // detail level at or below the cap; a later call with a raised cap only
    // FILLS the levels the sprite is still missing (a quality change at
    // runtime), so no bitmap is ever fetched twice.
    const have = atlas.buildingImages.get(name);
    const missing = DETAIL_ZOOMS.filter(({ z }) => z <= maxZ && !have?.has(z));
    if (!missing.length) return;
    try {
      const loaded = await Promise.all(missing.map(async ({ z, suffix }) =>
        [z, await load(`${name}@${suffix}.png`)] as const));
      if (!have && !loaded.length) throw new Error("no detail level at or under the cap");
      const map = have ?? new Map<number, AtlasImage>();
      for (const [z, img] of loaded) map.set(z, img);
      atlas.buildingImages.set(name, map);
      s.x = 0; s.y = 0; s.w = def.w; s.h = def.h;
      s.anchor = def.anchor;
      s.center = true;
      if (def.footprint) s.footprint = def.footprint;
    } catch (err) {
      // A fill pass failing leaves the already-installed levels serving the
      // sprite; only a first-install failure drops it back to the sheet art.
      if (!have) console.warn(`[building-layers] ${name}: fell back to the shared sheet`, err);
    }
  }));
  buildBuildingMasks(atlas);
  return atlas.buildingImages.size;
}

/**
 * Rasterise every sprite's frame 0 into an alpha mask, from the highest
 * loaded zoom at or below 1× (the 1× sheet when quality allows, the 0.5× one
 * at `low` — see `maskZoom` and `AlphaMask.scale`).
 */
export function buildMasks(atlas: Atlas): void {
  const zk = maskZoom(atlas.images.keys());
  if (zk === null || typeof document === "undefined") return;
  const img = atlas.images.get(zk);
  if (!img) return;
  const canvas = document.createElement("canvas");
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(img as unknown as CanvasImageSource, 0, 0);
  for (const [name, s] of Object.entries(atlas.manifest.sprites)) {
    // GFX-01: the mask image may not be the 1× sheet, so the rect comes from
    // the ZOOM rect (the packer rounds position and size per zoom) and the
    // mask carries `zk` so 1× pick coordinates index it correctly. Per-level
    // rounding can push a sheet-edge sprite a pixel past the smaller image;
    // slide the rect back in rather than lose the mask (a one-pixel shift in
    // a half-res silhouette is a cheaper error than an opaque bounding box).
    const r = atlas.zoomFrameRect(s, 0, zk);
    if (r.w <= 0 || r.h <= 0) continue;
    const rx = Math.max(0, Math.min(r.x, Math.max(0, canvas.width - r.w)));
    const ry = Math.max(0, Math.min(r.y, Math.max(0, canvas.height - r.h)));
    const d = ctx.getImageData(rx, ry, r.w, r.h);
    atlas.setMask(name, maskFromRGBA(d.data, r.w, r.h, 8, zk));
  }
}
