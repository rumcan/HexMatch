// ══════════════════════════════════════════════════════════════════════════
// E4 — visual harness. `npm run dev` → /iso-demo.html
//
// Not part of the game bundle; this exists so the renderer's acceptance
// criteria (depth sort, two-stage picking, anchored zoom, clamped pan) can be
// eyeballed against real art before E11 cuts over from MapView3D.
// ══════════════════════════════════════════════════════════════════════════
import manifestJson from "../../assets/iso-atlas/manifest.json";
import atlas05 from "../../assets/iso-atlas/atlas@0.5x.png";
import atlas1 from "../../assets/iso-atlas/atlas@1x.png";
import atlas2 from "../../assets/iso-atlas/atlas@2x.png";

import { Atlas, buildMasks, type Manifest, type AtlasImage } from "./atlas";
import {
  createCamera, centerOnMap, resizeCamera, zoomStepAt, createGesture,
  pointerDown, pointerMove, pointerUp, type Camera, type GestureState,
} from "./camera";
import { IsoRenderer, type World } from "./renderer";
import { generateMap } from "./grid";
import { MAP_W, MAP_H } from "../game/config";

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = rej;
  img.src = src;
});

export async function startDemo(root: HTMLElement) {
  const images = new Map<number, AtlasImage>();
  const [a05, a1, a2] = await Promise.all([load(atlas05), load(atlas1), load(atlas2)]);
  images.set(0.5, a05); images.set(1, a1); images.set(2, a2);
  const atlas = new Atlas(manifestJson as unknown as Manifest, images);
  buildMasks(atlas);

  const mk = (z: number) => {
    const c = document.createElement("canvas");
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z};touch-action:none`;
    root.appendChild(c);
    return c;
  };
  const canvases = { terrain: mk(1), structures: mk(2), overlay: mk(3) };

  const grid = generateMap(20260903);
  // a straight road + rail run so the autotile masks are visible (E5 preview)
  const roadBits = new Uint8Array(MAP_W * MAP_H);
  const railBits = new Uint8Array(MAP_W * MAP_H);
  for (let t = 8; t < 40; t++) {
    roadBits[24 * MAP_W + t] = 0b0101;    // NE|SW
    railBits[t * MAP_W + 24] = 0b1010;    // SE|NW
  }
  const world: World = { grid, roadBits, railBits };

  let cam: Camera = centerOnMap(createCamera(root.clientWidth, root.clientHeight));
  const r = new IsoRenderer(canvases, atlas, cam, world);

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(root.clientWidth * dpr), h = Math.floor(root.clientHeight * dpr);
    for (const c of Object.values(canvases)) { c.width = w; c.height = h; }
    cam = resizeCamera(cam, w, h);
    r.setCamera(cam);
  };
  new ResizeObserver(resize).observe(root);
  window.visualViewport?.addEventListener("resize", resize);
  window.addEventListener("orientationchange", resize);
  resize();

  // ── input ──
  let g: GestureState = createGesture();
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const pos = (e: PointerEvent): [number, number] => {
    const b = root.getBoundingClientRect();
    return [(e.clientX - b.left) * dpr(), (e.clientY - b.top) * dpr()];
  };
  canvases.overlay.addEventListener("pointerdown", (e) => {
    canvases.overlay.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    g = pointerDown(g, { id: e.pointerId, x, y });
  });
  canvases.overlay.addEventListener("pointermove", (e) => {
    const [x, y] = pos(e);
    const out = pointerMove(g, { id: e.pointerId, x, y }, cam);
    g = out.gesture;
    if (out.cam !== cam) { cam = out.cam; r.setCamera(cam); }
    hover = r.pick(x, y);
  });
  const up = (e: PointerEvent) => { g = pointerUp(g, e.pointerId); };
  canvases.overlay.addEventListener("pointerup", up);
  canvases.overlay.addEventListener("pointercancel", up);
  canvases.overlay.addEventListener("wheel", (e) => {
    e.preventDefault();
    const [x, y] = pos(e as unknown as PointerEvent);
    cam = zoomStepAt(cam, e.deltaY < 0 ? +1 : -1, x, y);
    r.setCamera(cam);
  }, { passive: false });

  let hover: ReturnType<IsoRenderer["pick"]> | null = null;
  const hud = document.createElement("div");
  hud.style.cssText = "position:absolute;left:8px;top:8px;z-index:9;font:12px ui-monospace,monospace;" +
    "background:#0b3b63cc;color:#fff;padding:6px 8px;border-radius:6px;pointer-events:none";
  root.appendChild(hud);

  const frame = (t: number) => {
    const overlay = hover && atlas.has("highlight")
      ? [{ sprite: "highlight", tx: hover.tx, ty: hover.ty }]
      : [];
    r.render(t, overlay);
    const ref = hover?.ref as { type?: string } | null;
    hud.textContent =
      `zoom ${cam.zoom}×  tile ${hover?.tx ?? "-"},${hover?.ty ?? "-"}  ` +
      `pick ${ref?.type ?? hover?.sprite?.sprite ?? "terrain"}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
