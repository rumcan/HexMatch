// ─────────────────────────────────────────────────────────────────────────
// E4 — isometric canvas-2d renderer. Replaces MapView3D.ts.
// Three stacked layers (terrain / structures / overlay), 8×8 chunk caching
// for terrain, viewport culling, a three-tier depth sort and a two-stage
// (flat + sprite/alpha) picker. Flat terrain only (E0).
//
// Until the atlas (E1) lands, sprites are drawn as simple vector shapes. The
// draw/depth/pick contract is final, so swapping in bitmaps is a drop-in.
// ─────────────────────────────────────────────────────────────────────────

import {
  TILE_W, TILE_H, HH, MAP_W, MAP_H, ZOOM_LEVELS, Zoom,
  tileToScreen, screenToTile, tileIndex, inBounds, TERRAIN,
  DIR, INDUSTRIES,
} from "./config";
import { IsoMap, Industry } from "./grid";
import { IsoWorld } from "./world";
import { DIR_BITS } from "./transport";

const CHUNK = 8;

interface Camera { x: number; y: number; zoom: Zoom; }

interface Sprite {
  id: number;
  kind: "industry" | "harvester" | "factory";
  tx: number; ty: number;
  w: number; h: number;          // footprint in tiles
  heightPx: number;
  color: string;
  ref?: Industry;
}

const TERRAIN_FILL: Record<number, string> = {
  [TERRAIN.GRASS]: "#4f9e57",
  [TERRAIN.WATER]: "#3f86c8",
  [TERRAIN.ROUGH]: "#8a8174",
};
const TERRAIN_EDGE: Record<number, string> = {
  [TERRAIN.GRASS]: "#3c7c44",
  [TERRAIN.WATER]: "#326aa6",
  [TERRAIN.ROUGH]: "#6f675b",
};

export class IsoRenderer {
  world: IsoWorld;
  map: IsoMap;
  cam: Camera = { x: 0, y: 0, zoom: 1 };
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  // chunk cache → offscreen canvas per (chunkX, chunkY, zoom)
  private chunkCache = new Map<string, HTMLCanvasElement>();
  private dpr = 1;
  onPick?: (hit: { kind: string; id: number; tx?: number; ty?: number } | null) => void;
  hover: Sprite | { kind: string; id: number } | null = null;

  // E1 atlas seam: when a manifest + sheet are loaded, sprites blit from the
  // atlas (pre-rendered per zoom, 1:1 copies); otherwise vector placeholders.
  private atlas: HTMLImageElement | null = null;
  private atlasSprites: Record<string, { x: number; y: number; w: number; h: number; anchor: [number, number] }> = {};
  loadAtlas(img: HTMLImageElement, sprites: typeof this.atlasSprites) {
    this.atlas = img;
    this.atlasSprites = sprites;
    this.invalidateChunks();
  }

  // drag-build state (E5)
  buildKind: "road" | "rail" | "harvester" | "factory" | "demolish" | null = null;
  dragStart: { x: number; y: number } | null = null;
  dragEnd: { x: number; y: number } | null = null;
  dragFlip = false;

  constructor(canvas: HTMLCanvasElement, world: IsoWorld) {
    this.canvas = canvas;
    this.world = world;
    this.map = world.map;
    this.ctx = canvas.getContext("2d")!;
    this.bindInput();
    this.resize();
  }

  // ── coordinate helpers ────────────────────────────────────────────────
  /** world (unzoomed) screen position of a tile's north corner, plus camera */
  worldToScreen(tx: number, ty: number): [number, number] {
    const [sx, sy] = tileToScreen(tx, ty);
    return [Math.floor(sx * this.cam.zoom + this.cam.x),
            Math.floor(sy * this.cam.zoom + this.cam.y)];
  }

  screenToWorld(px: number, py: number): [number, number] {
    return screenToTile((px - this.cam.x) / this.cam.zoom,
                        (py - this.cam.y) / this.cam.zoom);
  }

