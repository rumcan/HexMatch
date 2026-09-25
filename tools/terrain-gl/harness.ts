/**
 * Standalone harness for the terrain renderer.
 *
 *  - builds a synthetic 144×144 island (beaches, river, rough, hills)
 *  - renders it with createTerrainRenderer on a WebGL2 canvas
 *  - draws the tile-diamond grid on a 2D canvas stacked above it using the
 *    SAME camera formula, to prove pixel alignment with the game's overlay
 *  - drag to pan, wheel / buttons to step zoom 0.5 / 1 / 2, toggle quality,
 *    elevation and grid, "dam" a 5×5 patch through invalidateTiles
 *  - fps / frame-ms counter
 *
 * `mountHarness(root)` is used by both harness.html and the React demo page.
 */
import {
  createTerrainRenderer,
  worldOfCorner,
  TERRAIN_WATER,
  TERRAIN_SAND,
  type TerrainCamera,
  type TerrainMapInput,
  type TerrainRenderer,
} from "../../src/iso/terrain-gl/index";
import { makeSyntheticMap } from "./synthetic";

type Zoom = 0.5 | 1 | 2;
const ZOOMS: Zoom[] = [0.5, 1, 2];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.setAttribute("style", style);
  if (text !== undefined) e.textContent = text;
  return e;
}

const BTN =
  "font:12px/1 ui-monospace,monospace;padding:6px 9px;border:1px solid #6b7b52;border-radius:4px;background:#1f2a18;color:#e8e2c8;cursor:pointer;";
const BTN_ON = BTN + "background:#8a9a4c;color:#101408;border-color:#c8d49a;";

