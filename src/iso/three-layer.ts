// LIVE-3D spike (owner, 2026-10-03): instanced 3D buildings over the 2D game, behind `?three=1`.
// FRAME RATE FIRST: no per-frame allocation, instance matrices only rebuilt when the world changes.
import * as THREE from "three";
import { HW, HH } from "../game/config";

export interface ThreeItem { sprite: string; tx: number; ty: number; w: number; h: number }
export interface ThreeStats { fps: number; drawCalls: number; triangles: number; instances: number }
interface Cam { x: number; y: number; zoom: number; vw: number; vh: number }

const K = 34;            // screen px per unit of building height at zoom 1
const DEPTH = 2048;

export const threeWanted = (s: string = typeof location !== "undefined" ? location.search : ""): boolean =>
  new URLSearchParams(s).get("three") === "1";

export interface ThreeLayer {
  canvas: HTMLCanvasElement;
  setItems(items: ThreeItem[]): void;
  update(cam: Cam, nowMs: number): void;
  stats(): ThreeStats;
  dispose(): void;
}

export function mountThreeLayer(host: HTMLElement, before: HTMLElement | null, search: string = location.search): ThreeLayer | null {
  const q = new URLSearchParams(search);
  const tris = Number(q.get("tris") ?? 0) | 0;
  const fixedYaw = q.get("yaw");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3";
  host.insertBefore(canvas, before);
  let renderer: any;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
  } catch { canvas.remove(); return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
  sun.position.set(-1, 1.6, -0.6);         // upper left (world: -x/-z is screen left/up)
  scene.add(sun, new THREE.AmbientLight(0xaab4d0, 1.1));

  // The camera is a hand-built projection: the game's 2:1 iso, exactly.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;
  const P = camera.projectionMatrix;
  const view = camera.matrixWorldInverse;
  const viewInv = camera.matrixWorld;
  const tmpA = new THREE.Matrix4(), tmpB = new THREE.Matrix4(), tmpC = new THREE.Matrix4();

  const geo: any = tris > 0
    ? new THREE.IcosahedronGeometry(0.5, Math.max(0, Math.round(Math.sqrt(tris / 20)) - 1))   // 20*(d+1)^2 triangles
    : new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  interface Group { mesh: any; cap: number }
  const groups = new Map<string, Group>();
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), quat = new THREE.Quaternion();
  const tint = new THREE.Color();
  let instances = 0;

  const hashOf = (s: string): number => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; };

  const setItems = (items: ThreeItem[]) => {
    const by = new Map<string, ThreeItem[]>();
    for (const it of items) { let a = by.get(it.sprite); if (!a) by.set(it.sprite, a = []); a.push(it); }
    instances = 0;
    for (const g of groups.values()) g.mesh.count = 0;
    for (const [sprite, list] of by) {
      let g = groups.get(sprite);
      if (!g || g.cap < list.length) {
        if (g) { scene.remove(g.mesh); g.mesh.dispose(); }
        const cap = Math.max(16, list.length * 2);
        const mesh = new THREE.InstancedMesh(geo, mat, cap);
        mesh.frustumCulled = false;       // spike: one mesh per sprite, culling it whole buys nothing
        tint.setHSL((hashOf(sprite) % 360) / 360, 0.3, 0.72);
        for (let i = 0; i < cap; i++) mesh.setColorAt(i, tint);
        g = { mesh, cap }; groups.set(sprite, g); scene.add(mesh);
      }
      const hgt = 1 + (hashOf(sprite) % 100) / 100;     // 1..2 tiles
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        pos.set(it.tx + it.w / 2, 0, it.ty + it.h / 2);
        scl.set(it.w * 0.92, hgt, it.h * 0.92);
        m4.compose(pos, quat, scl);
        g.mesh.setMatrixAt(i, m4);
      }
      g.mesh.count = list.length;
      g.mesh.instanceMatrix.needsUpdate = true;
      if (g.mesh.instanceColor) g.mesh.instanceColor.needsUpdate = true;
      instances += list.length;
    }
  };

  // Q/E turn 90 degrees about the screen-centre ground point, eased; ?yaw=<deg> pins it.
  let yawTarget = fixedYaw != null ? (Number(fixedYaw) * Math.PI) / 180 : 0;
  let yaw = yawTarget;
  let lastT = 0;
  const onKey = (e: KeyboardEvent) => {
    if (fixedYaw != null || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.key === "q" || e.key === "Q") yawTarget -= Math.PI / 2;
    else if (e.key === "e" || e.key === "E") yawTarget += Math.PI / 2;
  };
  window.addEventListener("keydown", onKey);

  let cw = 0, ch = 0;
  const update = (cam: Cam, nowMs: number) => {
    const dt = lastT ? Math.min(0.1, (nowMs - lastT) / 1000) : 0.016;
    lastT = nowMs;
    if (yaw !== yawTarget) {
      yaw += (yawTarget - yaw) * Math.min(1, dt * 10);
      if (Math.abs(yawTarget - yaw) < 1e-3) yaw = yawTarget;
    }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w !== cw || h !== ch) { cw = w; ch = h; renderer.setSize(w, h, false); }
    const z = cam.zoom, vw = cam.vw, vh = cam.vh;
    // ground point under the screen centre (tile units, fractional)
    const wx = (vw / 2 - cam.x) / z, wy = (vh / 2 - cam.y) / z;
    const px = (wx / HW + wy / HH) / 2, pz = (wy / HH - wx / HW) / 2;
    tmpA.makeTranslation(px, 0, pz);
    tmpB.makeRotationY(yaw);
    tmpC.makeTranslation(-px, 0, -pz);
    view.copy(tmpA).multiply(tmpB).multiply(tmpC);
    viewInv.copy(view).invert();
    const sx = (2 / vw) * z * HW, sy = (2 / vh) * z * HH, sh = (2 / vh) * z * K;
    // clip.x = sx*(x-z) + (2cx/vw - 1); clip.y = -sy*(x+z) + sh*y + (1 - 2cy/vh); clip.z = (-(x+z) + .5y)/DEPTH
    P.set(
      sx, 0, -sx, 2 * cam.x / vw - 1,
      -sy, sh, -sy, 1 - 2 * cam.y / vh,
      -1 / DEPTH, 0.5 / DEPTH, -1 / DEPTH, 0,
      0, 0, 0, 1,
    );
    renderer.render(scene, camera);
  };

  // fps: 5 s rolling average from rAF
  const stamps = new Float64Array(1024);
  let sHead = 0, sCount = 0, rafId = 0;
  const tick = (t: number) => {
    stamps[sHead] = t; sHead = (sHead + 1) & 1023; if (sCount < 1024) sCount++;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  const stats = (): ThreeStats => {
    let n = 0, oldest = 0, newest = 0;
    for (let i = 0; i < sCount; i++) {
      const t = stamps[(sHead - 1 - i + 2048) & 1023];
      if (i === 0) newest = t;
      if (newest - t > 5000) break;
      oldest = t; n++;
    }
    const fps = n > 1 && newest > oldest ? ((n - 1) * 1000) / (newest - oldest) : 0;
    const r = renderer.info.render;
    return { fps: Math.round(fps * 10) / 10, drawCalls: r.calls, triangles: r.triangles, instances };
  };

  return {
    canvas, setItems, update, stats,
    dispose() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
      renderer.dispose(); canvas.remove();
    },
  };
}