  // ── sizing (E4 camera: client rect + visual viewport, never innerWidth) ─
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.floor(w * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(h * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  get viewW() { return this.canvas.width / this.dpr; }
  get viewH() { return this.canvas.height / this.dpr; }

  recentre() {
    // centre the island (map centre tile 24,24)
    const [cx, cy] = tileToScreen(MAP_W / 2, MAP_H / 2);
    this.cam.x = Math.floor(this.viewW / 2 - cx * this.cam.zoom);
    this.cam.y = Math.floor(this.viewH / 2 - cy * this.cam.zoom - 40 * this.cam.zoom);
    this.clampCamera();
  }

  private clampCamera() {
    // keep the map bounding diamond intersecting the viewport
    const margin = 200;
    const [ax, ay] = tileToScreen(0, 0);
    const [bx, by] = tileToScreen(MAP_W, MAP_H);
    const minX = this.viewW - (bx - ax) * this.cam.zoom - margin;
    const maxX = margin;
    const minY = this.viewH - (by - ay) * this.cam.zoom - margin;
    const maxY = margin;
    this.cam.x = Math.max(minX, Math.min(maxX, this.cam.x));
    this.cam.y = Math.max(minY, Math.min(maxY, this.cam.y));
  }

  // ── chunk-cached terrain (E4) ─────────────────────────────────────────
  private chunkKey(cx: number, cy: number) { return `${cx},${cy},${this.cam.zoom}`; }

  private renderChunk(cx: number, cy: number): HTMLCanvasElement {
    const key = this.chunkKey(cx, cy);
    const hit = this.chunkCache.get(key);
    if (hit) return hit;
    const z = this.cam.zoom;
    const tw = TILE_W * z, th = TILE_H * z;
    // size the offscreen to cover the chunk's diamond extent (+ margin)
    const cv = document.createElement("canvas");
    cv.width = Math.ceil((CHUNK + 2) * tw);
    cv.height = Math.ceil((CHUNK + 2) * th);
    const g = cv.getContext("2d")!;
    const ox = cv.width / 2, oy = th / 2;
    for (let y = cy * CHUNK; y < (cy + 1) * CHUNK && y < MAP_H; y++) {
      for (let x = cx * CHUNK; x < (cx + 1) * CHUNK && x < MAP_W; x++) {
        const [wx, wy] = tileToScreen(x, y);
        const [wx0, wy0] = tileToScreen(cx * CHUNK, cy * CHUNK);
        const px = (wx - wx0) * z + ox;
        const py = (wy - wy0) * z + oy;
        this.drawDiamond(g, px, py, tw, th, this.map.terrain[tileIndex(x, y)]);
      }
    }
    this.chunkCache.set(key, cv);
    return cv;
  }

  invalidateChunks() { this.chunkCache.clear(); }

  private drawDiamond(g: CanvasRenderingContext2D, px: number, py: number,
                      tw: number, th: number, terrain: number) {
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(px + tw / 2, py + th / 2);
    g.lineTo(px, py + th);
    g.lineTo(px - tw / 2, py + th / 2);
    g.closePath();
    g.fillStyle = TERRAIN_FILL[terrain] || TERRAIN_FILL[TERRAIN.GRASS];
    g.fill();
    g.strokeStyle = TERRAIN_EDGE[terrain] || TERRAIN_EDGE[TERRAIN.GRASS];
    g.lineWidth = 1;
    g.stroke();
  }

  // ── culling (E4): viewport corners → tile bbox, padded for tall sprites ─
  private cullRange(): { x0: number; y0: number; x1: number; y1: number } {
    const corners: [number, number][] = [
      [0, 0], [this.viewW, 0], [0, this.viewH], [this.viewW, this.viewH],
    ];
    const tiles = corners.map(([x, y]) => this.screenToWorld(x, y));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [tx, ty] of tiles) {
      x0 = Math.min(x0, tx); y0 = Math.min(y0, ty);
      x1 = Math.max(x1, tx); y1 = Math.max(y1, ty);
    }
    const pad = 6; // tall 3×3 mine reaches ~5 tiles up the screen
    return {
      x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad),
      x1: Math.min(MAP_W - 1, x1 + pad), y1: Math.min(MAP_H - 1, y1 + pad),
    };
  }