export function mountHarness(root: HTMLElement): () => void {
  root.style.position = "relative";
  root.style.overflow = "hidden";
  root.style.background = "#0e1a20";
  root.style.touchAction = "none";
  root.style.userSelect = "none";

  const CANVAS_STYLE = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  let glCanvas = el("canvas", CANVAS_STYLE);
  const ovCanvas = el("canvas", CANVAS_STYLE + "pointer-events:none;");
  root.appendChild(glCanvas);
  root.appendChild(ovCanvas);

  const bar = el(
    "div",
    "position:absolute;left:10px;top:10px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;" +
      "background:rgba(10,14,8,.72);padding:8px;border-radius:6px;backdrop-filter:blur(4px);max-width:calc(100% - 20px);",
  );
  root.appendChild(bar);
  const stats = el(
    "div",
    "position:absolute;right:10px;top:10px;font:12px/1.5 ui-monospace,monospace;color:#e8e2c8;" +
      "background:rgba(10,14,8,.72);padding:8px 10px;border-radius:6px;white-space:pre;",
  );
  root.appendChild(stats);

  // ---------------------------------------------------------------- state
  let seed = 1957;
  let elevation = true;
  let quality: "high" | "low" = "high";
  let grid = true;
  let map: TerrainMapInput = makeSyntheticMap({ seed, elevation });
  let renderer: TerrainRenderer | null = null;
  let ready = false;
  const cam: TerrainCamera = { x: 0, y: 0, zoom: 1, vw: 1, vh: 1 };
  let disposed = false;

  const dpr = (): number => Math.min(window.devicePixelRatio || 1, 3);

  function createRenderer(): void {
    if (renderer) {
      // fresh canvas per renderer so a quality change starts from a clean slate
      renderer.dispose();
      const fresh = el("canvas", CANVAS_STYLE);
      glCanvas.replaceWith(fresh);
      glCanvas = fresh;
    }
    ready = false;
    renderer = createTerrainRenderer(glCanvas, {
      quality,
      onReady: () => { ready = true; },
    });
    if (renderer) {
      renderer.resize(cam.vw, cam.vh);
      renderer.setMap(map);
    } else {
      glCanvas.replaceWith(el("div", "position:absolute;inset:0;display:grid;place-items:center;color:#e8e2c8;font:14px sans-serif;",
        "WebGL2 is not available in this browser – the game would keep its 2D ground."));
    }
  }

  function centerOnMap(): void {
    const [wx, wy] = worldOfCorner(map.w / 2, map.h / 2);
    cam.x = cam.vw / 2 - wx * cam.zoom;
    cam.y = cam.vh / 2 - wy * cam.zoom;
  }

  function fit(): void {
    const r = root.getBoundingClientRect();
    const vw = Math.max(1, Math.round(r.width * dpr()));
    const vh = Math.max(1, Math.round(r.height * dpr()));
    // keep the world point at the screen centre fixed while resizing
    const cxW = (cam.vw / 2 - cam.x) / cam.zoom, cyW = (cam.vh / 2 - cam.y) / cam.zoom;
    cam.vw = vw; cam.vh = vh;
    cam.x = vw / 2 - cxW * cam.zoom;
    cam.y = vh / 2 - cyW * cam.zoom;
    ovCanvas.width = vw; ovCanvas.height = vh;
    renderer?.resize(vw, vh);
  }

  function setZoom(z: Zoom, sx?: number, sy?: number): void {
    const px = sx ?? cam.vw / 2, py = sy ?? cam.vh / 2;
    const wx = (px - cam.x) / cam.zoom, wy = (py - cam.y) / cam.zoom;
    cam.zoom = z;
    cam.x = px - wx * z;
    cam.y = py - wy * z;
    refreshButtons();
  }

  function rebuildMap(): void {
    map = makeSyntheticMap({ seed, elevation });
    renderer?.setMap(map);
  }

  // ---------------------------------------------------------------- UI
  const zoomBtns = new Map<Zoom, HTMLButtonElement>();
  bar.appendChild(el("span", "font:12px ui-monospace,monospace;color:#c8d49a;", "zoom"));
  for (const z of ZOOMS) {
    const b = el("button", BTN, `${z}×`);
    b.onclick = () => setZoom(z);
    zoomBtns.set(z, b);
    bar.appendChild(b);
  }
  const qBtn = el("button", BTN, "quality: high");
  qBtn.onclick = () => { quality = quality === "high" ? "low" : "high"; createRenderer(); refreshButtons(); };
  bar.appendChild(qBtn);
  const eBtn = el("button", BTN, "elevation: on");
  eBtn.onclick = () => { elevation = !elevation; rebuildMap(); refreshButtons(); };
  bar.appendChild(eBtn);
  const gBtn = el("button", BTN, "grid: on");
  gBtn.onclick = () => { grid = !grid; refreshButtons(); };
  bar.appendChild(gBtn);
  const sBtn = el("button", BTN, "reseed");
  sBtn.onclick = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; rebuildMap(); };
  bar.appendChild(sBtn);
  const dBtn = el("button", BTN, "dam / flood centre");
  dBtn.title = "Toggles a 5×5 patch under the screen centre between water and land via invalidateTiles";
  dBtn.onclick = () => floodCentre();
  bar.appendChild(dBtn);
  const cBtn = el("button", BTN, "centre");
  cBtn.onclick = () => centerOnMap();
  bar.appendChild(cBtn);

  function refreshButtons(): void {
    for (const [z, b] of zoomBtns) b.setAttribute("style", z === cam.zoom ? BTN_ON : BTN);
    qBtn.textContent = `quality: ${quality}`;
    eBtn.textContent = `elevation: ${elevation ? "on" : "off"}`;
    gBtn.textContent = `grid: ${grid ? "on" : "off"}`;
  }

  /** Screen (device px) → tile coordinates (flat ground). */
  function tileAt(sx: number, sy: number): [number, number] {
    const wx = (sx - cam.x) / cam.zoom, wy = (sy - cam.y) / cam.zoom;
    return [Math.floor(wx / 64 + wy / 32), Math.floor(wy / 32 - wx / 64)];
  }

  function floodCentre(): void {
    const [tx0, ty0] = tileAt(cam.vw / 2, cam.vh / 2);
    const changed: Array<[number, number]> = [];
    const ci = ty0 * map.w + tx0;
    if (tx0 < 0 || ty0 < 0 || tx0 >= map.w || ty0 >= map.h) return;
    const toWater = map.terrain[ci] !== TERRAIN_WATER;
    const w1 = map.w + 1;
    for (let ty = ty0 - 2; ty <= ty0 + 2; ty++)
      for (let tx = tx0 - 2; tx <= tx0 + 2; tx++) {
        if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
        map.terrain[ty * map.w + tx] = toWater ? TERRAIN_WATER : TERRAIN_SAND;
        if (map.rivers) map.rivers[ty * map.w + tx] = 0;
        if (map.heights && toWater)
          for (let j = ty; j <= ty + 1; j++) for (let i = tx; i <= tx + 1; i++) map.heights[j * w1 + i] = 0;
        changed.push([tx, ty]);
      }
    renderer?.invalidateTiles(changed);
  }

  // ---------------------------------------------------------------- input
  let dragging = false, lastX = 0, lastY = 0, moved = 0;
  const onDown = (e: PointerEvent): void => {
    dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY;
    root.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const d = dpr();
    cam.x += (e.clientX - lastX) * d;
    cam.y += (e.clientY - lastY) * d;
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
  };
  const onUp = (e: PointerEvent): void => { dragging = false; root.releasePointerCapture(e.pointerId); };
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const i = ZOOMS.indexOf(cam.zoom);
    const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY < 0 ? 1 : -1)));
    if (ni === i) return;
    const r = root.getBoundingClientRect();
    setZoom(ZOOMS[ni], (e.clientX - r.left) * dpr(), (e.clientY - r.top) * dpr());
  };
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  const ro = new ResizeObserver(() => fit());
  ro.observe(root);

  // ---------------------------------------------------------------- overlay
  const ctx = ovCanvas.getContext("2d");
  function drawOverlay(): void {
    if (!ctx) return;
    ctx.clearRect(0, 0, cam.vw, cam.vh);
    if (!grid) return;
    const z = cam.zoom;
    const w1 = map.w + 1;
    const lvl = (i: number, j: number): number => (map.heights ? map.heights[j * w1 + i] : 0);
    const sx = (x: number): number => x * z + cam.x;
    const sy = (y: number): number => y * z + cam.y;
    // visible tile-space bounds (generous; heights only move things up ≤ 32 px)
    const corners: Array<[number, number]> = [[0, 0], [cam.vw, 0], [0, cam.vh], [cam.vw, cam.vh]];
    let iMin = Infinity, iMax = -Infinity, jMin = Infinity, jMax = -Infinity;
    for (const [px, py] of corners) {
      const wx = (px - cam.x) / z, wy = (py - cam.y) / z;
      const i = wx / 64 + wy / 32, j = wy / 32 - wx / 64;
      iMin = Math.min(iMin, i); iMax = Math.max(iMax, i); jMin = Math.min(jMin, j); jMax = Math.max(jMax, j);
    }
    // +3 below: raised corners (≤ 32 world px) can pull geometry up into view
    const i0 = Math.max(0, Math.floor(iMin) - 2), i1 = Math.min(map.w, Math.ceil(iMax) + 3);
    const j0 = Math.max(0, Math.floor(jMin) - 2), j1 = Math.min(map.h, Math.ceil(jMax) + 3);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.32)";
    ctx.beginPath();
    // lattice lines along i (constant j) and along j (constant i)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const [x, y] = worldOfCorner(i, j, lvl(i, j));
        if (i > i0) { const [px, py] = worldOfCorner(i - 1, j, lvl(i - 1, j)); ctx.moveTo(sx(px), sy(py)); ctx.lineTo(sx(x), sy(y)); }
        if (j > j0) { const [px, py] = worldOfCorner(i, j - 1, lvl(i, j - 1)); ctx.moveTo(sx(px), sy(py)); ctx.lineTo(sx(x), sy(y)); }
      }
    }
    ctx.stroke();
    // a "building footprint" marker at the screen-centre tile: the diamond the
    // game would draw a building on must sit exactly on the painted tile
    const [tx, ty] = tileAt(cam.vw / 2, cam.vh / 2);
    if (tx >= 0 && ty >= 0 && tx < map.w && ty < map.h) {
      const pts = [worldOfCorner(tx, ty, lvl(tx, ty)), worldOfCorner(tx + 1, ty, lvl(tx + 1, ty)),
        worldOfCorner(tx + 1, ty + 1, lvl(tx + 1, ty + 1)), worldOfCorner(tx, ty + 1, lvl(tx, ty + 1))];
      ctx.beginPath();
      ctx.moveTo(sx(pts[0][0]), sy(pts[0][1]));
      for (let k = 1; k < 4; k++) ctx.lineTo(sx(pts[k][0]), sy(pts[k][1]));
      ctx.closePath();
      ctx.fillStyle = "rgba(255,90,60,0.25)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,120,80,0.95)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- loop
  let raf = 0;
  let frames = 0, accum = 0, fps = 0, avgMs = 0, lastStats = performance.now();
  const loop = (t: number): void => {
    if (disposed) return;
    const t0 = performance.now();
    renderer?.render(cam, t);
    drawOverlay();
    const dt = performance.now() - t0;
    frames++; accum += dt;
    if (t0 - lastStats > 500) {
      fps = Math.round((frames * 1000) / (t0 - lastStats));
      avgMs = accum / frames;
      frames = 0; accum = 0; lastStats = t0;
      const [tx, ty] = tileAt(cam.vw / 2, cam.vh / 2);
      stats.textContent =
        `${fps} fps  ${avgMs.toFixed(2)} ms cpu/frame\n` +
        `zoom ${cam.zoom}×  ${cam.vw}×${cam.vh} px  dpr ${dpr().toFixed(2)}\n` +
        `centre tile ${tx},${ty}  seed ${seed}\n` +
        `${ready ? "textures ready (procedural)" : "loading textures…"}  quality ${quality}`;
    }
    raf = requestAnimationFrame(loop);
  };

  fit();
  createRenderer();
  centerOnMap();
  refreshButtons();
  raf = requestAnimationFrame(loop);

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    root.removeEventListener("pointerdown", onDown);
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerup", onUp);
    root.removeEventListener("pointercancel", onUp);
    root.removeEventListener("wheel", onWheel);
    renderer?.dispose();
    renderer = null;
    root.replaceChildren();
  };
}

// Auto-mount for harness.html
const autoRoot = typeof document !== "undefined" ? document.getElementById("harness-root") : null;
if (autoRoot) mountHarness(autoRoot);