  // ── sprite list with depth keys (E4 Tier 1) ───────────────────────────
  private buildSprites(): Sprite[] {
    const out: Sprite[] = [];
    for (const ind of this.map.industries) {
      const def = INDUSTRIES[ind.type];
      const hPx = (def.w >= 3 ? 150 : def.w >= 2 ? 96 : 64);
      out.push({
        id: ind.id, kind: "industry", tx: ind.tx, ty: ind.ty,
        w: ind.w, h: ind.h, heightPx: hPx,
        color: ind.type.includes("mine") || ind.type === "quarry" ? "#b06a3a"
          : ind.type === "farm" ? "#e3c14d"
          : ind.type === "forest" ? "#3f8f4a"
          : ind.type === "oil_rig" ? "#5a5a5a" : "#d8b24a",
        ref: ind,
      });
    }
    this.world.factories.forEach((f, player) => {
      out.push({
        id: player, kind: "factory", tx: f.tx, ty: f.ty, w: 2, h: 2,
        heightPx: 110, color: player === 0 ? "#39b6ff" : "#e0503a",
      });
    });
    this.world.harvesters.forEach((hv) => {
      out.push({
        id: hv.id, kind: "harvester", tx: hv.tx, ty: hv.ty, w: 1, h: 1,
        heightPx: 60, color: "#ffd23c",
      });
    });
    // Tier 1: sort by the footprint's MAX corner, tie-break tx-ty then height.
    out.sort((a, b) => {
      const ka = (a.tx + a.w - 1) + (a.ty + a.h - 1);
      const kb = (b.tx + b.w - 1) + (b.ty + b.h - 1);
      if (ka !== kb) return ka - kb;
      const da = (a.tx - a.ty), db = (b.tx - b.ty);
      if (da !== db) return da - db;
      return a.heightPx - b.heightPx;
    });
    return out;
  }

  // ── main draw ─────────────────────────────────────────────────────────
  draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    ctx.fillStyle = "#2a6aa0";
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const range = this.cullRange();

    // 1) terrain chunks
    const cx0 = Math.floor(range.x0 / CHUNK), cx1 = Math.floor(range.x1 / CHUNK);
    const cy0 = Math.floor(range.y0 / CHUNK), cy1 = Math.floor(range.y1 / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = this.renderChunk(cx, cy);
        const [wx0, wy0] = tileToScreen(cx * CHUNK, cy * CHUNK);
        ctx.drawImage(chunk,
          Math.floor(wx0 * this.cam.zoom + this.cam.x - TILE_W * this.cam.zoom),
          Math.floor(wy0 * this.cam.zoom + this.cam.y - HH * this.cam.zoom));
      }
    }

    // 2) transport (drawn ground-level, in depth order per tile)
    this.drawTransport(range);

    // 3) structures depth-sorted
    const sprites = this.buildSprites().filter((s) =>
      s.tx + s.w >= range.x0 && s.tx <= range.x1 &&
      s.ty + s.h >= range.y0 && s.ty <= range.y1);
    // Tier 2 DAG resolution only matters for overlapping footprints; the
    // Poisson-disc placement (separation 6) keeps those empty, so Tier 1
    // ordering is used directly (the alpha-pick list below shares it).
    for (const s of sprites) this.drawSprite(ctx, s);

    // 4) overlay: build preview / legal highlight / hover (every frame)
    this.drawOverlay(ctx);
  }

  private drawTransport(range: { x0: number; y0: number; x1: number; y1: number }) {
    const ctx = this.ctx;
    const z = this.cam.zoom;
    const drawLayer = (bits: Uint8Array, color: string, edge: string) => {
      for (let y = range.y0; y <= range.y1; y++) {
        for (let x = range.x0; x <= range.x1; x++) {
          const mask = bits[tileIndex(x, y)];
          if (!mask) continue;
          const [sx, sy] = this.worldToScreen(x, y);
          ctx.strokeStyle = edge;
          ctx.lineWidth = Math.max(2, 6 * z);
          ctx.beginPath();
          ctx.moveTo(sx, sy + HH * z);
          for (const bit of DIR_BITS) {
            if (!(mask & bit)) continue;
            const [dx, dy] = DIR[bit];
            const [ex, ey] = this.worldToScreen(x + dx, y + dy);
            ctx.moveTo(sx, sy + HH * z);
            ctx.lineTo(ex, ey + HH * z);
          }
          ctx.stroke();
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, 3 * z);
          ctx.stroke();
        }
      }
    };
    drawLayer(this.world.net.road, "#d8d2c0", "#8a8270");
    drawLayer(this.world.net.rail, "#6a6f7a", "#3a3f4a");
  }

  private drawSprite(ctx: CanvasRenderingContext2D, s: Sprite) {
    const z = this.cam.zoom;
    // anchor on the footprint's SOUTH corner (E1 anchor contract)
    const [sx, sy] = tileToScreen(s.tx + s.w - 1, s.ty + s.h - 1);
    const baseX = sx * z + this.cam.x;
    const baseY = sy * z + this.cam.y + TILE_H * z;

    // atlas path (E1): blit the sprite so its anchor pixel lands on the south
    // corner, floored to avoid sub-pixel blur.
    const atlasKey = s.kind === "industry" && s.ref ? s.ref.type : s.kind;
    const spr = this.atlasSprites[atlasKey];
    if (this.atlas && spr) {
      const dw = spr.w * z, dh = spr.h * z;
      ctx.drawImage(this.atlas, spr.x, spr.y, spr.w, spr.h,
        Math.floor(baseX - spr.anchor[0] * z),
        Math.floor(baseY - spr.anchor[1] * z),
        Math.floor(dw), Math.floor(dh));
      return;
    }

    const h = s.heightPx * z;
    const wdt = Math.max(20 * z, s.w * 26 * z);
    ctx.save();
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.ellipse(baseX, baseY, wdt * 0.7, 8 * z, 0, 0, Math.PI * 2);
    ctx.fill();
    // body (placeholder art: a box + roof)
    ctx.fillStyle = s.color;
    ctx.fillRect(baseX - wdt / 2, baseY - h, wdt, h);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(baseX - wdt / 2, baseY - h, wdt * 0.28, h); // side shading
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();   // roof
    ctx.moveTo(baseX - wdt / 2, baseY - h);
    ctx.lineTo(baseX, baseY - h - 12 * z);
    ctx.lineTo(baseX + wdt / 2, baseY - h);
    ctx.closePath();
    ctx.fill();
    if (s.kind === "factory") {
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.floor(12 * z)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("★", baseX, baseY - h / 2);
    }
    ctx.restore();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D) {
    if (this.buildKind === "road" || this.buildKind === "rail") {
      if (this.dragStart && this.dragEnd) {
        const kind = this.buildKind;
        const path = this.world.net.dragPath(
          kind, this.dragStart.x, this.dragStart.y,
          this.dragEnd.x, this.dragEnd.y, this.dragFlip);
        let cost = 0;
        for (const p of path) {
          if (this.world.net.has(kind, p.x, p.y)) continue;
          if (!this.world.net.canBuild(kind, p.x, p.y)) continue;
          cost++;
          const [sx, sy] = this.worldToScreen(p.x, p.y);
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          this.tileMarker(ctx, sx, sy);
        }
        // cost readout near cursor (E5/E9)
        ctx.fillStyle = "#fff";
        ctx.font = "13px sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(`${kind} · ${cost} tiles`, this.dragEndScreenX + 12, this.dragEndScreenY - 12);
      }
    }
    // highlight hovered/legal target
    if (this.hover && "tx" in this.hover && this.hover.tx !== undefined) {
      const [sx, sy] = this.worldToScreen(this.hover.tx!, this.hover.ty!);
      ctx.strokeStyle = "#ffe27a";
      ctx.lineWidth = 2;
      this.tileMarker(ctx, sx, sy, true);
    }
  }

  private dragEndScreenX = 0;
  private dragEndScreenY = 0;

  private tileMarker(ctx: CanvasRenderingContext2D, sx: number, sy: number, outline = false) {
    const z = this.cam.zoom;
    const tw = TILE_W * z, th = TILE_H * z;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + tw / 2, sy + th / 2);
    ctx.lineTo(sx, sy + th);
    ctx.lineTo(sx - tw / 2, sy + th / 2);
    ctx.closePath();
    if (outline) ctx.stroke(); else { ctx.fill(); }
  }

  // ── picking (E4): flat pick then sprite/alpha pick, front-to-back ─────
  pick(sx: number, sy: number): { kind: string; id: number; tx?: number; ty?: number } | null {
    // 1) sprite pick: walk draw list front-to-back, bounding-box test.
    const sprites = [...this.buildSprites()].reverse();
    for (const s of sprites) {
      const [bx, by] = tileToScreen(s.tx + s.w - 1, s.ty + s.h - 1);
      const px = bx * this.cam.zoom + this.cam.x;
      const py = by * this.cam.zoom + this.cam.y + TILE_H * this.cam.zoom;
      const h = s.heightPx * this.cam.zoom;
      const wdt = Math.max(20, s.w * 26) * this.cam.zoom;
      if (sx >= px - wdt / 2 && sx <= px + wdt / 2 && sy >= py - h && sy <= py) {
        // (E1 will confirm with an alpha mask; placeholder art is solid.)
        return { kind: s.kind, id: s.id };
      }
    }
    // 2) flat pick
    const [tx, ty] = this.screenToWorld(sx, sy);
    if (!inBounds(tx, ty)) return null;
    return { kind: "terrain", id: tileIndex(tx, ty), tx, ty };
  }

  // ── input / camera (E4) ───────────────────────────────────────────────
  private bindInput() {
    const c = this.canvas;
    c.style.touchAction = "none";
    let panning = false; let px = 0, py = 0;
    let pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0; let mid = { x: 0, y: 0 };
    let downTile: { x: number; y: number } | null = null;
    let moved = 0;

    const zoomAt = (factor: number, sxp: number, syp: number) => {
      const cur = this.cam.zoom;
      const i = ZOOM_LEVELS.indexOf(cur);
      const ni = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + (factor > 1 ? 1 : -1)));
      const nz = ZOOM_LEVELS[ni] as Zoom;
      if (nz === cur) return;
      // anchor: keep the world tile under the pinch midpoint fixed
      const [tx, ty] = this.screenToWorld(sxp, syp);
      this.cam.zoom = nz;
      const [wx, wy] = tileToScreen(tx, ty);
      this.cam.x = Math.floor(sxp - wx * nz);
      this.cam.y = Math.floor(syp - wy * nz);
      this.invalidateChunks();
      this.clampCamera();
    };

    c.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      c.setPointerCapture?.(e.pointerId);
      px = e.clientX; py = e.clientY; moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        panning = false;
        return;
      }
      panning = true;
      const [tx, ty] = this.screenToWorld(e.clientX, e.clientY);
      downTile = { x: tx, y: ty };
      this.dragStart = { x: tx, y: ty };
      this.dragEnd = { x: tx, y: ty };
    });

    c.addEventListener("pointermove", (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const nm = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch > 0 && Math.abs(d - pinch) > 12) zoomAt(pinch / d > 1 ? 1.2 : 0.8, nm.x, nm.y);
        pinch = d;
        // two-finger midpoint drag pans
        this.cam.x += nm.x - mid.x; this.cam.y += nm.y - mid.y;
        mid = nm; this.clampCamera();
        return;
      }
      if (!panning) {
        this.hover = this.pick(e.clientX, e.clientY);
        return;
      }
      const dx = e.clientX - px, dy = e.clientY - py;
      px = e.clientX; py = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      this.cam.x += dx; this.cam.y += dy; this.clampCamera();
      if (this.buildKind === "road" || this.buildKind === "rail") {
        const [tx, ty] = this.screenToWorld(e.clientX, e.clientY);
        this.dragEnd = { x: tx, y: ty };
        this.dragEndScreenX = e.clientX; this.dragEndScreenY = e.clientY;
      }
    });

    const release = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      // E5 pointer-release behaviour: promote the remaining pointer
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        px = p.x; py = p.y; pinch = 0; panning = true;
        return;
      }
      panning = false; pinch = 0;
      if (moved < 8 && downTile) {
        const hit = this.pick(e.clientX, e.clientY);
        this.onPick?.(hit);
      } else if (this.buildKind === "road" || this.buildKind === "rail") {
        this.commitBuildDrag();
      }
      this.dragStart = null; this.dragEnd = null; downTile = null;
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", () => { pointers.clear(); panning = false; pinch = 0; });

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.2 : 0.8, e.clientX, e.clientY);
    }, { passive: false });

    window.addEventListener("resize", () => this.resize());
    window.addEventListener("orientationchange", () => this.resize());
    const vv = window.visualViewport;
    if (vv) vv.addEventListener("resize", () => this.resize());
  }

  private commitBuildDrag() {
    if (!this.dragStart || !this.dragEnd || !this.buildKind) return;
    const kind = this.buildKind === "rail" ? "rail" : "road";
    const path = this.world.net.dragPath(
      kind, this.dragStart.x, this.dragStart.y, this.dragEnd.x, this.dragEnd.y, this.dragFlip);
    const charged = this.world.net.commitDrag(kind, path);
    this.onBuildCommit?.(kind, charged);
    this.world.checkConnections();
    this.invalidateChunks();
  }

  onBuildCommit?: (kind: "road" | "rail", tiles: { x: number; y: number }[]) => void;
}
